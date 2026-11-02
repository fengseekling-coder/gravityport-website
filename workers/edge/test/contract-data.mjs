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
export const ID_D = "423e4567-e89b-42d3-a456-426614174003";
export const ID_E = "523e4567-e89b-42d3-a456-426614174004";
export const ID_F = "623e4567-e89b-42d3-a456-426614174005";
export const ID_G = "723e4567-e89b-42d3-a456-426614174006";
export const TEST_INSTALL_ID = "00000000-2790-4000-8000-000000000279";
export const EXCLUDED_INSTALL_ID = "823e4567-e89b-42d3-a456-426614174007";

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
 * Synthetic Nginx access log text for the import-case test.
 * Generated by the real report-usage.mjs into usage-state.json.
 * @param {number} nowMs
 * @returns {string}
 */
export function buildImportLogText(nowMs) {
  const telemetryQuery = (event, installId, platform, arch, version, telemetryVersion = "2") =>
    `?event=${event}&telemetry_version=${telemetryVersion}&install_id=${installId}&platform=${platform}&arch=${arch}&version=${version}`;

  const lines = [];
  let sec = 0;
  const t = (baseMs, offsetSec = 0) => baseMs + (offsetSec + sec++) * 1000;

  const DAY = 24 * 3600 * 1000;
  const recentDay = nowMs - 3 * DAY;
  const fiveDaysAgo = nowMs - 5 * DAY;
  const twoDaysAgo = nowMs - 2 * DAY;
  const oldDay1 = nowMs - 100 * DAY;
  const oldDay2 = nowMs - 110 * DAY;

  // Live installs
  lines.push(logLine(t(fiveDaysAgo), "GET", `/releases/gravityport/latest.json${telemetryQuery("first_launch", ID_D, "macos", "arm64", "0.3.5")}`, 200, 120));
  lines.push(logLine(t(twoDaysAgo), "GET", `/releases/gravityport/latest.json${telemetryQuery("first_launch", ID_G, "windows", "x86_64", "0.3.6")}`, 200, 120));

  // Expired installs (>90d)
  lines.push(logLine(t(oldDay1), "GET", `/releases/gravityport/latest.json${telemetryQuery("daily_active", ID_E, "windows", "x64", "0.3.0")}`, 200, 120));
  lines.push(logLine(t(oldDay2), "GET", `/releases/gravityport/latest.json${telemetryQuery("first_launch", ID_F, "macos", "arm64", "0.2.1")}`, 200, 120));

  // 00000000- test install
  lines.push(logLine(t(recentDay), "GET", `/releases/gravityport/latest.json${telemetryQuery("first_launch", TEST_INSTALL_ID, "macos", "arm64", "0.3.7")}`, 200, 120));

  // Excluded install
  lines.push(logLine(t(recentDay), "GET", `/releases/gravityport/latest.json${telemetryQuery("first_launch", EXCLUDED_INSTALL_ID, "macos", "arm64", "0.3.7")}`, 200, 120));

  // Downloads:
  // Desktop downloads (.dmg 5, .exe 3)
  for (let i = 0; i < 5; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/GravityPort-darwin-arm64-0.3.7.dmg?ref=bilibili", 200, 5000));
  }
  for (let i = 0; i < 3; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/GravityPort-win32-x64-0.3.7.exe", 200, 5000));
  }
  // Update downloads (.zip 7)
  for (let i = 0; i < 7; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/GravityPort-darwin-arm64-0.3.7.zip?ref=direct", 200, 4000));
  }
  // Extension downloads (4)
  for (let i = 0; i < 4; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/GravityPort-Web-Capture-0.15.41.zip?ref=xiaohongshu", 200, 1000));
  }
  // Other download (notes.txt 2)
  for (let i = 0; i < 2; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/notes.txt", 200, 200));
  }

  // Download with .. in filename (2 requests)
  for (let i = 0; i < 2; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/evil..package.zip", 200, 1000));
  }

  // Download with weird ref channel (ref=bad ref, 2 requests)
  for (let i = 0; i < 2; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/GravityPort-darwin-arm64-0.3.7.dmg?ref=bad%20ref", 200, 5000));
  }

  // Multi-segment ranged download requests (3 requests for the same file)
  for (let i = 0; i < 3; i++) {
    lines.push(logLine(t(recentDay), "GET", "/downloads/MOSA-darwin-arm64-0.3.0-rc.1.zip", 200, 3000));
  }

  // Page views:
  for (let i = 0; i < 10; i++) lines.push(logLine(t(recentDay), "GET", "/", 200, HOME_BYTES));
  for (let i = 0; i < 5; i++) lines.push(logLine(t(recentDay), "GET", "/en/", 200, 25120));
  for (let i = 0; i < 2; i++) lines.push(logLine(t(recentDay), "GET", "/guide/", 200, 5166));
  for (let i = 0; i < 2; i++) lines.push(logLine(t(recentDay), "GET", "/demo/", 200, 19049));
  for (let i = 0; i < 1; i++) lines.push(logLine(t(recentDay), "GET", "/privacy/", 200, 17276));

  return lines.join("");
}
