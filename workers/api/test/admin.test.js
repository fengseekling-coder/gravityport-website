// Admin feedback endpoints: every Cloudflare Access failure is a 403 (there
// is deliberately no "unconfigured" bypass), and with a valid token the
// params, pagination and response shapes match the old feedback service
// (behaviour owned by src/admin.js; the legacy Node suite was removed in 279 C1)
// so admin/feedback.js keeps
// working unchanged. The certs endpoint is stubbed by replacing the global
// fetch (the new vitest-pool-workers API no longer ships fetchMock).
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";import {
  MOSA,
  adminGet,
  baseFeedbackBody,
  env,
  makeEnv,
  postFeedback,
  resetTables,
  stubFetch,
} from "./helpers.js";
import { bytesToBase64Url } from "../src/http.js";

const TEAM_DOMAIN = "access-team.example.com";
const AUD = "gp-admin-audience";
const KID = "access-test-key";
const CERTS_URL = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const encoder = new TextEncoder();

async function generateRsaKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function makeToken(key, claims, headerOverrides = {}) {
  const header = bytesToBase64Url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID, ...headerOverrides })),
  );
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

// One keypair pair for the whole file: the Worker caches the JWKS in memory,
// so the good tests sign with the key the (stubbed) certs endpoint serves,
// and the forged test signs with the other one under the same kid.
let goodKey;
let otherKey;
let publicJwk;
let claims;
let fetchStub;

function accessEnv(overrides = {}) {
  return makeEnv({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD, ...overrides });
}

async function seedThreeFeedback(envValue) {
  // Submissions may land in the same second, where the id's random suffix
  // decides order; derive every expectation from the ids we were given.
  const byMessage = {};
  const submit = async (overrides) => {
    const res = await postFeedback(envValue, baseFeedbackBody(overrides));
    expect(res.status).toBe(201);
    byMessage[overrides.message] = (await res.json()).id;
  };
  await submit({ message: "oldest one" });
  await submit({ message: "middle one", contact: "mid@example.com" });
  await submit({
    message: "newest one",
    diagnostics: "SECRET_DIAGNOSTICS_PAYLOAD",
    app: { ...baseFeedbackBody().app, platform: "windows" },
  });
  return byMessage;
}

