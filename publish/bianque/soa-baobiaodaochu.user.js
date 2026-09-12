// ==UserScript==
// @name         扁鹊-1.5业绩报表辅助
// @namespace    https://tampermonkey.net/
// @version      1.1.4
// @description  SOA报表辅助工具：一次性查询、导出多个表格，用于处理业绩、个检、加项。

// @match        https://checkup-soa3.health-100.cn/*
// @match        https://app-fly.health-100.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      gateway-fly.health-100.cn
// @run-at       document-start

// @author       WanXin
// @publishGroup bianque
// @publishID    soa-baobiaodaochu
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-baobiaodaochu.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-baobiaodaochu.user.js
// ==/UserScript==

/*
 * 扁鹊-1.5业绩报表辅助
 *
 * 功能说明：
 * - 报表可勾选参与批量查询；未勾选报表仍可单独查询，勾选状态自动记忆。
 * - 批量查询按顺序错开请求，查询结果分别展示并独立导出。
 * - 支持今天、本月、本季度、本年和自定义日期区间。
 * - 当前支持：收入确认表、体检对账报表、客户加选项目报表。
 * - 体检对账报表支持超1080天自动分段。
 * - 客户加选项目报表支持异步生成、15秒检测、重新获取和查看下载中心状态。
 * - 支持Fly授权自动获取、失效刷新、网络重试，并可与对账报表v1.9同时使用。
 *
 * 更新记录：
 *
 * v1.1.3  -  2026-09-11
 * - 顶部“报表工具”入口改为与“卡类汇总”一致的原生按钮风格，使用浅绿色区分。
 * - 两个工具入口统一收纳到SOA顶部最右侧独立工具组，保持小间距，不再参与原生菜单布局。
 * - 报表工具与卡类汇总仍保持独立脚本、独立事件与独立面板；任一模块单独启用均可正常工作。
 * - SPA顶部导航重建后自动恢复工具组，并自动重新吸附已存在的卡类汇总按钮。
 *
 * v1.1.2  -  2026-09-10
 * - 取消门户首页显示，业务入口仅在SOA页面展示；Fly页面仍仅用于授权捕获。
 * - 重做“报表工具”入口定位：优先嵌入SOA顶部地区/用户导航区域的可用空位，空间不足时自动寻找顶部不遮挡原标签的安全位置。
 * - 按SOA子页面路由记忆入口位置；刷新时先等待顶部布局稳定，再一次性显示，取消多次延迟重定位，避免加载过程中位置跳动。
 * - SPA子页面切换或顶部导航重建后自动重新适配，不影响报表查询、导出及面板拖动记忆。
 *
 * v1.1.1  -  2026-09-09
 * - 移除“体检套餐一览表”相关查询与导出代码。
 * - 保留“勾选批量 + 单独查询”、勾选状态记忆及现有三类报表全部功能。
 *
 * v1.1.0  -  2026-09-09
 * - 新增“勾选批量 + 单独查询”模式，支持记忆常用报表组合。
 *
 * v1.0.1  -  2026-09-09
 * - 三类报表统一查询、分别导出，完成Fly授权共存及客户加选异步任务处理。
 */

