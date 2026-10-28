// Caller checks for the Pinterest relay (the anti-spoofing measures from the
// security review): no browser-originated requests, per-IP rate limiting,
// one-time session credentials whose D1 footprint is a SHA-256 hash only, and
// the strict "true" mode. The session credential is consumed BEFORE anything
// is forwarded — the "failed exchange" test pins that down, so a failed
// token exchange can never be replayed with the same credential.
import { beforeEach, describe, expect, it } from "vitest";
import {
  PINTEREST_SESSION_URL,
  PINTEREST_TOKEN_URL,
  env,
  fakeLimiter,
  handlePinterestSession,
  handlePinterestToken,
  makeEnv,
  resetTables,
  stubFetch,
} from "./helpers.js";
import { sha256Hex } from "../src/http.js";

const WHITELISTED_REDIRECT = "http://localhost:43517/api/pinterest/callback";

function tokenRequest(body, headers = {}) {
  return new Request(PINTEREST_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sessionRequest(headers = {}) {
  return new Request(PINTEREST_SESSION_URL, { method: "POST", headers });
}

const pinterestOk = () =>
  new Response(JSON.stringify({ access_token: "access_123", refresh_token: "refresh_456", expires_in: 2592000 }), {
    status: 200,
  });

const authCodeBody = {
  grant: "authorization_code",
  code: "test_code_789",
  redirect_uri: WHITELISTED_REDIRECT,
};

async function mintSession(envValue) {
  const res = await handlePinterestSession(sessionRequest(), envValue);
  expect(res.status).toBe(201);
  return res.json();
}

describe("caller checks on the Pinterest relay", () => {
  beforeEach(resetTables);

  it("requests with an Origin header are 403 on both endpoints, with no CORS headers and no forward", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = stubFetch(pinterestOk);
    try {
      for (const [handler, request] of [
        [handlePinterestSession, sessionRequest({ Origin: "https://pages.example" })],
        [handlePinterestToken, tokenRequest(authCodeBody, { Origin: "https://pages.example" })],
      ]) {
        const res = await handler(request, envValue);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("forbidden_origin");
        expect([...res.headers.keys()].some((name) => name.toLowerCase().startsWith("access-control-"))).toBe(false);
      }
      expect(stub.calls.length).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("a minted session credential works once, then is spent", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const { session } = await mintSession(envValue);
    expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stub = stubFetch(pinterestOk);
    try {
      const first = await handlePinterestToken(
        tokenRequest({ ...authCodeBody, session }),
        envValue,
      );
      expect(first.status).toBe(200);

      const second = await handlePinterestToken(
        tokenRequest({ ...authCodeBody, session }),
        envValue,
      );
      expect(second.status).toBe(400);
      expect((await second.json()).error).toBe("invalid_session");
      expect(stub.calls.length).toBe(1);
    } finally {
      stub.restore();
    }
  });

  it("a session credential is consumed even when the exchange fails", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const { session } = await mintSession(envValue);
    const stub = stubFetch(() => new Response("{}", { status: 401 }));
    try {
      const failed = await handlePinterestToken(tokenRequest({ ...authCodeBody, session }), envValue);
      expect(failed.status).toBe(502);

      // The credential must already be gone: a replay gets invalid_session,
      // not another forwarded attempt.
      const replay = await handlePinterestToken(tokenRequest({ ...authCodeBody, session }), envValue);
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe("invalid_session");
    } finally {
      stub.restore();
    }
  });

  it("expired and unknown session credentials are rejected without forwarding", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const { session } = await mintSession(envValue);
    // Age the stored hash past the 10 minute expiry.
    await env.FEEDBACK.prepare("UPDATE pinterest_sessions SET created_at_ms = created_at_ms - 601000").run();

    const stub = stubFetch(pinterestOk);
    try {
      const expired = await handlePinterestToken(tokenRequest({ ...authCodeBody, session }), envValue);
      expect(expired.status).toBe(400);
      expect((await expired.json()).error).toBe("invalid_session");

      const garbage = await handlePinterestToken(
        tokenRequest({ ...authCodeBody, session: "AAAA_invented_credential_AAAAAAAAAAAAAAAAAAAA" }),
        envValue,
      );
      expect(garbage.status).toBe(400);
      expect((await garbage.json()).error).toBe("invalid_session");
      expect(stub.calls.length).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("D1 stores only the SHA-256 of the credential, never the credential itself", async () => {
    const envValue = makeEnv();
    const { session } = await mintSession(envValue);

    const rows = await env.FEEDBACK.prepare("SELECT hash, created_at_ms FROM pinterest_sessions").all();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].hash).toBe(await sha256Hex(session));
    expect(JSON.stringify(rows.results).includes(session)).toBe(false);
  });

  it("strict mode: both grants need the client header, authorization_code also needs the credential", async () => {
    const envValue = makeEnv({
      PINTEREST_APP_SECRET: "test-secret",
      PINTEREST_REQUIRE_SESSION: "true",
    });
    const stub = stubFetch(pinterestOk);
    try {
      // authorization_code without a credential: 400, nothing forwarded.
      const noSession = await handlePinterestToken(tokenRequest(authCodeBody, { "X-GravityPort-Client": "desktop" }), envValue);
      expect(noSession.status).toBe(400);
      expect((await noSession.json()).error).toBe("session_required");

      // Credential present but the client header missing: 400, nothing
      // forwarded (and the credential is not consumed — the header check runs
      // before consumption).
      const { session } = await mintSession(makeEnv());
      const noHeader = await handlePinterestToken(tokenRequest({ ...authCodeBody, session }), envValue);
      expect(noHeader.status).toBe(400);
      expect((await noHeader.json()).error).toBe("session_required");

      // Both present: forwarded.
      const { session: session2 } = await mintSession(makeEnv());
      const ok = await handlePinterestToken(
        tokenRequest({ ...authCodeBody, session: session2 }, { "X-GravityPort-Client": "desktop" }),
        envValue,
      );
      expect(ok.status).toBe(200);

      // refresh_token only needs the header.
      const refreshOk = await handlePinterestToken(
        tokenRequest({ grant: "refresh_token", refresh_token: "old_refresh_token" }, { "X-GravityPort-Client": "desktop" }),
        envValue,
      );
      expect(refreshOk.status).toBe(200);

      const refreshNoHeader = await handlePinterestToken(
        tokenRequest({ grant: "refresh_token", refresh_token: "old_refresh_token" }),
        envValue,
      );
      expect(refreshNoHeader.status).toBe(400);
      expect((await refreshNoHeader.json()).error).toBe("session_required");

      // Exactly the four forwarded requests above went out.
      expect(stub.calls.length).toBe(2);
    } finally {
      stub.restore();
    }
  });

  it("the 11th request from one IP gets 429 (fake limiter), keyed by CF-Connecting-IP", async () => {
    const limiter = fakeLimiter({ limit: 10 });
    const envValue = makeEnv({ PINTEREST_LIMITER: limiter, PINTEREST_APP_SECRET: "test-secret" });
    for (let i = 0; i < 10; i += 1) {
      const res = await handlePinterestSession(
        sessionRequest({ "CF-Connecting-IP": "203.0.113.7" }),
        envValue,
      );
      expect(res.status).toBe(201);
    }
    const limited = await handlePinterestSession(
      sessionRequest({ "CF-Connecting-IP": "203.0.113.7" }),
      envValue,
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    expect(limiter.keys.every((key) => key === "203.0.113.7")).toBe(true);

    // The token endpoint draws from the same limiter.
    const tokenLimited = await handlePinterestToken(
      tokenRequest(authCodeBody, { "CF-Connecting-IP": "203.0.113.7" }),
      envValue,
    );
    expect(tokenLimited.status).toBe(429);
  });
});
