// Live comparison test: builds the Pages bundle, serves it with
// `wrangler pages dev` (offline, no login), and checks every response against
// the nginx header table from tasks/285 that this migration has to reproduce.
// Behaviours observed in wrangler dev and recorded as assertions, with the
// production differences noted inline (re-check on pages.dev after A1):
//   - 308 redirects carry the security headers and the matching Cache-Control.
//   - The Pages default Cache-Control is `public, max-age=0, must-revalidate`.
//   - 404 responses default to `Cache-Control: no-store`.
//   - `/_headers` is not a public asset (dev answers 502; production strips it).
//   - `/_routes.json` is still served as an asset in dev; verify production.

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';

import { buildSite } from './build.mjs';

const pagesDir = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CSP =
  "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const DEMO_CSP =
  "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

// The five headers nginx sends on every response, with their exact values.
const SECURITY_HEADERS = new Map([
  ['strict-transport-security', 'max-age=31536000'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()'],
  ['content-security-policy', DEFAULT_CSP],
]);

const PAGES_DEFAULT_CACHE = 'public, max-age=0, must-revalidate';
const HTML_PAGE_PATHS = new Set(['/', '/en/', '/en/privacy/', '/privacy/', '/guide/', '/demo/']);
const IMAGE_FONT_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png', 'svg', 'woff2', 'ico']);

// Cache-Control expected per the header table; paths the table leaves alone
// resolve to the Pages default.
function expectedCacheControl(pathname) {
  if (HTML_PAGE_PATHS.has(pathname)) return 'no-cache';
  if (pathname === '/site-config.js') return 'no-cache, no-store, must-revalidate';
  if (pathname === '/desktop-release-feed.js') return 'max-age=3600';
  if (pathname.startsWith('/site/') && /\.(css|js)$/.test(pathname)) return 'max-age=3600';
  if (IMAGE_FONT_EXTENSIONS.has(pathname.split('.').pop().toLowerCase())) return 'public, max-age=2592000';
  return PAGES_DEFAULT_CACHE;
}

// dist file -> request URL (Pages serves directory index.html files at the
// directory path, and x.html at the extensionless x). Returns null for files
// checked by dedicated tests.
function urlForDistPath(relativePath) {
  if (relativePath === '404.html') return '/404';
  if (relativePath === '_headers' || relativePath === '_redirects' || relativePath === '_routes.json') return null;
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`;
  if (relativePath.endsWith('.html')) return `/${relativePath.slice(0, -'.html'.length)}`;
  return `/${relativePath}`;
}

function headerMap(rawHeaders) {
  const map = new Map();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(rawHeaders[index + 1]);
  }
  return map;
}

function assertSecurityHeaders(headers, csp = DEFAULT_CSP) {
  for (const [name, expected] of SECURITY_HEADERS) {
    const values = headers.get(name) ?? [];
    const wanted = name === 'content-security-policy' ? csp : expected;
    // One header line with the exact value: a second rule matching the same
    // path would either add another line or concatenate with a comma.
    assert.deepEqual(values, [wanted], `${name} must appear exactly once with its table value`);
  }
}

let server;
let port;
const tempDirs = [];

async function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: headerMap(res.rawHeaders),
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port: found } = probe.address();
      probe.close(() => resolve(found));
    });
    probe.on('error', reject);
  });
}

test.before(async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'gp-pages-headers-'));
  tempDirs.push(dist);
  buildSite({ sourceRoot: path.resolve(pagesDir, '..'), distRoot: dist, pagesRoot: pagesDir });

  const wranglerBin = path.join(pagesDir, 'node_modules', '.bin', 'wrangler');
  assert.equal(existsSync(wranglerBin), true, 'wrangler is missing; run `npm ci --prefix pages` first');
  port = await freePort();

  const child = spawn(wranglerBin, ['pages', 'dev', dist, '--port', String(port)], {
    cwd: pagesDir,
    env: {
      ...process.env,
      CI: '1',
      WRANGLER_SEND_METRICS: 'false',
      CLOUDFLARE_API_TOKEN: '',
      CLOUDFLARE_ACCOUNT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('exit', (code, signal) => {
    output += `\n[wrangler exited code=${code} signal=${signal}]\n`;
  });

  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler pages dev exited before serving:\n${output}`);
    }
    try {
      const response = await request('/');
      if (response.status === 200) return;
      lastError = new Error(`unexpected status ${response.status} from ${port}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`wrangler pages dev did not become ready: ${lastError}\n${output}`);
});

test.after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      server.on('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('every file in dist is served with the nginx header table', async () => {
  const dist = tempDirs[0];
  const files = [];
  const walk = (dir, relative = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relativePath);
      else files.push(relativePath);
    }
  };
  walk(dist);

  const skipped = ['_headers', '_redirects', '_routes.json'];
  assert.equal(files.includes('index.html'), true);
  assert.ok(files.length > 100, `unexpectedly few dist files: ${files.length}`);

  for (const relativePath of files) {
    if (skipped.includes(relativePath)) continue;
    const pathname = urlForDistPath(relativePath);
    const response = await request(pathname);
    assert.equal(response.status, 200, `${pathname} must be served`);
    assertSecurityHeaders(response.headers, pathname === '/demo/' ? DEMO_CSP : DEFAULT_CSP);
    assert.deepEqual(
      response.headers.get('cache-control'),
      [expectedCacheControl(pathname)],
      `${pathname} has the wrong Cache-Control`,
    );
    assert.deepEqual(response.body, readFileSync(path.join(dist, relativePath)), `${pathname} body differs from dist`);
  }
});

test('/demo/ gets the iframe CSP exactly once', async () => {
  const response = await request('/demo/');
  assert.equal(response.status, 200);
  assertSecurityHeaders(response.headers, DEMO_CSP);
  assert.deepEqual(response.headers.get('cache-control'), ['no-cache']);
});

test('/site-config.js is marked no-cache everywhere including Pragma', async () => {
  const response = await request('/site-config.js');
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.get('cache-control'), ['no-cache, no-store, must-revalidate']);
  assert.deepEqual(response.headers.get('pragma'), ['no-cache']);
});

test('unpublished and private paths return the custom 404 page', async () => {
  const dist = tempDirs[0];
  const privatePaths = [
    '/does-not-exist',
    '/scripts/feedback-service.mjs',
    '/ops/FEEDBACK.md',
    '/DEPLOYMENT.md',
    '/admin/',
    '/downloads/x.zip',
    '/releases/gravityport/latest.json',
    '/domain-changed.html',
    '/README.md',
  ];
  for (const pathname of privatePaths) {
    const response = await request(pathname);
    assert.equal(response.status, 404, `${pathname} must 404, got ${response.status}`);
    assert.deepEqual(response.body, readFileSync(path.join(dist, '404.html')), `${pathname} must serve 404.html`);
    assertSecurityHeaders(response.headers);
    assert.deepEqual(
      response.headers.get('cache-control'),
      ['no-store'],
      `${pathname} 404 must use the Pages default no-store`,
    );
  }
});

test('index.html URLs redirect to their directory with the same headers', async () => {
  const redirects = new Map([
    ['/index.html', '/'],
    ['/en/index.html', '/en/'],
    ['/en/privacy/index.html', '/en/privacy/'],
    ['/privacy/index.html', '/privacy/'],
    ['/guide/index.html', '/guide/'],
    ['/demo/index.html', '/demo/'],
    ['/404.html', '/404'],
  ]);
  for (const [from, location] of redirects) {
    const response = await request(from);
    assert.equal(response.status, 308, `${from} must 308, got ${response.status}`);
    assert.deepEqual(response.headers.get('location'), [location], `${from} must redirect to ${location}`);
    assertSecurityHeaders(response.headers, from.startsWith('/demo') ? DEMO_CSP : DEFAULT_CSP);
  }
  // The redirect of an index.html URL carries the page's no-cache.
  assert.deepEqual((await request('/privacy/index.html')).headers.get('cache-control'), ['no-cache']);
});

test('the Google verification file answers 200 at its .html URL, without a redirect', async () => {
  const dist = tempDirs[0];
  const response = await request('/google7924b9f0fcdd77fd.html');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, readFileSync(path.join(dist, 'google7924b9f0fcdd77fd.html')));
  assertSecurityHeaders(response.headers);
});

test('/404 serves the 404 page as a plain asset', async () => {
  const dist = tempDirs[0];
  const response = await request('/404');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, readFileSync(path.join(dist, '404.html')));
  assertSecurityHeaders(response.headers);
});

test('Pages config files are not site content', async () => {
  const headers = await request('/_headers');
  // Not served as an asset: wrangler dev answers 502; production Pages strips
  // the file from the upload and answers 404. Either way it is not content.
  assert.notEqual(headers.status, 200, '/_headers must not be served as a regular asset');

  const routes = await request('/_routes.json');
  // wrangler dev still publishes _routes.json as an asset; on production
  // Pages this may 404 instead. Re-check on pages.dev after A1.
  assert.equal(routes.status, 200);
  assert.deepEqual(routes.body, readFileSync(path.join(tempDirs[0], '_routes.json')));
  assertSecurityHeaders(routes.headers);
});
