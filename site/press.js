/* GravityPort site — behaviour for the press sheet pages. No dependencies. */
(function () {
  "use strict";
  window.__gpReady = true;

  const root = document.documentElement;
  const STR = window.GP_STRINGS || { zh: {}, en: {} };
  const WORK = window.GP_WORK || {};
  const prefersMotion = () => root.classList.contains("motion");
  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));
  // The English home page lives one level down (/en/), so site files resolve from the site root, not the page.
  const siteBase = new URL(root.getAttribute("data-site-root") || "./", document.baseURI).href;
  const fromSite = (u) => (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(u) ? u : new URL(u, siteBase).href);
  // Absolute URLs: these also end up inside CSS custom properties, where a relative url() would resolve against the stylesheet.
  const img = (slug, w) => new URL(`assets/work/${slug}-${w || 360}.webp`, siteBase).href;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ---------------- Language ---------------- */
  let lang = root.getAttribute("data-lang") === "en" ? "en" : "zh";
  const pageLang = root.getAttribute("data-page-lang");
  const t = (key, vars) => {
    let s = (STR[lang] && STR[lang][key]) ?? (STR.zh && STR.zh[key]) ?? "";
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(`{${k}}`, vars[k]); });
    return s;
  };

  function applyLang(next, save) {
    lang = next === "en" ? "en" : "zh";
    root.setAttribute("data-lang", lang);
    root.setAttribute("lang", lang === "en" ? "en" : "zh-CN");
    $$("[data-i18n]").forEach((el) => {
      const v = t(el.getAttribute("data-i18n"));
      if (v !== "" || el.hasAttribute("data-i18n-empty-ok")) el.textContent = v;
      else if (el.classList.contains("slug__gloss")) el.textContent = "";
    });
    $$("[data-i18n-html]").forEach((el) => {
      const v = t(el.getAttribute("data-i18n-html"));
      if (v) el.innerHTML = v;
    });
    $$("[data-i18n-attr]").forEach((el) => {
      el.getAttribute("data-i18n-attr").split(";").forEach((pair) => {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        if (attr && key && t(key)) el.setAttribute(attr, t(key));
      });
    });
    const titleKey = document.querySelector("title[data-i18n]")?.getAttribute("data-i18n") || "meta.title";
    document.title = t(titleKey);
    if (save) {
      try { localStorage.setItem("gp-lang", lang); } catch (e) { /* storage may be blocked */ }
    }
    root.classList.remove("lang-pending");
    document.dispatchEvent(new CustomEvent("gp:lang", { detail: { lang } }));
  }

  // The toggle is a real link to the same page in the other language; the click handler keeps
  // working when JS is on: store the choice first, then go. The home pages keep their query and
  // hash; the privacy pages follow their link (query dropped, so a stale ?lang= cannot undo the
  // switch) or switch in place when the link already points at the language being left.
  $$("[data-lang-toggle]").forEach((el) => el.addEventListener("click", (event) => {
    event.preventDefault();
    const next = lang === "zh" ? "en" : "zh";
    try { localStorage.setItem("gp-lang", next); } catch (e) { /* storage may be blocked */ }
    if (pageLang !== "zh" && pageLang !== "en") {
      const href = el.getAttribute("href") || "";
      const hrefLang = /^\/en(?:\/|$)/.test(href) ? "en" : "zh";
      if (hrefLang === next) { location.href = href + location.hash; return; }
      applyLang(next, true);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete("lang");
    const query = params.toString();
    location.href = (next === "en" ? "/en/" : "/") + (query ? `?${query}` : "") + location.hash;
  }));

  /* ---------------- Masthead ---------------- */
  const masthead = $("[data-masthead]");
  const onScroll = () => masthead && masthead.classList.toggle("is-stuck", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const menuBtn = $("[data-menu-toggle]");
  const nav = $("#site-nav");
  if (menuBtn && nav) {
    const setMenu = (open) => {
      nav.classList.toggle("is-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", t(open ? "nav.menuClose" : "nav.menu"));
    };
    menuBtn.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  }

  /* Mark the section in view in the nav: every sheet belongs to the last nav target at or above it,
     so the sheets between two nav targets (versions, sort, agents…) keep the right item lit. */
  const navLinks = $$(".masthead__nav a[href^='#']");
  if (navLinks.length) {
    const targets = new Map(navLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const owners = [];
    let current = null;
    $$("main .sheet").forEach((sheet) => {
      if (targets.has(sheet.id)) current = targets.get(sheet.id);
      owners.push([sheet, current]);
    });
    // Plain geometry on scroll (like the print trigger): the sheet under the middle of the viewport wins.
    let lit;
    const markNav = () => {
      const mid = window.innerHeight * 0.5;
      const hit = owners.find(([sheet]) => { const r = sheet.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
      const link = hit ? hit[1] : null;
      if (link === lit) return;
      lit = link;
      navLinks.forEach((a) => { if (a === link) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    };
    window.addEventListener("scroll", markNav, { passive: true });
    window.addEventListener("resize", markNav);
    window.addEventListener("hashchange", markNav);
    // Same fallback as the print trigger: some embedded views hold back scroll events.
    setInterval(() => { if (!document.hidden) markNav(); }, 400);
    markNav();
  }

  /* A link straight to a sheet (/#install, or /guide/ redirecting here) lands before images above it have
     taken their height; settle on the sheet again once the page has loaded, unless the reader already scrolled. */
  if (location.hash.length > 1) {
    const startY = window.scrollY;
    window.addEventListener("load", () => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target && Math.abs(window.scrollY - startY) < 40) target.scrollIntoView({ behavior: "instant", block: "start" });
    }, { once: true });
  }

  /* Policy contents: light the section under the middle of the viewport (same geometry as the nav). */
  const tocLinks = $$(".policy__toc a[href^='#']");
  if (tocLinks.length) {
    const secs = tocLinks.map((a) => [document.getElementById(a.getAttribute("href").slice(1)), a]).filter(([el]) => el);
    let litToc;
    const markToc = () => {
      const mid = window.innerHeight * 0.4;
      let hit = null;
      secs.forEach(([el, a]) => { if (el.getBoundingClientRect().top <= mid) hit = a; });
      if (hit === litToc) return;
      litToc = hit;
      tocLinks.forEach((a) => { if (a === hit) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
    };
    window.addEventListener("scroll", markToc, { passive: true });
    window.addEventListener("resize", markToc);
    setInterval(() => { if (!document.hidden) markToc(); }, 400);
    markToc();
  }

  /* ---------------- Palettes ---------------- */
  $$("[data-palette]").forEach((el) => {
    const w = WORK[el.getAttribute("data-palette")];
    if (!w) return;
    el.innerHTML = "";
    w.palette.forEach((c) => { const i = document.createElement("i"); i.style.setProperty("--c", c); el.appendChild(i); });
  });

  /* ---------------- Print-in reveal ---------------- */
  // Unprinted blocks are clip-path'd to nothing, which an IntersectionObserver reads as zero visible area,
  // so the trigger is plain geometry: a block prints once its top passes 92% of the viewport height
  // (blocks already scrolled past print too). No rAF, so it also works in throttled or background tabs.
  let unprinted = $$("[data-print]");
  const printInView = () => {
    const line = window.innerHeight * 0.92;
    unprinted = unprinted.filter((el) => {
      if (el.getBoundingClientRect().top < line) { el.classList.add("is-in"); return false; }
      return true;
    });
    if (!unprinted.length) {
      window.removeEventListener("scroll", printInView);
      window.removeEventListener("resize", printInView);
      clearInterval(printTimer);
    }
  };
  let printTimer = 0;
  if (prefersMotion()) {
    window.addEventListener("scroll", printInView, { passive: true });
    window.addEventListener("resize", printInView);
    window.addEventListener("hashchange", printInView);
    // Some embedded or throttled views hold back scroll events; a slow poll keeps prints from stalling.
    printTimer = setInterval(printInView, 300);
    printInView();
  } else {
    unprinted.forEach((el) => el.classList.add("is-in"));
    unprinted = [];
  }

  /* ---------------- Hero: window scale, plates, press run ---------------- */
  const hero = $(".sheet--hero");
  const heroFigure = $("[data-app-figure]");
  const heroApp = $(".app--hero");
  const APP_W = 1100;

  function sizeHeroApp() {
    if (!heroFigure || !heroApp) return;
    const w = heroFigure.clientWidth;
    const vw = window.innerWidth;
    let z;
    let ox = 0;
    if (vw > 1180) {
      z = Math.min(1, Math.max(0.5, w / APP_W));
    } else if (vw > 720) {
      // The whole window fits inside the figure; only phones crop it to the inspector side.
      z = Math.min(1, w / APP_W);
    } else {
      z = Math.min(0.7, Math.max(0.52, (w + 40) / 620));
      ox = -470 * z;
    }
    heroFigure.style.setProperty("--z", z.toFixed(4));
    heroFigure.style.setProperty("--ox", `${ox.toFixed(1)}px`);
    placeHeroMarks();
  }

  function placeHeroMarks() {
    if (!heroApp || !heroFigure) return;
    const instr = $("[data-hero-instruction] .app__text", heroApp);
    const focus = $("[data-hero-focus]", heroApp);
    const ring = $(".hero__ring", heroFigure);
    const arrow = $(".hero__arrow", heroFigure);
    const note = $(".hero__note", heroFigure);
    const live = heroFigure.closest(".live");
    if (!instr || !focus || !ring || !arrow || !note || !live) return;
    // Everything here is in figure coordinates (the figure itself is not zoomed).
    const fig = heroFigure.getBoundingClientRect();
    const lv = live.getBoundingClientRect();
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.left - fig.left, y: b.top - fig.top, w: b.width, h: b.height }; };
    const ir = box(instr);
    const tile = box(focus);
    const appTop = heroApp.getBoundingClientRect().top - fig.top;
    const visibleRight = Math.min(lv.right, window.innerWidth) - fig.left - 20;

    // The marker ring overshoots the circled poster; the gallery would clip it, so it lives on the figure.
    // Its path is drawn in pixels (viewBox = box), so the stroke-dash draw-on covers the whole stroke.
    const rw = tile.w + 30, rh = tile.h + 30;
    Object.assign(ring.style, { left: `${tile.x - 16}px`, top: `${tile.y - 16}px`, width: `${rw}px`, height: `${rh}px` });
    ring.setAttribute("viewBox", `0 0 ${rw} ${rh}`);
    const RING = [
      "M60 5 C86 8 98 30 97 56 C95 84 74 98 47 97 C19 95 3 75 4 47 C6 20 25 4 52 3 C65 3 78 7 87 16",
      "M57 7 C83 11 95 33 94 57 C92 82 71 95 46 94 C22 92 6 73 7 47 C9 24 27 8 51 6",
    ];
    $$("path", ring).forEach((path, k) => {
      let axis = 0;
      path.setAttribute("d", RING[k].replace(/-?\d+(\.\d+)?/g, (n) => ((axis++ % 2 === 0 ? rw : rh) * Number(n) / 100).toFixed(1)));
    });

    // The proof note sits above the window, over the circled poster, in the black margin.
    const noteW = note.offsetWidth;
    const noteH = note.offsetHeight;
    const noteLeft = Math.max(8, Math.min(tile.x - 10, visibleRight - noteW));
    const noteTop = appTop - Math.max(72, Math.min(112, fig.top - lv.top - 18));
    Object.assign(note.style, { left: `${noteLeft}px`, top: `${noteTop}px` });

    // The arrow runs down the inspector's inner margin to the recorded instruction.
    const lineX = ir.x - 7;
    const targetX = ir.x + 2;
    const targetY = ir.y + Math.min(ir.h, 44) / 2;
    const noteRight = noteLeft + noteW;
    const sx = noteRight > lineX + 24 ? lineX + 24 : noteRight + 8;
    const sy = noteRight > lineX + 24 ? noteTop + noteH + 8 : noteTop + noteH * 0.6;
    const left = Math.min(sx, lineX, targetX) - 24;
    const top = Math.min(sy, targetY) - 12;
    const width = Math.max(sx, lineX, targetX) - left + 24;
    const height = targetY - top + 24;
    arrow.setAttribute("viewBox", `0 0 ${width} ${height}`);
    Object.assign(arrow.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const p = (x, y) => `${(x - left).toFixed(1)} ${(y - top).toFixed(1)}`;
    const d = `M${p(sx, sy)} C${p(sx, sy + 30)} ${p(lineX, sy + 14)} ${p(lineX, sy + 56)} L${p(lineX, targetY - 30)} Q${p(lineX, targetY)} ${p(targetX, targetY)}` +
      ` M${p(targetX, targetY)} l-12 -7 M${p(targetX, targetY)} l-11 8`;
    arrow.querySelector("path").setAttribute("d", d);
    hero.classList.add("is-marked");
  }

  function buildPlates() {
    const tiles = $$("[data-plates]");
    const withPlates = prefersMotion();
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    tiles.forEach((tile) => {
      const slug = tile.getAttribute("data-work");
      // The image ships in the HTML so the window still shows without scripts; plates are layered on top.
      let ink = $(".tile__ink", tile);
      if (!ink) {
        ink = document.createElement("div");
        ink.className = "tile__ink";
        const im = document.createElement("img");
        im.className = "tile__img";
        im.src = img(slug, 360);
        im.alt = "";
        ink.appendChild(im);
        tile.insertBefore(ink, tile.firstChild);
      }
      if (withPlates) {
        ink.classList.add("has-plates");
        const col = Array.prototype.indexOf.call(tile.parentNode.parentNode.children, tile.parentNode);
        const row = Array.prototype.indexOf.call(tile.parentNode.children, tile);
        ["y", "m", "c"].forEach((p, k) => {
          const s = document.createElement("span");
          s.className = `plate plate--${p}`;
          s.style.setProperty("--img", `url("${img(slug, 360)}")`);
          s.style.setProperty("--dx", `${((rnd() - 0.5) * 30).toFixed(1)}px`);
          s.style.setProperty("--dy", `${((rnd() - 0.5) * 22).toFixed(1)}px`);
          s.style.setProperty("--rot", `${((rnd() - 0.5) * 1.6).toFixed(2)}deg`);
          s.style.setProperty("--delay", `${420 + col * 70 + row * 50 + k * 110}ms`);
          ink.appendChild(s);
        });
      }
    });
    return tiles;
  }

  function settlePlates() {
    $$(".tile__ink.has-plates").forEach((ink) => {
      ink.classList.remove("has-plates");
      $$(".plate", ink).forEach((p) => p.remove());
    });
  }

  async function pressRun() {
    if (!hero) return;
    const tiles = buildPlates();
    sizeHeroApp();
    if (!prefersMotion()) { hero.classList.add("is-printed"); return; }
    const images = tiles.map((tile) => $(".tile__img", tile)).filter(Boolean);
    const ready = Promise.all(images.map((im) => (im.decode ? im.decode().catch(() => null) : null)));
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    await Promise.race([Promise.all([ready, fonts]), wait(1400)]);
    placeHeroMarks();
    const go = () => hero.classList.add("is-printed");
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 120); // rAF stalls in background tabs
    await wait(2900);
    settlePlates();
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sizeHeroApp, 80);
  });

  /* ---------------- Slug tooltip on images ---------------- */
  const tip = $("[data-slugtip]");
  function slugHTML(slug) {
    const w = WORK[slug];
    if (!w) return "";
    return `${w.source} · ${w.w}×${w.h} · ${w.created}`;
  }
  if (tip) {
    const show = (el, x, y) => {
      tip.innerHTML = slugHTML(el.getAttribute("data-work"));
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - r.width - 12, x + 16)}px`;
      tip.style.top = `${Math.min(window.innerHeight - r.height - 12, y + 18)}px`;
    };
    $$("[data-slugged]").forEach((el) => {
      el.addEventListener("pointermove", (e) => show(el, e.clientX, e.clientY));
      el.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }

  /* ---------------- Sources: live feed ---------------- */
  const FEED = [
    { label: "ChatGPT", color: "var(--src-chatgpt)", slug: "signal-2", say: "鸟太多了，看着有点乱，只留三五只就好。丝带再细一点、更轻盈，像一根发光的丝线。其他保持不变。", gloss: "Too many birds, it looks busy; keep three to five. Make the ribbon thinner and lighter, like a glowing thread. Leave the rest." },
    { label: "Google AI Studio", color: "var(--src-studio)", slug: "yuanzi", say: "把海报中的人物放大一倍，其他的保持不变", gloss: "Make the figure twice as large, keep everything else." },
    { label: "Codex", color: "var(--src-codex)", slug: "pink-train", say: "你直接生图就行，3:4", gloss: "Just generate it, 3:4." },
    { label: "Flow", color: "var(--src-flow)", slug: "singer-flow", say: "", gloss: "" },
  ];
  const feed = $("[data-feed]");
  if (feed) {
    const grid = $("[data-feed-grid]", feed);
    const label = $("[data-feed-label]", feed);
    const tab = $(".feed__tab", feed);
    const say = $("[data-feed-say]", feed);
    const gen = $("[data-feed-gen]", feed);
    const genImg = $("[data-feed-img]", feed);
    const slugEl = $("[data-feed-slug]", feed);
    const pool = ["bangkok", "passage", "desert-wind", "nexus", "before-time", "museum", "tea-market", "misty-lake", "wild-sight", "rhythm", "tea-ceremony", "somewhere-else"];
    grid.innerHTML = "";
    pool.forEach((slug) => {
      const d = document.createElement("div");
      d.style.backgroundImage = `url("${img(slug, 360)}")`;
      grid.appendChild(d);
    });
    let step = 0;
    let running = false;
    let visible = false;

    const writeSlug = (item) => {
      const w = WORK[item.slug];
      slugEl.innerHTML = `<span>${item.label}</span><span>${w ? `${w.w}×${w.h}` : ""}</span><span>${w ? w.created : ""}</span>`;
    };
    const setSource = (item) => {
      label.textContent = item.label;
      tab.style.setProperty("--feed-c", item.color);
      if (item.say) {
        say.classList.remove("is-muted");
        say.innerHTML = "";
        say.appendChild(document.createTextNode(item.say));
        if (lang === "en" && item.gloss) {
          const g = document.createElement("span");
          g.className = "feed__gloss";
          g.textContent = item.gloss;
          say.appendChild(g);
        }
        say.hidden = false;
      } else {
        say.textContent = "";
        say.hidden = true;
      }
      genImg.style.setProperty("--img", `url("${img(item.slug, 960)}")`);
    };
    const fly = (item) => new Promise((resolve) => {
      const from = gen.getBoundingClientRect();
      const first = grid.firstElementChild;
      const to = first.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "feed__fly";
      ghost.style.backgroundImage = `url("${img(item.slug, 360)}")`;
      Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
      document.body.appendChild(ghost);
      const anim = ghost.animate([
        { transform: "translate(0,0) scale(1)" },
        { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})` },
      ], { duration: 900, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
      ghost.style.transformOrigin = "0 0";
      anim.onfinish = () => {
        const d = document.createElement("div");
        d.style.backgroundImage = `url("${img(item.slug, 360)}")`;
        d.classList.add("is-new");
        $$(".is-new", grid).forEach((n) => n.classList.remove("is-new"));
        grid.insertBefore(d, grid.firstChild);
        if (grid.children.length > pool.length) grid.lastElementChild.remove();
        ghost.remove();
        resolve();
      };
    });
    const show = async (item) => {
      setSource(item);
      gen.classList.add("is-generating");
      genImg.style.setProperty("--scan", "100%");
      await wait(60);
      gen.classList.remove("is-generating");
      await wait(1700);
      if (prefersMotion()) await fly(item);
      writeSlug(item);
    };
    const loop = async () => {
      if (running) return;
      running = true;
      while (visible && !document.hidden) {
        await show(FEED[step % FEED.length]);
        step += 1;
        await wait(2000);
      }
      running = false;
    };
    if (prefersMotion() && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) loop();
      }, { threshold: 0.35 }).observe(feed);
      document.addEventListener("visibilitychange", () => { if (!document.hidden && visible) loop(); });
    } else {
      setSource(FEED[0]);
      writeSlug(FEED[0]);
    }
    document.addEventListener("gp:lang", () => {
      const item = FEED[(step + FEED.length - 1) % FEED.length] || FEED[0];
      setSource(item);
      writeSlug(item);
    });
  }

  /* ---------------- Organize: a working drag demo ---------------- */
  const org = $("[data-organize]");
  if (org) {
    const grid = $("[data-organize-grid]", org);
    const toast = $("[data-toast]", org);
    const toastText = $("[data-toast-text]", org);
    const undoBtn = $("[data-toast-undo]", org);
    const ghostCursor = $("[data-ghost]", org);
    const countLabel = $("[data-count-label]", org);
    const countAll = $("[data-count-all]", org);
    const countUnsorted = $("[data-count-unsorted]", org);
    const START = ["bangkok", "hangzhou", "passage", "bangkok-b", "quiet-music", "desert-wind", "signal-4", "wild-sight", "tea-market", "read-the-sky", "misty-lake", "somewhere-else"];
    let state = { cards: START.map((slug) => ({ slug, stack: [slug] })) };
    let selected = new Set();
    let history = null;
    let toastTimer = 0;
    let interacted = false;


    const clone = (s) => JSON.parse(JSON.stringify(s));
    const render = () => {
      grid.innerHTML = "";
      state.cards.forEach((card, n) => {
        const el = document.createElement("div");
        el.className = "card";
        el.setAttribute("role", "listitem");
        el.tabIndex = 0;
        el.dataset.slug = card.slug;
        el.setAttribute("aria-label", t("organize.card", { n: n + 1 }));
        if (card.stack.length > 1) {
          el.classList.add("is-stack");
          const c = document.createElement("span");
          c.className = "card__count";
          c.textContent = card.stack.length;
          el.appendChild(c);
        }
        if (selected.has(card.slug)) el.classList.add("is-selected");
        const im = document.createElement("img");
        im.src = img(card.slug, 360);
        im.alt = "";
        im.draggable = false;
        el.insertBefore(im, el.firstChild);
        grid.appendChild(el);
      });
      const total = state.cards.reduce((s, c) => s + c.stack.length, 0);
      countLabel.textContent = t("organize.count", { n: total });
      countAll.textContent = String(total);
      countUnsorted.textContent = String(total);
    };

    const showToast = (msg, undoable) => {
      toastText.textContent = msg;
      undoBtn.hidden = !undoable;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; history = null; }, undoable ? 4500 : 2400);
    };
    undoBtn.addEventListener("click", () => {
      if (!history) return;
      state = history;
      history = null;
      selected.clear();
      render();
      showToast(t("organize.toastUndone"), false);
    });

    const dropOnCard = (slugs, targetSlug) => {
      history = clone(state);
      const target = state.cards.find((c) => c.slug === targetSlug);
      const moving = state.cards.filter((c) => slugs.includes(c.slug) && c.slug !== targetSlug);
      moving.forEach((c) => { target.stack.push(...c.stack); });
      state.cards = state.cards.filter((c) => !moving.includes(c));
      selected.clear();
      render();
      showToast(t("organize.toastStack", { n: target.stack.length }), true);
    };
    const reorder = (slugs, beforeSlug) => {
      const moving = state.cards.filter((c) => slugs.includes(c.slug));
      const rest = state.cards.filter((c) => !slugs.includes(c.slug));
      let idx = beforeSlug ? rest.findIndex((c) => c.slug === beforeSlug) : rest.length;
      if (idx < 0) idx = rest.length;
      rest.splice(idx, 0, ...moving);
      state.cards = rest;
      render();
    };

    // Pointer: drag cards, marquee on empty space.
    let drag = null;
    const cardAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest(".card") : null;
    };
    const targetAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const card = el.closest(".card");
      if (card && org.contains(card) && !drag.slugs.includes(card.dataset.slug)) return { kind: "card", el: card, key: card.dataset.slug };
      const r = org.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return { kind: "out" };
      if (el.closest("[data-organize-grid]")) return { kind: "grid" };
      return null;
    };
    const clearTargets = () => $$(".is-over, .is-target", org).forEach((x) => x.classList.remove("is-over", "is-target"));

    grid.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      interacted = true;
      const card = e.target.closest(".card");
      if (card) {
        const slug = card.dataset.slug;
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          if (selected.has(slug)) selected.delete(slug); else selected.add(slug);
        } else if (!selected.has(slug)) {
          selected = new Set([slug]);
        }
        render();
        drag = { mode: "pending", x: e.clientX, y: e.clientY, slugs: Array.from(selected), pointerId: e.pointerId };
      } else {
        const g = grid.getBoundingClientRect();
        const box = document.createElement("div");
        box.className = "marquee";
        grid.appendChild(box);
        drag = { mode: "marquee", x: e.clientX, y: e.clientY, gx: g.left, gy: g.top, box, base: e.shiftKey ? new Set(selected) : new Set() };
        selected = new Set(drag.base);
        render();
        grid.appendChild(box);
      }
      grid.setPointerCapture(e.pointerId);
    });

    grid.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (drag.mode === "pending" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) {
        drag.mode = "drag";
        drag.ghost = document.createElement("div");
        drag.ghost.className = "card-ghost";
        drag.ghost.style.backgroundImage = `url("${img(drag.slugs[0], 360)}")`;
        if (drag.slugs.length > 1) { const b = document.createElement("b"); b.textContent = drag.slugs.length; drag.ghost.appendChild(b); }
        document.body.appendChild(drag.ghost);
        $$(".card", grid).forEach((c) => { if (drag.slugs.includes(c.dataset.slug)) c.classList.add("is-lifted"); });
      }
      if (drag.mode === "drag") {
        drag.ghost.style.left = `${e.clientX - 40}px`;
        drag.ghost.style.top = `${e.clientY - 50}px`;
        clearTargets();
        const tgt = targetAt(e.clientX, e.clientY);
        drag.target = tgt;
        if (tgt && tgt.kind === "card") tgt.el.classList.add("is-target");
      }
      if (drag.mode === "marquee") {
        const x1 = Math.min(drag.x, e.clientX), y1 = Math.min(drag.y, e.clientY);
        const x2 = Math.max(drag.x, e.clientX), y2 = Math.max(drag.y, e.clientY);
        Object.assign(drag.box.style, { left: `${x1 - drag.gx}px`, top: `${y1 - drag.gy}px`, width: `${x2 - x1}px`, height: `${y2 - y1}px` });
        const next = new Set(drag.base);
        $$(".card", grid).forEach((c) => {
          const r = c.getBoundingClientRect();
          if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) next.add(c.dataset.slug);
        });
        selected = next;
        $$(".card", grid).forEach((c) => c.classList.toggle("is-selected", selected.has(c.dataset.slug)));
      }
    });

    const endDrag = (e) => {
      if (!drag) return;
      if (drag.mode === "drag") {
        drag.ghost.remove();
        const tgt = drag.target;
        clearTargets();
        if (tgt && tgt.kind === "card") dropOnCard(drag.slugs, tgt.key);
        else if (tgt && tgt.kind === "out") { render(); showToast(t("organize.toastOut"), false); }
        else {
          const under = cardAt(e.clientX, e.clientY);
          reorder(drag.slugs, under ? under.dataset.slug : null);
        }
      } else if (drag.mode === "marquee") {
        drag.box.remove();
      }
      drag = null;
    };
    grid.addEventListener("pointerup", endDrag);
    grid.addEventListener("pointercancel", () => { if (drag && drag.ghost) drag.ghost.remove(); if (drag && drag.box) drag.box.remove(); drag = null; clearTargets(); render(); });

    // Keyboard: Space picks up, arrows choose a target, Enter drops, Esc cancels.
    let kb = null;
    const targetsList = () => $$(".card", grid).filter((x) => !kb || !kb.slugs.includes(x.dataset.slug));
    grid.addEventListener("keydown", (e) => {
      const card = e.target.closest(".card");
      if (!card) return;
      interacted = true;
      if (!kb && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        if (!selected.has(card.dataset.slug)) selected = new Set([card.dataset.slug]);
        kb = { slugs: Array.from(selected), index: 0 };
        render();
        showToast(t("organize.picked"), false);
        const list = targetsList();
        if (list[0]) list[0].classList.add("is-target");
        return;
      }
      if (kb && (e.key.startsWith("Arrow"))) {
        e.preventDefault();
        const list = targetsList();
        kb.index = (kb.index + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + list.length) % list.length;
        clearTargets();
        list[kb.index].classList.add("is-target");
        return;
      }
      if (kb && e.key === "Enter") {
        e.preventDefault();
        const tgt = targetsList()[kb.index];
        clearTargets();
        if (tgt) dropOnCard(kb.slugs, tgt.dataset.slug);
        kb = null;
        const first = $(".card", grid);
        if (first) first.focus();
        return;
      }
      if (kb && e.key === "Escape") { kb = null; clearTargets(); toast.hidden = true; }
    });

    render();
    document.addEventListener("gp:lang", render);

    // A guided pass the first time the demo comes into view, until someone touches it.
    const cursorTo = (x, y, ms) => ghostCursor.animate([{ transform: ghostCursor.style.transform || "translate(0,0)" }, { transform: `translate(${x}px, ${y}px)` }], { duration: ms, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" }).finished.then(() => { ghostCursor.style.transform = `translate(${x}px, ${y}px)`; });
    const centerOf = (el) => {
      const o = org.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 };
    };
    async function tour() {
      if (interacted || !prefersMotion()) return;
      const cards = $$(".card", grid);
      const a = cards.find((c) => c.dataset.slug === "bangkok-b");
      const b = cards.find((c) => c.dataset.slug === "bangkok");
      if (!a || !b) return;
      ghostCursor.classList.add("is-on");
      const pa = centerOf(a);
      ghostCursor.style.transform = `translate(${pa.x + 120}px, ${pa.y + 80}px)`;
      await cursorTo(pa.x, pa.y, 700);
      if (interacted) { ghostCursor.classList.remove("is-on"); return; }
      a.classList.add("is-selected");
      const pb = centerOf(b);
      const ghost = document.createElement("div");
      ghost.className = "card-ghost";
      ghost.style.backgroundImage = `url("${img("bangkok-b", 360)}")`;
      document.body.appendChild(ghost);
      a.classList.add("is-lifted");
      const anim = ghostCursor.animate([{ transform: `translate(${pa.x}px, ${pa.y}px)` }, { transform: `translate(${pb.x}px, ${pb.y}px)` }], { duration: 1000, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 1000);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const x = pa.x + (pb.x - pa.x) * e, y = pa.y + (pb.y - pa.y) * e;
        const o = org.getBoundingClientRect();
        ghost.style.left = `${o.left + x - 40}px`;
        ghost.style.top = `${o.top + y - 50}px`;
        if (p > 0.85) b.classList.add("is-target");
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await anim.finished;
      ghostCursor.style.transform = `translate(${pb.x}px, ${pb.y}px)`;
      ghost.remove();
      if (!interacted) dropOnCard(["bangkok-b"], "bangkok");
      await wait(900);
      ghostCursor.classList.remove("is-on");
    }
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) { io.disconnect(); setTimeout(tour, 900); }
      }, { threshold: 0.5 });
      io.observe(org);
    }
    document.addEventListener("gp:lang", render);
  }

  /* ---------------- Versions: proofs and compare ---------------- */
  const proofsRow = $("[data-proof-row]");
  if (proofsRow) {
    const ROUNDS = ["signal-1", "signal-2", "signal-3", "signal-4"];
    const KEY = "signal-3";
    const GLOSS = {
      "signal-2": "“Too many birds, it looks a bit busy; keep just three to five. Make the ribbon thinner and lighter, like a glowing thread. Leave everything else.”",
      "signal-3": "“Better, but too dark overall, a bit oppressive. Make it just before dawn: the sky fading from deep blue to a very faint pink at the horizon, a little more cool light on the sea, and keep the ribbon and birds as they are.”",
      "signal-4": "“The order’s right; one last tweak: remove the Milky Way and clean up the sky, just a few stars. The lighthouse is too small to register; make it bigger and put it in the lower third. Thinner title, wider letter spacing. Don’t touch anything else.”",
    };
    let pair = ["signal-2", "signal-3"];
    const said = (slug) => (WORK[slug] && WORK[slug].instruction) || "";
    const md = (slug) => (WORK[slug] ? WORK[slug].created.slice(5) : "");
    const build = () => {
      proofsRow.innerHTML = "";
      ROUNDS.forEach((slug, n) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = `proof${slug === KEY ? " is-key" : ""}`;
        b.dataset.slug = slug;
        b.innerHTML = `<span class="proof__img"><img src="${img(slug, 360)}" alt="" width="360" height="640" loading="lazy" decoding="async"></span>` +
          `<span class="proof__meta mono"><span>R${n + 1}</span><span>${md(slug)}</span></span>` +
          `<span class="proof__said" lang="${/[一-鿿]/.test(said(slug)) ? "zh-CN" : "en"}"></span>`;
        $(".proof__said", b).textContent = said(slug);
        b.setAttribute("aria-label", `R${n + 1} · ${md(slug)} · ${t("versions.pick")}`);
        b.addEventListener("click", () => {
          if (pair.includes(slug)) return;
          pair = [pair[1], slug].sort((x, y) => ROUNDS.indexOf(x) - ROUNDS.indexOf(y));
          update();
        });
        li.appendChild(b);
        proofsRow.appendChild(li);
      });
      update();
    };
    const update = () => {
      $$(".proof", proofsRow).forEach((b) => {
        const k = pair.indexOf(b.dataset.slug);
        b.setAttribute("aria-pressed", String(k >= 0));
        const old = $(".proof__tag", b);
        if (old) old.remove();
        if (k >= 0) {
          const tag = document.createElement("span");
          tag.className = "proof__tag";
          tag.textContent = k === 0 ? "A" : "B";
          $(".proof__img", b).appendChild(tag);
        }
      });
      const [a, b] = pair;
      const ra = ROUNDS.indexOf(a) + 1, rb = ROUNDS.indexOf(b) + 1;
      $("[data-compare-a]").src = img(a, 960);
      $("[data-compare-b]").src = img(b, 960);
      $("[data-compare-a-meta]").textContent = `R${ra} · ${md(a)}`;
      $("[data-compare-b-meta]").textContent = `R${rb} · ${md(b)}`;
      $("[data-compare-pair]").textContent = `R${ra} → R${rb}`;
      const s = $("[data-compare-said]");
      s.textContent = said(b).length > 160 ? `${said(b).slice(0, 160)}…` : said(b);
      s.setAttribute("lang", /[一-鿿]/.test(said(b)) ? "zh-CN" : "en");
      if (lang === "en" && GLOSS[b]) {
        const g = document.createElement("span");
        g.className = "compare__gloss";
        g.textContent = GLOSS[b];
        g.setAttribute("lang", "en");
        s.appendChild(g);
      }
      $("[data-compare-note]").hidden = b !== KEY;
    };
    build();
    document.addEventListener("gp:lang", build);
  }

  /* ---------------- Sort: smart groups and auto-stacking ---------------- */
  // Two real conversations sit scattered in a small gallery, then each flies together into its own stack
  // card, the way the app stacks a session's images; the other cards close the gaps (FLIP).
  const sorter = $("[data-sorter]");
  if (sorter) {
    const stage = $("[data-sorter-stage]", sorter);
    const replay = $("[data-sorter-replay]", sorter);
    // Members in stack order; the app uses a stack's first member as its cover, and shows the name it gave the session.
    const SESSIONS = [
      { key: "surreal", title: "创建超现实海报", members: ["somewhere-else", "before-time", "quiet-music", "read-the-sky", "read-the-sky-b"] },
      { key: "signal", title: "生成艺术海报", members: ["signal-1", "signal-2", "signal-3", "signal-4"] },
    ];
    const sessionOf = (slug) => SESSIONS.find((x) => x.members.includes(slug));
    const FREED = SESSIONS.reduce((n, x) => n + x.members.length - 1, 0);
    const START = ["tea-market", "somewhere-else", "signal-1", "desert-wind", "before-time", "nexus", "signal-2", "quiet-music",
      "passage", "read-the-sky", "signal-3", "bangkok", "signal-4", "read-the-sky-b", "misty-lake"];
    let stacked = false;
    let running = false;

    const tile = (slug) => {
      const el = document.createElement("div");
      el.className = "sorter__tile";
      el.dataset.slug = slug;
      el.innerHTML = `<img src="${img(slug, 360)}" alt="" loading="lazy" decoding="async">`;
      return el;
    };
    const stackTile = (session) => {
      const el = tile(session.members[0]);
      el.classList.add("is-stack");
      el.dataset.slug = `stack-${session.key}`;
      el.insertAdjacentHTML("beforeend", `<b class="sorter__badge mono">${session.members.length}</b><span class="sorter__label" lang="zh-CN">${session.title}</span>`);
      return el;
    };
    const build = (asStack) => {
      stage.innerHTML = "";
      START.forEach((slug) => {
        const session = sessionOf(slug);
        if (!asStack || !session) stage.appendChild(tile(slug));
        else if (session.members[0] === slug) stage.appendChild(stackTile(session));
      });
      // The slots the stacks saved stay on the page as outlines, so the gallery keeps its height.
      if (asStack) {
        for (let k = 1; k <= FREED; k += 1) {
          const free = document.createElement("div");
          free.className = "sorter__tile is-free";
          free.dataset.slug = `free-${k}`;
          if (k === 1) free.innerHTML = `<span class="sorter__freed mono">${t("sort.freed", { n: FREED })}</span>`;
          stage.appendChild(free);
        }
      }
      stacked = asStack;
    };

    async function merge() {
      if (stacked || running) return;
      running = true;
      const box = stage.getBoundingClientRect();
      const before = new Map($$(".sorter__tile", stage).map((el) => [el.dataset.slug, el.getBoundingClientRect()]));
      const flying = $$(".sorter__tile", stage).filter((el) => sessionOf(el.dataset.slug));
      build(true);
      const targets = new Map(SESSIONS.map((x) => [x.key, $(`[data-slug="stack-${x.key}"]`, stage).getBoundingClientRect()]));
      const longest = Math.max(...SESSIONS.map((x) => x.members.length));
      // Each conversation's images lift out of the grid and travel to their stack, oldest first.
      flying.forEach((el) => {
        const session = sessionOf(el.dataset.slug);
        const k = session.members.indexOf(el.dataset.slug);
        const r = before.get(el.dataset.slug);
        const target = targets.get(session.key);
        Object.assign(el.style, { left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        el.classList.add("is-flying");
        stage.appendChild(el);
        const dx = target.left - r.left, dy = target.top - r.top;
        el.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${target.width / r.width})`, opacity: 1, offset: 0.9 }, { transform: `translate(${dx}px, ${dy}px) scale(${target.width / r.width})`, opacity: 0 }],
          { duration: 900, delay: 120 * k, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" }).finished.then(() => el.remove());
      });
      // Everyone else closes the gaps from where they were.
      $$(".sorter__tile:not(.is-flying)", stage).forEach((el) => {
        const now = el.getBoundingClientRect();
        if (el.classList.contains("is-free")) {
          el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: 1500, easing: "linear" });
          return;
        }
        if (el.classList.contains("is-stack")) {
          el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1 }], { duration: 900 + 120 * longest, easing: "linear" });
          return;
        }
        const was = before.get(el.dataset.slug);
        if (!was) return;
        el.animate([{ transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)` }, { transform: "translate(0,0)" }],
          { duration: 700, delay: 500, easing: "cubic-bezier(.45,0,.2,1)", fill: "backwards" });
      });
      await wait(900 + 120 * longest);
      running = false;
    }

    build(!prefersMotion());
    // Plain geometry instead of an IntersectionObserver: the stage is clip-path'd until it prints.
    if (prefersMotion()) {
      let armed = true;
      const check = () => {
        if (!armed) return;
        const r = sorter.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.55 && r.bottom > 0) {
          armed = false;
          window.removeEventListener("scroll", check);
          clearInterval(timer);
          setTimeout(merge, 600);
        }
      };
      const timer = setInterval(check, 300);
      window.addEventListener("scroll", check, { passive: true });
      check();
    }
    replay.addEventListener("click", async () => {
      if (running) return;
      build(false);
      if (!prefersMotion()) { build(true); return; }
      await wait(500);
      merge();
    });
    document.addEventListener("gp:lang", () => {
      const freed = $(".sorter__freed", stage);
      if (freed) freed.textContent = t("sort.freed", { n: FREED });
    });
  }

  /* ---------------- Downloads (release feed) ---------------- */
  const config = window.MOSA_SITE_CONFIG || {};
  const downloadsEnabled = config.downloadsEnabled !== false;
  const links = window.GP_DOWNLOAD_LINKS || null;
  // A campaign link (?ref=…) passes its tag on to the download, so the stats panel counts downloads per channel.
  const pageRef = links ? links.campaignRef(location.search) : "";
  let release = null;
  const fmtSize = (bytes) => {
    if (typeof bytes !== "number" || bytes <= 0) return "";
    return bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  };
  const setAll = (sel, text) => $$(sel).forEach((el) => { el.textContent = text; });

  function setDownload(kind, url) {
    $$(`[data-download="${kind}"]`).forEach((a) => {
      if (downloadsEnabled && url) {
        a.href = links ? links.withRef(fromSite(url), pageRef) : fromSite(url);
        a.removeAttribute("aria-disabled");
        a.classList.remove("is-pending");
      } else {
        a.href = "#download";
        a.setAttribute("aria-disabled", "true");
        a.classList.add("is-pending");
      }
    });
  }
  function refreshDownloads() {
    const macVersion = (release && release.mac && release.version) || (config.mac && config.mac.version) || "";
    const winVersion = (release && release.windows && release.version) || (config.windows && config.windows.version) || "";
    const extVersion = (config.extension && config.extension.version) || "";
    const v = (s) => (s ? `v${String(s).replace(/^v/i, "")}` : t("download.pending"));
    setAll("[data-mac-version]", v(macVersion));
    setAll("[data-windows-version]", v(winVersion));
    setAll("[data-extension-version]", v(extVersion));
    const winFile = feedFile("windows");
    const sized = (n) => (n ? ` · ${fmtSize(n)}` : "");
    setAll("[data-windows-size]", sized(knownSize("windows", winFile && winFile.size)));
    const macFile = feedFile("mac");
    setAll("[data-mac-size]", sized(knownSize("mac", macFile && macFile.size)));
    setAll("[data-extension-size]", sized(knownSize("extension", 0)));
    // The Windows button links the installer once a release ships one, and the portable ZIP before that.
    const winDetail = /\.exe$/i.test(linkedFile("windows")) ? "download.win.detailInstaller" : "download.win.detail";
    $$("[data-windows-detail]").forEach((el) => {
      el.setAttribute("data-i18n", winDetail);
      el.textContent = t(winDetail);
    });
    const sha = $("[data-windows-sha]");
    if (sha) {
      const ok = Boolean(winFile && winFile.sha256);
      sha.hidden = !ok;
      if (ok) $("[data-windows-sha-value]").textContent = winFile.sha256;
    }
  }
  // The file a download button links now, by name.
  function linkedFile(kind) {
    const a = $(`[data-download="${kind}"]`);
    if (!a || a.classList.contains("is-pending")) return "";
    try {
      return decodeURIComponent(new URL(a.href, document.baseURI).pathname.split("/").pop());
    } catch (e) {
      return "";
    }
  }
  // The feed's size and SHA-256 describe one file, so they are shown only while the button links
  // that file: the checked-in config can point it elsewhere (the Mac button links the DMG, while the
  // feed lists the update ZIP).
  const feedFile = (kind) => {
    const item = release && release[kind];
    return item && item.file === linkedFile(kind) ? item : null;
  };
  const configured = (kind, item) => {
    const c = config[kind];
    const cv = c && typeof c.version === "string" ? c.version.replace(/^v/i, "") : "";
    return release && cv && cv === release.version && c.url ? c.url : item.url;
  };
  // When the feed carries no size for a file, ask the first-party server for it (same origin only).
  const sizeFromServer = {};
  async function headSize(kind) {
    const a = $(`[data-download="${kind}"]`);
    if (!a || !a.href || a.classList.contains("is-pending")) return;
    let url;
    try { url = new URL(a.href, document.baseURI); } catch (e) { return; }
    if (url.origin !== location.origin || sizeFromServer[url.href] !== undefined) return;
    sizeFromServer[url.href] = null;
    try {
      const res = await fetch(url.href, { method: "HEAD", cache: "no-store" });
      const len = Number(res.headers.get("content-length"));
      if (res.ok && len > 0) { sizeFromServer[url.href] = len; refreshDownloads(); }
    } catch (e) { /* size stays unprinted */ }
  }
  const knownSize = (kind, rawSize) => {
    if (typeof rawSize === "number" && rawSize > 0) return rawSize;
    const a = $(`[data-download="${kind}"]`);
    return a ? sizeFromServer[new URL(a.href, document.baseURI).href] || 0 : 0;
  };
  ["mac", "windows", "extension"].forEach((kind) => setDownload(kind, config[kind] && config[kind].url));
  refreshDownloads();
  ["mac", "windows", "extension"].forEach(headSize);
  (async () => {
    const feedUrl = config.desktop && typeof config.desktop.feedUrl === "string" ? config.desktop.feedUrl.trim() : "";
    const lib = window.MOSADesktopReleaseFeed;
    if (!downloadsEnabled || !feedUrl || !lib || typeof window.fetch !== "function") return;
    try {
      const res = await fetch(fromSite(feedUrl), { cache: "no-store", credentials: "omit" });
      if (!res.ok) return;
      const data = await res.json();
      const normalized = lib.normalizeDesktopRelease(data);
      if (!normalized || !normalized.version) return;
      release = normalized;
      if (release.mac) setDownload("mac", configured("mac", release.mac));
      if (release.windows) setDownload("windows", configured("windows", release.windows));
      refreshDownloads();
      ["mac", "windows", "extension"].forEach(headSize);
    } catch (e) {
      /* The checked-in config stays as the fallback. */
    }
  })();
  document.addEventListener("gp:lang", refreshDownloads);
  $$("[data-download]").forEach((a) => a.addEventListener("click", (e) => {
    if (a.classList.contains("is-pending")) { e.preventDefault(); }
  }));
  $$("[data-copy-sha]").forEach((btn) => btn.addEventListener("click", async () => {
    const value = $("[data-windows-sha-value]").textContent;
    try { await navigator.clipboard.writeText(value); btn.textContent = t("download.copied"); setTimeout(() => { btn.textContent = t("download.copy"); }, 1600); } catch (e) { /* clipboard denied */ }
  }));

  /* ---------------- Phones: hand the download over to a computer ---------------- */
  // The desktop app cannot be installed on a phone or tablet, so there a download button
  // opens a dialog with this page's address to copy and open on a computer instead.
  const handoff = $("[data-handoff-dialog]");
  const handheld = Boolean(links) && links.isHandheld(navigator.userAgent, navigator.maxTouchPoints, navigator.userAgentData && navigator.userAgentData.mobile);
  if (handoff && handheld && typeof handoff.showModal === "function") {
    const address = links.handoffUrl(location.href, pageRef);
    const urlBox = $("[data-handoff-url]", handoff);
    const status = $("[data-handoff-status]", handoff);
    const anyway = $("[data-handoff-anyway]", handoff);
    urlBox.textContent = address;
    const copyText = async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* older in-app browsers have no clipboard API: try the selection below */ }
      const field = document.createElement("textarea");
      field.className = "handoff__field";
      field.value = text;
      field.setAttribute("readonly", "");
      handoff.append(field);
      field.select();
      field.setSelectionRange(0, text.length);
      let copied = false;
      try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
      field.remove();
      return copied;
    };
    $$("[data-download]").forEach((a) => a.addEventListener("click", (e) => {
      if (a.classList.contains("is-pending")) return;
      e.preventDefault();
      anyway.href = a.href;
      status.textContent = "";
      handoff.showModal();
    }));
    $("[data-handoff-copy]", handoff).addEventListener("click", async () => {
      if (await copyText(address)) {
        status.textContent = t("handoff.copied");
        return;
      }
      // Leave the address selected so a long press copies it.
      status.textContent = t("handoff.copyFailed");
      const range = document.createRange();
      range.selectNodeContents(urlBox);
      const selection = window.getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
    });
    anyway.addEventListener("click", () => handoff.close());
    handoff.addEventListener("click", (e) => { if (e.target === handoff) handoff.close(); });
  }

  /* ---------------- Community dialog, year ---------------- */
  const dialog = $("[data-community-dialog]");
  $$("[data-community-open]").forEach((btn) => btn.addEventListener("click", () => {
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }));
  if (dialog) dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  $$("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });

  /* ---------------- Boot ---------------- */
  applyLang(lang);
  pressRun();
  document.addEventListener("gp:lang", () => { requestAnimationFrame(placeHeroMarks); setTimeout(placeHeroMarks, 80); });
})();
