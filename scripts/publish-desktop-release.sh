#!/usr/bin/env bash
set -Eeuo pipefail

# MOSA desktop release publisher.
#
# The release manifest is generated exclusively by the canonical writer in the
# MOSA repository (scripts/prepare-desktop-release-manifest.mjs). This script
# must never hand-build release JSON and must never emit the legacy
# artifacts.* schema — clients and the website both consume platforms.* only.
#
# Publication order is load-bearing (Cloudflare R2 is the only target):
#   1. upload artifacts into downloads/ and verify each size on R2
#   2. assert every manifest-referenced file exists there
#   3. copy the live manifest into the history directory
#   4. replace the live manifest last, so a reader never sees a manifest that
#      points at a package that is not there yet
#   5. prune older desktop release pairs (retention)
#
# MOSA_RELEASE_TARGETS is optional: unset or "r2" publishes to R2. The legacy
# server target was retired in 279 (C1); any other value fails before anything
# is read or uploaded.
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

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The app repository is checked out next to this one (../gravityport).
app_repo_dir="$(cd -- "$script_dir/../.." && pwd)/gravityport"

# Machine-specific settings — the deploy host and user above all — live in a
# local file outside the repository, one KEY=value per line. Variables already
# set in the environment always win, so tests and one-off runs are unaffected.
release_config="${MOSA_RELEASE_CONFIG:-$HOME/.config/mosa/release.env}"
if [[ -r "$release_config" ]]; then
  while IFS='=' read -r config_key config_value || [[ -n "$config_key" ]]; do
    [[ "$config_key" =~ ^MOSA_RELEASE_[A-Z0-9_]+$ ]] || continue
    [[ -n "${!config_key:-}" ]] && continue
    export "$config_key=$config_value"
  done < "$release_config"
fi

source_root="${MOSA_RELEASE_SOURCE_DIR:-$app_repo_dir/out/make}"
retention_selector="$script_dir/select-desktop-release-retention.mjs"
version_helper="$script_dir/release-version.mjs"
manifest_writer="${MOSA_RELEASE_MANIFEST_WRITER:-$app_repo_dir/scripts/prepare-desktop-release-manifest.mjs}"
manifest_extension="$script_dir/extend-desktop-release-manifest.mjs"
previous_override="${MOSA_RELEASE_PREVIOUS_MANIFEST:-}"
dry_run_output="${MOSA_RELEASE_DRY_RUN_OUTPUT:-}"
desktop_retention_count=4
state_file="${MOSA_RELEASE_STATE_FILE:-$HOME/.config/mosa/desktop-release-monitor.state}"
mac_dmg_package="${MOSA_RELEASE_MAC_DMG:-}"
windows_installer_package="${MOSA_RELEASE_WINDOWS_INSTALLER:-}"
release_git_sha="${MOSA_RELEASE_GIT_SHA:-}"
dry_run=0

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
  shift
fi
[[ "$#" -eq 0 ]] || die "usage: publish-desktop-release.sh [--dry-run]"

# The publisher ships exactly one product per run: GravityPort (default, the
# live update source) or MOSA (frozen old update source). Everything below —
# artifact prefixes, package payload checks, writer arguments, manifest and
# history paths, retention — derives from this single switch, so a mixed
# MOSA/GravityPort release can never happen by accident.
release_product="${MOSA_RELEASE_PRODUCT:-GravityPort}"
case "$release_product" in
  MOSA)
    mac_app_name="MOSA"
    mac_app_bundle_name="MOSA.app"
    windows_payload_exe_name="MOSA.exe"
    remote_manifest_path="releases/latest.json"
    remote_history_dir="releases/history"
    ;;
  GravityPort)
    mac_app_name="GravityPort"
    mac_app_bundle_name="GravityPort.app"
    windows_payload_exe_name="GravityPort.exe"
    remote_manifest_path="releases/gravityport/latest.json"
    remote_history_dir="releases/gravityport/history"
    ;;
  *)
    die "MOSA_RELEASE_PRODUCT must be \"MOSA\" or \"GravityPort\" (got: ${release_product})."
    ;;
esac

