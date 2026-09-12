#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseReleaseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value || ""));
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

export function compareReleaseVersions(leftValue, rightValue) {
  const left = parseReleaseVersion(leftValue);
  const right = parseReleaseVersion(rightValue);
  if (!left || !right) throw new Error(`Invalid release version comparison: ${leftValue} vs ${rightValue}`);

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

const executedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedPath === fileURLToPath(import.meta.url)) {
  const [left, right] = process.argv.slice(2);
  if (!left || !right) {
    console.error("usage: release-version.mjs <candidate> <published>");
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = compareReleaseVersions(left, right) >= 0 ? 0 : 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    }
  }
}
