// ==UserScript==
// @name         扁鹊-1.10前台预约查询
// @namespace    https://tampermonkey.net/
// @version      1.3.1
// @description  在 SOA 顶部工具组加一个「前台预约查询」入口：一个输入框，自动识别填的是预约单号还是身份证号，按玫瑰园 → 宝龙 → 长垣 依次查前台登记页的三个页签（已到检 / 未到检 / 已取消），结果按表格（分院/姓名/证件号/体检日期/金额/状态/预约单号）逐行汇总。
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
 * 三个页签对应 appointmentStatus（实测 order 服务）：
 *   已到检   CHECKED
 *   未到检   APPOINTMENT_FINISH（已排期）＋ TO_APPOINTMENT（未排期，无预约单号）
 *   已取消   CANCEL
 *   ⇒ 一次查询直接传数组，服务端按「或」过滤（实测 CHECKED / CANCEL / APPOINTMENT_FINISH 都能命中），
 *     不用为每个页签发一遍请求。
 *
 * 单输入框自动识别（红领巾 2026-11-06 改）：
 *   14 位纯数字 ⇒ 预约单号，请求体走 req.vid
 *   15~18 位、末位可为 X ⇒ 身份证号，请求体走 req.certificateNumber
 *   实测（2026-11-06）：req.certificateNumber 是前台列表接口认的字段，
 *     传 411329198104102523 在 X1 命中 1 条；传不认识的键（certNo）会被忽略 ⇒ 返回全量，
 *     所以字段名必须写死证书号这一个，不能拼错。
 *
 * 结果展示（红领巾 2026-11-06 第二次改）：
 *   早期是一院一块卡片，记录一多就成一条长卷轴，看着散。
 *   现在统一成**一张表**：分院 / 姓名 / 证件号 / 体检日期 / 金额 / 状态 / 预约单号，
 *   三个分院的结果按查询顺序排进同一张表，一院一个「未查到 / 查询中 / 失败」行；
 *   单院超过 RECORD_PREVIEW_COUNT 条时，表内给一行「展开全部 N 条」。
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
  };

  // 与 1.5 / 1.6 / 1.7 共用的 SOA 顶部工具组
  const TOP_TOOL_GROUP_ID = '__hlj_soa_top_tool_group_v1';
  // 排在「订单特殊审批(1.7)」右边：slot 就用它当锚点
  const APPROVAL_SLOT_IDS = ['__hlj_ia_combo_v200_switch_slot'];
  const APPROVAL_TEXT = '订单特殊审批';
  const REPORT_SLOT_IDS = ['__hlj_fly_report_switch_slot_v113'];
  const REPORT_TEXT = '报表工具';
  const HOST_SOA = 'checkup-soa3.health-100.cn';

  const SCRIPT_VERSION = '1.3.1';

  // 前台（登记）站点
  const QT_ORIGIN = 'https://checkup-register.health-100.cn';
  const QT_LIST_API = `${QT_ORIGIN}/checkup-hc/api/checkin/query/list`;
  const QT_DETAIL_API = `${QT_ORIGIN}/checkup-hc/api/checkin/query/v2/orderDetail`;

  const QT_CLIENT_ID = 'MN_REGISTER';
  // 前台前端包里 getSignHeader 的第二个入参（写死在前端 chunk 里，不是密钥）
  const QT_SECRET = 'p2otita0dxrpcge6iictqu9vwyj1vn8puv315blxxzmvcpyyakskh713t2c1f57i';

  // 三个页签的状态（数组 = 服务端「或」过滤，实测有效）
  const QT_STATUS_ALL = ['TO_APPOINTMENT', 'APPOINTMENT_FINISH', 'CHECKED', 'CANCEL'];
  const QT_SERVICE = 'order';

  // 查询顺序：玫瑰园 → 宝龙 → 长垣（红领巾 2026-11-06 指定）
  const BRANCHES = [
    { code: 'X7', name: '新乡玫瑰园分院', short: '玫瑰园' },
    { code: 'X1', name: '新乡宝龙分院', short: '宝龙' },
    { code: 'FC', name: '长垣分院', short: '长垣' },
  ];

  const STATUS_TEXT = {
    CHECKED: '已到检',
    APPOINTMENT_FINISH: '已预约未到检',
    TO_APPOINTMENT: '待预约',
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
  // 4. 单院查询
  // ============================================================
  /*
   * 一个分院一次请求搞定三个页签：
   *   serviceName = 'order'
   *   req.appointmentStatus = [TO_APPOINTMENT, APPOINTMENT_FINISH, CHECKED, CANCEL]
   *   req.vid                  = 预约单号         （输入的是 14 位单号时）
   *   req.certificateNumber    = 身份证号         （输入的是身份证时）
   * 实测（2026-11-06，真实登录态）：
   *   - 传数组时服务端按「或」过滤，已到检 / 已取消 / 已预约都能命中；
   *   - branch-code 头 + req.branchCode 双管齐下，跨院不会串（同一 vid 在 X7/FC 查回 0 条）；
   *   - req.certificateNumber 有效：同一个身份证在 X1 命中、X7/FC 回 0 条；
   *   - 未到检里的「待预约」记录没有 vid 也没有体检日期，按预约单号本来就查不到，属正常。
   */
  async function queryBranch(branch, keyword) {
    const headers = await buildQtHeaders(branch.code);
    const req = {
      branchCode: branch.code,
      appointmentStatus: QT_STATUS_ALL.slice(),
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
      serviceName: QT_SERVICE,
    };

    const json = await gmPost(QT_LIST_API, body, headers);
    const data = (json && json.data) || {};
    const items = Array.isArray(data.content) ? data.content : [];
    // 服务端总数：一页装不下时（按身份证查常见）用于提示「只显示前 N 条」
    const total = Number(data.totalSize ?? data.totalElements ?? items.length);
    const records = items.map((item) => ({
      vid: String(item.vid || ''),
      name: String(item.name || ''),
      certMasked: String(item.certificateNumber || item.notSecretCertificateNumber || ''),
      apptDate: String(item.appointmentDate || ''),
      statusCode: String(item.serviceOrderStatusCode || ''),
      statusText: STATUS_TEXT[item.serviceOrderStatusCode] || String(item.serviceOrderStatus || ''),
      branchName: String(item.branchName || item.appointBranchName || branch.name),
      soaOrderNo: String(item.soaOrderNo || ''),
      packageName: String(item.packageName || ''),
    }));
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
    };
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
    state.results = BRANCHES.map((branch) => ({ branch, status: 'pending', records: [], total: 0, error: '' }));
    renderResults();

    try {
      for (let i = 0; i < BRANCHES.length; i += 1) {
        const branch = BRANCHES[i];
        const slot = state.results[i];
        setStatus(`正在按${keywordName(keyword)}查 ${branch.short} 分院（${i + 1}/${BRANCHES.length}）…`, 'running');

        try {
          const res = await queryBranch(branch, keyword);
          const list = res.records;
          slot.total = res.total;
          if (!list.length) {
            slot.status = 'empty';
          } else {
            for (const rec of list) {
              if (!rec.vid) continue;
              rec.detail = await fetchDetail(branch.code, rec.vid).catch(() => null);
              if (rec.detail?.apptDate) rec.apptDate = rec.detail.apptDate;
              if (rec.detail?.certFull) rec.certFull = rec.detail.certFull;
              if (rec.detail?.customerName) rec.name = rec.detail.customerName;
            }
            slot.status = 'ok';
            slot.records = list;
          }
        } catch (err) {
          slot.status = 'error';
          slot.error = String(err?.message || err);
        }

        renderResults();
        if (i < BRANCHES.length - 1) await sleep(BRANCH_GAP_MS);
      }

      const hitBranches = state.results.filter((x) => x.status === 'ok').length;
      const hitRecords = state.results.reduce((sum, x) => sum + x.records.length, 0);
      const failed = state.results.filter((x) => x.status === 'error').length;

      if (failed) {
        setStatus(`查询完成：${hitRecords} 条记录，${failed} 个分院查询失败（见下方）。${nowText()}`, 'error');
      } else {
        setStatus(
          hitRecords
            ? `查询完成：${hitBranches} 个分院命中，共 ${hitRecords} 条记录。${nowText()}`
            : `三个分院都未查到该${keywordName(keyword)}。`,
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
  function moneyText(value) {
    return Number.isFinite(value) ? `¥${Number(value).toFixed(2)}` : '—';
  }

  // 表格列（顺序即显示顺序）：分院 / 姓名 / 证件号 / 体检日期 / 金额 / 状态 / 预约单号
  const TABLE_COLS = 7;

  /*
   * 表格里的状态用短名：列宽有限，「已预约未到检」会把单元格挤成两行。
   * 完整说法放 title，鼠标悬停能看到。
   */
  const STATUS_SHORT = {
    CHECKED: '已到检',
    APPOINTMENT_FINISH: '未到检',
    TO_APPOINTMENT: '待预约',
    CANCEL: '已取消',
  };

  // 一行数据
  function renderRow(rec, branch) {
    const detail = rec.detail || null;
    const certText = rec.certFull || rec.certMasked || '—';
    const settle = detail ? detail.settle : null;
    const standard = detail ? detail.standard : null;

    // 金额格第二行只放标准价；支付状态挪到状态格里，免得两个长串挤在一格
    const standardSub = Number.isFinite(standard) && standard !== settle
      ? `<i>标准 ${moneyText(standard)}</i>`
      : '';
    const statusText = rec.statusText || rec.statusCode || '—';
    const statusShort = STATUS_SHORT[rec.statusCode] || statusText;

    return `
      <tr class="qt-row">
        <td class="qt-c-branch">${escapeHtml(branch.short)}</td>
        <td class="qt-c-name" title="${escapeHtml(rec.name || '')}">${escapeHtml(rec.name || '—')}</td>
        <td class="qt-c-cert" title="${escapeHtml(certText)}">${escapeHtml(certText || '—')}</td>
        <td class="qt-c-date">${escapeHtml(rec.apptDate || '—')}</td>
        <td class="qt-c-money">${moneyText(settle)}${standardSub}</td>
        <td class="qt-c-status" title="${escapeHtml(statusText)}">
          <span class="qt-chip">${escapeHtml(statusShort)}</span>
          ${detail?.payStatus ? `<em>${escapeHtml(detail.payStatus)}</em>` : ''}
        </td>
        <td class="qt-c-vid">${escapeHtml(rec.vid || '—')}</td>
      </tr>
    `;
  }

  // 一个分院的占位行（查询中 / 未查到 / 失败）
  function renderHintRow(branch, text, tone) {
    return `
      <tr class="qt-row-hint${tone ? ` is-${tone}` : ''}">
        <td class="qt-c-branch">${escapeHtml(branch.short)}</td>
        <td colspan="${TABLE_COLS - 1}">${escapeHtml(text)}</td>
      </tr>
    `;
  }

  function renderResults() {
    const box = document.getElementById(IDS.result);
    if (!box) return;

    if (!state.results) {
      box.innerHTML = `
        <div class="qt-empty">
          填预约单号（14 位）或身份证号（18 位），点「查询」会依次查
          ${BRANCHES.map((b) => escapeHtml(b.short)).join(' → ')} 三个分院，
          每个分院都把已到检 / 未到检 / 已取消三个页签一起查。
        </div>
      `;
      return;
    }

    const rows = [];
    let hitRecords = 0;
    let doneBranches = 0;

    for (const slot of state.results) {
      const branch = slot.branch;

      if (slot.status === 'pending') {
        rows.push(renderHintRow(branch, '查询中…', ''));
        continue;
      }
      if (slot.status === 'empty') {
        rows.push(renderHintRow(branch, '未查到', 'empty'));
        continue;
      }
      if (slot.status === 'error') {
        rows.push(renderHintRow(branch, `查询失败：${slot.error}`, 'error'));
        continue;
      }

      doneBranches += 1;
      const all = slot.records;
      hitRecords += all.length;

      const expanded = !!state.expanded[branch.code];
      const shown = expanded ? all : all.slice(0, RECORD_PREVIEW_COUNT);
      rows.push(shown.map((rec) => renderRow(rec, branch)).join(''));

      if (all.length > RECORD_PREVIEW_COUNT) {
        rows.push(`
          <tr class="qt-row-more">
            <td colspan="${TABLE_COLS}">
              <button type="button" class="qt-more" data-branch="${escapeHtml(branch.code)}">
                ${expanded ? '收起' : `展开全部 ${all.length} 条`}
              </button>
            </td>
          </tr>
        `);
      }

      // 一页装不下时说清楚，不假装是全部
      if (slot.total > all.length) {
        rows.push(`
          <tr class="qt-row-note">
            <td colspan="${TABLE_COLS}">${escapeHtml(branch.short)}：接口共 ${slot.total} 条，本次只取了前 ${all.length} 条</td>
          </tr>
        `);
      }
    }

    const allDone = doneBranches === BRANCHES.length;

    box.innerHTML = `
      <div class="qt-table-wrap">
        <table class="qt-table">
          <colgroup>
            <col class="qt-w-branch" />
            <col class="qt-w-name" />
            <col class="qt-w-cert" />
            <col class="qt-w-date" />
            <col class="qt-w-money" />
            <col class="qt-w-status" />
            <col class="qt-w-vid" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">分院</th>
              <th scope="col">姓名</th>
              <th scope="col">证件号</th>
              <th scope="col">体检日期</th>
              <th scope="col">金额</th>
              <th scope="col">状态</th>
              <th scope="col">预约单号</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
          ${allDone ? `
          <tfoot>
            <tr>
              <td colspan="${TABLE_COLS}">
                已查 ${doneBranches} 个分院 · 共命中 ${hitRecords} 条
              </td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    `;
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
        width:100%; min-width:640px; border-collapse:collapse; table-layout:fixed;
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
