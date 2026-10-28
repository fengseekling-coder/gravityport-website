// Applied once per test file by the vitest pool, so every test starts with
// the migrated schema. The migrations arrive as a JSON-serialized
// {name, queries[]} array because plain bindings cannot carry objects.
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.FEEDBACK, JSON.parse(env.TEST_MIGRATIONS));
