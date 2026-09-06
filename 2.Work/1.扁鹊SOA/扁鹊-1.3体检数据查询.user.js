// ==UserScript==
// @name         扁鹊-1.3体检数据查询
// @namespace    https://tampermonkey.net/
// @version      1.4.3
// @description  SOA体检数据：打开模块后自动读取落单数据、体检汇总及套餐卡/储值卡数量，并支持卡池新标签页自动查询。注意：卡类查询需要账号用友对应的权限

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
 * - 同时查询套餐卡、储值卡数量，15秒内复用同订单查询结果。
 * - 卡数量大于0时可新建标签页打开对应卡池，自动填写单位代码并查询。
 * - 与SOA.3.1智能审批完全解耦，不修改订单业务数据。
 *
 * 更新记录
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

  const CONFIG = {
    REACTIVE_POLL_INTERVAL: 400,
    STALL_NOTICE_INTERVAL: 12000,

    PROCESS_LOG_API:
      "/soa/api/v1/order/processlogs",

    PACKAGE_CARD_POOL_API:
      "/soa-card/api/v1/card/business/pool/display",

    STORED_VALUE_CARD_POOL_API:
      "/soa-card/api/v1/bqcard/page/pool",

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
    const response =
      await fetch(
        api,
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
              region_code:
                "XX",
              page_index:
                1,
              page_size:
                20,
              cardCorpCode
            }),
          credentials:
            "include"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const payload =
      await response.json();

    const backendError =
      getCardPoolBackendError(
        payload
      );

    if (backendError) {
      throw new Error(
        backendError
      );
    }

    const totalNum =
      extractCardPoolTotalNum(
        payload
      );

    if (
      totalNum === null
    ) {
      console.warn(
        "[SOA订单数据] 卡池接口未返回 data.total_num：",
        {
          api,
          payload
        }
      );

      throw new Error(
        "接口成功，但未返回 total_num"
      );
    }

    return totalNum;
  }

  async function safeFetchCardPoolTotal(
    api,
    cardCorpCode
  ) {
    try {
      return {
        ok:
          true,
        totalNum:
          await fetchCardPoolTotalNum(
            api,
            cardCorpCode
          )
      };
    } catch (error) {
      return {
        ok:
          false,
        error:
          error?.message ||
          String(error)
      };
    }
  }

  async function fetchBothCardPoolTotals(
    cardCorpCode
  ) {
    const packageCard =
      await safeFetchCardPoolTotal(
        CONFIG.PACKAGE_CARD_POOL_API,
        cardCorpCode
      );

    await sleep(
      150
    );

    const storedValueCard =
      await safeFetchCardPoolTotal(
        CONFIG.STORED_VALUE_CARD_POOL_API,
        cardCorpCode
      );

    return {
      packageCard,
      storedValueCard
    };
  }

  function savePendingCardGroupQuery(
    cardType,
    cardCorpCode
  ) {
    const type =
      cardType ===
      "storage"
        ? "storage"
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
          "storage"
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

  function getCardGroupTab(
    cardType
  ) {
    const suffix =
      cardType ===
      "storage"
        ? "storageCard"
        : "generalCard";

    return (
      document.getElementById(
        `rc-tabs-0-tab-${suffix}`
      ) ||
      document.querySelector(
        `[id$="-tab-${suffix}"]`
      )
    );
  }

  function getCardGroupPanel(
    cardType
  ) {
    const suffix =
      cardType ===
      "storage"
        ? "storageCard"
        : "generalCard";

    return (
      document.getElementById(
        `rc-tabs-0-panel-${suffix}`
      ) ||
      document.querySelector(
        `[id$="-panel-${suffix}"]`
      )
    );
  }

  function findCardGroupQueryButton(
    cardType
  ) {
    const suffix =
      cardType ===
      "storage"
        ? "storageCard"
        : "generalCard";

    /*
     * 第一优先级：用户提供的精确 DOM 路径。
     * storageCard 按同样结构自动替换 panel id。
     */
    const exact =
      document.querySelector(
        `#rc-tabs-0-panel-${suffix} > div > div > div > form > div > div:nth-of-type(9) > div > div:nth-of-type(2) > div > div > div > div > div > div > button`
      );

    if (exact) {
      return exact;
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
        data.packageCard
      ],
      [
        "储值卡",
        data.storedValueCard
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
          ([label, result]) => {
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

            const cardType =
              label ===
              "储值卡"
                ? "storage"
                : "general";

            const clickAttrs =
              clickable
                ? `data-soa-card-type="${cardType}" data-soa-card-code="${cardCorpCode}"`
                : "";

            return `
              <div style="
                min-width:0;
                padding:8px 6px;
                border:1px solid ${
                  success
                    ? "#d9f7be"
                    : "#ffccc7"
                };
                border-radius:6px;
                background:${
                  success
                    ? "#f6ffed"
                    : "#fff2f0"
                };
                text-align:center;
              ">
                <div style="
                  margin-bottom:3px;
                  color:#667085;
                  font-size:11px;
                  font-weight:600;
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
                          ? "#389e0d"
                          : "#1f2937"
                    };
                    font-size:${
                      success
                        ? "16px"
                        : "11px"
                    };
                    font-weight:800;
                    line-height:1.35;
                    cursor:${
                      clickable
                        ? "pointer"
                        : "default"
                    };
                    text-decoration:${
                      clickable
                        ? "underline"
                        : "none"
                    };
                    text-underline-offset:2px;
                  "
                  title="${
                    clickable
                      ? `点击新建标签页打开${label}卡池并查询单位代码 ${cardCorpCode}`
                      : safeValue
                  }"
                >${safeValue}</div>
              </div>
            `;
          }
        )
        .join("")}
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
                正在查询套餐卡、储值卡...
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
            await fetchBothCardPoolTotals(
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
              cardPool.storedValueCard
            ].filter(
              item =>
                item?.ok
            ).length
          : 0;

      if (
        physical &&
        cardSuccessCount === 2
      ) {
        updatePanelStatus(
          physicalResult.navigated
            ? "✓ 已切换体检名单并读取体检汇总及卡池数量。"
            : "✓ 已直接读取当前页体检汇总及卡池数量。",
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
                正在查询套餐卡、储值卡...
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
            await fetchBothCardPoolTotals(
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
              cardPool.storedValueCard
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
        cardSuccessCount === 2
      ) {
        updatePanelStatus(
          physicalResult?.navigated
            ? "✓ 已自动读取落单数据，并切换体检名单获取体检汇总及卡类数量。"
            : "✓ 已自动读取落单数据、体检汇总及卡类数量。",
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
          体检数据 v1.4.3
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
        首次打开自动读取当前订单数据；需要更新时点击“刷新数据”，不进行非必要的后台自动刷新。
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
    if (combinedDataQueryRunning || physicalDataQueryRunning) {
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
