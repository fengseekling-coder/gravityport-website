#!/usr/bin/env node

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedbackServer } from "./feedback-service.mjs";

const BASE_HEADERS = {
  "Content-Type": "application/json",
  "X-GravityPort-Client": "desktop",
  "X-Real-IP": "203.0.113.7",
};

function baseBody(overrides = {}) {
  return {
    schema: 1,
    kind: "bug",
    message: "测试反馈正文",
    locale: "zh",
    app: {
      product: "GravityPort",
      version: "0.3.0-test",
      platform: "macos",
      osVersion: "macOS 26.1",
      arch: "arm64",
    },
    ...overrides,
  };
}

async function withServer(options, fn) {
  const dir = await mkdtemp(join(tmpdir(), "feedback-test-"));
  const server = createFeedbackServer({ dir, perIpDaily: 1000, ...options });
  await server.start();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await fn({ port, dir, logs });
  } finally {
    console.log = originalLog;
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function requestLine(port, path, method, headers, payload) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload !== undefined ? { ...headers, "Content-Length": Buffer.byteLength(payload) } : headers,
        agent: false,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data, json: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data, json: null });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function post(port, body, headers = BASE_HEADERS) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return requestLine(port, "/api/feedback", "POST", headers, payload);
}

function get(port, path) {
  return requestLine(port, path, "GET", {});
}

async function storedFiles(dir) {
  const found = [];
  let months = [];
  try {
    months = await readdir(dir);
  } catch {
    return found;
  }
  for (const month of months) {
    let names = [];
    try {
      names = await readdir(join(dir, month));
    } catch {
      continue;
    }
    for (const name of names) found.push(join(dir, month, name));
  }
  return found;
}

test("valid submission returns 201 and stores a 0600 file in a 0700 month dir", async () => {
  await withServer({}, async ({ port, dir }) => {
    const res = await post(port, baseBody({
      contact: "  me@example.com  ",
      app: baseBody().app && {
        product: "GravityPort",
        version: "0.3.0-test",
        gitSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
        platform: "macos",
        osVersion: "macOS 26.1",
        arch: "arm64",
      },
    }));

    assert.equal(res.status, 201);
    assert.equal(res.json.ok, true);
    assert.match(res.json.id, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);

    const months = await readdir(dir);
    assert.deepEqual(months, [res.json.id.slice(0, 4) + "-" + res.json.id.slice(4, 6)]);
    const monthDir = join(dir, months[0]);
    assert.equal((await stat(monthDir)).mode & 0o777, 0o700);

    const files = await readdir(monthDir);
    assert.deepEqual(files, [`${res.json.id}.json`]);
    const fileMode = (await stat(join(monthDir, files[0]))).mode & 0o777;
    assert.equal(fileMode, 0o600);

    const record = JSON.parse(await readFile(join(monthDir, files[0]), "utf8"));
    assert.equal(record.id, res.json.id);
    assert.equal(Number.isNaN(Date.parse(record.receivedAt)), false);
    assert.equal(record.schema, 1);
    assert.equal(record.kind, "bug");
    assert.equal(record.message, "测试反馈正文");
    assert.equal(record.contact, "me@example.com");
    assert.equal(record.locale, "zh");
    assert.deepEqual(record.app, {
      product: "GravityPort",
      version: "0.3.0-test",
      gitSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
      platform: "macos",
      osVersion: "macOS 26.1",
      arch: "arm64",
    });
    assert.equal(record.diagnostics, undefined);
  });
});

test("missing or wrong headers return 400 with field headers", async () => {
  await withServer({}, async ({ port }) => {
    const noClient = await post(port, baseBody(), { "Content-Type": "application/json" });
    assert.equal(noClient.status, 400);
    assert.equal(noClient.json.code, "FEEDBACK_INVALID");
    assert.equal(noClient.json.field, "headers");

    const wrongClient = await post(port, baseBody(), {
      "Content-Type": "application/json",
      "X-GravityPort-Client": "browser",
    });
    assert.equal(wrongClient.status, 400);
    assert.equal(wrongClient.json.field, "headers");

    const notJson = await post(port, baseBody(), {
      "Content-Type": "text/plain",
      "X-GravityPort-Client": "desktop",
    });
    assert.equal(notJson.status, 400);
    assert.equal(notJson.json.field, "headers");
  });
});

