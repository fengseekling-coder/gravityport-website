// /admin/* handler for the legacy domain (mosa.azhuilab.com). Every request is
// verified against Cloudflare Access first; without a valid identity token the
// answer is always 403. The feedback JSON endpoints belong to the gp-api
// Worker and 404 here.

import { verifyAccessRequest } from "./access.js";
import { applySecurityHeaders } from "./headers.js";
import { buildStats } from "./stats.js";
import { INSTALLATION_ID_PATTERN, USAGE_PLATFORMS, VERSION_PATTERN } from "./telemetry.js";
import { recentDayKeys } from "./util.js";

const INSTALLS_PAGE_SIZE = 50;

/**
 * Build the paginated installs list from D1.
 * @param {{prepare: StatsDb["prepare"]}} db STATS binding.
 * @param {URL} url Request URL.
 * @param {number} nowMs Report time, epoch milliseconds.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildInstallsPage(db, url, nowMs = Date.now()) {
  const params = url.searchParams;
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawVersion = params.get("version") || "";
  const version = VERSION_PATTERN.test(rawVersion) ? rawVersion : "";
  const rawPlatform = params.get("platform") || "";
  const platform = USAGE_PLATFORMS.has(rawPlatform) ? rawPlatform : "";

  const conditions = [];
  const bindValues = [];
  if (version) {
    conditions.push("i.version = ?");
    bindValues.push(version);
  }
  if (platform) {
    conditions.push("i.platform = ?");
    bindValues.push(platform);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM installs i ${whereClause}`)
    .bind(...bindValues)
    .first();
  const total = Number(totalRow?.total || 0);

  const dayKeys30 = recentDayKeys(nowMs, 30);
  const start30 = dayKeys30[0];
  const start7 = dayKeys30[dayKeys30.length - 7];
  const endDay = dayKeys30[dayKeys30.length - 1];
  const offset = (page - 1) * INSTALLS_PAGE_SIZE;

  const query =
    "SELECT i.install_id, i.platform, i.arch, i.first_seen_at, i.last_seen_at, i.version, i.first_launch, " +
    "iv.first_seen_at AS version_since, iv.from_version AS previous_version, " +
    "(SELECT COUNT(DISTINCT da.day) FROM daily_active da WHERE da.install_id = i.install_id AND da.day >= ? AND da.day <= ?) AS active_days_7, " +
    "(SELECT COUNT(DISTINCT da.day) FROM daily_active da WHERE da.install_id = i.install_id AND da.day >= ? AND da.day <= ?) AS active_days_30 " +
    "FROM installs i " +
    "LEFT JOIN install_versions iv ON iv.install_id = i.install_id AND iv.version = i.version " +
    `${whereClause} ` +
    "ORDER BY i.last_seen_at DESC, i.install_id ASC " +
    "LIMIT ? OFFSET ?";

  const result = await db
    .prepare(query)
    .bind(start7, endDay, start30, endDay, ...bindValues, INSTALLS_PAGE_SIZE, offset)
    .all();
  const rows = result.results || [];

  const items = rows.map((row) => ({
    installId: row.install_id,
    platform: row.platform,
    arch: row.arch,
    firstSeenAt: Number(row.first_seen_at),
    lastSeenAt: Number(row.last_seen_at),
    version: row.version,
    versionSince: row.version_since !== null && row.version_since !== undefined ? Number(row.version_since) : null,
    previousVersion: row.previous_version !== null && row.previous_version !== undefined ? String(row.previous_version) : null,
    activeDays7: Number(row.active_days_7) || 0,
    activeDays30: Number(row.active_days_30) || 0,
    firstLaunch: Boolean(Number(row.first_launch)),
  }));

  return {
    items,
    installs: items,
    total,
    page,
    pageSize: INSTALLS_PAGE_SIZE,
  };
}

/**
 * Build the version history for one install ID.
 * @param {{prepare: StatsDb["prepare"]}} db STATS binding.
 * @param {string} installId
 * @returns {Promise<Array<{version: string, firstSeenAt: number | null, fromVersion: string | null}>>}
 */
