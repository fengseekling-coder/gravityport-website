#!/usr/bin/env node

import { compareReleaseVersions } from "./release-version.mjs";

const keepValue = process.argv[2] ?? "4";
const keep = Number(keepValue);

if (!Number.isSafeInteger(keep) || keep < 1) {
  throw new Error("usage: select-desktop-release-retention.mjs [positive keep count]");
}

const packagePattern = /^MOSA-(darwin-arm64|win32-x64)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(dmg|zip)$/;
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
    const [, platform, version, extension] = match;
    if (platform === "win32-x64" && extension !== "zip") continue;
    const release = releases.get(version) || { version, mac: null, windows: null };
    if (platform === "darwin-arm64") {
      const current = release.mac || "";
      if (!current || (extension === "dmg" && current.endsWith(".zip"))) release.mac = name.trim();
    } else {
      release.windows = name.trim();
    }
    releases.set(version, release);
  }

  const stalePairs = [...releases.values()]
    .filter((release) => release.mac && release.windows)
    .sort((left, right) => compareReleaseVersions(right.version, left.version))
    .slice(keep)
    .map((release) => `${release.mac}\t${release.windows}`);

  process.stdout.write(stalePairs.join("\n"));
});
