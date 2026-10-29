// Pages Functions middleware (pages/functions/_middleware.js): page-view
// recording with device/referrer/country buckets, crawler exclusion, and
// never breaking the page.
import { describe, expect, it } from "vitest";
import { onRequest } from "../../../pages/functions/_middleware.js";
import { counterRows, env } from "./helpers.js";

const BASE = "https://gravityport.azhuilab.com";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const ANDROID_TABLET_UA = "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Safari/537.36";
const ANDROID_PHONE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/**
 * Build a fake Pages Functions context. When `stats` is a recording stub, the
 * batched counter rows are captured in `batches` as {day, kind, key} tuples.
 */
function makePageContext(path, { base = BASE, method = "GET", userAgent = DESKTOP_UA, referer = null, country = null, status = 200, contentType = "text/html; charset=utf-8", stats } = {}) {
  const headers = new Headers({ "user-agent": userAgent });
  if (referer) headers.set("referer", referer);
  if (country) headers.set("cf-ipcountry", country);
  const batches = [];
  const collected = [];
  const recordingDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return { sql, args, run: async () => {} };
        },
      };
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({ day: statement.args[0], kind: statement.args[1], key: statement.args[2] })));
    },
  };
  const context = {
    request: new Request(`${base}${path}`, { method, headers }),
    // stats: undefined -> recording stub; null -> no STATS binding at all;
    // anything else is used as the binding directly.
    env: stats === undefined ? { STATS: recordingDb } : stats === null ? {} : { STATS: stats },
    next: async () => new Response(status === 304 ? null : "page", {
      status,
      headers: contentType ? { "content-type": contentType } : {},
    }),
    waitUntil(promise) {
      collected.push(promise);
    },
  };
  return { context, batches, collected };
}

async function waitCollected(collected) {
  await Promise.allSettled(collected);
}

function flatRows(batches) {
  return batches.flat();
}

describe("site page-view middleware", () => {
  it("records path, referrer, country and device for a desktop GET", async () => {
    const { context, batches, collected } = makePageContext("/");
    const response = await onRequest(context);
    expect(response.status).toBe(200);
    await waitCollected(collected);
    const rows = flatRows(batches);
    expect(rows).toEqual([
      expect.objectContaining({ kind: "page_path", key: "/" }),
      expect.objectContaining({ kind: "page_referrer", key: "direct" }),
      expect.objectContaining({ kind: "page_country", key: "XX" }),
      expect.objectContaining({ kind: "page_device", key: "desktop" }),
    ]);
  });

  it("ignores the pages.dev copies of the site", async () => {
    for (const base of ["https://gravityport-site.pages.dev", "https://b5f08398.gravityport-site.pages.dev"]) {
      const { context, batches, collected } = makePageContext("/", { base });
      const response = await onRequest(context);
      expect(response.status).toBe(200);
      await waitCollected(collected);
      expect(flatRows(batches), base).toEqual([]);
    }
  });

  it("classifies devices: mobile, tablet, desktop", async () => {
    for (const [userAgent, device] of [
      [IPHONE_UA, "mobile"],
      [ANDROID_PHONE_UA, "mobile"],
      [IPAD_UA, "tablet"],
      [ANDROID_TABLET_UA, "tablet"],
      [DESKTOP_UA, "desktop"],
    ]) {
      const { context, batches, collected } = makePageContext("/", { userAgent });
      await onRequest(context);
      await waitCollected(collected);
      const devices = flatRows(batches).filter((row) => row.kind === "page_device").map((row) => row.key);
      expect(devices, userAgent).toEqual([device]);
    }
  });

  it("crawlers only land in bot_page and never count as page views", async () => {
    const { context, batches, collected } = makePageContext("/guide/", { userAgent: GOOGLEBOT_UA });
    await onRequest(context);
    await waitCollected(collected);
    expect(flatRows(batches)).toEqual([expect.objectContaining({ kind: "bot_page", key: "/guide/" })]);
  });

  it("maps referrers: in-site hosts, external hostnames, absent and malformed", async () => {
    for (const [referer, expected] of [
      ["https://gravityport.azhuilab.com/en/", "internal"],
      ["https://mosa.azhuilab.com/", "internal"],
      ["https://example.com/post", "example.com"],
      ["not a url", "direct"],
    ]) {
      const { context, batches, collected } = makePageContext("/", { referer });
      await onRequest(context);
      await waitCollected(collected);
      const referrers = flatRows(batches).filter((row) => row.kind === "page_referrer").map((row) => row.key);
      expect(referrers, referer).toEqual([expected]);
    }
  });

  it("absent referrer counts as direct and missing country as XX", async () => {
    const { context, batches, collected } = makePageContext("/");
    await onRequest(context);
    await waitCollected(collected);
    const rows = flatRows(batches);
    expect(rows.find((row) => row.kind === "page_referrer").key).toBe("direct");
    expect(rows.find((row) => row.kind === "page_country").key).toBe("XX");
  });

  it("keeps the CF-IPCountry header value when present", async () => {
    const { context, batches, collected } = makePageContext("/", { country: "JP" });
    await onRequest(context);
    await waitCollected(collected);
    const countries = flatRows(batches).filter((row) => row.kind === "page_country").map((row) => row.key);
    expect(countries).toEqual(["JP"]);
  });

  it("normalizes /index.html to / and buckets unknown paths as other", async () => {
    for (const [path, expected] of [["/index.html", "/"], ["/en/privacy/", "/en/privacy/"], ["/site/styles.css", "other"]]) {
      const { context, batches, collected } = makePageContext(path);
      await onRequest(context);
      await waitCollected(collected);
      const paths = flatRows(batches).filter((row) => row.kind === "page_path").map((row) => row.key);
      expect(paths, path).toEqual([expected]);
    }
  });

  it("skips non-GET, non-200 and non-HTML responses", async () => {
    for (const options of [{ method: "HEAD" }, { status: 404 }, { status: 304 }, { contentType: "text/css" }, { contentType: null }]) {
      const { context, batches, collected } = makePageContext("/", options);
      await onRequest(context);
      await waitCollected(collected);
      expect(batches.length, JSON.stringify(options)).toBe(0);
    }
  });

  it("does nothing without a STATS binding and tolerates D1 failures", async () => {
    const noStats = makePageContext("/", { stats: null });
    const response = await onRequest(noStats.context);
    expect(response.status).toBe(200);
    expect(noStats.collected.length).toBe(0);

    const throwing = {
      prepare() {
        throw new Error("no table");
      },
      async batch() {
        throw new Error("no table");
      },
    };
    const failing = makePageContext("/", { stats: throwing });
    const failingResponse = await onRequest(failing.context);
    expect(failingResponse.status).toBe(200);
  });

  it("writes into the real D1 through waitUntil", async () => {
    const { context, collected } = makePageContext("/privacy/", { stats: env.STATS });
    const response = await onRequest(context);
    expect(response.status).toBe(200);
    await waitCollected(collected);
    const rows = await counterRows(env.STATS, "page_path");
    expect(rows).toEqual([{ day: expect.any(String), kind: "page_path", key: "/privacy/", count: 1 }]);
  });
});
