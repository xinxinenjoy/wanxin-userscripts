// ==UserScript==
// @name         扁鹊-1.7订单特殊审批
// @namespace    https://tampermonkey.net/
// @version      2.2.1
// @description  SOA特殊审批开关：一键在「特殊审批 开」（业务员报价后不可修改订单=勾选 + 检中修改钉钉审批=不启用）与「特殊审批 关」（反之，已恢复正常）之间切换。直接发请求、不跳转页面、不弹确认框，切完自动回读校验。
// @match        https://checkup-soa3.health-100.cn/*
// @match        https://app-fly.health-100.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-neiqinshenpi
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-neiqinshenpi.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-neiqinshenpi.user.js
// ==/UserScript==

/*
 * SOA 特殊审批开关
 *
 * 一个开关管两项配置，成对切换（术语按红领巾 2026-09-16 的定义，别再自创）：
 *
 *   特殊审批【开】—— 自己要改订单时用
 *     ① 业务员报价后不可修改订单 = 勾选    （锁住业务员，防别人误操作）
 *     ② 检中修改钉钉审批        = 不启用   （自己改的时候不走钉钉审批）
 *
 *   特殊审批【关】—— 恢复正常
 *     ① 业务员报价后不可修改订单 = 不勾选
 *     ② 检中修改钉钉审批        = 启用
 *
 * 界面：顶部工具区「报表工具」**左侧**一个开关（带间距），点开是面板；
 *       面板里两个模式按钮**只有当前启用的那个高亮**（绿色 +「当前启用」角标）。
 *       点模式按钮**立即执行，不弹确认框** —— 目标值先写进面板日志，便于事后倒查。
 *       开关本身**不显示状态**，展开面板时才发请求读状态（平时零请求）。
 *       展开时先本地查权限码：没有 CONFIG_MGMT 就直接显示「无操作权限」并锁住按钮。
 *
 * ── 涉及的两个接口（2026-09-16 抓包确认）──
 *
 *   ① POST /soa/api/v1/setup/out/count/update        字段 limit_sale_role_edit_after_confirm_audit
 *      ⚠️ 提交的是**整份配置快照**（20+ 字段），不是单字段！
 *      读接口 /setup/out/count/detail 返回的结构与提交体并不一一对应：
 *        - 提交体里的 physicalExamUnpaidAlertValue 等 4 个 **Value 阈值字段**，读接口不返回；
 *        - 读接口里的 limit_free_pack_on / vip_out_count_conf，提交体里没有（前端不提交）；
 *        - 读接口的 over_warn.* / out_count.ruleList 要摊平/改名成 order_end_date_warn / outCount。
 *      照 detail 重建提交体**与页面自己保存的行为一致**（页面也是拿 detail 填 state 再提交），
 *      但 4 个阈值字段读不到 ⇒ 只要「体检应收金额/体检名单预警」有任意一个开着，本脚本**拒绝提交**，
 *      避免把没读到的阈值写成 0。这是唯一一处会拒绝执行的情况。
 *
 *      历史上首版用「切到订单预警及消息页 → 勾复选框 → 点页面保存」来绕开这个问题，
 *      但那样会跳页打断当前操作；现在改成直接发请求，所以加了上面这道闸。
 *
 *   ② POST /soa/api/v1/setup/audit/update            字段 subLocalAuditOpen
 *      body 只有 3 个字段 {regionCode, id:10016, subLocalAuditOpen}，单字段、幂等，直接写。
 *      （id=10016 这一条在「订单审批设置」页上就叫「检中修改钉钉审批」，选项是 启用/不启用）
 *
 * ── 其他现场事实 ──
 *   - 地区码**从页面取**：localStorage.REGION_CODE_KEY（2026-09-16 实测本机 = XX，
 *     页面顶部显示「新乡地区」）。页面内没有第二个地区源（sessionStorage / cookie /
 *     window 全局 / React fiber 都验过）。**读不到就中止，不拿默认值去写生产**。
 *   - 权限码**从页面取**：localStorage.userpermission = 逗号分隔的权限码（当前账号 97 条），
 *     本页相关的是 CONFIG_MGMT_ENTRANCE（入口）和 CONFIG_MGMT（操作）。要精确匹配。
 *   - 写请求必须带自定义头 mnClientId: MN_SOA3，否则被网关拦
 *   - 两项都会回读校验；只有真的读回目标值才算成功
 *
 */

