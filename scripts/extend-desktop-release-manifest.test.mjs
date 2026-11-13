import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveMacX64SourceRoot } from "./publish-desktop-release.test-helpers.mjs";

const sourceRoot = new URL("../../gravityport", import.meta.url).pathname;
// The writer snapshot's update-service parser knows the GravityPort artifact
// names; the checked-out app repository may still hold the MOSA-only parser.
const writerSnapshotRoot = new URL("../../gravityport-writer-snapshot", import.meta.url).pathname;
// The Intel (darwin-x64) cases exercise the 388 manifest rules, so the
// source root must be an app checkout whose update-service parser already
// knows platforms.macosX64 (see resolveMacX64SourceRoot).
const macX64SourceRoot = resolveMacX64SourceRoot();
const extensionPath = new URL("./extend-desktop-release-manifest.mjs", import.meta.url).pathname;
const signatureModule = await import(new URL("../../gravityport/lib/release-manifest-signature.mjs", import.meta.url));

function makeSignedManifest(root, { version, gitSha, withMacosX64 }) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const trust = signatureModule.createReleaseManifestTrust(publicKey);
  const manifestPath = path.join(root, "latest.json");
  const unsignedManifest = {
    version,
    build: {
      gitSha,
      uiFingerprint: "b".repeat(64),
      runtimeFingerprint: "c".repeat(64),
      distribution: "preview",
    },
    publishedAt: "2026-11-12T15:00:00.000Z",
    notes: { zh: "测试发布说明", en: "Test release notes" },
    platforms: {
      macos: {
        platform: "macOS",
        arch: "arm64",
        appName: "GravityPort.app",
        file: `GravityPort-darwin-arm64-${version}.zip`,
        size: 1,
        sha256: "d".repeat(64),
      },
      ...(withMacosX64 ? {
        macosX64: {
          platform: "macOS",
          arch: "x64",
          appName: "GravityPort.app",
          file: `GravityPort-darwin-x64-${version}.zip`,
          size: 2,
          sha256: "e".repeat(64),
        },
      } : {}),
    },
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(signatureModule.signReleaseManifest(unsignedManifest, {
    privateKey: privateKeyPem,
    expectedTrust: trust,
  }), null, 2)}\n`);
  return { manifestPath, privateKeyPem, trust };
}

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

test("accepts the Intel DMG for a manifest that carries platforms.macosX64", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension-x64."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.3.13";
  const gitSha = "c".repeat(40);
  const { manifestPath, privateKeyPem, trust } = makeSignedManifest(root, { version, gitSha, withMacosX64: true });
  const dmgPath = path.join(root, `GravityPort-darwin-x64-${version}.dmg`);
  fs.writeFileSync(dmgPath, "fixture");

  execFileSync("node", [extensionPath, "--manifest", manifestPath, "--mac-x64-dmg", dmgPath, "--x64-dmg-file", `GravityPort-darwin-x64-${version}.dmg`, "--git-sha", gitSha], {
    env: {
      ...process.env,
      MOSA_SOURCE_ROOT: macX64SourceRoot,
      MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
    },
  });

  const extended = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(extended.gitSha, gitSha);
  assert.equal(signatureModule.verifyReleaseManifestSignature(extended, trust), true);
  assert.ok(extended.platforms.macosX64, "the Intel update entry survives the re-signing");
});

test("accepts the arm64 and Intel DMGs in one call", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension-dual."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.3.13";
  const gitSha = "d".repeat(40);
  const { manifestPath, privateKeyPem, trust } = makeSignedManifest(root, { version, gitSha, withMacosX64: true });
  const dmgPath = path.join(root, `GravityPort-darwin-arm64-${version}.dmg`);
  fs.writeFileSync(dmgPath, "fixture");
  const x64DmgPath = path.join(root, `GravityPort-darwin-x64-${version}.dmg`);
  fs.writeFileSync(x64DmgPath, "fixture");

  execFileSync("node", [
    extensionPath,
    "--manifest", manifestPath,
    "--mac-dmg", dmgPath, "--dmg-file", `GravityPort-darwin-arm64-${version}.dmg`,
    "--mac-x64-dmg", x64DmgPath, "--x64-dmg-file", `GravityPort-darwin-x64-${version}.dmg`,
    "--git-sha", gitSha,
  ], {
    env: {
      ...process.env,
      MOSA_SOURCE_ROOT: macX64SourceRoot,
      MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
    },
  });

  const extended = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(signatureModule.verifyReleaseManifestSignature(extended, trust), true);
});

test("rejects an Intel DMG whose file name does not match the x64 pattern", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension-x64name."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.3.13";
  const gitSha = "e".repeat(40);
  const { manifestPath, privateKeyPem } = makeSignedManifest(root, { version, gitSha, withMacosX64: true });
  // The arm64 DMG name must never pass as the Intel DMG.
  const dmgPath = path.join(root, `GravityPort-darwin-arm64-${version}.dmg`);
  fs.writeFileSync(dmgPath, "fixture");

  let failed = null;
  try {
    execFileSync("node", [extensionPath, "--manifest", manifestPath, "--mac-x64-dmg", dmgPath, "--x64-dmg-file", `GravityPort-darwin-x64-${version}.dmg`, "--git-sha", gitSha], {
      env: {
        ...process.env,
        MOSA_SOURCE_ROOT: macX64SourceRoot,
        MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "the arm64 DMG name must be rejected as the Intel DMG");
  assert.match(String(failed.stderr), /Release artifact filename must be/);
});

test("rejects an Intel DMG for a manifest without platforms.macosX64", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mosa-release-extension-x64none."));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = "0.3.13";
  const gitSha = "f".repeat(40);
  const { manifestPath, privateKeyPem } = makeSignedManifest(root, { version, gitSha, withMacosX64: false });
  const dmgPath = path.join(root, `GravityPort-darwin-x64-${version}.dmg`);
  fs.writeFileSync(dmgPath, "fixture");

  let failed = null;
  try {
    execFileSync("node", [extensionPath, "--manifest", manifestPath, "--mac-x64-dmg", dmgPath, "--x64-dmg-file", `GravityPort-darwin-x64-${version}.dmg`, "--git-sha", gitSha], {
      env: {
        ...process.env,
        MOSA_SOURCE_ROOT: macX64SourceRoot,
        MOSA_RELEASE_MANIFEST_PRIVATE_KEY: privateKeyPem,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, "an Intel DMG without the macosX64 update ZIP must be rejected");
  assert.match(String(failed.stderr), /platforms\.macosX64/);
});
