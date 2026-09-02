#!/usr/bin/env node

const keepValue = process.argv[2] ?? "4";
const keep = Number(keepValue);

if (!Number.isSafeInteger(keep) || keep < 1) {
  throw new Error("usage: select-desktop-release-retention.mjs [positive keep count]");
}

const packagePattern = /^MOSA-(darwin-arm64|win32-x64)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.zip$/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const releases = new Map();

function parseVersion(value) {
  const match = versionPattern.exec(value);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareNumericIdentifiers(left, right) {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return 0;

  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }

  if (!left.prerelease.length || !right.prerelease.length) {
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    return left.prerelease.length ? -1 : 1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  for (const name of input.split(/\r?\n/)) {
    const match = packagePattern.exec(name.trim());
    if (!match) continue;
    const [, platform, version] = match;
    const release = releases.get(version) || { version, mac: null, windows: null };
    release[platform === "darwin-arm64" ? "mac" : "windows"] = name.trim();
    releases.set(version, release);
  }

  const stalePairs = [...releases.values()]
    .filter((release) => release.mac && release.windows)
    .sort((left, right) => compareVersions(right.version, left.version))
    .slice(keep)
    .map((release) => `${release.mac}\t${release.windows}`);

  process.stdout.write(stalePairs.join("\n"));
});
