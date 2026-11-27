import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSiteConsistency, main, prepareSiteRelease } from "./site-release-prepare.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// The fixture pins its own release state (9.9.1 / 9.15.98, tag 20260101) by running
// the real script once on the copied files, so nothing here depends on which
// version the repo currently carries — that changes on every release.
const FIXED = { app: "9.9.1", nextApp: "9.9.2", ext: "9.15.98", nextExt: "9.15.99", tag: "20260101" };
const FIXTURE_FILES = ["site-config.js", "index.html", "en/index.html", "browser-extension/README.md", "site/strings.js"];

function snapshot(root) {
  const files = {};
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else files[child] = readFileSync(join(root, child));
    }
  };
  walk("");
  return files;
}

function editFixture(root, rel, edit) {
  const path = join(root, rel);
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  assert.notEqual(after, before, `fixture edit on ${rel} must change the text`);
  writeFileSync(path, after);
}

function makeFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gp-446-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const rel of FIXTURE_FILES) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), join(root, rel));
  }
  // The extension zip must exist before a run with --extension; give the fixture
  // the zip for the bootstrap target version, then pin the whole tree to the
  // fixed state with one real run.
  mkdirSync(join(root, "downloads"), { recursive: true });
  writeFileSync(join(root, "downloads", `GravityPort-Web-Capture-${FIXED.ext}.zip`), "fixture zip\n");
  prepareSiteRelease({ root, app: FIXED.app, extension: FIXED.ext, tag: FIXED.tag });
  assert.equal(checkSiteConsistency({ root }).problems.length, 0, "fixture must start consistent");
  return root;
}

test("只给 --app：三段 App 版本、url 和两个首页缓存号改齐，扩展段和 README 不动", (t) => {
  const root = makeFixture(t);
  const readmeBefore = readFileSync(join(root, "browser-extension/README.md"));
  const { changes, wroteFiles } = prepareSiteRelease({ root, app: FIXED.nextApp, tag: "20260102" });

  const config = readFileSync(join(root, "site-config.js"), "utf8");
  assert.equal(config.split(`version: "v${FIXED.nextApp}",`).length - 1, 3);
  assert.ok(config.includes(`./downloads/GravityPort-darwin-arm64-${FIXED.nextApp}.dmg`));
  assert.ok(config.includes(`./downloads/GravityPort-darwin-x64-${FIXED.nextApp}.dmg`));
  assert.ok(config.includes(`./downloads/GravityPort-win32-x64-${FIXED.nextApp}.exe`));
  // The extension section and the README stay untouched when --extension is absent.
  assert.ok(config.includes(`version: "v${FIXED.ext}",`));
  assert.ok(config.includes(`./downloads/GravityPort-Web-Capture-${FIXED.ext}.zip`));
  assert.ok(!config.includes(FIXED.nextExt));
  assert.deepEqual(readFileSync(join(root, "browser-extension/README.md")), readmeBefore);
  assert.equal(readFileSync(join(root, "index.html"), "utf8").includes(`site-config.js?v=20260102-rel-${FIXED.nextApp}`), true);
  assert.equal(readFileSync(join(root, "en/index.html"), "utf8").includes(`site-config.js?v=20260102-rel-${FIXED.nextApp}`), true);
  assert.deepEqual(wroteFiles, ["site-config.js", "index.html", "en/index.html"]);
  assert.equal(changes.some((change) => change.file === "browser-extension/README.md"), false);
});

test("同时给 --extension：扩展段和 README 也改对", (t) => {
  const root = makeFixture(t);
  copyFileSync(join(root, "downloads", `GravityPort-Web-Capture-${FIXED.ext}.zip`), join(root, "downloads", `GravityPort-Web-Capture-${FIXED.nextExt}.zip`));
  const { wroteFiles } = prepareSiteRelease({ root, app: FIXED.nextApp, extension: FIXED.nextExt, tag: "20260102" });

  const config = readFileSync(join(root, "site-config.js"), "utf8");
  assert.ok(config.includes(`version: "v${FIXED.nextExt}",`));
  assert.ok(config.includes(`./downloads/GravityPort-Web-Capture-${FIXED.nextExt}.zip`));
  const readme = readFileSync(join(root, "browser-extension/README.md"), "utf8");
  assert.ok(readme.includes(`downloads/GravityPort-Web-Capture-${FIXED.nextExt}.zip`));
  assert.ok(!readme.includes(FIXED.ext));
  assert.deepEqual(wroteFiles, ["site-config.js", "index.html", "en/index.html", "browser-extension/README.md"]);
});

