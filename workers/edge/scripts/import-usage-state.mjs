#!/usr/bin/env node
// Convert a legacy scripts/report-usage.mjs state file (usage-state.json) into
// idempotent SQL for `wrangler d1 execute --file` and a reconciliation summary.
//
// Rules:
// - Whitelist: only schemaVersion, coverageStart, updatedAt and aggregate fields
//   are read. Sources and privacy-sensitive fields are strictly dropped.
// - Sanitization:
//   - Test installs starting with 00000000- and excluded installs are skipped;
//   - Platforms are normalized to macos / windows / other / unknown;
//   - Architectures and versions are validated or normalized to unknown;
//   - Download filenames containing /, \\, .., control characters or >128 chars
//     are dropped; names that are not GravityPort/MOSA packages are summed
//     under the single key "other";
//   - Ref channels outside [A-Za-z0-9._-]{1,64} are merged into "other";
//   - Page paths only retain normalized public page paths;
// - Legacy counts write to legacy_* kinds on day 'pre-edge';
// - Coverage start/end are the first/last analytics days holding legacy data
//   (the state's coverageStart can only move the start earlier; updatedAt is
//   only a fallback because the old cron keeps rewriting it after the switch);
// - Pre-edge download_file, download_ref, and page_path are no longer written;
// - Idempotence:
//   1. Delete imported rows: day='pre-edge' counters, and download_all,
//      page_all, home_page_all, import rows;
//   2. Installs: INSERT ... ON CONFLICT(install_id) DO UPDATE (merge rules);
//   3. Daily active: INSERT ... ON CONFLICT(day, install_id) DO UPDATE;
//   4. Counters: INSERT (safe because pre-edge / import rows were cleared).

import { readFile, writeFile } from "node:fs/promises";
import { classifyDownload } from "../src/counters.js";
import { DAY_MS, analyticsDayKey, recentDayKeys } from "../src/util.js";

const STATE_SCHEMA_VERSION = 2;
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ARCH_PATTERN = /^[0-9A-Za-z._-]{1,24}$/;
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REF_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const ALLOWED_PLATFORMS = new Set(["macos", "windows", "other", "unknown"]);
const PUBLIC_PAGE_PATHS = new Set(["/", "/en/", "/guide/", "/demo/", "/privacy/"]);

const args = process.argv.slice(2);
const positional = args.filter((value, index) => !value.startsWith("--") && !String(args[index - 1] || "").startsWith("--"));
const statePath = positional[0] || "";

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

const outputPath = optionValue("--output");
const summaryPath = optionValue("--summary");
const nowValue = optionValue("--now");
const excludeInstallsPath = optionValue("--exclude-installs");

if (!statePath || (args.includes("--output") && !outputPath) || (args.includes("--summary") && !summaryPath)) {
  console.error("Usage: node import-usage-state.mjs /path/to/usage-state.json [--output /path/to/import.sql] [--summary /path/to/summary.json] [--now <epoch-ms | ISO date>] [--exclude-installs /path/to/excludes.txt]");
  process.exit(1);
}

const now = (() => {
  if (!nowValue) return Date.now();
  const numeric = Number(nowValue);
  const parsed = Number.isFinite(numeric) && nowValue.trim() !== "" ? numeric : Date.parse(nowValue);
  if (!Number.isFinite(parsed)) {
    console.error(`Invalid --now value: ${nowValue}`);
    process.exit(1);
  }
  return parsed;
})();

const excludedInstalls = new Set();
if (excludeInstallsPath) {
  try {
    const content = await readFile(excludeInstallsPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) excludedInstalls.add(trimmed);
    }
  } catch (error) {
    console.error(`Failed to read --exclude-installs file: ${error?.message || error}`);
    process.exit(1);
  }
}

function pairsToMap(value) {
  return new Map(Array.isArray(value) ? value : []);
}

function setPairsToMap(value) {
  return new Map((Array.isArray(value) ? value : []).map(([key, entries]) => [key, new Set(Array.isArray(entries) ? entries : [])]));
}

function countOf(value) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const raw = JSON.parse(await readFile(statePath, "utf8"));
if (raw?.schemaVersion !== STATE_SCHEMA_VERSION && raw?.schemaVersion !== 1) {
  console.error(`Unsupported state schemaVersion: ${raw?.schemaVersion}`);
  process.exit(1);
}

