// ==UserScript==
// @name         扁鹊-1.8套餐批量删除
// @namespace    https://tampermonkey.net/
// @version      1.1.7
// @description  SOA 订单页：列出当前订单的全部套餐/加项包，勾选后批量删除；另带「改名模式」开关（独立的改名视图：隐藏已作废/已删除的套餐，每行只留一个「改名」入口，套餐名默认只改中间段、系统前后缀原样保留，可切整串，也能单独改对外展示名），支持先暂存多条、统一提交、单条撤销/撤回原名。只在「未落单」或「已落单+检中修改」时加载；已作废与绑定关系复杂的加项包/赠送包挡在删除之外，已体检的只是不能删、仍可改名。全部直接调接口，不模拟点击。
// @match        https://checkup-soa3.health-100.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-shanchutaocan
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-shanchutaocan.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-shanchutaocan.user.js
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
 *
 * ── 加载门槛（红领巾 2026-09-22）──
 *   订单**只有两种情况可以改套餐**：① 已落单之前  ② 已落单但开启了「检中修改」。
 *   其余一律**不加载**（连工具箱里的入口都不出现）。判据：
 *     status != SUBMITTED 且属于落单前白名单  →  可用
 *     status == SUBMITTED 且 process_status == 'SUB_DRAFT'（检中修改）  →  可用
 *     status == SUBMITTED 但没开检中修改 / 取消 / 中止 / 完成 / 锁定  →  不加载
 *   口径不准时的逃生口：控制台执行 window.__hlj_pkg_batch_del_v100.force() 强制挂载。
 *
 * ── 已作废的套餐要自己过滤（红领巾 2026-09-22 提的问题）──
 *   ⚠️ **作废的套餐仍然出现在 package/query 的返回里**（实测 19 条里 13 条已作废），
 *   不自己认出来就会被当成"可删除"挂在列表上。判据（前端 chunk 枚举 + 页面显示双向确认）：
 *     process_status == 'INVALID'       → 作废      （页面在名字前加「已作废」，操作列只剩 查看/加项/复制/删除）
 *     process_status == 'INVALID_ING'   → 作废中
 *     process_status == 'INVALID_ERROR' → 作废失败
 *   脚本把这三类整行压灰、复选框禁用、不参与全选，并在工具栏计数里单列一项。
 *   「已删除」的套餐不在接口返回里，天然看不到，无需额外处理。
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
 *   ⑤ POST /soa/api/v1/package/detail     读单个套餐   {code}
 *      ⚠️ 参数名是 **code**（不是 package_code），传 package_code 会报错。
 *      → data[] 含 package_code / package_name / package_alias / package_type / cust_type
 *        / pay_type / price / sale_price / estimate_count / medicalInsurancePayment
 *        / product_items[]（每项含 sku_code / price / discount_price / mustCheckItem）
 *
 *   ⑥ POST /soa/api/v1/package/update     改名（= 页面「编辑套餐 → 保存套餐」打的那一个）
 *      ⚠️⚠️ **它不是"只传名字"的补丁接口，是全量重写**：少传字段有被清空的风险。
 *      → 页面实际发的 body（2026-10-26 抓包，逐字段核对过）：
 *        {order_code, package_code, package_name, package_alias,
 *         package_type, pay_type, cust_type, price, estimate_count,
 *         sku_codes:[{sku_code, price, sequence, innovation, mustCheckItem}],
 *         discount_request:[{sku_code, discount_price, use_original}],
 *         medical_insurance_payment, update_for_copy:false}
 *      → 所以脚本必须先 detail 读出原值、拼回整份 body，只把 name/alias 换掉再发。
 *
 *   ⑦ POST /soa/api/v1/package/update/check  保存前预检   {package_code}
 *      → data{flag, message, check_list_size, book_list_size, unbook_list_size}
 *        flag==="fail" + 「存在已到检或已预约的客户，确认要继续修改套餐吗？」
 *        这不是硬错误（result_code 仍 SUCC），只是要人点一下确认；
 *        真正的硬错误（如 packageCode 传成 code 而漏传）才是 result_code FAIL。
 *
 * ── 页面保存时的那两个弹窗，脚本为什么不用管（2026-10-26 实测）──
 *   ① 「以下项目符合本地区促销规则，是否要替换为促销价？」
 *      按钮是「取消保存 / 保存勾选的促销」。**这不是服务端关卡**：点保存套餐后，
 *      前端先 update/check，再拿 product/innovate/queryv2 的促销规则跟套餐项目比对，
 *      命中就把命中项列出来让人勾（表头：项目名称 / 原价 / 促销价）。
 *      勾上 → discount_request 写促销价 + use_original:false；
 *      不勾 → discount_request 写 discount_price:-99 + use_original:true（按原价保存）。
 *      ⇒ 脚本走的就是"不勾选"那条：把 detail 里**现有的** discount_price 原样发回，
 *        一分钱不动。同一套餐（含数字云胶片促销项）改名后 price 510 / 面值 100 未变。
 *   ② 「套餐已经上传体检名单，请自行处理 / 已检2人，已使用老套餐体检 / 我知道了」
 *      这是 update **成功之后**的告知，纯前端展示，点「我知道了」不再发任何请求。
 *      ⇒ 脚本不用点、也点不到；预检返回的人数脚本会写进日志。
 *   ⚠️ 由此得到一条纪律：页面那个「编辑套餐」弹窗里**不能挂着未保存的修改**再去跑脚本。
 *      弹窗里的勾选/改价会在点保存时一并提交（本次实测踩过：弹窗里多勾了 2 个云胶片，
 *      一点「保存套餐」就把 2 个项目、面值 100→150、展示价 140→240 全带上去了）。
 *
 * ── 改名（1.1.2 新增，红领巾 2026-10-26 提的需求）──
 *   「每次改名都要点编辑套餐再保存」太绕，所以给个开关：面板工具条上的「改名模式」。
 *   **默认关闭**，关闭时列表里连改名入口都没有 —— 名字是业务口径（含危害因素/阶段/性别），
 *   误改一个字就是数据问题，所以不给"点一下名字就能编辑"的随手路径（红领巾明确要求）。
 *   开启后每行出现**一个**「改名」按钮（1.1.7 起套餐名/对外展示名合成一个入口，进框后切 tab）
 *   → 点开该行名字就地变输入框 → 回车**暂存** / Esc 取消，
 *   改完点工具条「提交改名（N）」真正落库（1.1.5 起；详见下面"先改草稿"一节）。
 *
 * ── 改名视图：列表要干净（1.1.7，红领巾 2026-10-26 说"套餐一多就乱"）──
 *   · 改名模式下**不渲染**已作废的、本轮已删除的套餐 —— 改不了的东西不该占版面；
 *     删除模式仍全部列出（作废的是历史痕迹，删的时候要看得见）
 *   · 已体检的套餐**不再整行压灰**：它只是不能删，名字照样能改；状态压成一个副行小胶囊
 *   · 每行最多两个文字按钮（改名 / 撤销·撤回原名），对外展示名的第二个「改」按钮取消
 *   · 改名模式里勾选框、全选·清空·反选、删除按钮整体收起（删除和改名是两件事，别混在一起）
 *
 *   约束（页面自己的校验规则，照抄）：套餐名**不能为空、不能含空格**。
 *   改完脚本会**回读 detail 对比**：名字对上了才算成功，且 price / sale_price /
 *   show_price / estimate_count / 项目数 / 各项目 sku 与单价折扣必须与改前一模一样，
 *   不一致就在日志里点名报警
 *   （不静默 —— 全量重写这种接口，最怕的就是"悄悄改坏了别的字段"）。
 *
 * ── 两个名字：套餐名 vs 对外展示名（1.1.4，2026-10-26 实测）──
 *   · package_name  套餐名，业务口径（含危害因素/阶段/性别），报价单上显示这个
 *   · package_alias 对外展示名，小程序预约 / 导检单 / 报告封面给客户看
 *   页面自己的写法是 **alias 永远等于 name**（chunk 原文 e.package_alias=e.package_name=o），
 *   所以在页面上"先单独改了对外名、再改套餐名"会被冲掉 —— 红领巾点出来的正是这个坑。
 *   但接口**不强制**，实测四条都过（详见 daily/2026-10-26 §十二）：
 *     ① 改 name、alias 传原值  → name 变、alias 纹丝不动
 *     ② 只改 alias、name 不动  → alias 变、name 不动
 *     ③ alias 传 ""/null/空格  → **全被当成"不修改"**，清不掉已有展示名
 *     ④ 完全省略 alias 字段     → 同样不修改
 *   ⇒ 所以脚本按下面这套来（既跟页面"默认跟随"，又不冲掉单独设过的）：
 *     · 改套餐名：alias == 旧套餐名（或为空，= 没单独设过）→ alias 跟着改成新名；
 *                 alias 已经不等于旧套餐名（= 单独设过）→ **保持原样**
 *     · 改展示名：单独入口，留空即"跟随套餐名"（因为传空不生效，脚本改成显式传套餐名）
 *     1.1.7 起两个名字共用**一个**「改名」入口：进框后顶部 tab 切「套餐名 / 对外展示名」，
 *     不切过去就不会动它。
 *
 *   请求顺序照抄页面（1.1.3 校正）：update/check → update → order/evaluate。
 *   1.1.2 写成 update → check → evaluate，虽然也能改名成功，但和页面不一致；
 *   而且 check 本来就是"保存前的预检"，理应在前面。
 *
 *   可改范围与删除同口径：已作废的、已删除的不给改名；已体检的**可以**改
 *   （名字不影响体检名单与收入）。
 *
 * ── 先改草稿、最后统一提交（1.1.5）──
 *   1.1.4 及以前是"回车即落库"：每条改名立刻发 update。改一两条没问题，但一次改七八条时，
 *   改到中间才发现前面几条名字都少了个后缀，就只能逐条再改回来 —— 因为已经写进真实数据了。
 *   现在改成两段式：
 *     · 回车 = 暂存：只写进 state.renamePlan，行内变黄、显示「旧名 → 新名」，一条请求都不发
 *     · 工具条「提交改名（N）」= 一次性提交：串行、每条现读 detail、遇错即停
 *   为什么批量提交仍然安全：草稿里只存"名字想改成什么"，价格/项目/人数永远取**提交那一刻**
 *   的 detail，所以暂存期间别人改过的内容不会被旧快照覆盖（全量重写接口最怕的就是这个）。
 *   为什么串行不并发：同一订单多条同时 update，出问题分不清谁覆盖了谁；串行下每条失败都能
 *   点明是哪一条、什么原因、还剩几条没动（剩下的留在草稿里，不丢）。
 *   为什么 order/evaluate 整批只调一次：它只按当前数据重算订单收入，最后调一次结果等价。
 *
 *   撤销有两层，别混：
 *     · 草稿态「撤销」→ 从待提交表里删掉，**一条请求都不发**，名字回到原值
 *     · 已提交后「撤回原名」→ 记着提交前的 name/alias，走同一条 update 反向改回（价格照旧不动）
 *   两者都只作用于单条，互不影响其它套餐。
 *
 * ── 套餐名只改中间段（1.1.6，红领巾 2026-10-26）──
 *   套餐名是系统按「前缀 + 中间段 + 后缀」拼的：前缀是批次（`24测试专用-` / `26测试专用-`），
 *   后缀是性别或包类型（`-男` / `-女未婚` / `-女已婚` / `-赠送包`），真正要人工调的只有中间段
 *   （危害因素 + 体检阶段）。所以改名时默认**前后缀原样保留**。
 *   · 接口不返回这两个字段，只能从现有名字里切（实测本单 20 条全对）：
 *       ≥3 段 → 首段是前缀、末段是后缀；2 段且末段是已知后缀 → 只有后缀、没有前缀；
 *       2 段但末段不是后缀 → 首段当前缀；1 段 → 前后缀都没有
 *   · 输入框预填完整名（看得见现状），提交时把输入里已带的前缀/已知后缀剥掉，
 *     再用「原前缀 + 中间段 + 原后缀」重建 ⇒ 只敲中间段、或把整串粘进来，结果一致，
 *     也不会拼出 `-男-男`。拼回来的名字和输入不一致时，框下会显示「将保存为 …」
 *   · 两个模式（框内切换，默认「只改中间段」）：
 *       「只改中间段」→ 前后缀永远用系统的（输入里写了别的也会被还原）
 *       「整串改名」  → 输入什么就存什么，前后缀也一起改（少数情况用，唯一的口子）
 *   · **对外展示名不受这条限制**：不拼接、不校验前后缀，只挡换行；留空 = 跟随套餐名。
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
  const VERSION = '1.1.7'; // 与文件头 @version 保持一致（2026-09-24 修正，原为 1.0.0）
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

    // 改名用（2026-10-26 抓包 + 实测，见文件头「改名」一节）
    //   detail 的参数名是 code（不是 package_code）
    //   update 是**全量重写**，必须先把 detail 原值拼回去，只换 name/alias
    pkgDetail: '/soa/api/v1/package/detail',
    pkgUpdate: '/soa/api/v1/package/update',
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

  // 订单状态（前端 chunk 挖到）
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

  // 已落单之后的 process_status 子状态（前端 chunk 挖到）
  const SUB_STATUS_CN = {
    SUB_DRAFT: '检中修改',
    SUB_AUDIT: '检中审核',
    SUB_PUBLISH_AUDIT: '检中发单审核',
    SUB_PRE_SUBMIT: '检中落单审核',
  };

  /**
   * 「订单能不能改套餐」的口径（红领巾 2026-09-22 定，原话：
   *   只有两种情况可以编辑套餐 —— ① 已落单之前 ② 开启了「检中修改」）。
   *
   * 白名单写成**枚举**而不是「非 SUBMITTED 即可」，是因为黑名单放开会让未知状态默认放行 ——
   * 拿不准的时候宁可工具不出现（少一个入口，用户回页面手点就是了），
   * 也不能在不该出现的时候出现（那才是真出事）。
   *
   * ⚠️ 判不出可编辑时不是静默消失：控制台会打出当前 status / process_status 与原因，
   *    另有 `window[NS].force()` 可强制挂载（口径万一不准时的逃生口）。
   */
  const EDITABLE_BEFORE_SUBMIT = [
    'DRAFT',            // 草稿
    'CONFIRM_AUDIT',    // 报价确认
    'BACKUP_AUDIT',     // 内勤复核
    'CONTRACT_SUPPLE',  // 合同补充
    'PUBLISH_AUDIT',    // 发单审核
    'PRE_SUBMIT',       // 落单审核
  ];
  const SUB_EDITABLE = 'SUB_DRAFT'; // 已落单时唯一可改套餐的 process_status：检中修改

  /**
   * 套餐的「已作废」判据（2026-09-22 实测 + 前端 chunk 枚举确认）。
   *
   *   process_status: INVALID = 作废 / INVALID_ING = 作废中 / INVALID_ERROR = 作废失败
   *   （页面给这三类行的名字前加「已作废」前缀，操作列只剩 查看/加项/复制/删除）
   *
   * ⚠️ 关键：**作废的套餐仍然出现在 package/query 的返回里**（实测 19 条里 13 条已作废），
   *    所以必须自己过滤 —— 否则作废掉的会被当成可删除的显示出来。
   */
  const VOID_PROCESS_STATUS = ['INVALID', 'INVALID_ING', 'INVALID_ERROR'];

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

  /**
   * 这条套餐是不是已经作废了。
   * 主判 process_status（前端枚举里 INVALID 的中文就是「作废」）；
   * 仅当该字段缺失时，才退一步看 status=DISABLE（实测两者在数据里同步，但这属于兜底）。
   */
  function isVoid(p) {
    const ps = String((p && p.process_status) || '').toUpperCase();
    if (VOID_PROCESS_STATUS.indexOf(ps) >= 0) return true;
    if (!ps && String((p && p.status) || '').toUpperCase() === 'DISABLE') return true;
    return false;
  }

  /** 作废态的中文（用于行内展示，作废中/作废失败都如实说，不一律叫「已作废」） */
  function voidCn(p) {
    const ps = String((p && p.process_status) || '').toUpperCase();
    return { INVALID: '已作废', INVALID_ING: '作废中', INVALID_ERROR: '作废失败' }[ps] || '已作废';
  }

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
  // 3.5 加载门槛：这个订单能不能改套餐
  // ============================================================

  /**
   * 门槛状态。
   *   state: null = 还没判出来（此时**不挂按钮**，宁可晚 200ms 出现，也不闪一下又消失）
   *          true = 放行；false = 拦截
   * 判定按订单号缓存 —— 同一个订单不重复发请求（keepAlive 会被高频调用，不能每次判）。
   */
  const gate = {
    orderCode: null,
    state: null,
    reason: '',
    status: '',
    process: '',
  };

  /** 纯函数：由订单详情算出能不能改套餐 */
  function editableReason(info) {
    const st = String((info && info.status) || '').toUpperCase();
    const ps = String((info && info.process_status) || '').toUpperCase();
    if (st === 'SUBMITTED') {
      if (ps === SUB_EDITABLE) return { ok: true, reason: '已落单 · 检中修改' };
      const psCn = ps ? SUB_STATUS_CN[ps] || ps : '未开启检中修改';
      return { ok: false, reason: '已落单（' + psCn + '），套餐已锁定' };
    }
    if (EDITABLE_BEFORE_SUBMIT.indexOf(st) >= 0) {
      return { ok: true, reason: '未落单（' + (ORDER_STATUS_CN[st] || st) + '）' };
    }
    return {
      ok: false,
      reason: '订单状态「' + (ORDER_STATUS_CN[st] || st || '未知') + '」不在可改套餐的范围内',
    };
  }

  /**
   * 判一次门槛。force = true 时忽略同订单缓存。
   * 判完不由自己挂按钮 —— keepAlive 下一拍会看到 gate.state=true 自动挂上。
   */
  async function refreshGate(force) {
    const code = currentOrderCode();
    if (!code) {
      gate.orderCode = null;
      gate.state = false;
      gate.reason = '没识别到订单号（不是订单页？）';
      return false;
    }
    if (!force && gate.orderCode === code && gate.state !== null) return gate.state;

    gate.orderCode = code;
    gate.state = null; // 判定期间先别挂
    try {
      const info = await fetchOrderInfo(code);
      const j = editableReason(info);
      gate.status = info.status || '';
      gate.process = info.process_status || '';
      gate.reason = j.reason;
      gate.state = j.ok;
    } catch (e) {
      gate.state = false;
      gate.reason = '订单状态判定失败：' + (e.message || e);
    }
    if (gate.state) {
      console.log('[扁鹊-1.8] 订单 ' + code + ' 可改套餐（' + gate.reason + '），工具已启用');
    } else {
      console.warn(
        '[扁鹊-1.8] 订单 ' + code + ' 不可改套餐：' + gate.reason +
          '（status=' + gate.status + ' process_status=' + gate.process + '）—— 工具不加载'
      );
      // 入口撤了，已经打开的面板也要一起收掉 —— 否则会留下「按钮没了、面板还开着」的鬼影
      closePanel();
    }
    ensureSwitch();
    return gate.state;
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
    // ---- 改名（1.1.2）----
    renameMode: false, // 开关：默认关。关着时列表里连改名入口都不出现，防误改
    renaming: null,    // 正在改名的 package_code（非空时该行渲染成输入框）
    renameDraft: '',   // 输入框草稿：列表会被后台的体检名单检查重绘，草稿不存 state 就会丢字
    // 改的是哪个名字（1.1.4）：
    //   'name'  = package_name 套餐名（默认，业务口径）
    //   'alias' = package_alias 对外展示名（小程序预约 / 导检单 / 报告封面用）
    renameField: 'name',
    // 改套餐名时怎么拼（1.1.6）：
    //   'mid'  = 只改中间段（默认）：首段、末段是系统生成的，原样保留
    //   'full' = 整串改名：按用户输入的完整名字原样保存（少数情况用）
    // 对「对外展示名」无效 —— 展示名完全自由，不拼接、不校验前后缀。
    renameNameMode: 'mid',
    // ---- 改名草稿（1.1.5）----
    // 「先改、最后统一提交」：回车只往这张表里写，点「提交改名（N）」才落库。
    // package_code -> { name?: string, alias?: string }
    //   name  有值 = 套餐名要改成它
    //   alias 有值 = 对外展示名要改成它；alias: ''（空串）= 回到「跟随套餐名」
    // 一张表撑起两件事：撤销单条（从表里删）、批量提交（遍历表）。
    renamePlan: new Map(),
    // package_code -> { name, alias }：上一次提交前的原值，供「撤回原名」反向改回。
    // 只留最近一次 —— 「撤回」的语义永远是"把刚才那一改退掉"，不是无限回退栈。
    undoMap: new Map(),
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
    // 换订单时把「改名模式」也收起 —— 新订单里第一下点击就把名字改了，是最典型的误操作
    state.renameMode = false;
    state.renaming = null;
    state.renameDraft = '';
    state.renameField = 'name';
    state.renameNameMode = 'mid'; // 换订单回到默认「只改中间段」
    // 换订单时草稿必须清空：草稿的 key 是本单的 package_code，
    // 留到别的单里既对不上号，提交时还会"名字对、单不对"。
    state.renamePlan.clear();
    state.undoMap.clear();
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
      /* 全选 / 清空 / 反选 合成一个分段控件：三颗按钮看起来是一个整体，不抢视线 */
      #${IDS.toolbar} .hlj-bd-selgroup { display: inline-flex; border-radius: 5px; }
      #${IDS.toolbar} .hlj-bd-selgroup button { border-radius: 0; border-left-width: 0; }
      #${IDS.toolbar} .hlj-bd-selgroup button:first-child { border-radius: 5px 0 0 5px; border-left-width: 1px; }
      #${IDS.toolbar} .hlj-bd-selgroup button:last-child { border-radius: 0 5px 5px 0; }
      #${IDS.toolbar} .hlj-bd-cnt { margin-left: auto; color: #8c8c8c; font-size: 12px; line-height: 1.5; }

      /* ---------- 列表 ---------- */
      #${IDS.list} {
        flex: 1;
        overflow: auto;
        padding: 0 0 6px;
        min-height: 120px;
      }
      /* 分组标题吸顶：套餐一多，滚到一半也知道自己在看哪一类 */
      .hlj-bd-grp {
        position: sticky; top: 0; z-index: 2;
        padding: 5px 12px 4px; background: #fafafa;
        border-bottom: 1px solid #f0f0f0;
        color: #8c8c8c; font-size: 11px; letter-spacing: .4px;
      }
      .hlj-bd-row {
        display: flex; align-items: flex-start; gap: 8px;
        padding: 6px 12px; border-bottom: 1px solid #f5f5f5;
      }
      .hlj-bd-row:hover { background: #fafafa; }
      .hlj-bd-row.is-done { opacity: .55; }

      /* 已体检：**不再整行压灰** —— 它只是不能删除，名字照样能改（红领巾 2026-10-26） */
      .hlj-bd-row.is-blocked input[type="checkbox"] { cursor: not-allowed; }

      /* 已作废：改名模式里整条不渲染（见 paintList 过滤），删除模式下压灰留作历史痕迹 */
      .hlj-bd-row.is-voided { opacity: .55; }
      .hlj-bd-row.is-voided .hlj-bd-tag { opacity: .7; cursor: default; }
      .hlj-bd-row.is-voided input[type="checkbox"] { cursor: not-allowed; }

      /* 状态胶囊：统一挂在副行末尾，不再单占右侧一列去挤长名字 */
      .hlj-bd-pill {
        display: inline-block; margin-left: 2px; padding: 0 5px;
        border-radius: 3px; font-size: 11px; line-height: 16px;
        background: #f5f5f5; color: #8c8c8c; white-space: nowrap; vertical-align: 1px;
      }
      .hlj-bd-pill.danger { background: #fff1f0; color: #cf1322; }
      .hlj-bd-pill.ok { background: #f6ffed; color: #389e0d; }
      .hlj-bd-pill.fail { background: #fff1f0; color: #cf1322; }
      .hlj-bd-pill.muted { color: #bfbfbf; }
      /* 简单绑定：会在删除时自动解绑，只做提示，不影响勾选 */
      .hlj-bd-bind { color: #1677ff; cursor: help; }
      .hlj-bd-row input[type="checkbox"] {
        margin: 4px 0 0; width: 14px; height: 14px; cursor: pointer; flex: none;
      }
      .hlj-bd-main { flex: 1; min-width: 0; }
      /* 第一行：类型标签 + 名字 +（右侧）操作按钮；名字过长才折行，按钮始终贴右不上浮 */
      .hlj-bd-t1 { display: flex; align-items: flex-start; gap: 6px; }
      .hlj-bd-title {
        flex: 1; min-width: 0; line-height: 1.45; word-break: break-all; color: #262626;
      }
      .hlj-bd-acts { flex: none; display: flex; align-items: center; gap: 4px; }
      .hlj-bd-sub {
        margin-top: 2px; color: #9a9a9a; font-size: 11.5px; line-height: 1.55;
        word-break: break-all;
      }
      .hlj-bd-tag {
        flex: none; display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px;
        line-height: 17px; margin-top: 1px;
        background: #f0f0f0; color: #595959;
      }
      .hlj-bd-tag.t-PACKAGE { background: #e6f4ff; color: #0958d9; }
      .hlj-bd-tag.t-GIVEPACKAGE { background: #f9f0ff; color: #722ed1; }
      .hlj-bd-tag.t-ADDPKG { background: #fff7e6; color: #d46b08; }
      .hlj-bd-tag.t-GIVEPKG { background: #f6ffed; color: #389e0d; }
      .hlj-bd-tag.t-AIADDPKG { background: #e6fffb; color: #08979c; }
      .hlj-bd-tag.is-clickable { cursor: pointer; }
      .hlj-bd-tag.is-clickable:hover { outline: 1px solid currentColor; }

      /* ---------- 改名（1.1.7：每行只留一个「改名」，其余收进输入框）---------- */
      /* 工具条上的「改名模式」打开时高亮，提醒现在是可写状态 */
      #${IDS.toolbar} button.is-on {
        border-color: #d46b08; color: #d46b08; background: #fff7e6; font-weight: 600;
      }
      /* 行内「改名」做成文字按钮（不是描边按钮）——20 行就是 20 个按钮，描边会糊成一片 */
      .hlj-bd-edit {
        padding: 0 4px; height: 18px; line-height: 18px; border: 0; border-radius: 3px;
        background: none; color: #1677ff; font-size: 11.5px; cursor: pointer;
        font-family: inherit; white-space: nowrap;
      }
      .hlj-bd-edit:hover { background: #e6f4ff; color: #0958d9; }
      .hlj-bd-edit:disabled { opacity: .45; cursor: not-allowed; color: #bfbfbf; }

      /* 行内编辑框：tab（套餐名 / 对外展示名）→ 输入框 + 暂存/取消 → 底部提示 */
      .hlj-bd-ed { display: flex; flex-direction: column; gap: 5px; width: 100%; }
      .hlj-bd-tabs { display: flex; align-items: center; gap: 14px; }
      .hlj-bd-tab {
        padding: 0 0 1px; border: 0; border-bottom: 1px solid transparent; background: none;
        color: #8c8c8c; font-size: 11.5px; line-height: 17px; cursor: pointer;
        font-family: inherit;
      }
      .hlj-bd-tab:hover { color: #1677ff; }
      .hlj-bd-tab.is-on { color: #1677ff; border-bottom-color: #1677ff; font-weight: 600; }
      .hlj-bd-ed-row { display: flex; align-items: center; gap: 6px; }
      .hlj-bd-ed-row input {
        flex: 1; min-width: 0; height: 26px; padding: 0 8px;
        border: 1px solid #1677ff; border-radius: 5px; font-size: 13px; color: #262626;
        /* 必须显式写底色：宿主页给 input 设了浅绿底，不覆盖就会串色 */
        background: #fff;
        box-sizing: border-box; font-family: inherit;
      }
      .hlj-bd-ed-row button {
        flex: none; height: 26px; padding: 0 10px; border-radius: 5px;
        border: 1px solid #d9d9d9; background: #fff; color: #404040;
        font-size: 12px; cursor: pointer; font-family: inherit;
      }
      .hlj-bd-ed-row button.is-primary {
        background: #1677ff; border-color: #1677ff; color: #fff; font-weight: 500;
      }
      .hlj-bd-ed-row button:hover { border-color: #4096ff; color: #1677ff; }
      .hlj-bd-ed-row button.is-primary:hover { background: #4096ff; border-color: #4096ff; color: #fff; }
      .hlj-bd-ed-row button:disabled { opacity: .45; cursor: not-allowed; }
      .hlj-bd-ed-foot { display: flex; align-items: center; gap: 8px; min-height: 15px; }
      .hlj-bd-preview {
        flex: 1; min-width: 0; font-size: 11px; color: #d46b08;
        word-break: break-all; line-height: 15px;
      }
      /* 「整串改名 / 改回中间段」是链接而不是按钮 —— 一行里少一个方块 */
      .hlj-bd-nmlink {
        flex: none; padding: 0; border: 0; background: none; cursor: pointer;
        color: #8c8c8c; font-size: 11px; text-decoration: underline;
        font-family: inherit; white-space: nowrap;
      }
      .hlj-bd-nmlink:hover { color: #d46b08; }
      .hlj-bd-row.is-renaming { background: #f0f8ff; }

      /* 副行里的展示名（只在被单独设过 / 有待提交值时才出现） */
      .hlj-bd-aliasx { color: #d46b08; }
      .hlj-bd-pending { color: #d46b08; }

      /* ---------- 改名模式：整块换成"只改名"的视图 ---------- */
      /* 勾选、全选/清空/反选、删除按钮在改名模式下没有意义，收起来，列表才不挤 */
      #${IDS.panel}.is-rename #${IDS.list} .hlj-bd-row > input[type="checkbox"] { display: none; }
      #${IDS.panel}.is-rename #${IDS.toolbar} .hlj-bd-selgroup { display: none; }
      #${IDS.panel}.is-rename #${IDS.footer} button[data-act="del"] { display: none; }

      /* ---------- 改名草稿 / 撤回（1.1.5）---------- */
      /* 暂存态：名字后面跟一个箭头目标值 + 撤销链接，一眼看出"还没落库" */
      .hlj-bd-row.is-pending { background: #fffbe6; }
      .hlj-bd-plan { color: #d46b08; }
      .hlj-bd-undo, .hlj-bd-revert {
        padding: 0 4px; height: 18px; line-height: 18px;
        border: 0; border-radius: 3px; background: none;
        color: #d46b08; font-size: 11.5px; cursor: pointer;
        font-family: inherit; white-space: nowrap;
      }
      .hlj-bd-undo:hover { background: #fff1d6; }
      .hlj-bd-revert { color: #595959; }
      .hlj-bd-revert:hover { background: #f0f0f0; color: #262626; }
      /* 有草稿时「提交改名」按钮变成主色，提醒还有东西没落库 */
      #${IDS.toolbar} button.is-commit {
        border-color: #d46b08; background: #d46b08; color: #fff; font-weight: 600;
      }
      #${IDS.toolbar} button.is-commit:hover:not(:disabled) { background: #fa8c16; border-color: #fa8c16; color: #fff; }

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

    // 加载门槛（红领巾 2026-09-22）：不可改套餐的订单，按钮压根不出现。
    // 已落单且没开「检中修改」时命中这里；订单状态后来变了（比如检中修改已提交）
    // 也会在下一拍把已经挂出去的按钮撤掉 —— 入口不能比权限活得久。
    if (gate.state !== true) {
      if (existing) existing.remove();
      return;
    }

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
    btn.title = '列出当前订单的套餐：勾选后批量删除；打开「改名模式」开关后就地改套餐名（已落单订单请走作废）';

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
        <span id="${IDS.title}">订单套餐删除 / 改名</span>
        <span class="hlj-bd-spacer"></span>
        <button id="${IDS.close}" type="button" title="关闭">×</button>
      </div>
      <div id="${IDS.meta}">正在读取订单…</div>
      <div id="${IDS.toolbar}">
        <span class="hlj-bd-selgroup">
          <button type="button" data-act="all">全选</button>
          <button type="button" data-act="none">清空</button>
          <button type="button" data-act="invert">反选</button>
        </span>
        <button type="button" data-act="reload">重新读取</button>
        <button type="button" data-act="rename" title="打开后才能改套餐名（默认关闭，防误改）">改名模式</button>
        <button type="button" data-act="renameSubmit" title="把暂存的改名一次提交（还没有暂存时不可点）">提交改名</button>
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
      // 改名入口（只有「改名模式」打开时才会渲染出来）
      //   1.1.7 起每行只有 .hlj-bd-edit 一个按钮，套餐名/对外展示名进框后切 tab
      const editBtn = e.target.closest('.hlj-bd-edit, .hlj-bd-edit-alias');
      if (editBtn) {
        e.preventDefault();
        startRename(editBtn.dataset.code, editBtn.dataset.field || 'name');
        return;
      }
      // 编辑框顶部的两个 tab：套餐名 / 对外展示名（1.1.7 —— 之前是两个独立按钮）
      const tab = e.target.closest('.hlj-bd-tab');
      if (tab) {
        e.preventDefault();
        switchRenameField(tab.dataset.field);
        return;
      }
      // 「改成整串 / 改回中间段」：降级成一个链接
      const nmBtn = e.target.closest('.hlj-bd-nmlink');
      if (nmBtn) {
        e.preventDefault();
        setRenameNameMode(nmBtn.dataset.namemode);
        return;
      }
      const okBtn = e.target.closest('.hlj-bd-rename-ok');
      if (okBtn) {
        e.preventDefault();
        stageRename(okBtn.dataset.code);
        return;
      }
      // 暂存态：撤销这一条（只丢草稿，不发请求）
      const undoBtn = e.target.closest('.hlj-bd-undo');
      if (undoBtn) {
        e.preventDefault();
        undoRename(undoBtn.dataset.code);
        return;
      }
      // 已提交：撤回原名（发一次反向 update，价格照旧不动）
      const revertBtn = e.target.closest('.hlj-bd-revert');
      if (revertBtn) {
        e.preventDefault();
        revertRename(revertBtn.dataset.code);
        return;
      }
      const cancelBtn = e.target.closest('.hlj-bd-rename-cancel');
      if (cancelBtn) {
        e.preventDefault();
        cancelRename();
        return;
      }
      const tag = e.target.closest('.hlj-bd-tag.is-clickable');
      if (!tag || !tag.dataset.type) return;
      toggleType(tag.dataset.type);
    });

    // 改名输入框：草稿存 state（后台检查会重绘列表，不存就丢字）+ 回车暂存 / Esc 取消
    $(IDS.list).addEventListener('input', (e) => {
      const inp = e.target;
      if (!inp || !inp.classList || !inp.classList.contains('hlj-bd-rename-input')) return;
      state.renameDraft = inp.value;
      const box = inp.closest('.hlj-bd-ed') || inp.parentElement;
      if (!box) return;
      // 可用性/预览都按"最终会存成什么"算 —— 中间段模式下输入里不带前后缀也算合法
      const bx = renameBoxState(inp.dataset.code, inp.value, inp.dataset.field);
      const btn = box.querySelector('.hlj-bd-rename-ok');
      if (btn) btn.disabled = !bx.ok;
      const pv = box.querySelector('.hlj-bd-preview');
      if (pv) pv.textContent = renamePreviewText(bx, inp.value);
    });
    $(IDS.list).addEventListener('keydown', (e) => {
      const inp = e.target;
      if (!inp || !inp.classList || !inp.classList.contains('hlj-bd-rename-input')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        stageRename(inp.dataset.code);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRename();
      }
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
    // 门槛最后一闸：按钮已经不挂了，但面板还可能被其他路径唤起（比如切订单时面板是开着的）
    if (gate.state !== true) {
      console.warn(
        '[扁鹊-1.8] 当前订单不可改套餐（' + (gate.reason || '状态未判定') + '），面板不打开'
      );
      return;
    }
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
    const ps = info.process_status;
    let stCn = ORDER_STATUS_CN[st] || st || '未知';
    // 已落单要带上子状态 —— 「已落单」和「已落单 · 检中修改」的可编辑性完全不同
    if (st === 'SUBMITTED' && ps) stCn += ' · ' + (SUB_STATUS_CN[ps] || ps);
    el.innerHTML =
      '订单 <b>' + esc(state.orderCode) + '</b>' +
      (state.orderType ? '（' + esc(state.orderType) + '）' : '') +
      '<span class="hlj-bd-st' + (st === 'SUBMITTED' ? ' is-done' : '') + '">' + esc(stCn) + '</span>' +
      '<br><span>' + esc(info.order_name || '—') + '</span>' +
      // 只在当前模式下说当前模式的话 —— 之前两句话常驻，面板顶部永远是四行字
      (state.renameMode
        ? '<br><span style="color:#d46b08">改名视图：已隐藏作废 / 已删除的套餐；已体检的照样能改名（只是不能删）</span>'
        : '<br><span style="color:#8c8c8c">已作废的标灰不可选；要改名请先打开工具条上的「改名模式」</span>');
  }

  /**
   * 行内改名框（1.1.7）。
   * 顶部只有两个 tab（套餐名 / 对外展示名），「整串改名」也降级成一个链接 ——
   * 之前一行里挤着「改名 / 改 / 撤销 / 只改中间段 / 整串改名」五颗按钮，20 行就是 100 颗。
   */
  function renameEditorHtml(p) {
    const code = p.package_code;
    const isAlias = state.renameField === 'alias';
    const bx = renameBoxState(code, state.renameDraft, isAlias ? 'alias' : 'name');
    const tabHtml =
      '<span class="hlj-bd-tabs">' +
      '<button type="button" class="hlj-bd-tab' + (isAlias ? '' : ' is-on') + '" data-field="name"' +
      ' title="套餐名（业务口径）：默认只替换中间段，系统生成的前后缀原样保留">套餐名</button>' +
      '<button type="button" class="hlj-bd-tab' + (isAlias ? ' is-on' : '') + '" data-field="alias"' +
      ' title="对外展示名（小程序预约 / 导检单 / 报告封面用）：不受前后缀限制，留空 = 跟随套餐名">对外展示名</button>' +
      '</span>';
    const foot = isAlias
      ? '<div class="hlj-bd-ed-foot"><span class="hlj-bd-preview">留空 = 跟随套餐名；填什么存什么，不受前后缀限制</span></div>'
      : '<div class="hlj-bd-ed-foot">' +
        '<span class="hlj-bd-preview">' + esc(renamePreviewText(bx, state.renameDraft)) + '</span>' +
        '<button type="button" class="hlj-bd-nmlink" data-namemode="' + (bx.nm === 'mid' ? 'full' : 'mid') + '" title="' +
        (bx.nm === 'mid'
          ? '当前只改中间段；点这里改成按完整名字保存（连前后缀一起改，少数情况才用）'
          : '当前是整串改名；点这里改回只动中间段（前后缀还原成系统的）') + '">' +
        (bx.nm === 'mid' ? '改成整串' : '改回中间段') + '</button>' +
        '</div>';
    return (
      '<div class="hlj-bd-ed">' +
      tabHtml +
      '<div class="hlj-bd-ed-row">' +
      '<input type="text" class="hlj-bd-rename-input" data-code="' + esc(code) +
      '" data-field="' + (isAlias ? 'alias' : 'name') + '"' +
      ' value="' + esc(state.renameDraft) + '" maxlength="60" spellcheck="false" placeholder="' +
      (isAlias
        ? '留空 = 跟随套餐名'
        : (bx.nm === 'full' ? '完整套餐名（含前后缀）' : '只填中间段，首尾自动保留')) +
      '">' +
      '<button type="button" class="is-primary hlj-bd-rename-ok" data-code="' + esc(code) + '"' +
      (bx.ok ? '' : ' disabled') + '>暂存</button>' +
      '<button type="button" class="hlj-bd-rename-cancel" data-code="' + esc(code) + '">取消</button>' +
      '</div>' +
      foot +
      '</div>'
    );
  }

  function rowHtml(p) {
    const code = p.package_code;
    const type = p.package_type || '';
    const res = state.results.get(code);
    const done = !!res;

    // 体检名单状态（红领巾 2026-09-19 的硬要求：名单里有已检人员 → 不可删除）
    //   checks 里没有该 code  → undefined = 还在查，先不给勾
    //   checks.get(code) === null → 查询失败，状态未知，同样不给勾（宁可少删，不可错删）
    //   check_list_size > 0     → 有已检人员，不可删除
    //   ⚠️ 1.1.7 起**不再整行压灰**：它只是不能删，名字照样能改（红领巾 2026-10-26）
    const ck = state.checks.get(code);
    const bs = bindState(p);
    // 已作废的套餐：**仍然在 package/query 的返回里**（实测作废 13 条一条不少地返回），
    // 必须自己认出来，否则会当成「可删除」挂在列表上 —— 这正是红领巾 2026-09-22 提的问题。
    const voided = isVoid(p);
    // 作废的不去查体检名单：作废 + 有已检人员并不改变结论（都不可动），少发一个请求
    const checking = ck === undefined && !done && !voided;
    const unknown = ck === null && !done && !voided;
    const hasChecked = !!ck && ck.check_list_size > 0;
    // 绑定关系复杂（宿主主套餐还挂着别的包）→ 不敢自动解绑，只能挡在这里
    const bindHard = bs.bound && !bs.simple;
    const blocked = (hasChecked || bindHard || voided) && !done;
    const locked = blocked || checking || unknown;
    const checkCount = hasChecked ? ck.check_list_size : 0;

    const nums = [];
    if (p.cust_type) nums.push(CUST_CN[p.cust_type] || p.cust_type);
    if (p.pay_type) nums.push(p.pay_type === 'CORP_PAY' ? '公司挂账' : p.pay_type);
    if (p.estimate_count !== undefined && p.estimate_count !== null) nums.push(p.estimate_count + '人');
    if (p.sale_price !== undefined && p.sale_price !== null) nums.push('¥' + p.sale_price);

    // 状态只留一个小胶囊，挂在副行末尾。
    // 之前它单占右侧一列（"已体检 2 人，不可删除"），长名字被它挤成两行，整片看着就乱。
    // 优先级：删除结果 > 已作废 > 已体检 > 绑定复杂 > 检查中/未知
    let pill = '';
    if (res) {
      pill = '<span class="hlj-bd-pill ' + (res.ok ? 'ok' : 'fail') + '" title="' + esc(res.msg || '') + '">' +
        (res.ok ? '已删除' : '删除失败') + '</span>';
    } else if (voided) {
      pill = '<span class="hlj-bd-pill muted" title="该套餐' + esc(voidCn(p)) +
        '。本工具只处理有效套餐，作废的请回页面手工处理">' + esc(voidCn(p)) + '</span>';
    } else if (hasChecked) {
      pill = '<span class="hlj-bd-pill danger" title="' +
        esc(
          (ck.message || '体检名单中已有已检人员') +
            '（已检 ' + checkCount + ' 人，已约 ' + (ck.book_list_size || 0) +
            ' 人，待约 ' + (ck.unbook_list_size || 0) + ' 人）；只是不能删除，名字可以改'
        ) +
        '">已体检 ' + checkCount + ' 人' + (state.renameMode ? '' : ' · 不可删') + '</span>';
    } else if (bindHard) {
      const hosts = bs.binds
        .map((b) => b.hostName + '（该套餐还绑着 ' + b.hostBindCount + ' 个包）')
        .join('；');
      pill = '<span class="hlj-bd-pill danger" title="' +
        esc('被主套餐绑着：' + hosts + '。解绑会连带清空该主套餐的其他绑定，故不自动处理，请手工解绑后再删') +
        '">需先解绑</span>';
    } else if (checking) {
      pill = '<span class="hlj-bd-pill muted">检查中…</span>';
    } else if (unknown) {
      pill = '<span class="hlj-bd-pill muted" title="体检名单状态查询失败">状态未知</span>';
    }

    // 副行追加「↔ 绑定」提示：简单绑定会在删除时自动解绑，先让用户看得见
    let bindTip = '';
    if (!done && bs.bound && bs.simple) {
      bindTip =
        ' · <span class="hlj-bd-bind" title="' +
        esc('删除前会自动执行解绑（该主套餐只绑了这一个包）') +
        '">↔ 绑定在 ' + esc(bs.binds[0].hostName) + '</span>';
    }

    // 改名入口：只有「改名模式」开着、且这条可改（非作废/未删除）时才出现。
    // 名字本身永远保持"只读文本"，必须先点「改名」才进输入态 —— 防手滑（红领巾 2026-10-26）。
    const renamingThis = state.renaming === code;
    const renameAllowed = state.renameMode && canRename(p) && !state.busy;
    const aliasRaw =
      p.package_alias === undefined || p.package_alias === null ? '' : String(p.package_alias);
    // 展示名是否被「单独设过」：只有它不等于套餐名才算。
    // 等于套餐名（或为空）都视为「跟随套餐名」—— 改套餐名时会被一起改掉，跟页面行为一致。
    const aliasCustom = !!aliasRaw && aliasRaw !== p.package_name;
    // 草稿（还没落库）与可撤回记录（已经落库）：两种状态在行内表现要能区分开
    const patch = state.renamePlan.get(code) || null;
    const undo = state.undoMap.get(code) || null;
    const planName = patch && patch.name !== undefined ? patch.name : null;
    const planAlias = patch && patch.alias !== undefined ? patch.alias : null;
    // 改名模式下勾选是隐藏的，类型标签的「点一下全选这类」也就没意义了，别留个假入口
    const tagHtml = state.renameMode
      ? '<span class="hlj-bd-tag t-' + esc(type) + '">' + esc(TYPE_CN[type] || type) + '</span>'
      : '<span class="hlj-bd-tag t-' + esc(type) + ' is-clickable" data-type="' + esc(type) +
        '" title="点击：勾选/取消全部「' + esc(TYPE_CN[type] || type) + '」">' +
        esc(TYPE_CN[type] || type) + '</span>';

    // 副行尾巴：展示名只在"被单独设过 / 有待提交值"时补一句，跟随套餐名时什么都不显示
    let aliasNote = '';
    if (planAlias !== null) {
      aliasNote = ' · <span class="hlj-bd-pending">展示名 → ' +
        esc(planAlias || '跟随套餐名') + '</span>';
    } else if (planName !== null && !aliasCustom) {
      aliasNote = ' · <span class="hlj-bd-pending">展示名将跟随改为「' + esc(planName) + '」</span>';
    } else if (aliasCustom) {
      aliasNote = ' · <span class="hlj-bd-aliasx" title="对外展示名：小程序预约 / 导检单 / 报告封面用">展示名 ' +
        esc(aliasRaw) + '</span>';
    }

    let mainHtml;
    if (renamingThis) {
      mainHtml = renameEditorHtml(p);
    } else {
      // 每行最多一个写入口（改名）＋ 一个撤销/撤回；都做成文字按钮，行与行之间才不打架
      const acts = [];
      if (renameAllowed) {
        acts.push(
          '<button type="button" class="hlj-bd-edit" data-code="' + esc(code) +
          '" data-field="name" title="改套餐名 / 对外展示名（同一个输入框，进去后顶部切 tab）">改名</button>'
        );
      }
      if (state.renameMode && !state.busy) {
        if (patch) {
          acts.push(
            '<button type="button" class="hlj-bd-undo" data-code="' + esc(code) +
            '" title="撤销这条暂存的改名（不发请求，恢复成当前的名字）">撤销</button>'
          );
        } else if (undo) {
          acts.push(
            '<button type="button" class="hlj-bd-revert" data-code="' + esc(code) +
            '" title="把刚才这次改名改回「' + esc(undo.name) + '」（会发一次 update，价格照旧不动）">撤回原名</button>'
          );
        }
      }
      const planHtml = planName !== null
        ? '<span class="hlj-bd-plan"> → ' + esc(planName) + '</span>'
        : '';
      mainHtml =
        '<div class="hlj-bd-t1">' +
        tagHtml +
        '<span class="hlj-bd-title">' + esc(p.package_name) + planHtml + '</span>' +
        (acts.length ? '<span class="hlj-bd-acts">' + acts.join('') + '</span>' : '') +
        '</div>';
    }

    return (
      '<div class="hlj-bd-row' +
      (done ? ' is-done' : '') +
      (blocked && !voided ? ' is-blocked' : '') +
      (voided ? ' is-voided' : '') +
      (renamingThis ? ' is-renaming' : '') +
      (patch ? ' is-pending' : '') +
      '" data-code="' + esc(code) + '">' +
      '<input type="checkbox" data-code="' + esc(code) + '"' +
      (state.checked.has(code) ? ' checked' : '') +
      (done || locked || renamingThis ? ' disabled' : '') + '>' +
      '<div class="hlj-bd-main">' +
      mainHtml +
      '<div class="hlj-bd-sub">' + esc(code) +
      (nums.length ? ' · ' + esc(nums.join(' · ')) : '') +
      bindTip + (pill ? ' · ' + pill : '') + aliasNote +
      '</div>' +
      '</div></div>'
    );
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
    // 改名模式是"只改名"的视图：已作废的、本轮已删除的整条不显示（红领巾 2026-10-26）。
    // 删除模式照旧全列出来 —— 作废的是历史痕迹，删的时候得看得见。
    const list = state.renameMode ? state.packages.filter(canRename) : state.packages;
    if (!list.length) {
      box.innerHTML = '<div class="hlj-bd-empty">本单没有可改名的套餐<br><span style="font-size:11px">已作废 / 已删除的套餐在改名模式下不显示</span></div>';
      return;
    }
    // 按类型分组显示，和页面上「普通套餐 / 赠送套餐 / 加项包 / 赠送包」的分区一致
    const groups = new Map();
    list.forEach((p) => {
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
        '<div class="hlj-bd-grp">' +
        esc(TYPE_CN[t] || t) + '（' + arr.length + '）</div>';
      arr.forEach((p) => {
        html += rowHtml(p);
      });
    });
    box.innerHTML = html;
    // 重绘会重建输入框 → 焦点和光标都会丢。正在改名的那一行补回来
    if (state.renaming) {
      const inp = box.querySelector('.hlj-bd-rename-input');
      if (inp && document.activeElement !== inp) {
        inp.focus();
        const n = inp.value.length;
        try { inp.setSelectionRange(n, n); } catch (e) { /* 老浏览器没有就算了 */ }
      }
    }
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
   * 这条套餐能不能被勾选。不可选的五种情况：
   *   已经删过了 / 已经作废了 / 体检名单还在查 / 名单里有已检人员 / 被主套餐绑着且绑定关系复杂。
   * 「还在查」也算不可选 —— 结果没回来就让人勾，等于给了一个随时会反悔的选择。
   */
  function selectable(p) {
    const code = p.package_code;
    if (state.results.has(code)) return false;
    // 已作废：本工具只删有效套餐（页面上的作废残留请手工处理）
    if (isVoid(p)) return false;
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
    // 面板整体切到「改名视图」：勾选框、全选组、删除按钮都由 CSS 收起（1.1.7）
    const pnl = $(IDS.panel);
    if (pnl) pnl.classList.toggle('is-rename', !!state.renameMode);
    const cnt = box.querySelector('.hlj-bd-cnt');
    if (cnt) {
      if (!state.packages.length) {
        cnt.textContent = '';
      } else if (state.renameMode) {
        // 改名模式只数"能改的"，并说明藏了几条，免得以为套餐丢了
        const list = state.packages.filter(canRename);
        const hidden = state.packages.length - list.length;
        const byCheck = list.filter((p) => {
          const ck = state.checks.get(p.package_code);
          return !!ck && ck.check_list_size > 0;
        }).length;
        cnt.innerHTML =
          '可改名 ' + list.length + ' 条' +
          (byCheck ? ' · <b style="color:#cf1322">已体检 ' + byCheck + '</b>' : '') +
          (hidden ? ' · <span style="color:#bfbfbf">已隐藏 ' + hidden + ' 条（作废/已删）</span>' : '');
      } else {
        const byVoid = state.packages.filter(isVoid).length;
        const byCheck = state.packages.filter((p) => {
          if (isVoid(p)) return false; // 作废的不查名单，也不该混进「已体检」计数
          const ck = state.checks.get(p.package_code);
          return !!ck && ck.check_list_size > 0;
        }).length;
        const byBind = state.packages.filter((p) => {
          if (state.results.has(p.package_code) || isVoid(p)) return false;
          const bs = bindState(p);
          return bs.bound && !bs.simple;
        }).length;
        cnt.innerHTML =
          '共 ' + state.packages.length + ' 条' +
          (byVoid ? ' · <b style="color:#8c8c8c">已作废 ' + byVoid + '</b>' : '') +
          (byCheck ? ' · <b style="color:#cf1322">已体检 ' + byCheck + '</b>' : '') +
          (byBind ? ' · <b style="color:#cf1322">待解绑 ' + byBind + '</b>' : '') +
          ' · 已选 ' + state.checked.size;
      }
    }
    box.querySelectorAll('button').forEach((b) => {
      // 「重新读取」永远可用 —— 列表为空时最想点的就是它
      // 「提交改名」的可用性只看草稿数，下面单独算
      if (b.dataset.act === 'renameSubmit') return;
      b.disabled = state.busy || (b.dataset.act !== 'reload' && !state.packages.length);
    });
    // 「改名模式」是个开关，要把开/关状态显示出来，否则用户不知道自己有没有打开
    const rn = box.querySelector('button[data-act="rename"]');
    if (rn) {
      rn.classList.toggle('is-on', state.renameMode);
      rn.textContent = state.renameMode ? '改名模式·开' : '改名模式';
      rn.title = state.renameMode
        ? '当前是改名视图：已作废 / 已删除的套餐不显示，勾选与删除也收起；点此关闭回到删除视图'
        : '打开后才能改套餐名 / 对外展示名（默认关闭，防误改）';
    }
    // 「提交改名（N）」：把草稿数摆出来，避免"改完以为已经存了"
    const sub = box.querySelector('button[data-act="renameSubmit"]');
    if (sub) {
      const n = state.renamePlan.size;
      // 删除视图里「提交改名」没意义，没草稿时直接收起来 —— 工具条少一颗是一颗
      sub.style.display = state.renameMode || n > 0 ? '' : 'none';
      sub.textContent = n ? '提交改名（' + n + '）' : '提交改名';
      sub.disabled = state.busy || n === 0;
      sub.classList.toggle('is-commit', n > 0 && !state.busy);
      sub.title = n
        ? '把暂存的 ' + n + ' 条改名一次提交：逐条现读详情后整份回写，遇错即停，剩下的草稿留着'
        : '还没有暂存的改名（先在列表里改，回车即暂存）';
    }
  }

  function paintFooter() {
    const box = $(IDS.footer);
    if (!box) return;
    const sum = box.querySelector('.hlj-bd-sum');
    const del = box.querySelector('button[data-act="del"]');
    const n = state.checked.size;

    if (sum) {
      if (state.renameMode) {
        // 改名模式下没有勾选/删除，底部只留一句"怎么回去"
        sum.innerHTML =
          state.renamePlan.size
            ? '待提交 <b style="color:#d46b08">' + state.renamePlan.size + '</b> 条改名'
            : '<span style="color:#8c8c8c">改名模式：勾选 / 删除已收起，关掉开关即回到删除视图</span>';
      } else {
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
    // 正在改名时不要重绘：后台体检名单还在回来，重绘会把用户正在敲的字打断
    if (state.renaming) return;
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
    if (act === 'rename') {
      toggleRenameMode();
      return;
    }
    if (act === 'renameSubmit') {
      submitRenamePlan();
      return;
    }
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
  // 11. 改名（1.1.2 新增）
  // ============================================================

  /**
   * 开关「改名模式」。**默认关**，关着时列表里连改名入口都没有 ——
   * 套餐名是业务口径（含危害因素 / 体检阶段 / 性别），名字改错比删错更难发现，
   * 所以不给"名字直接可点"的随手路径（红领巾 2026-10-26 明确要求）。
   */
  function toggleRenameMode() {
    state.renameMode = !state.renameMode;
    state.renaming = null;
    state.renameDraft = '';
    state.renameField = 'name';
    paintAll(); // 顶栏说明、列表过滤、底部按钮都随模式变，整块重绘
    log(
      state.renameMode
        ? '改名模式已打开：已作废 / 已删除的套餐不再显示，勾选与删除收起，每行只剩一个「改名」'
        : '改名模式已关闭：回到删除视图（作废的会重新显示出来）',
      state.renameMode ? 'warn' : 'hint'
    );
    if (state.renameMode) {
      log('点「改名」→ 输入框顶部可切「套餐名 / 对外展示名」；回车或点「暂存」都只是记草稿', 'hint');
      log('套餐名默认「只改中间段」：首段（如 26测试专用-）和末段（如 -男 / -女已婚 / -赠送包）由系统生成，原样保留；要动前后缀点输入框下方的「改成整串」', 'warn');
      log('对外展示名不受前后缀限制：填什么存什么，留空 = 跟随套餐名', 'hint');
      log('改完点工具条「提交改名（N）」才真正落库；单条点「撤销」即丢弃草稿', 'warn');
      log('改名走接口：不会弹「是否替换为促销价」，折扣按现有原样保留；提交后会逐条核对价格没变', 'hint');
      if (state.renamePlan.size) {
        log('当前还有 ' + state.renamePlan.size + ' 条改名没提交，别关面板前忘了点「提交改名」', 'err');
      }
    }
  }

  /** 这条能不能改名：已删除的、已作废的不行；已体检的可以（名字不影响名单与收入） */
  function canRename(p) {
    if (!p || !p.package_code) return false;
    if (state.results.has(p.package_code)) return false; // 本轮已删除
    if (isVoid(p)) return false; // 已作废，与删除同口径不给动
    return true;
  }

  /** 名称合法性 —— 照抄页面校验：不能为空、不能含空格（含全角空格） */
  function canSubmitName(v) {
    const raw = String(v === undefined || v === null ? '' : v);
    if (!raw.trim()) return false;
    if (/\s/.test(raw)) return false;
    if (/[\u3000]/.test(raw)) return false;
    return true;
  }

  // ============================================================
  // 11.1 套餐名的「系统前后缀」（1.1.6）
  // ============================================================

  /**
   * 套餐名是系统按「前缀 + 中间段 + 后缀」拼出来的（红领巾 2026-10-26）：
   *   前缀 = 首段，如 `24测试专用-` / `26测试专用-`（批次/项目）
   *   后缀 = 末段，如 `-男` / `-女未婚` / `-女已婚` / `-赠送包`（性别、包类型）
   * 真正要人工调的只有中间那段（危害因素 + 体检阶段），前后缀由系统维护。
   *
   * ⚠️ 接口不返回这两个字段，只能从现有名字里切。切法（实测 20 条全对）：
   *   ≥3 段            → 首段是前缀、末段是后缀
   *   2 段且末段是已知后缀 → 没有前缀，首段就是中间段
   *   2 段但末段不是后缀  → 首段当前缀（宁可多留一段，也不把中间段吞掉）
   *   1 段              → 没有前后缀
   */
  const PKG_NAME_SUFFIXES = ['男', '女', '男未婚', '女未婚', '男已婚', '女已婚', '未知', '赠送包', '赠送套餐'];

  function splitPkgName(name) {
    const raw = String(name === undefined || name === null ? '' : name);
    const segs = raw.split('-');
    if (segs.length < 2) return { prefix: '', mid: raw, suffix: '' };
    const last = segs[segs.length - 1];
    const lastIsSuffix = segs.length >= 3 || PKG_NAME_SUFFIXES.indexOf(last) >= 0;
    if (!lastIsSuffix) {
      return { prefix: segs[0] + '-', mid: segs.slice(1).join('-'), suffix: '' };
    }
    if (segs.length === 2) return { prefix: '', mid: segs[0], suffix: '-' + last };
    return { prefix: segs[0] + '-', mid: segs.slice(1, -1).join('-'), suffix: '-' + last };
  }

  /**
   * 按当前模式把输入拆开、再拼出最终要保存的套餐名。
   *   mode='full' → 输入什么就是什么（整串改名，唯一能改前后缀的口子）
   *   mode='mid'  → 按"-"分段后：首段若等于原前缀就去掉，末段若等于原后缀（或任意已知后缀）也去掉，
   *                 剩下的当中间段，再统一用「原前缀 + 中间段 + 原后缀」重建
   *                 ⇒ 只敲中间段、或把整串粘进来，结果一致；也不会出现 `-男-男`
   *   ⚠️ 一开始用字符串 startsWith/endsWith 做，`26测试专用-男`（用户把中间段删空）会拼成
   *      `26测试专用-男-男`；改成分段比对后，这种情况会得到空中间段 → 由调用方判为非法。
   */
  function composePkgNameParts(draft, baseName, mode) {
    const s = String(draft === undefined || draft === null ? '' : draft).trim();
    if (mode === 'full') return { prefix: '', mid: s, suffix: '', full: s };

    const base = splitPkgName(baseName);
    const segs = s.split('-');
    if (base.prefix) {
      const head = base.prefix.slice(0, -1); // '26测试专用-' → '26测试专用'
      if (segs.length && segs[0] === head) segs.shift();
    }
    if (segs.length) {
      const last = segs[segs.length - 1];
      const isBaseSuffix = !!base.suffix && last === base.suffix.slice(1);
      if (isBaseSuffix || (segs.length >= 2 && PKG_NAME_SUFFIXES.indexOf(last) >= 0)) segs.pop();
    }
    const mid = segs.join('-');
    return { prefix: base.prefix, mid: mid, suffix: base.suffix, full: base.prefix + mid + base.suffix };
  }

  /** 改名输入框的即时状态：最终会存成什么、能不能暂存 */
  function renameBoxState(code, draft, field) {
    const p = state.packages.find((x) => x.package_code === code);
    const isAlias = field === 'alias';
    const nm = state.renameNameMode === 'full' ? 'full' : 'mid';
    const parts = isAlias
      ? { prefix: '', mid: String(draft || ''), suffix: '', full: String(draft || '') }
      : composePkgNameParts(draft, p ? p.package_name : '', nm);
    let ok;
    if (isAlias) ok = true; // 展示名允许留空（= 跟随套餐名），也允许空格
    else if (nm === 'full') ok = canSubmitName(parts.full);
    else ok = !!parts.mid.trim() && canSubmitName(parts.full); // 中间段不能空
    return { isAlias: isAlias, nm: nm, composed: parts.full, mid: parts.mid, ok: ok };
  }

  /** 输入框下面那行小字：中间段为空就提示，拼回来的名字和输入不一致就显示最终值 */
  function renamePreviewText(bx, draft) {
    if (bx.isAlias || bx.nm !== 'mid') return '';
    if (!bx.mid.trim()) return '中间段不能为空（首段/末段由系统保留）';
    return bx.composed !== String(draft === undefined || draft === null ? '' : draft).trim()
      ? '将保存为「' + bx.composed + '」'
      : '';
  }

  /** 切换「只改中间段 / 整串改名」—— 只影响套餐名，对外展示名不受限 */
  function setRenameNameMode(mode) {
    const m = mode === 'full' ? 'full' : 'mid';
    if (state.renameNameMode === m) return;
    state.renameNameMode = m;
    paintList(); // 重绘会重建输入框，paintList 里会把焦点和光标补回去
    log(
      m === 'mid'
        ? '已切到「只改中间段」：首段/末段由系统生成，按原样保留（输入里带了也会被还原）'
        : '已切到「整串改名」：输入什么就存什么，前后缀也会一起改 —— 只在确实要动前后缀时用',
      'warn'
    );
  }

  /**
   * 某个字段在输入框里应该预填什么。
   *   有草稿就填草稿值 —— 二次编辑不该把刚改的名字又倒回去；
   *   没草稿就填当前值（展示名为空 = 跟随套餐名，框里也留空，让人看清现状）
   */
  function draftFor(p, field, patch) {
    if (field === 'alias') {
      return patch && patch.alias !== undefined ? patch.alias : String(p.package_alias || '');
    }
    return patch && patch.name !== undefined ? patch.name : String(p.package_name || '');
  }

  /**
   * 进入改名态。
   *   field='name'  → 改 package_name 套餐名（默认）
   *   field='alias' → 改 package_alias 对外展示名（同一输入框，顶部 tab 切过去）
   */
  function startRename(code, field) {
    if (state.busy || !code) return;
    const p = state.packages.find((x) => x.package_code === code);
    if (!p || !canRename(p)) return;
    const f = field === 'alias' ? 'alias' : 'name';
    state.armed = false; // 进改名态就把删除的二次确认撤掉，防两种危险操作叠在一起
    state.renaming = code;
    state.renameField = f;
    state.renameDraft = draftFor(p, f, state.renamePlan.get(code) || null);
    paintList();
    paintFooter();
  }

  /** 编辑框顶部切 tab：套餐名 ⇄ 对外展示名（1.1.7 把两个入口合成一个） */
  function switchRenameField(field) {
    if (!state.renaming) return;
    const f = field === 'alias' ? 'alias' : 'name';
    if (state.renameField === f) return;
    const p = state.packages.find((x) => x.package_code === state.renaming);
    if (!p) return;
    state.renameField = f;
    state.renameDraft = draftFor(p, f, state.renamePlan.get(state.renaming) || null);
    paintList();
  }

  function cancelRename() {
    if (!state.renaming) return;
    state.renaming = null;
    state.renameField = 'name';
    state.renameDraft = '';
    paintList();
  }

  async function fetchPackageDetail(code) {
    const j = await apiPost(API.pkgDetail, { code: code });
    if (!isOk(j) || !j.data) throw new Error('读取套餐详情失败：' + errText(j));
    return j.data;
  }

  /**
   * 拼「改名」用的整份 body。
   *
   * ⚠️ package/update 是全量重写（不是只认 name 的补丁接口），所以每个字段都得从
   *    detail 原样搬过来。字段清单来自 2026-10-26 抓的真实请求，逐项对过：
   *      sku_codes      ← product_items（price 转字符串、sequence 从 1 起）
   *                        innovation 优先用 detail 里的原值（创新组合/快捷组合挂在这一项上），
   *                        detail 没给才填空数组 —— 别一律写 []，那是把组合关系抹掉
   *      discount_request ← product_items 的 discount_price（-99 即"无折扣"，对应 use_original:true）
   *                        ⚠️ 这一段就是页面那个「是否替换为促销价」弹窗的产物：
   *                        原样回传 = 不替换促销价、按现有价格保存
   *      pay_type       ← detail.pay_type；赠送包页面会强制成 SELF_PAY，这里照抄
   *
   * 名字有两个字段（2026-10-26 实测，别再搞混）：
   *      package_name  套餐名，业务口径，列表/报价单上显示的就是它
   *      package_alias 对外展示名，小程序预约 / 导检单 / 报告封面用
   *   页面自己的做法是「alias 永远等于 name」（chunk 原文 e.package_alias=e.package_name=o），
   *   但接口**不强制**：传什么就存什么，两个字段可以完全不一样。
   *   所以这里由调用方决定 alias 传什么，别在函数里写死。
   *   ⚠️ 后端把「空串 / null / 不传」一律当成**不修改**（实测传空清不掉已有展示名），
   *      要"reset 成跟随套餐名"只能传套餐名本身。
   */
  function buildUpdateBody(d, newName, newAlias, orderCode) {
    const items = Array.isArray(d.product_items) ? d.product_items : [];
    const body = {
      order_code: orderCode,
      package_code: d.package_code,
      package_name: newName,
      package_alias: newAlias,
      package_type: d.package_type,
      pay_type: d.pay_type,
      cust_type: d.cust_type,
      price: d.price,
      estimate_count: d.estimate_count,
      sku_codes: items.map((it, i) => ({
        sku_code: it.sku_code,
        price: String(it.price),
        sequence: i + 1,
        innovation: Array.isArray(it.innovation) ? it.innovation : [],
        mustCheckItem: it.mustCheckItem || 0,
      })),
      discount_request: items.map((it) => ({
        sku_code: it.sku_code,
        discount_price: it.discount_price === undefined || it.discount_price === null ? -99 : it.discount_price,
        use_original: it.discount_price === undefined || it.discount_price === null || it.discount_price === -99,
      })),
      medical_insurance_payment: !!d.medicalInsurancePayment,
      update_for_copy: false,
    };
    // 页面自己这一句：赠送包一律自费（防它把公司的付款方式带过去）
    if (body.package_type === 'GIVEPKG') body.pay_type = 'SELF_PAY';
    return body;
  }

  /**
   * 改完回读对比：名字对上、且**其它字段一个没动**才算干净。
   * 全量重写型接口最怕的就是"悄悄把别的字段清了"，所以这里宁可啰嗦也要逐项比。
   */
  function diffAfterRename(before, after, newName, newAlias) {
    const out = [];
    const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    if (String(after.package_name || '') !== newName) {
      out.push('名字回读成了「' + (after.package_name || '空') + '」');
    }
    // 展示名单独核：改套餐名时它要么跟着变，要么保持原样，不能出现第三种结果
    if (String(after.package_alias || '') !== String(newAlias || '')) {
      out.push('对外展示名回读成了「' + (after.package_alias || '空') + '」');
    }
    if (num(after.price) !== num(before.price)) {
      out.push('成交价 ' + num(before.price) + ' → ' + num(after.price));
    }
    if (num(after.sale_price) !== num(before.sale_price)) {
      out.push('面值 ' + num(before.sale_price) + ' → ' + num(after.sale_price));
    }
    // 展示价也要看：它是各项目 show_price 的合计，项目被换过就会跟着变
    if (num(after.show_price) !== num(before.show_price)) {
      out.push('展示价 ' + num(before.show_price) + ' → ' + num(after.show_price));
    }
    if (num(after.estimate_count) !== num(before.estimate_count)) {
      out.push('人数 ' + num(before.estimate_count) + ' → ' + num(after.estimate_count));
    }
    const bItems = Array.isArray(before.product_items) ? before.product_items : [];
    const aItems = Array.isArray(after.product_items) ? after.product_items : [];
    if (bItems.length !== aItems.length) {
      out.push('项目数 ' + bItems.length + ' → ' + aItems.length);
    }
    const bPrice = new Map(bItems.map((x) => [x.sku_code, num(x.price)]));
    const bDisc = new Map(bItems.map((x) => [x.sku_code, num(x.discount_price)]));
    aItems.forEach((x) => {
      if (bPrice.has(x.sku_code) && bPrice.get(x.sku_code) !== num(x.price)) {
        out.push('项目 ' + x.sku_code + ' 单价 ' + bPrice.get(x.sku_code) + ' → ' + num(x.price));
      }
      // 折扣价被"替换成促销价"或被抹掉，都算异常 —— 改名不该动价格
      if (bDisc.has(x.sku_code) && bDisc.get(x.sku_code) !== num(x.discount_price)) {
        out.push('项目 ' + x.sku_code + ' 折扣价 ' + bDisc.get(x.sku_code) + ' → ' + num(x.discount_price));
      }
    });
    return out;
  }

  // ---------- 1.1.5：先改草稿、后统一提交 ----------

  /**
   * 把「输入框里的这次修改」写进草稿表 —— **不发请求**。
   *
   * 为什么不再"回车即落库"（红领巾 2026-10-26 问的就是这个）：
   *   package/update 是全量重写，每敲一次回车就等于在真实数据上落一版；
   *   而改名最容易错的恰恰是名字本身（少个危害因素后缀、把"男"改成"女"）。
   *   二十条逐个落库，改到第 15 条才发现前 14 条都写错了，就得逐条再改一遍。
   *   先草稿后提交：能在列表里一屏审完「旧名 → 新名」再动手，单条还能直接撤销。
   */
  function stageRename(code) {
    if (state.busy || !code) return;
    const p = state.packages.find((x) => x.package_code === code);
    if (!p) return;

    const field = state.renameField === 'alias' ? 'alias' : 'name';
    const draft = String(state.renameDraft || '');
    const nm = state.renameNameMode === 'full' ? 'full' : 'mid';
    let nextName = draft;

    if (field === 'name') {
      // 只改中间段：把输入里带的前后缀剥掉，再用系统原前缀/原后缀重建
      const parts = composePkgNameParts(draft, p.package_name, nm);
      nextName = parts.full;
      if (nm === 'mid' && !parts.mid.trim()) {
        log('「只改中间段」时中间段不能为空（首段/末段是系统生成的，别一起删）—— 没有暂存', 'err');
        return;
      }
      if (!canSubmitName(nextName)) {
        log('套餐名不能为空、不能含空格 —— 没有暂存', 'err');
        return;
      }
    } else if (/[\r\n]/.test(draft)) {
      log('对外展示名不能含换行 —— 没有暂存', 'err');
      return;
    }

    const patch = Object.assign({}, state.renamePlan.get(code) || {});
    if (field === 'name') {
      if (nextName === p.package_name) delete patch.name; // 改回当前值 = 这条不用改了
      else patch.name = nextName;
    } else {
      const cur =
        p.package_alias === undefined || p.package_alias === null ? '' : String(p.package_alias);
      const v = draft.trim();
      if (v === cur) delete patch.alias;
      else patch.alias = v; // 空串 = 回到「跟随套餐名」
    }

    const empty = patch.name === undefined && patch.alias === undefined;
    if (empty) state.renamePlan.delete(code);
    else state.renamePlan.set(code, patch);

    state.renaming = null;
    state.renameField = 'name';
    state.renameDraft = '';
    paintList();
    paintToolbar();
    paintFooter();

    if (empty) {
      log('这条没有变化，已从待提交列表里移掉', 'hint');
      return;
    }
    const bits = splitPkgName(p.package_name);
    const keepNote =
      patch.name !== undefined && nm === 'mid' && (bits.prefix || bits.suffix)
        ? '（保留' + (bits.prefix ? '前缀 ' + bits.prefix : '') +
          (bits.prefix && bits.suffix ? '、' : '') +
          (bits.suffix ? '后缀 ' + bits.suffix : '') + '）'
        : '';
    log(
      '已暂存：' + p.package_name +
        (patch.name !== undefined ? ' → ' + patch.name + keepNote : '') +
        (patch.alias !== undefined ? '（展示名 → ' + (patch.alias || '跟随套餐名') + '）' : '') +
        '　还没落库，点工具条「提交改名（' + state.renamePlan.size + '）」才生效',
      'warn'
    );
  }

  /** 撤销某条草稿：只从待提交表里删，一条请求都不发 */
  function undoRename(code) {
    if (state.busy || !code) return;
    const patch = state.renamePlan.get(code);
    if (!patch) return;
    const p = state.packages.find((x) => x.package_code === code);
    state.renamePlan.delete(code);
    if (state.renaming === code) {
      state.renaming = null;
      state.renameField = 'name';
      state.renameDraft = '';
    }
    paintList();
    paintToolbar();
    paintFooter();
    log(
      '已撤销「' + ((p && p.package_name) || code) + '」的暂存改名，没发任何请求' +
        (state.renamePlan.size ? '（还剩 ' + state.renamePlan.size + ' 条待提交）' : '（待提交已清空）'),
      'hint'
    );
  }

  /**
   * 由「提交这一刻的真实值 + 草稿」算出这次要写成什么。
   *   改套餐名：对外展示名为空或等于旧套餐名（= 没单独设过）就跟着改，单独设过则原样保留
   *             —— 避免"单独设过对外名、改个套餐名把它冲掉"（2026-10-26 实测出来的坑）
   *   只改展示名：留空 = 回到「跟随套餐名」（后端把空串当"不修改"，只能显式传套餐名）
   */
  function resolveRenameTarget(before, patch, fallbackName) {
    const baseName = String(before.package_name || fallbackName || '');
    const baseAlias =
      before.package_alias === undefined || before.package_alias === null
        ? ''
        : String(before.package_alias);
    let nextName = baseName;
    let nextAlias = baseAlias;
    let note = '';

    if (patch.name !== undefined) {
      nextName = String(patch.name);
      if (patch.alias !== undefined) {
        nextAlias = String(patch.alias || '').trim() || nextName;
        note = '对外展示名同时改为「' + nextAlias + '」';
      } else if (!baseAlias || baseAlias === baseName) {
        nextAlias = nextName;
        note = '对外展示名跟着改为「' + nextName + '」';
      } else {
        note = '对外展示名是单独设过的（' + baseAlias + '），保持不变';
      }
    } else if (patch.alias !== undefined) {
      const v = String(patch.alias || '').trim();
      nextAlias = v || baseName;
      note = v ? '只改对外展示名：「' + v + '」' : '对外展示名回到跟随套餐名';
    }
    return { baseName: baseName, baseAlias: baseAlias, nextName: nextName, nextAlias: nextAlias, note: note };
  }

  /**
   * 真正落库的一条：现读详情 → 预检 → 整份回写 → 回读核对。
   *
   * 草稿里只存"名字要改成什么"，价格/项目永远取**提交这一刻**的详情 ——
   * 所以暂存放一会儿再提交，也不会拿旧快照把别人后来改的内容覆盖掉。
   */
  async function applyRename(code, patch) {
    const p = state.packages.find((x) => x.package_code === code) || null;
    const before = await fetchPackageDetail(code); // ① 现读，不用草稿里的旧值
    const t = resolveRenameTarget(before, patch, p && p.package_name);

    if (t.nextName === t.baseName && t.nextAlias === t.baseAlias) {
      return { skipped: true, before: before };
    }

    log(
      (patch.name !== undefined
        ? '改名：' + t.baseName + ' → ' + t.nextName
        : '改展示名：' + (t.baseAlias || '(跟随)') + ' → ' + t.nextAlias) +
        '　' + t.note,
      'warn'
    );

    // ② 预检（页面点「保存套餐」后打的第一枪就是它）
    //    flag==='fail' 不是错误，是「存在已到检或已预约的客户，确认要继续修改套餐吗？」
    //    —— 页面上要人点一次确定；脚本这边改名不动体检内容，照常往下走，只把人数报出来。
    let precheck = null;
    try {
      const chk = await apiPost(API.pkgCheck, { package_code: code });
      if (!isOk(chk)) throw new Error(errText(chk)); // 这条才是真拦：预检本身失败就别改
      precheck = chk.data || null;
    } catch (e) {
      throw new Error('保存前预检没过：' + (e.message || e));
    }
    const seenN = precheck
      ? (Number(precheck.check_list_size) || 0) + (Number(precheck.book_list_size) || 0)
      : 0;
    if (precheck && precheck.flag === 'fail' && seenN > 0) {
      log(
        '  该套餐已有 ' + seenN + ' 人' +
          (Number(precheck.book_list_size) ? '预约/到检' : '到检') +
          '，页面这时会弹「确认要继续修改套餐吗」。改名不影响他们的体检内容，继续。',
        'hint'
      );
    }

    // ③ 发整份 body，只换名字
    const j = await apiPost(API.pkgUpdate, buildUpdateBody(before, t.nextName, t.nextAlias, state.orderCode));
    if (!isOk(j)) throw new Error(errText(j));

    // ④ 回读核对：名字对了、其它字段没被改坏
    const after = await fetchPackageDetail(code);
    const diff = diffAfterRename(before, after, t.nextName, t.nextAlias);
    if (p) {
      p.package_name = after.package_name || t.nextName;
      p.package_alias =
        after.package_alias === undefined || after.package_alias === null
          ? ''
          : after.package_alias;
      // 绑定提示里显示的是主套餐名，跟着一起换，免得列表里出现"改完还显示旧名字"
      state.binds.forEach((arr) => {
        arr.forEach((b) => {
          if (b.hostCode === code) b.hostName = p.package_name;
        });
      });
    }
    // 记下提交前的值 —— 只有真的改成功了，才谈得上「撤回原名」
    state.undoMap.set(code, { name: t.baseName, alias: t.baseAlias });
    return {
      before: before,
      after: after,
      diff: diff,
      name: p ? p.package_name : t.nextName,
      alias: p ? p.package_alias : t.nextAlias,
    };
  }

  /**
   * 提交全部草稿。串行 + 每条现读 + 遇错即停。
   *
   * 为什么不并发：update 是全量重写，同一订单的多条同时写，出问题根本分不清是谁覆盖了谁；
   * 串行下每条失败都能明确指出是哪一条、什么原因、剩下几条还没动。
   * 为什么不每条都调 order/evaluate：它只按当前数据重算订单收入，整批完调一次结果等价。
   */
  async function submitRenamePlan() {
    if (state.busy) return;

    // 已作废 / 已删除的草稿先清掉，别永远挂在「待提交」里
    const dropped = [...state.renamePlan.keys()].filter((c) => {
      const p = state.packages.find((x) => x.package_code === c);
      return !p || !canRename(p);
    });
    dropped.forEach((c) => state.renamePlan.delete(c));

    const codes = [...state.renamePlan.keys()];
    if (!codes.length) {
      paintToolbar();
      log(
        dropped.length
          ? '没有可提交的改名：' + dropped.length + ' 条已作废/已删除，草稿已清掉'
          : '没有待提交的改名',
        'hint'
      );
      return;
    }

    state.busy = true;
    state.renaming = null;
    state.renameField = 'name';
    state.renameDraft = '';
    paintList();
    paintToolbar();
    paintFooter();

    let ok = 0;
    let changed = 0;
    let stopMsg = '';
    log(
      '开始提交 ' + codes.length + ' 条改名：串行执行，每条现读详情后整份回写，遇错即停' +
        (dropped.length ? '（' + dropped.length + ' 条已作废/已删除，未提交）' : ''),
      'warn'
    );

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const p = state.packages.find((x) => x.package_code === code);
      const patch = state.renamePlan.get(code);
      log('（' + (i + 1) + '/' + codes.length + '）' + ((p && p.package_name) || code) + ' …', 'hint');
      try {
        const r = await applyRename(code, patch);
        state.renamePlan.delete(code);
        if (r.skipped) {
          log('  名字已经是目标值，跳过', 'hint');
        } else {
          ok++;
          changed++;
          if (r.diff.length) {
            log('  名字已改，但这些字段和改前不一致，请回页面核对：' + r.diff.join('；'), 'err');
          } else {
            log(
              '  成功 → ' + r.name +
                (r.alias && r.alias !== r.name ? '（对外展示名 ' + r.alias + '）' : '') +
                '　价格/面值/项目均未变',
              'ok'
            );
          }
        }
        paintList();
        paintToolbar();
      } catch (e) {
        stopMsg = ((p && p.package_name) || code) + '：' + (e.message || e);
        log('  失败：' + (e.message || e), 'err');
        break; // 失败即停：原因没搞清之前继续写，只会在真实数据上多留一个半成品
      }
    }

    // 订单收入重算：整批只调一次（页面是每保存一次调一次，最终结果等价，省掉 N-1 次重算）
    if (changed) {
      try {
        await apiPost(API.orderEvaluate, { order_code: state.orderCode });
      } catch (e) { /* 不影响改名结果，忽略 */ }
    }

    state.busy = false;
    paintList();
    paintToolbar();
    paintFooter();

    const left = state.renamePlan.size;
    if (ok && !stopMsg) {
      log('批量改名完成：成功 ' + ok + ' 条' + (left ? '，另有 ' + left + ' 条没提交' : ''), 'ok');
      log('页面表格是页面自己的数据，按 F5 或点「刷新页面」才能看到新名字', 'hint');
    } else if (stopMsg) {
      log(
        '批量改名中断：成功 ' + ok + ' 条，失败 1 条（' + stopMsg + '）；' +
          '剩余 ' + left + ' 条仍在待提交里，处理好后可再点「提交改名」',
        'err'
      );
    } else {
      log('一条也没提交成功，' + left + ' 条还在待提交里', 'err');
    }
    if (ok) log('改错了不要紧：该套餐行内有「撤回原名」，可一键改回提交前的名字', 'hint');
  }

  /** 撤回：把上一次提交的改名改回去（同一条 update，价格照旧不动） */
  async function revertRename(code) {
    if (state.busy || !code) return;
    const u = state.undoMap.get(code);
    if (!u) return;
    const p = state.packages.find((x) => x.package_code === code);
    if (!p || !canRename(p)) {
      log('这条现在不能改了（已作废/已删除），撤回取消', 'err');
      return;
    }

    state.busy = true;
    paintList();
    paintToolbar();
    paintFooter();
    try {
      const r = await applyRename(code, { name: u.name, alias: u.alias });
      if (r.skipped) {
        state.undoMap.delete(code);
        log('当前名字已经是提交前的值，无需撤回', 'hint');
      } else {
        state.undoMap.delete(code);
        if (r.diff.length) {
          log('[撤回] 已改回「' + r.name + '」，但这些字段和改前不一致：' + r.diff.join('；'), 'err');
        } else {
          log('[撤回] 已恢复为「' + r.name + '」（价格/面值/项目均未变）', 'ok');
        }
        try {
          await apiPost(API.orderEvaluate, { order_code: state.orderCode });
        } catch (e) { /* 忽略 */ }
        log('页面表格是页面自己的数据，按 F5 或点「刷新页面」才能看到', 'hint');
      }
    } catch (e) {
      log('[撤回] 失败：' + (e.message || e) + '　（原值还留着，可再点一次）', 'err');
    }
    state.busy = false;
    paintList();
    paintToolbar();
    paintFooter();
  }

  // ============================================================
  // 12. 主流程
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
    // 已作废的不查：作废 + 有已检人员并不改变结论（都不可动），省下的请求留给有效套餐
    const todo = list.filter(
      (p) =>
        !state.results.has(p.package_code) &&
        !state.checks.has(p.package_code) &&
        !isVoid(p)
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

      // 门槛二次校验：面板可能一直开着不动，而订单状态在别处被改了
      // （最典型的是「检中修改」提交之后 —— 那一刻套餐就不能再删了）。
      // 同步门槛状态并让按钮跟着消失，不能让入口比权限活得久。
      const guard = editableReason(info);
      gate.orderCode = state.orderCode;
      gate.status = info.status || '';
      gate.process = info.process_status || '';
      gate.state = guard.ok;
      gate.reason = guard.reason;
      if (!guard.ok) {
        state.busy = false;
        state.loaded = false;
        state.checked.clear();
        paintAll();
        log('该订单已不可改套餐：' + guard.reason + '（status=' + gate.status +
          ' process_status=' + gate.process + '）—— 工具已停用', 'err');
        closePanel();
        ensureSwitch(); // 撤掉工具箱里的入口
        return;
      }

      const list = await fetchPackages(state.orderCode);
      state.packages = list;
      state.binds = buildBinds(list); // 绑定关系就在这份列表里，不用额外请求
      // 清掉已经不存在的勾选（上一轮删掉的）
      const alive = new Set(list.map((p) => p.package_code));
      [...state.checked].forEach((c) => {
        if (!alive.has(c)) state.checked.delete(c);
      });
      // 草稿同理：只保留这单里还有效的套餐（已作废的连草稿一起丢，与"不给改名"同口径）
      [...state.renamePlan.keys()].forEach((c) => {
        const hit = list.find((p) => p.package_code === c);
        if (!hit || isVoid(hit)) state.renamePlan.delete(c);
      });
      [...state.undoMap.keys()].forEach((c) => {
        if (!alive.has(c)) state.undoMap.delete(c);
      });
      state.loaded = true;
      state.busy = false;
      state.armed = false;
      paintAll();
      const stCn = ORDER_STATUS_CN[info.status] || info.status || '未知';
      const subCn = info.status === 'SUBMITTED' && info.process_status
        ? ' · ' + (SUB_STATUS_CN[info.process_status] || info.process_status)
        : '';
      const voidN = list.filter(isVoid).length;
      log('共 ' + list.length + ' 条套餐记录（订单状态：' + stCn + subCn + '）' +
        (voidN ? '，其中 ' + voidN + ' 条已作废、不参与删除' : ''), 'ok');

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
  // 13. 保活：SPA 重绘会冲掉注入的节点
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
      // 换了订单，门槛必须重判 —— 「落单前 / 检中修改 / 已落单」对工具是开是关完全不同
      refreshGate(true).then((ok) => {
        if (!ok) return;
        if (open) load();
        else paintAll();
      });
      return;
    }
    refreshGate(); // 同一订单内换页：带订单号缓存，不会重复发请求
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
    keepAlive(); // 这一拍 gate.state 还是 null，按钮不会挂 —— 等判定结果
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
    }
    // 启动时先认一下订单号（不发请求），面板打开时才真正读数据
    state.orderCode = currentOrderCode();
    console.log('[扁鹊-1.8] 订单套餐批量删除 v' + VERSION + ' 已就绪，订单：' + (state.orderCode || '未识别'));
    // 门槛：判定通过才把按钮挂出去。不可改套餐的订单（已落单且未开检中修改），工具整体不出现。
    refreshGate(true);
  }

  // 逃生口：口径万一不准（比如前端将来加了新的订单状态值），
  // 控制台执行 window.__hlj_pkg_batch_del_v100.force() 可强制挂载。
  window[NS] = {
    version: VERSION,
    gate: gate,
    state: state,
    refreshGate: refreshGate,
    // 改名：控制台可用（排查 / 批量脚本用），界面上走「改名模式」开关
    // 控制台直调：先设 state.renameDraft，再 rename(code[, 'name'|'alias']) → 只暂存
    rename: function (code, field) {
      if (field) state.renameField = field === 'alias' ? 'alias' : 'name';
      return stageRename(code);
    },
    // 暂存后一次性提交（等价于点工具条「提交改名（N）」）
    submitRenames: function () {
      return submitRenamePlan();
    },
    // 撤销草稿 / 撤回已提交的那次改名
    undoRename: function (code) {
      return undoRename(code);
    },
    revertRename: function (code) {
      return revertRename(code);
    },
    renameMode: function () {
      toggleRenameMode();
      return state.renameMode;
    },
    force: function () {
      gate.orderCode = currentOrderCode();
      gate.state = true;
      gate.reason = '强制挂载（绕过了订单状态门槛）';
      ensureSwitch();
      console.log('[扁鹊-1.8] 已强制挂载工具按钮');
      return true;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