test("broken or non-object JSON returns 400 with field body", async () => {
  await withServer({}, async ({ port }) => {
    for (const payload of ["not json", "null", "[]", "42", '"str"']) {
      const res = await post(port, payload);
      assert.equal(res.status, 400, payload);
      assert.equal(res.json.code, "FEEDBACK_INVALID");
      assert.equal(res.json.field, "body");
    }
  });
});

test("unknown top-level and app fields are rejected with the offending name", async () => {
  await withServer({}, async ({ port }) => {
    const topLevel = await post(port, baseBody({ installId: "should-not-be-here" }));
    assert.equal(topLevel.status, 400);
    assert.equal(topLevel.json.field, "installId");

    const body = baseBody();
    body.app.libraryPath = "/Users/someone/Library";
    const inApp = await post(port, body);
    assert.equal(inApp.status, 400);
    assert.equal(inApp.json.field, "app.libraryPath");
  });
});

test("field boundaries: 5000/200/200000/32/40/64/16 pass, one more fails", async () => {
  await withServer({}, async ({ port }) => {
    const cases = [
      [{ message: "x".repeat(5000) }, 201, undefined],
      [{ message: "x".repeat(5001) }, 400, "message"],
      [{ message: "   \n\t  " }, 400, "message"],
      [{ contact: "c".repeat(200) }, 201, undefined],
      [{ contact: "c".repeat(201) }, 400, "contact"],
      [{ contact: 42 }, 400, "contact"],
      [{ diagnostics: "d".repeat(200000) }, 201, undefined],
      [{ diagnostics: "d".repeat(200001) }, 400, "diagnostics"],
      [{ app: { ...baseBody().app, version: "v".repeat(32) } }, 201, undefined],
      [{ app: { ...baseBody().app, version: "v".repeat(33) } }, 400, "app.version"],
      [{ app: { ...baseBody().app, gitSha: "a".repeat(40) } }, 201, undefined],
      [{ app: { ...baseBody().app, gitSha: "a".repeat(41) } }, 400, "app.gitSha"],
      [{ app: { ...baseBody().app, gitSha: "" } }, 400, "app.gitSha"],
      [{ app: { ...baseBody().app, osVersion: "o".repeat(64) } }, 201, undefined],
      [{ app: { ...baseBody().app, osVersion: "o".repeat(65) } }, 400, "app.osVersion"],
      [{ app: { ...baseBody().app, arch: "a".repeat(16) } }, 201, undefined],
      [{ app: { ...baseBody().app, arch: "a".repeat(17) } }, 400, "app.arch"],
    ];
    for (const [overrides, expectedStatus, expectedField] of cases) {
      const res = await post(port, baseBody(overrides));
      assert.equal(res.status, expectedStatus, JSON.stringify(overrides).slice(0, 80));
      if (expectedField) {
        assert.equal(res.json.code, "FEEDBACK_INVALID");
        assert.equal(res.json.field, expectedField);
      } else {
        assert.equal(res.json.ok, true);
      }
    }
  });
});

test("enum and type violations return 400 with the right field", async () => {
  await withServer({}, async ({ port }) => {
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
      [{ app: { ...baseBody().app, platform: "linux" } }, "app.platform"],
      [{ app: { ...baseBody().app, version: 3 } }, "app.version"],
    ];
    for (const [overrides, expectedField] of cases) {
      const body = baseBody(overrides);
      if (Object.hasOwn(overrides, "message") && overrides.message === undefined) delete body.message;
      const res = await post(port, body);
      assert.equal(res.status, 400, expectedField);
      assert.equal(res.json.code, "FEEDBACK_INVALID");
      assert.equal(res.json.field, expectedField);
    }
  });
});

test("body beyond 300KB returns 413 and stores nothing", async () => {
  await withServer({}, async ({ port, dir }) => {
    const res = await post(port, baseBody({ diagnostics: "x".repeat(310 * 1024) }));
    assert.equal(res.status, 413);
    assert.equal(res.json.code, "FEEDBACK_TOO_LARGE");
    assert.equal((await storedFiles(dir)).length, 0);
  });
});

