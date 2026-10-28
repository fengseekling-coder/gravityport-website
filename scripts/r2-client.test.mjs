// Tests for scripts/r2-client.mjs, plus the in-process fake S3 server that the
// dual-publish tests (publish-desktop-release.r2.test.mjs) reuse.
//
// The fake server implements just enough of the S3 API for curl's SigV4
// client: it validates the Authorization header shape and the
// x-amz-content-sha256 header, verifies PUT checksums, and serves
// GET/HEAD/PUT/DELETE/ListObjectsV2 (with pagination)/CopyObject. It cannot
// verify the signature itself — that is exercised against real R2 after A1.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The client must be spawned asynchronously: the fake S3 lives in this very
// process, so a synchronous child wait would block the event loop and deadlock
// against curl's request to the fake server.
const execFileAsync = promisify(execFile);

const clientPath = new URL("./r2-client.mjs", import.meta.url).pathname;

export const TEST_ACCESS_KEY_ID = "AKIDTEST0000000000000000";
export const TEST_SECRET_ACCESS_KEY = "test-secret-access-key-0123456789abcdef0123456789";

function xmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// In-process fake S3. Options:
//   maxListKeys      page size for ListObjectsV2 (exercises pagination)
//   failPutForKey    { [keyPrefix]: status } → PUT replies with this status
//                    before checksum validation (exercises mid-run failures)
//   rejectChecksumFor { [keyPrefix]: true } → PUT pretends the checksum was
//                    wrong and replies 400 even if it matches
//   orderLogFile     every handled request is appended here as one line, in
//                    receive order, so tests can order R2 traffic against the
//                    fake ssh/rsync stubs' log entries.
export function createFakeS3({ maxListKeys = 1000, failPutForKey = {}, rejectChecksumFor = {}, orderLogFile = "" } = {}) {
  const objects = new Map();
  const requests = [];

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, "http://127.0.0.1");
      const pathName = decodeURIComponent(url.pathname);
      const method = req.method || "";
      const authorization = req.headers.authorization || "";
      const record = {
        method,
        path: pathName,
        query: Object.fromEntries(url.searchParams.entries()),
        authorization,
        hasContentSha256: "x-amz-content-sha256" in req.headers,
        checksumHeader: req.headers["x-amz-checksum-sha256"] || null,
        copySource: req.headers["x-amz-copy-source"] || null,
        metaSha256: req.headers["x-amz-meta-sha256"] || null,
        bodyLength: body.length,
      };
      requests.push(record);
      if (orderLogFile) {
        fs.appendFileSync(orderLogFile, `r2 ${method} ${pathName}${url.search}\n`);
      }

      // Auth shape: AWS SigV4 with our test key id.
      if (!authorization.startsWith("AWS4-HMAC-SHA256") || !authorization.includes(`Credential=${TEST_ACCESS_KEY_ID}/`)) {
        res.writeHead(403, { "content-type": "application/xml" });
        res.end("<Error><Code>AccessDenied</Code></Error>");
        return;
      }
      if (!record.hasContentSha256) {
        res.writeHead(400, { "content-type": "application/xml" });
        res.end("<Error><Code>InvalidRequest</Code><Message>missing x-amz-content-sha256</Message></Error>");
        return;
      }

      const segments = pathName.split("/").filter(Boolean);
      // <bucket>/<key…> or <bucket> (list).
      const key = segments.length > 1 ? segments.slice(1).join("/") : null;
      if (segments.length === 0 || segments[0] !== "test-bucket") {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end("<Error><Code>NoSuchBucket</Code></Error>");
        return;
      }

      const failStatus = Object.entries(failPutForKey).find(([prefix]) => key !== null && key.startsWith(prefix));
      if (method === "PUT" && !record.copySource && failStatus) {
        res.writeHead(Number(failStatus[1]), { "content-type": "application/xml" });
        res.end("<Error><Code>InternalError</Code></Error>");
        return;
      }

      if (method === "PUT" && record.copySource) {
        // CopyObject.
        const source = decodeURIComponent(record.copySource.replace(/^\/[^/]+\//, ""));
        if (!objects.has(source)) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        objects.set(key, { ...objects.get(source) });
        res.writeHead(200, { "content-type": "application/xml" });
        res.end("<CopyObjectResult><ETag>&#34;copy&#34;</ETag></CopyObjectResult>");
        return;
      }

      if (method === "PUT") {
        const expected = record.checksumHeader;
        const actual = createHash("sha256").update(body).digest("base64");
        const rejected = Object.keys(rejectChecksumFor).some((prefix) => key !== null && key.startsWith(prefix));
        if (!expected || expected !== actual || rejected) {
          res.writeHead(400, { "content-type": "application/xml" });
          res.end("<Error><Code>BadDigest</Code><Message>The Content-SHA256 you specified did not match</Message></Error>");
          return;
        }
        objects.set(key, { body, metaSha256: record.metaSha256, checksum: expected });
        res.writeHead(200, { etag: '"uploaded"' });
        res.end();
        return;
      }

      if (method === "HEAD") {
        const object = objects.get(key);
        if (!object) {
          res.writeHead(404);
          res.end();
          return;
        }
        const headers = { "content-length": String(object.body.length) };
        if (object.metaSha256) headers["x-amz-meta-sha256"] = object.metaSha256;
        res.writeHead(200, headers);
        res.end();
        return;
      }

      if (method === "GET" && key !== null) {
        const object = objects.get(key);
        if (!object) {
          res.writeHead(404, { "content-type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, { "content-length": String(object.body.length) });
        res.end(object.body);
        return;
      }

      if (method === "GET" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") || "";
        const token = url.searchParams.get("continuation-token") || "";
        const keys = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
        const startIndex = token ? Number.parseInt(token, 10) : 0;
        const pageKeys = keys.slice(startIndex, startIndex + maxListKeys);
        const truncated = startIndex + maxListKeys < keys.length;
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<ListBucketResult>",
          `<IsTruncated>${truncated}</IsTruncated>`,
          truncated ? `<NextContinuationToken>${String(startIndex + maxListKeys)}</NextContinuationToken>` : "",
          ...pageKeys.map((name) => {
            const object = objects.get(name);
            return `<Contents><Key>${xmlEscape(name)}</Key><Size>${object.body.length}</Size></Contents>`;
          }),
          "</ListBucketResult>",
        ].join("");
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(xml);
        return;
      }

      if (method === "DELETE") {
        objects.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(400, { "content-type": "application/xml" });
      res.end("<Error><Code>MethodNotAllowed</Code></Error>");
    });
  });

  return {
    server,
    objects,
    requests,
    listen: () =>
      new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      }),
    get endpoint() {
      const address = server.address();
      return `http://127.0.0.1:${address.port}`;
    },
    putObject(key, content, metaSha256 = null) {
      objects.set(key, { body: Buffer.from(content), metaSha256, checksum: createHash("sha256").update(Buffer.from(content)).digest("base64") });
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function clientEnv(fake, extra = {}) {
  return {
    ...process.env,
    MOSA_RELEASE_R2_ENDPOINT: fake.endpoint,
    MOSA_RELEASE_R2_BUCKET: "test-bucket",
    MOSA_RELEASE_R2_ACCESS_KEY_ID: TEST_ACCESS_KEY_ID,
    MOSA_RELEASE_R2_SECRET_ACCESS_KEY: TEST_SECRET_ACCESS_KEY,
    ...extra,
  };
}

export async function runClient(args, env) {
  const { stdout } = await execFileAsync("node", [clientPath, ...args], { env, encoding: "utf8" });
  return stdout;
}

export async function runClientExpectFailure(args, env) {
  let caught = null;
  try {
    await execFileAsync("node", [clientPath, ...args], { env, encoding: "utf8" });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the r2 client to fail");
  return caught;
}

test("put uploads the object and the fake server verifies the checksum", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "package.zip");
  fs.writeFileSync(file, "package payload");
  const output = await runClient(["put", file, "downloads/package.zip"], clientEnv(fake));
  assert.deepEqual(JSON.parse(output.trim()), {
    ok: true, op: "put", key: "downloads/package.zip", size: 15, status: 200,
  });
  assert.equal(fake.objects.get("downloads/package.zip").body.toString(), "package payload");
  assert.equal(fake.requests.length, 1);
  assert.match(fake.requests[0].authorization, /^AWS4-HMAC-SHA256/);
  assert.ok(fake.requests[0].hasContentSha256);
  assert.ok(fake.requests[0].checksumHeader, "put carries x-amz-checksum-sha256");
});

