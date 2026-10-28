// Feedback endpoint contract, ported from scripts/feedback-service.test.mjs
// (the interface-behavior cases). Differences from the old suite, all of them
// consequences of the deliberate rewrite choices:
//   - storage assertions go against D1 rows instead of files on disk, so the
//     0700/0600 file-mode checks have no equivalent;
//   - the per-IP daily counter became the managed FEEDBACK_LIMITER, keyed by
//     CF-Connecting-IP (the old tests keyed on X-Real-IP);
//   - the admin tests live in admin.test.js because they need an Access JWT.
import { beforeEach, describe, expect, it } from "vitest";
import {
  FEEDBACK_BASE_HEADERS,
  FEEDBACK_URL,
  baseFeedbackBody,
  collectConsole,
  dumpAllRows,
  env,
  fakeLimiter,
  fetchWorker,
  handleFeedbackPost,
  makeEnv,
  postFeedback,
  resetTables,
} from "./helpers.js";

function feedbackRequest(body, headers = FEEDBACK_BASE_HEADERS) {
  return new Request(FEEDBACK_URL, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function storedCount() {
  const row = await env.FEEDBACK.prepare("SELECT COUNT(*) AS n FROM feedback").first();
  return Number(row?.n);
}

describe("POST /api/feedback", () => {
  beforeEach(resetTables);

  it("valid submission returns 201 and stores the sanitized record", async () => {
    const envValue = makeEnv();
    const res = await postFeedback(
      envValue,
      baseFeedbackBody({
        contact: "  me@example.com  ",
        app: {
          product: "GravityPort",
          version: "0.3.0-test",
          gitSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
          platform: "macos",
          osVersion: "macOS 26.1",
          arch: "arm64",
        },
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);

    const record = await envValue.FEEDBACK.prepare("SELECT * FROM feedback WHERE id = ?1").bind(body.id).first();
    expect(record).not.toBeNull();
    expect(Number.isNaN(Date.parse(record.received_at))).toBe(false);
    expect(record.schema_version).toBe(1);
    expect(record.kind).toBe("bug");
    expect(record.message).toBe("测试反馈正文");
    expect(record.contact).toBe("me@example.com");
    expect(record.locale).toBe("zh");
    expect(JSON.parse(record.app_json)).toEqual({
      product: "GravityPort",
      version: "0.3.0-test",
      gitSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
      platform: "macos",
      osVersion: "macOS 26.1",
      arch: "arm64",
    });
    expect(record.diagnostics).toBeNull();
  });

  it("missing or wrong headers return 400 with field headers", async () => {
    const envValue = makeEnv();
    const noClient = await postFeedback(envValue, baseFeedbackBody(), { "Content-Type": "application/json" });
    let body = await noClient.json();
    expect(noClient.status).toBe(400);
    expect(body.code).toBe("FEEDBACK_INVALID");
    expect(body.field).toBe("headers");

    const wrongClient = await postFeedback(envValue, baseFeedbackBody(), {
      "Content-Type": "application/json",
      "X-GravityPort-Client": "browser",
    });
    body = await wrongClient.json();
    expect(wrongClient.status).toBe(400);
    expect(body.field).toBe("headers");

    const notJson = await postFeedback(envValue, baseFeedbackBody(), {
      "Content-Type": "text/plain",
      "X-GravityPort-Client": "desktop",
    });
    body = await notJson.json();
    expect(notJson.status).toBe(400);
    expect(body.field).toBe("headers");
  });

  it("broken or non-object JSON returns 400 with field body", async () => {
    const envValue = makeEnv();
    for (const payload of ["not json", "null", "[]", "42", '"str"']) {
      const res = await postFeedback(envValue, payload);
      const body = await res.json();
      expect(res.status, payload).toBe(400);
      expect(body.code).toBe("FEEDBACK_INVALID");
      expect(body.field).toBe("body");
    }
  });

  it("unknown top-level and app fields are rejected with the offending name", async () => {
    const envValue = makeEnv();
    const topLevel = await postFeedback(envValue, baseFeedbackBody({ installId: "should-not-be-here" }));
    expect(topLevel.status).toBe(400);
    expect((await topLevel.json()).field).toBe("installId");

    const body = baseFeedbackBody();
    body.app.libraryPath = "/Users/someone/Library";
    const inApp = await postFeedback(envValue, body);
    expect(inApp.status).toBe(400);
    expect((await inApp.json()).field).toBe("app.libraryPath");
  });

  it("field boundaries: 5000/200/200000/32/40/64/16 pass, one more fails", async () => {
    const envValue = makeEnv();
    const cases = [
      [{ message: "x".repeat(5000) }, 201, undefined],
      [{ message: "x".repeat(5001) }, 400, "message"],
      [{ message: "   \n\t  " }, 400, "message"],
      [{ contact: "c".repeat(200) }, 201, undefined],
      [{ contact: "c".repeat(201) }, 400, "contact"],
      [{ contact: 42 }, 400, "contact"],
      [{ diagnostics: "d".repeat(200000) }, 201, undefined],
      [{ diagnostics: "d".repeat(200001) }, 400, "diagnostics"],
      [{ app: { ...baseFeedbackBody().app, version: "v".repeat(32) } }, 201, undefined],
      [{ app: { ...baseFeedbackBody().app, version: "v".repeat(33) } }, 400, "app.version"],
      [{ app: { ...baseFeedbackBody().app, gitSha: "a".repeat(40) } }, 201, undefined],
      [{ app: { ...baseFeedbackBody().app, gitSha: "a".repeat(41) } }, 400, "app.gitSha"],
      [{ app: { ...baseFeedbackBody().app, gitSha: "" } }, 400, "app.gitSha"],
      [{ app: { ...baseFeedbackBody().app, osVersion: "o".repeat(64) } }, 201, undefined],
      [{ app: { ...baseFeedbackBody().app, osVersion: "o".repeat(65) } }, 400, "app.osVersion"],
      [{ app: { ...baseFeedbackBody().app, arch: "a".repeat(16) } }, 201, undefined],
      [{ app: { ...baseFeedbackBody().app, arch: "a".repeat(17) } }, 400, "app.arch"],
    ];
    for (const [overrides, expectedStatus, expectedField] of cases) {
      const res = await postFeedback(envValue, baseFeedbackBody(overrides));
      expect(res.status, JSON.stringify(overrides).slice(0, 80)).toBe(expectedStatus);
      const body = await res.json();
      if (expectedField) {
        expect(body.code).toBe("FEEDBACK_INVALID");
        expect(body.field).toBe(expectedField);
      } else {
        expect(body.ok).toBe(true);
      }
    }
  });

  it("enum and type violations return 400 with the right field", async () => {
    const envValue = makeEnv();
    const cases = [
      [{ kind: "feature" }, "kind"],
      [{ kind: 1 }, "kind"],
      [{ locale: "fr" }, "locale"],
      [{ schema: 2 }, "schema"],
      [{ schema: "1" }, "schema"],
      [{ message: undefined }, "message"],
      [{ app: null }, "app"],
      [{ app: "nope" }, "app"],
      [{ app: { product: "GIMP", version: "1", platform: "macos", osVersion: "os", arch: "x64" } }, "app.product"],
      [{ app: { ...baseFeedbackBody().app, platform: "linux" } }, "app.platform"],
      [{ app: { ...baseFeedbackBody().app, version: 3 } }, "app.version"],
    ];
    for (const [overrides, expectedField] of cases) {
      const body = baseFeedbackBody(overrides);
      if (Object.hasOwn(overrides, "message") && overrides.message === undefined) delete body.message;
      const res = await postFeedback(envValue, body);
      const parsed = await res.json();
      expect(res.status, expectedField).toBe(400);
      expect(parsed.code).toBe("FEEDBACK_INVALID");
      expect(parsed.field).toBe(expectedField);
    }
  });

  it("body beyond 300KB returns 413 and stores nothing", async () => {
    const envValue = makeEnv();
    const res = await postFeedback(envValue, baseFeedbackBody({ diagnostics: "x".repeat(310 * 1024) }));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("FEEDBACK_TOO_LARGE");
    expect(await storedCount()).toBe(0);
  });

  it("the 6th request from one IP gets 429 (fake limiter), another IP is unaffected", async () => {
    const limiter = fakeLimiter({ limit: 5 });
    const envValue = makeEnv({ FEEDBACK_LIMITER: limiter });
    for (let i = 0; i < 5; i += 1) {
      const res = await postFeedback(
        envValue,
        baseFeedbackBody({ message: `number ${i}` }),
        { ...FEEDBACK_BASE_HEADERS, "CF-Connecting-IP": "203.0.113.7" },
      );
      expect(res.status).toBe(201);
    }
    const limited = await postFeedback(
      envValue,
      baseFeedbackBody({ message: "one too many" }),
      { ...FEEDBACK_BASE_HEADERS, "CF-Connecting-IP": "203.0.113.7" },
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("FEEDBACK_RATE_LIMITED");

    const otherIp = await postFeedback(
      envValue,
      baseFeedbackBody({ message: "fresh ip" }),
      { ...FEEDBACK_BASE_HEADERS, "CF-Connecting-IP": "198.51.100.9" },
    );
    expect(otherIp.status).toBe(201);
  });

  it("reaching FEEDBACK_MAX_ROWS returns 503", async () => {
    const envValue = makeEnv({ FEEDBACK_MAX_ROWS: "2" });
    expect((await postFeedback(envValue, baseFeedbackBody({ message: "first" }))).status).toBe(201);
    expect((await postFeedback(envValue, baseFeedbackBody({ message: "second" }))).status).toBe(201);
    const full = await postFeedback(envValue, baseFeedbackBody({ message: "third" }));
    expect(full.status).toBe(503);
    expect((await full.json()).code).toBe("FEEDBACK_UNAVAILABLE");
  });

  it("reaching FEEDBACK_MAX_TOTAL_BYTES returns 503", async () => {
    const envValue = makeEnv({ FEEDBACK_MAX_TOTAL_BYTES: "10" });
    const res = await postFeedback(envValue, baseFeedbackBody());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("FEEDBACK_UNAVAILABLE");
  });

  it("the connecting IP never reaches D1, only the limiter key", async () => {
    const limiter = fakeLimiter();
    const envValue = makeEnv({ FEEDBACK_LIMITER: limiter });
    const res = await postFeedback(
      envValue,
      baseFeedbackBody({ message: "ip probe" }),
      { ...FEEDBACK_BASE_HEADERS, "CF-Connecting-IP": "203.0.113.7" },
    );
    expect(res.status).toBe(201);

    const dump = await dumpAllRows();
    expect(dump.includes("203.0.113.7")).toBe(false);
    // The header value did its one job: rate limit key.
    expect(limiter.keys).toContain("203.0.113.7");
  });

  it("logs carry no message, contact, diagnostics or IP", async () => {
    const envValue = makeEnv();
    const consoleSpy = collectConsole();
    try {
      const res = await fetchWorker(
        FEEDBACK_URL,
        {
          method: "POST",
          headers: { ...FEEDBACK_BASE_HEADERS, "CF-Connecting-IP": "192.0.2.111" },
          body: JSON.stringify(
            baseFeedbackBody({
              message: "SECRET_MESSAGE_TEXT",
              contact: "SECRET_CONTACT_ADDRESS",
              diagnostics: "SECRET_DIAGNOSTICS_TEXT",
            }),
          ),
        },
        envValue,
      );
      expect(res.status).toBe(201);
      await fetchWorker("https://gravityport.azhuilab.com/", { method: "GET" }, envValue);
      await fetchWorker(
        FEEDBACK_URL,
        { method: "POST", headers: { ...FEEDBACK_BASE_HEADERS }, body: "not json" },
        envValue,
      );
    } finally {
      consoleSpy.restore();
    }

    const all = consoleSpy.joined();
    expect(all.includes("SECRET_MESSAGE_TEXT")).toBe(false);
    expect(all.includes("SECRET_CONTACT_ADDRESS")).toBe(false);
    expect(all.includes("SECRET_DIAGNOSTICS_TEXT")).toBe(false);
    expect(all.includes("192.0.2.111")).toBe(false);
    expect(all).toMatch(/POST \/api\/feedback 201 \d+/);
    expect(all).toMatch(/POST \/api\/feedback 400 \d+/);
  });
});

describe("router around /api/feedback", () => {
  it("non-POST returns 405 and unknown paths return 404", async () => {
    const envValue = makeEnv();
    const get = await fetchWorker(FEEDBACK_URL, { method: "GET" }, envValue);
    expect(get.status).toBe(405);

    for (const path of ["/api/feedback-list", "/"]) {
      const wrongPath = await fetchWorker(`https://gravityport.azhuilab.com${path}`, { method: "GET" }, envValue);
      expect(wrongPath.status, path).toBe(404);
      expect((await wrongPath.json()).code).toBe("FEEDBACK_NOT_FOUND");
    }
  });
});
