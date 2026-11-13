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

  const gravityportAll = select(remote, 4, "GravityPort");
  // 400: the unpaired 0.2.9 DMG is older than the oldest retained version
  // (0.3.2), so it is a leftover and now listed on its own line (Windows
  // column "-"); the complete pairs keep their shape.
  assert.equal(gravityportAll.pop(), "GravityPort-darwin-arm64-0.2.9.dmg\t-\t-\t-\t-\t-");
  const gravityportDeletions = gravityportAll;
  assert.ok(gravityportDeletions.length > 0, "GravityPort run must still trim its own old pairs");
  for (const line of gravityportDeletions) {
    assert.match(line, /^GravityPort-darwin-arm64-[0-9.][0-9A-Za-z.-]*\.(dmg|zip)\tGravityPort-win32-x64-[0-9.][0-9A-Za-z.-]*\.zip(\t-\t-\t-\t-)?$/);
    assert.doesNotMatch(line, /MOSA-/, "a GravityPort retention run must never name a MOSA package");
  }
  assert.deepEqual(
    gravityportDeletions.map((line) => line.split("\t")[0].replace(/^GravityPort-darwin-arm64-|\.zip$/g, "")),
    ["0.3.1", "0.3.0"],
    "the two oldest GravityPort pairs are selected for deletion",
  );

  const mosaAll = select(remote, 4, "MOSA");
  // 400: the unpaired rc.22 DMG and rc.15 ZIP are older than the oldest
  // retained MOSA version (rc.34), so both are leftovers.
  assert.deepEqual(mosaAll.slice(-2), [
    "MOSA-darwin-arm64-0.2.1-rc.22.dmg\t-\t-\t-\t-\t-",
    "MOSA-darwin-arm64-0.2.1-rc.15.zip\t-\t-\t-\t-\t-",
  ]);
  const mosaDeletions = mosaAll.slice(0, -2);
  assert.ok(mosaDeletions.length > 0, "MOSA run must still trim its own old pairs");
  for (const line of mosaDeletions) {
    assert.match(line, /^MOSA-darwin-arm64-[0-9.][0-9A-Za-z.-]*\.(dmg|zip)\tMOSA-win32-x64-[0-9.][0-9A-Za-z.-]*\.zip(\t-\t-\t-\t-)?$/);
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
    "GravityPort-darwin-arm64-0.3.4.dmg\tGravityPort-win32-x64-0.3.4.zip\tGravityPort-win32-x64-0.3.4.exe\t-\t-\tGravityPort-darwin-arm64-0.3.4.zip",
    "GravityPort-darwin-arm64-0.3.3.dmg\tGravityPort-win32-x64-0.3.3.zip\t-\t-\t-\tGravityPort-darwin-arm64-0.3.3.zip",
  ]);
});

test("four versions where two carry Intel files: retention keeps and prunes them with their version", () => {
  const remote = [
    // 0.3.8 and 0.3.9 are the two oldest releases and both shipped Intel
    // packages (update ZIP + DMG); 0.3.10 and 0.3.11 are the two that stay.
    "GravityPort-darwin-arm64-0.3.8.zip",
    "GravityPort-win32-x64-0.3.8.zip",
    "GravityPort-darwin-x64-0.3.8.zip",
    "GravityPort-darwin-x64-0.3.8.dmg",
    "GravityPort-darwin-arm64-0.3.9.zip",
    "GravityPort-win32-x64-0.3.9.zip",
    "GravityPort-darwin-x64-0.3.9.zip",
    "GravityPort-darwin-x64-0.3.9.dmg",
    "GravityPort-darwin-arm64-0.3.10.zip",
    "GravityPort-win32-x64-0.3.10.zip",
    "GravityPort-darwin-x64-0.3.10.zip",
    "GravityPort-darwin-arm64-0.3.11.zip",
    "GravityPort-win32-x64-0.3.11.zip",
    "GravityPort-darwin-x64-0.3.11.dmg",
    // Intel files without their arm64/Windows siblings never make a release
    // complete, and an Intel .exe is not a real package.
    "GravityPort-darwin-x64-0.3.7.zip",
    "GravityPort-darwin-x64-0.3.7.dmg",
    "GravityPort-darwin-x64-0.3.6.exe",
  ];
  const deletions = select(remote, 2, "GravityPort");
  // "-" marks a column the release did not ship, so the Intel columns never
  // shift into the installer position on the publisher's tab read.
  assert.deepEqual(deletions, [
    "GravityPort-darwin-arm64-0.3.9.zip\tGravityPort-win32-x64-0.3.9.zip\t-\tGravityPort-darwin-x64-0.3.9.zip\tGravityPort-darwin-x64-0.3.9.dmg\t-",
    "GravityPort-darwin-arm64-0.3.8.zip\tGravityPort-win32-x64-0.3.8.zip\t-\tGravityPort-darwin-x64-0.3.8.zip\tGravityPort-darwin-x64-0.3.8.dmg\t-",
  ]);
  // Everything that stays must keep its Intel files.
  assert.doesNotMatch(deletions.join("\n"), /0\.3\.10|0\.3\.11/, "the current and kept releases are never selected");
});

