// ==UserScript==
// @name         扁鹊-1.2订单智能审批
// @namespace    https://tampermonkey.net/
// @version      2.6
// @description  SOA订单智能审批：自动推进审批流程，合同阶段会自动导入提前选择好的文件。

// @match        https://checkup-soa3.health-100.cn/*
// @grant        none

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-dingdanauto
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdanauto.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdanauto.user.js
// ==/UserScript==

/*
 * SOA.3.1智能审批
 *
 * 功能：
 * - 识别订单流程阶段并执行已支持的自动处理。
 * - 支持审批备注、体检时间校验与报价确认阶段时间修正。
 * - 支持合同智能补全、合同/授权书共用文件绑定及按需上传。
 * - 支持内勤复核、合同补充、发起落单、落单审核及流程停止。
 * - 关键动作执行后动态验证页面真实状态；长时间未推进时显示当前卡点诊断。
 * - 自动流程完成“已落单”后，自动复制订单名称、订单编号、商机代码、健管顾问、落单时间。
 * - 面板支持显示开关、拖动、折叠、位置记忆和网页提示记录。
 *
 * 更新记录
 *
 * v2.5  -  2026-9-3
 * - 修复落单审核短暂进入“落单中”后又真实回到“落单审核”时持续等待的问题；检测到落单审核操作已重新可用后自动回正并继续处理。
 * - “网页提示”改为可选择/复制的只读文本框；增加一键复制，手动上翻记录时不再被新提示强制拉回底部。
 * - 保持合同阶段严格复核，其余已稳定阶段逻辑不额外加严。
 *
 * v2.4  -  2026-9-2
 * - 非合同阶段改为轻量推进验证：短暂阶段回显/倒退不再立即报错，只等待真正向后续阶段稳定推进。
 * - 合同阶段继续保留字段、保存、上传及最终完整性严格复核。
 * - 合同字段改为优先读取当前可见合同容器，避免不同合同类型存在重复ID时误判隐藏字段。
 * - 智能审批窗口加宽并禁止阶段文字换行；右上角折叠按钮改为“×”直接关闭面板。
 *
 * v2.3  -  2026-9-2
 * - 落单流程完成后自动读取本次最新落单记录，并将订单必备数据复制到剪贴板；其他时间不主动提取落单数据。
 * - 合同字段、保存、上传及发起落单增加逐步验证；隐藏/非当前合同类型字段和上传模块不再参与完成度判断。
 * - 合同保存按钮改为按当前可见合同表单上下文定位，兼容“合同保存 / 保存合同 / 保存”，未检测到点击响应时仅安全重试一次。
 * - 所有关键等待增加动态卡点诊断和超时保护，阶段变化必须确认向前推进后才继续，减少页面延迟导致的莫名卡住。
 *
 * v2.2  -  2026-9-1
 * - 内置公共“红领巾的工具箱”框体样式，单独启用本模块时也可正常显示。
 * - 工具箱边框改用伪元素向外绘制，不改变按钮原有布局高度；增加淡色背景并放大工具箱标识。
 *
 * v2.1  -  2026-9-1
 * - 模块正式更名为SOA.3.1智能审批，审批、合同及落单流程逻辑保持不变。
 * - 顶部入口改为“启动智能审批 / 关闭智能审批”，并固定为工具组第1位。
 *
 * v2.0  -  2026-9-1
 * - 重构：移出落单数据、体检数据、卡类查询及卡池跳转，仅保留订单流程自动化核心。
 * - 保留：v1.32合同字段/文件逐项判断逻辑，避免覆盖已有数据和重复上传。
 *
 * v1.32  -  2026-9-1
 * - 合同阶段改为逐项判断，仅补充空字段并跳过已有上传文件。
 *
 * v1.0  -  2026-8-30
 * - 首个 Tampermonkey 正式版。
 */

