// ==UserScript==
// @name         片源挑选助手
// @namespace    local.wanxin.pick-source
// @version      1.12.2
// @description  影视资源列表页自动打分（按电视/电脑/手机口径可调），挑出前 3 个版本，一键推送到 115 网盘离线。

// @match        *://xn--wcv59z.com/*
// @match        *://*.xn--wcv59z.com/*
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      115.com
// @connect      aps.115.com
// @connect      webapi.115.com
// @connect      my.115.com
// @connect      *
// @run-at       document-idle
// @author       WanXin
// @publishGroup hljdyxjb
// @publishID    game-pianyuan
// @updateURL    https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-pianyuan.user.js
// @downloadURL  https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-pianyuan.user.js
// ==/UserScript==

/* 使用说明
 * 1) 判定口径默认是「电视 65″ + 电脑 27″ 显示器」（= v1.8.0 的老口径）。
 *    v1.9.0 起可以在 ⚙ 设置 →「推荐口径」里改成 电视（55/65/75/85″）/ 电脑（24/27/32/34″）/ 手机（6.1/6.7/6.9″），
 *    可以多选 —— 多选时按「最严格的那台」算分（画质要求取最高、体积预算取最紧）。
 * 2) 卡片里每条资源一个「推到 115」按钮 —— 直接调 115 自己的离线接口，**不需要任何中转服务**。
 *    唯一前提：浏览器里先在 115.com 登录过（脚本靠油猴通道自动带上那份登录态，不读也不保存你的密码）。
 *    也可以在设置里改成「自己填 Cookie」，用于多账号 / 登录态带不上时。
 * 3) 运行范围（v1.12.2 收窄）：**只在上面 @match 声明的站点注入** —— 目前仅 xn--wcv59z.com（教父）
 *    及其子域，不再匹配所有网站。注入之后仍按页面特征判断「这一页是不是资源列表页」。
 *    要加新站：@match 里加一行 `*://*.新域名/*`，同时把域名加进下面的 CONF.allowHosts。
 * 4) 跨域：115 的几个接口都不开 CORS，所以必须用油猴的 GM_xmlhttpRequest（`withCredentials` 带登录态）。
 *    控制台直接粘贴运行（没有 GM_* 权限）时只能复制磁力，推送会提示没有权限。
 * 5) ⚙ 设置分三页：「推荐口径」/「115 推送」/「评分权重」。
 *    **目录不在打开设置时就请求** —— 点「修改目录」才去 115 拉一次；账号名也只在进「115 推送」页时取。
 * 6) **打分（v1.11.0 重做的核心）**：分数只表达「画质档位」，不是把所有项累加成一个绝对分。
 *    · 进分的只有画质与内容：分辨率 / HDR·DV / 来源 / 编码 / 10bit / 帧率 / 语言 / 字幕，
 *      外加一条「码率压过头」的下限（视频本体 < 该分辨率下限就降档）。
 *    · **体积不参与计分**，多音轨也不单独扣分：音轨占的空间本来就算在体积里。
 *      两者的差别一律在**同一档内**比较 —— 画质同档的资源，按体积从小到大排。
 *      所以「同样参数下多一条音轨、体积反而更小」是加分项，会排到前面。
 *    · 分档尺度：与档首相差 ≤3 分算同一档（设备口径把 4K 压到 1080P 的 12% 之后，
 *      两条本来就该同档）。同档同分，名次由体积决定，页脚会写明。
 * 6.5) **标签行就是「对比表」（v1.12.0）**：每条资源一行 chip，体积、码率也做成 chip。
 *    · 左边＝三条都一样的项，压成冷灰，不带分数（相同的不计分，也不占注意力）。
 *    · 右边＝有差异的项，点亮，并在 chip 里直接写它值多少分：`14.49GB-3`、`50fps 补帧-3`。
 *      「有差异」的判据是**分值是否不同**，不是文案是否不同 —— DDP 与 DTS 文案不一样，
 *      但都是 5.1 有损 +2，所以归共性组、不写分。
 *    · 例外：枪版 / 无字幕 / 音轨未标注这类 warn·bad·mute 标签永远点亮，哪怕三条同分
 *      （那不是分值差异，是「这条有坑」）。
 * 6.6) **帧率 / 码率 / 音轨的好坏由脚本内置判断，不让人配（v1.12.0）**：
 *    · 帧率：原生 24p 不奖不罚；原生 ≥48fps +2；`[50帧版本]/[60帧版本]` 补帧 −3；
 *      `[插帧]` 同样 −3 —— 补帧和插帧是同一件事（拿 24p 母版算出来的中间帧，没人拍到过），
 *      同体积下帧数翻倍还意味着每帧比特被摊薄，所以这两类一律不如原生。
 *    · 码率：按视频本体体积对分辨率的合理区间判定（4K：<6 过低 / 6~9 偏低 / 9~30 合适 /
 *      >30 堆码率），过低 −12、偏低 −4、过高 −2。
 *    · 音轨：5.1 环绕 +2、立体声 0、无损 −4（电视/回音壁多半解不出，还得为它付体积）。
 * 7) 「评分权重」页是**补充**，不是主开关：先由「推荐口径」按设备定主方向，权重只在同一维度内微调。
 *    · 主界面只剩 3 个偏好滑块（字幕/语言/来源），都是跟设备无关的个人口味；
 *      分辨率/HDR/编码已被设备系数缩放，收在「设备相关」里，默认折叠。
 *      音轨品质与帧率已退出设置页 —— 它们的好坏是客观的，交给内置判断。
 *    · 滑块语义是「把这一维度整体放大几倍」，组内相对差距同比拉开，不必逐个填分数。
 *    · 5 个一键预设（均衡/画质优先/省空间/只要中字/设备兼容）；底部实时预览 TOP3 排序变化。
 *    · 想打破等比（「4K 很香但 720P 无所谓」）点该行「高级」单独调某一项。
 *    「115 推送」页点「保存并测试」会给出明确结论：登录是否有效、读到哪个账号、目录能不能访问。
 * 8) 卡片每行右侧有一句理由（v1.10.1 起）：不重复标签行已经写过的「4K / 中字」，
 *    只写**跟第 1 名/上一名差在哪** —— 同档写体积（「同档 · 省 1.18GB」），跨档写分差与原因。
 * 9) 找不到卡片时看右下角绿色小标签「片源助手」：点它展开/收起卡片；
 *    如果它显示「未识别」，点一下会弹出诊断面板，把里面的内容发我就能定位。
 * 10) 同域内某个页面没自动接管时，网址后加 ?psb_force=1 强制跑一次；
 *     站点整体换域名则要先改 @match（只加 allowHosts 已经不管用了）。
 */