test("an Intel-only release (no arm64 sibling) is never selected for deletion", () => {
  const remote = [
    ...versionList("GravityPort", ["0.3.8", "0.3.9", "0.3.10", "0.3.11"]),
    "GravityPort-darwin-x64-0.3.5.zip",
    "GravityPort-darwin-x64-0.3.5.dmg",
  ];
  const deletions = select(remote, 2, "GravityPort");
  assert.equal(deletions.some((line) => line.includes("0.3.5")), false, "the Intel-only leftovers stay untouched");
});

function armBoth(version) {
  return [
    `GravityPort-darwin-arm64-${version}.zip`,
    `GravityPort-darwin-arm64-${version}.dmg`,
    `GravityPort-win32-x64-${version}.zip`,
  ];
}

test("400: arm64 ZIP+DMG versions name the DMG in column 1 and the ZIP in column 6", () => {
  const versions = ["0.3.1", "0.3.2", "0.3.3", "0.3.4", "0.3.5", "0.3.6"];
  const remote = versions.flatMap(armBoth);
  const deletions = select(remote, 4, "GravityPort");
  assert.deepEqual(deletions, [
    "GravityPort-darwin-arm64-0.3.2.dmg\tGravityPort-win32-x64-0.3.2.zip\t-\t-\t-\tGravityPort-darwin-arm64-0.3.2.zip",
    "GravityPort-darwin-arm64-0.3.1.dmg\tGravityPort-win32-x64-0.3.1.zip\t-\t-\t-\tGravityPort-darwin-arm64-0.3.1.zip",
  ]);
  const output = deletions.join("\n");
  for (const version of ["0.3.3", "0.3.4", "0.3.5", "0.3.6"]) {
    for (const name of armBoth(version)) {
      assert.equal(output.includes(name), false, `${name} is retained and must not be listed`);
    }
  }
});

test("400: the listing order of ZIP and DMG does not change the columns", () => {
  const remote = [
    "GravityPort-darwin-arm64-0.3.1.dmg",
    "GravityPort-darwin-arm64-0.3.1.zip",
    "GravityPort-win32-x64-0.3.1.zip",
    ...armBoth("0.3.2"),
  ];
  assert.deepEqual(select(remote, 1, "GravityPort"), [
    "GravityPort-darwin-arm64-0.3.1.dmg\tGravityPort-win32-x64-0.3.1.zip\t-\t-\t-\tGravityPort-darwin-arm64-0.3.1.zip",
  ]);
});

test("400: an arm64-only leftover older than the oldest retained version is selected", () => {
  const retained = ["0.3.3", "0.3.4", "0.3.5", "0.3.6"];
  const remote = [
    ...retained.flatMap(armBoth),
    "GravityPort-darwin-arm64-0.3.1.zip",
    "GravityPort-darwin-arm64-0.3.0.dmg",
    "GravityPort-win32-x64-0.2.9.zip",
  ];
  const deletions = select(remote, 4, "GravityPort");
  assert.deepEqual(deletions, [
    "GravityPort-darwin-arm64-0.3.1.zip\t-\t-\t-\t-\t-",
    "GravityPort-darwin-arm64-0.3.0.dmg\t-\t-\t-\t-\t-",
    "-\tGravityPort-win32-x64-0.2.9.zip\t-\t-\t-\t-",
  ]);
  const output = deletions.join("\n");
  for (const name of retained.flatMap(armBoth)) {
    assert.equal(output.includes(name), false, `${name} is retained and must not be listed`);
  }
});

test("400: an incomplete release newer than the oldest retained one is never selected", () => {
  const retained = ["0.3.3", "0.3.4", "0.3.5", "0.3.6"];
  const remote = [
    ...retained.flatMap(armBoth),
    // 0.3.7 is being published: its Windows ZIP is not up yet.
    "GravityPort-darwin-arm64-0.3.7.zip",
    "GravityPort-darwin-arm64-0.3.7.dmg",
    // An incomplete release between retained ones is not older than the
    // oldest retained release either.
    "GravityPort-win32-x64-0.3.5-beta.1.zip",
    // Windows ZIP only, newer than the oldest retained one.
    "GravityPort-win32-x64-0.3.8.zip",
  ];
  const deletions = select(remote, 4, "GravityPort");
  assert.deepEqual(deletions, [], "nothing is stale");
  assert.equal(deletions.join("\n").includes("0.3.7"), false);
  assert.equal(deletions.join("\n").includes("0.3.8"), false);
});
