// ==UserScript==
// @name         CurseForge增强
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  增强CurseForge网站的中文显示，翻译部分英文为中文，支持动态加载内容的翻译。

// @match        https://www.curseforge.com/*
// @run-at       document-end
// @grant        none

// @author       WanXin
// @publishGroup hljdyxjb
// @publishID    game-curseforge
// @updateURL    https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-curseforge.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-curseforge.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* =========================
       基础关键词（统一小写存储）
    ========================== */
    const dictionary = {
        "comments": "评论",
        "gallery": "图片",
        "files": "文件",
        "relations": "依赖关系",
        "retail": "正式服",
        "mop classic": "熊猫人",
        "following": "订阅",
        "go premium": "高级会员",
        "my profile": "我的资料",
        "dashboard": "仪表盘",
        "reward store": "奖励商店",
        "settings": "设置",
        "log out": "退出登录",
        "log in": "登录",
        "titan reforged classic": "泰坦",
        "classic": "怀旧服",
        "issues": "问题",
        "description": "简介",
        "download": "下载",
        "downloads": "下载次数",
        "last updated": "最后更新",
        "created": "创建时间",
        "updated": "更新于"
    };

    /* =========================
       月份翻译（全称+缩写）
    ========================== */
    const monthMap = {
        jan: "1月", january: "1月",
        feb: "2月", february: "2月",
        mar: "3月", march: "3月",
        apr: "4月", april: "4月",
        may: "5月",
        jun: "6月", june: "6月",
        jul: "7月", july: "7月",
        aug: "8月", august: "8月",
        sep: "9月", sept: "9月", september: "9月",
        oct: "10月", october: "10月",
        nov: "11月", november: "11月",
        dec: "12月", december: "12月"
    };

    /* =========================
       带数量标签翻译
    ========================== */
    function translateWithCount(text) {
        const match = text.match(/^([A-Za-z ]+)\s*\((\d+)\)$/i);
        if (match) {
            const word = match[1].trim().toLowerCase();
            const count = match[2];
            if (dictionary[word]) {
                return `${dictionary[word]}（${count}）`;
            }
        }
        return null;
    }

    /* =========================
       相对时间直译
    ========================== */
    function translateRelativeTime(text) {
        const match = text.match(/(\d+)\s+(second|seconds|minute|minutes|hour|hours|day|days|month|months|year|years|decade|decades)\s+ago/i);
        if (!match) return null;

        const value = match[1];
        const unit = match[2].toLowerCase();

        const unitMap = {
            second: "秒",
            seconds: "秒",
            minute: "分钟",
            minutes: "分钟",
            hour: "小时",
            hours: "小时",
            day: "天",
            days: "天",
            month: "个月",
            months: "个月",
            year: "年",
            years: "年",
            decade: "十年",
            decades: "十年"
        };

        if (unitMap[unit]) {
            return `${value}${unitMap[unit]}前`;
        }

        return null;
    }

    /* =========================
       月份翻译（不计算日期）
    ========================== */
    function translateMonth(text) {
        // 统一处理大小写
        const lower = text.toLowerCase();

        for (const key in monthMap) {
            const regex = new RegExp(`\\b${key}\\b`, 'i');
            if (regex.test(text)) {
                return text.replace(regex, monthMap[key]);
            }
        }
        return null;
    }

    /* =========================
       普通关键词翻译（忽略大小写）
    ========================== */
    function translateKeyword(text) {
        const lower = text.toLowerCase();
        if (dictionary[lower]) {
            return dictionary[lower];
        }
        return null;
    }

    /* =========================
       处理文本节点
    ========================== */
    function processText(node) {
        if (node.nodeType !== Node.TEXT_NODE) return;

        let text = node.nodeValue.trim();
        if (!text) return;

        // 1️⃣ 数量标签
        const countTranslation = translateWithCount(text);
        if (countTranslation) {
            node.nodeValue = countTranslation;
            return;
        }

        // 2️⃣ 相对时间
        const relative = translateRelativeTime(text);
        if (relative) {
            node.nodeValue = relative;
            return;
        }

        // 3️⃣ 月份
        const month = translateMonth(text);
        if (month) {
            node.nodeValue = month;
            return;
        }

        // 4️⃣ 普通关键词
        const keyword = translateKeyword(text);
        if (keyword) {
            node.nodeValue = keyword;
        }
    }

    function walk(node) {
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                processText(child);
            } else {
                walk(child);
            }
        });
    }

    function translatePage() {
        walk(document.body);
    }

    // 初次执行
    translatePage();

    // 监听动态变化
    const observer = new MutationObserver(() => {
        translatePage();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();