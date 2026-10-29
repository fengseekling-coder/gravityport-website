// Tests for the R2 publication of publish-desktop-release.sh: the default
// target, the r2-only mode, package-before-manifest ordering, R2 retention,
// dry-run and the secret-leak guard — all against the in-process fake S3 from
// r2-client.test.mjs. The old-server target was retired in 279 (C1) and is
// refused up front.
//
// The fake S3 lives inside this test process, so every child that must talk to
// it is spawned asynchronously; a synchronous wait would block the event loop
// and deadlock curl against the fake server.

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeS3, TEST_SECRET_ACCESS_KEY, TEST_ACCESS_KEY_ID } from "./r2-client.test.mjs";
import { createWriterHarness } from "./publish-desktop-release.test-helpers.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = new URL("./publish-desktop-release.sh", import.meta.url).pathname;
const writerHarness = await createWriterHarness();
const writerPath = writerHarness.writerPath;
// The writer harness signs with this fixture identity, so DMG runs must find
// the same gitSha in the packaged build identity file.
const FIXTURE_GIT_SHA = writerHarness.buildIdentity.gitSha;
const FIXTURE_NOTES_ZH = "R2 双发测试：显式中文发布说明。";
const FIXTURE_NOTES_EN = "Dual publish test: explicit English release notes.";

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

// Fixture out/make tree for a GravityPort release. The DMG is a real image so
// hdiutil verify passes; the packaged build identity is written next to the
// built UI bundle the way the script expects it.
function makeSourceTree({ macVersion = "0.3.7", windowsVersion = null, dmg = false, installer = false } = {}) {
  // The script treats this directory as out/make and looks for the build
  // identity two levels up, so give every tree its own private repository
  // root; otherwise suites running in parallel share the tmpdir parent.
  const root = path.join(makeTempDir("mosa-r2-repo."), "out", "make");
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

  let dmgPath = null;
  if (dmg) {
    const dmgDir = path.join(root, "dmg", "darwin", "arm64");
    fs.mkdirSync(dmgDir, { recursive: true });
    dmgPath = path.join(dmgDir, `GravityPort-darwin-arm64-${macVersion}.dmg`);
    const scratch = makeTempDir("mosa-r2-dmg.");
    execFileSync("hdiutil", ["create", "-size", "1m", "-fs", "HFS+", "-volname", "R2Probe", "-quiet", "probe.dmg"], { cwd: scratch });
    execFileSync("hdiutil", ["convert", "probe.dmg", "-format", "UDZO", "-o", dmgPath, "-quiet"], { cwd: scratch });
    fs.rmSync(scratch, { recursive: true, force: true });
    const identityDir = path.join(root, "..", "..", "web", "gravityport", "dist");
    fs.mkdirSync(identityDir, { recursive: true });
    fs.writeFileSync(path.join(identityDir, "build-identity.json"), `${JSON.stringify({
      productVersion: macVersion,
      gitSha: FIXTURE_GIT_SHA,
    }, null, 2)}\n`);
  }

  let installerPath = null;
  if (installer) {
    assert.ok(windowsVersion, "an installer needs its update ZIP");
    const installerDir = path.join(root, "installer", "win32", "x64");
    fs.mkdirSync(installerDir, { recursive: true });
    installerPath = path.join(installerDir, `GravityPort-win32-x64-${windowsVersion}.exe`);
    fs.writeFileSync(installerPath, "MZ fake installer");
  }

  return { root, macPath, windowsPath, dmgPath, installerPath };
}

function previousManifestJson(version) {
  return `${JSON.stringify({
    version,
    publishedAt: "2026-10-20T00:00:00.000Z",
    notes: { zh: "旧版本", en: "old" },
    platforms: {
      macos: { platform: "macOS", arch: "arm64", appName: "GravityPort.app", file: `GravityPort-darwin-arm64-${version}.zip`, size: 1, sha256: "c".repeat(64) },
    },
  }, null, 2)}\n`;
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
];

