// Cloudflare Access identity token verification for the admin feedback
// endpoints. The caller must present the Access JWT (Cf-Access-Jwt-Assertion);
// it is verified with RS256 against the team's JWKS endpoint, and the iss,
// aud and exp claims are checked.
//
// ACCESS_TEAM_DOMAIN and ACCESS_AUD must both be configured. When either is
// empty every request is rejected with 403 — there is deliberately no
// "unconfigured" bypass.

import { base64UrlToBytes } from "./http.js";

/**
 * In-isolate JWKS cache, one key set per team domain. A kid missing from the
 * cached set triggers exactly one refetch (Access rotates signing keys).
 * @type {Map<string, Map<string, object>>}
 */
const jwksCache = new Map();

/**
 * @param {Request} request
 * @param {GpApiEnv} env
 * @returns {Promise<boolean>}
 */
export async function verifyAccessToken(request, env) {
  const teamDomain = typeof env.ACCESS_TEAM_DOMAIN === "string" ? env.ACCESS_TEAM_DOMAIN.trim() : "";
  const audience = typeof env.ACCESS_AUD === "string" ? env.ACCESS_AUD.trim() : "";
  if (!teamDomain || !audience) return false;

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  let header;
  let payload;
  try {
    const decoder = new TextDecoder();
    header = JSON.parse(decoder.decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(decoder.decode(base64UrlToBytes(parts[1])));
  } catch {
    return false;
  }
  if (!header || typeof header !== "object" || header.alg !== "RS256" || typeof header.kid !== "string") return false;
  if (!payload || typeof payload !== "object") return false;
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return false;
  if (payload.iss !== `https://${teamDomain}`) return false;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) return false;

  const jwk = await getSigningJwk(teamDomain, header.kid);
  if (!jwk) return false;

  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(parts[2]), signed);
  } catch {
    return false;
  }
}

/**
 * @param {string} teamDomain
 * @param {string} kid
 * @returns {Promise<object|null>}
 */
async function getSigningJwk(teamDomain, kid) {
  let keys = jwksCache.get(teamDomain);
  if (!keys || !keys.has(kid)) {
    keys = await fetchJwks(teamDomain);
    if (!keys.has(kid)) return null;
    jwksCache.set(teamDomain, keys);
  }
  return keys.get(kid) ?? null;
}

/**
 * @param {string} teamDomain
 * @returns {Promise<Map<string, object>>} kid → JWK; empty on any failure (and
 * then not cached, so the next request retries).
 */
async function fetchJwks(teamDomain) {
  const keys = new Map();
  try {
    const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) return keys;
    const body = await response.json();
    if (body && Array.isArray(body.keys)) {
      for (const jwk of body.keys) {
        if (jwk && jwk.kty === "RSA" && typeof jwk.kid === "string") keys.set(jwk.kid, jwk);
      }
    }
  } catch {
    // Network or parse failure: empty set, the caller rejects this request.
  }
  return keys;
}
