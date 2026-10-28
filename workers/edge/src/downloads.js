// /downloads/* handler: streams release packages out of R2 with single-range
// support and counts successful GET/Range downloads the way the nginx log
// contract did. HEAD requests and failures are never counted.

import { objectKeyFromPath } from "./keys.js";
import { applySecurityHeaders, methodNotAllowedResponse, notFoundResponse } from "./headers.js";
import { ifNoneMatchSatisfied } from "./conditional.js";
import { analyticsDayKey } from "./util.js";

const CACHE_CONTROL = "public, max-age=86400, must-revalidate";

/**
 * Parse a single-range Range header. Returns null when the header should be
 * ignored (absent, wrong unit, malformed, multi-range or an invalid spec
 * where last < first — RFC 7233 says such headers are ignored), "unsat" when
 * it is a valid but unsatisfiable range, or {start, end} otherwise.
 * @param {string | null} header
 * @param {number} size
 * @returns {{start: number, end: number} | "unsat" | null}
 */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] !== "") {
    const start = Number(match[1]);
    if (start >= size) return "unsat";
    if (match[2] !== "") {
      const end = Number(match[2]);
      if (end < start) return null;
      return { start, end: Math.min(end, size - 1) };
    }
    return { start, end: size - 1 };
  }
  const suffix = Number(match[2]);
  if (suffix <= 0 || size === 0) return "unsat";
  return { start: Math.max(0, size - suffix), end: size - 1 };
}

/**
 * Content-Type for a download, following the nginx mapping.
 * @param {string} key
 * @returns {string}
 */
function downloadContentType(key) {
  const name = key.toLowerCase();
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (name.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

/**
 * Record one successful download. Fire-and-forget and best effort: recording
 * failures must never affect the download response.
 * @param {StatsDb} env STATS binding.
 * @param {string} key R2 object key actually served.
 * @param {URL} url Request URL (for the ref channel).
 * @param {number} nowMs Request time, epoch milliseconds.
 * @returns {Promise<void>}
 */
export async function recordDownload(env, key, url, nowMs) {
  const file = key.split("/").pop() || "unknown";
  // Same channel rule as report-usage.mjs: any non-empty ?ref= counts as-is,
  // everything else (including an empty value) counts as "direct".
  const ref = url.searchParams.get("ref") || "direct";
  const day = analyticsDayKey(nowMs);
  try {
    await env.batch([
      env
        .prepare(
          "INSERT INTO counters (day, kind, key, count) VALUES (?, 'download_file', ?, ?) " +
            "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + ?"
        )
        .bind(day, file, 1, 1),
      env
        .prepare(
          "INSERT INTO counters (day, kind, key, count) VALUES (?, 'download_ref', ?, ?) " +
            "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + ?"
        )
        .bind(day, ref, 1, 1),
    ]);
  } catch {
    // Recording must never break the response.
  }
}

/**
 * Serve a download object from R2.
 * @param {Request} request
 * @param {{RELEASES: R2BucketLike, STATS?: StatsDb}} env
 * @param {URL} url
 * @param {{waitUntil?: (promise: Promise<unknown>) => void} | undefined} ctx
 * @returns {Promise<Response>}
 */
export async function serveDownload(request, env, url, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowedResponse();
  const key = objectKeyFromPath(url.pathname);
  if (!key) return notFoundResponse();

  const object = await env.RELEASES.head(key);
  if (!object) return notFoundResponse();
  const size = object.size;
  const etag = object.httpEtag;

  if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
    const headers = new Headers();
    if (etag) headers.set("etag", etag);
    headers.set("cache-control", CACHE_CONTROL);
    headers.set("accept-ranges", "bytes");
    applySecurityHeaders(headers);
    return new Response(null, { status: 304, headers });
  }

  const baseHeaders = () => {
    const headers = new Headers();
    headers.set("content-type", downloadContentType(key));
    headers.set("content-disposition", "attachment");
    headers.set("cache-control", CACHE_CONTROL);
    headers.set("accept-ranges", "bytes");
    if (etag) headers.set("etag", etag);
    if (object.uploaded) headers.set("last-modified", new Date(object.uploaded).toUTCString());
    applySecurityHeaders(headers);
    return headers;
  };

  if (request.method === "HEAD") {
    const headers = baseHeaders();
    headers.set("content-length", String(size));
    return new Response(null, { status: 200, headers });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsat") {
    const headers = baseHeaders();
    headers.set("content-range", `bytes */${size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }

  if (range) {
    const length = range.end - range.start + 1;
    const ranged = await env.RELEASES.get(key, { range: { offset: range.start, length } });
    if (!ranged) return notFoundResponse();
    const headers = baseHeaders();
    headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("content-length", String(length));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(recordDownload(env.STATS, key, url, Date.now()));
    return new Response(ranged.body, { status: 206, headers });
  }

  const full = await env.RELEASES.get(key);
  if (!full) return notFoundResponse();
  const headers = baseHeaders();
  headers.set("content-length", String(size));
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(recordDownload(env.STATS, key, url, Date.now()));
  return new Response(full.body, { status: 200, headers });
}
