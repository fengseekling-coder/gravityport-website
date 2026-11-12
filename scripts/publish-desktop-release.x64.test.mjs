// Tests for the Intel (darwin-x64) side of publish-desktop-release.sh (388):
// the optional Intel ZIP/DMG sources, the monitor wait rule ("any Intel file
// for the selected version means wait for both"), the
// MOSA_RELEASE_REQUIRE_MAC_X64 guard, the release signature, the macosX64
// manifest entry and the Intel retention columns — plus the "Intel without
// Apple silicon" configuration error.
//
// The Intel manifest entry needs a canonical writer that knows --mac-x64, so
// these tests drive the writer from an Intel-capable app checkout (see
// resolveMacX64SourceRoot). CI excludes this file; it runs at release time
// next to that checkout, like the other publisher tests.

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeS3, TEST_SECRET_ACCESS_KEY, TEST_ACCESS_KEY_ID } from "./r2-client.test.mjs";
import { createWriterHarness, resolveMacX64SourceRoot } from "./publish-desktop-release.test-helpers.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = new URL("./publish-desktop-release.sh", import.meta.url).pathname;
const macX64SourceRoot = resolveMacX64SourceRoot();

// A second writer harness on the 387 checkout: this writer supports
// --mac-x64 and requires a team identifier for the macOS entries.
const x64WriterHarness = await createWriterHarness({
  canonicalWriter: path.join(macX64SourceRoot, "scripts/prepare-desktop-release-manifest.mjs"),
});
const x64WriterPath = x64WriterHarness.writerPath;
const FIXTURE_GIT_SHA = x64WriterHarness.buildIdentity.gitSha;
const FIXTURE_TEAM_ID = "TESTTEAMID";
const FIXTURE_NOTES_ZH = "388 乙段测试：显式中文发布说明。";
const FIXTURE_NOTES_EN = "388乙 publisher test: explicit English release notes.";

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

// Fixture out/make tree. Arm64 update ZIP is always present; everything Intel
// is optional and placed under the default darwin/x64 directories.
function makeSourceTree({ macVersion = "0.3.9", windowsVersion = null, withIntelZip = false, withIntelDmg = false, withDmg = false, explicitIntel = false } = {}) {
  const root = path.join(makeTempDir("mosa-x64-repo."), "out", "make");
  fs.mkdirSync(root, { recursive: true });

  const macZip = makeZipFixture(root, ["GravityPort.app/Contents/MacOS/GravityPort"]);
  const updateDir = path.join(root, "update", "darwin", "arm64");
  fs.mkdirSync(updateDir, { recursive: true });
  const macPath = path.join(updateDir, `GravityPort-darwin-arm64-${macVersion}.zip`);
  fs.renameSync(macZip, macPath);

  let windowsPath = null;
  if (windowsVersion) {
    const windowsZip = makeZipFixture(root, ["GravityPort.exe"]);
    const windowsDir = path.join(root, "zip", "win32", "x64");
    fs.mkdirSync(windowsDir, { recursive: true });
    windowsPath = path.join(windowsDir, `GravityPort-win32-x64-${windowsVersion}.zip`);
    fs.renameSync(windowsZip, windowsPath);
  }

  let macX64ZipPath = null;
  if (withIntelZip) {
    const intelZip = makeZipFixture(root, ["GravityPort.app/Contents/MacOS/GravityPort"]);
    const intelUpdateDir = path.join(root, "update", "darwin", "x64");
    fs.mkdirSync(intelUpdateDir, { recursive: true });
    macX64ZipPath = path.join(intelUpdateDir, `GravityPort-darwin-x64-${macVersion}.zip`);
    fs.renameSync(intelZip, macX64ZipPath);
    if (explicitIntel) {
      const stashDir = makeTempDir("mosa-x64-stash.");
      const stashed = path.join(stashDir, path.basename(macX64ZipPath));
      fs.renameSync(macX64ZipPath, stashed);
      macX64ZipPath = stashed;
    }
  }

  const makeDmg = (dmgDir, dmgName) => {
    fs.mkdirSync(dmgDir, { recursive: true });
    const dmgPath = path.join(dmgDir, dmgName);
    const scratch = makeTempDir("mosa-x64-dmg.");
    execFileSync("hdiutil", ["create", "-size", "1m", "-fs", "HFS+", "-volname", "X64Probe", "-quiet", "probe.dmg"], { cwd: scratch });
    execFileSync("hdiutil", ["convert", "probe.dmg", "-format", "UDZO", "-o", dmgPath, "-quiet"], { cwd: scratch });
    fs.rmSync(scratch, { recursive: true, force: true });
    return dmgPath;
  };

  let macX64DmgPath = null;
  if (withIntelDmg) {
    macX64DmgPath = makeDmg(path.join(root, "dmg", "darwin", "x64"), `GravityPort-darwin-x64-${macVersion}.dmg`);
    if (explicitIntel) {
      const stashed = path.join(makeTempDir("mosa-x64-stash."), path.basename(macX64DmgPath));
      fs.renameSync(macX64DmgPath, stashed);
      macX64DmgPath = stashed;
    }
  }

  let dmgPath = null;
  if (withDmg) {
    dmgPath = makeDmg(path.join(root, "dmg", "darwin", "arm64"), `GravityPort-darwin-arm64-${macVersion}.dmg`);
    const identityDir = path.join(root, "..", "..", "web", "gravityport", "dist");
    fs.mkdirSync(identityDir, { recursive: true });
    fs.writeFileSync(path.join(identityDir, "build-identity.json"), `${JSON.stringify({
      productVersion: macVersion,
      gitSha: FIXTURE_GIT_SHA,
    }, null, 2)}\n`);
  }

  return { root, macPath, macX64ZipPath, macX64DmgPath, dmgPath };
}

