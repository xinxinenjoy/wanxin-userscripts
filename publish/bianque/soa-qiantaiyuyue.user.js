// ==UserScript==
// @name         扁鹊-1.10前台预约查询
// @namespace    https://tampermonkey.net/
// @version      1.6.0
// @description  在 SOA 顶部工具组加一个「前台预约查询」入口：一个输入框，自动识别填的是预约单号还是身份证号；未到检一次查全部分院，已到检/已取消再按玫瑰园 → 宝龙 → 长垣 逐院查，结果按表格汇总；每行「详情」可看订单名称、本地单/全国单、健康顾问、金额与套餐项目。
// @match        https://checkup-soa3.health-100.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      checkup-register.health-100.cn
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-qiantaiyuyue
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-qiantaiyuyue.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-qiantaiyuyue.user.js
// ==/UserScript==

/*
 * 前台预约查询
 *
 * 入口位置（红领巾 2026-11-06 指定）：SOA 顶部工具组里，紧跟「订单特殊审批(1.7)」右边。
 *
 * 为什么走 GM_xmlhttpRequest 而不是直接 fetch：
 *   本脚本挂在 SOA（checkup-soa3），前台在 checkup-register，两个不同源。
 *   实测 SOA 页里 fetch 前台接口直接被 CORS 拦掉（Failed to fetch），
 *   只能借油猴的跨域通道（@connect checkup-register.health-100.cn）。
 *
 * 前台接口的签名（2026-11-06 从前台前端包 register/202611051429/umi.c13371c0.js 读出并实测）：
 *   getSignHeader(clientId, secret) =>
 *     mnsign = sha256hex( clientId + 毫秒时间戳 + secret )
 *   **与请求体无关**，所以三个分院、三个页签都能用同一套算法现场算。
 *   实测：拿抓到的 mntimestamp + mnsign 反算，公式命中。
 *
 * 三个页签对应的查询口径（v1.4.0 修正，2026-11-07 前台抓包核对）：
 *   未到检   serviceName = orderMerge，appointmentStatus = [TO_APPOINTMENT, APPOINTMENT_FINISH]
 *   **一次查全部分院**（req.onlySelfBranch = false），不用按分院循环
 *   已到检   serviceName = order，appointmentStatus = CHECKED      ← 分院维度
 *   已取消   serviceName = order，appointmentStatus = CANCEL       ← 分院维度
 *
 * 🔴 v1.3.x 的错（红领巾 2026-11-07 用 410726199006133031 指出「未到检查不到」）：
 *   旧版把四个状态塞进一个 order 请求、按分院循环，以为一份数据能盖住三个页签。
 *   实测那天：这个证件在 order 服务里三个分院 × 四状态**全返回 0 条**，
 *   而前台「未到检」页签明明有 3 条（刘志虎，未预约）——
 *   因为未到检是**订单/服务单维度**的数据，还没落到任何分院，压根不在 order 这个分院视图里，
 *   前台那一页走的是 orderMerge。换过去之后一次请求就回 3 条，
 *   且 branch-code 头换成 X1 / X7 / FC 返回完全一样 ⇒ 证实「未到检不分院」。
 *
 * 单输入框自动识别（红领巾 2026-11-06 改）：
 *   14 位纯数字 ⇒ 预约单号，请求体走 req.vid
 *   15~18 位、末位可为 X ⇒ 身份证号，请求体走 req.certificateNumber
 *   实测（2026-11-06）：req.certificateNumber 是前台列表接口认的字段，
 *     传 411329198104102523 在 X1 命中 1 条；传不认识的键（certNo）会被忽略 ⇒ 返回全量，
 *     所以字段名必须写死证书号这一个，不能拼错。orderMerge 同样认这两个键。
 *
 * 结果展示（红领巾 2026-11-06 第二次改）：
 *   早期是一院一块卡片，记录一多就成一条长卷轴，看着散。
 *   现在统一成**一张表**：分院 / 姓名 / 证件号 / 体检日期 / 金额 / 状态 / 预约单号，
 *   第一段是「未到检（全部分院）」，后面三段是分院，一处一个「未查到 / 查询中 / 失败」行；
 *   单段超过 RECORD_PREVIEW_COUNT 条时，表内给一行「展开全部 N 条」。
 *
 * 「去前台查看」按钮已按红领巾要求移除（2026-11-06）：
 *   跳转只能靠前台 SPA 自己「点列表行 → push('/register')」，外部无法直达某个人的登记页，
 *   体验反而要等一串自动操作，索性去掉。现在只做查询展示。
 *
 * v1.3.1（2026-11-06）：修工具组内按钮间距不对称。
 *   真机量到的实情：组 gap=9px，可 1.7 槽位带 margin-right:150px、1.6 槽位带左右各 18px，
 *   1.5 里那条清零规则的选择器前缀（__hlj_card_summary_detect_）跟 1.6 实际的 id
 *   （__hlj_card_summary_v020_）对不上，于是间距成了 9 / 9 / 27。
 *   本脚本只在「槽位被收进共享工具组」这一前提下把槽位外边距归零，
 *   不动 1.5/1.6/1.7 任何一个文件，它们单独运行时的观感也不变。
 *
 * v1.4.0（2026-11-07）：未到检改走 orderMerge 一次查全院（详见上面「三个页签对应的查询口径」）；
 *   order 服务只留 CHECKED / CANCEL 两个状态，未到检不再混在里面；
 *   未预约的行没有预约单号，格子第二行补 SOA 订单号，否则几行看着一模一样。
 *
 * v1.5.0（2026-11-07，红领巾两句话）：
 *   ① 「未到检单独显示 + 已到检按分院显示不同底色」⇒ 结果拆成两块：
 *      上面一块只放未到检（不分院：姓名/证件号/体检日期/金额/状态/单号/详情），
 *      下面一块按分院放已到检/已取消，玫瑰园绿 / 宝龙蓝 / 长垣黄，行首还有一道竖色条。
 *      「已预约未到检」两边都能查，统一搬到上面那块（order 那份带分院、单号和金额），
 *      搬空了的分院不写「未查到」，改写「只有未到检记录 N 条（已归到上表）」。
 *   ② 「只显示这些信息就够，加个详情按钮看全部」⇒ 主表就那几列，行尾加「详情」，
 *      浮层里摊开 列表记录全字段 + 套餐/收费全字段 + 每个套餐的字段 + 原始 JSON（空字段折叠）。
 *
 * v1.6.0（2026-11-07，红领巾「详情里边能获取到订单名称么」）：
 *   「点进去这一条」看到的那一屏，数据来自另外三个接口（列表接口给不了），全部接进浮层：
 *     ① query/soaOrderDetail/v2      订单名称 soaName、本地单/全国单 soaOrderType（+isNation 兜底）、
 *                                    健康顾问 userName/userId/userMobile、整单总额 totalPrice、
 *                                    单位 / 地区 / 联系人 / 有效期 / 订单备注
 *     ② v2/beforeQueryOrderDetailInfo 只有**未到检**的记录需要：列表项里没有 packageCode，
 *                                    得用 soaOrderNo + nameListUid 换出来
 *     ③ querySelectedPackages        套餐名 + 标准价/结算价 + 支付方式/状态 + 项目明细 details[]
 *                                    （每项 itemName / goodsName / salePrice / settlePrice）
 *   三个接口都只要 soaOrderNo(即 billCode) + branchCode，未到检那种没有 vid 的记录照样能查；
 *   未到检记录拿不到分院码，用 X1 代查（实测三个分院码返回完全一致）。
 *   **点「详情」才发请求**：几十条记录一起预拉会把接口打满，所以做成懒加载，
 *   同一条记录只拉一次（成功失败都缓存），失败原因写在段落标题后面。
 *   顺带：金额加千分位（整单十几万，不分节读不出来）；项目明细表限高 300px 自己滚、表头吸顶。
 */

