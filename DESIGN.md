---
name: GravityPort
description: The website as a press run of GravityPort's own job; every image prints with its slug.
colors:
  stock: "#F2F3F0"
  stock-2: "#E6E7E2"
  ink: "#121212"
  ink-2: "#1B1B1A"
  ink-3: "#262625"
  fluo: "#39FF14"
  muted: "#5B5C57"
  muted-ink: "#A2A39D"
  process-cyan: "#00A0E3"
  process-magenta: "#E5007E"
  process-yellow: "#FFE500"
  src-chatgpt: "#00A0E3"
  src-gemini: "#3A4BBD"
  src-flow: "#E5007E"
  src-studio: "#FFE500"
  src-codex: "#E30613"
  src-grok: "#00963F"
  src-cowart: "#9B9C97"
  app-window: "#242424"
  app-main: "#343434"
  app-text: "#F1F1F1"
  mark-gold: "#C9A45C"
typography:
  display:
    fontFamily: "Archivo, GP Hei (Noto Sans SC Black subset), PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "clamp(38px, 5.4vw, 84px)"
    fontWeight: 860
    lineHeight: 1.06
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 68"
  display-en:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(42px, 6.2vw, 96px)"
    fontWeight: 860
    lineHeight: 0.93
    letterSpacing: "-0.012em"
    fontVariation: "'wdth' 68"
  display-hero:
    fontFamily: "Archivo, GP Hei, sans-serif"
    fontSize: "clamp(46px, 5.3vw, 84px)"
    fontWeight: 860
    lineHeight: 1.06
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 68"
  display-flood:
    fontFamily: "Archivo, GP Hei, sans-serif"
    fontSize: "clamp(96px, 17vw, 340px)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "Archivo, GP Hei, sans-serif"
    fontSize: "clamp(26px, 2.6vw, 38px)"
    fontWeight: 860
    lineHeight: 1.1
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 72"
  title:
    fontFamily: "Archivo, GP Hei, sans-serif"
    fontSize: "clamp(20px, 1.8vw, 26px)"
    fontWeight: 820
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  lede:
    fontFamily: "Archivo, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "clamp(16px, 1.25vw, 19px)"
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: "Archivo, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans SC, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "Archivo, PingFang SC, sans-serif"
    fontSize: "19px"
    fontWeight: 760
    lineHeight: 1
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "Fragment Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.02em"
    fontFeature: "'tnum' 1"
  hand:
    fontFamily: "GP Hand (Long Cang subset), Kaiti SC, STKaiti, KaiTi, cursive"
    fontSize: "clamp(24px, 2.1vw, 32px)"
    fontWeight: 400
    lineHeight: 1.1
  app-ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  sheet: "0px"
  app-window: "12px"
  app-control: "7px"
  app-card: "6px"
  app-tile: "5px"
spacing:
  margin: "clamp(14px, 3.4vw, 56px)"
  pad-x: "clamp(20px, 4.6vw, 84px)"
  pad-y: "clamp(44px, 7vw, 120px)"
  masthead: "64px"
  section-gap: "clamp(48px, 6vw, 96px)"
components:
  button-fluo:
    backgroundColor: "{colors.fluo}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sheet}"
    padding: "0 28px 0 24px"
    height: "60px"
  button-fluo-hover-on-ink:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
  button-fluo-hover-on-stock:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.fluo}"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.stock}"
    rounded: "{rounded.sheet}"
    padding: "0 22px 0 18px"
    height: "52px"
  button-line-hover:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
  masthead-cta:
    backgroundColor: "{colors.fluo}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "0 14px"
    height: "34px"
  live-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    padding: "{spacing.pad-y} {spacing.pad-x}"
  live-fluo:
    backgroundColor: "{colors.fluo}"
    textColor: "{colors.ink}"
    padding: "{spacing.pad-y} {spacing.pad-x}"
  slug:
    textColor: "{colors.muted}"
    typography: "{typography.mono}"
    padding: "14px 0 0 30px"
  slugtip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stock}"
    typography: "{typography.mono}"
    padding: "8px 10px"
  stack-badge:
    backgroundColor: "{colors.fluo}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    height: "22px"
  proof-tag:
    backgroundColor: "{colors.fluo}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    height: "26px"
  app-window:
    backgroundColor: "{colors.app-window}"
    textColor: "{colors.app-text}"
    typography: "{typography.app-ui}"
    rounded: "{rounded.app-window}"