// Strict field whitelist: only read schemaVersion, coverageStart, updatedAt, and aggregate
const isV2 = raw.schemaVersion === STATE_SCHEMA_VERSION;
const aggregate = raw.aggregate && typeof raw.aggregate === "object" ? raw.aggregate : {};

const rawInstalls = pairsToMap(aggregate.installs);
const rawDownloadCounts = pairsToMap(aggregate.downloadCounts);
const rawRefCounts = pairsToMap(aggregate.refCounts);
const rawPageViewCounts = pairsToMap(aggregate.pageViewCounts);
const rawDailyActiveSets = isV2 ? setPairsToMap(aggregate.dailyActiveSets) : new Map();
const rawDailyFirstLaunchSets = isV2 ? setPairsToMap(aggregate.dailyFirstLaunchSets) : new Map();
const rawDailyDownloads = isV2 ? pairsToMap(aggregate.dailyDownloads) : new Map();
const rawDailyPageViews = isV2 ? pairsToMap(aggregate.dailyPageViews) : new Map();
const rawDailyHomePageViews = isV2 ? pairsToMap(aggregate.dailyHomePageViews) : new Map();
const rawHomePageViews = countOf(aggregate.homePageViews);

const PRE_EDGE_DAY = "pre-edge";
const OTHER_FILES_KEY = "other";
const installCutoff = now - 90 * DAY_MS;
const dailyCutoff = recentDayKeys(now, 32)[0];

const statements = [];

// 1. Idempotency cleanup: delete import-owned counters and markers
statements.push(
  "DELETE FROM counters WHERE day = 'pre-edge' OR kind IN ('download_all', 'page_all', 'home_page_all', 'import');"
);

// Track cleaning and summaries
let skippedTestInstalls = 0;
let importedInstalls = 0;
let droppedDownloadRequests = 0;
let refsMergedToOther = 0;
let otherFileNamesMerged = 0;

const foldTotals = { all: 0, platforms: new Map(), firstLaunches: 0 };
// Analytics days that actually hold legacy data. The state's coverageStart is
// only the trend baseline (data migrated into the state can be older), and
// updatedAt keeps moving while the old server's cron runs after the switch,
// so neither bounds the coverage on its own.
const dataDays = new Set();
const addDataDay = (timestamp) => {
  if (Number.isFinite(timestamp) && timestamp > 0) dataDays.add(analyticsDayKey(timestamp));
};

