// Pinterest token relay: POST /api/pinterest/token, plus the one-time session
// credential endpoint POST /api/pinterest/session.
//
// The relay exists so the desktop app never needs the Pinterest App Secret.
// Forwarding behavior is ported from the token service written for the old
// server (branch feat/pinterest-token-service, commit 9c62945), with the
// caller checks from the security review added on top:
//
//   - requests carrying an Origin header (web pages) are rejected; the app's
//     main process never sends one;
//   - per-IP rate limiting through the PINTEREST_LIMITER binding;
//   - one-time session credentials, stored in D1 as SHA-256 hashes only;
//   - PINTEREST_REQUIRE_SESSION="true" requires a credential and the
//     X-GravityPort-Client header on every request.
//
// Nothing sensitive is ever logged: the only log line carries the grant type
// (restricted to the two known names) and the status code. The connecting IP
// is only a rate limit key — not stored, not logged.

import {
  bytesToBase64Url,
  jsonResponse,
  positiveInt,
  rateLimitAllows,
  readBodyWithLimit,
  sha256Hex,
} from "./http.js";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 2048;
const DEFAULT_TOKEN_ENDPOINT = "https://api.pinterest.com/v5/oauth/token";
const DEFAULT_CLIENT_ID = "1628239";
const DEFAULT_FORWARD_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 600_000;
const SESSION_RANDOM_BYTES = 32;
const TOKEN_RESPONSE_FIELDS = [
  "access_token",
  "refresh_token",
  "token_type",
  "expires_in",
  "refresh_token_expires_in",
  "scope",
];