// Builds the script environment. `targets` is passed through as
// MOSA_RELEASE_TARGETS when defined; `binDir` prepends a directory of shims
// (curl stand-ins) to PATH.
function buildEnv({ sourceDir, stateFile, targets, withR2 = true, r2Endpoint, binDir, extraEnv = {} }) {
  const env = { ...process.env };
  for (const key of MANAGED_ENV_KEYS) delete env[key];
  // Never read the developer's real release.env from tests.
  env.MOSA_RELEASE_CONFIG = path.join(os.tmpdir(), "mosa-r2-test-no-release.env");
  env.MOSA_RELEASE_SOURCE_DIR = sourceDir;
  env.MOSA_RELEASE_STATE_FILE = stateFile;
  env.MOSA_RELEASE_MANIFEST_WRITER = writerPath;
  env.MOSA_RELEASE_PUBLISHED_AT = "2026-10-28T01:00:00Z";
  env.MOSA_RELEASE_PRODUCT = "GravityPort";
  env.MOSA_RELEASE_NOTES_ZH = FIXTURE_NOTES_ZH;
  env.MOSA_RELEASE_NOTES_EN = FIXTURE_NOTES_EN;
  if (targets !== undefined) env.MOSA_RELEASE_TARGETS = targets;
  if (withR2) {
    env.MOSA_RELEASE_R2_ENDPOINT = r2Endpoint;
    env.MOSA_RELEASE_R2_BUCKET = "test-bucket";
    env.MOSA_RELEASE_R2_ACCESS_KEY_ID = TEST_ACCESS_KEY_ID;
    env.MOSA_RELEASE_R2_SECRET_ACCESS_KEY = TEST_SECRET_ACCESS_KEY;
  }
  if (binDir) env.PATH = `${binDir}:${process.env.PATH}`;
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

function seedPreviousManifestOnR2(fake, version = "0.3.6") {
  fake.putObject("releases/gravityport/latest.json", previousManifestJson(version));
}

function callLogLines(callLog) {
  return fs.readFileSync(callLog, "utf8").split("\n").filter(Boolean);
}

test("an unset MOSA_RELEASE_TARGETS publishes to R2, the default target", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: undefined,
    r2Endpoint: fake.endpoint,
  });

  await runScript(env);

  const manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.equal(manifest.version, "0.3.7");
  assert.ok(fake.objects.has("downloads/GravityPort-darwin-arm64-0.3.7.zip"), "the macOS package reached R2");
  assert.ok(fs.existsSync(path.join(work, "state")), "the state file is written after a successful R2 publish");
});

test("R2 publish uploads packages before the manifest and copies history into R2", async (t) => {
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const callLog = path.join(work, "call-order.log");
  fs.writeFileSync(callLog, "");
  // Order every R2 request in a log so the upload order can be asserted.
  const fake = createFakeS3({ orderLogFile: callLog });
  await fake.listen();
  t.after(() => fake.close());
  // Publishing assumes the previous manifest already sits on R2, so the
  // history copy has something to back up.
  seedPreviousManifestOnR2(fake, "0.3.6");

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7", dmg: true, installer: true });
  // The DMG fixture writes the build identity into the shared tmpdir parent;
  // remove it afterwards so no later run of any suite reads this stale file.
  t.after(() => fs.rmSync(path.join(root, "..", "..", "web"), { recursive: true, force: true }));
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  await runScript(env);

  const lines = callLogLines(callLog);
  const r2Put = (suffix) => lines.findIndex((line) => line.startsWith("r2 PUT ") && line.endsWith(`/${suffix}`));
  const manifestPut = r2Put("releases/gravityport/latest.json");
  assert.ok(manifestPut >= 0, `the manifest was uploaded to R2 (log: ${lines.join(" | ")})`);
  for (const name of [
    "downloads/GravityPort-darwin-arm64-0.3.7.zip",
    "downloads/GravityPort-win32-x64-0.3.7.zip",
    "downloads/GravityPort-darwin-arm64-0.3.7.dmg",
    "downloads/GravityPort-win32-x64-0.3.7.exe",
  ]) {
    const index = lines.findIndex((line) => line.startsWith("r2 PUT ") && line.includes(`/${name}`));
    assert.ok(index >= 0, `package ${name} was uploaded to R2`);
    assert.ok(index < manifestPut, `package ${name} must be uploaded before the manifest`);
  }
  const historyCopy = lines.findIndex((line) => line.startsWith("r2 PUT ") && line.includes("/releases/gravityport/history/"));
  assert.ok(historyCopy >= 0, "the previous manifest was copied into R2 history");
  assert.ok(historyCopy < manifestPut, "the history copy must happen before the manifest upload");

  const r2Manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.equal(r2Manifest.version, "0.3.7");
});

