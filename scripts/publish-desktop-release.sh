#!/usr/bin/env bash
set -Eeuo pipefail

# MOSA desktop release publisher.
#
# The release manifest is generated exclusively by the canonical writer in the
# MOSA repository (scripts/prepare-desktop-release-manifest.mjs). This script
# must never hand-build release JSON and must never emit the legacy
# artifacts.* schema — clients and the website both consume platforms.* only.
#
# Publication order is load-bearing:
#   1. upload artifacts into remote staging
#   2. verify remote size/SHA-256 against the local files
#   3. move artifacts into downloads/ and assert every manifest-referenced
#      file exists there
#   4. back up the live latest.json into releases/history/
#   5. atomically replace releases/latest.json (same-filesystem mv)
#
# Release notes are fail-closed: a genuinely new release publishes only when
# MOSA_RELEASE_NOTES_ZH and MOSA_RELEASE_NOTES_EN are both set to non-blank
# text. Same-version no-op and downgrade runs never require notes.

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '[mosa-release] %s\n' "$1"
}

source_root="${MOSA_RELEASE_SOURCE_DIR:-/Users/azhuilab/codex_aigc/mosa/out/make}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
retention_selector="$script_dir/select-desktop-release-retention.mjs"
version_helper="$script_dir/release-version.mjs"
manifest_writer="${MOSA_RELEASE_MANIFEST_WRITER:-/Users/azhuilab/codex_aigc/mosa/scripts/prepare-desktop-release-manifest.mjs}"
manifest_extension="$script_dir/extend-desktop-release-manifest.mjs"
previous_override="${MOSA_RELEASE_PREVIOUS_MANIFEST:-}"
dry_run_output="${MOSA_RELEASE_DRY_RUN_OUTPUT:-}"
desktop_retention_count=4
ssh_host="${MOSA_RELEASE_SSH_HOST:-179.253.232.244}"
ssh_user="${MOSA_RELEASE_SSH_USER:-mosa-deploy}"
ssh_port="${MOSA_RELEASE_SSH_PORT:-22}"
ssh_key="${MOSA_RELEASE_SSH_KEY:-/Users/azhuilab/.ssh/mosa_website_release_monitor}"
known_hosts="${MOSA_RELEASE_KNOWN_HOSTS:-/Users/azhuilab/.ssh/known_hosts}"
remote_dir="${MOSA_RELEASE_REMOTE_DIR:-/var/www/mosa-website}"
state_file="${MOSA_RELEASE_STATE_FILE:-/Users/azhuilab/.config/mosa/desktop-release-monitor.state}"
mac_dmg_package="${MOSA_RELEASE_MAC_DMG:-}"
release_git_sha="${MOSA_RELEASE_GIT_SHA:-}"
dry_run=0

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
[[ "$#" -eq 0 ]] || die "usage: publish-desktop-release.sh [--dry-run]"

[[ -r "$manifest_writer" ]] || die "canonical manifest writer is missing: $manifest_writer"
[[ -r "$manifest_extension" ]] || die "desktop release manifest extension is missing: $manifest_extension"
[[ -r "$retention_selector" ]] || die "desktop retention selector is missing: $retention_selector"
[[ -r "$version_helper" ]] || die "release version helper is missing: $version_helper"
command -v node >/dev/null 2>&1 || die "node is required"
command -v unzip >/dev/null 2>&1 || die "unzip is required"
command -v shasum >/dev/null 2>&1 || die "shasum is required"
command -v stat >/dev/null 2>&1 || die "stat is required"
command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v rsync >/dev/null 2>&1 || die "rsync is required"

# macOS update artifacts are the .zip update packages (the DMG is not part of
# the update protocol). The canonical location is out/make/update/darwin/arm64;
# the forge zip directory is kept as a fallback for older layouts.
mac_source_dirs=()
if [[ -d "$source_root/update/darwin/arm64" ]]; then
  mac_source_dirs+=("$source_root/update/darwin/arm64")
fi
if [[ -d "$source_root/zip/darwin/arm64" ]]; then
  mac_source_dirs+=("$source_root/zip/darwin/arm64")
fi
[[ "${#mac_source_dirs[@]}" -gt 0 ]] || die "missing macOS update ZIP directory below $source_root"

# Windows artifacts are optional. A missing directory simply means the release
# ships macOS-only; an existing directory only ever contributes a package whose
# version matches the selected macOS release exactly.
windows_source_dir=""
if [[ -d "$source_root/zip/win32/x64" ]]; then
  windows_source_dir="$source_root/zip/win32/x64"
