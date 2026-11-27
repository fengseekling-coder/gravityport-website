// Cache-tag bump check: a file the pages load with `?v=<tag>` (site/strings.js,
// site/press.css, site-config.js, ...) whose content changed against a base ref
// must also get a new tag on every page that loads it. Otherwise browsers and the
// CDN keep serving the old copy for up to an hour after the merge goes live
// (0.3.18: a6436fa edited site/strings.js without a new tag).
//
// The base is a git ref, origin/main by default. Pages are the repository's HTML
// files as they are in the working tree, including the generated English pages,
// so an unrebuilt en/ page shows up too. Without git or without the base ref the
// check is skipped and says why; it never guesses.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

export const DEFAULT_CACHE_TAG_BASE = "origin/main";

const TAGGED_REF = /(?:src|href)="([^"?#]+)\?v=([^"&#]*)"/g;

function git(root, args, { encoding = "utf8" } = {}) {
  return execFileSync("git", ["-C", root, ...args], { encoding, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

function resolveBase(root, baseRef) {
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

/** Repository-relative paths of the files `page` loads with a ?v= tag, each with its set of tags. */
export function taggedReferences(page, html) {
  const refs = new Map();
  for (const [, url, tag] of html.matchAll(TAGGED_REF)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) continue;
    const target = url.startsWith("/") ? posix.normalize(url.slice(1)) : posix.normalize(posix.join(posix.dirname(page), url));
    if (target.startsWith("../") || target === "..") continue;
    if (!refs.has(target)) refs.set(target, new Set());
    refs.get(target).add(tag);
  }
  return refs;
}

function readAtBase(root, base, rel) {
  try {
    return git(root, ["cat-file", "blob", `${base}:${rel}`], { encoding: "buffer" });
  } catch {
    return null;
  }
}

/**
 * Returns { base, skipped, problems }. `base` is the resolved commit, `skipped`
 * a reason when the check could not run, `problems` one { file, message } per
 * page that still carries an old tag for a changed file.
 */
export function checkCacheTagBumps({ root, baseRef = DEFAULT_CACHE_TAG_BASE }) {
  const base = resolveBase(root, baseRef);
  if (!base) return { base: null, skipped: `找不到 ${baseRef}（不是 git 仓库或没取到这个分支），跳过缓存号检查`, problems: [] };

  let pages;
  try {
    pages = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.html"]).split("\n").filter(Boolean);
  } catch {
    return { base, skipped: "列不出仓库里的 HTML 页，跳过缓存号检查", problems: [] };
  }

  const problems = [];
  const changed = new Map();
  const isChanged = (rel) => {
    if (!changed.has(rel)) {
      const before = readAtBase(root, base, rel);
      const path = join(root, rel);
      changed.set(rel, before !== null && existsSync(path) && !readFileSync(path).equals(before));
    }
    return changed.get(rel);
  };

  for (const page of pages.sort()) {
    const pagePath = join(root, page);
    if (!existsSync(pagePath)) continue;
    const current = taggedReferences(page, readFileSync(pagePath, "utf8"));
    if (current.size === 0) continue;
    const basePage = readAtBase(root, base, page);
    if (basePage === null) continue;
    const previous = taggedReferences(page, basePage.toString("utf8"));
    for (const [asset, tags] of current) {
      const oldTags = previous.get(asset);
      if (!oldTags || !isChanged(asset)) continue;
      const stale = [...tags].filter((tag) => oldTags.has(tag));
      if (stale.length === 0) continue;
      problems.push({
        file: asset,
        message: `内容相对 ${baseRef} 改了，但 ${page} 引用它的 ?v=${stale.join("、")} 没换；换个新缓存号${page.startsWith("en/") ? "（英文页用 node scripts/build-en-page.mjs 重建）" : ""}`,
      });
    }
  }
  return { base, skipped: null, problems };
}