describe("admin endpoints behind Cloudflare Access", () => {
  // One keypair pair for the whole file: the Worker caches the JWKS in
  // memory across tests, so every test must sign with the key the (stubbed)
  // certs endpoint served the first time.
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
    };
    await resetTables();
    fetchStub = stubFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === CERTS_URL) {
        return new Response(JSON.stringify({ keys: [{ kty: "RSA", alg: "RS256", kid: KID, ...publicJwk }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected outbound fetch: ${url}`);
    });
  });

  afterEach(() => {
    fetchStub.restore();
  });

  it("rejects missing, malformed and badly-signed tokens with 403", async () => {
    const envValue = accessEnv();
    expect((await adminGet(envValue, "/admin/feedback.json")).status).toBe(403);
    expect((await adminGet(envValue, "/admin/feedback.json", "garbage")).status).toBe(403);
    expect((await adminGet(envValue, "/admin/feedback.json", "a.b")).status).toBe(403);
    const forged = await makeToken(otherKey, claims);
    expect((await adminGet(envValue, "/admin/feedback.json", forged)).status).toBe(403);
  });

  it("rejects wrong issuer, wrong audience, expired tokens and other algorithms", async () => {
    const envValue = accessEnv();
    const wrongIss = await makeToken(goodKey, { ...claims, iss: "https://other.example.com" });
    expect((await adminGet(envValue, "/admin/feedback.json", wrongIss)).status).toBe(403);

    const wrongAud = await makeToken(goodKey, { ...claims, aud: "someone-else" });
    expect((await adminGet(envValue, "/admin/feedback.json", wrongAud)).status).toBe(403);

    const expired = await makeToken(goodKey, { ...claims, exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await adminGet(envValue, "/admin/feedback.json", expired)).status).toBe(403);

    const hs256 = await makeToken(goodKey, claims, { alg: "HS256" });
    expect((await adminGet(envValue, "/admin/feedback.json", hs256)).status).toBe(403);
  });

  it("rejects when Access configuration is empty (no unconfigured bypass)", async () => {
    const token = await makeToken(goodKey, claims);
    const domainEmpty = accessEnv({ ACCESS_TEAM_DOMAIN: "" });
    expect((await adminGet(domainEmpty, "/admin/feedback.json", token)).status).toBe(403);
    const audEmpty = accessEnv({ ACCESS_AUD: "" });
    expect((await adminGet(audEmpty, "/admin/feedback.json", token)).status).toBe(403);
    const bothEmpty = accessEnv({ ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" });
    expect((await adminGet(bothEmpty, "/admin/feedback.json", token)).status).toBe(403);
    const missing = accessEnv({ ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined });
    expect((await adminGet(missing, "/admin/feedback.json", token)).status).toBe(403);
  });

  it("403 responses carry the admin headers", async () => {
    const response = await adminGet(accessEnv(), "/admin/feedback.json");
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
  });

  it("a valid token lists feedback newest-first, paginates via before, and never carries diagnostics", async () => {
    const envValue = accessEnv();
    const byMessage = await seedThreeFeedback(envValue);
    const token = await makeToken(goodKey, claims);

    const all = await adminGet(envValue, "/admin/feedback.json", token);
    expect(all.status).toBe(200);
    expect(all.headers.get("cache-control")).toBe("no-store, private");
    expect(all.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    const page = await all.json();
    expect(page.items.length).toBe(3);
    const ids = page.items.map((item) => item.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    const newestFirst = Object.keys(byMessage).sort((a, b) => (byMessage[a] < byMessage[b] ? 1 : -1));
    expect(page.items.map((item) => item.message)).toEqual(newestFirst);
    expect(page.nextBefore).toBeNull();

    const byId = new Map(page.items.map((item) => [item.id, item]));
    const diagnosticsItem = byId.get(byMessage["newest one"]);
    expect(diagnosticsItem.hasDiagnostics).toBe(true);
    expect(diagnosticsItem.diagnosticsLength).toBe("SECRET_DIAGNOSTICS_PAYLOAD".length);
    expect(JSON.stringify(page).includes("SECRET_DIAGNOSTICS_PAYLOAD")).toBe(false);
    expect(Object.hasOwn(diagnosticsItem, "diagnostics")).toBe(false);
    expect(diagnosticsItem.app.platform).toBe("windows");
    const middleItem = byId.get(byMessage["middle one"]);
    expect(middleItem.contact).toBe("mid@example.com");
    const oldestItem = byId.get(byMessage["oldest one"]);
    expect(oldestItem.contact).toBe("");
    expect(oldestItem.hasDiagnostics).toBe(false);
    expect(oldestItem.diagnosticsLength).toBe(0);

    const page1 = await adminGet(envValue, "/admin/feedback.json?limit=2", token);
    const page1Body = await page1.json();
    expect(page1Body.items.length).toBe(2);
    expect(page1Body.nextBefore).toBe(ids[1]);

    const page2 = await adminGet(envValue, `/admin/feedback.json?before=${page1Body.nextBefore}&limit=2`, token);
    const page2Body = await page2.json();
    expect(page2Body.items.length).toBe(1);
    expect(page2Body.items[0].id).toBe(ids[2]);
    expect(page2Body.nextBefore).toBeNull();
  });

  it("a valid token fetches the full item; malformed ids are rejected without leaking anything", async () => {
    const envValue = accessEnv();
    const submitted = await postFeedback(envValue, baseFeedbackBody({ diagnostics: "FULL_DIAGNOSTICS_TEXT" }));
    const id = (await submitted.json()).id;
    const token = await makeToken(goodKey, claims);

    const item = await adminGet(envValue, `/admin/feedback-item.json?id=${id}`, token);
    expect(item.status).toBe(200);
    const itemBody = await item.json();
    expect(itemBody.id).toBe(id);
    expect(itemBody.diagnostics).toBe("FULL_DIAGNOSTICS_TEXT");
    expect(itemBody.message).toBe("测试反馈正文");
    expect(itemBody.schema).toBe(1);
    expect(itemBody.app.product).toBe("GravityPort");

    const missing = await adminGet(envValue, "/admin/feedback-item.json?id=20260101T000000Z-deadbeef", token);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("FEEDBACK_NOT_FOUND");

    // The id-format guard is the traversal guard of the old file store; here
    // it just keeps the D1 lookup exact. Malformed ids must never read a row.
    for (const bad of ["../decoy", "../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "20260101T000000Z-deadbeefg", "short"]) {
      const res = await adminGet(envValue, `/admin/feedback-item.json?id=${encodeURIComponent(bad)}`, token);
      expect([400, 404], bad).toContain(res.status);
      expect((await res.json()).code).toBe("FEEDBACK_NOT_FOUND");
    }

    const beforeBad = await adminGet(envValue, "/admin/feedback.json?before=../../etc/passwd", token);
    expect(beforeBad.status).toBe(400);
    expect((await beforeBad.json()).field).toBe("before");

    const limitBad = await adminGet(envValue, "/admin/feedback.json?limit=0", token);
    expect(limitBad.status).toBe(400);
    expect((await limitBad.json()).field).toBe("limit");
    const limitBig = await adminGet(envValue, "/admin/feedback.json?limit=101", token);
    expect(limitBig.status).toBe(400);

    const rows = await env.FEEDBACK.prepare("SELECT COUNT(*) AS n FROM feedback").first();
    expect(Number(rows?.n)).toBe(1);
  });

  it("non-GET admin requests return 404 without even checking the token", async () => {
    const envValue = accessEnv();
    const { handleAdminFeedback } = await import("../src/admin.js");
    const post = await handleAdminFeedback(
      new Request(`${MOSA}/admin/feedback.json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      envValue,
      "/admin/feedback.json",
    );
    expect(post.status).toBe(404);
    expect((await post.json()).code).toBe("FEEDBACK_NOT_FOUND");
  });
});
