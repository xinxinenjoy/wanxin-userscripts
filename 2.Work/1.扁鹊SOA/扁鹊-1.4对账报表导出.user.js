// ==UserScript==
// @name         扁鹊-1.4对账报表导出
// @namespace    https://tampermonkey.net/
// @version      1.9
// @description  SOA对账报表：支持自定义日期区间，突破3年的时间段限制，自动分段查询、导出。并自动对比报表与订单内的数据差异。

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
// @publishID    soa-duizhangbaobiao
// @updateURL    https://scripts.wanxinxin.dpdns.org/bianque/soa-duizhangbaobiao.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/bianque/soa-duizhangbaobiao.user.js
// ==/UserScript==

/*
 * SOA.3.3对账报表
 *
 * 当前功能：
 * - SOA订单页优先读取商机编号，老订单缺失时自动使用单位代码，并识别订单编号。
 * - 开始、结束日期均可填写；默认结束日期为今天，开始日期取“报价确认”日期；若已超过单段1080天，则自动向前扩展到完整查询区间。
 * - 超过1080天的日期范围自动拆分为多个连续区间查询并汇总金额。
 * - 支持多种日期格式输入并自动标准化。
 * - 优先复用Fly有效Token；缺失/失效时才打开一次Fly页面刷新授权。
 * - 查询totalAmount、creditAmount，并与体检数据中的到检总额、挂账金额进行差异比对。
 * - 查询成功后才显示导出区；多区间分别显示日期并独立导出。
 * - 支持网络错误、超时、429、5xx重试及Excel固定命名下载。
 * - 面板支持拖动并保存位置；后续其他Fly同类型报表导出统一在本脚本扩展。
 *
 * 更新记录
 *
 * v1.9  -  2026-9-5
 * - 优化默认开始日期：报价确认距结束日期超过1080天时，自动向前扩展到完整查询区间。
 * - 例如原范围已经需要2次查询，则默认开始日期向前扩展，使2个查询区间都尽量用满；若需要更多区间，同样按完整区间扩展。
 * - 手工修改开始日期、分段规则、查询、金额核对及导出逻辑均不变。
 *
 * v1.8  -  2026-9-5
 * - 单位查询代码兼容老订单：优先读取“商机编号”，缺失或无有效数字时改用“单位代码”。
 * - 仅从“商机编号 / 单位代码”两个明确字段提取数字，不扫描页面其他数字；其余报表查询逻辑不变。
 *
 * v1.7  -  2026-9-3
 * - 默认开始日期改为当前订单流程进度中的“报价确认”日期。
 * - 若页面暂未识别到报价确认日期，保留原1080天规则作为兜底；其余查询、分段、核对及导出逻辑不变。
 *
 * v1.6  -  2026-9-1
 * - 工具箱框体改为不占布局高度的伪元素绘制，恢复工具按钮与页面原有页签文字垂直齐平。
 * - 标识改为“红领巾的工具箱”，字号提高并增加淡蓝灰背景；样式可由任一模块独立提供。
 *
 * v1.5  -  2026-9-1
 * - 金额核对时若体检名单尚未加载，自动切换体检名单读取金额，完成后恢复原页签。
 * - 核对结果改为精简卡片：直接显示报表金额、体检金额、差异及一致状态。
 * - 缩窄窗口并增大主要字号；顶部公共模块增加“红领巾的智能工具箱”边框标识。
 *
 * v1.4  -  2026-9-1
 * - 修复超1080天分段时结束日期判断反向导致首段仍超过1080天的问题。
 * - 空时段仅执行明细探测；记录数为0时跳过汇总和导出，并从总金额汇总中排除。
 * - 开始日期与结束日期调整为同一行显示，减少窗口纵向占用。
 *
 * v1.3  -  2026-9-1
 * - 开始日期改为可自定义；默认仍按结束日期向前1080天。
 * - 超过1080天自动分段查询并汇总金额，查询结果与体检到检总额/挂账金额进行差异比对。
 * - 查询成功后再显示导出区；多时段按日期分别提供独立下载，避免引入额外XLSX依赖。
 * - 增大工具标题字体并保留拖动位置记忆。
 *
 * v1.2  -  2026-9-1
 * - 对账报表窗口支持拖动并保存位置。
 * - 增加“仅查询”，显示总金额(totalAmount)与挂账金额(creditAmount)。
 * - 同单位代码与日期范围15秒内复用查询结果，避免连续查询与下载重复请求。
 *
 * v1.1  -  2026-9-1
 * - 模块正式更名为SOA.3.3对账报表，发布ID改为soa-duizhangbaobiao。
 * - 增加订单页顶部入口“查询对账报表 / 关闭对账报表”，固定为工具组第3位。
 * - 单位代码改为自动读取且不可编辑；文件名改用落单数据相同的订单名称识别逻辑。
 *
 * v1.0  -  2026-9-1
 * - 正式化：由独立体检对账测试脚本v1.3升级为Fly报表导出工具。
 * - 保留：已验证的授权捕获、1080天周期、灵活日期、重试及导出逻辑。
 */

