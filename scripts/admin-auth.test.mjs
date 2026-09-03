import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "admin-auth.mjs");

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function startServer(environment) {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`auth server did not start: ${output.join("")}`)), 3000);
    child.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("MOSA private auth listening")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`auth server exited with ${code}: ${output.join("")}`));
    });
  });
  return { child, ready };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

test("admin auth creates a persistent 30-day session cookie", async () => {
  const root = await mkdtemp(join(tmpdir(), "mosa-admin-auth-"));
  const verifierPath = join(root, "fake-htpasswd");
  const statePath = join(root, "sessions.json");
  await writeFile(verifierPath, "#!/bin/sh\nread password\n[ \"$password\" = \"test-pass\" ]\n");
  await chmod(verifierPath, 0o700);
  const port = await freePort();
  const environment = {
    MOSA_AUTH_PORT: String(port),
    MOSA_AUTH_PASSWORD_FILE: join(root, "passwords"),
    MOSA_AUTH_STATE_FILE: statePath,
    MOSA_HTPASSWD_BIN: verifierPath,
  };
  let server = startServer(environment);
  try {
    await server.ready;
    const login = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "mosa-admin", password: "test-pass" }),
      redirect: "manual",
    });
    assert.equal(login.status, 303);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /Max-Age=2592000/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    const sessionCookie = cookie.split(";", 1)[0];

    const auth = await fetch(`http://127.0.0.1:${port}/auth`, { headers: { cookie: sessionCookie } });
    assert.equal(auth.status, 204);
    const unauthorized = await fetch(`http://127.0.0.1:${port}/auth`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), null);
    assert.match(unauthorized.headers.get("content-type"), /^text\/plain; charset=utf-8$/);

    await stopServer(server.child);
    server = startServer(environment);
    await server.ready;
    const afterRestart = await fetch(`http://127.0.0.1:${port}/auth`, { headers: { cookie: sessionCookie } });
    assert.equal(afterRestart.status, 204);

    const logout = await fetch(`http://127.0.0.1:${port}/logout`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    const afterLogout = await fetch(`http://127.0.0.1:${port}/auth`, { headers: { cookie: sessionCookie } });
    assert.equal(afterLogout.status, 401);
    assert.match(await readFile(statePath, "utf8"), /sessions/);
  } finally {
    await stopServer(server.child);
    await rm(root, { recursive: true, force: true });
  }
});
