import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { prepareContractBindings } from "./test/contract-setup.mjs";

// The contract test compares the Worker's D1 numbers against the real
// scripts/report-usage.mjs, which is a Node CLI. Its expected output and the
// generated import SQL are computed once here (plain Node, with fs) and
// handed to the tests as plain bindings. The D1 migrations travel the same
// way: readD1Migrations returns JSON-serializable {name, queries[]} entries
// that the setup file replays through applyD1Migrations.
const contract = await prepareContractBindings();
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(import.meta.dirname, "wrangler.toml") },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: JSON.stringify(migrations),
          CONTRACT_FEED: JSON.stringify(contract.feed),
          CONTRACT_IMPORT: JSON.stringify(contract.importCase),
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.js"],
  },
});