# Each product remembers its own last published release. Sharing one state
# file would make a later MOSA run look like a downgrade next to a newer
# GravityPort version and skip it silently. MOSA keeps the historical path.
if [[ "$release_product" == "GravityPort" && -z "${MOSA_RELEASE_STATE_FILE:-}" ]]; then
  state_file="$HOME/.config/mosa/desktop-release-monitor.gravityport.state"
fi

# Publication target. Cloudflare R2 is the only one: MOSA_RELEASE_TARGETS may be
# unset or "r2". The old server target is retired (279 C1) and is refused here.
case "${MOSA_RELEASE_TARGETS:-r2}" in
  r2|R2) ;;
  *)
    die "旧服务器已停用，只支持 r2（MOSA_RELEASE_TARGETS 不设或设为 r2；当前值：${MOSA_RELEASE_TARGETS})。"
    ;;
esac

r2_client="$script_dir/r2-client.mjs"
r2_endpoint="${MOSA_RELEASE_R2_ENDPOINT:-}"
r2_bucket="${MOSA_RELEASE_R2_BUCKET:-gravityport-releases}"
r2_access_key_id="${MOSA_RELEASE_R2_ACCESS_KEY_ID:-}"
r2_keychain_item="gravityport-r2-release"

# Lists the names of the R2 settings that are missing, printing only names —
# never values. The secret may live in the login keychain instead of the
# environment, so its presence is probed without printing anything.
r2_missing_config() {
  local missing=""
  [[ -n "$r2_endpoint" ]] || missing+=" MOSA_RELEASE_R2_ENDPOINT"
  [[ -n "$r2_bucket" ]] || missing+=" MOSA_RELEASE_R2_BUCKET"
  [[ -n "$r2_access_key_id" ]] || missing+=" MOSA_RELEASE_R2_ACCESS_KEY_ID"
  if [[ -z "${MOSA_RELEASE_R2_SECRET_ACCESS_KEY:-}" ]]; then
    security find-generic-password -s "$r2_keychain_item" -w >/dev/null 2>&1 \
      || missing+=" MOSA_RELEASE_R2_SECRET_ACCESS_KEY(或钥匙串条目 $r2_keychain_item)"
  fi
  printf '%s' "$missing"
}

[[ -r "$r2_client" ]] || die "R2 client is missing: $r2_client"
r2_missing="$(r2_missing_config)"
[[ -z "$r2_missing" ]] || die "the r2 target is not configured, missing:${r2_missing}"

[[ -r "$manifest_writer" ]] || die "canonical manifest writer is missing: $manifest_writer"
[[ -r "$manifest_extension" ]] || die "desktop release manifest extension is missing: $manifest_extension"
[[ -r "$retention_selector" ]] || die "desktop retention selector is missing: $retention_selector"
[[ -r "$version_helper" ]] || die "release version helper is missing: $version_helper"
command -v node >/dev/null 2>&1 || die "node is required"
command -v unzip >/dev/null 2>&1 || die "unzip is required"
command -v shasum >/dev/null 2>&1 || die "shasum is required"
command -v stat >/dev/null 2>&1 || die "stat is required"

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

candidate_status=0
candidate_pair="$(node --input-type=module - "$version_helper" "$windows_source_dir" "$release_product" "${mac_source_dirs[@]}" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [versionHelper, windowsDir, product, ...macDirs] = process.argv.slice(2);
const { compareReleaseVersions, parseReleaseVersion } = await import(pathToFileURL(versionHelper).href);

const macPrefix = `${product}-darwin-arm64-`;
const windowsPrefix = `${product}-win32-x64-`;

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
  for (const item of packages(dir, macPrefix)) {
    if (!macByVersion.has(item.version)) macByVersion.set(item.version, item);
  }
}
const macPackages = [...macByVersion.values()];
if (!macPackages.length) {
  // Fail loudly when the source tree only holds the other product update
  // packages — "no package found" would send the operator chasing the wrong
  // problem (a GravityPort run pointed at MOSA builds, or vice versa). An
  // empty source tree stays a quiet skip so the monitor can keep polling.
  const otherProduct = product === "MOSA" ? "GravityPort" : "MOSA";
  const otherMacPrefix = `${otherProduct}-darwin-arm64-`;
  for (const dir of macDirs.filter(Boolean)) {
    if (fs.readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isFile() && entry.name.startsWith(otherMacPrefix) && entry.name.endsWith(".zip"),
    )) {
      process.stdout.write(otherProduct);
      process.exit(3);
    }
  }
  process.exit(2);
}
macPackages.sort((left, right) => compareReleaseVersions(left.version, right.version));
const selected = macPackages[macPackages.length - 1];

