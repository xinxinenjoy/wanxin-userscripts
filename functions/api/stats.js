// Cloudflare Pages Function
// 保存路径：functions/api/stats.js
//
// V7 首页统计（页面访问已由 track.js 做“同设备 + 同 IP 8 小时”去重）：
// - 页面访问总次数 + 今日次数
// - 脚本安装点击总次数 + 今日次数
// - 国内地区 / 城市 / 热门脚本 + 今日次数
// - 浏览器 / 操作系统 / 设备 + 今日次数
// - recent14Days 继续保留，供首页直接取得“今日访问 / 今日安装”
//
// 不新增 D1 表、不新增 Binding、不新增 Secret。
//
// D1 Binding 名称必须为：STATS_DB

const REGION_NAMES = {
    BJ: "北京",
    TJ: "天津",
    HE: "河北",
    SX: "山西",
    NM: "内蒙古",
    LN: "辽宁",
    JL: "吉林",
    HL: "黑龙江",
    SH: "上海",
    JS: "江苏",
    ZJ: "浙江",
    AH: "安徽",
    FJ: "福建",
    JX: "江西",
    SD: "山东",
    HA: "河南",
    HB: "湖北",
    HN: "湖南",
    GD: "广东",
    GX: "广西",
    HI: "海南",
    CQ: "重庆",
    SC: "四川",
    GZ: "贵州",
    YN: "云南",
    XZ: "西藏",
    SN: "陕西",
    GS: "甘肃",
    QH: "青海",
    NX: "宁夏",
    XJ: "新疆",
};

const COUNTRY_NAMES = {
    CN: "中国大陆",
    HK: "香港",
    MO: "澳门",
    TW: "台湾",
};

// region_code 正常情况下最可靠；以下映射用于 Cloudflare 偶尔只返回英文地区名时兜底。
const REGION_TEXT_NAMES = {
    beijing: "北京",
    tianjin: "天津",
    hebei: "河北",
    shanxi: "山西",
    innermongolia: "内蒙古",
    neimenggu: "内蒙古",
    liaoning: "辽宁",
    jilin: "吉林",
    heilongjiang: "黑龙江",
    shanghai: "上海",
    jiangsu: "江苏",
    zhejiang: "浙江",
    anhui: "安徽",
    fujian: "福建",
    jiangxi: "江西",
    shandong: "山东",
    henan: "河南",
    hubei: "湖北",
    hunan: "湖南",
    guangdong: "广东",
    guangxi: "广西",
    hainan: "海南",
    chongqing: "重庆",
    sichuan: "四川",
    guizhou: "贵州",
    yunnan: "云南",
    tibet: "西藏",
    xizang: "西藏",
    shaanxi: "陕西",
    gansu: "甘肃",
    qinghai: "青海",
    ningxia: "宁夏",
    xinjiang: "新疆",
};