---

# Design System: GravityPort

## Overview

**Creative North Star: "The Press Run"**

The site is a run of press sheets for GravityPort's own job. Each section is one sheet: cool uncoated stock in the margin, crop marks at the trim, and inside the trim a live area flooded in key black, left as stock, or flooded in the fluorescent spot. Every image carries its slug (source, size, date, the user's instruction, and a rule whose stroke says how far that provenance can be trusted). The product's mechanism, context travelling with the image, is how the page is built, not a feature claim beside it.

Two inks and a spot do the work. Key black carries the dark product interface at near life size; stock carries reading and documentation; the fluorescent spot marks the one action, the selection, and the proof corrections a printer would scrawl. Process cyan, magenta and yellow appear only where a press sheet would show them: the colour bar, the registration target and the plate separations of the hero image. Motion is the press: things print in (a wipe from the gripper edge), plates come into register, slugs type out. Nothing fades and slides.

Density is a printer's density: condensed black display lines, mono data in the margins, ruled tables with heavy 3px head rules and 1px row rules, square corners everywhere outside the app mock. The anti-reference is the dark SaaS hero with a glowing tilted screenshot over a row of equal feature cards.

**Key Characteristics:**
- Every section is a sheet: margin, crop marks, live area, numbered slug with an ink spec.
- Stock / key black / one fluorescent spot; CMY only as print furniture.
- Provenance drawn by rule type: solid recorded, dashed observed-unverified, gap unavailable.
- Condensed black display in Archivo and Noto Sans SC Black; Fragment Mono only for data and slugs; Long Cang only for hand proof notes.
- The real GravityPort window, built in HTML with the owner's own images, is the hero and the demos.
- One press cadence (900 ms, cubic-bezier(0.16, 1, 0.3, 1)); reduced motion shows every final state.

## Colors

A cool, slightly green-grey paper, a near-neutral key black, and one fluorescent green spot; process colours are furniture, not palette.

### Primary
- **802 Fluorescent Spot** (fluo): the only accent. The primary download button, the masthead download, selection rings on images and cards, the hero's marker ring and arrow, hand proof notes on black, proof round tags, stack count badges, the sources feed path, the active-language underline, text selection, the focus halo, and the one full fluo flood sheet ("free"). Named in slugs as "802 FLUO".

