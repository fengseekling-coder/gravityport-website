// Daily maintenance: 90-day install folding and 32-day daily_active pruning.
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { analyticsDayKey, recentDayKeys, DAY_MS } from "../src/util.js";
import { buildStats } from "../src/stats.js";
import { counterRows, counterTotal, env, makeCtx, resetStats } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

async function insertInstall(id, lastSeenMs, platform, firstLaunch) {
  await env.STATS.prepare(
    "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) VALUES (?, ?, ?, ?, 'x64', '0.3.0', ?)"
  )
    .bind(id, lastSeenMs - 5 * DAY, lastSeenMs, platform, firstLaunch ? 1 : 0)
    .run();
}

async function insertDailyActive(day, installId, firstLaunch = 0) {
  await env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, ?, ?)").bind(day, installId, firstLaunch).run();
}

async function installRows() {
  return (await env.STATS.prepare("SELECT install_id FROM installs").all()).results.map((row) => row.install_id).sort();
}

async function dailyDays() {
  return (await env.STATS.prepare("SELECT DISTINCT day FROM daily_active").all()).results.map((row) => row.day).sort();
}

describe("scheduled maintenance", () => {
  it("folds installs not seen for more than 90 days into cumulative counters and keeps totals stable", async () => {
    await resetStats();
    const now = Date.now();
    // Pre-existing folded totals.
    await env.STATS.prepare("INSERT INTO counters (day, kind, key, count) VALUES ('pre-edge', 'install_total', 'all', 5)").run();
    await env.STATS.prepare("INSERT INTO counters (day, kind, key, count) VALUES ('pre-edge', 'install_first_launch', 'all', 5)").run();

    await insertInstall("old-91d", now - 91 * DAY, "windows", 1);
    await insertInstall("kept-89d", now - 89 * DAY, "macos", 0);
    await insertInstall("kept-10d", now - 10 * DAY, "macos", 0);
    const before = await buildStats(env.STATS, now);
    expect(before.knownInstallationInstances).toBe(8);
    expect(before.reportedFirstLaunches).toBe(6);

    const { ctx } = makeCtx();
    await worker.scheduled({ scheduledTime: now, cron: "17 11 * * *" }, env, ctx);

    expect(await installRows()).toEqual(["kept-10d", "kept-89d"]);
    // The seeded pre-edge row and today's folded row are separate days.
    expect(await counterTotal(env.STATS, "install_total")).toBe(6);
    expect((await counterRows(env.STATS, "install_platform")).map((row) => `${row.key}:${row.count}`)).toEqual(["windows:1"]);
    expect(await counterTotal(env.STATS, "install_first_launch")).toBe(6);

    const after = await buildStats(env.STATS, now);
    expect(after.knownInstallationInstances).toBe(8);
    expect(after.reportedFirstLaunches).toBe(6);
    expect(after.platformInstalls).toEqual({ macos: 2, windows: 1 });
  });

  it("keeps the 32 most recent analytics days of daily_active", async () => {
    await resetStats();
    const now = Date.now();
    await insertDailyActive(analyticsDayKey(now), "a-today");
    await insertDailyActive(analyticsDayKey(now - 10 * DAY), "a-10d");
    await insertDailyActive(analyticsDayKey(now - 31 * DAY), "a-31d");
    await insertDailyActive(analyticsDayKey(now - 32 * DAY), "a-32d");
    await insertDailyActive(analyticsDayKey(now - 60 * DAY), "a-60d");

    const { ctx } = makeCtx();
    await worker.scheduled({ scheduledTime: now, cron: "17 11 * * *" }, env, ctx);

    expect(await dailyDays()).toEqual(
      [analyticsDayKey(now), analyticsDayKey(now - 10 * DAY), analyticsDayKey(now - 31 * DAY)].sort()
    );
    // 32 retained days: today plus the 31 previous calendar days.
    expect(recentDayKeys(now, 32).length).toBe(32);
  });

  it("daily_active entries older than the trend window no longer count toward 30d activity", async () => {
    await resetStats();
    const now = Date.now();
    await insertDailyActive(analyticsDayKey(now - 40 * DAY), "old-but-active");
    await insertInstall("old-40d", now - 40 * DAY, "macos", 0);
    const { ctx } = makeCtx();
    await worker.scheduled({ scheduledTime: now, cron: "17 11 * * *" }, env, ctx);
    const stats = await buildStats(env.STATS, now);
    expect(stats.knownInstallationInstances).toBe(1);
    expect(stats.activeInstalls30d).toBe(0);
  });

  it("the daily trend ends today and counts today's activity", async () => {
    await resetStats();
    const now = Date.now();
    await insertDailyActive(analyticsDayKey(now), "today-user");
    const stats = await buildStats(env.STATS, now);
    expect(stats.dailyActiveInstalls).toBe(1);
    expect(stats.activeInstalls7d).toBe(1);
    expect(stats.activeInstalls30d).toBe(1);
    expect(stats.daily.length).toBe(30);
    expect(stats.daily[stats.daily.length - 1].date).toBe(analyticsDayKey(now));
    expect(stats.daily[stats.daily.length - 1].activeInstalls).toBe(1);
  });
});
