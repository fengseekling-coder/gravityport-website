// Response headers. The five site-wide security headers (and their exact
// values) are the contract from task 285's nginx header table; nginx sends
// them on every response, including 404s.

/** @const {string} */
export const DEFAULT_CSP =
  "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

// The standalone CSP nginx sends for /domain-changed.html.
/** @const {string} */
export const DOMAIN_CHANGED_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Set the five site-wide security headers on a Headers object.
 * @param {Headers} headers Target; existing same-name headers are overwritten.
 * @param {{csp?: string | null}} [options] Omit for the default site CSP, pass
 *   a string to replace it, or pass null to leave any existing CSP untouched.
 */
export function applySecurityHeaders(headers, options = {}) {
  headers.set("strict-transport-security", "max-age=31536000");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  if (options.csp !== null) headers.set("content-security-policy", options.csp ?? DEFAULT_CSP);
}

/**
 * @returns {Response} 404 with security headers.
 */
export function notFoundResponse() {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
  applySecurityHeaders(headers);
  return new Response("Not Found\n", { status: 404, headers });
}

/**
 * @returns {Response} 405 with security headers and Allow: GET, HEAD.
 */
export function methodNotAllowedResponse() {
  const headers = new Headers({ "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
  applySecurityHeaders(headers);
  return new Response("Method Not Allowed\n", { status: 405, headers });
}
