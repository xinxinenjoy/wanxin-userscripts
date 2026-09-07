// ==UserScript==
// @name         蝶美-1.2套餐危害核对
// @namespace    https://dime.health-100.cn/
// @version      4.2.16
// @description  蝶美套餐危害核对：提供自动化核对、批量处理、自动选择等功能。注意：套餐名称的标准格式应为：XX-危害1+危害2+危害3+岗中+男，不保证能识别其他格式。

// @match        https://dime.health-100.cn/*
// @run-at       document-idle
// @grant        none
// @noframes

// @author       WanXin
// @publishGroup diemei
// @publishID    diemei-weihaihedui
// @updateURL    https://scripts.wanxinxin.dpdns.org/diemei/diemei-weihaihedui.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/diemei/diemei-weihaihedui.user.js
// ==/UserScript==

/*
 * 更新记录
 *
 * v4.2.15  -  2026-8-29
 * - 优化：所有危害自动补齐在真正写入搜索框前，统一先解析映射关系；存在映射时始终使用映射后的标准危害名称进行搜索和选择。
 * - 优化：该规则同时适用于内置别名和用户自行保存的匹配规则，不再需要针对名称顺序、简称等差异逐个修改补齐逻辑。
 *
 * v4.2.14  -  2026-8-29
 * - 修复：“酸酐或酸雾”与系统实际危害名称“酸雾或酸酐”顺序不一致时，映射规则无法生效、自动补齐仍按旧名称搜索的问题。
 * - 优化：将系统真实危害名称“酸雾或酸酐”纳入标准危害库；套餐中的“酸酐或酸雾”通过既有别名规则统一映射后参与核对和补齐。
 *
 */

