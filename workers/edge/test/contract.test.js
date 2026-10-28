// Contract test: the same synthetic events are processed by the real
// scripts/report-usage.mjs (run at config time, expected values injected via
// the CONTRACT_FEED binding) and by the Worker + middleware here. Every
// overlapping metric must match; page-view metrics are only comparable for
// the no-bot scenario because the edge counting changed the PV methodology.
// Storage resets between tests, so the replay runs inside each case.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index.js";
import { onRequest } from "../../../pages/functions/_middleware.js";
import { buildStats } from "../src/stats.js";
import { makeCtx, resetStats } from "./helpers.js";

const feed = JSON.parse(env.CONTRACT_FEED);
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";

const MANIFEST_BODY = '{"version":"0.3.7"}';
const FILE_SIZES = {
  "downloads/GravityPort-darwin-arm64-0.3.7.zip": 4096,
  "downloads/GravityPort-win32-x64-0.3.7.exe": 2048,
  "downloads/GravityPort-Web-Capture-0.15.41.zip": 1024,
  "downloads/MOSA-darwin-arm64-0.3.0-rc.1.zip": 512,
  "downloads/notes.txt": 64,
};

/** Metrics that must be identical across the two pipelines. */
const SHARED_METRICS = [
  "knownInstallationInstances",
  "reportedFirstLaunches",
  "dailyActiveInstalls",
  "activeInstalls7d",
  "activeInstalls30d",
  "platformInstalls",
  "archInstalls",
  "versionInstalls",
  "downloadsByFile",
  "downloadsByRef",
  "desktopDownloadsByFile",
  "extensionDownloadsByFile",
  "totalDownloadRequests",
  "totalDesktopDownloadRequests",
  "totalExtensionDownloadRequests",
  "totalOtherDownloadRequests",
];

/** Page-view metrics: only comparable in the no-bot scenario. */
const PAGE_VIEW_METRICS = ["totalPageViews", "totalHomePageViews", "homeToDownloadRate"];

/**
 * Seed R2 with the manifests and packages, then replay every synthetic event
 * against the Worker (manifests/downloads) and the middleware (page views).
 */
async function replayContract() {
  await resetStats();
  await env.RELEASES.put("releases/latest.json", MANIFEST_BODY);
  await env.RELEASES.put("releases/gravityport/latest.json", '{"version":"0.3.7"}');
  for (const [key, size] of Object.entries(FILE_SIZES)) {
    await env.RELEASES.put(key, "x".repeat(size));
  }

  const statuses = [];
  for (const request of feed.requests) {
    const init = { method: request.method };
    if (request.range) init.headers = { range: request.range };
    const { ctx, waitAll } = makeCtx();
    const response = await worker.fetch(new Request(`https://gravityport.azhuilab.com${request.path}`, init), env, ctx);
    await waitAll();
    statuses.push(response.status);
    // The update clients run with redirect: "error": never a 3xx.
    expect(response.status >= 300 && response.status < 400, `${request.method} ${request.path}`).toBe(false);
  }
  expect(statuses.filter((status) => status === 404).length).toBe(1);
  expect(statuses.filter((status) => status === 206).length).toBe(1);
  expect(statuses.every((status) => status === 200 || status === 206 || status === 404)).toBe(true);

  for (const page of feed.pages) {
    const collected = [];
    const context = {
      request: new Request(`https://gravityport.azhuilab.com${page.path}`, { headers: { "user-agent": DESKTOP_UA } }),
      env: { STATS: env.STATS },
      next: async () => new Response("<!doctype html><html><body>home</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      waitUntil(promise) {
        collected.push(promise);
      },
    };
    const response = await onRequest(context);
    expect(response.status, page.path).toBe(200);
    await Promise.allSettled(collected);
  }
  return statuses;
}

describe("contract: worker vs report-usage.mjs", () => {
  it("produces identical metrics after replaying the same events", async () => {
    await replayContract();
    const workerStats = await buildStats(env.STATS, Date.now());
    const mismatched = [];
    for (const metric of [...SHARED_METRICS, ...PAGE_VIEW_METRICS]) {
      try {
        expect(workerStats[metric], metric).toEqual(feed.expected[metric]);
      } catch {
        mismatched.push(`${metric}: worker=${JSON.stringify(workerStats[metric])} nginx=${JSON.stringify(feed.expected[metric])}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it("kept the page-view totals of the nginx methodology in the no-bot scenario", async () => {
    await replayContract();
    const workerStats = await buildStats(env.STATS, Date.now());
    expect(workerStats.totalPageViews).toBe(feed.expected.totalPageViews);
    expect(workerStats.totalHomePageViews).toBe(feed.expected.totalHomePageViews);
    expect(workerStats.homeToDownloadRate).toBe(feed.expected.homeToDownloadRate);
  });

  it("recorded telemetry for both HEAD and GET on both feed paths", async () => {
    await replayContract();
    const installs = (await env.STATS.prepare("SELECT install_id, first_launch FROM installs").all()).results;
    expect(installs.length).toBe(3);
    expect(installs.filter((row) => row.first_launch).length).toBe(2);
    const daily = (await env.STATS.prepare("SELECT install_id FROM daily_active").all()).results.map((row) => row.install_id);
    // Two v2 reporters; the legacy v1 client is not in the daily sets.
    expect(new Set(daily).size).toBe(2);
  });

  it("counted every download exactly once per successful request", async () => {
    await replayContract();
    const byFile = (await env.STATS.prepare("SELECT key, count FROM counters WHERE kind = 'download_file' ORDER BY key").all()).results;
    expect(byFile).toEqual([
      { key: "GravityPort-Web-Capture-0.15.41.zip", count: 1 },
      { key: "GravityPort-darwin-arm64-0.3.7.zip", count: 2 },
      { key: "GravityPort-win32-x64-0.3.7.exe", count: 1 },
      { key: "MOSA-darwin-arm64-0.3.0-rc.1.zip", count: 1 },
      { key: "notes.txt", count: 1 },
    ]);
    const byRef = (await env.STATS.prepare("SELECT key, count FROM counters WHERE kind = 'download_ref' ORDER BY key").all()).results;
    expect(byRef).toEqual([
      { key: "bilibili", count: 1 },
      { key: "direct", count: 4 },
      { key: "xiaohongshu", count: 1 },
    ]);
  });
});
