// The crawler rule exists twice (Pages middleware and Worker, 399); this test
// reads both real files and fails when only one side is changed.
import { describe, expect, it } from "vitest";
import { BOT_USER_AGENT_PATTERN, isBotUserAgent } from "../src/bots.js";

// ?raw gives the real file text (not a copy) inside the Workers test pool.
import middlewareSource from "../../../pages/functions/_middleware.js?raw";
import botsSource from "../src/bots.js?raw";

function patternFromSource(source, name) {
  const match = /BOT_USER_AGENT_PATTERN =\s*\/(.+)\/([a-z]*);/.exec(source);
  expect(match, `BOT_USER_AGENT_PATTERN literal in ${name}`).not.toBeNull();
  return { source: match[1], flags: match[2] };
}

describe("crawler user-agent rule", () => {
  it("is identical in pages/functions/_middleware.js and workers/edge/src/bots.js", () => {
    const pages = patternFromSource(middlewareSource, "pages/functions/_middleware.js");
    const worker = patternFromSource(botsSource, "workers/edge/src/bots.js");
    expect(worker.source).toBe(pages.source);
    expect(worker.flags).toBe(pages.flags);
    expect(BOT_USER_AGENT_PATTERN.source).toBe(new RegExp(pages.source, pages.flags).source);
    expect(BOT_USER_AGENT_PATTERN.flags).toBe(pages.flags);
  });

  it("treats crawlers and a missing user agent as bots, browsers as people", () => {
    for (const ua of ["curl/8.0", "Slackbot-LinkExpanding 1.0", "", null, undefined]) {
      expect(isBotUserAgent(ua), String(ua)).toBe(true);
    }
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")).toBe(false);
  });
});
