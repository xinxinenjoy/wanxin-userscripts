// ==UserScript==
// @name         扁鹊-1.3体检数据查询
// @namespace    https://tampermonkey.net/
// @version      1.7.5
// @description  SOA体检数据：自动读取落单数据、体检汇总及三类卡数量，并支持按制卡批次查询卡备注。注意：卡类查询需要账号对应权限

// @match        https://checkup-soa3.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-dingdandata
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdandata.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdandata.user.js
// ==/UserScript==

/*
 * SOA.3.2体检数据
 *
 * 功能：
 * - 已落单订单按需读取落单时间记录并支持复制为表格行。
 * - 读取体检总人数、已检/未检人数、到检/挂账/自费金额。
 * - 同时查询套餐卡、储值卡、电商卡数量，15秒内复用同订单查询结果。
 * - 卡数量大于0时可新建标签页打开对应卡池，自动填写单位代码并查询。
 * - 可在有数据的套餐卡/储值卡内手动查询备注：按卡号后5位识别制卡批次区间，再读取详情中的 remark。
 * - 每次从未覆盖卡号中取1张查询制卡区间，区间内同类卡自动排除；仍有区间外卡号时继续查询下一批次。
 * - 与SOA.3.1智能审批完全解耦，不修改订单业务数据。
 *
 * 更新记录
 *
 * v1.7.5  -  2026-9-9
 * - 卡片内不再直接展开备注内容，避免备注较多时撑高主面板。
 * - 卡数量大于0时显示“查询备注”；查询完成后同一按钮自动变为“查看备注”。
 * - 点击“查看备注”直接打开现有放大详情窗口，集中查看卡号区间、办卡日期、数量和备注。
 * - 卡数量为0时仍不显示备注按钮；原制卡批次识别与备注查询逻辑保持不变。
 *
 * v1.7.4  -  2026-9-9
 * - 缩小卡备注放大详情窗口宽度，减少横向空白。
 * - “数量”从右侧移到办卡日期右侧，日期与数量在同一行更紧凑展示。
 * - 放大详情中的办卡日期、数量、备注字号整体调大，提高可读性。
 *
 * v1.7.3  -  2026-9-9
 * - 优化卡备注放大详情布局：不再显示“批次1/批次2”，改为按实际制卡区间逐条编号展示。
 * - 每条记录直接显示卡号区间、办卡日期、卡数量和备注内容，减少层级与留白。
 * - 卡数量优先读取制卡详情 cardNum；缺失时根据卡号后5位 beginNo/endNo 自动计算。
 *
 * v1.7.2  -  2026-9-9
 * - 卡片内继续保留紧凑备注显示，并新增“放大查看”入口；备注较长时不再强行撑宽卡片。
 * - 放大详情按备注分组展示完整内容，并列出对应制卡批次的完整卡号区间及办卡日期。
 * - 办卡日期优先读取 detail.beginDate，缺失时依次回退 bindTime、internalProcessTime、financeProcessTime 等制卡时间字段。
 * - 同一备注对应多个制卡批次时，在放大详情中逐批次列出；查询和批次识别逻辑保持不变。
 *
 * v1.7.1  -  2026-9-9
 * - 卡备注查询改为按卡类型独立处理，仅数量大于0的套餐卡/储值卡显示“查询备注”按钮，不再单独占用备注面板。
 * - 同类型卡批次判断只比较卡号最后5位：先查询1张卡，读取 beginNo/endNo 后排除该区间内全部卡号，区间外仍有卡时再继续查询下一张。
 * - 同一个制卡批次的 detail 只读取一次；不同批次重复 remark 自动去重。
 * - 备注结果仅简洁显示“备注内容：1.AAA 2.BBB …”，不再展示抽样数量、批次数等辅助统计。
 * - 保留制卡 page → detail 的查询方式及随机短延迟；刷新数据或切换订单时自动清空备注结果。
 *
 * v1.7.0  -  2026-9-9
 * - 新增“卡备注抽查”：复用当前已查询到的套餐卡/储值卡列表，不额外重新拉取完整卡池。
 * - 每轮最多分散随机抽查5张代表卡号，先请求制卡记录 page 接口获取批次 id，再请求 detail 接口提取 remark。
 * - 已识别的 beginNo~endNo 制卡区间自动跳过，避免在同一批次内重复请求；同一批次详情只读取一次。
 * - 查询结果按制卡批次和备注去重展示；发现多种 remark 时突出提示，便于识别同订单多次办卡。
 * - 再次点击“继续抽查”会优先抽取尚未检查、且不属于已识别批次区间的卡号，提高抽样覆盖。
 * - 制卡查询请求全部串行执行，并加入随机短等待，避免瞬间集中请求。
 *
 * v1.6.4  -  2026-9-7
 * - 优化大卡池分页请求节奏：10页以内每次请求后随机等待50-100ms，10页以上随机等待100-200ms。
 * - 每连续完成7-10次分页请求后，额外随机停顿800-1200ms；每轮停顿阈值重新随机生成。
 * - 第一页计入连续请求次数；最后一页完成后不再执行无意义等待。
 * - 仅调整卡池分页请求节奏，查询接口、page_size=100、完整分页、缓存、状态识别、UI和三类卡跳转逻辑均保持不变。
 *
 * v1.6.3  -  2026-9-7
 * - 仅优化卡分类UI：三类卡继续固定显示，但0值卡自动收缩，不再被有状态明细的卡片强制撑高。
 * - 有数据卡适度强化边框和总数；0值卡降低视觉权重，仍明确显示“0”。
 * - 状态名称字号提升至12px、数量提升至14px并加粗；缩小行间距，保持左侧状态、右侧数量严格对齐。
 * - 状态区分隔线与上下留白同步收紧，提高信息密度和可读性；查询、分页、缓存、状态识别和跳转逻辑不变。
 *
 * v1.6.2  -  2026-9-7
 * - 仅调整卡状态展示顺序，固定为：生效中 → 已核销 → 已冻结 → 作废 → 其他。
 * - 数量为0的状态仍不显示；查询、分页、缓存、状态识别及三类卡跳转逻辑均保持不变。
 *
 * v1.6.1  -  2026-9-7
 * - 三类卡固定显示：套餐卡、储值卡、电商卡始终三列并排，0张也保留卡位，避免UI跳动。
 * - 修正卡状态识别：兼容status、status_business、card_status、cardStatus、use_status、state等字段；未知主状态不会遮蔽有效备用状态。
 * - 扩展常见状态别名；真正未知状态仍归入“其他”，并在控制台记录原始值，便于后续补充映射。
 * - 电商卡总数量支持点击后打开卡池页，自动定位电商卡页签、填写单位代码并查询。
 * - 三类卡统一使用page_size=100及完整分页逻辑；其他体检、落单、缓存、刷新功能不变。
 *
 * v1.6.0  -  2026-9-7
 * - 新增“电商卡”分类，实时查询 /soa-card/api/v1/platform/card/pool/display。
 * - 电商卡沿用卡池完整分页逻辑，page_size固定100，并按status统计生效中、已核销、已冻结、作废及其他状态。
 * - 电商卡总数为0时默认隐藏；有数据时与套餐卡、储值卡三列并排显示；查询失败时保留错误提示，避免误判为无数据。
 * - 电商卡当前仅展示统计，不新增卡池跳转；套餐卡、储值卡原有点击跳转逻辑保持不变。
 *
 * v1.5.2  -  2026-9-7
 * - 仅优化卡分类UI：取消状态行灰色/彩色底块，改为简洁的左右对齐明细。
 * - 状态名称左对齐、数量右对齐并加粗；去掉“张”字，适当放大字号。
 * - 生效中用绿色、已核销用灰色、已冻结用橙色、作废用红色、其他用蓝色。
 *
 * v1.5.1  -  2026-9-7
 * - 优化卡状态展示：按状态颜色标签显示，提高卡信息可读性。
 *
 * v1.5.0  -  2026-9-7
 * - 卡池查询优化：单次请求改为100条，并自动分页获取完整数据。
 * - 增加卡状态统计：生效中、已核销、冻结、作废及其他。
 * - 卡状态数量按实际存在情况显示，空状态自动隐藏。
 * - 增加大卡池查询过程提示。
 *
 * v1.4.3  -  2026-9-6
 * - 优化页面级缓存机制：缓存绑定当前订单页面，不使用持久化缓存。
 * - 同一订单页面关闭/重新打开模块时复用当前页面数据，避免重复请求。
 * - 切换不同订单时自动失效缓存并重新读取，避免数据串单。
 * - 点击“刷新数据”时清除当前页面缓存并强制重新查询。
 *
 * v1.4.2  -  2026-9-5
 * - 优化体检数据窗体文字可读性：提高关键标签字号、字重和对比度，数值显示更清晰。
 * - 将落单记录、体检汇总、卡类数量拆分为独立视觉区块，增加间距、浅色背景和区块标题，避免数据区域挤在一起。
 * - 仅调整UI展示，不修改落单、体检、卡池查询、权限校验及刷新逻辑。
 *
 * v1.4.1  -  2026-9-5
 * - 修复“刷新”按钮与关闭按钮缺少独立ID导致事件绑定到同一按钮的问题；刷新数据时不再关闭工具窗体。
 * - 刷新按钮更名为“刷新数据”，调整为青绿色轻量按钮样式，并增加刷新中禁用状态。
 * - 刷新仅清理当前数据缓存并在原窗口内重新查询，不调用关闭窗体逻辑；其余v1.4逻辑保持不变。
 *
 * v1.4  -  2026-9-5
 * - 增加手动刷新按钮。
 * - 打开模块仍自动读取数据，但后续不再自动重复刷新。
 * - 刷新时重新请求当前订单数据，避免页面切换造成旧缓存影响。
 *
 * v1.3  -  2026-9-5
 * - 商机编号读取增加老订单兼容：优先读取“商机编号”，缺失或无有效数字时改用“单位代码”。
 * - 卡池查询、落单数据复制统一使用同一套商机编号/单位代码兜底规则，不扫描页面其他数字。
 *
 * v1.2  -  2026-9-1
 * - 内置公共“红领巾的工具箱”框体样式，单独启用本模块时也可正常显示。
 * - 工具箱边框改用伪元素向外绘制，不改变按钮原有布局高度；增加淡色背景并放大工具箱标识。
 *
 * v1.1  -  2026-9-1
 * - 模块正式更名为SOA.3.2体检数据，顶部入口改为“查询体检数据 / 关闭体检数据”。
 * - 打开模块后自动加载落单数据、体检汇总及卡类数量，取消面板内二次查询按钮。
 * - 同订单15秒内重复打开复用已加载结果，避免频繁请求；顶部入口固定为工具组第2位。
 *
 * v1.0  -  2026-9-1
 * - 从SOA.2.5 v1.32迁移落单数据、体检数据、卡类查询及卡池跳转功能。
 */

