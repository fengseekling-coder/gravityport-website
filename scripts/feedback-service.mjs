#!/usr/bin/env node

// GravityPort feedback collection service.
// Receives user feedback POSTed from the desktop app, validates it against the
// agreed schema, stores one JSON file per submission under DIR, and serves a
// loopback-only admin listing meant to sit behind nginx auth_request.
// The client IP is used in memory only (rate limiting) and is never written
// to disk or logs.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const PORT = 39129;
const DATA_DIR = "/var/lib/gravityport-feedback";
const MAX_FILES = 10_000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const PER_IP_DAILY = 20;

const MAX_BODY_BYTES = 300 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_HEADER = "x-gravityport-client";
const CLIENT_HEADER_VALUE = "desktop";
const KINDS = ["bug", "idea", "other"];
const LOCALES = ["zh", "en"];
const PRODUCTS = ["GravityPort", "MOSA"];
const PLATFORMS = ["macos", "windows", "other"];
const ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const RATE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readConfig(options = {}) {
  return {
    host: options.host !== undefined ? options.host : HOST,
    port: options.port !== undefined ? options.port : envNumber("GRAVITYPORT_FEEDBACK_PORT", PORT),
    dir: options.dir !== undefined ? options.dir : (process.env.GRAVITYPORT_FEEDBACK_DIR || DATA_DIR),
    maxFiles: options.maxFiles !== undefined ? options.maxFiles : envNumber("GRAVITYPORT_FEEDBACK_MAX_FILES", MAX_FILES),
    maxTotalBytes: options.maxTotalBytes !== undefined
      ? options.maxTotalBytes
      : envNumber("GRAVITYPORT_FEEDBACK_MAX_TOTAL_BYTES", MAX_TOTAL_BYTES),
    perIpDaily: options.perIpDaily !== undefined
      ? options.perIpDaily
      : envNumber("GRAVITYPORT_FEEDBACK_PER_IP_DAILY", PER_IP_DAILY),
  };
}

