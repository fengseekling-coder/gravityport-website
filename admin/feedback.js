(function () {
  const $ = (id) => document.getElementById(id);
  const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  const list = $("feedbackList");
  const loadMoreButton = $("loadMoreButton");
  const refreshButton = $("refreshButton");
  const errorNotice = $("errorNotice");
  let nextBefore = null;
  let firstPage = true;

  const KIND_LABELS = { bug: "缺陷", idea: "建议", other: "其他" };
  const PLATFORM_LABELS = { macos: "macOS", windows: "Windows", other: "其他" };
  const PRODUCT_LABELS = { GravityPort: "GravityPort", MOSA: "MOSA" };

  function requireLogin() {
    window.location.replace("./login.html?expired=1");
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) {
      requireLogin();
      return null;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function describeApp(app) {
    if (!app || typeof app !== "object") return "未知版本";
    const parts = [
      PRODUCT_LABELS[app.product] || app.product || "未知产品",
      app.version ? `v${String(app.version).replace(/^v/, "")}` : "",
      PLATFORM_LABELS[app.platform] || app.platform || "",
      app.osVersion ? String(app.osVersion) : "",
      app.arch ? String(app.arch) : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function describeLocale(locale) {
    return locale === "en" ? "英文界面" : locale === "zh" ? "中文界面" : String(locale || "");
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "时间未知") : dateTime.format(date);
  }

  function makeBadge(kind) {
    const badge = document.createElement("span");
    badge.className = `kind-badge kind-${kind === "bug" || kind === "idea" ? kind : "other"}`;
    badge.textContent = KIND_LABELS[kind] || "其他";
    return badge;
  }

  function makeDiagnosticsArea(card, id) {
    const toggle = document.createElement("button");
    toggle.className = "diagnostics-toggle";
    toggle.type = "button";
    toggle.textContent = "查看诊断日志";
    const pre = document.createElement("pre");
    pre.className = "diagnostics-view";
    pre.hidden = true;
    let loaded = false;
    let loading = false;
    toggle.addEventListener("click", async () => {
      if (loading) return;
      if (!pre.hidden) {
        pre.hidden = true;
        toggle.textContent = "查看诊断日志";
        return;
      }
      pre.hidden = false;
      toggle.textContent = "收起诊断日志";
      if (loaded || loading) return;
      loading = true;
      pre.textContent = "正在加载…";
      try {
        const item = await fetchJson(`./feedback-item.json?id=${encodeURIComponent(id)}`);
        if (!item) return;
        pre.textContent = typeof item.diagnostics === "string" && item.diagnostics ? item.diagnostics : "（这条反馈没有诊断日志正文）";
        loaded = true;
      } catch (error) {
        pre.textContent = `读取失败：${error?.message || error}`;
      } finally {
        loading = false;
      }
    });
    card.append(toggle, pre);
  }

  function renderCard(item) {
    const card = document.createElement("article");
    card.className = "feedback-card";

    const head = document.createElement("div");
    head.className = "feedback-head";
    const time = document.createElement("time");
    time.className = "feedback-time";
    time.dateTime = item.receivedAt || "";
    time.textContent = formatTime(item.receivedAt);
    head.append(makeBadge(item.kind), time);
    card.append(head);

    const message = document.createElement("p");
    message.className = "feedback-message";
    message.textContent = typeof item.message === "string" ? item.message : "";
    card.append(message);

    const meta = document.createElement("div");
    meta.className = "feedback-meta";
    const appLine = document.createElement("span");
    appLine.textContent = describeApp(item.app);
    meta.append(appLine);
    const localeLine = document.createElement("span");
    localeLine.textContent = describeLocale(item.locale);
    meta.append(localeLine);
    const idLine = document.createElement("span");
    idLine.className = "feedback-id";
    idLine.textContent = String(item.id || "");
    meta.append(idLine);
    card.append(meta);

    if (item.contact) {
      const contact = document.createElement("div");
      contact.className = "feedback-contact";
      const label = document.createElement("span");
      label.className = "feedback-contact-label";
      label.textContent = "联系方式";
      const value = document.createElement("span");
      value.textContent = String(item.contact);
      contact.append(label, value);
      card.append(contact);
    }

    if (item.hasDiagnostics) {
      const hint = document.createElement("span");
      hint.className = "diagnostics-hint";
      hint.textContent = `附诊断日志（约 ${Number(item.diagnosticsLength) || 0} 字）`;
      card.append(hint);
      makeDiagnosticsArea(card, String(item.id || ""));
    }

    return card;
  }

  function renderPage(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    if (firstPage) list.replaceChildren();
    if (!items.length && firstPage) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有收到反馈。";
      list.append(empty);
    }
    items.forEach((item) => list.append(renderCard(item)));
    nextBefore = typeof data.nextBefore === "string" ? data.nextBefore : null;
    loadMoreButton.hidden = !nextBefore;
    firstPage = false;
  }

  async function loadPage() {
    refreshButton.disabled = true;
    loadMoreButton.disabled = true;
    errorNotice.hidden = true;
    try {
      const query = nextBefore ? `?before=${encodeURIComponent(nextBefore)}&limit=50` : "?limit=50";
      const data = await fetchJson(`./feedback.json${query}`);
      if (!data) return;
      renderPage(data);
    } catch (error) {
      errorNotice.textContent = `暂时读取不到反馈列表：${error?.message || error}`;
      errorNotice.hidden = false;
    } finally {
      refreshButton.disabled = false;
      loadMoreButton.disabled = false;
    }
  }

  function resetAndLoad() {
    nextBefore = null;
    firstPage = true;
    list.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "empty";
    loading.textContent = "正在加载…";
    list.append(loading);
    void loadPage();
  }

  refreshButton.addEventListener("click", resetAndLoad);
  loadMoreButton.addEventListener("click", loadPage);
  void loadPage();
})();
