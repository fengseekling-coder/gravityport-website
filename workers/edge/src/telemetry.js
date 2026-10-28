// Anonymous usage telemetry from the update feed requests. The acceptance
// rules (parameters, legacy formats) are the contract from
// scripts/report-usage.mjs and must stay in sync with it.

import { analyticsDayKey } from "./util.js";

/** @const {number} */
export const TELEMETRY_VERSION = 2;

// The only manifest keys that carry telemetry, per the nginx log contract.
/** @const {Set<string>} */
export const TELEMETRY_PATHS = new Set(["/releases/latest.json", "/releases/gravityport/latest.json"]);

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE_EVENTS = new Set(["first_launch", "daily_active"]);
const USAGE_PLATFORMS = new Set(["macos", "windows", "other"]);
const ARCH_PATTERN = /^[0-9A-Za-z._-]{1,24}$/;
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Validate and extract telemetry parameters from a request URL. Returns null
 * for anything the nginx log contract would have rejected; those requests are
 * served but never recorded.
 * @param {URL} url
 * @returns {{event: string, telemetryVersion: number, installId: string, platform: string, arch: string, version: string} | null}
 */
export function parseTelemetryParams(url) {
  const params = url.searchParams;
  const event = params.get("event") || "";
  const installId = params.get("install_id") || "";
  const platform = params.get("platform") || "";
  const arch = params.get("arch") || "";
  const version = params.get("version") || "";
  if (
    !INSTALLATION_ID_PATTERN.test(installId)
    || !USAGE_EVENTS.has(event)
    || !USAGE_PLATFORMS.has(platform)
    || !ARCH_PATTERN.test(arch)
    || !VERSION_PATTERN.test(version)
  ) {
    return null;
  }
  // Missing or unparsable telemetry_version means a legacy (v1) client; those
  // installations are still recorded but do not join the daily activity sets.
  const telemetryVersion = Number(params.get("telemetry_version")) || 1;
  return { event, telemetryVersion, installId, platform, arch, version };
}

/**
 * Record one telemetry report. Fire-and-forget: every failure is swallowed so
 * recording can never affect the manifest response (status, headers, bytes).
 * @param {StatsDb} env STATS binding.
 * @param {URL} url Request URL (must already be validated as a telemetry path).
 * @param {number} nowMs Request time, epoch milliseconds.
 * @returns {Promise<void>}
 */
export async function recordTelemetry(env, url, nowMs) {
  const parsed = parseTelemetryParams(url);
  if (!parsed) return;
  const { installId, platform, arch, version, event, telemetryVersion } = parsed;
  const firstLaunch = event === "first_launch" ? 1 : 0;
  try {
    const statements = [
      env
        .prepare(
          // Semantics match report-usage.mjs: first_seen_at is the earliest
          // report; platform/arch/version follow the latest report (>= so a
          // same-millisecond report still wins); first_launch is sticky.
          "INSERT INTO installs (install_id, first_seen_at, last_seen_at, platform, arch, version, first_launch) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(install_id) DO UPDATE SET " +
            "last_seen_at = CASE WHEN ? >= installs.last_seen_at THEN ? ELSE installs.last_seen_at END, " +
            "platform = CASE WHEN ? >= installs.last_seen_at THEN ? ELSE installs.platform END, " +
            "arch = CASE WHEN ? >= installs.last_seen_at THEN ? ELSE installs.arch END, " +
            "version = CASE WHEN ? >= installs.last_seen_at THEN ? ELSE installs.version END, " +
            "first_launch = CASE WHEN installs.first_launch = 1 OR ? = 1 THEN 1 ELSE 0 END"
        )
        .bind(
          installId,
          nowMs,
          nowMs,
          platform,
          arch,
          version,
          firstLaunch,
          nowMs,
          nowMs,
          nowMs,
          platform,
          nowMs,
          arch,
          nowMs,
          version,
          firstLaunch
        ),
    ];
    if (telemetryVersion === TELEMETRY_VERSION) {
      statements.push(
        env
          .prepare(
            "INSERT INTO daily_active (day, install_id, first_launch) VALUES (?, ?, ?) " +
              "ON CONFLICT(day, install_id) DO UPDATE SET first_launch = MAX(daily_active.first_launch, ?)"
          )
          .bind(analyticsDayKey(nowMs), installId, firstLaunch, firstLaunch)
      );
    }
    await env.batch(statements);
  } catch {
    // Recording must never break the response.
  }
}