// Cloudflare 的 city 通常为英文 / 拼音。
// 只对常见国内城市做中文显示映射；未命中的城市保留 Cloudflare 原值。
const CITY_NAMES = {
    // 直辖市 / 省会 / 副省级
    beijing: "北京", shanghai: "上海", tianjin: "天津", chongqing: "重庆",
    shijiazhuang: "石家庄", taiyuan: "太原", hohhot: "呼和浩特", huhehaote: "呼和浩特",
    shenyang: "沈阳", changchun: "长春", harbin: "哈尔滨", nanjing: "南京",
    hangzhou: "杭州", hefei: "合肥", fuzhou: "福州", nanchang: "南昌",
    jinan: "济南", zhengzhou: "郑州", wuhan: "武汉", changsha: "长沙",
    guangzhou: "广州", nanning: "南宁", haikou: "海口", chengdu: "成都",
    guiyang: "贵阳", kunming: "昆明", lasa: "拉萨", lhasa: "拉萨",
    xian: "西安", lanzhou: "兰州", xining: "西宁", yinchuan: "银川",
    urumqi: "乌鲁木齐", wulumuqi: "乌鲁木齐",
    dalian: "大连", qingdao: "青岛", ningbo: "宁波", xiamen: "厦门",
    shenzhen: "深圳", suzhou: "苏州",

    // 河北
    tangshan: "唐山", qinhuangdao: "秦皇岛", handan: "邯郸", xingtai: "邢台",
    baoding: "保定", zhangjiakou: "张家口", chengde: "承德", cangzhou: "沧州",
    langfang: "廊坊", hengshui: "衡水",

    // 山西
    datong: "大同", yangquan: "阳泉", changzhi: "长治", jincheng: "晋城",
    shuozhou: "朔州", jinzhong: "晋中", yuncheng: "运城", xinzhou: "忻州",
    linfen: "临汾", lvliang: "吕梁", luliang: "吕梁",

    // 内蒙古
    baotou: "包头", wuhai: "乌海", chifeng: "赤峰", tongliao: "通辽",
    ordos: "鄂尔多斯", eerduosi: "鄂尔多斯", hulunbuir: "呼伦贝尔",
    bayannur: "巴彦淖尔", wulanchabu: "乌兰察布",

    // 辽宁
    anshan: "鞍山", fushun: "抚顺", benxi: "本溪", dandong: "丹东",
    jinzhou: "锦州", yingkou: "营口", fuxin: "阜新", liaoyang: "辽阳",
    panjin: "盘锦", tieling: "铁岭", chaoyang: "朝阳", huludao: "葫芦岛",

    // 吉林
    jilin: "吉林", siping: "四平", liaoyuan: "辽源", tonghua: "通化",
    baishan: "白山", songyuan: "松原", baicheng: "白城", yanji: "延吉",

    // 黑龙江
    qiqihar: "齐齐哈尔", jixi: "鸡西", hegang: "鹤岗", shuangyashan: "双鸭山",
    daqing: "大庆", yichun: "伊春", jiamusi: "佳木斯", qitaihe: "七台河",
    mudanjiang: "牡丹江", heihe: "黑河", suihua: "绥化",

    // 江苏
    wuxi: "无锡", xuzhou: "徐州", changzhou: "常州", nantong: "南通",
    lianyungang: "连云港", huaian: "淮安", yancheng: "盐城", yangzhou: "扬州",
    zhenjiang: "镇江", taizhou: "泰州", suqian: "宿迁",

    // 浙江
    wenzhou: "温州", jiaxing: "嘉兴", huzhou: "湖州", shaoxing: "绍兴",
    jinhua: "金华", quzhou: "衢州", zhoushan: "舟山", taizhouzhejiang: "台州",
    lishui: "丽水",

    // 安徽
    wuhu: "芜湖", bengbu: "蚌埠", huainan: "淮南", maanshan: "马鞍山",
    huaibei: "淮北", tongling: "铜陵", anqing: "安庆", huangshan: "黄山",
    chuzhou: "滁州", fuyang: "阜阳", suzhouanhui: "宿州", luan: "六安",
    bozhou: "亳州", chizhou: "池州", xuancheng: "宣城",

    // 福建
    putian: "莆田", sanming: "三明", quanzhou: "泉州", zhangzhou: "漳州",
    nanping: "南平", longyan: "龙岩", ningde: "宁德",

    // 江西
    jingdezhen: "景德镇", pingxiang: "萍乡", jiujiang: "九江", xinyu: "新余",
    yingtan: "鹰潭", ganzhou: "赣州", jian: "吉安", yichangxi: "宜春",
    shangrao: "上饶", fuzhoujiangxi: "抚州",

    // 山东
    zibo: "淄博", zaozhuang: "枣庄", dongying: "东营", yantai: "烟台",
    weifang: "潍坊", jining: "济宁", taian: "泰安", weihai: "威海",
    rizhao: "日照", linyi: "临沂", dezhou: "德州", liaocheng: "聊城",
    binzhou: "滨州", heze: "菏泽",

    // 河南
    kaifeng: "开封", luoyang: "洛阳", pingdingshan: "平顶山", anyang: "安阳",
    hebi: "鹤壁", xinxiang: "新乡", jiaozuo: "焦作", puyang: "濮阳",
    xuchang: "许昌", luohe: "漯河", sanmenxia: "三门峡", nanyang: "南阳",
    shangqiu: "商丘", xinyang: "信阳", zhoukou: "周口", zhumadian: "驻马店",

    // 湖北
    huangshi: "黄石", shiyan: "十堰", yichang: "宜昌", xiangyang: "襄阳",
    ezhou: "鄂州", jingmen: "荆门", xiaogan: "孝感", jingzhou: "荆州",
    huanggang: "黄冈", xianning: "咸宁", suizhou: "随州", enshi: "恩施",
    xiantao: "仙桃", qianjiang: "潜江", tianmen: "天门",

    // 湖南
    zhuzhou: "株洲", xiangtan: "湘潭", hengyang: "衡阳", shaoyang: "邵阳",
    yueyang: "岳阳", changde: "常德", zhangjiajie: "张家界", yiyang: "益阳",
    chenzhou: "郴州", yongzhou: "永州", huaihua: "怀化", loudi: "娄底",
    jishou: "吉首",

    // 广东
    shaoguan: "韶关", zhuhai: "珠海", shantou: "汕头", foshan: "佛山",
    jiangmen: "江门", zhanjiang: "湛江", maoming: "茂名", zhaoqing: "肇庆",
    huizhou: "惠州", meizhou: "梅州", shanwei: "汕尾", heyuan: "河源",
    yangjiang: "阳江", qingyuan: "清远", dongguan: "东莞", zhongshan: "中山",
    chaozhou: "潮州", jieyang: "揭阳", yunfu: "云浮",

    // 广西
    liuzhou: "柳州", guilin: "桂林", wuzhou: "梧州", beihai: "北海",
    fangchenggang: "防城港", qinzhou: "钦州", guigang: "贵港", yulin: "玉林",
    baise: "百色", hezhou: "贺州", hechi: "河池", laibin: "来宾", chongzuo: "崇左",

    // 海南
    sanya: "三亚", sansha: "三沙", danzhou: "儋州", qionghai: "琼海",
    wanning: "万宁", wenchang: "文昌",

    // 四川
    zigong: "自贡", panzhihua: "攀枝花", luzhou: "泸州", deyang: "德阳",
    mianyang: "绵阳", guangyuan: "广元", suining: "遂宁", neijiang: "内江",
    leshan: "乐山", nanchong: "南充", meishan: "眉山", yibin: "宜宾",
    guangan: "广安", dazhou: "达州", yaan: "雅安", bazhong: "巴中",
    ziyang: "资阳", kangding: "康定", xichang: "西昌", aba: "阿坝",

    // 贵州
    liupanshui: "六盘水", zunyi: "遵义", anshun: "安顺", bijie: "毕节",
    tongren: "铜仁", kaili: "凯里", duyun: "都匀", xingyi: "兴义",

    // 云南
    qujing: "曲靖", yuxi: "玉溪", baoshan: "保山", zhaotong: "昭通",
    lijiang: "丽江", puer: "普洱", lincang: "临沧", chuxiong: "楚雄",
    mengzi: "蒙自", wenshan: "文山", jinghong: "景洪", dali: "大理",
    mangshi: "芒市", shangrila: "香格里拉",

    // 西藏
    rikaze: "日喀则", shigatse: "日喀则", changdu: "昌都", nyingchi: "林芝",
    linzhi: "林芝", shannan: "山南", nagqu: "那曲", naqu: "那曲",

    // 陕西
    tongchuan: "铜川", baoji: "宝鸡", xianyang: "咸阳", weinan: "渭南",
    yanan: "延安", hanzhong: "汉中", yulinshaanxi: "榆林", ankang: "安康", shangluo: "商洛",

    // 甘肃
    jiayuguan: "嘉峪关", jinchang: "金昌", baiyin: "白银", tianshui: "天水",
    wuwei: "武威", zhangye: "张掖", pingliang: "平凉", jiuquan: "酒泉",
    qingyang: "庆阳", dingxi: "定西", longnan: "陇南", linxia: "临夏", hezuo: "合作",

    // 青海
    haidong: "海东", haibei: "海北", huangnan: "黄南", hainanqinghai: "海南州",
    guoluo: "果洛", yushu: "玉树", haixi: "海西",

    // 宁夏
    shizuishan: "石嘴山", wuzhong: "吴忠", guyuan: "固原", zhongwei: "中卫",

    // 新疆
    karamay: "克拉玛依", kelamayi: "克拉玛依", turpan: "吐鲁番", tulufan: "吐鲁番",
    hami: "哈密", korla: "库尔勒", kuerle: "库尔勒", aksu: "阿克苏",
    kashgar: "喀什", kashi: "喀什", hotan: "和田", hetian: "和田",
    yining: "伊宁", tacheng: "塔城", altay: "阿勒泰", shihezi: "石河子",
    aral: "阿拉尔", alar: "阿拉尔", tumxuk: "图木舒克", tumushuke: "图木舒克",
    wujiaqu: "五家渠", beitun: "北屯",
};

