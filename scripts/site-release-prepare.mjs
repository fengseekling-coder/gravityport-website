#!/usr/bin/env node
// One command for the release-time version edits of the site. Releasing used to
// require hand-editing five places (the three download fallbacks in site-config.js,
// the site-config cache tag on both home pages, and the example filename in the
// extension README, then rebuilding en/index.html); one missed edit sent visitors
// to an old installer or a stale cached config. This script rewrites all of them,
// rebuilds en/index.html with the real builder, and --check verifies the alignment
// so a hand edit that missed a place turns the website tests red.
//
//   node scripts/site-release-prepare.mjs --app 0.3.16 [--extension 0.15.50] [--tag 20261120]
//   node scripts/site-release-prepare.mjs --check [--base origin/main]
//
// --check also runs the cache-tag bump check (scripts/check-cache-tags.mjs): a
// file the pages load with ?v= whose content changed against --base must get a
// new tag on every page that loads it.
// Versions are bare (no "v" prefix); site-config.js keeps its "v" prefix on the
// version fields. --tag defaults to today's date in US Pacific time and must be
// <YYYYMMDD>. Installer files (dmg/exe) live in R2 and are not checked; the
// extension zip lives in downloads/ and must exist before --extension is applied.
// Nothing is written until every position has been located and every validation
// has passed, so a rejected run leaves the tree untouched. Re-running with the
// same arguments produces the same bytes.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareReleaseVersions, parseReleaseVersion } from "./release-version.mjs";
import { buildEnglishPage, loadStrings } from "./build-en-page.mjs";
import { checkCacheTagBumps, DEFAULT_CACHE_TAG_BASE } from "./check-cache-tags.mjs";

const APP_SECTIONS = ["mac", "macIntel", "windows"];
const EXTENSION_SECTION = "extension";
// Anchored filename shapes: the url must be exactly this shape for the version
// inside it to be comparable with the section's version field.
const URL_SHAPES = {
  mac: [".\/downloads\/GravityPort-darwin-arm64-", ".dmg"],
  macIntel: [".\/downloads\/GravityPort-darwin-x64-", ".dmg"],
  windows: [".\/downloads\/GravityPort-win32-x64-", ".exe"],
  extension: [".\/downloads\/GravityPort-Web-Capture-", ".zip"],
};

export class SiteReleaseError extends Error {}
export class UsageError extends Error {}

export function bareVersion(version) {
  return String(version ?? "").replace(/^v/, "");
}

function zipName(bareExtension) {
  return `GravityPort-Web-Capture-${bareExtension}.zip`;
}

/** Today's date (YYYYMMDD) in US Pacific time, the convention for cache tags. */
export function pacificTodayTag() {
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );
  return `${parts.get("year")}${parts.get("month")}${parts.get("day")}`;
}

/**
 * Parses the four config sections out of site-config.js text. Each section is
 * `{ version: "...", url: "...", ... }` indented two spaces; a missing section
 * or field is null so callers can report the exact position that broke.
 */
export function readSiteConfigState(text) {
  const state = {};
  for (const name of [...APP_SECTIONS, EXTENSION_SECTION]) {
    const block = new RegExp(`(?:^|\\n)  ${name}: \\{\\n([\\s\\S]*?)\\n  \\},`).exec(text);
    if (!block) {
      state[name] = null;
      continue;
    }
    const version = /^    version: "([^"]*)",$/m.exec(block[1]);
    const url = /^    url: "([^"]*)",$/m.exec(block[1]);
    state[name] = { version: version ? version[1] : null, url: url ? url[1] : null };
  }
  return state;
}

function urlVersionOf(name, url) {
  const [prefix, suffix] = URL_SHAPES[name];
  if (!url || !url.startsWith(prefix) || !url.endsWith(suffix)) return null;
  return url.slice(prefix.length, url.length - suffix.length);
}

function readText(root, rel) {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch (error) {
    throw new SiteReleaseError(`读不了 ${rel}：${error.message}`);
  }
}

