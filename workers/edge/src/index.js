// gp-edge: serves release manifests and downloads from R2, records usage
// statistics in D1, and acts as the whole legacy mosa.azhuilab.com origin
// (admin dashboard behind Cloudflare Access, domain-changed page for
// everything else). Update clients use redirect: "error", so the update and
// download paths must never return a 3xx.

import { serveManifest } from "./manifest.js";
import { serveDownload } from "./downloads.js";
import { handleAdmin } from "./admin.js";
import { runMaintenance } from "./maintenance.js";
import { applySecurityHeaders, notFoundResponse } from "./headers.js";

/** @const {string} */
export const LEGACY_HOST = "mosa.azhuilab.com";

/**
 * @typedef {{
 *   RELEASES: import("./manifest.js").R2BucketLike,
 *   STATS?: import("./counters.js").StatsDb,
 *   ASSETS: {fetch: (request: Request) => Promise<Response>},
 *   ACCESS_TEAM_DOMAIN?: string,
 *   ACCESS_AUD?: string,
 * }} Env
 */

/**
 * Serve domain-changed.html from the static assets with the nginx header set
 * for that page (its own CSP replaces the site default).
 * @param {Env} env
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function serveDomainChanged(env, url) {
  const response = await env.ASSETS.fetch(new Request(new URL("/domain-changed.html", url.origin)));
  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  headers.set("content-type", contentType || "text/html; charset=utf-8");
  headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  headers.set("cache-control", "no-cache, no-store, must-revalidate");
  headers.set("x-robots-tag", "noindex, follow");
  applySecurityHeaders(headers, { csp: null });
  const body = await response.arrayBuffer();
  return new Response(body, { status: 200, headers });
}

/**
 * @param {Request} request
 * @param {Env} env
 * @param {{waitUntil?: (promise: Promise<unknown>) => void}} [ctx]
 * @returns {Promise<Response>}
 */
async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);

  // Both domains are https-only. The App always uses https, so this redirect
  // is only reached when Cloudflare's "Always Use HTTPS" is off.
  if (url.protocol === "http:") {
    url.protocol = "https:";
    const headers = new Headers({ location: url.toString() });
    applySecurityHeaders(headers);
    return new Response(null, { status: 301, headers });
  }

  const path = url.pathname;
  if (path.startsWith("/releases/")) return serveManifest(request, env, url, ctx);
  if (path.startsWith("/downloads/")) return serveDownload(request, env, url, ctx);
  // /api/* belongs to the gp-api Worker; the edge Worker only sees it if the
  // routes are misconfigured, and must never answer it.
  if (path.startsWith("/api/")) return notFoundResponse();

  if (url.hostname === LEGACY_HOST) {
    if (path === "/admin" || path.startsWith("/admin/")) return handleAdmin(request, env, url);
    return serveDomainChanged(env, url);
  }
  return notFoundResponse();
}

export default {
  /** @type {ExportedHandlerFetchHandler<Env>} */
  fetch: handleFetch,

  /**
   * @param {ScheduledController} _event
   * @param {Env} env
   * @returns {Promise<void>}
   */
  async scheduled(_event, env) {
    await runMaintenance(env.STATS);
  },
};
