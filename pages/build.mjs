#!/usr/bin/env node
// Assemble the Cloudflare Pages bundle in pages/dist/: copy the public
// whitelist from the repository root, then add the Pages config files.

import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, '..');

// The site is what ships to Pages. Everything else stays in the repository:
// server-side code, private docs, and anything not yet classified. A root
// entry that appears in neither list fails the build so the new file has to
// be sorted into one of them before it can go public by accident.
const WHITELIST_DIRECTORIES = new Set(['en', 'privacy', 'guide', 'demo', 'site', 'assets']);
const WHITELIST_ROOT_FILES = new Set([
  'apple-touch-icon.png',
  'desktop-release-feed.js',
  'favicon.ico',
  'google7924b9f0fcdd77fd.html',
  'index.html',
  'llms.txt',
  'robots.txt',
  'site-config.js',
  'sitemap.xml',
]);
const DO_NOT_PUBLISH_DIRECTORIES = new Set([
  'admin',
  'browser-extension',
  'downloads',
  'ops',
  'pages',
  'scripts',
  'workers',
]);
const DO_NOT_PUBLISH_ROOT_FILES = new Set([
  'DEPLOYMENT.md',
  'DESIGN.md',
  'PRODUCT.md',
  'README.md',
  'domain-changed.html',
]);

// Pages consumes these from the dist root; they are configuration, not site content.
const PAGES_BUNDLE_FILES = ['_headers', '404.html', '_routes.json'];

function isHidden(name) {
  return name.startsWith('.');
}

export function buildSite({ sourceRoot, distRoot, pagesRoot = scriptDir }) {
  rmSync(distRoot, { recursive: true, force: true });
  mkdirSync(distRoot, { recursive: true });

  const unknown = [];
  const copied = [];

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const { name } = entry;
    if (isHidden(name)) continue;
    if (entry.isDirectory()) {
      if (DO_NOT_PUBLISH_DIRECTORIES.has(name)) continue;
      if (WHITELIST_DIRECTORIES.has(name)) {
        cpSync(path.join(sourceRoot, name), path.join(distRoot, name), {
          recursive: true,
          filter: (source) => !isHidden(path.basename(source)),
        });
        copied.push(name);
        continue;
      }
    } else if (entry.isFile()) {
      if (DO_NOT_PUBLISH_ROOT_FILES.has(name)) continue;
      if (WHITELIST_ROOT_FILES.has(name)) {
        copyFileSync(path.join(sourceRoot, name), path.join(distRoot, name));
        copied.push(name);
        continue;
      }
    }
    // Anything left is unclassified, including symlinks and other odd entries.
    unknown.push(name);
  }

  if (unknown.length > 0) {
    throw new Error(
      `Unrecognised entries at the repository root; whitelist them in pages/build.mjs or add them to the do-not-publish list: ${unknown.join(', ')}`,
    );
  }

  for (const name of PAGES_BUNDLE_FILES) {
    copyFileSync(path.join(pagesRoot, name), path.join(distRoot, name));
  }

  return { copied, distRoot };
}

export function buildRepositorySite() {
  return buildSite({ sourceRoot: repoRoot, distRoot: path.join(scriptDir, 'dist') });
}

const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { copied, distRoot } = buildRepositorySite();
  console.log(`Built ${distRoot}`);
  console.log(copied.join('\n'));
}
