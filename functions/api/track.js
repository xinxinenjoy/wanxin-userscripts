// Cloudflare Pages Function
// V8 统计事件采集
// 保存路径：functions/api/track.js
//
// 页面访问统计规则：
// - 以“匿名浏览器设备 ID + 当前公网 IP”作为一次访问设备的临时去重键。
// - 同一设备、同一公网 IP 在 8 小时内重复访问，只计 1 次 page_view。
// - 同一公网 IP 下，不同设备 / 不同浏览器配置可分别计数。
// - 同一设备切换公网 IP 后，会按新的网络环境重新计数。
// - install_click 不做去重，每次点击“立即安装”都正常累计。
// - 不保存原始 IP，也不保存客户端匿名设备 ID。
// - D1 仅保存 HMAC-SHA256 后的 visitor_key，并自动清理旧记录。
//
// 说明：匿名设备 ID 由首页在浏览器本地生成并保存，不读取硬件序列号，
//      也不进行 Canvas / 字体等浏览器指纹采集。
//
// D1 Binding：STATS_DB
// Secret / 环境变量：VISITOR_HASH_SECRET

const PAGE_VIEW_DEDUPE_HOURS = 8;
const VISITOR_RETENTION_HOURS = 24;

const DOMESTIC_COUNTRIES = new Set(["CN", "HK", "MO", "TW"]);

function json(data, status = 200) {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

function clean(value, maxLength = 120) {
    return String(value || "").trim().slice(0, maxLength);
}

function cleanVersion(value, maxParts = 3) {
    return String(value || "")
        .replace(/_/g, ".")
        .split(".")
        .filter((part) => /^\d+$/.test(part))
        .slice(0, maxParts)
        .join(".");
}

function windowsNameFromPlatformVersion(platformVersion) {
    const version = cleanVersion(platformVersion, 3);
    const major = Number(version.split(".")[0]);

    if (!Number.isFinite(major) || major <= 0) {
        return "";
    }

    // Chromium UA-CH:
    // Windows 11 的 platformVersion 主版本通常为 13 或更高。
    // Windows 10 常见为 1~10。
    if (major >= 13) {
        return "Windows 11";
    }

    return "Windows 10";
}

function osNameFromUa(value) {
    const android = value.match(/Android\s+([0-9._]+)/i);
    if (android) {
        const version = cleanVersion(android[1], 2);
        return version ? `Android ${version}` : "Android";
    }

    const ios = value.match(
        /(?:iPhone|CPU(?: iPhone)? OS|iPad; CPU OS)\s*([0-9_]+)?/i
    );
    if (/iPhone|iPad|iPod/i.test(value)) {
        const version = cleanVersion(ios?.[1], 2);
        return version ? `iOS ${version}` : "iOS";
    }

    const mac = value.match(/Mac OS X\s+([0-9_]+)/i);
    if (/Mac OS X|Macintosh/i.test(value)) {
        const version = cleanVersion(mac?.[1], 2);
        return version ? `macOS ${version}` : "macOS";
    }

    const windows = value.match(/Windows NT\s+([0-9.]+)/i);
    if (windows) {
        const nt = cleanVersion(windows[1], 2);

        // 仅凭传统 UA 无法可靠区分 Windows 10 和 Windows 11，
        // 因此 NT 10.0 统一写作 Windows 10/11。
        if (nt == "10.0") return "Windows 10/11";
        if (nt == "6.3") return "Windows 8.1";
        if (nt == "6.2") return "Windows 8";
        if (nt == "6.1") return "Windows 7";

        return nt ? `Windows NT ${nt}` : "Windows";
    }

    if (/Linux/i.test(value)) return "Linux";

    return "Other";
}

function enrichOsName(baseOs, ua, clientEnvironment = {}) {
    const platform = clean(clientEnvironment?.platform, 80);
    const platformVersion = clean(
        clientEnvironment?.platformVersion,
        40
    );

    if (/windows/i.test(platform) || baseOs === "Windows") {
        const windows =
            windowsNameFromPlatformVersion(platformVersion);

        if (windows) return windows;
    }

    if (/android/i.test(platform) && platformVersion) {
        const version = cleanVersion(platformVersion, 2);
        if (version) return `Android ${version}`;
    }

    if (/mac/i.test(platform) && platformVersion) {
        const version = cleanVersion(platformVersion, 2);
        if (version) return `macOS ${version}`;
    }

    return osNameFromUa(String(ua || ""));
}

function browserNameWithVersion(value) {
    const ua = String(value || "");

    const rules = [
        {
            regex: /SamsungBrowser\/([0-9.]+)/i,
            name: "Samsung Internet",
        },
        {
            regex: /OPR\/([0-9.]+)/i,
            name: "Opera",
        },
        {
            regex: /EdgA?\/([0-9.]+)/i,
            name: "Edge",
        },
        {
            regex: /EdgiOS\/([0-9.]+)/i,
            name: "Edge",
        },
        {
            regex: /CriOS\/([0-9.]+)/i,
            name: "Chrome",
        },
        {
            regex: /Chrome\/([0-9.]+)/i,
            name: "Chrome",
        },
        {
            regex: /FxiOS\/([0-9.]+)/i,
            name: "Firefox",
        },
        {
            regex: /Firefox\/([0-9.]+)/i,
            name: "Firefox",
        },
        {
            regex: /Version\/([0-9.]+).*Safari\//i,
            name: "Safari",
        },
    ];

    for (const rule of rules) {
        const match = ua.match(rule.regex);

        if (!match) {
            continue;
        }

        // 版本排行默认保留主版本号。
        // 这样既能区分 Chrome 140 / 141，也不会因为补丁版本造成过度碎片化。
        const major = cleanVersion(match[1], 1);

        return major
            ? `${rule.name} ${major}`
            : rule.name;
    }

    return "Other";
}

function parseUserAgent(ua, clientEnvironment = {}) {
    const value = String(ua || "");

    const browser = browserNameWithVersion(value);

    let baseOs = "Other";
    if (/Windows NT/i.test(value)) baseOs = "Windows";
    else if (/Android/i.test(value)) baseOs = "Android";
    else if (/iPhone|iPad|iPod/i.test(value)) baseOs = "iOS";
    else if (/Mac OS X|Macintosh/i.test(value)) baseOs = "macOS";
    else if (/Linux/i.test(value)) baseOs = "Linux";

    const os = enrichOsName(
        baseOs,
        value,
        clientEnvironment
    );

    let device = "Desktop";
    if (/iPad|Tablet/i.test(value)) device = "Tablet";
    else if (/Mobile|Android|iPhone|iPod/i.test(value)) device = "Mobile";

    return { browser, os, device };
}

function referrerHost(request) {
    const raw = request.headers.get("Referer");
    if (!raw) return "direct";

    try {
        return new URL(raw).hostname || "direct";
    } catch {
        return "unknown";
    }
}

function looksLikeBot(ua) {
    return /bot|crawler|spider|slurp|headless|lighthouse|preview|facebookexternalhit|bingpreview/i.test(
        String(ua || "")
    );
}

function getClientIp(request) {
    // 原始公网 IP 只在当前请求内用于生成 HMAC，不写入数据库。
    return clean(request.headers.get("CF-Connecting-IP"), 80);
}

function normalizeDeviceId(value) {
    const id = clean(value, 120);

    // 首页生成的 ID 只允许常见 UUID / 随机 token 字符。
    // 无效值直接忽略，避免把任意长文本参与 visitor_key。
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(id)) {
        return "";
    }

    return id;
}

