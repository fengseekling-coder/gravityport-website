#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '[mosa-release] %s\n' "$1"
}

source_root="${MOSA_RELEASE_SOURCE_DIR:-/Users/azhuilab/codex_aigc/mosa/out/make/zip}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
retention_selector="$script_dir/select-desktop-release-retention.mjs"
desktop_retention_count=4
ssh_host="${MOSA_RELEASE_SSH_HOST:-179.253.232.244}"
ssh_user="${MOSA_RELEASE_SSH_USER:-mosa-deploy}"
ssh_port="${MOSA_RELEASE_SSH_PORT:-22}"
ssh_key="${MOSA_RELEASE_SSH_KEY:-/Users/azhuilab/.ssh/mosa_website_release_monitor}"
known_hosts="${MOSA_RELEASE_KNOWN_HOSTS:-/Users/azhuilab/.ssh/known_hosts}"
remote_dir="${MOSA_RELEASE_REMOTE_DIR:-/var/www/mosa-website}"
state_file="${MOSA_RELEASE_STATE_FILE:-/Users/azhuilab/.config/mosa/desktop-release-monitor.state}"
dry_run=0

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
[[ "$#" -eq 0 ]] || die "usage: publish-desktop-release.sh [--dry-run]"

[[ -d "$source_root/darwin/arm64" ]] || die "missing macOS release directory: $source_root/darwin/arm64"
[[ -d "$source_root/win32/x64" ]] || die "missing Windows release directory: $source_root/win32/x64"
command -v node >/dev/null 2>&1 || die "node is required"
command -v unzip >/dev/null 2>&1 || die "unzip is required"
command -v shasum >/dev/null 2>&1 || die "shasum is required"
command -v stat >/dev/null 2>&1 || die "stat is required"
[[ -r "$retention_selector" ]] || die "desktop retention selector is missing: $retention_selector"

file_size() {
  local candidate="$1"
  stat -f '%z' "$candidate" 2>/dev/null || stat -c '%s' "$candidate" 2>/dev/null
}

wait_for_stable_file() {
  local candidate="$1"
  local previous_size current_size
  local attempt
  for attempt in {1..45}; do
    [[ -f "$candidate" ]] || return 1
    previous_size="$(file_size "$candidate")" || return 1
    [[ "$previous_size" -gt 0 ]] || { sleep 2; continue; }
    sleep 2
    current_size="$(file_size "$candidate")" || return 1
    if [[ "$previous_size" == "$current_size" && "$current_size" -gt 0 ]]; then
      return 0
    fi
  done
  return 1
}

candidate_pair="$(node - "$source_root/darwin/arm64" "$source_root/win32/x64" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [macDir, windowsDir] = process.argv.slice(2);
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value) {
  const match = versionPattern.exec(value);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return 0;
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function packages(dir, prefix) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = new RegExp(`^${prefix}(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)\\.zip$`).exec(entry.name);
      if (!match || !parseVersion(match[1])) return null;
      return { version: match[1], file: path.join(dir, entry.name) };
    })
    .filter(Boolean);
}

const macPackages = packages(macDir, "MOSA-darwin-arm64-");
const windowsPackages = packages(windowsDir, "MOSA-win32-x64-");
const windowsByVersion = new Map(windowsPackages.map((item) => [item.version, item]));
const pairs = macPackages
  .filter((mac) => windowsByVersion.has(mac.version))
  .map((mac) => ({ version: mac.version, mac: mac.file, windows: windowsByVersion.get(mac.version).file }));

if (!pairs.length) process.exit(2);
pairs.sort((left, right) => compareVersions(left.version, right.version));
const selected = pairs[pairs.length - 1];
process.stdout.write(`${selected.version}\t${selected.mac}\t${selected.windows}`);
NODE
)" || {
  log "等待 macOS/Windows 同版本 ZIP 同时出现。"
  exit 0
}

IFS=$'\t' read -r release_version mac_package windows_package <<< "$candidate_pair"
[[ -n "$release_version" && -f "$mac_package" && -f "$windows_package" ]] || die "release candidate is incomplete"

if ! wait_for_stable_file "$mac_package" || ! wait_for_stable_file "$windows_package"; then
  log "安装包仍在生成，下一次监控周期会重试。"
  exit 1
fi

unzip -tqq "$mac_package" || die "macOS ZIP integrity check failed: $mac_package"
unzip -Z1 "$mac_package" | grep -Fx 'MOSA.app/Contents/MacOS/MOSA' >/dev/null || die "macOS ZIP does not contain MOSA.app"
unzip -tqq "$windows_package" || die "Windows ZIP integrity check failed: $windows_package"
unzip -Z1 "$windows_package" | grep -Fx "MOSA-win32-x64/MOSA.exe" >/dev/null || die "Windows ZIP does not contain MOSA.exe"