const MANAGED_ENV_KEYS = [
  "MOSA_RELEASE_SOURCE_DIR",
  "MOSA_RELEASE_STATE_FILE",
  "MOSA_RELEASE_MANIFEST_WRITER",
  "MOSA_RELEASE_PREVIOUS_MANIFEST",
  "MOSA_RELEASE_DRY_RUN_OUTPUT",
  "MOSA_RELEASE_PUBLISHED_AT",
  "MOSA_RELEASE_PRODUCT",
  "MOSA_RELEASE_NOTES_ZH",
  "MOSA_RELEASE_NOTES_EN",
  "MOSA_RELEASE_TARGETS",
  "MOSA_RELEASE_R2_ENDPOINT",
  "MOSA_RELEASE_R2_BUCKET",
  "MOSA_RELEASE_R2_ACCESS_KEY_ID",
  "MOSA_RELEASE_R2_SECRET_ACCESS_KEY",
  "MOSA_RELEASE_CONFIG",
  "MOSA_RELEASE_MAC_X64_ZIP",
  "MOSA_RELEASE_MAC_X64_DMG",
  "MOSA_RELEASE_REQUIRE_MAC_X64",
  "MOSA_RELEASE_MAC_TEAM_IDENTIFIER",
];

function buildEnv({ sourceDir, stateFile, r2Endpoint, dryRunOutput, extraEnv = {} }) {
  const env = { ...process.env };
  for (const key of MANAGED_ENV_KEYS) delete env[key];
  env.MOSA_RELEASE_CONFIG = path.join(os.tmpdir(), "mosa-x64-test-no-release.env");
  env.MOSA_RELEASE_SOURCE_DIR = sourceDir;
  env.MOSA_RELEASE_STATE_FILE = stateFile;
  env.MOSA_RELEASE_MANIFEST_WRITER = x64WriterPath;
  env.MOSA_RELEASE_PUBLISHED_AT = "2026-11-12T01:00:00Z";
  env.MOSA_RELEASE_PRODUCT = "GravityPort";
  env.MOSA_RELEASE_NOTES_ZH = FIXTURE_NOTES_ZH;
  env.MOSA_RELEASE_NOTES_EN = FIXTURE_NOTES_EN;
  if (dryRunOutput) env.MOSA_RELEASE_DRY_RUN_OUTPUT = dryRunOutput;
  // The 387 writer pins both macOS entries to the same team identifier.
  env.MOSA_RELEASE_MAC_TEAM_IDENTIFIER = FIXTURE_TEAM_ID;
  env.MOSA_RELEASE_TARGETS = "r2";
  if (r2Endpoint) {
    env.MOSA_RELEASE_R2_ENDPOINT = r2Endpoint;
    env.MOSA_RELEASE_R2_BUCKET = "test-bucket";
    env.MOSA_RELEASE_R2_ACCESS_KEY_ID = TEST_ACCESS_KEY_ID;
    env.MOSA_RELEASE_R2_SECRET_ACCESS_KEY = TEST_SECRET_ACCESS_KEY;
  } else {
    env.MOSA_RELEASE_R2_ENDPOINT = "http://127.0.0.1:1";
    env.MOSA_RELEASE_R2_BUCKET = "test-bucket";
    env.MOSA_RELEASE_R2_ACCESS_KEY_ID = "x64-test-access-key-id";
    env.MOSA_RELEASE_R2_SECRET_ACCESS_KEY = "x64-test-secret";
  }
  return { ...env, ...extraEnv };
}

