// Conditional request helpers (If-None-Match only, which is what the site
// needs; the update clients never send validators).

/**
 * Whether an If-None-Match header value matches an ETag (weak comparison).
 * "*" matches any existing object. Handles comma-separated lists and W/
 * weak validators.
 * @param {string | null} ifNoneMatch Raw request header value.
 * @param {string | undefined} etag R2 httpEtag (quoted).
 * @returns {boolean}
 */
export function ifNoneMatchSatisfied(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  if (!etag) return false;
  const normalize = (value) => value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
  const candidates = ifNoneMatch.split(",").map((value) => value.trim());
  if (candidates.includes("*")) return true;
  const objectTag = normalize(etag);
  return candidates.some((candidate) => normalize(candidate) === objectTag);
}
