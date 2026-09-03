#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const positional = args.filter((value, index) => !value.startsWith("--") && !String(args[index - 1] || "").startsWith("--"));
const logPath = positional[0] || "";

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

const outputPath = optionValue("--output");
const statePath = optionValue("--state");
const nowValue = optionValue("--now");
if (!logPath || (args.includes("--output") && !outputPath) || (args.includes("--state") && !statePath)) {
  console.error("Usage: node scripts/report-usage.mjs /path/to/nginx/access.log [--state /path/to/usage-state.json] [--output /path/to/admin/stats.json]");
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;
const STATE_SCHEMA_VERSION = 1;
const SOURCE_FINGERPRINT_BYTES = 64 * 1024;
const MAX_SOURCE_RECORDS = 256;
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE_EVENTS = new Set(["first_launch", "daily_active"]);
const DESKTOP_DOWNLOAD_PATTERN = /^MOSA-(?:darwin|win32)-[A-Za-z0-9._-]+\.zip$/;
const EXTENSION_DOWNLOAD_PATTERN = /^MOSA-Web-Capture-[A-Za-z0-9._-]+\.zip$/;

const now = (() => {
  if (!nowValue) return Date.now();
  const numeric = Number(nowValue);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(nowValue);
  if (!Number.isFinite(parsed)) {
    console.error(`Invalid --now value: ${nowValue}`);
    process.exit(1);
  }
  return parsed;
})();

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

function newAggregate() {
  return {
    installs: new Map(),
    downloadCounts: new Map(),
    desktopDownloadCounts: new Map(),
    extensionDownloadCounts: new Map(),
    otherDownloadCounts: new Map(),
    refCounts: new Map(),
    dailyDownloads: new Map(),
    dailyActiveSets: new Map(),
    dailyFirstLaunchSets: new Map(),
  };
}

function pairsToMap(value) {
  return new Map(Array.isArray(value) ? value : []);
}

function setPairsToMap(value) {
  return new Map((Array.isArray(value) ? value : []).map(([key, entries]) => [key, new Set(Array.isArray(entries) ? entries : [])]));
}

function hydrateAggregate(value) {
  if (!value || typeof value !== "object") return newAggregate();
  return {
    installs: pairsToMap(value.installs),
    downloadCounts: pairsToMap(value.downloadCounts),
    desktopDownloadCounts: pairsToMap(value.desktopDownloadCounts),
    extensionDownloadCounts: pairsToMap(value.extensionDownloadCounts),
    otherDownloadCounts: pairsToMap(value.otherDownloadCounts),
    refCounts: pairsToMap(value.refCounts),
    dailyDownloads: pairsToMap(value.dailyDownloads),
    dailyActiveSets: setPairsToMap(value.dailyActiveSets),
    dailyFirstLaunchSets: setPairsToMap(value.dailyFirstLaunchSets),
  };
}

function serializeAggregate(aggregate) {
  return {
    installs: [...aggregate.installs.entries()],
    downloadCounts: [...aggregate.downloadCounts.entries()],
    desktopDownloadCounts: [...aggregate.desktopDownloadCounts.entries()],
    extensionDownloadCounts: [...aggregate.extensionDownloadCounts.entries()],
    otherDownloadCounts: [...aggregate.otherDownloadCounts.entries()],
    refCounts: [...aggregate.refCounts.entries()],
    dailyDownloads: [...aggregate.dailyDownloads.entries()],
    dailyActiveSets: [...aggregate.dailyActiveSets.entries()].map(([key, entries]) => [key, [...entries]]),
    dailyFirstLaunchSets: [...aggregate.dailyFirstLaunchSets.entries()].map(([key, entries]) => [key, [...entries]]),
  };
}

async function loadState(path) {
  if (!path) return { sources: [], aggregate: newAggregate() };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.schemaVersion !== STATE_SCHEMA_VERSION) return { sources: [], aggregate: newAggregate() };
    return {
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      aggregate: hydrateAggregate(parsed.aggregate),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { sources: [], aggregate: newAggregate() };
    throw error;
  }
}

async function atomicWrite(path, content, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { mode });
  await rename(temporary, path);
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function fingerprintBuffer(buffer, processedBytes) {
  const length = Math.max(0, Math.min(processedBytes, buffer.length));
  if (length === 0) return { headSha256: "", tailSha256: "" };
  const sample = Math.min(SOURCE_FINGERPRINT_BYTES, length);
  return {
    headSha256: hashBuffer(buffer.subarray(0, sample)),
    tailSha256: hashBuffer(buffer.subarray(length - sample, length)),
  };
}

function fileKey(info) {
  return `${String(info.dev)}:${String(info.ino)}`;
}

