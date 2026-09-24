// ==UserScript==
// @name         扁鹊-1.6制卡管理查询
// @namespace    https://tampermonkey.net/
// @version      0.5.6
// @description  查询并汇总本年度的贵宾、邀约、核磁、CT等制卡记录，按部门/人员统计办卡进度。
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
    cardModal: `${NS}_card_modal`,
  };

  const TOP_TOOL_GROUP_ID = '__hlj_soa_top_tool_group_v1';

  const CACHE_KEY = `${NS}_cache`;
  const CACHE_SCHEMA = 2;

  // 面板宽度：右上角的竖条把手可拖动调整，宽度记在本地，下次打开沿用。
  const PANEL_WIDTH_KEY = `${NS}_panelWidth`;
  const PANEL_WIDTH_DEFAULT = 760;
  const PANEL_WIDTH_MIN = 420;
  const PANEL_WIDTH_MAX = 1400;
  // 面板宽度小于该值时内部 grid 降列（视口 media query 管不到浮层自身的宽度）
  const PANEL_COMPACT_WIDTH = 620;
  // 更窄一档。四张卡类汇总（贵宾/邀约/核磁/CT）在 620 降到 2×2 太早了 ——
  // 单卡 100px 左右就够放「贵宾 541 张」，所以它们只在 <480 时才折两排。
  const PANEL_NARROW_WIDTH = 480;
  // 面板左右两侧最少留白（右 24px 初始定位 + 左 16px），用来算「视口限制下的最大宽度」
  const PANEL_VIEWPORT_MARGIN = 40;

  // 版本号单一来源：改动时与文件头 @version 一并同步
  const SCRIPT_VERSION = '0.5.6';

  const PROCESS_API = '/soa-card/api/v1/bqcard/process/page';
  const POOL_API = '/soa-card/api/v1/card/business/pool/display';

  // 单卡详情。**卡备注（remark）只有这里能拿到** —— 2026-09-15 实测：
  // 卡池列表接口（card/business/pool/display、card/info/query）返回的字段里都没有 remark，
  // 必须按卡号单独查一次。实测单次 250~330ms、响应约 18KB
  // （大头是 packageList 的体检项目明细，请求侧去不掉），所以只在用户点开时才拉、且带缓存。
  const CARD_DETAIL_API = '/soa-card/api/v1/bqcard/detail';
  const CARD_REMARK_CONCURRENCY = 4;
  // 一次弹窗最多自动拉多少张卡的备注。超过就只拉前这么多，余下的点开单卡时再补 ——
  // 免得手一抖点了几百张就把请求打爆。
  const CARD_REMARK_AUTO_LIMIT = 60;

  const PAGE_SIZE = 100;

  // 卡号结构（2026-09-15 用真实登录态实测确认，354/354 样本一致）：
  //   年份(2) + 标识(3，如 X7A) + 活动码(6) + 序号(6) = 共 17 位
  //   例：26X7A210373130076 = 26 | X7A | 210373 | 130076
  // 分组键取「年份 + 标识 + 活动码」，即一个活动一组：
  // 序号再涨也不会把同一活动拆到两个组里，查询边界也用原始卡号透传，不靠位数重建。
  const CARD_HEAD_LEN = 5;
  const ACTIVITY_LEN = 6;
  const SERIAL_LEN = 6;
  const CARD_NO_LEN = CARD_HEAD_LEN + ACTIVITY_LEN + SERIAL_LEN;

  // 相邻白名单卡号之间的「空洞」宽度 <= 该阈值时，跨过去合并成同一段查询。
  //
  // 为什么取 100，而不是按实测 gap 分布取「双峰中间」：
  //   跨过空洞的代价 = ceil(空洞内的卡数 / 100) 页；
  //   而同一个号段里一个序号最多对应一张卡，所以  卡数 <= 空洞宽度。
  //   => 空洞宽度 <= 100 时，跨过去最多只多 1 页，无论空洞里塞了多少卡。
  //   这是唯一一条不依赖「当前数据长什么样」的安全边界，永远成立。
  //
  // 收益是省下 1~2 页（把两个小段并成一段），封顶；亏损按阈值线性放大。
  // 实测（2026-09-15）阈值 10~9000 之间段数与页数完全一致（9 段 / 17 页），
  // 所以压到 100 不损失任何收益，只是把最坏情况从 5 页压到 1 页。
  const GAP_LIMIT = 100;

  // 运行参数。concurrency 默认 1（等同串行，行为与旧版一致），调高可提速但请求更密集。
  const RUN_CONFIG = {
    concurrency: 1,
    requestTimeoutMs: 15000,
    maxRequestsPerRun: 60,
    segmentRetries: 2,
    minPaceMs: 150,
  };

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

  const state = {
    running: false,
    collapsed: false,
    observerTimer: 0,
    drag: null,
    // 最近一次渲染的结果，供「单独重查某段」时做增量更新
    lastData: null,
    rechecking: false,
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

  // 仅用于把序号补成定长字符串做展示/兜底。查询边界不靠它重建，直接用原始卡号。
  function padSerial(n) {
    const max = Math.pow(10, SERIAL_LEN) - 1;
    return String(Math.max(0, Math.min(max, Number(n) || 0))).padStart(SERIAL_LEN, '0');
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
  async function postJson(url, body, timeoutMs = RUN_CONFIG.requestTimeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          mnclientid: 'MN_SOA3',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`请求超时（${timeoutMs}ms）`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

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

  // ============================================================
  // 2.1 单卡详情（卡备注）—— 按需拉取 + 内存缓存 + 限并发
  // ============================================================
  // 「卡备注」= 制卡时在卡详情弹窗里填的那段文字，只存在于单卡详情接口，
  // 卡池列表接口一律不返回（实测确认）。所以只能在用户点开时才逐张查。
  // 实测同一批制卡的备注常常一模一样（连续 6 张都是「刘承业办理」），
  // 但不能据此推断，仍然逐张取真实值。
  const cardDetailCache = new Map();

  async function fetchCardDetail(cardNo) {
    const key = String(cardNo || '').trim();
    if (!key) return { status: 'error', error: '空卡号' };
    if (cardDetailCache.has(key)) return cardDetailCache.get(key);

    try {
      const json = await postJson(CARD_DETAIL_API, { regionCode: 'XX', cardNo: key });
      const data = getDataBlock(json);
      const detail = {
        status: 'ok',
        remark: String(data?.remark ?? '').trim(),
        corpName: String(data?.corpName ?? '').trim(),
        orderCode: String(data?.orderCode ?? '').trim(),
        orderBeginDate: String(data?.orderBeginDate ?? '').trim(),
        orderEndDate: String(data?.orderEndDate ?? '').trim(),
        currentAmount: data?.currentAmount,
        saleAmount: data?.saleAmount,
      };
      cardDetailCache.set(key, detail);
      return detail;
    } catch (err) {
      // 失败**不写缓存**，下次点开还能重试
      return { status: 'error', error: String(err?.message || err) };
    }
  }

  // 限并发跑一批任务。worker 每张回来就回调一次 —— 界面可以边拉边填，
  // 不用等整批跑完（几十张串行要十几秒，弹窗看着就像卡死了）。
  async function mapWithConcurrency(list, concurrency, worker) {
    const queue = Array.isArray(list) ? list.slice() : [];
    if (!queue.length) return;

    const size = Math.max(1, Math.min(Number(concurrency) || 1, queue.length));
    const runners = new Array(size).fill(null).map(async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    });

    await Promise.all(runners);
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
  // 结构化解析卡号：年份(2) + 标识(3) + 活动码(6) + 序号(6) = 17 位。
  // 长度或分段不符合该结构的一律返回 null（旧版纯数字卡等不在本脚本查询范围内）。
  function splitCardNo(cardNo) {
    const text = String(cardNo || '').trim();
    if (text.length !== CARD_NO_LEN) return null;

    const head = text.slice(0, CARD_HEAD_LEN);
    const activity = text.slice(CARD_HEAD_LEN, CARD_HEAD_LEN + ACTIVITY_LEN);
    const serialText = text.slice(-SERIAL_LEN);

    if (!/^\d{2}[A-Za-z0-9]{3}$/.test(head)) return null;
    if (!/^\d+$/.test(activity)) return null;
    if (!/^\d+$/.test(serialText)) return null;

    return {
      cardNo: text,
      head,
      activity,
      // 分组键：年份 + 标识 + 活动码，一个活动一组
      prefix: head + activity,
      serial: Number(serialText),
      serialText,
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

    // 白名单为什么必须按「区间并集」算，而不是把各条审批的卡数相加：
    //   同一批号可能被反复申请 —— 跳号提交后作废、再重新提交，号码被复用，
    //   于是同一个卡号会落在多条审批记录里。实测 177 条记录共 865 个号，
    //   去重后是 861 个（重叠 4 个），差额就来自 3 条 INVALID（作废）记录与 ACCESS 记录重叠。
    //   卡池侧不用操心重复：每个卡号在卡池里只出现一次（实测三个范围共 2072 张，跨范围重复 0），
    //   所以「审批侧去重 + 卡池侧天然唯一」两边一对，汇总不会虚增也不会漏。
    //
    // 关于 processStatus：
    //   实测取值只有 ACCESS(174) 和 INVALID(3)。INVALID 的区间 100% 被 ACCESS 覆盖，
    //   所以过不过滤对白名单并集都没影响（都是 861）。这里选择不过滤 ——
    //   万一将来某个作废记录覆盖了 ACCESS 没覆盖的号（作废前已制卡），过滤掉就会漏卡，
    //   而多带几个号的代价几乎为零。该字段仅用于诊断展示。

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
        warnings.push(`审批区间跨越活动或年份，暂不自动拆分：${begin.cardNo} ~ ${end.cardNo}`);
        continue;
      }

      let startSerial = begin.serial;
      let endSerial = end.serial;
      let startCardNo = begin.cardNo;
      let endCardNo = end.cardNo;
      if (startSerial > endSerial) {
        warnings.push(`审批区间起止倒置，已自动交换：${begin.cardNo} ~ ${end.cardNo}`);
        [startSerial, endSerial] = [endSerial, startSerial];
        [startCardNo, endCardNo] = [endCardNo, startCardNo];
      }

      const lengthByRange = endSerial - startSerial + 1;
      const cardNum = Number(item?.cardNum || 0) || 0;
      if (cardNum > 0 && cardNum !== lengthByRange) {
        warnings.push(
          `cardNum与卡号区间长度不一致：${startCardNo} ~ ${endCardNo}，cardNum=${cardNum}，区间=${lengthByRange}`
        );
      }

      rawIntervals.push({
        recordKey,
        id: item?.id ?? null,
        prefix: begin.prefix,
        head: begin.head,
        activity: begin.activity,
        startSerial,
        endSerial,
        // 查询边界保留审批记录里的原始卡号，不做补零重建，避免位数假设出错
        beginNo: startCardNo,
        endNo: endCardNo,
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

      // 白名单应有卡数：按区间并集直接算长度，不逐号展开成字符串集合
      // （跨度大时不会瞬间生成几万个字符串对象）。
      const whitelistTotal = unionLength(intervals);

      // 合并判据：相邻区间之间的空洞 <= GAP_LIMIT 就跨过去合并成一段。
      // 空洞里可能堆着别的订单的卡（实测最多一段 1427 张），
      // 那些卡查回来会被 isCardInWhitelist 过滤掉，代价只是多占一点页容量。
      const merged = [];
      for (const it of intervals) {
        const last = merged[merged.length - 1];
        if (!last || it.startSerial > last.endSerial + GAP_LIMIT) {
          merged.push({
            prefix: group.prefix,
            startSerial: it.startSerial,
            endSerial: it.endSerial,
            beginNo: it.beginNo,
            endNo: it.endNo,
            sourceRecords: [it],
          });
        } else {
          last.sourceRecords.push(it);
          if (it.endSerial > last.endSerial) {
            last.endSerial = it.endSerial;
            last.endNo = it.endNo;
          }
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
        whitelistCardCount: whitelistTotal,
        firstBindTime: bindTimes[0] || '',
        lastBindTime: bindTimes[bindTimes.length - 1] || '',
      });

      merged.forEach((m, index) => {
        tasks.push({
          taskId: `${group.prefix}:${index + 1}`,
          prefix: group.prefix,
          cardTypes: [...group.cardTypes].sort(),
          orderNames: [...group.orderNames].sort(),
          // 原始卡号直接透传：queryStart/queryEnd 就是审批记录里的写法，不做位数重建
          queryStart: m.beginNo,
          queryEnd: m.endNo,
          startSerial: m.startSerial,
          endSerial: m.endSerial,
          // 本段真实白名单卡数（区间并集长度），不含被顺带合并进来的空洞
          whitelistCardCount: unionLength(m.sourceRecords),
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

  // ============================================================
  // 审批时间（bindTime）—— 零新增请求
  //
  // 审批记录里本来就带 bindTime，buildWhitelistAndTasks 已把它存进
  // rawIntervals[].bindTime（见该函数里 rawIntervals.push 那段）。
  // 这里只做「卡号 → 所属审批区间 → 取该区间的 bindTime」的本地查表，
  // **不发任何请求**。
  //
  // ⚠️ 精度：process/page 的 bindTime 只到「日期」（如 2026-09-24）。
  //    若哪天要精确到秒，得改调 process/detail（那才是新增请求）——
  //    且 process/detail 的 remark 与 1.6 现用的 bqcard/detail 不同源，
  //    动之前先读档案 03 的「时间字段实测」一节。
  // ============================================================
  function normalizeBindDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    // 只保留 YYYY-MM-DD；带时分秒的也一并截到天，保证与 1.3 口径一致。
    const match = text.match(/\d{4}-\d{1,2}-\d{1,2}/);
    return match ? match[0] : text;
  }

  function buildBindTimeLookup(rawIntervals) {
    const byPrefix = new Map();

    for (const it of Array.isArray(rawIntervals) ? rawIntervals : []) {
      if (!it?.prefix) continue;
      if (!byPrefix.has(it.prefix)) byPrefix.set(it.prefix, []);
      byPrefix.get(it.prefix).push(it);
    }

    for (const list of byPrefix.values()) {
      list.sort((a, b) => a.startSerial - b.startSerial || a.endSerial - b.endSerial);
    }

    return byPrefix;
  }

  function getCardBindDate(cardNo, bindTimeLookup) {
    if (!bindTimeLookup?.size) return '';

    const parsed = splitCardNo(cardNo);
    if (!parsed) return '';

    const intervals = bindTimeLookup.get(parsed.prefix);
    if (!intervals?.length) return '';

    for (const it of intervals) {
      if (parsed.serial < it.startSerial) break;
      if (parsed.serial <= it.endSerial) return normalizeBindDate(it.bindTime);
    }

    return '';
  }

  // 同一前缀内若干区间的并集长度（去重后的卡数）。
  // 直接对区间端点做运算，不逐号展开成字符串，跨度再大也只是几段相加。
  function unionLength(intervals) {
    if (!intervals.length) return 0;

    const list = intervals.slice().sort((a, b) =>
      a.startSerial - b.startSerial || a.endSerial - b.endSerial
    );

    let total = 0;
    let curStart = list[0].startSerial;
    let curEnd = list[0].endSerial;

    for (let i = 1; i < list.length; i += 1) {
      const it = list[i];
      if (it.startSerial <= curEnd + 1) {
        if (it.endSerial > curEnd) curEnd = it.endSerial;
      } else {
        total += curEnd - curStart + 1;
        curStart = it.startSerial;
        curEnd = it.endSerial;
      }
    }

    total += curEnd - curStart + 1;
    return total;
  }

  // 审批白名单去重后的卡数（跨前缀累计）。
  function countExpectedCards(rawIntervals) {
    const byPrefix = new Map();
    for (const it of rawIntervals) {
      if (!byPrefix.has(it.prefix)) byPrefix.set(it.prefix, []);
      byPrefix.get(it.prefix).push(it);
    }

    let total = 0;
    for (const list of byPrefix.values()) total += unionLength(list);
    return total;
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

  // ============================================================
  // 卡池 item 的「有效期 / 金额」取值
  //
  // ⚠️ 取值口径与「扁鹊-1.3 体检数据查询」保持逐字一致（直接照搬那边实现）——
  //    两边弹窗显示同一张卡时，日期与金额不能打架。
  //
  // 卡池日期实测有两种形态：毫秒时间戳字符串（1790179200000）与 "2026-09-22"，
  // 故必须走 formatPoolItemDate 统一，别自己 new Date() 硬转。
  // ============================================================
  function pickPoolItemText(item, keys) {
    if (!item || typeof item !== 'object') return '';
    for (const key of keys) {
      const text = String(item[key] ?? '').trim();
      if (text) return text;
    }
    return '';
  }

  function formatPoolItemDate(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';

    let year = null;
    let month = null;
    let day = null;

    if (/^\d{13}$/.test(text)) {
      const date = new Date(Number(text));
      if (Number.isFinite(date.getTime())) {
        year = date.getFullYear();
        month = date.getMonth() + 1;
        day = date.getDate();
      }
    } else {
      const match = text.match(/(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/);
      if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      }
    }

    if (year === null || month === null || day === null) return text;

    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
  }

  function getPoolItemDateRange(item) {
    const begin = formatPoolItemDate(
      pickPoolItemText(item, ['begin_date', 'beginDay', 'beginDate', 'create_at', 'createAt'])
    );
    const end = formatPoolItemDate(
      pickPoolItemText(item, ['end_date', 'endDay', 'endDate', 'init_end_date'])
    );

    if (begin && end && begin !== end) return `${begin} ~ ${end}`;
    return begin || end;
  }

  /*
   * 金额只取一个，并标明它是什么钱：
   *   储值卡 → currentAmount（当前余额）
   *   其余   → 卡金额（initAmount / saleAmount / sale_price / price）
   * 不做单位换算、不猜语义：取不到就显示 -。
   */
  function getPoolItemAmountInfo(item) {
    const current = Number(item?.currentAmount);
    if (item?.currentAmount !== undefined && item?.currentAmount !== null &&
        String(item.currentAmount).trim() !== '' && Number.isFinite(current)) {
      return { label: '当前余额', text: `¥${current.toFixed(2)}` };
    }

    const matched = [
      ['initAmount', '卡金额'],
      ['saleAmount', '卡金额'],
      ['sale_price', '卡金额'],
      ['price', '卡金额'],
    ].find(([key]) => {
      const raw = item?.[key];
      if (raw === undefined || raw === null || String(raw).trim() === '') return false;
      return Number.isFinite(Number(raw));
    });

    if (!matched) return null;

    return { label: matched[1], text: `¥${Number(item[matched[0]]).toFixed(2)}` };
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

  // 卡种展示顺序：贵宾 / 邀约 / 核磁 / CT（「其他」垫底兜底）。
  // 2026-09-15 红领巾指定，这里是**全脚本唯一来源** —— 顶部汇总卡、上方「领取卡类及状态」
  // 表、下方「各部门 / 各人领取进度」表的列，全部由这个数组排出来，改这一处即全站一致。
  const FIXED_CARD_CATEGORIES = ['贵宾', '邀约', '核磁', 'CT'];
  const CARD_CATEGORY_ORDER = [...FIXED_CARD_CATEGORIES, '其他'];

  // 把一批卡按卡种聚合，返回**全键**计数（没出现的卡种补 0）。
  // v0.4.0 只返回出现过的卡种（数组）。那时卡种是缀在姓名后面的小标签，缺项无所谓；
  // 现在卡种是固定列，缺一个键整行数量就会左移一格、列语义全错 —— 必须给全键。
  function countCardsByCategory(cards) {
    const counts = Object.fromEntries(CARD_CATEGORY_ORDER.map((category) => [category, 0]));

    for (const card of Array.isArray(cards) ? cards : []) {
      const category = getCardCategoryLabel(card?.activity_name);
      if (Object.prototype.hasOwnProperty.call(counts, category)) counts[category] += 1;
    }

    return counts;
  }

  // 一次遍历把卡按领取人分好组，避免「每人再过滤一遍全部卡」（O(人数 × 卡数)）。
  function groupCardsBySaleName(cards) {
    const grouped = new Map();

    for (const card of Array.isArray(cards) ? cards : []) {
      const name = getCardSaleName(card);
      if (!name) continue;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(card);
    }

    return grouped;
  }

  // 表头用哪几列卡种：固定四列；只有真的出现「其他」（储值卡 / 电商卡等非制卡类）时才多一列，
  // 免得为个位数把四列主体结构挤变形。列集合是整表统一的，不存在逐行漂移。
  function getCategoryColumns(items) {
    const hasOther = (Array.isArray(items) ? items : [])
      .some((item) => Number(item?.categoryCounts?.['其他'] || 0) > 0);

    return hasOther ? CARD_CATEGORY_ORDER.slice() : FIXED_CARD_CATEGORIES.slice();
  }

  // 进度表（部门视角 / 个人视角共用）：**表头 = 卡类型，每行 = 对应数量**。
  // 用真表格而不是 grid + 行内小标签 —— v0.4.0 把「贵宾36 邀约4」缀在姓名后面，
  // 词组长度逐行不同，肉眼扫读很难归成列，"哪一格是什么"全靠脑补，就是红领巾说的视觉误差。
  // table + table-layout:fixed 下，列宽由表头定死、跟内容无关，跨行严格对齐。
  function buildProgressTableHtml(items, options) {
    const list = Array.isArray(items) ? items : [];
    const columns = getCategoryColumns(list);
    const nameHead = options?.nameHead || '姓名';
    const getName = typeof options?.getName === 'function' ? options.getName : (item) => item?.name || '';
    // 名字格做成可点跳转（部门视角跳到该部门、个人视角跳到该人）。
    // 具体挂什么 data 属性由调用方给 —— 这里只负责渲染，不猜跳转目标。
    const jumpAttr = typeof options?.jumpAttr === 'function' ? options.jumpAttr : null;
    // 卡种列的数字也可点（点开「这一行覆盖的人 × 这个卡种」的卡片明细）。
    // 与 jumpAttr 同口径：这里只往 td 上挂属性，覆盖范围和过滤口径由调用方给定。
    const cellAttr = typeof options?.cellAttr === 'function' ? options.cellAttr : null;

    const headHtml = `
      <tr>
        <th class="hlj-col-name">${escapeHtml(nameHead)}</th>
        ${columns.map((category) => `<th class="hlj-col-cat">${escapeHtml(category)}</th>`).join('')}
        <th class="hlj-col-stat">总数</th>
        <th class="hlj-col-stat">已办</th>
        <th class="hlj-col-stat hlj-col-balance">剩余 / 超出</th>
      </tr>
    `;

    const bodyHtml = list.map((item) => {
      const counts = item?.categoryCounts || {};
      const overPlan = Number(item?.overPlan || 0);
      const balance = Number(item?.balance || 0);
      // 超出计划、或余额为 0（没额度了）：整行铺浅红，跟下拉列表的告警行一套视觉。
      const alertClass = overPlan > 0 || balance === 0 ? ' is-alert' : '';
      const nameText = String(getName(item));
      const nameCell = jumpAttr
        ? `<span class="hlj-jump-link" role="button" tabindex="0"${jumpAttr(item)}>${escapeHtml(nameText)}</span>`
        : escapeHtml(nameText);

      return `
        <tr class="${alertClass.trim()}">
          <td class="hlj-col-name" title="${escapeHtml(nameText)}">${nameCell}</td>
          ${columns.map((category) => {
            const value = Number(counts[category] || 0);
            // 0 不挂点击 —— 没卡可看，别造出「可点的 0」这种误导。
            const clickable = value > 0 && cellAttr;
            return `<td class="hlj-col-cat${value === 0 ? ' is-zero' : ''}${clickable ? ' is-clickable' : ''}"${clickable ? cellAttr(item, category) : ''}>${value}</td>`;
          }).join('')}
          <td class="hlj-col-stat">${Number(item?.plan || 0)}</td>
          <td class="hlj-col-stat">${Number(item?.current || 0)}</td>
          <td class="hlj-col-stat hlj-col-balance ${overPlan > 0 ? 'is-over' : (balance > 0 ? 'is-remaining' : 'is-zero')}">
            ${overPlan > 0 ? '超出' : '剩余'} <b>${overPlan > 0 ? overPlan : balance}</b>
          </td>
        </tr>
      `;
    }).join('');

    return `<table class="hlj-progress-table"><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table>`;
  }

  function summarizePersonnelCardRows(cards) {
    const statusOrder = ['生效中', '已预约', '已核销', '冻结', '作废'];
    const categoryOrder = CARD_CATEGORY_ORDER;
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

  // 部门 / 个人两种视角的进度：都带一份「卡种分布」，
  // 由行内那排小标签渲染（放在姓名与汇总量之间）。
  function buildDepartmentProgress(cards) {
    const grouped = groupCardsBySaleName(cards);

    return DEPARTMENT_ORDER.map((department) => {
      const people = PERSONNEL_PLAN.filter((item) => item.department === department);
      const plan = getPlanForPeople(people);
      const deptCards = people.flatMap((item) => grouped.get(item.name) || []);
      const current = deptCards.length;

      return {
        department,
        people,
        plan,
        current,
        balance: Math.max(0, plan - current),
        overPlan: Math.max(0, current - plan),
        progressText: getProgressText(current, plan),
        categoryCounts: countCardsByCategory(deptCards),
      };
    });
  }

  function buildPersonProgress(cards, department = '全部部门') {
    const people = PERSONNEL_PLAN.filter(
      (item) =>
        department === '全部部门' ||
        item.department === department
    );
    const grouped = groupCardsBySaleName(cards);

    return people.map((item) => {
      const personCards = grouped.get(item.name) || [];
      const current = personCards.length;
      const plan = Number(item.plan || 0);

      return {
        ...item,
        current,
        balance: Math.max(0, plan - current),
        overPlan: Math.max(0, current - plan),
        progressText: getProgressText(current, plan),
        categoryCounts: countCardsByCategory(personCards),
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
    if (state.running || state.rechecking) return;
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
      let rangeResults = new Array(tasks.length).fill(null);
      let requestUsed = 0;

      // 把一段卡池结果并进全局汇总。按段独立计数，与执行顺序无关。
      const collectPool = (task, pool) => {
        const inTask = new Set();
        let rejectedInTask = 0;

        for (const card of pool.items) {
          const no = String(card?.card_no || card?.cardNo || '').trim();
          if (!no) continue;

          if (isCardInWhitelist(no, intervalsByPrefix)) {
            inTask.add(no);
            matchedCards.set(no, card);
          } else {
            rejectedInTask += 1;
          }
        }

        return {
          ...task,
          poolTotalNum: pool.totalNum,
          poolFetched: pool.fetched,
          poolUniqueCards: pool.uniqueCards,
          poolPages: pool.pages,
          matchedUniqueCards: inTask.size,
          rejectedUniqueCards: rejectedInTask,
          failed: false,
          error: '',
        };
      };

      const emptyResult = (task, message) => ({
        ...task,
        poolTotalNum: 0,
        poolFetched: 0,
        poolUniqueCards: 0,
        poolPages: 0,
        matchedUniqueCards: 0,
        rejectedUniqueCards: 0,
        failed: true,
        error: message,
      });

      // 单段执行：失败自动重试，仍失败就标记该段未取到，其余段继续跑。
      const runOneTask = async (task, index) => {
        const label = `精确查询 ${index + 1}/${tasks.length}：${task.queryStart} ~ ${task.queryEnd}`;

        for (let attempt = 0; attempt <= RUN_CONFIG.segmentRetries; attempt += 1) {
          if (requestUsed >= RUN_CONFIG.maxRequestsPerRun) {
            return emptyResult(task, `已达单次请求预算上限（${RUN_CONFIG.maxRequestsPerRun} 次）`);
          }

          try {
            if (attempt > 0) {
              setStatus(`${label}，第 ${attempt + 1} 次尝试…`, 'running');
              await sleep(400 * attempt + randomMs(0, 200));
            }
            const pool = await fetchPoolRange(task, label);
            requestUsed += pool.pages;
            return collectPool(task, pool);
          } catch (err) {
            if (attempt >= RUN_CONFIG.segmentRetries) {
              return emptyResult(task, String(err?.message || err));
            }
          }
        }

        return emptyResult(task, '未知错误');
      };

      // 段级并发闸门。默认 1（串行，与旧版行为一致），调高才并行。
      const concurrency = Math.max(1, Math.min(6, Number(RUN_CONFIG.concurrency) || 1));
      let cursor = 0;

      const worker = async () => {
        while (cursor < tasks.length) {
          const index = cursor;
          cursor += 1;

          rangeResults[index] = await runOneTask(tasks[index], index);

          if (concurrency === 1 && cursor < tasks.length) {
            await sleep(RUN_CONFIG.minPaceMs + randomMs(0, 60));
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
      );

      rangeResults = rangeResults.filter(Boolean);
      const failedResults = rangeResults.filter((x) => x.failed);

      const cards = [...matchedCards.values()].sort((a, b) => {
        const aa = String(a?.card_no || a?.cardNo || '');
        const bb = String(b?.card_no || b?.cardNo || '');
        return aa.localeCompare(bb);
      });

      const finalGroupSummary = withFoundCounts(groupSummary, cards);

      const approvalCardNumSum = orderResults
        .flatMap((x) => x.items || [])
        .reduce((sum, x) => sum + (Number(x?.cardNum || 0) || 0), 0);

      const data = {
        schema: CACHE_SCHEMA,
        version: SCRIPT_VERSION,
        updatedAt: nowText(),
        queryPeriod: { startDate, endDate },
        config: {
          pageSize: PAGE_SIZE,
          serialDigits: SERIAL_LEN,
          gapLimit: GAP_LIMIT,
          concurrency: RUN_CONFIG.concurrency,
          orderNames: ORDER_NAMES.slice(),
          queryMode: `审批白名单 + 按卡号空洞合并（gap<=${GAP_LIMIT}）+ 查询后再次白名单过滤`,
        },
        orderSummary: orderResults.map(summarizeOrder),
        processRecordCount: allProcessItems.length,
        approvalCardNumSum,
        approvalDistinctCardCount: countExpectedCards(rawIntervals),
        foundDistinctCardCount: cards.length,
        rawIntervals,
        groupSummary: finalGroupSummary,
        rangeTasks: rangeResults,
        failedSegmentCount: failedResults.length,
        failedSegments: failedResults.map((x) => ({
          taskId: x.taskId,
          queryStart: x.queryStart,
          queryEnd: x.queryEnd,
          error: x.error,
        })),
        requestUsed,
        partial: failedResults.length > 0,
        mainCategorySummary: summarizeMainCardCategories(cards),
        cardSummary: summarizeCards(cards),
        cards,        warnings,
      };

      // 整条链路成功以后才覆盖旧缓存。
      saveCache(data);
      renderResult(data);
      setStatus(
        failedResults.length
          ? `查询完成（部分数据）：整理 ${cards.length} 张，另有 ${failedResults.length} 段未取到，可在面板单独重查。`
          : `查询完成：本次共整理 ${cards.length} 张卡池数据，共 ${requestUsed} 个请求。`,
        failedResults.length ? 'error' : 'success'
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
  // 4.5 结果后处理与单段重查
  // ============================================================
  // 重算每个活动分组里实际查到的卡数。
  function withFoundCounts(groupSummary, cards) {
    const map = new Map(groupSummary.map((g) => [g.prefix, { ...g, foundCardCount: 0 }]));

    for (const card of cards) {
      const no = String(card?.card_no || card?.cardNo || '').trim();
      if (!no) continue;
      const parsed = splitCardNo(no);
      if (parsed && map.has(parsed.prefix)) {
        map.get(parsed.prefix).foundCardCount += 1;
      }
    }

    return [...map.values()].sort((a, b) => a.prefix.localeCompare(b.prefix));
  }

  // 单独重查某一失败段：只更新这一段，已成功获取的其他段不做调整。
  async function requerySegment(taskId) {
    const data = state.lastData;
    if (!data || state.running || state.rechecking) return;

    const ranges = Array.isArray(data.rangeTasks) ? data.rangeTasks.slice() : [];
    const index = ranges.findIndex((x) => x && x.taskId === taskId);
    if (index < 0) return;

    const task = ranges[index];
    state.rechecking = true;
    refreshButtons();
    setStatus(`单独重查：${task.queryStart} ~ ${task.queryEnd}`, 'running');

    try {
      const intervalsByPrefix = new Map();
      for (const it of (Array.isArray(data.rawIntervals) ? data.rawIntervals : [])) {
        if (!intervalsByPrefix.has(it.prefix)) intervalsByPrefix.set(it.prefix, []);
        intervalsByPrefix.get(it.prefix).push(it);
      }
      for (const list of intervalsByPrefix.values()) {
        list.sort((a, b) => a.startSerial - b.startSerial || a.endSerial - b.endSerial);
      }

      const pool = await fetchPoolRange(task, `单独重查：${task.queryStart} ~ ${task.queryEnd}`);

      const inTask = new Set();
      const fetched = new Map();
      let rejected = 0;

      for (const card of pool.items) {
        const no = String(card?.card_no || card?.cardNo || '').trim();
        if (!no) continue;

        if (isCardInWhitelist(no, intervalsByPrefix)) {
          inTask.add(no);
          fetched.set(no, card);
        } else {
          rejected += 1;
        }
      }

      ranges[index] = {
        ...task,
        poolTotalNum: pool.totalNum,
        poolFetched: pool.fetched,
        poolUniqueCards: pool.uniqueCards,
        poolPages: pool.pages,
        matchedUniqueCards: inTask.size,
        rejectedUniqueCards: rejected,
        failed: false,
        error: '',
      };

      // 只把这一段的结果并进去，已成功获取的其他段原样保留
      const merged = new Map();
      for (const card of (Array.isArray(data.cards) ? data.cards : [])) {
        const no = String(card?.card_no || card?.cardNo || '').trim();
        if (no) merged.set(no, card);
      }
      for (const [no, card] of fetched) merged.set(no, card);

      const cards = [...merged.values()].sort((a, b) =>
        String(a?.card_no || a?.cardNo || '').localeCompare(String(b?.card_no || b?.cardNo || ''))
      );

      const failed = ranges.filter((x) => x && x.failed);

      const nextData = {
        ...data,
        version: SCRIPT_VERSION,
        updatedAt: nowText(),
        cards,
        rangeTasks: ranges,
        foundDistinctCardCount: cards.length,
        failedSegmentCount: failed.length,
        failedSegments: failed.map((x) => ({
          taskId: x.taskId,
          queryStart: x.queryStart,
          queryEnd: x.queryEnd,
          error: x.error,
        })),
        partial: failed.length > 0,
        mainCategorySummary: summarizeMainCardCategories(cards),
        cardSummary: summarizeCards(cards),
        groupSummary: withFoundCounts(Array.isArray(data.groupSummary) ? data.groupSummary : [], cards),
      };

      saveCache(nextData);
      renderResult(nextData);

      setStatus(
        failed.length
          ? `该段已重查完成，仍有 ${failed.length} 段未取到。`
          : '该段已重查完成，数据已补齐。',
        failed.length ? 'error' : 'success'
      );
    } catch (err) {
      console.error('[卡类汇总] 单独重查失败：', err);
      setStatus(`单独重查失败：${err?.message || err}`, 'error');
    } finally {
      state.rechecking = false;
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

      /* 面板右上角的竖向把手：左右拖动调整面板宽度，双击恢复默认。
         放在头部下方（top 52px）是为了不压住头部右侧的「重新查询/折叠/关闭」按钮。
         拖动时由 JS 把面板从 right 定位切成 left 定位 —— 这样右边缘（也就是把手）
         才会跟着鼠标走；否则 right 钉死，拖动手感是反的。 */
      #${IDS.panel} .hlj-resize-handle {
        position:absolute;
        top:52px;
        /* v0.5.1：原来 right:0，正好压在 #body 的滚动条上 —— 两条灰竖线叠在一起，
           分不清哪条能拖。现在把滚动条定死 8px 宽（见下方 ::-webkit-scrollbar），
           把手退到它左侧的 8px 缝里（#body 的 padding-right 12px 正好让出这条缝），
           并换成琥珀色，跟灰色滚动条一眼区分。 */
        right:8px;
        width:8px;
        height:72px;
        display:flex;
        align-items:center;
        justify-content:center;
        border:1px solid #e8b96a;
        border-radius:4px;
        background:#fdf1de;
        cursor:ew-resize;
        opacity:.92;
        transition:opacity .12s ease, background .12s ease, border-color .12s ease;
        touch-action:none;
        z-index:3;
      }

      /* 三条短横纹，一眼看出这是可以拖的栅格条 */
      #${IDS.panel} .hlj-resize-handle::before {
        content:'';
        width:3px;
        height:34px;
        border-radius:2px;
        background:repeating-linear-gradient(180deg,#c8790c 0 2px,transparent 2px 5px);
      }

      #${IDS.panel} .hlj-resize-handle:hover,
      #${IDS.panel} .hlj-resize-handle.is-active {
        opacity:1;
        background:#fbe4c2;
        border-color:#c8790c;
      }

      /* 滚动条宽度定死 8px：上面把手的退让距离就是按它算出来的，
         宽度一变把手会重新压回滚动条上。顺带去掉系统默认的箭头按钮。 */
      #${IDS.body}::-webkit-scrollbar { width:8px; height:8px; }
      #${IDS.body}::-webkit-scrollbar-track { background:#f1f5f9; }
      #${IDS.body}::-webkit-scrollbar-thumb { background:#c9d3df; border-radius:4px; }
      #${IDS.body}::-webkit-scrollbar-thumb:hover { background:#a9b6c6; }

      /* 面板被拖窄时内部降列。
         面板里的响应式现在是按「视口宽度」写的 media query，浮层自己变窄它不会响应，
         所以按面板实际宽度再切一档（JS 加 .is-compact）。
         特异性 (1,2,0) 高于 #panel .hlj-kpis 的 (1,1,0)，也高于 media query 里同选择器。 */
      #${IDS.panel}.is-compact .hlj-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
      #${IDS.panel}.is-compact .hlj-detail-grid { grid-template-columns:1fr; }
      /* 四张卡类汇总不跟着 620 一起降列 —— 卡本身只要 ~100px 就放得下，
         620 就折成 2×2 会白占一大块竖向空间。只在 <480 时才两排（.is-narrow）。 */
      #${IDS.panel}.is-narrow .hlj-main-summary { grid-template-columns:repeat(2,minmax(0,1fr)); }
      #${IDS.panel}.is-compact .hlj-detail-meta { grid-template-columns:repeat(2,minmax(0,1fr)); }
      /* v0.5.2：head 已恒为纵向（见 .hlj-personnel-head）、selects 已恒为
         width:100% + flex-wrap（见 .hlj-personnel-selects），
         原来这里那三条 compact 覆盖（head 折列 / hint 边距 / selects 宽度）全部作废，删掉。 */
      /* 搜索框不再独占一行：改成「先自己缩，缩到 96px 还放不下才换行」。
         603px 面板（compact）实测内容 543px，两个下拉 188×2 + 间隙 16 = 392px，
         搜索框拿到 151px，与两个下拉并排同一行。 */
      #${IDS.panel}.is-compact .hlj-person-search {
        flex:1 1 96px;
        width:auto;
        max-width:168px;
        min-width:96px;
      }
      /* v0.5.1：窄档只把姓名列与「剩余 / 超出」列收一档，其余列一律 auto ——
         列宽由表格剩余宽度等分，窄了自动收、宽了自动摊开。
         旧写法给卡种/数字列写死 px，剩余宽度全被「姓名」那一列吃掉，
         窄面板下姓名后面能空出一大截（红领巾 2026-09-15 反馈的「左侧空间大」）。
         420px 面板实测：内容 388 - 姓名 78 - 余额 70 = 240，7 个 auto 列各 34px，不溢出。 */
      #${IDS.panel}.is-compact .hlj-progress-table th,
      #${IDS.panel}.is-compact .hlj-progress-table td { padding:4px 4px; font-size:11px; }
      #${IDS.panel}.is-compact .hlj-progress-table .hlj-col-name { width:78px; }
      #${IDS.panel}.is-compact .hlj-progress-table .hlj-col-balance { width:70px; padding-left:8px; }
      /* 窄档表头放开折行：「剩余 / 超出」被截成「剩余 / 超…」比折行更难认。 */
      #${IDS.panel}.is-compact .hlj-progress-table thead th {
        white-space:normal;
        word-break:keep-all;
        line-height:1.15;
      }
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

      /* v0.5.2：这里由**横向**改成**纵向** —— 选择行在上、「人员计划及办理进度」在下。
         横向时右侧那 9 个字（实测 99px + 12px gap = 111px）是从选择行里切走的：
         603px 面板下内容只有 543px，两个下拉 188×2 + 间隙 16 = 392，
         剩给搜索框的不足 168px → 它只能换行独占一行（红领巾 2026-09-15 反馈）。
         文案移到下一行后，选择行拿到整幅宽度，任何面板宽度下都不再被这几个字影响。
         原来 2880 行那条只有 justify-content/align-items 的重复定义已一并合到这里。 */
      #${IDS.panel} .hlj-personnel-head {
        display:flex;
        flex-direction:column;
        align-items:flex-start;
        gap:5px;
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

      /* 选择行：两个下拉 + 人名搜索框。gap 取原来两处定义里**真正生效**的 8px
         （1884 行那条 7px 被后一处覆盖，是死值，v0.5.2 合并时删掉）。
         flex-wrap 放这里（原来只在窄档加）：万一真放不下，宁可搜索框换行，
         也不要横向溢出把面板撑出滚动条。 */
      #${IDS.panel} .hlj-personnel-selects {
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:wrap;
        width:100%;
        min-width:0;
      }

      /* v0.5.1 删除：原生 select 时代的 .hlj-personnel-select / [data-personnel-department]
         / [data-personnel-person] / option / :focus 共 5 条规则 —— 下拉早改成
         .hlj-smart-select 自定义组件，这些选择器在 DOM 里一个都不存在（死规则）。 */

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

      /* 余额为 0：额度已经用完（但没超）。
         业务上这是「不能再申请了」，属于需要立刻看见的状态，所以跟超出一样走红色，
         只是文案不同（「剩余 0」vs「超出 N」）。 */
      #${IDS.panel} .hlj-personnel-kpi.is-zero {
        border-color:#fecaca;
        background:#fff7f7;
        box-shadow:0 0 0 1px rgba(220,38,38,.03);
      }

      #${IDS.panel} .hlj-personnel-kpi.is-zero .hlj-personnel-kpi-label {
        color:#dc2626;
      }

      #${IDS.panel} .hlj-personnel-kpi.is-zero .hlj-personnel-kpi-value {
        color:#b91c1c;
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

      /* 状态胶囊。v0.5.5：把原来散在下方那处只写 height:20px 的覆盖规则并回来 ——
         同一选择器两处定义时，读的人必须翻两处才知道真实高度，改起来必错。 */
      #${IDS.panel} .hlj-status-value {
        display:inline-flex;
        min-width:24px;
        height:20px;
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

      /* v0.4.1：进度表改真表格 —— 表头是卡类型，行里是数量，跟上方「领取卡类及状态」一套读法。
         v0.4.0 把「贵宾36 邀约4」这类小标签缀在姓名后面，词组长度逐行不同，
         肉眼扫读时根本归不成列，"哪一格是什么"全靠脑补 —— 这就是红领巾说的视觉误差。
         table-layout:fixed 让列宽由表头定死、与内容无关，跨行严格对齐。 */
      #${IDS.panel} .hlj-progress-table {
        width:100%;
        table-layout:fixed;
        border-collapse:collapse;
      }

      #${IDS.panel} .hlj-progress-table th,
      #${IDS.panel} .hlj-progress-table td {
        padding:5px 6px;
        font-size:11px;
        line-height:1.2;
        text-align:center;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.panel} .hlj-progress-table thead th {
        border-bottom:1px solid #e2e8f0;
        background:#fbfcfe;
        color:#64748b;
        font-size:10px;
        font-weight:800;
      }

      #${IDS.panel} .hlj-progress-table tbody td {
        border-bottom:1px solid #eef2f6;
        color:#475569;
      }

      #${IDS.panel} .hlj-progress-table tbody tr:last-child td {
        border-bottom:0;
      }

      /* v0.5.1：只有「姓名」和「剩余 / 超出」写死宽度，卡种与总数/已办一律 auto。
         table-layout:fixed 会把剩余宽度平分给所有 auto 列 —— 列宽因此随面板宽度自适应，
         窄面板收得住、宽面板摊得开。旧写法把卡种/数字列写死，剩余宽度整段落到姓名列，
         姓名后面空出一大截（红领巾反馈的「左侧空间大」，面板越窄越明显）。 */
      #${IDS.panel} .hlj-progress-table .hlj-col-name {
        width:92px;
        text-align:left;
        color:#334155;
        font-weight:800;
      }

      #${IDS.panel} .hlj-progress-table .hlj-col-cat {
        width:auto;
      }

      #${IDS.panel} .hlj-progress-table .hlj-col-stat {
        width:auto;
      }

      /* 「剩余 / 超出」列左对齐：文案长度不等（剩余 5 / 剩余 22），居中会让
         「剩余」「超出」这两个词逐行错开，整列看着是歪的。 */
      #${IDS.panel} .hlj-progress-table .hlj-col-balance {
        width:84px;
        text-align:left;
        padding-left:10px;
      }

      /* 没领的卡种写 0 而不是留空：留空会被误读成「数据没取到」。
         灰一档，不跟真实数量抢视线。 */
      #${IDS.panel} .hlj-progress-table .hlj-col-cat.is-zero {
        color:#c3cad4;
      }

      /* 余额告警（超出 / 剩余 0）整行铺一层浅红：
         密集列表里只给数字换色不够跳，整行着色才能一眼扫出来是哪一条。 */
      #${IDS.panel} .hlj-progress-table tr.is-alert td {
        background:#fef2f2;
      }

      #${IDS.panel} .hlj-progress-table tr.is-alert .hlj-col-name {
        color:#991b1b;
      }

      #${IDS.panel} .hlj-progress-table .hlj-col-stat b {
        margin-left:3px;
        color:#1f2937;
        font-size:12px;
      }

      #${IDS.panel} .hlj-progress-table .hlj-col-stat.is-remaining b {
        color:#15803d;
      }

      #${IDS.panel} .hlj-progress-table .hlj-col-stat.is-over b {
        color:#b91c1c;
      }

      /* 「剩余 0」的数字同样标红：绿色代表「还有额度」，0 是误导。 */
      #${IDS.panel} .hlj-progress-table .hlj-col-stat.is-zero b {
        color:#b91c1c;
      }

      /* 进度表里的部门名 / 人名：可点跳转。
         用 span 而不是 button —— button 会带上浏览器默认样式，还得整段重置。 */
      #${IDS.panel} .hlj-jump-link {
        color:#334155;
        font-weight:800;
        cursor:pointer;
        border-bottom:1px dashed transparent;
      }

      #${IDS.panel} .hlj-jump-link:hover,
      #${IDS.panel} .hlj-jump-link:focus-visible {
        color:#1d4ed8;
        border-bottom-color:#93c5fd;
        outline:none;
      }

      /* 卡类矩阵里的数字：数量格是粗体 b，状态格是带状态色的胶囊 span（配色见上方） */
      #${IDS.panel} .hlj-count-value {
        color:#1f2937;
        font-weight:800;
        font-variant-numeric:tabular-nums;
      }

      /* 「可点数字」的统一反馈（v0.5.5 收敛成一套）：
         矩阵数量格 / 矩阵状态格 / 进度表卡种格，三处的可点属性都挂在 <td> 上，
         hover 时整格浅蓝底 + 一圈淡蓝 inset 描边。平时一律不加装饰。

         为什么不用常驻底色：这个面板的底色通道已被数据语义占满
         （5 种状态色 + 余额告警行 + KPI 卡）。再铺一层「可点」色块，
         要么把状态色挤掉，要么两者互相稀释 —— 「有底色」就不再是任何有效信号。
         交互属性走光标 + hover 反馈这条通道，不去抢数据的颜色。

         为什么挂在 td 而不是里面的数字：热区。挂在数字上时，1 位数字的热区
         只有 7px 左右，基本点不中；挂 td 上就是整格。也顺带让反馈与热区一致 ——
         不会出现「悬停到数字才变色、却整格都能点」的错位。

         为什么用 inset 描边而不是外阴影：td 的外阴影会被相邻格盖掉。
         ⚠️ 另外别想着给里面的数字加 padding/min-width 来「顺便做大热区」——
         .hlj-card-matrix table 是 table-layout:auto，任何撑大内容盒的写法都会让
         列宽重新分配（实测行高 29→31、列宽 89 与 94 对调）。 */
      #${IDS.panel} .hlj-card-matrix td[data-card-cell],
      #${IDS.panel} .hlj-progress-table td.hlj-col-cat.is-clickable {
        cursor:pointer;
      }

      #${IDS.panel} .hlj-card-matrix td[data-card-cell]:hover,
      #${IDS.panel} .hlj-progress-table td.hlj-col-cat.is-clickable:hover {
        background:#eff6ff;
        box-shadow:inset 0 0 0 1px rgba(29,78,216,.25);
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

      #${IDS.panel} .hlj-range-result.is-failed {
        color:#a32d2d;
        background:#fdecec;
      }

      #${IDS.panel} .hlj-recheck-btn {
        margin-left:6px;
        padding:1px 8px;
        border:1px solid #d9a3a3;
        border-radius:5px;
        background:#ffffff;
        color:#a32d2d;
        font:700 10px/17px "Microsoft YaHei","PingFang SC",sans-serif;
        cursor:pointer;
      }

      #${IDS.panel} .hlj-recheck-btn:hover {
        background:#fdecec;
      }

      #${IDS.panel} .hlj-gap-hint {
        margin:6px 0;
        padding:7px 10px;
        border-radius:6px;
        background:#f1f5f9;
        color:#475569;
        font-size:10px;
        line-height:1.6;
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

      /* 自定义部门 / 人员下拉。原生select无法稳定做三列对齐，因此改为真正的分列菜单。
         ⚠️ 外观与几何都写在**这一处**（几何值见下方注释），不要再另开一条同名规则 ——
         v0.5.1 之前这里和后面各有一条 .hlj-smart-select，后者整段覆盖前者，
         调宽度时对着前一条改半天没反应（真的踩过）。 */
      #${IDS.panel} .hlj-smart-select {
        position:relative;
        /* 188px 里三列的分配：姓名 52 + 进度 50 + 余额 40 + gap/padding 46 = 188 */
        width:188px;
        flex:0 0 188px;
      }

      #${IDS.panel} .hlj-smart-select-btn {
        width:100%;
        height:31px;
        display:grid;
        grid-template-columns:minmax(0,1fr) 50px 40px;
        align-items:center;
        gap:6px;
        padding:0 25px 0 9px;
        border:1px solid #cbd5e1;
        border-radius:7px;
        background:#fff;
        color:#1f2937;
        font-family:inherit;
        /* v0.5.1：11px → 12px。组员下拉里的姓名/进度/余额挤在 188px 里，
           11px 在 100% 缩放下发虚（红领巾反馈看不清）。列宽是写死的 px，
           字号只影响字本身，不会把三列撑开。 */
        font-size:12px;
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

      /* v0.5.1：姓名加重加深（11px/#334155 → 12px 继承、#1f2937），
         进度数字同步加深到 #334155 —— 这三个字段挤在 188px 里，浅灰在 100% 缩放下发虚。 */
      #${IDS.panel} .hlj-smart-name {
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        color:#1f2937;
        font-weight:700;
      }

      #${IDS.panel} .hlj-smart-progress {
        text-align:right;
        color:#334155;
        font-variant-numeric:tabular-nums;
        font-weight:700;
        white-space:nowrap;
      }

      #${IDS.panel} .hlj-smart-balance {
        justify-self:end;
        text-align:right;
        color:#15803d;
        font-variant-numeric:tabular-nums;
        font-weight:800;
        white-space:nowrap;
      }

      /* 余额告警色（超出 / 余量 0）：这里只负责把数字染红。
         红底一律由外层「整行」承载 —— 展开后的列表行是 .hlj-smart-option.is-alert，
         闭合态的按钮是 .hlj-smart-select-btn.is-alert。
         早先是给余额这一格单独加 padding + 背景，结果格子撑出列宽、红块直接压到菜单边上。 */
      #${IDS.panel} .hlj-smart-balance.is-over,
      #${IDS.panel} .hlj-smart-balance.is-zero {
        color:#b91c1c;
      }

      /* 闭合按钮：当前选中的那一项本身告警时，整个按钮铺浅红 ——
         它和展开列表里的同一项是同一个东西，只红一小格跟列表对不上。 */
      #${IDS.panel} .hlj-smart-select-btn.is-alert {
        background:#fef2f2;
        border-color:#fecaca;
      }

      /* 姓名也跟着加深，跟展开列表里的告警行保持同一个观感 */
      #${IDS.panel} .hlj-smart-select-btn.is-alert .hlj-smart-name {
        color:#991b1b;
      }

      #${IDS.panel} .hlj-smart-select-btn.is-alert:hover,
      #${IDS.panel} .hlj-smart-select.is-open .hlj-smart-select-btn.is-alert {
        border-color:#f0a9a9;
      }

      /* 下拉菜单必须用 fixed，不能用 absolute：
         它是 .hlj-personnel-box(overflow:hidden) 和 #body(overflow:auto) 的后代，
         absolute 会被这两层容器一路裁掉，菜单展开到底部就直接被截断。
         面板自身是 position:fixed 且不带 transform（拖拽走 left/top），
         所以 fixed 子元素相对视口定位，不会被任何祖先的 overflow 影响。
         top/left 由 positionSmartMenu() 按按钮的实际位置算出来（含向上翻转）。 */
      #${IDS.panel} .hlj-smart-menu {
        position:fixed;
        top:0;
        left:0;
        z-index:2147483647;
        width:238px;
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
        grid-template-columns:minmax(80px,1fr) 56px 43px;
        align-items:center;
        gap:6px;
        padding:5px 7px;
        border:0;
        border-radius:6px;
        background:#fff;
        color:#334155;
        font-family:inherit;
        font-size:12px;
        cursor:pointer;
        text-align:left;
      }

      #${IDS.panel} .hlj-smart-option:hover,
      #${IDS.panel} .hlj-smart-option.is-active {
        background:#eff6ff;
      }

      /* 下拉列表行的余额告警：整行铺浅红，跟下面「各部门 / 各人领取进度」表的
         tr.is-alert 用同一套视觉。
         原来只给余额那一格加红底，在列表里看着像贴边的小色块，不如整行好扫。 */
      #${IDS.panel} .hlj-smart-option.is-alert {
        background:#fef2f2;
      }

      #${IDS.panel} .hlj-smart-option.is-alert .hlj-smart-name {
        color:#991b1b;
      }

      /* 整行已铺红底，这一格只负责把数字染红（列表行的 span 不挂 is-over/is-zero，
         颜色由这里给；红底由行级 .is-alert 给） */
      #${IDS.panel} .hlj-smart-option.is-alert .hlj-smart-balance {
        color:#b91c1c;
      }

      /* 告警行 hover / 当前项：红系加深。
         不加深就会翻回上面的蓝底，红底一 hover 就消失、反而更难分辨。 */
      #${IDS.panel} .hlj-smart-option.is-alert:hover,
      #${IDS.panel} .hlj-smart-option.is-alert.is-active {
        background:#fde8e8;
      }

      /* v0.4.1：进度表的列宽与单元格样式统一在上方 .hlj-progress-table 一处定义。
         v0.4.0 遗留的 .hlj-department-name / .hlj-department-stat 重复定义已删除 ——
         同一个选择器散在三处，改样式时最容易对错表（上一轮排查就被绕过一圈）。
         ⚠️ 这段是 JS 模板字符串里的注释，**任何位置都不能出现反引号** ——
         反引号会直接终止模板字符串，语法立刻报错。 */

      /* 卡领取状态：字号提高，行距压缩 */
      #${IDS.panel} .hlj-card-matrix th,
      #${IDS.panel} .hlj-card-matrix td {
        padding:5px 8px;
        font-size:12px;
        line-height:1.2;
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

      /* v0.3.9：进度表与上方「领取卡类及状态」同宽、同左右边距。
         v0.3.3 曾把它收成 min(100%,400px) + margin:auto 居中 —— 左边缘比兄弟块
         缩进一大截（760px 面板下约 90px），纵向堆叠时整块看着就是"错位"。
         宽度交回父容器，跟 .hlj-card-matrix 一个口径。 */
      #${IDS.panel} .hlj-department-overview {
        width:auto;
        margin:0 12px 12px;
      }

      /* v0.5.1：这里原来又写了一遍 .hlj-smart-select / -btn / -menu / -option 的几何，
         把上面那套整段覆盖掉（220px→188px、菜单 270px→238px…），属于纯死规则，
         已全部并入上面的单条规则。下面是原 v0.4.1 的五列行说明，保留备查。 */

      /* v0.4.1：这里原来的五列 grid 行（姓名 / 卡种 chip / 总数 / 已办 / 剩余）已整体删除，
         进度表改成 .hlj-progress-table 真表格 —— 列定义只在上方那一处，单一来源。
         行内 chip 的样式（.hlj-department-cats / .hlj-cat-chip / .hlj-cat-none）一并废弃：
         卡种现在占固定列，不需要再靠小标签挤在姓名后面。 */

      /* 领取状态表：字号提高，行距压缩 */
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

      /* v0.5.2 删除：这里原来的 .hlj-personnel-head（justify-content / align-items）
         与 .hlj-personnel-selects（display / align-items / gap:8px）各是**第二处定义**，
         属性早被上面 1873 / 1894 那两处覆盖 —— 纯死规则，改这几行不会生效。
         有效值已合并上去，这里只留 hint 与搜索框。 */

      /* 「人员计划及办理进度」：head 改成纵向后，它不再靠 margin-left:auto 挤到右侧，
         而是紧随选择行之下、左对齐 —— 占的是竖向空间，不再抢选择行的横向宽度。 */
      #${IDS.panel} .hlj-personnel-scope-hint {
        flex:0 0 auto;
        margin-left:0;
        color:#64748b;
        font-size:11px;
        line-height:1.3;
        font-weight:700;
        white-space:nowrap;
      }

      /* 人名搜索框：接在两个下拉右侧，独立一列。
         两个下拉的宽度规则一个字没改 —— 搜索框只占自己的那份。
         v0.5.2：改成**允许收缩**（0 1 168px）+ 下限 96px。宽档仍是 168px；
         compact 档由下面 .is-compact 那条接管，它会缩到刚好放得下、不再换行。
         96px 下限的依据：图标 25px +「搜索人名」4 字 ×12px ≈ 48px + 右内边距 10px ≈ 83px。 */
      #${IDS.panel} .hlj-person-search {
        position:relative;
        flex:0 1 168px;
        width:168px;
        min-width:96px;
      }

      #${IDS.panel} .hlj-person-search::before {
        content:"⌕";
        position:absolute;
        left:9px;
        top:50%;
        transform:translateY(-52%);
        color:#64748b;
        font-size:14px;
        pointer-events:none;
      }

      #${IDS.panel} .hlj-person-search-input {
        width:100%;
        height:31px;
        box-sizing:border-box;
        padding:0 10px 0 25px;
        border:1px solid #cbd5e1;
        border-radius:7px;
        background:#fff;
        color:#1f2937;
        font-family:inherit;
        /* v0.5.1：11px → 12px（同两个下拉，红领巾反馈字太小看不清） */
        font-size:12px;
        outline:none;
      }

      /* 占位符原来 #9aa7b6 太浅，100% 缩放下几乎糊在框里。降到 slate 系 #64748b。 */
      #${IDS.panel} .hlj-person-search-input::placeholder {
        color:#64748b;
        font-weight:600;
      }

      #${IDS.panel} .hlj-person-search.is-open .hlj-person-search-input,
      #${IDS.panel} .hlj-person-search-input:focus {
        border-color:#94a3b8;
        box-shadow:0 0 0 2px rgba(100,116,139,.06);
      }

      /* 结果菜单同样 fixed（同 .hlj-smart-menu 的理由：躲开容器 overflow 裁剪），
         坐标由 positionSmartMenu 按输入框实际位置算 */
      #${IDS.panel} .hlj-person-search-menu {
        position:fixed;
        top:0;
        left:0;
        z-index:2147483647;
        width:268px;
        max-height:340px;
        overflow:auto;
        padding:4px;
        border:1px solid #cbd5e1;
        border-radius:8px;
        background:#fff;
        box-shadow:0 10px 28px rgba(15,23,42,.18);
      }

      #${IDS.panel} .hlj-person-search-menu[hidden] {
        display:none;
      }

      #${IDS.panel} .hlj-person-search-item {
        width:100%;
        min-height:31px;
        display:grid;
        /* 四列合计 216 + gap 18 + padding 16 = 250，正好落在 268 宽的菜单里（留出滚动条）。
           列宽写死是因为「余额」那列一旦被挤，超字数（超4）会先被裁掉一半。 */
        grid-template-columns:minmax(54px,1fr) 66px 52px 44px;
        align-items:center;
        gap:6px;
        padding:5px 8px;
        border:0;
        border-radius:6px;
        background:#fff;
        font-family:inherit;
        font-size:12px;
        text-align:left;
        cursor:pointer;
      }

      /* v0.5.3：键盘高亮（上下键）与鼠标 hover 共用同一套底色。
         两者视觉一致，「看到的那一行」和「回车选中的那一行」才不会打架。 */
      #${IDS.panel} .hlj-person-search-item:hover,
      #${IDS.panel} .hlj-person-search-item.is-active {
        background:#eff6ff;
      }

      #${IDS.panel} .hlj-person-search-dept {
        color:#64748b;
        font-size:11px;
        font-weight:700;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      /* 告警行沿用下拉列表那套（整行浅红 + 姓名深红） */
      #${IDS.panel} .hlj-person-search-item.is-alert {
        background:#fef2f2;
      }

      #${IDS.panel} .hlj-person-search-item.is-alert .hlj-smart-name {
        color:#991b1b;
      }

      #${IDS.panel} .hlj-person-search-item.is-alert .hlj-smart-balance {
        color:#b91c1c;
      }

      #${IDS.panel} .hlj-person-search-item.is-alert:hover,
      #${IDS.panel} .hlj-person-search-item.is-alert.is-active {
        background:#fde8e8;
      }

      #${IDS.panel} .hlj-person-search-empty {
        padding:8px 10px;
        color:#7b8797;
        font-size:12px;
        font-weight:600;
      }

      @media (max-width: 1100px) {
        #${IDS.switchSlot} { margin-left:12px; margin-right:12px; }
        #${IDS.switch} { min-width:96px; padding:0 11px; font-size:13px; }
      }
      @media (max-width: 900px) {
        #${IDS.panel} { width:calc(100vw - 24px); right:12px; }
        /* v0.5.2：head 折列 / hint 边距 / selects 宽度三条覆盖已删 —— 基础规则里就是这套，
           这里再写一遍只会让"改哪一处生效"变糊涂。 */
        #${IDS.panel} .hlj-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
        /* v0.5.1：四张卡类汇总不再跟着视口降列 —— 视口窄不代表面板窄（浮层只是贴右显示），
           降列改由 .is-narrow（按面板真实宽度）判定。 */
        /* v0.5.2：搜索框同 .is-compact —— 先自己缩，缩到 96px 才换行，不再整行独占。 */
        #${IDS.panel} .hlj-person-search { flex:1 1 96px; width:auto; max-width:168px; min-width:96px; }
        #${IDS.panel} .hlj-personnel-kpis { grid-template-columns:repeat(3,minmax(0,1fr)); }
        #${IDS.panel} .hlj-detail-grid { grid-template-columns:1fr; }
        #${IDS.panel} .hlj-detail-meta { grid-template-columns:repeat(3,minmax(0,1fr)); }
      }

      /* ============================================================
         卡片明细弹窗。挂在 document.body 下（不是面板里），
         所以每条规则都用弹窗自己的 id 起头，不带面板前缀，也不会外溢到页面其它元素。
         ============================================================ */
      #${IDS.cardModal} {
        position:fixed;
        inset:0;
        z-index:2147483647;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:rgba(15,23,42,.42);
      }

      #${IDS.cardModal}[hidden] {
        display:none;
      }

      #${IDS.cardModal} .hlj-card-modal-panel {
        width:min(880px,100%);
        max-height:min(80vh,760px);
        display:flex;
        flex-direction:column;
        overflow:hidden;
        border-radius:12px;
        background:#fff;
        box-shadow:0 24px 60px rgba(15,23,42,.32);
      }

      #${IDS.cardModal} .hlj-card-modal-head {
        display:flex;
        align-items:flex-start;
        gap:10px;
        padding:12px 14px;
        border-bottom:1px solid #e2e8f0;
        background:#f8fafc;
      }

      #${IDS.cardModal} .hlj-card-modal-titles {
        flex:1 1 auto;
        min-width:0;
      }

      #${IDS.cardModal} .hlj-card-modal-title {
        color:#172033;
        font-size:13px;
        font-weight:800;
      }

      #${IDS.cardModal} .hlj-card-modal-sub {
        margin-top:3px;
        color:#64748b;
        font-size:11px;
        font-weight:600;
      }

      #${IDS.cardModal} .hlj-card-modal-close {
        flex:0 0 auto;
        width:26px;
        height:26px;
        border:1px solid #cbd5e1;
        border-radius:7px;
        background:#fff;
        color:#475569;
        font-size:15px;
        line-height:1;
        cursor:pointer;
      }

      #${IDS.cardModal} .hlj-card-modal-close:hover {
        border-color:#94a3b8;
        color:#1f2937;
      }

      #${IDS.cardModal} .hlj-card-modal-body {
        flex:1 1 auto;
        overflow:auto;
        padding:10px 12px 14px;
      }

      #${IDS.cardModal} .hlj-card-modal-sum {
        margin-bottom:8px;
        color:#64748b;
        font-size:11px;
        font-weight:700;
      }

      #${IDS.cardModal} .hlj-card-modal-sum b {
        color:#1f2937;
        font-size:12px;
      }

      #${IDS.cardModal} .hlj-card-list {
        display:flex;
        flex-direction:column;
        gap:4px;
      }

      #${IDS.cardModal} .hlj-card-item {
        overflow:hidden;
        border:1px solid #e2e8f0;
        border-radius:8px;
        background:#fff;
      }

      #${IDS.cardModal} .hlj-card-item.is-open {
        border-color:#bfdbfe;
        background:#f8fbff;
      }

      #${IDS.cardModal} .hlj-card-main {
        display:grid;
        grid-template-columns:minmax(0,140px) minmax(0,92px) 50px 76px 150px 74px minmax(0,1fr) 12px;
        align-items:center;
        gap:8px;
        padding:7px 9px;
        cursor:pointer;
      }

      /* 列表表头：与 .hlj-card-main 共用同一套列宽口径，加列时两处一起改 */
      #${IDS.cardModal} .hlj-card-head {
        display:grid;
        grid-template-columns:minmax(0,140px) minmax(0,92px) 50px 76px 150px 74px minmax(0,1fr) 12px;
        gap:8px;
        padding:0 9px 5px;
        border-bottom:1px solid #e2e8f0;
        color:#8a94a3;
        font-size:10px;
        font-weight:800;
        letter-spacing:.2px;
      }

      #${IDS.cardModal} .hlj-card-head span {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      #${IDS.cardModal} .hlj-card-bind,
      #${IDS.cardModal} .hlj-card-date,
      #${IDS.cardModal} .hlj-card-amount {
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:11px;
        font-variant-numeric:tabular-nums;
      }

      #${IDS.cardModal} .hlj-card-bind { color:#475569; }
      #${IDS.cardModal} .hlj-card-date { color:#64748b; }
      #${IDS.cardModal} .hlj-card-amount { color:#0f766e; font-weight:700; }
      #${IDS.cardModal} .hlj-card-bind.is-empty,
      #${IDS.cardModal} .hlj-card-date.is-empty { color:#c3cad4; }

      #${IDS.cardModal} .hlj-card-main:hover {
        background:#f1f5f9;
      }

      #${IDS.cardModal} .hlj-card-no {
        color:#172033;
        font-size:11px;
        font-weight:800;
        font-variant-numeric:tabular-nums;
        letter-spacing:.3px;
      }

      #${IDS.cardModal} .hlj-card-act {
        color:#475569;
        font-size:11px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      #${IDS.cardModal} .hlj-card-status {
        justify-self:start;
        padding:2px 6px;
        border-radius:999px;
        font-size:10px;
        font-weight:800;
        white-space:nowrap;
        background:#f1f5f9;
        color:#475569;
      }

      #${IDS.cardModal} .hlj-card-status.is-enable { background:#ecfdf5; color:#15803d; }
      #${IDS.cardModal} .hlj-card-status.is-booked { background:#eff6ff; color:#1d4ed8; }
      #${IDS.cardModal} .hlj-card-status.is-used { background:#f5f3ff; color:#6d28d9; }
      #${IDS.cardModal} .hlj-card-status.is-freeze { background:#fff7ed; color:#c2410c; }
      #${IDS.cardModal} .hlj-card-status.is-invalid { background:#fef2f2; color:#b91c1c; }

      #${IDS.cardModal} .hlj-card-remark {
        color:#334155;
        font-size:11px;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      #${IDS.cardModal} .hlj-card-remark.is-pending { color:#94a3b8; }
      #${IDS.cardModal} .hlj-card-remark.is-empty { color:#c3cad4; }
      #${IDS.cardModal} .hlj-card-remark.is-error { color:#b91c1c; }

      #${IDS.cardModal} .hlj-card-caret {
        color:#94a3b8;
        font-size:13px;
        text-align:right;
        transform:rotate(90deg);
      }

      #${IDS.cardModal} .hlj-card-detail {
        padding:9px 10px 11px;
        border-top:1px dashed #dbe3ec;
        background:#fbfcfe;
      }

      #${IDS.cardModal} .hlj-card-detail[hidden] {
        display:none;
      }

      #${IDS.cardModal} .hlj-card-detail-loading {
        color:#94a3b8;
        font-size:11px;
        font-weight:600;
      }

      #${IDS.cardModal} .hlj-card-detail-grid {
        display:grid;
        grid-template-columns:repeat(auto-fill,minmax(200px,1fr));
        gap:6px;
      }

      #${IDS.cardModal} .hlj-card-detail-cell {
        display:flex;
        gap:6px;
        align-items:baseline;
        padding:5px 7px;
        border:1px solid #e6ecf3;
        border-radius:6px;
        background:#fff;
        font-size:11px;
      }

      #${IDS.cardModal} .hlj-card-detail-label {
        flex:0 0 auto;
        color:#64748b;
        font-weight:700;
      }

      #${IDS.cardModal} .hlj-card-detail-value {
        flex:1 1 auto;
        min-width:0;
        overflow:hidden;
        color:#1f2937;
        font-weight:700;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      #${IDS.cardModal} .hlj-card-detail-remark {
        margin-top:8px;
      }

      #${IDS.cardModal} .hlj-card-detail-remark-title {
        color:#64748b;
        font-size:11px;
        font-weight:800;
      }

      #${IDS.cardModal} .hlj-card-detail-remark-body {
        margin-top:4px;
        padding:8px 9px;
        border:1px solid #e6ecf3;
        border-radius:7px;
        background:#fff;
        color:#1f2937;
        font-size:12px;
        line-height:1.5;
        white-space:pre-wrap;
        word-break:break-word;
      }

      #${IDS.cardModal} .hlj-card-detail-remark-body.is-error {
        border-color:#fecaca;
        background:#fff7f7;
        color:#b91c1c;
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
          <div class="hlj-title">卡类汇总 <span style="font-size:10px;color:#64748b;">v${SCRIPT_VERSION}</span></div>
        </div>
        <div class="hlj-head-actions">
          <button id="${IDS.query}" class="hlj-head-query" type="button">重新查询</button>
          <button id="${IDS.collapse}" class="hlj-icon-btn" type="button" title="折叠">▾</button>
          <button id="${IDS.close}" class="hlj-icon-btn" type="button" title="关闭">×</button>
        </div>
      </div>
      <div class="hlj-resize-handle" data-resize-handle="1" title="拖动调整面板宽度，双击恢复默认宽度"></div>
      <div id="${IDS.body}">
        <div id="${IDS.status}">尚未查询。</div>
        <div id="${IDS.result}"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById(IDS.query).addEventListener('click', runDetection);
    document.getElementById(IDS.close).addEventListener('click', closePanel);
    document.getElementById(IDS.collapse).addEventListener('click', toggleCollapse);

    // 失败段的「单独重查」用事件委托，结果区整块重绘后不用重新绑定
    document.getElementById(IDS.result).addEventListener('click', (e) => {
      const btn = e.target.closest?.('.hlj-recheck-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      requerySegment(btn.dataset.taskId);
    });

    installDrag(panel);
    installPanelResize(panel);
    applyPanelWidth(panel, readPanelWidth());

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

    query.disabled = state.running || state.rechecking;
    query.textContent = state.rechecking ? '重查中…' : (state.running ? '查询中…' : '重新查询');
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

  function readPanelWidth() {
    const raw = Number(GM_getValue(PANEL_WIDTH_KEY, 0));
    if (!raw || Number.isNaN(raw)) return PANEL_WIDTH_DEFAULT;
    return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, raw));
  }

  // 统一出口：宽度始终夹在 [PANEL_WIDTH_MIN, limit] 之间。
  // limit 由调用方给 —— 初始化时按「视口宽度 - 两侧留白」，
  // 拖动时按「面板左边界到屏幕右边的余量」，否则往右拖会直接把面板顶出屏幕。
  function applyPanelWidth(panel, width, options) {
    const opts = options || {};
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const room = Number(opts.maxWidth) > 0 ? Number(opts.maxWidth) : (vw - PANEL_VIEWPORT_MARGIN);
    const limit = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, room));
    const next = Math.round(Math.max(PANEL_WIDTH_MIN, Math.min(limit, Number(width) || PANEL_WIDTH_DEFAULT)));

    panel.style.width = `${next}px`;
    // 面板自己变窄时，视口 media query 不会触发，得靠这两个类降列。
    // is-compact：表格 / 下拉区收窄一档；is-narrow：只给四张卡类汇总折成两排。
    panel.classList.toggle('is-compact', next < PANEL_COMPACT_WIDTH);
    panel.classList.toggle('is-narrow', next < PANEL_NARROW_WIDTH);

    if (opts.persist) GM_setValue(PANEL_WIDTH_KEY, next);
    return next;
  }

  function installPanelResize(panel) {
    const handle = panel.querySelector('[data-resize-handle="1"]');
    if (!handle || handle.dataset.resizeBound === '1') return;

    handle.dataset.resizeBound = '1';

    let drag = null;

    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      applyPanelWidth(panel, drag.startWidth + (e.clientX - drag.startX), {
        maxWidth: drag.viewportWidth - drag.startLeft - 12,
      });
    };

    const onUp = () => {
      if (!drag) return;
      drag = null;
      handle.classList.remove('is-active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      applyPanelWidth(panel, panel.getBoundingClientRect().width, { persist: true });
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      const rect = panel.getBoundingClientRect();

      // 关键：面板初始是 right:24px 定位，右边缘钉在屏幕右边、宽度变化只会动左边缘。
      // 先切成 left 定位，宽度才是长在右边缘上的 —— 把手才会跟着鼠标走，手感才对。
      panel.style.left = `${rect.left}px`;
      panel.style.right = 'auto';

      drag = {
        startX: e.clientX,
        startWidth: rect.width,
        startLeft: rect.left,
        viewportWidth: document.documentElement.clientWidth || window.innerWidth,
      };

      handle.classList.add('is-active');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    // 双击恢复默认宽度。
    // 恢复后必须再收一次位置：默认宽度往往比当前宽，而面板此时是 left 定位、
    // 右边会直接顶出视口（左边界越靠右越明显）。
    handle.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      applyPanelWidth(panel, PANEL_WIDTH_DEFAULT, { persist: true });
      ensurePanelInViewport(panel);
    });
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
    if (rect.right > window.innerWidth) {
      // 已经切成 left 定位（拖过分隔条或拖动过面板）时不能再改 right，改了没用还会打架
      if (panel.style.left && panel.style.right === 'auto') {
        panel.style.left = `${Math.max(4, window.innerWidth - rect.width - 12)}px`;
      } else {
        panel.style.right = '12px';
      }
    }
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

    // 记住当前展示的结果，供「单独重查某段」做增量更新
    state.lastData = data;

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

    // 审批白名单卡号数 vs 卡池实际取到数。
    // 差额通常来自储值卡、电商卡等非制卡类（不在本汇总范围内），不是遗漏。
    const approvedTotal = Number(data.approvalDistinctCardCount || 0);
    const foundTotal = Number(data.foundDistinctCardCount || 0);
    const approvedGap = Math.max(0, approvedTotal - foundTotal);
    const approvedGapHtml = approvedGap > 0
      ? `<div class="hlj-gap-hint">白名单比实际取到多 ${approvedGap} 张：这些卡号在制卡卡池里查不到，通常是储值卡、电商卡等非制卡类（不在本汇总范围内），并非遗漏。</div>`
      : '';

    host.innerHTML = `
      <div class="hlj-scope-hint">本年度实际办卡情况（全量）</div>

      <div class="hlj-main-summary">
        <div class="hlj-main-card hlj-main-card-vip">
          <div class="hlj-main-card-label">贵宾</div>
          <div class="hlj-main-card-value">${Number(categorySummary.vip || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>

        <div class="hlj-main-card hlj-main-card-invite">
          <div class="hlj-main-card-label">邀约</div>
          <div class="hlj-main-card-value">${Number(categorySummary.invite || 0)}</div>
          <div class="hlj-main-card-unit">张</div>
        </div>

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
            <div class="hlj-person-search" data-person-search="1">
              <input
                type="text"
                class="hlj-person-search-input"
                placeholder="搜索人名"
                autocomplete="off"
                spellcheck="false"
              />
              <div class="hlj-person-search-menu" hidden></div>
            </div>
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
            <div class="hlj-detail-meta-item">
              <div class="hlj-detail-meta-label">白名单卡号（去重）</div>
              <div class="hlj-detail-meta-value">${approvedTotal} 张</div>
            </div>
            <div class="hlj-detail-meta-item">
              <div class="hlj-detail-meta-label">实际取到</div>
              <div class="hlj-detail-meta-value">${foundTotal} 张</div>
            </div>
          </div>
          ${approvedGapHtml}
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

  // 卡状态的配色类。原来只在 renderPersonnelContent 里当局部变量用，
  // 弹窗里也要同一套，提到模块级避免两处映射各自漂移。
  const STATUS_TONE_MAP = {
    '生效中': 'is-enable',
    '已预约': 'is-booked',
    '已核销': 'is-used',
    '冻结': 'is-freeze',
    '作废': 'is-invalid',
  };

  function getStatusToneClass(status) {
    return STATUS_TONE_MAP[String(status || '')] || '';
  }

  function getCardNo(card) {
    return String(card?.card_no || card?.cardNo || '').trim();
  }

  // ============================================================
  // 5. 卡片明细弹窗（卡号 + 卡备注）
  // ============================================================
  // 交互：表格里点某个数量 → 这里列出对应的每张卡（卡号 / 卡类 / 状态 / 备注）；
  // 再点某一行 → 就地展开这张卡的详情（卡号、备注全文、机构、订单、有效期、金额）。
  // 备注是逐张单独查的，所以先秒开列表、再并发把备注填进去，不阻塞打开。
  const cardModalState = { token: 0 };

  function ensureCardModal() {
    let modal = document.getElementById(IDS.cardModal);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = IDS.cardModal;
    modal.className = 'hlj-card-modal';
    modal.setAttribute('hidden', 'hidden');
    modal.innerHTML = `
      <div class="hlj-card-modal-panel" role="dialog" aria-modal="true">
        <div class="hlj-card-modal-head">
          <div class="hlj-card-modal-titles">
            <div class="hlj-card-modal-title">卡片明细</div>
            <div class="hlj-card-modal-sub"></div>
          </div>
          <button type="button" class="hlj-card-modal-close" title="关闭">×</button>
        </div>
        <div class="hlj-card-modal-body"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.hlj-card-modal-close')) closeCardModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) closeCardModal();
    });

    return modal;
  }

  function closeCardModal() {
    const modal = document.getElementById(IDS.cardModal);
    if (modal) modal.setAttribute('hidden', 'hidden');
    cardModalState.token += 1;
  }

  function formatAmountText(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    return `¥${num.toFixed(2)}`;
  }

  function renderCardModalDetailHtml(card, detail) {
    const no = getCardNo(card);
    const activity = String(card?.activity_name || '').trim();
    const status = translateCardStatus(card);
    const saleName = getCardSaleName(card);
    const beginTs = Number(card?.begin_date || 0);
    const endTs = Number(card?.end_date || 0);
    const cardRange = beginTs && endTs
      ? `${new Date(beginTs).toLocaleDateString('zh-CN')} ~ ${new Date(endTs).toLocaleDateString('zh-CN')}`
      : '';

    const remarkText = detail?.status === 'ok'
      ? (detail.remark || '（无备注）')
      : `获取失败：${escapeHtml(detail?.error || '未知错误')}`;

    const infoRows = [
      ['卡号', no],
      ['卡类', activity || '未分类'],
      ['领取人', saleName || '-'],
      ['当前状态', status],
      cardRange ? ['卡有效期', cardRange] : null,
      detail?.corpName ? ['适用机构', detail.corpName] : null,
      detail?.orderCode ? ['关联订单', detail.orderCode] : null,
      detail?.orderBeginDate && detail?.orderEndDate
        ? ['订单有效期', `${detail.orderBeginDate} ~ ${detail.orderEndDate}`]
        : null,
      formatAmountText(detail?.currentAmount) ? ['当前余额', formatAmountText(detail.currentAmount)] : null,
      formatAmountText(detail?.saleAmount) ? ['销售金额', formatAmountText(detail.saleAmount)] : null,
    ].filter(Boolean);

    return `
      <div class="hlj-card-detail-grid">
        ${infoRows.map(([label, value]) => `
          <div class="hlj-card-detail-cell">
            <span class="hlj-card-detail-label">${escapeHtml(label)}</span>
            <span class="hlj-card-detail-value">${escapeHtml(String(value))}</span>
          </div>
        `).join('')}
      </div>

      <div class="hlj-card-detail-remark">
        <div class="hlj-card-detail-remark-title">卡备注</div>
        <div class="hlj-card-detail-remark-body ${detail?.status === 'error' ? 'is-error' : ''}">
          ${escapeHtml(remarkText)}
        </div>
      </div>
    `;
  }

  function setCardRowRemark(row, detail) {
    const cell = row.querySelector('.hlj-card-remark');
    if (!cell) return;

    cell.classList.remove('is-pending', 'is-error', 'is-empty', 'has-text');

    if (detail?.status !== 'ok') {
      cell.classList.add('is-error');
      cell.textContent = '备注获取失败，点开重试';
      return;
    }

    if (detail.remark) {
      cell.classList.add('has-text');
      cell.textContent = detail.remark;
    } else {
      cell.classList.add('is-empty');
      cell.textContent = '（无备注）';
    }
  }

  async function loadCardRowDetail(row, card, token, options) {
    const no = getCardNo(card);
    const detail = cardDetailCache.get(no) || (await fetchCardDetail(no));

    // 弹窗已经被关掉 / 换成另一批卡了：别把旧结果写进新界面
    if (token !== cardModalState.token) return detail;

    setCardRowRemark(row, detail);

    if (row.classList.contains('is-open')) {
      const box = row.querySelector('.hlj-card-detail');
      if (box) box.innerHTML = renderCardModalDetailHtml(card, detail);
    }

    if (options?.onProgress) options.onProgress();
    return detail;
  }

  function openCardModal(options) {
    const cards = (Array.isArray(options?.cards) ? options.cards : []).filter((card) => getCardNo(card));
    if (!cards.length) return;

    const modal = ensureCardModal();
    const title = String(options?.title || '卡片明细');
    const note = String(options?.note || '');

    cardModalState.token += 1;
    const token = cardModalState.token;

    modal.querySelector('.hlj-card-modal-title').textContent = title;

    const subEl = modal.querySelector('.hlj-card-modal-sub');
    const body = modal.querySelector('.hlj-card-modal-body');
    const head = `<div class="hlj-card-modal-sum">共 <b>${cards.length}</b> 张${note ? ` · ${escapeHtml(note)}` : ''}</div>`;

    /*
     * 审批时间查表：从本次已拉到的审批区间里取 bindTime（零新增请求）。
     * state.lastData.rawIntervals 就是 buildWhitelistAndTasks 产出的那份。
     */
    const bindTimeLookup = buildBindTimeLookup(state.lastData?.rawIntervals);

    body.innerHTML = `
      ${head}
      <div class="hlj-card-head">
        <span>卡号</span>
        <span>卡类</span>
        <span>状态</span>
        <span>审批时间</span>
        <span>有效期</span>
        <span>金额</span>
        <span>备注</span>
        <span></span>
      </div>
      <div class="hlj-card-list">
        ${cards.map((card) => {
          const no = getCardNo(card);
          const status = translateCardStatus(card);
          const activity = String(card?.activity_name || '').trim();
          const bindDate = getCardBindDate(no, bindTimeLookup);
          const dateRange = getPoolItemDateRange(card);
          const amount = getPoolItemAmountInfo(card);
          return `
            <div class="hlj-card-item" data-card-no="${escapeHtml(no)}">
              <div class="hlj-card-main" role="button" tabindex="0">
                <span class="hlj-card-no">${escapeHtml(no)}</span>
                <span class="hlj-card-act">${escapeHtml(activity || '未分类')}</span>
                <span class="hlj-card-status ${getStatusToneClass(status)}">${escapeHtml(status)}</span>
                <span class="hlj-card-bind${bindDate ? '' : ' is-empty'}" title="${escapeHtml(bindDate || '未返回审批时间')}">${escapeHtml(bindDate || '-')}</span>
                <span class="hlj-card-date${dateRange ? '' : ' is-empty'}" title="${escapeHtml(dateRange || '未返回有效期')}">${escapeHtml(dateRange || '-')}</span>
                <span class="hlj-card-amount" title="${escapeHtml(amount ? amount.label + ' ' + amount.text : '未返回金额')}">${escapeHtml(amount ? amount.text : '-')}</span>
                <span class="hlj-card-remark is-pending">备注加载中…</span>
                <span class="hlj-card-caret">›</span>
              </div>
              <div class="hlj-card-detail" hidden></div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    modal.removeAttribute('hidden');

    const rows = [...body.querySelectorAll('.hlj-card-item')];
    const rowByCardNo = new Map(rows.map((row) => [row.getAttribute('data-card-no'), row]));
    const cardByCardNo = new Map(cards.map((card) => [getCardNo(card), card]));

    let done = 0;
    const total = Math.min(rows.length, CARD_REMARK_AUTO_LIMIT);
    if (total < rows.length) {
      subEl.textContent = `前 ${total} 张自动查备注，其余点开单卡时再查`;
    }

    rows.forEach((row) => {
      const no = row.getAttribute('data-card-no') || '';
      const card = cardByCardNo.get(no);
      const main = row.querySelector('.hlj-card-main');
      if (!card || !main) return;

      const toggle = async () => {
        const willOpen = !row.classList.contains('is-open');
        rows.forEach((other) => {
          if (other !== row) {
            other.classList.remove('is-open');
            const box = other.querySelector('.hlj-card-detail');
            if (box) box.hidden = true;
          }
        });

        row.classList.toggle('is-open', willOpen);
        const box = row.querySelector('.hlj-card-detail');
        if (!box) return;
        box.hidden = !willOpen;
        if (!willOpen) return;

        if (!box.dataset.filled) {
          box.innerHTML = '<div class="hlj-card-detail-loading">正在获取卡详情…</div>';
        }
        const detail = await loadCardRowDetail(row, card, token, null);
        if (token !== cardModalState.token) return;
        box.dataset.filled = '1';
        box.innerHTML = renderCardModalDetailHtml(card, detail);
      };

      main.addEventListener('click', toggle);
      main.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });

    // 批量补备注：限并发、逐条回填、进度写在副标题上
    const autoRows = rows.slice(0, CARD_REMARK_AUTO_LIMIT);
    const updateProgress = () => {
      done += 1;
      if (token !== cardModalState.token) return;
      subEl.textContent = `备注加载中 ${Math.min(done, total)}/${total}${total < rows.length ? '（仅前段）' : ''}`;
    };

    if (autoRows.length) {
      subEl.textContent = `备注加载中 0/${autoRows.length}`;
    }

    mapWithConcurrency(autoRows, CARD_REMARK_CONCURRENCY, async (row) => {
      if (token !== cardModalState.token) return;
      const no = row.getAttribute('data-card-no') || '';
      const card = cardByCardNo.get(no);
      if (!card) return;
      await loadCardRowDetail(row, card, token, { onProgress: updateProgress });
    }).then(() => {
      if (token !== cardModalState.token) return;
      subEl.textContent = total < rows.length
        ? `共 ${cards.length} 张 · 已自动加载前 ${total} 张备注，其余点开单卡再查`
        : `共 ${cards.length} 张 · 备注已加载`;
    });
  }

  function renderPersonnelContent(host, cards, department, personName) {
    const content = host.querySelector('[data-personnel-content="1"]');
    if (!content) return;

    const info = summarizePersonnel(cards, department, personName);
    const statusOrder = ['生效中', '已预约', '已核销', '冻结', '作废'];
    const cardRows = Array.isArray(info.cardRows) ? info.cardRows : [];

    // 表格里的每个数字都能点开对应的卡（数量格 = 该卡类全部状态；状态格 = 该卡类该状态）。
    // 0 不挂点击（没卡可看），data 属性直接带卡种 + 状态，点击时按它过滤。
    // ⚠️ 可点属性挂在 <td> 上、不是里面的数字：热区才是整个格子。
    // 挂在数字上时 1 位数字的热区只有 7px 左右，基本点不中；
    // 而且 hover 反馈与热区会错位（悬停到数字才变色，却整格都能点）。
    // 进度表卡种格也是同样的挂法，三处共用一套 hover 规则。
    const renderCountCell = (category, status, value) => {
      const count = Number(value || 0);
      const attrs = count > 0
        ? ` data-card-cell="1" data-card-category="${escapeHtml(category)}" data-card-status="${escapeHtml(status)}"`
        : '';

      // 「数量」列维持原来的粗体观感；
      // 状态列沿用 .hlj-status-value 那套配色（跟表头一一对应）。
      if (!status) {
        return `
          <td${attrs}>
            <b class="hlj-count-value">${count}</b>
          </td>
        `;
      }

      return `
        <td${attrs}>
          <span class="hlj-status-value ${getStatusToneClass(status)} ${count === 0 ? 'is-zero' : ''}">
            ${count}
          </span>
        </td>
      `;
    };

    const rowHtml = cardRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.category)}</td>
        ${renderCountCell(row.category, '', row.total)}
        ${statusOrder.map((status) => renderCountCell(row.category, status, row.statuses?.[status])).join('')}
      </tr>
    `).join('');

    // 选了具体部门、但人员停在「全部人员」时，补一张「本部门各人」的进度表。
    // 结构与「各部门领取进度」完全一致，只是分组维度从部门换成个人 ——
    // 这样两种视角下的行样式、数字口径都统一，不用再学一套新东西。
    const showPersonOverview =
      department !== '全部部门' &&
      personName === '全部人员';

    const personOverviewHtml = showPersonOverview
      ? `
        <div class="hlj-department-overview">
          <div class="hlj-department-overview-title">
            <span>${escapeHtml(department)} · 各人领取进度</span>
            <span class="hlj-department-overview-sub">已办理 / 总数量</span>
          </div>

          ${buildProgressTableHtml(buildPersonProgress(cards, department), {
            nameHead: '姓名',
            getName: (item) => item.name,
            jumpAttr: (item) => ` data-jump-department="${escapeHtml(item.department)}" data-jump-person="${escapeHtml(item.name)}"`,
            // 个人行覆盖的就是本人一个名字。
            cellAttr: (item, category) =>
              ` data-progress-cat="${escapeHtml(category)}" data-progress-owner="${escapeHtml(item.name)}" data-progress-names="${escapeHtml(item.name)}"`,
          })}
        </div>
      `
      : '';

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

          ${buildProgressTableHtml(buildDepartmentProgress(cards), {
            nameHead: '部门',
            getName: (item) => item.department,
            jumpAttr: (item) => ` data-jump-department="${escapeHtml(item.department)}" data-jump-person="全部人员"`,
            // 部门行覆盖本部门全部人（item.people 是 buildDepartmentProgress 已经算好的那份），
            // 直接摊成名单写进属性，点击时不用再回头查 PERSONNEL_PLAN。
            cellAttr: (item, category) =>
              ` data-progress-cat="${escapeHtml(category)}" data-progress-owner="${escapeHtml(item.department)}" data-progress-names="${escapeHtml((item.people || []).map((person) => person.name).join(','))}"`,
          })}
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
        <div class="hlj-personnel-kpi ${Number(info.balance || 0) > 0 ? 'is-remaining' : (Number(info.overPlan || 0) > 0 ? 'is-over' : 'is-zero')}">
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
      ${personOverviewHtml}
    `;

    // 事件委托只绑一次，但每次重绘都要把「当前看的是谁」挂到容器上 ——
    // 否则闭包里捕获的永远是第一次那份上下文，点出来的卡对不上号。
    // cards 必须用 info.cards（当前选择范围内那批，跟表格里的数字同源），
    // 不是外面传进来的全量卡池 —— 否则点「某人 · 贵宾 · 生效中」会把全公司的贵宾卡都列出来。
    content.__hljCtx = {
      cards: Array.isArray(info.cards) ? info.cards : [],
      department,
      personName,
    };

    if (!content.__hljInteractionBound) {
      content.__hljInteractionBound = true;

      content.addEventListener('click', (e) => {
        const ctx = content.__hljCtx || {};

        // 进度表里的人名 / 部门名 → 跳到对应的明细
        const link = e.target.closest('.hlj-jump-link');
        if (link) {
          const dept = link.getAttribute('data-jump-department') || '全部部门';
          const person = link.getAttribute('data-jump-person') || '全部人员';
          if (typeof host.__hljJumpTo === 'function') host.__hljJumpTo(dept, person);
          return;
        }

        // 进度表卡种列的数字 → 弹出「这一行 × 这个卡种」的卡。
        // 行的覆盖范围在渲染时就写进 data-progress-names（逗号分隔的人名）：
        // 个人行是本人，部门行是本部门一串人，所以两种视角共用这一段，不用分叉。
        const progressCell = e.target.closest('[data-progress-cat]');
        if (progressCell) {
          const category = progressCell.getAttribute('data-progress-cat') || '';
          const owner = progressCell.getAttribute('data-progress-owner') || '';
          const names = new Set(
            String(progressCell.getAttribute('data-progress-names') || '')
              .split(',')
              .filter(Boolean)
          );

          const list = (Array.isArray(ctx.cards) ? ctx.cards : []).filter(
            (card) =>
              names.has(getCardSaleName(card)) &&
              getCardCategoryLabel(card?.activity_name) === category
          );
          if (!list.length) return;

          openCardModal({ title: owner + ' · ' + category, cards: list });
          return;
        }

        // 卡类矩阵里的数量 / 状态数字 → 弹出这一格对应的卡
        const cell = e.target.closest('[data-card-cell]');
        if (!cell) return;

        const category = cell.getAttribute('data-card-category') || '';
        const status = cell.getAttribute('data-card-status') || '';
        const list = (Array.isArray(ctx.cards) ? ctx.cards : []).filter((card) => {
          if (getCardCategoryLabel(card?.activity_name) !== category) return false;
          if (status && translateCardStatus(card) !== status) return false;
          return true;
        });
        if (!list.length) return;

        const who = ctx.personName && ctx.personName !== '全部人员'
          ? ctx.personName
          : (ctx.department || '全部部门');

        openCardModal({
          title: who + ' · ' + category + (status ? ' · ' + status : ''),
          cards: list,
        });
      });

      content.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const link = e.target.closest('.hlj-jump-link');
        if (!link) return;
        e.preventDefault();
        link.click();
      });
    }
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

    // 菜单是 position:fixed（为了躲开 .hlj-personnel-box 与 #body 的 overflow 裁剪），
    // 所以它不会自动跟着按钮走，必须每次展开时按按钮的真实位置算一遍。
    // 下方空间不够就向上翻转，左右也做一次收边，避免贴出视口。
    function positionSmartMenu(container, anchorEl, menuEl) {
      const btn = anchorEl || container.querySelector('.hlj-smart-select-btn');
      const menu = menuEl || container.querySelector('.hlj-smart-menu');
      if (!btn || !menu) return;

      const rect = btn.getBoundingClientRect();
      const width = menu.offsetWidth || 238;
      const gap = 4;
      const edge = 8;

      let left = rect.left;
      if (left + width > window.innerWidth - edge) left = window.innerWidth - width - edge;
      if (left < edge) left = edge;

      menu.style.maxHeight = '340px';
      const naturalHeight = menu.offsetHeight || 0;
      const spaceBelow = window.innerHeight - rect.bottom - gap - edge;
      const spaceAbove = rect.top - gap - edge;
      const openUp = naturalHeight > spaceBelow && spaceAbove > spaceBelow;

      menu.style.left = `${Math.round(left)}px`;

      if (openUp) {
        menu.style.maxHeight = `${Math.max(120, Math.floor(spaceAbove))}px`;
        menu.style.top = 'auto';
        menu.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
      } else {
        menu.style.maxHeight = `${Math.max(120, Math.floor(spaceBelow))}px`;
        menu.style.bottom = 'auto';
        menu.style.top = `${Math.round(rect.bottom + gap)}px`;
      }
    }

    function renderSmartSelect(container, items, selectedName, onSelect) {
      const selected = items.find((item) => item.name === selectedName) || items[0];

      container.innerHTML = `
        <button type="button" class="hlj-smart-select-btn ${Number(selected?.over || 0) > 0 || Number(selected?.balance || 0) === 0 ? 'is-alert' : ''}">
          <span class="hlj-smart-name">${escapeHtml(selected?.name || '-')}</span>
          <span class="hlj-smart-progress">${Number(selected?.current || 0)}/${Number(selected?.plan || 0)}</span>
          <span class="hlj-smart-balance ${Number(selected?.over || 0) > 0 ? 'is-over' : (Number(selected?.balance || 0) > 0 ? '' : 'is-zero')}">
            ${Number(selected?.over || 0) > 0 ? `超${Number(selected.over)}` : `余${Number(selected?.balance || 0)}`}
          </span>
        </button>

        <div class="hlj-smart-menu">
          ${items.map((item) => `
            <button
              type="button"
              class="hlj-smart-option ${item.name === selected?.name ? 'is-active' : ''} ${Number(item.over || 0) > 0 || Number(item.balance || 0) === 0 ? 'is-alert' : ''}"
              data-smart-value="${escapeHtml(item.name)}"
            >
              <span class="hlj-smart-name">${escapeHtml(item.name)}</span>
              <span class="hlj-smart-progress">${Number(item.current || 0)}/${Number(item.plan || 0)}</span>
              <span class="hlj-smart-balance">
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

        const willOpen = !container.classList.contains('is-open');
        container.classList.toggle('is-open');

        // 菜单此刻才 display:block，量得到尺寸，是唯一能定位的时机
        if (willOpen) positionSmartMenu(container);
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

    // ---------- 人名搜索框（下拉列表右侧）----------
    // 与两个下拉**完全独立**：自己的 DOM、自己的菜单、自己的开关状态。
    // 原有 .hlj-smart-select 的结构与行为一行没动 —— 搜索框只是往容器末尾追加一个节点。
    const searchHost = host.querySelector('[data-person-search="1"]');
    const searchInput = searchHost ? searchHost.querySelector('.hlj-person-search-input') : null;
    const searchMenu = searchHost ? searchHost.querySelector('.hlj-person-search-menu') : null;

    // 搜索索引一次建好：全量人员 + 各自当前办理数（跨部门，不受下拉选择影响）
    const searchIndex = (() => {
      const grouped = groupCardsBySaleName(cards);
      return PERSONNEL_PLAN.map((item) => ({
        department: item.department,
        name: item.name,
        current: (grouped.get(item.name) || []).length,
        plan: Number(item.plan || 0),
      }));
    })();

    // 关键字匹配：按空格拆词、全部命中才算 —— 支持「销售二部 张」这种组合筛选。
    function matchSearchRow(keyword, row) {
      const terms = String(keyword || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return false;
      const hay = (row.name + ' ' + row.department).toLowerCase();
      return terms.every((term) => hay.indexOf(term) !== -1);
    }

    function closePersonSearch() {
      if (searchMenu) searchMenu.hidden = true;
      searchHost?.classList.remove('is-open');
    }

    // ---------- 搜索结果的键盘导航（v0.5.3 新增）----------
    // 上下键高亮的当前项下标，-1 = 没有高亮（焦点始终留在输入框里）。
    // 老做法是「ArrowDown 把焦点交给第一个菜单项」—— 焦点一离开输入框，
    // 后面再按 ArrowDown 就没人接，浏览器只能去滚页面（红领巾 2026-09-15 反馈：
    // 「只能下移一格，再操作就变成网页整体下移」）。
    // 改成在输入框里维护高亮下标后，焦点从不离开输入框，输入、上下键、回车都在同一处接管。
    // ⚠️ 别顺手加「鼠标划过就同步高亮」：Chrome 在**布局变化后**会按上一帧的鼠标位置
    // 补发一次 mouseover，菜单刚渲染出来就可能把高亮推到光标底下那一项上 ——
    // 于是上下键的起点变成"看运气"（2026-09-15 真机实测：连按三次高亮落在 2/3/4 而不是 1/2/3）。
    // 鼠标悬停有自己的 :hover 底色，键盘游标只归键盘管，两边互不干扰。
    let searchActiveIndex = -1;

    const searchItemNodes = () =>
      searchMenu ? Array.from(searchMenu.querySelectorAll('.hlj-person-search-item')) : [];

    function setSearchActive(index) {
      const items = searchItemNodes();
      searchActiveIndex = items.length ? Math.max(0, Math.min(index, items.length - 1)) : -1;
      items.forEach((item, i) => item.classList.toggle('is-active', i === searchActiveIndex));
      return items;
    }

    // 菜单是 fixed + overflow:auto，scrollIntoView 有可能连着把页面一起滚走，
    // 所以自己算 scrollTop，只动菜单自己的滚动条。
    function scrollSearchActiveIntoView() {
      if (!searchMenu) return;
      const item = searchItemNodes()[searchActiveIndex];
      if (!item) return;

      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < searchMenu.scrollTop) {
        searchMenu.scrollTop = top - 4;
      } else if (bottom > searchMenu.scrollTop + searchMenu.clientHeight) {
        searchMenu.scrollTop = bottom - searchMenu.clientHeight + 4;
      }
    }

    // 点菜单项 / 高亮项上按回车，走的都是这里
    function activateSearchItem(item) {
      if (!item) return;
      jumpTo(
        item.getAttribute('data-person-department') || '全部部门',
        item.getAttribute('data-person-name') || '全部人员'
      );
    }

    function renderPersonSearch() {
      if (!searchInput || !searchMenu) return;

      const keyword = String(searchInput.value || '').trim();
      const rows = searchIndex.filter((row) => matchSearchRow(keyword, row)).slice(0, 40);

      searchHost.classList.add('is-open');

      if (!keyword) {
        searchMenu.innerHTML = '<div class="hlj-person-search-empty">输入关键字搜人名，支持「部门 + 姓名」</div>';
      } else if (!rows.length) {
        searchMenu.innerHTML = '<div class="hlj-person-search-empty">没有匹配的人名</div>';
      } else {
        searchMenu.innerHTML = rows.map((row) => {
          const balance = Math.max(0, row.plan - row.current);
          const over = Math.max(0, row.current - row.plan);
          return `
            <button
              type="button"
              class="hlj-person-search-item ${over > 0 || balance === 0 ? 'is-alert' : ''}"
              data-person-name="${escapeHtml(row.name)}"
              data-person-department="${escapeHtml(row.department)}"
            >
              <span class="hlj-smart-name">${escapeHtml(row.name)}</span>
              <span class="hlj-person-search-dept">${escapeHtml(row.department)}</span>
              <span class="hlj-smart-progress">${row.current}/${row.plan}</span>
              <span class="hlj-smart-balance ${over > 0 ? 'is-over' : (balance > 0 ? '' : 'is-zero')}">
                ${over > 0 ? '超' + over : '余' + balance}
              </span>
            </button>
          `;
        }).join('');
      }

      // 结果集换了一批，高亮清零：箭头键从第一项重新开始。
      // （菜单 DOM 整个重建过，上一轮的 .is-active 不会残留。）
      searchActiveIndex = -1;

      // 先给菜单布局，再量尺寸 —— 顺序反了就量到 0
      searchMenu.hidden = false;
      positionSmartMenu(searchHost, searchInput, searchMenu);
    }

    // 进度表点部门名 / 人名、搜索框点结果，走的都是这里。
    // 挂在 host 上是因为 renderPersonnelContent 是独立函数，拿不到这层的闭包状态。
    function jumpTo(dept, person) {
      selectedDepartment = dept || '全部部门';
      selectedPerson = person || '全部人员';

      redrawDepartment();
      redrawPerson();
      renderPersonnelContent(host, cards, selectedDepartment, selectedPerson);

      if (searchInput) searchInput.value = '';
      closePersonSearch();
    }

    host.__hljJumpTo = jumpTo;

    if (searchHost && searchInput && searchMenu && !searchHost.__hljSearchBound) {
      searchHost.__hljSearchBound = true;

      // 无需回车 / 无确认按钮：输入即过滤
      searchInput.addEventListener('input', renderPersonSearch);

      // 聚焦即开、失焦即关 —— 开与关各有唯一入口，不再依赖「点了面板里的空白处」才收起。
      // 空关键字时菜单里显示用法提示：原来只有「输入后又删光」才看得到，等于把提示藏起来了。
      searchInput.addEventListener('focus', renderPersonSearch);

      // v0.5.3 修复（红领巾反馈「焦点移除后搜索框并未消失」）：
      // 原来的收起入口只有面板空白点击 + 滚动 + 缩放，点面板外的页面、点顶部按钮都关不掉。
      // 现在只要焦点离开整个搜索控件就收起。
      // relatedTarget 还落在控件内（点的是菜单项）时不关 —— 菜单一 hidden，
      // 焦点元素就没了，后续的 click 事件再也到不了菜单项上。
      searchInput.addEventListener('blur', (e) => {
        if (e.relatedTarget && searchHost.contains(e.relatedTarget)) return;
        closePersonSearch();
      });

      searchInput.addEventListener('keydown', (e) => {
        const items = searchItemNodes();
        // 菜单没开、或一条结果都没有时一律不拦 —— 方向键该滚页面就滚页面
        const navigable = !searchMenu.hidden && items.length > 0;

        if (e.key === 'Escape') {
          searchInput.value = '';
          closePersonSearch();
          return;
        }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          if (!navigable) return;
          e.preventDefault();
          setSearchActive(
            searchActiveIndex < 0 ? 0 : searchActiveIndex + (e.key === 'ArrowDown' ? 1 : -1)
          );
          scrollSearchActiveIntoView();
          return;
        }

        if (e.key === 'Enter') {
          if (!navigable) return;
          e.preventDefault();
          activateSearchItem(items[searchActiveIndex < 0 ? 0 : searchActiveIndex]);
        }
      });

      searchMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.hlj-person-search-item');
        if (!item) return;
        e.stopPropagation();
        activateSearchItem(item);
      });
    }

    function closeAllSmartSelects() {
      host.querySelectorAll('.hlj-smart-select.is-open').forEach((node) => {
        node.classList.remove('is-open');
      });
    }

    if (!host.__hljSmartOutsideBound) {
      host.__hljSmartOutsideBound = true;
      host.addEventListener('click', (e) => {
        if (!e.target.closest('.hlj-smart-select') && !e.target.closest('.hlj-person-search')) {
          closeAllSmartSelects();
          closePersonSearch();
        }
      });

      // 菜单是 fixed 定位，不会跟着容器一起滚。滚动或改窗口大小时直接收起，
      // 比跟着重算坐标省事，也不会出现菜单悬在旧位置上的错觉。
      const bodyHost = document.getElementById(IDS.body);
      bodyHost?.addEventListener('scroll', () => {
        closeAllSmartSelects();
        closePersonSearch();
      }, { passive: true });
      window.addEventListener('resize', () => {
        closeAllSmartSelects();
        closePersonSearch();
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

    const failedSegments = ranges.filter((x) => x && x.failed);

    const taskRows = ranges.map((x, idx) => {
      const expected = Number(x.whitelistCardCount || 0);
      const found = Number(x.matchedUniqueCards || 0);

      if (x.failed) {
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(x.queryStart || '-')}</td>
            <td>${escapeHtml(x.queryEnd || '-')}</td>
            <td>
              <span class="hlj-range-result is-failed">未取到</span>
              ${
                withPool
                  ? `<button class="hlj-recheck-btn" type="button" data-task-id="${escapeHtml(x.taskId || '')}">重查</button>`
                  : ''
              }
            </td>
          </tr>
        `;
      }

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
        ${
          failedSegments.length
            ? `<div style="padding:8px 10px;background:#fdecec;color:#a32d2d;font-size:10px;line-height:1.6;">
                 ⚠ 本次有 ${failedSegments.length} 段未取到，以下汇总为<b>部分数据</b>。
                 可点对应行的「重查」按钮单独补取，已成功获取的其他段不受影响。
               </div>`
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
