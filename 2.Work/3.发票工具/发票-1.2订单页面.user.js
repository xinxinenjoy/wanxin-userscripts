// ==UserScript==
// @name         发票-1.2订单页面
// @namespace    https://tampermonkey.net/soa-order-invoice/
// @version      1.12
// @description  发票订单页面：优化SOA发票页面的表格布局，此脚本处理的是通过某个订单进入的开票页面。与全局开票脚本互不影响。

// @match        https://checkup-soa3.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup fapiao
// @publishID    fapiao-dingdan
// @updateURL    https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-dingdan.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-dingdan.user.js
// ==/UserScript==

/*
 * 更新记录
 *
 * v1.12  -  2026-9-22
 * - 修复：「当前状态」的完整文案气泡被截断（2026-9-22）★★
 *     根因：本站的状态格是「自绘截断」的，站点把完整文案做成气泡挂在格子内部（异常状态时红色小图标上的
 *     Tooltip，父节点就是 div#applyCode-*）；而脚本的通用 td 规则是 nowrap + overflow:hidden，
 *     把格子里的一切都裁掉 ⇒ 气泡只剩半截字（234px 的气泡被裁到 110px）。
 *     处置：状态格放开为 overflow:visible，**但省略号改裁在 span 上**（气泡是 span 的兄弟节点，
 *     不受影响）⇒ 长文案仍显示「…」，悬浮那个小图标时站点气泡完整弹出。同时删掉上一版自建的悬浮气泡。
 * - 销方公司「改完不刷新」修复（今日反复迭代后的最终做法）：站点那格是自绘截断组件，
 *   数据变化时【只更新 title、不重画可见文本】，而脚本当初又把简称覆盖进 title ⇒ 真值被抹掉 +
 *   页面不重画 ⇒ 永远停在旧简称（点「查 询」也没用，只有 F5）。现在：
 *     ① 旁听发票接口响应取真值（applyCode → contractCompanyName，不额外发请求）；
 *     ② 写接口完成后主动补查一次「详情」接口拿真值（订单页保存后页面自己不带真值）；
 *     ③ 真值优先于 DOM 的 title；④ 不再用简称覆盖那一格由站点维护的 title；
 *     ⑤ 真值不在替换表里时按原文显示；⑥ 不拿 DOM 读值当写回基准（会自激写入）。
 * - 不做「切回本页自动点查询」（红领巾 2026-09-21 明确不要，改为自己手动查询 / 刷新）。
 *

 * v1.5  -  2026-8-29
 * - 更新：测试版本
 *
 */

