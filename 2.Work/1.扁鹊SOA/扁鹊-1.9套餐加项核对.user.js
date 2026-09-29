// ==UserScript==
// @name         扁鹊-1.9套餐加项核对
// @namespace    https://tampermonkey.net/
// @version      1.2.0
// @description  SOA 订单页：核对「套餐 ↔ 绑定的赠送包 ↔ 包内项目」。只看赠送包(GIVEPKG)、不看加项包；列出套餐名称、原价、成交价与赠送包内的全部项目（多个项目换行显示）。纯只读，不发起任何写请求。
// @match        https://checkup-soa3.health-100.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-jiaxiangbaohedui
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-jiaxiangbaohedui.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-jiaxiangbaohedui.user.js
// ==/UserScript==

/*
 * 扁鹊-1.9 套餐加项包核对（只读）
 *
 * ── 它解决什么（红领巾 2026-09-29 提的需求）──
 *   订单里一个套餐可以绑几个包（加项包 / 赠送包）。想知道「这个套餐到底送了哪些项目」，
 *   得在页面上一个一个点开看，套餐一多就抓瞎。
 *   本脚本一次拉全：列出当前订单里**所有绑定了赠送包的套餐**，以及这些赠送包里的**全部项目**。
 *
 * ── 口径（红领巾 2026-09-29 明确，别自作主张改）──
 *   ① 没绑定任何包的套餐 → 不列（列表里根本看不到）。
 *   ② 绑了包的 → **只看赠送包（GIVEPKG）**，加项包（ADDPKG）/智略加项包（AIADDPKG）**不看**。
 *   ③ 只绑了加项包、没绑赠送包的套餐 → 整行不出现（没有赠送内容可看）。
 *   ④ 每行以**主套餐**为主体：套餐名称 / 原价 / 成交价 都取主套餐自己的；
 *      「赠送项目」取它绑定的赠送包里的项目明细。
 *   ⑤ 纯只读 → **不设订单状态门槛**（不像 1.8 那样只在未落单/检中修改时出现）。
 *      任何订单、任何状态都能点开看。
 *
 * ── 接口（2026-09-29 实测，全部已验证）──
 *
 *   ① POST /soa/api/v1/package/query      {order_code}
 *      → data[] 每项一个套餐/包，字段含
 *        package_code / package_name / package_type / price / sale_price / show_price
 *        / process_status / status / add_packages
 *      ⚠️ **绑定关系挂在主套餐身上**：主套餐的 `add_packages` 是被它绑的包，
 *         每项只有 3 个字段 —— `{group, package_code, package_name}`，
 *         **不带类型**（所以「这个包是加项包还是赠送包」必须另查，见 ② ）。
 *      ⚠️ 被绑的包**同时**会作为独立一条出现在 data[] 里（package_type=GIVEPKG/ADDPKG），
 *         所以拿 package_code 去这份列表里对类型也是可行的 —— 但脚本仍以 ② 的返回为准，
 *         因为 ② 是包自己的属性，不受列表是否包含它影响。
 *
 *   ② POST /soa/api/v1/package/detail     {code}      ← 参数名是 **code**，不是 package_code
 *      → data.package_type（PACKAGE / GIVEPACKAGE / ADDPKG / GIVEPKG / AIADDPKG）
 *        data.product_items[] ——**包内项目明细**，每项含
 *          product_code / product_name / price / sale_price / show_price / sequence / …
 *      ⚠️ 实测传 `{package_code: …}` 会报 `code不能为空(null)`；必须是 `code`。
 *      ⚠️ 只要 code，**不需要 order_code**（传了也无害，返回一致）。
 *      ⚠️ `sequence` 是包内展示顺序，渲染前按它升序排（接口返回的顺序实测也是递增，但不依赖它）。
 *
 * ── 🔴 价格字段的反直觉映射（2026-09-29 实测，别按字段名猜）──
 *   页面套餐表头：
 *     「原价(元)」   → th class = `list-col-sale-price`  ⇒ 对应字段 **sale_price**
 *     「成交价(元)」 → th class = `list-col-price`       ⇒ 对应字段 **price**
 *   即：**sale_price 是原价、price 是成交价**（字面看很容易反过来）。
 *   验证：订单 SOA37906684855710579 主套餐 price=1200 / sale_price=1819.5，
 *         页面「原价」列显示 1819.5、「成交价」列显示 1200 ⇒ 成交价低于原价，符合常识。
 *   另有 show_price（展示价，实测高于原价），本脚本**不用**。
 *
 * ── 按钮放在哪（红领巾 2026-09-29 指定）──
 *   页面「套餐与加项包」那一行自带 4 个按钮（第三方套餐码 / 折扣对比 / 特殊要求 / 套餐门店选择），
 *   容器是 `.btn-wrap`。本脚本的按钮插在这一行**最左边**（截图里红框的位置）。
 *   ⚠️ 定位方式是「找到文本为『第三方套餐码』的 button，取其父 .btn-wrap」——
 *     不按 `.btn-wrap` 的序号取，页面上这种 wrap 不止一个，按序号会挂错行。
 *
 * ── 按钮长什么样（2026-09-29 第二轮：几何向页面看齐，配色向 1.6 看齐）──
 *   几何：24px 高 · 2px 圆角 · 14px 字 · padding 0 7px —— **照页面 antd `.ant-btn-sm` 的实际计算值抄**，
 *   与同行 4 个按钮水平完全齐平（红领巾要的「平整度」）。
 *   配色：**取「扁鹊-1.6制卡管理查询」顶部那个琥珀开关**（红领巾 2026-09-29 贴截图指定）：
 *   边框 #e2aa3f · 底 linear-gradient(#fff8df→#ffefbd) · 字 #6a4300 · 双阴影；色值从 1.6 原样搬来。
 *   ⚠️ 只搬了**配色**，几何没跟 1.6（它是 31px 高 / 7px 圆角 / 700 字重，照搬就跟同行按钮不齐了）。
 *   ⚠️ 两个坑（改样式前必读，CSS 里也有同样的注释）：
 *     ① 高度不能写 28px —— 比同行高 4px、顶部对齐 ⇒ 底部悬出 4px，`.btn-wrap` 盒子也被撑高、
 *        左边标题跟着不居中。这就是「不平整」的根因。
 *     ② 自己不能加 margin —— 页面按钮每个都自带 `margin-left:16px` 提供间距，
 *        脚本再加 `margin-right:8px` ⇒ 间距变 24px，比别处多一截。
 *
 * ── 为什么只读也要走接口，不模拟点击 ──
 *   包内项目在页面上要点开弹窗才看得到，且一次只能看一个；接口单次约 300ms，
 *   套餐再多也能并发拉完。前端改版也不会把脚本改挂。
 *   ⛔ 本脚本**只发 query / detail 两个读接口**，不调用任何写接口（delete / update / relation 都不碰）。
 */