// Process installs
for (const [installId, record] of [...rawInstalls.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (installId.startsWith("00000000-") || excludedInstalls.has(installId)) {
    skippedTestInstalls += 1;
    continue;
  }
  if (!INSTALLATION_ID_PATTERN.test(installId)) continue;

  let last = Number(record?.last);
  if (!Number.isFinite(last)) last = now;
  let first = Number(record?.first);
  if (!Number.isFinite(first)) first = last;
  addDataDay(Number(record?.first));
  addDataDay(Number(record?.last));

  let platform = String(record?.platform || "unknown").toLowerCase();
  if (!ALLOWED_PLATFORMS.has(platform)) platform = "unknown";
  const arch = ARCH_PATTERN.test(String(record?.arch || "")) ? String(record.arch) : "unknown";
  const version = VERSION_PATTERN.test(String(record?.version || "")) ? String(record.version) : "unknown";
  const firstLaunch = record?.firstLaunch ? 1 : 0;

  importedInstalls += 1;

  if (last < installCutoff) {
    foldTotals.all += 1;
    foldTotals.platforms.set(platform, (foldTotals.platforms.get(platform) || 0) + 1);
    if (firstLaunch) foldTotals.firstLaunches += 1;
    continue;
  }

  statements.push(
    "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) VALUES (" +
      [
        sqlString(installId),
        Math.floor(first),
        Math.floor(last),
        sqlString(platform),
        sqlString(arch),
        sqlString(version),
        firstLaunch,
      ].join(", ") +
      ") ON CONFLICT(install_id) DO UPDATE SET " +
      "first_seen_at = MIN(installs.first_seen_at, excluded.first_seen_at), " +
      "last_seen_at = MAX(installs.last_seen_at, excluded.last_seen_at), " +
      "platform = CASE WHEN excluded.last_seen_at >= installs.last_seen_at THEN excluded.platform ELSE installs.platform END, " +
      "arch = CASE WHEN excluded.last_seen_at >= installs.last_seen_at THEN excluded.arch ELSE installs.arch END, " +
      "version = CASE WHEN excluded.last_seen_at >= installs.last_seen_at THEN excluded.version ELSE installs.version END, " +
      "first_launch = CASE WHEN installs.first_launch = 1 OR excluded.first_launch = 1 THEN 1 ELSE 0 END;"
  );
}

// Folded install counters
if (foldTotals.all) {
  statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_total', 'all', ${foldTotals.all});`);
}
for (const platform of [...foldTotals.platforms.keys()].sort()) {
  statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_platform', ${sqlString(platform)}, ${foldTotals.platforms.get(platform)});`);
}
if (foldTotals.firstLaunches) {
  statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_first_launch', 'all', ${foldTotals.firstLaunches});`);
}

// Process daily active sets
for (const day of [...rawDailyActiveSets.keys()].sort()) {
  if (!DAY_PATTERN.test(day) || day < dailyCutoff) continue;
  const firstLaunches = rawDailyFirstLaunchSets.get(day) || new Set();
  for (const installId of [...rawDailyActiveSets.get(day)].sort()) {
    if (installId.startsWith("00000000-") || excludedInstalls.has(installId)) continue;
    if (!INSTALLATION_ID_PATTERN.test(installId)) continue;
    const isFirstLaunch = firstLaunches.has(installId) ? 1 : 0;
    statements.push(
      "INSERT INTO daily_active (day, install_id, first_launch) VALUES (" +
        `${sqlString(day)}, ${sqlString(installId)}, ${isFirstLaunch}) ` +
        "ON CONFLICT(day, install_id) DO UPDATE SET " +
        "first_launch = MAX(daily_active.first_launch, excluded.first_launch);"
    );
  }
}

// Process downloads
const legacyDownloadsByFile = new Map();
const downloadByKind = { desktop: 0, update: 0, extension: 0, other: 0 };
for (const [file, rawCount] of [...rawDownloadCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const count = countOf(rawCount);
  if (!count) continue;
  if (
    typeof file !== "string"
    || file.includes("/")
    || file.includes("\\")
    || file.includes("..")
    || /[\x00-\x1f\x7f]/.test(file)
    || file.length > 128
  ) {
    droppedDownloadRequests += count;
    continue;
  }
  const kind = classifyDownload(file);
  downloadByKind[kind] = (downloadByKind[kind] || 0) + count;
  // Names that are not GravityPort/MOSA packages (probes, stray files,
  // "unknown") are summed under one key instead of being stored verbatim.
  let key = file;
  if (kind === "other") {
    key = OTHER_FILES_KEY;
    otherFileNamesMerged += 1;
  }
  legacyDownloadsByFile.set(key, (legacyDownloadsByFile.get(key) || 0) + count);
}
for (const [file, count] of [...legacyDownloadsByFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  statements.push(
    `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'legacy_download_file', ${sqlString(file)}, ${count});`
  );
}

// Process refs
const legacyDownloadsByRef = new Map();
for (const [ref, rawCount] of [...rawRefCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const count = countOf(rawCount);
  if (!count) continue;
  if (typeof ref === "string" && REF_PATTERN.test(ref)) {
    legacyDownloadsByRef.set(ref, (legacyDownloadsByRef.get(ref) || 0) + count);
  } else {
    legacyDownloadsByRef.set("other", (legacyDownloadsByRef.get("other") || 0) + count);
    refsMergedToOther += count;
  }
}
for (const [ref, count] of [...legacyDownloadsByRef.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  statements.push(
    `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'legacy_download_ref', ${sqlString(ref)}, ${count});`
  );
}

// Process page views
let legacyTotalPageViews = 0;
for (const [path, rawCount] of [...rawPageViewCounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const count = countOf(rawCount);
  if (!count || !PUBLIC_PAGE_PATHS.has(path)) continue;
  legacyTotalPageViews += count;
  statements.push(
    `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'legacy_page_path', ${sqlString(path)}, ${count});`
  );
}

// Legacy home page view all-time
if (rawHomePageViews > 0) {
  statements.push(
    `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'legacy_home_page', 'all', ${rawHomePageViews});`
  );
}

// Coverage start & end: the first and last analytics day holding legacy data
// (kept installs plus every non-empty daily bucket, before the 32-day trim).
for (const dailyMap of [rawDailyDownloads, rawDailyPageViews, rawDailyHomePageViews]) {
  for (const [day, value] of dailyMap) {
    if (DAY_PATTERN.test(day) && countOf(value)) dataDays.add(day);
  }
}
for (const [day, ids] of rawDailyActiveSets) {
  if (!DAY_PATTERN.test(day)) continue;
  for (const id of ids) {
    if (!id.startsWith("00000000-") && !excludedInstalls.has(id) && INSTALLATION_ID_PATTERN.test(id)) {
      dataDays.add(day);
      break;
    }
  }
}
const parsedCoverageStart = (() => {
  const num = Number(raw.coverageStart);
  if (Number.isFinite(num) && num > 0) return num;
  const parsed = Date.parse(raw.coverageStart);
  return Number.isFinite(parsed) ? parsed : NaN;
})();
const sortedDataDays = [...dataDays].sort();
const fallbackEnd = Date.parse(raw.updatedAt);
const coverageEndDay = sortedDataDays.at(-1) || analyticsDayKey(Number.isFinite(fallbackEnd) ? fallbackEnd : now);
const coverageStartDay = [sortedDataDays[0], Number.isFinite(parsedCoverageStart) ? analyticsDayKey(parsedCoverageStart) : ""]
  .filter(Boolean)
  .sort()[0] || coverageEndDay;

statements.push(
  `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(coverageStartDay)}, 'import', 'legacy_coverage_start', 1);`
);
statements.push(
  `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(coverageEndDay)}, 'import', 'legacy_coverage_end', 1);`
);
statements.push(
  `INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'import', 'usage_state', 1);`
);

// Daily trend totals (download_all, page_all, home_page_all)
const addPerDayRows = (dailyMap, kind) => {
  for (const day of [...dailyMap.keys()].sort()) {
    const count = countOf(dailyMap.get(day));
    if (!DAY_PATTERN.test(day) || !count || day < dailyCutoff) continue;
    statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(day)}, ${sqlString(kind)}, 'all', ${count});`);
  }
};
addPerDayRows(rawDailyDownloads, "download_all");
addPerDayRows(rawDailyPageViews, "page_all");
addPerDayRows(rawDailyHomePageViews, "home_page_all");

// Build summary
const allDailyKeys = new Set([
  ...rawDailyDownloads.keys(),
  ...rawDailyPageViews.keys(),
  ...rawDailyHomePageViews.keys(),
  ...rawDailyActiveSets.keys(),
]);
const summaryDaily = [...allDailyKeys]
  .filter((day) => DAY_PATTERN.test(day) && day >= dailyCutoff)
  .sort()
  .map((date) => {
    const activeSet = rawDailyActiveSets.get(date) || new Set();
    let validActive = 0;
    for (const id of activeSet) {
      if (!id.startsWith("00000000-") && !excludedInstalls.has(id) && INSTALLATION_ID_PATTERN.test(id)) {
        validActive += 1;
      }
    }
    return {
      date,
      downloads: countOf(rawDailyDownloads.get(date)),
      pageViews: countOf(rawDailyPageViews.get(date)),
      homePageViews: countOf(rawDailyHomePageViews.get(date)),
      activeInstalls: validActive,
    };
  });

const totalLegacyDownloadRequests = downloadByKind.desktop + downloadByKind.update + downloadByKind.extension + downloadByKind.other;

const summary = {
  coverageStart: coverageStartDay,
  coverageEnd: coverageEndDay,
  importedInstalls,
  skippedTestInstalls,
  desktopDownloadRequests: downloadByKind.desktop,
  updateDownloadRequests: downloadByKind.update,
  extensionDownloadRequests: downloadByKind.extension,
  otherDownloadRequests: downloadByKind.other,
  totalDownloadRequests: totalLegacyDownloadRequests,
  pageViews: legacyTotalPageViews,
  homePageViews: rawHomePageViews,
  daily: summaryDaily,
  droppedDownloadRequests,
  otherFileNamesMerged,
  refsMergedToOther,
};

const outputSql = `-- gp-stats legacy import generated by import-usage-state.mjs\n${statements.join("\n")}\n`;

if (outputPath) {
  await writeFile(outputPath, outputSql, { mode: 0o600 });
} else {
  process.stdout.write(outputSql);
}

if (summaryPath) {
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}
