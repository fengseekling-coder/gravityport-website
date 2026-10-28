// /downloads/*: streaming with Range support, content types, counting rules.
import { describe, expect, it } from "vitest";
import { counterRows, counterTotal, env, fetchWorker, resetStats } from "./helpers.js";

const BASE = "https://gravityport.azhuilab.com";
const ZIP_BODY = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ"; // 100 bytes
const DMG_BODY = "D".repeat(50);
const EXE_BODY = "E".repeat(30);
const TXT_BODY = "hello";

async function seed() {
  await resetStats();
  await env.RELEASES.put("downloads/GravityPort-darwin-arm64-0.3.7.zip", ZIP_BODY);
  await env.RELEASES.put("downloads/GravityPort-darwin-arm64-0.3.7.dmg", DMG_BODY);
  await env.RELEASES.put("downloads/GravityPort-win32-x64-0.3.7.exe", EXE_BODY);
  await env.RELEASES.put("downloads/GravityPort-Web-Capture-0.15.41.zip", ZIP_BODY);
  await env.RELEASES.put("downloads/notes.txt", TXT_BODY);
}

async function expectCount(kind, key, expected) {
  expect(await counterTotal(env.STATS, kind, key), `${kind}/${key}`).toBe(expected);
}

const text = (buffer) => new TextDecoder().decode(buffer);

/**
 * Assert a response body equals a string byte-for-byte (avoids the runtime
 * warning about decoding binary content types as text).
 * @param {Response} response
 * @param {string} expected
 */
async function expectBody(response, expected) {
  expect(text(await response.arrayBuffer())).toBe(expected);
}

describe("download serving", () => {
  it("serves 200 with nginx-shaped headers and exact bytes", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip?ref=bilibili`);
    expect(response.status).toBe(200);
    await expectBody(response, ZIP_BODY);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, must-revalidate");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe(String(ZIP_BODY.length));
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("maps content types by extension", async () => {
    await seed();
    expect((await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.dmg`)).headers.get("content-type")).toBe("application/x-apple-diskimage");
    expect((await fetchWorker(`${BASE}/downloads/GravityPort-win32-x64-0.3.7.exe`)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await fetchWorker(`${BASE}/downloads/notes.txt`)).headers.get("content-type")).toBe("application/octet-stream");
  });

  it("supports a single Range request", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range: "bytes=10-19" } });
    expect(response.status).toBe(206);
    await expectBody(response, ZIP_BODY.slice(10, 20));
    expect(response.headers.get("content-range")).toBe(`bytes 10-19/${ZIP_BODY.length}`);
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("supports the suffix range form", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range: "bytes=-7" } });
    expect(response.status).toBe(206);
    await expectBody(response, ZIP_BODY.slice(-7));
    expect(response.headers.get("content-range")).toBe(`bytes ${ZIP_BODY.length - 7}-${ZIP_BODY.length - 1}/${ZIP_BODY.length}`);
  });

  it("a suffix longer than the object serves the whole object", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range: "bytes=-99999" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-${ZIP_BODY.length - 1}/${ZIP_BODY.length}`);
  });

  it("returns 416 for unsatisfiable ranges", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range: "bytes=99999-" } });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${ZIP_BODY.length}`);
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  it("ignores malformed, multi-range and invalid-spec Range headers", async () => {
    await seed();
    for (const range of ["bytes=19-10", "bytes=0-1,3-4", "items=0-5", "bytes=", "bytes=abc", ""]) {
      const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range } });
      expect(response.status, range).toBe(200);
      await expectBody(response, ZIP_BODY);
    }
  });

  it("HEAD returns headers only and never counts", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.arrayBuffer()).toEqual(new ArrayBuffer(0));
    expect(response.headers.get("content-length")).toBe(String(ZIP_BODY.length));
    expect(response.headers.get("content-disposition")).toBe("attachment");
    expect((await counterRows(env.STATS, "download_file")).length).toBe(0);
    expect((await counterRows(env.STATS, "download_ref")).length).toBe(0);
  });

  it("counts successful GET and Range requests by file, ref and day; failures are not counted", async () => {
    await seed();
    await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip?ref=bilibili`);
    await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { range: "bytes=0-9" } });
    await fetchWorker(`${BASE}/downloads/GravityPort-win32-x64-0.3.7.exe?ref=`);
    await fetchWorker(`${BASE}/downloads/GravityPort-Web-Capture-0.15.41.zip?ref=xiaohongshu`);
    await fetchWorker(`${BASE}/downloads/missing-file.zip`);
    expect(await counterTotal(env.STATS, "download_file", "GravityPort-darwin-arm64-0.3.7.zip")).toBe(2);
    expect(await counterTotal(env.STATS, "download_file", "GravityPort-win32-x64-0.3.7.exe")).toBe(1);
    expect(await counterTotal(env.STATS, "download_file", "GravityPort-Web-Capture-0.15.41.zip")).toBe(1);
    expect(await counterTotal(env.STATS, "download_ref", "bilibili")).toBe(1);
    expect(await counterTotal(env.STATS, "download_ref", "direct")).toBe(2);
    expect(await counterTotal(env.STATS, "download_ref", "xiaohongshu")).toBe(1);
    const rows = await counterRows(env.STATS, "download_file");
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day))).toBe(true);
  });

  it("returns 404 for missing objects and helper/visual packs", async () => {
    await seed();
    expect((await fetchWorker(`${BASE}/downloads/missing.zip`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/downloads/helper-packs/c2patool/x.zip`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/downloads/visual-packs/v1.zip`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/downloads/`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/downloads/traversal/%2e%2e/x`)).status).toBe(404);
  });

  it("accepts only GET and HEAD", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("If-None-Match returns 304 without counting", async () => {
    await seed();
    const first = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`);
    const etag = first.headers.get("etag");
    const second = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(await counterTotal(env.STATS, "download_file")).toBe(1);
  });

  it("a broken STATS binding does not break the download", async () => {
    await seed();
    const response = await fetchWorker(`${BASE}/downloads/GravityPort-darwin-arm64-0.3.7.zip`, {}, {
      ...env,
      STATS: {
        prepare() {
          throw new Error("boom");
        },
        async batch() {
          throw new Error("boom");
        },
      },
    });
    expect(response.status).toBe(200);
    await expectBody(response, ZIP_BODY);
  });
});
