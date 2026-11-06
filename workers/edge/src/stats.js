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
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseSemver(value) {
  const match = SEMVER_PATTERN.exec(String(value || ""));
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareNumericIdentifiers(left, right) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

/**
 * Compare two semantic version strings (ascending: < 0 if left < right).
 * @param {string} leftValue
 * @param {string} rightValue
 * @returns {number}
 */
export function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left && !right) return String(leftValue).localeCompare(String(rightValue));
  if (!left) return -1;
  if (!right) return 1;

  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }

  if (!left.prerelease.length || !right.prerelease.length) {
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightNumeric ? rightPart : "");
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

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

  const installRows = await all("SELECT install_id, platform, arch, version, first_launch FROM installs");
  const installVersionStats = await all(
    "SELECT version, MIN(first_seen_at) AS first_seen_at, COUNT(DISTINCT install_id) AS ever_reached " +
      "FROM install_versions GROUP BY version"
  );
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
      "WHERE kind IN ('page_referrer', 'page_country', 'page_device') GROUP BY kind, key"
  );
  const botTotal = Number(((await first("SELECT SUM(count) AS total FROM counters WHERE kind = 'bot_page'")) || {}).total || 0);
  const imported = Boolean(await first("SELECT 1 AS marker FROM counters WHERE kind = 'import' LIMIT 1"));
  const legacyRows = await all(
    "SELECT kind, key, count FROM counters " +
      "WHERE kind IN ('legacy_download_file', 'legacy_download_ref', 'legacy_page_path', 'legacy_home_page')"
  );
  const legacyCoverageRows = await all(
    "SELECT key, day FROM counters WHERE kind = 'import' AND key IN ('legacy_coverage_start', 'legacy_coverage_end')"
  );
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
  const currentVersionByInstallId = new Map();
  let liveFirstLaunches = 0;
  for (const install of installRows) {
    platformInstalls.set(install.platform, (platformInstalls.get(install.platform) || 0) + 1);
    archInstalls.set(install.arch, (archInstalls.get(install.arch) || 0) + 1);
    versionInstalls.set(install.version, (versionInstalls.get(install.version) || 0) + 1);
    currentVersionByInstallId.set(install.install_id, install.version);
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
  // Per-day trend input excludes in-app update zips (the legacy download_all
  // rows cannot be split, see the daily mapping below).
  const downloadFileByDay = new Map();
  const installAndExtensionFileByDay = new Map();
  for (const row of downloadFileRows) {
    const count = Number(row.count || 0);
    downloadsByFile.set(row.key, (downloadsByFile.get(row.key) || 0) + count);
    const kind = classifyDownload(row.key);
    if (kind !== "update") {
      downloadFileByDay.set(row.day, (downloadFileByDay.get(row.day) || 0) + count);
    }
    if (kind === "desktop" || kind === "extension") {
      installAndExtensionFileByDay.set(row.day, (installAndExtensionFileByDay.get(row.day) || 0) + count);
    }
  }
  const downloadsByRef = new Map();
  addToMap(downloadRefRows.map((row) => [row.key, Number(row.total) || 0]), downloadsByRef);
  const downloadAllByDay = new Map(downloadAllRows.map((row) => [row.day, Number(row.total) || 0]));

  // Download kinds are recomputed from the per-file counts, matching
  // report-usage.mjs's hydrateAggregate behavior.
  const desktopByFile = new Map();
  const updateByFile = new Map();
  const extensionByFile = new Map();
  const otherByFile = new Map();
  for (const [file, count] of downloadsByFile) {
    const kind = classifyDownload(file);
    const target =
      kind === "desktop" ? desktopByFile : kind === "update" ? updateByFile : kind === "extension" ? extensionByFile : otherByFile;
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
  const totalDesktopDownloadRequests = sumMap(desktopByFile);
  const totalExtensionDownloadRequests = sumMap(extensionByFile);

  const daily = trendKeys.map((day) => {
    const homeViews = (homePageByDay.get(day) || 0) + (homeAllByDay.get(day) || 0);
    const installDownloads = installAndExtensionFileByDay.get(day) || 0;
    // Daily conversion rate: (installer downloads + extension downloads) / home page views.
    // null when home page views are 0.
    const conversionRate = homeViews > 0 ? installDownloads / homeViews : null;
    return {
      date: day,
      firstLaunches: firstLaunchByDay.get(day) || 0,
      activeInstalls: (activeByDay.get(day) || new Set()).size,
      // Edge-era days recompute the per-file counts minus in-app update zips;
      // legacy days only carry download_all, which cannot be split by kind, so
      // the line mixes the two methodologies at the 2026-10-29 switchover.
      downloadRequests: (downloadFileByDay.get(day) || 0) + (downloadAllByDay.get(day) || 0),
      pageViews: (pagePathByDay.get(day) || 0) + (pageAllByDay.get(day) || 0),
      homePageViews: homeViews,
      conversionRate,
      homeToDownloadRate: conversionRate,
    };
  });

  const coverageDays = [earliestCounterDay, earliestDailyActiveDay].filter(Boolean).sort();
  const coverageStart = coverageDays.length
    ? new Date(`${coverageDays[0]}T12:00:00Z`).toISOString()
    : new Date(nowMs).toISOString();

  const active7dIds = new Set(trendKeys.slice(-7).flatMap((day) => [...(activeByDay.get(day) || new Set())]));
  const active30dIds = new Set(trendKeys.flatMap((day) => [...(activeByDay.get(day) || new Set())]));
  const active7dByVersion = new Map();
  for (const installId of active7dIds) {
    const ver = currentVersionByInstallId.get(installId);
    if (ver) active7dByVersion.set(ver, (active7dByVersion.get(ver) || 0) + 1);
  }

  const versionStatsByVer = new Map();
  for (const row of installVersionStats) {
    if (!row.version || row.version === "unknown" || !parseSemver(row.version)) continue;
    versionStatsByVer.set(row.version, {
      firstSeenAt: row.first_seen_at !== null && row.first_seen_at !== undefined ? Number(row.first_seen_at) : null,
      everReached: Number(row.ever_reached) || 0,
    });
  }
  for (const [ver] of versionInstalls) {
    if (!ver || ver === "unknown" || !parseSemver(ver)) continue;
    if (!versionStatsByVer.has(ver)) {
      versionStatsByVer.set(ver, { firstSeenAt: null, everReached: 0 });
    }
  }
  const rollout = [...versionStatsByVer.keys()]
    .sort((a, b) => compareSemver(b, a))
    .slice(0, 5)
    .map((ver) => {
      const info = versionStatsByVer.get(ver);
      const activeCount = active7dByVersion.get(ver) || 0;
      return {
        version: ver,
        firstSeenAt: info.firstSeenAt,
        currentInstalls: versionInstalls.get(ver) || 0,
        everReached: info.everReached,
        shareOfActive7d: active7dIds.size > 0 ? activeCount / active7dIds.size : 0,
      };
    });

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
    activeInstalls7d: active7dIds.size,
    activeInstalls30d: active30dIds.size,
    platformInstalls: mapToObject(platformInstalls),
    archInstalls: mapToObject(archInstalls),
    versionInstalls: mapToObject(versionInstalls),
    rollout,
    downloadsByFile: mapToObject(downloadsByFile),
    downloadsByRef: mapToObject(downloadsByRef),
    desktopDownloadsByFile: mapToObject(desktopByFile),
    updateDownloadsByFile: mapToObject(updateByFile),
    extensionDownloadsByFile: mapToObject(extensionByFile),
    pageViewsByPath: mapToObject(pageViewsByPath),
    totalPageViews,
    totalHomePageViews,
    // The rate compares what the website offers (installer + extension
    // downloads) with home page views; in-app update zips are not a website
    // conversion.
    homeToDownloadRate: totalHomePageViews > 0 ? (totalDesktopDownloadRequests + totalExtensionDownloadRequests) / totalHomePageViews : null,
    totalDownloadRequests,
    totalDesktopDownloadRequests,
    totalUpdateDownloadRequests: sumMap(updateByFile),
    totalExtensionDownloadRequests,
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

  if (legacyCoverageRows.length > 0 || legacyRows.length > 0) {
    const coverageStart = legacyCoverageRows.find((r) => r.key === "legacy_coverage_start")?.day || "";
    const coverageEnd = legacyCoverageRows.find((r) => r.key === "legacy_coverage_end")?.day || "";

    const legacyDesktopByFile = new Map();
    const legacyUpdateByFile = new Map();
    const legacyExtensionByFile = new Map();
    const legacyOtherByFile = new Map();
    const legacyDownloadsByFile = new Map();
    const legacyDownloadsByRef = new Map();
    let legacyPageViews = 0;
    let legacyHomePageViews = 0;

    for (const row of legacyRows) {
      const count = Number(row.count || 0);
      if (row.kind === "legacy_download_file") {
        legacyDownloadsByFile.set(row.key, (legacyDownloadsByFile.get(row.key) || 0) + count);
        const kind = classifyDownload(row.key);
        if (kind === "desktop") legacyDesktopByFile.set(row.key, (legacyDesktopByFile.get(row.key) || 0) + count);
        else if (kind === "update") legacyUpdateByFile.set(row.key, (legacyUpdateByFile.get(row.key) || 0) + count);
        else if (kind === "extension") legacyExtensionByFile.set(row.key, (legacyExtensionByFile.get(row.key) || 0) + count);
        else legacyOtherByFile.set(row.key, (legacyOtherByFile.get(row.key) || 0) + count);
      } else if (row.kind === "legacy_download_ref") {
        legacyDownloadsByRef.set(row.key, (legacyDownloadsByRef.get(row.key) || 0) + count);
      } else if (row.kind === "legacy_page_path") {
        legacyPageViews += count;
      } else if (row.kind === "legacy_home_page") {
        legacyHomePageViews += count;
      }
    }

    report.legacy = {
      coverageStart,
      coverageEnd,
      pageViews: legacyPageViews,
      homePageViews: legacyHomePageViews,
      desktopDownloads: sumMap(legacyDesktopByFile),
      updateDownloads: sumMap(legacyUpdateByFile),
      extensionDownloads: sumMap(legacyExtensionByFile),
      otherDownloads: sumMap(legacyOtherByFile),
      downloadsByFile: mapToObject(legacyDownloadsByFile),
      downloadsByRef: mapToObject(legacyDownloadsByRef),
    };
  }

  return report;
}
