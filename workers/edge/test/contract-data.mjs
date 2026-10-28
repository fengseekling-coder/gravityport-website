// Synthetic data for the contract test. Shared between the vitest config
// (plain Node: writes the access log, runs scripts/report-usage.mjs) and the
// tests (workerd: replays the same events against the Worker). Pure data only
// — no Node built-ins, so workerd can import it too.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * nginx log timestamp for an epoch-ms value, in UTC ("02/Sep/2026:09:00:00 +0000").
 * @param {number} timestamp
 * @returns {string}
 */
export function nginxTimestamp(timestamp) {
  const date = new Date(timestamp);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const pad = (value) => String(value).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}:${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/**
 * @param {number} timestamp
 * @param {string} method
 * @param {string} target Request target including the query string.
 * @param {number} status
 * @param {number} bytes
 * @returns {string}
 */
export function logLine(timestamp, method, target, status, bytes) {
  return `127.0.0.1 - - [${nginxTimestamp(timestamp)}] "${method} ${target} HTTP/1.1" ${status} ${bytes} "-" "contract-test"\n`;
}

/** Install ids that satisfy the telemetry UUID contract. */
export const ID_A = "123e4567-e89b-42d3-a456-426614174000";
export const ID_B = "223e4567-e89b-42d3-a456-426614174001";
export const ID_C = "323e4567-e89b-42d3-a456-426614174002";

const HOME_BYTES = 24_977;

/**
 * Build the whole contract scenario relative to a moment inside one analytics
 * day. Every event in `requests`/`pages` appears in `logText` with the same
 * shape, so both processors see identical input.
 * @param {number} nowMs Anchor moment, epoch milliseconds.
 */
export function buildContractData(nowMs) {
  const t = (seconds) => nowMs + seconds * 1000;
  const telemetryQuery = (event, installId, platform, arch, version, telemetryVersion = "2") =>
    `?event=${event}&telemetry_version=${telemetryVersion}&install_id=${installId}&platform=${platform}&arch=${arch}&version=${version}`;

  /** @type {{method: string, path: string}[]} */
  const requests = [
    // Telemetry: valid HEAD and GET against both feed paths, then rejects.
    { method: "HEAD", path: `/releases/latest.json${telemetryQuery("first_launch", ID_A, "macos", "arm64", "0.3.7")}` },
    { method: "HEAD", path: `/releases/gravityport/latest.json${telemetryQuery("daily_active", ID_A, "macos", "arm64", "0.3.7")}` },
    { method: "GET", path: `/releases/gravityport/latest.json${telemetryQuery("daily_active", ID_B, "windows", "x86_64", "0.3.4")}` },
    { method: "GET", path: `/releases/latest.json${telemetryQuery("first_launch", "not-a-uuid", "macos", "arm64", "0.3.7")}` },
    { method: "GET", path: `/releases/latest.json${telemetryQuery("page_view", ID_A, "macos", "arm64", "0.3.7")}` },
    { method: "GET", path: `/releases/latest.json${telemetryQuery("first_launch", ID_A, "macos", "x".repeat(25), "0.3.7")}` },
    { method: "GET", path: `/releases/latest.json${telemetryQuery("first_launch", ID_A, "macos", "arm64", "1.2.3.4")}` },
    // Legacy v1 telemetry: recorded as an installation, not in the daily sets.
    { method: "HEAD", path: `/releases/latest.json${telemetryQuery("first_launch", ID_C, "other", "x86", "0.2.1", "1")}` },
    // Downloads: 200 with ref, 206 range without ref, empty ref, extension
    // package, MOSA package, "other" file, HEAD (not counted), missing (404).
    { method: "GET", path: "/downloads/GravityPort-darwin-arm64-0.3.7.zip?ref=bilibili" },
    { method: "GET", path: "/downloads/GravityPort-darwin-arm64-0.3.7.zip", range: "bytes=0-99" },
    { method: "GET", path: "/downloads/GravityPort-win32-x64-0.3.7.exe?ref=" },
    { method: "GET", path: "/downloads/GravityPort-Web-Capture-0.15.41.zip?ref=xiaohongshu" },
    { method: "GET", path: "/downloads/MOSA-darwin-arm64-0.3.0-rc.1.zip" },
    { method: "GET", path: "/downloads/notes.txt" },
    { method: "HEAD", path: "/downloads/GravityPort-darwin-arm64-0.3.7.zip" },
    { method: "GET", path: "/downloads/missing-file.zip" },
  ];

  /** @type {{path: string, bytes: number}[]} */
  const pages = [
    { path: "/", bytes: HOME_BYTES },
    { path: "/en/", bytes: 25_120 },
    { path: "/?ref=bilibili", bytes: HOME_BYTES },
    { path: "/index.html", bytes: HOME_BYTES },
    { path: "/guide/", bytes: 5_166 },
    { path: "/demo/", bytes: 19_049 },
    { path: "/privacy/", bytes: 17_276 },
  ];

  let logText = "";
  let second = 0;
  for (const request of requests) {
    const status = request.path === "/downloads/missing-file.zip" ? 404 : 200;
    logText += logLine(t(second++), request.method, request.path, status, 123);
  }
  for (const page of pages) {
    logText += logLine(t(second++), "GET", page.path, 200, page.bytes);
  }

  return { requests, pages, logText };
}

/**
 * Synthetic usage-state.json for the import-script test (all install ids and
 * file names are fictional).
 * @param {number} nowMs
 * @param {(timestamp: number) => string} dayKey Analytics day key function.
 */
export function buildImportState(nowMs, dayKey) {
  const ID_D = "423e4567-e89b-42d3-a456-426614174003";
  const ID_E = "523e4567-e89b-42d3-a456-426614174004";
  const ID_F = "623e4567-e89b-42d3-a456-426614174005";
  return {
    schemaVersion: 2,
    updatedAt: new Date(nowMs).toISOString(),
    coverageStart: nowMs,
    sources: [],
    aggregate: {
      installs: [
        [ID_D, { first: nowMs - 40 * 24 * 3600 * 1000, last: nowMs - 5 * 24 * 3600 * 1000, firstLaunch: true, platform: "macos", arch: "arm64", version: "0.3.5" }],
        [ID_E, { first: nowMs - 100 * 24 * 3600 * 1000, last: nowMs - 100 * 24 * 3600 * 1000, firstLaunch: false, platform: "windows", arch: "x64", version: "0.3.0" }],
        [ID_F, { first: nowMs - 120 * 24 * 3600 * 1000, last: nowMs - 110 * 24 * 3600 * 1000, firstLaunch: true, platform: "macos", arch: "arm64", version: "0.2.1" }],
      ],
      downloadCounts: [["GravityPort-darwin-arm64-0.3.5.zip", 7], ["robots.txt", 3]],
      desktopDownloadCounts: [["GravityPort-darwin-arm64-0.3.5.zip", 7]],
      extensionDownloadCounts: [],
      otherDownloadCounts: [["robots.txt", 3]],
      refCounts: [["direct", 8], ["bilibili", 2]],
      dailyDownloads: [[dayKey(nowMs - 3 * 24 * 3600 * 1000), 4], [dayKey(nowMs - 40 * 24 * 3600 * 1000), 9]],
      dailyActiveSets: [[dayKey(nowMs - 3 * 24 * 3600 * 1000), [ID_D]], [dayKey(nowMs - 40 * 24 * 3600 * 1000), [ID_D]]],
      dailyFirstLaunchSets: [[dayKey(nowMs - 3 * 24 * 3600 * 1000), [ID_D]]],
      pageViewCounts: [["/", 12], ["/en/", 5]],
      dailyPageViews: [[dayKey(nowMs - 3 * 24 * 3600 * 1000), 6]],
      dailyHomePageViews: [[dayKey(nowMs - 3 * 24 * 3600 * 1000), 4]],
      homePageViews: 17,
    },
  };
}
