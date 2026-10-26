#!/usr/bin/env bash
# Install or update the Pinterest token relay on the website server. Run as root.
# See ops/PINTEREST-TOKEN.md. The App Secret is NOT handled here: the operator
# writes it with the one-line command in that document.
set -euo pipefail

SITE_ROOT="${MOSA_SITE_ROOT:-/var/www/mosa-website}"
NODE_BIN="${MOSA_NODE_BIN:-$(command -v node || true)}"
# The relay reads the App Secret, so it must not run code the deploy account can
# change: the script is copied into a root-owned directory, like the stats runner.
RUNNER_DIR="${PINTEREST_RUNNER_DIR:-/usr/local/lib/gravityport-pinterest}"
SECRET_FILE="/etc/gravityport/pinterest-app-secret"
CLIENT_ID="${PINTEREST_CLIENT_ID:-1628239}"
PORT="${PINTEREST_TOKEN_PORT:-39128}"
ALLOWED_REDIRECTS="${PINTEREST_ALLOWED_REDIRECTS:-http://localhost:43517/api/pinterest/callback}"
SERVICE_NAME="pinterest-token.service"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}"
ZONE_FILE="/etc/nginx/conf.d/gravityport-pinterest-token-zone.conf"
SNIPPET_FILE="/etc/nginx/snippets/gravityport-pinterest-token.conf"
SITE_CONF="${MOSA_NGINX_SITE_CONF:-/etc/nginx/sites-available/mosa.azhuilab.com.conf}"
ANCHOR_INCLUDE="include /etc/nginx/snippets/gravityport-feedback.conf;"
OUR_INCLUDE="include ${SNIPPET_FILE};"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi
if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "Node.js is required. Set MOSA_NODE_BIN if it is installed elsewhere." >&2
  exit 1
fi
if [[ ! "${PORT}" =~ ^[0-9]+$ || "${PORT}" -lt 1 || "${PORT}" -gt 65535 ]]; then
  echo "PINTEREST_TOKEN_PORT must be a valid TCP port." >&2
  exit 1
fi
for f in scripts/pinterest-token.mjs ops/pinterest-token.service.example ops/nginx-pinterest-token.conf.example; do
  if [[ ! -f "${SITE_ROOT}/${f}" ]]; then
    echo "Missing ${SITE_ROOT}/${f}" >&2
    exit 1
  fi
done
# Edit the real file, never the sites-enabled symlink (sed -i would replace the link).
SITE_CONF="$(readlink -f "${SITE_CONF}")"
if [[ ! -f "${SITE_CONF}" ]]; then
  echo "Missing Nginx site config ${SITE_CONF}" >&2
  exit 1
fi

install -d -o root -g www-data -m 0750 /etc/gravityport
install -d -o root -g root -m 0755 "${RUNNER_DIR}"
install -o root -g root -m 0644 "${SITE_ROOT}/scripts/pinterest-token.mjs" "${RUNNER_DIR}/pinterest-token.mjs"
echo "Installed pinterest-token.mjs sha256: $(sha256sum "${RUNNER_DIR}/pinterest-token.mjs" | cut -d' ' -f1)"

sed \
  -e "s|__MOSA_NODE_BIN__|${NODE_BIN}|g" \
  -e "s|__PINTEREST_RUNNER_DIR__|${RUNNER_DIR}|g" \
  -e "s|__PINTEREST_CLIENT_ID__|${CLIENT_ID}|g" \
  -e "s|__PINTEREST_TOKEN_PORT__|${PORT}|g" \
  -e "s|__PINTEREST_ALLOWED_REDIRECTS__|${ALLOWED_REDIRECTS}|g" \
  "${SITE_ROOT}/ops/pinterest-token.service.example" > "${UNIT_FILE}"
chmod 0644 "${UNIT_FILE}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null

# Nginx: zone in http{} (conf.d), location in a snippet included by the site.
backup_dir="$(mktemp -d /root/pinterest-token-nginx-backup.XXXXXX)"
cp -a "${SITE_CONF}" "${backup_dir}/site.conf"
[[ -f "${ZONE_FILE}" ]] && cp -a "${ZONE_FILE}" "${backup_dir}/zone.conf"
[[ -f "${SNIPPET_FILE}" ]] && cp -a "${SNIPPET_FILE}" "${backup_dir}/snippet.conf"

restore_nginx() {
  cp -a "${backup_dir}/site.conf" "${SITE_CONF}"
  if [[ -f "${backup_dir}/zone.conf" ]]; then cp -a "${backup_dir}/zone.conf" "${ZONE_FILE}"; else rm -f "${ZONE_FILE}"; fi
  if [[ -f "${backup_dir}/snippet.conf" ]]; then cp -a "${backup_dir}/snippet.conf" "${SNIPPET_FILE}"; else rm -f "${SNIPPET_FILE}"; fi
}

echo "limit_req_zone \$binary_remote_addr zone=pinterest_token:1m rate=10r/m;" > "${ZONE_FILE}"
chmod 0644 "${ZONE_FILE}"
sed -e "s|__PINTEREST_TOKEN_PORT__|${PORT}|g" \
  "${SITE_ROOT}/ops/nginx-pinterest-token.conf.example" > "${SNIPPET_FILE}"
chmod 0644 "${SNIPPET_FILE}"

if ! grep -qF "${OUR_INCLUDE}" "${SITE_CONF}"; then
  if ! grep -qF "${ANCHOR_INCLUDE}" "${SITE_CONF}"; then
    restore_nginx
    echo "Could not find '${ANCHOR_INCLUDE}' in ${SITE_CONF}; add '${OUR_INCLUDE}' to the HTTPS server block by hand." >&2
    exit 1
  fi
  # Insert our include right after the feedback include, keeping its indentation.
  awk -v anchor="${ANCHOR_INCLUDE}" -v ours="${OUR_INCLUDE}" '
    { print }
    index($0, anchor) { match($0, /^[ \t]*/); print substr($0, 1, RLENGTH) ours }
  ' "${backup_dir}/site.conf" > "${SITE_CONF}"
fi

if ! nginx -t 2>&1; then
  restore_nginx
  echo "nginx -t failed; Nginx files restored from ${backup_dir}." >&2
  exit 1
fi

if [[ -s "${SECRET_FILE}" ]]; then
  chown root:www-data "${SECRET_FILE}"
  chmod 0640 "${SECRET_FILE}"
  systemctl restart "${SERVICE_NAME}"
  systemctl reload nginx
  echo "Pinterest token relay running on 127.0.0.1:${PORT}; Nginx reloaded."
else
  systemctl reload nginx
  echo "Installed, but ${SECRET_FILE} is missing or empty, so the service was not started."
  echo "Write the App Secret (ops/PINTEREST-TOKEN.md step 1), then: systemctl restart ${SERVICE_NAME}"
fi
echo "Nginx backup: ${backup_dir}"
