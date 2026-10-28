// Generic per-day counter helpers. Counter "kind" names and their meanings
// are documented in migrations/0001_init.sql.

/**
 * @typedef {Object} StatsDb Minimal D1 surface used by the Worker.
 * @property {(sql: string) => {bind: (...values: unknown[]) => D1PreparedStatementLike}} prepare
 * @property {(statements: D1PreparedStatementLike[]) => Promise<unknown>} batch
 */

/**
 * Build a prepared statement that adds `amount` to a counter row, creating it
 * when absent.
 * @param {StatsDb} db
 * @param {string} day Analytics day key.
 * @param {string} kind Counter kind.
 * @param {string} key Counter key.
 * @param {number} amount Positive integer.
 * @returns {D1PreparedStatementLike}
 */
export function counterUpsert(db, day, kind, key, amount) {
  return db
    .prepare(
      "INSERT INTO counters (day, kind, key, count) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + ?"
    )
    .bind(day, kind, key, amount, amount);
}

/**
 * Classify a download file name into desktop / extension / other. The two
 * patterns are the contract from scripts/report-usage.mjs and must stay in
 * sync with it.
 * @param {string} file
 * @returns {"desktop" | "extension" | "other"}
 */
export function classifyDownload(file) {
  const EXTENSION_DOWNLOAD_PATTERN = /^(?:MOSA|GravityPort)-Web-Capture-[A-Za-z0-9._-]+\.zip$/;
  const DESKTOP_DOWNLOAD_PATTERN = /^(?:MOSA|GravityPort)-(?:darwin|win32)-[A-Za-z0-9._-]+\.(?:zip|dmg|exe)$/;
  if (EXTENSION_DOWNLOAD_PATTERN.test(file)) return "extension";
  if (DESKTOP_DOWNLOAD_PATTERN.test(file)) return "desktop";
  return "other";
}

/**
 * @typedef {Object} D1PreparedStatementLike
 * @property {(...values: unknown[]) => D1PreparedStatementLike} bind
 * @property {() => Promise<{results?: unknown[]}>} all
 * @property {() => Promise<unknown>} run
 * @property {(column?: string) => Promise<unknown>} first
 */
