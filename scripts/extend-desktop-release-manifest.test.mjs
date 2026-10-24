import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const sourceRoot = new URL("../../gravityport", import.meta.url).pathname;
// The writer snapshot's update-service parser knows the GravityPort artifact
// names; the checked-out app repository may still hold the MOSA-only parser.
const writerSnapshotRoot = new URL("../../gravityport-writer-snapshot", import.meta.url).pathname;
const extensionPath = new URL("./extend-desktop-release-manifest.mjs", import.meta.url).pathname;
const signatureModule = await import(new URL("../../gravityport/lib/release-manifest-signature.mjs", import.meta.url));

test("resigns the manifest after adding the DMG Git SHA", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.2.1-rc.25";
  const gitSha = "a".repeat(40);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const trust = signatureModule.createReleaseManifestTrust(publicKey);
  const manifestPath = path.join(root, "latest.json");
  const dmgPath = path.join(root, `MOSA-darwin-arm64-${version}.dmg`);
  const unsignedManifest = {
    version,
    build: {
      gitSha,
      uiFingerprint: "b".repeat(64),
      runtimeFingerprint: "c".repeat(64),
      distribution: "preview",
    },
    publishedAt: "2026-09-20T15:00:00.000Z",
    notes: { zh: "测试发布说明", en: "Test release notes" },
    platforms: {
      macos: {
        platform: "macOS",
        arch: "arm64",
        file: `MOSA-darwin-arm64-${version}.zip`,
        size: 1,
        sha256: "d".repeat(64),
      },
    },
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(signatureModule.signReleaseManifest(unsignedManifest, {
    privateKey: privateKeyPem,
    expectedTrust: trust,
  }), null, 2)}\n`);
  fs.writeFileSync(dmgPath, "fixture");

  execFileSync("node", [extensionPath, "--manifest", manifestPath, "--mac-dmg", dmgPath, "--git-sha", gitSha], {
    env: {
      ...process.env,
      MOSA_SOURCE_ROOT: sourceRoot,
      MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
    },
  });

  const extended = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(extended.gitSha, gitSha);
  assert.equal(signatureModule.verifyReleaseManifestSignature(extended, trust), true);
});

test("accepts the GravityPort DMG name for a GravityPort manifest", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension-gp."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.3.0";
  const gitSha = "b".repeat(40);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const trust = signatureModule.createReleaseManifestTrust(publicKey);
  const manifestPath = path.join(root, "latest.json");
  const dmgPath = path.join(root, `GravityPort-darwin-arm64-${version}.dmg`);
  const unsignedManifest = {
    version,
    build: {
      gitSha,
      uiFingerprint: "c".repeat(64),
      runtimeFingerprint: "d".repeat(64),
      distribution: "preview",
    },
    publishedAt: "2026-10-10T15:00:00.000Z",
    notes: { zh: "测试发布说明", en: "Test release notes" },
    platforms: {
      macos: {
        platform: "macOS",
        arch: "arm64",
        appName: "GravityPort.app",
        file: `GravityPort-darwin-arm64-${version}.zip`,
        size: 1,
        sha256: "e".repeat(64),
      },
    },
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(signatureModule.signReleaseManifest(unsignedManifest, {
    privateKey: privateKeyPem,
    expectedTrust: trust,
  }), null, 2)}\n`);
  fs.writeFileSync(dmgPath, "fixture");

  execFileSync("node", [extensionPath, "--manifest", manifestPath, "--mac-dmg", dmgPath, "--dmg-file", `GravityPort-darwin-arm64-${version}.dmg`, "--git-sha", gitSha], {
    env: {
      ...process.env,
      MOSA_SOURCE_ROOT: writerSnapshotRoot,
      MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
    },
  });

  const extended = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(extended.gitSha, gitSha);
  assert.equal(signatureModule.verifyReleaseManifestSignature(extended, trust), true);
});
