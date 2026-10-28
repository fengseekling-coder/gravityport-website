// Shared test helpers.
import { env } from "cloudflare:test";
import worker from "../src/index.js";

export { env, worker };

/**
 * The cloudflare:test env already carries the real miniflare R2 and D1
 * bindings plus the wrangler.toml vars; tests only override single entries.
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
export function testEnv(overrides = {}) {
  return { ...env, ...overrides };
}

/**
 * A fetch execution context that collects waitUntil promises so tests can
 * await them before asserting on D1.
 * @returns {{ctx: {waitUntil: (promise: Promise<unknown>) => void}, waitAll: () => Promise<void>}}
 */
export function makeCtx() {
  const pending = [];
  return {
    ctx: {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
    async waitAll() {
      await Promise.allSettled(pending);
    },
  };
}

/**
 * Send a request through the Worker's fetch handler.
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {Record<string, unknown>} [envOverride]
 * @returns {Promise<Response>}
 */
export async function fetchWorker(url, init = {}, envOverride = undefined) {
  const { ctx, waitAll } = makeCtx();
  const response = await worker.fetch(new Request(url, init), envOverride ?? env, ctx);
  await waitAll();
  return response;
}

/**
 * @param {unknown} db STATS binding.
 * @param {string} kind
 * @returns {Promise<{day: string, key: string, count: number}[]>}
 */
export async function counterRows(db, kind) {
  const result = await db.prepare("SELECT day, kind, key, count FROM counters WHERE kind = ? ORDER BY key, day").bind(kind).all();
  return result.results;
}

/**
 * @param {unknown} db STATS binding.
 * @param {string} kind
 * @param {string} [key]
 * @returns {Promise<number>}
 */
export async function counterTotal(db, kind, key = undefined) {
  const sql = key
    ? "SELECT SUM(count) AS total FROM counters WHERE kind = ? AND key = ?"
    : "SELECT SUM(count) AS total FROM counters WHERE kind = ?";
  const values = key ? [kind, key] : [kind];
  const row = await db.prepare(sql).bind(...values).first();
  return Number(row?.total || 0);
}

/**
 * Empty the statistics tables. The pool keeps one storage per test file, so
 * tests that assert on totals reset first.
 * @returns {Promise<void>}
 */
export async function resetStats() {
  await env.STATS.batch([
    env.STATS.prepare("DELETE FROM installs"),
    env.STATS.prepare("DELETE FROM daily_active"),
    env.STATS.prepare("DELETE FROM counters"),
  ]);
}

/**
 * Minimal D1 stub whose every method throws, for proving that recording
 * failures never break responses.
 * @returns {Record<string, unknown>}
 */
export function brokenStats() {
  return {
    prepare() {
      throw new Error("stats unavailable");
    },
    async batch() {
      throw new Error("stats unavailable");
    },
  };
}
