import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "report-usage.mjs");
const NOW = "2026-09-02T12:00:00Z";
const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "223e4567-e89b-42d3-a456-426614174001";

function logLine(time, method, path, status = 200) {
  return logLineWithBytes(time, method, path, status, 123);
}

function logLineWithBytes(time, method, path, status = 200, bytes = 123) {
  return `127.0.0.1 - - [${time}] "${method} ${path} HTTP/1.1" ${status} ${bytes} "-" "test"\n`;
}

function usage(time, event, installId, version = "0.2.1") {
  return usageOnSource(time, event, installId, "/releases/latest.json", version);
}

function usageOnSource(time, event, installId, sourcePath, version = "0.2.1") {
  const query = new URLSearchParams({
    event,
    telemetry_version: "2",
    install_id: installId,
    platform: "macos",
    arch: "arm64",
    version,
  });
  return logLine(time, "HEAD", `${sourcePath}?${query}`, 200);
}

function runReport(root) {
  const accessLog = join(root, "access.log");
  const statePath = join(root, "private", "usage-state.json");
  const outputPath = join(root, "admin", "stats.json");
  const result = spawnSync(process.execPath, [
    scriptPath,
    accessLog,
    "--state", statePath,
    "--output", outputPath,
    "--now", NOW,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

test("persistent usage stats survive repeated runs, rotation, and gzip without double counting", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-"));
  const accessLog = join(root, "access.log");
  const desktop = "/downloads/MOSA-darwin-arm64-0.2.1.zip?ref=reddit_codex";
  const extension = "/downloads/MOSA-Web-Capture-0.14.0.zip?ref=xiaohongshu";

  writeFileSync(accessLog, [
    usage("02/Sep/2026:09:00:00 +0000", "first_launch", ID_A),
    usage("02/Sep/2026:10:00:00 +0000", "daily_active", ID_A),
    logLine("02/Sep/2026:09:10:00 +0000", "GET", desktop, 200),
    logLine("02/Sep/2026:09:11:00 +0000", "GET", desktop, 206),
    logLine("02/Sep/2026:09:12:00 +0000", "GET", extension, 200),
  ].join(""));

  const first = runReport(root);
  assert.equal(first.knownInstallationInstances, 1);
  assert.equal(first.reportedFirstLaunches, 1);
  assert.equal(first.dailyActiveInstalls, 1);
  assert.equal(first.analyticsTimeZone, "America/Los_Angeles");
  assert.equal(first.totalDownloadRequests, 3);
  assert.equal(first.totalDesktopDownloadRequests, 2);
  assert.equal(first.totalExtensionDownloadRequests, 1);
  assert.equal(first.downloadsByRef.reddit_codex, 2);
  assert.equal(first.downloadsByRef.xiaohongshu, 1);
  assert.equal(first.totalPageViews, 0);
  assert.equal(first.totalHomePageViews, 0);
  assert.equal(first.homeToDownloadRate, null);

  const repeated = runReport(root);
  assert.equal(repeated.knownInstallationInstances, 1);
  assert.equal(repeated.totalDownloadRequests, 3, "rerunning the same log must not double count");

  renameSync(accessLog, join(root, "access.log.1"));
  writeFileSync(accessLog, [
    usage("02/Sep/2026:11:00:00 +0000", "first_launch", ID_B, "0.2.2"),
    logLine("02/Sep/2026:11:01:00 +0000", "GET", "/downloads/MOSA-win32-x64-0.2.2.zip?ref=direct", 200),
  ].join(""));

  const rotated = runReport(root);
  assert.equal(rotated.knownInstallationInstances, 2);
  assert.equal(rotated.reportedFirstLaunches, 2);
  assert.equal(rotated.totalDownloadRequests, 4);
  assert.equal(rotated.totalDesktopDownloadRequests, 3);
  assert.equal(rotated.totalExtensionDownloadRequests, 1);

  const rotatedBytes = readFileSync(join(root, "access.log.1"));
  writeFileSync(join(root, "access.log.2.gz"), gzipSync(rotatedBytes));
  rmSync(join(root, "access.log.1"));

  const compressed = runReport(root);
  assert.equal(compressed.knownInstallationInstances, 2);
  assert.equal(compressed.reportedFirstLaunches, 2);
  assert.equal(compressed.totalDownloadRequests, 4, "compressing an already processed rotation must not count it twice");
  assert.equal(compressed.totalDesktopDownloadRequests, 3);
  assert.equal(compressed.totalExtensionDownloadRequests, 1);
});

test("copytruncate with the same inode starts a fresh cursor instead of reviving the old offset", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-copytruncate-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    usage("02/Sep/2026:08:00:00 +0000", "first_launch", ID_A),
    logLine("02/Sep/2026:08:01:00 +0000", "GET", "/downloads/MOSA-darwin-arm64-0.2.1.zip", 200),
  ].join(""));
  const first = runReport(root);
  assert.equal(first.knownInstallationInstances, 1);
  assert.equal(first.totalDesktopDownloadRequests, 1);

  // writeFileSync truncates in place, preserving the inode on normal filesystems.
  writeFileSync(accessLog, [
    usage("02/Sep/2026:11:00:00 +0000", "first_launch", ID_B, "0.2.2"),
    logLine("02/Sep/2026:11:01:00 +0000", "GET", "/downloads/MOSA-win32-x64-0.2.2.zip", 200),
  ].join(""));
  const afterTruncate = runReport(root);
  assert.equal(afterTruncate.knownInstallationInstances, 2);
  assert.equal(afterTruncate.reportedFirstLaunches, 2);
  assert.equal(afterTruncate.totalDesktopDownloadRequests, 2);

  const repeated = runReport(root);
  assert.equal(repeated.knownInstallationInstances, 2);
  assert.equal(repeated.totalDesktopDownloadRequests, 2, "the replacement log must also be idempotent");
});