test("版本降级被拒绝，所有文件逐字节不变", (t) => {
  const root = makeFixture(t);
  const before = snapshot(root);
  assert.throws(() => prepareSiteRelease({ root, app: "9.9.0", tag: FIXED.tag }), /拒绝降级/);
  assert.deepEqual(snapshot(root), before);
});

test("扩展版本降级被拒绝（zip 在也拒绝），所有文件逐字节不变；相等允许", (t) => {
  const root = makeFixture(t);
  writeFileSync(join(root, "downloads", "GravityPort-Web-Capture-9.15.97.zip"), "older fixture zip\n");
  const before = snapshot(root);
  assert.throws(
    () => prepareSiteRelease({ root, app: FIXED.nextApp, extension: "9.15.97", tag: FIXED.tag }),
    /拒绝降级：site-config\.js 当前扩展版本 9\.15\.98/
  );
  assert.deepEqual(snapshot(root), before);
  prepareSiteRelease({ root, app: FIXED.app, extension: FIXED.ext, tag: FIXED.tag });
  assert.deepEqual(snapshot(root), before);
});

test("扩展 zip 不存在被拒绝，文件不变", (t) => {
  const root = makeFixture(t);
  const before = snapshot(root);
  assert.throws(
    () => prepareSiteRelease({ root, app: FIXED.nextApp, extension: FIXED.nextExt, tag: FIXED.tag }),
    new RegExp(`找不到 downloads/GravityPort-Web-Capture-${FIXED.nextExt}\\.zip`)
  );
  assert.deepEqual(snapshot(root), before);
});

test("en/index.html 缓存号行找不到时拒绝，其余文件也不变", (t) => {
  const root = makeFixture(t);
  editFixture(root, "en/index.html", (text) => text.replace(/\n[^\n]*site-config\.js\?v=[^\n]*/, ""));
  const before = snapshot(root);
  assert.throws(() => prepareSiteRelease({ root, app: FIXED.nextApp, tag: FIXED.tag }), /en\/index\.html: 预期恰好 1 处 site-config 缓存号，找到 0 处/);
  assert.deepEqual(snapshot(root), before);
});

test("同一参数跑两次结果相同", (t) => {
  const root = makeFixture(t);
  const args = { root, app: FIXED.nextApp, tag: "20260102" };
  prepareSiteRelease(args);
  const afterFirst = snapshot(root);
  prepareSiteRelease(args);
  assert.deepEqual(snapshot(root), afterFirst);
});

test("不给 --tag 时用美国太平洋时间的当天日期", (t) => {
  const root = makeFixture(t);
  prepareSiteRelease({ root, app: FIXED.nextApp });
  const index = readFileSync(join(root, "index.html"), "utf8");
  assert.match(index, /site-config\.js\?v=\d{8}-rel-9\.9\.2/);
});

test("--app / --extension / --tag 格式不对都拒绝", (t) => {
  const root = makeFixture(t);
  assert.throws(() => prepareSiteRelease({ root, app: "v0.3.16" }), /--app 版本号格式不对/);
  assert.throws(() => prepareSiteRelease({ root, app: "abc" }), /--app 版本号格式不对/);
  assert.throws(() => prepareSiteRelease({ root, app: FIXED.nextApp, extension: "0.15" }), /--extension 版本号格式不对/);
  assert.throws(() => prepareSiteRelease({ root, app: FIXED.nextApp, tag: "2026112" }), /--tag 格式不对/);
});

test("--check 对一致的夹具通过", (t) => {
  const root = makeFixture(t);
  assert.deepEqual(checkSiteConsistency({ root }).problems, []);
});