(function () {
  'use strict';

  if (location.hostname !== 'checkup-soa3.health-100.cn') return;

  // ============================================================
  // 0. 命名空间与常量
  // ============================================================
  const NS = '__hlj_pkg_give_check_v100';
  const IDS = {
    switch: `${NS}_switch`,
    style: `${NS}_style`,
    panel: `${NS}_panel`,
    head: `${NS}_head`,
    title: `${NS}_title`,
    close: `${NS}_close`,
    meta: `${NS}_meta`,
    body: `${NS}_body`,
    footer: `${NS}_footer`,
  };
  const VERSION = '1.2.0';
  const SWITCH_LABEL = '加项包核对';
  const POS_KEY = `${NS}_pos`;

  const CLIENT_ID = 'MN_SOA3';

  const API = {
    pkgQuery: '/soa/api/v1/package/query',
    pkgDetail: '/soa/api/v1/package/detail',
  };

  // 只看赠送包。加项包(ADDPKG) / 智略加项包(AIADDPKG) 不看 —— 红领巾 2026-09-29 定的口径
  const GIVE_TYPE = 'GIVEPKG';

  const TYPE_CN = {
    PACKAGE: '普通套餐',
    GIVEPACKAGE: '赠送套餐',
    ADDPKG: '加项包',
    GIVEPKG: '赠送包',
    AIADDPKG: '智略加项包',
  };

  const CUST_CN = { MALE: '男', FEMALE: '女未婚', WOMAN: '女已婚', ALL: '通用' };

  // 已作废判据（与 1.8 一致：前端枚举 INVALID=作废 / INVALID_ING=作废中 / INVALID_ERROR=作废失败）
  const VOID_PROCESS_STATUS = ['INVALID', 'INVALID_ING', 'INVALID_ERROR'];

  // 按钮锚点：页面自带按钮里挑一个当路标，用它反推那一行
  const ANCHOR_BTN_TEXT = '第三方套餐码';
  const ANCHOR_WRAP_CLASS = 'btn-wrap';

  const DETAIL_CONC = 4; // detail 并发数
  const DETAIL_GAP = 60; // 每个 worker 两次请求之间的间隔

  // ============================================================
  // 1. 小工具
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) =>
    String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /** 是不是已作废的套餐 */
  function isVoid(p) {
    const ps = String((p && p.process_status) || '').toUpperCase();
    if (VOID_PROCESS_STATUS.indexOf(ps) >= 0) return true;
    if (!ps && String((p && p.status) || '').toUpperCase() === 'DISABLE') return true;
    return false;
  }

  function voidCn(p) {
    const ps = String((p && p.process_status) || '').toUpperCase();
    return { INVALID: '已作废', INVALID_ING: '作废中', INVALID_ERROR: '作废失败' }[ps] || '已作废';
  }

  /**
   * 金额格式化：千分位 + 小数最多两位；整数不留 .00（与页面显示风格一致，页面就是 "100" / "1,223"）。
   * 拿不到值（null / 非数字）返回 '—'，不假装是 0。
   */
  function fmtMoney(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!isFinite(n)) return '—';
    const s = String(Math.round(n * 100) / 100);
    const parts = s.split('.');
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
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
      // 登录态失效时网关会返 HTML，要能区分"接口报错"和"根本没通"
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
   * 当前订单号。来源：地址栏 hash > 页面正文。
   * 实测（2026-09-19 / 09-29）localStorage 里**没有**订单号，别去那里找。
   * hash 形如 `#/order/package?oper=check&orderCode=SOA37243732267810635-38`
   * （⚠️ 带 `-38` 这种门店/分支后缀是正常的，正则要允许 `-`）。
   */
  function currentOrderCode() {
    const hash = decodeURIComponent(location.hash || '');
    let m = hash.match(/[?&]order_?code=([A-Za-z0-9_-]+)/i);
    if (m) return m[1];

    // 兜底：页面上写着「订单编号：SOA…」
    const txt = document.body ? document.body.innerText || '' : '';
    m = txt.match(/\b(SOA\d{12,}(?:-\d+)?)\b/);
    if (m) return m[1];

    return null;
  }

  // ============================================================
  // 4. 状态
  // ============================================================
  const state = {
    orderCode: null,
    loading: false,
    rows: [], // 渲染用：{code,name,type,custType,salePrice,price,voided,gives:[{name,items:[]}]}
    bindTotal: 0, // 本订单绑定的包总数（去重后）
    giveTotal: 0, // 其中赠送包数
    itemTotal: 0, // 赠送包内项目总数
    detailCache: new Map(), // package_code -> detail.data（null = 查询失败）
    err: '',
  };

  function resetAll() {
    state.rows = [];
    state.bindTotal = 0;
    state.giveTotal = 0;
    state.itemTotal = 0;
    state.detailCache = new Map();
    state.err = '';
  }

  // ============================================================
  // 5. 样式
  // ============================================================
  function ensureStyle() {
    if ($(IDS.style)) return;
    const style = document.createElement('style');
    style.id = IDS.style;
    style.textContent = `
      /* ---------- 操作行里的开关 ----------
       * 🎯 几何**照抄页面自带按钮**，与它同一行时完全齐平（2026-09-29 真机量的基准，
       *    页面按钮 class = "ant-btn ant-btn-sm"）：
       *      height 24px · padding 0 7px · border-radius 2px
       *      font-size 14px · font-weight 400 · 字体族继承页面
       *
       * 🎨 配色取「扁鹊-1.6制卡管理查询」顶部那个琥珀开关（红领巾 2026-09-29 指定参考，
       *    贴了截图）。色值**从 1.6 原样搬来**，两处保持一致，改一处记得同步另一处：
       *      边框 #e2aa3f · 底 linear-gradient(180deg,#fff8df,#ffefbd) · 字 #6a4300
       *      shadow 0 1px 2px rgba(81,54,12,.10) + inset 0 1px 0 rgba(255,255,255,.75)
       *      hover 底 #fff4cf→#ffe6a1 · 边框 #d59625 · shadow 0 2px 6px rgba(108,72,11,.16)
       *    ⚠️ 只搬了**配色**，几何仍与页面按钮一致（1.6 那个是 31px 高 / 7px 圆角 / 700 字重，
       *       照搬过来就跟同行按钮不齐了 —— 红领巾这一轮的头号诉求是「平整度」）。
       *    ⚠️ 底色是 gradient ⇒ "background-color" 计算值是 transparent，断言要读 "backgroundImage"。
       *
       * ⚠️ 两条踩过的坑（改这个按钮前先看）：
       *   ① **高度必须 24px**。原先写成 28px ⇒ 比同行按钮高 4px，flex 里表现为**顶部对齐、
       *      底部悬出 4px**；连 ".btn-wrap" 的盒子都被撑高 4px，左边那行标题跟着不居中。
       *      这就是「不平整」的根因 —— 不是 margin 的问题，是高度。
       *   ② **自己不要加任何 margin**。页面按钮每个都自带 "margin-left:16px" 提供间距，
       *      脚本再加 "margin-right:8px" ⇒ 实际间距 24px，比别处（16px）多一截。
       *      本行间距全部交给页面按钮自带的那个 margin-left。 */
      #${IDS.switch} {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        padding: 0 7px;
        margin: 0;
        border: 1px solid #e2aa3f;
        border-radius: 2px;
        background: linear-gradient(180deg, #fff8df 0%, #ffefbd 100%);
        color: #6a4300;
        font-size: 14px;
        font-weight: 400;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        box-sizing: border-box;
        box-shadow: 0 1px 2px rgba(81, 54, 12, .10), inset 0 1px 0 rgba(255, 255, 255, .75);
        transition: background .12s ease, border-color .12s ease, box-shadow .12s ease;
      }
      #${IDS.switch}:hover {
        background: linear-gradient(180deg, #fff4cf 0%, #ffe6a1 100%);
        border-color: #d59625;
        box-shadow: 0 2px 6px rgba(108, 72, 11, .16), inset 0 1px 0 rgba(255, 255, 255, .82);
      }
      /* 面板打开时：换成「实心琥珀」，与浅底一眼可分（1.6 那个按钮没有开合态，这段是本脚本自己的） */
      #${IDS.switch}.is-active {
        background: linear-gradient(180deg, #ffd76a 0%, #f5c542 100%);
        border-color: #d59625;
        color: #5a3a00;
        box-shadow: 0 1px 2px rgba(81, 54, 12, .14), inset 0 1px 0 rgba(255, 255, 255, .45);
      }
      #${IDS.switch}.is-active:hover {
        background: linear-gradient(180deg, #ffdf85 0%, #fbd05c 100%);
        border-color: #c98c1c;
      }

      /* ---------- 面板 ---------- */
      #${IDS.panel} {
        position: fixed;
        top: 96px;
        right: 18px;
        width: 780px;
        max-width: calc(100vw - 36px);
        max-height: calc(100vh - 130px);
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
      #${IDS.head} .hlj-gc-spacer { flex: 1; }
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
      #${IDS.meta} .hlj-gc-st {
        display: inline-block; padding: 0 6px; border-radius: 4px;
        background: #e6f4ff; color: #0958d9; margin-left: 4px;
      }
      #${IDS.meta} .hlj-gc-stat b { color: #0958d9; }

      /* ---------- 表格 ---------- */
      #${IDS.body} {
        flex: 1;
        overflow: auto;
        min-height: 140px;
      }
      .hlj-gc-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
      }
      .hlj-gc-table thead th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 7px 10px;
        text-align: left;
        font-weight: 600;
        color: #262626;
        background: #fafafa;
        border-bottom: 1px solid #e8e8e8;
        white-space: nowrap;
      }
      .hlj-gc-table tbody td {
        padding: 7px 10px;
        border-bottom: 1px solid #f5f5f5;
        vertical-align: top;
        line-height: 1.55;
        word-break: break-all;
      }
      .hlj-gc-table tbody tr:hover { background: #fafafa; }
      .hlj-gc-table tbody tr.is-voided { background: #f7f7f7; }
      .hlj-gc-table tbody tr.is-voided td { color: #8c8c8c; }

      .hlj-gc-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .hlj-gc-name { font-weight: 500; }
      .hlj-gc-sub {
        margin-top: 2px; color: #8c8c8c; font-size: 11.5px;
      }
      .hlj-gc-tag {
        display: inline-block; padding: 0 5px; border-radius: 3px; font-size: 11px;
        line-height: 16px; margin-right: 5px; vertical-align: 1px;
        background: #f0f0f0; color: #595959;
      }
      .hlj-gc-tag.t-PACKAGE { background: #e6f4ff; color: #0958d9; }
      .hlj-gc-tag.t-GIVEPACKAGE { background: #f9f0ff; color: #722ed1; }
      .hlj-gc-tag.t-ADDPKG { background: #fff7e6; color: #d46b08; }
      .hlj-gc-tag.t-GIVEPKG { background: #f6ffed; color: #389e0d; }
      .hlj-gc-tag.t-AIADDPKG { background: #e6fffb; color: #08979c; }
      .hlj-gc-tag.t-void { background: #f5f5f5; color: #8c8c8c; }

      /* 赠送项目：按赠送包分组，包名做小标题，项目用有序列表（每个项目独占一行） */
      .hlj-gc-give + .hlj-gc-give { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #f0f0f0; }
      .hlj-gc-give-name {
        display: block;
        color: #389e0d;
        font-size: 11.5px;
        margin-bottom: 2px;
      }
      .hlj-gc-items {
        margin: 0;
        padding-left: 18px;
        color: #262626;
      }
      .hlj-gc-items li { margin: 1px 0; }
      .hlj-gc-items .hlj-gc-item-p {
        color: #bfbfbf;
        font-size: 11px;
        margin-left: 6px;
        white-space: nowrap;
      }
      .hlj-gc-empty { padding: 28px 12px; text-align: center; color: #8c8c8c; line-height: 1.9; }

      /* ---------- 底部 ---------- */
      #${IDS.footer} {
        border-top: 1px solid #f0f0f0; padding: 8px 12px;
        display: flex; align-items: center; gap: 8px; background: #fafafa;
      }
      #${IDS.footer} .hlj-gc-tip { color: #8c8c8c; font-size: 12px; margin-right: auto; }
      #${IDS.footer} button {
        height: 28px; padding: 0 12px; border-radius: 5px; font-size: 12.5px;
        cursor: pointer; border: 1px solid #d9d9d9; background: #fff; color: #404040;
      }
      #${IDS.footer} button:hover:not(:disabled) { border-color: #4096ff; color: #1677ff; }
      #${IDS.footer} button:disabled { opacity: .45; cursor: not-allowed; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ============================================================
  // 6. 操作行里的开关
  // ============================================================

  /**
   * 找到页面「套餐与加项包」那一行的按钮容器 `.btn-wrap`。
   *
   * ⚠️ 必须靠**按钮文本**反推，不能按 `.btn-wrap` 的序号取 ——
   *    页面上这种容器不止一个，按序号会挂到别的行去。
   * 找不到 = 当前不在「套餐与加项包」页（或前端改了这行）⇒ 不挂按钮，不猜位置。
   */
  function findAnchorWrap() {
    const btns = document.querySelectorAll('button');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      if ((b.textContent || '').trim() !== ANCHOR_BTN_TEXT) continue;
      const p = b.parentElement;
      if (p && p.classList && p.classList.contains(ANCHOR_WRAP_CLASS)) return p;
    }
    return null;
  }

  function ensureSwitch() {
    const existing = $(IDS.switch);
    const wrap = findAnchorWrap();
    if (!wrap) {
      // 那一行不在（非套餐页）→ 入口收掉，别留一个点不开的按钮
      if (existing && existing.isConnected) existing.remove();
      return;
    }
    if (existing && existing.isConnected && existing.parentElement === wrap) {
      if (wrap.firstElementChild !== existing) wrap.insertBefore(existing, wrap.firstElementChild);
      return;
    }
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = IDS.switch;
    btn.type = 'button';
    btn.textContent = SWITCH_LABEL;
    btn.title = '列出当前订单里「绑定了赠送包的套餐」，以及这些赠送包内的全部项目（只读，不改任何数据）';

    // 别让点击冒泡到页面自己的逻辑里
    ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((evt) => {
      btn.addEventListener(evt, (e) => e.stopPropagation());
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    wrap.insertBefore(btn, wrap.firstElementChild);
  }

  // ============================================================
  // 7. 面板
  // ============================================================
  function ensurePanel() {
    let p = $(IDS.panel);
    if (p) return p;

    p = document.createElement('div');
    p.id = IDS.panel;
    p.innerHTML = `
      <div id="${IDS.head}">
        <span id="${IDS.title}">套餐加项包核对</span>
        <span class="hlj-gc-spacer"></span>
        <button id="${IDS.close}" type="button" title="关闭">×</button>
      </div>
      <div id="${IDS.meta}">正在读取…</div>
      <div id="${IDS.body}"></div>
      <div id="${IDS.footer}">
        <span class="hlj-gc-tip">只读工具 · 只看赠送包(GIVEPKG)，加项包不展示</span>
        <button type="button" data-act="reload">重新读取</button>
      </div>
    `;
    document.body.appendChild(p);

    $(IDS.close).addEventListener('click', closePanel);
    p.querySelector(`#${IDS.footer}`).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.act === 'reload') load();
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
  // 8. 渲染
  // ============================================================
  function paintMeta() {
    const el = $(IDS.meta);
    if (!el) return;
    if (!state.orderCode) {
      el.innerHTML = '没认出订单号。请先打开某个订单的「<b>套餐与加项包</b>」页面。';
      return;
    }
    const stat = state.rows.length
      ? '共 <b>' + state.rows.length + '</b> 个套餐绑定了赠送包' +
        '（涉及 <b>' + state.giveTotal + '</b> 个赠送包、<b>' + state.itemTotal + '</b> 个项目）'
      : (state.loading ? '正在读取…' : '本订单没有「绑定了赠送包的套餐」');
    el.innerHTML =
      '订单 <b>' + esc(state.orderCode) + '</b>' +
      '<span class="hlj-gc-st">只读</span>' +
      '<br><span class="hlj-gc-stat">' + stat + '</span>' +
      (state.bindTotal ? '<br><span style="color:#8c8c8c">本订单共绑定 ' + state.bindTotal + ' 个包，其中 ' +
        state.giveTotal + ' 个是赠送包（加项包不展示）</span>' : '') +
      (state.err ? '<br><span style="color:#cf1322">' + esc(state.err) + '</span>' : '');
  }

  function rowHtml(r) {
    const tags =
      '<span class="hlj-gc-tag t-' + esc(r.type) + '">' + esc(TYPE_CN[r.type] || r.type || '套餐') + '</span>' +
      (r.voided ? '<span class="hlj-gc-tag t-void">' + esc(voidCn(r)) + '</span>' : '');

    const sub = [];
    if (r.custType) sub.push(CUST_CN[r.custType] || r.custType);
    if (r.code) sub.push(r.code);

    const givesHtml = r.gives
      .map((g) => {
        const items = g.items.length
          ? '<ol class="hlj-gc-items">' +
            g.items
              .map(
                (it) =>
                  '<li>' + esc(it.name) +
                  (it.salePrice !== null && it.salePrice !== undefined
                    ? '<span class="hlj-gc-item-p">原价 ' + esc(fmtMoney(it.salePrice)) + '</span>'
                    : '') +
                  '</li>'
              )
              .join('') +
            '</ol>'
          : '<div style="color:#8c8c8c">（该赠送包里没有项目）</div>';
        return (
          '<div class="hlj-gc-give">' +
          '<span class="hlj-gc-give-name">【赠送包】' + esc(g.name || g.code) + '</span>' +
          items +
          '</div>'
        );
      })
      .join('');

    return `
      <tr class="${r.voided ? 'is-voided' : ''}">
        <td class="hlj-gc-name">${tags}${esc(r.name)}<div class="hlj-gc-sub">${esc(sub.join(' · '))}</div></td>
        <td class="hlj-gc-num">${esc(fmtMoney(r.salePrice))}</td>
        <td class="hlj-gc-num">${esc(fmtMoney(r.price))}</td>
        <td>${givesHtml}</td>
      </tr>
    `;
  }

  function paintBody() {
    const box = $(IDS.body);
    if (!box) return;
    if (!state.rows.length) {
      box.innerHTML = state.loading
        ? '<div class="hlj-gc-empty">正在读取…</div>'
        : '<div class="hlj-gc-empty">' +
          (state.err ? '读取失败，请点底部「重新读取」再试' : '本订单没有「绑定了赠送包的套餐」') +
          '<br><span style="font-size:12px;color:#bfbfbf">只列表绑了赠送包(GIVEPKG)的套餐；未绑包的、只绑加项包的都不列。</span>' +
          '</div>';
      return;
    }
    box.innerHTML =
      '<table class="hlj-gc-table">' +
      '<thead><tr>' +
      '<th style="width:27%">套餐名称</th>' +
      '<th style="width:11%;text-align:right">原价(元)</th>' +
      '<th style="width:11%;text-align:right">成交价(元)</th>' +
      '<th>赠送项目</th>' +
      '</tr></thead>' +
      '<tbody>' + state.rows.map(rowHtml).join('') + '</tbody>' +
      '</table>';
  }

  function paint() {
    paintMeta();
    paintBody();
    const btn = $(IDS.footer) && $(IDS.footer).querySelector('button[data-act="reload"]');
    if (btn) btn.disabled = state.loading;
  }

  // ============================================================
  // 9. 数据
  // ============================================================
  async function fetchPackages(orderCode) {
    const j = await apiPost(API.pkgQuery, { order_code: orderCode });
    if (!isOk(j)) throw new Error('读取套餐列表失败：' + errText(j));
    return Array.isArray(j.data) ? j.data : [];
  }

  async function fetchDetail(code) {
    const j = await apiPost(API.pkgDetail, { code: code });
    if (!isOk(j) || !j.data) throw new Error(errText(j));
    return j.data;
  }

  /**
   * 拉一遍并组装。
   *
   * 流程：package/query（1 次） → 收集所有被绑的包 → package/detail（每个包 1 次，并发 4）
   *       → 只留 package_type=GIVEPKG 的 → 按宿主套餐归组。
   *
   * ⚠️ 判断「这包是赠送包还是加项包」**以 detail 的 package_type 为准**，
   *    不用列表里的那份 —— 列表不一定包含被绑的包（实测有的订单里不在），
   *    而 detail 是包自己的属性，稳。
   */
  async function load() {
    if (state.loading) return;

    const code = currentOrderCode() || state.orderCode;
    if (code && code !== state.orderCode) {
      resetAll();
      state.orderCode = code;
    }
    if (!state.orderCode) {
      state.rows = [];
      state.err = '';
      paint();
      return;
    }

    state.loading = true;
    state.err = '';
    paint();

    const orderCode = state.orderCode;
    try {
      const list = await fetchPackages(orderCode);
      if (state.orderCode !== orderCode) return; // 期间切了订单就停手

      // 收集被绑的包（去重）——绑定关系挂在主套餐的 add_packages 上
      const need = new Map(); // package_code -> package_name
      list.forEach((host) => {
        (host.add_packages || []).forEach((a) => {
          if (a && a.package_code && !need.has(a.package_code)) {
            need.set(a.package_code, a.package_name || '');
          }
        });
      });
      state.bindTotal = need.size;

      // 逐个查包详情（detail 结果按包缓存，多个套餐绑同一个包时只请求一次）
      const queue = [...need.keys()].filter((c) => !state.detailCache.has(c));
      const worker = async () => {
        while (queue.length) {
          const c = queue.shift();
          if (state.orderCode !== orderCode) return;
          try {
            state.detailCache.set(c, await fetchDetail(c));
          } catch (e) {
            state.detailCache.set(c, null);
          }
          await sleep(DETAIL_GAP);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(DETAIL_CONC, queue.length) }, () => worker())
      );
      if (state.orderCode !== orderCode) return;

      // 组装：一行 = 一个主套餐（只留绑了赠送包的）
      const rows = [];
      let giveTotal = 0;
      let itemTotal = 0;
      list.forEach((host) => {
        const ap = host.add_packages || [];
        if (!ap.length) return; // 没绑包的套餐不考虑

        const gives = [];
        ap.forEach((a) => {
          const d = state.detailCache.get(a && a.package_code);
          if (!d) return;
          if (String(d.package_type || '').toUpperCase() !== GIVE_TYPE) return; // 加项包不看
          const items = (d.product_items || [])
            .slice()
            .sort((x, y) => (Number(x.sequence) || 0) - (Number(y.sequence) || 0))
            .map((it) => ({
              name: it.product_name || it.product_code || '（未命名项目）',
              price: it.price,
              salePrice: it.sale_price,
            }));
          gives.push({
            code: a.package_code,
            name: d.package_name || a.package_name || '',
            items: items,
          });
        });
        if (!gives.length) return; // 只绑加项包 → 整行不出现

        giveTotal += gives.length;
        gives.forEach((g) => {
          itemTotal += g.items.length;
        });

        rows.push({
          code: host.package_code,
          name: host.package_name || '',
          type: host.package_type || '',
          custType: host.cust_type || '',
          salePrice: host.sale_price, // 原价
          price: host.price, // 成交价
          voided: isVoid(host),
          gives: gives,
        });
      });

      state.rows = rows;
      state.giveTotal = giveTotal;
      state.itemTotal = itemTotal;
    } catch (e) {
      state.err = '读取失败：' + (e && e.message ? e.message : e);
      state.rows = [];
    } finally {
      state.loading = false;
    }

    paint();
    console.log(
      '[扁鹊-1.9] ' + orderCode + '：绑定包 ' + state.bindTotal + ' 个 → 赠送包 ' +
        state.giveTotal + ' 个、项目 ' + state.itemTotal + ' 个，列出套餐 ' + state.rows.length + ' 个'
    );
  }

  // ============================================================
  // 10. 保活：SPA 重绘会冲掉注入的节点
  // ============================================================
  function keepAlive() {
    ensureStyle();
    ensureSwitch();
  }

  // hash 路由变化（切订单）→ 面板若开着就重新读
  window.addEventListener('hashchange', () => {
    const code = currentOrderCode();
    if (code && code !== state.orderCode) {
      resetAll();
      state.orderCode = code;
      const p = $(IDS.panel);
      if (p && p.style.display !== 'none') load();
      else paint();
    }
  });

  // ⚠️ 必须节流：SOA 是 React 页面，DOM 变动极频繁，不节流会被高密度触发白烧主线程
  let moTimer = null;
  const mo = new MutationObserver(() => {
    if (moTimer) return;
    moTimer = setTimeout(() => {
      moTimer = null;
      if (!document.getElementById(IDS.switch) || !findAnchorWrap()) keepAlive();
    }, 300);
  });

  function boot() {
    keepAlive();
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    state.orderCode = currentOrderCode();
    console.log('[扁鹊-1.9] 套餐加项包核对 v' + VERSION + ' 已就绪，订单：' + (state.orderCode || '未识别'));
  }

  // 逃生口：console 里手动重读 / 看状态
  window[NS] = {
    version: VERSION,
    state: state,
    reload: load,
    force: function () {
      ensureSwitch();
      console.log('[扁鹊-1.9] 已强制挂载按钮');
      return true;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
