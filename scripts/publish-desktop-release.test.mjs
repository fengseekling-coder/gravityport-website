import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWriterHarness } from "./publish-desktop-release.test-helpers.mjs";

const scriptPath = new URL("./publish-desktop-release.sh", import.meta.url).pathname;
// The canonical manifest writer snapshot is the only writer the tests
// exercise. Its CLI is pinned to the frozen build identity inside the
// snapshot, so the tests invoke a generated wrapper (see
// publish-desktop-release.test-helpers.mjs) that delegates to the same
// exported prepareDesktopReleaseManifest() with a fixture build identity and a
// throwaway Ed25519 key. Override the snapshot location with
// MOSA_RELEASE_CANONICAL_WRITER if it ever moves.
const writerHarness = await createWriterHarness();
const writerPath = writerHarness.writerPath;
const versionHelperPath = new URL("./release-version.mjs", import.meta.url).pathname;
const realMacZipPath = new URL("../../mosa/out/make/update/darwin/arm64/MOSA-darwin-arm64-0.2.1-rc.15.zip", import.meta.url).pathname;

// The live 0.2.1-rc.15 manifest at publication time of this protocol change.
const LIVE_RC15_MANIFEST = {
  version: "0.2.1-rc.15",
  publishedAt: "2026-09-19T00:09:34Z",
  notes: {
    zh: "MOSA 0.2.1-rc.15 桌面测试发布包。新增 macOS 应用内自更新链路：检查更新、下载校验、自动替换与重启。本版本为自更新引导版本，Windows 包暂缓发布。",
    en: "MOSA 0.2.1-rc.15 desktop test release. Adds the macOS in-app self-update pipeline: update check, verified download, automatic replacement and restart. This build bootstraps self-update; the Windows package is deferred.",
  },
  platforms: {
    macos: {
      platform: "macOS",
      arch: "arm64",
      file: "MOSA-darwin-arm64-0.2.1-rc.15.zip",
      size: 128358577,
      sha256: "6f1de34996d776ff4bcf48655f5bc314504c2ecb2f8e0edec63650b234067098",
    },
  },
};

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function makeZipFixture(rootDir, relativeEntries) {
  const payloadDir = path.join(rootDir, "payload");
  for (const entry of relativeEntries) {
    const entryPath = path.join(payloadDir, entry);
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "");
  }
  const zipPath = path.join(rootDir, `${path.basename(relativeEntries[0])}.zip`);
  execFileSync("zip", ["-q", "-r", "-X", zipPath, relativeEntries[0].split("/")[0]], { cwd: payloadDir });
  return zipPath;
}

function renameFile(filePath, newName) {
  const target = path.join(path.dirname(filePath), newName);
  fs.renameSync(filePath, target);
  return target;
}

function makeSourceTree({ macVersion = "0.2.1-rc.16", windowsVersion = null } = {}) {
  const root = makeTempDir("mosa-release-src.");
  const macZip = makeZipFixture(root, ["MOSA.app/Contents/MacOS/MOSA"]);
  const macPath = renameFile(macZip, `MOSA-darwin-arm64-${macVersion}.zip`);
  const updateDir = path.join(root, "update", "darwin", "arm64");
  fs.mkdirSync(updateDir, { recursive: true });
  fs.renameSync(macPath, path.join(updateDir, `MOSA-darwin-arm64-${macVersion}.zip`));

  let windowsPath = null;
  if (windowsVersion) {
    const windowsZip = makeZipFixture(root, ["MOSA.exe"]);
    windowsPath = renameFile(windowsZip, `MOSA-win32-x64-${windowsVersion}.zip`);
    const windowsDir = path.join(root, "zip", "win32", "x64");
    fs.mkdirSync(windowsDir, { recursive: true });
    fs.renameSync(windowsPath, path.join(windowsDir, `MOSA-win32-x64-${windowsVersion}.zip`));
    windowsPath = path.join(windowsDir, `MOSA-win32-x64-${windowsVersion}.zip`);
  }
  return { root, macPath: path.join(updateDir, `MOSA-darwin-arm64-${macVersion}.zip`), windowsPath };
}

