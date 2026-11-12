#!/usr/bin/env node

import { createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The app repository is checked out next to this one (../gravityport).
const SOURCE_ROOT = process.env.MOSA_SOURCE_ROOT || fileURLToPath(new URL("../../gravityport", import.meta.url));
const canonicalWriterUrl = pathToFileURL(join(SOURCE_ROOT, "scripts/prepare-desktop-release-manifest.mjs")).href;
const signatureUrl = pathToFileURL(join(SOURCE_ROOT, "lib/release-manifest-signature.mjs")).href;
const updateServiceUrl = pathToFileURL(join(SOURCE_ROOT, "desktop/update-service.mjs")).href;
const { artifactMetadata } = await import(canonicalWriterUrl);
const {
  createReleaseManifestTrust,
  releaseManifestPrivateKeyFromEnvironment,
  signReleaseManifest,
  verifyReleaseManifestSignature,
} = await import(signatureUrl);
const { parseUpdateManifest } = await import(updateServiceUrl);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    args[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.manifest || !args["git-sha"] || (!args["mac-dmg"] && !args["mac-x64-dmg"])) {
  throw new Error("Usage: extend-desktop-release-manifest.mjs --manifest <latest.json> (--mac-dmg <file> [--dmg-file <expected file name>] | --mac-x64-dmg <file> [--x64-dmg-file <expected file name>]) --git-sha <sha>");
}

const manifestPath = resolve(args.manifest);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const gitSha = String(args["git-sha"]).trim();
if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error("git-sha must be a full 40-character lowercase Git SHA.");
if (!manifest.platforms?.macos) throw new Error("Canonical manifest is missing platforms.macos.");

// The DMG name follows the product the release ships: MOSA releases keep the
// historical name, GravityPort releases use GravityPort-darwin-arm64-…. The
// default preserves the legacy MOSA name for callers that do not pass it.
// The Intel DMG is checked the same way, pinned to arch "x64" and the
// -darwin-x64- file name; it never enters the manifest either.
const expectedDmgFile = String(args["dmg-file"] || "").trim() || `MOSA-darwin-arm64-${manifest.version}.dmg`;
const expectedX64DmgFile = String(args["x64-dmg-file"] || "").trim() || `MOSA-darwin-x64-${manifest.version}.dmg`;

if (args["mac-dmg"]) {
  await artifactMetadata({
    path: args["mac-dmg"],
    expectedFile: expectedDmgFile,
    platform: "macOS",
    arch: "arm64",
  });
}
if (args["mac-x64-dmg"]) {
  if (!manifest.platforms?.macosX64) {
    throw new Error("A macOS x64 DMG ships with the platforms.macosX64 update ZIP, which is missing from the canonical manifest.");
  }
  await artifactMetadata({
    path: args["mac-x64-dmg"],
    expectedFile: expectedX64DmgFile,
    platform: "macOS",
    arch: "x64",
  });
}

const originalKeyId = String(manifest.signature?.keyId || "").trim().toLowerCase();
if (!/^[0-9a-f]{64}$/.test(originalKeyId)) {
  throw new Error("Canonical manifest is missing a valid signature key id.");
}

manifest.gitSha = gitSha;
const privateKey = releaseManifestPrivateKeyFromEnvironment(process.env);
const signedManifest = signReleaseManifest(manifest, { privateKey });
if (signedManifest.signature.keyId !== originalKeyId) {
  throw new Error("Release manifest signing key does not match the canonical manifest.");
}
verifyReleaseManifestSignature(signedManifest, createReleaseManifestTrust(createPublicKey(privateKey)));
parseUpdateManifest(signedManifest);
await writeFile(manifestPath, `${JSON.stringify(signedManifest, null, 2)}\n`, "utf8");
