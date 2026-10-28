// /admin/* behind Cloudflare Access: token verification failure modes are all
// 403, a valid token reaches the assets and the computed stats.json. The
// certs endpoint is stubbed by replacing the global fetch (the new
// vitest-pool-workers API no longer ships fetchMock).
import { afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { fetchWorker, testEnv } from "./helpers.js";

const MOSA = "https://mosa.azhuilab.com";
const TEAM_DOMAIN = "access-team.example.com";
const AUD = "gp-admin-audience";
const CERTS_URL = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateRsaKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}

async function makeToken(key, claims, headerOverrides = {}) {
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", ...headerOverrides })));
  const payload = base64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

describe("admin behind Cloudflare Access", () => {
  // One keypair for the whole file: the Worker caches the JWKS in memory, so
  // every test must sign with the same key the (stubbed) certs endpoint serves.
  let goodKey;
  let otherKey;
  let publicJwk;
  let claims;
  let realFetch;

  beforeAll(async () => {
    goodKey = await generateRsaKey();
    otherKey = await generateRsaKey();
    publicJwk = await crypto.subtle.exportKey("jwk", goodKey.publicKey);
  });

  beforeEach(async () => {
    claims = {
      iss: `https://${TEAM_DOMAIN}`,
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: "user@example.com",
    };
    realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === CERTS_URL) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected outbound fetch: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function adminFetch(path, token, envOverrides = undefined) {
    const headers = token ? { "cf-access-jwt-assertion": token } : {};
    return fetchWorker(`${MOSA}${path}`, { headers }, envOverrides ?? testEnv({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD }));
  }

  it("rejects missing, malformed and badly-signed tokens with 403", async () => {
    expect((await adminFetch("/admin/", null)).status).toBe(403);
    expect((await adminFetch("/admin/", "garbage")).status).toBe(403);
    expect((await adminFetch("/admin/", "a.b")).status).toBe(403);
    const forged = await makeToken(otherKey, claims);
    expect((await adminFetch("/admin/", forged)).status).toBe(403);
  });

  it("rejects wrong issuer, wrong audience, expired tokens and other algorithms", async () => {
    expect((await adminFetch("/admin/", await makeToken(goodKey, { ...claims, iss: "https://other.example.com" }))).status).toBe(403);
    expect((await adminFetch("/admin/", await makeToken(goodKey, { ...claims, aud: "someone-else" }))).status).toBe(403);
    expect((await adminFetch("/admin/", await makeToken(goodKey, { ...claims, exp: Math.floor(Date.now() / 1000) - 10 }))).status).toBe(403);
    expect((await adminFetch("/admin/", await makeToken(goodKey, claims, { alg: "HS256" }))).status).toBe(403);
  });

  it("rejects when Access configuration is empty (no unconfigured bypass)", async () => {
    const token = await makeToken(goodKey, claims);
    expect((await adminFetch("/admin/", token, testEnv({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: AUD }))).status).toBe(403);
    expect((await adminFetch("/admin/", token, testEnv({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: "" }))).status).toBe(403);
    expect((await adminFetch("/admin/", token, testEnv({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" }))).status).toBe(403);
    expect((await adminFetch("/admin/", token, testEnv({ ACCESS_AUD: AUD }))).status).toBe(403);
  });

  it("403 responses carry the admin headers", async () => {
    const response = await adminFetch("/admin/", null);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("a valid token reaches the dashboard assets", async () => {
    const token = await makeToken(goodKey, claims);
    const index = await adminFetch("/admin/", token);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(await index.text()).toContain("Usage Stats");
    expect(index.headers.get("cache-control")).toBe("no-store, private");
    expect(index.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");

    const script = await adminFetch("/admin/app.js", token);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(script.headers.get("cache-control")).toBe("no-store, private");
  });

  it("a valid token gets a computed stats.json", async () => {
    const token = await makeToken(goodKey, claims);
    const response = await adminFetch("/admin/stats.json", token);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    const report = await response.json();
    expect(report.schemaVersion).toBe(2);
    expect(report.analyticsTimeZone).toBe("America/Los_Angeles");
    expect(report.knownInstallationInstances).toBe(0);
    expect(Array.isArray(report.daily)).toBe(true);
    expect(report.daily.length).toBe(30);
  });

  it("login.html redirects to the dashboard and logout to the Access logout", async () => {
    const token = await makeToken(goodKey, claims);
    const login = await adminFetch("/admin/login.html", token);
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("./");
    const logout = await adminFetch("/admin/logout", token);
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe("/cdn-cgi/access/logout");
  });

  it("feedback endpoints belong to gp-api and 404 here", async () => {
    const token = await makeToken(goodKey, claims);
    expect((await adminFetch("/admin/feedback.json", token)).status).toBe(404);
    expect((await adminFetch("/admin/feedback-item.json", token)).status).toBe(404);
  });

  it("missing assets 404 with admin headers", async () => {
    const token = await makeToken(goodKey, claims);
    const response = await adminFetch("/admin/nope.js", token);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
});
