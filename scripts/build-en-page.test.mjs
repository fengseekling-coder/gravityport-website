import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { buildEnglishPage, loadStrings } from "./build-en-page.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");
const SITE = "https://gravityport.azhuilab.com";
const OG_IMAGE = `${SITE}/assets/og/gravityport-og-1200x630.jpg`;

const strings = loadStrings(read("site/strings.js"));
const zhPage = read("index.html");
const enPage = read("en/index.html");
const metaContent = (html, selector) => {
  const m = html.match(new RegExp(`<meta ${selector}[^>]* content="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
};

test("en/index.html is up to date with index.html and site/strings.js", () => {
  assert.equal(enPage, buildEnglishPage(zhPage, strings), "run: node scripts/build-en-page.mjs");
});

test("the English page declares English in its head and resolves files one level up", () => {
  assert.match(enPage, /<html lang="en"[^>]* data-page-lang="en" data-site-root="\.\.\/">/);
  assert.match(enPage, new RegExp(`<title data-i18n="meta.title">${strings.en["meta.title"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
  assert.equal(metaContent(enPage, 'name="description"'), strings.en["meta.description"]);
  assert.equal(metaContent(enPage, 'property="og:title"'), strings.en["meta.title"]);
  assert.equal(metaContent(enPage, 'property="og:locale"'), "en_US");
  assert.equal(metaContent(enPage, 'property="og:url"'), `${SITE}/en/`);
  assert.match(enPage, new RegExp(`<link rel="canonical" href="${SITE}/en/" />`));
  assert.doesNotMatch(enPage, /="\.\//, "no page-relative ./ links may remain");
  assert.doesNotMatch(enPage, /(?:^|,\s*|")\.\/assets\//m, "srcset entries are rewritten too");
});

test("both home pages carry hreflang, the share image and a large Twitter card", () => {
  assert.match(zhPage, /<html lang="zh-CN"[^>]* data-page-lang="zh" data-site-root="\.\/">/);
  for (const page of [zhPage, enPage]) {
    assert.match(page, new RegExp(`<link rel="alternate" hreflang="zh-CN" href="${SITE}/" />`));
    assert.match(page, new RegExp(`<link rel="alternate" hreflang="en" href="${SITE}/en/" />`));
    assert.match(page, new RegExp(`<link rel="alternate" hreflang="x-default" href="${SITE}/en/" />`));
    assert.equal(metaContent(page, 'property="og:image"'), OG_IMAGE);
    assert.equal(metaContent(page, 'property="og:image:width"'), "1200");
    assert.equal(metaContent(page, 'property="og:image:height"'), "630");
    assert.equal(metaContent(page, 'name="twitter:card"'), "summary_large_image");
    assert.equal(metaContent(page, 'name="twitter:image"'), OG_IMAGE);
  }
  assert.equal(metaContent(zhPage, 'property="og:image:alt"'), strings.zh["meta.ogImageAlt"]);
  assert.equal(metaContent(enPage, 'property="og:image:alt"'), strings.en["meta.ogImageAlt"]);
});

function loadRoute() {
  const root = { classList: { add() {}, remove() {} }, getAttribute: () => null, setAttribute() {} };
  const window = { matchMedia: () => ({ matches: true }) };
  const sandbox = {
    window,
    document: { documentElement: root },
    location: { search: "", hash: "", replace() {} },
    localStorage: { getItem: () => null },
    navigator: { language: "en-US" },
    URLSearchParams,
    setTimeout: () => 0,
  };
  vm.runInNewContext(read("site/boot.js"), sandbox, { filename: "site/boot.js" });
  return window.__gpLangRoute;
}

test("the home page language follows the URL", () => {
  const route = loadRoute();
  // [page, search, hash, saved preference, browser language] -> expected
  const cases = [
    [["zh", "?lang=en", "", "", "zh-CN"], "/en/"],
    [["zh", "", "", "en", "zh-CN"], "/en/"],
    [["zh", "", "", "", "en-US"], "/en/"],
    [["zh", "", "", "", "zh-CN"], null],
    [["zh", "", "", "zh", "en-US"], null],
    [["en", "?lang=zh", "", "", "en-US"], "/"],
    [["en", "", "", "zh", "zh-CN"], null],
    [["en", "", "", "", "zh-TW"], null],
    [["zh", "?ref=youtube&lang=en", "#install", "", "zh-CN"], "/en/?ref=youtube#install"],
    [["zh", "?ref=youtube", "", "", "en-US"], "/en/?ref=youtube"],
  ];
  for (const [args, expected] of cases) {
    assert.equal(route(...args), expected, JSON.stringify(args));
  }
});

test("the sitemap lists both home pages and leaves out the redirect pages", () => {
  const sitemap = read("sitemap.xml");
  assert.match(sitemap, new RegExp(`<loc>${SITE}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${SITE}/en/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${SITE}/privacy/</loc>`));
  assert.doesNotMatch(sitemap, /\/guide\/|\/demo\//);
});