test("an R2 failure mid-run stops everything and leaves the manifest untouched", async (t) => {
  const fake = createFakeS3({ failPutForKey: { "downloads/GravityPort-win32-x64-0.3.7.zip": 500 } });
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  seedPreviousManifestOnR2(fake, "0.3.6");
  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  await runScriptExpectFailure(env);

  assert.equal(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"), previousManifestJson("0.3.6"),
    "the R2 manifest must be untouched");
  assert.equal([...fake.objects.keys()].some((key) => key.includes("/history/")), false,
    "no R2 history copy may happen on failure");
  assert.equal(fs.existsSync(path.join(work, "state")), false, "the state file is not written on failure");
});

test("a checksum rejection on R2 aborts before the manifest is uploaded", async (t) => {
  const fake = createFakeS3({ rejectChecksumFor: { "downloads/GravityPort-darwin-arm64-0.3.7.zip": true } });
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  seedPreviousManifestOnR2(fake, "0.3.6");
  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  const error = await runScriptExpectFailure(env);
  assert.match(String(error.stderr), /R2 上传失败/);
  assert.equal(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"), previousManifestJson("0.3.6"));
});

test("r2 reads the previous manifest from R2 and backs it up into history", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  seedPreviousManifestOnR2(fake, "0.3.6");
  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  await runScript(env);

  assert.ok([...fake.requests].some((request) => request.method === "GET" && request.path.endsWith("/releases/gravityport/latest.json")),
    "the previous manifest was read from R2");
  const historyKeys = [...fake.objects.keys()].filter((key) => /^releases\/gravityport\/history\//.test(key));
  assert.equal(historyKeys.length, 1, "the previous manifest was backed up into R2 history");
  const manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.equal(manifest.version, "0.3.7");
});

test("r2 treats a bucket without a manifest as a first release", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  const { stdout } = await runScript(env);
  assert.match(stdout, /R2 上暂无 latest\.json/);
  const historyKeys = [...fake.objects.keys()].filter((key) => /history\//.test(key));
  assert.equal(historyKeys.length, 0, "no history copy can happen on a first release");
  const manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.equal(manifest.version, "0.3.7");
});

test("R2 retention deletes only the oldest complete desktop pairs", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  // Five complete versions are seeded; with the release this run publishes
  // (0.3.7) the bucket then holds six versions, so retention keeps four and
  // deletes the oldest two pairs. Everything retention must never touch is
  // seeded alongside.
  for (let minor = 2; minor <= 6; minor += 1) {
    fake.putObject(`downloads/GravityPort-darwin-arm64-0.3.${minor}.zip`, `mac ${minor}`);
    fake.putObject(`downloads/GravityPort-win32-x64-0.3.${minor}.zip`, `win ${minor}`);
  }
  fake.putObject("downloads/GravityPort-Web-Capture-0.15.41.zip", "extension");
  fake.putObject("downloads/MOSA-darwin-arm64-0.3.0-rc.1.zip", "frozen mosa");
  fake.putObject("downloads/MOSA-win32-x64-0.3.0-rc.1.zip", "frozen mosa win");
  fake.putObject("downloads/GravityPort-darwin-arm64-0.2.9.zip", "unpaired old mac zip");
  seedPreviousManifestOnR2(fake, "0.3.6");

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  await runScript(env);

  for (const key of [
    "downloads/GravityPort-darwin-arm64-0.3.2.zip",
    "downloads/GravityPort-win32-x64-0.3.2.zip",
    "downloads/GravityPort-darwin-arm64-0.3.3.zip",
    "downloads/GravityPort-win32-x64-0.3.3.zip",
  ]) {
    assert.equal(fake.objects.has(key), false, `${key} is beyond the retention window and must be deleted`);
  }
  for (let minor = 4; minor <= 6; minor += 1) {
    assert.ok(fake.objects.has(`downloads/GravityPort-darwin-arm64-0.3.${minor}.zip`));
    assert.ok(fake.objects.has(`downloads/GravityPort-win32-x64-0.3.${minor}.zip`));
  }
  for (const key of [
    "downloads/GravityPort-darwin-arm64-0.3.7.zip",
    "downloads/GravityPort-win32-x64-0.3.7.zip",
    "downloads/GravityPort-Web-Capture-0.15.41.zip",
    "downloads/MOSA-darwin-arm64-0.3.0-rc.1.zip",
    "downloads/MOSA-win32-x64-0.3.0-rc.1.zip",
    "downloads/GravityPort-darwin-arm64-0.2.9.zip",
  ]) {
    assert.ok(fake.objects.has(key), `${key} must never be deleted by retention`);
  }
});

