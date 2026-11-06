import { rankRowsWithOther } from "./rank.js";

(function () {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-CN");
  const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
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

  const PLATFORM_DISPLAY = { macos: "macOS", windows: "Windows", darwin: "macOS", win32: "Windows", other: "Other" };

  const refreshButton = $("refreshButton");
  const errorNotice = $("errorNotice");
  const campaignRefInput = $("campaignRefInput");
  const campaignUrlOutput = $("campaignUrlOutput");
  const copyCampaignUrl = $("copyCampaignUrl");
  const campaignCopyStatus = $("campaignCopyStatus");
  const installVersionFilter = $("installVersionFilter");
  const installPlatformFilter = $("installPlatformFilter");
  const installTableBody = $("installTableBody");
  const installPageInfo = $("installPageInfo");
  const installPrevPage = $("installPrevPage");
  const installNextPage = $("installNextPage");
  let refreshTimer = null;
  let installPage = 1;
  let installTotal = 0;
  let installPageSize = 50;
  const expandedHistoryIds = new Set();

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

  // In-app update zips, same rule as the worker's classifyDownload: mark
  // their rows in the download-files list.
  const UPDATE_ZIP_PATTERN = /^(?:MOSA|GravityPort)-(?:darwin|win32)-[A-Za-z0-9._-]+\.zip$/;

  // Analytics days actually covered by the report, capped at the window: the
  // edge counters only start at coverageStart, so a young dataset gets a
  // "实际只有 N 天数据" note instead of a full-window claim.
  function coveredDays(data, windowDays) {
    const start = Date.parse(data.coverageStart);
    if (!Number.isFinite(start)) return windowDays;
    const days = Math.floor((Date.now() - start) / 86_400_000) + 1;
    return Math.max(0, Math.min(windowDays, days));
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
    const visible = rankRowsWithOther(rows);
    const max = Math.max(...visible.map(([, value]) => Number(value)));
    visible.forEach(([label, value]) => {
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

  function renderSiteTraffic(data) {
    const referrerRows = entries(data.pageViewsByReferrer);
    const countryRows = entries(data.pageViewsByCountry);
    const deviceRows = entries(data.pageViewsByDevice);
    const grid = $("siteTrafficGrid");
    if (grid) grid.hidden = !(referrerRows.length || countryRows.length || deviceRows.length);
    renderRankList("referrerList", data.pageViewsByReferrer, { internal: "站内", direct: "直接" });
    renderRankList("countryList", data.pageViewsByCountry);
    renderRankList("deviceList", data.pageViewsByDevice, { desktop: "桌面", mobile: "手机", tablet: "平板" });
    const botCard = $("botPageViewsCard");
    const botCount = Number(data.botPageViews);
    if (botCard) botCard.hidden = !(Number.isFinite(botCount) && botCount > 0);
    if (botCard && !botCard.hidden) setMetric("botPageViews", data.botPageViews);
    const note = $("metricsNote");
    const noteText = typeof data.metricsNote === "string" ? data.metricsNote : "";
    if (note) {
      note.hidden = !noteText;
      note.textContent = noteText;
    }
  }

  function render(data) {
    setMetric("anonymousInstalls", data.knownInstallationInstances);
    setMetric("firstLaunches", data.reportedFirstLaunches);
    setMetric("dau", data.dailyActiveInstalls);
    setMetric("wau", data.activeInstalls7d);
    setMetric("mau", data.activeInstalls30d);
    setMetric("desktopDownloads", data.totalDesktopDownloadRequests);
    setMetric("updateDownloads", data.totalUpdateDownloadRequests);
    setMetric("extensionDownloads", data.totalExtensionDownloadRequests);
    setMetric("pageViews", data.totalPageViews);
    setMetric("homePageViews", data.totalHomePageViews);
    setRate("homeToDownloadRate", data.homeToDownloadRate);
    const covered30 = coveredDays(data, 30);
    $("mauNote").textContent = covered30 < 30
      ? `最近 30 个统计日打开过 App 的电脑数（实际只有 ${number.format(covered30)} 天数据）`
      : "最近 30 个统计日打开过 App 的电脑数";
    const covered7 = coveredDays(data, 7);
    $("wauNote").textContent = covered7 < 7
      ? `最近 7 个统计日打开过 App 的电脑数（实际只有 ${number.format(covered7)} 天数据）`
      : "最近 7 个统计日打开过 App 的电脑数";
    renderRankList("platformList", data.platformInstalls, PLATFORM_DISPLAY);
    renderRankList("versionList", data.versionInstalls);
    renderRolloutList(data.rollout);
    populateVersionFilter(data.versionInstalls, data.rollout);
    renderRankList("refList", data.downloadsByRef, { direct: "Direct / 无 ref" });
    const downloadLabels = {};
    for (const [file] of entries(data.downloadsByFile)) {
      if (UPDATE_ZIP_PATTERN.test(file)) downloadLabels[file] = `${file}（App 内更新）`;
    }
    renderRankList("downloadList", data.downloadsByFile, downloadLabels);

    const hasLegacy = Boolean(data.legacy && typeof data.legacy === "object");
    const anonymousNote = $("anonymousInstallsNote");
    if (anonymousNote) {
      anonymousNote.textContent = hasLegacy
        ? "按匿名编号去重后的电脑数，含 10-29 前旧服务器记录的安装"
        : "按匿名编号去重后的电脑数";
    }
    if (hasLegacy) {
      $("installGroupNote").textContent = "打开过 GravityPort 并发回匿名统计的电脑，按匿名编号去重；10-29 前旧服务器记录的安装已按匿名编号合并进来，同一台电脑只算一次。";
    }

    const legacyPvNote = $("legacyPageViewsNote");
    if (legacyPvNote) {
      legacyPvNote.hidden = !hasLegacy;
      if (hasLegacy) legacyPvNote.textContent = `另：10-29 前旧服务器记录 ${number.format(data.legacy.pageViews || 0)} 次（含爬虫）`;
    }
    const legacyHomeNote = $("legacyHomePageViewsNote");
    if (legacyHomeNote) {
      legacyHomeNote.hidden = !hasLegacy;
      if (hasLegacy) legacyHomeNote.textContent = `另：10-29 前旧服务器记录 ${number.format(data.legacy.homePageViews || 0)} 次（含爬虫）`;
    }
    const legacyDesktopNote = $("legacyDesktopNote");
    if (legacyDesktopNote) {
      legacyDesktopNote.hidden = !hasLegacy;
      if (hasLegacy) legacyDesktopNote.textContent = `另：10-29 前旧服务器 ${number.format(data.legacy.desktopDownloads || 0)} 次请求（分段每段都算）`;
    }
    const legacyUpdateNote = $("legacyUpdateNote");
    if (legacyUpdateNote) {
      legacyUpdateNote.hidden = !hasLegacy;
      if (hasLegacy) legacyUpdateNote.textContent = `另：10-29 前旧服务器 ${number.format(data.legacy.updateDownloads || 0)} 次请求（分段每段都算）`;
    }
    const legacyExtensionNote = $("legacyExtensionNote");
    if (legacyExtensionNote) {
      legacyExtensionNote.hidden = !hasLegacy;
      if (hasLegacy) legacyExtensionNote.textContent = `另：10-29 前旧服务器 ${number.format(data.legacy.extensionDownloads || 0)} 次请求（分段每段都算）`;
    }

    const legacyPanel = $("legacyDownloadPanel");
    if (legacyPanel) {
      legacyPanel.hidden = !hasLegacy;
      if (hasLegacy) {
        const legacyDownloadLabels = { other: "其他文件（非安装包）" };
        for (const [file] of entries(data.legacy.downloadsByFile)) {
          if (UPDATE_ZIP_PATTERN.test(file)) legacyDownloadLabels[file] = `${file}（App 内更新）`;
        }
        renderRankList("legacyDownloadList", data.legacy.downloadsByFile, legacyDownloadLabels);
        renderRankList("legacyRefList", data.legacy.downloadsByRef, { direct: "Direct / 无 ref" });
      }
    }

    renderTrend(data.daily);
    const generated = new Date(data.generatedAt);
    $("updatedAt").textContent = Number.isNaN(generated.getTime()) ? "更新时间未知" : `更新于 ${dateTime.format(generated)}`;
    const footer = $("statsFooter");
    const coverage = new Date(data.coverageStart);
    const coverageText = Number.isNaN(coverage.getTime()) ? "覆盖起点未知" : `趋势口径起点 ${dateTime.format(coverage)}`;
    const switchoverText = hasLegacy
      ? `2026-10-29 前为旧服务器数据（${data.legacy.coverageStart || "未知"}～${data.legacy.coverageEnd || "未知"}）：安装按匿名编号和新数据合并；页面访问含爬虫、下载按请求次数（分段每段都算），单独列出，没加进上面的总数；趋势图 10-29 前的线也是旧口径。`
      : "2026-10-29 起统计改由 Cloudflare 记录，此前旧服务器上的累计数没有导入。";
    footer.textContent = `统计日时区：${data.analyticsTimeZone || "unknown"} · ${coverageText} · ${switchoverText}下载为下载请求次数，分段下载只计一次（本次改动上线前的旧数据可能多算），不等同于独立下载人数；趋势图的下载线在旧数据段含 App 内更新（旧数据拆不开）。页面访问由官网边缘逐次记录，已排除爬虫，不是按钮点击；首页→下载 =（安装包下载 + 扩展下载）/ 首页访问。`;
    renderSiteTraffic(data);
  }

  function renderRolloutList(rollout) {
    const host = $("rolloutList");
    if (!host) return;
    host.replaceChildren();
    const rows = Array.isArray(rollout) ? rollout : [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "暂无数据";
      host.append(empty);
      return;
    }
    rows.forEach((item) => {
      const row = document.createElement("div");
      row.className = "rank-row rollout-row";
      const label = document.createElement("span");
      label.className = "rank-label rollout-label";
      const verStrong = document.createElement("strong");
      verStrong.textContent = item.version || "—";
      const firstDate = document.createElement("small");
      firstDate.className = "rollout-meta";
      firstDate.textContent = item.firstSeenAt !== null && item.firstSeenAt !== undefined
        ? `首次 ${formatPacificDate(item.firstSeenAt)}`
        : "记录前";
      label.append(verStrong, firstDate);

      const value = document.createElement("span");
      value.className = "rank-value rollout-value";
      const sharePct = Number.isFinite(Number(item.shareOfActive7d))
        ? `${number.format(Math.round(Number(item.shareOfActive7d) * 1000) / 10)}%`
        : "0%";
      value.textContent = `${number.format(Number(item.currentInstalls || 0))} 台 · 7日 ${sharePct}`;

      const track = document.createElement("div");
      track.className = "rank-track";
      const fill = document.createElement("span");
      fill.className = "rank-fill";
      const shareRatio = Math.max(0, Math.min(1, Number(item.shareOfActive7d) || 0));
      fill.style.width = shareRatio > 0 ? `${Math.max(2, shareRatio * 100)}%` : "0%";
      track.append(fill);

      row.append(label, value, track);
      host.append(row);
    });
  }

  function populateVersionFilter(versionInstalls, rollout) {
    if (!installVersionFilter) return;
    const currentVal = installVersionFilter.value;
    const versions = new Set();
    if (Array.isArray(rollout)) {
      rollout.forEach((r) => { if (r && r.version) versions.add(r.version); });
    }
    for (const [ver] of entries(versionInstalls)) {
      if (ver && ver !== "unknown") versions.add(ver);
    }
    installVersionFilter.replaceChildren();
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "全部版本";
    installVersionFilter.append(allOpt);
    for (const ver of versions) {
      const opt = document.createElement("option");
      opt.value = ver;
      opt.textContent = ver;
      installVersionFilter.append(opt);
    }
    if (currentVal && versions.has(currentVal)) {
      installVersionFilter.value = currentVal;
    }
  }

  function formatUpdateCell(item) {
    if (item.versionSince === null || item.versionSince === undefined) {
      return "记录前";
    }
    const dateStr = formatPacificDate(item.versionSince);
    if (item.previousVersion) {
      return `${item.previousVersion} → ${item.version}，${dateStr}`;
    }
    return dateStr;
  }

  async function copyInstallId(installId, button) {
    try {
      await navigator.clipboard.writeText(installId);
    } catch {
      const temp = document.createElement("input");
      temp.value = installId;
      document.body.append(temp);
      temp.select();
      document.execCommand("copy");
      temp.remove();
    }
    button.textContent = "已复制";
    window.setTimeout(() => { button.textContent = "复制"; }, 1400);
  }

  async function toggleInstallHistory(installId, mainRow, detailRow, detailHost) {
    if (!detailRow.hidden) {
      detailRow.hidden = true;
      mainRow.setAttribute("aria-expanded", "false");
      expandedHistoryIds.delete(installId);
      return;
    }
    detailRow.hidden = false;
    mainRow.setAttribute("aria-expanded", "true");
    expandedHistoryIds.add(installId);
    detailHost.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "history-loading";
    loading.textContent = "正在读取版本历史…";
    detailHost.append(loading);
    try {
      const response = await fetch(`./install-history.json?id=${encodeURIComponent(installId)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.replace("./login.html?expired=1");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      detailHost.replaceChildren();
      const versions = Array.isArray(data) ? data : (Array.isArray(data.versions) ? data.versions : []);
      if (!versions.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "暂无版本历史记录";
        detailHost.append(empty);
        return;
      }
      const list = document.createElement("div");
      list.className = "history-list";
      versions.forEach((v) => {
        const item = document.createElement("div");
        item.className = "history-item";
        const verTag = document.createElement("strong");
        verTag.className = "history-version";
        verTag.textContent = v.fromVersion ? `${v.fromVersion} → ${v.version}` : v.version;
        const timeTag = document.createElement("span");
        timeTag.className = "history-time";
        timeTag.textContent = v.firstSeenAt !== null && v.firstSeenAt !== undefined
          ? formatPacificDateTime(v.firstSeenAt)
          : "记录前";
        item.append(verTag, timeTag);
        list.append(item);
      });
      detailHost.append(list);
    } catch (error) {
      detailHost.replaceChildren();
      const err = document.createElement("div");
      err.className = "history-empty";
      err.textContent = `读取历史失败：${error?.message || error}`;
      detailHost.append(err);
    }
  }

  function renderInstallTable(data) {
    if (!installTableBody) return;
    installTableBody.replaceChildren();
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.installs) ? data.installs : []);
    installTotal = Number(data.total) || 0;
    installPage = Number(data.page) || 1;
    installPageSize = Number(data.pageSize) || 50;

    const totalPages = Math.max(1, Math.ceil(installTotal / installPageSize));
    if (installPageInfo) {
      installPageInfo.textContent = `共 ${number.format(installTotal)} 台 · 第 ${number.format(installPage)} / ${number.format(totalPages)} 页`;
    }
    if (installPrevPage) installPrevPage.disabled = installPage <= 1;
    if (installNextPage) installNextPage.disabled = installPage >= totalPages;

    if (!items.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "empty";
      td.textContent = "暂无匹配的安装记录";
      tr.append(td);
      installTableBody.append(tr);
      return;
    }

    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.className = "install-row";
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-expanded", "false");

      const tdId = document.createElement("td");
      tdId.className = "install-id-cell";
      const shortId = document.createElement("code");
      shortId.className = "install-short-id";
      shortId.title = item.installId;
      shortId.textContent = String(item.installId || "").slice(0, 8);
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "copy-id-button";
      copyBtn.textContent = "复制";
      copyBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void copyInstallId(item.installId, copyBtn);
      });
      tdId.append(shortId, copyBtn);

      const tdPlatform = document.createElement("td");
      const platLabel = PLATFORM_DISPLAY[item.platform] || item.platform || "—";
      tdPlatform.textContent = item.arch && item.arch !== "unknown" ? `${platLabel} (${item.arch})` : platLabel;

      const tdInstalled = document.createElement("td");
      tdInstalled.className = "tabular-cell";
      tdInstalled.textContent = formatPacificDateTime(item.firstSeenAt);

      const tdVersion = document.createElement("td");
      tdVersion.className = "version-cell";
      tdVersion.textContent = item.version || "—";

      const tdUpdated = document.createElement("td");
      tdUpdated.className = "tabular-cell";
      tdUpdated.textContent = formatUpdateCell(item);

      const tdLastSeen = document.createElement("td");
      tdLastSeen.className = "tabular-cell";
      tdLastSeen.textContent = formatPacificDateTime(item.lastSeenAt);

      const tdActive = document.createElement("td");
      tdActive.className = "tabular-cell";
      tdActive.textContent = `${number.format(Number(item.activeDays7 || 0))} / ${number.format(Number(item.activeDays30 || 0))} 天`;

      tr.append(tdId, tdPlatform, tdInstalled, tdVersion, tdUpdated, tdLastSeen, tdActive);

      const detailRow = document.createElement("tr");
      detailRow.className = "install-history-row";
      detailRow.hidden = true;
      const detailTd = document.createElement("td");
      detailTd.colSpan = 7;
      const detailHost = document.createElement("div");
      detailHost.className = "install-history-box";
      detailTd.append(detailHost);
      detailRow.append(detailTd);

      const handleToggle = () => {
        void toggleInstallHistory(item.installId, tr, detailRow, detailHost);
      };
      tr.addEventListener("click", handleToggle);
      tr.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleToggle();
        }
      });

      installTableBody.append(tr, detailRow);
      if (expandedHistoryIds.has(item.installId)) {
        void toggleInstallHistory(item.installId, tr, detailRow, detailHost);
      }
    });
  }

  async function loadInstalls() {
    if (!installTableBody) return;
    const params = new URLSearchParams();
    params.set("page", String(installPage));
    if (installVersionFilter && installVersionFilter.value) {
      params.set("version", installVersionFilter.value);
    }
    if (installPlatformFilter && installPlatformFilter.value) {
      params.set("platform", installPlatformFilter.value);
    }
    params.set("t", String(Date.now()));
    try {
      const response = await fetch(`./installs.json?${params}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("./login.html?expired=1");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderInstallTable(await response.json());
    } catch (error) {
      installTableBody.replaceChildren();
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "empty";
      td.textContent = `暂时读取不到 installs.json：${error?.message || error}`;
      tr.append(td);
      installTableBody.append(tr);
    }
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
      await loadInstalls();
    } catch (error) {
      errorNotice.textContent = `暂时读取不到 stats.json：${error?.message || error}`;
      errorNotice.hidden = false;
      $("updatedAt").textContent = "数据不可用";
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", loadStats);
  if (installVersionFilter) {
    installVersionFilter.addEventListener("change", () => {
      installPage = 1;
      void loadInstalls();
    });
  }
  if (installPlatformFilter) {
    installPlatformFilter.addEventListener("change", () => {
      installPage = 1;
      void loadInstalls();
    });
  }
  if (installPrevPage) {
    installPrevPage.addEventListener("click", () => {
      if (installPage > 1) {
        installPage -= 1;
        void loadInstalls();
      }
    });
  }
  if (installNextPage) {
    installNextPage.addEventListener("click", () => {
      installPage += 1;
      void loadInstalls();
    });
  }
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
