// ==UserScript==
// @name         前台-1.1批量预约工具
// @namespace    https://tampermonkey.net/
// @version      1.16
// @description  前台批量预约工具：在前台批量登记页面增加工具窗口，自动识别粘贴的14位预约单号并自动进行登记填写。同时在“已到检”页签中自动勾选“仅当日”，并在请求层强制将首次列表查询改为仅当日。

// @match        *://checkup-register.health-100.cn/*
// @grant        none
// @run-at       document-start

// @author       WanXin
// @publishGroup qiantai
// @publishID    qiantai-piliangyuyue
// @updateURL    https://scripts.wanxinxin.dpdns.org/qiantai/qiantai-piliangyuyue.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/qiantai/qiantai-piliangyuyue.user.js
// ==/UserScript==

/*
 * 更新记录
 *
 * v1.16  -  2026-9-9
 * - 修复：页面存在两个同名 #search_form_onlyToday 时，避免误操作“预约时间”下的仅当日。
 * - 优化：改为根据字段标题“登记时间”定位对应复选框，仅控制登记时间区域的仅当日。
 * - 保持原有“已到检”首次查询保护、请求层改写、批量预约等逻辑不变。
 *
 * v1.15  -  2026-8-29
 * - 修复：进入“已到检”后手动取消“仅当日”再点击查询时，不再被脚本重新强制勾选。
 * - 优化：“仅当日”改为一次性保护；仅在从其他页签切换进入“已到检”时启用，并只改写进入页面后自动发出的第一条 CHECKED 列表查询。
 * - 优化：首次 CHECKED 查询处理完成后立即解除强制状态；后续手动查询完全尊重页面当前“仅当日”选择。
 *
 * v1.14  -  2026-8-29
 * - 新增：进入“已到检”时从请求层将首次列表查询改为仅当日，并同步页面复选框状态。
 *
 * v1.13  -  2026-8-29
 * - 新增：点击“已到检”页签时自动尝试勾选“仅当日”。
 */