test("head reports the size and the meta sha256 of an uploaded object", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "a.bin");
  fs.writeFileSync(file, "0123456789");
  await runClient(["put", file, "dir/a.bin"], clientEnv(fake));
  const output = await runClient(["head", "dir/a.bin"], clientEnv(fake));
  const parsed = JSON.parse(output.trim());
  assert.equal(parsed.status, 200);
  assert.equal(parsed.size, 10);
  assert.equal(parsed.metaSha256, createHash("sha256").update("0123456789").digest("hex"));
});

test("head answers 404 with exit code 0 and a null size", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const output = await runClient(["head", "missing.bin"], clientEnv(fake));
  assert.equal(JSON.parse(output.trim()).status, 404);
});

test("get downloads the object; a 404 leaves no output file", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fake.putObject("releases/latest.json", '{"version":"1.2.3"}');
  const outFile = path.join(dir, "latest.json");
  await runClient(["get", "releases/latest.json", outFile], clientEnv(fake));
  assert.equal(fs.readFileSync(outFile, "utf8"), '{"version":"1.2.3"}');

  const missing = path.join(dir, "missing.json");
  await runClient(["get", "releases/missing.json", missing], clientEnv(fake));
  assert.equal(fs.existsSync(missing), false, "404 must not leave an output file");
});