function isRotatedLogName(name, primaryName) {
  if (name === primaryName) return true;
  if (!name.startsWith(primaryName)) return false;
  const suffix = name.slice(primaryName.length);
  return /^\.\d+(?:\.gz)?$/.test(suffix) || /^-\d{8}(?:\.gz)?$/.test(suffix);
}

async function discoverLogs(primaryPath) {
  const directory = dirname(primaryPath);
  const primaryName = basename(primaryPath);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isRotatedLogName(entry.name, primaryName)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path);
    files.push({
      path,
      name: entry.name,
      compressed: entry.name.endsWith(".gz"),
      mtimeMs: Number(info.mtimeMs) || 0,
      fileKey: fileKey(info),
    });
  }
  files.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  return files;
}

async function readLogBuffer(file) {
  const bytes = await readFile(file.path);
  return file.compressed ? gunzipSync(bytes) : bytes;
}

function fingerprintMatches(buffer, source) {
  const processedBytes = Number(source?.processedBytes) || 0;
  if (processedBytes < 0 || processedBytes > buffer.length) return false;
  if (processedBytes === 0) return !source.headSha256 && !source.tailSha256;
  const fingerprint = fingerprintBuffer(buffer, processedBytes);
  return fingerprint.headSha256 === source.headSha256 && fingerprint.tailSha256 === source.tailSha256;
}

function findResumeSource(buffer, file, sources) {
  const byFileKey = sources
    .filter((source) => source.fileKey === file.fileKey && fingerprintMatches(buffer, source))
    .sort((a, b) => (Number(b.processedBytes) || 0) - (Number(a.processedBytes) || 0))[0] || null;
  if (byFileKey) return byFileKey;

  let best = null;
  for (const source of sources) {
    const processedBytes = Number(source.processedBytes) || 0;
    if (processedBytes <= 0 || processedBytes > buffer.length) continue;
    if (best && processedBytes <= Number(best.processedBytes || 0)) continue;
    if (fingerprintMatches(buffer, source)) best = source;
  }
  return best;
}

function retireConflictingFileKeys(sources, file, matchedSource) {
  for (const source of sources) {
    if (source === matchedSource || source.fileKey !== file.fileKey) continue;
    source.fileKey = `retired:${source.fileKey}:${source.lastSeenAt || 0}:${source.processedBytes || 0}`;
  }
}

function completeByteLength(buffer, startOffset) {
  if (startOffset >= buffer.length) return startOffset;
  const tail = buffer.subarray(startOffset);
  const lastNewline = tail.lastIndexOf(0x0a);
  return lastNewline < 0 ? startOffset : startOffset + lastNewline + 1;
}

function classifyDownload(file) {
  if (EXTENSION_DOWNLOAD_PATTERN.test(file)) return "extension";
  if (DESKTOP_DOWNLOAD_PATTERN.test(file)) return "desktop";
  return "other";
}