(function () {
  "use strict";

  const INSTANCE_KEY =
    "__SOA_BATCH_BOOKING_V116__";

  if (window[INSTANCE_KEY]) {
    return;
  }

  window[INSTANCE_KEY] = true;

  /* =========================================================
   * 1. 配置
   * ========================================================= */

  const CONFIG = {
    INPUT_SELECTOR: "#vid",
    LIST_SELECTOR: ".appointment-card .ant-table-tbody",

    // 点击“已到检”前先确保“仅当日”已勾选
    CHECKED_TAB_SELECTOR:
      '[role="tab"][id$="-tab-CHECKED"]',
    // 页面存在两个同名 #search_form_onlyToday。
    // 不再直接依赖 id，而通过“登记时间”字段区域定位。
    ONLY_TODAY_SELECTOR:
      null,
    ONLY_TODAY_WAIT_TIMEOUT: 1200,
    ONLY_TODAY_POLL_INTERVAL: 30,

    // “已到检”列表查询接口：请求层统一强制为仅当日
    CHECKIN_QUERY_PATH:
      "/checkup-hc/api/checkin/query/list",

    // 工具按钮定位：从 #vid 右侧开始自动向右寻找不遮挡页面元素的位置
    BUTTON_START_GAP: 12,
    BUTTON_SEARCH_STEP: 36,
    BUTTON_MAX_SHIFT: 900,
    BUTTON_SAFE_GAP: 8,

    BUTTON_POS_KEY: "__soa_batch_booking_button_pos_v11",

    // 批量窗口宽度与记忆
    PANEL_WIDTH_KEY: "__soa_batch_booking_panel_width_v19",
    PANEL_DEFAULT_WIDTH: 640,
    PANEL_MIN_WIDTH: 480,
    PANEL_MAX_WIDTH: 920,

    // 工具是否显示只判断预约单号输入框 #vid。
    // SPA 页面切换后无需依赖 URL，也无需刷新页面。
    // 输入框出现且可见 -> 显示；输入框不存在 -> 隐藏。
    BUTTON_GAP: 10,

    // 单次提交后等待预约号出现在“预约列表”的最长时间
    RESULT_TIMEOUT: 4000,

    // 轮询列表间隔
    POLL_INTERVAL: 150,

    // 第一次未确认成功时，自动再尝试 1 次
    MAX_ATTEMPTS: 2,

    // 一条确认成功后，处理下一条前的短暂间隔
    BETWEEN_ITEMS: 300,

    // 重试前等待
    RETRY_DELAY: 300
  };

  const IDS = {
    button: "__soa_batch_fill_btn",
    mask: "__soa_batch_fill_mask",
    panel: "__soa_batch_fill_panel",
    textarea: "__soa_batch_fill_textarea",
    count: "__soa_batch_fill_count",
    parseDetail: "__soa_batch_fill_parse_detail",
    progress: "__soa_batch_fill_progress",
    status: "__soa_batch_fill_status",
    log: "__soa_batch_fill_log",
    summaryWrap: "__soa_batch_fill_summary_wrap",
    summary: "__soa_batch_fill_summary",
    start: "__soa_batch_fill_start",
    pause: "__soa_batch_fill_pause",
    stop: "__soa_batch_fill_stop",
    skip: "__soa_batch_fill_skip",
    close: "__soa_batch_fill_close",
    resizeHandle: "__soa_batch_fill_resize_handle",
    style: "__soa_batch_fill_style"
  };

  /* =========================================================
   * 2. 运行状态
   * ========================================================= */

  const state = {
    running: false,
    paused: false,

    token: 0,

    codes: [],
    index: 0,

    success: 0,
    skipped: 0,
    errors: 0,

    currentCode: "",
    lastError: "",

    // 异常汇总：[{ code, message }]
    anomalies: [],

    // Ant Design 顶部消息实时缓存
    messageSeq: 0,
    messageHistory: []
  };

  /* =========================================================
   * 3. 基础工具
   * ========================================================= */

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, "")
      .trim()
      .toUpperCase();
  }

  function isVisible(el) {
    if (!el) return false;

    const style = getComputedStyle(el);

    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = el.getBoundingClientRect();

    return rect.width > 0 && rect.height > 0;
  }

  function getInput() {
    return document.querySelector(CONFIG.INPUT_SELECTOR);
  }

  function inputUsable() {
    const input = getInput();

    return Boolean(
      input &&
      !input.disabled &&
      !input.readOnly &&
      isVisible(input)
    );
  }

  function rectsOverlap(a, b, gap = 0) {
    return !(
      a.right + gap <= b.left ||
      a.left >= b.right + gap ||
      a.bottom + gap <= b.top ||
      a.top >= b.bottom + gap
    );
  }

  function getBlockingElements(button) {
    const selectors = [
      "button",
      "input",
      "select",
      "textarea",
      ".ant-btn",
      ".ant-select",
      ".ant-dropdown",
      ".ant-dropdown-menu",
      ".ant-popover",
      ".ant-tooltip",
      ".ant-modal",
      ".ant-picker",
      ".ant-cascader-picker"
    ];

    return Array.from(
      document.querySelectorAll(
        selectors.join(",")
      )
    ).filter(el => {
      if (
        !el ||
        el === button ||
        el.closest?.(`#${IDS.panel}`) ||
        el.id === IDS.button ||
        !isVisible(el)
      ) {
        return false;
      }

      const rect =
        el.getBoundingClientRect();

      return (
        rect.width > 0 &&
        rect.height > 0
      );
    });
  }

  function positionIsSafe(
    left,
    top,
    width,
    height,
    blockers
  ) {
    const candidate = {
      left,
      top,
      right: left + width,
      bottom: top + height
    };

    return !blockers.some(el =>
      rectsOverlap(
        candidate,
        el.getBoundingClientRect(),
        CONFIG.BUTTON_SAFE_GAP
      )
    );
  }

  function setNativeInputValue(input, value) {
    if (!input) return;

    const setter =
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(
      new Event("input", {
        bubbles: true
      })
    );

    input.dispatchEvent(
      new Event("change", {
        bubbles: true
      })
    );
  }

  function dispatchEnter(input) {
    if (!input) return;

    const options = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true
    };

    input.dispatchEvent(
      new KeyboardEvent("keydown", options)
    );

    input.dispatchEvent(
      new KeyboardEvent("keypress", options)
    );

    input.dispatchEvent(
      new KeyboardEvent("keyup", options)
    );
  }

  /* =========================================================
   * 3.1 “已到检”列表请求强制仅当日
   * ========================================================= */

  let onlyTodayGuardArmed = false;
  let onlyTodayGuardExpiresAt = 0;

  function armOnlyTodayGuard() {
    onlyTodayGuardArmed = true;

    // 防止页面没有发出自动查询时，标记残留到之后的手动查询。
    onlyTodayGuardExpiresAt =
      Date.now() + 5000;

    console.log(
      "[SOA批量预约] 已进入“已到检”，仅对接下来的首次 CHECKED 查询启用仅当日保护"
    );
  }

  function consumeOnlyTodayGuard() {
    const active =
      onlyTodayGuardArmed &&
      Date.now() <=
        onlyTodayGuardExpiresAt;

    onlyTodayGuardArmed = false;
    onlyTodayGuardExpiresAt = 0;

    return active;
  }

  function isOnlyTodayGuardActive() {
    if (
      !onlyTodayGuardArmed
    ) {
      return false;
    }

    if (
      Date.now() >
      onlyTodayGuardExpiresAt
    ) {
      onlyTodayGuardArmed = false;
      onlyTodayGuardExpiresAt = 0;
      return false;
    }

    return true;
  }

  function padDatePart(value) {
    return String(value).padStart(2, "0");
  }

  function getTodayCheckinRange() {
    const now = new Date();

    const date =
      [
        now.getFullYear(),
        padDatePart(
          now.getMonth() + 1
        ),
        padDatePart(
          now.getDate()
        )
      ].join("-");

    return {
      start:
        `${date} 00:00:00`,
      end:
        `${date} 23:59:59`
    };
  }

  function isCheckinQueryUrl(url) {
    try {
      const absolute =
        new URL(
          String(url || ""),
          location.href
        );

      return (
        absolute.origin ===
          location.origin &&
        absolute.pathname ===
          CONFIG.CHECKIN_QUERY_PATH
      );
    } catch {
      return false;
    }
  }

  function rewriteCheckedQueryBody(body) {
    if (
      typeof body !== "string" ||
      !body.trim()
    ) {
      return {
        changed: false,
        body
      };
    }

    let parsed;

    try {
      parsed =
        JSON.parse(body);
    } catch {
      return {
        changed: false,
        body
      };
    }

    const req =
      parsed?.pageRequest?.req;

    if (
      !req ||
      req.appointmentStatus !==
        "CHECKED"
    ) {
      return {
        changed: false,
        body
      };
    }

    /*
     * 只处理“刚切换进入已到检”后的首次自动查询。
     * 已经进入页面后的手动查询，不再强制修改。
     */
    if (
      !isOnlyTodayGuardActive()
    ) {
      return {
        changed: false,
        body
      };
    }

    // 无论这条首次请求本来是否已经是仅当日，都消费掉本次一次性保护。
    consumeOnlyTodayGuard();

    const range =
      getTodayCheckinRange();

    const alreadyCorrect =
      req.onlyToday === true &&
      req.checkinStartDate ===
        range.start &&
      req.checkinEndDate ===
        range.end;

    if (alreadyCorrect) {
      return {
        changed: false,
        body
      };
    }

    req.onlyToday = true;
    req.checkinStartDate =
      range.start;
    req.checkinEndDate =
      range.end;

    console.log(
      "[SOA批量预约] 已将“已到检”查询强制改为仅当日：",
      {
        onlyToday:
          req.onlyToday,
        checkinStartDate:
          req.checkinStartDate,
        checkinEndDate:
          req.checkinEndDate
      }
    );

    queueMicrotask(
      syncOnlyTodayCheckboxUI
    );

    return {
      changed: true,
      body: JSON.stringify(parsed)
    };
  }

  function installFetchOnlyTodayInterceptor() {
    const originalFetch =
      window.fetch;

    if (
      typeof originalFetch !==
        "function" ||
      originalFetch
        .__soaOnlyTodayPatched
    ) {
      return;
    }

    const wrappedFetch =
      async function (
        input,
        init
      ) {
        const url =
          input instanceof Request
            ? input.url
            : input;

        if (
          !isCheckinQueryUrl(url)
        ) {
          return originalFetch.apply(
            this,
            arguments
          );
        }

        /*
         * 常见调用形式：
         * fetch(url, { body: "..." })
         */
        if (
          init &&
          typeof init.body ===
            "string"
        ) {
          const rewritten =
            rewriteCheckedQueryBody(
              init.body
            );

          if (rewritten.changed) {
            init = {
              ...init,
              body: rewritten.body
            };
          }

          return originalFetch.call(
            this,
            input,
            init
          );
        }

        /*
         * 兼容 fetch(new Request(...))。
         * 这里只在 POST 且 body 可读取时重建 Request。
         */
        if (
          input instanceof Request &&
          input.method.toUpperCase() ===
            "POST"
        ) {
          try {
            const originalBody =
              await input
                .clone()
                .text();

            const rewritten =
              rewriteCheckedQueryBody(
                originalBody
              );

            if (rewritten.changed) {
              const nextRequest =
                new Request(
                  input,
                  {
                    body:
                      rewritten.body
                  }
                );

              return originalFetch.call(
                this,
                nextRequest,
                init
              );
            }
          } catch (error) {
            console.warn(
              "[SOA批量预约] fetch 请求体读取失败，保持原请求：",
              error
            );
          }
        }

        return originalFetch.apply(
          this,
          arguments
        );
      };

    wrappedFetch
      .__soaOnlyTodayPatched =
      true;

    window.fetch =
      wrappedFetch;
  }

  function installXhrOnlyTodayInterceptor() {
    const proto =
      XMLHttpRequest.prototype;

    if (
      proto.send
        .__soaOnlyTodayPatched
    ) {
      return;
    }

    const originalOpen =
      proto.open;

    const originalSend =
      proto.send;

    proto.open =
      function (
        method,
        url,
        ...rest
      ) {
        this
          .__soaRequestMethod =
          String(
            method || ""
          ).toUpperCase();

        this
          .__soaRequestUrl =
          String(url || "");

        return originalOpen.call(
          this,
          method,
          url,
          ...rest
        );
      };

    const wrappedSend =
      function (body) {
        let nextBody =
          body;

        if (
          this.__soaRequestMethod ===
            "POST" &&
          isCheckinQueryUrl(
            this.__soaRequestUrl
          )
        ) {
          const rewritten =
            rewriteCheckedQueryBody(
              body
            );

          if (rewritten.changed) {
            nextBody =
              rewritten.body;
          }
        }

        return originalSend.call(
          this,
          nextBody
        );
      };

    wrappedSend
      .__soaOnlyTodayPatched =
      true;

    proto.send =
      wrappedSend;
  }

  function syncOnlyTodayCheckboxUI() {
    const checkbox =
      getOnlyTodayCheckbox();

    if (
      !checkbox ||
      checkbox.checked
    ) {
      return;
    }

    try {
      checkbox.click();
    } catch (_) {
      // UI 同步失败不影响请求层强制仅当日。
    }
  }

  function installOnlyTodayNetworkGuard() {
    installFetchOnlyTodayInterceptor();
    installXhrOnlyTodayInterceptor();

    console.log(
      "[SOA批量预约] 已启用“已到检”请求层仅当日保护"
    );
  }

  /* =========================================================
   * 3.2 “已到检”自动勾选“仅当日”
   * ========================================================= */

  let checkedTabReplayRunning = false;

  function getOnlyTodayCheckbox() {
    /*
     * 页面存在两个同名 #search_form_onlyToday：
     * 1. 登记时间 -> 需要控制
     * 2. 预约时间 -> 不允许控制
     *
     * 因此不能使用 document.querySelector(id)，
     * 改为根据 Ant Design 表单项标题定位。
     */
    const items =
      Array.from(
        document.querySelectorAll(
          ".ant-form-item"
        )
      );

    for (const item of items) {
      const title =
        item.querySelector(
          ".ant-form-item-label label"
        )?.getAttribute("title");

      if (title !== "登记时间") {
        continue;
      }

      const checkbox =
        item.querySelector(
          'input[type="checkbox"]'
        );

      if (checkbox) {
        return checkbox;
      }
    }

    return null;
  }

  function isOnlyTodayChecked() {
    const checkbox =
      getOnlyTodayCheckbox();

    if (!checkbox) {
      return false;
    }

    if (checkbox.checked) {
      return true;
    }

    const label =
      checkbox.closest(
        ".ant-checkbox-wrapper"
      );

    return Boolean(
      label?.classList.contains(
        "ant-checkbox-wrapper-checked"
      )
    );
  }

  function waitForOnlyTodayChecked() {
    return new Promise(resolve => {
      const startedAt =
        Date.now();

      const timer =
        window.setInterval(
          () => {
            if (isOnlyTodayChecked()) {
              clearInterval(timer);
              resolve(true);
              return;
            }

            if (
              Date.now() - startedAt >=
              CONFIG.ONLY_TODAY_WAIT_TIMEOUT
            ) {
              clearInterval(timer);
              resolve(false);
            }
          },
          CONFIG.ONLY_TODAY_POLL_INTERVAL
        );
    });
  }

  function clickOnlyTodayCheckbox() {
    const checkbox =
      getOnlyTodayCheckbox();

    if (!checkbox) {
      return false;
    }

    if (isOnlyTodayChecked()) {
      return true;
    }

    /*
     * 让 Ant Design / React 自己处理状态，
     * 不直接写 checkbox.checked。
     */
    checkbox.click();

    return true;
  }

  function findCheckedTabFromEventTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    let tab =
      target.closest(
        CONFIG.CHECKED_TAB_SELECTOR
      );

    if (!tab) {
      const tabWrap =
        target.closest(
          ".ant-tabs-tab"
        );

      tab =
        tabWrap?.querySelector(
          CONFIG.CHECKED_TAB_SELECTOR
        ) || null;
    }

    if (!tab) {
      return null;
    }

    const text =
      String(
        tab.textContent || ""
      )
        .replace(/\s+/g, "")
        .trim();

    return text === "已到检"
      ? tab
      : null;
  }

  async function replayCheckedTabClick(tab) {
    try {
      const checkboxFound =
        clickOnlyTodayCheckbox();

      if (!checkboxFound) {
        console.warn(
          "[SOA批量预约] 未找到“仅当日”复选框，直接继续进入“已到检”"
        );

        checkedTabReplayRunning =
          true;

        tab.click();
        return;
      }

      const checked =
        await waitForOnlyTodayChecked();

      if (checked) {
        console.log(
          "[SOA批量预约] 已自动勾选“仅当日”，继续进入“已到检”"
        );
      } else {
        console.warn(
          "[SOA批量预约] 等待“仅当日”勾选确认超时，继续进入“已到检”"
        );
      }

      checkedTabReplayRunning =
        true;

      tab.click();
    } finally {
      queueMicrotask(() => {
        checkedTabReplayRunning =
          false;
      });
    }
  }

  function initCheckedTabOnlyTodayGuard() {
    document.addEventListener(
      "click",
      event => {
        const tab =
          findCheckedTabFromEventTarget(
            event.target
          );

        if (!tab) {
          return;
        }

        // 脚本自动重放的第二次点击直接放行。
        if (checkedTabReplayRunning) {
          return;
        }

        /*
         * 只有从其他页签切换进入“已到检”时，
         * 才启用一次性的请求层保护。
         * 当前页签已经是“已到检”时不重新武装，
         * 避免影响用户后续手动查询。
         */
        const alreadySelected =
          tab.getAttribute(
            "aria-selected"
          ) === "true" ||
          tab.closest(
            ".ant-tabs-tab"
          )?.classList.contains(
            "ant-tabs-tab-active"
          );

        if (!alreadySelected) {
          armOnlyTodayGuard();
        }

        // 已经是“仅当日”则原样放行。
        if (isOnlyTodayChecked()) {
          return;
        }

        /*
         * 捕获阶段先阻止“已到检”自己的查询逻辑，
         * 等“仅当日”真正勾选后再自动点击一次。
         */
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        replayCheckedTabClick(tab);
      },
      true
    );
  }

  /* =========================================================
   * 4. 预约列表检查
   * ========================================================= */

  function getAppointmentRows() {
    const body =
      document.querySelector(
        CONFIG.LIST_SELECTOR
      );

    if (!body) return [];

    return Array.from(
      body.querySelectorAll("tr")
    ).filter(row => {
      if (
        row.classList.contains(
          "ant-table-measure-row"
        )
      ) {
        return false;
      }

      if (
        row.classList.contains(
          "ant-table-placeholder"
        )
      ) {
        return false;
      }

      return row.querySelectorAll("td").length > 0;
    });
  }

  function getAppointmentRowCount() {
    return getAppointmentRows().length;
  }

  function codeExistsInList(code) {
    const target = normalizeText(code);

    if (!target) return false;

    const rows = getAppointmentRows();

    return rows.some(row => {
      const cells =
        Array.from(
          row.querySelectorAll("td")
        );

      // 优先逐单元格精确匹配
      const exactMatch =
        cells.some(cell =>
          normalizeText(
            cell.textContent
          ) === target
        );

      if (exactMatch) {
        return true;
      }

      // 兼容表格内部存在额外标签或空格
      const rowText =
        normalizeText(
          row.textContent
        );

      return rowText.includes(target);
    });
  }

  /* =========================================================
   * 5. 页面错误 / 网络状态检查
   * ========================================================= */

  function cleanMessageText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSuccessMessage(text) {
    return /成功|已加入|添加完成|操作完成|处理完成/i.test(
      cleanMessageText(text)
    );
  }

  function recordAntMessage(text) {
    const clean =
      cleanMessageText(text);

    if (!clean) return;

    // 同一条提示被 MutationObserver 多次触发时去重
    const last =
      state.messageHistory[
        state.messageHistory.length - 1
      ];

    if (
      last &&
      last.text === clean &&
      Date.now() - last.time < 1200
    ) {
      return;
    }

    state.messageSeq++;

    state.messageHistory.push({
      seq: state.messageSeq,
      text: clean,
      time: Date.now()
    });

    // 避免长期使用后无限增长
    if (
      state.messageHistory.length > 200
    ) {
      state.messageHistory.splice(
        0,
        state.messageHistory.length - 200
      );
    }

    console.log(
      "[SOA批量预约] 捕获页面提示：",
      clean
    );
  }

  function scanAntMessageContainer() {
    const root =
      document.querySelector(
        ".ant-message"
      );

    if (!root) return;

    const selectors = [
      ".ant-message-notice-content",
      ".ant-message-custom-content",
      ".ant-message-notice"
    ];

    const nodes =
      root.querySelectorAll(
        selectors.join(",")
      );

    nodes.forEach(node => {
      const text =
        cleanMessageText(
          node.textContent
        );

      if (text) {
        recordAntMessage(text);
      }
    });

    // 兼容某些版本只在 .ant-message > div 内直接写文本
    if (!nodes.length) {
      Array.from(root.children).forEach(child => {
        const text =
          cleanMessageText(
            child.textContent
          );

        if (text) {
          recordAntMessage(text);
        }
      });
    }
  }

  function initAntMessageObserver() {
    // 页面消息容器有时在脚本加载后才生成，所以直接观察 body
    const observer =
      new MutationObserver(mutations => {
        let related = false;

        for (const mutation of mutations) {
          const target =
            mutation.target;

          if (
            target instanceof Element &&
            (
              target.matches?.(".ant-message") ||
              target.closest?.(".ant-message")
            )
          ) {
            related = true;
            break;
          }

          for (
            const node of mutation.addedNodes
          ) {
            if (
              node instanceof Element &&
              (
                node.matches?.(".ant-message") ||
                node.closest?.(".ant-message") ||
                node.querySelector?.(".ant-message")
              )
            ) {
              related = true;
              break;
            }
          }

          if (related) break;
        }

        if (related) {
          scanAntMessageContainer();
        }
      });

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );

    // 如果当前已经存在提示，也先扫一次
    scanAntMessageContainer();
  }

  function getMessageSeq() {
    return state.messageSeq;
  }

  function getNewAntMessageSince(seq) {
    const items =
      state.messageHistory.filter(
        item => item.seq > seq
      );

    if (!items.length) {
      return "";
    }

    // 成功提示不作为异常。
    // 其余新出现的页面提示都优先返回，
    // 不再依赖固定“错误关键词”，避免漏掉业务提示。
    for (const item of items) {
      if (!isSuccessMessage(item.text)) {
        return item.text;
      }
    }

    return "";
  }

  function networkLooksOffline() {
    return navigator.onLine === false;
  }

  /* =========================================================
   * 6. 提交后的结果等待
   * ========================================================= */

  async function waitForResult(
    code,
    baselineSeq,
    token
  ) {
    const start = Date.now();

    while (
      Date.now() - start <
      CONFIG.RESULT_TIMEOUT
    ) {
      if (
        token !== state.token ||
        !state.running
      ) {
        return {
          type: "aborted"
        };
      }

      if (codeExistsInList(code)) {
        return {
          type: "success"
        };
      }

      const antMessage =
        getNewAntMessageSince(
          baselineSeq
        );

      if (antMessage) {
        // 页面已经明确给出业务提示时，
        // 直接记录该提示，不再傻等完整超时时间。
        return {
          type: "page_error",
          message: antMessage
        };
      }

      if (networkLooksOffline()) {
        return {
          type: "network_error",
          message: "浏览器当前处于离线状态"
        };
      }

      // 页面结构突然变化，例如跳转、刷新失败
      if (!document.querySelector(CONFIG.INPUT_SELECTOR)) {
        return {
          type: "page_error",
          message: "预约单号输入框已不存在，页面状态可能发生变化"
        };
      }

      await sleep(
        CONFIG.POLL_INTERVAL
      );
    }

    // 最后再确认一次
    if (codeExistsInList(code)) {
      return {
        type: "success"
      };
    }

    return {
      type: "timeout",
      message:
        `等待 ${CONFIG.RESULT_TIMEOUT / 1000} 秒后，` +
        "仍未在预约列表中确认到该号码"
    };
  }

  /* =========================================================
   * 7. 单号码提交
   * ========================================================= */

  async function submitOneCode(
    code,
    token
  ) {
    // 已经存在时不再重复发送
    if (codeExistsInList(code)) {
      return {
        type: "existing"
      };
    }

    for (
      let attempt = 1;
      attempt <= CONFIG.MAX_ATTEMPTS;
      attempt++
    ) {
      if (
        token !== state.token ||
        !state.running
      ) {
        return {
          type: "aborted"
        };
      }

      if (networkLooksOffline()) {
        return {
          type: "network_error",
          message: "浏览器当前处于离线状态"
        };
      }

      const input = getInput();

      if (!inputUsable()) {
        return {
          type: "page_error",
          message:
            "未找到可用的预约单号输入框 #vid"
        };
      }

      // 重试前再次确认，防止第一次其实已经成功，只是列表刷新稍慢
      if (codeExistsInList(code)) {
        return {
          type: "success"
        };
      }

      const baselineSeq =
        getMessageSeq();

      setNativeInputValue(
        input,
        ""
      );

      await sleep(60);

      setNativeInputValue(
        input,
        code
      );

      input.focus();

      await sleep(80);

      appendLog(
        "info",
        `${code}：发送回车` +
        (
          attempt > 1
            ? `（第 ${attempt} 次尝试）`
            : ""
        )
      );

      dispatchEnter(input);

      const result =
        await waitForResult(
          code,
          baselineSeq,
          token
        );

      if (
        result.type === "success"
      ) {
        return result;
      }

      if (
        result.type === "aborted"
      ) {
        return result;
      }

      // 页面明确报错时不立即重复轰炸。
      // 交给主循环暂停，让用户决定重试或跳过。
      if (
        result.type === "page_error" &&
        result.message
      ) {
        return result;
      }

      if (
        attempt <
        CONFIG.MAX_ATTEMPTS
      ) {
        appendLog(
          "warn",
          `${code}：本次未确认成功，${CONFIG.RETRY_DELAY / 1000} 秒后自动重试`
        );

        await sleep(
          CONFIG.RETRY_DELAY
        );
      } else {
        return result;
      }
    }

    return {
      type: "timeout",
      message: "未能确认操作结果"
    };
  }

  /* =========================================================
   * 8. 批量运行主循环
   * ========================================================= */

  async function waitWhilePaused(
    token
  ) {
    while (
      state.running &&
      state.paused &&
      token === state.token
    ) {
      await sleep(120);
    }
  }

  async function runBatch() {
    const token = ++state.token;

    updateUI();

    appendLog(
      "info",
      `开始处理，共 ${state.codes.length} 个预约单号`
    );

    while (
      state.running &&
      state.index < state.codes.length &&
      token === state.token
    ) {
      await waitWhilePaused(token);

      if (
        !state.running ||
        token !== state.token
      ) {
        break;
      }

      const code =
        state.codes[state.index];

      state.currentCode = code;
      state.lastError = "";
      state.awaitingDecision = false;
      state.skipRequested = false;

      updateUI();

      if (codeExistsInList(code)) {
        state.skipped++;

        appendLog(
          "skip",
          `${code}：预约列表中已存在，自动跳过`
        );

        state.index++;
        updateUI();

        await sleep(
          CONFIG.BETWEEN_ITEMS
        );

        continue;
      }

      const result =
        await submitOneCode(
          code,
          token
        );

      if (
        result.type === "aborted"
      ) {
        break;
      }

      if (
        result.type === "success"
      ) {
        state.success++;

        appendLog(
          "success",
          `${code}：已确认加入预约列表`
        );

        state.index++;
        state.currentCode = "";

        updateUI();

        await sleep(
          CONFIG.BETWEEN_ITEMS
        );

        continue;
      }

      if (
        result.type === "existing"
      ) {
        state.skipped++;

        appendLog(
          "skip",
          `${code}：预约列表中已存在，自动跳过`
        );

        state.index++;
        state.currentCode = "";

        updateUI();

        continue;
      }

      /* ---------- 异常：记录并继续下一条 ---------- */

      state.errors++;

      state.lastError =
        String(
          result.message ||
          "未能确认操作是否生效"
        ).trim();

      state.anomalies.push({
        code,
        message: state.lastError
      });

      appendLog(
        "error",
        `${code}：${state.lastError}。已记录异常并继续下一条`
      );

      state.index++;
      state.currentCode = "";

      updateUI();

      await sleep(
        CONFIG.BETWEEN_ITEMS
      );

      continue;
    }

    if (
      token !== state.token
    ) {
      return;
    }

    if (
      state.index >=
      state.codes.length
    ) {
      state.running = false;
      state.paused = false;
      state.currentCode = "";
      state.awaitingDecision = false;

      appendLog(
        "success",
        `全部处理完成：成功 ${state.success}，跳过 ${state.skipped}，异常 ${state.errors}`
      );

      renderAnomalySummary();

      setStatus(
        state.errors
          ? `完成，存在 ${state.errors} 条异常`
          : "完成",
        state.errors
          ? "warn"
          : "success"
      );
    } else if (!state.running) {
      setStatus(
        "已停止",
        "warn"
      );
    }

    updateUI();
  }

  /* =========================================================
   * 9. 输入解析
   * ========================================================= */

  function extractBookingCode(line) {
    const text =
      String(line || "");

    /*
     * 提取“独立的连续14位数字”：
     * - 前后可以是文字、空格、标点或其他非数字字符；
     * - 如果14位数字前后紧邻数字，则说明它属于更长数字串，不提取。
     *
     * 不使用 lookbehind，兼容性更稳。
     */
    const match =
      text.match(
        /(?:^|\D)(\d{14})(?!\d)/
      );

    return match
      ? match[1]
      : "";
  }

  function analyzeCodes(text) {
    const lines =
      String(text || "")
        .split(/\r?\n/);

    const seen = new Set();

    const valid = [];
    const unrecognized = [];
    const duplicated = [];
    const cleaned = [];

    lines.forEach(
      (rawLine, index) => {
        const line =
          String(rawLine || "")
            .trim();

        // 空行忽略，不计入未识别。
        if (!line) {
          return;
        }

        const code =
          extractBookingCode(line);

        if (!code) {
          unrecognized.push({
            lineNumber: index + 1,
            text: line
          });
          return;
        }

        // 原始整行不等于提取出的14位号码，说明清理掉了其他内容。
        if (line !== code) {
          cleaned.push({
            lineNumber: index + 1,
            original: line,
            code
          });
        }

        if (seen.has(code)) {
          duplicated.push({
            lineNumber: index + 1,
            code
          });
          return;
        }

        seen.add(code);
        valid.push(code);
      }
    );

    return {
      valid,
      cleaned,
      unrecognized,
      duplicated
    };
  }

  function parseCodes(text) {
    return analyzeCodes(text).valid;
  }

  function renderAnomalySummary() {
    const wrap =
      document.getElementById(
        IDS.summaryWrap
      );

    const textarea =
      document.getElementById(
        IDS.summary
      );

    if (!wrap || !textarea) {
      return;
    }

    if (!state.anomalies.length) {
      wrap.style.display = "none";
      textarea.value = "";
      return;
    }

    const lines =
      state.anomalies.map(item => {
        const message =
          String(item.message || "")
            .replace(/\s+/g, " ")
            .trim();

        return `${item.code} ${message}`;
      });

    textarea.value =
      lines.join("\n");

    wrap.style.display =
      "block";
  }

  /* =========================================================
   * 10. UI 日志与状态
   * ========================================================= */

  function appendLog(
    type,
    text
  ) {
    const log =
      document.getElementById(
        IDS.log
      );

    if (!log) return;

    const line =
      document.createElement("div");

    line.className =
      `__soa_log_line __soa_log_${type}`;

    const time =
      new Date().toLocaleTimeString(
        "zh-CN",
        {
          hour12: false
        }
      );

    line.textContent =
      `[${time}] ${text}`;

    log.appendChild(line);
    log.scrollTop =
      log.scrollHeight;
  }

  function setStatus(
    text,
    type = "normal"
  ) {
    const el =
      document.getElementById(
        IDS.status
      );

    if (!el) return;

    el.textContent = text;
    el.dataset.type = type;
  }

  function updateCountPreview() {
    const textarea =
      document.getElementById(
        IDS.textarea
      );

    const count =
      document.getElementById(
        IDS.count
      );

    const detail =
      document.getElementById(
        IDS.parseDetail
      );

    if (!textarea || !count) {
      return;
    }

    const analysis =
      analyzeCodes(
        textarea.value
      );

    count.textContent =
      `有效 ${analysis.valid.length} 个`;

    if (detail) {
      detail.innerHTML = `
        <span class="__soa_parse_ok">有效 ${analysis.valid.length}</span>
        <span class="__soa_parse_clean">已清理 ${analysis.cleaned.length}</span>
        <span class="__soa_parse_dup">重复 ${analysis.duplicated.length}</span>
        <span class="__soa_parse_bad">未识别 ${analysis.unrecognized.length}</span>
      `;

      const preview =
        analysis.unrecognized
          .slice(0, 5)
          .map(
            item =>
              `第${item.lineNumber}行：${item.text}`
          )
          .join("\n");

      detail.title =
        preview
          ? (
              "以下内容未找到独立的连续14位预约号：\n" +
              preview +
              (
                analysis.unrecognized.length > 5
                  ? `\n……另有 ${analysis.unrecognized.length - 5} 行`
                  : ""
              )
            )
          : "可从每行文字、空格或符号中自动提取独立的连续14位预约号";
    }
  }

  function updateUI() {
    const progress =
      document.getElementById(
        IDS.progress
      );

    const startBtn =
      document.getElementById(
        IDS.start
      );

    const pauseBtn =
      document.getElementById(
        IDS.pause
      );

    const stopBtn =
      document.getElementById(
        IDS.stop
      );

    const skipBtn =
      document.getElementById(
        IDS.skip
      );

    const textarea =
      document.getElementById(
        IDS.textarea
      );

    if (progress) {
      const total =
        state.codes.length;

      const displayIndex =
        state.running &&
        state.currentCode
          ? Math.min(
              state.index + 1,
              total
            )
          : Math.min(
              state.index,
              total
            );

      progress.innerHTML = `
        <span>进度：${displayIndex}/${total || 0}</span>
        <span class="__soa_ok">成功 ${state.success}</span>
        <span class="__soa_skip">跳过 ${state.skipped}</span>
        <span class="__soa_err">异常 ${state.errors}</span>
      `;
    }

    if (startBtn) {
      startBtn.disabled =
        state.running;
    }

    if (pauseBtn) {
      pauseBtn.disabled =
        !state.running;

      pauseBtn.textContent =
        state.paused
          ? "继续"
          : "暂停";
    }

    if (stopBtn) {
      stopBtn.disabled =
        !state.running;
    }

    if (skipBtn) {
      skipBtn.style.display =
        "none";
    }

    if (textarea) {
      textarea.disabled =
        state.running;
    }

    if (state.running) {
      if (state.paused) {
        setStatus(
          "已暂停",
          "warn"
        );
      } else {
        setStatus(
          state.currentCode
            ? `正在处理：${state.currentCode}`
            : "运行中",
          "running"
        );
      }
    }
  }

  /* =========================================================
   * 11. UI 事件
   * ========================================================= */

  function startBatch() {
    if (state.running) {
      return;
    }

    const input = getInput();

    if (!input) {
      setStatus(
        "未找到预约单号输入框 #vid，请确认当前页面正确",
        "error"
      );

      return;
    }

    const textarea =
      document.getElementById(
        IDS.textarea
      );

    const analysis =
      analyzeCodes(
        textarea?.value || ""
      );

    const codes =
      analysis.valid;

    if (!codes.length) {
      setStatus(
        analysis.unrecognized.length
          ? "没有识别到可处理的14位预约单号"
          : "请先填写预约单号，每行一个",
        "warn"
      );

      textarea?.focus();

      return;
    }

    if (
      analysis.cleaned.length ||
      analysis.unrecognized.length ||
      analysis.duplicated.length
    ) {
      appendLog(
        "warn",
        `运行前智能整理：已清理 ${analysis.cleaned.length} 行，重复 ${analysis.duplicated.length} 行，未识别 ${analysis.unrecognized.length} 行`
      );
    }

    state.running = true;
    state.paused = false;

    state.codes = codes;
    state.index = 0;

    state.success = 0;
    state.skipped = 0;
    state.errors = 0;

    state.currentCode = "";
    state.lastError = "";
    state.anomalies = [];

    renderAnomalySummary();

    const log =
      document.getElementById(
        IDS.log
      );

    if (log) {
      log.innerHTML = "";
    }

    runBatch();
  }

  function togglePause() {
    if (!state.running) {
      return;
    }

    state.paused =
      !state.paused;

    updateUI();
  }

  function stopBatch() {
    if (!state.running) {
      return;
    }

    state.running = false;
    state.paused = false;
    state.currentCode = "";

    state.token++;

    appendLog(
      "warn",
      "用户停止了本次任务"
    );

    setStatus(
      "已停止",
      "warn"
    );

    updateUI();
  }

  function skipCurrent() {
    // v1.1 起异常会自动记录并继续，此按钮保留兼容但不再显示。
  }

  /* =========================================================
   * 12. UI 样式
   * ========================================================= */

  function createStyle() {
    if (
      document.getElementById(
        IDS.style
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id = IDS.style;

    style.textContent = `
      #${IDS.button} {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 10;
        display: none;
        min-width: 112px;
        height: 32px;
        padding: 0 14px;
        border: 0;
        border-radius: 4px;
        background: #1890ff;
        color: #fff;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: .2px;
        cursor: pointer;
        user-select: none;
        box-shadow: 0 2px 8px rgba(24,144,255,.24);
        white-space: nowrap;
      }

      #${IDS.button}:hover {
        background: #40a9ff;
      }

      #${IDS.mask} {
        position: fixed;
        inset: 0;
        z-index: 1200;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,.28);
      }

      #${IDS.panel} {
        position: relative;
        width: ${CONFIG.PANEL_DEFAULT_WIDTH}px;
        max-width: calc(100vw - 40px);
        max-height: calc(100vh - 60px);
        overflow: hidden;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 16px 44px rgba(0,0,0,.22);
        color: rgba(0,0,0,.85);
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          "Microsoft YaHei",
          sans-serif;
      }

      #${IDS.panel} .__soa_header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 48px;
        padding: 0 16px;
        border-bottom: 1px solid #f0f0f0;
        font-size: 15px;
        font-weight: 700;
      }

      #${IDS.close} {
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #8c8c8c;
        font-size: 20px;
        cursor: pointer;
      }

      #${IDS.close}:hover {
        background: #f5f5f5;
        color: #333;
      }

      #${IDS.panel} .__soa_body {
        padding: 15px 16px 10px;
      }

      #${IDS.panel} .__soa_hint {
        margin-bottom: 8px;
        color: #777;
        font-size: 12px;
        line-height: 1.6;
      }

      #${IDS.textarea} {
        display: block;
        width: 100%;
        height: 170px;
        resize: vertical;
        box-sizing: border-box;
        padding: 9px 10px;
        border: 1px solid #d9d9d9;
        border-radius: 6px;
        outline: none;
        color: #222;
        background: #fff;
        font-size: 13px;
        line-height: 1.55;
        font-family: Consolas, "Microsoft YaHei", monospace;
      }

      #${IDS.textarea}:focus {
        border-color: #40a9ff;
        box-shadow: 0 0 0 2px rgba(24,144,255,.12);
      }

      #${IDS.textarea}:disabled {
        background: #fafafa;
        color: #777;
      }

      #${IDS.panel} .__soa_meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
        color: #777;
        font-size: 12px;
      }

      #${IDS.parseDetail} {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        cursor: help;
      }

      #${IDS.parseDetail} .__soa_parse_ok {
        color: #389e0d;
      }

      #${IDS.parseDetail} .__soa_parse_clean {
        color: #1677ff;
      }

      #${IDS.parseDetail} .__soa_parse_dup {
        color: #8c8c8c;
      }

      #${IDS.parseDetail} .__soa_parse_bad {
        color: #cf1322;
      }

      #${IDS.status}[data-type="running"] {
        color: #1890ff;
      }

      #${IDS.status}[data-type="success"] {
        color: #52c41a;
      }

      #${IDS.status}[data-type="warn"] {
        color: #fa8c16;
      }

      #${IDS.status}[data-type="error"] {
        color: #ff4d4f;
      }

      #${IDS.progress} {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 10px;
        padding: 8px 10px;
        border-radius: 6px;
        background: #f7f9fb;
        color: #555;
        font-size: 12px;
      }

      #${IDS.progress} .__soa_ok {
        color: #389e0d;
      }

      #${IDS.progress} .__soa_skip {
        color: #8c8c8c;
      }

      #${IDS.progress} .__soa_err {
        color: #cf1322;
      }

      #${IDS.log} {
        height: 160px;
        margin-top: 10px;
        overflow-y: auto;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid #f0f0f0;
        border-radius: 6px;
        background: #fcfcfc;
        font-size: 12px;
        line-height: 1.65;
        font-family: Consolas, "Microsoft YaHei", monospace;
      }

      #${IDS.log}:empty::before {
        content: "运行日志会显示在这里";
        color: #bfbfbf;
      }


      #${IDS.summaryWrap} {
        display: none;
        margin-top: 10px;
      }

      #${IDS.summaryWrap} .__soa_summary_title {
        margin-bottom: 6px;
        color: #cf1322;
        font-size: 12px;
        font-weight: 700;
      }

      #${IDS.summary} {
        width: 100%;
        height: 110px;
        resize: vertical;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid #ffccc7;
        border-radius: 6px;
        background: #fff2f0;
        color: #a8071a;
        font-size: 12px;
        line-height: 1.6;
        font-family: Consolas, "Microsoft YaHei", monospace;
        outline: none;
      }

      .__soa_log_line {
        word-break: break-all;
      }

      .__soa_log_success {
        color: #389e0d;
      }

      .__soa_log_warn {
        color: #d48806;
      }

      .__soa_log_error {
        color: #cf1322;
        font-weight: 600;
      }

      .__soa_log_skip {
        color: #777;
      }

      .__soa_log_info {
        color: #555;
      }

      #${IDS.resizeHandle} {
        position: absolute;
        top: 48px;
        right: 0;
        bottom: 0;
        width: 8px;
        z-index: 4;
        cursor: ew-resize;
        background: transparent;
      }

      #${IDS.resizeHandle}::after {
        content: "";
        position: absolute;
        top: 50%;
        right: 2px;
        width: 3px;
        height: 52px;
        transform: translateY(-50%);
        border-radius: 2px;
        background: rgba(0,0,0,.12);
        transition: background .15s;
      }

      #${IDS.resizeHandle}:hover::after,
      #${IDS.resizeHandle}.__soa_resizing::after {
        background: rgba(24,144,255,.55);
      }

      #${IDS.panel} .__soa_footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 16px 14px;
      }

      #${IDS.panel} .__soa_action {
        min-width: 76px;
        height: 34px;
        padding: 0 12px;
        border: 1px solid #d9d9d9;
        border-radius: 6px;
        background: #fff;
        color: #444;
        cursor: pointer;
      }

      #${IDS.panel} .__soa_action:hover:not(:disabled) {
        border-color: #40a9ff;
        color: #1890ff;
      }

      #${IDS.panel} .__soa_action:disabled {
        cursor: not-allowed;
        opacity: .45;
      }

      #${IDS.start} {
        border-color: #1890ff !important;
        background: #1890ff !important;
        color: #fff !important;
      }

      #${IDS.start}:hover:not(:disabled) {
        background: #40a9ff !important;
      }

      #${IDS.stop} {
        color: #ff4d4f !important;
      }

      #${IDS.skip}:not(:disabled) {
        color: #fa8c16 !important;
        border-color: #ffc069 !important;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function loadButtonPosition(button) {
    try {
      const raw =
        localStorage.getItem(
          CONFIG.BUTTON_POS_KEY
        );

      if (!raw) return;

      const pos = JSON.parse(raw);

      if (
        Number.isFinite(pos.left) &&
        Number.isFinite(pos.top)
      ) {
        button.style.left =
          `${pos.left}px`;
        button.style.top =
          `${pos.top}px`;
      }
    } catch {
      // 保持默认位置
    }
  }

  function saveButtonPosition(button) {
    try {
      const rect =
        button.getBoundingClientRect();

      localStorage.setItem(
        CONFIG.BUTTON_POS_KEY,
        JSON.stringify({
          left: Math.round(rect.left),
          top: Math.round(rect.top)
        })
      );
    } catch {
      // 忽略存储失败
    }
  }

  function clampButton(button) {
    const rect =
      button.getBoundingClientRect();

    const margin = 6;

    const left =
      Math.min(
        Math.max(rect.left, margin),
        Math.max(
          margin,
          window.innerWidth -
          rect.width -
          margin
        )
      );

    const top =
      Math.min(
        Math.max(rect.top, margin),
        Math.max(
          margin,
          window.innerHeight -
          rect.height -
          margin
        )
      );

    button.style.left =
      `${left}px`;

    button.style.top =
      `${top}px`;
  }

  function initDraggableButton(
    button,
    openHandler
  ) {
    let dragging = false;
    let moved = false;

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    button.addEventListener(
      "pointerdown",
      e => {
        if (e.button !== 0) return;

        dragging = true;
        moved = false;

        const rect =
          button.getBoundingClientRect();

        startX = e.clientX;
        startY = e.clientY;

        startLeft = rect.left;
        startTop = rect.top;

        button.classList.add(
          "__soa_dragging"
        );

        try {
          button.setPointerCapture?.(
            e.pointerId
          );
        } catch {
          // 忽略
        }

        e.preventDefault();
      }
    );

    button.addEventListener(
      "pointermove",
      e => {
        if (!dragging) return;

        const dx =
          e.clientX - startX;

        const dy =
          e.clientY - startY;

        if (
          Math.abs(dx) > 4 ||
          Math.abs(dy) > 4
        ) {
          moved = true;
        }

        if (!moved) return;

        button.style.left =
          `${startLeft + dx}px`;

        button.style.top =
          `${startTop + dy}px`;

        clampButton(button);
      }
    );

    button.addEventListener(
      "pointerup",
      e => {
        if (!dragging) return;

        dragging = false;

        button.classList.remove(
          "__soa_dragging"
        );

        try {
          button.releasePointerCapture?.(
            e.pointerId
          );
        } catch {
          // 忽略
        }

        if (moved) {
          saveButtonPosition(
            button
          );
        } else {
          openHandler();
        }
      }
    );

    button.addEventListener(
      "pointercancel",
      () => {
        dragging = false;

        button.classList.remove(
          "__soa_dragging"
        );
      }
    );

    window.addEventListener(
      "resize",
      () => {
        clampButton(button);
        saveButtonPosition(button);
      }
    );
  }

  /* =========================================================
   * 13. 创建 UI
   * ========================================================= */

  function getSavedPanelWidth() {
    try {
      const raw =
        Number(
          localStorage.getItem(
            CONFIG.PANEL_WIDTH_KEY
          )
        );

      if (
        Number.isFinite(raw) &&
        raw >= CONFIG.PANEL_MIN_WIDTH &&
        raw <= CONFIG.PANEL_MAX_WIDTH
      ) {
        return raw;
      }
    } catch {
      // 忽略
    }

    return CONFIG.PANEL_DEFAULT_WIDTH;
  }

  function savePanelWidth(width) {
    try {
      localStorage.setItem(
        CONFIG.PANEL_WIDTH_KEY,
        String(
          Math.round(width)
        )
      );
    } catch {
      // 忽略
    }
  }

  function initPanelResize() {
    const panel =
      document.getElementById(
        IDS.panel
      );

    const handle =
      document.getElementById(
        IDS.resizeHandle
      );

    if (!panel || !handle) {
      return;
    }

    panel.style.width =
      `${getSavedPanelWidth()}px`;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMove = event => {
      if (!dragging) {
        return;
      }

      const maxWidth =
        Math.max(
          CONFIG.PANEL_MIN_WIDTH,
          Math.min(
            CONFIG.PANEL_MAX_WIDTH,
            window.innerWidth - 40
          )
        );

      const next =
        Math.min(
          maxWidth,
          Math.max(
            CONFIG.PANEL_MIN_WIDTH,
            startWidth +
            event.clientX -
            startX
          )
        );

      panel.style.width =
        `${Math.round(next)}px`;
    };

    const onUp = () => {
      if (!dragging) {
        return;
      }

      dragging = false;

      handle.classList.remove(
        "__soa_resizing"
      );

      savePanelWidth(
        panel.getBoundingClientRect()
          .width
      );

      window.removeEventListener(
        "pointermove",
        onMove
      );

      window.removeEventListener(
        "pointerup",
        onUp
      );
    };

    handle.addEventListener(
      "pointerdown",
      event => {
        if (event.button !== 0) {
          return;
        }

        dragging = true;
        startX = event.clientX;
        startWidth =
          panel.getBoundingClientRect()
            .width;

        handle.classList.add(
          "__soa_resizing"
        );

        window.addEventListener(
          "pointermove",
          onMove
        );

        window.addEventListener(
          "pointerup",
          onUp
        );

        event.preventDefault();
      }
    );
  }

  function createUI() {
    if (
      document.getElementById(
        IDS.button
      )
    ) {
      return;
    }

    createStyle();

    const button =
      document.createElement(
        "button"
      );

    button.id = IDS.button;
    button.type = "button";
    button.textContent =
      "⚡ 批量预约";

    const mask =
      document.createElement(
        "div"
      );

    mask.id = IDS.mask;

    mask.innerHTML = `
      <div id="${IDS.panel}">
        <div class="__soa_header">
          <span>预约单号批量填充</span>
          <button
            id="${IDS.close}"
            type="button"
            title="关闭"
          >×</button>
        </div>

        <div
          id="${IDS.resizeHandle}"
          title="左右拖动调整窗口宽度"
        ></div>

        <div class="__soa_body">
          <div class="__soa_hint">
            <b>使用方法：</b>直接粘贴原始预约信息，每行一条。工具会自动提取其中独立的 <b>14 位预约单号</b>，
            姓名、说明文字、空格和符号会自动忽略；重复号码自动去重，无法识别的内容不会提交。
            确认下方“有效”数量后点击“开始运行”，工具会逐条加入预约列表，并在日志中记录成功、跳过和异常结果。
          </div>

          <textarea
            id="${IDS.textarea}"
            placeholder="可直接粘贴原始内容，例如：
预约号：12345678901234
12345678901235 张三
订单 12345678901236 已确认"
          ></textarea>

          <div class="__soa_meta">
            <span id="${IDS.count}" style="display:none;">有效 0 个</span>
            <span id="${IDS.parseDetail}">
              <span class="__soa_parse_ok">有效 0</span>
              <span class="__soa_parse_clean">已清理 0</span>
              <span class="__soa_parse_dup">重复 0</span>
              <span class="__soa_parse_bad">未识别 0</span>
            </span>
            <span
              id="${IDS.status}"
              data-type="normal"
            >
              等待运行
            </span>
          </div>

          <div id="${IDS.progress}">
            <span>进度：0/0</span>
            <span class="__soa_ok">成功 0</span>
            <span class="__soa_skip">跳过 0</span>
            <span class="__soa_err">异常 0</span>
          </div>

          <div id="${IDS.log}"></div>

          <div id="${IDS.summaryWrap}">
            <div class="__soa_summary_title">
              异常汇总（预约单号 提示）
            </div>
            <textarea
              id="${IDS.summary}"
              readonly
            ></textarea>
          </div>
        </div>

        <div class="__soa_footer">
          <button
            id="${IDS.skip}"
            class="__soa_action"
            type="button"
            disabled
          >
            跳过当前
          </button>

          <button
            id="${IDS.pause}"
            class="__soa_action"
            type="button"
            disabled
          >
            暂停
          </button>

          <button
            id="${IDS.stop}"
            class="__soa_action"
            type="button"
            disabled
          >
            停止
          </button>

          <button
            id="${IDS.start}"
            class="__soa_action"
            type="button"
          >
            开始运行
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(
      button
    );

    document.body.appendChild(
      mask
    );

    initPanelResize();

    const textarea =
      document.getElementById(
        IDS.textarea
      );

    textarea.addEventListener(
      "input",
      updateCountPreview
    );

    document
      .getElementById(
        IDS.start
      )
      .addEventListener(
        "click",
        startBatch
      );

    document
      .getElementById(
        IDS.pause
      )
      .addEventListener(
        "click",
        togglePause
      );

    document
      .getElementById(
        IDS.stop
      )
      .addEventListener(
        "click",
        stopBatch
      );

    document
      .getElementById(
        IDS.skip
      )
      .addEventListener(
        "click",
        skipCurrent
      );

    const openPanel = () => {
      mask.style.display =
        "flex";

      updateCountPreview();
      updateUI();
      renderAnomalySummary();

      if (!state.running) {
        setStatus(
          state.errors
            ? `上次任务存在 ${state.errors} 条异常`
            : "等待运行",
          state.errors
            ? "warn"
            : "normal"
        );
      }

      setTimeout(() => {
        textarea.focus();
      }, 50);
    };

    button.addEventListener(
      "click",
      openPanel
    );

    document
      .getElementById(
        IDS.close
      )
      .addEventListener(
        "click",
        () => {
          mask.style.display =
            "none";
        }
      );

    // 点击遮罩空白处关闭。
    // 运行中的任务不会停止，只是隐藏窗口。
    mask.addEventListener(
      "mousedown",
      e => {
        if (e.target === mask) {
          mask.style.display =
            "none";
        }
      }
    );
  }

  /* =========================================================
   * 14. 初始页常驻 / #vid 检测 / 初始化
   * ========================================================= */

  let hadUsableInput = false;
  let launcherSyncTimer = null;
  let antObserverStarted = false;

  function removeToolDom() {
    document
      .getElementById(
        IDS.button
      )
      ?.remove();

    document
      .getElementById(
        IDS.mask
      )
      ?.remove();
  }

  function hideLauncher() {
    const button =
      document.getElementById(
        IDS.button
      );

    const mask =
      document.getElementById(
        IDS.mask
      );

    if (button) {
      button.style.display =
        "none";
    }

    if (mask) {
      mask.style.display =
        "none";
    }
  }

  function stopTaskWhenInputLeaves() {
    if (!state.running) {
      return;
    }

    state.running = false;
    state.paused = false;
    state.currentCode = "";
    state.token++;

    appendLog(
      "warn",
      "预约单号输入框已离开页面，当前任务已安全停止"
    );

    setStatus(
      "页面已切换，任务已停止",
      "warn"
    );

    updateUI();
  }

  function ensureToolCreated() {
    const input = getInput();

    if (
      !input ||
      !isVisible(input)
    ) {
      return false;
    }

    const button =
      document.getElementById(
        IDS.button
      );

    const mask =
      document.getElementById(
        IDS.mask
      );

    if (
      !button ||
      !mask
    ) {
      removeToolDom();
      createUI();

      console.log(
        "[SOA批量预约] 检测到 #vid，已创建工具"
      );
    }

    return true;
  }

  function positionLauncher() {
    const input = getInput();

    const usable =
      Boolean(
        input &&
        isVisible(input)
      );

    if (
      hadUsableInput &&
      !usable
    ) {
      stopTaskWhenInputLeaves();
    }

    hadUsableInput =
      usable;

    if (!usable) {
      hideLauncher();
      return;
    }

    if (!ensureToolCreated()) {
      return;
    }

    const button =
      document.getElementById(
        IDS.button
      );

    if (!button) {
      return;
    }

    button.style.display =
      "block";

    const inputRect =
      input.getBoundingClientRect();

    const buttonRect =
      button.getBoundingClientRect();

    const blockers =
      getBlockingElements(
        button
      );

    let top =
      inputRect.top +
      (
        inputRect.height -
        buttonRect.height
      ) / 2;

    top = Math.max(
      8,
      Math.min(
        top,
        window.innerHeight -
        buttonRect.height -
        8
      )
    );

    const startLeft =
      inputRect.right +
      CONFIG.BUTTON_START_GAP;

    let chosenLeft =
      startLeft;

    let foundSafe =
      false;

    for (
      let shift = 0;
      shift <= CONFIG.BUTTON_MAX_SHIFT;
      shift += CONFIG.BUTTON_SEARCH_STEP
    ) {
      const candidateLeft =
        startLeft + shift;

      if (
        candidateLeft +
        buttonRect.width >
        window.innerWidth - 8
      ) {
        break;
      }

      if (
        positionIsSafe(
          candidateLeft,
          top,
          buttonRect.width,
          buttonRect.height,
          blockers
        )
      ) {
        chosenLeft =
          candidateLeft;

        foundSafe =
          true;

        break;
      }
    }

    /*
     * 如果右侧暂时没有完整安全位置，
     * 就尽量贴近视口右侧，但不让按钮跑出屏幕。
     */
    if (!foundSafe) {
      chosenLeft =
        Math.max(
          8,
          window.innerWidth -
          buttonRect.width -
          16
        );
    }

    button.style.left =
      `${Math.round(chosenLeft)}px`;

    button.style.top =
      `${Math.round(top)}px`;
  }

  function initLauncherWatcher() {
    /*
     * 不判断 URL，不监听 history，不分析路由。
     * 脚本从 /register_list 首次加载后常驻，
     * 每 200ms 只检查一次 #vid。
     */
    launcherSyncTimer =
      window.setInterval(
        positionLauncher,
        200
      );

    window.addEventListener(
      "resize",
      positionLauncher,
      {
        passive: true
      }
    );

    window.addEventListener(
      "scroll",
      positionLauncher,
      {
        passive: true,
        capture: true
      }
    );

    positionLauncher();
  }

  let initialized = false;

  function init() {
    if (initialized) {
      return;
    }

    if (!document.body) {
      return;
    }

    initialized = true;

    /*
     * 先安装网络请求保护，再初始化其他 UI 功能。
     * 即使“仅当日”复选框尚未渲染，CHECKED 查询也会被强制为当天。
     */
    installOnlyTodayNetworkGuard();

    if (!antObserverStarted) {
      initAntMessageObserver();
      antObserverStarted = true;
    }

    initCheckedTabOnlyTodayGuard();
    initLauncherWatcher();

    console.log(
      "[SOA批量预约] v1.15 已加载。已启用“已到检”首次查询一次性仅当日保护及批量预约功能。"
    );
  }

  function waitForBodyAndInit() {
    if (document.body) {
      init();
      return;
    }

    const timer =
      window.setInterval(
        () => {
          if (!document.body) {
            return;
          }

          clearInterval(timer);
          init();
        },
        50
      );

    document.addEventListener(
      "DOMContentLoaded",
      () => {
        clearInterval(timer);
        init();
      },
      {
        once: true
      }
    );
  }

  waitForBodyAndInit();
})();
