#!/usr/bin/env node

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinterestTokenServer } from "./pinterest-token.mjs";

const FAKE_PINTEREST_PORT = 39999;
const TOKEN_SERVICE_PORT = 39998;

function makeFakePinterestServer(handlers = {}) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const handler = handlers[req.url] || handlers.default;
      if (handler) {
        try {
          handler(req, body, res);
        } catch (error) {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not_found" }));
      }
    });
    req.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });
  return server;
}

async function request(port, path, options = {}) {
  const http = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.default.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method || "POST",
      headers: options.headers || {},
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data, json: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data, json: null });
        }
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function withServers(fakePinterest, tokenServerOptions, testFn) {
  const fakeServer = makeFakePinterestServer(fakePinterest);
  await new Promise((resolve) => fakeServer.listen(FAKE_PINTEREST_PORT, "127.0.0.1", resolve));
  
  // Save and restore env vars for each test
  const originalEndpoint = process.env.PINTEREST_TOKEN_ENDPOINT;
  const originalRedirects = process.env.PINTEREST_ALLOWED_REDIRECTS;
  
  process.env.PINTEREST_TOKEN_ENDPOINT = `http://127.0.0.1:${FAKE_PINTEREST_PORT}/v5/oauth/token`;
  process.env.PINTEREST_ALLOWED_REDIRECTS = "http://localhost:43517/api/pinterest/callback,http://localhost:9999/callback";
  
  const tokenServer = createPinterestTokenServer(tokenServerOptions);
  await new Promise((resolve) => tokenServer.listen(TOKEN_SERVICE_PORT, "127.0.0.1", resolve));
  
  try {
    await testFn();
  } finally {
    await new Promise((resolve) => tokenServer.close(resolve));
    await new Promise((resolve) => fakeServer.close(resolve));
    
    // Restore env vars
    if (originalEndpoint !== undefined) {
      process.env.PINTEREST_TOKEN_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.PINTEREST_TOKEN_ENDPOINT;
    }
    if (originalRedirects !== undefined) {
      process.env.PINTEREST_ALLOWED_REDIRECTS = originalRedirects;
    } else {
      delete process.env.PINTEREST_ALLOWED_REDIRECTS;
    }
    
    // Give time for sockets to close
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("authorization_code success with only whitelisted fields", async () => {
  const captured = {};
  await withServers({
    "/v5/oauth/token": (req, body, res) => {
      captured.method = req.method;
      captured.contentType = req.headers["content-type"];
      captured.authorization = req.headers["authorization"];
      captured.body = body;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: "access_123",
        refresh_token: "refresh_456",
        token_type: "bearer",
        expires_in: 2592000,
        refresh_token_expires_in: 5184000,
        scope: "user_accounts:read,boards:read",
        extra: "should_not_appear",
      }));
    },
  }, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "test_code_789",
        redirect_uri: "http://localhost:43517/api/pinterest/callback",
      }),
    });
    
    assert.equal(res.status, 200);
    assert.equal(captured.method, "POST");
    assert.equal(captured.contentType, "application/x-www-form-urlencoded");
    assert.equal(captured.authorization, `Basic ${Buffer.from("1624448:test_secret").toString("base64")}`);
    assert.match(captured.body, /grant_type=authorization_code/);
    assert.match(captured.body, /code=test_code_789/);
    assert.match(captured.body, /redirect_uri=http%3A%2F%2Flocalhost%3A43517%2Fapi%2Fpinterest%2Fcallback/);
    
    assert.equal(res.json.access_token, "access_123");
    assert.equal(res.json.refresh_token, "refresh_456");
    assert.equal(res.json.token_type, "bearer");
    assert.equal(res.json.expires_in, 2592000);
    assert.equal(res.json.refresh_token_expires_in, 5184000);
    assert.equal(res.json.scope, "user_accounts:read,boards:read");
    assert.equal(res.json.extra, undefined);
  });
});

test("refresh_token success", async () => {
  await withServers({
    "/v5/oauth/token": (req, body, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        access_token: "new_access",
        refresh_token: "new_refresh",
        token_type: "bearer",
        expires_in: 2592000,
      }));
    },
  }, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "refresh_token",
        refresh_token: "old_refresh_token",
      }),
    });
    
    assert.equal(res.status, 200);
    assert.equal(res.json.access_token, "new_access");
    assert.equal(res.json.refresh_token, "new_refresh");
  });
});

test("redirect_uri not in whitelist returns 400 without forwarding", async () => {
  let forwarded = false;
  await withServers({
    "/v5/oauth/token": () => {
      forwarded = true;
    },
  }, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "test_code",
        redirect_uri: "http://evil.com/callback",
      }),
    });
    
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "invalid_redirect_uri");
    assert.equal(forwarded, false);
  });
});

