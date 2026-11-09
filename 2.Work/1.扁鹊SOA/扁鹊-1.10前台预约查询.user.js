// ==UserScript==
// @name         扁鹊-1.10前台预约查询
// @namespace    https://tampermonkey.net/
// @version      1.9.3
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
 * 三个页签对应的查询口径（v1.7.0 定稿，2026-11-09 真机实测；v1.4.0 那版「已到检走 order」已被推翻）：
 *   未到检   serviceName = orderMerge，appointmentStatus = [TO_APPOINTMENT, APPOINTMENT_FINISH]
 *   **一次查全部分院**（req.onlySelfBranch = false），不用按分院循环
 *   已到检   serviceName = hcOrder，**不带状态条件**（它对状态键一律忽略）← 分院维度
 *            ＋ order + [APPOINTMENT_FINISH, CHECKED, CANCEL] 兜底（字段更全，见 queryBranch）
 *   已取消   serviceName = order，appointmentStatus = CANCEL       ← 分院维度
 *   ⚠️ 别再只按 appointmentStatus 过滤：已出报告 / 报告已生成这类记录在 order 里根本没有
 *     appointmentStatus 字段，会被整批筛掉（71434246578738 就是这么「查无数据」的）。
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
 *
 * v1.7.0（2026-11-09，红领巾「71434246578738 前台查得到、脚本说无数据」）：
 *   真因不是参数写错，是**状态过滤口径不全** —— 这条记录在 order 里没有 appointmentStatus 字段，
 *   状态只有 serviceOrderStatus(Code) = 已出报告 / EXPORT_REPORT，于是被 appointmentStatus 过滤筛掉。
 *   修法：分院槽位改成 order ∪ hcOrder 两份取并集（hcOrder = 该分院该单号/证件的全部服务单，
 *   不认任何状态条件），去重键 vid / SOA 订单号，重复时留 order 那份（字段更全）。
 *   实测数据与推导过程写在 queryBranch 的注释里；从未到检页面回来的记录不受影响。
 *
 * v1.8.0（2026-11-09，红领巾三句话）：
 *   ① 「想看人员套餐对应的加项包分别是什么、价格、几选几」⇒ 套餐卡里新增加项包组块：
 *      组标题照抄系统文案「第 N 组 · X 选 Y」（N = groupNum 组序号，X = 选项数，
 *      Y = maxOption 最多选几个；有 miniNumber 时补「最少 Z 个」，
 *      依据是前台前端包 umi.c13371c0.js 里那段 `第N组（X选Y，最少选择Z个）`），
 *      组内一行一个加项包，列【加项包 / 原价 / 成交价 / 项目数】，组头右侧给组内合计。
 *      ⚠️ addPackageList 里**没有价格**，只有 addGroupId ⇒ 拿它当 packageCode，同 billCode 再查一次
 *      querySelectedPackages（批量：实测 7 个 addGroupId 一次传回 7 条，但**返回顺序与入参不一致**，
 *      只能按 packageName 对号）。
 *   ② 「原始数据不要这样直接列出来」⇒ 「列表记录 / 收费明细」原来那几十行「字段名 / 值」改成
 *      按语义分组的卡片（人员 / 预约与到检 / 订单与单位 / 费用），字段值翻译成中文，
 *      空字段收进折叠，全字段折叠 + 原始 JSON 都还在（一个字段都不丢）。
 *      收费明细前面加一张「费用构成」表（项目 / 原价 / 成交价 / 支付状态 + 合计），
 *      跟前台登记页「套餐和加项信息」那张表同口径。
 *   ③ 「先标准价，后结算价，和系统保持一致」⇒ 全站金额统一 `原价 ¥x · 成交 ¥y`
 *      （前台列名就是「原价 / 实际成交价」），列表金额格也从「成交大字 + 标准小字」翻过来。
 *
 * v1.9.0（2026-11-09，红领巾两句，都是浮层里的顺序）：
 *   ① 「将获取到的订单数据往下移，首先展示这个人的信息」⇒ 浮层从上到下改成
 *      人员信息 → 订单信息 → 套餐（主套餐 → 加项包）→ 预约与订单信息 → 收费明细 → 原始 JSON。
 *      人员组用 detailInfoGroups(raw, { only: '人员' }) 单独拎出来置顶，
 *      下面那段 skip 掉人员组，同一个人的姓名/证件不会出现两遍。
 *   ② 「加项包放到主套餐下边」⇒ 加项包组块从「套餐头下面」挪到「套餐内项目」之后，
 *      前面加一行「加项包 · N 组 / M 个可选」小标题；套餐 meta 行里那句加项包概况随之去掉（不重复）。
 *
 * v1.9.1（2026-11-09，红领巾澄清「人员信息」的含义）：
 *   ① 他说的「人员信息」不是姓名证件，而是**这个人的套餐、加项包、金额**。
 *      ⇒ 浮层顺序再换：「套餐 · 加项包 · 金额」置顶 → 订单信息 → 人员与预约信息 → 收费明细；
 *      v1.9.0 那个「人员置顶」撤掉（姓名证件那类基础资料优先级最低，回到下面那一段里）。
 *   ② 「加项包最好也能支持查看项目」⇒ 加项包行末的「N 项」改成按钮，点开在下一行摊出项目明细表
 *      （复用套餐内项目那张表，最大高度 210px 自己滚）。
 *
 * v1.9.2（2026-11-09，红领巾四张标注图 + 四条要求）：
 *   ① 「套餐内容默认展开，现有的高度就够用，多出来的部分滚动查看」⇒ 主套餐项目的 <details> 加回 open，
 *      但不能放开高度：仍靠 .qt-items-scroll 的 300px 限高自己滚（放开就是把加项包顶到屏幕外，
 *      v1.9.0 踩过一次）。
 *   ② 「给套餐也加一个底色，和加项包区分开」⇒ 套餐卡从 #fcfdff（≈白）换成冷色 #f1f6fd + 蓝边，
 *      加项包保持暖色 #fffdf8；加项包本来就是套在套餐卡里的，同色系根本分不出块。
 *   ③ 「加项包部分原价、成交价、项目错位了」⇒ 不是数据问题，是 **CSS 选择器权重**：
 *      `.qt-addon-table thead th { text-align:left }`(0,1,2) 压过 `.qt-ad-price { text-align:right }`(0,1,0)，
 *      表头被拽回左对齐、数据格还是右对齐 ⇒ 三列整体错开一截。补 th 级右对齐规则把表头拉回来；
 *      收费明细表（`.qt-fee-table th`）同一个毛病，一并治。
 *   ④ 「订单信息放到最下边」+ 图里「收费明细 这部分上移」⇒ 顺序定稿：
 *      套餐·加项包·金额 → 收费明细 → 预约与订单信息 → 订单信息 → 原始 JSON。
 *   ⑤ 图里划叉的也照做了：人员卡（姓名/性别/年龄/证件/婚姻/手机/VIP）、「其它」卡、费用卡、
 *      以及收费明细下面重复出现的那份分组卡全部撤掉；「订单与单位」只留打勾的四项
 *      （订单名称 / 单位名称 / 体检卡号 / 套餐名称）。没上卡片的字段仍收在「其余 N 个字段」折叠条里。
 *
 * v1.9.3（2026-11-09，红领巾：「人员姓名、手机号、这个也是需要的」）：
 *   v1.9.2 ⑤ 的读图读偏了 —— 他那张图上人员卡里**姓名和手机号是打勾的**，划叉的是性别 / 年龄 /
 *   证件类型 / 证件号 / 婚姻状况 / VIP（这些在列表表格和浮层标题里本来就有）。
 *   ⇒ 「人员」组回到信息段最前面，只带 姓名 + 手机号（有 notSecretPhone 明文就用明文）；
 *   同一个值两套字段名（name/customerName、phone/customerPhone）不再重复成两行。
 *   该段标题也按系统口径改回「人员与预约信息」。浮层顺序不变（v1.9.2 ④ 的定稿）。
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

  const SCRIPT_VERSION = '1.9.3';

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
  // v1.7.0：'order' 会把「已出报告 / 报告已生成」这类后期状态按 appointmentStatus 筛掉，
  // 这些记录只有 hcOrder（登记服务单全量视图）能给 ⇒ 分院查询两份取并集，见 queryBranch。
  const QT_SERVICE_CHECKED = 'hcOrder';
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
  // 逐条拉单条详情时的并发上限（3 个分院 × 20 条一起串行太慢，全并发又会把接口打满）
  const DETAIL_CONCURRENCY = 4;
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

  /*
   * 限并发地跑 async 映射：结果按原顺序回填。
   * 用途单一 —— 逐条拉「单条详情」时别串行（30+ 条会拖到半分钟），也别全放出去打满接口。
   */
  async function mapLimit(list, limit, fn) {
    const out = new Array(list.length);
    let cursor = 0;
    const size = Math.max(1, Math.min(limit, list.length));
    const workers = new Array(size).fill(0).map(async () => {
      while (cursor < list.length) {
        const idx = cursor;
        cursor += 1;
        out[idx] = await fn(list[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
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
   * 一个服务的一页列表（分院槽位要打两次，抽出来）。
   */
  async function postList(serviceName, branch, req, pageSize) {
    const headers = await buildQtHeaders(branch.code);
    const json = await gmPost(QT_LIST_API, { pageRequest: { pageNum: 1, pageSize, req }, serviceName }, headers);
    const data = (json && json.data) || {};
    const items = Array.isArray(data.content) ? data.content : [];
    // 服务端总数：一页装不下时（按身份证查常见）用于提示「只显示前 N 条」
    const total = Number(data.totalSize ?? data.totalElements ?? items.length);
    const records = items.map((item) => mapRecord(item, branch));
    return { records, total: Number.isFinite(total) ? total : records.length };
  }

  /*
   * 分院查询：已到检 / 已取消 / 已预约未到检（这三个都按分院）。
   *   serviceName = 'order'    + appointmentStatus = [APPOINTMENT_FINISH, CHECKED, CANCEL]
   *   serviceName = 'hcOrder'  + 不带任何状态条件
   *   req.vid              = 预约单号（输入的是 14 位单号时）
   *   req.certificateNumber = 身份证号（输入的是身份证时）
   *
   * 🔴 v1.7.0 修「前台查得到、脚本提示无数据」（红领巾 2026-11-09 用 71434246578738）：
   *   这条记录的 order 数据里**根本没有 appointmentStatus 字段**，状态只有
   *   serviceOrderStatus(Code) = 已出报告 / EXPORT_REPORT ⇒ 带 appointmentStatus 过滤的请求
   *   被服务端按状态筛掉，回 0 条。实测（真实登录态 · 本机 Chrome 9222，2026-11-09）：
   *     order   + [APPOINTMENT_FINISH, CHECKED, CANCEL] + vid  → 0 条
   *     order   + [CHECKED] + vid                              → 0 条
   *     order   + 不带 appointmentStatus + vid                  → 1 条（白亮东，EXPORT_REPORT）
   *     hcOrder + vid（带不带 [CHECKED] 都一样）                → 1 条（白亮东，REPORT_CREATED）
   *   且 hcOrder **对所有状态条件一律忽略**：拿 410726199105163033 传 appointmentStatus=[CHECKED]，
   *   照样回 12 条 CANCEL（serviceOrderStatus / serviceOrderStatusCode / checkupOrderStatus / status
   *   这几个键也都不认）⇒ 它就是个「该分院该单号/证件的全部服务单」视图。
   *   ⇒ 所以不再单靠某一支，改成**两份取并集**：
   *     ① order    带 [APPOINTMENT_FINISH, CHECKED, CANCEL]：已取消 / 已预约未到检，字段最全
   *                （nameListUid、明文证件号、branchVid —— 详情浮层靠它换套餐编码）
   *     ② hcOrder  不带状态过滤：已到检的后期状态（已出报告 / 报告已生成 / 主检中…）只有这里有，
   *                顺带把 order 漏掉的早期已取消也补齐（同一证件：order 2 条、hcOrder 12 条）
   *     同一单去重键 = 预约单号 vid / SOA 订单号，重复时**留 order 那份**（字段多）。
   *   跨院隔离照旧：hcOrder 在 X7 / FC 查同一 vid 都是 0 条 ⇒ 不会串院。
   *   未到检（未预约 / 已预约）仍然只有 order / orderMerge 有，hcOrder 一条都不给（验过）。
   */
  async function queryBranch(branch, keyword) {
    const pageSize = keyword.type === 'cert' ? 50 : 20;
    const base = { branchCode: branch.code };
    if (keyword.type === 'cert') base.certificateNumber = keyword.value;
    else base.vid = keyword.value;

    const primary = await postList(
      QT_SERVICE_BRANCH,
      branch,
      { ...base, appointmentStatus: QT_STATUS_BRANCH.slice() },
      pageSize
    );
    // hcOrder 不认状态条件，就别传了 —— 传了也只是白搭，还容易被后来人误读成「在过滤」
    const full = await postList(QT_SERVICE_CHECKED, branch, { ...base }, pageSize);

    const seen = new Set();
    const records = [];
    // ⚠️ 这里是「两个服务返回的同一单」去重，**不能直接复用 recKeyList**：
    //    一个 SOA 订单下可能挂多次预约（实测 410726199105163033 在 X1 有 徐林霞 两条
    //    2026-07-22 的服务单共用同一个订单号），用「vid + 订单号」双键会把不同单当成重复。
    //    ⇒ 有预约单号就只认单号；没有单号（未预约那批）才退到「订单号 + 预约日期」。
    const identityOf = (rec) => (rec.vid
      ? `v:${rec.vid}`
      : (rec.soaOrderNo ? `s:${rec.soaOrderNo}|${rec.apptDate || ''}` : `n:${rec.name}|${rec.statusCode}`));
    const push = (rec) => {
      const key = identityOf(rec);
      if (seen.has(key)) return;
      seen.add(key);
      records.push(rec);
    };
    primary.records.forEach(push);
    full.records.forEach(push);

    // total 只用来提示「接口共 N 条 / 本次只取前 M 条」，并集没有权威总数，取全量口径与实际条数的较大值
    return { records, total: Math.max(full.total, records.length) };
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
    // hcOrder 那份只有脱敏证件号（622******0818），列表项没 packageCode 时拿它去换套餐编码会查空，
    // 所以优先用单条详情里取到的明文证件号（rec.certFull）
    const cert = String(rec.certFull || raw.notSecretCertificateNumber || raw.certificateNumber || '');
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

    // ④ 加项包的价格（v1.8.0）
    //    addPackageGroupList 里只给了 addGroupId / addGroupName，没有一分钱的价格；
    //    但 addGroupId 本身就是套餐编码，拿它当 packageCode 再查一次 querySelectedPackages 就有
    //    checkPrice（原价）/ settlementPrice（成交价）/ details（项目）。
    //    实测（2026-11-09，26百威 段亮）：同一个 billCode 一次传 7 个 addGroupId → 7 条全回，
    //    **但返回顺序跟入参不一致**（腰椎/颈椎被换了位）⇒ 只能按 packageName 对号，不能按下标。
    out.addPackages = Object.create(null);
    const addIds = [];
    out.packages.forEach((pkg) => {
      (Array.isArray(pkg?.addPackageGroupList) ? pkg.addPackageGroupList : []).forEach((grp) => {
        (Array.isArray(grp?.addPackageList) ? grp.addPackageList : []).forEach((a) => {
          const id = String(a?.addGroupId || '');
          if (id && !addIds.includes(id)) addIds.push(id);
        });
      });
    });
    if (addIds.length) {
      const j4 = await safePost(
        QT_SELPKG_API,
        {
          billCode: soaOrderNo,
          branchCode,
          packages: addIds.slice(0, 40).map((packageCode) => ({ packageCode })),
          replaceItemInfos: [],
        },
        '加项包价格'
      );
      (Array.isArray(j4 && j4.data) ? j4.data : []).forEach((p) => {
        out.addPackages[String(p?.packageName || '')] = p;
      });
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
            // ⚠️ v1.7.0：并集之后记录变多（一个证件能到 30+ 条），串行拉详情会把一次查询拖到
            //    30 秒以上（实测 35 条 = 34.7s）⇒ 改成限并发，最多同时 4 条
            if (!branch.merged) {
              await mapLimit(list, DETAIL_CONCURRENCY, async (rec) => {
                if (!rec.vid) return;
                rec.detail = await fetchDetail(branch.code, rec.vid).catch(() => null);
                rec.detailRaw = rec.detail?.raw || null;
                if (rec.detail?.apptDate) rec.apptDate = rec.detail.apptDate;
                if (rec.detail?.certFull) rec.certFull = rec.detail.certFull;
                if (rec.detail?.customerName) rec.name = rec.detail.customerName;
              });
            }
            // 详情浮层按 `分院码#序号` 取记录，顺便记下它属于哪个槽位
            list.forEach((rec, idx) => {
              rec.__branch = branch;
              // v1.8.0：键要绑在**记录**上，不能靠渲染时的序号 ——
              // 「已预约未到检」会被 migrateNotYet 搬到未到检块，渲染那边按 `${slot.branch.code}#${idx}`
              // 算出来是 `*#0`，而这里注册的是 `X7#0` ⇒ 点详情没反应（实测 71005527887761 复现）。
              if (!rec.__key) rec.__key = `${branch.code}#${idx}`;
              state.byKey.set(rec.__key, rec);
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
   * 价格口径统一（v1.8.0，红领巾 2026-11-09）：
   *   「先标准价，后结算价」—— 跟前台登记页那张表一致（列名是「原价 / 实际成交价」）。
   *   standard = checkPrice，settle = settlementPrice。
   *   两个价相同时只显示一个，别写「¥510.00 / 成交 ¥510.00」这种废话。
   */
  function pricePair(standard, settle, sep = ' · ') {
    const hasStd = Number.isFinite(standard);
    const hasSet = Number.isFinite(settle);
    if (!hasStd && !hasSet) return '—';
    if (hasStd && hasSet && standard === settle) return moneyText(standard);
    const parts = [];
    if (hasStd) parts.push(`<span class="qt-pm-std" title="标准价（原价）">原价 ${moneyText(standard)}</span>`);
    if (hasSet) parts.push(`<span class="qt-pm-set" title="结算价（实际成交价）">成交 ${moneyText(settle)}</span>`);
    return parts.join(sep);
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

  /*
   * 金额单元格（v1.8.0）：先原价（标准），后成交（结算），跟前台登记页一致。
   * settle / standard 都可能拿不到（未到检的收费接口返回空）⇒ 谁有显示谁。
   */
  function moneyCellHtml(settle, standard) {
    const hasStd = Number.isFinite(standard);
    const hasSet = Number.isFinite(settle);
    if (!hasStd && !hasSet) return { text: '—', sub: '' };
    const main = hasStd ? moneyText(standard) : moneyText(settle);
    const sub = hasStd && hasSet && standard !== settle ? `<i>成交 ${moneyText(settle)}</i>` : '';
    return { text: main, sub };
  }

  // 分院表的一行（已到检 / 已取消）
  function renderBranchRow(rec, branch, key) {
    const detail = rec.detail || null;
    const certText = rec.certFull || rec.certMasked || '—';
    const money = moneyCellHtml(detail ? detail.settle : null, detail ? detail.standard : null);
    const statusText = rec.statusText || rec.statusCode || '—';
    const statusShort = STATUS_SHORT[rec.statusCode] || statusText;
    const branchLabel = branch.short || rec.branchShort || '—';

    return `
      <tr class="qt-row ${branchClass(branch.code)}">
        <td class="qt-c-branch" title="${escapeHtml(rec.branchShort || branch.name || '')}">${escapeHtml(branchLabel)}</td>
        <td class="qt-c-name" title="${escapeHtml(rec.name || '')}">${escapeHtml(rec.name || '—')}</td>
        <td class="qt-c-cert" title="${escapeHtml(certText)}">${escapeHtml(certText || '—')}</td>
        <td class="qt-c-date">${escapeHtml(rec.apptDate || '—')}</td>
        <td class="qt-c-money" title="原价 / 成交价">${money.text}${money.sub}</td>${statusCell(detail, statusText, statusShort)}
        <td class="qt-c-vid">${escapeHtml(rec.vid || '—')}</td>${detailCell(key)}
      </tr>
    `;
  }

  // 未到检表的一行：没有分院列；单号列没 vid 就显示 SOA 订单号
  function renderNotYetRow(rec, key) {
    const detail = rec.detail || null;
    const certText = rec.certFull || rec.certMasked || '—';
    const money = moneyCellHtml(detail ? detail.settle : null, detail ? detail.standard : null);
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
        <td class="qt-c-money" title="原价 / 成交价">${money.text}${money.sub}</td>${statusCell(detail, statusText, statusShort, branchNote)}
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
      rows = shown.map((rec, idx) => renderNotYetRow(rec, rec.__key || `${slot.branch.code}#${idx}`)).join('');
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
      rows.push(shown.map((rec, idx) => renderBranchRow(rec, branch, rec.__key || `${branch.code}#${idx}`)).join(''));
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
          // 客户身份这类一整坨 JSON 会把这个格子撑到天边，折叠区里截断显示，全量看原始 JSON
          const shown = text.length > 400 ? `${text.slice(0, 400)}…` : text;
          const label = DETAIL_LABELS[k] || k;
          return `
            <div class="qt-kv-k" title="${escapeHtml(k)}">${escapeHtml(label)}</div>
            <div class="qt-kv-v${shown ? '' : ' is-blank'}">${escapeHtml(shown || '—')}</div>
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

  /*
   * 「原始数据」可读化（v1.8.0 建，v1.9.2 按红领巾的叉号收窄，v1.9.3 补回姓名/手机号）
   * 原来是把接口字段拍成几十行「字段名 / 值」，一半空值、一半英文码，扫不动；
   * v1.8.0 按语义分了四组（人员 / 预约与到检 / 订单与单位 / 费用）+ 一张「其它」。
   * v1.9.2 他在这几块上划了叉：其它、费用（折扣 80 那种）、以及收费明细下面重复出现的那一份，
   * 人员卡也只当整块撤掉 —— v1.9.3 更正：他划的是性别/年龄/证件/婚姻/VIP 那几行，
   * **姓名和手机号是打勾要留的**，所以人员组回来，只带这两个字段。现在共三组：
   *   人员（姓名 / 手机号 · 明文优先）
   *   预约与到检（预约单号/日期/时段/分院/服务单状态 —— 他打了勾的）
   *   订单与单位（只留订单名称/单位名称/体检卡号/套餐名称 —— 他打了勾的四项）
   * 费用那几项在「套餐·加项包·金额」和「收费明细」里已经说得更清楚。
   * 一个字段都不丢：没进卡片的字段统一收进「其余 N 个字段」折叠条，最下面还有原始 JSON。
   */
  const INFO_GROUPS = [
    {
      /*
       * v1.9.3：v1.9.2 的叉号读偏了。他划掉的是性别 / 年龄 / 证件类型 / 证件号 / 婚姻 / VIP 这些
       * 一排基础资料（跟列表表格、浮层标题重复），**姓名和手机号是留着的**（图上这两个打了勾）。
       * 前台核身份第一眼就是「这单是不是这个人的、电话能不能打通」，所以只留这两项回到卡片里；
       * 其余仍然只进「其余 N 个字段」折叠条。
       */
      title: '人员',
      keys: ['name', 'customerName', 'phone', 'customerPhone'],
    },
    {
      title: '预约与到检',
      // 只留看得懂的。overTwoHour / pregnantEnabled 这类 0 / DISABLE 的开关旗标挪到折叠区，
      // 否则卡片上就是「孕妇检查 DISABLE」这种原文，跟「原始数据直接列出来」一个毛病。
      keys: ['vid', 'appointmentStatus', 'appointmentDate', 'appointmentTimeSlot', 'appointmentModeStr',
        'appointBranchName', 'branchName', 'checkupDate', 'serviceOrderStatus', 'checkupOrderStatus',
        'checkinTime', 'checkoutTime', 'checkinChannel'],
    },
    {
      // 只列他打勾的四项。SOA订单号 / 单位代码 / 订单购买来源 都划掉了
      //（订单号最下面的「订单信息」里有完整的一条，这里再来一遍是噪音）
      title: '订单与单位',
      keys: ['orderName', 'companyName', 'cardNumber', 'packageName'],
    },
  ];

  // 码值翻译：状态码用 STATUS_TEXT，性别/婚姻/证件类型/会员类型这套枚举在下面
  // （只翻能确认的，翻不出来就原样显示，绝不猜）
  const INFO_CODE_TEXT = {
    ID_CARD: '身份证', PASSPORT: '护照', HK_MACAO_PASS: '港澳通行证', TAIWAN_PASS: '台湾通行证',
    MALE: '男', FEMALE: '女',
    MARRIED: '已婚', UNMARRIED: '未婚', DIVORCED: '离异', WIDOWED: '丧偶',
    COMMON: '普通会员', SILVER: '银卡', GOLD: '金卡', DIAMOND: '钻石卡',
  };

  function infoValueText(key, value) {
    const raw = fmtDetailValue(value);
    if (!raw) return '';
    if (STATUS_TEXT[raw]) return STATUS_TEXT[raw];
    if (INFO_CODE_TEXT[raw]) return INFO_CODE_TEXT[raw];
    return raw;
  }

  function infoGroupCard(title, rows, mod) {
    return `
      <div class="qt-ig${mod ? ' ' + mod : ''}">
        <div class="qt-ig-head">${escapeHtml(title)}</div>
        <div class="qt-ig-grid">
          ${rows.map(([k, v]) => `
            <div class="qt-ig-row">
              <span class="qt-ig-k">${escapeHtml(k)}</span>
              <span class="qt-ig-v" title="${escapeHtml(v)}">${escapeHtml(v)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /*
   * 卡片只放「看得懂、一眼要」的字段：
   *   · 有中文对应版的码字段（genderCode / appointmentType / ...CN）不重复列；
   *   · 超长值（客户身份那种一整坨 JSON）不往卡片里塞，收进折叠；
   *   · 没有中文标签的技术字段（picPath / seqNo / 内部 ID）也只进折叠。
   * 折叠区是「其余 N 个字段」= 全部没进卡片的字段（含空值），加上最下面的原始 JSON，一个字段都不丢。
   *
   * opts.only / opts.skip：只渲染某一组 / 跳过某组（v1.9.0 加，用来把「人员」单独拎出去）。
   *   v1.9.1 起浮层顺序换成「套餐置顶、人员回到一段里」，这两个开关暂时没人调用，
   *   留着是因为再调顺序时一行就能拆开，不用重写这三十行。
   *   只渲染某一组时（opts.only）不再出「其它」和空字段折叠，那些都留在下面那段里。
   */
  function detailInfoGroups(obj, opts) {
    const src = obj || {};
    const only = (opts && opts.only) || '';
    const skip = new Set((opts && opts.skip) || []);
    const scalars = Object.keys(src).filter((k) => src[k] === null || typeof src[k] !== 'object');
    if (!scalars.length) return '<div class="qt-kv-empty">（这个接口没返回字段）</div>';

    const shown = new Set();
    const cards = [];

    // 值能不能上卡片：空 / 超长（>90 字）都不上
    const cardValue = (k) => {
      const text = fmtDetailValue(src[k]);
      if (!text || text.length > 90) return '';
      return infoValueText(k, src[k]);
    };

    // 明文孪生字段（certificateNumber ↔ notSecretCertificateNumber、phone ↔ notSecretPhone）：
    // 接口给的「X」经常是 622******0818 这种掩码，明文在 notSecretX 里。
    // ⇒ 有明文就用明文显示在 X 的标签上，notSecretX 自己不再单独出一行（v1.9.0）
    const plainOf = (k) => {
      if (/^notSecret/.test(k)) return '';
      const twin = `notSecret${k.charAt(0).toUpperCase()}${k.slice(1)}`;
      const v = fmtDetailValue(src[twin]);
      return v && v.length <= 90 ? v : '';
    };

    // 有中文孪生字段（genderCode→gender、appointmentType→appointmentTypeCN）就只显示中文那个
    const hasChineseTwin = (k) => {
      const twins = [];
      if (/Code$/.test(k)) twins.push(k.replace(/Code$/, ''));
      twins.push(`${k}CN`);
      return twins.some((t) => t !== k && fmtDetailValue(src[t]) !== '');
    };

    INFO_GROUPS.forEach((group) => {
      // only 模式：只要那一组；否则按 skip 跳过
      const wanted = only ? group.title === only : !skip.has(group.title);
      if (!wanted) {
        // 这一组本次不渲染 ⇒ 它名下的字段算「已展示」，别再漏进「其它」或折叠区
        group.keys.forEach((k) => {
          if (k in src) shown.add(k);
        });
        return;
      }
      const rows = [];
      group.keys.forEach((k) => {
        // 明文字段只做「值来源」，不单独成行（原始字段名留在折叠区里，一个都不丢）
        if (/^notSecret/.test(k)) return;
        if (!(k in src) || shown.has(k) || hasChineseTwin(k)) return;
        const plain = plainOf(k);
        const text = plain || cardValue(k);
        if (!text) return;
        shown.add(k);
        // 同一个值两套字段名（name / customerName、phone / customerPhone）不重复成两行
        if (rows.some(([, v]) => v === text)) return;
        rows.push([DETAIL_LABELS[k] || k, text]);
      });
      if (rows.length) cards.push(infoGroupCard(group.title, rows, only ? 'is-wide' : ''));
    });

    // only 模式到此为止：不重复出「其它」，也不重复出空字段折叠
    if (only) {
      return cards.length
        ? `<div class="qt-ig-wrap">${cards.join('')}</div>`
        : '<div class="qt-kv-empty">这条记录没有人员字段（可能来自缓存）</div>';
    }

    // v1.9.2：「其它」卡片撤掉（他划了叉：预约类型 / 刷卡校验 / 是否替换单 / 一堆内部 ID 全是噪音）。
    // 没进上面两组的字段照样不漏 —— 全都落在下面的「其余 N 个字段」折叠条里，点开能查。
    const left = scalars.filter((k) => !shown.has(k));
    const leftHtml = left.length
      ? `<details class="qt-blanks"><summary>其余 ${left.length} 个字段（含空值与长文本，点开看）</summary>${detailKvRows(left, src)}</details>`
      : '';

    if (!cards.length) {
      return `<div class="qt-kv-empty">（这个接口的字段都是空的）${leftHtml}</div>`;
    }

    return `<div class="qt-ig-wrap">${cards.join('')}</div>${leftHtml}`;
  }

  /*
   * 费用构成（orderDetail.packages）：前台登记页「套餐和加项信息」那张表的同口径版本 ——
   * 每行一个套餐/加项包，先原价后成交价，最后一行合计。
   */
  function detailFeeTable(data) {
    const list = Array.isArray(data?.packages) ? data.packages : [];
    if (!list.length) return '';
    const sumStd = sumBy(list, 'checkPrice');
    const sumSet = sumBy(list, 'settlementPrice');
    const rows = list.map((p) => `
      <tr>
        <td class="qt-fee-name" title="${escapeHtml(String(p?.packageName || ''))}">${escapeHtml(String(p?.packageName || '—'))}</td>
        <td class="qt-fee-num">${Number.isFinite(Number(p?.checkPrice)) ? moneyText(Number(p.checkPrice)) : '—'}</td>
        <td class="qt-fee-num is-settle">${Number.isFinite(Number(p?.settlementPrice)) ? moneyText(Number(p.settlementPrice)) : '—'}</td>
        <td class="qt-fee-pay">${escapeHtml(String(p?.payStatusStr || p?.payStatus || '—'))}</td>
      </tr>
    `).join('');
    return `
      <div class="qt-fee">
        <table class="qt-fee-table">
          <thead>
            <tr>
              <th scope="col" class="qt-fee-name">项目 / 套餐</th>
              <th scope="col" class="qt-fee-num">原价</th>
              <th scope="col" class="qt-fee-num">成交价</th>
              <th scope="col" class="qt-fee-pay">支付状态</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td class="qt-fee-name">合计 ${list.length} 项</td>
              <td class="qt-fee-num">${Number.isFinite(sumStd) ? moneyText(sumStd) : '—'}</td>
              <td class="qt-fee-num is-settle">${Number.isFinite(sumSet) ? moneyText(sumSet) : '—'}</td>
              <td class="qt-fee-pay"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  // 收费接口里每个套餐的原始字段：收进折叠，别跟上面的费用表抢版面（字段一个不少）
  function detailPackages(data) {
    const list = Array.isArray(data?.packages) ? data.packages : [];
    if (!list.length) return '';
    const inner = list.map((pkg, i) => `
      <div class="qt-pkg">
        <div class="qt-pkg-head">套餐 ${i + 1}${pkg?.packageName ? ` · ${escapeHtml(String(pkg.packageName))}` : ''}</div>
        ${detailKv(pkg)}
      </div>
    `).join('');
    return `<details class="qt-blanks"><summary>收费接口里每个套餐的字段（${list.length} 个，点开看）</summary>${inner}</details>`;
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
      // 订单备注动辄几百字（华润雪花那种条款），格子里放不下 ⇒ 单独折叠在下面，见 remarkBlock
    ].filter(([, v]) => String(v || '').trim());

    const grid = rows.length
      ? `<div class="qt-order-grid">${rows.map(([k, v]) => `
          <div class="qt-og-k">${escapeHtml(k)}</div>
          <div class="qt-og-v">${escapeHtml(String(v))}</div>
        `).join('')}</div>`
      : '';

    // 备注原文里常带换行（remark3 是「健管顾问：xxx(a96652) 换行 联系电话：xxx」那种），
    // 长起来能到几百字 ⇒ 收进折叠区，别把「订单信息」这一段撑成一面墙
    const remark = String(order.remark || '').trim();
    const remark3 = String(order.remark3 || '').trim();
    const remarkBlock = remark || remark3
      ? `<details class="qt-blanks">
           <summary>订单备注${remark ? `（${remark.length} 字）` : ''}</summary>
           ${remark ? `<div class="qt-order-remark">${escapeHtml(remark).replace(/\n/g, '<br />')}</div>` : ''}
           ${remark3 ? `<div class="qt-order-remark">${escapeHtml(remark3).replace(/\n/g, '<br />')}</div>` : ''}
         </details>`
      : '';

    return `
      ${head}
      ${grid}
      ${remarkBlock}
      <details class="qt-blanks">
        <summary>订单全部 ${Object.keys(order).length} 个字段</summary>
        ${detailKv(order)}
      </details>
    `;
  }

  /*
   * 项目明细表：一个套餐 / 一个加项包里的检查项（details[]）
   *   opts.plain（v1.9.1）：加项包展开时用 —— 只要「项目 / 商品名 / 原价」。
   *   原因：项目级的 settlePrice 是**按项折算**出来的值，跟加项包那一行的实际成交价对不上
   *   （实测腰椎侧位包 原价¥60 成交¥0，项目行却写着成交¥50），两列并排放只会让人怀疑数据错了。
   *   加项包到底成交多少钱，看包那一行；这里只回答「这个包里是哪几个项目」。
   */
  function detailItemsTable(items, opts) {
    const list = Array.isArray(items) ? items : [];
    const plain = !!(opts && opts.plain);
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
          ${plain ? '' : `<td class="qt-it-price">${Number.isFinite(settle) ? moneyText(settle) : '—'}</td>`}
        </tr>
      `;
    }).join('');

    // 项目可能几十项，表格限高自己滚，别把浮层撑成一条长卷
    return `
      <div class="qt-items-scroll">
      <table class="qt-item-table${plain ? ' is-plain' : ''}">
        <thead>
          <tr>
            <th scope="col" class="qt-it-name">项目</th>
            <th scope="col" class="qt-it-goods">商品名</th>
            <th scope="col" class="qt-it-price" title="标准价">原价</th>
            ${plain ? '' : '<th scope="col" class="qt-it-price" title="接口返回的项目结算价（套餐整体结算后按项折算，不是单项单独售价）">成交价</th>'}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    `;
  }

  /*
   * 加项包组（v1.8.0 —— 红领巾 2026-11-09：「想看人员套餐对应的加项包分别是什么、价格、几选几」）
   *   结构：addPackageGroupList[] = { groupNum, maxOption, addPackageList[{addGroupId, addGroupName}] }
   *
   *   「几选几」的口径**不是我推的，是系统自己的文案**：
   *     前台前端包 umi.c13371c0.js 里那段渲染是
   *       "第" + groupNum + "组（" + frontPackageList.length + "选" + maxOption + "，最少选择" + (miniNumber||0) + "个）"
   *     ⇒ groupNum = **组序号**（第几组，不是「选几个」），maxOption = **最多选几个**，
   *        选项总数 = addPackageList.length，miniNumber = 最少选几个（接口常常不返回）。
   *   实测样本（同一单，26百威中国投资-员工套餐-男）：
   *     组1：groupNum=1, maxOption=1, 2 个选项 ⇒ 第 1 组 · 2 选 1（腰椎侧位 / 颈椎侧位）
   *     组2：groupNum=2, maxOption=5, 5 个选项 ⇒ 第 2 组 · 5 选 5（5 个公司筛查包）
   *   价格：addPackageList 里只有编码，拿 addGroupId 当 packageCode 再查一次（见 fetchOrderFull ④），
   *        返回只按 packageName 对号（顺序不可靠）。
   */
  function detailAddonGroups(pkg, addMap) {
    const groups = Array.isArray(pkg?.addPackageGroupList) ? pkg.addPackageGroupList : [];
    const map = addMap || {};
    const blocks = [];

    groups.forEach((grp, gi) => {
      const opts = Array.isArray(grp?.addPackageList) ? grp.addPackageList : [];
      if (!opts.length) return;

      // 照抄系统文案：第 N 组（X 选 Y，最少选择 Z 个）
      const total = opts.length;
      const maxPick = Number(grp?.maxOption);
      const minPick = Number(grp?.miniNumber);
      const groupNo = Number.isFinite(Number(grp?.groupNum)) ? Number(grp.groupNum) : gi + 1;
      const rule = Number.isFinite(maxPick)
        ? `${total} 选 ${maxPick}${Number.isFinite(minPick) && minPick > 0 ? `，最少 ${minPick} 个` : ''}`
        : `${total} 个可选`;

      let sumStd = 0;
      let hasSumStd = false;
      let sum = 0;
      let hasSum = false;
      const rows = opts.map((a) => {
        const name = String(a?.addGroupName || '');
        const hit = map[name] || null;
        const standard = hit ? Number(hit.checkPrice) : NaN;
        const settle = hit ? Number(hit.settlementPrice ?? hit.receviceSettlePrice) : NaN;
        if (Number.isFinite(standard)) {
          sumStd += standard;
          hasSumStd = true;
        }
        if (Number.isFinite(settle)) {
          sum += settle;
          hasSum = true;
        }
        const items = Array.isArray(hit?.details) ? hit.details : [];
        const itemTitle = items.map((x) => String(x?.itemName || x?.goodsName || '')).filter(Boolean).join('、');
        // v1.9.1：加项包也能看项目了 —— 「N 项」点开，下一行摊出明细表
        return `
          <tr>
            <td class="qt-ad-name" title="${escapeHtml(name)}">${escapeHtml(name)}</td>
            <td class="qt-ad-price">${Number.isFinite(standard) ? moneyText(standard) : '—'}</td>
            <td class="qt-ad-price is-settle">${Number.isFinite(settle) ? moneyText(settle) : '—'}</td>
            <td class="qt-ad-items" title="${escapeHtml(itemTitle)}">${items.length
              ? `<button type="button" class="qt-ad-exp" data-role="addon-toggle" data-count="${items.length}" aria-expanded="false" title="点开看这 ${items.length} 个项目">${items.length} 项 ▾</button>`
              : '—'}</td>
          </tr>
          ${items.length
            ? `<tr class="qt-ad-detail-row" style="display:none"><td colspan="4">${detailItemsTable(items, { plain: true })}</td></tr>`
            : ''}`;
      }).join('');

      blocks.push(`
        <div class="qt-addon">
          <div class="qt-addon-head">
            <span class="qt-addon-title">第 ${escapeHtml(String(groupNo))} 组 · ${escapeHtml(rule)}</span>
            ${(hasSumStd || hasSum) ? `<span class="qt-addon-sum">合计：${pricePair(hasSumStd ? sumStd : NaN, hasSum ? sum : NaN)}</span>` : ''}
          </div>
          <table class="qt-addon-table">
            <thead>
              <tr>
                <th scope="col" class="qt-ad-name">加项包</th>
                <th scope="col" class="qt-ad-price">原价</th>
                <th scope="col" class="qt-ad-price">成交价</th>
                <th scope="col" class="qt-ad-items">项目</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `);
    });

    return blocks.join('');
  }

  function detailPkgList(packages, info) {
    const list = Array.isArray(packages) ? packages : [];
    if (!list.length) {
      const tips = [];
      if (info?.error) tips.push(info.error);
      if (!info?.pkgCodes?.length) tips.push('没换到套餐编码，拉不到套餐');
      return `<div class="qt-kv-empty">${escapeHtml(tips.join('；') || '这一单没有套餐数据')}</div>`;
    }

    const sumStd = sumBy(list, 'checkPrice');
    let sumSet = 0;
    let hasSumSet = false;
    list.forEach((p) => {
      const n = Number(p?.settlementPrice ?? p?.receviceSettlePrice);
      if (Number.isFinite(n)) {
        sumSet += n;
        hasSumSet = true;
      }
    });
    // 只有一个套餐时，合计就写在套餐头上了，再来一条纯属重复
    const sumBar = list.length > 1 && (Number.isFinite(sumStd) || hasSumSet)
      ? `<div class="qt-pkg-sum"><span class="qt-pkg-sum-k">主套餐合计</span><span class="qt-pkg-sum-v">${pricePair(sumStd, hasSumSet ? sumSet : NaN)}</span></div>`
      : '';

    return sumBar + list.map((pkg, i) => {
      const details = Array.isArray(pkg?.details) ? pkg.details : [];
      const settle = Number(pkg?.settlementPrice ?? pkg?.receviceSettlePrice);
      const standard = Number(pkg?.checkPrice);
      const addGroups = Array.isArray(pkg?.addPackageGroupList) ? pkg.addPackageGroupList : [];
      const addCount = addGroups.reduce((n, g) => n + (Array.isArray(g?.addPackageList) ? g.addPackageList.length : 0), 0);

      const sub = [
        pkg?.payStatusStr ? String(pkg.payStatusStr) : '',
        payTypeText(pkg?.soaPayType),
        details.length ? `${details.length} 个项目` : '',
        // 加项包概况写在下面的「加项包 · N 组」小标题里，这里不重复
      ].filter(Boolean).join(' · ');

      // v1.9.2：主套餐项目改回**默认展开**（红领巾：「套餐内容默认展开，现有的高度就够用，
      // 多出来的部分滚动查看」）。高度不放大，仍走 .qt-items-scroll 的 300px 限高自己滚，
      // 所以加项包不会被顶得太远。
      const addonHtml = addCount
        ? `<div class="qt-addon-cap">加项包 · ${addGroups.length} 组 / ${addCount} 个可选</div>
           ${detailAddonGroups(pkg, info?.addPackages)}`
        : '';

      return `
        <div class="qt-pkg">
          <div class="qt-pkg-head">
            <span class="qt-pkg-name">套餐 ${i + 1} · ${escapeHtml(String(pkg?.packageName || pkg?.packageAlias || '—'))}</span>
            <span class="qt-pkg-price">${pricePair(standard, settle)}</span>
          </div>
          <div class="qt-pkg-meta">${escapeHtml(sub)}</div>
          <details class="qt-blanks" open>
            <summary>主套餐项目 ${details.length} 项</summary>
            ${detailItemsTable(details)}
          </details>
          ${addonHtml}
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
            <div class="qt-sec-title">套餐 · 加项包 · 金额<em>querySelectedPackages</em><em data-role="pkg-state"></em></div>
            <div data-role="pkg-box">${renderPkgBox(rec)}</div>

            <div class="qt-sec-title">收费明细<em>orderDetail</em></div>
            ${detailRaw
              ? `${detailFeeTable(detailRaw)}${detailPackages(detailRaw)}`
              : `<div class="qt-kv-empty">${branch?.merged ? '未到检还没有收费记录，接口不返回' : '该单没有返回详情数据'}</div>`}

            <div class="qt-sec-title">人员与预约信息<em>query/list</em></div>
            ${raw ? detailInfoGroups(raw) : '<div class="qt-kv-empty">这条记录没有原始数据（可能来自缓存）</div>'}

            <div class="qt-sec-title">订单信息<em>soaOrderDetail</em><em data-role="order-state"></em></div>
            <div data-role="order-box">${renderOrderBox(rec)}</div>

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
      if (e.target.closest?.('[data-role="close"]') || e.target.dataset?.role === 'mask') {
        closeDetail();
        return;
      }
      // 加项包的「N 项 ▾」：摊开/收起紧跟着的明细行（v1.9.1）
      const toggle = e.target.closest?.('[data-role="addon-toggle"]');
      if (toggle) {
        const tr = toggle.closest('tr');
        const row = tr && tr.nextElementSibling;
        if (row && row.classList.contains('qt-ad-detail-row')) {
          const open = row.style.display === 'none';
          row.style.display = open ? '' : 'none';
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.classList.toggle('is-open', open);
          toggle.textContent = open ? `${toggle.dataset.count} 项 ▴` : `${toggle.dataset.count} 项 ▾`;
        }
      }
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

      /* ---- 套餐与项目 ----
       * v1.9.2：套餐卡换成冷色底（#f1f6fd），跟加项包的暖色底（#fffdf8）一眼分得开。
       * 原来两边都是接近白的 #fcfdff / #fffdf8，而加项包又是套在套餐卡里面的，
       * 视觉上分不清哪块是主套餐、哪块是加项包。
       */
      #${IDS.modal} .qt-pkg {
        margin-top:9px; padding:8px 10px; background:#f1f6fd;
        border:1px solid #d7e4f5; border-radius:9px;
      }
      #${IDS.modal} .qt-pkg-head {
        display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:0;
      }
      #${IDS.modal} .qt-pkg-name { font-size:11.5px; font-weight:800; color:#334155; word-break:break-word; }
      #${IDS.modal} .qt-pkg-price {
        flex:0 0 auto; font-size:11.5px; font-weight:800; color:#475569;
        font-variant-numeric:tabular-nums; white-space:nowrap;
      }
      #${IDS.modal} .qt-pkg-meta { margin-top:3px; font-size:10.5px; color:#64748b; }
      #${IDS.modal} .qt-pkg-add  { margin-top:3px; font-size:10.5px; color:#7c5a12; }

      /* ---- v1.8.0 价格口径：先原价（标准），后成交（结算） ---- */
      #${IDS.modal} .qt-pm-std { color:#475569; }
      #${IDS.modal} .qt-pm-set { color:#b45309; font-weight:800; }

      /* 主套餐合计条 */
      #${IDS.modal} .qt-pkg-sum {
        display:flex; align-items:baseline; gap:8px; margin-top:9px; padding:5px 9px;
        background:#f7faff; border:1px dashed #cddbf0; border-radius:8px;
        font-size:11px; font-variant-numeric:tabular-nums;
      }
      #${IDS.modal} .qt-pkg-sum-k { color:#64748b; font-weight:700; }
      #${IDS.modal} .qt-pkg-sum-v { color:#1f2937; font-weight:800; }

      /* ---- 加项包（v1.8.0）：暖色块，跟主套餐的冷色区分开 ---- */
      #${IDS.modal} .qt-addon-cap {
        margin:9px 0 2px; padding-top:7px; border-top:1px dashed #e6ddca;
        font-size:10.5px; font-weight:800; color:#8a5a00; letter-spacing:.02em;
      }
      #${IDS.modal} .qt-addon {
        margin-top:7px; border:1px solid #f0e4cd; border-radius:8px; overflow:hidden;
        background:#fffdf8;
      }
      #${IDS.modal} .qt-addon-head {
        display:flex; align-items:baseline; justify-content:space-between; gap:8px;
        padding:4px 8px; background:#fdf6e8; border-bottom:1px solid #f2e8d5;
      }
      #${IDS.modal} .qt-addon-title { font-size:10.5px; font-weight:800; color:#8a5a00; }
      #${IDS.modal} .qt-addon-sum {
        font-size:10px; font-weight:700; color:#a16207; font-variant-numeric:tabular-nums; white-space:nowrap;
      }
      #${IDS.modal} .qt-addon-table { width:100%; border-collapse:collapse; table-layout:fixed; }
      #${IDS.modal} .qt-addon-table thead th {
        padding:3px 8px; text-align:left; font-size:9.5px; font-weight:700; color:#a08a63;
        background:#fffdf8; border-bottom:1px solid #f4ecdd;
      }
      #${IDS.modal} .qt-addon-table td {
        padding:3px 8px; font-size:10.5px; color:#4b5563; border-bottom:1px solid #faf3e6;
        line-height:1.4;
      }
      #${IDS.modal} .qt-addon-table tr:last-child td { border-bottom:0; }
      #${IDS.modal} .qt-ad-name { width:56%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #${IDS.modal} .qt-ad-price {
        width:15%; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;
      }
      #${IDS.modal} .qt-ad-items { width:14%; text-align:right; white-space:nowrap; color:#9aa4b2; }
      #${IDS.modal} .qt-addon-table td.is-settle { color:#b45309; font-weight:700; }

      /* 🔴 v1.9.2 修「表头和数据行对不齐」：
         上面那句选择器 thead th { text-align:left } 的权重是 (0,1,2)，
         压过 .qt-ad-price { text-align:right } 的 (0,1,0) ⇒ 表头被拽回左对齐，
         而数据格是右对齐，于是「原价 / 成交价 / 项目」三列表头整体偏左一截，
         看着像列错位。这里用同样带 th 的选择器把表头拉回右对齐（权重更高）。
         收费明细表的 .qt-fee-table th { text-align:left } 同理，一起治。 */
      #${IDS.modal} .qt-addon-table thead th.qt-ad-price,
      #${IDS.modal} .qt-addon-table thead th.qt-ad-items { text-align:right; }
      #${IDS.modal} .qt-fee-table thead th.qt-fee-num { text-align:right; }

      /* ---- 加项包项目展开（v1.9.1）：点「N 项 ▾」摊出明细行 ---- */
      #${IDS.modal} .qt-ad-exp {
        font:inherit; font-size:9.5px; font-weight:700; color:#a16207;
        background:#fff; border:1px solid #ecd9b6; border-radius:4px;
        padding:1px 5px; cursor:pointer; white-space:nowrap;
      }
      #${IDS.modal} .qt-ad-exp:hover { background:#fdf6e8; border-color:#e0c191; }
      #${IDS.modal} .qt-ad-exp.is-open { background:#fdf1dd; border-color:#dcc08c; }
      #${IDS.modal} .qt-ad-detail-row > td { padding:0 6px 7px; background:#fffefb; }
      #${IDS.modal} .qt-ad-detail-row .qt-items-scroll { max-height:210px; margin-top:0; }

      /* ---- 信息分组卡（v1.8.0）：原始字段改成人话，一组一卡 ---- */
      #${IDS.modal} .qt-ig-wrap {
        display:grid; grid-template-columns:repeat(auto-fit, minmax(225px, 1fr));
        gap:7px; margin-top:7px;
      }
      #${IDS.modal} .qt-ig {
        border:1px solid #eef2f7; border-radius:8px; overflow:hidden; background:#fcfdff;
      }
      #${IDS.modal} .qt-ig-head {
        padding:4px 8px; font-size:10px; font-weight:800; color:#5b7089;
        background:#f4f7fb; border-bottom:1px solid #eef2f7;
      }
      #${IDS.modal} .qt-ig-grid { padding:3px 8px 5px; }
      /* 人员卡铺满整行时排两列，否则一条一行的拉得老长 */
      #${IDS.modal} .qt-ig.is-wide .qt-ig-grid {
        display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:20px;
      }
      #${IDS.modal} .qt-ig-row {
        display:flex; gap:8px; padding:2px 0; font-size:10.5px; line-height:1.45;
        border-bottom:1px dashed #f2f5f9;
      }
      #${IDS.modal} .qt-ig-row:last-child { border-bottom:0; }
      #${IDS.modal} .qt-ig-k { flex:0 0 66px; color:#8b97a8; }
      #${IDS.modal} .qt-ig-v { flex:1 1 auto; color:#1f2937; word-break:break-word; }

      /* ---- 费用构成表（v1.8.0）：跟前台「套餐和加项信息」同口径 ---- */
      #${IDS.modal} .qt-fee {
        margin-top:8px; border:1px solid #eef2f7; border-radius:8px; overflow:auto;
        scrollbar-gutter:stable;
      }
      #${IDS.modal} .qt-fee-table { width:100%; border-collapse:collapse; table-layout:fixed; }
      #${IDS.modal} .qt-fee-table th {
        padding:4px 8px; text-align:left; font-size:10px; font-weight:700; color:#64748b;
        background:#f8fafc; border-bottom:1px solid #eef2f7;
      }
      #${IDS.modal} .qt-fee-table td {
        padding:4px 8px; font-size:10.5px; color:#1f2937; border-bottom:1px solid #f5f8fb;
        line-height:1.4;
      }
      #${IDS.modal} .qt-fee-table tfoot td {
        background:#fafbfd; border-top:1px solid #e6ebf1; border-bottom:0;
        font-weight:800; color:#334155;
      }
      #${IDS.modal} .qt-fee-name { width:52%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      #${IDS.modal} .qt-fee-num {
        width:17%; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums;
      }
      #${IDS.modal} .qt-fee-table td.is-settle { color:#b45309; font-weight:800; }
      #${IDS.modal} .qt-fee-pay { width:14%; white-space:nowrap; color:#64748b; }

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
      /* 加项包展开表只有 3 列，重新分配宽度 */
      #${IDS.modal} .qt-item-table.is-plain .qt-it-name  { width:46%; }
      #${IDS.modal} .qt-item-table.is-plain .qt-it-goods { width:38%; }
      #${IDS.modal} .qt-item-table.is-plain .qt-it-price { width:16%; }
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