test("curl never receives the secret in its argv and the output never contains it", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  // A curl stand-in that records its argv and hands over to the real curl.
  const binDir = makeTempDir("mosa-r2-bin.");
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  const argvLog = path.join(work, "curl-argv.log");
  fs.writeFileSync(path.join(binDir, "curl"), `#!/bin/bash
printf '%s\\0' "$@" >> ${JSON.stringify(argvLog)}
exec /usr/bin/curl "$@"
`);
  fs.chmodSync(path.join(binDir, "curl"), 0o755);

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
    binDir,
  });

  const { stdout, stderr } = await runScript(env);
  assert.ok(fs.existsSync(argvLog), "the curl shim saw at least one invocation");
  const argvDump = fs.readFileSync(argvLog, "utf8");
  assert.equal(argvDump.includes(TEST_SECRET_ACCESS_KEY), false, "the secret must never appear in any curl argv");
  assert.equal(argvDump.includes(TEST_ACCESS_KEY_ID), false, "the access key id travels via stdin config, not argv");
  assert.equal(stdout.includes(TEST_SECRET_ACCESS_KEY), false, "the secret must never reach stdout");
  assert.equal(stderr.includes(TEST_SECRET_ACCESS_KEY), false, "the secret must never reach stderr");
});

test("dry-run with the r2 target prints the plan and sends no write request", async (t) => {
  const fake = createFakeS3();
  await fake.listen();
  t.after(() => fake.close());
  const work = makeTempDir("mosa-r2-run.");
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  for (let minor = 1; minor <= 6; minor += 1) {
    fake.putObject(`downloads/GravityPort-darwin-arm64-0.3.${minor}.zip`, `mac ${minor}`);
    fake.putObject(`downloads/GravityPort-win32-x64-0.3.${minor}.zip`, `win ${minor}`);
  }
  fake.putObject("downloads/GravityPort-Web-Capture-0.15.41.zip", "extension");
  seedPreviousManifestOnR2(fake, "0.3.6");

  const { root } = makeSourceTree({ macVersion: "0.3.7", windowsVersion: "0.3.7" });
  const env = buildEnv({
    sourceDir: root,
    stateFile: path.join(work, "state"),
    targets: "r2",
    r2Endpoint: fake.endpoint,
  });

  const { stdout } = await runScript(env, ["--dry-run"]);

  const writeRequests = fake.requests.filter((request) => request.method !== "GET" && request.method !== "HEAD");
  assert.equal(writeRequests.length, 0, "dry-run must not send any write request");
  assert.match(stdout, /R2 配置齐/);
  assert.match(stdout, /downloads\/GravityPort-darwin-arm64-0\.3\.7\.zip/);
  assert.match(stdout, /releases\/gravityport\/latest\.json/);
  assert.match(stdout, /R2 清理将删除/);
  assert.match(stdout, /0\.3\.1/);
  assert.equal(stdout.includes(TEST_SECRET_ACCESS_KEY), false, "dry-run output must not contain the secret");
  // Nothing was published.
  const manifest = JSON.parse(fake.objects.get("releases/gravityport/latest.json").body.toString("utf8"));
  assert.equal(manifest.version, "0.3.6");
});

test("the retired old-server target and any unknown MOSA_RELEASE_TARGETS value fail up front", async (t) => {
  const { root } = makeSourceTree({ macVersion: "0.3.7" });
  for (const targets of ["旧服务器", "旧服务器,r2", "foo"]) {
    const env = buildEnv({
      sourceDir: root,
      stateFile: path.join(makeTempDir("mosa-r2-run."), "state"),
      targets,
      withR2: false,
    });

    const error = await runScriptExpectFailure(env);
    assert.match(String(error.stderr), /旧服务器已停用，只支持 r2/, `MOSA_RELEASE_TARGETS=${targets} must be refused`);
  }
});
