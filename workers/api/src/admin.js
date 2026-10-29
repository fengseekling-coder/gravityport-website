// Admin feedback endpoints for the dashboard on the legacy domain:
//   GET /admin/feedback.json       — newest-first listing, no diagnostics text
//   GET /admin/feedback-item.json  — one full record, diagnostics included
//
// Parameters, pagination, response shapes and error codes are ported from
// the legacy Node service (removed in 279 C1) so admin/feedback.js keeps
// working unchanged.
// The old service sat behind nginx auth_request; here the caller must present
// a valid Cloudflare Access JWT (see src/access.js).

import { verifyAccessToken } from "./access.js";
import { FEEDBACK_ID_PATTERN, toListItem } from "./feedback.js";
import { jsonResponse } from "./http.js";

const ADMIN_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

/**
 * @param {Request} request
 * @param {GpApiEnv} env
 * @param {string} pathname "/admin/feedback.json" or "/admin/feedback-item.json"
 * @returns {Promise<Response>}
 */
export async function handleAdminFeedback(request, env, pathname) {
  // Non-GET replies 404 like the old service did (nginx never forwarded them).
  if (request.method !== "GET") {
    return jsonResponse(404, { code: "FEEDBACK_NOT_FOUND" }, ADMIN_HEADERS);
  }
  if (!(await verifyAccessToken(request, env))) {
    return jsonResponse(403, { code: "ACCESS_DENIED" }, ADMIN_HEADERS);
  }

  const url = new URL(request.url);
  return pathname === "/admin/feedback.json" ? listFeedback(url, env) : itemFeedback(url, env);
}

/**
 * @param {URL} url
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
async function listFeedback(url, env) {
  const limitRaw = url.searchParams.get("limit");
  let limit = 50;
  if (limitRaw !== null) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return jsonResponse(400, { code: "FEEDBACK_INVALID", field: "limit" }, ADMIN_HEADERS);
    }
  }
  const before = url.searchParams.get("before");
  if (before !== null && !FEEDBACK_ID_PATTERN.test(before)) {
    return jsonResponse(400, { code: "FEEDBACK_INVALID", field: "before" }, ADMIN_HEADERS);
  }

  // Ids start with a fixed-width UTC timestamp, so lexicographic order is
  // chronological order; newest first.
  const columns = "SELECT id, received_at, kind, message, contact, locale, app_json, diagnostics FROM feedback";
  const result =
    before !== null
      ? await env.FEEDBACK.prepare(`${columns} WHERE id < ?1 ORDER BY id DESC LIMIT ?2`).bind(before, limit + 1).all()
      : await env.FEEDBACK.prepare(`${columns} ORDER BY id DESC LIMIT ?1`).bind(limit + 1).all();

  const items = [];
  for (const row of result.results.slice(0, limit)) {
    // A row whose app blob fails to parse must not take the listing down.
    try {
      items.push(toListItem(row));
    } catch {
      // Skip the corrupted row.
    }
  }
  const nextBefore = result.results.length > limit && items.length > 0 ? items[items.length - 1].id : null;
  return jsonResponse(200, { items, nextBefore }, ADMIN_HEADERS);
}

/**
 * @param {URL} url
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
async function itemFeedback(url, env) {
  const id = url.searchParams.get("id") || "";
  let record = null;
  if (FEEDBACK_ID_PATTERN.test(id)) {
    const row = await env.FEEDBACK.prepare(
      "SELECT id, received_at, schema_version, kind, message, contact, locale, app_json, diagnostics FROM feedback WHERE id = ?1",
    )
      .bind(id)
      .first();
    if (row) {
      try {
        // Same shape the old service stored per submission as a JSON file.
        record = {
          id: row.id,
          receivedAt: row.received_at,
          schema: row.schema_version,
          kind: row.kind,
          message: row.message,
          locale: row.locale,
          app: JSON.parse(row.app_json),
        };
        if (row.contact) record.contact = row.contact;
        if (typeof row.diagnostics === "string") record.diagnostics = row.diagnostics;
      } catch {
        record = null;
      }
    }
  }
  if (!record) {
    return jsonResponse(404, { code: "FEEDBACK_NOT_FOUND" }, ADMIN_HEADERS);
  }
  return jsonResponse(200, record, ADMIN_HEADERS);
}
