import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { resetStats } from "./helpers.js";

// Run the real migration file (as the pool read it from migrations/), not a
// copy of its SQL, so an edit to the file is what the test sees.
const MIGRATION_0002 = JSON.parse(env.TEST_MIGRATIONS).find((m) => m.name.startsWith("0002_"));
const MIGRATION_0002_STATEMENTS = MIGRATION_0002.queries;

async function run0002() {
  for (const sql of MIGRATION_0002_STATEMENTS) {
    await env.STATS.prepare(sql).run();
  }
}

describe("0002_install_versions migration", () => {
  it("backfills existing installs with NULL first_seen_at and NULL from_version, and is idempotent", async () => {
    await resetStats();

    // Drop table to simulate running migration 0002 on an existing 0001 database with install rows
    await env.STATS.prepare("DROP TABLE IF EXISTS install_versions").run();

    // Insert pre-existing installs
    await env.STATS.prepare(
      "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) VALUES " +
        "('11111111-1111-4111-8111-111111111111', 1000, 2000, 'macos', 'arm64', '0.3.8', 1), " +
        "('22222222-2222-4222-8222-222222222222', 1500, 2500, 'windows', 'x64', '0.3.7', 0)"
    ).run();

    // Run migration 0002
    await run0002();

    const rows = (await env.STATS.prepare("SELECT * FROM install_versions ORDER BY install_id").all()).results;
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({
      install_id: "11111111-1111-4111-8111-111111111111",
      version: "0.3.8",
      first_seen_at: null,
      from_version: null,
    });
    expect(rows[1]).toEqual({
      install_id: "22222222-2222-4222-8222-222222222222",
      version: "0.3.7",
      first_seen_at: null,
      from_version: null,
    });

    // Run again to verify idempotency (does not error, does not alter existing data)
    await expect(run0002()).resolves.not.toThrow();

    const rowsAfterRerun = (await env.STATS.prepare("SELECT * FROM install_versions ORDER BY install_id").all()).results;
    expect(rowsAfterRerun).toEqual(rows);
  });
});