function fingerprintBuffer(buffer, processedBytes) {
  const length = Math.max(0, Math.min(processedBytes, buffer.length));
  if (length === 0) return { headSha256: "", tailSha256: "" };
  const sample = Math.min(64 * 1024, length);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  return {
    headSha256: hash(buffer.subarray(0, sample)),
    tailSha256: hash(buffer.subarray(length - sample, length)),
  };
}

test("MOSA public page views count home, guide, and demo without treating other-site GET / as MOSA", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-pages-"));
  const accessLog = join(root, "access.log");
  const desktop = "/downloads/MOSA-darwin-arm64-0.2.1.zip?ref=reddit_codex";

  writeFileSync(accessLog, [
    logLineWithBytes("02/Sep/2026:09:00:00 +0000", "GET", "/", 200, 24977),
    logLineWithBytes("02/Sep/2026:09:01:00 +0000", "GET", "/?ref=bilibili", 200, 23228),
    logLineWithBytes("02/Sep/2026:09:02:00 +0000", "GET", "/", 200, 1663),
    logLineWithBytes("02/Sep/2026:09:03:00 +0000", "GET", "/guide/", 200, 5166),
    logLineWithBytes("02/Sep/2026:09:04:00 +0000", "GET", "/demo/", 200, 19049),
    logLineWithBytes("02/Sep/2026:09:05:00 +0000", "GET", "/privacy/", 200, 17276),
    logLineWithBytes("02/Sep/2026:09:06:00 +0000", "GET", "/admin/", 200, 5728),
    logLineWithBytes("02/Sep/2026:09:07:00 +0000", "GET", "/styles.css", 200, 71277),
    logLine("02/Sep/2026:09:08:00 +0000", "GET", desktop, 200),
    logLine("02/Sep/2026:09:09:00 +0000", "GET", desktop, 206),
  ].join(""));

  const first = runReport(root);
  assert.equal(first.totalHomePageViews, 2);
  assert.equal(first.totalPageViews, 5);
  assert.equal(first.pageViewsByPath["/"], 2);
  assert.equal(first.pageViewsByPath["/guide/"], 1);
  assert.equal(first.pageViewsByPath["/demo/"], 1);
  assert.equal(first.pageViewsByPath["/privacy/"], 1);
  assert.equal(first.totalDownloadRequests, 2);
  assert.equal(first.homeToDownloadRate, 1);
  const today = first.daily.at(-1);
  assert.equal(today.homePageViews, 2);
  assert.equal(today.pageViews, 5);
  assert.equal(today.downloadRequests, 2);

  const repeated = runReport(root);
  assert.equal(repeated.totalHomePageViews, 2, "rerunning the same log must not double count page views");
  assert.equal(repeated.totalPageViews, 5);
  assert.equal(repeated.totalDownloadRequests, 2);
});

