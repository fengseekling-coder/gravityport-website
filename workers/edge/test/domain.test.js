// Domain dispatch: main domain rules, legacy domain rules, https-only, and
// the no-3xx guarantee for every address an App may use (from the 279
// "现有地址全表"). Storage resets between tests, so every case seeds its own
// R2 objects.
import { describe, expect, it } from "vitest";
import { env, fetchWorker } from "./helpers.js";

const GP = "https://gravityport.azhuilab.com";
const MOSA = "https://mosa.azhuilab.com";

const MANIFEST_BODY = '{"version":"0.3.0-rc.1"}';
const PACKAGE_BODY = "PK";

const APP_ADDRESSES = [
  "/releases/latest.json",
  "/releases/gravityport/latest.json",
  "/downloads/GravityPort-darwin-arm64-0.3.7.zip",
  "/downloads/GravityPort-win32-x64-0.3.7.zip",
  "/downloads/GravityPort-darwin-arm64-0.3.7.dmg",
  "/downloads/GravityPort-win32-x64-0.3.7.exe",
  "/downloads/GravityPort-Web-Capture-0.15.41.zip",
];

async function seedReleases() {
  await env.RELEASES.put("releases/latest.json", MANIFEST_BODY);
  await env.RELEASES.put("releases/gravityport/latest.json", '{"version":"0.3.7"}');
  for (const path of APP_ADDRESSES.slice(2)) {
    await env.RELEASES.put(path.slice(1), PACKAGE_BODY);
  }
}

describe("domain dispatch", () => {
  it("redirects plain http to https on both domains, preserving path and query", async () => {
    for (const url of [
      "http://gravityport.azhuilab.com/releases/latest.json?install_id=x",
      "http://mosa.azhuilab.com/downloads/a.zip",
      "http://mosa.azhuilab.com/",
    ]) {
      const response = await fetchWorker(url);
      expect(response.status, url).toBe(301);
      const location = response.headers.get("location");
      expect(location.startsWith("https://")).toBe(true);
      expect(location).toBe(url.replace("http://", "https://"));
    }
  });

  it("main domain serves manifests and downloads and 404s everything else", async () => {
    await seedReleases();
    expect((await fetchWorker(`${GP}/releases/latest.json`)).status).toBe(200);
    expect((await fetchWorker(`${GP}/releases/gravityport/latest.json`)).status).toBe(200);
    expect((await fetchWorker(`${GP}/downloads/GravityPort-darwin-arm64-0.3.7.zip`)).status).toBe(200);
    expect((await fetchWorker(`${GP}/`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/en/`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/whatever`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/admin`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/admin/stats.json`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/api/feedback`)).status).toBe(404);
    expect((await fetchWorker(`${GP}/api/pinterest/token`)).status).toBe(404);
  });

  it("legacy domain serves manifests and downloads in place", async () => {
    await seedReleases();
    const manifest = await fetchWorker(`${MOSA}/releases/latest.json`);
    expect(manifest.status).toBe(200);
    expect(await manifest.text()).toBe(MANIFEST_BODY);
    expect((await fetchWorker(`${MOSA}/downloads/GravityPort-darwin-arm64-0.3.7.zip`)).status).toBe(200);
  });

  it("legacy domain returns domain-changed.html with 200 for other paths", async () => {
    for (const path of ["/", "/privacy/", "/guide/", "/whatever"]) {
      const response = await fetchWorker(`${MOSA}${path}`);
      expect(response.status, path).toBe(200);
      const body = await response.text();
      expect(body).toContain("官网地址已更新");
      // domain-changed.html keeps its own CSP (Headers cannot carry duplicates,
      // so a single get() proves there is exactly one) plus the nginx
      // cache/noindex headers, and the other four security headers.
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      );
      expect(response.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, follow");
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), browsing-topics=()");
    }
  });

  it("legacy domain rejects /admin and /api without the edge worker answering them", async () => {
    expect((await fetchWorker(`${MOSA}/admin`)).status).toBe(403);
    expect((await fetchWorker(`${MOSA}/admin/stats.json`)).status).toBe(403);
    expect((await fetchWorker(`${MOSA}/api/feedback`)).status).toBe(404);
  });

  it("neither domain ever redirects an App address", async () => {
    await seedReleases();
    for (const host of [GP, MOSA]) {
      for (const path of APP_ADDRESSES) {
        for (const method of ["GET", "HEAD"]) {
          const response = await fetchWorker(`${host}${path}`, { method });
          expect(response.status, `${method} ${host}${path}`).toBe(200);
          expect(response.status >= 300 && response.status < 400, `${method} ${host}${path}`).toBe(false);
        }
      }
    }
  });

  it("packages download identically from both domains", async () => {
    await seedReleases();
    const fromMain = await (await fetchWorker(`${GP}/downloads/GravityPort-darwin-arm64-0.3.7.zip`)).arrayBuffer();
    const fromLegacy = await (await fetchWorker(`${MOSA}/downloads/GravityPort-darwin-arm64-0.3.7.zip`)).arrayBuffer();
    expect(new Uint8Array(fromMain)).toEqual(new Uint8Array(fromLegacy));
  });
});
