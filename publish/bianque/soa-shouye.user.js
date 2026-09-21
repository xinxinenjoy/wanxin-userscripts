// ==UserScript==
// @name         扁鹊-1.1首页模块排序
// @namespace    https://tampermonkey.net/
// @version      4.7
// @description  SOA首页模块排序：支持网页原始顺序/脚本排序两种图标方案，并支持拖拽保存、列数、模块宽度及列间距设置。

// @match        *://*home.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-shouye
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-shouye.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-shouye.user.js
// ==/UserScript==

/*
 * 更新记录
 *测试1测试2
 * v4.7  -  2026-9-5
 * - “布局”面板增加两种图标顺序方案：网页原始顺序 / 脚本排序。
 * - 网页原始顺序按当前网页首次渲染顺序显示，不写入、不覆盖脚本已保存的自定义排序。
 * - 脚本排序继续沿用原有预设顺序及拖拽后本地保存的顺序；切换方案会自动保存。
 * - 网页原始顺序下关闭拖拽排序，避免无意改变脚本排序记录；其他布局参数保持原逻辑。
 *
 * v4.5  -  2026-8-29
 * - 更新：测试版本
 *
 */

(function () {
  "use strict";

  /* =========================================================
   * 1. 默认配置
   * ========================================================= */

  // 首次使用时采用此顺序。
  // 后续在页面拖拽后的顺序会自动保存到浏览器本地，
  // 不需要再打开控制台复制，也不需要再回来修改脚本。
  const DEFAULT_ORDER = [
    "权限管理",
    "星辰(CRM)",
    "前台管理",
    "蝶美系统",
    "SOA3-扁鹊",
    "低代码报表系统",
    "预约管理中心",
    "报告中心",
    "商品中心",
    "扁鹊基础配置",
    "导检中心",
    "检验",
    "重要异常",
    "检查",
    "店面管理-工程管理",
    "报告质控",
    "自助机",
    "门店管理",
    "主检中心",
    "客服管理中心",
    "检后管理",
    "特殊项目确认",
    "慧眼",
    "全国单主检",
    "星图",
    "星羽",
    "德晟投保",
    "内部运营管理",
    "主检",
    "客户全旅程运营"
  ];

  const DEFAULT_COLUMNS = 5;
  const MIN_COLUMNS = 4;
  const MAX_COLUMNS = 8;

  // 模块显示尺寸
  const DEFAULT_CARD_WIDTH = 260;
  const MIN_CARD_WIDTH = 220;
  const MAX_CARD_WIDTH = 420;

  const DEFAULT_COLUMN_GAP = 12;
  const MIN_COLUMN_GAP = 4;
  const MAX_COLUMN_GAP = 48;

  const DEFAULT_ROW_GAP = 14;

  const ORDER_MODE = {
    ORIGINAL: "original",
    SCRIPT: "script"
  };

  // 继续沿用 v4.0 的 key。
  // 因此如果你已经用上一版排过顺序，新版会直接继承。
  const STORAGE = {
    order: "__soa_app_order_v4",
    columns: "__soa_app_columns_v4",
    buttonPos: "__soa_control_button_pos_v4",
    cardWidth: "__soa_app_card_width_v45",
    columnGap: "__soa_app_column_gap_v45",
    orderMode: "__soa_app_order_mode_v47"
  };

  const IDS = {
    style: "__soa_layout_style",
    button: "__soa_layout_button",
    panel: "__soa_layout_panel",
    columns: "__soa_columns_select",
    cardWidth: "__soa_card_width_input",
    columnGap: "__soa_column_gap_input",
    sortSwitch: "__soa_sort_switch",
    orderModeOriginal: "__soa_order_mode_original",
    orderModeScript: "__soa_order_mode_script",
    status: "__soa_layout_status"
  };

  const CLS = {
    row: "__soa_grid_row",
    sortable: "__soa_sortable",
    draggingSource: "__soa_dragging_source",
    placeholder: "__soa_drag_placeholder",
    ghost: "__soa_drag_ghost",
    movingButton: "__soa_moving"
  };

  /* =========================================================
   * 2. 运行状态
   * ========================================================= */

  let sortEnabled = false;
  let applying = false;
  let applyTimer = null;
  let rowEventsBoundTo = null;

  // 自定义拖拽状态
  let dragState = null;

  // pointerdown 后先进入“待起拖”状态。
  // 移动超过阈值后才真正开始拖拽，避免轻微抖动就触发排序。
  let pendingDrag = null;

  // pointermove 用 requestAnimationFrame 合并，
  // 避免高刷新率鼠标一帧触发多次 DOM 重排。
  let dragMoveRAF = 0;
  let latestMoveEvent = null;

  let suppressNextClick = false;

  // 仅记录当前页面生命周期中的网站原始顺序，不写入本地存储。
  const originalOrderSnapshots = new Map();

  const DRAG_ACTIVATION_DISTANCE = 8;

  // 网格锁定：
  // 拖动中心进入某个 Grid 槽位后，只触发一次移动。
  // 只要中心仍在同一个槽位里，就不再重复判定。
  const GRID_SLOT_HYSTERESIS = 4;

  /* =========================================================
   * 3. localStorage 安全封装
   * ========================================================= */

  function storageGet(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      console.warn("[SOA布局] localStorage读取失败：", e);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn("[SOA布局] localStorage写入失败：", e);
      return false;
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("[SOA布局] localStorage删除失败：", e);
    }
  }

  function getSavedOrder() {
    try {
      const raw = storageGet(STORAGE.order, "");
      if (!raw) return [...DEFAULT_ORDER];

      const arr = JSON.parse(raw);
      if (!Array.isArray(arr) || !arr.length) return [...DEFAULT_ORDER];

      return arr.filter(v => typeof v === "string" && v.trim());
    } catch {
      return [...DEFAULT_ORDER];
    }
  }

  function getSavedColumns() {
    const n = Number(storageGet(STORAGE.columns, DEFAULT_COLUMNS));

    // v4.0 曾经允许 2 / 3 列。
    // 新版最低 4 列，旧设置如果是 2 / 3 会自动回到 4 列。
    if (Number.isInteger(n) && n >= MIN_COLUMNS && n <= MAX_COLUMNS) {
      return n;
    }

    return DEFAULT_COLUMNS;
  }


  function getSavedOrderMode() {
    const value = storageGet(
      STORAGE.orderMode,
      ORDER_MODE.SCRIPT
    );

    return value === ORDER_MODE.ORIGINAL
      ? ORDER_MODE.ORIGINAL
      : ORDER_MODE.SCRIPT;
  }

  function getSavedCardWidth() {
    const n = Number(
      storageGet(
        STORAGE.cardWidth,
        DEFAULT_CARD_WIDTH
      )
    );

    if (
      Number.isFinite(n) &&
      n >= MIN_CARD_WIDTH &&
      n <= MAX_CARD_WIDTH
    ) {
      return Math.round(n);
    }

    return DEFAULT_CARD_WIDTH;
  }

  function getSavedColumnGap() {
    const n = Number(
      storageGet(
        STORAGE.columnGap,
        DEFAULT_COLUMN_GAP
      )
    );

    if (
      Number.isFinite(n) &&
      n >= MIN_COLUMN_GAP &&
      n <= MAX_COLUMN_GAP
    ) {
      return Math.round(n);
    }

    return DEFAULT_COLUMN_GAP;
  }

  /* =========================================================
   * 4. 页面元素定位
   * ========================================================= */

  function getRow() {
    const rows = Array.from(document.querySelectorAll(".ivu-row"));

    return (
      rows.find(row =>
        Array.from(row.children).some(child =>
          child.querySelector?.(".app-card .app-name, .app-name")
        )
      ) || null
    );
  }

  function getCols(row = getRow()) {
    if (!row) return [];

    return Array.from(row.children).filter(el =>
      !el.classList.contains(CLS.placeholder) &&
      el.querySelector?.(".app-card .app-name, .app-name")
    );
  }

  function getName(col) {
    return col?.querySelector(".app-name")?.innerText?.trim() || "";
  }

  /* =========================================================
   * 5. 左对齐固定宽度网格布局
   * ========================================================= */

  function applyGridLayout() {
    const row = getRow();
    if (!row) return;

    const columns = getSavedColumns();
    const cardWidth = getSavedCardWidth();
    const columnGap = getSavedColumnGap();

    row.classList.add(CLS.row);

    // 核心变化：
    // 不再 repeat(columns, minmax(0, 1fr)) 均分整行。
    // 改成固定宽度列，从左开始排列。
    row.style.setProperty(
      "grid-template-columns",
      `repeat(${columns}, ${cardWidth}px)`,
      "important"
    );

    row.style.setProperty(
      "justify-content",
      "start",
      "important"
    );

    row.style.setProperty(
      "column-gap",
      `${columnGap}px`,
      "important"
    );

    row.style.setProperty(
      "row-gap",
      `${DEFAULT_ROW_GAP}px`,
      "important"
    );

    getCols(row).forEach(col => {
      col.style.setProperty("width", `${cardWidth}px`, "important");
      col.style.setProperty("max-width", `${cardWidth}px`, "important");
      col.style.setProperty("flex", "none", "important");
      col.style.setProperty("box-sizing", "border-box", "important");

      const card = col.querySelector(".app-card");
      if (card) {
        card.style.setProperty("width", "100%", "important");
        card.style.setProperty("max-width", "none", "important");
        card.style.setProperty("box-sizing", "border-box", "important");
      }
    });

    updateControlButtonText();
  }

  function setColumns(columns) {
    const n = Number(columns);

    if (
      !Number.isInteger(n) ||
      n < MIN_COLUMNS ||
      n > MAX_COLUMNS
    ) {
      return;
    }

    storageSet(STORAGE.columns, String(n));
    applyGridLayout();
    showStatus(`每行最多显示 ${n} 列`);
  }

  function setCardWidth(width) {
    let n = Number(width);
    if (!Number.isFinite(n)) return;

    n = Math.round(
      Math.max(
        MIN_CARD_WIDTH,
        Math.min(MAX_CARD_WIDTH, n)
      )
    );

    storageSet(
      STORAGE.cardWidth,
      String(n)
    );

    const input =
      document.getElementById(
        IDS.cardWidth
      );

    if (input) {
      input.value = String(n);
    }

    applyGridLayout();
    showStatus(`模块宽度已设为 ${n}px`);
  }

  function setColumnGap(gap) {
    let n = Number(gap);
    if (!Number.isFinite(n)) return;

    n = Math.round(
      Math.max(
        MIN_COLUMN_GAP,
        Math.min(MAX_COLUMN_GAP, n)
      )
    );

    storageSet(
      STORAGE.columnGap,
      String(n)
    );

    const input =
      document.getElementById(
        IDS.columnGap
      );

    if (input) {
      input.value = String(n);
    }

    applyGridLayout();
    showStatus(`列间距已设为 ${n}px`);
  }

  /* =========================================================
   * 6. 排序保存与恢复
   * ========================================================= */

  // 当前页面可能是“全部”，也可能是“管理类 / 销售类”等部分分类。
  // 只显示部分模块时，只修改这些模块彼此的相对位置，
  // 不覆盖完整排序记录。
  function mergeVisibleOrder(visibleNames) {
    const currentSaved = getSavedOrder();
    const visibleSet = new Set(visibleNames);

    const result = [];
    let visibleIndex = 0;

    for (const name of currentSaved) {
      if (visibleSet.has(name)) {
        if (visibleIndex < visibleNames.length) {
          result.push(visibleNames[visibleIndex++]);
        }
      } else {
        result.push(name);
      }
    }

    // 新增模块或从未记录过的模块补到末尾
    for (const name of visibleNames) {
      if (!result.includes(name)) {
        result.push(name);
      }
    }

    return result;
  }

  function getVisibleOrderKey(names) {
    return [...names]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .join("\u001f");
  }

  function captureOriginalOrder(row = getRow()) {
    const names = getCols(row)
      .map(getName)
      .filter(Boolean);

    if (!names.length) return [];

    const key = getVisibleOrderKey(names);

    if (!originalOrderSnapshots.has(key)) {
      originalOrderSnapshots.set(
        key,
        [...names]
      );

      console.log(
        "[SOA布局] 已记录网页原始顺序：",
        names
      );
    }

    return (
      originalOrderSnapshots.get(key) ||
      [...names]
    );
  }

  function getOriginalOrder(row = getRow()) {
    const names = getCols(row)
      .map(getName)
      .filter(Boolean);

    if (!names.length) return [];

    const key = getVisibleOrderKey(names);

    return (
      originalOrderSnapshots.get(key) ||
      captureOriginalOrder(row)
    );
  }

  function restoreOriginalOrder() {
    const row = getRow();
    const cols = getCols(row);

    if (!row || !cols.length) return;

    const originalOrder =
      getOriginalOrder(row);

    const rank = new Map(
      originalOrder.map(
        (name, index) => [name, index]
      )
    );

    cols
      .map((col, index) => ({
        col,
        index,
        name: getName(col)
      }))
      .sort((a, b) => {
        const aKnown = rank.has(a.name);
        const bKnown = rank.has(b.name);

        if (aKnown && bKnown) {
          return rank.get(a.name) - rank.get(b.name);
        }

        if (aKnown) return -1;
        if (bKnown) return 1;
        return a.index - b.index;
      })
      .forEach(item =>
        row.appendChild(item.col)
      );
  }

  function isOriginalOrderApplied() {
    const row = getRow();
    const names = getCols(row)
      .map(getName)
      .filter(Boolean);

    if (!names.length) return true;

    const originalOrder =
      getOriginalOrder(row);

    return (
      names.length === originalOrder.length &&
      names.every(
        (name, index) =>
          name === originalOrder[index]
      )
    );
  }

  function saveCurrentOrder() {
    const names = getCols().map(getName).filter(Boolean);
    if (!names.length) return;

    const merged = mergeVisibleOrder(names);
    storageSet(STORAGE.order, JSON.stringify(merged));

    showStatus(`排序已自动保存，共 ${names.length} 个当前模块`);
    console.log("[SOA布局] 排序已自动保存：", merged);
  }

  function restoreOrder() {
    const row = getRow();
    const cols = getCols(row);
    if (!row || !cols.length) return;

    const savedOrder = getSavedOrder();
    const rank = new Map(savedOrder.map((name, index) => [name, index]));

    const indexed = cols.map((col, index) => ({
      col,
      index,
      name: getName(col)
    }));

    indexed.sort((a, b) => {
      const aKnown = rank.has(a.name);
      const bKnown = rank.has(b.name);

      if (aKnown && bKnown) {
        return rank.get(a.name) - rank.get(b.name);
      }

      if (aKnown) return -1;
      if (bKnown) return 1;

      // 两个都是系统后来新增的模块时，保持网站原始顺序
      return a.index - b.index;
    });

    indexed.forEach(item => row.appendChild(item.col));
  }

  function isOrderApplied() {
    const names = getCols().map(getName).filter(Boolean);
    if (!names.length) return true;

    const savedOrder = getSavedOrder();
    const rank = new Map(savedOrder.map((name, index) => [name, index]));

    const expected = names
      .map((name, index) => ({ name, index }))
      .sort((a, b) => {
        const aKnown = rank.has(a.name);
        const bKnown = rank.has(b.name);

        if (aKnown && bKnown) {
          return rank.get(a.name) - rank.get(b.name);
        }

        if (aKnown) return -1;
        if (bKnown) return 1;

        return a.index - b.index;
      })
      .map(item => item.name);

    return names.every((name, index) => name === expected[index]);
  }

  function resetToDefaultOrder() {
    storageSet(
      STORAGE.order,
      JSON.stringify(DEFAULT_ORDER)
    );

    storageSet(
      STORAGE.orderMode,
      ORDER_MODE.SCRIPT
    );

    sortEnabled = false;
    restoreOrder();
    applyGridLayout();
    updateSortableState();
    updateOrderModeUi();
    showStatus("已恢复脚本预设顺序");
  }

  /* =========================================================
   * 7. 排序状态
   * ========================================================= */

  function updateOrderModeUi() {
    const mode = getSavedOrderMode();

    const originalButton =
      document.getElementById(
        IDS.orderModeOriginal
      );

    const scriptButton =
      document.getElementById(
        IDS.orderModeScript
      );

    originalButton?.classList.toggle(
      "__soa_mode_active",
      mode === ORDER_MODE.ORIGINAL
    );

    scriptButton?.classList.toggle(
      "__soa_mode_active",
      mode === ORDER_MODE.SCRIPT
    );

    const checkbox =
      document.getElementById(
        IDS.sortSwitch
      );

    const switchWrap =
      checkbox?.closest(
        ".__soa_switch"
      );

    if (checkbox) {
      const disabled =
        mode === ORDER_MODE.ORIGINAL;

      checkbox.disabled = disabled;

      if (disabled) {
        checkbox.checked = false;
      }
    }

    if (switchWrap) {
      switchWrap.style.opacity =
        mode === ORDER_MODE.ORIGINAL
          ? "0.45"
          : "1";

      switchWrap.title =
        mode === ORDER_MODE.ORIGINAL
          ? "网页原始顺序下不启用拖拽排序"
          : "";
    }
  }

  function setOrderMode(mode) {
    const nextMode =
      mode === ORDER_MODE.ORIGINAL
        ? ORDER_MODE.ORIGINAL
        : ORDER_MODE.SCRIPT;

    if (dragState) {
      finishDrag(
        nextMode === ORDER_MODE.SCRIPT
      );
    } else if (pendingDrag) {
      cancelPendingDrag(
        pendingDrag.pointerId
      );
    }

    if (
      nextMode ===
      ORDER_MODE.ORIGINAL
    ) {
      sortEnabled = false;
    }

    storageSet(
      STORAGE.orderMode,
      nextMode
    );

    if (
      nextMode ===
      ORDER_MODE.ORIGINAL
    ) {
      restoreOriginalOrder();
    } else {
      restoreOrder();
    }

    applyGridLayout();
    updateSortableState();
    updateOrderModeUi();

    showStatus(
      nextMode === ORDER_MODE.ORIGINAL
        ? "已切换：网页原始顺序"
        : "已切换：脚本排序"
    );
  }

  function updateSortableState() {
    const scriptMode =
      getSavedOrderMode() ===
      ORDER_MODE.SCRIPT;

    getCols().forEach(col => {
      if (
        sortEnabled &&
        scriptMode
      ) {
        col.classList.add(CLS.sortable);
        col.style.cursor = "grab";
      } else {
        col.classList.remove(CLS.sortable, CLS.draggingSource);
        col.style.cursor = "";
      }
    });

    updateControlButtonText();
  }

  function setSortEnabled(enabled) {
    if (
      enabled &&
      getSavedOrderMode() !==
        ORDER_MODE.SCRIPT
    ) {
      sortEnabled = false;
      updateSortableState();
      updateOrderModeUi();
      showStatus(
        "请先切换到“脚本排序”再拖拽"
      );
      return;
    }

    sortEnabled = Boolean(enabled);

    if (!sortEnabled && pendingDrag) {
      try {
        pendingDrag.source.releasePointerCapture?.(
          pendingDrag.pointerId
        );
      } catch {
        // 忽略
      }
      pendingDrag = null;
    }

    if (!sortEnabled && dragState) {
      finishDrag(false);
    }

    updateSortableState();

    const checkbox =
      document.getElementById(
        IDS.sortSwitch
      );

    if (checkbox) {
      checkbox.checked =
        sortEnabled &&
        getSavedOrderMode() ===
          ORDER_MODE.SCRIPT;
    }

    updateOrderModeUi();

    if (sortEnabled) {
      showStatus("排序已开启，拖动卡片后自动保存");
    } else {
      if (
        getSavedOrderMode() ===
        ORDER_MODE.SCRIPT
      ) {
        saveCurrentOrder();
      }

      showStatus("排序已关闭");
      scheduleApply();
    }
  }

  /* =========================================================
   * 8. 网格槽位锁定拖拽核心
   * ========================================================= */

  function distanceFromStart(e, pending) {
    const dx = e.clientX - pending.startX;
    const dy = e.clientY - pending.startY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function startDrag(source, e, pending) {
    if (!sortEnabled || dragState || !source) return;

    const row = getRow();
    if (!row || !row.contains(source)) return;

    const rect = source.getBoundingClientRect();

    const ghost = source.cloneNode(true);
    ghost.classList.remove(
      CLS.sortable,
      CLS.draggingSource
    );
    ghost.classList.add(CLS.ghost);

    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = "0";
    ghost.style.zIndex = "100002";
    ghost.style.pointerEvents = "none";

    const placeholder = document.createElement("div");
    placeholder.className = CLS.placeholder;
    placeholder.style.height = `${rect.height}px`;

    // placeholder 取代原卡片的唯一 Grid 位置
    row.insertBefore(placeholder, source);

    source.classList.add(CLS.draggingSource);
    source.style.setProperty("display", "none", "important");

    document.body.appendChild(ghost);

    // 记录起始槽位。
    // placeholder 此时就在 source 原来的位置。
    const initialSlot = Array.from(row.children)
      .filter(el => el !== source)
      .indexOf(placeholder);

    dragState = {
      row,
      source,
      placeholder,
      ghost,
      pointerId: e.pointerId,
      offsetX: pending.offsetX,
      offsetY: pending.offsetY,
      ghostWidth: rect.width,
      ghostHeight: rect.height,

      // 网格锁定状态
      lockedSlot: initialSlot,
      lastResolvedSlot: initialSlot
    };

    document.body.classList.add("__soa_no_select");

    updateGhostPosition(e.clientX, e.clientY);
  }

  function updateGhostPosition(clientX, clientY) {
    if (!dragState?.ghost) return;

    const x = clientX - dragState.offsetX;
    const y = clientY - dragState.offsetY;

    dragState.ghost.style.left = `${x}px`;
    dragState.ghost.style.top = `${y}px`;
  }

  function getGhostCenter(clientX, clientY) {
    if (!dragState) {
      return {
        x: clientX,
        y: clientY
      };
    }

    return {
      x:
        clientX -
        dragState.offsetX +
        dragState.ghostWidth / 2,
      y:
        clientY -
        dragState.offsetY +
        dragState.ghostHeight / 2
    };
  }

  function getGridMetrics() {
    if (!dragState) return null;

    const row = dragState.row;
    const columns = getSavedColumns();
    const rowRect = row.getBoundingClientRect();

    const columnGap = getSavedColumnGap();
    const rowGap = DEFAULT_ROW_GAP;
    const cellWidth = getSavedCardWidth();

    const placeholderRect =
      dragState.placeholder.getBoundingClientRect();

    const cellHeight =
      placeholderRect.height ||
      dragState.ghostHeight;

    return {
      rowRect,
      columns,
      columnGap,
      rowGap,
      cellWidth,
      cellHeight,
      pitchX: cellWidth + columnGap,
      pitchY: cellHeight + rowGap
    };
  }

  function getRenderableItems() {
    if (!dragState) return [];

    return Array.from(dragState.row.children).filter(
      el => el !== dragState.source
    );
  }

  function getMaxSlotIndex() {
    const items = getRenderableItems();

    // placeholder 已经包含在 items 内。
    // 最末位置就是 items.length - 1。
    return Math.max(0, items.length - 1);
  }

  function resolveGridSlot(centerX, centerY) {
    const metrics = getGridMetrics();
    if (!metrics) return null;

    const {
      rowRect,
      columns,
      pitchX,
      pitchY,
      cellWidth,
      cellHeight
    } = metrics;

    // 相对 Grid 左上角位置
    const x = centerX - rowRect.left;
    const y = centerY - rowRect.top;

    // 超出 Grid 左右边界时钳制到最边缘槽位
    let col = Math.floor(x / pitchX);
    let rowIndex = Math.floor(y / pitchY);

    col = Math.max(
      0,
      Math.min(columns - 1, col)
    );

    rowIndex = Math.max(0, rowIndex);

    // 当中心点恰好处在 gap 内时，不立即跳到下一格。
    // 让它向最近的实际 cell 吸附。
    const localX =
      x - col * pitchX;

    if (
      localX > cellWidth &&
      col < columns - 1
    ) {
      const gapX = localX - cellWidth;

      if (
        gapX >
        (pitchX - cellWidth) / 2
      ) {
        col += 1;
      }
    }

    const localY =
      y - rowIndex * pitchY;

    if (
      localY > cellHeight
    ) {
      const gapY = localY - cellHeight;

      if (
        gapY >
        (pitchY - cellHeight) / 2
      ) {
        rowIndex += 1;
      }
    }

    let slot =
      rowIndex * columns + col;

    slot = Math.max(
      0,
      Math.min(
        getMaxSlotIndex(),
        slot
      )
    );

    return slot;
  }

  function isCenterStillInsideLockedSlot(
    centerX,
    centerY,
    slot
  ) {
    const metrics = getGridMetrics();
    if (!metrics) return false;

    const {
      rowRect,
      columns,
      pitchX,
      pitchY,
      cellWidth,
      cellHeight
    } = metrics;

    const rowIndex =
      Math.floor(slot / columns);

    const col =
      slot % columns;

    const left =
      rowRect.left +
      col * pitchX;

    const top =
      rowRect.top +
      rowIndex * pitchY;

    const right =
      left + cellWidth;

    const bottom =
      top + cellHeight;

    // 加一点滞后边界。
    // 只有真正离开当前整块格子，才允许进入下一次判定。
    return (
      centerX >= left - GRID_SLOT_HYSTERESIS &&
      centerX <= right + GRID_SLOT_HYSTERESIS &&
      centerY >= top - GRID_SLOT_HYSTERESIS &&
      centerY <= bottom + GRID_SLOT_HYSTERESIS
    );
  }

  function movePlaceholderToSlot(slot) {
    if (!dragState) return;

    const row = dragState.row;
    const placeholder =
      dragState.placeholder;

    const items = getRenderableItems();

    const currentIndex =
      items.indexOf(placeholder);

    if (currentIndex === slot) {
      dragState.lockedSlot = slot;
      dragState.lastResolvedSlot = slot;
      return;
    }

    // 先从逻辑 items 中排除 placeholder，
    // 然后插到目标索引。
    const withoutPlaceholder =
      items.filter(
        el => el !== placeholder
      );

    if (
      slot >=
      withoutPlaceholder.length
    ) {
      row.appendChild(placeholder);
    } else {
      row.insertBefore(
        placeholder,
        withoutPlaceholder[slot]
      );
    }

    dragState.lockedSlot = slot;
    dragState.lastResolvedSlot = slot;
  }

  function updateDropPosition(
    clientX,
    clientY
  ) {
    if (!dragState) return;

    const center =
      getGhostCenter(
        clientX,
        clientY
      );

    // 核心逻辑：
    // 只要拖动卡片中心仍然处于当前“锁定格子”的整块区域内，
    // 完全不重新判定。
    if (
      Number.isInteger(
        dragState.lockedSlot
      ) &&
      isCenterStillInsideLockedSlot(
        center.x,
        center.y,
        dragState.lockedSlot
      )
    ) {
      return;
    }

    const newSlot =
      resolveGridSlot(
        center.x,
        center.y
      );

    if (
      newSlot === null ||
      newSlot ===
        dragState.lockedSlot
    ) {
      return;
    }

    // 真正进入新 Grid 槽位时只移动一次
    movePlaceholderToSlot(newSlot);
  }

  function processDragMove(e) {
    dragMoveRAF = 0;

    if (!e) return;

    // 尚未真正起拖
    if (
      pendingDrag &&
      !dragState
    ) {
      if (
        e.pointerId !==
        pendingDrag.pointerId
      ) {
        return;
      }

      const distance =
        distanceFromStart(
          e,
          pendingDrag
        );

      if (
        distance <
        DRAG_ACTIVATION_DISTANCE
      ) {
        return;
      }

      const pending = pendingDrag;
      pendingDrag = null;

      startDrag(
        pending.source,
        e,
        pending
      );
    }

    if (!dragState) return;

    if (
      e.pointerId !==
      dragState.pointerId
    ) {
      return;
    }

    updateGhostPosition(
      e.clientX,
      e.clientY
    );

    updateDropPosition(
      e.clientX,
      e.clientY
    );

    // 靠近页面上下边缘时自动滚动
    const edge = 72;
    const speed = 14;

    if (e.clientY < edge) {
      window.scrollBy(
        0,
        -speed
      );
    } else if (
      e.clientY >
      window.innerHeight - edge
    ) {
      window.scrollBy(
        0,
        speed
      );
    }
  }

  function requestDragMove(e) {
    latestMoveEvent = {
      pointerId: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY
    };

    if (dragMoveRAF) return;

    dragMoveRAF =
      requestAnimationFrame(() => {
        const evt =
          latestMoveEvent;

        latestMoveEvent = null;

        processDragMove(evt);
      });
  }

  function onSortPointerDown(e) {
    if (
      !sortEnabled ||
      e.button !== 0 ||
      dragState ||
      pendingDrag
    ) {
      return;
    }

    const row = getRow();
    if (!row) return;

    const source =
      e.target.closest?.(
        ".ivu-col"
      );

    if (
      !source ||
      !row.contains(source) ||
      !getName(source)
    ) {
      return;
    }

    const rect =
      source.getBoundingClientRect();

    pendingDrag = {
      row,
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX:
        e.clientX - rect.left,
      offsetY:
        e.clientY - rect.top
    };

    try {
      source.setPointerCapture?.(
        e.pointerId
      );
    } catch {
      // 忽略
    }

    e.preventDefault();
  }

  function onSortPointerMove(e) {
    if (
      !pendingDrag &&
      !dragState
    ) {
      return;
    }

    if (
      pendingDrag &&
      e.pointerId !==
        pendingDrag.pointerId
    ) {
      return;
    }

    if (
      dragState &&
      e.pointerId !==
        dragState.pointerId
    ) {
      return;
    }

    requestDragMove(e);
    e.preventDefault();
  }

  function cancelPendingDrag(
    pointerId
  ) {
    if (
      !pendingDrag ||
      pendingDrag.pointerId !==
        pointerId
    ) {
      return false;
    }

    try {
      pendingDrag.source
        .releasePointerCapture?.(
          pointerId
        );
    } catch {
      // 忽略
    }

    pendingDrag = null;
    return true;
  }

  function finishDrag(
    save = true
  ) {
    if (!dragState) return;

    const {
      row,
      source,
      placeholder,
      ghost,
      pointerId
    } = dragState;

    if (dragMoveRAF) {
      cancelAnimationFrame(
        dragMoveRAF
      );
      dragMoveRAF = 0;
    }

    latestMoveEvent = null;

    source.style.removeProperty(
      "display"
    );

    row.insertBefore(
      source,
      placeholder
    );

    placeholder.remove();
    ghost?.remove();

    source.classList.remove(
      CLS.draggingSource
    );

    try {
      source.releasePointerCapture?.(
        pointerId
      );
    } catch {
      // 忽略
    }

    document.body.classList.remove(
      "__soa_no_select"
    );

    dragState = null;
    pendingDrag = null;

    suppressNextClick = true;

    setTimeout(() => {
      suppressNextClick = false;
    }, 140);

    applyGridLayout();
    updateSortableState();

    if (save) {
      saveCurrentOrder();
    }
  }

  function onSortPointerUp(e) {
    if (
      pendingDrag &&
      e.pointerId ===
        pendingDrag.pointerId
    ) {
      cancelPendingDrag(
        e.pointerId
      );
      e.preventDefault();
      return;
    }

    if (
      !dragState ||
      e.pointerId !==
        dragState.pointerId
    ) {
      return;
    }

    e.preventDefault();
    finishDrag(true);
  }

  function onSortPointerCancel(e) {
    if (
      pendingDrag &&
      e.pointerId ===
        pendingDrag.pointerId
    ) {
      cancelPendingDrag(
        e.pointerId
      );
      return;
    }

    if (
      !dragState ||
      e.pointerId !==
        dragState.pointerId
    ) {
      return;
    }

    finishDrag(true);
  }

  function bindRowEvents() {
    const row = getRow();
    if (
      !row ||
      row === rowEventsBoundTo
    ) {
      return;
    }

    rowEventsBoundTo = row;

    row.addEventListener(
      "pointerdown",
      onSortPointerDown
    );

    row.addEventListener(
      "pointermove",
      onSortPointerMove
    );

    row.addEventListener(
      "pointerup",
      onSortPointerUp
    );

    row.addEventListener(
      "pointercancel",
      onSortPointerCancel
    );

    // 排序模式下禁止误点打开应用
    row.addEventListener(
      "click",
      e => {
        if (
          sortEnabled ||
          suppressNextClick
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
  }

  /* =========================================================
   * 10. 样式
   * ========================================================= */

  function createStyle() {
    if (document.getElementById(IDS.style)) return;

    const style = document.createElement("style");
    style.id = IDS.style;

    style.textContent = `
      /* ---------- 应用区：紧凑 Grid ---------- */

      .${CLS.row} {
        display: grid !important;
        justify-content: start !important;
        align-items: stretch !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        width: 100% !important;
        overflow: visible !important;
      }

      .${CLS.row} > .ivu-col {
        float: none !important;
        margin: 0 !important;
        padding: 0 !important;
        min-width: 0 !important;
      }

      .${CLS.row} > .ivu-col > .app-card {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
      }

      .${CLS.row} .app-card-div {
        width: 100% !important;
        box-sizing: border-box !important;
      }

      /* ---------- 普通浏览状态：模块悬浮高亮 ---------- */

      .${CLS.row} > .ivu-col:not(.${CLS.sortable}) .app-card {
        transition:
          background-color .16s ease,
          border-color .16s ease,
          box-shadow .16s ease,
          transform .16s ease;
      }

      @media (hover: hover) and (pointer: fine) {
        .${CLS.row} > .ivu-col:not(.${CLS.sortable}):hover .app-card {
          background: #eef7ff !important;
          border-color: #91caff !important;
          box-shadow: 0 4px 14px rgba(45, 140, 240, .10);
          transform: translateY(-1px);
        }

        .${CLS.row} > .ivu-col:not(.${CLS.sortable}):hover .app-card-div {
          background: transparent !important;
        }
      }

      /* ---------- 悬浮文字按钮 ---------- */

      #${IDS.button} {
        position: fixed;
        top: 82px;
        left: 12px;
        z-index: 100000;
        min-width: 132px;
        height: 40px;
        padding: 0 13px;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 10px;
        background: #2d8cf0;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        line-height: 38px;
        text-align: center;
        white-space: nowrap;
        cursor: grab;
        user-select: none;
        box-shadow: 0 5px 18px rgba(45, 140, 240, .30);
        transition:
          transform .15s ease,
          box-shadow .15s ease,
          background .15s ease;
      }

      #${IDS.button}:hover {
        transform: translateY(-1px);
        box-shadow: 0 7px 22px rgba(45, 140, 240, .38);
      }

      #${IDS.button}.${CLS.movingButton} {
        cursor: grabbing;
        transition: none;
      }

      #${IDS.button}.__soa_sort_active {
        background: #19be6b;
        box-shadow: 0 5px 18px rgba(25, 190, 107, .30);
      }

      /* ---------- 设置面板 ---------- */

      #${IDS.panel} {
        position: fixed;
        z-index: 99999;
        width: 270px;
        padding: 14px;
        border: 1px solid #e8eaec;
        border-radius: 12px;
        background: rgba(255, 255, 255, .985);
        color: #17233d;
        box-shadow: 0 10px 32px rgba(0, 0, 0, .20);
        font-size: 14px;
        display: none;
        box-sizing: border-box;
      }

      #${IDS.panel} .__soa_title {
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 10px;
      }

      #${IDS.panel} .__soa_row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 38px;
        gap: 10px;
      }

      #${IDS.panel} select {
        width: 96px;
        height: 30px;
        border: 1px solid #dcdee2;
        border-radius: 6px;
        background: #fff;
        padding: 0 8px;
        outline: none;
      }

      #${IDS.panel} select:focus {
        border-color: #2d8cf0;
      }


      #${IDS.panel} .__soa_mode_label {
        margin: 2px 0 7px;
        color: #515a6e;
        font-size: 13px;
        font-weight: 600;
      }

      #${IDS.panel} .__soa_mode_grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 7px;
      }

      #${IDS.panel} .__soa_mode_btn {
        min-width: 0;
        height: 56px;
        padding: 6px 7px;
        border: 1px solid #dcdee2;
        border-radius: 8px;
        background: #fff;
        color: #515a6e;
        cursor: pointer;
        box-sizing: border-box;
        transition:
          border-color .15s ease,
          background .15s ease,
          color .15s ease;
      }

      #${IDS.panel} .__soa_mode_btn:hover {
        border-color: #2d8cf0;
        color: #2d8cf0;
      }

      #${IDS.panel} .__soa_mode_btn.__soa_mode_active {
        border-color: #2d8cf0;
        background: #eef7ff;
        color: #2d8cf0;
      }

      #${IDS.panel} .__soa_mode_icon {
        display: block;
        margin-bottom: 3px;
        font-size: 18px;
        line-height: 1;
      }

      #${IDS.panel} .__soa_mode_text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
      }

      #${IDS.panel} .__soa_num_wrap {
        display: flex;
        align-items: center;
        gap: 5px;
      }

      #${IDS.panel} .__soa_num_input {
        width: 72px;
        height: 30px;
        border: 1px solid #dcdee2;
        border-radius: 6px;
        background: #fff;
        padding: 0 7px;
        outline: none;
        box-sizing: border-box;
      }

      #${IDS.panel} .__soa_num_input:focus {
        border-color: #2d8cf0;
      }

      #${IDS.panel} .__soa_unit {
        min-width: 18px;
        color: #808695;
        font-size: 12px;
      }

      #${IDS.panel} .__soa_hint {
        margin-top: 8px;
        padding: 8px 9px;
        border-radius: 7px;
        background: #f7f9fb;
        color: #808695;
        font-size: 12px;
        line-height: 1.55;
      }

      #${IDS.status} {
        margin-top: 8px;
        min-height: 18px;
        color: #2d8cf0;
        font-size: 12px;
      }

      #${IDS.panel} .__soa_actions {
        display: flex;
        gap: 8px;
        margin-top: 9px;
      }

      #${IDS.panel} .__soa_action_btn {
        flex: 1;
        height: 30px;
        border: 1px solid #dcdee2;
        border-radius: 6px;
        background: #fff;
        color: #515a6e;
        cursor: pointer;
      }

      #${IDS.panel} .__soa_action_btn:hover {
        border-color: #2d8cf0;
        color: #2d8cf0;
      }

      /* ---------- 开关 ---------- */

      .__soa_switch {
        position: relative;
        width: 42px;
        height: 22px;
        display: inline-block;
        flex: 0 0 auto;
      }

      .__soa_switch input {
        display: none;
      }

      .__soa_slider {
        position: absolute;
        inset: 0;
        border-radius: 11px;
        background: #c5c8ce;
        cursor: pointer;
        transition: .18s;
      }

      .__soa_slider::before {
        content: "";
        position: absolute;
        width: 18px;
        height: 18px;
        left: 2px;
        top: 2px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
        transition: .18s;
      }

      .__soa_switch input:checked + .__soa_slider {
        background: #19be6b;
      }

      .__soa_switch input:checked + .__soa_slider::before {
        transform: translateX(20px);
      }

      /* ---------- 排序模式 ---------- */

      .${CLS.sortable} {
        cursor: grab !important;
        touch-action: none;
        transition:
          transform .15s ease,
          opacity .15s ease;
      }

      .${CLS.sortable} .app-card {
        border-color: rgba(45, 140, 240, .55) !important;
      }

      .${CLS.sortable}:hover {
        transform: translateY(-2px);
      }

      .${CLS.sortable}:hover .app-card {
        box-shadow: 0 6px 18px rgba(45, 140, 240, .14);
      }

      .${CLS.draggingSource} {
        pointer-events: none !important;
      }

      .${CLS.placeholder} {
        min-width: 0;
        border: 2px dashed rgba(45, 140, 240, .60);
        border-radius: 7px;
        background:
          linear-gradient(
            135deg,
            rgba(45, 140, 240, .06),
            rgba(45, 140, 240, .13)
          );
        box-sizing: border-box;
      }

      .${CLS.ghost} {
        opacity: .94;
        transform: rotate(.4deg) scale(1.015);
        filter: drop-shadow(0 13px 17px rgba(0,0,0,.20));
        transition: none !important;
      }

      .${CLS.ghost} .app-card {
        border-color: #2d8cf0 !important;
        background: #fff !important;
      }

      body.__soa_no_select,
      body.__soa_no_select * {
        user-select: none !important;
      }
    `;

    document.head.appendChild(style);
  }

  /* =========================================================
   * 11. 控制按钮 + 设置面板
   * ========================================================= */

  function updateControlButtonText() {
    const button = document.getElementById(IDS.button);
    if (!button) return;

    const columns = getSavedColumns();
    const cardWidth = getSavedCardWidth();

    const orderMode =
      getSavedOrderMode();

    if (
      sortEnabled &&
      orderMode === ORDER_MODE.SCRIPT
    ) {
      button.textContent =
        `↕ 排序中 · ${columns}列`;
      button.classList.add("__soa_sort_active");
    } else {
      const modeText =
        orderMode === ORDER_MODE.ORIGINAL
          ? "原始"
          : "脚本";

      button.textContent =
        `🧩 布局 · ${modeText} · ${columns}列`;
      button.classList.remove("__soa_sort_active");
    }
  }

  function showStatus(text) {
    const el = document.getElementById(IDS.status);
    if (!el) return;

    el.textContent = text;

    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = "列数、模块宽度、间距、排序和按钮位置都会自动保存";
      }
    }, 2300);
  }

  function createControl() {
    if (document.getElementById(IDS.button)) return;

    createStyle();

    const button = document.createElement("button");
    button.id = IDS.button;
    button.type = "button";
    button.title = "SOA应用布局设置。按钮本身可拖动";

    const panel = document.createElement("div");
    panel.id = IDS.panel;

    const options = [4, 5, 6, 7, 8]
      .map(n => `<option value="${n}">${n} 列</option>`)
      .join("");

    panel.innerHTML = `
      <div class="__soa_title">应用中心布局</div>

      <div class="__soa_mode_label">
        图标顺序
      </div>

      <div class="__soa_mode_grid">
        <button
          id="${IDS.orderModeOriginal}"
          class="__soa_mode_btn"
          type="button"
          data-order-mode="${ORDER_MODE.ORIGINAL}"
        >
          <span class="__soa_mode_icon">↩</span>
          <span class="__soa_mode_text">网页原始顺序</span>
        </button>

        <button
          id="${IDS.orderModeScript}"
          class="__soa_mode_btn"
          type="button"
          data-order-mode="${ORDER_MODE.SCRIPT}"
        >
          <span class="__soa_mode_icon">↕</span>
          <span class="__soa_mode_text">脚本排序</span>
        </button>
      </div>

      <div class="__soa_row">
        <span>每行最多列数</span>
        <select id="${IDS.columns}">
          ${options}
        </select>
      </div>

      <div class="__soa_row">
        <span>模块宽度</span>
        <div class="__soa_num_wrap">
          <input
            id="${IDS.cardWidth}"
            class="__soa_num_input"
            type="number"
            min="${MIN_CARD_WIDTH}"
            max="${MAX_CARD_WIDTH}"
            step="10"
          >
          <span class="__soa_unit">px</span>
        </div>
      </div>

      <div class="__soa_row">
        <span>列间距</span>
        <div class="__soa_num_wrap">
          <input
            id="${IDS.columnGap}"
            class="__soa_num_input"
            type="number"
            min="${MIN_COLUMN_GAP}"
            max="${MAX_COLUMN_GAP}"
            step="2"
          >
          <span class="__soa_unit">px</span>
        </div>
      </div>

      <div class="__soa_row">
        <span>拖拽排序</span>
        <label class="__soa_switch">
          <input id="${IDS.sortSwitch}" type="checkbox">
          <span class="__soa_slider"></span>
        </label>
      </div>

      <div class="__soa_hint">
        “网页原始顺序”完全按网站当前原始顺序显示；“脚本排序”使用预设/拖拽保存顺序。<br>
        模块仍采用固定宽度左对齐；脚本排序下可开启拖拽，松手自动保存。
      </div>

      <div id="${IDS.status}">
        列数、模块宽度、间距、排序和按钮位置都会自动保存
      </div>

      <div class="__soa_actions">
        <button
          class="__soa_action_btn"
          data-action="reset-order"
        >
          恢复预设顺序
        </button>

        <button
          class="__soa_action_btn"
          data-action="reset-pos"
        >
          重置按钮位置
        </button>
      </div>
    `;

    document.body.appendChild(button);
    document.body.appendChild(panel);

    const select = document.getElementById(IDS.columns);
    const cardWidthInput = document.getElementById(IDS.cardWidth);
    const columnGapInput = document.getElementById(IDS.columnGap);
    const sortSwitch = document.getElementById(IDS.sortSwitch);

    select.value = String(getSavedColumns());
    cardWidthInput.value = String(getSavedCardWidth());
    columnGapInput.value = String(getSavedColumnGap());
    sortSwitch.checked = sortEnabled;
    updateOrderModeUi();

    select.addEventListener("change", () => {
      setColumns(select.value);
    });

    cardWidthInput.addEventListener("change", () => {
      setCardWidth(cardWidthInput.value);
    });

    cardWidthInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        cardWidthInput.blur();
      }
    });

    columnGapInput.addEventListener("change", () => {
      setColumnGap(columnGapInput.value);
    });

    columnGapInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        columnGapInput.blur();
      }
    });

    sortSwitch.addEventListener("change", () => {
      setSortEnabled(sortSwitch.checked);
    });

    panel.addEventListener("click", e => {
      const modeButton =
        e.target?.closest?.(
          "[data-order-mode]"
        );

      if (modeButton) {
        setOrderMode(
          modeButton.dataset.orderMode
        );
        return;
      }

      const action = e.target?.dataset?.action;
      if (!action) return;

      if (action === "reset-order") {
        resetToDefaultOrder();
      }

      if (action === "reset-pos") {
        resetButtonPosition(button);
        positionPanel();
        showStatus("按钮位置已重置");
      }
    });

    initMovableButton(button, panel);
    restoreButtonPosition(button);
    updateControlButtonText();

    window.addEventListener("resize", () => {
      clampButtonToViewport(button);
      positionPanel();
    });
  }

  function togglePanel() {
    const panel = document.getElementById(IDS.panel);
    if (!panel) return;

    const willOpen = panel.style.display !== "block";
    panel.style.display = willOpen ? "block" : "none";

    if (willOpen) {
      const select = document.getElementById(IDS.columns);
      const cardWidthInput = document.getElementById(IDS.cardWidth);
      const columnGapInput = document.getElementById(IDS.columnGap);
      const checkbox = document.getElementById(IDS.sortSwitch);

      if (select) {
        select.value = String(getSavedColumns());
      }

      if (cardWidthInput) {
        cardWidthInput.value = String(getSavedCardWidth());
      }

      if (columnGapInput) {
        columnGapInput.value = String(getSavedColumnGap());
      }

      if (checkbox) {
        checkbox.checked =
          sortEnabled &&
          getSavedOrderMode() ===
            ORDER_MODE.SCRIPT;
      }

      updateOrderModeUi();
      positionPanel();
    }
  }

  function positionPanel() {
    const button = document.getElementById(IDS.button);
    const panel = document.getElementById(IDS.panel);

    if (
      !button ||
      !panel ||
      panel.style.display !== "block"
    ) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const panelWidth = 270;
    const gap = 8;

    let left = rect.left;
    let top = rect.bottom + gap;

    if (left + panelWidth > window.innerWidth - 8) {
      left = Math.max(
        8,
        window.innerWidth - panelWidth - 8
      );
    }

    const panelHeight = panel.offsetHeight || 225;

    if (top + panelHeight > window.innerHeight - 8) {
      top = Math.max(
        8,
        rect.top - panelHeight - gap
      );
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  /* =========================================================
   * 12. 悬浮按钮拖动
   * ========================================================= */

  function restoreButtonPosition(button) {
    try {
      const raw = storageGet(STORAGE.buttonPos, "");
      if (!raw) return;

      const pos = JSON.parse(raw);

      if (
        !Number.isFinite(pos.left) ||
        !Number.isFinite(pos.top)
      ) {
        return;
      }

      button.style.left = `${pos.left}px`;
      button.style.top = `${pos.top}px`;

      requestAnimationFrame(() => {
        clampButtonToViewport(button);
      });
    } catch {
      // 保持默认位置
    }
  }

  function saveButtonPosition(button) {
    const rect = button.getBoundingClientRect();

    storageSet(
      STORAGE.buttonPos,
      JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top)
      })
    );
  }

  function resetButtonPosition(button) {
    storageRemove(STORAGE.buttonPos);
    button.style.left = "12px";
    button.style.top = "82px";
  }

  function clampButtonToViewport(button) {
    const rect = button.getBoundingClientRect();
    const margin = 6;

    const maxLeft = Math.max(
      margin,
      window.innerWidth - rect.width - margin
    );

    const maxTop = Math.max(
      margin,
      window.innerHeight - rect.height - margin
    );

    const left = Math.min(
      Math.max(rect.left, margin),
      maxLeft
    );

    const top = Math.min(
      Math.max(rect.top, margin),
      maxTop
    );

    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function initMovableButton(button, panel) {
    let dragging = false;
    let moved = false;

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    button.addEventListener("click", e => {
      // click 交给 pointerup 判断。
      // 避免拖动按钮结束时误打开面板。
      e.preventDefault();
    });

    button.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;

      dragging = true;
      moved = false;

      const rect = button.getBoundingClientRect();

      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      button.classList.add(CLS.movingButton);

      try {
        button.setPointerCapture?.(e.pointerId);
      } catch {
        // 忽略
      }

      e.preventDefault();
    });

    button.addEventListener("pointermove", e => {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (
        Math.abs(dx) > 4 ||
        Math.abs(dy) > 4
      ) {
        moved = true;
      }

      if (!moved) return;

      button.style.left = `${startLeft + dx}px`;
      button.style.top = `${startTop + dy}px`;

      clampButtonToViewport(button);

      if (panel.style.display === "block") {
        positionPanel();
      }
    });

    button.addEventListener("pointerup", e => {
      if (!dragging) return;

      dragging = false;
      button.classList.remove(CLS.movingButton);

      try {
        button.releasePointerCapture?.(e.pointerId);
      } catch {
        // 忽略
      }

      if (moved) {
        saveButtonPosition(button);
        positionPanel();
      } else {
        togglePanel();
      }
    });

    button.addEventListener("pointercancel", () => {
      dragging = false;
      button.classList.remove(CLS.movingButton);
    });
  }

  /* =========================================================
   * 13. Vue 重绘后的自动恢复
   * ========================================================= */

  function applyCurrentLayout() {
    if (applying || dragState || pendingDrag) return;

    const row = getRow();
    if (!row) return;

    applying = true;

    try {
      bindRowEvents();

      // 先记录网站刚渲染出来的真实顺序，再做任何脚本重排。
      captureOriginalOrder(row);

      const orderMode =
        getSavedOrderMode();

      if (
        orderMode === ORDER_MODE.ORIGINAL
      ) {
        sortEnabled = false;

        if (!isOriginalOrderApplied()) {
          restoreOriginalOrder();
        }
      } else {
        // 排序编辑状态下不主动恢复顺序。
        // 避免 Vue observer 在用户拖动过程中抢回 DOM。
        if (!sortEnabled && !isOrderApplied()) {
          restoreOrder();
        }
      }

      applyGridLayout();
      updateSortableState();
      updateOrderModeUi();
    } finally {
      setTimeout(() => {
        applying = false;
      }, 40);
    }
  }

  function scheduleApply(delay = 120) {
    clearTimeout(applyTimer);

    applyTimer = setTimeout(() => {
      applyCurrentLayout();
    }, delay);
  }

  const observer = new MutationObserver(() => {
    if (dragState || pendingDrag) return;
    scheduleApply(120);
  });

  /* =========================================================
   * 14. 初始化
   * ========================================================= */

  function init() {
    createControl();

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    let tryCount = 0;

    const timer = setInterval(() => {
      tryCount++;

      if (getRow() && getCols().length) {
        clearInterval(timer);

        applyCurrentLayout();

        console.log(
          `[SOA布局] v4.7 初始化完成。` +
          `列数：${getSavedColumns()}，` +
          `模块宽度：${getSavedCardWidth()}px，` +
          `列间距：${getSavedColumnGap()}px。`
        );
      }

      if (tryCount >= 60) {
        clearInterval(timer);
      }
    }, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