export async function buildInstallHistory(db, installId) {
  const result = await db
    .prepare(
      "SELECT version, first_seen_at, from_version FROM install_versions " +
        "WHERE install_id = ? " +
        "ORDER BY CASE WHEN first_seen_at IS NULL THEN 0 ELSE 1 END ASC, first_seen_at ASC, version ASC"
    )
    .bind(installId)
    .all();
  const rows = result.results || [];
  return rows.map((row) => ({
    version: row.version,
    firstSeenAt: row.first_seen_at !== null && row.first_seen_at !== undefined ? Number(row.first_seen_at) : null,
    fromVersion: row.from_version !== null && row.from_version !== undefined ? String(row.from_version) : null,
  }));
}

/**
 * Headers every /admin/* response carries.
 * @returns {Headers}
 */
function adminBaseHeaders() {
  const headers = new Headers();
  headers.set("cache-control", "no-store, private");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  applySecurityHeaders(headers);
  return headers;
}

/**
 * Plain 404 carrying the admin headers.
 * @returns {Response}
 */
function adminNotFound() {
  const headers = adminBaseHeaders();
  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response("Not Found\n", { status: 404, headers });
}

/**
 * Rebuild an ASSETS response with the admin headers (keeping content-type and
 * validators the asset serving produced).
 * @param {Response} response
 * @returns {Response}
 */
function withAdminHeaders(response) {
  const headers = adminBaseHeaders();
  for (const name of ["content-type", "content-length", "etag", "last-modified"]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

/**
 * @param {{ASSETS: {fetch: (request: Request) => Promise<Response>}}} env
 * @param {URL} url
 * @param {string} assetPath
 * @returns {Promise<Response>}
 */
async function serveAsset(env, url, assetPath) {
  const response = await env.ASSETS.fetch(new Request(new URL(assetPath, url.origin)));
  if (response.status === 404) return adminNotFound();
  return withAdminHeaders(response);
}

/**
 * @param {Request} request
 * @param {{ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string, ASSETS: {fetch: (request: Request) => Promise<Response>}, prepare: StatsDb["prepare"]}} env
 * @param {URL} url
 * @param {number} [nowMs]
 * @returns {Promise<Response>}
 */
export async function handleAdmin(request, env, url, nowMs = Date.now()) {
  if (!(await verifyAccessRequest(request, env, nowMs))) {
    const headers = adminBaseHeaders();
    headers.set("content-type", "text/plain; charset=utf-8");
    return new Response("Forbidden\n", { status: 403, headers });
  }

  const path = url.pathname;
  if (path === "/admin/feedback.json" || path === "/admin/feedback-item.json") return adminNotFound();
  if (path === "/admin/logout") {
    const headers = adminBaseHeaders();
    headers.set("location", "/cdn-cgi/access/logout");
    return new Response(null, { status: 302, headers });
  }
  if (path === "/admin/login.html") {
    // Access owns the login flow; an authenticated hit on the old login page
    // just moves on to the dashboard.
    const headers = adminBaseHeaders();
    headers.set("location", "./");
    return new Response(null, { status: 302, headers });
  }
  if (path === "/admin/stats.json") {
    const report = await buildStats(env.STATS, nowMs);
    const headers = adminBaseHeaders();
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(`${JSON.stringify(report, null, 2)}\n`, { status: 200, headers });
  }
  if (path === "/admin/installs.json") {
    const payload = await buildInstallsPage(env.STATS, url, nowMs);
    const headers = adminBaseHeaders();
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(`${JSON.stringify(payload, null, 2)}\n`, { status: 200, headers });
  }
  if (path === "/admin/install-history.json") {
    const id = url.searchParams.get("id") || "";
    if (!INSTALLATION_ID_PATTERN.test(id)) {
      const headers = adminBaseHeaders();
      headers.set("content-type", "text/plain; charset=utf-8");
      return new Response("Bad Request\n", { status: 400, headers });
    }
    const payload = await buildInstallHistory(env.STATS, id);
    const headers = adminBaseHeaders();
    headers.set("content-type", "application/json; charset=utf-8");
    return new Response(`${JSON.stringify(payload, null, 2)}\n`, { status: 200, headers });
  }
  if (path === "/admin" || path === "/admin/") return serveAsset(env, url, "/admin/index.html");
  return serveAsset(env, url, path);
}
