// Site page-view recording for the Cloudflare Pages deployment (279-A3a,
// 拍板第 5 条). Runs as a Pages Functions middleware in front of every route
// listed in pages/_routes.json (HTML pages only) and writes daily counters
// into the shared gp-stats D1 database using the same `counters` table as the
// gp-edge Worker (kinds: page_path, page_referrer, page_country, page_device,
// bot_page; see workers/edge/migrations/0001_init.sql).
//
// Recording never breaks the page: every error is swallowed, a missing STATS
// binding is a no-op, and a not-yet-migrated database is tolerated. No IP
// addresses are stored and no cookies are set; the user agent is read for the
// device class and then discarded.

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_TIME_ZONE = "America/Los_Angeles";

// Both first-party hosts count as in-site referrers.
const SITE_HOSTS = new Set(["gravityport.azhuilab.com", "mosa.azhuilab.com"]);

// The public page paths worth counting; everything else buckets as "other".
const PAGE_PATHS = new Set(["/", "/en/", "/privacy/", "/en/privacy/", "/guide/", "/demo/"]);

// Heuristic crawler detection by user-agent substring. Crawlers only feed the
// bot_page counters and never count as page views.
const BOT_USER_AGENT_PATTERN =
  /bot|crawl|spider|slurp|curl|wget|python-requests|headless|lighthouse|pagespeed|facebookexternalhit|embedly|preview|monitor|scanner|fetcher|http-client|okhttp|libwww/i;

const INTERNAL_REFERRER = "internal";
const DIRECT_REFERRER = "direct";
const OTHER_PATH = "other";
const UNKNOWN_COUNTRY = "XX";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYTICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Analytics day key ("YYYY-MM-DD") in America/Los_Angeles — the same rule the
 * gp-edge Worker applies.
 * @param {number} timestamp Epoch milliseconds.
 * @returns {string}
 */
function analyticsDayKey(timestamp) {
  const parts = dayFormatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * @param {string} pathname Request path without the query string.
 * @returns {string} One of the known page paths, or "other".
 */
function normalizePagePath(pathname) {
  if (pathname === "/index.html") return "/";
  return PAGE_PATHS.has(pathname) ? pathname : OTHER_PATH;
}

/**
 * Referrer bucket: hostname, or the in-site / direct buckets. Only the
 * hostname is ever stored.
 * @param {string | null} referer Raw Referer header.
 * @returns {string}
 */
function referrerKey(referer) {
  if (!referer) return DIRECT_REFERRER;
  try {
    const hostname = new URL(referer).hostname.toLowerCase();
    if (!hostname) return DIRECT_REFERRER;
    return SITE_HOSTS.has(hostname) ? INTERNAL_REFERRER : hostname;
  } catch {
    return DIRECT_REFERRER;
  }
}

/**
 * Device class from the user agent: desktop / mobile / tablet / bot.
 * @param {string | null} userAgent Raw User-Agent header.
 * @returns {"desktop" | "mobile" | "tablet" | "bot"}
 */
function classifyDevice(userAgent) {
  const value = userAgent || "";
  if (BOT_USER_AGENT_PATTERN.test(value)) return "bot";
  if (/iPad|Tablet|PlayBook|Silk/i.test(value) || (/Android/i.test(value) && !/Mobi/i.test(value))) return "tablet";
  if (/Mobi|iPhone|Windows Phone/i.test(value)) return "mobile";
  return "desktop";
}

/**
 * Pages Functions middleware: pass the page through untouched and, for
 * successful HTML GETs, record one page view (or one bot request).
 * @param {{request: Request, env: {STATS?: {prepare: Function, batch: Function}} | undefined, next: () => Promise<Response>, waitUntil?: (promise: Promise<unknown>) => void}} context
 * @returns {Promise<Response>}
 */
export async function onRequest(context) {
  const { request, env } = context;
  const response = await context.next();
  try {
    if (request.method !== "GET" || !response || response.status !== 200) return response;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) return response;
    if (!env || !env.STATS) return response;

    const url = new URL(request.url);
    const pathKey = normalizePagePath(url.pathname);
    const device = classifyDevice(request.headers.get("user-agent"));
    const day = analyticsDayKey(Date.now());
    const rows = device === "bot"
      ? [["bot_page", pathKey]]
      : [
          ["page_path", pathKey],
          ["page_referrer", referrerKey(request.headers.get("referer"))],
          ["page_country", request.headers.get("cf-ipcountry") || UNKNOWN_COUNTRY],
          ["page_device", device],
        ];
    const statements = rows.map(([kind, key]) =>
      env.STATS.prepare(
        "INSERT INTO counters (day, kind, key, count) VALUES (?, ?, ?, 1) " +
          "ON CONFLICT(day, kind, key) DO UPDATE SET count = count + 1"
      ).bind(day, kind, key)
    );
    const pending = env.STATS.batch(statements).catch(() => {
      // The gp-stats tables may not exist yet; recording must never break the
      // page.
    });
    if (typeof context.waitUntil === "function") context.waitUntil(pending);
  } catch {
    // Never break the page.
  }
  return response;
}