(function () {
  'use strict';

  // 只有主站有这套配置接口；app-fly 上不注入（@match 与 1.5 保持一致）
  if (location.hostname !== 'checkup-soa3.health-100.cn') return;

  // ============================================================
  // 0. 独立命名空间。避免与 1.2 / 1.3 / 1.4 / 1.5 / 1.6 页面级资源撞名
  // ============================================================
  const NS = '__hlj_ia_combo_v200';
  const IDS = {
    switch: `${NS}_switch`,
    switchSlot: `${NS}_switch_slot`,
    panel: `${NS}_panel`,
    body: `${NS}_body`,
    stateLimit: `${NS}_state_limit`,
    stateAudit: `${NS}_state_audit`,
    stateRegion: `${NS}_state_region`,
    comboOn: `${NS}_combo_on`,
    comboOff: `${NS}_combo_off`,
    refresh: `${NS}_refresh`,
    collapse: `${NS}_collapse`,
    close: `${NS}_close`,
    log: `${NS}_log`,
  };

  // 与 1.4/1.5/1.6 共用的顶部工具组（报表工具创建）。存在就把开关挂进去
  const TOP_TOOL_GROUP_ID = '__hlj_soa_top_tool_group_v1';

  const SCRIPT_VERSION = '2.2.1';
  const POS_KEY = `${NS}_pos`;

  const CLIENT_ID = 'MN_SOA3';
  const AUDIT_ID = 10016;

  const API = {
    countDetail: '/soa/api/v1/setup/out/count/detail',
    countUpdate: '/soa/api/v1/setup/out/count/update',
    auditQuery: '/soa/api/v1/setup/audit/query',
    auditUpdate: '/soa/api/v1/setup/audit/update',
  };

  // 两个模式。limit = 业务员报价后不可修改订单；audit = 检中修改钉钉审批
  // 术语按红领巾 2026-09-16 的定义（这是业务叫法，别再自创）：
  //   特殊审批【开】 = 业务员报价后不可修改订单 **勾选**   + 检中修改钉钉审批 **不启用**
  //   特殊审批【关】 = 业务员报价后不可修改订单 **不勾选** + 检中修改钉钉审批 **启用**
  const COMBO = {
    on: { limit: true, audit: false, text: '特殊审批：开', hint: '不可修改 + 不启用审批' },
    off: { limit: false, audit: true, text: '特殊审批：关', hint: '可修改 + 启用审批' },
  };

  const POLL_TIMES = 10;   // 回读校验次数
  const POLL_GAP = 500;    // 每次间隔 ms

  // ============================================================
  // 1. 小工具
  // ============================================================
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 当前地区代码 —— **从页面取，不写死**。
   *
   * 来源：页面自己的 localStorage.REGION_CODE_KEY（同域共享，页面发业务请求用的就是它）。
   * 2026-09-16 实测（XX 区 / 页面顶部显示「新乡地区」）：
   *   - localStorage.REGION_CODE_KEY = "XX"      ← 唯一的地区代码源
   *   - sessionStorage / cookie / window 全局 / React fiber 上都找不到别的地区数据
   *   - 页面顶部的「新乡地区」只是**显示名**，与代码不是同一个值
   * ⇒ 读不到就**抛错中止**，绝不拿默认值去写生产配置（换地区后写错区的代价太大）。
   */
  function region() {
    let raw = null;
    try { raw = localStorage.getItem('REGION_CODE_KEY'); } catch (e) { raw = null; }
    if (raw === null || raw === undefined || raw === '') {
      throw new Error('读不到地区代码 REGION_CODE_KEY，请刷新页面后重试');
    }

    let v = String(raw).trim().replace(/^"|"$/g, '');
    // 兼容被包成 JSON 的情况，如 {"code":"XX"} / {"regionCode":"XX"}
    if (v.charAt(0) === '{') {
      try {
        const o = JSON.parse(v);
        v = o.code || o.regionCode || o.value || '';
      } catch (e) { /* 不是 JSON 就保持原样 */ }
    }
    v = String(v).trim();
    if (!v) throw new Error('地区代码为空，请刷新页面后重试');
    return v;
  }

  /** 页面顶部显示的地区名（如「新乡地区」）。只用于面板展示，不参与请求 */
  function regionLabel() {
    try {
      const el = document.querySelector('#layout-header .menu, .header-inner .menu');
      return el && el.textContent ? el.textContent.trim() : '';
    } catch (e) { return ''; }
  }

  /**
   * 配置管理操作权限 —— 从页面权限缓存判断，**零请求**。
   *
   * 现场事实（2026-09-16 实测）：localStorage.userpermission 是一串逗号分隔的权限码，
   * 当前账号 97 个码，其中和本页直接相关的是：
   *   CONFIG_MGMT_ENTRANCE —— 配置管理【入口】
   *   CONFIG_MGMT          —— 配置管理【操作】
   * 用**精确匹配**（split 后比对），不能用 includes —— 否则 CONFIG_MGMT_ENTRANCE
   * 会被当成 CONFIG_MGMT 命中，把只有入口权限的账号误判成有操作权限。
   *
   * 返回：'ok'（有操作权限）/ 'denied'（有权限清单但没这一条）/ 'unknown'（读不到清单）
   * 'unknown' 不预判 —— 权限清单可能还没写入，交给接口去兜底，免得误报。
   */
  const PERM_KEY = 'userpermission';
  const PERM_NEED = 'CONFIG_MGMT';

  function permCheck() {
    let raw = null;
    try { raw = localStorage.getItem(PERM_KEY); } catch (e) { raw = null; }
    if (!raw) return 'unknown';
    const codes = String(raw).split(',').map((s) => s.trim());
    return codes.indexOf(PERM_NEED) >= 0 ? 'ok' : 'denied';
  }

  // ============================================================
  // 2. 接口
  // ============================================================
  async function apiPost(path, body) {
    const res = await fetch(location.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', mnClientId: CLIENT_ID },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /** 一次读回两项当前值 */
  async function readState() {
    const d = await apiPost(API.countDetail, { region_code: region() });
    if (!d || d.result_code !== 'SUCC') throw new Error('count/detail 返回 ' + (d && d.result_code));
    const a = await apiPost(API.auditQuery, { regionCode: region() });
    if (!a || a.result_code !== 'SUCC') throw new Error('audit/query 返回 ' + (a && a.result_code));
    return {
      count: d.data,
      limit: !!d.data.limit_sale_role_edit_after_confirm_audit,
      audit: !!(a.data && a.data.subLocalAuditOpen),
    };
  }

  /**
   * 按 detail 的数据重建 count/update 的提交体。
   * 字段名与顺序照抄页面自己发出的请求（2026-09-16 抓包），方便和服务端日志对齐。
   *
   * ⚠️ detail 里读不到 4 个阈值字段（*Value）。页面自己保存时同样按 0 提交（对应功能关闭时），
   *    但为了不冒险，只要这 4 个功能有任意一个开着就直接拒绝 —— 那种情况请先到
   *    「配置管理 → 订单预警及消息」页手工保存一次。
   */
  function buildCountBody(d, limitFlag) {
    const warnOn = d.physicalExamUnpaidAlert || d.physicalExamUnpaidAlertFixedPerson
      || d.healthCheckListWarning || d.healthCheckListWarningFixedPerson;
    if (warnOn) {
      throw new Error('「体检应收金额预警 / 体检名单预警」处于开启状态，阈值字段读不到，已拒绝直接提交');
    }
    const ow = d.over_warn || {};
    const oc = d.out_count || {};
    return {
      region_code: region(),
      orderNodeNotificationReview: !!d.orderNodeNotificationReview,
      orderNodeNotificationToExamine: !!d.orderNodeNotificationToExamine,
      physicalExamUnpaidAlert: !!d.physicalExamUnpaidAlert,
      physicalExamUnpaidAlertValue: d.physicalExamUnpaidAlertValue === undefined ? 0 : d.physicalExamUnpaidAlertValue,
      physicalExamUnpaidAlertFixedPerson: !!d.physicalExamUnpaidAlertFixedPerson,
      physicalExamUnpaidAlertFixedPersonValue: d.physicalExamUnpaidAlertFixedPersonValue === undefined ? 0 : d.physicalExamUnpaidAlertFixedPersonValue,
      healthCheckListWarning: !!d.healthCheckListWarning,
      healthCheckListWarningValue: d.healthCheckListWarningValue === undefined ? 0 : d.healthCheckListWarningValue,
      healthCheckListWarningFixedPerson: !!d.healthCheckListWarningFixedPerson,
      healthCheckListWarningFixedPersonValue: d.healthCheckListWarningFixedPersonValue === undefined ? 0 : d.healthCheckListWarningFixedPersonValue,
      order_end_date_warn: ow.order_end_date_warn === undefined ? '7' : ow.order_end_date_warn,
      order_start_date_warn: ow.order_start_date_warn === undefined ? '3' : ow.order_start_date_warn,
      must_be_crm_on: !!d.must_be_crm_on,
      limit_sale_role_edit_after_confirm_audit: !!limitFlag,
      enable_start_ding: !!d.enable_start_ding,
      enable_end_ding: !!d.enable_end_ding,
      enable_promotion_sms: !!d.enable_promotion_sms,
      outCount: Array.isArray(oc.ruleList) ? oc.ruleList : [],
      promotionSmsDefaultCount: d.promotionSmsDefaultCount === undefined ? 3 : d.promotionSmsDefaultCount,
      promotionSmsDefaultInterval: d.promotionSmsDefaultInterval === undefined ? 5 : d.promotionSmsDefaultInterval,
      enable_start_sms: !!d.enable_start_sms,
      startSmsDefaultCount: d.startSmsDefaultCount === undefined ? 3 : d.startSmsDefaultCount,
      startSmsDefaultInterval: d.startSmsDefaultInterval === undefined ? 5 : d.startSmsDefaultInterval,
    };
  }

  async function writeCountFlag(countData, limitFlag) {
    const body = buildCountBody(countData, limitFlag);   // 可能抛"阈值"错误
    const r = await apiPost(API.countUpdate, body);
    if (!r || r.result_code !== 'SUCC') throw new Error('count/update 返回 ' + (r && r.result_code));
    return true;
  }

  async function writeAuditFlag(on) {
    const r = await apiPost(API.auditUpdate, { regionCode: region(), id: AUDIT_ID, subLocalAuditOpen: !!on });
    if (!r || r.result_code !== 'SUCC') throw new Error('audit/update 返回 ' + (r && r.result_code));
    return true;
  }

  /** 回读校验：两项都变成目标值才算成功 */
  async function verify(limit, audit) {
    for (let i = 0; i < POLL_TIMES; i++) {
      await sleep(POLL_GAP);
      try {
        const st = await readState();
        if (st.limit === limit && st.audit === audit) return true;
      } catch (e) { /* 抖动就继续等 */ }
    }
    return false;
  }

  // ============================================================
  // 3. 主流程
  // ============================================================
  let running = false;

  /**
   * @param {'on'|'off'} target 特殊审批 开 / 关
   * @param {(msg:string)=>void} log
   */
  async function applyCombo(target, log) {
    const want = COMBO[target];
    const title = target === 'on' ? '特殊审批【开】' : '特殊审批【关】· 恢复正常';
    log(`开始执行「${title}」（地区 ${region()}）`);

    const result = { limit: null, audit: null };
    let st;

    try {
      st = await readState();
      log(`当前：业务员报价后不可修改订单 = ${st.limit ? '开' : '关'}，检中修改钉钉审批 = ${st.audit ? '启用' : '不启用'}`);
    } catch (e) {
      log('读取当前状态失败：' + e.message);
      return result;
    }

    // ① 业务员报价后不可修改订单
    if (st.limit === want.limit) {
      result.limit = true;
      log(`① 业务员报价后不可修改订单 本来就是「${want.limit ? '开' : '关'}」，跳过`);
    } else {
      try {
        await writeCountFlag(st.count, want.limit);
        result.limit = true;
        log(`① 业务员报价后不可修改订单 → ${want.limit ? '开' : '关'}  已提交`);
      } catch (e) {
        result.limit = false;
        log('① 业务员报价后不可修改订单 失败：' + e.message);
      }
    }

    // ② 检中修改钉钉审批
    if (st.audit === want.audit) {
      result.audit = true;
      log(`② 检中修改钉钉审批 本来就是「${want.audit ? '启用' : '不启用'}」，跳过`);
    } else {
      try {
        await writeAuditFlag(want.audit);
        result.audit = true;
        log(`② 检中修改钉钉审批 → ${want.audit ? '启用' : '不启用'}  已提交`);
      } catch (e) {
        result.audit = false;
        log('② 检中修改钉钉审批 失败：' + e.message);
      }
    }

    // 回读校验
    if (result.limit && result.audit) {
      log('回读校验中…');
      const ok = await verify(want.limit, want.audit);
      if (ok) {
        log('✅ 校验通过，两项都已生效');
      } else {
        log('⚠️ 校验超时：提交没报错，但读回来的值还不是目标值，请刷新面板状态确认');
        result.limit = false;
        result.audit = false;
      }
    } else {
      log('⚠️ 有失败项，跳过回读校验');
    }

    return result;
  }

  // ============================================================
  // 4. 状态渲染
  // ============================================================

  /**
   * 把「当前启用的那个模式」标出来 —— 红领巾的硬要求：面板里**只有当前启用的高亮**。
   *
   * 所以这里只切一个 is-cur：高亮样式（绿色边框 +「当前启用」角标）全部挂在 .is-cur 上，
   * 而两个按钮的静态配色已从 CSS 里删掉。这样"哪个是当前"只有一个信息源 —— 实测状态，
   * 不会出现"绿色按钮 vs 角标按钮"两个说法打架。
   *
   * which: 'on' / 'off' / null（读不到状态时两个都不标）
   */
  function markComboCur(which) {
    const on = $(IDS.comboOn);
    const off = $(IDS.comboOff);
    if (on) on.classList.toggle('is-cur', which === 'on');
    if (off) off.classList.toggle('is-cur', which === 'off');
  }

  /**
   * 地区行：直接读页面（不发请求）。这是"跟着页面走"的可见证据 ——
   * 切了地区，这里立刻跟着变。
   */
  function paintRegion() {
    const el = $(IDS.stateRegion);
    if (!el) return;
    let code = '';
    try { code = region(); } catch (e) { code = ''; }
    const label = regionLabel();
    if (!code) {
      el.textContent = '读不到';
      el.className = 'hlj-ia-na';
      el.title = '未能从页面读到 REGION_CODE_KEY，刷新页面后重试';
      return;
    }
    el.textContent = code + (label ? '（' + label + '）' : '');
    el.className = 'hlj-ia-info';
    el.title = '取自页面 localStorage.REGION_CODE_KEY' + (label ? '，页面顶部显示「' + label + '」' : '');
  }

  /**
   * 「无操作权限」的长相：状态两行直接写出来、两个执行按钮锁住、**不发任何请求**。
   *
   * 红领巾要求（2026-09-16）：读不到当前状态就按"没权限"提示，别等到点了按钮才失败。
   * 真实错误（接口返回了什么）放 title 和日志里，不吞掉 —— 断网和真没权限能区分开。
   */
  function paintDenied(detail) {
    const tip = detail
      ? '读取失败：' + detail
      : '当前账号缺少「' + PERM_NEED + '」权限（配置管理操作权限）';
    [$(IDS.stateLimit), $(IDS.stateAudit)].forEach((el) => {
      if (!el) return;
      el.textContent = '无操作权限';
      el.className = 'hlj-ia-warn';
      el.title = tip;
    });
    paintRegion();
    markComboCur(null);
    setLocked(true);
  }

  function paintState(st, err) {
    const elLimit = $(IDS.stateLimit);
    const elAudit = $(IDS.stateAudit);
    paintRegion();
    if (!elLimit || !elAudit) return;

    if (err) {
      paintDenied(err && err.message ? String(err.message) : String(err));
      return;
    }

    setLocked(false);
    const isOn = st.limit === true && st.audit === false;
    const isOff = st.limit === false && st.audit === true;

    elLimit.textContent = st.limit ? '开' : '关';
    elLimit.className = st.limit ? 'hlj-ia-on' : 'hlj-ia-off';
    elAudit.textContent = st.audit ? '启用' : '不启用';
    elAudit.className = st.audit ? 'hlj-ia-on' : 'hlj-ia-off';

    markComboCur(isOn ? 'on' : (isOff ? 'off' : null));
  }

  async function refreshState(log) {
    try {
      const st = await readState();
      paintState(st);
      if (log) log('状态已刷新');
      return st;
    } catch (e) {
      paintState(null, e);
      if (log) log('读取状态失败：' + e.message);
      return null;
    }
  }

  // ============================================================
  // 5. UI —— 顶部开关
  // ============================================================
  /**
   * 开关只当「入口」，**不显示状态**。
   *
   * 红领巾要求：平时不检测状态（打开面板时才读）。既然不读，就不该在开关上显示
   * 状态 —— 否则要么得瞎猜、要么等于变相天天发请求。所以开关文案固定，
   * 状态只显示在面板里（打开面板那一刻才读）。
   */
  const SWITCH_LABEL = '订单特殊审批';

  function setSwitchLabel() {
    const btn = $(IDS.switch);
    if (!btn) return;
    btn.textContent = SWITCH_LABEL;
    btn.className = '';
    btn.title = SWITCH_LABEL + ' —— 点击打开面板（打开时才读取当前状态）';
  }

  /**
   * 把开关放到「报表工具」的**左侧**（= 共享工具组的最前面）。
   *
   * 红领巾要求：① 在报表工具左边；② 离远一些，不要和它们挤成一坨；
   * ③ 只有 1.7 单独启用（页面上没有共享组）时位置也不能乱。
   * ⇒ 顺序由这里保证；「离远一些」由 CSS 的 margin 给；
   *    找不到共享组就独立站在顶部用户区左边，同样带间距。
   */
  function placeSwitch(slot) {
    const group = $(TOP_TOOL_GROUP_ID);
    if (group) {
      if (slot.parentElement !== group || group.firstElementChild !== slot) {
        group.insertBefore(slot, group.firstElementChild || null);
      }
      return 'shared-group';
    }
    const headerInner = document.querySelector('#layout-header .header-inner');
    if (!headerInner) return 'no-anchor';
    if (slot.parentElement !== headerInner) {
      const userBox = headerInner.querySelector(':scope > .user');
      if (userBox) headerInner.insertBefore(slot, userBox);
      else headerInner.appendChild(slot);
    }
    return 'header';
  }

  function ensureSwitch() {
    const existing = $(IDS.switch);
    const existingSlot = $(IDS.switchSlot);

    // 已存在时不重复创建，只校正位置（报表工具可能晚于我们创建共享组）
    if (existing && existing.isConnected && existingSlot && existingSlot.isConnected) {
      placeSwitch(existingSlot);
      // 文案必须固定。只在真的不一致时才写，避免在 MutationObserver 里反复改 DOM
      if (existing.textContent !== SWITCH_LABEL) setSwitchLabel();
      return;
    }

    // 清理 SPA 重绘后可能残留的半成品节点
    if (existingSlot) existingSlot.remove();
    else if (existing) existing.remove();

    const headerInner = document.querySelector('#layout-header .header-inner');
    if (!headerInner) return;

    const slot = document.createElement('div');
    slot.id = IDS.switchSlot;

    const btn = document.createElement('button');
    btn.id = IDS.switch;
    btn.type = 'button';
    btn.textContent = SWITCH_LABEL;
    btn.title = SWITCH_LABEL + ' —— 点击打开面板（打开时才读取当前状态）';

    ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((evt) => {
      btn.addEventListener(evt, (e) => e.stopPropagation());
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    slot.appendChild(btn);
    placeSwitch(slot);
  }

  // ============================================================
  // 6. UI —— 面板
  // ============================================================
  function logLine(msg) {
    const el = $(IDS.log);
    if (!el) return;
    const t = new Date().toTimeString().slice(0, 8);
    el.textContent += `[${t}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function clearLog() {
    const el = $(IDS.log);
    if (el) el.textContent = '';
  }

  /** 无操作权限时锁住两个执行按钮。「刷新」留着 —— 万一权限是后写入的，点一下就能恢复 */
  let locked = false;

  function setLocked(on) {
    locked = !!on;
    [IDS.comboOn, IDS.comboOff].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.disabled = locked;
      el.classList.toggle('is-locked', locked);
    });
  }

  function setBusy(b) {
    [IDS.comboOn, IDS.comboOff, IDS.refresh].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.disabled = b || (locked && id !== IDS.refresh);
    });
  }

  /**
   * 点按钮 → 直接执行，不弹二次确认（红领巾 2026-09-16 要求去掉原生 confirm 弹窗）。
   * 目标值会先写进日志，出问题能从日志倒推出这次改了什么。
   * 地区读不到就**中止**，不做任何写入。
   */
  function runCombo(target) {
    if (running) return;
    const c = COMBO[target];

    running = true;
    setBusy(true);
    clearLog();
    logLine('—— 手动触发 ——');

    let rg = '';
    try {
      rg = region();
    } catch (e) {
      logLine('✗ ' + e.message);
      logLine('已中止，没有发出任何写请求。');
      running = false;
      setBusy(false);
      return;
    }

    logLine(`目标「${c.text}」：订单不可修改=${c.limit ? '勾选' : '不勾选'}　检中修改钉钉审批=${c.audit ? '启用' : '不启用'}　地区=${rg}`);
    applyCombo(target, logLine).then(async () => {
      await refreshState();
      running = false;
      setBusy(false);
    }, async (e) => {
      logLine('未捕获异常：' + (e && e.message));
      await refreshState();
      running = false;
      setBusy(false);
    });
  }

  function createPanel() {
    let panel = $(IDS.panel);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = IDS.panel;
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="hlj-ia-head" data-drag-handle="1">
        <div class="hlj-ia-title">特殊审批 <span>v${SCRIPT_VERSION}</span></div>
        <div class="hlj-ia-head-actions">
          <button id="${IDS.refresh}" class="hlj-ia-mini" type="button" title="重新读取两项当前值">刷新</button>
          <button id="${IDS.collapse}" class="hlj-ia-icon" type="button" title="折叠">▾</button>
          <button id="${IDS.close}" class="hlj-ia-icon" type="button" title="关闭">×</button>
        </div>
      </div>
      <div id="${IDS.body}">
        <div class="hlj-ia-state">
          <div class="hlj-ia-row"><span>业务员报价后不可修改订单</span><b id="${IDS.stateLimit}" class="hlj-ia-na">—</b></div>
          <div class="hlj-ia-row"><span>检中修改钉钉审批</span><b id="${IDS.stateAudit}" class="hlj-ia-na">—</b></div>
          <div class="hlj-ia-row hlj-ia-row-region"><span>当前地区</span><b id="${IDS.stateRegion}" class="hlj-ia-na">—</b></div>
        </div>
        <div class="hlj-ia-combos">
          <button id="${IDS.comboOn}" class="hlj-ia-combo" type="button">
            <span class="hlj-ia-combo-cur">当前启用</span>
            <span class="hlj-ia-combo-t">${COMBO.on.text}</span>
            <span class="hlj-ia-combo-s">${COMBO.on.hint}</span>
          </button>
          <button id="${IDS.comboOff}" class="hlj-ia-combo" type="button">
            <span class="hlj-ia-combo-cur">当前启用</span>
            <span class="hlj-ia-combo-t">${COMBO.off.text}</span>
            <span class="hlj-ia-combo-s">${COMBO.off.hint}</span>
          </button>
        </div>
        <div class="hlj-ia-log" id="${IDS.log}">绿色 = 当前启用；点另一个直接切换（不弹确认）。</div>
      </div>
    `;
    document.body.appendChild(panel);

    $(IDS.comboOn).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runCombo('on'); });
    $(IDS.comboOff).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); runCombo('off'); });
    $(IDS.refresh).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); refreshState(logLine); });
    $(IDS.close).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closePanel(); });
    $(IDS.collapse).addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleCollapse(); });

    // 拖动 + 位置记忆
    const handle = panel.querySelector('[data-drag-handle]');
    let drag = null;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      panel.style.left = Math.max(0, e.clientX - drag.dx) + 'px';
      panel.style.top = Math.max(0, e.clientY - drag.dy) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      try {
        if (typeof GM_setValue === 'function') GM_setValue(POS_KEY, { left: panel.style.left, top: panel.style.top });
      } catch (err) { /* ignore */ }
    });
    try {
      const pos = typeof GM_getValue === 'function' ? GM_getValue(POS_KEY, null) : null;
      if (pos && pos.left && pos.top) {
        panel.style.left = pos.left;
        panel.style.top = pos.top;
        panel.style.right = 'auto';
      }
    } catch (err) { /* ignore */ }

    return panel;
  }

  function togglePanel() {
    const panel = createPanel();
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      // 明确没权限就直接出结论 —— 连读请求都不发（红领巾 2026-09-16 要求）
      if (permCheck() === 'denied') {
        clearLog();
        paintDenied();
        logLine('✗ 当前账号缺少「' + PERM_NEED + '」权限（配置管理操作权限），已停用。');
        logLine('未发出任何请求。若权限刚开通，刷新页面后重试。');
        return;
      }
      refreshState();
    } else {
      panel.style.display = 'none';
    }
  }

  function closePanel() {
    const panel = $(IDS.panel);
    if (panel) panel.style.display = 'none';
  }

  function toggleCollapse() {
    const body = $(IDS.body);
    const btn = $(IDS.collapse);
    if (!body) return;
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    if (btn) btn.textContent = hidden ? '▾' : '▸';
  }

  // ============================================================
  // 7. 样式
  // ============================================================
  function injectStyle() {
    const id = `${NS}_style`;
    if ($(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      #${IDS.switchSlot} {
        display:flex; align-items:center; justify-content:center;
        /* 放在「报表工具」左侧，并与它拉开距离（红领巾：离远一些）。
           独立启用（页面上没有共享工具组）时靠同一个右边距与用户区隔开，不会挤成一坨 */
        margin-left:4px; margin-right:150px;
      }
      #${IDS.switch} {
        min-width:120px; height:31px; padding:0 13px;
        font-size:13px; font-family:inherit; font-weight:600;
        border-radius:6px; cursor:pointer; white-space:nowrap;
        border:1px solid #d9d9d9; background:linear-gradient(180deg,#ffffff 0%,#fafafa 100%);
        color:#5b6270; box-shadow:0 1px 2px rgba(15,23,42,.06);
        transition:background .12s ease, border-color .12s ease, box-shadow .12s ease, transform .08s ease;
      }
      #${IDS.switch}:hover { transform:translateY(-1px); box-shadow:0 2px 6px rgba(15,23,42,.12); }
      #${IDS.switch}:active { transform:translateY(1px); box-shadow:0 1px 2px rgba(15,23,42,.10); }
      /* 开关不再带状态色（不检测状态就不显示状态）—— 原来 .is-on/.is-off/.is-mixed 三条已删 */

      #${IDS.panel} {
        position:fixed; top:64px; right:16px; z-index:99999;
        width:340px; box-sizing:border-box;
        background:#fff; border:1px solid #e5e9f0; border-radius:10px;
        box-shadow:0 10px 30px rgba(15,23,42,.16);
        font:12px/1.65 -apple-system,"Microsoft YaHei",sans-serif; color:#1f2937;
        user-select:none;
      }
      #${IDS.panel} .hlj-ia-head {
        display:flex; align-items:center; justify-content:space-between;
        padding:7px 10px; border-bottom:1px solid #f0f2f5;
        background:linear-gradient(180deg,#fbfcfe 0%,#f5f7fa 100%);
        border-radius:10px 10px 0 0; cursor:move;
      }
      #${IDS.panel} .hlj-ia-title { font-weight:700; font-size:13px; color:#1f2937; }
      #${IDS.panel} .hlj-ia-title span { font-size:10px; color:#94a3b8; font-weight:400; }
      #${IDS.panel} .hlj-ia-head-actions { display:flex; align-items:center; gap:4px; }
      #${IDS.panel} .hlj-ia-mini {
        height:22px; padding:0 8px; font-size:11px; font-family:inherit; cursor:pointer;
        border:1px solid #d9d9d9; border-radius:5px; background:#fff; color:#475569;
      }
      #${IDS.panel} .hlj-ia-mini:hover { border-color:#1677ff; color:#1677ff; }
      #${IDS.panel} .hlj-ia-icon {
        width:22px; height:22px; padding:0; font-size:13px; line-height:1; cursor:pointer;
        border:1px solid transparent; border-radius:5px; background:transparent; color:#64748b;
      }
      #${IDS.panel} .hlj-ia-icon:hover { background:#eef2f7; color:#1f2937; }
      #${IDS.body} { padding:10px; }
      #${IDS.panel} .hlj-ia-state {
        border:1px solid #eef1f5; border-radius:7px; padding:7px 9px; background:#fafbfd;
      }
      #${IDS.panel} .hlj-ia-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      #${IDS.panel} .hlj-ia-row + .hlj-ia-row { margin-top:3px; }
      #${IDS.panel} .hlj-ia-row b { font-weight:700; }
      #${IDS.panel} .hlj-ia-on { color:#389e0d; }
      #${IDS.panel} .hlj-ia-off { color:#cf1322; }
      #${IDS.panel} .hlj-ia-na { color:#94a3b8; font-weight:400; }
      /* 地区值：中性色。它不是开关状态，别用绿色（会和"启用"混淆）*/
      #${IDS.panel} .hlj-ia-info { color:#334155; }
      /* 无操作权限：橙色，比灰色醒目、又和"关"的红色区分开 */
      #${IDS.panel} .hlj-ia-warn { color:#d46b08; }
      /* 地区行：环境信息，弱化显示，与上面两项配置用一条虚线隔开 */
      #${IDS.panel} .hlj-ia-row.hlj-ia-row-region {
        margin-top:6px; padding-top:6px;
        border-top:1px dashed #e8ecf2;
        font-size:11.5px; color:#7b8794;
      }
      #${IDS.panel} .hlj-ia-combos { display:flex; flex-direction:column; gap:10px; margin-top:18px; }
      /* 两个模式按钮。红领巾要求【只高亮当前启用的模式】，
         所以配色不再按「开/关」区分 —— 那会让人把绿色按钮误读成"当前就是它"。 */
      #${IDS.panel} .hlj-ia-combo {
        position:relative;
        display:flex; flex-direction:column; align-items:flex-start; gap:2px;
        padding:7px 10px; border-radius:7px; cursor:pointer; text-align:left;
        font-family:inherit; border:1px solid #e8ecf2; background:#fcfdfe;
        transition:background .12s ease, border-color .12s ease, box-shadow .12s ease;
      }
      #${IDS.panel} .hlj-ia-combo .hlj-ia-combo-t { font-size:12.5px; font-weight:700; color:#8a94a6; }
      #${IDS.panel} .hlj-ia-combo .hlj-ia-combo-s { font-size:11px; color:#a8b1bf; }
      #${IDS.panel} .hlj-ia-combo:hover { border-color:#c7d3e0; background:#fff; box-shadow:0 2px 8px rgba(15,23,42,.08); }
      #${IDS.panel} .hlj-ia-combo:hover .hlj-ia-combo-t { color:#475569; }

      /* —— 唯一的高亮：当前生效的那个模式 —— */
      #${IDS.panel} .hlj-ia-combo.is-cur {
        border-color:#7ac143; background:linear-gradient(180deg,#f8fff2 0%,#eafbd9 100%);
        box-shadow:0 1px 3px rgba(47,107,18,.14);
      }
      #${IDS.panel} .hlj-ia-combo.is-cur .hlj-ia-combo-t { color:#2f6b12; }
      #${IDS.panel} .hlj-ia-combo.is-cur .hlj-ia-combo-s { color:#5f8438; }
      #${IDS.panel} .hlj-ia-combo .hlj-ia-combo-cur {
        display:none; position:absolute; top:-8px; right:9px;
        font-size:10px; line-height:1; padding:3px 7px; border-radius:999px;
        background:#4a9c1c; color:#fff; font-weight:700; letter-spacing:.5px;
      }
      #${IDS.panel} .hlj-ia-combo.is-cur .hlj-ia-combo-cur { display:inline-block; }
      #${IDS.panel} .hlj-ia-combo[disabled] { opacity:.55; cursor:not-allowed; }
      /* 无操作权限时两个执行按钮灰掉 */
      #${IDS.panel} .hlj-ia-combo.is-locked { filter:grayscale(1); }
      #${IDS.panel} .hlj-ia-log {
        margin-top:9px; max-height:132px; overflow:auto; padding:7px 8px;
        border:1px solid #eef1f5; border-radius:7px; background:#fafbfd;
        font-size:11px; line-height:1.6; color:#64748b; white-space:pre-wrap; word-break:break-word;
      }
      @media (max-width: 1100px) {
        #${IDS.switchSlot} { margin-left:8px; margin-right:8px; }
        #${IDS.switch} { min-width:104px; padding:0 10px; font-size:12px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // 8. 启动 + SPA 跟进
  // ============================================================
  function boot() {
    injectStyle();
    ensureSwitch();
    createPanel();
    // 启动时**不读状态**（红领巾 2026-09-16 要求）：平时零请求、不打扰。
    // 只有点开关展开面板的那一刻才 refreshState()，见 togglePanel()。
    // 开关上也不再显示状态 —— 不读就不该显示，否则等于变相天天请求。
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // SPA 换页会重绘 header，开关要跟进去；面板挂在 body 上不受影响
  let mo = null;
  const watch = () => {
    if (mo) return;
    mo = new MutationObserver(() => ensureSwitch());
    mo.observe(document.body, { childList: true, subtree: true });
  };
  watch();
  window.addEventListener('hashchange', () => setTimeout(ensureSwitch, 300));

  // 调试 / 自检钩子（只读方法不会改任何东西）
  window[NS] = {
    version: SCRIPT_VERSION,
    region,
    regionLabel,
    permCheck,
    readState,
    buildCountBody,
    refreshState,
    paintDenied,
    applyCombo: (t, log) => applyCombo(t, log || logLine),
    ids: IDS,
    destroy: () => {
      const p = $(IDS.panel);
      if (p) p.remove();
      const s = $(IDS.switchSlot);
      if (s) s.remove();
      const st = $(`${NS}_style`);
      if (st) st.remove();
      if (mo) mo.disconnect();
      try { delete window[NS]; } catch (e) { window[NS] = undefined; }
    },
  };
})();
