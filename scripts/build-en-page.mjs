#!/usr/bin/env node
// Builds en/index.html, the English home page, from index.html and site/strings.js.
// The body copy is translated at build time with the same rules site/press.js applies
// on load (data-i18n / data-i18n-html / data-i18n-attr), so search engines, link
// previews and readers with scripts off see the English page too; press.js still runs
// afterwards and finds nothing left to change.
// Run after changing index.html or the strings: node scripts/build-en-page.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SITE = "https://gravityport.azhuilab.com";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadStrings(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: "site/strings.js" });
  const strings = sandbox.window.GP_STRINGS;
  if (!strings || !strings.en) throw new Error("site/strings.js did not define GP_STRINGS.en");
  return strings;
}

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replaceOnce(html, pattern, replacement, label) {
  return replaceCount(html, pattern, replacement, label, 1);
}

function replaceCount(html, pattern, replacement, label, expected) {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const hits = (html.match(global) || []).length;
  if (hits !== expected) throw new Error(`expected exactly ${expected} ${label}, found ${hits}`);
  return html.replace(pattern, replacement);
}

/* --- Build-time translation, mirroring applyLang in site/press.js ---
   The elements that carry a content attribute may not nest a same-name tag: the
   close tag is found with a text scan, and a same-name start tag before it throws
   instead of silently producing a broken page (the test suite pins this premise). */

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;

function parseAttrs(rawAttrs) {
  const attrs = new Map();
  for (const m of rawAttrs.matchAll(ATTR_RE)) {
    let value = m[2];
    if (value !== undefined && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    attrs.set(m[1], value ?? "");
  }
  return attrs;
}

function updateAttrs(rawAttrs, updates) {
  let out = "";
  let idx = 0;
  for (const m of rawAttrs.matchAll(ATTR_RE)) {
    out += rawAttrs.slice(idx, m.index);
    out += updates.has(m[1]) ? `${m[1]}="${escapeAttr(updates.get(m[1]))}"` : m[0];
    idx = m.index + m[0].length;
  }
  out += rawAttrs.slice(idx);
  for (const [name, value] of updates) {
    if (!new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:\\s|=|/|$)`).test(rawAttrs)) out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

export function applyStaticI18n(html, strings) {
  const en = strings.en || {};
  const zh = strings.zh || {};
  // Same lookup as press.js's t(): an English value that is undefined or null falls back to Chinese.
  const lookup = (key) => {
    const v = en[key];
    if (v !== undefined && v !== null) return v;
    const z = zh[key];
    return z !== undefined && z !== null ? z : "";
  };
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  let out = "";
  let cursor = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = parseAttrs(m[2]);
    if (!attrs.has("data-i18n") && !attrs.has("data-i18n-html") && !attrs.has("data-i18n-attr")) continue;
    const updates = new Map();
    const attrSpec = attrs.get("data-i18n-attr");
    if (attrSpec !== undefined) {
      attrSpec.split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key && lookup(key)) updates.set(attr, lookup(key));
      });
    }
    // applyLang runs its data-i18n pass before its data-i18n-html pass, so the HTML value wins when both are set.
    let content = null;
    let contentKey = "";
    const textKey = attrs.get("data-i18n");
    if (textKey !== undefined) {
      const v = lookup(textKey);
      if (v !== "" || attrs.has("data-i18n-empty-ok")) { content = escapeText(String(v)); contentKey = textKey; }
      else if ((attrs.get("class") || "").split(/\s+/).includes("slug__gloss")) { content = ""; contentKey = textKey; }
    }
    const rawKey = attrs.get("data-i18n-html");
    if (rawKey !== undefined) {
      const v = lookup(rawKey);
      if (v) { content = String(v); contentKey = rawKey; }
    }
    out += html.slice(cursor, m.index);
    out += `<${m[1]}${updates.size ? updateAttrs(m[2], updates) : m[2]}>`;
    if (content === null) {
      cursor = tagRe.lastIndex; // attribute-only change: keep translating inside the element
      continue;
    }
    const name = m[1].toLowerCase();
    if (VOID_ELEMENTS.has(name)) throw new Error(`<${m[1]}> carries data-i18n but cannot hold content`);
    const after = tagRe.lastIndex;
    const rest = html.slice(after);
    const close = new RegExp(`</${name}\\s*>`, "i").exec(rest);
    if (!close) throw new Error(`no closing </${name}> for the element with data-i18n="${contentKey}"`);
    if (new RegExp(`<${name}[\\s>/]`, "i").test(rest.slice(0, close.index))) {
      throw new Error(`a <${name}> nests inside the element with data-i18n="${contentKey}"; the static translation cannot match applyLang there`);
    }
    out += content + close[0];
    cursor = after + close.index + close[0].length; // content is replaced wholesale, as textContent/innerHTML would
    tagRe.lastIndex = cursor;
  }
  out += html.slice(cursor);
  return out;
}

/* --- Structured data ---
   The Chinese page carries a literal JSON-LD block; the English page swaps it for this one.
   The @ids are shared across both pages (same entities); the descriptions come from the same
   strings the meta tags use, so they cannot drift. No softwareVersion, rating, review, FAQPage,
   HowTo or SearchAction: none of that exists on the page, and a stale version would be worse. */
function englishJsonLd(en) {
  const image = `${SITE}/assets/og/gravityport-og-1200x630.jpg`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE}/#organization`,
        "name": "azhuilab",
        "url": `${SITE}/`
      },
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        "url": `${SITE}/`,
        "name": "GravityPort",
        "inLanguage": ["en", "zh-CN"],
        "publisher": { "@id": `${SITE}/#organization` }
      },
      {
        "@type": "WebPage",
        "@id": `${SITE}/en/#webpage`,
        "url": `${SITE}/en/`,
        "name": en["meta.title"],
        "description": en["meta.description"],
        "inLanguage": "en",
        "isPartOf": { "@id": `${SITE}/#website` },
        "about": { "@id": `${SITE}/#app` },
        "primaryImageOfPage": {
          "@type": "ImageObject",
          "url": image,
          "width": 1200,
          "height": 630
        }
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE}/#app`,
        "name": "GravityPort",
        "url": `${SITE}/en/`,
        "description": en["meta.description"],
        "applicationCategory": "MultimediaApplication",
        "operatingSystem": "macOS (Apple silicon), Windows 10, Windows 11",
        "inLanguage": ["en", "zh-CN"],
        "image": image,
        "downloadUrl": `${SITE}/en/#download`,
        "sameAs": ["https://github.com/fengseekling-coder/gravityport"],
        "author": { "@id": `${SITE}/#organization` },
        "publisher": { "@id": `${SITE}/#organization` },
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
          "availability": "https://schema.org/InStock"
        }
      }
    ]
  }, null, 2);
}

