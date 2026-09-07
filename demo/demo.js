(function () {
  "use strict";

  const pageParams = new URLSearchParams(window.location.search);
  if (pageParams.get("embed") === "1") {
    document.documentElement.classList.add("embed-mode");
    document.body.classList.add("embed-mode");
    window.scrollTo(0, 0);
  }
  if (pageParams.get("preview") === "1") {
    document.documentElement.classList.add("preview-mode");
    document.body.classList.add("preview-mode");
  }
  let demoLocale = pageParams.get("lang") === "en" ? "en" : "";
  if (!demoLocale) {
    try {
      demoLocale = window.localStorage.getItem("mosa-site-locale") === "en" ? "en" : "zh";
    } catch {
      demoLocale = "zh";
    }
  }
  document.documentElement.lang = demoLocale === "en" ? "en" : "zh-CN";
  const L = (zh, en) => (demoLocale === "en" ? en : zh);

  function translateStaticDemoUi() {
    const textPairs = [
      ["产品导览", "Product tour"], ["返回官网", "Back to website"],
      ["不是截图。直接试。", "Not a screenshot. Try it."],
      ["这是一套基于当前 MOSA 桌面端信息架构制作的前端交互演示。所有素材、Prompt 与路径均为示例数据。", "A front-end interactive demo based on the current MOSA desktop information architecture. All assets, prompts and paths are sample data."],
      ["创作资产库", "Creative Library"], ["全部素材", "All assets"], ["收藏", "Favorites"],
      ["待整理", "To organize"], ["回收站", "Trash"], ["智能分组", "Smart groups"],
      ["ChatGPT 网页版", "ChatGPT Web"], ["Gemini 网页版", "Gemini Web"], ["素材分类", "Collections"],
      ["设置", "Settings"], ["全部", "All"], ["图片", "Images"], ["视频", "Videos"],
      ["排序", "Sort"], ["最新优先", "Newest first"], ["最旧优先", "Oldest first"], ["按名称", "Name"],
      ["导入素材", "Import assets"], ["没有找到素材", "No assets found"],
      ["换一个筛选条件或清空搜索。", "Try another filter or clear the search."], ["显示全部", "Show all"],
      ["已选", "Selected"], ["项", "items"], ["堆叠", "Stack"], ["移出堆叠", "Remove from stack"], ["全选", "Select all"], ["取消", "Cancel"],
      ["返回素材库", "Back to library"], ["适合窗口", "Fit"], ["素材信息", "Asset info"],
      ["选择一张素材", "Select an asset"], ["Prompt、来源、参考图和版本关系会在这里展开。", "Prompt, source, references and version history appear here."],
      ["外观", "Appearance"], ["主题", "Theme"], ["浅色", "Light"], ["深色", "Dark"],
      ["卡片密度", "Card density"], ["仅图片", "Images only"], ["显示信息", "Show info"],
      ["界面语言", "Interface language"], ["存储与数据", "Storage & data"], ["素材库位置", "Library location"],
      ["打开", "Open"], ["更改", "Change"], ["存储引擎", "Storage engine"], ["关于", "About"], ["版本", "Version"],
      ["退出", "Exit"], ["下一步", "Next"], ["完成", "Done"]
    ];
    const translatePair = (value, pairs) => {
      for (const [zh, en] of pairs) {
        if (value === zh || value === en) return demoLocale === "en" ? en : zh;
      }
      return null;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const raw = node.nodeValue || "";
      const trimmed = raw.trim();
      const translated = translatePair(trimmed, textPairs);
      if (!translated) return;
      node.nodeValue = raw.replace(trimmed, translated);
    });

    const attrPairs = [
      ["返回 MOSA 官网", "Back to MOSA website"], ["演示场景", "Demo scenarios"], ["素材库", "Library"],
      ["添加分组", "Add collection"], ["返回素材库", "Back to library"], ["类型筛选", "Type filters"],
      ["排序", "Sort"], ["搜索素材", "Search assets"], ["素材列表", "Asset list"], ["批量管理", "Bulk actions"],
      ["上一张素材", "Previous asset"], ["下一张素材", "Next asset"], ["图像缩放控制", "Image zoom controls"],
      ["缩小", "Zoom out"], ["放大", "Zoom in"], ["素材检视器", "Asset inspector"], ["关闭设置", "Close settings"]
    ];
    document.querySelectorAll("[aria-label]").forEach((node) => {
      const value = node.getAttribute("aria-label");
      const translated = translatePair(value, attrPairs);
      if (translated) node.setAttribute("aria-label", translated);
    });

    const languageRow = [...document.querySelectorAll(".settings-modal-row")].find((row) => {
      const title = row.querySelector("h4")?.textContent.trim();
      return title === "Interface language" || title === "界面语言";
    });
    const languageSegment = languageRow?.querySelector(".segmented");
    if (languageSegment) {
      const activeIndex = demoLocale === "en" ? 1 : 0;
      languageSegment.dataset.activeIndex = String(activeIndex);
      const buttons = [...languageSegment.querySelectorAll("button")];
      buttons.forEach((button, index) => button.classList.toggle("active", index === activeIndex));
    }
  }

  const sourceData = Array.isArray(window.MOSA_DEMO_DATA) ? window.MOSA_DEMO_DATA : [];
  const assets = sourceData.map((asset) => ({ ...asset, versions: (asset.versions || []).map((version) => ({ ...version })) }));
  const stacks = [
    {
      id: "stack-001",
      label: "Future Visuals",
      coverId: "asset-001",
      memberIds: ["asset-001", "asset-004", "asset-007"],
    },
  ];
  const DEMO_VIDEO_SRC = "data:video/mp4;base64,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";

  const state = {
    filter: "all",
    group: "",
    type: "all",
    search: "",
    sort: "newest",
    selectedId: null,
    selectedStackId: null,
    currentVersionByAsset: new Map(),
    viewerOpen: false,
    zoom: 1,
    density: "image",
    multiSelected: new Set(),
    activeStackId: null,
    stackMatchCounts: new Map(),
    captureAdded: false,
    tourIndex: -1,
  };

  const appFrame = document.querySelector("[data-app-frame]");
  const app = document.querySelector("#demoApp");
  const grid = document.querySelector("[data-grid]");
  const emptyState = document.querySelector("[data-empty]");
  const detail = document.querySelector("[data-detail]");
  const detailHeaderLabel = document.querySelector("[data-detail-header-label]");
  const detailEmpty = document.querySelector("[data-detail-empty]");
  const detailContent = document.querySelector("[data-detail-content]");
  const detailScroll = document.querySelector("[data-detail-scroll]");
  const libraryView = document.querySelector("[data-library-view]");
  const viewerView = document.querySelector("[data-viewer-view]");
  const viewerArt = document.querySelector("[data-viewer-art]");
  const viewerPosition = document.querySelector("[data-viewer-position]");
  const viewerScope = document.querySelector("[data-viewer-scope]");
  const zoomValue = document.querySelector("[data-zoom-value]");
  const selectionBar = document.querySelector("[data-selection-bar]");
  const selectionCount = document.querySelector("[data-selection-count]");
  const stackBack = document.querySelector("[data-stack-back]");
  const stackButton = document.querySelector("[data-stack-selected]");
  const removeFromStackButton = document.querySelector("[data-remove-from-stack]");
  const settingsModal = document.querySelector("[data-settings-modal]");
  const searchInput = document.querySelector("[data-search]");
  const sortSelect = document.querySelector("[data-sort]");
  const viewTitle = document.querySelector("[data-view-title]");
  const stackCount = document.querySelector("[data-stack-count]");
  const focusRing = document.querySelector("[data-focus-ring]");
  const tourCard = document.querySelector("[data-tour-card]");
  const toast = document.querySelector("[data-toast]");
  const scenarioButtons = [...document.querySelectorAll("[data-scenario]")];
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  const groupButtons = [...document.querySelectorAll("[data-group]")];
  const typeButtons = [...document.querySelectorAll("[data-type]")];
  let toastTimer = 0;

  const applyScenarioLabels = () => {
    scenarioButtons.forEach((button) => {
      const label = demoLocale === "en" ? button.dataset.labelEn : button.dataset.labelZh;
      if (label) button.textContent = label;
    });
  };

  const captureUiScrollState = () => {
    const settingsBody = settingsModal?.querySelector(".settings-modal-body");
    const sidebar = document.querySelector(".sidebar");
    const viewerStage = document.querySelector(".viewer-stage");
    return {
      pageX: window.scrollX,
      pageY: window.scrollY,
      appTop: appFrame?.scrollTop || 0,
      appLeft: appFrame?.scrollLeft || 0,
      gridTop: grid?.scrollTop || 0,
      gridLeft: grid?.scrollLeft || 0,
      detailTop: detailScroll?.scrollTop || 0,
      detailLeft: detailScroll?.scrollLeft || 0,
      sidebarTop: sidebar?.scrollTop || 0,
      settingsTop: settingsBody?.scrollTop || 0,
      viewerTop: viewerStage?.scrollTop || 0,
      viewerLeft: viewerStage?.scrollLeft || 0,
    };
  };

  const restoreUiScrollState = (snapshot) => {
    if (!snapshot) return;
    const settingsBody = settingsModal?.querySelector(".settings-modal-body");
    const sidebar = document.querySelector(".sidebar");
    const viewerStage = document.querySelector(".viewer-stage");
    window.scrollTo(snapshot.pageX, snapshot.pageY);
    if (appFrame) { appFrame.scrollTop = snapshot.appTop; appFrame.scrollLeft = snapshot.appLeft; }
    if (grid) { grid.scrollTop = snapshot.gridTop; grid.scrollLeft = snapshot.gridLeft; }
    if (detailScroll) { detailScroll.scrollTop = snapshot.detailTop; detailScroll.scrollLeft = snapshot.detailLeft; }
    if (sidebar) sidebar.scrollTop = snapshot.sidebarTop;
    if (settingsBody) settingsBody.scrollTop = snapshot.settingsTop;
    if (viewerStage) { viewerStage.scrollTop = snapshot.viewerTop; viewerStage.scrollLeft = snapshot.viewerLeft; }
  };

  const setDemoLocale = (locale) => {
    const nextLocale = locale === "en" ? "en" : "zh";
    if (nextLocale === demoLocale) return;
    const scrollSnapshot = captureUiScrollState();
    demoLocale = nextLocale;
    document.documentElement.lang = demoLocale === "en" ? "en" : "zh-CN";
    translateStaticDemoUi();
    applyScenarioLabels();
    render();

    // Re-rendering localized Inspector markup must not move the user's view.
    // Restore once immediately and again after layout settles.
    restoreUiScrollState(scrollSnapshot);
    window.requestAnimationFrame(() => {
      restoreUiScrollState(scrollSnapshot);
      window.requestAnimationFrame(() => restoreUiScrollState(scrollSnapshot));
    });
    window.setTimeout(() => restoreUiScrollState(scrollSnapshot), 80);
  };

  translateStaticDemoUi();
  applyScenarioLabels();

  const tourSteps = [
    {
      kicker: "01 / LIBRARY",
      title: L("从真实图库结构开始。", "Start with a real library structure."),
      copy: L("左侧导航、顶部筛选与中央瀑布流都按当前 MOSA 的桌面端信息架构重建。", "The sidebar, top filters and masonry library follow the current MOSA desktop information architecture."),
      target: () => grid,
      prepare: () => runScenario("library", { silent: true }),
    },
    {
      kicker: "02 / CAPTURE",
      title: L("素材进入 MOSA。", "Bring an asset into MOSA."),
      copy: L("这里用前端动画模拟一次收录。官网以后可以把真实 Web Capture 流程接到同一套演示里。", "This front-end animation simulates a capture. The same demo can later connect to the real Web Capture flow."),
      target: () => document.querySelector("[data-capture]"),
      prepare: () => runScenario("capture", { silent: true }),
    },
    {
      kicker: "03 / FIND",
      title: L("搜索和筛选不会离开工作区。", "Search and filter without leaving the workspace."),
      copy: L("搜索、类型筛选、智能分组与素材分类都直接作用于同一个本地图库视图。", "Search, type filters, smart groups and collections all work in the same local library view."),
      target: () => searchInput,
      prepare: () => {
        closeViewer();
        resetFilters();
        searchInput.value = "blue";
        state.search = "blue";
        render();
      },
    },
    {
      kicker: "04 / ORGANIZE",
      title: L("整理不是移动文件。", "Organizing is more than moving files."),
      copy: L("多选、堆叠、智能来源分组和自定义素材分类都发生在同一个图库里。", "Multi-select, stacks, smart source groups and custom collections all live in one library."),
      target: () => selectionBar,
      prepare: () => runScenario("organize", { silent: true }),
    },
    {
      kicker: "05 / STACKS",
      title: L("相关素材可以折叠成一个堆叠。", "Collapse related assets into a stack."),
      copy: L("根图库只显示封面和数量；打开后进入堆叠内部，可继续搜索、多选并把素材移出。", "The root library shows only a cover and count. Open the stack to search, multi-select and remove assets."),
      target: () => grid,
      prepare: () => runScenario("stacks", { silent: true }),
    },
    {
      kicker: "06 / CONTEXT",
      title: L("一张图不只剩一个文件。", "An image should keep more than the file."),
      copy: L("选择素材后，Inspector 会展开 Prompt、来源、参考图、标签与文件位置。", "Select an asset and the Inspector reveals its Prompt, source, references, tags and file location."),
      target: () => detail,
      prepare: () => {
        runScenario("context", { silent: true });
      },
    },
    {
      kicker: "07 / PROMPT",
      title: L("Prompt 与参考关系一起留下。", "Keep Prompt and reference relationships together."),
      copy: L("演示数据不会伪造真实来源，但会完整表现 MOSA 目前的上下文信息层级。", "Sample data does not pretend to be real provenance, but it shows MOSA's current context hierarchy in full."),
      target: () => detailScroll.querySelector('[data-section="prompt"]'),
      prepare: () => {
        runScenario("context", { silent: true });
        requestAnimationFrame(() => scrollInspectorSection("prompt"));
      },
    },
    {
      kicker: "08 / VERSIONS",
      title: L("版本不是复制粘贴。", "Versions are not copy and paste."),
      copy: L("切换 v1、v2、v3 时，预览和 Prompt 会一起变化，历史节点仍保留在同一个素材上下文里。", "Switching v1, v2 and v3 updates both preview and Prompt while keeping the history in one asset context."),
      target: () => detailScroll.querySelector('[data-section="versions"]'),
      prepare: () => {
        selectAsset("asset-007");
        requestAnimationFrame(() => scrollInspectorSection("versions"));
      },
    },
    {
      kicker: "09 / VIEWER",
      title: L("最后进入专用查看模式。", "Finish in a dedicated Viewer."),
      copy: L("大图、上一张下一张、缩放和 Fit 都在独立 Viewer 中完成，右侧上下文仍然保留。", "Full-size viewing, previous/next, zoom and Fit all happen in a dedicated Viewer while the context remains available."),
      target: () => document.querySelector(".viewer-stage"),
      prepare: () => {
        runScenario("viewer", { silent: true });
      },
    },
    {
      kicker: "10 / SETTINGS",
      title: L("设置也是产品的一部分。", "Settings are part of the product too."),
      copy: L("主题、卡片密度、语言和本地素材库位置都使用与当前 MOSA 一致的偏好设置结构。", "Theme, card density, language and local library location use the same preference structure as MOSA."),
      target: () => document.querySelector(".settings-modal-card"),
      prepare: () => runScenario("settings", { silent: true }),
    },
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(demoLocale === "en" ? "en-US" : "zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function getAssetById(id) {
    return assets.find((asset) => asset.id === id) || null;
  }

  function getStackById(id) {
    return stacks.find((stack) => stack.id === id) || null;
  }

  function stackForAsset(id) {
    return stacks.find((stack) => stack.memberIds.includes(id)) || null;
  }

  function rootStackForCover(id) {
    if (state.activeStackId) return null;
    return stacks.find((stack) => stack.coverId === id && stack.memberIds.length > 1) || null;
  }

  function currentVersion(asset) {
    const versions = asset?.versions || [];
    if (!versions.length) return null;
    const saved = state.currentVersionByAsset.get(asset.id);
    return versions.find((version) => version.label === saved) || versions.at(-1);
  }

  function assetMatchesCurrentFilters(asset, { insideStack = false } = {}) {
    const query = state.search.trim().toLowerCase();
    if (!insideStack) {
      if (state.filter === "favorite" && !asset.favorite) return false;
      if (state.filter === "unorganized" && !asset.unorganized) return false;
      if (state.filter === "trash" && !asset.trash) return false;
      if (state.filter !== "trash" && state.filter !== "all" && asset.trash) return false;
      if (state.filter === "all" && asset.trash) return false;
      if (state.group) {
        const [kind, value] = state.group.split(":");
        if (kind === "source" && asset.source !== value) return false;
        if (kind === "category" && asset.category !== value) return false;
        if (kind === "group" && asset.group !== value) return false;
      }
    } else if (asset.trash) {
      return false;
    }
    if (state.type !== "all" && asset.type !== state.type) return false;
    if (!query) return true;
    const haystack = [asset.name, asset.source, asset.category, asset.group, asset.prompt, ...(asset.tags || [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  function visibleAssets() {
    const activeStack = getStackById(state.activeStackId);
    if (activeStack) {
      return activeStack.memberIds
        .map(getAssetById)
        .filter(Boolean)
        .filter((asset) => assetMatchesCurrentFilters(asset, { insideStack: true }));
    }

    state.stackMatchCounts.clear();
    const stackedMemberIds = new Set(stacks.flatMap((stack) => stack.memberIds));
    const list = assets.filter((asset) => !stackedMemberIds.has(asset.id) && assetMatchesCurrentFilters(asset));
    stacks.forEach((stack) => {
      const matchedMembers = stack.memberIds
        .map(getAssetById)
        .filter(Boolean)
        .filter((asset) => assetMatchesCurrentFilters(asset));
      if (!matchedMembers.length) return;
      const cover = getAssetById(stack.coverId) || matchedMembers[0];
      state.stackMatchCounts.set(stack.id, matchedMembers.length);
      list.push(cover);
    });

    return [...list].sort((a, b) => {
      if (state.sort === "name") return a.name.localeCompare(b.name, "zh-CN");
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return state.sort === "oldest" ? diff : -diff;
    });
  }

  function updateCounts() {
    const normal = assets.filter((asset) => !asset.trash);
    const values = {
      all: normal.length,
      favorite: normal.filter((asset) => asset.favorite).length,
      unorganized: normal.filter((asset) => asset.unorganized).length,
      trash: assets.filter((asset) => asset.trash).length,
    };
    Object.entries(values).forEach(([key, value]) => {
      const node = document.querySelector(`[data-count="${key}"]`);
      if (node) node.textContent = String(value);
    });
    document.querySelectorAll("[data-group-count]").forEach((node) => {
      const key = node.getAttribute("data-group-count");
      const [kind, value] = key.split(":");
      const count = normal.filter((asset) => {
        if (kind === "source") return asset.source === value;
        if (kind === "category") return asset.category === value;
        if (kind === "group") return asset.group === value;
        return false;
      }).length;
      node.textContent = String(count);
    });
  }

  function cardMarkup(asset) {
    const favoriteClass = asset.favorite ? " is-active" : "";
    const selectedClass = asset.id === state.selectedId ? " selected" : "";
    const multiClass = state.multiSelected.has(asset.id) ? " multi-selected" : "";
    const stack = rootStackForCover(asset.id);
    const stackClass = stack ? " is-stack" : "";
    const stackMatchCount = stack ? Number(state.stackMatchCounts.get(stack.id) || stack.memberIds.length) : 0;
    const stackCount = stack ? stack.memberIds.length : 0;
    const stackBadge = stack
      ? `<span class="asset-stack-count" aria-hidden="true">${stackMatchCount > 0 && stackMatchCount < stackCount ? `${stackMatchCount}/${stackCount}` : stackCount}</span>`
      : "";
    const media = asset.type === "video"
      ? `<video class="asset-card-video" src="${DEMO_VIDEO_SRC}" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>`
      : `<span class="asset-card-art ${escapeHtml(asset.art)}"></span>`;
    const videoBadge = asset.type === "video"
      ? '<span class="video-badge" aria-hidden="true"><span>VIDEO</span></span>'
      : "";
    const newBadge = asset.isNew ? '<span class="new-badge">NEW CAPTURE</span>' : "";
    return `
      <article class="asset-card${selectedClass}${multiClass}${stackClass}" data-card="${escapeHtml(asset.id)}"${stack ? ` data-stack-id="${escapeHtml(stack.id)}"` : ""}>
        <button class="asset-card-button" type="button" data-select="${escapeHtml(asset.id)}"${stack ? ` data-open-stack="${escapeHtml(stack.id)}"` : ""} aria-label="${stack ? L(`选择 ${escapeHtml(stack.label)}，堆叠，共 ${stackCount} 项`, `Select ${escapeHtml(stack.label)}, stack, ${stackCount} items`) : L(`查看 ${escapeHtml(asset.name)}`, `View ${escapeHtml(asset.name)}`)}">
          ${media}
          ${stackBadge}
          ${videoBadge}
          ${newBadge}
          <span class="card-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.2 3.2 7.8-8" /></svg></span>
        </button>
        <span class="asset-card-actions"${stack ? " hidden" : ""}>
          <button class="card-action favorite${favoriteClass}" type="button" data-favorite="${escapeHtml(asset.id)}" aria-label="${asset.favorite ? L("取消收藏", "Remove from favorites") : L("收藏", "Favorite")}">
            <svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
          </button>
        </span>
        <span class="asset-card-info"><strong>${escapeHtml(stack?.label || asset.name)}</strong><small>${stack ? L(`${stackCount} 项 · 堆叠`, `${stackCount} items · Stack`) : `${escapeHtml(asset.source)} · ${escapeHtml(formatDate(asset.createdAt))}`}</small></span>
      </article>`;
  }

  function layoutCards() {
    requestAnimationFrame(() => {
      grid.querySelectorAll(".asset-card").forEach((card) => {
        const asset = getAssetById(card.getAttribute("data-card"));
        if (!asset) return;
        const width = card.getBoundingClientRect().width;
        if (!width) return;
        const mediaHeight = Math.max(108, width / Math.max(0.46, asset.ratio || 1));
        const infoHeight = state.density === "info" ? 40 : 0;
        const totalHeight = mediaHeight + infoHeight;
        const button = card.querySelector(".asset-card-button");
        if (button) button.style.height = `${Math.round(mediaHeight)}px`;
        card.style.height = `${Math.round(totalHeight)}px`;
        card.style.gridRowEnd = `span ${Math.ceil((totalHeight + 12) / 8)}`;
      });
    });
  }

  function renderGrid() {
    const list = visibleAssets();
    grid.innerHTML = list.map(cardMarkup).join("");
    grid.dataset.density = state.density;
    emptyState.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    layoutCards();
    updateViewer();
  }

  function inspectorMarkup(asset) {
    const version = currentVersion(asset);
    const art = version?.art || asset.art;
    const prompt = version?.prompt || asset.prompt;
    const versionOptions = (asset.versions || [])
      .map((item) => `<option value="${escapeHtml(item.label)}"${item.label === version?.label ? " selected" : ""}>${escapeHtml(item.label)} · ${escapeHtml(item.time || "")}</option>`)
      .join("");
    const referenceMarkup = (asset.references || []).length
      ? `<div class="reference-row">${asset.references.map((ref) => `<span class="reference-thumb ${escapeHtml(ref)}" title="${L("示例参考图", "Sample reference")}"></span>`).join("")}</div>`
      : `<p style="margin:8px 0 0;color:var(--text-3);font-size:10px">${L("未记录参考图", "No references recorded")}</p>`;
    const historyMarkup = [...(asset.versions || [])].reverse().map((item, index) => `
      <div class="history-item"><b>${escapeHtml(item.label)}${index === 0 ? L(" · 当前", " · Current") : ""}</b>${escapeHtml(item.time || "")} · ${L("Prompt 已关联", "Prompt linked")}</div>`).join("");
    const factTags = [asset.type === "video" ? "MP4" : "PNG", asset.type === "video" ? "16:9" : "3:4", asset.group || L("未分组", "Ungrouped")]
      .map((value) => `<span class="detail-fact-tag">${escapeHtml(value)}</span>`).join("");
    const previewMedia = asset.type === "video"
      ? `<video class="detail-preview-video" src="${DEMO_VIDEO_SRC}" autoplay muted loop playsinline preload="auto" aria-label="${escapeHtml(asset.name)} ${L("视频预览", "video preview")}"></video>`
      : `<span class="detail-preview-art ${escapeHtml(art)}"></span>`;

    return `
      <section class="inspector-section overview-section" data-section="overview">
        <div class="detail-overview-heading"><h3>${L("基础信息", "Basic information")}</h3><p>${escapeHtml(asset.source)} · ${escapeHtml(formatDate(asset.createdAt))}</p></div>
        <button class="detail-preview" type="button" data-open-viewer aria-label="${L("查看", "View")} ${escapeHtml(asset.name)} ${asset.type === "video" ? L("视频", "video") : L("大图", "full image")}" style="aspect-ratio:${Number(asset.ratio || 1)}">${previewMedia}</button>
        <div class="detail-overview-title-row"><h3>${escapeHtml(asset.name)}</h3><button class="detail-favorite${asset.favorite ? " is-fav" : ""}" type="button" data-detail-favorite>${asset.favorite ? L("已收藏", "Favorited") : L("收藏", "Favorite")}</button></div>
        <div class="detail-facts">${factTags}</div>
      </section>
      <section class="inspector-section" data-section="tags">
        <div class="tag-row"><span class="tag source-tag">${escapeHtml(asset.source)}</span>${(asset.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}<button class="tag-add" type="button" data-demo-toast="${L("演示模式不会写入真实标签。", "Demo mode does not write real tags.")}">+ ${L("标签", "Tag")}</button></div>
      </section>
      <section class="inspector-section" data-section="prompt">
        <div class="section-head"><h3>${L("提示词", "Prompt")}</h3><button class="section-copy" type="button" data-copy-prompt aria-label="${L("复制提示词", "Copy prompt")}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button></div>
        <div class="prompt-box">${escapeHtml(prompt)}</div>
        <div class="user-instruction"><label>${L("用户指令", "User instruction")}</label><p>${escapeHtml(asset.userInstruction || L("未记录", "Not recorded"))}</p></div>
        <div class="user-instruction"><label>${L("参考图", "References")}</label>${referenceMarkup}</div>
      </section>
      <section class="inspector-section" data-section="source">
        <div class="section-head"><h3>${L("来源信息", "Source information")}</h3></div>
        <dl class="meta-list">
          <div class="meta-row"><dt>${L("来源", "Source")}</dt><dd>${escapeHtml(asset.sourceDetail || asset.source)}</dd></div>
          <div class="meta-row"><dt>${L("模型 / 工具", "Model / Tool")}</dt><dd>${escapeHtml(asset.model || "—")}</dd></div>
          <div class="meta-row"><dt>${L("类型", "Type")}</dt><dd>${asset.type === "video" ? L("视频", "Video") : L("图片", "Image")}</dd></div>
          <div class="meta-row"><dt>${L("创建时间", "Created")}</dt><dd>${escapeHtml(formatDate(asset.createdAt))}</dd></div>
        </dl>
      </section>
      <section class="inspector-section" data-section="versions">
        <div class="section-head"><h3>${L("版本", "Versions")}</h3><button class="text-action" type="button" data-demo-toast="${L("真实 MOSA 中可从当前上下文继续创建新版本。", "In MOSA, you can create a new version from the current context.")}">${L("新版本", "New version")}</button></div>
        <select class="version-select" data-version-select aria-label="${L("选择版本", "Select version")}">${versionOptions}</select>
        <div class="history-list">${historyMarkup}</div>
      </section>
      <section class="inspector-section" data-section="group">
        <div class="section-head"><h3>${L("分组", "Groups")}</h3></div>
        <div class="tag-row"><span class="tag">${escapeHtml(asset.group || L("未分组", "Ungrouped"))}</span><span class="tag">${escapeHtml(asset.category || L("其他", "Other"))}</span></div>
      </section>
      <section class="inspector-section" data-section="location">
        <div class="section-head"><h3>${L("文件位置", "File location")}</h3></div>
        <div class="path-box">${escapeHtml(asset.path || "—")}</div>
      </section>`;
  }

  function renderInspector() {
    const asset = getAssetById(state.selectedId);
    const stack = !state.activeStackId && state.selectedStackId ? getStackById(state.selectedStackId) : null;
    const shouldOpen = Boolean(asset || stack);
    app.classList.toggle("details-open", shouldOpen);
    detailEmpty.hidden = shouldOpen;
    detailContent.hidden = !shouldOpen;
    if (stack) {
      detailHeaderLabel.textContent = demoLocale === "en" ? "Stack inspector" : "堆叠检视器";
      const members = stack.memberIds.map(getAssetById).filter(Boolean);
      detailScroll.innerHTML = `<section class="stack-inspector" data-stack-inspector>
        <div class="stack-inspector-grid">${members.map((member, index) => {
          const media = member.type === "video"
            ? `<video class="stack-inspector-video" src="${DEMO_VIDEO_SRC}" autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>`
            : `<span class="stack-inspector-art ${escapeHtml(member.art)}"></span>`;
          return `<div class="stack-inspector-member" title="${escapeHtml(member.name)}"><div class="stack-inspector-thumb">${media}</div><span>${index + 1}</span></div>`;
        }).join("")}</div>
      </section>`;
      layoutCards();
      return;
    }
    detailHeaderLabel.textContent = demoLocale === "en" ? "Asset info" : "素材信息";
    if (!asset) {
      detailScroll.innerHTML = "";
      return;
    }
    detailScroll.innerHTML = inspectorMarkup(asset);
    layoutCards();
  }

  function renderSelectionBar() {
    const count = state.multiSelected.size;
    selectionBar.hidden = count === 0;
    selectionCount.textContent = String(count);
    stackButton.hidden = Boolean(state.activeStackId);
    removeFromStackButton.hidden = !state.activeStackId;
  }

  function updateActiveControls() {
    filterButtons.forEach((button) => {
      const active = !state.group && button.dataset.filter === state.filter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    groupButtons.forEach((button) => button.classList.toggle("active", button.dataset.group === state.group));
    typeButtons.forEach((button) => {
      const active = button.dataset.type === state.type;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    sortSelect.value = state.sort;
    sortSelect.disabled = Boolean(state.activeStackId);
    if (searchInput.value !== state.search) searchInput.value = state.search;
    searchInput.placeholder = state.activeStackId ? L("搜索此堆叠...", "Search this stack...") : L("搜索所有素材...", "Search all assets...");
    stackBack.hidden = !state.activeStackId;
    stackCount.hidden = !state.activeStackId;
    const titles = {
      all: L("全部素材", "All assets"),
      favorite: L("收藏", "Favorites"),
      unorganized: L("待整理", "To organize"),
      trash: L("回收站", "Trash"),
    };
    if (state.activeStackId) {
      const stack = getStackById(state.activeStackId);
      viewTitle.textContent = stack?.label || L("堆叠", "Stack");
      stackCount.textContent = stack ? L(`${stack.memberIds.length} 项`, `${stack.memberIds.length} items`) : "";
    } else if (state.group) {
      const [, value] = state.group.split(":");
      viewTitle.textContent = value;
      stackCount.textContent = "";
    } else {
      viewTitle.textContent = titles[state.filter] || L("全部素材", "All assets");
      stackCount.textContent = "";
    }
  }

  function render() {
    updateCounts();
    updateActiveControls();
    renderGrid();
    renderInspector();
    renderSelectionBar();
  }

  function selectAsset(id) {
    if (!getAssetById(id)) return;
    state.selectedStackId = null;
    state.selectedId = id;
    state.viewerOpen = false;
    libraryView.hidden = false;
    viewerView.hidden = true;
    render();
    requestAnimationFrame(() => {
      const card = grid.querySelector(`[data-card="${CSS.escape(id)}"]`);
      if (!card) return;
      const cardTop = card.offsetTop;
      const cardBottom = cardTop + card.offsetHeight;
      const viewTop = grid.scrollTop;
      const viewBottom = viewTop + grid.clientHeight;
      if (cardTop < viewTop || cardBottom > viewBottom) {
        grid.scrollTo({ top: Math.max(0, cardTop - 16), behavior: "smooth" });
      }
    });
  }

  function clearSelection() {
    state.selectedId = null;
    state.selectedStackId = null;
    state.multiSelected.clear();
    state.viewerOpen = false;
    libraryView.hidden = false;
    viewerView.hidden = true;
    render();
  }

  function setMultiSelection(ids) {
    state.multiSelected = new Set(ids.filter((id) => getAssetById(id)));
    state.selectedId = null;
    state.selectedStackId = null;
    render();
  }

  function clearMultiSelection() {
    state.multiSelected.clear();
    render();
  }

  function openStack(stackId, { silent = false } = {}) {
    const stack = getStackById(stackId);
    if (!stack || stack.memberIds.length < 2) return;
    closeViewer();
    state.activeStackId = stack.id;
    state.filter = "all";
    state.group = "";
    state.type = "all";
    state.search = "";
    state.selectedId = null;
    state.selectedStackId = null;
    state.multiSelected.clear();
    searchInput.value = "";
    render();
    grid.scrollTop = 0;
    if (!silent) showToast(L(`已打开堆叠 · ${stack.memberIds.length} 项`, `Stack opened · ${stack.memberIds.length} items`));
  }

  function exitStack({ silent = false } = {}) {
    if (!state.activeStackId) return;
    state.activeStackId = null;
    resetFilters();
    state.selectedId = null;
    state.selectedStackId = null;
    state.multiSelected.clear();
    render();
    if (!silent) showToast(L("已返回素材库", "Back to library"));
  }

  function createStackFromSelection() {
    const ids = [...state.multiSelected].filter((id) => getAssetById(id));
    if (ids.length < 2) {
      showToast(L("至少选择 2 个素材才能堆叠", "Select at least 2 assets to create a stack"));
      return;
    }
    if (ids.some((id) => stackForAsset(id))) {
      showToast(L("已有堆叠中的素材不能再次嵌套堆叠", "Assets already in a stack cannot be nested again"));
      return;
    }
    const first = getAssetById(ids[0]);
    const stack = {
      id: `stack-${String(stacks.length + 1).padStart(3, "0")}`,
      label: first?.group || first?.category || first?.name || L("素材堆叠", "Asset stack"),
      coverId: ids[0],
      memberIds: ids,
    };
    stacks.push(stack);
    state.multiSelected.clear();
    state.selectedId = null;
    state.selectedStackId = null;
    render();
    showToast(L(`已堆叠 ${ids.length} 项素材`, `${ids.length} assets stacked`));
  }

  function removeSelectedFromActiveStack() {
    const stack = getStackById(state.activeStackId);
    if (!stack || !state.multiSelected.size) return;
    const removing = new Set(state.multiSelected);
    const removedCount = stack.memberIds.filter((id) => removing.has(id)).length;
    stack.memberIds = stack.memberIds.filter((id) => !removing.has(id));
    if (removing.has(stack.coverId)) stack.coverId = stack.memberIds[0] || "";
    state.multiSelected.clear();
    state.selectedId = null;
    state.selectedStackId = null;

    if (stack.memberIds.length < 2) {
      const index = stacks.findIndex((item) => item.id === stack.id);
      if (index >= 0) stacks.splice(index, 1);
      state.activeStackId = null;
      resetFilters();
      render();
      showToast(L("堆叠已自动解散，素材保持不变", "Stack dissolved automatically; assets are unchanged"));
      return;
    }
    render();
    showToast(L(`已从堆叠移出 ${removedCount} 项素材`, `${removedCount} assets removed from stack`));
  }

  function toggleFavorite(id) {
    const asset = getAssetById(id);
    if (!asset) return;
    asset.favorite = !asset.favorite;
    showToast(asset.favorite ? L("已加入收藏", "Added to favorites") : L("已取消收藏", "Removed from favorites"));
    render();
  }

  function resetFilters() {
    state.filter = "all";
    state.group = "";
    state.type = "all";
    state.search = "";
    state.sort = "newest";
    searchInput.value = "";
    sortSelect.value = "newest";
  }

  function closeViewer() {
    state.viewerOpen = false;
    state.zoom = 1;
    libraryView.hidden = false;
    viewerView.hidden = true;
    updateZoom();
  }

  function openViewer() {
    if (!getAssetById(state.selectedId)) return;
    state.viewerOpen = true;
    state.zoom = 1;
    libraryView.hidden = true;
    viewerView.hidden = false;
    updateViewer();
    updateZoom();
  }

  function updateViewer() {
    if (!state.viewerOpen) return;
    const list = visibleAssets();
    let index = list.findIndex((asset) => asset.id === state.selectedId);
    if (index < 0 && list.length) {
      state.selectedId = list[0].id;
      index = 0;
      renderInspector();
    }
    const asset = list[index];
    if (!asset) {
      closeViewer();
      return;
    }
    const version = currentVersion(asset);
    viewerArt.className = `viewer-art${asset.type === "video" ? " is-video" : ` ${version?.art || asset.art}`}`;
    viewerArt.innerHTML = asset.type === "video"
      ? `<video class="viewer-video" src="${DEMO_VIDEO_SRC}" autoplay muted loop playsinline controls preload="auto"></video>`
      : "";
    viewerPosition.textContent = `${index + 1} / ${list.length}`;
    viewerScope.textContent = viewTitle.textContent || L("全部素材", "All assets");
    const prev = document.querySelector("[data-viewer-prev]");
    const next = document.querySelector("[data-viewer-next]");
    prev.disabled = index <= 0;
    next.disabled = index >= list.length - 1;
  }

  function moveViewer(direction) {
    const list = visibleAssets();
    const index = list.findIndex((asset) => asset.id === state.selectedId);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    state.selectedId = list[nextIndex].id;
    state.zoom = 1;
    renderInspector();
    updateViewer();
    updateZoom();
  }

  function updateZoom() {
    state.zoom = Math.min(2, Math.max(0.5, state.zoom));
    viewerArt.style.transform = `scale(${state.zoom})`;
    zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setVersion(label) {
    const asset = getAssetById(state.selectedId);
    if (!asset) return;
    state.currentVersionByAsset.set(asset.id, label);
    renderInspector();
    updateViewer();
    showToast(L(`已切换到 ${label}`, `Switched to ${label}`));
  }

  async function copyPrompt() {
    const asset = getAssetById(state.selectedId);
    if (!asset) return;
    const prompt = currentVersion(asset)?.prompt || asset.prompt || "";
    try {
      await navigator.clipboard.writeText(prompt);
      showToast(L("Prompt 已复制", "Prompt copied"));
    } catch {
      showToast(L("当前浏览器不允许自动复制", "This browser does not allow automatic copying"));
    }
  }

  function addCapturedAsset() {
    if (state.captureAdded) return assets.find((asset) => asset.id === "asset-013") || null;
    const asset = {
      id: "asset-013",
      name: "Captured Blue Material",
      type: "img",
      art: "art-15",
      ratio: 0.9,
      favorite: false,
      unorganized: true,
      trash: false,
      source: "ChatGPT",
      sourceDetail: "ChatGPT · Web Capture",
      model: "GPT Image",
      category: "Reference",
      group: "",
      createdAt: new Date().toISOString(),
      tags: ["New", "Capture", "Blue"],
      prompt: "Minimal blue-violet material study captured from a web generation session, clean surface, compact lighting, reference-ready composition.",
      userInstruction: "Keep only the generated result and its available page-scoped context.",
      references: [],
      path: "$HOME/MOSA Library/2026/09/captured-blue-material.png",
      isNew: true,
      versions: [{ label: "v1", art: "art-15", time: "now", prompt: "Minimal blue-violet material study captured from a web generation session, clean surface, compact lighting, reference-ready composition." }],
    };
    assets.unshift(asset);
    state.captureAdded = true;
    return asset;
  }

  function simulateCapture({ silent = false } = {}) {
    closeViewer();
    state.activeStackId = null;
    resetFilters();
    const asset = addCapturedAsset();
    render();
    requestAnimationFrame(() => {
      const card = grid.querySelector(`[data-card="${CSS.escape(asset.id)}"]`);
      if (card) grid.scrollTo({ top: Math.max(0, card.offsetTop - 16), behavior: "smooth" });
      window.setTimeout(() => {
        state.selectedId = asset.id;
        render();
        if (!silent) showToast(L("已模拟一次 Web Capture 收录", "Web Capture import simulated"));
      }, 260);
    });
  }

  function scrollInspectorSection(name) {
    const section = detailScroll.querySelector(`[data-section="${CSS.escape(name)}"]`);
    if (!section) return;
    detailScroll.scrollTo({ top: Math.max(0, section.offsetTop - 8), behavior: "smooth" });
  }

  function runScenario(name, { silent = false } = {}) {
    scenarioButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.scenario === name));
    if (name === "capture") {
      simulateCapture({ silent });
      return;
    }
    if (name === "library") {
      closeViewer();
      state.activeStackId = null;
      resetFilters();
      state.multiSelected.clear();
      state.selectedId = null;
      state.selectedStackId = null;
      render();
      if (!silent) showToast(L("Library：浏览、筛选与搜索", "Library: browse, filter and search"));
      return;
    }
    if (name === "organize") {
      closeViewer();
      state.activeStackId = null;
      resetFilters();
      setMultiSelection(["asset-002", "asset-006", "asset-009"]);
      if (!silent) showToast(L("Organize：多选、分组与堆叠", "Organize: multi-select, groups and stacks"));
      return;
    }
    if (name === "stacks") {
      if (state.activeStackId) exitStack({ silent: true });
      resetFilters();
      state.multiSelected.clear();
      const stack = getStackById("stack-001");
      state.selectedId = stack?.coverId || null;
      state.selectedStackId = stack?.id || null;
      render();
      if (!silent) showToast(L("堆叠：单击查看成员，双击进入堆叠", "Stacks: click to inspect, double-click to open"));
      return;
    }
    if (name === "context") {
      state.activeStackId = null;
      resetFilters();
      selectAsset("asset-002");
      requestAnimationFrame(() => scrollInspectorSection("prompt"));
      if (!silent) showToast(L("Context：Prompt、来源与参考图", "Context: Prompt, source and references"));
      return;
    }
    if (name === "versions") {
      resetFilters();
      openStack("stack-001", { silent: true });
      selectAsset("asset-007");
      requestAnimationFrame(() => scrollInspectorSection("versions"));
      if (!silent) showToast(L("Versions：切换历史版本", "Versions: switch through history"));
      return;
    }
    if (name === "viewer") {
      state.activeStackId = null;
      resetFilters();
      selectAsset("asset-002");
      openViewer();
      if (!silent) showToast(L("Viewer：大图查看与缩放", "Viewer: full-size viewing and zoom"));
      return;
    }
    if (name === "settings") {
      closeViewer();
      state.activeStackId = null;
      resetFilters();
      state.multiSelected.clear();
      state.selectedId = null;
      state.selectedStackId = null;
      render();
      settingsModal.hidden = false;
      if (!silent) showToast(L("Settings：外观、密度与本地存储", "Settings: appearance, density and local storage"));
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function positionTour() {
    if (state.tourIndex < 0) return;
    const step = tourSteps[state.tourIndex];
    const target = step?.target?.();
    if (!target) {
      focusRing.hidden = true;
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = 6;
    focusRing.hidden = false;
    focusRing.style.top = `${Math.max(6, rect.top - pad)}px`;
    focusRing.style.left = `${Math.max(6, rect.left - pad)}px`;
    focusRing.style.width = `${Math.max(20, Math.min(window.innerWidth - 12, rect.width + pad * 2))}px`;
    focusRing.style.height = `${Math.max(20, Math.min(window.innerHeight - 12, rect.height + pad * 2))}px`;

    const cardWidth = 318;
    const cardHeight = Math.max(220, tourCard.offsetHeight || 240);
    let left = rect.right + 18;
    if (left + cardWidth > window.innerWidth - 16) left = rect.left - cardWidth - 18;
    left = Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16));
    let top = rect.top + Math.min(28, rect.height * 0.16);
    if (top + cardHeight > window.innerHeight - 16) top = window.innerHeight - cardHeight - 16;
    top = Math.max(16, top);
    tourCard.style.left = `${left}px`;
    tourCard.style.top = `${top}px`;
  }

  function renderTourStep() {
    if (state.tourIndex < 0) return;
    const step = tourSteps[state.tourIndex];
    step.prepare?.();
    tourCard.hidden = false;
    document.querySelector("[data-tour-index]").textContent = String(state.tourIndex + 1).padStart(2, "0");
    document.querySelector("[data-tour-total]").textContent = String(tourSteps.length).padStart(2, "0");
    document.querySelector("[data-tour-kicker]").textContent = step.kicker;
    document.querySelector("[data-tour-title]").textContent = step.title;
    document.querySelector("[data-tour-copy]").textContent = step.copy;
    document.querySelector("[data-tour-next]").textContent = state.tourIndex === tourSteps.length - 1 ? L("完成", "Done") : L("下一步", "Next");
    window.setTimeout(positionTour, 280);
  }

  function startTour() {
    state.tourIndex = 0;
    renderTourStep();
  }

  function nextTour() {
    if (state.tourIndex < 0) return;
    if (state.tourIndex >= tourSteps.length - 1) {
      stopTour();
      showToast(L("导览完成。现在可以自由探索 MOSA。 ", "Tour complete. You can now explore MOSA freely."));
      return;
    }
    state.tourIndex += 1;
    renderTourStep();
  }

  function stopTour() {
    state.tourIndex = -1;
    tourCard.hidden = true;
    focusRing.hidden = true;
  }

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStackId = null;
      state.filter = button.dataset.filter;
      state.group = "";
      state.search = "";
      searchInput.value = "";
      clearSelection();
    });
  });

  groupButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeStackId = null;
      state.group = button.dataset.group;
      state.filter = "all";
      state.search = "";
      searchInput.value = "";
      clearSelection();
    });
  });

  typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.type = button.dataset.type;
      state.selectedId = null;
      state.selectedStackId = null;
      render();
    });
  });

  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    state.selectedId = null;
    state.selectedStackId = null;
    render();
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    renderGrid();
  });

  grid.addEventListener("click", (event) => {
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      event.stopPropagation();
      toggleFavorite(favorite.dataset.favorite);
      return;
    }
    const select = event.target.closest("[data-select]");
    if (select) {
      if (event.detail > 1) return;
      const stackId = select.dataset.openStack;
      if (stackId && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
        state.multiSelected.clear();
        state.selectedId = select.dataset.select;
        state.selectedStackId = stackId;
        render();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        const id = select.dataset.select;
        if (state.multiSelected.has(id)) state.multiSelected.delete(id);
        else state.multiSelected.add(id);
        state.selectedId = null;
        state.selectedStackId = null;
        render();
      } else {
        state.multiSelected.clear();
        selectAsset(select.dataset.select);
      }
    }
  });

  grid.addEventListener("dblclick", (event) => {
    const select = event.target.closest("[data-select]");
    if (!select) return;
    event.stopPropagation();
    const stackId = select.dataset.openStack;
    if (stackId && !state.activeStackId) {
      openStack(stackId);
      return;
    }
    selectAsset(select.dataset.select);
    openViewer();
  });

  detail.addEventListener("click", (event) => {
    const toastButton = event.target.closest("[data-demo-toast]");
    if (toastButton) {
      showToast(toastButton.dataset.demoToast);
      return;
    }
    if (event.target.closest("[data-open-viewer]")) openViewer();
    if (event.target.closest("[data-copy-prompt]")) copyPrompt();
    if (event.target.closest("[data-detail-favorite]")) toggleFavorite(state.selectedId);
  });

  detail.addEventListener("change", (event) => {
    const select = event.target.closest("[data-version-select]");
    if (select) setVersion(select.value);
  });

  stackBack.addEventListener("click", () => exitStack());
  document.querySelector("[data-select-all]").addEventListener("click", () => setMultiSelection(visibleAssets().map((asset) => asset.id)));
  document.querySelector("[data-clear-multi]").addEventListener("click", clearMultiSelection);
  stackButton.addEventListener("click", createStackFromSelection);
  removeFromStackButton.addEventListener("click", removeSelectedFromActiveStack);
  document.querySelector("[data-reset]").addEventListener("click", () => {
    resetFilters();
    clearSelection();
  });
  document.querySelector("[data-capture]").addEventListener("click", () => simulateCapture());
  document.querySelector("[data-viewer-close]").addEventListener("click", closeViewer);
  document.querySelector("[data-viewer-prev]").addEventListener("click", () => moveViewer(-1));
  document.querySelector("[data-viewer-next]").addEventListener("click", () => moveViewer(1));
  document.querySelector("[data-zoom-in]").addEventListener("click", () => { state.zoom += 0.1; updateZoom(); });
  document.querySelector("[data-zoom-out]").addEventListener("click", () => { state.zoom -= 0.1; updateZoom(); });
  document.querySelector("[data-zoom-fit]").addEventListener("click", () => { state.zoom = 1; updateZoom(); });
  document.querySelector("[data-settings-open]").addEventListener("click", () => { settingsModal.hidden = false; });
  document.querySelector("[data-settings-close]").addEventListener("click", () => { settingsModal.hidden = true; });
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) settingsModal.hidden = true;
  });
  document.querySelectorAll("[data-appearance]").forEach((button) => {
    button.addEventListener("click", () => {
      const dark = button.dataset.appearance === "dark";
      document.documentElement.dataset.demoTheme = dark ? "dark" : "light";
      const segment = document.querySelector("[data-theme-segment]");
      segment.dataset.activeIndex = dark ? "1" : "0";
      segment.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  document.querySelectorAll("[data-density]").forEach((button) => {
    button.addEventListener("click", () => {
      state.density = button.dataset.density;
      const segment = document.querySelector("[data-density-segment]");
      segment.dataset.activeIndex = state.density === "info" ? "1" : "0";
      segment.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      renderGrid();
    });
  });
  document.querySelectorAll("[data-sidebar-section-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.sidebarSectionToggle;
      const list = document.querySelector(`[data-sidebar-section="${CSS.escape(name)}"]`);
      const expanded = button.getAttribute("aria-expanded") !== "false";
      button.setAttribute("aria-expanded", String(!expanded));
      list.hidden = expanded;
    });
  });
  document.querySelectorAll("[data-demo-toast]").forEach((button) => {
    if (button.closest("[data-detail]")) return;
    button.addEventListener("click", () => showToast(button.dataset.demoToast));
  });

  scenarioButtons.forEach((button) => button.addEventListener("click", () => runScenario(button.dataset.scenario)));
  document.querySelector("[data-tour-start]").addEventListener("click", startTour);
  document.querySelector("[data-tour-next]").addEventListener("click", nextTour);
  document.querySelector("[data-tour-exit]").addEventListener("click", stopTour);

  window.addEventListener("resize", () => {
    layoutCards();
    positionTour();
  });
  window.addEventListener("scroll", positionTour, { passive: true });
  appFrame.addEventListener("scroll", positionTour, { passive: true });
  detailScroll.addEventListener("scroll", () => window.setTimeout(positionTour, 0), { passive: true });
  grid.addEventListener("scroll", () => window.setTimeout(positionTour, 0), { passive: true });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.tourIndex >= 0) {
        stopTour();
        return;
      }
      if (!settingsModal.hidden) {
        settingsModal.hidden = true;
        return;
      }
      if (state.viewerOpen) {
        closeViewer();
        return;
      }
      if (state.selectedId) clearSelection();
    }
    if (state.viewerOpen && event.key === "ArrowLeft") moveViewer(-1);
    if (state.viewerOpen && event.key === "ArrowRight") moveViewer(1);
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== "mosa-demo:set-locale") return;
    setDemoLocale(event.data.locale);
  });

  render();
  const initialScenario = pageParams.get("scenario");
  const validScenarios = new Set(scenarioButtons.map((button) => button.dataset.scenario));
  if (initialScenario && validScenarios.has(initialScenario)) {
    window.setTimeout(() => runScenario(initialScenario, { silent: true }), 0);
  } else {
    scenarioButtons.find((button) => button.dataset.scenario === "library")?.classList.add("is-active");
  }
  if (pageParams.get("tour") === "1") window.setTimeout(startTour, 120);
})();