function processLine(line, aggregate) {
  const parsed = parseRequestLine(line);
  if (!parsed) return;
  const { method, status, time, url } = parsed;

  if (url.pathname === "/releases/latest.json" && status >= 200 && status < 300) {
    const event = url.searchParams.get("event") || "";
    const installId = url.searchParams.get("install_id") || "";
    const platform = url.searchParams.get("platform") || "";
    const arch = url.searchParams.get("arch") || "";
    const version = url.searchParams.get("version") || "";
    if (!INSTALLATION_ID_PATTERN.test(installId) || !USAGE_EVENTS.has(event)) return;
    const current = aggregate.installs.get(installId) || {
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
    aggregate.installs.set(installId, current);
    const day = utcDayKey(time);
    if (!aggregate.dailyActiveSets.has(day)) aggregate.dailyActiveSets.set(day, new Set());
    aggregate.dailyActiveSets.get(day).add(installId);
    if (event === "first_launch") {
      if (!aggregate.dailyFirstLaunchSets.has(day)) aggregate.dailyFirstLaunchSets.set(day, new Set());
      aggregate.dailyFirstLaunchSets.get(day).add(installId);
    }
    return;
  }

  if (url.pathname.startsWith("/downloads/") && method === "GET" && status >= 200 && status < 400) {
    const file = decodeURIComponent(url.pathname.split("/").pop() || "unknown");
    const ref = url.searchParams.get("ref") || "direct";
    const kind = classifyDownload(file);
    increment(aggregate.downloadCounts, file);
    increment(aggregate.refCounts, ref);
    increment(aggregate.dailyDownloads, utcDayKey(time));
    if (kind === "desktop") increment(aggregate.desktopDownloadCounts, file);
    else if (kind === "extension") increment(aggregate.extensionDownloadCounts, file);
    else increment(aggregate.otherDownloadCounts, file);
  }
}

function pruneDailyMaps(aggregate) {
  const cutoff = new Date(now - (TREND_DAYS + 2) * DAY_MS).toISOString().slice(0, 10);
  for (const map of [aggregate.dailyDownloads, aggregate.dailyActiveSets, aggregate.dailyFirstLaunchSets]) {
    for (const key of map.keys()) {
      if (key < cutoff) map.delete(key);
    }
  }
}

function upsertSource(sources, matchedSource, file, buffer, processedBytes) {
  const fingerprint = fingerprintBuffer(buffer, processedBytes);
  const next = {
    fileKey: file.fileKey,
    pathHint: file.name,
    processedBytes,
    headSha256: fingerprint.headSha256,
    tailSha256: fingerprint.tailSha256,
    lastSeenAt: now,
  };
  if (matchedSource) {
    Object.assign(matchedSource, next);
    return;
  }
  sources.push(next);
}

function pruneSources(sources, seenFileKeys) {
  const recent = sources
    .filter((source) => seenFileKeys.has(source.fileKey) || now - (Number(source.lastSeenAt) || 0) < 120 * DAY_MS)
    .sort((a, b) => (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0));
  sources.splice(0, sources.length, ...recent.slice(0, MAX_SOURCE_RECORDS));
}

const state = await loadState(statePath);
const files = await discoverLogs(logPath);
if (!files.length) throw new Error(`No Nginx access logs found for ${logPath}`);
const seenFileKeys = new Set(files.map((file) => file.fileKey));

for (const file of files) {
  const buffer = await readLogBuffer(file);
  const matchedSource = findResumeSource(buffer, file, state.sources);
  retireConflictingFileKeys(state.sources, file, matchedSource);
  const startOffset = Number(matchedSource?.processedBytes) || 0;

  const endOffset = completeByteLength(buffer, startOffset);
  if (endOffset > startOffset) {
    const text = buffer.subarray(startOffset, endOffset).toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line) processLine(line, state.aggregate);
    }
  }
  upsertSource(state.sources, matchedSource, file, buffer, endOffset);
}

pruneDailyMaps(state.aggregate);
pruneSources(state.sources, seenFileKeys);

const activeWithin = (days) => [...state.aggregate.installs.values()].filter((item) => item.last >= now - days * DAY_MS).length;
const firstLaunches = [...state.aggregate.installs.values()].filter((item) => item.firstLaunch).length;
const platformInstalls = new Map();
const archInstalls = new Map();
const versionInstalls = new Map();
for (const install of state.aggregate.installs.values()) {
  increment(platformInstalls, install.platform || "unknown");
  increment(archInstalls, install.arch || "unknown");
  increment(versionInstalls, install.version || "unknown");
}
const daily = dailyWindow(TREND_DAYS).map((date) => ({
  date,
  firstLaunches: state.aggregate.dailyFirstLaunchSets.get(date)?.size || 0,
  activeInstalls: state.aggregate.dailyActiveSets.get(date)?.size || 0,
  downloadRequests: state.aggregate.dailyDownloads.get(date) || 0,
}));

const sumMap = (map) => [...map.values()].reduce((sum, value) => sum + Number(value || 0), 0);
const report = {
  generatedAt: new Date(now).toISOString(),
  windowDays: TREND_DAYS,
  anonymousInstalls: state.aggregate.installs.size,
  reportedFirstLaunches: firstLaunches,
  dau24h: activeWithin(1),
  wau7d: activeWithin(7),
  mau30d: activeWithin(30),
  platformInstalls: mapToObject(platformInstalls),
  archInstalls: mapToObject(archInstalls),
  versionInstalls: mapToObject(versionInstalls),
  downloadsByFile: mapToObject(state.aggregate.downloadCounts),
  downloadsByRef: mapToObject(state.aggregate.refCounts),
  desktopDownloadsByFile: mapToObject(state.aggregate.desktopDownloadCounts),
  extensionDownloadsByFile: mapToObject(state.aggregate.extensionDownloadCounts),
  totalDownloadRequests: sumMap(state.aggregate.downloadCounts),
  totalDesktopDownloadRequests: sumMap(state.aggregate.desktopDownloadCounts),
  totalExtensionDownloadRequests: sumMap(state.aggregate.extensionDownloadCounts),
  totalOtherDownloadRequests: sumMap(state.aggregate.otherDownloadCounts),
  daily,
};

if (statePath) {
  const serializedState = `${JSON.stringify({
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: new Date(now).toISOString(),
    sources: state.sources,
    aggregate: serializeAggregate(state.aggregate),
  })}\n`;
  await atomicWrite(statePath, serializedState, 0o600);
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (!outputPath) {
  process.stdout.write(serialized);
} else {
  await atomicWrite(outputPath, serialized, 0o644);
  console.log(`Wrote ${outputPath}`);
}