// A Windows package rides along only when it carries the exact same version
// as the selected macOS release. Older Windows builds must never be reused,
// and a missing Windows package simply means a macOS-only release. The
// product prefix filter keeps MOSA leftovers from riding a GravityPort
// release and the other way around.
const windowsPackage = packages(windowsDir, windowsPrefix)
  .find((item) => item.version === selected.version) || null;

process.stdout.write(`${selected.version}\t${selected.file}\t${windowsPackage ? windowsPackage.file : ""}`);
NODE
)" || candidate_status=$?
if [[ "$candidate_status" -eq 3 ]]; then
  die "源目录 ${source_root} 中只发现 ${candidate_pair} 的 macOS 更新包，与 MOSA_RELEASE_PRODUCT=${release_product} 不匹配；请改用 MOSA_RELEASE_PRODUCT=${candidate_pair} 或指向正确的源目录。"
fi
if [[ "$candidate_status" -ne 0 ]]; then
  log "未发现新的 macOS 更新 ZIP，本轮跳过。"
  exit 0
fi

IFS=$'\t' read -r release_version mac_package windows_package <<< "$candidate_pair"
[[ -n "$release_version" && -f "$mac_package" ]] || die "release candidate is incomplete"
[[ -z "$windows_package" || -f "$windows_package" ]] || die "Windows release candidate is incomplete"

if [[ -z "$mac_dmg_package" ]]; then
  mac_dmg_candidate="$source_root/dmg/darwin/arm64/${release_product}-darwin-arm64-${release_version}.dmg"
  [[ -f "$mac_dmg_candidate" ]] && mac_dmg_package="$mac_dmg_candidate"
fi
if [[ -n "$mac_dmg_package" && ! -f "$mac_dmg_package" ]]; then
  die "macOS DMG release candidate is incomplete: $mac_dmg_package"
fi

# The Windows installer the website offers for first installs ships with the
# update ZIP of the same version. The build writes it to installer/win32/x64;
# an unpacked CI artifact may also leave it next to the ZIP.
if [[ -z "$windows_installer_package" && -n "$windows_package" ]]; then
  windows_installer_file="${release_product}-win32-x64-${release_version}.exe"
  for windows_installer_candidate in \
    "$source_root/installer/win32/x64/$windows_installer_file" \
    "$(dirname "$windows_package")/$windows_installer_file"; do
    if [[ -f "$windows_installer_candidate" ]]; then
      windows_installer_package="$windows_installer_candidate"
      break
    fi
  done
fi
if [[ -n "$windows_installer_package" ]]; then
  [[ -n "$windows_package" ]] || die "a Windows installer ships with its update ZIP, and there is no ${release_product}-win32-x64-${release_version}.zip"
  [[ -f "$windows_installer_package" ]] || die "Windows installer release candidate is incomplete: $windows_installer_package"
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
if [[ -n "$windows_installer_package" ]] && ! wait_for_stable_file "$windows_installer_package"; then
  log "Windows 安装程序仍在生成，下一次监控周期会重试。"
  exit 1
fi

unzip -tqq "$mac_package" || die "macOS ZIP integrity check failed: $mac_package"
# Do not use grep -q in a pipe while pipefail is enabled. A successful early
# match makes grep close the pipe, unzip receives SIGPIPE, and the otherwise
# valid archive is reported as a failed pipeline.
unzip -Z1 "$mac_package" | grep -E "^(${mac_app_name}\.app/Contents/MacOS/${mac_app_name}|${release_product}-darwin-arm64/${mac_app_name}\.app/Contents/MacOS/${mac_app_name})$" >/dev/null \
  || die "macOS ZIP does not contain ${mac_app_bundle_name}"
if [[ -n "$windows_package" ]]; then
  unzip -tqq "$windows_package" || die "Windows ZIP integrity check failed: $windows_package"
  unzip -Z1 "$windows_package" | grep -E "^(${windows_payload_exe_name}|${release_product}-win32-x64/${windows_payload_exe_name})$" >/dev/null \
    || die "Windows ZIP does not contain ${windows_payload_exe_name}"