test("--check：三段 App 版本不一致", (t) => {
  const root = makeFixture(t);
  editFixture(root, "site-config.js", (text) => text.replace(/(  windows: \{[\s\S]*?    version: ")v9\.9\.1(")/, "$1v9.8.0$2"));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /三段 App 版本不一致/.test(problem.message)));
});

test("--check：url 里的版本和 version 不一致", (t) => {
  const root = makeFixture(t);
  editFixture(root, "site-config.js", (text) => text.replace("GravityPort-darwin-arm64-9.9.1.dmg", "GravityPort-darwin-arm64-9.8.0.dmg"));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /mac\.url 里的版本（9\.8\.0）和 version（9\.9\.1）不一致/.test(problem.message)));
});

test("--check：扩展 version 和 url 不一致", (t) => {
  const root = makeFixture(t);
  editFixture(root, "site-config.js", (text) => text.replace(/(  extension: \{[\s\S]*?    version: ")v9\.15\.98(")/, "$1v9.15.97$2"));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /extension\.url 里的版本（9\.15\.98）和 version（9\.15\.97）不一致/.test(problem.message)));
});

test("--check：扩展 zip 不存在", (t) => {
  const root = makeFixture(t);
  rmSync(join(root, "downloads", `GravityPort-Web-Capture-${FIXED.ext}.zip`));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => new RegExp(`找不到 downloads/GravityPort-Web-Capture-${FIXED.ext}\\.zip`).test(problem.message)));
});

test("--check：两个首页的缓存号不一致", (t) => {
  const root = makeFixture(t);
  editFixture(root, "index.html", (text) => text.replace(`${FIXED.tag}-rel-${FIXED.app}`, "20260101-rel-9.8.9"));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /两个首页的缓存号不一致/.test(problem.message)));
});

test("--check：缓存号不以 -rel-<App 版本> 结尾", (t) => {
  const root = makeFixture(t);
  for (const rel of ["index.html", "en/index.html"]) {
    editFixture(root, rel, (text) => text.replace(`${FIXED.tag}-rel-${FIXED.app}`, "20260101-rel-9.8.9"));
  }
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /不以 -rel-9\.9\.1 结尾/.test(problem.message)));
});

test("--check：README 示例文件名和扩展版本不一致", (t) => {
  const root = makeFixture(t);
  editFixture(root, "browser-extension/README.md", (text) => text.replace(`GravityPort-Web-Capture-${FIXED.ext}.zip`, `GravityPort-Web-Capture-9.15.97.zip`));
  assert.ok(checkSiteConsistency({ root }).problems.some((problem) => /示例文件名版本（9\.15\.97）和扩展版本（9\.15\.98）不一致/.test(problem.message)));
});

test("--check 对仓库真文件通过（手改漏一处 CI 就红）", () => {
  const { problems, cacheTagBase } = checkSiteConsistency({ root: REPO_ROOT });
  assert.deepEqual(problems, []);
  // CI fetches origin/main before the tests, so the cache-tag check must really
  // run there instead of skipping (see .github/workflows/deploy.yml).
  if (process.env.CI) assert.ok(cacheTagBase, "CI 里取不到 origin/main，缓存号检查没跑");
});

test("CLI 退出码：一致 0、不一致 1、用法错误 2", (t) => {
  const root = makeFixture(t);
  assert.equal(main(["--check", "--root", root]), 0);
  editFixture(root, "index.html", (text) => text.replace(`${FIXED.tag}-rel-${FIXED.app}`, "20260101-rel-9.8.9"));
  assert.equal(main(["--check", "--root", root]), 1);
  assert.equal(main([]), 2);
  assert.equal(main(["--check", "--app", "1.0.0"]), 2);
});

test("CLI 改版：退出 0 且文件真的改了；降级退出 1", (t) => {
  const root = makeFixture(t);
  assert.equal(main(["--app", "9.9.0", "--root", root]), 1);
  assert.equal(main(["--app", FIXED.nextApp, "--tag", "20260102", "--root", root]), 0);
  assert.ok(readFileSync(join(root, "index.html"), "utf8").includes(`site-config.js?v=20260102-rel-${FIXED.nextApp}`));
});
