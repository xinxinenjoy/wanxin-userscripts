<div align="center">

# 🧰 WanXin Userscripts

**个人维护的 Tampermonkey 用户脚本集合**

🌐 **脚本主页：[https://scripts.wanxinxin.dpdns.org](https://scripts.wanxinxin.dpdns.org)**

GitHub 作为唯一开发源，Cloudflare Pages 提供展示、安装与自动更新。

当前正式发布 **13** 个脚本 · 最近修改 **2026-09-13 03:26**

</div>

---

## 🚀 快速开始

### 1. 安装 Tampermonkey

| 浏览器 | 安装入口 |
|---|---|
| Chrome | [Crx搜搜 · Chrome版](https://www.crxsoso.com/webstore/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Edge | [Crx搜搜 · Edge版](https://www.crxsoso.com/addon/detail/iikmkjmpaadaobahmlepeloendndfphd) |
| Firefox | [Crx搜搜 · Firefox版](https://www.crxsoso.com/firefox/detail/tampermonkey) |
| 扩展聚合站 | [Crx搜搜](https://www.crxsoso.com/) |

### 2. 安装脚本

推荐进入上方 **脚本主页**，找到需要的脚本后点击 **立即安装**。

> 安装和自动更新统一使用 `https://scripts.wanxinxin.dpdns.org`，GitHub Raw 仅作为备用。

### 3. 检查更新

打开 **Tampermonkey → 管理面板 → 检查用户脚本更新**。

脚本通过元数据中的 `@version` 判断新版，并通过固定的 `@updateURL` / `@downloadURL` 自动更新。

---

## 📦 脚本列表

### 1.Game · 2 个

| 脚本 | 版本 | 修改时间 | 功能说明 | 安装 |
|---|---:|---|---|---|
| **CurseForge增强** | `4.2` | 2026-09-03 12:06 | 增强CurseForge网站的中文显示，翻译部分英文为中文，支持动态加载内容的翻译。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-curseforge.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/hljdyxjb/game-curseforge.user.js) |
| **GOW底下尖塔** | `4.2.29` | 2026-09-10 20:07 | GOW底下尖塔火把管理与节点同步工具 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/hljdyxjb/game-gowdxjt.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/hljdyxjb/game-gowdxjt.user.js) |

### 2.Work · 11 个

| 脚本 | 版本 | 修改时间 | 功能说明 | 安装 |
|---|---:|---|---|---|
| **前台-1.1批量预约工具** | `1.17` | 2026-09-13 01:59 | 前台批量预约工具：在前台批量登记页面增加工具窗口，自动识别粘贴的14位预约单号并自动进行登记填写。同时在“已到检”页签中自动勾选“仅当日”，并在请求层强制将首次列表查询改为仅当日。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/qiantai/qiantai-piliangyuyue.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/qiantai/qiantai-piliangyuyue.user.js) |
| **发票-1.1全局页面** | `6.14` | 2026-09-03 15:01 | 发票全局页面：优化SOA发票页面的表格布局，全局指的是通过左上角订单中心-订单开票进入的开票页面，需要自行手动维护对应的单位名称才可以正常显示。请在代码内搜索“文案替换表”自行配置。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-quanju.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/fapiao/fapiao-quanju.user.js) |
| **发票-1.2订单页面** | `1.6` | 2026-09-03 15:01 | 发票订单页面：优化SOA发票页面的表格布局，此脚本处理的是通过某个订单进入的开票页面。与全局开票脚本互不影响。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/fapiao/fapiao-dingdan.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/fapiao/fapiao-dingdan.user.js) |
| **扁鹊-1.1首页模块排序** | `4.7` | 2026-09-05 15:47 | SOA首页模块排序：支持网页原始顺序/脚本排序两种图标方案，并支持拖拽保存、列数、模块宽度及列间距设置。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-shouye.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-shouye.user.js) |
| **扁鹊-1.2订单智能审批** | `2.7` | 2026-09-13 03:26 | SOA订单智能审批：自动推进审批流程，合同阶段会自动导入提前选择好的文件。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdanauto.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-dingdanauto.user.js) |
| **扁鹊-1.3体检数据查询** | `1.7.6` | 2026-09-13 01:59 | SOA体检数据：自动读取落单数据、体检汇总及三类卡数量，并支持按制卡批次查询卡备注。注意：卡类查询需要账号对应权限 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-dingdandata.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-dingdandata.user.js) |
| **扁鹊-1.4对账报表导出** | `1.9` | 2026-09-08 23:30 | SOA对账报表：支持自定义日期区间，突破3年的时间段限制，自动分段查询、导出。并自动对比报表与订单内的数据差异。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-duizhangbaobiao.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-duizhangbaobiao.user.js) |
| **扁鹊-1.5业绩报表辅助** | `1.1.4` | 2026-09-13 01:59 | SOA报表辅助工具：一次性查询、导出多个表格，用于处理业绩、个检、加项。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-baobiaodaochu.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-baobiaodaochu.user.js) |
| **扁鹊-1.6制卡管理查询** | `0.3.1` | 2026-09-13 01:59 | 查询并汇总本年度的邀约、贵宾、核磁、CT等制卡记录，按部门/人员统计办卡进度。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/bianque/soa-zhikaguanli.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/bianque/soa-zhikaguanli.user.js) |
| **蝶美-1.1单位信息填充** | `7.8.4` | 2026-09-13 01:59 | 蝶美自动填充单位信息：按输入字段自适应填写，支持重复运行跳过、缺失字段跳过、行业/经济末级匹配、地区、单位类型、社会信用代码、企业规模及人数等字段。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/diemei/diemei-danweixinxi.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/diemei/diemei-danweixinxi.user.js) |
| **蝶美-1.2套餐危害核对** | `4.2.17` | 2026-09-13 01:59 | 蝶美套餐危害核对：提供自动化核对、批量处理、自动选择等功能。注意：套餐名称的标准格式应为：XX-危害1+危害2+危害3+岗中+男，不保证能识别其他格式。 | [⚡ 推荐安装](https://scripts.wanxinxin.dpdns.org/diemei/diemei-weihaihedui.user.js) · [GitHub 备用](https://raw.githubusercontent.com/xinxinenjoy/wanxin-userscripts/main/publish/diemei/diemei-weihaihedui.user.js) |

---

## 🧩 Tampermonkey 使用说明

<details>
<summary><strong>如何安装脚本</strong></summary>

1. 安装 Tampermonkey。
2. 打开脚本主页。
3. 点击对应脚本的 **立即安装**。
4. 在 Tampermonkey 安装页面确认后点击 **安装**。

</details>

<details>
<summary><strong>如何手动检查更新</strong></summary>

打开 Tampermonkey 管理面板，点击 **检查用户脚本更新**。

Tampermonkey 会读取 `@updateURL`，比较远程与本地 `@version`；远程版本更高时，通过 `@downloadURL` 获取新版。

</details>

<details>
<summary><strong>新版刚发布但暂时没有检测到</strong></summary>

请先等待 GitHub Actions 与 Cloudflare Pages 部署完成，再重新检查。

如果需要立即更新，也可以重新点击脚本主页中的 **立即安装** 覆盖更新。

</details>

---

## 🔄 发布架构

```text
本地修改
   ↓
GitHub main
   ↓
Build Userscripts
   ↓
publish/
   ↓
Update Userscripts README
   ├─ README.md
   └─ publish/index.html
          ↓
Cloudflare Pages
   ├─ 展示主页
   ├─ 脚本安装
   └─ Tampermonkey 自动更新

同时：README + publish/ → GitCode 备用镜像
```

---

<div align="center">

README 与脚本主页由 GitHub Actions 自动维护。

</div>