test("the English home page counts as its own path and as a home page view", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-en-"));
  writeFileSync(join(root, "access.log"), [
    logLineWithBytes("02/Sep/2026:09:00:00 +0000", "GET", "/", 200, 24977),
    logLineWithBytes("02/Sep/2026:09:01:00 +0000", "GET", "/en/?ref=youtube", 200, 25120),
    logLineWithBytes("02/Sep/2026:09:02:00 +0000", "GET", "/en/index.html", 200, 25120),
    logLineWithBytes("02/Sep/2026:09:03:00 +0000", "GET", "/en", 301, 162),
    logLineWithBytes("02/Sep/2026:09:04:00 +0000", "GET", "/en/", 200, 1663),
  ].join(""));

  const stats = runReport(root);
  assert.equal(stats.pageViewsByPath["/"], 1);
  assert.equal(stats.pageViewsByPath["/en/"], 2, "the redirect and the too-small response are not page views");
  assert.equal(stats.totalHomePageViews, 3);
  assert.equal(stats.daily.at(-1).homePageViews, 3);
});

test("existing v2 state backfills page views from already processed bytes without changing download totals", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-backfill-"));
  const accessLog = join(root, "access.log");
  const statePath = join(root, "private", "usage-state.json");
  const body = [
    logLineWithBytes("02/Sep/2026:09:00:00 +0000", "GET", "/", 200, 24977),
    logLine("02/Sep/2026:09:01:00 +0000", "GET", "/downloads/MOSA-darwin-arm64-0.2.1.zip", 200),
  ].join("");
  writeFileSync(accessLog, body);

  const buffer = readFileSync(accessLog);
  const info = statSync(accessLog);
  const fingerprint = fingerprintBuffer(buffer, buffer.length);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 2,
    updatedAt: NOW,
    coverageStart: Date.parse(NOW),
    sources: [{
      fileKey: `${info.dev}:${info.ino}`,
      pathHint: "access.log",
      processedBytes: buffer.length,
      headSha256: fingerprint.headSha256,
      tailSha256: fingerprint.tailSha256,
      lastSeenAt: Date.parse(NOW),
    }],
    aggregate: {
      installs: [],
      downloadCounts: [["MOSA-darwin-arm64-0.2.1.zip", 1]],
      desktopDownloadCounts: [["MOSA-darwin-arm64-0.2.1.zip", 1]],
      extensionDownloadCounts: [],
      otherDownloadCounts: [],
      refCounts: [["direct", 1]],
      dailyDownloads: [["2026-09-02", 1]],
      dailyActiveSets: [],
      dailyFirstLaunchSets: [],
    },
  })}\n`);

  const report = runReport(root);
  assert.equal(report.totalDownloadRequests, 1, "backfill must not recount downloads");
  assert.equal(report.totalDesktopDownloadRequests, 1);
  assert.equal(report.totalHomePageViews, 1);
  assert.equal(report.totalPageViews, 1);
  assert.equal(report.homeToDownloadRate, 1);

  const repeated = runReport(root);
  assert.equal(repeated.totalDownloadRequests, 1);
  assert.equal(repeated.totalHomePageViews, 1, "page-view backfill must run only once");
});

test("the same installation reporting on both update sources counts exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-dual-source-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    usage("02/Sep/2026:09:00:00 +0000", "first_launch", ID_A),
    usageOnSource("02/Sep/2026:10:00:00 +0000", "daily_active", ID_A, "/releases/gravityport/latest.json"),
  ].join(""));

  const report = runReport(root);
  assert.equal(report.knownInstallationInstances, 1, "one installation id on two sources is one user");
  assert.equal(report.reportedFirstLaunches, 1);
  assert.equal(report.dailyActiveInstalls, 1);
  assert.equal(report.activeInstalls7d, 1);
  assert.equal(report.activeInstalls30d, 1);

  const repeated = runReport(root);
  assert.equal(repeated.knownInstallationInstances, 1, "rerunning must not double count cross-source reports");
});

test("installations reporting only on the GravityPort source are counted", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-gp-source-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    usageOnSource("02/Sep/2026:09:00:00 +0000", "first_launch", ID_B, "/releases/gravityport/latest.json", "0.3.0"),
    usageOnSource("02/Sep/2026:10:00:00 +0000", "daily_active", ID_B, "/releases/gravityport/latest.json", "0.3.0"),
  ].join(""));

  const report = runReport(root);
  assert.equal(report.knownInstallationInstances, 1);
  assert.equal(report.reportedFirstLaunches, 1);
  assert.equal(report.dailyActiveInstalls, 1);
  assert.equal(report.versionInstalls["0.3.0"], 1);
});

test("GravityPort desktop packages are counted as desktop downloads", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-gp-download-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    logLine("02/Sep/2026:09:00:00 +0000", "GET", "/downloads/GravityPort-darwin-arm64-0.3.0.zip", 200),
    logLine("02/Sep/2026:09:01:00 +0000", "GET", "/downloads/GravityPort-win32-x64-0.3.0.zip", 206),
    logLine("02/Sep/2026:09:02:00 +0000", "GET", "/downloads/MOSA-Web-Capture-0.15.3.zip", 200),
  ].join(""));

  const report = runReport(root);
  assert.equal(report.totalDesktopDownloadRequests, 2);
  assert.equal(report.desktopDownloadsByFile["GravityPort-darwin-arm64-0.3.0.zip"], 1);
  assert.equal(report.desktopDownloadsByFile["GravityPort-win32-x64-0.3.0.zip"], 1);
  assert.equal(report.totalExtensionDownloadRequests, 1, "the extension pattern is unchanged");
  assert.equal(report.totalOtherDownloadRequests, 0, "GravityPort zips must not fall into other downloads");
});

test("GravityPort and MOSA extension packages are both counted as extension downloads", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-gp-extension-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    logLine("02/Sep/2026:09:00:00 +0000", "GET", "/downloads/GravityPort-Web-Capture-0.15.3.zip", 200),
    logLine("02/Sep/2026:09:01:00 +0000", "GET", "/downloads/MOSA-Web-Capture-0.15.3.zip", 200),
  ].join(""));

  const report = runReport(root);
  assert.equal(report.totalExtensionDownloadRequests, 2);
  assert.equal(report.extensionDownloadsByFile["GravityPort-Web-Capture-0.15.3.zip"], 1);
  assert.equal(report.extensionDownloadsByFile["MOSA-Web-Capture-0.15.3.zip"], 1);
  assert.equal(report.totalDesktopDownloadRequests, 0);
  assert.equal(report.totalOtherDownloadRequests, 0);
});

test("logs with only the old source and MOSA packages keep their exact numbers", () => {
  const root = mkdtempSync(join(tmpdir(), "mosa-stats-legacy-only-"));
  const accessLog = join(root, "access.log");

  writeFileSync(accessLog, [
    usage("02/Sep/2026:09:00:00 +0000", "first_launch", ID_A),
    usage("02/Sep/2026:10:00:00 +0000", "daily_active", ID_A),
    logLine("02/Sep/2026:09:10:00 +0000", "GET", "/downloads/MOSA-darwin-arm64-0.2.1.zip", 200),
    logLine("02/Sep/2026:09:11:00 +0000", "GET", "/downloads/MOSA-win32-x64-0.2.1.zip", 206),
  ].join(""));

  const report = runReport(root);
  assert.equal(report.knownInstallationInstances, 1);
  assert.equal(report.reportedFirstLaunches, 1);
  assert.equal(report.dailyActiveInstalls, 1);
  assert.equal(report.totalDownloadRequests, 2);
  assert.equal(report.totalDesktopDownloadRequests, 2);
  assert.equal(report.totalExtensionDownloadRequests, 0);
  assert.equal(report.totalOtherDownloadRequests, 0);
});
