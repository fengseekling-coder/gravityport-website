#!/usr/bin/env node
// Minimal Cloudflare R2 (S3-compatible) client built on the macOS system curl
// with built-in AWS SigV4 signing (--aws-sigv4). No new tooling is installed.
//
// Secrets never reach a command line: curl reads `user = "<id>:<secret>"` from
// stdin via `-K -`, so `ps` cannot observe them and nothing is written to a
// temp file. Errors and logs are scrubbed of the secret before printing.
//
// Commands (all print one JSON object per line on success; "list" prints one
// JSON object per object):
//   r2-client.mjs put <local-file> <key>
//   r2-client.mjs head <key>
//   r2-client.mjs get <key> <output-file>
//   r2-client.mjs list <prefix>
//   r2-client.mjs delete <key>
//   r2-client.mjs copy <source-key> <destination-key>
//
// Exit codes: 0 = the HTTP exchange completed (head/get report the status in
// the JSON output, 404 is a normal answer); 3 = the server answered with a
// non-2xx status where the caller needs success (put/copy/delete, and head/get
// statuses other than 200/404); 1 = configuration or network failure.
//
// Configuration (environment variables):
//   MOSA_RELEASE_R2_ENDPOINT          e.g. https://<account>.r2.cloudflarestorage.com
//   MOSA_RELEASE_R2_BUCKET            default: gravityport-releases
//   MOSA_RELEASE_R2_ACCESS_KEY_ID     required
//   MOSA_RELEASE_R2_SECRET_ACCESS_KEY falls back to the login keychain entry
//                                     "gravityport-r2-release" via
//                                     `security find-generic-password -s … -w`

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEYCHAIN_ITEM = "gravityport-r2-release";

function fail(message) {
  process.stderr.write(`r2-client: ${message}\n`);
  process.exit(1);
}

function readConfig() {
  const endpoint = process.env.MOSA_RELEASE_R2_ENDPOINT || "";
  const bucket = process.env.MOSA_RELEASE_R2_BUCKET || "gravityport-releases";
  const accessKeyId = process.env.MOSA_RELEASE_R2_ACCESS_KEY_ID || "";
  let secretAccessKey = process.env.MOSA_RELEASE_R2_SECRET_ACCESS_KEY || "";

  if (!endpoint) fail("MOSA_RELEASE_R2_ENDPOINT is not set");
  if (/\/$/.test(endpoint)) fail("MOSA_RELEASE_R2_ENDPOINT must not end with a slash");
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      fail("MOSA_RELEASE_R2_ENDPOINT must be an http(s) URL");
    }
  } catch {
    fail("MOSA_RELEASE_R2_ENDPOINT is not a valid URL");
  }
  if (!bucket) fail("MOSA_RELEASE_R2_BUCKET is empty");
  if (!accessKeyId) fail("MOSA_RELEASE_R2_ACCESS_KEY_ID is not set");

  if (!secretAccessKey) {
    const lookup = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN_ITEM, "-w"], {
      encoding: "utf8",
    });
    if (lookup.status !== 0 || !lookup.stdout) {
      fail(
        `MOSA_RELEASE_R2_SECRET_ACCESS_KEY is not set and the keychain item "${KEYCHAIN_ITEM}" could not be read`,
      );
    }
    secretAccessKey = lookup.stdout.replace(/\r?\n$/, "");
  }
  if (!secretAccessKey) fail("the resolved R2 secret access key is empty");

  // curl's config file parser takes the value between double quotes verbatim;
  // reject anything that could break out of (or corrupt) that quoting instead
  // of trying to escape it. Real R2 keys are plain ASCII tokens.
  if (/["\\\r\n]/.test(accessKeyId) || /["\\\r\n]/.test(secretAccessKey)) {
    fail("the R2 access key id or secret contains characters that cannot be passed safely");
  }

  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKeyId, secretAccessKey };
}

function encodeKeyPath(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function xmlUnescape(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?([0-9a-fA-F]+);/g, (_, code, offset, full) => {
      void offset;
      void full;
      const value = code.startsWith("x") || code.startsWith("X") ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
      return String.fromCodePoint(value);
    })
    .replace(/&amp;/g, "&");
}

// Runs curl once. The credentials are fed through stdin via `-K -`, never as
// arguments. Returns { status, stdout } where stdout is the response body plus
// a trailing line with the HTTP status code (see `lastStatusLine`).
function runCurl(config, curlArgs) {
  const args = [
    "-sS",
    "--aws-sigv4", "aws:amz:auto:s3",
    "-K", "-",
    ...curlArgs,
  ];
  const result = spawnSync("curl", args, {
    input: `user = "${config.accessKeyId}:${config.secretAccessKey}"\n`,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) fail(`could not run curl: ${result.error.message}`);
  if (result.status !== 0) {
    // curl transport-level failure; scrub stderr of the secret just in case.
    const stderr = result.stderr ? result.stderr.toString("utf8") : "";
    fail(stderr.trim() ? scrub(config, stderr.trim()) : `curl exited with status ${result.status}`);
  }
  const stdout = result.stdout ? result.stdout.toString("utf8") : "";
  const lastNewline = stdout.lastIndexOf("\n");
  const statusText = lastNewline >= 0 ? stdout.slice(lastNewline + 1) : stdout;
  const status = Number.parseInt(statusText.trim(), 10);
  const body = lastNewline >= 0 ? stdout.slice(0, lastNewline) : "";
  if (!Number.isInteger(status) || status <= 0) {
    fail("could not read the HTTP status from curl (-w)");
  }
  return { status, body };
}

function scrub(config, text) {
  return text.split(config.secretAccessKey).join("***");
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function objectUrl(config, key) {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeKeyPath(key)}`;
}

function bucketUrl(config) {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}`;
}

function sha256Base64File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("base64");
}