/** Replaces exactly-one-occurrence literals inside one site-config section block. */
function replaceInSection(text, name, updates, file, changes) {
  const blockMatch = new RegExp(`(?:^|\\n)  ${name}: \\{\\n[\\s\\S]*?\\n  \\},`).exec(text);
  if (!blockMatch) throw new SiteReleaseError(`${file}: 找不到 ${name} 段`);
  let block = blockMatch[0];
  for (const update of updates) {
    const hits = block.split(update.find).length - 1;
    if (hits !== 1) {
      throw new SiteReleaseError(`${file}: ${name} 段里 ${update.label} 预期恰好 1 处，找到 ${hits} 处`);
    }
    block = block.replace(update.find, update.replaceWith);
    changes.push({ file, label: `${name}.${update.label}`, from: update.from, to: update.to });
  }
  return text.slice(0, blockMatch.index) + block + text.slice(blockMatch.index + blockMatch[0].length);
}

function replaceCacheTag(html, file, newTag, changes) {
  const hits = [...html.matchAll(/src="(\.\/|\.\.\/)site-config\.js\?v=([^"]*)"/g)];
  if (hits.length !== 1) {
    throw new SiteReleaseError(`${file}: 预期恰好 1 处 site-config 缓存号，找到 ${hits.length} 处`);
  }
  const [full, prefix, oldTag] = hits[0];
  changes.push({ file, label: "site-config 缓存号", from: oldTag, to: newTag });
  return html.replace(full, `src="${prefix}site-config.js?v=${newTag}"`);
}

function replaceReadmeExample(text, oldBare, newBare, changes) {
  const find = `downloads/${zipName(oldBare)}`;
  const replaceWith = `downloads/${zipName(newBare)}`;
  const hits = text.split(find).length - 1;
  if (hits !== 1) {
    throw new SiteReleaseError(`browser-extension/README.md: 示例文件名 ${find} 预期恰好 1 处，找到 ${hits} 处`);
  }
  changes.push({ file: "browser-extension/README.md", label: "示例文件名", from: find, to: replaceWith });
  return text.replace(find, replaceWith);
}

/**
 * Validates formats, locates and rewrites every position, then writes all files
 * together. Throws SiteReleaseError (before any write) when a version format is
 * wrong, the new App version is lower than the current one, the extension zip is
 * missing, or any position cannot be found.
 */
