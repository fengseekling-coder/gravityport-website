// /releases/*: manifest bytes must round-trip exactly, HEAD carries no body,
// If-None-Match yields 304, and the security headers appear exactly once.
import { describe, expect, it } from "vitest";
import { env, fetchWorker } from "./helpers.js";

const BASE = "https://gravityport.azhuilab.com";
// Whitespace and formatting that JSON round-tripping would strip — the
// update signature is verified against the exact bytes.
const MANIFEST_BODY = '{\n  "version": "0.3.7",\n  "notes": {"zh-CN": "更新", "en": "Update"},\n  "signature": "  ",\n\n}\n';
const SECURITY_HEADERS = [
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "content-security-policy",
];

function expectSecurityHeadersOnce(headers) {
  // The Worker builds every Headers object itself, so a value can only appear
  // once; these asserts pin the exact values from the 285 header table.
  for (const name of SECURITY_HEADERS) {
    expect(headers.get(name), name).toBeTruthy();
  }
  expect(headers.get("strict-transport-security")).toBe("max-age=31536000");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), browsing-topics=()");
  expect(headers.get("content-security-policy")).toBe(
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
}

describe("manifest serving", () => {
  it("returns the exact stored bytes with manifest headers", async () => {
    await env.RELEASES.put("releases/latest.json", MANIFEST_BODY, { httpMetadata: { contentType: "text/plain" } });
    const response = await fetchWorker(`${BASE}/releases/latest.json`);
    expect(response.status).toBe(200);
    const body = await response.arrayBuffer();
    expect(new TextDecoder().decode(body)).toBe(MANIFEST_BODY);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("last-modified")).toBeTruthy();
    expect(Number(response.headers.get("content-length"))).toBe(new TextEncoder().encode(MANIFEST_BODY).length);
    expectSecurityHeadersOnce(response.headers);
  });

  it("serves nested history manifests and honors stored content types for non-json keys", async () => {
    await env.RELEASES.put("releases/history/2026-09-01.json", "{}");
    await env.RELEASES.put("releases/some.bin", "abc", { httpMetadata: { contentType: "application/x-thing" } });
    const history = await fetchWorker(`${BASE}/releases/history/2026-09-01.json`);
    expect(history.status).toBe(200);
    expect(history.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const bin = await fetchWorker(`${BASE}/releases/some.bin`);
    expect(bin.headers.get("content-type")).toBe("application/x-thing");
  });

  it("HEAD returns headers without a body", async () => {
    await env.RELEASES.put("releases/latest.json", MANIFEST_BODY);
    const response = await fetchWorker(`${BASE}/releases/latest.json`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
    expect(response.headers.get("content-length")).toBe(String(new TextEncoder().encode(MANIFEST_BODY).length));
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("If-None-Match returns 304 without a body", async () => {
    await env.RELEASES.put("releases/latest.json", MANIFEST_BODY);
    const first = await fetchWorker(`${BASE}/releases/latest.json`);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const matched = await fetchWorker(`${BASE}/releases/latest.json`, { headers: { "if-none-match": etag } });
    expect(matched.status).toBe(304);
    expect(await matched.arrayBuffer()).toEqual(new ArrayBuffer(0));
    expect(matched.headers.get("etag")).toBe(etag);

    const weak = await fetchWorker(`${BASE}/releases/latest.json`, { headers: { "if-none-match": `W/${etag}` } });
    expect(weak.status).toBe(304);

    const list = await fetchWorker(`${BASE}/releases/latest.json`, { headers: { "if-none-match": `"deadbeef", ${etag}` } });
    expect(list.status).toBe(304);

    const unmatched = await fetchWorker(`${BASE}/releases/latest.json`, { headers: { "if-none-match": '"deadbeef"' } });
    expect(unmatched.status).toBe(200);
  });

  it("returns 404 for missing objects and never lists directories", async () => {
    expect((await fetchWorker(`${BASE}/releases/missing.json`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/releases/`)).status).toBe(404);
  });

  it("rejects traversal and encoded separators", async () => {
    for (const path of [
      `${BASE}/releases/%2e%2e/secret`,
      `${BASE}/releases/a%2Fb.json`,
      `${BASE}/releases/a%5Cb.json`,
      `${BASE}/releases/..json`,
      `${BASE}/releases/%ff%fe.json`,
    ]) {
      const response = await fetchWorker(path);
      expect(response.status, path).toBe(404);
    }
  });

  it("accepts only GET and HEAD", async () => {
    await env.RELEASES.put("releases/latest.json", "{}");
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const response = await fetchWorker(`${BASE}/releases/latest.json`, { method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
    expect((await fetchWorker(`${BASE}/releases/latest.json`, { method: "HEAD" })).status).toBe(200);
  });
});
