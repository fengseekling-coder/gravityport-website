(function () {
  document.documentElement.classList.add("motion-ready");
  const config = window.MOSA_SITE_CONFIG || {};
  const downloadsEnabled = config.downloadsEnabled !== false;
  const pendingLabel = "即将上线";
  const header = document.querySelector("[data-header]");
  const toast = document.querySelector("[data-toast]");
  let toastTimer = null;

  const setText = (selector, value) => {
    if (!value) return;
    document.querySelectorAll(selector).forEach((node) => {
      node.textContent = value;
    });
  };

  setText("[data-mac-version]", downloadsEnabled && config.mac?.version ? `版本 ${config.mac.version}` : pendingLabel);
  setText("[data-windows-version]", downloadsEnabled && config.windows?.version ? `版本 ${config.windows.version}` : pendingLabel);
  setText("[data-extension-version]", downloadsEnabled ? config.extension?.version || "v0.11" : pendingLabel);
  setText("[data-mac-label]", downloadsEnabled ? config.mac?.label || pendingLabel : pendingLabel);
  setText("[data-windows-label]", downloadsEnabled ? config.windows?.label || pendingLabel : pendingLabel);
  setText("[data-extension-label]", downloadsEnabled ? config.extension?.label || "浏览器包下载" : pendingLabel);
  setText("[data-extension-guide-label]", downloadsEnabled ? "下载 MOSA Web Capture ZIP" : pendingLabel);
  setText("[data-year]", String(new Date().getFullYear()));

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  };

  const pendingMessages = {
    mac: "MOSA macOS 下载即将上线，暂时不提供下载。",
    windows: "MOSA Windows 下载即将上线，暂时不提供下载。",
    extension: "浏览器扩展下载即将上线，暂时不提供下载。",
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
        event.preventDefault();
        showToast(pendingMessages[kind] || "下载地址尚未配置。");
      });
    });
  };

  ["mac", "windows", "extension"].forEach((kind) => configureDownload(kind, config[kind]));

  const normalizeDesktopRelease = (release) => {
    if (!release || typeof release !== "object" || Array.isArray(release)) return null;
    const version = typeof release.version === "string" ? release.version.trim().replace(/^v/i, "") : "";
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;

    const makeArtifact = (platform, label) => {
      const artifact = release.artifacts?.[platform];
      const expectedPrefix = platform === "mac" ? "MOSA-darwin-arm64-" : "MOSA-win32-x64-";
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return null;
      const file = typeof artifact.file === "string" ? artifact.file.trim() : "";
      if (file !== `${expectedPrefix}${version}.zip`) return null;
      return {
        version: `v${version}`,
        url: `./downloads/${encodeURIComponent(file)}`,
        label,
      };
    };

    const mac = makeArtifact("mac", "下载 macOS 包");
    const windows = makeArtifact("windows", "下载 Windows 包");
    return mac && windows ? { mac, windows } : null;
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
      setText("[data-mac-version]", `版本 ${release.mac.version}`);
      setText("[data-windows-version]", `版本 ${release.windows.version}`);
      setText("[data-mac-label]", release.mac.label);
      setText("[data-windows-label]", release.windows.label);
      configureDownload("mac", release.mac);
      configureDownload("windows", release.windows);
    } catch {
      // The checked-in config remains a safe fallback if the feed is unavailable.
    }
  };
  void loadDesktopRelease();

  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

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
    const scale = Math.max(width / communityQrImage.naturalWidth, height / communityQrImage.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
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
      showToast("当前浏览器不支持直接复制图片，请使用最新版浏览器。");
      return;
    }

    communityCopyButton.disabled = true;
    if (communityCopyLabel) communityCopyLabel.textContent = "正在复制…";
    try {
      const imageBlob = createCommunityQrBlob();
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": imageBlob })]);
      showToast("二维码图片已复制，可直接粘贴到微信。");
    } catch {
      showToast("复制失败，请允许浏览器访问剪贴板后重试。");
    } finally {
      communityCopyButton.disabled = false;
      if (communityCopyLabel) communityCopyLabel.textContent = "复制二维码图片";
    }
  });

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