test("same IP beyond PER_IP_DAILY gets 429, another IP is unaffected", async () => {
  await withServer({ perIpDaily: 3 }, async ({ port }) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await post(port, baseBody({ message: `number ${i}` }));
      assert.equal(res.status, 201);
    }
    const limited = await post(port, baseBody({ message: "one too many" }));
    assert.equal(limited.status, 429);
    assert.equal(limited.json.code, "FEEDBACK_RATE_LIMITED");

    const otherIp = await post(port, baseBody({ message: "fresh ip" }), {
      ...BASE_HEADERS,
      "X-Real-IP": "198.51.100.9",
    });
    assert.equal(otherIp.status, 201);
  });
});

test("reaching MAX_FILES returns 503", async () => {
  await withServer({ maxFiles: 2 }, async ({ port }) => {
    assert.equal((await post(port, baseBody({ message: "first" }))).status, 201);
    assert.equal((await post(port, baseBody({ message: "second" }))).status, 201);
    const full = await post(port, baseBody({ message: "third" }));
    assert.equal(full.status, 503);
    assert.equal(full.json.code, "FEEDBACK_UNAVAILABLE");
  });
});

test("reaching MAX_TOTAL_BYTES returns 503", async () => {
  await withServer({ maxTotalBytes: 10 }, async ({ port }) => {
    const res = await post(port, baseBody());
    assert.equal(res.status, 503);
    assert.equal(res.json.code, "FEEDBACK_UNAVAILABLE");
  });
});

test("admin list is newest-first, paginates via before, and never carries diagnostics", async () => {
  await withServer({}, async ({ port }) => {
    // Submissions may land in the same second, where the id's random suffix
    // decides order; derive every expectation from the ids we were given.
    const byMessage = {};
    const submit = async (overrides) => {
      const res = await post(port, baseBody(overrides));
      assert.equal(res.status, 201);
      byMessage[overrides.message] = res.json.id;
    };
    await submit({ message: "oldest one" });
    await submit({ message: "middle one", contact: "mid@example.com" });
    await submit({
      message: "newest one",
      diagnostics: "SECRET_DIAGNOSTICS_PAYLOAD",
      app: { ...baseBody().app, platform: "windows" },
    });

    const all = await get(port, "/admin/feedback.json");
    assert.equal(all.status, 200);
    assert.equal(all.json.items.length, 3);
    const ids = all.json.items.map((item) => item.id);
    assert.deepEqual([...ids].sort().reverse(), ids);
    assert.deepEqual(
      all.json.items.map((item) => item.message),
      Object.keys(byMessage).sort((a, b) => (byMessage[a] < byMessage[b] ? 1 : -1)),
    );
    assert.equal(all.json.nextBefore, null);

    const byId = new Map(all.json.items.map((item) => [item.id, item]));
    const diagnosticsItem = byId.get(byMessage["newest one"]);
    assert.equal(diagnosticsItem.hasDiagnostics, true);
    assert.equal(diagnosticsItem.diagnosticsLength, "SECRET_DIAGNOSTICS_PAYLOAD".length);
    assert.equal(all.body.includes("SECRET_DIAGNOSTICS_PAYLOAD"), false);
    assert.equal(Object.hasOwn(diagnosticsItem, "diagnostics"), false);
    assert.equal(diagnosticsItem.app.platform, "windows");
    const middleItem = byId.get(byMessage["middle one"]);
    assert.equal(middleItem.contact, "mid@example.com");
    const oldestItem = byId.get(byMessage["oldest one"]);
    assert.equal(oldestItem.contact, "");
    assert.equal(oldestItem.hasDiagnostics, false);
    assert.equal(oldestItem.diagnosticsLength, 0);

    const page1 = await get(port, "/admin/feedback.json?limit=2");
    assert.equal(page1.json.items.length, 2);
    assert.equal(page1.json.nextBefore, ids[1]);

    const page2 = await get(port, `/admin/feedback.json?before=${page1.json.nextBefore}&limit=2`);
    assert.equal(page2.json.items.length, 1);
    assert.equal(page2.json.items[0].id, ids[2]);
    assert.equal(page2.json.nextBefore, null);
  });
});

