// Stats definitions (task 317): the download kind split, the home→download
// rate, the full-accumulation window of the site rows, and the rank-list
// "其他" collapse used by the admin page.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { buildStats, compareSemver } from "../src/stats.js";
import { classifyDownload } from "../src/counters.js";
import { analyticsDayKey, recentDayKeys, DAY_MS } from "../src/util.js";
import { resetStats } from "./helpers.js";
import { rankRowsWithOther } from "../../../admin/rank.js";

/**
 * Add one row to the per-day counters table.
 * @param {string} day Analytics day key.
 * @param {string} kind Counter kind.
 * @param {string} key Counter key.
 * @param {number} count
 */
async function seedCounter(day, kind, key, count) {
  await env.STATS.prepare(
    "INSERT INTO counters (day, kind, key, count) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + ?"
  ).bind(day, kind, key, count, count).run();
}

/**
 * Seed one page view with the exact row set the Pages middleware writes.
 * @param {string} day Analytics day key.
 * @param {{path: string, referrer: string, country: string, device: string}} view
 */
async function seedPageView(day, { path, referrer, country, device }) {
  await env.STATS.batch(
    [["page_path", path], ["page_referrer", referrer], ["page_country", country], ["page_device", device]].map(([kind, key]) =>
      env.STATS.prepare(
        "INSERT INTO counters (day, kind, key, count) VALUES (?, ?, ?, 1) " +
          "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + 1"
      ).bind(day, kind, key)
    )
  );
}

describe("classifyDownload", () => {
  it("sorts installers, in-app update zips, extension packages and everything else", () => {
    expect(classifyDownload("GravityPort-darwin-arm64-0.3.7.dmg")).toBe("desktop");
    expect(classifyDownload("GravityPort-win32-x64-0.3.7.exe")).toBe("desktop");
    expect(classifyDownload("MOSA-darwin-arm64-0.2.1.dmg")).toBe("desktop");
    expect(classifyDownload("MOSA-win32-x64-0.2.1.exe")).toBe("desktop");
    expect(classifyDownload("GravityPort-darwin-arm64-0.3.7.zip")).toBe("update");
    expect(classifyDownload("GravityPort-win32-x64-0.3.7.zip")).toBe("update");
    expect(classifyDownload("MOSA-darwin-arm64-0.3.0-rc.1.zip")).toBe("update");
    expect(classifyDownload("MOSA-win32-x64-0.2.2.zip")).toBe("update");
    expect(classifyDownload("GravityPort-Web-Capture-0.15.41.zip")).toBe("extension");
    expect(classifyDownload("MOSA-Web-Capture-0.14.0.zip")).toBe("extension");
    expect(classifyDownload("notes.txt")).toBe("other");
    expect(classifyDownload("something-else.exe")).toBe("other");
    expect(classifyDownload("GravityPort-darwin-arm64-0.3.7.tar.gz")).toBe("other");
  });
});

describe("buildStats download definitions", () => {
  it("splits desktop, update and extension totals and rates the site against desktop+extension only", async () => {
    await resetStats();
    const day = analyticsDayKey(Date.now());
    await seedCounter(day, "download_file", "GravityPort-darwin-arm64-1.0.0.dmg", 3);
    await seedCounter(day, "download_file", "GravityPort-win32-x64-1.0.0.exe", 2);
    await seedCounter(day, "download_file", "GravityPort-darwin-arm64-0.9.0.zip", 4);
    await seedCounter(day, "download_file", "GravityPort-win32-x64-0.9.0.zip", 1);
    await seedCounter(day, "download_file", "GravityPort-Web-Capture-0.15.41.zip", 2);
    await seedCounter(day, "download_file", "notes.txt", 1);
    await seedCounter(day, "page_path", "/", 6);
    await seedCounter(day, "page_path", "/en/", 4);

    const stats = await buildStats(env.STATS, Date.now());
    expect(stats.totalDesktopDownloadRequests).toBe(5);
    expect(stats.totalUpdateDownloadRequests).toBe(5);
    expect(stats.totalExtensionDownloadRequests).toBe(2);
    expect(stats.totalOtherDownloadRequests).toBe(1);
    expect(stats.totalDownloadRequests).toBe(13);
    expect(stats.updateDownloadsByFile["GravityPort-darwin-arm64-0.9.0.zip"]).toBe(4);
    expect(stats.desktopDownloadsByFile["GravityPort-darwin-arm64-1.0.0.dmg"]).toBe(3);
    // (5 desktop + 2 extension) / 10 home page views; update zips stay out.
    expect(stats.homeToDownloadRate).toBe(0.7);
  });
});