fi

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

candidate_pair="$(node --input-type=module - "$version_helper" "$windows_source_dir" "${mac_source_dirs[@]}" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [versionHelper, windowsDir, ...macDirs] = process.argv.slice(2);
const { compareReleaseVersions, parseReleaseVersion } = await import(pathToFileURL(versionHelper).href);

function packages(dir, prefix) {
  if (!dir) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = new RegExp(`^${prefix}(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)\\.zip$`).exec(entry.name);
      if (!match || !parseReleaseVersion(match[1])) return null;
      return { version: match[1], file: path.join(dir, entry.name) };
    })
    .filter(Boolean);
}

const macByVersion = new Map();
for (const dir of macDirs.filter(Boolean)) {
  for (const item of packages(dir, "MOSA-darwin-arm64-")) {
    if (!macByVersion.has(item.version)) macByVersion.set(item.version, item);
  }
}
const macPackages = [...macByVersion.values()];
if (!macPackages.length) process.exit(2);
macPackages.sort((left, right) => compareReleaseVersions(left.version, right.version));
const selected = macPackages[macPackages.length - 1];

// A Windows package rides along only when it carries the exact same version
// as the selected macOS release. Older Windows builds must never be reused,
// and a missing Windows package simply means a macOS-only release.
const windowsPackage = packages(windowsDir, "MOSA-win32-x64-")
  .find((item) => item.version === selected.version) || null;

process.stdout.write(`${selected.version}\t${selected.file}\t${windowsPackage ? windowsPackage.file : ""}`);
NODE
)" || {
  log "未发现新的 macOS 更新 ZIP，本轮跳过。"
  exit 0
}

IFS=$'\t' read -r release_version mac_package windows_package <<< "$candidate_pair"
[[ -n "$release_version" && -f "$mac_package" ]] || die "release candidate is incomplete"
[[ -z "$windows_package" || -f "$windows_package" ]] || die "Windows release candidate is incomplete"

if [[ -z "$mac_dmg_package" ]]; then
  mac_dmg_candidate="$source_root/dmg/darwin/arm64/MOSA-darwin-arm64-${release_version}.dmg"
  [[ -f "$mac_dmg_candidate" ]] && mac_dmg_package="$mac_dmg_candidate"
fi
if [[ -n "$mac_dmg_package" && ! -f "$mac_dmg_package" ]]; then
  die "macOS DMG release candidate is incomplete: $mac_dmg_package"
fi

if ! wait_for_stable_file "$mac_package"; then
  log "macOS 安装包仍在生成，下一次监控周期会重试。"
  exit 1
fi
if [[ -n "$windows_package" ]] && ! wait_for_stable_file "$windows_package"; then
  log "Windows 安装包仍在生成，下一次监控周期会重试。"
  exit 1
fi
if [[ -n "$mac_dmg_package" ]] && ! wait_for_stable_file "$mac_dmg_package"; then
  log "macOS DMG 仍在生成，下一次监控周期会重试。"
  exit 1
fi

unzip -tqq "$mac_package" || die "macOS ZIP integrity check failed: $mac_package"
# Do not use grep -q in a pipe while pipefail is enabled. A successful early
# match makes grep close the pipe, unzip receives SIGPIPE, and the otherwise
# valid archive is reported as a failed pipeline.
unzip -Z1 "$mac_package" | grep -E '^(MOSA\.app/Contents/MacOS/MOSA|MOSA-darwin-arm64/MOSA\.app/Contents/MacOS/MOSA)$' >/dev/null \
  || die "macOS ZIP does not contain MOSA.app"
if [[ -n "$windows_package" ]]; then
  unzip -tqq "$windows_package" || die "Windows ZIP integrity check failed: $windows_package"
  unzip -Z1 "$windows_package" | grep -E '^(MOSA\.exe|MOSA-win32-x64/MOSA\.exe)$' >/dev/null \
    || die "Windows ZIP does not contain MOSA.exe"
