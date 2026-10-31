// Pure helpers for the admin dashboard's rank lists. Loaded as a module
// before app.js (which imports it), so the lists stay in sync with their
// totals: beyond the display limit the remaining rows collapse into one
// "其他" row instead of being cut off.

/**
 * Collapse a rank list for display: at most `limit` leading rows, plus one
 * "其他" row summing the rest when anything was dropped. Lists that fit
 * (limit + 1 rows or fewer) are returned unchanged, so a 12-row list still
 * shows all 12 entries and only longer lists gain the "其他" row.
 * @param {[string, number][]} rows Entries sorted by count descending.
 * @param {number} [limit] Leading rows kept verbatim (default 11).
 * @returns {[string, number][]}
 */
export function rankRowsWithOther(rows, limit = 11) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= limit + 1) return list;
  const head = list.slice(0, limit);
  const rest = list.slice(limit).reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
  return [...head, ["其他", rest]];
}
