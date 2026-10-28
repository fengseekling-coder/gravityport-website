// Pinterest token relay contract, ported from the token service written for
// the old server (commit 9c62945: scripts/pinterest-token.test.mjs), plus the
// 302-rejection case from the migration task. Adaptations, all consequences
// of the Worker rewrite:
//   - the two "missing secret file throws at startup" cases became runtime
//     checks: an unconfigured secret answers 500 misconfigured;
//   - the timeout cases use a fetch stub that honors the abort signal and a
//     short env timeout, since a real socket deadline cannot be reproduced
//     without network;
//   - the fake Pinterest is a recording fetch stub, which also lets every
//     "not forwarded" assertion count the outbound calls;
//   - unknown paths answer with the unified 404 body of this Worker.
import { describe, expect, it } from "vitest";
import {
  PINTEREST_TOKEN_URL,
  collectConsole,
  fakeLimiter,
  fetchWorker,
  handlePinterestToken,
  makeEnv,
  stubFetch,
} from "./helpers.js";

const WHITELISTED_REDIRECT = "http://localhost:43517/api/pinterest/callback";

function tokenRequest(body, headers = {}) {
  return new Request(PINTEREST_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function pinterestStub(response) {
  return stubFetch(async () =>
    typeof response === "function" ? response() : response,
  );
}

const pinterestOk = () =>
  new Response(
    JSON.stringify({
      access_token: "access_123",
      refresh_token: "refresh_456",
      token_type: "bearer",
      expires_in: 2592000,
      refresh_token_expires_in: 5184000,
      scope: "user_accounts:read,boards:read",
      extra: "should_not_appear",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const authCodeBody = {
  grant: "authorization_code",
  code: "test_code_789",
  redirect_uri: WHITELISTED_REDIRECT,
};

describe("POST /api/pinterest/token (forwarding behavior)", () => {
  it("authorization_code success forwards Basic-auth form data and returns only whitelisted fields", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(pinterestOk);
    try {
      const res = await handlePinterestToken(tokenRequest(authCodeBody), envValue);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(stub.calls.length).toBe(1);
      const { init } = stub.calls[0];
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(init.headers.Authorization).toBe(`Basic ${btoa("1628239:test-secret")}`);
      expect(init.body).toMatch(/grant_type=authorization_code/);
      expect(init.body).toMatch(/code=test_code_789/);
      expect(init.body).toMatch(/redirect_uri=http%3A%2F%2Flocalhost%3A43517%2Fapi%2Fpinterest%2Fcallback/);
      expect(init.redirect).toBe("manual");

      expect(body.access_token).toBe("access_123");
      expect(body.refresh_token).toBe("refresh_456");
      expect(body.token_type).toBe("bearer");
      expect(body.expires_in).toBe(2592000);
      expect(body.refresh_token_expires_in).toBe(5184000);
      expect(body.scope).toBe("user_accounts:read,boards:read");
      expect(body.extra).toBeUndefined();
    } finally {
      stub.restore();
    }
  });

  it("refresh_token success", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(
      () =>
        new Response(
          JSON.stringify({ access_token: "new_access", refresh_token: "new_refresh", token_type: "bearer", expires_in: 2592000 }),
          { status: 200 },
        ),
    );
    try {
      const res = await handlePinterestToken(
        tokenRequest({ grant: "refresh_token", refresh_token: "old_refresh_token" }),
        envValue,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.access_token).toBe("new_access");
      expect(body.refresh_token).toBe("new_refresh");
      expect(stub.calls[0].init.body).toMatch(/grant_type=refresh_token/);
      expect(stub.calls[0].init.body).toMatch(/refresh_token=old_refresh_token/);
    } finally {
      stub.restore();
    }
  });

  it("redirect_uri not in whitelist returns 400 without forwarding", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(pinterestOk);
    try {
      const res = await handlePinterestToken(
        tokenRequest({ grant: "authorization_code", code: "test_code", redirect_uri: "http://evil.example/callback" }),
        envValue,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_redirect_uri");
      expect(stub.calls.length).toBe(0);
    } finally {
      stub.restore();
    }
  });

  it("missing fields return 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const missingCode = await handlePinterestToken(tokenRequest({ grant: "authorization_code", code: "test_code" }), envValue);
    expect(missingCode.status).toBe(400);
    const missingRefresh = await handlePinterestToken(tokenRequest({ grant: "refresh_token" }), envValue);
    expect(missingRefresh.status).toBe(400);
  });

  it("invalid field types return 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const res = await handlePinterestToken(tokenRequest({ grant: 123, code: "test" }), envValue);
    expect(res.status).toBe(400);
  });

  it("field exceeding max length returns 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const res = await handlePinterestToken(
      tokenRequest({ grant: "authorization_code", code: "x".repeat(2049), redirect_uri: WHITELISTED_REDIRECT }),
      envValue,
    );
    expect(res.status).toBe(400);
  });

  it("body exceeding 8KB returns 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const res = await handlePinterestToken(
      tokenRequest({ grant: "authorization_code", code: "x".repeat(8 * 1024), redirect_uri: WHITELISTED_REDIRECT }),
      envValue,
    );
    expect(res.status).toBe(400);
  });

  it("invalid JSON returns 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const res = await handlePinterestToken(tokenRequest("not json"), envValue);
    expect(res.status).toBe(400);
  });

  it("unknown grant type returns 400", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const res = await handlePinterestToken(tokenRequest({ grant: "client_credentials", code: "test" }), envValue);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_grant");
  });

  it("JSON body that is not an object returns 400 instead of hanging", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    for (const body of ["null", "[]", "42"]) {
      const res = await handlePinterestToken(tokenRequest(body), envValue);
      expect(res.status, body).toBe(400);
    }
  });

  it("GET returns 405 and other paths return 404", async () => {
    const envValue = makeEnv();
    const get = await fetchWorker(PINTEREST_TOKEN_URL, { method: "GET" }, envValue);
    expect(get.status).toBe(405);

    const other = await fetchWorker("https://gravityport.azhuilab.com/api/pinterest/other", { method: "POST", body: "{}" }, envValue);
    expect(other.status).toBe(404);
  });

  it("Pinterest 401 gives 502 pinterest_rejected", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(() => new Response(JSON.stringify({ error: "invalid_credentials" }), { status: 401 }));
    try {
      const res = await handlePinterestToken(tokenRequest(authCodeBody), envValue);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("pinterest_rejected");
      expect(body.status).toBe(401);
    } finally {
      stub.restore();
    }
  });

  it("a Pinterest redirect (302) counts as a rejection, not something to follow", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(
      () => new Response(null, { status: 302, headers: { location: "https://pinterest.example/elsewhere" } }),
    );
    try {
      const res = await handlePinterestToken(tokenRequest(authCodeBody), envValue);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("pinterest_rejected");
      expect(body.status).toBe(302);
      // Only one outbound call: the relay never followed the redirect.
      expect(stub.calls.length).toBe(1);
      expect(stub.calls[0].init.redirect).toBe("manual");
    } finally {
      stub.restore();
    }
  });

  it("Pinterest timeout gives 504 pinterest_unreachable", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret", PINTEREST_FORWARD_TIMEOUT_MS: "100" });
    // A request that hangs but honors the abort signal, like a stalled socket.
    const stub = stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("The operation was aborted due to timeout");
            error.name = "TimeoutError";
            reject(error);
          });
        }),
    );
    try {
      const res = await handlePinterestToken(tokenRequest(authCodeBody), envValue);
      expect(res.status).toBe(504);
      expect((await res.json()).error).toBe("pinterest_unreachable");
    } finally {
      stub.restore();
    }
  });

  it("an unconfigured secret answers 500 misconfigured with no configuration content", async () => {
    for (const secret of [undefined, ""]) {
      const envValue = makeEnv({ PINTEREST_APP_SECRET: secret });
      const stub = pinterestStub(pinterestOk);
      try {
        const res = await handlePinterestToken(tokenRequest(authCodeBody), envValue);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(JSON.stringify(body).toLowerCase().includes("secret")).toBe(false);
        expect(JSON.stringify(body).includes("PINTEREST")).toBe(false);
        expect(stub.calls.length).toBe(0);
      } finally {
        stub.restore();
      }
    }
  });

  it("Pinterest 2xx without access_token gives 502, not an empty success", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(
      () => new Response(JSON.stringify({ scope: "boards:read" }), { status: 200 }),
    );
    try {
      const res = await handlePinterestToken(tokenRequest({ grant: "refresh_token", refresh_token: "r" }), envValue);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe("pinterest_bad_response");
    } finally {
      stub.restore();
    }
  });

  it("logs carry only grant type and status, never code, tokens, session or the secret", async () => {
    const envValue = makeEnv({ PINTEREST_APP_SECRET: "test-secret" });
    const stub = pinterestStub(pinterestOk);
    const consoleSpy = collectConsole();
    try {
      await handlePinterestToken(tokenRequest({ ...authCodeBody, code: "secret_code_123" }), envValue);
      await handlePinterestToken(tokenRequest({ grant: "refresh_token", refresh_token: "secret_refresh_456" }), envValue);
    } finally {
      consoleSpy.restore();
      stub.restore();
    }

    const all = consoleSpy.joined();
    expect(all.includes("secret_code_123")).toBe(false);
    expect(all.includes("secret_refresh_456")).toBe(false);
    expect(all.includes("access_123")).toBe(false);
    expect(all.includes("refresh_456")).toBe(false);
    expect(all.includes("test-secret")).toBe(false);
    expect(all).toMatch(/grant=authorization_code status=200/);
    expect(all).toMatch(/grant=refresh_token status=200/);
  });

  it("the 11th request from one IP gets 429 (fake limiter)", async () => {
    const limiter = fakeLimiter({ limit: 10 });
    const envValue = makeEnv({ PINTEREST_LIMITER: limiter, PINTEREST_APP_SECRET: "test-secret" });
    for (let i = 0; i < 10; i += 1) {
      // Invalid bodies still count: the limiter sits in front of validation.
      const res = await handlePinterestToken(tokenRequest({}), envValue);
      expect(res.status).toBe(400);
    }
    const limited = await handlePinterestToken(
      tokenRequest(authCodeBody),
      envValue,
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    expect(limiter.keys.every((key) => key === "unknown")).toBe(true);
  });
});
