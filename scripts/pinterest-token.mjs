#!/usr/bin/env node

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PINTEREST_TOKEN_PORT || 39128);
const CLIENT_ID = process.env.PINTEREST_CLIENT_ID || "1624448";
const SECRET_FILE = process.env.PINTEREST_SECRET_FILE || "";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_FIELD_LENGTH = 2048;
const REQUEST_TIMEOUT_MS = 15_000;

function getAllowedRedirects() {
  return (process.env.PINTEREST_ALLOWED_REDIRECTS || "http://localhost:43517/api/pinterest/callback")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getPinterestEndpoint() {
  return process.env.PINTEREST_TOKEN_ENDPOINT || "https://api.pinterest.com/v5/oauth/token";
}

function loadSecret() {
  const secretFile = process.env.PINTEREST_SECRET_FILE || "";
  if (!secretFile) {
    throw new Error("PINTEREST_SECRET_FILE environment variable is required");
  }
  let content;
  try {
    content = readFileSync(secretFile, "utf8");
  } catch (error) {
    throw new Error(`Failed to read secret file: ${error.message}`);
  }
  const secret = content.trim();
  if (!secret) {
    throw new Error("Secret file is empty");
  }
  return secret;
}

function log(grantType, statusCode) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} grant=${grantType} status=${statusCode}`);
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

function isValidField(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH;
}

async function callPinterest(secret, formData, timeoutMs = REQUEST_TIMEOUT_MS) {
  const authHeader = Buffer.from(`${CLIENT_ID}:${secret}`).toString("base64");
  const body = new URLSearchParams(formData).toString();
  const url = new URL(getPinterestEndpoint());
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: timeoutMs,
  };

  const protocol = url.protocol === "https:" ? await import("node:https") : await import("node:http");
  
  return new Promise((resolve, reject) => {
    const req = protocol.default.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function handleToken(request, response, secret, requestTimeoutMs) {
  if (request.method !== "POST") {
    send(response, 405, { error: "method_not_allowed" });
    return;
  }

  let bodyText;
  try {
    bodyText = await readBody(request);
  } catch {
    send(response, 400, { error: "bad_request" });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    send(response, 400, { error: "invalid_json" });
    return;
  }

  const { grant, code, redirect_uri, refresh_token } = parsed;

  if (!isValidField(grant)) {
    send(response, 400, { error: "invalid_grant" });
    return;
  }

  const allowedRedirects = getAllowedRedirects();
  let formData;
  if (grant === "authorization_code") {
    if (!isValidField(code) || !isValidField(redirect_uri)) {
      send(response, 400, { error: "missing_fields" });
      return;
    }
    if (!allowedRedirects.includes(redirect_uri)) {
      log(grant, 400);
      send(response, 400, { error: "invalid_redirect_uri" });
      return;
    }
    formData = {
      grant_type: "authorization_code",
      code,
      redirect_uri,
    };
  } else if (grant === "refresh_token") {
    if (!isValidField(refresh_token)) {
      send(response, 400, { error: "missing_fields" });
      return;
    }
    formData = {
      grant_type: "refresh_token",
      refresh_token,
    };
  } else {
    send(response, 400, { error: "unknown_grant" });
    return;
  }

  let pinterestResponse;
  try {
    pinterestResponse = await callPinterest(secret, formData, requestTimeoutMs);
  } catch (error) {
    log(grant, 504);
    send(response, 504, { error: "pinterest_unreachable" });
    return;
  }

  if (pinterestResponse.status >= 200 && pinterestResponse.status < 300) {
    const { access_token, refresh_token, token_type, expires_in, refresh_token_expires_in, scope } = pinterestResponse.data;
    const result = {};
    if (access_token !== undefined) result.access_token = access_token;
    if (refresh_token !== undefined) result.refresh_token = refresh_token;
    if (token_type !== undefined) result.token_type = token_type;
    if (expires_in !== undefined) result.expires_in = expires_in;
    if (refresh_token_expires_in !== undefined) result.refresh_token_expires_in = refresh_token_expires_in;
    if (scope !== undefined) result.scope = scope;
    log(grant, 200);
    send(response, 200, result);
  } else {
    log(grant, 502);
    send(response, 502, { error: "pinterest_rejected", status: pinterestResponse.status });
  }
}

export function createPinterestTokenServer(options = {}) {
  const secret = options.secret !== undefined ? options.secret : loadSecret();
  const requestTimeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : REQUEST_TIMEOUT_MS;

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", `http://${HOST}`).pathname;
    
    if (pathname === "/token") {
      await handleToken(request, response, secret, requestTimeoutMs);
    } else if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 404, { error: "not_found" });
    } else {
      send(response, 404, { error: "not_found" });
    }
  });

  server.headersTimeout = requestTimeoutMs + 1000;
  server.requestTimeout = requestTimeoutMs + 1000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.on("clientError", (_error, socket) => socket.destroy());

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createPinterestTokenServer();
  
  function shutdown() {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(PORT, HOST, () => {
    console.log(`Pinterest token service listening on ${HOST}:${PORT}`);
  });
}