(function () {
  'use strict';
  if (window.__PSB__ && window.__PSB__.version) return;

  var VERSION = '1.12.2';

  // 是否跑在 iframe 里（资源表格被站点塞进 iframe 的情况要能覆盖到）
  var IN_FRAME = (function () {
    try { return window.top !== window.self; } catch (e) { return true; }
  })();

  /* ======================= 可改配置 ======================= */

  var CONF = {
    topN: 3,                          // 卡片里保留几条
    headerSlot: true,                 // 详情页优先把卡片放进影片信息区的空白处（标题下方）；false = 始终插在资源表上方
    allowHosts: ['xn--wcv59z.com'],   // 已知资源站（换域名后 @match 与这里各加一行；域内留空也能靠磁力链接自动识别）
    blockHosts: []                    // 明确不跑的站点，如 ['taobao.com']
  };

  // 115 离线保存目录（v1.8.0）：cid=0 就是根目录，也就是 115 默认的离线下载位置。
  // 不再有 base/token —— 直连 115，鉴权靠浏览器里已登录的 cookie，脚本不落任何凭据。
  var DIR_DEFAULT = {
    cid: '0',
    name: '离线下载根目录'
  };

  // 权重：电视为主、兼顾电脑。数字就是加分，负数就是扣分。
  // 字幕口径：带中文字幕 +10，明确写「无字幕/生肉」 −14 —— 两者差 24 分，
  //   足以让「同分辨率同画质」下必定选带字幕的那条，但压不过「4K 对 1080P」的 22 分差，
  //   分辨率与 HDR 仍然是主导项。
  // 编码口径：体积相近（= 码率相近）时 x265/HEVC 优于 x264，另加 10bit 奖励（消暗场色带）。
  // 码率口径（v1.7.0）：列表页没有片长，只能按「同分辨率的体积甜点区」近似；判之前先把音轨估算的体积扣掉，
  //   免得「视频一般、音轨堆了一堆」的版本因为文件大而被当成高码好片。
  //   v1.7.0 把甜点区再切一刀：[low, good) 只给 +1，[good, hi] 才给 +4。
  //   旧版 2160p 一个 9~28GB 大区间，10.9GB 和 14.5GB 同分 ⇒ 最后只能靠「体积小优先」兜底排序，
  //   等于把「压得更狠」当成优点（实测踩过：iQIYI 10.9GB 版靠体积小反超画质更好的 14.5GB 版）。
  // 音轨口径（v1.7.0 三态）：明确写 DDP/DD/EAC3/AAC/DTS/Atmos 等有损 → +6（全设备可解）；
  //   明确写 TrueHD / DTS-HD MA / DTS:X / FLAC → −4（电视多半直通不了）；
  //   **编码压根没写的，按有损计 +6**。旧版这里给 0 分，等于「编码写得越规范越吃亏」——
  //   实测踩过：同一部片的 60fps 版因为标题没带 DDP，白掉 6 分被 50fps 版压下去。
  // 帧率口径（v1.7.0）：电影原生 23.976，标题写「50帧版本 / 60帧版本」的都是压制组后期补帧，
  //   不是原生高帧率 ⇒ **中性处理，不奖不罚**（旧版误当原生给了 +2）；
  //   真正标了「插帧 / 补帧 / interpolate」的倒扣 −4；只有剧集/体育那种原生 ≥48fps 才 +2。
  var W = {
    res2160: 30, res1080: 8, res720: -8,
    dual: 18,
    hdr10: 15,
    dvOnly: 6, dvPenalty: -8,
    lossy: 6,
    lossless: -4,
    remux: 8, bluray: 6, web: 3, cam: -14,
    h265: 5, tenbit: 3,
    mandarin: 6, cantoneseOnly: -4,
    subCn: 10, noSub: -14,
    fpsHigh: 2, fpsFake: -4,
    audioTrackLossless: 3.2, audioTrackLossy: 0.55,
    bandLow: -5
  };

  /* ---- 内置判断（v1.12.0）----
   * 他的原话：「关于帧率、码率、音频，到底哪种更好，这个不要让我自己配置了，我也不懂」。
   * 所以这三项退出权重页，好坏由脚本按「在你选的设备上值不值」直接定：
   *
   * 音频：判据不是「无损＝更高级」，而是「解不解得出、值不值那份体积」
   *   · TrueHD / DTS-HD / DTS-X：电视、回音壁、盒子大多解不出（只能降混甚至没声），
   *     还占 3.2GB/条  ⇒ −4
   *   · DDP / EAC3 / DD / DTS：有损环绕，全设备可解、体积小，最稳的一档  ⇒ +2
   *   · AAC / OPUS：只到立体声，够用但没环绕  ⇒ 0
   *   · 没写编码：按有损环绕 +2 —— 写得越规范不该越吃亏（v1.7.0 同一个坑）
   *
   * 帧率：电影原生 23.976 / 24p 才是原始素材
   *   · 「50 帧版本 / 60 帧版本」＝压制组拿 24p 补出来的，动作更顺但可能有鬼影  ⇒ −1
   *   · 明确写「插帧 / 补帧」的再差一档  ⇒ −3
   *   · 原生 ≥48fps（体育 / 动画 / 纪录）才真加分  ⇒ +1
   *
   * 码率：按「视频本体体积 vs 该分辨率的合理区间」分四档。不是越大越好 ——
   *   超上限往往只是堆码率，画质并不会等比提升，还白占硬盘。
   */
  var AUD = { lossless: -4, surround: 2, stereo: 0 };
  var AUD_2CH = /^(AAC|OPUS)$/;
  // 帧率好坏内置（v1.12.0，不收进设置页）。
  // 补帧与插帧是同一件事：都是拿 24p 母版算法生成中间帧，没人拍到过这些帧。
  // 所以两者同罚 −3，不再人为分「插帧更差」；只有原生 ≥48fps 才 +2。
  var FPS = { interp: -3, native: 2 };
  var RATE = { low: -12, thin: -4, over: -2, ok: 0 };
  var RATE_TXT = { low: '码率过低', thin: '码率偏低', over: '码率过高', ok: '码率合适' };

  // 视频部分的体积甜点区（GB，按 2 小时正片估算）。
  // low 以下 = 压得过头；[low, good) = 偏低但能看；[good, hi] = 甜点；hi 以上 = 边际收益递减。
  // 体积 / 码率合理区间（GB，视频本体，已扣掉音轨估算）。
  // v1.12.0 下调：旧值 4K 要 12GB 才算「不偏低」，可现实里 4K WEB-DL 普遍 8~15GB，
  // 结果整页资源都被标「码率偏低」，标签失去区分力。新值按实际片源分布定：
  //   4K：<6 压狠了 / 6~9 偏低 / 9~30 合理 / >30 堆码率
  //   1080：<1.5 / 1.5~3 / 3~16 / >16
  var BAND = {
    2160: { low: 6, good: 9, hi: 30 },
    1080: { low: 1.5, good: 3, hi: 16 },
    720: { low: 1, good: 1.8, hi: 5 }
  };

  /* ======================= 推荐口径（v1.9.0）=======================
   * 同一份资源，摆在不同设备上的「实际收益」不一样：
   *   手机 6.7″ 上 4K 和 1080P 肉眼几乎分不出，但体积差 4 倍；
   *   电脑显示器对「仅 DV」最不友好（Windows 播放器普遍偏色）；
   *   大屏电视才真的用得上 4K / HDR。
   * 下面的系数是「相对基准的收益系数」，实际使用时都会 **除以默认口径的同类系数**，
   * 所以默认口径（电视 65 + 电脑 27）下每个系数都恰好是 1.0 ——
   * 也就是：不动设置时，分数与 v1.8.0 逐条完全一致（有回归测试兜着）。
   *
   * 多选设备时的合成规则：画质类维度（分辨率/HDR/DV/音轨）取**最大**收益，
   * 体积预算（band）取**最小** —— 你既然有电视就按电视挑画质，同时按最省空间那台卡体积。
   */
  var DEV = {
    tv:    { label: '电视', slabel: '电视', sizes: [55, 65, 75, 85], ref: 65,  res: 1.00, hdr: 1.00, dv: 0.50, aud: 1.00, band: 1.00 },
    pc:    { label: '电脑', slabel: '电脑显示器', sizes: [24, 27, 32, 34], ref: 27,  res: 0.55, hdr: 0.50, dv: 1.50, aud: 1.00, band: 0.85 },
    phone: { label: '手机', slabel: '手机', sizes: [6.1, 6.7, 6.9], ref: 6.7, res: 0.12, hdr: 0.15, dv: 0.25, aud: 1.20, band: 0.45 }
  };
  var DEV_ORDER = ['tv', 'pc', 'phone'];
  // 默认口径 = v1.8.0 的「电视为主 · 兼顾电脑」
  var PROF_DEFAULT = { tv: 65, pc: 27 };

  // 把「尺寸差」折成轻微的画质敏感度修正：85″ 比 65″ 更能看出 4K 的差别，但差不了多少。
  function sizeFactor(dev, size) {
    var ratio = Number(size) / dev.ref;
    if (!isFinite(ratio) || ratio <= 0) return 1;
    return Math.max(0.8, Math.min(1.3, 1 + (ratio - 1) * 0.6));
  }

  function rawFactors(prof) {
    var best = { res: 0, hdr: 0, dv: 0, aud: 0 }, band = 1e9, any = false;
    DEV_ORDER.forEach(function (k) {
      if (prof[k] === null || typeof prof[k] === 'undefined') return;
      var dev = DEV[k];
      any = true;
      var f = sizeFactor(dev, prof[k]);
      best.res = Math.max(best.res, dev.res * f);
      best.hdr = Math.max(best.hdr, dev.hdr * f);
      best.dv = Math.max(best.dv, dev.dv);
      best.aud = Math.max(best.aud, dev.aud);
      band = Math.min(band, dev.band);
    });
    if (!any) {  // 理论上不会发生（保存时保证至少一台），兜底用默认
      var d = rawFactors(PROF_DEFAULT);
      return d;
    }
    best.band = band;
    return best;
  }

  var _baseF = null;
  function factors(prof) {
    if (!_baseF) _baseF = rawFactors(PROF_DEFAULT);
    var raw = rawFactors(prof || PROF_DEFAULT), out = {};
    Object.keys(raw).forEach(function (k) {
      var b = _baseF[k];
      out[k] = b ? raw[k] / b : 1;
    });
    return out;
  }

  /* ---- 配置存取：口径 + 权重（一个 key 存完，坏数据自动回落默认）---- */
  var CFG_KEY = 'psb_cfg';
  var ACT = null, _eff = null;

  function cfgDefaults() {
    var w = {};
    Object.keys(W).forEach(function (k) { w[k] = W[k]; });
    var prof = {};
    Object.keys(PROF_DEFAULT).forEach(function (k) { prof[k] = PROF_DEFAULT[k]; });
    return { prof: prof, w: w };
  }

  function sanitizeCfg(raw) {
    var d = cfgDefaults();
    if (!raw) return d;
    var o;
    try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return d; }
    if (!o || typeof o !== 'object') return d;

    // 口径：只认 DEV 里有的设备，尺寸必须在允许列表里（不支持自定义尺寸）
    if (o.prof && typeof o.prof === 'object') {
      var prof = {};
      DEV_ORDER.forEach(function (k) {
        var v = o.prof[k];
        if (v === null || typeof v === 'undefined' || v === false) return;
        var n = Number(v);
        if (DEV[k].sizes.indexOf(n) >= 0) prof[k] = n;
      });
      if (Object.keys(prof).length) d.prof = prof;
    }

    // 权重：只认 W 里已有的键（以后新增的键自动拿默认值），必须是有限数字。
    // 同时把数值收回 0.5~1.5 倍量程内 —— 早期版本允许 0~3 倍，旧配置可能在区间外。
    if (o.w && typeof o.w === 'object') {
      Object.keys(W).forEach(function (k) {
        if (typeof o.w[k] === 'undefined' || o.w[k] === null || o.w[k] === '') return;
        var v = Number(o.w[k]);
        if (!isFinite(v)) return;
        d.w[k] = Math.round(W[k] * multRound(v / W[k], keyMax(k)) * 100) / 100;
      });
    }
    return d;
  }

  function cfg() {
    if (!ACT) ACT = sanitizeCfg(store.get(CFG_KEY, ''));
    return ACT;
  }

  // 改完配置统一走这里：作废缓存 → 下次 analyze 用新系数
  function saveCfg(next) {
    ACT = sanitizeCfg(next);
    _eff = null;
    store.set(CFG_KEY, JSON.stringify(ACT));
    return ACT;
  }

  function resetCfg() {
    store.set(CFG_KEY, '');
    ACT = null;
    _eff = null;
    return cfg();
  }

  // wBase 省略时用已保存的 cfg().w。权重页的「实时预览」会传入草稿权重，
  // 走同一条换算链（含设备系数），保证预览分数与真实卡片逐位一致。
  function computeEffW(wBase) {
    var f = factors(cfg().prof), w = {}, src = wBase || cfg().w;
    Object.keys(W).forEach(function (k) { w[k] = Number(src[k]); });
    w.res2160 *= f.res; w.res1080 *= f.res; w.res720 *= f.res;
    w.dual *= f.hdr; w.hdr10 *= f.hdr;
    w.dvOnly *= f.dv; w.dvPenalty *= f.dv;
    w.lossless *= f.aud;
    return w;
  }

  // 临时权重（v1.10.0）：预览时在不改全局状态的前提下换一套权重跑 analyze，
  // 结束后原样还回去 —— 任何异常都不会把临时权重漏到真实打分里。
  var _wOverride = null;
  function effW() {
    if (_wOverride) return _wOverride;
    if (!_eff) _eff = computeEffW();
    return _eff;
  }
  function withW(wBase, fn) {
    var old = _wOverride;
    _wOverride = computeEffW(wBase);
    try { return fn(); } finally { _wOverride = old; }
  }

  function effBand(res) {
    var b = BAND[res] || BAND[1080], f = factors(cfg().prof).band;
    return { low: b.low * f, good: b.good * f, hi: b.hi * f };
  }

  function profileLabel() {
    var p = cfg().prof, parts = [];
    DEV_ORDER.forEach(function (k) {
      if (p[k] === null || typeof p[k] === 'undefined') return;
      parts.push(DEV[k].label + p[k] + '″');
    });
    return parts.length ? parts.join(' + ') : '未设口径';
  }

  // 显示用：权重可能被设备系数乘成 7.500000001，统一收两位小数
  function N(v) { return Math.round(Number(v) * 100) / 100; }

  /* ======================= 小工具 ======================= */

  var store = {
    get: function (k, d) {
      try {
        if (typeof GM_getValue === 'function') {
          var v = GM_getValue(k, null);
          return v === null || v === undefined ? d : v;
        }
        var s = localStorage.getItem(k);
        return s === null ? d : s;
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try {
        if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; }
        localStorage.setItem(k, v);
      } catch (e) { /* 忽略 */ }
    }
  };

  // 只存「推到哪个目录」，不存任何凭据 —— 登录态始终由浏览器保管
  function loadDir() {
    var raw = store.get('psb_115dir', '');
    var d = { cid: DIR_DEFAULT.cid, name: DIR_DEFAULT.name, path: [] };
    if (raw) {
      try {
        var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (o && typeof o === 'object' && o.cid) {
          d.cid = String(o.cid);
          d.name = o.name || d.name;
          d.path = Array.isArray(o.path) ? o.path : [];
        }
      } catch (e) { /* 坏数据用默认 */ }
    }
    return d;
  }

  function saveDir(d) {
    store.set('psb_115dir', JSON.stringify({
      cid: String(d.cid || '0'),
      name: d.name || DIR_DEFAULT.name,
      path: Array.isArray(d.path) ? d.path : []
    }));
  }

  /* ---- 115 Cookie（选填，v1.8.0）----
   * 默认不填：靠 withCredentials 让浏览器把 115.com 的登录态带上去。
   * 填了：用你填的这份覆盖，用于「自动带不上 / cookie 过期但懒得重登 / 想推另一个号」。
   * 只存在本机油猴存储（GM_setValue），不外发、不写日志、诊断面板只报长度不报内容。
   */
  function loadCookie() {
    return String(store.get('psb_115cookie', '') || '').trim();
  }

  function saveCookie(raw) {
    store.set('psb_115cookie', normalizeCookie(raw));
  }

  // Cookie 取用方式（v1.9.0）：auto = 交给浏览器（withCredentials 自动带登录态）；
  // manual = 用设置里填的那份。旧的「填了就用」行为在迁移时按 manual 处理，不丢配置。
  function loadCkMode() {
    var m = String(store.get('psb_115ckmode', '') || '');
    if (m === 'manual' || m === 'auto') return m;
    return loadCookie() ? 'manual' : 'auto';
  }

  function saveCkMode(m) {
    store.set('psb_115ckmode', m === 'manual' ? 'manual' : 'auto');
  }

  // 把用户可能粘的几种形态统一成 `UID=..; CID=..; SEID=..; KID=..`
  function normalizeCookie(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    // ① JSON：{"UID":"...","CID":"...","KID":"...","SEID":"..."}
    if (s.charAt(0) === '{') {
      try {
        var o = JSON.parse(s);
        var parts = [];
        ['UID', 'CID', 'SEID', 'KID'].forEach(function (k) {
          var v = o[k] || o[k.toLowerCase()];
          if (v) parts.push(k + '=' + v);
        });
        if (parts.length) return parts.join('; ');
      } catch (e) { /* 不是 JSON，往下走 */ }
    }
    // ② 很多人是从 DevTools 一行一个复制出来的，先把换行当分隔符
    s = s.replace(/[\r\n]+/g, '; ').replace(/;\s*;+/g, ';');
    // ③ 从 document.cookie 或 DevTools 整串里挑出这四个（其余如 acw_tc / _t 之类丢掉）
    var want = { UID: 1, CID: 1, SEID: 1, KID: 1 };
    var hit = [];
    s.split(/;\s*/).forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = kv.slice(0, i).trim();
      var v = kv.slice(i + 1).trim();
      if (want[k] && v) hit.push(k + '=' + v);
    });
    if (hit.length) return hit.join('; ');
    // ④ 认不出来就原样用（至少不拦着用户）
    return s.trim();
  }

  function sq(el) { return ' ' + String(el || '').replace(/\s+/g, ' ') + ' '; }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (!text) { resolve(false); return; }
      try {
        if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); resolve(true); return; }
      } catch (e) { /* 继续降级 */ }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacyCopy(text)); });
        return;
      }
      resolve(legacyCopy(text));
    });
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-2000px;left:-2000px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ======================= 115 直连（v1.8.0） ======================= */

  // 115 这几个接口都不开 CORS，必须走油猴通道；withCredentials 让它带上浏览器里已登录的 115 cookie。
  // 实测口径（2026-10，未登录时的真实回包已逐条核对过）：
  //   登录态  GET  https://115.com/?ct=offline&ac=space                     → {state:true}；未登录 {state:false,errno:99,error_msg:"请重新登录"}
  //   列目录  GET  https://aps.115.com/natsort/files.php?cid=..&show_dir=1  → {state:true,data:[{cid,n}]}；未登录 {state:false,error:"请先登录"}
  //   加任务  POST https://115.com/web/lixian/?ct=lixian&ac=add_task_url    → {state:true}；重复任务 errtype=war / errcode=10008
  var V115 = {
    space: 'https://115.com/?ct=offline&ac=space',
    files: 'https://aps.115.com/natsort/files.php',
    addTask: 'https://115.com/web/lixian/?ct=lixian&ac=add_task_url'
  };

  // 统一出口。返回 {ok:true,data} 只代表「拿到了 JSON」，业务成功与否由调用方看 state。
  function v115Fetch(method, url, opts) {
    opts = opts || {};
    if (typeof GM_xmlhttpRequest !== 'function') {
      return Promise.resolve({
        ok: false,
        error: '没有油猴跨域权限，推不了 115。请用 Tampermonkey 安装本脚本，别用控制台直接粘贴。'
      });
    }
    // 复制一份再改，别污染调用方传进来的对象
    var headers = {};
    Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
    // 手动 cookie 优先（仅在「自己填」模式下才发）；否则交给 withCredentials 自动带浏览器里的登录态
    var manual = loadCkMode() === 'manual' ? loadCookie() : '';
    if (manual) headers['Cookie'] = manual;

    return new Promise(function (resolve) {
      try {
        GM_xmlhttpRequest({
          method: method,
          url: url,
          headers: headers,
          data: opts.data || null,
          timeout: 20000,
          withCredentials: true,   // 关键：带上浏览器里 115.com 的登录态；脚本本身不存任何凭据
          onload: function (r) {
            var d = null;
            try { d = r.responseText ? JSON.parse(r.responseText) : null; } catch (e) { d = null; }
            if (!d) {
              resolve({ ok: false, error: '115 没返回 JSON（大概率是登录态没了）', status: r.status });
              return;
            }
            resolve({ ok: true, data: d, status: r.status });
          },
          onerror: function () { resolve({ ok: false, error: '连不上 115（网络问题或被拦）' }); },
          ontimeout: function () { resolve({ ok: false, error: '115 响应超时' }); }
        });
      } catch (e) {
        resolve({ ok: false, error: '请求发送失败：' + e.message });
      }
    });
  }

  // 115 的「未登录」有好几种写法（errno=99 / error:"请先登录" / error_msg:"请重新登录"），统一收口
  function v115AuthError(d) {
    var msg = (d && (d.error_msg || d.error || d.msg)) || '';
    if (d && (d.errno === 99 || d.errcode === 99)) {
      return { ok: false, needLogin: true, error: '115 登录态过期了，去 115.com 重新登录一次' };
    }
    if (/登录/.test(msg)) {
      return { ok: false, needLogin: true, error: '还没登录 115（先在浏览器打开 115.com 登录一次）' };
    }
    return null;
  }

  // 登录态检测：同时验证「油猴能带上 cookie」这件事本身成不成立
  function check115Login() {
    return v115Fetch('GET', V115.space + '&t=' + Date.now(), {
      headers: { 'Accept': 'application/json', 'Referer': 'https://115.com/' }
    }).then(function (r) {
      if (!r.ok) return r;
      var d = r.data || {};
      if (d.state === true) return { ok: true, manual: !!loadCookie() };
      return v115AuthError(d) || { ok: false, error: (d && (d.error_msg || d.error)) || '115 登录态异常' };
    });
  }

  // 取当前登录账号的昵称 —— 只用于设置面板显示，不落盘、不上报。
  // 实测（2026-10，未登录回包已核对）：webapi.115.com/user/info → {state:false,errno:990001,error:"登录超时，请重新登录。"}
  // 登录后 data 里可能是 nick_name / user_name / uname 之一，多键兜底；实在取不到就退回 UID。
  function fetch115Account() {
    return v115Fetch('GET', 'https://webapi.115.com/user/info?t=' + Date.now(), {
      headers: { 'Accept': 'application/json', 'Referer': 'https://115.com/' }
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: r.error || '取账号失败' };
      var d = r.data || {};
      if (d.state !== true) {
        return v115AuthError(d) || {
          ok: false,
          error: (d.error_msg || d.error || d.msg) || '取账号失败'
        };
      }
      var u = d.data || {};
      var name = u.nick_name || u.nickname || u.user_name || u.username || u.uname || u.name || '';
      var uid = u.user_id || u.uid || u.id || '';
      return { ok: true, name: String(name || ''), uid: String(uid || '') };
    });
  }

  // 列某个目录下的子文件夹。115 没有「目录树」专用接口，
  // 是拿文件列表接口加 show_dir=1 让服务端只回文件夹，再按「有 cid、无 fid/sha1」二次过滤。
  function list115Folders(cid) {
    var url = V115.files + '?aid=1&cid=' + encodeURIComponent(cid || '0') +
      '&offset=0&limit=300&show_dir=1&natsort=1&format=json&t=' + Date.now();
    return v115Fetch('GET', url, {
      headers: { 'Accept': 'application/json', 'Referer': 'https://115.com/' }
    }).then(function (r) {
      if (!r.ok) return r;
      var d = r.data || {};
      if (d.state !== true) {
        return v115AuthError(d) || { ok: false, error: (d.error || d.error_msg || d.msg) || '取目录列表失败' };
      }
      var arr = Array.isArray(d.data) ? d.data : [];
      var folders = arr.filter(function (it) {
        return it && it.cid && it.n && typeof it.fid === 'undefined' && typeof it.sha1 === 'undefined';
      }).map(function (it) {
        return { cid: String(it.cid), name: String(it.n) };
      });
      return { ok: true, folders: folders };
    });
  }

  function add115Task(magnet, cid) {
    return v115Fetch('POST', V115.addTask, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Referer': 'https://115.com/',
        'Origin': 'https://115.com'
      },
      data: 'url=' + encodeURIComponent(magnet) + '&wp_path_id=' + encodeURIComponent(cid || '0')
    }).then(function (r) {
      if (!r.ok) return r;
      var d = r.data || {};
      if (d.state === true) return { ok: true };
      // 重复任务 115 按「警告」回，不算失败
      if (d.errtype === 'war' || d.errcode === 10008) {
        return { ok: true, dup: true, message: d.error_msg || d.msg || '' };
      }
      return v115AuthError(d) || { ok: false, error: (d.error_msg || d.error || d.msg) || '115 拒了这条任务' };
    });
  }

  function pushTo115(magnet) {
    if (!magnet) return Promise.resolve({ ok: false, error: '这一行没抓到磁力链接' });
    var dir = loadDir();
    return add115Task(magnet, dir.cid).then(function (r) {
      if (!r.ok) return r;
      return { ok: true, dup: !!r.dup, dir: dir.name, message: r.message || '' };
    });
  }

  /* ======================= 解析层 ======================= */

  var RE = {
    dv: /\b(dv|dovi|dolby\s*vision)\b|杜比视界|杜比視界/i,
    // HDR 是最容易被粘连吃掉的一项（`4KHDR`、`HDR2160p` 都常见）⇒ 不加前置 \b
    //（`/i` 下 `[^a-z]` 会连大写一起排除，`4KHDR` 里 HDR 前面正是 K，加了反而认不出）
    hdr: /hdr(10\+?|10plus)?(?![a-z])/i,
    lossless: /truehd|dts-?hd|dts-?x\b|flac|\bpcm\b/i,
    // 有损音轨：v1.7.0 补上「裸 DD / Dolby Digital 5.1」和「普通 DTS（非 HD/X）」——
    // 旧版这两个写法都不命中，导致标题写 `DD5.1` / `DTS 5.1` 的版本被当成「没有音轨信息」白掉 6 分。
    // ⚠️ `DD5.1` 里的 dd 后面紧跟数字（单词字符），`\bdd\b` 不成立，必须显式写 `dd\s*[5-9]`
    // 有损音轨：`DTS5.1` / `AAC2.0` 这种「编码名紧跟数字」的写法，尾部用 \b 会失效
    //（`s` 和 `5` 都是词字符，中间没有边界）—— 截图里 DTS5.1、AAC2.0 被判成「音轨未标注」就是这个坑。
    // 改用 `(?![a-z])`：只要求后面不是小写字母，数字、点、空格都能通过。
    lossy: /\b(ddp|dd\+|dd|eac3|ac-?3|aac|atmos|dts|opus)(?![a-z])/i,
    remux: /remux/i,
    bluray: /blu-?ray|bdrip|\buhd\b/i,
    web: /web-?dl|webrip|web-?rip|dsnp|dsny|hmax|atvp|itunes/i,
    cam: /hdcam|hdts|hd-?ts|\bcam\b|telesync/i,
    h265: /x265|h\.?265|hevc/i,
    h264: /x264|h\.?264|\bavc\b/i,
    tenbit: /10-?bit/i,
    mandarin: /国语|國語|普通话|mandarin|国英|國英|国粤|國粵/i,
    cantonese: /粤语|粵語|cantonese|粤英|粵英|国粤|國粵/i,
    // 中文字幕：站点常见写法是 `[国英多音轨+简繁英字幕]`，也有 `中字` / `CHS` / `multisubs`
    subCn: /字幕|中字|简中|繁中|简繁|简体|繁體|繁体|\bsubs?\b|\bchs\b|\bcht\b|\bchi\b/i,
    // 明确「没有字幕」——必须先判它，否则 `无字幕` 会被上面的 `字幕` 命中
    noSub: /无字幕|無字幕|无中字|無中字|无中文|生肉|\bnosubs?\b|\bnosubs\b/i,
    // 伪高帧率：站点上有些「60fps 插帧版」，是拿 24fps 补出来的，不是原生
    fakeFps: /插帧|插幀|补帧|補幀|interpolat|smooth\s*motion/i,
    // 「50帧版本 / 60帧版本」这种标注 = 压制组后期补的，电影原生是 23.976，
    // 但压制组没写「插帧」字样，旧版认不出来 ⇒ 被当成原生高帧率白加 2 分
    // 「XX帧版本 / XX帧率版本 / XXfps 版」都是压制组后期补帧。必须有「版」字 ——
    // 否则 `[24帧]` 这种原生标注会被误判成补帧版。
    fpsVer: /\d{2,3}\s*帧(?:率)?\s*版|\d{2,3}\s*fps\s*(?:版|version)/i
  };

  // 帧率：`60fps` / `50 帧` 这类；没写就是 0（不判）
  function fpsOf(t) {
    var m = String(t || '').match(/(\d{2,3})\s*(?:fps|帧)/i);
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return n >= 20 && n <= 240 ? n : 0;
  }

  // 音轨条数：先从明确写法数（`3Audios`），再从语言标记推（`国粤英` = 3，`国英` = 2），最后默认 1
  function audioCount(t) {
    var s = String(t || '');
    var m = s.match(/(\d+)\s*(?:audio|audios|音轨|音軌|條音軌|条音轨)/i);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n >= 1 && n <= 10) return n;
    }
    if (/国粤英|國粵英|国粵英/i.test(s)) return 3;
    if (/国英|國英|国粤|國粵|粤英|粵英/i.test(s)) return 2;
    if (/多音轨|多音軌|multi[\s-]?audio|dual[\s-]?audio|双音轨|雙音軌/i.test(s)) return 2;
    return 1;
  }

  // 分辨率判定：以「2160p / 1080p / 720p」这种明确标记为准，
  // 都找不到才退回 4K / UHD 这类关键词。
  // ⚠️ 必须这样：`UHD WEBRip 1080p` 这种 1080p 资源名字里带 UHD，按关键词判会当成 4K。
  function resOf(t) {
    var m = t.match(/\b(4320|2160|1440|1080|720|576|480)p\b/i);
    if (m) return parseInt(m[1], 10);
    if (/\b(4k|uhd)\b/i.test(t)) return 2160;
    if (/\b2k\b/i.test(t)) return 1440;
    return 0;
  }

  function parseSize(text) {
    // ⚠️ 单元尾不能写 \b：真实站点的单元格是直连输出的（`7.81GB26` 表示 7.81GB / 26 个做种），
    //    `GB` 后面紧跟数字时 \b 不成立，整个体积就解析不出来。所以用「后面不是字母」来断。
    var re = /(\d+(?:\.\d+)?)\s*(TiB|GiB|GB|G|MiB|MB|M)(?![A-Za-z])/gi, m, best = 0;
    while ((m = re.exec(String(text || '')))) {
      var v = parseFloat(m[1]), u = m[2].toUpperCase(), gb;
      if (u.charAt(0) === 'T') gb = v * 1024;
      else if (u.charAt(0) === 'M') gb = v / 1024;
      else gb = v;
      if (gb > best) best = gb;
    }
    return best ? Math.round(best * 100) / 100 : 0;
  }

  // 具体音轨编码名（v1.9.1）。旧版标签一律写「DDP/EAC3」，把 DTS 5.1 和 DDP 5.1 归成同一个词，
  // 正好把「两条资源的差异」抹平成「标签一样」—— 这跟自己要解决的「一眼看出差异」直接打架。
  // ⚠️ 顺序即优先级：TrueHD / DTS-HD 必须排在 DTS 前面，否则 DTS-HD 会被认成 DTS。
  // ⚠️ `\bddp` / `\bdd(?!p)`：`DDP5.1` 里 `p` 和 `5` 都是词字符，`\bddp\b` 会失效（v1.7.0 同一个坑）。
  function codecOf(text) {
    var s = String(text || '');
    if (/truehd/i.test(s)) return 'TrueHD';
    if (/dts[-\s]?hd/i.test(s)) return 'DTS-HD';
    if (/dts[-\s]?x\b/i.test(s)) return 'DTS-X';
    if (/\bdts(?![a-z])/i.test(s)) return 'DTS';
    if (/eac3|\bddp|dd\+/i.test(s)) return 'DDP';
    if (/\bac-?3(?![a-z])|\bdd(?!p)/i.test(s)) return 'DD';
    if (/\baac(?![a-z])/i.test(s)) return 'AAC';
    if (/\bflac(?![a-z])/i.test(s)) return 'FLAC';
    if (/\bopus(?![a-z])/i.test(s)) return 'OPUS';
    if (/\bpcm(?![a-z])/i.test(s)) return 'PCM';
    if (/\batmos(?![a-z])/i.test(s)) return 'Atmos';
    return '';
  }

  /* ---- 排序（v1.11.0）：先分档，档内按体积 ----
   * 他的判断：「画质、体积、音轨、字幕这些应该在**其他参数相同**的情况下再对比」，
   * 「相同标签体积更大，这本来就应该减分」。
   * 所以分数只当档位用：与档首相差 ≤TIER_NEAR 的算同一档（这个量级是设备口径压缩后的
   * 噪声 —— 手机把 4K 压到 1080P 的 12% 之后，两条本来就该同一档），
   * 档内一律按体积从小到大；体积大不是扣分，是排后面。
   * 同时把显示分统一成档首分，避免出现「28 分排在 25 分后面」这种看着像 bug 的画面。
   */
  var TIER_NEAR = 3;

  function rankByTier(infos) {
    var order = infos.map(function (_, i) { return i; }).sort(function (a, b) {
      return (infos[b].score - infos[a].score) || ((infos[a].gb || 1e9) - (infos[b].gb || 1e9));
    });
    var tid = -1, head = null;
    order.forEach(function (i) {
      var sc = infos[i].score;
      if (head === null || head - sc > TIER_NEAR) { tid++; head = sc; }
      infos[i].tier = tid;
      infos[i].showScore = head;
    });

    // 档内体积分（v1.12.0）：同一档里体积最小的那条为 0 分，其余每大 10% 记 −1（最多 −15）。
    // 这个分**不进总分**（总分只表示画质档位），只做两件事：
    //   ① 档内排序（等于按体积从小到大）；② 显示在体积标签上，让人看到「多占了多少」。
    // 用百分比而不是绝对值：10.9→11.9 和 20→21.8 都是「多一成」，观感才一致。
    var groups = {};
    order.forEach(function (i) {
      var t = infos[i].tier;
      (groups[t] || (groups[t] = [])).push(i);
    });
    Object.keys(groups).forEach(function (t) {
      var g = groups[t], min = 1e9;
      g.forEach(function (i) { if (infos[i].gb && infos[i].gb < min) min = infos[i].gb; });
      g.forEach(function (i) {
        var v = 0;
        if (infos[i].gb && min < 1e9) {
          v = -Math.min(15, Math.round((infos[i].gb / min - 1) * 10)) || 0;
        }
        infos[i].volScore = v;
      });
    });

    order.sort(function (a, b) {
      return (infos[a].tier - infos[b].tier) ||
        ((infos[b].volScore || 0) - (infos[a].volScore || 0)) ||
        ((infos[a].gb || 1e9) - (infos[b].gb || 1e9));
    });
    return order;
  }

  function analyze(text) {
    var t = sq(text);
    var w = effW();
    var p = {
      res: resOf(t),
      dv: RE.dv.test(t),
      hdrMark: RE.hdr.test(t),
      lossless: RE.lossless.test(t),
      remux: RE.remux.test(t),
      bluray: RE.bluray.test(t),
      web: RE.web.test(t),
      cam: RE.cam.test(t),
      h265: RE.h265.test(t),
      h264: RE.h264.test(t),
      tenbit: RE.tenbit.test(t),
      mandarin: RE.mandarin.test(t),
      cantonese: RE.cantonese.test(t),
      sub: RE.subCn.test(t),
      noSub: RE.noSub.test(t),
      fps: fpsOf(t),
      fakeFps: RE.fakeFps.test(t),
      fpsVer: RE.fpsVer.test(t),
      audioN: audioCount(t),
      gb: parseSize(t)
    };
    // 音轨三态：明确无损 / 明确有损 / 没写编码。
    // 没写编码的一律按有损处理 —— 否则「编码写得越规范越吃亏」（v1.7.0 修）
    p.lossyMark = RE.lossy.test(t);
    p.audUnknown = !p.lossless && !p.lossyMark;
    p.lossy = !p.lossless;
    p.audioCodec = codecOf(t);

    // 音轨估算体积：无损一条按 3.2GB、有损一条按 0.55GB
    var agb = Math.round(p.audioN * (p.lossless ? w.audioTrackLossless : w.audioTrackLossy) * 100) / 100;

    var hdrType = 'none';
    if (p.dv && p.hdrMark) hdrType = 'dual';
    else if (p.dv) hdrType = 'dv';
    else if (p.hdrMark) hdrType = 'hdr10';

    var score = 0, why = [], hits = [];
    // hits = 「每一项各贡献多少分」的结构化版本，供卡片右侧写理由（v1.10.1）。
    // why 是给人读的长句，hits 要能跨资源做减法；k 必须跨行一致，
    // 否则 AAC 与 DDP 会被当成两个不同项，差值算不出来。
    function hit(k, t, v) { hits.push({ k: k, t: t, v: Math.round(v * 10) / 10 }); }

    if (p.res === 2160) { score += w.res2160; hit('res', '4K', w.res2160); why.push('4K +' + N(w.res2160)); }
    else if (p.res === 1080) { score += w.res1080; hit('res', '1080P', w.res1080); why.push('1080P +' + N(w.res1080)); }
    else if (p.res === 720) { score += w.res720; hit('res', '720P', w.res720); why.push('720P ' + N(w.res720)); }

    if (hdrType === 'dual') { score += w.dual; hit('hdr', 'HDR+DV', w.dual); why.push('HDR+DV 双版本（电视上 DV，电脑回落 HDR10） +' + N(w.dual)); }
    else if (hdrType === 'hdr10') { score += w.hdr10; hit('hdr', 'HDR10', w.hdr10); why.push('HDR10，两端都不偏色 +' + N(w.hdr10)); }
    else if (hdrType === 'dv') {
      var dvScore = N(w.dvOnly + w.dvPenalty);
      score += dvScore;
      hit('hdr', '仅DV', dvScore);
      why.push('仅杜比视界（Windows 上易偏色） ' + dvScore);
    }

    // 音轨：好坏内置（v1.12.0），见文件上方 AUD 表
    var aqV = p.lossless ? AUD.lossless
      : (AUD_2CH.test(p.audioCodec) ? AUD.stereo : AUD.surround);
    score += aqV;
    hit('audio', p.audioCodec || (p.lossless ? '无损音轨' : '音轨'), aqV);
    why.push(p.lossless
      ? 'TrueHD/DTS-HD 无损音轨 ' + N(aqV) + '（电视/回音壁常解不出，还占 ' + w.audioTrackLossless + 'GB/条）'
      : (p.lossyMark
        ? (AUD_2CH.test(p.audioCodec)
          ? '有损立体声 ' + N(aqV) + '（只到 2.0，兼容最好但没有环绕）'
          : '有损环绕 ' + N(aqV) + '（全设备可解，最稳的一档）')
        : '音轨编码未标注，按有损环绕计 ' + N(aqV) + '（没写不等于差）'));

    // 多音轨不再单独扣分（v1.11.0）。
    // 他原话：「同样的参数多了一条音轨体积反而小了，在这个情境下它应该是一个加分项才对」。
    // 音轨多不是错，白占空间才是错 —— 而它占的空间已经算在 gb 里了，
    // 由「同档内按体积从小到大排」自然体现，再按条数扣一次就是双重惩罚。
    var extraAud = Math.max(0, p.audioN - 1);
    if (extraAud > 0) why.push('多 ' + extraAud + ' 条音轨（估算占 ' + agb + 'GB，已计入体积，不再单独扣分）');

    if (p.remux) { score += w.remux; hit('src', 'REMUX', w.remux); why.push('REMUX +' + N(w.remux)); }
    else if (p.bluray) { score += w.bluray; hit('src', '蓝光', w.bluray); why.push('蓝光源 +' + N(w.bluray)); }
    else if (p.web) { score += w.web; hit('src', 'WEB', w.web); why.push('WEB 源 +' + N(w.web)); }
    if (p.cam) { score += w.cam; hit('cam', '枪版', w.cam); why.push('枪版/TS ' + N(w.cam)); }

    if (p.h265) { score += w.h265; hit('codec', 'x265', w.h265); why.push('x265/HEVC（同体积下画质更好） +' + N(w.h265)); }
    else if (p.h264) { why.push('x264/AVC（同体积下效率低于 x265，但兼容性最好）'); }
    if (p.tenbit) { score += w.tenbit; hit('tenbit', '10bit', w.tenbit); why.push('10bit（暗场渐变更少色带） +' + N(w.tenbit)); }

    // 帧率：好坏内置（v1.12.0），见文件上方 FPS 表。
    // v1.11.0 之前「50帧版本/60帧版本」按中性处理（0 分），于是同画质下补帧版和原生版
    // 拿一样的分 —— 但他会问「60 帧为什么没优势」。现在明确：补帧不如原生，−1。
    if (p.fakeFps) {
      score += FPS.interp;
      hit('fps', '插帧', FPS.interp);
      why.push('插帧版：中间帧是算法猜的，快速运动会有鬼影/撕裂 ' + N(FPS.interp));
    } else if (p.fpsVer) {
      score += FPS.interp;
      hit('fps', (p.fps || '高') + 'fps 补帧', FPS.interp);
      why.push((p.fps || '高') + 'fps 补帧版：拿 24p 母版补出来的假帧，同体积下画质反而被摊薄 ' + N(FPS.interp));
    } else if (p.fps >= 48) {
      score += FPS.native;
      hit('fps', p.fps + 'fps', FPS.native);
      why.push(p.fps + 'fps 原生高帧率（体育/综艺/动画才用得上） +' + N(FPS.native));
    }

    if (p.mandarin) { score += w.mandarin; hit('lang', '国语', w.mandarin); why.push('含国语 +' + N(w.mandarin)); }
    else if (p.cantonese) { score += w.cantoneseOnly; hit('lang', '仅粤语', w.cantoneseOnly); why.push('仅粤语（无国语） ' + N(w.cantoneseOnly)); }

    // 字幕：先判「明确没有」，否则 `无字幕` 会被「字幕」关键词吃掉
    if (p.noSub) { score += w.noSub; hit('sub', '无字幕', w.noSub); why.push('标注无字幕（要另找字幕） ' + N(w.noSub)); }
    else if (p.sub) { score += w.subCn; hit('sub', '中字', w.subCn); why.push('带中文字幕 +' + N(w.subCn)); }

    // 码率：先扣掉音轨估算值，只看「视频那部分」是否落在该分辨率的甜点区。
    // 这样「视频一般、音轨堆了三四条」的版本不会因为文件大就被当成高码好片。
    // v1.9.0：甜点区会按设备口径缩放（手机/小屏把预算卡得更紧）。
    // 体积不再参与总分（v1.11.0）—— 他的判断是「相同标签下体积更大，本来就该减分」，
    // 而减分的方式不是给体积打一个分，而是**同档内按体积从小到大排**（见 scan 的排序键）。
    // 这里只保留一条「画质可疑」的下限：视频本体小于该分辨率的下限值，说明压过头了，降档。
    // 区间内、超大文件都不再加分也不扣分，交给同档比较去分先后。
    var vgb = 0, rateLv = '';
    if (p.gb) {
      vgb = Math.max(p.gb * 0.3, p.gb - agb);
      vgb = Math.round(vgb * 100) / 100;
      var band = effBand(p.res);
      // 码率四档（v1.12.0，内置）：过低 / 偏低 / 合适 / 过高。
      // 之所以给「过高」也扣一点：同分辨率下把码率堆到甜点区之外，画质提升早已不可见，
      // 只是白占硬盘 —— 这也是他反复说的「相同东西体积更大应该扣分」。
      if (vgb < band.low) rateLv = 'low';
      else if (vgb < band.good) rateLv = 'thin';
      else if (vgb > band.hi) rateLv = 'over';
      else rateLv = 'ok';
      var rV = RATE[rateLv];
      score += rV;
      hit('rate', RATE_TXT[rateLv], rV);
      why.push(RATE_TXT[rateLv] + '：视频本体 ' + vgb + 'GB（' + p.res + 'P 的合理区间 ' +
        N(band.low) + '~' + N(band.hi) + 'GB，' + N(band.good) + 'GB 起算合理） ' +
        (rV > 0 ? '+' : '') + N(rV));
    }

    score = Math.round(score);
    return { score: score, why: why, hits: hits, parts: p, res: p.res, hdrType: hdrType,
      gb: p.gb, vgb: vgb, agb: agb, rateLv: rateLv };
  }

  // 标签词元（v1.9.1）
  //   排序：按「决策权重」从大到小 —— 警告（要不要下）→ 画质 → 编码 → 音频 → 语言 → 字幕 → 来源 → 帧率。
  //         旧版按代码书写顺序排，把「音轨未标注」这种无效信息塞在第三位，占掉了黄金位置。
  //   颜色：tone 只表达「好 / 坏 / 事实 / 缺失」，不表达类别 ——
  //         按类别上色（分辨率蓝、编码紫、音轨橙）看着花，但读起来仍要一条条扫，解决不了「差异在哪」。
  //   rank：仅用于排序，越小越靠前。
  function gbTextOf(gb) {
    if (!gb) return '';
    return (Math.round(gb * 100) / 100) + 'GB';
  }

  function tokensOf(info) {
    var p = info.parts, out = [], w = effW();
    // v1.12.0：每个标签带上「它值多少分」（k = 跨行比较用的键，v = 分值）。
    // 卡片只在**同一键的分值有差异**时才把 v 显示出来 —— 三条都有的 4K +30 是共同项，
    // 写出来对选片毫无帮助；只有 DTS/DDP、补帧、体积这种真正拉开差距的才标数字。
    function add(t, tone, rank, k, v) {
      out.push({ t: t, tone: tone, rank: rank, k: k || '', v: (v || 0) });
    }
    var band = effBand(p.res);

    // 0 警告：否决项，直接决定「这条要不要下」，必须排最前
    if (p.cam) add('枪版', 'bad', 0, 'cam', w.cam);
    if (p.noSub) add('无字幕', 'bad', 0, 'sub', w.noSub);

    // 1 分辨率 → 2 HDR → 3 编码
    if (p.res) add(p.res === 2160 ? '4K' : (p.res + 'P'), 'good', 1, 'res',
      p.res === 2160 ? w.res2160 : (p.res === 1080 ? w.res1080 : w.res720));
    if (info.hdrType === 'dual') add('HDR+DV', 'good', 2, 'hdr', w.dual);
    else if (info.hdrType === 'hdr10') add('HDR10', 'good', 2, 'hdr', w.hdr10);
    else if (info.hdrType === 'dv') add('仅 DV', 'warn', 2, 'hdr', w.dvOnly + w.dvPenalty);
    if (p.h265) add('x265', 'good', 3, 'codec', w.h265);
    else if (p.h264) add('x264', 'flat', 3, 'codec', 0);
    if (p.tenbit) add('10bit', 'good', 3, 'tenbit', w.tenbit);

    // 4 音轨品质 → 5 条数。「未标注」留在原位参与对比（它本身就是差异项），但色调降级
    var twoCh = AUD_2CH.test(p.audioCodec);
    if (p.lossless) add(p.audioCodec || '无损音轨', 'warn', 4, 'audio', AUD.lossless);
    else if (p.lossyMark) add(p.audioCodec || '有损音轨', twoCh ? 'flat' : 'good', 4, 'audio',
      twoCh ? AUD.stereo : AUD.surround);
    else add('音轨未标注', 'mute', 4, 'audio', AUD.surround);
    // 多音轨不再扣分：它多占的空间已经算在体积里，档内排序自然会惩罚
    if (p.audioN >= 2) add(p.audioN + ' 音轨', 'warn', 5, 'audn', 0);

    // 5.5 体积 → 5.6 码率（v1.12.0 新增：这两项也让它们变成标签）
    // 体积的 v 不是总分的一部分，而是「同档内相对最小体积的档内分」——
    // 三条都是 75 分时，正是这个数字在决定谁排第一。
    if (p.gb) {
      var rt = (info.rateLv === 'low' || info.rateLv === 'over') ? 'bad'
        : (info.rateLv === 'thin' ? 'warn' : 'flat');
      add(gbTextOf(p.gb), rt, 5.5, 'vol', info.volScore || 0);
      if (info.rateLv) add(RATE_TXT[info.rateLv], rt, 5.6, 'rate', RATE[info.rateLv] || 0);
    }

    // 6 语言 → 7 字幕
    if (p.mandarin) add('国语', 'good', 6, 'lang', w.mandarin);
    else if (p.cantonese) add('仅粤语', 'warn', 6, 'lang', w.cantoneseOnly);
    // 「无字幕」里含「字幕」二字，会被 p.sub 一起命中 ⇒ 必须互斥，否则同一行自相矛盾
    if (!p.noSub && p.sub) add('中字', 'good', 7, 'sub', w.subCn);

    // 8 来源 → 9 帧率（补帧是中性事实，压最后，别抢画质的注意力）
    if (p.remux) add('REMUX', 'good', 8, 'src', w.remux);
    else if (p.bluray) add('蓝光', 'good', 8, 'src', w.bluray);
    else if (p.web) add('WEB', 'flat', 8, 'src', w.web);
    if (p.fakeFps) add('插帧', 'bad', 9, 'fps', FPS.interp);
    else if (p.fpsVer) add((p.fps || '高') + 'fps 补帧', 'warn', 9, 'fps', FPS.interp);
    else if (p.fps >= 48) add(p.fps + 'fps', 'good', 9, 'fps', FPS.native);

    out.sort(function (a, b) { return a.rank - b.rank; });
    return out;
  }

  // 纯文本版：tooltip / 诊断 / 日志用
  function summaryOf(info) {
    var ts = tokensOf(info);
    return ts.map(function (t) { return t.t; }).join(' · ');
  }

  /* ======================= 页面识别 ======================= */

  var MAG_SEL = '[href^="magnet:"],[href^="MAGNET:"],[data-clipboard-text^="magnet:"],[data-magnet],[data-magneturl]';

  function countMagnets() {
    try { return document.querySelectorAll(MAG_SEL).length; } catch (e) { return 0; }
  }

  function hostKey() {
    return String(location.hostname || '').replace(/^www\./i, '').toLowerCase();
  }

  function hostIn(list) {
    var h = hostKey();
    for (var i = 0; i < list.length; i++) {
      if (h === list[i] || h.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  function log(msg) {
    try { console.info('%c[片源助手] ' + msg, 'color:#0F6E56;font-weight:600'); } catch (e) {}
  }

  // 判断本页是否已经具备扫描条件，同时把「为什么没跑」记下来（诊断面板用它）
  function readyState() {
    var txt = '';
    try { txt = ((document.body && document.body.innerText) || '').slice(0, 200000); } catch (e) {}
    var st = {
      mag: countMagnets(),
      hasRes: /(2160p|1080p|720p|\b4k\b|\buhd\b)/i.test(txt),
      hasSize: /\d+(\.\d+)?\s*(GB|GiB|MB|TB)/i.test(txt),
      allowed: hostIn(CONF.allowHosts),
      blocked: hostIn(CONF.blockHosts),
      rows: 0,
      trs: document.getElementsByTagName('tr').length,
      lis: document.getElementsByTagName('li').length,
      frames: 0
    };
    try { st.frames = document.getElementsByTagName('iframe').length; } catch (e) {}
    try { st.rows = candidates().length; } catch (e) {}
    st.ok = st.rows > 0 && !st.blocked;
    return st;
  }

  function describe(st) {
    return '磁力 ' + st.mag + ' 条 · 资源行 ' + st.rows + ' · 分辨率标记 ' + (st.hasRes ? '有' : '无') +
      ' · 体积标记 ' + (st.hasSize ? '有' : '无') + ' · ' + (st.allowed ? '白名单站点' : '非白名单') +
      (st.frames ? ' · 页面内有 ' + st.frames + ' 个 iframe' : '');
  }

  // 本页要不要接管：白名单站点一律接管（哪怕内容还没渲染出来，等它渲染）
  // 兜底：网址带上 ?psb_force=1 时强制接管（换域名后想立刻验证可以用这个）
  // 内嵌 iframe 里只在「真的有资源行」时接管，避免每个广告框都挂一份
  function wantHere(st) {
    if (st.blocked) return false;
    if (IN_FRAME) return st.rows > 0 && st.mag >= 1;
    if (/\bpsb_force=1\b/.test(location.search)) return true;
    if (st.allowed) return true;
    return st.mag >= 2 && (st.hasRes || st.rows > 0);
  }

  function shouldRun() { return readyState().ok; }

  function looksLikeRow(text) {
    return !!text && text.length < 1200 &&
      /(2160p|1080p|720p|\b4k\b|\buhd\b)/i.test(text) &&
      /(\d+(\.\d+)?\s*(GB|GiB|MB|TB))/i.test(text);
  }

  function candidates() {
    var out = [], i;
    var push = function (el) { if (el && out.indexOf(el) < 0) out.push(el); };

    var trs = document.querySelectorAll('tr');
    for (i = 0; i < trs.length; i++) if (looksLikeRow(trs[i].textContent)) push(trs[i]);

    if (!out.length) {
      var lis = document.querySelectorAll('li');
      for (i = 0; i < lis.length; i++) if (looksLikeRow(lis[i].textContent)) push(lis[i]);
    }
    if (!out.length) {
      var as = document.querySelectorAll('a[href]');
      for (i = 0; i < as.length; i++) {
        var a = as[i];
        if (!/(2160p|1080p|4k)/i.test(a.textContent || '')) continue;
        var el = a.parentElement, hops = 0;
        while (el && hops < 5) {
          if (looksLikeRow(el.textContent)) { push(el); break; }
          el = el.parentElement; hops++;
        }
      }
    }
    return out.filter(function (el) {
      return !out.some(function (o) { return o !== el && el.contains(o); });
    });
  }

  function nameOf(row) {
    var best = '';
    // 只看资源行自己的链接/带 title 的元素；必须排掉我们插进去的徽章（它的 title 里也有 4K +30 之类）
    var as = row.querySelectorAll ? row.querySelectorAll('a[href], [title]') : [];
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (a.hasAttribute('data-psb-badge')) continue;
      var tx = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (tx.length > best.length && /(2160p|1080p|720p|4k|uhd|hdr|web|blu|remux)/i.test(tx)) best = tx;
      var ti = (a.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      if (ti.length > best.length && /(2160p|1080p|720p|4k|uhd)/i.test(ti)) best = ti;
    }
    if (best) return cleanName(best);

    var t = (row.textContent || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^\s*\d+-\d+楼\s*/, '');
    var cut = t.search(/\d+(\.\d+)?\s*(GB|GiB|MB)(?![A-Za-z])/i);
    if (cut > 10) t = t.slice(0, cut);
    return cleanName(t).slice(0, 160);
  }

  function cleanName(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/^\s*\d+-\d+楼\s*/, '')
      .replace(/\s*(详情|磁力下载|下载|复制)\s*$/g, '')
      .trim();
  }

  /* ======================= 磁力链接提取 ======================= */

  function magnetFromAttrs(el) {
    if (!el || !el.attributes) return '';
    for (var i = 0; i < el.attributes.length; i++) {
      var name = el.attributes[i].name.toLowerCase();
      var v = String(el.attributes[i].value || '').trim();
      if (!v) continue;

      if (/magnet/i.test(v)) {
        var dec = v;
        if (/^magnet%3A/i.test(dec)) { try { dec = decodeURIComponent(dec); } catch (e) {} }
        var m = dec.match(/magnet:\?[^\s"'<>\\)]*/i);
        if (m) return m[0].replace(/&amp;/g, '&');
      }
      if (/^(data-)?(hash|infohash|info[_-]hash|btih)$/i.test(name)) {
        var hv = v.replace(/[^0-9a-zA-Z]/g, '');
        if (/^[0-9a-fA-F]{40}$/.test(hv) || /^[a-zA-Z2-7]{32}$/.test(hv)) {
          return 'magnet:?xt=urn:btih:' + hv;
        }
      }
    }
    return '';
  }

  function magnetOf(root) {
    if (!root) return '';
    var direct = magnetFromAttrs(root);
    if (direct) return direct;
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < els.length; i++) {
      var u = magnetFromAttrs(els[i]);
      if (u) return u;
    }
    return '';
  }

  function detailOf(row) {
    var as = row.querySelectorAll ? row.querySelectorAll('a[href]') : [];
    for (var i = 0; i < as.length; i++) {
      var h = as[i].getAttribute('href') || '';
      if (!h || /^javascript:|^magnet:|^#/i.test(h)) continue;
      if ((as[i].textContent || '').indexOf('详情') >= 0) {
        try { return new URL(h, location.href).href; } catch (e) {}
      }
    }
    return '';
  }

  /* ======================= 行内徽章 ======================= */

  var RANK = [
    { label: '首选', bg: '#0F6E56', fg: '#FFFFFF', bd: '#085041' },
    { label: '次选', bg: '#E1F5EE', fg: '#04342C', bd: '#5DCAA5' },
    { label: '备选', bg: '#EAF3FB', fg: '#0C2D48', bd: '#7FB3D5' }
  ];
  var PLAIN = { bg: '#F1EFE8', fg: '#5F5E5A', bd: '#D3D1C7' };

  function makeBadge(info, rank) {
    var el = document.createElement('span');
    el.setAttribute('data-psb-badge', '1');
    if (rank >= 0) el.setAttribute('data-psb-best', '1');
    var st = rank >= 0 ? RANK[rank] : PLAIN;
    el.textContent = (rank >= 0 ? st.label + ' ' : '') + (info.showScore != null ? info.showScore : info.score);
    el.title = '片源挑选（口径：' + profileLabel() + '）\n' +
      (info.why.length ? info.why.join('\n') : '无有效特征') +
      (info.gb ? '\n体积：' + info.gb + ' GB' : '');
    el.style.cssText = 'display:inline-flex;align-items:center;margin:0 6px 0 0;padding:1px 6px;' +
      'border-radius:4px;font:500 12px/18px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
      'vertical-align:middle;cursor:help;user-select:none;white-space:nowrap;' +
      'border:1px solid ' + st.bd + ';background:' + st.bg + ';color:' + st.fg + ';';
    return el;
  }

  /* ======================= 推荐卡片 ======================= */

  var CSS = '' +
    ':host{all:initial}' +
    '.card{box-sizing:border-box;font:400 13px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
    'background:#FFFFFF;color:#2C2C2A;border:.5px solid rgba(0,0,0,.14);border-radius:12px;' +
    'padding:10px 12px 6px;margin:10px 0 12px;box-shadow:0 1px 6px rgba(0,0,0,.06)}' +
    '.card.slim{padding:8px 10px 4px;margin:0;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,.05)}' +
    '.card.slim .hd{margin-bottom:0}' +
    '.card.slim .ft{display:none}' +
    '.hd{display:flex;align-items:center;gap:8px;margin-bottom:2px}' +
    '.tt{font-size:13px;font-weight:600;color:#04342C}' +
    '.tag{font-size:11px;color:#0F6E56;background:#E1F5EE;border:.5px solid #5DCAA5;border-radius:999px;padding:1px 7px;white-space:nowrap}' +
    '.meta{margin-left:auto;font-size:11px;color:#888780;white-space:nowrap}' +
    '.ib{border:0;background:transparent;color:#888780;font-size:13px;line-height:1;cursor:pointer;padding:0 3px}' +
    '.ib:hover{color:#0F6E56}' +
    '.items{display:flex;flex-direction:column;gap:0;margin-top:4px}' +
    '.it{padding:7px 0;border-top:.5px dashed rgba(0,0,0,.10)}' +
    '.it:first-child{border-top:0}' +
    '.ln{display:flex;align-items:center;gap:7px;min-width:0}' +
    '.row{display:flex;align-items:center;gap:6px}' +
    '.rk{width:17px;height:17px;border-radius:4px;background:#0F6E56;color:#fff;font:600 10.5px/17px system-ui,sans-serif;text-align:center;flex:none}' +
    '.it:nth-child(2) .rk{background:#5DCAA5;color:#04342C}' +
    '.it:nth-child(3) .rk{background:#7FB3D5;color:#0C2D48}' +
    '.sz{flex:none;font:600 12.5px/1.2 system-ui,sans-serif;color:#2C2C2A;white-space:nowrap}' +
    '.nm{flex:1 1 auto;min-width:0;font-size:11.5px;color:#444441;line-height:1.5;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.sc{flex:none;font-size:11px;color:#888780;white-space:nowrap}' +
    '.why{display:flex;align-items:center;gap:3px;margin:3px 0 0 24px;line-height:1.5;' +
    'white-space:nowrap;overflow:hidden}' +
    '.w{flex:none;font-size:10.5px;color:#5B6E7C;padding:0 5px;border-radius:999px;line-height:1.6}' +
    // 共性（全体都有）：冷色中性块，明确是「背景信息」，不是差异项，也不做成看不见的灰
    '.w.same{background:#EDF2F5;color:#5B6E7C}' +
    '.w.hi{font-weight:500}' +
    '.w.hi.t-good{background:#E1F5EE;color:#0A5540}' +
    '.w.hi.t-warn{background:#FAEEDA;color:#8A5A12}' +
    '.w.hi.t-bad{background:#FCEBEB;color:#A32D2D}' +
    // mute（缺信息）用暖灰块：同为差异项，得比共性块更「实」，但不抢彩色项的注意力
    '.w.hi.t-mute{background:#F2EFE8;color:#6B6558}' +
    // 标签内的分值（v1.12.0）：小一号、半透明，读起来像标签的附注而不是第二个标签
    '.w .dv{margin-left:4px;font-size:9.5px;font-weight:600;letter-spacing:0;' +
    'opacity:.72;padding:0 3px;border-radius:4px;background:rgba(0,0,0,.055)}' +
    '.w.hi .dv{opacity:.85}' +

    // 右侧理由列（v1.10.1）：只写「跟上一名差在哪」，靠右对齐、可省略号截断
    '.rz{margin-left:auto;flex:0 1 auto;min-width:0;max-width:52%;padding-left:14px;font-size:10.5px;color:#A8A6A0;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}' +
    '.rz b{font-weight:600;color:#7C7A73;font-variant-numeric:tabular-nums}' +
    '.rz.top,.rz.top b{color:#0F6E56}' +
    '.rz.near,.rz.near b{color:#8A5A12}' +
    '.cp{flex:none;border:.5px solid #0F6E56;background:#0F6E56;color:#fff;border-radius:6px;' +
    'padding:3px 9px;font:500 11.5px/1.45 system-ui,sans-serif;cursor:pointer;white-space:nowrap;transition:background .15s}' +
    '.cp:hover{background:#085041}' +
    '.cp[disabled]{cursor:default;opacity:.55;background:#F1EFE8;color:#7C7A73;border-color:#D3D1C7}' +
    '.cp.ok{background:#E1F5EE;color:#04342C;border-color:#5DCAA5;opacity:1}' +
    '.cp.bad{background:#FCEBEB;color:#501313;border-color:#F09595;opacity:1}' +
    '.cc{flex:none;width:22px;height:21px;border:.5px solid rgba(0,0,0,.16);background:#F1EFE8;color:#5F5E5A;' +
    'border-radius:6px;cursor:pointer;font-size:12px;padding:0;display:inline-flex;align-items:center;justify-content:center}' +
    '.cc:hover{background:#E8E5DC}' +
    '.err{font-size:10.5px;color:#A32D2D;margin:3px 0 0 24px;line-height:1.4;word-break:break-all}' +
    '.err.good{color:#0F6E56}' +
    '.ft{font-size:10.5px;color:#B4B2A9;text-align:right;padding:4px 0 2px}' +
    '.set label{display:block;font-size:11.5px;color:#5F5E5A;margin:7px 0 3px}' +
    '.set input{width:100%;box-sizing:border-box;border:.5px solid rgba(0,0,0,.18);border-radius:6px;' +
    'padding:5px 7px;font:400 12px/1.4 system-ui,sans-serif;background:#fff;color:#2C2C2A}' +
    '.set .row{margin-top:9px}' +
    '.set .cp{flex:0 0 auto;padding:5px 12px}' +
    '.set .cancel{border:.5px solid rgba(0,0,0,.18);background:#F1EFE8;color:#2C2C2A;border-radius:7px;' +
    'padding:5px 12px;font:400 12px/1.35 system-ui,sans-serif;cursor:pointer}' +
    '.set .mt{margin-top:11px}' +
    '.tabs{display:flex;gap:4px;margin:0 0 8px;border-bottom:.5px solid rgba(0,0,0,.1);padding-bottom:6px}' +
    '.tb{border:0;background:transparent;color:#7C7A73;font:500 11.5px/1.6 system-ui,sans-serif;' +
    'padding:2px 8px;border-radius:5px;cursor:pointer}' +
    '.tb.on{background:#E1F5EE;color:#04342C}' +
    '.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}' +
    '.ch{border:.5px solid rgba(0,0,0,.18);background:#F6F4EE;color:#3A3A37;border-radius:999px;' +
    'padding:3px 10px;font:400 11.5px/1.5 system-ui,sans-serif;cursor:pointer}' +
    '.ch.on{background:#0F6E56;border-color:#085041;color:#fff;font-weight:500}' +
    '.szr{display:flex;align-items:center;gap:4px;margin-top:5px;flex-wrap:wrap}' +
    '.szr .sl{font-size:11px;color:#888780;margin-right:2px}' +
    '.sz{border:.5px solid rgba(0,0,0,.16);background:#fff;color:#3A3A37;border-radius:5px;' +
    'padding:1px 7px;font:400 11px/1.6 system-ui,sans-serif;cursor:pointer}' +
    '.sz.on{background:#E1F5EE;border-color:#5DCAA5;color:#04342C;font-weight:600}' +
    '.kv{display:flex;align-items:center;gap:8px;margin-top:2px}' +
    '.kv .vv{flex:1 1 auto;min-width:0;font-size:12px;color:#2C2C2A;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wsum{font-size:11px;color:#888780;margin:4px 0 0}' +
    '.wsum b{color:#0F6E56}' +
    '.wsec{display:flex;align-items:baseline;font-size:11px;color:#0F6E56;font-weight:600;' +
    'margin:11px 0 4px;border-top:.5px solid rgba(0,0,0,.08);padding-top:8px}' +
    '.wsec .wsh{margin-left:auto;font-weight:400;font-size:10.5px;color:#B4B2A9}' +
    '.pr{display:flex;align-items:center;gap:7px;margin:2px 0}' +
    '.pr .pl{flex:0 0 62px;font-size:11.5px;color:#5F5E5A}' +
    '.pr.chg .pl{color:#0F6E56;font-weight:600}' +
    '.pr .pv2{flex:0 0 58px;font-size:11px;color:#888780;text-align:right;' +
    'font-variant-numeric:tabular-nums}' +
    '.pr.chg .pv2{color:#0F6E56;font-weight:600}' +
    '.pr .pv2 i{font-style:normal;font-size:9.5px;color:#B4B2A9;font-weight:400}' +
    '.pr .pm{flex:0 0 auto;border:.5px solid rgba(0,0,0,.14);background:#F6F4EE;color:#5F5E5A;' +
    'border-radius:5px;font:400 10px/1 system-ui,sans-serif;padding:3px 5px;cursor:pointer}' +
    '.pr .pm.on{background:#E1F5EE;border-color:#5DCAA5;color:#04342C}' +
    '.wmore{display:block;width:100%;border:.5px dashed rgba(0,0,0,.16);background:transparent;' +
    'color:#5F5E5A;border-radius:6px;font:400 10.5px/1 system-ui,sans-serif;padding:5px 0;' +
    'cursor:pointer;margin:2px 0 0}' +
    '.wmore:hover{background:#F6F4EE;color:#0F6E56}' +
    '.set .wr{flex:1 1 auto;min-width:44px;width:auto;height:16px;margin:0;padding:0;' +
    'accent-color:#0F6E56;cursor:pointer;background:transparent;border:0;box-sizing:border-box}' +
    '.wg{padding:2px 0 4px 10px;border-left:1.5px solid rgba(15,110,86,.15);margin:2px 0 4px 4px}' +
    '.set .wi{display:flex;align-items:center;gap:6px;margin:1px 0}' +
    '.wi .wl{flex:0 0 74px;font-size:11px;color:#5F5E5A;white-space:nowrap;overflow:hidden;' +
    'text-overflow:ellipsis}' +
    '.wi .wv{flex:0 0 44px;font-size:10.5px;color:#888780;text-align:right;' +
    'font-variant-numeric:tabular-nums}' +
    '.wi .ws{flex:0 0 40px;font-size:10px;color:#B4B2A9;text-align:right;' +
    'font-variant-numeric:tabular-nums}' +
    '.wi.chg .wl,.wi.chg .wv{color:#0F6E56}' +
    '.wi.off .wl{color:#B4B2A9;text-decoration:line-through}' +
    '.pv{margin-top:10px;border:.5px solid rgba(0,0,0,.1);border-radius:7px;padding:6px 8px;' +
    'background:#FDFCFA}' +
    '.pvh{display:flex;align-items:baseline;font-size:11px;color:#0F6E56;font-weight:600}' +
    '.pvh .pvc{margin-left:auto;font-weight:400;font-size:10.5px;color:#888780}' +
    '.pvr{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.8}' +
    '.pkr{flex:0 0 12px;color:#888780;font-size:10px}' +
    '.pnm{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
    'color:#5F5E5A}' +
    '.psc{flex:0 0 auto;font-weight:600;color:#0F6E56;font-variant-numeric:tabular-nums}' +
    '.pvn{font-size:10.5px;color:#B4B2A9;line-height:1.6}' +
    '.tres{margin-top:8px;padding:6px 8px;border-radius:6px;font-size:11px;line-height:1.6;' +
    'white-space:pre-wrap;word-break:break-word}' +
    '.tres.ok{background:#E1F5EE;color:#04342C;border:.5px solid #5DCAA5}' +
    '.tres.bad{background:#FCEBEB;color:#501313;border:.5px solid #F09595}' +
    '.tres.wait{background:#F6F4EE;color:#5F5E5A;border:.5px solid rgba(0,0,0,.12)}' +
    '.set textarea{width:100%;box-sizing:border-box;border:.5px solid rgba(0,0,0,.18);border-radius:6px;' +
    'padding:5px 7px;font:400 11px/1.5 ui-monospace,Consolas,monospace;background:#fff;color:#2C2C2A;resize:vertical}' +
    '.crumb{font-size:11.5px;line-height:1.9;word-break:break-all}' +
    '.crumb .cb{color:#0F6E56;cursor:pointer;text-decoration:none;border-bottom:.5px dashed rgba(15,110,86,.45)}' +
    '.crumb .cb:hover{color:#04342C}' +
    '.crumb .sep{color:#B4B2A9;margin:0 3px}' +
    '.fl{max-height:132px;overflow:auto;border:.5px solid rgba(0,0,0,.12);border-radius:6px;' +
    'padding:3px;margin-top:4px;background:#FDFCFA}' +
    '.fl .fd{display:block;width:100%;text-align:left;border:0;background:transparent;color:#2C2C2A;' +
    'font:400 11.5px/1.6 system-ui,sans-serif;padding:3px 6px;border-radius:4px;cursor:pointer;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.fl .fd:hover{background:#E1F5EE;color:#04342C}' +
    '.set code{font:400 10.5px/1.4 ui-monospace,Consolas,monospace;background:rgba(0,0,0,.055);' +
    'padding:0 3px;border-radius:3px}' +
    '.note{font-size:11px;color:#888780;margin-top:6px;line-height:1.45}' +
    '@media (prefers-color-scheme:dark){' +
    '.card{background:#232322;color:#EDEDEA;border-color:rgba(255,255,255,.16)}' +
    '.tt{color:#9FE1CB}.tag{background:#0F6E56;color:#EAF7F1;border-color:#5DCAA5}' +
    '.nm{color:#D3D1C7}.sz{color:#EDEDEA}.why,.sc,.meta,.ft,.note{color:#888780}' +
    '.w{color:#A3B8C6}.w.same{background:#22303A;color:#A3B8C6}' +
    '.w.hi.t-good{background:#0F3D32;color:#9FE1CB}' +
    '.w.hi.t-warn{background:#3D2E12;color:#F0C97A}' +
    '.w.hi.t-bad{background:#3D1A1A;color:#F09595}' +
    '.w.hi.t-mute{background:#2E2B24;color:#B9B2A3}' +
    '.w .dv{background:rgba(255,255,255,.08)}' +
    '.rz{color:#7E7C74}.rz b{color:#B4B2A9}' +
    '.rz.top,.rz.top b{color:#9FE1CB}' +
    '.rz.near,.rz.near b{color:#F0C97A}' +
    '.cp[disabled]{background:#2C2C2A;color:#888780;border-color:rgba(255,255,255,.16)}' +
    '.it{border-top-color:rgba(255,255,255,.12)}' +
    '.cc{background:#2C2C2A;color:#B4B2A9;border-color:rgba(255,255,255,.16)}' +
    '.set label{color:#B4B2A9}' +
    '.set input{background:#2C2C2A;color:#EDEDEA;border-color:rgba(255,255,255,.18)}' +
    '.set .cancel{background:#2C2C2A;color:#D3D1C7;border-color:rgba(255,255,255,.16)}' +
    '.set textarea{background:#2C2C2A;color:#EDEDEA;border-color:rgba(255,255,255,.18)}' +
    '.fl{background:#1C1C1B;border-color:rgba(255,255,255,.14)}' +
    '.fl .fd{color:#D3D1C7}' +
    '.fl .fd:hover{background:#0F6E56;color:#EAF7F1}' +
    '.set code{background:rgba(255,255,255,.09)}' +
    '.tabs{border-bottom-color:rgba(255,255,255,.14)}' +
    '.tb{color:#B4B2A9}.tb.on{background:#0F6E56;color:#EAF7F1}' +
    '.ch{background:#2C2C2A;border-color:rgba(255,255,255,.18);color:#D3D1C7}' +
    '.ch.on{background:#0F6E56;border-color:#5DCAA5;color:#EAF7F1}' +
    '.sz{background:#2C2C2A;border-color:rgba(255,255,255,.18);color:#D3D1C7}' +
    '.sz.on{background:#0F6E56;border-color:#5DCAA5;color:#EAF7F1}' +
    '.kv .vv{color:#EDEDEA}' +
    '.wi span{color:#B4B2A9}' +
    '.pr .pl,.wi .wl{color:#B4B2A9}' +
    '.pr.chg .pl,.pr.chg .pv2,.wi.chg .wl,.wi.chg .wv,.wsum b{color:#9FE1CB}' +
    '.wsec{border-top-color:rgba(255,255,255,.1);color:#9FE1CB}' +
    '.wsec .wsh{color:#888780}' +
    '.pr .pm{background:#2C2C2A;color:#B4B2A9;border-color:rgba(255,255,255,.16)}' +
    '.pr .pm.on{background:#0F3D32;border-color:#5DCAA5;color:#9FE1CB}' +
    '.wmore{border-color:rgba(255,255,255,.18);color:#B4B2A9}' +
    '.wmore:hover{background:#2C2C2A;color:#9FE1CB}' +
    '.pv{background:#1C1C1B;border-color:rgba(255,255,255,.12)}' +
    '.pvh{color:#9FE1CB}' +
    '.pvr{color:#B4B2A9}' +
    '.pnm{color:#B4B2A9}' +
    '.psc{color:#9FE1CB}' +
    '.pvn{color:#888780}' +
    '.tres.ok{background:#0F6E56;color:#EAF7F1;border-color:#5DCAA5}' +
    '.tres.bad{background:#3A1A1A;color:#F3C7C7;border-color:#8A3A3A}' +
    '.tres.wait{background:#2C2C2A;color:#B4B2A9;border-color:rgba(255,255,255,.14)}' +
    '.crumb .cb{color:#9FE1CB}}';

  var cardHost = null, cardRoot = null;
  var state = {
    rows: [], infos: [], top: [], settings: false, status: '', mode: 'table',
    picker: null,     // 目录选择器：null = 没打开（也不会发请求）
    tab: 'prof',      // 设置页：prof / push / w
    acc: null,        // 115 账号名缓存：{loading,name,uid,err}
    test: null,       // 「保存并测试」结果：{loading, ok, text}
    wdraft: null,     // 权重页草稿：改动即时预览，松手才落盘
    wfold: {},        // 权重分组折叠：{组下标: true=展开}
    wdev: false,      // 「设备相关」三项是否展开（默认收起：设备口径已定，不该常调）
    dirty: false      // 口径/权重改过 → 关设置时重打分
  };

  // 详情页：把卡片放进「影片信息区」标题块下面的空白处（海报右侧、评分卡左侧那一块），
  // 让人不用滚到磁力表就能先看到该下哪个版本。
  // 判定靠结构 + 内容双重保险：标题必须在资源表之前、容器里必须出现导演/主演这类字段、
  // 容器不能把资源表也包进去；任何一条不满足就退回「插在资源表上方」。
  function findHeaderSlot(rows) {
    if (!CONF.headerSlot) return null;
    var table = rows[0] && rows[0].closest ? rows[0].closest('table') : null;

    var hs = document.querySelectorAll('h1');
    if (!hs.length) hs = document.querySelectorAll('h2');
    var h = null, i;
    for (i = 0; i < hs.length && i < 8; i++) {
      var t = (hs[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length < 2 || t.length > 180) continue;
      // 必须在资源表上方
      if (table && !(hs[i].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      h = hs[i];
      break;
    }
    if (!h) return null;

    // 从标题往上找「影片信息块」：取**第一个**满足条件的祖先（也就是最贴近标题的那层）。
    // 不能取最外层——再往外一格往往就是「海报 + 信息 + 评分」的整行容器（flex row），
    // 把卡片塞进去会变成第四个 flex 项，把信息栏挤成一条竖线（这坑踩过）。
    var META = /(导演|主演|类型|地区|语言|上映|片长|又名|评分|豆瓣|收藏)/;
    var box = null, el = h.parentElement, hops = 0;
    while (el && el !== document.body && el !== document.documentElement && hops < 5) {
      var txt = el.textContent || '';
      var w = 0;
      try { w = el.getBoundingClientRect().width; } catch (e) {}
      // 含海报大图的容器 = 「海报 + 信息 + 评分」那一整行，不能往里塞
      var hasPoster = false;
      try {
        var ims = el.getElementsByTagName('img');
        for (var k = 0; k < ims.length; k++) if (ims[k].offsetWidth >= 80) { hasPoster = true; break; }
      } catch (e2) {}
      if (!hasPoster && !(table && el.contains(table)) && w >= 240 && txt.length <= 2600 && META.test(txt)) {
        box = el;
        break;
      }
      el = el.parentElement; hops++;
    }
    if (!box) return null;
    if (table && box.contains(table)) return null;
    return box;
  }

  function mountHost(rows) {
    var host = document.createElement('div');
    host.setAttribute('data-psb-card', '1');

    var slot = findHeaderSlot(rows);
    if (slot) {
      state.mode = 'header';
      host.setAttribute('data-psb-in-header', '1');
      host.style.cssText = 'display:block;width:100%;max-width:760px;margin:10px 0 0;';
      slot.appendChild(host);
      cardHost = host;
      cardRoot = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      return;
    }

    state.mode = 'table';
    var anchor = null;
    if (rows && rows[0]) {
      var t = rows[0].closest ? rows[0].closest('table') : null;
      anchor = (t && t.parentElement) ? t : rows[0].parentElement;
    }
    if (anchor && anchor.parentNode && anchor.parentNode !== document.documentElement) {
      anchor.parentNode.insertBefore(host, anchor);
    } else {
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;width:380px;';
      document.body.appendChild(host);
    }
    cardHost = host;
    cardRoot = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  }

  /* ---- 设置面板（v1.9.0）：推荐口径 / 115 推送 / 评分权重 ----
   * 关键设计：**打开设置不请求任何 115 接口**。
   *   目录 —— 点「修改目录」才去拉一次（这是当初「每次打开都读目录」的痛点）；
   *   账号名 —— 进「115 推送」页时才取一次，本次会话内复用，不重复请求。
   */
  var TABS = [
    { k: 'prof', t: '推荐口径' },
    { k: 'push', t: '115 推送' },
    { k: 'w', t: '评分权重' }
  ];

  // 权重面板：分组只是显示用，键名必须与 W 一一对应
  /* ---- 权重预设（v1.10.0）----
   * m = 「相对脚本默认规则重视多少倍」，只写需要偏离 1.0 的项，其余自动 1.0。
   * 这样预设不会随默认值调整而过期：默认 30 改成 40，画质优先依然是 1.3 倍。
   */
  var W_PRESETS = [
    { k: 'even', label: '均衡', note: '脚本默认规则，画质与体积并重', m: {} },
    { k: 'pic', label: '画质优先', note: '分辨率/HDR/编码略加强，体积扣分放宽', m: {
      res2160: 1.3, res1080: 1.3, dual: 1.3, hdr10: 1.3, h265: 1.2, tenbit: 1.2,
      remux: 1.2, bluray: 1.1,
      bandLow: 0.6 } },
    { k: 'size', label: '省空间', note: '体积扣分加重，大分辨率让位', m: {
      bandLow: 1.4,
      res2160: 0.6, res1080: 0.7, dual: 0.7, hdr10: 0.7 } },
    { k: 'sub', label: '只要中字', note: '中字必须给，无字幕重罚', m: {
      subCn: 1.5, noSub: 1.5 } },
    { k: 'compat', label: '设备兼容', note: '更在意「仅 DV」在电脑上偏色（音轨已内置判断）', m: {
      dvPenalty: 1.4, dvOnly: 0.6 } }
  ];

  // 倍数 ⇄ 基准分的换算：存储里仍然是绝对分，界面只看倍数。
  // 这样旧配置、analyze、回归测试全都不用动，只在渲染层换个说法。
  // 量程刻意收窄到 0.5 ~ 1.5（v1.10.0）：设备口径是主方向，权重只做补充微调。
  // 放开到 0~3 倍时，一项「分辨率 ×3」就足以压过字幕+音轨+体积的总和，等于
  // 让微调把设备结论顶翻，这与「先按设备选」的定位冲突。
  var W_MINM = 0.5, W_MAXM = 1.5;
  function multOf(k, w) { var d = W[k]; return d ? (Number(w[k]) / d) : 1; }
  function multRound(m, max) {
    var hi = max || W_MAXM;
    m = Number(m);
    if (!isFinite(m)) m = 1;
    if (m < W_MINM) m = W_MINM;
    if (m > hi) m = hi;
    return Math.round(m * 10) / 10;
  }
  function wFromPreset(p) {
    var w = {};
    Object.keys(W).forEach(function (k) {
      var m = multRound(p.m[k] === undefined ? 1 : p.m[k], keyMax(k));
      w[k] = Math.round(W[k] * m * 100) / 100;
    });
    return w;
  }

  /* ---- 偏好维度（v1.10.0）----
   * 定位：**设备口径定主方向，权重只做补充**。
   *   · dev:true 的三项（分辨率/HDR/编码）本来就被设备系数管着（手机把 4K 压到 12%），
   *     再让人大幅调它们，等于用微调把设备结论顶翻 —— 所以收进「高级」并限量程。
   *   · 其余三项跟设备无关，纯粹是个人口味，这才是「需要单独标记的参数」，放主界面。
   *   · 音轨品质 / 帧率 / 码率 三项 v1.12.0 起退出本页 —— 他的原话是「到底哪种更好，
   *     这个不要让我自己配置了，我也不懂」，改由文件上方的 AUD / FPS / RATE 表内置判断。
   * 每组内部本身就是一条阶梯曲线，让用户分别填 4K 30 / 1080P 8 / 720P −8 是把
   * 曲线形状这件内部实现甩给用户。真正想表达的只有一句：我有多在乎这一项。
   *
   * max = 该维度的量程上限。默认 1.5 是「微调」；默认影响力就很小的项（多音轨 −1、
   * 帧率 ±2）必须给更大区间才有存在感 —— 否则「多音轨我不想要」根本表达不出来。
   * 即便给到 3 倍，多音轨也只是 −3，仍然远小于分辨率 30，不会顶翻设备结论。
   *
   * 音轨拆成「品质」和「条数」两组：两者的方向是反的（品质分高＝好事，条数扣分＝坏事），
   * 塞进一个等比偏好里，想加大多音轨扣分就会连带抬高高品质音轨的加分。
   * audioTrackLossless / audioTrackLossy 不在里面 —— 那两个是音轨体积估算参数，不参与打分。
   */
  var PREF_GROUPS = [
    { k: 'sub', label: '字幕', keys: ['subCn', 'noSub'], max: 1.5 },
    { k: 'lang', label: '语言', keys: ['mandarin', 'cantoneseOnly'], max: 2 },
    { k: 'source', label: '来源', keys: ['remux', 'bluray', 'web', 'cam'], max: 1.5 },
    { k: 'res', label: '分辨率', keys: ['res2160', 'res1080', 'res720'], max: 1.5, dev: true },
    { k: 'hdr', label: 'HDR / DV', keys: ['dual', 'hdr10', 'dvOnly', 'dvPenalty'], max: 1.5, dev: true },
    { k: 'codec', label: '编码', keys: ['h265', 'tenbit'], max: 1.5, dev: true }
  ];

  // 每项的合法倍数上限（来自所属组的 max），供 sanitizeCfg 收回越界旧配置
  var _keyMax = null;
  function keyMax(k) {
    if (!_keyMax) {
      _keyMax = {};
      PREF_GROUPS.forEach(function (g) {
        g.keys.forEach(function (x) { _keyMax[x] = g.max || W_MAXM; });
      });
    }
    return _keyMax[k] || W_MAXM;
  }

  var W_LABEL = {
    res2160: '4K', res1080: '1080P', res720: '720P',
    dual: 'HDR+DV', hdr10: 'HDR10', dvOnly: '仅 DV', dvPenalty: 'DV 偏色',
    lossy: '有损/未标注', lossless: '无损',
    remux: 'REMUX', bluray: '蓝光', web: 'WEB', cam: '枪版 TS',
    h265: 'x265', tenbit: '10bit',
    mandarin: '国语', cantoneseOnly: '仅粤语', subCn: '中字', noSub: '无字幕',
    fpsHigh: '原生高帧', fpsFake: '插帧补帧',
    bandLow: '过低'
  };

  // 组偏好的当前值 = 组内各项倍数的算术平均。
  // 拖动时按 (目标 / 当前) 等比缩放整组 —— 保留用户已做的形状微调，只改整体强度。
  function prefVal(g, w) {
    var s = 0;
    for (var i = 0; i < g.keys.length; i++) s += multOf(g.keys[i], w);
    return Math.round((s / g.keys.length) * 10) / 10;
  }
  function prefUniform(g, w) {
    var m0 = multOf(g.keys[0], w);
    for (var i = 1; i < g.keys.length; i++) {
      if (Math.abs(multOf(g.keys[i], w) - m0) > 0.05) return false;
    }
    return true;
  }
  function setPref(g, w, target) {
    var cur = prefVal(g, w);
    var f = cur > 0.001 ? (Number(target) / cur) : 1;
    g.keys.forEach(function (k) {
      var m = multRound(multOf(k, w) * f, g.max);
      w[k] = Math.round(W[k] * m * 100) / 100;
    });
  }
  function fmtMult(v) { return '×' + Number(v).toFixed(1); }
  // 偏离默认的项数（只算真正参与打分的 27 项）
  function prefKeyCount() {
    var n = 0;
    PREF_GROUPS.forEach(function (g) { n += g.keys.length; });
    return n;
  }
  function wChangedCount(w) {
    var n = 0;
    PREF_GROUPS.forEach(function (g) {
      g.keys.forEach(function (k) { if (Math.abs(multOf(k, w) - 1) > 0.001) n++; });
    });
    return n;
  }


  function renderSettings() {
    var cur = state.tab || 'prof';
    var tabs = '<div class="tabs">';
    for (var i = 0; i < TABS.length; i++) {
      tabs += '<button class="tb' + (cur === TABS[i].k ? ' on' : '') +
        '" data-act="tab" data-tab="' + TABS[i].k + '">' + TABS[i].t + '</button>';
    }
    tabs += '</div>';

    var panel = cur === 'push' ? tabPush() : (cur === 'w' ? tabWeights() : tabProfile());
    return '<div class="set">' + tabs + panel +
      '<div class="err" data-err></div>' +
      '<div class="row"><button class="cancel" data-act="back">关闭</button>' +
      '<span class="note" style="margin:0 0 0 auto">改动即时生效</span></div>' +
      '</div>';
  }

  function tabProfile() {
    var p = cfg().prof, h = '';
    h += '<label>按哪台设备挑片（可多选：画质按最好的那台算，体积按最省的那台算）</label>';
    h += '<div class="chips">';
    DEV_ORDER.forEach(function (k) {
      var on = p[k] !== null && typeof p[k] !== 'undefined';
      h += '<button class="ch' + (on ? ' on' : '') + '" data-act="dev" data-dev="' + k + '">' +
        (on ? '✓ ' : '') + DEV[k].label + '</button>';
    });
    h += '</div>';

    DEV_ORDER.forEach(function (k) {
      if (p[k] === null || typeof p[k] === 'undefined') return;
      h += '<div class="szr"><span class="sl">' + (DEV[k].slabel || DEV[k].label) + '</span>';
      DEV[k].sizes.forEach(function (s) {
        h += '<button class="sz' + (Number(p[k]) === s ? ' on' : '') + '" data-act="size" data-dev="' + k +
          '" data-size="' + s + '">' + s + '″</button>';
      });
      h += '</div>';
    });

    h += '<div class="note">口径影响三件事：<br>' +
      '① <b>4K / HDR 值多少分</b> —— 手机上几乎分辨不出来，4K 与 1080P 的分差会从 25 分缩到 3 分左右，1080P 很容易反超；<br>' +
      '② <b>「仅 DV」罚多重</b> —— 电脑显示器最容易偏色，罚得最狠；<br>' +
      '③ <b>体积甜点区</b> —— 手机/小屏把预算压得更紧，堆码率的版本更容易被扣。<br>' +
      '默认「电视 65″ + 电脑 27″」= v1.8.0 的老口径，分数一分不差。至少保留一台。</div>';
    return h;
  }

  function accText() {
    var a = state.acc;
    if (!a) return '未读取（点右边刷新）';
    if (a.loading) return '读取中…';
    if (a.err) return a.err;
    if (a.name) return a.name + (a.uid ? '（UID ' + a.uid + '）' : '');
    if (a.uid) return 'UID ' + a.uid;
    return '已登录（没取到昵称）';
  }

  function pickerBody() {
    var pk = state.picker;
    var path = (pk.path && pk.path.length) ? pk.path : [{ cid: '0', name: '根目录' }];
    var cur = path[path.length - 1];

    var crumb = '';
    for (var i = 0; i < path.length; i++) {
      if (i) crumb += '<span class="sep">›</span>';
      crumb += '<a class="cb" data-cid="' + esc(path[i].cid) + '" data-pi="' + i + '">' + esc(path[i].name) + '</a>';
    }

    var list;
    if (pk.loading) {
      list = '<div class="note">正在读取目录…</div>';
    } else if (pk.needLogin) {
      list = '<div class="err">' + esc(pk.err) +
        '<br>先去 <a class="cb" href="https://115.com/" target="_blank">115.com</a> 登录，或切成「自己填 Cookie」。</div>';
    } else if (pk.err) {
      list = '<div class="err">' + esc(pk.err) + '</div>';
    } else if (!pk.folders.length) {
      list = '<div class="note">这个目录下没有子文件夹</div>';
    } else {
      list = '<div class="fl">';
      for (var j = 0; j < pk.folders.length; j++) {
        list += '<button class="fd" data-cid="' + esc(pk.folders[j].cid) + '" data-name="' +
          esc(pk.folders[j].name) + '">' + esc(pk.folders[j].name) + '</button>';
      }
      list += '</div>';
    }

    return '<div class="crumb">' + crumb + '</div>' + list +
      '<div class="row">' +
      (path.length > 1 ? '<button class="cancel" data-act="up">上一层</button>' : '') +
      '<button class="cp" data-act="pick">存到「' + esc(cur.name) + '」</button></div>';
  }

  function tabPush() {
    var d = loadDir(), mode = loadCkMode(), h = '';

    // ① 离线目录 —— 不点「修改目录」就不发请求
    h += '<label>离线保存目录</label><div class="kv"><span class="vv">' + esc(d.name) + '</span>' +
      '<button class="cancel" data-act="dir">' + (state.picker ? '收起' : '修改目录') + '</button></div>';
    if (state.picker) h += pickerBody();

    // ② 账号名
    h += '<label class="mt">115 账号</label><div class="kv"><span class="vv">' + esc(accText()) + '</span>' +
      '<button class="cancel" data-act="acc">' + (state.acc && state.acc.loading ? '读取中…' : '刷新') + '</button></div>';

    // ③ Cookie 来源
    h += '<label class="mt">Cookie 来源</label><div class="chips">' +
      '<button class="ch' + (mode === 'auto' ? ' on' : '') + '" data-act="ckmode" data-mode="auto">用浏览器登录态</button>' +
      '<button class="ch' + (mode === 'manual' ? ' on' : '') + '" data-act="ckmode" data-mode="manual">自己填 Cookie</button></div>';

    if (mode === 'manual') {
      h += '<textarea class="f-ck" rows="2" spellcheck="false" ' +
        'placeholder="UID=..; CID=..; SEID=..; KID=..">' + esc(loadCookie()) + '</textarea>' +
        '<div class="note">取法：F12 → Application → Cookies → <code>https://115.com</code>，' +
        '把 <code>UID / CID / SEID / KID</code> 粘进来；整串 cookie 或 JSON 也能认（自动挑出这四项）。<br>' +
        '只存本机 Tampermonkey 存储，不外发、不写日志，诊断面板只报长度不报内容。</div>';
    } else {
      h += '<div class="note">靠油猴通道 + <code>withCredentials</code> 自动带上浏览器里 115.com 的登录态，' +
        '脚本不读也不存你的凭据。<br>多账号、或登录态带不上时，切到「自己填 Cookie」。</div>';
    }

    h += '<div class="row"><button class="cp" data-act="test"' +
      (state.test && state.test.loading ? ' disabled' : '') + '>' +
      (state.test && state.test.loading ? '测试中…' : '保存并测试') + '</button></div>';
    h += testBox();
    return h;
  }

  // 测试结果框：成功/失败都要说清楚，别让人猜
  function testBox() {
    var t = state.test;
    if (!t) return '';
    if (t.loading) return '<div class="tres wait">正在连 115，校验登录态与目录…</div>';
    return '<div class="tres ' + (t.ok ? 'ok' : 'bad') + '">' + esc(t.text) + '</div>';
  }

  // ---- 权重草稿：拖动即时预览，松手（change）才落盘 ----
  // 为什么要草稿：滑块 input 每秒能触发几十次，每次都写 GM 存储会明显卡顿；
  // 而且落盘后会作废 _eff 触发整页重算，正在拖的滑块会被重建打断。
  function draftW() {
    if (!state.wdraft) {
      var w = {};
      Object.keys(W).forEach(function (k) { w[k] = Number(cfg().w[k]); });
      state.wdraft = w;
    }
    return state.wdraft;
  }
  function commitW() {
    var c = cfg();
    var next = saveCfg({ prof: c.prof, w: draftW() });
    var w = {};
    Object.keys(W).forEach(function (k) { w[k] = next.w[k]; });
    state.wdraft = w;
    state.dirty = true;
  }

  // 预览：用草稿权重把当前列表重打一遍分，排序规则与 scan() 完全相同
  function previewHtml(w) {
    var h = '<div class="pvh">改动后的实际排序<span class="pvc">' +
      (state.rows.length ? state.rows.length + ' 条资源' : '') + '</span></div>';
    if (!state.rows.length) {
      return h + '<div class="pvn">先扫一次磁力列表，这里会显示这套权重下真正推荐的是哪几条</div>';
    }
    var after = withW(w, function () {
      return state.rows.map(function (row) {
        return analyze(rowText(row) + ' ' + (row.getAttribute('title') || ''));
      });
    });
    var order = rankByTier(after);
    var n = Math.min(3, order.length);
    for (var i = 0; i < n; i++) {
      var idx = order[i], nm = nameOf(state.rows[idx]) || ('第 ' + (idx + 1) + ' 条');
      h += '<div class="pvr"><span class="pkr">' + (i + 1) + '</span>' +
        '<span class="pnm" title="' + esc(nm) + '">' + esc(nm) + '</span>' +
        '<span class="psc">' + after[idx].showScore + '</span></div>';
    }
    h += '<div class="pvn">画质同档时，体积小的靠前</div>';
    return h;
  }

  // 就地刷新显示（不回写 innerHTML 整页）—— 拖动过程中若 render() 重建 DOM，
  // 滑块会立刻失去焦点、拖动中断。这里只改文本和类名。
  function syncW(root) {
    var w = draftW();
    PREF_GROUPS.forEach(function (g, gi) {
      var v = prefVal(g, w), uni = prefUniform(g, w);
      var vEl = root.querySelector('[data-pv2="' + gi + '"]');
      if (vEl) vEl.innerHTML = fmtMult(v) + (uni ? '' : '<i>·微调</i>');
      var gr = root.querySelector('.wr[data-pg="' + gi + '"]');
      if (gr) {
        if (document.activeElement !== gr) gr.value = v;
        if (gr.parentNode) gr.parentNode.className = 'pr' +
          (Math.abs(v - 1) > 0.001 || !uni ? ' chg' : '');
      }
      g.keys.forEach(function (k) {
        var m = multRound(multOf(k, w), g.max);
        var val = Math.round(W[k] * m * 100) / 100;
        var ve = root.querySelector('[data-wv="' + k + '"]');
        var se = root.querySelector('[data-ws="' + k + '"]');
        if (ve) ve.textContent = fmtMult(m);
        if (se) se.textContent = (val > 0 ? '+' : '') + N(val);
        var ir = root.querySelector('.wr[data-w="' + k + '"]');
        if (ir) {
          if (document.activeElement !== ir) ir.value = m;
          if (ir.parentNode) ir.parentNode.className = 'wi' +
            (Math.abs(m - 1) < 0.001 ? '' : ' chg');
        }
      });
    });
    var sum = root.querySelector('.wsum');
    var n = wChangedCount(w);
    if (sum) sum.innerHTML = n
      ? '已偏离默认 <b>' + n + '</b> / ' + prefKeyCount() + ' 项'
      : '当前＝脚本默认规则';
  }

  var _pvTimer = null;
  function schedulePreview() {
    if (_pvTimer) clearTimeout(_pvTimer);
    _pvTimer = setTimeout(function () {
      _pvTimer = null;
      var box = cardRoot && cardRoot.querySelector('[data-pv]');
      if (!box || !state.wdraft) return;
      box.innerHTML = previewHtml(state.wdraft);
    }, 90);
  }

  function wRow(k, w, max) {
    var m = multRound(multOf(k, w), max);
    var val = Math.round(W[k] * m * 100) / 100;
    return '<label class="wi' + (Math.abs(m - 1) < 0.001 ? '' : ' chg') + '">' +
      '<span class="wl">' + (W_LABEL[k] || k) + '</span>' +
      '<input class="wr" type="range" min="' + W_MINM + '" max="' + W_MAXM + '" step="0.1" value="' + m +
      '" data-w="' + k + '">' +
      '<span class="wv" data-wv="' + k + '">' + fmtMult(m) + '</span>' +
      '<span class="ws" data-ws="' + k + '">' + (val > 0 ? '+' : '') + N(val) + '</span>' +
      '</label>';
  }

  function prefRow(g, w, gi) {
    var v = prefVal(g, w), uni = prefUniform(g, w), open = !!state.wfold[gi];
    var chg = Math.abs(v - 1) > 0.001 || !uni;
    var hi = g.max || W_MAXM;
    var h = '<div class="pr' + (chg ? ' chg' : '') + '">' +
      '<span class="pl">' + g.label + '</span>' +
      '<input class="wr" type="range" min="' + W_MINM + '" max="' + hi + '" step="0.1" value="' + v +
      '" data-pg="' + gi + '" data-gk="' + g.k + '">' +
      '<span class="pv2" data-pv2="' + gi + '">' + fmtMult(v) + (uni ? '' : '<i>·微调</i>') + '</span>' +
      '<button class="pm' + (open ? ' on' : '') + '" data-act="wadv" data-g="' + gi + '">' +
      (open ? '收起' : '高级') + '</button>' +
      '</div>';
    if (open) {
      h += '<div class="wg">';
      g.keys.forEach(function (k) { h += wRow(k, w, hi); });
      h += '</div>';
    }
    return h;
  }

  function tabWeights() {
    var w = draftW(), h = '', nChg = wChangedCount(w);

    // ① 一键预设
    h += '<label>一键预设（套完还能再微调）</label><div class="chips">';
    W_PRESETS.forEach(function (p) {
      var pw = wFromPreset(p), same = true;
      Object.keys(W).forEach(function (k) {
        if (Math.abs(Number(pw[k]) - Number(w[k])) > 0.01) same = false;
      });
      h += '<button class="ch' + (same ? ' on' : '') + '" data-act="wpreset" data-p="' + p.k +
        '" title="' + esc(p.note) + '">' + p.label + '</button>';
    });
    h += '</div>';
    h += '<div class="wsum">' + (nChg
      ? '已微调 <b>' + nChg + '</b> / ' + prefKeyCount() + ' 项'
      : '当前＝脚本默认规则') + '</div>';

    // ② 主界面：跟设备无关的补充偏好
    h += '<div class="wsec">补充偏好<span class="wsh">设备口径已定主方向，这里只微调</span></div>';
    PREF_GROUPS.forEach(function (g, gi) { if (!g.dev) h += prefRow(g, w, gi); });

    // ③ 设备相关：默认收起（这些已经被设备系数缩放，再大调等于顶翻设备结论）
    h += '<div class="wsec">设备相关<span class="wsh">已按设备缩放，一般不用动</span></div>';
    if (state.wdev) {
      PREF_GROUPS.forEach(function (g, gi) { if (g.dev) h += prefRow(g, w, gi); });
      h += '<button class="wmore" data-act="wdev">收起</button>';
    } else {
      h += '<button class="wmore" data-act="wdev">展开（分辨率 / HDR / 编码）</button>';
    }

    // ④ 即时预览
    h += '<div class="pv" data-pv>' + previewHtml(w) + '</div>';

    h += '<div class="row"><button class="cancel" data-act="wreset">全部恢复默认</button></div>';
    h += '<div class="note">这是<b>补充</b>，不是主开关：先按上面的设备口径打分，权重只在同一维度内做取舍微调。<br>' +
      '滑块＝把这一维度整体放大／缩小，组内相对差距同比拉开：字幕 ×1.5 时，中字与无字幕的分差也从 24 分变 36 分。' +
      '想打破等比（「4K 很香但 720P 无所谓」）点该行「高级」。<br>' +
      '<b>帧率 / 码率 / 音轨的好坏不用你配</b>：脚本按常识定死了 —— ' +
      '原生 24p 最好（不奖不罚），原生 ≥48fps 加 2；' +
      '「50/60 帧版本」和「插帧版」同罚 −3，因为它们是同一件事：拿 24p 母版算法补出来的假帧，' +
      '同体积下帧数翻倍还会把每帧的比特摊薄。<br>' +
      '码率看视频本体是否落在该分辨率的合理区间（4K 9~30GB），压过头 −12、偏低 −4、堆码率 −2；' +
      '音轨 5.1 环绕 +2，AAC 立体声 0，无损（TrueHD/DTS-HD）−4（电视/回音壁多半解不出，还得为它付体积）。<br>' +
      '<b>体积与多音轨条数不在这里</b>：它们不进总分，只在画质同档时按体积从小到大排先后。</div>';
    return h;
  }

  function loadPickerAt(cid) {
    if (!state.picker) return;
    state.picker.loading = true;
    state.picker.err = '';
    state.picker.needLogin = false;
    state.picker.folders = [];
    render();
    list115Folders(cid).then(function (r) {
      if (!state.picker) return;
      state.picker.loading = false;
      if (!r.ok) {
        state.picker.err = r.error || '取目录失败';
        state.picker.needLogin = !!r.needLogin;
      } else {
        state.picker.folders = r.folders || [];
      }
      render();
    });
  }

  // 只在用户点了「修改目录」时才走这里
  function openPicker() {
    if (state.picker) { state.picker = null; render(); return; }
    var d = loadDir();
    var path = Array.isArray(d.path) ? d.path.slice() : [];
    // 记录的路径和当前 cid 对不上（比如在别处改过）就从根重来，别把人卡在错的位置
    if (!path.length || String(path[0].cid) !== '0' ||
      String(path[path.length - 1].cid) !== String(d.cid)) {
      path = [{ cid: '0', name: '根目录' }];
    }
    state.picker = { loading: true, folders: [], err: '', needLogin: false, path: path };
    state.tab = 'push';
    render();
    loadPickerAt(path[path.length - 1].cid);
  }

  // 账号名：一个会话只取一次，除非用户点「刷新」
  function ensureAcc() {
    if (state.acc && (state.acc.loading || state.acc.name || state.acc.uid || state.acc.err)) return;
    state.acc = { loading: true };
    render();
    fetch115Account().then(function (r) {
      state.acc = {
        loading: false,
        name: r.name || '',
        uid: r.uid || '',
        err: r.ok ? '' : (r.error || '取账号失败'),
        needLogin: !!r.needLogin
      };
      if (state.settings) render();
    });
  }

  function render() {
    if (!cardRoot) return;
    var rows = state.rows, infos = state.infos, top = state.top;
    var tieN = 0;   // 同档范围（相差 ≤3 分的连续前几名），设置页里用不到，默认 0

    var body = '';
    if (state.settings) {
      body = renderSettings();
    } else {
      // 标签着色（v1.9.1）：先统计每个标签在本轮排行里出现于几行。
      //   · 全体都有（freq === n）⇒ 不是差异点，压暗，眼睛自动跳过
      //   · 只在部分行出现 ⇒ 正是要对比的地方，点亮
      //   · 只有 1 条时无「对比」可言，全部按常态灰显示，避免整行花掉
      var nTop = top.length, freq = {}, tokRows = [], vStat = {};
      for (var a = 0; a < nTop; a++) {
        var ts = tokensOf(infos[top[a]]);
        tokRows.push(ts);
        var seen = {};
        for (var b = 0; b < ts.length; b++) {
          var tk0 = ts[b];
          if (!seen[tk0.t]) { seen[tk0.t] = 1; freq[tk0.t] = (freq[tk0.t] || 0) + 1; }
          // 同一键（k）在各行的分值：只有值不同才算「有差异」，才值得把分数写出来。
          // 这正对着他的要求「相同的标签不计分，同档有差异的标签在标签内显示 +- 的分数」。
          if (tk0.k) {
            var st = vStat[tk0.k] || (vStat[tk0.k] = { n: 0, v: null, diff: false });
            st.n++;
            if (st.v === null) st.v = tk0.v;
            else if (Math.abs(st.v - tk0.v) > 0.05) st.diff = true;
          }
        }
      }
      // 有的行根本没这个标签（中字 vs 无字幕）＝ 本身就是差异
      Object.keys(vStat).forEach(function (k) {
        if (vStat[k].n < nTop) vStat[k].diff = true;
      });

      // 「算不算差异」统一在这里判定，chipRow 与排序都必须用它，否则会出现
      // 「排在差异段却没有高亮」的自相矛盾。
      // 判据：① 不是每行都有这个文案；② 同一键在各行的分值不完全相同。
      // 第 ② 条是关键：DDP 与 DTS 文案不同、分值一样（都是 5.1 有损），
      // 按他的口径这属于「相同的标签不计分」，不该被点亮、也不该写 0 占位置。
      function isDiff(tk) {
        if (nTop < 2 || freq[tk.t] >= nTop) return false;
        // 警告 / 缺信息永远要点出来，哪怕三条同分 —— 它们不是「分值差异」，
        // 而是「这条有坑，你得知道」。枪版、无字幕、没标音轨都属于这一类。
        if (tk.tone === 'warn' || tk.tone === 'bad' || tk.tone === 'mute') return true;
        var vs0 = tk.k && vStat[tk.k];
        if (vs0 && !vs0.diff && vs0.n >= nTop) return false;
        return true;
      }

      var chipRow = function (ts) {
        var h = '';
        for (var c = 0; c < ts.length; c++) {
          var tk = ts[c];
          var hi = isDiff(tk);
          var vs = vStat[tk.k];
          var showV = nTop >= 2 && !!tk.k && vs && vs.diff && Math.abs(tk.v) >= 0.05;
          // 体积分的口径与别项不同（档内相对量，不是总分），悬停说明一下，避免被当成重复计分
          var tip = tk.k === 'vol' ? '同档内以体积最小的那条为基准，多占一成记 −1' : '';
          h += '<span class="w ' + (hi ? 'hi t-' + tk.tone : 'same') + '"' +
            (tip ? ' title="' + esc(tip) + '"' : '') + '>' + esc(tk.t) +
            (showV ? '<i class="dv">' + (tk.v > 0 ? '+' : '') + N(tk.v) + '</i>' : '') + '</span>';
        }
        return h;
      };

      // 分组排序（v1.9.2）：统计完才知道谁跟谁一样 ⇒ 排序放在这里。
      // 「全体都有」的共性放左当背景，「只有部分有」的差异放右当焦点，组内仍按 rank。
      // 现代 V8 的 sort 是稳定的，但这里显式带原始下标兜底，避免老内核把同组顺序打乱。
      if (nTop >= 2) {
        for (var s = 0; s < tokRows.length; s++) {
          tokRows[s] = tokRows[s].map(function (tk, ix) { return { tk: tk, ix: ix }; })
            .sort(function (x, y) {
              var dx = isDiff(x.tk) ? 1 : 0;
              var dy = isDiff(y.tk) ? 1 : 0;
              return (dx - dy) || (x.ix - y.ix);
            })
            .map(function (o2) { return o2.tk; });
        }
      }

      /* ---- 右侧「为什么」列（v1.10.1）----
       * 分差只有 1~2 分时，分数本身说明不了任何事 —— 三条往往同画质同编码同字幕，
       * 差别只在「多一条音轨」这类小项。所以这里不重复标签行已经写过的「4K / 中字」
       * （那是三条共有的，说了等于没说），只写**跟上一名差在哪**：
       *   · 分差 ≠ 0 → 「少 1 分 · 2 条音轨 −1」
       *   · 分差 = 0 → 「同分 · 体积 +1.18GB」—— 同分时先后本来就是体积决出来的
       * 跟「上一名」比而不是跟第一名比，因为决定谁排前面的永远是相邻两行。
       */
      var NEAR = TIER_NEAR;   // 相差 ≤3 分视为同档（与 rankByTier 同一把尺子）
      function hitMap(info) {
        var m = {}, hs = info.hits || [];
        for (var q = 0; q < hs.length; q++) m[hs[q].k] = hs[q];
        return m;
      }
      function diffOf(a, b) {
        var ma = hitMap(a), mb = hitMap(b), out = [];
        Object.keys(ma).forEach(function (k) {
          var v = Math.round((ma[k].v - (mb[k] ? mb[k].v : 0)) * 10) / 10;
          if (Math.abs(v) >= 0.05) out.push({ t: ma[k].t, v: v });
        });
        Object.keys(mb).forEach(function (k) {
          if (ma[k] || Math.abs(mb[k].v) < 0.05) return;
          out.push({ t: mb[k].t, v: -mb[k].v });
        });
        out.sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); });
        return out;
      }
      // v1.11.0：总分只反映「画质档位」——体积和多音轨条数已经退出计分，
      // 同一档的资源靠体积分先后（排序键＝分数降序 → 体积升序），
      // 所以这里最常见的理由就是体积差，而不是「差 1 分」。
      var BASE = nTop ? infos[top[0]] : null;
      function gbDiff(info, ref) {
        if (!info.gb || !ref || !ref.gb) return null;
        return Math.round((info.gb - ref.gb) * 100) / 100;
      }
      function gbText(d) {
        if (d === null) return '体积未知';
        if (Math.abs(d) < 0.01) return '体积相同';
        return d > 0 ? '体积 +' + d + 'GB' : '省 ' + Math.abs(d) + 'GB';
      }
      function reasonOf(i) {
        var info = infos[top[i]];
        if (i === 0) {
          // 只有一条时没有「差在哪」可比，就写它凭什么得分：取贡献最大的三项
          if (nTop < 2) {
            var hs = (info.hits || []).slice().sort(function (x, y) { return Math.abs(y.v) - Math.abs(x.v); });
            var tl = [];
            for (var u = 0; u < hs.length && tl.length < 3; u++) {
              tl.push(hs[u].t + (hs[u].v > 0 ? ' +' : ' ') + N(hs[u].v));
            }
            return '<span class="rz top" title="' + esc(info.why.join('\n')) + '">' +
              esc(tl.join('，') || '无有效特征') + '</span>';
          }
          var lead = info.showScore - infos[top[1]].showScore;
          if (lead > NEAR) return '<span class="rz top">领先第 2 名 <b>' + lead + '</b> 分</span>';
          // 同档：第 1 名就是同档里体积最小的那条
          return '<span class="rz top" title="与第 2 名画质同档，只因为它更省地方">同档 · ' +
            gbText(gbDiff(info, infos[top[1]])) + '</span>';
        }
        var d = info.showScore - BASE.showScore;
        if (d === 0) {
          return '<span class="rz tie" title="画质与第 1 名同档，名次由体积决定">同档 · ' +
            gbText(gbDiff(info, BASE)) + '</span>';
        }
        var ds = diffOf(info, BASE), parts = [];
        for (var j = 0; j < ds.length && parts.length < 2; j++) {
          parts.push(ds[j].t + (ds[j].v > 0 ? ' +' : ' ') + N(ds[j].v));
        }
        var txt = parts.length ? parts.join('，') : '综合差异';
        return '<span class="rz' + (Math.abs(d) <= NEAR ? ' near' : '') + '" title="' +
          esc(txt) + (ds.length > parts.length ? ' 等 ' + ds.length + ' 项' : '') + '">' +
          (d > 0 ? '多 <b>+' + d + '</b>' : '少 <b>' + Math.abs(d) + '</b>') + ' 分 · ' +
          esc(txt) + '</span>';
      }

      // 同档范围：从第 1 名往下数，连续几条都在 3 分内
      for (var z = 1; z < nTop; z++) {
        if (infos[top[0]].tier === infos[top[z]].tier) tieN = z + 1;
        else break;
      }

      for (var i = 0; i < top.length; i++) {
        var idx = top[i], info = infos[idx], row = rows[idx];
        var name = nameOf(row);
        var mag = magnetOf(row);
        body += '<div class="it" data-i="' + idx + '">' +
          '<div class="ln">' +
          '<span class="rk">' + (i + 1) + '</span>' +
          '<button class="cp" data-act="push"' + (mag ? '' : ' disabled') +
          ' title="' + (mag ? '推送到 115 离线（直连）' : '这一行没抓到磁力链接') + '">' +
          (mag ? '推到 115' : '无磁力') + '</button>' +
          '<button class="cc" data-act="copy" title="复制磁力链接">⧉</button>' +
          '<span class="sz">' + (info.gb ? info.gb + ' GB' : '体积未知') + '</span>' +
          '<span class="nm" title="' + esc(name) + '">' + esc(name) + '</span>' +
          '<span class="sc">' + (info.showScore != null ? info.showScore : info.score) + ' 分</span></div>' +
          '<div class="why" title="' + esc(info.why.join('\n')) + '">' +
          chipRow(tokRows[i]) + reasonOf(i) + '</div>' +
          '<div class="err" data-err></div>' +
          '</div>';
      }
    }

    cardRoot.innerHTML = '<style>' + CSS + '</style>' +
      '<div class="card' + (state.mode === 'header' ? ' slim' : '') + '">' +
      '<div class="hd"><span class="tt">片源挑选助手</span>' +
      '<span class="tag" title="点右边 ⚙ 可改推荐口径（电视/电脑/手机）">' + esc(profileLabel()) + '</span>' +
      '<span class="meta">' + (rows.length ? '识别 ' + rows.length + ' 条' : '') +
      (state.mode === 'header' ? (rows.length ? ' · ' : '') + 'v' + VERSION : '') + '</span>' +
      '<button class="ib" data-act="rescan" title="重新扫描">⟳</button>' +
      '<button class="ib" data-act="gear" title="设置（推荐口径 / 115 推送 / 评分权重）">⚙</button>' +
      '<button class="ib" data-act="hide" title="收起">×</button></div>' +
      '<div class="items">' + body + '</div>' +
      '<div class="ft">v' + VERSION + ' · ' +
      (tieN >= 2
        ? '前 ' + tieN + ' 名画质同档，体积小的在前 · 标签上的 ± 只标有差异的项'
        : (state.status || '悬停标签看该项分值，标签上的 ± 只标有差异的项')) +
      '</div>' +
      '</div>';

    bind();
  }

  function bind() {
    var root = cardRoot;

    var rescan = root.querySelector('[data-act="rescan"]');
    if (rescan) rescan.addEventListener('click', function () {
      var n = safeScan();
      if (!n) showDiag();
      else { state.status = '已重新扫描'; render(); }
    });

    var gear = root.querySelector('[data-act="gear"]');
    if (gear) gear.addEventListener('click', function () {
      if (state.settings) { closeSettings(); return; }
      // v1.9.0：打开设置**不发请求**，先落在「推荐口径」页
      state.settings = true;
      state.picker = null;
      state.test = null;
      render();
      if (state.tab === 'push') ensureAcc();
    });

    var hide = root.querySelector('[data-act="hide"]');
    if (hide) hide.addEventListener('click', function () {
      cardRoot.querySelector('.card').style.display = 'none';
    });

    // ---- 设置：分页切换 ----
    var tbs = root.querySelectorAll('[data-act="tab"]');
    for (var ti = 0; ti < tbs.length; ti++) {
      (function (b) {
        b.addEventListener('click', function () {
          state.tab = b.getAttribute('data-tab') || 'prof';
          showSettingError('');
          render();
          if (state.tab === 'push') ensureAcc();
        });
      })(tbs[ti]);
    }

    // ---- 设置：设备口径（多选，至少留一台）----
    var devs = root.querySelectorAll('[data-act="dev"]');
    for (var di = 0; di < devs.length; di++) {
      (function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-dev');
          if (!DEV[k]) return;
          var c = cfg(), prof = {};
          DEV_ORDER.forEach(function (x) {
            if (c.prof[x] !== null && typeof c.prof[x] !== 'undefined') prof[x] = c.prof[x];
          });
          if (prof[k] !== null && typeof prof[k] !== 'undefined') {
            delete prof[k];
            if (!Object.keys(prof).length) {
              showSettingError('至少要留一台设备 —— 一台都不选就没法判断「值不值」了');
              return;
            }
          } else {
            prof[k] = DEV[k].ref;   // 选中时给个参考尺寸，用户可再改
          }
          saveCfg({ prof: prof, w: c.w });
          state.dirty = true;
          showSettingError('');
          render();
        });
      })(devs[di]);
    }

    // ---- 设置：设备尺寸 ----
    var szs = root.querySelectorAll('[data-act="size"]');
    for (var si = 0; si < szs.length; si++) {
      (function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-dev'), s = Number(b.getAttribute('data-size'));
          if (!DEV[k] || DEV[k].sizes.indexOf(s) < 0) return;
          var c = cfg(), prof = {};
          DEV_ORDER.forEach(function (x) {
            if (c.prof[x] !== null && typeof c.prof[x] !== 'undefined') prof[x] = c.prof[x];
          });
          prof[k] = s;
          saveCfg({ prof: prof, w: c.w });
          state.dirty = true;
          render();
        });
      })(szs[si]);
    }

    // ---- 设置：「修改目录」—— 只有点这里才去 115 拉目录 ----
    var dirBtn = root.querySelector('[data-act="dir"]');
    if (dirBtn) dirBtn.addEventListener('click', function () { openPicker(); });

    // ---- 设置：刷新账号名 ----
    var accBtn = root.querySelector('[data-act="acc"]');
    if (accBtn) accBtn.addEventListener('click', function () {
      if (state.acc && state.acc.loading) return;
      state.acc = null;
      ensureAcc();
    });

    // ---- 设置：Cookie 来源（浏览器 / 自己填）----
    var cks = root.querySelectorAll('[data-act="ckmode"]');
    for (var ki = 0; ki < cks.length; ki++) {
      (function (b) {
        b.addEventListener('click', function () {
          var m = b.getAttribute('data-mode') === 'manual' ? 'manual' : 'auto';
          saveCkMode(m);
          state.test = null;
          showSettingError('');
          render();
        });
      })(cks[ki]);
    }

    // 手填 cookie：失焦即存，不用另点保存
    var ckTa = root.querySelector('.f-ck');
    if (ckTa) ckTa.addEventListener('change', function () {
      saveCookie(ckTa.value);
      state.test = null;
      state.status = 'Cookie 已保存，点「保存并测试」验证';
    });

    // ---- 设置：权重（v1.10.0 维度偏好 + 高级单项 + 预设）----

    // ① 一键预设
    var psets = root.querySelectorAll('[data-act="wpreset"]');
    for (var pi = 0; pi < psets.length; pi++) {
      (function (b) {
        b.addEventListener('click', function () {
          var key = b.getAttribute('data-p'), p = null;
          for (var q = 0; q < W_PRESETS.length; q++) if (W_PRESETS[q].k === key) p = W_PRESETS[q];
          if (!p) return;
          state.wdraft = wFromPreset(p);
          commitW();
          state.status = '权重已套用「' + p.label + '」';
          render();
        });
      })(psets[pi]);
    }

    // ② 维度偏好滑块：拖动只改草稿（不重建 DOM，否则手指一拖就断），松手才落盘
    var prs = root.querySelectorAll('.wr[data-pg]');
    for (var pri = 0; pri < prs.length; pri++) {
      (function (inp) {
        inp.addEventListener('input', function () {
          var g = PREF_GROUPS[Number(inp.getAttribute('data-pg'))];
          if (!g) return;
          setPref(g, draftW(), inp.value);
          syncW(root);
          schedulePreview();
        });
        inp.addEventListener('change', function () { commitW(); });
      })(prs[pri]);
    }

    // ③ 高级：单项滑块（打破等比用）
    var wrs = root.querySelectorAll('.wr[data-w]');
    for (var wi = 0; wi < wrs.length; wi++) {
      (function (inp) {
        inp.addEventListener('input', function () {
          var k = inp.getAttribute('data-w');
          if (!k || !(k in W)) return;
          var w = draftW();
          w[k] = Math.round(W[k] * multRound(inp.value, keyMax(k)) * 100) / 100;
          syncW(root);
          schedulePreview();
        });
        inp.addEventListener('change', function () { commitW(); });
      })(wrs[wi]);
    }

    // ④ 展开 / 收起某维度的高级项
    var adjs = root.querySelectorAll('[data-act="wadv"]');
    for (var ai = 0; ai < adjs.length; ai++) {
      (function (b) {
        b.addEventListener('click', function () {
          var gi = Number(b.getAttribute('data-g'));
          state.wfold[gi] = !state.wfold[gi];
          render();
        });
      })(adjs[ai]);
    }

    // ⑤ 展开 / 收起「设备相关」三项
    var devTog = root.querySelector('[data-act="wdev"]');
    if (devTog) devTog.addEventListener('click', function () {
      state.wdev = !state.wdev;
      render();
    });

    // 「全部恢复默认」只重置权重，**保留口径** —— 手机党点一下不该被拽回电视口径
    var wReset = root.querySelector('[data-act="wreset"]');
    if (wReset) wReset.addEventListener('click', function () {
      var c = cfg(), w = {};
      Object.keys(W).forEach(function (k) { w[k] = W[k]; });
      state.wdraft = null;
      saveCfg({ prof: c.prof, w: w });
      state.dirty = true;
      state.status = '权重已恢复默认';
      render();
    });

    // 目录：进入子文件夹
    var fds = root.querySelectorAll('.fd');
    for (var fi = 0; fi < fds.length; fi++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          if (!state.picker) return;
          state.picker.path = state.picker.path.concat([{
            cid: btn.getAttribute('data-cid'),
            name: btn.getAttribute('data-name')
          }]);
          loadPickerAt(btn.getAttribute('data-cid'));
        });
      })(fds[fi]);
    }

    // 目录：面包屑跳回某一级（只绑带 data-pi 的，登录链接那个 .cb 不参与）
    var cbs = root.querySelectorAll('.cb[data-pi]');
    for (var ci = 0; ci < cbs.length; ci++) {
      (function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          if (!state.picker) return;
          var pi = parseInt(a.getAttribute('data-pi'), 10);
          if (isNaN(pi) || pi < 0 || pi >= state.picker.path.length) return;
          state.picker.path = state.picker.path.slice(0, pi + 1);
          loadPickerAt(state.picker.path[pi].cid);
        });
      })(cbs[ci]);
    }

    var upBtn = root.querySelector('[data-act="up"]');
    if (upBtn) upBtn.addEventListener('click', function () {
      if (!state.picker || state.picker.path.length <= 1) return;
      state.picker.path = state.picker.path.slice(0, -1);
      loadPickerAt(state.picker.path[state.picker.path.length - 1].cid);
    });

    // 存到这里：只存目录（cookie 有自己的保存时机），面板留在原地显示新目录
    var pickBtn = root.querySelector('[data-act="pick"]');
    if (pickBtn) pickBtn.addEventListener('click', function () {
      if (!state.picker) return;
      var p = state.picker.path, cur = p[p.length - 1];
      saveDir({ cid: cur.cid, name: cur.name, path: p });
      state.picker = null;
      state.status = '离线目录已设为「' + cur.name + '」';
      render();
    });

    // 「保存并测试」：给一个明确结论 —— 成功/失败、哪个账号、目录能不能读
    var testBtn = root.querySelector('[data-act="test"]');
    if (testBtn) testBtn.addEventListener('click', function () {
      if (state.test && state.test.loading) return;
      var ta = root.querySelector('.f-ck');
      if (ta) saveCookie(ta.value);
      var mode = loadCkMode();

      // 选了「自己填」却一个字都没填 —— 直接给结论，不浪费一次请求
      if (mode === 'manual' && !loadCookie()) {
        state.test = {
          loading: false, ok: false,
          text: '❌ 没测成：已选「自己填 Cookie」，但输入框是空的。\n' +
            '要么把 UID=..; CID=..; SEID=..; KID=.. 填进去，要么切回「用浏览器登录态」。'
        };
        render();
        return;
      }

      state.test = { loading: true };
      showSettingError('');
      render();

      var modeText = mode === 'manual' ? '自己填的 Cookie' : '浏览器登录态';

      check115Login().then(function (r) {
        if (!r.ok) {
          state.acc = null;
          state.test = {
            loading: false, ok: false,
            text: '❌ 失败：' + (r.error || '连不上 115') + '\n' +
              (r.needLogin
                ? '下一步：① 打开 115.com 确认已登录（必要时重新登录），再点一次测试；' +
                  '② 还是不行就切到「自己填 Cookie」，粘一份新的 UID / CID / SEID / KID。'
                : '下一步：确认能打开 115.com（网络/代理），或用诊断面板看油猴跨域权限。')
          };
          render();
          return;
        }

        // 登录通了 → 顺手取账号名 + 试读当前目录，给一个完整结论
        return fetch115Account().then(function (a) {
          state.acc = {
            loading: false, name: a.name || '', uid: a.uid || '',
            err: a.ok ? '' : (a.error || ''), needLogin: !!a.needLogin
          };
          var dir = loadDir();
          return list115Folders(dir.cid).then(function (f) {
            var who = a.ok
              ? '账号「' + (a.name || (a.uid ? 'UID ' + a.uid : '已登录')) + '」'
              : '账号昵称没取到（但登录态有效）';
            var lines = ['✅ 登录有效 · ' + who + ' · 用的是' + modeText];
            var allOk = true;
            if (f.ok) {
              lines.push('✅ 目录「' + dir.name + '」可访问（' + (f.folders || []).length + ' 个子文件夹）');
            } else if (f.needLogin) {
              allOk = false;
              lines.push('⚠️ 登录刚说有效，但读目录被拒：' + (f.error || '') + '\n下一步：刷新 115.com 页面后重试。');
            } else {
              allOk = false;
              lines.push('⚠️ 目录「' + dir.name + '」读不出来：' + (f.error || '未知原因') +
                '\n下一步：换个目录试试（点「修改目录」），或稍后重试。');
            }
            state.status = allOk ? '115 连接正常 · ' + (a.name || '已登录') : '115 能连上，但目录读不出来';
            state.test = { loading: false, ok: allOk, text: lines.join('\n') };
            render();
          });
        });
      });
    });

    var back = root.querySelector('[data-act="back"]');
    if (back) back.addEventListener('click', function () { closeSettings(); });

    var items = root.querySelectorAll('.it');
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        var idx = parseInt(item.getAttribute('data-i'), 10);
        var row = state.rows[idx];
        var err = item.querySelector('[data-err]');
        var push = item.querySelector('[data-act="push"]');
        var copy = item.querySelector('[data-act="copy"]');

        if (copy) copy.addEventListener('click', function () {
          var mag = magnetOf(row);
          var target = mag || detailOf(row);
          if (!target) { err.textContent = '这一行没有磁力链接，也没有详情页可复制'; return; }
          copyText(target).then(function (ok) {
            copy.textContent = ok ? '✓' : '✗';
            setTimeout(function () { copy.textContent = '⧉'; }, 1500);
          });
        });

        if (push) push.addEventListener('click', function () {
          var mag = magnetOf(row);
          if (!mag) { err.textContent = '这一行没抓到磁力链接'; return; }
          var label = push.textContent;
          push.textContent = '推送中…';
          push.disabled = true;
          err.textContent = '';
          err.className = 'err';
          pushTo115(mag).then(function (r) {
            push.disabled = false;
            if (r.ok) {
              push.textContent = r.dup ? '已在库里' : '已推送 ✓';
              push.className = 'cp ok';
              err.className = 'err good';
              err.textContent = r.dup
                ? ('这条之前已经加过了 · 目录：' + (r.dir || '离线目录'))
                : ('已推到「' + (r.dir || '离线目录') + '」');
              setTimeout(function () {
                push.textContent = label;
                push.className = 'cp';
              }, 2500);
            } else {
              push.textContent = r.needLogin ? '去登录' : '重试推送';
              push.className = 'cp bad';
              err.className = 'err';
              err.textContent = (r.error || '推送失败') +
                (r.needLogin ? ' —— 点这里去 115 登录' : '');
              if (r.needLogin) {
                push.onclick = function () {
                  window.open('https://115.com/?mode=login', '_blank');
                };
              }
            }
          });
        });
      })(items[i]);
    }
  }

  function showSettingError(msg) {
    if (!cardRoot) return;
    var e = cardRoot.querySelector('[data-err]');
    if (e) e.textContent = msg;
  }

  // 关设置：如果改过口径/权重就顺手重打一次分，免得表里还挂着旧分
  function closeSettings() {
    state.settings = false;
    state.picker = null;
    state.wdraft = null;     // 下次进来从已保存值重新起稿
    state.wfold = {};
    state.wdev = false;
    showSettingError('');
    var dirty = state.dirty;
    state.dirty = false;
    if (dirty) {
      state.status = '口径/权重已更新，重新打分';
      safeScan();
    } else {
      render();
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ======================= 悬浮入口 · 诊断面板 ======================= */

  var pill = null, diagHost = null;

  function ensurePill(text) {
    if (!document.body) return;
    if (!pill || !document.contains(pill)) {
      var p = document.createElement('div');
      p.setAttribute('data-psb-pill', '1');
      p.textContent = text || '片源助手';
      p.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483000;padding:6px 12px;' +
        'border-radius:999px;background:#0F6E56;color:#fff;box-shadow:0 3px 10px rgba(0,0,0,.24);' +
        'font:500 12px/18px system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
        'cursor:pointer;user-select:none;opacity:.9';
      p.addEventListener('mouseenter', function () { p.style.opacity = '1'; });
      p.addEventListener('mouseleave', function () { p.style.opacity = '.9'; });
      p.addEventListener('click', onPillClick);
      document.body.appendChild(p);
      pill = p;
      return;
    }
    if (text) pill.textContent = text;
  }

  function ensurePillText(t) {
    if (pill && document.contains(pill)) pill.textContent = t;
  }

  // 点悬浮标签：有卡片就展开/收起，没卡片就现场扫一次，扫不到给诊断
  function onPillClick() {
    if (cardHost && cardRoot && document.contains(cardHost)) {
      var card = cardRoot.querySelector ? cardRoot.querySelector('.card') : null;
      if (card) {
        var hidden = card.style.display === 'none';
        card.style.display = hidden ? '' : 'none';
        if (hidden) { try { cardHost.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
        return;
      }
    }
    var n = safeScan();
    if (n) { ensurePillText('片源助手 · ' + n + ' 条'); return; }
    showDiag();
  }

  function diagText() {
    var st = readyState(), L = [];
    L.push('版本：v' + VERSION);
    L.push('页面：' + location.href);
    L.push('域名：' + hostKey());
    L.push('结论：' + (st.ok ? '已识别到资源行，应显示卡片' : '没识别到资源行，所以没卡片'));
    L.push(describe(st));
    L.push('tr=' + st.trs + ' · li=' + st.lis + ' · 磁力=' + st.mag);
    L.push('白名单：' + (CONF.allowHosts.join(',') || '（空）') + ' · 本页' + (st.allowed ? '在' : '不在') + '名单内');
    L.push('油猴权限：GM_xmlhttpRequest=' + (typeof GM_xmlhttpRequest === 'function' ? '有' : '无') +
      ' · GM_getValue=' + (typeof GM_getValue === 'function' ? '有' : '无'));
    // 115 推送状态：只报「填没填、多长」，绝不回显 cookie 内容
    var dd = loadDir(), ck = loadCookie(), cm = loadCkMode();
    L.push('115 推送：目录=' + dd.name + '（cid=' + dd.cid + '）');
    L.push('Cookie 来源：' + (cm === 'manual'
      ? '自己填（' + (ck ? ck.length + ' 字符 · ' + ck.replace(/=[^;]+/g, '=***') : '还没填') + '）'
      : '浏览器登录态（withCredentials 自动带，脚本不存）'));
    L.push('115 账号：' + (state.acc && (state.acc.name || state.acc.uid)
      ? (state.acc.name || '') + (state.acc.uid ? '（UID ' + state.acc.uid + '）' : '')
      : (state.acc && state.acc.err ? '取不到 · ' + state.acc.err : '未读取')));
    L.push('推荐口径：' + profileLabel() + ' · 权重：' +
      (JSON.stringify(cfg().w) === JSON.stringify(W) ? '默认' : '已自定义'));
    var sample = '';
    try {
      var trs = document.querySelectorAll('tr');
      for (var i = 0; i < trs.length && i < 60; i++) {
        var c = trs[i].cloneNode(true);
        // 把脚本自己插的徽章去掉，否则样例里会混进「首选 60」这类文字
        var bs = c.querySelectorAll ? c.querySelectorAll('[data-psb-badge]') : [];
        for (var k = 0; k < bs.length; k++) if (bs[k].parentNode) bs[k].parentNode.removeChild(bs[k]);
        var t = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (/2160p|1080p|4k|uhd/i.test(t)) { sample = t.slice(0, 240); break; }
      }
      if (!sample) {
        var txt = (document.body.innerText || '').replace(/\s+/g, ' ');
        var at = txt.search(/2160p|1080p|\b4k\b/i);
        if (at >= 0) sample = txt.slice(Math.max(0, at - 80), at + 180);
      }
    } catch (e) {}
    L.push('样例文字：' + (sample || '（整页找不到 2160p/1080p 字样）'));
    return L.join('\n');
  }

  function showDiag() {
    try {
      if (diagHost && document.contains(diagHost)) { diagHost.remove(); diagHost = null; return; }
      var host = document.createElement('div');
      host.setAttribute('data-psb-diag', '1');
      host.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483001;' +
        'width:min(560px,92vw);max-height:80vh;overflow:auto;background:#fff;color:#2C2C2A;' +
        'border:.5px solid rgba(0,0,0,.2);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.28)';
      var text = diagText();
      host.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #eee;' +
        'font:600 13px/1.4 system-ui,\'Microsoft YaHei\',sans-serif">片源助手 · 诊断' +
        '<button data-act="close" style="margin-left:auto;border:0;background:transparent;font-size:16px;cursor:pointer;color:#888">×</button></div>' +
        '<pre style="margin:0;padding:10px 12px;font:400 11.5px/1.65 ui-monospace,Consolas,monospace;' +
        'white-space:pre-wrap;word-break:break-all;color:#333;user-select:text">' + esc(text) + '</pre>' +
        '<div style="display:flex;gap:8px;padding:0 12px 12px">' +
        '<button data-act="copy" style="flex:1;border:.5px solid #0F6E56;background:#0F6E56;color:#fff;border-radius:7px;' +
        'padding:6px 8px;font:500 12px/1.35 system-ui,sans-serif;cursor:pointer">复制诊断信息</button>' +
        '<button data-act="rescan" style="border:.5px solid rgba(0,0,0,.18);background:#F1EFE8;border-radius:7px;' +
        'padding:6px 12px;font:400 12px/1.35 system-ui,sans-serif;cursor:pointer">重新扫描</button></div>';
      document.body.appendChild(host);
      diagHost = host;
      host.querySelector('[data-act="close"]').addEventListener('click', function () {
        host.remove(); diagHost = null;
      });
      host.querySelector('[data-act="copy"]').addEventListener('click', function () {
        copyText(text).then(function (ok) {
          var b = host.querySelector('[data-act="copy"]');
          if (b) b.textContent = ok ? '已复制 ✓' : '复制失败';
        });
      });
      host.querySelector('[data-act="rescan"]').addEventListener('click', function () {
        var n = safeScan();
        host.remove(); diagHost = null;
        if (n) ensurePillText('片源助手 · ' + n + ' 条');
      });
    } catch (e) { /* 诊断面板本身不该影响页面 */ }
  }

  /* ======================= 扫描主流程 ======================= */

  // 行文本（v1.9.1）：单元格之间必须补空格。
  // 真实站点的 `<td>` 拼起来是 `...H265.HDR2160p14.49GB` 这样没有分隔符的串，
  // 尾部关键词（HDR / REMUX / DTS…）紧贴下一格的数字时，`\b` 词边界不成立，整项特征直接丢失。
  // 实测：截图第 3 条就因此少认一个 HDR10，白掉 15 分。
  function rowText(row) {
    if (row && row.querySelectorAll) {
      var cells = row.querySelectorAll('td,th');
      if (cells.length) {
        var parts = [];
        for (var i = 0; i < cells.length; i++) {
          parts.push(String(cells[i].textContent || '').replace(/\s+/g, ' ').trim());
        }
        return parts.join(' ');
      }
    }
    return String((row && row.textContent) || '');
  }

  function scan() {
    var rows = candidates();
    state.rows = rows;
    if (!rows.length) return 0;

    var infos = rows.map(function (row) {
      return analyze(rowText(row) + ' ' + (row.getAttribute('title') || ''));
    });
    state.infos = infos;

    var order = rankByTier(infos);
    var top = order.slice(0, Math.min(CONF.topN, order.length));
    state.top = top;
    var rankOf = {};
    for (var r = 0; r < top.length; r++) rankOf[top[r]] = r;

    // 徽章重画（分页 / 排序后仍然对得上）
    var old = document.querySelectorAll('[data-psb-badge]');
    for (var k = 0; k < old.length; k++) if (old[k].parentNode) old[k].parentNode.removeChild(old[k]);
    var done = document.querySelectorAll('[data-psb-done]');
    for (var d = 0; d < done.length; d++) {
      done[d].removeAttribute('data-psb-done');
      try { done[d].style.boxShadow = ''; } catch (e) {}
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], info = infos[i];
      row.setAttribute('data-psb-done', '1');
      var rank = Object.prototype.hasOwnProperty.call(rankOf, i) ? rankOf[i] : -1;
      var badge = makeBadge(info, rank);
      var as = row.querySelectorAll('a[href]'), anchor = null, len = 0;
      for (var n = 0; n < as.length; n++) {
        var L = (as[n].textContent || '').trim().length;
        if (L > len) { len = L; anchor = as[n]; }
      }
      try {
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(badge, anchor);
        else row.insertBefore(badge, row.firstChild);
      } catch (e) {}
      if (rank >= 0) {
        try {
          row.style.boxShadow = 'inset 3px 0 0 ' + RANK[rank].bd;
          row.setAttribute('data-psb-top', String(rank + 1));
        } catch (e) {}
      }
    }

    // 站点是 SPA 时卡片可能被整块换掉，重新挂一次
    if (!cardHost || !document.contains(cardHost) || !cardRoot) {
      cardHost = null; cardRoot = null;
      mountHost(rows);
    }
    render();
    ensurePillText('片源助手 · ' + rows.length + ' 条');
    return rows.length;
  }

  var mo = null, busy = false, timer = 0;

  function installObserver() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    mo = new MutationObserver(function (muts) {
      if (busy) return;
      var relevant = false;
      for (var i = 0; i < muts.length && !relevant; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute && (n.hasAttribute('data-psb-badge') || n.hasAttribute('data-psb-card'))) continue;
          var t = n.textContent || '';
          if (/(2160p|1080p|4k|uhd)/i.test(t) || (n.querySelector && n.querySelector('a[href^="magnet:"]'))) {
            relevant = true; break;
          }
        }
      }
      if (!relevant) return;
      clearTimeout(timer);
      timer = setTimeout(safeScan, 700);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function safeScan() {
    if (busy) return 0;
    busy = true;
    var n = 0;
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { n = scan() || 0; } catch (e) { log('扫描时出错：' + (e && e.message ? e.message : e)); }
    busy = false;
    try { if (mo) mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    return n;
  }

  // 站点多半是异步渲染的：内容没出来之前先等，别一次不成就不管了
  var RETRY = [400, 1000, 2200, 4000, 7000, 12000];

  function retryScan(i) {
    if (i >= RETRY.length) {
      log('等了几轮仍然没识别到资源行，点右下角「片源助手」可看诊断。');
      return;
    }
    setTimeout(function () {
      var n = safeScan();
      if (n) return;
      retryScan(i + 1);
    }, RETRY[i]);
  }

  function boot() {
    log('v' + VERSION + ' 已加载 · ' + hostKey());
    var st = readyState();
    if (wantHere(st)) { activate(st); return; }
    probe(0);
  }

  // 非白名单站点：先静默等几拍（不挂监听、不插任何东西），
  // 等页面把资源渲染出来再接管 —— 这样换域名也不用改代码。
  var PROBE = [1200, 3000, 7000, 14000];

  function probe(i) {
    if (i >= PROBE.length) { log('本页不接管 → ' + describe(readyState())); return; }
    setTimeout(function () {
      var st = readyState();
      if (wantHere(st)) { activate(st); return; }
      probe(i + 1);
    }, PROBE[i]);
  }

  function activate(st) {
    log('接管本页 → ' + describe(st));
    ensurePill(st.rows ? '片源助手 · ' + st.rows + ' 条' : '片源助手');
    if (st.rows > 0) safeScan();
    else retryScan(0);
    installObserver();
    // v1.8.0：不再开机预取账号 —— 目录只在打开设置面板时才请求，省一次跨域往返
  }

  window.__PSB__ = {
    version: VERSION,
    analyze: analyze,
    parseSize: parseSize,
    scan: safeScan,
    pushTo115: pushTo115,
    check115Login: check115Login,
    list115Folders: list115Folders,
    fetch115Account: fetch115Account,
    loadDir: loadDir,
    loadCookie: loadCookie,
    loadCkMode: loadCkMode,
    saveCkMode: saveCkMode,
    cfg: cfg,
    saveCfg: saveCfg,
    resetCfg: resetCfg,
    effW: effW,
    effBand: effBand,
    rankByTier: rankByTier,
    tokensOf: tokensOf,
    summaryOf: summaryOf,
    AUD: AUD, FPS: FPS, RATE: RATE,
    factors: function () { return factors(cfg().prof); },
    profileLabel: profileLabel,
    showDiag: showDiag,
    diagText: diagText,
    CONF: CONF,
    W: W,
    BAND: BAND,
    DEV: DEV,
    _internals: {
      candidates: candidates, nameOf: nameOf, magnetOf: magnetOf, summaryOf: summaryOf,
      tokensOf: tokensOf,
      readyState: readyState, describe: describe, wantHere: wantHere, loadDir: loadDir,
      renderSettings: renderSettings, normalizeCookie: normalizeCookie, saveCookie: saveCookie,
      sanitizeCfg: sanitizeCfg, cfgDefaults: cfgDefaults, sizeFactor: sizeFactor,
      state: state, setTab: function (t) { state.tab = t; },
      pill: function () { return pill; }, card: function () { return cardHost; }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