describe("buildStats site rows accumulate over the whole history", () => {
  it("keeps referrer/country/device sums equal to the page views, including days older than the trend window", async () => {
    await resetStats();
    const now = Date.now();
    const oldDay = analyticsDayKey(now - 40 * DAY_MS);
    const recentDay = analyticsDayKey(now);
    // Three views on a day more than 30 days back — the removed day filter
    // used to drop these from every site dimension.
    await seedPageView(oldDay, { path: "/", referrer: "google.com", country: "US", device: "desktop" });
    await seedPageView(oldDay, { path: "/guide/", referrer: "direct", country: "CN", device: "mobile" });
    await seedPageView(oldDay, { path: "/en/", referrer: "bilibili", country: "XX", device: "tablet" });
    await seedPageView(recentDay, { path: "/", referrer: "direct", country: "JP", device: "desktop" });
    await seedPageView(recentDay, { path: "/", referrer: "internal", country: "CN", device: "desktop" });

    const stats = await buildStats(env.STATS, now);
    const sum = (map) => Object.values(map || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    expect(stats.totalPageViews).toBe(5);
    expect(sum(stats.pageViewsByReferrer)).toBe(5);
    expect(sum(stats.pageViewsByCountry)).toBe(5);
    expect(sum(stats.pageViewsByDevice)).toBe(5);
    expect(stats.pageViewsByCountry.US).toBe(1);
    expect(stats.pageViewsByCountry.XX).toBe(1);
  });
});

describe("rankRowsWithOther", () => {
  it("collapses long lists to 11 rows plus one 其他 row that keeps the total", () => {
    const rows = Array.from({ length: 15 }, (_, index) => [`c${index}`, index + 1]);
    const visible = rankRowsWithOther(rows);
    expect(visible.length).toBe(12);
    expect(visible[10][0]).toBe("c10");
    expect(visible[11][0]).toBe("其他");
    const total = rows.reduce((sum, [, count]) => sum + count, 0);
    const visibleTotal = visible.reduce((sum, [, count]) => sum + count, 0);
    expect(visibleTotal).toBe(total);
    expect(visible[11][1]).toBe(12 + 13 + 14 + 15);
  });

  it("leaves lists of twelve or fewer rows untouched", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => [`c${index}`, 1]);
    expect(rankRowsWithOther(twelve)).toEqual(twelve);
    const eleven = Array.from({ length: 11 }, (_, index) => [`c${index}`, 1]);
    expect(rankRowsWithOther(eleven)).toEqual(eleven);
    expect(rankRowsWithOther([])).toEqual([]);
  });
});

describe("rollout statistics and semver sorting", () => {
  it("sorts semantic versions including -rc.N prerelease tags correctly", () => {
    const versions = ["0.3.0", "0.3.8-rc.1", "0.3.8", "0.3.9-rc.1", "0.3.9-rc.2", "0.3.9", "0.3.10"];
    const sorted = [...versions].sort((a, b) => compareSemver(b, a));
    expect(sorted).toEqual(["0.3.10", "0.3.9", "0.3.9-rc.2", "0.3.9-rc.1", "0.3.8", "0.3.8-rc.1", "0.3.0"]);
  });

  it("computes rollout field with top 5 versions and shareOfActive7d using 7d active installs as denominator", async () => {
    await resetStats();
    const now = Date.now();
    const dayKeys = recentDayKeys(now, 30);
    const today = dayKeys[dayKeys.length - 1];

    // Seed 6 versions across installs
    const installs = [
      { id: "11111111-0000-4000-8000-000000000000", version: "0.3.10", active: true },
      { id: "22222222-0000-4000-8000-000000000000", version: "0.3.9", active: true },
      { id: "33333333-0000-4000-8000-000000000000", version: "0.3.9", active: true },
      { id: "44444444-0000-4000-8000-000000000000", version: "0.3.9-rc.2", active: false },
      { id: "55555555-0000-4000-8000-000000000000", version: "0.3.9-rc.1", active: false },
      { id: "66666666-0000-4000-8000-000000000000", version: "0.3.8", active: true },
      { id: "77777777-0000-4000-8000-000000000000", version: "0.3.7", active: false },
    ];

    for (const inst of installs) {
      await env.STATS.prepare(
        "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) " +
          "VALUES (?, ?, ?, 'macos', 'arm64', ?, 0)"
      ).bind(inst.id, now - 100000, now, inst.version).run();

      if (inst.active) {
        await env.STATS.prepare("INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, ?, 0)")
          .bind(today, inst.id)
          .run();
      }
    }

    // Seed install_versions
    // For 0.3.9: install 2 had it at 5000, install 3 had it at NULL (pre-existing)
    // and install 1 also had 0.3.9 previously at 4000
    await env.STATS.batch([
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.10', 9000, '0.3.9')").bind(installs[0].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.9', 4000, '0.3.8')").bind(installs[0].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.9', 5000, '0.3.8')").bind(installs[1].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.9', NULL, NULL)").bind(installs[2].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.9-rc.2', 3000, NULL)").bind(installs[3].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.9-rc.1', 2000, NULL)").bind(installs[4].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.8', 1000, NULL)").bind(installs[5].id),
      env.STATS.prepare("INSERT INTO install_versions (install_id, version, first_seen_at, from_version) VALUES (?, '0.3.7', 500, NULL)").bind(installs[6].id),
    ]);

    const stats = await buildStats(env.STATS, now);
    expect(stats.activeInstalls7d).toBe(4); // installs 0, 1, 2, 5

    expect(Array.isArray(stats.rollout)).toBe(true);
    expect(stats.rollout.length).toBe(5); // top 5 only, 0.3.7 omitted

    // Check versions order
    expect(stats.rollout.map((r) => r.version)).toEqual(["0.3.10", "0.3.9", "0.3.9-rc.2", "0.3.9-rc.1", "0.3.8"]);

    // Check 0.3.9 details
    const r039 = stats.rollout.find((r) => r.version === "0.3.9");
    expect(r039.firstSeenAt).toBe(4000); // MIN non-NULL of (4000, 5000, NULL) is 4000
    expect(r039.currentInstalls).toBe(2); // installs 1 and 2 currently on 0.3.9
    expect(r039.everReached).toBe(3); // installs 0, 1, 2 ever had 0.3.9
    // Share of 7d active: installs 1 and 2 are active (2 of 4) -> 2 / 4 = 0.5
    expect(r039.shareOfActive7d).toBe(0.5);

    // Check 0.3.10 share: 1 of 4 -> 0.25
    const r0310 = stats.rollout.find((r) => r.version === "0.3.10");
    expect(r0310.shareOfActive7d).toBe(0.25);

    // Check 0.3.9-rc.2 share: 0 of 4 -> 0
    const r039rc2 = stats.rollout.find((r) => r.version === "0.3.9-rc.2");
    expect(r039rc2.shareOfActive7d).toBe(0);
  });
});