(function () {
  "use strict";

  /*
   * 订单详情是一个 SPA 工作区。
   * 点击“基本信息 / 套餐与加项包 / 营销 / 合同 / 体检名单 / 开票”等页签时，
   * Hash 会在 #/order/info、#/order/package、#/order/cost、
   * #/order/contract 等子路由之间切换。
   *
   * 只要仍属于 #/order/... 且带有 orderCode，就视为同一个订单详情工作区，
   * 不再因为切换页签而销毁工具。
   */
  const ORDER_ROUTE_PREFIX =
    "#/order/";


  const isTargetRoute =
    () => {
      const hash =
        String(
          location.hash || ""
        );

      if (
        !hash.startsWith(
          ORDER_ROUTE_PREFIX
        )
      ) {
        return false;
      }

      return /[?&]orderCode=SOA[A-Za-z0-9-]+/i
        .test(hash);
    };

  const CONFIG = {
    SWITCH_ORDER_DESC_SELECTOR:
      ".tabs-wrap > .tabs > .order-desc",

    EDIT_SPAN_SELECTOR:
      "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(4) > div > div > div:nth-of-type(2) > button > span",

    CONTRACT_COMPANY_SELECTOR:
      "#contractCompanyCode",

    CONTRACT_BEGIN_SELECTOR:
      "#contractBeginDate",

    CONTRACT_END_SELECTOR:
      "#contractEndDate",

    INSPECTION_DAY_SELECTOR:
      "#inspectionPeopleDay",

    PICKER_TIMEOUT: 3500,
    UPLOAD_CONFIRM_TIMEOUT: 8000,
    POLL_INTERVAL: 100,

    REACTIVE_POLL_INTERVAL:
      400,
    STALL_NOTICE_INTERVAL:
      12000,
    FLOW_WAIT_TIMEOUT:
      60000,
    STAGE_CHANGE_TIMEOUT:
      90000,
    LANDING_STAGE_TIMEOUT:
      180000,
    CONTRACT_SAVE_ACCEPT_TIMEOUT:
      5000,
    CONTRACT_SAVE_COMPLETE_TIMEOUT:
      45000,
    CONTRACT_FINAL_VERIFY_TIMEOUT:
      15000,
    LANDING_COPY_TIMEOUT:
      30000,
    LANDING_COPY_POLL_INTERVAL:
      900,

    PROCESS_LOG_API:
      "/soa/api/v1/order/processlogs",

    EXTRACT_ORDER_NAME_SELECTOR:
      "#register > div",
    EXTRACT_ORDER_CODE_SELECTOR:
      "#register > div:nth-of-type(2) > div:nth-of-type(8) > div:nth-of-type(2) > div > div",
    EXTRACT_OPPORTUNITY_CODE_SELECTOR:
      "#register > div:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div",
    EXTRACT_SALESMAN_SELECTOR:
      "#register > div:nth-of-type(2) > div > div:nth-of-type(2) > div > div > span",

    REGISTER_BEGIN_DATE_SELECTOR:
      "#register_begin_date",
    REGISTER_END_DATE_SELECTOR:
      "#register_end_date",

    REGISTER_EDIT_BUTTON_SELECTOR:
      "#root > div > div > div > div > div:nth-of-type(2) > div > div:nth-of-type(2) > button:nth-of-type(3)",

  };

  const DEFAULTS = {
    REVIEW_REMARK:
      "套餐复核系统要求，提交到合同补充阶段。",
    ORDER_REMARK:
      "已落单，请及时上传原版合同、授权书扫描件。",
    SIGNING_COMPANY_MODE:
      "first",
    SIGNING_COMPANY_TEXT:
      ""
  };

  const FILE_BINDING = {
    DB_NAME:
      "__SOA_CONTRACT_FILE_BINDING_DB__",
    DB_VERSION: 1,
    STORE_NAME: "handles",
    HANDLE_KEY:
      "sharedContractFile"
  };

  const TOOLBOX_STYLE_ID =
    "__soa_honglingjin_toolbox_style_v10";

  const UI = {
    PANEL_ID:
      "__soa_contract_console_panel_v04",
    STATUS_ID:
      "__soa_contract_console_status_v04",
    BIND_BUTTON_ID:
      "__soa_contract_console_bind_v04",
    COLLAPSE_BUTTON_ID:
      "__soa_flow_panel_collapse_v10",
    PANEL_BODY_ID:
      "__soa_flow_panel_body_v10",
    PANEL_COLLAPSED_KEY:
      "__soa_flow_panel_collapsed_v10",
    AUTO_SWITCH_ID:
      "__soa_flow_page_switch_v10",
    DRAG_HANDLE_ID:
      "__soa_contract_console_drag_handle_v06",
    POSITION_KEY:
      "__soa_contract_console_panel_position_v06",
    REVIEW_REMARK_ID:
      "__soa_flow_review_remark_v07",
    ORDER_REMARK_ID:
      "__soa_flow_order_remark_v07",
    FLOW_RUN_BUTTON_ID:
      "__soa_flow_run_v07",
    REVIEW_REMARK_KEY:
      "__soa_flow_review_remark_text_v07",
    ORDER_REMARK_KEY:
      "__soa_flow_order_remark_text_v07",
    HELP_BUTTON_ID:
      "__soa_flow_help_button_v14",
    HELP_PANEL_ID:
      "__soa_flow_help_panel_v14",

    REMARK_BUTTON_ID:
      "__soa_flow_remark_button_v14",
    REMARK_PANEL_ID:
      "__soa_flow_remark_panel_v14",
    REMARK_DEFAULT_BUTTON_ID:
      "__soa_flow_remark_default_v118",

    SIGNING_BUTTON_ID:
      "__soa_flow_signing_button_v118",
    SIGNING_PANEL_ID:
      "__soa_flow_signing_panel_v118",
    SIGNING_FIRST_ID:
      "__soa_flow_signing_first_v118",
    SIGNING_TEXT_MODE_ID:
      "__soa_flow_signing_text_mode_v118",
    SIGNING_TEXT_ID:
      "__soa_flow_signing_text_v118",
    SIGNING_MODE_KEY:
      "__soa_flow_signing_mode_v118",
    SIGNING_TEXT_KEY:
      "__soa_flow_signing_text_key_v118",

    WEB_NOTICE_ID:
      "__soa_flow_web_notice_v14",
    WEB_NOTICE_LIST_ID:
      "__soa_flow_web_notice_list_v14",
    WEB_NOTICE_CLEAR_ID:
      "__soa_flow_web_notice_clear_v114",

    WEB_NOTICE_COPY_ID:
      "__soa_flow_web_notice_copy_v25",

    FLOW_STAGE_LABEL_ID:
      "__soa_flow_stage_label_v16",
    FLOW_STAGE_VALUE_ID:
      "__soa_flow_stage_value_v16",
    FLOW_STAGE_HINT_ID:
      "__soa_flow_stage_hint_v16",

    EXAM_DATE_SUMMARY_ID:
      "__soa_flow_exam_date_summary_v18",
    EXAM_BEGIN_DATE_ID:
      "__soa_flow_exam_begin_date_v110",
    EXAM_END_DATE_ID:
      "__soa_flow_exam_end_date_v110",
    EXAM_DURATION_ID:
      "__soa_flow_exam_duration_v113",
    EXAM_DATE_FIX_BUTTON_ID:
      "__soa_flow_exam_date_fix_button_v110"
  };

  let boundFileHandle = null;
  let processRunning = false;
  let activeFlowToken = null;

  let panelVisible = false;

  let routeObserver = null;

  let uiEnsureScheduled = false;
  let boundFileInitialized = false;

  let webNoticeObserver = null;
  let webNoticeScanScheduled = false;
  let webNoticeHistory = [];

  /*
   * 用户主动向上翻网页提示时暂停自动跟随底部。
   * 只有滚动条重新回到底部附近，后续新提示才继续自动下滚。
   */
  let webNoticeAutoFollow =
    true;

  let webNoticeSeen = new WeakMap();
  let lastWebNoticeSignature = "";
  let lastWebNoticeAt = 0;
  let lastWebNoticeOrderCode = "";

  let lastDisplayedFlowStage = "";


  let panelStatusHideTimer = null;


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
      persistent =
        type === "error"
    } = {}
  ) {
    const status =
      document.getElementById(
        UI.STATUS_ID
      );

    if (!status) {
      return;
    }

    if (panelStatusHideTimer) {
      clearTimeout(
        panelStatusHideTimer
      );

      panelStatusHideTimer =
        null;
    }

    const text =
      String(message || "")
        .trim();

    if (!text) {
      hidePanelStatus();
      return;
    }

    status.style.display =
      "block";

    status.textContent =
      text;

    status.style.color =
      type === "error"
        ? "#cf1322"
        : type === "success"
          ? "#389e0d"
          : "#555";

    status.style.borderColor =
      type === "error"
        ? "#ffccc7"
        : type === "success"
          ? "#b7eb8f"
          : "#eee";

    status.style.background =
      type === "error"
        ? "#fff2f0"
        : type === "success"
          ? "#f6ffed"
          : "#fcfcfc";

    /*
     * 顶部状态区只承担“当前动作/异常”提示。
     * 普通和成功信息自动收起，错误保留供人工观察。
     */
    if (!persistent) {
      const delay =
        type === "success"
          ? 5000
          : 4000;

      panelStatusHideTimer =
        setTimeout(
          () => {
            hidePanelStatus();
            panelStatusHideTimer =
              null;
          },
          delay
        );
    }
  }

  function log(message, data) {
    updatePanelStatus(
      message
    );

    if (data !== undefined) {
      console.log(
        `[SOA流程自动化] ${message}`,
        data
      );
    } else {
      console.log(
        `[SOA流程自动化] ${message}`
      );
    }
  }

  function warn(message, data) {
    updatePanelStatus(
      message,
      "error"
    );

    if (data !== undefined) {
      console.warn(
        `[SOA流程自动化] ${message}`,
        data
      );
    } else {
      console.warn(
        `[SOA流程自动化] ${message}`
      );
    }
  }

  function getWebNoticeText() {
    return webNoticeHistory
      .map(
        item =>
          `[${item.time}] ${item.type}：${item.text}`
      )
      .join(
        "\n"
      );
  }

  function renderWebNoticeHistory() {
    const wrapper =
      document.getElementById(
        UI.WEB_NOTICE_ID
      );

    const list =
      document.getElementById(
        UI.WEB_NOTICE_LIST_ID
      );

    if (
      !wrapper ||
      !list
    ) {
      return;
    }

    if (
      !webNoticeHistory.length
    ) {
      wrapper.style.display =
        "none";

      if (
        "value" in list
      ) {
        list.value =
          "";
      } else {
        list.textContent =
          "";
      }

      webNoticeAutoFollow =
        true;

      return;
    }

    wrapper.style.display =
      "block";

    const wasNearBottom =
      (
        list.scrollHeight -
        list.scrollTop -
        list.clientHeight
      ) <=
      8;

    const shouldFollow =
      webNoticeAutoFollow ||
      wasNearBottom;

    const text =
      getWebNoticeText();

    if (
      "value" in list
    ) {
      list.value =
        text;
    } else {
      list.textContent =
        text;
    }

    if (shouldFollow) {
      list.scrollTop =
        list.scrollHeight;

      webNoticeAutoFollow =
        true;
    }
  }

  async function copyWebNoticeHistory() {
    const text =
      getWebNoticeText();

    if (!text) {
      updatePanelStatus(
        "当前没有网页提示可复制"
      );

      return false;
    }

    try {
      await navigator.clipboard.writeText(
        text
      );

      updatePanelStatus(
        "✓ 网页提示已复制到剪贴板",
        "success"
      );

      return true;
    } catch (_) {
      const list =
        document.getElementById(
          UI.WEB_NOTICE_LIST_ID
        );

      if (
        list &&
        typeof list.select ===
          "function"
      ) {
        list.focus();
        list.select();

        try {
          const ok =
            document.execCommand(
              "copy"
            );

          if (ok) {
            updatePanelStatus(
              "✓ 网页提示已复制到剪贴板",
              "success"
            );

            return true;
          }
        } catch (_) {}
      }

      updatePanelStatus(
        "网页提示复制失败，可在记录框内手动选择后复制",
        "error"
      );

      return false;
    }
  }

  function syncWebNoticeOrderContext() {
    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      return;
    }

    if (
      lastWebNoticeOrderCode &&
      lastWebNoticeOrderCode !==
        orderCode
    ) {
      resetWebNoticeHistory();
    }

    lastWebNoticeOrderCode =
      orderCode;
  }

  function pushWebNotice(
    text,
    type = "提示"
  ) {
    syncWebNoticeOrderContext();

    const normalized =
      cleanText(
        text
      ).slice(
        0,
        180
      );

    if (!normalized) {
      return;
    }

    const signature =
      `${type}|${normalized}`;

    const now =
      Date.now();

    if (
      signature ===
        lastWebNoticeSignature &&
      now -
        lastWebNoticeAt <
        1500
    ) {
      return;
    }

    lastWebNoticeSignature =
      signature;

    lastWebNoticeAt =
      now;

    webNoticeHistory.push({
      type,
      text:
        normalized,
      time:
        new Date()
          .toLocaleTimeString(
            "zh-CN",
            {
              hour12: false
            }
          )
    });

    if (
      webNoticeHistory.length >
      5
    ) {
      webNoticeHistory =
        webNoticeHistory.slice(
          -5
        );
    }

    renderWebNoticeHistory();
  }

  function getWebNoticeNodeText(
    node,
    type
  ) {
    if (!node) {
      return "";
    }

    if (
      node.closest?.(
        `#${UI.PANEL_ID}`
      )
    ) {
      return "";
    }

    if (
      type === "弹窗"
    ) {
      const title =
        cleanText(
          node.querySelector(
            ".ant-modal-title"
          )?.textContent
        );

      if (
        title ===
        "流程进度"
      ) {
        return "";
      }

      return title;
    }

    return cleanText(
      node.innerText ||
      node.textContent
    );
  }

  function scanWebNotices() {
    if (
      !isTargetRoute()
    ) {
      return;
    }

    syncWebNoticeOrderContext();

    const groups = [
      {
        selector:
          ".ant-message-notice-content",
        type:
          "消息"
      },
      {
        selector:
          ".ant-notification-notice",
        type:
          "通知"
      },
      {
        selector:
          ".ant-popconfirm",
        type:
          "确认提示"
      },
      {
        selector:
          ".ant-modal-confirm",
        type:
          "确认弹窗"
      },
      {
        selector:
          ".ant-modal",
        type:
          "弹窗"
      }
    ];

    groups.forEach(group => {
      document
        .querySelectorAll(
          group.selector
        )
        .forEach(node => {
          if (
            !isVisible(node)
          ) {
            return;
          }

          const text =
            getWebNoticeNodeText(
              node,
              group.type
            );

          if (!text) {
            return;
          }

          const previous =
            webNoticeSeen.get(
              node
            );

          if (
            previous === text
          ) {
            return;
          }

          webNoticeSeen.set(
            node,
            text
          );

          pushWebNotice(
            text,
            group.type
          );
        });
    });
  }

  function scheduleWebNoticeScan() {
    if (
      webNoticeScanScheduled
    ) {
      return;
    }

    webNoticeScanScheduled =
      true;

    requestAnimationFrame(
      () => {
        webNoticeScanScheduled =
          false;

        scanWebNotices();
      }
    );
  }

  function connectWebNoticeObserver() {
    if (
      webNoticeObserver ||
      !document.body
    ) {
      return;
    }

    webNoticeObserver =
      new MutationObserver(
        () => {
          scheduleWebNoticeScan();
        }
      );

    webNoticeObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );

    scheduleWebNoticeScan();
  }

  function disconnectWebNoticeObserver() {
    if (
      webNoticeObserver
    ) {
      webNoticeObserver.disconnect();
      webNoticeObserver =
        null;
    }

    webNoticeScanScheduled =
      false;
  }

  function resetWebNoticeHistory() {
    webNoticeHistory = [];

    webNoticeAutoFollow =
      true;
    webNoticeSeen =
      new WeakMap();

    lastWebNoticeSignature =
      "";

    lastWebNoticeAt =
      0;

    renderWebNoticeHistory();
  }

  function sleep(ms) {
    return new Promise(
      resolve => setTimeout(resolve, ms)
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
    return cleanText(value)
      .replace(/\s+/g, "");
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style =
      getComputedStyle(element);

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

  async function waitFor(
    getter,
    timeout,
    interval = CONFIG.POLL_INTERVAL
  ) {
    const startedAt =
      Date.now();

    while (
      Date.now() - startedAt < timeout
    ) {
      const result =
        getter();

      if (result) {
        return result;
      }

      await sleep(interval);
    }

    return null;
  }

  class FlowBlockedError extends Error {
    constructor(message) {
      super(message);
      this.name =
        "FlowBlockedError";
    }
  }

  class FlowCancelledError extends Error {
    constructor(
      message =
        "自动流程已由用户停止"
    ) {
      super(message);
      this.name =
        "FlowCancelledError";
    }
  }

  class FlowWaitTimeoutError extends Error {
    constructor(
      message,
      label = ""
    ) {
      super(message);
      this.name =
        "FlowWaitTimeoutError";
      this.label =
        label;
    }
  }

  function createFlowToken() {
    return {
      cancelled: false
    };
  }

  function throwIfFlowCancelled(
    token
  ) {
    if (
      token &&
      token.cancelled
    ) {
      throw new FlowCancelledError();
    }
  }

  function requestFlowStop() {
    if (
      !processRunning ||
      !activeFlowToken
    ) {
      return false;
    }

    activeFlowToken.cancelled =
      true;

    const button =
      document.getElementById(
        UI.FLOW_RUN_BUTTON_ID
      );

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "停止中...";

      button.style.background =
        "#ff7875";

      button.style.color =
        "#fff";
    }

    updatePanelStatus(
      "正在停止自动流程，将在当前安全等待节点终止后续操作..."
    );

    return true;
  }

  function nextPaint(
    count = 2
  ) {
    return new Promise(resolve => {
      const step =
        remaining => {
          if (
            remaining <= 0
          ) {
            resolve();
            return;
          }

          requestAnimationFrame(
            () =>
              step(
                remaining - 1
              )
          );
        };

      step(count);
    });
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
      const selector of selectors
    ) {
      const nodes =
        Array.from(
          document.querySelectorAll(
            selector
          )
        ).filter(isVisible);

      for (const node of nodes) {
        const text =
          cleanText(
            node.textContent
          );

        if (
          text &&
          keywords.some(
            word =>
              text.includes(word)
          )
        ) {
          return text;
        }
      }
    }

    return "";
  }

  function getUnexpectedModalText() {
    const modals =
      Array.from(
        document.querySelectorAll(
          ".ant-modal"
        )
      ).filter(isVisible);

    for (const modal of modals) {
      if (
        modal ===
        getVisibleApprovalModal()
      ) {
        continue;
      }

      const title =
        cleanText(
          modal.querySelector(
            ".ant-modal-title"
          )?.textContent
        );

      const text =
        cleanText(
          modal.textContent
        );

      if (
        title === "流程进度"
      ) {
        continue;
      }

      if (
        title ||
        text
      ) {
        return (
          title ||
          text.slice(0, 120)
        );
      }
    }

    return "";
  }

  function getPageBlocker(
    {
      allowApprovalModal = true,
      allowLandingPopconfirm = true
    } = {}
  ) {
    const errorText =
      getVisibleErrorFeedback();

    if (errorText) {
      return errorText;
    }

    if (
      !allowApprovalModal
    ) {
      const approval =
        getVisibleApprovalModal();

      if (approval) {
        return "页面存在未处理的审批弹窗";
      }
    }

    if (
      !allowLandingPopconfirm &&
      getVisibleLandingPopconfirm()
    ) {
      return "页面存在未处理的发起落单确认框";
    }

    const unexpected =
      getUnexpectedModalText();

    if (unexpected) {
      return `检测到非预期弹窗：${unexpected}`;
    }

    return "";
  }

  function describeButtonState(
    button
  ) {
    if (!button) {
      return "未找到";
    }

    const text =
      compactText(
        button.textContent
      ) || "无文字";

    const states = [];

    if (!isVisible(button)) {
      states.push(
        "不可见"
      );
    }

    if (button.disabled) {
      states.push(
        "disabled"
      );
    }

    if (
      button.classList.contains(
        "ant-btn-loading"
      )
    ) {
      states.push(
        "loading"
      );
    }

    return `${text}(${states.join("/") || "可点击"})`;
  }

  function getContractDiagnosticSummary() {
    if (!contractPageVisible()) {
      return "合同页未显示";
    }

    const state =
      getContractCompletionState();

    const issues = [];

    if (!state.companyValue) {
      issues.push(
        "签单主体为空"
      );
    }

    if (!state.beginValue) {
      issues.push(
        "开始日期为空"
      );
    }

    if (!state.endValue) {
      issues.push(
        "结束日期为空"
      );
    }

    if (
      state.inspectionApplicable &&
      !state.inspectionValue
    ) {
      issues.push(
        "名单时限为空"
      );
    }

    if (
      state.contractUpload.moduleExists &&
      !state.contractUpload.hasFile
    ) {
      issues.push(
        "合同文件未确认"
      );
    }

    if (
      state.authUpload.moduleExists &&
      !state.authUpload.hasFile
    ) {
      issues.push(
        "授权书未确认"
      );
    }

    if (formLooksEditable()) {
      issues.push(
        "仍处编辑状态"
      );
    }

    const saveButton =
      getContractSaveButton();

    return [
      issues.length
        ? `未完成：${issues.join("、")}`
        : "字段/文件状态完整",
      `保存按钮：${describeButtonState(saveButton)}`
    ].join("；");
  }

  function getFlowWaitDiagnostic(
    extra = ""
  ) {
    const parts = [];

    const stage =
      getCurrentFlowStage();

    parts.push(
      `当前阶段=${stage || "未识别"}`
    );

    const errorText =
      getVisibleErrorFeedback();

    if (errorText) {
      parts.push(
        `页面错误=${errorText}`
      );
    }

    const approvalModal =
      getVisibleApprovalModal();

    if (approvalModal) {
      const confirm =
        findModalConfirmButton(
          approvalModal
        );

      parts.push(
        `审批弹窗=${describeButtonState(confirm)}`
      );
    }

    const landingPopover =
      getVisibleLandingPopconfirm();

    if (landingPopover) {
      parts.push(
        `发起落单确认框=${describeButtonState(
          findLandingPopoverConfirmButton(
            landingPopover
          )
        )}`
      );
    }

    if (contractPageVisible()) {
      parts.push(
        getContractDiagnosticSummary()
      );
    }

    if (extra) {
      parts.push(
        extra
      );
    }

    return parts.join("；");
  }

  function waitForReactiveCondition(
    test,
    {
      label = "页面状态",
      token = null,
      blockerCheck = null,
      diagnose = null,
      timeout =
        CONFIG.FLOW_WAIT_TIMEOUT
    } = {}
  ) {
    return new Promise(
      (resolve, reject) => {
        let finished = false;
        let observer = null;
        let pollTimer = null;
        let noticeTimer = null;
        let timeoutTimer = null;
        let lastWaitingMessage = "";

        const startedAt =
          Date.now();

        const getDiagnosis =
          () => {
            if (!diagnose) {
              return "";
            }

            try {
              return cleanText(
                diagnose() || ""
              );
            } catch (error) {
              return `诊断读取失败：${error?.message || error}`;
            }
          };

        const buildWaitingMessage =
          () => {
            const elapsed =
              Math.max(
                1,
                Math.floor(
                  (
                    Date.now() -
                    startedAt
                  ) /
                  1000
                )
              );

            const diagnosis =
              getDiagnosis();

            return (
              `仍在等待：${label}（${elapsed}秒）。` +
              `不会重复提交。` +
              (
                diagnosis
                  ? ` 当前检测：${diagnosis}`
                  : ""
              )
            );
          };

        const clearOwnWaitingStatus =
          () => {
            const status =
              document.getElementById(
                UI.STATUS_ID
              );

            if (
              status &&
              status.style.display !==
                "none" &&
              lastWaitingMessage &&
              status.textContent ===
                lastWaitingMessage
            ) {
              hidePanelStatus();
            }
          };

        const cleanup =
          () => {
            if (observer) {
              observer.disconnect();
              observer = null;
            }

            if (pollTimer) {
              clearInterval(
                pollTimer
              );
              pollTimer = null;
            }

            if (noticeTimer) {
              clearInterval(
                noticeTimer
              );
              noticeTimer = null;
            }

            if (timeoutTimer) {
              clearTimeout(
                timeoutTimer
              );
              timeoutTimer = null;
            }
          };

        const finishResolve =
          value => {
            if (finished) {
              return;
            }

            finished = true;
            cleanup();
            clearOwnWaitingStatus();
            resolve(value);
          };

        const finishReject =
          error => {
            if (finished) {
              return;
            }

            finished = true;
            cleanup();
            clearOwnWaitingStatus();
            reject(error);
          };

        const check =
          () => {
            if (
              token &&
              token.cancelled
            ) {
              finishReject(
                new FlowCancelledError()
              );
              return;
            }

            if (blockerCheck) {
              const blocker =
                blockerCheck();

              if (blocker) {
                finishReject(
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
                finishResolve(
                  result
                );
              }
            } catch (error) {
              finishReject(error);
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

        /*
         * DOM mutation 是主触发；轮询只兜底 React 状态/样式未触发合适 mutation 的情况。
         */
        pollTimer =
          setInterval(
            check,
            CONFIG.REACTIVE_POLL_INTERVAL
          );

        /*
         * 长时间未推进时持续刷新同一条诊断提示，方便直接看到卡点；
         * 这里只观察状态，不重复点击任何业务按钮。
         */
        noticeTimer =
          setInterval(
            () => {
              if (
                token &&
                token.cancelled
              ) {
                check();
                return;
              }

              lastWaitingMessage =
                buildWaitingMessage();

              updatePanelStatus(
                lastWaitingMessage,
                "normal",
                {
                  persistent: true
                }
              );
            },
            CONFIG.STALL_NOTICE_INTERVAL
          );

        if (
          Number.isFinite(
            timeout
          ) &&
          timeout > 0
        ) {
          timeoutTimer =
            setTimeout(
              () => {
                const diagnosis =
                  getDiagnosis();

                finishReject(
                  new FlowWaitTimeoutError(
                    `等待“${label}”超时` +
                    (
                      diagnosis
                        ? `：${diagnosis}`
                        : ""
                    ),
                    label
                  )
                );
              },
              timeout
            );
        }

        check();
      }
    );
  }

  async function waitForStableControlledValue(
    element,
    expected,
    token = null
  ) {
    const expectedText =
      String(expected);

    for (
      let attempt = 0;
      attempt < 4;
      attempt++
    ) {
      throwIfFlowCancelled(
        token
      );

      if (
        String(
          element.value
        ) !== expectedText
      ) {
        setNativeInputValue(
          element,
          expectedText
        );
      }

      /*
       * 等 React 完成一次或多次绘制，而不是固定 sleep。
       */
      await nextPaint(2);

      throwIfFlowCancelled(
        token
      );

      if (
        String(
          element.value
        ) === expectedText
      ) {
        await nextPaint(2);

        throwIfFlowCancelled(
          token
        );

        if (
          String(
            element.value
          ) === expectedText
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function formatDate(date) {
    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() + 1
      ).padStart(2, "0");

    const day =
      String(
        date.getDate()
      ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseYmdDate(
    value
  ) {
    const text =
      cleanText(value);

    const match =
      text.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})$/
      );

    if (!match) {
      return null;
    }

    const year =
      Number(match[1]);

    const month =
      Number(match[2]);

    const day =
      Number(match[3]);

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return {
      date,
      text:
        formatDate(date),
      key:
        year * 10000 +
        month * 100 +
        day
    };
  }

  function addCalendarMonths(
    date,
    months
  ) {
    const source =
      new Date(date);

    const firstOfTarget =
      new Date(
        source.getFullYear(),
        source.getMonth() +
          Number(months || 0),
        1
      );

    const targetYear =
      firstOfTarget.getFullYear();

    const targetMonth =
      firstOfTarget.getMonth();

    const lastDay =
      new Date(
        targetYear,
        targetMonth + 1,
        0
      ).getDate();

    return new Date(
      targetYear,
      targetMonth,
      Math.min(
        source.getDate(),
        lastDay
      )
    );
  }

  function dateDiffDays(
    beginDate,
    endDate
  ) {
    const beginUtc =
      Date.UTC(
        beginDate.getFullYear(),
        beginDate.getMonth(),
        beginDate.getDate()
      );

    const endUtc =
      Date.UTC(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate()
      );

    return Math.max(
      0,
      Math.floor(
        (
          endUtc -
          beginUtc
        ) /
        86400000
      )
    );
  }

  function getExamRemainingInfo(
    beginDate,
    endDate
  ) {
    if (
      !(beginDate instanceof Date) ||
      !(endDate instanceof Date) ||
      endDate <
        beginDate
    ) {
      return {
        text: "",
        title: ""
      };
    }

    const today =
      new Date();

    today.setHours(
      0,
      0,
      0,
      0
    );

    const begin =
      new Date(
        beginDate.getFullYear(),
        beginDate.getMonth(),
        beginDate.getDate()
      );

    const end =
      new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate()
      );

    /*
     * 正常状态下 end 不会早于今天。
     * 此处仍保留保护，避免页面切换瞬间产生错误显示。
     */
    if (
      end <
      today
    ) {
      return {
        text: "",
        title: ""
      };
    }

    const totalDays =
      dateDiffDays(
        begin,
        end
      );

    const remainingDays =
      dateDiffDays(
        today,
        end
      );

    if (
      end.getTime() ===
      today.getTime()
    ) {
      return {
        text:
          "今日到期",
        title:
          `订单总周期：${totalDays}天；剩余周期：0天`
      };
    }

    let remainingMonths =
      (
        end.getFullYear() -
        today.getFullYear()
      ) * 12 +
      (
        end.getMonth() -
        today.getMonth()
      );

    let anchor =
      addCalendarMonths(
        today,
        remainingMonths
      );

    if (
      anchor >
      end
    ) {
      remainingMonths -= 1;

      anchor =
        addCalendarMonths(
          today,
          remainingMonths
        );
    }

    let text = "";

    if (
      remainingMonths >= 12
    ) {
      const years =
        Math.floor(
          remainingMonths / 12
        );

      text =
        `剩${years}年`;
    } else if (
      remainingMonths >= 1
    ) {
      text =
        `剩${remainingMonths}个月`;
    } else {
      text =
        `剩${remainingDays}天`;
    }

    return {
      text,
      title:
        `订单总周期：${totalDays}天；剩余周期：${remainingDays}天`
    };
  }

  function readDateInputText(
    selector
  ) {
    const element =
      document.querySelector(
        selector
      );

    if (!element) {
      return "";
    }

    return cleanText(
      element.value ||
      element.getAttribute(
        "title"
      ) ||
      element.textContent ||
      ""
    );
  }

  function shouldCheckExamDates(
    stage
  ) {
    const sequence = [
      "报价单设计",
      "授权审批",
      "报价确认",
      "内勤复核",
      "合同补充",
      "落单审核",
      "落单中",
      "已落单"
    ];

    const threshold =
      sequence.indexOf(
        "报价确认"
      );

    const current =
      sequence.indexOf(
        stage
      );

    return (
      current >= threshold &&
      threshold >= 0
    );
  }

  function getExamDateState(
    stage =
      getCurrentFlowStage()
  ) {
    const beginElement =
      document.querySelector(
        CONFIG.REGISTER_BEGIN_DATE_SELECTOR
      );

    const endElement =
      document.querySelector(
        CONFIG.REGISTER_END_DATE_SELECTOR
      );

    if (
      !shouldCheckExamDates(stage) ||
      !beginElement ||
      !endElement
    ) {
      return {
        stage,
        applicable: false,
        abnormal: false,
        beginAbnormal: false,
        endAbnormal: false,
        reason:
          "not-applicable"
      };
    }

    const beginText =
      readDateInputText(
        CONFIG.REGISTER_BEGIN_DATE_SELECTOR
      );

    const endText =
      readDateInputText(
        CONFIG.REGISTER_END_DATE_SELECTOR
      );

    const begin =
      parseYmdDate(
        beginText
      );

    const end =
      parseYmdDate(
        endText
      );

    const today =
      new Date();

    today.setHours(
      0,
      0,
      0,
      0
    );

    const todayInfo =
      parseYmdDate(
        formatDate(today)
      );

    const beginInvalid =
      !begin ||
      !todayInfo;

    const endInvalid =
      !end ||
      !todayInfo;

    const startsAfterToday =
      Boolean(
        begin &&
        todayInfo &&
        begin.key >
          todayInfo.key
      );

    const endsBeforeToday =
      Boolean(
        end &&
        todayInfo &&
        end.key <
          todayInfo.key
      );

    /*
     * 若结束日期早于开始日期，将异常归到结束日期，
     * 避免两个日期一起标红。
     */
    const endBeforeBegin =
      Boolean(
        begin &&
        end &&
        end.key <
          begin.key
      );

    const beginAbnormal =
      beginInvalid ||
      startsAfterToday;

    const endAbnormal =
      endInvalid ||
      endsBeforeToday ||
      endBeforeBegin;

    const abnormal =
      beginAbnormal ||
      endAbnormal;

    const reasons = [];

    if (beginInvalid) {
      reasons.push(
        "begin-invalid"
      );
    } else if (startsAfterToday) {
      reasons.push(
        "start-after-today"
      );
    }

    if (endInvalid) {
      reasons.push(
        "end-invalid"
      );
    } else if (endsBeforeToday) {
      reasons.push(
        "end-before-today"
      );
    } else if (endBeforeBegin) {
      reasons.push(
        "end-before-begin"
      );
    }

    return {
      stage,
      applicable: true,
      valid:
        !beginInvalid &&
        !endInvalid &&
        !endBeforeBegin,
      abnormal,
      beginAbnormal,
      endAbnormal,
      startsAfterToday,
      endsBeforeToday,
      endBeforeBegin,
      reason:
        reasons.join(",") ||
        "normal",
      beginText:
        begin?.text ||
        beginText ||
        "未读取",
      endText:
        end?.text ||
        endText ||
        "未读取",
      beginDate:
        begin?.date ||
        null,
      endDate:
        end?.date ||
        null
    };
  }

  function updateExamDateFixButton(
    state =
      getExamDateState()
  ) {
    const button =
      document.getElementById(
        UI.EXAM_DATE_FIX_BUTTON_ID
      );

    if (!button) {
      return;
    }

    const shouldShow =
      state.applicable &&
      state.stage ===
        "报价确认" &&
      state.abnormal;

    button.style.display =
      shouldShow
        ? "inline-flex"
        : "none";

    if (!button.disabled) {
      button.textContent =
        "修改时间";
    }
  }

  function refreshExamDateInfo(
    stage =
      getCurrentFlowStage()
  ) {
    const summary =
      document.getElementById(
        UI.EXAM_DATE_SUMMARY_ID
      );

    const beginSpan =
      document.getElementById(
        UI.EXAM_BEGIN_DATE_ID
      );

    const endSpan =
      document.getElementById(
        UI.EXAM_END_DATE_ID
      );

    const durationSpan =
      document.getElementById(
        UI.EXAM_DURATION_ID
      );

    const state =
      getExamDateState(
        stage
      );

    if (
      !summary ||
      !beginSpan ||
      !endSpan ||
      !durationSpan
    ) {
      updateExamDateFixButton(
        state
      );

      return state;
    }

    if (!state.applicable) {
      summary.style.display =
        "none";

      beginSpan.textContent =
        "";

      endSpan.textContent =
        "";

      durationSpan.textContent =
        "";

      durationSpan.style.display =
        "none";

      updateExamDateFixButton(
        state
      );

      return state;
    }

    /*
     * 从报价确认开始统一显示在“当前阶段”右侧。
     * 开始/结束日期分别着色，互不连带。
     */
    summary.style.display =
      "inline-flex";

    beginSpan.textContent =
      state.beginText;

    endSpan.textContent =
      state.endText;

    beginSpan.style.color =
      state.beginAbnormal
        ? "#cf1322"
        : "#262626";

    beginSpan.style.fontWeight =
      state.beginAbnormal
        ? "700"
        : "400";

    endSpan.style.color =
      state.endAbnormal
        ? "#cf1322"
        : "#262626";

    endSpan.style.fontWeight =
      state.endAbnormal
        ? "700"
        : "400";

    beginSpan.title =
      state.beginAbnormal
        ? "体检开始日期异常"
        : "体检开始日期";

    endSpan.title =
      state.endAbnormal
        ? "体检结束日期异常"
        : "体检结束日期";

    /*
     * 剩余有效期只针对完全正常的日期计算。
     * 任一日期异常时隐藏，避免异常日期产生误导。
     */
    if (
      !state.abnormal &&
      state.beginDate &&
      state.endDate
    ) {
      const remainingInfo =
        getExamRemainingInfo(
          state.beginDate,
          state.endDate
        );

      durationSpan.textContent =
        remainingInfo.text
          ? `· ${remainingInfo.text}`
          : "";

      durationSpan.title =
        remainingInfo.title ||
        "";

      durationSpan.style.display =
        remainingInfo.text
          ? "inline"
          : "none";
    } else {
      durationSpan.textContent =
        "";

      durationSpan.title =
        "";

      durationSpan.style.display =
        "none";
    }

    updateExamDateFixButton(
      state
    );

    return state;
  }

  function registerDatesEditable() {
    const begin =
      document.querySelector(
        CONFIG.REGISTER_BEGIN_DATE_SELECTOR
      );

    const end =
      document.querySelector(
        CONFIG.REGISTER_END_DATE_SELECTOR
      );

    if (
      !begin ||
      !end
    ) {
      return false;
    }

    const beginPicker =
      begin.closest(
        ".ant-picker"
      );

    const endPicker =
      end.closest(
        ".ant-picker"
      );

    return Boolean(
      !begin.disabled &&
      !end.disabled &&
      !beginPicker
        ?.classList.contains(
          "ant-picker-disabled"
        ) &&
      !endPicker
        ?.classList.contains(
          "ant-picker-disabled"
        )
    );
  }

  function getRegisterEditButton() {
    const exact =
      document.querySelector(
        CONFIG.REGISTER_EDIT_BUTTON_SELECTOR
      );

    if (
      exact &&
      isVisible(exact) &&
      !exact.disabled &&
      compactText(
        exact.textContent
      ) === "编辑"
    ) {
      return exact;
    }

    const candidates =
      Array.from(
        document.querySelectorAll(
          "button"
        )
      ).filter(button => {
        return (
          isVisible(button) &&
          !button.disabled &&
          compactText(
            button.textContent
          ) === "编辑"
        );
      });

    return (
      candidates.reverse()[0] ||
      null
    );
  }

  async function enterRegisterEditMode() {
    if (
      registerDatesEditable()
    ) {
      return true;
    }

    const button =
      await waitForReactiveCondition(
        () =>
          getRegisterEditButton() ||
          null,
        {
          label:
            "报价确认页面编辑按钮",
          blockerCheck:
            () =>
              getVisibleErrorFeedback()
        }
      );

    updatePanelStatus(
      "正在进入编辑状态..."
    );

    button.click();

    await waitForReactiveCondition(
      () =>
        registerDatesEditable() ||
        null,
      {
        label:
          "基本信息进入编辑状态",
        blockerCheck:
          () =>
            getVisibleErrorFeedback()
      }
    );

    return true;
  }

  async function setRegisterExamDates() {
    const stage =
      getCurrentFlowStage();

    if (
      stage !==
      "报价确认"
    ) {
      throw new Error(
        `当前阶段为“${stage || "未知"}”，仅报价确认阶段允许修改体检时间`
      );
    }

    const currentState =
      getExamDateState(
        stage
      );

    if (!currentState.applicable) {
      throw new Error(
        "当前未能读取体检开始/结束日期"
      );
    }

    if (!currentState.abnormal) {
      refreshExamDateInfo(
        stage
      );

      updatePanelStatus(
        "体检时间当前正常，无需修改。",
        "success"
      );

      return;
    }

    const actionButton =
      document.getElementById(
        UI.EXAM_DATE_FIX_BUTTON_ID
      );

    if (actionButton) {
      actionButton.disabled =
        true;

      actionButton.textContent =
        "修改中...";
    }

    try {
      await enterRegisterEditMode();

      const begin =
        document.querySelector(
          CONFIG.REGISTER_BEGIN_DATE_SELECTOR
        );

      const end =
        document.querySelector(
          CONFIG.REGISTER_END_DATE_SELECTOR
        );

      if (
        !begin ||
        !end
      ) {
        throw new Error(
          "进入编辑后未找到体检开始/结束日期"
        );
      }

      const today =
        new Date();

      today.setHours(
        0,
        0,
        0,
        0
      );

      const threeYearsLater =
        addYearsClamped(
          today,
          3
        );

      const beginText =
        formatDate(
          today
        );

      const endText =
        formatDate(
          threeYearsLater
        );

      updatePanelStatus(
        `正在修改体检时间：${beginText} ～ ${endText}`
      );

      let beginOk =
        await chooseDateByPicker(
          begin,
          today
        );

      if (!beginOk) {
        beginOk =
          await setDateFallback(
            begin,
            today
          );
      }

      if (!beginOk) {
        throw new Error(
          `体检开始日期未能修改为 ${beginText}`
        );
      }

      let endOk =
        await chooseDateByPicker(
          end,
          threeYearsLater
        );

      if (!endOk) {
        endOk =
          await setDateFallback(
            end,
            threeYearsLater
          );
      }

      if (!endOk) {
        throw new Error(
          `体检结束日期未能修改为 ${endText}`
        );
      }

      refreshExamDateInfo(
        stage
      );

      updatePanelStatus(
        `✓ 已修改体检时间：${beginText} ～ ${endText}。请核对页面后按原流程保存。`,
        "success"
      );
    } finally {
      const latest =
        getExamDateState(
          getCurrentFlowStage()
        );

      if (actionButton) {
        actionButton.disabled =
          false;

        actionButton.textContent =
          "修改时间";

        actionButton.style.display =
          (
            latest.stage ===
              "报价确认" &&
            latest.abnormal
          )
            ? "inline-flex"
            : "none";
      }
    }
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

  function fireMouseSequence(
    element
  ) {
    if (!element) {
      return;
    }

    [
      "mousedown",
      "mouseup",
      "click"
    ].forEach(type => {
      element.dispatchEvent(
        new MouseEvent(
          type,
          {
            bubbles: true,
            cancelable: true,
            view: window
          }
        )
      );
    });
  }

  function getContractContainer() {
    const nodes =
      Array.from(
        document.querySelectorAll(
          ".contractcontainer"
        )
      );

    return (
      nodes.find(isVisible) ||
      nodes[0] ||
      null
    );
  }

  function contractPageVisible() {
    const container =
      getContractContainer();

    return Boolean(
      container &&
      isVisible(container)
    );
  }

  function getEditButton() {
    const preferredSpan =
      document.querySelector(
        CONFIG.EDIT_SPAN_SELECTOR
      );

    const preferredButton =
      preferredSpan?.closest(
        "button"
      );

    if (
      preferredButton &&
      isVisible(preferredButton) &&
      compactText(
        preferredButton.textContent
      ) === "编辑"
    ) {
      return preferredButton;
    }

    const container =
      getContractContainer();

    if (!container) {
      return null;
    }

    return (
      Array.from(
        container.querySelectorAll(
          "button"
        )
      ).find(button => {
        return (
          isVisible(button) &&
          compactText(
            button.textContent
          ) === "编辑"
        );
      }) ||
      null
    );
  }

  function isContractFieldApplicable(
    element
  ) {
    if (!element) {
      return false;
    }

    const item =
      element.closest(
        ".ant-form-item"
      ) ||
      element.closest(
        ".ant-row"
      ) ||
      element.parentElement;

    return Boolean(
      item
        ? isVisible(item)
        : isVisible(element)
    );
  }

  function getCurrentContractField(
    selector
  ) {
    const container =
      getContractContainer();

    const candidates =
      container
        ? Array.from(
            container.querySelectorAll(
              selector
            )
          )
        : Array.from(
            document.querySelectorAll(
              selector
            )
          );

    return (
      candidates.find(
        element =>
          isContractFieldApplicable(
            element
          )
      ) ||
      candidates[0] ||
      null
    );
  }

  function formLooksEditable() {
    const company =
      getCurrentContractField(
        CONFIG.CONTRACT_COMPANY_SELECTOR
      );

    const begin =
      getCurrentContractField(
        CONFIG.CONTRACT_BEGIN_SELECTOR
      );

    const end =
      getCurrentContractField(
        CONFIG.CONTRACT_END_SELECTOR
      );

    if (
      !company ||
      !begin ||
      !end ||
      !isContractFieldApplicable(company) ||
      !isContractFieldApplicable(begin) ||
      !isContractFieldApplicable(end)
    ) {
      return false;
    }

    return Boolean(
      !company.disabled &&
      !begin.disabled &&
      !end.disabled &&
      !company
        .closest(
          ".ant-select"
        )
        ?.classList.contains(
          "ant-select-disabled"
        ) &&
      !begin
        .closest(
          ".ant-picker"
        )
        ?.classList.contains(
          "ant-picker-disabled"
        ) &&
      !end
        .closest(
          ".ant-picker"
        )
        ?.classList.contains(
          "ant-picker-disabled"
        )
    );
  }

  async function enterEditMode(
    token = null
  ) {
    if (
      formLooksEditable()
    ) {
      log(
        "表单已处于编辑状态，跳过编辑按钮。"
      );
      return;
    }

    const editButton =
      await waitForReactiveCondition(
        () =>
          getEditButton() ||
          null,
        {
          label:
            "合同页编辑按钮",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getFlowWaitDiagnostic(
                "正在等待当前合同类型对应的编辑按钮"
              )
        }
      );

    log(
      "合同补充：点击“编辑”，等待表单真正进入可编辑状态..."
    );

    editButton.click();

    await waitForReactiveCondition(
      () =>
        formLooksEditable() ||
        null,
      {
        label:
          "合同表单进入编辑状态",
        token,
        blockerCheck:
          () =>
            getVisibleErrorFeedback(),
        diagnose:
          () =>
            getFlowWaitDiagnostic(
              "已点击编辑，等待可见合同字段变为可编辑"
            )
      }
    );

    log(
      "✓ 已进入编辑状态"
    );
  }

  function getSelectVisibleText(input) {
    const select =
      input?.closest(
        ".ant-select"
      );

    return cleanText(
      select
        ?.querySelector(
          ".ant-select-selection-item"
        )
        ?.textContent
    );
  }

  function getVisibleContractCompanyOptions(
    input
  ) {
    const options = [];

    const controlsId =
      input?.getAttribute(
        "aria-controls"
      );

    if (controlsId) {
      const list =
        document.getElementById(
          controlsId
        );

      if (list) {
        options.push(
          ...Array.from(
            list.querySelectorAll(
              ".ant-select-item-option:not(.ant-select-item-option-disabled)"
            )
          ).filter(isVisible)
        );
      }
    }

    if (!options.length) {
      const dropdowns =
        Array.from(
          document.querySelectorAll(
            ".ant-select-dropdown"
          )
        )
          .filter(isVisible)
          .reverse();

      for (
        const dropdown
        of dropdowns
      ) {
        const found =
          Array.from(
            dropdown.querySelectorAll(
              ".ant-select-item-option:not(.ant-select-item-option-disabled)"
            )
          ).filter(isVisible);

        if (found.length) {
          options.push(
            ...found
          );

          break;
        }
      }
    }

    return options;
  }

  async function selectConfiguredContractCompany(
    token = null
  ) {
    const input =
      getCurrentContractField(
        CONFIG.CONTRACT_COMPANY_SELECTOR
      );

    if (!input) {
      throw new Error(
        "未找到己方签单主体（乙方）"
      );
    }

    const existingText =
      getSelectVisibleText(
        input
      ) ||
      cleanText(
        input.value
      );

    if (existingText) {
      log(
        `✓ 己方签单主体已有值：${existingText}，跳过。`
      );

      return {
        skipped: true,
        value: existingText
      };
    }

    if (input.disabled) {
      throw new Error(
        "己方签单主体（乙方）为空且当前不可编辑"
      );
    }

    const selector =
      input
        .closest(
          ".ant-select"
        )
        ?.querySelector(
          ".ant-select-selector"
        );

    if (!selector) {
      throw new Error(
        "未找到己方签单主体下拉框"
      );
    }

    const config =
      getSigningCompanyConfig();

    if (
      config.mode === "text" &&
      !config.text
    ) {
      throw new Error(
        "签单主体已设置为“按名称匹配”，但尚未填写主体名称"
      );
    }

    log(
      config.mode === "first"
        ? "2/5 选择己方签单主体：第一个可用选项..."
        : `2/5 选择己方签单主体：${config.text}...`
    );

    fireMouseSequence(
      selector
    );

    const options =
      await waitForReactiveCondition(
        () => {
          const found =
            getVisibleContractCompanyOptions(
              input
            );

          return found.length
            ? found
            : null;
        },
        {
          label:
            "己方签单主体下拉选项",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback()
        }
      );

    throwIfFlowCancelled(
      token
    );

    let option = null;

    if (
      config.mode === "first"
    ) {
      option =
        options[0] ||
        null;
    } else {
      option =
        options.find(item => {
          return (
            cleanText(
              item.textContent
            ) ===
            config.text
          );
        }) ||
        null;

      if (!option) {
        const available =
          options
            .map(item =>
              cleanText(
                item.textContent
              )
            )
            .filter(Boolean)
            .join("、");

        throw new Error(
          `未找到配置的己方签单主体“${config.text}”。当前可选：${available || "未读取到选项"}`
        );
      }
    }

    if (!option) {
      throw new Error(
        "未找到可选择的己方签单主体"
      );
    }

    const expectedText =
      cleanText(
        option.textContent
      );

    fireMouseSequence(
      option
    );

    const selected =
      await waitForReactiveCondition(
        () =>
          getSelectVisibleText(
            input
          ) || null,
        {
          label:
            "己方签单主体选中结果",
          token,
          timeout:
            8000,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              `当前显示=${getSelectVisibleText(input) || "空"}`
        }
      );

    if (!selected) {
      throw new Error(
        "已点击己方签单主体，但页面未确认选中结果"
      );
    }

    if (
      config.mode === "text" &&
      selected !==
        config.text
    ) {
      throw new Error(
        `己方签单主体选中结果异常：预期“${config.text}”，实际“${selected}”`
      );
    }

    log(
      `✓ 己方签单主体：${selected || expectedText}`
    );
  }

  function getVisiblePickerDropdown() {
    return (
      Array.from(
        document.querySelectorAll(
          ".ant-picker-dropdown"
        )
      )
        .filter(isVisible)
        .reverse()[0] ||
      null
    );
  }

  function getPickerDateCell(
    dropdown,
    dateText
  ) {
    if (!dropdown) {
      return null;
    }

    return (
      Array.from(
        dropdown.querySelectorAll(
          ".ant-picker-cell[title]"
        )
      ).find(cell => {
        return (
          cell.getAttribute(
            "title"
          ) === dateText &&
          !cell.classList.contains(
            "ant-picker-cell-disabled"
          )
        );
      }) ||
      null
    );
  }

  async function chooseDateByPicker(
    input,
    targetDate
  ) {
    const targetText =
      formatDate(
        targetDate
      );

    fireMouseSequence(
      input.closest(
        ".ant-picker"
      ) || input
    );

    let dropdown =
      await waitFor(
        getVisiblePickerDropdown,
        CONFIG.PICKER_TIMEOUT,
        80
      );

    if (!dropdown) {
      return false;
    }

    let cell =
      getPickerDateCell(
        dropdown,
        targetText
      );

    if (!cell) {
      const targetYear =
        targetDate.getFullYear();

      const targetMonth =
        targetDate.getMonth();

      let safety = 30;

      while (
        !cell &&
        safety-- > 0
      ) {
        const headerText =
          compactText(
            dropdown
              .querySelector(
                ".ant-picker-header-view"
              )
              ?.textContent
          );

        const yearMatch =
          headerText.match(
            /(\d{4})年/
          );

        const monthMatch =
          headerText.match(
            /(\d{1,2})月/
          );

        const currentYear =
          yearMatch
            ? Number(
                yearMatch[1]
              )
            : NaN;

        const currentMonth =
          monthMatch
            ? Number(
                monthMatch[1]
              ) - 1
            : NaN;

        if (
          Number.isFinite(
            currentYear
          ) &&
          currentYear !==
            targetYear
        ) {
          const button =
            dropdown.querySelector(
              currentYear <
                targetYear
                ? ".ant-picker-header-super-next-btn"
                : ".ant-picker-header-super-prev-btn"
            );

          if (!button) {
            break;
          }

          button.click();
          await sleep(120);
        } else if (
          Number.isFinite(
            currentMonth
          ) &&
          currentMonth !==
            targetMonth
        ) {
          const button =
            dropdown.querySelector(
              currentMonth <
                targetMonth
                ? ".ant-picker-header-next-btn"
                : ".ant-picker-header-prev-btn"
            );

          if (!button) {
            break;
          }

          button.click();
          await sleep(120);
        } else {
          break;
        }

        dropdown =
          getVisiblePickerDropdown() ||
          dropdown;

        cell =
          getPickerDateCell(
            dropdown,
            targetText
          );
      }
    }

    if (!cell) {
      return false;
    }

    fireMouseSequence(
      cell.querySelector(
        ".ant-picker-cell-inner"
      ) || cell
    );

    const confirmed =
      await waitFor(
        () =>
          input.value ===
            targetText,
        2200,
        80
      );

    return Boolean(
      confirmed
    );
  }

  async function setDateFallback(
    input,
    targetDate
  ) {
    const targetText =
      formatDate(
        targetDate
      );

    const wasReadonly =
      input.hasAttribute(
        "readonly"
      );

    if (wasReadonly) {
      input.removeAttribute(
        "readonly"
      );
    }

    try {
      input.focus();

      setNativeInputValue(
        input,
        targetText
      );

      input.dispatchEvent(
        new KeyboardEvent(
          "keydown",
          {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true
          }
        )
      );

      input.blur();

      await sleep(250);

      return (
        input.value ===
        targetText
      );
    } finally {
      if (wasReadonly) {
        input.setAttribute(
          "readonly",
          ""
        );
      }
    }
  }

  async function setContractDates(
    token = null
  ) {
    const begin =
      getCurrentContractField(
        CONFIG.CONTRACT_BEGIN_SELECTOR
      );

    const end =
      getCurrentContractField(
        CONFIG.CONTRACT_END_SELECTOR
      );

    if (!begin || !end) {
      throw new Error(
        "未找到合同开始/结束日期"
      );
    }

    const existingBegin =
      cleanText(
        begin.value
      );

    const existingEnd =
      cleanText(
        end.value
      );

    if (
      existingBegin &&
      existingEnd
    ) {
      log(
        `✓ 合同日期已有值：${existingBegin} → ${existingEnd}，跳过。`
      );

      return {
        skipped: true
      };
    }

    const today =
      new Date();

    let beginTarget =
      null;

    let endTarget =
      null;

    if (!existingBegin) {
      beginTarget =
        today;
    }

    if (!existingEnd) {
      const existingBeginDate =
        existingBegin
          ? parseYmdDate(
              existingBegin
            )
          : null;

      endTarget =
        addYearsClamped(
          existingBeginDate ||
          beginTarget ||
          today,
          1
        );
    }

    if (beginTarget) {
      const beginText =
        formatDate(
          beginTarget
        );

      log(
        `合同开始日期为空，补充为 ${beginText}...`
      );

      let beginOk =
        await chooseDateByPicker(
          begin,
          beginTarget
        );

      if (!beginOk) {
        beginOk =
          await setDateFallback(
            begin,
            beginTarget
          );
      }

      if (!beginOk) {
        throw new Error(
          `合同开始日期未能写入 ${beginText}`
        );
      }

      throwIfFlowCancelled(
        token
      );

      await nextPaint(2);
    } else {
      log(
        `✓ 合同开始日期已有值：${existingBegin}，保留。`
      );
    }

    if (endTarget) {
      const endText =
        formatDate(
          endTarget
        );

      log(
        `合同结束日期为空，补充为 ${endText}...`
      );

      let endOk =
        await chooseDateByPicker(
          end,
          endTarget
        );

      if (!endOk) {
        endOk =
          await setDateFallback(
            end,
            endTarget
          );
      }

      if (!endOk) {
        throw new Error(
          `合同结束日期未能写入 ${endText}`
        );
      }
    } else {
      log(
        `✓ 合同结束日期已有值：${existingEnd}，保留。`
      );
    }

    throwIfFlowCancelled(
      token
    );

    log(
      `✓ 合同日期：${begin.value} → ${end.value}`
    );

    return {
      skipped: false
    };
  }

  async function fillInspectionPeopleDay(
    token = null
  ) {
    const input =
      getCurrentContractField(
        CONFIG.INSPECTION_DAY_SELECTOR
      );

    if (!input) {
      log(
        "当前合同类型不存在提交名单时限，跳过。"
      );
      return {
        skipped: true,
        reason: "module-missing"
      };
    }

    if (
      !isContractFieldApplicable(
        input
      )
    ) {
      log(
        "当前合同类型的提交名单时限字段未显示，跳过。"
      );
      return {
        skipped: true,
        reason: "not-applicable"
      };
    }

    const existingValue =
      cleanText(
        input.value
      );

    if (existingValue) {
      log(
        `✓ 提交名单时限已有值：${existingValue}，跳过。`
      );

      return {
        skipped: true,
        value: existingValue
      };
    }

    if (
      input.disabled ||
      input.readOnly
    ) {
      throw new FlowBlockedError(
        "提交名单时限为空，但当前可见字段不可编辑"
      );
    }

    const stable =
      await waitForStableControlledValue(
        input,
        "1",
        token
      );

    if (!stable) {
      throw new FlowBlockedError(
        "提交名单时限写入后未稳定保持为1"
      );
    }

    input.focus();
    input.blur();

    log(
      `✓ 提交名单时限：${input.value}`
    );

    return {
      skipped: false,
      value: input.value
    };
  }

  function getContractFormSnapshot() {
    const company =
      getCurrentContractField(
        CONFIG.CONTRACT_COMPANY_SELECTOR
      );

    const begin =
      getCurrentContractField(
        CONFIG.CONTRACT_BEGIN_SELECTOR
      );

    const end =
      getCurrentContractField(
        CONFIG.CONTRACT_END_SELECTOR
      );

    const inspection =
      getCurrentContractField(
        CONFIG.INSPECTION_DAY_SELECTOR
      );

    const inspectionApplicable =
      Boolean(
        inspection &&
        isContractFieldApplicable(
          inspection
        )
      );

    return {
      companyValue:
        getSelectVisibleText(
          company
        ) ||
        cleanText(
          company?.value
        ),
      beginValue:
        cleanText(
          begin?.value
        ),
      endValue:
        cleanText(
          end?.value
        ),
      inspectionValue:
        cleanText(
          inspection?.value
        ),
      inspectionApplicable
    };
  }

  function getContractFormIssues(
    snapshot =
      getContractFormSnapshot()
  ) {
    const issues = [];

    if (!snapshot.companyValue) {
      issues.push(
        "己方签单主体为空"
      );
    }

    if (!snapshot.beginValue) {
      issues.push(
        "合同开始日期为空"
      );
    }

    if (!snapshot.endValue) {
      issues.push(
        "合同结束日期为空"
      );
    }

    if (
      snapshot.inspectionApplicable &&
      !snapshot.inspectionValue
    ) {
      issues.push(
        "提交名单时限为空"
      );
    }

    return issues;
  }

  function compareContractFormSnapshot(
    expected,
    actual
  ) {
    const mismatches = [];

    [
      [
        "己方签单主体",
        "companyValue"
      ],
      [
        "合同开始日期",
        "beginValue"
      ],
      [
        "合同结束日期",
        "endValue"
      ]
    ].forEach(
      ([label, key]) => {
        if (
          expected?.[key] &&
          expected[key] !==
            actual?.[key]
        ) {
          mismatches.push(
            `${label}：预期“${expected[key]}”，保存后“${actual?.[key] || "空"}”`
          );
        }
      }
    );

    if (
      expected?.inspectionApplicable &&
      expected.inspectionValue &&
      expected.inspectionValue !==
        actual?.inspectionValue
    ) {
      mismatches.push(
        `提交名单时限：预期“${expected.inspectionValue}”，保存后“${actual?.inspectionValue || "空"}”`
      );
    }

    return mismatches;
  }

  function getContextualContractSaveButtons() {
    const container =
      getContractContainer();

    if (!container) {
      return [];
    }

    const company =
      getCurrentContractField(
        CONFIG.CONTRACT_COMPANY_SELECTOR
      );

    const begin =
      getCurrentContractField(
        CONFIG.CONTRACT_BEGIN_SELECTOR
      );

    const end =
      getCurrentContractField(
        CONFIG.CONTRACT_END_SELECTOR
      );

    const isSaveText =
      button =>
        /^(合同保存|保存合同|保存)$/.test(
          compactText(
            button.textContent
          )
        );

    let scope =
      company?.parentElement ||
      null;

    while (
      scope &&
      container.contains(scope)
    ) {
      const containsFields =
        Boolean(
          begin &&
          end &&
          scope.contains(company) &&
          scope.contains(begin) &&
          scope.contains(end)
        );

      if (containsFields) {
        const found =
          Array.from(
            scope.querySelectorAll(
              "button"
            )
          ).filter(
            button =>
              isVisible(button) &&
              isSaveText(button)
          );

        if (found.length) {
          return found;
        }
      }

      if (scope === container) {
        break;
      }

      scope =
        scope.parentElement;
    }

    return Array.from(
      container.querySelectorAll(
        "button"
      )
    ).filter(
      button =>
        isVisible(button) &&
        isSaveText(button)
    );
  }

  function getContractSaveButton() {
    const candidates =
      getContextualContractSaveButtons();

    if (!candidates.length) {
      return null;
    }

    return [
      ...candidates
    ].sort(
      (a, b) => {
        const score =
          button => {
            const text =
              compactText(
                button.textContent
              );

            let value = 0;

            if (text === "合同保存") {
              value += 100;
            } else if (
              text === "保存合同"
            ) {
              value += 90;
            } else if (
              text === "保存"
            ) {
              value += 70;
            }

            if (
              button.classList.contains(
                "ant-btn-primary"
              )
            ) {
              value += 20;
            }

            if (!button.disabled) {
              value += 10;
            }

            return value;
          };

        return score(b) -
          score(a);
      }
    )[0];
  }

  async function saveContractForm(
    token = null,
    expectedSnapshot = null
  ) {
    const expected =
      expectedSnapshot ||
      getContractFormSnapshot();

    const issues =
      getContractFormIssues(
        expected
      );

    if (issues.length) {
      throw new FlowBlockedError(
        `合同保存前验证未通过：${issues.join("、")}`
      );
    }

    if (!formLooksEditable()) {
      const actual =
        getContractFormSnapshot();

      const mismatches =
        compareContractFormSnapshot(
          expected,
          actual
        );

      if (mismatches.length) {
        throw new FlowBlockedError(
          `合同已退出编辑，但保存结果不一致：${mismatches.join("；")}`
        );
      }

      log(
        "合同表单当前已退出编辑状态，保存结果验证通过。"
      );
      return;
    }

    let saveAccepted = false;

    for (
      let attempt = 1;
      attempt <= 2;
      attempt++
    ) {
      throwIfFlowCancelled(
        token
      );

      const saveButton =
        await waitForReactiveCondition(
          () => {
            const button =
              getContractSaveButton();

            if (
              button &&
              !button.disabled &&
              !button.classList.contains(
                "ant-btn-loading"
              )
            ) {
              return button;
            }

            return null;
          },
          {
            label:
              "当前合同类型对应的保存按钮",
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getContractDiagnosticSummary(),
            timeout:
              CONFIG.CONTRACT_SAVE_COMPLETE_TIMEOUT
          }
        );

      const buttonText =
        compactText(
          saveButton.textContent
        );

      log(
        `合同补充：点击当前表单的“${buttonText}”${attempt > 1 ? "（安全重试）" : ""}...`
      );

      saveButton.click();

      try {
        await waitForReactiveCondition(
          () => {
            if (!formLooksEditable()) {
              return "saved";
            }

            const current =
              getContractSaveButton();

            if (
              !saveButton.isConnected ||
              !isVisible(saveButton) ||
              saveButton.disabled ||
              saveButton.classList.contains(
                "ant-btn-loading"
              ) ||
              (
                current &&
                current !== saveButton
              )
            ) {
              return "accepted";
            }

            return null;
          },
          {
            label:
              "合同保存点击响应",
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getContractDiagnosticSummary(),
            timeout:
              CONFIG.CONTRACT_SAVE_ACCEPT_TIMEOUT
          }
        );

        saveAccepted = true;
        break;
      } catch (error) {
        if (
          error instanceof
            FlowWaitTimeoutError &&
          attempt === 1
        ) {
          const current =
            getContractSaveButton();

          if (
            current &&
            isVisible(current) &&
            !current.disabled &&
            !current.classList.contains(
              "ant-btn-loading"
            ) &&
            formLooksEditable()
          ) {
            log(
              "未检测到第一次保存点击的任何页面响应，重新定位当前合同保存按钮并仅重试一次。"
            );
            continue;
          }
        }

        throw error;
      }
    }

    if (!saveAccepted) {
      throw new FlowBlockedError(
        `合同保存未确认接受：${getContractDiagnosticSummary()}`
      );
    }

    await waitForReactiveCondition(
      () =>
        !formLooksEditable() ||
        null,
      {
        label:
          "合同保存完成并退出编辑状态",
        token,
        blockerCheck:
          () =>
            getVisibleErrorFeedback(),
        diagnose:
          () =>
            getContractDiagnosticSummary(),
        timeout:
          CONFIG.CONTRACT_SAVE_COMPLETE_TIMEOUT
      }
    );

    await nextPaint(2);

    const actual =
      getContractFormSnapshot();

    const mismatches =
      compareContractFormSnapshot(
        expected,
        actual
      );

    if (mismatches.length) {
      throw new FlowBlockedError(
        `合同保存后复核失败：${mismatches.join("；")}`
      );
    }

    const afterIssues =
      getContractFormIssues(
        actual
      );

    if (afterIssues.length) {
      throw new FlowBlockedError(
        `合同保存后仍有空字段：${afterIssues.join("、")}`
      );
    }

    log(
      "✓ 合同保存完成，字段持久化复核通过"
    );
  }

  function getUploaderTitle(
    uploader
  ) {
    return cleanText(
      uploader
        ?.querySelector(
          ".custom-uploader-header-title"
        )
        ?.textContent
    );
  }

  function findUploader(kind) {
    const container =
      getContractContainer();

    if (!container) {
      return null;
    }

    /*
     * 同一页面可能挂载多个合同类型的隐藏上传模块。
     * 只处理当前可见合同容器内、当前真正显示的上传模块。
     */
    const uploaders =
      Array.from(
        container.querySelectorAll(
          ".contractfiles-uploader"
        )
      ).filter(
        uploader =>
          isVisible(uploader)
      );

    if (kind === "contract") {
      return (
        uploaders.find(
          uploader =>
            [
              "合同文件",
              "已盖章合同文件回传",
              "已盖章合同文件"
            ].includes(
              getUploaderTitle(
                uploader
              )
            )
        ) ||
        uploaders.find(
          uploader => {
            const text =
              compactText(
                uploader.textContent
              );

            return (
              text.includes(
                "上传合同"
              ) &&
              !text.includes(
                "上传证明文件"
              )
            );
          }
        ) ||
        null
      );
    }

    if (kind === "auth") {
      return (
        uploaders.find(
          uploader =>
            getUploaderTitle(
              uploader
            ).includes(
              "企业查看员工体检报告补充授权书"
            )
        ) ||
        uploaders.find(
          uploader =>
            compactText(
              uploader.textContent
            ).includes(
              "上传授权书"
            )
        ) ||
        null
      );
    }

    return null;
  }

  function openBindingDb() {
    return new Promise(
      (resolve, reject) => {
        const request =
          indexedDB.open(
            FILE_BINDING.DB_NAME,
            FILE_BINDING.DB_VERSION
          );

        request.onupgradeneeded =
          () => {
            const db =
              request.result;

            if (
              !db.objectStoreNames
                .contains(
                  FILE_BINDING.STORE_NAME
                )
            ) {
              db.createObjectStore(
                FILE_BINDING.STORE_NAME
              );
            }
          };

        request.onsuccess =
          () => {
            resolve(
              request.result
            );
          };

        request.onerror =
          () => {
            reject(
              request.error ||
              new Error(
                "打开文件绑定数据库失败"
              )
            );
          };
      }
    );
  }

  async function saveBoundFileHandle(
    handle
  ) {
    const db =
      await openBindingDb();

    try {
      await new Promise(
        (resolve, reject) => {
          const transaction =
            db.transaction(
              FILE_BINDING.STORE_NAME,
              "readwrite"
            );

          const store =
            transaction.objectStore(
              FILE_BINDING.STORE_NAME
            );

          store.put(
            handle,
            FILE_BINDING.HANDLE_KEY
          );

          transaction.oncomplete =
            () => resolve();

          transaction.onerror =
            () => {
              reject(
                transaction.error ||
                new Error(
                  "保存文件绑定失败"
                )
              );
            };

          transaction.onabort =
            () => {
              reject(
                transaction.error ||
                new Error(
                  "保存文件绑定已中止"
                )
              );
            };
        }
      );
    } finally {
      db.close();
    }
  }

  async function loadBoundFileHandle() {
    const db =
      await openBindingDb();

    try {
      return await new Promise(
        (resolve, reject) => {
          const transaction =
            db.transaction(
              FILE_BINDING.STORE_NAME,
              "readonly"
            );

          const store =
            transaction.objectStore(
              FILE_BINDING.STORE_NAME
            );

          const request =
            store.get(
              FILE_BINDING.HANDLE_KEY
            );

          request.onsuccess =
            () => {
              resolve(
                request.result ||
                null
              );
            };

          request.onerror =
            () => {
              reject(
                request.error ||
                new Error(
                  "读取文件绑定失败"
                )
              );
            };
        }
      );
    } finally {
      db.close();
    }
  }

  function updateBoundFileDisplay() {
    const button =
      document.getElementById(
        UI.BIND_BUTTON_ID
      );

    if (!button) {
      return;
    }

    if (boundFileHandle) {
      const name =
        boundFileHandle.name ||
        "已绑定文件";

      button.textContent =
        "文件已选择";

      button.title =
        `当前文件：${name}。点击重新选择`;

      button.style.color =
        "#389e0d";

      button.style.borderColor =
        "#b7eb8f";

      button.style.background =
        "#f6ffed";
    } else {
      button.textContent =
        "待选择文件";

      button.title =
        "尚未选择共用合同/授权书文件，点击选择";

      button.style.color =
        "#cf1322";

      button.style.borderColor =
        "#ffccc7";

      button.style.background =
        "#fff2f0";
    }
  }

  async function bindSharedFile() {
    if (
      typeof window
        .showOpenFilePicker !==
      "function"
    ) {
      throw new Error(
        "当前浏览器不支持 File System Access API，请使用新版 Chrome/Edge 并确保页面为 HTTPS"
      );
    }

    /*
     * showOpenFilePicker 必须直接由真实用户点击触发。
     * 本函数在“文件绑定”按钮事件中第一时间调用。
     */
    const handles =
      await window
        .showOpenFilePicker({
          multiple: false
        });

    const handle =
      handles?.[0] ||
      null;

    if (!handle) {
      return false;
    }

    boundFileHandle =
      handle;

    await saveBoundFileHandle(
      handle
    );

    updateBoundFileDisplay();

    log(
      `✓ 已选择共用文件：${handle.name}`
    );

    return true;
  }


  async function ensureBoundFilePermissionFromUserGesture() {
    if (!boundFileHandle) {
      throw new Error(
        "尚未选择共用文件，请先点击文件按钮完成绑定"
      );
    }

    let permission =
      "granted";

    /*
     * 该函数必须直接由真实用户点击触发。
     * requestPermission 在调用瞬间即可利用当前 user activation；
     * 已经授权时会直接返回 granted，不会重复弹窗。
     */
    if (
      typeof boundFileHandle
        .requestPermission ===
      "function"
    ) {
      permission =
        await boundFileHandle
          .requestPermission({
            mode: "read"
          });
    } else if (
      typeof boundFileHandle
        .queryPermission ===
      "function"
    ) {
      permission =
        await boundFileHandle
          .queryPermission({
            mode: "read"
          });
    }

    if (
      permission !==
      "granted"
    ) {
      throw new Error(
        "已绑定文件尚未获得读取权限，请重新授权或重新绑定文件"
      );
    }

    try {
      const file =
        await boundFileHandle
          .getFile();

      if (!file) {
        throw new Error(
          "读取文件失败"
        );
      }

      return file;
    } catch (error) {
      throw new Error(
        "已绑定文件可能被移动、删除或权限失效，请重新绑定文件"
      );
    }
  }

  async function getBoundFileForRun() {
    if (!boundFileHandle) {
      throw new Error(
        "尚未选择共用文件，请先点击“待选择文件”"
      );
    }

    let permission =
      "granted";

    if (
      typeof boundFileHandle
        .queryPermission ===
      "function"
    ) {
      permission =
        await boundFileHandle
          .queryPermission({
            mode: "read"
          });
    }

    if (
      permission !==
      "granted"
    ) {
      throw new Error(
        "文件读取权限已失效，请点击“文件已选择”重新授权或重新选择文件"
      );
    }

    try {
      const file =
        await boundFileHandle
          .getFile();

      if (!file) {
        throw new Error(
          "读取文件失败"
        );
      }

      return file;
    } catch (error) {
      throw new Error(
        "已选择文件可能被移动、删除或权限失效，请重新选择文件"
      );
    }
  }

  function assignFileToInput(
    input,
    file
  ) {
    const transfer =
      new DataTransfer();

    transfer.items.add(
      file
    );

    try {
      input.files =
        transfer.files;
    } catch {
      Object.defineProperty(
        input,
        "files",
        {
          configurable: true,
          value:
            transfer.files
        }
      );
    }

    input.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );

    input.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );
  }

  function getUploaderFileState(
    kind
  ) {
    const uploader =
      findUploader(
        kind
      );

    if (!uploader) {
      return {
        moduleExists:
          false,
        hasFile:
          false
      };
    }

    const list =
      uploader.querySelector(
        ".contract-list"
      );

    if (list) {
      const text =
        compactText(
          list.textContent
        );

      if (
        text &&
        !text.includes(
          "暂无数据"
        )
      ) {
        return {
          moduleExists:
            true,
          hasFile:
            true
        };
      }
    }

    const existingItem =
      uploader.querySelector(
        ".ant-upload-list-item, .contract-list .ant-list-item, .contract-list [class*='file-item']"
      );

    return {
      moduleExists:
        true,
      hasFile:
        Boolean(
          existingItem
        )
    };
  }

  function contractNeedsBoundFile() {
    const contract =
      getUploaderFileState(
        "contract"
      );

    const auth =
      getUploaderFileState(
        "auth"
      );

    return Boolean(
      (
        contract.moduleExists &&
        !contract.hasFile
      ) ||
      (
        auth.moduleExists &&
        !auth.hasFile
      )
    );
  }

  function getContractCompletionState() {
    const snapshot =
      getContractFormSnapshot();

    const formNeedsEdit =
      getContractFormIssues(
        snapshot
      ).length > 0;

    const contractUpload =
      getUploaderFileState(
        "contract"
      );

    const authUpload =
      getUploaderFileState(
        "auth"
      );

    const uploadNeedsFile =
      Boolean(
        (
          contractUpload.moduleExists &&
          !contractUpload.hasFile
        ) ||
        (
          authUpload.moduleExists &&
          !authUpload.hasFile
        )
      );

    return {
      ...snapshot,
      formNeedsEdit,
      contractUpload,
      authUpload,
      uploadNeedsFile,
      complete:
        !formNeedsEdit &&
        !uploadNeedsFile
    };
  }

  function describeContractCompletionIssues(
    state =
      getContractCompletionState()
  ) {
    const issues =
      getContractFormIssues(
        state
      );

    if (
      state.contractUpload.moduleExists &&
      !state.contractUpload.hasFile
    ) {
      issues.push(
        "合同文件未确认"
      );
    }

    if (
      state.authUpload.moduleExists &&
      !state.authUpload.hasFile
    ) {
      issues.push(
        "授权书未确认"
      );
    }

    if (formLooksEditable()) {
      issues.push(
        "合同仍处编辑状态"
      );
    }

    return issues;
  }

  async function waitUploadVisible(
    kind,
    file,
    token = null
  ) {
    const fileName =
      cleanText(
        file.name
      );

    try {
      await waitForReactiveCondition(
        () => {
          const uploader =
            findUploader(kind);

          if (!uploader) {
            return null;
          }

          const text =
            cleanText(
              uploader.textContent
            );

          if (
            fileName &&
            text.includes(
              fileName
            )
          ) {
            return true;
          }

          const state =
            getUploaderFileState(
              kind
            );

          return state.hasFile
            ? true
            : null;
        },
        {
          label:
            `${kind === "contract" ? "合同文件" : "授权书"}上传结果`,
          token,
          timeout:
            CONFIG.UPLOAD_CONFIRM_TIMEOUT,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getContractDiagnosticSummary()
        }
      );

      return true;
    } catch (error) {
      if (
        error instanceof
          FlowWaitTimeoutError
      ) {
        return false;
      }

      throw error;
    }
  }

  async function uploadOne(
    kind,
    file,
    label,
    token = null
  ) {
    const currentState =
      getUploaderFileState(
        kind
      );

    if (
      currentState.moduleExists &&
      currentState.hasFile
    ) {
      log(
        `✓ ${label}已有文件，跳过重复上传。`
      );

      return {
        skipped: true,
        reason: "existing-file"
      };
    }

    if (!file) {
      warn(
        `未选择${label}，本次跳过。`
      );

      return {
        skipped: true,
        reason: "file-missing"
      };
    }

    const uploader =
      findUploader(kind);

    if (!uploader) {
      log(
        `当前页面不存在${label}上传模块，已跳过。`
      );

      return {
        skipped: true,
        reason: "module-missing"
      };
    }

    const input =
      uploader.querySelector(
        'input[type="file"]'
      );

    if (!input) {
      log(
        `${label}上传模块存在，但未发现文件选择控件，已跳过。`
      );

      return {
        skipped: true,
        reason: "input-missing"
      };
    }

    log(
      `6/6 发送${label}到网页上传控件：${file.name}`
    );

    assignFileToInput(
      input,
      file
    );

    const confirmed =
      await waitUploadVisible(
        kind,
        file,
        token
      );

    if (confirmed) {
      log(
        `✓ ${label}已进入上传列表：${file.name}`
      );

      return {
        skipped: false,
        confirmed: true
      };
    }

    warn(
      `${label}已触发 change，但 8 秒内未从上传列表确认；请人工检查。`
    );

    return {
      skipped: false,
      confirmed: false
    };
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

  async function ensureContractTabVisible(
    token = null
  ) {
    if (
      contractPageVisible()
    ) {
      return true;
    }

    const contractTab =
      await waitForReactiveCondition(
        () =>
          findTabByText(
            "合同"
          ) ||
          null,
        {
          label:
            "合同页签",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getFlowWaitDiagnostic(
                "等待合同页签可操作"
              )
        }
      );

    log(
      "合同补充：自动切换到“合同”页签..."
    );

    contractTab.click();

    await waitForReactiveCondition(
      () =>
        contractPageVisible() ||
        null,
      {
        label:
          "合同模块加载",
        token,
        blockerCheck:
          () =>
            getVisibleErrorFeedback(),
        diagnose:
          () =>
            getFlowWaitDiagnostic(
              "已点击合同页签，等待当前合同类型内容显示"
            )
      }
    );

    log(
      "✓ 已进入合同页签"
    );

    return true;
  }

  function findBottomActionByText(
    text
  ) {
    const bottom =
      document.querySelector(
        ".bottom .actions"
      );

    if (!bottom) {
      return null;
    }

    return (
      Array.from(
        bottom.querySelectorAll(
          "button"
        )
      ).find(button => {
        return (
          isVisible(button) &&
          !button.disabled &&
          compactText(
            button.textContent
          ) === compactText(text)
        );
      }) ||
      null
    );
  }

  function getVisibleLandingPopconfirm() {
    const popovers =
      Array.from(
        document.querySelectorAll(
          ".ant-popover.ant-popconfirm, .ant-popconfirm"
        )
      ).filter(isVisible);

    return (
      popovers.find(popover => {
        return compactText(
          popover.textContent
        ).includes(
          "确认已补充完整订单相关的资料，发起落单吗？"
        );
      }) ||
      null
    );
  }

  function findLandingPopoverConfirmButton(
    popover
  ) {
    if (!popover) {
      return null;
    }

    return (
      Array.from(
        popover.querySelectorAll(
          ".ant-popover-buttons button"
        )
      ).find(button => {
        return (
          isVisible(button) &&
          !button.disabled &&
          compactText(
            button.textContent
          ) === "确定"
        );
      }) ||
      null
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
      ) ||
      getCurrentOrderCode()
    );
  }

  function getExtractOpportunityCode() {
    const raw =
      (
        queryText(
          CONFIG.EXTRACT_OPPORTUNITY_CODE_SELECTOR
        ) ||
        getFormItemTextByFor(
          "register_opportunity_id"
        )
      )
        .replace(
          /^'+/,
          ""
        )
        .trim();

    return raw
      ? `'${raw}`
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

  async function fetchProcessLogs() {
    const orderCode =
      getCurrentOrderCode();

    if (!orderCode) {
      throw new Error(
        "未识别到当前订单编号，无法读取落单日志"
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
        `落单日志接口请求失败：HTTP ${response.status}`
      );
    }

    return {
      orderCode,
      payload:
        await response.json()
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

    if (Array.isArray(value)) {
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

        return a.index -
          b.index;
      }
    );

    return records;
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

    [
      "订单名称",
      "订单编号",
      "商机代码",
      "健管顾问姓名",
      "落单时间"
    ].forEach(
      (label, index) => {
        if (!values[index]) {
          missing.push(label);
        }
      }
    );

    if (missing.length) {
      throw new Error(
        `落单数据提取不完整：${missing.join("、")}`
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
        // 继续使用兼容复制。
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
        "浏览器未允许自动复制，可打开“体检数据”模块手动复制"
      );
    }

    return true;
  }

  async function waitForLatestLandingRecordAfterFlow(
    flowStartedAt,
    token = null
  ) {
    const startedAt =
      Date.now();

    let lastError = null;
    let lastSeen = null;
    let interval =
      CONFIG.LANDING_COPY_POLL_INTERVAL;

    while (
      Date.now() -
        startedAt <
      CONFIG.LANDING_COPY_TIMEOUT
    ) {
      throwIfFlowCancelled(
        token
      );

      try {
        const result =
          await fetchProcessLogs();

        const records =
          parseLandingRecordsFromProcessLogs(
            result.payload
          );

        if (records.length) {
          const latest =
            records[
              records.length - 1
            ];

          lastSeen = {
            latest,
            records,
            orderCode:
              result.orderCode
          };

          const latestAt =
            dateTimeToNumber(
              latest.time
            );

          /*
           * 只接受本次自动流程启动后附近产生的最新落单记录，
           * 避免修改订单时误复制历史落单时间。
           */
          if (
            !Number.isFinite(
              latestAt
            ) ||
            latestAt >=
              flowStartedAt -
                120000
          ) {
            return lastSeen;
          }
        }
      } catch (error) {
        lastError =
          error;
      }

      updatePanelStatus(
        lastSeen
          ? `订单已落单，等待本次最新落单日志刷新；当前最新记录：${lastSeen.latest.time}`
          : "订单已落单，正在等待落单日志生成后自动复制数据...",
        "normal",
        {
          persistent: true
        }
      );

      await sleep(
        interval
      );

      interval =
        Math.min(
          1600,
          interval + 150
        );
    }

    if (lastError) {
      throw new Error(
        `订单已完成，但读取最新落单日志失败：${lastError?.message || lastError}`
      );
    }

    if (lastSeen) {
      throw new Error(
        `订单已完成，但30秒内未确认本次最新落单记录；当前日志最新时间为 ${lastSeen.latest.time}`
      );
    }

    throw new Error(
      "订单已完成，但30秒内未读取到落单记录"
    );
  }

  async function copyLandingDataAfterFlow(
    {
      flowStartedAt,
      token = null
    }
  ) {
    const result =
      await waitForLatestLandingRecordAfterFlow(
        flowStartedAt,
        token
      );

    const latest =
      result.latest;

    const modifiedCount =
      Math.max(
        0,
        result.records.length - 1
      );

    const label =
      modifiedCount > 0
        ? `修改${modifiedCount}次`
        : "首次落单";

    const line =
      buildSpreadsheetLine(
        latest.time
      );

    await copyTextToClipboard(
      line
    );

    console.log(
      "[SOA智能审批] 落单完成自动复制：",
      {
        label,
        landingTime:
          latest.time,
        line
      }
    );

    return {
      label,
      landingTime:
        latest.time,
      line
    };
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


  function getFlowStepTitles() {
    return Array.from(
      document.querySelectorAll(
        ".ant-steps-item-title"
      )
    )
      .map(element =>
        cleanText(
          element.textContent
        )
      )
      .filter(Boolean);
  }

  function isStageBeforeInternalReview(
    stage
  ) {
    if (!stage) {
      return false;
    }

    const titles =
      getFlowStepTitles();

    const currentIndex =
      titles.indexOf(stage);

    const reviewIndex =
      titles.indexOf(
        "内勤复核"
      );

    if (
      currentIndex >= 0 &&
      reviewIndex >= 0
    ) {
      return (
        currentIndex <
        reviewIndex
      );
    }

    /*
     * DOM 顺序无法判断时使用已知早期阶段兜底。
     * “制单”用于兼容部分订单页面对报价单设计阶段的不同命名。
     */
    return [
      "制单",
      "报价单设计",
      "授权审批",
      "报价确认"
    ].includes(stage);
  }

  function isSupportedAutoProcessStage(
    stage
  ) {
    return [
      "内勤复核",
      "合同补充",
      "落单审核",
      "落单中",
      "已落单"
    ].includes(stage);
  }

  function getAutomationStageIssue(
    stage
  ) {
    if (!stage) {
      return "阶段异常：暂未识别当前流程阶段";
    }

    if (
      isStageBeforeInternalReview(
        stage
      )
    ) {
      return `阶段异常：当前“${stage}”尚未进入内勤复核`;
    }

    if (
      !isSupportedAutoProcessStage(
        stage
      )
    ) {
      return `阶段异常：当前“${stage}”暂未配置自动处理动作`;
    }

    return "";
  }

  function updateFlowRunButtonState(
    stage =
      getCurrentFlowStage()
  ) {
    const button =
      document.getElementById(
        UI.FLOW_RUN_BUTTON_ID
      );

    if (!button) {
      return;
    }

    if (processRunning) {
      if (
        activeFlowToken &&
        activeFlowToken.cancelled
      ) {
        button.disabled =
          true;

        button.textContent =
          "停止中...";

        button.style.background =
          "#ff7875";

        button.style.color =
          "#fff";

        button.style.cursor =
          "wait";

        return;
      }

      button.disabled =
        false;

      button.textContent =
        "点击停止";

      button.style.background =
        "#ff4d4f";

      button.style.color =
        "#fff";

      button.style.cursor =
        "pointer";

      return;
    }

    if (
      stage ===
      "已落单"
    ) {
      button.disabled =
        true;

      button.textContent =
        "订单已完成";

      button.style.background =
        "#52c41a";

      button.style.color =
        "#fff";

      button.style.cursor =
        "default";

      button.title =
        "当前订单流程已完成，无需再次执行自动处理。";

      return;
    }

    const issue =
      getAutomationStageIssue(
        stage
      );

    if (issue) {
      button.disabled =
        true;

      button.textContent =
        "阶段异常：暂不可处理";

      button.style.background =
        "#ff4d4f";

      button.style.color =
        "#fff";

      button.style.cursor =
        "not-allowed";

      button.title =
        issue;

      return;
    }

    button.disabled =
      false;

    button.textContent =
      "立即处理订单";

    button.style.background =
      "#1677ff";

    button.style.color =
      "#fff";

    button.style.cursor =
      "pointer";

    button.title =
      "点击开始处理当前订单";
  }

  function getFlowStagePresentation(
    stage
  ) {
    const presentations = {
      "报价单设计": {
        color: "#595959",
        size: "13px",
        weight: "600",
        hint:
          "当前处于报价单设计阶段，暂不执行自动审批。"
      },

      "授权审批": {
        color: "#1677ff",
        size: "14px",
        weight: "600",
        hint:
          "当前处于授权审批阶段，等待流程进入报价确认。"
      },

      "报价确认": {
        color: "#08979c",
        size: "14px",
        weight: "700",
        hint:
          "当前处于报价确认阶段，等待流程进入内勤复核。"
      },

      "内勤复核": {
        color: "#d46b08",
        size: "15px",
        weight: "700",
        hint:
          "点击“立即处理订单”可自动填写内勤复核备注并继续流程。"
      },

      "合同补充": {
        color: "#722ed1",
        size: "15px",
        weight: "700",
        hint:
          "点击“立即处理订单”可自动完成合同补充、上传文件并发起落单。"
      },

      "落单审核": {
        color: "#cf1322",
        size: "15px",
        weight: "700",
        hint:
          "点击“立即处理订单”可自动填写落单审核备注并确认落单。"
      },

      "落单中": {
        color: "#d48806",
        size: "15px",
        weight: "700",
        hint:
          "订单正在落单，等待页面进入“已落单”状态。"
      },

      "已落单": {
        color: "#389e0d",
        size: "16px",
        weight: "700",
        hint:
          "流程已完成。"
      }
    };

    return (
      presentations[stage] ||
      {
        color: "#595959",
        size: "14px",
        weight: "600",
        hint:
          stage
            ? "当前阶段尚未配置专用提示，请以页面流程进度为准。"
            : "正在读取页面流程状态..."
      }
    );
  }

  function updateFlowStageDisplay(
    {
      refreshOnLanding =
        false
    } = {}
  ) {
    const labelElement =
      document.getElementById(
        UI.FLOW_STAGE_LABEL_ID
      );

    const valueElement =
      document.getElementById(
        UI.FLOW_STAGE_VALUE_ID
      );

    const hintElement =
      document.getElementById(
        UI.FLOW_STAGE_HINT_ID
      );

    if (
      !labelElement ||
      !valueElement ||
      !hintElement
    ) {
      return "";
    }

    const stage =
      getCurrentFlowStage();

    const presentation =
      getFlowStagePresentation(
        stage
      );

    const stageIssue =
      getAutomationStageIssue(
        stage
      );

    labelElement.textContent =
      "当前阶段：";

    valueElement.textContent =
      stage || "识别中";

    valueElement.style.color =
      stageIssue
        ? "#cf1322"
        : presentation.color;

    valueElement.style.fontSize =
      stageIssue
        ? "14px"
        : presentation.size;

    valueElement.style.fontWeight =
      stageIssue
        ? "700"
        : presentation.weight;

    hintElement.textContent =
      stageIssue ||
      presentation.hint;

    hintElement.style.color =
      stageIssue
        ? "#cf1322"
        : "#999";

    hintElement.style.fontWeight =
      stageIssue
        ? "600"
        : "400";

    const changed =
      stage !==
      lastDisplayedFlowStage;

    lastDisplayedFlowStage =
      stage;

    updateFlowRunButtonState(
      stage
    );

    /*
     * 日期检测只在“实际阶段发生变化”时触发；
     * 另外还会在页面初始化、打开面板和执行订单时主动刷新。
     */
    if (changed) {
      refreshExamDateInfo(
        stage
      );
    }

    return stage;
  }


  function ensureDefaultSettings() {
    const review =
      cleanText(
        getStoredText(
          UI.REVIEW_REMARK_KEY
        )
      );

    const order =
      cleanText(
        getStoredText(
          UI.ORDER_REMARK_KEY
        )
      );

    if (!review) {
      saveStoredText(
        UI.REVIEW_REMARK_KEY,
        DEFAULTS.REVIEW_REMARK
      );
    }

    if (!order) {
      saveStoredText(
        UI.ORDER_REMARK_KEY,
        DEFAULTS.ORDER_REMARK
      );
    }

    const mode =
      getStoredText(
        UI.SIGNING_MODE_KEY,
        DEFAULTS.SIGNING_COMPANY_MODE
      );

    if (
      mode !== "first" &&
      mode !== "text"
    ) {
      saveStoredText(
        UI.SIGNING_MODE_KEY,
        DEFAULTS.SIGNING_COMPANY_MODE
      );
    }
  }

  function restoreDefaultRemarks() {
    saveStoredText(
      UI.REVIEW_REMARK_KEY,
      DEFAULTS.REVIEW_REMARK
    );

    saveStoredText(
      UI.ORDER_REMARK_KEY,
      DEFAULTS.ORDER_REMARK
    );

    const reviewInput =
      document.getElementById(
        UI.REVIEW_REMARK_ID
      );

    const orderInput =
      document.getElementById(
        UI.ORDER_REMARK_ID
      );

    if (reviewInput) {
      reviewInput.value =
        DEFAULTS.REVIEW_REMARK;
    }

    if (orderInput) {
      orderInput.value =
        DEFAULTS.ORDER_REMARK;
    }

    updateRemarkStatus();

    updatePanelStatus(
      "✓ 已恢复默认审批备注。",
      "success"
    );
  }

  function getSigningCompanyConfig() {
    const storedMode =
      getStoredText(
        UI.SIGNING_MODE_KEY,
        DEFAULTS.SIGNING_COMPANY_MODE
      );

    const mode =
      storedMode === "text"
        ? "text"
        : "first";

    const text =
      cleanText(
        getStoredText(
          UI.SIGNING_TEXT_KEY,
          DEFAULTS.SIGNING_COMPANY_TEXT
        )
      );

    return {
      mode,
      text
    };
  }

  function saveSigningCompanyConfig(
    mode,
    text = ""
  ) {
    const normalizedMode =
      mode === "text"
        ? "text"
        : "first";

    saveStoredText(
      UI.SIGNING_MODE_KEY,
      normalizedMode
    );

    saveStoredText(
      UI.SIGNING_TEXT_KEY,
      cleanText(text)
    );

    updateSigningCompanyUi();
  }

  function updateSigningCompanyUi() {
    const button =
      document.getElementById(
        UI.SIGNING_BUTTON_ID
      );

    const firstRadio =
      document.getElementById(
        UI.SIGNING_FIRST_ID
      );

    const textRadio =
      document.getElementById(
        UI.SIGNING_TEXT_MODE_ID
      );

    const textInput =
      document.getElementById(
        UI.SIGNING_TEXT_ID
      );

    const config =
      getSigningCompanyConfig();

    if (button) {
      button.textContent =
        "签单主体";

      if (
        config.mode === "first"
      ) {
        button.style.color =
          "#389e0d";

        button.style.borderColor =
          "#b7eb8f";

        button.style.background =
          "#f6ffed";

        button.title =
          "当前：按下拉顺序选择第一个可用选项";
      } else if (
        config.text
      ) {
        button.style.color =
          "#389e0d";

        button.style.borderColor =
          "#b7eb8f";

        button.style.background =
          "#f6ffed";

        button.title =
          `当前：按名称精确匹配“${config.text}”`;
      } else {
        button.style.color =
          "#cf1322";

        button.style.borderColor =
          "#ffccc7";

        button.style.background =
          "#fff2f0";

        button.title =
          "已选择按名称匹配，但尚未填写签单主体名称";
      }
    }

    if (firstRadio) {
      firstRadio.checked =
        config.mode === "first";
    }

    if (textRadio) {
      textRadio.checked =
        config.mode === "text";
    }

    if (textInput) {
      textInput.value =
        config.text;

      textInput.disabled =
        config.mode !== "text";

      textInput.style.opacity =
        config.mode === "text"
          ? "1"
          : "0.55";
    }
  }

  function toggleSigningPanel() {
    const panel =
      document.getElementById(
        UI.SIGNING_PANEL_ID
      );

    if (!panel) {
      return;
    }

    const opening =
      panel.style.display ===
      "none";

    panel.style.display =
      opening
        ? "block"
        : "none";

    if (opening) {
      const remarkPanel =
        document.getElementById(
          UI.REMARK_PANEL_ID
        );

      if (remarkPanel) {
        remarkPanel.style.display =
          "none";
      }

      updateSigningCompanyUi();
    }
  }

  function getStoredText(
    key,
    fallback = ""
  ) {
    try {
      return (
        localStorage.getItem(
          key
        ) ?? fallback
      );
    } catch (_) {
      return fallback;
    }
  }

  function saveStoredText(
    key,
    value
  ) {
    try {
      localStorage.setItem(
        key,
        String(value || "")
      );
    } catch (_) {
      // 保存失败不影响当前执行。
    }
  }

  function getReviewRemark() {
    return cleanText(
      document.getElementById(
        UI.REVIEW_REMARK_ID
      )?.value ||
      getStoredText(
        UI.REVIEW_REMARK_KEY,
        DEFAULTS.REVIEW_REMARK
      )
    );
  }

  function getOrderRemark() {
    return cleanText(
      document.getElementById(
        UI.ORDER_REMARK_ID
      )?.value ||
      getStoredText(
        UI.ORDER_REMARK_KEY,
        DEFAULTS.ORDER_REMARK
      )
    );
  }

  function updateRemarkStatus() {
    const button =
      document.getElementById(
        UI.REMARK_BUTTON_ID
      );

    if (!button) {
      return;
    }

    const review =
      getReviewRemark();

    const order =
      getOrderRemark();

    if (
      !review ||
      !order
    ) {
      button.textContent =
        "备注待设置";

      button.style.color =
        "#cf1322";

      button.style.borderColor =
        "#ffccc7";

      button.style.background =
        "#fff2f0";

      button.title =
        "审批备注不完整，点击设置";

      return;
    }

    const usingDefault =
      review ===
        DEFAULTS.REVIEW_REMARK &&
      order ===
        DEFAULTS.ORDER_REMARK;

    button.textContent =
      usingDefault
        ? "默认备注"
        : "自定义备注";

    button.style.color =
      "#389e0d";

    button.style.borderColor =
      "#b7eb8f";

    button.style.background =
      "#f6ffed";

    button.title =
      usingDefault
        ? "当前使用脚本默认备注，点击可修改"
        : "当前使用自定义备注，点击可修改或恢复默认";
  }

  function toggleHelpPanel() {
    const panel =
      document.getElementById(
        UI.HELP_PANEL_ID
      );

    const button =
      document.getElementById(
        UI.HELP_BUTTON_ID
      );

    if (
      !panel ||
      !button
    ) {
      return;
    }

    const opening =
      panel.style.display ===
      "none";

    panel.style.display =
      opening
        ? "block"
        : "none";

    button.textContent =
      opening
        ? "收起说明"
        : "查看说明";
  }

  function toggleRemarkPanel() {
    const panel =
      document.getElementById(
        UI.REMARK_PANEL_ID
      );

    const button =
      document.getElementById(
        UI.REMARK_BUTTON_ID
      );

    if (
      !panel ||
      !button
    ) {
      return;
    }

    const opening =
      panel.style.display ===
      "none";

    panel.style.display =
      opening
        ? "block"
        : "none";

    if (opening) {
      const signingPanel =
        document.getElementById(
          UI.SIGNING_PANEL_ID
        );

      if (signingPanel) {
        signingPanel.style.display =
          "none";
      }
    }

    button.setAttribute(
      "aria-expanded",
      opening
        ? "true"
        : "false"
    );

    updateRemarkStatus();
  }

  function getVisibleApprovalModal() {
    const modals =
      Array.from(
        document.querySelectorAll(
          ".ant-modal"
        )
      ).filter(isVisible);

    return (
      modals.find(modal => {
        const title =
          compactText(
            modal.querySelector(
              ".ant-modal-title"
            )?.textContent
          );

        const remark =
          modal.querySelector(
            "#remark"
          );

        return (
          remark &&
          (
            title.includes(
              "审批"
            ) ||
            title.includes(
              "审核"
            )
          )
        );
      }) ||
      null
    );
  }

  function findModalConfirmButton(
    modal
  ) {
    if (!modal) {
      return null;
    }

    return (
      Array.from(
        modal.querySelectorAll(
          ".ant-modal-footer button"
        )
      ).find(button => {
        return (
          isVisible(button) &&
          compactText(
            button.textContent
          ) === "确认"
        );
      }) ||
      null
    );
  }

  function findBottomPrimaryAction() {
    const bottom =
      document.querySelector(
        ".bottom .actions"
      );

    if (!bottom) {
      return null;
    }

    const buttons =
      Array.from(
        bottom.querySelectorAll(
          "button"
        )
      ).filter(button => {
        return (
          isVisible(button) &&
          !button.disabled &&
          button.classList.contains(
            "ant-btn-primary"
          )
        );
      });

    return buttons[0] || null;
  }

  const FLOW_STAGE_SEQUENCE = [
    "制单",
    "报价单设计",
    "授权审批",
    "报价确认",
    "内勤复核",
    "合同补充",
    "落单审核",
    "落单中",
    "已落单"
  ];

  function isForwardStageTransition(
    oldStage,
    newStage
  ) {
    if (
      !oldStage ||
      !newStage ||
      oldStage === newStage
    ) {
      return false;
    }

    const oldIndex =
      FLOW_STAGE_SEQUENCE.indexOf(
        oldStage
      );

    const newIndex =
      FLOW_STAGE_SEQUENCE.indexOf(
        newStage
      );

    if (
      oldIndex < 0 ||
      newIndex < 0
    ) {
      return false;
    }

    return newIndex >
      oldIndex;
  }

  function isLandingReviewReadyForResync() {
    if (
      getCurrentFlowStage() !==
        "落单审核"
    ) {
      return false;
    }

    const modal =
      getVisibleApprovalModal();

    if (modal) {
      const confirm =
        findModalConfirmButton(
          modal
        );

      return Boolean(
        confirm &&
        !confirm.disabled &&
        !confirm.classList.contains(
          "ant-btn-loading"
        )
      );
    }

    const action =
      findBottomActionByText(
        "确认落单"
      ) ||
      findBottomPrimaryAction();

    return Boolean(
      action &&
      isVisible(
        action
      ) &&
      !action.disabled &&
      !action.classList.contains(
        "ant-btn-loading"
      )
    );
  }

  async function waitForStageChange(
    oldStage,
    token = null,
    {
      strict =
        oldStage ===
          "合同补充",

      allowLandingReviewResync =
        false
    } = {}
  ) {
    const timeout =
      oldStage ===
        "落单中"
        ? CONFIG.LANDING_STAGE_TIMEOUT
        : CONFIG.STAGE_CHANGE_TIMEOUT;

    let transientStage =
      "";

    let transientSince =
      0;

    let resyncReadyCount =
      0;

    const nextStage =
      await waitForReactiveCondition(
        () => {
          const stage =
            getCurrentFlowStage();

          if (
            !stage ||
            stage === oldStage
          ) {
            transientStage =
              "";

            transientSince =
              0;

            resyncReadyCount =
              0;

            return null;
          }

          /*
           * 只把“明确向后的有效阶段”当作真正推进。
           *
           * SOA页面在保存/审批后会出现 React 重绘：
           * 顶部步骤可能短暂回显上一个阶段，甚至出现旧步骤高亮。
           * v2.3 会立即把这种瞬时回显判为异常；v2.4 改为继续观察。
           */
          if (
            isForwardStageTransition(
              oldStage,
              stage
            )
          ) {
            return stage;
          }

          /*
           * 针对已实际观察到的场景：
           * 落单审核提交后页面曾短暂进入“落单中”，
           * 随后又真实回到“落单审核”并重新出现可操作按钮。
           *
           * 这时继续死等“已落单”没有意义；
           * 当落单审核页面连续两次被确认“可操作”后，
           * 自动把流程重新同步回落单审核，相当于自动完成
           * 用户原先的“停止 -> 再启动”操作。
           *
           * 仅对 oldStage=落单中 生效，不扩展到其他阶段。
           */
          if (
            allowLandingReviewResync &&
            oldStage ===
              "落单中" &&
            stage ===
              "落单审核" &&
            isLandingReviewReadyForResync()
          ) {
            resyncReadyCount +=
              1;

            if (
              resyncReadyCount >=
                2
            ) {
              return stage;
            }
          } else {
            resyncReadyCount =
              0;
          }

          if (
            transientStage !==
              stage
          ) {
            transientStage =
              stage;

            transientSince =
              Date.now();
          }

          /*
           * 合同阶段仍然“严格”：
           * - 必须等到真正向后续阶段；
           * - 但也不因为一次瞬时旧阶段回显就立刻停止。
           *
           * 非合同阶段采用同样的容错等待，只是诊断提示更轻。
           */
          return null;
        },
        {
          label:
            strict
              ? `合同流程从“${oldStage}”进入下一阶段`
              : `“${oldStage}”处理完成并进入下一阶段`,
          token,
          timeout,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () => {
              const current =
                getCurrentFlowStage();

              const transientText =
                transientStage
                  ? (
                      `；页面曾短暂显示“${transientStage}”` +
                      (
                        transientSince
                          ? `（${Math.max(
                              1,
                              Math.floor(
                                (
                                  Date.now() -
                                  transientSince
                                ) /
                                1000
                              )
                            )}秒）`
                          : ""
                      )
                    )
                  : "";

              if (strict) {
                return (
                  getFlowWaitDiagnostic(
                    `等待合同阶段真正推进${transientText}`
                  )
                );
              }

              const resyncText =
                (
                  allowLandingReviewResync &&
                  current ===
                    "落单审核"
                )
                  ? "；正在确认是否需要自动回到落单审核继续处理"
                  : "";

              return (
                `当前阶段=${current || "未识别"}${transientText}${resyncText}`
              );
            }
        }
      );

    /*
     * 阶段文字已经变化后，再等待两次浏览器绘制。
     * 不是固定毫秒等待，只是给 React 一次完成新阶段UI挂载的机会；
     * 后续具体按钮仍由动态DOM条件等待。
     */
    await nextPaint(2);

    throwIfFlowCancelled(
      token
    );

    return nextStage;
  }

  async function fillAndConfirmApproval(
    stage,
    remarkText,
    preferredActionText = "",
    token = null
  ) {
    if (!remarkText) {
      throw new Error(
        `“${stage}”备注尚未维护，请先在工具面板填写`
      );
    }

    let modal =
      getVisibleApprovalModal();

    if (!modal) {
      const action =
        await waitForReactiveCondition(
          () => {
            const found =
              (
                preferredActionText
                  ? findBottomActionByText(
                      preferredActionText
                    )
                  : null
              ) ||
              findBottomPrimaryAction();

            return (
              found ||
              null
            );
          },
          {
            label:
              `“${stage}”主操作按钮`,
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getFlowWaitDiagnostic(
                  `等待“${stage}”可执行按钮`
                )
          }
        );

      log(
        `“${stage}”：点击“${cleanText(action.textContent)}”，等待审批弹窗准备完成...`
      );

      action.click();

      const outcome =
        await waitForReactiveCondition(
          () => {
            const currentModal =
              getVisibleApprovalModal();

            if (currentModal) {
              return {
                type:
                  "modal",
                modal:
                  currentModal
              };
            }

            const currentStage =
              getCurrentFlowStage();

            if (
              currentStage &&
              currentStage !== stage &&
              isForwardStageTransition(
                stage,
                currentStage
              )
            ) {
              return {
                type:
                  "stage",
                stage:
                  currentStage
              };
            }

            /*
             * 非向前的阶段变化可能只是页面重绘造成的短暂旧状态，
             * 不在这里提前判错，继续等待审批弹窗或真实向前推进。
             */
            return null;
          },
          {
            label:
              `“${stage}”审批弹窗`,
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getFlowWaitDiagnostic(
                  `已点击“${stage}”操作，等待审批弹窗或阶段直接推进`
                )
          }
        );

      if (
        outcome.type ===
        "stage"
      ) {
        log(
          `“${stage}”已直接推进到“${outcome.stage}”。`
        );

        return outcome.stage;
      }

      modal =
        outcome.modal;
    }

    const controls =
      await waitForReactiveCondition(
        () => {
          if (
            !modal ||
            !modal.isConnected ||
            !isVisible(modal)
          ) {
            return null;
          }

          const remark =
            modal.querySelector(
              "#remark"
            );

          const confirm =
            findModalConfirmButton(
              modal
            );

          if (
            remark &&
            !remark.disabled &&
            !remark.readOnly &&
            confirm &&
            !confirm.disabled &&
            !confirm.classList.contains(
              "ant-btn-loading"
            )
          ) {
            return {
              remark,
              confirm
            };
          }

          return null;
        },
        {
          label:
            `“${stage}”审批表单可填写`,
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getFlowWaitDiagnostic(
                `等待“${stage}”备注和确认按钮就绪`
              )
        }
      );

    const stable =
      await waitForStableControlledValue(
        controls.remark,
        remarkText,
        token
      );

    if (!stable) {
      throw new Error(
        `“${stage}”备注写入后被页面回退，已停止自动确认`
      );
    }

    /*
     * 再次确认按钮仍然有效，避免输入过程中弹窗状态变化。
     */
    const confirm =
      await waitForReactiveCondition(
        () => {
          const button =
            findModalConfirmButton(
              modal
            );

          if (
            button &&
            !button.disabled &&
            !button.classList.contains(
              "ant-btn-loading"
            ) &&
            String(
              controls.remark.value
            ) === String(
              remarkText
            )
          ) {
            return button;
          }

          return null;
        },
        {
          label:
            `“${stage}”确认按钮可提交`,
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getFlowWaitDiagnostic(
                `备注已写入，等待“${stage}”确认按钮可提交`
              )
        }
      );

    log(
      `“${stage}”：备注已稳定写入，点击确认并等待流程实际推进...`
    );

    confirm.click();

    /*
     * 不以“弹窗关闭”作为完成标准。
     * 真正完成标准是顶部流程阶段发生变化。
     */
    const nextStage =
      await waitForStageChange(
        stage,
        token,
        {
          strict: false
        }
      );

    log(
      `✓ “${stage}”已进入“${nextStage}”`
    );

    return nextStage;
  }

  async function submitContractStage(
    token = null
  ) {
    const stage =
      getCurrentFlowStage();

    if (
      stage !==
      "合同补充"
    ) {
      throw new Error(
        `当前阶段为“${stage || "未知"}”，不是合同补充`
      );
    }

    await waitForReactiveCondition(
      () => {
        const state =
          getContractCompletionState();

        if (
          state.complete &&
          !formLooksEditable()
        ) {
          return state;
        }

        return null;
      },
      {
        label:
          "发起落单前合同资料最终校验",
        token,
        timeout:
          CONFIG.CONTRACT_FINAL_VERIFY_TIMEOUT,
        blockerCheck:
          () =>
            getVisibleErrorFeedback(),
        diagnose:
          () =>
            getContractDiagnosticSummary()
      }
    );

    let popconfirm =
      getVisibleLandingPopconfirm();

    if (!popconfirm) {
      const action =
        await waitForReactiveCondition(
          () =>
            findBottomActionByText(
              "发起落单"
            ) ||
            findBottomPrimaryAction() ||
            null,
          {
            label:
              "合同补充阶段“发起落单”按钮",
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getFlowWaitDiagnostic(
                  "合同已验证完成，等待发起落单按钮"
                )
          }
        );

      log(
        `合同补充：点击“${cleanText(action.textContent)}”，等待确认框...`
      );

      action.click();

      popconfirm =
        await waitForReactiveCondition(
          () =>
            getVisibleLandingPopconfirm() ||
            null,
          {
            label:
              "发起落单确认框",
            token,
            blockerCheck:
              () =>
                getVisibleErrorFeedback(),
            diagnose:
              () =>
                getFlowWaitDiagnostic(
                  "已点击发起落单，等待确认框"
                )
          }
        );
    }

    const confirmButton =
      await waitForReactiveCondition(
        () => {
          const button =
            findLandingPopoverConfirmButton(
              popconfirm
            );

          if (
            button &&
            !button.disabled &&
            !button.classList.contains(
              "ant-btn-loading"
            )
          ) {
            return button;
          }

          return null;
        },
        {
          label:
            "发起落单“确定”按钮",
          token,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getFlowWaitDiagnostic(
                "确认框已显示，等待确定按钮可提交"
              )
        }
      );

    log(
      "合同补充：点击“确定”，等待流程真实进入下一阶段..."
    );

    confirmButton.click();

    const nextStage =
      await waitForStageChange(
        "合同补充",
        token,
        {
          strict: true
        }
      );

    log(
      `✓ 已进入：${nextStage}`
    );

    return nextStage;
  }

  async function runFullFlow(
    {
      token = null
    } = {}
  ) {
    if (processRunning) {
      requestFlowStop();
      return;
    }

    token =
      token ||
      createFlowToken();

    activeFlowToken =
      token;

    processRunning = true;

    const flowStartedAt =
      Date.now();

    let landingDataCopied =
      false;

    updateFlowRunButtonState(
      getCurrentFlowStage()
    );

    try {
      while (
        isTargetRoute()
      ) {
        throwIfFlowCancelled(
          token
        );

        const blocker =
          getPageBlocker({
            allowApprovalModal:
              true,
            allowLandingPopconfirm:
              true
          });

        if (blocker) {
          throw new FlowBlockedError(
            blocker
          );
        }

        let stage =
          getCurrentFlowStage();

        if (!stage) {
          stage =
            await waitForReactiveCondition(
              () =>
                getCurrentFlowStage() ||
                null,
              {
                label:
                  "当前流程阶段",
                token,
                blockerCheck:
                  () =>
                    getVisibleErrorFeedback(),
                diagnose:
                  () =>
                    getFlowWaitDiagnostic(
                      "等待页面流程步骤加载"
                    )
              }
            );
        }

        throwIfFlowCancelled(
          token
        );

        log(
          `当前流程阶段：${stage}`
        );

        refreshExamDateInfo(
          stage
        );

        updateFlowRunButtonState(
          stage
        );

        const stageIssue =
          getAutomationStageIssue(
            stage
          );

        if (stageIssue) {
          updatePanelStatus(
            stageIssue +
            "。本次不会等待阶段变化，也不会自动继续。",
            "error"
          );

          return;
        }

        if (
          stage ===
          "内勤复核"
        ) {
          await fillAndConfirmApproval(
            "内勤复核",
            getReviewRemark(),
            "",
            token
          );

          continue;
        }

        if (
          stage ===
          "合同补充"
        ) {
          await ensureContractTabVisible(
            token
          );

          throwIfFlowCancelled(
            token
          );

          await runContractProcess({
            token
          });

          throwIfFlowCancelled(
            token
          );

          /*
           * runContractProcess 只处理合同内容/保存/上传，
           * 流程仍在合同补充时再发起落单。
           */
          if (
            getCurrentFlowStage() ===
            "合同补充"
          ) {
            await submitContractStage(
              token
            );
          }

          continue;
        }

        if (
          stage ===
          "落单审核"
        ) {
          await fillAndConfirmApproval(
            "落单审核",
            getOrderRemark(),
            "确认落单",
            token
          );

          continue;
        }

        if (
          stage ===
          "落单中"
        ) {
          updatePanelStatus(
            "流程处于“落单中”，等待网页实际完成落单..."
          );

          const observedStage =
            await waitForStageChange(
              "落单中",
              token,
              {
                strict:
                  false,

                allowLandingReviewResync:
                  true
              }
            );

          if (
            observedStage ===
              "落单审核"
          ) {
            log(
              "检测到“落单中”未稳定并重新回到可操作的“落单审核”，已自动重新同步流程。"
            );

            updatePanelStatus(
              "检测到流程重新回到“落单审核”，正在自动继续处理..."
            );
          }

          continue;
        }

        if (
          stage ===
          "已落单"
        ) {
          if (!landingDataCopied) {
            try {
              const copied =
                await copyLandingDataAfterFlow({
                  flowStartedAt,
                  token
                });

              landingDataCopied =
                true;

              updatePanelStatus(
                `✓ 订单流程已完成；“${copied.label}”落单数据已自动复制，可直接粘贴到表格。`,
                "success",
                {
                  persistent: true
                }
              );
            } catch (error) {
              console.error(
                "[SOA智能审批] 落单完成后自动复制失败：",
                error
              );

              updatePanelStatus(
                `✓ 订单流程已完成，但自动复制落单数据失败：${error?.message || error}。可打开“体检数据”模块手动复制。`,
                "error",
                {
                  persistent: true
                }
              );
            }
          }

          return;
        }

        /*
         * 理论上所有未支持阶段都会在 stageIssue 中被拦截。
         * 保留此处作为最终安全兜底：绝不等待未知阶段自动变化。
         */
        updatePanelStatus(
          `阶段异常：当前“${stage || "未知"}”不可自动处理。`,
          "error"
        );

        return;
      }
    } catch (error) {
      if (
        error instanceof
          FlowCancelledError ||
        token.cancelled
      ) {
        updatePanelStatus(
          "■ 自动流程已停止。"
        );

        return;
      }

      throw error;
    } finally {
      processRunning = false;

      if (
        activeFlowToken ===
        token
      ) {
        activeFlowToken =
          null;
      }

      updateFlowRunButtonState(
        getCurrentFlowStage()
      );
    }
  }

  async function runContractProcess(
    {
      token = null
    } = {}
  ) {
    if (!contractPageVisible()) {
      throw new Error(
        "当前没有显示合同页"
      );
    }

    const initialState =
      getContractCompletionState();

    if (
      initialState.complete &&
      !formLooksEditable()
    ) {
      log(
        "✓ 合同字段及当前合同类型的上传文件已完整，验证通过并跳过重复处理。"
      );

      updatePanelStatus(
        "✓ 合同资料已完整，直接进入下一步。",
        "success"
      );

      return;
    }

    let formChanged =
      false;

    if (
      initialState.formNeedsEdit
    ) {
      log(
        "合同补充：检测到当前可见合同字段缺失，仅补充缺失内容..."
      );

      await enterEditMode(
        token
      );

      const before =
        getContractFormSnapshot();

      await selectConfiguredContractCompany(
        token
      );

      await setContractDates(
        token
      );

      await fillInspectionPeopleDay(
        token
      );

      const after =
        getContractFormSnapshot();

      const afterIssues =
        getContractFormIssues(
          after
        );

      if (afterIssues.length) {
        throw new FlowBlockedError(
          `合同字段填写后复核未通过：${afterIssues.join("、")}`
        );
      }

      formChanged =
        (
          before.companyValue !==
          after.companyValue
        ) ||
        (
          before.beginValue !==
          after.beginValue
        ) ||
        (
          before.endValue !==
          after.endValue
        ) ||
        (
          before.inspectionValue !==
          after.inspectionValue
        );

      if (formChanged) {
        await saveContractForm(
          token,
          after
        );
      } else if (
        formLooksEditable()
      ) {
        /*
         * 页面虽然判定无需改值，但如果当前已经进入编辑态，仍必须退出编辑并确认保存状态，
         * 否则后续“发起落单”可能被页面阻止。
         */
        await saveContractForm(
          token,
          after
        );
      } else {
        log(
          "✓ 合同字段无需修改，且当前不在编辑状态。"
        );
      }
    } else {
      if (formLooksEditable()) {
        log(
          "合同字段均已有值，但页面当前仍处编辑状态；执行当前合同表单保存并验证退出编辑。"
        );

        await saveContractForm(
          token,
          getContractFormSnapshot()
        );
      } else {
        log(
          "✓ 当前可见合同字段均已有值，且不在编辑状态，跳过字段编辑。"
        );
      }
    }

    /*
     * 保存后等待字段状态稳定，防止 React 重绘/接口延迟导致刚保存的值短暂回退。
     */
    await waitForReactiveCondition(
      () => {
        const state =
          getContractCompletionState();

        return !state.formNeedsEdit &&
          !formLooksEditable()
          ? state
          : null;
      },
      {
        label:
          "合同字段保存后的稳定状态",
        token,
        timeout:
          CONFIG.CONTRACT_FINAL_VERIFY_TIMEOUT,
        blockerCheck:
          () =>
            getVisibleErrorFeedback(),
        diagnose:
          () =>
            getContractDiagnosticSummary()
      }
    );

    const uploadState =
      getContractCompletionState();

    let sharedFile =
      null;

    if (
      uploadState.uploadNeedsFile
    ) {
      sharedFile =
        await getBoundFileForRun();

      log(
        `合同补充：仅为当前可见且缺失的上传项使用已选择文件 ${sharedFile.name}`
      );
    } else {
      log(
        "✓ 当前合同类型的合同文件/授权书已存在或模块不适用，不读取绑定文件。"
      );
    }

    const contractUploadResult =
      await uploadOne(
        "contract",
        sharedFile,
        "已盖章合同",
        token
      );

    const authUploadResult =
      await uploadOne(
        "auth",
        sharedFile,
        "授权书",
        token
      );

    const uploadResults = [
      contractUploadResult,
      authUploadResult
    ];

    const uploadedCount =
      uploadResults.filter(
        result =>
          result &&
          !result.skipped
      ).length;

    const existingCount =
      uploadResults.filter(
        result =>
          result?.reason ===
          "existing-file"
      ).length;

    const finalState =
      await waitForReactiveCondition(
        () => {
          const state =
            getContractCompletionState();

          return state.complete &&
            !formLooksEditable()
            ? state
            : null;
        },
        {
          label:
            "合同资料最终完整性验证",
          token,
          timeout:
            CONFIG.CONTRACT_FINAL_VERIFY_TIMEOUT,
          blockerCheck:
            () =>
              getVisibleErrorFeedback(),
          diagnose:
            () =>
              getContractDiagnosticSummary()
        }
      );

    const finalIssues =
      describeContractCompletionIssues(
        finalState
      );

    if (finalIssues.length) {
      throw new FlowBlockedError(
        `合同资料最终验证未通过：${finalIssues.join("、")}`
      );
    }

    updatePanelStatus(
      uploadedCount > 0 ||
      formChanged
        ? `✓ 合同验证通过：新增上传 ${uploadedCount} 项，已有文件跳过 ${existingCount} 项。`
        : "✓ 合同资料验证通过，无需重复处理。",
      "success"
    );
  }

  function clamp(
    value,
    min,
    max
  ) {
    return Math.min(
      Math.max(
        value,
        min
      ),
      max
    );
  }

  function savePanelPosition(
    left,
    top
  ) {
    try {
      localStorage.setItem(
        UI.POSITION_KEY,
        JSON.stringify({
          left,
          top
        })
      );
    } catch (_) {
      // 位置保存失败不影响工具使用。
    }
  }

  function loadPanelPosition() {
    try {
      const raw =
        localStorage.getItem(
          UI.POSITION_KEY
        );

      if (!raw) {
        return null;
      }

      const parsed =
        JSON.parse(raw);

      if (
        !Number.isFinite(
          parsed?.left
        ) ||
        !Number.isFinite(
          parsed?.top
        )
      ) {
        return null;
      }

      return {
        left:
          parsed.left,
        top:
          parsed.top
      };
    } catch (_) {
      return null;
    }
  }

  function applySavedPanelPosition(
    panel
  ) {
    const saved =
      loadPanelPosition();

    if (!saved) {
      return;
    }

    const rect =
      panel.getBoundingClientRect();

    const maxLeft =
      Math.max(
        0,
        window.innerWidth -
          rect.width
      );

    const maxTop =
      Math.max(
        0,
        window.innerHeight -
          rect.height
      );

    panel.style.right =
      "auto";

    panel.style.bottom =
      "auto";

    panel.style.left =
      `${clamp(
        saved.left,
        0,
        maxLeft
      )}px`;

    panel.style.top =
      `${clamp(
        saved.top,
        0,
        maxTop
      )}px`;
  }

  function enablePanelDragging(
    panel
  ) {
    const handle =
      document.getElementById(
        UI.DRAG_HANDLE_ID
      );

    if (!handle) {
      return;
    }

    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.style.cursor =
      "move";

    handle.style.userSelect =
      "none";

    handle.addEventListener(
      "mousedown",
      event => {
        if (
          event.button !== 0
        ) {
          return;
        }

        /*
         * 标题栏中的按钮/输入控件只执行自身功能，
         * 不允许同时触发窗口拖动。
         */
        if (
          event.target.closest(
            "button,input,textarea,select,label,a,[role='button']"
          )
        ) {
          return;
        }

        const rect =
          panel
            .getBoundingClientRect();

        dragging = true;

        offsetX =
          event.clientX -
          rect.left;

        offsetY =
          event.clientY -
          rect.top;

        panel.style.right =
          "auto";

        panel.style.bottom =
          "auto";

        panel.style.left =
          `${rect.left}px`;

        panel.style.top =
          `${rect.top}px`;

        event.preventDefault();
      }
    );

    document.addEventListener(
      "mousemove",
      event => {
        if (!dragging) {
          return;
        }

        const rect =
          panel
            .getBoundingClientRect();

        const maxLeft =
          Math.max(
            0,
            window.innerWidth -
              rect.width
          );

        const maxTop =
          Math.max(
            0,
            window.innerHeight -
              rect.height
          );

        const left =
          clamp(
            event.clientX -
              offsetX,
            0,
            maxLeft
          );

        const top =
          clamp(
            event.clientY -
              offsetY,
            0,
            maxTop
          );

        panel.style.left =
          `${left}px`;

        panel.style.top =
          `${top}px`;

        event.preventDefault();
      }
    );

    document.addEventListener(
      "mouseup",
      () => {
        if (!dragging) {
          return;
        }

        dragging = false;

        const rect =
          panel
            .getBoundingClientRect();

        savePanelPosition(
          rect.left,
          rect.top
        );
      }
    );

    window.addEventListener(
      "resize",
      () => {
        if (
          !document.body
            .contains(panel)
        ) {
          return;
        }

        const rect =
          panel
            .getBoundingClientRect();

        const maxLeft =
          Math.max(
            0,
            window.innerWidth -
              rect.width
          );

        const maxTop =
          Math.max(
            0,
            window.innerHeight -
              rect.height
          );

        const left =
          clamp(
            rect.left,
            0,
            maxLeft
          );

        const top =
          clamp(
            rect.top,
            0,
            maxTop
          );

        panel.style.right =
          "auto";

        panel.style.bottom =
          "auto";

        panel.style.left =
          `${left}px`;

        panel.style.top =
          `${top}px`;

        savePanelPosition(
          left,
          top
        );
      }
    );
  }

  function createTestPanel() {
    ensureDefaultSettings();

    const existing =
      document.getElementById(
        UI.PANEL_ID
      );

    if (existing) {
      updateBoundFileDisplay();
      updateRemarkStatus();
      updateSigningCompanyUi();
      renderWebNoticeHistory();
      updateFlowStageDisplay();
      refreshExamDateInfo(
        getCurrentFlowStage()
      );
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
      "right:22px",
      "bottom:28px",
      "z-index:99999",
      "width:340px",
      "box-sizing:border-box",
      "padding:10px 14px 14px",
      "border:1px solid #e5e7eb",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 28px rgba(0,0,0,.20)",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif",
      "font-size:13px",
      "color:#333"
    ].join(";");

    panel.innerHTML = `
      <div
        id="${UI.DRAG_HANDLE_ID}"
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          min-height:28px;
          margin:-2px -4px 6px -4px;
          padding:2px 4px;
          border-radius:6px;
        "
        title="按住标题栏可拖动窗口"
      >
        <strong style="
          flex:1 1 auto;
          min-width:0;
          font-size:15px;
        ">
          智能审批 v2.5
        </strong>

        <button
          id="${UI.HELP_BUTTON_ID}"
          type="button"
          style="
            flex:0 0 auto;
            height:26px;
            padding:0 8px;
            border:1px solid #d9d9d9;
            border-radius:5px;
            background:#fff;
            color:#666;
            font-size:12px;
            cursor:pointer;
            white-space:nowrap;
          "
          title="查看工具使用说明"
        >查看说明</button>

        <button
          id="${UI.COLLAPSE_BUTTON_ID}"
          type="button"
          style="
            flex:0 0 auto;
            width:26px;
            height:26px;
            padding:0;
            border:0;
            border-radius:5px;
            background:#f5f5f5;
            color:#666;
            font-size:20px;
            line-height:24px;
            cursor:pointer;
            font-weight:600;
          "
          title="关闭"
        >×</button>
      </div>

      <div id="${UI.PANEL_BODY_ID}">
        <div
          id="${UI.HELP_PANEL_ID}"
          style="
            display:none;
            margin-bottom:8px;
            padding:8px 10px;
            border:1px solid #d9d9d9;
            border-radius:6px;
            background:#fafafa;
            color:#555;
            font-size:10.5px;
            line-height:1.45;
          "
        >
          <div style="
            margin-bottom:5px;
            font-weight:700;
            color:#333;
          ">
            使用说明
          </div>

          <div style="margin-bottom:3px;">
            <strong style="color:#444;">配置：</strong>
            顶部设置备注、签单主体和共用文件；绿色表示已就绪。
          </div>

          <div style="margin-bottom:3px;">
            <strong style="color:#444;">流程：</strong>
            内勤复核及后续支持阶段可执行；合同阶段严格复核，其余阶段动态等待页面推进；已落单后自动复制落单数据。
          </div>

          <div style="margin-bottom:3px;">
            <strong style="color:#444;">日期：</strong>
            报价确认起检测体检时间，异常日期单独标红；“修改时间”仅改为今天至3年后，不自动保存。
          </div>


          <div>
            <strong style="color:#444;">窗口：</strong>
            拖动标题栏移动，右上角“×”关闭；提示最多5条可清空，文件权限失效时再重新授权。
          </div>
        </div>

        <div style="
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:6px;
          margin-bottom:6px;
        ">
          <button
            id="${UI.REMARK_BUTTON_ID}"
            type="button"
            aria-expanded="false"
            style="
              min-width:0;
              height:28px;
              padding:0 6px;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;
              border:1px solid #d9d9d9;
              border-radius:6px;
              background:#fff;
              color:#999;
              font-size:11px;
              font-weight:600;
              cursor:pointer;
            "
            title="修改审批备注"
          >
            修改备注
          </button>

          <button
            id="${UI.SIGNING_BUTTON_ID}"
            type="button"
            style="
              min-width:0;
              height:28px;
              padding:0 6px;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;
              border:1px solid #d9d9d9;
              border-radius:6px;
              background:#fff;
              color:#999;
              font-size:11px;
              font-weight:600;
              cursor:pointer;
            "
            title="配置己方签单主体"
          >
            签单主体
          </button>

          <button
            id="${UI.BIND_BUTTON_ID}"
            type="button"
            style="
              min-width:0;
              height:28px;
              padding:0 6px;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;
              border:1px solid #d9d9d9;
              border-radius:6px;
              background:#fff;
              color:#999;
              font-size:11px;
              font-weight:600;
              cursor:pointer;
            "
            title="文件绑定"
          >
            文件绑定
          </button>
        </div>

        <div
          id="${UI.REMARK_PANEL_ID}"
          style="
            display:none;
            margin-bottom:6px;
            padding:7px;
            border:1px solid #d9d9d9;
            border-radius:6px;
            background:#fafafa;
          "
        >
          <div style="
            display:flex;
            justify-content:flex-end;
            margin-bottom:6px;
          ">
            <button
              id="${UI.REMARK_DEFAULT_BUTTON_ID}"
              type="button"
              style="
                height:22px;
                padding:0 7px;
                border:1px solid #d9d9d9;
                border-radius:5px;
                background:#fff;
                color:#666;
                font-size:10px;
                cursor:pointer;
              "
            >
              恢复默认备注
            </button>
          </div>

          <div style="margin-bottom:8px;">
            <div style="
              margin-bottom:4px;
              font-weight:600;
              font-size:12px;
            ">
              内勤复核备注
            </div>
            <textarea
              id="${UI.REVIEW_REMARK_ID}"
              placeholder="请输入内勤复核审批备注"
              style="
                width:100%;
                height:48px;
                max-height:90px;
                box-sizing:border-box;
                padding:6px 8px;
                border:1px solid #d9d9d9;
                border-radius:5px;
                resize:vertical;
                overflow:auto;
                font-family:inherit;
                font-size:12px;
              "
            ></textarea>
          </div>

          <div>
            <div style="
              margin-bottom:4px;
              font-weight:600;
              font-size:12px;
            ">
              落单审核备注
            </div>
            <textarea
              id="${UI.ORDER_REMARK_ID}"
              placeholder="请输入落单审核审批备注"
              style="
                width:100%;
                height:48px;
                max-height:90px;
                box-sizing:border-box;
                padding:6px 8px;
                border:1px solid #d9d9d9;
                border-radius:5px;
                resize:vertical;
                overflow:auto;
                font-family:inherit;
                font-size:12px;
              "
            ></textarea>
          </div>
        </div>

        <div
          id="${UI.SIGNING_PANEL_ID}"
          style="
            display:none;
            margin-bottom:6px;
            padding:8px;
            border:1px solid #d9d9d9;
            border-radius:6px;
            background:#fafafa;
            font-size:11px;
          "
        >
          <div style="
            margin-bottom:7px;
            color:#555;
            font-weight:600;
          ">
            己方签单主体选择方式
          </div>

          <label style="
            display:flex;
            align-items:center;
            gap:5px;
            margin-bottom:6px;
            cursor:pointer;
          ">
            <input
              id="${UI.SIGNING_FIRST_ID}"
              type="radio"
              name="__soa_signing_mode_v118"
              value="first"
            >
            <span>第一个可用选项（当前默认）</span>
          </label>

          <label style="
            display:flex;
            align-items:center;
            gap:5px;
            margin-bottom:6px;
            cursor:pointer;
          ">
            <input
              id="${UI.SIGNING_TEXT_MODE_ID}"
              type="radio"
              name="__soa_signing_mode_v118"
              value="text"
            >
            <span>按名称精确匹配</span>
          </label>

          <input
            id="${UI.SIGNING_TEXT_ID}"
            type="text"
            placeholder="请输入下拉框中的完整主体名称"
            style="
              width:100%;
              height:30px;
              box-sizing:border-box;
              padding:0 8px;
              border:1px solid #d9d9d9;
              border-radius:5px;
              font-size:11px;
              outline:none;
            "
          >

          <div style="
            margin-top:6px;
            color:#999;
            font-size:10px;
            line-height:1.5;
          ">
            按名称模式采用精确匹配；找不到配置主体时会停止合同处理，不会改选第一项。
          </div>
        </div>

        <button
          id="${UI.FLOW_RUN_BUTTON_ID}"
          type="button"
          style="
            width:100%;
            height:38px;
            margin-bottom:8px;
            border:0;
            border-radius:6px;
            background:#1677ff;
            color:#fff;
            cursor:pointer;
            font-weight:600;
            font-size:14px;
          "
        >
          立即处理订单
        </button>

        <div style="
          padding-top:9px;
          border-top:1px solid #eee;
        ">
          <div style="
            display:flex;
            align-items:baseline;
            justify-content:flex-start;
            gap:4px;
            margin-bottom:3px;
            padding-left:1px;
            text-align:left;
          ">
            <span
              id="${UI.FLOW_STAGE_LABEL_ID}"
              style="
                flex:0 0 auto;
                color:#999;
                font-size:11px;
                font-weight:400;
              "
            >
              当前阶段：
            </span>

            <strong
              id="${UI.FLOW_STAGE_VALUE_ID}"
              style="
                flex:0 0 auto;
                min-width:0;
                color:#595959;
                font-size:14px;
                font-weight:600;
                white-space:nowrap;
              "
            >
              识别中
            </strong>

            <span
              id="${UI.EXAM_DATE_SUMMARY_ID}"
              style="
                display:none;
                margin-left:auto;
                padding-left:8px;
                align-items:center;
                gap:3px;
                color:#262626;
                font-size:10.5px;
                white-space:nowrap;
              "
              title="体检时间"
            >
              <span
                id="${UI.EXAM_BEGIN_DATE_ID}"
                style="
                  color:#262626;
                  font-size:11px;
                  font-weight:400;
                "
              ></span>
              <span style="
                color:#737373;
                font-weight:500;
              ">～</span>
              <span
                id="${UI.EXAM_END_DATE_ID}"
                style="
                  color:#262626;
                  font-size:11px;
                  font-weight:400;
                "
              ></span>

              <span
                id="${UI.EXAM_DURATION_ID}"
                style="
                  display:none;
                  margin-left:4px;
                  color:#595959;
                  font-size:11px;
                  font-weight:600;
                  white-space:nowrap;
                "
                title="剩余有效期"
              ></span>
            </span>
          </div>

          <div style="
            display:flex;
            align-items:center;
            gap:6px;
            margin-bottom:6px;
            padding-left:1px;
          ">
            <div
              id="${UI.FLOW_STAGE_HINT_ID}"
              style="
                flex:1 1 auto;
                min-width:0;
                color:#999;
                font-size:11px;
                line-height:1.5;
                text-align:left;
              "
            >
              正在读取页面流程状态...
            </div>

            <button
              id="${UI.EXAM_DATE_FIX_BUTTON_ID}"
              type="button"
              style="
                display:none;
                flex:0 0 auto;
                align-items:center;
                justify-content:center;
                height:24px;
                padding:0 8px;
                border:1px solid #cf1322;
                border-radius:5px;
                background:#fff;
                color:#cf1322;
                font-size:11px;
                font-weight:600;
                cursor:pointer;
                white-space:nowrap;
              "
            >
              修改时间
            </button>
          </div>

        </div>

        <div style="
          margin-top:8px;
          padding-top:1px;
          border-top:1px dashed #f0f0f0;
        ">
        <div
          id="${UI.STATUS_ID}"
          style="
            display:none;
            min-height:30px;
            margin-top:8px;
            padding:7px 9px;
            border:1px solid #eee;
            border-radius:6px;
            background:#fcfcfc;
            color:#555;
            line-height:1.45;
            font-size:12px;
            word-break:break-all;
          "
        ></div>

        <div
          id="${UI.WEB_NOTICE_ID}"
          style="
            display:none;
            margin-top:8px;
            padding:7px 9px;
            border:1px solid #bae7ff;
            border-radius:6px;
            background:#f0faff;
          "
        >
          <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:8px;
            margin-bottom:5px;
          ">
            <span style="
              color:#096dd9;
              font-size:12px;
              font-weight:600;
            ">
              网页提示
            </span>

            <div style="
              display:flex;
              align-items:center;
              gap:5px;
            ">
              <button
                id="${UI.WEB_NOTICE_COPY_ID}"
                type="button"
                style="
                  flex:0 0 auto;
                  height:21px;
                  padding:0 7px;
                  border:1px solid #91d5ff;
                  border-radius:4px;
                  background:#fff;
                  color:#096dd9;
                  font-size:10px;
                  line-height:19px;
                  cursor:pointer;
                "
                title="复制全部网页提示记录"
              >
                复制
              </button>

              <button
                id="${UI.WEB_NOTICE_CLEAR_ID}"
                type="button"
                style="
                  flex:0 0 auto;
                  height:21px;
                  padding:0 7px;
                  border:1px solid #ffccc7;
                  border-radius:4px;
                  background:#fff;
                  color:#cf1322;
                  font-size:10px;
                  line-height:19px;
                  cursor:pointer;
                "
                title="清空当前订单的网页提示记录"
              >
                清空
              </button>
            </div>
          </div>

          <textarea
            id="${UI.WEB_NOTICE_LIST_ID}"
            readonly
            spellcheck="false"
            style="
              display:block;
              width:100%;
              height:82px;
              min-height:58px;
              max-height:150px;
              box-sizing:border-box;
              margin:0;
              padding:4px 6px;
              border:1px solid #d6efff;
              border-radius:4px;
              outline:none;
              resize:vertical;
              overflow:auto;
              background:#fff;
              color:#444;
              font-family:Consolas, 'Microsoft YaHei', monospace;
              font-size:10.5px;
              line-height:1.5;
              white-space:pre;
              user-select:text;
              cursor:text;
            "
          ></textarea>
        </div>

        </div>
      </div>    `;

    document.body.appendChild(
      panel
    );

    applySavedPanelPosition(
      panel
    );

    enablePanelDragging(
      panel
    );

    const webNoticeList =
      document.getElementById(
        UI.WEB_NOTICE_LIST_ID
      );

    webNoticeList
      ?.addEventListener(
        "scroll",
        () => {
          const distanceToBottom =
            webNoticeList.scrollHeight -
            webNoticeList.scrollTop -
            webNoticeList.clientHeight;

          webNoticeAutoFollow =
            distanceToBottom <=
            8;
        },
        {
          passive:
            true
        }
      );

    document
      .getElementById(
        UI.WEB_NOTICE_COPY_ID
      )
      ?.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          copyWebNoticeHistory();
        }
      );

    document
      .getElementById(
        UI.WEB_NOTICE_CLEAR_ID
      )
      ?.addEventListener(
        "click",
        event => {
          event.stopPropagation();
          resetWebNoticeHistory();
        }
      );

    document
      .getElementById(
        UI.HELP_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        event => {
          event.stopPropagation();
          toggleHelpPanel();
        }
      );

    document
      .getElementById(
        UI.COLLAPSE_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        event => {
          event.stopPropagation();

          setPanelVisible(
            false
          );
        }
      );

    document
      .getElementById(
        UI.REMARK_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        () => {
          toggleRemarkPanel();
        }
      );

    document
      .getElementById(
        UI.SIGNING_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        () => {
          toggleSigningPanel();
        }
      );

    document
      .getElementById(
        UI.REMARK_DEFAULT_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        () => {
          restoreDefaultRemarks();
        }
      );

    document
      .getElementById(
        UI.SIGNING_FIRST_ID
      )
      ?.addEventListener(
        "change",
        event => {
          if (
            event.currentTarget
              ?.checked
          ) {
            saveSigningCompanyConfig(
              "first",
              document.getElementById(
                UI.SIGNING_TEXT_ID
              )?.value || ""
            );
          }
        }
      );

    document
      .getElementById(
        UI.SIGNING_TEXT_MODE_ID
      )
      ?.addEventListener(
        "change",
        event => {
          if (
            event.currentTarget
              ?.checked
          ) {
            saveSigningCompanyConfig(
              "text",
              document.getElementById(
                UI.SIGNING_TEXT_ID
              )?.value || ""
            );

            document.getElementById(
              UI.SIGNING_TEXT_ID
            )?.focus();
          }
        }
      );

    document
      .getElementById(
        UI.SIGNING_TEXT_ID
      )
      ?.addEventListener(
        "input",
        event => {
          const text =
            event.currentTarget
              ?.value || "";

          const textRadio =
            document.getElementById(
              UI.SIGNING_TEXT_MODE_ID
            );

          if (
            textRadio &&
            textRadio.checked
          ) {
            saveSigningCompanyConfig(
              "text",
              text
            );
          } else {
            saveStoredText(
              UI.SIGNING_TEXT_KEY,
              text
            );
          }
        }
      );

    /*
     * v2.4 取消折叠功能。
     * 清理旧版本可能遗留的折叠状态，面板打开时始终完整显示。
     */
    try {
      localStorage.removeItem(
        UI.PANEL_COLLAPSED_KEY
      );
    } catch (_) {}

    const panelBody =
      document.getElementById(
        UI.PANEL_BODY_ID
      );

    if (panelBody) {
      panelBody.style.display =
        "block";
    }

    const reviewRemarkInput =
      document.getElementById(
        UI.REVIEW_REMARK_ID
      );

    const orderRemarkInput =
      document.getElementById(
        UI.ORDER_REMARK_ID
      );

    if (reviewRemarkInput) {
      reviewRemarkInput.value =
        getStoredText(
          UI.REVIEW_REMARK_KEY,
          DEFAULTS.REVIEW_REMARK
        );

      reviewRemarkInput.addEventListener(
        "input",
        () => {
          saveStoredText(
            UI.REVIEW_REMARK_KEY,
            reviewRemarkInput.value
          );

          updateRemarkStatus();
        }
      );
    }

    if (orderRemarkInput) {
      orderRemarkInput.value =
        getStoredText(
          UI.ORDER_REMARK_KEY,
          DEFAULTS.ORDER_REMARK
        );

      orderRemarkInput.addEventListener(
        "input",
        () => {
          saveStoredText(
            UI.ORDER_REMARK_KEY,
            orderRemarkInput.value
          );

          updateRemarkStatus();
        }
      );
    }

    document
      .getElementById(
        UI.BIND_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        () => {
          bindSharedFile()
            .catch(error => {
              if (
                error?.name ===
                "AbortError"
              ) {
                updatePanelStatus(
                  "已取消文件选择。"
                );
                return;
              }

              warn(
                error?.message ||
                String(error)
              );
            });
        }
      );


    document
      .getElementById(
        UI.EXAM_DATE_FIX_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        () => {
          setRegisterExamDates()
            .catch(error => {
              warn(
                error?.message ||
                String(error)
              );

              console.error(
                "[SOA流程自动化] 修改体检时间失败：",
                error
              );
            });
        }
      );

    document
      .getElementById(
        UI.FLOW_RUN_BUTTON_ID
      )
      ?.addEventListener(
        "click",
        async () => {
          if (processRunning) {
            requestFlowStop();
            return;
          }

          const stage =
            getCurrentFlowStage();

          const stageIssue =
            getAutomationStageIssue(
              stage
            );

          if (stageIssue) {
            updatePanelStatus(
              stageIssue +
              "。请先在网页中将流程推进到内勤复核或后续支持阶段。",
              "error"
            );

            updateFlowRunButtonState(
              stage
            );

            return;
          }

          try {
            /*
             * 内勤复核继续执行后通常会进入合同补充；
             * 合同补充则会立即使用绑定文件。
             *
             * 在真实用户点击的当前瞬间先申请读取权限，
             * 避免稍后跑到合同阶段时 user activation 已失效，
             * 浏览器无法再弹出权限授权。
             */
            const shouldPrepareBoundFile =
              stage ===
                "内勤复核" ||
              (
                stage ===
                  "合同补充" &&
                (
                  !contractPageVisible() ||
                  contractNeedsBoundFile()
                )
              );

            if (shouldPrepareBoundFile) {
              await ensureBoundFilePermissionFromUserGesture();
            }

            const token =
              createFlowToken();

            runFullFlow({
              token
            }).catch(error => {
              warn(
                error?.message ||
                String(error)
              );

              console.error(
                "[SOA流程自动化]",
                error
              );
            });
          } catch (error) {
            warn(
              error?.message ||
              String(error)
            );

            console.error(
              "[SOA流程自动化] 启动前检查失败：",
              error
            );
          }
        }
      );

    updateBoundFileDisplay();
    updateRemarkStatus();
    updateSigningCompanyUi();
    renderWebNoticeHistory();

    updateFlowStageDisplay();

    updateFlowRunButtonState(
      getCurrentFlowStage()
    );

    refreshExamDateInfo(
      getCurrentFlowStage()
    );

    panel.style.display =
      panelVisible
        ? "block"
        : "none";

    return panel;
  }

  async function initBoundFile() {
    try {
      boundFileHandle =
        await loadBoundFileHandle();

      updateBoundFileDisplay();

      if (boundFileHandle) {
        console.log(
          `[SOA流程自动化] 已恢复绑定文件：${boundFileHandle.name}`
        );
      }
    } catch (error) {
      boundFileHandle = null;

      updateBoundFileDisplay();

      warn(
        `读取已绑定文件失败：${error?.message || error}`
      );
    }
  }

  function updateAutomationSwitch() {
    const button =
      document.getElementById(
        UI.AUTO_SWITCH_ID
      );

    if (!button) {
      return;
    }

    button.textContent =
      panelVisible
        ? "关闭智能审批"
        : "启动智能审批";

    button.title =
      panelVisible
        ? "关闭智能审批面板"
        : "启动智能审批面板";

    button.style.background =
      "#1677ff";

    button.style.opacity =
      panelVisible
        ? "1"
        : "0.9";
  }

  function setPanelVisible(
    visible
  ) {
    panelVisible =
      Boolean(visible);

    const panel =
      document.getElementById(
        UI.PANEL_ID
      ) ||
      createTestPanel();

    if (panel) {
      panel.style.display =
        panelVisible
          ? "block"
          : "none";
    }

    updateAutomationSwitch();

    /* 打开工具面板时刷新当前流程状态和日期。 */
    if (panelVisible) {
      updateFlowStageDisplay();
      refreshExamDateInfo(
        getCurrentFlowStage()
      );
    }
  }

  function togglePanelVisible() {
    setPanelVisible(
      !panelVisible
    );
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

  function ensureAutomationSwitch() {
    if (
      !isTargetRoute()
    ) {
      return null;
    }

    const orderDesc =
      document.querySelector(
        CONFIG.SWITCH_ORDER_DESC_SELECTOR
      );

    if (!orderDesc) {
      return null;
    }

    const tabs =
      orderDesc.parentElement;

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
        UI.AUTO_SWITCH_ID
      );

    if (!button) {
      button =
        document.createElement(
          "button"
        );

      button.id =
        UI.AUTO_SWITCH_ID;

      button.type =
        "button";

      button.dataset.soaToolOrder =
        "1";

      button.style.cssText = [
        "display:inline-flex",
        "flex:0 0 auto",
        "align-items:center",
        "justify-content:center",
        "height:32px",
        "padding:0 12px",
        "border:1px solid #1677ff",
        "border-radius:6px",
        "background:#1677ff",
        "color:#fff",
        "font-size:13px",
        "font-weight:600",
        "line-height:30px",
        "cursor:pointer",
        "white-space:nowrap",
        "vertical-align:middle",
        "box-sizing:border-box"
      ].join(";");

      button.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          togglePanelVisible();
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

    updateAutomationSwitch();

    return button;
  }

  function removeAutomationSwitch() {
    document
      .getElementById(
        UI.AUTO_SWITCH_ID
      )
      ?.remove();

    const group =
      document.getElementById(
        "__soa_tools_switch_group_v10"
      );

    if (
      group &&
      !group.children.length
    ) {
      group.remove();
    }
  }

  function scheduleEnsureRouteUi() {
    if (
      uiEnsureScheduled
    ) {
      return;
    }

    uiEnsureScheduled =
      true;

    requestAnimationFrame(
      () => {
        uiEnsureScheduled =
          false;

        if (
          !isTargetRoute()
        ) {
          return;
        }

        createTestPanel();
        ensureAutomationSwitch();

        if (
          !boundFileInitialized
        ) {
          boundFileInitialized =
            true;

          initBoundFile()
            .catch(error => {
              console.warn(
                "[SOA流程自动化] 初始化绑定文件失败：",
                error
              );
            });
        }
      }
    );
  }

  function connectRouteObserver() {
    connectWebNoticeObserver();

    if (
      routeObserver
    ) {
      return;
    }

    routeObserver =
      new MutationObserver(
        () => {
          if (
            !isTargetRoute()
          ) {
            return;
          }

          updateFlowStageDisplay();

          scheduleEnsureRouteUi();
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

  function disconnectRouteObserver() {
    if (
      routeObserver
    ) {
      routeObserver.disconnect();
      routeObserver =
        null;
    }

    disconnectWebNoticeObserver();
  }

  function teardownRouteUi() {
    panelVisible =
      false;

    lastDisplayedFlowStage =
      "";

    lastWebNoticeOrderCode =
      "";


    resetWebNoticeHistory();

    removeAutomationSwitch();

    document
      .getElementById(
        UI.PANEL_ID
      )
      ?.remove();

    disconnectRouteObserver();

    boundFileInitialized =
      false;
  }

  function routeCheck() {
    if (
      isTargetRoute()
    ) {
      /*
       * 首次进入订单详情工作区时，工具 UI 默认保持关闭；同一订单各业务页签之间切换不会关闭工具。
       * 只有用户点击页面蓝色按钮后才显示。
       */
      if (
        !document.getElementById(
          UI.PANEL_ID
        )
      ) {
        panelVisible =
          false;
      }

      connectRouteObserver();
      scheduleEnsureRouteUi();
      return;
    }

    teardownRouteUi();
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

  window.addEventListener(
    "tm-soa-order-flow-history-change",
    routeCheck,
    true
  );

  /*
   * 与同站点现有 SOA 脚本一致：
   * pushState/replaceState 不一定触发 hashchange，
   * 因此补一个脚本内部事件。
   */
  (function patchHistoryOnce() {
    const patchKey =
      "__tmSoaOrderFlowHistoryPatched__";

    if (
      history[patchKey]
    ) {
      return;
    }

    const wrap =
      original =>
        function () {
          const result =
            original.apply(
              this,
              arguments
            );

          queueMicrotask(
            () =>
              window.dispatchEvent(
                new Event(
                  "tm-soa-order-flow-history-change"
                )
              )
          );

          return result;
        };

    history.pushState =
      wrap(
        history.pushState
      );

    history.replaceState =
      wrap(
        history.replaceState
      );

    try {
      Object.defineProperty(
        history,
        patchKey,
        {
          value: true,
          configurable: false,
          enumerable: false
        }
      );
    } catch (_) {
      history[patchKey] =
        true;
    }
  })();

  routeCheck();

  console.log(
    "[SOA智能审批] v2.5 已加载"
  );
})();
