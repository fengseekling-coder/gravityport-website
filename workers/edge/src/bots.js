// Crawler user-agent rule for the download counters (399).
//
// This is a copy of BOT_USER_AGENT_PATTERN in pages/functions/_middleware.js:
// a Worker cannot import a Pages Functions file, so the regex lives in both
// places. test/bots.test.js reads both real files and asserts that `source`
// and `flags` are identical; change both together.

export const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|slurp|curl|wget|python-requests|headless|lighthouse|pagespeed|facebookexternalhit|embedly|preview|monitor|scanner|fetcher|http-client|okhttp|libwww/i;

/**
 * A request without a User-Agent counts as a crawler, like one that matches
 * the pattern.
 * @param {string | null | undefined} userAgent Raw User-Agent header.
 * @returns {boolean}
 */
export function isBotUserAgent(userAgent) {
  if (!userAgent) return true;
  return BOT_USER_AGENT_PATTERN.test(userAgent);
}
