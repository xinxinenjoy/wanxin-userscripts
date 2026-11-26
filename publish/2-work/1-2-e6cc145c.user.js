// ==UserScript==
// @name         前台-1.2网络报告批量修改
// @namespace    https://tampermonkey.net/
// @version      2.0.0
// @description  前台登记页批量修改基础信息：①网络报告获取方式 ②从订单刷新体检类型。支持三种数据来源：名单（证件号/预约单号）、订单号、单位代码+创建时间区间（自动按 84 天分段绕过 90 天限制）。整单重建提交、写后回读校验、金额字段快照比对，绝不改金额。
// @match        *://checkup-register.health-100.cn/*
// @grant        none
// @run-at       document-idle

// @author       WanXin
// @publishGroup 2-work
// @publishID    1-2-e6cc145c
// @updateURL    https://scripts.wanxinxin.dpdns.org/2-work/1-2-e6cc145c.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/2-work/1-2-e6cc145c.user.js
// ==/UserScript==

(function () {
  'use strict';

  const INSTANCE_KEY = '__SOA_BASEINFO_BATCH_V200__';
  if (window[INSTANCE_KEY]) return;
  window[INSTANCE_KEY] = true;

  // ============================================================
  // 常量
  // ============================================================
  const API_BASE = '/checkup-hc';
  const P_LIST = '/api/checkin/query/list';
  const P_DETAIL = '/api/checkin/query/v2/orderDetail';
  const P_SAVE = '/api/checkin/saveBaseCustomerInfo';
  const P_REFRESH_TYPE = '/api/refresh/checkupType';

  const SIGN_SECRET = 'p2otita0dxrpcge6iictqu9vwyj1vn8puv315blxxzmvcpyyakskh713t2c1f57i';
  const MN_CLIENT = 'MN_REGISTER';

  const TPL_KEY = 'soa_netreport_tpl_v1';   // 沿用旧键，升级后模板不用重捕
  const CFG_KEY = 'soa_baseinfo_cfg_v2';

  // 服务端硬限制：区间 > 90 天直接报错，单次返回 > 500 行直接报错
  const SEG_DAYS = 84;
  const PAGE_SIZE = 300;

  const NET_TARGETS = [
    { v: 2, label: '2 · 公司+个人查询' },
    { v: 1, label: '1 · 个人查询' },
    { v: 0, label: '0 · 不支持 / 关闭' },
  ];

  // 写入前后允许变化的字段（非业务字段，不需要报警）
  const BENIGN_DIFF = new Set([
    'updateAt', 'updateBy', 'createAt', 'createBy',
    'updateAtDate', 'customerIdentity.customer.updateAt',
    'customerIdentity.customer.updateBy',
    // 保存接口会顺带刷新服务单的审计字段，每次提交必变，不是数据问题
    'serviceOrder.updateAt', 'serviceOrder.updateBy',
    'orderExtraDTO.updateAt', 'orderExtraDTO.updateBy',
  ]);

  // 金额相关键名，用于兜底扫描：body 里出现这些键且值与详情不一致 => 拒绝写入
  const MONEY_KEY_RE = /(price|amount|money|fee|cost|settle|discount|pay)/i;

  // ============================================================
  // 通用工具
  // ============================================================
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cookieGet(name) {
    const m = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : '';
  }

  function readJSON(key, dft) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : dft;
    } catch (e) {
      return dft;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function detectBranch() {
    const c = cookieGet('branch-code');
    if (c) return c;
    try {
      const tab = sessionStorage.getItem('currentBranch');
      if (tab) {
        const o = JSON.parse(tab);
        if (o && o.branchCode) return o.branchCode;
      }
    } catch (e) { /* 忽略 */ }
    return 'X7';
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtDay(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function fmtStamp(d, isStart) {
    return fmtDay(d) + (isStart ? ' 00:00:00' : ' 23:59:59');
  }

  function addDays(d, n) {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function parseDay(s) {
    if (!s) return null;
    const p = String(s).split('-').map(Number);
    if (p.length !== 3 || !p[0]) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }

  /**
   * 把 [start, end] 切成若干段，每段最多 maxDays 天。
   * 服务端限制 90 天，这里取 84 天留余量（跨月、月末边界都不会踩线）。
   */
  function buildSegments(start, end, maxDays) {
    const segs = [];
    let s = new Date(start.getTime());
    s.setHours(0, 0, 0, 0);
    const e0 = new Date(end.getTime());
    e0.setHours(0, 0, 0, 0);
    let guard = 0;
    while (s <= e0 && guard++ < 400) {
      let e = addDays(s, maxDays - 1);
      if (e > e0) e = e0;
      segs.push([s, e]);
      s = addDays(e, 1);
    }
    return segs;
  }

  // ============================================================
  // 签名：mnsign = SHA256("MN_REGISTER" + 服务端校准毫秒 + 密钥)
  // 时间戳必须用服务端校准时间，前端存的是偏移量 login_server_local_time
  // ============================================================
  // SHA-256 常量表，供非安全上下文（crypto.subtle 不可用）时兜底
  const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function sha256Fallback(str) {
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length;
    const total = (((len + 9) >> 6) + 1) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const bitLen = len * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, bitLen >>> 0, false);
    dv.setUint32(total - 8, Math.floor(bitLen / 4294967296), false);

    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  async function sha256Hex(str) {
    const c = window.crypto;
    if (c && c.subtle && typeof c.subtle.digest === 'function') {
      try {
        const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(str));
        const bytes = new Uint8Array(buf);
        let out = '';
        for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
        return out;
      } catch (e) { /* 落回兜底实现 */ }
    }
    return sha256Fallback(str);
  }

  function serverNow() {
    let offset = 0;
    try {
      const v = localStorage.getItem('login_server_local_time');
      if (v && !isNaN(Number(v))) offset = Number(v);
    } catch (e) { /* 忽略 */ }
    return Date.now() + offset;
  }

  async function signHeaders(branch) {
    const ts = String(serverNow());
    const sign = await sha256Hex(MN_CLIENT + ts + SIGN_SECRET);
    return {
      'Content-Type': 'application/json',
      'mnclientid': MN_CLIENT,
      'mntimestamp': ts,
      'mnsign': sign,
      'branch-code': branch,
    };
  }

  // ============================================================
  // API
  // ============================================================
  async function api(path, payload, branch) {
    const headers = await signHeaders(branch);
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { status: res.status, text, json };
  }

  function okOf(r) {
    return r && r.json && r.json.code === '000000';
  }

  function errMsg(r) {
    if (r.json) return r.json.msg || ('code=' + r.json.code);
    return 'HTTP ' + r.status + ' ' + String(r.text || '').slice(0, 80);
  }

  /** 按证件号查该门店下的预约单（列表里证件号是脱敏的，只能逐号查） */
  async function findOrdersOne(cert, branch) {
    const payload = {
      pageRequest: { pageNum: 1, pageSize: 50, req: { certificateNumber: cert, branchCode: branch } },
      serviceName: 'order',
    };
    const r = await api(P_LIST, payload, branch);
    if (!okOf(r)) throw new Error('列表查询失败 ' + errMsg(r));
    return ((r.json.data || {}).content) || [];
  }

  async function findOrders(cert, branchSpec) {
    const branches = String(branchSpec).split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
    const tried = [];
    let lastErr = null;
    for (const b of branches) {
      tried.push(b);
      try {
        const rows = await findOrdersOne(cert, b);
        if (rows.length) return { rows, branch: b, tried };
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr && branches.length === 1) throw lastErr;
    return { rows: [], branch: branches[0] || '', tried };
  }

  async function getDetail(vid, branch) {
    const r = await api(P_DETAIL, { vid, branchCode: branch }, branch);
    if (!okOf(r)) throw new Error('详情失败 ' + errMsg(r));
    const d = r.json.data;
    // 门店传错时接口照样返回 000000，但 data 为空 —— 这里必须拦住，否则后面读字段会崩
    if (!d || !d.vid) throw new Error('该门店下查不到这条记录（vid=' + vid + '，门店=' + branch + '）');
    return d;
  }

  async function saveOrder(body, branch) {
    const r = await api(P_SAVE, body, branch);
    if (!okOf(r)) throw new Error('保存失败 ' + errMsg(r));
    return r.json;
  }

  /**
   * 从订单侧刷新体检类型（等价于页面「体检类型」右侧那个刷新图标）。
   * operType = 0 表示刷体检类型；返回订单信息，取其中的 checkupType。
   * 该接口只读不写库（已实测：调用前后 detail.checkupType 不变）。
   */
  async function refreshCheckupType(vid, soaNo, branch) {
    const r = await api(P_REFRESH_TYPE, { branchCode: branch, vid: vid, soaOrderNo: soaNo, operType: 0 }, branch);
    if (!okOf(r)) throw new Error('刷新体检类型失败 ' + errMsg(r));
    return r.json.data || {};
  }

  // ============================================================
  // 模板：appointmentTime / fetchImageType / healthCardType / basePayType
  // 这 4 个字段不在 orderDetail 里，只能从页面真实保存请求中捕获
  // ============================================================
  const TPL_FIELDS = ['appointmentTime', 'fetchImageType', 'healthCardType', 'basePayType'];

  function extractTpl(body) {
    if (!body || !body.orderExtraRequest) return null;
    const oe = body.orderExtraRequest;
    const has = TPL_FIELDS.some((k) => oe[k] !== undefined && oe[k] !== null && oe[k] !== '');
    if (!has) return null;
    const tpl = { _at: new Date().toLocaleString('zh-CN'), _soa: body.soaOrderNo || '' };
    TPL_FIELDS.forEach((k) => { tpl[k] = oe[k]; });
    return tpl;
  }

  function captureTpl(body) {
    const tpl = extractTpl(body);
    if (!tpl) return;
    const all = readJSON(TPL_KEY, {});
    if (tpl._soa) all[tpl._soa] = tpl;
    all.__default__ = tpl;
    writeJSON(TPL_KEY, all);
    if (window[INSTANCE_KEY + '_hint']) window[INSTANCE_KEY + '_hint']();
  }

  function pickTpl(soaNo) {
    const all = readJSON(TPL_KEY, {});
    if (soaNo && all[soaNo]) return { tpl: all[soaNo], exact: true };
    if (all.__default__) return { tpl: all.__default__, exact: false };
    return { tpl: null, exact: false };
  }

  // 请求层钩子：捕获页面自己发的保存请求，自动学习模板
  function installTplHooks() {
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;

    XHR.open = function (method, url) {
      try { this.__rpUrl = String(url); } catch (e) { /* 忽略 */ }
      return origOpen.apply(this, arguments);
    };

    XHR.send = function (body) {
      try {
        if (typeof this.__rpUrl === 'string' && this.__rpUrl.indexOf('saveBaseCustomerInfo') >= 0 && typeof body === 'string') {
          captureTpl(JSON.parse(body));
        }
      } catch (e) { /* 忽略 */ }
      return origSend.apply(this, arguments);
    };

    if (typeof window.fetch === 'function') {
      const origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf('saveBaseCustomerInfo') >= 0 && init && typeof init.body === 'string') {
            captureTpl(JSON.parse(init.body));
          }
        } catch (e) { /* 忽略 */ }
        return origFetch.apply(this, arguments);
      };
    }
  }

  // ============================================================
  // 重建整单 body
  // saveBaseCustomerInfo 是整单覆盖：少传一个字段，库里就被置空（已实测）
  // ============================================================
  function num(v) {
    if (v === null || v === undefined || v === '') return v;
    const n = Number(v);
    return isNaN(n) ? v : n;
  }

  /**
   * undefined 必须转成 null。
   * 服务端部分记录不返回 customerType 等字段（已实测），
   * 而 JSON.stringify 会直接丢掉值为 undefined 的键 ——
   * 整单覆盖保存时该键不被提交，库里就会被清空。转成 null 才是"显式提交空值"。
   */
  function nullify(o) {
    if (o === undefined) return null;
    if (Array.isArray(o)) return o.map(nullify);
    if (o && typeof o === 'object') {
      const out = {};
      Object.keys(o).forEach((k) => { out[k] = nullify(o[k]); });
      return out;
    }
    return o;
  }

  function buildBody(d, tpl) {
    const ident = d.customerIdentity || {};
    const cust = ident.customer || {};
    const oe = d.orderExtraDTO || {};
    const t = tpl || {};

    const customer = {
      id: num(cust.id),
      picUrl: d.picUrl,
      replaceFlag: false,
      pregnantEnabled: d.pregnantEnabled,
      // customer 里是布尔，根级是数字 0/1 —— 与页面真实请求保持一致
      firstReport: !!d.firstReport,
      certificateType: cust.certificateType || d.certificateType,
      certificateNumber: cust.certificateNumber || d.certificateNumber,
      customerName: cust.customerName || d.customerName,
      maritalStatus: cust.maritalStatus || d.maritalStatus,
      gender: cust.gender || d.gender,
      birthday: cust.birthDate,
      age: num(cust.age || d.age),
      memberType: d.memberType,
      phone: cust.phone || d.customerPhone,
      customerType: d.customerType,
      checkCardNo: '',
      orderSourceCN: d.orderSourceCN,
      companyCode: d.companyCode,
      dept1: oe.dept1 || '',
      dept2: oe.dept2 || '',
      companyName: d.companyName,
      orderName: d.orderName,
      checkupHcRemark: oe.checkupHcRemark,
      customerAddress: cust.address,
      checkupType: d.checkupType,
      name: cust.customerName || d.customerName,
      customerUid: cust.uid || ident.customerUid,
      address: cust.address,
      keyPosition: '',
    };

    const orderExtra = {
      reportDeliveryType: oe.reportDeliveryType,
      networkReportType: oe.networkReportType,
      soaOrderNo: d.soaOrderNo,
      appointmentTime: t.appointmentTime,
      discount: num(d.discount),
      fetchImageType: t.fetchImageType,
      healthConsultant: oe.healthConsultant,
      healthCardType: t.healthCardType,
      basePayType: t.basePayType,
      id: d.id,
      uid: d.uid,
      dept1: oe.dept1 || '',
      dept2: oe.dept2 || '',
      healthConsultantPhone: oe.healthConsultantPhone,
      checkupHcRemark: oe.checkupHcRemark,
    };

    const reservation = {
      bookingDate: d.appointmentDate,
      bookingTimeSlot: d.appointmentTimeSlot,
      checkupType: d.checkupType,
      memberType: d.memberType,
      orderSource: d.orderSource,
      appointmentType: d.appointmentType,
      vid: d.vid,
      soaOrderType: d.soaOrderType,
    };

    return nullify({
      checkGroupType: d.checkGroupType,
      branchCode: d.branchCode,
      branchName: d.branchName,
      orderCenterCode: d.branchCode,
      soaOrderNo: d.soaOrderNo,
      picUrl: d.picPath,
      picPath: d.picPath,
      bucketName: d.bucketName,
      companyName: d.companyName,
      companyCode: d.companyCode,
      checkCardNo: '',
      replaceFlag: d.replaceFlag,
      customerType: d.customerType,
      customer,
      orderExtraRequest: orderExtra,
      reservationOrder: reservation,
      pregnantEnabled: d.pregnantEnabled,
      appointBranchCode: d.appointBranchCode,
      appointBranchName: d.appointBranchName,
      orderName: d.orderName,
      firstReport: d.firstReport ? 1 : 0,
      regionCode: d.regionCode,
      customerCompanyType: 1,
      checkinChannel: d.checkinChannel,
    });
  }

  // ============================================================
  // 金额保护
  // ============================================================
  /** 提取详情里的金额快照：折扣 + 每个套餐的价格与项目数、项目金额合计 */
  function moneySnapshot(d) {
    const pk = Array.isArray(d.packages) ? d.packages : [];
    const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const r2 = (x) => Math.round(x * 100) / 100;
    return {
      discount: Number(d.discount || 0),
      pkgs: pk.map((p) => {
        const items = p.details || [];
        return {
          uid: p.uid,
          name: p.packageName,
          checkPrice: r2(Number(p.checkPrice) || 0),
          settlementPrice: r2(Number(p.settlementPrice) || 0),
          receviceSettlePrice: r2(Number(p.receviceSettlePrice) || 0),
          itemCount: items.length,
          // 项目构成指纹：项目增删或替换都会变
          itemKeys: items.map((i) => String(i.itemCode) + ':' + String(i.itemUid)).join('|'),
          sumPrice: r2(sum(items, 'price')),
          sumSalePrice: r2(sum(items, 'salePrice')),
          sumSettlePrice: r2(sum(items, 'settlePrice')),
        };
      }),
    };
  }

  function moneyEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /**
   * 写前护栏：body 里不允许出现套餐数组，折扣必须与详情一致，
   * 任何金额类键的值都不能偏离详情。
   */
  function moneyGuard(body, detail) {
    const bad = [];
    if (body && Object.prototype.hasOwnProperty.call(body, 'packages')) {
      bad.push('body 意外包含 packages');
    }
    const bd = body && body.orderExtraRequest ? body.orderExtraRequest.discount : undefined;
    const dd = num(detail.discount);
    if (String(bd) !== String(dd)) bad.push('折扣不一致 ' + bd + ' ≠ ' + dd);

    // 兜底扫描：body 内所有金额类键，与详情同路径值比对
    const flatBody = flat(body);
    const flatDetail = flat(detail);
    Object.keys(flatBody).forEach((k) => {
      const leaf = k.split('.').pop();
      if (!MONEY_KEY_RE.test(leaf)) return;
      if (flatDetail[k] === undefined) return;           // 详情本来就没有，不比对
      const x = flatBody[k];
      const y = flatDetail[k];
      if (String(x) !== String(y) && Number(x) !== Number(y)) {
        bad.push(k + ' 变动 ' + x + ' ≠ ' + y);
      }
    });
    return bad;
  }

  // 扁平化 + 差异比较，用来确认「除了目标字段什么都没动」
  function flat(obj, prefix, out) {
    out = out || {};
    const walk = (o, p) => {
      if (o === null || o === undefined) { out[p] = o; return; }
      if (Array.isArray(o)) { out[p] = JSON.stringify(o); return; }
      if (typeof o === 'object') {
        Object.keys(o).forEach((k) => walk(o[k], p ? p + '.' + k : k));
        return;
      }
      out[p] = o;
    };
    walk(obj, prefix || '');
    return out;
  }

  function diffDetail(a, b) {
    const fa = flat(a);
    const fb = flat(b);
    const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
    const rows = [];
    keys.forEach((k) => {
      if (BENIGN_DIFF.has(k)) return;
      const va = fa[k];
      const vb = fb[k];
      const same = JSON.stringify(va) === JSON.stringify(vb);
      if (!same) rows.push({ key: k, before: va, after: vb });
    });
    return rows;
  }

  // ============================================================
  // 数据来源：按区间扫描
  // ============================================================
  /**
   * 按创建时间区间查询登记列表（serviceName=hcOrder）。
   * 自动按 84 天切段、每段翻页，绕过服务端 90 天/500 行限制。
   * onBatch(rows, meta) 每拿到一批就回调，用于边扫边收集。
   */
  async function scanRange(branch, baseReq, start, end, onBatch, log) {
    const segs = buildSegments(start, end, SEG_DAYS);
    let fetched = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i][0];
      const e = segs[i][1];
      let page = 1;
      let total = 0;
      do {
        if (log) log('扫描 ' + fmtDay(s) + ' ~ ' + fmtDay(e) + '（第 ' + (i + 1) + '/' + segs.length + ' 段，第 ' + page + ' 页）');
        const payload = {
          pageRequest: {
            pageNum: page,
            pageSize: PAGE_SIZE,
            req: Object.assign({}, baseReq, {
              branchCode: branch,
              createStartDate: fmtStamp(s, true),
              createEndDate: fmtStamp(e, false),
            }),
          },
          serviceName: 'hcOrder',
        };
        const r = await api(P_LIST, payload, branch);
        if (!okOf(r)) throw new Error('列表查询失败 ' + errMsg(r));
        const d = r.json.data || {};
        const rows = d.content || [];
        total = Number(d.totalSize || 0);
        fetched += rows.length;
        if (rows.length && onBatch) await onBatch(rows, { seg: i + 1, segs: segs.length, page: page, total: total });
        if (!rows.length) break;
        page++;
        await sleep(120);
      } while ((page - 1) * PAGE_SIZE < total);
    }
    return fetched;
  }

  function rowToTarget(row, input, branch) {
    const vid = String(row.vid || '');
    return {
      vid: vid,
      cert: '',
      name: row.name || row.customerName || '',
      soaNo: row.soaOrderNo || '',
      branch: branch,
      // 列表模式下列表返回的证件号是脱敏的，没有可用的「来源」值，用预约单号更直观
      input: input || vid,
      note: '',
    };
  }

  // ============================================================
  // 业务：单条处理
  // ============================================================
  function isVidLike(s) {
    return /^\d{13,17}$/.test(s);
  }

  async function resolveTargets(input, branch, opts) {
    const s = String(input).trim();
    if (!s) return [];

    if (isVidLike(s) && !opts.forceCert) {
      return [{ vid: s, cert: '', name: '', soaNo: '', branch: '', input: s, multi: false, note: '' }];
    }

    const biz = await findOrders(s, branch);
    const rows = biz.rows;
    if (!rows.length) return [];

    let use = rows;
    if (rows.length > 1 && opts.latestOnly) {
      use = rows.slice().sort((x, y) => String(y.appointmentDate || '').localeCompare(String(x.appointmentDate || ''))).slice(0, 1);
    }
    return use.map((r) => ({
      vid: r.vid,
      cert: s,
      name: r.name || '',
      soaNo: r.soaOrderNo || '',
      branch: biz.branch,
      input: s,
      multi: rows.length > 1,
      note: rows.length > 1 ? '该人共 ' + rows.length + ' 单' : '',
    }));
  }

  /**
   * 处理一条：
   *  1) 取详情（唯一真值来源）
   *  2) 需要刷体检类型时先调刷新接口拿到订单侧的值
   *  3) 两个字段都已是目标值 => 跳过，不提交
   *  4) 重建整单 -> 金额护栏 -> 提交 -> 回读 -> 三项校验（网络报告/体检类型/金额）
   */
  async function runOne(target, ctx) {
    const branch = target.branch || ctx.branch;
    const out = {
      input: target.input || target.cert || target.vid,
      name: target.name || '',
      vid: target.vid,
      soaNo: '',
      netBefore: '',
      netAfter: '',
      typeBefore: '',
      typeAfter: '',
      result: '',
      note: target.note || '',
    };

    let detail;
    try {
      detail = await getDetail(target.vid, branch);
    } catch (e) {
      out.result = '失败';
      out.note = '取详情失败：' + e.message;
      return out;
    }

    out.name = detail.customerName || out.name;
    out.soaNo = detail.soaOrderNo || '';
    const rawNet = (detail.orderExtraDTO || {}).networkReportType;
    out.netBefore = (rawNet === undefined || rawNet === null) ? '' : String(rawNet);
    out.typeBefore = detail.checkupType === undefined || detail.checkupType === null ? '' : String(detail.checkupType);
    out.netAfter = out.netBefore;
    out.typeAfter = out.typeBefore;

    // 分院守卫：只改指定分院，跨院的直接跳过
    if (detail.branchCode && branch && detail.branchCode !== branch) {
      out.result = '跳过';
      out.note = '分院不符（记录在 ' + detail.branchCode + '，指定 ' + branch + '）';
      return out;
    }

    // 1) 体检类型：从订单侧刷新
    let wantType = detail.checkupType;
    if (ctx.doType) {
      let rd;
      try {
        rd = await refreshCheckupType(target.vid, detail.soaOrderNo, branch);
      } catch (e) {
        out.result = '失败';
        out.note = e.message;
        return out;
      }
      if (rd.checkupType === undefined || rd.checkupType === null || rd.checkupType === '') {
        out.result = '失败';
        out.note = '订单侧未返回体检类型，已跳过（不清空原值 ' + out.typeBefore + '）';
        return out;
      }
      wantType = rd.checkupType;
      out.typeAfter = String(wantType);
    }

    const netChanged = ctx.doNet && String(out.netBefore) !== String(ctx.netTarget);
    const typeChanged = ctx.doType && String(wantType) !== String(out.typeBefore);
    if (ctx.doNet) out.netAfter = String(ctx.netTarget);

    if (!netChanged && !typeChanged) {
      out.result = '跳过';
      out.note = (out.note ? out.note + '；' : '') + '本就是目标值';
      return out;
    }

    const picked = pickTpl(detail.soaOrderNo);
    if (!picked.tpl) {
      out.result = '失败';
      out.note = '缺少模板：请在页面手动保存一次任意登记，让脚本捕获 4 个订单级字段';
      return out;
    }
    if (!picked.exact) {
      out.note = (out.note ? out.note + '；' : '') + '用通用模板';
    }

    // 2) 重建整单（体检类型只改 d.checkupType 一处，body 三处引用同源）
    const eff = Object.assign({}, detail, { checkupType: wantType });
    const body = buildBody(eff, picked.tpl);
    if (ctx.doNet) body.orderExtraRequest.networkReportType = ctx.netTarget;

    // 3) 金额护栏
    const moneyBad = moneyGuard(body, detail);
    if (moneyBad.length) {
      out.result = '失败';
      out.note = '金额保护拦截：' + moneyBad.slice(0, 3).join('；');
      return out;
    }

    if (ctx.dry) {
      out.result = '可改（干跑）';
      out.note = (out.note ? out.note + '；' : '')
        + '网络报告 ' + out.netBefore + '→' + out.netAfter
        + '，体检类型 ' + out.typeBefore + '→' + out.typeAfter;
      return out;
    }

    const money0 = moneySnapshot(detail);
    try {
      await saveOrder(body, branch);
    } catch (e) {
      out.result = '失败';
      out.note = (out.note ? out.note + '；' : '') + e.message;
      return out;
    }

    await sleep(200);

    let after;
    try {
      after = await getDetail(target.vid, branch);
    } catch (e) {
      out.result = '已提交待复核';
      out.note = (out.note ? out.note + '；' : '') + '回读失败，请手动核对';
      return out;
    }

    const nowNet = String((after.orderExtraDTO || {}).networkReportType);
    const nowType = after.checkupType === undefined || after.checkupType === null ? '' : String(after.checkupType);
    if (ctx.doNet) out.netAfter = nowNet;
    if (ctx.doType) out.typeAfter = nowType;

    const netOk = !ctx.doNet || Number(nowNet) === Number(ctx.netTarget);
    const typeOk = !ctx.doType || nowType === String(wantType);
    const money1 = moneySnapshot(after);
    const moneyOk = moneyEqual(money0, money1);

    if (!moneyOk) {
      out.result = '金额变动';
      out.note = (out.note ? out.note + '；' : '') + '套餐/折扣与写入前不一致，必须人工核对！';
      return out;
    }
    if (!netOk || !typeOk) {
      out.result = '失败';
      out.note = (out.note ? out.note + '；' : '') + '回读值不符：网络报告 ' + nowNet + '，体检类型 ' + nowType;
      return out;
    }

    const d = diffDetail(detail, after);
    const odd = d.filter((x) => {
      if (x.key.indexOf('networkReportType') >= 0) return false;
      if (x.key.indexOf('checkupType') >= 0) return false;
      // packages 整体序列化会因为审计字段/itemSource 异步刷新产生瞬时差异，
      // 已由上面的金额+项目指纹快照做结构化比对，这里不再重复报警
      if (x.key === 'packages') return false;
      if ((x.before === '' || x.before === null || x.before === undefined)
        && (x.after === '' || x.after === null || x.after === undefined)) return false;
      return true;
    });
    if (odd.length) {
      out.result = '成功(有差异)';
      out.note = (out.note ? out.note + '；' : '') + '其他字段变动 ' + odd.length + ' 处：'
        + odd.slice(0, 3).map((x) => x.key).join(', ');
    } else {
      out.result = '成功';
    }
    return out;
  }

  // ============================================================
  // UI
  // ============================================================
  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap { font-family: -apple-system, "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 13px; color: #1f2329; }
  .fab {
    position: fixed; right: 18px; bottom: 18px; width: 50px; height: 50px; border-radius: 50%;
    background: linear-gradient(135deg,#2d6cf6,#1b4fd1); color: #fff; border: none; cursor: pointer;
    box-shadow: 0 6px 18px rgba(27,79,209,.38); font-size: 13px; font-weight: 600; line-height: 1.1;
    display: flex; align-items: center; justify-content: center; text-align: center; z-index: 2147483000;
  }
  .fab:hover { transform: translateY(-1px); }
  .panel {
    position: fixed; right: 18px; bottom: 78px; width: 720px; max-height: calc(100vh - 110px);
    background: #fff; border: 1px solid #e3e6eb; border-radius: 12px;
    box-shadow: 0 14px 44px rgba(0,0,0,.18); display: none; flex-direction: column;
    z-index: 2147483000; overflow: hidden;
  }
  .panel.open { display: flex; }
  .hd {
    display: flex; align-items: center; gap: 10px; padding: 12px 14px;
    background: #f7f9fc; border-bottom: 1px solid #e9edf3; flex: 0 0 auto;
  }
  .hd b { font-size: 14px; }
  .hd .sp { flex: 1; }
  .hd .x { border: none; background: transparent; font-size: 18px; color: #8a919e; cursor: pointer; padding: 0 4px; }
  .bd { padding: 12px 14px; overflow: auto; }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .row > label { color: #5b6472; white-space: nowrap; }
  input[type=text], input[type=date], select, textarea {
    border: 1px solid #d6dbe3; border-radius: 6px; padding: 5px 8px; font-size: 13px;
    font-family: inherit; color: #1f2329; background: #fff; outline: none;
  }
  input[type=text]:focus, input[type=date]:focus, select:focus, textarea:focus { border-color: #2d6cf6; }
  textarea { width: 100%; height: 96px; resize: vertical; font-family: Consolas, "Courier New", monospace; line-height: 1.55; }
  .btn {
    border: 1px solid #d6dbe3; background: #fff; color: #1f2329; border-radius: 6px;
    padding: 6px 14px; font-size: 13px; cursor: pointer; font-family: inherit;
  }
  .btn:hover { border-color: #2d6cf6; color: #2d6cf6; }
  .btn.primary { background: #2d6cf6; border-color: #2d6cf6; color: #fff; }
  .btn.primary:hover { background: #1b4fd1; color: #fff; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .hint { color: #8a919e; font-size: 12px; line-height: 1.7; }
  .hint.ok { color: #1a9c5b; }
  .hint.warn { color: #d97706; }
  .tabs { display: flex; gap: 6px; margin-bottom: 10px; }
  .tab {
    border: 1px solid #d6dbe3; background: #fff; color: #5b6472; border-radius: 6px;
    padding: 4px 12px; font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .tab.on { background: #eaf1ff; border-color: #2d6cf6; color: #1b4fd1; font-weight: 600; }
  .srcbox { margin-bottom: 6px; }
  .tpl {
    background: #f7f9fc; border: 1px solid #e9edf3; border-radius: 8px;
    padding: 8px 10px; font-size: 12px; color: #5b6472; margin-bottom: 10px; line-height: 1.7;
    white-space: pre-wrap; word-break: break-all;
  }
  .tpl b { color: #1f2329; font-weight: 600; }
  .stat { display: flex; gap: 14px; margin: 8px 0; font-size: 12px; color: #5b6472; }
  .stat i { font-style: normal; font-weight: 600; color: #1f2329; }
  .bar { height: 4px; background: #eef1f6; border-radius: 2px; overflow: hidden; margin: 6px 0 10px; }
  .bar > div { height: 100%; width: 0; background: #2d6cf6; transition: width .2s; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #eef1f6; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f7f9fc; color: #5b6472; font-weight: 500; position: sticky; top: 0; }
  td.mono { font-family: Consolas, monospace; }
  .s-success { color: #1a9c5b; }
  .s-fail { color: #d9363e; }
  .s-skip { color: #8a919e; }
  .s-warn { color: #d97706; }
  .s-money { color: #d9363e; font-weight: 700; }
  .tblbox { max-height: 260px; overflow: auto; border: 1px solid #eef1f6; border-radius: 8px; }
  .ft { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid #e9edf3; background: #fbfcfe; flex: 0 0 auto; }
  .log { font-size: 12px; color: #8a919e; height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ck { display: inline-flex; align-items: center; gap: 4px; color: #1f2329; }
  `;

  const HTML = `
  <div class="wrap">
    <button class="fab" id="fab">基础<br>信息</button>
    <div class="panel" id="panel">
      <div class="hd">
        <b>基础信息 · 批量修改</b>
        <span class="sp"></span>
        <span class="hint" id="hdHint"></span>
        <button class="x" id="close">×</button>
      </div>
      <div class="bd">
        <div class="tabs">
          <button class="tab on" data-src="list">名单（证件号/预约号）</button>
          <button class="tab" data-src="order">按订单号</button>
          <button class="tab" data-src="company">按单位 + 创建时间</button>
        </div>

        <div class="srcbox" id="srcList">
          <textarea id="inputList" placeholder="每行一个：身份证号 或 预约单号（13~17 位数字）
410725198609262827
71328779774500"></textarea>
        </div>

        <div class="srcbox" id="srcOrder" style="display:none">
          <textarea id="inputOrder" style="height:64px" placeholder="每行一个订单号（SOA 开头）
SOA37816774977360413"></textarea>
          <div class="row" style="margin-top:8px">
            <label>创建时间</label>
            <input type="date" id="orderStart" />
            <span class="hint">~</span>
            <input type="date" id="orderEnd" />
            <span class="hint">超过 84 天自动分段查询</span>
          </div>
        </div>

        <div class="srcbox" id="srcCompany" style="display:none">
          <div class="row">
            <label>单位代码</label>
            <input type="text" id="companyCode" style="width:220px" placeholder="如 4371349568690012" />
          </div>
          <div class="row">
            <label>创建时间</label>
            <input type="date" id="compStart" />
            <span class="hint">~</span>
            <input type="date" id="compEnd" />
            <span class="hint">超过 84 天自动分段查询</span>
          </div>
        </div>

        <div class="row">
          <label>门店</label>
          <input type="text" id="branch" style="width:88px" title="只处理该分院；查询到的记录分院不符会跳过" />
          <span class="hint">只动这个分院的数据（分院不符自动跳过）</span>
        </div>

        <div class="row">
          <label>改什么</label>
          <label class="ck"><input type="checkbox" id="doNet" checked /> 网络报告</label>
          <select id="target"></select>
          <label class="ck"><input type="checkbox" id="doType" /> 刷新体检类型</label>
          <label class="ck" style="margin-left:auto"><input type="checkbox" id="latestOnly" /> 多单只改最新</label>
        </div>

        <div class="tpl" id="tplBox"></div>

        <div class="row">
          <button class="btn" id="btnDry">干跑预览</button>
          <button class="btn primary" id="btnRun">开始执行</button>
          <button class="btn" id="btnExport" disabled>导出 CSV</button>
          <button class="btn" id="btnSelf">自检</button>
          <span style="flex:1"></span>
          <span class="hint" id="cnt"></span>
        </div>

        <div class="bar"><div id="prog"></div></div>
        <div class="stat" id="stat" style="display:none"></div>
        <div class="log" id="log">就绪</div>

        <div class="tblbox" id="tblbox" style="display:none">
          <table>
            <thead><tr>
              <th style="width:26px">#</th><th style="width:120px">来源</th><th style="width:70px">姓名</th>
              <th style="width:120px">预约单号</th><th style="width:88px">网络报告</th><th style="width:86px">体检类型</th>
              <th style="width:84px">结果</th><th>备注</th>
            </tr></thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </div>
      <div class="ft">
        <span class="hint" style="margin-right:auto">写前重建整单 + 金额护栏，写后回读三校验</span>
        <button class="btn" id="btnRetry">回填失败项</button>
        <button class="btn" id="btnClear">清空结果</button>
      </div>
    </div>
  </div>
  `;

  let shadow = null;
  let els = {};
  let running = false;
  let results = [];
  let curSrc = 'list';

  function buildUI() {
    const host = document.createElement('div');
    host.id = 'soa-baseinfo-batch-host';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;

    shadow.querySelector('.fab').style.pointerEvents = 'auto';
    shadow.querySelector('.panel').style.pointerEvents = 'auto';

    document.documentElement.appendChild(host);

    const $ = (id) => shadow.getElementById(id);
    els = {
      fab: $('fab'), panel: $('panel'), close: $('close'),
      branch: $('branch'), target: $('target'), latestOnly: $('latestOnly'),
      doNet: $('doNet'), doType: $('doType'),
      tplBox: $('tplBox'), inputList: $('inputList'), inputOrder: $('inputOrder'),
      orderStart: $('orderStart'), orderEnd: $('orderEnd'),
      companyCode: $('companyCode'), compStart: $('compStart'), compEnd: $('compEnd'),
      btnDry: $('btnDry'), btnRun: $('btnRun'), btnExport: $('btnExport'),
      btnClear: $('btnClear'), btnRetry: $('btnRetry'), btnSelf: $('btnSelf'),
      cnt: $('cnt'), prog: $('prog'), stat: $('stat'), log: $('log'), hdHint: $('hdHint'),
      tblbox: $('tblbox'), tbody: $('tbody'),
    };

    NET_TARGETS.forEach((t) => {
      const o = document.createElement('option');
      o.value = String(t.v);
      o.textContent = t.label;
      els.target.appendChild(o);
    });

    const cfg = readJSON(CFG_KEY, {});
    const today = new Date();
    const yearAgo = addDays(today, -365);

    els.branch.value = cfg.branch || detectBranch();
    els.target.value = String(cfg.netTarget === undefined ? 2 : cfg.netTarget);
    els.latestOnly.checked = !!cfg.latestOnly;
    els.doNet.checked = cfg.doNet === undefined ? true : !!cfg.doNet;
    els.doType.checked = !!cfg.doType;
    els.companyCode.value = cfg.companyCode || '';
    els.orderStart.value = cfg.orderStart || fmtDay(yearAgo);
    els.orderEnd.value = cfg.orderEnd || fmtDay(today);
    els.compStart.value = cfg.compStart || fmtDay(yearAgo);
    els.compEnd.value = cfg.compEnd || fmtDay(today);

    // 数据来源切换
    shadow.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => switchSrc(btn.getAttribute('data-src')));
    });

    els.fab.addEventListener('click', () => els.panel.classList.toggle('open'));
    els.close.addEventListener('click', () => els.panel.classList.remove('open'));

    els.inputList.addEventListener('input', updateCount);
    els.inputOrder.addEventListener('input', updateCount);
    ['branch', 'target', 'latestOnly', 'doNet', 'doType',
      'companyCode', 'orderStart', 'orderEnd', 'compStart', 'compEnd'].forEach((k) => {
      els[k].addEventListener('change', persistCfg);
    });

    els.btnDry.addEventListener('click', () => start(true));
    els.btnRun.addEventListener('click', () => start(false));
    els.btnExport.addEventListener('click', exportCSV);
    els.btnClear.addEventListener('click', () => {
      results = [];
      els.tblbox.style.display = 'none';
      els.stat.style.display = 'none';
      els.prog.style.width = '0';
      els.btnExport.disabled = true;
    });

    els.btnRetry.addEventListener('click', () => {
      const bad = results.filter((r) => {
        if (r.result.indexOf('失败') === 0) return true;
        if (r.result.indexOf('待确认') >= 0 || r.result.indexOf('待复核') >= 0) return true;
        if (r.result.indexOf('金额变动') === 0) return true;
        return false;
      });
      if (!bad.length) { alert('没有失败项'); return; }
      const seen = new Set();
      const lines = [];
      bad.forEach((r) => {
        const v = r.vid || r.input;
        if (v && !seen.has(v)) { seen.add(v); lines.push(v); }
      });
      // 失败项一律回到「名单」模式，用预约单号/证件号重跑最稳
      switchSrc('list');
      els.inputList.value = lines.join('\n');
      updateCount();
      alert('已回填 ' + lines.length + ' 条失败记录（来源已切到名单）');
    });

    els.btnSelf.addEventListener('click', doSelfCheck);

    window.addEventListener('storage', (e) => {
      if (e.key === TPL_KEY) refreshTplBox();
    });

    window[INSTANCE_KEY + '_hint'] = refreshTplBox;
    switchSrc(cfg.src || 'list', true);
    refreshTplBox();
    updateCount();
  }

  function switchSrc(src, silent) {
    curSrc = src || 'list';
    shadow.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-src') === curSrc);
    });
    els.inputList.parentNode.style.display = curSrc === 'list' ? '' : 'none';
    els.inputOrder.parentNode.style.display = curSrc === 'order' ? '' : 'none';
    els.companyCode.closest('.srcbox').style.display = curSrc === 'company' ? '' : 'none';
    if (!silent) persistCfg();
    updateCount();
  }

  function persistCfg() {
    writeJSON(CFG_KEY, {
      src: curSrc,
      branch: els.branch.value.trim(),
      netTarget: Number(els.target.value),
      latestOnly: els.latestOnly.checked,
      doNet: els.doNet.checked,
      doType: els.doType.checked,
      companyCode: els.companyCode.value.trim(),
      orderStart: els.orderStart.value,
      orderEnd: els.orderEnd.value,
      compStart: els.compStart.value,
      compEnd: els.compEnd.value,
    });
  }

  function activeLines() {
    const box = curSrc === 'list' ? els.inputList : curSrc === 'order' ? els.inputOrder : null;
    if (!box) return [];
    return box.value.split('\n').map((x) => x.trim()).filter((x) => x && x[0] !== '#');
  }

  function updateCount() {
    if (!els.cnt) return;
    if (curSrc === 'company') {
      const n = els.companyCode.value.trim();
      els.cnt.textContent = n ? '单位 ' + n : '';
      return;
    }
    const n = activeLines().length;
    els.cnt.textContent = n ? n + ' 条' : '';
  }

  function refreshTplBox() {
    if (!els.tplBox) return;
    const all = readJSON(TPL_KEY, {});
    const def = all.__default__;
    if (!def) {
      els.tplBox.innerHTML = '<b>模板缺失</b>\n'
        + '脚本需要 4 个订单级字段（预约时间范围 / 图像获取方式 / 体检卡类型 / 支付方式），详情接口不返回。\n'
        + '请在页面上随便打开一条登记，点一次「保存基础信息」（不改任何值即可），脚本会自动记下来。';
      els.hdHint.textContent = '模板缺失';
      els.hdHint.className = 'hint warn';
      return;
    }
    const keys = Object.keys(all).filter((k) => k !== '__default__');
    els.tplBox.innerHTML = '<b>模板已就绪</b>（' + def._at + '，覆盖订单 ' + keys.length + ' 个）\n'
      + '\u2003有效期: ' + JSON.stringify(def.appointmentTime || null) + '\n'
      + '\u2003图像: ' + (def.fetchImageType || '-')
      + '\u3000卡类型: ' + (def.healthCardType || '-')
      + '\u3000支付: ' + (def.basePayType || '-');
    els.hdHint.textContent = '模板已就绪';
    els.hdHint.className = 'hint ok';
  }

  function setLog(s) {
    els.log.textContent = s;
    els.log.title = s;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function arrow(a, b) {
    if (a === b) return a || '-';
    return (a || '-') + '→' + (b || '-');
  }

  function renderRow(i, r) {
    const tr = document.createElement('tr');
    const cls = r.result.indexOf('成功') === 0 ? 's-success'
      : r.result.indexOf('金额变动') === 0 ? 's-money'
        : r.result.indexOf('失败') === 0 ? 's-fail'
          : r.result.indexOf('跳过') === 0 ? 's-skip' : 's-warn';
    tr.innerHTML = '<td>' + i + '</td>'
      + '<td class="mono">' + esc(r.input) + '</td>'
      + '<td>' + esc(r.name) + '</td>'
      + '<td class="mono">' + esc(r.vid) + '</td>'
      + '<td class="mono">' + esc(arrow(r.netBefore, r.netAfter)) + '</td>'
      + '<td class="mono">' + esc(arrow(r.typeBefore, r.typeAfter)) + '</td>'
      + '<td class="' + cls + '">' + esc(r.result) + '</td>'
      + '<td>' + esc(r.note) + '</td>';
    els.tbody.appendChild(tr);
  }

  function updateStat() {
    const c = { ok: 0, skip: 0, fail: 0, money: 0, warn: 0 };
    results.forEach((r) => {
      if (r.result.indexOf('成功') === 0) c.ok++;
      else if (r.result.indexOf('跳过') === 0) c.skip++;
      else if (r.result.indexOf('金额变动') === 0) c.money++;
      else if (r.result.indexOf('失败') === 0) c.fail++;
      else c.warn++;
    });
    els.stat.style.display = 'flex';
    els.stat.innerHTML = '成功 <i class="s-success">' + c.ok + '</i>'
      + '　跳过 <i>' + c.skip + '</i>'
      + '　失败 <i class="s-fail">' + c.fail + '</i>'
      + (c.money ? '　<i class="s-money">金额变动 ' + c.money + '</i>' : '')
      + (c.warn ? '　待确认 <i class="s-warn">' + c.warn + '</i>' : '');
  }

  // 自检：确认登录态、签名、门店、模板，不写任何数据
  async function doSelfCheck() {
    if (running) return;
    const branch = els.branch.value.trim() || detectBranch();
    setLog('自检中…');
    const out = [];
    try {
      const ts = String(serverNow());
      const sign = await sha256Hex(MN_CLIENT + ts + SIGN_SECRET);
      out.push('门店编码：' + branch);
      out.push('签名：' + sign.slice(0, 16) + '…（长度 ' + sign.length + '）');
      out.push('时间戳：' + ts);

      const r = await api(P_DETAIL, { vid: '0', branchCode: branch }, branch);
      if (r.json && r.json.code !== undefined) {
        out.push('接口连通：✔  code=' + r.json.code + '  msg=' + (r.json.msg || '-'));
      } else {
        out.push('接口异常：✘  返回非业务 JSON（HTTP ' + r.status + '），可能是登录态失效');
        out.push('原始返回：' + r.text.slice(0, 120));
      }

      // 用一次真实区间查询验证列表接口与分段参数
      const today = new Date();
      const s = addDays(today, -6);
      const p = {
        pageRequest: {
          pageNum: 1, pageSize: 1, req: {
            branchCode: branch,
            createStartDate: fmtStamp(s, true),
            createEndDate: fmtStamp(today, false),
          },
        },
        serviceName: 'hcOrder',
      };
      const r2 = await api(P_LIST, p, branch);
      if (okOf(r2)) {
        out.push('区间查询：✔  近 7 天共 ' + ((r2.json.data || {}).totalSize || 0) + ' 条');
      } else {
        out.push('区间查询：✘  ' + errMsg(r2));
      }

      const tpl = readJSON(TPL_KEY, {}).__default__;
      out.push('模板：' + (tpl
        ? '✔ 已就绪（' + tpl._at + '）'
        : '✘ 缺失 —— 请打开任意登记，点一次「保存基础信息」'));
      if (tpl) {
        out.push('  有效期 ' + JSON.stringify(tpl.appointmentTime));
        out.push('  图像 ' + tpl.fetchImageType + ' ｜ 卡类型 ' + tpl.healthCardType + ' ｜ 支付 ' + tpl.basePayType);
      }
    } catch (e) {
      out.push('自检异常：✘ ' + e.message);
    }
    setLog('自检完成');
    alert(out.join('\n'));
  }

  // ============================================================
  // 主流程
  // ============================================================
  async function collectTargets(ctx) {
    const list = [];
    const seen = new Set();
    const push = (t) => {
      if (!t.vid || seen.has(t.vid)) return;
      seen.add(t.vid);
      list.push(t);
    };

    if (curSrc === 'list') {
      const lines = activeLines();
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        setLog('[' + (i + 1) + '/' + lines.length + '] 解析 ' + line);
        let targets = [];
        try {
          targets = await resolveTargets(line, ctx.branchReq, { latestOnly: ctx.latestOnly });
        } catch (e) {
          results.push({
            input: line, name: '', vid: '', netBefore: '', netAfter: '', typeBefore: '', typeAfter: '',
            result: '失败', note: '查询异常：' + e.message,
          });
          renderRow(results.length, results[results.length - 1]);
          updateStat();
          continue;
        }
        if (!targets.length) {
          results.push({
            input: line, name: '', vid: '', netBefore: '', netAfter: '', typeBefore: '', typeAfter: '',
            result: '失败',
            note: '门店 ' + ctx.branchReq + ' 下无记录：可填多个门店（逗号分隔）重试，或直接贴预约单号',
          });
          renderRow(results.length, results[results.length - 1]);
          updateStat();
          continue;
        }
        targets.forEach(push);
      }
      return list;
    }

    if (curSrc === 'order') {
      const soaList = activeLines().map((x) => x.toUpperCase());
      if (!soaList.length) throw new Error('先填订单号');
      const start = parseDay(els.orderStart.value);
      const end = parseDay(els.orderEnd.value);
      if (!start || !end || start > end) throw new Error('创建时间区间不合法');

      const want = new Set(soaList);
      for (const soa of soaList) {
        const before = list.length;
        setLog('扫描订单 ' + soa);
        await scanRange(ctx.branch, { soaOrderNo: soa }, start, end, async (rows) => {
          rows.forEach((row) => {
            const no = String(row.soaOrderNo || '');
            if (!want.has(no)) return;
            if (ctx.branch && row.branchCode && row.branchCode !== ctx.branch) return;
            push(rowToTarget(row, soa, ctx.branch));
          });
        }, (s) => setLog(soa + ' · ' + s));
        if (list.length === before) {
          // 订单模式必须带创建时间区间（服务端强制要求），扫不到时给明确提示，不静默漏人
          results.push({
            input: soa, name: '', vid: '', netBefore: '', netAfter: '', typeBefore: '', typeAfter: '',
            result: '失败',
            note: '该创建时间区间内没找到本订单的人：放宽时间范围，或确认门店/订单号是否正确',
          });
          renderRow(results.length, results[results.length - 1]);
          updateStat();
        }
      }
      return list;
    }

    // 单位 + 区间
    const code = els.companyCode.value.trim();
    if (!code) throw new Error('先填单位代码');
    const start = parseDay(els.compStart.value);
    const end = parseDay(els.compEnd.value);
    if (!start || !end || start > end) throw new Error('创建时间区间不合法');

    const beforeUnit = list.length;
    await scanRange(ctx.branch, { companyCode: code }, start, end, async (rows) => {
      rows.forEach((row) => {
        if (ctx.branch && row.branchCode && row.branchCode !== ctx.branch) return;
        push(rowToTarget(row, '', ctx.branch));
      });
    }, setLog);
    if (list.length === beforeUnit) {
      results.push({
        input: code, name: '', vid: '', netBefore: '', netAfter: '', typeBefore: '', typeAfter: '',
        result: '失败',
        note: '该单位在 ' + ctx.branch + ' 门店、该创建时间区间内没有登记记录：换个区间或确认门店编码',
      });
      renderRow(results.length, results[results.length - 1]);
      updateStat();
    }
    return list;
  }

  async function start(dry) {
    if (running) return;

    const branchRaw = els.branch.value.trim();
    if (!branchRaw) { alert('门店编码不能为空'); return; }
    const branchList = branchRaw.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
    // 单位/订单模式只认第一个门店（避免误扫），名单模式允许多门店依次尝试
    const branch = branchList[0];

    const doNet = els.doNet.checked;
    const doType = els.doType.checked;
    if (!doNet && !doType) { alert('至少勾选一个修改项'); return; }

    if (curSrc === 'list' && !activeLines().length) { alert('先贴名单'); return; }
    if (curSrc === 'order' && !activeLines().length) { alert('先填订单号'); return; }
    if (curSrc === 'company' && !els.companyCode.value.trim()) { alert('先填单位代码'); return; }

    const picked = readJSON(TPL_KEY, {});
    if (!picked.__default__) {
      alert('模板还没捕获。\n\n请在页面上打开任意一条登记，点一次「保存基础信息」（不改值也行），再回来跑。');
      return;
    }

    running = true;
    persistCfg();
    els.btnDry.disabled = els.btnRun.disabled = true;
    els.tblbox.style.display = '';
    els.tbody.innerHTML = '';
    results = [];
    els.btnExport.disabled = true;
    els.prog.style.width = '0';
    els.stat.style.display = 'none';

    const ctx = {
      branch: branch,
      branchReq: branchRaw,
      netTarget: Number(els.target.value),
      doNet: doNet,
      doType: doType,
      dry: dry,
      latestOnly: els.latestOnly.checked,
    };

    try {
      // 1) 收集目标
      setLog('收集目标…');
      const targets = await collectTargets(ctx);
      setLog('共 ' + targets.length + ' 条待处理');
      if (!targets.length) {
        setLog('没有可处理的数据');
        return;
      }
      if (!dry && targets.length > 200) {
        const ok = confirm('本次将写入 ' + targets.length + ' 条记录，确认继续？\n（建议先干跑预览）');
        if (!ok) { setLog('已取消'); return; }
      }

      // 2) 逐条处理
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        setLog('[' + (i + 1) + '/' + targets.length + '] ' + (t.name || t.vid) + ' → ' + t.vid);
        const r = await runOne(t, ctx);
        results.push(r);
        renderRow(results.length, r);
        updateStat();
        els.prog.style.width = ((i + 1) / targets.length * 100) + '%';
        await sleep(240);
      }
      setLog(dry ? '干跑完成，未写入任何数据' : '执行完成');
    } catch (e) {
      setLog('中断：' + e.message);
    } finally {
      running = false;
      els.btnDry.disabled = els.btnRun.disabled = false;
      els.btnExport.disabled = results.length === 0;
    }
  }

  function exportCSV() {
    const head = ['来源', '姓名', '预约单号', '网络报告改前', '网络报告改后', '体检类型改前', '体检类型改后', '结果', '备注'];
    const rows = results.map((r) => [r.input, r.name, r.vid, r.netBefore, r.netAfter, r.typeBefore, r.typeAfter, r.result, r.note]);
    const csv = [head].concat(rows)
      .map((row) => row.map((c) => '"' + String(c === undefined || c === null ? '' : c).replace(/"/g, '""') + '"').join(','))
      .join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '基础信息批量_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // ============================================================
  // 启动
  // ============================================================
  installTplHooks();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI, { once: true });
  } else {
    buildUI();
  }
})();