async function runScript(env, args = []) {
  return execFileAsync("bash", [scriptPath, ...args], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

async function runScriptExpectFailure(env, args = []) {
  let caught = null;
  try {
    await execFileAsync("bash", [scriptPath, ...args], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the publish script to fail");
  return caught;
}

function seedPreviousManifestOnR2(fake, version = "0.3.8") {
  fake.putObject("releases/gravityport/latest.json", `${JSON.stringify({
    version,
    publishedAt: "2026-11-01T00:00:00.000Z",
    notes: { zh: "旧版本", en: "old" },
    platforms: {
      macos: { platform: "macOS", arch: "arm64", appName: "GravityPort.app", file: `GravityPort-darwin-arm64-${version}.zip`, size: 1, sha256: "c".repeat(64) },
    },
  }, null, 2)}\n`);
}

test("dry-run with Intel packages passes and the manifest carries platforms.macosX64", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root, macPath, macX64ZipPath } = makeSourceTree({
    macVersion: "0.3.9",
    withIntelZip: true,
    withIntelDmg: true,
    withDmg: true,
  });
  t.after(() => fs.rmSync(path.join(root, "..", "..", "web"), { recursive: true, force: true }));
  const stagedManifest = path.join(work, "staged-latest.json");

  const { stdout } = await runScript(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    dryRunOutput: stagedManifest,
  }), ["--dry-run"]);

  assert.match(stdout, /downloads\/GravityPort-darwin-x64-0\.3\.9\.zip/);
  assert.match(stdout, /downloads\/GravityPort-darwin-x64-0\.3\.9\.dmg/);
  const manifest = JSON.parse(fs.readFileSync(stagedManifest, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["macos", "macosX64"]);
  assert.equal(manifest.platforms.macosX64.platform, "macOS");
  assert.equal(manifest.platforms.macosX64.arch, "x64");
  assert.equal(manifest.platforms.macosX64.file, "GravityPort-darwin-x64-0.3.9.zip");
  assert.equal(manifest.platforms.macosX64.size, fs.statSync(macX64ZipPath).size);
  assert.equal(manifest.platforms.macosX64.sha256, sha256File(macX64ZipPath));
  assert.equal(manifest.platforms.macosX64.appName, "GravityPort.app");
  assert.equal(manifest.platforms.macos.sha256, sha256File(macPath));
});

test("dry-run without Intel packages stays the Apple-silicon-only release", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9" });
  const stagedManifest = path.join(work, "staged-latest.json");

  const { stdout } = await runScript(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    dryRunOutput: stagedManifest,
  }), ["--dry-run"]);

  assert.doesNotMatch(stdout, /darwin-x64/, "no Intel package is staged or listed");
  const manifest = JSON.parse(fs.readFileSync(stagedManifest, "utf8"));
  assert.deepEqual(Object.keys(manifest.platforms), ["macos"]);
});

test("an Intel ZIP alone keeps the monitor waiting for the Intel DMG", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9", withIntelZip: true });

  const error = await runScriptExpectFailure(buildEnv({ sourceDir: root, stateFile: path.join(work, "state") }), ["--dry-run"]);
  assert.match(String(error.stdout), /macOS Intel DMG 仍在生成/);
});

