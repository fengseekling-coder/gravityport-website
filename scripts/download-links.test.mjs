import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { loadStrings } from "./build-en-page.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

function loadLinks() {
  const window = {};
  vm.runInNewContext(read("site/download-links.js"), { window, URL, URLSearchParams }, { filename: "site/download-links.js" });
  return window.GP_DOWNLOAD_LINKS;
}

const links = loadLinks();
const DMG = "https://gravityport.azhuilab.com/downloads/GravityPort-darwin-arm64-0.3.3.dmg";

test("a campaign tag is read from the page address only when it is a valid tag", () => {
  assert.equal(links.campaignRef("?ref=bilibili_makerjackie"), "bilibili_makerjackie");
  assert.equal(links.campaignRef("?lang=en&ref=reddit.codex-1"), "reddit.codex-1");
  assert.equal(links.campaignRef("?ref=%20xhs%20"), "xhs");
  assert.equal(links.campaignRef(""), "");
  assert.equal(links.campaignRef("?ref="), "");
  assert.equal(links.campaignRef("?ref=two%20words"), "");
  assert.equal(links.campaignRef("?ref=a/b"), "");
  assert.equal(links.campaignRef(`?ref=${"a".repeat(65)}`), "");
  assert.equal(links.campaignRef(`?ref=${"a".repeat(64)}`), "a".repeat(64));
});

test("download links carry the page's campaign tag", () => {
  assert.equal(links.withRef(DMG, "xhs"), `${DMG}?ref=xhs`);
  assert.equal(links.withRef(`${DMG}?ref=old`, "new"), `${DMG}?ref=new`);
  assert.equal(links.withRef(DMG, ""), DMG);
  assert.equal(links.withRef("", "xhs"), "");
  assert.equal(
    links.withRef("./downloads/GravityPort-Web-Capture-0.15.37.zip", "xhs", "https://gravityport.azhuilab.com/en/"),
    "https://gravityport.azhuilab.com/en/downloads/GravityPort-Web-Capture-0.15.37.zip?ref=xhs",
  );
});

test("phones and tablets are told apart from computers", () => {
  const handheld = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", 5],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.61(0x18003d2b) NetType/WIFI Language/zh_CN", 5],
    ["Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36", 5],
    ["Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36", 10],
    ["Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile", 5],
    ["Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1", 5],
    // iPadOS Safari asks for the desktop site by default.
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", 5],
  ];
  for (const [ua, touchPoints] of handheld) assert.equal(links.isHandheld(ua, touchPoints), true, ua);

  const computers = [
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15", 0],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", 0],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", 10],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", 0],
  ];
  for (const [ua, touchPoints] of computers) assert.equal(links.isHandheld(ua, touchPoints), false, ua);

  assert.equal(links.isHandheld("", 0, true), true, "client hints say mobile");
  assert.equal(links.isHandheld(undefined, undefined, undefined), false);
});

test("the handoff address opens this page's download sheet with a channel tag", () => {
  assert.equal(
    links.handoffUrl("https://gravityport.azhuilab.com/?from=singlemessage&isappinstalled=0", ""),
    "https://gravityport.azhuilab.com/?ref=phone#download",
  );
  assert.equal(
    links.handoffUrl("https://gravityport.azhuilab.com/en/?ref=xhs#faq", "xhs"),
    "https://gravityport.azhuilab.com/en/?ref=xhs#download",
  );
});

test("both home pages ship the handoff dialog and load the link helpers before the page script", () => {
  for (const page of ["index.html", "en/index.html"]) {
    const html = read(page);
    const helpers = html.search(/<script src="[^"]*site\/download-links\.js\?v=[^"]+" defer><\/script>/);
    const press = html.search(/<script src="[^"]*site\/press\.js\?v=[^"]+" defer><\/script>/);
    assert.ok(helpers > 0 && helpers < press, `${page} loads site/download-links.js before site/press.js`);
    for (const hook of ["data-handoff-dialog", "data-handoff-url", "data-handoff-copy", "data-handoff-status", "data-handoff-anyway"]) {
      assert.ok(html.includes(hook), `${page} has ${hook}`);
    }
  }
  const strings = loadStrings(read("site/strings.js"));
  const keys = ["title", "body", "hint", "copy", "copied", "copyFailed", "anyway", "close"].map((k) => `handoff.${k}`);
  for (const lang of ["zh", "en"]) {
    for (const key of keys) assert.ok(strings[lang][key], `${lang} has ${key}`);
  }
});