export function prepareSiteRelease({ root, app, extension, tag }) {
  if (!parseReleaseVersion(app)) {
    throw new SiteReleaseError(`--app 版本号格式不对：${JSON.stringify(app)}（要 X.Y.Z 或 X.Y.Z-后缀，不带 v）`);
  }
  if (extension !== undefined && !parseReleaseVersion(extension)) {
    throw new SiteReleaseError(`--extension 版本号格式不对：${JSON.stringify(extension)}（要 X.Y.Z 或 X.Y.Z-后缀，不带 v）`);
  }
  if (tag !== undefined && !/^\d{8}$/.test(tag)) {
    throw new SiteReleaseError(`--tag 格式不对：${JSON.stringify(tag)}（要 YYYYMMDD 八位数字）`);
  }

  const siteConfigText = readText(root, "site-config.js");
  const state = readSiteConfigState(siteConfigText);
  for (const name of extension === undefined ? APP_SECTIONS : [...APP_SECTIONS, EXTENSION_SECTION]) {
    const section = state[name];
    if (!section || section.version === null || section.url === null) {
      throw new SiteReleaseError(`site-config.js: 找不到 ${name} 段的 version 或 url`);
    }
  }

  // Equal is allowed so a release run can be repeated; lower is always a mistake.
  const currentApp = bareVersion(state.mac.version);
  let comparison;
  try {
    comparison = compareReleaseVersions(app, currentApp);
  } catch (error) {
    throw new SiteReleaseError(`site-config.js 的 mac.version（${state.mac.version}）解析不了：${error.message}`);
  }
  if (comparison < 0) {
    throw new SiteReleaseError(`拒绝降级：site-config.js 当前 App 版本 ${currentApp}，新版本 ${app} 更低（相等允许，用于重跑）`);
  }
  if (extension !== undefined) {
    const currentExtension = bareVersion(state.extension.version);
    let extensionComparison;
    try {
      extensionComparison = compareReleaseVersions(extension, currentExtension);
    } catch (error) {
      throw new SiteReleaseError(`site-config.js 的 extension.version（${state.extension.version}）解析不了：${error.message}`);
    }
    if (extensionComparison < 0) {
      throw new SiteReleaseError(`拒绝降级：site-config.js 当前扩展版本 ${currentExtension}，新版本 ${extension} 更低（相等允许，用于重跑）`);
    }
  }

  if (extension !== undefined && !existsSync(join(root, "downloads", zipName(extension)))) {
    throw new SiteReleaseError(`找不到 downloads/${zipName(extension)}：扩展 zip 在仓库 downloads/ 里，要随仓库提交后才发版`);
  }

  const dateTag = tag === undefined ? pacificTodayTag() : tag;
  const newTag = `${dateTag}-rel-${app}`;
  const changes = [];
  const wroteFiles = [];

  // 1. site-config.js: three App sections, plus the extension section when given.
  let newSiteConfig = siteConfigText;
  for (const name of APP_SECTIONS) {
    newSiteConfig = replaceInSection(
      newSiteConfig,
      name,
      [
        {
          label: "version",
          find: `    version: "${state[name].version}",`,
          replaceWith: `    version: "v${app}",`,
          from: state[name].version,
          to: `v${app}`,
        },
        {
          label: "url",
          find: `    url: "${state[name].url}",`,
          replaceWith: `    url: "${URL_SHAPES[name][0]}${app}${URL_SHAPES[name][1]}",`,
          from: state[name].url,
          to: `${URL_SHAPES[name][0]}${app}${URL_SHAPES[name][1]}`,
        },
      ],
      "site-config.js",
      changes
    );
  }
  if (extension !== undefined) {
    newSiteConfig = replaceInSection(
      newSiteConfig,
      EXTENSION_SECTION,
      [
        {
          label: "version",
          find: `    version: "${state.extension.version}",`,
          replaceWith: `    version: "v${extension}",`,
          from: state.extension.version,
          to: `v${extension}`,
        },
        {
          label: "url",
          find: `    url: "${state.extension.url}",`,
          replaceWith: `    url: "${URL_SHAPES.extension[0]}${extension}${URL_SHAPES.extension[1]}",`,
          from: state.extension.url,
          to: `${URL_SHAPES.extension[0]}${extension}${URL_SHAPES.extension[1]}`,
        },
      ],
      "site-config.js",
      changes
    );
  }

  // 2. Both home pages: the site-config cache tag. en/index.html is rebuilt from
  //    the new index.html with the real builder, so its tag rides along; the old
  //    en page must still carry the tag position or the tree is in a state the
  //    release flow does not recognize.
  const indexHtml = readText(root, "index.html");
  const newIndexHtml = replaceCacheTag(indexHtml, "index.html", newTag, changes);
  const enIndexHtml = readText(root, "en/index.html");
  replaceCacheTag(enIndexHtml, "en/index.html", newTag, []); // position check only
  const strings = loadStrings(readText(root, "site/strings.js"));
  let newEnIndexHtml;
  try {
    newEnIndexHtml = buildEnglishPage(newIndexHtml, strings);
  } catch (error) {
    throw new SiteReleaseError(`重建 en/index.html 失败：${error.message}`);
  }
  if (!newEnIndexHtml.includes(`../site-config.js?v=${newTag}`)) {
    throw new SiteReleaseError(`重建出的 en/index.html 里没有缓存号 ${newTag}`);
  }

  // 3. Extension README example filename, only when the extension moves.
  let newReadme = null;
  if (extension !== undefined) {
    newReadme = replaceReadmeExample(readText(root, "browser-extension/README.md"), bareVersion(state.extension.version), extension, changes);
  }

  writeFileSync(join(root, "site-config.js"), newSiteConfig);
  writeFileSync(join(root, "index.html"), newIndexHtml);
  mkdirSync(join(root, "en"), { recursive: true });
  writeFileSync(join(root, "en", "index.html"), newEnIndexHtml);
  wroteFiles.push("site-config.js", "index.html", "en/index.html");
  if (newReadme !== null) {
    writeFileSync(join(root, "browser-extension", "README.md"), newReadme);
    wroteFiles.push("browser-extension/README.md");
  }
  return { changes, wroteFiles };
}