(() => {
  "use strict";

  const ORDER_ROUTE_PREFIX =
    "#/order/";

  const CARD_GROUP_ROUTE =
    "#/card/group";

  const CARD_GROUP_PENDING_KEY =
    "__soa_order_data_card_group_pending_v10";

  const CARD_POOL_CACHE_MS =
    15000;

  const AUTO_DATA_CACHE_MS =
    15000;

  // 制卡记录和详情请求均串行执行，并加入随机等待。
  const CARD_REMARK_PAGE_DELAY = [
    180,
    320
  ];

  const CARD_REMARK_DETAIL_DELAY = [
    220,
    420
  ];

  const CARD_STATUS_MAP = {
    ENABLE: "生效中",
    ENABLED: "生效中",
    ACTIVE: "生效中",
    NORMAL: "生效中",
    AVAILABLE: "生效中",
    VALID: "生效中",
    UNUSED: "生效中",

    APPOINTED: "已预约",

    USED: "已核销",
    CONSUMED: "已核销",
    VERIFIED: "已核销",
    WRITE_OFF: "已核销",
    WRITEOFF: "已核销",

    FREEZE: "冻结",
    FROZEN: "冻结",
    LOCK: "冻结",
    LOCKED: "冻结",

    INVALID: "作废",
    CANCEL: "作废",
    CANCELED: "作废",
    CANCELLED: "作废",
    VOID: "作废",
    DISABLE: "作废",
    DISABLED: "作废",
    EXPIRED: "作废"
  };

  const CARD_STATUS_DISPLAY_ORDER = [
    "生效中",
    "已核销",
    "已预约",
    "冻结",
    "作废",
    "其他"
  ];

  const CONFIG = {
    REACTIVE_POLL_INTERVAL: 400,
    STALL_NOTICE_INTERVAL: 12000,

    PROCESS_LOG_API:
      "/soa/api/v1/order/processlogs",

    PACKAGE_CARD_POOL_API:
      "/soa-card/api/v1/card/business/pool/display",

    STORED_VALUE_CARD_POOL_API:
      "/soa-card/api/v1/bqcard/page/pool",

    ECOMMERCE_CARD_POOL_API:
      "/soa-card/api/v1/platform/card/pool/display",

    CARD_PROCESS_PAGE_API:
      "/soa-card/api/v1/bqcard/process/page",

    CARD_PROCESS_DETAIL_API:
      "/soa-card/api/v1/bqcard/process/detail",

    EXTRACT_ORDER_NAME_SELECTOR:
      "#register > div",
    EXTRACT_ORDER_CODE_SELECTOR:
      "#register > div:nth-of-type(2) > div:nth-of-type(8) > div:nth-of-type(2) > div > div",
    EXTRACT_OPPORTUNITY_CODE_SELECTOR:
      "#register > div:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div",
    EXTRACT_SALESMAN_SELECTOR:
      "#register > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div > span",

    PHYSICAL_TOTAL_PEOPLE_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(3) > div",
    PHYSICAL_CHECKED_PEOPLE_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(6)",
    PHYSICAL_UNCHECKED_PEOPLE_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(7)",
    PHYSICAL_CHECKED_AMOUNT_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(4) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(3)",
    PHYSICAL_ACCOUNT_AMOUNT_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(4) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(4)",
    PHYSICAL_SELF_PAY_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(4) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(5)"
  };

  const TOOLBOX_STYLE_ID =
    "__soa_honglingjin_toolbox_style_v10";

  const UI = {
    PAGE_SWITCH_ID:
      "__soa_data_page_switch_v10",
    PANEL_ID:
      "__soa_data_panel_v10",
    DRAG_HANDLE_ID:
      "__soa_data_drag_handle_v10",
    REFRESH_ID:
      "__soa_data_refresh_v141",
    CLOSE_ID:
      "__soa_data_close_v141",
    STATUS_ID:
      "__soa_data_status_v10",
    LANDING_DATA_BUTTON_ID:
      "__soa_data_landing_button_v10",
    PHYSICAL_DATA_BUTTON_ID:
      "__soa_data_physical_button_v10",
    DATA_PANEL_ID:
      "__soa_data_result_panel_v10",
    DATA_PANEL_TITLE_ID:
      "__soa_data_result_title_v10",
    EXTRACT_OPTIONS_ID:
      "__soa_data_landing_options_v10",
    EXTRACT_PREVIEW_ID:
      "__soa_data_landing_preview_v10",
    PHYSICAL_DATA_GRID_ID:
      "__soa_data_physical_grid_v10",
    CARD_POOL_DATA_GRID_ID:
      "__soa_data_card_grid_v10",
    CARD_REMARK_MODAL_ID:
      "__soa_data_card_remark_modal_v172",
    CARD_REMARK_MODAL_CLOSE_ID:
      "__soa_data_card_remark_modal_close_v172",
    POSITION_KEY:
      "__soa_data_panel_position_v10"
  };

  let panelVisible = false;
  let routeObserver = null;
  let uiScheduled = false;
  let activeDataPanelMode = "";
  let lastDataPanelOrderCode = "";
  let physicalDataQueryRunning = false;
  let cardGroupPendingRunning = false;
  let combinedDataQueryRunning = false;
  // 空字符串表示当前没有卡备注查询；general / storage 表示正在查询的卡类型。
  let cardRemarkQueryRunning = "";

  // 卡备注结果只保存在当前标签页内，并按卡类型独立维护。
  let cardRemarkDiscovery = {
    orderCode: "",
    cardCorpCode: "",
    types: {}
  };

  // 当前页面缓存。仅存在于当前标签页 JS 生命周期内。
  // 不写入 localStorage，避免不同订单之间数据串联。
  let combinedDataCache = {
    orderCode: "",
    data: null
  };

  let cardPoolQueryCache = {
    orderCode: "",
    cardCorpCode: "",
    timestamp: 0,
    data: null
  };

  const cardCorpCodeMemory =
    new Map();

  function isOrderRoute() {
    const hash =
      String(
        location.hash || ""
      );

    return (
      hash.startsWith(
        ORDER_ROUTE_PREFIX
      ) &&
      /[?&]orderCode=SOA[A-Za-z0-9-]+/i.test(
        hash
      )
    );
  }

  function sleep(ms) {
    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  function randomInt(
    min,
    max
  ) {
    const low =
      Math.ceil(
        Number(min)
      );

    const high =
      Math.floor(
        Number(max)
      );

    return (
      Math.floor(
        Math.random() *
        (high - low + 1)
      ) +
      low
    );
  }

  function cleanText(value) {
    return String(
      value ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  function compactText(value) {
    return cleanText(
      value
    ).replace(/\s+/g, "");
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style =
      getComputedStyle(
        element
      );

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    return (
      rect.width > 0 &&
      rect.height > 0
    );
  }

  class FlowBlockedError extends Error {
    constructor(message) {
      super(message);
      this.name =
        "FlowBlockedError";
    }
  }

  class FlowCancelledError extends Error {
    constructor(message = "数据读取已取消") {
      super(message);
      this.name =
        "FlowCancelledError";
    }
  }

  function hidePanelStatus() {
    const status =
      document.getElementById(
        UI.STATUS_ID
      );

    if (!status) {
      return;
    }

    status.style.display =
      "none";

    status.textContent =
      "";
  }

  function updatePanelStatus(
    message,
    type = "normal",
    {
      persistent = false
    } = {}
  ) {
    const status =
      document.getElementById(
        UI.STATUS_ID
      );

    if (!status) {
      return;
    }

    status.textContent =
      cleanText(
        message
      );

    status.style.display =
      status.textContent
        ? "block"
        : "none";

    status.style.background =
      type === "success"
        ? "#f6ffed"
        : type === "error"
          ? "#fff2f0"
          : "#f5f7fa";

    status.style.color =
      type === "success"
        ? "#389e0d"
        : type === "error"
          ? "#cf1322"
          : "#666";

    if (
      status.textContent &&
      !persistent
    ) {
      clearTimeout(
        updatePanelStatus._timer
      );

      updatePanelStatus._timer =
        setTimeout(
          hidePanelStatus,
          type === "error"
            ? 6000
            : 3500
        );
    }
  }

  function log(message) {
    console.log(
      `[SOA订单数据] ${message}`
    );
  }

  function warn(message) {
    console.warn(
      `[SOA订单数据] ${message}`
    );

    updatePanelStatus(
      message,
      "error"
    );
  }

  function getVisibleErrorFeedback() {
    const selectors = [
      ".ant-message-notice-content",
      ".ant-notification-notice",
      ".ant-form-item-explain-error",
      ".ant-alert-error",
      ".ant-modal-confirm-error"
    ];

    const keywords = [
      "失败",
      "错误",
      "异常",
      "网络",
      "超时",
      "重试",
      "不能为空",
      "必填",
      "校验",
      "无权限",
      "未成功",
      "系统繁忙",
      "请求失败"
    ];

    for (
      const selector
      of selectors
    ) {
      const nodes =
        Array.from(
          document.querySelectorAll(
            selector
          )
        ).filter(
          isVisible
        );

      for (
        const node
        of nodes
      ) {
        const text =
          cleanText(
            node.textContent
          );

        if (
          text &&
          keywords.some(
            word =>
              text.includes(
                word
              )
          )
        ) {
          return text;
        }
      }
    }

    return "";
  }

  function waitForReactiveCondition(
    test,
    {
      label = "页面状态",
      token = null,
      blockerCheck = null
    } = {}
  ) {
    return new Promise(
      (resolve, reject) => {
        let finished = false;
        let observer = null;
        let pollTimer = null;
        let noticeTimer = null;

        const waitingMessage =
          `仍在等待：${label}。页面较慢时会继续等待。`;

        const cleanup =
          () => {
            observer?.disconnect();

            if (pollTimer) {
              clearInterval(
                pollTimer
              );
            }

            if (noticeTimer) {
              clearTimeout(
                noticeTimer
              );
            }
          };

        const finish =
          (
            ok,
            value
          ) => {
            if (finished) {
              return;
            }

            finished = true;
            cleanup();
            hidePanelStatus();

            if (ok) {
              resolve(value);
            } else {
              reject(value);
            }
          };

        const check =
          () => {
            if (
              token?.cancelled
            ) {
              finish(
                false,
                new FlowCancelledError()
              );
              return;
            }

            if (blockerCheck) {
              const blocker =
                blockerCheck();

              if (blocker) {
                finish(
                  false,
                  new FlowBlockedError(
                    blocker
                  )
                );
                return;
              }
            }

            try {
              const result =
                test();

              if (result) {
                finish(
                  true,
                  result
                );
              }
            } catch (error) {
              finish(
                false,
                error
              );
            }
          };

        observer =
          new MutationObserver(
            check
          );

        observer.observe(
          document.documentElement,
          {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
          }
        );

        pollTimer =
          setInterval(
            check,
            CONFIG.REACTIVE_POLL_INTERVAL
          );

        noticeTimer =
          setTimeout(
            () =>
              updatePanelStatus(
                waitingMessage,
                "normal",
                {
                  persistent: true
                }
              ),
            CONFIG.STALL_NOTICE_INTERVAL
          );

        check();
      }
    );
  }

  function setNativeInputValue(
    element,
    value
  ) {
    if (!element) {
      throw new Error(
        "setNativeInputValue: element 为空"
      );
    }

    let prototype = null;

    if (
      element instanceof
        HTMLTextAreaElement
    ) {
      prototype =
        HTMLTextAreaElement
          .prototype;
    } else if (
      element instanceof
        HTMLInputElement
    ) {
      prototype =
        HTMLInputElement
          .prototype;
    } else {
      prototype =
        Object.getPrototypeOf(
          element
        );
    }

    const descriptor =
      prototype
        ? Object
            .getOwnPropertyDescriptor(
              prototype,
              "value"
            )
        : null;

    if (
      descriptor &&
      typeof descriptor.set ===
        "function"
    ) {
      descriptor.set.call(
        element,
        String(value)
      );
    } else {
      element.value =
        String(value);
    }

    element.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    element.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
  }

  function findTabByText(
    text
  ) {
    return (
      Array.from(
        document.querySelectorAll(
          ".tabs-wrap .tabs .tab"
        )
      ).find(tab => {
        return (
          isVisible(tab) &&
          compactText(
            tab.textContent
          ) === compactText(text)
        );
      }) ||
      null
    );
  }

  function getCurrentFlowStage() {
    const active =
      document.querySelector(
        ".ant-steps-item-process .ant-steps-item-title, " +
        ".ant-steps-item-active .ant-steps-item-title"
      );

    return cleanText(
      active?.textContent
    );
  }

  function cleanCellText(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /[\t\r\n]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  function queryText(
    selector
  ) {
    const element =
      document.querySelector(
        selector
      );

    if (!element) {
      return "";
    }

    return cleanCellText(
      element.innerText ||
      element.textContent
    );
  }

  function getFormItemTextByFor(
    forId
  ) {
    const label =
      document.querySelector(
        `#register label[for="${forId}"]`
      );

    const item =
      label?.closest(
        ".ant-form-item"
      );

    const content =
      item?.querySelector(
        ".ant-form-item-control-input-content"
      );

    return cleanCellText(
      content?.innerText ||
      content?.textContent
    );
  }


  function getRegisterFieldTextByLabel(labelText) {
    const target = compactText(labelText);

    const labels = Array.from(
      document.querySelectorAll(
        "#register label, #register .ant-form-item-label, #register [class*='label']"
      )
    );

    for (const label of labels) {
      const text = compactText(
        label.getAttribute?.("title") ||
        label.textContent
      );

      if (text !== target) continue;

      const item =
        label.closest(".ant-form-item") ||
        label.parentElement;

      const content = item?.querySelector(
        ".ant-form-item-control-input-content, .ant-form-item-control"
      );

      const value = cleanCellText(
        content?.innerText ||
        content?.textContent ||
        ""
      );

      if (value) return value;
    }

    const candidates = Array.from(
      document.querySelectorAll(
        "#register div, #register span, #register p"
      )
    ).filter(
      element =>
        compactText(element.textContent) === target
    );

    for (const label of candidates) {
      const row = label.parentElement;
      if (!row) continue;

      const siblings = Array.from(row.children);
      const index = siblings.indexOf(label);
      const nearby = [
        siblings[index + 1],
        label.nextElementSibling
      ].filter(Boolean);

      for (const node of nearby) {
        const value = cleanCellText(
          node.innerText ||
          node.textContent
        );

        if (
          value &&
          compactText(value) !== target
        ) {
          return value;
        }
      }
    }

    return "";
  }

  function extractBusinessCodeDigits(value) {
    const raw = cleanCellText(value)
      .replace(/^'+/, "")
      .trim();

    return raw.match(/\d+/)?.[0] || "";
  }

  function getOpportunityOrUnitCode() {
    const opportunityRaw =
      queryText(
        CONFIG.EXTRACT_OPPORTUNITY_CODE_SELECTOR
      ) ||
      getFormItemTextByFor(
        "register_opportunity_id"
      ) ||
      getRegisterFieldTextByLabel(
        "商机编号"
      );

    const opportunityCode =
      extractBusinessCodeDigits(
        opportunityRaw
      );

    if (opportunityCode) {
      return {
        code: opportunityCode,
        source: "opportunity"
      };
    }

    const unitCode =
      extractBusinessCodeDigits(
        getRegisterFieldTextByLabel(
          "单位代码"
        )
      );

    return {
      code: unitCode,
      source: unitCode ? "unit" : ""
    };
  }

  function getExtractOrderName() {
    const direct =
      document.querySelector(
        CONFIG.EXTRACT_ORDER_NAME_SELECTOR
      );

    if (!direct) {
      return "";
    }

    const titledLabel =
      direct.querySelector(
        "label[title]"
      );

    const title =
      cleanCellText(
        titledLabel?.getAttribute(
          "title"
        )
      );

    if (title) {
      return title;
    }

    return cleanCellText(
      direct.innerText ||
      direct.textContent
    );
  }

  function getExtractOrderCode() {
    return (
      queryText(
        CONFIG.EXTRACT_ORDER_CODE_SELECTOR
      ) ||
      getFormItemTextByFor(
        "register_main_order_code"
      )
    );
  }

  function getExtractOpportunityCode() {
    const result =
      getOpportunityOrUnitCode();

    return result.code
      ? `'${result.code}`
      : "";
  }

  function getExtractSalesmanName() {
    const raw =
      (
        queryText(
          CONFIG.EXTRACT_SALESMAN_SELECTOR
        ) ||
        getFormItemTextByFor(
          "register_salesman"
        )
      );

    return cleanCellText(
      raw
        .split(
          /[（(]/
        )[0]
    );
  }

  function extractDateTimeFromText(
    value
  ) {
    const text =
      cleanCellText(
        value
      );

    if (!text) {
      return "";
    }

    const patterns = [
      /\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/,
      /\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/,
      /\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}(?::\d{2})?/,
      /\d{4}-\d{1,2}-\d{1,2}/,
      /\d{4}\/\d{1,2}\/\d{1,2}/,
      /\d{4}年\d{1,2}月\d{1,2}日/
    ];

    for (
      const pattern of patterns
    ) {
      const match =
        text.match(pattern);

      if (match) {
        return cleanCellText(
          match[0]
        );
      }
    }

    return "";
  }

  function addYearsClamped(
    date,
    years
  ) {
    const source =
      new Date(date);

    const targetYear =
      source.getFullYear() +
      Number(years || 0);

    const month =
      source.getMonth();

    const day =
      source.getDate();

    const lastDay =
      new Date(
        targetYear,
        month + 1,
        0
      ).getDate();

    return new Date(
      targetYear,
      month,
      Math.min(
        day,
        lastDay
      )
    );
  }

  function getCurrentOrderCode() {
    const registerText =
      getFormItemTextByFor(
        "register_main_order_code"
      );

    const registerMatch =
      registerText.match(
        /SOA[A-Za-z0-9-]+/
      );

    if (registerMatch) {
      return registerMatch[0];
    }

    const orderDescText =
      cleanCellText(
        document.querySelector(
          ".order-desc"
        )?.textContent
      );

    const orderDescMatch =
      orderDescText.match(
        /SOA[A-Za-z0-9-]+/
      );

    if (orderDescMatch) {
      return orderDescMatch[0];
    }

    const urlMatch =
      String(
        location.href
      ).match(
        /[?&#]orderCode=(SOA[A-Za-z0-9-]+)/
      );

    return (
      urlMatch?.[1] ||
      ""
    );
  }

  async function fetchProcessLogs() {
    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      throw new Error(
        "未识别到当前订单编号，无法读取流程日志"
      );
    }

    const response =
      await fetch(
        CONFIG.PROCESS_LOG_API,
        {
          method:
            "POST",
          headers: {
            "accept":
              "application/json, text/plain, */*",
            "content-type":
              "application/json;charset=UTF-8",
            "mnclientid":
              "MN_SOA3"
          },
          body:
            JSON.stringify({
              order_code:
                orderCode,
              type:
                "ALL"
            }),
          credentials:
            "include"
        }
      );

    if (!response.ok) {
      throw new Error(
        `流程日志接口请求失败：HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    return {
      orderCode,
      payload
    };
  }

  function collectObjects(
    value,
    output = []
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return output;
    }

    if (
      Array.isArray(value)
    ) {
      value.forEach(item => {
        collectObjects(
          item,
          output
        );
      });

      return output;
    }

    if (
      typeof value ===
      "object"
    ) {
      output.push(value);

      Object.values(
        value
      ).forEach(child => {
        if (
          child &&
          typeof child ===
            "object"
        ) {
          collectObjects(
            child,
            output
          );
        }
      });
    }

    return output;
  }

  function getPrimitiveEntries(
    object
  ) {
    return Object.entries(
      object || {}
    )
      .filter(([, value]) => {
        return (
          typeof value ===
            "string" ||
          typeof value ===
            "number"
        );
      })
      .map(([key, value]) => ({
        key,
        value:
          String(value)
      }));
  }

  function normalizeTransitionText(
    value
  ) {
    return cleanCellText(
      value
    )
      .replace(
        /\s*-\s*>\s*/g,
        " -> "
      )
      .replace(
        /\s*→\s*/g,
        " -> "
      );
  }

  function objectIsLandingRecord(
    object
  ) {
    const entries =
      getPrimitiveEntries(
        object
      );

    for (const entry of entries) {
      const value =
        normalizeTransitionText(
          entry.value
        );

      if (
        value ===
          "已落单" ||
        /->\s*已落单$/.test(
          value
        )
      ) {
        return true;
      }
    }

    /*
     * 兼容接口将“目标状态”和“来源状态”拆字段返回。
     */
    for (const entry of entries) {
      const key =
        entry.key
          .toLowerCase();

      const value =
        cleanCellText(
          entry.value
        );

      if (
        /(to|target|next|after|status|state)/.test(
          key
        ) &&
        value ===
          "已落单"
      ) {
        return true;
      }
    }

    return false;
  }

  function getObjectDateTime(
    object
  ) {
    const entries =
      getPrimitiveEntries(
        object
      );

    const candidates = [];

    entries.forEach(
      ({ key, value }, index) => {
        const time =
          extractDateTimeFromText(
            value
          );

        if (!time) {
          return;
        }

        const normalizedKey =
          key.toLowerCase();

        let priority = 50;

        if (
          /create.*time|created.*time/.test(
            normalizedKey
          )
        ) {
          priority = 1;
        } else if (
          /operate.*time|operation.*time/.test(
            normalizedKey
          )
        ) {
          priority = 2;
        } else if (
          /process.*time|handle.*time/.test(
            normalizedKey
          )
        ) {
          priority = 3;
        } else if (
          /time|date/.test(
            normalizedKey
          )
        ) {
          priority = 10;
        }

        candidates.push({
          time,
          priority,
          index
        });
      }
    );

    candidates.sort(
      (a, b) =>
        a.priority -
          b.priority ||
        a.index -
          b.index
    );

    return (
      candidates[0]?.time ||
      ""
    );
  }

  function dateTimeToNumber(
    value
  ) {
    const text =
      String(
        value || ""
      )
        .replace(
          /年|月/g,
          "-"
        )
        .replace(
          /日/g,
          ""
        )
        .replace(
          /\//g,
          "-"
        )
        .trim();

    const match =
      text.match(
        /(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
      );

    if (!match) {
      return Number.NaN;
    }

    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    ).getTime();
  }

  function parseLandingRecordsFromProcessLogs(
    payload
  ) {
    const objects =
      collectObjects(
        payload
      );

    const matched = [];

    objects.forEach(
      (object, index) => {
        if (
          !objectIsLandingRecord(
            object
          )
        ) {
          return;
        }

        const time =
          getObjectDateTime(
            object
          );

        if (!time) {
          return;
        }

        matched.push({
          index,
          time,
          object
        });
      }
    );

    /*
     * 嵌套 JSON 可能让同一条记录被重复扫到，
     * 这里按时间去重。
     */
    const unique =
      new Map();

    matched.forEach(record => {
      if (
        !unique.has(
          record.time
        )
      ) {
        unique.set(
          record.time,
          record
        );
      }
    });

    const records =
      Array.from(
        unique.values()
      );

    records.sort(
      (a, b) => {
        const at =
          dateTimeToNumber(
            a.time
          );

        const bt =
          dateTimeToNumber(
            b.time
          );

        if (
          Number.isFinite(at) &&
          Number.isFinite(bt)
        ) {
          return at - bt;
        }

        return (
          a.index -
          b.index
        );
      }
    );

    return records;
  }

  function buildLandingTimeOptions(
    records
  ) {
    if (
      !Array.isArray(records) ||
      !records.length
    ) {
      return [];
    }

    const first =
      records[0];

    const last =
      records[
        records.length - 1
      ];

    const options = [
      {
        type: "first",
        label: "首次落单",
        time: first.time
      }
    ];

    if (
      records.length > 1
    ) {
      const modifiedCount =
        records.length - 1;

      options.push({
        type: "modified",
        label:
          `修改${modifiedCount}次`,
        time: last.time,
        count:
          modifiedCount
      });
    }

    return options;
  }

  let cachedLandingTimeOptions = [];

  async function refreshLandingTimeOptions() {
    cachedLandingTimeOptions = [];

    const stage =
      getCurrentFlowStage();

    if (
      stage !==
      "已落单"
    ) {
      renderLandingExtractOptions(
        []
      );

      return [];
    }

    const result =
      await fetchProcessLogs();

    const records =
      parseLandingRecordsFromProcessLogs(
        result.payload
      );

    if (!records.length) {
      console.warn(
        "[SOA订单数据] processlogs 未识别到已落单记录，原始响应：",
        result.payload
      );

      renderLandingExtractOptions(
        []
      );

      return [];
    }

    console.log(
      "[SOA订单数据] processlogs 已识别落单记录：",
      records.map(record => ({
        time:
          record.time,
        object:
          record.object
      }))
    );

    const options =
      buildLandingTimeOptions(
        records
      );

    cachedLandingTimeOptions =
      options;

    renderLandingExtractOptions(
      options
    );

    return options;
  }

  function getLandingTimeOptions() {
    return [
      ...cachedLandingTimeOptions
    ];
  }

  function buildSpreadsheetLine(
    landingTime
  ) {
    const values = [
      getExtractOrderName(),
      getExtractOrderCode(),
      getExtractOpportunityCode(),
      getExtractSalesmanName(),
      landingTime
    ].map(
      cleanCellText
    );

    const missing = [];

    if (!values[0]) {
      missing.push(
        "订单名称"
      );
    }

    if (!values[1]) {
      missing.push(
        "订单编号"
      );
    }

    if (!values[2]) {
      missing.push(
        "商机代码"
      );
    }

    if (!values[3]) {
      missing.push(
        "健管顾问姓名"
      );
    }

    if (!values[4]) {
      missing.push(
        "落单时间"
      );
    }

    if (missing.length) {
      throw new Error(
        "提取数据不完整：" +
        missing.join("、")
      );
    }

    return values.join(
      "\t"
    );
  }

  async function copyTextToClipboard(
    text
  ) {
    if (
      navigator.clipboard &&
      window.isSecureContext
    ) {
      try {
        await navigator.clipboard
          .writeText(text);

        return true;
      } catch (_) {
        // 继续走兼容方案。
      }
    }

    const textarea =
      document.createElement(
        "textarea"
      );

    textarea.value =
      text;

    textarea.style.position =
      "fixed";

    textarea.style.left =
      "-9999px";

    textarea.style.top =
      "-9999px";

    document.body.appendChild(
      textarea
    );

    textarea.focus();
    textarea.select();

    const ok =
      document.execCommand(
        "copy"
      );

    textarea.remove();

    if (!ok) {
      throw new Error(
        "浏览器未允许自动复制，请从下方预览框手动复制"
      );
    }

    return true;
  }

  function showExtractPreview(
    text
  ) {
    const preview =
      document.getElementById(
        UI.EXTRACT_PREVIEW_ID
      );

    if (!preview) {
      return;
    }

    preview.style.display =
      "block";

    preview.textContent =
      text;
  }

  async function copyLandingOption(
    option
  ) {
    const line =
      buildSpreadsheetLine(
        option.time
      );

    showExtractPreview(
      line
    );

    await copyTextToClipboard(
      line
    );

    updatePanelStatus(
      `✓ 已复制“${option.label}”数据，可直接粘贴到表格。`,
      "success"
    );

    log(
      `已复制${option.label}数据：${line}`
    );
  }

  function renderLandingExtractOptions(
    suppliedOptions = null
  ) {
    const container =
      document.getElementById(
        UI.EXTRACT_OPTIONS_ID
      );

    if (!container) {
      return [];
    }

    container.innerHTML =
      "";

    container.style.display =
      "none";

    const options =
      Array.isArray(
        suppliedOptions
      )
        ? suppliedOptions
        : getLandingTimeOptions();

    if (!options.length) {
      return options;
    }

    container.style.display =
      "grid";

    container.style.gridTemplateColumns =
      options.length > 1
        ? "1fr 1fr"
        : "1fr";

    container.style.gap =
      "7px";

    container.style.marginTop =
      "0";

    container.style.marginBottom =
      "9px";

    container.style.padding =
      "8px";

    container.style.border =
      "1px solid #d9e9ff";

    container.style.borderRadius =
      "7px";

    container.style.background =
      "#f8fbff";

    const sectionTitle =
      document.createElement(
        "div"
      );

    sectionTitle.style.cssText = [
      "grid-column:1 / -1",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "margin-bottom:1px",
      "color:#44546a",
      "font-size:11px",
      "font-weight:700",
      "line-height:1.35"
    ].join(";");

    sectionTitle.innerHTML = `
      <span>落单记录</span>
      <span style="
        color:#8a94a3;
        font-size:10px;
        font-weight:500;
      ">点击记录可复制</span>
    `;

    container.appendChild(
      sectionTitle
    );

    options.forEach(option => {
      const button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.textContent =
        `${option.label}｜${option.time}`;

      button.style.cssText = [
        "min-height:36px",
        "padding:6px 8px",
        "border:1px solid #4096ff",
        "border-radius:6px",
        "background:#fff",
        "color:#1677ff",
        "box-shadow:0 1px 3px rgba(22,119,255,.08)",
        "cursor:pointer",
        "font-size:12px",
        "font-weight:600",
        "line-height:1.4"
      ].join(";");

      button.addEventListener(
        "click",
        () => {
          copyLandingOption(
            option
          ).catch(error => {
            warn(
              error?.message ||
              String(error)
            );
          });
        }
      );

      container.appendChild(
        button
      );
    });

    return options;
  }


  function getVisibleTables() {
    return Array.from(
      document.querySelectorAll(
        "table"
      )
    ).filter(isVisible);
  }

  function getTableHeaderTexts(
    table
  ) {
    if (!table) {
      return [];
    }

    const headerRow =
      Array.from(
        table.querySelectorAll(
          "thead tr"
        )
      ).reverse()[0];

    if (!headerRow) {
      return [];
    }

    return Array.from(
      headerRow.querySelectorAll(
        "th"
      )
    ).map(cell =>
      compactText(
        cell.textContent
      )
    );
  }

  function findTableByHeaders(
    requiredHeaders
  ) {
    return (
      getVisibleTables()
        .find(table => {
          const headers =
            getTableHeaderTexts(
              table
            );

          return requiredHeaders
            .every(required =>
              headers.includes(
                compactText(required)
              )
            );
        }) ||
      null
    );
  }

  function findSummaryRow(
    table
  ) {
    if (!table) {
      return null;
    }

    const rows =
      Array.from(
        table.querySelectorAll(
          "tbody tr"
        )
      ).filter(isVisible);

    return (
      rows.find(row => {
        return Array.from(
          row.querySelectorAll(
            "td"
          )
        ).some(cell =>
          compactText(
            cell.textContent
          ) === "合计"
        );
      }) ||
      rows[
        rows.length - 1
      ] ||
      null
    );
  }

  function getSummaryCellByHeader(
    table,
    row,
    headerCandidates
  ) {
    if (
      !table ||
      !row
    ) {
      return "";
    }

    const headers =
      getTableHeaderTexts(
        table
      );

    const normalizedCandidates =
      headerCandidates.map(
        compactText
      );

    const index =
      headers.findIndex(header =>
        normalizedCandidates
          .includes(header)
      );

    if (index < 0) {
      return "";
    }

    const cells =
      Array.from(
        row.querySelectorAll(
          "td"
        )
      );

    return cleanCellText(
      cells[index]
        ?.innerText ||
      cells[index]
        ?.textContent ||
      ""
    );
  }

  function queryPhysicalFallback(
    selector
  ) {
    return cleanCellText(
      document.querySelector(
        selector
      )?.innerText ||
      document.querySelector(
        selector
      )?.textContent ||
      ""
    );
  }

  function extractPhysicalExamSummary() {
    const peopleTable =
      findTableByHeaders([
        "人数",
        "已检人数",
        "未检人数"
      ]);

    const amountTable =
      findTableByHeaders([
        "已检总额",
        "挂账金额",
        "自费支付"
      ]) ||
      findTableByHeaders([
        "到检总额",
        "挂账金额",
        "自费金额"
      ]);

    const peopleRow =
      findSummaryRow(
        peopleTable
      );

    const amountRow =
      findSummaryRow(
        amountTable
      );

    const result = {
      totalPeople:
        getSummaryCellByHeader(
          peopleTable,
          peopleRow,
          ["人数"]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_TOTAL_PEOPLE_SELECTOR
        ),

      checkedPeople:
        getSummaryCellByHeader(
          peopleTable,
          peopleRow,
          ["已检人数"]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_CHECKED_PEOPLE_SELECTOR
        ),

      uncheckedPeople:
        getSummaryCellByHeader(
          peopleTable,
          peopleRow,
          ["未检人数"]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_UNCHECKED_PEOPLE_SELECTOR
        ),

      checkedAmount:
        getSummaryCellByHeader(
          amountTable,
          amountRow,
          [
            "已检总额",
            "到检总额"
          ]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_CHECKED_AMOUNT_SELECTOR
        ),

      accountAmount:
        getSummaryCellByHeader(
          amountTable,
          amountRow,
          ["挂账金额"]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_ACCOUNT_AMOUNT_SELECTOR
        ),

      selfPayAmount:
        getSummaryCellByHeader(
          amountTable,
          amountRow,
          [
            "自费支付",
            "自费金额"
          ]
        ) ||
        queryPhysicalFallback(
          CONFIG.PHYSICAL_SELF_PAY_SELECTOR
        )
    };

    const missing = [];

    [
      ["总人数", "totalPeople"],
      ["已检人数", "checkedPeople"],
      ["未检人数", "uncheckedPeople"],
      ["到检总额", "checkedAmount"],
      ["挂账金额", "accountAmount"],
      ["自费金额", "selfPayAmount"]
    ].forEach(
      ([label, key]) => {
        if (!result[key]) {
          missing.push(label);
        }
      }
    );

    if (missing.length) {
      throw new Error(
        "体检名单数据读取不完整：" +
        missing.join("、")
      );
    }

    return result;
  }

  function tryExtractPhysicalExamSummary() {
    try {
      return extractPhysicalExamSummary();
    } catch (_) {
      return null;
    }
  }

  async function ensurePhysicalExamSummaryAvailable(
    token = null
  ) {
    /*
     * 第一优先级：直接读取当前 DOM。
     * 如果用户此前访问过体检名单、真实汇总数据仍保留在隐藏 DOM 中，
     * 则无需切换页签。
     */
    const existing =
      tryExtractPhysicalExamSummary();

    if (existing) {
      return {
        data:
          existing,
        navigated:
          false
      };
    }

    /*
     * 当前页面只有体检名单的空壳 / placeholder 时，
     * 说明真实汇总尚未加载，此时再自动切换到体检名单。
     */
    const tab =
      await waitForReactiveCondition(
        () =>
          findTabByText(
            "体检名单"
          ) ||
          null,
        {
          label:
            "体检名单页签",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback()
        }
      );

    updatePanelStatus(
      "当前页尚未加载体检汇总，正在切换到体检名单读取..."
    );

    tab.click();

    const data =
      await waitForReactiveCondition(
        () =>
          tryExtractPhysicalExamSummary() ||
          null,
        {
          label:
            "体检名单汇总数据",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback()
        }
      );

    return {
      data,
      navigated:
        true
    };
  }

  function renderPhysicalExamSummary(
    data
  ) {
    const grid =
      document.getElementById(
        UI.PHYSICAL_DATA_GRID_ID
      );

    if (!grid) {
      return;
    }

    const items = [
      ["总人数", data.totalPeople],
      ["已检人数", data.checkedPeople],
      ["未检人数", data.uncheckedPeople],
      ["到检总额", data.checkedAmount],
      ["挂账金额", data.accountAmount],
      ["自费金额", data.selfPayAmount]
    ];

    grid.innerHTML = `
      <div style="
        grid-column:1 / -1;
        margin-bottom:1px;
        color:#44546a;
        font-size:11px;
        font-weight:700;
        line-height:1.35;
      ">
        体检汇总
      </div>
      ${items
        .map(
          ([label, value]) => `
            <div style="
              min-width:0;
              padding:7px 4px;
              border:1px solid #edf0f3;
              border-radius:6px;
              background:#fff;
              text-align:center;
              user-select:text;
            ">
              <div style="
                margin-bottom:3px;
                color:#667085;
                font-size:11px;
                font-weight:600;
                line-height:1.25;
              ">${label}</div>
              <div style="
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
                color:#1f2937;
                font-size:14px;
                font-weight:800;
                line-height:1.35;
              " title="${value}">${value}</div>
            </div>
          `
        )
        .join("")}
    `;

    grid.style.display =
      "grid";

    grid.style.marginTop =
      "0";

    grid.style.padding =
      "8px";

    grid.style.border =
      "1px solid #eceff3";

    grid.style.borderRadius =
      "7px";

    grid.style.background =
      "#fcfcfd";
  }

  function getCurrentCardCorpCode() {
    const current =
      getOpportunityOrUnitCode().code ||
      "";

    const orderCode =
      getCurrentOrderCode();

    if (
      current &&
      orderCode
    ) {
      cardCorpCodeMemory.set(
        orderCode,
        current
      );
    }

    if (current) {
      return current;
    }

    if (
      orderCode &&
      cardCorpCodeMemory.has(
        orderCode
      )
    ) {
      return (
        cardCorpCodeMemory.get(
          orderCode
        ) ||
        ""
      );
    }

    return "";
  }

  function getCardPoolBackendError(
    payload
  ) {
    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      return "";
    }

    const resultCode =
      cleanText(
        payload.result_code
      ).toUpperCase();

    const errorCode =
      cleanText(
        payload.error_code
      );

    const errorDesc =
      cleanText(
        payload.error_desc
      );

    const message =
      cleanText(
        payload.msg
      );

    if (
      resultCode === "FAIL" ||
      errorCode ||
      errorDesc
    ) {
      return (
        errorDesc ||
        message ||
        errorCode ||
        "接口返回失败"
      );
    }

    return "";
  }

  function extractCardPoolTotalNum(
    payload
  ) {
    const value =
      Number(
        payload?.data?.total_num
      );

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }

  async function fetchCardPoolTotalNum(
    api,
    cardCorpCode
  ) {
    const fetchPage = async(pageIndex) => {
      const response = await fetch(api, {
        method: "POST",
        headers: {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json;charset=UTF-8",
          "mnclientid": "MN_SOA3"
        },
        body: JSON.stringify({
          region_code: "XX",
          page_index: pageIndex,
          page_size: 100,
          cardCorpCode
        }),
        credentials: "include"
      });

      const payload = await response.json();

      const backendError =
        getCardPoolBackendError(payload);

      if (backendError) {
        throw new Error(backendError);
      }

      return payload;
    };

    const first = await fetchPage(1);

    const totalNum =
      extractCardPoolTotalNum(first);

    if (totalNum === null) {
      throw new Error("接口成功，但未返回 total_num");
    }

    let items =
      [
        ...(first?.data?.items || [])
      ];

    const pages =
      Math.ceil(
        totalNum / 100
      );

    /*
     * 卡池分页请求节奏：
     * - <=10页：每次分页之间随机等待50-100ms
     * - >10页：每次分页之间随机等待100-200ms
     * - 每连续完成7-10次请求后，额外停顿800-1200ms
     * - 第一页计入连续请求次数
     * - 最后一页完成后不再额外等待
     */
    let requestsSinceBreak =
      pages > 0
        ? 1
        : 0;

    let nextBreakAt =
      randomInt(
        7,
        10
      );

    const shortDelayRange =
      pages <= 10
        ? [50, 100]
        : [100, 200];

    for (
      let pageIndex = 2;
      pageIndex <= pages;
      pageIndex++
    ) {
      /*
       * 上一页请求已经完成。
       * 在发起下一页前先加入短随机延迟。
       */
      await sleep(
        randomInt(
          shortDelayRange[0],
          shortDelayRange[1]
        )
      );

      /*
       * 连续完成7-10次请求后主动长停顿。
       * 每次长停顿后重新随机生成下一轮阈值。
       */
      if (
        requestsSinceBreak >=
        nextBreakAt
      ) {
        updatePanelStatus(
          `正在查询卡池：已加载 ${items.length}/${totalNum}，短暂停顿...`
        );

        await sleep(
          randomInt(
            800,
            1200
          )
        );

        requestsSinceBreak =
          0;

        nextBreakAt =
          randomInt(
            7,
            10
          );
      } else {
        updatePanelStatus(
          `正在查询卡池：已加载 ${items.length}/${totalNum}`
        );
      }

      const pageData =
        await fetchPage(
          pageIndex
        );

      items.push(
        ...(
          pageData?.data?.items ||
          []
        )
      );

      requestsSinceBreak++;
    }

    return {
      totalNum,
      items
    };
  }

  async function safeFetchCardPoolTotal(
    api,
    cardCorpCode
  ) {
    try {
      const result =
        await fetchCardPoolTotalNum(
          api,
          cardCorpCode
        );

      return {
        ok: true,
        totalNum: result.totalNum,
        items: result.items
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || String(error)
      };
    }
  }

  async function fetchAllCardPoolTotals(
    cardCorpCode
  ) {
    updatePanelStatus(
      "正在查询套餐卡..."
    );

    const packageCard =
      await safeFetchCardPoolTotal(
        CONFIG.PACKAGE_CARD_POOL_API,
        cardCorpCode
      );

    await sleep(
      150
    );

    updatePanelStatus(
      "正在查询储值卡..."
    );

    const storedValueCard =
      await safeFetchCardPoolTotal(
        CONFIG.STORED_VALUE_CARD_POOL_API,
        cardCorpCode
      );

    await sleep(
      150
    );

    updatePanelStatus(
      "正在查询电商卡..."
    );

    const ecommerceCard =
      await safeFetchCardPoolTotal(
        CONFIG.ECOMMERCE_CARD_POOL_API,
        cardCorpCode
      );

    return {
      packageCard,
      storedValueCard,
      ecommerceCard
    };
  }


  function createEmptyCardRemarkTypeState() {
    return {
      checkedCards:
        new Set(),
      batches:
        new Map(),
      complete:
        false
    };
  }

  function resetCardRemarkDiscovery() {
    closeCardRemarkDetailModal();

    cardRemarkDiscovery = {
      orderCode: "",
      cardCorpCode: "",
      types: {}
    };
  }

  function ensureCardRemarkDiscoveryContext(
    orderCode,
    cardCorpCode
  ) {
    if (
      cardRemarkDiscovery.orderCode !==
        orderCode ||
      cardRemarkDiscovery.cardCorpCode !==
        cardCorpCode
    ) {
      resetCardRemarkDiscovery();

      cardRemarkDiscovery.orderCode =
        orderCode;

      cardRemarkDiscovery.cardCorpCode =
        cardCorpCode;
    }

    return cardRemarkDiscovery;
  }

  function getCardRemarkTypeState(
    cardType,
    orderCode,
    cardCorpCode
  ) {
    const discovery =
      ensureCardRemarkDiscoveryContext(
        orderCode,
        cardCorpCode
      );

    if (
      !discovery.types[
        cardType
      ]
    ) {
      discovery.types[
        cardType
      ] =
        createEmptyCardRemarkTypeState();
    }

    return discovery.types[
      cardType
    ];
  }

  function normalizeCardNoCandidate(
    value
  ) {
    const text =
      cleanText(
        value
      )
        .replace(
          /\s+/g,
          ""
        );

    if (
      !text ||
      text.length < 12 ||
      text.length > 40 ||
      /[*\u4e00-\u9fff]/.test(
        text
      ) ||
      !/[0-9]/.test(
        text
      ) ||
      !/^[A-Za-z0-9-]+$/.test(
        text
      )
    ) {
      return "";
    }

    return text;
  }

  function extractCardNoFromPoolItem(
    item
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      return "";
    }

    const preferredKeys = [
      "cardNo",
      "card_no",
      "cardNumber",
      "card_number",
      "cardCode",
      "card_code",
      "cardIdNo",
      "card_id_no",
      "no"
    ];

    for (
      const key of
      preferredKeys
    ) {
      const value =
        normalizeCardNoCandidate(
          item[key]
        );

      if (value) {
        return value;
      }
    }

    for (
      const [
        key,
        rawValue
      ] of
      Object.entries(
        item
      )
    ) {
      if (
        !/card.*(no|number|code)|^(no)$/i.test(
          key
        )
      ) {
        continue;
      }

      const value =
        normalizeCardNoCandidate(
          rawValue
        );

      if (value) {
        return value;
      }
    }

    return "";
  }

  function extractOrderCodeFromPoolItem(
    item
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      return "";
    }

    const keys = [
      "orderCode",
      "order_code",
      "mainOrderCode",
      "main_order_code",
      "soaOrderNo",
      "soa_order_no"
    ];

    for (
      const key of
      keys
    ) {
      const value =
        cleanText(
          item[key]
        );

      if (
        /^SOA[A-Za-z0-9-]+$/i.test(
          value
        )
      ) {
        return value;
      }
    }

    return "";
  }

  function getCardNoLastFive(
    value
  ) {
    const text =
      cleanText(
        value
      )
        .replace(
          /\s+/g,
          ""
        );

    const match =
      text.match(
        /(\d{5})$/
      );

    if (!match) {
      return null;
    }

    const number =
      Number(
        match[1]
      );

    return Number.isFinite(
      number
    )
      ? number
      : null;
  }

  function collectCardRemarkCandidatesForType(
    result,
    orderCode
  ) {
    if (
      !result?.ok ||
      !Array.isArray(
        result.items
      )
    ) {
      return [];
    }

    const unique =
      new Map();

    for (
      const item of
      result.items
    ) {
      const cardNo =
        extractCardNoFromPoolItem(
          item
        );

      const suffix =
        getCardNoLastFive(
          cardNo
        );

      if (
        !cardNo ||
        suffix ===
          null
      ) {
        continue;
      }

      const itemOrderCode =
        extractOrderCodeFromPoolItem(
          item
        );

      /*
       * 卡池明细若带订单号，先在本地过滤。
       * 没有订单号字段时保留，后续 detail 再做最终校验。
       */
      if (
        itemOrderCode &&
        orderCode &&
        itemOrderCode !==
          orderCode
      ) {
        continue;
      }

      if (
        !unique.has(
          cardNo
        )
      ) {
        unique.set(
          cardNo,
          {
            cardNo,
            suffix,
            itemOrderCode,
            item
          }
        );
      }
    }

    return Array.from(
      unique.values()
    ).sort(
      (a, b) =>
        a.suffix -
          b.suffix ||
        a.cardNo.localeCompare(
          b.cardNo,
          "en"
        )
    );
  }

  function normalizeBatchSuffixRange(
    beginNo,
    endNo,
    fallbackSuffix
  ) {
    const begin =
      getCardNoLastFive(
        beginNo
      );

    const end =
      getCardNoLastFive(
        endNo
      );

    if (
      begin !==
        null &&
      end !==
        null &&
      begin <=
        end
    ) {
      return {
        start:
          begin,
        end
      };
    }

    return {
      start:
        fallbackSuffix,
      end:
        fallbackSuffix
    };
  }

  function isSuffixInKnownBatch(
    suffix,
    state
  ) {
    if (
      suffix ===
      null ||
      !state
    ) {
      return false;
    }

    for (
      const batch of
      state.batches.values()
    ) {
      if (
        Number.isFinite(
          batch.startSuffix
        ) &&
        Number.isFinite(
          batch.endSuffix
        ) &&
        suffix >=
          batch.startSuffix &&
        suffix <=
          batch.endSuffix
      ) {
        return true;
      }
    }

    return false;
  }

  function getUncoveredCardCandidates(
    candidates,
    state
  ) {
    return candidates.filter(
      candidate =>
        !state.checkedCards.has(
          candidate.cardNo
        ) &&
        !isSuffixInKnownBatch(
          candidate.suffix,
          state
        )
    );
  }

  function getCardProcessBackendError(
    payload
  ) {
    const resultCode =
      cleanText(
        payload?.result_code
      ).toUpperCase();

    if (
      resultCode &&
      resultCode !==
        "SUCC"
    ) {
      return (
        cleanText(
          payload?.error_desc
        ) ||
        cleanText(
          payload?.msg
        ) ||
        cleanText(
          payload?.message
        ) ||
        `接口返回 ${resultCode}`
      );
    }

    return "";
  }

  async function fetchCardProcessPageByCardNo(
    cardNo
  ) {
    const response =
      await fetch(
        CONFIG.CARD_PROCESS_PAGE_API,
        {
          method:
            "POST",
          headers: {
            "accept":
              "application/json, text/plain, */*",
            "content-type":
              "application/json;charset=UTF-8",
            "mnclientid":
              "MN_SOA3"
          },
          body:
            JSON.stringify({
              regionCode:
                "XX",
              pageSize:
                20,
              cardNo,
              pageIndex:
                1
            }),
          credentials:
            "include"
        }
      );

    if (!response.ok) {
      throw new Error(
        `制卡记录查询失败：HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    const backendError =
      getCardProcessBackendError(
        payload
      );

    if (backendError) {
      throw new Error(
        backendError
      );
    }

    return Array.isArray(
      payload?.data?.items
    )
      ? payload.data.items
      : [];
  }

  async function fetchCardProcessDetail(
    id
  ) {
    const response =
      await fetch(
        CONFIG.CARD_PROCESS_DETAIL_API,
        {
          method:
            "POST",
          headers: {
            "accept":
              "application/json, text/plain, */*",
            "content-type":
              "application/json;charset=UTF-8",
            "mnclientid":
              "MN_SOA3"
          },
          body:
            JSON.stringify({
              id
            }),
          credentials:
            "include"
        }
      );

    if (!response.ok) {
      throw new Error(
        `制卡详情查询失败：HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    const backendError =
      getCardProcessBackendError(
        payload
      );

    if (backendError) {
      throw new Error(
        backendError
      );
    }

    if (
      !payload?.data ||
      typeof payload.data !==
        "object"
    ) {
      throw new Error(
        "制卡详情接口未返回有效 data"
      );
    }

    return payload.data;
  }

  function findProcessRecordForCard(
    records,
    cardNo,
    orderCode
  ) {
    if (
      !Array.isArray(
        records
      ) ||
      !records.length
    ) {
      return null;
    }

    const cardSuffix =
      getCardNoLastFive(
        cardNo
      );

    const sameOrder =
      records.filter(
        item =>
          !cleanText(
            item?.orderCode
          ) ||
          !orderCode ||
          cleanText(
            item?.orderCode
          ) ===
            orderCode
      );

    const pool =
      sameOrder.length
        ? sameOrder
        : records;

    const matched =
      pool.find(
        item => {
          const begin =
            getCardNoLastFive(
              item?.beginNo
            );

          const end =
            getCardNoLastFive(
              item?.endNo
            );

          return (
            cardSuffix !==
              null &&
            begin !==
              null &&
            end !==
              null &&
            begin <=
              end &&
            cardSuffix >=
              begin &&
            cardSuffix <=
              end
          );
        }
      );

    return (
      matched ||
      pool.find(
        item =>
          item?.id !==
            undefined &&
          item?.id !==
            null
      ) ||
      null
    );
  }

  function escapeHtml(
    value
  ) {
    return String(
      value ?? ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#39;"
      );
  }

  function extractCardRemarkDate(
    detail,
    record
  ) {
    const candidates = [
      detail?.beginDate,
      detail?.bindTime,
      detail?.internalProcessTime,
      detail?.financeProcessTime,
      record?.bindTime,
      record?.internalProcessTime,
      record?.financeProcessTime
    ];

    for (
      const value of
      candidates
    ) {
      const text =
        cleanText(
          value
        );

      if (!text) {
        continue;
      }

      const match =
        text.match(
          /\d{4}-\d{1,2}-\d{1,2}/
        );

      return (
        match?.[0] ||
        text
      );
    }

    return "";
  }

  function getCardRemarkBatchList(
    state
  ) {
    return Array.from(
      state?.batches?.values?.() ||
      []
    ).sort(
      (a, b) => {
        const dateCompare =
          cleanText(
            a.cardDate
          ).localeCompare(
            cleanText(
              b.cardDate
            )
          );

        if (
          dateCompare !==
          0
        ) {
          return dateCompare;
        }

        return (
          Number(
            a.startSuffix || 0
          ) -
          Number(
            b.startSuffix || 0
          )
        );
      }
    );
  }

  function getCardRemarkBatchCount(
    batch
  ) {
    const direct =
      Number(
        batch?.cardNum
      );

    if (
      Number.isFinite(
        direct
      ) &&
      direct > 0
    ) {
      return direct;
    }

    const start =
      Number(
        batch?.startSuffix
      );

    const end =
      Number(
        batch?.endSuffix
      );

    if (
      Number.isFinite(
        start
      ) &&
      Number.isFinite(
        end
      ) &&
      end >=
        start
    ) {
      return (
        end -
        start +
        1
      );
    }

    return 0;
  }

  function closeCardRemarkDetailModal() {
    document
      .getElementById(
        UI.CARD_REMARK_MODAL_ID
      )
      ?.remove();
  }

  function openCardRemarkDetailModal(
    cardType,
    cardCorpCode
  ) {
    const orderCode =
      getCurrentOrderCode();

    const state =
      getCardRemarkTypeState(
        cardType,
        orderCode,
        cardCorpCode
      );

    const batches =
      getCardRemarkBatchList(
        state
      );

    if (!batches.length) {
      updatePanelStatus(
        "当前还没有可放大查看的备注数据。"
      );

      return;
    }

    closeCardRemarkDetailModal();

    const label =
      cardType ===
        "storage"
        ? "储值卡"
        : "套餐卡";

    const overlay =
      document.createElement(
        "div"
      );

    overlay.id =
      UI.CARD_REMARK_MODAL_ID;

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:100002",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:24px 16px",
      "box-sizing:border-box",
      "background:rgba(15,23,42,.32)",
      "backdrop-filter:blur(1px)"
    ].join(";");

    const bodyHtml =
      batches
        .map(
          (
            batch,
            index
          ) => {
            const beginNo =
              cleanText(
                batch.beginNo
              );

            const endNo =
              cleanText(
                batch.endNo
              );

            const rangeText =
              beginNo &&
              endNo &&
              beginNo !==
                endNo
                ? `${beginNo} - ${endNo}`
                : (
                    beginNo ||
                    endNo ||
                    "未返回"
                  );

            const cardDate =
              cleanText(
                batch.cardDate
              ) ||
              "未返回";

            const cardCount =
              getCardRemarkBatchCount(
                batch
              );

            const remark =
              cleanText(
                batch.remark
              ) ||
              "（无备注）";

            return `
              <section style="
                padding:10px 11px;
                border:1px solid #e2e7ee;
                border-radius:8px;
                background:#fff;
              ">
                <div style="
                  display:flex;
                  align-items:flex-start;
                  gap:6px;
                  color:#253247;
                  font-size:13px;
                  font-weight:750;
                  line-height:1.55;
                ">
                  <span style="
                    flex:0 0 auto;
                    color:#1677ff;
                    font-weight:800;
                  ">${index + 1}.</span>

                  <div style="
                    min-width:0;
                    word-break:break-all;
                    user-select:text;
                  ">
                    卡号 ${escapeHtml(rangeText)}
                  </div>
                </div>

                <div style="
                  display:flex;
                  align-items:center;
                  flex-wrap:wrap;
                  gap:8px 26px;
                  margin-top:7px;
                  padding-left:20px;
                  color:#596579;
                  font-size:12px;
                  line-height:1.55;
                ">
                  <div style="
                    display:flex;
                    align-items:center;
                    gap:6px;
                    white-space:nowrap;
                  ">
                    <span style="font-weight:700;">办卡日期</span>
                    <span style="
                      color:#344054;
                      font-weight:700;
                      user-select:text;
                    ">${escapeHtml(cardDate)}</span>
                  </div>

                  <div style="
                    display:flex;
                    align-items:center;
                    gap:5px;
                    white-space:nowrap;
                  ">
                    <span style="font-weight:700;">数量：</span>
                    <span style="
                      color:#344054;
                      font-size:12px;
                      font-weight:800;
                    ">${
                      cardCount > 0
                        ? `${cardCount}张`
                        : "未返回"
                    }</span>
                  </div>
                </div>

                <div style="
                  margin-top:8px;
                  padding-left:20px;
                  color:#596579;
                  font-size:16px;
                  line-height:1.6;
                ">
                  <span style="
                    font-weight:700;
                  ">备注：</span>
                  <span style="
                    color:#344054;
                    font-weight:800;
                    word-break:break-all;
                    user-select:text;
                  ">${escapeHtml(remark)}</span>
                </div>
              </section>
            `;
          }
        )
        .join("");

    overlay.innerHTML = `
      <div
        role="dialog"
        aria-modal="true"
        style="
          width:min(520px,calc(100vw - 32px));
          max-height:calc(100vh - 48px);
          display:flex;
          flex-direction:column;
          overflow:hidden;
          border:1px solid #dfe5ec;
          border-radius:11px;
          background:#fff;
          box-shadow:0 18px 50px rgba(15,23,42,.24);
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;
        "
      >
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:12px 14px;
          border-bottom:1px solid #edf0f4;
          background:#f8fbff;
        ">
          <div>
            <div style="
              color:#263548;
              font-size:15px;
              font-weight:750;
              line-height:1.35;
            ">${label}备注详情</div>
            <div style="
              margin-top:2px;
              color:#8390a2;
              font-size:10px;
              line-height:1.35;
            ">按制卡区间展示 · 卡号 · 日期 · 数量 · 备注</div>
          </div>

          <button
            id="${UI.CARD_REMARK_MODAL_CLOSE_ID}"
            type="button"
            title="关闭"
            style="
              width:28px;
              height:28px;
              border:0;
              border-radius:7px;
              background:#eef2f6;
              color:#667085;
              font-size:16px;
              line-height:28px;
              cursor:pointer;
            "
          >×</button>
        </div>

        <div style="
          min-height:0;
          overflow:auto;
          padding:11px 13px 13px;
          background:#f8fafc;
        ">
          <div style="
            display:flex;
            flex-direction:column;
            gap:8px;
          ">
            ${bodyHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(
      overlay
    );

    const close =
      () => {
        closeCardRemarkDetailModal();
      };

    overlay
      .querySelector(
        `#${UI.CARD_REMARK_MODAL_CLOSE_ID}`
      )
      ?.addEventListener(
        "click",
        close
      );

    overlay.addEventListener(
      "mousedown",
      event => {
        if (
          event.target ===
          overlay
        ) {
          close();
        }
      }
    );

    const onKeyDown =
      event => {
        if (
          event.key !==
          "Escape"
        ) {
          return;
        }

        document.removeEventListener(
          "keydown",
          onKeyDown,
          true
        );

        close();
      };

    document.addEventListener(
      "keydown",
      onKeyDown,
      true
    );
  }

  function buildInlineRemarkHtml(
    cardType,
    result,
    cardCorpCode
  ) {
    const total =
      Number(
        result?.totalNum
      );

    if (
      !result?.ok ||
      !Number.isFinite(
        total
      ) ||
      total <= 0 ||
      ![
        "general",
        "storage"
      ].includes(
        cardType
      )
    ) {
      return "";
    }

    const orderCode =
      getCurrentOrderCode();

    const state =
      getCardRemarkTypeState(
        cardType,
        orderCode,
        cardCorpCode
      );

    const running =
      Boolean(
        cardRemarkQueryRunning
      );

    const thisRunning =
      cardRemarkQueryRunning ===
        cardType;

    const hasResult =
      state.complete &&
      state.batches.size >
        0;

    const buttonText =
      thisRunning
        ? "查询中..."
        : hasResult
          ? "查看备注"
          : "查询备注";

    const action =
      hasResult
        ? "view"
        : "query";

    const disabled =
      running;

    return `
      <div style="
        margin-top:6px;
        padding-top:5px;
        border-top:1px solid rgba(56,142,60,.12);
      ">
        <button
          type="button"
          data-soa-card-remark-type="${cardType}"
          data-soa-card-remark-action="${action}"
          ${disabled ? "disabled" : ""}
          style="
            width:100%;
            height:24px;
            padding:0 5px;
            border:1px solid ${
              disabled
                ? "#d9d9d9"
                : hasResult
                  ? "#91caff"
                  : "#91caff"
            };
            border-radius:5px;
            background:${
              disabled
                ? "#f5f5f5"
                : hasResult
                  ? "#e6f4ff"
                  : "#e6f4ff"
            };
            color:${
              disabled
                ? "#999"
                : "#1677ff"
            };
            font-size:10px;
            font-weight:650;
            line-height:22px;
            cursor:${
              disabled
                ? "not-allowed"
                : "pointer"
            };
            white-space:nowrap;
          "
        >${buttonText}</button>
      </div>
    `;
  }

  async function queryCardRemarksByType(
    cardType,
    result,
    cardPool,
    cardCorpCode
  ) {
    if (
      cardRemarkQueryRunning
    ) {
      updatePanelStatus(
        "卡备注正在查询中，请稍候..."
      );

      return;
    }

    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      throw new Error(
        "未识别到当前订单编号，无法查询卡备注"
      );
    }

    if (!cardCorpCode) {
      throw new Error(
        "未识别到商机编号或单位代码，无法查询卡备注"
      );
    }

    if (
      ![
        "general",
        "storage"
      ].includes(
        cardType
      )
    ) {
      return;
    }

    const candidates =
      collectCardRemarkCandidatesForType(
        result,
        orderCode
      );

    if (!candidates.length) {
      throw new Error(
        "当前卡列表中未识别到可用于制卡查询的卡号"
      );
    }

    const state =
      getCardRemarkTypeState(
        cardType,
        orderCode,
        cardCorpCode
      );

    cardRemarkQueryRunning =
      cardType;

    renderCardPoolSummary(
      cardPool,
      cardCorpCode
    );

    const label =
      cardType ===
        "storage"
        ? "储值卡"
        : "套餐卡";

    try {
      while (true) {
        if (
          getCurrentOrderCode() !==
          orderCode
        ) {
          throw new FlowCancelledError(
            "订单已切换，已停止卡备注查询"
          );
        }

        const uncovered =
          getUncoveredCardCandidates(
            candidates,
            state
          );

        if (!uncovered.length) {
          state.complete =
            true;

          break;
        }

        /*
         * 每次只从当前未覆盖区间里取1张。
         * 卡号已经按后5位从小到大排序，因此优先查询最小的未覆盖卡号。
         * page 返回 beginNo/endNo 后，区间内其他同类型卡会立即自动排除。
         */
        const candidate =
          uncovered[0];

        state.checkedCards.add(
          candidate.cardNo
        );

        updatePanelStatus(
          `正在查询${label}备注：${candidate.cardNo}`,
          "normal",
          {
            persistent:
              true
          }
        );

        try {
          const records =
            await fetchCardProcessPageByCardNo(
              candidate.cardNo
            );

          const record =
            findProcessRecordForCard(
              records,
              candidate.cardNo,
              orderCode
            );

          if (
            !record ||
            record.id ===
              undefined ||
            record.id ===
              null
          ) {
            console.warn(
              "[SOA订单数据] 未找到对应制卡记录：",
              candidate.cardNo
            );

            continue;
          }

          const batchId =
            String(
              record.id
            );

          if (
            state.batches.has(
              batchId
            )
          ) {
            continue;
          }

          await sleep(
            randomInt(
              CARD_REMARK_DETAIL_DELAY[0],
              CARD_REMARK_DETAIL_DELAY[1]
            )
          );

          const detail =
            await fetchCardProcessDetail(
              record.id
            );

          if (
            getCurrentOrderCode() !==
            orderCode
          ) {
            throw new FlowCancelledError(
              "订单已切换，已停止卡备注查询"
            );
          }

          const detailOrderCode =
            cleanText(
              detail?.orderCode
            );

          if (
            detailOrderCode &&
            detailOrderCode !==
              orderCode
          ) {
            console.warn(
              "[SOA订单数据] 制卡详情订单不匹配，已跳过：",
              {
                cardNo:
                  candidate.cardNo,
                detailOrderCode,
                currentOrderCode:
                  orderCode
              }
            );

            continue;
          }

          const range =
            normalizeBatchSuffixRange(
              detail?.beginNo ||
              record?.beginNo,
              detail?.endNo ||
              record?.endNo,
              candidate.suffix
            );

          state.batches.set(
            batchId,
            {
              id:
                batchId,
              remark:
                cleanText(
                  detail?.remark
                ),
              startSuffix:
                range.start,
              endSuffix:
                range.end,
              beginNo:
                cleanText(
                  detail?.beginNo ||
                  record?.beginNo
                ),
              endNo:
                cleanText(
                  detail?.endNo ||
                  record?.endNo
                ),
              cardDate:
                extractCardRemarkDate(
                  detail,
                  record
                ),
              cardNum:
                Number(
                  detail?.cardNum ||
                  record?.cardNum ||
                  0
                )
            }
          );

          /*
           * 不需要手工逐张删除。
           * 下一轮 getUncoveredCardCandidates 会依据后5位批次区间，
           * 自动排除该 beginNo~endNo 范围内的全部同类型卡号。
           */
        } catch (error) {
          if (
            error instanceof
            FlowCancelledError
          ) {
            throw error;
          }

          console.warn(
            "[SOA订单数据] 卡备注查询失败：",
            {
              cardType,
              cardNo:
                candidate.cardNo,
              error
            }
          );
        }

        if (
          getUncoveredCardCandidates(
            candidates,
            state
          ).length
        ) {
          await sleep(
            randomInt(
              CARD_REMARK_PAGE_DELAY[0],
              CARD_REMARK_PAGE_DELAY[1]
            )
          );
        }
      }

      updatePanelStatus(
        `✓ ${label}备注查询完成。`,
        "success"
      );
    } finally {
      cardRemarkQueryRunning =
        "";

      renderCardPoolSummary(
        cardPool,
        cardCorpCode
      );
    }
  }

  function savePendingCardGroupQuery(
    cardType,
    cardCorpCode
  ) {
    const type =
      cardType ===
        "storage"
        ? "storage"
        : cardType ===
            "ecommerce"
          ? "ecommerce"
          : "general";

    const code =
      cleanText(
        cardCorpCode
      );

    if (!code) {
      throw new Error(
        "单位代码为空，无法打开卡池"
      );
    }

    localStorage.setItem(
      CARD_GROUP_PENDING_KEY,
      JSON.stringify({
        cardType:
          type,
        cardCorpCode:
          code,
        createdAt:
          Date.now()
      })
    );
  }

  function readPendingCardGroupQuery() {
    const raw =
      localStorage.getItem(
        CARD_GROUP_PENDING_KEY
      );

    if (!raw) {
      return null;
    }

    try {
      const data =
        JSON.parse(
          raw
        );

      if (
        !data ||
        !data.cardCorpCode ||
        ![
          "general",
          "storage",
          "ecommerce"
        ].includes(
          data.cardType
        )
      ) {
        return null;
      }

      /*
       * 超过 2 分钟的任务视为过期，
       * 防止用户很久之后重新进入卡池页时误自动查询。
       */
      if (
        Number.isFinite(
          Number(
            data.createdAt
          )
        ) &&
        Date.now() -
          Number(
            data.createdAt
          ) >
          120000
      ) {
        localStorage.removeItem(
          CARD_GROUP_PENDING_KEY
        );

        return null;
      }

      return data;
    } catch {
      localStorage.removeItem(
        CARD_GROUP_PENDING_KEY
      );

      return null;
    }
  }

  function clearPendingCardGroupQuery() {
    localStorage.removeItem(
      CARD_GROUP_PENDING_KEY
    );
  }

  function openCardGroupForQuery(
    cardType,
    cardCorpCode
  ) {
    savePendingCardGroupQuery(
      cardType,
      cardCorpCode
    );

    const url =
      `${location.origin}/${CARD_GROUP_ROUTE}`;

    const newTab =
      window.open(
        url,
        "_blank"
      );

    if (!newTab) {
      clearPendingCardGroupQuery();

      throw new Error(
        "浏览器阻止了新标签页，请允许当前网站打开弹出窗口"
      );
    }
  }

  function waitForCardGroupElement(
    finder,
    {
      timeout =
        12000,
      interval =
        100,
      label =
        "页面元素"
    } = {}
  ) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        const start =
          Date.now();

        const check =
          () => {
            let value = null;

            try {
              value =
                typeof finder ===
                  "function"
                  ? finder()
                  : document.querySelector(
                      finder
                    );
            } catch (_) {
              value = null;
            }

            if (value) {
              resolve(
                value
              );
              return;
            }

            if (
              Date.now() -
                start >=
              timeout
            ) {
              reject(
                new Error(
                  `等待${label}超时`
                )
              );

              return;
            }

            setTimeout(
              check,
              interval
            );
          };

        check();
      }
    );
  }

  function isElementVisible(
    element
  ) {
    if (!element) {
      return false;
    }

    const style =
      getComputedStyle(
        element
      );

    if (
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      return false;
    }

    const rect =
      element.getBoundingClientRect();

    return (
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isCardGroupTabActive(
    tab
  ) {
    if (!tab) {
      return false;
    }

    return (
      tab.getAttribute(
        "aria-selected"
      ) === "true" ||
      tab.classList.contains(
        "ant-tabs-tab-active"
      ) ||
      tab.parentElement
        ?.classList
        ?.contains(
          "ant-tabs-tab-active"
        )
    );
  }

  function getCardGroupSuffixCandidates(
    cardType
  ) {
    if (
      cardType ===
      "storage"
    ) {
      return [
        "storageCard"
      ];
    }

    if (
      cardType ===
      "ecommerce"
    ) {
      return [
        "platformCard",
        "ecommerceCard",
        "eCommerceCard"
      ];
    }

    return [
      "generalCard"
    ];
  }

  function getCardGroupTab(
    cardType
  ) {
    const suffixes =
      getCardGroupSuffixCandidates(
        cardType
      );

    for (
      const suffix
      of suffixes
    ) {
      const tab =
        document.getElementById(
          `rc-tabs-0-tab-${suffix}`
        ) ||
        document.querySelector(
          `[id$="-tab-${suffix}"]`
        );

      if (tab) {
        return tab;
      }
    }

    if (
      cardType ===
      "ecommerce"
    ) {
      return (
        Array.from(
          document.querySelectorAll(
            '[role="tab"], .ant-tabs-tab, [id*="-tab-"]'
          )
        ).find(
          tab =>
            isElementVisible(
              tab
            ) &&
            compactText(
              tab.textContent
            ).includes(
              "电商卡"
            )
        ) ||
        null
      );
    }

    return null;
  }

  function getCardGroupPanel(
    cardType
  ) {
    const tab =
      getCardGroupTab(
        cardType
      );

    const controlledId =
      tab?.getAttribute(
        "aria-controls"
      );

    if (controlledId) {
      const controlled =
        document.getElementById(
          controlledId
        );

      if (controlled) {
        return controlled;
      }
    }

    const suffixes =
      getCardGroupSuffixCandidates(
        cardType
      );

    for (
      const suffix
      of suffixes
    ) {
      const panel =
        document.getElementById(
          `rc-tabs-0-panel-${suffix}`
        ) ||
        document.querySelector(
          `[id$="-panel-${suffix}"]`
        );

      if (panel) {
        return panel;
      }
    }

    if (
      cardType ===
      "ecommerce"
    ) {
      return (
        Array.from(
          document.querySelectorAll(
            '[role="tabpanel"], .ant-tabs-tabpane'
          )
        ).find(
          isElementVisible
        ) ||
        null
      );
    }

    return null;
  }

  function findCardGroupQueryButton(
    cardType
  ) {
    if (
      cardType !==
      "ecommerce"
    ) {
      const suffix =
        cardType ===
          "storage"
          ? "storageCard"
          : "generalCard";

      /*
       * 套餐卡、储值卡继续优先使用已验证过的精确DOM路径。
       */
      const exact =
        document.querySelector(
          `#rc-tabs-0-panel-${suffix} > div > div > div > form > div > div:nth-of-type(9) > div > div:nth-of-type(2) > div > div > div > div > div > div > button`
        );

      if (exact) {
        return exact;
      }
    }

    const panel =
      getCardGroupPanel(
        cardType
      );

    if (!panel) {
      return null;
    }

    const buttons =
      Array.from(
        panel.querySelectorAll(
          "form button"
        )
      );

    return (
      buttons.find(
        button =>
          /查询|搜索/.test(
            cleanText(
              button.textContent
            )
          )
      ) ||
      null
    );
  }

  async function processPendingCardGroupQuery() {
    if (
      cardGroupPendingRunning ||
      !location.hash.startsWith(
        CARD_GROUP_ROUTE
      )
    ) {
      return;
    }

    const pending =
      readPendingCardGroupQuery();

    if (!pending) {
      return;
    }

    cardGroupPendingRunning =
      true;

    try {
      const tab =
        await waitForCardGroupElement(
          () =>
            getCardGroupTab(
              pending.cardType
            ),
          {
            timeout:
              15000,
            label:
              pending.cardType ===
                "storage"
                ? "储值卡页签"
                : pending.cardType ===
                    "ecommerce"
                  ? "电商卡页签"
                  : "套餐卡页签"
          }
        );

      if (
        !isCardGroupTabActive(
          tab
        )
      ) {
        tab.click();
      }

      /*
       * 等待目标页签真正激活。
       * 不能只在 click 后马上继续，否则 Ant Tabs 的内容还未挂载完成。
       */
      await waitForCardGroupElement(
        () =>
          isCardGroupTabActive(
            getCardGroupTab(
              pending.cardType
            )
          )
            ? true
            : null,
        {
          timeout:
            8000,
          label:
            "卡池页签激活"
        }
      );

      /*
       * 再等待目标 panel 可见。
       */
      const panel =
        await waitForCardGroupElement(
          () => {
            const current =
              getCardGroupPanel(
                pending.cardType
              );

            return (
              current &&
              isElementVisible(
                current
              )
            )
              ? current
              : null;
          },
          {
            timeout:
              10000,
            label:
              "卡池查询区域"
          }
        );

      const input =
        await waitForCardGroupElement(
          () => {
            const scoped =
              panel.querySelector(
                "#cardCorpCode, input[id='cardCorpCode']"
              );

            const fallback =
              document.querySelector(
                "#cardCorpCode"
              );

            const candidate =
              scoped ||
              fallback;

            return (
              candidate &&
              !candidate.disabled &&
              isElementVisible(
                candidate
              )
            )
              ? candidate
              : null;
          },
          {
            timeout:
              10000,
            label:
              "单位代码输入框"
          }
        );

      input.focus();

      setNativeInputValue(
        input,
        pending.cardCorpCode
      );

      /*
       * 补齐框架常见受控输入事件，
       * 确保 React/Ant Design 的表单状态同步。
       */
      input.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:
              true
          }
        )
      );

      input.dispatchEvent(
        new Event(
          "change",
          {
            bubbles:
              true
          }
        )
      );

      /*
       * 等待页面确认输入值已经写入。
       */
      await waitForCardGroupElement(
        () =>
          cleanText(
            input.value
          ) ===
          pending.cardCorpCode
            ? true
            : null,
        {
          timeout:
            5000,
          interval:
            80,
          label:
            "单位代码写入"
        }
      );

      input.blur();

      /*
       * 给 Ant Form 留出状态提交时间。
       * v1.30 的问题主要就是此处操作过快。
       */
      await sleep(
        650
      );

      let queryButton =
        findCardGroupQueryButton(
          pending.cardType
        );

      if (
        !queryButton ||
        queryButton.disabled ||
        !isElementVisible(
          queryButton
        )
      ) {
        queryButton =
          await waitForCardGroupElement(
            () => {
              const button =
                findCardGroupQueryButton(
                  pending.cardType
                );

              return (
                button &&
                !button.disabled &&
                isElementVisible(
                  button
                )
              )
                ? button
                : null;
            },
            {
              timeout:
                8000,
              interval:
                120,
              label:
                "卡池查询按钮"
            }
          );
      }

      /*
       * 优先真实点击查询按钮。
       */
      queryButton.focus();

      await sleep(
        180
      );

      queryButton.click();

      /*
       * 点击后不立即清任务，稍等一下，
       * 避免页面状态尚未接收点击。
       */
      await sleep(
        500
      );

      clearPendingCardGroupQuery();

      console.log(
        "[SOA订单数据] 已打开新标签页并查询卡池：",
        {
          cardType:
            pending.cardType,
          cardCorpCode:
            pending.cardCorpCode
        }
      );
    } catch (error) {
      console.warn(
        "[SOA订单数据] 卡池自动查询失败：",
        error
      );

      /*
       * 失败时保留任务一小段时间，便于路由重新触发时再试；
       * 任务本身仍有2分钟过期保护。
       */
      throw error;
    } finally {
      cardGroupPendingRunning =
        false;
    }
  }

  function normalizeCardStatusValue(
    value
  ) {
    return cleanText(
      value
    )
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
  }

  function resolveCardStatus(
    item
  ) {
    const candidates = [
      item?.status,
      item?.status_business,
      item?.statusBusiness,
      item?.card_status,
      item?.cardStatus,
      item?.use_status,
      item?.useStatus,
      item?.state
    ];

    for (
      const value
      of candidates
    ) {
      const normalized =
        normalizeCardStatusValue(
          value
        );

      if (
        normalized &&
        CARD_STATUS_MAP[
          normalized
        ]
      ) {
        return {
          label:
            CARD_STATUS_MAP[
              normalized
            ],
          raw:
            normalized
        };
      }
    }

    return {
      label:
        "其他",
      raw:
        candidates
          .map(
            normalizeCardStatusValue
          )
          .filter(Boolean)
          .join(" / ")
    };
  }

  function buildCardStatusSummary(items) {
    const summary = {};
    const unknownValues =
      new Set();

    (items || []).forEach(item => {
      const resolved =
        resolveCardStatus(
          item
        );

      summary[
        resolved.label
      ] =
        (
          summary[
            resolved.label
          ] ||
          0
        ) + 1;

      if (
        resolved.label ===
          "其他" &&
        resolved.raw
      ) {
        unknownValues.add(
          resolved.raw
        );
      }
    });

    if (
      unknownValues.size
    ) {
      console.warn(
        "[SOA订单数据] 发现未映射卡状态：",
        Array.from(
          unknownValues
        )
      );
    }

    return summary;
  }

  function renderCardPoolSummary(
    data,
    cardCorpCode
  ) {
    const grid =
      document.getElementById(
        UI.CARD_POOL_DATA_GRID_ID
      );

    if (!grid) {
      return;
    }

    const items = [
      [
        "套餐卡",
        "general",
        data.packageCard
      ],
      [
        "储值卡",
        "storage",
        data.storedValueCard
      ],
      [
        "电商卡",
        "ecommerce",
        data.ecommerceCard
      ]
    ];

    grid.innerHTML = `
      <div style="
        grid-column:1 / -1;
        margin-bottom:1px;
        color:#44546a;
        font-size:11px;
        font-weight:700;
        line-height:1.35;
      ">
        卡类数量
      </div>
      ${items
        .map(
          ([
            label,
            cardType,
            result
          ]) => {
            const success =
              Boolean(
                result?.ok
              );

            const numericValue =
              success
                ? Number(
                    result.totalNum
                  )
                : null;

            const statusSummary =
              success
                ? buildCardStatusSummary(
                    result.items
                  )
                : {};

            const clickable =
              success &&
              Number.isFinite(
                numericValue
              ) &&
              numericValue > 0;

            const value =
              success
                ? result.totalNum
                : (
                    result?.error ||
                    "查询失败"
                  );

            const safeValue =
              cleanCellText(
                value
              )
                .replace(
                  /&/g,
                  "&amp;"
                )
                .replace(
                  /</g,
                  "&lt;"
                )
                .replace(
                  />/g,
                  "&gt;"
                )
                .replace(
                  /"/g,
                  "&quot;"
                );

            const canOpenCardPool =
              clickable;

            const clickAttrs =
              canOpenCardPool
                ? `data-soa-card-type="${cardType}" data-soa-card-code="${cardCorpCode}"`
                : "";

            const remarkHtml =
              buildInlineRemarkHtml(
                cardType,
                result,
                cardCorpCode
              );

            return `
              <div style="
                min-width:0;
                align-self:start;
                padding:${
                  success && !clickable
                    ? "7px 6px"
                    : "8px 6px"
                };
                border:1px solid ${
                  !success
                    ? "#ffccc7"
                    : clickable
                      ? "#b7eb8f"
                      : "#dfe9d5"
                };
                border-radius:6px;
                background:${
                  !success
                    ? "#fff2f0"
                    : clickable
                      ? "#f6ffed"
                      : "#fbfdf8"
                };
                box-shadow:${
                  success && clickable
                    ? "0 1px 3px rgba(82,196,26,.06)"
                    : "none"
                };
                text-align:center;
              ">
                <div style="
                  margin-bottom:3px;
                  color:#596579;
                  font-size:12px;
                  font-weight:650;
                  line-height:1.25;
                ">${label}</div>

                <div
                  ${clickAttrs}
                  style="
                    overflow:hidden;
                    text-overflow:ellipsis;
                    white-space:nowrap;
                    color:${
                      !success
                        ? "#cf1322"
                        : clickable
                          ? "#237804"
                          : "#8a94a3"
                    };
                    font-size:${
                      success
                        ? clickable
                          ? "18px"
                          : "16px"
                        : "11px"
                    };
                    font-weight:800;
                    line-height:1.25;
                    cursor:${
                      canOpenCardPool
                        ? "pointer"
                        : "default"
                    };
                    text-decoration:${
                      canOpenCardPool
                        ? "underline"
                        : "none"
                    };
                    text-underline-offset:2px;
                  "
                  title="${
                    canOpenCardPool
                      ? `点击新建标签页打开${label}卡池并查询单位代码 ${cardCorpCode}`
                      : safeValue
                  }"
                >${safeValue}</div>

                ${
                  success &&
                  Object.keys(
                    statusSummary
                  ).length
                    ? `<div style="
                        margin-top:6px;
                        padding-top:5px;
                        border-top:1px solid rgba(56,142,60,.14);
                        text-align:left;
                      ">
                      ${CARD_STATUS_DISPLAY_ORDER
                        .map(k => [
                          k,
                          Number(
                            statusSummary[k] || 0
                          )
                        ])
                        .filter(([, v]) => v > 0)
                        .map(([k, v]) => {
                          let statusLabel =
                            k;

                          let color =
                            "#1677ff";

                          let numberColor =
                            "#344054";

                          if (k === "生效中") {
                            color =
                              "#389e0d";
                            numberColor =
                              "#237804";
                          } else if (k === "已核销") {
                            color =
                              "#7a8599";
                            numberColor =
                              "#475467";
                          } else if (k === "冻结") {
                            statusLabel =
                              "已冻结";
                            color =
                              "#d46b08";
                            numberColor =
                              "#ad4e00";
                          } else if (k === "作废") {
                            color =
                              "#cf1322";
                            numberColor =
                              "#a8071a";
                          }

                          return `<div style="
                            display:flex;
                            align-items:center;
                            justify-content:space-between;
                            gap:5px;
                            min-height:19px;
                            padding:0 2px;
                            font-size:12px;
                            line-height:1.32;
                          ">
                            <span style="
                              min-width:0;
                              color:${color};
                              font-weight:650;
                              white-space:nowrap;
                            ">${statusLabel}</span>
                            <span style="
                              flex:0 0 auto;
                              min-width:30px;
                              color:${numberColor};
                              font-size:14px;
                              font-weight:800;
                              line-height:1.2;
                              text-align:right;
                              font-variant-numeric:tabular-nums;
                            ">${v}</span>
                          </div>`;
                        })
                        .join("")}
                    </div>`
                    : ""
                }

                ${remarkHtml}
              </div>
            `;
          }
        )
        .join("")}
    `;

    grid.style.display =
      "grid";

    grid.style.gridTemplateColumns =
      "repeat(3, minmax(0, 1fr))";

    grid.style.alignItems =
      "start";

    grid.style.marginTop =
      "9px";

    grid.style.padding =
      "8px";

    grid.style.border =
      "1px solid #e3f1d5";

    grid.style.borderRadius =
      "7px";

    grid.style.background =
      "#fbfff8";

    grid.title =
      `cardCorpCode：${cardCorpCode}`;

    grid
      .querySelectorAll(
        "[data-soa-card-type][data-soa-card-code]"
      )
      .forEach(
        element => {
          element.addEventListener(
            "click",
            () => {
              const cardType =
                element.getAttribute(
                  "data-soa-card-type"
                );

              const code =
                element.getAttribute(
                  "data-soa-card-code"
                );

              try {
                openCardGroupForQuery(
                  cardType,
                  code
                );
              } catch (error) {
                updatePanelStatus(
                  error?.message ||
                  String(error),
                  "error"
                );
              }
            }
          );
        }
      );

    grid
      .querySelectorAll(
        "[data-soa-card-remark-detail]"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            event => {
              event.preventDefault();
              event.stopPropagation();

              const cardType =
                button.getAttribute(
                  "data-soa-card-remark-detail"
                );

              openCardRemarkDetailModal(
                cardType,
                cardCorpCode
              );
            }
          );
        }
      );

    grid
      .querySelectorAll(
        "[data-soa-card-remark-type]"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            event => {
              event.preventDefault();
              event.stopPropagation();

              const cardType =
                button.getAttribute(
                  "data-soa-card-remark-type"
                );

              const action =
                button.getAttribute(
                  "data-soa-card-remark-action"
                );

              if (
                action ===
                "view"
              ) {
                openCardRemarkDetailModal(
                  cardType,
                  cardCorpCode
                );

                return;
              }

              const result =
                cardType ===
                  "storage"
                  ? data.storedValueCard
                  : data.packageCard;

              queryCardRemarksByType(
                cardType,
                result,
                data,
                cardCorpCode
              ).catch(
                error => {
                  updatePanelStatus(
                    error?.message ||
                    String(error),
                    "error"
                  );
                }
              );
            }
          );
        }
      );
  }


  function setDataButtonActive(
    mode
  ) {
    const landing =
      document.getElementById(
        UI.LANDING_DATA_BUTTON_ID
      );

    const physical =
      document.getElementById(
        UI.PHYSICAL_DATA_BUTTON_ID
      );

    [
      [landing, "landing"],
      [physical, "physical"]
    ].forEach(
      ([button, buttonMode]) => {
        if (!button) {
          return;
        }

        const active =
          mode === buttonMode;

        button.style.background =
          active
            ? "#e6f4ff"
            : "#fff";

        button.style.borderColor =
          active
            ? "#1677ff"
            : "#d9d9d9";

        button.style.color =
          active
            ? "#1677ff"
            : "#555";
      }
    );
  }

  function resetDataPanelContent() {
    const landingOptions =
      document.getElementById(
        UI.EXTRACT_OPTIONS_ID
      );

    const physicalGrid =
      document.getElementById(
        UI.PHYSICAL_DATA_GRID_ID
      );

    const cardPoolGrid =
      document.getElementById(
        UI.CARD_POOL_DATA_GRID_ID
      );

    const preview =
      document.getElementById(
        UI.EXTRACT_PREVIEW_ID
      );

    if (landingOptions) {
      landingOptions.innerHTML =
        "";

      landingOptions.style.display =
        "none";
    }

    if (physicalGrid) {
      physicalGrid.innerHTML =
        "";

      physicalGrid.style.display =
        "none";
    }

    if (cardPoolGrid) {
      cardPoolGrid.innerHTML =
        "";

      cardPoolGrid.style.display =
        "none";

      cardPoolGrid.title =
        "";
    }

    if (preview) {
      preview.style.display =
        "none";

      preview.textContent =
        "";
    }
  }

  function closeDataPanel() {
    const panel =
      document.getElementById(
        UI.DATA_PANEL_ID
      );

    if (panel) {
      panel.style.display =
        "none";
    }

    activeDataPanelMode =
      "";

    setDataButtonActive(
      ""
    );

    resetDataPanelContent();
  }

  function openDataPanelShell(
    mode,
    title
  ) {
    const panel =
      document.getElementById(
        UI.DATA_PANEL_ID
      );

    const titleElement =
      document.getElementById(
        UI.DATA_PANEL_TITLE_ID
      );

    if (
      !panel ||
      !titleElement
    ) {
      return false;
    }

    resetDataPanelContent();

    activeDataPanelMode =
      mode;

    titleElement.textContent =
      title;

    panel.style.display =
      "block";

    setDataButtonActive(
      mode
    );

    return true;
  }

  function syncDataOrderContext() {
    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      return;
    }

    if (
      lastDataPanelOrderCode &&
      lastDataPanelOrderCode !==
        orderCode
    ) {
      cachedLandingTimeOptions = [];

      cardPoolQueryCache = {
        orderCode: "",
        cardCorpCode: "",
        timestamp: 0,
        data: null
      };

      combinedDataCache = {
        orderCode: "",
        data: null
      };

      resetCardRemarkDiscovery();

      closeDataPanel();
    }

    lastDataPanelOrderCode =
      orderCode;
  }

  async function toggleLandingDataPanel() {
    syncDataOrderContext();

    if (
      activeDataPanelMode ===
      "landing"
    ) {
      closeDataPanel();
      return;
    }

    if (
      getCurrentFlowStage() !==
      "已落单"
    ) {
      updatePanelStatus(
        "当前订单尚未进入“已落单”，暂无落单数据。",
        "error"
      );

      return;
    }

    if (
      !openDataPanelShell(
        "landing",
        "落单数据"
      )
    ) {
      return;
    }

    const title =
      document.getElementById(
        UI.DATA_PANEL_TITLE_ID
      );

    if (title) {
      title.textContent =
        "落单数据 · 读取中...";
    }

    try {
      const options =
        await refreshLandingTimeOptions();

      if (title) {
        title.textContent =
          options.length
            ? "落单数据 · 点击复制"
            : "落单数据 · 未识别到记录";
      }
    } catch (error) {
      if (title) {
        title.textContent =
          "落单数据 · 读取失败";
      }

      throw error;
    }
  }

  async function togglePhysicalDataPanel() {
    syncDataOrderContext();

    if (
      activeDataPanelMode ===
      "physical"
    ) {
      if (
        physicalDataQueryRunning
      ) {
        updatePanelStatus(
          "数据正在查询中，请稍候..."
        );

        return;
      }

      closeDataPanel();
      return;
    }

    if (
      physicalDataQueryRunning
    ) {
      updatePanelStatus(
        "数据正在查询中，请稍候..."
      );

      return;
    }

    if (
      !openDataPanelShell(
        "physical",
        "体检数据 · 读取中..."
      )
    ) {
      return;
    }

    physicalDataQueryRunning =
      true;

    const button =
      document.getElementById(
        UI.PHYSICAL_DATA_BUTTON_ID
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "读取中...";
    }

    try {
      /*
       * 当前 DOM 有完整汇总则直接读取；
       * 没有真实数据时才自动切换到体检名单。
       */
      const physicalResult =
        await ensurePhysicalExamSummaryAvailable();

      const physical =
        physicalResult.data;

      renderPhysicalExamSummary(
        physical
      );

      const orderCode =
        getCurrentOrderCode();

      const cardCorpCode =
        getCurrentCardCorpCode();

      let cardPool =
        null;

      if (!cardCorpCode) {
        renderCardPoolCodeUnavailable();
      } else {
        cardPool =
          getCachedCardPoolData(
            orderCode,
            cardCorpCode
          );

        if (!cardPool) {
          const grid =
            document.getElementById(
              UI.CARD_POOL_DATA_GRID_ID
            );

          if (grid) {
            grid.innerHTML = `
              <div style="
                grid-column:1 / -1;
                color:#44546a;
                font-size:11px;
                font-weight:700;
                line-height:1.35;
              ">
                卡类数量
              </div>

              <div style="
                grid-column:1 / -1;
                padding:8px;
                border:1px solid #e5e7eb;
                border-radius:6px;
                background:#fff;
                color:#7b8494;
                font-size:11px;
                font-weight:500;
                text-align:center;
              ">
                正在查询套餐卡、储值卡、电商卡...
              </div>
            `;

            grid.style.display =
              "grid";
            grid.style.marginTop =
              "9px";
            grid.style.padding =
              "8px";
            grid.style.border =
              "1px solid #e3f1d5";
            grid.style.borderRadius =
              "7px";
            grid.style.background =
              "#fbfff8";
          }

          cardPool =
            await fetchAllCardPoolTotals(
              cardCorpCode
            );

          saveCachedCardPoolData(
            orderCode,
            cardCorpCode,
            cardPool
          );
        }

        renderCardPoolSummary(
          cardPool,
          cardCorpCode
        );
      }

      const title =
        document.getElementById(
          UI.DATA_PANEL_TITLE_ID
        );

      if (title) {
        title.textContent =
          "体检数据 · 汇总";
      }

      const cardSuccessCount =
        cardPool
          ? [
              cardPool.packageCard,
              cardPool.storedValueCard,
              cardPool.ecommerceCard
            ].filter(
              item =>
                item?.ok
            ).length
          : 0;

      if (
        physical &&
        cardSuccessCount === 3
      ) {
        updatePanelStatus(
          physicalResult.navigated
            ? "✓ 已切换体检名单并读取体检汇总及三类卡数量。"
            : "✓ 已直接读取当前页体检汇总及三类卡数量。",
          "success"
        );
      } else if (
        physical ||
        cardSuccessCount > 0
      ) {
        updatePanelStatus(
          "数据已部分读取，请查看结果。"
        );
      } else {
        updatePanelStatus(
          "未读取到可用数据。",
          "error"
        );
      }
    } finally {
      physicalDataQueryRunning =
        false;

      if (button) {
        button.disabled =
          false;

        button.textContent =
          "体检数据";
      }
    }
  }

  function hasFreshCombinedDataCache(
    orderCode
  ) {
    return Boolean(
      orderCode &&
      combinedDataCache.orderCode === orderCode &&
      combinedDataCache.data
    );
  }

  async function loadCombinedDataOnOpen(
    force = false
  ) {
    syncDataOrderContext();

    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      updatePanelStatus(
        "未识别到当前订单编号。",
        "error"
      );
      return;
    }

    if (
      combinedDataQueryRunning ||
      physicalDataQueryRunning
    ) {
      updatePanelStatus(
        "数据正在查询中，请稍候..."
      );
      return;
    }

    const panel =
      document.getElementById(
        UI.DATA_PANEL_ID
      );

    const title =
      document.getElementById(
        UI.DATA_PANEL_TITLE_ID
      );

    if (!panel || !title) {
      return;
    }

    panel.style.display =
      "block";

    activeDataPanelMode =
      "combined";

    if (
      !force &&
      hasFreshCombinedDataCache(
        orderCode
      )
    ) {
      const cache =
        combinedDataCache.data;

      resetDataPanelContent();

      if (cache.landingOptions) {
        cachedLandingTimeOptions =
          cache.landingOptions;

        renderLandingExtractOptions(
          cache.landingOptions
        );
      }

      if (cache.physical) {
        renderPhysicalExamSummary(
          cache.physical
        );
      }

      if (cache.cardPool && cache.cardCorpCode) {
        renderCardPoolSummary(
          cache.cardPool,
          cache.cardCorpCode
        );
      }

      title.textContent =
        "体检数据 · 已加载";

      updatePanelStatus(
        "✓ 已复用当前订单页面缓存。",
        "success"
      );

      return;
    }

    combinedDataQueryRunning =
      true;
    physicalDataQueryRunning =
      true;

    resetDataPanelContent();
    panel.style.display =
      "block";
    title.textContent =
      "体检数据 · 读取中...";

    let landingOk = false;
    let physical = null;
    let physicalResult = null;
    let cardPool = null;

    try {
      if (
        getCurrentFlowStage() ===
        "已落单"
      ) {
        try {
          const landingOptions =
            await refreshLandingTimeOptions();

          landingOk =
            landingOptions.length > 0;
        } catch (error) {
          warn(
            `读取落单数据失败：${error?.message || error}`
          );
        }
      } else {
        renderLandingExtractOptions(
          []
        );
      }

      physicalResult =
        await ensurePhysicalExamSummaryAvailable();

      physical =
        physicalResult.data;

      renderPhysicalExamSummary(
        physical
      );

      const cardCorpCode =
        getCurrentCardCorpCode();

      if (!cardCorpCode) {
        renderCardPoolCodeUnavailable();
      } else {
        cardPool =
          getCachedCardPoolData(
            orderCode,
            cardCorpCode
          );

        if (!cardPool) {
          const grid =
            document.getElementById(
              UI.CARD_POOL_DATA_GRID_ID
            );

          if (grid) {
            grid.innerHTML = `
              <div style="
                grid-column:1 / -1;
                color:#44546a;
                font-size:11px;
                font-weight:700;
                line-height:1.35;
              ">
                卡类数量
              </div>

              <div style="
                grid-column:1 / -1;
                padding:8px;
                border:1px solid #e5e7eb;
                border-radius:6px;
                background:#fff;
                color:#7b8494;
                font-size:11px;
                font-weight:500;
                text-align:center;
              ">
                正在查询套餐卡、储值卡、电商卡...
              </div>
            `;

            grid.style.display =
              "grid";
            grid.style.marginTop =
              "9px";
            grid.style.padding =
              "8px";
            grid.style.border =
              "1px solid #e3f1d5";
            grid.style.borderRadius =
              "7px";
            grid.style.background =
              "#fbfff8";
          }

          cardPool =
            await fetchAllCardPoolTotals(
              cardCorpCode
            );

          saveCachedCardPoolData(
            orderCode,
            cardCorpCode,
            cardPool
          );
        }

        renderCardPoolSummary(
          cardPool,
          cardCorpCode
        );
      }

      title.textContent =
        "体检数据 · 汇总";

      const cardSuccessCount =
        cardPool
          ? [
              cardPool.packageCard,
              cardPool.storedValueCard,
              cardPool.ecommerceCard
            ].filter(
              item =>
                item?.ok
            ).length
          : 0;

      if (
        landingOk ||
        physical ||
        cardSuccessCount > 0
      ) {
        combinedDataCache = {
          orderCode,
          data: {
            landingOptions:
              [...cachedLandingTimeOptions],
            physical,
            cardPool,
            cardCorpCode:
              getCurrentCardCorpCode()
          }
        };
      }

      if (
        physical &&
        cardSuccessCount === 3
      ) {
        updatePanelStatus(
          physicalResult?.navigated
            ? "✓ 已自动读取落单数据，并切换体检名单获取体检汇总及三类卡数量。"
            : "✓ 已自动读取落单数据、体检汇总及三类卡数量。",
          "success"
        );
      } else if (
        landingOk ||
        physical ||
        cardSuccessCount > 0
      ) {
        updatePanelStatus(
          "数据已部分读取，请查看结果。"
        );
      } else {
        updatePanelStatus(
          "未读取到可用数据。",
          "error"
        );
      }
    } finally {
      physicalDataQueryRunning =
        false;
      combinedDataQueryRunning =
        false;
    }
  }

  function getCachedCardPoolData(
    orderCode,
    cardCorpCode
  ) {
    if (
      !orderCode ||
      !cardCorpCode ||
      cardPoolQueryCache.orderCode !==
        orderCode ||
      cardPoolQueryCache.cardCorpCode !==
        cardCorpCode ||
      !cardPoolQueryCache.data
    ) {
      return null;
    }

    if (
      Date.now() -
        cardPoolQueryCache.timestamp >
      CARD_POOL_CACHE_MS
    ) {
      return null;
    }

    return cardPoolQueryCache.data;
  }

  function saveCachedCardPoolData(
    orderCode,
    cardCorpCode,
    data
  ) {
    cardPoolQueryCache = {
      orderCode,
      cardCorpCode,
      timestamp:
        Date.now(),
      data:
        data || null
    };
  }

  function renderCardPoolCodeUnavailable() {
    const grid =
      document.getElementById(
        UI.CARD_POOL_DATA_GRID_ID
      );

    if (!grid) {
      return;
    }

    grid.innerHTML = `
      <div style="
        grid-column:1 / -1;
        color:#44546a;
        font-size:11px;
        font-weight:700;
        line-height:1.35;
      ">
        卡类数量
      </div>

      <div style="
        grid-column:1 / -1;
        padding:8px;
        border:1px solid #ffccc7;
        border-radius:6px;
        background:#fff2f0;
        color:#cf1322;
        font-size:11px;
        font-weight:600;
        line-height:1.5;
        text-align:center;
      ">
        当前页面未读取到商机编号或单位代码，暂无法查询套餐卡、储值卡。
      </div>
    `;

    grid.style.display =
      "grid";
    grid.style.marginTop =
      "9px";
    grid.style.padding =
      "8px";
    grid.style.border =
      "1px solid #f7d4d1";
    grid.style.borderRadius =
      "7px";
    grid.style.background =
      "#fffafa";
  }

  function updateDataActionButtons(
    stage =
      getCurrentFlowStage()
  ) {
    const landing =
      document.getElementById(
        UI.LANDING_DATA_BUTTON_ID
      );

    if (landing) {
      const enabled =
        stage ===
        "已落单";

      landing.disabled =
        !enabled;

      landing.style.opacity =
        enabled
          ? "1"
          : "0.45";

      landing.style.cursor =
        enabled
          ? "pointer"
          : "not-allowed";

      landing.title =
        enabled
          ? "点击读取当前订单落单数据"
          : "订单进入已落单后可使用";
    }
  }

  function savePanelPosition(panel) {
    try {
      const rect =
        panel.getBoundingClientRect();

      localStorage.setItem(
        UI.POSITION_KEY,
        JSON.stringify({
          left: rect.left,
          top: rect.top
        })
      );
    } catch (_) {}
  }

  function restorePanelPosition(panel) {
    try {
      const raw =
        localStorage.getItem(
          UI.POSITION_KEY
        );

      if (!raw) {
        return;
      }

      const saved =
        JSON.parse(
          raw
        );

      if (
        !Number.isFinite(
          Number(saved.left)
        ) ||
        !Number.isFinite(
          Number(saved.top)
        )
      ) {
        return;
      }

      panel.style.left =
        `${Math.max(
          0,
          Math.min(
            window.innerWidth - 340,
            Number(saved.left)
          )
        )}px`;

      panel.style.top =
        `${Math.max(
          0,
          Math.min(
            window.innerHeight - 120,
            Number(saved.top)
          )
        )}px`;

      panel.style.right =
        "auto";

      panel.style.bottom =
        "auto";
    } catch (_) {}
  }

  function enablePanelDragging(panel) {
    const handle =
      panel.querySelector(
        `#${UI.DRAG_HANDLE_ID}`
      );

    if (!handle) {
      return;
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener(
      "mousedown",
      event => {
        if (
          event.button !== 0 ||
          event.target.closest(
            "button"
          )
        ) {
          return;
        }

        const rect =
          panel.getBoundingClientRect();

        dragging = true;
        offsetX =
          event.clientX - rect.left;
        offsetY =
          event.clientY - rect.top;

        panel.style.left =
          `${rect.left}px`;
        panel.style.top =
          `${rect.top}px`;
        panel.style.right =
          "auto";
        panel.style.bottom =
          "auto";

        event.preventDefault();
      }
    );

    window.addEventListener(
      "mousemove",
      event => {
        if (!dragging) {
          return;
        }

        const maxLeft =
          Math.max(
            0,
            window.innerWidth -
              panel.offsetWidth
          );

        const maxTop =
          Math.max(
            0,
            window.innerHeight -
              panel.offsetHeight
          );

        panel.style.left =
          `${Math.max(
            0,
            Math.min(
              maxLeft,
              event.clientX -
                offsetX
            )
          )}px`;

        panel.style.top =
          `${Math.max(
            0,
            Math.min(
              maxTop,
              event.clientY -
                offsetY
            )
          )}px`;
      }
    );

    window.addEventListener(
      "mouseup",
      () => {
        if (!dragging) {
          return;
        }

        dragging = false;
        savePanelPosition(
          panel
        );
      }
    );
  }

  function createPanel() {
    const existing =
      document.getElementById(
        UI.PANEL_ID
      );

    if (existing) {
      updateDataActionButtons();
      return existing;
    }

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      UI.PANEL_ID;

    panel.style.cssText = [
      "position:fixed",
      "display:none",
      "right:380px",
      "bottom:28px",
      "z-index:99998",
      "width:340px",
      "box-sizing:border-box",
      "padding:10px 14px 14px",
      "border:1px solid #e5e7eb",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 28px rgba(0,0,0,.18)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif",
      "font-size:13px",
      "line-height:1.45",
      "color:#344054"
    ].join(";");

    panel.innerHTML = `
      <div
        id="${UI.DRAG_HANDLE_ID}"
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          min-height:28px;
          margin:-2px -4px 8px;
          padding:2px 4px;
          cursor:move;
        "
      >
        <strong style="
          color:#303846;
          font-size:15px;
          font-weight:700;
        ">
          体检数据 v1.7.5
        </strong>

        <div style="
          display:flex;
          align-items:center;
          gap:7px;
          margin-left:auto;
        ">
          <button
            id="${UI.REFRESH_ID}"
            type="button"
            title="重新查询当前订单的落单、体检及卡类数据"
            style="
              height:28px;
              padding:0 12px;
              border:1px solid #87e8de;
              border-radius:7px;
              background:linear-gradient(135deg,#e6fffb 0%,#f0fdfa 100%);
              color:#08979c;
              box-shadow:0 2px 7px rgba(19,168,168,.12);
              font-size:12px;
              font-weight:600;
              line-height:26px;
              cursor:pointer;
              white-space:nowrap;
              transition:all .18s ease;
            "
          >刷新数据</button>

          <button
            id="${UI.CLOSE_ID}"
            type="button"
            title="关闭"
            style="
              width:28px;
              height:28px;
              border:0;
              border-radius:7px;
              background:#f5f5f5;
              color:#666;
              font-size:15px;
              cursor:pointer;
            "
          >×</button>
        </div>
      </div>

      <div
        id="${UI.DATA_PANEL_ID}"
        style="
          display:block;
          margin-top:8px;
          padding:7px;
          border:1px solid #e5e7eb;
          border-radius:6px;
          background:#fff;
        "
      >
        <div
          id="${UI.DATA_PANEL_TITLE_ID}"
          style="
            margin-bottom:8px;
            color:#3f4a5a;
            font-size:12px;
            font-weight:700;
            line-height:1.4;
            text-align:center;
          "
        ></div>

        <div
          id="${UI.EXTRACT_OPTIONS_ID}"
          style="display:none;"
        ></div>

        <div
          id="${UI.PHYSICAL_DATA_GRID_ID}"
          style="
            display:none;
            grid-template-columns:repeat(3,1fr);
            gap:5px;
          "
        ></div>

        <div
          id="${UI.CARD_POOL_DATA_GRID_ID}"
          style="
            display:none;
            grid-template-columns:1fr 1fr;
            gap:6px;
            margin-top:9px;
          "
        ></div>


        <div
          id="${UI.EXTRACT_PREVIEW_ID}"
          style="
            display:none;
            margin-top:6px;
            padding:6px 7px;
            border:1px solid #d9f7be;
            border-radius:5px;
            background:#fcfff8;
            color:#4b5563;
            font-size:11px;
            font-weight:500;
            line-height:1.5;
            white-space:pre-wrap;
            word-break:break-all;
            user-select:text;
          "
        ></div>
      </div>

      <div
        id="${UI.STATUS_ID}"
        style="
          display:none;
          margin-top:8px;
          padding:7px 8px;
          border-radius:6px;
          font-size:12px;
          font-weight:500;
          line-height:1.5;
          word-break:break-all;
        "
      ></div>

      <div style="
        margin-top:7px;
        color:#7b8494;
        font-size:11px;
        font-weight:500;
        line-height:1.55;
      ">
        首次打开自动读取当前订单数据；需要更新时点击“刷新数据”。三类卡固定显示并支持点击数量进入对应卡池查询；有数据的套餐卡/储值卡可点击“查询备注”，完成后点击“查看备注”打开详情。
      </div>
    `;

    document.body.appendChild(
      panel
    );

    restorePanelPosition(
      panel
    );

    enablePanelDragging(
      panel
    );

    panel
      .querySelector(
        `#${UI.CLOSE_ID}`
      )
      ?.addEventListener(
        "click",
        () =>
          setPanelVisible(
            false
          )
      );

    panel
      .querySelector(
        `#${UI.REFRESH_ID}`
      )
      ?.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          refreshPhysicalDataPanel();
        }
      );



    updateDataActionButtons();

    panel.style.display =
      panelVisible
        ? "block"
        : "none";

    return panel;
  }

  function updatePageSwitch() {
    const button =
      document.getElementById(
        UI.PAGE_SWITCH_ID
      );

    if (!button) {
      return;
    }

    button.textContent =
      panelVisible
        ? "关闭体检数据"
        : "查询体检数据";

    button.title =
      panelVisible
        ? "关闭体检数据面板"
        : "查询当前订单体检数据";
  }


  async function refreshPhysicalDataPanel() {
    if (
      combinedDataQueryRunning ||
      physicalDataQueryRunning ||
      cardRemarkQueryRunning
    ) {
      updatePanelStatus(
        "数据正在查询中，请稍候..."
      );
      return;
    }

    syncDataOrderContext();

    const button =
      document.getElementById(
        UI.REFRESH_ID
      );

    if (button) {
      button.disabled = true;
      button.textContent = "刷新中...";
      button.style.opacity = "0.62";
      button.style.cursor = "wait";
      button.style.boxShadow = "none";
    }

    try {
      /*
       * 手动刷新只刷新数据，不改变窗体开关状态。
       * 保持panelVisible=true，并确保当前窗体继续显示。
       */
      panelVisible = true;

      const panel =
        document.getElementById(
          UI.PANEL_ID
        );

      if (panel) {
        panel.style.display =
          "block";
      }

      combinedDataCache = {
        orderCode: "",
        data: null
      };

      cardPoolQueryCache = {
        orderCode: "",
        cardCorpCode: "",
        timestamp: 0,
        data: null
      };

      resetCardRemarkDiscovery();

      await loadCombinedDataOnOpen(true);

      updatePanelStatus(
        "✓ 数据已重新查询。",
        "success"
      );
    } catch (error) {
      warn(
        error?.message ||
        String(error)
      );
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "刷新数据";
        button.style.opacity = "1";
        button.style.cursor = "pointer";
        button.style.boxShadow =
          "0 2px 7px rgba(19,168,168,.12)";
      }
    }
  }

  function setPanelVisible(visible) {
    panelVisible =
      Boolean(
        visible
      );

    const panel =
      document.getElementById(
        UI.PANEL_ID
      ) ||
      createPanel();

    if (panel) {
      panel.style.display =
        panelVisible
          ? "block"
          : "none";
    }

    if (!panelVisible) {
      closeCardRemarkDetailModal();
    }

    if (panelVisible) {
      syncDataOrderContext();

      loadCombinedDataOnOpen()
        .catch(
          error => {
            warn(
              error?.message ||
              String(error)
            );

            updatePanelStatus(
              error?.message ||
              String(error),
              "error"
            );
          }
        );
    }

    updatePageSwitch();
  }

  function ensureToolboxFrame(
    group
  ) {
    if (!group) {
      return;
    }

    /*
     * 工具箱边框和底部文字通过伪元素向外绘制。
     * 不增加group本身的上下padding/height，
     * 因此按钮仍按原32px高度参与页面布局，
     * 不会因为底部标识导致整组按钮向上偏移。
     */
    group.style.cssText = [
      "display:inline-flex",
      "position:relative",
      "flex:0 0 auto",
      "align-items:center",
      "gap:6px",
      "margin-left:10px",
      "margin-right:7px",
      "padding:0",
      "border:0",
      "background:transparent",
      "box-sizing:border-box",
      "vertical-align:middle",
      "overflow:visible",
      "isolation:isolate"
    ].join(";");

    let style =
      document.getElementById(
        TOOLBOX_STYLE_ID
      );

    if (!style) {
      style =
        document.createElement(
          "style"
        );

      style.id =
        TOOLBOX_STYLE_ID;

      document.head.appendChild(
        style
      );
    }

    /*
     * 每次覆盖当前生效样式。
     * 即使页面里残留旧版本style，也以当前版本为准。
     */
    style.textContent = `
      #__soa_tools_switch_group_v10 {
        position: relative !important;
        overflow: visible !important;
      }

      #__soa_tools_switch_group_v10::before {
        content: "";
        position: absolute;
        left: -7px;
        right: -7px;
        top: -5px;
        bottom: -16px;
        border: 1px solid #bfd0e4;
        border-radius: 8px;
        background: rgba(240, 247, 255, 0.82);
        box-sizing: border-box;
        pointer-events: none;
        z-index: 0;
      }

      #__soa_tools_switch_group_v10::after {
        content: "红领巾的工具箱";
        position: absolute;
        right: -1px;
        bottom: -13px;
        color: #6f8299;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: .2px;
        white-space: nowrap;
        pointer-events: none;
        z-index: 2;
      }

      #__soa_tools_switch_group_v10 > button[data-soa-tool-order] {
        position: relative;
        z-index: 1;
      }
    `;
  }

  function ensurePageSwitch() {
    if (!isOrderRoute()) {
      return null;
    }

    const orderDesc =
      document.querySelector(
        ".tabs-wrap > .tabs > .order-desc"
      );

    const tabs =
      orderDesc?.parentElement;

    if (!tabs) {
      return null;
    }

    const groupId =
      "__soa_tools_switch_group_v10";

    let group =
      document.getElementById(
        groupId
      );

    if (!group) {
      group =
        document.createElement(
          "span"
        );

      group.id =
        groupId;

      group.style.cssText = [
        "display:inline-flex",
        "flex:0 0 auto",
        "align-items:center",
        "gap:6px",
        "margin-left:10px"
      ].join(";");

      tabs.insertBefore(
        group,
        orderDesc
      );
    } else if (
      group.parentElement !==
        tabs
    ) {
      tabs.insertBefore(
        group,
        orderDesc
      );
    }

    ensureToolboxFrame(
      group
    );

    let button =
      document.getElementById(
        UI.PAGE_SWITCH_ID
      );

    if (!button) {
      button =
        document.createElement(
          "button"
        );

      button.id =
        UI.PAGE_SWITCH_ID;

      button.type =
        "button";

      button.dataset.soaToolOrder =
        "2";

      button.style.cssText = [
        "display:inline-flex",
        "flex:0 0 auto",
        "align-items:center",
        "justify-content:center",
        "height:32px",
        "padding:0 12px",
        "border:1px solid #13a8a8",
        "border-radius:6px",
        "background:#13a8a8",
        "color:#fff",
        "font-size:13px",
        "font-weight:600",
        "line-height:30px",
        "cursor:pointer",
        "white-space:nowrap",
        "box-sizing:border-box"
      ].join(";");

      button.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          setPanelVisible(
            !panelVisible
          );
        }
      );
    }

    if (
      button.parentElement !==
        group
    ) {
      group.appendChild(
        button
      );
    }

    const currentToolButtons =
      Array.from(
        group.querySelectorAll(
          "button[data-soa-tool-order]"
        )
      );

    const sortedToolButtons =
      [
        ...currentToolButtons
      ].sort(
        (a, b) =>
          Number(a.dataset.soaToolOrder || 999) -
          Number(b.dataset.soaToolOrder || 999)
      );

    const toolOrderChanged =
      currentToolButtons.some(
        (item, index) =>
          item !==
          sortedToolButtons[index]
      );

    if (toolOrderChanged) {
      sortedToolButtons.forEach(
        item =>
          group.appendChild(item)
      );
    }

    updatePageSwitch();

    return button;
  }

  function scheduleUi() {
    if (uiScheduled) {
      return;
    }

    uiScheduled = true;

    requestAnimationFrame(
      () => {
        uiScheduled = false;

        if (!isOrderRoute()) {
          return;
        }

        createPanel();
        ensurePageSwitch();
        syncDataOrderContext();
        updateDataActionButtons();
      }
    );
  }

  function connectObserver() {
    if (routeObserver) {
      return;
    }

    routeObserver =
      new MutationObserver(
        () => {
          if (!isOrderRoute()) {
            return;
          }

          syncDataOrderContext();
          updateDataActionButtons();
          scheduleUi();
        }
      );

    routeObserver.observe(
      document.querySelector(
        "#root"
      ) ||
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function teardownOrderUi() {
    panelVisible = false;
    activeDataPanelMode = "";
    lastDataPanelOrderCode = "";
    cachedLandingTimeOptions = [];
    physicalDataQueryRunning = false;
    combinedDataQueryRunning = false;
    cardRemarkQueryRunning = "";

    resetCardRemarkDiscovery();

    combinedDataCache = {
      orderCode: "",
      data: null
    };

    cardPoolQueryCache = {
      orderCode: "",
      cardCorpCode: "",
      timestamp: 0,
      data: null
    };

    cardCorpCodeMemory.clear();

    document
      .getElementById(
        UI.PAGE_SWITCH_ID
      )
      ?.remove();

    const switchGroup =
      document.getElementById(
        "__soa_tools_switch_group_v10"
      );

    if (
      switchGroup &&
      !switchGroup.children.length
    ) {
      switchGroup.remove();
    }

    document
      .getElementById(
        UI.PANEL_ID
      )
      ?.remove();

    routeObserver?.disconnect();
    routeObserver = null;
  }

  function routeCheck() {
    if (
      location.hash.startsWith(
        CARD_GROUP_ROUTE
      )
    ) {
      teardownOrderUi();

      processPendingCardGroupQuery()
        .catch(
          error =>
            console.warn(
              "[SOA订单数据] 卡池自动查询失败：",
              error
            )
        );

      return;
    }

    if (isOrderRoute()) {
      connectObserver();
      scheduleUi();
      return;
    }

    teardownOrderUi();
  }

  window.addEventListener(
    "hashchange",
    routeCheck,
    true
  );

  window.addEventListener(
    "popstate",
    routeCheck,
    true
  );

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      routeCheck,
      {
        once: true
      }
    );
  } else {
    routeCheck();
  }
})();
