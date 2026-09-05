import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  return `127.0.0.1 - - [${time}] "${method} ${path} HTTP/1.1" ${status} 123 "-" "test"\n`;
}

function usage(time, event, installId, version = "0.2.1") {
  const query = new URLSearchParams({
    event,
    telemetry_version: "2",
    install_id: installId,
    platform: "macos",
    arch: "arm64",
    version,
  });
  return logLine(time, "HEAD", `/releases/latest.json?${query}`, 200);
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
