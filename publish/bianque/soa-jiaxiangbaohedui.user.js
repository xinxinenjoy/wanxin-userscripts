// ==UserScript==
// @name         扁鹊-1.9套餐加项核对
// @namespace    https://tampermonkey.net/
// @version      1.9.0
// @description  SOA 订单页：核对「套餐 ↔ 绑定的赠送包 ↔ 包内项目」。只看赠送包(GIVEPKG)、不看加项包；按组展示、组头标注该组「几选几」（最少选N个/最多选N个）；每条套餐 = 一张独立卡片（序号 + 套餐信息头 + 赠送区），长套餐名/包名的共同前缀提到顶部只说一次；包内项目**一列**竖排、**包与包之间两列并排**；面板支持 **ESC 关闭**。纯只读，不发起任何写请求。
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
 *   ⑥ 赠送项目**按组展示**，组头写明该组的「几选几」（红领巾 2026-09-29 第二轮要求）。
 *      组头文案照页面：`A组：最少选1个 最多选1个` —— 取自宿主套餐的 selectionSizeList，
 *      推导见下面接口第 ③ 条。⛔ 只显示**含赠送包的组**；只含加项包的组整组不出现
 *      （口径不变：不管加项包）。空组也不显示（与页面 popover 一致）。
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
 *   ③ 组的「几选几」约束 —— 在**主套餐自己**的 `selectionSizeList` 上（2026-09-29 实测）
 *      ⛔ `add_packages` 每项只有 `{group, package_code, package_name}`，
 *         **组约束不在那里**，而在宿主套餐的同级字段：
 *           `selectionSizeList[group - 1] = { minSize, maxSize }`
 *         ⇒ **group 是 1 基、数组是 0 基**：group 1 → [0]、group 2 → [1] …… 最多 5 组。
 *         （另有一个 `selectionAppointmentTimeList[group - 1]` 存预约时间，本脚本不用。）
 *      🔴 依据不是猜的，是**页面自己的渲染代码**（`p__orderLayout.*.async.js`，Tt 组件）：
 *           first.number  = n.selectionSizeList[0] || 0      // … 一路到 fifth = [4]
 *           1===t.group ? e.first.items += t.package_name
 *                     : 2===t.group ? e.secound … 5===t.group && e.fifth …
 *           组头文案硬编码： "A组：最少选" + number.minSize + "个 最多选" + number.maxSize + "个"
 *           且**只有该组有包时才渲染**（`e.first.items && …`）⇒ 空组整个不出现。
 *      ⚠️ `group === -1` 的包被页面**显式忽略**（`-1 !== t.group && …`）⇒ 不属于任何组。
 *      ⚠️ `selectionSizeList` 的元素可能是 `{}`（空对象）⇒ minSize/maxSize 为 undefined，
 *         页面会渲染成「最少选个 最多选个」（空文案）；本脚本改标「无约束数据」，不显示空文案。
 *      ⚠️ 页面组头还会追加「预约时间：begin - end」（取 selectionAppointmentTimeList[i]）；
 *         实测该数组为 [{}] 时不出。本脚本不展示预约时间（核对赠送项目用不上）。
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
 *
 * ── v1.7.0：把「一团乱麻」改成「一条一条」（红领巾 2026-09-30）──
 *   红领巾原话：「昨天最后这个改动虽然把布局的问题解决了，可是这样看着没有终点，一团乱麻的感觉」。
 *   真机实测（订单 SOA37906452851870365）把「乱」拆成三个可量化的原因：
 *     ① **没边界** —— 行与行之间唯一的分隔是 3px `#f0f0f0`，对比度 ≈1.14:1
 *        （WCAG 非文本对比下限是 3:1）⇒ 白底上肉眼几乎看不见，两行像糊在一起。
 *     ② **没层级** —— 一条套餐纵向堆 6 段（头-名行 / 价格行 / 副信息 / 组头 / 赠送包名 / 项目块），
 *        实测段高 18 / 19 / 18 / 18 / 18 / 21 px —— **全是同一档视觉重量**，像斑马纹。
 *     ③ **文字没去重** —— 套餐名 46 字、赠送包名 48 字，而两者的**公共前缀是 45 字**
 *        ⇒ 重复率 97.8%；同一订单里这串「产品族名」逐字相同，却每条都重写一遍。
 *   ⇒ 对应三处改法（⛔ 别只改一两处，三个是配套的）：
 *     · ①→ 每条套餐 = **一张卡片**（1px 边框 + 10px 圆角 + 12px 卡距 + 左侧 3px 琥珀竖条）；
 *          用 `border-collapse: separate` + `border-spacing: 0 12px` 让 <td> 变成卡片，
 *          **保留 table/tbody/tr/单 td 结构**（归档验证套件的选择器不用重写）。
 *     · ②→ 行首加**序号圆牌**（位置锚点）+ 赠送包用**左侧绿色竖线做缩进**（层级）。
 *     · ③→ 套餐名的共同前缀（≥12 字才认）**提到 meta 顶部只说一次**，行内只留差异段；
 *          赠送包名与套餐名共有的那截同样不再重复，只显示「赠送包 · N 个项目」。
 *   效果：单条行高 143px → 约 92px，一屏能多看好几条，且每条有明确的起止。
 *   ⚠️ 差异段可能很短（本例只剩「男」/「女已婚」）—— 这是**对的**，因为族名已在顶部给出；
 *     行内真正的身份靠「价格 + PKG 编码」，鼠标悬停套餐名可看全名（title）。
 *
 * ── v1.8.0：包内**一列**、包与包**两列并排**（红领巾 2026-09-30）──
 *   红领巾原话：「同一个加项包的项目不要分两列，因为还会出现一个包里有好几个项目的情况，
 *   两列不容易分辨。优先按照一列，为了美观可以让不同组的再进行双列排开，确保页面的规整」。
 *   ⚠️ 动手前先量了数据，发现「组」有歧义，已回问确认 ⇒ **双列落在「赠送包」这一层**：
 *     订单 SOA37906452851870365：2 条套餐 / 每条 **1 个组(A组)** / 1 个包 / 包内 2 项；
 *     订单 SOA37906492773140442：4 条套餐 / 每条 **1 个组(A组)** / **4 个包** / 每包 2 项。
 *     ⇒ 每条套餐都**只有 1 个组**，按「页面的组」并排不生效；真正的重复单位是**赠送包**。
 *   改法（两层，别只改一层）：
 *     · 包内：`.hlj-gc-items` 去掉 `columns: 2` → 一列竖排（红领巾的原始诉求）。
 *     · 包间：组内 ≥2 个包时加 `is-pack2` → `grid` 两列（4 个包排成 2×2）。
 *       用 **grid 不用 columns**：grid 同行等高（两条绿竖线一样长，像表格）；
 *       columns 会把一个包**拆到两列之间**（包是多行块，必然被劈开）。
 *   ⚠️ 包内一列 ⇒ 高度 ↑；包间两列 ⇒ 高度又降回来，且宽度用满（原来右侧空一截）。
 *   ⚠️ 只有 1 个包时**不加** `is-pack2`（否则包只占半宽，右半空着，反而更乱）。
 *
 * ── v1.9.0：面板支持 **ESC 关闭**（红领巾 2026-09-30）──
 *   四条约定（⛔ 别只留第一条，后三条才是它不惹祸的原因）：
 *     ① 监听挂在 **document 的捕获阶段**：页面自己也在 document/window 上听键盘，
 *        捕获阶段先拿到才抢得在前（`{capture:true}`）。
 *     ② **面板没开就立即 return** —— 一个字节都不干预页面自己的 ESC，
 *        否则会把页面弹窗/抽屉的 ESC 也吞掉。
 *     ③ 面板开着时 `preventDefault + stopPropagation` —— 一次 ESC **只关这一层**；
 *        不挡的话页面会同时关掉它自己的浮层，一下少两层、用户找不回来。
 *     ④ 用**计算后的 display** 判可见（`getComputedStyle`），别用 `style.display`：
 *        面板首次创建时 inline style 是空的、可见性来自 CSS，拿 inline 判会误判成「已关」。
 *   ⚠️ 面板里没有输入控件（开关在页面上，面板内只有按钮）⇒ 不用避让「输入框内 ESC」。
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
  const VERSION = '1.9.0';
  const SWITCH_LABEL = '加项包核对';
  const POS_KEY = `${NS}_pos`;

  const CLIENT_ID = 'MN_SOA3';

  const API = {
    pkgQuery: '/soa/api/v1/package/query',
    pkgDetail: '/soa/api/v1/package/detail',
  };

  // 只看赠送包。加项包(ADDPKG) / 智略加项包(AIADDPKG) 不看 —— 红领巾 2026-09-29 定的口径
  const GIVE_TYPE = 'GIVEPKG';

  // ---- 组（「几选几」的容器）----
  // group 是 **1 基**、selectionSizeList 是 **0 基**：group N 的约束 = selectionSizeList[N-1]。
  // 最多 5 组 —— 页面渲染代码里只有 first/second/third/fourth/fifth 五个位置，
  // group 落在 1..5 之外（含 -1）的包，页面统统不归组（-1 那批被显式跳过）。
  const GROUP_MAX = 5;
  const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const GROUP_NONE_CN = '未分组';

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
    // 渲染用：{code,name,type,custType,salePrice,price,voided,
    //          groups:[{no,name,min,max,gives:[{code,name,group,items:[{name,price,salePrice}]}]}]}
    rows: [],
    bindTotal: 0, // 本订单绑定的包总数（去重后）
    giveTotal: 0, // 其中赠送包数
    itemTotal: 0, // 赠送包内项目总数
    commonPrefix: '', // v1.7.0：所有套餐名的**共同前缀** —— 提到顶部只显示一次，行内不再重复
    detailCache: new Map(), // package_code -> detail.data（null = 查询失败）
    err: '',
  };

  function resetAll() {
    state.rows = [];
    state.bindTotal = 0;
    state.giveTotal = 0;
    state.itemTotal = 0;
    state.commonPrefix = '';
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

      /* ---------- 面板 ----------
       * 宽度 780 → 720（2026-09-29 第三轮，红领巾：「右侧留白太多」）。
       *   实测（订单 SOA37906492773140442，v1.4.0）：面板 780 / 内容区 763，
       *   赠送列分到 534px，但它的内容**最长只用到 296px**（+ 左右 padding 20 = 316），
       *   ⇒ 右侧整整空出 228px（占该列 43%）。这不是「列太窄」，是「列太宽」。
       *   缩到 720 后：赠送列 372（余量 56px）、套餐列 331（原 229）。
       * ⚠️ 别再退回按 30%/70% 分列 —— 见 paintBody 里 th 的注释。 */
      #${IDS.panel} {
        position: fixed;
        top: 96px;
        right: 18px;
        width: 720px;
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
      /* v1.7.0：把「所有套餐名的共同前缀」提到这里只显示一次，行内不再重复那 45 字。
       * ⚠️ 保持内联（别写成 block / <details>）—— #meta 是行内流，块级子元素会多出空行盒。 */
      #${IDS.meta} .hlj-gc-common { color: #8c8c8c; overflow-wrap: anywhere; }

      /* ---------- 列表：每条套餐 = 一张卡片 ----------
       * v1.7.0（2026-09-30，红领巾：「看着没有终点，一团乱麻」）。乱因与实测数字见文件头。
       * 关键手法：border-collapse 用 separate（不是 collapse）、border-spacing 用 "0 12px"，
       * 让每个 <td> 自己变成一个圆角盒子 —— 卡距、圆角全靠它俩。
       * ⛔ 别再退回 collapse：那样 td 的圆角与卡距全部失效，
       *   又会回到「只有一条 3px #f0f0f0 分界」的状态（对比度 1.14:1，看不见）。
       * ⚠️ 卡距由 border-spacing 提供，所以 #body 的上下 padding 给 0（否则顶部会多出 23px）。
       * 🔴 本段在**模板字符串**里 ⇒ 注释内⛔不许出现反引号（会当场截断整段 CSS，踩过多次）。 */
      #${IDS.body} {
        flex: 1;
        overflow: auto;
        min-height: 140px;
        padding: 0 12px;
      }
      .hlj-gc-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 12px;
        font-size: 12.5px;
      }
      /* ⚠️ 没有 thead —— 行内自解释。 */
      .hlj-gc-table tbody td {
        padding: 9px 12px 11px 13px;
        background: #fff;
        border: 1px solid #e8e8e8;
        border-left: 3px solid #ef9f27; /* 左侧琥珀竖条 = 卡片的「起点」 */
        border-radius: 10px;
        line-height: 1.55;
        word-break: break-all;
      }
      .hlj-gc-table tbody tr:hover td { background: #fafafa; }
      .hlj-gc-table tbody tr.is-voided td { background: #f7f7f7; color: #8c8c8c; }
      /* 序号圆牌：给每张卡片一个位置锚点（红领巾 2026-09-30：要「有终点」） */
      .hlj-gc-no {
        flex: 0 0 auto; align-self: center;
        display: inline-block; width: 18px; height: 18px;
        line-height: 18px; text-align: center;
        border-radius: 50%; background: #faeeda; color: #633806;
        font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums;
      }

      /* ── 行头：套餐信息横排一行 ────────────────────────────────────────
       * 第四轮改（2026-09-29，红领巾：「左侧列数据少，在右侧包较多时会有大量空白」）。
       * 旧的两列布局：左侧套餐信息只有 67.8px 高，行高被右侧赠送区撑到 315px
       * ⇒ 左侧纵向空白 247.5px = 行高的 78%（真机量出来的，不是估的）。
       * 改成「套餐信息一行做头 + 赠送区全宽」后空白归零，行高 315 → 272。
       * ⚠️ 别再退回两列：列宽解决的是**横向**，这个问题是**纵向**的，两回事。 */
      .hlj-gc-head {
        display: flex; align-items: baseline; gap: 5px 14px; flex-wrap: wrap;
        padding-bottom: 7px; border-bottom: 1px dashed #f0f0f0;
      }
      /* 套餐名不硬断（break-all 会把它从任意字拆开），只在真放不下时才折 */
      .hlj-gc-head-main { font-weight: 500; font-size: 13px; word-break: normal; overflow-wrap: anywhere; }
      .hlj-gc-head-main .hlj-gc-tag { vertical-align: 1px; }
      /* 金额：14px（红领巾 2026-09-29 要求放大），成交价琥珀色强调，原价压灰 */
      .hlj-gc-prices {
        display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 18px;
        font-size: 14px; line-height: 1.35; color: #8c8c8c;
      }
      .hlj-gc-prices b { font-weight: 600; font-variant-numeric: tabular-nums; }
      .hlj-gc-p1 b { color: #595959; }
      .hlj-gc-p2 b { color: #d46b08; }
      .hlj-gc-sub { color: #8c8c8c; font-size: 11.5px; }
      .hlj-gc-gives { margin-top: 8px; }
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

      /* 赠送项目：先按**组**分块（组头写「几选几」），组内再按赠送包分组、包内列项目 */
      .hlj-gc-group + .hlj-gc-group { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e8e8e8; }
      .hlj-gc-group-head {
        display: flex; align-items: baseline; gap: 6px;
        margin-bottom: 4px; line-height: 1.4;
      }
      .hlj-gc-group-name {
        flex: 0 0 auto;
        padding: 0 5px; border-radius: 3px; font-size: 11px; line-height: 16px;
        font-weight: 600; background: #fff7e6; color: #d46b08;
        border: 1px solid #ffe7ba;
      }
      .hlj-gc-group-limit { color: #8c8c8c; font-size: 11.5px; }
      .hlj-gc-group-limit.is-unknown { color: #d46b08; }
      .hlj-gc-group-warn {
        color: #cf1322; font-size: 11px;
        border-bottom: 1px dashed #ffa39e; cursor: help;
      }

      /* 赠送项目：组内按赠送包分组，包名做小标题，项目用有序列表（每个项目独占一行）
       * v1.7.0：给赠送包加**左侧绿色竖线 + 缩进** —— 层级靠空间表达，不再只靠颜色。
       * 组头（0 级）→ 赠送包（+9px 缩进、绿线）→ 项目（再 +18px 列表缩进），形成阶梯。 */
      .hlj-gc-give { padding-left: 9px; border-left: 2px solid #c0dd97; }
      .hlj-gc-give + .hlj-gc-give { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #f0f0f0; }
      .hlj-gc-give-name {
        display: block;
        color: #3b6d11;
        font-size: 11.5px;
        margin-bottom: 2px;
      }

      /* v1.8.0：**包与包并排** —— 一个组里有 ≥2 个赠送包时列成 2 列（4 个包 → 2×2）。
       * 为什么：包内改成一列后高度 ↑，包间并排把宽度用满、高度又降回来（原来右侧空一截）。
       * ⚠️ 用 grid，不用 columns：grid **同行等高**（两条绿竖线一样长，像表格）；
       *    columns 会把一个多行包**从中间劈开**分到两列。
       * ⚠️ 只有 1 个包时不给 is-pack2（否则包只占半宽、右半空着，更乱）。
       * ⚠️ 行距由 grid 的 row-gap 出，所以并排时**必须**清掉「兄弟包上虚线 + margin」——
       *    否则同一行右边那个包会凭空低 8px（它是第 2 个兄弟，会命中 + 选择器）。 */
      .hlj-gc-group.is-pack2 {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        column-gap: 18px;
        row-gap: 8px;
      }
      .hlj-gc-group.is-pack2 > .hlj-gc-group-head { grid-column: 1 / -1; }
      .hlj-gc-group.is-pack2 .hlj-gc-give + .hlj-gc-give {
        margin-top: 0; padding-top: 0; border-top: 0;
      }
      /* v1.8.0：包内项目**一列**竖排（红领巾 2026-09-30：「一个包里有好几个项目时，
       * 两列不容易分辨」）。宽度交给**包与包并排**去用（见 .hlj-gc-group.is-pack2）。
       * ⚠️ 别再加回 columns —— 项目一多，左右两列看不出哪一项属于哪个包。
       * 宽度实测：最长项目文字 268px + 列表缩进 18px = 286px，并排时单列可用 322px ⇒ 余量 36px。 */
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
        <button id="${IDS.close}" type="button" title="关闭（ESC）">×</button>
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
    bindEscClose();
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

  /** 面板是否**真的可见** —— 必须看**计算后**的 display。
   *  ⚠️ 别用 `p.style.display`：面板首次创建时 inline style 是空的、可见性来自 CSS 的
   *     `display:flex` ⇒ 拿 inline 判会把「刚打开」误判成「已关闭」（ESC 就不会关它）。 */
  function isPanelOpen() {
    const p = $(IDS.panel);
    return !!p && getComputedStyle(p).display !== 'none';
  }

  function togglePanel() {
    if (isPanelOpen()) closePanel();
    else openPanel();
  }

  let escBound = false;

  /** v1.9.0：**ESC 关闭面板**（红领巾 2026-09-30）。四条约定见文件头「v1.9.0」。 */
  function bindEscClose() {
    if (escBound) return; // 幂等：boot 会被 SPA 路由/hashchange 触发多次，别重复挂
    escBound = true;
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' && e.key !== 'Esc') return; // 'Esc' 是旧 Edge 的叫法
        if (!isPanelOpen()) return; // 面板没开 ⇒ 一个字节都不干预页面自己的 ESC
        e.preventDefault();
        e.stopPropagation(); // 一次 ESC 只关这一层，别连带关掉页面自己的浮层
        closePanel();
      },
      true // ⭐ 捕获阶段：页面也在 document/window 上听键盘，捕获先拿到才抢得在前
    );
  }

  // ============================================================
  // 8. 渲染
  // ============================================================

  /**
   * 把该套餐绑的赠送包按「组」归拢，并带上每组的「几选几」约束。
   *
   * 口径照**页面自己的渲染代码**（依据见文件头接口第 ③ 条）：
   *   ① group 是 1 基、selectionSizeList 是 0 基 ⇒ 第 N 组约束 = selectionSizeList[N-1]
   *   ② 只认 1..5 组（页面只有五个位置）；落到外面的（含 group === -1）归「未分组」并标注
   *   ③ **空组不产出条目** —— 与页面一致（那组没包就整组不渲染）
   *   ④ 约束元素可能是 {} ⇒ min/max 记 null，渲染时标「无约束数据」，不显示空文案
   */
  function buildGroups(gives, sizeList) {
    const bucket = new Map(); // no -> [give]
    gives.forEach((g) => {
      const no = Number(g.group);
      const key = no >= 1 && no <= GROUP_MAX ? no : 0; // 0 = 页面不认的组
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(g);
    });

    const readLimit = (no) => {
      const s = Array.isArray(sizeList) ? sizeList[no - 1] : null;
      const min = s && s.minSize !== null && s.minSize !== undefined ? Number(s.minSize) : null;
      const max = s && s.maxSize !== null && s.maxSize !== undefined ? Number(s.maxSize) : null;
      return { min: min, max: max };
    };

    const out = [];
    for (let no = 1; no <= GROUP_MAX; no++) {
      const list = bucket.get(no);
      if (!list || !list.length) continue; // 空组不显示（与页面一致）
      const lim = readLimit(no);
      out.push({
        no: no,
        name: GROUP_LETTERS[no - 1] + '组',
        min: lim.min,
        max: lim.max,
        gives: list,
      });
    }
    if (bucket.get(0)) {
      out.push({ no: 0, name: GROUP_NONE_CN, min: null, max: null, gives: bucket.get(0) });
    }
    return out;
  }

  // ============================================================
  // 8.1 长文本去重（v1.7.0）
  // ============================================================
  /**
   * 为什么要有这一节：实测（订单 SOA37906452851870365）
   *   套餐名 46 字、赠送包名 48 字 —— 而两者的**公共前缀是 45 字**，重复率 97.8%。
   * 这串东西是「产品族名」，同一订单里逐字相同 ⇒ 行内写近两遍纯属噪音，
   * 提到面板顶部说一次就够，行内只留**差异段**。
   * ⚠️ 差异段可能只有一两个字（本例是「男」/「女已婚」）—— 这是对的，不是 bug：
   *   族名已在顶部给出，行内的身份由「价格 + PKG 编码」承担，悬停可看全名。
   */

  /** 最长公共前缀长度 */
  function lcp(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charAt(i) === b.charAt(i)) i++;
    return i;
  }

  /** 所有套餐名的共同前缀；不足 2 条、或前缀 < 12 字（区分度不够）时返回 '' */
  function commonPrefixOf(names) {
    const list = names.filter(Boolean);
    if (list.length < 2) return '';
    let p = list[0];
    for (let i = 1; i < list.length && p; i++) p = p.slice(0, lcp(p, list[i]));
    p = p.replace(/[\s\-—–·/、,，:：]+$/, ''); // 尾巴上的分隔符不算前缀
    return p.length >= 12 ? p : '';
  }

  /** 行内显示的套餐名：优先「共同前缀之后的差异段」；差异段为空时退回尾部保留 */
  function shortPkgName(name, prefix) {
    if (!name) return '';
    if (prefix && name.indexOf(prefix) === 0) {
      const rest = name.slice(prefix.length).replace(/^[\s\-—–·/、,，:：]+/, '').trim();
      if (rest) return rest;
    }
    return name.length > 40 ? '…' + name.slice(-38) : name;
  }

  /** 行内显示的赠送包名：与套餐名**共有的那截不再重复**，只留差异 + 项目数 */
  function giveLabel(gName, pkgName, n) {
    const g = gName || '';
    const p = pkgName ? lcp(g, pkgName) : 0;
    let label;
    if (p >= 8) {
      let extra = g.slice(p).replace(/^[\s\-—–·/、,，:：]+/, '').trim();
      extra = extra.replace(/^【?赠送包】?/, '').trim(); // 只剩「赠送包」三字 = 没有差异信息
      if (extra.length > 16) extra = extra.slice(0, 15) + '…';
      label = extra ? '赠送包 · ' + extra : '赠送包';
    } else {
      // 与套餐名无关的包名 ⇒ 原样显示（太长才截，且**保头**：无关包名通常从头就不一样）
      label = g.length > 24 ? g.slice(0, 22) + '…' : g;
    }
    return label + ' · ' + n + ' 个项目';
  }

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
      // v1.7.0：套餐名的共同前缀提到这里说一次（行内只留差异段）。
      // ⚠️ 必须写成**内联** span —— 试过 <details>（块级），在 #meta 的行内流里会多撑出
      //    约 40px 的空行盒（实测 192.8→213.2 上下各多一条行盒），面板白白长高。
      (state.commonPrefix
        ? '<br><span class="hlj-gc-common"' +
          (state.commonPrefix.length > 60 ? ' title="' + esc(state.commonPrefix) + '"' : '') +
          '>套餐名共同部分：' +
          esc(state.commonPrefix.length > 60 ? state.commonPrefix.slice(0, 60) + '…' : state.commonPrefix) +
          '（行内已省略）</span>'
        : '') +
      (state.bindTotal ? '<br><span style="color:#8c8c8c">本订单共绑定 ' + state.bindTotal + ' 个包，其中 ' +
        state.giveTotal + ' 个是赠送包（加项包不展示）</span>' : '') +
      (state.err ? '<br><span style="color:#cf1322">' + esc(state.err) + '</span>' : '');
  }

  /** 一个赠送包：包名 + 包内项目（每项一行，带原价）
   *  v1.7.0：包名不再照抄 48 字 —— 与套餐名共有的那截在顶部说过一次了，
   *  行内只显示「赠送包 · N 个项目」（有差异信息时才追加）。全名放 title 里备查。 */
  function giveHtml(g, pkgName) {
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
    const full = g.name || g.code;
    return (
      '<div class="hlj-gc-give">' +
      '<span class="hlj-gc-give-name" title="' + esc(full) + '">' +
      esc(giveLabel(full, pkgName, g.items.length)) +
      '</span>' +
      items +
      '</div>'
    );
  }

  /** 一组：组头（组名 + 几选几）+ 该组下的赠送包
   *  v1.8.0：组内 **≥2 个包**时给 `is-pack2`，CSS 把包列成两列（4 个包 → 2×2）。
   *  ⚠️ 1 个包不加 —— 并排会让它只占半宽、右半空着，比不排更乱。 */
  function groupHtml(gr, pkgName) {
    // 「未分组」不写约束 —— 它本来就不属于任何组，写「无约束数据」是噪音
    const limit = gr.no === 0
      ? ''
      : (gr.min === null || gr.max === null
        ? '<span class="hlj-gc-group-limit is-unknown">无约束数据</span>'
        : '<span class="hlj-gc-group-limit">最少选' + esc(gr.min) + '个 最多选' + esc(gr.max) + '个</span>');
    const warn = gr.no === 0 ? '<span class="hlj-gc-group-warn">页面不归此组</span>' : '';
    const pack2 = gr.gives.length >= 2 ? ' is-pack2' : '';
    return (
      '<div class="hlj-gc-group' + pack2 + '">' +
      '<div class="hlj-gc-group-head">' +
      '<span class="hlj-gc-group-name">' + esc(gr.name) + '</span>' +
      limit +
      warn +
      '</div>' +
      gr.gives.map((g) => giveHtml(g, pkgName)).join('') +
      '</div>'
    );
  }

  function rowHtml(r, idx) {
    const tags =
      '<span class="hlj-gc-tag t-' + esc(r.type) + '">' + esc(TYPE_CN[r.type] || r.type || '套餐') + '</span>' +
      (r.voided ? '<span class="hlj-gc-tag t-void">' + esc(voidCn(r)) + '</span>' : '');

    // v1.7.0：行内只显示差异段（共同前缀在顶部）
    const shownName = shortPkgName(r.name, state.commonPrefix);

    // 客户类型/编码：差异段已经把客户类型说出来了（如「男」「女已婚」）就不再重复一遍
    const sub = [];
    const cust = CUST_CN[r.custType] || r.custType || '';
    if (cust && shownName.indexOf(cust) < 0) sub.push(cust);
    if (r.code) sub.push(r.code);

    const prices =
      '<span class="hlj-gc-prices">' +
      '<span class="hlj-gc-p1">原价 <b>' + esc(fmtMoney(r.salePrice)) + '</b></span>' +
      '<span class="hlj-gc-p2">成交价 <b>' + esc(fmtMoney(r.price)) + '</b></span>' +
      '</span>';

    const givesHtml = r.groups.map((gr) => groupHtml(gr, r.name)).join('');

    return `
      <tr class="${r.voided ? 'is-voided' : ''}">
        <td>
          <div class="hlj-gc-head">
            <span class="hlj-gc-no">${idx + 1}</span>
            <span class="hlj-gc-head-main"${r.name ? ` title="${esc(r.name)}"` : ''}>${tags}${esc(shownName)}</span>
            ${prices}
            ${sub.length ? '<span class="hlj-gc-sub">' + esc(sub.join(' · ')) + '</span>' : ''}
          </div>
          <div class="hlj-gc-gives">${givesHtml}</div>
        </td>
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
    // ④ 单列 + 无表头（2026-09-29 红领巾定）：行内自解释，不需要「套餐 / 赠送项目」表头；
    //    表头还存在的话反而会让人以为下面是两列对齐的。
    box.innerHTML =
      '<table class="hlj-gc-table">' +
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
            group: a.group, // 组号（1 基）；约束要去宿主套餐的 selectionSizeList[group-1] 取
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
          // 组头要的是**宿主套餐自己**的约束（不是赠送包的）—— 见文件头接口第 ③ 条
          groups: buildGroups(gives, host.selectionSizeList),
        });
      });

      state.rows = rows;
      state.giveTotal = giveTotal;
      state.itemTotal = itemTotal;
      // v1.7.0：算一次套餐名的**共同前缀** —— 行内渲染要靠它做去重
      state.commonPrefix = commonPrefixOf(rows.map((r) => r.name));
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
