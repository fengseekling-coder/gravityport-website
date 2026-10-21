import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWriterHarness } from "./publish-desktop-release.test-helpers.mjs";

const scriptPath = new URL("./publish-desktop-release.sh", import.meta.url).pathname;
const writerHarness = await createWriterHarness();
const writerPath = writerHarness.writerPath;
// The writer harness signs with this fixture identity, so a DMG release run
// must find the same gitSha in the packaged identity file.
const FIXTURE_GIT_SHA = writerHarness.buildIdentity.gitSha;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

// Builds a fake out/make source tree for one product. nested=true mirrors the
// electron-builder layout that wraps the payload in a product directory.
function makeSourceTree({ product = "MOSA", macVersion = "0.3.0", windowsVersion = null, nested = false, wrongMacPayload = false, wrongWindowsPayload = false } = {}) {
  const root = makeTempDir("mosa-release-src.");
  const macAppName = `${product}.app`;
  const macPayloadApp = wrongMacPayload ? "MOSA.app" : macAppName;
  const macPayloadExe = macPayloadApp.slice(0, -4);
  const macEntries = nested
    ? [`${product}-darwin-arm64/${macPayloadApp}/Contents/MacOS/${macPayloadExe}`]
    : [`${macPayloadApp}/Contents/MacOS/${macPayloadExe}`];
  const macZip = makeZipFixture(root, macEntries);
  const updateDir = path.join(root, "update", "darwin", "arm64");
  fs.mkdirSync(updateDir, { recursive: true });
  const macPath = path.join(updateDir, `${product}-darwin-arm64-${macVersion}.zip`);
  fs.renameSync(macZip, macPath);

  let windowsPath = null;
  if (windowsVersion) {
    const windowsPayloadExe = wrongWindowsPayload ? "MOSA.exe" : `${product}.exe`;
    const windowsZip = makeZipFixture(root, [windowsPayloadExe]);
    const windowsDir = path.join(root, "zip", "win32", "x64");
    fs.mkdirSync(windowsDir, { recursive: true });
    windowsPath = path.join(windowsDir, `${product}-win32-x64-${windowsVersion}.zip`);
    fs.renameSync(windowsZip, windowsPath);
  }
  return { root, macPath, windowsPath };
}

const NOTES_ZH = "产品化发布测试：显式中文发布说明。";
const NOTES_EN = "Productized release test: explicit English release notes.";

function safeEnv({ sourceDir, stateFile, previousManifest = "", dryRunOutput = "", product } = {}) {
  const env = {
    ...process.env,
    MOSA_RELEASE_SOURCE_DIR: sourceDir,
    MOSA_RELEASE_STATE_FILE: stateFile,
    MOSA_RELEASE_MANIFEST_WRITER: writerPath,
    MOSA_RELEASE_PREVIOUS_MANIFEST: previousManifest,
    MOSA_RELEASE_DRY_RUN_OUTPUT: dryRunOutput,
    MOSA_RELEASE_PUBLISHED_AT: "2026-10-10T01:00:00Z",
    MOSA_RELEASE_NOTES_ZH: NOTES_ZH,
    MOSA_RELEASE_NOTES_EN: NOTES_EN,
    MOSA_RELEASE_SSH_HOST: "127.0.0.1",
    MOSA_RELEASE_SSH_PORT: "1",
    MOSA_RELEASE_SSH_USER: "mosa-test",
    MOSA_RELEASE_SSH_KEY: path.join(os.tmpdir(), "mosa-test-nonexistent-key"),
    MOSA_RELEASE_KNOWN_HOSTS: path.join(os.tmpdir(), "mosa-test-nonexistent-known-hosts"),
    MOSA_RELEASE_REMOTE_DIR: "/var/www/mosa-website",
  };
  // Only set the variable when the test asks for it: an absent variable is
  // the "product unset" mode the script must keep byte-compatible.
  if (product !== undefined) env.MOSA_RELEASE_PRODUCT = product;
  return env;
}