test("missing fields returns 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res1 = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "test_code",
      }),
    });
    assert.equal(res1.status, 400);
    
    const res2 = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "refresh_token",
      }),
    });
    assert.equal(res2.status, 400);
  });
});

test("invalid field types return 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: 123,
        code: "test",
      }),
    });
    assert.equal(res.status, 400);
  });
});

test("field exceeding max length returns 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "x".repeat(2049),
        redirect_uri: "http://localhost:43517/api/pinterest/callback",
      }),
    });
    assert.equal(res.status, 400);
  });
});

test("body exceeding 8KB returns 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "x".repeat(8 * 1024),
        redirect_uri: "http://localhost:43517/api/pinterest/callback",
      }),
    });
    assert.equal(res.status, 400);
  });
});

test("invalid JSON returns 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    assert.equal(res.status, 400);
  });
});

test("unknown grant type returns 400", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "client_credentials",
        code: "test",
      }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "unknown_grant");
  });
});

test("GET request returns 405", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "GET",
    });
    assert.equal(res.status, 405);
  });
});

test("other paths return 404", async () => {
  await withServers({}, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/other", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404);
  });
});

test("Pinterest returns 401 gives 502 pinterest_rejected", async () => {
  await withServers({
    "/v5/oauth/token": (req, body, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_credentials" }));
    },
  }, { secret: "test_secret" }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "bad_code",
        redirect_uri: "http://localhost:43517/api/pinterest/callback",
      }),
    });
    
    assert.equal(res.status, 502);
    assert.equal(res.json.error, "pinterest_rejected");
    assert.equal(res.json.status, 401);
  });
});

test("Pinterest timeout returns 504 pinterest_unreachable", async () => {
  await withServers({
    "/v5/oauth/token": (req, body, res) => {
      // Don't respond
    },
  }, { secret: "test_secret", timeoutMs: 100 }, async () => {
    const res = await request(TOKEN_SERVICE_PORT, "/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant: "authorization_code",
        code: "test_code",
        redirect_uri: "http://localhost:43517/api/pinterest/callback",
      }),
    });
    
    assert.equal(res.status, 504);
    assert.equal(res.json.error, "pinterest_unreachable");
  });
});

test("missing secret file throws on startup", () => {
  const originalEnv = process.env.PINTEREST_SECRET_FILE;
  try {
    process.env.PINTEREST_SECRET_FILE = "/nonexistent/file/path/secret.txt";
    assert.throws(() => {
      createPinterestTokenServer();
    }, /Failed to read secret file/);
  } finally {
    if (originalEnv !== undefined) {
      process.env.PINTEREST_SECRET_FILE = originalEnv;
    } else {
      delete process.env.PINTEREST_SECRET_FILE;
    }
  }
});

test("empty secret file throws on startup", () => {
  const originalEnv = process.env.PINTEREST_SECRET_FILE;
  const tmpDir = join(tmpdir(), `pinterest-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const emptyFile = join(tmpDir, "empty.txt");
  writeFileSync(emptyFile, "   \n\n  ");
  
  try {
    process.env.PINTEREST_SECRET_FILE = emptyFile;
    assert.throws(() => {
      createPinterestTokenServer();
    }, /Secret file is empty/);
  } finally {
    unlinkSync(emptyFile);
    if (originalEnv !== undefined) {
      process.env.PINTEREST_SECRET_FILE = originalEnv;
    } else {
      delete process.env.PINTEREST_SECRET_FILE;
    }
  }
});

test("logs do not contain sensitive data", async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  
  try {
    await withServers({
      "/v5/oauth/token": (req, body, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          access_token: "secret_access_token",
          refresh_token: "secret_refresh_token",
        }));
      },
    }, { secret: "super_secret" }, async () => {
      await request(TOKEN_SERVICE_PORT, "/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant: "authorization_code",
          code: "secret_code_123",
          redirect_uri: "http://localhost:43517/api/pinterest/callback",
        }),
      });
      
      await request(TOKEN_SERVICE_PORT, "/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant: "refresh_token",
          refresh_token: "secret_refresh_456",
        }),
      });
    });
    
    const allLogs = logs.join(" ");
    assert.equal(allLogs.includes("secret_access_token"), false);
    assert.equal(allLogs.includes("secret_refresh_token"), false);
    assert.equal(allLogs.includes("secret_code_123"), false);
    assert.equal(allLogs.includes("secret_refresh_456"), false);
    assert.equal(allLogs.includes("super_secret"), false);
    assert.match(allLogs, /grant=authorization_code status=200/);
    assert.match(allLogs, /grant=refresh_token status=200/);
  } finally {
    console.log = originalLog;
  }
});