fi
if [[ -n "$windows_installer_package" ]]; then
  [[ "$(head -c 2 "$windows_installer_package")" == "MZ" ]] \
    || die "Windows installer is not a Windows program: $windows_installer_package"
fi
if [[ -n "$mac_dmg_package" ]]; then
  command -v hdiutil >/dev/null 2>&1 || die "hdiutil is required for macOS DMG integrity checks"
  hdiutil verify "$mac_dmg_package" >/dev/null || die "macOS DMG integrity check failed: $mac_dmg_package"
  source_repo_root="$(cd -- "$source_root/../.." && pwd)"
  # The shared UI build writes its identity next to the built bundle
  # (web/gravityport/dist); web/app is the layout older app trees used.
  identity_file="$source_repo_root/web/gravityport/dist/build-identity.json"
  [[ -r "$identity_file" ]] || identity_file="$source_repo_root/web/app/build-identity.json"
  [[ -r "$identity_file" ]] || die "packaged build identity is missing: $source_repo_root/web/gravityport/dist/build-identity.json"
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
windows_installer_name=""
windows_installer_size=""
windows_installer_sha256=""
if [[ -n "$windows_installer_package" ]]; then
  windows_installer_name="$(basename "$windows_installer_package")"
  windows_installer_size="$(file_size "$windows_installer_package")" || die "could not read Windows installer size"
  windows_installer_sha256="$(shasum -a 256 "$windows_installer_package" | awk '{print $1}')"
fi
if [[ -n "$mac_dmg_package" ]]; then
  release_signature="${release_version}|${mac_sha256}|${windows_sha256:-none}|${mac_dmg_sha256}|${release_git_sha}"
else
  release_signature="${release_version}|${mac_sha256}|${windows_sha256:-none}"
fi
# Appended only when present, so the signature of a release without an
# installer stays what earlier runs recorded.
if [[ -n "$windows_installer_package" ]]; then
  release_signature+="|installer:${windows_installer_sha256}"
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
# here — before the temp dir, any upload, any state write, and any manifest
# replacement — instead of publishing placeholder text.
# Previous-release notes are never inherited silently.
notes_zh="${MOSA_RELEASE_NOTES_ZH:-}"
notes_en="${MOSA_RELEASE_NOTES_EN:-}"
if [[ -z "${notes_zh//[[:space:]]/}" || -z "${notes_en//[[:space:]]/}" ]]; then
  die "Release notes are required for a new desktop release: set MOSA_RELEASE_NOTES_ZH and MOSA_RELEASE_NOTES_EN."
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mosa-release.XXXXXX")"
manifest_file="$temp_dir/latest.json"
previous_file="$temp_dir/previous-latest.json"

cleanup() {
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

published_at="${MOSA_RELEASE_PUBLISHED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"

# r2 get wrapper: exits 0 with status 200, returns 1 for a 404 (object
# absent), and dies on any transport or other HTTP failure.
r2_get_to_file() {
  local r2_get_json r2_get_status
  r2_get_json="$(node "$r2_client" get "$1" "$2")" || die "R2 读取失败: $1"
  r2_get_status="$(node -pe 'JSON.parse(process.argv[1]).status' "$r2_get_json")" \
    || die "R2 get 输出无法解析: $1"
  [[ "$r2_get_status" == "200" ]]
}

# r2 head wrapper: echoes "<status>\t<size>" (size empty when absent).
r2_head_status_size() {
  node "$r2_client" head "$1" | node -e '
    const parsed = JSON.parse(require("node:fs").readFileSync(0, "utf8").trim());
    process.stdout.write(`${parsed.status}\t${parsed.size === null ? "" : parsed.size}`);
  '
}

if [[ -n "$previous_override" ]]; then
  [[ -r "$previous_override" ]] || die "previous manifest override is not readable: $previous_override"
  cp -f "$previous_override" "$previous_file"
elif [[ "$dry_run" -ne 1 ]]; then
  # The manifest on R2 is the previous release; a missing one is a first release.
  if r2_get_to_file "$remote_manifest_path" "$previous_file"; then
    node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));' "$previous_file" \
      || die "current release manifest on R2 is not valid JSON"
  else
    rm -f "$previous_file"
    log "R2 上暂无 latest.json，将生成全新清单。"
  fi
