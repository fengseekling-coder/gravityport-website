#!/usr/bin/env node
// Assemble the static assets the gp-edge Worker serves: the admin dashboard
// (admin/) and the legacy-domain fallback page (domain-changed.html) are
// copied from the repository root into public/ on every run.

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const edgeDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(edgeDir, "..", "..");
const publicDir = path.join(edgeDir, "public");

await rm(publicDir, { recursive: true, force: true });
await mkdir(path.join(publicDir, "admin"), { recursive: true });
await cp(path.join(repoRoot, "admin"), path.join(publicDir, "admin"), { recursive: true });
await cp(path.join(repoRoot, "domain-changed.html"), path.join(publicDir, "domain-changed.html"));
console.log(`built ${path.relative(repoRoot, publicDir)}`);
