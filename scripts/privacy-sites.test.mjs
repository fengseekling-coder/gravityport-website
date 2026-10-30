// Pins the privacy pages' extension section to the Web Capture extension manifest.
// scripts/fixtures/extension-manifest-sites.json is a snapshot of the manifest on the app
// repository's main branch (extensions/chatgpt-web-capture/manifest.json): sites are the
// content_scripts match hostnames, permissions are kept as-is. When the manifest moves on,
// regenerate the snapshot with:
//   git -C ../gravityport show origin/main:extensions/chatgpt-web-capture/manifest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);const sites=[...new Set((m.content_scripts??[]).flatMap(c=>c.matches??[]).map(u=>new URL(u).hostname))].sort();process.stdout.write(JSON.stringify({manifestVersion:m.version,sites,permissions:m.permissions},null,2)+"\n")})' > scripts/fixtures/extension-manifest-sites.json
// Do not read ../gravityport by default: that checkout is deliberately held back, so it is
// only consulted through GRAVITYPORT_EXTENSION_MANIFEST below.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadPrivacyStrings, loadStrings } from "./build-en-page.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const snapshot = JSON.parse(read("scripts/fixtures/extension-manifest-sites.json"));
const strings = loadStrings(read("site/strings.js"));
const privacyStrings = loadPrivacyStrings(read("site/privacy-strings.js"), strings);
const zhHtml = read("privacy/index.html");
const enHtml = read("en/privacy/index.html");

// Hostname → the names the privacy pages show for it. A hostname in the snapshot that is
// missing here fails the test: add the site to this table AND to both language versions of
// pp.ext.body before merging. Hostnames in the table without a snapshot entry are fine.
const DISPLAY_NAMES = {
  "chatgpt.com": { zh: "ChatGPT", en: "ChatGPT" },
  "chat.openai.com": { zh: "ChatGPT", en: "ChatGPT" },
  "gemini.google.com": { zh: "Gemini", en: "Gemini" },
  "labs.google": { zh: "Flow", en: "Flow" },
  "flow.google.com": { zh: "Flow", en: "Flow" },
  "aistudio.google.com": { zh: "Google AI Studio", en: "Google AI Studio" },
  "jimeng.jianying.com": { zh: "即梦", en: "Jimeng" },
  "www.midjourney.com": { zh: "Midjourney", en: "Midjourney" },
};

// The names whose every hostname is absent from the snapshot must not show up on the page,
// or the page would list sites the extension does not run on.
const ORPHAN_NAMES = () => {
  const backed = new Set();
  for (const host of snapshot.sites) {
    const names = DISPLAY_NAMES[host];
    if (names) { backed.add(names.zh); backed.add(names.en); }
  }
  const orphans = { zh: new Set(), en: new Set() };
  for (const names of Object.values(DISPLAY_NAMES)) {
    if (!backed.has(names.zh)) orphans.zh.add(names.zh);
    if (!backed.has(names.en)) orphans.en.add(names.en);
  }
  return orphans;
};

// Permissions are written in <code> so "storage" is not satisfied by "unlimitedStorage".
const checkBody = (label, body, lang) => {
  for (const host of snapshot.sites) {
    const names = DISPLAY_NAMES[host];
    assert.ok(names, `${label}: add a display name for ${host} to the table at the top of this file`);
    assert.ok(body.includes(names[lang]), `${label}: ${label === "pp.ext.body" ? "the strings" : "the raw HTML"} must name ${names[lang]} (from ${host})`);
  }
  for (const name of ORPHAN_NAMES()[lang]) {
    assert.ok(!body.includes(name), `${label}: ${name} is not in the manifest snapshot but appears in the extension section`);
  }
  for (const perm of snapshot.permissions) {
    assert.ok(body.includes(`<code>${perm}</code>`), `${label}: the permission ${perm} must appear`);
  }
};

test("the privacy strings name every extension site and permission, and no others", () => {
  checkBody("pp.ext.body", privacyStrings.zh["pp.ext.body"], "zh");
  checkBody("pp.ext.body", privacyStrings.en["pp.ext.body"], "en");
});

test("the raw privacy HTML matches the strings on sites and permissions", () => {
  const raw = (html) => {
    const m = html.match(/data-i18n-html="pp\.ext\.body">([\s\S]*?)<\/div>/);
    assert.ok(m, "the pp.ext.body element is present");
    return m[1];
  };
  checkBody("zh privacy/index.html", raw(zhHtml), "zh");
  checkBody("en en/privacy/index.html", raw(enHtml), "en");
});

test("GRAVITYPORT_EXTENSION_MANIFEST (when set) still matches the snapshot", (t) => {
  const manifestPath = process.env.GRAVITYPORT_EXTENSION_MANIFEST;
  if (!manifestPath) {
    t.skip("set GRAVITYPORT_EXTENSION_MANIFEST to an exported manifest.json to check it against the snapshot");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const sites = [...new Set((manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? []).map((pattern) => {
    try { return new URL(pattern).hostname; } catch {
      assert.fail(`unparseable match pattern ${pattern}: regenerate scripts/fixtures/extension-manifest-sites.json by hand`);
    }
  }))].sort();
  assert.deepEqual(sites, snapshot.sites, "the manifest sites moved on: regenerate scripts/fixtures/extension-manifest-sites.json (command at the top of this file)");
  assert.deepEqual(manifest.permissions, snapshot.permissions, "the manifest permissions moved on: regenerate scripts/fixtures/extension-manifest-sites.json");
});
