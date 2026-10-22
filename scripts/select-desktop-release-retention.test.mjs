import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const selectorPath = fileURLToPath(new URL("./select-desktop-release-retention.mjs", import.meta.url));

function select(lines, keep, product) {
  const args = [selectorPath, String(keep)];
  if (product !== undefined) args.push(product);
  const result = execFileSync("node", args, {
    input: lines.join("\n"),
    encoding: "utf8",
  });
  return result.split("\n").filter(Boolean);
}

function versionList(product, versions) {
  const lines = [];
  for (const version of versions) {
    lines.push(`${product}-darwin-arm64-${version}.zip`);
    lines.push(`${product}-win32-x64-${version}.zip`);
  }
  return lines;
}

test("retention only ever names the requested product's stale pairs", () => {
  // Six complete pairs per product: with keep=4 the two oldest pairs of the
  // running product must go, and nothing from the other product may appear.
  const remote = [
    ...versionList("MOSA", ["0.2.1-rc.30", "0.2.1-rc.32", "0.2.1-rc.34", "0.2.1-rc.35", "0.2.1-rc.36", "0.2.1-rc.37"]),
    ...versionList("GravityPort", ["0.3.0", "0.3.1", "0.3.2", "0.3.3", "0.3.4", "0.3.5"]),
    // Unpaired files are never selected, whatever product they belong to.
    "MOSA-darwin-arm64-0.2.1-rc.15.zip",
    "MOSA-darwin-arm64-0.2.1-rc.22.dmg",
    "GravityPort-darwin-arm64-0.2.9.dmg",
  ];

  const gravityportDeletions = select(remote, 4, "GravityPort");
  assert.ok(gravityportDeletions.length > 0, "GravityPort run must still trim its own old pairs");
  for (const line of gravityportDeletions) {
    assert.match(line, /^GravityPort-darwin-arm64-[0-9.][0-9A-Za-z.-]*\.(dmg|zip)\tGravityPort-win32-x64-[0-9.][0-9A-Za-z.-]*\.zip$/);
    assert.doesNotMatch(line, /MOSA-/, "a GravityPort retention run must never name a MOSA package");
  }
  assert.deepEqual(
    gravityportDeletions.map((line) => line.split("\t")[0].replace(/^GravityPort-darwin-arm64-|\.zip$/g, "")),
    ["0.3.1", "0.3.0"],
    "the two oldest GravityPort pairs are selected for deletion",
  );

  const mosaDeletions = select(remote, 4, "MOSA");
  assert.ok(mosaDeletions.length > 0, "MOSA run must still trim its own old pairs");
  for (const line of mosaDeletions) {
    assert.match(line, /^MOSA-darwin-arm64-[0-9.][0-9A-Za-z.-]*\.(dmg|zip)\tMOSA-win32-x64-[0-9.][0-9A-Za-z.-]*\.zip$/);
    assert.doesNotMatch(line, /GravityPort-/, "a MOSA retention run must never name a GravityPort package");
  }
  assert.deepEqual(
    mosaDeletions.map((line) => line.split("\t")[0].replace(/^MOSA-darwin-arm64-|\.zip$/g, "")),
    ["0.2.1-rc.32", "0.2.1-rc.30"],
    "the two oldest MOSA pairs are selected for deletion",
  );
});

test("omitting the product keeps the legacy MOSA-only behaviour", () => {
  const remote = [
    ...versionList("MOSA", ["0.2.1-rc.30", "0.2.1-rc.32", "0.2.1-rc.34", "0.2.1-rc.35", "0.2.1-rc.36"]),
    ...versionList("GravityPort", ["0.3.0", "0.3.1", "0.3.2", "0.3.3", "0.3.4"]),
  ];
  const legacy = select(remote, 4);
  const explicit = select(remote, 4, "MOSA");
  assert.deepEqual(legacy, explicit);
  for (const line of legacy) {
    assert.doesNotMatch(line, /GravityPort-/);
  }
});

test("an unknown product name is rejected", () => {
  assert.throws(() => select(["MOSA-darwin-arm64-0.2.1.zip", "MOSA-win32-x64-0.2.1.zip"], 4, "Fedora"), /Unknown desktop release product/);
});

test("a stale release that shipped a Windows installer names it as a third column", () => {
  const remote = [
    ...versionList("GravityPort", ["0.3.3", "0.3.4", "0.3.5", "0.3.6", "0.3.7", "0.3.8"]),
    "GravityPort-darwin-arm64-0.3.3.dmg",
    "GravityPort-darwin-arm64-0.3.4.dmg",
    "GravityPort-win32-x64-0.3.4.exe",
    "GravityPort-win32-x64-0.3.8.exe",
    // An installer never makes a release complete on its own, and never
    // belongs to macOS or to the other product.
    "GravityPort-win32-x64-0.3.0.exe",
    "GravityPort-darwin-arm64-0.3.4.exe",
    "MOSA-win32-x64-0.3.4.exe",
  ];
  assert.deepEqual(select(remote, 4, "GravityPort"), [
    "GravityPort-darwin-arm64-0.3.4.dmg\tGravityPort-win32-x64-0.3.4.zip\tGravityPort-win32-x64-0.3.4.exe",
    "GravityPort-darwin-arm64-0.3.3.dmg\tGravityPort-win32-x64-0.3.3.zip",
  ]);
});
