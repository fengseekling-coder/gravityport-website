#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const HOST = process.env.MOSA_AUTH_HOST || "127.0.0.1";
const PORT = Number(process.env.MOSA_AUTH_PORT || 39127);
const USERNAME = process.env.MOSA_AUTH_USERNAME || "mosa-admin";
const PASSWORD_FILE = process.env.MOSA_AUTH_PASSWORD_FILE || "/etc/nginx/.htpasswd-mosa-stats";
const STATE_FILE = process.env.MOSA_AUTH_STATE_FILE || "/var/lib/mosa-stats/auth/sessions.json";
const HTPASSWD_BIN = process.env.MOSA_HTPASSWD_BIN || "/usr/bin/htpasswd";
const COOKIE_NAME = "mosa_admin_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const MAX_SESSIONS = 64;
const MAX_BODY_BYTES = 16 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 10;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("MOSA_AUTH_PORT must be a valid TCP port");
}

const sessions = new Map();
const loginFailures = new Map();

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isSessionKey(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function pruneSessions(now = Date.now()) {
  let changed = false;
  for (const [key, expiresAt] of sessions) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
      sessions.delete(key);
      changed = true;
    }
  }
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()]
      .sort(([, leftExpiry], [, rightExpiry]) => leftExpiry - rightExpiry)
      .slice(0, sessions.size - MAX_SESSIONS);
    oldest.forEach(([key]) => sessions.delete(key));
    changed = true;
  }
  return changed;
}

function loadSessions() {
  if (!existsSync(STATE_FILE)) return;
  const contents = readFileSync(STATE_FILE, "utf8");
  if (!contents.trim()) return;
  const parsed = JSON.parse(contents);
  const stored = parsed && typeof parsed.sessions === "object" ? parsed.sessions : {};
  Object.entries(stored).forEach(([key, expiresAt]) => {
    if (isSessionKey(key) && Number.isSafeInteger(expiresAt)) sessions.set(key, expiresAt);
  });
  if (pruneSessions()) saveSessions();
}

function saveSessions() {
  mkdirSync(dirname(STATE_FILE), { recursive: true, mode: 0o750 });
  const temporaryFile = `${STATE_FILE}.tmp-${process.pid}`;
  const contents = JSON.stringify({ sessions: Object.fromEntries(sessions) }) + "\n";
  writeFileSync(temporaryFile, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryFile, 0o600);
  renameSync(temporaryFile, STATE_FILE);
}

function parseCookies(header) {
  const cookies = {};
  String(header || "").split(";").forEach((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = value;
  });
  return cookies;
}

function sessionFromRequest(request) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (!token || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const key = hashToken(token);
  const expiresAt = sessions.get(key);
  if (!expiresAt || expiresAt <= Date.now()) {
    if (sessions.delete(key)) {
      try {
        saveSessions();
      } catch (error) {
        console.error(`Could not persist expired admin session cleanup: ${error.message}`);
      }
    }
    return null;
  }
  return { key, expiresAt };
}

function clientAddress(request) {
  return String(request.headers["x-real-ip"] || request.socket.remoteAddress || "unknown").slice(0, 128);
}

function isLoginBlocked(address, now = Date.now()) {
  const record = loginFailures.get(address);
  if (!record || record.startedAt + LOGIN_WINDOW_MS <= now) {
    loginFailures.delete(address);
    return false;
  }
  return record.count >= LOGIN_FAILURE_LIMIT;
}

function recordLoginFailure(address, now = Date.now()) {
  const record = loginFailures.get(address);
  if (!record || record.startedAt + LOGIN_WINDOW_MS <= now) {
    loginFailures.set(address, { startedAt: now, count: 1 });
  } else {
    record.count += 1;
  }
}

function clearLoginFailures(address) {
  loginFailures.delete(address);
}

function send(response, status, body = "", headers = {}) {
  const payload = Buffer.from(body, "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": payload.length,
    ...headers,
  });
  response.end(payload);
}

function redirect(response, location, headers = {}) {
  send(response, 303, "", { Location: location, ...headers });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      reject(new Error("body_too_large"));
      request.resume();
      return;
    }
    let body = "";
    let bytes = 0;
    let rejected = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (rejected) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error("body_too_large"));
        request.resume();
        return;
      }
      body += chunk;
    });
    request.on("end", () => { if (!rejected) resolve(body); });
    request.on("error", reject);
  });
}

function verifyPassword(password) {
  return new Promise((resolve) => {
    const verifier = spawn(HTPASSWD_BIN, ["-v", "-i", PASSWORD_FILE, USERNAME], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    const timeout = setTimeout(() => {
      verifier.kill("SIGKILL");
      resolve(false);
    }, 5000);
    verifier.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    verifier.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve(code === 0 && !signal);
    });
    verifier.stdin.on("error", () => {});
    verifier.stdin.end(`${password}\n`);
  });
}

function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Expires=${expires}; Path=/admin/; HttpOnly; Secure; SameSite=Strict`;
}

async function handleLogin(request, response) {
  if (request.method !== "POST") {
    send(response, 405, "Method Not Allowed\n", { Allow: "POST" });
    return;
  }
  let body;
  try {
    body = await readBody(request);
  } catch {
    send(response, 413, "Request Entity Too Large\n");
    return;
  }
  const form = new URLSearchParams(body);
  const username = form.get("username") || "";
  const password = form.get("password") || "";
  const address = clientAddress(request);
  const validInput = username === USERNAME && password.length > 0 && password.length <= 1024 && !/[\r\n]/.test(password);
  const validPassword = !isLoginBlocked(address) && validInput && await verifyPassword(password);
  if (!validPassword) {
    recordLoginFailure(address);
    redirect(response, "/admin/login.html?error=1");
    return;
  }
  clearLoginFailures(address);
  pruneSessions();
  const token = randomBytes(32).toString("base64url");
  const tokenKey = hashToken(token);
  sessions.set(tokenKey, Date.now() + SESSION_TTL_MS);
  try {
    saveSessions();
  } catch (error) {
    sessions.delete(tokenKey);
    console.error(`Could not persist admin session: ${error.message}`);
    send(response, 503, "暂时无法创建登录会话，请稍后重试。\n");
    return;
  }
  redirect(response, "/admin/", { "Set-Cookie": sessionCookie(token) });
}

function handleAuth(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    return;
  }
  if (sessionFromRequest(request)) {
    send(response, 204);
  } else {
    send(response, 401, "Unauthorized\n");
  }
}

function handleLogout(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    send(response, 405, "Method Not Allowed\n", { Allow: "GET, POST" });
    return;
  }
  const session = sessionFromRequest(request);
  if (session) {
    sessions.delete(session.key);
    try {
      saveSessions();
    } catch (error) {
      console.error(`Could not persist admin logout: ${error.message}`);
      send(response, 503, "暂时无法退出登录，请稍后重试。\n");
      return;
    }
  }
  redirect(response, "/admin/login.html", { "Set-Cookie": sessionCookie("", 0) });
}

loadSessions();

const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", `http://${HOST}`).pathname;
  if (pathname === "/login") {
    void handleLogin(request, response);
  } else if (pathname === "/auth") {
    handleAuth(request, response);
  } else if (pathname === "/logout") {
    handleLogout(request, response);
  } else {
    send(response, 404, "Not Found\n");
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.on("clientError", (_error, socket) => socket.destroy());

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(PORT, HOST, () => {
  console.log(`MOSA private auth listening on ${HOST}:${PORT}`);
});