function json(data, status = 200) {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "public, max-age=30, s-maxage=60",
        },
    });
}

function countOf(row) {
    return Number(row?.count || 0);
}

function todayCountOf(row) {
    return Number(row?.today_count || 0);
}

function normalizeLocationKey(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(city|shi|prefecture|province|autonomous region)\b/g, "")
        .replace(/[^a-z0-9]/g, "");
}

function domesticRegionName(row) {
    const country = String(row?.country || "");

    if (country !== "CN" && COUNTRY_NAMES[country]) {
        return COUNTRY_NAMES[country];
    }

    const code = String(row?.region_code || "").toUpperCase();
    if (REGION_NAMES[code]) {
        return REGION_NAMES[code];
    }

    const raw = String(row?.region || "").trim();
    const mapped = REGION_TEXT_NAMES[normalizeLocationKey(raw)];
    return mapped || raw || "未知地区";
}

function cityDisplayName(rawValue, regionCode = "") {
    const raw = String(rawValue || "").trim();
    if (!raw) return "未知城市";

    const key = normalizeLocationKey(raw);

    // 少量同拼音城市通过省份代码消歧。
    const scopedAliases = {
        "ZJ:taizhou": "台州",
        "JS:taizhou": "泰州",
        "AH:suzhou": "宿州",
        "JS:suzhou": "苏州",
        "JX:fuzhou": "抚州",
        "FJ:fuzhou": "福州",
        "JX:yichun": "宜春",
        "HL:yichun": "伊春",
        "SN:yulin": "榆林",
        "GX:yulin": "玉林",
        "QH:hainan": "海南州",
    };

    const scoped = scopedAliases[`${String(regionCode || "").toUpperCase()}:${key}`];
    if (scoped) return scoped;

    return CITY_NAMES[key] || raw;
}

