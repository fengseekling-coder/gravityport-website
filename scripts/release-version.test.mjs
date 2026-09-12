import assert from "node:assert/strict";
import test from "node:test";
import { compareReleaseVersions, parseReleaseVersion } from "./release-version.mjs";

test("release version comparison handles numeric rc identifiers", () => {
  assert.equal(compareReleaseVersions("0.2.1-rc.9", "0.2.1-rc.8"), 1);
  assert.equal(compareReleaseVersions("0.2.1-rc.10", "0.2.1-rc.9"), 1);
  assert.equal(compareReleaseVersions("0.2.1-rc.12", "0.2.1-rc.9"), 1);
  assert.equal(compareReleaseVersions("0.2.1-rc.9", "0.2.1-rc.12"), -1);
});

test("stable releases sort after prereleases", () => {
  assert.equal(compareReleaseVersions("0.2.1", "0.2.1-rc.12"), 1);
  assert.equal(compareReleaseVersions("0.2.1-rc.12", "0.2.1"), -1);
});

test("invalid release versions are rejected", () => {
  assert.equal(parseReleaseVersion("0.2.1-rc.12")?.prerelease.join("."), "rc.12");
  assert.equal(parseReleaseVersion("v0.2.1"), null);
  assert.throws(() => compareReleaseVersions("bad", "0.2.1"), /Invalid release version comparison/);
});
