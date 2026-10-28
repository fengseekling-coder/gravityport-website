// /admin/* handler for the legacy domain (mosa.azhuilab.com). Every request is
// verified against Cloudflare Access first; without a valid identity token the
// answer is always 403. The feedback JSON endpoints belong to the gp-api
// Worker and 404 here.

import { verifyAccessRequest } from "./access.js";
import { applySecurityHeaders } from "./headers.js";
import { buildStats } from "./stats.js";

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
  if (path === "/admin" || path === "/admin/") return serveAsset(env, url, "/admin/index.html");
  return serveAsset(env, url, path);
}
