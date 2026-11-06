// Telemetry recording: parameter validation, both feed paths, v1 legacy
// handling, and the Los Angeles analytics-day boundaries.
import { describe, expect, it } from "vitest";
import { brokenStats, env, fetchWorker, resetStats, testEnv } from "./helpers.js";
import { analyticsDayKey } from "../src/util.js";

const BASE = "https://gravityport.azhuilab.com";
const ID = "123e4567-e89b-42d3-a456-426614174000";

function telemetryUrl(path, params) {
  const query = new URLSearchParams(params);
  return `${BASE}${path}?${query}`;
}

const VALID = {
  event: "daily_active",
  telemetry_version: "2",
  install_id: ID,
  platform: "macos",
  arch: "arm64",
  version: "0.3.7",
};

async function installRows() {
  return (await env.STATS.prepare("SELECT * FROM installs").all()).results;
}

async function dailyRows() {
  return (await env.STATS.prepare("SELECT * FROM daily_active").all()).results;
}

async function installVersionRows() {
  return (await env.STATS.prepare("SELECT * FROM install_versions ORDER BY install_id, version").all()).results;
}

describe("telemetry", () => {
  it("records valid HEAD and GET reports on both feed paths", async () => {
    await resetStats();
    await env.RELEASES.put("releases/latest.json", "{}");
    await env.RELEASES.put("releases/gravityport/latest.json", "{}");
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, event: "first_launch" }), { method: "HEAD" });
    await fetchWorker(telemetryUrl("/releases/gravityport/latest.json", VALID), { method: "GET" });
    const installs = await installRows();
    expect(installs.length).toBe(1);
    expect(installs[0].install_id).toBe(ID);
    expect(installs[0].first_launch).toBe(1);
    const daily = await dailyRows();
    expect(daily.length).toBe(1);
    // The day had a first_launch report, so the sticky flag is set even
    // though the last report of the day was a daily_active event.
    expect(daily[0].first_launch).toBe(1);
  });

  it("does not record invalid parameters", async () => {
    await resetStats();
    await env.RELEASES.put("releases/latest.json", "{}");
    const cases = [
      { install_id: "not-a-uuid" },
      { install_id: "123e4567-e89b-12d3-a456-426614174000" }, // not version 4
      { event: "page_view" },
      { platform: "linux" },
      { arch: "x".repeat(25) },
      { arch: "bad arch" },
      { version: "1.2.3.4" },
      { version: "latest" },
      { install_id: "" },
    ];
    for (const override of cases) {
      await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, ...override }), { method: "HEAD" });
    }
    expect((await installRows()).length).toBe(0);
    expect((await dailyRows()).length).toBe(0);
  });

  it("records v1 telemetry as installations but not in the daily sets", async () => {
    await resetStats();
    await env.RELEASES.put("releases/latest.json", "{}");
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, event: "first_launch", telemetry_version: "1" }), { method: "HEAD" });
    const installs = await installRows();
    expect(installs.length).toBe(1);
    expect(installs[0].first_launch).toBe(1);
    expect((await dailyRows()).length).toBe(0);
  });

  it("keeps the earliest first_seen_at and follows the latest platform/arch/version", async () => {
    await resetStats();
    await env.RELEASES.put("releases/gravityport/latest.json", "{}");
    await fetchWorker(telemetryUrl("/releases/gravityport/latest.json", { ...VALID, version: "0.3.6" }), { method: "GET" });
    const first = (await installRows())[0];
    await fetchWorker(telemetryUrl("/releases/gravityport/latest.json", { ...VALID, platform: "windows", arch: "x86_64", version: "0.3.7" }), { method: "GET" });
    const second = (await installRows())[0];
    expect(second.first_seen_at).toBe(first.first_seen_at);
    expect(second.last_seen_at).toBeGreaterThanOrEqual(first.last_seen_at);
    expect(second.platform).toBe("windows");
    expect(second.arch).toBe("x86_64");
    expect(second.version).toBe("0.3.7");
  });

  it("a later first_launch event marks the day", async () => {
    await resetStats();
    await env.RELEASES.put("releases/latest.json", "{}");
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, event: "daily_active" }), { method: "GET" });
    expect(((await dailyRows())[0]).first_launch).toBe(0);
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, event: "first_launch" }), { method: "GET" });
    expect(((await dailyRows())[0]).first_launch).toBe(1);
  });

  it("a 304 manifest response does not record telemetry", async () => {
    await resetStats();
    const object = await env.RELEASES.put("releases/latest.json", "{}");
    const etag = object.httpEtag;
    await fetchWorker(telemetryUrl("/releases/latest.json", VALID), { headers: { "if-none-match": etag } });
    expect((await installRows()).length).toBe(0);
  });

  it("records install_versions: new install, repeat, upgrade, downgrade, unknown version", async () => {
    await resetStats();
    await env.RELEASES.put("releases/latest.json", '{"version":"0.3.9"}');

    // 1. New install: from_version is null
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, version: "0.3.8" }), { method: "GET" });
    let versions = await installVersionRows();
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe("0.3.8");
    expect(versions[0].from_version).toBeNull();
    expect(typeof versions[0].first_seen_at).toBe("number");
    const v038FirstSeen = versions[0].first_seen_at;

    // 2. Repeat report of the same version: no new row, first_seen_at unchanged
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, version: "0.3.8" }), { method: "GET" });
    versions = await installVersionRows();
    expect(versions.length).toBe(1);
    expect(versions[0].first_seen_at).toBe(v038FirstSeen);

    // 3. Upgrade 0.3.8 -> 0.3.9: new row with from_version = 0.3.8
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, version: "0.3.9" }), { method: "GET" });
    versions = await installVersionRows();
    expect(versions.length).toBe(2);
    const v039Row = versions.find((r) => r.version === "0.3.9");
    expect(v039Row).toBeDefined();
    expect(v039Row.from_version).toBe("0.3.8");
    expect(typeof v039Row.first_seen_at).toBe("number");

    // 4. Downgrade back to 0.3.8: no new row in install_versions, installs.version reverts to 0.3.8
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, version: "0.3.8" }), { method: "GET" });
    versions = await installVersionRows();
    expect(versions.length).toBe(2);
    const installs = await installRows();
    expect(installs[0].version).toBe("0.3.8");

    // 5. unknown version is not written to install_versions
    // Telemetry validation rejects version: "unknown" upfront, and recordTelemetry skips unknown version
    await fetchWorker(telemetryUrl("/releases/latest.json", { ...VALID, version: "unknown" }), { method: "GET" });
    versions = await installVersionRows();
    expect(versions.length).toBe(2);
    expect(versions.some((r) => r.version === "unknown")).toBe(false);
  });

  it("manifest response bytes and status stay identical when writing install_versions fails", async () => {
    await resetStats();
    const manifestContent = '{"version":"0.3.9","assets":["app.zip"]}';
    await env.RELEASES.put("releases/latest.json", manifestContent);

    // Drop install_versions so that inserting into it throws an error in the batch
    await env.STATS.prepare("DROP TABLE IF EXISTS install_versions").run();

    const response = await fetchWorker(telemetryUrl("/releases/latest.json", VALID), { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(manifestContent);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");

    // Restore table for subsequent tests
    await env.STATS.prepare(
      "CREATE TABLE IF NOT EXISTS install_versions (" +
        "install_id TEXT NOT NULL, version TEXT NOT NULL, first_seen_at INTEGER, from_version TEXT, " +
        "PRIMARY KEY (install_id, version))"
    ).run();
  });

  it("never returns a 3xx for the update feed addresses", async () => {
    await env.RELEASES.put("releases/latest.json", "{}");
    await env.RELEASES.put("releases/gravityport/latest.json", "{}");
    for (const host of ["gravityport.azhuilab.com", "mosa.azhuilab.com"]) {
      for (const path of ["/releases/latest.json", "/releases/gravityport/latest.json"]) {
        const response = await fetchWorker(`https://${host}${path}?${new URLSearchParams(VALID)}`, { method: "HEAD" });
        expect(response.status, `${host}${path}`).toBe(200);
        expect(response.status >= 300 && response.status < 400).toBe(false);
      }
    }
  });
});

