// ==UserScript==
// @name         扁鹊-1.6制卡管理查询
// @namespace    https://tampermonkey.net/
// @version      0.3.0
// @description  查询并汇总本年度的邀约、贵宾、核磁、CT等制卡记录，按部门/人员统计办卡进度。
// @match        https://checkup-soa3.health-100.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-zhikaguanli
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-zhikaguanli.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-zhikaguanli.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 0. 独立命名空间。避免与 1.2 / 1.3 / 1.4 / 1.5 页面级资源撞名
  // ============================================================
  const NS = '__hlj_card_summary_v020';
  const IDS = {
    switch: `${NS}_switch`,
    switchSlot: `${NS}_switch_slot`,
    panel: `${NS}_panel`,
    body: `${NS}_body`,
    status: `${NS}_status`,
    result: `${NS}_result`,
    query: `${NS}_query`,
    collapse: `${NS}_collapse`,
    close: `${NS}_close`,
  };

  const TOP_TOOL_GROUP_ID = '__hlj_soa_top_tool_group_v1';

  const CACHE_KEY = `${NS}_cache`;
  const CACHE_SCHEMA = 2;

  const PROCESS_API = '/soa-card/api/v1/bqcard/process/page';
  const POOL_API = '/soa-card/api/v1/card/business/pool/display';

  const PAGE_SIZE = 100;
  const SERIAL_DIGITS = 5;

  const ORDER_NAMES = [
    '新乡邀约体验2026贵宾检',
    '新乡邀约体验2023贵宾检',
  ];

  const PERSONNEL_PLAN = [
  {
    "department": "销售一部",
    "name": "郭建英",
    "plan": 12
  },
  {
    "department": "销售一部",
    "name": "花秀玲",
    "plan": 9
  },
  {
    "department": "销售一部",
    "name": "郎长顺",
    "plan": 20
  },
  {
    "department": "销售一部",
    "name": "牛新芝",
    "plan": 30
  },
  {
    "department": "销售一部",
    "name": "宋琳",
    "plan": 17
  },
  {
    "department": "销售一部",
    "name": "张雪梅",
    "plan": 20
  },
  {
    "department": "销售一部",
    "name": "朱振强",
    "plan": 30
  },
  {
    "department": "销售二部",
    "name": "李国宇",
    "plan": 36
  },
  {
    "department": "销售二部",
    "name": "柴玉忠",
    "plan": 23
  },
  {
    "department": "销售二部",
    "name": "梁学梅",
    "plan": 8
  },
  {
    "department": "销售二部",
    "name": "陆继文",
    "plan": 14
  },
  {
    "department": "销售二部",
    "name": "孙宴",
    "plan": 20
  },
  {
    "department": "销售二部",
    "name": "王家风",
    "plan": 19
  },
  {
    "department": "销售二部",
    "name": "吴瑜",
    "plan": 15
  },
  {
    "department": "销售二部",
    "name": "张秋燕",
    "plan": 7
  },
  {
    "department": "销售二部",
    "name": "赵瑞芳",
    "plan": 9
  },
  {
    "department": "销售二部",
    "name": "张锦",
    "plan": 39
  },
  {
    "department": "销售二部",
    "name": "王飞飞",
    "plan": 3
  },
  {
    "department": "销售三部",
    "name": "耿新培",
    "plan": 42
  },
  {
    "department": "销售三部",
    "name": "毛会杰",
    "plan": 41
  },
  {
    "department": "销售三部",
    "name": "唐林丽",
    "plan": 26
  },
  {
    "department": "销售三部",
    "name": "尚艳娜",
    "plan": 24
  },
  {
    "department": "销售三部",
    "name": "李学正",
    "plan": 19
  },
  {
    "department": "销售三部",
    "name": "刘承业",
    "plan": 10
  },
  {
    "department": "销售三部",
    "name": "王锦琦",
    "plan": 9
  },
  {
    "department": "销售三部",
    "name": "张建元",
    "plan": 7
  },
  {
    "department": "销售三部",
    "name": "刘永飞",
    "plan": 6
  },
  {
    "department": "销售四部",
    "name": "张爱霞",
    "plan": 9
  },
  {
    "department": "销售四部",
    "name": "陈杰",
    "plan": 40
  },
  {
    "department": "销售四部",
    "name": "梁正雷",
    "plan": 30
  },
  {
    "department": "销售四部",
    "name": "秦国真",
    "plan": 6
  },
  {
    "department": "销售四部",
    "name": "秦宜南",
    "plan": 9
  },
  {
    "department": "销售四部",
    "name": "宋耀富",
    "plan": 25
  },
  {
    "department": "销售四部",
    "name": "吴伟艳",
    "plan": 12
  },
  {
    "department": "销售四部",
    "name": "徐东霞",
    "plan": 10
  },
  {
    "department": "销售四部",
    "name": "张樊",
    "plan": 5
  },
  {
    "department": "销售四部",
    "name": "张鹏",
    "plan": 30
  },
  {
    "department": "销售四部",
    "name": "赵万立",
    "plan": 7
  },
  {
    "department": "大客户部",
    "name": "孙世彪",
    "plan": 68
  },
  {
    "department": "大客户部",
    "name": "张文轩",
    "plan": 63
  }
];

  const DEPARTMENT_ORDER = [
    '销售一部',
    '销售二部',
    '销售三部',
    '销售四部',
    '大客户部',
  ];

  const ROUTES = [
    '#/card',
    '#/order-center/localThree/3',
    '#/card/categories',
    '#/card/bindCardApply',
    '#/order/package',
  ];

  const state = {
    running: false,
    collapsed: false,
    observerTimer: 0,
    drag: null,
  };

  // ============================================================
  // 1. 基础工具
  // ============================================================
  function isAllowedRoute() {
    /*
     * 不再维护页面白名单。
     * 只要处于SOA站点，并且页面实际生成了顶部header，
     * ensureSwitch 就会显示入口；没有该header的登录页/特殊页不会显示。
     */
    return location.hostname === 'checkup-soa3.health-100.cn';
  }

  function pad5(n) {
    return String(Math.max(0, Math.min(99999, Number(n) || 0))).padStart(SERIAL_DIGITS, '0');
  }

  function todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function yearStartYmd() {
    return `${new Date().getFullYear()}-01-01`;
  }

  function nowText() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randomMs(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(text, tone = 'normal') {
    const el = document.getElementById(IDS.status);
    if (!el) return;

    const message = String(text || '').trim();

    if (!message || tone === 'cache') {
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

  function safeJsonParse(text, fallback = null) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return fallback;
    }
  }

  function loadCache() {
    const raw = GM_getValue(CACHE_KEY, '');
    if (!raw) return null;
    const data = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    if (!data || data.schema !== CACHE_SCHEMA) return null;
    return data;
  }

  function saveCache(data) {
    GM_setValue(CACHE_KEY, JSON.stringify(data));
  }

  // ============================================================
  // 2. 请求层
  // ============================================================
  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
        mnclientid: 'MN_SOA3',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    }

    const json = await res.json();
    if (json?.result_code && json.result_code !== 'SUCC') {
      throw new Error(`接口返回失败：${json.result_code}`);
    }
    return json;
  }

  function getDataBlock(json) {
    return json?.data && typeof json.data === 'object' ? json.data : {};
  }

  async function fetchProcessOrder(orderName, startDate, endDate) {
    const all = [];
    let pageIndex = 1;
    let totalPages = 1;
    let totalNum = 0;

    do {
      const json = await postJson(PROCESS_API, {
        regionCode: 'XX',
        pageSize: PAGE_SIZE,
        orderName,
        gmtCreateStart: startDate,
        gmtCreateEnd: endDate,
        pageIndex,
      });

      const data = getDataBlock(json);
      const items = Array.isArray(data.items) ? data.items : [];
      totalNum = Number(data.total_num ?? data.totalNum ?? items.length) || 0;
      totalPages = Math.max(1, Math.ceil(totalNum / PAGE_SIZE));
      all.push(...items);

      if (pageIndex < totalPages) {
        await sleep(randomMs(80, 150));
      }
      pageIndex += 1;
    } while (pageIndex <= totalPages);

    // 记录级去重。优先 id，兜底使用订单+区间+时间
    const seen = new Set();
    const items = all.filter((item) => {
      const key = item?.id != null
        ? `id:${item.id}`
        : `${item?.orderName || ''}|${item?.beginNo || ''}|${item?.endNo || ''}|${item?.bindTime || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      orderName,
      totalNum,
      fetched: items.length,
      pages: totalPages,
      items,
    };
  }

  async function fetchPoolRange(task, progressLabel) {
    const all = [];
    let pageIndex = 1;
    let totalPages = 1;
    let totalNum = 0;

    do {
      setStatus(`${progressLabel}，第 ${pageIndex}/${totalPages} 页…`, 'running');

      const json = await postJson(POOL_API, {
        region_code: 'XX',
        page_index: pageIndex,
        page_size: PAGE_SIZE,
        cardCorpCode: '',
        cardNoStart: task.queryStart,
        cardNoEnd: task.queryEnd,
      });

      const data = getDataBlock(json);
      const items = Array.isArray(data.items) ? data.items : [];
      totalNum = Number(data.total_num ?? data.totalNum ?? items.length) || 0;
      totalPages = Math.max(1, Math.ceil(totalNum / PAGE_SIZE));
      all.push(...items);

      if (pageIndex < totalPages) {
        await sleep(totalPages <= 10 ? randomMs(50, 100) : randomMs(100, 200));
      }
      pageIndex += 1;
    } while (pageIndex <= totalPages);

    // 卡级去重。明确不缓存 card_pwd
    const byCardNo = new Map();
    for (const item of all) {
      const cardNo = String(item?.card_no || item?.cardNo || '').trim();
      if (!cardNo) continue;
      const clean = { ...item };
      delete clean.card_pwd;
      delete clean.cardPwd;
      byCardNo.set(cardNo, clean);
    }

    return {
      totalNum,
      fetched: all.length,
      uniqueCards: byCardNo.size,
      pages: totalPages,
      items: [...byCardNo.values()],
    };
  }

  // ============================================================
  // 3. 审批卡号白名单与精确查询区间
  // ============================================================
  function splitCardNo(cardNo) {
    const text = String(cardNo || '').trim();
    if (text.length <= SERIAL_DIGITS) return null;
    const serialText = text.slice(-SERIAL_DIGITS);
    if (!/^\d{5}$/.test(serialText)) return null;
    return {
      cardNo: text,
      prefix: text.slice(0, -SERIAL_DIGITS),
      serial: Number(serialText),
    };
  }

  function recordKeyOf(item) {
    return item?.id != null
      ? `id:${item.id}`
      : `${item?.orderName || ''}|${item?.beginNo || ''}|${item?.endNo || ''}|${item?.bindTime || ''}`;
  }

  function buildWhitelistAndTasks(processItems) {
    const warnings = [];
    const rawIntervals = [];
    const seenRecords = new Set();

    for (const item of processItems) {
      const recordKey = recordKeyOf(item);
      if (seenRecords.has(recordKey)) continue;
      seenRecords.add(recordKey);

      const begin = splitCardNo(item?.beginNo);
      const end = splitCardNo(item?.endNo);

      if (!begin || !end) {
        warnings.push(`无法解析卡号：${item?.beginNo || ''} ~ ${item?.endNo || ''}`);
        continue;
      }

      if (begin.prefix !== end.prefix) {
        warnings.push(`审批区间跨前缀，暂不自动拆分：${begin.cardNo} ~ ${end.cardNo}`);
        continue;
      }

      let startSerial = begin.serial;
      let endSerial = end.serial;
      if (startSerial > endSerial) {
        warnings.push(`审批区间起止倒置，已自动交换：${begin.cardNo} ~ ${end.cardNo}`);
        [startSerial, endSerial] = [endSerial, startSerial];
      }

      const lengthByRange = endSerial - startSerial + 1;
      const cardNum = Number(item?.cardNum || 0) || 0;
      if (cardNum > 0 && cardNum !== lengthByRange) {
        warnings.push(
          `cardNum与卡号区间长度不一致：${begin.prefix}${pad5(startSerial)} ~ ${begin.prefix}${pad5(endSerial)}，cardNum=${cardNum}，区间=${lengthByRange}`
        );
      }

      rawIntervals.push({
        recordKey,
        id: item?.id ?? null,
        prefix: begin.prefix,
        startSerial,
        endSerial,
        beginNo: `${begin.prefix}${pad5(startSerial)}`,
        endNo: `${begin.prefix}${pad5(endSerial)}`,
        rangeCardCount: lengthByRange,
        cardNum,
        cardType: String(item?.cardType || ''),
        bindTime: String(item?.bindTime || ''),
        orderName: String(item?.orderName || ''),
        processStatus: String(item?.processStatus || ''),
      });
    }

    rawIntervals.sort((a, b) =>
      a.prefix.localeCompare(b.prefix) ||
      a.startSerial - b.startSerial ||
      a.endSerial - b.endSerial
    );

    const groups = new Map();
    for (const interval of rawIntervals) {
      if (!groups.has(interval.prefix)) {
        groups.set(interval.prefix, {
          prefix: interval.prefix,
          cardTypes: new Set(),
          orderNames: new Set(),
          intervals: [],
        });
      }
      const group = groups.get(interval.prefix);
      if (interval.cardType) group.cardTypes.add(interval.cardType);
      if (interval.orderName) group.orderNames.add(interval.orderName);
      group.intervals.push(interval);
    }

    const tasks = [];
    const groupSummary = [];

    for (const group of [...groups.values()].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
      const intervals = group.intervals.slice().sort((a, b) =>
        a.startSerial - b.startSerial || a.endSerial - b.endSerial
      );

      // 白名单的“应有卡号”按区间并集计算，避免审批记录重叠时重复计数。
      const whitelistSerials = new Set();
      for (const it of intervals) {
        for (let n = it.startSerial; n <= it.endSerial; n += 1) {
          whitelistSerials.add(n);
        }
      }

      // 只合并真正重叠或首尾连续的审批区间。中间只要有一个卡号未出现在审批白名单里，就不跨过去。
      const merged = [];
      for (const it of intervals) {
        const last = merged[merged.length - 1];
        if (!last || it.startSerial > last.endSerial + 1) {
          merged.push({
            prefix: group.prefix,
            startSerial: it.startSerial,
            endSerial: it.endSerial,
            sourceRecords: [it],
          });
        } else {
          last.endSerial = Math.max(last.endSerial, it.endSerial);
          last.sourceRecords.push(it);
        }
      }

      const cardNumSum = intervals.reduce((sum, x) => sum + (Number(x.cardNum || 0) || 0), 0);
      const bindTimes = intervals.map((x) => x.bindTime).filter(Boolean).sort();

      groupSummary.push({
        prefix: group.prefix,
        cardTypes: [...group.cardTypes].sort(),
        orderNames: [...group.orderNames].sort(),
        processRecordCount: intervals.length,
        processCardNum: cardNumSum,
        rawIntervalCount: intervals.length,
        mergedTaskCount: merged.length,
        whitelistCardCount: whitelistSerials.size,
        firstBindTime: bindTimes[0] || '',
        lastBindTime: bindTimes[bindTimes.length - 1] || '',
      });

      merged.forEach((m, index) => {
        tasks.push({
          taskId: `${group.prefix}:${index + 1}`,
          prefix: group.prefix,
          cardTypes: [...group.cardTypes].sort(),
          orderNames: [...group.orderNames].sort(),
          queryStart: `${group.prefix}${pad5(m.startSerial)}`,
          queryEnd: `${group.prefix}${pad5(m.endSerial)}`,
          startSerial: m.startSerial,
          endSerial: m.endSerial,
          whitelistCardCount: m.endSerial - m.startSerial + 1,
          sourceRecordCount: m.sourceRecords.length,
          sourceRecordIds: m.sourceRecords.map((x) => x.recordKey),
        });
      });
    }

    return {
      rawIntervals,
      groupSummary,
      tasks,
      warnings,
    };
  }

  function isCardInWhitelist(cardNo, intervalsByPrefix) {
    const parsed = splitCardNo(cardNo);
    if (!parsed) return false;
    const intervals = intervalsByPrefix.get(parsed.prefix);
    if (!intervals?.length) return false;

    // 同一前缀内区间已排序。数据量很小，线性判断更直观可靠。
    for (const it of intervals) {
      if (parsed.serial < it.startSerial) return false;
      if (parsed.serial <= it.endSerial) return true;
    }
    return false;
  }

  function buildExpectedCardSet(rawIntervals) {
    const expected = new Set();
    for (const it of rawIntervals) {
      for (let n = it.startSerial; n <= it.endSerial; n += 1) {
        expected.add(`${it.prefix}${pad5(n)}`);
      }
    }
    return expected;
  }

  // ============================================================
  // 4. 汇总实际查询到的卡池数据
  // ============================================================
  function countBy(items, getter) {
    const map = new Map();
    for (const item of items) {
      const key = String(getter(item) ?? '').trim() || '(空)';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
  }


  function translateCardStatus(card) {
    const status = String(card?.status || '').trim().toUpperCase();
    const business = String(card?.status_business ?? card?.statusBusiness ?? '').trim();

    // 页面字段有时会把预约状态放在 status_business，而主 status 仍为 ENABLE。
    if (/预约|APPOINT|RESERV|BOOK/i.test(business)) {
      return '已预约';
    }

    const map = {
      ENABLE: '生效中',
      USED: '已核销',
      FREEZE: '冻结',
      INVALID: '作废',
      APPOINT: '已预约',
      APPOINTED: '已预约',
      APPOINTMENT: '已预约',
      RESERVED: '已预约',
      RESERVE: '已预约',
      BOOKED: '已预约',
      BOOK: '已预约',
    };

    return map[status] || status || '未知';
  }

  function getCardSaleName(card) {
    return String(card?.card_sale_name ?? card?.cardSaleName ?? '').trim();
  }

  function getPersonnelBase(department, personName) {
    return PERSONNEL_PLAN.filter((item) => {
      if (department && department !== '全部部门' && item.department !== department) return false;
      if (personName && personName !== '全部人员' && item.name !== personName) return false;
      return true;
    });
  }

  function getCardCategoryLabel(activityName) {
    const key = classifyCardActivity(activityName);
    const labels = {
      mri: '核磁',
      ct: 'CT',
      invite: '邀约',
      vip: '贵宾',
      other: '其他',
    };
    return labels[key] || '其他';
  }

  function summarizePersonnelCardRows(cards) {
    const statusOrder = ['生效中', '已预约', '已核销', '冻结', '作废'];
    const categoryOrder = ['核磁', 'CT', '邀约', '贵宾', '其他'];
    const rows = new Map();

    for (const card of Array.isArray(cards) ? cards : []) {
      const category = getCardCategoryLabel(card?.activity_name);
      const status = translateCardStatus(card);

      if (!rows.has(category)) {
        rows.set(category, {
          category,
          total: 0,
          statuses: Object.fromEntries(statusOrder.map((name) => [name, 0])),
        });
      }

      const row = rows.get(category);
      row.total += 1;

      if (Object.prototype.hasOwnProperty.call(row.statuses, status)) {
        row.statuses[status] += 1;
      }
    }

    return categoryOrder
      .filter((category) => rows.has(category))
      .map((category) => rows.get(category));
  }

  function getPlanForPeople(people) {
    return (Array.isArray(people) ? people : [])
      .reduce((sum, item) => sum + Number(item?.plan || 0), 0);
  }

  function countCardsForNames(cards, names) {
    const set = names instanceof Set
      ? names
      : new Set(Array.isArray(names) ? names : []);

    return (Array.isArray(cards) ? cards : [])
      .filter((card) => set.has(getCardSaleName(card)))
      .length;
  }

  function getProgressText(current, plan) {
    const done = Number(current || 0);
    const total = Number(plan || 0);
    const remain = Math.max(0, total - done);
    const over = Math.max(0, done - total);

    return over > 0
      ? `${done}/${total} · 超${over}`
      : `${done}/${total} · 余${remain}`;
  }

  function buildDepartmentProgress(cards) {
    return DEPARTMENT_ORDER.map((department) => {
      const people = PERSONNEL_PLAN.filter((item) => item.department === department);
      const plan = getPlanForPeople(people);
      const names = new Set(people.map((item) => item.name));
      const current = countCardsForNames(cards, names);

      return {
        department,
        people,
        plan,
        current,
        balance: Math.max(0, plan - current),
        overPlan: Math.max(0, current - plan),
        progressText: getProgressText(current, plan),
      };
    });
  }

  function buildPersonProgress(cards, department = '全部部门') {
    const people = PERSONNEL_PLAN.filter(
      (item) =>
        department === '全部部门' ||
        item.department === department
    );

    return people.map((item) => {
      const current = countCardsForNames(cards, [item.name]);
      const plan = Number(item.plan || 0);

      return {
        ...item,
        current,
        balance: Math.max(0, plan - current),
        overPlan: Math.max(0, current - plan),
        progressText: getProgressText(current, plan),
      };
    });
  }

  function summarizePersonnel(cards, department = '全部部门', personName = '全部人员') {
    const people = getPersonnelBase(department, personName);
    const names = new Set(people.map((x) => x.name));
    const matchedCards = (Array.isArray(cards) ? cards : []).filter(
      (card) => names.has(getCardSaleName(card))
    );

    const plan = people.reduce((sum, x) => sum + Number(x.plan || 0), 0);
    const categories = summarizeMainCardCategories(matchedCards);
    const statuses = countBy(matchedCards, (card) => translateCardStatus(card));

    const rawBalance = plan - matchedCards.length;

    return {
      peopleCount: people.length,
      plan,
      current: matchedCards.length,
      balance: Math.max(0, rawBalance),
      overPlan: rawBalance < 0 ? Math.abs(rawBalance) : 0,
      categories,
      statuses,
      cardRows: summarizePersonnelCardRows(matchedCards),
      cards: matchedCards,
    };
  }

  function classifyCardActivity(activityName) {
    const name = String(activityName || '').trim();

    if (/核磁/i.test(name)) return 'mri';
    if (/\bCT\b/i.test(name) || /ct/i.test(name)) return 'ct';
    if (/邀约/i.test(name)) return 'invite';
    if (/贵宾/i.test(name)) return 'vip';

    return 'other';
  }

  function summarizeMainCardCategories(cards) {
    const result = {
      mri: 0,
      ct: 0,
      invite: 0,
      vip: 0,
      other: 0,
    };

    for (const card of Array.isArray(cards) ? cards : []) {
      const key = classifyCardActivity(card?.activity_name);
      result[key] += 1;
    }

    return result;
  }

  function summarizeCards(cards) {
    const fieldSet = new Set();
    cards.forEach((item) => Object.keys(item || {}).forEach((k) => fieldSet.add(k)));

    return {
      uniqueCardCount: cards.length,
      returnedFields: [...fieldSet].sort(),
      status: countBy(cards, (x) => translateCardStatus(x)),
      cardType: countBy(cards, (x) => x.card_type ?? x.cardType),
      activityName: countBy(cards, (x) => x.activity_name ?? x.activityName),
      saleName: countBy(cards, (x) => x.card_sale_name ?? x.cardSaleName),
    };
  }

  function summarizeOrder(result) {
    const items = result.items || [];
    const times = items.map((x) => String(x?.bindTime || '')).filter(Boolean).sort();
    return {
      orderName: result.orderName,
      records: items.length,
      totalNum: result.totalNum,
      pages: result.pages,
      cardNumSum: items.reduce((sum, x) => sum + (Number(x?.cardNum || 0) || 0), 0),
      firstBindTime: times[0] || '',
      lastBindTime: times[times.length - 1] || '',
    };
  }

  async function runDetection() {
    if (state.running) return;
    state.running = true;
    refreshButtons();

    const startDate = yearStartYmd();
    const endDate = todayYmd();
    const oldCache = loadCache();

    try {
      setStatus(`开始查询办卡记录：${startDate} ～ ${endDate}`, 'running');

      const orderResults = [];
      for (let i = 0; i < ORDER_NAMES.length; i += 1) {
        const orderName = ORDER_NAMES[i];
        setStatus(`查询办卡记录 ${i + 1}/${ORDER_NAMES.length}：${orderName}`, 'running');
        const result = await fetchProcessOrder(orderName, startDate, endDate);
        orderResults.push(result);
        if (i < ORDER_NAMES.length - 1) await sleep(randomMs(120, 220));
      }

      const allProcessItems = orderResults.flatMap((x) => x.items || []);
      const {
        rawIntervals,
        groupSummary,
        tasks,
        warnings,
      } = buildWhitelistAndTasks(allProcessItems);

      if (!tasks.length) {
        throw new Error('没有从审批记录中识别出可查询的精确卡号区间。');
      }

      renderInterim(orderResults, groupSummary, tasks, warnings);

      const intervalsByPrefix = new Map();
      for (const it of rawIntervals) {
        if (!intervalsByPrefix.has(it.prefix)) intervalsByPrefix.set(it.prefix, []);
        intervalsByPrefix.get(it.prefix).push(it);
      }
      for (const list of intervalsByPrefix.values()) {
        list.sort((a, b) => a.startSerial - b.startSerial || a.endSerial - b.endSerial);
      }

      const matchedCards = new Map();
      const rangeResults = [];

      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        const label = `精确查询 ${i + 1}/${tasks.length}：${task.queryStart} ~ ${task.queryEnd}`;
        const pool = await fetchPoolRange(task, label);

        let matchedInTask = 0;
        let rejectedInTask = 0;

        for (const card of pool.items) {
          const no = String(card?.card_no || card?.cardNo || '').trim();
          if (!no) continue;

          if (isCardInWhitelist(no, intervalsByPrefix)) {
            if (!matchedCards.has(no)) matchedInTask += 1;
            matchedCards.set(no, card);
          } else {
            rejectedInTask += 1;
          }
        }

        rangeResults.push({
          ...task,
          poolTotalNum: pool.totalNum,
          poolFetched: pool.fetched,
          poolUniqueCards: pool.uniqueCards,
          poolPages: pool.pages,
          matchedUniqueCards: matchedInTask,
          rejectedUniqueCards: rejectedInTask,
        });

        if (i < tasks.length - 1) {
          // 精确区间通常页数不多。仍保留轻微节奏控制，连续多段后额外停顿一次。
          await sleep(randomMs(100, 180));
          if ((i + 1) % 8 === 0) {
            await sleep(randomMs(650, 950));
          }
        }
      }

      const cards = [...matchedCards.values()].sort((a, b) => {
        const aa = String(a?.card_no || a?.cardNo || '');
        const bb = String(b?.card_no || b?.cardNo || '');
        return aa.localeCompare(bb);
      });

      const foundCardNos = new Set(matchedCards.keys());

      const groupResultMap = new Map(
        groupSummary.map((g) => [g.prefix, {
          ...g,
          foundCardCount: 0,
        }])
      );

      for (const cardNo of foundCardNos) {
        const parsed = splitCardNo(cardNo);
        if (parsed && groupResultMap.has(parsed.prefix)) {
          groupResultMap.get(parsed.prefix).foundCardCount += 1;
        }
      }

      const finalGroupSummary = [...groupResultMap.values()].sort((a, b) => a.prefix.localeCompare(b.prefix));

      const approvalCardNumSum = orderResults
        .flatMap((x) => x.items || [])
        .reduce((sum, x) => sum + (Number(x?.cardNum || 0) || 0), 0);

      const data = {
        schema: CACHE_SCHEMA,
        version: '0.2.3',
        updatedAt: nowText(),
        queryPeriod: { startDate, endDate },
        config: {
          pageSize: PAGE_SIZE,
          serialDigits: SERIAL_DIGITS,
          orderNames: ORDER_NAMES.slice(),
          queryMode: '审批白名单 + 仅合并连续/重叠区间 + 查询后再次白名单过滤',
        },
        orderSummary: orderResults.map(summarizeOrder),
        processRecordCount: allProcessItems.length,
        approvalCardNumSum,
        approvalDistinctCardCount: buildExpectedCardSet(rawIntervals).size,
        foundDistinctCardCount: cards.length,
        rawIntervals,
        groupSummary: finalGroupSummary,
        rangeTasks: rangeResults,
        mainCategorySummary: summarizeMainCardCategories(cards),
        cardSummary: summarizeCards(cards),
        cards,        warnings,
      };

      // 整条链路成功以后才覆盖旧缓存。
      saveCache(data);
      renderResult(data);
      setStatus(
        `查询完成：本次共整理 ${cards.length} 张卡池数据。`,
        'success'
      );

      setTimeout(() => {
        if (!state.running) setStatus('', 'cache');
      }, 2200);
    } catch (err) {
      console.error('[卡类汇总] 查询失败：', err);
      if (oldCache) renderResult(oldCache);
      setStatus(`查询失败：${err?.message || err}。旧缓存未覆盖。`, 'error');
    } finally {
      state.running = false;
      refreshButtons();
    }
  }

  // ============================================================
  // 5. 正式 UI
  // ============================================================
  function ensureStyle() {
    const id = `${NS}_style`;
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      #${IDS.switchSlot} {
        display:flex;
        align-items:center;
        justify-content:center;
        align-self:stretch;
        flex:0 0 auto;
        margin-left:18px;
        margin-right:18px;
        padding:0;
        box-sizing:border-box;
        position:relative;
        z-index:2;
      }
      #${IDS.switch} {
        min-width:104px;
        height:31px;
        padding:0 13px;
        border:1px solid #e2aa3f;
        border-radius:7px;
        background:linear-gradient(180deg,#fff8df 0%,#ffefbd 100%);
        color:#6a4300;
        font:700 14px/29px "Microsoft YaHei","PingFang SC",sans-serif;
        letter-spacing:.1px;
        cursor:pointer;
        box-shadow:
          0 1px 2px rgba(81,54,12,.10),
          inset 0 1px 0 rgba(255,255,255,.75);
        white-space:nowrap;
        outline:none;
        transition:
          background .12s ease,
          border-color .12s ease,
          box-shadow .12s ease,
          transform .08s ease;
      }
      #${IDS.switch}:hover {
        background:linear-gradient(180deg,#fff4cf 0%,#ffe6a1 100%);
        border-color:#d59625;
        box-shadow:
          0 2px 6px rgba(108,72,11,.16),
          inset 0 1px 0 rgba(255,255,255,.82);
      }
      #${IDS.switch}:active {
        transform:translateY(1px);
        box-shadow:
          0 1px 2px rgba(108,72,11,.12),
          inset 0 1px 2px rgba(120,79,9,.10);
      }
      #${IDS.panel} {
        position:fixed; top:82px; right:24px; z-index:2147483645;
        width:760px; max-width:calc(100vw - 30px); max-height:calc(100vh - 105px);
        border:1px solid #d7dee8; border-radius:12px; background:#fff;
        box-shadow:0 14px 38px rgba(15,23,42,.18); overflow:hidden;
        color:#1f2937;
        font:13px/1.6 "Microsoft YaHei UI","Microsoft YaHei","Segoe UI","PingFang SC",Arial,sans-serif;
        text-rendering:optimizeLegibility;
      }
      #${IDS.panel} button { font-family:inherit; }
      #${IDS.panel} .hlj-head {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        padding:8px 12px; background:#f8fafc;
        border-bottom:1px solid #e2e8f0; cursor:move; user-select:none;
      }
      #${IDS.panel} .hlj-title {
        font-size:15px; line-height:1.25; font-weight:800; color:#172033; letter-spacing:.1px;
      }
      #${IDS.panel} .hlj-sub {
        font-size:10px; line-height:1.25; color:#64748b; margin-top:1px;
      }
      #${IDS.panel} .hlj-head-actions { display:flex; gap:5px; }
      #${IDS.panel} .hlj-icon-btn {
        width:27px; height:27px; border:1px solid #cbd5e1; border-radius:7px;
        background:#fff; color:#475569; cursor:pointer; font-weight:800;
      }
      #${IDS.body} { padding:10px 12px 12px; max-height:calc(100vh - 145px); overflow:auto; }
      #${IDS.panel} .hlj-toolbar {
        display:flex; align-items:center; justify-content:space-between; gap:10px;
        min-height:30px;
      }
      #${IDS.panel} .hlj-toolbar-note {
        min-width:0; color:#7b8797; font-size:10px; line-height:1.35;
      }
      #${IDS.panel} .hlj-primary {
        flex:0 0 auto;
        height:30px; padding:0 11px; border:1px solid #b96f08; border-radius:7px;
        background:#c8790c; color:#fff; font-size:11px; font-weight:800; cursor:pointer;
        box-shadow:0 1px 3px rgba(146,87,7,.14);
      }
      #${IDS.panel} .hlj-secondary {
        height:34px; padding:0 12px; border:1px solid #d8c8a8; border-radius:7px;
        background:#fffaf0; color:#6c5430; font-weight:700; cursor:pointer;
      }
      #${IDS.panel} button:disabled { opacity:.55; cursor:not-allowed; }
      #${IDS.status} {
        margin-top:7px; padding:7px 10px; border:1px solid #dbe3ed;
        border-radius:8px; background:#f8fafc; color:#475569; font-size:11px;
      }
      #${IDS.result} { margin-top:8px; }
      #${IDS.panel} .hlj-section {
        margin:9px 10px 0; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;
      }
      #${IDS.panel} .hlj-section-title {
        padding:8px 10px; background:#f8fafc; color:#334155; font-size:11px; font-weight:800;
        border-bottom:1px solid #e2e8f0;
      }
      #${IDS.panel} table { width:100%; border-collapse:collapse; table-layout:fixed; }
      #${IDS.panel} th, #${IDS.panel} td {
        padding:7px 8px; border-bottom:1px solid #edf1f5; text-align:left;
        vertical-align:top; word-break:break-all; font-size:12px; color:#334155;
      }
      #${IDS.panel} th { background:#f8fafc; color:#475569; font-weight:800; }
      #${IDS.panel} tr:last-child td { border-bottom:0; }

      #${IDS.panel} .hlj-main-summary {
        display:grid;
        grid-template-columns:repeat(4,minmax(0,1fr));
        gap:10px;
        margin-top:12px;
      }

      #${IDS.panel} .hlj-main-card {
        position:relative;
        min-height:80px;
        padding:12px 14px 11px;
        box-sizing:border-box;
        border:1px solid #dfe5ec;
        border-top-width:4px;
        border-radius:10px;
        background:#fff;
        box-shadow:0 1px 3px rgba(15,23,42,.05);
      }

      #${IDS.panel} .hlj-main-card-label {
        color:#475569;
        font-size:13px;
        line-height:1.2;
        font-weight:800;
      }

      #${IDS.panel} .hlj-main-card-value {
        margin-top:6px;
        color:#172033;
        font-size:28px;
        line-height:1;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-main-card-unit {
        position:absolute;
        right:12px;
        bottom:10px;
        color:#64748b;
        font-size:11px;
        font-weight:600;
      }

      #${IDS.panel} .hlj-main-card-mri { border-top-color:#7c3aed; }
      #${IDS.panel} .hlj-main-card-ct { border-top-color:#0284c7; }
      #${IDS.panel} .hlj-main-card-invite { border-top-color:#16a34a; }
      #${IDS.panel} .hlj-main-card-vip { border-top-color:#d97706; }

      #${IDS.panel} .hlj-brief-line {
        display:flex;
        flex-wrap:wrap;
        gap:8px 18px;
        align-items:center;
        margin-top:10px;
        padding:8px 10px;
        border:1px solid #e2e8f0;
        border-radius:8px;
        background:#f8fafc;
        color:#475569;
        font-size:12px;
        line-height:1.5;
      }

      #${IDS.panel} .hlj-brief-line b {
        color:#1f2937;
        font-size:12px;
      }

      #${IDS.panel} .hlj-brief-line .is-warning,
      #${IDS.panel} .hlj-brief-line .is-warning b {
        color:#b86c00;
      }

      #${IDS.panel} .hlj-brief-line .is-muted {
        color:#64748b;
      }

      #${IDS.panel} .hlj-personnel-box {
        margin-top:10px;
        border:1px solid #e7dfd2;
        border-radius:10px;
        background:#fff;
        overflow:hidden;
      }

      #${IDS.panel} .hlj-personnel-head {
        display:flex;
        align-items:center;
        justify-content:flex-start;
        gap:12px;
        padding:10px 12px;
        border-bottom:1px solid #e2e8f0;
        background:#f8fafc;
      }

      #${IDS.panel} .hlj-personnel-title {
        color:#334155;
        font-size:12px;
        font-weight:800;
        flex:0 0 auto;
      }

      #${IDS.panel} .hlj-personnel-selects {
        display:flex;
        gap:7px;
        align-items:center;
      }

      #${IDS.panel} .hlj-personnel-select {
        height:30px;
        min-width:0;
        padding:0 28px 0 10px;
        border:1px solid #cbd5e1;
        border-radius:7px;
        background:#fff;
        color:#1f2937;
        font-family:"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",sans-serif;
        font-size:12px;
        font-weight:600;
        font-variant-numeric:tabular-nums;
        letter-spacing:0;
        outline:none;
        cursor:pointer;
      }
      #${IDS.panel} [data-personnel-department="1"] { width:210px; }
      #${IDS.panel} [data-personnel-person="1"] { width:210px; }
      #${IDS.panel} .hlj-personnel-select option {
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-personnel-select:focus {
        border-color:#94a3b8;
        box-shadow:0 0 0 2px rgba(100,116,139,.08);
      }

      #${IDS.panel} .hlj-personnel-kpis {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:9px;
        padding:11px 12px 10px;
      }

      #${IDS.panel} .hlj-personnel-kpi {
        padding:10px 11px;
        border:1px solid #dfe5ec;
        border-radius:8px;
        background:#fff;
      }

      #${IDS.panel} .hlj-personnel-kpi-label {
        color:#64748b;
        font-size:11px;
        font-weight:700;
      }

      #${IDS.panel} .hlj-personnel-kpi-value {
        margin-top:4px;
        color:#172033;
        font-size:22px;
        line-height:1;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-total {
        border-color:#bfdbfe;
        background:#f8fbff;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-total .hlj-personnel-kpi-label {
        color:#2563eb;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-total .hlj-personnel-kpi-value {
        color:#1d4ed8;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-done {
        border-color:#ddd6fe;
        background:#fbfaff;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-done .hlj-personnel-kpi-label {
        color:#7c3aed;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-done .hlj-personnel-kpi-value {
        color:#6d28d9;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-remaining {
        border-color:#bbf7d0;
        background:#f7fdf9;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-remaining .hlj-personnel-kpi-label {
        color:#16a34a;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-remaining .hlj-personnel-kpi-value {
        color:#15803d;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-empty {
        border-color:#e2e8f0;
        background:#f8fafc;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-empty .hlj-personnel-kpi-label,
      #${IDS.panel} .hlj-personnel-kpi.is-empty .hlj-personnel-kpi-value {
        color:#64748b;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-over {
        border-color:#fecaca;
        background:#fff7f7;
        box-shadow:0 0 0 1px rgba(220,38,38,.03);
      }

      #${IDS.panel} .hlj-personnel-kpi.is-over .hlj-personnel-kpi-label {
        color:#dc2626;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-over .hlj-personnel-kpi-value {
        color:#b91c1c;
      }

      #${IDS.panel} .hlj-personnel-over {
        margin:-2px 12px 10px;
        padding:7px 9px;
        border:1px solid #fecaca;
        border-radius:7px;
        background:#fff7f7;
        color:#b91c1c;
        font-size:11px;
        line-height:1.45;
        font-weight:800;
      }

      #${IDS.panel} .hlj-status-head {
        border-bottom-width:2px !important;
      }

      #${IDS.panel} .hlj-status-head.is-enable {
        color:#15803d;
        border-bottom-color:#22c55e !important;
      }

      #${IDS.panel} .hlj-status-head.is-booked {
        color:#0369a1;
        border-bottom-color:#38bdf8 !important;
      }

      #${IDS.panel} .hlj-status-head.is-used {
        color:#475569;
        border-bottom-color:#94a3b8 !important;
      }

      #${IDS.panel} .hlj-status-head.is-freeze {
        color:#c2410c;
        border-bottom-color:#fb923c !important;
      }

      #${IDS.panel} .hlj-status-head.is-invalid {
        color:#b91c1c;
        border-bottom-color:#f87171 !important;
      }

      #${IDS.panel} .hlj-status-value {
        display:inline-flex;
        min-width:24px;
        height:22px;
        align-items:center;
        justify-content:center;
        padding:0 6px;
        box-sizing:border-box;
        border-radius:6px;
        font-weight:800;
        line-height:1;
      }

      #${IDS.panel} .hlj-status-value.is-zero {
        color:#a8b0bb;
        background:transparent;
      }

      #${IDS.panel} .hlj-status-value.is-enable:not(.is-zero) {
        color:#15803d;
        background:#ecfdf3;
      }

      #${IDS.panel} .hlj-status-value.is-booked:not(.is-zero) {
        color:#0369a1;
        background:#eef9ff;
      }

      #${IDS.panel} .hlj-status-value.is-used:not(.is-zero) {
        color:#475569;
        background:#f1f5f9;
      }

      #${IDS.panel} .hlj-status-value.is-freeze:not(.is-zero) {
        color:#c2410c;
        background:#fff7ed;
      }

      #${IDS.panel} .hlj-status-value.is-invalid:not(.is-zero) {
        color:#b91c1c;
        background:#fff1f2;
      }

      #${IDS.panel} .hlj-personnel-lines {
        padding:0 10px 10px;
        color:#766a57;
        font-size:10px;
        line-height:1.6;
      }

      #${IDS.panel} .hlj-personnel-line {
        display:flex;
        flex-wrap:wrap;
        gap:5px 14px;
        padding-top:7px;
        border-top:1px dashed #eee7dc;
      }

      #${IDS.panel} .hlj-personnel-line b {
        color:#554a3a;
      }

      #${IDS.panel} .hlj-card-matrix {
        margin:0 12px 12px;
        border:1px solid #dfe5ec;
        border-radius:8px;
        overflow:hidden;
      }

      #${IDS.panel} .hlj-department-overview {
        margin:0 12px 12px;
        border:1px solid #dfe5ec;
        border-radius:9px;
        overflow:hidden;
        background:#fff;
      }

      #${IDS.panel} .hlj-department-overview-title {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:8px 10px;
        border-bottom:1px solid #e2e8f0;
        background:#f8fafc;
        color:#334155;
        font-size:12px;
        font-weight:800;
      }

      #${IDS.panel} .hlj-department-overview-sub {
        color:#94a3b8;
        font-size:10px;
        font-weight:600;
      }

      #${IDS.panel} .hlj-department-row {
        display:grid;
        grid-template-columns:minmax(88px,1.2fr) repeat(3,minmax(68px,.8fr));
        align-items:center;
        gap:8px;
        padding:8px 10px;
        border-bottom:1px solid #eef2f6;
        font-size:11px;
      }

      #${IDS.panel} .hlj-department-row:last-child {
        border-bottom:0;
      }

      #${IDS.panel} .hlj-department-name {
        color:#334155;
        font-weight:800;
      }

      #${IDS.panel} .hlj-department-stat {
        text-align:right;
        color:#64748b;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-department-stat b {
        margin-left:3px;
        color:#1f2937;
        font-size:12px;
      }

      #${IDS.panel} .hlj-department-stat.is-remaining b {
        color:#15803d;
      }

      #${IDS.panel} .hlj-department-stat.is-over b {
        color:#b91c1c;
      }

      #${IDS.panel} .hlj-card-matrix-title {
        padding:8px 10px;
        border-bottom:1px solid #e2e8f0;
        background:#f8fafc;
        color:#334155;
        font-size:12px;
        font-weight:800;
      }

      #${IDS.panel} .hlj-card-matrix table {
        table-layout:auto;
      }

      #${IDS.panel} .hlj-card-matrix th,
      #${IDS.panel} .hlj-card-matrix td {
        padding:7px 8px;
        font-size:11px;
        text-align:center;
        white-space:nowrap;
        word-break:normal;
      }

      #${IDS.panel} .hlj-card-matrix th:first-child,
      #${IDS.panel} .hlj-card-matrix td:first-child {
        text-align:left;
        font-weight:800;
      }

      #${IDS.panel} .hlj-card-matrix .hlj-zero {
        color:#a8b0bb;
      }

      #${IDS.panel} .hlj-fold {
        margin-top:9px;
        border:1px solid #dfe5ec;
        border-radius:9px;
        background:#fff;
        overflow:hidden;
      }

      #${IDS.panel} .hlj-fold > summary {
        position:relative;
        padding:9px 34px 9px 11px;
        color:#334155;
        background:#f8fafc;
        font-size:12px;
        line-height:1.35;
        font-weight:800;
        cursor:pointer;
        list-style:none;
        user-select:none;
      }

      #${IDS.panel} .hlj-fold > summary::-webkit-details-marker {
        display:none;
      }

      #${IDS.panel} .hlj-fold > summary::after {
        content:"›";
        position:absolute;
        right:13px;
        top:50%;
        transform:translateY(-50%) rotate(90deg);
        color:#9b8d74;
        font-size:16px;
        line-height:1;
        transition:transform .12s ease;
      }

      #${IDS.panel} .hlj-fold[open] > summary::after {
        transform:translateY(-50%) rotate(-90deg);
      }

      #${IDS.panel} .hlj-fold-body {
        padding:0;
        border-top:1px solid #e2e8f0;
        background:#fff;
      }

      #${IDS.panel} .hlj-detail-meta {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:8px;
        padding:9px 10px;
        border-bottom:1px solid #e2e8f0;
        background:#fff;
      }

      #${IDS.panel} .hlj-detail-meta-item {
        padding:7px 8px;
        border:1px solid #e2e8f0;
        border-radius:7px;
        background:#f8fafc;
      }

      #${IDS.panel} .hlj-detail-meta-label {
        color:#64748b;
        font-size:10px;
        font-weight:700;
      }

      #${IDS.panel} .hlj-detail-meta-value {
        margin-top:2px;
        color:#1f2937;
        font-size:15px;
        line-height:1.15;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-range-result {
        display:inline-flex;
        align-items:center;
        gap:3px;
        padding:2px 6px;
        border-radius:6px;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-range-result.is-ok {
        color:#15803d;
        background:#ecfdf3;
      }

      #${IDS.panel} .hlj-range-result.is-partial {
        color:#b45309;
        background:#fff7ed;
      }

      #${IDS.panel} .hlj-detail-grid {
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:8px;
        padding:9px 10px 10px;
      }

      #${IDS.panel} .hlj-detail-card {
        min-width:0;
        border:1px solid #e2e8f0;
        border-radius:8px;
        overflow:hidden;
        background:#fff;
      }

      #${IDS.panel} .hlj-detail-card-title {
        padding:7px 9px;
        border-bottom:1px solid #e2e8f0;
        background:#f8fafc;
        color:#475569;
        font-size:11px;
        font-weight:800;
      }

      #${IDS.panel} .hlj-detail-tags {
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        padding:9px;
      }

      #${IDS.panel} .hlj-detail-tag {
        display:inline-flex;
        align-items:center;
        gap:4px;
        padding:4px 7px;
        border:1px solid #dbe3ed;
        border-radius:7px;
        background:#fff;
        color:#475569;
        font-size:10px;
        line-height:1;
        white-space:nowrap;
      }

      #${IDS.panel} .hlj-detail-tag b {
        color:#1f2937;
        font-size:11px;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-detail-tag.is-enable {
        border-color:#bbf7d0; background:#f0fdf4; color:#15803d;
      }
      #${IDS.panel} .hlj-detail-tag.is-booked {
        border-color:#bae6fd; background:#f0f9ff; color:#0369a1;
      }
      #${IDS.panel} .hlj-detail-tag.is-used {
        border-color:#dbe3ed; background:#f8fafc; color:#475569;
      }
      #${IDS.panel} .hlj-detail-tag.is-freeze {
        border-color:#fed7aa; background:#fff7ed; color:#c2410c;
      }
      #${IDS.panel} .hlj-detail-tag.is-invalid {
        border-color:#fecaca; background:#fff1f2; color:#b91c1c;
      }

      #${IDS.panel} .hlj-section-inner {
        margin:0;
        border:0;
        border-radius:0;
      }

      #${IDS.panel} .hlj-missing-list {
        max-height:240px;
        overflow:auto;
        margin:0;
        padding:10px 12px;
        border:0;
        background:#fffdf8;
        color:#715d3f;
        font-size:10px;
        line-height:1.5;
      }

      #${IDS.panel} .hlj-empty-tip {
        padding:12px;
        color:#2f7d46;
        font-size:11px;
      }


      #${IDS.panel} .hlj-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; }
      #${IDS.panel} .hlj-kpi { padding:8px 9px; border:1px solid #ece7dc; border-radius:8px; background:#fffdfa; }
      #${IDS.panel} .hlj-kpi-label { font-size:10px; color:#8c8271; }
      #${IDS.panel} .hlj-kpi-value { margin-top:2px; font-size:16px; font-weight:800; color:#4b4030; }
      #${IDS.panel} details { padding:8px 10px; }
      #${IDS.panel} pre { margin:7px 0 0; padding:8px; background:#f7f7f5; border-radius:6px; overflow:auto; max-height:220px; font-size:10px; }

      /* v0.2.8 紧凑标题 / 查询按钮 */
      #${IDS.panel} .hlj-head {
        padding:9px 12px;
      }

      #${IDS.panel} .hlj-title {
        font-size:16px;
        line-height:1.25;
      }

      #${IDS.panel} .hlj-head-actions {
        display:flex;
        align-items:center;
        gap:5px;
      }

      #${IDS.panel} .hlj-head-query {
        height:31px;
        padding:0 12px;
        border:1px solid #c8790c;
        border-radius:7px;
        background:#c8790c;
        color:#fff;
        font-family:inherit;
        font-size:12px;
        font-weight:800;
        line-height:29px;
        cursor:pointer;
        white-space:nowrap;
        box-shadow:0 1px 3px rgba(146,87,7,.14);
      }

      #${IDS.panel} .hlj-head-query:hover {
        background:#b96f08;
      }

      #${IDS.panel} .hlj-head-query:disabled {
        border-color:#d7dee8;
        background:#eef2f6;
        color:#94a3b8;
        box-shadow:none;
      }

      #${IDS.body} {
        padding-top:8px;
        max-height:calc(100vh - 130px);
      }

      #${IDS.status} {
        display:none;
        margin:0 0 7px;
        padding:6px 9px;
        font-size:10px;
        line-height:1.3;
      }

      #${IDS.result} {
        margin-top:0;
      }

      /* 自定义部门 / 人员下拉。原生select无法稳定做三列对齐，因此改为真正的分列菜单。 */
      #${IDS.panel} .hlj-smart-select {
        position:relative;
        width:220px;
        flex:0 0 220px;
      }

      #${IDS.panel} .hlj-smart-select-btn {
        width:100%;
        height:31px;
        display:grid;
        grid-template-columns:minmax(0,1fr) 58px 44px;
        align-items:center;
        gap:7px;
        padding:0 28px 0 10px;
        border:1px solid #cbd5e1;
        border-radius:7px;
        background:#fff;
        color:#1f2937;
        font-family:inherit;
        font-size:11px;
        cursor:pointer;
        text-align:left;
        position:relative;
      }

      #${IDS.panel} .hlj-smart-select-btn::after {
        content:"⌄";
        position:absolute;
        right:9px;
        top:50%;
        transform:translateY(-55%);
        color:#64748b;
        font-size:11px;
      }

      #${IDS.panel} .hlj-smart-select.is-open .hlj-smart-select-btn,
      #${IDS.panel} .hlj-smart-select-btn:hover {
        border-color:#94a3b8;
        box-shadow:0 0 0 2px rgba(100,116,139,.06);
      }

      #${IDS.panel} .hlj-smart-name {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:#334155;
        font-weight:700;
      }

      #${IDS.panel} .hlj-smart-progress {
        text-align:right;
        color:#475569;
        font-variant-numeric:tabular-nums;
        font-weight:700;
        white-space:nowrap;
      }

      #${IDS.panel} .hlj-smart-balance {
        text-align:right;
        color:#15803d;
        font-variant-numeric:tabular-nums;
        font-weight:800;
        white-space:nowrap;
      }

      #${IDS.panel} .hlj-smart-balance.is-over {
        color:#b91c1c;
      }

      #${IDS.panel} .hlj-smart-menu {
        position:absolute;
        top:calc(100% + 4px);
        left:0;
        z-index:2147483647;
        width:270px;
        max-height:340px;
        display:none;
        overflow:auto;
        padding:4px;
        border:1px solid #cbd5e1;
        border-radius:8px;
        background:#fff;
        box-shadow:0 10px 28px rgba(15,23,42,.18);
      }

      #${IDS.panel} .hlj-smart-select.is-open .hlj-smart-menu {
        display:block;
      }

      #${IDS.panel} .hlj-smart-option {
        width:100%;
        min-height:31px;
        display:grid;
        grid-template-columns:minmax(92px,1fr) 64px 48px;
        align-items:center;
        gap:8px;
        padding:5px 8px;
        border:0;
        border-radius:6px;
        background:#fff;
        color:#334155;
        font-family:inherit;
        font-size:11px;
        cursor:pointer;
        text-align:left;
      }

      #${IDS.panel} .hlj-smart-option:hover,
      #${IDS.panel} .hlj-smart-option.is-active {
        background:#eff6ff;
      }

      /* 部门进度：字体略大，但行更紧凑 */
      #${IDS.panel} .hlj-department-row {
        grid-template-columns:minmax(94px,1.2fr) repeat(3,minmax(66px,.8fr));
        gap:7px;
        padding:6px 10px;
        font-size:12px;
        line-height:1.2;
      }

      #${IDS.panel} .hlj-department-name {
        font-size:12px;
        color:#27364a;
      }

      #${IDS.panel} .hlj-department-stat {
        font-size:11px;
      }

      /* 卡领取状态：字号提高，行距压缩 */
      #${IDS.panel} .hlj-card-matrix th,
      #${IDS.panel} .hlj-card-matrix td {
        padding:5px 8px;
        font-size:12px;
        line-height:1.2;
      }

      #${IDS.panel} .hlj-status-value {
        height:20px;
      }


      #${IDS.panel} .hlj-detail-meta {
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:7px;
        padding:8px 9px;
        border-bottom:1px solid #e2e8f0;
        background:#fff;
      }

      #${IDS.panel} .hlj-detail-meta-item {
        padding:6px 8px;
        border:1px solid #e2e8f0;
        border-radius:7px;
        background:#f8fafc;
      }

      #${IDS.panel} .hlj-detail-meta-label {
        color:#64748b;
        font-size:10px;
        font-weight:700;
      }

      #${IDS.panel} .hlj-detail-meta-value {
        margin-top:2px;
        color:#1f2937;
        font-size:14px;
        line-height:1.15;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }


      /* v0.2.9：数量卡居中 */
      #${IDS.panel} .hlj-main-card {
        text-align:center;
      }

      #${IDS.panel} .hlj-main-card-label,
      #${IDS.panel} .hlj-main-card-value {
        text-align:center;
      }

      #${IDS.panel} .hlj-main-card-unit {
        right:10px;
        bottom:9px;
      }

      #${IDS.panel} .hlj-personnel-kpi,
      #${IDS.panel} .hlj-personnel-kpi-label,
      #${IDS.panel} .hlj-personnel-kpi-value {
        text-align:center;
      }

      /* 部门进度数据较少，不再铺满整个面板 */
      #${IDS.panel} .hlj-department-overview {
        width:min(84%,610px);
        margin:0 auto 12px;
      }

      /* 部门 / 人员选择框再收窄一些 */
      #${IDS.panel} .hlj-smart-select {
        width:188px;
        flex:0 0 188px;
      }

      #${IDS.panel} .hlj-smart-select-btn {
        grid-template-columns:minmax(0,1fr) 50px 40px;
        gap:6px;
        padding-left:9px;
        padding-right:25px;
      }

      #${IDS.panel} .hlj-smart-menu {
        width:238px;
      }

      #${IDS.panel} .hlj-smart-option {
        grid-template-columns:minmax(80px,1fr) 56px 43px;
        gap:6px;
        padding:5px 7px;
      }

      /* 部门进度与领取状态：字体略大，行更紧凑 */
      #${IDS.panel} .hlj-department-row {
        padding:5px 10px;
        font-size:12px;
        line-height:1.15;
      }

      #${IDS.panel} .hlj-department-stat {
        font-size:11px;
      }

      #${IDS.panel} .hlj-card-matrix th,
      #${IDS.panel} .hlj-card-matrix td {
        padding:4px 8px;
        font-size:12px;
        line-height:1.15;
      }

      #${IDS.panel} .hlj-card-matrix-title,
      #${IDS.panel} .hlj-department-overview-title {
        padding-top:7px;
        padding-bottom:7px;
        font-size:12px;
      }


      /* v0.3.0 数据口径提示 */
      #${IDS.panel} .hlj-scope-hint {
        margin:0 2px 5px;
        color:#64748b;
        font-size:11px;
        line-height:1.3;
        font-weight:700;
        letter-spacing:.1px;
      }

      #${IDS.panel} .hlj-personnel-head {
        justify-content:space-between;
        align-items:center;
      }

      #${IDS.panel} .hlj-personnel-scope-hint {
        flex:0 0 auto;
        margin-left:auto;
        color:#64748b;
        font-size:11px;
        line-height:1.3;
        font-weight:700;
        white-space:nowrap;
      }

      #${IDS.panel} .hlj-personnel-selects {
        display:flex;
        align-items:center;
        gap:8px;
      }

      @media (max-width: 1100px) {
        #${IDS.switchSlot} { margin-left:12px; margin-right:12px; }
        #${IDS.switch} { min-width:96px; padding:0 11px; font-size:13px; }
      }
      @media (max-width: 900px) {
        #${IDS.panel} { width:calc(100vw - 24px); right:12px; }
        #${IDS.panel} .hlj-personnel-head {
          align-items:flex-start;
          flex-direction:column;
        }
        #${IDS.panel} .hlj-personnel-scope-hint {
          margin-left:0;
          margin-top:4px;
        }
        #${IDS.panel} .hlj-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
        #${IDS.panel} .hlj-main-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
        #${IDS.panel} .hlj-personnel-selects { width:100%; }
        #${IDS.panel} .hlj-personnel-select { flex:1 1 0; width:auto; min-width:0; }
        #${IDS.panel} .hlj-personnel-kpis { grid-template-columns:repeat(3,minmax(0,1fr)); }
        #${IDS.panel} .hlj-detail-grid { grid-template-columns:1fr; }
        #${IDS.panel} .hlj-detail-meta { grid-template-columns:repeat(3,minmax(0,1fr)); }
      }
    `;
    document.head.appendChild(style);
  }


  function ensureSwitch() {
    const existing = document.getElementById(IDS.switch);
    const existingSlot = document.getElementById(IDS.switchSlot);

    if (!isAllowedRoute()) {
      if (existingSlot) existingSlot.remove();
      else if (existing) existing.remove();

      const panel = document.getElementById(IDS.panel);
      if (panel) panel.style.display = 'none';
      return;
    }

    const sharedGroup = document.getElementById(TOP_TOOL_GROUP_ID);

    // 已存在时不重复创建。若报表工具稍后创建了共享工具组，就主动吸附过去。
    if (existing && existing.isConnected && existingSlot && existingSlot.isConnected) {
      if (sharedGroup && existingSlot.parentElement !== sharedGroup) {
        sharedGroup.appendChild(existingSlot);
      }
      return;
    }

    // 清理 SPA 重绘后可能残留的半成品节点。
    if (existingSlot) existingSlot.remove();
    else if (existing) existing.remove();

    const headerInner = document.querySelector('#layout-header .header-inner');
    if (!headerInner) return;

    const slot = document.createElement('div');
    slot.id = IDS.switchSlot;

    const btn = document.createElement('button');
    btn.id = IDS.switch;
    btn.type = 'button';
    btn.textContent = document.getElementById(IDS.panel)?.style.display !== 'none'
      ? '关闭卡类汇总'
      : '开始卡类汇总';
    btn.title = '打开卡类汇总面板';

    ['pointerdown', 'mousedown', 'mouseup', 'pointerup'].forEach((evt) => {
      btn.addEventListener(evt, (e) => {
        e.stopPropagation();
      });
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });

    slot.appendChild(btn);

    // 报表工具存在时放进共享顶部工具组；否则独立放在顶部最右侧。
    const group = document.getElementById(TOP_TOOL_GROUP_ID);
    if (group) {
      group.appendChild(slot);
      return;
    }

    const userBox = headerInner.querySelector(':scope > .user');
    if (userBox) {
      headerInner.insertBefore(slot, userBox);
    } else {
      headerInner.appendChild(slot);
    }
  }

  function createPanel() {
    let panel = document.getElementById(IDS.panel);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = IDS.panel;
    panel.style.display = 'none';
    panel.innerHTML = `
      <div class="hlj-head" data-drag-handle="1">
        <div>
          <div class="hlj-title">卡类汇总 <span style="font-size:10px;color:#64748b;">v0.3.0</span></div>
        </div>
        <div class="hlj-head-actions">
          <button id="${IDS.query}" class="hlj-head-query" type="button">重新查询</button>
          <button id="${IDS.collapse}" class="hlj-icon-btn" type="button" title="折叠">▾</button>
          <button id="${IDS.close}" class="hlj-icon-btn" type="button" title="关闭">×</button>
        </div>
      </div>
      <div id="${IDS.body}">
        <div id="${IDS.status}">尚未查询。</div>
        <div id="${IDS.result}"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById(IDS.query).addEventListener('click', runDetection);
    document.getElementById(IDS.close).addEventListener('click', closePanel);
    document.getElementById(IDS.collapse).addEventListener('click', toggleCollapse);
    installDrag(panel);

    const cache = loadCache();
    if (cache) {
      renderResult(cache);
      setStatus('', 'cache');
    }

    refreshButtons();
    return panel;
  }

  function refreshButtons() {
    const query = document.getElementById(IDS.query);
    if (!query) return;

    query.disabled = state.running;
    query.textContent = state.running ? '查询中…' : '重新查询';
  }

  function togglePanel() {
    const panel = createPanel();
    const open = panel.style.display === 'none' || !panel.style.display;

    panel.style.display = open ? 'block' : 'none';

    if (open) {
      ensurePanelInViewport(panel);

      const cache = loadCache();
      if (cache) {
        renderResult(cache);
        setStatus('', 'cache');
      }
    }

    updateSwitchText();
  }

  function closePanel() {
    const panel = document.getElementById(IDS.panel);
    if (panel) panel.style.display = 'none';
    updateSwitchText();
  }

  function updateSwitchText() {
    const btn = document.getElementById(IDS.switch);
    const panel = document.getElementById(IDS.panel);
    if (!btn) return;

    const open = panel && panel.style.display !== 'none';
    btn.textContent = open ? '关闭卡类汇总' : '开始卡类汇总';
    btn.title = open ? '关闭卡类汇总面板' : '打开卡类汇总面板';
  }

  function toggleCollapse() {
    state.collapsed = !state.collapsed;

    const body = document.getElementById(IDS.body);
    const btn = document.getElementById(IDS.collapse);

    if (body) body.style.display = state.collapsed ? 'none' : 'block';
    if (btn) btn.textContent = state.collapsed ? '▸' : '▾';
  }

  function installDrag(panel) {
    const handle = panel.querySelector('[data-drag-handle="1"]');
    if (!handle || handle.dataset.dragBound === '1') return;

    handle.dataset.dragBound = '1';

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button,input,a')) return;

      const rect = panel.getBoundingClientRect();

      state.drag = {
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top,
      };

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';

      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd, { once: true });

      e.preventDefault();
    });
  }

  function onDragMove(e) {
    const panel = document.getElementById(IDS.panel);
    if (!panel || !state.drag) return;
    const rect = panel.getBoundingClientRect();
    const nextLeft = Math.max(4, Math.min(window.innerWidth - rect.width - 4, state.drag.left + e.clientX - state.drag.startX));
    const nextTop = Math.max(4, Math.min(window.innerHeight - 40, state.drag.top + e.clientY - state.drag.startY));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  }

  function onDragEnd() {
    document.removeEventListener('mousemove', onDragMove);
    state.drag = null;
  }

  function ensurePanelInViewport(panel) {
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth) panel.style.right = '12px';
    if (rect.bottom > window.innerHeight && rect.top > 80) panel.style.top = '82px';
  }

  function renderInterim(orderResults, groupSummary, tasks, warnings) {
    const host = document.getElementById(IDS.result);
    if (!host) return;
    const orderSummary = orderResults.map(summarizeOrder);
    host.innerHTML = renderOrderAndRanges(orderSummary, groupSummary, tasks, warnings, null);
  }

  function renderResult(data) {
    const host = document.getElementById(IDS.result);
    if (!host || !data) return;

    const cards = Array.isArray(data.cards) ? data.cards : [];
    const ranges = Array.isArray(data.rangeTasks) ? data.rangeTasks : [];
    const groupSummary = Array.isArray(data.groupSummary) ? data.groupSummary : [];
    const orderSummary = Array.isArray(data.orderSummary) ? data.orderSummary : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const categorySummary = summarizeMainCardCategories(cards);

    // 不直接依赖旧缓存里的cardSummary，确保旧缓存也能按当前版本中文状态重新展示。
    const statusEntries = Object.entries(
      countBy(cards, (card) => translateCardStatus(card))
    );
    const activityEntries = Object.entries(
      countBy(cards, (card) => String(card?.activity_name || '').trim())
    );

    const statusToneMap = {
      '生效中': 'is-enable',
      '已预约': 'is-booked',
      '已核销': 'is-used',
      '冻结': 'is-freeze',
      '作废': 'is-invalid',
    };
    const queryStart = data?.queryPeriod?.startDate || '-';
    const queryEnd = data?.queryPeriod?.endDate || '-';

    const detailHtml = renderOrderAndRanges(
      orderSummary,
      groupSummary,
      ranges,
      warnings,
      true
    );

    host.innerHTML = `
      <div class="hlj-scope-hint">本年度实际办卡情况（全量）</div>

      <div class="hlj-main-summary">
        <div class="hlj-main-card hlj-main-card-mri">
          <div class="hlj-main-card-label">核磁</div>
          <div class="hlj-main-card-value">${Number(categorySummary.mri || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>

        <div class="hlj-main-card hlj-main-card-ct">
          <div class="hlj-main-card-label">CT</div>
          <div class="hlj-main-card-value">${Number(categorySummary.ct || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>

        <div class="hlj-main-card hlj-main-card-invite">
          <div class="hlj-main-card-label">邀约</div>
          <div class="hlj-main-card-value">${Number(categorySummary.invite || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>

        <div class="hlj-main-card hlj-main-card-vip">
          <div class="hlj-main-card-label">贵宾</div>
          <div class="hlj-main-card-value">${Number(categorySummary.vip || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>
      </div>

      <div class="hlj-brief-line">
        <span>查询区间 <b>${escapeHtml(queryStart)} ～ ${escapeHtml(queryEnd)}</b></span>
        <span>本次卡池数据 <b>${cards.length}</b> 张</span>
        ${
          Number(categorySummary.other || 0) > 0
            ? `<span class="is-muted">其他类型 <b>${Number(categorySummary.other || 0)}</b> 张</span>`
            : ''
        }
        <span class="is-muted">更新时间：${escapeHtml(data.updatedAt || '-')}</span>
      </div>

      <div class="hlj-personnel-box">
        <div class="hlj-personnel-head">
          <div class="hlj-personnel-selects">
            <div class="hlj-smart-select" data-smart-select="department"></div>
            <div class="hlj-smart-select" data-smart-select="person"></div>
          </div>
          <div class="hlj-personnel-scope-hint">人员计划及办理进度</div>
        </div>
        <div data-personnel-content="1"></div>
      </div>

      <details class="hlj-fold">
        <summary>查询明细</summary>
        <div class="hlj-fold-body">
          <div class="hlj-detail-meta">
            <div class="hlj-detail-meta-item">
              <div class="hlj-detail-meta-label">审批记录</div>
              <div class="hlj-detail-meta-value">${Number(data.processRecordCount || 0)} 条</div>
            </div>
            <div class="hlj-detail-meta-item">
              <div class="hlj-detail-meta-label">查询卡段</div>
              <div class="hlj-detail-meta-value">${ranges.length} 段</div>
            </div>
            <div class="hlj-detail-meta-item">
              <div class="hlj-detail-meta-label">审批办卡数量</div>
              <div class="hlj-detail-meta-value">${Number(data.approvalCardNumSum || 0)} 张</div>
            </div>
          </div>
          ${detailHtml}
        </div>
      </details>

      <details class="hlj-fold">
        <summary>卡池分类明细</summary>
        <div class="hlj-fold-body">
          <div class="hlj-detail-grid">
            <div class="hlj-detail-card">
              <div class="hlj-detail-card-title">卡状态</div>
              <div class="hlj-detail-tags">
                ${
                  statusEntries.length
                    ? statusEntries.map(([name, value]) => `
                        <span class="hlj-detail-tag ${statusToneMap[name] || ''}">
                          ${escapeHtml(name)} <b>${Number(value)}</b>
                        </span>
                      `).join('')
                    : '<span class="hlj-detail-tag">暂无</span>'
                }
              </div>
            </div>

            <div class="hlj-detail-card">
              <div class="hlj-detail-card-title">实际卡类</div>
              <div class="hlj-detail-tags">
                ${
                  activityEntries.length
                    ? activityEntries.map(([name, value]) => `
                        <span class="hlj-detail-tag">
                          ${escapeHtml(name || '未分类')} <b>${Number(value)}</b>
                        </span>
                      `).join('')
                    : '<span class="hlj-detail-tag">暂无</span>'
                }
              </div>
            </div>
          </div>
        </div>
      </details>
    `;

    bindPersonnelSelectors(host, cards);
  }

  function renderPersonnelContent(host, cards, department, personName) {
    const content = host.querySelector('[data-personnel-content="1"]');
    if (!content) return;

    const info = summarizePersonnel(cards, department, personName);
    const statusOrder = ['生效中', '已预约', '已核销', '冻结', '作废'];
    const statusClassMap = {
      '生效中': 'is-enable',
      '已预约': 'is-booked',
      '已核销': 'is-used',
      '冻结': 'is-freeze',
      '作废': 'is-invalid',
    };
    const cardRows = Array.isArray(info.cardRows) ? info.cardRows : [];

    const rowHtml = cardRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.category)}</td>
        <td><b>${Number(row.total || 0)}</b></td>
        ${statusOrder.map((status) => {
          const value = Number(row.statuses?.[status] || 0);
          const toneClass = statusClassMap[status] || '';
          return `
            <td>
              <span class="hlj-status-value ${toneClass} ${value === 0 ? 'is-zero' : ''}">
                ${value}
              </span>
            </td>
          `;
        }).join('')}
      </tr>
    `).join('');

    const showDepartmentOverview =
      department === '全部部门' &&
      personName === '全部人员';

    const departmentOverviewHtml = showDepartmentOverview
      ? `
        <div class="hlj-department-overview">
          <div class="hlj-department-overview-title">
            <span>各部门领取进度</span>
            <span class="hlj-department-overview-sub">已办理 / 总数量</span>
          </div>

          ${buildDepartmentProgress(cards).map((item) => `
            <div class="hlj-department-row">
              <div class="hlj-department-name">${escapeHtml(item.department)}</div>
              <div class="hlj-department-stat">总数 <b>${Number(item.plan)}</b></div>
              <div class="hlj-department-stat">已办 <b>${Number(item.current)}</b></div>
              <div class="hlj-department-stat ${item.overPlan > 0 ? 'is-over' : 'is-remaining'}">
                ${item.overPlan > 0 ? '超出' : '剩余'}
                <b>${item.overPlan > 0 ? Number(item.overPlan) : Number(item.balance)}</b>
              </div>
            </div>
          `).join('')}
        </div>
      `
      : '';

    content.innerHTML = `
      <div class="hlj-personnel-kpis">
        <div class="hlj-personnel-kpi is-total">
          <div class="hlj-personnel-kpi-label">总数量</div>
          <div class="hlj-personnel-kpi-value">${Number(info.plan || 0)}</div>
        </div>
        <div class="hlj-personnel-kpi ${Number(info.overPlan || 0) > 0 ? 'is-over' : 'is-done'}">
          <div class="hlj-personnel-kpi-label">${Number(info.overPlan || 0) > 0 ? '已办理（超出）' : '已办理'}</div>
          <div class="hlj-personnel-kpi-value">${Number(info.current || 0)}</div>
        </div>
        <div class="hlj-personnel-kpi ${Number(info.balance || 0) > 0 ? 'is-remaining' : (Number(info.overPlan || 0) > 0 ? 'is-over' : 'is-empty')}">
          <div class="hlj-personnel-kpi-label">还可申请</div>
          <div class="hlj-personnel-kpi-value">${Number(info.balance || 0)}</div>
        </div>
      </div>

      ${
        Number(info.overPlan || 0) > 0
          ? `<div class="hlj-personnel-over">当前已办理数量超过计划 ${Number(info.overPlan)} 张，请核对。</div>`
          : ''
      }

      <div class="hlj-card-matrix">
        <div class="hlj-card-matrix-title">领取卡类及状态</div>
        ${
          rowHtml
            ? `
              <table>
                <thead>
                  <tr>
                    <th>卡类</th>
                    <th>数量</th>
                    <th class="hlj-status-head is-enable">生效中</th>
                    <th class="hlj-status-head is-booked">已预约</th>
                    <th class="hlj-status-head is-used">已核销</th>
                    <th class="hlj-status-head is-freeze">冻结</th>
                    <th class="hlj-status-head is-invalid">作废</th>
                  </tr>
                </thead>
                <tbody>${rowHtml}</tbody>
              </table>
            `
            : '<div style="padding:12px;color:#64748b;font-size:12px;">当前选择范围内暂未查询到卡。</div>'
        }
      </div>

      ${departmentOverviewHtml}
    `;
  }

  function bindPersonnelSelectors(host, cards) {
    const departmentHost = host.querySelector('[data-smart-select="department"]');
    const personHost = host.querySelector('[data-smart-select="person"]');
    if (!departmentHost || !personHost) return;

    const departmentProgress = buildDepartmentProgress(cards);

    let selectedDepartment = '全部部门';
    let selectedPerson = '全部人员';

    function makeItem(name, current, plan) {
      const done = Number(current || 0);
      const total = Number(plan || 0);
      return {
        name,
        current: done,
        plan: total,
        balance: Math.max(0, total - done),
        over: Math.max(0, done - total),
      };
    }

    function renderSmartSelect(container, items, selectedName, onSelect) {
      const selected = items.find((item) => item.name === selectedName) || items[0];

      container.innerHTML = `
        <button type="button" class="hlj-smart-select-btn">
          <span class="hlj-smart-name">${escapeHtml(selected?.name || '-')}</span>
          <span class="hlj-smart-progress">${Number(selected?.current || 0)}/${Number(selected?.plan || 0)}</span>
          <span class="hlj-smart-balance ${Number(selected?.over || 0) > 0 ? 'is-over' : ''}">
            ${Number(selected?.over || 0) > 0 ? `超${Number(selected.over)}` : `余${Number(selected?.balance || 0)}`}
          </span>
        </button>

        <div class="hlj-smart-menu">
          ${items.map((item) => `
            <button
              type="button"
              class="hlj-smart-option ${item.name === selected?.name ? 'is-active' : ''}"
              data-smart-value="${escapeHtml(item.name)}"
            >
              <span class="hlj-smart-name">${escapeHtml(item.name)}</span>
              <span class="hlj-smart-progress">${Number(item.current || 0)}/${Number(item.plan || 0)}</span>
              <span class="hlj-smart-balance ${Number(item.over || 0) > 0 ? 'is-over' : ''}">
                ${Number(item.over || 0) > 0 ? `超${Number(item.over)}` : `余${Number(item.balance || 0)}`}
              </span>
            </button>
          `).join('')}
        </div>
      `;

      const btn = container.querySelector('.hlj-smart-select-btn');
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();

        host.querySelectorAll('.hlj-smart-select.is-open').forEach((node) => {
          if (node !== container) node.classList.remove('is-open');
        });

        container.classList.toggle('is-open');
      });

      container.querySelectorAll('[data-smart-value]').forEach((option) => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          container.classList.remove('is-open');
          onSelect(option.getAttribute('data-smart-value') || '');
        });
      });
    }

    function departmentItems() {
      const allPlan = getPlanForPeople(PERSONNEL_PLAN);
      const allNames = new Set(PERSONNEL_PLAN.map((item) => item.name));
      const allCurrent = countCardsForNames(cards, allNames);

      return [
        makeItem('全部部门', allCurrent, allPlan),
        ...departmentProgress.map((item) =>
          makeItem(item.department, item.current, item.plan)
        ),
      ];
    }

    function personItems(department) {
      const people = buildPersonProgress(cards, department);
      const basePeople = PERSONNEL_PLAN.filter(
        (item) => department === '全部部门' || item.department === department
      );
      const groupPlan = getPlanForPeople(basePeople);
      const groupNames = new Set(basePeople.map((item) => item.name));
      const groupCurrent = countCardsForNames(cards, groupNames);

      return [
        makeItem('全部人员', groupCurrent, groupPlan),
        ...people.map((item) =>
          makeItem(item.name, item.current, item.plan)
        ),
      ];
    }

    function redrawDepartment() {
      renderSmartSelect(
        departmentHost,
        departmentItems(),
        selectedDepartment,
        (value) => {
          selectedDepartment = value || '全部部门';
          selectedPerson = '全部人员';
          redrawDepartment();
          redrawPerson();
          renderPersonnelContent(host, cards, selectedDepartment, selectedPerson);
        }
      );
    }

    function redrawPerson() {
      const items = personItems(selectedDepartment);

      if (!items.some((item) => item.name === selectedPerson)) {
        selectedPerson = '全部人员';
      }

      renderSmartSelect(
        personHost,
        items,
        selectedPerson,
        (value) => {
          selectedPerson = value || '全部人员';
          redrawPerson();
          renderPersonnelContent(host, cards, selectedDepartment, selectedPerson);
        }
      );
    }

    if (!host.__hljSmartOutsideBound) {
      host.__hljSmartOutsideBound = true;
      host.addEventListener('click', (e) => {
        if (!e.target.closest('.hlj-smart-select')) {
          host.querySelectorAll('.hlj-smart-select.is-open').forEach(
            (node) => node.classList.remove('is-open')
          );
        }
      });
    }

    redrawDepartment();
    redrawPerson();
    renderPersonnelContent(host, cards, selectedDepartment, selectedPerson);
  }

  function renderOrderAndRanges(orderSummary, groupSummary, ranges, warnings, withPool) {
    const orderRows = orderSummary.map((x) => {
      const displayName = String(x.orderName || '')
        .replace('新乡邀约体验', '')
        .replace('贵宾检', '贵宾检');

      return `
        <tr>
          <td>${escapeHtml(displayName || x.orderName)}</td>
          <td>${Number(x.records || 0)}</td>
          <td>${Number(x.cardNumSum || 0)} 张</td>
          <td>${escapeHtml(x.firstBindTime || '-')} ～ ${escapeHtml(x.lastBindTime || '-')}</td>
        </tr>
      `;
    }).join('');

    const taskRows = ranges.map((x, idx) => {
      const expected = Number(x.whitelistCardCount || 0);
      const found = Number(x.matchedUniqueCards || 0);
      const resultClass = !withPool || found === expected ? 'is-ok' : 'is-partial';

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(x.queryStart || '-')}</td>
          <td>${escapeHtml(x.queryEnd || '-')}</td>
          <td>
            ${
              withPool
                ? `<span class="hlj-range-result ${resultClass}">${found}/${expected}</span>`
                : `${expected} 张`
            }
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="hlj-section">
        <div class="hlj-section-title">今年办卡记录</div>
        <table>
          <thead>
            <tr>
              <th style="width:39%;">订单</th>
              <th style="width:11%;">办理次数</th>
              <th style="width:15%;">办卡数量</th>
              <th>办理日期范围</th>
            </tr>
          </thead>
          <tbody>${orderRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
        </table>
      </div>

      <div class="hlj-section">
        <div class="hlj-section-title">实际查询卡段</div>
        <table>
          <thead>
            <tr>
              <th style="width:7%;">#</th>
              <th>开始卡号</th>
              <th>结束卡号</th>
              <th style="width:14%;">${withPool ? '找到 / 区间' : '区间数量'}</th>
            </tr>
          </thead>
          <tbody>${taskRows || '<tr><td colspan="4">暂无</td></tr>'}</tbody>
        </table>
        ${
          warnings?.length
            ? `<div style="padding:7px 10px;background:#fff7e8;color:#8a5a00;font-size:10px;">⚠ ${escapeHtml(warnings.join('；'))}</div>`
            : ''
        }
      </div>
    `;
  }


  // ============================================================
  // 6. SPA 生命周期
  // ============================================================
  function ensureAll() {
    ensureStyle();
    ensureSwitch();

    if (!isAllowedRoute()) return;

    updateSwitchText();
  }

  function scheduleEnsure() {
    clearTimeout(state.observerTimer);
    state.observerTimer = setTimeout(ensureAll, 80);
  }

  window.addEventListener('hashchange', scheduleEnsure, true);
  window.addEventListener('resize', () => {
    const panel = document.getElementById(IDS.panel);
    if (panel && panel.style.display !== 'none') ensurePanelInViewport(panel);
  });

  const observer = new MutationObserver(scheduleEnsure);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  ensureAll();
  setTimeout(ensureAll, 500);
  setTimeout(ensureAll, 1500);
})();
