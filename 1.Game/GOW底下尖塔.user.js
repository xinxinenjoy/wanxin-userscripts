// ==UserScript==
// @name         GOW底下尖塔
// @namespace    http://tampermonkey.net/
// @version      4.2.27
// @description  GOW底下尖塔火把管理与节点同步工具

// @match        https://solofandy.github.io/*
// @grant        none

// @author       WanXin
// @publishGroup hljdyxjb
// @publishID    game-gowdxjt
// @updateURL    https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-gowdxjt.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-gowdxjt.user.js
// ==/UserScript==

/*
 * 更新记录
 *
 * v4.2.27 - 2026-8-30
 * - 优化：守卫清理模式与常规导航一致，为所有未完成守卫显示独立火把消耗与完整路线
 * - 优化：清理模式会记录当前清理起点；同步完成守卫后自动从新完成守卫继续规划
 * - 保留：各守卫路线独立计算，不因与其他路线重合而合并或抵扣火把
 *
 * v4.2.26 - 2026-8-30
 * - 优化：重点房间全部完成后，自动标记所有未完成的守卫房间
 * - 修复：主线路结束后无路线对象，导致守卫清理提示无法触发的问题
 */

(function () {
    'use strict';

    const GIFT_PER_REFRESH = 7;
    const BUY_PER_TIME = 5;
    const MAX_BUY_PER_DAY = 3;
    const REFRESH_HOUR = 15;
    const BUY_COSTS = [50, 100, 150];

    const FONT_FAMILY = '"Microsoft YaHei", "微软雅黑", sans-serif';
    const FONT_SIZE = '17px';

    const STORAGE_CURRENT_TORCH = 'gow_current_torch';
    const STORAGE_TODAY_BOUGHT = 'gow_today_bought';
    const STORAGE_ROUND_KEY = 'gow_round_key';
    const STORAGE_COMPLETED_COUNT = 'gow_completed_count';
    const STORAGE_LAST_COMPLETED_MSG = 'gow_last_completed_msg';
    const STORAGE_COMPLETED_CYCLE_KEY = 'gow_completed_cycle_key';
    const STORAGE_SYSTEM_INFO_EXPANDED = 'gow_system_info_expanded';
    const STORAGE_PLAN_DETAIL_EXPANDED = 'gow_plan_detail_expanded';
    const STORAGE_PANEL_LEFT = 'gow_panel_left';
    const STORAGE_PANEL_TOP = 'gow_panel_top';
    const STORAGE_PANEL_WIDTH = 'gow_panel_width';
    const STORAGE_MAP_SCALE = 'gow_map_scale';
    const STORAGE_MAP_OFFSET_X = 'gow_map_offset_x';
    const STORAGE_MAP_OFFSET_Y = 'gow_map_offset_y';
    const STORAGE_MAP_TOOLS_EXPANDED = 'gow_map_tools_expanded';
    const STORAGE_PANEL_SCALE = 'gow_panel_scale';
    const STORAGE_MAP_UNLOCKED = 'gow_map_unlocked';
    const STORAGE_MAP_WIDGET_LEFT = 'gow_map_widget_left';
    const STORAGE_MAP_WIDGET_TOP = 'gow_map_widget_top';
    const STORAGE_PANEL_COLLAPSED = 'gow_panel_collapsed';
    const STORAGE_ROUTE_GUIDANCE_ENABLED = 'gow_route_guidance_enabled';
    const STORAGE_GUARDIAN_CLEANUP_START = 'gow_guardian_cleanup_start';
    const STORAGE_GUARDIAN_CLEANUP_COMPLETED = 'gow_guardian_cleanup_completed';

    let renderTimer = null;
    let syncWatchTimer = null;
    let syncWatchToken = 0;

    function updateCollapsedPanelSummary(box) {
        if (!box) return;

        const handle = box.querySelector('.gow-drag-handle');
        const infoPanel = document.querySelector('#underspire-info');
        if (!handle || !infoPanel) return;

        let summary = handle.querySelector('.gow-collapsed-summary');
        if (!summary) {
            summary = document.createElement('div');
            summary.className = 'gow-collapsed-summary';
            summary.innerHTML = `
                <div class="gow-collapsed-main">
                    <span class="gow-collapsed-title">尖塔进度</span>
                    <span class="gow-collapsed-ratio"><b data-role="completed">—</b><em>/</em><span data-role="total">—</span></span>
                    <span class="gow-collapsed-remaining">剩余 <b data-role="remaining">—</b></span>
                    <span class="gow-collapsed-percent" data-role="percent">—%</span>
                </div>
                <div class="gow-collapsed-progress" aria-hidden="true">
                    <span class="gow-collapsed-progress-fill" data-role="progress-fill"></span>
                </div>
            `;
            handle.appendChild(summary);
        }

        const availableCellCount = getAvailableMapCellCount();
        const liveCompleted = getCompletedNodeCount();
        const liveRemaining = parseTotalNeed(infoPanel);

        let completedValue;
        if (availableCellCount > 0) {
            completedValue = liveCompleted;
            summary.dataset.completed = String(completedValue);
        } else if (summary.dataset.completed !== undefined) {
            completedValue = parseInt(summary.dataset.completed, 10);
        } else {
            completedValue = getNumberFromStorage(STORAGE_COMPLETED_COUNT, 0);
        }

        let remainingValue;
        if (liveRemaining !== null) {
            remainingValue = liveRemaining;
            summary.dataset.remaining = String(remainingValue);
        } else if (availableCellCount > 0) {
            remainingValue = Math.max(0, availableCellCount - completedValue);
            summary.dataset.remaining = String(remainingValue);
        } else if (summary.dataset.remaining !== undefined) {
            remainingValue = parseInt(summary.dataset.remaining, 10);
        } else {
            remainingValue = '—';
        }

        const completedEl = summary.querySelector('[data-role="completed"]');
        const totalEl = summary.querySelector('[data-role="total"]');
        const remainingEl = summary.querySelector('[data-role="remaining"]');
        const percentEl = summary.querySelector('[data-role="percent"]');
        const progressFill = summary.querySelector('[data-role="progress-fill"]');

        const completedNumber = Number.isFinite(Number(completedValue)) ? Math.max(0, Number(completedValue)) : 0;
        const remainingNumber = Number.isFinite(Number(remainingValue)) ? Math.max(0, Number(remainingValue)) : null;
        const totalValue = remainingNumber === null ? null : completedNumber + remainingNumber;
        const progressPercent = totalValue && totalValue > 0
            ? Math.max(0, Math.min(100, (completedNumber / totalValue) * 100))
            : 0;

        if (completedEl) completedEl.textContent = String(completedValue);
        if (totalEl) totalEl.textContent = totalValue === null ? '—' : String(totalValue);
        if (remainingEl) remainingEl.textContent = String(remainingValue);
        if (percentEl) percentEl.textContent = totalValue === null ? '—%' : `${Math.round(progressPercent)}%`;
        if (progressFill) progressFill.style.width = `${progressPercent.toFixed(2)}%`;
    }

    function applyPanelCollapseState(box, collapsed) {
        if (!box) return;

        box.classList.toggle('gow-panel-collapsed', collapsed);

        const btn = box.querySelector('.gow-panel-toggle-btn');
        if (btn) {
            btn.textContent = collapsed ? '＋' : '－';
            btn.title = collapsed ? '展开面板' : '折叠面板';
            btn.setAttribute('aria-label', collapsed ? '展开面板' : '折叠面板');
        }

        updateCollapsedPanelSummary(box);
    }

    function setupPanelCollapse() {
        const box = document.querySelector('#underspire-info-box');
        if (!box) return;

        const handle = box.querySelector('.gow-drag-handle');
        if (!handle) return;

        let btn = handle.querySelector('.gow-panel-toggle-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'gow-panel-toggle-btn';
            btn.type = 'button';
            handle.appendChild(btn);

            btn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();

                const collapsed = localStorage.getItem(STORAGE_PANEL_COLLAPSED) === 'true';
                const nextCollapsed = !collapsed;
                localStorage.setItem(STORAGE_PANEL_COLLAPSED, nextCollapsed ? 'true' : 'false');
                applyPanelCollapseState(box, nextCollapsed);
            });
        }

        const collapsed = localStorage.getItem(STORAGE_PANEL_COLLAPSED) === 'true';
        applyPanelCollapseState(box, collapsed);
    }

    function scheduleRender(delay = 100) {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            moveInfoPanel();
            setupPanelCollapse();
        }, delay);
    }

    function getNumberFromStorage(key, defaultValue) {
        const value = localStorage.getItem(key);
        const num = parseInt(value, 10);
        return Number.isFinite(num) ? num : defaultValue;
    }

    function setCurrentTorchValue(value) {
        const safeValue = Math.max(0, parseInt(value || '0', 10) || 0);

        localStorage.setItem(STORAGE_CURRENT_TORCH, String(safeValue));

        const inputTorch = document.querySelector('#gow-current-torch');
        if (inputTorch) {
            inputTorch.value = String(safeValue);
        }

        return safeValue;
    }

    function formatRefreshKey(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');

        return `${y}-${m}-${d}-${REFRESH_HOUR}`;
    }

    function getCurrentRoundKey() {
        const now = new Date();
        const round = new Date(now);

        if (now.getHours() < REFRESH_HOUR) {
            round.setDate(round.getDate() - 1);
        }

        round.setHours(REFRESH_HOUR, 0, 0, 0);

        return formatRefreshKey(round);
    }

    function getRefreshDayNumber(roundKey) {
        const match = String(roundKey || '').match(/^(\d{4})-(\d{2})-(\d{2})-(\d{1,2})$/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = Number(match[4]);

        if (hour !== REFRESH_HOUR) return null;

        const utcValue = Date.UTC(year, month - 1, day);
        return Number.isFinite(utcValue) ? Math.floor(utcValue / 86400000) : null;
    }

    function getPassedRefreshCount(savedRoundKey, currentRoundKey) {
        const savedDay = getRefreshDayNumber(savedRoundKey);
        const currentDay = getRefreshDayNumber(currentRoundKey);

        if (savedDay === null || currentDay === null) return 0;

        return Math.max(0, currentDay - savedDay);
    }

    function getWeeklyStartDayNumber(roundKey) {
        const dayNumber = getRefreshDayNumber(roundKey);
        if (dayNumber === null) return null;

        // 1970-01-01是星期四。换算成0=周日、1=周一……6=周六。
        const weekDay = new Date(dayNumber * 86400000).getUTCDay();
        const daysSinceMonday = (weekDay + 6) % 7;

        return dayNumber - daysSinceMonday;
    }

    function getWeeklyGiftTorchForRound(roundKey) {
        const currentDay = getRefreshDayNumber(roundKey);
        const mondayDay = getWeeklyStartDayNumber(roundKey);

        if (currentDay === null || mondayDay === null) {
            return GIFT_PER_REFRESH;
        }

        // 周一当轮为7，周二为14，依此类推。
        const refreshCountThisWeek = currentDay - mondayDay + 1;
        return Math.max(1, refreshCountThisWeek) * GIFT_PER_REFRESH;
    }

    function getCurrentWeeklyCycleKey() {
        const now = new Date();
        const cycleStart = new Date(now);
        cycleStart.setHours(REFRESH_HOUR, 0, 0, 0);

        let daysSinceMonday = (now.getDay() + 6) % 7;

        // 周一15点之前，仍属于上一个周周期。
        if (now.getDay() === 1 && now.getTime() < cycleStart.getTime()) {
            daysSinceMonday = 7;
        }

        cycleStart.setDate(now.getDate() - daysSinceMonday);

        return formatRefreshKey(cycleStart);
    }

    function autoResetTodayBoughtIfNewRound() {
        const currentRoundKey = getCurrentRoundKey();
        const savedRoundKey = localStorage.getItem(STORAGE_ROUND_KEY);

        // 第一次使用只建立时间基准，避免覆盖用户已经手动填写的真实火把。
        if (!savedRoundKey) {
            localStorage.setItem(STORAGE_ROUND_KEY, currentRoundKey);
            return false;
        }

        const passedRefreshCount = getPassedRefreshCount(savedRoundKey, currentRoundKey);

        if (passedRefreshCount <= 0) {
            // 旧值异常或来自未来时，直接纠正时间基准，不调整火把。
            if (savedRoundKey !== currentRoundKey) {
                localStorage.setItem(STORAGE_ROUND_KEY, currentRoundKey);
            }
            return false;
        }

        const savedWeekStart = getWeeklyStartDayNumber(savedRoundKey);
        const currentWeekStart = getWeeklyStartDayNumber(currentRoundKey);
        const crossedMondayReset = savedWeekStart !== null &&
            currentWeekStart !== null &&
            savedWeekStart !== currentWeekStart;

        let message = '';

        if (crossedMondayReset) {
            // 周一完整更新：上周剩余火把全部失效。
            // 按当前已经跨过的本周刷新轮数重新计算：周一7、周二14……
            const weeklyTorch = getWeeklyGiftTorchForRound(currentRoundKey);
            setCurrentTorchValue(weeklyTorch);

            message = `已跨过周一完整更新：火把重置为本周${weeklyTorch}个`;
        } else {
            // 同一周内漏开页面时，按实际跨过的每日15点次数补加。
            const addedTorch = passedRefreshCount * GIFT_PER_REFRESH;
            const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
            setCurrentTorchValue(currentTorch + addedTorch);

            message = `已跨过${passedRefreshCount}次每日刷新：+${addedTorch}火把`;
        }

        localStorage.setItem(STORAGE_TODAY_BOUGHT, '0');
        localStorage.setItem(STORAGE_ROUND_KEY, currentRoundKey);

        const selectBought = document.querySelector('#gow-today-bought');
        if (selectBought) {
            selectBought.value = '0';
            selectBought.dataset.lastValue = '0';
        }

        localStorage.setItem(
            STORAGE_LAST_COMPLETED_MSG,
            `${message}，当前轮已购次数重置；请同步本周节点基准`
        );

        return true;
    }

    autoResetTodayBoughtIfNewRound();

    function getCompletedNodeCount() {
        const cells = document.querySelectorAll('#underspire-map .cell.completed');

        return Array.from(cells).filter(cell => {
            return !cell.classList.contains('none');
        }).length;
    }

    function getCompletedBaseline() {
        const currentCompleted = getCompletedNodeCount();
        const saved = localStorage.getItem(STORAGE_COMPLETED_COUNT);

        if (saved === null || saved === undefined || saved === '') {
            localStorage.setItem(STORAGE_COMPLETED_COUNT, String(currentCompleted));
            return currentCompleted;
        }

        const num = parseInt(saved, 10);

        if (!Number.isFinite(num)) {
            localStorage.setItem(STORAGE_COMPLETED_COUNT, String(currentCompleted));
            return currentCompleted;
        }

        return num;
    }

    function getCycleEndTime() {
        const now = new Date();
        const end = new Date(now);

        const day = now.getDay();
        let daysUntilMonday;

        if (day === 1 && now.getHours() < REFRESH_HOUR) {
            daysUntilMonday = 0;
        } else {
            daysUntilMonday = (8 - day) % 7;
            if (daysUntilMonday === 0) daysUntilMonday = 7;
        }

        end.setDate(now.getDate() + daysUntilMonday);
        end.setHours(REFRESH_HOUR, 0, 0, 0);

        return end;
    }

    function getFutureRefreshCount() {
        const now = new Date();
        const cycleEnd = getCycleEndTime();

        let cursor = new Date(now);

        if (now.getHours() < REFRESH_HOUR) {
            cursor.setHours(REFRESH_HOUR, 0, 0, 0);
        } else {
            cursor.setDate(now.getDate() + 1);
            cursor.setHours(REFRESH_HOUR, 0, 0, 0);
        }

        let count = 0;

        while (cursor < cycleEnd) {
            count++;
            cursor.setDate(cursor.getDate() + 1);
        }

        return count;
    }

    function parseTotalNeed(infoPanel) {
        if (!infoPanel) return null;

        const text = infoPanel.textContent || infoPanel.innerText || '';
        const match = text.match(/共计约\s*[:：]\s*(\d+)/);

        if (!match) return null;

        return parseInt(match[1], 10);
    }

    function getCustomValues() {
        const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
        const todayBought = getNumberFromStorage(STORAGE_TODAY_BOUGHT, 0);

        return {
            currentTorch: Number.isFinite(currentTorch) ? Math.max(0, currentTorch) : 0,
            todayBought: Number.isFinite(todayBought) ? Math.min(Math.max(todayBought, 0), 3) : 0
        };
    }

    function syncTorchByBoughtChange(oldBought, newBought) {
        const oldValue = Math.min(Math.max(parseInt(oldBought || '0', 10) || 0, 0), 3);
        const newValue = Math.min(Math.max(parseInt(newBought || '0', 10) || 0, 0), 3);

        const deltaBought = newValue - oldValue;

        if (deltaBought === 0) return;

        const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
        const nextTorch = currentTorch + deltaBought * BUY_PER_TIME;

        setCurrentTorchValue(nextTorch);
    }

    function calculateDiamondCost(buyTimes, todayBought, futureRefreshCount) {
        const availableSlots = [];

        for (let i = todayBought; i < MAX_BUY_PER_DAY; i++) {
            availableSlots.push({
                label: `当前轮第${i + 1}次`,
                cost: BUY_COSTS[i]
            });
        }

        for (let day = 1; day <= futureRefreshCount; day++) {
            for (let i = 0; i < MAX_BUY_PER_DAY; i++) {
                availableSlots.push({
                    label: `后续第${day}轮第${i + 1}次`,
                    cost: BUY_COSTS[i]
                });
            }
        }

        availableSlots.sort((a, b) => a.cost - b.cost);

        const actualBuyTimes = Math.min(buyTimes, availableSlots.length);
        const selected = availableSlots.slice(0, actualBuyTimes);

        const totalCost = selected.reduce((sum, item) => sum + item.cost, 0);

        const count50 = selected.filter(item => item.cost === 50).length;
        const count100 = selected.filter(item => item.cost === 100).length;
        const count150 = selected.filter(item => item.cost === 150).length;

        return {
            totalCost,
            count50,
            count100,
            count150,
            actualBuyTimes,
            maxAvailableTimes: availableSlots.length
        };
    }

    function renderDiamondDetail(result) {
        const chips = [];

        if (result.count50 > 0) {
            chips.push(`
                <span class="gow-buy-chip">
                    <b>50钻</b> × ${result.count50}
                </span>
            `);
        }

        if (result.count100 > 0) {
            chips.push(`
                <span class="gow-buy-chip">
                    <b>100钻</b> × ${result.count100}
                </span>
            `);
        }

        if (result.count150 > 0) {
            chips.push(`
                <span class="gow-buy-chip">
                    <b>150钻</b> × ${result.count150}
                </span>
            `);
        }

        if (chips.length === 0) {
            return `<div class="gow-no-buy">无需购买任何档位</div>`;
        }

        return `<div class="gow-buy-chips">${chips.join('')}</div>`;
    }

    function getAvailableMapCellCount() {
        const cells = document.querySelectorAll('#underspire-map .cell');

        return Array.from(cells).filter(cell => {
            return !cell.classList.contains('none');
        }).length;
    }

    function updateCompletedSyncUi(message, isSuccess) {
        localStorage.setItem(STORAGE_LAST_COMPLETED_MSG, message);

        const status = document.querySelector('#gow-completed-sync-status');
        if (status) {
            status.textContent = message;
            status.style.color = isSuccess ? '#55736a' : '#b45309';
        }
    }

    function resetCompletedBaseline(showMessage = true) {
        const availableCellCount = getAvailableMapCellCount();
        const currentCompleted = getCompletedNodeCount();
        const baseline = getCompletedBaseline();

        const currentCycleKey = getCurrentWeeklyCycleKey();
        const savedCycleKey = localStorage.getItem(STORAGE_COMPLETED_CYCLE_KEY);

        // 地图尚未建立时不允许同步，避免把临时空页面当成0节点。
        if (availableCellCount === 0) {
            updateCompletedSyncUi('地图数据尚未加载完成，本次没有调整火把', false);
            return null;
        }

        // 首次使用新版，或已经跨过最近一次周一15点：
        // 周一火把归零/补发已由时间刷新逻辑处理。
        // 这里仅建立本周节点基准，不拿上周节点差额再次调整火把。
        if (!savedCycleKey || savedCycleKey !== currentCycleKey) {
            localStorage.setItem(STORAGE_COMPLETED_COUNT, String(currentCompleted));
            localStorage.setItem(STORAGE_COMPLETED_CYCLE_KEY, currentCycleKey);

            updateCompletedSyncUi(
                `已建立本周节点基准：完成节点${currentCompleted}个；火把已按周一刷新规则处理`,
                true
            );

            const infoPanel = document.querySelector('#underspire-info');
            if (infoPanel) {
                updatePurchasePlan(infoPanel);
            }

            return currentCompleted;
        }

        const delta = currentCompleted - baseline;

        // 同一周内完成节点理论上只会增加。
        // 节点突然减少通常是网页同步过程中的临时0、地图未恢复或数据异常。
        // 此时绝不自动“加回”火把，也不覆盖原基准。
        if (delta < 0) {
            updateCompletedSyncUi(
                `检测到节点由${baseline}降至${currentCompleted}，疑似网页未加载完成；本次未调整火把`,
                false
            );
            return null;
        }

        let msg = '完成节点无变化';

        if (delta > 0) {
            const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
            const nextTorch = Math.max(0, currentTorch - delta);

            setCurrentTorchValue(nextTorch);
            msg = `新增完成节点${delta}个，已扣除${delta}个火把`;
        }

        localStorage.setItem(STORAGE_COMPLETED_COUNT, String(currentCompleted));
        localStorage.setItem(STORAGE_COMPLETED_CYCLE_KEY, currentCycleKey);
        updateCompletedSyncUi(msg, true);

        const infoPanel = document.querySelector('#underspire-info');
        if (infoPanel) {
            updatePurchasePlan(infoPanel);
        }

        return currentCompleted;
    }



    function ensureControlStyles() {
        if (document.querySelector('#gow-control-styles')) return;

        const style = document.createElement('style');
        style.id = 'gow-control-styles';
        style.textContent = `
            #underspire-custom-controls {
                margin-top: 10px;
                padding-top: 8px;
                border-top: 1px solid rgba(0, 0, 0, 0.15);
                font-family: ${FONT_FAMILY};
                font-size: 14px;
                line-height: 1.45;
                white-space: normal;
            }

            #underspire-custom-controls .gow-control-panel {
                padding: 8px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.42);
            }

            #underspire-custom-controls .gow-control-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 8px;
            }

            #underspire-custom-controls .gow-control-row:last-child {
                margin-bottom: 0;
            }

            #underspire-custom-controls .gow-control-label {
                flex: 0 0 78px;
                font-size: 12px;
                color: #66757d;
                text-align: left;
            }

            #underspire-custom-controls .gow-field-wrap {
                flex: 0 0 126px;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            #underspire-custom-controls .gow-field-wrap input,
            #underspire-custom-controls .gow-field-wrap select {
                width: 100%;
                height: 38px;
                padding: 0 10px;
                border: 1px solid rgba(84, 105, 116, 0.28);
                border-radius: 8px;
                outline: none;
                background: #fff;
                color: #243238;
                font-family: ${FONT_FAMILY};
                font-size: 22px;
                font-weight: 700;
                text-align: center;
                box-sizing: border-box;
            }

            #underspire-custom-controls .gow-field-wrap select {
                font-size: 18px;
                cursor: pointer;
            }

            #underspire-custom-controls .gow-field-wrap input:focus,
            #underspire-custom-controls .gow-field-wrap select:focus {
                border-color: rgba(68, 129, 135, 0.55);
                box-shadow: 0 0 0 2px rgba(95, 143, 146, 0.14);
            }

            #underspire-custom-controls .gow-input-unit {
                min-width: 16px;
                font-size: 12px;
                color: #6b7780;
                text-align: center;
            }
        `;

        document.head.appendChild(style);
    }


    function createCustomControls(infoPanel) {
        if (!infoPanel) return null;

        ensureControlStyles();

        let controls = document.querySelector('#underspire-custom-controls');

        if (controls && controls.parentElement !== infoPanel) {
            controls.remove();
            controls = null;
        }

        if (controls) {
            refreshControlValues();
            return controls;
        }

        controls = document.createElement('div');
        controls.id = 'underspire-custom-controls';

        const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
        const todayBought = getNumberFromStorage(STORAGE_TODAY_BOUGHT, 0);

        controls.innerHTML = `
            <div class="gow-control-panel">
                <div class="gow-control-row">
                    <div class="gow-control-label">当前火把</div>
                    <div class="gow-field-wrap">
                        <input id="gow-current-torch" type="number" min="0" value="${currentTorch}">
                        <span class="gow-input-unit">个</span>
                    </div>
                </div>

                <div class="gow-control-row">
                    <div class="gow-control-label">本轮已购</div>
                    <div class="gow-field-wrap">
                        <select id="gow-today-bought">
                            <option value="0" ${todayBought === 0 ? 'selected' : ''}>0次</option>
                            <option value="1" ${todayBought === 1 ? 'selected' : ''}>1次</option>
                            <option value="2" ${todayBought === 2 ? 'selected' : ''}>2次</option>
                            <option value="3" ${todayBought === 3 ? 'selected' : ''}>3次</option>
                        </select>
                    </div>
                </div>
            </div>


        `;

        infoPanel.appendChild(controls);

        const inputTorch = controls.querySelector('#gow-current-torch');
        const selectBought = controls.querySelector('#gow-today-bought');

        selectBought.dataset.lastValue = String(todayBought);

        const commitManualTorch = () => {
            setCurrentTorchValue(inputTorch.value || '0');

            localStorage.setItem(STORAGE_COMPLETED_COUNT, String(getCompletedNodeCount()));
            localStorage.setItem(STORAGE_COMPLETED_CYCLE_KEY, getCurrentWeeklyCycleKey());
            localStorage.setItem(
                STORAGE_LAST_COMPLETED_MSG,
                `已按当前火把重设节点基准：${getCompletedNodeCount()}个`
            );

            resetCompletedBaseline(false);
            updatePurchasePlan(infoPanel);
        };

        inputTorch.addEventListener('input', () => {
            const rawValue = inputTorch.value.trim();
            if (rawValue === '') return;

            const safeValue = Math.max(0, parseInt(rawValue, 10) || 0);
            localStorage.setItem(STORAGE_CURRENT_TORCH, String(safeValue));
            updatePurchasePlan(infoPanel);
        });

        inputTorch.addEventListener('change', commitManualTorch);
        inputTorch.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                inputTorch.blur();
            }
        });

        selectBought.addEventListener('change', () => {
            const oldBought = selectBought.dataset.lastValue || localStorage.getItem(STORAGE_TODAY_BOUGHT) || '0';
            const newBought = selectBought.value || '0';

            syncTorchByBoughtChange(oldBought, newBought);
            localStorage.setItem(STORAGE_TODAY_BOUGHT, newBought);
            localStorage.setItem(STORAGE_ROUND_KEY, getCurrentRoundKey());
            selectBought.dataset.lastValue = newBought;

            resetCompletedBaseline(false);
            updatePurchasePlan(infoPanel);
        });

        return controls;
    }

    function refreshControlValues() {
        const inputTorch = document.querySelector('#gow-current-torch');
        const selectBought = document.querySelector('#gow-today-bought');
        const completedSyncStatus = document.querySelector('#gow-completed-sync-status');

        const currentTorch = getNumberFromStorage(STORAGE_CURRENT_TORCH, 0);
        const todayBought = getNumberFromStorage(STORAGE_TODAY_BOUGHT, 0);

        if (inputTorch && inputTorch.value !== String(currentTorch)) {
            inputTorch.value = String(currentTorch);
        }

        if (selectBought && selectBought.value !== String(todayBought)) {
            selectBought.value = String(todayBought);
            selectBought.dataset.lastValue = String(todayBought);
        }

        if (completedSyncStatus) {
            completedSyncStatus.textContent =
                localStorage.getItem(STORAGE_LAST_COMPLETED_MSG) || '尚未同步完成节点';
        }
    }

    function getMapSnapshot() {
        const infoPanel = document.querySelector('#underspire-info');
        const availableCellCount = getAvailableMapCellCount();
        const completedCount = getCompletedNodeCount();
        const totalNeed = parseTotalNeed(infoPanel);

        return {
            availableCellCount,
            completedCount,
            totalNeed,
            signature: `${availableCellCount}|${completedCount}|${totalNeed === null ? 'null' : totalNeed}`
        };
    }

    let initialRouteWatchTimer = null;
    let initialRouteWatchToken = 0;

    function ensureRouteNavigationStyles() {
        if (document.querySelector('#gow-route-navigation-styles')) return;

        const style = document.createElement('style');
        style.id = 'gow-route-navigation-styles';
        style.textContent = `
            #underspire-map .cell.gow-nav-route,
            #underspire-map .cell.gow-nav-branch,
            #underspire-map .cell.gow-nav-start,
            #underspire-map .cell.gow-nav-end,
            #underspire-map .cell.gow-nav-guardian {
                position: relative !important;
                overflow: visible !important;
            }

            #underspire-map .cell.gow-nav-route {
                z-index: 4;
            }

            /* 保留网页 .main 数据供寻路使用，但隐藏其原生天蓝色视觉，避免与插件路线冲突。 */
            #underspire-map.gow-nav-clean-native-main .cell.main {
                background: transparent !important;
                box-shadow: none !important;
            }

            #underspire-map.gow-nav-clean-native-main .cell-path.main:not(.gow-nav-route-path):not(.gow-nav-branch-path) {
                background: var(--gow-neutral-path-color, #929799) !important;
                box-shadow: none !important;
                filter: none !important;
                opacity: 1 !important;
            }

            #underspire-map .cell.gow-nav-route .cell-core {
                box-shadow:
                    inset 0 0 0 4px rgba(243, 158, 18, 0.98),
                    0 0 12px 4px rgba(243, 158, 18, 0.58) !important;
                border-radius: 6px;
                filter: brightness(1.10) saturate(1.12);
            }

            #underspire-map .cell-path.gow-nav-route-path {
                background: #f39e12 !important;
                box-shadow:
                    0 0 7px 2px rgba(243, 158, 18, 0.98),
                    0 0 14px 4px rgba(243, 158, 18, 0.48) !important;
                opacity: 1 !important;
                filter: brightness(1.08) saturate(1.18);
            }

            /* 主线路与收益支线分离显示：主线橙色，守卫支线浅蓝色 */
            #underspire-map .cell.gow-nav-branch .cell-core {
                box-shadow:
                    inset 0 0 0 3px rgba(76, 150, 220, 0.75),
                    0 0 8px 2px rgba(76, 150, 220, 0.35) !important;
                filter: brightness(1.05) saturate(1.05);
            }

            #underspire-map .cell-path.gow-nav-branch-path {
                background: #7bb7e8 !important;
                box-shadow: 0 0 5px 1px rgba(76, 150, 220, 0.55) !important;
                opacity: 0.75 !important;
            }

            #underspire-map .cell.gow-nav-start {
                z-index: 8;
            }

            #underspire-map .cell.gow-nav-start .cell-core {
                box-shadow:
                    inset 0 0 0 5px rgba(37, 112, 181, 1),
                    0 0 16px 5px rgba(37, 112, 181, 0.82) !important;
                filter: brightness(1.18) saturate(1.20);
            }

            #underspire-map .cell.gow-nav-end {
                z-index: 8;
            }

            #underspire-map .cell.gow-nav-end .cell-core {
                box-shadow:
                    inset 0 0 0 5px rgba(210, 63, 52, 1),
                    0 0 16px 5px rgba(210, 63, 52, 0.82) !important;
                filter: brightness(1.18) saturate(1.20);
            }

            #underspire-map .cell.gow-nav-guardian {
                z-index: 7;
            }

            #underspire-map .cell.gow-nav-guardian .cell-core {
                box-shadow:
                    inset 0 0 0 4px rgba(35, 105, 190, 0.98),
                    0 0 13px 4px rgba(35, 105, 190, 0.68) !important;
                filter: brightness(1.15) saturate(1.15);
            }

            #underspire-map .gow-nav-badge {
                position: absolute;
                z-index: 30;
                min-width: 44px;
                padding: 5px 9px;
                border-radius: 999px;
                border: 2px solid rgba(255,255,255,0.96);
                box-shadow: 0 3px 9px rgba(0,0,0,0.34);
                color: #fff;
                font-family: ${FONT_FAMILY};
                font-size: 15px;
                font-weight: 900;
                line-height: 1.05;
                text-align: center;
                white-space: nowrap;
                pointer-events: none;
                text-shadow: 0 1px 2px rgba(0,0,0,0.28);
            }

            /* 起点直接压在当前格子上，避免遮挡周边线路。 */
            #underspire-map .gow-nav-badge.is-start {
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                min-width: 34px;
                padding: 3px 6px;
                font-size: 12px;
                border-width: 1px;
                background: rgba(37, 112, 181, 0.96);
                box-shadow: 0 2px 7px rgba(0,0,0,0.34);
            }

            /* 守卫/终点使用一体式标记：火把消耗在上，名称在下。 */
            #underspire-map .gow-nav-marker {
                position: absolute;
                z-index: 34;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                white-space: nowrap;
                pointer-events: none;
                font-family: ${FONT_FAMILY};
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.34));
            }

            /* 标签位置由JS按真实屏幕碰撞结果动态计算；始终以目标节点作为定位父级。 */
            #underspire-map .gow-nav-marker {
                will-change: left, right, top, bottom, transform;
            }

            /* 当四周都没有无遮挡位置时，将标签放到较远的空白位置，并用细指示线明确归属。 */
            #underspire-map .gow-nav-connector {
                position: absolute;
                left: 50%;
                top: 50%;
                height: 2px;
                transform-origin: 0 50%;
                z-index: 32;
                border-radius: 999px;
                pointer-events: none;
                opacity: 0.86;
                background: currentColor;
                box-shadow: 0 0 4px rgba(0,0,0,0.20);
            }

            #underspire-map .gow-nav-connector::after {
                content: '';
                position: absolute;
                right: -1px;
                top: 50%;
                width: 6px;
                height: 6px;
                border-top: 2px solid currentColor;
                border-right: 2px solid currentColor;
                transform: translateY(-50%) rotate(45deg);
                transform-origin: center;
            }

            #underspire-map .gow-nav-connector.is-end {
                color: rgba(201, 63, 53, 0.92);
            }

            #underspire-map .gow-nav-connector.is-guardian {
                color: rgba(37, 102, 173, 0.90);
            }

            #underspire-map .gow-nav-marker-cost,
            #underspire-map .gow-nav-marker-label {
                border: 1.5px solid rgba(255,255,255,0.98);
                border-radius: 7px;
                color: #fff;
                font-weight: 900;
                line-height: 1.08;
                text-align: center;
                letter-spacing: 0.15px;
                text-shadow: 0 1px 2px rgba(0,0,0,0.40);
                box-shadow: 0 2px 5px rgba(0,0,0,0.28);
            }

            #underspire-map .gow-nav-marker-cost {
                min-width: 38px;
                padding: 4px 7px;
                font-size: 13px;
            }

            #underspire-map .gow-nav-marker-label {
                min-width: 42px;
                padding: 4px 8px;
                font-size: 13px;
            }

            #underspire-map .gow-nav-marker.is-end .gow-nav-marker-label {
                background: #c93f35;
                border-color: rgba(255,238,235,1);
            }

            #underspire-map .gow-nav-marker.is-end .gow-nav-marker-cost {
                background: #782c28;
                color: #fff5d6;
                border-color: rgba(255,238,235,1);
            }

            #underspire-map .gow-nav-marker.is-guardian .gow-nav-marker-label {
                background: #2566ad;
                border-color: rgba(235,246,255,1);
            }

            #underspire-map .gow-nav-marker.is-guardian .gow-nav-marker-cost {
                background: #173f73;
                color: #fff5d6;
                border-color: rgba(235,246,255,1);
            }
        `;
        document.head.appendChild(style);
    }

    function clearRouteNavigation() {
        document.querySelectorAll('#underspire-map .gow-nav-badge, #underspire-map .gow-nav-marker, #underspire-map .gow-nav-connector, #underspire-map .gow-nav-cost-badge')
            .forEach(node => node.remove());
        document.querySelectorAll('#underspire-map .cell.gow-nav-route, #underspire-map .cell.gow-nav-branch, #underspire-map .cell.gow-nav-start, #underspire-map .cell.gow-nav-end, #underspire-map .cell.gow-nav-guardian')
            .forEach(cell => cell.classList.remove('gow-nav-route', 'gow-nav-branch', 'gow-nav-start', 'gow-nav-end', 'gow-nav-guardian'));
        document.querySelectorAll('#underspire-map .cell-path.gow-nav-route-path, #underspire-map .cell-path.gow-nav-branch-path')
            .forEach(path => path.classList.remove('gow-nav-route-path', 'gow-nav-branch-path'));
        restoreRouteNavigationTitles();
    }

    function getRouteCellPosition(cell) {
        if (!cell || !cell.id) return null;
        const match = cell.id.match(/^underspire-map-cell-(\d+)$/);
        if (!match) return null;
        const node = parseInt(match[1], 10);
        if (!Number.isFinite(node)) return null;
        return {
            node,
            row: Math.floor(node / 100),
            col: node % 100
        };
    }

    function getRouteCellKey(row, col) {
        return `${row},${col}`;
    }

    function getRouteDirection(from, to) {
        const dr = to.row - from.row;
        const dc = to.col - from.col;
        if (dr === -1 && dc === 0) return { name: 'up', opposite: 'down' };
        if (dr === 1 && dc === 0) return { name: 'down', opposite: 'up' };
        if (dr === 0 && dc === -1) return { name: 'left', opposite: 'right' };
        if (dr === 0 && dc === 1) return { name: 'right', opposite: 'left' };
        return null;
    }

    function getRouteNeighbors(item, mapByKey) {
        const steps = [
            { dr: -1, dc: 0, name: 'up', opposite: 'down' },
            { dr: 1, dc: 0, name: 'down', opposite: 'up' },
            { dr: 0, dc: -1, name: 'left', opposite: 'right' },
            { dr: 0, dc: 1, name: 'right', opposite: 'left' }
        ];

        const neighbors = [];
        for (const step of steps) {
            if (!item.cell.classList.contains(step.name)) continue;
            const next = mapByKey.get(getRouteCellKey(item.row + step.dr, item.col + step.dc));
            if (!next) continue;
            if (!next.cell.classList.contains(step.opposite)) continue;
            neighbors.push(next);
        }
        return neighbors;
    }

    function buildRouteMap() {
        const cells = Array.from(document.querySelectorAll('#underspire-map .cell'))
            .filter(cell => !cell.classList.contains('none'));
        const items = [];
        const mapByKey = new Map();
        cells.forEach(cell => {
            const pos = getRouteCellPosition(cell);
            if (!pos) return;
            const item = { ...pos, cell };
            items.push(item);
            mapByKey.set(getRouteCellKey(item.row, item.col), item);
        });
        return { items, mapByKey };
    }

    function getRouteInterestScore(path) {
        const guardianEnabled = !!document.querySelector('#icb-guardian')?.checked;
        const treasureEnabled = !!document.querySelector('#icb-guardian-90')?.checked;
        const trapEnabled = !!document.querySelector('#icb-trap-90')?.checked;

        let score = 0;
        path.forEach(item => {
            const cell = item.cell;
            if (cell.classList.contains('guardian-90') && treasureEnabled) score += 4;
            if (cell.classList.contains('guardian') && guardianEnabled) score += 3;
            if (cell.classList.contains('shop')) score += 2;
            if (cell.classList.contains('gate')) score += 1;
            if (cell.classList.contains('trap-90')) score += trapEnabled ? 1 : -3;
        });
        return score;
    }

    function getBossOrder(cell) {
        const text = (cell.querySelector('.cell-core')?.textContent || '').trim().toUpperCase();
        if (text === 'F') return 999;
        const value = parseInt(text, 10);
        return Number.isFinite(value) ? value : 500;
    }

    function findBestMainRoute() {
        const { items, mapByKey } = buildRouteMap();
        if (!items.length) return null;

        const completedItems = items.filter(item => item.cell.classList.contains('completed'));
        const entrance = items.find(item => (item.cell.querySelector('.cell-core')?.textContent || '').trim() === '入');

        let starts = completedItems.filter(item =>
            getRouteNeighbors(item, mapByKey).some(next =>
                !next.cell.classList.contains('completed') &&
                (next.cell.classList.contains('main') || next.cell.classList.contains('boss'))
            )
        );

        if (!starts.length && entrance) starts = [entrance];
        if (!starts.length && completedItems.length) starts = [completedItems[completedItems.length - 1]];
        if (!starts.length) return null;

        const bosses = items.filter(item =>
            item.cell.classList.contains('boss') && !item.cell.classList.contains('completed')
        );
        if (!bosses.length) return null;

        // 重点房间必须按进度顺序处理：数字小的优先，F 永远最后。
        // 不能再按“离当前起点最近”来选终点，否则可能提前规划到 F，
        // 但实际游戏中仍需要先通过前面的数字重点房间（例如 6）才能继续。
        const targetOrder = Math.min(...bosses.map(item => getBossOrder(item.cell)));
        const targetBosses = bosses.filter(item => getBossOrder(item.cell) === targetOrder);
        const targetBossKeys = new Set(targetBosses.map(item => getRouteCellKey(item.row, item.col)));

        const searchTarget = restrictToMain => {
            const queue = [];
            const visited = new Map();

            starts.forEach(start => {
                const key = getRouteCellKey(start.row, start.col);
                if (visited.has(key)) return;
                visited.set(key, { prev: null, distance: 0, sourceKey: key });
                queue.push(start);
            });

            let minimumDistance = Infinity;
            const reachedTargets = [];
            let head = 0;

            while (head < queue.length) {
                const current = queue[head++];
                const currentKey = getRouteCellKey(current.row, current.col);
                const currentState = visited.get(currentKey);
                if (!currentState) continue;
                if (currentState.distance > minimumDistance) break;

                if (targetBossKeys.has(currentKey) && currentState.distance > 0) {
                    minimumDistance = currentState.distance;
                    reachedTargets.push(current);
                    continue;
                }

                for (const next of getRouteNeighbors(current, mapByKey)) {
                    const nextKey = getRouteCellKey(next.row, next.col);
                    if (visited.has(nextKey)) continue;
                    if (next.cell.classList.contains('completed')) continue;

                    if (restrictToMain && !next.cell.classList.contains('main') && !next.cell.classList.contains('boss')) {
                        continue;
                    }

                    // 在抵达当前优先重点房间之前，不允许穿过更靠后的重点房间。
                    // 例如当前应先去 6，则不能为了“更短”先经过 F 再回到 6。
                    if (next.cell.classList.contains('boss')) {
                        const nextOrder = getBossOrder(next.cell);
                        if (nextOrder > targetOrder && !targetBossKeys.has(nextKey)) continue;
                    }

                    visited.set(nextKey, {
                        prev: currentKey,
                        distance: currentState.distance + 1,
                        sourceKey: currentState.sourceKey
                    });
                    queue.push(next);
                }
            }

            return { reachedTargets, visited };
        };

        // 优先走网页自身 main 主线路；极少数页面 main 标记异常时，再退化到普通连通图。
        let searchResult = searchTarget(true);
        if (!searchResult.reachedTargets.length) {
            searchResult = searchTarget(false);
        }
        if (!searchResult.reachedTargets.length) return null;

        const reconstruct = end => {
            const result = [];
            let key = getRouteCellKey(end.row, end.col);
            while (key) {
                const item = mapByKey.get(key);
                if (item) result.push(item);
                const state = searchResult.visited.get(key);
                key = state?.prev || null;
            }
            return result.reverse();
        };

        const candidates = searchResult.reachedTargets.map(end => {
            const path = reconstruct(end);
            return {
                end,
                path,
                distance: path.length - 1,
                bossOrder: getBossOrder(end.cell),
                interestScore: getRouteInterestScore(path)
            };
        });

        // 同一个优先级重点房间存在多条可能路线时，才比较距离和沿途收益。
        candidates.sort((a, b) =>
            a.distance - b.distance ||
            b.interestScore - a.interestScore
        );

        const best = candidates[0];
        if (!best || best.path.length < 2) return null;
        return {
            start: best.path[0],
            end: best.end,
            path: best.path,
            distance: best.distance,
            interestScore: best.interestScore,
            targetOrder,
            items,
            mapByKey
        };
    }



    // 重点房间全部完成后的守卫清理模式。
    // 与常规守卫导航保持同一口径：每个守卫都从当前清理起点独立计算完整路线和火把消耗。
    // 多条守卫路线即使互相重合，也不会跨线路合并或抵扣火把。
    function getCleanupCompletedGuardianKeys(items) {
        return items
            .filter(item =>
                item.cell.classList.contains('guardian') &&
                item.cell.classList.contains('completed')
            )
            .map(item => getRouteCellKey(item.row, item.col));
    }

    function readCleanupCompletedSnapshot() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_GUARDIAN_CLEANUP_COMPLETED) || '[]');
            return Array.isArray(raw) ? raw.filter(value => typeof value === 'string') : [];
        } catch (error) {
            return [];
        }
    }

    function saveCleanupCompletedSnapshot(items) {
        localStorage.setItem(
            STORAGE_GUARDIAN_CLEANUP_COMPLETED,
            JSON.stringify(getCleanupCompletedGuardianKeys(items))
        );
    }

    function getGraphStepDistance(start, target, mapByKey) {
        if (!start || !target) return Number.POSITIVE_INFINITY;
        const startKey = getRouteCellKey(start.row, start.col);
        const targetKey = getRouteCellKey(target.row, target.col);
        if (startKey === targetKey) return 0;

        const queue = [start];
        const visited = new Set([startKey]);
        let head = 0;
        let steps = 0;

        while (head < queue.length) {
            const levelEnd = queue.length;
            steps++;
            while (head < levelEnd) {
                const current = queue[head++];
                for (const next of getRouteNeighbors(current, mapByKey)) {
                    const nextKey = getRouteCellKey(next.row, next.col);
                    if (visited.has(nextKey)) continue;
                    if (nextKey === targetKey) return steps;
                    visited.add(nextKey);
                    queue.push(next);
                }
            }
        }

        return Number.POSITIVE_INFINITY;
    }

    function getGuardianCleanupStart(items, mapByKey) {
        const itemByKey = new Map(items.map(item => [getRouteCellKey(item.row, item.col), item]));
        const completedGuardianKeys = getCleanupCompletedGuardianKeys(items);
        const previousCompleted = new Set(readCleanupCompletedSnapshot());
        const savedStartKey = localStorage.getItem(STORAGE_GUARDIAN_CLEANUP_START) || '';
        const savedStart = itemByKey.get(savedStartKey) || null;

        // 同步后若出现新完成守卫，认为玩家已经走到该守卫。
        // 正常情况下每次只新增一个；若一次新增多个，则选离上一个起点最远的一个，近似最后抵达位置。
        const newlyCompleted = completedGuardianKeys
            .filter(key => !previousCompleted.has(key))
            .map(key => itemByKey.get(key))
            .filter(Boolean);

        let start = null;
        if (newlyCompleted.length === 1) {
            start = newlyCompleted[0];
        } else if (newlyCompleted.length > 1 && savedStart) {
            newlyCompleted.sort((a, b) =>
                getGraphStepDistance(savedStart, b, mapByKey) -
                getGraphStepDistance(savedStart, a, mapByKey)
            );
            start = newlyCompleted[0];
        } else if (newlyCompleted.length > 1) {
            start = newlyCompleted[newlyCompleted.length - 1];
        }

        // 没有新完成守卫时沿用上一次清理起点。
        if (!start && savedStart && savedStart.cell.classList.contains('completed')) {
            start = savedStart;
        }

        // 第一次进入清理模式默认从已完成的F房间开始。
        if (!start) {
            start = items.find(item =>
                item.cell.classList.contains('boss') &&
                item.cell.classList.contains('completed') &&
                (item.cell.querySelector('.cell-core')?.textContent || '').trim().toUpperCase() === 'F'
            ) || null;
        }

        // 极端情况下没有F，则取数字最大的已完成重点房间。
        if (!start) {
            const completedBosses = items
                .filter(item => item.cell.classList.contains('boss') && item.cell.classList.contains('completed'))
                .sort((a, b) => getBossOrder(b.cell) - getBossOrder(a.cell));
            start = completedBosses[0] || null;
        }

        // 再退化到入口或任意已完成节点，保证仍尽量能给出线路。
        if (!start) {
            start = items.find(item =>
                (item.cell.querySelector('.cell-core')?.textContent || '').trim() === '入'
            ) || items.find(item => item.cell.classList.contains('completed')) || null;
        }

        if (start) {
            localStorage.setItem(STORAGE_GUARDIAN_CLEANUP_START, getRouteCellKey(start.row, start.col));
        }
        saveCleanupCompletedSnapshot(items);
        return start;
    }

    function getCleanupEnterTorchCost(item) {
        if (!item) return 0;
        if (item.cell.classList.contains('completed')) return 0;
        const core = (item.cell.querySelector('.cell-core')?.textContent || '').trim();
        return core === '送' ? 0 : 1;
    }

    // 使用“火把消耗优先、步数次优”的最短路。
    // 因为已完成房间和“送”房间进入成本为0，所以不能只按普通格数BFS。
    function findCleanupGuardianPath(start, guardian, mapByKey) {
        if (!start || !guardian) return null;

        const startKey = getRouteCellKey(start.row, start.col);
        const targetKey = getRouteCellKey(guardian.row, guardian.col);
        const best = new Map([[startKey, { cost: 0, steps: 0, prev: null }]]);
        const queue = [{ item: start, cost: 0, steps: 0 }];

        while (queue.length) {
            queue.sort((a, b) => a.cost - b.cost || a.steps - b.steps);
            const state = queue.shift();
            const current = state.item;
            const currentKey = getRouteCellKey(current.row, current.col);
            const known = best.get(currentKey);
            if (!known || known.cost !== state.cost || known.steps !== state.steps) continue;
            if (currentKey === targetKey) break;

            for (const next of getRouteNeighbors(current, mapByKey)) {
                const nextKey = getRouteCellKey(next.row, next.col);
                const nextCost = state.cost + getCleanupEnterTorchCost(next);
                const nextSteps = state.steps + 1;
                const old = best.get(nextKey);

                if (old && (old.cost < nextCost || (old.cost === nextCost && old.steps <= nextSteps))) {
                    continue;
                }

                best.set(nextKey, {
                    cost: nextCost,
                    steps: nextSteps,
                    prev: currentKey
                });
                queue.push({ item: next, cost: nextCost, steps: nextSteps });
            }
        }

        const targetState = best.get(targetKey);
        if (!targetState) return null;

        const path = [];
        let key = targetKey;
        while (key) {
            const item = mapByKey.get(key);
            if (item) path.push(item);
            key = best.get(key)?.prev || null;
        }
        path.reverse();

        return {
            guardian,
            path,
            cost: getLineTorchCost(path, true),
            steps: Math.max(0, path.length - 1)
        };
    }

    function showRemainingGuardiansAfterMainComplete(mapData = null) {
        const data = mapData || buildRouteMap();
        const items = Array.isArray(data?.items) ? data.items : [];
        const mapByKey = data?.mapByKey instanceof Map ? data.mapByKey : new Map();
        if (!items.length) return null;

        const unfinishedBosses = items.filter(item =>
            item.cell.classList.contains('boss') &&
            !item.cell.classList.contains('completed')
        );
        if (unfinishedBosses.length) return null;

        const unfinishedGuardians = items.filter(item =>
            item.cell.classList.contains('guardian') &&
            !item.cell.classList.contains('completed')
        );

        if (!unfinishedGuardians.length) {
            localStorage.removeItem(STORAGE_GUARDIAN_CLEANUP_START);
            localStorage.removeItem(STORAGE_GUARDIAN_CLEANUP_COMPLETED);
            return {
                mode: 'all-complete',
                items,
                mapByKey,
                guardians: [],
                guardianBranches: [],
                path: []
            };
        }

        const start = getGuardianCleanupStart(items, mapByKey);
        const routes = start
            ? unfinishedGuardians
                .map(guardian => findCleanupGuardianPath(start, guardian, mapByKey))
                .filter(Boolean)
                .sort((a, b) => a.cost - b.cost || a.steps - b.steps)
            : [];

        // 所有守卫路线都按常规守卫支线的浅蓝色显示。
        // 每条路线独立计算，重合部分仅在视觉上重合，不改变各自的火把数字。
        routes.forEach(item => highlightRoutePath(item.path, 'branch'));

        if (start) {
            start.cell.classList.add('gow-nav-start');
            addRouteBadge(start.cell, '起点', 'start');
            setRouteNavigationTitle(start.cell, `守卫清理起点；剩余 ${unfinishedGuardians.length} 个守卫`);
        }

        unfinishedGuardians.forEach(guardian => {
            guardian.cell.classList.add('gow-nav-guardian');
            const routeInfo = routes.find(item => item.guardian === guardian) || null;
            const cost = routeInfo ? routeInfo.cost : null;
            addRouteMarker(guardian.cell, '守卫', cost, 'guardian');

            if (routeInfo) {
                setRouteNavigationTitle(
                    guardian.cell,
                    `守卫清理：从当前起点独立预计需要 ${routeInfo.cost} 个火把；路线 ${routeInfo.steps} 步`
                );
            } else {
                setRouteNavigationTitle(guardian.cell, '重点房间已全部完成；此守卫尚未处理，但当前未找到可用线路');
            }
        });

        return {
            mode: 'guardian-cleanup',
            start,
            items,
            mapByKey,
            guardians: unfinishedGuardians,
            guardianBranches: routes.map(item => ({
                guardian: item.guardian,
                anchor: start,
                path: item.path,
                addedTorch: item.cost,
                steps: item.steps
            })),
            path: []
        };
    }

    function findGuardianBranch(anchorCandidates, guardian, mapByKey, maxSteps = 5) {
        const targetKey = getRouteCellKey(guardian.row, guardian.col);
        let best = null;

        for (const anchor of anchorCandidates) {
            const startKey = getRouteCellKey(anchor.row, anchor.col);
            const queue = [anchor];
            const visited = new Map([[startKey, { prev: null, steps: 0 }]]);
            let head = 0;

            while (head < queue.length) {
                const current = queue[head++];
                const currentKey = getRouteCellKey(current.row, current.col);
                const state = visited.get(currentKey);
                if (!state || state.steps >= maxSteps) continue;

                for (const next of getRouteNeighbors(current, mapByKey)) {
                    const nextKey = getRouteCellKey(next.row, next.col);
                    if (visited.has(nextKey)) continue;
                    if (next.cell.classList.contains('boss') && nextKey !== targetKey) continue;

                    visited.set(nextKey, { prev: currentKey, steps: state.steps + 1 });

                    if (nextKey === targetKey) {
                        const path = [];
                        let key = nextKey;
                        while (key) {
                            const item = mapByKey.get(key);
                            if (item) path.push(item);
                            key = visited.get(key)?.prev || null;
                        }
                        path.reverse();

                        // 这条守卫支线的成本只按“本支线自身”计算。
                        // path[0] 是支线接入点，人在该点开始走支线，因此不重复消耗火把。
                        // 不参考主线或其它守卫支线是否经过相同节点，也不做跨线路合并/抵扣。
                        const addedTorch = getLineTorchCost(path, true);

                        const candidate = {
                            anchor,
                            guardian,
                            path,
                            steps: path.length - 1,
                            addedTorch
                        };

                        if (!best ||
                            candidate.addedTorch < best.addedTorch ||
                            (candidate.addedTorch === best.addedTorch && candidate.steps < best.steps)) {
                            best = candidate;
                        }
                        head = queue.length;
                        break;
                    }
                    queue.push(next);
                }
            }
        }

        return best;
    }

    function attachNearbyGuardians(route) {
        const guardianEnabled = !!document.querySelector('#icb-guardian')?.checked;
        if (!guardianEnabled) {
            route.guardianBranches = [];
            route.guardians = route.path.filter(item => item.cell.classList.contains('guardian'));
            return route;
        }

        const baseKeys = new Set(route.path.map(item => getRouteCellKey(item.row, item.col)));
        const alreadyOnRoute = route.path.filter(item => item.cell.classList.contains('guardian'));
        const guardians = route.items.filter(item =>
            item.cell.classList.contains('guardian') &&
            !item.cell.classList.contains('completed') &&
            !baseKeys.has(getRouteCellKey(item.row, item.col))
        );

        const branches = [];
        const usedGuardians = new Set();

        // 仅纳入真正“顺路”的守卫：距离主线最多5格。
        for (const guardian of guardians) {
            const branch = findGuardianBranch(route.path, guardian, route.mapByKey, 5);
            if (!branch) continue;

            const key = getRouteCellKey(guardian.row, guardian.col);
            if (usedGuardians.has(key)) continue;
            usedGuardians.add(key);
            branches.push(branch);
        }

        // 如果同一区域有多个守卫，优先保留更省火把、更靠近主线的，最多规划3个，避免地图过于杂乱。
        branches.sort((a, b) =>
            a.addedTorch - b.addedTorch ||
            a.steps - b.steps
        );

        route.guardianBranches = branches.slice(0, 3);
        route.guardians = [
            ...alreadyOnRoute,
            ...route.guardianBranches.map(branch => branch.guardian)
        ];
        return route;
    }

    function addRouteBadge(cell, text, type) {
        if (!cell) return;
        const badge = document.createElement('div');
        let cls = 'is-end';
        if (type === 'start') cls = 'is-start';
        if (type === 'guardian') cls = 'is-guardian';
        badge.className = `gow-nav-badge ${cls}`;
        badge.textContent = text;
        cell.appendChild(badge);
    }

    function getRectOverlapArea(a, b, padding = 2) {
        const left = Math.max(a.left - padding, b.left - padding);
        const right = Math.min(a.right + padding, b.right + padding);
        const top = Math.max(a.top - padding, b.top - padding);
        const bottom = Math.min(a.bottom + padding, b.bottom + padding);
        if (right <= left || bottom <= top) return 0;
        return (right - left) * (bottom - top);
    }

    function isConnectedRoutePathElement(path) {
        if (!path?.classList) return false;
        const cell = path.closest('.cell');
        if (!cell || cell.classList.contains('none')) return false;
        for (const dir of ['up', 'right', 'down', 'left']) {
            if (path.classList.contains(dir) && cell.classList.contains(dir)) return true;
        }
        return false;
    }

    function getRouteMarkerObstacleRects(currentMarker) {
        const map = document.querySelector('#underspire-map');
        if (!map) return [];

        const obstacles = [];

        // 所有真实存在的线路均视为障碍。包括普通灰线、主线、守卫支线。
        map.querySelectorAll('.cell-path').forEach(path => {
            if (!isConnectedRoutePathElement(path)) return;
            const style = getComputedStyle(path);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') <= 0.02) return;
            const rect = path.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) obstacles.push({ rect, weight: 5 });
        });

        // 房间色块本身也尽量不遮挡。
        map.querySelectorAll('.cell:not(.none) .cell-core').forEach(core => {
            const rect = core.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) obstacles.push({ rect, weight: 3 });
        });

        // 已放置的导航标签也互相避让。
        map.querySelectorAll('.gow-nav-marker').forEach(marker => {
            if (marker === currentMarker) return;
            const rect = marker.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) obstacles.push({ rect, weight: 8 });
        });

        return obstacles;
    }

    function applyRouteMarkerCandidate(marker, candidate) {
        marker.style.left = '';
        marker.style.right = '';
        marker.style.top = '';
        marker.style.bottom = '';
        marker.style.transform = '';

        Object.entries(candidate.style).forEach(([key, value]) => {
            marker.style[key] = value;
        });
    }

    function getRouteMarkerCandidates() {
        // 第一层：紧贴目标节点的四个方向。只有完全不遮线路/色块时才使用。
        const near = [
            { name: 'top', connector: false, style: { left: '50%', bottom: 'calc(100% + 5px)', transform: 'translateX(-50%)' } },
            { name: 'right', connector: false, style: { left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' } },
            { name: 'left', connector: false, style: { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' } },
            { name: 'bottom', connector: false, style: { left: '50%', top: 'calc(100% + 5px)', transform: 'translateX(-50%)' } },
        ];

        // 第二层：四个斜角。开始使用指示线，保证标签归属明确。
        const diagonal = [
            { name: 'top-right', connector: true, style: { left: 'calc(100% + 10px)', bottom: 'calc(100% + 10px)' } },
            { name: 'top-left', connector: true, style: { right: 'calc(100% + 10px)', bottom: 'calc(100% + 10px)' } },
            { name: 'bottom-right', connector: true, style: { left: 'calc(100% + 10px)', top: 'calc(100% + 10px)' } },
            { name: 'bottom-left', connector: true, style: { right: 'calc(100% + 10px)', top: 'calc(100% + 10px)' } },
        ];

        // 第三层：更远的安全区。如果附近非常拥挤，宁可移远并加箭头，也不压住地图线路。
        const far = [
            { name: 'far-top', connector: true, style: { left: '50%', bottom: 'calc(100% + 42px)', transform: 'translateX(-50%)' } },
            { name: 'far-right', connector: true, style: { left: 'calc(100% + 48px)', top: '50%', transform: 'translateY(-50%)' } },
            { name: 'far-left', connector: true, style: { right: 'calc(100% + 48px)', top: '50%', transform: 'translateY(-50%)' } },
            { name: 'far-bottom', connector: true, style: { left: '50%', top: 'calc(100% + 42px)', transform: 'translateX(-50%)' } },
            { name: 'far-top-right', connector: true, style: { left: 'calc(100% + 38px)', bottom: 'calc(100% + 38px)' } },
            { name: 'far-top-left', connector: true, style: { right: 'calc(100% + 38px)', bottom: 'calc(100% + 38px)' } },
            { name: 'far-bottom-right', connector: true, style: { left: 'calc(100% + 38px)', top: 'calc(100% + 38px)' } },
            { name: 'far-bottom-left', connector: true, style: { right: 'calc(100% + 38px)', top: 'calc(100% + 38px)' } },
        ];

        return [...near, ...diagonal, ...far];
    }

    function scoreRouteMarkerCandidate(marker, mapRect, obstacles) {
        const rect = marker.getBoundingClientRect();
        if (!rect.width || !rect.height) return Number.POSITIVE_INFINITY;

        let score = 0;
        // 尽量保持在地图范围内。越界给予很高惩罚，但不是绝对禁止，避免极端位置无解。
        if (rect.left < mapRect.left + 2) score += (mapRect.left + 2 - rect.left) * 100;
        if (rect.right > mapRect.right - 2) score += (rect.right - (mapRect.right - 2)) * 100;
        if (rect.top < mapRect.top + 2) score += (mapRect.top + 2 - rect.top) * 100;
        if (rect.bottom > mapRect.bottom - 2) score += (rect.bottom - (mapRect.bottom - 2)) * 100;

        obstacles.forEach(({ rect: obstacleRect, weight }) => {
            const area = getRectOverlapArea(rect, obstacleRect, 2);
            if (area > 0) score += area * weight;
        });

        return score;
    }

    function addRouteMarkerConnector(cell, marker, type) {
        if (!cell || !marker) return;
        const cellRect = cell.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        if (!cellRect.width || !cellRect.height || !markerRect.width || !markerRect.height) return;

        const scaleX = cell.offsetWidth ? cellRect.width / cell.offsetWidth : 1;
        const scaleY = cell.offsetHeight ? cellRect.height / cell.offsetHeight : 1;
        const scale = Math.max(0.01, (scaleX + scaleY) / 2);

        const startX = cell.offsetWidth / 2;
        const startY = cell.offsetHeight / 2;
        const dx = ((markerRect.left + markerRect.width / 2) - (cellRect.left + cellRect.width / 2)) / scale;
        const dy = ((markerRect.top + markerRect.height / 2) - (cellRect.top + cellRect.height / 2)) / scale;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 8) return;

        // 指示线在标签前停止，避免穿进文字底色。
        const markerHalf = Math.min(markerRect.width, markerRect.height) / (2 * scale);
        const lineLength = Math.max(10, distance - markerHalf - 4);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        const connector = document.createElement('div');
        connector.className = `gow-nav-connector ${type === 'guardian' ? 'is-guardian' : 'is-end'}`;
        connector.style.left = `${startX}px`;
        connector.style.top = `${startY}px`;
        connector.style.width = `${lineLength}px`;
        connector.style.transform = `translateY(-50%) rotate(${angle}deg)`;
        cell.appendChild(connector);
    }

    function placeRouteMarkerSmart(marker, cell, type) {
        const map = document.querySelector('#underspire-map');
        if (!map || !marker || !cell) return;

        const mapRect = map.getBoundingClientRect();
        const obstacles = getRouteMarkerObstacleRects(marker);
        const candidates = getRouteMarkerCandidates();

        marker.style.visibility = 'hidden';
        let best = null;

        for (const candidate of candidates) {
            applyRouteMarkerCandidate(marker, candidate);
            const score = scoreRouteMarkerCandidate(marker, mapRect, obstacles);
            if (!best || score < best.score) best = { candidate, score };
            // 四周或其它候选一旦找到真正无遮挡的位置，直接使用。
            if (score === 0) {
                best = { candidate, score };
                break;
            }
        }

        if (!best) return;
        applyRouteMarkerCandidate(marker, best.candidate);
        marker.dataset.position = best.candidate.name;
        marker.style.visibility = 'visible';

        if (best.candidate.connector) {
            addRouteMarkerConnector(cell, marker, type);
        }
    }

    function addRouteMarker(cell, text, cost, type = 'end') {
        if (!cell) return;
        const marker = document.createElement('div');
        marker.className = `gow-nav-marker ${type === 'guardian' ? 'is-guardian' : 'is-end'}`;

        if (cost !== null && cost !== undefined) {
            const costBadge = document.createElement('div');
            costBadge.className = 'gow-nav-marker-cost';
            costBadge.textContent = `${cost} 🔥`;
            marker.appendChild(costBadge);
        }

        const label = document.createElement('div');
        label.className = 'gow-nav-marker-label';
        label.textContent = text;
        marker.appendChild(label);
        cell.appendChild(marker);

        // 强制一次布局后基于真实屏幕位置进行避让。这样地图缩放/平移也不会导致标签漂移。
        placeRouteMarkerSmart(marker, cell, type);
    }

    // 单个目标线路的独立火把计算。
    // 这里的“独立”是指：每个终点/守卫都从当前起点重新计算自己的完整路线，
    // 不读取其它目标已经统计过的节点，也不会因为与橙色主线或其它蓝色支线重合而扣减。
    // 同一条目标路线内部如果因图结构再次经过同一个节点，只计一次，因为首次经过后该节点已完成。
    // skipFirst=true 表示 path[0] 是当前所在节点，从这里出发本身不需要再次消耗火把。
    function getLineTorchCost(path, skipFirst = false) {
        const line = Array.isArray(path) ? path : [];
        const countedKeys = new Set();
        let cost = 0;

        for (let index = skipFirst ? 1 : 0; index < line.length; index++) {
            const item = line[index];
            if (!item) continue;

            const key = getRouteCellKey(item.row, item.col);
            if (countedKeys.has(key)) continue;
            countedKeys.add(key);

            // 已经完成的房间再次经过不消耗火把。
            if (item.cell.classList.contains('completed')) continue;

            // “送”类免费房间按网页原有规则不计火把。
            const core = (item.cell.querySelector('.cell-core')?.textContent || '').trim();
            if (core === '送') continue;

            cost++;
        }

        return cost;
    }

    // 为某一个守卫构造“当前起点 -> 守卫”的完整独立路线。
    // 如果守卫在主线上，直接截取主线前缀。
    // 如果守卫在分支上，则把“起点 -> 分支接入点”的主线前缀与“接入点 -> 守卫”的支线拼起来。
    // 因此标签显示的是到该守卫的总耗费，而不是仅显示离开主线后的额外耗费。
    function buildGuardianFullPath(route, guardian) {
        const guardianKey = getRouteCellKey(guardian.row, guardian.col);

        const mainIndex = route.path.findIndex(item =>
            getRouteCellKey(item.row, item.col) === guardianKey
        );
        if (mainIndex >= 0) {
            return route.path.slice(0, mainIndex + 1);
        }

        const branch = (route.guardianBranches || []).find(item =>
            getRouteCellKey(item.guardian.row, item.guardian.col) === guardianKey
        );
        if (!branch) return null;

        const anchorKey = getRouteCellKey(branch.anchor.row, branch.anchor.col);
        const anchorIndex = route.path.findIndex(item =>
            getRouteCellKey(item.row, item.col) === anchorKey
        );
        if (anchorIndex < 0) return null;

        return [
            ...route.path.slice(0, anchorIndex + 1),
            ...branch.path.slice(1)
        ];
    }

    function getGuardianTorchCost(route, guardian) {
        const fullPath = buildGuardianFullPath(route, guardian);
        if (!fullPath) return null;

        // 每个守卫都以“当前起点 -> 该守卫”的完整路线独立统计。
        // 即使其中一段与终点主线完全重合，也照样作为这个守卫自己的路线计入。
        return getLineTorchCost(fullPath, true);
    }

    function highlightRoutePath(path, type = 'main') {
        path.forEach(item => item.cell.classList.add(type === 'main' ? 'gow-nav-route' : 'gow-nav-branch'));

        for (let index = 0; index < path.length - 1; index++) {
            const current = path[index];
            const next = path[index + 1];
            const direction = getRouteDirection(current, next);
            if (!direction) continue;

            const cls = type === 'main' ? 'gow-nav-route-path' : 'gow-nav-branch-path';
            current.cell.querySelector(`.cell-path.${direction.name}`)?.classList.add(cls);
            next.cell.querySelector(`.cell-path.${direction.opposite}`)?.classList.add(cls);
        }
    }

    function isRouteGuidanceEnabled() {
        // 默认开启。只有用户明确关闭后才记为 false，兼容此前版本的使用习惯。
        return localStorage.getItem(STORAGE_ROUTE_GUIDANCE_ENABLED) !== 'false';
    }

    function restoreNativeMainRouteVisual() {
        const map = document.querySelector('#underspire-map');
        if (!map) return;

        // 仅恢复插件对“路线指引视觉”的改动。
        // 地图缩放、left/top 位移、解锁状态均属于地图调整功能，不在这里重置。
        map.classList.remove('gow-nav-clean-native-main');
        map.style.removeProperty('--gow-neutral-path-color');
    }

    function setRouteNavigationTitle(cell, text) {
        if (!cell) return;
        if (cell.dataset.gowNavOriginalTitleSaved !== 'true') {
            cell.dataset.gowNavOriginalTitleSaved = 'true';
            cell.dataset.gowNavOriginalTitle = cell.getAttribute('title') || '';
        }
        cell.setAttribute('title', text);
    }

    function restoreRouteNavigationTitles() {
        document.querySelectorAll('#underspire-map .cell[data-gow-nav-original-title-saved="true"]').forEach(cell => {
            const original = cell.dataset.gowNavOriginalTitle || '';
            if (original) {
                cell.setAttribute('title', original);
            } else {
                cell.removeAttribute('title');
            }
            delete cell.dataset.gowNavOriginalTitle;
            delete cell.dataset.gowNavOriginalTitleSaved;
        });
    }

    function updateRouteGuidanceButton() {
        const button = document.querySelector('#gow-map-guidance-btn');
        if (!button) return;
        const enabled = isRouteGuidanceEnabled();
        button.classList.toggle('is-active', enabled);
        button.textContent = enabled ? '指引开启' : '指引关闭';
        button.title = enabled
            ? '点击关闭地图指引。关闭后恢复网页原始地图线路，但保留当前缩放和位移。'
            : '点击开启地图推荐路线、守卫支线及火把标签。';
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    function setRouteGuidanceEnabled(enabled) {
        localStorage.setItem(STORAGE_ROUTE_GUIDANCE_ENABLED, enabled ? 'true' : 'false');
        updateRouteGuidanceButton();

        if (!enabled) {
            stopInitialRouteWatch();
            clearRouteNavigation();
            restoreRouteNavigationTitles();
            restoreNativeMainRouteVisual();
            return;
        }

        // 开启时不触碰地图缩放和位移，只重新计算并绘制指引。
        const route = applyRouteNavigation();
        if (!route) startInitialRouteWatch();
    }

    function prepareNativeMainRouteVisual() {
        const map = document.querySelector('#underspire-map');
        if (!map) return;

        // 从网页现有的普通路径中读取真实颜色，尽量保持“非推荐线路”与原页面一致。
        if (!map.style.getPropertyValue('--gow-neutral-path-color')) {
            const candidates = Array.from(map.querySelectorAll('.cell-path:not(.main)'));
            for (const path of candidates) {
                const style = getComputedStyle(path);
                const color = style.backgroundColor;
                if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') continue;
                map.style.setProperty('--gow-neutral-path-color', color);
                break;
            }
        }

        map.classList.add('gow-nav-clean-native-main');
    }

    function applyRouteNavigation() {
        if (!isRouteGuidanceEnabled()) {
            clearRouteNavigation();
            restoreNativeMainRouteVisual();
            return null;
        }

        ensureRouteNavigationStyles();
        prepareNativeMainRouteVisual();
        clearRouteNavigation();

        let route = findBestMainRoute();
        if (route) {
            localStorage.removeItem(STORAGE_GUARDIAN_CLEANUP_START);
            localStorage.removeItem(STORAGE_GUARDIAN_CLEANUP_COMPLETED);
        }
        if (!route) {
            // findBestMainRoute 在没有未完成重点房间时会返回 null。
            // 此时不能直接退出，否则“主线完成后显示全部守卫”永远不会触发。
            const mapData = buildRouteMap();
            const cleanupRoute = showRemainingGuardiansAfterMainComplete(mapData);
            return cleanupRoute;
        }

        route = attachNearbyGuardians(route);
        highlightRoutePath(route.path, 'main');
        (route.guardianBranches || []).forEach(branch => highlightRoutePath(branch.path, 'branch'));

        route.start.cell.classList.add('gow-nav-start');
        route.end.cell.classList.add('gow-nav-end');
        addRouteBadge(route.start.cell, '起点', 'start');

        // 终点主线独立计算。path[0] 是当前起点，不重复计费。
        // 守卫支线无论是否与主线重叠，都不会参与这里的计算。
        route.torchCost = getLineTorchCost(route.path, true);
        addRouteMarker(route.end.cell, '终点', route.torchCost, 'end');

        (route.guardians || []).forEach(guardian => {
            guardian.cell.classList.add('gow-nav-guardian');
            if (guardian !== route.start && guardian !== route.end) {
                const guardianCost = getGuardianTorchCost(route, guardian);
                addRouteMarker(guardian.cell, '守卫', guardianCost, 'guardian');

                if (guardianCost !== null) {
                    const guardianKey = getRouteCellKey(guardian.row, guardian.col);
                    const branch = (route.guardianBranches || []).find(item =>
                        getRouteCellKey(item.guardian.row, item.guardian.col) === guardianKey
                    );
                    const branchCost = branch ? getLineTorchCost(branch.path, true) : 0;
                    setRouteNavigationTitle(guardian.cell, branch
                        ? `守卫：从当前起点独立预计需要 ${guardianCost} 个火把；其中离开主线后的分支为 ${branchCost} 个火把`
                        : `守卫：位于主线上；从当前起点独立预计需要 ${guardianCost} 个火把`);
                }
            }
        });

        const guardianCount = (route.guardians || []).length;
        setRouteNavigationTitle(route.start.cell, `推荐路线起点${guardianCount ? `；规划 ${guardianCount} 个守卫` : ''}`);
        setRouteNavigationTitle(route.end.cell, `推荐线路终点；本主线路独立预计需要 ${route.torchCost} 个火把`);

        return route;
    }

    function stopInitialRouteWatch() {
        initialRouteWatchToken++;
        if (initialRouteWatchTimer) {
            clearTimeout(initialRouteWatchTimer);
            initialRouteWatchTimer = null;
        }
    }

    function startInitialRouteWatch() {
        stopInitialRouteWatch();

        if (!isRouteGuidanceEnabled()) {
            clearRouteNavigation();
            restoreNativeMainRouteVisual();
            return;
        }

        const token = initialRouteWatchToken;
        const startedAt = Date.now();
        const maxDuration = 14000;
        let lastSignature = '';
        let stableCount = 0;
        let appliedSignature = '';

        const check = () => {
            if (token !== initialRouteWatchToken) return;
            if (!isRouteGuidanceEnabled()) {
                clearRouteNavigation();
                restoreNativeMainRouteVisual();
                initialRouteWatchTimer = null;
                return;
            }

            const snapshot = getMapSnapshot();
            const elapsed = Date.now() - startedAt;

            if (snapshot.availableCellCount > 0 && snapshot.completedCount >= 0) {
                if (snapshot.signature === lastSignature) {
                    stableCount++;
                } else {
                    lastSignature = snapshot.signature;
                    stableCount = 1;
                }

                // 页面刷新时等待地图至少连续稳定两次，再自动计算一次路线。
                if (stableCount >= 2 && snapshot.signature !== appliedSignature) {
                    const route = applyRouteNavigation();
                    if (route) appliedSignature = snapshot.signature;
                }
            } else {
                stableCount = 0;
                lastSignature = '';
            }

            if (elapsed < maxDuration) {
                initialRouteWatchTimer = setTimeout(check, 700);
            } else {
                initialRouteWatchTimer = null;
            }
        };

        initialRouteWatchTimer = setTimeout(check, 650);
    }

    function stopSyncWatch() {
        syncWatchToken++;

        if (syncWatchTimer) {
            clearTimeout(syncWatchTimer);
            syncWatchTimer = null;
        }
    }

    function startSyncWatch() {
        stopSyncWatch();

        const token = syncWatchToken;
        const startedAt = Date.now();
        const maxDuration = 18000;

        let lastSignature = '';
        let stableCount = 0;
        let lastAppliedSignature = '';
        let hasAppliedAtLeastOnce = false;

        const check = () => {
            if (token !== syncWatchToken) return;

            const snapshot = getMapSnapshot();
            const elapsed = Date.now() - startedAt;

            if (snapshot.availableCellCount <= 0 || snapshot.totalNeed === null) {
                stableCount = 0;
                lastSignature = '';

                updateCompletedSyncUi(
                    '网页同步中：正在等待地图和需求数据恢复…',
                    false
                );
            } else {
                if (snapshot.signature === lastSignature) {
                    stableCount++;
                } else {
                    lastSignature = snapshot.signature;
                    stableCount = 1;
                }

                // 至少等待2.4秒，并连续读取到3次相同结果，才认为网页数据已经稳定。
                // 如果稍后数据再次变化，会再次校准；基准差额机制可避免重复扣除。
                if (
                    elapsed >= 2400 &&
                    stableCount >= 3 &&
                    snapshot.signature !== lastAppliedSignature
                ) {
                    const result = resetCompletedBaseline(false);

                    if (result !== null) {
                        lastAppliedSignature = snapshot.signature;
                        hasAppliedAtLeastOnce = true;
                        // 每次同步数据稳定并完成校准后，仅在地图指引开启时计算推荐路线。
                        if (isRouteGuidanceEnabled()) {
                            setTimeout(() => {
                                if (isRouteGuidanceEnabled()) applyRouteNavigation();
                            }, 60);
                        } else {
                            clearRouteNavigation();
                            restoreNativeMainRouteVisual();
                        }
                    }
                } else {

                    const status = document.querySelector('#gow-completed-sync-status');
                    if (status && !hasAppliedAtLeastOnce) {
                        status.textContent = '网页同步中：正在等待数据稳定，完成后将自动校准';
                        status.style.color = '#777';
                    }
                }
            }

            scheduleRender(30);
            setupSyncButtonHook();

            if (elapsed < maxDuration) {
                syncWatchTimer = setTimeout(check, 800);
                return;
            }

            syncWatchTimer = null;

            if (!hasAppliedAtLeastOnce) {
                updateCompletedSyncUi(
                    '未能确认网页同步结果，请等待页面完全加载后重新点击“同步数据”',
                    false
                );
            }
        };

        syncWatchTimer = setTimeout(check, 600);
    }

    function setupSyncButtonHook() {
        const syncButton = document.querySelector('#button-sync');

        if (!syncButton) return;
        if (syncButton.dataset.gowHooked === 'true') return;

        syncButton.dataset.gowHooked = 'true';

        syncButton.addEventListener('click', () => {
            stopInitialRouteWatch();
            clearRouteNavigation();
            if (!isRouteGuidanceEnabled()) restoreNativeMainRouteVisual();
            localStorage.setItem(
                STORAGE_LAST_COMPLETED_MSG,
                '网页同步中：正在等待数据稳定，完成后将自动校准'
            );

            const status = document.querySelector('#gow-completed-sync-status');
            if (status) {
                status.textContent = '网页同步中：正在等待数据稳定，完成后将自动校准';
                status.style.color = '#777';
            }

            startSyncWatch();
        });
    }

    function ensureSystemInfoStyles() {
        if (document.querySelector('#gow-system-info-styles')) return;

        const style = document.createElement('style');
        style.id = 'gow-system-info-styles';
        style.textContent = `
            #underspire-info .gow-system-toggle-row {
                margin: 0;
                text-align: left;
                display: inline-block;
                float: left;
                margin-right: 6px;
                white-space: nowrap;
            }

            #underspire-info .gow-system-toggle-btn {
                padding: 2px 9px;
                border: 1px solid rgba(0, 0, 0, 0.16);
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.45);
                color: #52616a;
                font-family: ${FONT_FAMILY};
                font-size: 12px;
                line-height: 1.4;
                cursor: pointer;
            }

            #underspire-info .gow-system-toggle-btn:hover {
                background: rgba(255, 255, 255, 0.68);
            }

            #underspire-info .gow-system-completed-line {
                font-weight: 700;
                color: #3d4f57;
            }

            #underspire-info .gow-plugin-details {
                margin: 5px 0 7px;
                padding: 7px 8px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 7px;
                background: rgba(255, 255, 255, 0.32);
                color: #6b7479;
                font-size: 11px;
                line-height: 1.55;
                text-align: left;
                white-space: normal;
            }

            #underspire-info .gow-plugin-detail-title {
                margin-bottom: 3px;
                color: #536168;
                font-size: 12px;
                font-weight: 700;
                text-align: center;
            }

            #underspire-info .gow-plugin-detail-line {
                margin: 1px 0;
            }

            #underspire-info #gow-completed-sync-status {
                margin-top: 5px;
                padding-top: 5px;
                border-top: 1px dashed rgba(0, 0, 0, 0.12);
            }

            #underspire-info .gow-system-hidden {
                display: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    function ensurePluginDetails(infoPanel) {
        if (!infoPanel) return null;

        let details = infoPanel.querySelector('#gow-plugin-details');

        if (!details) {
            details = document.createElement('div');
            details.id = 'gow-plugin-details';
            details.className = 'gow-plugin-details';
            details.innerHTML = `
                    <div class="gow-plugin-detail-title">插件说明</div>

                    <div class="gow-plugin-detail-line">• 火把自动管理：每日15点自动刷新火把，漏开页面会根据实际刷新次数补算</div>
                    <div class="gow-plugin-detail-line">• 周一15点完整更新：旧周期火把失效，重新开始计算本周火把</div>
                    <div class="gow-plugin-detail-line">• 点击网页同步后自动校准完成节点，无需手动调整</div>
                    <div class="gow-plugin-detail-line">• 主线智能导航：重点房间按照数字顺序推进，F房间默认最后处理</div>
                    <div class="gow-plugin-detail-line">• 路线火把独立计算：主线、守卫、目标房间分别计算实际消耗，不互相抵扣</div>
                    <div class="gow-plugin-detail-line">• 顺路守卫提示：自动标记距离主路线较近的守卫房间，方便规划路线</div>
                    <div class="gow-plugin-detail-line">• 主线完成后进入守卫清理模式，为所有未处理守卫显示独立耗费与路线</div>
                    <div class="gow-plugin-detail-line">• 地图指引可自由开启/关闭，关闭后恢复原地图显示，保留缩放与移动位置</div>
                    <div class="gow-plugin-detail-line">• 购买建议：根据当前火把、剩余需求及刷新情况自动计算推荐购买次数</div>

                    <div id="gow-completed-sync-status">
                        ${localStorage.getItem(STORAGE_LAST_COMPLETED_MSG) || '尚未同步完成节点'}
                    </div>
            `;
        }

        return details;
    }


    function updateSystemInfoCollapse(infoPanel) {
        if (!infoPanel) return;

        ensureSystemInfoStyles();

        const systemLines = Array.from(infoPanel.children).filter(node => {
            return node.classList && node.classList.contains('line');
        });

        if (systemLines.length === 0) {
            const pluginDetails = ensurePluginDetails(infoPanel);
            if (pluginDetails) {
                pluginDetails.classList.add('gow-system-hidden');
            }

            const oldToggle = infoPanel.querySelector('#gow-system-toggle-row');
            if (oldToggle) oldToggle.remove();
            return;
        }

        const completedLine = systemLines.find(line => {
            const text = (line.textContent || '').trim();
            return text.includes('已经完成节点');
        }) || systemLines[0];

        const otherLines = systemLines.filter(line => line !== completedLine);
        const pluginDetails = ensurePluginDetails(infoPanel);
        const expanded = localStorage.getItem(STORAGE_SYSTEM_INFO_EXPANDED) === 'true';

        systemLines.forEach(line => {
            line.classList.remove('gow-system-completed-line', 'gow-system-hidden');
        });

        if (pluginDetails) {
            pluginDetails.classList.remove('gow-system-hidden');
        }

        completedLine.classList.add('gow-system-completed-line');

        const collapsibleNodes = [
            ...otherLines,
            ...(pluginDetails ? [pluginDetails] : [])
        ];

        collapsibleNodes.forEach(node => {
            if (!expanded) {
                node.classList.add('gow-system-hidden');
            }
        });

        let toggleRow = infoPanel.querySelector('#gow-system-toggle-row');
        if (!toggleRow) {
            toggleRow = document.createElement('div');
            toggleRow.id = 'gow-system-toggle-row';
            toggleRow.className = 'gow-system-toggle-row';
            toggleRow.innerHTML = `
                <button id="gow-system-toggle-btn" class="gow-system-toggle-btn" type="button">系统详情</button>
            `;

            toggleRow.addEventListener('click', (event) => {
                const target = event.target;
                if (!target || target.id !== 'gow-system-toggle-btn') return;

                const nowExpanded = localStorage.getItem(STORAGE_SYSTEM_INFO_EXPANDED) !== 'true';
                localStorage.setItem(STORAGE_SYSTEM_INFO_EXPANDED, nowExpanded ? 'true' : 'false');
                updateSystemInfoCollapse(infoPanel);
            });
        }

        const button = toggleRow.querySelector('#gow-system-toggle-btn');
        if (button) {
            button.textContent = expanded ? '详情－' : '详情＋';
        }

        if (otherLines.length === 0 && !pluginDetails) {
            if (toggleRow.parentElement) toggleRow.remove();
            return;
        }

        if (toggleRow.parentElement !== infoPanel) {
            infoPanel.insertBefore(toggleRow, completedLine.nextSibling);
        } else if (toggleRow.previousSibling !== completedLine) {
            infoPanel.insertBefore(toggleRow, completedLine.nextSibling);
        }

        if (pluginDetails) {
            if (pluginDetails.parentElement !== infoPanel) {
                infoPanel.insertBefore(pluginDetails, toggleRow.nextSibling);
            } else if (pluginDetails.previousSibling !== toggleRow) {
                infoPanel.insertBefore(pluginDetails, toggleRow.nextSibling);
            }
        }
    }





    function ensurePlanStyles() {
        if (document.querySelector('#gow-plan-styles')) return;

        const style = document.createElement('style');
        style.id = 'gow-plan-styles';

        style.textContent = `
            #underspire-buy-plan {
                margin-top: 10px;
                padding-top: 9px;
                border-top: 1px solid rgba(0, 0, 0, 0.14);
                box-sizing: border-box;
                white-space: normal;
                text-align: left;
                font-family: ${FONT_FAMILY};
                font-size: 14px;
                line-height: 1.45;
                color: #334;
            }

            #underspire-buy-plan .gow-plan-title {
                margin-bottom: 6px;
                text-align: center;
                font-size: 15px;
                font-weight: 700;
                color: #37474f;
            }

            #underspire-buy-plan .gow-status {
                margin-bottom: 10px;
                padding: 10px 10px;
                border: 1px solid transparent;
                border-radius: 10px;
                text-align: center;
            }

            #underspire-buy-plan .gow-status-title {
                font-size: 18px;
                font-weight: 800;
                line-height: 1.25;
            }

            #underspire-buy-plan .gow-status-sub {
                margin-top: 3px;
                font-size: 12px;
                opacity: 0.90;
            }

            #underspire-buy-plan .gow-status.is-ok {
                color: #18794e;
                background: rgba(24, 121, 78, 0.10);
                border-color: rgba(24, 121, 78, 0.18);
            }

            #underspire-buy-plan .gow-status.is-buy {
                color: #b45309;
                background: rgba(217, 119, 6, 0.10);
                border-color: rgba(217, 119, 6, 0.18);
            }

            #underspire-buy-plan .gow-status.is-danger {
                color: #b42318;
                background: rgba(180, 35, 24, 0.10);
                border-color: rgba(180, 35, 24, 0.18);
            }

            #underspire-buy-plan .gow-progress-wrap {
                margin-top: 8px;
                padding: 10px 10px 9px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.52);
            }

            #underspire-buy-plan .gow-progress-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
                font-size: 13px;
                color: #5f6c72;
            }

            #underspire-buy-plan .gow-progress-info b {
                font-size: 20px;
                color: #334249;
            }

            #underspire-buy-plan .gow-progress {
                display: flex;
                height: 20px;
                overflow: hidden;
                border-radius: 999px;
                background: rgba(57, 69, 76, 0.12);
            }

            #underspire-buy-plan .gow-progress-segment {
                height: 100%;
                transition: width 0.2s ease;
            }

            #underspire-buy-plan .gow-progress-segment.is-completed,
            #underspire-buy-plan .gow-legend-dot.is-completed,
            #underspire-buy-plan .gow-progress-count.is-completed,
            #underspire-buy-plan .gow-inline-bar span.is-completed {
                background: #5f8f92;
            }

            #underspire-buy-plan .gow-progress-segment.is-hold,
            #underspire-buy-plan .gow-legend-dot.is-hold,
            #underspire-buy-plan .gow-progress-count.is-hold,
            #underspire-buy-plan .gow-inline-bar span.is-hold {
                background: #6d83bd;
            }

            #underspire-buy-plan .gow-progress-segment.is-gift,
            #underspire-buy-plan .gow-legend-dot.is-gift,
            #underspire-buy-plan .gow-progress-count.is-gift,
            #underspire-buy-plan .gow-inline-bar span.is-gift {
                background: #79b99b;
            }

            #underspire-buy-plan .gow-progress-segment.is-purchase,
            #underspire-buy-plan .gow-legend-dot.is-purchase,
            #underspire-buy-plan .gow-progress-count.is-purchase,
            #underspire-buy-plan .gow-inline-bar span.is-purchase {
                background: #e79a17;
            }

            #underspire-buy-plan .gow-progress-segment.is-missing,
            #underspire-buy-plan .gow-legend-dot.is-missing,
            #underspire-buy-plan .gow-progress-count.is-missing,
            #underspire-buy-plan .gow-inline-bar span.is-missing {
                background: #d85f5f;
            }

            #underspire-buy-plan .gow-progress-segment.is-surplus,
            #underspire-buy-plan .gow-legend-dot.is-surplus,
            #underspire-buy-plan .gow-progress-count.is-surplus,
            #underspire-buy-plan .gow-inline-bar span.is-surplus {
                background: #43aa67;
            }

            #underspire-buy-plan .gow-progress-counts {
                display: flex;
                margin-top: 4px;
                gap: 3px;
            }

            #underspire-buy-plan .gow-progress-count {
                height: 30px;
                line-height: 30px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 800;
                color: #fff;
                text-align: center;
                overflow: hidden;
                white-space: nowrap;
                text-overflow: clip;
                min-width: 34px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: inset 0 -1px 0 rgba(255,255,255,0.12);
            }

            #underspire-buy-plan .gow-progress-note {
                margin-top: 8px;
                font-size: 12px;
                color: #6b7680;
                text-align: center;
            }

            #underspire-buy-plan .gow-progress-note.is-danger {
                color: #a61b12;
            }

            #underspire-buy-plan .gow-progress-legend {
                display: grid;
                grid-template-columns: 1fr;
                gap: 7px;
                margin-top: 6px;
            }

            #underspire-buy-plan .gow-legend-item {
                color: #526067;
                box-sizing: border-box;
            }

            #underspire-buy-plan .gow-legend-item.gow-bar-row {
                display: grid;
                grid-template-columns: minmax(82px, auto) minmax(90px, 1fr) auto;
                grid-template-areas: "label bar value";
                align-items: center;
                column-gap: 9px;
                min-height: 30px;
                padding: 3px 0;
                font-size: 14px;
            }

            #underspire-buy-plan .gow-bar-row .gow-legend-left {
                grid-area: label;
                font-size: 14px;
                font-weight: 600;
            }

            #underspire-buy-plan .gow-bar-row .gow-legend-value {
                grid-area: value;
                min-width: 44px;
                font-size: 15px;
                font-weight: 800;
                text-align: right;
            }

            #underspire-buy-plan .gow-bar-row .gow-inline-bar {
                grid-area: bar;
                width: 100%;
                min-width: 70px;
            }

            /* 当前进度与火把筹备在视觉上分层，但不额外增加标题行。 */
            #underspire-buy-plan .gow-bar-row.gow-resource-start {
                margin-top: 5px;
                padding-top: 8px;
                border-top: 1px dashed rgba(71, 94, 102, 0.13);
            }

            #underspire-buy-plan .gow-legend-item.gow-summary-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                min-height: 21px;
                font-size: 13px;
            }

            #underspire-buy-plan .gow-legend-left {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                min-width: 0;
                font-weight: 500;
                color: #4e5d64;
                white-space: nowrap;
            }

            #underspire-buy-plan .gow-legend-dot {
                display: inline-block;
                width: 12px;
                height: 12px;
                border-radius: 4px;
                flex: 0 0 auto;
                box-shadow: inset 0 -1px 0 rgba(0,0,0,0.08);
            }

            #underspire-buy-plan .gow-legend-value {
                font-weight: 800;
                color: #263238;
                white-space: nowrap;
                font-size: 15px;
                text-align: right;
                line-height: 1;
            }

            #underspire-buy-plan .gow-summary-row .gow-legend-value {
                font-size: 14px;
            }

            #underspire-buy-plan .gow-inline-bar {
                width: 100%;
                min-width: 0;
                height: 14px;
                border-radius: 999px;
                background: rgba(73, 94, 102, 0.11);
                overflow: hidden;
                box-shadow:
                    inset 0 1px 2px rgba(41, 56, 62, 0.11),
                    0 1px 0 rgba(255,255,255,0.68);
            }

            #underspire-buy-plan .gow-inline-bar span {
                display: block;
                height: 100%;
                max-width: 100%;
                border-radius: inherit;
                box-shadow:
                    inset 0 -1px 0 rgba(0,0,0,0.08),
                    inset 0 1px 0 rgba(255,255,255,0.22);
                transition: width 0.25s ease;
            }

            /* 当前进度独立使用完整轨道，按本周总房间拆分为“已完成 / 未完成”两段。 */
            #underspire-buy-plan .gow-inline-bar.gow-progress-composite {
                display: flex;
                background: transparent;
            }

            #underspire-buy-plan .gow-inline-bar.gow-progress-composite span {
                min-width: 0;
                border-radius: 0;
                transition: width 0.25s ease;
            }

            #underspire-buy-plan .gow-inline-bar.gow-progress-composite span:first-child {
                border-radius: 999px 0 0 999px;
            }

            #underspire-buy-plan .gow-inline-bar.gow-progress-composite span:last-child {
                border-radius: 0 999px 999px 0;
            }

            #underspire-buy-plan .gow-progress-done {
                background: #5f8f92;
            }

            #underspire-buy-plan .gow-progress-todo {
                background: #c7d7d9;
            }

            #underspire-buy-plan .gow-progress-dot {
                background: linear-gradient(90deg, #5f8f92 0 50%, #c7d7d9 50% 100%);
            }

            /* 4.2.9：当前进度改为“进度 + 火把覆盖来源 + 最终溢出/缺口”的单一总览条。 */
            #underspire-buy-plan .gow-progress-block {
                padding-bottom: 9px;
            }

            #underspire-buy-plan .gow-progress-head,
            #underspire-buy-plan .gow-resource-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                min-height: 24px;
            }

            #underspire-buy-plan .gow-progress-head .gow-legend-left,
            #underspire-buy-plan .gow-resource-head .gow-legend-left {
                font-size: 14px;
                font-weight: 700;
            }

            #underspire-buy-plan .gow-progress-head .gow-legend-value,
            #underspire-buy-plan .gow-resource-head .gow-legend-value {
                font-size: 15px;
                font-weight: 800;
            }

            #underspire-buy-plan .gow-progress-composite-large {
                display: flex;
                width: 100%;
                height: 30px;
                margin-top: 6px;
                overflow: hidden;
                border-radius: 9px;
                background: #c7d7d9;
                box-shadow:
                    inset 0 1px 2px rgba(41, 56, 62, 0.13),
                    0 1px 0 rgba(255,255,255,0.70);
            }

            #underspire-buy-plan .gow-progress-composite-large .gow-progress-segment-label {
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 0;
                height: 100%;
                overflow: hidden;
                color: #fff;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                white-space: nowrap;
                box-shadow:
                    inset -1px 0 0 rgba(255,255,255,0.25),
                    inset 0 -1px 0 rgba(0,0,0,0.07);
                transition: width 0.25s ease;
            }

            #underspire-buy-plan .gow-progress-composite-large .gow-progress-segment-label[data-small="true"] {
                min-width: 25px;
                flex-shrink: 1;
            }

            #underspire-buy-plan .gow-progress-done {
                background: #5f8f92;
            }

            #underspire-buy-plan .gow-progress-hold {
                background: #6d83bd;
            }

            #underspire-buy-plan .gow-progress-gift {
                background: #79b99b;
            }

            #underspire-buy-plan .gow-progress-purchase {
                background: #e79a17;
            }

            #underspire-buy-plan .gow-progress-surplus {
                background: #43aa67;
            }

            #underspire-buy-plan .gow-progress-missing {
                background: #d85f5f;
            }

            /* 下方不再重复堆叠全部火把来源，仅比较“预计购买”与“实际购买需求”。 */
            #underspire-buy-plan .gow-resource-block {
                margin-top: 3px;
                padding-top: 10px;
                border-top: 1px dashed rgba(71, 94, 102, 0.14);
            }

            #underspire-buy-plan .gow-purchase-compare {
                position: relative;
                width: 100%;
                height: 24px;
                margin-top: 6px;
                overflow: hidden;
                border-radius: 8px;
                background: rgba(216, 95, 95, 0.20);
                box-shadow:
                    inset 0 1px 2px rgba(41, 56, 62, 0.12),
                    0 1px 0 rgba(255,255,255,0.72);
            }

            #underspire-buy-plan .gow-purchase-fill {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 0;
                overflow: hidden;
                border-radius: 8px;
                background: #e79a17;
                color: #fff;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                white-space: nowrap;
                transition: width 0.25s ease;
            }

            #underspire-buy-plan .gow-purchase-need-marker {
                position: absolute;
                top: -1px;
                bottom: -1px;
                width: 2px;
                transform: translateX(-1px);
                background: rgba(166, 27, 18, 0.82);
                box-shadow: 0 0 0 1px rgba(255,255,255,0.45);
                pointer-events: none;
            }

            #underspire-buy-plan .gow-purchase-compare.is-no-need {
                background: rgba(73, 94, 102, 0.10);
            }

            #underspire-buy-plan .gow-resource-list {
                display: grid;
                grid-template-columns: 1fr;
                gap: 6px;
                margin-top: 9px;
            }

            #underspire-buy-plan .gow-resource-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                min-height: 20px;
                font-size: 13px;
            }

            #underspire-buy-plan .gow-resource-row .gow-legend-left {
                font-size: 13px;
                font-weight: 600;
            }

            #underspire-buy-plan .gow-resource-row .gow-legend-value {
                font-size: 14px;
                font-weight: 800;
            }

            #underspire-buy-plan .gow-section {
                margin-top: 10px;
                padding: 8px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.42);
            }

            #underspire-buy-plan .gow-section-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 6px;
            }

            #underspire-buy-plan .gow-section-title {
                font-size: 13px;
                font-weight: 700;
                color: #59656c;
            }

            #underspire-buy-plan .gow-detail-toggle {
                padding: 2px 8px;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.55);
                color: #52616a;
                font-family: ${FONT_FAMILY};
                font-size: 11px;
                cursor: pointer;
            }

            #underspire-buy-plan .gow-buy-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin: 0 0 6px;
            }

            #underspire-buy-plan .gow-buy-chip {
                padding: 3px 8px;
                border: 1px solid rgba(180, 83, 9, 0.20);
                border-radius: 999px;
                color: #a24b08;
                background: rgba(217, 119, 6, 0.10);
                font-size: 11px;
                white-space: nowrap;
            }

            #underspire-buy-plan .gow-cost {
                padding-top: 4px;
                text-align: center;
                color: #555;
                font-size: 12px;
            }

            #underspire-buy-plan .gow-cost strong {
                margin-left: 4px;
                color: #b45309;
                font-size: 20px;
            }

            #underspire-buy-plan .gow-detail-box {
                margin-top: 7px;
                padding-top: 7px;
                border-top: 1px dashed rgba(0, 0, 0, 0.12);
            }

            #underspire-buy-plan .gow-detail-box.is-hidden {
                display: none;
            }

            #underspire-buy-plan .gow-detail-row {
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                gap: 10px;
                padding: 2px 0;
                font-size: 12px;
            }

            #underspire-buy-plan .gow-detail-row span:first-child {
                color: #68727a;
            }

            #underspire-buy-plan .gow-detail-row b {
                text-align: right;
                color: #27343a;
            }

            #underspire-buy-plan .gow-no-buy,
            #underspire-buy-plan .gow-waiting {
                padding: 8px 4px;
                text-align: center;
                color: #778087;
                font-size: 12px;
            }

            #underspire-buy-plan .gow-warning {
                margin-top: 6px;
                padding: 6px 7px;
                border-radius: 6px;
                color: #a61b12;
                background: rgba(180, 35, 24, 0.08);
                font-size: 11px;
                text-align: center;
            }

            #underspire-info-box {
                position: fixed;
                left: 40px;
                top: 24px;
                z-index: 9999;
                width: 360px;
                min-width: 300px;
                max-width: min(620px, calc(100vw - 20px));
                box-sizing: border-box;
                min-height: 120px;
                border: 2px solid transparent;
                border-radius: 6px;
                text-align: center;
                color: #333;
                background: rgba(209, 233, 234, 0.94);
                box-shadow: 0 8px 20px rgba(0, 0, 0, 0.10);
                overflow: hidden;
            }

            #underspire-info-box .gow-drag-handle {
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                color: #6f7d84;
                cursor: move;
                user-select: none;
                border-bottom: 1px solid rgba(0,0,0,0.04);
                position: relative;
            }


            #underspire-info-box .gow-panel-toggle-btn {
                position: absolute;
                right: 36px;
                top: 3px;
                height: 18px;
                padding: 0 8px;
                border-radius: 999px;
                border: 1px solid rgba(0,0,0,0.12);
                background: rgba(255,255,255,0.55);
                font-size: 11px;
                cursor: pointer;
                color: #52616a;
            }


            /* 4.2.11：折叠态改为紧凑的“尖塔进度”迷你状态面板。 */
            #underspire-info-box .gow-collapsed-summary {
                display: none;
                width: calc(100% - 38px);
                height: 100%;
                margin: 0 30px 0 2px;
                box-sizing: border-box;
                color: #485b63;
                font-family: ${FONT_FAMILY};
                pointer-events: none;
                flex-direction: column;
                justify-content: center;
                gap: 4px;
            }

            #underspire-info-box .gow-collapsed-main {
                width: 100%;
                display: grid;
                grid-template-columns: auto auto 1fr auto;
                align-items: baseline;
                column-gap: 10px;
                white-space: nowrap;
            }

            #underspire-info-box .gow-collapsed-title {
                color: #718087;
                font-size: 11px;
                font-weight: 600;
            }

            #underspire-info-box .gow-collapsed-ratio {
                display: inline-flex;
                align-items: baseline;
                gap: 3px;
                color: #40545c;
                font-size: 12px;
                font-weight: 700;
            }

            #underspire-info-box .gow-collapsed-ratio b {
                color: #4f8f92;
                font-size: 16px;
                font-weight: 850;
                line-height: 1;
            }

            #underspire-info-box .gow-collapsed-ratio em {
                color: #91a0a5;
                font-size: 11px;
                font-style: normal;
                font-weight: 500;
            }

            #underspire-info-box .gow-collapsed-ratio span {
                color: #3f5057;
                font-size: 13px;
                font-weight: 750;
            }

            #underspire-info-box .gow-collapsed-remaining {
                justify-self: end;
                color: #718087;
                font-size: 11px;
                font-weight: 500;
            }

            #underspire-info-box .gow-collapsed-remaining b {
                margin-left: 3px;
                color: #40545c;
                font-size: 12px;
                font-weight: 800;
            }

            #underspire-info-box .gow-collapsed-percent {
                min-width: 30px;
                text-align: right;
                color: #4f7278;
                font-size: 11px;
                font-weight: 800;
            }

            #underspire-info-box .gow-collapsed-progress {
                width: 100%;
                height: 4px;
                overflow: hidden;
                border-radius: 999px;
                background: rgba(96, 125, 132, 0.13);
            }

            #underspire-info-box .gow-collapsed-progress-fill {
                display: block;
                height: 100%;
                width: 0;
                border-radius: inherit;
                background: #5f989a;
                transition: width 0.25s ease;
            }

            #underspire-info-box.gow-panel-collapsed {
                min-height: 0 !important;
                padding: 0 7px !important;
                border-radius: 8px;
            }

            #underspire-info-box.gow-panel-collapsed > #underspire-info,
            #underspire-info-box.gow-panel-collapsed > .gow-resize-handle,
            #underspire-info-box.gow-panel-collapsed > .gow-scale-handle {
                display: none !important;
            }

            #underspire-info-box.gow-panel-collapsed .gow-drag-handle {
                height: 40px;
                border-bottom: 0;
                justify-content: flex-start;
            }

            #underspire-info-box.gow-panel-collapsed .gow-drag-handle::before {
                content: '';
                display: none;
            }

            #underspire-info-box.gow-panel-collapsed .gow-collapsed-summary {
                display: flex;
            }

            #underspire-info-box.gow-panel-collapsed .gow-panel-toggle-btn {
                right: 3px;
                top: 9px;
                width: 22px;
                min-width: 22px;
                height: 22px;
                padding: 0;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                line-height: 1;
                font-size: 13px;
                font-weight: 700;
            }

            #gow-system-detail-dialog {
                position: fixed;
                z-index: 20000;
                left: 50%;
                top: 50%;
                transform: translate(-50%,-50%);
                width: 320px;
                padding: 14px;
                border-radius: 12px;
                background: rgba(255,255,255,0.96);
                box-shadow: 0 10px 30px rgba(0,0,0,.18);
                font-size: 13px;
                text-align:left;
            }