fi

writer_args=(--version "$release_version" --output "$manifest_file" --mac "$mac_package" --mac-app-name "$mac_app_bundle_name")
[[ -n "$windows_package" ]] && writer_args+=(--windows "$windows_package" --windows-payload-exe-name "$windows_payload_exe_name")
[[ -n "$windows_installer_package" ]] && writer_args+=(--windows-installer "$windows_installer_package")
[[ -f "$previous_file" ]] && writer_args+=(--previous "$previous_file")
writer_args+=(--published-at "$published_at" --notes-zh "$notes_zh" --notes-en "$notes_en")
# Optional signing-metadata passthrough for the canonical writer. Unset
# variables must not reach the writer at all, so the manifest stays byte-for-
# byte identical to a run without them.
[[ -n "${MOSA_RELEASE_MAC_TEAM_IDENTIFIER:-}" ]] && writer_args+=(--mac-team-identifier "${MOSA_RELEASE_MAC_TEAM_IDENTIFIER}")
[[ -n "${MOSA_RELEASE_WINDOWS_SIGNER_THUMBPRINT:-}" ]] && writer_args+=(--windows-signer-thumbprint "${MOSA_RELEASE_WINDOWS_SIGNER_THUMBPRINT}")
node "$manifest_writer" "${writer_args[@]}" >/dev/null
if [[ -n "$mac_dmg_package" ]]; then
  node "$manifest_extension" \
    --manifest "$manifest_file" \
    --mac-dmg "$mac_dmg_package" \
    --dmg-file "${release_product}-darwin-arm64-${release_version}.dmg" \
    --git-sha "$release_git_sha" >/dev/null
fi

# Defense in depth: every platforms.* entry must describe the local artifact
# that is about to be uploaded — right name, right size, right SHA-256. The
# key may name a nested entry (windows.installer).
verify_manifest_artifact() {
  local key="$1" local_file="$2" entry
  [[ -n "$local_file" ]] || return 0
  entry="$(node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const artifact = process.argv[2].split(".").reduce(
      (value, name) => (value && typeof value === "object" ? value[name] : undefined),
      manifest.platforms || {},
    );
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
verify_manifest_artifact "windows.installer" "$windows_installer_package"
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
  // The current canonical writer always records the payload names (appName /
  // payloadExeName) and may add the optional signing metadata (teamIdentifier
  // / signerThumbprint); older writers emit the bare five keys. Accept both
  // shapes, but never anything outside this set.
  const baseKeys = ["arch", "file", "platform", "sha256", "size"];
  const allowedKeys = {
    macos: [...baseKeys, "appName", "teamIdentifier"],
    windows: [...baseKeys, "payloadExeName", "signerThumbprint", "installer"],
  };
  for (const [name, artifact] of Object.entries(manifest.platforms || {})) {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      console.error(`invalid platforms.${name} entry`);
      process.exit(1);
    }
    const allowed = allowedKeys[name] || baseKeys;
    const actualKeys = Object.keys(artifact);
    for (const key of actualKeys) {
      if (!allowed.includes(key)) {
        console.error(`platforms.${name} has unexpected key: ${key}`);
        process.exit(1);
      }
    }
    for (const key of baseKeys) {
      if (!actualKeys.includes(key)) {
        console.error(`platforms.${name} is missing required key: ${key}`);
        process.exit(1);
      }
    }
  }
  // The Windows installer (first installs) names exactly one file.
  const installer = (manifest.platforms || {}).windows?.installer;
  if (installer !== undefined) {
    const keys = installer && typeof installer === "object" && !Array.isArray(installer) ? Object.keys(installer).sort().join(",") : "";
    if (keys !== "file,sha256,size") {
      console.error(`platforms.windows.installer must carry exactly file, size and sha256 (got: ${keys || typeof installer})`);
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
    if (artifact && artifact.installer && typeof artifact.installer.file === "string") process.stdout.write(`${artifact.installer.file}\n`);
  }
' "$manifest_file")"
while IFS= read -r referenced_file; do
  [[ -n "$referenced_file" ]] || continue
  [[ "$referenced_file" =~ ^${release_product}-((darwin-arm64|win32-x64)-[0-9A-Za-z.-]+\.zip|win32-x64-[0-9A-Za-z.-]+\.exe)$ ]] \
    || die "manifest references an unexpected artifact name: $referenced_file"
done <<< "$referenced_files"

if [[ "$dry_run" -eq 1 ]]; then
  log "R2 dry-run 检查（不发送任何写请求）："
  r2_missing="$(r2_missing_config)"
  if [[ -n "$r2_missing" ]]; then
    log "R2 配置不完整，缺:${r2_missing}"
  else
    log "R2 配置齐。"
    log "R2 待上传对象:"
    log "  downloads/$mac_name"
    [[ -n "$windows_name" ]] && log "  downloads/$windows_name"
    [[ -n "$mac_dmg_name" ]] && log "  downloads/$mac_dmg_name"
    [[ -n "$windows_installer_name" ]] && log "  downloads/$windows_installer_name"
    log "  ${remote_manifest_path}（最后上传）"
    # The retention preview is a read-only list; a failure here only skips
    # the preview and never fails the dry-run.
    if r2_downloads_files="$(node "$r2_client" list "downloads/" 2>/dev/null | node -e '
      const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) process.stdout.write(`${JSON.parse(line).key.replace(/^downloads\//, "")}\n`);
    ')"; then
      r2_stale_preview="$(printf '%s\n' "$r2_downloads_files" | node "$retention_selector" "$desktop_retention_count" "$release_product" 2>/dev/null)" || r2_stale_preview=""
      if [[ -n "$r2_stale_preview" ]]; then
        log "R2 清理将删除（保留 ${desktop_retention_count} 版）："
        while IFS=$'\t' read -r preview_mac preview_windows preview_installer; do
          log "  downloads/$preview_mac"
          log "  downloads/$preview_windows"
          [[ -n "$preview_installer" ]] && log "  downloads/$preview_installer"
        done <<< "$r2_stale_preview"
      else
        log "R2 无需清理。"
      fi
    else
      log "R2 列举 downloads/ 失败，跳过清理预览。"
    fi
  fi
  log "本地校验通过，待发布清单如下："
  cat "$manifest_file"
  if [[ -n "$dry_run_output" ]]; then
    mkdir -p "$(dirname "$dry_run_output")"
    cp -f "$manifest_file" "$dry_run_output"
    log "dry-run 清单已写入 $dry_run_output"
  fi
  exit 0