### Secondary (print furniture)
- **Process Cyan, Process Magenta, Process Yellow** (process-cyan, process-magenta, process-yellow): only in the colour bar, the registration target and the hero plate separations. The plates themselves are pure screen separations (#00FFFF, #FF00FF, #FFFF00 multiplied over white); the registration target's yellow is darkened to #E3C800 so it reads on black.

### Tertiary (source units)
- **Source inks** (src-chatgpt cyan, src-gemini blue #3A4BBD, src-flow magenta, src-studio yellow, src-codex red #E30613, src-grok green #00963F, src-cowart grey): one swatch per capture source, used as the 8×16px chip before each name in the sources list, the second half of the colour bar, and the browser-tab dot in the feed demo. They identify a source; they never colour text, buttons or backgrounds.

### Neutral
- **Uncoated Stock** (stock): page ground, margins, stock live areas, text on black.
- **Second Stock** (stock-2): hairline-weight fills on stock (trash countdown pill, install file-name chips, inline code, image placeholders, scrollbar track).
- **Key Black** (ink): ink floods, all text on stock, every rule and crop mark, head rules on tables.
- **Ink 2 / Ink 3** (ink-2, ink-3): the console panel and empty image wells inside black sheets.
- **Grey Stock Text** (muted): secondary text on stock (ledes, notes, slugs). Holds about 6.4:1 on stock.
- **Grey Ink Text** (muted-ink): secondary text on black. Holds about 7.6:1 on ink.
- **App greys** (app-window, app-main, app-text plus #323232 bars, #2B2B2B wells): belong to the product mock only; copied from the app's dark theme.
- **Mark Gold** (mark-gold): exists only inside the GravityPort mark SVG. Never used as a site colour.

### Named Rules
**The Two Inks and a Spot Rule.** A sheet is stock, key black, or fluo flood; text on it is the other of stock/ink. No other hue fills a surface or sets text outside the app mock.

**The Furniture Rule.** Cyan, magenta and yellow appear only as print furniture (colour bar, registration target, plate separations). If CMY shows up in copy, a button or a background, it is wrong.

**The Fluo On Black Rule.** Fluo as a text or stroke colour is used only on ink or inside the app mock. On stock, fluo is a fill with ink text on it (button, tag, flood), never a line of text.

## Typography

**Display Font:** Archivo variable, condensed (font-stretch 62–78%, weight 820–900), with "GP Hei" (Noto Sans SC Black, subset) for CJK, then PingFang SC / Hiragino Sans GB / Microsoft YaHei
**Body Font:** Archivo at normal width, with PingFang SC / Hiragino Sans GB / Microsoft YaHei / Noto Sans SC for CJK
**Label/Mono Font:** Fragment Mono, with ui-monospace / SF Mono / Menlo / Consolas
**Hand Font:** "GP Hand" (Long Cang, subset), with Kaiti SC / STKaiti / KaiTi
**App UI Font:** the system UI stack (-apple-system, SF Pro Text, PingFang SC, Microsoft YaHei), only inside the app mock and feed demo

**Character:** Condensed black display set tight like a poster headline, with plain readable Archivo underneath; mono reads as press data in the margins; one hand corrects the proofs.

### Hierarchy
- **Display** (860, width 68%, clamp(38px, 5.4vw, 84px), line-height 1.06, -0.02em; English clamp(42px, 6.2vw, 96px), line-height 0.93): one per sheet, the section heading, balanced wrap, deliberate line breaks. Chinese lines break only at `<br>` and `<wbr>` points written into the string (keep-all, with anywhere as a last resort).
- **Display Hero** (860, width 68%, clamp(46px, 5.3vw, 84px); English up to 100px at 0.92; phones clamp(34px, 11.6vw, 52px)): the h1 only.
- **Display Flood** (900, width 62%, clamp(96px, 17vw, 340px) Chinese / clamp(96px, 25vw, 460px) English, 0.9, -0.03em): a single word on a fluo flood sheet, sized to fill the left 7/12 column; the text beside it starts on the lede line and ends on the word's bottom line (Chinese) or baseline (English). One per page at most.
- **Headline** (860, width 72%, clamp(26px, 2.6vw, 38px), 1.1): sub-heading inside a sheet (the honesty block); the colophon line and dialog title use the same voice at 70%.
- **Title** (820, width 78%, clamp(20px, 1.8vw, 26px), 1.2; download platforms run to clamp(22px, 2.1vw, 30px)): column heads, platform names, first-run heading.
- **Lede** (400, clamp(16px, 1.25vw, 19px), 1.75; English 1.6): one paragraph under a display line, max 34em Chinese / 30em English. All running text uses pretty wrapping so no line ends on a single character.
- **Body** (400, 16px, 1.7; English 1.6): running text; table and note text steps to 14.5–15.5px.
- **Label** (760, 19px on the primary button, 16px on line buttons; nav 520 at 14px): actions.
- **Mono** (400, 12px, 0.02em, tabular figures, uppercase in slugs): sheet numbers, ink specs, sizes, dates, hashes, round tags, commands.
- **Hand** (Long Cang 400, clamp(24px, 2.1vw, 32px), 1.1, rotated -3deg): proof notes in fluo on black; the key round's instruction at 19px; the "OK" approval stamp at 52px.

### Named Rules
**The Mono Is Data Rule.** Fragment Mono sets only things a press slug or a machine would print: sheet numbers, ink specs, dimensions, dates, slugs, hashes, commands, round tags. It never sets a heading, a label above a heading, or prose.

**The One Hand Rule.** Long Cang is a proofreader's correction: the recorded instruction beside a circled image, the key round's note, the OK stamp. Never a heading, never decoration, never on stock in fluo.

**The Phrase Break Rule.** A Chinese display line never breaks inside a phrase. When a line can be too long for its column, write a `<wbr />` at the phrase boundary in strings.js and in the HTML fallback ("一张图<wbr />离开对话框，"), and check the line at 360px, 1280px and 1440px.

**The Subset Rule.** Both CJK faces are subset to the exact characters the site sets in them. After changing any display line (any strings.js key ending in `.title`, or one listed in DISPLAY_KEYS), any hand note (HAND_KEYS, HAND_WORK), or adding a new page with its own display or hand strings, rerun `python3 -I scripts/fetch-site-fonts.py` and ship the regenerated `assets/fonts/noto-sans-sc-900.woff2` and `assets/fonts/long-cang.woff2` in the same change. A new page must register its display and hand keys in that script. A missing glyph silently falls back to a system face, which is a defect.

## Layout

**The sheet.** Every section is a sheet with the same anatomy, outer to inner:
1. **Margin** (stock, padding `margin` with 0.9× top and 1.1× bottom): carries the crop marks, the registration target (top centre) and on some sheets the colour bar (left edge, vertically centred).
2. **Trim**: the box the four crop marks sit on. Crop marks are 1px ink hairlines, 22px long, offset 9px from the corner (12px / 4px on phones); they never touch the live area.
3. **Live area** (padding `pad-y` / `pad-x`): ink flood (black), stock (no fill), or fluo flood. Sheets alternate ink and stock down the page; a fluo flood is used once.
4. **Slug** (below the trim, inset 30px): Fragment Mono uppercase, `SHEET NN / TT`, then the ink spec, then a short data line. Ink specs name what actually printed on that sheet: `K`, `K + 4C`, `K + 802 FLUO`, `K FLOOD + 4C + 802 FLUO`, `802 FLUO FLOOD + K`, `CMYK + 802 FLUO` (hero). On the hero the slug is the circled image's provenance (library, slug, source, size, ratio, date, rule, quoted instruction).

**The home page run (12 sheets).** Hero (ink) · context ticket (stock) · sources (ink) · organize (stock) · versions (ink) · sort (stock) · agents (ink) · local (stock) · free (fluo) · download (ink) · install (stock) · FAQ (ink). The nav maps onto it in page order: Features → context, Sources → sources, Demo → organize, Privacy → local, Download → download, Guide → install. Every sheet belongs to the nearest nav target above it, so the lit nav item follows the reader through versions, sort and agents.

**Registration target.** Four 26px rings with crosshairs (C, M, Y, K), multiplied. In the hero they start mis-registered and slide into register, then K appears; on later sheets they print already set. Hidden under 720px.

**Colour bar.** A strip of 10×18px patches down the left margin: C, M, Y, K, a taller 30px fluo patch, then the seven source inks in fixed order (ChatGPT, Gemini, Flow, AI Studio, Codex, Grok, Cowart). It doubles as the source legend. Used on the hero, the sources sheet and the download sheet. Hidden under 960px.

**Intro.** Every sheet opens the same way: the display line on the left, the lede on the right, bottom-aligned (7/5 split). Only the versions sheet stacks its lede under the heading, because its demo runs the full width below. There is no full-width "wide" intro.

**Grids inside the live area.** Asymmetric splits in twelfths (7/5, 5/7, 6/7, 7/4, 4/7, 3/9), never equal-thirds feature cards except where the content is genuinely three parallel columns (honesty cases, local docket). Where two columns sit side by side (context ticket, organize, versions compare, sort), both start on the same top line and end on the same bottom line: the shorter column pushes its last block to the bottom, or its rows share out the height. Sources and agents run their demo as one full-width row under the intro instead of a side column.

**Rhythm.** Section internals step by `section-gap` (clamp(48px, 6vw, 96px)); tables and lists use 14–20px row padding; display to lede gap is clamp(20px, 4vw, 72px) side by side or clamp(18px, 2vw, 28px) stacked.

**Responsive.**
- Above 1180px: the hero window is scaled to fit its column whole, all four corners showing (zoom = column width / 1100, 0.5–1).
- 721–1180px: the hero stacks (copy over window) and the window still fits whole; the context ticket stacks below 1100px Chinese / 1300px English; sources, organize, sort and agents demos stack; the sources chat window and library window go one over the other with the path turned vertical.
- ≤960px: nav collapses into a menu panel under the 64px masthead; every intro, ticket, compare, docket, FAQ, install and first-run grid becomes one column; proof rows scroll horizontally with snap; colour bar hidden.
- ≤720px: crop marks shrink, registration target and stamp hidden, masthead download hidden (the hero button carries it), the hero window crops to the inspector side at 0.52–0.7 zoom, the organize demo drops its sidebar, result grids go four-up, slug text 12px.

### Named Rules
**The Crop In Rule.** Product UI stays legible or is cropped, never miniaturised below about 0.5 zoom. On desktop and tablet the hero window fits whole; only phones crop it to the inspector side.

**The Same Lines Rule.** Two columns side by side share their top and bottom lines, in Chinese and English, at every width where they sit side by side. Columns of a docket share their title, box and note lines (subgrid). Measure it after any copy change.

**The Numbered Run Rule.** Every sheet's slug numbers it within its page's run (`SHEET 03 / 12`). A new page is its own run with its own total; numbers stay sequential and the total is updated when sheets are added or removed.

## Elevation & Depth

The press sheets are flat: depth comes from floods (ink vs stock vs fluo), heavy rules and overprint, not from shadows. Shadows exist only where a physical or on-screen object sits on the sheet: the app window, a printed poster lying on the stock, floating UI the product itself floats.

### Shadow Vocabulary
- **App window** (`box-shadow: 0 40px 80px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.07)`): the GravityPort window mock on black.
- **Print on stock** (`box-shadow: 0 34px 60px -34px rgba(18,18,18,0.55), 0 2px 6px rgba(18,18,18,0.14)`): a single poster laid on stock (context ticket).
- **Floating UI** (`box-shadow: 0 16px 40px rgba(0,0,0,0.45)` toast; `0 22px 44px rgba(0,0,0,0.55)` drag ghost; `0 10px 30px rgba(0,0,0,0.3)` slug tooltip; `0 30px 80px rgba(0,0,0,0.35)` dialog): transient layers only.
- **Selection ring** (`box-shadow: 0 0 0 2px #39FF14`): selected tile, card, proof, new feed item; drop target adds a `0 0 0 6px` 25% fluo halo.

### Named Rules
**The Flat Sheet Rule.** Nothing printed on the sheet (text, tables, buttons, rules, chips) carries a shadow. Borders are drawn as inset box-shadows or 1px / 3px ink rules.

**The Overprint Rule.** Where layers combine (plates, registration target), they multiply like ink, they do not stack with shadows.

## Shapes

Square. Every site element (buttons, chips, tags, fields, tables, floods, tooltips, dialog) has 0 radius. Rounded corners belong to the product: the app window (12px all round; on phones, where the hero window crops off the right trim, only its top-left corner shows), app controls (7px), cards (6px), tiles (5px), chat bubbles in the feed and console (14px / 12px with a 3px tail corner). The only circles are the registration target, the hand-drawn marker ring and the OK stamp. Lines are print lines: 1px hairlines for crop marks and row rules, 3px ink head rules over tables, FAQ, docket columns and the colophon, 1.5px inset strokes for line buttons.

**Provenance rules** are a shape vocabulary of their own: a 44px horizontal 2px stroke beside every piece of provenance.
- **Solid**: recorded (the Prompt or instruction was captured from the source).
- **Dashed**: observed, unverified (text visible on the page near the image, not confirmed as its Prompt).
- **Gap** (solid, open middle third, solid): unavailable (nothing recorded; GravityPort says so instead of inventing).

### Named Rules
**The Rule Type Rule.** Any place that states where an image came from shows the matching rule type, and the rule type always matches the record. Never draw a solid rule over an unverified or missing Prompt.

## Components

### Buttons
Blocky, square, heavy; they look like a printed panel, not a pill.
- **Shape:** square corners (0px), icon left at 22px.
- **Primary (fluo):** fluo fill, ink text, 760 weight 19px, 60px tall, padding 0 28px 0 24px. One per sheet, for download. On ink it hovers to stock with a 2px inset fluo stroke; on stock it hovers to ink with fluo text.
- **Line:** transparent, 1.5px inset stroke in currentColor, 52px tall, 16px. Hovers to a stock fill with ink text. Used for secondary platforms and dialog close.
- **Masthead download:** 34px fluo block, inverts to ink with fluo text on hover; hidden on phones.
- **Pending:** 0.55 opacity, not-allowed cursor, when the release feed has no package.
- **Text links:** 1px underline offset 0.22em; on black the underline is 40% stock and turns fluo on hover. The "free" sheet link uses a 2px ink underline and inverts to ink with fluo text.
- **Focus:** 2px ink outline offset 3px plus a 5px fluo halo on stock; on ink sheets a 2px fluo outline alone. Transitions 250ms on the press easing.

### Navigation
- **Masthead:** a sticky 64px stock slug carrying the mark (28px), wordmark (700, 17px), nav links (520, 14px), the 中 / EN switch in mono (active language bold ink with a 2px fluo underline) and the compact download. Links draw a 1px ink underline from the left on hover or when their sheet is current (400ms). A 1px ink bottom rule appears once the page scrolls.
- **Current sheet:** read from geometry (the sheet under the middle of the viewport) on scroll, resize and hashchange, with a 400ms poll for embedded views that hold back scroll events; never from an IntersectionObserver alone.
- **Arriving on a hash:** a link straight to a sheet (`/#install`, or the old `/guide/` URL, which redirects there) settles on the sheet again after load, unless the reader has already scrolled.
- **Mobile:** under 960px the links move into a full-width stock panel under the masthead, 17px, 1px ink-12% row rules.
- **Colophon:** a 3px ink head rule, a condensed display line, underlined links (30% ink, full ink on hover), and a mono uppercase slug.

### Tables and ruled lists
Docket and data lists (context ticket, honesty cases, FAQ, platforms, first-run steps, install steps, trash list): a 3px head rule (ink on stock, stock on black), 1px rows (ink on stock, 16% stock hairline on black), a fixed-width term column (7.2em Chinese, 9em English). The context ticket's rows share out the poster's height so its last rule lands on the poster's bottom edge. FAQ uses details/summary with a drawn plus that rotates to a cross over 300ms; it sits on an ink sheet with stock rules.

### Sources list
The capture sources read as one line of names (Archivo 700, 16–19px), each led by its 8×16px source-ink chip, followed by one 13px muted sentence on how each group is collected. No per-source cards.

### App mock (signature)
The GravityPort window rebuilt in HTML/CSS from the app's dark theme, filled with the owner's own images: traffic lights, a sidebar matching the real app (All assets, Unsorted, Favorites, Trash, Smart groups, My groups, Account), a toolbar (back/forward, title and count, type and sort selects, column count, search field), gallery, and inspector (instruction highlighted with a 28% fluo marker band, palette, version tree; the references block appears only when the image has references, as in the app). Set in the system UI face at 12px/20px. The grid row is locked to the window height so a tall gallery or inspector clips inside its own column. "My groups" stays collapsed and never shows the owner's real group names; a demo that needs groups uses obviously invented names. Fluo inside the mock is the app's own accent (selected nav icon, selection ring). Any later page that shows the product uses this same mock and these same greys, never a screenshot bitmap with a glow.

### Demos
Live demos sit inside an ink or stock sheet and are labelled as demos in mono ("demo, does not read your library"):
- **Sources feed:** a source chat window and the GravityPort library window side by side, joined by a dashed fluo path. The generating image unblurs by scanline, then flies into the library grid (6 across, 4 on phones) with a fluo ring on the new item; the slug line under the grid prints its provenance rule.
- **Organize:** the full app mock, draggable: marquee, drag ghost tilted -3deg with a fluo count badge, stacks, reorder, undo toast, keyboard reachable. The "try it" hint sits in the mono caption under the window.
- **Version proofs:** 2:3 proofs across the full width with fluo round tags; two pressed proofs compare side by side with the recorded instruction, the key round in the hand.
- **Sort (auto-stacking):** a 15-card gallery; each real conversation's images fly to their first image, oldest first, and become one stack card (two offset ink outlines behind the cover, a fluo count badge, the app's own stack name on an ink strip). The freed slots stay as hatched outlines with "N slots freed" so the gallery keeps its height; "play again" reruns it.
- **Agent console:** the request across the top, then the MCP call (fluo function name, no wrapping, scrolls sideways when narrow) beside what came back (a count line and a thumbnail grid, 6 across, 4 on phones).

### Policy page
`/privacy/` is a run of two sheets on the same masthead and colophon as the home page: an ink sheet with the title, a one-paragraph lede, the last-updated date in mono, and the five commitments as a ruled list; then a stock sheet with a sticky contents list (3/9 split; it lights the section under 40% of the viewport) beside one reading column of at most 46em, each section under a 3px ink head rule with a title-style heading. Commands are ink `cmd` blocks that scroll sideways instead of wrapping. The copy lives in `site/privacy-strings.js`, follows the app repository's PRIVACY.md, and is registered with the font subset script.

### Stack card
A gallery card standing for a stack: the cover image, two ink outline sheets offset 5px and 10px up and right behind it (drawn as stacked rings, not as a shadow), a 22px fluo count badge top right in mono, and the stack name on an 84% ink strip along the bottom.

### Install steps
Numbered steps in a ruled list (mono step number, title 17px 720, body 15px muted), with two side blocks under 3px head rules: the folder check (file names as mono chips on stock-2) and a short troubleshooting list.

### Slugs and the slug tooltip
Images marked as slugged print a tooltip on pointer: ink block, stock mono uppercase text, source · size · date, then the provenance rule (in fluo) and its status word.

### Stamp
A 112px fluo ring with a hand "OK", rotated -12deg, beside the download heading: the press-ok mark. One per page, hidden on phones.

### Motion grammar
- **Cadence:** one sheet takes 900ms on cubic-bezier(0.16, 1, 0.3, 1). Section blocks marked to print wipe in from the gripper edge (clip-path inset from the bottom to 0) when they enter the viewport.
- **Print trigger:** a block prints once its top passes 92% of the viewport height, read from `getBoundingClientRect()` on scroll, resize and hashchange plus a 300ms poll. Never trigger it with an IntersectionObserver on the clipped block itself: a block clipped to nothing has zero visible area, so the observer never fires and the page stays blank. Visual checks must scroll the real page; never force the printed state in a capture.
- **Hero run (the only extended sequence):** the K plate (headline, lede, actions) prints at 900ms with 120ms / 320ms offsets; the window prints over 1100ms from 160ms; the hero image's C, M, Y plates slide and rotate into register over 1100ms from about 400ms; the registration target closes at 1300ms; then the fluo plate prints the selection ring (900ms from 1700ms), the arrow (800ms from 2050ms) and the hand note (700ms from 2350ms); the slug types out in 28 steps from 2400ms.
- **State changes:** 160–400ms on the same easing (hover fills 250ms, underlines 400ms, FAQ 300ms).
- **Reduced motion:** the `motion` class is never added, every element renders in its final printed state, all transitions and animations are zeroed, smooth scroll is off. A failsafe removes `motion` if the script has not started within 4s.

### Named Rules
**The Print, Never Fade Rule.** Reveals are prints (clip-path wipes), plates registering, or slugs typing out. No opacity fade-slide, no scale-up entrances, no bounce.

**The Real Window Rule.** The product is shown as the HTML window with the owner's approved images and their real provenance. Demo data is labelled as demo.

## Do's and Don'ts

### Do:
- **Do** build every new page (privacy, release notes, online demo) as a run of sheets: margin, four crop marks, a live area that is ink, stock or fluo, and a mono slug with `SHEET NN / TT` and the ink spec that actually printed.
- **Do** alternate ink and stock sheets; reserve the fluo flood for one sheet per page at most.
- **Do** use fluo for exactly the primary action, selection and proof marks on any sheet.
- **Do** draw every provenance statement with its rule type: solid recorded, dashed observed-unverified, gap unavailable.
- **Do** set section headings in condensed black display (Archivo 820–900 at 62–78% width; GP Hei for Chinese) and size Chinese and English separately with the `:root[lang|="en"]` overrides.
- **Do** rerun `python3 -I scripts/fetch-site-fonts.py` after changing any display line or hand note, and register a new page's display and hand keys in that script.
- **Do** use the owner's approved images from `assets/work/` with their recorded slug data; show the product with the HTML app mock.
- **Do** print in with the 900ms clip-path wipe and give every animated element a final state that reduced motion shows directly.
- **Do** wire image slugs to keyboard focus as well as pointer when adding slugged images.
- **Do** keep two side-by-side columns on the same top and bottom lines, and recheck them in both languages after any copy change.
- **Do** mark Chinese display break points with `<wbr />` and check display lines at 360px, 1280px and 1440px.
- **Do** keep the extension install steps on the home page (the install sheet); `/guide/` only redirects there.
- **Do** keep zh and en equal: both get their own line breaks, quotes (「」 vs “”) and line-heights (1.7 vs 1.6).

### Don't:
- **Don't** use the dark SaaS hero: a glowing tilted screenshot over a row of equal feature cards.
- **Don't** use cyan, magenta or yellow outside the colour bar, registration target and plates; don't use source inks for anything but source identification.
- **Don't** set fluo text on stock.
- **Don't** put small labels or kickers above display headings; the slug in the margin is where data lives.
- **Don't** use Fragment Mono for headings or prose, or Long Cang for anything but proof notes and the OK stamp.
- **Don't** round site elements; radius belongs only to the app mock.
- **Don't** add shadows to printed elements (text, buttons, tables, chips).
- **Don't** reveal with fades, slides or scale-ups.
- **Don't** invent counts, testimonials, benchmarks or Prompts, and never draw a solid rule over unrecorded provenance.
- **Don't** show the owner's real group names in any mock; keep "My groups" collapsed.
- **Don't** leave a lede stranded far from its heading to fill a column; restructure the sheet instead.
- **Don't** load fonts from a CDN; all faces are self-hosted in `assets/fonts/`.
- **Don't** write inline `<script>`, `<style>` or `style="…"` attributes: production sends `script-src 'self'; style-src 'self'`. Per-element colours and ratios go through `data-c` / `data-ar` hooks in press.css; early-paint logic lives in `site/boot.js`. The local preview server sends the same policy.
- **Don't** copy design-direction or contract text into any browser-delivered file (HTML, CSS, JS, strings).