function runDryRun({ sourceDir, stateFile, previousManifest = "", product } = {}) {
  const outputDir = makeTempDir("mosa-release-run.");
  const outputPath = path.join(outputDir, "staged-latest.json");
  execFileSync("bash", [scriptPath, "--dry-run"], {
    env: safeEnv({ sourceDir, stateFile, previousManifest, dryRunOutput: outputPath, product }),
    encoding: "utf8",
  });
  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

function runScriptExpectFailure({ sourceDir, stateFile, product } = {}) {
  let caught = null;
  try {
    execFileSync("bash", [scriptPath], {
      env: safeEnv({ sourceDir, stateFile, product }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the publish script to fail");
  return caught;
}

test("GravityPort dry-run emits GravityPort file names, appName and payloadExeName", () => {
  const { root, macPath, windowsPath } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0", windowsVersion: "0.3.0" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const manifest = runDryRun({ sourceDir: root, stateFile, product: "GravityPort" });

  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.platforms.macos.file, "GravityPort-darwin-arm64-0.3.0.zip");
  assert.equal(manifest.platforms.macos.size, fs.statSync(macPath).size);
  assert.equal(manifest.platforms.macos.appName, "GravityPort.app");
  assert.equal(manifest.platforms.windows.file, "GravityPort-win32-x64-0.3.0.zip");
  assert.equal(manifest.platforms.windows.payloadExeName, "GravityPort.exe");
  assert.equal(manifest.platforms.windows.sha256, execFileSync("shasum", ["-a", "256", windowsPath]).toString().split(" ")[0]);
  assert.equal("artifacts" in manifest, false);
});

test("GravityPort dry-run consumes a previous manifest staged from the new source", () => {
  const { root } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  // Stands in for releases/gravityport/latest.json fetched from the server:
  // the remote path itself is pinned by the source-level test below because a
  // dry-run never contacts the server.
  const previous = {
    version: "0.2.1",
    publishedAt: "2026-10-01T00:00:00.000Z",
    notes: { zh: "旧版说明", en: "old notes" },
    platforms: {
      macos: {
        platform: "macOS",
        arch: "arm64",
        appName: "GravityPort.app",
        file: "GravityPort-darwin-arm64-0.2.1.zip",
        size: 3,
        sha256: "c".repeat(64),
      },
    },
    visualPacks: {
      "siglip2-int8": { version: "1.2.0", size: 378, sha256: "d".repeat(64), url: "https://mosa.azhuilab.com/downloads/pack.mosa-pack" },
    },
  };
  const previousPath = path.join(root, "gravityport-previous-latest.json");
  fs.writeFileSync(previousPath, JSON.stringify(previous, null, 2));

  const manifest = runDryRun({ sourceDir: root, stateFile, previousManifest: previousPath, product: "GravityPort" });
  assert.deepEqual(manifest.visualPacks, previous.visualPacks, "visualPacks must be inherited from the previous new-source manifest");
  assert.equal(manifest.notes.zh, NOTES_ZH, "previous notes must never be inherited silently");
});

test("product unset and product=MOSA produce byte-identical dry-run manifests", () => {
  const { root } = makeSourceTree({ product: "MOSA", macVersion: "0.2.1-rc.35" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");

  const runOnce = (product) => {
    const outputDir = makeTempDir("mosa-release-run.");
    const outputPath = path.join(outputDir, "staged-latest.json");
    execFileSync("bash", [scriptPath, "--dry-run"], {
      env: safeEnv({ sourceDir: root, stateFile, dryRunOutput: outputPath, product }),
      encoding: "utf8",
    });
    return fs.readFileSync(outputPath);
  };
  const unsetBytes = runOnce(undefined);
  const explicitBytes = runOnce("MOSA");

  assert.equal(Buffer.compare(unsetBytes, explicitBytes), 0, "unset product must reproduce the MOSA manifest byte for byte");
  const manifest = JSON.parse(unsetBytes.toString("utf8"));
  assert.equal(manifest.version, "0.2.1-rc.35");
  assert.equal(manifest.platforms.macos.file, "MOSA-darwin-arm64-0.2.1-rc.35.zip");
  assert.equal(manifest.platforms.macos.appName, "MOSA.app");
});

test("an unsupported MOSA_RELEASE_PRODUCT value fails before anything else", () => {
  const { root } = makeSourceTree({ product: "MOSA" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const error = runScriptExpectFailure({ sourceDir: root, stateFile, product: "Fedora" });
  assert.match(String(error.stderr), /MOSA_RELEASE_PRODUCT must be "MOSA" or "GravityPort"/);
});

test("a GravityPort run pointed at MOSA-only sources fails with a clear product mismatch", () => {
  const { root } = makeSourceTree({ product: "MOSA", macVersion: "0.2.1-rc.35" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const error = runScriptExpectFailure({ sourceDir: root, stateFile, product: "GravityPort" });
  assert.match(String(error.stderr), /只发现 MOSA 的 macOS 更新包/);
  assert.match(String(error.stderr), /MOSA_RELEASE_PRODUCT=GravityPort/);
  assert.doesNotMatch(String(error.stderr), /未发现新的 macOS 更新 ZIP/);
});

test("a MOSA run pointed at GravityPort-only sources fails with a clear product mismatch", () => {
  const { root } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const error = runScriptExpectFailure({ sourceDir: root, stateFile });
  assert.match(String(error.stderr), /只发现 GravityPort 的 macOS 更新包/);
  assert.match(String(error.stderr), /MOSA_RELEASE_PRODUCT=MOSA/);
});

test("a GravityPort zip that still carries MOSA.app is rejected", () => {
  const { root } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0", wrongMacPayload: true });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const error = runScriptExpectFailure({ sourceDir: root, stateFile, product: "GravityPort" });
  assert.match(String(error.stderr), /macOS ZIP does not contain GravityPort\.app/);
});

test("a GravityPort zip that still carries MOSA.exe is rejected", () => {
  const { root } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0", windowsVersion: "0.3.0", wrongWindowsPayload: true });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const error = runScriptExpectFailure({ sourceDir: root, stateFile, product: "GravityPort" });
  assert.match(String(error.stderr), /Windows ZIP does not contain GravityPort\.exe/);
});

test("the nested GravityPort payload layout is accepted", () => {
  const { root } = makeSourceTree({ product: "GravityPort", macVersion: "0.3.0", nested: true });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const manifest = runDryRun({ sourceDir: root, stateFile, product: "GravityPort" });
  assert.equal(manifest.platforms.macos.file, "GravityPort-darwin-arm64-0.3.0.zip");
});

test("packaged build identity is read from web/app/build-identity.json", (t) => {
  const version = "0.2.1-rc.35";
  // makeSourceTree root doubles as out/make, so the script derives the
  // repository root as root/../.. and must find the identity in web/app there.
  // The legacy app/build-identity.json location is deliberately absent so
  // reading it could only fail.
  const { root } = makeSourceTree({ product: "MOSA", macVersion: version });
  const dmgDir = path.join(root, "dmg", "darwin", "arm64");
  fs.mkdirSync(dmgDir, { recursive: true });
  const dmgPath = path.join(dmgDir, `MOSA-darwin-arm64-${version}.dmg`);
  const scratch = makeTempDir("mosa-dmg-fixture.");
  execFileSync("hdiutil", ["create", "-size", "1m", "-fs", "HFS+", "-volname", "MOSAProbe", "-quiet", "probe.dmg"], { cwd: scratch });
  execFileSync("hdiutil", ["convert", "probe.dmg", "-format", "UDZO", "-o", dmgPath, "-quiet"], { cwd: scratch });
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  const identityDir = path.join(root, "..", "..", "web", "app");
  fs.mkdirSync(identityDir, { recursive: true });
  fs.writeFileSync(path.join(identityDir, "build-identity.json"), `${JSON.stringify({
    productVersion: version,
    gitSha: FIXTURE_GIT_SHA,
  }, null, 2)}\n`);

  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const manifest = runDryRun({ sourceDir: root, stateFile, product: "MOSA" });
  assert.equal(manifest.version, version);
  assert.equal(manifest.gitSha, FIXTURE_GIT_SHA, "the DMG extension must stamp the identity gitSha");
});

test("packaged build identity is read from web/gravityport/dist/build-identity.json", (t) => {
  const version = "0.2.1-rc.35";
  // makeSourceTree root doubles as out/make, so the script derives the
  // repository root as root/../.. and must find the identity in web/gravityport/dist there.
  // The legacy app/build-identity.json location is deliberately absent so
  // reading it could only fail.
  const { root } = makeSourceTree({ product: "MOSA", macVersion: version });
  const dmgDir = path.join(root, "dmg", "darwin", "arm64");
  fs.mkdirSync(dmgDir, { recursive: true });
  const dmgPath = path.join(dmgDir, `MOSA-darwin-arm64-${version}.dmg`);
  const scratch = makeTempDir("mosa-dmg-fixture.");
  execFileSync("hdiutil", ["create", "-size", "1m", "-fs", "HFS+", "-volname", "MOSAProbe", "-quiet", "probe.dmg"], { cwd: scratch });
  execFileSync("hdiutil", ["convert", "probe.dmg", "-format", "UDZO", "-o", dmgPath, "-quiet"], { cwd: scratch });
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  const identityDir = path.join(root, "..", "..", "web", "gravityport", "dist");
  fs.mkdirSync(identityDir, { recursive: true });
  fs.writeFileSync(path.join(identityDir, "build-identity.json"), `${JSON.stringify({
    productVersion: version,
    gitSha: FIXTURE_GIT_SHA,
  }, null, 2)}\n`);

  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const manifest = runDryRun({ sourceDir: root, stateFile, product: "MOSA" });
  assert.equal(manifest.version, version);
  assert.equal(manifest.gitSha, FIXTURE_GIT_SHA, "the DMG extension must stamp the identity gitSha");
});

test("an explicitly configured DMG must carry the release product and version in its name", (t) => {
  const version = "0.2.1-rc.35";
  const { root } = makeSourceTree({ product: "MOSA", macVersion: version });
  const scratch = makeTempDir("mosa-dmg-fixture.");
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  // A valid image under the other product's name and another version: only
  // the file name is wrong, so nothing but the name check can reject it.
  const dmgPath = path.join(scratch, "GravityPort-darwin-arm64-9.9.9.dmg");
  execFileSync("hdiutil", ["create", "-size", "1m", "-fs", "HFS+", "-volname", "MOSAProbe", "-quiet", "probe.dmg"], { cwd: scratch });
  execFileSync("hdiutil", ["convert", "probe.dmg", "-format", "UDZO", "-o", dmgPath, "-quiet"], { cwd: scratch });

  const identityDir = path.join(root, "..", "..", "web", "app");
  fs.mkdirSync(identityDir, { recursive: true });
  fs.writeFileSync(path.join(identityDir, "build-identity.json"), `${JSON.stringify({
    productVersion: version,
    gitSha: FIXTURE_GIT_SHA,
  }, null, 2)}\n`);

  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const outputPath = path.join(makeTempDir("mosa-release-run."), "staged-latest.json");
  let caught = null;
  try {
    execFileSync("bash", [scriptPath, "--dry-run"], {
      env: { ...safeEnv({ sourceDir: root, stateFile, dryRunOutput: outputPath }), MOSA_RELEASE_MAC_DMG: dmgPath },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "a misnamed DMG must stop the release");
  assert.equal(fs.existsSync(outputPath), false, "no manifest may be staged for a misnamed DMG");
});

test("optional signing metadata env vars reach the canonical writer", () => {
  const { root } = makeSourceTree({ product: "MOSA", macVersion: "0.2.1-rc.35", windowsVersion: "0.2.1-rc.35" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const outputDir = makeTempDir("mosa-release-run.");
  const outputPath = path.join(outputDir, "staged-latest.json");
  execFileSync("bash", [scriptPath, "--dry-run"], {
    env: {
      ...safeEnv({ sourceDir: root, stateFile, dryRunOutput: outputPath }),
      MOSA_RELEASE_MAC_TEAM_IDENTIFIER: "ABCDE12345",
      MOSA_RELEASE_WINDOWS_SIGNER_THUMBPRINT: "0123456789abcdef0123456789abcdef01234567",
    },
    encoding: "utf8",
  });
  const manifest = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(manifest.platforms.macos.teamIdentifier, "ABCDE12345");
  assert.equal(manifest.platforms.windows.signerThumbprint, "0123456789ABCDEF0123456789ABCDEF01234567");
});

test("unset signing metadata env vars stay out of the manifest", () => {
  const { root } = makeSourceTree({ product: "MOSA", macVersion: "0.2.1-rc.35", windowsVersion: "0.2.1-rc.35" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  const manifest = runDryRun({ sourceDir: root, stateFile });
  assert.equal("teamIdentifier" in manifest.platforms.macos, false);
  assert.equal("signerThumbprint" in manifest.platforms.windows, false);
});

test("the script pins the GravityPort remote paths and the new build identity path", () => {
  const scriptSource = fs.readFileSync(scriptPath, "utf8");
  assert.match(scriptSource, /releases\/gravityport\/latest\.json/, "GravityPort manifest path");
  assert.match(scriptSource, /releases\/gravityport\/history/, "GravityPort history directory");
  assert.match(scriptSource, /web\/gravityport\/dist\/build-identity\.json/, "build identity lives next to the built UI bundle");
  assert.match(scriptSource, /web\/app\/build-identity\.json/, "the web/app layout is still accepted");
  assert.doesNotMatch(scriptSource, /source_repo_root\/app\/build-identity\.json/, "the legacy app/ identity path must be gone");
  assert.match(scriptSource, /MOSA_RELEASE_PRODUCT must be/, "product validation is fail-closed");
  assert.match(scriptSource, /desktop-release-monitor\.gravityport\.state/, "GravityPort keeps its own last-published state");
});

test("a state file left by the other product would skip the release as a downgrade", () => {
  // Pins why the two products must not share a state file: a newer version
  // recorded by one product silently skips the other product's release.
  const { root } = makeSourceTree({ product: "MOSA", macVersion: "0.2.1-rc.35" });
  const stateFile = path.join(makeTempDir("mosa-state."), "state");
  fs.writeFileSync(stateFile, `0.3.0|${"a".repeat(64)}|none\n`);
  const outputPath = path.join(makeTempDir("mosa-release-run."), "staged-latest.json");
  const stdout = execFileSync("bash", [scriptPath, "--dry-run"], {
    env: safeEnv({ sourceDir: root, stateFile, dryRunOutput: outputPath }),
    encoding: "utf8",
  });
  assert.match(stdout, /跳过降级/);
  assert.equal(fs.existsSync(outputPath), false);
});
