(function () {
  const config = window.MOSA_SITE_CONFIG || {};
  const header = document.querySelector("[data-header]");
  const toast = document.querySelector("[data-toast]");
  let toastTimer = null;

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node && value) node.textContent = value;
  };

  setText("[data-mac-version]", config.mac?.version ? `版本 ${config.mac.version}` : "即将上线");
  setText("[data-extension-version]", config.extension?.version || "v0.11");
  setText("[data-mac-label]", config.mac?.label || "即将上线");
  setText("[data-extension-label]", config.extension?.label || "浏览器包下载");
  setText("[data-year]", String(new Date().getFullYear()));

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
  };

  document.querySelectorAll("[data-download]").forEach((button) => {
    const kind = button.dataset.download;
    const item = config[kind] || {};
    const url = typeof item.url === "string" ? item.url.trim() : "";

    if (url) {
      button.href = url;
      button.setAttribute("download", "");
      return;
    }

    button.classList.add("is-pending");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      if (kind === "mac") {
        showToast("MOSA App 即将上线，敬请期待。");
        return;
      }
      showToast("浏览器扩展包尚未配置下载地址。");
    });
  });

  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

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