fi
if [[ -n "$mac_dmg_package" ]]; then
  command -v hdiutil >/dev/null 2>&1 || die "hdiutil is required for macOS DMG integrity checks"
  hdiutil verify "$mac_dmg_package" >/dev/null || die "macOS DMG integrity check failed: $mac_dmg_package"
  source_repo_root="$(cd -- "$source_root/../.." && pwd)"
  identity_file="$source_repo_root/app/build-identity.json"
  [[ -r "$identity_file" ]] || die "packaged build identity is missing: $identity_file"
  identity_pair="$(node -e '
    const identity = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(`${identity.productVersion}\t${identity.gitSha}`);
  ' "$identity_file")"
  IFS=$'\t' read -r identity_version identity_sha <<< "$identity_pair"
  [[ "$identity_version" == "$release_version" ]] || die "build identity version mismatch: $identity_version"
  [[ "$identity_sha" =~ ^[0-9a-f]{40}$ ]] || die "build identity gitSha is not a full SHA"
  if [[ -n "$release_git_sha" && "$release_git_sha" != "$identity_sha" ]]; then
    die "configured gitSha does not match build identity"
  fi
  release_git_sha="$identity_sha"
fi

mac_name="$(basename "$mac_package")"
mac_size="$(file_size "$mac_package")" || die "could not read macOS package size"
mac_sha256="$(shasum -a 256 "$mac_package" | awk '{print $1}')"
windows_name=""
windows_size=""
windows_sha256=""
if [[ -n "$windows_package" ]]; then
  windows_name="$(basename "$windows_package")"
  windows_size="$(file_size "$windows_package")" || die "could not read Windows package size"
  windows_sha256="$(shasum -a 256 "$windows_package" | awk '{print $1}')"
fi
mac_dmg_name=""
mac_dmg_size=""
mac_dmg_sha256=""
if [[ -n "$mac_dmg_package" ]]; then
  mac_dmg_name="$(basename "$mac_dmg_package")"
  mac_dmg_size="$(file_size "$mac_dmg_package")" || die "could not read macOS DMG size"
  mac_dmg_sha256="$(shasum -a 256 "$mac_dmg_package" | awk '{print $1}')"
fi
if [[ -n "$mac_dmg_package" ]]; then
  release_signature="${release_version}|${mac_sha256}|${windows_sha256:-none}|${mac_dmg_sha256}|${release_git_sha}"
else
  release_signature="${release_version}|${mac_sha256}|${windows_sha256:-none}"
fi

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
  if node "$version_helper" "$release_version" "$last_version"; then
    :
  else
    compare_status="$?"
    if [[ "$compare_status" -eq 1 ]]; then
      log "候选版本 ${release_version} 低于已发布版本 ${last_version}，跳过降级。"
      exit 0
    fi
    die "could not compare release versions: $release_version vs $last_version"
  fi
fi

# A genuinely new release (not a same-version no-op, not a downgrade) must
# carry explicit bilingual release notes. There is deliberately no default
# copy: an unattended monitor run without configured notes fails closed right
# here — before the temp dir, the SSH connection, any upload, any state write,
# and any manifest replacement — instead of publishing placeholder text.
# Previous-release notes are never inherited silently.
notes_zh="${MOSA_RELEASE_NOTES_ZH:-}"
notes_en="${MOSA_RELEASE_NOTES_EN:-}"
if [[ -z "${notes_zh//[[:space:]]/}" || -z "${notes_en//[[:space:]]/}" ]]; then
  die "Release notes are required for a new desktop release: set MOSA_RELEASE_NOTES_ZH and MOSA_RELEASE_NOTES_EN."
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mosa-release.XXXXXX")"
manifest_file="$temp_dir/latest.json"
previous_file="$temp_dir/previous-latest.json"
remote_tmp=""
published=0

[[ "$remote_dir" == "/var/www/mosa-website" ]] || die "remote directory is fixed at /var/www/mosa-website"
[[ "$ssh_port" =~ ^[0-9]+$ ]] || die "SSH port must be numeric"
if [[ "$dry_run" -ne 1 ]]; then
  [[ -r "$ssh_key" ]] || die "SSH key is not readable: $ssh_key"
  [[ -r "$known_hosts" ]] || die "known_hosts is not readable: $known_hosts"
fi

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

cleanup() {
  if [[ -n "$remote_tmp" && "$published" -ne 1 ]]; then
    ssh "${ssh_args[@]}" "$ssh_user@$ssh_host" "rm -rf -- '$remote_tmp'" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

published_at="${MOSA_RELEASE_PUBLISHED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"

if [[ -n "$previous_override" ]]; then
  [[ -r "$previous_override" ]] || die "previous manifest override is not readable: $previous_override"
  cp -f "$previous_override" "$previous_file"
elif [[ "$dry_run" -ne 1 ]]; then
  if ssh "${ssh_args[@]}" "$ssh_target" \
    "if [ -f '$remote_dir/releases/latest.json' ]; then cat '$remote_dir/releases/latest.json'; fi" > "$previous_file"; then
    if [[ -s "$previous_file" ]]; then
      node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));' "$previous_file" \
        || die "current release manifest on the server is not valid JSON"
    else
      rm -f "$previous_file"
      log "线上暂无 latest.json，将生成全新清单。"
    fi
  else
    die "could not read the current release manifest from the server"
  fi
