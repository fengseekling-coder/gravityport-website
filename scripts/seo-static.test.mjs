import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildEnglishPage, buildEnglishPrivacyPage, loadPrivacyStrings, loadStrings } from "./build-en-page.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const SITE = "https://gravityport.azhuilab.com";
const GITHUB = "https://github.com/fengseekling-coder/gravityport";

const strings = loadStrings(read("site/strings.js"));
const privacyStrings = loadPrivacyStrings(read("site/privacy-strings.js"), strings);
const zhHome = read("index.html");
const enHome = read("en/index.html");
const zhPrivacy = read("privacy/index.html");
const enPrivacy = read("en/privacy/index.html");

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
const graphNode = (data, type) => data["@graph"].find((node) => node["@type"] === type);

test("both home pages carry exactly one JSON-LD graph with the app entity", () => {
  for (const [name, page] of [["zh", zhHome], ["en", enHome]]) {
    const blocks = jsonLdBlocks(page);
    assert.equal(blocks.length, 1, `${name}: exactly one ld+json block`);
    const data = blocks[0];
    assert.equal(data["@context"], "https://schema.org");
    const types = data["@graph"].map((node) => node["@type"]);
    for (const expected of ["Organization", "WebSite", "WebPage", "SoftwareApplication"]) {
      assert.ok(types.includes(expected), `${name}: @graph has ${expected}`);
    }
    // No rich-result bait: nothing here may be invented, and Google retired FAQ rich results.
    for (const banned of ["FAQPage", "HowTo", "BreadcrumbList", "SearchAction"]) {
      assert.ok(!types.includes(banned), `${name}: no ${banned}`);
    }
    const app = graphNode(data, "SoftwareApplication");
    assert.equal(app.offers.price, "0", `${name}: the app is free`);
    assert.equal(app.offers.priceCurrency, "USD");
    assert.match(app.operatingSystem, /macOS/);
    assert.match(app.operatingSystem, /Windows/);
    assert.deepEqual(app.sameAs, [GITHUB], `${name}: sameAs is the GitHub repo only`);
    assert.equal(graphNode(data, "Organization").name, "azhuilab");
    assert.equal(app.softwareVersion, undefined, `${name}: no softwareVersion (would go stale every release)`);
    assert.equal(app.aggregateRating, undefined, `${name}: no rating`);
    assert.equal(app.review, undefined, `${name}: no review`);
    // The licence is PolyForm Noncommercial, so the markup must not claim open source.
    const raw = JSON.stringify(data);
    assert.ok(!/open source|开源/i.test(raw), `${name}: no open-source claim`);
  }
});

test("the JSON-LD graphs describe the same entities in each page's language", () => {
  const zh = jsonLdBlocks(zhHome)[0];
  const en = jsonLdBlocks(enHome)[0];
  assert.equal(graphNode(en, "WebPage").inLanguage, "en");
  assert.equal(graphNode(zh, "WebPage").inLanguage, "zh-CN");
  // The @ids of the shared entities are identical; only the WebPage is per-page.
  for (const type of ["Organization", "WebSite", "SoftwareApplication"]) {
    assert.equal(graphNode(zh, type)["@id"], graphNode(en, type)["@id"], `${type} @id is shared`);
  }
  assert.equal(graphNode(zh, "WebPage")["@id"], `${SITE}/#webpage`);
  assert.equal(graphNode(en, "WebPage")["@id"], `${SITE}/en/#webpage`);
  // Descriptions come from the same strings as the meta tags, so they cannot drift.
  assert.equal(graphNode(zh, "WebPage").description, strings.zh["meta.description"]);
  assert.equal(graphNode(en, "WebPage").description, strings.en["meta.description"]);
  assert.equal(graphNode(zh, "WebPage").name, strings.zh["meta.title"]);
  assert.equal(graphNode(en, "WebPage").name, strings.en["meta.title"]);
  // downloadUrl points at the on-page anchor, never at a versioned file.
  assert.equal(graphNode(zh, "SoftwareApplication").downloadUrl, `${SITE}/#download`);
  assert.equal(graphNode(en, "SoftwareApplication").downloadUrl, `${SITE}/en/#download`);
});

test("the English home page is regenerated from the same JSON-LD swap the build performs", () => {
  // Rebuilding with the swap disabled must produce a page the tests reject, so the swap
  // cannot silently disappear from the build.
  const swapped = buildEnglishPage(zhHome, strings);
  assert.match(swapped, /"inLanguage": "en"/);
  assert.doesNotMatch(swapped, /每张 AI 图/);
});

// The public pages run under the site CSP (script-src 'self', no unsafe-inline). admin/,
// browser-extension/ and domain-changed.html are separate deliverables with their own serving
// setup and predate this rule; they are not part of the site pages.
const PUBLIC_PAGES = ["index.html", "en/index.html", "privacy/index.html", "en/privacy/index.html", "guide/index.html", "demo/index.html"];

test("the public pages carry no inline scripts or styles beyond JSON-LD data blocks", () => {
  for (const page of PUBLIC_PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
      if (/type="application\/ld\+json"/.test(m[1])) continue; // a data block, never executed
      assert.match(m[1], /\bsrc=/, `${page}: a <script> without src: <script${m[1]}>`);
    }
    assert.doesNotMatch(html, /<style[\s>]/i, `${page}: no inline <style>`);
  }
});

