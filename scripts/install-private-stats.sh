#!/usr/bin/env bash
set -euo pipefail

SITE_ROOT="${MOSA_SITE_ROOT:-/var/www/mosa-website}"
ACCESS_LOG="${MOSA_ACCESS_LOG:-/var/log/nginx/access.log}"
STATE_DIR="${MOSA_STATS_STATE_DIR:-/var/lib/mosa-stats}"
STATE_FILE="${STATE_DIR}/usage-state.json"
NODE_BIN="${MOSA_NODE_BIN:-$(command -v node || true)}"
CRON_FILE="/etc/cron.d/mosa-private-stats"
# Root runs the stats every 5 minutes, so it must never execute or create
# files the deploy account can change: the script is copied into a root-owned
# directory and the finished report is renamed into the web root.
RUNNER_DIR="${MOSA_STATS_RUNNER_DIR:-/usr/local/lib/gravityport-stats}"
RUNNER="${RUNNER_DIR}/run.sh"
AUTH_PORT="${MOSA_AUTH_PORT:-39127}"
AUTH_STATE_DIR="${MOSA_AUTH_STATE_DIR:-/var/lib/mosa-stats-auth}"
AUTH_STATE_FILE="${AUTH_STATE_DIR}/sessions.json"
AUTH_PASSWORD_FILE="${MOSA_AUTH_PASSWORD_FILE:-/etc/nginx/.htpasswd-mosa-stats}"
AUTH_SERVICE_NAME="mosa-private-stats-auth.service"
AUTH_UNIT_SOURCE="${SITE_ROOT}/ops/mosa-private-stats-auth.service.example"
AUTH_UNIT_FILE="/etc/systemd/system/${AUTH_SERVICE_NAME}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root so it can read Nginx logs and install cron." >&2
  exit 1
fi
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js is required on the server. Set MOSA_NODE_BIN if it is installed elsewhere." >&2
  exit 1
fi
if [[ ! "${AUTH_PORT}" =~ ^[0-9]+$ || "${AUTH_PORT}" -lt 1 || "${AUTH_PORT}" -gt 65535 ]]; then
  echo "MOSA_AUTH_PORT must be a valid TCP port." >&2
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
if [[ ! -f "${SITE_ROOT}/scripts/admin-auth.mjs" || ! -f "${AUTH_UNIT_SOURCE}" ]]; then
  echo "Missing private stats auth service files under ${SITE_ROOT}." >&2
  exit 1
fi
if ! getent group www-data >/dev/null; then
  echo "The www-data group is required for the private stats auth service." >&2
  exit 1
fi

install -d -m 0755 "${SITE_ROOT}/admin"
install -d -m 0700 "${STATE_DIR}"
install -d -o root -g root -m 0755 "${RUNNER_DIR}"
install -o root -g root -m 0644 "${SITE_ROOT}/scripts/report-usage.mjs" "${RUNNER_DIR}/report-usage.mjs"
echo "Installed report-usage.mjs sha256: $(sha256sum "${RUNNER_DIR}/report-usage.mjs" | cut -d' ' -f1)"
cat > "${RUNNER}" <<RUNNER_EOF
#!/bin/sh
# Private usage stats, run by root from cron. See scripts/install-private-stats.sh.
set -eu
${NODE_BIN} ${RUNNER_DIR}/report-usage.mjs ${ACCESS_LOG} --state ${STATE_FILE} --output ${STATE_DIR}/stats.json >/dev/null
cp ${STATE_DIR}/stats.json ${STATE_DIR}/stats.publish
chmod 0644 ${STATE_DIR}/stats.publish
mv -fT ${STATE_DIR}/stats.publish ${SITE_ROOT}/admin/stats.json
RUNNER_EOF
chown root:root "${RUNNER}"
chmod 0755 "${RUNNER}"
"${RUNNER}"

install -d -o root -g www-data -m 0770 "${AUTH_STATE_DIR}"
chmod 0770 "${AUTH_STATE_DIR}"
if [[ ! -e "${AUTH_STATE_FILE}" ]]; then
  install -o www-data -g www-data -m 0600 /dev/null "${AUTH_STATE_FILE}"
else
  chown www-data:www-data "${AUTH_STATE_FILE}"
  chmod 0600 "${AUTH_STATE_FILE}"
fi
if [[ -f "${AUTH_PASSWORD_FILE}" ]]; then
  chown root:www-data "${AUTH_PASSWORD_FILE}"
  chmod 0640 "${AUTH_PASSWORD_FILE}"
fi

sed \
  -e "s|__MOSA_NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__MOSA_SITE_ROOT__|${SITE_ROOT}|g" \
  -e "s|__MOSA_AUTH_PASSWORD_FILE__|${AUTH_PASSWORD_FILE}|g" \
  -e "s|__MOSA_AUTH_STATE_FILE__|${AUTH_STATE_FILE}|g" \
  -e "s|__MOSA_AUTH_STATE_DIR__|${AUTH_STATE_DIR}|g" \
  -e "s|__MOSA_AUTH_PORT__|${AUTH_PORT}|g" \
  "${AUTH_UNIT_SOURCE}" > "${AUTH_UNIT_FILE}"
chmod 0644 "${AUTH_UNIT_FILE}"

cat > "${CRON_FILE}" <<EOF
*/5 * * * * root ${RUNNER} >/dev/null 2>&1
EOF
chmod 0644 "${CRON_FILE}"

systemctl daemon-reload
systemctl enable --now "${AUTH_SERVICE_NAME}"

echo "Private stats refresh installed: every 5 minutes."
echo "Private stats login service installed: 30-day cookie sessions on 127.0.0.1:${AUTH_PORT}."
echo "Next: configure Nginx session auth using ops/nginx-private-stats.conf.example."