mac_name="$(basename "$mac_package")"
windows_name="$(basename "$windows_package")"
mac_size="$(file_size "$mac_package")" || die "could not read macOS ZIP size"
windows_size="$(file_size "$windows_package")" || die "could not read Windows ZIP size"
mac_sha256="$(shasum -a 256 "$mac_package" | awk '{print $1}')"
windows_sha256="$(shasum -a 256 "$windows_package" | awk '{print $1}')"
release_signature="${release_version}|${mac_sha256}|${windows_sha256}"

last_signature=""
if [[ -f "$state_file" ]]; then
  last_signature="$(sed -n '1p' "$state_file")"
fi
if [[ "$last_signature" == "$release_signature" ]]; then
  log "版本 $release_version 已发布，SHA-256 未变化。"
  exit 0
fi

last_version="${last_signature%%|*}"
if [[ "$last_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  if ! node - "$release_version" "$last_version" <<'NODE'
const [left, right] = process.argv.slice(2);
const parse = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split(".") : [] };
};
const compare = (aValue, bValue) => {
  const a = parse(aValue);
  const b = parse(bValue);
  if (!a || !b) return 1;
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  return a.pre.join(".") > b.pre.join(".") ? 1 : -1;
};
process.exit(compare(left, right) >= 0 ? 0 : 1);
NODE
  then
    log "候选版本 $release_version 低于已发布版本 $last_version，跳过降级。"
    exit 0
  fi
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mosa-release.XXXXXX")"
remote_tmp=""
published=0

