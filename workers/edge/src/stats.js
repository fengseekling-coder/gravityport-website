// /admin/stats.json generation. The output shape (field names, meanings,
// sorting, the daily trend window) is the contract from scripts/report-usage.mjs;
// the admin page renders it without changes. Edge-only additions
// (pageViewsByReferrer/pageViewsByCountry/pageViewsByDevice/botPageViews/
// metricsNote) are omitted entirely while there is no edge data, so the same
// admin page keeps working against the old server's stats.json.

import { recentDayKeys, ANALYTICS_TIME_ZONE } from "./util.js";
import { classifyDownload } from "./counters.js";

const HOME_PAGE_PATHS = new Set(["/", "/en/"]);
const DATE_SHAPED_DAY_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";

/**
 * Sort entries by count descending then key ascending, exactly like
 * report-usage.mjs's mapToObject.
 * @param {Map<string, number>} map
 * @returns {Record<string, number>}
 */
function mapToObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

/**
 * @param {Iterable<[string, number]>} entries
 * @param {Map<string, number>} target
 */
function addToMap(entries, target) {
  for (const [key, count] of entries) target.set(key, (target.get(key) || 0) + Number(count || 0));
}

/**
 * Build the stats report from D1.
 * @param {{prepare: StatsDb["prepare"]}} env STATS binding.
 * @param {number} nowMs Report time, epoch milliseconds.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildStats(env, nowMs = Date.now()) {
  const db = env;
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
  const first = async (sql, ...values) => await db.prepare(sql).bind(...values).first();

  const installRows = await all("SELECT platform, arch, version, first_launch FROM installs");
  const foldedRows = await all(
    "SELECT kind, key, SUM(count) AS total FROM counters " +
      "WHERE kind IN ('install_total', 'install_platform', 'install_first_launch') GROUP BY kind, key"
  );
  const trendKeys = recentDayKeys(nowMs, 30);
  const dailyActiveRows = await all("SELECT day, install_id, first_launch FROM daily_active WHERE day >= ?", trendKeys[0]);
  const downloadFileRows = await all("SELECT day, key, count FROM counters WHERE kind = 'download_file'");
  const downloadRefRows = await all("SELECT key, SUM(count) AS total FROM counters WHERE kind = 'download_ref' GROUP BY key");
  const downloadAllRows = await all("SELECT day, SUM(count) AS total FROM counters WHERE kind = 'download_all' GROUP BY day");
  const pagePathRows = await all("SELECT day, key, count FROM counters WHERE kind = 'page_path'");
  const pageAllRows = await all("SELECT day, SUM(count) AS total FROM counters WHERE kind = 'page_all' GROUP BY day");
  const homeAllRows = await all("SELECT day, SUM(count) AS total FROM counters WHERE kind = 'home_page_all' GROUP BY day");
  const siteRows = await all(
    "SELECT kind, key, SUM(count) AS total FROM counters " +
      "WHERE kind IN ('page_referrer', 'page_country', 'page_device') AND day >= ? GROUP BY kind, key",
    trendKeys[0]
  );
  const botTotal = Number(((await first("SELECT SUM(count) AS total FROM counters WHERE kind = 'bot_page'")) || {}).total || 0);
  const imported = Boolean(await first("SELECT 1 AS marker FROM counters WHERE kind = 'import' LIMIT 1"));
  const earliestEdgePageDay = ((await first(
    `SELECT MIN(day) AS day FROM counters WHERE kind = 'page_path' AND day GLOB '${DATE_SHAPED_DAY_GLOB}'`
  )) || {}).day;
  const earliestCounterDay = ((await first(
    `SELECT MIN(day) AS day FROM counters WHERE day GLOB '${DATE_SHAPED_DAY_GLOB}'`
  )) || {}).day;
  const earliestDailyActiveDay = ((await first(
    `SELECT MIN(day) AS day FROM daily_active WHERE day GLOB '${DATE_SHAPED_DAY_GLOB}'`
  )) || {}).day;

  const folded = { install_total: new Map(), install_platform: new Map(), install_first_launch: new Map() };
  for (const row of foldedRows) {
    if (folded[row.kind]) folded[row.kind].set(row.key, Number(row.total) || 0);
  }

  const platformInstalls = new Map(folded.install_platform);
  const archInstalls = new Map();
  const versionInstalls = new Map();
  let liveFirstLaunches = 0;
  for (const install of installRows) {
    platformInstalls.set(install.platform, (platformInstalls.get(install.platform) || 0) + 1);
    archInstalls.set(install.arch, (archInstalls.get(install.arch) || 0) + 1);
    versionInstalls.set(install.version, (versionInstalls.get(install.version) || 0) + 1);
    if (Number(install.first_launch)) liveFirstLaunches += 1;
  }
  const knownInstallationInstances = installRows.length + [...folded.install_total.values()].reduce((sum, value) => sum + value, 0);
  const reportedFirstLaunches = liveFirstLaunches + [...folded.install_first_launch.values()].reduce((sum, value) => sum + value, 0);

  const activeByDay = new Map(trendKeys.map((day) => [day, new Set()]));
  const firstLaunchByDay = new Map(trendKeys.map((day) => [day, 0]));
  for (const row of dailyActiveRows) {
    const set = activeByDay.get(row.day);
    if (!set) continue;
    set.add(row.install_id);
    if (Number(row.first_launch)) firstLaunchByDay.set(row.day, (firstLaunchByDay.get(row.day) || 0) + 1);
  }

  const downloadsByFile = new Map();
  const downloadFileByDay = new Map();
  for (const row of downloadFileRows) {
    downloadsByFile.set(row.key, (downloadsByFile.get(row.key) || 0) + Number(row.count || 0));
    downloadFileByDay.set(row.day, (downloadFileByDay.get(row.day) || 0) + Number(row.count || 0));
  }
  const downloadsByRef = new Map();
  addToMap(downloadRefRows.map((row) => [row.key, Number(row.total) || 0]), downloadsByRef);
  const downloadAllByDay = new Map(downloadAllRows.map((row) => [row.day, Number(row.total) || 0]));

  // Download kinds are recomputed from the per-file counts, matching
  // report-usage.mjs's hydrateAggregate behavior.
  const desktopByFile = new Map();
  const extensionByFile = new Map();
  const otherByFile = new Map();
  for (const [file, count] of downloadsByFile) {
    const kind = classifyDownload(file);
    const target = kind === "desktop" ? desktopByFile : kind === "extension" ? extensionByFile : otherByFile;
    target.set(file, (target.get(file) || 0) + count);
  }

  const pageViewsByPath = new Map();
  const pagePathByDay = new Map();
  const homePageByDay = new Map();
  for (const row of pagePathRows) {
    const count = Number(row.count || 0);
    pageViewsByPath.set(row.key, (pageViewsByPath.get(row.key) || 0) + count);
    pagePathByDay.set(row.day, (pagePathByDay.get(row.day) || 0) + count);
    if (HOME_PAGE_PATHS.has(row.key)) homePageByDay.set(row.day, (homePageByDay.get(row.day) || 0) + count);
  }
  const pageAllByDay = new Map(pageAllRows.map((row) => [row.day, Number(row.total) || 0]));
  const homeAllByDay = new Map(homeAllRows.map((row) => [row.day, Number(row.total) || 0]));

  const siteByKind = { page_referrer: new Map(), page_country: new Map(), page_device: new Map() };
  for (const row of siteRows) {
    if (siteByKind[row.kind]) siteByKind[row.kind].set(row.key, Number(row.total) || 0);
  }

  const totalPageViews = [...pageViewsByPath.values()].reduce((sum, value) => sum + value, 0);
  const totalHomePageViews = [...pageViewsByPath.entries()]
    .filter(([path]) => HOME_PAGE_PATHS.has(path))
    .reduce((sum, [, count]) => sum + count, 0);
  const totalDownloadRequests = [...downloadsByFile.values()].reduce((sum, value) => sum + value, 0);
  const sumMap = (map) => [...map.values()].reduce((sum, value) => sum + value, 0);

  const daily = trendKeys.map((day) => ({
    date: day,
    firstLaunches: firstLaunchByDay.get(day) || 0,
    activeInstalls: (activeByDay.get(day) || new Set()).size,
    downloadRequests: (downloadFileByDay.get(day) || 0) + (downloadAllByDay.get(day) || 0),
    pageViews: (pagePathByDay.get(day) || 0) + (pageAllByDay.get(day) || 0),
    homePageViews: (homePageByDay.get(day) || 0) + (homeAllByDay.get(day) || 0),
  }));

  const coverageDays = [earliestCounterDay, earliestDailyActiveDay].filter(Boolean).sort();
  const coverageStart = coverageDays.length
    ? new Date(`${coverageDays[0]}T12:00:00Z`).toISOString()
    : new Date(nowMs).toISOString();

  /** @type {Record<string, unknown>} */
  const report = {
    schemaVersion: 2,
    generatedAt: new Date(nowMs).toISOString(),
    analyticsTimeZone: ANALYTICS_TIME_ZONE,
    coverageStart,
    migratedFromLegacy: imported,
    windowDays: 30,
    knownInstallationInstances,
    reportedFirstLaunches,
    dailyActiveInstalls: (activeByDay.get(trendKeys[trendKeys.length - 1]) || new Set()).size,
    activeInstalls7d: new Set(trendKeys.slice(-7).flatMap((day) => [...(activeByDay.get(day) || new Set())])).size,
    activeInstalls30d: new Set(trendKeys.flatMap((day) => [...(activeByDay.get(day) || new Set())])).size,
    platformInstalls: mapToObject(platformInstalls),
    archInstalls: mapToObject(archInstalls),
    versionInstalls: mapToObject(versionInstalls),
    downloadsByFile: mapToObject(downloadsByFile),
    downloadsByRef: mapToObject(downloadsByRef),
    desktopDownloadsByFile: mapToObject(desktopByFile),
    extensionDownloadsByFile: mapToObject(extensionByFile),
    pageViewsByPath: mapToObject(pageViewsByPath),
    totalPageViews,
    totalHomePageViews,
    homeToDownloadRate: totalHomePageViews > 0 ? totalDownloadRequests / totalHomePageViews : null,
    totalDownloadRequests,
    totalDesktopDownloadRequests: sumMap(desktopByFile),
    totalExtensionDownloadRequests: sumMap(extensionByFile),
    totalOtherDownloadRequests: sumMap(otherByFile),
    daily,
  };

  // Edge-only additions: left out while empty so the old server's stats.json
  // shape stays unchanged for the existing admin page.
  if (siteByKind.page_referrer.size) report.pageViewsByReferrer = mapToObject(siteByKind.page_referrer);
  if (siteByKind.page_country.size) report.pageViewsByCountry = mapToObject(siteByKind.page_country);
  if (siteByKind.page_device.size) report.pageViewsByDevice = mapToObject(siteByKind.page_device);
  if (botTotal > 0) report.botPageViews = botTotal;
  if (earliestEdgePageDay) report.metricsNote = `页面访问自 ${earliestEdgePageDay} 起改为边缘计数`;
  return report;
}