describe("broken STATS binding", () => {
  it("still serves the manifest when recording throws", async () => {
    await env.RELEASES.put("releases/latest.json", '{"ok":1}');
    const envOverride = testEnv({ STATS: brokenStats() });
    const response = await fetchWorker(`${BASE}/releases/latest.json?${new URLSearchParams(VALID)}`, { method: "GET" }, envOverride);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":1}');
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

describe("analytics day keys", () => {
  it("rolls over at Los Angeles midnight, including the UTC 07:59/08:00 winter boundary", () => {
    // PST (UTC-8): LA midnight is 08:00 UTC.
    expect(analyticsDayKey(Date.parse("2026-12-01T07:59:59Z"))).toBe("2026-11-30");
    expect(analyticsDayKey(Date.parse("2026-12-01T08:00:00Z"))).toBe("2026-12-01");
  });

  it("rolls over at 07:00 UTC in summer (PDT)", () => {
    expect(analyticsDayKey(Date.parse("2026-07-01T06:59:59Z"))).toBe("2026-06-30");
    expect(analyticsDayKey(Date.parse("2026-07-01T07:00:00Z"))).toBe("2026-07-01");
  });

  it("handles the DST spring-forward day", () => {
    // 2026-03-08 is the US DST transition; both sides of the day must land on
    // the same analytics date as local midnight would.
    expect(analyticsDayKey(Date.parse("2026-03-08T09:59:59Z"))).toBe("2026-03-08");
    expect(analyticsDayKey(Date.parse("2026-03-08T10:00:00Z"))).toBe("2026-03-08");
  });
});