cleanup() {
  if [[ -n "$remote_tmp" && "$published" -ne 1 ]]; then
    ssh "${ssh_args[@]}" "$ssh_user@$ssh_host" "rm -rf -- '$remote_tmp'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

manifest_file="$temp_dir/latest.json"
published_at="${MOSA_RELEASE_PUBLISHED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
notes_zh="${MOSA_RELEASE_NOTES_ZH:-MOSA ${release_version} 桌面发布包。}"
notes_en="${MOSA_RELEASE_NOTES_EN:-MOSA ${release_version} desktop package.}"

MOSA_MANIFEST_OUTPUT="$manifest_file" \
MOSA_MANIFEST_VERSION="$release_version" \
MOSA_MANIFEST_PUBLISHED_AT="$published_at" \
MOSA_MANIFEST_NOTES_ZH="$notes_zh" \
MOSA_MANIFEST_NOTES_EN="$notes_en" \
MOSA_MANIFEST_MAC_FILE="$mac_name" \
MOSA_MANIFEST_MAC_SIZE="$mac_size" \
MOSA_MANIFEST_MAC_SHA256="$mac_sha256" \
MOSA_MANIFEST_WINDOWS_FILE="$windows_name" \
MOSA_MANIFEST_WINDOWS_SIZE="$windows_size" \
MOSA_MANIFEST_WINDOWS_SHA256="$windows_sha256" \
node -e '
const fs = require("node:fs");
const integer = (name) => Number(process.env[name]);
const manifest = {
  version: process.env.MOSA_MANIFEST_VERSION,
  publishedAt: process.env.MOSA_MANIFEST_PUBLISHED_AT,
  notes: {
    zh: process.env.MOSA_MANIFEST_NOTES_ZH,
    en: process.env.MOSA_MANIFEST_NOTES_EN,
  },
  artifacts: {
    mac: {
      platform: "macOS",
      arch: "arm64",
      file: process.env.MOSA_MANIFEST_MAC_FILE,
      size: integer("MOSA_MANIFEST_MAC_SIZE"),
      sha256: process.env.MOSA_MANIFEST_MAC_SHA256,
    },
    windows: {
      platform: "Windows",
      arch: "x64",
      file: process.env.MOSA_MANIFEST_WINDOWS_FILE,
      size: integer("MOSA_MANIFEST_WINDOWS_SIZE"),
      sha256: process.env.MOSA_MANIFEST_WINDOWS_SHA256,
    },
  },
};
fs.writeFileSync(process.env.MOSA_MANIFEST_OUTPUT, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
'

if [[ "$dry_run" -eq 1 ]]; then
  log "本地校验通过，待发布清单如下："
  sed -n '1,220p' "$manifest_file"
  exit 0
fi

[[ "$remote_dir" == "/var/www/mosa-website" ]] || die "remote directory is fixed at /var/www/mosa-website"
[[ "$ssh_port" =~ ^[0-9]+$ ]] || die "SSH port must be numeric"
[[ -r "$ssh_key" ]] || die "SSH key is not readable: $ssh_key"
[[ -r "$known_hosts" ]] || die "known_hosts is not readable: $known_hosts"
command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v rsync >/dev/null 2>&1 || die "rsync is required"

ssh_args=(
  -i "$ssh_key"
  -p "$ssh_port"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts"
  -o ConnectTimeout=15
  -o ConnectionAttempts=1
)
ssh_target="$ssh_user@$ssh_host"
ssh "${ssh_args[@]}" "$ssh_target" \
  "test -d '$remote_dir' && test -w '$remote_dir' && test -d '$remote_dir/downloads' && test -w '$remote_dir/downloads' && test -d '$remote_dir/releases' && test -w '$remote_dir/releases'" \
  || die "remote MOSA website directories are not writable"

upload_tag="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
remote_tmp="$remote_dir/.mosa-release-$upload_tag"
ssh "${ssh_args[@]}" "$ssh_target" \
  "umask 022; install -d -m 0755 '$remote_tmp'"

rsync_ssh="ssh"
for ssh_arg in "${ssh_args[@]}"; do
  printf -v quoted_ssh_arg '%q' "$ssh_arg"
  rsync_ssh+=" $quoted_ssh_arg"
done

rsync --archive --compress --partial --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$mac_package" "$ssh_target:$remote_tmp/$mac_name"
rsync --archive --compress --partial --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$windows_package" "$ssh_target:$remote_tmp/$windows_name"
rsync --archive --compress --partial --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$manifest_file" "$ssh_target:$remote_tmp/latest.json"

remote_hashes="$(ssh "${ssh_args[@]}" "$ssh_target" \
  "sha256sum '$remote_tmp/$mac_name' '$remote_tmp/$windows_name' | awk '{print \$1}'")"
remote_mac_sha256="$(printf '%s\n' "$remote_hashes" | sed -n '1p')"
remote_windows_sha256="$(printf '%s\n' "$remote_hashes" | sed -n '2p')"
[[ "$remote_mac_sha256" == "$mac_sha256" ]] || die "remote macOS ZIP hash mismatch"
[[ "$remote_windows_sha256" == "$windows_sha256" ]] || die "remote Windows ZIP hash mismatch"

ssh "${ssh_args[@]}" "$ssh_target" \
  "set -eu; install -d -m 0755 '$remote_dir/releases/history'; if [ -f '$remote_dir/releases/latest.json' ]; then cp -f '$remote_dir/releases/latest.json' '$remote_dir/releases/history/latest-$upload_tag.json'; chmod 0644 '$remote_dir/releases/history/latest-$upload_tag.json'; fi; mv -f '$remote_tmp/$mac_name' '$remote_dir/downloads/$mac_name'; mv -f '$remote_tmp/$windows_name' '$remote_dir/downloads/$windows_name'; mv -f '$remote_tmp/latest.json' '$remote_dir/releases/latest.json'; chmod 0644 '$remote_dir/downloads/$mac_name' '$remote_dir/downloads/$windows_name' '$remote_dir/releases/latest.json'; rmdir '$remote_tmp' || true"
published=1

remote_desktop_files="$(ssh "${ssh_args[@]}" "$ssh_target" \
  "find '$remote_dir/downloads' -maxdepth 1 -type f -printf '%f\\n'")"
stale_desktop_pairs="$(printf '%s\n' "$remote_desktop_files" | node "$retention_selector" "$desktop_retention_count")" \
  || die "could not select retained desktop release pairs"

if [[ -n "$stale_desktop_pairs" ]]; then
  removed_desktop_versions=0
  while IFS=$'\t' read -r stale_mac_name stale_windows_name; do
    [[ "$stale_mac_name" =~ ^MOSA-darwin-arm64-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\.zip$ ]] \
      || die "invalid macOS retention filename: $stale_mac_name"
    [[ "$stale_windows_name" =~ ^MOSA-win32-x64-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\.zip$ ]] \
      || die "invalid Windows retention filename: $stale_windows_name"
    ssh "${ssh_args[@]}" "$ssh_target" \
      "rm -f -- '$remote_dir/downloads/$stale_mac_name' '$remote_dir/downloads/$stale_windows_name'"
    ((removed_desktop_versions += 1))
  done <<< "$stale_desktop_pairs"
  log "已清理 $removed_desktop_versions 个超出保留上限的完整桌面版本。"
fi

state_dir="$(dirname "$state_file")"
install -d -m 0700 "$state_dir"
umask 077
printf '%s\n' "$release_signature" > "$state_file"
chmod 0600 "$state_file"

log "已发布 MOSA $release_version：macOS ${mac_size} bytes，Windows ${windows_size} bytes。"
log "SHA-256 已在本机与服务器两端核对。"