const FIXTURE_NOTES_ZH = "rc.16 测试发布说明：用于发布保护测试的显式中文文案。";
const FIXTURE_NOTES_EN = "rc.16 test release notes: explicit English copy for the release guard tests.";

function safeEnv({ sourceDir, stateFile, previousManifest = "", dryRunOutput = "", notesZh = "", notesEn = "" }) {
  return {
    ...process.env,
    MOSA_RELEASE_SOURCE_DIR: sourceDir,
    MOSA_RELEASE_STATE_FILE: stateFile,
    MOSA_RELEASE_MANIFEST_WRITER: writerPath,
    MOSA_RELEASE_PREVIOUS_MANIFEST: previousManifest,
    MOSA_RELEASE_DRY_RUN_OUTPUT: dryRunOutput,
    MOSA_RELEASE_PUBLISHED_AT: "2026-09-19T01:00:00Z",
    // These fixtures are MOSA-named packages; the script now defaults to GravityPort.
    MOSA_RELEASE_PRODUCT: "MOSA",
    // Empty by default: every test decides explicitly whether release notes
    // are configured. An empty string behaves like an unset variable.
    MOSA_RELEASE_NOTES_ZH: notesZh,
    MOSA_RELEASE_NOTES_EN: notesEn,
    // Never touch production infrastructure from tests: port 1 refuses instantly.
    MOSA_RELEASE_SSH_HOST: "127.0.0.1",
    MOSA_RELEASE_SSH_PORT: "1",
    MOSA_RELEASE_SSH_USER: "mosa-test",
    MOSA_RELEASE_SSH_KEY: path.join(os.tmpdir(), "mosa-test-nonexistent-key"),
    MOSA_RELEASE_KNOWN_HOSTS: path.join(os.tmpdir(), "mosa-test-nonexistent-known-hosts"),
    MOSA_RELEASE_REMOTE_DIR: "/var/www/mosa-website",
  };
}

function runDryRun({ sourceDir, stateFile, previousManifest = "", dryRunOutput = "", notesZh = FIXTURE_NOTES_ZH, notesEn = FIXTURE_NOTES_EN }) {
  const outputDir = makeTempDir("mosa-release-run.");
  const outputPath = dryRunOutput || path.join(outputDir, "staged-latest.json");
  const result = execFileSync("bash", [scriptPath, "--dry-run"], {
    env: safeEnv({ sourceDir, stateFile, previousManifest, dryRunOutput: outputPath, notesZh, notesEn }),
    encoding: "utf8",
  });
  const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  return { stdout: result, manifest, stagedPath: outputPath };
}

