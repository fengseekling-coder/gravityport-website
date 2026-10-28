// Object key derivation for /releases/* and /downloads/* paths. Both handlers
// share the same validation rules: no directory listing, no traversal, no
// encoded separators.

/**
 * Derive the R2 object key from a /releases/* or /downloads/* request path.
 * Returns null when the path must not map to an object (trailing slash,
 * ".." anywhere, an encoded slash or backslash, a malformed escape or an
 * encoded NUL). Callers turn null into 404.
 * @param {string} pathname URL pathname (still percent-encoded).
 * @returns {string | null}
 */
export function objectKeyFromPath(pathname) {
  if (!pathname.startsWith("/releases/") && !pathname.startsWith("/downloads/")) return null;
  if (pathname.endsWith("/")) return null;
  const raw = pathname.slice(1);
  if (raw.includes("..") || /%2f|%5c/i.test(raw) || raw.includes("%00")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("..") || decoded.includes("\0")) return null;
  // The decoded key legitimately contains "/" (nested keys such as
  // releases/gravityport/latest.json); only encoded separators in the raw
  // path are rejected above.
  return decoded;
}
