import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { checkCacheTagBumps, taggedReferences } from "./check-cache-tags.mjs";
import { main } from "./site-release-prepare.mjs";

const PAGE_HEAD = (prefix, tag) => [
  "<!doctype html>",
  `<link rel="stylesheet" href="${prefix}site/press.css?v=20261113-winhint" />`,
  `<script src="${prefix}site/strings.js?v=${tag}" defer></script>`,
  `<script src="https://example.com/remote.js?v=1"></script>`,
  "",
].join("\n");

const PAGES = {
  "index.html": "./",
  "privacy/index.html": "../",
  "en/index.html": "../",
  "en/privacy/index.html": "../../",
};

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A throwaway repository whose `base` branch plays origin/main: four pages load
// site/strings.js and site/press.css with a ?v= tag.
function makeRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "gp-478-cache-tags-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "base");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Cache Tag Test");
  for (const [page, prefix] of Object.entries(PAGES)) write(root, page, PAGE_HEAD(prefix, "20261113-winhint"));
  write(root, "site/strings.js", "window.GP_STRINGS = { zh: {}, en: {} };\n");
  write(root, "site/press.css", "body { color: black; }\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  git(root, "checkout", "-q", "-b", "work");
  return root;
}

function bumpTag(root, page, tag) {
  const path = join(root, page);
  writeFileSync(path, readFileSync(path, "utf8").replace("strings.js?v=20261113-winhint", `strings.js?v=${tag}`));
}

test("taggedReferences resolves page-relative paths and skips remote URLs", () => {
  const refs = taggedReferences("en/privacy/index.html", PAGE_HEAD("../../", "a"));
  assert.deepEqual([...refs.keys()].sort(), ["site/press.css", "site/strings.js"]);
  assert.deepEqual([...refs.get("site/strings.js")], ["a"]);
});

test("a changed site file whose tag stayed the same is reported once per page, naming the file", (t) => {
  const root = makeRepo(t);
  write(root, "site/strings.js", "window.GP_STRINGS = { zh: { a: 1 }, en: {} };\n");
  const { base, skipped, problems } = checkCacheTagBumps({ root, baseRef: "base" });
  assert.ok(base);
  assert.equal(skipped, null);
  assert.equal(problems.length, 4);
  for (const problem of problems) assert.equal(problem.file, "site/strings.js");
  const pages = problems.map((problem) => /但 (\S+) 引用它/.exec(problem.message)[1]).sort();
  assert.deepEqual(pages, Object.keys(PAGES).sort());
  assert.match(problems.find((problem) => problem.message.includes("en/index.html")).message, /build-en-page/);
});

test("bumping only the Chinese home page still reports the pages that kept the old tag", (t) => {
  const root = makeRepo(t);
  write(root, "site/strings.js", "window.GP_STRINGS = { zh: { a: 1 }, en: {} };\n");
  bumpTag(root, "index.html", "20261127-strings");
  const pages = checkCacheTagBumps({ root, baseRef: "base" }).problems.map((problem) => /但 (\S+) 引用它/.exec(problem.message)[1]).sort();
  assert.deepEqual(pages, ["en/index.html", "en/privacy/index.html", "privacy/index.html"]);
});

test("a new tag on every page passes, and so does an untouched file or a committed change", (t) => {
  const root = makeRepo(t);
  assert.deepEqual(checkCacheTagBumps({ root, baseRef: "base" }).problems, [], "nothing changed");
  write(root, "site/strings.js", "window.GP_STRINGS = { zh: { a: 1 }, en: {} };\n");
  for (const page of Object.keys(PAGES)) bumpTag(root, page, "20261127-strings");
  assert.deepEqual(checkCacheTagBumps({ root, baseRef: "base" }).problems, []);
  git(root, "commit", "-q", "-am", "bump");
  assert.deepEqual(checkCacheTagBumps({ root, baseRef: "base" }).problems, [], "the check reads the tree, committed or not");
});

test("a committed change without a new tag is caught too", (t) => {
  const root = makeRepo(t);
  write(root, "site/press.css", "body { color: red; }\n");
  git(root, "commit", "-q", "-am", "restyle");
  const { problems } = checkCacheTagBumps({ root, baseRef: "base" });
  assert.equal(problems.length, 4);
  for (const problem of problems) assert.equal(problem.file, "site/press.css");
});

test("a missing base ref or a non-git folder skips the check and says why", (t) => {
  const root = makeRepo(t);
  write(root, "site/strings.js", "changed\n");
  const missing = checkCacheTagBumps({ root, baseRef: "origin/main" });
  assert.deepEqual(missing.problems, []);
  assert.match(missing.skipped, /找不到 origin\/main/);

  const plain = mkdtempSync(join(tmpdir(), "gp-478-plain-"));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  const outside = checkCacheTagBumps({ root: plain, baseRef: "base" });
  assert.equal(outside.base, null);
  assert.match(outside.skipped, /跳过缓存号检查/);
});

test("site-release-prepare --check --base fails on a stale tag and rejects --base without --check", (t) => {
  const root = makeRepo(t);
  write(root, "site/strings.js", "window.GP_STRINGS = { zh: { a: 1 }, en: {} };\n");
  const errors = [];
  const originalError = console.error;
  console.error = (line) => errors.push(String(line));
  try {
    // The fixture has no site-config.js, so the release checks fail as well;
    // only the cache-tag lines matter here.
    assert.equal(main(["--check", "--root", root, "--base", "base"]), 1);
    assert.equal(main(["--app", "1.0.0", "--base", "base"]), 2);
  } finally {
    console.error = originalError;
  }
  assert.ok(errors.some((line) => /^site\/strings\.js: 内容相对 base 改了，但 index\.html 引用它的 \?v=20261113-winhint 没换/.test(line)));
});