(() => {
  "use strict";

  // ============================================================
  // 1. 基础配置
  // ============================================================


  const HOST_SOA =
    "checkup-soa3.health-100.cn";

  const HOST_FLY =
    "app-fly.health-100.cn";

  const FLY_REPORT_URL =
    "https://app-fly.health-100.cn/autoapp-sheet-from/finance/srqrb?menuCode=1582200567533940737";

  const ADD_ITEMS_DOWNLOAD_CENTER_URL =
    "https://app-fly.health-100.cn/autoapp-sheet-from/downloadcenter/statement-download-list?exportName=%E5%AE%A2%E6%88%B7%E5%8A%A0%E9%80%89%E9%A1%B9%E7%9B%AE%E6%8A%A5%E8%A1%A8";

  const API = {
    INCOME_QUERY:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/financeCheckupOrderDailyQuery?pageIndex=1&pageSize=300",

    INCOME_EXPORT:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/exportFinanceCheckupOrderDaily",

    RECON_QUERY:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/soaHcCheckupOrderDailyQuery?pageIndex=1&pageSize=10",

    RECON_EXPORT:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/exportSoaHcCheckupOrderDaily",

    ADD_ITEMS_QUERY:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/checkuporder/queryAddItems?pageIndex=1&pageSize=10",

    ADD_ITEMS_ASYNC_EXPORT:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/biAdb/asynchronousExportAddItems",

    DOWNLOAD_LIST:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/downloadCenter/queryDownloadList?pageIndex=1&pageSize=10"
  };

  const REPORT = {
    appCode:
      "autoapp-sheet-from"
  };

  const REPORT_MODULES = {
    income: {
      name: "收入确认表",
      shortName: "收入确认表"
    },
    recon: {
      name: "体检对账报表",
      shortName: "体检对账"
    },
    addItems: {
      name: "客户加选项目报表",
      shortName: "客户加选"
    }
  };

  const FIXED_LOOKBACK_DAYS =
    1080;

  const MAX_QUERY_SEGMENTS =
    20;

  const REPORT_SEGMENT_GAP_MS =
    150;

  // 不同报表之间的批量查询错峰间隔。
  const REPORT_QUERY_GAP_MS =
    1200;

  const REPORT_ORDER = [
    "income",
    "recon",
    "addItems"
  ];

  const ADD_ITEMS_WAIT_MS =
    15000;

  const ADD_ITEMS_POLL_INTERVAL_MS =
    1500;

  /*
   * 授权流程仍沿用对账报表v1.9的成熟逻辑，
   * 但本脚本使用独立Key和独立网络包装标记。
   *
   * 原因：
   * Tampermonkey的GM存储按用户脚本隔离，但unsafeWindow上的fetch/XHR包装标记是页面共享的。
   * 如果两个脚本使用同一个 __soaFlyTokenWrapped 标记，后执行的脚本会误判为“已安装捕获器”，
   * 从而拿不到属于自己的Token缓存。
   */
  const TOKEN_KEY =
    "__hlj_fly_report_token_v030";

  const TOKEN_TIME_KEY =
    "__hlj_fly_report_token_time_v030";

  const TOKEN_CAPTURE_REQUEST_KEY =
    "__hlj_fly_report_capture_request_v030";

  const FETCH_WRAP_MARKER =
    "__hljFlyReportFetchWrappedV030";

  const XHR_WRAP_MARKER =
    "__hljFlyReportXhrWrappedV030";

  const TOKEN_WAIT_TIMEOUT =
    60000;

  const REQUEST_MAX_ATTEMPTS =
    3;

  const PANEL_ID =
    "__fly_income_report_panel_v020";

  const PANEL_POSITION_KEY =
    "__fly_income_report_panel_position_v023";

  const PRESET_RANGE_KEY =
    "__fly_income_report_preset_range_v024";

  const REPORT_SELECTION_KEY =
    "__bianque_report_selected_v110";

  const GLOBAL_SWITCH_ID =
    "__hlj_fly_report_global_switch_v023";

  const GLOBAL_SWITCH_STYLE_ID =
    "__hlj_fly_report_global_switch_style_v113";

  const GLOBAL_SWITCH_SLOT_ID =
    "__hlj_fly_report_switch_slot_v113";

  const TOP_TOOL_GROUP_ID =
    "__hlj_soa_top_tool_group_v1";

  let panelVisible =
    false;

  let globalSwitchPlacementTask =
    null;

  let globalSwitchPlacementGeneration =
    0;

  let globalSwitchObserver =
    null;

  let globalSwitchRouteKey =
    "";

  // ============================================================
  // 2. 通用工具
  // ============================================================

  function cleanText(value) {
    return String(
      value ?? ""
    ).trim();
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

  function pad2(value) {
    return String(
      value
    ).padStart(
      2,
      "0"
    );
  }

  function formatLocalDate(date) {
    return (
      `${date.getFullYear()}-${pad2(
        date.getMonth() + 1
      )}-${pad2(
        date.getDate()
      )}`
    );
  }

  function getChinaToday() {
    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone:
            "Asia/Shanghai",
          year:
            "numeric",
          month:
            "2-digit",
          day:
            "2-digit"
        }
      ).formatToParts(
        new Date()
      );

    const map = {};

    parts.forEach(
      part => {
        map[
          part.type
        ] =
          part.value;
      }
    );

    return (
      `${map.year}-${map.month}-${map.day}`
    );
  }

  function getChinaMonthStart() {
    const today =
      getChinaToday();

    return (
      `${today.slice(
        0,
        8
      )}01`
    );
  }

  function getChinaQuarterStart() {
    const today =
      getChinaToday();

    const [
      year,
      month
    ] =
      today
        .split("-")
        .map(Number);

    const quarterStartMonth =
      Math.floor(
        (month - 1) / 3
      ) * 3 + 1;

    return (
      `${year}-${pad2(
        quarterStartMonth
      )}-01`
    );
  }

  function getChinaYearStart() {
    return (
      `${getChinaToday().slice(
        0,
        4
      )}-01-01`
    );
  }

  function parseFlexibleDate(input) {
    const raw =
      cleanText(
        input
      );

    if (!raw) {
      return "";
    }

    let year;
    let month;
    let day;

    const digitsOnly =
      raw.replace(
        /\D/g,
        ""
      );

    if (
      /^\d{8}$/.test(
        digitsOnly
      )
    ) {
      year =
        Number(
          digitsOnly.slice(
            0,
            4
          )
        );

      month =
        Number(
          digitsOnly.slice(
            4,
            6
          )
        );

      day =
        Number(
          digitsOnly.slice(
            6,
            8
          )
        );
    } else {
      const parts =
        raw
          .split(
            /\D+/
          )
          .filter(
            Boolean
          );

      if (
        parts.length !== 3
      ) {
        return "";
      }

      year =
        Number(
          parts[0]
        );

      month =
        Number(
          parts[1]
        );

      day =
        Number(
          parts[2]
        );
    }

    if (
      !Number.isInteger(
        year
      ) ||
      !Number.isInteger(
        month
      ) ||
      !Number.isInteger(
        day
      ) ||
      year < 2000 ||
      year > 2100 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return "";
    }

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    if (
      date.getFullYear() !==
        year ||
      date.getMonth() !==
        month - 1 ||
      date.getDate() !==
        day
    ) {
      return "";
    }

    return formatLocalDate(
      date
    );
  }

  function dateToUtcDayNumber(
    dateText
  ) {
    const normalized =
      parseFlexibleDate(
        dateText
      );

    if (!normalized) {
      return NaN;
    }

    const [
      year,
      month,
      day
    ] =
      normalized
        .split(
          "-"
        )
        .map(
          Number
        );

    return Math.floor(
      Date.UTC(
        year,
        month - 1,
        day
      ) /
      86400000
    );
  }

  function diffDays(
    startDate,
    endDate
  ) {
    return (
      dateToUtcDayNumber(
        endDate
      ) -
      dateToUtcDayNumber(
        startDate
      )
    );
  }

  function chinaDateToIso(
    dateText,
    endOfDay =
      false
  ) {
    const date =
      parseFlexibleDate(
        dateText
      );

    if (!date) {
      throw new Error(
        `日期格式无效：${dateText}`
      );
    }

    const time =
      endOfDay
        ? "23:59:59"
        : "00:00:00";

    return new Date(
      `${date}T${time}+08:00`
    ).toISOString();
  }

  // ============================================================
  // 3. Fly Token授权模块
  //    完整沿用对账报表v1.9的已验证逻辑
  // ============================================================

  function decodeJwtPayload(token) {
    try {
      const parts =
        cleanText(
          token
        ).split(".");

      if (
        parts.length !== 3
      ) {
        return null;
      }

      let base64 =
        parts[1]
          .replace(
            /-/g,
            "+"
          )
          .replace(
            /_/g,
            "/"
          );

      while (
        base64.length % 4
      ) {
        base64 += "=";
      }

      return JSON.parse(
        decodeURIComponent(
          Array.from(
            atob(
              base64
            )
          )
            .map(
              char =>
                "%" +
                char
                  .charCodeAt(0)
                  .toString(16)
                  .padStart(
                    2,
                    "0"
                  )
            )
            .join("")
        )
      );
    } catch {
      return null;
    }
  }

  function normalizeToken(value) {
    const text =
      cleanText(
        value
      );

    if (!text) {
      return "";
    }

    const bearerMatch =
      text.match(
        /^Bearer\s+(.+)$/i
      );

    return bearerMatch
      ? cleanText(
          bearerMatch[1]
        )
      : text;
  }

  function isValidFlyToken(
    token,
    reserveMs =
      30000
  ) {
    const normalized =
      normalizeToken(
        token
      );

    const payload =
      decodeJwtPayload(
        normalized
      );

    if (!payload) {
      return false;
    }

    const exp =
      Number(
        payload.exp
      );

    if (
      !Number.isFinite(
        exp
      ) ||
      exp * 1000 <=
        Date.now() +
          reserveMs
    ) {
      return false;
    }

    return true;
  }

  function storeFlyToken(value) {
    const token =
      normalizeToken(
        value
      );

    if (
      !isValidFlyToken(
        token
      )
    ) {
      return false;
    }

    GM_setValue(
      TOKEN_KEY,
      token
    );

    GM_setValue(
      TOKEN_TIME_KEY,
      Date.now()
    );

    const captureRequest =
      GM_getValue(
        TOKEN_CAPTURE_REQUEST_KEY,
        null
      );

    if (
      captureRequest
    ) {
      /*
       * Token可能由Fly顶层页面捕获，也可能由内部frame捕获。
       * 先清除捕获请求标记，让原页面能够立即读到缓存Token并继续。
       * 再尽量关闭由本工具打开的Fly辅助标签页。
       */
      GM_deleteValue(
        TOKEN_CAPTURE_REQUEST_KEY
      );

      setTimeout(
        () => {
          try {
            const topWindow =
              window.top ||
              window;

            if (
              topWindow.opener
            ) {
              topWindow.close();
              return;
            }
          } catch (_) {}

          try {
            if (
              window.opener
            ) {
              window.close();
            }
          } catch (_) {}
        },
        1000
      );
    }

    return true;
  }

  function getCachedFlyToken() {
    const token =
      cleanText(
        GM_getValue(
          TOKEN_KEY,
          ""
        )
      );

    return isValidFlyToken(
      token
    )
      ? token
      : "";
  }

  function extractJwtCandidates(text) {
    return (
      cleanText(
        text
      ).match(
        /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
      ) ||
      []
    );
  }

  function scanFlyStorageForToken() {
    const storages = [
      localStorage,
      sessionStorage
    ];

    for (
      const storage
      of storages
    ) {
      for (
        let index = 0;
        index <
          storage.length;
        index += 1
      ) {
        const key =
          storage.key(
            index
          );

        if (!key) {
          continue;
        }

        const candidates =
          extractJwtCandidates(
            storage.getItem(
              key
            )
          );

        for (
          const candidate
          of candidates
        ) {
          if (
            storeFlyToken(
              candidate
            )
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function inspectAuthorizationHeaders(headers) {
    if (!headers) {
      return false;
    }

    try {
      if (
        typeof headers.forEach ===
        "function"
      ) {
        let captured =
          false;

        headers.forEach(
          (
            value,
            key
          ) => {
            if (
              cleanText(
                key
              ).toLowerCase() ===
                "authorization" &&
              storeFlyToken(
                value
              )
            ) {
              captured =
                true;
            }
          }
        );

        return captured;
      }

      if (
        Array.isArray(
          headers
        )
      ) {
        for (
          const pair
          of headers
        ) {
          if (
            Array.isArray(
              pair
            ) &&
            cleanText(
              pair[0]
            ).toLowerCase() ===
              "authorization" &&
            storeFlyToken(
              pair[1]
            )
          ) {
            return true;
          }
        }
      }

      if (
        typeof headers ===
        "object"
      ) {
        for (
          const [
            key,
            value
          ]
          of Object.entries(
            headers
          )
        ) {
          if (
            cleanText(
              key
            ).toLowerCase() ===
              "authorization" &&
            storeFlyToken(
              value
            )
          ) {
            return true;
          }
        }
      }
    } catch (_) {}

    return false;
  }

  function installFlyTokenCapture() {
    // 先扫描Fly页面自身的localStorage/sessionStorage。
    scanFlyStorageForToken();

    const root =
      typeof unsafeWindow !==
        "undefined"
        ? unsafeWindow
        : window;

    // 捕获fetch请求头中的Authorization。
    try {
      const originalFetch =
        root.fetch;

      if (
        typeof originalFetch ===
          "function" &&
        !originalFetch[
          FETCH_WRAP_MARKER
        ]
      ) {
        const wrappedFetch =
          function (
            input,
            init
          ) {
            try {
              inspectAuthorizationHeaders(
                init?.headers
              );

              inspectAuthorizationHeaders(
                input?.headers
              );
            } catch (_) {}

            return originalFetch.apply(
              this,
              arguments
            );
          };

        Object.defineProperty(
          wrappedFetch,
          FETCH_WRAP_MARKER,
          {
            value:
              true
          }
        );

        root.fetch =
          wrappedFetch;
      }
    } catch (_) {}

    // 捕获XHR请求头中的Authorization。
    try {
      const xhrProto =
        root.XMLHttpRequest
          ?.prototype;

      const originalSetHeader =
        xhrProto
          ?.setRequestHeader;

      if (
        originalSetHeader &&
        !originalSetHeader[
          XHR_WRAP_MARKER
        ]
      ) {
        const wrappedSetHeader =
          function (
            name,
            value
          ) {
            try {
              if (
                cleanText(
                  name
                ).toLowerCase() ===
                  "authorization"
              ) {
                storeFlyToken(
                  value
                );
              }
            } catch (_) {}

            return originalSetHeader.apply(
              this,
              arguments
            );
          };

        Object.defineProperty(
          wrappedSetHeader,
          XHR_WRAP_MARKER,
          {
            value:
              true
          }
        );

        xhrProto.setRequestHeader =
          wrappedSetHeader;
      }
    } catch (_) {}

    // Fly页面可能稍后才把Token写入Storage，持续扫描60秒。
    let attempts =
      0;

    const timer =
      setInterval(
        () => {
          attempts += 1;

          scanFlyStorageForToken();

          if (
            attempts >= 120
          ) {
            clearInterval(
              timer
            );
          }
        },
        500
      );
  }

  async function ensureFlyToken(
    forceRefresh =
      false,
    setStatus =
      () => {}
  ) {
    if (!forceRefresh) {
      const cached =
        getCachedFlyToken();

      if (cached) {
        return cached;
      }
    }

    GM_deleteValue(
      TOKEN_KEY
    );

    GM_deleteValue(
      TOKEN_TIME_KEY
    );

    GM_setValue(
      TOKEN_CAPTURE_REQUEST_KEY,
      {
        createdAt:
          Date.now()
      }
    );

    setStatus(
      "需要刷新Fly授权，正在打开一次Fly报表页..."
    );

    /*
     * ensureFlyToken由用户点击“查询/导出”触发。
     * 在首次await之前直接window.open，尽量避免被浏览器拦截。
     */
    const helper =
      window.open(
        FLY_REPORT_URL,
        "_blank"
      );

    if (!helper) {
      GM_deleteValue(
        TOKEN_CAPTURE_REQUEST_KEY
      );

      throw new Error(
        "浏览器阻止了Fly授权标签页，请允许当前网站打开弹出窗口后重试"
      );
    }

    const started =
      Date.now();

    while (
      Date.now() -
        started <
      TOKEN_WAIT_TIMEOUT
    ) {
      await sleep(
        500
      );

      const token =
        getCachedFlyToken();

      if (token) {
        setStatus(
          "✓ Fly授权已刷新，继续执行请求..."
        );

        return token;
      }
    }

    GM_deleteValue(
      TOKEN_CAPTURE_REQUEST_KEY
    );

    throw new Error(
      "60秒内未获取到Fly授权，请确认新标签页已正常登录并成功打开Fly报表页"
    );
  }

  /*
   * 与对账报表v1.9保持一致：
   * Fly站点只负责捕获并缓存Token，不继续执行后面的业务UI。
   *
   * 这里不能使用 @noframes。
   * Fly报表应用内部如果通过frame承载实际请求，Token捕获脚本也必须能在frame中运行。
   */
  if (
    location.hostname ===
    HOST_FLY
  ) {
    installFlyTokenCapture();
    return;
  }

  /*
   * 门户/SOA只在顶层窗口创建全局入口和业务面板，
   * 避免页面内部iframe重复显示。
   */
  if (
    window.top !==
    window.self
  ) {
    return;
  }

  // ============================================================
  // 4. Fly请求与重试
  // ============================================================

  function gmRequestOnce({
    url,
    token,
    body,
    responseType =
      "json"
  }) {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        GM_xmlhttpRequest({
          method:
            "POST",

          url,

          headers: {
            Accept:
              "application/json, text/plain, */*",

            "Content-Type":
              "application/json;charset=UTF-8",

            Authorization:
              `Bearer ${token}`,

            locale:
              "en-US",

            "x-fly-app-code":
              REPORT.appCode,

            Origin:
              "https://app-fly.health-100.cn",

            Referer:
              "https://app-fly.health-100.cn/"
          },

          data:
            JSON.stringify(
              body
            ),

          responseType,

          anonymous:
            false,

          timeout:
            30000,

          onload:
            resolve,

          onerror:
            error => {
              const err =
                new Error(
                  error?.error ||
                  "Fly接口网络请求失败"
                );

              err.networkError =
                true;

              reject(
                err
              );
            },

          ontimeout:
            () => {
              const err =
                new Error(
                  "Fly接口请求超时"
                );

              err.networkError =
                true;

              reject(
                err
              );
            }
        });
      }
    );
  }

  function shouldRetryStatus(status) {
    return (
      status === 0 ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (
        status >= 500 &&
        status <= 599
      )
    );
  }

  async function gmRequestWithRetry({
    url,
    token,
    body,
    responseType =
      "json",
    onRetry =
      () => {}
  }) {
    let lastError =
      null;

    for (
      let attempt = 1;
      attempt <=
        REQUEST_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const response =
          await gmRequestOnce({
            url,
            token,
            body,
            responseType
          });

        if (
          shouldRetryStatus(
            response.status
          ) &&
          attempt <
            REQUEST_MAX_ATTEMPTS
        ) {
          onRetry(
            attempt,
            `HTTP ${response.status}`
          );

          await sleep(
            attempt === 1
              ? 800
              : 1800
          );

          continue;
        }

        return response;
      } catch (error) {
        lastError =
          error;

        if (
          attempt >=
            REQUEST_MAX_ATTEMPTS
        ) {
          throw error;
        }

        onRetry(
          attempt,
          error?.message ||
          "网络错误"
        );

        await sleep(
          attempt === 1
            ? 800
            : 1800
        );
      }
    }

    throw (
      lastError ||
      new Error(
        "请求失败"
      )
    );
  }

  function responseLooksAuthRelated(response) {
    if (
      response.status ===
        401 ||
      response.status ===
        403
    ) {
      return true;
    }

    if (
      response.status !==
        400
    ) {
      return false;
    }

    const text =
      cleanText(
        response.responseText
      );

    return (
      /authorization|bearer|token|unauthorized|forbidden|login|keycloak|鉴权|认证|登录/i.test(
        text
      )
    );
  }

  function responseTextPreview(
    response,
    maxLength =
      300
  ) {
    const text =
      cleanText(
        response?.responseText
      );

    if (!text) {
      return "";
    }

    return text.length >
      maxLength
      ? `${text.slice(
          0,
          maxLength
        )}...`
      : text;
  }

  async function requestJson(
    url,
    token,
    body,
    onRetry
  ) {
    const response =
      await gmRequestWithRetry({
        url,
        token,
        body,
        responseType:
          "json",
        onRetry
      });

    if (
      responseLooksAuthRelated(
        response
      )
    ) {
      const error =
        new Error(
          `Fly授权失效：HTTP ${response.status}`
        );

      error.authExpired =
        true;

      throw error;
    }

    if (
      response.status <
        200 ||
      response.status >=
        300
    ) {
      const detail =
        responseTextPreview(
          response
        );

      throw new Error(
        detail
          ? `接口请求失败：HTTP ${response.status} · ${detail}`
          : `接口请求失败：HTTP ${response.status}`
      );
    }

    let payload =
      response.response;

    if (
      !payload &&
      response.responseText
    ) {
      try {
        payload =
          JSON.parse(
            response.responseText
          );
      } catch (_) {}
    }

    if (!payload) {
      throw new Error(
        "接口未返回有效JSON"
      );
    }

    return payload;
  }

  function parseResponseHeaders(rawHeaders) {
    const map = {};

    cleanText(
      rawHeaders
    )
      .split(
        /\r?\n/
      )
      .forEach(
        line => {
          const index =
            line.indexOf(
              ":"
            );

          if (
            index <= 0
          ) {
            return;
          }

          map[
            line
              .slice(
                0,
                index
              )
              .trim()
              .toLowerCase()
          ] =
            line
              .slice(
                index + 1
              )
              .trim();
        }
      );

    return map;
  }

  function createRetryHandler(
    setStatus
  ) {
    return (
      attempt,
      reason
    ) => {
      setStatus(
        `请求异常：${reason}，正在第 ${attempt + 1} 次尝试...`
      );
    };
  }

  async function withFlyTokenRetry(
    task,
    setStatus
  ) {
    let token =
      await ensureFlyToken(
        false,
        setStatus
      );

    try {
      return await task(
        token
      );
    } catch (error) {
      if (
        !error?.authExpired
      ) {
        throw error;
      }

      setStatus(
        "Fly授权已失效，正在刷新授权并自动重试..."
      );

      token =
        await ensureFlyToken(
          true,
          setStatus
        );

      return await task(
        token
      );
    }
  }

  // ============================================================
  // 5. 多报表业务逻辑
  // ============================================================

  function addDays(
    dateText,
    deltaDays
  ) {
    const normalized =
      parseFlexibleDate(
        dateText
      );

    if (!normalized) {
      return "";
    }

    const [
      year,
      month,
      day
    ] =
      normalized
        .split("-")
        .map(Number);

    const date =
      new Date(
        year,
        month - 1,
        day
      );

    date.setDate(
      date.getDate() +
      deltaDays
    );

    return formatLocalDate(
      date
    );
  }

  function splitDateRange(
    startDate,
    endDate
  ) {
    const start =
      parseFlexibleDate(
        startDate
      );

    const end =
      parseFlexibleDate(
        endDate
      );

    if (
      !start ||
      !end
    ) {
      throw new Error(
        "开始日期或结束日期格式无效"
      );
    }

    if (
      diffDays(
        start,
        end
      ) < 0
    ) {
      throw new Error(
        "开始日期不能晚于结束日期"
      );
    }

    const periods = [];
    let cursor = start;

    while (
      diffDays(
        cursor,
        end
      ) >= 0
    ) {
      const candidateEnd =
        addDays(
          cursor,
          FIXED_LOOKBACK_DAYS
        );

      const periodEnd =
        diffDays(
          candidateEnd,
          end
        ) >= 0
          ? candidateEnd
          : end;

      periods.push({
        startDate:
          cursor,
        endDate:
          periodEnd
      });

      if (
        periodEnd === end
      ) {
        break;
      }

      cursor =
        addDays(
          periodEnd,
          1
        );

      if (
        periods.length >=
        MAX_QUERY_SEGMENTS
      ) {
        throw new Error(
          `日期范围过大，最多自动拆分 ${MAX_QUERY_SEGMENTS} 个时段`
        );
      }
    }

    return periods;
  }

  function getTokenUserInfo(
    token
  ) {
    const payload =
      decodeJwtPayload(
        token
      );

    if (!payload) {
      const error =
        new Error(
          "Fly Token解析失败"
        );

      error.authExpired =
        true;

      throw error;
    }

    const userName =
      cleanText(
        payload.name
      );

    const uid =
      cleanText(
        payload.uid
      );

    if (
      !userName ||
      !uid
    ) {
      throw new Error(
        "Fly Token中未读取到userName或uid"
      );
    }

    return {
      userName,
      uid
    };
  }

  function validateDateRange(
    startDate,
    endDate
  ) {
    const normalizedStart =
      parseFlexibleDate(
        startDate
      );

    const normalizedEnd =
      parseFlexibleDate(
        endDate
      );

    if (
      !normalizedStart ||
      !normalizedEnd
    ) {
      throw new Error(
        "开始日期或结束日期格式无效"
      );
    }

    if (
      diffDays(
        normalizedStart,
        normalizedEnd
      ) < 0
    ) {
      throw new Error(
        "开始日期不能晚于结束日期"
      );
    }

    return {
      startDate:
        normalizedStart,
      endDate:
        normalizedEnd
    };
  }

  function validateApiSuccess(
    payload,
    actionName =
      "接口请求"
  ) {
    const statusCode =
      Number(
        payload?.statusCode
      );

    if (
      statusCode !== 200
    ) {
      throw new Error(
        cleanText(
          payload?.message
        ) ||
        `${actionName}返回异常：statusCode=${cleanText(
          payload?.statusCode
        ) || "未知"}`
      );
    }

    return payload;
  }

  function getPayloadTotal(
    payload
  ) {
    validateApiSuccess(
      payload,
      "查询接口"
    );

    const total =
      Number(
        payload?.data?.total
      );

    return Number.isFinite(
      total
    )
      ? total
      : 0;
  }

  function sanitizeFilenamePart(value) {
    return cleanText(
      value
    )
      .replace(
        /[\\/:*?"<>|]+/g,
        "_"
      )
      .replace(
        /\s+/g,
        ""
      );
  }

  function getRangeFilename(
    reportName,
    startDate,
    endDate
  ) {
    const start =
      parseFlexibleDate(
        startDate
      ).replace(
        /-/g,
        ""
      );

    const end =
      parseFlexibleDate(
        endDate
      ).replace(
        /-/g,
        ""
      );

    return sanitizeFilenamePart(
      `${reportName}_${start}-${end}.xlsx`
    );
  }

  async function exportArrayBufferReport(
    token,
    url,
    body,
    {
      filename,
      onRetry
    }
  ) {
    const response =
      await gmRequestWithRetry({
        url,
        token,
        body,
        responseType:
          "arraybuffer",
        onRetry
      });

    if (
      responseLooksAuthRelated(
        response
      )
    ) {
      const error =
        new Error(
          `Fly授权失效：HTTP ${response.status}`
        );

      error.authExpired =
        true;

      throw error;
    }

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      const detail =
        responseTextPreview(
          response
        );

      throw new Error(
        detail
          ? `导出失败：HTTP ${response.status} · ${detail}`
          : `导出失败：HTTP ${response.status}`
      );
    }

    const headers =
      parseResponseHeaders(
        response.responseHeaders
      );

    const contentType =
      headers[
        "content-type"
      ] ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const buffer =
      response.response;

    if (
      !buffer ||
      buffer.byteLength === 0
    ) {
      throw new Error(
        "导出接口返回空文件"
      );
    }

    if (
      contentType.includes(
        "application/json"
      )
    ) {
      const text =
        new TextDecoder(
          "utf-8"
        ).decode(
          new Uint8Array(
            buffer
          )
        );

      let payload = null;

      try {
        payload =
          JSON.parse(
            text
          );
      } catch (_) {}

      throw new Error(
        cleanText(
          payload?.message ??
          payload?.msg ??
          payload?.error_desc ??
          payload?.errorDesc ??
          payload?.error_code ??
          payload?.errorCode
        ) ||
        cleanText(
          text
        ).slice(
          0,
          300
        ) ||
        "导出接口未返回有效文件"
      );
    }

    const blob =
      new Blob(
        [
          buffer
        ],
        {
          type:
            contentType
        }
      );

    const objectUrl =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      objectUrl;

    anchor.download =
      filename;

    anchor.style.display =
      "none";

    document.body.appendChild(
      anchor
    );

    anchor.click();
    anchor.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          objectUrl
        ),
      60000
    );

    return {
      filename,
      size:
        blob.size
    };
  }

  // -------------------- 收入确认表 --------------------

  function buildIncomeBody(
    token,
    startDate,
    endDate
  ) {
    const dates =
      validateDateRange(
        startDate,
        endDate
      );

    const {
      userName,
      uid
    } =
      getTokenUserInfo(
        token
      );

    return {
      regionCode:
        "ALL",

      startDate:
        chinaDateToIso(
          dates.startDate,
          false
        ),

      endDate:
        chinaDateToIso(
          dates.endDate,
          true
        ),

      pageIndex:
        1,

      pageSize:
        300,

      userName,
      uid,

      menuName:
        REPORT_MODULES.income.name
    };
  }

  async function queryIncomeReport(
    token,
    body,
    onRetry
  ) {
    const payload =
      await requestJson(
        API.INCOME_QUERY,
        token,
        body,
        onRetry
      );

    return {
      total:
        getPayloadTotal(
          payload
        )
    };
  }

  async function exportIncomeReport(
    token,
    body,
    {
      startDate,
      endDate,
      onRetry
    }
  ) {
    return exportArrayBufferReport(
      token,
      API.INCOME_EXPORT,
      body,
      {
        filename:
          getRangeFilename(
            REPORT_MODULES.income.name,
            startDate,
            endDate
          ),
        onRetry
      }
    );
  }

  // -------------------- 体检对账报表 --------------------

  function buildReconBody(
    startDate,
    endDate
  ) {
    const dates =
      validateDateRange(
        startDate,
        endDate
      );

    if (
      diffDays(
        dates.startDate,
        dates.endDate
      ) >
      FIXED_LOOKBACK_DAYS
    ) {
      throw new Error(
        `单次查询区间不能超过 ${FIXED_LOOKBACK_DAYS} 天`
      );
    }

    return {
      regionCode:
        "ALL",

      corpName:
        [],

      // 全局报表工具不绑定当前订单，单位代码保持为空。
      corpCode:
        [],

      checkupType:
        [],

      status:
        "Y",

      startDate:
        chinaDateToIso(
          dates.startDate,
          false
        ),

      endDate:
        chinaDateToIso(
          dates.endDate,
          true
        ),

      payStartDate:
        null,

      payEndDate:
        null,

      regionFlag:
        0,

      pageIndex:
        1,

      pageSize:
        10
    };
  }

  async function queryReconPeriod(
    token,
    body,
    onRetry
  ) {
    const payload =
      await requestJson(
        API.RECON_QUERY,
        token,
        body,
        onRetry
      );

    return {
      total:
        getPayloadTotal(
          payload
        )
    };
  }

  async function exportReconPeriod(
    token,
    body,
    {
      startDate,
      endDate,
      onRetry
    }
  ) {
    return exportArrayBufferReport(
      token,
      API.RECON_EXPORT,
      body,
      {
        filename:
          getRangeFilename(
            REPORT_MODULES.recon.name,
            startDate,
            endDate
          ),
        onRetry
      }
    );
  }

  // -------------------- 客户加选项目报表 --------------------

  function buildAddItemsBody(
    token,
    startDate,
    endDate
  ) {
    const dates =
      validateDateRange(
        startDate,
        endDate
      );

    const {
      userName,
      uid
    } =
      getTokenUserInfo(
        token
      );

    return {
      regionCode:
        "XX",

      userName,
      uid,

      menuName:
        REPORT_MODULES.addItems.name,

      checkinStartDate:
        chinaDateToIso(
          dates.startDate,
          false
        ),

      checkinEndDate:
        chinaDateToIso(
          dates.endDate,
          true
        ),

      settleStartDate:
        null,

      settleEndDate:
        null,

      payStartDate:
        null,

      payEndDate:
        null,

      pageIndex:
        1,

      pageSize:
        10
    };
  }

  async function queryAddItemsReport(
    token,
    body,
    onRetry
  ) {
    const payload =
      await requestJson(
        API.ADD_ITEMS_QUERY,
        token,
        body,
        onRetry
      );

    return {
      total:
        getPayloadTotal(
          payload
        )
    };
  }

  async function queryDownloadList(
    token,
    onRetry
  ) {
    const payload =
      await requestJson(
        API.DOWNLOAD_LIST,
        token,
        {
          exportName:
            REPORT_MODULES.addItems.name,
          pageIndex:
            1,
          pageSize:
            10
        },
        onRetry
      );

    validateApiSuccess(
      payload,
      "下载中心查询"
    );

    return Array.isArray(
      payload?.data?.rows
    )
      ? payload.data.rows
      : [];
  }

  function getAddItemsBaselineId(
    rows,
    uid
  ) {
    return rows
      .filter(
        row =>
          cleanText(
            row?.exportName
          ) ===
            REPORT_MODULES.addItems.name &&
          cleanText(
            row?.createdBy
          ) ===
            cleanText(
              uid
            )
      )
      .reduce(
        (
          maxId,
          row
        ) => {
          const id =
            Number(
              row?.id
            );

          return Number.isFinite(
            id
          )
            ? Math.max(
                maxId,
                id
              )
            : maxId;
        },
        0
      );
  }

  function findAddItemsNewTask(
    rows,
    {
      uid,
      baselineId
    }
  ) {
    return rows
      .filter(
        row => {
          const id =
            Number(
              row?.id
            );

          return (
            cleanText(
              row?.exportName
            ) ===
              REPORT_MODULES.addItems.name &&
            cleanText(
              row?.createdBy
            ) ===
              cleanText(
                uid
              ) &&
            Number.isFinite(
              id
            ) &&
            id >
              Number(
                baselineId || 0
              )
          );
        }
      )
      .sort(
        (a, b) =>
          Number(
            b?.id || 0
          ) -
          Number(
            a?.id || 0
          )
      )[0] ||
      null;
  }

  function isAddItemsTaskReady(
    task
  ) {
    return Boolean(
      task &&
      cleanText(
        task.exportStatus
      ) === "1" &&
      cleanText(
        task.exportUrl
      )
    );
  }

  async function submitAddItemsExportOnce(
    token,
    body
  ) {
    const response =
      await gmRequestOnce({
        url:
          API.ADD_ITEMS_ASYNC_EXPORT,
        token,
        body,
        responseType:
          "json"
      });

    if (
      responseLooksAuthRelated(
        response
      )
    ) {
      const error =
        new Error(
          `Fly授权失效：HTTP ${response.status}`
        );

      error.authExpired =
        true;

      throw error;
    }

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      throw new Error(
        `异步导出任务提交失败：HTTP ${response.status}`
      );
    }

    let payload =
      response.response;

    if (
      !payload &&
      response.responseText
    ) {
      try {
        payload =
          JSON.parse(
            response.responseText
          );
      } catch (_) {}
    }

    validateApiSuccess(
      payload,
      "异步导出任务"
    );

    return payload;
  }

  function triggerSignedUrlDownload(
    exportUrl
  ) {
    const url =
      cleanText(
        exportUrl
      );

    if (!url) {
      throw new Error(
        "下载链接为空"
      );
    }

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

    anchor.target =
      "_blank";

    anchor.rel =
      "noopener noreferrer";

    anchor.style.display =
      "none";

    document.body.appendChild(
      anchor
    );

    anchor.click();
    anchor.remove();
  }


  // ============================================================
  // 6. 面板位置与拖动
  // ============================================================

  function restorePanelPosition(
    panel
  ) {
    const saved =
      GM_getValue(
        PANEL_POSITION_KEY,
        null
      );

    if (
      !saved ||
      typeof saved !==
        "object"
    ) {
      return;
    }

    const left =
      Number(
        saved.left
      );

    const top =
      Number(
        saved.top
      );

    if (
      !Number.isFinite(
        left
      ) ||
      !Number.isFinite(
        top
      )
    ) {
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
      `${Math.min(
        Math.max(
          0,
          left
        ),
        maxLeft
      )}px`;

    panel.style.top =
      `${Math.min(
        Math.max(
          0,
          top
        ),
        maxTop
      )}px`;

    panel.style.right =
      "auto";
  }

  function makePanelDraggable(
    panel,
    handle
  ) {
    if (
      !panel ||
      !handle ||
      panel.__flyIncomeDragBound
    ) {
      return;
    }

    panel.__flyIncomeDragBound =
      true;

    handle.style.cursor =
      "move";

    handle.style.userSelect =
      "none";

    let dragging =
      false;

    let startX =
      0;

    let startY =
      0;

    let startLeft =
      0;

    let startTop =
      0;

    const onMouseMove =
      event => {
        if (!dragging) {
          return;
        }

        const nextLeft =
          startLeft +
          event.clientX -
          startX;

        const nextTop =
          startTop +
          event.clientY -
          startY;

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
          `${Math.min(
            Math.max(
              0,
              nextLeft
            ),
            maxLeft
          )}px`;

        panel.style.top =
          `${Math.min(
            Math.max(
              0,
              nextTop
            ),
            maxTop
          )}px`;

        panel.style.right =
          "auto";
      };

    const onMouseUp =
      () => {
        if (!dragging) {
          return;
        }

        dragging =
          false;

        document.removeEventListener(
          "mousemove",
          onMouseMove,
          true
        );

        document.removeEventListener(
          "mouseup",
          onMouseUp,
          true
        );

        GM_setValue(
          PANEL_POSITION_KEY,
          {
            left:
              parseFloat(
                panel.style.left
              ) ||
              panel.getBoundingClientRect()
                .left,

            top:
              parseFloat(
                panel.style.top
              ) ||
              panel.getBoundingClientRect()
                .top
          }
        );
      };

    handle.addEventListener(
      "mousedown",
      event => {
        if (
          event.button !==
            0 ||
          event.target.closest(
            "button,input,a"
          )
        ) {
          return;
        }

        const rect =
          panel.getBoundingClientRect();

        dragging =
          true;

        startX =
          event.clientX;

        startY =
          event.clientY;

        startLeft =
          rect.left;

        startTop =
          rect.top;

        panel.style.left =
          `${rect.left}px`;

        panel.style.top =
          `${rect.top}px`;

        panel.style.right =
          "auto";

        document.addEventListener(
          "mousemove",
          onMouseMove,
          true
        );

        document.addEventListener(
          "mouseup",
          onMouseUp,
          true
        );

        event.preventDefault();
      }
    );
  }

  // ============================================================
  // 7. UI
  // ============================================================

  function createPanel() {
    const existing =
      document.getElementById(
        PANEL_ID
      );

    if (existing) {
      return existing;
    }

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      PANEL_ID;

    Object.assign(
      panel.style,
      {
        position:
          "fixed",
        display:
          panelVisible
            ? "block"
            : "none",
        right:
          "24px",
        top:
          "140px",
        zIndex:
          "2147483646",
        width:
          "470px",
        maxWidth:
          "calc(100vw - 24px)",
        padding:
          "0",
        boxSizing:
          "border-box",
        border:
          "1px solid #dbe3ee",
        borderRadius:
          "12px",
        background:
          "#fff",
        boxShadow:
          "0 12px 34px rgba(31,55,88,.18)",
        fontFamily:
          "'Microsoft YaHei', 'PingFang SC', Arial, sans-serif",
        fontSize:
          "13px",
        color:
          "#253247",
        overflow:
          "hidden"
      }
    );

    panel.innerHTML = `
      <div
        id="__fly_report_drag_handle_v031"
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          padding:13px 15px;
          border-bottom:1px solid #e6edf5;
          background:linear-gradient(180deg,#f8fbff 0%,#f3f8fe 100%);
        "
      >
        <div style="display:flex;align-items:center;min-width:0;gap:10px;">
          <div style="
            width:34px;height:34px;flex:0 0 34px;
            display:flex;align-items:center;justify-content:center;
            border-radius:9px;background:#e8f2ff;color:#1677ff;
          ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M5 3.75h10.2L19 7.55v12.7H5V3.75Z"
                stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M15 3.9V8h3.9"
                stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M8 12h8M8 15.5h8"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </div>

          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:7px;">
              <strong style="
                color:#1e2d40;
                font-size:16px;
                line-height:1.2;
                font-weight:700;
              ">报表工具</strong>

              <span style="
                padding:1px 6px;
                border-radius:8px;
                background:#eaf1fa;
                color:#74859b;
                font-size:10px;
                line-height:16px;
                font-weight:700;
              ">v1.1.2</span>
            </div>

            <div style="
              margin-top:3px;
              color:#8291a5;
              font-size:10px;
              line-height:1.2;
            ">批量查询 · 单独查询 · 分别下载</div>
          </div>
        </div>

        <button
          id="__fly_report_close_v031"
          type="button"
          title="关闭报表面板"
          style="
            width:28px;height:28px;flex:0 0 28px;
            display:flex;align-items:center;justify-content:center;
            border:0;border-radius:7px;background:#edf2f7;color:#738196;
            font-size:16px;line-height:1;cursor:pointer;
          "
        >×</button>
      </div>

      <div style="padding:13px 15px 14px;background:#fff;">
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          margin-bottom:7px;
        ">
          <strong style="
            color:#56667b;
            font-size:11px;
            font-weight:700;
          ">常用区间</strong>

          <span style="
            color:#9aa7b8;
            font-size:10px;
          ">所有报表共用同一日期</span>
        </div>

        <div style="
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:7px;
        ">
          <button type="button" data-preset-range="today" class="__fly_report_preset_btn_v031">今天</button>
          <button type="button" data-preset-range="month" class="__fly_report_preset_btn_v031">本月</button>
          <button type="button" data-preset-range="quarter" class="__fly_report_preset_btn_v031">本季度</button>
          <button type="button" data-preset-range="year" class="__fly_report_preset_btn_v031">本年</button>
        </div>

        <div style="margin-top:12px;">
          <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            margin-bottom:7px;
          ">
            <strong style="
              color:#56667b;
              font-size:11px;
              font-weight:700;
            ">日期范围</strong>

            <span
              id="__fly_report_custom_hint_v031"
              style="
                display:none;
                color:#7d8ca0;
                font-size:10px;
              "
            >自定义区间</span>
          </div>

          <div style="
            display:grid;
            grid-template-columns:1fr auto 1fr;
            gap:8px;
            align-items:center;
          ">
            <input
              id="__fly_report_start_v031"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="开始日期"
              title="开始日期"
              class="__fly_report_date_input_v031"
            >

            <span style="
              color:#95a2b3;
              font-size:12px;
              font-weight:500;
            ">至</span>

            <input
              id="__fly_report_end_v031"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="结束日期"
              title="结束日期"
              class="__fly_report_date_input_v031"
            >
          </div>
        </div>

        <button
          id="__fly_report_query_v031"
          type="button"
          style="
            width:100%;
            height:38px;
            display:flex;
            align-items:center;
            justify-content:center;
            gap:7px;
            margin-top:12px;
            border:0;
            border-radius:8px;
            background:#1677ff;
            color:#fff;
            font-family:inherit;
            font-weight:700;
            font-size:13px;
            cursor:pointer;
            box-shadow:0 3px 9px rgba(22,119,255,.18);
          "
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="11" cy="11" r="6.2"
              stroke="currentColor" stroke-width="1.8"/>
            <path d="m16 16 4 4"
              stroke="currentColor" stroke-width="1.8"
              stroke-linecap="round"/>
          </svg>
          <span>查询已选报表（3）</span>
        </button>

        <div style="
          margin-top:14px;
          padding-top:12px;
          border-top:1px solid #edf1f6;
        ">
          <div style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            margin-bottom:8px;
          ">
            <strong style="
              color:#44556b;
              font-size:12px;
              font-weight:700;
            ">报表结果</strong>

            <span style="
              color:#9aa7b8;
              font-size:10px;
            ">勾选参与批量 · 未勾选可单独查询</span>
          </div>

          <div
            id="__fly_report_result_list_v031"
            style="
              display:flex;
              flex-direction:column;
              gap:8px;
            "
          ></div>
        </div>

        <div
          id="__fly_report_status_v031"
          style="
            margin-top:10px;
            padding:9px 10px;
            border:1px solid #edf1f6;
            border-radius:7px;
            background:#f7f9fc;
            color:#68778b;
            font-size:11px;
            line-height:1.5;
            word-break:break-all;
          "
        >勾选常用报表后可批量查询，也可单独查询任意一张。</div>
      </div>
    `;

    const style =
      document.createElement(
        "style"
      );

    style.textContent = `
      #${PANEL_ID} .__fly_report_preset_btn_v031 {
        height:32px;
        padding:0 8px;
        border:1px solid #d8e1ec;
        border-radius:7px;
        background:#fff;
        color:#526175;
        font-family:inherit;
        font-size:11px;
        font-weight:600;
        cursor:pointer;
        white-space:nowrap;
        transition:
          border-color .12s ease,
          background .12s ease,
          color .12s ease,
          box-shadow .12s ease;
      }

      #${PANEL_ID} .__fly_report_preset_btn_v031:hover {
        border-color:#9ec8ff;
        color:#126de0;
      }

      #${PANEL_ID} .__fly_report_preset_btn_v031.is-active {
        border-color:#8fc0ff;
        background:#eaf3ff;
        color:#126de0;
        font-weight:700;
        box-shadow:0 1px 3px rgba(22,119,255,.08);
      }

      #${PANEL_ID} .__fly_report_date_input_v031 {
        width:100%;
        min-width:0;
        height:35px;
        box-sizing:border-box;
        padding:0 10px;
        border:1px solid #d7e0eb;
        border-radius:7px;
        outline:none;
        background:#fff;
        color:#26374b;
        font-family:inherit;
        font-size:13px;
        font-weight:500;
        transition:
          border-color .12s ease,
          box-shadow .12s ease;
      }

      #${PANEL_ID} .__fly_report_date_input_v031:focus {
        border-color:#8fc0ff;
        box-shadow:0 0 0 2px rgba(22,119,255,.08);
      }

      #${PANEL_ID} .__fly_report_result_row_v031 {
        display:grid;
        grid-template-columns:18px 30px minmax(0,1fr) auto;
        gap:9px;
        align-items:center;
        min-height:58px;
        padding:9px 9px;
        box-sizing:border-box;
        border:1px solid #e6edf5;
        border-radius:9px;
        background:#fbfcfe;
      }

      #${PANEL_ID} .__fly_report_select_v110 {
        width:16px;
        height:16px;
        margin:0;
        accent-color:#1677ff;
        cursor:pointer;
      }

      #${PANEL_ID} .__fly_report_result_icon_v031 {
        width:30px;
        height:30px;
        display:flex;
        align-items:center;
        justify-content:center;
        border-radius:8px;
        background:#eaf3ff;
        color:#1677ff;
      }

      #${PANEL_ID} .__fly_report_result_title_v031 {
        color:#2f4056;
        font-size:13px;
        line-height:1.35;
        font-weight:700;
      }

      #${PANEL_ID} .__fly_report_result_detail_v031 {
        margin-top:4px;
        color:#6f7f93;
        font-size:11px;
        line-height:1.4;
      }

      #${PANEL_ID} .__fly_report_result_badge_v031 {
        display:inline-flex;
        align-items:center;
        margin-left:6px;
        padding:1px 6px;
        border-radius:8px;
        font-size:10px;
        line-height:17px;
        font-weight:700;
        vertical-align:1px;
      }

      #${PANEL_ID} .__fly_report_action_v031 {
        min-width:64px;
        height:30px;
        padding:0 9px;
        border:0;
        border-radius:7px;
        background:#1677ff;
        color:#fff;
        font-family:inherit;
        font-size:11px;
        font-weight:700;
        cursor:pointer;
        white-space:nowrap;
        box-shadow:0 2px 6px rgba(22,119,255,.15);
      }

      #${PANEL_ID} .__fly_report_action_v031.is-secondary {
        border:1px solid #f2bf74;
        background:#fff8ed;
        color:#bb6d00;
        box-shadow:none;
      }

      #${PANEL_ID} .__fly_report_actions_v024 {
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:6px;
        white-space:nowrap;
      }

      #${PANEL_ID} .__fly_report_status_link_v024 {
        height:28px;
        padding:0 8px;
        border:1px solid #bfd6f5;
        border-radius:6px;
        background:#f4f8fe;
        color:#3e6f9f;
        font-family:inherit;
        font-size:10px;
        font-weight:700;
        cursor:pointer;
        white-space:nowrap;
        box-shadow:none;
        transition:
          background .12s ease,
          border-color .12s ease,
          color .12s ease;
      }

      #${PANEL_ID} .__fly_report_status_link_v024:hover {
        border-color:#8fb9ee;
        background:#eaf3ff;
        color:#126de0;
      }

      #${PANEL_ID} .__fly_report_action_v031:disabled {
        border:1px solid #e0e6ee;
        background:#f2f5f8;
        color:#9aa7b8;
        cursor:not-allowed;
        box-shadow:none;
      }

      #${PANEL_ID} button:disabled {
        cursor:not-allowed !important;
      }
    `;

    panel.appendChild(
      style
    );

    document.body.appendChild(
      panel
    );

    const dragHandle =
      panel.querySelector(
        "#__fly_report_drag_handle_v031"
      );

    const closeButton =
      panel.querySelector(
        "#__fly_report_close_v031"
      );

    const presetButtons =
      Array.from(
        panel.querySelectorAll(
          "[data-preset-range]"
        )
      );

    const startInput =
      panel.querySelector(
        "#__fly_report_start_v031"
      );

    const endInput =
      panel.querySelector(
        "#__fly_report_end_v031"
      );

    const customHint =
      panel.querySelector(
        "#__fly_report_custom_hint_v031"
      );

    const queryButton =
      panel.querySelector(
        "#__fly_report_query_v031"
      );

    const resultList =
      panel.querySelector(
        "#__fly_report_result_list_v031"
      );

    const status =
      panel.querySelector(
        "#__fly_report_status_v031"
      );

    let activePreset =
      "";

    let queryBusy =
      false;

    let singleQueryBusy =
      false;

    const reportStates = {
      income:
        null,
      recon:
        null,
      addItems:
        null
    };

    const savedSelection =
      GM_getValue(
        REPORT_SELECTION_KEY,
        null
      );

    const selectedReports =
      new Set(
        Array.isArray(
          savedSelection
        )
          ? savedSelection.filter(
              key =>
                REPORT_ORDER.includes(
                  key
                )
            )
          : REPORT_ORDER
      );

    function setStatus(
      message,
      type =
        "normal"
    ) {
      status.textContent =
        message;

      status.style.borderColor =
        type === "success"
          ? "#ccebd2"
          : type === "error"
            ? "#ffd4d0"
            : "#edf1f6";

      status.style.background =
        type === "success"
          ? "#f3fbf4"
          : type === "error"
            ? "#fff5f4"
            : "#f7f9fc";

      status.style.color =
        type === "success"
          ? "#2f8f46"
          : type === "error"
            ? "#cf3f35"
            : "#68778b";
    }

    function getPresetRange(
      preset
    ) {
      const today =
        getChinaToday();

      switch (preset) {
        case "month":
          return {
            startDate:
              getChinaMonthStart(),
            endDate:
              today
          };

        case "quarter":
          return {
            startDate:
              getChinaQuarterStart(),
            endDate:
              today
          };

        case "year":
          return {
            startDate:
              getChinaYearStart(),
            endDate:
              today
          };

        case "today":
        default:
          return {
            startDate:
              today,
            endDate:
              today
          };
      }
    }

    function renderPresetState(
      preset
    ) {
      activePreset =
        preset || "";

      presetButtons.forEach(
        button => {
          button.classList.toggle(
            "is-active",
            cleanText(
              button.dataset
                .presetRange
            ) ===
              activePreset
          );
        }
      );

      customHint.style.display =
        activePreset
          ? "none"
          : "inline";
    }

    function setDateRange(
      startDate,
      endDate
    ) {
      startInput.value =
        parseFlexibleDate(
          startDate
        ) || "";

      endInput.value =
        parseFlexibleDate(
          endDate
        ) || "";
    }

    function normalizeDateInputs(
      showError =
        false
    ) {
      const startDate =
        parseFlexibleDate(
          startInput.value
        );

      const endDate =
        parseFlexibleDate(
          endInput.value
        );

      if (!startDate) {
        if (showError) {
          setStatus(
            "开始日期格式无法识别。",
            "error"
          );
        }
        return null;
      }

      if (!endDate) {
        if (showError) {
          setStatus(
            "结束日期格式无法识别。",
            "error"
          );
        }
        return null;
      }

      if (
        diffDays(
          startDate,
          endDate
        ) < 0
      ) {
        if (showError) {
          setStatus(
            "开始日期不能晚于结束日期。",
            "error"
          );
        }
        return null;
      }

      startInput.value =
        startDate;

      endInput.value =
        endDate;

      return {
        startDate,
        endDate
      };
    }

    function getTone(
      state
    ) {
      const kind =
        state?.kind ||
        "idle";

      if (
        kind === "ready"
      ) {
        return {
          text:
            "可导出",
          background:
            "#eaf8ee",
          color:
            "#2b9147"
        };
      }

      if (
        kind === "empty"
      ) {
        return {
          text:
            "无数据",
          background:
            "#f1f4f7",
          color:
            "#7e8b9c"
        };
      }

      if (
        kind === "error"
      ) {
        return {
          text:
            "失败",
          background:
            "#fff0ef",
          color:
            "#cf3f35"
        };
      }

      if (
        kind === "querying"
      ) {
        return {
          text:
            "查询中",
          background:
            "#eef5ff",
          color:
            "#1677ff"
        };
      }

      if (
        kind === "generating" ||
        kind === "preparing"
      ) {
        return {
          text:
            "生成中",
          background:
            "#fff6e7",
          color:
            "#b56a00"
        };
      }

      if (
        kind === "refresh"
      ) {
        return {
          text:
            "待获取",
          background:
            "#fff6e7",
          color:
            "#b56a00"
        };
      }

      return {
        text:
          "待查询",
        background:
          "#f1f4f7",
        color:
          "#8794a5"
      };
    }

    function getReportDetail(
      key,
      state
    ) {
      if (!state) {
        if (
          key === "addItems"
        ) {
          return "查询到数据后自动生成下载文件";
        }

        if (
          key === "recon"
        ) {
          return "单位代码为空 · 超1080天自动分段";
        }

        return "查询后可直接导出";
      }

      switch (
        state.kind
      ) {
        case "querying":
          return (
            state.detail ||
            "正在查询..."
          );

        case "preparing":
          return `${state.total || 0} 条数据 · 正在准备生成任务`;

        case "generating":
          return `${state.total || 0} 条数据 · 正在等待下载文件生成`;

        case "refresh":
          return `${state.total || 0} 条数据 · 15秒内尚未生成`;

        case "empty":
          return `${state.startDate} ～ ${state.endDate} · 0 条数据`;

        case "error":
          return (
            state.message ||
            "查询失败"
          );

        case "ready":
          if (
            key === "recon"
          ) {
            const segments =
              Array.isArray(
                state.segments
              )
                ? state.segments
                : [];

            const totalRows =
              segments.reduce(
                (
                  total,
                  item
                ) =>
                  total +
                  Number(
                    item.total || 0
                  ),
                0
              );

            return (
              `${state.startDate} ～ ${state.endDate} · ${totalRows} 条数据` +
              (
                segments.length > 1
                  ? ` · ${segments.length} 个有效时段`
                  : ""
              )
            );
          }

          return `${state.startDate} ～ ${state.endDate} · ${state.total || 0} 条数据`;

        default:
          return "等待处理...";
      }
    }

    function getActionConfig(
      key,
      state
    ) {
      if (!state) {
        return {
          text:
            "查询",
          disabled:
            false,
          action:
            `${key}-query`
        };
      }

      if (
        state.kind ===
        "ready"
      ) {
        return {
          text:
            key === "recon" &&
            Array.isArray(
              state.segments
            ) &&
            state.segments.length > 1
              ? `导出(${state.segments.length})`
              : "导出",
          disabled:
            false,
          action:
            `${key}-export`
        };
      }

      if (
        key === "addItems" &&
        state.kind ===
          "refresh"
      ) {
        return {
          text:
            "重新获取",
          disabled:
            false,
          action:
            "addItems-refresh",
          secondary:
            true
        };
      }

      if (
        state.kind ===
          "querying"
      ) {
        return {
          text:
            "查询中...",
          disabled:
            true,
          action:
            ""
        };
      }

      if (
        state.kind ===
          "preparing" ||
        state.kind ===
          "generating"
      ) {
        return {
          text:
            "生成中...",
          disabled:
            true,
          action:
            ""
        };
      }

      if (
        state.kind ===
          "empty"
      ) {
        return {
          text:
            "重查",
          disabled:
            false,
          action:
            `${key}-query`,
          secondary:
            true
        };
      }

      if (
        state.kind ===
          "error"
      ) {
        return {
          text:
            "重试",
          disabled:
            false,
          action:
            `${key}-query`,
          secondary:
            true
        };
      }

      return {
        text:
          "查询",
        disabled:
          false,
        action:
          `${key}-query`
      };
    }

    function renderResults() {
      const keys =
        REPORT_ORDER;

      resultList.innerHTML =
        keys
          .map(
            key => {
              const state =
                reportStates[
                  key
                ];

              const tone =
                getTone(
                  state
                );

              const action =
                getActionConfig(
                  key,
                  state
                );

              const iconPath =
                key === "income"
                  ? '<path d="M6 4h12v16H6V4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
                  : key === "recon"
                    ? '<path d="M5 5h14v14H5V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m8 12 2.4 2.4L16 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
                    : '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.7"/>';

              return `
                <div
                  class="__fly_report_result_row_v031"
                  data-result-report="${key}"
                >
                  <input
                    type="checkbox"
                    class="__fly_report_select_v110"
                    data-report-select="${key}"
                    title="勾选后参与批量查询"
                    ${selectedReports.has(key) ? "checked" : ""}
                  >

                  <div class="__fly_report_result_icon_v031">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                      xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                      ${iconPath}
                    </svg>
                  </div>

                  <div style="min-width:0;">
                    <div class="__fly_report_result_title_v031">
                      ${REPORT_MODULES[key].name}
                      <span
                        class="__fly_report_result_badge_v031"
                        style="
                          background:${tone.background};
                          color:${tone.color};
                        "
                      >${tone.text}</span>
                    </div>

                    <div class="__fly_report_result_detail_v031">
                      ${getReportDetail(
                        key,
                        state
                      )}
                    </div>
                  </div>

                  <div class="__fly_report_actions_v024">
                    ${
                      key === "addItems"
                        ? `
                          <button
                            type="button"
                            class="__fly_report_status_link_v024"
                            data-action="addItems-status"
                            title="打开Fly下载中心，查看客户加选项目报表任务状态"
                          >查看状态</button>
                        `
                        : ""
                    }

                    <button
                      type="button"
                      class="__fly_report_action_v031${action.secondary ? " is-secondary" : ""}"
                      ${action.action ? `data-action="${action.action}"` : ""}
                      ${action.disabled ? "disabled" : ""}
                    >${action.text}</button>
                  </div>
                </div>
              `;
            }
          )
          .join("");

      bindResultActions();
      updateBatchButton();
    }

    function invalidateAllStates() {
      reportStates.income =
        null;

      reportStates.recon =
        null;

      reportStates.addItems =
        null;

      renderResults();
    }

    function applyPreset(
      preset,
      {
        remember =
          true,
        invalidate =
          true
      } = {}
    ) {
      const allowed = [
        "today",
        "month",
        "quarter",
        "year"
      ];

      const normalized =
        allowed.includes(
          preset
        )
          ? preset
          : "today";

      const range =
        getPresetRange(
          normalized
        );

      setDateRange(
        range.startDate,
        range.endDate
      );

      renderPresetState(
        normalized
      );

      if (remember) {
        GM_setValue(
          PRESET_RANGE_KEY,
          normalized
        );
      }

      if (invalidate) {
        invalidateAllStates();
        setStatus(
          "日期条件已变更，请重新查询已选报表或单独查询。"
        );
      }
    }

    function markCustomRange() {
      if (!activePreset) {
        return;
      }

      renderPresetState(
        ""
      );
    }

    function getSelectedReportKeys() {
      return REPORT_ORDER.filter(
        key =>
          selectedReports.has(
            key
          )
      );
    }

    function saveSelectedReports() {
      GM_setValue(
        REPORT_SELECTION_KEY,
        getSelectedReportKeys()
      );
    }

    function updateBatchButton() {
      const count =
        getSelectedReportKeys()
          .length;

      const label =
        queryButton.querySelector(
          "span"
        );

      if (
        !queryBusy
      ) {
        if (label) {
          label.textContent =
            count > 0
              ? `查询已选报表（${count}）`
              : "请选择报表";
        }

        queryButton.disabled =
          count === 0 ||
          singleQueryBusy;

        queryButton.style.opacity =
          queryButton.disabled
            ? ".58"
            : "1";

        queryButton.style.cursor =
          queryButton.disabled
            ? "not-allowed"
            : "pointer";
      }
    }

    function setQueryProgress(
      index,
      total,
      name
    ) {
      queryBusy =
        true;

      queryButton.disabled =
        true;

      queryButton.style.opacity =
        ".72";

      queryButton.style.cursor =
        "not-allowed";

      const label =
        queryButton.querySelector(
          "span"
        );

      if (label) {
        label.textContent =
          `查询中 ${index}/${total} · ${name}`;
      }
    }

    function finishQueryBusy() {
      queryBusy =
        false;

      updateBatchButton();
    }

    async function runIncomeQuery(
      dates
    ) {
      reportStates.income = {
        kind:
          "querying",
        startDate:
          dates.startDate,
        endDate:
          dates.endDate,
        detail:
          "正在查询收入确认表..."
      };

      renderResults();

      try {
        const onRetry =
          createRetryHandler(
            setStatus
          );

        const result =
          await withFlyTokenRetry(
            async token => {
              const body =
                buildIncomeBody(
                  token,
                  dates.startDate,
                  dates.endDate
                );

              return queryIncomeReport(
                token,
                body,
                onRetry
              );
            },
            setStatus
          );

        reportStates.income =
          result.total > 0
            ? {
                kind:
                  "ready",
                startDate:
                  dates.startDate,
                endDate:
                  dates.endDate,
                total:
                  result.total
              }
            : {
                kind:
                  "empty",
                startDate:
                  dates.startDate,
                endDate:
                  dates.endDate,
                total:
                  0
              };

        renderResults();

        return true;
      } catch (error) {
        console.error(
          "[收入确认表-查询]",
          error
        );

        reportStates.income = {
          kind:
            "error",
          startDate:
            dates.startDate,
          endDate:
            dates.endDate,
          message:
            error?.message ||
            String(error)
        };

        renderResults();

        return false;
      }
    }

    async function runReconQuery(
      dates
    ) {
      const periods =
        splitDateRange(
          dates.startDate,
          dates.endDate
        );

      reportStates.recon = {
        kind:
          "querying",
        startDate:
          dates.startDate,
        endDate:
          dates.endDate,
        detail:
          periods.length > 1
            ? `正在查询 1/${periods.length} 个时段...`
            : "正在查询体检对账报表..."
      };

      renderResults();

      const segments = [];

      try {
        const onRetry =
          createRetryHandler(
            setStatus
          );

        await withFlyTokenRetry(
          async token => {
            for (
              let index = 0;
              index <
                periods.length;
              index += 1
            ) {
              const period =
                periods[
                  index
                ];

              reportStates.recon = {
                kind:
                  "querying",
                startDate:
                  dates.startDate,
                endDate:
                  dates.endDate,
                detail:
                  periods.length > 1
                    ? `正在查询 ${index + 1}/${periods.length}：${period.startDate} ～ ${period.endDate}`
                    : `正在查询：${period.startDate} ～ ${period.endDate}`
              };

              renderResults();

              const body =
                buildReconBody(
                  period.startDate,
                  period.endDate
                );

              const result =
                await queryReconPeriod(
                  token,
                  body,
                  onRetry
                );

              if (
                result.total > 0
              ) {
                segments.push({
                  startDate:
                    period.startDate,
                  endDate:
                    period.endDate,
                  total:
                    result.total
                });
              }

              if (
                index <
                periods.length - 1
              ) {
                await sleep(
                  REPORT_SEGMENT_GAP_MS
                );
              }
            }
          },
          setStatus
        );

        reportStates.recon =
          segments.length > 0
            ? {
                kind:
                  "ready",
                startDate:
                  dates.startDate,
                endDate:
                  dates.endDate,
                segments
              }
            : {
                kind:
                  "empty",
                startDate:
                  dates.startDate,
                endDate:
                  dates.endDate,
                segments:
                  []
              };

        renderResults();

        return true;
      } catch (error) {
        console.error(
          "[体检对账报表-查询]",
          error
        );

        reportStates.recon = {
          kind:
            "error",
          startDate:
            dates.startDate,
          endDate:
            dates.endDate,
          message:
            error?.message ||
            String(error)
        };

        renderResults();

        return false;
      }
    }

    async function pollAddItemsUntilReady(
      state
    ) {
      const deadline =
        Date.now() +
        ADD_ITEMS_WAIT_MS;

      while (
        Date.now() <
        deadline
      ) {
        await sleep(
          ADD_ITEMS_POLL_INTERVAL_MS
        );

        if (
          reportStates.addItems !==
          state
        ) {
          return;
        }

        try {
          const rows =
            await withFlyTokenRetry(
              token =>
                queryDownloadList(
                  token,
                  createRetryHandler(
                    setStatus
                  )
                ),
              setStatus
            );

          const task =
            findAddItemsNewTask(
              rows,
              state
            );

          if (task) {
            state.taskId =
              cleanText(
                task.id
              );

            if (
              isAddItemsTaskReady(
                task
              )
            ) {
              state.kind =
                "ready";

              state.exportUrl =
                cleanText(
                  task.exportUrl
                );

              renderResults();

              setStatus(
                "✓ 客户加选项目下载文件已生成，可以导出。",
                "success"
              );

              return;
            }
          }
        } catch (error) {
          console.warn(
            "[客户加选项目-轮询下载中心]",
            error
          );
        }
      }

      if (
        reportStates.addItems ===
        state &&
        state.kind ===
          "generating"
      ) {
        state.kind =
          "refresh";

        renderResults();

        setStatus(
          "客户加选项目文件15秒内尚未生成，可点击“重新获取”继续检查。"
        );
      }
    }

    async function runAddItemsQuery(
      dates
    ) {
      reportStates.addItems = {
        kind:
          "querying",
        startDate:
          dates.startDate,
        endDate:
          dates.endDate,
        detail:
          "正在查询客户加选项目报表..."
      };

      renderResults();

      try {
        const onRetry =
          createRetryHandler(
            setStatus
          );

        const queryResult =
          await withFlyTokenRetry(
            async token => {
              const body =
                buildAddItemsBody(
                  token,
                  dates.startDate,
                  dates.endDate
                );

              const result =
                await queryAddItemsReport(
                  token,
                  body,
                  onRetry
                );

              return {
                result,
                uid:
                  getTokenUserInfo(
                    token
                  ).uid
              };
            },
            setStatus
          );

        if (
          queryResult.result.total <=
          0
        ) {
          reportStates.addItems = {
            kind:
              "empty",
            startDate:
              dates.startDate,
            endDate:
              dates.endDate,
            total:
              0
          };

          renderResults();

          return true;
        }

        reportStates.addItems = {
          kind:
            "preparing",
          startDate:
            dates.startDate,
          endDate:
            dates.endDate,
          total:
            queryResult.result.total,
          uid:
            queryResult.uid,
          baselineId:
            0,
          taskId:
            "",
          exportUrl:
            ""
        };

        renderResults();

        // 稍作停顿，避免查询接口与下载中心接口紧挨着触发。
        await sleep(
          350
        );

        const baselineRows =
          await withFlyTokenRetry(
            token =>
              queryDownloadList(
                token,
                onRetry
              ),
            setStatus
          );

        const baselineId =
          getAddItemsBaselineId(
            baselineRows,
            queryResult.uid
          );

        const state = {
          kind:
            "generating",
          startDate:
            dates.startDate,
          endDate:
            dates.endDate,
          total:
            queryResult.result.total,
          uid:
            queryResult.uid,
          baselineId,
          taskId:
            "",
          exportUrl:
            ""
        };

        reportStates.addItems =
          state;

        renderResults();

        await sleep(
          350
        );

        let submissionUncertain =
          false;

        try {
          await withFlyTokenRetry(
            token => {
              const body =
                buildAddItemsBody(
                  token,
                  dates.startDate,
                  dates.endDate
                );

              return submitAddItemsExportOnce(
                token,
                body
              );
            },
            setStatus
          );
        } catch (error) {
          if (
            error?.networkError ||
            /超时|网络/i.test(
              cleanText(
                error?.message
              )
            )
          ) {
            submissionUncertain =
              true;

            console.warn(
              "[客户加选项目-提交结果未确认]",
              error
            );
          } else {
            reportStates.addItems = {
              kind:
                "error",
              startDate:
                dates.startDate,
              endDate:
                dates.endDate,
              message:
                error?.message ||
                String(error)
            };

            renderResults();

            return false;
          }
        }

        if (
          reportStates.addItems !==
          state
        ) {
          return false;
        }

        if (
          submissionUncertain
        ) {
          setStatus(
            "客户加选项目导出任务提交结果未确认，为避免重复提交，将直接检查下载中心。"
          );
        }

        void pollAddItemsUntilReady(
          state
        );

        return true;
      } catch (error) {
        console.error(
          "[客户加选项目报表-查询]",
          error
        );

        reportStates.addItems = {
          kind:
            "error",
          startDate:
            dates.startDate,
          endDate:
            dates.endDate,
          message:
            error?.message ||
            String(error)
        };

        renderResults();

        return false;
      }
    }

    async function exportIncomeState(
      button
    ) {
      const state =
        reportStates.income;

      if (
        !state ||
        state.kind !==
          "ready"
      ) {
        return;
      }

      button.disabled =
        true;

      button.textContent =
        "导出中...";

      try {
        await withFlyTokenRetry(
          async token => {
            const body =
              buildIncomeBody(
                token,
                state.startDate,
                state.endDate
              );

            return exportIncomeReport(
              token,
              body,
              {
                startDate:
                  state.startDate,
                endDate:
                  state.endDate,
                onRetry:
                  createRetryHandler(
                    setStatus
                  )
              }
            );
          },
          setStatus
        );

        setStatus(
          "✓ 收入确认表已触发下载。",
          "success"
        );
      } catch (error) {
        console.error(
          "[收入确认表-导出]",
          error
        );

        setStatus(
          error?.message ||
          String(error),
          "error"
        );
      } finally {
        renderResults();
      }
    }

    async function exportReconState(
      button
    ) {
      const state =
        reportStates.recon;

      if (
        !state ||
        state.kind !==
          "ready" ||
        !Array.isArray(
          state.segments
        ) ||
        state.segments.length ===
          0
      ) {
        return;
      }

      button.disabled =
        true;

      button.textContent =
        state.segments.length > 1
          ? `导出中 0/${state.segments.length}`
          : "导出中...";

      try {
        await withFlyTokenRetry(
          async token => {
            for (
              let index = 0;
              index <
                state.segments.length;
              index += 1
            ) {
              const segment =
                state.segments[
                  index
                ];

              button.textContent =
                state.segments.length > 1
                  ? `导出中 ${index + 1}/${state.segments.length}`
                  : "导出中...";

              const body =
                buildReconBody(
                  segment.startDate,
                  segment.endDate
                );

              await exportReconPeriod(
                token,
                body,
                {
                  startDate:
                    segment.startDate,
                  endDate:
                    segment.endDate,
                  onRetry:
                    createRetryHandler(
                      setStatus
                    )
                }
              );

              if (
                index <
                state.segments.length - 1
              ) {
                await sleep(
                  250
                );
              }
            }
          },
          setStatus
        );

        setStatus(
          state.segments.length > 1
            ? `✓ 体检对账报表已触发 ${state.segments.length} 个分段下载。`
            : "✓ 体检对账报表已触发下载。",
          "success"
        );
      } catch (error) {
        console.error(
          "[体检对账报表-导出]",
          error
        );

        setStatus(
          error?.message ||
          String(error),
          "error"
        );
      } finally {
        renderResults();
      }
    }

    async function refreshAddItemsState(
      button
    ) {
      const state =
        reportStates.addItems;

      if (
        !state ||
        state.kind !==
          "refresh"
      ) {
        return;
      }

      button.disabled =
        true;

      button.textContent =
        "获取中...";

      try {
        const rows =
          await withFlyTokenRetry(
            token =>
              queryDownloadList(
                token,
                createRetryHandler(
                  setStatus
                )
              ),
            setStatus
          );

        const task =
          findAddItemsNewTask(
            rows,
            state
          );

        if (
          task &&
          isAddItemsTaskReady(
            task
          )
        ) {
          state.kind =
            "ready";

          state.taskId =
            cleanText(
              task.id
            );

          state.exportUrl =
            cleanText(
              task.exportUrl
            );

          renderResults();

          setStatus(
            "✓ 客户加选项目文件已生成，可以导出。",
            "success"
          );

          return;
        }

        renderResults();

        setStatus(
          "客户加选项目文件仍在生成中，请稍后再次点击“重新获取”。"
        );
      } catch (error) {
        console.error(
          "[客户加选项目-重新获取]",
          error
        );

        renderResults();

        setStatus(
          error?.message ||
          String(error),
          "error"
        );
      }
    }

    function exportAddItemsState() {
      const state =
        reportStates.addItems;

      if (
        !state ||
        state.kind !==
          "ready" ||
        !cleanText(
          state.exportUrl
        )
      ) {
        setStatus(
          "客户加选项目下载链接尚未准备完成。",
          "error"
        );

        return;
      }

      try {
        triggerSignedUrlDownload(
          state.exportUrl
        );

        setStatus(
          "✓ 客户加选项目报表已触发下载。",
          "success"
        );
      } catch (error) {
        setStatus(
          error?.message ||
          String(error),
          "error"
        );
      }
    }

    function openAddItemsDownloadCenter() {
      const opened =
        window.open(
          ADD_ITEMS_DOWNLOAD_CENTER_URL,
          "_blank"
        );

      try {
        if (opened) {
          opened.opener =
            null;
        }
      } catch {}

      setStatus(
        "已打开Fly下载中心，可查看客户加选项目报表任务是否生成成功。"
      );
    }

    async function runReportQueryByKey(
      key,
      dates
    ) {
      switch (key) {
        case "income":
          return runIncomeQuery(
            dates
          );

        case "recon":
          return runReconQuery(
            dates
          );

        case "addItems":
          if (
            reportStates.addItems &&
            (
              reportStates.addItems.kind ===
                "preparing" ||
              reportStates.addItems.kind ===
                "generating"
            )
          ) {
            setStatus(
              "客户加选项目报表仍在生成中，为避免重复提交任务，请等待完成或使用“重新获取”。"
            );

            return true;
          }

          return runAddItemsQuery(
            dates
          );

        default:
          throw new Error(
            `未知报表模块：${key}`
          );
      }
    }

    async function querySingleReport(
      key
    ) {
      if (
        queryBusy ||
        singleQueryBusy
      ) {
        setStatus(
          "当前已有查询正在进行，请稍后再操作。"
        );
        return;
      }

      const dates =
        normalizeDateInputs(
          true
        );

      if (!dates) {
        return;
      }

      singleQueryBusy =
        true;

      updateBatchButton();

      try {
        setStatus(
          `正在单独查询：${REPORT_MODULES[key].name} ${dates.startDate} ～ ${dates.endDate}`
        );

        const ok =
          await runReportQueryByKey(
            key,
            dates
          );

        const state =
          reportStates[key];

        if (!ok) {
          setStatus(
            `${REPORT_MODULES[key].name}查询失败，请查看该行状态。`,
            "error"
          );
        } else if (
          key === "addItems" &&
          state &&
          (
            state.kind ===
              "preparing" ||
            state.kind ===
              "generating"
          )
        ) {
          setStatus(
            "✓ 客户加选项目查询完成，下载文件正在后台生成。",
            "success"
          );
        } else {
          setStatus(
            `✓ ${REPORT_MODULES[key].name}查询完成。`,
            "success"
          );
        }
      } finally {
        singleQueryBusy =
          false;

        updateBatchButton();
      }
    }

    function bindResultActions() {
      resultList
        .querySelectorAll(
          "[data-report-select]"
        )
        .forEach(
          checkbox => {
            checkbox.addEventListener(
              "change",
              () => {
                const key =
                  cleanText(
                    checkbox.dataset
                      .reportSelect
                  );

                if (
                  checkbox.checked
                ) {
                  selectedReports.add(
                    key
                  );
                } else {
                  selectedReports.delete(
                    key
                  );
                }

                saveSelectedReports();
                updateBatchButton();
              }
            );
          }
        );

      REPORT_ORDER.forEach(
        key => {
          resultList
            .querySelector(
              `[data-action="${key}-query"]`
            )
            ?.addEventListener(
              "click",
              () =>
                querySingleReport(
                  key
                )
            );
        }
      );

      resultList
        .querySelector(
          '[data-action="addItems-status"]'
        )
        ?.addEventListener(
          "click",
          openAddItemsDownloadCenter
        );

      resultList
        .querySelector(
          '[data-action="income-export"]'
        )
        ?.addEventListener(
          "click",
          event =>
            exportIncomeState(
              event.currentTarget
            )
        );

      resultList
        .querySelector(
          '[data-action="recon-export"]'
        )
        ?.addEventListener(
          "click",
          event =>
            exportReconState(
              event.currentTarget
            )
        );

      resultList
        .querySelector(
          '[data-action="addItems-export"]'
        )
        ?.addEventListener(
          "click",
          exportAddItemsState
        );

      resultList
        .querySelector(
          '[data-action="addItems-refresh"]'
        )
        ?.addEventListener(
          "click",
          event =>
            refreshAddItemsState(
              event.currentTarget
            )
        );
    }

    async function querySelectedReports() {
      if (
        queryBusy ||
        singleQueryBusy
      ) {
        return;
      }

      const selectedKeys =
        getSelectedReportKeys();

      if (
        selectedKeys.length ===
        0
      ) {
        setStatus(
          "请先勾选至少一张需要批量查询的报表。"
        );
        return;
      }

      const dates =
        normalizeDateInputs(
          true
        );

      if (!dates) {
        return;
      }

      // 只清空本次参与批量查询的报表，未勾选报表保留现有结果。
      selectedKeys.forEach(
        key => {
          if (
            key === "addItems" &&
            reportStates.addItems &&
            (
              reportStates.addItems.kind ===
                "preparing" ||
              reportStates.addItems.kind ===
                "generating"
            )
          ) {
            return;
          }

          reportStates[key] =
            null;
        }
      );

      renderResults();

      let okCount =
        0;

      let errorCount =
        0;

      try {
        for (
          let index = 0;
          index <
            selectedKeys.length;
          index += 1
        ) {
          const key =
            selectedKeys[
              index
            ];

          setQueryProgress(
            index + 1,
            selectedKeys.length,
            REPORT_MODULES[key].shortName
          );

          setStatus(
            `正在查询 ${index + 1}/${selectedKeys.length}：${REPORT_MODULES[key].name}...`
          );

          const ok =
            await runReportQueryByKey(
              key,
              dates
            );

          if (ok) {
            okCount += 1;
          } else {
            errorCount += 1;
          }

          if (
            index <
            selectedKeys.length - 1
          ) {
            await sleep(
              REPORT_QUERY_GAP_MS
            );
          }
        }

        const addState =
          reportStates.addItems;

        if (
          errorCount === 0
        ) {
          if (
            selectedKeys.includes(
              "addItems"
            ) &&
            addState &&
            (
              addState.kind ===
                "generating" ||
              addState.kind ===
                "preparing"
            )
          ) {
            setStatus(
              `✓ 已完成 ${okCount} 张已选报表查询；客户加选项目下载文件正在后台生成。`,
              "success"
            );
          } else {
            setStatus(
              `✓ 已完成 ${okCount} 张已选报表查询。`,
              "success"
            );
          }
        } else {
          setStatus(
            `批量查询结束：${okCount} 张完成，${errorCount} 张失败。可查看各报表行状态。`,
            "error"
          );
        }
      } finally {
        finishQueryBusy();
      }
    }

    presetButtons.forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            applyPreset(
              cleanText(
                button.dataset
                  .presetRange
              )
            );
          }
        );
      }
    );

    [
      startInput,
      endInput
    ].forEach(
      input => {
        input.addEventListener(
          "input",
          () => {
            markCustomRange();
            invalidateAllStates();
            setStatus(
              "日期条件已变更，请重新查询已选报表或单独查询。"
            );
          }
        );

        input.addEventListener(
          "blur",
          () => {
            const normalized =
              parseFlexibleDate(
                input.value
              );

            if (normalized) {
              input.value =
                normalized;
            } else if (
              cleanText(
                input.value
              )
            ) {
              setStatus(
                "日期格式无法识别。",
                "error"
              );
            }
          }
        );

        input.addEventListener(
          "keydown",
          event => {
            if (
              event.key ===
              "Enter"
            ) {
              event.preventDefault();
              input.blur();
            }
          }
        );
      }
    );

    queryButton.addEventListener(
      "click",
      querySelectedReports
    );

    closeButton.addEventListener(
      "mouseenter",
      () => {
        closeButton.style.background =
          "#e3eaf2";

        closeButton.style.color =
          "#4f6074";
      }
    );

    closeButton.addEventListener(
      "mouseleave",
      () => {
        closeButton.style.background =
          "#edf2f7";

        closeButton.style.color =
          "#738196";
      }
    );

    closeButton.addEventListener(
      "click",
      () => {
        setPanelVisible(
          false
        );
      }
    );

    const savedPreset =
      cleanText(
        GM_getValue(
          PRESET_RANGE_KEY,
          "today"
        )
      );

    applyPreset(
      savedPreset,
      {
        remember:
          false,
        invalidate:
          false
      }
    );

    renderResults();

    setStatus(
      "勾选常用报表后可批量查询，也可单独查询任意一张。"
    );

    makePanelDraggable(
      panel,
      dragHandle
    );

    setTimeout(
      () =>
        restorePanelPosition(
          panel
        ),
      0
    );

    return panel;
  }

  // ============================================================
  // 8. 全局报表入口
  // ============================================================

  function updateGlobalSwitchState() {
    const button =
      document.getElementById(
        GLOBAL_SWITCH_ID
      );

    if (!button) {
      return;
    }

    button.classList.toggle(
      "is-active",
      panelVisible
    );

    button.title =
      panelVisible
        ? "关闭报表工具"
        : "打开报表工具";
  }

  function setPanelVisible(
    visible
  ) {
    panelVisible =
      Boolean(
        visible
      );

    const panel =
      document.getElementById(
        PANEL_ID
      ) ||
      createPanel();

    if (panel) {
      panel.style.display =
        panelVisible
          ? "block"
          : "none";

      if (
        panelVisible
      ) {
        setTimeout(
          () =>
            restorePanelPosition(
              panel
            ),
          0
        );
      }
    }

    updateGlobalSwitchState();
  }

  function ensureGlobalSwitchStyle() {
    let style =
      document.getElementById(
        GLOBAL_SWITCH_STYLE_ID
      );

    if (style) {
      return style;
    }

    style =
      document.createElement(
        "style"
      );

    style.id =
      GLOBAL_SWITCH_STYLE_ID;

    style.textContent = `
      /*
       * SOA顶部独立工具组。
       * 只占用顶部导航最右侧的独立区域，不参与原生Ant Menu菜单项排序。
       * 卡类汇总脚本即使单独运行也不依赖本容器；当本脚本存在时仅把它的slot吸附进来。
       */
      #${TOP_TOOL_GROUP_ID} {
        display:flex;
        align-items:center;
        justify-content:flex-end;
        align-self:stretch;
        flex:0 0 auto;
        gap:9px;
        margin-left:18px;
        margin-right:18px;
        padding:0;
        box-sizing:border-box;
        position:relative;
        z-index:3;
        white-space:nowrap;
      }

      #${GLOBAL_SWITCH_SLOT_ID} {
        display:flex;
        align-items:center;
        justify-content:center;
        flex:0 0 auto;
        margin:0;
        padding:0;
        box-sizing:border-box;
      }

      /*
       * 卡类汇总自身slot原本带左右margin。
       * 被收进共享工具组后只归零slot外边距，按钮本身的样式完全不修改。
       */
      #${TOP_TOOL_GROUP_ID} > [id^="__hlj_card_summary_detect_"][id$="_switch_slot"] {
        margin-left:0 !important;
        margin-right:0 !important;
        padding-left:0 !important;
        padding-right:0 !important;
        flex:0 0 auto !important;
      }

      #${GLOBAL_SWITCH_ID} {
        min-width:104px;
        height:31px;
        padding:0 13px;
        box-sizing:border-box;
        border:1px solid #77b993;
        border-radius:7px;
        background:linear-gradient(180deg,#f1fbf5 0%,#dff3e7 100%);
        color:#205d3b;
        font:700 14px/29px "Microsoft YaHei","PingFang SC",Arial,sans-serif;
        letter-spacing:.1px;
        white-space:nowrap;
        cursor:pointer;
        user-select:none;
        outline:none;
        box-shadow:
          0 1px 2px rgba(36,95,60,.10),
          inset 0 1px 0 rgba(255,255,255,.78);
        transition:
          background .12s ease,
          border-color .12s ease,
          color .12s ease,
          box-shadow .12s ease,
          transform .08s ease;
      }

      #${GLOBAL_SWITCH_ID}:hover {
        background:linear-gradient(180deg,#e9f8ef 0%,#d3ecdd 100%);
        border-color:#5ea97e;
        color:#174f31;
        box-shadow:
          0 2px 6px rgba(36,95,60,.16),
          inset 0 1px 0 rgba(255,255,255,.84);
      }

      #${GLOBAL_SWITCH_ID}:active {
        transform:translateY(1px);
        box-shadow:
          0 1px 2px rgba(36,95,60,.12),
          inset 0 1px 2px rgba(36,95,60,.10);
      }

      #${GLOBAL_SWITCH_ID}.is-active {
        background:linear-gradient(180deg,#def3e7 0%,#c8e8d5 100%);
        border-color:#4c9a6d;
        color:#154c2d;
        box-shadow:
          0 2px 6px rgba(36,95,60,.18),
          inset 0 1px 0 rgba(255,255,255,.78);
      }

      @media (max-width:1100px) {
        #${TOP_TOOL_GROUP_ID} {
          gap:7px;
          margin-left:12px;
          margin-right:12px;
        }

        #${GLOBAL_SWITCH_ID} {
          min-width:96px;
          padding:0 11px;
          font-size:13px;
        }
      }
    `;

    (
      document.head ||
      document.documentElement
    ).appendChild(
      style
    );

    return style;
  }

  function findCardSummarySwitchSlots() {
    return Array.from(
      document.querySelectorAll(
        '[id^="__hlj_card_summary_detect_"][id$="_switch_slot"]'
      )
    ).filter(
      slot =>
        slot &&
        slot.isConnected
    );
  }

  function ensureTopToolGroup() {
    const headerInner =
      document.querySelector(
        "#layout-header .header-inner"
      );

    if (!headerInner) {
      return null;
    }

    let group =
      document.getElementById(
        TOP_TOOL_GROUP_ID
      );

    if (!group) {
      group =
        document.createElement(
          "div"
        );

      group.id =
        TOP_TOOL_GROUP_ID;
    }

    if (
      group.parentElement !==
      headerInner
    ) {
      const userBox =
        headerInner.querySelector(
          ":scope > .user"
        );

      if (userBox) {
        headerInner.insertBefore(
          group,
          userBox
        );
      } else {
        headerInner.appendChild(
          group
        );
      }
    }

    return group;
  }

  function syncTopToolGroup(
    button =
      document.getElementById(
        GLOBAL_SWITCH_ID
      )
  ) {
    if (!button) {
      return false;
    }

    const group =
      ensureTopToolGroup();

    if (!group) {
      return false;
    }

    let reportSlot =
      document.getElementById(
        GLOBAL_SWITCH_SLOT_ID
      );

    if (!reportSlot) {
      reportSlot =
        document.createElement(
          "div"
        );

      reportSlot.id =
        GLOBAL_SWITCH_SLOT_ID;
    }

    if (
      button.parentElement !==
      reportSlot
    ) {
      reportSlot.appendChild(
        button
      );
    }

    /*
     * 固定顺序：
     * 报表工具在左，卡类汇总在右。
     * 只移动卡类汇总的slot，不改它的按钮、事件、面板或显示逻辑。
     */
    if (
      reportSlot.parentElement !==
      group
    ) {
      group.insertBefore(
        reportSlot,
        group.firstChild
      );
    } else if (
      group.firstElementChild !==
      reportSlot
    ) {
      group.insertBefore(
        reportSlot,
        group.firstChild
      );
    }

    for (
      const cardSlot
      of findCardSummarySwitchSlots()
    ) {
      if (
        cardSlot ===
        reportSlot
      ) {
        continue;
      }

      if (
        cardSlot.parentElement !==
        group
      ) {
        group.appendChild(
          cardSlot
        );
      }
    }

    return true;
  }

  function getSoaRouteKey() {
    const hashPath =
      cleanText(
        location.hash
          .split("?")[0]
      ) ||
      "#/";

    const normalizedHash =
      hashPath
        .split("/")
        .map(
          segment => {
            if (
              /^\d{6,}$/.test(
                segment
              ) ||
              /^[A-Za-z0-9_-]{18,}$/.test(
                segment
              )
            ) {
              return ":id";
            }

            return segment;
          }
        )
        .join("/");

    return (
      `${location.pathname}|${normalizedHash}`
    );
  }

  /*
   * 创建/维护“报表工具”顶部入口。
   *
   * 与卡类汇总（1.6）保持一致：
   * - 只在SOA顶部header已生成时创建；header不存在时直接返回，
   *   不在body里留下隐藏的游离节点。
   * - 入口用独立slot包裹，便于与卡类汇总共用同一个顶部工具组。
   * - 不适用时（离开SOA站点）由removeGlobalSwitchEntry整体移除。
   */
  function ensureGlobalSwitchEntry() {
    const headerInner =
      document.querySelector(
        "#layout-header .header-inner"
      );

    if (!headerInner) {
      return null;
    }

    ensureGlobalSwitchStyle();

    let slot =
      document.getElementById(
        GLOBAL_SWITCH_SLOT_ID
      );

    let button =
      document.getElementById(
        GLOBAL_SWITCH_ID
      );

    if (
      button &&
      slot &&
      button.isConnected &&
      slot.isConnected
    ) {
      updateGlobalSwitchState();

      return button;
    }

    // 清理SPA重绘后可能残留的半成品节点。
    if (slot) {
      slot.remove();
    } else if (button) {
      button.remove();
    }

    slot =
      document.createElement(
        "div"
      );

    slot.id =
      GLOBAL_SWITCH_SLOT_ID;

    button =
      document.createElement(
        "button"
      );

    button.id =
      GLOBAL_SWITCH_ID;

    button.type =
      "button";

    button.innerHTML =
      "<span>报表工具</span>";

    // 与SOA原生菜单及卡类汇总按钮的指针事件完全隔离。
    [
      "pointerdown",
      "mousedown",
      "mouseup",
      "pointerup"
    ].forEach(
      eventName => {
        button.addEventListener(
          eventName,
          event => {
            event.stopPropagation();
          }
        );
      }
    );

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

    slot.appendChild(
      button
    );

    /*
     * 报表工具负责创建共享工具组：报表工具在左、卡类汇总在右。
     * 工具组不可用时退化为独立入口，放在顶部最右侧、紧贴用户区左侧。
     */
    const group =
      ensureTopToolGroup();

    if (group) {
      group.insertBefore(
        slot,
        group.firstChild
      );
    } else {
      const userBox =
        headerInner.querySelector(
          ":scope > .user"
        );

      if (userBox) {
        headerInner.insertBefore(
          slot,
          userBox
        );
      } else {
        headerInner.appendChild(
          slot
        );
      }
    }

    updateGlobalSwitchState();

    return button;
  }

  /*
   * 与卡类汇总（1.6）一致：不再适用时直接移除入口节点，
   * 而不是留下隐藏按钮。
   */
  function removeGlobalSwitchEntry() {
    const slot =
      document.getElementById(
        GLOBAL_SWITCH_SLOT_ID
      );

    if (slot) {
      slot.remove();

      return;
    }

    const button =
      document.getElementById(
        GLOBAL_SWITCH_ID
      );

    if (button) {
      button.remove();
    }
  }

  function scheduleGlobalSwitchPlacement(
    force = false
  ) {
    if (
      location.hostname !==
      HOST_SOA
    ) {
      return;
    }

    if (
      globalSwitchPlacementTask &&
      !force
    ) {
      return;
    }

    if (force) {
      globalSwitchPlacementGeneration +=
        1;

      globalSwitchPlacementTask =
        null;
    }

    const generation =
      globalSwitchPlacementGeneration;

    globalSwitchPlacementTask =
      (
        async () => {
          try {
            /*
             * React顶部导航可能晚于DOMContentLoaded生成。
             * 最多等待约2秒；MutationObserver后续仍会继续补位。
             * header未生成时不创建入口，避免留下游离节点。
             */
            for (
              let index = 0;
              index < 20;
              index += 1
            ) {
              if (
                generation !==
                  globalSwitchPlacementGeneration ||
                location.hostname !==
                  HOST_SOA
              ) {
                return;
              }

              const button =
                ensureGlobalSwitchEntry();

              if (
                button &&
                syncTopToolGroup(
                  button
                )
              ) {
                updateGlobalSwitchState();
                return;
              }

              await sleep(
                100
              );
            }
          } finally {
            if (
              generation ===
              globalSwitchPlacementGeneration
            ) {
              globalSwitchPlacementTask =
                null;
            }
          }
        }
      )();
  }

  function handleSoaRouteOrHeaderChange() {
    if (
      location.hostname !==
      HOST_SOA
    ) {
      removeGlobalSwitchEntry();

      return;
    }

    const routeKey =
      getSoaRouteKey();

    const button =
      document.getElementById(
        GLOBAL_SWITCH_ID
      );

    const group =
      document.getElementById(
        TOP_TOOL_GROUP_ID
      );

    const reportSlot =
      document.getElementById(
        GLOBAL_SWITCH_SLOT_ID
      );

    const headerInner =
      document.querySelector(
        "#layout-header .header-inner"
      );

    const routeChanged =
      routeKey !==
      globalSwitchRouteKey;

    const buttonMissing =
      !button ||
      !button.isConnected;

    const groupBroken =
      !group ||
      !group.isConnected ||
      !headerInner ||
      group.parentElement !==
        headerInner ||
      !reportSlot ||
      reportSlot.parentElement !==
        group;

    const looseCardSlot =
      findCardSummarySwitchSlots()
        .some(
          slot =>
            slot.parentElement !==
            group
        );

    if (
      !routeChanged &&
      !buttonMissing &&
      !groupBroken &&
      !looseCardSlot
    ) {
      return;
    }

    globalSwitchRouteKey =
      routeKey;

    scheduleGlobalSwitchPlacement(
      true
    );
  }

  function bindGlobalSwitchObserver() {
    if (
      globalSwitchObserver ||
      location.hostname !==
        HOST_SOA
    ) {
      return;
    }

    globalSwitchRouteKey =
      getSoaRouteKey();

    let debounceTimer =
      null;

    globalSwitchObserver =
      new MutationObserver(
        () => {
          clearTimeout(
            debounceTimer
          );

          debounceTimer =
            setTimeout(
              handleSoaRouteOrHeaderChange,
              180
            );
        }
      );

    globalSwitchObserver.observe(
      document.body,
      {
        childList:
          true,
        subtree:
          true
      }
    );

    window.addEventListener(
      "hashchange",
      () => {
        setTimeout(
          handleSoaRouteOrHeaderChange,
          80
        );
      }
    );

    window.addEventListener(
      "popstate",
      () => {
        setTimeout(
          handleSoaRouteOrHeaderChange,
          80
        );
      }
    );
  }

  // ============================================================
  // 9. 启动
  // ============================================================

  function boot() {
    /*
     * 业务入口只在SOA顶层页面显示。
     * Fly站点已在前面的授权捕获分支 return，不会创建业务UI。
     */
    if (
      location.hostname !==
        HOST_SOA
    ) {
      return;
    }

    if (
      !document.getElementById(
        PANEL_ID
      )
    ) {
      createPanel();
    }

    ensureGlobalSwitchEntry();
    bindGlobalSwitchObserver();
    scheduleGlobalSwitchPlacement(
      true
    );
    updateGlobalSwitchState();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      {
        once:
          true
      }
    );
  } else {
    boot();
  }

})();
