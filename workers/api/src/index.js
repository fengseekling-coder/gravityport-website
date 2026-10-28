// gp-api: the Worker behind /api/* on both domains, plus the two admin
// feedback endpoints on the legacy domain. Routes are attached outside this
// repository (this file carries no account_id and no routes on purpose).
//
// Logging: one line per request, never any content. The feedback and admin
// endpoints log method, path, status and response bytes; the Pinterest
// endpoints log only the grant type and status. Console output is the only
// channel (Workers Logs stay disabled in wrangler.toml).

import { handleAdminFeedback } from "./admin.js";
import { handleFeedbackPost } from "./feedback.js";
import { handlePinterestSession, handlePinterestToken } from "./pinterest.js";
import { jsonResponse, utf8Length } from "./http.js";

/**
 * @param {Request} request
 * @param {GpApiEnv} env
 * @returns {Promise<Response>}
 */
async function route(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/feedback") {
    if (request.method !== "POST") return jsonResponse(405, { code: "METHOD_NOT_ALLOWED" });
    return handleFeedbackPost(request, env);
  }
  if (pathname === "/admin/feedback.json" || pathname === "/admin/feedback-item.json") {
    return handleAdminFeedback(request, env, pathname);
  }
  if (pathname === "/api/pinterest/session") {
    if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
    return handlePinterestSession(request, env);
  }
  if (pathname === "/api/pinterest/token") {
    if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
    return handlePinterestToken(request, env);
  }
  return jsonResponse(404, { code: "FEEDBACK_NOT_FOUND" });
}

export default {
  /**
   * @param {Request} request
   * @param {GpApiEnv} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const pinterest = pathname === "/api/pinterest/session" || pathname === "/api/pinterest/token";
    try {
      const response = await route(request, env);
      if (!pinterest) {
        // The Pinterest endpoints log their own grant/status line; everything
        // else logs in the format of the old feedback service.
        console.log(
          `${new Date().toISOString()} ${request.method} ${pathname} ${response.status} ${utf8Length(await response.clone().text())}`,
        );
      }
      return response;
    } catch {
      return jsonResponse(500, { code: "FEEDBACK_UNAVAILABLE" });
    }
  },
};
