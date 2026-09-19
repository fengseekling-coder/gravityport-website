import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";

const feedSourcePath = fileURLToPath(new URL("../desktop-release-feed.js", import.meta.url));

function loadFeed() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(feedSourcePath, "utf8"), { window });
  return window.MOSADesktopReleaseFeed;
}

const feed = loadFeed();

const macEntry = (version, overrides = {}) => ({
  platform: "macOS",
  arch: "arm64",
  file: `MOSA-darwin-arm64-${version}.zip`,
  size: 1,
  sha256: "a".repeat(64),
  ...overrides,
});

const windowsEntry = (version, overrides = {}) => ({
  platform: "Windows",
  arch: "x64",
  file: `MOSA-win32-x64-${version}.zip`,
  size: 2,
  sha256: "b".repeat(64),
  ...overrides,
});

test("Case A: macOS + Windows present, both resolve independently", () => {
  const release = {
    version: "0.2.1-rc.16",
    platforms: { macos: macEntry("0.2.1-rc.16"), windows: windowsEntry("0.2.1-rc.16") },
  };
  const normalized = feed.normalizeDesktopRelease(release);
  assert.equal(normalized.version, "0.2.1-rc.16");
  assert.equal(normalized.mac.url, "https://mosa.azhuilab.com/downloads/MOSA-darwin-arm64-0.2.1-rc.16.zip");
  assert.equal(normalized.windows.url, "https://mosa.azhuilab.com/downloads/MOSA-win32-x64-0.2.1-rc.16.zip");
});

test("Case B: macOS only — macOS resolves, Windows is null without breaking the release", () => {
  const release = { version: "0.2.1-rc.16", platforms: { macos: macEntry("0.2.1-rc.16") } };
  const normalized = feed.normalizeDesktopRelease(release);
  assert.ok(normalized.mac, "macOS must resolve");
  assert.equal(normalized.windows, null, "missing Windows must not affect macOS");
});

test("Case C: Windows only — Windows resolves, macOS is null without breaking the release", () => {
  const release = { version: "0.2.1-rc.16", platforms: { windows: windowsEntry("0.2.1-rc.16") } };
  const normalized = feed.normalizeDesktopRelease(release);
  assert.equal(normalized.mac, null, "missing macOS must not affect Windows");
  assert.ok(normalized.windows, "Windows must resolve");
});

test("Case D: legacy artifacts.* payloads are ignored entirely", () => {
  const release = {
    version: "0.2.1-rc.16",
    artifacts: {
      mac: { platform: "macOS", arch: "arm64", file: "MOSA-darwin-arm64-0.2.1-rc.16.dmg", size: 1, sha256: "a".repeat(64) },
      windows: { platform: "Windows", arch: "x64", file: "MOSA-win32-x64-0.2.1-rc.16.zip", size: 2, sha256: "b".repeat(64) },
    },
  };
  const normalized = feed.normalizeDesktopRelease(release);
  assert.equal(normalized.mac, null);
  assert.equal(normalized.windows, null);
  assert.equal(normalized.version, "0.2.1-rc.16", "version still parses so the UI can fall back per platform");
});

test("platforms missing entirely falls back per platform", () => {
  const normalized = feed.normalizeDesktopRelease({ version: "0.2.1-rc.16", platforms: {} });
  assert.equal(normalized.mac, null);
  assert.equal(normalized.windows, null);
});

test("download URLs always come from the fixed first-party origin, never from the manifest", () => {
  const hostile = {
    version: "0.2.1-rc.16",
    platforms: {
      macos: macEntry("0.2.1-rc.16", { url: "https://evil.example/mosa.zip" }),
      windows: windowsEntry("0.2.1-rc.16", { url: "http://cdn.third-party.example/x.zip" }),
    },
  };
  const normalized = feed.normalizeDesktopRelease(hostile);
  assert.ok(normalized.mac.url.startsWith("https://mosa.azhuilab.com/downloads/"));
  assert.ok(normalized.windows.url.startsWith("https://mosa.azhuilab.com/downloads/"));
  assert.equal(feed.buildFirstPartyDownloadUrl("MOSA-darwin-arm64-0.2.1-rc.16.zip"),
    "https://mosa.azhuilab.com/downloads/MOSA-darwin-arm64-0.2.1-rc.16.zip");
});

test("artifact filenames must match the manifest version exactly", () => {
  const stale = { version: "0.2.1-rc.16", platforms: { macos: macEntry("0.2.1-rc.15") } };
  assert.equal(feed.normalizeDesktopRelease(stale).mac, null);
  const staleWindows = { version: "0.2.1-rc.16", platforms: { windows: windowsEntry("0.2.1-rc.14") } };
  assert.equal(feed.normalizeDesktopRelease(staleWindows).windows, null);
});

test("platform and arch identity fields are enforced", () => {
  const wrongPlatform = { version: "0.2.1-rc.16", platforms: { macos: macEntry("0.2.1-rc.16", { platform: "macOS", arch: "x64" }) } };
  assert.equal(feed.normalizeDesktopRelease(wrongPlatform).mac, null);
  const wrongArch = { version: "0.2.1-rc.16", platforms: { windows: windowsEntry("0.2.1-rc.16", { arch: "arm64" }) } };
  assert.equal(feed.normalizeDesktopRelease(wrongArch).windows, null);
});

test("invalid manifests yield no platform and no version", () => {
  for (const bad of [null, undefined, [], "rc.16", {}, { version: "not-a-version" }, { version: 42 }]) {
    const normalized = feed.normalizeDesktopRelease(bad);
    assert.equal(normalized.version, "");
    assert.equal(normalized.mac, null);
    assert.equal(normalized.windows, null);
  }
});

test("the live rc.15 manifest resolves its macOS artifact", () => {
  const live = {
    version: "0.2.1-rc.15",
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
  const normalized = feed.normalizeDesktopRelease(live);
  assert.equal(normalized.mac.url, "https://mosa.azhuilab.com/downloads/MOSA-darwin-arm64-0.2.1-rc.15.zip");
  assert.equal(normalized.windows, null);
});
