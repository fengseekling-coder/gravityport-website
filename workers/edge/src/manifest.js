// /releases/* handler: manifests are served byte-for-byte from R2 (the update
// signature is verified against the exact bytes, so nothing may re-serialize
// them) and never redirect.

import { objectKeyFromPath } from "./keys.js";
import { applySecurityHeaders, methodNotAllowedResponse, notFoundResponse } from "./headers.js";
import { ifNoneMatchSatisfied } from "./conditional.js";
import { TELEMETRY_PATHS, recordTelemetry } from "./telemetry.js";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/**
 * @param {string} key
 * @param {{httpMetadata?: {contentType?: string} | null}} object
 * @returns {string}
 */
function contentTypeForKey(key, object) {
  if (key.endsWith(".json")) return JSON_CONTENT_TYPE;
  return object.httpMetadata?.contentType || "application/octet-stream";
}

/**
 * Serve a manifest object from R2. Status codes are limited to 200, 304, 404
 * and 405 (the http->https 301 lives in the fetch dispatcher).
 * @param {Request} request
 * @param {{RELEASES: R2BucketLike}} env
 * @param {URL} url
 * @param {{waitUntil?: (promise: Promise<unknown>) => void} | undefined} ctx
 * @returns {Promise<Response>}
 */
export async function serveManifest(request, env, url, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowedResponse();
  const key = objectKeyFromPath(url.pathname);
  if (!key) return notFoundResponse();

  // HEAD never needs the body, so a metadata-only read is enough.
  const object = request.method === "HEAD" ? await env.RELEASES.head(key) : await env.RELEASES.get(key);
  if (!object) return notFoundResponse();

  const etag = object.httpEtag;
  if (ifNoneMatchSatisfied(request.headers.get("if-none-match"), etag)) {
    const headers = new Headers();
    if (etag) headers.set("etag", etag);
    headers.set("cache-control", "no-cache");
    applySecurityHeaders(headers);
    return new Response(null, { status: 304, headers });
  }

  const headers = new Headers();
  headers.set("content-type", contentTypeForKey(key, object));
  headers.set("cache-control", "no-cache");
  if (etag) headers.set("etag", etag);
  if (object.uploaded) headers.set("last-modified", new Date(object.uploaded).toUTCString());
  headers.set("content-length", String(object.size));
  applySecurityHeaders(headers);

  // Telemetry rides on successful manifest responses only: a 304 or 404 was
  // never counted by the nginx log contract either. It is recorded for HEAD
  // and GET alike — HEAD is the App's daily usage-report request.
  if (TELEMETRY_PATHS.has(url.pathname)) {
    const pending = recordTelemetry(env.STATS, url, Date.now());
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pending);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(/** @type {R2ObjectBody} */ (object).body, { status: 200, headers });
}

/**
 * @typedef {Object} R2ObjectLike
 * @property {number} size
 * @property {string} [httpEtag]
 * @property {Date} [uploaded]
 * @property {{contentType?: string} | null} [httpMetadata]
 */

/**
 * @typedef {R2ObjectLike & {body: ReadableStream}} R2ObjectBodyLike
 */

/**
 * @typedef {Object} R2BucketLike
 * @property {(key: string, options?: {range?: {offset: number, length: number}}) => Promise<R2ObjectBodyLike | null>} get
 * @property {(key: string) => Promise<R2ObjectLike | null>} head
 */