function runScriptExpectFailure({ sourceDir, stateFile, previousManifest = "", notesZh = "", notesEn = "" }) {
  let caught = null;
  try {
    execFileSync("bash", [scriptPath], {
      env: safeEnv({ sourceDir, stateFile, previousManifest, notesZh, notesEn }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the publish script to fail");
  return caught;
}

test("macOS-only rc.16 generates a platforms.macos-only manifest", () => {
  const { root, macPath } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const { manifest } = runDryRun({ sourceDir: root, stateFile });

  assert.equal(manifest.version, "0.2.1-rc.16");
  assert.equal(manifest.publishedAt, "2026-09-19T01:00:00.000Z", "publishedAt is canonicalized by the writer");
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["macos"]);
  assert.equal(manifest.platforms.macos.platform, "macOS");
  assert.equal(manifest.platforms.macos.arch, "arm64");
  assert.equal(manifest.platforms.macos.file, "MOSA-darwin-arm64-0.2.1-rc.16.zip");
  assert.equal(manifest.platforms.macos.size, fs.statSync(macPath).size);
  assert.equal(manifest.platforms.macos.sha256, sha256File(macPath));
  assert.equal("windows" in manifest.platforms, false);
  assert.equal("artifacts" in manifest, false, "legacy artifacts.* must never re-enter the manifest");
  assert.equal(manifest.notes.zh, FIXTURE_NOTES_ZH, "explicit env notes reach the canonical writer");
  assert.equal(manifest.notes.en, FIXTURE_NOTES_EN);
});

test("macOS + Windows same-version release generates both platform entries", () => {
  const { root, macPath, windowsPath } = makeSourceTree({ macVersion: "0.2.1-rc.16", windowsVersion: "0.2.1-rc.16" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const { manifest } = runDryRun({ sourceDir: root, stateFile });

  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["macos", "windows"]);
  assert.equal(manifest.platforms.macos.sha256, sha256File(macPath));
  assert.equal(manifest.platforms.windows.platform, "Windows");
  assert.equal(manifest.platforms.windows.arch, "x64");
  assert.equal(manifest.platforms.windows.file, "MOSA-win32-x64-0.2.1-rc.16.zip");
  assert.equal(manifest.platforms.windows.sha256, sha256File(windowsPath));
  assert.equal("artifacts" in manifest, false);
});

test("macOS rc.16 with only a Windows rc.15 package must not ride the old Windows artifact", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16", windowsVersion: "0.2.1-rc.15" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const { manifest } = runDryRun({ sourceDir: root, stateFile });

  assert.equal(manifest.version, "0.2.1-rc.16");
  assert.deepEqual(Object.keys(manifest.platforms), ["macos"], "cross-version Windows artifact must be ignored");
  assert.equal("windows" in manifest.platforms, false);
  assert.equal("artifacts" in manifest, false);
});

test("canonical writer itself rejects cross-version --windows input", () => {
  const { root, macPath, windowsPath } = makeSourceTree({ macVersion: "0.2.1-rc.16", windowsVersion: "0.2.1-rc.15" });
  const output = path.join(root, "out.json");
  let failed = false;
  try {
    execFileSync("node", [
      writerPath,
      "--version", "0.2.1-rc.16",
      "--mac", macPath,
      "--windows", windowsPath,
      "--output", output,
    ], { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    failed = true;
  }
  assert.ok(failed, "writer must fail when the Windows artifact version does not match");
  assert.equal(fs.existsSync(output), false, "no manifest may be written on failure");
});

test("previous manifest visualPacks are preserved verbatim and legacy artifacts.* are dropped", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const previous = {
    version: "0.2.1-rc.15",
    publishedAt: "2026-09-19T00:09:34Z",
    notes: { zh: "旧说明", en: "old notes" },
    artifacts: {
      mac: { platform: "macOS", arch: "arm64", file: "MOSA-darwin-arm64-0.2.1-rc.15.dmg", size: 1, sha256: "a".repeat(64) },
      windows: { platform: "Windows", arch: "x64", file: "MOSA-win32-x64-0.2.1-rc.15.zip", size: 2, sha256: "b".repeat(64) },
    },
    platforms: {
      macos: { platform: "macOS", arch: "arm64", file: "MOSA-darwin-arm64-0.2.1-rc.15.zip", size: 3, sha256: "c".repeat(64) },
    },
    visualPacks: {
      "siglip2-int8": { version: "1.2.0", size: 378, sha256: "d".repeat(64), url: "https://mosa.azhuilab.com/downloads/pack.mosa-pack" },
    },
  };
  const previousPath = path.join(root, "previous-latest.json");
  fs.writeFileSync(previousPath, JSON.stringify(previous, null, 2));

  const { manifest } = runDryRun({ sourceDir: root, stateFile, previousManifest: previousPath });
  assert.equal("artifacts" in manifest, false, "legacy artifacts.* must be dropped");
  assert.deepEqual(manifest.visualPacks, previous.visualPacks, "visualPacks must be preserved verbatim");
  assert.equal(manifest.notes.zh, FIXTURE_NOTES_ZH, "explicit notes override previous notes");
  assert.equal(manifest.notes.en, FIXTURE_NOTES_EN);
});

test("canonical writer reproduces the live rc.15 manifest from itself (compatibility)", (t) => {
  if (!fs.existsSync(realMacZipPath)) {
    t.skip("local rc.15 update ZIP not present");
    return;
  }
  const outputDir = makeTempDir("mosa-compat.");
  const output = path.join(outputDir, "latest.json");
  const previousPath = path.join(outputDir, "previous.json");
  fs.writeFileSync(previousPath, JSON.stringify(LIVE_RC15_MANIFEST, null, 2));

  execFileSync("node", [
    writerPath,
    "--version", "0.2.1-rc.15",
    "--previous", previousPath,
    "--mac", realMacZipPath,
    "--published-at", LIVE_RC15_MANIFEST.publishedAt,
    "--notes-zh", LIVE_RC15_MANIFEST.notes.zh,
    "--notes-en", LIVE_RC15_MANIFEST.notes.en,
    "--output", output,
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const regenerated = JSON.parse(fs.readFileSync(output, "utf8"));
  // The current canonical writer records --mac-app-name in the platform
  // entry, so the regenerated rc.15 entry carries appName where the live
  // manifest predates that field.
  assert.deepEqual(regenerated.platforms.macos, { ...LIVE_RC15_MANIFEST.platforms.macos, appName: "MOSA.app" });
  assert.deepEqual(regenerated.notes, LIVE_RC15_MANIFEST.notes);
  assert.equal("artifacts" in regenerated, false);
  assert.equal("windows" in regenerated.platforms, false, "no Windows rc.15 artifact exists, so no windows entry");
});

test("generated manifest size/SHA always match the actual artifact files", () => {
  const { root, macPath } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const { manifest } = runDryRun({ sourceDir: root, stateFile });

  assert.equal(manifest.platforms.macos.size, fs.statSync(macPath).size, "size must be computed from the file");
  assert.equal(manifest.platforms.macos.sha256, sha256File(macPath), "digest must be computed from the file");
});

test("upload failure leaves latest.json and the state file untouched", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n");

  runScriptExpectFailure({ sourceDir: root, stateFile });
  assert.equal(
    fs.readFileSync(stateFile, "utf8"),
    "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n",
    "state file must not change when publishing fails",
  );
});

test("a candidate older than the published version is skipped as a downgrade", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.20|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|none\n");

  // No notes are configured: downgrades must still be skipped before the
  // release-notes requirement is evaluated.
  const stdout = execFileSync("bash", [scriptPath, "--dry-run"], {
    env: safeEnv({ sourceDir: root, stateFile }),
    encoding: "utf8",
  });
  assert.match(stdout, /跳过降级/);
});

test("an identical signature is a no-op even without network access", () => {
  const { root, macPath } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, `0.2.1-rc.16|${sha256File(macPath)}|none\n`);

  // No notes are configured: the same-version/same-SHA no-op must not require
  // release notes (this is what keeps the rc.15 monitor quiet every 5 minutes).
  const stdout = execFileSync("bash", [scriptPath], {
    env: safeEnv({ sourceDir: root, stateFile }),
    encoding: "utf8",
  });
  assert.match(stdout, /已发布，SHA-256 未变化/);
});

test("Case 1: current rc.15 with the same SHA and no notes is a clean no-op", () => {
  const { root, macPath } = makeSourceTree({ macVersion: "0.2.1-rc.15" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  const signature = `0.2.1-rc.15|${sha256File(macPath)}|none`;
  fs.writeFileSync(stateFile, `${signature}\n`);

  const stdout = execFileSync("bash", [scriptPath], {
    env: safeEnv({ sourceDir: root, stateFile, notesZh: "", notesEn: "" }),
    encoding: "utf8",
  });
  assert.match(stdout, /已发布，SHA-256 未变化/);
  assert.equal(fs.readFileSync(stateFile, "utf8"), `${signature}\n`, "state file is untouched by a no-op");
});

test("Case 2: a new rc.16 release without any notes fails before any remote action", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n");

  const error = runScriptExpectFailure({ sourceDir: root, stateFile, notesZh: "", notesEn: "" });
  // The SSH config in the test env is unreachable (127.0.0.1:1). Failing with
  // the notes error — and not an SSH error — proves the script stops before
  // any upload, state write, or manifest replacement.
  assert.match(String(error.stderr), /Release notes are required for a new desktop release/);
  assert.doesNotMatch(String(error.stderr), /SSH|ssh/);
  assert.equal(
    fs.readFileSync(stateFile, "utf8"),
    "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n",
    "state file must not change when notes are missing",
  );
});

test("Case 3: a new rc.16 release with only zh notes fails", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n");

  const error = runScriptExpectFailure({ sourceDir: root, stateFile, notesZh: "只有中文", notesEn: "" });
  assert.match(String(error.stderr), /Release notes are required for a new desktop release/);
});

test("Case 4: a new rc.16 release with only en notes (or blank zh) fails", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n");

  const onlyEn = runScriptExpectFailure({ sourceDir: root, stateFile, notesZh: "", notesEn: "Only English" });
  assert.match(String(onlyEn.stderr), /Release notes are required for a new desktop release/);

  const blankZh = runScriptExpectFailure({ sourceDir: root, stateFile, notesZh: "   ", notesEn: "Only English" });
  assert.match(String(blankZh.stderr), /Release notes are required for a new desktop release/);
});

test("Case 5: a new rc.16 release with explicit bilingual notes passes dry-run and reaches the writer", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const { manifest } = runDryRun({
    sourceDir: root,
    stateFile,
    notesZh: FIXTURE_NOTES_ZH,
    notesEn: FIXTURE_NOTES_EN,
  });

  assert.equal(manifest.version, "0.2.1-rc.16");
  assert.equal(manifest.notes.zh, FIXTURE_NOTES_ZH, "fixture zh notes flow from env into the canonical writer");
  assert.equal(manifest.notes.en, FIXTURE_NOTES_EN);
  assert.deepEqual(Object.keys(manifest.platforms), ["macos"]);
  assert.equal("artifacts" in manifest, false);
});

test("Case 6: previous-release notes are never silently inherited for a new release", () => {
  const { root } = makeSourceTree({ macVersion: "0.2.1-rc.16" });
  const stateDir = makeTempDir("mosa-state.");
  const stateFile = path.join(stateDir, "state");
  fs.writeFileSync(stateFile, "0.2.1-rc.15|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|none\n");

  const previous = {
    version: "0.2.1-rc.15",
    publishedAt: "2026-09-19T00:09:34Z",
    notes: {
      zh: "MOSA 0.2.1-rc.15 桌面测试发布包。新增 macOS 应用内自更新链路。",
      en: "MOSA 0.2.1-rc.15 desktop test release. Adds the macOS in-app self-update pipeline.",
    },
    platforms: {
      macos: {
        platform: "macOS",
        arch: "arm64",
        file: "MOSA-darwin-arm64-0.2.1-rc.15.zip",
        size: 128358577,
        sha256: "6f1de34996d776ff4bcf48655f5bc314504c2ecb2f8e0edec63650b234067098",
      },
    },
  };
  const previousPath = path.join(root, "previous-latest.json");
  fs.writeFileSync(previousPath, JSON.stringify(previous, null, 2));

  // The previous manifest carries rich notes, but the new release provides
  // none: the script must fail instead of letting the writer inherit them.
  const error = runScriptExpectFailure({ sourceDir: root, stateFile, previousManifest: previousPath });
  assert.match(String(error.stderr), /Release notes are required for a new desktop release/);
});

test("Case 7: the legacy default-notes copy no longer exists in the release script", () => {
  const scriptSource = fs.readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(scriptSource, /:-\s*MOSA \$\{release_version\}/, "no default-expansion fallback for notes");
  assert.doesNotMatch(scriptSource, /桌面发布包/, "legacy default zh copy is gone");
  assert.doesNotMatch(scriptSource, /desktop package\./, "legacy default en copy is gone");
  assert.match(scriptSource, /Release notes are required for a new desktop release/, "fail-closed error is present");
  assert.match(scriptSource, /prepare-desktop-release-manifest\.mjs/, "canonical writer remains the only writer");
  assert.doesNotMatch(scriptSource, /artifacts\s*:\s*\{/, "the legacy artifacts.* schema key must not come back");
});