test("an Intel DMG alone keeps the monitor waiting for the Intel ZIP", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9", withIntelDmg: true });

  const error = await runScriptExpectFailure(buildEnv({ sourceDir: root, stateFile: path.join(work, "state") }), ["--dry-run"]);
  assert.match(String(error.stdout), /macOS Intel 安装包仍在生成/);
});

test("an Intel-only source tree fails loudly instead of skipping", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  // The arm64 update directory exists but holds no Apple silicon ZIP: only
  // the Intel files exist, which must fail instead of quietly skipping.
  const root = path.join(makeTempDir("mosa-x64-only."), "out", "make");
  fs.mkdirSync(path.join(root, "update", "darwin", "arm64"), { recursive: true });
  fs.mkdirSync(path.join(root, "update", "darwin", "x64"), { recursive: true });
  fs.writeFileSync(path.join(root, "update", "darwin", "x64", "GravityPort-darwin-x64-0.3.9.zip"), "placeholder");

  const error = await runScriptExpectFailure(buildEnv({ sourceDir: root, stateFile: path.join(work, "state") }), ["--dry-run"]);
  assert.match(String(error.stderr), /缺少苹果芯片（arm64）包/);
});

test("MOSA_RELEASE_REQUIRE_MAC_X64=1 dies when the Intel ZIP is missing", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9", withIntelDmg: true });

  const error = await runScriptExpectFailure(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    extraEnv: { MOSA_RELEASE_REQUIRE_MAC_X64: "1" },
  }), ["--dry-run"]);
  assert.match(String(error.stderr), /MOSA_RELEASE_REQUIRE_MAC_X64=1 but the macOS Intel update ZIP is missing/);
});

test("MOSA_RELEASE_REQUIRE_MAC_X64=1 dies when the Intel DMG is missing", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9", withIntelZip: true });

  const error = await runScriptExpectFailure(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    extraEnv: { MOSA_RELEASE_REQUIRE_MAC_X64: "1" },
  }), ["--dry-run"]);
  assert.match(String(error.stderr), /MOSA_RELEASE_REQUIRE_MAC_X64=1 but the macOS Intel DMG is missing/);
});

test("MOSA_RELEASE_REQUIRE_MAC_X64 rejects values other than 1", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9" });

  const error = await runScriptExpectFailure(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    extraEnv: { MOSA_RELEASE_REQUIRE_MAC_X64: "true" },
  }), ["--dry-run"]);
  assert.match(String(error.stderr), /MOSA_RELEASE_REQUIRE_MAC_X64 must be unset or 1/);
});

test("explicit MOSA_RELEASE_MAC_X64_ZIP/DMG sources win over the default directories", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const stagedManifest = path.join(work, "staged-latest.json");
  const { root, macX64ZipPath, macX64DmgPath } = makeSourceTree({
    macVersion: "0.3.9",
    withIntelZip: true,
    withIntelDmg: true,
    withDmg: true,
    explicitIntel: true,
  });
  t.after(() => fs.rmSync(path.join(root, "..", "..", "web"), { recursive: true, force: true }));

  const { stdout } = await runScript(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    dryRunOutput: stagedManifest,
    extraEnv: {
      MOSA_RELEASE_MAC_X64_ZIP: macX64ZipPath,
      MOSA_RELEASE_MAC_X64_DMG: macX64DmgPath,
    },
  }), ["--dry-run"]);

  assert.match(stdout, /downloads\/GravityPort-darwin-x64-0\.3\.9\.zip/);
  const manifest = JSON.parse(fs.readFileSync(stagedManifest, "utf8"));
  assert.equal(manifest.platforms.macosX64.sha256, sha256File(macX64ZipPath));
});

test("a configured-but-missing Intel source is an error", async (t) => {
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const { root } = makeSourceTree({ macVersion: "0.3.9" });

  const error = await runScriptExpectFailure(buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    extraEnv: { MOSA_RELEASE_MAC_X64_ZIP: "/nonexistent/GravityPort-darwin-x64-0.3.9.zip" },
  }), ["--dry-run"]);
  assert.match(String(error.stderr), /macOS Intel \(x64\) release candidate is incomplete/);
});

