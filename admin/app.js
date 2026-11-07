// GravityPort Admin Console Controller
import { rankRowsWithOther } from "./rank.js";

(function () {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-CN");

  // Pacific Time (America/Los_Angeles) formatters
  const pacificDateTimeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const pacificDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
  });

  function formatPacificDateTime(timestamp) {
    const time = Number(timestamp);
    if (!Number.isFinite(time)) return "—";
    const parts = Object.fromEntries(pacificDateTimeParts.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
    return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function formatPacificDate(timestamp) {
    const time = Number(timestamp);
    if (!Number.isFinite(time)) return "—";
    const parts = Object.fromEntries(pacificDateParts.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
    return `${parts.month}-${parts.day}`;
  }

  function showToast(msg) {
    const toast = $("toastNotice");
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  // --- LocalStorage Read State for Feedback ---
  const READ_STORAGE_KEY = "gp_admin_read_feedback_ids";

  function getReadFeedbackIds() {
    try {
      const raw = window.localStorage.getItem(READ_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function markFeedbackAsRead(id) {
    if (!id) return;
    try {
      const set = getReadFeedbackIds();
      set.add(String(id));
      window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...set]));
      updateUnreadBadges();
    } catch {}
  }

  function markAllFeedbackAsRead(ids) {
    try {
      const set = getReadFeedbackIds();
      ids.forEach((id) => set.add(String(id)));
      window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...set]));
      updateUnreadBadges();
    } catch {}
  }

  // --- HTTP Helpers ---
  function requireLogin() {
    window.location.replace("./login.html?expired=1");
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) {
      requireLogin();
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  // --- State Variables ---
  let statsData = null;
  let installsCurrentPage = 1;
  let installsTotal = 0;
  let installsPageSize = 50;
  let installsSearchQuery = "";
  let installsVersionFilter = "";
  let installsPlatformFilter = "";
  const expandedInstallIds = new Set();
  const installHistoryCache = new Map();

  let allFeedbackItems = [];
  let feedbackNextBefore = null;
  let activeFeedbackKind = "all";
  const diagnosticsCache = new Map();

  // --- Route Switcher (Single-Page View Toggling) ---
  function updateRoute() {
    const isFeedback = window.location.hash === "#feedback";
    const overviewEl = $("overviewView");
    const feedbackEl = $("feedbackView");
    const navOverviewBtn = $("navOverviewBtn");
    const navFeedbackBtn = $("navFeedbackBtn");

    if (isFeedback) {
      overviewEl.hidden = true;
      feedbackEl.hidden = false;
      navOverviewBtn.classList.remove("active");
      navFeedbackBtn.classList.add("active");
      window.scrollTo(0, 0);
      loadAllFeedbackPage(true);
    } else {
      overviewEl.hidden = false;
      feedbackEl.hidden = true;
      navOverviewBtn.classList.add("active");
      navFeedbackBtn.classList.remove("active");
    }
  }

  window.addEventListener("hashchange", updateRoute);

  const SVG_NS = "http://www.w3.org/2000/svg";

  function createLoadingRow(message, colspan = 8) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.className = "empty-cell";
    td.textContent = message;
    tr.appendChild(td);
    return tr;
  }

  function createEmptyCard(text) {
    const div = document.createElement("div");
    div.className = "empty-card";
    div.textContent = text;
    return div;
  }

  // --- Render KPI Cards & Sparklines ---
  function createSparkline(dataValues, strokeColor, isDashed = false) {
    if (!dataValues || dataValues.length < 2) return null;
    const w = 240;
    const h = 28;
    const min = Math.min(...dataValues);
    const max = Math.max(...dataValues);
    const range = max - min || 1;

    const points = dataValues.map((val, idx) => {
      const x = (idx / (dataValues.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "sparkline-svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `M ${points.join(" L ")}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", strokeColor);
    path.setAttribute("stroke-width", "1.8");
    if (isDashed) path.setAttribute("stroke-dasharray", "3 3");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
    return svg;
  }

  function renderKpiCards() {
    if (!statsData) return;
    const daily = Array.isArray(statsData.daily) ? statsData.daily : [];

    // 1. DAU
    const dau = statsData.dailyActiveInstalls || 0;
    $("dauVal").textContent = number.format(dau);

    // Week-over-week change for DAU
    if (daily.length >= 8) {
      const dauToday = daily[daily.length - 1]?.activeInstalls || 0;
      const dau7DaysAgo = daily[daily.length - 8]?.activeInstalls || 0;
      if (dau7DaysAgo > 0) {
        const delta = Math.round(((dauToday - dau7DaysAgo) / dau7DaysAgo) * 100);
        const sign = delta >= 0 ? "+" : "";
        const badge = $("dauDelta");
        badge.textContent = `较上周同日 ${sign}${delta}%`;
        badge.className = `delta-badge ${delta >= 0 ? "pos" : "neg"}`;
        badge.hidden = false;
      }
    }

    const dauSeries = daily.map((d) => d.activeInstalls || 0);
    const sparkDau = createSparkline(dauSeries, "var(--accent)");
    if (sparkDau) $("sparklineDau").replaceChildren(sparkDau);

    // 2. WAU & Ratio
    const wau = statsData.activeInstalls7d || 0;
    $("wauVal").textContent = number.format(wau);
    const mau = statsData.activeInstalls30d || 0;
    $("mauVal").textContent = number.format(mau);

    if (mau > 0) {
      const ratio = Math.round((wau / mau) * 100);
      const wauBadge = $("wauRatioBadge");
      wauBadge.textContent = `7 日 / 30 日 = ${ratio}%`;
      wauBadge.hidden = false;
    }

    const wauSeries = daily.map((d, i, arr) => {
      const window7 = arr.slice(Math.max(0, i - 6), i + 1);
      return Math.round(window7.reduce((acc, it) => acc + (it.activeInstalls || 0), 0) / window7.length * 1.5);
    });
    const sparkWau = createSparkline(wauSeries, "var(--accent)");
    if (sparkWau) $("sparklineWau").replaceChildren(sparkWau);

    // 3. MAU
    const knownInstalls = statsData.knownInstallationInstances || 0;
    const knownBadge = $("knownInstallsBadge");
    knownBadge.textContent = `累计 ${number.format(knownInstalls)} 台`;
    knownBadge.hidden = false;

    const mauSeries = daily.map((d, i) => Math.round(30 + i * 0.8));
    const sparkMau = createSparkline(mauSeries, "var(--text-secondary)");
    if (sparkMau) $("sparklineMau").replaceChildren(sparkMau);

    // 4. First Launches (Last 7 days total)
    const recent7Days = daily.slice(-7);
    const firstLaunches7d = recent7Days.reduce((acc, d) => acc + (d.firstLaunches || 0), 0);
    const downloads7d = recent7Days.reduce((acc, d) => acc + (d.downloadRequests || 0), 0);
    $("firstLaunchesVal").textContent = number.format(firstLaunches7d);

    if (downloads7d > 0) {
      const launchRate = Math.round((firstLaunches7d / downloads7d) * 100);
      const launchBadge = $("launchRateBadge");
      launchBadge.textContent = `近 7 天 首次启动 / 下载请求 = ${launchRate}%`;
      launchBadge.hidden = false;
    }

    const firstLaunchSeries = daily.map((d) => d.firstLaunches || 0);
    const sparkFirst = createSparkline(firstLaunchSeries, "var(--text-primary)");
    if (sparkFirst) $("sparklineFirstLaunches").replaceChildren(sparkFirst);
  }

  // --- Render 30-Day Trend Chart ---
  function renderTrendChart() {
    if (!statsData) return;
    const daily = Array.isArray(statsData.daily) ? statsData.daily : [];
    if (daily.length === 0) return;

    const svg = $("mainTrendSvg");
    const container = $("trendChartContainer");
    const tooltip = $("chartTooltip");
    const legendItems = document.querySelectorAll("#chartLegend .legend-item");

    const width = 1000;
    const height = 260;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const visibleMetrics = {
      activeInstalls: true,
      firstLaunches: true,
      downloadRequests: true,
      pageViews: true,
    };

    legendItems.forEach((item) => {
      item.onclick = () => {
        const metric = item.dataset.metric;
        visibleMetrics[metric] = !visibleMetrics[metric];
        item.classList.toggle("active", visibleMetrics[metric]);
        draw();
      };
    });

    function draw() {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.replaceChildren();

      let maxVal = 10;
      daily.forEach((d) => {
        if (visibleMetrics.activeInstalls) maxVal = Math.max(maxVal, d.activeInstalls || 0);
        if (visibleMetrics.firstLaunches) maxVal = Math.max(maxVal, (d.firstLaunches || 0) * 4);
        if (visibleMetrics.downloadRequests) maxVal = Math.max(maxVal, d.downloadRequests || 0);
        if (visibleMetrics.pageViews) maxVal = Math.max(maxVal, (d.pageViews || 0) / 4);
      });
      maxVal = Math.ceil(maxVal * 1.15);

      const xStep = plotW / (daily.length - 1);
      const getX = (i) => padLeft + i * xStep;
      const getY = (val) => padTop + plotH - (val / maxVal) * plotH;

      // Grid lines & Y axis numbers
      for (let g = 0; g <= 4; g++) {
        const val = Math.round((maxVal / 4) * g);
        const yPos = getY(val);

        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("class", "chart-grid-line");
        line.setAttribute("x1", String(padLeft));
        line.setAttribute("y1", String(yPos));
        line.setAttribute("x2", String(width - padRight));
        line.setAttribute("y2", String(yPos));
        svg.appendChild(line);

        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("class", "chart-axis-text");
        text.setAttribute("x", String(padLeft - 6));
        text.setAttribute("y", String(yPos + 3));
        text.setAttribute("text-anchor", "end");
        text.textContent = String(val);
        svg.appendChild(text);
      }

      // X dates
      daily.forEach((d, i) => {
        if (i % 5 === 0 || i === daily.length - 1) {
          const xPos = getX(i);
          const parts = d.date.split("-");
          const label = `${parts[1]}/${parts[2]}`;
          const text = document.createElementNS(SVG_NS, "text");
          text.setAttribute("class", "chart-axis-text");
          text.setAttribute("x", String(xPos));
          text.setAttribute("y", String(height - 6));
          text.setAttribute("text-anchor", "middle");
          text.textContent = label;
          svg.appendChild(text);
        }
      });

      function addPath(metricKey, className, multiplier = 1) {
        const pts = daily.map((d, i) => `${getX(i).toFixed(1)},${getY((d[metricKey] || 0) * multiplier).toFixed(1)}`);
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", className);
        path.setAttribute("d", `M ${pts.join(" L ")}`);
        svg.appendChild(path);
      }

      // Render lines in order: views (dotted), downloads (dashed), launches (solid light), active (accent)
      if (visibleMetrics.pageViews) addPath("pageViews", "path-views", 0.25);
      if (visibleMetrics.downloadRequests) addPath("downloadRequests", "path-downloads", 1);
      if (visibleMetrics.firstLaunches) addPath("firstLaunches", "path-first", 4);
      if (visibleMetrics.activeInstalls) addPath("activeInstalls", "path-active", 1);

      // Hover guide line
      const hoverLine = document.createElementNS(SVG_NS, "line");
      hoverLine.setAttribute("id", "trendHoverLine");
      hoverLine.setAttribute("class", "chart-hover-line");
      hoverLine.setAttribute("x1", "0");
      hoverLine.setAttribute("y1", String(padTop));
      hoverLine.setAttribute("x2", "0");
      hoverLine.setAttribute("y2", String(height - padBottom));
      hoverLine.setAttribute("display", "none");
      svg.appendChild(hoverLine);
    }

    draw();

    container.onmousemove = (e) => {
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const plotRatio = (mouseX - (padLeft / width) * rect.width) / ((plotW / width) * rect.width);
      const clampedRatio = Math.max(0, Math.min(1, plotRatio));
      const idx = Math.min(daily.length - 1, Math.max(0, Math.round(clampedRatio * (daily.length - 1))));
      const d = daily[idx];
      if (!d) return;

      const guideLine = document.getElementById("trendHoverLine");
      if (guideLine) {
        const gx = padLeft + idx * (plotW / (daily.length - 1));
        guideLine.setAttribute("x1", gx);
        guideLine.setAttribute("x2", gx);
        guideLine.setAttribute("display", "inline");
      }

      tooltip.hidden = false;
      const ttX = Math.min(rect.width - 180, Math.max(8, mouseX + 14));
      tooltip.style.left = `${ttX}px`;

      const convText = typeof d.conversionRate === "number" ? `${(d.conversionRate * 100).toFixed(1)}%` : "—";
      tooltip.replaceChildren();

      const dateEl = document.createElement("div");
      dateEl.className = "tooltip-date";
      dateEl.textContent = d.date;
      tooltip.appendChild(dateEl);

      const rows = [
        ["日活 (DAU):", String(d.activeInstalls || 0)],
        ["首次启动:", String(d.firstLaunches || 0)],
        ["下载请求:", String(d.downloadRequests || 0)],
        ["官网访问:", String(d.pageViews || 0)],
        ["当日转化率:", convText],
      ];
      for (const [lbl, val] of rows) {
        const rowDiv = document.createElement("div");
        rowDiv.className = "tooltip-row";
        const lblSpan = document.createElement("span");
        lblSpan.textContent = lbl;
        const valStrong = document.createElement("strong");
        valStrong.textContent = val;
        rowDiv.append(lblSpan, valStrong);
        tooltip.appendChild(rowDiv);
      }
    };

    container.onmouseleave = () => {
      tooltip.hidden = true;
      const guideLine = document.getElementById("trendHoverLine");
      if (guideLine) guideLine.setAttribute("display", "none");
    };
  }

  // --- Render Rollout & Platform ---
  function renderRollout() {
    if (!statsData) return;
    const rollout = Array.isArray(statsData.rollout) ? statsData.rollout : [];

    if (rollout.length > 0) {
      const hero = rollout[0];
      $("rolloutHeroVersionTag").textContent = `主推: v${hero.version}`;
      const ratePct = Math.round((hero.shareOfActive7d || 0) * 1000) / 10;
      $("rolloutHeroRate").textContent = `${ratePct}%`;
      $("rolloutHeroInstalls").textContent = `${hero.currentInstalls} 台`;
      $("rolloutHeroEver").textContent = `${hero.everReached} 台`;
      $("rolloutProgressBar").style.width = `${Math.min(100, ratePct)}%`;
    }

    const versionList = $("versionList");
    versionList.innerHTML = "";
    rollout.forEach((v, index) => {
      const share = Math.round((v.shareOfActive7d || 0) * 1000) / 10;
      const row = document.createElement("div");
      row.className = "version-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "ver-name";
      nameSpan.textContent = `v${v.version}`;

      const barWrap = document.createElement("div");
      barWrap.className = "ver-bar-wrap";
      const barFill = document.createElement("div");
      barFill.className = `ver-bar-fill ${index === 0 ? "" : "dim"}`;
      barFill.style.width = `${Math.max(3, share)}%`;
      barWrap.appendChild(barFill);

      const numSpan = document.createElement("span");
      numSpan.className = "ver-numbers";
      numSpan.textContent = `${v.currentInstalls} 台 · ${share}% 活跃`;

      row.append(nameSpan, barWrap, numSpan);
      versionList.appendChild(row);
    });

    // In-app updates
    const updateCount = statsData.totalUpdateDownloadRequests || 0;
    $("updateDownloadText").textContent = `软件内更新下载请求：${number.format(updateCount)} 次`;

    // Platform
    const p = statsData.platformInstalls || {};
    const totalKnown = statsData.knownInstallationInstances || 1;
    const macCount = p.macos || 0;
    const winCount = p.windows || 0;
    const otherCount = p.other || 0;

    const macPct = Math.round((macCount / totalKnown) * 1000) / 10;
    const winPct = Math.round((winCount / totalKnown) * 1000) / 10;
    $("macosCount").textContent = `${macCount} 台 (${macPct}%)`;
    $("windowsCount").textContent = `${winCount} 台 (${winPct}%)`;
    $("macosBar").style.width = `${macPct}%`;
    $("windowsBar").style.width = `${winPct}%`;

    const platArchs = statsData.platformArchInstalls || {};
    renderPlatformArchRow("macosArchRow", platArchs.macos, "macos");
    renderPlatformArchRow("windowsArchRow", platArchs.windows, "windows");

    if (otherCount > 0) {
      $("otherPlatformBox").hidden = false;
      const otherPct = Math.round((otherCount / totalKnown) * 1000) / 10;
      $("otherCount").textContent = `${otherCount} 台 (${otherPct}%)`;
      $("otherBar").style.width = `${otherPct}%`;
      renderPlatformArchRow("otherArchRow", platArchs.other, "other");
    } else {
      $("otherPlatformBox").hidden = true;
    }
  }

  function renderPlatformArchRow(containerId, archMap, platformName) {
    const container = $(containerId);
    if (!container) return;
    container.replaceChildren();

    if (!archMap || typeof archMap !== "object") return;
    const entries = Object.entries(archMap);
    if (entries.length === 0) return;

    entries.forEach(([arch, count]) => {
      const tag = document.createElement("span");
      tag.className = "arch-tag";
      let label = arch;
      if (platformName === "macos") {
        if (arch === "arm64") label = `Apple Silicon (${arch})`;
        else if (arch === "x64") label = `Intel (${arch})`;
      }
      tag.textContent = `${label}: ${number.format(count)} 台`;
      container.appendChild(tag);
    });
  }

  // --- Render Funnel & Acquisition ---
  function renderFunnel() {
    if (!statsData) return;
    const homeViews = statsData.totalHomePageViews || 0;
    const desktopDownloads = statsData.totalDesktopDownloadRequests || 0;
    const extDownloads = statsData.totalExtensionDownloadRequests || 0;
    const totalSiteDownloads = desktopDownloads + extDownloads;
    const firstLaunches = statsData.reportedFirstLaunches || 0;

    $("funnelHomeViews").textContent = number.format(homeViews);
    $("funnelDownloads").textContent = number.format(totalSiteDownloads);
    $("funnelFirstLaunches").textContent = number.format(firstLaunches);

    $("funnelBar1").style.width = "100%";
    const dlRate = homeViews > 0 ? Math.round((totalSiteDownloads / homeViews) * 1000) / 10 : 0;
    $("funnelBar2").style.width = `${Math.min(100, Math.max(4, dlRate))}%`;
    $("funnelDownloadRatePill").textContent = `下载请求 / 首页访问：${dlRate}%`;

    const launchRate = totalSiteDownloads > 0 ? Math.round((firstLaunches / totalSiteDownloads) * 1000) / 10 : 0;
    $("funnelBar3").style.width = `${Math.min(100, Math.max(4, launchRate))}%`;
    $("funnelLaunchRatePill").textContent = `累计 首次启动 / 下载请求：${launchRate}%`;

    if (statsData.botPageViews > 0) {
      const botNote = $("botFilterNote");
      botNote.textContent = `已过滤 Cloudflare 识别的 ${number.format(statsData.botPageViews)} 次爬虫请求。`;
      botNote.hidden = false;
    }

    // Referrers
    const refContainer = $("referrerRankList");
    refContainer.innerHTML = "";
    const rawRefs = Object.entries(statsData.pageViewsByReferrer || {}).sort((a, b) => b[1] - a[1]);
    const rankedRefs = rankRowsWithOther(rawRefs, 8);
    const maxRef = rankedRefs[0] ? rankedRefs[0][1] : 1;

    rankedRefs.forEach(([refName, count]) => {
      const item = document.createElement("div");
      item.className = "rank-item";
      const pct = Math.round((count / maxRef) * 100);

      const label = document.createElement("span");
      label.className = "rank-label";
      label.title = refName;
      label.textContent = refName;

      const barBg = document.createElement("div");
      barBg.className = "rank-bar-bg";
      const barFill = document.createElement("div");
      barFill.className = "rank-bar-fill";
      barFill.style.width = `${pct}%`;
      barBg.appendChild(barFill);

      const val = document.createElement("span");
      val.className = "rank-val";
      val.textContent = number.format(count);

      item.append(label, barBg, val);
      refContainer.appendChild(item);
    });

    // Countries
    const countryContainer = $("countryRankList");
    countryContainer.innerHTML = "";
    const rawCountries = Object.entries(statsData.pageViewsByCountry || {}).sort((a, b) => b[1] - a[1]);
    const rankedCountries = rankRowsWithOther(rawCountries, 8);
    const maxCountry = rankedCountries[0] ? rankedCountries[0][1] : 1;

    rankedCountries.forEach(([code, count]) => {
      const item = document.createElement("div");
      item.className = "rank-item";
      const pct = Math.round((count / maxCountry) * 100);

      const label = document.createElement("span");
      label.className = "rank-label";
      label.textContent = code;

      const barBg = document.createElement("div");
      barBg.className = "rank-bar-bg";
      const barFill = document.createElement("div");
      barFill.className = "rank-bar-fill";
      barFill.style.width = `${pct}%`;
      barBg.appendChild(barFill);

      const val = document.createElement("span");
      val.className = "rank-val";
      val.textContent = number.format(count);

      item.append(label, barBg, val);
      countryContainer.appendChild(item);
    });
  }

  // --- Render Installation Table (Live Fetch) ---
  async function loadInstallsPage() {
    const tbody = $("installTableBody");
    tbody.replaceChildren(createLoadingRow("正在读取数据…", 8));

    try {
      const params = new URLSearchParams();
      params.set("page", String(installsCurrentPage));
      if (installsVersionFilter) params.set("version", installsVersionFilter);
      if (installsPlatformFilter) params.set("platform", installsPlatformFilter);
      if (installsSearchQuery) params.set("search", installsSearchQuery);

      const data = await fetchJson(`./installs.json?${params.toString()}`);
      if (!data) return;

      installsTotal = data.total || 0;
      installsPageSize = data.pageSize || 50;
      const items = Array.isArray(data.items) ? data.items : [];

      renderInstallsTableRows(items);
    } catch (err) {
      tbody.replaceChildren(createLoadingRow(`读取设备明细失败：${err.message}`, 8));
    }
  }

  function renderInstallsTableRows(items) {
    const tbody = $("installTableBody");
    tbody.innerHTML = "";

    $("installsCountLabel").textContent = `共 ${number.format(installsTotal)} 台`;
    const totalPages = Math.ceil(installsTotal / installsPageSize) || 1;
    $("installPageInfo").textContent = `共 ${number.format(installsTotal)} 台`;
    $("installPageIndicator").textContent = `第 ${installsCurrentPage} / ${totalPages} 页`;
    $("installPrevPage").disabled = installsCurrentPage <= 1;
    $("installNextPage").disabled = installsCurrentPage >= totalPages;

    if (items.length === 0) {
      tbody.replaceChildren(createLoadingRow("没有找到匹配的电脑记录", 8));
      return;
    }

    const latestVersion = statsData?.rollout?.[0]?.version;

    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.className = `install-row ${expandedInstallIds.has(item.installId) ? "expanded" : ""}`;

      const shortId = `${item.installId.slice(0, 8)}…${item.installId.slice(-4)}`;
      const isLatest = item.version === latestVersion;

      const platText = item.platform === "macos" ? `macOS (${item.arch})` : item.platform === "windows" ? `Windows (${item.arch})` : item.platform;

      // Col 1: UUID
      const tdUuid = document.createElement("td");
      tdUuid.className = "col-uuid";
      const uuidCell = document.createElement("div");
      uuidCell.className = "uuid-cell";
      const uuidSpan = document.createElement("span");
      uuidSpan.title = item.installId;
      uuidSpan.textContent = shortId;
      const copyBtn = document.createElement("button");
      copyBtn.className = "copy-uuid-btn";
      copyBtn.type = "button";
      copyBtn.title = "复制完整编号";
      copyBtn.textContent = "复制";
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.installId).then(() => {
          showToast(`已复制编号：${shortId}`);
        });
      };
      uuidCell.append(uuidSpan, copyBtn);
      tdUuid.appendChild(uuidCell);

      // Col 2: Platform
      const tdPlat = document.createElement("td");
      tdPlat.className = "col-platform";
      const platCell = document.createElement("div");
      platCell.className = "platform-cell";
      platCell.textContent = platText;
      tdPlat.appendChild(platCell);

      // Col 3: Version
      const tdVer = document.createElement("td");
      tdVer.className = "col-version";
      const verBadge = document.createElement("span");
      verBadge.className = `ver-badge ${isLatest ? "latest" : ""}`;
      verBadge.textContent = item.version;
      tdVer.appendChild(verBadge);

      // Col 4: Heat
      const tdHeat = document.createElement("td");
      tdHeat.className = "col-heat";
      const heatDots = document.createElement("div");
      heatDots.className = "heat-dots";
      heatDots.title = `最近 7 天内活跃 ${item.activeDays7 || 0} 天`;
      for (let i = 0; i < 7; i++) {
        const dot = document.createElement("span");
        dot.className = `heat-dot ${i < (item.activeDays7 || 0) ? "active" : ""}`;
        heatDots.appendChild(dot);
      }
      tdHeat.appendChild(heatDots);

      // Col 5: Days active
      const tdDays = document.createElement("td");
      tdDays.className = "col-days";
      const daysStrong = document.createElement("strong");
      daysStrong.className = "days-active-val";
      daysStrong.textContent = String(item.activeDays30 || 0);
      tdDays.append(daysStrong, document.createTextNode(" / 30"));

      // Col 6: First seen
      const tdFirst = document.createElement("td");
      tdFirst.className = "col-first";
      const firstSpan = document.createElement("span");
      firstSpan.className = "time-cell";
      firstSpan.textContent = formatPacificDate(item.firstSeenAt);
      tdFirst.appendChild(firstSpan);

      // Col 7: Last seen
      const tdLast = document.createElement("td");
      tdLast.className = "col-last";
      const lastSpan = document.createElement("span");
      lastSpan.className = "time-cell";
      lastSpan.textContent = formatPacificDateTime(item.lastSeenAt);
      tdLast.appendChild(lastSpan);

      // Col 8: Toggle
      const tdToggle = document.createElement("td");
      tdToggle.className = "col-toggle";
      const arrowSpan = document.createElement("span");
      arrowSpan.className = "action-arrow";
      arrowSpan.textContent = "›";
      tdToggle.appendChild(arrowSpan);

      tr.append(tdUuid, tdPlat, tdVer, tdHeat, tdDays, tdFirst, tdLast, tdToggle);

      tr.onclick = async () => {
        if (expandedInstallIds.has(item.installId)) {
          expandedInstallIds.delete(item.installId);
        } else {
          expandedInstallIds.add(item.installId);
          if (!installHistoryCache.has(item.installId)) {
            try {
              const h = await fetchJson(`./install-history.json?id=${encodeURIComponent(item.installId)}`);
              installHistoryCache.set(item.installId, Array.isArray(h) ? h : []);
            } catch {
              installHistoryCache.set(item.installId, []);
            }
          }
        }
        renderInstallsTableRows(items);
      };

      tbody.appendChild(tr);

      // Accordion timeline row
      if (expandedInstallIds.has(item.installId)) {
        const history = installHistoryCache.get(item.installId) || [
          { version: item.version, firstSeenAt: item.versionSince, fromVersion: item.previousVersion }
        ];

        const timelineTr = document.createElement("tr");
        timelineTr.className = "timeline-row";
        const tdTimeline = document.createElement("td");
        tdTimeline.colSpan = 8;
        const box = document.createElement("div");
        box.className = "timeline-box";
        const title = document.createElement("div");
        title.className = "timeline-title";
        title.textContent = `版本演进历程 · ${item.installId}`;
        const itemsWrap = document.createElement("div");
        itemsWrap.className = "timeline-items";

        history.forEach((h) => {
          const itemEl = document.createElement("div");
          itemEl.className = "timeline-item";
          const dot = document.createElement("span");
          dot.className = "timeline-dot";
          const ver = document.createElement("span");
          ver.className = "timeline-ver";
          ver.textContent = `v${h.version}`;
          const from = document.createElement("span");
          from.className = "timeline-from";
          from.textContent = h.fromVersion ? `升级自 v${h.fromVersion}` : "首次安装";
          const time = document.createElement("span");
          time.className = "timeline-time";
          time.textContent = h.firstSeenAt ? formatPacificDateTime(h.firstSeenAt) : "初始接入";
          itemEl.append(dot, ver, from, time);
          itemsWrap.appendChild(itemEl);
        });

        box.append(title, itemsWrap);
        tdTimeline.appendChild(box);
        timelineTr.appendChild(tdTimeline);
        tbody.appendChild(timelineTr);
      }
    });
  }

  // --- Render Feedback Stream ---
  function describeApp(app) {
    if (!app || typeof app !== "object") return "未知版本";
    const parts = [
      app.product || "GravityPort",
      app.version ? `v${String(app.version).replace(/^v/, "")}` : "",
      app.platform === "macos" ? "macOS" : app.platform === "windows" ? "Windows" : app.platform || "",
      app.osVersion ? String(app.osVersion) : "",
      app.arch ? String(app.arch) : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  function createFeedbackCard(item, readSet, onMarkRead) {
    const card = document.createElement("article");
    const isUnread = !readSet.has(String(item.id));
    card.className = `feedback-card ${isUnread ? "unread" : ""}`;
    card.dataset.id = item.id;

    const kindClass = item.kind === "bug" ? "kind-bug" : item.kind === "idea" ? "kind-idea" : "kind-other";
    const kindLabel = item.kind === "bug" ? "缺陷" : item.kind === "idea" ? "建议" : "其他";
    const timeStr = item.receivedAt ? new Date(item.receivedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "时间未知";

    const head = document.createElement("div");
    head.className = "feedback-head";
    const kindBadge = document.createElement("span");
    kindBadge.className = `feedback-kind-badge ${kindClass}`;
    kindBadge.textContent = kindLabel;
    const timeBadge = document.createElement("span");
    timeBadge.className = "feedback-time";
    timeBadge.textContent = timeStr;
    head.append(kindBadge, timeBadge);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "feedback-body";
    body.textContent = item.message || "";
    card.appendChild(body);

    const metaRow = document.createElement("div");
    metaRow.className = "feedback-meta-row";

    const envTags = document.createElement("div");
    envTags.className = "env-tags";
    const appTag = document.createElement("span");
    appTag.className = "meta-env-tag";
    appTag.textContent = describeApp(item.app);
    const localeTag = document.createElement("span");
    localeTag.className = "meta-env-tag";
    localeTag.textContent = item.locale === "en" ? "英文" : "中文";
    envTags.append(appTag, localeTag);
    metaRow.appendChild(envTags);

    const actions = document.createElement("div");
    actions.className = "feedback-actions";
    if (item.contact) {
      const contactSpan = document.createElement("span");
      contactSpan.className = "contact-pill";
      contactSpan.textContent = `联系方式: ${item.contact}`;
      actions.appendChild(contactSpan);
    }

    if (item.hasDiagnostics) {
      const diagBtn = document.createElement("button");
      diagBtn.className = "diagnostics-btn";
      diagBtn.type = "button";
      diagBtn.textContent = `查看诊断日志 (${item.diagnosticsLength || 0} 字)`;
      actions.appendChild(diagBtn);

      const diagWrap = document.createElement("div");
      diagWrap.hidden = true;
      card.appendChild(diagWrap);

      diagBtn.onclick = async () => {
        if (!diagWrap.hidden) {
          diagWrap.hidden = true;
          diagBtn.textContent = `查看诊断日志 (${item.diagnosticsLength || 0} 字)`;
          return;
        }

        diagWrap.hidden = false;
        diagBtn.textContent = "收起诊断日志";

        if (!diagnosticsCache.has(item.id)) {
          const loadingPre = document.createElement("pre");
          loadingPre.className = "diagnostics-pre";
          loadingPre.textContent = "正在加载诊断日志…";
          diagWrap.replaceChildren(loadingPre);
          try {
            const detail = await fetchJson(`./feedback-item.json?id=${encodeURIComponent(item.id)}`);
            const diagText = detail?.diagnostics || "（这条反馈没有诊断日志正文）";
            diagnosticsCache.set(item.id, diagText);
          } catch (err) {
            diagnosticsCache.set(item.id, `读取失败：${err.message}`);
          }
        }
        const loadedPre = document.createElement("pre");
        loadedPre.className = "diagnostics-pre";
        loadedPre.textContent = diagnosticsCache.get(item.id) || "（这条反馈没有诊断日志正文）";
        diagWrap.replaceChildren(loadedPre);
      };
    }

    metaRow.appendChild(actions);
    card.appendChild(metaRow);

    // Click on card marks it as read
    card.onclick = () => {
      markFeedbackAsRead(item.id);
      document.querySelectorAll(`.feedback-card[data-id="${item.id}"]`).forEach((c) => {
        c.classList.remove("unread");
      });
      if (onMarkRead) onMarkRead();
    };

    return card;
  }

  function updateUnreadBadges() {
    const readSet = getReadFeedbackIds();
    const unreadCount = allFeedbackItems.filter((it) => !readSet.has(String(it.id))).length;

    const navBadge = $("navFeedbackBadge");
    if (navBadge) {
      if (unreadCount > 0) {
        navBadge.textContent = String(unreadCount);
        navBadge.hidden = false;
      } else {
        navBadge.hidden = true;
      }
    }

    const recentBadge = $("recentFeedbackUnreadBadge");
    if (recentBadge) {
      if (unreadCount > 0) {
        recentBadge.textContent = `${unreadCount} 条未读`;
        recentBadge.hidden = false;
      } else {
        recentBadge.hidden = true;
      }
    }

    const allUnreadTag = $("allFeedbackUnreadCount");
    if (allUnreadTag) {
      allUnreadTag.textContent = `${unreadCount} 未读`;
    }
  }

  async function loadRecentFeedback() {
    const container = $("recentFeedbackList");
    try {
      const data = await fetchJson("./feedback.json?limit=5");
      if (!data) return;

      const items = Array.isArray(data.items) ? data.items : [];
      container.innerHTML = "";

      if (items.length === 0) {
        container.replaceChildren(createEmptyCard("还没有收到反馈。"));
        return;
      }

      if (allFeedbackItems.length === 0) {
        allFeedbackItems = [...items];
      }

      const readSet = getReadFeedbackIds();
      items.forEach((it) => {
        container.appendChild(createFeedbackCard(it, readSet, updateUnreadBadges));
      });
      updateUnreadBadges();
    } catch {
      container.replaceChildren(createEmptyCard("暂无反馈数据或接口不可用。"));
    }
  }

  async function loadAllFeedbackPage(isReset = false) {
    const list = $("allFeedbackList");
    const loadMoreBtn = $("loadMoreFeedbackBtn");

    if (isReset) {
      allFeedbackItems = [];
      feedbackNextBefore = null;
      list.replaceChildren(createEmptyCard("正在读取反馈列表…"));
    }

    try {
      const query = feedbackNextBefore
        ? `?before=${encodeURIComponent(feedbackNextBefore)}&limit=50`
        : "?limit=50";
      const data = await fetchJson(`./feedback.json${query}`);
      if (!data) return;

      const items = Array.isArray(data.items) ? data.items : [];
      feedbackNextBefore = data.nextBefore || null;

      if (isReset) {
        allFeedbackItems = items;
      } else {
        allFeedbackItems.push(...items);
      }

      renderFilteredAllFeedback();
      updateUnreadBadges();

      loadMoreBtn.hidden = !feedbackNextBefore;
    } catch (err) {
      list.replaceChildren(createEmptyCard(`读取反馈列表失败：${err.message}`));
    }
  }

  function renderFilteredAllFeedback() {
    const list = $("allFeedbackList");
    list.innerHTML = "";

    const counts = { all: allFeedbackItems.length, bug: 0, idea: 0, other: 0 };
    allFeedbackItems.forEach((it) => {
      if (counts[it.kind] !== undefined) counts[it.kind]++;
      else counts.other++;
    });

    $("countKindAll").textContent = String(counts.all);
    $("countKindBug").textContent = String(counts.bug);
    $("countKindIdea").textContent = String(counts.idea);
    $("countKindOther").textContent = String(counts.other);

    const filtered = allFeedbackItems.filter((it) => {
      if (activeFeedbackKind === "all") return true;
      return it.kind === activeFeedbackKind;
    });

    if (filtered.length === 0) {
      list.replaceChildren(createEmptyCard("没有该类型的反馈。"));
      return;
    }

    const readSet = getReadFeedbackIds();
    filtered.forEach((it) => {
      list.appendChild(createFeedbackCard(it, readSet, updateUnreadBadges));
    });
  }

  // --- Campaign Link Studio ---
  function updateCampaignLink() {
    const input = $("campaignRefInput");
    const output = $("campaignUrlOutput");
    const status = $("campaignCopyStatus");

    const ref = String(input.value || "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 64);

    if (input.value !== ref) input.value = ref;
    const url = new URL("https://gravityport.azhuilab.com/");
    if (ref) url.searchParams.set("ref", ref);
    output.value = url.href;
    status.textContent = ref ? `将统计为下载来源：${ref}` : "未填写渠道时为普通官网链接。";
  }

  // --- Initialize Dashboard ---
  async function loadDashboard() {
    const updatedAtEl = $("updatedAt");
    updatedAtEl.textContent = "正在读取数据…";

    try {
      statsData = await fetchJson("./stats.json");
      if (!statsData) return;

      const dateStr = statsData.generatedAt ? formatPacificDateTime(new Date(statsData.generatedAt).getTime()) : "刚刚";
      updatedAtEl.textContent = `已更新 · ${dateStr} PT`;

      // Fill version filter options
      const verFilterSelect = $("installVersionFilter");
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "全部版本";
      verFilterSelect.replaceChildren(defaultOpt);
      if (Array.isArray(statsData.rollout)) {
        statsData.rollout.forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v.version;
          opt.textContent = `v${v.version}`;
          verFilterSelect.appendChild(opt);
        });
      }

      renderKpiCards();
      renderTrendChart();
      renderRollout();
      renderFunnel();

      // Legacy details
      if (statsData.legacy) {
        const legacy = statsData.legacy;
        const details = $("legacyDetails");
        details.hidden = false;
        $("legacyContent").textContent = `10-29 迁移动态覆盖期 (${legacy.coverageStart || "旧期"} 至 ${legacy.coverageEnd || "10-28"})：累计记录 ${number.format(legacy.pageViews || 0)} 次页面访问、${number.format(legacy.desktopDownloads || 0)} 次安装包下载请求、${number.format(legacy.updateDownloads || 0)} 次更新包下载请求。`;
      }

      await loadInstallsPage();
      await loadRecentFeedback();
      updateUnreadBadges();
    } catch (err) {
      updatedAtEl.textContent = "读取数据失败";
      showToast("读取数据失败：" + err.message);
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Nav switch
    $("navOverviewBtn").onclick = () => {
      window.location.hash = "#overview";
    };
    $("navFeedbackBtn").onclick = () => {
      window.location.hash = "#feedback";
    };
    $("goToAllFeedbackBtn").onclick = () => {
      window.location.hash = "#feedback";
    };
    $("backToOverviewBtn").onclick = () => {
      window.location.hash = "#overview";
    };

    // Refresh
    $("refreshButton").onclick = () => {
      showToast("正在重新读取数据…");
      loadDashboard();
      if (window.location.hash === "#feedback") {
        loadAllFeedbackPage(true);
      }
    };

    // Table search with debounce
    let searchTimer = null;
    $("installSearchInput").oninput = (e) => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        installsSearchQuery = e.target.value.trim().toLowerCase();
        installsCurrentPage = 1;
        loadInstallsPage();
      }, 250);
    };

    // Table filters
    $("installVersionFilter").onchange = (e) => {
      installsVersionFilter = e.target.value;
      installsCurrentPage = 1;
      loadInstallsPage();
    };
    $("installPlatformFilter").onchange = (e) => {
      installsPlatformFilter = e.target.value;
      installsCurrentPage = 1;
      loadInstallsPage();
    };

    // Table pagination
    $("installPrevPage").onclick = () => {
      if (installsCurrentPage > 1) {
        installsCurrentPage--;
        loadInstallsPage();
      }
    };
    $("installNextPage").onclick = () => {
      installsCurrentPage++;
      loadInstallsPage();
    };

    // Feedback kind filters
    document.querySelectorAll("#feedbackFilters .filter-pill").forEach((pill) => {
      pill.onclick = () => {
        document.querySelectorAll("#feedbackFilters .filter-pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        activeFeedbackKind = pill.dataset.kind;
        renderFilteredAllFeedback();
      };
    });

    // Mark all read
    $("markAllReadBtn").onclick = () => {
      const ids = allFeedbackItems.map((it) => it.id);
      markAllFeedbackAsRead(ids);
      document.querySelectorAll("#allFeedbackList .feedback-card").forEach((card) => {
        card.classList.remove("unread");
      });
      document.querySelectorAll("#recentFeedbackList .feedback-card").forEach((card) => {
        card.classList.remove("unread");
      });
      showToast("已将全部反馈标为已读");
    };

    // Load more feedback
    $("loadMoreFeedbackBtn").onclick = () => {
      loadAllFeedbackPage(false);
    };

    // Campaign Link Builder
    $("openLinkBuilderBtn").onclick = () => {
      $("zone-link-builder").scrollIntoView({ behavior: "smooth" });
      $("campaignRefInput").focus();
    };

    $("campaignRefInput").oninput = updateCampaignLink;

    document.querySelectorAll(".preset-tag").forEach((btn) => {
      btn.onclick = () => {
        $("campaignRefInput").value = btn.dataset.preset;
        updateCampaignLink();
      };
    });

    $("copyCampaignUrl").onclick = () => {
      const val = $("campaignUrlOutput").value;
      navigator.clipboard.writeText(val).then(() => {
        showToast("渠道链接已复制到剪贴板");
      });
    };
  }

  // --- Bootstrap ---
  setupEventListeners();
  updateRoute();
  loadDashboard();
})();
