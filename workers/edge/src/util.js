// Utility functions shared by the gp-edge Worker. Analytics days are calendar
// days in America/Los_Angeles, matching scripts/report-usage.mjs in this
// repository exactly.

/** @const {number} */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** @const {string} */
export const ANALYTICS_TIME_ZONE = "America/Los_Angeles";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYTICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Analytics day key ("YYYY-MM-DD") for a timestamp, in America/Los_Angeles.
 * @param {number} timestamp Epoch milliseconds.
 * @returns {string}
 */
export function analyticsDayKey(timestamp) {
  const parts = dayFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * The `count` most recent distinct analytics day keys, oldest first (today
 * last). Walking back in 24-hour steps crosses exactly one Los Angeles
 * midnight per step, so this never skips a calendar day.
 * @param {number} nowMs Epoch milliseconds.
 * @param {number} count
 * @returns {string[]}
 */
export function recentDayKeys(nowMs, count) {
  const keys = [];
  let cursor = nowMs;
  while (keys.length < count) {
    const key = analyticsDayKey(cursor);
    if (keys[0] !== key) keys.unshift(key);
    cursor -= DAY_MS;
  }
  return keys;
}
