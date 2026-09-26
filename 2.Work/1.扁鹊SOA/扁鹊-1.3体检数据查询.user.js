// ==UserScript==
// @name         扁鹊-1.3体检数据查询
// @namespace    https://tampermonkey.net/
// @version      1.11.9
// @description  SOA体检数据：自动读取落单数据、体检汇总与三类卡数量；卡类数量/状态左键看卡片明细（自动按制卡批次带出备注）、右键跳卡池。注意：卡类查询需要账号对应权限

// @match        https://checkup-soa3.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-dingdandata
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdandata.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdandata.user.js
// ==/UserScript==

/*
 * SOA.3.2体检数据（扁鹊-1.3）
 *
 * 功能
 *
 * 【落单数据】已落单订单按需读取落单时间记录，支持复制为表格行。
 *
 * 【体检汇总】读取体检总人数、已检/未检人数、到检/挂账/自费金额。
 *
 * 【卡类数量】套餐卡 / 储值卡 / 电商卡三类固定显示（0 张也占位，避免 UI 跳动）。
 *   每类按 status 统计成状态明细（生效中 / 已核销 / 已预约 / 冻结 / 作废）：
 *   「数量」左键 → 卡片明细弹窗（列全部）；「状态明细」整条是可点色块，
 *   左键 → 同一个弹窗但只列该状态；两者的右键都是跳对应卡池（新标签页打开并自动填单位代码查询）。
 *   打开面板即自动查询，同订单 15 秒内复用结果。
 *
 * 【卡片明细弹窗】列表为 卡号 / 卡类 / 状态 / 有效期 / 金额 / 备注，数据全部来自已查到的卡池 items，不发请求；
 *   点某一行就地展开该卡详情（含所属制卡批次的卡号区间 / 办卡日期 / 卡数 / 备注）。
 *   备注列随批次读取结果自动回填。
 *   「金额」列与详情里的金额**都是成交价**（套餐/电商卡取卡池 price，储值卡取 saleAmount），
 *   不显示面值/原价 —— 口径实测依据见 getPoolItemAmountInfo 上方注释（2026-09-26）。
 *
 * 【卡备注 · 制卡批次】打开明细弹窗即自动读取该卡类的制卡审批：
 *   1) 卡池卡号按「同前缀 + 序号连续」切成连续段（跳号处断开）；
 *   2) 段内取靠近中点的卡作代表，查制卡审批 process/page；
 *   3) 按审批返回区间细分：完整覆盖当前子区间 → 整段同批；只压住一侧 → 区间外左右两侧递归；
 *      该卡查不到记录 → 换段内另一张再试，全试完才放弃这一段；
 *   4) 判区间的同时顺带取 process/detail，把备注一并拿回（每个批次 1 次请求）；
 *   5) 可疑批次（区间长度与审批卡数不符 / 归属单位不符 / 与其它区间重叠）不参与剪枝，
 *      改为只针对这一条加密核对：重叠段逐段复核；长度不符则按卡池卡号每 10 张取一点
 *      （步长 CARD_REMARK_SUSPECT_PROBE_STEP）。干净批次零额外请求。
 *   批次区块**默认折叠**，标题行右侧「展开批次」按钮高亮；标题行始终可见（含批次数量与待确认提示）。
 *   备注结果只存在当前标签页内存，刷新数据 / 切换订单 / 切换单位代码时清空。
 *
 * 【卡号规则】17 位 = 年份2 + 标识3 + 活动码6 + 序号6；区间比较必须「同组前缀 + 序号落在区间内」。
 *   制卡审批**只能按卡号查**：订单名称会重复，且 orderCode / soaOrderNo / corpCode / cardCorpCode
 *   这几个过滤条件实测都被服务端忽略（一律返回全量），不存在“按订单一次拉全部审批”的接口。
 *
 * 【口径基线】卡类数据以「按 cardCorpCode 查到的卡池」为准 —— 卡是活的（归属订单会被调整），
 *   审批是历史记录。所以池内张数少于审批声明张数属正常，不按审批反查补全（会把已调走的卡拉回来）。
 *
 * 【其它】卡池返回的 card_pwd（卡密）统一剔除，弹窗只按白名单取字段；
 *   与 SOA.3.1 智能审批完全解耦，不修改订单业务数据。卡类查询需要账号对应权限。
 *
 */