function chinaDateKey(offsetDays = 0) {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
    return shifted.toISOString().slice(0, 10);
}

function normalizeRecent14Days(rows) {
    const map = new Map(
        rows.map((row) => [
            String(row.date || ""),
            {
                visits: Number(row.visits || 0),
                installs: Number(row.installs || 0),
            },
        ])
    );

    const result = [];

    for (let offset = -13; offset <= 0; offset += 1) {
        const date = chinaDateKey(offset);
        const value = map.get(date) || { visits: 0, installs: 0 };

        result.push({
            date,
            visits: value.visits,
            installs: value.installs,
        });
    }

    return result;
}

async function rows(statement) {
    const result = await statement.all();
    return Array.isArray(result?.results) ? result.results : [];
}

export async function onRequestGet(context) {
    const { env } = context;

    if (!env.STATS_DB) {
        return json({ error: "STATS_DB binding missing" }, 500);
    }

    try {
        const [
            totalVisitsRow,
            totalInstallsRow,
            domesticRows,
            cityRows,
            scriptRows,
            browserRows,
            osRows,
            deviceRows,
            countryRows,
            referrerRows,
            recentRows,
        ] = await Promise.all([
            env.STATS_DB.prepare(
                `SELECT COUNT(*) AS count
                 FROM events
                 WHERE event_type = 'page_view'`
            ).first(),

            env.STATS_DB.prepare(
                `SELECT COUNT(*) AS count
                 FROM events
                 WHERE event_type = 'install_click'`
            ).first(),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        country,
                        region,
                        region_code,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                       AND is_domestic = 1
                     GROUP BY country, region, region_code
                     ORDER BY count DESC
                     LIMIT 12`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        city,
                        region_code,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                       AND country = 'CN'
                       AND city <> ''
                     GROUP BY city, region_code
                     ORDER BY count DESC
                     LIMIT 50`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        script_id,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'install_click'
                       AND script_id <> ''
                     GROUP BY script_id
                     ORDER BY count DESC`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        browser AS name,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                     GROUP BY browser
                     ORDER BY count DESC
                     LIMIT 8`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        os AS name,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                     GROUP BY os
                     ORDER BY count DESC
                     LIMIT 8`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        device AS name,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                     GROUP BY device
                     ORDER BY count DESC
                     LIMIT 8`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        country AS name,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                     GROUP BY country
                     ORDER BY count DESC
                     LIMIT 12`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        referrer_host AS name,
                        COUNT(*) AS count,
                        SUM(
                            CASE
                                WHEN date(created_at, '+8 hours') = date('now', '+8 hours')
                                THEN 1
                                ELSE 0
                            END
                        ) AS today_count
                     FROM events
                     WHERE event_type = 'page_view'
                     GROUP BY referrer_host
                     ORDER BY count DESC
                     LIMIT 10`
                )
            ),

            rows(
                env.STATS_DB.prepare(
                    `SELECT
                        date(created_at, '+8 hours') AS date,
                        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS visits,
                        SUM(CASE WHEN event_type = 'install_click' THEN 1 ELSE 0 END) AS installs
                     FROM events
                     WHERE created_at >= datetime('now', '-15 days')
                     GROUP BY date(created_at, '+8 hours')
                     ORDER BY date ASC`
                )
            ),
        ]);

        const domesticRegions = domesticRows.map((row) => ({
            name: domesticRegionName(row),
            count: countOf(row),
            todayCount: todayCountOf(row),
        }));

        const cityTotals = new Map();

        cityRows.forEach((row) => {
            const name = cityDisplayName(row.city, row.region_code);
            const count = countOf(row);
            const todayCount = todayCountOf(row);
            const previous = cityTotals.get(name) || {
                count: 0,
                todayCount: 0,
            };

            cityTotals.set(name, {
                count: previous.count + count,
                todayCount: previous.todayCount + todayCount,
            });
        });

        const domesticCities = [...cityTotals.entries()]
            .map(([name, value]) => ({
                name,
                count: value.count,
                todayCount: value.todayCount,
            }))
            .sort((a, b) => b.count - a.count);

        const scriptInstalls = {};
        const scriptInstallsToday = {};

        const topScripts = scriptRows.map((row) => {
            const scriptId = String(row.script_id || "");
            const count = countOf(row);
            const todayCount = todayCountOf(row);

            scriptInstalls[scriptId] = count;
            scriptInstallsToday[scriptId] = todayCount;

            return {
                scriptId,
                count,
                todayCount,
            };
        });

        const topRegion = domesticRegions[0] || null;

        return json({
            totalVisits: countOf(totalVisitsRow),
            totalInstalls: countOf(totalInstallsRow),

            // 首页展示
            topRegion,
            domesticRegions: domesticRegions.slice(0, 5),
            domesticCities: domesticCities.slice(0, 5),
            topScripts: topScripts.slice(0, 5),
            recent14Days: normalizeRecent14Days(recentRows),
            scriptInstalls,
            scriptInstallsToday,

            browsers: browserRows.map((row) => ({
                name: String(row.name || "Other"),
                count: countOf(row),
                todayCount: todayCountOf(row),
            })),
            operatingSystems: osRows.map((row) => ({
                name: String(row.name || "Other"),
                count: countOf(row),
                todayCount: todayCountOf(row),
            })),
            devices: deviceRows.map((row) => ({
                name: String(row.name || "Other"),
                count: countOf(row),
                todayCount: todayCountOf(row),
            })),
            countries: countryRows.map((row) => ({
                code: String(row.name || "XX"),
                count: countOf(row),
                todayCount: todayCountOf(row),
            })),
            referrers: referrerRows.map((row) => ({
                name: String(row.name || "direct"),
                count: countOf(row),
                todayCount: todayCountOf(row),
            })),
        });
    } catch (error) {
        return json(
            {
                error: "statistics query failed",
                detail: String(error?.message || error),
            },
            500
        );
    }
}
