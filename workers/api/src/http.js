// Shared HTTP helpers for the gp-api Worker.

/**
 * Environment bindings and variables of this Worker.
 * @typedef {Object} GpApiEnv
 * @property {D1Database} FEEDBACK D1 database (feedback rows + session hashes).
 * @property {{limit(opts: {key: string}): {success: boolean}|Promise<{success: boolean}>}} [FEEDBACK_LIMITER] Managed rate limit binding.
 * @property {{limit(opts: {key: string}): {success: boolean}|Promise<{success: boolean}>}} [PINTEREST_LIMITER] Managed rate limit binding.
 * @property {string} [PINTEREST_CLIENT_ID]
 * @property {string} [PINTEREST_ALLOWED_REDIRECTS] Comma-separated redirect_uri whitelist.
 * @property {string} [PINTEREST_TOKEN_ENDPOINT]
 * @property {string} [PINTEREST_REQUIRE_SESSION] "true" only accepts credentialed token requests.
 * @property {string} [PINTEREST_APP_SECRET] Worker secret; empty means misconfigured.
 * @property {string} [PINTEREST_FORWARD_TIMEOUT_MS] Forward timeout override (15s by default).
 * @property {string} [FEEDBACK_MAX_ROWS]
 * @property {string} [FEEDBACK_MAX_TOTAL_BYTES]
 * @property {string} [ACCESS_TEAM_DOMAIN] Empty disables every admin request.
 * @property {string} [ACCESS_AUD] Empty disables every admin request.
 */

/**
 * Build a JSON response. Every response is no-store: the endpoints carry
 * per-user content or OAuth credentials, and none of it is cacheable.
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/**
 * @param {string} text
 * @returns {number} UTF-8 byte length.
 */
export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Positive integer from a string variable, falling back when absent or not a
 * positive number.
 * @param {unknown} raw
 * @param {number} fallback
 * @returns {number}
 */
export function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * One check against a Workers rate limit binding. A missing binding counts as
 * "not limited": wrangler.toml ships both limiters, so this only happens in
 * tests that replace them with controllable fakes.
 * @param {GpApiEnv["FEEDBACK_LIMITER"]} binding
 * @param {string} key
 * @returns {Promise<boolean>} true when the request may proceed.
 */
export async function rateLimitAllows(binding, key) {
  if (!binding || typeof binding.limit !== "function") return true;
  const outcome = await binding.limit({ key });
  return outcome?.success !== false;
}

/**
 * Read the request body as text, rejecting as soon as the byte budget is
 * exceeded (mirrors the old services' streaming readers).
 * @param {Request} request
 * @param {number} limit
 * @returns {Promise<string>}
 */
export async function readBodyWithLimit(request, limit) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) throw new Error("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch {
        // The stream may already be closed; the budget verdict stands.
      }
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url without padding.
 */
export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} value base64url text.
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {string} text
 * @returns {Promise<string>} lowercase hex SHA-256.
 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