fi

# One timestamp label per run, so this run's history backup gets a unique name.
upload_tag="$(date -u '+%Y%m%dT%H%M%SZ')-$$"

r2_upload_names=("$mac_name")
r2_upload_files=("$mac_package")
[[ -n "$windows_package" ]] && r2_upload_names+=("$windows_name") && r2_upload_files+=("$windows_package")
[[ -n "$mac_dmg_package" ]] && r2_upload_names+=("$mac_dmg_name") && r2_upload_files+=("$mac_dmg_package")
[[ -n "$windows_installer_package" ]] && r2_upload_names+=("$windows_installer_name") && r2_upload_files+=("$windows_installer_package")

# --- R2 target -------------------------------------------------------------
# Packages are uploaded and size-verified first, every manifest-referenced
# artifact is asserted present, the previous manifest is copied into history,
# and only then does the new manifest replace the old one. R2 object
# replacement is atomic, so a reader never sees a manifest that points at a
# package that is not there yet. Any failure here exits non-zero before the
# manifest is replaced, so the run can simply be repeated.
log "开始发布到 R2。"
for index in "${!r2_upload_names[@]}"; do
  r2_name="${r2_upload_names[$index]}"
  r2_file="${r2_upload_files[$index]}"
  node "$r2_client" put "$r2_file" "downloads/$r2_name" >/dev/null \
    || die "R2 上传失败: downloads/$r2_name"
  r2_pair="$(r2_head_status_size "downloads/$r2_name")" || die "R2 核对失败: downloads/$r2_name"
  IFS=$'\t' read -r r2_status r2_size <<< "$r2_pair"
  [[ "$r2_status" == "200" ]] || die "R2 缺少刚上传的包: downloads/$r2_name (HTTP $r2_status)"
  [[ "$r2_size" == "$(file_size "$r2_file")" ]] || die "R2 上 downloads/$r2_name 的大小与本地不一致"
  log "R2 已上传 downloads/${r2_name}（${r2_size} bytes）。"
