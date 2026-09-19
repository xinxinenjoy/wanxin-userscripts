// ==UserScript==
// @name         扁鹊-1.8套餐批量删除
// @namespace    https://tampermonkey.net/
// @version      1.0.0
// @description  SOA 订单页：列出当前订单的全部套餐/加项包，勾选后批量删除。直接调接口（package/query + package/delete），不模拟点击；支持按类型批量勾选、逐条结果回报、删除后自动重算订单收入。
// @match        https://checkup-soa3.health-100.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-shanchutaocan
// ==/UserScript==

/*
 * 扁鹊-1.8 订单套餐批量删除
 *
 * ── 它解决什么 ──
 * 页面自带的删除是「一行一个按钮 + 每删一个等一次刷新」，套餐多的时候很折磨。
 * 本脚本把当前订单的套餐**全部列出来**，勾选后一次删掉，并逐条回报成败。
 *
 * ── 关于删除与作废的边界（红领巾 2026-09-19 明确）──
 *   未落单订单内的套餐 = 【删除】  ← 本脚本只做这个
 *   已落单订单内的套餐 = 【作废】  ← 另一条线，本脚本**不做**，不要在 1.8 里混进来。
 *   因此脚本**不拦截**已落单订单，只把订单状态显示在面板上供你判断；
 *   真要删到已落单订单，服务端会拒绝，脚本如实把失败原因显示出来。
 *
 * ── 接口（2026-09-19 抓包 + 实测，全部已验证）──
 *
 *   ① POST /soa/api/v1/package/query      拉套餐列表   {order_code}
 *      → data[] 每项含 package_code / package_name / package_type / estimate_count
 *        / price / sale_price / cust_type / process_status / status
 *
 *   ② POST /soa/api/v1/package/delete     删一个套餐   {code, order_type}
 *      ⚠️ 只要 code + order_type 两个字段，**不需要 order_code**
 *         ⇒ 拿到 package_code 就能删任何订单的套餐，所以本脚本坚持"先列出、人工勾选"。
 *      → 成功：{result_code:"SUCC", data:{package_code, order_income:{...}}}
 *
 *   ③ POST /soa/api/v1/order/info         订单详情     {order_code}
 *      → data.order_type（LOCAL/UNION，删除请求要用）、data.status（订单状态）
 *
 *   ④ POST /soa/api/v1/order/evaluate     重算订单收入 {order_code}
 *      → 页面每次删完都会调它；脚本删完也补一次，保证收入数据一致。
 *
 * ── 两个必须记住的接口事实（踩过才知道）──
 *   · 成功与失败**都是 HTTP 200**，必须看 body 里的 result_code（SUCC / FAIL）。
 *     失败样本：{"result_code":"FAIL","code":"PACKAGE_NOT_EXISTS","data":"套餐不存在"}
 *     ⇒ 脚本一律以 result_code 判定，绝不看 HTTP 状态码。
 *   · mnClientId: MN_SOA3 实测**非必填**（不带也返回同样业务响应），
 *     但为与页面行为一致仍然带上。
 *
 * ── 订单号从哪来 ──
 *   实测（2026-09-19）：localStorage 里**没有**订单号，稳定来源是地址栏 hash
 *   `#/order/package?oper=edit&orderCode=SOA37894823645400806`；
 *   兜底再从页面正文抓 `SOA\d+`。两者都拿不到就提示你切到订单套餐页，不猜。
 *
 * ── 套餐类型（从前端 chunk 挖到，值是接口约定的，别改）──
 *   PACKAGE     普通套餐
 *   GIVEPACKAGE 赠送套餐
 *   ADDPKG      加项包
 *   GIVEPKG     赠送包
 *   AIADDPKG    智略加项包
 *
 * ── 为什么不用模拟点击 ──
 *   页面的删除按钮走 antd Modal 二次确认，依赖 DOM 与 React 合成事件；
 *   且每删一个页面要重跑 evaluate + query（约 3 秒）。接口单次约 480ms，
 *   且失败能拿到明确 error_desc。前端改版也不会把脚本改挂。
 *   页面删除后的"业务副作用"只有两个**读**接口，脚本自己补即可，不丢逻辑。
 */

