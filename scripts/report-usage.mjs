#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const logPath = args.find((value) => !value.startsWith("--"));
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
if (!logPath || (outputIndex >= 0 && !outputPath)) {
  console.error("Usage: node scripts/report-usage.mjs /path/to/nginx/access.log [--output /path/to/admin/stats.json]");
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const TREND_DAYS = 30;

function parseNginxTimestamp(value) {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(value);
  if (!match) return NaN;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = months[match[2]];
  if (month === undefined) return NaN;
  const sign = match[7][0] === "-" ? -1 : 1;
  const offsetMinutes = sign * (Number(match[7].slice(1, 3)) * 60 + Number(match[7].slice(3, 5)));
  return Date.UTC(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])) - offsetMinutes * 60_000;
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function utcDayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dailyWindow(days) {
  const result = [];
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    result.push(new Date(today.getTime() - offset * DAY_MS).toISOString().slice(0, 10));
  }
  return result;
}

function parseRequestLine(line) {
  const timestamp = line.match(/\[([^\]]+)\]/)?.[1] || "";
  const requestMatch = line.match(/"(GET|HEAD) ([^ ]+) HTTP\/[0-9.]+"\s+(\d{3})\b/);
  if (!requestMatch) return null;
  const time = parseNginxTimestamp(timestamp);
  if (!Number.isFinite(time)) return null;
  let url;
  try { url = new URL(requestMatch[2], "https://mosa.azhuilab.com"); } catch { return null; }
  return { method: requestMatch[1], status: Number(requestMatch[3]), time, url };
}

const content = await readFile(logPath, "utf8");
const installs = new Map();
const downloadCounts = new Map();
const refCounts = new Map();
const dailyDownloads = new Map();
const dailyActiveSets = new Map();
const dailyFirstLaunchSets = new Map();

for (const line of content.split(/\r?\n/)) {
  if (!line) continue;
  const parsed = parseRequestLine(line);
  if (!parsed) continue;
  const { method, status, time, url } = parsed;

  if (url.pathname === "/releases/latest.json") {
    const event = url.searchParams.get("event") || "";
    const installId = url.searchParams.get("install_id") || "";
    const platform = url.searchParams.get("platform") || "";
    const arch = url.searchParams.get("arch") || "";
    const version = url.searchParams.get("version") || "";
    if (!/^[0-9a-f-]{36}$/i.test(installId) || !["first_launch", "daily_active"].includes(event)) continue;
    const current = installs.get(installId) || {
      first: Infinity,
      last: -Infinity,
      firstLaunch: false,
      platform: "unknown",
      arch: "unknown",
      version: "unknown",
    };
    current.first = Math.min(current.first, time);
    if (time >= current.last) {
      current.last = time;
      current.platform = platform || current.platform;
      current.arch = arch || current.arch;
      current.version = version || current.version;
    }
    current.firstLaunch ||= event === "first_launch";
    installs.set(installId, current);
    const day = utcDayKey(time);
    if (!dailyActiveSets.has(day)) dailyActiveSets.set(day, new Set());
    dailyActiveSets.get(day).add(installId);
    if (event === "first_launch") {
      if (!dailyFirstLaunchSets.has(day)) dailyFirstLaunchSets.set(day, new Set());
      dailyFirstLaunchSets.get(day).add(installId);
    }
    continue;
  }

  if (url.pathname.startsWith("/downloads/") && method === "GET" && status >= 200 && status < 400) {
    const file = decodeURIComponent(url.pathname.split("/").pop() || "unknown");
    const ref = url.searchParams.get("ref") || "direct";
    increment(downloadCounts, file);
    increment(refCounts, ref);
    increment(dailyDownloads, utcDayKey(time));
  }
}

const activeWithin = (days) => [...installs.values()].filter((item) => item.last >= now - days * DAY_MS).length;
const firstLaunches = [...installs.values()].filter((item) => item.firstLaunch).length;
const platformInstalls = new Map();
const archInstalls = new Map();
const versionInstalls = new Map();
for (const install of installs.values()) {
  increment(platformInstalls, install.platform || "unknown");
  increment(archInstalls, install.arch || "unknown");
  increment(versionInstalls, install.version || "unknown");
}
const daily = dailyWindow(TREND_DAYS).map((date) => ({
  date,
  firstLaunches: dailyFirstLaunchSets.get(date)?.size || 0,
  activeInstalls: dailyActiveSets.get(date)?.size || 0,
  downloadRequests: dailyDownloads.get(date) || 0,
}));

const report = {
  generatedAt: new Date(now).toISOString(),
  windowDays: TREND_DAYS,
  anonymousInstalls: installs.size,
  reportedFirstLaunches: firstLaunches,
  dau24h: activeWithin(1),
  wau7d: activeWithin(7),
  mau30d: activeWithin(30),
  platformInstalls: mapToObject(platformInstalls),
  archInstalls: mapToObject(archInstalls),
  versionInstalls: mapToObject(versionInstalls),
  downloadsByFile: mapToObject(downloadCounts),
  downloadsByRef: mapToObject(refCounts),
  totalDownloadRequests: [...downloadCounts.values()].reduce((sum, value) => sum + value, 0),
  daily,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (!outputPath) {
  process.stdout.write(serialized);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporary, serialized, { mode: 0o644 });
  await rename(temporary, outputPath);
  console.log(`Wrote ${outputPath}`);
}
