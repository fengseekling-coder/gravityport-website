#!/usr/bin/env node
// Convert a scripts/report-usage.mjs state file (usage-state.json) into SQL
// for `wrangler d1 execute --file`. Run by Claude during step B5 of the 279
// migration; real state files never enter the repository.
//
// Import rules (mirroring the gp-edge maintenance job):
// - installations not seen for more than 90 days are folded into the
//   cumulative install_total / install_platform / install_first_launch
//   counters instead of becoming installs rows;
// - the daily activity set only imports its 32 most recent analytics days;
// - per-day totals that exist in the old state without a breakdown
//   (dailyDownloads, dailyPageViews, dailyHomePageViews) import as the
//   download_all / page_all / home_page_all counter kinds so the 30-day trend
//   keeps its history;
// - all-time totals that cannot be split by day (downloads by file, refs,
//   page views by path) go onto the fixed "pre-edge" analytics day.

import { readFile, writeFile } from "node:fs/promises";
import { DAY_MS, recentDayKeys } from "../src/util.js";

const STATE_SCHEMA_VERSION = 2;
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const args = process.argv.slice(2);
const positional = args.filter((value, index) => !value.startsWith("--") && !String(args[index - 1] || "").startsWith("--"));
const statePath = positional[0] || "";

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

const outputPath = optionValue("--output");
const nowValue = optionValue("--now");
if (!statePath || (args.includes("--output") && !outputPath)) {
  console.error("Usage: node import-usage-state.mjs /path/to/usage-state.json [--output /path/to/import.sql] [--now <epoch-ms | ISO date>]");
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
const aggregate = raw.aggregate || {};
const isV2 = raw.schemaVersion === STATE_SCHEMA_VERSION;

const installs = pairsToMap(aggregate.installs);
const downloadCounts = pairsToMap(aggregate.downloadCounts);
const refCounts = pairsToMap(aggregate.refCounts);
const pageViewCounts = pairsToMap(aggregate.pageViewCounts);
// Legacy (v1) state kept UTC day buckets that must not mix with the Los
// Angeles analytics days, so they are discarded like report-usage.mjs does.
const dailyActiveSets = isV2 ? setPairsToMap(aggregate.dailyActiveSets) : new Map();
const dailyFirstLaunchSets = isV2 ? setPairsToMap(aggregate.dailyFirstLaunchSets) : new Map();
const dailyDownloads = isV2 ? pairsToMap(aggregate.dailyDownloads) : new Map();
const dailyPageViews = isV2 ? pairsToMap(aggregate.dailyPageViews) : new Map();
const dailyHomePageViews = isV2 ? pairsToMap(aggregate.dailyHomePageViews) : new Map();

const PRE_EDGE_DAY = "pre-edge";
const installCutoff = now - 90 * DAY_MS;
const dailyCutoff = recentDayKeys(now, 32)[0];

const statements = [];
const foldTotals = { all: 0, platforms: new Map(), firstLaunches: 0 };

for (const [installId, record] of [...installs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (!INSTALLATION_ID_PATTERN.test(installId)) continue;
  // Non-finite first/last can only come from a hand-written state; keep the
  // installation (and therefore the totals) by anchoring it at import time.
  let last = Number(record.last);
  if (!Number.isFinite(last)) last = now;
  let first = Number(record.first);
  if (!Number.isFinite(first)) first = last;
  const platform = String(record.platform || "unknown");
  if (last < installCutoff) {
    foldTotals.all += 1;
    foldTotals.platforms.set(platform, (foldTotals.platforms.get(platform) || 0) + 1);
    if (record.firstLaunch) foldTotals.firstLaunches += 1;
    continue;
  }
  statements.push(
    "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) VALUES (" +
      [
        sqlString(installId),
        Math.floor(first),
        Math.floor(last),
        sqlString(platform),
        sqlString(record.arch || "unknown"),
        sqlString(record.version || "unknown"),
        record.firstLaunch ? 1 : 0,
      ].join(", ") +
      ");"
  );
}

if (foldTotals.all) statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_total', 'all', ${foldTotals.all});`);
for (const platform of [...foldTotals.platforms.keys()].sort()) {
  statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_platform', ${sqlString(platform)}, ${foldTotals.platforms.get(platform)});`);
}
if (foldTotals.firstLaunches) {
  statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'install_first_launch', 'all', ${foldTotals.firstLaunches});`);
}

for (const day of [...dailyActiveSets.keys()].sort()) {
  if (!DAY_PATTERN.test(day) || day < dailyCutoff) continue;
  const firstLaunches = dailyFirstLaunchSets.get(day) || new Set();
  for (const installId of [...dailyActiveSets.get(day)].sort()) {
    statements.push(
      "INSERT INTO daily_active (day, install_id, first_launch) VALUES (" +
        `${sqlString(day)}, ${sqlString(installId)}, ${firstLaunches.has(installId) ? 1 : 0});`
    );
  }
}

const perDayRows = (dailyMap, kind) => {
  for (const day of [...dailyMap.keys()].sort()) {
    const count = countOf(dailyMap.get(day));
    if (!DAY_PATTERN.test(day) || !count) continue;
    statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(day)}, ${sqlString(kind)}, 'all', ${count});`);
  }
};
perDayRows(dailyDownloads, "download_all");
perDayRows(dailyPageViews, "page_all");
perDayRows(dailyHomePageViews, "home_page_all");

const allTimeRows = (sourceMap, kind) => {
  for (const key of [...sourceMap.keys()].sort((a, b) => String(a).localeCompare(String(b)))) {
    const count = countOf(sourceMap.get(key));
    if (!count) continue;
    statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, ${sqlString(kind)}, ${sqlString(key)}, ${count});`);
  }
};
allTimeRows(downloadCounts, "download_file");
allTimeRows(refCounts, "download_ref");
allTimeRows(pageViewCounts, "page_path");

statements.push(`INSERT INTO counters (day, kind, key, count) VALUES (${sqlString(PRE_EDGE_DAY)}, 'import', 'usage_state', 1);`);

const output = `-- gp-stats import generated by import-usage-state.mjs\n${statements.join("\n")}\n`;
if (outputPath) {
  await writeFile(outputPath, output, { mode: 0o600 });
  console.log(`Wrote ${outputPath} (${statements.length} statements)`);
} else {
  process.stdout.write(output);
}