function send(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function logLine(method, path, status, bodyBytes) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${method} ${path} ${status} ${bodyBytes}`);
}

// Resolves with { text, bytes } once the body has fully arrived, or rejects
// with { tooLarge: true } as soon as the byte budget is exceeded.
function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      reject({ tooLarge: true });
      request.resume();
      return;
    }
    let text = "";
    let bytes = 0;
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        reject({ tooLarge: true });
        request.resume();
        return;
      }
      text += chunk;
    });
    request.on("end", () => {
      if (!rejected) resolveBody({ text, bytes });
    });
    request.on("error", reject);
  });
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validates a parsed body against the agreed interface. Returns
// { value } holding a sanitized copy, or { field } naming the first bad field.
function validateFeedback(input) {
  if (!isPlainObject(input)) return { field: "body" };
  if (typeof input.schema !== "number" || input.schema !== 1) return { field: "schema" };

  const knownKeys = ["schema", "kind", "message", "contact", "locale", "app", "diagnostics"];
  for (const key of Object.keys(input)) {
    if (!knownKeys.includes(key)) return { field: key };
  }

  if (!KINDS.includes(input.kind)) return { field: "kind" };

  if (typeof input.message !== "string") return { field: "message" };
  const message = input.message.trim();
  if (message.length < 1 || message.length > 5000) return { field: "message" };

  let contact = "";
  if (input.contact !== undefined) {
    if (typeof input.contact !== "string") return { field: "contact" };
    contact = input.contact.trim();
    if (contact.length > 200) return { field: "contact" };
  }

  if (!LOCALES.includes(input.locale)) return { field: "locale" };

  if (!isPlainObject(input.app)) return { field: "app" };
  const appKeys = ["product", "version", "gitSha", "platform", "osVersion", "arch"];
  for (const key of Object.keys(input.app)) {
    if (!appKeys.includes(key)) return { field: `app.${key}` };
  }
  const { app } = input;
  if (!PRODUCTS.includes(app.product)) return { field: "app.product" };
  if (typeof app.version !== "string" || app.version.length < 1 || app.version.length > 32) {
    return { field: "app.version" };
  }
  if (app.gitSha !== undefined) {
    if (typeof app.gitSha !== "string" || app.gitSha.length < 1 || app.gitSha.length > 40) {
      return { field: "app.gitSha" };
    }
  }
  if (!PLATFORMS.includes(app.platform)) return { field: "app.platform" };
  if (typeof app.osVersion !== "string" || app.osVersion.length < 1 || app.osVersion.length > 64) {
    return { field: "app.osVersion" };
  }
  if (typeof app.arch !== "string" || app.arch.length < 1 || app.arch.length > 16) {
    return { field: "app.arch" };
  }

  if (input.diagnostics !== undefined) {
    if (typeof input.diagnostics !== "string" || input.diagnostics.length > 200_000) {
      return { field: "diagnostics" };
    }
  }

  const value = {
    schema: 1,
    kind: input.kind,
    message,
    locale: input.locale,
    app: {
      product: app.product,
      version: app.version,
      platform: app.platform,
      osVersion: app.osVersion,
      arch: app.arch,
    },
  };
  if (contact.length > 0) value.contact = contact;
  if (app.gitSha !== undefined) value.app.gitSha = app.gitSha;
  if (input.diagnostics !== undefined) value.diagnostics = input.diagnostics;
  return { value };
}

function makeId(date) {
  const pad = (n, width) => String(n).padStart(width, "0");
  const stamp =
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    "T" +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    "Z";
  return `${stamp}-${randomBytes(4).toString("hex")}`;
}

function createRateLimiter(perIpDaily) {
  const counts = new Map();
  const todayKey = () => new Date().toISOString().slice(0, 10);

  function checkAndCount(ip) {
    const day = todayKey();
    const entry = counts.get(ip);
    if (!entry || entry.day !== day) {
      counts.set(ip, { day, count: 1 });
      return true;
    }
    if (entry.count >= perIpDaily) return false;
    entry.count += 1;
    return true;
  }

  function sweep() {
    const day = todayKey();
    for (const [ip, entry] of counts) {
      if (entry.day !== day) counts.delete(ip);
    }
  }

  const timer = setInterval(sweep, RATE_CLEANUP_INTERVAL_MS);
  timer.unref?.();

  return { checkAndCount, sweep };
}

async function scanStorage(dir) {
  let files = 0;
  let totalBytes = 0;
  let months = [];
  try {
    months = await readdir(dir);
  } catch {
    return { files, totalBytes };
  }
  for (const month of months) {
    let names = [];
    try {
      names = await readdir(join(dir, month));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const info = await stat(join(dir, month, name));
        if (info.isFile()) {
          files += 1;
          totalBytes += info.size;
        }
      } catch {
        // A file vanishing between readdir and stat is fine; the counter
        // stays conservative until the next startup rescan.
      }
    }
  }
  return { files, totalBytes };
}

function createStorage(dir) {
  async function ensureRoot() {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }

  async function save(record) {
    const monthDir = join(dir, record.id.slice(0, 4) + "-" + record.id.slice(4, 6));
    await mkdir(monthDir, { recursive: true, mode: 0o700 });
    await chmod(monthDir, 0o700);
    const target = join(monthDir, `${record.id}.json`);
    const temp = join(monthDir, `.${record.id}.tmp`);
    const payload = Buffer.from(JSON.stringify(record, null, 2), "utf8");
    await writeFile(temp, payload, { mode: 0o600 });
    await rename(temp, target);
    await chmod(target, 0o600);
    return payload.length;
  }

  // The id pattern admits nothing but [0-9A-Z-], so the join below cannot
  // escape DIR; the pattern check is the traversal guard.
  function pathFor(id) {
    if (!ID_PATTERN.test(id)) return null;
    return join(dir, id.slice(0, 4) + "-" + id.slice(4, 6), `${id}.json`);
  }

  async function readItem(id) {
    const target = pathFor(id);
    if (!target) return null;
    try {
      return await readFile(target, "utf8");
    } catch {
      return null;
    }
  }

  async function listIds(before, limit) {
    let months = [];
    try {
      months = await readdir(dir);
    } catch {
      return [];
    }
    const ids = [];
    for (const month of months.sort().reverse()) {
      let names = [];
      try {
        names = await readdir(join(dir, month));
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.endsWith(".json")) ids.push(name.slice(0, -".json".length));
      }
    }
    // Ids start with a fixed-width UTC timestamp, so lexicographic order is
    // chronological order.
    ids.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    const filtered = before ? ids.filter((id) => id < before) : ids;
    return filtered.slice(0, limit);
  }

  return { ensureRoot, save, readItem, listIds };
}

function toListItem(record) {
  const diagnostics = typeof record.diagnostics === "string" ? record.diagnostics : "";
  return {
    id: record.id,
    receivedAt: record.receivedAt,
    kind: record.kind,
    message: record.message,
    contact: typeof record.contact === "string" ? record.contact : "",
    locale: record.locale,
    app: record.app,
    hasDiagnostics: diagnostics.length > 0,
    diagnosticsLength: diagnostics.length,
  };
}

export function createFeedbackServer(options = {}) {
  const config = readConfig(options);
  const storage = createStorage(config.dir);
  const rateLimiter = createRateLimiter(config.perIpDaily);
  const counters = { files: 0, totalBytes: 0 };

  async function handleFeedbackPost(request, response) {
    const headerOk =
      request.headers[CLIENT_HEADER] === CLIENT_HEADER_VALUE &&
      String(request.headers["content-type"] || "").toLowerCase().includes("application/json");
    if (!headerOk) {
      request.resume();
      send(response, 400, { code: "FEEDBACK_INVALID", field: "headers" });
      return 0;
    }

    let text = "";
    let bytes = 0;
    try {
      const read = await readBody(request);
      text = read.text;
      bytes = read.bytes;
    } catch (error) {
      if (error && error.tooLarge) {
        send(response, 413, { code: "FEEDBACK_TOO_LARGE" });
      } else {
        send(response, 400, { code: "FEEDBACK_INVALID", field: "body" });
      }
      return bytes;
    }

    const headerIp = request.headers["x-real-ip"];
    const ip = typeof headerIp === "string" && headerIp ? headerIp : (request.socket.remoteAddress || "unknown");
    if (!rateLimiter.checkAndCount(ip)) {
      send(response, 429, { code: "FEEDBACK_RATE_LIMITED" });
      return bytes;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      send(response, 400, { code: "FEEDBACK_INVALID", field: "body" });
      return bytes;
    }

    const verdict = validateFeedback(parsed);
    if (verdict.field) {
      send(response, 400, { code: "FEEDBACK_INVALID", field: verdict.field });
      return bytes;
    }

    const id = makeId(new Date());
    const record = { id, receivedAt: new Date().toISOString(), ...verdict.value };
    const payloadBytes = Buffer.byteLength(JSON.stringify(record, null, 2), "utf8");
    if (counters.files >= config.maxFiles || counters.totalBytes + payloadBytes > config.maxTotalBytes) {
      send(response, 503, { code: "FEEDBACK_UNAVAILABLE" });
      return bytes;
    }

    try {
      const storedBytes = await storage.save(record);
      counters.files += 1;
      counters.totalBytes += storedBytes;
    } catch {
      send(response, 503, { code: "FEEDBACK_UNAVAILABLE" });
      return bytes;
    }

    send(response, 201, { ok: true, id });
    return bytes;
  }

  async function handleAdmin(request, response, pathname) {
    if (request.method !== "GET") {
      send(response, 404, { code: "FEEDBACK_NOT_FOUND" });
      return 0;
    }
    const query = new URL(request.url || "/", `http://${HOST}`).searchParams;
    if (pathname === "/admin/feedback.json") {
      const limitRaw = query.get("limit");
      let limit = 50;
      if (limitRaw !== null) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          send(response, 400, { code: "FEEDBACK_INVALID", field: "limit" });
          return 0;
        }
      }
      const before = query.get("before");
      if (before !== null && !ID_PATTERN.test(before)) {
        send(response, 400, { code: "FEEDBACK_INVALID", field: "before" });
        return 0;
      }
      const ids = await storage.listIds(before, limit + 1);
      const items = [];
      for (const id of ids.slice(0, limit)) {
        const raw = await storage.readItem(id);
        if (raw === null) continue;
        try {
          items.push(toListItem(JSON.parse(raw)));
        } catch {
          // A corrupted file must not take the whole listing down.
        }
      }
      const nextBefore = ids.length > limit && items.length > 0 ? items[items.length - 1].id : null;
      send(response, 200, { items, nextBefore });
      return 0;
    }

    const id = query.get("id") || "";
    const raw = await storage.readItem(id);
    if (raw === null) {
      send(response, ID_PATTERN.test(id) ? 404 : 400, { code: "FEEDBACK_NOT_FOUND" });
      return 0;
    }
    const payload = Buffer.from(raw, "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": payload.length,
      "Cache-Control": "no-store",
    });
    response.end(payload);
    return payload.length;
  }

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", `http://${HOST}`).pathname;
    let status = 500;
    let bytes = 0;
    try {
      if (pathname === "/api/feedback") {
        status = 0;
        bytes = await handleFeedbackPost(request, response);
        status = response.statusCode;
      } else if (pathname === "/admin/feedback.json" || pathname === "/admin/feedback-item.json") {
        status = 0;
        bytes = await handleAdmin(request, response, pathname);
        status = response.statusCode;
      } else {
        send(response, 404, { code: "FEEDBACK_NOT_FOUND" });
        status = 404;
      }
    } catch {
      if (!response.headersSent) {
        send(response, 500, { code: "FEEDBACK_UNAVAILABLE" });
        status = 500;
      }
    }
    logLine(request.method || "-", pathname, status, bytes);
  });

  server.headersTimeout = REQUEST_TIMEOUT_MS + 1000;
  server.requestTimeout = REQUEST_TIMEOUT_MS + 1000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.on("clientError", (_error, socket) => socket.destroy());

  server.start = async () => {
    await storage.ensureRoot();
    const usage = await scanStorage(config.dir);
    counters.files = usage.files;
    counters.totalBytes = usage.totalBytes;
  };

  server.config = config;
  server.rateLimiter = rateLimiter;

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createFeedbackServer();

  function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server
    .start()
    .then(() => {
      const { host, port, dir } = server.config;
      server.listen(port, host, () => {
        console.log(`Feedback service listening on ${host}:${port}`);
        console.log(`Feedback storage: ${dir}`);
      });
    })
    .catch((error) => {
      console.error(`Failed to start feedback service: ${error.message}`);
      process.exit(1);
    });
}
