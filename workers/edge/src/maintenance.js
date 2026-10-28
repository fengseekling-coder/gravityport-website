// Daily maintenance (cron 17 11 * * *): installations not seen for more than
// 90 days are folded into cumulative counters and then deleted, so the
// known-installation and first-launch totals survive while the per-install
// rows (which carry no retention promise) do not. daily_active rows older
// than 32 days are deleted (the trend window is 30 days). counters stay.

import { analyticsDayKey, recentDayKeys, DAY_MS } from "./util.js";
import { counterUpsert } from "./counters.js";

/** @const {number} */
export const INSTALL_RETENTION_DAYS = 90;

/** @const {number} */
export const DAILY_ACTIVE_RETENTION_DAYS = 32;

/**
 * @param {{prepare: StatsDb["prepare"], batch: StatsDb["batch"]}} env STATS binding.
 * @param {number} [nowMs] Epoch milliseconds; defaults to the current time.
 * @returns {Promise<void>}
 */
export async function runMaintenance(env, nowMs = Date.now()) {
  const cutoff = nowMs - INSTALL_RETENTION_DAYS * DAY_MS;
  const expired = await env.prepare(
    "SELECT platform, first_launch FROM installs WHERE last_seen_at < ?"
  ).bind(cutoff).all();
  const rows = expired.results || [];
  if (rows.length) {
    const day = analyticsDayKey(nowMs);
    const byPlatform = new Map();
    let firstLaunches = 0;
    for (const row of rows) {
      const platform = row.platform || "unknown";
      byPlatform.set(platform, (byPlatform.get(platform) || 0) + 1);
      if (Number(row.first_launch)) firstLaunches += 1;
    }
    const statements = [counterUpsert(env, day, "install_total", "all", rows.length)];
    for (const [platform, count] of byPlatform) statements.push(counterUpsert(env, day, "install_platform", platform, count));
    if (firstLaunches) statements.push(counterUpsert(env, day, "install_first_launch", "all", firstLaunches));
    statements.push(env.prepare("DELETE FROM installs WHERE last_seen_at < ?").bind(cutoff));
    await env.batch(statements);
  }

  const dailyCutoff = recentDayKeys(nowMs, DAILY_ACTIVE_RETENTION_DAYS)[0];
  await env.prepare("DELETE FROM daily_active WHERE day < ?").bind(dailyCutoff).run();
}