fi

writer_args=(--version "$release_version" --output "$manifest_file" --mac "$mac_package")
[[ -n "$windows_package" ]] && writer_args+=(--windows "$windows_package")
[[ -f "$previous_file" ]] && writer_args+=(--previous "$previous_file")
writer_args+=(--published-at "$published_at" --notes-zh "$notes_zh" --notes-en "$notes_en")
node "$manifest_writer" "${writer_args[@]}" >/dev/null
if [[ -n "$mac_dmg_package" ]]; then
  node "$manifest_extension" \
    --manifest "$manifest_file" \
    --mac-dmg "$mac_dmg_package" \
    --git-sha "$release_git_sha" >/dev/null
fi

# Defense in depth: every platforms.* entry must describe the local artifact
# that is about to be uploaded — right name, right size, right SHA-256.
verify_manifest_artifact() {
  local key="$1" local_file="$2" entry
  [[ -n "$local_file" ]] || return 0
  entry="$(node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const artifact = (manifest.platforms || {})[process.argv[2]];
    if (!artifact || typeof artifact !== "object") {
      console.error(`missing platforms.${process.argv[2]} entry in generated manifest`);
      process.exit(1);
    }
    process.stdout.write(`${artifact.file}\t${artifact.size}\t${artifact.sha256}`);
  ' "$manifest_file" "$key")" || die "generated manifest is missing the $key platform entry"
  local entry_file entry_size entry_sha
  IFS=$'\t' read -r entry_file entry_size entry_sha <<< "$entry"
  [[ "$entry_file" == "$(basename "$local_file")" ]] || die "$key artifact filename mismatch: $entry_file"
  [[ "$entry_size" == "$(file_size "$local_file")" ]] || die "$key artifact size mismatch for $entry_file"
  [[ "$entry_sha" == "$(shasum -a 256 "$local_file" | awk '{print $1}')" ]] || die "$key artifact SHA-256 mismatch for $entry_file"
}
verify_manifest_artifact "macos" "$mac_package"
verify_manifest_artifact "windows" "$windows_package"
if [[ -n "$mac_dmg_package" ]]; then
  : "DMG metadata was validated by the manifest extension and by the local/remote hash checks."
fi

node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const expectedSha = process.argv[2];
  if (expectedSha && manifest.gitSha !== expectedSha) {
    console.error(`manifest gitSha mismatch: ${manifest.gitSha || "(missing)"}`);
    process.exit(1);
  }
  const expectedKeys = ["arch", "file", "platform", "sha256", "size"];
  for (const [name, artifact] of Object.entries(manifest.platforms || {})) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      console.error(`invalid platforms.${name} entry`);
      process.exit(1);
    }
    const actualKeys = Object.keys(artifact).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
      console.error(`platforms.${name} schema drift: ${actualKeys.join(",")}`);
      process.exit(1);
    }
  }
' "$manifest_file" "$release_git_sha" || die "generated manifest schema or gitSha validation failed"

# The generated manifest must never carry legacy artifacts.* data.
node -e '
  const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if ("artifacts" in manifest) {
    console.error("generated manifest still contains legacy artifacts.* data");
    process.exit(1);
  }
' "$manifest_file" || die "generated manifest contains legacy artifacts.* data"

referenced_files="$(node -e '
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const artifact of Object.values(manifest.platforms || {})) {
    if (artifact && typeof artifact.file === "string") process.stdout.write(`${artifact.file}\n`);
  }
' "$manifest_file")"
while IFS= read -r referenced_file; do
  [[ -n "$referenced_file" ]] || continue
  [[ "$referenced_file" =~ ^MOSA-(darwin-arm64|win32-x64)-[0-9A-Za-z.-]+\.zip$ ]] \
    || die "manifest references an unexpected artifact name: $referenced_file"
done <<< "$referenced_files"