test("en/privacy/index.html is up to date with privacy/index.html and the privacy strings", () => {
  assert.equal(enPrivacy, buildEnglishPrivacyPage(zhPrivacy, privacyStrings), "run: node scripts/build-en-page.mjs");
});

test("the English privacy page declares English with its own canonical and site files two levels up", () => {
  assert.match(enPrivacy, /<html lang="en" class="no-js">/);
  assert.equal(enPrivacy.match(/<title data-i18n="pp\.meta\.title">([^<]*)<\/title>/)[1], privacyStrings.en["pp.meta.title"]);
  assert.match(enPrivacy, new RegExp(`<link rel="canonical" href="${SITE}/en/privacy/" />`));
  assert.doesNotMatch(enPrivacy, /data-page-lang/, "the privacy pages switch in place and never auto-redirect");
  assert.match(enPrivacy, /src="..\/..\/site\/press\.js/);
  assert.match(enPrivacy, /href="..\/..\/assets\//);
  // Links to the home page go to the English home, not the Chinese one.
  assert.equal((enPrivacy.match(/href="\/en\/#/g) || []).length, 7);
  assert.equal((enPrivacy.match(/href="\/en\/"/g) || []).length, 2);
  assert.doesNotMatch(enPrivacy, /href="\.\.\/[#"]/);
});

test("the two privacy pages cross-link with hreflang and the sitemap lists both", () => {
  const expected = [
    ["zh-CN", `${SITE}/privacy/`],
    ["en", `${SITE}/en/privacy/`],
    ["x-default", `${SITE}/en/privacy/`],
  ];
  for (const [name, page] of [["zh", zhPrivacy], ["en", enPrivacy]]) {
    const canonical = page.match(/<link rel="canonical" href="([^"]*)" \/>/)[1];
    const alternates = [...page.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)" \/>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(alternates, expected, `${name}: privacy hreflang mesh`);
    const self = expected.find(([lang]) => (name === "en" ? lang === "en" : lang === "zh-CN"));
    assert.equal(canonical, self[1], `${name}: canonical is its own URL`);
  }
  const sitemap = read("sitemap.xml");
  const privacyEntries = [...sitemap.matchAll(/<url>\s*<loc>([^<]*privacy\/)<\/loc>([\s\S]*?)<\/url>/g)];
  assert.deepEqual(privacyEntries.map((m) => m[1]), [`${SITE}/privacy/`, `${SITE}/en/privacy/`], "sitemap lists both privacy pages");
  for (const entry of privacyEntries) {
    const body = entry[2];
    const alternates = [...body.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)" \/>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(alternates, expected, "sitemap alternates match the HTML tags");
  }
});

test("the English privacy page keeps no Chinese beyond the language toggle", () => {
  const body = enPrivacy.slice(enPrivacy.indexOf("<body"), enPrivacy.indexOf("</body>"));
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  const whitelist = ['<span data-lang-option="zh">中</span>'];
  let rest = stripped;
  for (const kept of whitelist) {
    assert.ok(rest.includes(kept), `whitelisted Chinese is missing from the page: ${kept}`);
    rest = rest.split(kept).join("");
  }
  const leftover = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.exec(rest);
  if (leftover) {
    const at = leftover.index;
    assert.fail(`unexpected CJK character ${rest[at]} remains: …${rest.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ")}…`);
  }
});

test("the language toggle is a real link on all four pages", () => {
  const expected = {
    "index.html": "/en/",
    "en/index.html": "/",
    "privacy/index.html": "/en/privacy/",
    "en/privacy/index.html": "/privacy/",
  };
  for (const [page, href] of Object.entries(expected)) {
    const html = read(page);
    const toggle = html.match(/<a class="lang" [^>]*>/);
    assert.ok(toggle, `${page}: the language toggle is an <a>`);
    assert.ok(toggle[0].includes(`href="${href}" data-lang-toggle`), `${page}: the toggle links to ${href}`);
    assert.match(toggle[0], /aria-label=/, `${page}: the toggle keeps its aria-label`);
    assert.doesNotMatch(html, /<button[^>]*data-lang-toggle/, `${page}: no button toggle remains`);
  }
});

test("the Windows download line matches the strings and what the runtime shows", () => {
  // Since 0.3.4 the Windows release is an installer, so the feed links a .exe and the page
  // script rewrites the line to download.win.detailInstaller. The static line and the fallback
  // key must all say installer, or the raw HTML would disagree with what users see.
  for (const lang of ["zh", "en"]) {
    assert.equal(strings[lang]["download.win.detail"], strings[lang]["download.win.detailInstaller"]);
    assert.ok(!/zip/i.test(strings[lang]["download.win.detail"]));
  }
  assert.equal(strings.zh["download.win.detail"], "x64 · 安装程序");
  assert.equal(strings.en["download.win.detail"], "x64 · installer");
  assert.match(zhHome, /<p data-i18n="download\.win\.detail" data-windows-detail>x64 · 安装程序<\/p>/);
  assert.match(enHome, /<p data-i18n="download\.win\.detail" data-windows-detail>x64 · installer<\/p>/);
  assert.doesNotMatch(zhHome, /便携 ZIP/);
  assert.doesNotMatch(enHome, /portable ZIP/);
});

test("the English home page links the privacy pages inside /en/", () => {
  assert.match(enHome, /href="privacy\/#online"/);
  assert.match(enHome, /href="privacy\/"/);
  assert.doesNotMatch(enHome, /href="\.\.\/privacy\//, "the English home must not link the Chinese privacy page");
});