(function () {
  "use strict";

  const GLOBAL_KEY = "__DIME_HAZARD_PACKAGE_CHECKER_V4215__";
  [
    "__DIME_HAZARD_PACKAGE_CHECKER_V4215__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V4214__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V4213__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V4212__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V4211__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V4210__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V429__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V428__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V427__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V426__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V425__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V424__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V423__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V422__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V421__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V420__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V413__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V412__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V411__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V410__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V409__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V408__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V407__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V406__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V405__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V404__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V403__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V402__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V401__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V400__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V380__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V379__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V378__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V377__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V376KEY__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V375T10__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V374__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V37__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V36__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V35__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V34__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V33__",
    "__DIME_HAZARD_PACKAGE_CHECKER_V32__"
  ].forEach(key => {
    try { window[key]?.destroy?.(); } catch (_) {}
  });

  const TOOL_ID = "dime-hazard-package-checker-v3";
  const STYLE_ID = TOOL_ID + "-style";
  const LAUNCHER_ID = TOOL_ID + "-launcher";
  const LAUNCHER_POSITION_KEY = "dime-hazard-checker-launcher-position-v383";
  const OPEN_EVENT = "dime-floating-tool-open";
  const POSITION_KEY = TOOL_ID + "-position";
  const MARKER_CLASS = "dime-hazard-check-marker-v3";
  const AUTO_PANEL_CLASS = "dime-hazard-autofill-panel-v377";
  const USER_ALIAS_STORAGE_KEY = "dime-hazard-user-alias-map-v1";
  const USER_IGNORE_STORAGE_KEY = "dime-hazard-user-ignore-list-v1";
  const USER_IGNORE_KEYWORD_STORAGE_KEY =
    "dime-hazard-user-ignore-keyword-list-v1";

  // 稳定交互原则：危害名称必须先写入 Treeselect 并触发搜索，
  // 然后逐项按 ArrowDown 定位到完全一致的候选，再按 Enter 完成选择。
  // 不把“脚本能否识别候选项 DOM”作为按键前置条件。
  const AUTOFILL_TIMING = {
    searchTimeout: 4200,
    searchStableMs: 180,
    arrowTimeout: 1400,
    arrowStableMs: 120,
    selectionTimeout: 3200,
    nextItemTimeout: 2200,

    // 搜索结果存在多个相似名称时，最多逐项移动这么多次。
    exactCandidateMaxMoves: 30
  };

  // 批量处理优先保证一次完成，而不是追求最快速度。
  // 每个套餐保存后都会重新打开编辑弹窗，确认数据已经真正写入。
  const BATCH_RELIABILITY = {
    dialogLoadDelayMs: 650,
    selectionStableMs: 650,
    beforeSubmitStableMs: 750,

    // 组合操作采用“岗位优先”。
    // selectDialogStage 已经确认岗位值写入，因此只留很短时间关闭下拉，
    // 随后立即开始危害选择；准确性由提交前双向复核保证。
    combinedStageToHazardDelayMs: 120,
    combinedFinalStableMs: 1000,
    combinedBeforeSubmitStableMs: 700,

    afterSubmitCooldownMs: 750,
    verifyOpenDelayMs: 650,
    retryDelayMs: 900,
    maxPackageAttempts: 3
  };

  // 后台重新打开只作为稀疏抽检：
  // 组合项目提交前已复核岗位和危害，因此首个及每 10 个组合项目抽检一次。
  const BATCH_ADAPTIVE_VERIFY = {
    verifyFirstCombinedPackage: true,
    auditEveryCombinedPackages: 10
  };

  [
    ".dime-hazard-autofill-panel-v377",
    ".dime-hazard-autofill-panel-v376key",
    ".dime-hazard-autofill-panel-v375t10",
    ".dime-hazard-autofill-panel-v374",
    ".dime-hazard-autofill-panel-v37",
    ".dime-hazard-autofill-panel-v36",
    ".dime-hazard-autofill-panel-v35",
    ".dime-hazard-autofill-panel-v34",
    ".dime-hazard-autofill-panel-v33",
    ".dime-hazard-autofill-panel-v32"
  ].forEach(selector => document.querySelectorAll(selector).forEach(element => element.remove()));

  document.getElementById(TOOL_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(LAUNCHER_ID)?.remove();

  // 清理上一版本残留，避免旧高亮和旧工具窗口影响本次核对。
  document.getElementById("dime-hazard-package-checker-v2")?.remove();
  document.getElementById("dime-hazard-package-checker-v2-style")?.remove();
  document.querySelectorAll(".dime-hazard-check-marker-v2").forEach(element => element.remove());
  document.querySelectorAll(
    ".dime-hazard-row-missing-v2, .dime-hazard-row-parse-error-v2, " +
    ".dime-hazard-cell-source-v2, .dime-hazard-cell-target-v2, .dime-hazard-cell-parse-error-v2"
  ).forEach(element => {
    element.classList.remove(
      "dime-hazard-row-missing-v2", "dime-hazard-row-parse-error-v2",
      "dime-hazard-cell-source-v2", "dime-hazard-cell-target-v2",
      "dime-hazard-cell-parse-error-v2"
    );
  });

  const STANDARD_NAMES = [
  "氡及其短寿命子体",
  "其他（放射）",
  "铀及其化合物",
  "中子",
  "X射线",
  "X射线（放射卫生）",
  "α射线",
  "β射线",
  "γ射线",
  "白云石粉尘",
  "钡及其化合物粉尘",
  "玻璃粉",
  "玻璃钢粉尘",
  "茶尘",
  "沉淀 SiO2（白炭黑）",
  "大豆粉尘",
  "大理石粉尘 （碳酸钙）",
  "单质硅粉尘",
  "电焊烟尘",
  "动物蛋白粉尘",
  "二氧化钛粉尘",
  "二异氰酸甲苯脂",
  "沸石粉尘",
  "酚醛树酯粉尘",
  "工业酶混合尘",
  "谷物粉尘（游离 SiO2 含量＜10%）",
  "硅灰石粉尘",
  "硅藻土粉尘（游离 SiO2 含量＜10%）",
  "过氯酸铵粉尘",
  "滑石粉尘（游离 SiO2 含量＜10%）",
  "活性炭粉尘",
  "金属及其化合物粉尘",
  "具有半抗原性质的化学物质等形成的气溶胶",
  "聚丙烯粉尘",
  "聚丙烯腈纤维粉尘",
  "聚氯乙烯粉尘",
  "聚乙烯粉尘",
  "咖啡粉尘",
  "枯草杆菌",
  "铝尘（铝金属、铝合金粉尘氧化铝粉尘）",
  "麻尘（亚麻、黄麻、芒麻）",
  "煤尘（游离 SiO2 含量＜10%）",
  "霉菌孢子",
  "霉菌属类",
  "棉尘",
  "木材粉尘",
  "木粉尘（硬）",
  "腻子粉尘",
  "凝聚 SiO2 粉尘",
  "排泄物粉尘",
  "膨润土粉尘",
  "皮毛粉尘",
  "其他粉尘",
  "其他粉尘（染料）",
  "铅烟",
  "青石棉（crocidolite）",
  "人造矿物纤维绝热棉粉尘（玻璃棉、矿渣棉、岩棉）",
  "桑蚕丝尘",
  "砂轮磨尘",
  "石膏粉尘（硫酸钙）",
  "石灰石粉尘",
  "石棉（石棉含量＞10%）粉尘纤维",
  "石墨粉尘",
  "嗜热放线杆菌",
  "树脂粉尘",
  "水泥粉尘（游离SiO2含量<10%）",
  "炭黑粉尘",
  "碳化硅粉尘",
  "碳纤维粉尘",
  "陶土粉尘",
  "锑及其化合物粉尘",
  "铁及其化合物粉尘",
  "铁石棉（amosite）",
  "透闪石石棉（tremolite）",
  "温石棉（chrysotile）",
  "稀土粉尘（游离 SiO2 含量<10 %）",
  "锡及其化合物粉尘",
  "洗衣粉混合尘",
  "矽尘",
  "芽孢杆菌",
  "烟草尘",
  "燕麦粉尘",
  "阳起石石棉（actinolite <amiante>）",
  "药物粉尘",
  "萤石混合性粉尘",
  "硬质合金粉尘",
  "游离二氧化硅粉尘（游离SiO2含量≥10%)",
  "有机粉尘",
  "云母粉尘",
  "珍珠岩粉尘",
  "直闪石石棉（anthophy llite）",
  "纸浆粉尘",
  "蛭石粉尘",
  "重晶石粉尘（硫酸钡）",
  "铸造粉尘",
  "1-硝基丙烷（硝基丙烷）",
  "1,1-二氯-1-硝基乙烷",
  "1,1-二氯乙烯",
  "1,1,1-三氯乙烷",
  "1,2-二氯丙烷",
  "1,2-二氯乙烷",
  "1,2-二氯乙烯（全部异构体）",
  "1,2,3-苯三酚（焦棓酚）",
  "1,2,3-三氯丙烷",
  "1,2,4-苯三酸酐（TMA）",
  "1,3-丁二烯",
  "1,3-二甲基丁基乙酸酯（仲乙酸己酯、乙酸仲己酯）",
  "1,3-二氯-2-丙醇",
  "1,3-二氯丙醇",
  "1,3-二氯丙烷",
  "1,3-二氯丙烯",
  "1,6-己二胺",
  "1,6-己二异氰酸酯（六亚甲基二异氰酸酯（HDI））",
  "1,6-乙二异氰酸酯",
  "2-[2-(二甲基氨基)乙氧基]乙醇",
  "2-氨基吡啶",
  "2-丁氧基乙醇",
  "2-二乙氨基乙醇",
  "2-己酮（甲基正丁基甲酮）",
  "2-甲氧基乙醇（甲氧基乙醇）",
  "2-甲氧基乙基乙酸酯",
  "2-氯苯基羟胺",
  "2-硝基丙烷",
  "2-溴乙氧基苯",
  "2-乙氧基乙醇",
  "2-乙氧基乙基乙酸酯",
  "2-N-二丁氨基乙醇",
  "2,4-二氯苯氧基乙酸（2,4-滴）",
  "2,4-二硝基氯苯",
  "3-氯苯基羟胺",
  "3,3-二甲基联苯胺",
  "3，5，5-三甲基-2-环己烯-1-酮（异佛尔酮）",
  "4-氯苯基羟胺",
  "4,6-二硝基邻苯甲酚",
  "4,6-二硝基邻甲酚",
  "18-甲基炔诺酮（炔诺孕酮）",
  "吖啶",
  "安妥（α-萘硫脲）",
  "氨",
  "氨基磺酸铵",
  "氨基甲酸酯类",
  "氨气",
  "氨水",
  "胺类固化剂",
  "奥克托今（环四次甲基四硝胺）",
  "巴豆醛（丁烯醛）",
  "百草枯（1,1-二甲基-4,4-联吡啶鎓盐二氯化物）",
  "百菌清",
  "钡及其可溶性化合物（按 Ba 计）",
  "倍硫磷",
  "苯",
  "苯胺",
  "苯的氨基与硝基化合物（不含三硝基甲苯）",
  "苯酚",
  "苯基醚（二苯醚）",
  "苯基羟胺（苯胲）",
  "苯肼",
  "苯醌",
  "苯硫磷",
  "苯绕蒽酮",
  "苯乙醇",
  "苯乙烯",
  "吡啶",
  "苄基氯",
  "苄基溴（溴甲苯）",
  "丙醇",
  "丙二醇",
  "丙二醇单甲醚乙酸酯",
  "丙酸",
  "丙酮",
  "丙酮醛（甲基乙二醛）",
  "丙烷",
  "丙烯醇",
  "丙烯基芥子油",
  "丙烯腈",
  "丙烯菊酯",
  "丙烯醛",
  "丙烯酸",
  "丙烯酸甲酯",
  "丙烯酸正丁酯",
  "丙烯酰胺",
  "铂化物",
  "铂类抗肿瘤药物",
  "草甘膦",
  "草酸",
  "柴油",
  "抽余油（60 ℃~220 ℃）",
  "臭氧",
  "醋酸",
  "大型真菌",
  "氮氧化物（一氧化氮和二氧化氮）",
  "碲化铋（按 Bi2Te3 计）",
  "碲及其化合物（不含碲化氢）（按 Te 计）",
  "碘",
  "碘仿",
  "碘甲烷",
  "叠氮化钠",
  "叠氮酸蒸气",
  "丁醇",
  "丁醛",
  "丁酮",
  "丁烯",
  "毒死蜱",
  "对氨基酚",
  "对苯二胺",
  "对苯二甲酸",
  "对苯二甲酸二甲酯",
  "对二氯苯（二氯苯）",
  "对硫磷",
  "对特丁基甲苯",
  "对硝基苯胺",
  "对硝基氯苯",
  "对溴苯胺",
  "多次甲基多苯基多异氰酸酯",
  "多次甲基多苯基异氰酸酯",
  "多氯苯",
  "多氯酚",
  "多氯联苯",
  "多氯萘",
  "多溴联苯",
  "多元醇",
  "蒽",
  "蒽醌及其染料",
  "二苯胺",
  "二苯胍",
  "二苯基甲烷二异氰酸酯",
  "二苯亚甲基二异氰酸酯（MDI）",
  "二丙二醇甲醚（2-甲氧基甲乙氧基丙醇）",
  "二丙酮醇",
  "二噁烷",
  "二噁英类化合物",
  "二氟氯甲烷",
  "二甲胺",
  "二甲苯（全部异构体）",
  "二甲苯酚",
  "二甲基二氯硅烷",
  "二甲基甲酰胺",
  "二甲基亚砜",
  "二甲基乙酰胺",
  "二甲氧基甲烷",
  "二聚环戊二烯",
  "二硫化碳",
  "二硫化硒",
  "二氯二苯基三氯乙烷（滴滴涕，DDT）",
  "二氯二氟甲烷",
  "二氯酚",
  "二氯化砜（磺酰氯）",
  "二氯甲烷",
  "二氯乙醚",
  "二氯乙炔",
  "二硼烷（乙硼烷）",
  "二缩水甘油醚",
  "二硝基苯（全部异构体）",
  "二硝基苯酚",
  "二硝基甲苯",
  "二溴氯丙烷",
  "二氧化硫",
  "二氧化氯",
  "二氧化碳",
  "二氧化锡（按 Sn 计）",
  "二乙基甲酮",
  "二乙烯二胺（哌嗪）",
  "二乙烯基苯",
  "二乙烯三胺（二乙撑三胺）",
  "二异丙胺基氯乙烷",
  "二异丁基甲酮",
  "二异氰酸甲苯酯",
  "二月桂酸二丁基锡",
  "钒及其化合物（按 V 计）",
  "酚",
  "酚醛树脂",
  "呋喃",
  "氟化氢（按 F 计）",
  "氟及其化合物（不含氟化氢）（按 F 计）",
  "氟乙酸钠",
  "氟乙酰胺",
  "改性聚氨酯树脂",
  "锆及其化合物（按 Zr 计）",
  "镉及其化合物（按 Cd 计）",
  "铬及其化合物",
  "铬酸盐",
  "汞-金属汞（蒸气）",
  "汞-有机汞化合物（按 Hg 计）",
  "钴及其化合物（按 Co 计）",
  "光气（碳酰氯）",
  "硅烷",
  "癸硼烷",
  "过硫酸盐（过硫酸钾、过硫酸钠、过硫酸铵等）",
  "过氧化苯甲酰",
  "过氧化甲乙酮",
  "过氧化氢",
  "含 7-氨基头孢霉烷酸（7-ACA）的头孢菌素类",
  "含β-内酰胺类抗生素中的含 6-氨基青霉烷酸(6-APA)结构的青霉素类",
  "环己胺",
  "环己醇",
  "环己酮",
  "环己烷",
  "环三次甲基三硝胺（黑索今）",
  "环戊酮",
  "环氧丙烷",
  "环氧氯丙烷",
  "环氧树脂",
  "环氧乙烷",
  "黄磷",
  "己二醇",
  "己内酰胺",
  "甲拌磷",
  "甲苯",
  "甲苯 -2,4- 二异氰酸酯（TDI）",
  "甲醇",
  "甲酚（全部异构体）",
  "甲基氨基酚",
  "甲基丙烯腈",
  "甲基丙烯酸",
  "甲基丙烯酸甲酯（异丁烯酸甲酯）",
  "甲基丙烯酸缩水甘油酯",
  "甲基肼",
  "甲基内吸磷",
  "甲基叔丁基醚",
  "甲硫醇",
  "甲醚醋酸酯",
  "甲醛",
  "甲酸",
  "甲酸丁酯",
  "甲酸甲酯",
  "甲酸乙酯",
  "甲烷",
  "甲氧氯",
  "甲乙酮（2-丁酮）",
  "钾盐镁矾",
  "间苯二酚",
  "剑麻",
  "焦炉逸散物（按苯溶物计）",
  "肼",
  "久效磷",
  "聚氯乙烯热解物",
  "聚乙烯",
  "糠醇",
  "糠醛",
  "考的松",
  "苦味酸（2,4,6-三硝基苯酚）",
  "锂及其化合物",
  "联苯",
  "联苯胺（4,4’-二氨基联苯）",
  "邻-茴香胺，对-茴香胺",
  "邻苯二甲酸二丁酯",
  "邻苯二甲酸二甲酯",
  "邻苯二甲酸酐（PA）",
  "邻二氯苯",
  "邻茴香胺",
  "邻氯苯乙烯",
  "邻氯苄叉丙二腈",
  "邻仲丁基苯酚",
  "磷胺",
  "磷化铝",
  "磷化氢",
  "磷化锌",
  "磷及其无机化合物",
  "磷酸",
  "磷酸二丁基苯酯",
  "磷酸三邻甲苯酯",
  "磷烷",
  "硫化氢",
  "硫柳汞",
  "硫酸",
  "硫酸钡（按 Ba 计）",
  "硫酸二甲酯",
  "硫酸及三氧化硫",
  "硫酰氟",
  "六氟丙酮",
  "六氟丙烯",
  "六氟化硫",
  "六六六（六氯环已烷）",
  "六氯丁二烯",
  "六氯环戊二烯",
  "六氯萘",
  "六氯乙烷",
  "六氢苯酐（HHPA）",
  "卤化水杨酰苯胺（Ν-水杨酰苯胺）",
  "铝酸钠",
  "氯，氯气",
  "氯苯",
  "氯丙酮",
  "氯丙烯",
  "氯化铵烟",
  "氯化苄烷胺（洁尔灭）",
  "氯化汞（升汞）",
  "氯化苦（三氯硝基甲烷）",
  "氯化氢及盐酸",
  "氯化锌烟",
  "氯磺酸",
  "氯甲醚",
  "氯甲酸甲酯",
  "氯甲酸三氯甲酯（双光气）",
  "氯甲烷",
  "氯联苯（54 %氯）",
  "氯萘",
  "氯酸钾",
  "氯酸钠",
  "氯乙醇",
  "氯乙基胺",
  "氯乙醛",
  "氯乙酸",
  "氯乙烷",
  "氯乙烯",
  "氯乙酰氯",
  "马拉硫磷",
  "马来酸酐",
  "吗啉",
  "煤焦油",
  "煤焦油沥青挥发物（按苯溶物计）",
  "锰及其无机化合物（按 MnO2 计）",
  "木馏油（焦油）",
  "钼及其化合物（按 Mo 计）",
  "钼酸",
  "钼酸铵",
  "钼酸钠",
  "萘",
  "萘二异氰酸酯（NDI）",
  "萘酚",
  "萘烷",
  "内吸磷",
  "拟除虫菊酯",
  "尿素",
  "脲醛树脂",
  "镍及其无机化合物(按 Ni 计)",
  "硼烷",
  "铍及其化合物（按 Be 计）",
  "铍及其无机化合物（按 Be 计）",
  "偏二甲基肼",
  "其他化学有害因素",
  "汽油、溶剂汽油",
  "铅及其无机化合物（按 Pb 计，不包括四乙基铅）",
  "羟基香茅醛",
  "羟基乙酸",
  "青霉素(6-氨基青霉烷酸(6-APA))",
  "青霉素(β-内酰胺类抗生素)",
  "氢氟酸",
  "氢化锂",
  "氢醌（对苯二酚）",
  "氢氧化铵",
  "氢氧化钾",
  "氢氧化钠",
  "氢氧化铯",
  "氰氨化钙",
  "氰化氢",
  "氰及其腈类化合物",
  "氰戊菊酯",
  "巯基乙酸",
  "全氟异丁烯",
  "壬基酚聚氧乙烯醚",
  "壬烷",
  "乳酸正丁酯",
  "三氟化氯",
  "三氟化硼",
  "三氟甲基次氟化物",
  "三氟甲基次氟酸酯",
  "三甲苯磷酸酯（全部异构体）",
  "三甲基己二酸",
  "三甲基氯化锡",
  "三聚氰胺甲醛树脂",
  "三氯化磷",
  "三氯化硼",
  "三氯甲烷（氯仿）",
  "三氯硫磷",
  "三氯氢硅",
  "三氯氧磷",
  "三氯一氟甲烷",
  "三氯乙醛",
  "三氯乙酸",
  "三氯乙烯",
  "三烷基锡",
  "三硝基甲苯",
  "三溴甲烷",
  "三氧化铬",
  "三氧化铬、铬酸盐、重铬酸盐（按 Cr 计）",
  "三氧化钼",
  "三乙基氯化锡",
  "三乙烯四胺（三乙撑四胺）",
  "杀虫脒",
  "杀螟松",
  "杀鼠灵（3-（1-丙酮基苄基）-4-羟基香豆素；华法林）",
  "砷化氢（胂）",
  "砷及其化合物（按As 计）",
  "砷及其无机化合物（按 As 计）",
  "十溴联苯醚",
  "石蜡烟",
  "石油精",
  "石油沥青烟(按苯溶物计)",
  "双-(二甲基硫代氨基甲酰基)二硫化物（秋兰姆、福美双）",
  "双（巯基乙酸）二辛基锡",
  "双丙酮醇",
  "双酚 A",
  "双硫醒",
  "双氯甲醚",
  "四氯苯二酸酐（TCPA）",
  "四氯化硅",
  "四氯化钛",
  "四氯化碳",
  "四氯乙烷",
  "四氯乙烯",
  "四氢呋喃",
  "四氢化硅",
  "四氢化锗",
  "四溴化碳",
  "四乙基铅（按 Pb 计）",
  "松节油",
  "酸雾或酸酐",
  "铊及其可溶性化合物（按 Tl 计）",
  "钽及其化合物",
  "钽及其氧化物（按 Ta 计）",
  "碳酸铵",
  "碳酸钙",
  "碳酸钠（纯碱）",
  "羰基氟",
  "羰基镍（按 Ni 计）",
  "锑及其化合物（按 Sb 计）",
  "天然乳胶",
  "铜及其化合物",
  "铜及其化合物（按 Cu 计）",
  "铜烟",
  "烷酸",
  "围涎树碱",
  "钨及其不溶性化合物（按 W 计）",
  "五氟（一）氯乙烷",
  "五氟氯乙烷",
  "五硫化二磷",
  "五氯酚及其钠盐",
  "五羰基铁（按 Fe 计）",
  "五氧化二磷",
  "戊醇",
  "戊烷（全部异构体）",
  "烯丙胺",
  "硒化氢（按 Se 计）",
  "硒及其化合物（按 Se 计）（不包括六氟化硒、硒化氢）",
  "纤维素",
  "硝化甘油",
  "硝基苯",
  "硝基甲苯（全部异构体）",
  "硝基甲烷",
  "硝基萘",
  "硝基萘胺",
  "硝基乙烷",
  "硝酸",
  "辛烷",
  "溴",
  "溴苯",
  "溴丙烷（1-溴丙烷；2-溴丙烷）",
  "溴化氢（氢溴酸）",
  "溴甲烷",
  "溴氰菊酯",
  "溴鼠灵",
  "溴乙烷",
  "亚硫酸钠",
  "亚硝酸乙酯",
  "氧化钙",
  "氧化镁烟",
  "氧化锌",
  "氧化银",
  "氧乐果",
  "液化石油气",
  "一甲胺",
  "一氧化碳",
  "乙胺",
  "乙苯",
  "乙醇",
  "乙醇胺（氨基乙醇）",
  "乙二胺（乙烯二胺，EDA）",
  "乙二醇",
  "乙二醇二硝酸酯",
  "乙酐（乙酸酐）",
  "乙基另戊基甲酮（5-甲基-3-庚酮）",
  "乙基硫代磺酸乙酯",
  "乙基戊基甲酮",
  "乙腈",
  "乙硫醇",
  "乙醚",
  "乙醛",
  "乙炔",
  "乙酸",
  "乙酸苄酯",
  "乙酸丙酯",
  "乙酸丁酯",
  "乙酸甲酯",
  "乙酸戊酯（全部异构体）",
  "乙酸乙烯酯",
  "乙酸乙酯",
  "乙酸异丙酯",
  "乙烯酮",
  "乙酰甲胺磷",
  "乙酰水杨酸（阿司匹林）",
  "钇及其化合物（按 Y 计）",
  "异丙胺",
  "异丙醇",
  "异丙醇胺（1-氨基-2-二丙醇）",
  "异稻瘟净",
  "异佛尔酮二异氰酸酯",
  "异氰酸甲酯",
  "异亚丙基丙酮",
  "铟及其化合物（按 In 计）",
  "茚",
  "铀及其化合物",
  "有机氟聚合物单体及其热裂解物",
  "有机磷",
  "有机锡",
  "莠去津",
  "正丙醇",
  "正丁胺",
  "正丁醇",
  "正丁基硫醇",
  "正丁基缩水甘油醚",
  "正丁醛",
  "正庚烷",
  "正己烷",
  "正香草酸（高香草酸）",
  "重氮甲烷",
  "重铬酸钾",
  "重铬酸盐（按 Cr 计）",
  "N-3,4 二氯苯基丙酰胺（敌稗）",
  "N-3,4-二氯苯基-N`,N`-二甲基脲（敌草隆）",
  "N-甲苯胺，O-甲苯胺",
  "N-乙基吗啉",
  "N-异丙基苯胺",
  "N,N-二甲基-3-氨基苯酚",
  "N,N-二甲基苯胺",
  "O,O-二甲基-（2,2,2-三氯-1 羟基乙基）磷酸酯（敌百虫）",
  "o,o-二甲基-S-（甲基氨基甲酰甲基）二硫代磷酸酯（乐果）",
  "α-氯乙酰苯",
  "β-氯丁二烯（氯丁二烯）",
  "β萘胺",
  "γ-六六六（γ-六氯环己烷）",
  "参与突发事件处置的应急救援作业",
  "金属烟",
  "电工作业",
  "肝炎病防治工作",
  "高处作业",
  "高原.作业",
  "高原作业",
  "刮研作业",
  "航空作业",
  "结核病防治工作",
  "井下不良作业条件",
  "其他特殊作业",
  "视屏作业",
  "突发事件处置应急救援作业",
  "压力容器作业",
  "职业机动车驾驶作业",
  "制造业工人长时间腕部重复作业或用力作业",
  "艾滋病病毒",
  "白僵蚕孢子",
  "伯氏疏螺旋体",
  "布鲁菌属",
  "工业酶",
  "枯草杆菌蛋白酶",
  "米曲霉α-淀粉酶",
  "木瓜蛋白酶",
  "其他生物有害因素",
  "人免疫缺陷病毒",
  "森林脑炎病毒",
  "实验动物",
  "炭疽杆菌",
  "炭疽芽孢杆菌",
  "超高频电磁场（超高频辐射）",
  "低气压",
  "低温",
  "电焊弧光",
  "高频电磁场（高频辐射）",
  "高气压",
  "高温",
  "高原低氧",
  "工频电磁场（工频辐射）",
  "红外线",
  "激光",
  "其他物理有害因素",
  "手传振动",
  "微波",
  "噪声",
  "振动",
  "紫外辐射(紫外线)",
];

  const CONFIG = {
    nonHazardPatterns: [
      /^(岗前|岗中|岗后)$/,
      /^(上岗前|在岗|在岗期间|离岗|离岗时|离岗后)$/,
      /^(应急|应急检查|复查|随访|职业健康检查)$/,
      /^(男|女|男未婚|男已婚|女未婚|女已婚|未婚|已婚)$/
    ],

    // 只保留经过人工确认的明确别名。手动维护对应关系
    // 浏览器中新增的匹配规则会保存在 localStorage，并覆盖同名内置规则。
    builtinAliases: {
      "阿司匹林": "乙酰水杨酸（阿司匹林）",
      "铝尘": "铝尘（铝金属、铝合金粉尘氧化铝粉尘）",
      "抽余油": "抽余油（60 ℃~220 ℃）",
      "ddt": "二氯二苯基三氯乙烷（滴滴涕，DDT）",
      "滴滴涕": "二氯二苯基三氯乙烷（滴滴涕，DDT）",
      "大理石粉尘": "大理石粉尘 （碳酸钙）",
      "氮氧化物": "氮氧化物（一氧化氮和二氧化氮）",
      "二甲苯": "二甲苯（全部异构体）",
      "二氧化锡": "二氧化锡（按 Sn 计）",
      "二乙烯三胺": "二乙烯三胺（二乙撑三胺）",
      "二乙撑三胺": "二乙烯三胺（二乙撑三胺）",
      "酚醛树脂粉尘": "酚醛树酯粉尘",
      "氟化氢": "氟化氢（按 F 计）",
      "氟及其化合物": "氟及其化合物（不含氟化氢）（按 F 计）",
      "高频电磁场": "高频电磁场（高频辐射）",
      "高频辐射": "高频电磁场（高频辐射）",
      "工频电场": "工频电磁场（工频辐射）",
      "工频电磁场": "工频电磁场（工频辐射）",
      "工频辐射": "工频电磁场（工频辐射）",
      "谷物粉尘": "谷物粉尘（游离 SiO2 含量＜10%）",
      "过硫酸钾": "过硫酸盐（过硫酸钾、过硫酸钠、过硫酸铵等）",
      "黑索今": "环三次甲基三硝胺（黑索今）",
      "hdi": "1,6-己二异氰酸酯（六亚甲基二异氰酸酯（HDI））",
      "汞-金属汞": "汞-金属汞（蒸气）",
      "汞金属汞": "汞-金属汞（蒸气）",
      "镉及其化合物": "镉及其化合物（按 Cd 计）",
      "镉及其无机化合物": "镉及其化合物（按 Cd 计）",
      "煤尘": "煤尘（游离 SiO2 含量＜10%）",
      "煤焦油沥青挥发物": "煤焦油沥青挥发物（按苯溶物计）",
      "mdi": "二苯亚甲基二异氰酸酯（MDI）",
      "木粉尘": "木粉尘（硬）",
      "镍及其无机化合物": "镍及其无机化合物(按 Ni 计)",
      "ndi": "萘二异氰酸酯（NDI）",
      "其它粉尘": "其他粉尘",
      "铅及其无机化合物": "铅及其无机化合物（按 Pb 计，不包括四乙基铅）",
      "铅尘": "铅及其无机化合物（按 Pb 计，不包括四乙基铅）",
      "pa": "邻苯二甲酸酐（PA）",
      "汽油、溶剂汽油": "汽油、溶剂汽油",
      "溶剂汽油": "汽油、溶剂汽油",
      "石油沥青烟": "石油沥青烟(按苯溶物计)",
      "水泥粉尘": "水泥粉尘（游离SiO2含量<10%）",
      "酸酐或酸雾": "酸雾或酸酐",
      "盐酸": "氯化氢及盐酸",
      "紫外辐射": "紫外辐射(紫外线)",
      "紫外线": "紫外辐射(紫外线)",
      "tcpa": "四氯苯二酸酐（TCPA）",
      "tdi": "甲苯 -2,4- 二异氰酸酯（TDI）",
      "tma": "1,2,4-苯三酸酐（TMA）",
      "氯仿": "三氯甲烷（氯仿）",
      "氯化汞": "氯化汞（升汞）",
      "氯化氢": "氯化氢及盐酸",
      "氯气": "氯，氯气",
      "六氯环己烷": "六六六（六氯环已烷）",
      "钼及其化合物": "钼及其化合物（按 Mo 计）",
      "锰及其无机化合物": "锰及其无机化合物（按 MnO2 计）",
      "乙酐": "乙酐（乙酸酐）",
    },

    // 默认排除项：仍会在“无关内容”模块中保留记录，便于复核。
    builtinIgnoreTerms: [
      "赠送包",
      "加项包"
    ],

    /*
     * 无关关键词只在套餐已经拆分成单项后判断。
     *
     * 例如：
     *   “福利”可覆盖“年度福利、福利2、员工福利”；
     *   “核磁”可覆盖“头部核磁、腰部核磁、核磁平扫”；
     *   “健康证”可覆盖“健康证、健康证体检”。
     *
     * 不在整段危害文字上做包含判断，避免一个“健康证”
     * 把同一套餐内的全部危害一并排除。
     */
    builtinIgnoreKeywords: [
      "套餐",
      "头部",
      "平扫",
      "以上",
      "以下",
      "健康证",
      "福利",
      "核磁",
      "血管",
      "平扫",
      "CT"
    ]
  };

  const SUBSCRIPT_MAP = {
    "₀":"0","₁":"1","₂":"2","₃":"3","₄":"4",
    "₅":"5","₆":"6","₇":"7","₈":"8","₉":"9"
  };

  const cleanText = value => String(value ?? "")
    .replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();

  function normalizeBase(value) {
    let text = cleanText(value);
    try { text = text.normalize("NFKC"); } catch (_) {}

    text = text
      .replace(/[₀-₉]/g, char => SUBSCRIPT_MAP[char] || char)
      .replace(/[（【〔［｛]/g, "(")
      .replace(/[）】〕］｝]/g, ")")
      .replace(/[＋]/g, "+")
      .replace(/[－—–−‐‑‒]/g, "-")
      .replace(/[，、]/g, ",")
      .replace(/[；]/g, ";")
      .replace(/[：]/g, ":")
      .replace(/[＜]/g, "<")
      .replace(/[＞]/g, ">")
      .replace(/[％]/g, "%")
      .replace(/[～]/g, "~")
      .replace(/[‘’′＇`´]/g, "'")
      .replace(/[“”＂]/g, '"')
      .replace(/ºc|°c/gi, "℃")
      .replace(/[\s\u3000]+/g, "")
      .toLowerCase();

    // 只修正高度确定的录入差异，不做泛化错别字替换。
    return text
      .replace(/树酯/g, "树脂")
      .replace(/环已烷/g, "环己烷")
      .replace(/ν(?=\-|水杨酰)/g, "n");
  }

  function strictKey(value) {
    return normalizeBase(value);
  }

  const STANDARD_SET = new Set(STANDARD_NAMES);
  const STANDARD_KEY_INDEX = new Map();

  function buildStandardIndex() {
    for (const canonical of STANDARD_NAMES) {
      const key = strictKey(canonical);
      if (!key) continue;

      if (!STANDARD_KEY_INDEX.has(key)) {
        STANDARD_KEY_INDEX.set(key, new Set());
      }

      STANDARD_KEY_INDEX.get(key).add(canonical);
    }
  }
  buildStandardIndex();

  function readStoredObject(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_) {
      return {};
    }
  }

  function readStoredArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  let userAliasMap = readStoredObject(USER_ALIAS_STORAGE_KEY);
  let userIgnoreTerms = readStoredArray(USER_IGNORE_STORAGE_KEY);
  let userIgnoreKeywords =
    readStoredArray(USER_IGNORE_KEYWORD_STORAGE_KEY);

  let aliasIndex = new Map();
  let builtinIgnoreIndex = new Set();
  let userIgnoreIndex = new Set();
  let ignoreKeywordEntries = [];

  function rebuildRuleIndexes() {
    aliasIndex = new Map();

    const merged = {
      ...CONFIG.builtinAliases,
      ...userAliasMap
    };

    for (const [alias, canonical] of Object.entries(merged)) {
      if (!STANDARD_SET.has(canonical)) continue;
      const key = strictKey(alias);
      if (key) aliasIndex.set(key, canonical);
    }

    builtinIgnoreIndex = new Set(
      CONFIG.builtinIgnoreTerms
        .map(strictKey)
        .filter(Boolean)
    );

    userIgnoreIndex = new Set(
      userIgnoreTerms
        .map(strictKey)
        .filter(Boolean)
    );

    const keywordMap = new Map();

    for (const rawKeyword of CONFIG.builtinIgnoreKeywords) {
      const keyword = cleanText(rawKeyword);
      const key = strictKey(keyword);
      if (!key) continue;

      keywordMap.set(key, {
        keyword,
        key,
        source: "builtin"
      });
    }

    for (const rawKeyword of userIgnoreKeywords) {
      const keyword = cleanText(rawKeyword);
      const key = strictKey(keyword);
      if (!key) continue;

      if (!keywordMap.has(key)) {
        keywordMap.set(key, {
          keyword,
          key,
          source: "user"
        });
      }
    }

    // 更长、更具体的关键词优先。
    ignoreKeywordEntries = [...keywordMap.values()]
      .sort((a, b) =>
        b.key.length - a.key.length ||
        a.keyword.localeCompare(b.keyword, "zh-CN")
      );
  }
  rebuildRuleIndexes();

  function persistUserRules() {
    localStorage.setItem(
      USER_ALIAS_STORAGE_KEY,
      JSON.stringify(userAliasMap)
    );

    localStorage.setItem(
      USER_IGNORE_STORAGE_KEY,
      JSON.stringify(userIgnoreTerms)
    );

    localStorage.setItem(
      USER_IGNORE_KEYWORD_STORAGE_KEY,
      JSON.stringify(userIgnoreKeywords)
    );

    rebuildRuleIndexes();
  }

  function getUniqueStandardByKey(key) {
    const values = [...(STANDARD_KEY_INDEX.get(key) || [])];
    return values.length === 1 ? values[0] : "";
  }

  function resolveCanonical(value) {
    const raw = cleanText(value);
    if (!raw) return null;

    const key = strictKey(raw);
    if (!key) return null;

    const exact = getUniqueStandardByKey(key);
    if (exact) {
      return {
        canonical: exact,
        matchType: "standard"
      };
    }

    const aliasCanonical = aliasIndex.get(key);
    if (aliasCanonical) {
      return {
        canonical: aliasCanonical,
        matchType:
          Object.prototype.hasOwnProperty.call(userAliasMap, raw) ||
          Object.keys(userAliasMap).some(alias => strictKey(alias) === key)
            ? "user-alias"
            : "builtin-alias"
      };
    }

    return null;
  }

  function getAutofillHazardName(value) {
    const raw = cleanText(value);
    if (!raw) return "";

    const resolved =
      resolveCanonical(raw);

    return cleanText(
      resolved?.canonical ||
      raw
    );
  }

  function matchHazards(left, right) {
    const leftResolved = resolveCanonical(left);
    const rightResolved = resolveCanonical(right);

    if (
      leftResolved &&
      rightResolved &&
      leftResolved.canonical === rightResolved.canonical
    ) {
      return {
        matched: true,
        type:
          leftResolved.matchType === "standard" &&
          rightResolved.matchType === "standard"
            ? "standard"
            : "alias"
      };
    }

    return { matched: false, type: "none" };
  }

  function similarityText(value) {
    return normalizeBase(value)
      .replace(/[()"';:,，。、“”‘’+－—–−‐‑‒]/g, "")
      // 只用于候选推荐，不改变正式匹配结果。
      .replace(/其它/g, "其他")
      .replace(/噪音/g, "噪声");
  }

  function makeBigrams(value) {
    const text = similarityText(value);
    if (text.length < 2) return text ? [text] : [];

    const list = [];
    for (let index = 0; index < text.length - 1; index++) {
      list.push(text.slice(index, index + 2));
    }
    return list;
  }

  function diceCoefficient(left, right) {
    const a = makeBigrams(left);
    const b = makeBigrams(right);

    if (!a.length || !b.length) {
      return similarityText(left) === similarityText(right) ? 1 : 0;
    }

    const counts = new Map();
    for (const item of a) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }

    let intersections = 0;
    for (const item of b) {
      const count = counts.get(item) || 0;
      if (count > 0) {
        intersections++;
        counts.set(item, count - 1);
      }
    }

    return 2 * intersections / (a.length + b.length);
  }

  function commonPrefixRatio(left, right) {
    const a = similarityText(left);
    const b = similarityText(right);
    const limit = Math.min(a.length, b.length);
    let same = 0;

    while (same < limit && a[same] === b[same]) same++;
    return limit ? same / limit : 0;
  }

  function levenshteinDistance(left, right) {
    const a = similarityText(left);
    const b = similarityText(right);

    if (!a) return b.length;
    if (!b) return a.length;

    const previous = Array.from(
      { length: b.length + 1 },
      (_, index) => index
    );

    for (let row = 1; row <= a.length; row++) {
      const current = [row];

      for (let column = 1; column <= b.length; column++) {
        const substitutionCost =
          a[row - 1] === b[column - 1] ? 0 : 1;

        current[column] = Math.min(
          current[column - 1] + 1,
          previous[column] + 1,
          previous[column - 1] + substitutionCost
        );
      }

      for (let index = 0; index < current.length; index++) {
        previous[index] = current[index];
      }
    }

    return previous[b.length];
  }

  function calculateSimilarity(left, right) {
    const a = similarityText(left);
    const b = similarityText(right);

    if (!a || !b) return 0;
    if (a === b) return 100;

    const maximumLength = Math.max(a.length, b.length);
    const editSimilarity = maximumLength
      ? 1 - levenshteinDistance(a, b) / maximumLength
      : 0;

    const dice = diceCoefficient(a, b);
    const prefix = commonPrefixRatio(a, b);
    const containment =
      a.includes(b) || b.includes(a)
        ? Math.min(a.length, b.length) / maximumLength
        : 0;

    const score =
      editSimilarity * 58 +
      dice * 24 +
      prefix * 10 +
      containment * 8;

    return Math.max(0, Math.min(99, Math.round(score)));
  }

  function getBestSimilarityCandidate(raw) {
    return getSimilaritySuggestions(raw, "", 1)[0] || null;
  }

  function getSimilaritySuggestions(raw, query = "", limit = 12) {
    const queryKey = similarityText(query);

    return STANDARD_NAMES
      .filter(name => {
        if (!queryKey) return true;
        return similarityText(name).includes(queryKey);
      })
      .map(name => ({
        name,
        score: calculateSimilarity(raw, name)
      }))
      .sort((a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name, "zh-CN")
      )
      .slice(0, limit);
  }

  function resolveIgnoreRule(value) {
    const raw = cleanText(value);
    const key = strictKey(raw);

    if (!key) return null;

    // 标准危害和已经确认的别名优先级最高。
    if (resolveCanonical(raw)) return null;

    if (userIgnoreIndex.has(key)) {
      return {
        matched: true,
        type: "exact",
        source: "user",
        rule: raw
      };
    }

    if (builtinIgnoreIndex.has(key)) {
      return {
        matched: true,
        type: "exact",
        source: "builtin",
        rule: raw
      };
    }

    const keywordEntry =
      ignoreKeywordEntries.find(item =>
        key.includes(item.key)
      );

    if (keywordEntry) {
      return {
        matched: true,
        type: "keyword",
        source: keywordEntry.source,
        rule: keywordEntry.keyword
      };
    }

    return null;
  }

  function isExactIgnoredToken(value) {
    const key = strictKey(value);
    if (!key) return false;

    if (resolveCanonical(value)) return false;

    return (
      userIgnoreIndex.has(key) ||
      builtinIgnoreIndex.has(key)
    );
  }

  function isIgnoredToken(value) {
    return Boolean(
      resolveIgnoreRule(value)
    );
  }

  function uniqueHazards(items) {
    const map = new Map();

    for (const item of items) {
      const raw = cleanText(item);
      if (!raw) continue;

      const resolved = resolveCanonical(raw);
      const key = resolved
        ? `canonical:${resolved.canonical}`
        : `raw:${strictKey(raw)}`;

      if (!map.has(key)) {
        map.set(key, {
          raw,
          canonical: resolved?.canonical || raw,
          standardResolved: Boolean(resolved),
          resolutionType: resolved?.matchType || "unresolved"
        });
      }
    }

    return [...map.values()];
  }

  function isNonHazardToken(value) {
    const normalized = strictKey(value);
    return CONFIG.nonHazardPatterns.some(pattern => pattern.test(normalized));
  }

  /*
   * 危害名称分隔符智能识别
   *
   * 核心场景是不同录入人员使用不同的单个分隔符：
   *
   *   噪声+苯+甲苯
   *   噪声、苯、甲苯
   *   噪声X苯X甲苯
   *   噪声；苯；甲苯
   *
   * 判断原则：
   *
   * 1. + / ＋ 始终是明确分隔符。
   * 2. 其他符号在危害段外层重复出现时，
   *    识别为该套餐所使用的分隔符。
   * 3. 只出现一次时，只有左右两侧都能明确识别，
   *    才允许作为分隔符。
   * 4. 括号内部符号不参与检测。
   * 5. 标准危害名称整体优先，避免拆坏：
   *      汽油、溶剂汽油
   *      氯，氯气
   *      1,2,3-三氯丙烷
   *      X射线
   * 6. 横杠不作为危害分隔符，避免破坏化学名称。
   */

  const HAZARD_SEPARATOR_KIND_MAP = new Map([
    ["+", "+"],
    ["＋", "+"],

    ["、", "、"],

    [",", ","],
    ["，", ","],

    [";", ";"],
    ["；", ";"],

    ["|", "|"],
    ["｜", "|"],

    ["/", "/"],
    ["／", "/"],

    ["\\", "\\"],

    ["&", "&"],
    ["＆", "&"],

    ["#", "#"],
    ["＃", "#"],

    ["*", "*"],
    ["＊", "*"],

    ["X", "x"],
    ["x", "x"],
    ["×", "x"],
    ["✕", "x"],
    ["✖", "x"],

    ["·", "·"],
    ["•", "·"],

    ["。", "。"]
  ]);

  const HAZARD_OPEN_BRACKETS = new Set([
    "(", "（",
    "[", "【", "〔", "［",
    "{", "｛"
  ]);

  const HAZARD_CLOSE_BRACKETS = new Set([
    ")", "）",
    "]", "】", "〕", "］",
    "}", "｝"
  ]);

  // 仅清理明显的标点型首尾分隔符。
  // 不包含 X / x，避免把“X射线”的 X 删除。
  const HAZARD_EDGE_SEPARATOR_RE =
    /^[+＋、,，;；|｜/／\\&＆#＃*＊×✕✖·•。]+|[+＋、,，;；|｜/／\\&＆#＃*＊×✕✖·•。]+$/g;

  function scanOuterHazardSeparators(value) {
    const text = String(value ?? "");
    const groups = [];
    let bracketDepth = 0;

    for (
      let index = 0;
      index < text.length;
    ) {
      const char = text[index];

      if (
        HAZARD_OPEN_BRACKETS.has(char)
      ) {
        bracketDepth++;
        index++;
        continue;
      }

      if (
        HAZARD_CLOSE_BRACKETS.has(char)
      ) {
        bracketDepth = Math.max(
          0,
          bracketDepth - 1
        );
        index++;
        continue;
      }

      const kind =
        bracketDepth === 0
          ? HAZARD_SEPARATOR_KIND_MAP.get(
            char
          )
          : "";

      if (!kind) {
        index++;
        continue;
      }

      const start = index;
      let end = index + 1;

      // 连续出现的同类字符归为同一个位置，
      // 但正常场景只需一个符号。
      while (
        end < text.length &&
        HAZARD_SEPARATOR_KIND_MAP.get(
          text[end]
        ) === kind
      ) {
        end++;
      }

      groups.push({
        start,
        end,
        kind,
        raw: text.slice(start, end),
        length: end - start
      });

      index = end;
    }

    return groups;
  }

  function splitTextAtSeparatorGroups(
    text,
    groups
  ) {
    if (!groups.length) {
      return [
        cleanText(text)
      ].filter(Boolean);
    }

    const tokens = [];
    let cursor = 0;

    for (const group of groups) {
      tokens.push(
        cleanText(
          text.slice(
            cursor,
            group.start
          )
        )
      );

      cursor = group.end;
    }

    tokens.push(
      cleanText(
        text.slice(cursor)
      )
    );

    return tokens.filter(Boolean);
  }

  function isSafeHazardPartitionToken(
    value
  ) {
    const token = cleanText(value);
    if (!token) return false;

    if (
      resolveCanonical(token) ||
      isNonHazardToken(token) ||
      isExactIgnoredToken(token)
    ) {
      return true;
    }

    /*
     * 关键词无关规则只能用于一个已经独立拆出的单项。
     * 如果文字中仍含可识别分隔符，不能因为其中包含“福利、
     * 健康证、核磁”等关键词就把整段当作无关内容。
     */
    const stillHasOuterSeparators =
      scanOuterHazardSeparators(token)
        .some(group =>
          group.start > 0 &&
          group.end < token.length
        );

    return (
      !stillHasOuterSeparators &&
      isIgnoredToken(token)
    );
  }

  function compareHazardPartition(
    left,
    right
  ) {
    if (!right) return 1;

    // 优先得到更多明确可识别的危害。
    if (
      left.recognizedCount !==
      right.recognizedCount
    ) {
      return (
        left.recognizedCount >
        right.recognizedCount
          ? 1
          : -1
      );
    }

    // 其次减少跨越分隔符的未解析大段。
    if (
      left.unresolvedCost !==
      right.unresolvedCost
    ) {
      return (
        left.unresolvedCost <
        right.unresolvedCost
          ? 1
          : -1
      );
    }

    // 评分仍相同时，优先把重复分隔符真正拆开，
    // 使未知名称分别进入“名称处理”。
    if (
      left.splitCount !==
      right.splitCount
    ) {
      return (
        left.splitCount >
        right.splitCount
          ? 1
          : -1
      );
    }

    return 0;
  }

  function chooseBestHazardPartition(
    text,
    groups
  ) {
    if (!groups.length) {
      return [
        cleanText(text)
      ].filter(Boolean);
    }

    const atoms = [];
    const separators = [];
    let cursor = 0;

    for (const group of groups) {
      atoms.push(
        cleanText(
          text.slice(
            cursor,
            group.start
          )
        )
      );

      separators.push(
        text.slice(
          group.start,
          group.end
        )
      );

      cursor = group.end;
    }

    atoms.push(
      cleanText(
        text.slice(cursor)
      )
    );

    if (atoms.some(atom => !atom)) {
      return splitTextAtSeparatorGroups(
        text,
        groups
      );
    }

    const atomCount = atoms.length;
    const best = Array(
      atomCount + 1
    ).fill(null);

    best[atomCount] = {
      tokens: [],
      recognizedCount: 0,
      unresolvedCost: 0,
      splitCount: 0
    };

    for (
      let startIndex =
        atomCount - 1;
      startIndex >= 0;
      startIndex--
    ) {
      let joined = "";

      for (
        let endIndex = startIndex;
        endIndex < atomCount;
        endIndex++
      ) {
        if (
          endIndex === startIndex
        ) {
          joined = atoms[endIndex];
        } else {
          joined +=
            separators[
              endIndex - 1
            ] +
            atoms[endIndex];
        }

        const token =
          cleanText(joined);

        if (!token) continue;

        const tail =
          best[endIndex + 1];

        if (!tail) continue;

        const recognized =
          isSafeHazardPartitionToken(
            token
          );

        const crossedSeparators =
          endIndex - startIndex;

        const candidate = {
          tokens: [
            token,
            ...tail.tokens
          ],

          recognizedCount:
            tail.recognizedCount +
            (recognized ? 1 : 0),

          unresolvedCost:
            tail.unresolvedCost +
            (
              recognized
                ? 0
                : 1 +
                  crossedSeparators
            ),

          splitCount:
            tail.splitCount +
            (
              endIndex <
              atomCount - 1
                ? 1
                : 0
            )
        };

        if (
          compareHazardPartition(
            candidate,
            best[startIndex]
          ) > 0
        ) {
          best[startIndex] =
            candidate;
        }
      }
    }

    return (
      best[0]?.tokens ||
      splitTextAtSeparatorGroups(
        text,
        groups
      )
    )
      .map(cleanText)
      .filter(Boolean);
  }

  function canUseSingleHazardSeparator(
    text,
    group
  ) {
    const left = cleanText(
      text.slice(0, group.start)
    );

    const right = cleanText(
      text.slice(group.end)
    );

    return Boolean(
      left &&
      right &&
      isSafeHazardPartitionToken(
        left
      ) &&
      isSafeHazardPartitionToken(
        right
      )
    );
  }

  function splitHazardSegment(segment) {
    const text = cleanText(segment)
      .replace(
        HAZARD_EDGE_SEPARATOR_RE,
        ""
      )
      .trim();

    if (!text) return [];

    // 整段已经是标准危害或明确规则内容时，
    // 不再检测其中的符号。
    if (
      isSafeHazardPartitionToken(
        text
      )
    ) {
      return [text];
    }

    const allGroups =
      scanOuterHazardSeparators(
        text
      )
        // 首尾的 X 不视为分隔符：
        // 例如 X射线。
        .filter(group =>
          group.start > 0 &&
          group.end < text.length
        );

    if (!allGroups.length) {
      return [text];
    }

    const occurrenceCount =
      new Map();

    for (const group of allGroups) {
      occurrenceCount.set(
        group.kind,
        (
          occurrenceCount.get(
            group.kind
          ) || 0
        ) + 1
      );
    }

    const eligibleGroups =
      allGroups.filter(group => {
        // + / ＋ 始终是明确分隔符。
        if (group.kind === "+") {
          return true;
        }

        const count =
          occurrenceCount.get(
            group.kind
          ) || 0;

        // 重点场景：
        // 同一个单符号在套餐中多次出现。
        if (count >= 2) {
          return true;
        }

        // 只有两个危害时，分隔符只出现一次。
        // 此时要求左右都能明确识别。
        return (
          count === 1 &&
          canUseSingleHazardSeparator(
            text,
            group
          )
        );
      });

    if (!eligibleGroups.length) {
      return [text];
    }

    return chooseBestHazardPartition(
      text,
      eligibleGroups
    );
  }

  const FIRST_DASH_RE = /[-－—–−‐‑‒]/;

  const GENDER_SUFFIX_RE =
    /(?:[-－—–−‐‑‒]|[+＋、,，;；|｜/／\\&＆#＃*＊Xx×✕✖·•。]+)\s*(女未婚|女已婚|男未婚|男已婚|男|女|未婚|已婚)\s*$/;

  const STAGE_SUFFIX_RE =
    /(?:[+＋]|[-－—–−‐‑‒]|[、,，;；|｜/／\\&＆#＃*＊Xx×✕✖·•。]+)\s*(在岗期间|上岗前|离岗时|离岗后|岗前|岗中|岗后|在岗|离岗|应急检查|应急|复查|随访|职业健康检查)\s*$/;

  const DIALOG_STAGE_SOURCE_ENTRIES = [
    ["在岗期间", "在岗期间"],
    ["离岗后医学随访", "离岗后医学随访"],
    ["应急检查", "应急检查"],
    ["上岗前", "上岗前"],
    ["离岗时", "离岗时"],
    ["离岗后", "离岗后医学随访"],
    ["岗前", "上岗前"],
    ["岗中", "在岗期间"],
    ["岗后", "离岗时"],
    ["在岗", "在岗期间"],
    ["离岗", "离岗时"],
    ["应急", "应急检查"]
  ];

  const DIALOG_STAGE_MAP = new Map(
    DIALOG_STAGE_SOURCE_ENTRIES
      .map(([source, target]) => [
        strictKey(source),
        target
      ])
  );

  function detectPackageStageInfo(packageName) {
    const packageKey =
      strictKey(packageName);

    if (!packageKey) {
      return {
        found: false,
        raw: "",
        canonical: "",
        conflicts: []
      };
    }

    const matches = [];

    for (
      const [source, canonical]
      of DIALOG_STAGE_SOURCE_ENTRIES
    ) {
      const sourceKey =
        strictKey(source);

      if (
        sourceKey &&
        packageKey.includes(sourceKey)
      ) {
        matches.push({
          raw: source,
          canonical
        });
      }
    }

    const uniqueCanonical = new Map();

    for (const match of matches) {
      if (!uniqueCanonical.has(match.canonical)) {
        uniqueCanonical.set(
          match.canonical,
          match
        );
      }
    }

    const uniqueMatches =
      [...uniqueCanonical.values()];

    if (!uniqueMatches.length) {
      return {
        found: false,
        raw: "",
        canonical: "",
        conflicts: []
      };
    }

    if (uniqueMatches.length > 1) {
      return {
        found: true,
        raw: "",
        canonical: "",
        conflicts: uniqueMatches
      };
    }

    return {
      found: true,
      raw: uniqueMatches[0].raw,
      canonical:
        uniqueMatches[0].canonical,
      conflicts: []
    };
  }

  function resolveDialogStageName(stage) {
    return DIALOG_STAGE_MAP.get(strictKey(stage)) || "";
  }

  function stripTrailingPackageMeta(packageName) {
    let body = cleanText(packageName);
    let gender = "";
    let stage = "";

    const genderMatch = body.match(GENDER_SUFFIX_RE);
    if (genderMatch && Number.isInteger(genderMatch.index)) {
      gender = cleanText(genderMatch[1]);
      body = cleanText(body.slice(0, genderMatch.index));
    }

    const stageMatch = body.match(STAGE_SUFFIX_RE);
    if (stageMatch && Number.isInteger(stageMatch.index)) {
      stage = cleanText(stageMatch[1]);
      body = cleanText(body.slice(0, stageMatch.index));
    }

    return { body, gender, stage };
  }

  function extractPackageHazards(packageName) {
    const text = cleanText(packageName);

    if (!text) {
      return {
        hazards: [],
        recognizedHazards: [],
        unresolvedHazards: [],
        irrelevantHazards: [],
        rawMiddle: "",
        skipped: false,
        error: "套餐名称为空"
      };
    }

    const stageInfo =
      detectPackageStageInfo(text);

    /*
     * 只核对名称中含明确在岗状态的套餐。
     * 未包含上岗前、在岗期间、离岗时、离岗后医学随访、
     * 应急检查等状态信息时，整条套餐静默跳过。
     */
    if (!stageInfo.found) {
      return {
        hazards: [],
        recognizedHazards: [],
        unresolvedHazards: [],
        irrelevantHazards: [],
        rawMiddle: "",
        stage: "",
        gender: "",
        skipped: true,
        skipReason:
          "套餐名称未包含在岗信息",
        error: ""
      };
    }

    if (stageInfo.conflicts.length) {
      return {
        hazards: [],
        recognizedHazards: [],
        unresolvedHazards: [],
        irrelevantHazards: [],
        rawMiddle: "",
        stage: "",
        gender: "",
        skipped: false,
        error:
          "套餐名称中包含多个不同的在岗状态：" +
          stageInfo.conflicts
            .map(item => item.canonical)
            .join("、")
      };
    }

    const meta =
      stripTrailingPackageMeta(text);

    const firstDashIndex =
      meta.body.search(FIRST_DASH_RE);

    if (firstDashIndex < 0) {
      return {
        hazards: [],
        recognizedHazards: [],
        unresolvedHazards: [],
        irrelevantHazards: [],
        rawMiddle: "",
        stage: stageInfo.canonical,
        gender: meta.gender,
        skipped: false,
        error:
          "套餐名称中没有找到第一个“-”，无法确定危害段"
      };
    }

    const segment = cleanText(
      meta.body.slice(
        firstDashIndex + 1
      )
    );

    const tokens =
      splitHazardSegment(segment);

    if (!tokens.length) {
      return {
        hazards: [],
        recognizedHazards: [],
        unresolvedHazards: [],
        irrelevantHazards: [],
        rawMiddle: segment,
        stage: stageInfo.canonical,
        gender: meta.gender,
        skipped: false,
        error:
          "第一个“-”之后没有读取到可用的危害内容"
      };
    }

    const potentialHazards = [];
    const irrelevantHazards = [];

    for (const token of tokens) {
      const stageName =
        resolveDialogStageName(token);

      const ignoreRule =
        resolveIgnoreRule(token);

      const metadataExcluded =
        Boolean(
          stageName ||
          isNonHazardToken(token)
        );

      if (
        metadataExcluded ||
        ignoreRule
      ) {
        let reason =
          "检查阶段、性别或婚姻状态";

        if (ignoreRule?.type === "keyword") {
          reason =
            `命中无关关键词“${ignoreRule.rule}”`;
        } else if (ignoreRule) {
          reason =
            "已列入无关内容";
        }

        irrelevantHazards.push({
          raw: token,
          reason,
          ignoreType:
            ignoreRule?.type || "metadata",
          ignoreRule:
            ignoreRule?.rule || ""
        });

        continue;
      }

      potentialHazards.push(token);
    }

    const hazards =
      uniqueHazards(potentialHazards);

    const recognizedHazards =
      hazards.filter(
        item => item.standardResolved
      );

    const unresolvedHazards =
      hazards.filter(
        item => !item.standardResolved
      );

    return {
      hazards,
      recognizedHazards,
      unresolvedHazards,
      irrelevantHazards,
      rawMiddle: segment,
      stage: stageInfo.canonical,
      gender: meta.gender,
      skipped: false,
      error: ""
    };
  }

  function extractCellHazards(cell) {
    if (!cell) return [];

    const tagTexts = [...cell.querySelectorAll("span.el-tag")]
      .map(element => cleanText(element.innerText || element.textContent))
      .filter(Boolean);
    if (tagTexts.length) return uniqueHazards(tagTexts);

    const separateTexts = [...cell.querySelectorAll(".cell > span, .cell > div > span")]
      .map(element => cleanText(element.innerText || element.textContent))
      .filter(Boolean);
    if (separateTexts.length > 1) return uniqueHazards(separateTexts);

    const raw = cleanText(cell.innerText || cell.textContent);
    return uniqueHazards(raw
      .split(/[\r\n、，,；;|｜\u2028\u2029\u001E\u001F]+/)
      .map(cleanText)
      .filter(Boolean));
  }

  function compareHazardLists(packageHazards, cellHazards) {
    const packageMap = new Map(
      packageHazards
        .filter(item => item.standardResolved)
        .map(item => [item.canonical, item])
    );

    const cellMap = new Map(
      cellHazards
        .filter(item => item.standardResolved)
        .map(item => [item.canonical, item])
    );

    const packageOnly = [...packageMap.entries()]
      .filter(([canonical]) => !cellMap.has(canonical))
      .map(([, item]) => item);

    const cellOnly = [...cellMap.entries()]
      .filter(([canonical]) => !packageMap.has(canonical))
      .map(([, item]) => item);

    return {
      packageOnly,
      cellOnly,
      comparedPackageCount: packageMap.size,
      comparedCellCount: cellMap.size,
      isMatched: packageOnly.length === 0 && cellOnly.length === 0
    };
  }

  function getDirectChildByClass(parent, className) {
    return [...(parent?.children || [])]
      .find(child => child.classList?.contains(className)) || null;
  }

  function getHeaderInfo(tableRoot) {
    const headerWrapper = getDirectChildByClass(tableRoot, "el-table__header-wrapper");
    if (!headerWrapper) return null;

    const headerCells = [...headerWrapper.querySelectorAll("thead tr th")];
    const headers = headerCells.map(cell => strictKey(
      cell.querySelector(".cell")?.innerText || cell.innerText || cell.textContent
    ));
    const findIndex = name => headers.findIndex(header => header === strictKey(name));

    const packageIndex = findIndex("套餐名称");
    const hazardIndex = findIndex("危害因素");
    if (packageIndex < 0 || hazardIndex < 0) return null;

    return {
      packageIndex,
      hazardIndex,
      codeIndex: findIndex("套餐编码"),
      sequenceIndex: findIndex("序号"),
      stageIndex: findIndex("在岗状态")
    };
  }

  function findPackageTables() {
    return [...document.querySelectorAll(".el-table")]
      .map(tableRoot => ({ tableRoot, headerInfo: getHeaderInfo(tableRoot) }))
      .filter(item => item.headerInfo)
      .map(item => {
        const bodyWrapper = getDirectChildByClass(item.tableRoot, "el-table__body-wrapper");
        const bodyTable = bodyWrapper
          ? getDirectChildByClass(bodyWrapper, "el-table__body") || bodyWrapper.querySelector("table.el-table__body")
          : null;
        const tbody = bodyTable?.querySelector("tbody");
        const rows = tbody
          ? [...tbody.children].filter(row => row.matches("tr.el-table__row"))
          : [];
        return { ...item, rows };
      })
      .filter(item => item.rows.length);
  }

  function getDirectCells(row) {
    return [...row.children].filter(child => child.tagName === "TD");
  }

  function removeExistingMarks() {
    document.querySelectorAll(".dime-hazard-row-missing-v3, .dime-hazard-row-parse-error-v3")
      .forEach(element => element.classList.remove(
        "dime-hazard-row-missing-v3", "dime-hazard-row-parse-error-v3"
      ));

    document.querySelectorAll(
      ".dime-hazard-cell-source-v3, .dime-hazard-cell-target-v3, " +
      ".dime-hazard-cell-parse-error-v3, .dime-hazard-cell-stage-v4"
    ).forEach(element => element.classList.remove(
      "dime-hazard-cell-source-v3",
      "dime-hazard-cell-target-v3",
      "dime-hazard-cell-parse-error-v3",
      "dime-hazard-cell-stage-v4"
    ));

    document.querySelectorAll("." + MARKER_CLASS).forEach(element => element.remove());
  }

  function getCellContentContainer(cell) {
    return cell?.querySelector(":scope > .cell") || cell;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }

    // 复制操作保持静默，不再显示提示，避免挤压工具排版。
  }

  function makeCopyButton(name, unresolved = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dime-hazard-copy-name-v3" + (unresolved ? " is-unresolved" : "");
    button.textContent = name;
    button.title = unresolved
      ? "未在标准库中精确定位；点击复制当前名称"
      : "点击复制标准名称";
    button.addEventListener("click", event => {
      event.stopPropagation();
      copyText(name);
    });
    return button;
  }


  function appendDifferenceMarker(cell, packageOnly, cellOnly) {
    const container = getCellContentContainer(cell);
    if (!container) return;

    const marker = document.createElement("div");
    marker.className = `${MARKER_CLASS} ${MARKER_CLASS}--difference`;

    if (packageOnly.length) {
      const block = document.createElement("div");
      block.className = "dime-hazard-diff-block-v4 is-missing";

      const label = document.createElement("div");
      label.className = "dime-hazard-marker-label-v3";
      label.textContent = "匹配缺失｜套餐名称有，危害因素未选择：";
      block.appendChild(label);

      packageOnly.forEach(item => {
        block.appendChild(makeCopyButton(item.canonical, false));
      });

      marker.appendChild(block);
    }

    if (cellOnly.length) {
      const block = document.createElement("div");
      block.className = "dime-hazard-diff-block-v4 is-extra";

      const label = document.createElement("div");
      label.className = "dime-hazard-marker-label-v3";
      label.textContent = "危害多出｜套餐名称未包含，危害因素已选择：";
      block.appendChild(label);

      cellOnly.forEach(item => {
        block.appendChild(makeCopyButton(item.canonical, false));
      });

      marker.appendChild(block);
    }

    container.appendChild(marker);
  }

  function appendWarningMarker(cell, message) {
    const container = getCellContentContainer(cell);
    if (!container) return;

    const marker = document.createElement("div");
    marker.className = `${MARKER_CLASS} ${MARKER_CLASS}--warning`;
    marker.textContent = message;
    container.appendChild(marker);
  }

  function markDifference(row, hazardCell, packageOnly, cellOnly) {
    row.classList.add("dime-hazard-row-missing-v3");
    hazardCell.classList.add("dime-hazard-cell-target-v3");
    appendDifferenceMarker(hazardCell, packageOnly, cellOnly);
  }

  function markStageIssue(stageCell, message) {
    if (!stageCell) return;
    stageCell.classList.add("dime-hazard-cell-stage-v4");
    appendWarningMarker(stageCell, message);
  }

  function markParseError(row, packageCell, message) {
    row.classList.add("dime-hazard-row-parse-error-v3");
    packageCell.classList.add("dime-hazard-cell-parse-error-v3");
    appendWarningMarker(packageCell, message);
  }

  function scrollToResult(result) {
    const row = result.row;
    if (!row?.isConnected) return;
    row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    row.classList.remove("dime-hazard-row-flash-v3");
    void row.offsetWidth;
    row.classList.add("dime-hazard-row-flash-v3");
    setTimeout(() => row.classList.remove("dime-hazard-row-flash-v3"), 1800);
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${TOOL_ID}{
      position:fixed;top:80px;left:calc(100vw - 475px);z-index:2147483647;
      width:455px;height:min(680px,calc(100vh - 105px));
      min-width:360px;min-height:320px;
      max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);
      display:flex;flex-direction:column;box-sizing:border-box;
      overflow:hidden;border:1px solid #cfd5df;border-radius:9px;background:#fff;
      box-shadow:0 8px 32px rgba(0,0,0,.25);
      font-family:"Microsoft YaHei",sans-serif;color:#303133
    }
    #${TOOL_ID}.is-dragging,
    #${TOOL_ID}.is-resizing,
    #${TOOL_ID}.is-height-resizing{user-select:none}
    #${TOOL_ID} .tool-resize-handle{
      position:absolute;top:0;right:0;width:10px;height:49px;z-index:10;
      cursor:ew-resize;touch-action:none
    }
    #${TOOL_ID} .tool-resize-handle::after{
      content:"";position:absolute;right:1px;top:50%;width:3px;height:28px;
      transform:translateY(-50%);border-radius:3px;background:#c0c4cc;opacity:.45
    }
    #${TOOL_ID} .tool-resize-handle:hover::after,
    #${TOOL_ID}.is-resizing .tool-resize-handle::after{background:#409eff;opacity:1}
    #${TOOL_ID} .tool-height-resize-handle{
      position:absolute;left:0;bottom:0;width:100%;height:11px;z-index:11;
      cursor:ns-resize;touch-action:none
    }
    #${TOOL_ID} .tool-height-resize-handle::after{
      content:"";position:absolute;left:50%;bottom:2px;width:44px;height:3px;
      transform:translateX(-50%);border-radius:3px;background:#c0c4cc;opacity:.55
    }
    #${TOOL_ID} .tool-height-resize-handle:hover::after,
    #${TOOL_ID}.is-height-resizing .tool-height-resize-handle::after{
      background:#409eff;opacity:1
    }
    #${TOOL_ID} .tool-header{
      display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
      border-bottom:1px solid #ebeef5;background:#f5f7fa;font-size:16px;
      cursor:grab;user-select:none
    }
    #${TOOL_ID} .tool-header:active{cursor:grabbing}
    #${TOOL_ID} .tool-header-actions{display:flex;align-items:center;gap:5px;margin-right:4px}
    #${TOOL_ID} .tool-header-button{
      width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;
      border:0;border-radius:4px;padding:0;background:transparent;color:#606266;
      font-size:20px;line-height:1;cursor:pointer
    }
    #${TOOL_ID} .tool-header-button:hover{background:#e9edf3;color:#409eff}
    #${TOOL_ID} .tool-close{font-size:26px}
    #${TOOL_ID} .tool-body{
      flex:1;min-height:0;padding:10px 14px 17px;overflow:auto;
      max-height:none;scroll-behavior:smooth
    }
    #${TOOL_ID} .tool-sticky-zone{
      position:sticky;top:-10px;z-index:20;
      margin:-10px -14px 0;padding:10px 14px 9px;
      border-bottom:1px solid #ebeef5;background:#fff;
      box-shadow:0 5px 12px rgba(31,45,61,.08)
    }
    #${TOOL_ID}.is-collapsed{
      height:49px!important;min-height:49px!important;max-height:49px!important
    }
    #${TOOL_ID}.is-collapsed .tool-body,
    #${TOOL_ID}.is-collapsed .tool-resize-handle,
    #${TOOL_ID}.is-collapsed .tool-height-resize-handle{display:none}
    #${TOOL_ID}.is-collapsed .tool-header{border-bottom:0}
    #${TOOL_ID} .tool-help{
      margin:10px 0 0;border:1px solid #e4e7ed;border-radius:5px;
      background:#f5f7fa;overflow:hidden
    }
    #${TOOL_ID} .tool-help summary{padding:8px 10px;cursor:pointer;color:#606266;font-size:12px;font-weight:700;user-select:none;list-style:none}
    #${TOOL_ID} .tool-help summary::-webkit-details-marker{display:none}
    #${TOOL_ID} .tool-help summary::before{content:"▶";display:inline-block;margin-right:6px;font-size:10px;transition:transform .15s}
    #${TOOL_ID} .tool-help[open] summary::before{transform:rotate(90deg)}
    #${TOOL_ID} .tool-help[open] summary{border-bottom:1px solid #e4e7ed}
    #${TOOL_ID} .tool-tip{padding:8px 10px;background:#fff;color:#606266;font-size:12px;line-height:1.65}
    #${TOOL_ID} .tool-buttons{display:flex;gap:8px}
    #${TOOL_ID} .tool-action{flex:1;padding:9px;border:0;border-radius:5px;color:#fff;font-size:14px;cursor:pointer}
    #${TOOL_ID} .tool-run{background:#409eff}
    #${TOOL_ID} .tool-clear{background:#909399}

    #${TOOL_ID} .tool-reference-buttons{
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
      gap:6px;margin-top:8px
    }
    #${TOOL_ID} .tool-reference-button{
      min-width:0;padding:7px 5px;border:1px solid #dcdfe6;
      border-radius:5px;background:#f5f7fa;color:#606266;
      font-size:11px;font-weight:900;cursor:pointer;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis
    }
    #${TOOL_ID} .tool-reference-button:hover{
      border-color:#b3d8ff;background:#ecf5ff;color:#337ecc
    }
    #${TOOL_ID} .tool-reference-button.is-active{
      border-color:#409eff;background:#409eff;color:#fff
    }
    #${TOOL_ID} .tool-reference-panels:empty{display:none}
    #${TOOL_ID} .tool-reference-panels{
      position:relative;z-index:10
    }
    #${TOOL_ID} .tool-reference-panel{
      display:none;margin-top:7px;border:1px solid #d9ecff;
      border-radius:6px;background:#f8fbff;overflow:hidden
    }
    #${TOOL_ID} .tool-reference-panel.is-active{display:block}
    #${TOOL_ID} .tool-reference-panel-header{
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:7px 9px;border-bottom:1px solid #d9ecff;
      background:#ecf5ff;color:#337ecc;font-size:11px;font-weight:900
    }
    #${TOOL_ID} .tool-reference-panel-note{
      padding:6px 9px;border-bottom:1px solid #ebeef5;
      background:#fff;color:#909399;font-size:10px;line-height:1.5
    }
    #${TOOL_ID} .tool-reference-panel-body{
      max-height:260px;padding:7px 9px;overflow:auto;background:#fff
    }
    #${TOOL_ID} .rule-code-row{
      display:flex;align-items:flex-start;justify-content:space-between;
      gap:8px;padding:4px 0;border-bottom:1px dashed #ebeef5
    }
    #${TOOL_ID} .rule-code-row:last-child{border-bottom:0}
    #${TOOL_ID} .rule-code-text{
      min-width:0;flex:1;margin:0;white-space:pre-wrap;word-break:break-all;
      color:#303133;font-family:Consolas,"Courier New",monospace;
      font-size:11px;line-height:1.55;user-select:text
    }
    #${TOOL_ID} .rule-export-actions{
      display:flex;justify-content:flex-end;margin-top:7px
    }
    #${TOOL_ID} .rule-export{
      width:auto;padding:6px 9px;border:0;border-radius:5px;
      color:#fff;font-size:11px;font-weight:800;cursor:pointer
    }
    #${TOOL_ID} .rule-export.alias{background:#409eff}
    #${TOOL_ID} .rule-export.ignore{background:#909399}
    #${TOOL_ID} .tool-copy-all{
      display:none;width:auto;min-width:0;margin:8px 10px 10px auto;
      padding:6px 10px;background:#67c23a;border-radius:5px;
      font-size:11px;font-weight:800
    }
    #${TOOL_ID} .tool-summary{
      margin-top:9px;padding:8px;border:1px solid #e4e7ed;border-radius:7px;
      background:#fff;color:#303133;font-size:13px;line-height:1.5
    }
    #${TOOL_ID} .summary-status{
      display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;
      border:1px solid #d9ecff;background:#ecf5ff;color:#409eff
    }
    #${TOOL_ID} .summary-status.success{border-color:#c2e7b0;background:#f0f9eb;color:#529b2e}
    #${TOOL_ID} .summary-status.warning{border-color:#f5dab1;background:#fdf6ec;color:#b88230}
    #${TOOL_ID} .summary-status.error{border-color:#fbc4c4;background:#fef0f0;color:#c45656}
    #${TOOL_ID} .summary-status-icon{
      flex:0 0 auto;width:20px;height:20px;border-radius:50%;display:flex;
      align-items:center;justify-content:center;background:currentColor;color:#fff;
      font-weight:800;font-size:12px
    }
    #${TOOL_ID} .summary-status-title{font-size:13px;font-weight:900;color:currentColor}
    #${TOOL_ID} .summary-status-text{margin-top:0;font-size:11px;color:#606266}
    #${TOOL_ID} .summary-block-title{
      display:flex;align-items:center;justify-content:space-between;
      margin-top:7px;color:#606266;font-size:11px;font-weight:900
    }
    #${TOOL_ID} .summary-block-title:first-of-type{margin-top:7px}
    #${TOOL_ID} .summary-grid{
      display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-top:5px
    }
    #${TOOL_ID} .summary-stat{
      min-height:45px;display:flex;flex-direction:column;justify-content:center;
      padding:6px 6px;border:1px solid #ebeef5;border-radius:6px;background:#f7f8fa
    }
    #${TOOL_ID} .summary-stat-label{
      display:block;color:#606266;font-size:10px;font-weight:800;
      line-height:1.25;white-space:nowrap
    }
    #${TOOL_ID} .summary-stat-value{
      display:block;margin-top:2px;color:#303133;font-size:18px;
      line-height:1.1;font-weight:900
    }
    #${TOOL_ID} .summary-stat.total{
      border-color:#dcdfe6;background:#f7f8fa
    }
    #${TOOL_ID} .summary-stat.match{
      border-color:#b3e19d;background:#f0f9eb
    }
    #${TOOL_ID} .summary-stat.match .summary-stat-label,
    #${TOOL_ID} .summary-stat.match .summary-stat-value{color:#529b2e}
    #${TOOL_ID} .summary-stat.missing{
      border-color:#fbc4c4;background:#fef0f0
    }
    #${TOOL_ID} .summary-stat.missing .summary-stat-label,
    #${TOOL_ID} .summary-stat.missing .summary-stat-value{color:#c45656}
    #${TOOL_ID} .summary-stat.extra{
      border-color:#f3d19e;background:#fdf6ec
    }
    #${TOOL_ID} .summary-stat.extra .summary-stat-label,
    #${TOOL_ID} .summary-stat.extra .summary-stat-value{color:#b88230}
    #${TOOL_ID} .summary-stat.is-clickable{
      cursor:pointer;transition:transform .15s,box-shadow .15s
    }
    #${TOOL_ID} .summary-stat.is-clickable:hover{
      transform:translateY(-1px);
      box-shadow:0 4px 10px rgba(31,45,61,.12)
    }
    #${TOOL_ID} .summary-stat.is-clickable:focus-visible{
      outline:2px solid #409eff;outline-offset:1px
    }
    #${TOOL_ID} .summary-secondary-grid{
      display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
      gap:5px;margin-top:6px
    }
    #${TOOL_ID} .summary-secondary-grid.without-parse{
      grid-template-columns:repeat(2,minmax(0,1fr))
    }
    #${TOOL_ID} .summary-mini-stat{
      min-height:38px;display:flex;align-items:center;justify-content:space-between;
      gap:5px;padding:6px 7px;border:1px solid #ebeef5;border-radius:6px;
      background:#f7f8fa;color:#606266
    }
    #${TOOL_ID} .summary-mini-stat-label{
      min-width:0;font-size:10px;font-weight:800;line-height:1.25
    }
    #${TOOL_ID} .summary-mini-stat-value{
      flex:0 0 auto;min-width:25px;height:25px;display:flex;
      align-items:center;justify-content:center;border-radius:5px;
      background:#fff;color:#303133;font-size:15px;font-weight:900
    }
    #${TOOL_ID} .summary-mini-stat.stage.has-issue{
      border-color:#d3c6ee;background:#f5f1fb;color:#7254a3
    }
    #${TOOL_ID} .summary-mini-stat.stage.has-issue .summary-mini-stat-value{
      background:#8b6bb8;color:#fff
    }
    #${TOOL_ID} .summary-mini-stat.names.has-issue{
      border-color:#b3d8ff;background:#ecf5ff;color:#337ecc
    }
    #${TOOL_ID} .summary-mini-stat.names.has-issue .summary-mini-stat-value{
      background:#409eff;color:#fff
    }
    #${TOOL_ID} .summary-mini-stat.parse.has-issue{
      border-color:#f3d19e;background:#fdf6ec;color:#b88230
    }
    #${TOOL_ID} .summary-mini-stat.parse.has-issue .summary-mini-stat-value{
      background:#e6a23c;color:#fff
    }
    #${TOOL_ID} .summary-mini-stat.is-clickable{
      cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s
    }
    #${TOOL_ID} .summary-mini-stat.is-clickable:hover{
      transform:translateY(-1px);
      box-shadow:0 4px 10px rgba(31,45,61,.12)
    }
    #${TOOL_ID} .summary-mini-stat.is-clickable:focus-visible{
      outline:2px solid #409eff;outline-offset:1px
    }
    #${TOOL_ID} .batch-panel{
      margin-top:7px;padding:7px;border:1px solid #d3c6ee;
      border-radius:6px;background:#faf8fe
    }
    #${TOOL_ID} .batch-action{
      width:100%;padding:8px 10px;border:0;border-radius:5px;
      background:#8b5cf6;color:#fff;font-size:12px;font-weight:900;
      cursor:pointer
    }
    #${TOOL_ID} .batch-action:hover{filter:brightness(.96)}
    #${TOOL_ID} .batch-action.is-running{background:#e6a23c}
    #${TOOL_ID} .batch-action.is-stopping{
      background:#909399;cursor:wait
    }
    #${TOOL_ID} .batch-status{
      margin-top:5px;color:#7254a3;font-size:10px;line-height:1.5;
      white-space:pre-wrap;word-break:break-word
    }
    #${TOOL_ID} .batch-notice{
      margin-top:7px;padding:7px 8px;border:1px solid #c2e7b0;
      border-radius:6px;background:#f0f9eb;color:#529b2e;
      font-size:10px;line-height:1.5;white-space:pre-wrap
    }
    #${TOOL_ID} [data-result-section]{
      scroll-margin-top:230px
    }
    #${TOOL_ID} .result-section-focus{
      animation:dimeHazardSectionFocus 1.35s ease
    }
    @keyframes dimeHazardSectionFocus{
      0%,100%{box-shadow:none}
      20%,65%{box-shadow:0 0 0 3px rgba(64,158,255,.28)}
    }
    #${TOOL_ID} .summary-section{
      margin-top:8px;padding:8px 9px;border-radius:6px;border:1px solid #d9ecff;
      background:#f4faff;color:#4b6b88
    }
    #${TOOL_ID} .summary-section.warning{border-color:#f5dab1;background:#fdf6ec;color:#9a6b24}
    #${TOOL_ID} .summary-section.maintenance{
      border-color:#b3d8ff;background:#ecf5ff;color:#337ecc
    }
    #${TOOL_ID} .summary-section-title{font-weight:800;color:#303133;margin-bottom:4px}
    #${TOOL_ID} .summary-row{display:flex;justify-content:space-between;gap:12px}
    #${TOOL_ID} .summary-row + .summary-row{margin-top:2px}
    #${TOOL_ID} .summary-row strong{white-space:nowrap;color:inherit}
    #${TOOL_ID} .summary-note{margin-top:5px;padding-top:5px;border-top:1px dashed currentColor;font-size:11px;opacity:.9}
    #${TOOL_ID} .summary-attention-list{
      display:flex;flex-direction:column;gap:6px;margin-top:8px
    }
    #${TOOL_ID} .summary-attention{
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:7px 9px;border:1px solid #e4e7ed;border-radius:6px;
      background:#f7f8fa;font-size:12px;font-weight:700
    }
    #${TOOL_ID} .summary-attention-label{
      min-width:0;display:flex;align-items:center;gap:6px
    }
    #${TOOL_ID} .summary-attention-icon{
      flex:0 0 auto;width:18px;height:18px;border-radius:50%;
      display:inline-flex;align-items:center;justify-content:center;
      color:#fff;font-size:11px;font-weight:900
    }
    #${TOOL_ID} .summary-attention-count{
      flex:0 0 auto;font-size:14px;font-weight:900;white-space:nowrap
    }
    #${TOOL_ID} .summary-attention.danger{
      border-color:#fbc4c4;background:#fef0f0;color:#c45656
    }
    #${TOOL_ID} .summary-attention.danger .summary-attention-icon{background:#f56c6c}
    #${TOOL_ID} .summary-attention.warning{
      border-color:#f5dab1;background:#fdf6ec;color:#b88230
    }
    #${TOOL_ID} .summary-attention.warning .summary-attention-icon{background:#e6a23c}
    #${TOOL_ID} .summary-attention.maintenance{
      border-color:#b3d8ff;background:#ecf5ff;color:#337ecc
    }
    #${TOOL_ID} .summary-attention.maintenance .summary-attention-icon{background:#409eff}
    #${TOOL_ID} .summary-attention.auxiliary{
      border-color:#d3c6ee;background:#f5f1fb;color:#7254a3
    }
    #${TOOL_ID} .summary-attention.auxiliary .summary-attention-icon{background:#8b6bb8}
    #${TOOL_ID} .summary-attention.alias{
      border-color:#bce3dc;background:#eefaf7;color:#3b7f72
    }
    #${TOOL_ID} .summary-attention.alias .summary-attention-icon{background:#5aa897}
    #${TOOL_ID} .summary-quiet-note{
      margin-top:8px;padding:6px 8px;border-radius:5px;
      background:#f7f8fa;color:#909399;font-size:11px;line-height:1.5
    }

    #${TOOL_ID} .tool-results{margin-top:10px;display:flex;flex-direction:column;gap:9px}
    #${TOOL_ID} .result-group{
      border:1px solid #e4e7ed;border-radius:7px;background:#fff;overflow:hidden
    }
    #${TOOL_ID} .result-group-header,
    #${TOOL_ID} .result-group > summary{
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:8px 10px;background:#f5f7fa;color:#606266;font-size:12px;
      font-weight:800;list-style:none;cursor:default
    }
    #${TOOL_ID} .result-group > summary{cursor:pointer;user-select:none}
    #${TOOL_ID} .result-group > summary::-webkit-details-marker{display:none}
    #${TOOL_ID} .result-group > summary::before{
      content:"▶";font-size:9px;color:#909399;transition:transform .15s;margin-right:2px
    }
    #${TOOL_ID} .result-group[open] > summary::before{transform:rotate(90deg)}
    #${TOOL_ID} .result-group.missing{border-color:#fbc4c4}
    #${TOOL_ID} .result-group.missing .result-group-header{background:#fef0f0;color:#c45656}
    #${TOOL_ID} .result-group.parse-error{border-color:#f5dab1}
    #${TOOL_ID} .result-group.parse-error .result-group-header{background:#fdf6ec;color:#b88230}
    #${TOOL_ID} .result-group.maintenance{border-color:#b3d8ff}
    #${TOOL_ID} .result-group.maintenance .result-group-header{
      background:#ecf5ff;color:#337ecc
    }
    #${TOOL_ID} .result-group.unknown{border-color:#d6e4f0}
    #${TOOL_ID} .result-group.unknown > summary{background:#f3f7fb;color:#4b6b88}
    #${TOOL_ID} .result-group-count{
      flex:0 0 auto;padding:1px 7px;border-radius:10px;background:rgba(255,255,255,.75);
      font-size:11px;font-weight:800
    }
    #${TOOL_ID} .result-group-content{display:flex;flex-direction:column;gap:7px;padding:8px}
    #${TOOL_ID} .result-item{
      padding:9px;border:1px solid #ebeef5;border-radius:6px;background:#fff;
      cursor:pointer;font-size:12px;line-height:1.55;word-break:break-word
    }
    #${TOOL_ID} .result-item.missing{border-color:#fbc4c4;background:#fef0f0}
    #${TOOL_ID} .result-item.missing:hover{border-color:#f56c6c}
    #${TOOL_ID} .result-item.parse-error{border-color:#f5dab1;background:#fdf6ec}
    #${TOOL_ID} .result-item.parse-error:hover{border-color:#e6a23c}
    #${TOOL_ID} .result-item.maintenance{
      border-color:#b3d8ff;background:#f4faff
    }
    #${TOOL_ID} .result-item.maintenance:hover{
      border-color:#409eff;background:#ecf5ff
    }
    #${TOOL_ID} .result-item.unknown{border-color:#d6e4f0;background:#f7fafc}
    #${TOOL_ID} .result-item.unknown:hover{border-color:#9fc3df;background:#f1f7fc}
    #${TOOL_ID} .result-kicker{
      display:inline-block;margin-bottom:5px;padding:1px 6px;border-radius:9px;
      font-size:10px;font-weight:800
    }
    #${TOOL_ID} .result-item.missing .result-kicker{background:#f56c6c;color:#fff}
    #${TOOL_ID} .result-item.parse-error .result-kicker{background:#e6a23c;color:#fff}
    #${TOOL_ID} .result-item.maintenance .result-kicker{
      background:#409eff;color:#fff
    }
    #${TOOL_ID} .result-item.unknown .result-kicker{background:#dbe9f4;color:#4b6b88}
    #${TOOL_ID} .result-title{font-weight:800;color:#303133}
    #${TOOL_ID} .result-detail{margin-top:5px}
    #${TOOL_ID} .result-item.missing .result-detail{color:#c45656}
    #${TOOL_ID} .result-item.parse-error .result-detail{color:#9a6b24}
    #${TOOL_ID} .result-item.maintenance .result-detail{color:#337ecc}
    #${TOOL_ID} .result-item.unknown .result-detail{color:#4b6b88}
    #${TOOL_ID} .result-note{margin-top:6px;color:#7d8f9f;font-size:11px}
    #${TOOL_ID} .result-item.difference{
      border-color:#fbc4c4;background:#fffafa
    }
    #${TOOL_ID} .difference-line{
      margin-top:7px;padding:8px 9px;border:1px solid transparent;border-radius:6px
    }
    #${TOOL_ID} .difference-line.is-missing{
      border-color:#fbc4c4;background:#fef0f0;color:#c45656
    }
    #${TOOL_ID} .difference-line.is-extra{
      border-color:#f3d19e;background:#fdf6ec;color:#b88230
    }
    #${TOOL_ID} .difference-line strong{
      display:flex;align-items:center;gap:6px;margin-bottom:5px;
      font-size:12px;font-weight:900
    }
    #${TOOL_ID} .difference-line strong::before{
      flex:0 0 auto;width:18px;height:18px;display:inline-flex;
      align-items:center;justify-content:center;border-radius:50%;
      color:#fff;font-size:11px;font-weight:900
    }
    #${TOOL_ID} .difference-line.is-missing strong::before{
      content:"缺";background:#f56c6c
    }
    #${TOOL_ID} .difference-line.is-extra strong::before{
      content:"多";background:#e6a23c
    }

    #${TOOL_ID} .mapping-module{
      border:1px solid #b3d8ff;border-radius:7px;background:#f7fbff;overflow:hidden
    }
    #${TOOL_ID} .mapping-module-header{
      display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:9px 10px;background:#ecf5ff;color:#337ecc;font-size:12px;font-weight:900
    }
    #${TOOL_ID} .mapping-module-content{
      display:flex;flex-direction:column;gap:8px;padding:8px
    }
    #${TOOL_ID} .mapping-card{
      padding:9px;border:1px solid #d9ecff;border-radius:6px;background:#fff
    }
    #${TOOL_ID} .mapping-name{
      color:#303133;font-size:14px;font-weight:900;word-break:break-all
    }
    #${TOOL_ID} .mapping-meta{
      margin-top:2px;color:#909399;font-size:11px
    }
    #${TOOL_ID} .mapping-search,
    #${TOOL_ID} .mapping-select{
      box-sizing:border-box;width:100%;height:34px;margin-top:7px;
      padding:0 8px;border:1px solid #dcdfe6;border-radius:5px;background:#fff;
      color:#303133;font-family:inherit;font-size:12px;outline:none
    }
    #${TOOL_ID} .mapping-search:focus,
    #${TOOL_ID} .mapping-select:focus{border-color:#409eff}
    #${TOOL_ID} .mapping-actions{
      display:flex;flex-wrap:wrap;gap:6px;margin-top:7px
    }
    #${TOOL_ID} .mapping-action{
      flex:1 1 calc(50% - 3px);padding:7px 8px;border:0;
      border-radius:5px;color:#fff;font-size:12px;
      font-weight:800;cursor:pointer
    }
    #${TOOL_ID} .mapping-save{background:#409eff}
    #${TOOL_ID} .mapping-ignore{background:#909399}
    #${TOOL_ID} .mapping-ignore-keyword{background:#e6a23c}
    #${TOOL_ID} .mapping-copy{background:#67c23a}
    #${TOOL_ID} .rules-box{
      border:1px solid #e4e7ed;border-radius:7px;background:#fff;overflow:hidden
    }
    #${TOOL_ID} .rules-box > summary{
      padding:8px 10px;background:#f5f7fa;color:#606266;
      font-size:12px;font-weight:800;cursor:pointer;list-style:none
    }
    #${TOOL_ID} .rules-box > summary::-webkit-details-marker{display:none}
    #${TOOL_ID} .rules-content{padding:8px}
    #${TOOL_ID} .rule-row{
      display:flex;align-items:flex-start;justify-content:space-between;gap:8px;
      padding:6px 0;border-bottom:1px dashed #ebeef5;font-size:11px
    }
    #${TOOL_ID} .rule-row:last-child{border-bottom:0}
    #${TOOL_ID} .rule-text{
      min-width:0;flex:1;word-break:break-all;line-height:1.5
    }
    #${TOOL_ID} .rule-pending-actions{
      flex:0 0 auto;display:flex;align-items:center;gap:5px
    }
    #${TOOL_ID} .rule-badge{
      flex:0 0 auto;padding:3px 6px;border:1px solid #f3d19e;
      border-radius:4px;background:#fdf6ec;color:#b88230;
      font-family:inherit;font-size:10px;font-weight:900;
      line-height:1.25;cursor:pointer
    }
    #${TOOL_ID} .rule-badge:hover{
      border-color:#e6a23c;background:#e6a23c;color:#fff
    }
    #${TOOL_ID} .rule-badge:active{
      transform:translateY(1px)
    }
    #${TOOL_ID} .rule-delete{
      flex:0 0 auto;padding:3px 7px;border:1px solid #fbc4c4;
      border-radius:4px;background:#fef0f0;color:#f56c6c;
      font-size:10px;font-weight:900;cursor:pointer
    }
    #${TOOL_ID} .rule-delete:hover{
      background:#f56c6c;color:#fff
    }
    #${TOOL_ID} .rule-list-note{
      margin-bottom:6px;padding:6px 7px;border-radius:5px;
      background:#f5f7fa;color:#909399;font-size:11px;line-height:1.5
    }
    #${TOOL_ID} .rule-exclusion-label{
      flex:0 0 92px;color:#606266;font-weight:900
    }
    #${TOOL_ID} .rule-exclusion-value{
      min-width:0;flex:1;color:#909399;line-height:1.55
    }
    #${TOOL_ID} .rule-export-actions{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));
      gap:7px;margin-top:8px
    }
    #${TOOL_ID} .rule-export{
      width:100%;padding:8px 6px;border:0;border-radius:5px;
      color:#fff;font-size:12px;font-weight:800;cursor:pointer
    }
    #${TOOL_ID} .rule-export.alias{background:#409eff}
    #${TOOL_ID} .rule-export.ignore{background:#909399}
    #${TOOL_ID} .result-copy-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    #${TOOL_ID} .tool-toast{display:none;margin-top:8px;padding:6px 8px;border-radius:4px;background:#f0f9eb;color:#67c23a;font-size:12px;word-break:break-all}

    tr.dime-hazard-row-parse-error-v3 > td{background:#fffaf0 !important}
    td.dime-hazard-cell-target-v3{
      box-shadow:inset 0 0 0 2px #f56c6c !important;
      background:#fffafa !important
    }
    td.dime-hazard-cell-stage-v4{
      box-shadow:inset 0 0 0 2px #8b6bb8 !important;
      background:#faf8fe !important
    }
    td.dime-hazard-cell-parse-error-v3{box-shadow:inset 0 0 0 2px #e6a23c !important;background:#fdf6ec !important}
    .${MARKER_CLASS}{display:block;margin-top:6px;padding:6px;border-radius:5px;font-size:12px;font-weight:700;line-height:1.45;white-space:normal;word-break:break-word}
    .${MARKER_CLASS}--difference{
      padding:6px;background:#fff;border:1px solid #fbc4c4;color:#606266
    }
    .${MARKER_CLASS}--warning{
      background:#f5f1fb;border:1px solid #d3c6ee;color:#7254a3
    }
    .dime-hazard-diff-block-v4 + .dime-hazard-diff-block-v4{
      margin-top:6px;padding-top:6px;border-top:1px dashed #dcdfe6
    }
    .dime-hazard-diff-block-v4.is-missing .dime-hazard-marker-label-v3{
      color:#c45656
    }
    .dime-hazard-diff-block-v4.is-extra .dime-hazard-marker-label-v3{
      color:#b88230
    }
    .dime-hazard-diff-block-v4.is-extra .dime-hazard-copy-name-v3{
      background:#e6a23c;border-color:#e6a23c
    }
    .dime-hazard-marker-label-v3{margin-bottom:4px}
    .dime-hazard-copy-name-v3{
      display:inline-block;margin:2px 4px 2px 0;padding:3px 7px;border:1px solid #f56c6c;
      border-radius:4px;background:#f56c6c;color:#fff;font:inherit;font-weight:700;
      line-height:1.35;cursor:pointer;text-align:left
    }
    .dime-hazard-copy-name-v3:hover{filter:brightness(.92)}
    .dime-hazard-copy-name-v3.is-unresolved{border-style:dashed;background:#eef4f9;border-color:#9fc3df;color:#4b6b88}
    .dime-hazard-copy-name-v3.is-maintenance{
      border-style:solid;background:#409eff;border-color:#409eff;color:#fff
    }
    #${TOOL_ID} .dime-hazard-copy-name-v3{font-size:12px;padding:3px 6px}
    tr.dime-hazard-row-flash-v3 > td{animation:dimeHazardFlashV3 .45s ease-in-out 3}
    @keyframes dimeHazardFlashV3{0%,100%{filter:none}50%{filter:brightness(.82)}}

    .${AUTO_PANEL_CLASS}{
      margin-top:8px;padding:9px 10px;border:1px solid #b3d8ff;border-radius:6px;
      background:#ecf5ff;color:#409eff;font-family:"Microsoft YaHei",sans-serif;
      font-size:12px;line-height:1.55;box-sizing:border-box
    }
    .${AUTO_PANEL_CLASS}.is-warning{border-color:#f5dab1;background:#fdf6ec;color:#e6a23c}
    .${AUTO_PANEL_CLASS}.is-success{border-color:#c2e7b0;background:#f0f9eb;color:#67c23a}
    .${AUTO_PANEL_CLASS}.is-error{border-color:#fbc4c4;background:#fef0f0;color:#f56c6c}
    .${AUTO_PANEL_CLASS} .autofill-title{font-weight:700;color:#303133;margin-bottom:5px}
    .${AUTO_PANEL_CLASS} .autofill-code{font-family:Consolas,monospace;font-weight:700}
    .${AUTO_PANEL_CLASS} .autofill-list{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
    .${AUTO_PANEL_CLASS} .autofill-name{
      display:inline-block;padding:2px 6px;border-radius:4px;background:#fff;
      border:1px solid currentColor;color:inherit;font-weight:700;word-break:break-all
    }
    .${AUTO_PANEL_CLASS} .autofill-name.is-stage{
      border-color:#67c23a;background:#f0f9eb;color:#529b2e
    }
    .${AUTO_PANEL_CLASS} .autofill-name.is-conflict{
      border-color:#e6a23c;background:#fdf6ec;color:#b88230
    }
    .${AUTO_PANEL_CLASS} .autofill-action{
      width:100%;margin-top:5px;padding:8px 10px;border:0;border-radius:5px;
      background:#409eff;color:#fff;font-weight:700;cursor:pointer
    }
    .${AUTO_PANEL_CLASS} .autofill-action:hover{filter:brightness(.95)}
    .${AUTO_PANEL_CLASS} .autofill-action:disabled{background:#a0cfff;cursor:not-allowed;filter:none}
    .${AUTO_PANEL_CLASS} .autofill-status{margin-top:6px;white-space:pre-wrap;word-break:break-word}

    #${LAUNCHER_ID}{
      position:fixed;top:88px;right:18px;z-index:2147483646;
      width:172px;height:42px;display:flex;align-items:center;justify-content:center;
      gap:9px;padding:0 16px;border:1px solid #1f6fbd;
      border-radius:22px;background:#409eff;color:#fff;
      box-shadow:0 7px 20px rgba(64,158,255,.38);
      font-family:"Microsoft YaHei",sans-serif;font-size:15px;font-weight:900;
      letter-spacing:.3px;white-space:nowrap;cursor:grab;touch-action:none;
      text-shadow:0 1px 1px rgba(0,0,0,.22);
      transition:box-shadow .16s,background .16s,filter .16s
    }
    #${LAUNCHER_ID}:hover{
      background:#337ecc;filter:brightness(1.03);
      box-shadow:0 9px 26px rgba(64,158,255,.48)
    }
    #${LAUNCHER_ID}.is-open{
      background:#1f6fbd;border-color:#185b9c;
      box-shadow:0 7px 22px rgba(31,111,189,.46)
    }
    #${LAUNCHER_ID}.is-open:hover{
      background:#185b9c
    }
    #${LAUNCHER_ID}.is-launcher-dragging{
      cursor:grabbing;filter:brightness(.96);
      box-shadow:0 10px 28px rgba(64,158,255,.5)
    }
    #${LAUNCHER_ID} .launcher-icon{
      width:25px;height:25px;display:inline-flex;align-items:center;justify-content:center;
      flex:0 0 auto;border-radius:50%;background:#fff;
      color:#2677c8;font-size:13px;font-weight:900;text-shadow:none;
      box-shadow:0 1px 3px rgba(0,0,0,.16)
    }
  `;
  document.head.appendChild(style);

  const tool = document.createElement("div");
  tool.id = TOOL_ID;
  tool.innerHTML = `
    <div class="tool-header">
      <strong>套餐危害因素核对工具 v4.2.16</strong>
      <div class="tool-header-actions">
        <button class="tool-header-button tool-collapse" type="button" title="折叠工具">−</button>
        <button class="tool-header-button tool-close" type="button" title="收起到快捷按钮">×</button>
      </div>
    </div>
    <div class="tool-body">
      <div class="tool-sticky-zone">
        <div class="tool-buttons">
          <button class="tool-action tool-run" type="button">开始核对</button>
          <button class="tool-action tool-clear" type="button">清除高亮</button>
        </div>

        <div class="tool-reference-buttons">
          <button
            class="tool-reference-button"
            type="button"
            data-reference-panel="aliases"
          >匹配规则</button>
          <button
            class="tool-reference-button"
            type="button"
            data-reference-panel="exclusions"
          >排除项</button>
          <button
            class="tool-reference-button"
            type="button"
            data-reference-panel="ignores"
          >无关内容</button>
          <button
            class="tool-reference-button"
            type="button"
            data-reference-panel="ignore-keywords"
          >无关关键词</button>
        </div>

        <div class="tool-summary">等待核对</div>
      </div>

      <div class="tool-reference-panels"></div>
      <div class="tool-toast"></div>
      <div class="tool-results"></div>
      <button class="tool-action tool-copy-all" type="button">
        复制全部缺失名称
      </button>

      <details class="tool-help">
        <summary>使用说明（点击展开）</summary>
        <div class="tool-tip">
          <b>核对：</b>点击“开始核对”，脚本会比较套餐名称与系统危害因素，并检查在岗状态。<br>
          <b>套餐名称：</b>建议使用“XX-危害1+危害2+危害3+岗中+性别”等标准格式；常见其他分隔符和岗位简称也可识别。<br>
          <b>异常结果：</b>“匹配缺失、危害多出、岗位异常、待处理名称”等数字可点击查看对应明细。<br>
          <b>岗位状态：</b>系统岗位为空且套餐状态明确时可辅助补齐；已有岗位与套餐不一致时仅提示，不自动覆盖。<br>
          <b>名称处理：</b>无法直接匹配的名称可建立标准危害映射，或设置为“精确无关 / 关键词无关”，保存后继续复用。<br>
          <b>自动处理：</b>编辑时可一键补齐明确缺失项；批量安全修复只处理可明确判断的项目，并在操作过程中进行复核。
        </div>
      </details>
    </div>
    <div class="tool-resize-handle" title="按住并左右拖动调整窗口宽度"></div>
    <div class="tool-height-resize-handle" title="按住底边上下拖动调整窗口高度"></div>
  `;
  document.body.appendChild(tool);
  tool.style.display = "none";

  const launcher = document.createElement("button");
  launcher.id = LAUNCHER_ID;
  launcher.type = "button";
  launcher.title = "点击打开套餐危害因素核对工具";
  launcher.innerHTML = `
    <span class="launcher-icon">核</span>
    <span class="launcher-text">打开套餐核对</span>
  `;
  document.body.appendChild(launcher);

  const runButton = tool.querySelector(".tool-run");
  const clearButton = tool.querySelector(".tool-clear");
  const copyAllButton = tool.querySelector(".tool-copy-all");
  const collapseButton = tool.querySelector(".tool-collapse");
  const closeButton = tool.querySelector(".tool-close");
  const toolBody = tool.querySelector(".tool-body");
  const stickyZone = tool.querySelector(".tool-sticky-zone");
  const summaryBox = tool.querySelector(".tool-summary");
  const toastBox = tool.querySelector(".tool-toast");
  const resultsBox = tool.querySelector(".tool-results");
  const referenceButtons = [
    ...tool.querySelectorAll(".tool-reference-button")
  ];
  const referencePanelsBox =
    tool.querySelector(".tool-reference-panels");
  const dragHandle = tool.querySelector(".tool-header");
  const resizeHandle = tool.querySelector(".tool-resize-handle");
  const heightResizeHandle =
    tool.querySelector(".tool-height-resize-handle");
  const MIN_TOOL_WIDTH = 360;
  const MIN_VIEWPORT_TOOL_WIDTH = 260;
  const MIN_TOOL_HEIGHT = 320;
  const MIN_VIEWPORT_TOOL_HEIGHT = 220;
  let expandedToolHeight = Math.min(
    680,
    Math.max(MIN_TOOL_HEIGHT, innerHeight - 105)
  );
  let latestMissingNames = [];
  let latestMismatchByCode = new Map();
  let latestBatchCandidates = [];
  let batchVerifiedCodes = new Set();
  let batchStrictCombinedVerification = false;
  let batchCombinedAcceptedCount = 0;
  let batchRunning = false;
  let batchCancelRequested = false;
  let lastBatchNotice = "";
  let hasRunCheck = false;
  let dialogObserver = null;
  let enhanceTimer = null;
  let destroyed = false;
  let toastTimer = null;

  function showToast(text) {
    toastBox.textContent = text;
    toastBox.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastBox.style.display = "none"; }, 2200);
  }

  function setSummary(text, type = "normal") {
    const styles = {
      normal: ["#f5f7fa", "#606266"], running: ["#ecf5ff", "#409eff"],
      success: ["#f0f9eb", "#67c23a"], error: ["#fef0f0", "#f56c6c"],
      warning: ["#fdf6ec", "#e6a23c"]
    };
    const selected = styles[type] || styles.normal;
    summaryBox.textContent = text;
    summaryBox.style.background = selected[0];
    summaryBox.style.color = selected[1];
  }

  function renderSummaryOverview(stats) {
    const {
      scannedCount,
      matchedCount,
      packageMissingPackageCount,
      cellExtraPackageCount,
      unresolvedNameCount,
      stageIssueCount,
      parseErrorCount,
      batchCandidateCount
    } = stats;

    const hasDifference =
      packageMissingPackageCount > 0 ||
      cellExtraPackageCount > 0;

    let statusClass = "success";
    let statusIcon = "✓";
    let statusTitle = "核对完成，所有套餐完全匹配";
    let statusText = "正式判断仅依据标准危害库和已保存的别名对照表。";

    if (hasDifference) {
      statusClass = "error";
      statusIcon = "!";
      statusTitle = "发现危害匹配差异";
      statusText =
        `匹配缺失 ${packageMissingPackageCount} 个套餐，` +
        `危害多出 ${cellExtraPackageCount} 个套餐；` +
        `岗位异常 ${stageIssueCount} 个套餐。`;
    } else if (
      unresolvedNameCount ||
      parseErrorCount
    ) {
      statusClass = "warning";
      statusIcon = "!";
      statusTitle = "仍有名称需要人工判断";
      statusText =
        `待处理名称 ${unresolvedNameCount} 项，` +
        `无法解析 ${parseErrorCount} 个套餐，` +
        `岗位异常 ${stageIssueCount} 个套餐。`;
    } else if (stageIssueCount > 0) {
      statusClass = "warning";
      statusIcon = "!";
      statusTitle = "危害因素已匹配，岗位状态需要处理";
      statusText =
        `共有 ${stageIssueCount} 个套餐存在岗位状态空白、冲突或无法映射。`;
    }

    summaryBox.style.background = "#fff";
    summaryBox.style.color = "#303133";
    summaryBox.innerHTML = `
      <div class="summary-status ${statusClass}">
        <div class="summary-status-icon">${statusIcon}</div>
        <div>
          <div class="summary-status-title">${statusTitle}</div>
          <div class="summary-status-text">${statusText}</div>
        </div>
      </div>

      <div class="summary-block-title">
        <span>危害因素</span>
      </div>

      <div class="summary-grid">
        <div class="summary-stat total">
          <span class="summary-stat-label">套餐总数</span>
          <strong class="summary-stat-value">${scannedCount}</strong>
        </div>
        <div class="summary-stat match">
          <span class="summary-stat-label">完全匹配</span>
          <strong class="summary-stat-value">${matchedCount}</strong>
        </div>
        <div
          class="summary-stat ${
            packageMissingPackageCount > 0
              ? "missing is-clickable"
              : ""
          }"
          ${
            packageMissingPackageCount > 0
              ? 'data-summary-target="differences" role="button" tabindex="0" title="点击定位到危害匹配差异"'
              : ""
          }
        >
          <span class="summary-stat-label">匹配缺失</span>
          <strong class="summary-stat-value">${packageMissingPackageCount}</strong>
        </div>
        <div
          class="summary-stat ${
            cellExtraPackageCount > 0
              ? "extra is-clickable"
              : ""
          }"
          ${
            cellExtraPackageCount > 0
              ? 'data-summary-target="differences" role="button" tabindex="0" title="点击定位到危害匹配差异"'
              : ""
          }
        >
          <span class="summary-stat-label">危害多出</span>
          <strong class="summary-stat-value">${cellExtraPackageCount}</strong>
        </div>
      </div>

      <div class="summary-block-title">
        <span>辅助检查</span>
      </div>

      <div class="summary-secondary-grid ${
        parseErrorCount > 0 ? "" : "without-parse"
      }">
        <div
          class="summary-mini-stat stage ${
            stageIssueCount > 0
              ? "has-issue is-clickable"
              : ""
          }"
          ${
            stageIssueCount > 0
              ? 'data-summary-target="stage" role="button" tabindex="0" title="点击打开并定位到岗位异常明细"'
              : ""
          }
        >
          <span class="summary-mini-stat-label">岗位异常</span>
          <strong class="summary-mini-stat-value">${stageIssueCount}</strong>
        </div>
        <div
          class="summary-mini-stat names ${
            unresolvedNameCount > 0
              ? "has-issue is-clickable"
              : ""
          }"
          ${
            unresolvedNameCount > 0
              ? 'data-summary-target="names" role="button" tabindex="0" title="点击定位到名称处理模块"'
              : ""
          }
        >
          <span class="summary-mini-stat-label">待处理名称</span>
          <strong class="summary-mini-stat-value">${unresolvedNameCount}</strong>
        </div>
        ${
          parseErrorCount > 0
            ? `
              <div
                class="summary-mini-stat parse has-issue is-clickable"
                data-summary-target="parse"
                role="button"
                tabindex="0"
                title="点击打开并定位到无法解析明细"
              >
                <span class="summary-mini-stat-label">无法解析</span>
                <strong class="summary-mini-stat-value">${parseErrorCount}</strong>
              </div>
            `
            : ""
        }
      </div>

      ${
        batchCandidateCount > 0 || batchRunning
          ? `
            <div class="batch-panel">
              <button
                class="batch-action ${batchRunning ? "is-running" : ""}"
                type="button"
              >${
                batchRunning
                  ? "停止批量处理"
                  : `批量安全修复本页（${batchCandidateCount}）`
              }</button>
              <div class="batch-status">${
                batchRunning
                  ? "正在准备批量处理……"
                  : "分组处理：只缺岗位 → 只缺危害 → 两者都缺；组合项岗位后立即补危害并双向复核。"
              }</div>
            </div>
          `
          : ""
      }

      ${lastBatchNotice ? '<div class="batch-notice"></div>' : ""}
    `;

    const notice = summaryBox.querySelector(".batch-notice");
    if (notice) notice.textContent = lastBatchNotice;

    bindSummaryNavigation();
    bindBatchAction();
  }

  function getBatchActionButton() {
    return summaryBox.querySelector(".batch-action");
  }

  function getBatchStatusBox() {
    return summaryBox.querySelector(".batch-status");
  }

  function updateBatchProgress(text, progressText = "") {
    const button = getBatchActionButton();
    const status = getBatchStatusBox();

    if (button) {
      button.textContent = text;
      button.classList.toggle("is-running", batchRunning);
      button.classList.toggle(
        "is-stopping",
        batchRunning && batchCancelRequested
      );
    }

    if (status && progressText) {
      status.textContent = progressText;
    }
  }

  function bindBatchAction() {
    const button = getBatchActionButton();
    if (!button) return;

    button.addEventListener("click", () => {
      if (batchRunning) {
        batchCancelRequested = true;
        updateBatchProgress(
          "正在停止，请等待当前套餐结束",
          "已收到停止请求；当前套餐完成或报错后停止。"
        );
        return;
      }

      startBatchRepair();
    });
  }

  function revealResultSection(sectionKey) {
    const target = resultsBox.querySelector(
      `[data-result-section="${sectionKey}"]`
    );

    if (!target) return;

    if (target.tagName === "DETAILS") {
      target.open = true;
    }

    requestAnimationFrame(() => {
      const bodyRect = toolBody.getBoundingClientRect();
      const stickyHeight =
        stickyZone?.getBoundingClientRect().height || 0;
      const targetRect = target.getBoundingClientRect();

      const nextTop =
        toolBody.scrollTop +
        targetRect.top -
        bodyRect.top -
        stickyHeight -
        10;

      toolBody.scrollTo({
        top: Math.max(0, nextTop),
        behavior: "smooth"
      });

      target.classList.remove("result-section-focus");
      void target.offsetWidth;
      target.classList.add("result-section-focus");

      setTimeout(() => {
        target.classList.remove("result-section-focus");
      }, 1500);
    });
  }

  function bindSummaryNavigation() {
    summaryBox
      .querySelectorAll("[data-summary-target]")
      .forEach(card => {
        const openTarget = () => {
          const sectionKey = card.dataset.summaryTarget;
          if (sectionKey) revealResultSection(sectionKey);
        };

        card.addEventListener("click", openTarget);
        card.addEventListener("keydown", event => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          openTarget();
        });
      });
  }

  function getAllAliasEntriesForDisplay() {
    const merged = new Map();

    for (const [alias, canonical] of Object.entries(
      CONFIG.builtinAliases
    )) {
      const key = strictKey(alias);
      if (!key || !STANDARD_SET.has(canonical)) continue;

      merged.set(key, {
        alias: cleanText(alias),
        canonical: cleanText(canonical),
        pending: false
      });
    }

    for (const [alias, canonical] of Object.entries(userAliasMap)) {
      const key = strictKey(alias);
      if (!key || !STANDARD_SET.has(canonical)) continue;

      const builtin = merged.get(key);
      const isSameAsBuiltin = Boolean(
        builtin &&
        strictKey(builtin.canonical) === strictKey(canonical)
      );

      merged.set(key, {
        alias: cleanText(alias),
        canonical: cleanText(canonical),
        pending: !isSameAsBuiltin
      });
    }

    return [...merged.values()]
      .sort((a, b) =>
        a.alias.localeCompare(b.alias, "zh-CN") ||
        a.canonical.localeCompare(b.canonical, "zh-CN")
      );
  }

  function getAllIgnoreEntriesForDisplay() {
    const merged = new Map();

    for (const rawName of CONFIG.builtinIgnoreTerms) {
      const name = cleanText(rawName);
      const key = strictKey(name);
      if (!key) continue;

      merged.set(key, {
        name,
        pending: false
      });
    }

    for (const rawName of userIgnoreTerms) {
      const name = cleanText(rawName);
      const key = strictKey(name);
      if (!key) continue;

      const builtin = merged.get(key);

      merged.set(key, {
        name,
        pending: !builtin
      });
    }

    return [...merged.values()]
      .sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN")
      );
  }

  function getAllIgnoreKeywordEntriesForDisplay() {
    const merged = new Map();

    for (
      const rawKeyword
      of CONFIG.builtinIgnoreKeywords
    ) {
      const keyword =
        cleanText(rawKeyword);

      const key =
        strictKey(keyword);

      if (!key) continue;

      merged.set(key, {
        keyword,
        pending: false
      });
    }

    for (
      const rawKeyword
      of userIgnoreKeywords
    ) {
      const keyword =
        cleanText(rawKeyword);

      const key =
        strictKey(keyword);

      if (!key) continue;

      const builtin =
        merged.get(key);

      merged.set(key, {
        keyword,
        pending: !builtin
      });
    }

    return [...merged.values()]
      .sort((a, b) =>
        a.keyword.localeCompare(
          b.keyword,
          "zh-CN"
        )
      );
  }

  function getPendingAliasEntries() {
    return getAllAliasEntriesForDisplay()
      .filter(item => item.pending)
      .map(item => [item.alias, item.canonical]);
  }

  function getPendingIgnoreEntries() {
    return getAllIgnoreEntriesForDisplay()
      .filter(item => item.pending)
      .map(item => item.name);
  }

  function getPendingIgnoreKeywordEntries() {
    return getAllIgnoreKeywordEntriesForDisplay()
      .filter(item => item.pending)
      .map(item => item.keyword);
  }

  function getExclusionEntriesForDisplay() {
    return [
      '      仅核对名称含：上岗前 / 在岗期间 / 离岗时 / 离岗后医学随访 / 应急检查',
      '      兼容简称：岗前 / 岗中 / 岗后 / 在岗 / 离岗 / 离岗后 / 应急',
      '      性别婚姻信息仅作为名称元数据剥离，不单独报异常'
    ];
  }

  function saveAliasRule(raw, canonical) {
    const alias = cleanText(raw);
    const target = cleanText(canonical);

    if (!alias || !STANDARD_SET.has(target)) {
      showToast("请选择有效的标准危害名称");
      return;
    }

    userAliasMap[alias] = target;

    userIgnoreTerms = userIgnoreTerms.filter(
      item => strictKey(item) !== strictKey(alias)
    );

    persistUserRules();
    showToast(`已保存匹配：${alias} → ${target}`);
    runCheck();
  }

  function saveIgnoreRule(raw) {
    const name = cleanText(raw);
    if (!name) return;

    if (!userIgnoreTerms.some(
      item => strictKey(item) === strictKey(name)
    )) {
      userIgnoreTerms.push(name);
    }

    Object.keys(userAliasMap).forEach(alias => {
      if (strictKey(alias) === strictKey(name)) {
        delete userAliasMap[alias];
      }
    });

    persistUserRules();
    showToast(`已标记为无关内容：${name}`);
    runCheck();
  }

  function suggestIgnoreKeyword(raw) {
    return cleanText(raw)
      .replace(/[0-9０-９]+$/g, "")
      .replace(
        /(?:第[一二三四五六七八九十]+版|新版|旧版)$/,
        ""
      )
      .trim();
  }

  function saveIgnoreKeywordRule(raw) {
    const suggested =
      suggestIgnoreKeyword(raw);

    const entered = window.prompt(
      "请输入稳定的无关关键词。\n" +
      "该关键词只会对已经拆分出的单项做包含判断，" +
      "不会作用于整段套餐名称。\n\n" +
      "例如填写“福利”，可忽略“年度福利、福利2”。",
      suggested || cleanText(raw)
    );

    if (entered === null) return;

    const keyword =
      cleanText(entered);

    const key =
      strictKey(keyword);

    if (!key) {
      showToast("无关关键词不能为空");
      return;
    }

    if (key.length < 2) {
      showToast("关键词过短，请至少输入两个字符");
      return;
    }

    const conflictingStandards =
      STANDARD_NAMES
        .filter(name =>
          strictKey(name)
            .includes(key)
        )
        .slice(0, 3);

    if (conflictingStandards.length) {
      showToast(
        "关键词可能覆盖标准危害，请换更具体的词：" +
        conflictingStandards.join("、")
      );
      return;
    }

    if (
      !userIgnoreKeywords.some(
        item =>
          strictKey(item) === key
      ) &&
      !CONFIG.builtinIgnoreKeywords.some(
        item =>
          strictKey(item) === key
      )
    ) {
      userIgnoreKeywords.push(
        keyword
      );
    }

    persistUserRules();

    showToast(
      `已保存无关关键词：${keyword}`
    );

    runCheck();
  }

  function removeAliasRule(alias) {
    const wantedKey = strictKey(alias);

    Object.keys(userAliasMap).forEach(savedAlias => {
      if (strictKey(savedAlias) === wantedKey) {
        delete userAliasMap[savedAlias];
      }
    });

    persistUserRules();
    runCheck();
  }

  function removeIgnoreRule(name) {
    userIgnoreTerms = userIgnoreTerms.filter(
      item => strictKey(item) !== strictKey(name)
    );
    persistUserRules();
    runCheck();
  }

  function removeIgnoreKeywordRule(keyword) {
    const wantedKey =
      strictKey(keyword);

    userIgnoreKeywords =
      userIgnoreKeywords.filter(
        item =>
          strictKey(item) !==
          wantedKey
      );

    persistUserRules();
    runCheck();
  }

  function formatAliasParameterLines() {
    return getPendingAliasEntries()
      .map(([alias, canonical]) =>
        `      ${JSON.stringify(alias)}: ${JSON.stringify(canonical)},`
      )
      .join("\n");
  }

  function formatIgnoreParameterLines() {
    return getPendingIgnoreEntries()
      .map(name => `      ${JSON.stringify(name)},`)
      .join("\n");
  }

  function formatIgnoreKeywordParameterLines() {
    return getPendingIgnoreKeywordEntries()
      .map(keyword =>
        `      ${JSON.stringify(keyword)},`
      )
      .join("\n");
  }

  function copyAliasParameters() {
    const text = formatAliasParameterLines();

    if (!text) {
      showToast("当前没有待写入脚本的新增匹配规则");
      return;
    }

    copyText(text);
  }

  function copyIgnoreParameters() {
    const text = formatIgnoreParameterLines();

    if (!text) {
      showToast("当前没有待写入脚本的新增无关内容");
      return;
    }

    copyText(text);
  }

  function copyIgnoreKeywordParameters() {
    const text =
      formatIgnoreKeywordParameterLines();

    if (!text) {
      showToast(
        "当前没有待写入脚本的新增无关关键词"
      );
      return;
    }

    copyText(text);
  }

  function populateMappingSelect(select, raw, query = "") {
    const suggestions = getSimilaritySuggestions(raw, query, 15);
    select.innerHTML = "";

    if (!suggestions.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "没有找到匹配候选";
      select.appendChild(option);
      return;
    }

    suggestions.forEach(item => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.score}%｜${item.name}`;
      select.appendChild(option);
    });
  }

  function renderMappingModule(entries) {
    if (!entries.length) return;

    const section = document.createElement("section");
    section.className = "mapping-module";
    section.dataset.resultSection = "names";

    const header = document.createElement("div");
    header.className = "mapping-module-header";
    header.innerHTML = `
      <span>名称处理｜匹配标准危害或标记无关</span>
      <span>${entries.length} 项</span>
    `;
    section.appendChild(header);

    const content = document.createElement("div");
    content.className = "mapping-module-content";

    entries.forEach(entry => {
      const card = document.createElement("div");
      card.className = "mapping-card";

      const name = document.createElement("div");
      name.className = "mapping-name";
      name.textContent = entry.raw;
      card.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "mapping-meta";
      const metaParts = [
        `涉及 ${entry.occurrences.length} 个套餐`
      ];

      if (entry.sameRawInCellCount) {
        metaParts.push(
          `${entry.sameRawInCellCount} 个套餐的危害栏也存在相同文字`
        );
      }

      if (entry.bestCandidate?.name) {
        metaParts.push(
          `最接近：${entry.bestCandidate.name}（${entry.bestCandidate.score}%）`
        );
      }

      meta.textContent = metaParts.join("；");
      card.appendChild(meta);

      const search = document.createElement("input");
      search.type = "text";
      search.className = "mapping-search";
      search.placeholder = "输入文字筛选标准危害名称";
      card.appendChild(search);

      const select = document.createElement("select");
      select.className = "mapping-select";
      populateMappingSelect(select, entry.raw);
      card.appendChild(select);

      let searchTimer = null;
      search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          populateMappingSelect(select, entry.raw, search.value);
        }, 120);
      });

      const actions = document.createElement("div");
      actions.className = "mapping-actions";

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "mapping-action mapping-save";
      saveButton.textContent = "保存为匹配";
      saveButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        saveAliasRule(entry.raw, select.value);
      });

      const ignoreButton = document.createElement("button");
      ignoreButton.type = "button";
      ignoreButton.className = "mapping-action mapping-ignore";
      ignoreButton.textContent = "精确无关";
      ignoreButton.title =
        "只忽略与当前名称完全一致的单项";
      ignoreButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        saveIgnoreRule(entry.raw);
      });

      const keywordIgnoreButton =
        document.createElement("button");

      keywordIgnoreButton.type =
        "button";

      keywordIgnoreButton.className =
        "mapping-action mapping-ignore-keyword";

      keywordIgnoreButton.textContent =
        "关键词无关";

      keywordIgnoreButton.title =
        "用稳定关键词覆盖多个相近的无关词组";

      keywordIgnoreButton.addEventListener(
        "click",
        event => {
          event.preventDefault();
          event.stopPropagation();

          saveIgnoreKeywordRule(
            entry.raw
          );
        }
      );

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "mapping-action mapping-copy";
      copyButton.textContent = "复制名称";
      copyButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        copyText(entry.raw);
      });

      actions.appendChild(saveButton);
      actions.appendChild(ignoreButton);
      actions.appendChild(
        keywordIgnoreButton
      );
      actions.appendChild(copyButton);
      card.appendChild(actions);
      content.appendChild(card);
    });

    section.appendChild(content);
    resultsBox.appendChild(section);
  }

  let activeReferencePanel = "";

  function makeRuleCodeRow(
    codeText,
    pending = false,
    removeHandler = null
  ) {
    const row = document.createElement("div");
    row.className = "rule-code-row";

    const codeNode = document.createElement("pre");
    codeNode.className = "rule-code-text";
    codeNode.textContent = codeText;
    row.appendChild(codeNode);

    if (pending) {
      const actions = document.createElement("span");
      actions.className = "rule-pending-actions";

      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "rule-badge";
      badge.textContent = "待写入脚本";
      badge.title = "点击复制这一条可直接写入脚本的参数";
      badge.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        copyText(codeText);
      });
      actions.appendChild(badge);

      if (typeof removeHandler === "function") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "rule-delete";
        remove.textContent = "删除";
        remove.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          removeHandler();
        });
        actions.appendChild(remove);
      }

      row.appendChild(actions);
    }

    return row;
  }

  function createReferencePanel(
    panelKey,
    title,
    countText,
    noteText
  ) {
    const panel = document.createElement("section");
    panel.className = "tool-reference-panel";
    panel.dataset.referencePanel = panelKey;

    const header = document.createElement("div");
    header.className = "tool-reference-panel-header";

    const titleNode = document.createElement("span");
    titleNode.textContent = title;

    const countNode = document.createElement("span");
    countNode.textContent = countText;

    header.appendChild(titleNode);
    header.appendChild(countNode);
    panel.appendChild(header);

    if (noteText) {
      const note = document.createElement("div");
      note.className = "tool-reference-panel-note";
      note.textContent = noteText;
      panel.appendChild(note);
    }

    const body = document.createElement("div");
    body.className = "tool-reference-panel-body";
    panel.appendChild(body);

    return { panel, body };
  }

  function updateReferencePanelVisibility() {
    referenceButtons.forEach(button => {
      const key = button.dataset.referencePanel;
      const active = key === activeReferencePanel;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-expanded", String(active));
    });

    referencePanelsBox
      .querySelectorAll(".tool-reference-panel")
      .forEach(panel => {
        panel.classList.toggle(
          "is-active",
          panel.dataset.referencePanel === activeReferencePanel
        );
      });
  }

  function renderRuleManager() {
    const aliasEntries = getAllAliasEntriesForDisplay();
    const exclusionEntries = getExclusionEntriesForDisplay();
    const ignoreEntries = getAllIgnoreEntriesForDisplay();
    const ignoreKeywordEntriesForDisplay =
      getAllIgnoreKeywordEntriesForDisplay();

    const pendingAliasCount =
      aliasEntries.filter(item => item.pending).length;
    const pendingIgnoreCount =
      ignoreEntries.filter(item => item.pending).length;
    const pendingIgnoreKeywordCount =
      ignoreKeywordEntriesForDisplay
        .filter(item => item.pending)
        .length;

    referencePanelsBox.innerHTML = "";

    const aliasPanel = createReferencePanel(
      "aliases",
      "匹配规则",
      `${aliasEntries.length} 条`,
      "内容按 builtinAliases 的脚本格式显示，可直接框选复制；右侧按钮只复制待写入脚本的新增规则。"
    );

    aliasEntries.forEach(item => {
      const codeText =
        `      ${JSON.stringify(item.alias)}: ` +
        `${JSON.stringify(item.canonical)},`;

      aliasPanel.body.appendChild(
        makeRuleCodeRow(
          codeText,
          item.pending,
          item.pending
            ? () => removeAliasRule(item.alias)
            : null
        )
      );
    });

    if (pendingAliasCount) {
      const actions = document.createElement("div");
      actions.className = "rule-export-actions";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "rule-export alias";
      button.textContent =
        `复制待写入脚本（${pendingAliasCount}）`;
      button.addEventListener("click", copyAliasParameters);

      actions.appendChild(button);
      aliasPanel.body.appendChild(actions);
    }

    referencePanelsBox.appendChild(aliasPanel.panel);


    const exclusionPanel = createReferencePanel(
      "exclusions",
      "排除项",
      `${exclusionEntries.length} 条`,
      "仅名称中含可识别在岗状态的套餐参与核对；状态简称会转换为系统标准状态。性别婚姻信息只作为元数据剥离。"
    );

    exclusionEntries.forEach(codeText => {
      exclusionPanel.body.appendChild(
        makeRuleCodeRow(codeText)
      );
    });

    referencePanelsBox.appendChild(exclusionPanel.panel);


    const ignorePanel = createReferencePanel(
      "ignores",
      "无关内容",
      `${ignoreEntries.length} 条`,
      "内容按 builtinIgnoreTerms 的脚本格式显示，可直接框选复制；右侧按钮只复制待写入脚本的新增内容。"
    );

    ignoreEntries.forEach(item => {
      const codeText = `      ${JSON.stringify(item.name)},`;

      ignorePanel.body.appendChild(
        makeRuleCodeRow(
          codeText,
          item.pending,
          item.pending
            ? () => removeIgnoreRule(item.name)
            : null
        )
      );
    });

    if (pendingIgnoreCount) {
      const actions = document.createElement("div");
      actions.className = "rule-export-actions";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "rule-export ignore";
      button.textContent =
        `复制待写入脚本（${pendingIgnoreCount}）`;
      button.addEventListener("click", copyIgnoreParameters);

      actions.appendChild(button);
      ignorePanel.body.appendChild(actions);
    }

    referencePanelsBox.appendChild(ignorePanel.panel);


    const ignoreKeywordPanel =
      createReferencePanel(
        "ignore-keywords",
        "无关关键词",
        `${ignoreKeywordEntriesForDisplay.length} 条`,
        "关键词只对拆分后的单项做包含判断。适合处理“福利/福利2/年度福利”等同类词组；不会对整段套餐名称做包含排除。"
      );

    ignoreKeywordEntriesForDisplay
      .forEach(item => {
        const codeText =
          `      ${JSON.stringify(item.keyword)},`;

        ignoreKeywordPanel.body.appendChild(
          makeRuleCodeRow(
            codeText,
            item.pending,
            item.pending
              ? () =>
                removeIgnoreKeywordRule(
                  item.keyword
                )
              : null
          )
        );
      });

    if (pendingIgnoreKeywordCount) {
      const actions =
        document.createElement("div");

      actions.className =
        "rule-export-actions";

      const button =
        document.createElement("button");

      button.type = "button";
      button.className =
        "rule-export ignore";

      button.textContent =
        `复制待写入脚本（${pendingIgnoreKeywordCount}）`;

      button.addEventListener(
        "click",
        copyIgnoreKeywordParameters
      );

      actions.appendChild(button);

      ignoreKeywordPanel.body.appendChild(
        actions
      );
    }

    referencePanelsBox.appendChild(
      ignoreKeywordPanel.panel
    );

    const buttonLabels = {
      aliases:
        `匹配规则 ${aliasEntries.length}` +
        (pendingAliasCount ? ` +${pendingAliasCount}` : ""),
      exclusions: `排除项 ${exclusionEntries.length}`,
      ignores:
        `无关内容 ${ignoreEntries.length}` +
        (pendingIgnoreCount ? ` +${pendingIgnoreCount}` : ""),
      "ignore-keywords":
        `无关关键词 ${ignoreKeywordEntriesForDisplay.length}` +
        (
          pendingIgnoreKeywordCount
            ? ` +${pendingIgnoreKeywordCount}`
            : ""
        )
    };

    referenceButtons.forEach(button => {
      button.textContent =
        buttonLabels[button.dataset.referencePanel] ||
        button.textContent;
    });

    updateReferencePanelVisibility();
  }


  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isVisibleElement(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  }

  async function waitUntil(check, timeout = 3500, interval = 60, description = "条件") {
    const startedAt = Date.now();
    let lastError = null;
    while (Date.now() - startedAt < timeout) {
      try {
        const result = check();
        if (result) return result;
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }
    const suffix = lastError ? `；最后错误：${lastError.message || lastError}` : "";
    throw new Error(`等待${description}超时${suffix}`);
  }

  function getElementZIndex(element) {
    let current = element;
    let highest = 0;
    while (current && current !== document.documentElement) {
      const value = Number.parseInt(getComputedStyle(current).zIndex, 10);
      if (Number.isFinite(value)) highest = Math.max(highest, value);
      current = current.parentElement;
    }
    return highest;
  }

  function getElementDistance(a, b) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return Math.hypot(
      ar.left + ar.width / 2 - (br.left + br.width / 2),
      ar.top + ar.height / 2 - (br.top + br.height / 2)
    );
  }

  function findVisibleEditDialogs() {
    const roots = [
      ...document.querySelectorAll(".el-dialog__wrapper"),
      ...document.querySelectorAll(".el-dialog")
    ].filter(isVisibleElement);

    return [...new Set(roots.map(root =>
      root.matches(".el-dialog") ? root : root.querySelector(".el-dialog") || root
    ))].filter(dialog => {
      if (!isVisibleElement(dialog)) return false;
      const title = cleanText(
        dialog.querySelector(".el-dialog__title")?.innerText ||
        dialog.querySelector(".el-dialog__header")?.innerText || ""
      );
      return strictKey(title).includes(strictKey("编辑套餐信息"));
    });
  }

  function findDialogFormItem(dialog, aliases) {
    const wanted = aliases.map(strictKey);
    return [...dialog.querySelectorAll(".el-form-item")].find(item => {
      const label = strictKey(
        item.querySelector(":scope > .el-form-item__label")?.innerText ||
        item.querySelector(".el-form-item__label")?.innerText || ""
      );
      return wanted.some(name => label === name || label.includes(name));
    }) || null;
  }

  function readDialogField(dialog, aliases) {
    const item = findDialogFormItem(dialog, aliases);
    if (!item) return "";
    const input = [...item.querySelectorAll("input:not([type='hidden']), textarea")]
      .find(element => cleanText(element.value)) ||
      item.querySelector("input:not([type='hidden']), textarea");
    return cleanText(input?.value || item.querySelector(".el-form-item__content")?.innerText || "");
  }

  function getTagText(tag) {
    const clone = tag.cloneNode(true);
    clone.querySelectorAll(".el-tag__close, .el-icon-close, button").forEach(element => element.remove());
    return cleanText(clone.innerText || clone.textContent);
  }

  function getDialogHazardItem(dialog) {
    return findDialogFormItem(dialog, ["危害因素"]);
  }

  function getDialogSelectedHazards(dialog) {
    const item = getDialogHazardItem(dialog);
    if (!item) return [];

    const names = [
      ...[...item.querySelectorAll(".el-tag")].map(getTagText),
      ...[...item.querySelectorAll(".vue-treeselect__multi-value-label")]
        .map(label => cleanText(label.innerText || label.textContent))
    ].filter(Boolean);

    return uniqueHazards([...new Set(names)]);
  }

  function isHazardAlreadySelected(dialog, name) {
    return getDialogSelectedHazards(dialog)
      .some(selected => matchHazards(name, selected.raw).matched);
  }

  function getDialogCurrentStage(dialog) {
    return readDialogField(dialog, ["在岗状态"]);
  }

  function getDialogMissingContext(dialog) {
    const code = readDialogField(dialog, ["套餐编码"]);
    const packageName = readDialogField(dialog, ["套餐名称"]);
    const codeKey = strictKey(code);
    const mismatch = codeKey ? latestMismatchByCode.get(codeKey) : null;

    /*
     * 编辑弹窗与外部列表核对统一使用同一套状态识别。
     *
     * 旧逻辑只读取名称末尾的状态，因此无法识别：
     *   在岗期间（男士）
     *   在岗期间（已婚女）
     *   噪声+在岗期间（男士）-男
     *
     * 新逻辑会从套餐名称任意位置识别状态，
     * 并转换为网页标准在岗状态。
     */
    const stageInfo =
      detectPackageStageInfo(
        packageName
      );

    const rawStage =
      stageInfo.raw ||
      (
        stageInfo.conflicts?.length
          ? stageInfo.conflicts
              .map(item => item.raw)
              .join(" / ")
          : ""
      );

    const expectedStage =
      stageInfo.conflicts?.length
        ? ""
        : stageInfo.canonical;

    const currentStage =
      getDialogCurrentStage(dialog);

    const stagePending = Boolean(
      expectedStage &&
      !cleanText(currentStage)
    );

    const stageConflict = Boolean(
      expectedStage &&
      cleanText(currentStage) &&
      strictKey(currentStage) !== strictKey(expectedStage)
    );

    const stageMatched = Boolean(
      expectedStage &&
      cleanText(currentStage) &&
      strictKey(currentStage) === strictKey(expectedStage)
    );

    let pending = [];
    let hazardNotice = "";

    if (!hasRunCheck) {
      hazardNotice = "危害因素尚未核对；需要补齐危害时，请先点击“开始核对”";
    } else if (mismatch) {
      pending = mismatch.missing.filter(hazard =>
        !isHazardAlreadySelected(dialog, hazard.canonical)
      );
    } else {
      hazardNotice = "该套餐没有检测到标准危害缺失";
    }

    return {
      code,
      packageName,
      mismatch,
      pending,
      rawStage,
      expectedStage,
      currentStage,
      stagePending,
      stageConflict,
      stageMatched,
      hazardNotice,
      canRun: pending.length > 0 || stagePending
    };
  }

  function setAutoPanelType(panel, type = "normal") {
    panel.classList.remove("is-warning", "is-success", "is-error");
    if (type !== "normal") panel.classList.add(`is-${type}`);
  }

  function renderAutoPanel(dialog, panel) {
    if (!panel || panel.dataset.busy === "1") return;

    const context = getDialogMissingContext(dialog);
    const title = panel.querySelector(".autofill-title");
    const list = panel.querySelector(".autofill-list");
    const button = panel.querySelector(".autofill-action");
    const status = panel.querySelector(".autofill-status");

    title.innerHTML = `按套餐编码自动补齐：<span class="autofill-code"></span>`;
    title.querySelector(".autofill-code").textContent =
      context.code || "未读取";

    list.innerHTML = "";

    for (const hazard of context.pending) {
      const tag = document.createElement("span");
      tag.className = "autofill-name";
      tag.textContent = hazard.canonical;
      list.appendChild(tag);
    }

    if (context.stagePending) {
      const tag = document.createElement("span");
      tag.className = "autofill-name is-stage";
      tag.textContent = `在岗状态：${context.expectedStage}`;
      list.appendChild(tag);
    }

    if (context.stageConflict) {
      const tag = document.createElement("span");
      tag.className = "autofill-name is-conflict";
      tag.textContent =
        `状态冲突：当前“${context.currentStage}”／套餐“${context.expectedStage}”`;
      list.appendChild(tag);
    }

    if (context.canRun) {
      setAutoPanelType(panel, "normal");
      button.disabled = false;

      const tasks = [];
      if (context.pending.length) {
        tasks.push(`危害 ${context.pending.length}`);
      }
      if (context.stagePending) {
        tasks.push("状态 1");
      }

      button.textContent = `一键补齐（${tasks.join(" + ")}）`;

      const messages = [];
      if (context.pending.length) {
        messages.push(
          "危害因素将按“输入标准名称 → ↓ → Enter”逐项选择"
        );
      }
      if (context.stagePending) {
        messages.push(
          `在岗状态将根据套餐名称选择为“${context.expectedStage}”`
        );
      }
      if (context.hazardNotice && !context.pending.length) {
        messages.push(context.hazardNotice);
      }

      status.textContent =
        messages.join("；") + "；不会自动点击“确定”。";
      return;
    }

    button.disabled = true;

    if (context.stageConflict) {
      setAutoPanelType(panel, "warning");
      button.textContent = "在岗状态需人工确认";
      status.textContent =
        `套餐名称解析为“${context.expectedStage}”，` +
        `但当前已选择“${context.currentStage}”。` +
        "为避免覆盖已有数据，脚本不会自动修改。";
      return;
    }

    if (!context.packageName) {
      setAutoPanelType(panel, "warning");
      button.textContent = "暂无可补齐项目";
      status.textContent = "没有读取到套餐名称";
      return;
    }

    if (!context.expectedStage && context.rawStage) {
      setAutoPanelType(panel, "warning");
      button.textContent = "状态名称需人工确认";
      status.textContent =
        `套餐名称中的检查阶段“${context.rawStage}”` +
        "没有对应到当前在岗状态选项。";
      return;
    }

    if (!hasRunCheck) {
      setAutoPanelType(panel, context.stageMatched ? "success" : "warning");
      button.textContent = context.stageMatched
        ? "在岗状态已匹配"
        : "请先开始核对";
      status.textContent = context.stageMatched
        ? `在岗状态已是“${context.currentStage}”；危害因素需要先运行核对。`
        : context.hazardNotice;
      return;
    }

    setAutoPanelType(panel, "success");
    button.textContent = "无需补齐";
    status.textContent = context.stageMatched
      ? `标准危害无缺失，在岗状态已是“${context.currentStage}”。`
      : context.expectedStage
        ? `标准危害无缺失；在岗状态当前为“${context.currentStage || "未选择"}”。`
        : "标准危害无缺失，套餐名称未识别到可自动设置的在岗状态。";
  }

  function ensureAutoPanel(dialog) {
    const hazardItem = getDialogHazardItem(dialog);
    if (!hazardItem) return;
    const content = hazardItem.querySelector(":scope > .el-form-item__content") ||
      hazardItem.querySelector(".el-form-item__content");
    if (!content) return;

    let panel = content.querySelector(":scope > ." + AUTO_PANEL_CLASS);
    if (!panel) {
      panel = document.createElement("div");
      panel.className = AUTO_PANEL_CLASS;
      panel.innerHTML = `
        <div class="autofill-title"></div>
        <div class="autofill-list"></div>
        <button class="autofill-action" type="button">一键补齐缺失危害</button>
        <div class="autofill-status"></div>
      `;
      panel.querySelector(".autofill-action").addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        fillCurrentDialogMissing(dialog, panel);
      });
      content.appendChild(panel);
    }
    renderAutoPanel(dialog, panel);
  }

  function enhanceVisibleEditDialogs() {
    if (destroyed) return;
    findVisibleEditDialogs().forEach(ensureAutoPanel);
  }

  function scheduleEnhanceDialogs() {
    if (destroyed) return;
    clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(enhanceVisibleEditDialogs, 80);
  }

  function findVueTreeselectInstance(root, input) {
    const domCandidates = [];
    let current = input || root;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      domCandidates.push(
        current.__vue__,
        current.__vueParentComponent?.proxy
      );
    }
    domCandidates.push(
      root?.__vue__,
      input?.__vue__,
      root?.__vueParentComponent?.proxy,
      input?.__vueParentComponent?.proxy
    );

    const directCandidates = [...new Set(domCandidates.filter(Boolean))];

    const looksLikeTreeselect = vm => !!vm && (
      vm.$options?.name === "vue-treeselect" ||
      vm.$options?._componentTag === "treeselect" ||
      (
        vm.trigger && "searchQuery" in vm.trigger &&
        vm.menu && "current" in vm.menu &&
        vm.forest?.nodeMap &&
        typeof vm.select === "function"
      ) ||
      vm.$el?.classList?.contains("vue-treeselect")
    );

    const belongsToTarget = vm => {
      const element = vm?.$el;
      if (!element || !root) return true;
      return element === root ||
        element.contains?.(input) ||
        root.contains?.(element);
    };

    for (const vm of directCandidates) {
      if (looksLikeTreeselect(vm) && belongsToTarget(vm)) return vm;
    }

    const visited = new Set();
    const queue = [...directCandidates];
    while (queue.length) {
      const vm = queue.shift();
      if (!vm || visited.has(vm)) continue;
      visited.add(vm);

      if (looksLikeTreeselect(vm) && belongsToTarget(vm)) return vm;

      if (Array.isArray(vm.$children)) queue.push(...vm.$children);
      if (vm.$parent) queue.push(vm.$parent);
      if (visited.size > 240) break;
    }

    return null;
  }

  function getHazardSelectContext(dialog) {
    const item = getDialogHazardItem(dialog);
    if (!item) throw new Error("找不到“危害因素”字段");

    const treeselect = item.querySelector(".vue-treeselect");
    if (treeselect) {
      const input = treeselect.querySelector("input.vue-treeselect__input:not([readonly])");
      if (!input) throw new Error("找不到 Vue Treeselect 危害因素搜索输入框");
      const trigger = treeselect.querySelector(".vue-treeselect__control") ||
        treeselect.querySelector(".vue-treeselect__value-container") || treeselect;
      return {
        type: "treeselect",
        item,
        select: treeselect,
        trigger,
        input,
        vueInstance: findVueTreeselectInstance(treeselect, input)
      };
    }

    const select = item.querySelector(".el-select") || item.querySelector(".el-input") || item;
    const candidates = [
      ...item.querySelectorAll("input.el-select__input:not([readonly]), input[type='text']:not([readonly])")
    ];
    const input = candidates.find(isVisibleElement) || candidates[0];
    if (!input) throw new Error("找不到危害因素搜索输入框");
    return { type: "element-select", item, select, trigger: select, input, vueInstance: null };
  }

  function setNativeInputValue(input, value, inputType = "insertText") {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, String(value));
    else input.value = String(value);

    let inputEvent;
    try {
      inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: false,
        composed: true,
        data: String(value),
        inputType
      });
    } catch (_) {
      inputEvent = new Event("input", { bubbles: true, composed: true });
    }
    input.dispatchEvent(inputEvent);
  }

  function dispatchFocusSequence(input) {
    input.focus({ preventScroll: true });
    input.dispatchEvent(new FocusEvent("focus", { bubbles: false, composed: true }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
  }

  function createKeyboardEvent(type, key, keyCode) {
    const options = {
      key,
      code: key === "ArrowDown" ? "ArrowDown" : key === "ArrowUp" ? "ArrowUp" : key === "Enter" ? "Enter" : key,
      keyCode,
      which: keyCode,
      charCode: type === "keypress" ? keyCode : 0,
      bubbles: true,
      cancelable: true,
      composed: true,
      repeat: false,
      location: 0
    };
    const event = new KeyboardEvent(type, options);

    // Chromium 会把旧版 keyCode/which 固定成 0，而 Vue 2 的按键修饰符
    // 以及部分旧版 Treeselect 会读取这些字段，因此显式补齐。
    for (const property of ["keyCode", "which", "charCode"]) {
      try {
        Object.defineProperty(event, property, {
          configurable: true,
          get: () => property === "charCode" && type !== "keypress" ? 0 : keyCode
        });
      } catch (_) {}
    }
    return event;
  }

  function dispatchKey(input, key, keyCode) {
    if (!input) return;
    input.focus({ preventScroll: true });

    // 真实键盘事件会从 input 冒泡到 Treeselect 根节点。
    // 这里只向真实输入框派发，避免在多个节点重复触发导致菜单指针跳两次。
    input.dispatchEvent(createKeyboardEvent("keydown", key, keyCode));
    if (key === "Enter") {
      input.dispatchEvent(createKeyboardEvent("keypress", key, keyCode));
    }
    input.dispatchEvent(createKeyboardEvent("keyup", key, keyCode));
  }

  function getTreeselectSearchQuery(vm) {
    if (!vm) return "";
    if (vm.trigger && "searchQuery" in vm.trigger) return String(vm.trigger.searchQuery || "");
    if ("searchQuery" in vm) return String(vm.searchQuery || "");
    return "";
  }

  function setTreeselectSearchQuery(vm, value) {
    if (!vm) return false;
    const text = String(value ?? "");

    try {
      if (vm.trigger && "searchQuery" in vm.trigger) {
        vm.trigger.searchQuery = text;
        return true;
      }
      if ("searchQuery" in vm) {
        vm.searchQuery = text;
        return true;
      }
    } catch (_) {}

    return false;
  }

  async function nextVueTick(vm) {
    if (!vm || typeof vm.$nextTick !== "function") return;
    try {
      await new Promise(resolve => vm.$nextTick(resolve));
    } catch (_) {}
  }


  function getTreeselectSearchState(context, wantedValue = "") {
    const wantedKey = strictKey(wantedValue);
    const inputValue = cleanText(context?.input?.value || "");
    const searchQuery = cleanText(getTreeselectSearchQuery(context?.vueInstance));
    const sizerValue = cleanText(
      context?.select?.querySelector(".vue-treeselect__sizer")?.textContent || ""
    );
    const menu = context?.select?.querySelector(".vue-treeselect__menu-container");
    const optionCount = menu?.querySelectorAll(
      ".vue-treeselect__option, .vue-treeselect__list-item"
    ).length || 0;
    const menuTextLength = cleanText(menu?.innerText || "").length;
    const isOpen = Boolean(
      context?.select?.classList?.contains("vue-treeselect--open") ||
      context?.vueInstance?.menu?.isOpen ||
      isVisibleElement(menu)
    );
    const synced = !wantedKey || [inputValue, searchQuery, sizerValue]
      .some(value => strictKey(value) === wantedKey);
    const resultReady = optionCount > 0;

    return {
      inputValue,
      searchQuery,
      sizerValue,
      isOpen,
      synced,
      resultReady,
      optionCount,
      signature: [
        strictKey(inputValue),
        strictKey(searchQuery),
        strictKey(sizerValue),
        isOpen ? "1" : "0",
        optionCount,
        menuTextLength,
        context?.select?.querySelectorAll(".vue-treeselect__multi-value-label").length || 0
      ].join("|")
    };
  }

  async function waitForTreeselectQuerySync(dialog, wantedValue, timeout = 1800) {
    const wantedKey = strictKey(wantedValue);
    return await waitUntil(() => {
      const fresh = getHazardSelectContext(dialog);
      if (fresh.type !== "treeselect") return false;
      const state = getTreeselectSearchState(fresh, wantedValue);
      if (wantedKey) return state.synced ? fresh : false;
      return !state.inputValue && !state.searchQuery && !state.sizerValue ? fresh : false;
    }, timeout, 40, `危害搜索词“${wantedValue || "空"}”同步`);
  }

  async function waitForTreeselectSearchSettled(dialog, name, updateStep) {
    const startedAt = Date.now();
    let previousSignature = "";
    let stableSince = startedAt;
    let lastState = null;

    updateStep?.(`步骤 2/3：智能等待搜索状态稳定\n${name}`);

    while (Date.now() - startedAt < AUTOFILL_TIMING.searchTimeout) {
      const fresh = getHazardSelectContext(dialog);
      if (fresh.type !== "treeselect") return fresh;

      const state = getTreeselectSearchState(fresh, name);
      lastState = state;

      if (state.signature !== previousSignature) {
        previousSignature = state.signature;
        stableSince = Date.now();
      }

      // 只确认搜索词已进入组件并且状态停止变化；不识别具体候选项。
      if (
        state.synced &&
        state.resultReady &&
        Date.now() - stableSince >= AUTOFILL_TIMING.searchStableMs
      ) {
        return fresh;
      }

      await sleep(40);
    }

    // 页面已同步搜索词，但菜单结构无法被通用规则识别时，超时后仍继续执行，避免再次卡死。
    if (lastState?.synced) {
      console.warn(`[危害补齐] “${name}”搜索状态未完全静止，按已同步状态继续执行`);
      return getHazardSelectContext(dialog);
    }

    throw new Error(`危害名称“${name}”没有同步进入搜索组件`);
  }

  function watchTreeselectActivity(root) {
    const state = {
      mutations: 0,
      lastActivityAt: Date.now(),
      stop() {}
    };

    if (!root || typeof MutationObserver !== "function") return state;

    const observer = new MutationObserver(() => {
      state.mutations++;
      state.lastActivityAt = Date.now();
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    state.stop = () => observer.disconnect();
    return state;
  }

  function hasTreeselectHighlight(context) {
    const current = context?.vueInstance?.menu?.current;
    if (current !== null && current !== undefined && current !== "") return true;

    return Boolean(context?.select?.querySelector(
      ".vue-treeselect__option--highlight, " +
      ".vue-treeselect__option--highlighted, " +
      ".vue-treeselect__option--focused, " +
      ".vue-treeselect__list-item--highlight, " +
      ".vue-treeselect__list-item--focused"
    ));
  }

  async function waitForArrowDownHandled(dialog, activity) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < AUTOFILL_TIMING.arrowTimeout) {
      const fresh = getHazardSelectContext(dialog);
      if (fresh.type !== "treeselect") return fresh;

      const quietFor = Date.now() - activity.lastActivityAt;
      const highlighted = hasTreeselectHighlight(fresh);
      const elapsed = Date.now() - startedAt;

      if (
        quietFor >= AUTOFILL_TIMING.arrowStableMs &&
        (highlighted || activity.mutations > 0 || elapsed >= 220)
      ) {
        return fresh;
      }

      await sleep(35);
    }

    return getHazardSelectContext(dialog);
  }

  async function clearHazardSearchAndWait(dialog) {
    const fresh = getHazardSelectContext(dialog);

    if (fresh.type === "treeselect" && fresh.vueInstance) {
      await updateTreeselectSearchThroughVm(fresh, "");
      try {
        await waitForTreeselectQuerySync(dialog, "", AUTOFILL_TIMING.nextItemTimeout);
      } catch (_) {}
      return;
    }

    setNativeInputValue(fresh.input, "", "deleteContentBackward");
    fresh.input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    try {
      await waitUntil(
        () => cleanText(getHazardSelectContext(dialog).input.value) === "",
        AUTOFILL_TIMING.nextItemTimeout,
        40,
        "危害搜索框清空"
      );
    } catch (_) {}
  }

  async function waitForNextHazardReady(dialog, selectedName) {
    await waitUntil(
      () => isHazardAlreadySelected(dialog, selectedName),
      AUTOFILL_TIMING.selectionTimeout,
      40,
      `“${selectedName}”标签生成`
    );

    await clearHazardSearchAndWait(dialog);

    // 标签已生成、搜索词已清空即表示下一项可以开始，不再使用固定间隔。
    return true;
  }


  function getDialogStateSignature(dialog) {
    const hazards = getDialogSelectedHazards(dialog)
      .map(item => strictKey(item.canonical || item.raw))
      .filter(Boolean)
      .sort();

    return [
      strictKey(readDialogField(dialog, ["套餐编码"])),
      strictKey(readDialogField(dialog, ["套餐名称"])),
      strictKey(getDialogCurrentStage(dialog)),
      hazards.join("|")
    ].join("::");
  }

  async function waitForDialogSnapshotStable(
    dialog,
    stableMs = 500,
    timeout = 6000
  ) {
    const startedAt = Date.now();
    let lastSignature = "";
    let stableSince = 0;

    while (Date.now() - startedAt < timeout) {
      if (
        !dialog?.isConnected ||
        !isVisibleElement(dialog)
      ) {
        throw new Error("编辑弹窗在等待数据稳定时已关闭");
      }

      const signature = getDialogStateSignature(dialog);

      if (signature === lastSignature) {
        if (!stableSince) stableSince = Date.now();

        if (Date.now() - stableSince >= stableMs) {
          return signature;
        }
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }

      await sleep(70);
    }

    throw new Error("等待编辑弹窗数据稳定超时");
  }

  async function waitForDialogRequirementsStable(
    dialog,
    expectedHazards = [],
    expectedStage = "",
    stableMs = BATCH_RELIABILITY.beforeSubmitStableMs,
    timeout = 9000
  ) {
    const startedAt = Date.now();
    let lastSignature = "";
    let stableSince = 0;

    while (Date.now() - startedAt < timeout) {
      if (
        !dialog?.isConnected ||
        !isVisibleElement(dialog)
      ) {
        throw new Error("编辑弹窗在复核数据时已关闭");
      }

      const hazardsReady = expectedHazards.every(name =>
        isHazardAlreadySelected(dialog, name)
      );

      const stageReady =
        !expectedStage ||
        strictKey(getDialogCurrentStage(dialog)) ===
          strictKey(expectedStage);

      const signature = getDialogStateSignature(dialog);

      if (
        hazardsReady &&
        stageReady &&
        signature === lastSignature
      ) {
        if (!stableSince) stableSince = Date.now();

        if (Date.now() - stableSince >= stableMs) {
          return true;
        }
      } else {
        lastSignature = signature;
        stableSince =
          hazardsReady && stageReady ? Date.now() : 0;
      }

      await sleep(70);
    }

    const missing = expectedHazards.filter(name =>
      !isHazardAlreadySelected(dialog, name)
    );

    throw new Error(
      [
        "等待表单数据稳定超时",
        missing.length
          ? `仍未稳定选中：${missing.join("、")}`
          : "",
        expectedStage &&
        strictKey(getDialogCurrentStage(dialog)) !==
          strictKey(expectedStage)
          ? `岗位状态尚未稳定为“${expectedStage}”`
          : ""
      ].filter(Boolean).join("；")
    );
  }

  async function commitDialogStateBeforeSubmit(
    dialog,
    expectedHazards,
    expectedStage,
    updateStep,
    stableMs = BATCH_RELIABILITY.beforeSubmitStableMs
  ) {
    updateStep?.("正在等待页面内部数据稳定，暂不点击确定……");

    try {
      await clearHazardSearchAndWait(dialog);
    } catch (_) {}

    try {
      const hazardContext = getHazardSelectContext(dialog);
      hazardContext.input?.dispatchEvent(
        new Event("change", {
          bubbles: true,
          composed: true
        })
      );
      hazardContext.input?.blur?.();
      await nextVueTick(hazardContext.vueInstance);
    } catch (_) {}

    try {
      const stageContext =
        getDialogStageSelectContext(dialog);
      stageContext.input?.dispatchEvent(
        new Event("change", {
          bubbles: true,
          composed: true
        })
      );
      stageContext.input?.blur?.();
    } catch (_) {}

    await waitForDialogRequirementsStable(
      dialog,
      expectedHazards,
      expectedStage,
      stableMs,
      Math.max(10000, stableMs + 7000)
    );

    // 再留一个短缓冲，让 Vue 表单模型和保存参数完全同步。
    await sleep(300);
  }


  // 取得 Vue Treeselect 自己的输入子组件。
  // 用户提供的页面中，该实例名称为 vue-treeselect--input，
  // 并公开 updateSearchQuery()、onInput()、onKeyDown()。
  function getTreeselectInputVm(context) {
    const rootVm = context?.vueInstance;
    const candidates = [
      context?.input?.parentElement?.__vue__,
      context?.input?.closest?.(".vue-treeselect__input-container")?.__vue__,
      rootVm?.getInput?.(),
      rootVm?.$refs?.control?.$refs?.["value-container"]?.$refs?.input,
      context?.input?.__vue__
    ].filter(Boolean);

    return [...new Set(candidates)].find(vm =>
      typeof vm.updateSearchQuery === "function" ||
      typeof vm.onInput === "function" ||
      typeof vm.onKeyDown === "function"
    ) || null;
  }




  async function updateTreeselectSearchThroughVm(context, value) {
    const rootVm = context.vueInstance;
    const inputVm = getTreeselectInputVm(context);
    const text = String(value ?? "");

    if (!rootVm || !inputVm) return false;

    try {
      rootVm.openMenu?.();
      rootVm.focusInput?.();
    } catch (_) {}

    try {
      if ("value" in inputVm) inputVm.value = text;
      if (typeof inputVm.updateSearchQuery === "function") {
        inputVm.updateSearchQuery(text);
      } else if (typeof inputVm.onInput === "function") {
        setNativeInputValue(context.input, text, text ? "insertText" : "deleteContentBackward");
        inputVm.onInput({ target: context.input, currentTarget: context.input });
      } else {
        setTreeselectSearchQuery(rootVm, text);
      }
    } catch (_) {
      setTreeselectSearchQuery(rootVm, text);
    }

    // 同步可视输入框。这里不使用固定 sleep，后续由状态判定函数确认同步完成。
    setNativeInputValue(context.input, text, text ? "insertText" : "deleteContentBackward");
    try { inputVm.$forceUpdate?.(); } catch (_) {}
    try { rootVm.$forceUpdate?.(); } catch (_) {}

    await nextVueTick(inputVm);
    await nextVueTick(rootVm);
    return true;
  }







  function getTreeselectMenu(context) {
    return (
      context?.select?.querySelector(
        ".vue-treeselect__menu-container"
      ) ||
      context?.select?.querySelector(
        ".vue-treeselect__menu"
      )
    );
  }

  function isSelectableTreeselectOption(option) {
    if (!option || !isVisibleElement(option)) return false;

    if (
      option.classList.contains(
        "vue-treeselect__option--disabled"
      ) ||
      option.getAttribute("aria-disabled") === "true"
    ) {
      return false;
    }

    const text = getOptionText(option);
    if (!text) return false;

    // 大分类本身通常只有展开箭头，不是可选危害。
    const isParent =
      option.classList.contains(
        "vue-treeselect__option--parent-node"
      ) ||
      option.classList.contains(
        "vue-treeselect__option--parent"
      );

    const explicitlySelectable =
      option.classList.contains(
        "vue-treeselect__option--selectable"
      ) ||
      Boolean(
        option.querySelector(
          ".vue-treeselect__checkbox-container, " +
          ".vue-treeselect__checkbox"
        )
      );

    return !isParent || explicitlySelectable;
  }

  function getVisibleTreeselectOptions(context) {
    const menu = getTreeselectMenu(context);
    if (!menu) return [];

    const options = [
      ...menu.querySelectorAll(
        ".vue-treeselect__option"
      )
    ]
      .filter(isSelectableTreeselectOption);

    return [...new Set(options)];
  }

  function getTreeselectCurrentNodeLabel(context) {
    const vm = context?.vueInstance;
    const current = vm?.menu?.current;

    if (
      current &&
      typeof current === "object"
    ) {
      return cleanText(
        current.label ||
        current.raw?.label ||
        current.raw?.name ||
        ""
      );
    }

    if (
      current !== null &&
      current !== undefined &&
      current !== ""
    ) {
      const node =
        vm?.forest?.nodeMap?.[current];

      if (node) {
        return cleanText(
          node.label ||
          node.raw?.label ||
          node.raw?.name ||
          ""
        );
      }
    }

    return "";
  }

  function getHighlightedTreeselectOption(context) {
    const menu = getTreeselectMenu(context);
    if (!menu) return null;

    return menu.querySelector(
      ".vue-treeselect__option--highlight, " +
      ".vue-treeselect__option--highlighted, " +
      ".vue-treeselect__option--focused, " +
      ".vue-treeselect__list-item--highlight " +
        ".vue-treeselect__option, " +
      ".vue-treeselect__list-item--focused " +
        ".vue-treeselect__option, " +
      ".vue-treeselect__option[aria-selected='true']"
    );
  }

  function getHighlightedTreeselectLabel(context) {
    return (
      getTreeselectCurrentNodeLabel(context) ||
      getOptionText(
        getHighlightedTreeselectOption(context)
      )
    );
  }

  function inspectTreeselectCandidates(context, name) {
    const wantedKey = strictKey(name);

    const candidates =
      getVisibleTreeselectOptions(context)
        .map(option => ({
          option,
          text: getOptionText(option)
        }))
        .filter(item => item.text);

    const exactCandidates =
      candidates.filter(item =>
        strictKey(item.text) === wantedKey
      );

    const compatibleCandidates =
      candidates.filter(item =>
        matchHazards(name, item.text).matched
      );

    return {
      candidates,
      exactCandidates,
      compatibleCandidates
    };
  }

  async function moveTreeselectHighlightToTarget(
    dialog,
    name,
    updateStep
  ) {
    let fresh = getHazardSelectContext(dialog);
    const inspection =
      inspectTreeselectCandidates(fresh, name);

    const targetCandidates =
      inspection.exactCandidates.length
        ? inspection.exactCandidates
        : inspection.compatibleCandidates;

    if (targetCandidates.length !== 1) {
      if (
        inspection.candidates.length === 1 &&
        targetCandidates.length === 0
      ) {
        throw new Error(
          `搜索结果只有“${inspection.candidates[0].text}”，` +
          `与目标“${name}”不一致`
        );
      }

      if (inspection.candidates.length > 1) {
        const preview = inspection.candidates
          .slice(0, 6)
          .map(item => item.text)
          .join("、");

        throw new Error(
          targetCandidates.length > 1
            ? `搜索结果中存在多个同名候选“${name}”，无法安全选择`
            : `搜索结果中没有完全一致的“${name}”；当前候选：${preview}`
        );
      }

      // 个别页面版本可能无法读取候选 DOM。
      // 此时保留原来的键盘兼容路径，但只允许旧流程尝试一次。
      return {
        context: fresh,
        mode: "legacy-fallback",
        moves: 1
      };
    }

    const maximumMoves = Math.min(
      AUTOFILL_TIMING.exactCandidateMaxMoves,
      Math.max(
        inspection.candidates.length + 3,
        4
      )
    );

    for (
      let moveIndex = 1;
      moveIndex <= maximumMoves;
      moveIndex++
    ) {
      fresh = getHazardSelectContext(dialog);
      let input = fresh.input;

      try {
        input.focus({ preventScroll: true });
      } catch (_) {
        input.focus();
      }

      const activity =
        watchTreeselectActivity(fresh.select);

      updateStep?.(
        `步骤 3/3：定位精确候选 ${moveIndex}/${maximumMoves}\n` +
        `${name}`
      );

      dispatchKey(input, "ArrowDown", 40);

      try {
        fresh = await waitForArrowDownHandled(
          dialog,
          activity
        );
      } finally {
        activity.stop();
      }

      const highlighted =
        getHighlightedTreeselectLabel(fresh);

      console.log(
        `[危害补齐-精确定位] ${name}：第 ${moveIndex} 次 ↓`,
        {
          highlighted,
          candidates:
            inspection.candidates.map(
              item => item.text
            )
        }
      );

      if (
        strictKey(highlighted) === strictKey(name) ||
        matchHazards(name, highlighted).matched
      ) {
        return {
          context: fresh,
          mode: "exact-keyboard",
          moves: moveIndex,
          highlighted
        };
      }
    }

    throw new Error(
      `已逐项移动 ${maximumMoves} 次，仍未定位到精确候选“${name}”`
    );
  }


  async function pressRealTreeselectEnter(
    dialog,
    context,
    name,
    updateStep
  ) {
    let fresh =
      await waitForTreeselectSearchSettled(
        dialog,
        name,
        updateStep
      );

    if (fresh.type !== "treeselect") {
      return false;
    }

    let input = fresh.input;
    try {
      input.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    } catch (_) {}

    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      input.focus();
    }

    const location =
      await moveTreeselectHighlightToTarget(
        dialog,
        name,
        updateStep
      );

    fresh = location.context;
    input = fresh.input;

    // 候选 DOM 无法读取时，兼容旧页面：仅执行一次 ↓。
    if (location.mode === "legacy-fallback") {
      const activity =
        watchTreeselectActivity(fresh.select);

      updateStep?.(
        `步骤 3/3：候选结构不可读，兼容按一次 ↓\n${name}`
      );
      dispatchKey(input, "ArrowDown", 40);

      try {
        fresh = await waitForArrowDownHandled(
          dialog,
          activity
        );
      } finally {
        activity.stop();
      }

      input = fresh.input;
    }

    try {
      input.focus({ preventScroll: true });
    } catch (_) {
      input.focus();
    }

    updateStep?.(
      location.mode === "exact-keyboard"
        ? `步骤 3/3：已定位“${location.highlighted}”，按 Enter`
        : `步骤 3/3：按 Enter\n${name}`
    );

    dispatchKey(input, "Enter", 13);

    console.log(
      `[危害补齐-精确↓Enter] ${name}：已派发 Enter`,
      {
        mode: location.mode,
        moves: location.moves,
        highlighted: location.highlighted || "",
        inputValue: input.value,
        searchQuery:
          getTreeselectSearchQuery(
            fresh.vueInstance
          ),
        inputConnected: input.isConnected
      }
    );

    const selected =
      await waitForHazardSelected(
        dialog,
        name,
        AUTOFILL_TIMING.selectionTimeout
      );

    if (selected) {
      console.log(
        `[危害补齐-精确↓Enter] ${name}：选中成功`
      );
      return true;
    }

    console.warn(
      `[危害补齐-精确↓Enter] ${name}：` +
      "已按回车，但目标标签没有生成"
    );
    return false;
  }

  async function selectTreeselectByOwnEnterHandler(dialog, context, name, updateStep) {
    try {
      return await pressRealTreeselectEnter(dialog, context, name, updateStep);
    } catch (error) {
      console.warn(`[危害补齐] “${name}”执行 ↓ + Enter 失败：`, error);
      return false;
    }
  }


  async function activateHazardSearch(context) {
    const { type, select, trigger, input, vueInstance } = context;
    select.scrollIntoView({ block: "center", inline: "nearest" });

    clickElement(trigger);
    clickElement(input);
    dispatchFocusSequence(input);

    if (type === "treeselect" && vueInstance) {
      try {
        if (typeof vueInstance.openMenu === "function") vueInstance.openMenu();
        else if (vueInstance.menu && !vueInstance.menu.isOpen && typeof vueInstance.toggleMenu === "function") {
          vueInstance.toggleMenu();
        }
      } catch (_) {}
      await nextVueTick(vueInstance);
    }

    try {
      await waitUntil(
        () => document.activeElement === input || input.matches(":focus"),
        900,
        30,
        "危害搜索框获得焦点"
      );
    } catch (_) {}
  }


  async function insertSearchText(context, value, dialog) {
    const { type, input, vueInstance } = context;
    const wanted = String(value);
    dispatchFocusSequence(input);
    input.select?.();

    if (type === "treeselect" && vueInstance) {
      await updateTreeselectSearchThroughVm(context, "");
      try { await waitForTreeselectQuerySync(dialog, "", 1400); } catch (_) {}

      const fresh = getHazardSelectContext(dialog);
      await updateTreeselectSearchThroughVm(fresh, wanted);
      await waitForTreeselectQuerySync(dialog, wanted, 2200);

      const latest = getHazardSelectContext(dialog);
      try { latest.input.focus({ preventScroll: true }); } catch (_) { latest.input.focus(); }
      return;
    }

    setNativeInputValue(input, "", "deleteContentBackward");
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await waitUntil(() => cleanText(input.value) === "", 1200, 40, "搜索框清空");

    setNativeInputValue(input, wanted, "insertText");
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    try {
      input.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        composed: true,
        data: wanted
      }));
    } catch (_) {}

    await waitUntil(
      () => cleanText(input.value) === cleanText(wanted),
      1800,
      40,
      `搜索词“${wanted}”写入`
    );
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
  }



  function getControlledDropdown(input, select) {
    const controls = [input, select, ...select.querySelectorAll("[aria-controls],[aria-owns]")];
    for (const element of controls) {
      for (const attribute of ["aria-controls", "aria-owns"]) {
        const ids = String(element.getAttribute?.(attribute) || "").split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const controlled = document.getElementById(id);
          const popup = controlled?.closest(
            ".el-select-dropdown, .el-popper, .vue-treeselect__menu-container"
          ) || controlled;
          if (popup && isVisibleElement(popup)) return popup;
        }
      }
    }
    return null;
  }

  function getVisibleSelectDropdown(context) {
    const { select, input } = context;
    const controlled = getControlledDropdown(input, select);
    if (controlled) return controlled;

    const candidates = [...document.querySelectorAll(".el-select-dropdown, .el-popper")]
      .filter(isVisibleElement)
      .filter(popup => popup.querySelector(".el-select-dropdown__item"));

    return candidates.sort((a, b) => {
      const zDiff = getElementZIndex(b) - getElementZIndex(a);
      return zDiff || getElementDistance(a, select) - getElementDistance(b, select);
    })[0] || null;
  }


  function getSelectableOptions(dropdown) {
    if (!dropdown) return [];
    return [...dropdown.querySelectorAll(".el-select-dropdown__item")]
      .filter(isVisibleElement)
      .filter(option =>
        !option.classList.contains("is-disabled") &&
        option.getAttribute("aria-disabled") !== "true"
      );
  }


  function getOptionText(option) {
    return cleanText(
      option.querySelector?.(".vue-treeselect__label")?.innerText ||
      option.querySelector?.(".vue-treeselect__option-label")?.innerText ||
      option.innerText || option.textContent
    );
  }

  function getMouseCoordinates(element) {
    const rect = element.getBoundingClientRect?.();
    return {
      clientX: rect ? rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1)) : 1,
      clientY: rect ? rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1)) : 1
    };
  }

  function dispatchMouseEvent(element, type, options = {}) {
    if (!element) return false;
    const coordinates = getMouseCoordinates(element);
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: type === "mousedown" || type === "mousemove" ? 1 : 0,
      ...coordinates,
      ...options
    };
    return element.dispatchEvent(new MouseEvent(type, eventOptions));
  }


  function clickElement(element) {
    if (!element) return;
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    dispatchMouseEvent(element, "mouseenter");
    dispatchMouseEvent(element, "mouseover");
    dispatchMouseEvent(element, "mousedown");
    dispatchMouseEvent(element, "mouseup");
    dispatchMouseEvent(element, "click");
  }


  async function waitForHazardSelected(dialog, name, timeout = 850) {
    try {
      await waitUntil(
        () => isHazardAlreadySelected(dialog, name),
        timeout, 40, `“${name}”选中`
      );
      return true;
    } catch (_) {
      return false;
    }
  }


















  function clickHazardOption(option) {
    clickElement(option);
    try { option.click?.(); } catch (_) {}
  }


  async function openDropdownAfterTyping(context, name) {
    let dropdown = getVisibleSelectDropdown(context);
    if (dropdown) return dropdown;

    clickElement(context.trigger);
    clickElement(context.input);
    dispatchFocusSequence(context.input);

    return await waitUntil(
      () => getVisibleSelectDropdown(context),
      4500,
      60,
      `“${name}”搜索下拉出现`
    );
  }


  async function selectOneHazard(dialog, name, updateStep) {
    const originalName =
      cleanText(name);

    const searchName =
      getAutofillHazardName(
        originalName
      );

    if (!searchName) {
      throw new Error(
        "危害名称为空，无法执行自动补齐"
      );
    }

    if (
      isHazardAlreadySelected(
        dialog,
        searchName
      )
    ) {
      return {
        status: "skipped",
        name: searchName
      };
    }

    const context =
      getHazardSelectContext(dialog);

    updateStep?.(
      originalName &&
      strictKey(originalName) !==
        strictKey(searchName)
        ? (
            "步骤 1/3：按映射后的标准名称搜索\n" +
            `${originalName} → ${searchName}`
          )
        : (
            "步骤 1/3：输入危害并触发搜索\n" +
            searchName
          )
    );

    await activateHazardSearch(context);

    // 所有实际输入统一使用映射后的标准危害名称。
    await insertSearchText(
      context,
      searchName,
      dialog
    );

    let selected = false;

    if (context.type === "treeselect") {
      // 精确键盘流程：
      // 输入搜索 → 读取当前候选名称 → 用 ↓ 逐项移动到完全一致的候选 → Enter。
      // 不使用鼠标点击，也不直接调用组件节点选择；候选 DOM 无法读取时才兼容旧流程。
      selected = await selectTreeselectByOwnEnterHandler(
        dialog,
        context,
        searchName,
        updateStep
      );
    } else {
      const dropdown = await openDropdownAfterTyping(context, searchName);
      await waitUntil(
        () => getSelectableOptions(dropdown).length,
        4500,
        60,
        `“${searchName}”搜索结果出现`
      );

      const matchedOption = getSelectableOptions(dropdown).find(option =>
        matchHazards(searchName, getOptionText(option)).matched
      );

      if (!matchedOption) {
        setNativeInputValue(context.input, "", "deleteContentBackward");
        throw new Error(`搜索结果中没有找到“${searchName}”`);
      }

      updateStep?.(`正在点击搜索结果\n${searchName}`);
      clickHazardOption(matchedOption);
      selected = await waitForHazardSelected(
        dialog,
        searchName,
        AUTOFILL_TIMING.selectionTimeout
      );
    }

    if (!selected) {
      throw new Error(
        `已执行精确候选定位并按 Enter，但未确认“${searchName}”被选中`
      );
    }

    // 标签生成和搜索框清空后，再确认该标签持续稳定存在，
    // 避免界面已显示但 Vue 表单模型尚未完成同步。
    await waitForNextHazardReady(dialog, searchName);
    await waitForDialogRequirementsStable(
      dialog,
      [searchName],
      "",
      BATCH_RELIABILITY.selectionStableMs,
      6500
    );

    return { status: "selected", name: searchName };
  }

  function getDialogStageSelectContext(dialog) {
    const item = findDialogFormItem(dialog, ["在岗状态"]);
    if (!item) {
      throw new Error("找不到“在岗状态”字段");
    }

    const select =
      item.querySelector(".el-select") ||
      item.querySelector(".el-input") ||
      item;

    const input =
      item.querySelector("input:not([type='hidden'])") ||
      select.querySelector?.("input");

    return { item, select, input };
  }

  async function selectDialogStage(dialog, targetStage) {
    const wanted = cleanText(targetStage);
    if (!wanted) {
      return { status: "unsupported", name: "" };
    }

    const current = getDialogCurrentStage(dialog);
    if (strictKey(current) === strictKey(wanted)) {
      return { status: "skipped", name: wanted };
    }

    if (cleanText(current)) {
      throw new Error(
        `当前在岗状态已是“${current}”，为避免覆盖未自动改为“${wanted}”`
      );
    }

    const context = getDialogStageSelectContext(dialog);
    const trigger =
      context.select.querySelector?.(".el-input") ||
      context.input ||
      context.select;

    clickElement(trigger);

    const dropdown = await waitUntil(
      () => getVisibleSelectDropdown(context),
      2800,
      50,
      "在岗状态下拉列表出现"
    );

    const options = getSelectableOptions(dropdown);
    const option = options.find(item =>
      strictKey(getOptionText(item)) === strictKey(wanted)
    );

    if (!option) {
      const available = options
        .map(getOptionText)
        .filter(Boolean)
        .join("、");

      throw new Error(
        `在岗状态下拉中找不到“${wanted}”` +
        `${available ? `；当前可选：${available}` : ""}`
      );
    }

    clickElement(option);

    try {
      await waitUntil(
        () =>
          strictKey(getDialogCurrentStage(dialog)) === strictKey(wanted),
        2200,
        50,
        `在岗状态“${wanted}”选中`
      );
    } catch (_) {
      try { option.click?.(); } catch (_) {}

      await waitUntil(
        () =>
          strictKey(getDialogCurrentStage(dialog)) === strictKey(wanted),
        2200,
        50,
        `在岗状态“${wanted}”二次选中`
      );
    }

    return { status: "selected", name: wanted };
  }


  async function executeDialogFillSequence(
    dialog,
    initial,
    options = {}
  ) {
    const {
      onProgress = () => {},
      useCombinedStability = false,
      sequenceMode = "hazard-first"
    } = options;

    const selected = [];
    const skipped = [];
    const failed = [];
    let stageResult = "";

    const totalTasks =
      initial.pending.length +
      (initial.stagePending ? 1 : 0);

    const hasCombinedChange = Boolean(
      initial.pending.length > 0 &&
      initial.stagePending
    );

    const useStageFirst = Boolean(
      hasCombinedChange &&
      sequenceMode === "stage-first"
    );

    let taskIndex = 0;

    const processStage = async () => {
      if (!initial.stagePending || failed.length) {
        return;
      }

      taskIndex++;

      onProgress({
        phase: useStageFirst
          ? "stage-first"
          : "stage",
        taskIndex,
        totalTasks,
        stage: initial.expectedStage,
        message:
          `正在选择在岗状态：${initial.expectedStage}`
      });

      try {
        const result = await selectDialogStage(
          dialog,
          initial.expectedStage
        );

        stageResult = result.status === "selected"
          ? `在岗状态：已选择“${initial.expectedStage}”`
          : `在岗状态：原本已是“${initial.expectedStage}”`;
      } catch (error) {
        failed.push(
          `在岗状态“${initial.expectedStage}”：` +
          `${error.message || error}`
        );
      }
    };

    const processHazards = async () => {
      if (failed.length) return;

      for (const hazard of initial.pending) {
        taskIndex++;

        const updateStep = message => {
          onProgress({
            phase: "hazard",
            taskIndex,
            totalTasks,
            hazard: hazard.canonical,
            message
          });
        };

        updateStep(`准备处理危害：${hazard.canonical}`);

        try {
          const result = await selectOneHazard(
            dialog,
            hazard.canonical,
            updateStep
          );

          if (result.status === "selected") {
            selected.push(hazard.canonical);
          } else {
            skipped.push(hazard.canonical);
          }
        } catch (error) {
          failed.push(
            `${hazard.canonical}：${error.message || error}`
          );

          try {
            await clearHazardSearchAndWait(dialog);
          } catch (_) {}
        }
      }
    };

    if (useStageFirst) {
      // 批量组合套餐：
      // 先处理岗位，让可能发生的表单重绘在危害选择之前完成。
      await processStage();

      if (
        useCombinedStability &&
        failed.length === 0
      ) {
        onProgress({
          phase: "stage-to-hazard",
          taskIndex,
          totalTasks,
          message:
            "岗位状态已完成，正在等待页面稳定后再补危害因素"
        });

        if (
          strictKey(getDialogCurrentStage(dialog)) !==
          strictKey(initial.expectedStage)
        ) {
          throw new Error(
            `岗位状态复核失败，目标为“${initial.expectedStage}”，` +
            `当前为“${getDialogCurrentStage(dialog) || "空"}”`
          );
        }

        // 不与危害选择并行，避免两个下拉组件争抢焦点和键盘事件。
        // 岗位值确认写入后，只等待下拉关闭的短缓冲。
        await sleep(
          BATCH_RELIABILITY.combinedStageToHazardDelayMs
        );
      }

      await processHazards();
    } else {
      // 手动一键补齐继续保持用户熟悉的顺序：
      // 先危害，再岗位。
      await processHazards();
      await processStage();
    }

    // 组合操作的真正“过程内核验”：
    // 危害完成后重新读取两类字段，确认岗位没有被危害组件更新清空，
    // 同时确认全部危害标签持续存在。
    if (
      hasCombinedChange &&
      useCombinedStability &&
      failed.length === 0
    ) {
      onProgress({
        phase: "combined-final-check",
        taskIndex,
        totalTasks,
        message:
          "正在同时复核岗位状态和全部危害因素"
      });

      await waitForDialogRequirementsStable(
        dialog,
        initial.pending.map(item => item.canonical),
        initial.expectedStage,
        BATCH_RELIABILITY.combinedFinalStableMs,
        9000
      );
    }

    return {
      selected,
      skipped,
      failed,
      stageResult,
      totalTasks,
      hasCombinedChange,
      sequenceMode: useStageFirst
        ? "stage-first"
        : "hazard-first",
      expectedHazards:
        initial.pending.map(item => item.canonical),
      expectedStage: initial.expectedStage
    };
  }


  async function fillCurrentDialogMissing(dialog, panel) {
    if (panel.dataset.busy === "1") return;

    const initial = getDialogMissingContext(dialog);
    if (!initial.canRun) {
      renderAutoPanel(dialog, panel);
      return;
    }

    const button = panel.querySelector(".autofill-action");
    const status = panel.querySelector(".autofill-status");
    panel.dataset.busy = "1";
    button.disabled = true;
    setAutoPanelType(panel, "normal");

    const result = await executeDialogFillSequence(
      dialog,
      initial,
      {
        // 手动模式继续使用用户熟悉的“危害 → 在岗状态”。
        useCombinedStability: false,
        sequenceMode: "hazard-first",
        onProgress: progress => {
          button.textContent =
            `正在补齐 ${progress.taskIndex}/${progress.totalTasks}`;

          status.textContent = [
            `当前任务：${progress.taskIndex}/${progress.totalTasks}`,
            progress.phase === "stage"
              ? "手动顺序：危害已完成 → 现在处理在岗状态"
              : "手动顺序：先危害 → 后在岗状态",
            progress.message
          ].filter(Boolean).join("\n");
        }
      }
    );

    panel.dataset.busy = "0";

    if (result.failed.length) {
      setAutoPanelType(panel, "error");
      status.textContent = [
        `危害新增：${result.selected.length} 项` +
          `${result.skipped.length
            ? `；原本已存在：${result.skipped.length} 项`
            : ""}`,
        result.stageResult,
        `失败：${result.failed.length} 项`,
        ...result.failed,
        "请检查失败项；脚本不会自动点击“确定”。"
      ].filter(Boolean).join("\n");

      button.textContent = "重新识别剩余项目";
      button.disabled = false;
    } else {
      setAutoPanelType(panel, "success");
      status.textContent = [
        `危害新增：${result.selected.length} 项` +
          `${result.skipped.length
            ? `；原本已存在：${result.skipped.length} 项`
            : ""}`,
        result.stageResult,
        "执行顺序：危害因素 → 在岗状态。",
        "请检查无误后手动点击“确定”。"
      ].filter(Boolean).join("\n");

      button.textContent = "补齐完成";
      button.disabled = true;
    }

    setTimeout(() => {
      if (
        panel.isConnected &&
        panel.dataset.busy !== "1"
      ) {
        renderAutoPanel(dialog, panel);
      }
    }, result.failed.length ? 1500 : 2800);
  }

  function findPackageRowRecordByCode(code) {
    const wanted = strictKey(code);
    if (!wanted) return null;

    for (const table of findPackageTables()) {
      const codeIndex = table.headerInfo.codeIndex;
      if (codeIndex < 0) continue;

      for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
        const row = table.rows[rowIndex];
        const cells = getDirectCells(row);
        const currentCode = cleanText(
          cells[codeIndex]?.innerText ||
          cells[codeIndex]?.textContent
        );

        if (strictKey(currentCode) === wanted) {
          return {
            tableRoot: table.tableRoot,
            headerInfo: table.headerInfo,
            row,
            rowIndex,
            code: currentCode
          };
        }
      }
    }

    return null;
  }

  function getRowCloneCandidates(record) {
    if (!record) return [];

    const rows = [record.row];
    const selectors = [
      ".el-table__fixed-right .el-table__body-wrapper tbody tr.el-table__row",
      ".el-table__fixed .el-table__body-wrapper tbody tr.el-table__row"
    ];

    for (const selector of selectors) {
      const cloneRows = [
        ...record.tableRoot.querySelectorAll(selector)
      ];
      const clone = cloneRows[record.rowIndex];
      if (clone) rows.push(clone);
    }

    return [...new Set(rows)].filter(Boolean);
  }

  function findRowEditControl(record) {
    const wantedTexts = new Set(["编辑", "修改"]);

    for (const row of getRowCloneCandidates(record)) {
      const candidates = [
        ...row.querySelectorAll(
          "button, a, [role='button'], .el-button, span"
        )
      ].filter(isVisibleElement);

      for (const element of candidates) {
        const text = cleanText(
          element.innerText || element.textContent
        );

        if (!wantedTexts.has(text)) continue;

        return (
          element.closest("button, a, [role='button'], .el-button") ||
          element
        );
      }
    }

    return null;
  }

  async function waitForNoVisibleEditDialog(timeout = 5000) {
    await waitUntil(
      () => findVisibleEditDialogs().length === 0,
      timeout,
      70,
      "上一编辑弹窗关闭"
    );
  }

  async function openEditDialogForBatch(candidate) {
    await waitForNoVisibleEditDialog(4500);

    const record = findPackageRowRecordByCode(candidate.code);
    if (!record) {
      throw new Error(
        `列表中找不到套餐编码 ${candidate.code}`
      );
    }

    const editControl = findRowEditControl(record);
    if (!editControl) {
      throw new Error(
        `套餐 ${candidate.code} 找不到“编辑/修改”按钮`
      );
    }

    record.row.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });

    clickElement(editControl);

    const wantedCode = strictKey(candidate.code);

    const dialog = await waitUntil(
      () => {
        for (const current of findVisibleEditDialogs()) {
          const currentCode = strictKey(
            readDialogField(current, ["套餐编码"])
          );

          if (currentCode === wantedCode) {
            return current;
          }
        }

        return null;
      },
      7000,
      80,
      `套餐 ${candidate.code} 的编辑弹窗打开`
    );

    await waitUntil(
      () =>
        getDialogHazardItem(dialog) &&
        cleanText(readDialogField(dialog, ["套餐名称"])),
      4000,
      70,
      `套餐 ${candidate.code} 的编辑数据加载`
    );

    ensureAutoPanel(dialog);

    // 页面弹窗出现不代表标签和表单数据已经全部载入。
    // 先等待一次固定缓冲，再确认套餐编码、名称、岗位和危害标签均停止变化。
    await sleep(BATCH_RELIABILITY.dialogLoadDelayMs);
    await waitForDialogSnapshotStable(dialog, 500, 6000);

    return dialog;
  }

  function findDialogFooterButton(dialog, names) {
    const wanted = names.map(strictKey);
    const scopes = [
      dialog.querySelector(".el-dialog__footer"),
      dialog.closest(".el-dialog__wrapper")
        ?.querySelector(".el-dialog__footer"),
      dialog
    ].filter(Boolean);

    for (const scope of scopes) {
      const buttons = [
        ...scope.querySelectorAll(
          "button, .el-button, [role='button']"
        )
      ].filter(isVisibleElement);

      const exact = buttons.find(button => {
        const text = strictKey(
          button.innerText || button.textContent
        );
        return wanted.includes(text);
      });

      if (exact) return exact;
    }

    return null;
  }

  function getVisibleDialogValidationError(dialog) {
    const errors = [
      ...dialog.querySelectorAll(
        ".el-form-item__error, .is-error .el-form-item__error"
      )
    ]
      .filter(isVisibleElement)
      .map(element =>
        cleanText(element.innerText || element.textContent)
      )
      .filter(Boolean);

    return errors.join("；");
  }

  function getVisibleGlobalFeedback(existingElements) {
    const selectors = [
      ".el-message",
      ".el-notification",
      ".el-message-box__wrapper"
    ];

    const elements = [
      ...document.querySelectorAll(selectors.join(","))
    ].filter(element =>
      isVisibleElement(element) &&
      !existingElements.has(element)
    );

    for (const element of elements) {
      const text = cleanText(
        element.innerText || element.textContent
      );
      const classText = String(element.className || "");

      if (
        /error|danger/.test(classText) ||
        /(失败|错误|不能为空|请选择|异常)/.test(text)
      ) {
        return { type: "error", text };
      }

      if (
        /success/.test(classText) ||
        /(成功|保存完成|修改完成)/.test(text)
      ) {
        return { type: "success", text };
      }
    }

    return null;
  }

  async function submitEditDialogForBatch(dialog, code) {
    const button = findDialogFooterButton(
      dialog,
      ["确定", "保存", "提交"]
    );

    if (!button) {
      throw new Error(
        `套餐 ${code} 的编辑弹窗中找不到“确定”按钮`
      );
    }

    if (
      button.disabled ||
      button.classList.contains("is-disabled")
    ) {
      throw new Error(
        `套餐 ${code} 的“确定”按钮当前不可用`
      );
    }

    const existingFeedback = new Set([
      ...document.querySelectorAll(
        ".el-message, .el-notification, .el-message-box__wrapper"
      )
    ]);

    button.scrollIntoView?.({
      block: "nearest",
      inline: "nearest"
    });
    button.focus?.();
    clickElement(button);

    const startedAt = Date.now();
    let successText = "";

    while (Date.now() - startedAt < 12000) {
      const validationError =
        getVisibleDialogValidationError(dialog);

      if (validationError) {
        throw new Error(
          `点击确定后表单校验失败：${validationError}`
        );
      }

      const feedback =
        getVisibleGlobalFeedback(existingFeedback);

      if (feedback?.type === "error") {
        throw new Error(
          `保存失败：${feedback.text || "页面返回错误提示"}`
        );
      }

      if (feedback?.type === "success") {
        successText = feedback.text;
      }

      if (
        !dialog.isConnected ||
        !isVisibleElement(dialog)
      ) {
        await waitForNoVisibleEditDialog(3500);
        return {
          status: "submitted",
          successText
        };
      }

      await sleep(80);
    }

    throw new Error(
      `套餐 ${code} 点击“确定”后弹窗仍未关闭；` +
      "为避免继续操作错误套餐，批量处理已停止"
    );
  }

  async function closeDialogWithoutSave(dialog) {
    const cancel = findDialogFooterButton(
      dialog,
      ["取消", "关闭"]
    );

    const close =
      cancel ||
      dialog.querySelector(
        ".el-dialog__headerbtn, .el-dialog__close"
      );

    if (!close) {
      throw new Error("当前编辑弹窗没有找到取消或关闭按钮");
    }

    clickElement(close);
    await waitForNoVisibleEditDialog(3500);
  }

  async function fillDialogForBatch(
    dialog,
    candidate,
    itemIndex,
    totalItems
  ) {
    const context = getDialogMissingContext(dialog);

    if (
      strictKey(context.code) !== strictKey(candidate.code)
    ) {
      throw new Error(
        `弹窗套餐编码为 ${context.code || "空"}，` +
        `与目标 ${candidate.code} 不一致`
      );
    }

    if (context.stageConflict) {
      throw new Error(
        `在岗状态存在冲突：当前“${context.currentStage}”，` +
        `套餐名称应为“${context.expectedStage}”`
      );
    }

    if (!context.canRun) {
      return {
        changed: false,
        context
      };
    }

    const fillResult = await executeDialogFillSequence(
      dialog,
      context,
      {
        useCombinedStability: true,
        sequenceMode:
          context.pending.length > 0 &&
          context.stagePending
            ? "stage-first"
            : "hazard-first",
        onProgress: progress => {
          const phaseText =
            progress.phase === "stage-first"
              ? "先处理在岗状态"
              : progress.phase === "stage-to-hazard"
                ? "岗位完成，等待页面稳定"
                : progress.phase === "combined-final-check"
                  ? "岗位与危害双向复核"
                  : progress.phase === "stage"
                    ? "正在处理在岗状态"
                    : "正在补齐危害";

          updateBatchProgress(
            `停止批量处理（${itemIndex}/${totalItems}）`,
            [
              `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
              `步骤 ${progress.taskIndex}/${progress.totalTasks}：${phaseText}`,
              progress.message
            ].filter(Boolean).join("\n")
          );
        }
      }
    );

    if (fillResult.failed.length) {
      throw new Error(
        fillResult.failed.join("\n")
      );
    }

    await commitDialogStateBeforeSubmit(
      dialog,
      fillResult.expectedHazards,
      fillResult.expectedStage,
      message => {
        updateBatchProgress(
          `停止批量处理（${itemIndex}/${totalItems}）`,
          [
            `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
            fillResult.sequenceMode === "stage-first"
              ? "批量组合顺序：在岗状态 → 危害因素 → 双向复核"
              : "批量单项顺序已完成",
            message
          ].join("\n")
        );
      },
      fillResult.hasCombinedChange
        ? BATCH_RELIABILITY.combinedBeforeSubmitStableMs
        : BATCH_RELIABILITY.beforeSubmitStableMs
    );

    const after = getDialogMissingContext(dialog);

    if (after.pending.length) {
      throw new Error(
        "补齐后仍有未选中的危害：" +
        after.pending
          .map(item => item.canonical)
          .join("、")
      );
    }

    if (
      context.expectedStage &&
      strictKey(getDialogCurrentStage(dialog)) !==
        strictKey(context.expectedStage)
    ) {
      throw new Error(
        `岗位状态复核失败，目标为“${context.expectedStage}”，` +
        `当前为“${getDialogCurrentStage(dialog) || "空"}”`
      );
    }

    return {
      changed: true,
      context: after,
      initialMissingCount: context.pending.length,
      stageChanged: context.stagePending,
      combinedChange: fillResult.hasCombinedChange,
      expectedHazards: fillResult.expectedHazards,
      expectedStage: fillResult.expectedStage
    };
  }

  function decideBatchVerification(
    fillResult,
    submitResult,
    attempt
  ) {
    const isRetryAttempt = attempt > 1;
    const isCombinedChange =
      fillResult.combinedChange === true;

    // 失败后的重试必须复核，避免再次误判成功。
    if (isRetryAttempt) {
      return {
        shouldVerify: true,
        mode: "retry",
        reason: `当前为第 ${attempt} 次尝试`
      };
    }

    // 危害单独修改，或岗位状态单独修改，不再重新打开。
    // 网站是否显示成功消息也不再作为复核条件。
    if (!isCombinedChange) {
      return {
        shouldVerify: false,
        mode: "fast",
        reason:
          fillResult.stageChanged
            ? "仅修改岗位状态，快速通过"
            : "仅修改危害因素，快速通过"
      };
    }

    if (batchStrictCombinedVerification) {
      return {
        shouldVerify: true,
        mode: "strict-combined",
        reason: "组合操作已进入严格复核模式"
      };
    }

    const nextCombinedNumber =
      batchCombinedAcceptedCount + 1;

    const shouldAudit = Boolean(
      (
        BATCH_ADAPTIVE_VERIFY.verifyFirstCombinedPackage &&
        nextCombinedNumber === 1
      ) ||
      (
        BATCH_ADAPTIVE_VERIFY.auditEveryCombinedPackages > 0 &&
        nextCombinedNumber %
          BATCH_ADAPTIVE_VERIFY.auditEveryCombinedPackages === 0
      )
    );

    return {
      shouldVerify: shouldAudit,
      mode: shouldAudit
        ? "combined-audit"
        : "combined-fast",
      reason: shouldAudit
        ? `危害+岗位组合操作抽检（第 ${nextCombinedNumber} 个）`
        : "危害+岗位组合操作已延长同步等待，快速通过"
    };
  }

  async function verifyBatchCandidatePersisted(
    candidate,
    itemIndex,
    totalItems,
    attempt
  ) {
    updateBatchProgress(
      `停止批量处理（${itemIndex}/${totalItems}）`,
      [
        `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
        `第 ${attempt} 次保存后复核`,
        "正在重新打开编辑弹窗读取后台保存结果……"
      ].join("\n")
    );

    await sleep(BATCH_RELIABILITY.verifyOpenDelayMs);

    const dialog =
      await openEditDialogForBatch(candidate);

    await waitForDialogSnapshotStable(dialog, 600, 6500);

    const context = getDialogMissingContext(dialog);

    const stageVerified = Boolean(
      !context.expectedStage ||
      (
        !context.stagePending &&
        !context.stageConflict &&
        strictKey(context.currentStage) ===
          strictKey(context.expectedStage)
      )
    );

    const verified =
      context.pending.length === 0 &&
      stageVerified;

    const result = {
      verified,
      remainingHazards:
        context.pending.map(item => item.canonical),
      expectedStage: context.expectedStage,
      currentStage: context.currentStage,
      stagePending: context.stagePending,
      stageConflict: context.stageConflict
    };

    await closeDialogWithoutSave(dialog);
    return result;
  }

  async function processOneBatchCandidate(
    candidate,
    itemIndex,
    totalItems
  ) {
    let lastVerification = null;

    for (
      let attempt = 1;
      attempt <= BATCH_RELIABILITY.maxPackageAttempts;
      attempt++
    ) {
      let dialog = null;

      try {
        updateBatchProgress(
          `停止批量处理（${itemIndex}/${totalItems}）`,
          [
            `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
            `处理轮次：${attempt}/${BATCH_RELIABILITY.maxPackageAttempts}`,
            "正在打开编辑弹窗……"
          ].join("\n")
        );

        dialog =
          await openEditDialogForBatch(candidate);

        const fillResult = await fillDialogForBatch(
          dialog,
          candidate,
          itemIndex,
          totalItems
        );

        if (!fillResult.changed) {
          await closeDialogWithoutSave(dialog);
          return {
            status: "skipped",
            attempts: attempt,
            verificationMode: "none"
          };
        }

        updateBatchProgress(
          `停止批量处理（${itemIndex}/${totalItems}）`,
          [
            `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
            `处理轮次：${attempt}/${BATCH_RELIABILITY.maxPackageAttempts}`,
            "表单已稳定，正在点击“确定”……"
          ].join("\n")
        );

        const submitResult =
          await submitEditDialogForBatch(
            dialog,
            candidate.code
          );
        dialog = null;

        await sleep(
          BATCH_RELIABILITY.afterSubmitCooldownMs
        );

        const verificationDecision =
          decideBatchVerification(
            fillResult,
            submitResult,
            attempt
          );

        if (!verificationDecision.shouldVerify) {
          if (fillResult.combinedChange) {
            batchCombinedAcceptedCount++;
          }

          batchVerifiedCodes.add(
            strictKey(candidate.code)
          );

          return {
            status: "saved",
            attempts: attempt,
            verificationMode: "fast",
            verificationReason:
              verificationDecision.reason
          };
        }

        updateBatchProgress(
          `停止批量处理（${itemIndex}/${totalItems}）`,
          [
            `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
            verificationDecision.mode === "audit"
              ? "正在执行低风险抽检……"
              : "正在执行保存后复核……",
            verificationDecision.reason
          ].join("\n")
        );

        lastVerification =
          await verifyBatchCandidatePersisted(
            candidate,
            itemIndex,
            totalItems,
            attempt
          );

        if (lastVerification.verified) {
          if (fillResult.combinedChange) {
            batchCombinedAcceptedCount++;
          }

          batchVerifiedCodes.add(
            strictKey(candidate.code)
          );

          return {
            status: "saved",
            attempts: attempt,
            verificationMode:
              verificationDecision.mode,
            verificationReason:
              verificationDecision.reason
          };
        }

        // 只有“危害+岗位”组合操作抽检失败时，
        // 后续组合操作才切换严格复核；危害单独或岗位单独仍走快速通道。
        if (
          verificationDecision.mode ===
          "combined-audit"
        ) {
          batchStrictCombinedVerification = true;
        }

        if (
          attempt <
          BATCH_RELIABILITY.maxPackageAttempts
        ) {
          updateBatchProgress(
            `停止批量处理（${itemIndex}/${totalItems}）`,
            [
              `当前套餐：${candidate.sequence || "-"} · ${candidate.code}` +
            `｜${getBatchCandidateTypeLabel(candidate.batchType)}`,
              verificationDecision.mode ===
                "combined-audit"
                ? "组合操作抽检发现保存不完整，后续组合操作切换严格复核"
                : "后台复核发现仍有未写入内容",
              "准备只补齐剩余内容并自动重试",
              lastVerification.remainingHazards.length
                ? `剩余危害：${lastVerification.remainingHazards.join("、")}`
                : "",
              lastVerification.stagePending
                ? `岗位状态仍为空，应为“${lastVerification.expectedStage}”`
                : ""
            ].filter(Boolean).join("\n")
          );

          await sleep(BATCH_RELIABILITY.retryDelayMs);
        }
      } catch (error) {
        if (
          dialog?.isConnected &&
          isVisibleElement(dialog)
        ) {
          try {
            await closeDialogWithoutSave(dialog);
          } catch (_) {}
        }

        throw error;
      }
    }

    throw new Error(
      [
        `套餐 ${candidate.code} 已自动尝试 ${BATCH_RELIABILITY.maxPackageAttempts} 次，`,
        "但保存后复核仍未完全写入。",
        lastVerification?.remainingHazards?.length
          ? `剩余危害：${lastVerification.remainingHazards.join("、")}`
          : "",
        lastVerification?.stagePending
          ? `岗位状态仍为空，应为“${lastVerification.expectedStage}”`
          : "",
        "批量处理已停止，请检查该套餐。"
      ].filter(Boolean).join("\n")
    );
  }

  function getBatchCandidateType(candidate) {
    const missingCount =
      Array.isArray(candidate?.missing)
        ? candidate.missing.length
        : 0;

    const stagePending =
      candidate?.stagePending === true;

    if (stagePending && missingCount === 0) {
      return "stage-only";
    }

    if (!stagePending && missingCount > 0) {
      return "hazard-only";
    }

    return "combined";
  }

  function getBatchCandidateTypeLabel(type) {
    return {
      "stage-only": "只缺岗位",
      "hazard-only": "只缺危害",
      combined: "岗位和危害都缺"
    }[type] || "其他";
  }

  function buildOrderedBatchQueue(candidates) {
    const typeOrder = {
      "stage-only": 0,
      "hazard-only": 1,
      combined: 2
    };

    return candidates
      .map((candidate, originalIndex) => {
        const batchType =
          getBatchCandidateType(candidate);

        return {
          ...candidate,
          batchType,
          originalIndex
        };
      })
      .sort((left, right) => {
        const typeDifference =
          typeOrder[left.batchType] -
          typeOrder[right.batchType];

        if (typeDifference) {
          return typeDifference;
        }

        // 同组内保持网页原始顺序，避免套餐位置来回跳动。
        return (
          left.originalIndex -
          right.originalIndex
        );
      });
  }

  function countBatchQueueTypes(queue) {
    const counts = {
      "stage-only": 0,
      "hazard-only": 0,
      combined: 0
    };

    queue.forEach(candidate => {
      const type = candidate.batchType;
      if (type in counts) counts[type]++;
    });

    return counts;
  }


  async function startBatchRepair() {
    if (batchRunning) return;

    if (!hasRunCheck) {
      showToast("请先点击“开始核对”");
      return;
    }

    if (!latestBatchCandidates.length) {
      showToast("当前没有可安全批量处理的套餐");
      return;
    }

    if (findVisibleEditDialogs().length) {
      showToast("请先关闭当前编辑套餐弹窗");
      return;
    }

    // 点击“批量安全修复”后直接开始，不再弹出浏览器原生确认框。
    // 安全候选筛选、首错即停、停止按钮和保存复核仍然保留。
    const queue =
      buildOrderedBatchQueue(
        latestBatchCandidates
      );
    const queueCounts =
      countBatchQueueTypes(queue);

    batchRunning = true;
    batchCancelRequested = false;
    batchVerifiedCodes.clear();
    batchStrictCombinedVerification = false;
    batchCombinedAcceptedCount = 0;
    lastBatchNotice = "";
    runButton.disabled = true;
    clearButton.disabled = true;

    updateBatchProgress(
      `停止批量处理（0/${queue.length}）`,
      [
        `已开始批量安全修复，共 ${queue.length} 个套餐`,
        `处理顺序：只缺岗位 ${queueCounts["stage-only"]} 个` +
          ` → 只缺危害 ${queueCounts["hazard-only"]} 个` +
          ` → 两者都缺 ${queueCounts.combined} 个`,
        "正在准备第一个套餐……"
      ].join("\n")
    );

    let savedCount = 0;
    let skippedCount = 0;
    let retryCount = 0;
    let fastCount = 0;
    let combinedFastCount = 0;
    let reopenedCount = 0;
    let combinedAuditCount = 0;
    let completedStageOnly = 0;
    let completedHazardOnly = 0;
    let completedCombined = 0;
    let failedMessage = "";

    try {
      for (let index = 0; index < queue.length; index++) {
        if (batchCancelRequested) break;

        const candidate = queue[index];

        try {
          const result = await processOneBatchCandidate(
            candidate,
            index + 1,
            queue.length
          );

          if (result.status === "saved") {
            savedCount++;

            if (candidate.batchType === "stage-only") {
              completedStageOnly++;
            } else if (
              candidate.batchType === "hazard-only"
            ) {
              completedHazardOnly++;
            } else if (
              candidate.batchType === "combined"
            ) {
              completedCombined++;
            }

            retryCount += Math.max(
              0,
              (result.attempts || 1) - 1
            );

            if (
              result.verificationMode === "fast"
            ) {
              fastCount++;
            } else if (
              result.verificationMode ===
              "combined-fast"
            ) {
              combinedFastCount++;
            } else {
              reopenedCount++;

              if (
                result.verificationMode ===
                "combined-audit"
              ) {
                combinedAuditCount++;
              }
            }
          } else {
            skippedCount++;
          }
        } catch (error) {
          failedMessage = [
            `停止于第 ${index + 1}/${queue.length} 个套餐`,
            `${candidate.sequence || "-"} · ${candidate.code}`,
            error.message || String(error)
          ].join("\n");
          break;
        }
      }
    } finally {
      batchRunning = false;
      runButton.disabled = false;
      clearButton.disabled = false;

      const stoppedByUser =
        batchCancelRequested && !failedMessage;

      lastBatchNotice = [
        failedMessage
          ? "批量处理已因错误停止"
          : stoppedByUser
            ? "批量处理已按你的要求停止"
            : "批量处理结束",
        `已完成保存 ${savedCount} 个套餐`,
        completedStageOnly
          ? `只缺岗位：完成 ${completedStageOnly} 个`
          : "",
        completedHazardOnly
          ? `只缺危害：完成 ${completedHazardOnly} 个`
          : "",
        completedCombined
          ? `岗位和危害都缺：完成 ${completedCombined} 个`
          : "",
        fastCount
          ? `单项修改快速通过 ${fastCount} 个套餐`
          : "",
        combinedFastCount
          ? `危害+岗位延时后快速通过 ${combinedFastCount} 个套餐`
          : "",
        reopenedCount
          ? `重新打开复核 ${reopenedCount} 个套餐`
          : "",
        combinedAuditCount
          ? `其中组合操作抽检 ${combinedAuditCount} 个套餐`
          : "",
        batchStrictCombinedVerification
          ? "组合操作抽检曾发现异常，后续仅组合操作切换严格复核"
          : "",
        retryCount
          ? `保存不完整时自动重试 ${retryCount} 次`
          : "",
        skippedCount
          ? `无需修改并跳过 ${skippedCount} 个套餐`
          : "",
        failedMessage,
        "队列按“只缺岗位 → 只缺危害 → 两者都缺”处理；组合套餐岗位选中后只留短缓冲，再补危害并在提交前双向复核。"
      ].filter(Boolean).join("\n");

      batchCancelRequested = false;

      try {
        await waitForNoVisibleEditDialog(2500);
      } catch (_) {}

      runCheck({
        preserveBatchNotice: true,
        preserveBatchVerified: true
      });
    }
  }

  function renderResults(
    differences,
    unresolvedEntries,
    stageIssues,
    parseErrors
  ) {
    resultsBox.innerHTML = "";

    latestMismatchByCode = new Map(
      differences
        .filter(item => strictKey(item.code))
        .map(item => [
          strictKey(item.code),
          {
            ...item,
            missing: item.packageOnly
          }
        ])
    );

    latestMissingNames = [...new Set(
      differences.flatMap(item =>
        item.packageOnly.map(hazard => hazard.canonical)
      )
    )];


    copyAllButton.style.display =
      latestMissingNames.length ? "block" : "none";

    if (differences.length) {
      const group = document.createElement("section");
      group.className = "result-group missing";
      group.dataset.resultSection = "differences";

      const header = document.createElement("div");
      header.className = "result-group-header";
      header.innerHTML = `
        <span>需要核对｜危害匹配差异</span>
        <span class="result-group-count">${differences.length} 个套餐</span>
      `;
      group.appendChild(header);

      const content = document.createElement("div");
      content.className = "result-group-content";

      differences.forEach(result => {
        const item = document.createElement("div");
        item.className = "result-item difference";

        const title = document.createElement("div");
        title.className = "result-title";
        title.textContent = [
          result.sequence ? `序号 ${result.sequence}` : "",
          result.code || "未识别套餐编码"
        ].filter(Boolean).join(" · ");
        item.appendChild(title);

        if (result.packageOnly.length) {
          const line = document.createElement("div");
          line.className = "difference-line is-missing";
          line.innerHTML = "<strong>匹配缺失</strong><div>套餐名称中存在，但危害因素栏未选择：</div>";

          const list = document.createElement("div");
          list.className = "result-copy-list";
          result.packageOnly.forEach(hazard => {
            list.appendChild(makeCopyButton(hazard.canonical, false));
          });

          line.appendChild(list);
          item.appendChild(line);
        }

        if (result.cellOnly.length) {
          const line = document.createElement("div");
          line.className = "difference-line is-extra";
          line.innerHTML = "<strong>危害多出</strong><div>套餐名称中未包含，但危害因素栏已选择：</div>";

          const list = document.createElement("div");
          list.className = "result-copy-list";
          result.cellOnly.forEach(hazard => {
            list.appendChild(makeCopyButton(hazard.canonical, false));
          });

          line.appendChild(list);
          item.appendChild(line);
        }

        item.title = "点击定位到对应套餐";
        item.addEventListener("click", () => scrollToResult(result));
        content.appendChild(item);
      });

      group.appendChild(content);

      if (latestMissingNames.length) {
        copyAllButton.textContent =
          `复制全部缺失名称（${latestMissingNames.length}）`;
        copyAllButton.style.display = "block";
        group.appendChild(copyAllButton);
      }

      resultsBox.appendChild(group);
    }

    renderMappingModule(unresolvedEntries);

    if (stageIssues.length) {
      const details = document.createElement("details");
      details.className = "result-group unknown";
      details.dataset.resultSection = "stage";

      const summary = document.createElement("summary");
      summary.innerHTML = `
        <span>在岗状态提示（点击展开）</span>
        <span class="result-group-count">${stageIssues.length} 个套餐</span>
      `;
      details.appendChild(summary);

      const content = document.createElement("div");
      content.className = "result-group-content";

      stageIssues.forEach(result => {
        const item = document.createElement("div");
        item.className = "result-item unknown";

        const title = document.createElement("div");
        title.className = "result-title";
        title.textContent = [
          result.sequence ? `序号 ${result.sequence}` : "",
          result.code || "未识别套餐编码"
        ].filter(Boolean).join(" · ");

        const detail = document.createElement("div");
        detail.className = "result-detail";
        detail.textContent = result.message;

        item.appendChild(title);
        item.appendChild(detail);
        item.addEventListener("click", () => scrollToResult(result));
        content.appendChild(item);
      });

      details.appendChild(content);
      resultsBox.appendChild(details);
    }



    if (parseErrors.length) {
      const details = document.createElement("details");
      details.className = "result-group parse-error";
      details.dataset.resultSection = "parse";

      const summary = document.createElement("summary");
      summary.innerHTML = `
        <span>无法解析的套餐（点击展开）</span>
        <span class="result-group-count">${parseErrors.length} 个</span>
      `;
      details.appendChild(summary);

      const content = document.createElement("div");
      content.className = "result-group-content";

      parseErrors.forEach(result => {
        const item = document.createElement("div");
        item.className = "result-item parse-error";

        const title = document.createElement("div");
        title.className = "result-title";
        title.textContent = [
          result.sequence ? `序号 ${result.sequence}` : "",
          result.code || "未识别套餐编码"
        ].filter(Boolean).join(" · ");

        const detail = document.createElement("div");
        detail.className = "result-detail";
        detail.textContent = result.message;

        item.appendChild(title);
        item.appendChild(detail);
        item.addEventListener("click", () => scrollToResult(result));
        content.appendChild(item);
      });

      details.appendChild(content);
      resultsBox.appendChild(details);
    }

    renderRuleManager();
  }

  function runCheck(options = {}) {
    const preserveBatchNotice =
      options?.preserveBatchNotice === true;
    const preserveBatchVerified =
      options?.preserveBatchVerified === true;

    if (!preserveBatchNotice) {
      lastBatchNotice = "";
    }

    if (!preserveBatchVerified) {
      batchVerifiedCodes.clear();
    }

    hasRunCheck = true;
    removeExistingMarks();
    resultsBox.innerHTML = "";
    copyAllButton.style.display = "none";
    setSummary("正在读取当前页面套餐……", "running");

    const packageTables = findPackageTables();

    if (!packageTables.length) {
      setSummary(
        "没有找到包含“套餐名称”和“危害因素”的已加载表格。\n请先展开单位的套餐列表，再运行核对。",
        "error"
      );
      return;
    }

    let scannedCount = 0;
    let matchedCount = 0;
    let packageMissingPackageCount = 0;
    let cellExtraPackageCount = 0;

    const differences = [];
    const stageIssues = [];
    const parseErrors = [];
    const unresolvedMap = new Map();
    const batchCandidates = [];

    for (const table of packageTables) {
      const info = table.headerInfo;

      for (
        let rowIndex = 0;
        rowIndex < table.rows.length;
        rowIndex++
      ) {
        const row = table.rows[rowIndex];
        const cells = getDirectCells(row);

        if (
          cells.length <= Math.max(
            info.packageIndex,
            info.hazardIndex
          )
        ) {
          continue;
        }

        const packageCell = cells[info.packageIndex];
        const hazardCell = cells[info.hazardIndex];
        const stageCell =
          info.stageIndex >= 0
            ? cells[info.stageIndex]
            : null;

        const packageName = cleanText(
          packageCell?.innerText ||
          packageCell?.textContent
        );

        if (!packageName) continue;

        const resultBase = {
          row,
          rowIndex,
          tableRoot: table.tableRoot,
          packageCell,
          hazardCell,
          stageCell,
          packageName,
          code:
            info.codeIndex >= 0
              ? cleanText(
                  cells[info.codeIndex]?.innerText ||
                  cells[info.codeIndex]?.textContent
                )
              : "",
          sequence:
            info.sequenceIndex >= 0
              ? cleanText(
                  cells[info.sequenceIndex]?.innerText ||
                  cells[info.sequenceIndex]?.textContent
                )
              : ""
        };

        const packageResult =
          extractPackageHazards(packageName);

        // 名称中没有可识别在岗状态的套餐不参与本工具核对。
        if (packageResult.skipped) {
          continue;
        }

        scannedCount++;

        const verifiedByFreshDialog =
          batchVerifiedCodes.has(
            strictKey(resultBase.code)
          );

        // 批量保存后已经重新打开编辑弹窗确认数据真实存在。
        // 若底层列表没有自动刷新，不再用旧列表数据重复报错。
        if (verifiedByFreshDialog) {
          matchedCount++;
          continue;
        }

        if (packageResult.error) {
          const result = {
            ...resultBase,
            message: packageResult.error
          };

          parseErrors.push(result);
          markParseError(row, packageCell, packageResult.error);
          continue;
        }

        const cellHazards = extractCellHazards(hazardCell);
        const comparison = compareHazardLists(
          packageResult.hazards,
          cellHazards
        );

        if (!comparison.isMatched) {
          const result = {
            ...resultBase,
            packageHazards: packageResult.hazards,
            cellHazards,
            packageOnly: comparison.packageOnly,
            cellOnly: comparison.cellOnly
          };

          differences.push(result);

          if (comparison.packageOnly.length) {
            packageMissingPackageCount++;
          }

          if (comparison.cellOnly.length) {
            cellExtraPackageCount++;
          }

          markDifference(
            row,
            hazardCell,
            comparison.packageOnly,
            comparison.cellOnly
          );
        }

        // “完全匹配”必须同时满足：
        // 标准危害双向一致，并且套餐名称中没有尚未处理的名称。
        if (
          comparison.isMatched &&
          packageResult.unresolvedHazards.length === 0
        ) {
          matchedCount++;
        }

        const cellRawKeys = new Set(
          cellHazards.map(item => strictKey(item.raw))
        );

        packageResult.unresolvedHazards.forEach(hazard => {
          const key = strictKey(hazard.raw);
          const sameRawInCell = cellRawKeys.has(key);
          const bestCandidate =
            getBestSimilarityCandidate(hazard.raw);

          /*
           * 固定分流规则：
           * 1. 第一个横杠后的“+”分隔内容全部逐项判断；
           * 2. 明确排除项或已维护无关内容在解析阶段剥离；
           * 3. 标准名称或已维护别名进入正式核对；
           * 4. 其余未识别名称无条件进入“名称处理”。
           *
           * 相似度只负责排列候选，不再决定是否将名称归入无关内容。
           */
          const targetMap = unresolvedMap;

          if (!targetMap.has(key)) {
            targetMap.set(key, {
              raw: hazard.raw,
              occurrences: [],
              sameRawInCellCount: 0,
              bestCandidate
            });
          }

          const entry = targetMap.get(key);
          entry.occurrences.push(resultBase);

          if (
            bestCandidate &&
            (
              !entry.bestCandidate ||
              bestCandidate.score > entry.bestCandidate.score
            )
          ) {
            entry.bestCandidate = bestCandidate;
          }

          if (sameRawInCell) {
            entry.sameRawInCellCount++;
          }

        });

        // 已经进入内置或自定义无关规则的内容不再出现在普通提示中。
        // 检查阶段和性别内容也只用于解析，不作为无关内容反复提醒。

        const expectedStage =
          resolveDialogStageName(packageResult.stage);

        const currentStage = cleanText(
          stageCell?.innerText ||
          stageCell?.textContent
        );

        let stageMessage = "";

        if (packageResult.stage && !expectedStage) {
          stageMessage =
            `套餐名称中的检查阶段“${packageResult.stage}”无法对应系统选项`;
        } else if (expectedStage && stageCell && !currentStage) {
          stageMessage =
            `套餐名称应为“${expectedStage}”，当前在岗状态为空`;
        } else if (
          expectedStage &&
          stageCell &&
          currentStage &&
          strictKey(currentStage) !== strictKey(expectedStage)
        ) {
          stageMessage =
            `套餐名称应为“${expectedStage}”，当前为“${currentStage}”`;
        }

        if (stageMessage) {
          const stageResult = {
            ...resultBase,
            message: stageMessage
          };

          stageIssues.push(stageResult);
          markStageIssue(stageCell || packageCell, stageMessage);
        }

        const stagePending = Boolean(
          expectedStage && !currentStage
        );
        const stageConflict = Boolean(
          expectedStage &&
          currentStage &&
          strictKey(currentStage) !== strictKey(expectedStage)
        );
        const stageUnsupported = Boolean(
          packageResult.stage && !expectedStage
        );

        const canBatchSafely = Boolean(
          resultBase.code &&
          packageResult.unresolvedHazards.length === 0 &&
          comparison.cellOnly.length === 0 &&
          !stageConflict &&
          !stageUnsupported &&
          (
            comparison.packageOnly.length > 0 ||
            stagePending
          )
        );

        if (canBatchSafely) {
          batchCandidates.push({
            code: resultBase.code,
            sequence: resultBase.sequence,
            packageName,
            missing: comparison.packageOnly,
            expectedStage,
            stagePending
          });
        }
      }
    }

    const unresolvedEntries = [...unresolvedMap.values()]
      .sort((a, b) =>
        b.occurrences.length - a.occurrences.length ||
        a.raw.localeCompare(b.raw, "zh-CN")
      );

    latestBatchCandidates = batchCandidates;

    renderResults(
      differences,
      unresolvedEntries,
      stageIssues,
      parseErrors
    );

    scheduleEnhanceDialogs();

    renderSummaryOverview({
      scannedCount,
      matchedCount,
      packageMissingPackageCount,
      cellExtraPackageCount,
      unresolvedNameCount: unresolvedEntries.length,
      stageIssueCount: stageIssues.length,
      parseErrorCount: parseErrors.length,
      batchCandidateCount: batchCandidates.length
    });
  }

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function getViewportWidthLimit() {
    return Math.max(MIN_VIEWPORT_TOOL_WIDTH, innerWidth - 8);
  }

  function applySavedPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (!saved) return;

      const viewportWidthLimit = getViewportWidthLimit();
      const minimumWidth = Math.min(MIN_TOOL_WIDTH, viewportWidthLimit);

      if (Number.isFinite(saved.width)) {
        tool.style.width =
          clamp(saved.width, minimumWidth, viewportWidthLimit) + "px";
      }

      const viewportHeightLimit = Math.max(
        MIN_VIEWPORT_TOOL_HEIGHT,
        innerHeight - 8
      );
      const minimumHeight = Math.min(
        MIN_TOOL_HEIGHT,
        viewportHeightLimit
      );

      if (Number.isFinite(saved.height)) {
        expandedToolHeight = clamp(
          saved.height,
          minimumHeight,
          viewportHeightLimit
        );
      } else {
        expandedToolHeight = clamp(
          expandedToolHeight,
          minimumHeight,
          viewportHeightLimit
        );
      }

      tool.style.height = expandedToolHeight + "px";
      setCollapsed(saved.collapsed === true, false);

      if (!Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;

      const maxLeft = Math.max(0, innerWidth - tool.offsetWidth);
      const maxTop = Math.max(0, innerHeight - tool.offsetHeight);
      tool.style.left = clamp(saved.left, 0, maxLeft) + "px";
      tool.style.top = clamp(saved.top, 0, maxTop) + "px";
      tool.style.right = "auto";
    } catch (_) {}
  }

  function savePosition() {
    try {
      const rect = tool.getBoundingClientRect();
      localStorage.setItem(POSITION_KEY, JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(expandedToolHeight),
        collapsed: tool.classList.contains("is-collapsed")
      }));
    } catch (_) {}
  }

  function setCollapsed(collapsed, shouldSave = true) {
    tool.classList.toggle("is-collapsed", !!collapsed);
    collapseButton.textContent = collapsed ? "+" : "−";
    collapseButton.title = collapsed ? "展开工具" : "折叠工具";
    collapseButton.setAttribute("aria-expanded", String(!collapsed));

    if (collapsed) {
      toolBody.scrollTop = 0;
    } else {
      tool.style.height = expandedToolHeight + "px";
    }

    const rect = tool.getBoundingClientRect();
    const maxTop = Math.max(0, innerHeight - rect.height);
    tool.style.top = clamp(rect.top, 0, maxTop) + "px";
    if (shouldSave) savePosition();
  }

  function toggleCollapsed() {
    setCollapsed(!tool.classList.contains("is-collapsed"));
  }

  let dragging = false;
  let resizing = false;
  let heightResizing = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let startLeft = 0;
  let startTop = 0;
  let resizeStartX = 0;
  let resizeStartWidth = 0;
  let resizeStartLeft = 0;
  let heightResizeStartY = 0;
  let heightResizeStartHeight = 0;
  let heightResizeStartTop = 0;

  dragHandle.addEventListener("mousedown", event => {
    if (event.target.closest(".tool-header-button")) return;
    const rect = tool.getBoundingClientRect();
    dragging = true;
    resizing = false;
    startMouseX = event.clientX;
    startMouseY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    tool.style.left = rect.left + "px";
    tool.style.top = rect.top + "px";
    tool.style.right = "auto";
    tool.classList.add("is-dragging");
    event.preventDefault();
  });

  resizeHandle.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    const rect = tool.getBoundingClientRect();
    resizing = true;
    heightResizing = false;
    dragging = false;
    resizeStartX = event.clientX;
    resizeStartWidth = rect.width;
    resizeStartLeft = rect.left;
    tool.style.left = rect.left + "px";
    tool.style.top = rect.top + "px";
    tool.style.right = "auto";
    tool.classList.add("is-resizing");
    event.preventDefault();
    event.stopPropagation();
  });


  heightResizeHandle.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    if (tool.classList.contains("is-collapsed")) return;

    const rect = tool.getBoundingClientRect();
    heightResizing = true;
    resizing = false;
    dragging = false;
    heightResizeStartY = event.clientY;
    heightResizeStartHeight = rect.height;
    heightResizeStartTop = rect.top;
    tool.style.left = rect.left + "px";
    tool.style.top = rect.top + "px";
    tool.style.right = "auto";
    tool.classList.add("is-height-resizing");
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("mousemove", event => {
    if (heightResizing) {
      const availableHeight = Math.max(
        MIN_VIEWPORT_TOOL_HEIGHT,
        innerHeight - heightResizeStartTop - 4
      );
      const minimumHeight = Math.min(
        MIN_TOOL_HEIGHT,
        availableHeight
      );
      const wantedHeight =
        heightResizeStartHeight +
        event.clientY -
        heightResizeStartY;

      expandedToolHeight = clamp(
        wantedHeight,
        minimumHeight,
        availableHeight
      );
      tool.style.height = expandedToolHeight + "px";
      return;
    }

    if (resizing) {
      const viewportLimit = getViewportWidthLimit();
      const availableWidth = Math.max(
        MIN_VIEWPORT_TOOL_WIDTH,
        Math.min(viewportLimit, innerWidth - resizeStartLeft)
      );
      const minimumWidth = Math.min(MIN_TOOL_WIDTH, availableWidth);
      const wantedWidth = resizeStartWidth + event.clientX - resizeStartX;
      tool.style.width = clamp(wantedWidth, minimumWidth, availableWidth) + "px";
      return;
    }

    if (!dragging) return;
    const maxLeft = Math.max(0, innerWidth - tool.offsetWidth);
    const maxTop = Math.max(0, innerHeight - tool.offsetHeight);
    tool.style.left = clamp(startLeft + event.clientX - startMouseX, 0, maxLeft) + "px";
    tool.style.top = clamp(startTop + event.clientY - startMouseY, 0, maxTop) + "px";
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      tool.classList.remove("is-dragging");
      savePosition();
    }

    if (resizing) {
      resizing = false;
      tool.classList.remove("is-resizing");
      savePosition();
    }

    if (heightResizing) {
      heightResizing = false;
      tool.classList.remove("is-height-resizing");
      savePosition();
    }
  });

  window.addEventListener("resize", () => {
    keepLauncherInsideViewport();
    const initialRect = tool.getBoundingClientRect();
    const viewportLimit = getViewportWidthLimit();
    const minimumWidth = Math.min(MIN_TOOL_WIDTH, viewportLimit);
    const fittedWidth = clamp(
      initialRect.width,
      minimumWidth,
      viewportLimit
    );
    tool.style.width = fittedWidth + "px";

    const viewportHeightLimit = Math.max(
      MIN_VIEWPORT_TOOL_HEIGHT,
      innerHeight - 8
    );
    const minimumHeight = Math.min(
      MIN_TOOL_HEIGHT,
      viewportHeightLimit
    );
    expandedToolHeight = clamp(
      expandedToolHeight,
      minimumHeight,
      viewportHeightLimit
    );

    if (!tool.classList.contains("is-collapsed")) {
      tool.style.height = expandedToolHeight + "px";
    }

    const rect = tool.getBoundingClientRect();
    const maxLeft = Math.max(0, innerWidth - rect.width);
    const maxTop = Math.max(0, innerHeight - rect.height);
    tool.style.left = clamp(rect.left, 0, maxLeft) + "px";
    tool.style.top = clamp(rect.top, 0, maxTop) + "px";
    tool.style.right = "auto";
    savePosition();
  });

  referenceButtons.forEach(button => {
    button.addEventListener("click", () => {
      const key = button.dataset.referencePanel;
      activeReferencePanel =
        activeReferencePanel === key ? "" : key;
      updateReferencePanelVisibility();

      if (activeReferencePanel) {
        requestAnimationFrame(() => {
          toolBody.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        });
      }
    });
  });

  runButton.addEventListener("click", () => runCheck());
  clearButton.addEventListener("click", () => {
    removeExistingMarks();
    resultsBox.innerHTML = "";
    latestMissingNames = [];
    latestMismatchByCode = new Map();
    latestBatchCandidates = [];
    batchVerifiedCodes.clear();
    batchStrictCombinedVerification = false;
    batchCombinedAcceptedCount = 0;
    lastBatchNotice = "";
    hasRunCheck = false;
    copyAllButton.style.display = "none";
    setSummary("高亮已清除，等待核对", "normal");
    scheduleEnhanceDialogs();
  });
  copyAllButton.addEventListener("click", () => {
    if (latestMissingNames.length) copyText(latestMissingNames.join("\n"));
  });

  function updateLauncherState(isOpen) {
    const text = launcher.querySelector(".launcher-text");
    launcher.classList.toggle("is-open", isOpen);
    launcher.setAttribute("aria-expanded", String(isOpen));

    if (text) {
      text.textContent = isOpen ? "关闭套餐核对" : "打开套餐核对";
    }

    launcher.title = isOpen
      ? "点击关闭套餐危害因素核对工具"
      : "点击打开套餐危害因素核对工具";
  }

  function hideToolPanel() {
    if (!tool.isConnected || !launcher.isConnected) return;
    tool.style.display = "none";
    launcher.style.display = "flex";
    updateLauncherState(false);
  }

  function showToolPanel() {
    if (!tool.isConnected || !launcher.isConnected) return;

    tool.style.display = "flex";
    launcher.style.display = "flex";
    updateLauncherState(true);

    requestAnimationFrame(() => {
      applySavedPosition();

      const rect = tool.getBoundingClientRect();
      const maxLeft = Math.max(0, innerWidth - rect.width);
      const maxTop = Math.max(0, innerHeight - rect.height);
      tool.style.left = clamp(rect.left, 0, maxLeft) + "px";
      tool.style.top = clamp(rect.top, 0, maxTop) + "px";
      tool.style.right = "auto";
    });
  }

  function toggleToolPanel() {
    const isOpen = tool.style.display !== "none";
    if (isOpen) hideToolPanel();
    else showToolPanel();
  }


  function destroyTool() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(enhanceTimer);
    dialogObserver?.disconnect();
    removeExistingMarks();
    document.querySelectorAll("." + AUTO_PANEL_CLASS).forEach(element => element.remove());
    launcher.remove();
    tool.remove();
    style.remove();
    if (window[GLOBAL_KEY]?.destroy === destroyTool) delete window[GLOBAL_KEY];
  }

  collapseButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleCollapsed();
  });
  dragHandle.addEventListener("dblclick", event => {
    if (event.target.closest(".tool-header-button")) return;
    toggleCollapsed();
  });


  function saveLauncherPosition() {
    const rect = launcher.getBoundingClientRect();
    localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top)
    }));
  }

  function keepLauncherInsideViewport() {
    const rect = launcher.getBoundingClientRect();
    const maxLeft = Math.max(0, innerWidth - rect.width);
    const maxTop = Math.max(0, innerHeight - rect.height);

    launcher.style.left = Math.min(Math.max(rect.left, 0), maxLeft) + "px";
    launcher.style.top = Math.min(Math.max(rect.top, 0), maxTop) + "px";
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
  }

  function applySavedLauncherPosition() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(LAUNCHER_POSITION_KEY) || "null"
      );

      if (
        saved &&
        Number.isFinite(saved.left) &&
        Number.isFinite(saved.top)
      ) {
        launcher.style.left = saved.left + "px";
        launcher.style.top = saved.top + "px";
        launcher.style.right = "auto";
        launcher.style.bottom = "auto";
      }
    } catch (_) {}

    keepLauncherInsideViewport();
  }

  let launcherDragging = false;
  let launcherMoved = false;
  let launcherStartX = 0;
  let launcherStartY = 0;
  let launcherStartLeft = 0;
  let launcherStartTop = 0;

  launcher.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;

    const rect = launcher.getBoundingClientRect();
    launcherDragging = true;
    launcherMoved = false;
    launcherStartX = event.clientX;
    launcherStartY = event.clientY;
    launcherStartLeft = rect.left;
    launcherStartTop = rect.top;

    launcher.style.left = rect.left + "px";
    launcher.style.top = rect.top + "px";
    launcher.style.right = "auto";
    launcher.style.bottom = "auto";
    launcher.classList.add("is-launcher-dragging");

    try { launcher.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  });

  launcher.addEventListener("pointermove", event => {
    if (!launcherDragging) return;

    const deltaX = event.clientX - launcherStartX;
    const deltaY = event.clientY - launcherStartY;

    if (!launcherMoved && Math.hypot(deltaX, deltaY) >= 4) {
      launcherMoved = true;
    }

    if (!launcherMoved) return;

    const maxLeft = Math.max(0, innerWidth - launcher.offsetWidth);
    const maxTop = Math.max(0, innerHeight - launcher.offsetHeight);

    launcher.style.left = Math.min(
      Math.max(launcherStartLeft + deltaX, 0),
      maxLeft
    ) + "px";

    launcher.style.top = Math.min(
      Math.max(launcherStartTop + deltaY, 0),
      maxTop
    ) + "px";
  });

  function endLauncherDrag(event) {
    if (!launcherDragging) return;

    launcherDragging = false;
    launcher.classList.remove("is-launcher-dragging");

    try { launcher.releasePointerCapture(event.pointerId); } catch (_) {}

    if (launcherMoved) {
      saveLauncherPosition();
      setTimeout(() => {
        launcherMoved = false;
      }, 0);
    }
  }

  launcher.addEventListener("pointerup", endLauncherDrag);
  launcher.addEventListener("pointercancel", endLauncherDrag);

  launcher.addEventListener("click", event => {
    if (launcherMoved) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    toggleToolPanel();
  });


  closeButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    hideToolPanel();
  });

  dialogObserver = new MutationObserver(scheduleEnhanceDialogs);
  dialogObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"]
  });

  window[GLOBAL_KEY] = { destroy: destroyTool };
  requestAnimationFrame(() => {
    renderRuleManager();
    applySavedLauncherPosition();
    hideToolPanel();
    enhanceVisibleEditDialogs();
  });
  console.log("套餐危害因素核对工具 v4.2.15 已加载。");
})();
