import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The D1 migrations travel as a JSON-serialized {name, queries[]} array (the
// D1Migration[] shape applyD1Migrations takes) because plain bindings cannot
// carry objects; the setup file replays them once per test file.
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.join(import.meta.dirname, "wrangler.toml") },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: JSON.stringify(migrations),
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-d1-migrations.js"],
  },
});
