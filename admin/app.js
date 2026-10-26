(function () {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-CN");
  const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  const refreshButton = $("refreshButton");
  const errorNotice = $("errorNotice");
  const campaignRefInput = $("campaignRefInput");
  const campaignUrlOutput = $("campaignUrlOutput");
  const copyCampaignUrl = $("copyCampaignUrl");
  const campaignCopyStatus = $("campaignCopyStatus");
  let refreshTimer = null;

  function normalizeCampaignRef(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 64);
  }

  function updateCampaignUrl() {
    const ref = normalizeCampaignRef(campaignRefInput.value);
    if (campaignRefInput.value !== ref) campaignRefInput.value = ref;
    const url = new URL("https://gravityport.azhuilab.com/");
    if (ref) url.searchParams.set("ref", ref);
    campaignUrlOutput.value = url.href;
    campaignCopyStatus.textContent = ref ? `将统计为：${ref}` : "未填写渠道时为普通官网链接。";
  }

  async function copyCampaignLink() {
    const value = campaignUrlOutput.value;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      campaignUrlOutput.focus();
      campaignUrlOutput.select();
      document.execCommand("copy");
    }
    copyCampaignUrl.textContent = "已复制";
    campaignCopyStatus.textContent = "链接已复制到剪贴板。";
    window.setTimeout(() => { copyCampaignUrl.textContent = "复制"; }, 1400);
  }

  function setMetric(id, value) {
    $(id).textContent = Number.isFinite(Number(value)) ? number.format(Number(value)) : "—";
  }

  function setRate(id, value) {
    const rate = Number(value);
    $(id).textContent = Number.isFinite(rate) ? `${number.format(Math.round(rate * 1000) / 10)}%` : "—";
  }

  function entries(value) {
    return Object.entries(value && typeof value === "object" ? value : {}).filter(([, count]) => Number(count) > 0);
  }

  function renderRankList(id, source, labelMap = {}) {
    const host = $(id);
    host.replaceChildren();
    const rows = entries(source);
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无数据";
      host.append(empty);
      return;
    }
    const max = Math.max(...rows.map(([, value]) => Number(value)));
    rows.slice(0, 12).forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "rank-row";
      const name = document.createElement("span");
      name.className = "rank-label";
      name.title = label;
      name.textContent = labelMap[label] || label;
      const count = document.createElement("strong");
      count.className = "rank-value";
      count.textContent = number.format(Number(value));
      const track = document.createElement("div");
      track.className = "rank-track";
      const fill = document.createElement("span");
      fill.className = "rank-fill";
      fill.style.width = `${Math.max(2, Number(value) / max * 100)}%`;
      track.append(fill);
      row.append(name, count, track);
      host.append(row);
    });
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function renderTrend(daily) {
    const host = $("trendChart");
    host.replaceChildren();
    const rows = Array.isArray(daily) ? daily : [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无趋势数据";
      host.append(empty);
      return;
    }
    const width = 1000;
    const height = 250;
    const left = 34;
    const right = 12;
    const top = 12;
    const bottom = 28;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const values = rows.flatMap((row) => [row.firstLaunches || 0, row.activeInstalls || 0, row.downloadRequests || 0, row.pageViews || 0]);
    const max = Math.max(1, ...values);
    const x = (index) => left + (rows.length === 1 ? plotWidth / 2 : index / (rows.length - 1) * plotWidth);
    const y = (value) => top + plotHeight - Number(value || 0) / max * plotHeight;
    const svg = svgElement("svg", { class: "trend-svg", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    for (let step = 0; step <= 4; step += 1) {
      const gy = top + step / 4 * plotHeight;
      svg.append(svgElement("line", { class: "chart-grid", x1: left, x2: width - right, y1: gy, y2: gy }));
      const label = svgElement("text", { class: "chart-label", x: 0, y: gy + 3 });
      label.textContent = number.format(Math.round(max * (1 - step / 4)));
      svg.append(label);
    }
    [["firstLaunches", "installs"], ["activeInstalls", "active"], ["downloadRequests", "downloads"], ["pageViews", "pageviews"]].forEach(([key, className]) => {
      const points = rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");
      svg.append(svgElement("polyline", { class: `chart-line ${className}`, points }));
    });
    [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])].forEach((index) => {
      const label = svgElement("text", { class: "chart-label", x: x(index), y: height - 5, "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle" });
      label.textContent = rows[index].date.slice(5).replace("-", "/");
      svg.append(label);
    });
    host.append(svg);
  }

  function render(data) {
    setMetric("anonymousInstalls", data.knownInstallationInstances);
    setMetric("firstLaunches", data.reportedFirstLaunches);
    setMetric("dau", data.dailyActiveInstalls);
    setMetric("wau", data.activeInstalls7d);
    setMetric("mau", data.activeInstalls30d);
    setMetric("desktopDownloads", data.totalDesktopDownloadRequests);
    setMetric("extensionDownloads", data.totalExtensionDownloadRequests);
    setMetric("pageViews", data.totalPageViews);
    setMetric("homePageViews", data.totalHomePageViews);
    setRate("homeToDownloadRate", data.homeToDownloadRate);
    renderRankList("platformList", data.platformInstalls, { macos: "macOS", windows: "Windows", darwin: "macOS", win32: "Windows", other: "Other" });
    renderRankList("versionList", data.versionInstalls);
    renderRankList("refList", data.downloadsByRef, { direct: "Direct / 无 ref" });
    renderRankList("downloadList", data.downloadsByFile);
    renderTrend(data.daily);
    const generated = new Date(data.generatedAt);
    $("updatedAt").textContent = Number.isNaN(generated.getTime()) ? "更新时间未知" : `更新于 ${dateTime.format(generated)}`;
    const footer = $("statsFooter");
    const coverage = new Date(data.coverageStart);
    const coverageText = Number.isNaN(coverage.getTime()) ? "覆盖起点未知" : `趋势口径起点 ${dateTime.format(coverage)}`;
    footer.textContent = `统计日时区：${data.analyticsTimeZone || "unknown"} · ${coverageText} · 下载数字为 HTTP 请求数，不等同于独立下载人数。页面访问是 Nginx 日志近似 PV，不是按钮点击；首页按 GravityPort 页面体长过滤，首页→下载是下载请求除以首页访问。`;
  }

  async function loadStats() {
    refreshButton.disabled = true;
    errorNotice.hidden = true;
    try {
      const response = await fetch(`./stats.json?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("./login.html?expired=1");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      errorNotice.textContent = `暂时读取不到 stats.json：${error?.message || error}`;
      errorNotice.hidden = false;
      $("updatedAt").textContent = "数据不可用";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", loadStats);
  campaignRefInput.addEventListener("input", updateCampaignUrl);
  copyCampaignUrl.addEventListener("click", copyCampaignLink);
  document.querySelectorAll("[data-ref-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      campaignRefInput.value = button.dataset.refPreset || "";
      updateCampaignUrl();
      campaignRefInput.focus();
    });
  });
  updateCampaignUrl();
  void loadStats();
  refreshTimer = window.setInterval(loadStats, 60_000);
  window.addEventListener("pagehide", () => window.clearInterval(refreshTimer), { once: true });
})();