function isValidField(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

function allowedRedirects(env) {
  const raw =
    typeof env.PINTEREST_ALLOWED_REDIRECTS === "string" && env.PINTEREST_ALLOWED_REDIRECTS
      ? env.PINTEREST_ALLOWED_REDIRECTS
      : "http://localhost:43517/api/pinterest/callback";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * @param {Request} request
 * @returns {string} rate limit key only; never stored or logged.
 */
function ipKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * Mint a one-time session credential. Only its SHA-256 is stored; expired
 * rows are swept on every mint.
 * @param {Request} request
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
export async function handlePinterestSession(request, env) {
  let response;
  if (request.headers.has("origin")) {
    response = jsonResponse(403, { error: "forbidden_origin" });
  } else if (!(await rateLimitAllows(env.PINTEREST_LIMITER, ipKey(request)))) {
    response = jsonResponse(429, { error: "rate_limited" });
  } else {
    response = await mintSession(env);
  }
  console.log(`grant=session status=${response.status}`);
  return response;
}

/**
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
async function mintSession(env) {
  const now = Date.now();
  await env.FEEDBACK.prepare("DELETE FROM pinterest_sessions WHERE created_at_ms < ?1")
    .bind(now - SESSION_TTL_MS)
    .run();
  const raw = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SESSION_RANDOM_BYTES)));
  await env.FEEDBACK.prepare("INSERT INTO pinterest_sessions (hash, created_at_ms) VALUES (?1, ?2)")
    .bind(await sha256Hex(raw), now)
    .run();
  return jsonResponse(201, { session: raw, expiresIn: SESSION_TTL_MS / 1000 });
}

/**
 * Atomically consume a session credential: DELETE ... RETURNING makes the
 * existence check and the removal one statement, so two concurrent requests
 * can never both validate the same credential. Expired rows are removed too;
 * the credential is consumed before anything is forwarded, so a failed
 * exchange can never be replayed.
 * @param {GpApiEnv["FEEDBACK"]} db
 * @param {string} raw
 * @returns {Promise<boolean>}
 */
async function consumeSession(db, raw) {
  const hash = await sha256Hex(raw);
  let row = null;
  try {
    row = await db.prepare("DELETE FROM pinterest_sessions WHERE hash = ?1 RETURNING created_at_ms").bind(hash).first();
  } catch {
    return false;
  }
  if (!row) return false;
  return Date.now() - Number(row.created_at_ms) < SESSION_TTL_MS;
}

/**
 * @param {Request} request
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
export async function handlePinterestToken(request, env) {
  let grant = "-";
  const reply = (status, body) => {
    console.log(`grant=${grant} status=${status}`);
    return jsonResponse(status, body);
  };

  if (request.headers.has("origin")) return reply(403, { error: "forbidden_origin" });
  if (!(await rateLimitAllows(env.PINTEREST_LIMITER, ipKey(request)))) return reply(429, { error: "rate_limited" });

  const secret = env.PINTEREST_APP_SECRET;
  if (typeof secret !== "string" || secret === "") {
    // Never name the missing configuration in the response or the log.
    return reply(500, { error: "misconfigured" });
  }

  let text;
  try {
    text = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch {
    return reply(400, { error: "bad_request" });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, { error: "invalid_json" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return reply(400, { error: "invalid_json" });
  }

  const requireSession = String(env.PINTEREST_REQUIRE_SESSION ?? "false") === "true";
  if (requireSession && request.headers.get("x-gravityport-client") !== "desktop") {
    return reply(400, { error: "session_required" });
  }

  let sessionConsumed = false;
  if (parsed.session !== undefined) {
    if (!isValidField(parsed.session) || !(await consumeSession(env.FEEDBACK, parsed.session))) {
      return reply(400, { error: "invalid_session" });
    }
    sessionConsumed = true;
  }

  if (!isValidField(parsed.grant)) return reply(400, { error: "invalid_grant" });
  // Only the two known grant names ever reach the log; anything else the
  // caller sent is logged as "unknown" so arbitrary input never lands there.
  grant = parsed.grant === "authorization_code" || parsed.grant === "refresh_token" ? parsed.grant : "unknown";

  let formData;
  if (grant === "authorization_code") {
    // Strict mode: the code grant must carry a one-time credential; refresh
    // grants only need the client header above.
    if (requireSession && !sessionConsumed) {
      return reply(400, { error: "session_required" });
    }
    if (!isValidField(parsed.code) || !isValidField(parsed.redirect_uri)) {
      return reply(400, { error: "missing_fields" });
    }
    if (!allowedRedirects(env).includes(parsed.redirect_uri)) {
      return reply(400, { error: "invalid_redirect_uri" });
    }
    formData = { grant_type: "authorization_code", code: parsed.code, redirect_uri: parsed.redirect_uri };
  } else if (grant === "refresh_token") {
    if (!isValidField(parsed.refresh_token)) return reply(400, { error: "missing_fields" });
    formData = { grant_type: "refresh_token", refresh_token: parsed.refresh_token };
  } else {
    return reply(400, { error: "unknown_grant" });
  }

  return forwardToPinterest(env, secret, formData, reply);
}

/**
 * @param {GpApiEnv} env
 * @param {string} secret
 * @param {Record<string, string>} formData form fields for Pinterest
 * @param {(status: number, body: unknown) => Response} reply
 * @returns {Promise<Response>}
 */
async function forwardToPinterest(env, secret, formData, reply) {
  const clientId =
    typeof env.PINTEREST_CLIENT_ID === "string" && env.PINTEREST_CLIENT_ID ? env.PINTEREST_CLIENT_ID : DEFAULT_CLIENT_ID;
  const endpoint =
    typeof env.PINTEREST_TOKEN_ENDPOINT === "string" && env.PINTEREST_TOKEN_ENDPOINT
      ? env.PINTEREST_TOKEN_ENDPOINT
      : DEFAULT_TOKEN_ENDPOINT;
  const timeoutMs = positiveInt(env.PINTEREST_FORWARD_TIMEOUT_MS, DEFAULT_FORWARD_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(formData).toString(),
      // Pinterest must not be followed across redirects: a 3xx is a rejection.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return reply(504, { error: "pinterest_unreachable" });
  }

  if (response.status < 200 || response.status >= 300) {
    return reply(502, { error: "pinterest_rejected", status: response.status });
  }

  let data = {};
  try {
    const parsedBody = await response.json();
    if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) data = parsedBody;
  } catch {
    // An unparseable body counts as an empty object below.
  }
  // A 2xx without a usable access token must not look like success: the app
  // would otherwise store an empty credential.
  if (typeof data.access_token !== "string" || data.access_token === "") {
    return reply(502, { error: "pinterest_bad_response" });
  }
  const result = {};
  for (const key of TOKEN_RESPONSE_FIELDS) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  return reply(200, result);
}