export function buildEnglishPage(indexHtml, strings) {
  const en = strings.en;
  for (const key of ["meta.title", "meta.description", "meta.ogImageAlt"]) {
    if (!en[key]) throw new Error(`GP_STRINGS.en is missing ${key}`);
  }
  let html = indexHtml;
  html = replaceOnce(html, /<html lang="zh-CN"([^>]*) data-page-lang="zh" data-site-root="\.\/">/,
    (_, rest) => `<html lang="en"${rest} data-page-lang="en" data-site-root="../">`, "<html> tag");
  html = replaceOnce(html, /<title data-i18n="meta\.title">[^<]*<\/title>/,
    `<title data-i18n="meta.title">${escapeText(en["meta.title"])}</title>`, "<title>");
  const setContent = (selector, value, label) => {
    html = replaceOnce(html, new RegExp(`(<meta ${selector}[^>]* content=")[^"]*(")`),
      (_, a, b) => `${a}${escapeAttr(value)}${b}`, label);
  };
  setContent('name="description"', en["meta.description"], "meta description");
  setContent('property="og:locale"', "en_US", "og:locale");
  setContent('property="og:title"', en["meta.title"], "og:title");
  setContent('property="og:description"', en["meta.description"], "og:description");
  setContent('property="og:url"', `${SITE}/en/`, "og:url");
  setContent('property="og:image:alt"', en["meta.ogImageAlt"], "og:image:alt");
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${SITE}/en/" />`, "canonical link");
  // The privacy pages get their own English twins (/en/privacy/), so these links stay inside
  // /en/ instead of being rewritten to the Chinese page one level up.
  html = replaceCount(html, /(\shref=")\.\/privacy\//g, "$1privacy/", "privacy links", 2);
  // en/ sits one level down.
  html = html.replace(/(\s(?:href|src)=")\.\//g, "$1../");
  html = html.replace(/(\ssrcset=")([^"]*)(")/g, (_, a, list, b) => `${a}${list.replace(/(^|,\s*)\.\//g, "$1../")}${b}`);
  // The language toggle is a real link to the other language: on this page, the Chinese home.
  html = replaceOnce(html, /(\shref=")\/en\/(" data-lang-toggle)/, "$1/$2", "language toggle link");
  // Structured data: swap the Chinese JSON-LD block for the English one.
  html = replaceOnce(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n${englishJsonLd(en).replace(/^/gm, "    ")}\n    </script>`, "JSON-LD block");
  // Translate the copy the way applyLang would, so the page is English before any script runs.
  html = applyStaticI18n(html, strings);
  html = replaceOnce(html, /^<!doctype html>\n/i,
    "<!doctype html>\n<!-- Generated by scripts/build-en-page.mjs from index.html and site/strings.js. Do not edit; run node scripts/build-en-page.mjs. -->\n",
    "doctype");
  return html;
}

export function loadPrivacyStrings(source, strings) {
  const merged = { zh: { ...strings.zh }, en: { ...strings.en } };
  const sandbox = { window: { GP_STRINGS: merged } };
  vm.runInNewContext(source, sandbox, { filename: "site/privacy-strings.js" });
  return merged;
}

/* --- English privacy page (/en/privacy/) ---
   The Chinese privacy page switches language in place; the English twin is the same page with
   the English copy baked in. It keeps no data-page-lang of its own, so boot.js still only
   switches in place and never auto-redirects. The page sits one level deeper than /privacy/,
   so site files go two levels up while links to the home page point at /en/. */
export function buildEnglishPrivacyPage(privacyHtml, strings) {
  const en = strings.en;
  for (const key of ["pp.meta.title", "pp.meta.description"]) {
    if (!en[key]) throw new Error(`GP_STRINGS.en is missing ${key}`);
  }
  let html = privacyHtml;
  html = replaceOnce(html, /<html lang="zh-CN"([^>]*)>/,
    (_, rest) => `<html lang="en"${rest}>`, "<html> tag");
  html = replaceOnce(html, /<title data-i18n="pp\.meta\.title">[^<]*<\/title>/,
    `<title data-i18n="pp.meta.title">${escapeText(en["pp.meta.title"])}</title>`, "<title>");
  html = replaceOnce(html, /(<meta name="description"[^>]* content=")[^"]*(")/,
    (_, a, b) => `${a}${escapeAttr(en["pp.meta.description"])}${b}`, "meta description");
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${SITE}/en/privacy/" />`, "canonical link");
  // The toggle links to the Chinese privacy page.
  html = replaceOnce(html, /(\shref=")\/en\/privacy\/(" data-lang-toggle)/, "$1/privacy/$2", "language toggle link");
  // Links to the home page go to the English home; everything else at ../ is a site file,
  // which sits one level further up from /en/privacy/ than from /privacy/.
  html = replaceCount(html, /(\shref=")\.\.\/(")/g, "$1/en/$2", "home links", 2);
  html = replaceCount(html, /(\shref=")\.\.\/(#)/g, "$1/en/$2", "home anchor links", 7);
  html = html.replace(/(\s(?:href|src)=")\.\.\//g, "$1../../");
  // Translate the copy the way applyLang would, so the page is English before any script runs.
  html = applyStaticI18n(html, strings);
  html = replaceOnce(html, /^<!doctype html>\n/i,
    "<!doctype html>\n<!-- Generated by scripts/build-en-page.mjs from privacy/index.html and site/privacy-strings.js. Do not edit; run node scripts/build-en-page.mjs. -->\n",
    "doctype");
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
  const strings = loadStrings(readFileSync(join(repoRoot, "site/strings.js"), "utf8"));
  mkdirSync(join(repoRoot, "en"), { recursive: true });
  writeFileSync(join(repoRoot, "en/index.html"), buildEnglishPage(indexHtml, strings));
  console.log("wrote en/index.html");
  const privacyHtml = readFileSync(join(repoRoot, "privacy/index.html"), "utf8");
  const privacyStrings = loadPrivacyStrings(readFileSync(join(repoRoot, "site/privacy-strings.js"), "utf8"), strings);
  mkdirSync(join(repoRoot, "en/privacy"), { recursive: true });
  writeFileSync(join(repoRoot, "en/privacy/index.html"), buildEnglishPrivacyPage(privacyHtml, privacyStrings));
  console.log("wrote en/privacy/index.html");
}
