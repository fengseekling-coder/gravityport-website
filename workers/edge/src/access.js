// Cloudflare Access identity verification for /admin/* on the legacy domain.
// The token arrives in the Cf-Access-Jwt-Assertion header. RS256 only; the
// public keys come from the team's /cdn-cgi/access/certs endpoint and are
// cached in memory. Every failure mode (missing configuration, missing or
// malformed token, wrong issuer/audience, expired token, bad signature) is a
// plain 403 — there is deliberately no "unconfigured" bypass.

const JWKS_PATH = "/cdn-cgi/access/certs";

// Access rotates its signing keys, so the cached set is refreshed after a
// short while instead of living as long as the isolate does.
const JWKS_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, {fetchedAt: number, promise: Promise<{keys: unknown[]}>}>} */
const jwksCache = new Map();

/**
 * @param {string} teamDomain
 * @returns {Promise<{keys: unknown[]}>}
 */
async function fetchJwks(teamDomain) {
  const response = await fetch(`https://${teamDomain}${JWKS_PATH}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Access certs returned HTTP ${response.status}`);
  const document = await response.json();
  if (!document || !Array.isArray(document.keys) || document.keys.length === 0) {
    throw new Error("Access certs response has no keys");
  }
  return document;
}

/**
 * @param {string} teamDomain
 * @returns {Promise<{keys: unknown[]}>}
 */
function getJwks(teamDomain) {
  const cached = jwksCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.promise;
  const promise = fetchJwks(teamDomain).catch((error) => {
    jwksCache.delete(teamDomain);
    throw error;
  });
  jwksCache.set(teamDomain, { fetchedAt: Date.now(), promise });
  return promise;
}

/**
 * @param {string} value Base64url.
 * @returns {Uint8Array}
 */
function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Verify the Access JWT on a request.
 * @param {Request} request
 * @param {{ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string}} env
 * @param {number} [nowMs] Epoch milliseconds; defaults to the current time.
 * @returns {Promise<boolean>}
 */
export async function verifyAccessRequest(request, env, nowMs = Date.now()) {
  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "");
  const audience = String(env.ACCESS_AUD || "");
  if (!teamDomain || !audience) return false;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    return false;
  }
  if (!header || header.alg !== "RS256") return false;
  if (!payload || payload.iss !== `https://${teamDomain}`) return false;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return false;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= nowMs) return false;

  let keys;
  try {
    keys = (await getJwks(teamDomain)).keys;
  } catch {
    return false;
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);
  for (const jwk of keys) {
    if (!jwk || jwk.kty !== "RSA" || (jwk.alg && jwk.alg !== "RS256")) continue;
    try {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed)) return true;
    } catch {
      // Try the next key.
    }
  }
  return false;
}