test("the release signature carries the Intel package digests after a real publish", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  seedPreviousManifestOnR2(fake, "0.3.8");

  const { root, macX64ZipPath, macX64DmgPath } = makeSourceTree({
    macVersion: "0.3.9",
    withIntelZip: true,
    withIntelDmg: true,
    withDmg: true,
  });
  t.after(() => fs.rmSync(path.join(root, "..", "..", "web"), { recursive: true, force: true }));
  const stateFile = path.join(work, "state");

  await runScript(buildEnv({ sourceDir: root, stateFile, r2Endpoint: fake.endpoint }));

  const state = fs.readFileSync(stateFile, "utf8").trim();
  assert.match(state, /x64zip:/, "the Intel ZIP digest entered the release signature");
  assert.match(state, /x64dmg:/, "the Intel DMG digest entered the release signature");
  assert.ok(state.includes(`x64zip:${sha256File(macX64ZipPath)}`));
  assert.ok(state.includes(`x64dmg:${sha256File(macX64DmgPath)}`));

  const manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["macos", "macosX64"]);
  assert.ok(fake.objects.has("downloads/GravityPort-darwin-x64-0.3.9.zip"), "the Intel ZIP reached R2");
  assert.ok(fake.objects.has("downloads/GravityPort-darwin-x64-0.3.9.dmg"), "the Intel DMG reached R2");
});

test("R2 retention prunes stale Intel files with their version and never the current one", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-x64-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  // Five old complete versions (0.3.4–0.3.8), the oldest two with Intel
  // files; publishing 0.3.9 makes six versions, keep=4 prunes 0.3.4 and 0.3.5.
  for (let minor = 4; minor <= 8; minor += 1) {
    fake.putObject(`downloads/GravityPort-darwin-arm64-0.3.${minor}.zip`, `mac ${minor}`);
    fake.putObject(`downloads/GravityPort-win32-x64-0.3.${minor}.zip`, `win ${minor}`);
    if (minor <= 5) {
      fake.putObject(`downloads/GravityPort-darwin-x64-0.3.${minor}.zip`, `intel zip ${minor}`);
      fake.putObject(`downloads/GravityPort-darwin-x64-0.3.${minor}.dmg`, `intel dmg ${minor}`);
    }
  }
  seedPreviousManifestOnR2(fake, "0.3.8");

  const { root } = makeSourceTree({
    macVersion: "0.3.9",
    windowsVersion: "0.3.9",
    withIntelZip: true,
    withIntelDmg: true,
    withDmg: true,
  });
  t.after(() => fs.rmSync(path.join(root, "..", "..", "web"), { recursive: true, force: true }));

  await runScript(buildEnv({ sourceDir: root, stateFile: path.join(work, "state"), r2Endpoint: fake.endpoint }));

  for (const key of [
    "downloads/GravityPort-darwin-x64-0.3.4.zip",
    "downloads/GravityPort-darwin-x64-0.3.4.dmg",
    "downloads/GravityPort-darwin-x64-0.3.5.zip",
    "downloads/GravityPort-darwin-x64-0.3.5.dmg",
    "downloads/GravityPort-darwin-arm64-0.3.4.zip",
    "downloads/GravityPort-win32-x64-0.3.5.zip",
  ]) {
    assert.equal(fake.objects.has(key), false, `${key} went with its version`);
  }
  for (const key of [
    // 0.3.6 sits at the edge of the retention window and shipped no Intel
    // packages; its arm64/Windows files stay.
    "downloads/GravityPort-darwin-arm64-0.3.6.zip",
    "downloads/GravityPort-win32-x64-0.3.6.zip",
    "downloads/GravityPort-darwin-arm64-0.3.9.zip",
    "downloads/GravityPort-darwin-x64-0.3.9.zip",
    "downloads/GravityPort-darwin-x64-0.3.9.dmg",
  ]) {
    assert.ok(fake.objects.has(key), `${key} stays inside the retention window (the current release's Intel files are never pruned)`);
  }
});