#underspire-info-box .gow-drag-handle::before {
                content: '按住此处可拖动';
                letter-spacing: 1px;
            }

            #underspire-info-box .gow-resize-handle {
                position: absolute;
                right: 8px;
                top: 30px;
                width: 8px;
                height: 46px;
                border-radius: 999px;
                background: rgba(146, 167, 171, 0.72);
                cursor: ew-resize;
            }

            #underspire-info-box .gow-scale-handle {
                position: absolute;
                right: 8px;
                bottom: 8px;
                width: 14px;
                height: 14px;
                border-radius: 4px;
                background: rgba(146, 167, 171, 0.75);
                cursor: nwse-resize;
            }

            #underspire-info-box .gow-scale-handle::before,
            #underspire-info-box .gow-scale-handle::after {
                content: '';
                position: absolute;
                right: 2px;
                bottom: 2px;
                width: 7px;
                height: 1px;
                background: rgba(255,255,255,0.85);
                transform-origin: right bottom;
                transform: rotate(-45deg);
            }

            #underspire-info-box .gow-scale-handle::after {
                right: 4px;
                bottom: 4px;
                width: 4px;
            }

            #gow-map-float-tool {
                position: fixed;
                right: 18px;
                top: 70px;
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 8px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.94);
                box-shadow: 0 6px 18px rgba(0,0,0,0.12);
                font-family: ${FONT_FAMILY};
                font-size: 12px;
                color: #34424a;
                user-select: none;
                cursor: move;
            }

            #gow-map-float-tool .gow-map-float-label {
                font-weight: 700;
                color: #62727a;
                white-space: nowrap;
            }

            #gow-map-float-tool .gow-map-float-btn {
                height: 30px;
                padding: 0 10px;
                border: 1px solid rgba(0,0,0,0.10);
                border-radius: 999px;
                background: #f6f8f9;
                color: #34424a;
                font-family: ${FONT_FAMILY};
                font-size: 12px;
                cursor: pointer;
                white-space: nowrap;
            }

            #gow-map-float-tool .gow-map-float-btn.is-active {
                background: rgba(217, 119, 6, 0.13);
                border-color: rgba(217, 119, 6, 0.18);
                color: #a24b08;
            }

            #underspire-map.gow-map-unlocked {
                outline: 2px dashed rgba(95, 143, 146, 0.55);
                outline-offset: 2px;
                cursor: move;
            }

            #underspire-map .gow-map-resize-handle {
                position: absolute;
                right: 6px;
                bottom: 6px;
                width: 14px;
                height: 14px;
                border-radius: 4px;
                background: rgba(95, 143, 146, 0.75);
                cursor: nwse-resize;
                display: none;
                z-index: 5;
            }

            #underspire-map.gow-map-unlocked .gow-map-resize-handle {
                display: block;
            }

            #underspire-buy-plan .gow-map-tool-box {
                padding-top: 4px;
            }

            #underspire-buy-plan .gow-map-tool-box.is-hidden {
                display: none;
            }

            #underspire-buy-plan .gow-map-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-bottom: 6px;
            }

            #underspire-buy-plan .gow-map-row:last-child {
                margin-bottom: 0;
            }

            #underspire-buy-plan .gow-map-btn {
                min-width: 32px;
                height: 28px;
                padding: 0 8px;
                border: 1px solid rgba(0,0,0,0.10);
                border-radius: 8px;
                background: rgba(255,255,255,0.78);
                color: #34424a;
                font-family: ${FONT_FAMILY};
                font-size: 12px;
                cursor: pointer;
            }

            #underspire-buy-plan .gow-map-scale {
                min-width: 54px;
                text-align: center;
                font-weight: 700;
            }
        `;

        document.head.appendChild(style);
    }

    function ensurePlan(infoPanel) {
        ensurePlanStyles();

        let plan = document.querySelector('#underspire-buy-plan');

        if (plan && plan.parentElement !== infoPanel) {
            plan.remove();
            plan = null;
        }

        if (!plan) {
            plan = document.createElement('div');
            plan.id = 'underspire-buy-plan';

            plan.addEventListener('click', event => {
                const target = event.target.closest('button');
                if (!target) return;

                if (target.id === 'gow-plan-detail-toggle') {
                    const expanded = localStorage.getItem(STORAGE_PLAN_DETAIL_EXPANDED) === 'true';
                    localStorage.setItem(STORAGE_PLAN_DETAIL_EXPANDED, expanded ? 'false' : 'true');
                } else if (target.id === 'gow-map-tools-toggle') {
                    const expanded = localStorage.getItem(STORAGE_MAP_TOOLS_EXPANDED) === 'true';
                    localStorage.setItem(STORAGE_MAP_TOOLS_EXPANDED, expanded ? 'false' : 'true');
                } else if (target.dataset.mapAction) {
                    let scale = getMapScaleValue();
                    let offsetX = getNumberFromStorage(STORAGE_MAP_OFFSET_X, 0);
                    let offsetY = getNumberFromStorage(STORAGE_MAP_OFFSET_Y, 0);
                    const step = 30;
                    const action = target.dataset.mapAction;

                    if (action === 'zoom-in') scale = Math.min(2.5, +(scale + 0.1).toFixed(2));
                    if (action === 'zoom-out') scale = Math.max(0.5, +(scale - 0.1).toFixed(2));
                    if (action === 'left') offsetX -= step;
                    if (action === 'right') offsetX += step;
                    if (action === 'up') offsetY -= step;
                    if (action === 'down') offsetY += step;
                    if (action === 'reset') {
                        scale = 1;
                        offsetX = 0;
                        offsetY = 0;
                    }

                    localStorage.setItem(STORAGE_MAP_SCALE, String(scale));
                    localStorage.setItem(STORAGE_MAP_OFFSET_X, String(offsetX));
                    localStorage.setItem(STORAGE_MAP_OFFSET_Y, String(offsetY));
                    applyMapView();
                } else if (target.dataset.panelAction) {
                    let panelScale = getPanelScaleValue();
                    const action = target.dataset.panelAction;
                    if (action === 'zoom-in') panelScale = Math.min(1.4, +(panelScale + 0.1).toFixed(2));
                    if (action === 'zoom-out') panelScale = Math.max(0.8, +(panelScale - 0.1).toFixed(2));
                    if (action === 'reset') panelScale = 1;
                    localStorage.setItem(STORAGE_PANEL_SCALE, String(panelScale));
                    const box = document.querySelector('#underspire-info-box');
                    if (box) applyPanelScale(box);
                }

                const currentInfoPanel = document.querySelector('#underspire-info');
                if (currentInfoPanel) {
                    updatePurchasePlan(currentInfoPanel);
                }
            });

            infoPanel.appendChild(plan);
        }

        return plan;
    }

    function getPanelScaleValue() {
        const raw = parseFloat(localStorage.getItem(STORAGE_PANEL_SCALE) || '1');
        return Number.isFinite(raw) ? raw : 1;
    }




    function updatePurchasePlan(infoPanel) {
        if (!infoPanel) return;

        autoResetTodayBoughtIfNewRound();
        createCustomControls(infoPanel);
        setupSyncButtonHook();

        const plan = ensurePlan(infoPanel);
        const totalNeed = parseTotalNeed(infoPanel);

        if (totalNeed === null) {
            const waitingSignature = 'waiting';
            if (plan.dataset.gowSignature !== waitingSignature) {
                plan.innerHTML = `
                    <div class="gow-waiting">正在读取地图需求，请稍候…</div>
                `;
                plan.dataset.gowSignature = waitingSignature;
            }

            refreshControlValues();
            return;
        }

        const completedCount = getCompletedNodeCount();
        const weeklyTotal = Math.max(0, completedCount + totalNeed);
        const { currentTorch, todayBought } = getCustomValues();

        const futureRefreshCount = getFutureRefreshCount();
        const futureGiftTorch = futureRefreshCount * GIFT_PER_REFRESH;
        const availableBeforeBuy = currentTorch + futureGiftTorch;
        const shortage = Math.max(0, totalNeed - availableBeforeBuy);
        const needBuyTimes = Math.ceil(shortage / BUY_PER_TIME);

        const diamondResult = calculateDiamondCost(
            needBuyTimes,
            todayBought,
            futureRefreshCount
        );

        const boughtTorch = diamondResult.actualBuyTimes * BUY_PER_TIME;
        const availableAfterBuy = availableBeforeBuy + boughtTorch;
        const finalDifference = availableAfterBuy - totalNeed;
        const stillShort = Math.max(0, -finalDifference);
        const finalSurplus = Math.max(0, finalDifference);
        const isSafe = stillShort === 0;
        const detailExpanded = localStorage.getItem(STORAGE_PLAN_DETAIL_EXPANDED) === 'true';

        const holdUsed = Math.min(Math.max(0, currentTorch), Math.max(0, totalNeed));
        const remainAfterHold = Math.max(0, totalNeed - holdUsed);
        const giftUsed = Math.min(Math.max(0, futureGiftTorch), remainAfterHold);
        const remainAfterGift = Math.max(0, remainAfterHold - giftUsed);
        const purchaseUsed = Math.min(Math.max(0, boughtTorch), remainAfterGift);
        const missingAmount = Math.max(0, totalNeed - holdUsed - giftUsed - purchaseUsed);
        const surplusAmount = Math.max(0, currentTorch + futureGiftTorch + boughtTorch - totalNeed);

        // 4.2.9 当前进度总览：
        // 已完成节点 + 当前火把可覆盖 + 免费补给可覆盖 + 预计购买可覆盖 + 最终缺口
        // 共同覆盖本周总房间；若购买后有富余，则在末尾增加绿色“溢出”段。
        const progressTotal = Math.max(0, weeklyTotal);
        const progressCompleted = Math.min(Math.max(0, completedCount), progressTotal);
        const progressStackTotal = Math.max(1, progressTotal + surplusAmount);

        const progressStackPercent = value => {
            return Math.max(0, (Math.max(0, value) / progressStackTotal) * 100);
        };

        const completedProgressPercent = progressStackPercent(progressCompleted);
        const holdProgressPercent = progressStackPercent(holdUsed);
        const giftProgressPercent = progressStackPercent(giftUsed);
        const purchaseProgressPercent = progressStackPercent(purchaseUsed);
        const missingProgressPercent = progressStackPercent(missingAmount);
        const surplusProgressPercent = progressStackPercent(surplusAmount);

        const progressSegmentStyle = (value, percent) => {
            if (value <= 0) return 'display:none;';
            return `width:${percent.toFixed(4)}%;`;
        };


        let statusClass = 'is-ok';
        let statusTitle = '无需购买';
        let statusSub = `当前持有与后续免费补给已足够，预计剩余 ${finalSurplus} 个`;

        if (shortage > 0 && isSafe) {
            statusClass = 'is-buy';
            statusTitle = `建议购买 ${needBuyTimes} 次`;
            statusSub = `约 ${diamondResult.totalCost} 钻，补充 ${boughtTorch} 个，预计剩余 ${finalSurplus} 个`;
        }

        if (!isSafe) {
            statusClass = 'is-danger';
            statusTitle = '按上限购买后仍不足';
            statusSub = `最多可买 ${diamondResult.actualBuyTimes} 次，最终仍缺 ${stillShort} 个火把`;
        }

        const buyTimesText = shortage === 0
            ? '无需购买'
            : isSafe
                ? `${needBuyTimes} 次`
                : `${diamondResult.actualBuyTimes} 次（已达上限）`;

        const coverageText = isSafe
            ? (finalSurplus > 0
                ? `结果：剩余路线可全部覆盖，预计溢出 ${finalSurplus} 火把`
                : `结果：剩余路线可全部覆盖，火把刚好够用`)
            : `结果：按当前购买上限仍缺 ${stillShort} 火把，需调整路线或增加其他来源`;

        const progressNoteClass = isSafe ? '' : ' is-danger';
        const warningHtml = !isSafe
            ? `<div class="gow-warning">红色段表示：当前火把 + 免费补给 + 预计购买后仍未覆盖的火把缺口。</div>`
            : '';

        const planSignature = [
            totalNeed,
            completedCount,
            weeklyTotal,
            currentTorch,
            todayBought,
            futureRefreshCount,
            futureGiftTorch,
            boughtTorch,
            diamondResult.totalCost,
            diamondResult.count50,
            diamondResult.count100,
            diamondResult.count150,
            shortage,
            stillShort,
            finalSurplus,
            detailExpanded ? 1 : 0,
            localStorage.getItem(STORAGE_MAP_TOOLS_EXPANDED) === 'true' ? 1 : 0,
            Math.round(getMapScaleValue() * 100),
            Math.round(getPanelScaleValue() * 100)
        ].join('|');

        if (plan.dataset.gowSignature !== planSignature) {
            plan.innerHTML = `
                <div class="gow-status ${statusClass}">
                    <div class="gow-status-title">${statusTitle}</div>
                    <div class="gow-status-sub">${statusSub}</div>
                </div>

                <div class="gow-progress-wrap">
                    <div class="gow-progress-block">
                        <div class="gow-progress-head">
                            <span class="gow-legend-left"><i class="gow-legend-dot gow-progress-dot"></i>当前进度</span>
                            <span class="gow-legend-value">${progressCompleted} / ${progressTotal}</span>
                        </div>
                        <div class="gow-progress-composite-large"
                             title="青色=已完成；蓝色=当前火把；浅绿=免费补给；橙色=预计购买用于覆盖；绿色=最终溢出；红色=最终缺口">
                            ${progressCompleted > 0 ? `<span class="gow-progress-segment-label gow-progress-done" data-small="${completedProgressPercent < 8}" style="${progressSegmentStyle(progressCompleted, completedProgressPercent)}" title="已完成：${progressCompleted}">${progressCompleted}</span>` : ''}
                            ${holdUsed > 0 ? `<span class="gow-progress-segment-label gow-progress-hold" data-small="${holdProgressPercent < 8}" style="${progressSegmentStyle(holdUsed, holdProgressPercent)}" title="当前火把可覆盖：${holdUsed}">${holdUsed}</span>` : ''}
                            ${giftUsed > 0 ? `<span class="gow-progress-segment-label gow-progress-gift" data-small="${giftProgressPercent < 8}" style="${progressSegmentStyle(giftUsed, giftProgressPercent)}" title="免费补给可覆盖：${giftUsed}">${giftUsed}</span>` : ''}
                            ${purchaseUsed > 0 ? `<span class="gow-progress-segment-label gow-progress-purchase" data-small="${purchaseProgressPercent < 8}" style="${progressSegmentStyle(purchaseUsed, purchaseProgressPercent)}" title="预计购买用于覆盖：${purchaseUsed}">${purchaseUsed}</span>` : ''}
                            ${missingAmount > 0 ? `<span class="gow-progress-segment-label gow-progress-missing" data-small="${missingProgressPercent < 8}" style="${progressSegmentStyle(missingAmount, missingProgressPercent)}" title="最终火把缺口：${missingAmount}">${missingAmount}</span>` : ''}
                            ${surplusAmount > 0 ? `<span class="gow-progress-segment-label gow-progress-surplus" data-small="${surplusProgressPercent < 8}" style="${progressSegmentStyle(surplusAmount, surplusProgressPercent)}" title="最终溢出火把：${surplusAmount}">+${surplusAmount}</span>` : ''}
                        </div>
                    </div>

                    <div class="gow-resource-block">

                        <div class="gow-resource-list">
                            <div class="gow-resource-row">
                                <span class="gow-legend-left"><i class="gow-legend-dot is-hold"></i>当前火把</span>
                                <span class="gow-legend-value">${currentTorch}</span>
                            </div>
                            <div class="gow-resource-row">
                                <span class="gow-legend-left"><i class="gow-legend-dot is-gift"></i>免费补给</span>
                                <span class="gow-legend-value">+${futureGiftTorch}</span>
                            </div>
                            <div class="gow-resource-row">
                                <span class="gow-legend-left"><i class="gow-legend-dot is-purchase"></i>预计购买</span>
                                <span class="gow-legend-value">+${boughtTorch}</span>
                            </div>
                            ${surplusAmount > 0 ? `<div class="gow-resource-row"><span class="gow-legend-left"><i class="gow-legend-dot is-surplus"></i>溢出火把</span><span class="gow-legend-value">+${surplusAmount}</span></div>` : ''}
                            ${missingAmount > 0 ? `<div class="gow-resource-row"><span class="gow-legend-left"><i class="gow-legend-dot is-missing"></i>火把缺口</span><span class="gow-legend-value">${missingAmount}</span></div>` : ''}
                        </div>
                    </div>

                    <div class="gow-progress-note${progressNoteClass}">
                        ${coverageText}
                    </div>
                </div>

                <div class="gow-section">
                    <div class="gow-section-head">
                        <div class="gow-section-title">购买方案</div>
                        <button id="gow-plan-detail-toggle" class="gow-detail-toggle" type="button">
                            ${detailExpanded ? '收起详情 ▲' : '展开详情 ▼'}
                        </button>
                    </div>

                    ${renderDiamondDetail(diamondResult)}

                    <div class="gow-cost">
                        预计钻石消耗
                        <strong>${diamondResult.totalCost}</strong>
                        钻
                    </div>

                    <div class="gow-detail-box ${detailExpanded ? '' : 'is-hidden'}">
                        <div class="gow-detail-row"><span>已完成节点</span><b>${completedCount} 个</b></div>
                        <div class="gow-detail-row"><span>尚待完成需求</span><b>${totalNeed} 个火把</b></div>
                        <div class="gow-detail-row"><span>当前持有</span><b>${currentTorch} 个</b></div>
                        <div class="gow-detail-row"><span>本轮已购</span><b>${todayBought} 次</b></div>
                        <div class="gow-detail-row"><span>后续免费补给</span><b>+${futureGiftTorch} 个</b></div>
                        <div class="gow-detail-row"><span>建议购买</span><b>${buyTimesText}</b></div>
                        <div class="gow-detail-row"><span>购买补充</span><b>+${boughtTorch} 个</b></div>
                        <div class="gow-detail-row"><span>缺少数量</span><b>${missingAmount}</b></div>
                        <div class="gow-detail-row"><span>溢出数量</span><b>+${surplusAmount}</b></div>
                        <div class="gow-detail-row"><span>最终结果</span><b>${isSafe ? `覆盖 ${totalNeed} / ${totalNeed}（余 ${finalSurplus}）` : `覆盖 ${availableAfterBuy} / ${totalNeed}（仍缺 ${stillShort}）`}</b></div>
                    </div>

                    ${warningHtml}
                </div>
            `;

            plan.dataset.gowSignature = planSignature;
        }

        refreshControlValues();
    }


    function setupDraggableBox(box) {
        if (!box || box.dataset.dragReady === 'true') return;

        let handle = box.querySelector('.gow-drag-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'gow-drag-handle';
            box.insertBefore(handle, box.firstChild);
        }

        let resizeHandle = box.querySelector('.gow-resize-handle');
        if (!resizeHandle) {
            resizeHandle = document.createElement('div');
            resizeHandle.className = 'gow-resize-handle';
            box.appendChild(resizeHandle);
        }

        let scaleHandle = box.querySelector('.gow-scale-handle');
        if (!scaleHandle) {
            scaleHandle = document.createElement('div');
            scaleHandle.className = 'gow-scale-handle';
            box.appendChild(scaleHandle);
        }

        const clampPosition = (left, top) => {
            const rect = box.getBoundingClientRect();
            const maxLeft = Math.max(0, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(0, window.innerHeight - rect.height - 8);
            const safeLeft = Math.min(Math.max(0, left), maxLeft);
            const safeTop = Math.min(Math.max(0, top), maxTop);
            box.style.left = `${safeLeft}px`;
            box.style.top = `${safeTop}px`;
            localStorage.setItem(STORAGE_PANEL_LEFT, String(safeLeft));
            localStorage.setItem(STORAGE_PANEL_TOP, String(safeTop));
        };

        const applyWidth = rawWidth => {
            const maxWidth = Math.min(620, window.innerWidth - 20);
            const width = Math.min(Math.max(300, rawWidth), Math.max(300, maxWidth));
            box.style.width = `${width}px`;
            localStorage.setItem(STORAGE_PANEL_WIDTH, String(width));
            applyPanelScale(box);
            const currentLeft = parseInt(localStorage.getItem(STORAGE_PANEL_LEFT) || box.style.left || '40', 10);
            const currentTop = parseInt(localStorage.getItem(STORAGE_PANEL_TOP) || box.style.top || '24', 10);
            clampPosition(currentLeft, currentTop);
        };

        const savedLeft = parseInt(localStorage.getItem(STORAGE_PANEL_LEFT) || '', 10);
        const savedTop = parseInt(localStorage.getItem(STORAGE_PANEL_TOP) || '', 10);
        const savedWidth = parseInt(localStorage.getItem(STORAGE_PANEL_WIDTH) || '', 10);

        requestAnimationFrame(() => {
            applyWidth(Number.isFinite(savedWidth) ? savedWidth : 360);
            clampPosition(Number.isFinite(savedLeft) ? savedLeft : 40, Number.isFinite(savedTop) ? savedTop : 24);
        });

        handle.addEventListener('mousedown', event => {
            if (event.target === resizeHandle) return;
            event.preventDefault();

            const rect = box.getBoundingClientRect();
            const offsetX = event.clientX - rect.left;
            const offsetY = event.clientY - rect.top;

            const onMove = moveEvent => {
                clampPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        resizeHandle.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startWidth = box.offsetWidth;

            const onMove = moveEvent => {
                applyWidth(startWidth + (moveEvent.clientX - startX));
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        scaleHandle.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();

            const startX = event.clientX;
            const startY = event.clientY;
            const startScale = getPanelScaleValue();

            const onMove = moveEvent => {
                const delta = Math.max(moveEvent.clientX - startX, moveEvent.clientY - startY);
                const nextScale = Math.min(1.4, Math.max(0.8, +(startScale + delta / 260).toFixed(2)));
                localStorage.setItem(STORAGE_PANEL_SCALE, String(nextScale));
                applyPanelScale(box);
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        window.addEventListener('resize', () => {
            const currentWidth = parseInt(localStorage.getItem(STORAGE_PANEL_WIDTH) || box.style.width || '360', 10);
            const currentLeft = parseInt(localStorage.getItem(STORAGE_PANEL_LEFT) || box.style.left || '40', 10);
            const currentTop = parseInt(localStorage.getItem(STORAGE_PANEL_TOP) || box.style.top || '24', 10);
            applyWidth(currentWidth);
            clampPosition(currentLeft, currentTop);
        });

        box.dataset.dragReady = 'true';
    }

    function getMapScaleValue() {
        const raw = parseFloat(localStorage.getItem(STORAGE_MAP_SCALE) || '1');
        return Number.isFinite(raw) ? raw : 1;
    }

    function applyPanelScale(box) {
        if (!box) return;
        const scale = Math.min(1.4, Math.max(0.8, getPanelScaleValue()));
        box.style.transformOrigin = 'top left';
        box.style.transform = `scale(${scale})`;

        const currentLeft = parseInt(localStorage.getItem(STORAGE_PANEL_LEFT) || box.style.left || '40', 10);
        const currentTop = parseInt(localStorage.getItem(STORAGE_PANEL_TOP) || box.style.top || '24', 10);
        const rect = box.getBoundingClientRect();
        const maxLeft = Math.max(0, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(0, window.innerHeight - rect.height - 8);
        const safeLeft = Math.min(Math.max(0, currentLeft), maxLeft);
        const safeTop = Math.min(Math.max(0, currentTop), maxTop);
        box.style.left = `${safeLeft}px`;
        box.style.top = `${safeTop}px`;
        localStorage.setItem(STORAGE_PANEL_LEFT, String(safeLeft));
        localStorage.setItem(STORAGE_PANEL_TOP, String(safeTop));
    }

    function applyMapView() {
        const map = document.querySelector('#underspire-map');
        if (!map) return;

        const scale = Math.min(2.5, Math.max(0.5, getMapScaleValue()));
        const offsetX = getNumberFromStorage(STORAGE_MAP_OFFSET_X, 0);
        const offsetY = getNumberFromStorage(STORAGE_MAP_OFFSET_Y, 0);

        map.style.zoom = String(scale);
        map.style.transform = 'translateZ(0)';
        map.style.transformOrigin = 'top left';
        map.style.position = 'relative';
        map.style.left = `${offsetX}px`;
        map.style.top = `${offsetY}px`;
        map.style.zIndex = '1';
        map.style.willChange = 'transform';
        map.style.backfaceVisibility = 'hidden';
        map.style.webkitFontSmoothing = 'antialiased';

        if (map.parentElement) {
            map.parentElement.style.overflow = 'visible';
        }

        const scaleValue = document.querySelector('#gow-map-scale-value');
        if (scaleValue) {
            scaleValue.textContent = `${Math.round(scale * 100)}%`;
        }
        applyMapInteractionState();
    }

    function ensureMapControls() {
        applyMapView();
        ensureMapFloatingTool();
        setupMapInteractions();
    }

    function isMapUnlocked() {
        return localStorage.getItem(STORAGE_MAP_UNLOCKED) === 'true';
    }

    function resetMapView() {
        localStorage.setItem(STORAGE_MAP_SCALE, '1');
        localStorage.setItem(STORAGE_MAP_OFFSET_X, '0');
        localStorage.setItem(STORAGE_MAP_OFFSET_Y, '0');
        applyMapView();
    }

    function ensureMapResizeHandle() {
        const map = document.querySelector('#underspire-map');
        if (!map) return null;
        let handle = map.querySelector('.gow-map-resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.className = 'gow-map-resize-handle';
            map.appendChild(handle);
        }
        map.style.position = 'relative';
        return handle;
    }

    function applyMapInteractionState() {
        const map = document.querySelector('#underspire-map');
        if (!map) return;
        ensureMapResizeHandle();
        map.classList.toggle('gow-map-unlocked', isMapUnlocked());
        const btn = document.querySelector('#gow-map-unlock-btn');
        if (btn) {
            btn.classList.toggle('is-active', isMapUnlocked());
            btn.textContent = isMapUnlocked() ? '锁定地图' : '解锁地图';
        }
    }

    function ensureMapFloatingTool() {
        let widget = document.querySelector('#gow-map-float-tool');
        if (!widget) {
            widget = document.createElement('div');
            widget.id = 'gow-map-float-tool';
            widget.innerHTML = `
                <div class="gow-map-float-label">地图调整</div>
                <button id="gow-map-guidance-btn" class="gow-map-float-btn" type="button">指引开启</button>
                <button id="gow-map-unlock-btn" class="gow-map-float-btn" type="button">解锁地图</button>
                <button id="gow-map-reset-btn" class="gow-map-float-btn" type="button">重置地图</button>
            `;
            document.body.appendChild(widget);

            widget.addEventListener('click', event => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                if (target.id === 'gow-map-guidance-btn') {
                    setRouteGuidanceEnabled(!isRouteGuidanceEnabled());
                } else if (target.id === 'gow-map-unlock-btn') {
                    localStorage.setItem(STORAGE_MAP_UNLOCKED, isMapUnlocked() ? 'false' : 'true');
                    applyMapInteractionState();
                } else if (target.id === 'gow-map-reset-btn') {
                    resetMapView();
                    applyMapInteractionState();
                }
            });

            widget.addEventListener('mousedown', event => {
                const target = event.target;
                if (target instanceof HTMLElement && target.closest('button')) return;
                event.preventDefault();
                const rect = widget.getBoundingClientRect();
                const offsetX = event.clientX - rect.left;
                const offsetY = event.clientY - rect.top;

                const clamp = (left, top) => {
                    const wrect = widget.getBoundingClientRect();
                    const maxLeft = Math.max(0, window.innerWidth - wrect.width - 8);
                    const maxTop = Math.max(0, window.innerHeight - wrect.height - 8);
                    const safeLeft = Math.min(Math.max(0, left), maxLeft);
                    const safeTop = Math.min(Math.max(0, top), maxTop);
                    widget.style.left = `${safeLeft}px`;
                    widget.style.top = `${safeTop}px`;
                    widget.style.right = 'auto';
                    localStorage.setItem(STORAGE_MAP_WIDGET_LEFT, String(safeLeft));
                    localStorage.setItem(STORAGE_MAP_WIDGET_TOP, String(safeTop));
                };

                const onMove = moveEvent => clamp(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        const savedLeft = parseInt(localStorage.getItem(STORAGE_MAP_WIDGET_LEFT) || '', 10);
        const savedTop = parseInt(localStorage.getItem(STORAGE_MAP_WIDGET_TOP) || '', 10);
        if (Number.isFinite(savedLeft) && Number.isFinite(savedTop)) {
            widget.style.left = `${savedLeft}px`;
            widget.style.top = `${savedTop}px`;
            widget.style.right = 'auto';
        }
        applyMapInteractionState();
        updateRouteGuidanceButton();
        return widget;
    }

    function setupMapInteractions() {
        const map = document.querySelector('#underspire-map');
        if (!map || map.dataset.gowInteractionReady === 'true') return;

        const handle = ensureMapResizeHandle();

        map.addEventListener('mousedown', event => {
            if (!isMapUnlocked()) return;
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('.gow-map-resize-handle')) return;
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const startOffsetX = getNumberFromStorage(STORAGE_MAP_OFFSET_X, 0);
            const startOffsetY = getNumberFromStorage(STORAGE_MAP_OFFSET_Y, 0);

            const onMove = moveEvent => {
                localStorage.setItem(STORAGE_MAP_OFFSET_X, String(startOffsetX + (moveEvent.clientX - startX)));
                localStorage.setItem(STORAGE_MAP_OFFSET_Y, String(startOffsetY + (moveEvent.clientY - startY)));
                applyMapView();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        if (handle) {
            handle.addEventListener('mousedown', event => {
                if (!isMapUnlocked()) return;
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startY = event.clientY;
                const startScale = getMapScaleValue();
                const onMove = moveEvent => {
                    const delta = Math.max(moveEvent.clientX - startX, moveEvent.clientY - startY);
                    const nextScale = Math.min(2.5, Math.max(0.5, +(startScale + delta / 260).toFixed(2)));
                    localStorage.setItem(STORAGE_MAP_SCALE, String(nextScale));
                    applyMapView();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        map.dataset.gowInteractionReady = 'true';
    }

    function moveInfoPanel() {
        const infoPanel = document.querySelector('#underspire-info');
        if (!infoPanel) return;

        let box = document.querySelector('#underspire-info-box');

        if (!box) {
            box = document.createElement('div');
            box.id = 'underspire-info-box';
            document.body.appendChild(box);
        }

        if (box.parentElement !== document.body) {
            document.body.appendChild(box);
        }

        if (infoPanel.parentElement !== box) {
            box.appendChild(infoPanel);
        }

        box.style.padding = '0 10px 12px';
        box.style.fontFamily = FONT_FAMILY;
        box.style.fontSize = FONT_SIZE;
        box.style.lineHeight = '1.9';

        infoPanel.style.position = 'static';
        infoPanel.style.width = '100%';
        infoPanel.style.margin = '0';
        infoPanel.style.padding = '0';
        infoPanel.style.textAlign = 'center';
        infoPanel.style.whiteSpace = 'nowrap';
        infoPanel.style.fontFamily = FONT_FAMILY;
        infoPanel.style.fontSize = FONT_SIZE;

        infoPanel.querySelectorAll('.line').forEach(line => {
            line.style.whiteSpace = 'nowrap';
            line.style.fontFamily = FONT_FAMILY;
            line.style.fontSize = FONT_SIZE;
        });

        infoPanel.dataset.moved = 'true';

        setupDraggableBox(box);
        applyPanelScale(box);
        ensureMapControls();
        updateSystemInfoCollapse(infoPanel);
        updatePurchasePlan(infoPanel);
        setupSyncButtonHook();
        setupPanelCollapse();
    }


    moveInfoPanel();
    startInitialRouteWatch();

    setTimeout(scheduleRender, 500);
    setTimeout(scheduleRender, 1500);
    setTimeout(scheduleRender, 3000);
    setTimeout(scheduleRender, 6000);

    setInterval(() => {
        scheduleRender(50);
    }, 600 * 1000);

    function isInsideOwnUi(node) {
        const element = node && node.nodeType === Node.ELEMENT_NODE
            ? node
            : node && node.parentElement;

        if (!element || !element.closest) return false;

        return Boolean(
            element.closest('#underspire-buy-plan') ||
            element.closest('#underspire-custom-controls') ||
            element.closest('#gow-plugin-details') ||
            element.closest('#gow-system-toggle-row') ||
            element.closest('#underspire-info-box') ||
            element.closest('#gow-map-float-tool')
        );
    }

    const observer = new MutationObserver(mutations => {
        const hasExternalChange = mutations.some(mutation => {
            return !isInsideOwnUi(mutation.target);
        });

        if (hasExternalChange) {
            scheduleRender(150);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
})();