test("admin item endpoint returns the full record; malformed ids cannot escape DIR", async () => {
  await withServer({}, async ({ port, dir }) => {
    const submitted = await post(port, baseBody({ diagnostics: "FULL_DIAGNOSTICS_TEXT" }));
    const id = submitted.json.id;

    const item = await get(port, `/admin/feedback-item.json?id=${id}`);
    assert.equal(item.status, 200);
    assert.equal(item.json.id, id);
    assert.equal(item.json.diagnostics, "FULL_DIAGNOSTICS_TEXT");
    assert.equal(item.json.message, "测试反馈正文");

    const missing = await get(port, "/admin/feedback-item.json?id=20260101T000000Z-deadbeef");
    assert.equal(missing.status, 404);

    // Plant a decoy exactly where a traversal lookup for id "../decoy" would
    // land if the id-format guard were missing: the lookup joins DIR, the id's
    // month slice ("../d-ec"), then the id, i.e. DIR/../d-ec/../decoy.json.
    // A leaked read turns into a 200 and fails the assertions below.
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const parent = join(dir, "..");
    mkdirSync(join(parent, "d-ec"), { recursive: true });
    writeFileSync(join(parent, "d-ec", "..", "decoy.json"), JSON.stringify({ trap: "DO_NOT_READ" }));

    try {
      for (const bad of ["../decoy", "../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "20260101T000000Z-deadbeefg", "short"]) {
        const res = await get(port, `/admin/feedback-item.json?id=${encodeURIComponent(bad)}`);
        assert.ok(res.status === 400 || res.status === 404, bad);
        assert.equal(res.json.code, "FEEDBACK_NOT_FOUND");
        assert.equal(res.body.includes("DO_NOT_READ"), false, bad);
      }
    } finally {
      rmSync(join(parent, "d-ec"), { recursive: true, force: true });
      rmSync(join(parent, "decoy.json"), { force: true });
    }

    const beforeBad = await get(port, "/admin/feedback.json?before=../../etc/passwd");
    assert.equal(beforeBad.status, 400);

    const limitBad = await get(port, "/admin/feedback.json?limit=0");
    assert.equal(limitBad.status, 400);
    const limitBig = await get(port, "/admin/feedback.json?limit=101");
    assert.equal(limitBig.status, 400);

    assert.equal((await storedFiles(dir)).length, 1);
  });
});

test("unknown paths and non-GET admin requests return 404", async () => {
  await withServer({}, async ({ port }) => {
    const wrongPath = await requestLine(port, "/api/feedback-list", "GET", {});
    assert.equal(wrongPath.status, 404);
    const rootPath = await requestLine(port, "/", "GET", {});
    assert.equal(rootPath.status, 404);
    const adminPost = await requestLine(port, "/admin/feedback.json", "POST", { "Content-Type": "application/json" }, "{}");
    assert.equal(adminPost.status, 404);
  });
});

test("logs carry no message, contact, diagnostics or IP", async () => {
  await withServer({}, async ({ port, logs }) => {
    await post(port, baseBody({
      message: "SECRET_MESSAGE_TEXT",
      contact: "SECRET_CONTACT_ADDRESS",
      diagnostics: "SECRET_DIAGNOSTICS_TEXT",
    }), { ...BASE_HEADERS, "X-Real-IP": "192.0.2.111" });
    await get(port, "/admin/feedback.json");
    await get(port, "/admin/feedback-item.json?id=20260101T000000Z-deadbeef");

    const all = logs.join("\n");
    assert.equal(all.includes("SECRET_MESSAGE_TEXT"), false);
    assert.equal(all.includes("SECRET_CONTACT_ADDRESS"), false);
    assert.equal(all.includes("SECRET_DIAGNOSTICS_TEXT"), false);
    assert.equal(all.includes("192.0.2.111"), false);
    assert.match(all, /POST \/api\/feedback 201 \d+/);
    assert.match(all, /GET \/admin\/feedback\.json 200/);
  });
});
