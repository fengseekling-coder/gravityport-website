(function () {
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat("zh-CN");
  const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
  const refreshButton = $("refreshButton");
  const errorNotice = $("errorNotice");
  let refreshTimer = null;

  function setMetric(id, value) {
    $(id).textContent = Number.isFinite(Number(value)) ? number.format(Number(value)) : "—";
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
    const values = rows.flatMap((row) => [row.firstLaunches || 0, row.activeInstalls || 0, row.downloadRequests || 0]);
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
    [["firstLaunches", "installs"], ["activeInstalls", "active"], ["downloadRequests", "downloads"]].forEach(([key, className]) => {
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
    setMetric("anonymousInstalls", data.anonymousInstalls);
    setMetric("firstLaunches", data.reportedFirstLaunches);
    setMetric("dau", data.dau24h);
    setMetric("wau", data.wau7d);
    setMetric("mau", data.mau30d);
    setMetric("downloads", data.totalDownloadRequests);
    renderRankList("platformList", data.platformInstalls, { darwin: "macOS", win32: "Windows" });
    renderRankList("versionList", data.versionInstalls);
    renderRankList("refList", data.downloadsByRef, { direct: "Direct / 无 ref" });
    renderRankList("downloadList", data.downloadsByFile);
    renderTrend(data.daily);
    const generated = new Date(data.generatedAt);
    $("updatedAt").textContent = Number.isNaN(generated.getTime()) ? "更新时间未知" : `更新于 ${dateTime.format(generated)}`;
  }

  async function loadStats() {
    refreshButton.disabled = true;
    errorNotice.hidden = true;
    try {
      const response = await fetch(`./stats.json?t=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
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
  void loadStats();
  refreshTimer = window.setInterval(loadStats, 60_000);
  window.addEventListener("pagehide", () => window.clearInterval(refreshTimer), { once: true });
})();
