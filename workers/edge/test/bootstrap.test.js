// Smoke test: the pool boots the real wrangler.toml (R2, D1 with migrations,
// assets) and the Worker answers a basic manifest request.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";

describe("pool bootstrap", () => {
  it("has the configured bindings", () => {
    expect(env.RELEASES).toBeTruthy();
    expect(env.STATS).toBeTruthy();
    expect(env.CONTRACT_FEED).toBeTruthy();
  });

  it("serves a manifest from R2 through the worker", async () => {
    await env.RELEASES.put("releases/latest.json", '{"ok":true}', { httpMetadata: { contentType: "application/json" } });
    const response = await worker.fetch(new Request("https://gravityport.azhuilab.com/releases/latest.json"), env, { waitUntil() {} });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });
});
