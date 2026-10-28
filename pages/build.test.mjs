import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSite, repoRoot } from './build.mjs';

const pagesDir = path.dirname(fileURLToPath(import.meta.url));
const tempDirs = [];
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeFixtureRoot(parent) {
  const root = path.join(parent, 'site-root');
  const pages = path.join(root, 'pages');
  mkdirSync(pages, { recursive: true });
  const write = (relative, content = 'x\n') => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  for (const dir of ['en', 'en/privacy', 'privacy', 'guide', 'demo']) write(`${dir}/index.html`, `page ${dir}\n`);
  write('site/press.css', 'body{}\n');
  write('site/boot.js', '// boot\n');
  write('assets/picture.webp', 'webp\n');
  write('assets/fonts/font.woff2', 'woff2\n');
  for (const file of [
    'index.html',
    'site-config.js',
    'desktop-release-feed.js',
    'llms.txt',
    'robots.txt',
    'sitemap.xml',
    'favicon.ico',
    'apple-touch-icon.png',
    'google7924b9f0fcdd77fd.html',
  ]) {
    write(file, `${file}\n`);
  }
  for (const name of ['admin', 'browser-extension', 'downloads', 'ops', 'scripts']) write(`${name}/keep.txt`);
  for (const file of ['DEPLOYMENT.md', 'DESIGN.md', 'PRODUCT.md', 'README.md', 'domain-changed.html']) write(file);
  write('.gitignore', 'ignored\n');
  write('.hidden/secret.txt', 'secret\n');
  write('site/.DS_Store', 'junk\n');
  for (const [name, content] of [
    ['_headers', '/*\n  X-Test: fixture\n'],
    ['404.html', '<!doctype html><title>404</title>\n'],
    ['_routes.json', '{"version":1,"include":["/"],"exclude":[]}\n'],
  ]) {
    writeFileSync(path.join(pages, name), content);
  }
  return { root, pages };
}

test('whitelisted files land in dist, excluded ones do not', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'gp-pages-build-'));
  tempDirs.push(parent);
  const { root, pages } = makeFixtureRoot(parent);
  const dist = path.join(parent, 'dist');

  const { copied } = buildSite({ sourceRoot: root, distRoot: dist, pagesRoot: pages });

  for (const relative of [
    'index.html',
    'site-config.js',
    'desktop-release-feed.js',
    'llms.txt',
    'robots.txt',
    'sitemap.xml',
    'favicon.ico',
    'apple-touch-icon.png',
    'google7924b9f0fcdd77fd.html',
    'en/index.html',
    'en/privacy/index.html',
    'privacy/index.html',
    'guide/index.html',
    'demo/index.html',
    'site/press.css',
    'site/boot.js',
    'assets/picture.webp',
    'assets/fonts/font.woff2',
    '_headers',
    '404.html',
    '_routes.json',
  ]) {
    assert.equal(existsSync(path.join(dist, relative)), true, `missing from dist: ${relative}`);
  }
  for (const relative of [
    'admin',
    'browser-extension',
    'downloads',
    'ops',
    'scripts',
    'DEPLOYMENT.md',
    'DESIGN.md',
    'PRODUCT.md',
    'README.md',
    'domain-changed.html',
    '.gitignore',
    '.hidden',
    'pages',
  ]) {
    assert.equal(existsSync(path.join(dist, relative)), false, `must not be in dist: ${relative}`);
  }
  assert.equal(existsSync(path.join(dist, 'site/.DS_Store')), false, 'hidden files inside whitelisted dirs must not ship');
  assert.deepEqual(copied.sort(), [
    'apple-touch-icon.png',
    'assets',
    'demo',
    'desktop-release-feed.js',
    'en',
    'favicon.ico',
    'google7924b9f0fcdd77fd.html',
    'guide',
    'index.html',
    'llms.txt',
    'privacy',
    'robots.txt',
    'site',
    'site-config.js',
    'sitemap.xml',
  ]);
  assert.equal(readFileSync(path.join(dist, '_headers'), 'utf8'), '/*\n  X-Test: fixture\n');
});

test('an unclassified root entry fails the build and is named in the error', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'gp-pages-build-'));
  tempDirs.push(parent);
  const { root, pages } = makeFixtureRoot(parent);
  writeFileSync(path.join(root, 'secret.txt'), 'top secret\n');

  assert.throws(
    () => buildSite({ sourceRoot: root, distRoot: path.join(parent, 'dist'), pagesRoot: pages }),
    (error) => {
      assert.match(error.message, /secret\.txt/);
      return true;
    },
  );
});

test('each build starts from an empty dist', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'gp-pages-build-'));
  tempDirs.push(parent);
  const { root, pages } = makeFixtureRoot(parent);
  const dist = path.join(parent, 'dist');

  buildSite({ sourceRoot: root, distRoot: dist, pagesRoot: pages });
  writeFileSync(path.join(dist, 'stale.txt'), 'leftover\n');
  buildSite({ sourceRoot: root, distRoot: dist, pagesRoot: pages });

  assert.equal(existsSync(path.join(dist, 'stale.txt')), false);
  assert.equal(existsSync(path.join(dist, 'index.html')), true);
});

test('the real repository builds without unclassified entries', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'gp-pages-build-'));
  tempDirs.push(dist);
  const { copied } = buildSite({ sourceRoot: repoRoot, distRoot: dist, pagesRoot: pagesDir });

  const allowed = new Set([
    'en',
    'privacy',
    'guide',
    'demo',
    'site',
    'assets',
    'index.html',
    'site-config.js',
    'desktop-release-feed.js',
    'llms.txt',
    'robots.txt',
    'sitemap.xml',
    'favicon.ico',
    'apple-touch-icon.png',
    'google7924b9f0fcdd77fd.html',
    '_headers',
    '404.html',
    '_routes.json',
  ]);
  for (const entry of readdirSync(dist)) {
    assert.equal(allowed.has(entry), true, `unexpected dist entry: ${entry}`);
  }
  assert.equal(existsSync(path.join(dist, 'assets/work/work.js')), true);
  assert.equal(existsSync(path.join(dist, 'assets/work/tea-ceremony-360.webp.json')), true);
  assert.ok(copied.includes('assets'));
});
