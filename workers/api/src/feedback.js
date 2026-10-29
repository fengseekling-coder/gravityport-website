// POST /api/feedback — feedback collection, ported from the legacy Node
// service (removed in 279 C1) with two deliberate differences:
//
// 1. Abuse protection uses the managed FEEDBACK_LIMITER binding keyed by
//    CF-Connecting-IP instead of the in-memory per-IP daily counter. The
//    managed limiter only offers 10 and 60 second windows, so the old
//    "20 per IP per day" cap has no equivalent here; the global row and byte
//    storage caps are the backstop instead.
// 2. Storage is D1, one row per submission, instead of JSON files on disk.
//
// The connecting IP is only ever a rate limit key: it is not written to D1,
// not logged, and never echoed in a response.

import { jsonResponse, positiveInt, rateLimitAllows, readBodyWithLimit, utf8Length } from "./http.js";

const MAX_BODY_BYTES = 300 * 1024;
const CLIENT_HEADER = "x-gravityport-client";
const CLIENT_HEADER_VALUE = "desktop";
const KINDS = ["bug", "idea", "other"];
const LOCALES = ["zh", "en"];
const PRODUCTS = ["GravityPort", "MOSA"];
const PLATFORMS = ["macos", "windows", "other"];

export const FEEDBACK_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

/**
 * Validates a parsed body against the agreed interface. Returns
 * `{ value }` holding a sanitized copy, or `{ field }` naming the first bad
 * field. Ported unchanged from the old service.
 * @param {unknown} input
 * @returns {{value?: object, field?: string}}
 */
export function validateFeedback(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { field: "body" };
  if (typeof input.schema !== "number" || input.schema !== 1) return { field: "schema" };

  const knownKeys = ["schema", "kind", "message", "contact", "locale", "app", "diagnostics"];
  for (const key of Object.keys(input)) {
    if (!knownKeys.includes(key)) return { field: key };
  }

  if (!KINDS.includes(input.kind)) return { field: "kind" };

  if (typeof input.message !== "string") return { field: "message" };
  const message = input.message.trim();
  if (message.length < 1 || message.length > 5000) return { field: "message" };

  let contact = "";
  if (input.contact !== undefined) {
    if (typeof input.contact !== "string") return { field: "contact" };
    contact = input.contact.trim();
    if (contact.length > 200) return { field: "contact" };
  }

  if (!LOCALES.includes(input.locale)) return { field: "locale" };

  if (typeof input.app !== "object" || input.app === null || Array.isArray(input.app)) return { field: "app" };
  const appKeys = ["product", "version", "gitSha", "platform", "osVersion", "arch"];
  for (const key of Object.keys(input.app)) {
    if (!appKeys.includes(key)) return { field: `app.${key}` };
  }
  const app = input.app;
  if (!PRODUCTS.includes(app.product)) return { field: "app.product" };
  if (typeof app.version !== "string" || app.version.length < 1 || app.version.length > 32) {
    return { field: "app.version" };
  }
  if (app.gitSha !== undefined) {
    if (typeof app.gitSha !== "string" || app.gitSha.length < 1 || app.gitSha.length > 40) {
      return { field: "app.gitSha" };
    }
  }
  if (!PLATFORMS.includes(app.platform)) return { field: "app.platform" };
  if (typeof app.osVersion !== "string" || app.osVersion.length < 1 || app.osVersion.length > 64) {
    return { field: "app.osVersion" };
  }
  if (typeof app.arch !== "string" || app.arch.length < 1 || app.arch.length > 16) {
    return { field: "app.arch" };
  }

  if (input.diagnostics !== undefined) {
    if (typeof input.diagnostics !== "string" || input.diagnostics.length > 200_000) {
      return { field: "diagnostics" };
    }
  }

  const value = {
    schema: 1,
    kind: input.kind,
    message,
    locale: input.locale,
    app: {
      product: app.product,
      version: app.version,
      platform: app.platform,
      osVersion: app.osVersion,
      arch: app.arch,
    },
  };
  if (contact.length > 0) value.contact = contact;
  if (app.gitSha !== undefined) value.app.gitSha = app.gitSha;
  if (input.diagnostics !== undefined) value.diagnostics = input.diagnostics;
  return { value };
}

/**
 * @returns {string} `YYYYMMDDTHHMMSSZ-8 hex chars`, UTC.
 */
function makeFeedbackId() {
  const date = new Date();
  const pad = (value, width) => String(value).padStart(width, "0");
  const stamp =
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    "T" +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    "Z";
  let suffix = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(4))) suffix += byte.toString(16).padStart(2, "0");
  return `${stamp}-${suffix}`;
}

/**
 * Shape of one listing row, matching the old service's toListItem so the
 * admin dashboard keeps working unchanged.
 * @param {{id: string, received_at: string, kind: string, message: string, contact: string|null, locale: string, app_json: string, diagnostics: string|null}} row
 */
export function toListItem(row) {
  const app = JSON.parse(row.app_json);
  const diagnostics = typeof row.diagnostics === "string" ? row.diagnostics : "";
  return {
    id: row.id,
    receivedAt: row.received_at,
    kind: row.kind,
    message: row.message,
    contact: typeof row.contact === "string" ? row.contact : "",
    locale: row.locale,
    app,
    hasDiagnostics: diagnostics.length > 0,
    diagnosticsLength: diagnostics.length,
  };
}

/**
 * @param {Request} request
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
export async function handleFeedbackPost(request, env) {
  const headerOk =
    request.headers.get(CLIENT_HEADER) === CLIENT_HEADER_VALUE &&
    (request.headers.get("content-type") || "").toLowerCase().includes("application/json");
  if (!headerOk) {
    return jsonResponse(400, { code: "FEEDBACK_INVALID", field: "headers" });
  }

  let text;
  try {
    text = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch {
    return jsonResponse(413, { code: "FEEDBACK_TOO_LARGE" });
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await rateLimitAllows(env.FEEDBACK_LIMITER, ip))) {
    return jsonResponse(429, { code: "FEEDBACK_RATE_LIMITED" });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse(400, { code: "FEEDBACK_INVALID", field: "body" });
  }

  const verdict = validateFeedback(parsed);
  if (verdict.field) {
    return jsonResponse(400, { code: "FEEDBACK_INVALID", field: verdict.field });
  }

  const id = makeFeedbackId();
  const record = { id, receivedAt: new Date().toISOString(), ...verdict.value };
  const payloadBytes = utf8Length(JSON.stringify(record));

  const db = env.FEEDBACK;
  const maxRows = positiveInt(env.FEEDBACK_MAX_ROWS, 10_000);
  const maxTotalBytes = positiveInt(env.FEEDBACK_MAX_TOTAL_BYTES, 1_073_741_824);
  const usage = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS total_bytes FROM feedback").first();
  if (Number(usage?.n) >= maxRows || Number(usage?.total_bytes) + payloadBytes > maxTotalBytes) {
    return jsonResponse(503, { code: "FEEDBACK_UNAVAILABLE" });
  }

  try {
    await db
      .prepare(
        "INSERT INTO feedback (id, received_at, schema_version, kind, message, contact, locale, app_json, diagnostics, bytes) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      )
      .bind(
        id,
        record.receivedAt,
        record.schema,
        record.kind,
        record.message,
        typeof record.contact === "string" ? record.contact : "",
        record.locale,
        JSON.stringify(record.app),
        typeof record.diagnostics === "string" ? record.diagnostics : null,
        payloadBytes,
      )
      .run();
  } catch {
    return jsonResponse(503, { code: "FEEDBACK_UNAVAILABLE" });
  }

  return jsonResponse(201, { ok: true, id });
}