(() => {
  "use strict";

  /*
   * ⚠️ 版本号（单一来源）
   * 面板标题显示的就是这个常量，**必须与文件头的 `@version` 完全一致**；
   * 改版本时两处一起改（`@grant none` 读不到元数据，没法自动同步）。
   * 2026-09-21 红领巾提醒：面板标题里原来是硬编码的 v1.7.7，早就和 @version 脱节了。
   */
  const SCRIPT_VERSION = "1.11.9";

  const ORDER_ROUTE_PREFIX =
    "#/order/";

  const CARD_GROUP_ROUTE =
    "#/card/group";

  const CARD_GROUP_PENDING_KEY =
    "__soa_order_data_card_group_pending_v10";

  const CARD_POOL_CACHE_MS =
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

  /*
   * 可疑批次加密核对的步长：审批区间被判定可疑（长度与声明张数不符 /
   * 归属单位不符 / 与其它批次重叠）时，按卡池卡号每 N 张取一个探测点复核，
   * 用来发现"区间声明覆盖整段、中间却嵌着另一条审批"的情况。
   * ⚠️ 只对可疑批次生效 —— 干净批次零额外请求。
   */
  const CARD_REMARK_SUSPECT_PROBE_STEP = 10;

  /*
   * 卡号结构（与「扁鹊-1.6制卡管理查询」共用同一套规则）：
   *   年份(2) + 标识(3) + 活动码(6) + 序号(6) = 17 位
   *
   * ⚠️ 不要再用「卡号后5位」当区间比较键（v1.7.x 及更早的做法）：
   *   序号本身是 6 位，取后5位等于把最高位丢掉 —— 只有在同一 10 万区间内
   *   巧合成立；一旦批次跨 `…xxx999 → …yyy005` 这种第 6 位进位，区间就会误判
   *   （误判后果：漏查某批备注，或把别批的卡错并进已知区间而跳过）。
   */
  const CARD_HEAD_LEN = 5;
  const ACTIVITY_LEN = 6;
  const SERIAL_LEN = 6;
  const CARD_NO_LEN =
    CARD_HEAD_LEN +
    ACTIVITY_LEN +
    SERIAL_LEN;

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
    CARD_LIST_MODAL_ID:
      "__soa_data_card_list_modal_v180",
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

    /*
     * 卡密一律不留在内存里：三个卡池接口都会返回 card_pwd / cardPwd，
     * 面板与卡片明细弹窗都不需要它。删掉可以避免任何后续渲染把它带出来
     * （弹窗只按白名单取字段，这里是第二道保险）。
     */
    items.forEach(
      item => {
        if (
          item &&
          typeof item ===
            "object"
        ) {
          delete item.card_pwd;
          delete item.cardPwd;
        }
      }
    );

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

  /*
   * 结构化解析卡号。长度或分段不符合 17 位规则的一律返回 null
   * （旧版纯数字卡不在本脚本的批次识别范围内，直接跳过即可）。
   */
  function splitCardNo(
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
      text.length !==
      CARD_NO_LEN
    ) {
      return null;
    }

    const head =
      text.slice(
        0,
        CARD_HEAD_LEN
      );

    const activity =
      text.slice(
        CARD_HEAD_LEN,
        CARD_HEAD_LEN +
          ACTIVITY_LEN
      );

    const serialText =
      text.slice(
        -SERIAL_LEN
      );

    if (
      !/^\d{2}[A-Za-z0-9]{3}$/.test(
        head
      )
    ) {
      return null;
    }

    if (
      !/^\d+$/.test(
        activity
      ) ||
      !/^\d+$/.test(
        serialText
      )
    ) {
      return null;
    }

    return {
      cardNo:
        text,
      head,
      activity,
      // 分组键：年份 + 标识 + 活动码，同一个活动的卡才比序号
      prefix:
        head +
        activity,
      serial:
        Number(
          serialText
        ),
      serialText
    };
  }

  function isSameCardGroup(
    a,
    b
  ) {
    return Boolean(
      a &&
      b &&
      a.prefix ===
        b.prefix
    );
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

      const parsed =
        splitCardNo(
          cardNo
        );

      /*
       * 卡号不符合 17 位结构（旧版纯数字卡等）直接跳过：
       * 既参与不了批次区间比较，也不该拖慢制卡查询。
       */
      if (
        !cardNo ||
        !parsed
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
            prefix:
              parsed.prefix,
            serial:
              parsed.serial,
            itemOrderCode,
            item
          }
        );
      }
    }

    /*
     * 先按卡号分组（年份+标识+活动码），组内再按序号升序。
     * 这样每轮取到的「最小未覆盖卡」天然落在同一活动内，
     * 制卡记录返回的 beginNo~endNo 也才可能同组、可用于区间复用。
     */
    return Array.from(
      unique.values()
    ).sort(
      (a, b) =>
        a.prefix.localeCompare(
          b.prefix,
          "en"
        ) ||
        a.serial -
          b.serial ||
        a.cardNo.localeCompare(
          b.cardNo,
          "en"
        )
    );
  }

  /*
   * 把制卡详情返回的 beginNo ~ endNo 折成「同组前缀 + 序号区间」。
   *
   * 与 1.6 制卡脚本同一口径：
   * - 起止都解析成功且**同组**（年份+标识+活动码一致）→ 得到真正的区间；
   * - 起止跨组 / 任一解析失败 → 不自动拆分，退回「只认这一张卡」；
   *   宁可按单卡算，也不能把两个活动的号段错并成一个区间。
   */
  function normalizeBatchSerialRange(
    beginNo,
    endNo,
    fallbackCardNo
  ) {
    const begin =
      splitCardNo(
        beginNo
      );

    const end =
      splitCardNo(
        endNo
      );

    if (
      isSameCardGroup(
        begin,
        end
      )
    ) {
      return {
        prefix:
          begin.prefix,
        startSerial:
          Math.min(
            begin.serial,
            end.serial
          ),
        endSerial:
          Math.max(
            begin.serial,
            end.serial
          ),
        // 起止倒置由 min/max 吸收，这里只记一笔供诊断
        inverted:
          begin.serial >
          end.serial
      };
    }

    const fallback =
      splitCardNo(
        fallbackCardNo
      );

    if (fallback) {
      return {
        prefix:
          fallback.prefix,
        startSerial:
          fallback.serial,
        endSerial:
          fallback.serial,
        inverted:
          false
      };
    }

    return {
      prefix:
        "",
      startSerial:
        null,
      endSerial:
        null,
      inverted:
        false
    };
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

  /*
   * 同一张卡可能落在多条制卡审批里（同一号段被反复申请：跳号作废后重新提交、
   * 号码被复用）。所以命中多条时不能只取第一条，要按下面的顺序**再判定一次**：
   *   ① 未作废的优先（ACCESS 优于 INVALID）
   *   ② 区间更窄的优先（更具体的审批才是这张卡真正所属的那条）
   *   ③ 申请/绑定时间更新的优先（号码重用时以最后生效的为准）
   * 找不到任何区间命中时，才退回「同订单里第一条有 id 的记录」。
   */
  function getProcessRecordSpan(
    item
  ) {
    const begin =
      splitCardNo(
        item?.beginNo
      );

    const end =
      splitCardNo(
        item?.endNo
      );

    if (
      !isSameCardGroup(
        begin,
        end
      )
    ) {
      return Number.MAX_SAFE_INTEGER;
    }

    return (
      Math.abs(
        end.serial -
        begin.serial
      ) +
      1
    );
  }

  function getProcessRecordTime(
    item
  ) {
    const text =
      cleanText(
        item?.bindTime
      ) ||
      cleanText(
        item?.financeProcessTime
      ) ||
      cleanText(
        item?.internalProcessTime
      ) ||
      cleanText(
        item?.orderTime
      );

    const match =
      text.match(
        /\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{1,2}:\d{1,2})?/
      );

    if (!match) {
      return 0;
    }

    const parsed =
      Date.parse(
        match[0].replace(
          " ",
          "T"
        )
      );

    return Number.isFinite(
      parsed
    )
      ? parsed
      : 0;
  }

  function isProcessRecordInvalid(
    item
  ) {
    return /INVALID|作废/i.test(
      cleanText(
        item?.processStatus
      ) +
      cleanText(
        item?.processReason
      )
    );
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

    const parsedCard =
      splitCardNo(
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

    const covering =
      parsedCard
        ? pool
            .filter(
              item => {
                const begin =
                  splitCardNo(
                    item?.beginNo
                  );

                const end =
                  splitCardNo(
                    item?.endNo
                  );

                /*
                 * 必须同组（年份+标识+活动码一致）才比序号，
                 * 跨组区间不认 —— 否则会把别的活动的号段也算进来。
                 */
                if (
                  !isSameCardGroup(
                    parsedCard,
                    begin
                  ) ||
                  !isSameCardGroup(
                    parsedCard,
                    end
                  )
                ) {
                  return false;
                }

                const start =
                  Math.min(
                    begin.serial,
                    end.serial
                  );

                const stop =
                  Math.max(
                    begin.serial,
                    end.serial
                  );

                return (
                  parsedCard.serial >=
                    start &&
                  parsedCard.serial <=
                    stop
                );
              }
            )
            .sort(
              (a, b) => {
                const invalidDiff =
                  Number(
                    isProcessRecordInvalid(
                      a
                    )
                  ) -
                  Number(
                    isProcessRecordInvalid(
                      b
                    )
                  );

                if (
                  invalidDiff !==
                  0
                ) {
                  return invalidDiff;
                }

                const spanDiff =
                  getProcessRecordSpan(
                    a
                  ) -
                  getProcessRecordSpan(
                    b
                  );

                if (
                  spanDiff !==
                  0
                ) {
                  return spanDiff;
                }

                return (
                  getProcessRecordTime(
                    b
                  ) -
                  getProcessRecordTime(
                    a
                  )
                );
              }
            )
        : [];

    return (
      covering[0] ||
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

  /*
   * 审批时间（bindTime）—— 与上面的「办卡日期」刻意分开：
   *
   * cardDate 是多候选（**优先 detail.beginDate**），它是批次区块「办卡日期」的口径；
   * 而红领巾 2026-09-24 要的「审批时间」这一列，口径必须是确定的 bindTime，
   * 不能跟着候选顺序漂移（否则同一列有时显示 beginDate、有时显示 bindTime）。
   *
   * 实测（2026-09-24 真机打接口）：
   *   process/page   的 bindTime → 日期级   "2026-09-24"
   *   process/detail 的 bindTime → 到秒     "2026-09-24 15:52:00"
   * 这里统一截到日期（YYYY-MM-DD），与 1.6 那一列保持同一精度。
   * ⚠️ 两个接口都在调（备注用），**零新增请求**。
   */
  function extractCardBindTime(
    detail,
    record
  ) {
    const text =
      cleanText(
        detail?.bindTime
      ) ||
      cleanText(
        record?.bindTime
      );

    if (!text) {
      return "";
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
          a.prefix.localeCompare(
            b.prefix,
            "en"
          ) ||
          Number(
            a.startSerial || 0
          ) -
            Number(
              b.startSerial || 0
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
        batch?.startSerial
      );

    const end =
      Number(
        batch?.endSerial
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

  // ============================================================
  // 卡片明细弹窗（面板数字「左键」入口）
  // ============================================================
  // 数据全部来自本地，**不发任何请求**：
  //   卡号 / 卡类 / 状态 / 有效期 / 领取人 → 已查到的卡池 items
  //   备注 → 卡备注查询结果，按 prefix + 序号区间命中批次
  // 点某一行就地展开这张卡的完整信息（含所属制卡批次的区间 / 办卡日期 / 卡数 / 备注）。
  //
  // ⚠️ 卡池 item 里带 card_pwd（卡密）：这里只按白名单取字段，
  //    绝不把整个 item 铺进 DOM，也不做 JSON 透传。
  /*
   * 卡片明细列表的列定义。
   * ⚠️ 表头与数据行**共用这一份** —— 两处各写一遍网格模板的话，加列时必漏一处
   *   （2026-09-22 加「有效期 / 金额」两列时就是这么栽的：先改了行、差点忘了表头）。
   */
  const CARD_LIST_COLUMNS = {
    gridTemplate:
      "minmax(0,140px) minmax(0,92px) 50px 76px 150px 74px minmax(0,1fr) 12px",
    headers: [
      "卡号",
      "卡类",
      "状态",
      "审批时间",
      "有效期",
      "金额",
      "备注"
    ]
  };

  const cardListModalState = {
    cardType: "",
    cardCorpCode: "",
    cardPool: null,
    result: null,
    // 空串 = 不过滤（「数量」入口）；填状态名 = 只列该状态（状态数字入口）
    statusFilter: "",
    /*
     * 制卡批次区块默认折叠（红领巾 2026-09-21 要求）：
     * 这个区块是补充信息，默认收起、需要时再展开，把位置让给卡片列表。
     */
    batchCollapsed: true
  };

  function pickPoolItemText(
    item,
    keys
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      return "";
    }

    for (
      const key of keys
    ) {
      const text =
        cleanText(
          item[key]
        );

      if (text) {
        return text;
      }
    }

    return "";
  }

  /*
   * 三个卡池的字段命名并不统一：
   *   套餐卡 / 电商卡 → snake_case（activity_name / card_sale_name）
   *   储值卡         → camelCase（activityName / cardSaleName）
   * 统一在这里收敛，渲染层不要再各写一套取值。
   */
  function getPoolItemActivityName(
    item
  ) {
    return pickPoolItemText(
      item,
      [
        "activity_name",
        "activityName",
        "card_type",
        "cardType"
      ]
    );
  }

  function getPoolItemSaleName(
    item
  ) {
    return pickPoolItemText(
      item,
      [
        "card_sale_name",
        "cardSaleName",
        "sale_name",
        "saleName",
        "nick_name"
      ]
    );
  }

  /*
   * 卡池里的日期有两种形态：
   *   套餐卡 / 电商卡 → 毫秒时间戳（begin_date / end_date）
   *   储值卡         → "YYYY-MM-DD" 字符串（beginDay / endDay）
   * 统一转成页面惯用的 YYYY-MM-DD 再展示。
   */
  /*
   * 卡池日期归一化 —— 统一输出 YYYY/MM/DD。
   * 卡池里日期有两种来源：13 位时间戳（套餐卡 / 参数卡）与 "2026-09-17" 这样的字符串（储值卡）。
   * 不归一的话同一个列表里会同时出现 2026/9/16 和 2026-09-17 两种写法（2026-09-22 实测），
   * 既难看、也没法按列对齐。补零后再配 tabular-nums，列宽才稳定。
   */
  function formatPoolItemDate(
    value
  ) {
    const text =
      cleanText(
        value
      );

    if (!text) {
      return "";
    }

    let year =
      null;

    let month =
      null;

    let day =
      null;

    if (/^\d{13}$/.test(text)) {
      const date =
        new Date(
          Number(text)
        );

      if (
        Number.isFinite(
          date.getTime()
        )
      ) {
        year =
          date.getFullYear();

        month =
          date.getMonth() +
          1;

        day =
          date.getDate();
      }
    } else {
      const match =
        text.match(
          /(\d{4})-(\d{1,2})-(\d{1,2})/
        );

      if (match) {
        year =
          Number(match[1]);

        month =
          Number(match[2]);

        day =
          Number(match[3]);
      }
    }

    if (
      year ===
        null ||
      !Number.isFinite(
        month
      ) ||
      !Number.isFinite(
        day
      )
    ) {
      /* 认不出来的原样返回，别把数据藏起来。 */
      return text;
    }

    const pad =
      number =>
        String(
          number
        ).padStart(
          2,
          "0"
        );

    return `${year}/${pad(month)}/${pad(day)}`;
  }

  function getPoolItemDateRange(
    item
  ) {
    const begin =
      formatPoolItemDate(
        pickPoolItemText(
          item,
          [
            "begin_date",
            "beginDay",
            "beginDate",
            "create_at",
            "createAt"
          ]
        )
      );

    const end =
      formatPoolItemDate(
        pickPoolItemText(
          item,
          [
            "end_date",
            "endDay",
            "endDate",
            "init_end_date"
          ]
        )
      );

    if (
      begin &&
      end &&
      begin !== end
    ) {
      return `${begin} ~ ${end}`;
    }

    return (
      begin ||
      end
    );
  }

  /*
   * 金额只取一个，并标明它是什么钱 —— **一律取「成交价」，不显示原价**
   * （红领巾 2026-09-26 要求）：
   *   套餐卡 / 电商卡 → price      （卡池实测：price＝成交价、sale_price＝面值）
   *   储值卡         → saleAmount （公司实收；储值卡池没有 price 字段）
   *
   * 2026-09-26 用真实登录态实测两张卡，卡池与卡详情两个接口交叉印证：
   *   24X7A212024020874（新乡邀约卡） price=50  sale_price=1020   ／ detail.saleAmount=50、currentAmount=1020
   *   26X7A210202011920（长垣套餐卡） price=700 sale_price=2364.30／ detail.saleAmount=700、currentAmount=2364.30
   * ⇒ sale_price / initAmount / currentAmount 都是面值（原价），price 才是成交价。
   * 取不到就不显示这一行 —— **不回落到原价**，免得又把面值当金额显示出来。
   * 不做单位换算、不猜语义。
   *
   * ⚠️ 与「扁鹊-1.6制卡管理查询」的 getPoolItemAmountInfo **保持逐字一致**，改一处两处一起改。
   */
  function getPoolItemAmountInfo(
    item
  ) {
    const matched =
      [
        ["price", "成交价"],
        ["saleAmount", "成交价"]
      ].find(([key]) => {
        const raw =
          item?.[key];

        return (
          raw !== undefined &&
          raw !== null &&
          String(raw).trim() !== "" &&
          Number.isFinite(
            Number(raw)
          )
        );
      });

    if (!matched) {
      return null;
    }

    return {
      label:
        matched[1],
      text:
        `¥${Number(item[matched[0]]).toFixed(2)}`
    };
  }

  /*
   * 状态色板：与「扁鹊-1.6制卡管理查询」的卡片状态色块同一套
   *（.hlj-card-status / is-enable / is-booked / is-used / is-freeze / is-invalid），
   * 保持两个脚本的视觉语言一致。
   */
  const CARD_STATUS_TONE = {
    生效中: {
      bg: "#ecfdf5",
      fg: "#15803d"
    },
    已预约: {
      bg: "#eff6ff",
      fg: "#1d4ed8"
    },
    /*
     * 已核销用灰（与「扁鹊-1.6」面板 .hlj-status-value.is-used 的 #f1f5f9 / #475569 一致）：
     * 1.6 的卡片弹窗胶囊把它画成紫色，两处本就不统一，这里以面板那套为准。
     */
    已核销: {
      bg: "#f1f5f9",
      fg: "#475569"
    },
    冻结: {
      bg: "#fff7ed",
      fg: "#c2410c"
    },
    作废: {
      bg: "#fef2f2",
      fg: "#b91c1c"
    },
    其他: {
      bg: "#f1f5f9",
      fg: "#475569"
    }
  };

  function getCardStatusTone(
    statusKey
  ) {
    return (
      CARD_STATUS_TONE[
        cleanText(
          statusKey
        )
      ] ||
      CARD_STATUS_TONE.其他
    );
  }

  function getCardStatusColor(
    label
  ) {
    if (label === "生效中") {
      return "#389e0d";
    }

    if (label === "已核销") {
      return "#7a8599";
    }

    if (label === "冻结") {
      return "#d46b08";
    }

    if (label === "作废") {
      return "#cf1322";
    }

    return "#1677ff";
  }

  /*
   * 在卡备注结果里反查这张卡属于哪个制卡批次。
   * 命中条件与探测口径**必须一致**：同前缀 + 序号落区间；
   * 多条命中时（号段被复用/嵌套）取**区间最窄**的那条 —— 越窄越具体，
   * 并列时取后入库的（Map 迭代按插入顺序，后探测到的更贴合实际归属）。
   */
  function findCardRemarkBatchForCardNo(
    cardNo,
    state
  ) {
    const parsed =
      splitCardNo(
        cardNo
      );

    if (
      !parsed ||
      !state
    ) {
      return null;
    }

    let best =
      null;

    let bestSpan =
      Infinity;

    for (
      const batch of
      state.batches.values()
    ) {
      if (
        batch.prefix !==
        parsed.prefix
      ) {
        continue;
      }

      if (
        !Number.isFinite(
          batch.startSerial
        ) ||
        !Number.isFinite(
          batch.endSerial
        )
      ) {
        continue;
      }

      if (
        parsed.serial <
          batch.startSerial ||
        parsed.serial >
          batch.endSerial
      ) {
        continue;
      }

      const span =
        batch.endSerial -
        batch.startSerial +
        1;

      if (
        span <=
        bestSpan
      ) {
        best =
          batch;

        bestSpan =
          span;
      }
    }

    return best;
  }

  function getCardRemarkCellText(
    cardNo
  ) {
    const cardType =
      cardListModalState.cardType;

    if (
      cardType !==
        "general" &&
      cardType !==
        "storage"
    ) {
      return {
        text:
          "—",
        color:
          "#c3cad4"
      };
    }

    const state =
      getCardRemarkTypeState(
        cardType,
        getCurrentOrderCode(),
        cardListModalState.cardCorpCode
      );

    const batch =
      findCardRemarkBatchForCardNo(
        cardNo,
        state
      );

    if (!batch) {
      return {
        text:
          state.complete
            ? "未识别批次"
            : "未查询",
        color:
          "#c3cad4"
      };
    }

    const remark =
      cleanText(
        batch.remark
      );

    return {
      text:
        remark ||
        "（无备注）",
      color:
        remark
          ? "#253247"
          : "#8a94a3"
    };
  }

  /*
   * 卡片明细行里的「审批时间」。
   *
   * 与备注同源：都用「卡号 → 所属批次」这一步（findCardRemarkBatchForCardNo），
   * 数据在算备注时**已经拿到并存进 batch**（batch.bindTime），这里只是取出来 ——
   * **不发任何请求**。
   *
   * 只有走制卡审批的卡类才有这个时间，故与备注同样限 general / storage；
   * 电商卡等没有制卡审批的，显示 "—"。
   */
  function getCardBindTimeCellText(
    cardNo
  ) {
    const cardType =
      cardListModalState.cardType;

    if (
      cardType !==
        "general" &&
      cardType !==
        "storage"
    ) {
      return "—";
    }

    const state =
      getCardRemarkTypeState(
        cardType,
        getCurrentOrderCode(),
        cardListModalState.cardCorpCode
      );

    const batch =
      findCardRemarkBatchForCardNo(
        cardNo,
        state
      );

    if (!batch) {
      return state.complete
        ? "未识别批次"
        : "未查询";
    }

    return (
      cleanText(
        batch.bindTime
      ) || "—"
    );
  }

  function closeCardListModal() {
    document
      .getElementById(
        UI.CARD_LIST_MODAL_ID
      )
      ?.remove();

    cardListModalState.cardType =
      "";

    cardListModalState.cardCorpCode =
      "";

    cardListModalState.cardPool =
      null;

    cardListModalState.result =
      null;

    cardListModalState.statusFilter =
      "";
  }

  function ensureCardListModal() {
    const existing =
      document.getElementById(
        UI.CARD_LIST_MODAL_ID
      );

    if (existing) {
      return existing;
    }

    const overlay =
      document.createElement(
        "div"
      );

    overlay.id =
      UI.CARD_LIST_MODAL_ID;

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:100003",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "padding:24px 16px",
      "box-sizing:border-box",
      "background:rgba(15,23,42,.32)",
      "backdrop-filter:blur(1px)"
    ].join(";");

    overlay.innerHTML = `
      <section style="
        display:flex;
        flex-direction:column;
        width:min(880px, 100%);
        max-height:min(78vh, 720px);
        border:1px solid #e2e7ee;
        border-radius:10px;
        background:#fff;
        box-shadow:0 12px 32px rgba(15,23,42,.18);
        overflow:hidden;
      ">
        <header style="
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          padding:11px 13px;
          border-bottom:1px solid #eef1f5;
          background:#fbfcfe;
        ">
          <div style="min-width:0;">
            <div data-soa-card-list-title style="
              color:#1f2a3d;
              font-size:14px;
              font-weight:750;
              line-height:1.35;
            ">卡片明细</div>
            <div data-soa-card-list-sub style="
              margin-top:3px;
              color:#6a7686;
              font-size:12px;
              line-height:1.4;
            "></div>
          </div>
          <button type="button" data-soa-card-list-close title="关闭" style="
            flex:0 0 auto;
            width:26px;
            height:26px;
            border:1px solid #dbe2ea;
            border-radius:6px;
            background:#fff;
            color:#596579;
            font-size:15px;
            line-height:1;
            cursor:pointer;
          ">×</button>
        </header>

        <div data-soa-card-list-body style="
          flex:1 1 auto;
          min-height:0;
          padding:9px 11px 11px;
          overflow:auto;
        "></div>

        <footer data-soa-card-list-foot style="
          flex:0 0 auto;
          display:flex;
          align-items:center;
          gap:10px;
          padding:8px 11px;
          border-top:1px solid #eef1f5;
          background:#fbfcfe;
        "></footer>
      </section>
    `;

    document.body.appendChild(
      overlay
    );

    overlay.addEventListener(
      "click",
      event => {
        if (
          event.target ===
            overlay ||
          event.target.closest(
            "[data-soa-card-list-close]"
          )
        ) {
          closeCardListModal();
        }
      }
    );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
            "Escape" &&
          document.getElementById(
            UI.CARD_LIST_MODAL_ID
          )
        ) {
          closeCardListModal();
        }
      }
    );

    return overlay;
  }

  /*
   * 找「已识别批次」里与本区间重叠的部分。
   * 重叠＝同一号段被两条审批同时声明（跳号作废后重新提交、号码复用），
   * 属于需要人工确认的情况，所以在批次上标出来而不是静默合并。
   */
  function findOverlappingBatches(
    prefix,
    startSerial,
    endSerial,
    state
  ) {
    const overlapped = [];

    if (
      !prefix ||
      !Number.isFinite(
        startSerial
      ) ||
      !Number.isFinite(
        endSerial
      ) ||
      !state
    ) {
      return overlapped;
    }

    for (
      const batch of
      state.batches.values()
    ) {
      if (
        batch.prefix !==
        prefix
      ) {
        continue;
      }

      if (
        !Number.isFinite(
          batch.startSerial
        ) ||
        !Number.isFinite(
          batch.endSerial
        )
      ) {
        continue;
      }

      const from =
        Math.max(
          startSerial,
          batch.startSerial
        );

      const to =
        Math.min(
          endSerial,
          batch.endSerial
        );

      if (
        from <= to
      ) {
        overlapped.push({
          id:
            batch.id,
          from,
          to,
          remark:
            cleanText(
              batch.remark
            )
        });
      }
    }

    return overlapped;
  }

  /*
   * 「卡号 → 制卡批次」的唯一取数入口：
   *   process/page 拿批次记录 → process/detail 拿备注与卡号区间 → 存进 state.batches。
   * 全量扫（queryCardRemarksByType 主循环）与弹窗按需查单张，共用这一份，
   * 避免两处各写一遍导致区间口径漂移。
   */
  async function fetchAndStoreCardRemarkBatch(
    cardNo,
    state,
    orderCode,
    options
  ) {
    const records =
      await fetchCardProcessPageByCardNo(
        cardNo
      );

    const record =
      findProcessRecordForCard(
        records,
        cardNo,
        orderCode
      );

    if (
      !record ||
      record.id ===
        undefined ||
      record.id ===
        null
    ) {
      return {
        ok: false,
        reason:
          "no-record"
      };
    }

    const batchId =
      String(
        record.id
      );

    /*
     * 同一批次只读一次详情：命中缓存直接返回。
     * 这也是「弹窗里连点同批次多张卡 = 0 请求」的原因。
     */
    if (
      state.batches.has(
        batchId
      )
    ) {
      return {
        ok: true,
        batchId,
        batch:
          state.batches.get(
            batchId
          ),
        reason:
          "cached"
      };
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
      return {
        ok: false,
        reason:
          "order-mismatch"
      };
    }

    const range =
      normalizeBatchSerialRange(
        detail?.beginNo ||
        record?.beginNo,
        detail?.endNo ||
        record?.endNo,
        cardNo
      );

    const reportCardNum =
      Number(
        detail?.cardNum ||
        record?.cardNum ||
        0
      );

    const spanLength =
      Number.isFinite(
        range.startSerial
      ) &&
      Number.isFinite(
        range.endSerial
      )
        ? range.endSerial -
          range.startSerial +
          1
        : 0;

    /*
     * 「再判定区间」：区间是审批自己声明的，但**同一个号段可能被反复申请**
     * （跳号作废后重新提交、号码复用），也可能「卡号在卡池里连着、制卡时却分属
     * 多条审批」。所以入库前用「0 请求的本地校验」把可疑情形逐条标出来 ——
     * 只标记、不阻断、不误杀，交给界面提示人工确认。
     */
    const suspects = [];

    if (range.inverted) {
      suspects.push(
        "区间起止倒置（已按 min/max 修正）"
      );
    }

    if (
      !range.prefix ||
      range.startSerial ===
        null
    ) {
      suspects.push(
        "区间无法解析，已按单卡处理"
      );
    }

    if (
      reportCardNum > 0 &&
      spanLength > 0 &&
      reportCardNum !==
        spanLength
    ) {
      suspects.push(
        `区间长度 ${spanLength} 与审批卡数 ${reportCardNum} 不一致`
      );
    }

    const detailCorpCode =
      cleanText(
        detail?.corpCode ||
        record?.corpCode
      );

    const expectCorpCode =
      cleanText(
        options?.cardCorpCode
      );

    if (
      detailCorpCode &&
      expectCorpCode &&
      detailCorpCode !==
        expectCorpCode
    ) {
      suspects.push(
        `审批归属单位 ${detailCorpCode} 与当前单位代码 ${expectCorpCode} 不一致`
      );
    }

    const overlaps =
      findOverlappingBatches(
        range.prefix,
        range.startSerial,
        range.endSerial,
        state
      );

    if (overlaps.length) {
      suspects.push(
        `与已识别批次重叠：${overlaps
          .map(
            item =>
              `${item.from}~${item.to}`
          )
          .join("、")}`
      );
    }

    if (suspects.length) {
      console.warn(
        "[SOA订单数据] 制卡区间可疑，已标记待确认：",
        {
          cardNo,
          beginNo:
            detail?.beginNo ||
            record?.beginNo,
          endNo:
            detail?.endNo ||
            record?.endNo,
          suspects
        }
      );
    }

    const batch = {
      id:
        batchId,
      remark:
        cleanText(
          detail?.remark
        ),
      prefix:
        range.prefix,
      startSerial:
        range.startSerial,
      endSerial:
        range.endSerial,
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
      // 审批时间（独立于 cardDate，只认 bindTime；见 extractCardBindTime 注释）
      bindTime:
        extractCardBindTime(
          detail,
          record
        ),
      cardNum:
        reportCardNum,
      // 区间自检结果（空串 = 一切正常）
      suspect:
        suspects.join(
          "；"
        ),
      overlaps,
      corpName:
        cleanText(
          detail?.corpName ||
          record?.corpName
        ),
      orderName:
        cleanText(
          detail?.orderName ||
          record?.orderName
        )
    };

    state.batches.set(
      batchId,
      batch
    );

    return {
      ok: true,
      batchId,
      batch,
      reason:
        "loaded"
    };
  }

  /*
   * 弹窗里点开某张卡时按需补这个批次（2 请求 / 批次）。
   * 已有缓存 / 已判定过无记录 / 全量扫正在跑 → 一律不发请求。
   */
  async function loadCardRemarkBatchForCard(
    cardNo
  ) {
    const cardType =
      cardListModalState.cardType;

    if (
      cardType !==
        "general" &&
      cardType !==
        "storage"
    ) {
      return {
        status:
          "unsupported"
      };
    }

    const orderCode =
      getCurrentOrderCode();

    const cardCorpCode =
      cardListModalState.cardCorpCode;

    if (
      !orderCode ||
      !cardCorpCode
    ) {
      return {
        status:
          "blocked"
      };
    }

    const state =
      getCardRemarkTypeState(
        cardType,
        orderCode,
        cardCorpCode
      );

    if (
      findCardRemarkBatchForCardNo(
        cardNo,
        state
      )
    ) {
      return {
        status:
          "ready"
      };
    }

    if (
      state.checkedCards.has(
        cardNo
      ) ||
      cardRemarkQueryRunning
    ) {
      return {
        status:
          "idle"
      };
    }

    cardRemarkQueryRunning =
      cardType;

    state.checkedCards.add(
      cardNo
    );

    try {
      updatePanelStatus(
        `正在查询该卡批次备注：${cardNo}`,
        "normal",
        {
          persistent:
            true
        }
      );

      const outcome =
        await fetchAndStoreCardRemarkBatch(
          cardNo,
          state,
          orderCode,
          {
            cardCorpCode
          }
        );

      if (outcome.ok) {
        updatePanelStatus(
          "✓ 已读取该卡所在批次的备注。",
          "success"
        );

        return {
          status:
            "ready"
        };
      }

      if (
        outcome.reason ===
        "order-mismatch"
      ) {
        updatePanelStatus(
          "该卡的制卡记录不属于当前订单。",
          "error"
        );

        return {
          status:
            "none"
        };
      }

      updatePanelStatus(
        "这张卡未找到对应的制卡记录。",
        "error"
      );

      return {
        status:
          "none"
      };
    } catch (error) {
      if (
        error instanceof
        FlowCancelledError
      ) {
        throw error;
      }

      updatePanelStatus(
        error?.message ||
        String(error),
        "error"
      );

      return {
        status:
          "error"
      };
    } finally {
      cardRemarkQueryRunning =
        "";
    }
  }

  function buildCardListItemRowHtml(
    item
  ) {
    const cardNo =
      extractCardNoFromPoolItem(
        item
      );

    const activity =
      getPoolItemActivityName(
        item
      );

    const status =
      resolveCardStatus(
        item
      ).label;

    const remark =
      getCardRemarkCellText(
        cardNo
      );

    // 审批时间（bindTime）—— 与备注同源、零新增请求；见 getCardBindTimeCellText
    const bindTime =
      getCardBindTimeCellText(
        cardNo
      );

    /*
     * 有效期与金额都取自本地卡池 item（不发请求），取值口径与展开详情完全一致，
     * 这样列表里看到的和点开看到的不会打架。
     */
    const dateRange =
      getPoolItemDateRange(
        item
      );

    const amount =
      getPoolItemAmountInfo(
        item
      );

    return `
      <div data-soa-card-list-item="${escapeHtml(cardNo)}" style="
        border-bottom:1px solid #f1f4f8;
      ">
        <div data-soa-card-list-main="1" role="button" tabindex="0" title="点开看这张卡的详情" style="
          display:grid;
          grid-template-columns:${CARD_LIST_COLUMNS.gridTemplate};
          align-items:center;
          gap:8px;
          padding:7px 8px;
          border-radius:6px;
          cursor:pointer;
        ">
          <span style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:#1f2a3d;
            font-family:ui-monospace, Menlo, Consolas, monospace;
            font-size:12.5px;
            font-weight:650;
          ">${escapeHtml(cardNo || "-")}</span>
          <span title="${escapeHtml(activity || "")}" style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:#44546a;
            font-size:12px;
          ">${escapeHtml(activity || "未分类")}</span>
          <span style="
            color:${getCardStatusColor(status)};
            font-size:12px;
            font-weight:650;
            white-space:nowrap;
          ">${escapeHtml(status)}</span>
          <span title="${escapeHtml(bindTime)}" style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:${bindTime === "—" ? "#c3cad4" : "#44546a"};
            font-size:11px;
            font-variant-numeric:tabular-nums;
          ">${escapeHtml(bindTime)}</span>
          <span title="${escapeHtml(dateRange || "")}" style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:#44546a;
            font-size:11px;
            font-variant-numeric:tabular-nums;
          ">${escapeHtml(dateRange || "-")}</span>
          <span style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:${amount ? "#253247" : "#b4bdc9"};
            font-size:11px;
            font-weight:${amount ? "650" : "400"};
            text-align:right;
            font-variant-numeric:tabular-nums;
          ">${escapeHtml(amount ? amount.text : "-")}</span>
          <span data-soa-card-list-remark="1" style="
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            color:${remark.color};
            font-size:12px;
          ">${escapeHtml(remark.text)}</span>
          <span style="
            color:#b4bdc9;
            font-size:13px;
            line-height:1;
          ">›</span>
        </div>

        <div data-soa-card-list-detail="1" hidden style="
          padding:0 8px 9px;
        "></div>
      </div>
    `;
  }

  function buildCardItemDetailHtml(
    item
  ) {
    const cardNo =
      extractCardNoFromPoolItem(
        item
      );

    const cardType =
      cardListModalState.cardType;

    const cardCorpCode =
      cardListModalState.cardCorpCode;

    const orderCode =
      getCurrentOrderCode();

    const state =
      getCardRemarkTypeState(
        cardType,
        orderCode,
        cardCorpCode
      );

    const batch =
      findCardRemarkBatchForCardNo(
        cardNo,
        state
      );

    const amount =
      getPoolItemAmountInfo(
        item
      );

    const beginNo =
      cleanText(
        batch?.beginNo
      );

    const endNo =
      cleanText(
        batch?.endNo
      );

    const rangeText =
      beginNo &&
      endNo &&
      beginNo !== endNo
        ? `${beginNo} ~ ${endNo}`
        : (
            beginNo ||
            endNo
          );

    let remarkText =
      "";

    if (batch) {
      remarkText =
        cleanText(
          batch.remark
        ) ||
        "（无备注）";
    } else if (
      cardType ===
      "ecommerce"
    ) {
      remarkText =
        "（电商卡无卡备注）";
    } else if (
      state.checkedCards.has(
        cardNo
      )
    ) {
      remarkText =
        "（这张卡未匹配到制卡记录）";
    } else {
      remarkText =
        "（尚未查询这张卡所在批次）";
    }

    const rows = [
      [
        "卡号",
        cardNo
      ],
      [
        "卡类",
        getPoolItemActivityName(
          item
        ) || "未分类"
      ],
      [
        "当前状态",
        resolveCardStatus(
          item
        ).label
      ],
      [
        "领取人",
        getPoolItemSaleName(
          item
        ) || "-"
      ],
      [
        "卡有效期",
        getPoolItemDateRange(
          item
        ) || "-"
      ],
      amount
        ? [
            amount.label,
            amount.text
          ]
        : null,
      rangeText
        ? [
            "所属制卡批次",
            rangeText
          ]
        : null,
      batch?.cardDate
        ? [
            "办卡日期",
            cleanText(
              batch.cardDate
            )
          ]
        : null,
      batch
        ? [
            "该批次卡数",
            String(
              getCardRemarkBatchCount(
                batch
              )
            )
          ]
        : null,
      /*
       * 关联订单 = 当前页面的订单号（getCurrentOrderCode）。
       * 卡池 item 里没有订单号字段（2026-09-26 实测：只有
       * card_no / activity_name / card_sale_name / price / sale_price / status …），
       * 而这个订单号本来就是卡备注查询的前置条件（没它就查不了批次），
       * 所以只要有批次数据就一定有订单号，等于零成本。
       * 取不到（按单位查、URL 无订单号）就不渲染这一行。
       */
      orderCode
        ? [
            "关联订单",
            orderCode
          ]
        : null
    ].filter(Boolean);

    return `
      <div style="
        padding:8px 9px;
        border:1px solid #e6ebf1;
        border-radius:7px;
        background:#fbfcfe;
      ">
        <div style="
          display:grid;
          grid-template-columns:repeat(2, minmax(0, 1fr));
          gap:5px 12px;
        ">
          ${rows
            .map(
              ([label, value]) => `
            <div style="
              display:flex;
              gap:6px;
              min-width:0;
              font-size:12px;
              line-height:1.5;
            ">
              <span style="
                flex:0 0 auto;
                min-width:62px;
                color:#7a8599;
              ">${escapeHtml(label)}</span>
              <span style="
                min-width:0;
                color:#253247;
                font-weight:650;
                word-break:break-all;
              ">${escapeHtml(String(value))}</span>
            </div>
          `
            )
            .join("")}
        </div>

        <div style="
          margin-top:7px;
          padding-top:6px;
          border-top:1px solid #eaeff5;
        ">
          <div style="
            color:#7a8599;
            font-size:12px;
            line-height:1.5;
          ">卡备注</div>
          <div style="
            margin-top:2px;
            color:#253247;
            font-size:12.5px;
            line-height:1.6;
            white-space:pre-wrap;
            word-break:break-all;
          ">${escapeHtml(remarkText)}</div>
        </div>
      </div>
    `;
  }

  /*
   * 备注列回填：一个批次读回来后，同批次的每一行都要跟着变，
   * 所以按「整列重算」处理，而不是只改被点的那一行。
   */
  function refreshCardListModalRemarkCells() {
    const modal =
      document.getElementById(
        UI.CARD_LIST_MODAL_ID
      );

    if (!modal) {
      return;
    }

    modal
      .querySelectorAll(
        "[data-soa-card-list-item]"
      )
      .forEach(
        row => {
          const cell =
            row.querySelector(
              "[data-soa-card-list-remark]"
            );

          if (!cell) {
            return;
          }

          const remark =
            getCardRemarkCellText(
              row.getAttribute(
                "data-soa-card-list-item"
              ) || ""
            );

          cell.textContent =
            remark.text;

          cell.style.color =
            remark.color;
        }
      );
  }

  /*
   * 弹窗里的「制卡批次」区块：把原本独立大窗的批次数据整合进明细，
   * 一眼能看出「哪些号码是一批、那批的备注是什么」。
   * 区间自检异常（长度与审批卡数不符 / 归属单位不符 / 与其它批次重叠）会标 ⚠，
   * 提示人工确认，而不是静默采信。
   */
  /*
   * 这条审批区间里，本订单卡池实际有多少张卡。
   * 与审批声明的 cardNum / 区间长度一起看，就能判断「号段有没有被复用、
   * 有没有别的审批夹在里面」—— 这是「再判定区间」的人工确认依据。
   */
  function countPoolCardsInBatch(
    batch
  ) {
    const items =
      Array.isArray(
        cardListModalState.result?.items
      )
        ? cardListModalState.result.items
        : [];

    if (
      !batch?.prefix ||
      !Number.isFinite(
        batch.startSerial
      ) ||
      !Number.isFinite(
        batch.endSerial
      )
    ) {
      return 0;
    }

    let count =
      0;

    for (
      const item of
      items
    ) {
      const parsed =
        splitCardNo(
          extractCardNoFromPoolItem(
            item
          )
        );

      if (
        !parsed ||
        parsed.prefix !==
          batch.prefix
      ) {
        continue;
      }

      if (
        parsed.serial >=
          batch.startSerial &&
        parsed.serial <=
          batch.endSerial
      ) {
        count +=
          1;
      }
    }

    return count;
  }

  /*
   * 批次区块「展开 / 收起」按钮的样式。
   * 折叠态用**实底蓝**高亮 —— 红领巾要求「展开按钮要抢眼，免得有人看不见」；
   * 展开后弱化成描边样式：已经打开了就不再需要抢注意力。
   */
  function getCardBatchToggleStyle(
    collapsed
  ) {
    if (collapsed) {
      return [
        "flex:0 0 auto",
        "padding:2px 9px",
        "border:1px solid #1d4ed8",
        "border-radius:5px",
        "background:#1d4ed8",
        "color:#ffffff",
        "font-size:11px",
        "font-weight:700",
        "line-height:17px",
        "white-space:nowrap",
        "cursor:pointer"
      ].join(";");
    }

    return [
      "flex:0 0 auto",
      "padding:2px 9px",
      "border:1px solid #dbe2ea",
      "border-radius:5px",
      "background:#ffffff",
      "color:#596579",
      "font-size:11px",
      "font-weight:600",
      "line-height:17px",
      "white-space:nowrap",
      "cursor:pointer"
    ].join(";");
  }

  function buildCardBatchSectionHtml() {
    const collapsed =
      cardListModalState.batchCollapsed !==
      false;

    const cardType =
      cardListModalState.cardType;

    const cardCorpCode =
      cardListModalState.cardCorpCode;

    const state =
      getCardRemarkTypeState(
        cardType,
        getCurrentOrderCode(),
        cardCorpCode
      );

    const batches =
      getCardRemarkBatchList(
        state
      );

    if (
      cardType ===
      "ecommerce"
    ) {
      return `
        <div style="
          margin-bottom:8px;
          padding:7px 9px;
          border:1px solid #eef1f5;
          border-radius:7px;
          background:#fbfcfe;
          color:#8a94a3;
          font-size:12px;
          line-height:1.5;
        ">电商卡没有制卡审批记录，也就没有卡备注可供读取。</div>
      `;
    }

    if (!batches.length) {
      return `
        <div style="
          margin-bottom:8px;
          padding:7px 9px;
          border:1px solid #eef1f5;
          border-radius:7px;
          background:#fbfcfe;
          color:#8a94a3;
          font-size:12px;
          line-height:1.5;
        ">制卡批次：尚未识别 · 点开任意一张卡会读取它所在批次${state?.complete ? "（上次扫描未识别到批次）" : ""}</div>
      `;
    }

    const suspectCount =
      batches.filter(
        batch =>
          cleanText(
            batch.suspect
          )
      ).length;

    /*
     * 覆盖张数按「卡池实际张数」算（不是审批声明的 cardNum），
     * 这样数字与左边的卡片总数对得上。
     */
    const totalCards =
      batches.reduce(
        (
          sum,
          batch
        ) =>
          sum +
          countPoolCardsInBatch(
            batch
          ),
        0
      );

    return `
      <div style="
        margin-bottom:8px;
        border:1px solid #e6ebf1;
        border-radius:7px;
        background:#fbfcfe;
        overflow:hidden;
      ">
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          padding:7px 9px;
          border-bottom:1px solid #eef1f5;
        ">
          <div style="
            min-width:0;
            color:#253247;
            font-size:12px;
            font-weight:650;
            line-height:1.4;
          ">制卡批次 ${batches.length} 个 · 覆盖 ${totalCards} 张${suspectCount ? ` · ⚠ ${suspectCount} 个待确认` : ""}</div>

          <button
            type="button"
            data-soa-card-batch-toggle="1"
            style="${getCardBatchToggleStyle(collapsed)}"
          >${collapsed ? "展开批次 ▾" : "收起批次 ▴"}</button>
        </div>

        <div
          data-soa-card-batch-body="1"
          ${collapsed ? `style="display:none;"` : ""}
        >
        ${batches
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
                  ? `${beginNo} ~ ${endNo}`
                  : (
                      beginNo ||
                      endNo ||
                      "未返回"
                    );

              const remark =
                cleanText(
                  batch.remark
                );

              const suspect =
                cleanText(
                  batch.suspect
                );

              const spanLength =
                Number.isFinite(
                  batch.startSerial
                ) &&
                Number.isFinite(
                  batch.endSerial
                )
                  ? batch.endSerial -
                    batch.startSerial +
                    1
                  : 0;

              const poolCount =
                countPoolCardsInBatch(
                  batch
                );

              /*
               * 张数说明：
               * ⚠️ 卡池是按**单位代码**过滤的，个别卡因**归属订单被调整**（实测 25X7A212025013541）
               * 已不属本单，于是不会出现在本单卡池里 —— 这类差额属正常口径差异，
               * **不代表审批区间异常**，所以这里只做中性说明，不并入 ⚠ 可疑。
               */
              const countParts = [
                `本单卡池 ${poolCount} 张`
              ];

              if (
                batch.cardNum &&
                batch.cardNum !==
                  poolCount
              ) {
                countParts.push(
                  `审批声明 ${batch.cardNum} 张`
                );
              }

              const hasGap =
                (
                  spanLength &&
                  spanLength !==
                    poolCount
                ) ||
                (
                  batch.cardNum &&
                  batch.cardNum !==
                    poolCount
                );

              return `
                <div style="
                  padding:6px 9px;
                  border-top:1px solid #f4f7fa;
                  ${index === 0 ? "border-top:0;" : ""}
                ">
                  <div style="
                    color:#253247;
                    font-size:12px;
                    font-weight:650;
                    line-height:1.45;
                    word-break:break-all;
                  ">${index + 1}. ${escapeHtml(rangeText)}</div>
                  <div style="
                    margin-top:2px;
                    color:#6a7686;
                    font-size:11.5px;
                    line-height:1.5;
                  ">办卡日期 ${escapeHtml(cleanText(batch.cardDate) || "未返回")} · ${countParts.join(" / ")}</div>
                  ${
                    hasGap
                      ? `<div style="
                          margin-top:2px;
                          color:#9aa5b4;
                          font-size:11px;
                          line-height:1.5;
                        ">注：差额通常是这张卡的归属订单被调整过 —— 卡池按单位代码过滤，已不属本单的卡不计入（非区间异常）</div>`
                      : ""
                  }
                  <div style="
                    margin-top:2px;
                    color:${remark ? "#253247" : "#8a94a3"};
                    font-size:12px;
                    line-height:1.55;
                    white-space:pre-wrap;
                    word-break:break-all;
                  ">备注：${escapeHtml(remark || "（无备注）")}</div>
                  ${
                    suspect
                      ? `<div style="
                          margin-top:3px;
                          padding:3px 6px;
                          border:1px solid #ffe0b2;
                          border-radius:5px;
                          background:#fff8ee;
                          color:#ad4e00;
                          font-size:11.5px;
                          line-height:1.5;
                          word-break:break-all;
                        ">⚠ 区间待确认：${escapeHtml(suspect)}</div>`
                      : ""
                  }
                </div>
              `;
            }
          )
          .join("")}
        </div>
      </div>
    `;
  }

  function renderCardListModalContent() {
    const modal =
      document.getElementById(
        UI.CARD_LIST_MODAL_ID
      );

    if (!modal) {
      return;
    }

    const cardType =
      cardListModalState.cardType;

    const cardCorpCode =
      cardListModalState.cardCorpCode;

    const result =
      cardListModalState.result;

    const allItems =
      Array.isArray(
        result?.items
      )
        ? result.items
        : [];

    const statusFilter =
      cleanText(
        cardListModalState.statusFilter
      );

    /*
     * 状态过滤走本地：数据还是那份卡池 items，只是列表收窄。
     * （批次区块始终用全量 allItems 统计，不受过滤影响。）
     */
    const items =
      statusFilter
        ? allItems.filter(
            item =>
              resolveCardStatus(
                item
              ).label ===
              statusFilter
          )
        : allItems;

    const label =
      cardType ===
        "storage"
        ? "储值卡"
        : cardType ===
            "ecommerce"
          ? "电商卡"
          : "套餐卡";

    const state =
      getCardRemarkTypeState(
        cardType,
        getCurrentOrderCode(),
        cardCorpCode
      );

    const title =
      modal.querySelector(
        "[data-soa-card-list-title]"
      );

    const sub =
      modal.querySelector(
        "[data-soa-card-list-sub]"
      );

    const body =
      modal.querySelector(
        "[data-soa-card-list-body]"
      );

    const foot =
      modal.querySelector(
        "[data-soa-card-list-foot]"
      );

    if (title) {
      title.textContent =
        statusFilter
          ? `${label}卡片明细 · ${statusFilter}`
          : `${label}卡片明细`;
    }

    if (sub) {
      const batchCount =
        state?.batches?.size ||
        0;

      const parts = [
        statusFilter
          ? `共 ${items.length} 张（${statusFilter}）· 该卡类 ${allItems.length} 张`
          : `共 ${items.length} 张`,
        `单位代码 ${cardCorpCode || "未识别"}`
      ];

      if (
        cardType ===
        "ecommerce"
      ) {
        parts.push(
          "电商卡无卡备注"
        );
      } else if (batchCount) {
        parts.push(
          `备注已按批次加载（${batchCount} 个批次）`
        );
      } else if (
        state?.complete
      ) {
        parts.push(
          "备注查询完成，未识别到批次"
        );
      } else {
        parts.push(
          "正在读取制卡审批…"
        );
      }

      sub.textContent =
        parts.join(" · ");
    }

    if (body) {
      body.innerHTML =
        items.length
          ? `
            ${buildCardBatchSectionHtml()}
            <div style="
              display:grid;
              grid-template-columns:${CARD_LIST_COLUMNS.gridTemplate};
              gap:8px;
              padding:0 8px 5px;
              border-bottom:1px solid #e6ebf1;
              color:#8a94a3;
              font-size:11px;
              font-weight:700;
            ">
              ${CARD_LIST_COLUMNS.headers
                .map(
                  label => `<span>${label}</span>`
                )
                .join("")}
              <span></span>
            </div>
            ${items
              .map(
                buildCardListItemRowHtml
              )
              .join("")}
          `
          : `
            <div style="
              padding:10px;
              color:#8a94a3;
              font-size:12px;
            ">${statusFilter ? `该卡类没有「${escapeHtml(statusFilter)}」的卡。` : "该卡类暂无卡片。"}</div>
          `;

    }

    /*
     * 批次区块折叠：只切换这一块的显示与按钮外观，**不整块重渲染** ——
     * 免得把已经展开的卡片行一起弹回去。
     */
    const batchBody =
      body.querySelector(
        "[data-soa-card-batch-body]"
      );

    const batchToggle =
      body.querySelector(
        "[data-soa-card-batch-toggle]"
      );

    batchToggle?.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        const wasCollapsed =
          cardListModalState.batchCollapsed !==
          false;

        const nextCollapsed =
          !wasCollapsed;

        cardListModalState.batchCollapsed =
          nextCollapsed;

        if (batchBody) {
          batchBody.style.display =
            nextCollapsed
              ? "none"
              : "";
        }

        batchToggle.style.cssText =
          getCardBatchToggleStyle(
            nextCollapsed
          );

        batchToggle.textContent =
          nextCollapsed
            ? "展开批次 ▾"
            : "收起批次 ▴";
      }
    );

    if (foot) {
      /*
       * 页脚只留说明与进度：备注随制卡审批自动读取，不再需要手动按钮
       *（打开弹窗即触发，批次与备注一起补齐）。
       */
      const batchCount =
        state?.batches?.size ||
        0;

      let progress =
        "";

      if (
        cardType ===
        "ecommerce"
      ) {
        progress =
          " · 电商卡无卡备注";
      } else if (cardRemarkQueryRunning) {
        progress =
          " · 正在读取制卡审批…";
      } else if (batchCount) {
        progress =
          ` · 已识别 ${batchCount} 个制卡批次`;
      } else if (state?.complete) {
        progress =
          " · 未识别到制卡批次";
      }

      foot.innerHTML = `
        <div style="
          flex:1 1 auto;
          min-width:0;
          color:#8a94a3;
          font-size:11.5px;
          line-height:1.5;
        ">点卡号那一行看这张卡的详情（含所属批次备注）· 面板上的数字：左键看列表、右键去卡池${progress}</div>
      `;
    }

    /*
     * 行交互：点一行就地展开这张卡的信息。
     * 若它所在批次还没查过，展开时按需补一次（2 请求 / 批次，
     * 同批次的卡再点直接复用，不发请求）。
     */
    body
      ?.querySelectorAll(
        "[data-soa-card-list-item]"
      )
      .forEach(
        row => {
          const cardNo =
            row.getAttribute(
              "data-soa-card-list-item"
            ) || "";

          const main =
            row.querySelector(
              "[data-soa-card-list-main]"
            );

          const detailBox =
            row.querySelector(
              "[data-soa-card-list-detail]"
            );

          if (
            !main ||
            !detailBox
          ) {
            return;
          }

          const item =
            items.find(
              candidate =>
                extractCardNoFromPoolItem(
                  candidate
                ) ===
                cardNo
            );

          if (!item) {
            return;
          }

          const toggle =
            async() => {
              const willOpen =
                detailBox.hidden;

              detailBox.hidden =
                !willOpen;

              if (!willOpen) {
                return;
              }

              detailBox.innerHTML =
                buildCardItemDetailHtml(
                  item
                );

              const alreadyKnown =
                findCardRemarkBatchForCardNo(
                  cardNo,
                  getCardRemarkTypeState(
                    cardListModalState.cardType,
                    getCurrentOrderCode(),
                    cardListModalState.cardCorpCode
                  )
                );

              if (alreadyKnown) {
                return;
              }

              const outcome =
                await loadCardRemarkBatchForCard(
                  cardNo
                );

              if (
                detailBox.hidden
              ) {
                return;
              }

              detailBox.innerHTML =
                buildCardItemDetailHtml(
                  item
                );

              if (
                outcome.status ===
                "ready"
              ) {
                refreshCardListModalRemarkCells();
              }
            };

          main.addEventListener(
            "click",
            toggle
          );

          main.addEventListener(
            "keydown",
            event => {
              if (
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();

                toggle();
              }
            }
          );

          row.addEventListener(
            "mouseenter",
            () => {
              main.style.background =
                "#f6f9fd";
            }
          );

          row.addEventListener(
            "mouseleave",
            () => {
              main.style.background =
                "transparent";
            }
          );
        }
      );
  }

  /*
   * 打开弹窗后**自动**把该卡类的制卡审批读全：
   * 判区间的同时顺带 process/detail 把备注一并拿回来。
   * 一个订单下的审批条目不会太多，所以不再要求用户额外点一次「查询备注」。
   */
  function autoLoadCardRemarksForModal() {
    const cardType =
      cardListModalState.cardType;

    const cardCorpCode =
      cardListModalState.cardCorpCode;

    const result =
      cardListModalState.result;

    if (
      cardType !==
        "general" &&
      cardType !==
        "storage"
    ) {
      return;
    }

    if (
      !result?.ok ||
      !cardCorpCode ||
      cardRemarkQueryRunning
    ) {
      return;
    }

    const state =
      getCardRemarkTypeState(
        cardType,
        getCurrentOrderCode(),
        cardCorpCode
      );

    if (state.complete) {
      return;
    }

    queryCardRemarksByType(
      cardType,
      result,
      cardListModalState.cardPool,
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

  function openCardListModal(
    cardType,
    result,
    cardPool,
    cardCorpCode,
    options
  ) {
    if (
      !result?.ok ||
      !Array.isArray(
        result.items
      ) ||
      !result.items.length
    ) {
      updatePanelStatus(
        "当前卡类没有可展示的卡片。"
      );

      return;
    }

    cardListModalState.cardType =
      cardType;

    cardListModalState.cardPool =
      cardPool;

    cardListModalState.cardCorpCode =
      cardCorpCode;

    cardListModalState.result =
      result;

    /*
     * 状态过滤：从「状态行数字」进来时只列该状态的卡；
     * 从「数量」进来则清空过滤（列全部）。
     */
    cardListModalState.statusFilter =
      cleanText(
        options?.status
      );

    /* 每次打开都回到「折叠」状态，默认把位置留给卡片列表。 */
    cardListModalState.batchCollapsed =
      true;

    const modal =
      ensureCardListModal();

    renderCardListModalContent();

    modal.style.display =
      "flex";

    autoLoadCardRemarksForModal();
  }

  /*
   * 备注（全量扫或按需补）完成后，弹窗还开着就同步刷新它，
   * 否则备注列会停在「未查询」上。
   */
  function refreshCardListModalIfOpen() {
    const modal =
      document.getElementById(
        UI.CARD_LIST_MODAL_ID
      );

    if (
      !modal ||
      modal.style.display ===
        "none"
    ) {
      return;
    }

    renderCardListModalContent();
  }

  /*
   * 把已排序的候选卡号整理成「连续段」。
   *
   * 为什么必须先切段：卡池里看到的「号码连着」只是视觉连续，制卡时可能分属
   * 多条审批（跳号作废后重新提交、号码复用）。所以先在本地按「同前缀 + 序号
   * 相邻差 1」切段、跳号处断开，再拿每段的代表卡去制卡审批里问区间 ——
   * 而不是拿整池去猜。
   *
   * ⚠️ 制卡审批只能按**卡号**查：订单名称会重复，orderCode 过滤实测被服务端忽略
   *（传了 orderCode / cardCorpCode 都返回全量 4278 条），所以查询入口只能是卡号。
   */
  function buildContinuousCardSegments(
    candidates
  ) {
    const segments = [];

    let current =
      null;

    for (
      const candidate of
      candidates
    ) {
      if (
        current &&
        current.prefix ===
          candidate.prefix &&
        candidate.serial ===
          current.endSerial +
            1
      ) {
        current.endSerial =
          candidate.serial;

        current.cardNos.push(
          candidate.cardNo
        );

        continue;
      }

      current = {
        prefix:
          candidate.prefix,
        startSerial:
          candidate.serial,
        endSerial:
          candidate.serial,
        cardNos: [
          candidate.cardNo
        ]
      };

      segments.push(
        current
      );
    }

    return segments;
  }

  function groupCandidatesByPrefix(
    candidates
  ) {
    const grouped =
      new Map();

    for (
      const candidate of
      candidates
    ) {
      if (
        !grouped.has(
          candidate.prefix
        )
      ) {
        grouped.set(
          candidate.prefix,
          []
        );
      }

      grouped
        .get(
          candidate.prefix
        )
        .push(
          candidate
        );
    }

    return grouped;
  }

  /*
   * 当前子区间是否已被**单条干净**的已知审批区间完整覆盖。
   * 只用于剪枝（能整段跳过的就别再探测）；覆盖不全就继续细分。
   *
   * ⚠️ 可疑批次（区间长度与审批卡数不符 / 归属单位不符 / 与其它批次重叠）
   * **不参与剪枝** —— 卡池里已经有全部卡号，这类重叠/缺口在本地就能看出来，
   * 一旦可疑就继续收窄核对，而不是让一条可疑区间把整段吞掉。
   */
  function isSerialRangeCovered(
    prefix,
    fromSerial,
    toSerial,
    state
  ) {
    if (
      !state ||
      !prefix ||
      !Number.isFinite(
        fromSerial
      ) ||
      !Number.isFinite(
        toSerial
      )
    ) {
      return false;
    }

    for (
      const batch of
      state.batches.values()
    ) {
      if (
        batch.prefix !==
        prefix
      ) {
        continue;
      }

      if (
        cleanText(
          batch.suspect
        )
      ) {
        continue;
      }

      if (
        !Number.isFinite(
          batch.startSerial
        ) ||
        !Number.isFinite(
          batch.endSerial
        )
      ) {
        continue;
      }

      if (
        batch.startSerial <=
          fromSerial &&
        batch.endSerial >=
          toSerial
      ) {
        return true;
      }
    }

    return false;
  }

  /*
   * 从区间 [fromSerial, toSerial] 里挑一张「代表卡」去探测。
   * 取靠近**中点**的卡：相比取开头，中点更容易碰到审批边界，
   * 因而更容易发现「一段里夹着多条审批」；已探测过的卡跳过。
   */
  function pickSegmentProbeCandidate(
    prefix,
    fromSerial,
    toSerial,
    ctx
  ) {
    const list =
      ctx.byPrefix.get(
        prefix
      ) ||
      [];

    const middle =
      (
        fromSerial +
        toSerial
      ) /
      2;

    let best =
      null;

    let bestDistance =
      Infinity;

    for (
      const candidate of
      list
    ) {
      if (
        candidate.serial <
          fromSerial ||
        candidate.serial >
          toSerial
      ) {
        continue;
      }

      if (
        ctx.state.checkedCards.has(
          candidate.cardNo
        )
      ) {
        continue;
      }

      const distance =
        Math.abs(
          candidate.serial -
          middle
        );

      if (
        distance <
        bestDistance
      ) {
        best =
          candidate;

        bestDistance =
          distance;
      }
    }

    return best;
  }

  /*
   * 处理一个「卡池连续段」：段内取点 → 查审批区间 → 按审批区间把段再细分。
   *
   * 判定规则（「再判定区间」的核心）：
   *   审批区间完整覆盖当前子区间          → 该子区间整段同批，结束
   *   审批区间只压住一侧 / 比子区间窄      → 区间外的左右两侧继续细分递归
   *   该卡查不到审批记录                  → 换段内另一张卡再试，全试完则放弃这一段
   */
  async function resolveCardRemarkSegment(
    segment,
    ctx
  ) {
    const pending = [
      [
        segment.startSerial,
        segment.endSerial
      ]
    ];

    // 防呆：正常情况每个子区间最多探测「段内卡数」次
    let steps =
      0;

    const maxSteps =
      segment.cardNos.length *
        2 +
      4;

    while (
      pending.length &&
      steps <
        maxSteps
    ) {
      steps +=
        1;

      const range =
        pending.pop();

      const fromSerial =
        range[0];

      const toSerial =
        range[1];

      if (
        fromSerial >
        toSerial
      ) {
        continue;
      }

      if (
        isSerialRangeCovered(
          segment.prefix,
          fromSerial,
          toSerial,
          ctx.state
        )
      ) {
        continue;
      }

      const candidate =
        pickSegmentProbeCandidate(
          segment.prefix,
          fromSerial,
          toSerial,
          ctx
        );

      if (!candidate) {
        continue;
      }

      ctx.state.checkedCards.add(
        candidate.cardNo
      );

      updatePanelStatus(
        `正在查询${ctx.label}备注：${candidate.cardNo}`,
        "normal",
        {
          persistent:
            true
        }
      );

      let outcome =
        null;

      try {
        outcome =
          await fetchAndStoreCardRemarkBatch(
            candidate.cardNo,
            ctx.state,
            ctx.orderCode,
            {
              cardCorpCode:
                ctx.cardCorpCode
            }
          );
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
            cardType:
              ctx.cardType,
            cardNo:
              candidate.cardNo,
            error
          }
        );
      }

      if (
        !outcome ||
        !outcome.ok
      ) {
        if (
          outcome?.reason ===
          "no-record"
        ) {
          console.warn(
            "[SOA订单数据] 未找到对应制卡记录：",
            candidate.cardNo
          );
        }

        /*
         * 这张卡没有可用的审批记录：把同一区间放回队列，
         * 让 pickSegmentProbeCandidate 换段内另一张卡再试。
         */
        pending.push([
          fromSerial,
          toSerial
        ]);

        continue;
      }

      const batch =
        outcome.batch;

      if (
        !batch ||
        batch.prefix !==
          segment.prefix ||
        !Number.isFinite(
          batch.startSerial
        ) ||
        !Number.isFinite(
          batch.endSerial
        )
      ) {
        continue;
      }

      // 审批区间之外的部分（左、右）继续细分
      if (
        batch.startSerial >
        fromSerial
      ) {
        pending.push([
          fromSerial,
          Math.min(
            batch.startSerial -
              1,
            toSerial
          )
        ]);
      }

      if (
        batch.endSerial <
        toSerial
      ) {
        pending.push([
          Math.max(
            batch.endSerial +
              1,
            fromSerial
          ),
          toSerial
        ]);
      }

      /*
       * 可疑批次 ⇒ 只在这一条上增加校验点（"碰到可疑才加密核对"的落点）：
       *   · 有重叠段 → 逐段复核重叠区（这段到底属于哪条审批，以再次探测返回为准）
       *   · 无重叠（长度与声明张数不符等）→ 按卡池卡号**每 N 张取一个点**核对
       * 干净的批次不付出任何额外请求。
       *
       * ⚠️ 只在批次**首次入库**（reason === "loaded"）时入队一次 ——
       * 否则后续每次探到同一条审批都会把采样点再推一遍，探测点会指数级膨胀。
       */
      if (
        cleanText(
          batch.suspect
        ) &&
        outcome.reason ===
          "loaded"
      ) {
        const extraRanges = [];

        if (
          Array.isArray(
            batch.overlaps
          )
        ) {
          for (
            const overlap of
            batch.overlaps
          ) {
            if (
              Number.isFinite(
                overlap.from
              ) &&
              Number.isFinite(
                overlap.to
              )
            ) {
              extraRanges.push([
                overlap.from,
                overlap.to
              ]);
            }
          }
        }

        if (
          !extraRanges.length &&
          Number.isFinite(
            batch.startSerial
          ) &&
          Number.isFinite(
            batch.endSerial
          ) &&
          batch.endSerial >
            batch.startSerial
        ) {
          for (
            let startSerial =
              batch.startSerial;
            startSerial <=
              batch.endSerial;
            startSerial +=
              CARD_REMARK_SUSPECT_PROBE_STEP
          ) {
            extraRanges.push([
              startSerial,
              Math.min(
                startSerial +
                  CARD_REMARK_SUSPECT_PROBE_STEP -
                  1,
                batch.endSerial
              )
            ]);
          }
        }

        for (
          const extra of
          extraRanges
        ) {
          const lo =
            Math.max(
              extra[0],
              segment.startSerial
            );

          const hi =
            Math.min(
              extra[1],
              segment.endSerial
            );

          if (
            lo <= hi
          ) {
            pending.push([
              lo,
              hi
            ]);
          }
        }
      }

      if (pending.length) {
        await sleep(
          randomInt(
            CARD_REMARK_PAGE_DELAY[0],
            CARD_REMARK_PAGE_DELAY[1]
          )
        );
      }
    }
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

    /*
     * 先把卡池卡号在本地切成「连续段」，再逐段去制卡审批里问区间、按审批区间细分。
     * 不按订单名称查 —— 订单名称会重复，只有卡号能唯一确定一条审批。
     */
    const segments =
      buildContinuousCardSegments(
        candidates
      );

    const ctx = {
      state,
      orderCode,
      cardCorpCode,
      cardType,
      label,
      byPrefix:
        groupCandidatesByPrefix(
          candidates
        )
    };

    try {
      for (
        const segment of
        segments
      ) {
        if (
          getCurrentOrderCode() !==
          orderCode
        ) {
          throw new FlowCancelledError(
            "订单已切换，已停止卡备注查询"
          );
        }

        await resolveCardRemarkSegment(
          segment,
          ctx
        );
      }

      state.complete =
        true;

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

      /*
       * 弹窗如果开着，把备注列一起刷新 —— 否则它会停在「未查询」。
       */
      refreshCardListModalIfOpen();
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
        display:flex;
        align-items:baseline;
        justify-content:space-between;
        gap:8px;
        margin-bottom:1px;
        line-height:1.35;
      ">
        <span style="
          color:#44546a;
          font-size:11px;
          font-weight:700;
        ">卡类数量</span>
        <span style="
          color:#9aa5b4;
          font-size:10px;
          font-weight:500;
          white-space:nowrap;
        ">左键明细 · 右键卡池</span>
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

            /*
             * 同一个数字上挂两种入口：
             *   data-soa-card-list-open → 左键开卡片明细弹窗
             *   data-soa-card-type/code → 右键开卡池查询
             * 两者共用一组属性，靠事件类型区分。
             */
            const clickAttrs =
              canOpenCardPool
                ? `data-soa-card-list-open="1" data-soa-card-type="${cardType}" data-soa-card-code="${cardCorpCode}"`
                : "";

            /*
             * 卡片上不再挂「查询备注 / 查看备注」按钮：
             * 点卡号打开明细就能看到该卡所在批次的备注（按需查），
             * 想看全部批次则在弹窗里操作 —— 少一个必须走的步骤。
             */
            const remarkHtml =
              "";

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
                      ? `左键：查看${label}卡片明细（弹出列表，不发请求）\n右键：新建标签页打开${label}卡池并查询单位代码 ${cardCorpCode}`
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

                          if (k === "冻结") {
                            statusLabel =
                              "已冻结";
                          }

                          const tone =
                            getCardStatusTone(
                              k
                            );

                          /*
                           * 整条状态做成**可点色块**（文字 + 数字都能点）：
                           * 左键 → 弹窗只列该状态的卡（本地过滤，0 请求）。
                           * 色块样式对齐 1.6 的状态胶囊。
                           */
                          return `<div
                            data-soa-card-status-open="${k}"
                            data-soa-card-type="${cardType}"
                            data-soa-card-code="${cardCorpCode}"
                            title="左键查看「${statusLabel}」的卡片明细"
                            style="
                              display:flex;
                              align-items:center;
                              justify-content:space-between;
                              gap:6px;
                              margin-top:3px;
                              padding:2px 7px;
                              border-radius:999px;
                              background:${tone.bg};
                              color:${tone.fg};
                              font-size:11px;
                              font-weight:800;
                              line-height:1.5;
                              white-space:nowrap;
                              cursor:pointer;
                            ">
                            <span style="
                              min-width:0;
                              overflow:hidden;
                              text-overflow:ellipsis;
                            ">${statusLabel}</span>
                            <span style="
                              flex:0 0 auto;
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

    /*
     * 卡类数字上的两种点击，挂在同一个元素上：
     *   左键 click       → 卡片明细弹窗（数据全在本地已查到的卡池 items 里，0 请求）
     *   右键 contextmenu → 原行为：新标签页打开对应卡池并自动填单位代码查询
     */
    grid
      .querySelectorAll(
        "[data-soa-card-list-open][data-soa-card-type]"
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

              const result =
                cardType ===
                  "storage"
                  ? data.storedValueCard
                  : cardType ===
                      "ecommerce"
                    ? data.ecommerceCard
                    : data.packageCard;

              openCardListModal(
                cardType,
                result,
                data,
                element.getAttribute(
                  "data-soa-card-code"
                ) ||
                ""
              );
            }
          );

          element.addEventListener(
            "contextmenu",
            event => {
              event.preventDefault();

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

    /*
     * 状态色块：整条（文字 + 数字）左键 → 同一个弹窗，但只列该状态的卡。
     * 与「数量」的区别只有入口和过滤条件，数据来源完全一样（本地 items）。
     */
    grid
      .querySelectorAll(
        "[data-soa-card-status-open][data-soa-card-type]"
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

              const result =
                cardType ===
                  "storage"
                  ? data.storedValueCard
                  : cardType ===
                      "ecommerce"
                    ? data.ecommerceCard
                    : data.packageCard;

              openCardListModal(
                cardType,
                result,
                data,
                element.getAttribute(
                  "data-soa-card-code"
                ) ||
                "",
                {
                  status:
                    element.getAttribute(
                      "data-soa-card-status-open"
                    ) ||
                    ""
                }
              );
            }
          );

          // 可点提示：悬停时轻微压暗（面板全用内联样式，没有 :hover 可用）
          element.addEventListener(
            "mouseenter",
            () => {
              element.style.filter =
                "brightness(0.96)";
            }
          );

          element.addEventListener(
            "mouseleave",
            () => {
              element.style.filter =
                "";
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
          体检数据 v${SCRIPT_VERSION}
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