/**
 * Read-only consistency check: the three App sections agree with each other and
 * with the versions inside their urls; the extension version agrees with its url
 * and the zip exists; both home pages carry the same cache tag ending in
 * -rel-<App version>; the README example filename carries the extension version;
 * every ?v= file that changed against `baseRef` carries a new tag on each page.
 * Returns { problems: [{ file, message }], notes: [string] }; empty problems
 * means consistent, notes say which part was skipped and why.
 */
export function checkSiteConsistency({ root, baseRef = DEFAULT_CACHE_TAG_BASE }) {
  const problems = [];
  const notes = [];
  const add = (file, message) => problems.push({ file, message });

  let state = null;
  try {
    state = readSiteConfigState(readFileSync(join(root, "site-config.js"), "utf8"));
  } catch (error) {
    add("site-config.js", `读不了：${error.message}`);
  }

  let appVersion = null;
  if (state) {
    const versions = [];
    for (const name of APP_SECTIONS) {
      const section = state[name];
      if (!section || section.version === null || section.url === null) {
        add("site-config.js", `${name} 段缺 version 或 url`);
        continue;
      }
      versions.push({ name, section });
    }
    if (versions.length === APP_SECTIONS.length) {
      appVersion = bareVersion(versions[0].section.version);
      for (const { name, section } of versions) {
        const bare = bareVersion(section.version);
        if (bare !== appVersion) {
          add("site-config.js", `三段 App 版本不一致：${versions.map((v) => `${v.name}=${bareVersion(v.section.version)}`).join("、")}`);
          break;
        }
      }
      for (const { name, section } of versions) {
        const bare = bareVersion(section.version);
        const urlVersion = urlVersionOf(name, section.url);
        if (urlVersion === null) add("site-config.js", `${name}.url 不是预期文件名格式：${section.url}`);
        else if (urlVersion !== bare) add("site-config.js", `${name}.url 里的版本（${urlVersion}）和 version（${bare}）不一致`);
      }
    }

    const extension = state[EXTENSION_SECTION];
    let extBare = null;
    if (!extension || extension.version === null || extension.url === null) {
      add("site-config.js", "extension 段缺 version 或 url");
    } else {
      extBare = bareVersion(extension.version);
      const urlVersion = urlVersionOf(EXTENSION_SECTION, extension.url);
      if (urlVersion === null) add("site-config.js", `extension.url 不是预期文件名格式：${extension.url}`);
      else if (urlVersion !== extBare) add("site-config.js", `extension.url 里的版本（${urlVersion}）和 version（${extBare}）不一致`);
      if (parseReleaseVersion(extBare) && !existsSync(join(root, "downloads", zipName(extBare)))) {
        add("downloads", `找不到 downloads/${zipName(extBare)}：扩展 zip 要随仓库提交`);
      }
    }

    // Both home pages: same cache tag, ending in -rel-<App version>.
    const tags = {};
    for (const file of ["index.html", "en/index.html"]) {
      try {
        const hits = [...readFileSync(join(root, file), "utf8").matchAll(/site-config\.js\?v=([^"]*)/g)];
        if (hits.length !== 1) add(file, `预期恰好 1 处 site-config 缓存号，找到 ${hits.length} 处`);
        else tags[file] = hits[0][1];
      } catch (error) {
        add(file, `读不了：${error.message}`);
      }
    }
    const tagged = Object.keys(tags);
    if (tagged.length === 2) {
      if (tags["index.html"] !== tags["en/index.html"]) {
        add("index.html", `两个首页的缓存号不一致：${tags["index.html"]}（index.html）vs ${tags["en/index.html"]}（en/index.html）`);
      } else if (appVersion !== null && !tags["index.html"].endsWith(`-rel-${appVersion}`)) {
        add("index.html", `缓存号（${tags["index.html"]}）不以 -rel-${appVersion} 结尾`);
      }
    }

    // README: every concrete versioned zip example must carry the extension version.
    try {
      const readme = readFileSync(join(root, "browser-extension", "README.md"), "utf8");
      if (extBare !== null) {
        const names = [...readme.matchAll(/GravityPort-Web-Capture-(\d[\w.+-]*)\.zip/g)].map((match) => match[1]);
        if (names.length === 0) add("browser-extension/README.md", "没有具体版本号的扩展包示例文件名");
        const wrong = [...new Set(names.filter((name) => name !== extBare))];
        if (wrong.length > 0) add("browser-extension/README.md", `示例文件名版本（${wrong.join("、")}）和扩展版本（${extBare}）不一致`);
      }
    } catch (error) {
      add("browser-extension/README.md", `读不了：${error.message}`);
    }
  }

  const cacheTags = checkCacheTagBumps({ root, baseRef });
  if (cacheTags.skipped) notes.push(cacheTags.skipped);
  problems.push(...cacheTags.problems);

  return { problems, notes, cacheTagBase: cacheTags.base };
}

export function parsePrepareArgs(argv) {
  const options = { app: undefined, extension: undefined, tag: undefined, root: undefined, base: undefined, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (flag) => {
      if (index + 1 >= argv.length) throw new UsageError(`${flag} 缺值`);
      index += 1;
      return argv[index];
    };
    if (arg === "--app") options.app = takeValue(arg);
    else if (arg === "--extension") options.extension = takeValue(arg);
    else if (arg === "--tag") options.tag = takeValue(arg);
    else if (arg === "--root") options.root = takeValue(arg);
    else if (arg === "--base") options.base = takeValue(arg);
    else if (arg === "--check") options.check = true;
    else throw new UsageError(`不认识的参数：${arg}（用法见 scripts/site-release-prepare.mjs 头部注释）`);
  }
  if (options.check && (options.app !== undefined || options.extension !== undefined || options.tag !== undefined)) {
    throw new UsageError("--check 只核对一致性，不和 --app/--extension/--tag 一起用");
  }
  if (!options.check && options.base !== undefined) {
    throw new UsageError("--base 只给 --check 用");
  }
  if (!options.check && options.app === undefined) {
    throw new UsageError("要么给 --app <版本> 改齐发版，要么用 --check 核对一致性");
  }
  options.root = resolve(options.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  return options;
}

export function main(argv) {
  let options;
  try {
    options = parsePrepareArgs(argv);
  } catch (error) {
    console.error(`用法错误：${error.message}`);
    return 2;
  }
  if (options.check) {
    const { problems, notes } = checkSiteConsistency({ root: options.root, baseRef: options.base });
    for (const note of notes) console.log(note);
    if (problems.length > 0) {
      for (const { file, message } of problems) console.error(`${file}: ${message}`);
      console.error(`site release check 不通过：${problems.length} 处不一致`);
      return 1;
    }
    console.log(
      notes.length > 0
        ? "site release check 通过：下载版本、缓存号和扩展说明一致（缓存号换没换没查，原因见上）。"
        : "site release check 通过：下载版本、缓存号和扩展说明一致，改过的文件都换了缓存号。"
    );
    return 0;
  }
  try {
    const { changes, wroteFiles } = prepareSiteRelease(options);
    for (const { file, label, from, to } of changes) console.log(`${file}: ${label} ${from} -> ${to}`);
    console.log(`已写 ${wroteFiles.length} 个文件：${wroteFiles.join("、")}`);
  } catch (error) {
    console.error(`site-release-prepare：${error.message}`);
    return 1;
  }
  return 0;
}

// Importing the module (tests, or other scripts) must not run anything.
function invokedAsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsMain()) {
  process.exitCode = main(process.argv.slice(2));
}
