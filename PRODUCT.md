# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- People who make a lot of AI images and video across several tools — ChatGPT, Gemini, Flow, Google AI Studio and Jimeng in the browser, Codex Desktop, Grok Build CLI — and then lose track of what they made: the image survives, but the Prompt sits in another conversation, the tool is forgotten, and the version they wanted is buried among near-duplicates.
- Chinese-speaking and English-speaking visitors are served equally (confirmed 2026-10-19). Both languages get first-class copy; the page follows the browser language and can be switched by hand.

## Product Purpose

GravityPort is a local-first library for AI-generated media. It collects images and videos from the places people already create, keeps each one connected to the context that makes it reusable (Prompt, source, model or tool, time, provenance, version history), and lets people browse, organize and find them again on their own computer.

The website exists to make a first-time visitor understand that in seconds, see it working, and download it.

## Positioning

- The asset and its context are kept together, automatically, from where the work was made — not a folder of loose files and not a cloud gallery.
- Version history follows how the image was actually made: generations from one ChatGPT conversation are grouped by conversation turn, and any two versions in a family can be compared side by side.
- Everything stays on the user's machine. No GravityPort cloud account, no sync, no upload of the library.
- GravityPort does not generate media and does not replace the tools people create with.

## Operating Context

- Desktop app: macOS Apple silicon (DMG first install, in-app updates after) and Windows 10/11 x64 (portable ZIP).
- Optional Chrome / Chromium Web Capture extension, installed from a ZIP. It pairs with the desktop app automatically.
- Built-in MCP server: Settings → Connections → AI assistant (MCP) copies a ready config, so Claude and Codex can search the library.
- Smart groups by source and automatic stacking: images from one conversation, Flow project, or Codex task stack themselves; unstacked or pulled-out images are never re-stacked, and named stacks keep their names.
- In-app feedback (Settings → Feedback) posts to the website's feedback service.

## Capabilities and Constraints

Confirmed capabilities a visitor can be told about:
- Capture from ChatGPT, Gemini, Flow, Google AI Studio, Jimeng (extension), Codex Desktop, Grok Build CLI. Cowart and Midjourney are not advertised on the site.
- One gallery: adjustable columns, marquee and multi-select, search, smart groups by source, own groups, favourites.
- Drag to organize: drag cards onto a sidebar group, onto another card to create or join a stack, reorder inside a stack, drag out of the window to hand files to other apps; recent drag-made stacks can be undone for a few seconds.
- Inspector: Prompt, user instruction, reference images, colour palette, size and ratio, source and date.
- Version tree grouped by conversation turn; side-by-side compare of any two versions in a family.
- Full-screen viewer with zoom; video cards show a first frame and a play badge.
- Local visual search (Visual Pack) is hidden in the app as of 2026-10-21 and must not be advertised on the site.
- Trash keeps deleted assets for 90 days with per-item countdown and undo.
- Light and dark themes; Chinese and English interface.

Not available yet — must not be presented as available:
- Pinterest connection (built, waiting on Pinterest production API approval; currently shown as "coming soon" in the app).
- C2PA Content Credential export (component exists, no user-facing entry point).

Pricing (as the site states it):
- GravityPort is free to use, with no sign-up.
- Site copy says "free" and links to the licence on GitHub; it never quotes or paraphrases the licence terms.

Website constraints (technical):
- Static site: plain HTML, CSS and JavaScript, no build step. Deployed by GitHub Actions to Cloudflare Pages (project `gravityport-site`); merging to `main` publishes it.
- Must keep working, unchanged in path and contract: `/releases/…` update manifests (served from R2 by the `gp-edge` Worker, never committed), `/downloads/…` packages, `desktop-release-feed.js` + `site-config.js` (the download area reads versions, sizes and SHA-256 from the feed), the feedback service, `/privacy/` URL, `domain-changed.html` for the legacy domain, `admin/` (out of scope this round), `scripts/` and `ops/` (repository-only, never published).
- The deploy check fetches `/site/press.css`, `/site/press.js`, `/site-config.js` and expects `GravityPort` in `/`; renaming those files means updating the workflow in the same change.

## Brand Commitments

- Name: GravityPort. The site never mentions the former name MOSA (2026-10-22).
- Mark: `assets/gravityport-mark.svg` (black disc with a horizontal port slit and a gold dot `#C9A45C`) and `assets/gravityport-mark-reversed.svg`.
- The product interface itself is the strongest brand asset: dark theme neutrals with a neon green accent `#39ff14`; light theme accent `#009a1a`.
- The user discarded all existing website design and copy (2026-10-19). Nothing from the current site's layout, styling or wording is binding.

## Evidence on Hand

- Real app screenshots can be captured from the installed app; `docs/images/gravityport-app.webp` in the app repository is a real-library screenshot the user approved for public use.
- Images for marketing visuals will come from the user's own generated work, chosen by the user (they approve every image before it goes public).
- There are no testimonials, user counts, download numbers, press quotes, customer logos or benchmarks. None may be invented.
- Community group QR code: `assets/gravityport-community-qr-20261022.jpg`.
- GitHub repository: `fengseekling-coder/gravityport` (source available).

## Product Principles

1. The context is the asset: an image is only reusable if its Prompt, source and history travel with it.
2. Never claim a capability the app does not have.
3. The library belongs to the user: local, offline-capable, no account.
4. Fit around existing tools: capture from where people already create; never compete with the generators.
5. Free.

## Copy

Decided by the owner on 2026-10-22; these override anything above.

- Say what GravityPort does for the visitor. One word beats a sentence; one sentence beats two.
- No limitations, caveats, certification or signing notes, "preview" labels, former names, or internal principles (how missing Prompts are labelled and the like). A good app doesn't need them.
- Exception: the download area keeps the one-line first-open steps for macOS (Open Anyway) and Windows (Run anyway), and the extension steps say to tick auto-capture. These are steps, not caveats; without them new users cannot open the app or get automatic capture (owner, 10-22).
- Positioning in one line: AI 素材管理工具 / AI asset manager.
- Core feature copy (owner, 2026-10-25) is the reference for feature names, the source list and claims: GravityPort｜AI 素材管理工具 (ChatGPT · Gemini · Flow · Google AI Studio · Codex · Grok · 即梦); 100% Local｜纯本地存储; Auto-Capture｜自动收录; Prompts & Context｜完整创作溯源; Version Tree｜多轮版本树; Smart Stacks｜自动分组; Built-in MCP｜内置 MCP (Claude, Codex); Free Download｜免费下载 (macOS · Windows). Copy that conflicts with it is changed to match.
- Don't say "open source"; "source on GitHub" is fine. Don't say "free for personal use".