function sha256HexFile(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function non2xxExit(status, what) {
  process.stderr.write(`r2-client: ${what} got HTTP ${status}\n`);
  process.exit(3);
}

// HEAD responses carry the size and (when set at upload time) the
// x-amz-meta-sha256 user metadata, which callers use to skip identical
// re-uploads without downloading the object.
function parseHeadHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r2-client."));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function commandPut(config, [localFile, key]) {
  if (!localFile || !key) fail("usage: put <local-file> <key>");
  if (!fs.existsSync(localFile)) fail(`local file does not exist: ${localFile}`);
  const checksum = sha256Base64File(localFile);
  const metaSha = sha256HexFile(localFile);
  const { status } = runCurl(config, [
    "-T", localFile,
    "-o", "/dev/null",
    "-H", `x-amz-checksum-sha256: ${checksum}`,
    "-H", `x-amz-meta-sha256: ${metaSha}`,
    "-w", "\n%{http_code}",
    objectUrl(config, key),
  ]);
  if (status < 200 || status >= 300) non2xxExit(status, `put ${key}`);
  emit({ ok: true, op: "put", key, size: fs.statSync(localFile).size, status });
}

function commandHead(config, [key]) {
  if (!key) fail("usage: head <key>");
  const { status, headers } = withTempDir((dir) => {
    const headerFile = path.join(dir, "headers.txt");
    const result = runCurl(config, [
      "-I",
      "-D", headerFile,
      "-o", "/dev/null",
      "-w", "\n%{http_code}",
      objectUrl(config, key),
    ]);
    const headerText = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, "utf8") : "";
    return { ...result, headers: parseHeadHeaders(headerText) };
  });
  if (status === 404) {
    emit({ ok: true, op: "head", key, status: 404, size: null, metaSha256: null });
    return;
  }
  if (status < 200 || status >= 300) non2xxExit(status, `head ${key}`);
  const size = headers["content-length"] !== undefined ? Number.parseInt(headers["content-length"], 10) : null;
  emit({
    ok: true,
    op: "head",
    key,
    status,
    size: Number.isInteger(size) ? size : null,
    metaSha256: headers["x-amz-meta-sha256"] || null,
  });
}

function commandGet(config, [key, outputFile]) {
  if (!key || !outputFile) fail("usage: get <key> <output-file>");
  const { status } = runCurl(config, [
    "-o", outputFile,
    "-w", "\n%{http_code}",
    objectUrl(config, key),
  ]);
  if (status === 404) {
    fs.rmSync(outputFile, { force: true });
    emit({ ok: true, op: "get", key, status: 404, size: null });
    return;
  }
  if (status < 200 || status >= 300) {
    fs.rmSync(outputFile, { force: true });
    non2xxExit(status, `get ${key}`);
  }
  emit({ ok: true, op: "get", key, status, size: fs.statSync(outputFile).size });
}

function commandList(config, [prefix = ""]) {
  const objects = [];
  let continuationToken = "";
  let pages = 0;
  do {
    pages += 1;
    if (pages > 1000) fail("list did not terminate within 1000 pages");
    const params = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (continuationToken) params.set("continuation-token", continuationToken);
    const { status, body } = runCurl(config, [
      "-w", "\n%{http_code}",
      `${bucketUrl(config)}?${params.toString()}`,
    ]);
    if (status < 200 || status >= 300) non2xxExit(status, `list ${prefix}`);
    for (const match of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const entry = match[1];
      const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(entry);
      const sizeMatch = /<Size>(\d+)<\/Size>/.exec(entry);
      if (!keyMatch) continue;
      objects.push({
        key: xmlUnescape(keyMatch[1]),
        size: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : null,
      });
    }
    if (/<IsTruncated>true<\/IsTruncated>/.test(body)) {
      const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(body);
      continuationToken = tokenMatch ? xmlUnescape(tokenMatch[1]) : "";
      if (!continuationToken) fail("list response is truncated but carries no continuation token");
    } else {
      continuationToken = "";
    }
  } while (continuationToken);
  for (const object of objects) emit({ ok: true, op: "list", prefix, ...object });
}

function commandDelete(config, [key]) {
  if (!key) fail("usage: delete <key>");
  const { status } = runCurl(config, [
    "-X", "DELETE",
    "-o", "/dev/null",
    "-w", "\n%{http_code}",
    objectUrl(config, key),
  ]);
  if (status < 200 || status >= 300) non2xxExit(status, `delete ${key}`);
  emit({ ok: true, op: "delete", key, status });
}

function commandCopy(config, [sourceKey, destinationKey]) {
  if (!sourceKey || !destinationKey) fail("usage: copy <source-key> <destination-key>");
  const { status } = runCurl(config, [
    "-X", "PUT",
    "-T", "/dev/null",
    "-o", "/dev/null",
    "-H", `x-amz-copy-source: /${encodeURIComponent(config.bucket)}/${encodeKeyPath(sourceKey)}`,
    "-w", "\n%{http_code}",
    objectUrl(config, destinationKey),
  ]);
  if (status < 200 || status >= 300) non2xxExit(status, `copy ${sourceKey} -> ${destinationKey}`);
  emit({ ok: true, op: "copy", source: sourceKey, destination: destinationKey, status });
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const config = readConfig();
  switch (command) {
    case "put": return commandPut(config, rest);
    case "head": return commandHead(config, rest);
    case "get": return commandGet(config, rest);
    case "list": return commandList(config, rest);
    case "delete": return commandDelete(config, rest);
    case "copy": return commandCopy(config, rest);
    default:
      fail(`unknown command: ${command || "(none)"}; expected put|head|get|list|delete|copy`);
  }
}

main();
