#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_ROOT = process.env.MOSA_SOURCE_ROOT || "/Users/azhuilab/codex_aigc/mosa";
const canonicalWriterUrl = pathToFileURL(join(SOURCE_ROOT, "scripts/prepare-desktop-release-manifest.mjs")).href;
const updateServiceUrl = pathToFileURL(join(SOURCE_ROOT, "desktop/update-service.mjs")).href;
const { artifactMetadata } = await import(canonicalWriterUrl);
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
if (!args.manifest || !args["mac-dmg"] || !args["git-sha"]) {
  throw new Error("Usage: extend-desktop-release-manifest.mjs --manifest <latest.json> --mac-dmg <file> --git-sha <sha>");
}

const manifestPath = resolve(args.manifest);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const gitSha = String(args["git-sha"]).trim();
if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error("git-sha must be a full 40-character lowercase Git SHA.");
if (!manifest.platforms?.macos) throw new Error("Canonical manifest is missing platforms.macos.");

await artifactMetadata({
  path: args["mac-dmg"],
  expectedFile: `MOSA-darwin-arm64-${manifest.version}.dmg`,
  platform: "macOS",
  arch: "arm64",
});

manifest.gitSha = gitSha;
parseUpdateManifest(manifest);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