(function () {
  'use strict';

  if (location.hostname !== 'checkup-soa3.health-100.cn') return;

  // ============================================================
  // 0. 命名空间与常量
  // ============================================================
  const NS = '__hlj_pkg_batch_del_v100';
  const IDS = {
    switch: `${NS}_switch`,
    style: `${NS}_style`,
    panel: `${NS}_panel`,
    head: `${NS}_head`,
    title: `${NS}_title`,
    close: `${NS}_close`,
    meta: `${NS}_meta`,
    toolbar: `${NS}_toolbar`,
    list: `${NS}_list`,
    footer: `${NS}_footer`,
    log: `${NS}_log`,
  };

  // 本脚本挂在「红领巾的工具箱」里 —— 和 1.2 订单智能审批 / 1.3 体检数据查询 /
  // 1.4 对账报表导出 同一个框体（红领巾 2026-09-19 要求：它操作的也是订单，要归在一起）。
  // 框体是订单页 tabs 行里的一个 span，1.2 建的；按钮按 data-soa-tool-order 排序。
  const TOOLBOX_GROUP_ID = '__soa_tools_switch_group_v10';
  const TOOLBOX_ANCHOR = '.tabs-wrap > .tabs > .order-desc';
  const TOOL_ORDER = '4'; // 1.2=1 / 1.3=2 / 1.4=3，本脚本接在第 4 位
  const VERSION = '1.0.0';
  const SWITCH_LABEL = '批量删套餐';
  const POS_KEY = `${NS}_pos`;

  const CLIENT_ID = 'MN_SOA3';

  const API = {
    orderInfo: '/soa/api/v1/order/info',
    orderEvaluate: '/soa/api/v1/order/evaluate',
    pkgQuery: '/soa/api/v1/package/query',
    pkgDelete: '/soa/api/v1/package/delete',
    // 体检名单状态：返回 check_list_size(已检) / book_list_size(已约) / unbook_list_size(待约)
    // 页面自己在「点操作时」才调它；本脚本提前调，用于把不可动的套餐在列表里标出来。
    pkgCheck: '/soa/api/v1/package/update/check',

    // 套餐 ↔ 加项包/赠送包 的绑定关系（2026-09-19 抓包确认）
    //   绑定：{package_code: 主套餐, add_packages: [{group, add_pkg_codes:[...], selection_size,
    //          selection_min_size, selection_max_size, disables, ...}]}
    //   解绑：{package_code: 主套餐, add_packages: []}   ← 传空数组 = 清空该主套餐**全部**绑定
    // ⚠️ 所以只有当该主套餐「只绑了这一个」时，传 [] 才是精确的；否则会误伤别的包。
    pkgRelation: '/soa/api/v1/package/add_relation_package',
  };

  const TYPE_CN = {
    PACKAGE: '普通套餐',
    GIVEPACKAGE: '赠送套餐',
    ADDPKG: '加项包',
    GIVEPKG: '赠送包',
    AIADDPKG: '智略加项包',
  };
  const TYPE_ORDER = ['PACKAGE', 'GIVEPACKAGE', 'ADDPKG', 'GIVEPKG', 'AIADDPKG'];

  const CUST_CN = { MALE: '男', FEMALE: '女未婚', WOMAN: '女已婚' };

  // 订单状态（前端 chunk 挖到）。只用于面板展示，不做拦截
  const ORDER_STATUS_CN = {
    DRAFT: '草稿',
    CONFIRM_AUDIT: '报价确认',
    BACKUP_AUDIT: '内勤复核',
    CONTRACT_SUPPLE: '合同补充',
    PUBLISH_AUDIT: '发单审核',
    PRE_SUBMIT: '落单审核',
    SUBMITTING: '落单中',
    SUBMITTED: '已落单',
    LOCKED: '锁定',
    CANCEL: '取消',
    DISCONTINUE: '中止',
    FINISH: '完成',
  };

  const DELAY_MS = 150; // 相邻两次删除之间的间隔

  // ============================================================
  // 1. 小工具
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) =>
    String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  function log(msg, kind) {
    const box = $(IDS.log);
    if (!box) return;
    const line = document.createElement('div');
    line.className = 'hlj-bd-log-line' + (kind ? ' is-' + kind : '');
    const t = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    line.textContent = `[${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function clearLog() {
    const box = $(IDS.log);
    if (box) box.innerHTML = '';
  }

  // ============================================================
  // 2. 请求层
  // ============================================================
  async function apiPost(path, body) {
    const res = await fetch(location.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', mnClientId: CLIENT_ID },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    let j;
    try {
      j = await res.json();
    } catch (e) {
      // 登录态失效时网关会返 HTML，这里要能区分"接口报错"和"根本没通"
      throw new Error('HTTP ' + res.status + ' 返回非 JSON，可能登录态已失效');
    }
    return j;
  }

  const isOk = (j) => !!j && j.result_code === 'SUCC';
  const errText = (j) => (j && (j.error_desc || j.msg || j.data || j.code)) || '未知错误';

  // ============================================================
  // 3. 订单号
  // ============================================================

  /**
   * 当前订单号。来源优先级：手动传入 > 地址栏 hash > 页面正文。
   *
   * 实测（2026-09-19）：hash 形如
   *   #/order/package?oper=edit&orderCode=SOA37894823645400806
   * 而 localStorage / sessionStorage 里都**没有**订单号，所以别去那里找。
   */
  function currentOrderCode(explicit) {
    if (explicit) return String(explicit).trim();

    const hash = decodeURIComponent(location.hash || '');
    let m = hash.match(/[?&]order_?code=([A-Za-z0-9_-]+)/i);
    if (m) return m[1];

    // 兜底：页面上写着「本地3.0订单编号：SOA…」。只在明确没有 hash 参数时才用
    const txt = document.body ? document.body.innerText || '' : '';
    m = txt.match(/\b(SOA\d{12,})\b/);
    if (m) return m[1];

    return null;
  }

  // ============================================================
  // 4. 数据
  // ============================================================
  async function fetchOrderInfo(orderCode) {
    const j = await apiPost(API.orderInfo, { order_code: orderCode });
    if (!isOk(j)) throw new Error('读取订单详情失败：' + errText(j));
    return j.data || {};
  }

  async function fetchPackages(orderCode) {
    const j = await apiPost(API.pkgQuery, { order_code: orderCode });
    if (!isOk(j)) throw new Error('读取套餐列表失败：' + errText(j));
    return Array.isArray(j.data) ? j.data : [];
  }

  // ============================================================
  // 5. 状态
  // ============================================================
  const state = {
    orderCode: null,
    orderInfo: null,
    orderType: null,
    packages: [],
    checked: new Set(), // package_code
    busy: false,
    results: new Map(), // package_code -> {ok, msg}
    // package_code -> {check_list_size, book_list_size, unbook_list_size, flag, message}
    // undefined = 还没查；null = 查失败
    checks: new Map(),
    // package_code → [{hostCode, hostName, hostType, group, hostBindCount}]
    // 该加项包/赠送包被哪些主套餐绑定；hostBindCount = 那个主套餐一共绑了几个包
    binds: new Map(),
    armed: false, // "确认删除"二次确认已就绪
    loaded: false,
  };

  function resetState(keepOrder) {
    if (!keepOrder) {
      state.orderCode = null;
      state.orderInfo = null;
      state.orderType = null;
    }
    state.packages = [];
    state.checked = new Set();
    state.results = new Map();
    state.checks = new Map();
    state.binds = new Map();
    state.armed = false;
    state.loaded = false;
  }

  // ============================================================
  // 6. 样式
  // ============================================================
  function ensureStyle() {
    if ($(IDS.style)) return;
    const style = document.createElement('style');
    style.id = IDS.style;
    style.textContent = `
      /* ---------- 工具箱开关（与 1.2 / 1.3 / 1.4 同一套外观）---------- */
      #${IDS.switch} {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        height: 32px;
        padding: 0 12px;
        border: 1px solid #1677ff;
        border-radius: 6px;
        background: #1677ff;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        line-height: 30px;
        cursor: pointer;
        white-space: nowrap;
        vertical-align: middle;
        box-sizing: border-box;
      }
      #${IDS.switch}:hover { background: #4096ff; border-color: #4096ff; }
      #${IDS.switch}:active { background: #0958d9; border-color: #0958d9; }
      #${IDS.switch}.is-active {
        background: #0958d9;
        border-color: #0958d9;
        box-shadow: inset 0 2px 5px rgba(0, 0, 0, .18);
      }

      /* ---------- 面板 ---------- */
      #${IDS.panel} {
        position: fixed;
        top: 76px;
        right: 18px;
        width: 560px;
        max-width: calc(100vw - 36px);
        max-height: calc(100vh - 110px);
        display: flex;
        flex-direction: column;
        background: #ffffff;
        border: 1px solid #d9d9d9;
        border-radius: 10px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, .16);
        z-index: 2147483000;
        font-size: 13px;
        color: #262626;
        overflow: hidden;
      }
      #${IDS.head} {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: linear-gradient(180deg, #fafafa, #f2f2f2);
        border-bottom: 1px solid #e8e8e8;
        cursor: move;
        user-select: none;
      }
      #${IDS.title} { font-weight: 600; font-size: 14px; }
      #${IDS.head} .hlj-bd-spacer { flex: 1; }
      #${IDS.close} {
        width: 26px; height: 26px; line-height: 24px; text-align: center;
        border: 1px solid #d9d9d9; background: #fff; border-radius: 6px;
        cursor: pointer; font-size: 15px; color: #595959;
      }
      #${IDS.close}:hover { background: #f5f5f5; color: #262626; }

      #${IDS.meta} {
        padding: 8px 12px;
        border-bottom: 1px solid #f0f0f0;
        background: #fcfcfc;
        color: #595959;
        line-height: 1.7;
        font-size: 12px;
      }
      #${IDS.meta} b { color: #262626; }
      #${IDS.meta} .hlj-bd-st {
        display: inline-block; padding: 0 6px; border-radius: 4px;
        background: #e6f4ff; color: #0958d9; margin-left: 4px;
      }
      #${IDS.meta} .hlj-bd-st.is-done { background: #fff1f0; color: #cf1322; }

      /* ---------- 工具条 ---------- */
      #${IDS.toolbar} {
        display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
        padding: 8px 12px; border-bottom: 1px solid #f0f0f0;
      }
      #${IDS.toolbar} button {
        height: 26px; padding: 0 10px; border-radius: 5px;
        border: 1px solid #d9d9d9; background: #fff; color: #404040;
        font-size: 12px; cursor: pointer;
      }
      #${IDS.toolbar} button:hover { border-color: #4096ff; color: #1677ff; }
      #${IDS.toolbar} button:disabled { opacity: .45; cursor: not-allowed; }
      #${IDS.toolbar} .hlj-bd-cnt { margin-left: auto; color: #8c8c8c; font-size: 12px; }

      /* ---------- 列表 ---------- */
      #${IDS.list} {
        flex: 1;
        overflow: auto;
        padding: 4px 0 8px;
        min-height: 120px;
      }
      .hlj-bd-row {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 7px 12px; border-bottom: 1px solid #f5f5f5;
      }
      .hlj-bd-row:hover { background: #fafafa; }
      .hlj-bd-row.is-done { opacity: .55; }

      /* 已体检（不可删除）：整行压灰、去掉悬停反馈，一眼看出这条动不了 */
      .hlj-bd-row.is-blocked {
        background: #fafafa;
        opacity: .62;
        cursor: not-allowed;
      }
      .hlj-bd-row.is-blocked:hover { background: #fafafa; }
      .hlj-bd-row.is-blocked .hlj-bd-name,
      .hlj-bd-row.is-blocked .hlj-bd-sub { color: #8c8c8c; }
      .hlj-bd-row.is-blocked input[type="checkbox"] { cursor: not-allowed; }
      .hlj-bd-block {
        flex: none;
        font-size: 12px;
        padding-top: 2px;
        color: #cf1322;
        white-space: nowrap;
      }
      /* 简单绑定：会在删除时自动解绑，只做提示，不影响勾选 */
      .hlj-bd-bind { color: #1677ff; cursor: help; }
      /* 检查中：先不给勾，避免在结果回来之前手滑勾上 */
      .hlj-bd-checking {
        flex: none;
        font-size: 12px;
        padding-top: 2px;
        color: #bfbfbf;
        white-space: nowrap;
      }
      .hlj-bd-row input[type="checkbox"] {
        margin: 3px 0 0; width: 14px; height: 14px; cursor: pointer; flex: none;
      }
      .hlj-bd-main { flex: 1; min-width: 0; }
      .hlj-bd-name {
        display: block; line-height: 1.45; word-break: break-all; color: #262626;
      }
      .hlj-bd-sub {
        margin-top: 2px; color: #8c8c8c; font-size: 12px; line-height: 1.5;
        word-break: break-all;
      }
      .hlj-bd-tag {
        display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px;
        line-height: 18px; margin-right: 6px; vertical-align: 1px;
        background: #f0f0f0; color: #595959;
      }
      .hlj-bd-tag.t-PACKAGE { background: #e6f4ff; color: #0958d9; }
      .hlj-bd-tag.t-GIVEPACKAGE { background: #f9f0ff; color: #722ed1; }
      .hlj-bd-tag.t-ADDPKG { background: #fff7e6; color: #d46b08; }
      .hlj-bd-tag.t-GIVEPKG { background: #f6ffed; color: #389e0d; }
      .hlj-bd-tag.t-AIADDPKG { background: #e6fffb; color: #08979c; }
      .hlj-bd-tag.is-clickable { cursor: pointer; }
      .hlj-bd-tag.is-clickable:hover { outline: 1px solid currentColor; }

      .hlj-bd-res { flex: none; font-size: 12px; padding-top: 2px; min-width: 44px; text-align: right; }
      .hlj-bd-res.ok { color: #389e0d; }
      .hlj-bd-res.fail { color: #cf1322; }

      .hlj-bd-empty { padding: 24px 12px; text-align: center; color: #8c8c8c; }

      /* ---------- 底部 ---------- */
      #${IDS.footer} {
        border-top: 1px solid #f0f0f0; padding: 9px 12px;
        display: flex; align-items: center; gap: 8px; background: #fafafa;
      }
      #${IDS.footer} .hlj-bd-sum { color: #595959; font-size: 12px; margin-right: auto; }
      #${IDS.footer} button {
        height: 30px; padding: 0 14px; border-radius: 6px; font-size: 13px;
        cursor: pointer; border: 1px solid #d9d9d9; background: #fff; color: #404040;
      }
      #${IDS.footer} button:hover:not(:disabled) { border-color: #4096ff; color: #1677ff; }
      #${IDS.footer} button:disabled { opacity: .45; cursor: not-allowed; }
      #${IDS.footer} button.hlj-bd-danger {
        background: #fff;
        border-color: #d4380d;
        color: #d4380d;
        font-weight: 500;
      }
      #${IDS.footer} button.hlj-bd-danger:hover:not(:disabled) { background: #fff2e8; }
      #${IDS.footer} button.hlj-bd-danger.is-armed {
        background: #d4380d; border-color: #d4380d; color: #fff;
      }
      #${IDS.footer} button.hlj-bd-danger.is-armed:hover:not(:disabled) {
        background: #ad2102; border-color: #ad2102; color: #fff;
      }

      /* ---------- 日志 ---------- */
      #${IDS.log} {
        max-height: 108px; overflow: auto; border-top: 1px solid #f0f0f0;
        padding: 6px 12px; background: #fcfcfc; font-size: 12px;
        line-height: 1.65; color: #595959;
      }
      .hlj-bd-log-line.is-ok { color: #389e0d; }
      .hlj-bd-log-line.is-err { color: #cf1322; }
      .hlj-bd-log-line.is-warn { color: #d46b08; }
      .hlj-bd-log-line.is-hint { color: #8c8c8c; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================================
  // 7. 工具箱开关
  // ============================================================

  /**
   * 拿到「红领巾的工具箱」框体。
   *
   * 它是 1.2 建的（1.3 / 1.4 也往里挂按钮），正常情况下已经存在；
   * 若 1.2 没装/没启用，这里按 1.2 的样式自己建一个 —— 布局参数照抄 1.2，
   * 免得单独启用本脚本时框体位置跟别的不一样。
   *
   * 锚点 `.tabs-wrap > .tabs > .order-desc`（「本地3.0订单编号：SOA…」那一行）。
   * **找不到锚点 = 不在订单页 → 不挂**，这也顺带解决了「非订单页不该出现入口」的问题。
   */
  function ensureToolboxGroup() {
    let group = document.getElementById(TOOLBOX_GROUP_ID);
    if (group && group.isConnected) return group;

    const desc = document.querySelector(TOOLBOX_ANCHOR);
    if (!desc || !desc.parentElement) return null;
    if (group) group.remove(); // 清掉 SPA 重绘后的半成品

    group = document.createElement('span');
    group.id = TOOLBOX_GROUP_ID;
    group.style.cssText = [
      'display:inline-flex',
      'flex:0 0 auto',
      'align-items:center',
      'gap:6px',
      'margin-left:10px',
      'margin-right:7px',
      'padding:0',
      'border:0',
      'background:transparent',
      'box-sizing:border-box',
      'vertical-align:middle',
      'overflow:visible',
      'isolation:isolate',
    ].join(';');
    desc.parentElement.insertBefore(group, desc);
    return group;
  }

  /**
   * 把开关挂进工具箱，并按 data-soa-tool-order 重排。
   * 排序逻辑照抄 1.2：1.2=1 / 1.3=2 / 1.4=3 / 本脚本=4。
   */
  function placeSwitch(btn) {
    const group = ensureToolboxGroup();
    if (!group) return 'no-toolbox';
    if (btn.parentElement !== group) group.appendChild(btn);

    const btns = Array.from(group.querySelectorAll('button[data-soa-tool-order]'));
    const sorted = btns.slice().sort(
      (a, b) => Number(a.dataset.soaToolOrder || 999) - Number(b.dataset.soaToolOrder || 999)
    );
    if (btns.some((b, i) => b !== sorted[i])) sorted.forEach((b) => group.appendChild(b));
    return 'toolbox';
  }

  function ensureSwitch() {
    const existing = $(IDS.switch);

    if (existing && existing.isConnected) {
      placeSwitch(existing);
      if (existing.textContent !== SWITCH_LABEL) existing.textContent = SWITCH_LABEL;
      return;
    }
    if (existing) existing.remove();

    // 锚点不在就别建按钮 —— 免得在非订单页留一个挂着也点不开的按钮
    if (!document.querySelector(TOOLBOX_ANCHOR)) return;

    const btn = document.createElement('button');
    btn.id = IDS.switch;
    btn.type = 'button';
    btn.dataset.soaToolOrder = TOOL_ORDER;
    btn.textContent = SWITCH_LABEL;
    btn.title = '列出当前订单的套餐，勾选后批量删除（只做删除；已落单订单请走作废）';

    // 别让点击冒泡到页面 tabs 的切换逻辑里
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((evt) => {
      btn.addEventListener(evt, (e) => e.stopPropagation());
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    placeSwitch(btn);
  }

  // ============================================================
  // 8. 面板
  // ============================================================
  function ensurePanel() {
    let p = $(IDS.panel);
    if (p) return p;

    p = document.createElement('div');
    p.id = IDS.panel;
    p.innerHTML = `
      <div id="${IDS.head}">
        <span id="${IDS.title}">订单套餐批量删除</span>
        <span class="hlj-bd-spacer"></span>
        <button id="${IDS.close}" type="button" title="关闭">×</button>
      </div>
      <div id="${IDS.meta}">正在读取订单…</div>
      <div id="${IDS.toolbar}">
        <button type="button" data-act="all">全选</button>
        <button type="button" data-act="none">清空</button>
        <button type="button" data-act="invert">反选</button>
        <button type="button" data-act="reload">重新读取</button>
        <span class="hlj-bd-cnt"></span>
      </div>
      <div id="${IDS.list}"></div>
      <div id="${IDS.footer}">
        <span class="hlj-bd-sum">—</span>
        <button type="button" data-act="refreshPage">刷新页面</button>
        <button type="button" class="hlj-bd-danger" data-act="del" disabled>删除选中</button>
      </div>
      <div id="${IDS.log}"></div>
    `;
    document.body.appendChild(p);

    $(IDS.close).addEventListener('click', closePanel);
    p.querySelector(`#${IDS.toolbar}`).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.act) return;
      onToolbar(btn.dataset.act);
    });
    p.querySelector(`#${IDS.footer}`).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !btn.dataset.act) return;
      if (btn.dataset.act === 'del') onDeleteClick();
      if (btn.dataset.act === 'refreshPage') location.reload();
    });

    // 勾选：事件委托，行是动态渲染的
    $(IDS.list).addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      const code = cb.dataset.code;
      if (!code) return;
      if (cb.checked) state.checked.add(code);
      else state.checked.delete(code);
      state.armed = false; // 勾选一变，之前的"确认"作废，防手滑
      paintFooter();
    });

    // 类型标签点击 = 勾选/取消该类型全部（套餐多的时候省事）
    $(IDS.list).addEventListener('click', (e) => {
      const tag = e.target.closest('.hlj-bd-tag.is-clickable');
      if (!tag || !tag.dataset.type) return;
      toggleType(tag.dataset.type);
    });

    makeDraggable(p, $(IDS.head));
    restorePos(p);
    return p;
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      panel.style.right = 'auto';
      panel.style.left = ox + 'px';
      panel.style.top = oy + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 120, ox + e.clientX - sx));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
      panel.style.left = nx + 'px';
      panel.style.top = ny + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      try {
        GM_setValue(POS_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top }));
      } catch (e) {
        /* 存不下就算了，不影响使用 */
      }
    });
  }

  function restorePos(panel) {
    let raw = null;
    try {
      raw = GM_getValue(POS_KEY, null);
    } catch (e) {
      raw = null;
    }
    if (!raw) return;
    try {
      const o = JSON.parse(raw);
      if (o && o.left && o.top) {
        panel.style.right = 'auto';
        panel.style.left = o.left;
        panel.style.top = o.top;
      }
    } catch (e) {
      /* 位置数据坏了就忽略，用默认位置 */
    }
  }

  function openPanel() {
    ensureStyle();
    const p = ensurePanel();
    p.style.display = 'flex';
    const sw = $(IDS.switch);
    if (sw) sw.classList.add('is-active');
    load();
  }

  function closePanel() {
    const p = $(IDS.panel);
    if (p) p.style.display = 'none';
    const sw = $(IDS.switch);
    if (sw) sw.classList.remove('is-active');
  }

  function togglePanel() {
    const p = $(IDS.panel);
    if (p && p.style.display !== 'none') closePanel();
    else openPanel();
  }

  // ============================================================
  // 9. 渲染
  // ============================================================
  function paintMeta() {
    const el = $(IDS.meta);
    if (!el) return;
    if (!state.orderCode) {
      el.innerHTML =
        '没认出订单号。请先打开该订单的「<b>套餐与加项包</b>」页面再打开本面板。';
      return;
    }
    const info = state.orderInfo || {};
    const st = info.status;
    const stCn = ORDER_STATUS_CN[st] || st || '未知';
    const done = st === 'SUBMITTED';
    el.innerHTML =
      '订单 <b>' + esc(state.orderCode) + '</b>' +
      (state.orderType ? '（' + esc(state.orderType) + '）' : '') +
      '<span class="hlj-bd-st' + (done ? ' is-done' : '') + '">' + esc(stCn) + '</span>' +
      '<br><span>订单名称：' + esc(info.order_name || '—') + '</span>' +
      '<br><span style="color:#8c8c8c">本工具只做「删除」。已落单订单内的套餐属于「作废」，不走这里。</span>';
  }

  function rowHtml(p) {
    const code = p.package_code;
    const type = p.package_type || '';
    const res = state.results.get(code);
    const done = !!res;

    // 体检名单状态（红领巾 2026-09-19 的硬要求：名单里有已检人员 → 该套餐不可动）
    //   checks 里没有该 code  → undefined = 还在查，先不给勾，免得结果回来前手滑勾上
    //   checks.get(code) === null → 查询失败，状态未知，同样不给勾（宁可少删，不可错删）
    //   check_list_size > 0     → 存在已检人员，整行压灰 + 标红，不可选
    const ck = state.checks.get(code);
    const bs = bindState(p);
    const checking = ck === undefined && !done;
    const unknown = ck === null && !done;
    const hasChecked = !!ck && ck.check_list_size > 0;
    // 绑定关系复杂（宿主主套餐还挂着别的包）→ 不敢自动解绑，只能挡在这里
    const bindHard = bs.bound && !bs.simple;
    const blocked = (hasChecked || bindHard) && !done;
    const locked = blocked || checking || unknown;
    const checkCount = hasChecked ? ck.check_list_size : 0;

    const nums = [];
    if (p.cust_type) nums.push(CUST_CN[p.cust_type] || p.cust_type);
    if (p.pay_type) nums.push(p.pay_type === 'CORP_PAY' ? '公司挂账' : p.pay_type);
    if (p.estimate_count !== undefined && p.estimate_count !== null) nums.push(p.estimate_count + '人');
    if (p.sale_price !== undefined && p.sale_price !== null) nums.push('¥' + p.sale_price);

    // 右侧状态位，优先级：删除结果 > 已体检 > 绑定关系复杂 > 检查中/未知
    let tailHtml = res
      ? '<span class="hlj-bd-res ' + (res.ok ? 'ok' : 'fail') + '" title="' + esc(res.msg || '') + '">' +
        (res.ok ? '已删除' : '失败') + '</span>'
      : '';
    if (!done) {
      if (hasChecked) {
        tailHtml =
          '<span class="hlj-bd-block" title="' +
          esc(
            (ck.message || '体检名单中已有已检人员') +
              '（已检 ' + checkCount + ' 人，已约 ' + (ck.book_list_size || 0) +
              ' 人，待约 ' + (ck.unbook_list_size || 0) + ' 人）'
          ) +
          '">已体检 ' + checkCount + ' 人，不可删除</span>';
      } else if (bindHard) {
        const hosts = bs.binds
          .map((b) => b.hostName + '（该套餐还绑着 ' + b.hostBindCount + ' 个包）')
          .join('；');
        tailHtml =
          '<span class="hlj-bd-block" title="' +
          esc('被主套餐绑着：' + hosts + '。解绑会连带清空该主套餐的其他绑定，故不自动处理，请手工解绑后再删') +
          '">已绑定，需先解绑</span>';
      } else if (checking) {
        tailHtml = '<span class="hlj-bd-checking">检查中…</span>';
      } else if (unknown) {
        tailHtml = '<span class="hlj-bd-checking" title="体检名单状态查询失败">状态未知</span>';
      }
    }

    // 副行追加「↔ 绑定」提示：简单绑定会在删除时自动解绑，先让用户看得见
    let bindTip = '';
    if (!done && bs.bound && bs.simple) {
      bindTip =
        ' · <span class="hlj-bd-bind" title="' +
        esc('删除前会自动执行解绑（该主套餐只绑了这一个包）') +
        '">↔ 绑定在 ' + esc(bs.binds[0].hostName) + '</span>';
    }

    return `
      <div class="hlj-bd-row${done ? ' is-done' : ''}${blocked ? ' is-blocked' : ''}" data-code="${esc(code)}">
        <input type="checkbox" data-code="${esc(code)}"${state.checked.has(code) ? ' checked' : ''}${done || locked ? ' disabled' : ''}>
        <div class="hlj-bd-main">
          <span class="hlj-bd-name">
            <span class="hlj-bd-tag t-${esc(type)} is-clickable" data-type="${esc(type)}" title="点击：勾选/取消全部「${esc(TYPE_CN[type] || type)}」">${esc(TYPE_CN[type] || type)}</span>${esc(p.package_name)}
          </span>
          <span class="hlj-bd-sub">${esc(code)}${nums.length ? ' · ' + esc(nums.join(' · ')) : ''}${bindTip}</span>
        </div>
        ${tailHtml}
      </div>
    `;
  }

  function paintList() {
    const box = $(IDS.list);
    if (!box) return;
    if (!state.orderCode) {
      box.innerHTML = '<div class="hlj-bd-empty">未识别到订单号</div>';
      return;
    }
    if (!state.packages.length) {
      box.innerHTML = '<div class="hlj-bd-empty">该订单没有套餐记录</div>';
      return;
    }
    // 按类型分组显示，和页面上「普通套餐 / 赠送套餐 / 加项包 / 赠送包」的分区一致
    const groups = new Map();
    state.packages.forEach((p) => {
      const t = p.package_type || 'OTHER';
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(p);
    });
    const order = TYPE_ORDER.filter((t) => groups.has(t)).concat(
      [...groups.keys()].filter((t) => TYPE_ORDER.indexOf(t) < 0)
    );

    let html = '';
    order.forEach((t) => {
      const arr = groups.get(t);
      html +=
        '<div style="padding:6px 12px 2px;color:#8c8c8c;font-size:12px;">' +
        esc(TYPE_CN[t] || t) + '（' + arr.length + '）</div>';
      arr.forEach((p) => {
        html += rowHtml(p);
      });
    });
    box.innerHTML = html;
  }

  /**
   * 建立「加项包/赠送包 → 绑它的主套餐」索引。
   *
   * 绑定关系挂在**主套餐**的 add_packages 上（每项 {group, package_code, package_name}），
   * 所以这里反过来建索引：某个包被谁绑着。
   *
   * `hostBindCount` 是判断「能否安全自动解绑」的关键 ——
   * 解绑接口 {package_code, add_packages: []} 是**清空那个主套餐的全部绑定**，
   * 只有当它一共只绑了这一个包时，清空才恰好等于精确解绑。
   */
  function buildBinds(list) {
    const idx = new Map();
    list.forEach((host) => {
      const arr = host.add_packages || [];
      arr.forEach((a) => {
        if (!a || !a.package_code) return;
        if (!idx.has(a.package_code)) idx.set(a.package_code, []);
        idx.get(a.package_code).push({
          hostCode: host.package_code,
          hostName: host.package_name,
          hostType: host.package_type,
          group: a.group,
          hostBindCount: arr.length,
        });
      });
    });
    return idx;
  }

  /** 该条被谁绑着；simple = 每个宿主都只绑了它一个 ⇒ 可以安全自动解绑 */
  function bindState(p) {
    const binds = state.binds.get(p.package_code) || [];
    if (!binds.length) return { bound: false, simple: false, binds: [] };
    return { bound: true, simple: binds.every((b) => b.hostBindCount === 1), binds: binds };
  }

  /**
   * 这条套餐能不能被勾选。不可选的四种情况：
   *   已经删过了 / 体检名单还在查 / 名单里有已检人员 / 被主套餐绑着且绑定关系复杂。
   * 「还在查」也算不可选 —— 结果没回来就让人勾，等于给了一个随时会反悔的选择。
   */
  function selectable(p) {
    const code = p.package_code;
    if (state.results.has(code)) return false;
    const ck = state.checks.get(code);
    if (ck === undefined || ck === null) return false;
    if (ck.check_list_size > 0) return false;
    const bs = bindState(p);
    if (bs.bound && !bs.simple) return false;
    return true;
  }

  function paintToolbar() {
    const box = $(IDS.toolbar);
    if (!box) return;
    const cnt = box.querySelector('.hlj-bd-cnt');
    if (cnt) {
      if (!state.packages.length) {
        cnt.textContent = '';
      } else {
        const byCheck = state.packages.filter((p) => {
          const ck = state.checks.get(p.package_code);
          return !!ck && ck.check_list_size > 0;
        }).length;
        const byBind = state.packages.filter((p) => {
          if (state.results.has(p.package_code)) return false;
          const bs = bindState(p);
          return bs.bound && !bs.simple;
        }).length;
        cnt.innerHTML =
          '共 ' + state.packages.length + ' 条' +
          (byCheck ? ' · <b style="color:#cf1322">已体检 ' + byCheck + '</b>' : '') +
          (byBind ? ' · <b style="color:#cf1322">待解绑 ' + byBind + '</b>' : '') +
          ' · 已选 ' + state.checked.size;
      }
    }
    box.querySelectorAll('button').forEach((b) => {
      // 「重新读取」永远可用 —— 列表为空时最想点的就是它
      b.disabled = state.busy || (b.dataset.act !== 'reload' && !state.packages.length);
    });
  }

  function paintFooter() {
    const box = $(IDS.footer);
    if (!box) return;
    const sum = box.querySelector('.hlj-bd-sum');
    const del = box.querySelector('button[data-act="del"]');
    const n = state.checked.size;

    if (sum) {
      const byType = new Map();
      state.packages.forEach((p) => {
        if (state.checked.has(p.package_code)) {
          const t = TYPE_CN[p.package_type] || p.package_type || '其它';
          byType.set(t, (byType.get(t) || 0) + 1);
        }
      });
      const detail = [...byType.entries()].map(([t, c]) => t + ' ' + c).join('、');
      sum.innerHTML = n
        ? '已选 <b style="color:#d4380d">' + n + '</b> 条' + (detail ? '（' + esc(detail) + '）' : '')
        : '<span style="color:#8c8c8c">未勾选任何套餐</span>';
    }

    if (del) {
      del.disabled = state.busy || n === 0;
      if (state.busy) del.textContent = '删除中…';
      else if (state.armed) del.textContent = '确认删除 ' + n + ' 条？';
      else del.textContent = '删除选中' + (n ? '（' + n + '）' : '');
      del.classList.toggle('is-armed', state.armed);
    }
    paintToolbar();
  }

  function paintAll() {
    paintMeta();
    paintList();
    paintFooter();
  }

  // 体检名单是「查到一个更新一个」的渐进渲染，重绘要节流，
  // 否则 20 个套餐回来就是 20 次整表重建
  let paintTimer = null;
  function paintListThrottled() {
    if (paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      paintList();
      paintToolbar();
    }, 150);
  }

  // ============================================================
  // 10. 交互
  // ============================================================
  function onToolbar(act) {
    if (state.busy) return;
    // 只对「可勾选」的动手：已删的、体检名单还在查的、名单里有已检人员的，一律跳过
    const alive = state.packages.filter(selectable);
    if (act === 'all') alive.forEach((p) => state.checked.add(p.package_code));
    if (act === 'none') state.checked.clear();
    if (act === 'invert') {
      alive.forEach((p) => {
        if (state.checked.has(p.package_code)) state.checked.delete(p.package_code);
        else state.checked.add(p.package_code);
      });
    }
    if (act === 'reload') {
      load();
      return;
    }
    state.armed = false;
    paintList();
    paintFooter();
  }

  /** 点类型标签 = 该类型全部勾上/取消。一眼看清"我到底要删哪类" */
  function toggleType(type) {
    if (state.busy) return;
    const arr = state.packages.filter((p) => p.package_type === type && selectable(p));
    if (!arr.length) return;
    const allOn = arr.every((p) => state.checked.has(p.package_code));
    arr.forEach((p) => {
      if (allOn) state.checked.delete(p.package_code);
      else state.checked.add(p.package_code);
    });
    state.armed = false;
    paintList();
    paintFooter();
  }

  function onDeleteClick() {
    if (state.busy || !state.checked.size) return;
    // 二次确认做成"按钮变红再点一次"，不用原生 confirm —— 原生弹窗会打断整页
    if (!state.armed) {
      state.armed = true;
      paintFooter();
      log('再点一次「确认删除 ' + state.checked.size + ' 条？」即执行，点其它地方可取消', 'warn');
      return;
    }
    runDelete();
  }

  // ============================================================
  // 11. 主流程
  // ============================================================

  const CHECK_CONC = 4; // 体检名单查询并发数
  const CHECK_GAP = 70; // 每个 worker 两次请求之间的间隔

  /**
   * 并发查「套餐 ↔ 体检名单」状态，查到一个就更新一行。
   *
   * 为什么要提前查：页面只在**点操作时**才调这个接口，所以不提前查就没法在列表里标出来。
   * 实测单次 p50 约 185ms，20 个套餐用 4 并发约 1 秒出头。
   *
   * 判据（红领巾 2026-09-19 定义）：`check_list_size > 0` = 名单里有已检人员 → 该套餐不可删。
   * 不阻塞列表渲染：列表先出来，行右侧先写「检查中…」，结果回来逐个替换。
   */
  async function probeChecks(list) {
    const todo = list.filter(
      (p) => !state.results.has(p.package_code) && !state.checks.has(p.package_code)
    );
    if (!todo.length) return;

    const queue = todo.slice();
    const orderCode = state.orderCode;

    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        // 期间切了订单就停手，别把上一单的结果写进新列表
        if (state.orderCode !== orderCode) return;
        try {
          const j = await apiPost(API.pkgCheck, { package_code: p.package_code });
          state.checks.set(p.package_code, isOk(j) && j.data ? j.data : null);
        } catch (e) {
          state.checks.set(p.package_code, null);
        }
        paintListThrottled();
        await sleep(CHECK_GAP);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONC, queue.length) }, () => worker())
    );
    if (state.orderCode !== orderCode) return;

    paintList();
    paintToolbar();
    const blocked = state.packages.filter((p) => {
      const ck = state.checks.get(p.package_code);
      return !!ck && ck.check_list_size > 0;
    }).length;
    log(
      '体检名单检查完成：' + (blocked ? blocked + ' 条套餐存在已检人员，已标灰不可选' : '没有已检人员'),
      blocked ? 'warn' : 'hint'
    );
  }

  async function load() {
    if (state.busy) return;
    // 地址栏优先；地址栏认不出来时退回上次认到的那个订单
    const finalCode = currentOrderCode() || state.orderCode;

    // 订单号变了（切了订单）就整份重置
    if (finalCode && finalCode !== state.orderCode) {
      resetState(false);
      state.orderCode = finalCode;
      clearLog();
    }
    if (!state.orderCode) {
      paintAll();
      log('没认出订单号，请打开该订单的「套餐与加项包」页面', 'err');
      return;
    }

    state.busy = true;
    paintFooter();
    log('读取订单 ' + state.orderCode + ' …', 'hint');
    try {
      const info = await fetchOrderInfo(state.orderCode);
      state.orderInfo = info;
      state.orderType = info.order_type || null;
      if (!state.orderType) throw new Error('订单详情里没有 order_type，无法执行删除');

      const list = await fetchPackages(state.orderCode);
      state.packages = list;
      state.binds = buildBinds(list); // 绑定关系就在这份列表里，不用额外请求
      // 清掉已经不存在的勾选（上一轮删掉的）
      const alive = new Set(list.map((p) => p.package_code));
      [...state.checked].forEach((c) => {
        if (!alive.has(c)) state.checked.delete(c);
      });
      state.loaded = true;
      state.busy = false;
      state.armed = false;
      paintAll();
      log('共 ' + list.length + ' 条套餐记录（订单状态：' +
        (ORDER_STATUS_CN[info.status] || info.status || '未知') + '）', 'ok');

      // 列表已经显示出来了，体检名单状态在后台补 —— 不 await，先让用户看到东西
      if (list.length) {
        log('正在检查体检名单（已检人员所在套餐将标记为不可删除）…', 'hint');
        probeChecks(list);
      }
    } catch (e) {
      state.busy = false;
      paintAll();
      log('读取失败：' + e.message, 'err');
    }
  }

  /**
   * 解绑：把某个加项包/赠送包从它的宿主主套餐上摘下来。
   *
   * ⚠️ 接口语义是**清空那个主套餐的全部绑定**（`add_packages: []`），
   * 所以调用前必须确认 `hostBindCount === 1`（宿主只绑了这一个包），
   * 否则会连带解开这个主套餐上的其他包 —— 那种情况在 selectable() 阶段就被挡住了，
   * 这里再判一次是最后一道闸。
   */
  async function unbindOne(bind, pkg, tag) {
    if (bind.hostBindCount !== 1) {
      log(tag + ' 跳过解绑：' + bind.hostName + ' 还绑着其他包，整体清空会误伤', 'err');
      return false;
    }
    try {
      const j = await apiPost(API.pkgRelation, {
        package_code: bind.hostCode,
        add_packages: [],
      });
      if (isOk(j)) {
        log(tag + ' 已解绑：' + pkg.package_name + ' ← ' + bind.hostName, 'hint');
        return true;
      }
      log(tag + ' 解绑失败：' + errText(j), 'err');
      return false;
    } catch (e) {
      log(tag + ' 解绑异常：' + (e.message || e), 'err');
      return false;
    }
  }

  async function runDelete() {
    if (state.busy || !state.checked.size) return;

    // 防御性复核：勾选之后体检名单可能才查回来（也可能刚被别人改动），
    // 这里再筛一次 —— 名单里有已检人员的套餐，绝不进删除列表。
    const codes = [...state.checked];
    const targets = state.packages.filter(
      (p) => codes.indexOf(p.package_code) >= 0 && selectable(p)
    );
    const dropped = codes.filter((c) => !targets.some((t) => t.package_code === c));
    if (dropped.length) {
      dropped.forEach((c) => state.checked.delete(c));
      log('有 ' + dropped.length + ' 条在勾选后变为不可删除（体检名单含已检人员），已自动剔除', 'warn');
      paintList();
      paintFooter();
    }
    if (!targets.length) {
      log('没有可删除的套餐', 'warn');
      return;
    }

    state.busy = true;
    state.armed = false;
    paintFooter();
    log('开始删除 ' + targets.length + ' 条…', 'warn');

    let okCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const tag = '[' + (i + 1) + '/' + targets.length + ']';

      // ① 被主套餐绑着的加项包/赠送包：先解绑，不解绑直接删会被服务端拒
      const bs = bindState(p);
      if (bs.bound && bs.simple) {
        const okUnbind = await unbindOne(bs.binds[0], p, tag);
        if (!okUnbind) {
          failCount++;
          state.results.set(p.package_code, { ok: false, msg: '解绑失败，未执行删除' });
          paintList();
          paintFooter();
          if (i < targets.length - 1) await sleep(DELAY_MS);
          continue;
        }
      }

      // ② 删除
      try {
        const j = await apiPost(API.pkgDelete, {
          code: p.package_code,
          order_type: state.orderType,
        });
        if (isOk(j)) {
          okCount++;
          state.results.set(p.package_code, { ok: true, msg: '已删除' });
          state.checked.delete(p.package_code);
          log(tag + ' 成功  ' + (TYPE_CN[p.package_type] || '') + ' ' + p.package_name, 'ok');
        } else {
          failCount++;
          state.results.set(p.package_code, { ok: false, msg: errText(j) });
          log(tag + ' 失败  ' + p.package_name + ' → ' + errText(j), 'err');
        }
      } catch (e) {
        failCount++;
        state.results.set(p.package_code, { ok: false, msg: String(e.message || e) });
        log(tag + ' 异常  ' + p.package_name + ' → ' + (e.message || e), 'err');
      }
      paintList();
      paintFooter();
      if (i < targets.length - 1) await sleep(DELAY_MS);
    }

    // 页面自己每次删完都会调 evaluate 重算订单收入，这里补上，保证数据一致
    try {
      await apiPost(API.orderEvaluate, { order_code: state.orderCode });
      log('已触发订单收入重算（order/evaluate）', 'hint');
    } catch (e) {
      log('订单收入重算失败（不影响删除结果）：' + (e.message || e), 'warn');
    }

    state.busy = false;
    paintFooter();
    log('完成：成功 ' + okCount + ' / 失败 ' + failCount, failCount ? 'err' : 'ok');
    log('页面表格是页面自己的数据，按 F5 或点「刷新页面」才能看到最新列表', 'hint');
  }

  // ============================================================
  // 12. 保活：SPA 重绘会冲掉注入的节点
  // ============================================================
  function keepAlive() {
    ensureStyle();
    ensureSwitch();
  }

  // hash 路由变化（切订单）→ 面板若开着就重新读
  window.addEventListener('hashchange', () => {
    const code = currentOrderCode();
    const p = $(IDS.panel);
    const open = p && p.style.display !== 'none';
    if (code && code !== state.orderCode) {
      resetState(false);
      state.orderCode = code;
      clearLog();
      if (open) load();
      else paintAll();
    }
  });

  // header 重绘时把开关补回去。
  // ⚠️ 必须节流：SOA 是 React 页面，DOM 变动极频繁，回调若不节流会被高密度触发，
  // 白白烧主线程（「MutationObserver 监听整棵 body + 回调里做查询」是最常见的性能陷阱）。
  // 这里 300ms 合并一次，且只在开关真的丢了时才补。
  let moTimer = null;
  const mo = new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => {
      moTimer = null;
      if (!document.getElementById(IDS.switch)) keepAlive();
    }, 300);
  });

  function boot() {
    keepAlive();
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
    }
    // 启动时先认一下订单号（不发请求），面板打开时才真正读数据
    state.orderCode = currentOrderCode();
    console.log('[扁鹊-1.8] 订单套餐批量删除 v' + VERSION + ' 已就绪，订单：' + (state.orderCode || '未识别'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