(function () {
  'use strict';

  // ============================================================
  // 0. 命名空间与常量
  // ============================================================
  const NS = '__hlj_qt_lookup_v100';
  const IDS = {
    switch: `${NS}_switch`,
    switchSlot: `${NS}_switch_slot`,
    panel: `${NS}_panel`,
    body: `${NS}_body`,
    input: `${NS}_input`,
    query: `${NS}_query`,
    close: `${NS}_close`,
    status: `${NS}_status`,
    result: `${NS}_result`,
    modal: `${NS}_modal`,
  };

  // 与 1.5 / 1.6 / 1.7 共用的 SOA 顶部工具组
  const TOP_TOOL_GROUP_ID = '__hlj_soa_top_tool_group_v1';
  // 排在「订单特殊审批(1.7)」右边：slot 就用它当锚点
  const APPROVAL_SLOT_IDS = ['__hlj_ia_combo_v200_switch_slot'];
  const APPROVAL_TEXT = '订单特殊审批';
  const REPORT_SLOT_IDS = ['__hlj_fly_report_switch_slot_v113'];
  const REPORT_TEXT = '报表工具';
  const HOST_SOA = 'checkup-soa3.health-100.cn';

  const SCRIPT_VERSION = '1.6.0';

  // 前台（登记）站点
  const QT_ORIGIN = 'https://checkup-register.health-100.cn';
  const QT_LIST_API = `${QT_ORIGIN}/checkup-hc/api/checkin/query/list`;
  const QT_DETAIL_API = `${QT_ORIGIN}/checkup-hc/api/checkin/query/v2/orderDetail`;

  // ---- 订单级详情（v1.6.0）：前台「点进去这一条」时才会调的三个接口 ----
  // 2026-11-07 真机抓包：在登记列表点开一条记录，前台连发 10 个请求，其中这三个才是
  // 详情页面上看到的「订单信息 / 套餐 / 项目」：
  //   ① query/soaOrderDetail/v2        订单主档 —— 订单名称 soaName、本地单/全国单 soaOrderType、
  //                                    健康顾问 userName/userId/userMobile、订单总额 totalPrice、单位、地区
  //   ② v2/beforeQueryOrderDetailInfo  用 soaOrderNo + nameListUid 换出 packageCode
  //                                    （未到检的记录列表里没有 packageCode，只能靠它）
  //   ③ querySelectedPackages          套餐 + 项目明细 details[]（每项 itemName / goodsName / 价格）
  // 三个都只要 soaOrderNo(即 billCode) + branchCode，未到检那种没有 vid 的记录照样能查。
  const QT_ORDER_API = `${QT_ORIGIN}/checkup-hc/api/checkin/query/soaOrderDetail/v2`;
  const QT_BEFORE_API = `${QT_ORIGIN}/checkup-hc/api/checkin/v2/beforeQueryOrderDetailInfo`;
  const QT_SELPKG_API = `${QT_ORIGIN}/checkup-hc/api/checkin/querySelectedPackages`;

  // SOA 订单类型 / 国单标志的显示名
  const SOA_ORDER_TYPE_TEXT = {
    LOCAL: '本地单',
    NATION: '全国单',
    NATIONAL: '全国单',
    LOCAL_ORDER: '本地单',
    NATION_ORDER: '全国单',
  };

  const QT_CLIENT_ID = 'MN_REGISTER';
  // 前台前端包里 getSignHeader 的第二个入参（写死在前端 chunk 里，不是密钥）
  const QT_SECRET = 'p2otita0dxrpcge6iictqu9vwyj1vn8puv315blxxzmvcpyyakskh713t2c1f57i';

  // ---- 两条查询口径（v1.4.0 分开，2026-11-07 真机抓包 + 实测确认） ----
  // 未到检：走 orderMerge（合并订单视图），一次请求覆盖全部分院，不用切分院；
  //         它只认 TO_APPOINTMENT / APPOINTMENT_FINISH / CHECKED，**不返回 CANCEL**。
  // 已到检 / 已取消：走 order（分院到检单视图），带 branchCode 逐院查，
  //         跨院不串（同一 vid 在 X7/FC 回 0 条）。
  // ⚠️ v1.5.0 补：APPOINTMENT_FINISH 两个服务都能给，但 **order 那份更全**——
  //    带分院、带预约单号、能拉到套餐金额（截图里「玫瑰园 万鑫 未到检 ¥0.00 / 标准 ¥2652.30」就是它），
  //    所以 order 也查 APPOINTMENT_FINISH，查完再把这些「已预约未到检」的记录统一搬进未到检那块（见 migrateNotYet）。
  const QT_SERVICE_MERGE = 'orderMerge';
  const QT_SERVICE_BRANCH = 'order';
  const QT_STATUS_NOTYET = ['TO_APPOINTMENT', 'APPOINTMENT_FINISH'];
  const QT_STATUS_BRANCH = ['APPOINTMENT_FINISH', 'CHECKED', 'CANCEL'];

  // 合并查询也要带一个 branch-code 头（服务端要它做身份上下文）。
  // 实测：X1 / X7 / FC 三个头查回来的内容**完全一样**，说明它不参与过滤，随便取一个即可。
  const MERGED_BRANCH_CODE = 'X1';

  // 查询顺序：玫瑰园 → 宝龙 → 长垣（红领巾 2026-11-06 指定）
  const BRANCHES = [
    { code: 'X7', name: '新乡玫瑰园分院', short: '玫瑰园' },
    { code: 'X1', name: '新乡宝龙分院', short: '宝龙' },
    { code: 'FC', name: '长垣分院', short: '长垣' },
  ];

  // 不分院的「未到检」单独占一行槽位，排在最前面（对应前台第一个页签）
  const MERGED_SLOT = { code: '*', name: '未到检（全部分院）', short: '未到检', merged: true };
  const QUERY_SLOTS = [MERGED_SLOT, ...BRANCHES];

  // 未到检那条记录没有分院码，查订单详情时随便挑一个都行（实测三个分院码返回一致）
  const DEFAULT_BRANCH_CODE = 'X1';

  // 合并视图只给 branchVid，不给分院名；X1/X7/FC 前缀能认，SOA 开头的是共享中心下的单（认不出就留空）
  const BRANCH_VID_PREFIX = [
    { prefix: 'X7', short: '玫瑰园' },
    { prefix: 'X1', short: '宝龙' },
    { prefix: 'FC', short: '长垣' },
  ];

  const STATUS_TEXT = {
    CHECKED: '已到检',
    APPOINTMENT_FINISH: '已预约未到检',
    TO_APPOINTMENT: '未预约',
    CANCEL: '已取消',
  };

  const REQUEST_TIMEOUT = 20000;
  const BRANCH_GAP_MS = 120;
  // 一个分院最多先列几行，剩下的收在「展开全部」里（表格行矮，可以比卡片多放几条）
  const RECORD_PREVIEW_COUNT = 5;

  const PANEL_POS_KEY = `${NS}_pos`;
  const PANEL_WIDTH_KEY = `${NS}_width`;
  // 表格是 7 列，默认宽度给足；窄到 560 以下会横向滚动
  const PANEL_WIDTH_DEFAULT = 720;
  const PANEL_WIDTH_MIN = 560;
  const PANEL_WIDTH_MAX = 1040;

  const state = {
    running: false,
    results: null,
    // 上次查询的关键字：{ type: 'vid' | 'cert', value: string }
    keyword: null,
    // 哪个分院的「展开全部」被点开了：{ X7: true, ... }
    expanded: Object.create(null),
    // 详情用：`分院码#序号` → 记录对象（每次查询重建）
    byKey: new Map(),
  };

  // ============================================================
  // 1. 基础工具
  // ============================================================
  function isAllowedRoute() {
    return location.hostname === HOST_SOA;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function nowText() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function setStatus(text, tone = 'normal') {
    const el = document.getElementById(IDS.status);
    if (!el) return;

    const message = String(text || '').trim();
    if (!message) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }

    const tones = {
      normal: ['#f8fafc', '#475569', '#dbe3ed'],
      running: ['#eff6ff', '#1d4ed8', '#bfdbfe'],
      success: ['#f0fdf4', '#15803d', '#bbf7d0'],
      error: ['#fff7f7', '#b91c1c', '#fecaca'],
    };
    const [bg, color, border] = tones[tone] || tones.normal;
    el.style.display = 'block';
    el.style.background = bg;
    el.style.color = color;
    el.style.borderColor = border;
    el.textContent = message;
  }

  // ============================================================
  // 2. 前台签名
  // ============================================================
  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function buildQtHeaders(branchCode) {
    const ts = String(Date.now());
    const sign = await sha256Hex(QT_CLIENT_ID + ts + QT_SECRET);
    return {
      'Content-Type': 'application/json',
      accept: 'application/json, text/plain, */*',
      mnclientid: QT_CLIENT_ID,
      'branch-code': branchCode,
      mntimestamp: ts,
      mnsign: sign,
    };
  }

  // ============================================================
  // 3. 请求层（跨域走 GM）
  // ============================================================
  function gmPost(url, bodyObj, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers,
        data: JSON.stringify(bodyObj),
        timeout: REQUEST_TIMEOUT,
        anonymous: false,
        onload(res) {
          let json = null;
          try {
            json = JSON.parse(res.responseText || '');
          } catch (_) {
            reject(new Error(`接口未返回有效 JSON（HTTP ${res.status}）`));
            return;
          }
          if (json && json.code && json.code !== '000000') {
            reject(new Error(`${json.message || json.msg || '接口返回失败'}（${json.code}）`));
            return;
          }
          resolve(json || {});
        },
        onerror() {
          reject(new Error('网络请求失败（请确认前台站点可访问、已登录）'));
        },
        ontimeout() {
          reject(new Error(`请求超时（${REQUEST_TIMEOUT}ms）`));
        },
      });
    });
  }

  // ============================================================
  // 4. 查询：分院一条 + 未到检不分院一条
  // ============================================================
  /*
   * 记录归一：两个服务返回的字段名基本一致，差异只在「分院」——
   * 分院查询直接给 branchName；合并查询只给 branchVid，靠前缀猜。
   */
  function mapRecord(item, fallbackBranch) {
    const statusCode = String(item.serviceOrderStatusCode || '');
    return {
      vid: String(item.vid || ''),
      name: String(item.name || ''),
      certMasked: String(item.certificateNumber || item.notSecretCertificateNumber || ''),
      // 未预约的记录没有 appointmentDate，合并视图里也没有 checkupDate，留空显示「—」
      apptDate: String(item.appointmentDate || item.checkupDate || ''),
      statusCode,
      statusText: STATUS_TEXT[statusCode] || String(item.serviceOrderStatus || ''),
      branchShort: String(item.branchName || item.appointBranchName || '')
        || branchShortOf(item.branchVid)
        || (fallbackBranch ? fallbackBranch.short : ''),
      soaOrderNo: String(item.soaOrderNo || ''),
      packageName: String(item.packageName || ''),
      // 原始记录留着，详情浮层要把接口字段全摊开
      raw: item,
    };
  }

  function branchShortOf(branchVid) {
    const code = String(branchVid || '').toUpperCase();
    if (!code) return '';
    const hit = BRANCH_VID_PREFIX.find((x) => code.startsWith(x.prefix));
    return hit ? hit.short : '';
  }

  /*
   * 分院查询：已到检 / 已取消（这两个是真按分院分的）。
   *   serviceName = 'order'
   *   req.appointmentStatus = [CHECKED, CANCEL]
   *   req.vid                  = 预约单号         （输入的是 14 位单号时）
   *   req.certificateNumber    = 身份证号         （输入的是身份证时）
   * 实测（2026-11-06 / 11-07，真实登录态）：
   *   - branch-code 头 + req.branchCode 双管齐下，跨院不会串（同一 vid 在 X7/FC 查回 0 条）；
   *   - req.certificateNumber 有效：同一个身份证在 X1 命中、X7/FC 回 0 条；
   *   - ⚠️ 未到检记录（未预约 / 已预约）**在这个服务里根本查不到**，
   *     2026-11-07 用 410726199006133031 实测：三个分院 × 四状态全返回 0，
   *     而 orderMerge 一次就回 3 条 ⇒ 见下面的 queryNotYet。
   */
  async function queryBranch(branch, keyword) {
    const headers = await buildQtHeaders(branch.code);
    const req = {
      branchCode: branch.code,
      appointmentStatus: QT_STATUS_BRANCH.slice(),
    };
    if (keyword.type === 'cert') req.certificateNumber = keyword.value;
    else req.vid = keyword.value;

    const body = {
      pageRequest: {
        pageNum: 1,
        // 按身份证查可能命中多次到检，多留一些
        pageSize: keyword.type === 'cert' ? 30 : 20,
        req,
      },
      serviceName: QT_SERVICE_BRANCH,
    };

    const json = await gmPost(QT_LIST_API, body, headers);
    const data = (json && json.data) || {};
    const items = Array.isArray(data.content) ? data.content : [];
    // 服务端总数：一页装不下时（按身份证查常见）用于提示「只显示前 N 条」
    const total = Number(data.totalSize ?? data.totalElements ?? items.length);
    const records = items.map((item) => mapRecord(item, branch));
    return { records, total: Number.isFinite(total) ? total : records.length };
  }

  /*
   * 未到检查询：**一次请求查全部分院**（红领巾 2026-11-07 指出：未到检不分院）。
   *   serviceName = 'orderMerge'
   *   req.appointmentStatus = [TO_APPOINTMENT, APPOINTMENT_FINISH]
   *   req.onlySelfBranch    = false      ← 关键：不限本院，否则只剩本院那一条
   * 实测（2026-11-07，前台页面抓包 + 三个 branch-code 头各跑一遍）：
   *   - 410726199006133031 → 3 条（刘志虎，全部「未预约」，分属 X723002028 / SOA227235811 / SOA1540705387）；
   *   - branch-code 换 X1 / X7 / FC，返回**一模一样** ⇒ 确实不分院，不用循环；
   *   - 71438235336973（秦燕）→ 1 条「已预约未到检」，appointmentDate 2026-11-30 ⇒ 按 vid 也能查；
   *   - 这个服务**不含 CANCEL**（已取消仍走分院那条 order），也不含「共享中心」的已取消单。
   */
  async function queryNotYet(keyword) {
    const headers = await buildQtHeaders(MERGED_BRANCH_CODE);
    const req = {
      appointmentStatus: QT_STATUS_NOTYET.slice(),
      onlySelfBranch: false,
      branchCode: MERGED_BRANCH_CODE,
      overTwoHour: '0',
    };
    if (keyword.type === 'cert') req.certificateNumber = keyword.value;
    else req.vid = keyword.value;

    const body = {
      pageRequest: {
        pageNum: 1,
        pageSize: keyword.type === 'cert' ? 50 : 20,
        req,
      },
      serviceName: QT_SERVICE_MERGE,
    };

    const json = await gmPost(QT_LIST_API, body, headers);
    const data = (json && json.data) || {};
    const items = Array.isArray(data.content) ? data.content : [];
    const total = Number(data.totalSize ?? data.totalElements ?? items.length);
    const records = items.map((item) => mapRecord(item, MERGED_SLOT));
    return { records, total: Number.isFinite(total) ? total : records.length };
  }

  /*
   * 单条详情：拿「完整证件号 + 金额」。
   * 实测：已到检、已取消有数据；未到检（APPOINTMENT_FINISH）返回 code=000000 但 data 为空
   *      ⇒ 金额显示「—」，不瞎猜。
   * 金额口径：packages[].settlementPrice = 实收（receviceSettlePrice 同值），
   *          packages[].checkPrice     = 标准价，两个都显示，避免口径打架。
   */
  async function fetchDetail(branchCode, vid) {
    const headers = await buildQtHeaders(branchCode);
    const json = await gmPost(QT_DETAIL_API, { vid, branchCode }, headers);
    const data = (json && json.data) || null;
    if (!data || !Object.keys(data).length) return null;

    const packages = Array.isArray(data.packages) ? data.packages : [];
    let settle = 0;
    let standard = 0;
    let hasSettle = false;
    let hasStandard = false;
    const payStatus = new Set();

    for (const pkg of packages) {
      const s = Number(pkg?.settlementPrice ?? pkg?.receviceSettlePrice);
      if (Number.isFinite(s)) {
        settle += s;
        hasSettle = true;
      }
      const c = Number(pkg?.checkPrice);
      if (Number.isFinite(c)) {
        standard += c;
        hasStandard = true;
      }
      if (pkg?.payStatusStr) payStatus.add(String(pkg.payStatusStr));
    }

    return {
      certFull: String(data.certificateNumber || ''),
      apptDate: String(data.appointmentDate || ''),
      customerName: String(data.customerName || ''),
      settle: hasSettle ? settle : null,
      standard: hasStandard ? standard : null,
      payStatus: [...payStatus].join(' / '),
      packageName: packages.map((p) => String(p?.packageName || '')).filter(Boolean).join('、'),
      // 同上：详情浮层要摊全字段 + 每个套餐的字段
      raw: data,
    };
  }

  /*
   * 订单级详情（v1.6.0）：红领巾问「详情里边能获取到订单名称么」——
   * 能，而且比他列的还多。前台「点进去这一条」看到的那一屏，数据就是下面三个接口拼的：
   *
   *   订单名称   soaOrderDetail/v2 → soaName            （例：延津县邮政局2023年度福利）
   *   本地/全国  soaOrderDetail/v2 → soaOrderType（LOCAL/NATION）+ isNation（Y/N）
   *   健康顾问   soaOrderDetail/v2 → userName / userId / userMobile
   *              （同一个信息在 remark3 里也有纯文本一份，两份都给）
   *   金额       soaOrderDetail/v2 → totalPrice（整单总额）
   *              querySelectedPackages → checkPrice 标准价 / settlementPrice 结算价（本单）
   *   套餐项目   querySelectedPackages → packageName + details[]（每项的 itemName / goodsName / 三个价）
   *
   * 请求数：有 packageCode 时 2 个；未到检那种没有的，多一个 beforeQuery 换 packageCode，共 3 个。
   * 所以只在**点开详情**时才拉，不跟着列表查询一起打（几十条记录会直接把接口打满）。
   */
  async function fetchOrderFull(rec, branch) {
    const raw = rec.raw || {};
    const soaOrderNo = String(rec.soaOrderNo || raw.soaOrderNo || raw.oldSoaOrderNo || '');
    if (!soaOrderNo) {
      return { error: '这条记录没有 SOA 订单号，订单级详情拉不到（未预约的单可能本来就没生成订单）' };
    }

    // 未到检是跨分院的，记录里没有分院码；实测用任意分院码查同一张订单都返回一样的结果
    const branchCode = branch && !branch.merged && branch.code ? branch.code : DEFAULT_BRANCH_CODE;
    const cert = String(raw.notSecretCertificateNumber || raw.certificateNumber || '');
    const nameListUid = String(raw.nameListUid || '');

    const out = { order: null, before: null, packages: [], pkgCodes: [], error: '' };

    const safePost = async (url, body, label) => {
      try {
        const headers = await buildQtHeaders(branchCode);
        return await gmPost(url, body, headers);
      } catch (err) {
        out.error = out.error || `${label}：${String(err?.message || err)}`;
        return null;
      }
    };

    // ① 订单主档
    const j1 = await safePost(QT_ORDER_API, { billCode: soaOrderNo, branchCode }, '订单主档');
    out.order = (j1 && j1.data) || null;

    // ② packageCode：列表项里带着就直接用；未到检没有，得让 beforeQuery 吐出来
    const codes = [];
    const pushCode = (c) => {
      const v = String(c || '');
      if (v && !codes.includes(v)) codes.push(v);
    };
    pushCode(raw.packageCode);

    if (!codes.length) {
      const j2 = await safePost(
        QT_BEFORE_API,
        { branchCode, soaOrderNo, certificateNumber: cert, nameListUid },
        '套餐编码'
      );
      const d = (j2 && j2.data) || null;
      out.before = d;
      if (d) {
        (Array.isArray(d.branchOrders) ? d.branchOrders : []).forEach((bo) => {
          (Array.isArray(bo?.examinatioItems) ? bo.examinatioItems : []).forEach((it) => pushCode(it?.packageCode));
        });
        (Array.isArray(d.packages) ? d.packages : []).forEach((p) => pushCode(p?.packageCode));
      }
    }

    out.pkgCodes = codes;

    // ③ 套餐 + 项目明细
    if (codes.length) {
      const j3 = await safePost(
        QT_SELPKG_API,
        { billCode: soaOrderNo, branchCode, packages: codes.map((packageCode) => ({ packageCode })), replaceItemInfos: [] },
        '套餐明细'
      );
      out.packages = Array.isArray(j3 && j3.data) ? j3.data : [];
    }

    return out;
  }

  // ============================================================
  // 5. 主查询流程
  // ============================================================
  /*
   * 单输入框：自动识别填的是预约单号还是身份证号。
   *   14 位纯数字          ⇒ 预约单号（前台 vid 现在就是 14 位）
   *   15~18 位，末位可 X   ⇒ 身份证号（15 位老证 / 18 位新证）
   * 歧义说明：预约单号不会长到 15 位，身份证不会短到 14 位，
   *   所以按长度切就够了，不用让用户选类型。
   */
  function parseKeyword(raw) {
    const text = String(raw || '')
      .replace(/\s+/g, '')
      .toUpperCase();

    if (!text) return { error: '请输入预约单号或身份证号' };

    const hasIllegalChar = /[^0-9X]/.test(text);
    const xIndex = text.indexOf('X');
    const xInMiddle = xIndex !== -1 && xIndex !== text.length - 1;
    if (hasIllegalChar || xInMiddle) {
      return { error: '只能填数字（身份证末位可以是 X）' };
    }

    if (/^\d{14}$/.test(text)) return { type: 'vid', value: text };
    if (text.length >= 15 && text.length <= 18) return { type: 'cert', value: text };

    return { error: `位数不对：预约单号 14 位、身份证 15/18 位，现在是 ${text.length} 位` };
  }

  function keywordName(keyword) {
    return keyword?.type === 'cert' ? '身份证号' : '预约单号';
  }

  /*
   * 「已预约未到检」在 orderMerge 和 order 里都会出现，但 order 那份更全（分院 / 预约单号 / 套餐金额）。
   * 所以两边都查，查完把 order 的这类记录搬进未到检那块，同一单只留一份：
   *   去重键 ＝ 预约单号 vid + SOA 订单号（两个都试，避免一份有 vid 一份只有订单号时重复）。
   */
  function recKeyList(rec) {
    const keys = [];
    if (rec.vid) keys.push(`v:${rec.vid}`);
    if (rec.soaOrderNo) keys.push(`s:${rec.soaOrderNo}`);
    if (!keys.length) keys.push(`n:${rec.name}|${rec.statusCode}`);
    return keys;
  }

  function migrateNotYet() {
    const merged = state.results.find((s) => s.branch.merged);
    if (!merged) return;

    const seen = new Set();
    merged.records.forEach((rec) => recKeyList(rec).forEach((k) => seen.add(k)));

    const moved = [];
    for (const slot of state.results) {
      if (slot.branch.merged || slot.status !== 'ok') continue;

      const keep = [];
      let movedOut = 0;
      for (const rec of slot.records) {
        if (rec.statusCode !== 'APPOINTMENT_FINISH') {
          keep.push(rec);
          continue;
        }
        movedOut += 1;
        const keys = recKeyList(rec);
        if (keys.some((k) => seen.has(k))) continue; // 未到检那块已经有了
        keys.forEach((k) => seen.add(k));
        moved.push(rec);
      }

      slot.records = keep;
      slot.total = keep.length;
      slot.movedOut = movedOut;
      if (!keep.length) slot.status = 'empty';
    }

    if (moved.length) {
      merged.records = merged.records.concat(moved);
      merged.total = merged.records.length;
      merged.status = 'ok';
    }
  }

  async function runQuery() {
    if (state.running) return;

    const input = document.getElementById(IDS.input);
    const parsed = parseKeyword(input?.value);

    if (parsed.error) {
      setStatus(parsed.error, 'error');
      input?.focus();
      return;
    }

    const keyword = { type: parsed.type, value: parsed.value };

    state.running = true;
    state.keyword = keyword;
    state.expanded = Object.create(null); // 新查询从收起状态开始
    refreshQueryButton();
    state.byKey = new Map();
    state.results = QUERY_SLOTS.map((branch) => ({ branch, status: 'pending', records: [], total: 0, error: '' }));
    renderResults();

    try {
      for (let i = 0; i < QUERY_SLOTS.length; i += 1) {
        const branch = QUERY_SLOTS[i];
        const slot = state.results[i];
        const where = branch.merged ? '全部分院（未到检）' : `${branch.short} 分院`;
        setStatus(`正在按${keywordName(keyword)}查 ${where}（${i + 1}/${QUERY_SLOTS.length}）…`, 'running');

        try {
          const res = branch.merged ? await queryNotYet(keyword) : await queryBranch(branch, keyword);
          const list = res.records;
          slot.total = res.total;
          if (!list.length) {
            slot.status = 'empty';
          } else {
            // 详情接口要 branchCode，未到检是合并口径拿不到准分院，本来就查不到金额，直接跳过
            if (!branch.merged) {
              for (const rec of list) {
                if (!rec.vid) continue;
                rec.detail = await fetchDetail(branch.code, rec.vid).catch(() => null);
                rec.detailRaw = rec.detail?.raw || null;
                if (rec.detail?.apptDate) rec.apptDate = rec.detail.apptDate;
                if (rec.detail?.certFull) rec.certFull = rec.detail.certFull;
                if (rec.detail?.customerName) rec.name = rec.detail.customerName;
              }
            }
            // 详情浮层按 `分院码#序号` 取记录，顺便记下它属于哪个槽位
            list.forEach((rec, idx) => {
              rec.__branch = branch;
              state.byKey.set(`${branch.code}#${idx}`, rec);
            });
            slot.status = 'ok';
            slot.records = list;
          }
        } catch (err) {
          slot.status = 'error';
          slot.error = String(err?.message || err);
        }

        renderResults();
        if (i < QUERY_SLOTS.length - 1) await sleep(BRANCH_GAP_MS);
      }

      // 已预约未到检：order 那份带分院/单号/金额，统一搬到未到检那块去，避免两边各出现一次
      migrateNotYet();
      renderResults();

      const hitSlots = state.results.filter((x) => x.status === 'ok').length;
      const hitRecords = state.results.reduce((sum, x) => sum + x.records.length, 0);
      const failed = state.results.filter((x) => x.status === 'error').length;

      if (failed) {
        setStatus(`查询完成：${hitRecords} 条记录，${failed} 处查询失败（见下方）。${nowText()}`, 'error');
      } else {
        setStatus(
          hitRecords
            ? `查询完成：${hitSlots} 处命中，共 ${hitRecords} 条记录。${nowText()}`
            : `未到检和三个分院都没查到该${keywordName(keyword)}。`,
          hitRecords ? 'success' : 'error'
        );
      }
    } finally {
      state.running = false;
      refreshQueryButton();
    }
  }

  // ============================================================
  // 6. 渲染
  // ============================================================
  // 千分位：订单总额动辄十几万，不分节根本读不出来
  function moneyText(value) {
    if (!Number.isFinite(value)) return '—';
    const [int, dec] = Number(value).toFixed(2).split('.');
    return `¥${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
  }

  /*
   * 结果分成两块（红领巾 2026-11-07）：
   *   ① 未到检：不分院，单独一块，单号列兼当「预约单号 / 订单号」；
   *   ② 已到检 / 已取消：按分院，每个分院一种底色，扫一眼就知道是哪家的。
   * 主表只放「一眼要看」的 7 列，字段级全量数据收进每行末尾的「详情」浮层。
   */
  const BRANCH_COLS = 8;  // 分院 / 姓名 / 证件号 / 体检日期 / 金额 / 状态 / 预约单号 / 详情
  const NOTYET_COLS = 7;  // 姓名 / 证件号 / 体检日期 / 金额 / 状态 / 预约单号（订单号）/ 详情

  /*
   * 表格里的状态用短名：列宽有限，「已预约未到检」会把单元格挤成两行。
   * 完整说法放 title，鼠标悬停能看到。
   * 未到检的两个状态按**前台的叫法**来（未预约 / 已预约），不然一排「未到检」分不清该催谁。
   */
  const STATUS_SHORT = {
    CHECKED: '已到检',
    APPOINTMENT_FINISH: '已预约',
    TO_APPOINTMENT: '未预约',
    CANCEL: '已取消',
  };

  function branchClass(code) {
    return `is-br-${String(code || '').toLowerCase()}`;
  }

  function statusCell(detail, statusText, statusShort, extraNote) {
    const note = [extraNote, detail?.payStatus].filter(Boolean).join(' · ');
    return `
        <td class="qt-c-status" title="${escapeHtml([statusText, note].filter(Boolean).join(' · '))}">
          <span class="qt-chip">${escapeHtml(statusShort)}</span>
          ${note ? `<em>${escapeHtml(note)}</em>` : ''}
        </td>`;
  }

  function detailCell(key) {
    return `<td class="qt-c-act"><button type="button" class="qt-detail" data-key="${escapeHtml(key)}">详情</button></td>`;
  }

  // 分院表的一行（已到检 / 已取消）
  function renderBranchRow(rec, branch, key) {
    const detail = rec.detail || null;
    const certText = rec.certFull || rec.certMasked || '—';
    const settle = detail ? detail.settle : null;
    const standard = detail ? detail.standard : null;
    const standardSub = Number.isFinite(standard) && standard !== settle
      ? `<i>标准 ${moneyText(standard)}</i>`
      : '';
    const statusText = rec.statusText || rec.statusCode || '—';
    const statusShort = STATUS_SHORT[rec.statusCode] || statusText;
    const branchLabel = branch.short || rec.branchShort || '—';

    return `
      <tr class="qt-row ${branchClass(branch.code)}">
        <td class="qt-c-branch" title="${escapeHtml(rec.branchShort || branch.name || '')}">${escapeHtml(branchLabel)}</td>
        <td class="qt-c-name" title="${escapeHtml(rec.name || '')}">${escapeHtml(rec.name || '—')}</td>
        <td class="qt-c-cert" title="${escapeHtml(certText)}">${escapeHtml(certText || '—')}</td>
        <td class="qt-c-date">${escapeHtml(rec.apptDate || '—')}</td>
        <td class="qt-c-money">${moneyText(settle)}${standardSub}</td>${statusCell(detail, statusText, statusShort)}
        <td class="qt-c-vid">${escapeHtml(rec.vid || '—')}</td>${detailCell(key)}
      </tr>
    `;
  }

  // 未到检表的一行：没有分院列；单号列没 vid 就显示 SOA 订单号
  function renderNotYetRow(rec, key) {
    const detail = rec.detail || null;
    const certText = rec.certFull || rec.certMasked || '—';
    const settle = detail ? detail.settle : null;
    const standard = detail ? detail.standard : null;
    const standardSub = Number.isFinite(standard) && standard !== settle
      ? `<i>标准 ${moneyText(standard)}</i>`
      : '';
    const statusText = rec.statusText || rec.statusCode || '—';
    const statusShort = STATUS_SHORT[rec.statusCode] || statusText;
    const docText = rec.vid || rec.soaOrderNo || '—';
    const docTitle = rec.vid ? `预约单号 ${rec.vid}` : `SOA 订单号 ${rec.soaOrderNo}`;
    // 从分院那边搬过来的「已预约未到检」还带着分院，顺手标在状态下面
    const branchNote = rec.__branch && !rec.__branch.merged ? rec.__branch.short : '';

    return `
      <tr class="qt-row qt-row-notyet">
        <td class="qt-c-name" title="${escapeHtml(rec.name || '')}">${escapeHtml(rec.name || '—')}</td>
        <td class="qt-c-cert" title="${escapeHtml(certText)}">${escapeHtml(certText || '—')}</td>
        <td class="qt-c-date">${escapeHtml(rec.apptDate || '—')}</td>
        <td class="qt-c-money">${moneyText(settle)}${standardSub}</td>${statusCell(detail, statusText, statusShort, branchNote)}
        <td class="qt-c-vid" title="${escapeHtml(docTitle)}">${escapeHtml(docText)}</td>${detailCell(key)}
      </tr>
    `;
  }

  function hintRow(text, tone, cols, firstCell) {
    const head = firstCell ? `<td class="qt-c-branch">${escapeHtml(firstCell)}</td>` : '';
    const span = firstCell ? cols - 1 : cols;
    return `
      <tr class="qt-row-hint${tone ? ` is-${tone}` : ''}">
        ${head}<td colspan="${span}">${escapeHtml(text)}</td>
      </tr>
    `;
  }

  function moreRow(code, total, expanded, cols) {
    return `
      <tr class="qt-row-more">
        <td colspan="${cols}">
          <button type="button" class="qt-more" data-branch="${escapeHtml(code)}">
            ${expanded ? '收起' : `展开全部 ${total} 条`}
          </button>
        </td>
      </tr>
    `;
  }

  function noteRow(text, cols) {
    return `<tr class="qt-row-note"><td colspan="${cols}">${escapeHtml(text)}</td></tr>`;
  }

  // ---- ① 未到检（不分院，单独一块） ----
  function renderNotYetBlock(slot) {
    if (!slot) return '';

    let rows;
    let meta = '';

    if (slot.status === 'pending') {
      rows = hintRow('正在查（全部分院，不用切分院）…', '', NOTYET_COLS);
    } else if (slot.status === 'empty') {
      rows = hintRow('未查到未到检记录', 'empty', NOTYET_COLS);
    } else if (slot.status === 'error') {
      rows = hintRow(`查询失败：${slot.error}`, 'error', NOTYET_COLS);
    } else {
      const all = slot.records;
      const expanded = !!state.expanded['*'];
      const shown = expanded ? all : all.slice(0, RECORD_PREVIEW_COUNT);
      meta = `${all.length} 条`;
      rows = shown.map((rec, idx) => renderNotYetRow(rec, `${slot.branch.code}#${idx}`)).join('');
      if (all.length > RECORD_PREVIEW_COUNT) rows += moreRow('*', all.length, expanded, NOTYET_COLS);
      if (slot.total > all.length) rows += noteRow(`接口共 ${slot.total} 条，本次只取了前 ${all.length} 条`, NOTYET_COLS);
    }

    return `
      <div class="qt-block qt-block-notyet">
        <div class="qt-block-head">
          <span class="qt-block-title"><i class="qt-dot qt-dot-notyet"></i>未到检</span>
          <span class="qt-block-tag">不分院 · 一次查全部</span>
          <span class="qt-block-meta">${escapeHtml(meta)}</span>
        </div>
        <table class="qt-table qt-table-notyet">
          <colgroup>
            <col class="qt-wy-name" /><col class="qt-wy-cert" /><col class="qt-wy-date" />
            <col class="qt-wy-money" /><col class="qt-wy-status" /><col class="qt-wy-doc" /><col class="qt-wy-act" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">姓名</th><th scope="col">证件号</th><th scope="col">体检日期</th>
              <th scope="col">金额</th><th scope="col">状态</th><th scope="col">预约单号 / 订单号</th><th scope="col"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  // ---- ② 已到检 / 已取消（按分院，一院一色） ----
  function renderBranchBlock(slots) {
    const rows = [];
    let hit = 0;
    let finished = 0;

    for (const slot of slots) {
      const branch = slot.branch;
      if (slot.status === 'pending') {
        rows.push(hintRow('查询中…', '', BRANCH_COLS, branch.short));
        continue;
      }
      finished += 1;
      if (slot.status === 'empty') {
        // 这家只有「未到检」记录：不能只说「未查到」，否则看着像白查了一遍
        const text = slot.movedOut ? `只有未到检记录 ${slot.movedOut} 条（已归到上表）` : '未查到';
        rows.push(hintRow(text, 'empty', BRANCH_COLS, branch.short));
        continue;
      }
      if (slot.status === 'error') {
        rows.push(hintRow(`查询失败：${slot.error}`, 'error', BRANCH_COLS, branch.short));
        continue;
      }

      const all = slot.records;
      hit += all.length;
      const expanded = !!state.expanded[branch.code];
      const shown = expanded ? all : all.slice(0, RECORD_PREVIEW_COUNT);
      rows.push(shown.map((rec, idx) => renderBranchRow(rec, branch, `${branch.code}#${idx}`)).join(''));
      if (all.length > RECORD_PREVIEW_COUNT) rows.push(moreRow(branch.code, all.length, expanded, BRANCH_COLS));
      if (slot.total > all.length) {
        rows.push(noteRow(`${branch.short}：接口共 ${slot.total} 条，本次只取了前 ${all.length} 条`, BRANCH_COLS));
      }
    }

    const legend = BRANCHES
      .map((b) => `<i class="qt-dot ${branchClass(b.code)}"></i>${escapeHtml(b.short)}`)
      .join('');

    return `
      <div class="qt-block qt-block-branch">
        <div class="qt-block-head">
          <span class="qt-block-title">已到检 / 已取消</span>
          <span class="qt-block-tag">按分院</span>
          <span class="qt-legend">${legend}</span>
          <span class="qt-block-meta">${hit ? `${hit} 条` : ''}</span>
        </div>
        <table class="qt-table">
          <colgroup>
            <col class="qt-w-branch" /><col class="qt-w-name" /><col class="qt-w-cert" />
            <col class="qt-w-date" /><col class="qt-w-money" /><col class="qt-w-status" />
            <col class="qt-w-vid" /><col class="qt-w-act" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">分院</th><th scope="col">姓名</th><th scope="col">证件号</th>
              <th scope="col">体检日期</th><th scope="col">金额</th><th scope="col">状态</th>
              <th scope="col">预约单号</th><th scope="col"></th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        ${finished === slots.length ? `<div class="qt-block-foot">已查 ${finished} 个分院 · 已到检 / 已取消共 ${hit} 条</div>` : ''}
      </div>
    `;
  }

  function renderResults() {
    const box = document.getElementById(IDS.result);
    if (!box) return;

    if (!state.results) {
      box.innerHTML = `
        <div class="qt-empty">
          填预约单号（14 位）或身份证号（18 位）后点「查询」：<br />
          未到检<b>一次查全部分院</b>（不分院），已到检 / 已取消再依次查
          ${BRANCHES.map((b) => escapeHtml(b.short)).join(' → ')} 三个分院。
        </div>
      `;
      return;
    }

    const mergedSlot = state.results.find((s) => s.branch.merged);
    const branchSlots = state.results.filter((s) => !s.branch.merged);

    box.innerHTML = `
      ${renderNotYetBlock(mergedSlot)}
      ${renderBranchBlock(branchSlots)}
    `;
  }

  /*
   * 详情浮层（红领巾 2026-11-07）：
   * 主表只留 7 列，字段级的东西全塞这里 ——
   *   ① 列表记录（query/list）的全部字段
   *   ② 套餐 / 收费（orderDetail）的全部字段
   *   ③ 每个套餐的字段
   *   ④ 原始 JSON（两段都留着，接口新加字段时不至于丢）
   * 未到检的记录没有 orderDetail（那边本来就是空），所以只有 ①④。
   */
  const DETAIL_LABELS = {
    // 人
    name: '姓名', customerName: '客户姓名', customerShortName: '客户简称', englishName: '英文名',
    gender: '性别', genderCode: '性别码', age: '年龄', birthDate: '出生日期',
    certificateType: '证件类型', certificateTypeCode: '证件类型码', certificateNumber: '证件号',
    notSecretCertificateNumber: '证件号明文', secretCertificateNumber: '证件号（脱敏）',
    certificateNumberEncrypt: '证件号密文', customerIdentity: '客户身份',
    phone: '手机号', notSecretPhone: '手机号明文', customerPhone: '客户电话',
    email: '邮箱', address: '地址', maritalStatus: '婚姻状况', maritalStatusCode: '婚姻状况码',
    nationality: '国籍', nation: '民族', memberType: '会员类型', userAccountNo: '用户账号',
    // 单位 / 工号 / 卡
    companyName: '单位名称', companyCode: '单位代码', dept1: '部门一', dept2: '部门二',
    memberNumber: '员工工号', memberId: '员工 ID', cardNumber: '体检卡号',
    checkupCardType: '卡类型', vipEnabled: 'VIP', cardCheckEnable: '刷卡校验',
    // 状态
    serviceOrderStatus: '服务单状态', serviceOrderStatusCode: '服务单状态码',
    checkupOrderStatus: '体检单状态', orignalStatus: '原状态',
    appointmentStatus: '预约状态', appointmentType: '预约类型', appointmentTypeCN: '预约类型',
    appointmentModeStr: '预约方式', appointmentModeCode: '预约方式码', appointmentMode: '预约方式码',
    appointmentDate: '预约日期', appointmentTime: '预约时间', appointmentTimeSlot: '预约时段',
    checkupDate: '体检日期', checkupOrderDate: '体检单日期', checkinTime: '到检时间', checkinDateTime: '到检时间',
    checkoutTime: '离检时间', checkinChannel: '到检渠道',
    // 单号 / 机构
    vid: '预约单号', soaOrderNo: 'SOA 订单号', oldSoaOrderNo: '原订单号', soaOrderType: 'SOA 订单类型',
    orderName: '订单名称', orderSource: '订单来源码', orderSourceCN: '订单来源',
    orderBuySource: '订单购买来源', orderCenterNo: '订单中心号', nameListUid: '名单 ID',
    nameListRemark: '名单备注', serviceUid: '服务单 UID', identityUid: '身份 UID',
    cid: '客户 ID', uid: 'UID', id: 'ID', orderId: '订单 ID',
    branchCode: '分院代码', branchName: '分院名称', branchVid: '分院 VID',
    appointBranchCode: '预约分院代码', appointBranchName: '预约分院',
    checkinBranchCode: '到检分院代码', checkinBranchName: '到检分院',
    regionCode: '区域代码', bucketName: '存储桶',
    checkupType: '体检类型', checkupTypeCode: '体检类型码', checkGroupType: '检查组类型',
    // 套餐 / 收费
    packageName: '套餐名称', packageCode: '套餐编码', packageId: '套餐 ID', soaPackageId: 'SOA 套餐 ID',
    packageType: '套餐类型', goodsType: '商品类型', itemSource: '项目来源', addSourceCN: '加项来源',
    fromSource: '来源', achieveType: '履约方式码', achieveTypeCN: '履约方式',
    totalPrice: '总价', checkPrice: '标准价', settlementPrice: '实收价',
    receviceSettlePrice: '实收价（旧字段）', discount: '折扣', priceLocked: '价格锁定',
    payStatus: '支付状态码', payStatusStr: '支付状态', soaPayType: 'SOA 支付方式',
    firstReport: '首次报告', gjkFlag: '国健卡标志', newFlag: '新单标志',
    // 其它
    replaceFlag: '是否替换单', onlySelfBranch: '仅本院', overTwoHour: '超两小时',
    pregnantEnabled: '孕妇检查', needNotifyGuide: '需通知导检', agreeThirdQueryEnabled: '允许第三方查询',
    logicDelete: '逻辑删除', operatorName: '操作人', creatorName: '创建人姓名',
    createBy: '创建人', createAt: '创建时间', createAtDate: '创建日期',
    updateBy: '更新人', updateAt: '更新时间',
  };

  // 详情里优先靠前的字段（其余的按接口原顺序接在后面）
  const DETAIL_ORDER = [
    'name', 'gender', 'birthDate', 'age', 'certificateNumber', 'notSecretCertificateNumber',
    'phone', 'notSecretPhone', 'companyName', 'companyCode', 'dept1', 'dept2', 'memberNumber',
    'serviceOrderStatus', 'appointmentStatus', 'appointmentDate', 'checkupDate', 'checkinTime',
    'vid', 'soaOrderNo', 'branchName', 'branchVid', 'cid', 'packageName',
    'checkPrice', 'settlementPrice', 'payStatusStr', 'checkupCardType', 'cardNumber', 'vipEnabled',
  ];

  function fmtDetailValue(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  // 标量字段排成「字段名 / 值」两列；空字段收进折叠区，免得淹没真正有内容的那几行
  function detailKvRows(keys, src) {
    return `
      <div class="qt-kv">
        ${keys.map((k) => {
          const text = fmtDetailValue(src[k]);
          const label = DETAIL_LABELS[k] || k;
          return `
            <div class="qt-kv-k" title="${escapeHtml(k)}">${escapeHtml(label)}</div>
            <div class="qt-kv-v${text ? '' : ' is-blank'}">${escapeHtml(text || '—')}</div>
          `;
        }).join('')}
      </div>
    `;
  }

  function detailKv(obj) {
    const src = obj || {};
    const scalars = Object.keys(src).filter((k) => src[k] === null || typeof src[k] !== 'object');
    if (!scalars.length) return '<div class="qt-kv-empty">（这个接口没返回字段）</div>';

    const order = (a, b) => {
      const ia = DETAIL_ORDER.indexOf(a);
      const ib = DETAIL_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    };

    const filled = scalars.filter((k) => fmtDetailValue(src[k]) !== '').sort(order);
    const blanks = scalars.filter((k) => fmtDetailValue(src[k]) === '').sort(order);

    return [
      filled.length
        ? detailKvRows(filled, src)
        : '<div class="qt-kv-empty">（这个接口的字段都是空的）</div>',
      blanks.length
        ? `<details class="qt-blanks"><summary>其余 ${blanks.length} 个字段为空（点开看）</summary>${detailKvRows(blanks, src)}</details>`
        : '',
    ].join('');
  }

  function detailPackages(data) {
    const list = Array.isArray(data?.packages) ? data.packages : [];
    if (!list.length) return '';
    return list.map((pkg, i) => `
      <div class="qt-pkg">
        <div class="qt-pkg-head">套餐 ${i + 1}${pkg?.packageName ? ` · ${escapeHtml(String(pkg.packageName))}` : ''}</div>
        ${detailKv(pkg)}
      </div>
    `).join('');
  }

  // ---- v1.6.0 订单信息 / 套餐项目 ----

  // 「本地单 / 全国单」：soaOrderType 是权威值，isNation 兜底（有的老单只给了 isNation）
  function soaOrderTypeText(order) {
    const t = String(order?.soaOrderType || '').toUpperCase();
    if (SOA_ORDER_TYPE_TEXT[t]) return SOA_ORDER_TYPE_TEXT[t];
    if (String(order?.isNation || '').toUpperCase() === 'Y') return '全国单';
    if (String(order?.isNation || '').toUpperCase() === 'N') return '本地单';
    return t || '—';
  }

  const SOA_PAY_TYPE_TEXT = {
    CORP_PAY: '单位支付',
    SELF_PAY: '个人支付',
    MIXED_PAY: '混合支付',
    ONLINE_PAY: '在线支付',
  };

  function payTypeText(code) {
    const k = String(code || '').toUpperCase();
    return SOA_PAY_TYPE_TEXT[k] || String(code || '—');
  }

  function sumBy(list, key) {
    let sum = 0;
    let has = false;
    for (const x of list) {
      const n = Number(x?.[key]);
      if (Number.isFinite(n)) {
        sum += n;
        has = true;
      }
    }
    return has ? sum : null;
  }

  /*
   * 订单信息：上面一屏「一眼要看到」的（订单名称 / 单类型 / 健康顾问 / 金额），
   * 下面把接口给的其余字段全摊开（空字段照旧收进折叠区）。
   */
  function detailOrderCard(order, info) {
    // 接口失败时 data 可能是 null，也可能是个空壳（只剩 content:[] 这种列表残留），
    // 这两种都算「没拿到」，否则会显示成「（接口没给订单名称）」，看着像订单本身没名字
    const useful = order && ['soaName', 'orderCode', 'mnBillCode', 'companyName', 'totalPrice', 'userName']
      .some((k) => String(order[k] || '').trim());
    if (!useful) {
      return `<div class="qt-kv-empty">${escapeHtml(info?.error || '订单接口没返回数据，这一单查不到订单主档')}</div>`;
    }

    const typeText = soaOrderTypeText(order);
    const isNation = typeText === '全国单';
    const advisor = [order.userName, order.userId ? `(${order.userId})` : ''].join('').trim();

    const head = `
      <div class="qt-order-hero">
        <div class="qt-order-name" title="${escapeHtml(String(order.soaName || ''))}">
          ${escapeHtml(String(order.soaName || '（接口没给订单名称）'))}
        </div>
        <div class="qt-order-tags">
          <span class="qt-tag ${isNation ? 'is-nation' : 'is-local'}">${escapeHtml(typeText)}</span>
          ${Number.isFinite(Number(order.totalPrice)) ? `<span class="qt-tag is-money">整单 ${moneyText(Number(order.totalPrice))}</span>` : ''}
          ${order.healthCardTypeCN ? `<span class="qt-tag">${escapeHtml(String(order.healthCardTypeCN))}</span>` : ''}
        </div>
      </div>
    `;

    const rows = [
      ['订单号', String(order.orderCode || order.mnBillCode || '')],
      ['单位', [order.companyName, order.corpShortName && order.corpShortName !== order.companyName ? `（${order.corpShortName}）` : ''].join('')],
      ['地区', String(order.regionName || order.regionCode || '')],
      ['健康顾问', advisor ? `${advisor}${order.userMobile ? ` · ${order.userMobile}` : ''}` : ''],
      ['联系人', [order.contacts, order.contactNumber].filter(Boolean).join(' · ')],
      ['有效期', [order.beginDate, order.endDate].filter(Boolean).join(' ~ ')],
      ['单位地址', String(order.corpAddress || '')],
      ['订单备注', String(order.remark || '')],
    ].filter(([, v]) => String(v || '').trim());

    const grid = rows.length
      ? `<div class="qt-order-grid">${rows.map(([k, v]) => `
          <div class="qt-og-k">${escapeHtml(k)}</div>
          <div class="qt-og-v">${escapeHtml(String(v))}</div>
        `).join('')}</div>`
      : '';

    // remark3 常写成「健管顾问：xxx(a96652) 换行 联系电话：xxx」，单独一行显示，免得挤在格子里
    const remark3 = String(order.remark3 || '').trim();
    const remark3Html = remark3
      ? `<div class="qt-order-remark">${escapeHtml(remark3).replace(/\n/g, '<br />')}</div>`
      : '';

    return `
      ${head}
      ${grid}
      ${remark3Html}
      <details class="qt-blanks">
        <summary>订单全部 ${Object.keys(order).length} 个字段</summary>
        ${detailKv(order)}
      </details>
    `;
  }

  // 项目明细表：一个套餐里的检查项（details[]）
  function detailItemsTable(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return '<div class="qt-kv-empty">这个套餐没返回项目明细</div>';

    const rows = list.map((it) => {
      const name = String(it?.itemName || '');
      const goods = String(it?.goodsName || '');
      const sale = Number(it?.salePrice ?? it?.branchPrice);
      const settle = Number(it?.settlePrice);
      return `
        <tr>
          <td class="qt-it-name" title="${escapeHtml(name)}">${escapeHtml(name || '—')}</td>
          <td class="qt-it-goods" title="${escapeHtml(goods)}">${escapeHtml(goods || '—')}</td>
          <td class="qt-it-price">${Number.isFinite(sale) ? moneyText(sale) : '—'}</td>
          <td class="qt-it-price">${Number.isFinite(settle) ? moneyText(settle) : '—'}</td>
        </tr>
      `;
    }).join('');

    // 项目可能几十项，表格限高自己滚，别把浮层撑成一条长卷
    return `
      <div class="qt-items-scroll">
      <table class="qt-item-table">
        <thead>
          <tr>
            <th scope="col" class="qt-it-name">项目</th>
            <th scope="col" class="qt-it-goods">商品名</th>
            <th scope="col" class="qt-it-price">标准价</th>
            <th scope="col" class="qt-it-price">结算价</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    `;
  }

  function detailPkgList(packages, info) {
    const list = Array.isArray(packages) ? packages : [];
    if (!list.length) {
      const tips = [];
      if (info?.error) tips.push(info.error);
      if (!info?.pkgCodes?.length) tips.push('没换到套餐编码，拉不到套餐');
      return `<div class="qt-kv-empty">${escapeHtml(tips.join('；') || '这一单没有套餐数据')}</div>`;
    }

    return list.map((pkg, i) => {
      const details = Array.isArray(pkg?.details) ? pkg.details : [];
      const settle = Number(pkg?.settlementPrice ?? pkg?.receviceSettlePrice);
      const standard = Number(pkg?.checkPrice);
      const addGroups = Array.isArray(pkg?.addPackageGroupList) ? pkg.addPackageGroupList : [];
      const addNames = [];
      addGroups.forEach((g) => {
        (Array.isArray(g?.addPackageList) ? g.addPackageList : []).forEach((a) => {
          if (a?.addGroupName) addNames.push(String(a.addGroupName));
        });
      });

      const sub = [
        pkg?.payStatusStr ? String(pkg.payStatusStr) : '',
        payTypeText(pkg?.soaPayType),
        details.length ? `${details.length} 个项目` : '',
      ].filter(Boolean).join(' · ');

      return `
        <div class="qt-pkg">
          <div class="qt-pkg-head">
            <span class="qt-pkg-name">套餐 ${i + 1} · ${escapeHtml(String(pkg?.packageName || pkg?.packageAlias || '—'))}</span>
            <span class="qt-pkg-price">
              ${Number.isFinite(settle) ? moneyText(settle) : '—'}
              ${Number.isFinite(standard) && standard !== settle ? `<i>标准 ${moneyText(standard)}</i>` : ''}
            </span>
          </div>
          <div class="qt-pkg-meta">${escapeHtml(sub)}</div>
          ${addNames.length ? `<div class="qt-pkg-add">加项包：${escapeHtml(addNames.join('、'))}</div>` : ''}
          <details class="qt-blanks" open>
            <summary>项目明细 ${details.length} 项</summary>
            ${detailItemsTable(details)}
          </details>
        </div>
      `;
    }).join('');
  }

  function buildDetailHtml(rec, branch) {
    const raw = rec.raw || null;
    const detailRaw = rec.detailRaw || null;
    const statusText = rec.statusText || rec.statusCode || '';
    const subParts = [branch?.merged ? '未到检（全部分院）' : (rec.branchShort || branch?.short || '')];
    if (statusText) subParts.push(statusText);
    const docNo = rec.vid || rec.soaOrderNo || '';
    if (docNo) subParts.push(`单号 ${docNo}`);

    const rawJson = {
      '查询条件': { service: rec.serviceName || '', branchCode: branch?.code || '', keyword: keywordText(state.keyword) },
      '列表记录 query/list': raw,
      '订单主档 soaOrderDetail': rec.orderFull?.order || null,
      '套餐与项目 querySelectedPackages': rec.orderFull?.packages || null,
      '套餐编码来源 beforeQueryOrderDetailInfo': rec.orderFull?.before || null,
      '收费明细 orderDetail': detailRaw,
    };

    // 点开先出骨架，订单/套餐两段异步填 —— 不阻塞浮层弹出
    return `
      <div class="qt-modal-mask" data-role="mask">
        <div class="qt-modal-card" role="dialog" aria-modal="true">
          <div class="qt-modal-head">
            <div>
              <div class="qt-modal-title">${escapeHtml(rec.name || '详情')}</div>
              <div class="qt-modal-sub">${escapeHtml(subParts.filter(Boolean).join(' · '))}</div>
            </div>
            <button type="button" class="qt-modal-x" data-role="close" title="关闭">✕</button>
          </div>
          <div class="qt-modal-body">
            <div class="qt-sec-title">订单信息 · soaOrderDetail<em data-role="order-state"></em></div>
            <div data-role="order-box">${renderOrderBox(rec)}</div>

            <div class="qt-sec-title">套餐与项目 · querySelectedPackages<em data-role="pkg-state"></em></div>
            <div data-role="pkg-box">${renderPkgBox(rec)}</div>

            <div class="qt-sec-title">列表记录 · query/list</div>
            ${raw ? detailKv(raw) : '<div class="qt-kv-empty">这条记录没有原始数据（可能来自缓存）</div>'}

            <div class="qt-sec-title">收费明细 · orderDetail</div>
            ${detailRaw
              ? `${detailKv(detailRaw)}${detailPackages(detailRaw)}`
              : `<div class="qt-kv-empty">${branch?.merged ? '未到检还没有收费记录，接口不返回' : '该单没有返回详情数据'}</div>`}

            <details class="qt-raw">
              <summary>原始 JSON（含查询条件）</summary>
              <pre data-role="raw-json">${escapeHtml(JSON.stringify(rawJson, null, 2))}</pre>
            </details>
          </div>
        </div>
      </div>
    `;
  }

  // 订单段内容：没拉过 = 加载中，拉过 = 结果（含失败原因）
  function renderOrderBox(rec) {
    const full = rec.orderFull;
    if (!full) return '<div class="qt-kv-empty">正在拉订单详情…</div>';
    if (full.pending) return '<div class="qt-kv-empty">正在拉订单详情…</div>';
    return detailOrderCard(full.order, full);
  }

  function renderPkgBox(rec) {
    const full = rec.orderFull;
    if (!full || full.pending) return '<div class="qt-kv-empty">正在拉套餐与项目…</div>';
    return detailPkgList(full.packages, full);
  }

  function keywordText(keyword) {
    if (!keyword) return '';
    return `${keyword.type === 'cert' ? '身份证' : '预约单号'} ${keyword.value}`;
  }

  function closeDetail() {
    const modal = document.getElementById(IDS.modal);
    if (modal) modal.remove();
  }

  function openDetail(key) {
    const rec = state.byKey.get(key);
    if (!rec) return;

    closeDetail();

    const branch = rec.__branch || null;

    const holder = document.createElement('div');
    holder.id = IDS.modal;
    holder.innerHTML = buildDetailHtml(rec, branch);
    document.body.appendChild(holder);

    holder.addEventListener('click', (e) => {
      if (e.target.closest?.('[data-role="close"]') || e.target.dataset?.role === 'mask') closeDetail();
    });

    loadOrderFull(rec, branch);
  }

  /*
   * 订单级详情按需加载：同一条记录只拉一次，失败也记下来（重开不再重复打接口）。
   * 拉完只 patch 两个容器 + 原始 JSON，不重绘整个浮层，免得用户正在看的滚动位置被顶掉。
   */
  /*
   * 订单级详情按需加载。
   * 两个坑都在这儿处理掉了：
   *   ① 同一条记录只拉一次（成功失败都缓存，重开不再打接口）；
   *   ② 「请求还在飞的时候把浮层关掉、再重新点开」—— 如果只用一个 loading 布尔，
   *      第二次点开会因为「已有请求在跑」直接 return，新浮层就永远停在「正在拉」。
   *      所以把第一次的 Promise 存下来，后开的浮层 await 同一个 Promise 再回填。
   */
  async function loadOrderFull(rec, branch) {
    if (!rec.orderFull || rec.orderFull.pending) {
      if (!rec.orderFullPromise) {
        rec.orderFull = { pending: true };
        rec.orderFullPromise = fetchOrderFull(rec, branch)
          .catch((err) => ({ error: String(err?.message || err) }))
          .then((info) => {
            rec.orderFull = info;
            return info;
          });
      }
      await rec.orderFullPromise;
    }

    patchDetailDom(rec, branch);
  }

  // 只回填两个容器 + 原始 JSON，不重绘整个浮层，免得用户正在看的滚动位置被顶掉
  function patchDetailDom(rec, branch) {
    const info = rec.orderFull;
    if (!info || info.pending) return;

    const setState = (role, text) => {
      const el = document.querySelector(`#${IDS.modal} [data-role="${role}"]`);
      if (el) el.textContent = text;
    };

    const orderBox = document.querySelector(`#${IDS.modal} [data-role="order-box"]`);
    if (orderBox) orderBox.innerHTML = detailOrderCard(info.order, info);

    const pkgBox = document.querySelector(`#${IDS.modal} [data-role="pkg-box"]`);
    if (pkgBox) pkgBox.innerHTML = detailPkgList(info.packages, info);

    const rawEl = document.querySelector(`#${IDS.modal} [data-role="raw-json"]`);
    if (rawEl) {
      const rawJson = {
        '查询条件': { service: rec.serviceName || '', branchCode: branch?.code || '', keyword: keywordText(state.keyword) },
        '列表记录 query/list': rec.raw || null,
        '订单主档 soaOrderDetail': info.order || null,
        '套餐与项目 querySelectedPackages': info.packages || null,
        '套餐编码来源 beforeQueryOrderDetailInfo': info.before || null,
        '收费明细 orderDetail': rec.detailRaw || null,
      };
      rawEl.textContent = JSON.stringify(rawJson, null, 2);
    }

    setState('order-state', info.error ? `失败：${info.error}` : '');
    setState('pkg-state', '');
  }

  function refreshQueryButton() {
    const btn = document.getElementById(IDS.query);
    if (!btn) return;
    btn.disabled = state.running;
    btn.textContent = state.running ? '查询中…' : '查询';
  }

  // ============================================================
  // 7. UI
  // ============================================================
  function ensureStyle() {
    const id = `${NS}_style`;
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      #${IDS.switchSlot} {
        display:flex; align-items:center; justify-content:center;
        align-self:stretch; flex:0 0 auto; margin:0;
        padding:0; box-sizing:border-box; position:relative; z-index:2;
      }
      #${IDS.switch} {
        min-width:104px; height:31px; padding:0 13px;
        border:1px solid #7ea6d8; border-radius:7px;
        background:linear-gradient(180deg,#f4f9ff 0%,#dfeaff 100%);
        color:#1e3a8a;
        font:700 14px/29px "Microsoft YaHei","PingFang SC",sans-serif;
        letter-spacing:.1px; cursor:pointer; white-space:nowrap; outline:none;
        box-shadow:0 1px 2px rgba(30,58,138,.10), inset 0 1px 0 rgba(255,255,255,.78);
        transition:background .12s ease, border-color .12s ease, box-shadow .12s ease, transform .08s ease;
      }
      #${IDS.switch}:hover {
        background:linear-gradient(180deg,#eaf3ff 0%,#cfdfff 100%);
        border-color:#5b8ccb;
        box-shadow:0 2px 6px rgba(30,58,138,.16), inset 0 1px 0 rgba(255,255,255,.85);
      }
      #${IDS.switch}:active { transform:translateY(1px); }
      #${IDS.switch}.is-active {
        background:linear-gradient(180deg,#dbe8ff 0%,#c3d7fb 100%);
        border-color:#4b7cbb; color:#17356b;
      }

      /* ---- 共享顶部工具组：槽位外边距统一归零 ----
         红领巾 2026-11-06：组里几个按钮的间距一边宽一边窄。
         实测（真机 CDP 量到的实位）：组 gap=9px，但
           1.7「订单特殊审批」槽位自带 margin-right:150px（它单独挂时用来和原生菜单拉开距离），
           1.6「开始卡类汇总」槽位自带左右各 18px，而 1.5 里那条清零规则的选择器前缀写的是
             __hlj_card_summary_detect_，1.6 实际用的是 __hlj_card_summary_v020_ ⇒ 没命中，
           于是组内间距成了 9 / 9 / 27，右侧明显宽一截。
         这里只在槽位被收进共享工具组时归零外边距，让间距恒等于组自己的 gap；
         组不存在时选择器不生效，各行脚本单独运行的观感一点不改。 */
      #${TOP_TOOL_GROUP_ID} > [id$="_switch_slot"] {
        margin-left:0 !important;
        margin-right:0 !important;
      }

      #${IDS.panel} {
        position:fixed; top:82px; right:24px; z-index:2147483645;
        width:${PANEL_WIDTH_DEFAULT}px; max-width:calc(100vw - 30px);
        max-height:calc(100vh - 105px);
        border:1px solid #d7dee8; border-radius:12px; background:#fff;
        box-shadow:0 14px 38px rgba(15,23,42,.18); overflow:hidden;
        color:#1f2937;
        font:13px/1.6 "Microsoft YaHei UI","Microsoft YaHei","Segoe UI","PingFang SC",Arial,sans-serif;
        text-rendering:optimizeLegibility;
      }
      #${IDS.panel} button { font-family:inherit; }
      #${IDS.panel} .qt-head {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:8px 12px; background:#f8fafc; border-bottom:1px solid #e2e8f0;
        cursor:move; user-select:none;
      }
      #${IDS.panel} .qt-title { font-size:15px; line-height:1.25; font-weight:800; color:#172033; }
      #${IDS.panel} .qt-sub { font-size:10px; line-height:1.25; color:#64748b; margin-top:1px; }
      #${IDS.panel} .qt-head-actions { display:flex; gap:5px; }
      #${IDS.panel} .qt-icon-btn {
        width:27px; height:27px; border:1px solid #cbd5e1; border-radius:7px;
        background:#fff; color:#475569; cursor:pointer; font-weight:800; line-height:1;
      }
      #${IDS.body} { padding:10px 12px 12px; max-height:calc(100vh - 145px); overflow:auto; }
      #${IDS.body}::-webkit-scrollbar { width:8px; height:8px; }
      #${IDS.body}::-webkit-scrollbar-track { background:#f1f5f9; }
      #${IDS.body}::-webkit-scrollbar-thumb { background:#c9d3df; border-radius:4px; }

      #${IDS.panel} .qt-form { display:flex; gap:8px; align-items:flex-end; }
      #${IDS.panel} .qt-input-wrap { display:flex; flex-direction:column; gap:3px; min-width:0; flex:1 1 auto; }
      #${IDS.panel} .qt-input-label { font-size:11px; color:#64748b; }
      #${IDS.panel} input.qt-input {
        height:30px; padding:0 8px; border:1px solid #cbd5e1; border-radius:7px;
        background:#fff; color:#1f2937; font-size:12.5px; outline:none; min-width:0; width:100%;
        box-sizing:border-box;
      }
      #${IDS.panel} input.qt-input:focus { border-color:#7ea6d8; box-shadow:0 0 0 2px rgba(126,166,216,.22); }
      #${IDS.panel} .qt-primary {
        flex:0 0 auto; height:30px; padding:0 14px; border:1px solid #3f6fb0; border-radius:7px;
        background:#4b7cbb; color:#fff; font-size:12px; font-weight:800; cursor:pointer;
        box-shadow:0 1px 3px rgba(63,111,176,.18);
      }
      #${IDS.panel} .qt-primary:disabled { opacity:.55; cursor:not-allowed; box-shadow:none; }
      #${IDS.status} {
        margin-top:8px; padding:7px 10px; border:1px solid #dbe3ed; border-radius:8px;
        background:#f8fafc; color:#475569; font-size:11px;
      }
      #${IDS.panel} .qt-empty {
        margin-top:10px; padding:14px 12px; border:1px dashed #d7dee8; border-radius:9px;
        color:#7b8797; font-size:11.5px; line-height:1.7; background:#fcfdff;
      }

      /* ---- 结果表：一张表，一行一条记录 ---- */
      #${IDS.panel} .qt-table-wrap {
        margin-top:10px; border:1px solid #e6ebf1; border-radius:9px; overflow:auto;
        background:#fff; max-width:100%;
      }
      #${IDS.panel} table.qt-table {
        width:100%; min-width:660px; border-collapse:collapse; table-layout:fixed;
        font-size:11.5px; color:#253247;
      }
      #${IDS.panel} table.qt-table th {
        position:sticky; top:0; z-index:1;
        padding:7px 7px; text-align:left; white-space:nowrap;
        font-size:11px; font-weight:800; color:#475569;
        background:#f4f7fb; border-bottom:1px solid #e2e8f0;
      }
      #${IDS.panel} table.qt-table td {
        padding:6px 7px; border-bottom:1px solid #f0f3f8; vertical-align:middle;
        overflow-wrap:anywhere;
      }
      #${IDS.panel} table.qt-table tbody tr:last-child td { border-bottom:0; }
      #${IDS.panel} table.qt-table tbody tr.qt-row:hover td { background:#fafcff; }
      #${IDS.panel} table.qt-table tfoot td {
        padding:6px 8px; font-size:10.5px; color:#64748b; background:#fafbfd;
        border-top:1px solid #e2e8f0;
      }

      /* 列宽用百分比，面板拉宽拉窄都不会把某列挤爆 */
      #${IDS.panel} .qt-w-branch { width:9%; }
      #${IDS.panel} .qt-w-name   { width:9%; }
      #${IDS.panel} .qt-w-cert   { width:22%; }
      #${IDS.panel} .qt-w-date   { width:12%; }
      #${IDS.panel} .qt-w-money  { width:17%; }
      #${IDS.panel} .qt-w-status { width:12%; }
      #${IDS.panel} .qt-w-vid    { width:19%; }

      #${IDS.panel} .qt-row .qt-c-branch { color:#64748b; white-space:nowrap; }
      #${IDS.panel} .qt-row .qt-c-name { font-weight:800; color:#172033; }
      #${IDS.panel} .qt-row .qt-c-cert,
      #${IDS.panel} .qt-row .qt-c-vid {
        font-variant-numeric:tabular-nums; color:#3d4a5c; white-space:nowrap;
      }
      #${IDS.panel} .qt-row .qt-c-date {
        font-variant-numeric:tabular-nums; color:#3d4a5c; white-space:nowrap;
      }
      #${IDS.panel} .qt-row .qt-c-money {
        font-variant-numeric:tabular-nums; color:#b45309; font-weight:700; white-space:nowrap;
      }
      #${IDS.panel} .qt-row .qt-c-money i {
        display:block; font-style:normal; font-weight:500; font-size:10px; color:#94a3b8; margin-top:1px;
      }
      /* 未预约的记录没有预约单号，第二行给 SOA 订单号（长，超宽截断，全量在 title 里） */
      #${IDS.panel} .qt-row .qt-c-vid i {
        display:block; font-style:normal; font-size:9.5px; color:#94a3b8; margin-top:1px;
        max-width:100%; overflow:hidden; text-overflow:ellipsis;
      }
      #${IDS.panel} .qt-row .qt-c-status { white-space:nowrap; }
      #${IDS.panel} .qt-row .qt-c-status em {
        display:block; font-style:normal; font-size:10px; color:#94a3b8; margin-top:2px;
      }
      #${IDS.panel} .qt-chip {
        display:inline-block; font-size:10px; line-height:15px; padding:0 6px; border-radius:8px;
        background:#eef2f7; color:#475569; border:1px solid #dbe3ed; white-space:nowrap;
      }

      #${IDS.panel} .qt-row-hint td { color:#94a3b8; font-size:11px; padding:7px 8px; }
      #${IDS.panel} .qt-row-hint.is-empty td { color:#a0aabb; }
      #${IDS.panel} .qt-row-hint.is-error td { color:#b91c1c; background:#fffafa; }

      #${IDS.panel} .qt-row-more td { padding:6px 8px; }
      #${IDS.panel} .qt-more {
        width:100%; height:25px; border:1px dashed #c3d0e2; border-radius:6px;
        background:#f8fbff; color:#3f6fb0; font-size:11.5px; font-weight:700; cursor:pointer;
      }
      #${IDS.panel} .qt-more:hover { background:#eff5ff; border-color:#9fb9d9; }
      #${IDS.panel} .qt-row-note td { padding:5px 8px; font-size:10.5px; color:#94a3b8; background:#fcfdff; }

      /* ---- 两块结果的容器（v1.5.0）---- */
      #${IDS.panel} .qt-block {
        margin-top:10px; border:1px solid #e2e8f0; border-radius:10px;
        /* 面板被拖窄时整块横向滚，不能把「详情」列裁掉 */
        overflow:auto; background:#fff;
      }
      #${IDS.panel} .qt-block + .qt-block { margin-top:9px; }
      #${IDS.panel} .qt-block-head {
        display:flex; align-items:center; gap:7px;
        padding:6px 9px; background:#f7f9fc; border-bottom:1px solid #e6ebf1;
      }
      #${IDS.panel} .qt-block-title {
        display:flex; align-items:center; gap:5px;
        font-size:12px; font-weight:800; color:#1f2937;
      }
      #${IDS.panel} .qt-block-tag {
        font-size:10px; color:#64748b; background:#eef2f7; border:1px solid #e2e8f0;
        border-radius:8px; padding:0 6px; line-height:15px; white-space:nowrap;
      }
      #${IDS.panel} .qt-block-meta { margin-left:auto; font-size:10.5px; color:#64748b; white-space:nowrap; }
      #${IDS.panel} .qt-block-foot {
        padding:5px 9px; border-top:1px solid #eef2f7; background:#fafbfd;
        font-size:10.5px; color:#64748b;
      }
      #${IDS.panel} .qt-legend {
        display:flex; align-items:center; gap:8px; margin-left:4px;
        font-size:10.5px; color:#5b6675;
      }
      #${IDS.panel} .qt-legend i { margin-right:3px; vertical-align:middle; }
      #${IDS.panel} .qt-dot {
        display:inline-block; width:8px; height:8px; border-radius:3px; background:#cbd5e1;
      }

      /* 未到检那块：中性灰蓝，别跟分院的低色混淆 */
      #${IDS.panel} .qt-block-notyet { border-color:#dfe6f1; }
      #${IDS.panel} .qt-block-notyet .qt-block-head { background:#f4f7fc; }
      #${IDS.panel} .qt-dot-notyet { background:#7c8db5; }
      #${IDS.panel} .qt-block-branch .qt-block-head { background:#f8fafc; }

      /* ---- 分院底色：一院一色（红领巾 2026-11-07）---- */
      #${IDS.panel} .qt-dot.is-br-x7 { background:#3fa06c; }
      #${IDS.panel} .qt-dot.is-br-x1 { background:#3f77c4; }
      #${IDS.panel} .qt-dot.is-br-fc { background:#c08a2e; }

      #${IDS.panel} table.qt-table tr.qt-row.is-br-x7 td { background:#edf9f1; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x1 td { background:#eef4fe; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-fc td { background:#fff6e3; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x7:hover td { background:#e1f4e8; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x1:hover td { background:#e3ecfc; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-fc:hover td { background:#fdeecf; }
      /* 首列加一道竖色条，颜色对比不明显时也能分清 */
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x7 .qt-c-branch { box-shadow:inset 3px 0 0 #3fa06c; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x1 .qt-c-branch { box-shadow:inset 3px 0 0 #3f77c4; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-fc .qt-c-branch { box-shadow:inset 3px 0 0 #c08a2e; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x7 .qt-c-branch { color:#2f7a55; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-x1 .qt-c-branch { color:#2f5f9e; }
      #${IDS.panel} table.qt-table tr.qt-row.is-br-fc .qt-c-branch { color:#8a6320; }
      #${IDS.panel} table.qt-table tr.qt-row.qt-row-notyet td { background:#fcfdff; }

      /* 详情按钮 */
      #${IDS.panel} .qt-detail {
        height:20px; padding:0 7px; border:1px solid #cbd5e1; border-radius:6px;
        background:#fff; color:#3f6fb0; font-size:10.5px; font-weight:700; cursor:pointer;
        line-height:18px;
      }
      #${IDS.panel} .qt-detail:hover { background:#eff5ff; border-color:#9fb9d9; }

      /* 列宽：分院表 8 列 / 未到检表 6 列 */
      #${IDS.panel} .qt-w-branch { width:8%; }
      #${IDS.panel} .qt-w-name   { width:9%; }
      #${IDS.panel} .qt-w-cert   { width:19%; }
      #${IDS.panel} .qt-w-date   { width:11%; }
      #${IDS.panel} .qt-w-money  { width:15%; }
      #${IDS.panel} .qt-w-status { width:11%; }
      #${IDS.panel} .qt-w-vid    { width:18%; }
      #${IDS.panel} .qt-w-act    { width:9%; }
      #${IDS.panel} table.qt-table-notyet { min-width:620px; }
      #${IDS.panel} .qt-wy-name   { width:9%; }
      #${IDS.panel} .qt-wy-cert   { width:23%; }
      #${IDS.panel} .qt-wy-date   { width:11%; }
      #${IDS.panel} .qt-wy-money  { width:14%; }
      #${IDS.panel} .qt-wy-status { width:11%; }
      #${IDS.panel} .qt-wy-doc    { width:23%; }
      #${IDS.panel} .qt-wy-act    { width:9%; }
      #${IDS.panel} .qt-row .qt-c-act { text-align:right; white-space:nowrap; }

      /* ---- 详情浮层 ---- */
      #${IDS.modal} { position:fixed; inset:0; z-index:2147483646; }
      #${IDS.modal} .qt-modal-mask {
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        background:rgba(15,23,42,.42); padding:24px;
      }
      #${IDS.modal} .qt-modal-card {
        width:min(760px, 100%); max-height:84vh; display:flex; flex-direction:column;
        background:#fff; border-radius:12px; box-shadow:0 24px 60px rgba(15,23,42,.32);
        overflow:hidden; color:#1f2937;
        font:12.5px/1.6 "Microsoft YaHei UI","Microsoft YaHei","Segoe UI","PingFang SC",Arial,sans-serif;
      }
      #${IDS.modal} .qt-modal-head {
        display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
        padding:11px 13px; background:#f8fafc; border-bottom:1px solid #e2e8f0;
      }
      #${IDS.modal} .qt-modal-title { font-size:15px; font-weight:800; color:#172033; }
      #${IDS.modal} .qt-modal-sub { font-size:11px; color:#64748b; margin-top:2px; }
      #${IDS.modal} .qt-modal-x {
        width:26px; height:26px; flex:0 0 auto; border:1px solid #cbd5e1; border-radius:7px;
        background:#fff; color:#475569; font-weight:800; line-height:1; cursor:pointer;
      }
      #${IDS.modal} .qt-modal-body { padding:11px 13px 15px; overflow:auto; }
      #${IDS.modal} .qt-sec-title {
        margin:12px 0 6px; font-size:11.5px; font-weight:800; color:#334155;
        padding-left:7px; border-left:3px solid #7ea6d8;
      }
      #${IDS.modal} .qt-sec-title:first-child { margin-top:2px; }
      #${IDS.modal} .qt-kv {
        display:grid; grid-template-columns:132px minmax(0,1fr);
        border:1px solid #eef2f7; border-radius:8px; overflow:hidden;
      }
      #${IDS.modal} .qt-kv-k {
        padding:4px 8px; background:#f8fafc; color:#64748b; font-size:10.5px;
        border-bottom:1px solid #f1f5f9; word-break:break-word; line-height:1.45;
      }
      #${IDS.modal} .qt-kv-v {
        padding:4px 8px; font-size:11.5px; color:#1f2937; border-bottom:1px solid #f1f5f9;
        word-break:break-all; font-variant-numeric:tabular-nums;
      }
      #${IDS.modal} .qt-kv-v.is-blank { color:#cbd5e1; }
      #${IDS.modal} .qt-kv > div:nth-last-child(-n+2) { border-bottom:0; }
      #${IDS.modal} .qt-blanks { margin-top:7px; }
      #${IDS.modal} .qt-blanks > summary {
        cursor:pointer; font-size:10.5px; color:#94a3b8; outline:none; margin-bottom:5px;
      }
      #${IDS.modal} .qt-blanks > summary:hover { color:#64748b; }
      #${IDS.modal} .qt-kv-empty {
        padding:9px 10px; border:1px dashed #e2e8f0; border-radius:8px;
        color:#94a3b8; font-size:11px; background:#fcfdff;
      }
      #${IDS.modal} .qt-pkg { margin-top:8px; }
      #${IDS.modal} .qt-pkg-head {
        font-size:11px; font-weight:800; color:#475569; margin-bottom:5px;
      }
      #${IDS.modal} .qt-sec-title em {
        font-style:normal; font-weight:600; font-size:10px; color:#94a3b8; margin-left:6px;
      }

      /* ---- v1.6.0 订单信息：上面一屏看结论，下面折叠摊全字段 ---- */
      #${IDS.modal} .qt-order-hero {
        border:1px solid #dbe6f5; border-radius:9px;
        background:linear-gradient(180deg,#f7fbff 0%,#eff5fd 100%);
        padding:9px 11px;
      }
      #${IDS.modal} .qt-order-name {
        font-size:13.5px; font-weight:800; color:#172033; line-height:1.35; word-break:break-word;
      }
      #${IDS.modal} .qt-order-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
      #${IDS.modal} .qt-tag {
        padding:1px 8px; border-radius:999px; font-size:10.5px; font-weight:700;
        background:#eef2f7; color:#475569; border:1px solid #dde5ee;
        font-variant-numeric:tabular-nums;
      }
      #${IDS.modal} .qt-tag.is-nation { background:#fff2e6; color:#b45309; border-color:#fbd9b5; }
      #${IDS.modal} .qt-tag.is-local  { background:#edf8f1; color:#15803d; border-color:#c8e6d1; }
      #${IDS.modal} .qt-tag.is-money  { background:#eef2ff; color:#3730a3; border-color:#d5d9fb; }

      #${IDS.modal} .qt-order-grid {
        display:grid; grid-template-columns:62px minmax(0,1fr);
        margin-top:7px; border:1px solid #eef2f7; border-radius:8px; overflow:hidden;
      }
      #${IDS.modal} .qt-og-k {
        padding:4px 8px; background:#f8fafc; color:#64748b; font-size:10.5px;
        border-bottom:1px solid #f1f5f9; line-height:1.45;
      }
      #${IDS.modal} .qt-og-v {
        padding:4px 8px; font-size:11.5px; color:#1f2937; border-bottom:1px solid #f1f5f9;
        word-break:break-word; line-height:1.45;
      }
      #${IDS.modal} .qt-order-grid > div:nth-last-child(-n+2) { border-bottom:0; }
      #${IDS.modal} .qt-order-remark {
        margin-top:7px; padding:6px 9px; border-left:3px solid #f0b34a;
        background:#fffdf5; color:#8a5a00; font-size:11px; line-height:1.55;
        border-radius:0 7px 7px 0; white-space:pre-wrap; word-break:break-word;
      }

      /* ---- 套餐与项目 ---- */
      #${IDS.modal} .qt-pkg {
        margin-top:9px; padding:8px 10px; background:#fcfdff;
        border:1px solid #eef2f7; border-radius:9px;
      }
      #${IDS.modal} .qt-pkg-head {
        display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:0;
      }
      #${IDS.modal} .qt-pkg-name { font-size:11.5px; font-weight:800; color:#334155; word-break:break-word; }
      #${IDS.modal} .qt-pkg-price {
        flex:0 0 auto; font-size:12px; font-weight:800; color:#b45309;
        font-variant-numeric:tabular-nums; white-space:nowrap;
      }
      #${IDS.modal} .qt-pkg-price i { font-style:normal; font-weight:600; font-size:10px; color:#94a3b8; margin-left:4px; }
      #${IDS.modal} .qt-pkg-meta { margin-top:3px; font-size:10.5px; color:#64748b; }
      #${IDS.modal} .qt-pkg-add  { margin-top:3px; font-size:10.5px; color:#7c5a12; }

      #${IDS.modal} .qt-items-scroll {
        max-height:300px; overflow:auto; margin-top:5px;
        /* 预留滚动条位置，别让它压住「结算价」那一列 */
        scrollbar-gutter:stable;
        border:1px solid #eef2f7; border-radius:7px;
      }
      #${IDS.modal} .qt-item-table {
        width:100%; border-collapse:collapse; table-layout:fixed;
        border:0;
      }
      #${IDS.modal} .qt-item-table thead th {
        position:sticky; top:0; z-index:1;
      }
      #${IDS.modal} .qt-item-table th {
        padding:3px 6px; background:#f8fafc; color:#64748b; font-size:10px; font-weight:700;
        text-align:left; border-bottom:1px solid #eef2f7;
      }
      #${IDS.modal} .qt-item-table td {
        padding:3px 6px; font-size:10.5px; color:#1f2937; border-bottom:1px solid #f5f8fb;
        word-break:break-word; line-height:1.4;
      }
      #${IDS.modal} .qt-item-table tr:last-child td { border-bottom:0; }
      #${IDS.modal} .qt-item-table .qt-it-name  { width:35%; }
      #${IDS.modal} .qt-item-table .qt-it-goods { width:33%; }
      #${IDS.modal} .qt-item-table td.qt-it-goods { color:#64748b; }
      #${IDS.modal} .qt-item-table .qt-it-price {
        width:16%; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;
      }

      #${IDS.modal} .qt-raw { margin-top:13px; }
      #${IDS.modal} .qt-raw > summary {
        cursor:pointer; font-size:11px; font-weight:700; color:#3f6fb0; outline:none;
      }
      #${IDS.modal} .qt-raw pre {
        margin-top:6px; padding:9px 10px; max-height:280px; overflow:auto;
        background:#0f172a; color:#dbe6f5; border-radius:8px; font-size:10.5px; line-height:1.5;
        white-space:pre-wrap; word-break:break-all;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureSwitch() {
    if (!isAllowedRoute()) return;

    const headerInner = document.querySelector('#layout-header .header-inner');
    if (!headerInner) return;

    let slot = document.getElementById(IDS.switchSlot);
    let btn = document.getElementById(IDS.switch);

    if (!slot) {
      slot = document.createElement('div');
      slot.id = IDS.switchSlot;
    }

    if (!btn) {
      btn = document.createElement('button');
      btn.id = IDS.switch;
      btn.type = 'button';
      btn.textContent = '前台预约查询';
      btn.title = '填预约单号或身份证号，自动识别，查三个分院的前台预约记录';

      ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((evt) => {
        btn.addEventListener(evt, (e) => e.stopPropagation());
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      });
    }

    if (btn.parentElement !== slot) slot.appendChild(btn);

    const group = document.getElementById(TOP_TOOL_GROUP_ID);

    if (group) {
      // 组可能比本脚本晚建（1.5/1.7 建的）：不在组里就收编进来，再归位
      if (slot.parentElement !== group) group.appendChild(slot);
      repositionSwitch();
      return;
    }

    // 组还没出现：先挂在 header-inner 的 .user 前面，等组建好再被收编
    if (slot.parentElement !== headerInner) {
      const userBox = headerInner.querySelector(':scope > .user');
      if (userBox) headerInner.insertBefore(slot, userBox);
      else headerInner.appendChild(slot);
    }
  }

  // 按 id / 文案找一个工具组的 slot
  function findGroupSlot(ids, text) {
    const group = document.getElementById(TOP_TOOL_GROUP_ID);
    if (!group) return null;
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.parentElement === group) return el;
    }
    return (
      [...group.children].find((el) => {
        if (el.id === IDS.switchSlot) return false;
        return (el.innerText || '').replace(/\s+/g, '').includes(text);
      }) || null
    );
  }

  /*
   * 归位：紧跟「订单特殊审批(1.7)」的 slot 之后。
   * 找不到 1.7 时退到「报表工具(1.5)」之前，再不行就追加到末尾。
   * 幂等：位置对就直接返回，不动 DOM（否则会自己触发 MutationObserver 空转）。
   */
  function repositionSwitch() {
    const group = document.getElementById(TOP_TOOL_GROUP_ID);
    const slot = document.getElementById(IDS.switchSlot);
    if (!group || !slot || slot.parentElement !== group) return false;

    const approval = findGroupSlot(APPROVAL_SLOT_IDS, APPROVAL_TEXT);
    if (approval) {
      if (approval.nextElementSibling !== slot) {
        approval.insertAdjacentElement('afterend', slot);
      }
      return true;
    }

    const report = findGroupSlot(REPORT_SLOT_IDS, REPORT_TEXT);
    if (report) {
      if (report.previousElementSibling !== slot) {
        group.insertBefore(slot, report);
      }
      return true;
    }

    if (group.lastElementChild !== slot) group.appendChild(slot);
    return true;
  }

  function createPanel() {
    let panel = document.getElementById(IDS.panel);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = IDS.panel;
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="qt-head" data-drag-handle="1">
        <div>
          <div class="qt-title">前台预约查询 <span style="font-size:10px;color:#64748b;">v${SCRIPT_VERSION}</span></div>
          <div class="qt-sub">玫瑰园 → 宝龙 → 长垣 · 已到检 / 未到检 / 已取消</div>
        </div>
        <div class="qt-head-actions">
          <button id="${IDS.close}" class="qt-icon-btn" type="button" title="关闭">×</button>
        </div>
      </div>
      <div id="${IDS.body}">
        <div class="qt-form">
          <div class="qt-input-wrap">
            <span class="qt-input-label">预约单号 / 身份证号（填一个即可，自动识别）</span>
            <input id="${IDS.input}" class="qt-input" type="text" autocomplete="off" spellcheck="false" placeholder="14 位预约单号，或 18 位身份证号" />
          </div>
          <button id="${IDS.query}" class="qt-primary" type="button">查询</button>
        </div>
        <div id="${IDS.status}" style="display:none;"></div>
        <div id="${IDS.result}"></div>
      </div>
    `;
    document.body.appendChild(panel);

    applyPanelWidth(panel, readPanelWidth());
    restorePanelPosition(panel);
    installDrag(panel);

    document.getElementById(IDS.close).addEventListener('click', () => setPanelVisible(false));
    document.getElementById(IDS.query).addEventListener('click', runQuery);

    const inputEl = document.getElementById(IDS.input);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runQuery();
      }
    });
    // 输完自动去空格，并提示识别结果
    inputEl.addEventListener('input', () => {
      if (state.running) return; // 查询中别抢状态栏
      const parsed = parseKeyword(inputEl.value);
      if (!inputEl.value.trim()) {
        setStatus('填预约单号或身份证号，填一个就能查', 'normal');
        return;
      }
      if (parsed.error) {
        setStatus(parsed.error, 'error');
        return;
      }
      setStatus(`将按${keywordName(parsed)}「${parsed.value}」查询`, 'normal');
    });

    // 结果区整块重绘，按钮用事件委托，不用重新绑定
    document.getElementById(IDS.result).addEventListener('click', async (e) => {
      // B. 打开详情浮层
      const detailBtn = e.target.closest?.('.qt-detail');
      if (detailBtn) {
        e.preventDefault();
        e.stopPropagation();
        openDetail(detailBtn.dataset.key || '');
        return;
      }

      // A. 展开 / 收起某个分院的全部记录
      const more = e.target.closest?.('.qt-more');
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        const code = more.dataset.branch || '';
        if (!code) return;
        if (state.expanded[code]) delete state.expanded[code];
        else state.expanded[code] = true;
        renderResults();
        return;
      }
    });

    // ESC：详情浮层开着就先关浮层，再按一次才轮得到面板
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.getElementById(IDS.modal)) {
        e.stopPropagation();
        closeDetail();
      }
    }, true);

    renderResults();
    return panel;
  }

  function setPanelVisible(visible) {
    const panel = createPanel();
    panel.style.display = visible ? 'block' : 'none';
    const btn = document.getElementById(IDS.switch);
    if (btn) {
      btn.classList.toggle('is-active', visible);
      btn.textContent = visible ? '收起前台查询' : '前台预约查询';
    }
    if (visible) {
      ensurePanelInViewport(panel);
      document.getElementById(IDS.input)?.focus();
    }
  }

  function togglePanel() {
    const panel = document.getElementById(IDS.panel);
    const open = !panel || panel.style.display === 'none' || !panel.style.display;
    setPanelVisible(open);
  }

  function ensurePanelInViewport(panel) {
    const rect = panel.getBoundingClientRect();
    if (rect.top < 0) panel.style.top = '8px';
    if (rect.left < 0) panel.style.left = '8px';
    if (rect.right > window.innerWidth) {
      panel.style.left = 'auto';
      panel.style.right = '12px';
    }
  }

  // ---- 面板位置 / 宽度记忆 ----
  function readPanelWidth() {
    const raw = Number(GM_getValue(PANEL_WIDTH_KEY, PANEL_WIDTH_DEFAULT));
    if (!Number.isFinite(raw)) return PANEL_WIDTH_DEFAULT;
    return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(raw)));
  }

  function applyPanelWidth(panel, width) {
    panel.style.width = `${Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width))}px`;
  }

  function savePanelPos(panel) {
    const rect = panel.getBoundingClientRect();
    GM_setValue(PANEL_POS_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
  }

  function restorePanelPosition(panel) {
    const raw = GM_getValue(PANEL_POS_KEY, '');
    if (!raw) return;
    let pos = null;
    try {
      pos = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      return;
    }
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;

    const maxLeft = Math.max(0, window.innerWidth - 120);
    const maxTop = Math.max(0, window.innerHeight - 80);
    panel.style.left = `${Math.min(Math.max(0, pos.left), maxLeft)}px`;
    panel.style.top = `${Math.min(Math.max(0, pos.top), maxTop)}px`;
    panel.style.right = 'auto';
  }

  function installDrag(panel) {
    const handle = panel.querySelector('[data-drag-handle="1"]');
    if (!handle) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nextLeft = Math.min(Math.max(0, originLeft + (e.clientX - startX)), window.innerWidth - 80);
      const nextTop = Math.min(Math.max(0, originTop + (e.clientY - startY)), window.innerHeight - 60);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    handle.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      savePanelPos(panel);
    });
  }

  // ============================================================
  // 8. 启动
  // ============================================================
  function boot() {
    if (window[NS]) return;
    window[NS] = true;

    ensureStyle();
    ensureSwitch();
    createPanel();

    // SOA 是 SPA，顶部 header 会被 React 反复重建
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        ensureSwitch();
      });
    };

    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', schedule, true);

    // React 首屏 / 1.5 的工具组都可能晚于 document-idle；
    // 一直补到「slot 已经进了工具组」为止（最多 10 秒），之后收手
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      ensureSwitch();
      const slot = document.getElementById(IDS.switchSlot);
      const group = document.getElementById(TOP_TOOL_GROUP_ID);
      const settled = slot && group && slot.parentElement === group;
      if (settled || attempts >= 40) clearInterval(timer);
    }, 250);
  }

  boot();
})();