(() => {
  "use strict";

  const HOST_SOA =
    "checkup-soa3.health-100.cn";

  const HOST_FLY =
    "app-fly.health-100.cn";

  const FLY_REPORT_URL =
    "https://app-fly.health-100.cn/autoapp-sheet-from/soa/examinationlist?menuCode=autoapp-sheet-from.duuizhang";

  const API = {
    QUERY:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/soaHcCheckupOrderDailyQuery?pageIndex=1&pageSize=10",

    SUM:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/soaSumHcCheckupOrderDailyPageList",

    EXPORT:
      "https://gateway-fly.health-100.cn/api/sso/autoapp-sheet-serve/api/v1/soa/exportSoaHcCheckupOrderDaily"
  };

  const PANEL_ID =
    "__soa_report_panel_v11";

  const PAGE_SWITCH_ID =
    "__soa_report_page_switch_v11";

  const ORDER_ROUTE_PREFIX =
    "#/order/";

  const EXTRACT_ORDER_NAME_SELECTOR =
    "#register > div";

  const TOKEN_KEY =
    "__soa_fly_export_token_v12";

  const TOKEN_TIME_KEY =
    "__soa_fly_export_token_time_v12";

  const TOKEN_CAPTURE_REQUEST_KEY =
    "__soa_fly_export_capture_request_v12";

  const CORP_SELECTOR =
    "#register > div:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(2) > div > div";

  const FIXED_LOOKBACK_DAYS =
    1080;

  const REQUEST_MAX_ATTEMPTS =
    3;

  const TOKEN_WAIT_TIMEOUT =
    60000;

  const REPORT_QUERY_CACHE_MS =
    15000;

  const REPORT_SEGMENT_GAP_MS =
    150;

  const MAX_QUERY_SEGMENTS =
    20;

  const PANEL_POSITION_KEY =
    "__soa_duizhangbaobiao_panel_position_v13";

  const PHYSICAL_DATA_GRID_ID =
    "__soa_data_physical_grid_v10";

  const PHYSICAL_CHECKED_AMOUNT_SELECTOR =
    "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(4) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(3)";

  const PHYSICAL_ACCOUNT_AMOUNT_SELECTOR =
    "#root > div > div > div > div > section > section:nth-of-type(2) > div:nth-of-type(5) > div > div:nth-of-type(4) > div > div > div > div > div > div > table > tbody > tr:nth-of-type(5) > td:nth-of-type(4)";

  const PHYSICAL_LOAD_TIMEOUT_MS =
    15000;

  const TOOLBOX_STYLE_ID =
    "__soa_honglingjin_toolbox_style_v10";

  const reportPeriodCache =
    new Map();

  let panelVisible = false;
  let routeObserver = null;
  let uiScheduled = false;
  let lastDetectedOrderCode = "";

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
        .split(
          "-"
        )
        .map(
          Number
        );

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

    let cursor =
      start;

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
        periodEnd ===
          end
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
      captureRequest &&
      window.opener
    ) {
      GM_deleteValue(
        TOKEN_CAPTURE_REQUEST_KEY
      );

      setTimeout(
        () => {
          try {
            window.close();
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
    scanFlyStorageForToken();

    const root =
      typeof unsafeWindow !==
        "undefined"
        ? unsafeWindow
        : window;

    try {
      const originalFetch =
        root.fetch;

      if (
        typeof originalFetch ===
          "function" &&
        !originalFetch.__soaFlyTokenWrapped
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
          "__soaFlyTokenWrapped",
          {
            value:
              true
          }
        );

        root.fetch =
          wrappedFetch;
      }
    } catch (_) {}

    try {
      const xhrProto =
        root.XMLHttpRequest
          ?.prototype;

      const originalSetHeader =
        xhrProto
          ?.setRequestHeader;

      if (
        originalSetHeader &&
        !originalSetHeader.__soaFlyTokenWrapped
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
          "__soaFlyTokenWrapped",
          {
            value:
              true
          }
        );

        xhrProto.setRequestHeader =
          wrappedSetHeader;
      }
    } catch (_) {}

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

  if (
    location.hostname ===
    HOST_FLY
  ) {
    installFlyTokenCapture();
    return;
  }

  if (
    location.hostname !==
    HOST_SOA
  ) {
    return;
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
      "需要刷新Fly授权，正在打开一次报表页..."
    );

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
        "浏览器阻止了授权标签页，请允许当前网站打开弹出窗口"
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

    throw new Error(
      "60秒内未获取到Fly授权，请确认新标签页已正常登录并打开体检对账页面。"
    );
  }

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

  function getExtractOrderName() {
    const direct =
      document.querySelector(
        EXTRACT_ORDER_NAME_SELECTOR
      );

    if (!direct) {
      return "";
    }

    const titledLabel =
      direct.querySelector(
        "label[title]"
      );

    const title =
      cleanText(
        titledLabel?.getAttribute(
          "title"
        )
      );

    if (title) {
      return title;
    }

    return cleanText(
      direct.innerText ||
      direct.textContent
    );
  }

  function getFormItemTextByFor(forId) {
    const label =
      document.querySelector(
        `label[for="${forId}"]`
      );

    const item =
      label?.closest(
        ".ant-form-item"
      );

    const control =
      item?.querySelector(
        ".ant-form-item-control"
      );

    if (!control) {
      return "";
    }

    const selectText =
      control.querySelector(
        ".ant-select-selection-item"
      )?.textContent;

    return cleanText(
      selectText ||
      control.innerText ||
      control.textContent
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

      const control = item?.querySelector(
        ".ant-form-item-control-input-content, .ant-form-item-control"
      );

      const value = cleanText(
        control?.innerText ||
        control?.textContent ||
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
        const value = cleanText(
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
    const raw = cleanText(value)
      .replace(/^'+/, "")
      .trim();

    return raw.match(/\d+/)?.[0] || "";
  }

  function extractDateFromText(
    value
  ) {
    const text =
      cleanText(
        value
      );

    if (!text) {
      return "";
    }

    const separatedMatch =
      text.match(
        /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/
      );

    if (separatedMatch) {
      return parseFlexibleDate(
        `${separatedMatch[1]}-${separatedMatch[2]}-${separatedMatch[3]}`
      );
    }

    const compactMatch =
      text.match(
        /\b(20\d{6})\b/
      );

    if (compactMatch) {
      return parseFlexibleDate(
        compactMatch[1]
      );
    }

    return "";
  }

  function detectQuoteConfirmDate() {
    /*
     * 流程进度中的“报价确认”通常由阶段名称和下方日期组成。
     * 不绑定固定class，优先从名称附近的父节点/相邻节点取日期，
     * 兼容页面结构的小范围调整。
     */
    const labelCandidates =
      Array.from(
        document.querySelectorAll(
          "div,span,p,strong"
        )
      ).filter(
        element =>
          compactText(
            element.textContent
          ) ===
          "报价确认"
      );

    for (
      const label
      of labelCandidates
    ) {
      const nearbyNodes = [
        label.nextElementSibling,
        label.previousElementSibling,
        label.parentElement,
        label.parentElement?.nextElementSibling,
        label.parentElement?.parentElement
      ].filter(
        Boolean
      );

      for (
        const node
        of nearbyNodes
      ) {
        const date =
          extractDateFromText(
            node.textContent
          );

        if (date) {
          return date;
        }
      }
    }

    return "";
  }

  function getDefaultReportStartDate(
    endDate
  ) {
    const quoteDate =
      detectQuoteConfirmDate();

    if (!quoteDate) {
      return addDays(
        endDate,
        -FIXED_LOOKBACK_DAYS
      );
    }

    const distanceDays =
      diffDays(
        quoteDate,
        endDate
      );

    if (
      !Number.isFinite(
        distanceDays
      ) ||
      distanceDays <=
        FIXED_LOOKBACK_DAYS
    ) {
      return quoteDate;
    }

    /*
     * 单次查询允许的最大日期差为1080天，
     * 实际包含首尾两天，因此一个完整区间覆盖1081个自然日。
     *
     * 当“报价确认 → 结束日期”已经超过一个完整区间时，
     * 不再只从报价确认日开始，而是把总查询范围向前补齐到
     * 整数个完整区间。
     *
     * 例如原本已经需要2次查询：
     *   第1段：1080天日期差
     *   第2段：1080天日期差
     *
     * 两段连续且不重叠时，总日期差为2161天。
     * 这样既然已经要请求2次，就把2次区间尽量用满，
     * 同时保留更早数据，减少遗漏风险。
     */
    const fullPeriodDays =
      FIXED_LOOKBACK_DAYS +
      1;

    const requiredSegments =
      Math.ceil(
        (
          distanceDays +
          1
        ) /
        fullPeriodDays
      );

    const fullLookbackDays =
      requiredSegments *
        fullPeriodDays -
      1;

    return addDays(
      endDate,
      -fullLookbackDays
    );
  }

  function detectCorpCode() {
    const opportunityRaw =
      cleanText(
        document.querySelector(
          CORP_SELECTOR
        )?.textContent
      ) ||
      cleanText(
        getFormItemTextByFor(
          "register_opportunity_id"
        )
      ) ||
      getRegisterFieldTextByLabel(
        "商机编号"
      );

    const opportunityCode =
      extractBusinessCodeDigits(
        opportunityRaw
      );

    if (opportunityCode) {
      return opportunityCode;
    }

    return (
      extractBusinessCodeDigits(
        getRegisterFieldTextByLabel(
          "单位代码"
        )
      ) ||
      ""
    );
  }

  function detectOrderCode() {
    const params =
      new URLSearchParams(
        location.hash.split(
          "?"
        )[1] ||
        ""
      );

    return (
      cleanText(
        params.get(
          "orderCode"
        )
      ) ||
      cleanText(
        document.body?.innerText
      ).match(
        /SOA\d+(?:-\d+)?/
      )?.[0] ||
      ""
    );
  }

  function buildRequestBody(
    corpCode,
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

    if (
      diffDays(
        normalizedStart,
        normalizedEnd
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

      corpCode: [
        corpCode
      ],

      checkupType:
        [],

      status:
        "Y",

      startDate:
        chinaDateToIso(
          normalizedStart,
          false
        ),

      endDate:
        chinaDateToIso(
          normalizedEnd,
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
              "autoapp-sheet-from",

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

  function getApiError(payload) {
    if (
      !payload ||
      typeof payload !==
        "object"
    ) {
      return "";
    }

    const resultCode =
      cleanText(
        payload.result_code ??
        payload.resultCode ??
        payload.code
      ).toUpperCase();

    const successFlag =
      payload.success;

    const errorCode =
      cleanText(
        payload.error_code ??
        payload.errorCode
      );

    const errorDesc =
      cleanText(
        payload.error_desc ??
        payload.errorDesc
      );

    const message =
      cleanText(
        payload.msg ??
        payload.message
      );

    /*
     * 明确失败信号才判错。
     * 注意：Fly接口成功时也可能返回 msg="请求成功"，
     * 不能再把所有 message/msg 都直接当成错误。
     */
    const explicitFail =
      [
        "FAIL",
        "FAILED",
        "ERROR"
      ].includes(
        resultCode
      ) ||
      successFlag ===
        false ||
      Boolean(
        errorCode ||
        errorDesc
      );

    if (!explicitFail) {
      return "";
    }

    return (
      errorDesc ||
      message ||
      errorCode ||
      resultCode ||
      "接口返回失败"
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
      throw new Error(
        `接口请求失败：HTTP ${response.status}`
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

    const apiError =
      getApiError(
        payload
      );

    if (apiError) {
      throw new Error(
        apiError
      );
    }

    return payload;
  }

  function findTotalCount(payload) {
    const keys = [
      "total_num",
      "totalNum",
      "totalCount",
      "total",
      "count"
    ];

    const visited =
      new Set();

    function walk(
      value,
      depth =
        0
    ) {
      if (
        value == null ||
        depth > 6 ||
        typeof value !==
          "object" ||
        visited.has(
          value
        )
      ) {
        return null;
      }

      visited.add(
        value
      );

      for (
        const key
        of keys
      ) {
        if (
          Object.prototype.hasOwnProperty.call(
            value,
            key
          )
        ) {
          const number =
            Number(
              value[
                key
              ]
            );

          if (
            Number.isFinite(
              number
            )
          ) {
            return number;
          }
        }
      }

      for (
        const child
        of Object.values(
          value
        )
      ) {
        const found =
          walk(
            child,
            depth + 1
          );

        if (
          found !== null
        ) {
          return found;
        }
      }

      return null;
    }

    return walk(
      payload
    );
  }

  function findExactField(
    payload,
    targetKey
  ) {
    const visited =
      new Set();

    function walk(
      value,
      depth =
        0
    ) {
      if (
        value == null ||
        depth > 8 ||
        typeof value !==
          "object" ||
        visited.has(
          value
        )
      ) {
        return undefined;
      }

      visited.add(
        value
      );

      if (
        Object.prototype.hasOwnProperty.call(
          value,
          targetKey
        )
      ) {
        const current =
          value[
            targetKey
          ];

        if (
          current !==
            null &&
          current !==
            undefined &&
          cleanText(
            current
          ) !== ""
        ) {
          return current;
        }
      }

      for (
        const child
        of Object.values(
          value
        )
      ) {
        const found =
          walk(
            child,
            depth + 1
          );

        if (
          found !==
          undefined
        ) {
          return found;
        }
      }

      return undefined;
    }

    return walk(
      payload
    );
  }

  function normalizeAmountNumber(
    value
  ) {
    if (
      value ===
        null ||
      value ===
        undefined
    ) {
      return null;
    }

    const text =
      cleanText(
        value
      )
        .replace(
          /,/g,
          ""
        )
        .replace(
          /￥|¥/g,
          ""
        );

    if (!text) {
      return null;
    }

    const number =
      Number(
        text
      );

    return Number.isFinite(
      number
    )
      ? number
      : null;
  }

  function formatAmount(
    value
  ) {
    const number =
      normalizeAmountNumber(
        value
      );

    if (
      number ===
        null
    ) {
      return "--";
    }

    return number.toLocaleString(
      "zh-CN",
      {
        minimumFractionDigits:
          2,
        maximumFractionDigits:
          2
      }
    );
  }

  function extractAmountSummary(
    sumResult,
    queryResult
  ) {
    /*
     * 汇总接口优先。
     * 若后端版本差异导致汇总接口字段位置变化，
     * 再回退到明细接口中查找同名字段。
     */
    const totalAmount =
      findExactField(
        sumResult,
        "totalAmount"
      ) ??
      findExactField(
        queryResult,
        "totalAmount"
      );

    const creditAmount =
      findExactField(
        sumResult,
        "creditAmount"
      ) ??
      findExactField(
        queryResult,
        "creditAmount"
      );

    return {
      totalAmount:
        normalizeAmountNumber(
          totalAmount
        ),

      creditAmount:
        normalizeAmountNumber(
          creditAmount
        )
    };
  }

  function getReportQueryCacheKey(
    corpCode,
    body
  ) {
    return [
      cleanText(
        corpCode
      ),
      cleanText(
        body?.startDate
      ),
      cleanText(
        body?.endDate
      ),
      cleanText(
        body?.status
      )
    ].join(
      "|"
    );
  }

  function clearReportQueryCache() {
    reportPeriodCache.clear();
  }

  async function prepareReportPeriodData(
    token,
    body,
    {
      corpCode,
      onRetry,
      setStatus,
      progressText =
        ""
    }
  ) {
    const cacheKey =
      getReportQueryCacheKey(
        corpCode,
        body
      );

    const cached =
      reportPeriodCache.get(
        cacheKey
      );

    if (
      cached &&
      Date.now() -
        cached.timestamp <
        REPORT_QUERY_CACHE_MS
    ) {
      return {
        ...cached,
        fromCache:
          true
      };
    }

    setStatus(
      progressText ||
      "正在查询对账明细..."
    );

    const queryResult =
      await requestJson(
        API.QUERY,
        token,
        body,
        onRetry
      );

    const recordCount =
      findTotalCount(
        queryResult
      );

    /*
     * 只有明确确认记录数为0，才按空时段处理。
     * 如果接口版本变化导致记录数字段未识别（null），
     * 继续请求汇总，避免把真实数据误判为空。
     */
    if (
      recordCount ===
        0
    ) {
      const emptyResult = {
        timestamp:
          Date.now(),
        queryResult,
        sumResult:
          null,
        amountSummary: {
          totalAmount:
            null,
          creditAmount:
            null
        },
        recordCount:
          0,
        empty:
          true
      };

      reportPeriodCache.set(
        cacheKey,
        emptyResult
      );

      return {
        ...emptyResult,
        fromCache:
          false
      };
    }

    const sumResult =
      await requestJson(
        API.SUM,
        token,
        body,
        onRetry
      );

    const amountSummary =
      extractAmountSummary(
        sumResult,
        queryResult
      );

    const result = {
      timestamp:
        Date.now(),
      queryResult,
      sumResult,
      amountSummary,
      recordCount,
      empty:
        false
    };

    reportPeriodCache.set(
      cacheKey,
      result
    );

    return {
      ...result,
      fromCache:
        false
    };
  }

  function aggregatePeriodAmounts(
    periodResults
  ) {
    const validResults =
      periodResults.filter(
        item =>
          !item.empty
      );

    if (
      validResults.length ===
        0
    ) {
      return {
        totalAmount:
          null,
        creditAmount:
          null,
        validPeriodCount:
          0
      };
    }

    let totalAmount =
      0;

    let creditAmount =
      0;

    let hasTotal =
      true;

    let hasCredit =
      true;

    validResults.forEach(
      item => {
        const total =
          item.amountSummary
            ?.totalAmount;

        const credit =
          item.amountSummary
            ?.creditAmount;

        if (
          total ===
            null ||
          total ===
            undefined
        ) {
          hasTotal =
            false;
        } else {
          totalAmount +=
            Number(
              total
            ) ||
            0;
        }

        if (
          credit ===
            null ||
          credit ===
            undefined
        ) {
          hasCredit =
            false;
        } else {
          creditAmount +=
            Number(
              credit
            ) ||
            0;
        }
      }
    );

    return {
      totalAmount:
        hasTotal
          ? totalAmount
          : null,

      creditAmount:
        hasCredit
          ? creditAmount
          : null,

      validPeriodCount:
        validResults.length
    };
  }

  function compactText(
    value
  ) {
    return cleanText(
      value
    ).replace(
      /\s+/g,
      ""
    );
  }

  function readPhysicalGridValue(
    label
  ) {
    const grid =
      document.getElementById(
        PHYSICAL_DATA_GRID_ID
      );

    if (!grid) {
      return null;
    }

    const target =
      compactText(
        label
      );

    for (
      const item
      of Array.from(
        grid.children
      )
    ) {
      const children =
        Array.from(
          item.children
        );

      if (
        compactText(
          children[0]
            ?.textContent
        ) !==
        target
      ) {
        continue;
      }

      return normalizeAmountNumber(
        children[1]
          ?.textContent
      );
    }

    return null;
  }

  function findPhysicalAmountFromTables(
    headerCandidates
  ) {
    const candidates =
      headerCandidates.map(
        compactText
      );

    for (
      const table
      of Array.from(
        document.querySelectorAll(
          "table"
        )
      )
    ) {
      const headers =
        Array.from(
          table.querySelectorAll(
            "thead th"
          )
        ).map(
          th =>
            compactText(
              th.textContent
            )
        );

      const index =
        headers.findIndex(
          header =>
            candidates.includes(
              header
            )
        );

      if (
        index < 0
      ) {
        continue;
      }

      const rows =
        Array.from(
          table.querySelectorAll(
            "tbody tr"
          )
        );

      const summaryRow =
        rows.find(
          row =>
            Array.from(
              row.querySelectorAll(
                "td"
              )
            ).some(
              cell =>
                compactText(
                  cell.textContent
                ) ===
                "合计"
            )
        ) ||
        rows[
          rows.length - 1
        ];

      const cells =
        Array.from(
          summaryRow
            ?.querySelectorAll(
              "td"
            ) ||
          []
        );

      const value =
        normalizeAmountNumber(
          cells[index]
            ?.textContent
        );

      if (
        value !==
        null
      ) {
        return value;
      }
    }

    return null;
  }

  function readPhysicalComparisonAmounts() {
    /*
     * 当前订单页面表格优先，3.2面板缓存作为回退。
     * 避免切换订单后误读到旧面板中尚未刷新的值。
     */
    const checkedAmount =
      findPhysicalAmountFromTables([
        "到检总额",
        "已检总额"
      ]) ??
      normalizeAmountNumber(
        document.querySelector(
          PHYSICAL_CHECKED_AMOUNT_SELECTOR
        )?.textContent
      ) ??
      readPhysicalGridValue(
        "到检总额"
      ) ??
      readPhysicalGridValue(
        "已检总额"
      );

    const accountAmount =
      findPhysicalAmountFromTables([
        "挂账金额"
      ]) ??
      normalizeAmountNumber(
        document.querySelector(
          PHYSICAL_ACCOUNT_AMOUNT_SELECTOR
        )?.textContent
      ) ??
      readPhysicalGridValue(
        "挂账金额"
      );

    return {
      checkedAmount,
      accountAmount
    };
  }

  function isVisibleElement(
    element
  ) {
    if (!element) {
      return false;
    }

    const style =
      window.getComputedStyle(
        element
      );

    if (
      style.display ===
        "none" ||
      style.visibility ===
        "hidden"
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

  function getOrderTabs() {
    return Array.from(
      document.querySelectorAll(
        ".tabs-wrap .tabs .tab"
      )
    ).filter(
      isVisibleElement
    );
  }

  function findOrderTabByText(
    text
  ) {
    const target =
      compactText(
        text
      );

    return (
      getOrderTabs().find(
        tab =>
          compactText(
            tab.textContent
          ) ===
          target
      ) ||
      null
    );
  }

  function getActiveOrderTab() {
    return (
      getOrderTabs().find(
        tab => {
          const classText =
            cleanText(
              tab.className
            ).toLowerCase();

          return (
            tab.getAttribute(
              "aria-selected"
            ) ===
              "true" ||
            /\bactive\b|\bselected\b/.test(
              classText
            )
          );
        }
      ) ||
      null
    );
  }

  function hasCompletePhysicalAmounts(
    data
  ) {
    return Boolean(
      data &&
      data.checkedAmount !==
        null &&
      data.accountAmount !==
        null
    );
  }

  async function waitForPhysicalAmounts(
    timeoutMs =
      PHYSICAL_LOAD_TIMEOUT_MS
  ) {
    const started =
      Date.now();

    while (
      Date.now() -
        started <
      timeoutMs
    ) {
      const data =
        readPhysicalComparisonAmounts();

      if (
        hasCompletePhysicalAmounts(
          data
        )
      ) {
        return data;
      }

      await sleep(
        200
      );
    }

    return readPhysicalComparisonAmounts();
  }

  async function ensurePhysicalComparisonAmounts(
    setStatus =
      () => {}
  ) {
    const existing =
      readPhysicalComparisonAmounts();

    if (
      hasCompletePhysicalAmounts(
        existing
      )
    ) {
      return {
        data:
          existing,
        navigated:
          false,
        restored:
          false
      };
    }

    const physicalTab =
      findOrderTabByText(
        "体检名单"
      );

    if (!physicalTab) {
      return {
        data:
          existing,
        navigated:
          false,
        restored:
          false
      };
    }

    const previousTab =
      getActiveOrderTab();

    const needSwitch =
      previousTab !==
        physicalTab;

    setStatus(
      "正在读取体检名单金额..."
    );

    if (needSwitch) {
      physicalTab.click();

      await sleep(
        150
      );
    }

    const data =
      await waitForPhysicalAmounts();

    let restored =
      false;

    /*
     * 体检数据加载后通常仍保留在隐藏DOM里，
     * 因此读取完成后恢复用户原来的页签，减少操作干扰。
     */
    if (
      needSwitch &&
      previousTab &&
      previousTab.isConnected
    ) {
      previousTab.click();

      restored =
        true;
    }

    return {
      data,
      navigated:
        needSwitch,
      restored
    };
  }

  function buildAmountComparison(
    reportSummary,
    physicalData =
      null
  ) {
    const physical =
      physicalData ||
      readPhysicalComparisonAmounts();

    const reportTotal =
      normalizeAmountNumber(
        reportSummary
          ?.totalAmount
      );

    const reportCreditRaw =
      normalizeAmountNumber(
        reportSummary
          ?.creditAmount
      );

    const reportCredit =
      reportCreditRaw ===
        null
        ? null
        : Math.abs(
            reportCreditRaw
          );

    const physicalCredit =
      physical.accountAmount ===
        null
        ? null
        : Math.abs(
            physical.accountAmount
          );

    function compare(
      reportValue,
      physicalValue
    ) {
      if (
        reportValue ===
          null ||
        physicalValue ===
          null
      ) {
        return {
          available:
            false,
          difference:
            null,
          equal:
            false
        };
      }

      const difference =
        reportValue -
        physicalValue;

      return {
        available:
          true,
        difference,
        equal:
          Math.abs(
            difference
          ) <
          0.005
      };
    }

    return {
      physical,
      total: {
        report:
          reportTotal,
        physical:
          physical.checkedAmount,
        ...compare(
          reportTotal,
          physical.checkedAmount
        )
      },

      credit: {
        report:
          reportCredit,
        reportRaw:
          reportCreditRaw,
        physical:
          physicalCredit,
        ...compare(
          reportCredit,
          physicalCredit
        )
      }
    };
  }

  function formatSignedAmount(
    value
  ) {
    const number =
      normalizeAmountNumber(
        value
      );

    if (
      number ===
        null
    ) {
      return "--";
    }

    const sign =
      number > 0
        ? "+"
        : "";

    return (
      `${sign}${formatAmount(
        number
      )}`
    );
  }

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
      panel.__soaReportDragBound
    ) {
      return;
    }

    panel.__soaReportDragBound =
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

  function getFixedDownloadFilename(
    orderCode,
    corpCode,
    startDate,
    endDate
  ) {
    const orderName =
      sanitizeFilenamePart(
        getExtractOrderName()
      );

    const fallbackKey =
      sanitizeFilenamePart(
        orderCode ||
        corpCode
      );

    const key =
      orderName ||
      fallbackKey ||
      "SOA订单";

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

    return (
      `${key}_对账报表_${start}-${end}.xlsx`
    );
  }

  async function exportFile(
    token,
    body,
    {
      orderCode,
      corpCode,
      startDate,
      endDate,
      onRetry
    }
  ) {
    const response =
      await gmRequestWithRetry({
        url:
          API.EXPORT,
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
      response.status <
        200 ||
      response.status >=
        300
    ) {
      throw new Error(
        `导出失败：HTTP ${response.status}`
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
      buffer.byteLength ===
        0
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

      let payload =
        null;

      try {
        payload =
          JSON.parse(
            text
          );
      } catch (_) {}

      const apiError =
        getApiError(
          payload
        );

      throw new Error(
        apiError ||
        cleanText(
          payload?.error_desc ??
          payload?.errorDesc ??
          payload?.error_code ??
          payload?.errorCode
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

    const filename =
      getFixedDownloadFilename(
        orderCode,
        corpCode,
        startDate,
        endDate
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      url;

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
          url
        ),
      60000
    );

    return {
      filename,
      size:
        blob.size
    };
  }

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
          "none",
        right:
          "24px",
        top:
          "150px",
        zIndex:
          "999999",
        width:
          "395px",
        padding:
          "0",
        boxSizing:
          "border-box",
        border:
          "1px solid #d9d9d9",
        borderRadius:
          "8px",
        background:
          "#fff",
        boxShadow:
          "0 8px 24px rgba(0,0,0,.15)",
        fontFamily:
          "Arial, 'Microsoft YaHei', sans-serif",
        fontSize:
          "13px",
        color:
          "#333",
        overflow:
          "hidden"
      }
    );

    panel.innerHTML = `
      <div
        id="__soa_report_drag_handle_v13"
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:12px 13px 11px;
          border-bottom:1px solid #f0f0f0;
          background:#fafafa;
        "
      >
        <strong style="
          font-size:15px;
          line-height:1.2;
        ">对账报表 v1.9</strong>

        <button
          id="__soa_report_close_v13"
          type="button"
          style="
            width:26px;
            height:26px;
            border:0;
            border-radius:5px;
            background:#f0f0f0;
            color:#666;
            cursor:pointer;
          "
        >×</button>
      </div>

      <div style="padding:12px 13px 13px;">
        <div style="
          display:grid;
          grid-template-columns:78px 1fr;
          gap:8px 7px;
          align-items:center;
        ">
          <div style="color:#777;">单位代码</div>

          <input
            id="__soa_report_corp_v13"
            type="text"
            readonly
            style="
              width:100%;
              height:32px;
              box-sizing:border-box;
              padding:0 8px;
              border:1px solid #eee;
              border-radius:5px;
              background:#f7f7f7;
              color:#666;
              font-size:13px;
            "
          >

          <div style="color:#777;">日期范围</div>

          <div style="
            display:grid;
            grid-template-columns:1fr auto 1fr;
            gap:6px;
            align-items:center;
          ">
            <input
              id="__soa_report_start_v13"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="开始日期"
              title="开始日期"
              style="
                width:100%;
                min-width:0;
                height:31px;
                box-sizing:border-box;
                padding:0 8px;
                border:1px solid #d9d9d9;
                border-radius:5px;
              font-size:13px;
              "
            >

            <span style="
              color:#999;
              font-size:12px;
            ">至</span>

            <input
              id="__soa_report_end_v13"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="结束日期"
              title="结束日期"
              style="
                width:100%;
                min-width:0;
                height:31px;
                box-sizing:border-box;
                padding:0 8px;
                border:1px solid #d9d9d9;
                border-radius:5px;
              font-size:13px;
              "
            >
          </div>
        </div>

        <div
          id="__soa_report_amount_box_v13"
          style="
            display:none;
            grid-template-columns:1fr 1fr;
            gap:8px;
            margin-top:11px;
          "
        >
          <div style="
            padding:10px;
            border:1px solid #eee;
            border-radius:7px;
            background:#fafafa;
          ">
            <div style="
              color:#888;
              font-size:11px;
            ">对账总金额</div>

            <div
              id="__soa_report_total_amount_v13"
              style="
                margin-top:3px;
                font-size:17px;
                font-weight:700;
                color:#333;
              "
            >--</div>
          </div>

          <div style="
            padding:10px;
            border:1px solid #eee;
            border-radius:7px;
            background:#fafafa;
          ">
            <div style="
              color:#888;
              font-size:11px;
            ">对账挂账金额</div>

            <div
              id="__soa_report_credit_amount_v13"
              style="
                margin-top:3px;
                font-size:17px;
                font-weight:700;
                color:#333;
              "
            >--</div>

            <div
              id="__soa_report_credit_raw_v13"
              style="
                display:none;
                margin-top:2px;
                color:#999;
                font-size:9px;
              "
            ></div>
          </div>
        </div>

        <div
          id="__soa_report_compare_box_v13"
          style="
            display:none;
            margin-top:9px;
            padding:9px;
            border:1px solid #eee;
            border-radius:7px;
            background:#fff;
          "
        ></div>

        <div
          id="__soa_report_period_box_v13"
          style="
            display:none;
            margin-top:9px;
            padding:9px;
            border:1px solid #eee;
            border-radius:7px;
            background:#fff;
          "
        ></div>

        <button
          id="__soa_report_query_v13"
          type="button"
          style="
            width:100%;
            height:34px;
            margin-top:10px;
            border:0;
            border-radius:6px;
            background:#6f5bd3;
            color:#fff;
            font-weight:700;
            font-size:13px;
            cursor:pointer;
          "
        >查询</button>

        <div
          id="__soa_report_status_v13"
          style="
            margin-top:9px;
            padding:8px 9px;
            border-radius:5px;
            background:#f5f7fa;
            color:#666;
            font-size:11px;
            line-height:1.45;
            word-break:break-all;
          "
        >
          设置日期后点击查询。
        </div>

      </div>
    `;

    document.body.appendChild(
      panel
    );

    const dragHandle =
      panel.querySelector(
        "#__soa_report_drag_handle_v13"
      );

    const corpInput =
      panel.querySelector(
        "#__soa_report_corp_v13"
      );

    const startInput =
      panel.querySelector(
        "#__soa_report_start_v13"
      );

    const endInput =
      panel.querySelector(
        "#__soa_report_end_v13"
      );

    const queryButton =
      panel.querySelector(
        "#__soa_report_query_v13"
      );

    const amountBox =
      panel.querySelector(
        "#__soa_report_amount_box_v13"
      );

    const totalAmountEl =
      panel.querySelector(
        "#__soa_report_total_amount_v13"
      );

    const creditAmountEl =
      panel.querySelector(
        "#__soa_report_credit_amount_v13"
      );

    const creditRawEl =
      panel.querySelector(
        "#__soa_report_credit_raw_v13"
      );

    const compareBox =
      panel.querySelector(
        "#__soa_report_compare_box_v13"
      );

    const periodBox =
      panel.querySelector(
        "#__soa_report_period_box_v13"
      );

    const status =
      panel.querySelector(
        "#__soa_report_status_v13"
      );

    let lastQueryState =
      null;

    let startUserEdited =
      false;

    function setStatus(
      text,
      type =
        "normal"
    ) {
      status.textContent =
        text;

      status.style.background =
        type ===
          "success"
          ? "#f6ffed"
          : type ===
              "error"
            ? "#fff2f0"
            : "#f5f7fa";

      status.style.color =
        type ===
          "success"
          ? "#389e0d"
          : type ===
              "error"
            ? "#cf1322"
            : "#666";
    }

    function setQueryBusy(
      busy
    ) {
      queryButton.disabled =
        busy;

      queryButton.textContent =
        busy
          ? "查询中..."
          : "查询";

      queryButton.style.opacity =
        busy
          ? "0.65"
          : "1";

      queryButton.style.cursor =
        busy
          ? "not-allowed"
          : "pointer";
    }

    function invalidateQueryResult(
      {
        keepStatus =
          false
      } =
        {}
    ) {
      lastQueryState =
        null;

      amountBox.style.display =
        "none";

      compareBox.style.display =
        "none";

      compareBox.innerHTML =
        "";

      periodBox.style.display =
        "none";

      periodBox.innerHTML =
        "";

      queryButton.style.display =
        "block";

      if (!keepStatus) {
        setStatus(
          "日期条件已变更，请重新查询。"
        );
      }
    }

    function normalizeDateInputs(
      showError =
        false
    ) {
      let endDate =
        parseFlexibleDate(
          endInput.value
        );

      if (!endDate) {
        if (
          showError &&
          cleanText(
            endInput.value
          )
        ) {
          setStatus(
            "结束日期格式无法识别",
            "error"
          );
        }

        return null;
      }

      endInput.value =
        endDate;

      let startDate =
        parseFlexibleDate(
          startInput.value
        );

      if (
        !startDate &&
        !cleanText(
          startInput.value
        )
      ) {
        startDate =
          getDefaultReportStartDate(
            endDate
          );

        startUserEdited =
          false;
      }

      if (!startDate) {
        if (showError) {
          setStatus(
            "开始日期格式无法识别",
            "error"
          );
        }

        return null;
      }

      startInput.value =
        startDate;

      if (
        diffDays(
          startDate,
          endDate
        ) < 0
      ) {
        if (showError) {
          setStatus(
            "开始日期不能晚于结束日期",
            "error"
          );
        }

        return null;
      }

      return {
        startDate,
        endDate
      };
    }

    function setDefaultDates() {
      const endDate =
        getChinaToday();

      endInput.value =
        endDate;

      startInput.value =
        getDefaultReportStartDate(
          endDate
        );

      startUserEdited =
        false;
    }

    function detect() {
      const corpCode =
        detectCorpCode();

      const orderCode =
        detectOrderCode();

      const oldCorpCode =
        cleanText(
          corpInput.value
        );

      corpInput.value =
        corpCode;

      const orderChanged =
        Boolean(
          orderCode &&
          lastDetectedOrderCode &&
          orderCode !==
            lastDetectedOrderCode
        );

      if (
        (
          oldCorpCode &&
          corpCode &&
          oldCorpCode !==
            corpCode
        ) ||
        orderChanged
      ) {
        clearReportQueryCache();
        invalidateQueryResult({
          keepStatus:
            true
        });
      }

      if (
        !startInput.value ||
        !endInput.value ||
        orderChanged
      ) {
        setDefaultDates();
      }

      lastDetectedOrderCode =
        orderCode;

      setStatus(
        corpCode
          ? `当前订单：${orderCode || "未识别订单号"} · 单位代码 ${corpCode}`
          : "当前订单未识别到单位代码，请确认订单基本信息已加载。",
        corpCode
          ? "normal"
          : "error"
      );
    }

    function renderComparison(
      summary,
      physicalData =
        null
    ) {
      const comparison =
        buildAmountComparison(
          summary,
          physicalData
        );

      const items = [
        {
          label:
            "总金额",
          report:
            comparison.total.report,
          physical:
            comparison.total.physical,
          compare:
            comparison.total
        },
        {
          label:
            "挂账金额",
          report:
            comparison.credit.report,
          physical:
            comparison.credit.physical,
          compare:
            comparison.credit
        }
      ];

      const availableItems =
        items.filter(
          item =>
            item.compare.available
        );

      const allEqual =
        availableItems.length ===
          items.length &&
        availableItems.every(
          item =>
            item.compare.equal
        );

      const anyDiff =
        availableItems.some(
          item =>
            !item.compare.equal
        );

      let headline =
        "体检数据未完整读取";

      let headlineColor =
        "#8c8c8c";

      if (allEqual) {
        headline =
          "✓ 金额一致";

        headlineColor =
          "#389e0d";
      } else if (anyDiff) {
        headline =
          "✕ 存在金额差异";

        headlineColor =
          "#cf1322";
      } else if (
        availableItems.length >
          0
      ) {
        headline =
          "部分金额已核对";
      }

      compareBox.innerHTML = `
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          margin-bottom:7px;
        ">
          <strong style="
            font-size:13px;
            color:#555;
          ">核对结果</strong>

          <strong style="
            font-size:13px;
            color:${headlineColor};
          ">${headline}</strong>
        </div>

        <div style="
          display:flex;
          flex-direction:column;
          gap:7px;
        ">
          ${items
            .map(
              item => {
                const available =
                  item.compare.available;

                const stateText =
                  !available
                    ? "未获取"
                    : item.compare.equal
                      ? "一致"
                      : `差异 ${formatSignedAmount(
                          item.compare.difference
                        )}`;

                const stateColor =
                  !available
                    ? "#8c8c8c"
                    : item.compare.equal
                      ? "#389e0d"
                      : "#cf1322";

                return `
                  <div style="
                    padding:8px 9px;
                    border:1px solid #edf0f3;
                    border-radius:6px;
                    background:#fafafa;
                  ">
                    <div style="
                      display:flex;
                      align-items:center;
                      justify-content:space-between;
                      gap:8px;
                    ">
                      <strong style="
                        font-size:13px;
                        color:#444;
                      ">${item.label}</strong>

                      <strong style="
                        font-size:13px;
                        color:${stateColor};
                      ">${stateText}</strong>
                    </div>

                    <div style="
                      display:grid;
                      grid-template-columns:1fr 1fr;
                      gap:8px;
                      margin-top:6px;
                    ">
                      <div>
                        <div style="
                          color:#999;
                          font-size:10px;
                        ">报表</div>

                        <div style="
                          margin-top:1px;
                          color:#333;
                          font-size:15px;
                          font-weight:700;
                        ">${formatAmount(
                          item.report
                        )}</div>
                      </div>

                      <div>
                        <div style="
                          color:#999;
                          font-size:10px;
                        ">订单内</div>

                        <div style="
                          margin-top:1px;
                          color:#333;
                          font-size:15px;
                          font-weight:700;
                        ">${formatAmount(
                          item.physical
                        )}</div>
                      </div>
                    </div>
                  </div>
                `;
              }
            )
            .join("")}
        </div>
      `;

      compareBox.style.display =
        "block";

      return comparison;
    }

    function renderPeriodExports(
      state
    ) {
      const exportableResults =
        state.periodResults.filter(
          item =>
            !item.empty
        );

      const emptyCount =
        state.periodResults.length -
        exportableResults.length;

      const multiple =
        exportableResults.length >
        1;

      periodBox.innerHTML = `
        <div style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:8px;
          margin-bottom:7px;
        ">
          <strong style="
            color:#555;
            font-size:12px;
          ">
            ${
              multiple
                ? `有效时段（${exportableResults.length}段）`
                : "导出"
            }
          </strong>

          <button
            id="__soa_report_requery_v13"
            type="button"
            style="
              height:24px;
              padding:0 8px;
              border:1px solid #d9d9d9;
              border-radius:5px;
              background:#fff;
              color:#666;
              font-size:10px;
              cursor:pointer;
            "
          >重新查询</button>
        </div>

        ${
          emptyCount >
            0
            ? `
              <div style="
                margin-bottom:7px;
                padding:6px 7px;
                border-radius:5px;
                background:#fafafa;
                color:#999;
                font-size:10px;
                line-height:1.4;
              ">
                共拆分 ${state.periodResults.length} 个时段；
                ${emptyCount} 个无数据时段已自动跳过，
                ${exportableResults.length} 个时段存在数据。
              </div>
            `
            : ""
        }

        <div
          id="__soa_report_export_rows_v13"
          style="
            display:flex;
            flex-direction:column;
            gap:6px;
          "
        ></div>
      `;

      const rows =
        periodBox.querySelector(
          "#__soa_report_export_rows_v13"
        );

      exportableResults.forEach(
        item => {
          const row =
            document.createElement(
              "div"
            );

          row.style.cssText = [
            "display:grid",
            "grid-template-columns:1fr auto",
            "gap:8px",
            "align-items:center",
            "padding:7px 8px",
            "border:1px solid #f0f0f0",
            "border-radius:6px",
            "background:#fafafa"
          ].join(";");

          const info =
            document.createElement(
              "div"
            );

          info.innerHTML = `
            <div style="
              color:#555;
              font-size:11px;
              font-weight:600;
            ">
              ${item.startDate} ～ ${item.endDate}
            </div>

            <div style="
              margin-top:2px;
              color:#999;
              font-size:9px;
            ">
              ${
                item.recordCount !==
                  null &&
                item.recordCount !==
                  undefined
                  ? `${item.recordCount} 条 · `
                  : ""
              }
              总 ${formatAmount(item.amountSummary.totalAmount)}
              · 挂 ${formatAmount(item.amountSummary.creditAmount)}
            </div>
          `;

          const exportButton =
            document.createElement(
              "button"
            );

          exportButton.type =
            "button";

          exportButton.textContent =
            "导出";

          exportButton.style.cssText = [
            "height:28px",
            "min-width:64px",
            "padding:0 10px",
            "border:0",
            "border-radius:5px",
            "background:#6f5bd3",
            "color:#fff",
            "font-size:11px",
            "font-weight:600",
            "cursor:pointer"
          ].join(";");

          exportButton.addEventListener(
            "click",
            async () => {
              if (
                !lastQueryState ||
                lastQueryState !==
                  state
              ) {
                setStatus(
                  "查询条件已变化，请重新查询。",
                  "error"
                );

                return;
              }

              exportButton.disabled =
                true;

              exportButton.textContent =
                "导出中...";

              try {
                const onRetry =
                  createRetryHandler();

                const exported =
                  await withFlyTokenRetry(
                    async token =>
                      exportFile(
                        token,
                        item.body,
                        {
                          orderCode:
                            state.orderCode,
                          corpCode:
                            state.corpCode,
                          startDate:
                            item.startDate,
                          endDate:
                            item.endDate,
                          onRetry
                        }
                      )
                  );

                setStatus(
                  `✓ 已触发下载：${exported.filename}`,
                  "success"
                );
              } catch (error) {
                console.error(
                  "[对账报表-分段导出]",
                  error
                );

                setStatus(
                  error?.message ||
                  String(error),
                  "error"
                );
              } finally {
                exportButton.disabled =
                  false;

                exportButton.textContent =
                  "导出";
              }
            }
          );

          row.appendChild(
            info
          );

          row.appendChild(
            exportButton
          );

          rows.appendChild(
            row
          );
        }
      );

      periodBox
        .querySelector(
          "#__soa_report_requery_v13"
        )
        ?.addEventListener(
          "click",
          () => {
            invalidateQueryResult();

            queryButton.focus();
          }
        );

      periodBox.style.display =
        exportableResults.length
          ? "block"
          : "none";

      queryButton.style.display =
        exportableResults.length
          ? "none"
          : "block";
    }

    function createRetryHandler() {
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
      task
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

    startInput.addEventListener(
      "input",
      () => {
        startUserEdited =
          true;

        invalidateQueryResult();
      }
    );

    startInput.addEventListener(
      "blur",
      () => {
        const normalized =
          parseFlexibleDate(
            startInput.value
          );

        if (normalized) {
          startInput.value =
            normalized;
        } else if (
          !cleanText(
            startInput.value
          )
        ) {
          const endDate =
            parseFlexibleDate(
              endInput.value
            ) ||
            getChinaToday();

          startInput.value =
            getDefaultReportStartDate(
              endDate
            );

          startUserEdited =
            false;
        }

        normalizeDateInputs(
          true
        );
      }
    );

    startInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          startInput.blur();
        }
      }
    );

    endInput.addEventListener(
      "input",
      () => {
        invalidateQueryResult();
      }
    );

    endInput.addEventListener(
      "blur",
      () => {
        const normalized =
          parseFlexibleDate(
            endInput.value
          );

        if (normalized) {
          endInput.value =
            normalized;

          if (!startUserEdited) {
            startInput.value =
              getDefaultReportStartDate(
                normalized
              );
          }
        }

        normalizeDateInputs(
          true
        );
      }
    );

    endInput.addEventListener(
      "keydown",
      event => {
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();

          endInput.blur();
        }
      }
    );

    queryButton.addEventListener(
      "click",
      async () => {
        const corpCode =
          cleanText(
            corpInput.value
          );

        const dates =
          normalizeDateInputs(
            true
          );

        if (!corpCode) {
          setStatus(
            "未识别到当前订单单位代码，请确认基本信息已加载后重试。",
            "error"
          );

          return;
        }

        if (!dates) {
          return;
        }

        let periods;

        try {
          periods =
            splitDateRange(
              dates.startDate,
              dates.endDate
            );
        } catch (error) {
          setStatus(
            error?.message ||
            String(error),
            "error"
          );

          return;
        }

        const orderCode =
          detectOrderCode();

        const onRetry =
          createRetryHandler();

        setQueryBusy(
          true
        );

        invalidateQueryResult({
          keepStatus:
            true
        });

        queryButton.style.display =
          "block";

        try {
          const periodResults =
            await withFlyTokenRetry(
              async token => {
                const results = [];

                for (
                  let index = 0;
                  index <
                    periods.length;
                  index += 1
                ) {
                  const period =
                    periods[index];

                  const body =
                    buildRequestBody(
                      corpCode,
                      period.startDate,
                      period.endDate
                    );

                  setStatus(
                    periods.length >
                      1
                      ? `正在查询第 ${index + 1}/${periods.length} 段：${period.startDate} ～ ${period.endDate}`
                      : `正在查询：${period.startDate} ～ ${period.endDate}`
                  );

                  const prepared =
                    await prepareReportPeriodData(
                      token,
                      body,
                      {
                        corpCode,
                        onRetry,
                        setStatus,
                        progressText:
                          periods.length >
                            1
                            ? `正在查询第 ${index + 1}/${periods.length} 段...`
                            : "正在查询对账数据..."
                      }
                    );

                  results.push({
                    startDate:
                      period.startDate,
                    endDate:
                      period.endDate,
                    body,
                    ...prepared
                  });

                  if (
                    index <
                    periods.length - 1
                  ) {
                    await sleep(
                      REPORT_SEGMENT_GAP_MS
                    );
                  }
                }

                return results;
              }
            );

          const aggregate =
            aggregatePeriodAmounts(
              periodResults
            );

          const emptyCount =
            periodResults.filter(
              item =>
                item.empty
            ).length;

          const validCount =
            periodResults.length -
            emptyCount;

          if (
            validCount ===
              0
          ) {
            amountBox.style.display =
              "none";

            compareBox.style.display =
              "none";

            periodBox.style.display =
              "none";

            lastQueryState =
              null;

            queryButton.style.display =
              "block";

            setStatus(
              periods.length >
                1
                ? `查询完成：共检查 ${periods.length} 个时段，当前日期范围内均无对账数据。`
                : "查询完成：当前日期范围内无对账数据。",
              "success"
            );

            return;
          }

          if (
            aggregate.totalAmount ===
              null ||
            aggregate.creditAmount ===
              null
          ) {
            throw new Error(
              "查询完成，但有效时段中未能完整读取totalAmount或creditAmount"
            );
          }

          totalAmountEl.textContent =
            formatAmount(
              aggregate.totalAmount
            );

          creditAmountEl.textContent =
            formatAmount(
              Math.abs(
                aggregate.creditAmount
              )
            );

          if (
            aggregate.creditAmount <
              0
          ) {
            creditRawEl.textContent =
              `接口原值：${formatAmount(
                aggregate.creditAmount
              )}`;

            creditRawEl.style.display =
              "block";
          } else {
            creditRawEl.style.display =
              "none";
          }

          /*
           * 报表金额直接放入“核对结果”卡片，
           * 不再重复显示顶部金额卡片。
           */
          amountBox.style.display =
            "none";

          const physicalResult =
            await ensurePhysicalComparisonAmounts(
              setStatus
            );

          renderComparison(
            aggregate,
            physicalResult.data
          );

          const state = {
            corpCode,
            orderCode,
            requestedStartDate:
              dates.startDate,
            requestedEndDate:
              dates.endDate,
            periodResults,
            aggregate,
            createdAt:
              Date.now()
          };

          lastQueryState =
            state;

          renderPeriodExports(
            state
          );

          if (
            periods.length >
              1
          ) {
            setStatus(
              emptyCount >
                0
                ? `✓ 查询完成 · ${validCount}个有效时段 · ${emptyCount}个空时段已跳过`
                : `✓ 查询完成 · ${validCount}个有效时段`,
              "success"
            );
          } else {
            setStatus(
              "✓ 查询完成",
              "success"
            );
          }
        } catch (error) {
          console.error(
            "[对账报表-查询]",
            error
          );

          setStatus(
            error?.message ||
            String(error),
            "error"
          );

          queryButton.style.display =
            "block";
        } finally {
          setQueryBusy(
            false
          );
        }
      }
    );

    panel
      .querySelector(
        "#__soa_report_close_v13"
      )
      .addEventListener(
        "click",
        () => {
          setPanelVisible(
            false
          );
        }
      );

    makePanelDraggable(
      panel,
      dragHandle
    );

    panel.__soaRestoreReportPosition =
      () =>
        restorePanelPosition(
          panel
        );

    panel.__soaRefreshReportContext =
      detect;

    return panel;
  }

  function updatePageSwitch() {
    const button =
      document.getElementById(
        PAGE_SWITCH_ID
      );

    if (!button) {
      return;
    }

    button.textContent =
      panelVisible
        ? "关闭对账报表"
        : "查询对账报表";

    button.title =
      panelVisible
        ? "关闭对账报表面板"
        : "查询当前订单对账报表";
  }

  function setPanelVisible(visible) {
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

      if (panelVisible) {
        if (
          typeof panel.__soaRestoreReportPosition ===
            "function"
        ) {
          panel.__soaRestoreReportPosition();
        }

        if (
          typeof panel.__soaRefreshReportContext ===
            "function"
        ) {
          panel.__soaRefreshReportContext();
        }
      }
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
        PAGE_SWITCH_ID
      );

    if (!button) {
      button =
        document.createElement(
          "button"
        );

      button.id =
        PAGE_SWITCH_ID;

      button.type =
        "button";

      button.dataset.soaToolOrder =
        "3";

      button.style.cssText = [
        "display:inline-flex",
        "flex:0 0 auto",
        "align-items:center",
        "justify-content:center",
        "height:32px",
        "padding:0 12px",
        "border:1px solid #6f5bd3",
        "border-radius:6px",
        "background:#6f5bd3",
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

    uiScheduled =
      true;

    requestAnimationFrame(
      () => {
        uiScheduled =
          false;

        if (!isOrderRoute()) {
          return;
        }

        createPanel();
        ensurePageSwitch();
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
    panelVisible =
      false;

    document
      .getElementById(
        PAGE_SWITCH_ID
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

    document
      .getElementById(
        PANEL_ID
      )
      ?.remove();

    routeObserver?.disconnect();
    routeObserver =
      null;
  }

  function routeCheck() {
    if (isOrderRoute()) {
      connectObserver();
      scheduleUi();
      return;
    }

    teardownOrderUi();
  }

  function bootSoa() {
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
          once:
            true
        }
      );
    } else {
      routeCheck();
    }
  }

  bootSoa();
})();