done

while IFS= read -r r2_referenced; do
  [[ -n "$r2_referenced" ]] || continue
  r2_pair="$(r2_head_status_size "downloads/$r2_referenced")" || die "R2 核对失败: downloads/$r2_referenced"
  IFS=$'\t' read -r r2_status r2_size <<< "$r2_pair"
  [[ "$r2_status" == "200" ]] || die "R2 缺少清单引用的文件: downloads/$r2_referenced"
done <<< "$referenced_files"
if [[ -n "$mac_dmg_name" ]]; then
  r2_pair="$(r2_head_status_size "downloads/$mac_dmg_name")" || die "R2 核对失败: downloads/$mac_dmg_name"
  IFS=$'\t' read -r r2_status r2_size <<< "$r2_pair"
  [[ "$r2_status" == "200" ]] || die "R2 缺少 DMG 包: downloads/$mac_dmg_name"
fi

r2_pair="$(r2_head_status_size "$remote_manifest_path")" || die "R2 核对失败: $remote_manifest_path"
IFS=$'\t' read -r r2_status r2_size <<< "$r2_pair"
if [[ "$r2_status" == "200" ]]; then
  node "$r2_client" copy "$remote_manifest_path" "$remote_history_dir/latest-$upload_tag.json" >/dev/null \
    || die "R2 清单备份失败: $remote_history_dir/latest-$upload_tag.json"
else
  log "R2 上暂无现有清单，跳过 history 备份。"
fi
node "$r2_client" put "$manifest_file" "$remote_manifest_path" >/dev/null \
  || die "R2 清单上传失败: $remote_manifest_path"
log "R2 清单已更新: $remote_manifest_path"

# Retention only names complete desktop pairs of this product, so extension
# ZIPs, the other product's packages and unpaired files can never be deleted.
r2_downloads_files="$(node "$r2_client" list "downloads/" | node -e '
  const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
  for (const line of lines) process.stdout.write(`${JSON.parse(line).key.replace(/^downloads\//, "")}\n`);
')" || die "R2 列举 downloads/ 失败"
r2_stale_pairs="$(printf '%s\n' "$r2_downloads_files" | node "$retention_selector" "$desktop_retention_count" "$release_product")" \
  || die "could not select R2 retained desktop release pairs"
if [[ -n "$r2_stale_pairs" ]]; then
  r2_removed_versions=0
  while IFS=$'\t' read -r r2_stale_mac r2_stale_windows r2_stale_installer; do
    [[ "$r2_stale_mac" =~ ^${release_product}-darwin-arm64-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\.(dmg|zip)$ ]] \
      || die "invalid macOS R2 retention filename: $r2_stale_mac"
    [[ "$r2_stale_windows" =~ ^${release_product}-win32-x64-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?\.zip$ ]] \
      || die "invalid Windows R2 retention filename: $r2_stale_windows"
    node "$r2_client" delete "downloads/$r2_stale_mac" >/dev/null || die "R2 删除失败: downloads/$r2_stale_mac"
    node "$r2_client" delete "downloads/$r2_stale_windows" >/dev/null || die "R2 删除失败: downloads/$r2_stale_windows"
    if [[ -n "$r2_stale_installer" ]]; then
      node "$r2_client" delete "downloads/$r2_stale_installer" >/dev/null || die "R2 删除失败: downloads/$r2_stale_installer"
    fi
    r2_removed_versions=$((r2_removed_versions + 1))
  done <<< "$r2_stale_pairs"
  log "R2 已清理 $r2_removed_versions 个超出保留上限的完整桌面版本。"
fi

state_dir="$(dirname "$state_file")"
install -d -m 0700 "$state_dir"
umask 077
printf '%s\n' "$release_signature" > "$state_file"
chmod 0600 "$state_file"

log "已发布 ${release_product} ${release_version}：macOS update ${mac_size} bytes${mac_dmg_package:+，DMG ${mac_dmg_size} bytes}${windows_package:+，Windows ${windows_size} bytes}${windows_installer_package:+，Windows 安装程序 ${windows_installer_size} bytes}。"
log "SHA-256 已在本机核对，R2 上已核对每个包的大小；清单由 canonical writer 生成。"