(function () {
  "use strict";

  /******************** 0) 路由范围 ********************/
  const TARGET_HASH_PREFIX = "#/order/invoice";
  const isTargetRoute = () =>
    location.hash.startsWith(TARGET_HASH_PREFIX);

  /******************** 1) 配置 ********************/
  /*需要隐藏的表头填在这个位置，换行用逗号隔开*/
  const HIDDEN_COLUMNS = [
    "卡类开票",
    "预开票",
    "发票类型",
  ];

const COLUMN_LAYOUT = [
    { header: "销方公司", width: 100, align: "right"  },
    { header: "开票客户", width: 530, adjustable: true },
    { header: "发票金额", width: 80, align: "right" },
    { header: "当前状态", width: 110 },
    { header: "创建人", width: 150 },
    { header: "操作", width: 260 },
    { header: "申请单", width: 230 },
    { header: "申请开票单位代码", width: 150 },
    { header: "来源", width: 80 },
  ];

  const TEXT_REPLACE = {
    "全电普通发票（电子）": "电子普票",
    "待提交审批": "❓核对后提交",
    "开票成功": "✅已开",
    "作废": "❌作废未开",
    "已退票": "❌红冲退票",
    "审批完成开票中": "开票中",
    "开票申请审批中": "开票中",
    "SOA开票": "订单开票",
    "SOA合并开票": "主页开票",
    "否": "—",
    "新乡美年大健康管理有限公司门诊部": "门诊部（宝龙）",
    "新乡美年大健康管理有限公司高新门诊部": "高新（玫瑰园）",
    "长垣美年大健康管理有限公司门诊部": "长垣（长垣店）",
  };

  const WIDTH_STEP = 60;
  const TABLE_MARKER = "data-tm-invoice-table";
  const TABLE_SELECTOR = `.ant-table[${TABLE_MARKER}="1"]`;
  const LIST_CONTAINER_SELECTOR = ".invoice_list";


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

  /******************** 3) 表格与基础工具 ********************/
  const normText = (value) => (value || "").replace(/\s+/g, " ").trim();

  function getHeaderCells(tableRoot = observedTableRoot) {
    const header = tableRoot?.querySelector(".ant-table-header");
    return header ? [...header.querySelectorAll("th")] : [];
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
        .map((cell) => normText(cell.innerText))
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
      ...document.querySelectorAll(".invoice_list .ant-table"),
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
      const text = normText(th.innerText);
      if (text && !map.has(text)) map.set(text, index);
    });
    return map;
  }

  function getHeaderSignature(tableRoot = observedTableRoot) {
    return getHeaderCells(tableRoot)
      .map((th) => normText(th.innerText))
      .join("|");
  }

  function getColumnWidth(column) {
    const delta = column.adjustable ? customerWidthDelta : 0;
    return Math.max(80, column.width + delta);
  }

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
  function getCellFullText(td) {
    // 站点维护的真值优先（数据变化时它会更新，而可见文本可能不重画）
    const ownTitle = (td.getAttribute("title") || "").trim();
    if (ownTitle) return ownTitle;

    // 兼容 Ant Design ellipsis：
    // 例如：
    // <span>
    //   新乡美年大健康管理有限公
    //   <span title="司门诊部">...</span>
    // </span>
    // 需要拼接成完整名称。

    const ellipsisNodes = td.querySelectorAll(
      ".ant-typography-ellipsis span"
    );

    if (ellipsisNodes.length) {
      let result = "";

      ellipsisNodes.forEach(node => {
        node.childNodes.forEach(child => {

          if (child.nodeType === Node.TEXT_NODE) {
            result += child.nodeValue || "";
          }

          if (
            child.nodeType === Node.ELEMENT_NODE &&
            child.getAttribute("title")
          ) {
            result += child.getAttribute("title");
          }

        });
      });

      result = normText(result);

      if (result) return result;
    }

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
  function setCellTextKeepStructure(td, newText) {

    const textNodes = getMeaningfulTextNodes(td);

    if (!textNodes.length) return false;

    // 只修改已有文本节点，避免破坏 React 管理的 DOM
    textNodes[0].nodeValue = newText;

    for (let i = 1; i < textNodes.length; i++) {
      textNodes[i].nodeValue = "";
    }

    return true;
  }

  // 开票客户：不重建 DOM，只用 CSS 将原有名称和税号排成一行。
  function prepareCustomerCell(td) {
    const divs = td.querySelectorAll(":scope > .ellipsis");
    if (divs.length !== 2) return;

    const name = normText(divs[0].innerText);
    const code = normText(divs[1].innerText);
    if (!name || !code) return;

    td.setAttribute("data-tm-customer", "1");
    td.setAttribute("title", `${name}，${code}`);
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

      ${scope} .ant-table-body {
        overflow-x: hidden !important;
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }

      ${scope} .ant-table-header,
      ${scope} .ant-table-body {
        width: 100% !important;
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
      ${scope} td[data-tm-customer="1"] > .ellipsis:first-child::after {
        content: "，";
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

      ${scope} tr.tm-row-refund,
      ${scope} tr.tm-row-refund * { color: #ff4d4f !important; }

      ${scope} tr.tm-row-fail > td { background: rgb(35,127,254) !important; }
      ${scope} tr.tm-row-fail,
      ${scope} tr.tm-row-fail * { color: #fff !important; }
    `;

    HIDDEN_COLUMNS.forEach((header) => {
      const domIndex = headerIndexMap.get(header);

      if (domIndex !== undefined) {
        css += `
          ${scope} .ant-table-header th:nth-child(${domIndex + 1}),
          ${scope} .ant-table-body td:nth-child(${domIndex + 1}) {
            display:none !important;
          }
        `;
      }
    });

    COLUMN_LAYOUT.forEach((column, visualIndex) => {
      const domIndex = headerIndexMap.get(column.header);
      if (domIndex === undefined) return;

      const width = getColumnWidth(column);
      const alignment =
        column.align === "right"
          ? "justify-content:flex-end !important;text-align:right !important;font-variant-numeric:tabular-nums;"
          : "";

      css += `
        ${scope} .ant-table-header th:nth-child(${domIndex + 1}),
        ${scope} .ant-table-body td:nth-child(${domIndex + 1}) {
          order: ${visualIndex};
          width: ${width}px;
          flex: 0 0 ${width}px;
          max-width: ${width}px;
          ${alignment}
        }
      `;
    });

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

    return css;
  }

  function applyOrUpdateStyle(
    headerSignature = getHeaderSignature(observedTableRoot)
  ) {
    if (!observedTableRoot) return;
    markTableRoot(observedTableRoot);

    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "tm-order-invoice-style";
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = buildCss(getHeaderIndexMap(observedTableRoot));
    lastHeaderSignature = headerSignature;
    updateUiLabel();
  }

  function removeStyle() {
    const node = document.getElementById("tm-order-invoice-style");
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
    }


    // 跳过操作链接和按钮，避免破坏操作列。
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      if (!cell || cell.querySelector("a,button")) continue;

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
      const rawAmount = getCellFullText(cells[amountIdx]);
      const cleanedAmount = removeAmountSeparators(rawAmount);
      if (cleanedAmount !== rawAmount) {
        setCellTextKeepStructure(cells[amountIdx], cleanedAmount);
      }
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

  function processRowsIncremental(tableRoot = observedTableRoot) {
    if (!tableRoot) return;

    const columnIndexes = getHeaderIndexMap(tableRoot);
    getBodyRows(tableRoot).forEach((tr) => processRow(tr, columnIndexes));
  }

  /******************** 8) UI：按钮 + 快捷键 ********************/
  function ensureUiButton() {
    if (uiBtn && document.body.contains(uiBtn)) return;

    uiBtn = document.createElement("button");
    uiBtn.id = "tm-order-btn-widen-customer";
    uiBtn.type = "button";
    uiBtn.title = "左键加宽，右键缩窄；快捷键 Alt+= / Alt+-";

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

    uiBtn.addEventListener("click", () => changeCustomerWidth(WIDTH_STEP));

    uiBtn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      changeCustomerWidth(-WIDTH_STEP);
    });

    document.body.appendChild(uiBtn);
    updateUiLabel();
  }

  function removeUiButton() {
    const node = document.getElementById("tm-order-btn-widen-customer");
    if (node) node.remove();
    uiBtn = null;
  }

  function updateUiLabel() {
    if (!uiBtn) return;

    const customerColumn = getAdjustableColumn();
    const currentWidth = customerColumn ? getColumnWidth(customerColumn) : 0;
    uiBtn.textContent = `开票客户 +${WIDTH_STEP}px（当前 ${currentWidth}px）`;
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

  function getClipboardCellText(cell, header) {
    if (!cell) return "";

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
      rows.push(
        selectedColumns.map((column) =>
          getClipboardCellText(row.children[column.domIndex], column.header)
        )
      );
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

    pendingForceStyle = pendingForceStyle || forceStyle;
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
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
      processRowsIncremental(observedTableRoot);
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

    return !/\/(query|list|detail|page|statistics|total|count|type|goods|org|company|template)/i.test(
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
    scheduleWork(false);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;

    disconnectTableObserver();
    disconnectRootObserver();
    removeStyle();
    removeUiButton();

    customerWidthDelta = 0;
    lastPageKey = null;
    lastHeaderSignature = "";
    pendingForceStyle = false;
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
