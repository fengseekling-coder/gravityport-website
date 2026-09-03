#!/usr/bin/env bash
set -euo pipefail

SITE_ROOT="${MOSA_SITE_ROOT:-/var/www/mosa-website}"
ACCESS_LOG="${MOSA_ACCESS_LOG:-/var/log/nginx/access.log}"
STATE_DIR="${MOSA_STATS_STATE_DIR:-/var/lib/mosa-stats}"
STATE_FILE="${STATE_DIR}/usage-state.json"
NODE_BIN="${MOSA_NODE_BIN:-$(command -v node || true)}"
CRON_FILE="/etc/cron.d/mosa-private-stats"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root so it can read Nginx logs and install cron." >&2
  exit 1
fi
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js is required on the server. Set MOSA_NODE_BIN if it is installed elsewhere." >&2
  exit 1
fi
if [[ ! -r "${ACCESS_LOG}" ]]; then
  echo "Cannot read Nginx access log: ${ACCESS_LOG}" >&2
  exit 1
fi
if [[ ! -f "${SITE_ROOT}/scripts/report-usage.mjs" ]]; then
  echo "Missing ${SITE_ROOT}/scripts/report-usage.mjs" >&2
  exit 1
fi

install -d -m 0755 "${SITE_ROOT}/admin"
install -d -m 0700 "${STATE_DIR}"
"${NODE_BIN}" "${SITE_ROOT}/scripts/report-usage.mjs" "${ACCESS_LOG}" --state "${STATE_FILE}" --output "${SITE_ROOT}/admin/stats.json"

cat > "${CRON_FILE}" <<EOF
*/5 * * * * root ${NODE_BIN} ${SITE_ROOT}/scripts/report-usage.mjs ${ACCESS_LOG} --state ${STATE_FILE} --output ${SITE_ROOT}/admin/stats.json >/dev/null 2>&1
EOF
chmod 0644 "${CRON_FILE}"

echo "Private stats refresh installed: every 5 minutes."
echo "Next: configure Nginx Basic Auth using ops/nginx-private-stats.conf.example."
