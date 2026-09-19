(function () {
  document.documentElement.classList.add("motion-ready");
  const config = window.MOSA_SITE_CONFIG || {};
  const downloadsEnabled = config.downloadsEnabled !== false;
  const i18n = window.MOSA_I18N;
  const t = (key, fallback) => i18n?.t(key) || fallback || key;

  const header = document.querySelector("[data-header]");
  const toast = document.querySelector("[data-toast]");
  let toastTimer = null;
  let desktopRelease = null;

  const setText = (selector, value) => {
    if (!value) return;
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = value;
    });
  };

  const pendingLabel = () => t(downloadsEnabled ? "home.download.fetching" : "home.download.pending");

  const downloadLabel = (kind) => {
    const keys = {
      mac: "home.download.macLabel",
      windows: "home.download.windowsLabel",
      extension: "home.download.extensionLabel",
    };
    return t(keys[kind], t("home.download.missingUrl"));
  };

  const refreshDownloadCopy = () => {
    const macVersion = (desktopRelease?.mac && desktopRelease.version) || config.mac?.version;
    const windowsVersion = (desktopRelease?.windows && desktopRelease.version) || config.windows?.version;
    setText("[data-mac-version]", downloadsEnabled && macVersion ? `${t("home.download.version")} ${macVersion}` : pendingLabel());
    setText("[data-windows-version]", downloadsEnabled && windowsVersion ? `${t("home.download.version")} ${windowsVersion}` : pendingLabel());
    setText("[data-extension-version]", downloadsEnabled ? config.extension?.version || "v0.11" : pendingLabel());
    setText("[data-mac-label]", downloadsEnabled ? downloadLabel("mac") : pendingLabel());
    const windowsFromFeed = Boolean(desktopRelease?.windows);
    setText("[data-windows-label]", downloadsEnabled
      ? (windowsFromFeed ? downloadLabel("windows") : t("home.download.windowsPreviewLabel", downloadLabel("windows")))
      : pendingLabel());
    setText("[data-extension-label]", downloadsEnabled ? downloadLabel("extension") : pendingLabel());
    setText("[data-extension-guide-label]", downloadsEnabled ? t("home.download.guideLabel") : pendingLabel());
  };

  refreshDownloadCopy();
  setText("[data-year]", String(new Date().getFullYear()));

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  };

  const pendingMessage = (kind) => {
    const suffix = downloadsEnabled ? "Error" : "PendingMessage";
    const fallback = {
      mac: "The macOS download is not available right now.",
      windows: "The Windows download is not available right now.",
      extension: "The browser extension download is not available right now.",
    };
    return t(`home.download.${kind}${suffix}`, fallback[kind]);
  };

  const campaignRef = (() => {
    const value = new URLSearchParams(window.location.search).get("ref")?.trim() || "";
    return /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : "";
  })();

  const downloadUrl = (rawUrl) => {
    if (!campaignRef) return rawUrl;
    try {
      const url = new URL(rawUrl, window.location.href);
      url.searchParams.set("ref", campaignRef);
      return url.href;
    } catch {
      return rawUrl;
    }
  };

  const configureDownload = (kind, item) => {
    const url = downloadsEnabled && typeof item?.url === "string" ? item.url.trim() : "";
    const buttons = document.querySelectorAll(`[data-download="${kind}"]`);
    buttons.forEach((button) => {
      button.classList.toggle("is-pending", !url);
      button.removeAttribute("download");
      button.toggleAttribute("aria-disabled", !url);
      if (url) {
        button.href = downloadUrl(url);
        button.setAttribute("download", "");
        return;
      }
      button.href = "#";
      if (button.dataset.pendingHandler === "true") return;
      button.dataset.pendingHandler = "true";
      button.addEventListener("click", (event) => {
        if (!button.hasAttribute("aria-disabled")) return;
        event.preventDefault();
        showToast(pendingMessage(kind) || t("home.download.missingUrl"));
      });
    });
  };

  ["mac", "windows", "extension"].forEach((kind) => configureDownload(kind, config[kind]));

  const normalizeDesktopRelease = (release) => {
    const feed = window.MOSADesktopReleaseFeed;
    if (!feed || typeof feed.normalizeDesktopRelease !== "function") return null;
    const normalized = feed.normalizeDesktopRelease(release);
    if (!normalized.version) return null;
    const toDisplay = (artifact) => (artifact ? { version: normalized.version, url: artifact.url } : null);
    return {
      version: `v${normalized.version}`,
      mac: toDisplay(normalized.mac),
      windows: toDisplay(normalized.windows),
    };
  };

  const loadDesktopRelease = async () => {
    if (!downloadsEnabled) return;
    const feedUrl = typeof config.desktop?.feedUrl === "string" ? config.desktop.feedUrl.trim() : "";
    if (!feedUrl || typeof window.fetch !== "function") return;
    try {
      const response = await window.fetch(feedUrl, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const release = normalizeDesktopRelease(await response.json());
      if (!release) return;
      desktopRelease = release;
      refreshDownloadCopy();
      if (release.mac) configureDownload("mac", release.mac);
      if (release.windows) configureDownload("windows", release.windows);
    } catch {
      // The checked-in config remains a safe fallback if the feed is unavailable.
    }
  };
  void loadDesktopRelease();
  document.addEventListener("mosa:locale-change", refreshDownloadCopy);

  const kineticHero = document.querySelector("[data-kinetic-hero]");
  const heroDemoFrame = document.querySelector("[data-hero-demo-frame]");
  const DEMO_BUILD = "v4-22";
  const resetEmbeddedRootScroll = (frame) => {
    if (!frame) return;
    try {
      frame.contentWindow?.scrollTo(0, 0);
      const doc = frame.contentDocument;
      if (doc?.documentElement) doc.documentElement.scrollTop = 0;
      if (doc?.body) doc.body.scrollTop = 0;
    } catch {
      // The website demo is same-origin in production/local preview. If that
      // ever changes, the embedded demo still has its own scroll reset.
    }
  };
  const pinEmbeddedRootOnLoad = (frame) => {
    if (!frame) return;
    frame.addEventListener("load", () => {
      resetEmbeddedRootScroll(frame);
      window.requestAnimationFrame(() => resetEmbeddedRootScroll(frame));
      window.setTimeout(() => resetEmbeddedRootScroll(frame), 80);
      window.setTimeout(() => resetEmbeddedRootScroll(frame), 320);
      frame.contentWindow?.postMessage({
        type: "mosa-demo:set-locale",
        locale: window.MOSA_I18N?.locale === "en" ? "en" : "zh",
      }, window.location.origin);
    });
  };
  pinEmbeddedRootOnLoad(heroDemoFrame);
  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
    const heroBoundary = kineticHero ? kineticHero.offsetTop + kineticHero.offsetHeight - 96 : 720;
    header.classList.toggle("is-after-hero", window.scrollY >= heroBoundary);
  };
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  const siteDemoFrame = document.querySelector("[data-site-demo-frame]");
  const siteDemoButtons = [...document.querySelectorAll("[data-site-demo]")];
  const postDemoLocale = (frame, locale = window.MOSA_I18N?.locale) => {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({
      type: "mosa-demo:set-locale",
      locale: locale === "en" ? "en" : "zh",
    }, window.location.origin);
  };
  const syncHeroDemoLocale = () => {
    if (!heroDemoFrame) return;
    const url = new URL("./demo/index.html", window.location.href);
    url.searchParams.set("embed", "1");
    url.searchParams.set("preview", "1");
    url.searchParams.set("scenario", "context");
    url.searchParams.set("lang", window.MOSA_I18N?.locale === "en" ? "en" : "zh");
    url.searchParams.set("build", DEMO_BUILD);
    const next = url.href;
    if (heroDemoFrame.src !== next) heroDemoFrame.src = next;
  };
  syncHeroDemoLocale();
  const setSiteDemoScenario = (scenario) => {
    if (!siteDemoFrame || !scenario) return;
    siteDemoButtons.forEach((button) => {
      const active = button.dataset.siteDemo === scenario;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const url = new URL("./demo/index.html", window.location.href);
    url.searchParams.set("embed", "1");
    url.searchParams.set("scenario", scenario);
    url.searchParams.set("lang", window.MOSA_I18N?.locale === "en" ? "en" : "zh");
    url.searchParams.set("build", DEMO_BUILD);
    siteDemoFrame.src = url.href;
  };
  pinEmbeddedRootOnLoad(siteDemoFrame);
  siteDemoButtons.forEach((button) => {
    button.addEventListener("click", () => setSiteDemoScenario(button.dataset.siteDemo));
  });
  document.addEventListener("mosa:locale-change", (event) => {
    // Locale changes are intentionally in-place. Reloading either iframe here
    // destroys the demo's internal scroll position, selection and viewer state.
    const locale = event.detail?.locale === "en" ? "en" : "zh";
    postDemoLocale(heroDemoFrame, locale);
    postDemoLocale(siteDemoFrame, locale);
  });

  const communityDialog = document.querySelector("[data-community-dialog]");
  const communityOpeners = document.querySelectorAll("[data-community-open]");
  const communityCloser = document.querySelector("[data-community-close]");
  const communityCopyButton = document.querySelector("[data-community-copy]");
  const communityCopyLabel = document.querySelector("[data-community-copy-label]");
  const communityQrImage = document.querySelector(".community-qr img");
  let communityTrigger = null;

  const ensureCommunityQr = () => {
    if (!communityQrImage) return;
    const source = communityQrImage.dataset.src?.trim();
    if (!source) return;
    if (!communityQrImage.hasAttribute("src")) {
      communityQrImage.src = source;
    }
    const updateCopyState = () => {
      if (communityCopyButton && communityQrImage.complete && communityQrImage.naturalWidth) {
        communityCopyButton.disabled = false;
      }
    };
    updateCopyState();
    communityQrImage.addEventListener("load", updateCopyState, { once: true });
  };

  const openCommunityDialog = (trigger) => {
    if (!communityDialog || communityDialog.open) return;
    ensureCommunityQr();
    communityTrigger = trigger;
    document.body.classList.add("community-dialog-open");
    communityDialog.showModal();
    communityCloser?.focus();
  };

  communityOpeners.forEach((opener) => {
    opener.addEventListener("click", () => openCommunityDialog(opener));
  });

  communityCloser?.addEventListener("click", () => communityDialog?.close());

  communityDialog?.addEventListener("click", (event) => {
    if (event.target === communityDialog) communityDialog.close();
  });

  communityDialog?.addEventListener("close", () => {
    document.body.classList.remove("community-dialog-open");
    communityTrigger?.focus();
    communityTrigger = null;
  });

  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

  const percentage = (value, fallback) => {
    if (!value?.endsWith("%")) return fallback;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? clamp(parsed / 100, 0, 1) : fallback;
  };

  const createCommunityQrBlob = () => {
    if (!communityQrImage?.complete || !communityQrImage.naturalWidth || !communityQrImage.naturalHeight) {
      throw new Error("QR image is unavailable");
    }

    const style = window.getComputedStyle(communityQrImage);
    const box = communityQrImage.getBoundingClientRect();
    const horizontalBorders = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
    const verticalBorders = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const width = box.width - horizontalBorders;
    const height = box.height - verticalBorders;
    const fit = style.objectFit === "contain" ? "contain" : "cover";
    const scale = (fit === "contain" ? Math.min : Math.max)(
      width / communityQrImage.naturalWidth,
      height / communityQrImage.naturalHeight,
    );
    const sourceWidth = Math.min(communityQrImage.naturalWidth, width / scale);
    const sourceHeight = Math.min(communityQrImage.naturalHeight, height / scale);
    const [horizontalPosition, verticalPosition] = style.objectPosition.split(/\s+/);
    const sourceX = clamp(
      (communityQrImage.naturalWidth - sourceWidth) * percentage(horizontalPosition, 0.5),
      0,
      communityQrImage.naturalWidth - sourceWidth,
    );
    const sourceY = clamp(
      (communityQrImage.naturalHeight - sourceHeight) * percentage(verticalPosition, 0.5),
      0,
      communityQrImage.naturalHeight - sourceHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sourceWidth);
    canvas.height = Math.round(sourceHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(communityQrImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("QR image export failed"))), "image/png");
    });
  };

  communityCopyButton?.addEventListener("click", async () => {
    if (!window.ClipboardItem || !navigator.clipboard?.write) {
      showToast(t("home.community.copyUnsupported"));
      return;
    }

    communityCopyButton.disabled = true;
    if (communityCopyLabel) communityCopyLabel.textContent = t("home.community.copying");
    try {
      const imageBlob = createCommunityQrBlob();
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": imageBlob })]);
      showToast(t("home.community.copySuccess"));
    } catch {
      showToast(t("home.community.copyFailure"));
    } finally {
      communityCopyButton.disabled = false;
      if (communityCopyLabel) communityCopyLabel.textContent = t("home.community.copy");
    }
  });

  const sourceMarquee = document.querySelector("[data-source-marquee]");
  if (sourceMarquee && sourceMarquee.dataset.marqueeReady !== "true") {
    [...sourceMarquee.children].forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      sourceMarquee.appendChild(clone);
    });
    sourceMarquee.dataset.marqueeReady = "true";
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!reducedMotion && kineticHero) {
    const heroPanel = kineticHero.querySelector(".hero-live-viewport");
    const memoryCanvas = document.querySelector(".memory-canvas");
    const capabilityVisuals = [...document.querySelectorAll(".capability-visual")];
    let pointerX = 0;
    let pointerY = 0;
    let framePending = false;

    const updateKineticScene = () => {
      framePending = false;
      const heroRect = kineticHero.getBoundingClientRect();
      const heroTravel = Math.max(1, kineticHero.offsetHeight - window.innerHeight);
      const heroProgress = clamp(-heroRect.top / heroTravel, 0, 1);
      const titleShift = Math.round(heroProgress * -72);
      const copyShift = Math.round(heroProgress * -38);
      // Keep the live product frame vertically stable while the page scrolls.
      // Moving the scaled iframe on the Y axis causes Chrome to clip the first
      // app row at intermediate scroll positions, which makes the MOSA topbar
      // look as if it has been scrolled out of the frame.
      const panelShift = 0;

      kineticHero.style.setProperty("--hero-title-y", `${titleShift}px`);
      kineticHero.style.setProperty("--hero-copy-y", `${copyShift}px`);
      kineticHero.style.setProperty("--hero-panel-y", `${panelShift}px`);
      kineticHero.style.setProperty("--hero-panel-x", `${pointerX * 8}px`);
      kineticHero.style.setProperty("--hero-panel-rx", `${1.7 + pointerY * -1.35}deg`);
      kineticHero.style.setProperty("--hero-panel-ry", `${-1.2 + pointerX * 1.55}deg`);
      kineticHero.style.setProperty("--hero-orb-x", `${pointerX * 34}px`);
      kineticHero.style.setProperty("--hero-orb-y", `${pointerY * 26}px`);

      if (memoryCanvas) {
        const rect = memoryCanvas.closest(".product-memory")?.getBoundingClientRect();
        if (rect) {
          const progress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height), 0, 1);
          memoryCanvas.style.setProperty("--memory-parallax", `${Math.round((progress - .5) * 56)}px`);
        }
      }

      capabilityVisuals.forEach((visual) => {
        const rect = visual.getBoundingClientRect();
        const centerDelta = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
        visual.style.setProperty("--capability-y", `${Math.round(clamp(centerDelta, -1, 1) * -22)}px`);
      });
    };

    const queueKineticScene = () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateKineticScene);
    };

    kineticHero.addEventListener("pointermove", (event) => {
      const rect = kineticHero.getBoundingClientRect();
      pointerX = clamp((event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -1, 1);
      pointerY = clamp((event.clientY - rect.top) / Math.max(1, rect.height) * 2 - 1, -1, 1);
      kineticHero.style.setProperty("--hero-mx", `${Math.round((pointerX + 1) * 50)}%`);
      kineticHero.style.setProperty("--hero-my", `${Math.round((pointerY + 1) * 28)}%`);
      queueKineticScene();
    }, { passive: true });
    kineticHero.addEventListener("pointerleave", () => {
      pointerX = 0;
      pointerY = 0;
      queueKineticScene();
    }, { passive: true });
    window.addEventListener("scroll", queueKineticScene, { passive: true });
    window.addEventListener("resize", queueKineticScene, { passive: true });
    heroPanel?.addEventListener("load", queueKineticScene, { once: true });
    queueKineticScene();
  }

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12 },
    );
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