if [[ "$dry_run" -eq 1 ]]; then
  log "本地校验通过，待发布清单如下："
  cat "$manifest_file"
  if [[ -n "$dry_run_output" ]]; then
    mkdir -p "$(dirname "$dry_run_output")"
    cp -f "$manifest_file" "$dry_run_output"
    log "dry-run 清单已写入 $dry_run_output"
  fi
  exit 0
fi

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
[[ -n "$windows_package" ]] && rsync --archive --compress --partial --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$windows_package" "$ssh_target:$remote_tmp/$windows_name"
[[ -n "$mac_dmg_package" ]] && rsync --archive --compress --partial --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$mac_dmg_package" "$ssh_target:$remote_tmp/$mac_dmg_name"
rsync --archive --compress --human-readable --chmod=Fu=rw,Fgo=r \
  -e "$rsync_ssh" \
  "$manifest_file" "$ssh_target:$remote_tmp/latest.json"

uploaded_names=("$mac_name")
uploaded_shas=("$mac_sha256")
[[ -n "$windows_package" ]] && uploaded_names+=("$windows_name") && uploaded_shas+=("$windows_sha256")
[[ -n "$mac_dmg_package" ]] && uploaded_names+=("$mac_dmg_name") && uploaded_shas+=("$mac_dmg_sha256")
for index in "${!uploaded_names[@]}"; do
  remote_hash="$(ssh "${ssh_args[@]}" "$ssh_target" \
    "sha256sum '$remote_tmp/${uploaded_names[$index]}' | awk '{print \$1}'")"
  [[ "$remote_hash" == "${uploaded_shas[$index]}" ]] \
    || die "remote ${uploaded_names[$index]} hash mismatch: $remote_hash"
done

# referenced_files entries are strictly regex-validated above, so embedding
# them in the remote command is safe.
remote_referenced=""
while IFS= read -r referenced_file; do
  [[ -n "$referenced_file" ]] || continue
  remote_referenced+=" $referenced_file"
done <<< "$referenced_files"
[[ -n "$mac_dmg_name" ]] && remote_referenced+=" $mac_dmg_name"

ssh "${ssh_args[@]}" "$ssh_target" \
  "set -eu; install -d -m 0755 '$remote_dir/releases/history'; mv -f '$remote_tmp/$mac_name' '$remote_dir/downloads/$mac_name'; if [ -n '$windows_name' ]; then mv -f '$remote_tmp/$windows_name' '$remote_dir/downloads/$windows_name'; fi; if [ -n '$mac_dmg_name' ]; then mv -f '$remote_tmp/$mac_dmg_name' '$remote_dir/downloads/$mac_dmg_name'; fi; for referenced in$remote_referenced; do test -f \"$remote_dir/downloads/\$referenced\" || { echo \"missing artifact on server: \$referenced\" >&2; exit 1; }; done; if [ -f '$remote_dir/releases/latest.json' ]; then cp -f '$remote_dir/releases/latest.json' '$remote_dir/releases/history/latest-$upload_tag.json'; chmod 0644 '$remote_dir/releases/history/latest-$upload_tag.json'; fi; mv -f '$remote_tmp/latest.json' '$remote_dir/releases/latest.json'; chmod 0644 '$remote_dir/downloads/$mac_name' '$remote_dir/releases/latest.json'; if [ -n '$windows_name' ]; then chmod 0644 '$remote_dir/downloads/$windows_name'; fi; if [ -n '$mac_dmg_name' ]; then chmod 0644 '$remote_dir/downloads/$mac_dmg_name'; fi; rmdir '$remote_tmp' || true"
published=1

remote_desktop_files="$(ssh "${ssh_args[@]}" "$ssh_target" \
  "find '$remote_dir/downloads' -maxdepth 1 -type f -printf '%f\\n'")"
stale_desktop_pairs="$(printf '%s\n' "$remote_desktop_files" | node "$retention_selector" "$desktop_retention_count")" \
  || die "could not select retained desktop release pairs"

if [[ -n "$stale_desktop_pairs" ]]; then
  removed_desktop_versions=0
  while IFS=$'\t' read -r stale_mac_name stale_windows_name; do
    [[ "$stale_mac_name" =~ ^MOSA-darwin-arm64-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\.(dmg|zip)$ ]] \
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

log "已发布 MOSA ${release_version}：macOS update ${mac_size} bytes${mac_dmg_package:+，DMG ${mac_dmg_size} bytes}${windows_package:+，Windows ${windows_size} bytes}。"
log "SHA-256 已在本机与服务器两端核对；清单由 canonical writer 生成。"
