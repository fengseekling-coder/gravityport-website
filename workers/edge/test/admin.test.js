// /admin/* behind Cloudflare Access: token verification failure modes are all
// 403, a valid token reaches the assets and the computed stats.json. The
// certs endpoint is stubbed by replacing the global fetch (the new
// vitest-pool-workers API no longer ships fetchMock).
import { afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { env, fetchWorker, resetStats, testEnv } from "./helpers.js";
import { recentDayKeys } from "../src/util.js";

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
    expect(await index.text()).toContain("GravityPort");
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

  it("protects /admin/installs.json and /admin/install-history.json with Access (403 without token)", async () => {
    expect((await adminFetch("/admin/installs.json", null)).status).toBe(403);
    expect((await adminFetch("/admin/install-history.json?id=123e4567-e89b-42d3-a456-426614174000", null)).status).toBe(403);
  });

  it("install-history.json rejects non-UUID id with 400", async () => {
    const token = await makeToken(goodKey, claims);
    expect((await adminFetch("/admin/install-history.json?id=not-a-uuid", token)).status).toBe(400);
    expect((await adminFetch("/admin/install-history.json?id=", token)).status).toBe(400);
    expect((await adminFetch("/admin/install-history.json", token)).status).toBe(400);
  });

  it("serves installs.json with pagination, filtering, invalid param ignoring, and consistent activeDays", async () => {
    await resetStats();
    const token = await makeToken(goodKey, claims);
    const now = Date.now();
    const DAY = 24 * 3600 * 1000;
    const dayKeys = recentDayKeys(now, 30);
    const today = dayKeys[dayKeys.length - 1];
    const day5ago = dayKeys[dayKeys.length - 6];
    const day15ago = dayKeys[dayKeys.length - 16];

    // Seed 55 installs to test pagination (page 1 has 50, page 2 has 5)
    const installStmts = [];
    for (let i = 1; i <= 55; i++) {
      const hex = i.toString(16).padStart(8, "0");
      const id = `${hex}-0000-4000-8000-000000000000`;
      const platform = i % 2 === 0 ? "macos" : "windows";
      const version = i <= 30 ? "0.3.9" : "0.3.8";
      const lastSeen = now - i * 1000;
      installStmts.push(
        env.STATS.prepare(
          "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) " +
            "VALUES (?, ?, ?, ?, 'arm64', ?, ?)"
        ).bind(id, now - 50 * DAY, lastSeen, platform, version, i === 1 ? 1 : 0)
      );
    }
    await env.STATS.batch(installStmts);

    // Seed install_versions
    await env.STATS.prepare(
      "INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES " +
        "('00000001-0000-4000-8000-000000000000', '0.3.8', ?, NULL), " +
        "('00000001-0000-4000-8000-000000000000', '0.3.9', ?, '0.3.8')"
    ).bind(now - 40 * DAY, now - 10 * DAY).run();

    // Seed daily_active for some installs
    // Install 1 active today and 5 days ago (in 7d and 30d)
    // Install 2 active 5 days ago (in 7d and 30d)
    // Install 3 active 15 days ago (in 30d only)
    await env.STATS.batch([
      env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, '00000001-0000-4000-8000-000000000000', 1)").bind(today),
      env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, '00000001-0000-4000-8000-000000000000', 0)").bind(day5ago),
      env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, '00000002-0000-4000-8000-000000000000', 0)").bind(day5ago),
      env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, '00000003-0000-4000-8000-000000000000', 0)").bind(day15ago),
    ]);

    // 1. Page 1
    const p1Res = await adminFetch("/admin/installs.json?page=1", token);
    expect(p1Res.status).toBe(200);
    const p1 = await p1Res.json();
    expect(p1.total).toBe(55);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(50);
    expect(p1.items.length).toBe(50);

    const first = p1.items[0];
    expect(first.installId).toBe("00000001-0000-4000-8000-000000000000");
    expect(first.version).toBe("0.3.9");
    expect(first.previousVersion).toBe("0.3.8");
    expect(first.versionSince).toBe(now - 10 * DAY);
    expect(first.activeDays7).toBe(2);
    expect(first.activeDays30).toBe(2);
    expect(first.firstLaunch).toBe(true);

    // 2. Page 2
    const p2Res = await adminFetch("/admin/installs.json?page=2", token);
    const p2 = await p2Res.json();
    expect(p2.page).toBe(2);
    expect(p2.items.length).toBe(5);

    // 3. Filters
    const vFilterRes = await adminFetch("/admin/installs.json?version=0.3.9", token);
    const vFilter = await vFilterRes.json();
    expect(vFilter.total).toBe(30);
    expect(vFilter.items.every((it) => it.version === "0.3.9")).toBe(true);

    const platFilterRes = await adminFetch("/admin/installs.json?platform=macos", token);
    const platFilter = await platFilterRes.json();
    expect(platFilter.total).toBe(27);
    expect(platFilter.items.every((it) => it.platform === "macos")).toBe(true);

    // 4. Invalid params ignored
    const invalidRes = await adminFetch("/admin/installs.json?version=invalid&platform=linux", token);
    const invalid = await invalidRes.json();
    expect(invalid.total).toBe(55);

    // 5. activeDays consistency with stats.json
    const statsRes = await adminFetch("/admin/stats.json", token);
    const stats = await statsRes.json();
    const allInstallsRes = await adminFetch("/admin/installs.json?page=1", token);
    const allInstalls = await allInstallsRes.json();
    const active7Count = allInstalls.items.filter((it) => it.activeDays7 > 0).length;
    const active30Count = allInstalls.items.filter((it) => it.activeDays30 > 0).length;
    expect(active7Count).toBe(stats.activeInstalls7d);
    expect(active30Count).toBe(stats.activeInstalls30d);
  });

  it("install-history.json returns versions ordered by first_seen_at ASC with NULL first", async () => {
    await resetStats();
    const token = await makeToken(goodKey, claims);
    const id = "123e4567-e89b-42d3-a456-426614174000";

    await env.STATS.prepare(
      "INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES " +
        "(?, '0.3.7', NULL, NULL), " +
        "(?, '0.3.9', 3000, '0.3.8'), " +
        "(?, '0.3.8', 2000, '0.3.7')"
    ).bind(id, id, id).run();

    const response = await adminFetch(`/admin/install-history.json?id=${id}`, token);
    expect(response.status).toBe(200);
    const list = await response.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(3);
    expect(list[0]).toEqual({ version: "0.3.7", firstSeenAt: null, fromVersion: null });
    expect(list[1]).toEqual({ version: "0.3.8", firstSeenAt: 2000, fromVersion: "0.3.7" });
    expect(list[2]).toEqual({ version: "0.3.9", firstSeenAt: 3000, fromVersion: "0.3.8" });
  });

  it("filters installs by valid search prefix and ignores invalid search params", async () => {
    await resetStats();
    const token = await makeToken(goodKey, claims);
    const now = Date.now();

    const ids = [
      "00000001-0000-4000-8000-000000000000",
      "00000002-0000-4000-8000-000000000000",
      "abcdef12-0000-4000-8000-000000000000",
    ];
    for (const id of ids) {
      await env.STATS.prepare(
        "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) " +
          "VALUES (?, ?, ?, 'macos', 'arm64', '0.3.9', 0)"
      ).bind(id, now - 10000, now).run();
    }

    // 1. Valid prefix matches exactly
    const res1 = await adminFetch("/admin/installs.json?search=00000001", token);
    const data1 = await res1.json();
    expect(data1.total).toBe(1);
    expect(data1.items.length).toBe(1);
    expect(data1.items[0].installId).toBe("00000001-0000-4000-8000-000000000000");

    // Common prefix matches multiple
    const res2 = await adminFetch("/admin/installs.json?search=0000000", token);
    const data2 = await res2.json();
    expect(data2.total).toBe(2);

    // Case insensitive
    const resUpper = await adminFetch("/admin/installs.json?search=ABCDEF", token);
    const dataUpper = await resUpper.json();
    expect(dataUpper.total).toBe(1);
    expect(dataUpper.items[0].installId).toBe("abcdef12-0000-4000-8000-000000000000");

    // 2. Invalid characters ignored (not treated as error, treated as absent)
    const resInvalid = await adminFetch("/admin/installs.json?search=xyz", token);
    const dataInvalid = await resInvalid.json();
    expect(dataInvalid.total).toBe(3); // ignored, returns all

    // 3. '%' and '_' cannot act as wildcards: they contain invalid characters so are ignored
    const resWildcard1 = await adminFetch("/admin/installs.json?search=%", token);
    const dataWildcard1 = await resWildcard1.json();
    expect(dataWildcard1.total).toBe(3); // ignored, returns all

    const resWildcard2 = await adminFetch("/admin/installs.json?search=_", token);
    const dataWildcard2 = await resWildcard2.json();
    expect(dataWildcard2.total).toBe(3); // ignored, returns all

    const resWildcard3 = await adminFetch("/admin/installs.json?search=00000001%", token);
    const dataWildcard3 = await resWildcard3.json();
    expect(dataWildcard3.total).toBe(3); // contains '%', ignored
  });
});
