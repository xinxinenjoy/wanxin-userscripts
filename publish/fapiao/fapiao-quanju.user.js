// ==UserScript==
// @name         发票-1.1全局页面
// @namespace    https://tampermonkey.net/
// @version      6.35
// @description  发票全局页面：优化SOA发票页面的表格布局，全局指的是通过左上角订单中心-订单开票进入的开票页面，需要自行手动维护对应的单位名称才可以正常显示。请在代码内搜索“文案替换表”自行配置。

// @match        https://checkup-soa3.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup fapiao
// @publishID    fapiao-quanju
// @updateURL    https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-quanju.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-quanju.user.js
// ==/UserScript==

(function () {
  "use strict";

  // 设置面板标题上显示版本，用来一眼确认浏览器里装的是不是刚改的这版
  // （以前只能靠「覆盖安装」的口头约定，经常改完还在跑旧脚本）。
  const SCRIPT_VERSION =
    (typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version) || "";
  const withVersion = (text) => (SCRIPT_VERSION ? `${text}｜v${SCRIPT_VERSION}` : text);

  /******************** 0) 路由范围 ********************/
  const TARGET_HASH_PREFIX = "#/merge-order-invoice";
  const isTargetRoute = () => location.hash.startsWith(TARGET_HASH_PREFIX);

  /******************** 1) 配置 ********************/
  /* ---- 列定义 ----------------------------------------------------------------
     id     记住「顺序 / 显隐」用的稳定标识（表头文字变了也不会丢配置）
     header 站点表头上的文字，用来在 DOM 里找到这一列
     width  默认宽度（用户拖过就以拖出来的为准，存 localStorage）
     align  "right" = 数字列，右对齐 + 等宽数字
     hidden 默认不显示
     virtual 站点没有这一列，由脚本自己造（表头 + 每行一格）——目前只有「税号」 */
  const COLUMN_DEFS = [
    // 2026-10-27 按用户浏览器里实际在用的设置固化为默认（顺序 / 显隐 / 列宽），
    // 换机器、清了缓存再装上去就是这个样子，不用再手动调一遍。
    // 销方公司替换成简称后是「高新（玫瑰园）」这种 7~8 个字，130 刚好，
    // 再窄会被站点那格 antd 的 JS 省略组件截掉半截。
    { id: "seller", header: "销方公司", width: 130, align: "right" },
    { id: "customer", header: "开票客户", width: 314, adjustable: true },
    { id: "taxno", header: "税号", width: 200, virtual: true },
    { id: "amount", header: "发票金额", width: 80, align: "right" },
    { id: "status", header: "当前状态", width: 100 },
    { id: "creator", header: "创建人", width: 222 },
    { id: "actions", header: "操作", width: 250 },
    { id: "applyNo", header: "申请单号", width: 200 },
    { id: "advance", header: "预开票", width: 64 },
    { id: "card", header: "卡类开票", width: 74 },
    // 「来源」表头里带着站点的筛选勾选框（不显示非SOA开票），窄了会被裁掉，给够 174
    { id: "source", header: "来源", width: 174 },
    { id: "type", header: "发票类型", width: 100, hidden: true },
  ];

  const COLUMN_DEF_BY_ID = new Map(COLUMN_DEFS.map((def) => [def.id, def]));

  // 设置面板里改过的顺序 / 显隐（loadSettings 会覆盖）
  let columnOrder = COLUMN_DEFS.map((def) => def.id);
  let hiddenColumnIds = new Set(
    COLUMN_DEFS.filter((def) => def.hidden).map((def) => def.id)
  );

  /* 现有代码全部按 COLUMN_LAYOUT 的数组顺序决定视觉位置（buildCss 里 order = 下标），
     所以这里只需要把它按配置重排一遍，其它逻辑不用动。 */
  let COLUMN_LAYOUT = [];

  function rebuildColumnLayout() {
    const known = new Set(COLUMN_DEFS.map((def) => def.id));

    // 配置里可能有已经删掉的列（脚本升级后），过滤掉；没配置到的列按原顺序补在最后
    const ordered = columnOrder.filter((id) => known.has(id));
    COLUMN_DEFS.forEach((def) => {
      if (!ordered.includes(def.id)) ordered.push(def.id);
    });

    columnOrder = ordered;
    COLUMN_LAYOUT = ordered.map((id) => {
      const def = COLUMN_DEF_BY_ID.get(id);
      return { ...def, hidden: hiddenColumnIds.has(id) };
    });
  }

// 文案替换表，左侧为原文，值为替换后的文案。仅在单元格中出现时才会替换，不会影响其他位置的文本。
  const DEFAULT_TEXT_REPLACE = {
    "全电普通发票（电子）": "电子普票",
    "待提交审批": "❓核对后提交",
    "开票成功": "✅已开",
    "作废": "❌作废未开",
    "已退票": "❌红冲退票",
    "审批完成开票中": "开票中",
    "开票申请审批中": "钉钉审批中",
    "SOA开票": "订单开票",
    "SOA合并开票": "主页开票",
    "否": "—",
    "新乡美年大健康管理有限公司门诊部": "门诊部（宝龙）",
    "新乡美年大健康管理有限公司高新门诊部": "高新（玫瑰园）",
    "长垣美年大健康管理有限公司门诊部": "长垣（长垣店）",
  };

  const WIDTH_STEP = 60;

  /* ---- 用户设置：文案替换表 + 列宽，存 localStorage，两个发票脚本共用一份 ---- */
  const SETTINGS_STORAGE_KEY = "tm-fapiao-settings";
  const COLUMN_MIN_WIDTH = 60;
  const COLUMN_MAX_WIDTH = 900;

  let TEXT_REPLACE = { ...DEFAULT_TEXT_REPLACE };
  const columnWidths = {}; // header → px（只在用户拖动过之后才有值）

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw) || {};

      if (data.textReplace && typeof data.textReplace === "object") {
        const entries = Object.entries(data.textReplace).filter(
          ([source]) => typeof source === "string" && source.trim()
        );
        if (entries.length) TEXT_REPLACE = Object.fromEntries(entries);
      }

      if (data.columnWidths && typeof data.columnWidths === "object") {
        Object.entries(data.columnWidths).forEach(([header, width]) => {
          const value = Math.round(Number(width));
          if (Number.isFinite(value) && value > 0) {
            columnWidths[header] = Math.min(
              COLUMN_MAX_WIDTH,
              Math.max(COLUMN_MIN_WIDTH, value)
            );
          }
        });
      }

      if (Array.isArray(data.columnOrder)) {
        const ids = data.columnOrder.filter((id) => typeof id === "string");
        if (ids.length) columnOrder = ids;
      }

      if (Array.isArray(data.hiddenColumns)) {
        hiddenColumnIds = new Set(
          data.hiddenColumns.filter((id) => typeof id === "string")
        );
      }
    } catch (error) {}
  }

  function persistSettings() {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify({
          textReplace: TEXT_REPLACE,
          columnWidths,
          columnOrder,
          hiddenColumns: [...hiddenColumnIds],
        })
      );
    } catch (error) {}
  }

  loadSettings();
  rebuildColumnLayout();


  /* 「发票金额」列宽自适应。
     合并开票来的记录，站点会在金额格里多挂一个自己的标签（<span class="ant-tag">合</span>），
     而这一列原本写死 80px（去掉左右 padding 只剩 64px），实测内容要 88.7px
     —— 装不下就被 flex 挤在一起。表头 / 表体是两张独立 table，纯 CSS 取不到
     彼此的宽度，只能先量出来、再同时写给两边。 */
  const AMOUNT_COLUMN_HEADER = "发票金额";
  const AMOUNT_COLUMN_MIN = 80;
  const AMOUNT_COLUMN_MAX = 240;

  /* ---- 商品明细：列表里看不到，得逐张查「详情」接口拿 taxableList ----
     接口实测（2026-10-27）：POST /invoice/query/detail → data.taxableList[]
     每项 = { taxableName 商品名称, unit 单位, taxableCustCount 数量, amount 本行价税合计 }。
     ⚠️ 数量留空 = 这个键**根本不存在**（undefined），不是 0 —— 别拿 0 当「没填」。
     商品名称几乎恒为「医疗服务（体检费）」，所以明细的差异只在「数量 ↔ 金额」的配对。 */
  /* 明细缓存直接落 localStorage：已开票的商品明细是**不会变**的（真要改只能红冲重开，
     那时申请单号也会变），所以没必要每次刷新页面都重新拉一遍 50 次详情接口。
     ⚠️ 1.1 和 1.2 共用这一个 key，在全局页拉过的行，进订单页直接命中。 */
  const DETAIL_STORE_KEY = "tm-fapiao-detail-store";
  const DETAIL_STORE_VERSION = 2;
  const DETAIL_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天
  const DETAIL_CACHE_MAX = 800;
  const DETAIL_FETCH_GAP = 70; // 两次详情请求的间隔，别把接口打满
  const DETAIL_FAIL_STOP = 6; // 连续失败这么多次就停手，别反复刷
  const DETAIL_POP_ID = "tm-invoice-detail-pop";

  const TABLE_MARKER = "data-tm-invoice-table";
  const TABLE_SELECTOR = `.ant-table[${TABLE_MARKER}="1"]`;
  const LIST_CONTAINER_SELECTOR = ".mergeinvoice_container";


  /* 旁听发票接口响应、捞销方公司真值时的最大递归深度 */
  const TRUTH_SCAN_DEPTH = 6;
  /* 写接口完成后，用「详情」接口主动补一次真值（页面点「详情」就是这么拿的） */
  const TRUTH_DETAIL_URL = "/soa/api/v1/invoice/query/detail";
  const SOA_CLIENT_ID = "MN_SOA3";
  const TRUTH_REFRESH_MAX_ROWS = 6;
  const TRUTH_REFRESH_GAP_MS = 800;

  /******************** 2) 状态 ********************/
  let enabled = false;
  let customerWidthDelta = 0;
  let amountColumnWidth = AMOUNT_COLUMN_MIN;
  let lastPageKey = null;
  let lastHeaderSignature = "";

  let uiBtn = null;
  let styleEl = null;

  const rowSig = new WeakMap();

  let rootObserver = null;
  let tableObserver = null;
  let observedTableRoot = null;

  let scheduled = false;
  let pendingForceStyle = false;

  const sellerTruth = new Map(); // applyCode → 站点真值（销方公司全称）
  let truthHookInstalled = false;
  let soaRegionCode = "XX";
  let lastTruthRefreshAt = 0;

  /* 商品明细：applyCode → { items, at }；items = [{ name, unit, qty, unitPrice, amount }] */
  const detailCache = new Map();
  const detailFailed = new Set(); // 取不到的行，本次会话不再重试
  const detailRequested = new Set(); // 已入队 / 已请求
  let detailQueue = [];
  let detailRunning = false;
  let detailFailStreak = 0;
  let detailPopTimer = null;

  /******************** 3) 表格与基础工具 ********************/
  const normText = (value) => (value || "").replace(/\s+/g, " ").trim();

  function getHeaderCells(tableRoot = observedTableRoot) {
    const header = tableRoot?.querySelector(".ant-table-header");
    return header ? [...header.querySelectorAll("th")] : [];
  }

  // 表头文字。只取「开头的那个纯文本块」，不取整格 textContent。
  // 站点会在表头里塞自己的控件：批量的按钮、拖拽手柄、来源列的筛选 checkbox。
  // 整格取会把它们一起读进来（「来源 不显示非SOA开票」「操作 批量下载」），
  // 列名就对不上 COLUMN_LAYOUT 里的 "来源" 了 —— 那一列宽度会被漏掉，
  // 表头 179px / 表体 72px，整排右边全错位（1.2 订单页实测）。
  function headerText(th) {
    if (!th) return "";

    const parts = [];
    for (const node of th.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.nodeValue || "");
        if (parts.join("").trim()) break;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      // 我们自己挂的东西、站点的控件，一律不算列名
      if (
        node.matches(
          ".tm-col-resizer, .tm-batch-head-btn, .ant-checkbox-wrapper, svg, .anticon"
        )
      ) {
        break;
      }

      parts.push(node.textContent || "");
      break;
    }

    return normText(parts.join(""));
  }

  function getBodyRows(tableRoot = observedTableRoot) {
    const tbody = tableRoot?.querySelector(".ant-table-body tbody");
    return tbody
      ? [...tbody.querySelectorAll("tr:not(.ant-table-measure-row)")]
      : [];
  }


  // 判断是否为目标发票表格，避免误处理弹窗、抽屉等其他 Ant Design 表格
  function isInvoiceTableRoot(tableRoot) {
    if (!tableRoot) return false;

    if (tableRoot.closest(".ant-modal")) return false;
    if (tableRoot.closest(".ant-drawer")) return false;

    const headers = new Set(
      getHeaderCells(tableRoot)
        .map((cell) => headerText(cell))
        .filter(Boolean)
    );

    return [
      "发票类型",
      "销方公司",
      "开票客户",
      "发票金额"
    ].every((header) => headers.has(header));
  }

  function findInvoiceTableRoot() {
    const candidates = [
      ...document.querySelectorAll(".mergeinvoice_container .ant-table"),
    ];

    return candidates.find(
      (tableRoot) => isInvoiceTableRoot(tableRoot)
    ) || null;
  }

  function markTableRoot(tableRoot) {
    if (tableRoot && isInvoiceTableRoot(tableRoot)) {
      tableRoot.setAttribute(TABLE_MARKER, "1");
    }
  }

  function getHeaderIndexMap(tableRoot = observedTableRoot) {
    const map = new Map();
    getHeaderCells(tableRoot).forEach((th, index) => {
      const text = headerText(th);
      if (text && !map.has(text)) map.set(text, index);
    });
    return map;
  }

  function getHeaderSignature(tableRoot = observedTableRoot) {
    return getHeaderCells(tableRoot)
      .map((th) => headerText(th))
      .join("|");
  }

  function getColumnWidth(column) {
    // 用户拖过这一列就以拖出来的宽度为准（存 localStorage）
    const custom = columnWidths[column.header];
    if (custom) return custom;

    if (column.header === AMOUNT_COLUMN_HEADER) return amountColumnWidth;

    const delta = column.adjustable ? customerWidthDelta : 0;
    // 下限用 COLUMN_MIN_WIDTH（60）而不是写死的 80：预开票 / 卡类开票这两列用户调到了 64 / 74，
    // 写死 80 会让「默认值」和「用户拖出来的值」对不上（2026-10-27 固化默认配置时发现）
    return Math.max(COLUMN_MIN_WIDTH, column.width + delta);
  }

  /* 量「发票金额」列实际需要多宽：逐行取该格内容的宽度（含站点自己挂的
     「合」标签），取最大值再加单元格内边距，夹在 [80, 240] 之间。

     ⚠️ 量的是格内元素自身的 min-content 宽度 —— 它不随当前列宽变化，
     所以这个函数可以重复调用而不产生抖动。 */
  function measureAmountColumnWidth(headerIndexMap) {
    if (!observedTableRoot) return AMOUNT_COLUMN_MIN;

    const index = headerIndexMap.get(AMOUNT_COLUMN_HEADER);
    if (index === undefined) return AMOUNT_COLUMN_MIN;

    let widest = 0;
    let padding = 0;

    for (const tr of getBodyRows(observedTableRoot)) {
      const td = tr.children[index];
      if (!td) continue;

      if (!padding) {
        const style = getComputedStyle(td);
        padding =
          (parseFloat(style.paddingLeft) || 0) +
          (parseFloat(style.paddingRight) || 0);
      }

      let content = 0;
      let hintWidth = 0;

      td.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // 明细小字是第二行，宽度不该和金额相加（否则量出来的列宽会指数膨胀）。
          // ⚠️ 不能读 scrollWidth —— 它是 flex 子项、又被 overflow:hidden，读到的
          //    只是当前可用宽度（实测 84），真正的文本宽要用 Range 量（92）。
          if (node.classList && node.classList.contains("tm-qty-hint")) {
            if (node.textContent) {
              const range = document.createRange();
              range.selectNodeContents(node);
              hintWidth = Math.max(hintWidth, range.getBoundingClientRect().width);
            }
            return;
          }
          content += node.getBoundingClientRect().width;
        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          content += range.getBoundingClientRect().width;
        }
      });

      content = Math.max(content, hintWidth);
      if (content > widest) widest = content;
    }

    if (!widest) return AMOUNT_COLUMN_MIN;

    return Math.min(
      AMOUNT_COLUMN_MAX,
      Math.max(AMOUNT_COLUMN_MIN, Math.ceil(widest + padding))
    );
  }

  function syncAmountColumnWidth(headerIndexMap) {
    const next = measureAmountColumnWidth(headerIndexMap);
    if (next === amountColumnWidth) return false;

    amountColumnWidth = next;
    return true;
  }

  /* ---- 列宽手动拖拽：表头每列右边缘留 9px 热区，双击恢复该列默认宽度 ---- */
  let columnResizeState = null;
  // 拖动期间挂起所有重算（文案替换、金额量宽…），见 scheduleWork
  let isResizingColumn = false;
  let resizeFrameId = 0;

  function ensureColumnResizers() {
    const tableRoot = observedTableRoot;
    if (!tableRoot) return;

    const headerCells = getHeaderCells(tableRoot);
    const indexMap = getHeaderIndexMap(tableRoot);
    const columnByDomIndex = new Map();

    COLUMN_LAYOUT.forEach((column) => {
      if (column.hidden) return; // 隐藏的列不用拖
      const domIndex = indexMap.get(column.header);
      if (domIndex !== undefined) columnByDomIndex.set(domIndex, column);
    });

    headerCells.forEach((th, domIndex) => {
      const column = columnByDomIndex.get(domIndex);
      if (!column) return;

      // 打标记：只有这个类的表头会关掉页面自带的 1px 竖线，由我们这条线顶上。
      // 放在「手柄是否已存在」之前 —— 手柄可能是别的版本建的，标记一样要补上。
      th.classList.add("tm-has-resizer");

      if (th.querySelector(":scope > .tm-col-resizer")) return;

      const handle = document.createElement("div");
      handle.className = "tm-col-resizer";
      handle.dataset.header = column.header;
      handle.dataset.domIndex = String(domIndex);
      handle.title = `拖动可调整「${column.header}」列宽，双击恢复默认`;
      th.appendChild(handle);
    });

    // 虚拟列「税号」的表头是脚本补的，不在这批 th 里，单独挂一个手柄
    const taxColumn = COLUMN_DEF_BY_ID.get(TAX_COL_ID);
    if (taxColumn && !taxColumn.hidden) {
      const taxTh = tableRoot.querySelector(".ant-table-header th[data-tm-taxhdr]");
      if (taxTh) {
        taxTh.classList.add("tm-has-resizer");
        if (!taxTh.querySelector(":scope > .tm-col-resizer")) {
          const handle = document.createElement("div");
          handle.className = "tm-col-resizer";
          handle.dataset.header = taxColumn.header;
          handle.dataset.virtual = "1";
          handle.title = `拖动可调整「${taxColumn.header}」列宽，双击恢复默认`;
          taxTh.appendChild(handle);
        }
      }
    }
  }

  /********** 「操作」列头右侧的批量下载按钮 **********/
  const BATCH_HEAD_BTN_CLASS = "tm-batch-head-btn";

  function syncBatchHeadButton(button) {
    if (!button) return;

    const busy = !!batchState;
    const text = busy
      ? "停止 " + batchState.done + "/" + batchState.total
      : "批量下载";
    const title = busy
      ? "点击停止后续提交"
      : "勾选要下载的发票，格式可选 PDF / OFD / XML";

    // ⚠️ 这三个属性必须「变了才写」。脚本自己挂着 MutationObserver 盯整张表，
    //    哪怕写回同样的值也算一次变更 → 又会唤醒自己去重算 → 后台标签页里
    //    同步执行时直接原地死循环（实测：页面卡死、CDP 都求不了值）。
    if (button.textContent !== text) button.textContent = text;
    if (button.title !== title) button.title = title;

    const hasFlag = button.classList.contains("is-busy");
    if (hasFlag !== busy) button.classList.toggle("is-busy", busy);
  }

  function refreshBatchHeadButtons() {
    document
      .querySelectorAll("." + BATCH_HEAD_BTN_CLASS)
      .forEach((button) => syncBatchHeadButton(button));
  }

  let batchBtnEnsureAt = 0;
  let batchBtnLastBuildAt = 0;
  let batchBtnBuildBurst = 0;
  let batchBtnCooldownUntil = 0;

  function ensureBatchHeadButton() {
    const tableRoot = observedTableRoot;
    if (!tableRoot) return;

    // ⚠️ 节流 + 熔断。这个函数每轮工作都会跑，而后台标签页里每轮都是同步执行的：
    //    万一表头被站点的 React 反复重建（按钮刚插进去就被冲掉），就会变成
    //    「插按钮 → 触发观察者 → 同步重跑 → 再插按钮」的无限循环，页面直接卡死
    //    （实测：订单页注入后主线程 100% 占用，CDP 连 1+1 都求不出值）。
    const now = Date.now();
    if (now < batchBtnCooldownUntil) return;
    if (now - batchBtnEnsureAt < 200) return;
    batchBtnEnsureAt = now;

    const opIndex = getHeaderIndexMap(tableRoot).get("操作");
    if (opIndex === undefined) return;

    const th = getHeaderCells(tableRoot)[opIndex];
    if (!th) return;

    let button = th.querySelector(":scope > ." + BATCH_HEAD_BTN_CLASS);
    if (!button) {
      batchBtnBuildBurst =
        now - batchBtnLastBuildAt < 1000 ? batchBtnBuildBurst + 1 : 1;
      batchBtnLastBuildAt = now;
      if (batchBtnBuildBurst > 8) {
        // 1 秒内建了 9 次 → 表头在自毁重建，先停 3 秒再试，别把页面拖死
        batchBtnCooldownUntil = now + 3000;
        batchBtnBuildBurst = 0;
        return;
      }

      button = document.createElement("button");
      button.type = "button";
      button.className = BATCH_HEAD_BTN_CLASS;

      // 表头上的拖拽手柄 / 排序都靠 mousedown、click 触发，这里一并吃掉
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (batchState) {
          cancelBatchDownload();
        } else {
          openBatchPanel();
        }
      });

      th.appendChild(button);
    }

    syncBatchHeadButton(button);
  }

  function finishColumnResize(commit) {
    if (!columnResizeState) return;

    const { tableRoot, domIndex, header, width, cells, frozen } = columnResizeState;
    columnResizeState = null;
    isResizingColumn = false;

    if (resizeFrameId) {
      cancelAnimationFrame(resizeFrameId);
      resizeFrameId = 0;
    }
    // 先解锁站点省略号组件的宽度，再清掉拖动时逐格写的内联宽度，
    // 让它跟着最终列宽重新截断一次（就这一次）
    unfreezeCellEllipsis(frozen);
    // 拖动时是逐格写的内联宽度，松手后要清掉，交给重建出来的 CSS 变量接管
    (cells || []).forEach((cell) => {
      cell.style.removeProperty("width");
      cell.style.removeProperty("max-width");
      cell.style.removeProperty("flex-basis");
    });

    document.body.classList.remove("tm-col-resizing");
    document
      .querySelectorAll(".tm-col-resizer.is-active")
      .forEach((node) => node.classList.remove("is-active"));
    if (tableRoot) tableRoot.style.removeProperty(`--tm-c${domIndex}`);

    if (commit && width) {
      columnWidths[header] = width;
      persistSettings();
    }

    // ⚠️ 不能只交给 scheduleWork —— 它跑在 rAF 里，标签页在后台时压根不触发，
    //    松手后列宽会弹回原值（实测）。这里同步重建一次兜底。
    if (observedTableRoot) applyOrUpdateStyle();
    scheduleWork(true);
  }

  document.addEventListener(
    "mousedown",
    (event) => {
      const handle = event.target?.closest?.(".tm-col-resizer");
      if (!handle || !enabled) return;

      const th = handle.closest("th");
      if (!th) return;

      event.preventDefault();
      event.stopPropagation();

      handle.classList.add("is-active");
      isResizingColumn = true;

      const domIndex = Number(handle.dataset.domIndex);
      // 一次找齐这一列的表头 + 所有表体格，拖动时不再查 DOM
      const cells =
        handle.dataset.virtual === "1"
          ? [
              th,
              ...getBodyRows(observedTableRoot).map((tr) =>
                tr.querySelector(":scope > td[data-tm-taxtd]")
              ),
            ].filter(Boolean)
          : collectColumnCells(observedTableRoot, domIndex);

      columnResizeState = {
        tableRoot: observedTableRoot,
        domIndex,
        header: handle.dataset.header,
        startX: event.clientX,
        startWidth: Math.round(th.getBoundingClientRect().width),
        width: 0,
        cells,
        // 钉住站点省略号组件的内部宽度，别让它在拖动时逐行重算
        frozen: freezeCellEllipsis(cells),
      };

      document.body.classList.add("tm-col-resizing");
    },
    true
  );

  /* 站点在「销方公司」这类列上用的是 antd 的 JS 省略号组件（.ant-typography-ellipsis），
     不是纯 CSS 截断：列宽一变它就逐行重新计算截断位置，回写 title、重排子节点。
     40 步拖窄实测能刷出 3722 次 DOM 变更、1653 次取文本、246 次写 title，
     直接把拖动拖成幻灯片；「创建人」这种普通文本列同样的拖动只有 94 次变更、0 次写。

     所以拖动期间把这些组件的内部宽度钉死：它们的 ResizeObserver 看到的尺寸不再变化，
     重算自然不发生；松手立刻解锁，恢复成跟随列宽的常态截断。 */
  function freezeCellEllipsis(cells) {
    const frozen = [];
    (cells || []).forEach((cell) => {
      cell.querySelectorAll(".ant-typography").forEach((el) => {
        if (el.dataset.tmFrozen === "1") return;
        const width = Math.round(el.getBoundingClientRect().width);
        if (!width) return;
        el.dataset.tmFrozen = "1";
        el.style.width = width + "px";
        el.style.minWidth = width + "px";
        el.style.maxWidth = width + "px";
        frozen.push(el);
      });
    });
    return frozen;
  }

  function unfreezeCellEllipsis(frozen) {
    (frozen || []).forEach((el) => {
      el.style.removeProperty("width");
      el.style.removeProperty("min-width");
      el.style.removeProperty("max-width");
      delete el.dataset.tmFrozen;
    });
  }

  // 拖动时要改这一列的所有单元格（表头 th + 每一行的 td）
  function collectColumnCells(tableRoot, domIndex) {
    if (!tableRoot) return [];
    const cells = [];
    const th = getHeaderCells(tableRoot)[domIndex];
    if (th) cells.push(th);
    getBodyRows(tableRoot).forEach((tr) => {
      const td = tr.children[domIndex];
      if (td) cells.push(td);
    });
    return cells;
  }

  /* 拖动中的宽度怎么落地，直接影响顺不顺：
     ❌ 改 .ant-table 上的 CSS 变量 --tm-cN —— 全表 51 行 × 11 列的样式全部失效重算，
        实测每改一次 ~8.8ms，鼠标一动就卡。
     ✅ 只给这一列的 52 个格子写内联 width/flex-basis —— 失效范围只有这些格子，
        实测每改一次 ~1.2ms，快 7 倍。
     松手后清掉内联值，再由 applyOrUpdateStyle 用 CSS 变量接管（见 finishColumnResize）。 */
  function applyResizeWidth() {
    resizeFrameId = 0;
    const state = columnResizeState;
    if (!state) return;

    const px = state.width + "px";
    (state.cells || []).forEach((cell) => {
      cell.style.width = px;
      cell.style.maxWidth = px;
      cell.style.flexBasis = px;
    });
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!columnResizeState) return;
      event.preventDefault();

      const delta = event.clientX - columnResizeState.startX;
      const width = Math.min(
        COLUMN_MAX_WIDTH,
        Math.max(COLUMN_MIN_WIDTH, columnResizeState.startWidth + delta)
      );

      columnResizeState.width = Math.round(width);

      // mousemove 可能一秒上百次，一帧只落一次宽度
      if (document.hidden) {
        applyResizeWidth();
        return;
      }
      if (!resizeFrameId) resizeFrameId = requestAnimationFrame(applyResizeWidth);
    },
    true
  );

  document.addEventListener(
    "mouseup",
    () => finishColumnResize(true),
    true
  );

  // 拖到窗口外松手时 mouseup 可能收不到，用 blur 兜底收尾：
  // 否则「拖动中暂停重算」的标志会一直挂着，文案替换再也不刷新。
  window.addEventListener("blur", () => finishColumnResize(true), true);

  // 双击列边缘：这一列回到 COLUMN_LAYOUT 里的默认宽度
  document.addEventListener(
    "dblclick",
    (event) => {
      const handle = event.target?.closest?.(".tm-col-resizer");
      if (!handle || !enabled) return;

      event.preventDefault();
      event.stopPropagation();

      const header = handle.dataset.header;
      if (!header || !(header in columnWidths)) return;

      delete columnWidths[header];
      persistSettings();
      if (observedTableRoot) applyOrUpdateStyle();
      scheduleWork(true);
    },
    true
  );

  function getAdjustableColumn() {
    return COLUMN_LAYOUT.find((column) => column.adjustable) || null;
  }

  function changeCustomerWidth(delta) {
    const column = getAdjustableColumn();
    if (!column) return;

    const minimumDelta = 80 - column.width;
    customerWidthDelta = Math.max(
      minimumDelta,
      customerWidthDelta + delta
    );
    scheduleWork(true);
  }

  function getCurrentPageKey() {
    const active = document.querySelector(".ant-pagination-item-active");
    const pageText = active ? normText(active.innerText) : "";
    return pageText || "unknown";
  }

  function resetTempWidthIfPageChanged() {
    const key = getCurrentPageKey();
    if (lastPageKey === null) {
      lastPageKey = key;
      return false;
    }

    if (key !== lastPageKey) {
      customerWidthDelta = 0;
      lastPageKey = key;
      return true;
    }

    return false;
  }

  /******************** 4) 文案替换 ********************/
  function normalizeForMatch(value) {
    return (value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function replaceIgnoringWhitespace(source, key, value) {
    const sourceNormalized = normalizeForMatch(source);
    const keyNormalized = normalizeForMatch(key);
    if (!sourceNormalized.includes(keyNormalized)) return source;

    const separator = "[\\s\\u00A0\\u200B-\\u200D\\uFEFF]*";
    const pattern = [...keyNormalized]
      .map((character) => escapeRegExp(character))
      .join(separator);

    return source.replace(new RegExp(pattern, "g"), value);
  }

  function safeReplaceText(text) {
    let output = text;

    for (const [source, target] of Object.entries(TEXT_REPLACE)) {
      // 部分目标文案仍包含源文案（例如“作废”），避免重复扩写。
      if (
        target &&
        normalizeForMatch(output) === normalizeForMatch(target)
      ) {
        continue;
      }
      output = replaceIgnoringWhitespace(output, source, target);
    }

    return output;
  }

  /******************** 5) 单元格处理：保留原节点结构 ********************/
  /* 站点在「销方公司」用的是 antd 的 JS 省略组件，被省略的后半截不在可见文本里：

       <span class="ant-typography ant-typography-ellipsis" title="">
         <span>新乡美年大
           <span title="健康管理有限公司高新门诊部" aria-hidden="true">...</span>
         </span>
       </span>

     直接读 innerText 只能拿到「新乡美年大...」，文案替换表里那串全名永远匹配不上
     —— 订单页 2026-10-27 实测：全局页靠接口旁听拿到真值所以没露馅，订单页没有真值就露了。
     这里按 DOM 顺序把文本拼回来：带非空 title 的节点直接用 title 顶替（它就是被省略的那段），
     纯省略号（"..." / "…"）丢掉。 */
  function readEllipsisFullText(root) {
    const box = root.querySelector(".ant-typography-ellipsis");
    if (!box) return "";

    let out = "";

    const walk = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          out += child.nodeValue;
          return;
        }
        if (child.nodeType !== 1) return;

        const title = (child.getAttribute("title") || "").trim();
        if (title) {
          out += title;
          return;
        }

        walk(child);
      });
    };

    walk(box);

    return normText(out.replace(/[.．·]{2,}/g, ""));
  }

  function getCellFullText(td) {
    const ellipsisText = readEllipsisFullText(td);
    if (ellipsisText) return ellipsisText;

    const titled = td.querySelector("[title]");
    if (titled && titled.getAttribute("title")) {
      const text = titled.getAttribute("title").trim();
      if (text) return text;
    }

    const ownTitle = (td.getAttribute("title") || "").trim();
    if (ownTitle) return ownTitle;

    return normText(td.innerText);
  }

  function getMeaningfulTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (normText(node.nodeValue)) nodes.push(node);
    }

    return nodes;
  }

  // 只改已有文本节点的 nodeValue，不使用 innerHTML/textContent 删除 React 管理的子节点。
  function setCellTextKeepStructure(td, newText, options = {}) {
    const textNodes = getMeaningfulTextNodes(td);
    if (!textNodes.length) return false;

    textNodes[0].nodeValue = newText;
    for (let index = 1; index < textNodes.length; index += 1) {
      textNodes[index].nodeValue = "";
    }

    // keepTitle：留给「销方公司」这类由站点维护 title 真值的格子，不能覆盖。
    if (!options.keepTitle) {
      if (td.hasAttribute("title")) td.setAttribute("title", newText);
      const titled = td.querySelector("[title]");
      if (titled && titled.getAttribute("title")) {
        titled.setAttribute("title", newText);
      }
    }

    return true;
  }

  // 开票客户：不重建 DOM，只用 CSS 将原有名称和税号排成一行。
  /* ⚠️ 两段之间的「，」必须是**真实文本节点**，不能用 CSS ::after 画。
     伪元素不参与选区：框选时「公司名 → 税号」之间会留一道白缺口，
     看着就像数据丢了（其实复制出来是完整的），2026-10-27 用户反馈。
     换成真节点后，高亮是连续的一整块，选中的文字也和看到的一致。 */
  function prepareCustomerCell(td) {
    const divs = td.querySelectorAll(":scope > .ellipsis");
    if (divs.length !== 2) return;

    const name = normText(divs[0].innerText);
    const code = normText(divs[1].innerText);
    if (!name || !code) return;

    td.setAttribute("data-tm-customer", "1");
    td.setAttribute("title", `${name}，${code}`);

    // 幂等 + 不抖动：已就位就别再动 DOM（反复 remove/insert 会一直触发表格观察器）
    const prev = divs[1].previousElementSibling;
    if (!prev || !prev.classList.contains("tm-cust-sep")) {
      td.querySelectorAll(":scope > .tm-cust-sep").forEach((node) => node.remove());
      const sep = document.createElement("span");
      sep.className = "tm-cust-sep";
      sep.textContent = "，";
      divs[1].before(sep);
    }
  }

  /* ---- 虚拟列「税号」 --------------------------------------------------------
     站点把「公司名 + 税号」塞在同一个格子里（两个 .ellipsis）。要在列表上分成两列，
     只能由脚本自己补：表头补一个 th、每行末尾补一个 td。

     ⚠️ 必须追加在**末尾**，绝不能插到中间 —— 整张表的 CSS 全是按 td:nth-child(N)
        定位的，插中间会让后面每一列的下标整体错位。视觉位置交给 flex 的 order，
        所以放在 DOM 末尾完全不影响它在屏幕上的位置（实测：表头/表体两边的 order 一致即可）。 */
  const TAX_COL_ID = "taxno";

  const taxColumnVisible = () => !hiddenColumnIds.has(TAX_COL_ID);

  function updateTaxSplitMarker(tableRoot = observedTableRoot) {
    if (!tableRoot) return;
    if (taxColumnVisible()) tableRoot.setAttribute("data-tm-taxsplit", "1");
    else tableRoot.removeAttribute("data-tm-taxsplit");
  }

  function ensureTaxHeader(tableRoot = observedTableRoot) {
    const headerRow = tableRoot?.querySelector(".ant-table-header tr");
    if (!headerRow) return null;

    let th = headerRow.querySelector(":scope > th[data-tm-taxhdr]");
    if (!th) {
      th = document.createElement("th");
      th.className = "ant-table-cell";
      th.setAttribute("data-tm-taxhdr", "1");
      th.textContent = "税号";
      headerRow.appendChild(th);
    }
    return th;
  }

  // 每行的税号格：内容取「开票客户」格里的第二个 .ellipsis（站点那里放的就是税号）
  function syncTaxCell(tr, customerIdx) {
    if (!tr || customerIdx === undefined) return;

    const cell = tr.children[customerIdx];
    const parts = cell ? [...cell.querySelectorAll(":scope > .ellipsis")] : [];
    const code = parts.length === 2 ? normText(parts[1].textContent) : "";

    let td = tr.querySelector(":scope > td[data-tm-taxtd]");
    if (!td) {
      td = document.createElement("td");
      td.className = "ant-table-cell";
      td.setAttribute("data-tm-taxtd", "1");
      tr.appendChild(td);
    }

    // 变了才写：脚本自己挂着 MutationObserver，反复写同一个值会把自己叫醒
    if (td.textContent !== code) td.textContent = code;
    if (code) {
      if (td.getAttribute("title") !== code) td.setAttribute("title", code);
    } else if (td.hasAttribute("title")) {
      td.removeAttribute("title");
    }
  }

  // 创建人：保留两个原始 div；空姓名通过 CSS 伪元素显示“手工开票”。
  function prepareCreatorCell(td) {
    const divs = td.querySelectorAll(":scope > div");
    if (divs.length < 2) return;

    const nameDiv = divs[0];
    const timeDiv = divs[1];
    const name = normText(nameDiv.innerText);
    const time = normText(timeDiv.innerText);
    if (!time) return;

    td.setAttribute("data-tm-creator", "1");
    td.setAttribute("data-tm-creator-name", name || "手工开票");
    td.setAttribute("data-tm-creator-time", time);

    if (!name) nameDiv.setAttribute("data-tm-manual-creator", "1");
    else nameDiv.removeAttribute("data-tm-manual-creator");
  }

  function removeAmountSeparators(raw) {
    const cleaned = normText(raw).replace(/,/g, "");
    return cleaned || raw;
  }

  /* 金额格去千分位逗号。
     ⚠️ 不能走 setCellTextKeepStructure —— 它是「首节点写整串、其余文本节点清空」，
     而金额格里还挂着站点自己的「合」标签（合并开票来的记录），标签里的字会被一起
     清空，只剩一个空标签（2026-09-30 实测：21,635合 → 21635合 + 空 ant-tag）。
     这里只动数字所在的文本节点，标签内部一律不碰，结构也不重建。 */
  function cleanAmountCell(cell) {
    const rawAmount = getCellFullText(cell);
    if (removeAmountSeparators(rawAmount) === rawAmount) return;

    const tagRoot = cell.querySelector(".ant-tag");
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (tagRoot && tagRoot.contains(node)) continue;

      const value = node.nodeValue || "";
      if (!value.includes(",")) continue;

      node.nodeValue = value.replace(/,/g, "");
    }
  }

  /******************** 6) CSS：列重排 + 宽度 + 对齐 ********************/
  function buildCss(headerIndexMap) {
    const scope = TABLE_SELECTOR;
    let css = `
      ${scope} .ant-table-fixed,
      ${scope} .ant-table-fixed-right,
      ${scope} .ant-table-fixed-left { display: none !important; }

      ${scope} tr.ant-table-measure-row {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
        padding: 0 !important;
        border: 0 !important;
      }

      ${scope} .ant-table-body { overflow-x: auto !important; }
      ${scope} .ant-table-body::-webkit-scrollbar { height: 0 !important; }
      ${scope} .ant-table-body::-webkit-scrollbar-thumb { background: transparent !important; }
      ${scope} .ant-table-body::-webkit-scrollbar-track { background: transparent !important; }
      ${scope} .ant-table-body {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      ${scope} .ant-table-header tr {
        display: flex !important;
        height: 40px;
        align-items: center;
      }

      ${scope} .ant-table-body tr:not(.ant-table-measure-row) {
        display: flex !important;
        min-height: 40px;
        height: auto;
        align-items: stretch;
      }

      ${scope} .ant-table-header th {
        box-sizing: border-box;
        position: relative;
        flex-shrink: 0;
        order: 999;
        padding: 0 12px;
        height: 40px;
        line-height: 40px;
        display: flex;
        align-items: center;
        white-space: nowrap;
        overflow: hidden;
      }

      ${scope} .ant-table-body td {
        box-sizing: border-box;
        flex-shrink: 0;
        order: 999;
        padding: 8px 12px;
        min-height: 40px;
        display: flex;
        align-items: center;
        white-space: nowrap;
        overflow: hidden;
      }

      ${scope} .ant-table-header table,
      ${scope} .ant-table-body table { min-width: max-content !important; }

      ${scope} .ant-table-cell-scrollbar { display: none !important; }
      ${scope} .ant-table-cell-fix-right,
      ${scope} .ant-table-cell-fix-left {
        position: static !important;
        left: auto !important;
        right: auto !important;
      }

      ${scope} td[data-tm-customer="1"] {
        display: block !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        line-height: 24px;
      }
      ${scope} td[data-tm-customer="1"] > .ellipsis {
        display: inline !important;
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
        max-width: none !important;
      }
      /* 名称与税号之间的「，」由 prepareCustomerCell 插入真节点，这里只保证它不被样式化 */
      ${scope} td[data-tm-customer="1"] > .tm-cust-sep {
        display: inline;
      }

      ${scope} td[data-tm-creator="1"] {
        justify-content: space-between;
        gap: 12px;
      }
      ${scope} td[data-tm-creator="1"] > div:first-child {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      ${scope} td[data-tm-creator="1"] > div:last-child {
        flex: 0 0 auto;
        margin-left: auto;
        white-space: nowrap;
        text-align: right;
      }
      ${scope} [data-tm-manual-creator="1"]::before {
        content: "手工开票";
      }

      /* 「发票金额」格：金额照旧右对齐，下面挂一行 11px 灰字（数量 × 单价）。
         ⚠️ 这格要塞进原来 41px 的行高里：底边距 5 + 金额行 15 + 小字行 13 + 下边距 2 = 35
            ⇒ 行高一点不涨（默认金额行高 21 + 小字 15 + padding 16 会撑到 54）。
         ⚠️ align-content 必须用 space-between、不能用 center：center 把两行压到一起
            （实测金额墨迹 4~22、小字 21~34，重叠 1px）；space-between 拉开到
            金额 3~21、小字 25~38，上下留白各 3px。
         ⚠️ 必须带 .ant-table-body：站点 antd 的 .ant-table-small ... > td { padding:8px }
            排在最后且特异性 (0,3,1)，只写 td[data-tm-amount] 会被它盖回 8px（实测）。
         ⚠️ 本段是模板字符串，注释里绝不能再出现反引号（会截断字符串）。 */
      ${scope} .ant-table-body td[data-tm-amount="1"] {
        flex-wrap: wrap;
        align-content: space-between;
        justify-content: flex-end;
        padding-top: 5px;
        padding-bottom: 2px;
        line-height: 15px;
      }
      ${scope} .ant-table-body td[data-tm-amount="1"] > .tm-qty-hint {
        flex: 0 0 100%;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
        line-height: 13px;
        font-weight: 400;
        color: #97a1ae;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      }
      ${scope} .ant-table-body td[data-tm-amount="1"] > .tm-qty-hint.is-empty {
        color: #c2c8d0;
      }

      ${scope} tr.tm-row-refund,
      ${scope} tr.tm-row-refund * { color: #ff4d4f !important; }

      /* 同名客户（颜色由 paintDuplicateCustomers 写在行内的 --tm-dup-line）：
         2026-10-27 用户反馈「同名分散在页面各处时，整片底色除了乱没别的用处」，
         所以不再铺整行底色，只留两处克制的小标记 ——
           ① 视觉第一列最左边一条 4px 同色竖线（规则在下面按列生成）；
           ② 客户格右上角一个 ×N 角标（这里）。
         ⚠️ 竖线用 box-shadow: inset 而不是 border-left：border 会算进
            box-sizing:border-box 的宽度里，把这一列的内容区压窄 4px，表头表体就对不齐。
         ⚠️ 角标用伪元素 + attr()：不新增 DOM 节点，也不进选区（复制出来没有它）。 */
      ${scope} .ant-table-body td[data-tm-customer="1"] {
        position: relative;
      }
      ${scope} .ant-table-body td[data-tm-customer="1"][data-tm-dup-count] {
        padding-right: 26px;
      }
      ${scope} .ant-table-body td[data-tm-customer="1"][data-tm-dup-count]::after {
        content: attr(data-tm-dup-count);
        position: absolute;
        top: 2px;
        right: 3px;
        padding: 0 4px;
        font-size: 10px;
        line-height: 13px;
        color: #fff;
        background: var(--tm-dup-line);
        border-radius: 7px;
        opacity: 0.85;
        pointer-events: none;
        user-select: none;
      }

      ${scope} tr.tm-row-fail > td { background: rgb(35,127,254) !important; }
      ${scope} tr.tm-row-fail,
      ${scope} tr.tm-row-fail * { color: #fff !important; }
    `;

    // 同名客户的竖线只画在「视觉第一列」上，所以先找出排第一且没隐藏的那一列
    const firstVisibleColumn = COLUMN_LAYOUT.find((column) => !column.hidden);

    COLUMN_LAYOUT.forEach((column, visualIndex) => {
      const width = getColumnWidth(column);
      const alignment =
        column.align === "right"
          ? "justify-content:flex-end !important;text-align:right !important;font-variant-numeric:tabular-nums;"
          : "";
      const hide = column.hidden ? "display:none !important;" : "";

      // 虚拟列（税号）由脚本自己造，DOM 里没有固定的 nth-child 下标 —— 用属性选择器定位。
      if (column.virtual) {
        css += `
          ${scope} { --tm-c-tax: ${width}px; }
          ${scope} .ant-table-header th[data-tm-taxhdr],
          ${scope} .ant-table-body td[data-tm-taxtd] {
            order: ${visualIndex};
            width: var(--tm-c-tax);
            flex: 0 0 var(--tm-c-tax);
            max-width: var(--tm-c-tax);
            ${alignment}
            ${hide}
          }
        `;

        if (column === firstVisibleColumn) {
          css += `
            ${scope} .ant-table-body tbody tr[data-tm-dup] > td[data-tm-taxtd] {
              box-shadow: inset 4px 0 0 var(--tm-dup-line);
            }
          `;
        }

        return;
      }

      const domIndex = headerIndexMap.get(column.header);
      if (domIndex === undefined) return;

      css += `
        ${scope} { --tm-c${domIndex}: ${width}px; }
        ${scope} .ant-table-header th:nth-child(${domIndex + 1}),
        ${scope} .ant-table-body td:nth-child(${domIndex + 1}) {
          order: ${visualIndex};
          width: var(--tm-c${domIndex});
          flex: 0 0 var(--tm-c${domIndex});
          max-width: var(--tm-c${domIndex});
          ${alignment}
          ${hide}
        }
      `;

      if (column === firstVisibleColumn) {
        css += `
          ${scope} .ant-table-body tbody tr[data-tm-dup] > td:nth-child(${domIndex + 1}) {
            box-shadow: inset 4px 0 0 var(--tm-dup-line);
          }
        `;
      }
    });

    // 「税号」列开着的时候，开票客户格只显示公司名（税号已经单独一列了）；
    // 关掉时恢复成「名称，税号」挤在一格里。
    css += `
      ${scope}[data-tm-taxsplit="1"] td[data-tm-customer="1"] > .ellipsis:last-of-type,
      ${scope}[data-tm-taxsplit="1"] td[data-tm-customer="1"] > .tm-cust-sep {
        display: none !important;
      }
    `;

    // 「当前状态」格：必须放开溢出（通用 td 规则是 nowrap + overflow:hidden，会把格内一切裁掉）。
    // 站点自己的「完整文案气泡」就挂在这个格子内部 —— 异常状态时那个红色小图标上的 antd Tooltip，
    // 父节点是 div#applyCode-*。格子一裁剪，气泡就成了半截字（2026-09-22 实测：234px 的气泡
    // 被裁到 110px，文字断在中间）。
    // ⚠️ 但格内文案本身仍要裁 —— 所以裁在 span 上：气泡是 span 的兄弟节点，不受影响。
    css += `
      ${scope} td[data-tm-status="1"] {
        overflow: visible !important;
      }
      ${scope} td[data-tm-status="1"] > div {
        max-width: 100%;
        overflow: visible !important;
      }
      ${scope} td[data-tm-status="1"] > div > span {
        display: inline-block;
        max-width: 100%;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        vertical-align: middle;
      }
    `;

    css += `
      /* 页面自带的表头竖线是 th::before（1px 淡灰），和我们那条蓝线会并排出现，
         看着就是「两根线」。这里只在可拖的列上把它关掉，由我们这条线顶上，
         视觉上永远只有一根。 */
      ${scope} .ant-table-header th.tm-has-resizer::before {
        display: none !important;
      }

      ${scope} .tm-col-resizer {
        position: absolute;
        top: 0;
        right: 0;
        width: 9px;
        height: 100%;
        cursor: col-resize;
        z-index: 6;
      }
      /* 常态就站在原来那根线的位置上：一条淡蓝竖线，不再是「灰线 + 蓝线」两根 */
      ${scope} .tm-col-resizer::after {
        content: "";
        position: absolute;
        top: 6px;
        bottom: 6px;
        right: 0;
        width: 2px;
        background: rgba(35, 127, 254, 0.22);
        border-radius: 1px;
        transition: background 0.12s ease, box-shadow 0.12s ease, width 0.12s ease;
      }
      ${scope} .tm-col-resizer:hover::after {
        width: 3px;
        background: #237ffe;
        box-shadow: 0 0 0 1px rgba(35, 127, 254, 0.35);
      }
      /* 正在拖的那一条：加粗 + 高亮光晕 */
      ${scope} .tm-col-resizer.is-active::after {
        width: 4px;
        top: 0;
        bottom: 0;
        background: #0d5fd6;
        box-shadow: 0 0 8px 2px rgba(13, 95, 214, 0.6);
      }
      body.tm-col-resizing,
      body.tm-col-resizing * {
        cursor: col-resize !important;
        user-select: none !important;
      }

      /* 「操作」列头右侧的批量下载按钮 */
      ${scope} .tm-batch-head-btn {
        margin-left: 8px;
        height: 20px;
        padding: 0 8px;
        border: 0;
        border-radius: 4px;
        background: #237ffe;
        color: #fff;
        font-size: 11px;
        font-weight: 500;
        line-height: 20px;
        letter-spacing: 0;
        cursor: pointer;
        vertical-align: middle;
        white-space: nowrap;
      }
      ${scope} .tm-batch-head-btn:hover {
        background: #1a6fe0;
        color: #fff;
      }
      ${scope} .tm-batch-head-btn.is-busy {
        background: #ff4d4f;
      }
      ${scope} .tm-batch-head-btn.is-busy:hover {
        background: #d9363e;
      }
    `;

    return css;
  }

  function applyOrUpdateStyle(
    headerSignature = getHeaderSignature(observedTableRoot)
  ) {
    if (!observedTableRoot) return;
    markTableRoot(observedTableRoot);

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "tm-antd-style";
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = buildCss(getHeaderIndexMap(observedTableRoot));
    lastHeaderSignature = headerSignature;
    updateTaxSplitMarker(observedTableRoot);
    ensureTaxHeader(observedTableRoot);
    ensureColumnResizers();
    ensureBatchHeadButton();
    updateUiLabel();
  }

  function removeStyle() {
    const node = document.getElementById("tm-antd-style");
    if (node) node.remove();
    styleEl = null;
    lastHeaderSignature = "";
  }

  /******************** 7) 行处理 ********************/
  // 销方公司格的「真值指纹」：站点在数据变化时会更新这一格的 title（含内层 span 的 title），
  // 但不会重画可见文本 —— 把它纳入签名，title 一变就重算简称。
  function sellerSourceSignature(tr, sellerIdx) {
    if (sellerIdx === undefined) return "";
    const cell = tr.children[sellerIdx];
    if (!cell) return "";

    const parts = [cell.getAttribute("title") || ""];
    cell.querySelectorAll("[title]").forEach((node) => {
      parts.push(node.getAttribute("title") || "");
    });

    return parts.join("~");
  }

  function signatureForRow(tr, statusIdx, amountIdx, sellerIdx, sellerTruthValue) {
    const statusReady = statusIdx !== undefined ? "S1" : "S0";
    const amountReady = amountIdx !== undefined ? "A1" : "A0";
    return `${tr.innerText || ""}|${statusReady}|${amountReady}|${sellerSourceSignature(
      tr,
      sellerIdx
    )}|${sellerTruthValue || ""}`;
  }

  function processRow(tr, columnIndexes) {
    if (!tr || tr.classList.contains("ant-table-measure-row")) return;

    const statusIdx = columnIndexes.get("当前状态");
    const amountIdx = columnIndexes.get("发票金额");
    const sellerIdx = columnIndexes.get("销方公司");
    const applyCode = getApplyCode(tr, statusIdx);
    const sellerTruthValue = sellerTruth.get(applyCode) || "";
    const signature = signatureForRow(
      tr,
      statusIdx,
      amountIdx,
      sellerIdx,
      sellerTruthValue
    );
    if (rowSig.get(tr) === signature) return;
    rowSig.set(tr, signature);

    const cells = [...tr.children];
    const customerIdx = columnIndexes.get("开票客户");
    const creatorIdx = columnIndexes.get("创建人");

    if (
      customerIdx !== undefined &&
      cells[customerIdx] &&
      !cells[customerIdx].querySelector("a,button")
    ) {
      prepareCustomerCell(cells[customerIdx]);
      syncTaxCell(tr, customerIdx);
    }

    if (
      creatorIdx !== undefined &&
      cells[creatorIdx] &&
      !cells[creatorIdx].querySelector("a,button")
    ) {
      prepareCreatorCell(cells[creatorIdx]);
    }

    // 跳过操作链接和按钮，避免破坏操作列。
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell || cell.querySelector("a,button")) continue;

      // 金额格不参与文案替换：它下面挂着明细小字，替换会「首节点写整串、其余文本清空」，
      // 把小字一起抹掉（金额本身也不需要替换，只去千分位逗号）。
      if (index === amountIdx) continue;

      const rawFull = getCellFullText(cell);
      if (!rawFull) continue;

      const replaced = safeReplaceText(rawFull);

      if (index === sellerIdx) {
        // 销方公司格：
        // ① 首选旁听到的接口真值（最可靠，站点不重画那一格也拦不住我们）；
        // ② 没有真值时才退而求其次，且必须「替换真的生效」才写。
        // ⚠️ 不能拿 DOM 读回来的值当比较基准 —— 站点那套自绘截断组件的读值可能只是片段，
        //    会造成反复写入把格子写爆（2026-09-21 实测踩到过）。
        const truth = sellerTruth.get(applyCode) || "";
        const source = truth || rawFull;
        const target = safeReplaceText(source);

        const shouldWrite = truth
          ? normText(cell.innerText) !== normText(target)
          : target !== rawFull;

        if (shouldWrite) {
          setCellTextKeepStructure(cell, target, { keepTitle: true });
        }

        continue;
      }

      if (replaced !== rawFull) setCellTextKeepStructure(cell, replaced);
    }

    if (
      amountIdx !== undefined &&
      cells[amountIdx] &&
      !cells[amountIdx].querySelector("a,button")
    ) {
      cleanAmountCell(cells[amountIdx]);
      ensureDetailHint(tr, amountIdx);
    }

    if (statusIdx === undefined || !cells[statusIdx]) return;

    // 给状态格打标记：上面那套「放开溢出、让站点气泡不被裁」的 CSS 靠它定位
    cells[statusIdx].setAttribute("data-tm-status", "1");

    tr.classList.remove("tm-row-fail", "tm-row-refund");
    const statusText = normText(cells[statusIdx].innerText);

    if (statusText.includes("失败")) {
      tr.classList.add("tm-row-fail");
    } else if (
      statusText.includes("已退") ||
      statusText.includes("红冲") ||
      statusText.includes("作废")
    ) {
      tr.classList.add("tm-row-refund");
    }
  }

  /******************** 6.6) 相同开票客户：同色分组 ********************/
  /* 当前页里如果有多张发票的「开票客户」完全一致（名称 + 税号），给它们同一个底色，
     方便一眼看出这家客户被拆成了几张票 / 有没有重复开。
     只给**重复组**上色，只出现一次的客户保持白底，免得整张表花掉。
     颜色按「首次出现的顺序」分配，所以同一组在两次刷新里颜色不会变。 */
  /* 调色板换成「线条色」：现在只在行首画一条 4px 竖线 + 一个 ×N 角标，
     原来那套极浅的底色当线条画出来等于没画。10 个是为了让一页 7、8 组重复客户不撞色。 */
  const DUP_PALETTE = [
    "#faad14", // 橙
    "#4c9aff", // 蓝
    "#52c41a", // 绿
    "#9254de", // 紫
    "#eb2f96", // 粉
    "#13c2c2", // 青
    "#d4b106", // 黄
    "#8c7c66", // 卡其
    "#597ef7", // 靛
    "#f2674f", // 砖
  ];

  function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  }

  /* 配色 key 的唯一来源：名称 + 税号。表格的 readCustomerKey 和批量下载清单
     都必须走这里，否则两边哈希的输入不一样，同一个客户会算出两个颜色
     —— 2026-10-27 用户要求「清单里的颜色逻辑跟列表一样」，就是为了能跨视图对上。 */
  function customerColorKey(name, code) {
    const safeName = normText(name || "");
    const safeCode = normText(code || "");
    if (safeName && safeCode) return safeName + "，" + safeCode;
    return safeName || safeCode;
  }

  /* 同名客户配色的唯一分配点（表格竖线 × N 角标 / 批量清单色条都调它）：
       ① 色号 = key 的哈希，不按出现顺序取号 ⇒ 同一个客户换页、刷新、
          在列表和清单之间切换，都是同一个颜色；
       ② 一屏里两组撞到同一格就顺延一格，避免看着像一家；
       ③ 只出现 1 次的不上色（没有区分需求）。
     返回 Map<key, { color, count }>。 */
  function buildCustomerColorMarks(keys) {
    const counts = new Map();

    keys.forEach((key) => {
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const marks = new Map();
    const usedSlots = new Set();

    // 先按 key 排序再分配：同一屏里行序变了（翻页、重新打开面板），
    // 撞色顺延的结果也不会跟着飘
    [...counts.keys()]
      .filter((key) => counts.get(key) >= 2)
      .sort()
      .forEach((key) => {
        let slot = hashString(key) % DUP_PALETTE.length;
        for (
          let guard = 0;
          usedSlots.has(slot) && guard < DUP_PALETTE.length;
          guard += 1
        ) {
          slot = (slot + 1) % DUP_PALETTE.length;
        }
        usedSlots.add(slot);

        marks.set(key, { color: DUP_PALETTE[slot], count: counts.get(key) });
      });

    return marks;
  }

  function readCustomerKey(cell) {
    if (!cell) return "";
    const parts = [...cell.querySelectorAll(":scope > .ellipsis")];
    if (parts.length === 2) {
      // 用 textContent 不用 innerText：这里每趟都要跑 50 行，innerText 会强制同步布局
      const name = normText(parts[0].textContent);
      const code = normText(parts[1].textContent);
      // 只要名字在就用 customerColorKey：税号为空时（「个人」「聂俊霞」这类）
      // 两边都必须退化成「只有名字」，否则表格用整格文本、批量清单用名字，
      // 同一个客户会分成两个 key，清单里就查不到表格算出的颜色。
      if (name) return customerColorKey(name, code);
    }
    return normText(cell.textContent);
  }

  /* 同名客户只做两件事：行首 4px 同色竖线 + 客户格右上角 ×N（这组一共几张）。
     颜色按客户名哈希定，同一个客户换页、刷新都是同一个颜色，翻页也能对上；
     一页里万一两组撞到同一个色号，后面的顺延一格，避免看着像一组。 */
  function paintDuplicateCustomers(tableRoot = observedTableRoot) {
    if (!tableRoot || !enabled) return;

    const customerIdx = getHeaderIndexMap(tableRoot).get("开票客户");
    if (customerIdx === undefined) return;

    const rows = getBodyRows(tableRoot);

    // 分配逻辑统一在 buildCustomerColorMarks 里（批量下载清单用的是同一个函数），
    // 同一个客户在这里的竖线和在清单里的色条保证是同一个色号
    const marks = new Map();
    buildCustomerColorMarks(
      rows.map((tr) => readCustomerKey(tr.children[customerIdx]))
    ).forEach((mark, key) => {
      marks.set(key, { line: mark.color, count: "×" + mark.count });
    });

    rows.forEach((tr) => {
      const key = readCustomerKey(tr.children[customerIdx]);
      const mark = marks.get(key);
      const cell = tr.children[customerIdx];

      if (!mark) {
        if (tr.hasAttribute("data-tm-dup")) {
          tr.removeAttribute("data-tm-dup");
          tr.style.removeProperty("--tm-dup-line");
        }
        if (cell) cell.removeAttribute("data-tm-dup-count");
        return;
      }

      if (tr.style.getPropertyValue("--tm-dup-line") !== mark.line) {
        tr.setAttribute("data-tm-dup", "1");
        tr.style.setProperty("--tm-dup-line", mark.line);
      }
      if (cell && cell.getAttribute("data-tm-dup-count") !== mark.count) {
        cell.setAttribute("data-tm-dup-count", mark.count);
      }
    });
  }

  function processRowsIncremental(tableRoot = observedTableRoot) {
    if (!tableRoot) return;

    const columnIndexes = getHeaderIndexMap(tableRoot);
    getBodyRows(tableRoot).forEach((tr) => processRow(tr, columnIndexes));
    paintDuplicateCustomers(tableRoot);
  }

  /******************** 7.5) 设置面板：文案替换 + 列宽 ********************/
  const SETTINGS_PANEL_ID = "tm-invoice-settings-panel";

  function closeSettingsPanel() {
    const panel = document.getElementById(SETTINGS_PANEL_ID);
    if (panel) panel.style.display = "none";
  }

  function createSettingsRow(source, target) {
    const row = document.createElement("div");
    row.className = "tm-set-row";

    const from = document.createElement("input");
    from.className = "tm-set-input tm-set-from";
    from.type = "text";
    from.placeholder = "原文（页面上的文字）";
    from.value = source || "";

    const arrow = document.createElement("span");
    arrow.className = "tm-set-arrow";
    arrow.textContent = "→";

    const to = document.createElement("input");
    to.className = "tm-set-input tm-set-to";
    to.type = "text";
    to.placeholder = "改成什么（留空 = 不显示）";
    to.value = target || "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tm-set-remove";
    remove.textContent = "×";
    remove.title = "删除这一条";
    remove.addEventListener("click", () => row.remove());

    row.append(from, arrow, to, remove);
    return row;
  }

  // 设置面板里「列」那一行：勾选框 + 列名 + ↑↓
  function createColumnSettingRow(id) {
    const def = COLUMN_DEF_BY_ID.get(id);
    if (!def) return null;

    const row = document.createElement("div");
    row.className = "tm-set-col";
    row.dataset.id = id;

    const label = document.createElement("label");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "tm-set-col-check";
    box.checked = !hiddenColumnIds.has(id);

    const name = document.createElement("span");
    name.className = "tm-set-col-name";
    name.textContent = def.header;

    label.append(box, name);

    if (def.virtual) {
      const tag = document.createElement("span");
      tag.className = "tm-set-col-tag";
      tag.textContent = "新增列";
      label.appendChild(tag);
    }

    const up = document.createElement("button");
    up.type = "button";
    up.className = "tm-set-move";
    up.dataset.dir = "-1";
    up.textContent = "↑";
    up.title = "往前移一列";

    const down = document.createElement("button");
    down.type = "button";
    down.className = "tm-set-move";
    down.dataset.dir = "1";
    down.textContent = "↓";
    down.title = "往后移一列";

    const sync = () => row.classList.toggle("is-off", !box.checked);
    box.addEventListener("change", sync);
    sync();

    row.append(label, up, down);
    return row;
  }

  function ensureSettingsPanel() {
    let panel = document.getElementById(SETTINGS_PANEL_ID);
    if (panel) return panel;

    const style = document.createElement("style");
    style.id = SETTINGS_PANEL_ID + "-style";
    style.textContent = `
      #${SETTINGS_PANEL_ID} {
        position: fixed; inset: 0; z-index: 2147483000; display: none;
        background: rgba(15,23,42,.35);
        font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
      }
      #${SETTINGS_PANEL_ID} * { box-sizing: border-box; }
      #${SETTINGS_PANEL_ID} .tm-set-box {
        position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 580px; max-width: 92vw; max-height: 86vh;
        display: flex; flex-direction: column;
        background: #fff; border-radius: 10px; box-shadow: 0 20px 60px rgba(15,23,42,.28);
      }
      #${SETTINGS_PANEL_ID} .tm-set-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 18px; border-bottom: 1px solid #f0f0f0;
        font-size: 15px; font-weight: 600;
      }
      #${SETTINGS_PANEL_ID} .tm-set-close {
        cursor: pointer; color: #9ca3af; font-size: 18px; line-height: 1;
        padding: 2px 4px; border-radius: 4px;
      }
      #${SETTINGS_PANEL_ID} .tm-set-close:hover { color: #ff4d4f; background: #fff1f0; }
      #${SETTINGS_PANEL_ID} .tm-set-body { padding: 14px 18px; overflow: auto; }
      #${SETTINGS_PANEL_ID} h4 { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
      #${SETTINGS_PANEL_ID} .tm-set-tip { margin: 0 0 10px; color: #9ca3af; font-size: 12px; }
      #${SETTINGS_PANEL_ID} .tm-set-section + .tm-set-section {
        margin-top: 16px; padding-top: 14px; border-top: 1px solid #f5f5f5;
      }
      #${SETTINGS_PANEL_ID} .tm-set-rows { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
      #${SETTINGS_PANEL_ID} .tm-set-row { display: flex; align-items: center; gap: 8px; }
      #${SETTINGS_PANEL_ID} .tm-set-input {
        flex: 1 1 0; min-width: 0; height: 30px; padding: 0 8px;
        border: 1px solid #d9d9d9; border-radius: 6px;
        font-size: 13px; color: #1f2937; background: #fff;
      }
      #${SETTINGS_PANEL_ID} .tm-set-input:focus {
        outline: none; border-color: #237ffe; box-shadow: 0 0 0 2px rgba(35,127,254,.12);
      }
      #${SETTINGS_PANEL_ID} .tm-set-arrow { color: #bfbfbf; flex: 0 0 auto; }
      #${SETTINGS_PANEL_ID} .tm-set-remove {
        flex: 0 0 auto; width: 26px; height: 26px; border: none; border-radius: 6px;
        background: #f5f5f5; color: #8c8c8c; font-size: 15px; line-height: 1; cursor: pointer;
      }
      #${SETTINGS_PANEL_ID} .tm-set-remove:hover { background: #fff1f0; color: #ff4d4f; }
      #${SETTINGS_PANEL_ID} .tm-set-add,
      #${SETTINGS_PANEL_ID} .tm-set-reset {
        height: 30px; padding: 0 12px; border: 1px dashed #d9d9d9; border-radius: 6px;
        background: #fafafa; color: #595959; font-size: 12px; cursor: pointer;
      }
      #${SETTINGS_PANEL_ID} .tm-set-add:hover { border-color: #237ffe; color: #237ffe; background: #f4f8ff; }
      #${SETTINGS_PANEL_ID} .tm-set-reset:hover { border-color: #ff4d4f; color: #ff4d4f; background: #fff8f7; }
      #${SETTINGS_PANEL_ID} .tm-set-foot {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 18px; border-top: 1px solid #f0f0f0;
      }
      #${SETTINGS_PANEL_ID} .tm-set-msg { flex: 1 1 auto; font-size: 12px; color: #16a34a; }
      #${SETTINGS_PANEL_ID} .tm-set-btn {
        height: 32px; padding: 0 16px; border-radius: 6px; border: 1px solid #d9d9d9;
        background: #fff; color: #1f2937; font-size: 13px; cursor: pointer;
      }
      #${SETTINGS_PANEL_ID} .tm-set-btn:hover { border-color: #237ffe; color: #237ffe; }
      #${SETTINGS_PANEL_ID} .tm-set-btn.primary {
        background: #237ffe; border-color: #237ffe; color: #fff;
      }
      #${SETTINGS_PANEL_ID} .tm-set-btn.primary:hover { background: #1a6fe0; color: #fff; }

      /* 列设置：一行 = 勾选框 + 列名 + 上下移 */
      #${SETTINGS_PANEL_ID} .tm-set-cols {
        display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;
      }
      #${SETTINGS_PANEL_ID} .tm-set-col {
        display: flex; align-items: center; gap: 8px;
        padding: 4px 6px; border: 1px solid #f0f0f0; border-radius: 6px; background: #fcfcfd;
      }
      #${SETTINGS_PANEL_ID} .tm-set-col.is-off { opacity: .45; }
      #${SETTINGS_PANEL_ID} .tm-set-col label {
        flex: 1 1 auto; display: flex; align-items: center; gap: 7px;
        cursor: pointer; min-width: 0;
      }
      #${SETTINGS_PANEL_ID} .tm-set-col input { margin: 0; cursor: pointer; }
      #${SETTINGS_PANEL_ID} .tm-set-col-name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${SETTINGS_PANEL_ID} .tm-set-col-tag {
        flex: 0 0 auto; padding: 0 5px; border-radius: 3px; font-size: 11px;
        color: #237ffe; background: #eef4ff;
      }
      #${SETTINGS_PANEL_ID} .tm-set-move {
        flex: 0 0 auto; width: 24px; height: 24px; padding: 0;
        border: 1px solid #e5e7eb; border-radius: 5px; background: #fff;
        color: #6b7280; font-size: 12px; line-height: 1; cursor: pointer;
      }
      #${SETTINGS_PANEL_ID} .tm-set-move:hover:not(:disabled) {
        border-color: #237ffe; color: #237ffe;
      }
      #${SETTINGS_PANEL_ID} .tm-set-move:disabled { opacity: .3; cursor: default; }
    `;
    document.head.appendChild(style);

    panel = document.createElement("div");
    panel.id = SETTINGS_PANEL_ID;

    const box = document.createElement("div");
    box.className = "tm-set-box";

    const head = document.createElement("div");
    head.className = "tm-set-head";
    const title = document.createElement("span");
    title.textContent = SCRIPT_VERSION ? `发票工具设置 · v${SCRIPT_VERSION}` : "发票工具设置";
    const close = document.createElement("span");
    close.className = "tm-set-close";
    close.textContent = "×";
    close.title = "关闭（Esc）";
    close.addEventListener("click", closeSettingsPanel);
    head.append(title, close);

    const body = document.createElement("div");
    body.className = "tm-set-body";

    // ① 文案替换
    const replaceSection = document.createElement("div");
    replaceSection.className = "tm-set-section";

    const replaceTitle = document.createElement("h4");
    replaceTitle.textContent = "文案替换";
    const replaceTip = document.createElement("p");
    replaceTip.className = "tm-set-tip";
    replaceTip.textContent =
      "左边填页面原本的文字，右边填你希望看到的；只替换表格单元格里的文字。改完点保存会刷新页面。";

    const rowsBox = document.createElement("div");
    rowsBox.className = "tm-set-rows";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "tm-set-add";
    addBtn.textContent = "+ 添加一行";
    addBtn.addEventListener("click", () => {
      const row = createSettingsRow("", "");
      rowsBox.appendChild(row);
      row.querySelector(".tm-set-from").focus();
      const bodyEl = panel.querySelector(".tm-set-body");
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    });

    const resetTextBtn = document.createElement("button");
    resetTextBtn.type = "button";
    resetTextBtn.className = "tm-set-reset";
    resetTextBtn.textContent = "恢复默认文案";
    resetTextBtn.addEventListener("click", () => {
      // 只把默认表填回输入框，点保存才真正写进去（留个反悔的余地）
      rowsBox.textContent = "";
      Object.entries(DEFAULT_TEXT_REPLACE).forEach(([source, target]) => {
        rowsBox.appendChild(createSettingsRow(source, target));
      });
      panel.querySelector(".tm-set-msg").textContent =
        "已填入默认文案，点「保存并刷新」才生效";
    });

    const replaceActions = document.createElement("div");
    replaceActions.style.display = "flex";
    replaceActions.style.gap = "8px";
    replaceActions.append(addBtn, resetTextBtn);

    replaceSection.append(replaceTitle, replaceTip, rowsBox, replaceActions);

    // ② 列宽
    const widthSection = document.createElement("div");
    widthSection.className = "tm-set-section";

    const widthTitle = document.createElement("h4");
    widthTitle.textContent = "列宽";
    const widthTip = document.createElement("p");
    widthTip.className = "tm-set-tip";
    widthTip.textContent =
      "直接在表头每一列的右边缘左右拖动就能改宽度；在边缘双击可把该列恢复成默认值。";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "tm-set-reset";
    resetBtn.textContent = "恢复全部默认列宽";
    resetBtn.addEventListener("click", () => {
      Object.keys(columnWidths).forEach((key) => delete columnWidths[key]);
      persistSettings();
      if (observedTableRoot) applyOrUpdateStyle();
      scheduleWork(true);
      panel.querySelector(".tm-set-msg").textContent = "列宽已恢复默认";
    });

    widthSection.append(widthTitle, widthTip, resetBtn);

    // ③ 列的顺序 + 显隐
    const colSection = document.createElement("div");
    colSection.className = "tm-set-section";

    const colTitle = document.createElement("h4");
    colTitle.textContent = "列的顺序与显示";
    const colTip = document.createElement("p");
    colTip.className = "tm-set-tip";
    colTip.textContent =
      "↑ ↓ 调整左右顺序，取消勾选就隐藏（例如只留公司名、把税号列关掉）。改完点「保存并刷新」生效。";

    const colBox = document.createElement("div");
    colBox.className = "tm-set-cols";

    const syncMoveButtons = () => {
      const rows = [...colBox.children];
      rows.forEach((row, index) => {
        const up = row.querySelector('.tm-set-move[data-dir="-1"]');
        const down = row.querySelector('.tm-set-move[data-dir="1"]');
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === rows.length - 1;
      });
    };

    const renderColumnRows = () => {
      rebuildColumnLayout();
      colBox.textContent = "";
      columnOrder.forEach((id) => {
        const row = createColumnSettingRow(id);
        if (row) colBox.appendChild(row);
      });
      syncMoveButtons();
    };

    colBox.addEventListener("click", (event) => {
      const button = event.target.closest(".tm-set-move");
      if (!button) return;
      event.preventDefault();

      const row = button.closest(".tm-set-col");
      if (!row) return;

      if (button.dataset.dir === "-1" && row.previousElementSibling) {
        colBox.insertBefore(row, row.previousElementSibling);
      } else if (button.dataset.dir === "1" && row.nextElementSibling) {
        colBox.insertBefore(row.nextElementSibling, row);
      }
      syncMoveButtons();
    });

    colSection.append(colTitle, colTip, colBox);
    // 每次打开面板时重画一遍（用户在别处拖过列宽、切过显示都不会丢）
    panel.__tmRenderColumns = renderColumnRows;

    // ④ 商品明细缓存
    const detailSection = document.createElement("div");
    detailSection.className = "tm-set-section";

    const detailTitle = document.createElement("h4");
    detailTitle.textContent = "商品明细缓存";

    const detailTip = document.createElement("p");
    detailTip.className = "tm-set-tip";
    detailTip.textContent =
      "已开票的明细不会变，脚本会把它们存在本机（30 天），刷新页面不再重复请求接口。怀疑某张票数据不对时可以清空重取。";

    const clearDetailBtn = document.createElement("button");
    clearDetailBtn.type = "button";
    clearDetailBtn.className = "tm-set-reset";
    clearDetailBtn.textContent = "清空明细缓存";
    clearDetailBtn.addEventListener("click", () => {
      clearDetailStore();
      clearDetailBtn.textContent = "已清空，刷新后重新拉取";
      clearDetailBtn.disabled = true;
    });

    detailSection.append(detailTitle, detailTip, clearDetailBtn);
    panel.__tmResetDetailBtn = () => {
      clearDetailBtn.textContent = "清空明细缓存";
      clearDetailBtn.disabled = false;
    };

    // 「列」放在最上面：文案替换有十几行，放后面每次都要滚很久才看得到
    body.append(colSection, replaceSection, widthSection, detailSection);

    const foot = document.createElement("div");
    foot.className = "tm-set-foot";

    const msg = document.createElement("span");
    msg.className = "tm-set-msg";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "tm-set-btn tm-set-cancel";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", closeSettingsPanel);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "tm-set-btn tm-set-save primary";
    saveBtn.textContent = "保存并刷新";
    saveBtn.addEventListener("click", () => {
      const next = {};
      rowsBox.querySelectorAll(".tm-set-row").forEach((row) => {
        const source = row.querySelector(".tm-set-from").value.trim();
        const target = row.querySelector(".tm-set-to").value.trim();
        if (source) next[source] = target;
      });

      TEXT_REPLACE = next;

      // 列顺序 + 显隐：按面板里现在的行序读回来
      const colBox = panel.querySelector(".tm-set-cols");
      if (colBox) {
        const rows = [...colBox.querySelectorAll(".tm-set-col")];
        const nextHidden = rows
          .filter((row) => {
            const box = row.querySelector(".tm-set-col-check");
            return box && !box.checked;
          })
          .map((row) => row.dataset.id);

        columnOrder = rows.map((row) => row.dataset.id);
        hiddenColumnIds = new Set(nextHidden);
        rebuildColumnLayout();
      }

      persistSettings();

      msg.textContent = "已保存，正在刷新页面…";
      setTimeout(() => location.reload(), 600);
    });

    foot.append(msg, cancelBtn, saveBtn);
    box.append(head, body, foot);
    panel.appendChild(box);

    // 点遮罩关闭（点面板本体不关）
    panel.addEventListener("mousedown", (event) => {
      if (event.target === panel) closeSettingsPanel();
    });

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeSettingsPanel();
      }
    });

    document.body.appendChild(panel);
    return panel;
  }

  function openSettingsPanel() {
    const panel = ensureSettingsPanel();
    const rowsBox = panel.querySelector(".tm-set-rows");

    rowsBox.textContent = "";
    Object.entries(TEXT_REPLACE).forEach(([source, target]) => {
      rowsBox.appendChild(createSettingsRow(source, target));
    });

    if (typeof panel.__tmRenderColumns === "function") panel.__tmRenderColumns();
    if (typeof panel.__tmResetDetailBtn === "function") panel.__tmResetDetailBtn();

    panel.querySelector(".tm-set-msg").textContent = "";
    panel.style.display = "block";
    panel.querySelector(".tm-set-body").scrollTop = 0;
  }

  /******************** 8) UI：按钮 + 快捷键 ********************/
  function ensureUiButton() {
    if (uiBtn && document.body.contains(uiBtn)) return;

    uiBtn = document.createElement("button");
    uiBtn.id = "tm-btn-invoice-settings";
    uiBtn.type = "button";
    uiBtn.title = withVersion("发票工具设置：文案替换、列宽");

    Object.assign(uiBtn.style, {
      position: "fixed",
      left: "40px",
      top: "850px",
      zIndex: "999999",
      padding: "8px 10px",
      border: "1px solid rgba(0,0,0,.2)",
      borderRadius: "8px",
      background: "#237ffe",
      color: "#fff",
      boxShadow: "0 2px 10px rgba(0,0,0,.15)",
      cursor: "pointer",
      userSelect: "none",
      fontSize: "12px",
    });

    uiBtn.addEventListener("click", (event) => {
      event.preventDefault();
      openSettingsPanel();
    });

    uiBtn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openSettingsPanel();
    });

    document.body.appendChild(uiBtn);
    updateUiLabel();
  }

  function removeUiButton() {
    const node = document.getElementById("tm-btn-invoice-settings");
    if (node) node.remove();
    uiBtn = null;
  }

  function updateUiLabel() {
    if (!uiBtn) return;

    uiBtn.textContent = "⚙ 设置";

    const adjustable = getAdjustableColumn();
    if (adjustable) {
      uiBtn.title = withVersion(`发票工具设置：文案替换、列宽（Alt+= / Alt+- 也可调「${adjustable.header}」列宽）`);
    }
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (!enabled || !event.altKey) return;

      if (event.code === "Equal") {
        event.preventDefault();
        changeCustomerWidth(WIDTH_STEP);
      } else if (event.code === "Minus") {
        event.preventDefault();
        changeCustomerWidth(-WIDTH_STEP);
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!enabled) return;
      const element = event.target;
      if (element?.closest?.(".ant-pagination")) {
        customerWidthDelta = 0;
        scheduleWork(true);
      }
    },
    true
  );

  /******************** 8.5) 发票下载：左键直下 PDF，右键选格式，列头批量 ********************/
  /* 站点原流程：点「下载发票」→ 调 /invoice/download/pdf 拿 pdfUrl/ofdUrl/xmlUrl → 弹窗让人选格式
     → 再点「PDF格式」才真正下载。这里把中间那步跳掉：
       · 左键 → 直接下 PDF（默认，不再弹窗）
       · 右键 → 就地弹菜单：PDF / OFD / XML 任选直下，或「使用原网页弹窗」退回站点原流程
       · 批量 → 「操作」列头右侧的「批量下载」按钮：表格里有勾选行就只列这些，没勾选就列本页全部，
         面板里自己勾要下的、选 PDF / OFD / XML；串行提交，进度实时提示，进行中再点即停止

     ⚠️ 实测口径（2026-10-27）：
     ① 接口响应只有 293 字节，data = { pdfUrl:[], ofdUrl:[], xmlUrl:[] }（短链 xforceplus）；
        本体由短链 301 到 tw-doc 才给，落地文件名取自响应头 Content-Disposition，不用自己起名。
     ② 本机装了 IDM，下载被 IDM 接管 ⇒ Chrome 自己的下载记录显示「已取消 / 0 字节」属正常现象，
        文件实际落在 IDM 的下载目录里，别据此判断失败。
     ③ 三个短链一次性缓存 5 分钟：同一条记录重复点（含换格式、批量）不再请求接口，且下载落在用户手势内，
        避免 Chrome「多次自动下载」把后一次挡掉。 */

  const DOWNLOAD_LINK_TEXT = "下载发票";
  const DOWNLOAD_API = "/soa/api/v1/invoice/download/pdf";
  const DOWNLOAD_CACHE_TTL = 5 * 60 * 1000;
  const DOWNLOAD_CACHE_MAX = 200;
  const DOWNLOAD_TIP_ID = "tm-invoice-download-tip";
  const DOWNLOAD_MENU_ID = "tm-invoice-download-menu";
  const DOWNLOAD_FALLBACK_REGION = "XX";
  const DOWNLOAD_BATCH_GAP = 700; // 批量时每张的提交间隔，太快会被浏览器/IDM 挤掉
  const DOWNLOAD_FORMAT_LABEL = { pdf: "PDF", ofd: "OFD", xml: "XML" };
  const DOWNLOAD_FORMAT_FIELD = { pdf: "pdfUrl", ofd: "ofdUrl", xml: "xmlUrl" };

  const downloadUrlCache = new Map(); // applyCode → { urls, at }
  const downloadPending = new Set(); // 正在取 URL 的 applyCode（防连点）
  let downloadTipTimer = null;
  let menuTargetLink = null; // 右键点中的那条「下载发票」
  let bypassNextClick = false; // 放行一次点击，让站点自己的「选格式」弹窗出来
  let batchState = null; // { format, total, done, cancelled }

  // 行的申请单号：状态格里的 div#applyCode-xxx 就是接口要的 applyCode；退一步用 data-row-key
  function getRowApplyCode(tr) {
    const holder = tr?.querySelector('[id^="applyCode-"]');
    if (holder) return holder.id.slice("applyCode-".length);
    return (tr?.getAttribute("data-row-key") || "").trim();
  }

  // 判断这条链接是不是发票表格里的「下载发票」；是则返回链接元素，否则 null
  function getDownloadLink(node) {
    const link = node?.closest?.("a");
    if (!link || normText(link.innerText) !== DOWNLOAD_LINK_TEXT) return null;
    // 只管发票表格里的那个「下载发票」，别误伤别处的同名链接
    if (!link.closest(TABLE_SELECTOR)) return null;
    return link;
  }

  function triggerFileDownload(url) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    // ⚠️ 不能立刻 remove —— 下载接管（含 IDM 抢链）要一拍时间，删早了会把下载一起取消
    setTimeout(() => anchor.remove(), 20000);
  }

  function showDownloadTip(text, ok, holdMs) {
    let tip = document.getElementById(DOWNLOAD_TIP_ID);

    if (!tip) {
      tip = document.createElement("div");
      tip.id = DOWNLOAD_TIP_ID;
      Object.assign(tip.style, {
        position: "fixed",
        left: "50%",
        bottom: "40px",
        transform: "translateX(-50%)",
        zIndex: "9999999",
        padding: "10px 16px",
        borderRadius: "8px",
        fontSize: "13px",
        lineHeight: "20px",
        color: "#fff",
        boxShadow: "0 4px 16px rgba(0,0,0,.18)",
        pointerEvents: "none",
        maxWidth: "60vw",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      document.body.appendChild(tip);
    }

    tip.style.background = ok ? "#16a34a" : "#dc2626";
    tip.textContent = text;
    tip.style.display = "block";

    if (downloadTipTimer) clearTimeout(downloadTipTimer);
    downloadTipTimer = setTimeout(
      () => {
        tip.style.display = "none";
      },
      holdMs || (ok ? 1600 : 3600)
    );
  }

  /********** 接口：一次拿三种格式的短链 **********/
  function pickFirstUrl(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value) || !value.length) return "";
    return String(value[0] || "");
  }

  async function fetchInvoiceUrls(applyCode, regionCode) {
    const response = await fetch(DOWNLOAD_API, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        mnClientId: SOA_CLIENT_ID,
      },
      body: JSON.stringify({ regionCode, applyCode }),
    });

    const json = await response.json();
    const data = (json && json.data) || {};
    return {
      pdf: pickFirstUrl(data.pdfUrl),
      ofd: pickFirstUrl(data.ofdUrl),
      xml: pickFirstUrl(data.xmlUrl),
    };
  }

  async function getInvoiceUrls(applyCode) {
    const cached = downloadUrlCache.get(applyCode);
    if (cached && Date.now() - cached.at < DOWNLOAD_CACHE_TTL) return cached.urls;

    let urls = await fetchInvoiceUrls(
      applyCode,
      soaRegionCode || DOWNLOAD_FALLBACK_REGION
    );

    // 页面记下的 regionCode 万一不对，退回站点一直在用的那个再试一次
    const empty = !urls.pdf && !urls.ofd && !urls.xml;
    if (empty && soaRegionCode && soaRegionCode !== DOWNLOAD_FALLBACK_REGION) {
      urls = await fetchInvoiceUrls(applyCode, DOWNLOAD_FALLBACK_REGION);
    }
    if (empty && !urls.pdf && !urls.ofd && !urls.xml) return null;

    if (downloadUrlCache.size >= DOWNLOAD_CACHE_MAX) {
      downloadUrlCache.delete(downloadUrlCache.keys().next().value);
    }
    downloadUrlCache.set(applyCode, { urls, at: Date.now() });
    return urls;
  }

  /********** 单张下载 **********/
  async function startDownload(applyCode, type = "pdf") {
    const format = DOWNLOAD_FORMAT_FIELD[type] ? type : "pdf";
    const label = DOWNLOAD_FORMAT_LABEL[format];

    // 命中缓存就地同步触发，保住用户手势（更不容易被「多次自动下载」挡掉）
    const cached = downloadUrlCache.get(applyCode);
    if (cached && Date.now() - cached.at < DOWNLOAD_CACHE_TTL) {
      const url = cached.urls[format];
      if (!url) {
        showDownloadTip("这张发票没有可取到的 " + label + " 文件", false);
        return;
      }
      triggerFileDownload(url);
      showDownloadTip("已开始下载 " + label, true);
      return;
    }

    if (downloadPending.has(applyCode)) {
      showDownloadTip("正在获取下载链接，请稍候", false);
      return;
    }
    downloadPending.add(applyCode);

    try {
      const urls = await getInvoiceUrls(applyCode);
      const url = urls && urls[format];

      if (!url) {
        showDownloadTip("这张发票没有可取到的 " + label + " 文件", false);
        return;
      }

      triggerFileDownload(url);
      showDownloadTip("已开始下载 " + label, true);
    } catch (error) {
      showDownloadTip("获取发票 " + label + " 失败，请稍后重试", false);
    } finally {
      downloadPending.delete(applyCode);
    }
  }

  /********** 批量下载 **********/
  // 本页所有可下载的发票：申请单号 + 面板上给人看的几列
  /* 开票客户格里是两个 div：名称 + 税号。批量面板要按客户分组上色，所以单独取出来。 */
  function getCustomerOfRow(cell) {
    if (!cell) return { customer: "", customerCode: "" };

    const parts = cell.querySelectorAll(":scope > .ellipsis");
    if (parts.length >= 2) {
      const name = normText(parts[0].innerText || parts[0].getAttribute("title"));
      const code = normText(parts[1].innerText || parts[1].getAttribute("title"));
      if (name) return { customer: name, customerCode: code };
    }

    const full = normText(cell.innerText);
    if (!full) return { customer: "", customerCode: "" };

    // 退路：整格文本形如「客户名，91410100MA444YUR45」
    const matched = full.match(/^([\s\S]*?)[，,]\s*([0-9A-Z]{15,20})$/);
    if (matched) {
      return { customer: normText(matched[1]), customerCode: matched[2] };
    }

    return { customer: full, customerCode: "" };
  }

  // 金额格的纯金额文本（去掉「数量 × 单价」那行小字），批量面板/复制都用它
  function getAmountText(cell) {
    if (!cell) return "";
    if (!cell.querySelector(":scope > .tm-qty-hint")) return normText(cell.innerText);

    const clone = cell.cloneNode(true);
    clone.querySelectorAll(".tm-qty-hint").forEach((node) => node.remove());
    return normText(clone.innerText);
  }

  function collectInvoiceRows() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return [];

    const indexMap = getHeaderIndexMap(table);
    const sellerIdx = indexMap.get("销方公司");
    const customerIdx = indexMap.get("开票客户");
    const amountIdx = indexMap.get(AMOUNT_COLUMN_HEADER);
    const applyNoIdx =
      indexMap.get("申请单号") !== undefined
        ? indexMap.get("申请单号")
        : indexMap.get("申请单");

    // 表格里有勾选行就只列这些（站点以后加了行选择也能直接用上）
    const rows = getBodyRows(table);
    const selected = rows.filter((tr) =>
      tr.classList.contains("ant-table-row-selected")
    );
    const pool = selected.length ? selected : rows;

    const seen = new Set();
    const list = [];

    pool.forEach((tr) => {
      const hasLink = [...tr.querySelectorAll("a")].some(
        (a) => normText(a.innerText) === DOWNLOAD_LINK_TEXT
      );
      if (!hasLink) return;

      const applyCode = getRowApplyCode(tr);
      if (!applyCode || seen.has(applyCode)) return;
      seen.add(applyCode);

      list.push({
        applyCode,
        seller:
          sellerIdx !== undefined
            ? normText(tr.children[sellerIdx]?.innerText)
            : "",
        applyNo:
          applyNoIdx !== undefined
            ? normText(tr.children[applyNoIdx]?.innerText)
            : "",
        ...getCustomerOfRow(
          customerIdx !== undefined ? tr.children[customerIdx] : null
        ),
        amount:
          amountIdx !== undefined
            ? getAmountText(tr.children[amountIdx])
            : "",
      });
    });

    return list;
  }

  // 面板里一行怎么显示：开票客户优先，实在没有才退回销方 / 申请单号
  function getBatchLabel(item) {
    return [item.customer, item.seller, item.applyNo || item.applyCode]
      .filter(Boolean)[0] || "";
  }

  function cancelBatchDownload() {
    if (batchState) batchState.cancelled = true;
  }

  async function startBatchDownload(type, codes) {
    if (batchState) return;

    const format = DOWNLOAD_FORMAT_FIELD[type] ? type : "pdf";
    const label = DOWNLOAD_FORMAT_LABEL[format];
    const targets =
      Array.isArray(codes) && codes.length
        ? codes
        : collectInvoiceRows().map((item) => item.applyCode);

    if (!targets.length) {
      showDownloadTip("没有可批量下载的发票", false);
      return;
    }

    batchState = { format, total: targets.length, done: 0, cancelled: false };
    refreshBatchHeadButtons();
    showDownloadTip("正在下载 " + label + " 0/" + targets.length, true, 600000);

    let ok = 0;
    let skipped = 0;
    let cancelled = false;

    for (let index = 0; index < targets.length; index += 1) {
      if (batchState.cancelled) {
        cancelled = true;
        break;
      }

      let url = "";
      try {
        const urls = await getInvoiceUrls(targets[index]);
        url = (urls && urls[format]) || "";
      } catch (error) {
        url = "";
      }

      if (url) {
        triggerFileDownload(url);
        ok += 1;
      } else {
        skipped += 1;
      }

      batchState.done = index + 1;
      refreshBatchHeadButtons();
      showDownloadTip(
        "正在下载 " + label + " " + (index + 1) + "/" + targets.length,
        true,
        600000
      );

      // 最后一张不用等；间隔给浏览器/IDM 一点处理时间
      if (index < targets.length - 1 && !batchState.cancelled) {
        await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_BATCH_GAP));
      }
    }

    if (batchState.cancelled) cancelled = true;
    batchState = null;
    refreshBatchHeadButtons();

    if (cancelled) {
      showDownloadTip("已停止，已提交 " + ok + " 张 " + label, false);
      return;
    }
    if (skipped) {
      showDownloadTip(
        "已提交 " + ok + " 张 " + label + "，" + skipped + " 张没有该格式",
        false
      );
      return;
    }
    showDownloadTip("已提交 " + ok + " 张 " + label + " 下载", true);
  }

  // 什么都不拦，放站点自己的 onClick 跑一遍（弹回原来的「选择发票格式」窗口）
  function openSiteDialog(link) {
    bypassNextClick = true;
    // 兜底：万一这次 click 没进到拦截器（例如链接被重渲染），1s 后自动复位
    setTimeout(() => {
      bypassNextClick = false;
    }, 1000);
    link.click();
  }

  /********** 批量下载面板：自己勾选要下哪几张、用哪种格式 **********/
  function ensureBatchPanel() {
    const panelId = DOWNLOAD_MENU_ID + "-batch";
    let panel = document.getElementById(panelId);

    // 新旧两版并存时，同名面板可能是旧版建的（结构、样式都对不上），校验后重建
    if (panel && panel.dataset.tmBuild !== "2") {
      panel.remove();
      const oldStyle = document.getElementById(panelId + "-style");
      if (oldStyle) oldStyle.remove();
      panel = null;
    }
    if (panel) return panel;

    const style = document.createElement("style");
    style.id = panelId + "-style";
    style.textContent = `
      #${panelId} {
        position: fixed; inset: 0; z-index: 2147483000; display: none;
        background: rgba(15,23,42,.35);
        font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
      }
      #${panelId} * { box-sizing: border-box; }
      #${panelId} .tm-batch-box {
        position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 620px; max-width: 92vw; max-height: 84vh;
        display: flex; flex-direction: column;
        background: #fff; border-radius: 10px; box-shadow: 0 20px 60px rgba(15,23,42,.28);
      }
      #${panelId} .tm-batch-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 16px; border-bottom: 1px solid #f0f0f0;
        font-size: 15px; font-weight: 600;
      }
      #${panelId} .tm-batch-close {
        cursor: pointer; color: #9ca3af; font-size: 18px; line-height: 1; padding: 2px 4px;
        border-radius: 4px;
      }
      #${panelId} .tm-batch-close:hover { color: #ff4d4f; background: #fff1f0; }
      #${panelId} .tm-batch-formats { display: flex; align-items: center; gap: 8px; padding: 12px 16px 0; }
      #${panelId} .tm-batch-fmt-label { font-size: 12px; color: #8c8c8c; margin-right: 2px; }
      #${panelId} .tm-batch-fmt {
        height: 30px; padding: 0 14px; border: 1px solid #d9d9d9; border-radius: 6px;
        background: #fff; color: #595959; font-size: 13px; cursor: pointer;
      }
      #${panelId} .tm-batch-fmt:hover { border-color: #237ffe; color: #237ffe; }
      #${panelId} .tm-batch-fmt.is-active {
        border-color: #237ffe; color: #237ffe; background: #f4f8ff;
      }
      #${panelId} .tm-batch-bar {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 16px 8px; font-size: 12px; color: #595959; cursor: pointer;
      }
      #${panelId} .tm-batch-count { margin-left: auto; color: #9ca3af; }
      #${panelId} .tm-batch-list {
        margin: 0 16px 12px; border: 1px solid #f0f0f0; border-radius: 8px;
        overflow: auto; max-height: 44vh; min-height: 60px;
      }
      #${panelId} .tm-batch-item {
        display: flex; align-items: center; gap: 8px;
        padding: 7px 10px 7px 8px; cursor: pointer; border-bottom: 1px solid #fafafa;
        /* 同一家客户只留左边一条 4px 同色竖线，与表格里的同名标记完全一致
           （2026-10-27 统一）：整行铺淡底会和勾选框的选中态混在一起，清单一长就显花。 */
        border-left: 4px solid var(--tm-group-color, transparent);
      }
      #${panelId} .tm-batch-item:last-child { border-bottom: none; }
      #${panelId} .tm-batch-item:hover { background: #fafafa; }
      #${panelId} .tm-batch-item input { flex: 0 0 auto; margin: 0; }
      /* 名称 / 税号 分成两列（原来税号紧跟名字后面，名字一长就被推走 ⇒ 整列参差不齐）。
         两列都定宽 + ellipsis，右边金额再定宽右对齐，三列才能各就各位。 */
      #${panelId} .tm-batch-item-text {
        flex: 1 1 auto; min-width: 0;
        display: grid; grid-template-columns: minmax(0, 1fr) 138px;
        align-items: center; column-gap: 10px;
      }
      #${panelId} .tm-batch-item-name {
        min-width: 0; font-weight: 600; color: #1f2937;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${panelId} .tm-batch-item-code {
        min-width: 0; color: #a8b0bd; font-size: 12px;
        font-variant-numeric: tabular-nums;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${panelId} .tm-batch-item-amount {
        flex: 0 0 auto; width: 84px; text-align: right;
        color: #595959; font-style: normal;
        font-variant-numeric: tabular-nums;
      }
      #${panelId} .tm-batch-foot {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 12px 16px; border-top: 1px solid #f0f0f0;
      }
      #${panelId} .tm-batch-btn {
        height: 32px; padding: 0 16px; border-radius: 6px; border: 1px solid #d9d9d9;
        background: #fff; color: #1f2937; font-size: 13px; cursor: pointer;
      }
      #${panelId} .tm-batch-btn:hover { border-color: #237ffe; color: #237ffe; }
      #${panelId} .tm-batch-btn.primary {
        background: #237ffe; border-color: #237ffe; color: #fff;
      }
      #${panelId} .tm-batch-btn.primary:hover { background: #1a6fe0; color: #fff; }
    `;
    document.head.appendChild(style);

    panel = document.createElement("div");
    panel.id = panelId;
    panel.dataset.tmBuild = "2";

    const box = document.createElement("div");
    box.className = "tm-batch-box";

    const head = document.createElement("div");
    head.className = "tm-batch-head";
    const title = document.createElement("span");
    title.className = "tm-batch-title";
    title.textContent = "批量下载发票";
    const close = document.createElement("span");
    close.className = "tm-batch-close";
    close.textContent = "×";
    close.title = "关闭";
    head.append(title, close);

    const formats = document.createElement("div");
    formats.className = "tm-batch-formats";
    const formatsLabel = document.createElement("span");
    formatsLabel.className = "tm-batch-fmt-label";
    formatsLabel.textContent = "格式";
    formats.appendChild(formatsLabel);

    ["pdf", "ofd", "xml"].forEach((format) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "tm-batch-fmt" + (format === "pdf" ? " is-active" : "");
      button.dataset.format = format;
      button.textContent = DOWNLOAD_FORMAT_LABEL[format];
      button.addEventListener("click", () => {
        formats.querySelectorAll(".tm-batch-fmt").forEach((node) => {
          node.classList.toggle("is-active", node.dataset.format === format);
        });
      });
      formats.appendChild(button);
    });

    const bar = document.createElement("label");
    bar.className = "tm-batch-bar";
    const allBox = document.createElement("input");
    allBox.type = "checkbox";
    allBox.className = "tm-batch-all";
    const barText = document.createElement("span");
    barText.textContent = "全选";
    const count = document.createElement("span");
    count.className = "tm-batch-count";
    bar.append(allBox, barText, count);

    const list = document.createElement("div");
    list.className = "tm-batch-list";

    const foot = document.createElement("div");
    foot.className = "tm-batch-foot";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "tm-batch-btn tm-batch-cancel";
    cancel.textContent = "取消";
    const start = document.createElement("button");
    start.type = "button";
    start.className = "tm-batch-btn tm-batch-start primary";
    start.textContent = "开始下载";
    foot.append(cancel, start);

    box.append(head, formats, bar, list, foot);
    panel.appendChild(box);
    document.body.appendChild(panel);

    const syncCount = () => {
      const boxes = [...list.querySelectorAll(".tm-batch-item input")];
      const checked = boxes.filter((input) => input.checked).length;

      count.textContent = "已选 " + checked + "/" + boxes.length;
      allBox.checked = checked > 0 && checked === boxes.length;
      allBox.indeterminate = checked > 0 && checked < boxes.length;

      const disabled = checked === 0;
      start.disabled = disabled;
      start.style.opacity = disabled ? ".5" : "1";
      start.style.cursor = disabled ? "not-allowed" : "pointer";
    };

    allBox.addEventListener("change", () => {
      list.querySelectorAll(".tm-batch-item input").forEach((input) => {
        input.checked = allBox.checked;
      });
      syncCount();
    });

    list.addEventListener("change", syncCount);

    const hide = () => {
      panel.style.display = "none";
    };

    close.addEventListener("click", hide);
    cancel.addEventListener("click", hide);
    panel.addEventListener("mousedown", (event) => {
      if (event.target === panel) hide();
    });

    // ESC 关面板。只在自己开着的时候拦，别把按键连带吞给站点。
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape" && event.key !== "Esc") return;
        if (panel.style.display === "none") return;
        event.preventDefault();
        event.stopPropagation();
        hide();
      },
      true
    );

    start.addEventListener("click", () => {
      const codes = [...list.querySelectorAll(".tm-batch-item input")]
        .filter((input) => input.checked)
        .map((input) => input.value);
      if (!codes.length) return;

      const active = formats.querySelector(".tm-batch-fmt.is-active");
      const format = active ? active.dataset.format : "pdf";

      hide();
      startBatchDownload(format, codes);
    });

    panel.tmSyncCount = syncCount;
    return panel;
  }

  /* 批量面板的分组色条已并入表格那套（buildCustomerColorMarks），
     原来按「首次出现顺序」取号的 BATCH_GROUP_COLORS 已删除：
     顺序取号会导致同一个客户在列表和清单里颜色不一致。 */

  function openBatchPanel() {
    const items = collectInvoiceRows();
    if (!items.length) {
      showDownloadTip("没有可批量下载的发票", false);
      return;
    }

    const panel = ensureBatchPanel();
    const title = panel.querySelector(".tm-batch-title");
    const list = panel.querySelector(".tm-batch-list");

    title.textContent = "批量下载发票（共 " + items.length + " 张）";
    list.textContent = "";

    // 同一家客户在清单里用同一个色条，而且要求和列表里「一模一样」。
    // 只靠哈希还差一步：撞色时要顺延一格，顺延结果取决于「这一屏有哪几个重复组」，
    // 表格按 50 行算、清单只有 44 张（没下下载链接的行不在清单里），
    // 两边的组集合不同就会把顺延结果算歪 —— 2026-10-27 实测 7 组里有 2 组错开。
    // 所以这里不自己算：直接拿表格这一屏的客户 key 走同一个分配函数
    // （paintDuplicateCustomers 用的也是它，同样的 key、同样的排序），
    // 算出来必然和列表里一致。清单里是蓝的，回到列表里也是蓝的。
    const colorKeyOf = (item) => customerColorKey(item.customer, item.customerCode);
    const colorTableRoot = observedTableRoot || document.querySelector(TABLE_SELECTOR);
    const colorCustomerIdx = colorTableRoot
      ? getHeaderIndexMap(colorTableRoot).get("开票客户")
      : undefined;
    const screenKeys =
      colorTableRoot && colorCustomerIdx !== undefined
        ? getBodyRows(colorTableRoot).map((tr) =>
            readCustomerKey(tr.children[colorCustomerIdx])
          )
        : [];
    const colorMarks = buildCustomerColorMarks(
      screenKeys.length ? screenKeys : items.map(colorKeyOf)
    );

    items.forEach((item) => {
      const row = document.createElement("label");
      row.className = "tm-batch-item";

      // 显示的是替换后的客户名（和页面上看到的一致），但配色按「原名 + 税号」算，
      // 替换只是换个叫法，同一家还是同一家，得和列表里一个色
      const customer = safeReplaceText(item.customer || "");
      const fallback = item.seller || item.applyNo || item.applyCode;
      const shown = customer || fallback;

      const mark = colorMarks.get(colorKeyOf(item));
      if (mark) row.style.setProperty("--tm-group-color", mark.color);

      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = item.applyCode;
      box.checked = true;

      const text = document.createElement("span");
      text.className = "tm-batch-item-text";

      const name = document.createElement("b");
      name.className = "tm-batch-item-name";
      name.textContent = shown;

      const code = document.createElement("span");
      code.className = "tm-batch-item-code";
      code.textContent = item.customerCode || "";

      text.append(name, code);
      text.title = [
        customer || item.customer,
        item.customerCode,
        item.seller,
        item.applyNo || item.applyCode,
        item.amount,
      ]
        .filter(Boolean)
        .join(" ｜ ");

      const amount = document.createElement("em");
      amount.className = "tm-batch-item-amount";
      amount.textContent = item.amount;

      row.append(box, text, amount);
      list.appendChild(row);
    });

    panel.style.display = "block";
    list.scrollTop = 0;
    if (panel.tmSyncCount) panel.tmSyncCount();
  }

  /********** 悬浮提示：让人知道能点、也能右键 **********/
  const HOVER_TIP_ID = DOWNLOAD_MENU_ID + "-hover";
  let hoverTipTimer = null;

  function hideHoverTip() {
    if (hoverTipTimer) {
      clearTimeout(hoverTipTimer);
      hoverTipTimer = null;
    }
    const tip = document.getElementById(HOVER_TIP_ID);
    if (tip) tip.style.display = "none";
  }

  function showHoverTip(link) {
    let tip = document.getElementById(HOVER_TIP_ID);

    if (!tip) {
      tip = document.createElement("div");
      tip.id = HOVER_TIP_ID;
      Object.assign(tip.style, {
        position: "fixed",
        zIndex: "2147483500",
        display: "none",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "rgba(17,24,39,.94)",
        color: "#fff",
        fontSize: "12px",
        lineHeight: "18px",
        boxShadow: "0 8px 20px rgba(0,0,0,.22)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      });
      tip.innerHTML =
        "<b>左键</b>：直接下载 PDF<br><b>右键</b>：选格式 / 原弹窗";
      document.body.appendChild(tip);
    }

    tip.style.display = "block";
    tip.style.left = "0px";
    tip.style.top = "0px";

    const rect = link.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 6;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

    let top = rect.bottom + gap;
    if (top + tipRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - tipRect.height - gap);
    }

    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }

  document.addEventListener(
    "mouseover",
    (event) => {
      if (!enabled) return;

      const link = getDownloadLink(event.target);
      if (!link) return;
      if (event.relatedTarget && link.contains(event.relatedTarget)) return;

      hideHoverTip();
      hoverTipTimer = setTimeout(() => {
        hoverTipTimer = null;
        if (link.isConnected) showHoverTip(link);
      }, 350);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    (event) => {
      const link = getDownloadLink(event.target);
      if (!link) return;
      if (event.relatedTarget && link.contains(event.relatedTarget)) return;
      hideHoverTip();
    },
    true
  );

  /********** 右键菜单 **********/
  function isMenuVisible() {
    const menu = document.getElementById(DOWNLOAD_MENU_ID);
    return !!menu && menu.style.display !== "none";
  }

  function hideDownloadMenu() {
    const menu = document.getElementById(DOWNLOAD_MENU_ID);
    if (menu) menu.style.display = "none";
    menuTargetLink = null;
  }

  function buildMenuItem(label, hint, type) {
    const item = document.createElement("div");
    item.className = "tm-inv-menu-item";
    item.dataset.type = type;

    const text = document.createElement("span");
    text.className = "tm-inv-menu-label";
    text.textContent = label;
    item.appendChild(text);

    if (hint) {
      const note = document.createElement("span");
      note.className = "tm-inv-menu-hint";
      note.textContent = hint;
      item.appendChild(note);
    }
    return item;
  }

  function ensureDownloadMenu() {
    let menu = document.getElementById(DOWNLOAD_MENU_ID);

    // 页面上可能残留别的版本建的同名菜单（例如新旧两版并存时装过），结构对不上就重建
    if (menu && menu.dataset.tmBuild !== "3") {
      menu.remove();
      menu = null;
    }
    if (menu) return menu;

    const style = document.createElement("style");
    style.id = DOWNLOAD_MENU_ID + "-style";
    style.textContent = [
      "div#" + DOWNLOAD_MENU_ID + "{position:fixed;z-index:2147483600;display:none;",
      "min-width:150px;padding:6px 0;background:#fff;border:1px solid #e8e8e8;border-radius:8px;",
      "box-shadow:0 8px 24px rgba(15,23,42,.16);color:#1f2937;",
      "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;",
      "user-select:none;-webkit-user-select:none}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-item{display:flex;align-items:center;",
      "justify-content:space-between;gap:16px;padding:7px 14px;cursor:pointer;white-space:nowrap}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-item:hover{background:#f4f0ff;color:#6d28d9}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-item.is-disabled{opacity:.4;cursor:not-allowed;",
      "pointer-events:none}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-item.is-busy .tm-inv-menu-label{color:#6d28d9}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-hint{color:#9ca3af;font-size:12px}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-item:hover .tm-inv-menu-hint{color:#a78bfa}",
      "div#" + DOWNLOAD_MENU_ID + " .tm-inv-menu-sep{height:1px;margin:5px 0;background:#f0f0f0}",
    ].join("");
    document.head.appendChild(style);

    menu = document.createElement("div");
    menu.id = DOWNLOAD_MENU_ID;
    menu.dataset.tmBuild = "3";
    menu.appendChild(buildMenuItem("PDF 格式", "左键直下", "pdf"));
    menu.appendChild(buildMenuItem("OFD 格式", "", "ofd"));
    menu.appendChild(buildMenuItem("XML 格式", "", "xml"));

    const sep = document.createElement("div");
    sep.className = "tm-inv-menu-sep";
    menu.appendChild(sep);

    menu.appendChild(buildMenuItem("使用原网页弹窗", "选格式", "origin"));

    // 菜单内的按下不能被外层的「点空白关闭」抢先吃掉
    menu.addEventListener("mousedown", (event) => event.stopPropagation(), true);

    menu.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const item = event.target?.closest?.(".tm-inv-menu-item");
      if (!item || item.classList.contains("is-disabled")) return;

      const link = menuTargetLink;
      const type = item.dataset.type;
      hideDownloadMenu();

      // 链接被重渲染掉了就放弃，别让这次点击毫无反应
      if (!link || !link.isConnected) return;

      if (type === "origin") {
        openSiteDialog(link);
        return;
      }

      const applyCode = getRowApplyCode(link.closest("tr"));
      if (!applyCode) {
        openSiteDialog(link);
        return;
      }
      startDownload(applyCode, type);
    });

    document.body.appendChild(menu);
    return menu;
  }

  // 打开菜单时刷新：按缓存灰掉这张发票没有的格式
  function syncMenuAvailability(menu, applyCode) {
    const cached = downloadUrlCache.get(applyCode);
    const fresh =
      cached && Date.now() - cached.at < DOWNLOAD_CACHE_TTL ? cached.urls : null;

    menu.querySelectorAll(".tm-inv-menu-item").forEach((item) => {
      const type = item.dataset.type || "";
      if (!DOWNLOAD_FORMAT_FIELD[type]) return;

      const available = !fresh || !!fresh[type];
      item.classList.toggle("is-disabled", !available);
      item.title = available
        ? ""
        : "这张发票没有 " + DOWNLOAD_FORMAT_LABEL[type] + " 文件";
    });

  }

  function showDownloadMenu(link, clientX, clientY) {
    hideHoverTip();
    const menu = ensureDownloadMenu();
    menuTargetLink = link;
    syncMenuAvailability(menu, getRowApplyCode(link.closest("tr")));

    menu.style.display = "block";
    menu.style.left = "0px";
    menu.style.top = "0px";

    const rect = menu.getBoundingClientRect();
    const gap = 8;
    const maxLeft = window.innerWidth - rect.width - gap;
    const maxTop = window.innerHeight - rect.height - gap;

    const left = Math.min(Math.max(gap, clientX), Math.max(gap, maxLeft));
    const top = Math.min(Math.max(gap, clientY), Math.max(gap, maxTop));

    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
  }

  // 抢在站点自己的 onClick 之前接管（document 捕获阶段，React 的委托跑在后面）
  document.addEventListener(
    "click",
    (event) => {
      if (!enabled) return;

      const link = getDownloadLink(event.target);
      if (!link) return;

      // 右键菜单选了「使用原网页弹窗」：放行这一次，让站点自己弹「选格式」
      if (bypassNextClick) {
        bypassNextClick = false;
        return;
      }

      // 拿不到申请单号就放行，退回站点原来的「选格式」弹窗，不至于点不动
      const applyCode = getRowApplyCode(link.closest("tr"));
      if (!applyCode) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      hideDownloadMenu();
      hideHoverTip();
      startDownload(applyCode, "pdf");
    },
    true
  );

  // 右键「下载发票」：接管浏览器原生右键菜单，换成格式菜单
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (!enabled) return;

      const link = getDownloadLink(event.target);
      if (!link) return;

      // 没有申请单号的发票不接管，保留浏览器原生右键菜单
      if (!getRowApplyCode(link.closest("tr"))) return;

      event.preventDefault();
      event.stopPropagation();

      showDownloadMenu(link, event.clientX, event.clientY);
    },
    true
  );

  // 点别处 / Esc / 滚动 / 改窗口大小 都收起菜单
  document.addEventListener(
    "mousedown",
    (event) => {
      if (!isMenuVisible()) return;
      const menu = document.getElementById(DOWNLOAD_MENU_ID);
      if (menu && menu.contains(event.target)) return;
      hideDownloadMenu();
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isMenuVisible()) {
        hideDownloadMenu();
      }
    },
    true
  );

  window.addEventListener(
    "scroll",
    () => {
      hideDownloadMenu();
      hideHoverTip();
    },
    true
  );
  window.addEventListener(
    "resize",
    () => {
      hideDownloadMenu();
      hideHoverTip();
    },
    true
  );

  /******************** 8.6) 商品明细：详情接口 → 金额格小字 + 悬停浮层 ********************/
  /* 列表接口（/invoice/merge/list）只给一个 custCount 汇总人数，逐行明细只存在详情接口里。
     ⇒ 对当前页每一行单独查一次详情（串行 + 间隔 70ms + 缓存 10 分钟），拿到 taxableList 后：
        ① 金额格下面挂一行「数量 × 单价」；
        ② 鼠标停在金额格上 → 浮层里看完整明细（商品名称 / 单位 / 数量 / 单价 / 价税合计）。

     单价页面不提供，用 amount / taxableCustCount 现算（4200 / 12 = 350）。
     ⚠️ 数量留空时这个键是 undefined（不是 0）⇒ 算不出单价，就标「数量未填」，不瞎猜。 */

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function formatQty(value) {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value * 10000) / 10000);
  }

  function formatPrice(value) {
    if (!Number.isFinite(value)) return "";
    return String(Math.round(value * 100) / 100);
  }

  function normalizeDetailItems(list) {
    if (!Array.isArray(list)) return [];

    return list.map((item) => {
      const rawQty = item && item.taxableCustCount;
      const qty =
        rawQty === null || rawQty === undefined || rawQty === ""
          ? null
          : Number(rawQty);
      const safeQty = Number.isFinite(qty) ? qty : null;
      // 数量 0 等同于没填：算不出单价，单价 = 金额 / 0 会变成 Infinity。
      // 而且真实业务里「0 人」的发票行没有意义（2026-10-27 实测确有 qty=0 的数据，
      // 不拦的话金额格小字会显示成孤零零一个「0」）。
      const usableQty = safeQty && safeQty > 0 ? safeQty : null;
      const amount = Number(item && item.amount);

      return {
        name: normText(item && item.taxableName) || "—",
        unit: normText(item && item.unit),
        qty: usableQty,
        // 单价 = 本行价税合计 / 数量；数量为 0 或缺失就没有单价
        unitPrice: usableQty ? (Number.isFinite(amount) ? amount / usableQty : null) : null,
        amount: Number.isFinite(amount) ? amount : 0,
      };
    });
  }

  function getCachedDetail(applyCode) {
    const entry = detailCache.get(applyCode);
    if (!entry) return null;
    if (Date.now() - entry.at > DETAIL_CACHE_TTL) {
      detailCache.delete(applyCode);
      return null;
    }
    return entry.items;
  }

  let detailPersistTimer = 0;

  /* 只写「精简版」：字段名压成一个字母、跳过空值，800 条约 60KB —— 太大容易碰到
     localStorage 5MB 的单域名上限（站点自己也在用）。 */
  function detailStoreSnapshot() {
    const items = {};
    detailCache.forEach((entry, code) => {
      items[code] = {
        at: entry.at,
        i: entry.items.map((item) => [
          item.name,
          item.unit,
          item.qty,
          item.unitPrice,
          item.amount,
        ]),
      };
    });
    return { v: DETAIL_STORE_VERSION, items };
  }

  function saveDetailStore() {
    detailPersistTimer = 0;

    if (detailCache.size > DETAIL_CACHE_MAX) {
      // 超上限：把最久没写入的挤出去（Map 的插入顺序 ≈ 访问先后）
      const extra = detailCache.size - DETAIL_CACHE_MAX;
      let removed = 0;
      for (const code of detailCache.keys()) {
        if (removed >= extra) break;
        detailCache.delete(code);
        removed += 1;
      }
    }

    try {
      localStorage.setItem(DETAIL_STORE_KEY, JSON.stringify(detailStoreSnapshot()));
    } catch (error) {
      // 写不进去（配额满 / 隐私模式）：清掉重试一次，还不行就只留内存
      try {
        localStorage.removeItem(DETAIL_STORE_KEY);
        localStorage.setItem(DETAIL_STORE_KEY, JSON.stringify(detailStoreSnapshot()));
      } catch (inner) {}
    }
  }

  // 一次写整张表会反复序列化，攒一下再写
  function scheduleDetailPersist() {
    if (detailPersistTimer) return;
    detailPersistTimer = setTimeout(saveDetailStore, 1200);
  }

  function loadDetailStore() {
    try {
      const raw = localStorage.getItem(DETAIL_STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || data.v !== DETAIL_STORE_VERSION || !data.items) return;

      const now = Date.now();
      Object.entries(data.items).forEach(([code, entry]) => {
        if (!entry || !Array.isArray(entry.i)) return;
        if (!entry.at || now - entry.at > DETAIL_CACHE_TTL) return;

        const items = entry.i.map((row) => ({
          name: row[0] || "—",
          unit: row[1] || "",
          qty: Number.isFinite(row[2]) ? row[2] : null,
          unitPrice: Number.isFinite(row[3]) ? row[3] : null,
          amount: Number.isFinite(row[4]) ? row[4] : 0,
        }));

        detailCache.set(code, { items, at: entry.at });
      });
    } catch (error) {}
  }

  function clearDetailStore() {
    detailCache.clear();
    detailFailed.clear();
    detailRequested.clear();
    try {
      localStorage.removeItem(DETAIL_STORE_KEY);
    } catch (error) {}
  }

  function setDetailCache(applyCode, items) {
    if (detailCache.size >= DETAIL_CACHE_MAX) {
      detailCache.delete(detailCache.keys().next().value);
    }
    detailCache.set(applyCode, { items, at: Date.now() });
    detailFailed.delete(applyCode);
    scheduleDetailPersist();
  }

  loadDetailStore();

  // 攒着的那次写入没落地就关页面/刷新 → 立刻补写，别白拉一遍接口
  window.addEventListener(
    "pagehide",
    () => {
      if (!detailPersistTimer) return;
      clearTimeout(detailPersistTimer);
      saveDetailStore();
    },
    true
  );

  // 金额格下面那行小字：单行「12 × 350」；多行只写「多条明细」。
  /* ⚠️ 多行**不算**「合计人数 × 均价」（用户 2026-10-27 明确否掉）：
     不同商品单价本来就不一样，把人数相加再拿总金额除，得到的「均价」没有参考意义。
     而且「4 项 · 522 × 335.63」这种长串会把金额列硬生生撑宽。
     想看每一行的人数/单价 → 鼠标停在金额格上，浮层里逐行列着，那才是有意义的。 */
  function buildDetailSummary(items) {
    if (!items.length) return "无商品明细";

    if (items.length === 1) {
      const item = items[0];
      if (item.qty === null) return "数量未填";
      if (item.unitPrice === null) return formatQty(item.qty);
      return formatQty(item.qty) + " × " + formatPrice(item.unitPrice);
    }

    return "多条明细";
  }

  function renderDetailHint(cell, items) {
    if (!cell) return;

    const text = buildDetailSummary(items);
    cell.setAttribute("data-tm-amount", "1");

    let hint = cell.querySelector(":scope > .tm-qty-hint");
    if (!hint) {
      hint = document.createElement("span");
      hint.className = "tm-qty-hint";
      // append 到末尾 ⇒ flex-wrap 里落到金额下面那一行
      cell.appendChild(hint);
    }

    // ⚠️ 同值不写：脚本自己盯着整张表，写回一样的值也算一次变更
    if (hint.textContent !== text) hint.textContent = text;
    hint.classList.toggle(
      "is-empty",
      text === "数量未填" || text === "无商品明细" || text.indexOf("数量未填") !== -1
    );
  }

  // 每行处理时都会走到这里：缓存命中直接画，没命中就排队
  function ensureDetailHint(tr, amountIdx) {
    const cell = tr && tr.children[amountIdx];
    if (!cell) return;

    const applyCode = getRowApplyCode(tr);
    if (!applyCode) return;

    const items = getCachedDetail(applyCode);
    if (items) {
      renderDetailHint(cell, items);
      return;
    }
    if (detailFailed.has(applyCode)) return;

    queueDetailFetch(applyCode);
  }

  function refreshRowHint(applyCode) {
    const items = getCachedDetail(applyCode);
    if (!items || !observedTableRoot) return;

    const row = getBodyRows(observedTableRoot).find(
      (tr) => getRowApplyCode(tr) === applyCode
    );
    if (!row) return;

    const amountIdx = getHeaderIndexMap(observedTableRoot).get(AMOUNT_COLUMN_HEADER);
    if (amountIdx === undefined) return;

    renderDetailHint(row.children[amountIdx], items);

    // 浮层正开着这一行 → 内容跟着更新
    const pop = document.getElementById(DETAIL_POP_ID);
    if (pop && pop.style.display !== "none" && pop.dataset.applyCode === applyCode) {
      renderDetailPop(pop, applyCode, items);
      positionDetailPop(pop, row.children[amountIdx]);
    }
  }

  function queueDetailFetch(applyCode) {
    if (!applyCode || !enabled) return;
    if (detailRequested.has(applyCode)) return;

    detailRequested.add(applyCode);
    detailQueue.push(applyCode);
    runDetailQueue();
  }

  async function fetchDetailData(applyCode) {
    try {
      const response = await fetch(TRUTH_DETAIL_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          mnClientId: SOA_CLIENT_ID,
        },
        body: JSON.stringify({
          applyCode,
          regionCode: soaRegionCode || DOWNLOAD_FALLBACK_REGION,
        }),
      });
      const json = await response.json();
      return (json && json.data) || null;
    } catch (error) {
      return null;
    }
  }

  async function runDetailQueue() {
    if (detailRunning) return;
    detailRunning = true;

    try {
      while (detailQueue.length) {
        // 连续失败太多次就别硬刷了（接口挂了 / 掉登录），剩下的行标灰不显示
        if (!enabled || detailFailStreak >= DETAIL_FAIL_STOP) {
          detailQueue = [];
          break;
        }

        const applyCode = detailQueue.shift();

        if (getCachedDetail(applyCode)) {
          refreshRowHint(applyCode);
          continue;
        }

        const data = await fetchDetailData(applyCode);

        if (data) {
          detailFailStreak = 0;
          absorbDetailData(data);
          refreshRowHint(applyCode);
        } else {
          detailFailStreak += 1;
          detailFailed.add(applyCode);
        }

        await sleep(DETAIL_FETCH_GAP);
      }
    } finally {
      detailRunning = false;
    }
  }

  /* 详情响应既能拿明细，也带着 contractCompanyName —— 顺手把销方公司真值也记上，一次请求两用。 */
  function absorbDetailData(data) {
    if (!data || typeof data !== "object") return false;

    const applyCode = typeof data.applyCode === "string" ? data.applyCode : "";
    if (!applyCode) return false;

    setDetailCache(applyCode, normalizeDetailItems(data.taxableList));

    const sellerName =
      typeof data.contractCompanyName === "string" ? data.contractCompanyName : "";
    if (sellerName && sellerTruth.get(applyCode) !== sellerName) {
      sellerTruth.set(applyCode, sellerName);
      scheduleWork(false);
    }

    return true;
  }

  // 旁听页面自己点「详情」时的那次响应（这样点过一遍的行，列表立刻就有小字，不用等队列）
  function readDetailFromText(text) {
    if (!text || text.length < 20 || text.length > 2000000) return false;
    if (text.indexOf("taxableList") === -1) return false;

    try {
      return absorbDetailData(JSON.parse(text).data);
    } catch (error) {
      return false;
    }
  }

  /********** 浮层：鼠标停在金额格上看完整明细 **********/
  function ensureDetailPop() {
    let pop = document.getElementById(DETAIL_POP_ID);
    if (pop) return pop;

    const style = document.createElement("style");
    style.id = DETAIL_POP_ID + "-style";
    style.textContent = `
      #${DETAIL_POP_ID} {
        position: fixed; z-index: 2147483400; display: none;
        min-width: 300px; max-width: 440px;
        padding: 9px 12px 7px;
        background: #fff; border: 1px solid #e8ebf0; border-radius: 10px;
        box-shadow: 0 10px 30px rgba(15,23,42,.16);
        font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937; pointer-events: none;
      }
      #${DETAIL_POP_ID} .tm-detail-head {
        display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
        padding-bottom: 6px; border-bottom: 1px solid #eef1f5;
        font-size: 12px; font-weight: 500;
      }
      #${DETAIL_POP_ID} .tm-detail-head em {
        font-style: normal; font-weight: 400; font-size: 11px; color: #97a1ae;
      }
      #${DETAIL_POP_ID} .tm-detail-row {
        display: flex; align-items: baseline; gap: 8px; padding: 4px 0;
      }
      #${DETAIL_POP_ID} .tm-detail-row + .tm-detail-row { border-top: 1px solid #f7f8fa; }
      #${DETAIL_POP_ID} .tm-detail-row.is-head {
        color: #97a1ae; font-size: 11px; padding: 6px 0 3px; border-top: 0;
      }
      #${DETAIL_POP_ID} .tm-detail-name {
        flex: 1 1 auto; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      #${DETAIL_POP_ID} .tm-detail-unit {
        flex: 0 0 24px; text-align: center; color: #97a1ae; font-size: 11px;
      }
      #${DETAIL_POP_ID} .tm-detail-qty {
        flex: 0 0 44px; text-align: right; font-variant-numeric: tabular-nums;
      }
      #${DETAIL_POP_ID} .tm-detail-price {
        flex: 0 0 62px; text-align: right; color: #5f6b7a;
        font-variant-numeric: tabular-nums;
      }
      #${DETAIL_POP_ID} .tm-detail-amount {
        flex: 0 0 74px; text-align: right; font-variant-numeric: tabular-nums;
      }
      #${DETAIL_POP_ID} .tm-detail-total {
        border-top: 1px solid #e8ebf0; margin-top: 3px; padding-top: 6px; font-weight: 500;
      }
      #${DETAIL_POP_ID} .tm-detail-empty { color: #97a1ae; padding: 8px 0 2px; }
    `;
    document.head.appendChild(style);

    pop = document.createElement("div");
    pop.id = DETAIL_POP_ID;
    document.body.appendChild(pop);
    return pop;
  }

  function buildDetailCell(className, text) {
    const node = document.createElement("span");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function renderDetailPop(pop, applyCode, items) {
    pop.textContent = "";
    pop.dataset.applyCode = applyCode;

    const head = document.createElement("div");
    head.className = "tm-detail-head";
    const headTitle = document.createElement("span");
    headTitle.textContent = "商品明细";
    const headMeta = document.createElement("em");
    headMeta.textContent = items.length ? items.length + " 项" : "";
    head.append(headTitle, headMeta);
    pop.appendChild(head);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "tm-detail-empty";
      empty.textContent = "这张发票没有商品明细";
      pop.appendChild(empty);
      return;
    }

    const headerRow = document.createElement("div");
    headerRow.className = "tm-detail-row is-head";
    headerRow.append(
      buildDetailCell("tm-detail-name", "商品名称"),
      buildDetailCell("tm-detail-unit", "单位"),
      buildDetailCell("tm-detail-qty", "数量"),
      buildDetailCell("tm-detail-price", "单价"),
      buildDetailCell("tm-detail-amount", "价税合计")
    );
    pop.appendChild(headerRow);

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "tm-detail-row";
      row.append(
        buildDetailCell("tm-detail-name", item.name),
        buildDetailCell("tm-detail-unit", item.unit || "—"),
        buildDetailCell("tm-detail-qty", item.qty === null ? "—" : formatQty(item.qty)),
        buildDetailCell(
          "tm-detail-price",
          item.unitPrice === null ? "—" : formatPrice(item.unitPrice)
        ),
        buildDetailCell("tm-detail-amount", formatPrice(item.amount))
      );
      pop.appendChild(row);
    });

    const knownQty = items.filter((item) => item.qty !== null);
    const totalQty = knownQty.reduce((sum, item) => sum + item.qty, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
    const unitSet = new Set(knownQty.map((item) => item.unit).filter(Boolean));
    const unit = unitSet.size === 1 ? [...unitSet][0] : "";

    const totalRow = document.createElement("div");
    totalRow.className = "tm-detail-row tm-detail-total";
    const totalLabel = document.createElement("span");
    totalLabel.className = "tm-detail-name";
    totalLabel.textContent =
      "合计 " +
      items.length +
      " 项" +
      (knownQty.length ? " · " + formatQty(totalQty) + (unit ? " " + unit : "") : " · 数量未填");
    totalRow.append(
      totalLabel,
      buildDetailCell("tm-detail-amount", formatPrice(totalAmount))
    );
    pop.appendChild(totalRow);
  }

  function positionDetailPop(pop, cell) {
    const rect = cell.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const gap = 6;

    // 右对齐金额格，别一开就顶到屏幕右边
    let left = rect.right - popRect.width;
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));

    let top = rect.bottom + gap;
    if (top + popRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - popRect.height - gap);
    }

    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function hideDetailPop() {
    if (detailPopTimer) {
      clearTimeout(detailPopTimer);
      detailPopTimer = null;
    }
    const pop = document.getElementById(DETAIL_POP_ID);
    if (pop) pop.style.display = "none";
  }

  function showDetailPop(cell) {
    const tr = cell.closest("tr");
    const applyCode = tr ? getRowApplyCode(tr) : "";
    if (!applyCode) return;

    const pop = ensureDetailPop();
    const items = getCachedDetail(applyCode);

    pop.style.display = "block";
    pop.style.left = "0px";
    pop.style.top = "0px";

    if (items) {
      renderDetailPop(pop, applyCode, items);
    } else {
      pop.textContent = "";
      pop.dataset.applyCode = applyCode;
      const head = document.createElement("div");
      head.className = "tm-detail-head";
      const title = document.createElement("span");
      title.textContent = "商品明细";
      head.appendChild(title);
      const loading = document.createElement("div");
      loading.className = "tm-detail-empty";
      loading.textContent = detailFailed.has(applyCode) ? "没能取到明细" : "正在读取明细…";
      pop.append(head, loading);
      if (!detailFailed.has(applyCode)) queueDetailFetch(applyCode);
    }

    positionDetailPop(pop, cell);
  }

  document.addEventListener(
    "mouseover",
    (event) => {
      if (!enabled) return;

      const cell = event.target?.closest?.('td[data-tm-amount="1"]');
      if (!cell) return;
      if (event.relatedTarget && cell.contains(event.relatedTarget)) return;

      hideDetailPop();
      detailPopTimer = setTimeout(() => {
        detailPopTimer = null;
        if (cell.isConnected) showDetailPop(cell);
      }, 220);
    },
    true
  );

  document.addEventListener(
    "mouseout",
    (event) => {
      const cell = event.target?.closest?.('td[data-tm-amount="1"]');
      if (!cell) return;
      if (event.relatedTarget && cell.contains(event.relatedTarget)) return;
      hideDetailPop();
    },
    true
  );

  window.addEventListener("scroll", hideDetailPop, true);
  window.addEventListener("resize", hideDetailPop, true);

  /******************** 9) 复制：按页面可视列顺序输出 ********************/
  function selectionIntersectsNode(selection, node) {
    if (!selection || !node) return false;

    for (let index = 0; index < selection.rangeCount; index += 1) {
      try {
        if (selection.getRangeAt(index).intersectsNode(node)) return true;
      } catch (error) {}
    }

    return false;
  }

  /* ---- 框选复制：先判断「整格都被选中」还是「只选了一部分」 ---- */
  // 某个 selection range 是否完整覆盖这个节点
  function rangeCoversNode(range, node) {
    try {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);

      return (
        range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0
      );
    } catch (error) {
      return false;
    }
  }

  // 格子里的文字全被选中 → true（用格式化输出，例如「客户名，税号」）
  function isCellFullySelected(selection, cell) {
    const textNodes = getMeaningfulTextNodes(cell);
    if (!textNodes.length) return false;

    const ranges = [];
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index));
    }
    if (!ranges.length) return false;

    return textNodes.every((node) =>
      ranges.some((range) => rangeCoversNode(range, node))
    );
  }

  // 只把框选到的那部分文字取出来（框选半格就只复制半格）
  function getSelectedTextInCell(selection, cell) {
    const pieces = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue) continue;

      for (let index = 0; index < selection.rangeCount; index += 1) {
        const range = selection.getRangeAt(index);
        if (!range.intersectsNode(node)) continue;

        try {
          const piece = document.createRange();
          piece.selectNodeContents(node);

          if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) {
            piece.setStart(range.startContainer, range.startOffset);
          }
          if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) {
            piece.setEnd(range.endContainer, range.endOffset);
          }

          const text = piece.toString();
          if (text) pieces.push(text);
        } catch (error) {}
        break;
      }
    }

    return normText(pieces.join(" "));
  }

  function getClipboardCellText(cell, header, selection) {
    if (!cell) return "";

    // 只框到格子里的一部分文字 → 就复制那一部分，别把整格（含税号）一起带出来
    if (selection && !isCellFullySelected(selection, cell)) {
      return getSelectedTextInCell(selection, cell);
    }

    if (header === "开票客户") {
      const parts = cell.querySelectorAll(":scope > .ellipsis");
      if (parts.length === 2) {
        return `${normText(parts[0].innerText)}，${normText(parts[1].innerText)}`;
      }
    }

    if (header === "创建人") {
      const name =
        cell.getAttribute("data-tm-creator-name") ||
        normText(cell.querySelector(":scope > div:first-child")?.innerText);
      const time =
        cell.getAttribute("data-tm-creator-time") ||
        normText(cell.querySelector(":scope > div:last-child")?.innerText);
      return [name, time].filter(Boolean).join(" ");
    }

    if (header === "操作") {
      const links = cell.querySelectorAll("a");
      if (links.length) {
        return [...links]
          .map((link) => normText(link.innerText))
          .filter(Boolean)
          .join(" ");
      }
    }

    // 金额格下面挂着「数量 × 单价」那行小字，复制时不该被带出去
    if (cell.querySelector(":scope > .tm-qty-hint")) {
      const clone = cell.cloneNode(true);
      clone.querySelectorAll(".tm-qty-hint").forEach((node) => node.remove());
      return normText(clone.innerText)
        .replace(/\t/g, " ")
        .replace(/[\r\n]+/g, " ");
    }

    return normText(cell.innerText)
      .replace(/\t/g, " ")
      .replace(/[\r\n]+/g, " ");
  }

  function buildClipboardTable(selection, tableRoot = observedTableRoot) {
    if (!tableRoot) return null;

    const headerCells = getHeaderCells(tableRoot);
    const bodyRows = getBodyRows(tableRoot);
    if (!headerCells.length || !bodyRows.length) return null;

    const headerIndexMap = getHeaderIndexMap(tableRoot);
    const orderedColumns = COLUMN_LAYOUT.map((column) => ({
      ...column,
      domIndex: headerIndexMap.get(column.header),
    })).filter((column) => column.domIndex !== undefined);

    if (!orderedColumns.length) return null;

    const selectedRows = bodyRows.filter((row) =>
      orderedColumns.some((column) =>
        selectionIntersectsNode(selection, row.children[column.domIndex])
      )
    );

    const selectedColumns = orderedColumns.filter((column) => {
      if (
        selectionIntersectsNode(selection, headerCells[column.domIndex])
      ) {
        return true;
      }

      return selectedRows.some((row) =>
        selectionIntersectsNode(selection, row.children[column.domIndex])
      );
    });

    if (!selectedColumns.length) return null;

    const includeHeader = selectedColumns.some((column) =>
      selectionIntersectsNode(selection, headerCells[column.domIndex])
    );

    const rows = [];
    if (includeHeader) {
      rows.push(selectedColumns.map((column) => column.header));
    }

    selectedRows.forEach((row) => {
      const values = selectedColumns.map((column) =>
        getClipboardCellText(
          row.children[column.domIndex],
          column.header,
          selection
        )
      );

      // 只被选区边界擦到、其实一个字都没选中的行，别输出一堆空串
      if (values.some((value) => String(value).trim())) rows.push(values);
    });

    return rows.length ? { rows, includeHeader } : null;
  }

  function escapeClipboardHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  document.addEventListener(
    "copy",
    (event) => {
      if (!enabled || !event.clipboardData || !observedTableRoot) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const result = buildClipboardTable(selection, observedTableRoot);
      if (!result) return;

      const plainText = result.rows
        .map((row) =>
          row
            .map((value) => String(value).replace(/\t/g, " "))
            .join("\t")
        )
        .join("\r\n");

      const htmlRows = result.rows
        .map((row, rowIndex) => {
          const tag = result.includeHeader && rowIndex === 0 ? "th" : "td";
          return `<tr>${row
            .map((value) => `<${tag}>${escapeClipboardHtml(value)}</${tag}>`)
            .join("")}</tr>`;
        })
        .join("");

      event.clipboardData.setData("text/plain", plainText);
      event.clipboardData.setData(
        "text/html",
        `<table><tbody>${htmlRows}</tbody></table>`
      );
      event.preventDefault();
    },
    true
  );

  /******************** 10) Observer ********************/
  function connectTableObserver() {
    const tableRoot = findInvoiceTableRoot();
    if (!tableRoot || !isInvoiceTableRoot(tableRoot)) return false;

    if (tableObserver && observedTableRoot === tableRoot) {
      markTableRoot(tableRoot);
      return true;
    }

    disconnectTableObserver();
    observedTableRoot = tableRoot;
    markTableRoot(tableRoot);

    tableObserver = new MutationObserver(() => {
      if (!isInvoiceTableRoot(tableRoot)) return;
      scheduleWork(false);
    });
    tableObserver.observe(tableRoot, {
      childList: true,
      characterData: true,
      subtree: true,
      // 站点那套「自适应截断」的单元格在数据变化时只更新 title、不重画可见文本，
      // 所以必须盯着 title 属性，否则改了数据这一格永远是旧简称（实测：点「查 询」该格 0 条 DOM 变化）。
      attributes: true,
      attributeFilter: ["title"],
    });

    return true;
  }

  function disconnectTableObserver() {
    if (tableObserver) {
      try {
        tableObserver.disconnect();
      } catch (error) {}
      tableObserver = null;
    }

    if (observedTableRoot) {
      observedTableRoot.removeAttribute(TABLE_MARKER);
    }
    observedTableRoot = null;
  }

  function connectRootObserverIfNeeded() {
    if (rootObserver) return;

    rootObserver = new MutationObserver(() => {
      if (!enabled) return;

      const nextTableRoot = findInvoiceTableRoot();
      if (nextTableRoot !== observedTableRoot) {
        if (connectTableObserver()) scheduleWork(true);
      }
    });

    rootObserver.observe(document.querySelector("#root") || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function disconnectRootObserver() {
    if (rootObserver) {
      try {
        rootObserver.disconnect();
      } catch (error) {}
      rootObserver = null;
    }
  }

  /******************** 11) 核心调度 ********************/
  function scheduleWork(forceStyle = false) {
    if (!enabled) return;

    // 拖列宽时把文案替换、金额量宽这些重活全停掉：拖动本身只改宽度，可站点重排会
    // 带出一串 DOM 变化，观察者一遍遍叫我们重算 51 行 × 11 列，拖起来就是卡的。
    // 松手时 finishColumnResize 会同步补一次。
    if (isResizingColumn) return;

    pendingForceStyle = pendingForceStyle || forceStyle;
    if (scheduled) return;
    scheduled = true;

    const run = () => {
      if (!enabled) {
        pendingForceStyle = false;
        return;
      }

      const shouldForceStyle = pendingForceStyle;
      pendingForceStyle = false;

      if (!observedTableRoot?.isConnected) connectTableObserver();
      markTableRoot(observedTableRoot);

      const pageChanged = resetTempWidthIfPageChanged();
      const headerSignature = getHeaderSignature(observedTableRoot);
      const headerChanged = headerSignature !== lastHeaderSignature;

      if (
        observedTableRoot &&
        (shouldForceStyle || pageChanged || headerChanged || !styleEl)
      ) {
        applyOrUpdateStyle(headerSignature);
      }

      ensureUiButton();
      ensureBatchHeadButton();
      processRowsIncremental(observedTableRoot);

      // 金额列宽跟着内容走：量宽放在行处理之后，这样量到的是去过千分位逗号的
      // 干净内容；翻页 / 数据刷新后最长的那条金额可能就变了。
      if (
        observedTableRoot &&
        syncAmountColumnWidth(getHeaderIndexMap(observedTableRoot))
      ) {
        applyOrUpdateStyle(headerSignature);
      }
    };

    // ⚠️ 后台标签页的 rAF 会被挂起（实测：后台打开发票页一行样式都不生效，
    //    切回前台才补上）。这种时候直接同步跑一次，别把工作全压在 rAF 上。
    if (document.hidden) {
      scheduled = false;
      run();
      return;
    }

    requestAnimationFrame(() => {
      scheduled = false;
      run();
    });
  }

  /******************** 11.7) 销方公司真值：旁听接口响应 ********************/
  /* 页面自己拉数据（合并列表 / 按订单查 / 详情）时，响应里都带着 contractCompanyName —— 旁听下来
     当真值用，最可靠：既不依赖站点会不会重画那一格，也不用额外发请求。 */
  function recordSellerTruth(value, depth) {
    if (!value || typeof value !== "object" || depth > TRUTH_SCAN_DEPTH) return false;

    let changed = false;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (recordSellerTruth(item, depth + 1)) changed = true;
      }
      return changed;
    }

    const code = value.applyCode;
    const name = value.contractCompanyName;

    if (typeof code === "string" && code && typeof name === "string" && name) {
      if (sellerTruth.get(code) !== name) {
        sellerTruth.set(code, name);
        changed = true;
      }
    }

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object" && recordSellerTruth(child, depth + 1)) {
        changed = true;
      }
    }

    return changed;
  }

  function readSellerTruthFromText(text) {
    if (!text || text.length < 10 || text.length > 2000000) return false;
    if (text.indexOf("contractCompanyName") === -1) return false;

    try {
      return recordSellerTruth(JSON.parse(text), 0);
    } catch (error) {
      return false;
    }
  }

  function pickStringField(value, keys, depth) {
    if (!value || typeof value !== "object" || depth > 4) return "";

    for (const key of keys) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object") {
        const hit = pickStringField(child, keys, depth + 1);
        if (hit) return hit;
      }
    }

    return "";
  }

  function parseJsonBody(bodyText) {
    if (!bodyText || typeof bodyText !== "string") return null;
    if (bodyText.length > 200000) return null;

    try {
      return JSON.parse(bodyText);
    } catch (error) {
      return null;
    }
  }

  // 记住页面自己在用的 regionCode，主动补真值时照抄，避免猜
  function rememberRequestMeta(url, method, bodyText) {
    if (!String(url || "").includes("/invoice/")) return;

    const json = parseJsonBody(bodyText);
    if (!json) return;

    const regionCode = pickStringField(json, ["regionCode"], 0);
    if (regionCode && regionCode.length <= 8) soaRegionCode = regionCode;
  }

  // 写接口：非 GET，且不是那几个查询/统计端点
  function isInvoiceWriteRequest(url, method) {
    if (!url || !url.includes("/invoice/")) return false;
    if (String(method || "GET").toUpperCase() === "GET") return false;

    // 下载类端点也算读（否则自己取 pdfUrl 会被当成写接口，白补一轮销方公司真值）
    return !/\/(query|list|detail|page|statistics|total|count|type|goods|org|company|template|download)/i.test(
      url
    );
  }

  function getVisibleApplyCodes() {
    if (!observedTableRoot) return [];

    const statusIdx = getHeaderIndexMap(observedTableRoot).get("当前状态");
    if (statusIdx === undefined) return [];

    return getBodyRows(observedTableRoot)
      .map((tr) => getApplyCode(tr, statusIdx))
      .filter(Boolean);
  }

  /* 保存后页面自己的重拉不一定把销方公司带回来（实测订单页就没有），
     所以照着「详情」那条接口主动补一次真值 —— 拿到就立刻纠正显示。 */
  function refreshSellerTruth(applyCodes) {
    const codes = [
      ...new Set((applyCodes || []).filter(Boolean)),
    ].slice(0, TRUTH_REFRESH_MAX_ROWS);

    const target = codes.length ? codes : getVisibleApplyCodes().slice(0, TRUTH_REFRESH_MAX_ROWS);
    if (!target.length) return;

    const now = Date.now();
    if (now - lastTruthRefreshAt < TRUTH_REFRESH_GAP_MS) return;
    lastTruthRefreshAt = now;

    target.forEach((applyCode) => {
      try {
        fetch(TRUTH_DETAIL_URL, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            mnClientId: SOA_CLIENT_ID,
          },
          body: JSON.stringify({
            applyCode: applyCode,
            regionCode: soaRegionCode,
          }),
        })
          .then((response) => response.text())
          .then((text) => {
            if (readSellerTruthFromText(text)) scheduleWork(false);
          })
          .catch(() => {});
      } catch (error) {}
    });
  }

  // 只旁听，不改动任何请求 / 响应本身；另外写接口一完成就主动补一次真值。
  function installTruthHook() {
    if (truthHookInstalled) return;
    truthHookInstalled = true;

    const originalFetch = window.fetch;

    if (typeof originalFetch === "function") {
      window.fetch = function () {
        const result = originalFetch.apply(this, arguments);
        const options = arguments[1] || {};
        const url =
          typeof arguments[0] === "string"
            ? arguments[0]
            : arguments[0]?.url || "";
        const method = options.method || (arguments[0] && arguments[0].method) || "GET";
        const bodyText = typeof options.body === "string" ? options.body : "";

        rememberRequestMeta(url, method, bodyText);

        if (url.includes("/invoice/") && result && typeof result.then === "function") {
          result
            .then((response) => {
              if (isInvoiceWriteRequest(url, method)) {
                const hint = pickStringField(parseJsonBody(bodyText), ["applyCode", "invoiceApplyCode"], 0);
                refreshSellerTruth(hint ? [hint] : []);
              }

              response
                .clone()
                .text()
                .then((text) => {
                  if (readSellerTruthFromText(text)) scheduleWork(false);
                  // 页面自己点「详情」时也顺手把明细缓存下来
                  readDetailFromText(text);
                })
                .catch(() => {});
            })
            .catch(() => {});
        }

        return result;
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.tmRequestUrl = url;
      this.tmRequestMethod = method;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const url = String(this.tmRequestUrl || "");
      const method = this.tmRequestMethod || "GET";
      const bodyText = typeof body === "string" ? body : "";

      rememberRequestMeta(url, method, bodyText);

      if (url.includes("/invoice/")) {
        this.addEventListener("load", () => {
          try {
            if (isInvoiceWriteRequest(url, method)) {
              const hint = pickStringField(parseJsonBody(bodyText), ["applyCode", "invoiceApplyCode"], 0);
              refreshSellerTruth(hint ? [hint] : []);
            }

            if (readSellerTruthFromText(this.responseText)) scheduleWork(false);
            readDetailFromText(this.responseText);
          } catch (error) {}
        });
      }

      return originalSend.apply(this, arguments);
    };
  }

  // 这一行的申请单号：状态格里那个 div#applyCode-xxx
  function getApplyCode(tr, statusIdx) {
    if (statusIdx === undefined) return "";

    const holder = tr.children[statusIdx]?.querySelector('[id^="applyCode-"]');
    return holder ? holder.id.slice("applyCode-".length) : "";
  }

  /******************** 12) 启用/禁用 ********************/
  function enable() {
    if (enabled) return;
    enabled = true;

    customerWidthDelta = 0;
    lastPageKey = null;
    lastHeaderSignature = "";
    pendingForceStyle = false;

    installTruthHook();

    connectRootObserverIfNeeded();
    connectTableObserver();

    ensureUiButton();
    if (observedTableRoot) applyOrUpdateStyle();
    processRowsIncremental(observedTableRoot);

    // ⚠️ 量宽这里同步做一次，不能只放在 scheduleWork 的 rAF 里：
    // 标签页在后台时 requestAnimationFrame 不触发（实测：后台标签注入后
    // 列宽一直停在 80，就是卡在这一步）。
    if (
      observedTableRoot &&
      syncAmountColumnWidth(getHeaderIndexMap(observedTableRoot))
    ) {
      applyOrUpdateStyle();
    }

    scheduleWork(false);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    disconnectTableObserver();
    disconnectRootObserver();
    removeStyle();
    removeUiButton();
    closeSettingsPanel();
    hideDetailPop();
    detailQueue = [];
    detailRequested.clear();
    detailFailStreak = 0;

    customerWidthDelta = 0;
    lastPageKey = null;
    lastHeaderSignature = "";
    pendingForceStyle = false;

    // 关掉后别把分组底色留在行上（样式表已移除，但行内变量还在，重开时会错乱）
    if (observedTableRoot) {
      getBodyRows(observedTableRoot).forEach((tr) => {
        tr.removeAttribute("data-tm-dup");
        tr.style.removeProperty("--tm-dup");
        tr.style.removeProperty("--tm-dup-line");
      });
      observedTableRoot
        .querySelectorAll("td[data-tm-dup-count]")
        .forEach((node) => node.removeAttribute("data-tm-dup-count"));
    }

    // 虚拟列「税号」是我们自己补的格子，关掉时要还原成站点的原样
    document
      .querySelectorAll("th[data-tm-taxhdr], td[data-tm-taxtd]")
      .forEach((node) => node.remove());
    document
      .querySelectorAll('[data-tm-taxsplit="1"]')
      .forEach((node) => node.removeAttribute("data-tm-taxsplit"));
  }

  function routeCheck() {
    if (isTargetRoute()) enable();
    else disable();
  }

  window.addEventListener("hashchange", routeCheck, true);
  window.addEventListener("popstate", routeCheck, true);
  window.addEventListener("tm-soa-history-change", routeCheck, true);

  // pushState/replaceState 不会自动触发 hashchange，因此派发一个脚本内部事件。
  (function patchHistoryOnce() {
    const patchKey = "__tmSoaInvoiceHistoryPatched__";
    if (history[patchKey]) return;

    const wrap = (original) =>
      function () {
        const result = original.apply(this, arguments);
        queueMicrotask(() =>
          window.dispatchEvent(new Event("tm-soa-history-change"))
        );
        return result;
      };

    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);

    try {
      Object.defineProperty(history, patchKey, {
        value: true,
        configurable: false,
        enumerable: false,
      });
    } catch (error) {
      history[patchKey] = true;
    }
  })();

  routeCheck();
})();
