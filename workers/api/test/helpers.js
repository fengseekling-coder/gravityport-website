// Shared test helpers. Tests import the Worker modules directly and call them
// with hand-built env objects (same style as the gp-edge tests); the managed
// rate limit bindings are replaced by controllable fakes, since the real
// limiter only exists on Cloudflare.
import { env } from "cloudflare:test";
import worker from "../src/index.js";
import { handleAdminFeedback } from "../src/admin.js";
import { handleFeedbackPost } from "../src/feedback.js";
import { handlePinterestSession, handlePinterestToken } from "../src/pinterest.js";

export {
  env,
  worker,
  handleAdminFeedback,
  handleFeedbackPost,
  handlePinterestSession,
  handlePinterestToken,
};

/**
 * The cloudflare:test env already carries the real miniflare D1 binding plus
 * the wrangler.toml vars; tests only override single entries.
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function testEnv(overrides = {}) {
  return { ...env, ...overrides };
}

/**
 * A controllable fake for the Workers rate limit bindings.
 * @param {{limit?: number}} [options]
 */
export function fakeLimiter(options = {}) {
  const max = options.limit ?? Infinity;
  const counts = new Map();
  return {
    calls: 0,
    keys: [],
    async limit({ key }) {
      this.calls += 1;
      this.keys.push(key);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= max };
    },
  };
}

/**
 * Fresh env with fake (unlimited) limiters so tests stay deterministic no
 * matter how many requests they make; limiter-specific tests pass a counted
 * fake via overrides.
 * @param {Record<string, unknown>} [overrides]
 */
export function makeEnv(overrides = {}) {
  return testEnv({
    FEEDBACK_LIMITER: fakeLimiter(),
    PINTEREST_LIMITER: fakeLimiter(),
    ...overrides,
  });
}

export function makeCtx() {
  return { waitUntil() {}, passThroughOnException() {} };
}

/**
 * Send a request through the Worker's fetch handler (router-level behavior).
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {Record<string, unknown>} [envOverride]
 * @returns {Promise<Response>}
 */
export async function fetchWorker(url, init = {}, envOverride = undefined) {
  return worker.fetch(new Request(url, init), envOverride ?? makeEnv(), makeCtx());
}

/**
 * Empty both tables. Storage is kept per test file, so tests that count rows
 * reset first.
 * @returns {Promise<void>}
 */
export async function resetTables() {
  await env.FEEDBACK.batch([
    env.FEEDBACK.prepare("DELETE FROM feedback"),
    env.FEEDBACK.prepare("DELETE FROM pinterest_sessions"),
  ]);
}

export const FEEDBACK_BASE_HEADERS = {
  "Content-Type": "application/json",
  "X-GravityPort-Client": "desktop",
};

export function baseFeedbackBody(overrides = {}) {
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

export const FEEDBACK_URL = "https://gravityport.azhuilab.com/api/feedback";
export const MOSA = "https://mosa.azhuilab.com";
export const PINTEREST_TOKEN_URL = "https://gravityport.azhuilab.com/api/pinterest/token";
export const PINTEREST_SESSION_URL = "https://gravityport.azhuilab.com/api/pinterest/session";

/**
 * POST a feedback body straight to the collection handler.
 * @param {Record<string, unknown>} envValue
 * @param {string|object} body
 * @param {Record<string, string>} [headers]
 * @returns {Promise<Response>}
 */
export function postFeedback(envValue, body, headers = FEEDBACK_BASE_HEADERS) {
  return handleFeedbackPost(
    new Request(FEEDBACK_URL, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    envValue,
  );
}

/**
 * GET an admin endpoint straight to its handler (with an optional Access JWT).
 * @param {Record<string, unknown>} envValue
 * @param {string} path e.g. "/admin/feedback.json?limit=2"
 * @param {string} [token]
 * @returns {Promise<Response>}
 */
export function adminGet(envValue, path, token = undefined) {
  const headers = token ? { "Cf-Access-Jwt-Assertion": token } : {};
  const url = `${MOSA}${path}`;
  return handleAdminFeedback(new Request(url, { headers }), envValue, new URL(url).pathname);
}

/**
 * Replace globalThis.fetch with a recording stub until restore() is called.
 * @param {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>} responder
 */
export function stubFetch(responder) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return responder(input, init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/**
 * Collect console.log lines for the no-secrets assertions.
 */
export function collectConsole() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  return {
    lines,
    joined() {
      return lines.join("\n");
    },
    restore() {
      console.log = original;
    },
  };
}

/**
 * All rows of both tables as one string, for "value X appears nowhere"
 * assertions.
 * @returns {Promise<string>}
 */
export async function dumpAllRows() {
  const feedback = await env.FEEDBACK.prepare("SELECT * FROM feedback").all();
  const sessions = await env.FEEDBACK.prepare("SELECT * FROM pinterest_sessions").all();
  return JSON.stringify([feedback.results, sessions.results]);
}