test("list aggregates paginated results in order", async (t) => {
  const fake = createFakeS3({ maxListKeys: 2 });
  t.after(() => fake.close());
  await fake.listen();
  for (const key of ["downloads/b.zip", "downloads/a.zip", "downloads/c.zip", "releases/latest.json", "MOSA-other.zip"]) {
    fake.putObject(key, key);
  }
  const output = await runClient(["list", "downloads/"], clientEnv(fake));
  const keys = output.trim().split("\n").map((line) => JSON.parse(line).key);
  assert.deepEqual(keys, ["downloads/a.zip", "downloads/b.zip", "downloads/c.zip"]);
  // Three objects over a two-key page size → two pages.
  const listRequests = fake.requests.filter((request) => request.method === "GET" && request.path === "/test-bucket");
  assert.equal(listRequests.length, 2);
  assert.ok(listRequests[1].query["continuation-token"], "the second page uses the continuation token");
});

test("delete and copy work through the fake server", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  fake.putObject("releases/latest.json", '{"version":"0.9.0"}');
  await runClient(["copy", "releases/latest.json", "releases/history/latest-x.json"], clientEnv(fake));
  assert.equal(fake.objects.get("releases/history/latest-x.json").body.toString(), '{"version":"0.9.0"}');
  await runClient(["delete", "releases/latest.json"], clientEnv(fake));
  assert.equal(fake.objects.has("releases/latest.json"), false);
  const headOutput = await runClient(["head", "releases/latest.json"], clientEnv(fake));
  assert.equal(JSON.parse(headOutput.trim()).status, 404);
});

test("a checksum mismatch is rejected with 400 and a non-zero exit", async (t) => {
  const fake = createFakeS3({ rejectChecksumFor: { "downloads/bad.zip": true } });
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "bad.zip");
  fs.writeFileSync(file, "payload");
  const error = await runClientExpectFailure(["put", file, "downloads/bad.zip"], clientEnv(fake));
  assert.match(String(error.stderr), /HTTP 400/);
  assert.equal(fake.objects.has("downloads/bad.zip"), false);
});

test("a server error on put exits non-zero without storing the object", async (t) => {
  const fake = createFakeS3({ failPutForKey: { "downloads/second.zip": 500 } });
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "second.zip");
  fs.writeFileSync(file, "payload");
  const error = await runClientExpectFailure(["put", file, "downloads/second.zip"], clientEnv(fake));
  assert.match(String(error.stderr), /HTTP 500/);
  assert.equal(fake.objects.has("downloads/second.zip"), false);
});

test("missing configuration fails with a clear message and no network call", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const env = clientEnv(fake);
  delete env.MOSA_RELEASE_R2_ENDPOINT;
  const error = await runClientExpectFailure(["head", "x"], env);
  assert.match(String(error.stderr), /MOSA_RELEASE_R2_ENDPOINT is not set/);
  assert.equal(fake.requests.length, 0);

  const noKey = clientEnv(fake);
  delete noKey.MOSA_RELEASE_R2_ACCESS_KEY_ID;
  const keyError = await runClientExpectFailure(["head", "x"], noKey);
  assert.match(String(keyError.stderr), /MOSA_RELEASE_R2_ACCESS_KEY_ID is not set/);
});

test("the secret never appears in curl's argv, stdout or stderr", async (t) => {
  const fake = createFakeS3();
  t.after(() => fake.close());
  await fake.listen();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client-test."));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const argvLog = path.join(dir, "argv.log");
  const shimDir = path.join(dir, "bin");
  fs.mkdirSync(shimDir);
  // A curl stand-in that records its own argv and then hands over to the
  // real curl, so the client still works end to end.
  fs.writeFileSync(path.join(shimDir, "curl"), `#!/bin/bash
printf '%s\\0' "$@" >> ${JSON.stringify(argvLog)}
exec /usr/bin/curl "$@"
`);
  fs.chmodSync(path.join(shimDir, "curl"), 0o755);
  const file = path.join(dir, "secret-test.bin");
  fs.writeFileSync(file, "payload");
  const env = clientEnv(fake, { PATH: `${shimDir}:${process.env.PATH}` });
  const stdout = await runClient(["put", file, "downloads/argv-test.bin"], env);
  assert.ok(stdout.includes("ok"), "the upload itself succeeded through the shim");
  const argvDump = fs.readFileSync(argvLog, "utf8");
  assert.ok(argvDump.length > 0, "the shim saw at least one invocation");
  assert.equal(argvDump.includes(TEST_SECRET_ACCESS_KEY), false, "the secret must not appear in any argv");
  assert.equal(argvDump.includes(TEST_ACCESS_KEY_ID), false, "the access key id is fed via stdin config, not argv");
});
