import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { applyStaticI18n, buildEnglishPage, loadStrings } from "./build-en-page.mjs";

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

test("the static English page carries the English copy for each i18n mechanism", () => {
  // Asserted against a fresh build, so the spot checks fail when the build stops translating.
  const built = buildEnglishPage(zhPage, strings);
  // data-i18n: the element text is the English string.
  assert.ok(built.includes(`<a class="skip" href="#main" data-i18n="nav.skip">${strings.en["nav.skip"]}</a>`),
    "the skip link should carry the English text");
  // data-i18n-html: the inner HTML is the English string, markup included.
  assert.ok(built.includes(`<p data-i18n-html="install.s2.body">${strings.en["install.s2.body"]}</p>`),
    "the install step should carry the English HTML");
  // data-i18n-attr: the attribute value is the English string, as setAttribute would leave it.
  const img = built.match(/<img [^>]*data-i18n-attr="alt:context\.artAlt"[^>]*>/)[0];
  const alt = img.match(/ alt="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<");
  assert.equal(alt, strings.en["context.artAlt"]);
});

// Copy that stays Chinese on /en/ on purpose, or that no data-i18n attribute covers:
// the author's own words are quoted in Chinese (lang="zh-CN") on both pages, the
// language toggle shows the language it switches to, the organize demo counter is
// written by press.js at runtime, and two official English strings quote Chinese
// UI labels. Everything else must be English.
const CHINESE_WHITELIST = [
  '<span data-lang-option="zh">中</span>',
  "好一些了，但整体太暗，有点压抑。把时间改成黎明前，天空从深蓝渐变到地平线处很淡的粉，海面多一点冷光，丝带和飞鸟保持现在的样子。",
  "n=2 3:4，实验性商业艺术海报，主视觉媒介为高细节 3D/CG 超现实合成，复古杂志编排结合感官故障美学与高饱和食品视觉。米白纸张底色占大面积，带轻微纤维纹理、扫描颗粒和细横向印刷线……",
  "鸟太多了，看着有点乱，只留三五只就好。丝带再细一点、更轻盈，像一根发光的丝线。其他保持不变。",
  "好一些了，但整体太暗，有点压抑…",
  "12 个素材",
  strings.en["download.first.ext"],
  strings.en["install.s4.body"],
];

test("the static English page keeps no Chinese copy beyond the whitelist", () => {
  const body = enPage.slice(enPage.indexOf("<body"), enPage.indexOf("</body>"));
  const stripped = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
  let rest = stripped;
  for (const kept of CHINESE_WHITELIST) {
    assert.ok(rest.includes(kept), `whitelisted Chinese is missing from the page: ${kept.slice(0, 40)}…`);
    rest = rest.split(kept).join("");
  }
  const leftover = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.exec(rest);
  if (leftover) {
    const at = leftover.index;
    assert.fail(`unexpected CJK character ${rest[at]} remains: …${rest.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, " ")}…`);
  }
});

test("every i18n element on the home page is statically translatable", () => {
  // applyStaticI18n throws when a data-i18n element nests a same-name tag or a void
  // element carries a content key, so a clean run asserts the premise the build relies on.
  assert.equal(typeof applyStaticI18n(zhPage, strings), "string");
});

test("applyStaticI18n follows the applyLang rules for empty and missing English values", () => {
  const s = { zh: { "a.key": "中文", "b.key": "中文" }, en: { "a.key": "English", "gone.key": "", "attr.key": "" } };
  assert.equal(applyStaticI18n('<p data-i18n="a.key">中文</p>', s), '<p data-i18n="a.key">English</p>');
  // An empty English value keeps the source copy…
  assert.equal(applyStaticI18n('<p data-i18n="gone.key">中文</p>', s), '<p data-i18n="gone.key">中文</p>');
  // …unless data-i18n-empty-ok clears it, or the element is a slug gloss.
  assert.equal(applyStaticI18n('<p data-i18n="gone.key" data-i18n-empty-ok>中文</p>', s), '<p data-i18n="gone.key" data-i18n-empty-ok></p>');
  assert.equal(applyStaticI18n('<p class="slug__gloss" data-i18n="gone.key">中文</p>', s), '<p class="slug__gloss" data-i18n="gone.key"></p>');
  // A key that English lacks falls back to Chinese, like press.js's t().
  assert.equal(applyStaticI18n('<p data-i18n="b.key">旧文</p>', s), '<p data-i18n="b.key">中文</p>');
  // data-i18n-html goes in raw, and an empty English value keeps the source.
  assert.equal(applyStaticI18n('<div data-i18n-html="a.key">x</div>', s), '<div data-i18n-html="a.key">English</div>');
  assert.equal(applyStaticI18n('<div data-i18n-html="gone.key"><b>中文</b></div>', s), '<div data-i18n-html="gone.key"><b>中文</b></div>');
  // data-i18n-attr rewrites the listed attributes and leaves them alone when the value is empty.
  assert.equal(applyStaticI18n('<img data-i18n-attr="alt:attr.key" alt="中文" src="x.png">', s), '<img data-i18n-attr="alt:attr.key" alt="中文" src="x.png">');
  // The close tag of a translated element survives; siblings after it keep working.
  assert.equal(applyStaticI18n('<li><strong data-i18n="a.key">中文</strong> rest</li>', s), '<li><strong data-i18n="a.key">English</strong> rest</li>');
  // A same-name tag inside a translated element is refused, not silently mis-translated.
  assert.throws(() => applyStaticI18n('<div data-i18n="a.key"><div>x</div></div>', s), /nests/);
  assert.throws(() => applyStaticI18n('<img data-i18n="a.key">', s), /cannot hold content/);
});
