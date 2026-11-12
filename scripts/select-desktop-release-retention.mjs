#!/usr/bin/env node

import { compareReleaseVersions } from "./release-version.mjs";

const keepValue = process.argv[2] ?? "4";
const keep = Number(keepValue);

if (!Number.isSafeInteger(keep) || keep < 1) {
  throw new Error("usage: select-desktop-release-retention.mjs [positive keep count] [MOSA|GravityPort]");
}

// Retention only ever names the requested product's packages. The old source
// freezes the transitional MOSA packages forever, so a GravityPort run must
// not see — and the publisher must not delete — any MOSA-… file, and the
// other way around.
const product = String(process.argv[3] ?? "MOSA").trim();
if (product !== "MOSA" && product !== "GravityPort") {
  throw new Error(`Unknown desktop release product: ${product || "(empty)"}`);
}

// A release is the macOS DMG or update ZIP (arm64 and, since 388, Intel
// darwin-x64), the Windows update ZIP, and, from the first release that
// shipped one, the Windows installer (.exe). An Intel file always belongs to
// the release of its own version: it is retained and pruned together with
// that version, never on its own.
const packagePattern = /^(MOSA|GravityPort)-(darwin-arm64|darwin-x64|win32-x64)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(dmg|zip|exe)$/;
const releases = new Map();

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  for (const name of input.split(/\r?\n/)) {
    const match = packagePattern.exec(name.trim());
    if (!match) continue;
    const [fullName, fileProduct, platform, version, extension] = match;
    if (`${fileProduct}-` !== `${product}-`) continue;
    if (platform === "win32-x64" && extension === "dmg") continue;
    if (platform === "darwin-arm64" && extension === "exe") continue;
    if (platform === "darwin-x64" && extension === "exe") continue;
    const release = releases.get(version) || { version, mac: null, macIntelZip: null, macIntelDmg: null, windows: null, windowsInstaller: null };
    if (platform === "darwin-arm64") {
      const current = release.mac || "";
      if (!current || (extension === "dmg" && current.endsWith(".zip"))) release.mac = fullName;
    } else if (platform === "darwin-x64" && extension === "zip") {
      release.macIntelZip = fullName;
    } else if (platform === "darwin-x64") {
      release.macIntelDmg = fullName;
    } else if (extension === "exe") {
      release.windowsInstaller = fullName;
    } else {
      release.windows = fullName;
    }
    releases.set(version, release);
  }

  // One line per stale release: the macOS arm64 file, the Windows ZIP and,
  // when the release shipped them, the Windows installer and the Intel
  // darwin-x64 update ZIP / DMG, separated by tabs. The Intel files travel
  // with their version: a release is only ever deleted complete, and the
  // current release's Intel files stay inside the retention window with it.
  // Empty columns use "-" as a placeholder: the publisher reads the line with
  // IFS=tab, where consecutive tabs collapse into one separator, so an empty
  // field would silently shift every later column to the left.
  const stalePairs = [...releases.values()]
    .filter((release) => release.mac && release.windows)
    .sort((left, right) => compareReleaseVersions(right.version, left.version))
    .slice(keep)
    .map((release) => [release.mac, release.windows, release.windowsInstaller || "-", release.macIntelZip || "-", release.macIntelDmg || "-"].join("\t"));

  process.stdout.write(stalePairs.join("\n"));
});
