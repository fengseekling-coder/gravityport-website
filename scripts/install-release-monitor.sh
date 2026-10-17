#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

website_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
label="com.azhuilab.mosa.desktop-release-monitor"
user_home="$HOME"
mosa_dir="$(cd -- "$website_dir/.." && pwd)/mosa"
agent_dir="$user_home/Library/LaunchAgents"
agent_path="$agent_dir/$label.plist"
plist_source="$website_dir/ops/$label.plist"
log_dir="$user_home/Library/Logs/MOSA"

[[ -f "$plist_source" ]] || die "missing launch agent template: $plist_source"
[[ -x "$website_dir/scripts/publish-desktop-release.sh" ]] || die "publisher is not executable"
[[ -r "$user_home/.config/mosa/release.env" ]] || die "missing $user_home/.config/mosa/release.env (deploy host and user, see DEPLOYMENT.md)"

install -d -m 0700 "$agent_dir" "$log_dir"
sed -e "s#__WEBSITE_DIR__#$website_dir#g" -e "s#__MOSA_DIR__#$mosa_dir#g" -e "s#__HOME__#$user_home#g" "$plist_source" > "$agent_path"
! grep -q "__[A-Z_]*__" "$agent_path" || die "unfilled placeholder in $agent_path"
chmod 0600 "$agent_path"
plutil -lint "$agent_path" >/dev/null

domain="gui/$(id -u)"
launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$agent_path"
launchctl enable "$domain/$label"
launchctl kickstart -k "$domain/$label"
launchctl print "$domain/$label" >/dev/null

printf 'installed and started %s\n' "$label"
printf 'logs: %s/desktop-release-monitor.{out,err}.log\n' "$log_dir"
