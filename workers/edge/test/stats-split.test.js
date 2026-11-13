// Stats output: installer / extension downloads are separate (399).
import { describe, expect, it } from "vitest";
import { buildStats } from "../src/stats.js";
import { analyticsDayKey } from "../src/util.js";
import { env, resetStats } from "./helpers.js";

async function put(day, kind, key, count) {
  await env.STATS.prepare("INSERT INTO counters (day, kind, key, count) VALUES (?, ?, ?, ?)").bind(day, kind, key, count).run();
}

describe("buildStats download split", () => {
  it("separates installer, extension and update downloads per day", async () => {
    await resetStats();
    const now = Date.now();
    const day = analyticsDayKey(now);
    await put(day, "download_file", "GravityPort-darwin-arm64-0.3.7.dmg", 2);
    await put(day, "download_file", "GravityPort-Web-Capture-0.15.41.zip", 1);
    await put(day, "download_file", "GravityPort-darwin-arm64-0.3.7.zip", 1);
    const report = await buildStats(env.STATS, now);
    const today = report.daily.find((row) => row.date === day);
    expect(today.desktopDownloads).toBe(2);
    expect(today.extensionDownloads).toBe(1);
    expect(today.downloadRequests).toBe(2);
    expect(today.suspectDownloads).toBe(false);
    expect(report.extensionDownloads30d).toBe(1);
  });

  it("flags a day when one installer file reaches 50 downloads", async () => {
    await resetStats();
    const now = Date.now();
    const day = analyticsDayKey(now);
    await put(day, "download_file", "GravityPort-win32-x64-0.3.7.exe", 50);
    const report = await buildStats(env.STATS, now);
    expect(report.daily.find((row) => row.date === day).suspectDownloads).toBe(true);
  });

  it("builds the source table from page_ref and download_ref", async () => {
    await resetStats();
    const now = Date.now();
    const day = analyticsDayKey(now);
    await put(day, "page_ref", "mcp", 10);
    await put(day, "page_ref", "none", 30);
    await put(day, "download_ref", "mcp", 2);
    const report = await buildStats(env.STATS, now);
    expect(report.sourceStats).toEqual([
      { source: "none", visits: 30, downloads: 0, rate: 0 },
      { source: "mcp", visits: 10, downloads: 2, rate: 0.2 },
    ]);
  });
});