async function makeVisitorKey({ ip, deviceId, ua, secret }) {
    if (!ip || !secret) return "";

    // 正常情况使用匿名设备 ID。
    // 如果浏览器阻止本地存储导致 deviceId 缺失，退化为 UA，
    // 仍保留一定的去重能力，但同网络同 UA 的设备可能被合并。
    const devicePart = deviceId || `ua:${clean(ua, 280)}`;
    const source = `${ip}\n${devicePart}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256",
        },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(source)
    );

    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function shouldCountPageView(db, visitorKey) {
    if (!visitorKey) {
        // 无法得到去重键时 fail-open，避免异常环境完全漏记访问。
        return true;
    }

    const recent = await db.prepare(
        `SELECT 1 AS found
         FROM page_visitors
         WHERE visitor_key = ?
           AND last_counted_at >= strftime(
               '%Y-%m-%dT%H:%M:%fZ',
               'now',
               ?
           )
         LIMIT 1`
    )
        .bind(visitorKey, `-${PAGE_VIEW_DEDUPE_HOURS} hours`)
        .first();

    if (recent?.found) {
        return false;
    }

    await db.prepare(
        `INSERT INTO page_visitors (
            visitor_key,
            last_counted_at
        ) VALUES (
            ?,
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
        ON CONFLICT(visitor_key)
        DO UPDATE SET
            last_counted_at = excluded.last_counted_at`
    )
        .bind(visitorKey)
        .run();

    // visitor_key 仅用于短期去重，不长期保存。
    await db.prepare(
        `DELETE FROM page_visitors
         WHERE last_counted_at < strftime(
             '%Y-%m-%dT%H:%M:%fZ',
             'now',
             ?
         )`
    )
        .bind(`-${VISITOR_RETENTION_HOURS} hours`)
        .run();

    return true;
}

async function insertEvent({
    db,
    eventType,
    scriptId,
    request,
    clientEnvironment = {},
}) {
    const requestUrl = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const cf = request.cf || {};

    const country = clean(cf.country || "XX", 8);
    const region = clean(cf.region || "", 80);
    const regionCode = clean(cf.regionCode || "", 16);
    const city = clean(cf.city || "", 80);
    const timezone = clean(cf.timezone || "", 80);

    const { browser, os, device } = parseUserAgent(
        ua,
        clientEnvironment
    );
    const referrer = clean(referrerHost(request), 160);
    const hostname = clean(requestUrl.hostname, 160);
    const isDomestic = DOMESTIC_COUNTRIES.has(country) ? 1 : 0;

    await db.prepare(
        `INSERT INTO events (
            event_type,
            script_id,
            country,
            region,
            region_code,
            city,
            timezone,
            browser,
            os,
            device,
            referrer_host,
            hostname,
            is_domestic
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
        .bind(
            eventType,
            scriptId,
            country,
            region,
            regionCode,
            city,
            timezone,
            browser,
            os,
            device,
            referrer,
            hostname,
            isDomestic
        )
        .run();
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!env.STATS_DB) {
        return json({ ok: false, error: "STATS_DB binding missing" }, 500);
    }

    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && origin !== requestUrl.origin) {
        return json({ ok: false, error: "invalid origin" }, 403);
    }

    const ua = request.headers.get("User-Agent") || "";

    if (looksLikeBot(ua)) {
        return json({ ok: true, counted: false, ignored: "bot" });
    }

    let body = {};

    try {
        const raw = await request.text();
        body = raw ? JSON.parse(raw) : {};
    } catch {
        return json({ ok: false, error: "invalid json" }, 400);
    }

    const clientEnvironment = {
        platform: clean(
            body?.clientEnvironment?.platform,
            80
        ),
        platformVersion: clean(
            body?.clientEnvironment?.platformVersion,
            40
        ),
    };

    const eventType = clean(body.eventType, 32);

    if (!["page_view", "install_click"].includes(eventType)) {
        return json({ ok: false, error: "invalid event" }, 400);
    }

    const scriptId =
        eventType === "install_click"
            ? clean(body.scriptId, 96)
            : "";

    if (eventType === "install_click" && !scriptId) {
        return json({ ok: false, error: "script id required" }, 400);
    }

    // ========================================================
    // 页面访问：同设备 + 同公网 IP，8 小时内只计 1 次
    // ========================================================
    if (eventType === "page_view") {
        if (!env.VISITOR_HASH_SECRET) {
            return json(
                { ok: false, error: "VISITOR_HASH_SECRET missing" },
                500
            );
        }

        const ip = getClientIp(request);
        const deviceId = normalizeDeviceId(body.deviceId);
        const visitorKey = await makeVisitorKey({
            ip,
            deviceId,
            ua,
            secret: env.VISITOR_HASH_SECRET,
        });

        const countThisVisit = await shouldCountPageView(
            env.STATS_DB,
            visitorKey
        );

        if (!countThisVisit) {
            return json({
                ok: true,
                counted: false,
                ignored: "duplicate_page_view",
                dedupeHours: PAGE_VIEW_DEDUPE_HOURS,
                dedupeScope: "same_device_same_ip",
            });
        }

        await insertEvent({
            db: env.STATS_DB,
            eventType,
            scriptId: "",
            request,
            clientEnvironment,
        });

        return json({
            ok: true,
            counted: true,
            eventType,
            dedupeHours: PAGE_VIEW_DEDUPE_HOURS,
        });
    }

    // ========================================================
    // 安装点击：不做去重，每次点击都计数
    // ========================================================
    await insertEvent({
        db: env.STATS_DB,
        eventType,
        scriptId,
        request,
        clientEnvironment,
    });

    return json({
        ok: true,
        counted: true,
        eventType,
        scriptId,
    });
}

export async function onRequestGet() {
    return json({
        ok: true,
        endpoint: "WanXin Userscripts statistics tracker",
        pageViewRule: `same browser device + same IP counted once per ${PAGE_VIEW_DEDUPE_HOURS} hours`,
        installRule: "every install click is counted",
        privacy: "raw IP and client device ID are not stored",
        osDetail: "OS family/version is derived from User-Agent and UA Client Hints when available",
        browserDetail: "browser field stores browser family + major version when available",
    });
}
