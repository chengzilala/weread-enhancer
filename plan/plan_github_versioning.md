# 代码管理方案与执行计划（GitHub）

## 版本信息
- 仓库名称：weread-enhancer
- 可见性：private
- 本地目录：/Users/Admin/Knowledge/Coding/微信读书插件
- 当前归档版本：v0.25.0（2026-10-07；一个提交归档 v0.24.0 之后累积：扩展找书搜索修复 + 数据备份模块 `backup.*`，另含 H5 移动端阶段 0/1 与小程序 M15）

## 归档历史（Git Tags）

> 数据来源：`git for-each-ref refs/tags` + `git log`（日期为 Tag 创建日期）；各版本功能详情见 `version_plan.md` 第 2 节。

| 版本 Tag | Commit | 日期 | 说明 |
|---------|--------|------|------|
| v0.1.0 | da8b001 | 2026-06-25 | 项目骨架 + 基础屏占比 + 日志系统 |
| v0.2.0 | f7d04cd | 2026-06-25 | Edge 商店上架版 + 工具栏浮动悬停 |
| v0.3.0 | d5b53c8 | 2026-06-26 | 阅读设置 + 工具栏浮动稳定版归档 |
| v0.3.1 | 4efe6dc | 2026-06-26 | 明亮/暗黑主题切换补丁 |
| v0.3.2 | daa8eb4 | 2026-06-26 | 暗黑/护眼主题 CSS 改进补丁 |
| v0.4.0 | 62e38a7 | 2026-07-03 | 主题设置完成（CSS filter 方案 + 使用官方主题） |
| v0.5.0 | 73716ed | 2026-07-03 | 自动阅读完成（滚动/速度/方向/空格快捷键/持久化） |
| v0.6.0 | 519beb0 | 2026-07-03 | 快捷键系统 + 全屏模式完成 |
| v0.7.0 | e571061 | 2026-07-07 | 新手引导 + 性能优化 + Bug 修复 + 测试清单 |
| v0.8.1 | aecf919 | 2026-07-07 | 追平 v0.8.0 上架 + 滚动模式与工具栏体验优化 |
| v0.9.0 | 979ef20 | 2026-09-29 | 阅读统计模块（最小可用，功能主体见 `c5fc6e6`）+ HTML/PDF 导出 |
| v0.11.0 | fadb96b | 2026-09-29 | 一个提交内含三个版本：stats v0.9.1（进度追踪 + 最近书目）、notes v0.10.0（笔记增强）、official v0.11.0（官方数据阅读行为报告）；manifest 版本落到 `0.11.0` |
| v0.14.1 | 1687175 | 2026-10-01 | 一个提交归档 v0.12.0~v0.14.1 累积改动：笔记增强修补（Key 必选/搜索/复制/HTML·PDF 导出）、官方数据报告 V2（书架/笔记/阅读人格画像）、DeepSeek AI 执行摘要（可选）、移除「点击笔记跳转定位原文」；manifest 版本落到 `0.14.1` |
| v0.15.0 | e77beb4 | 2026-10-03 | 一个提交归档 v0.14.2~v0.15.0 累积改动：**移除「主题设置」**（官方已自带、属多余功能；同步清理网站教程 / 商店文案 / 测试清单 / 规划文档）、集中 API Key 入口、AI 人格化执行摘要与阅读人格画像、报告对象昵称与累计口径、帮助中心（`modules/help.*`）、支持与反馈中心（`modules/support-center.*`，合并打赏/反馈/公众号）；manifest 版本落到 `0.15.0` |
| v0.15.1 | 68358c9 | 2026-10-04 | 维护性更新，功能与 v0.15.0 一致；新增 `pack.py` 一键打包脚本（按 manifest 引用自动收集，避免漏打） |
| v0.15.2 | 8a3a59d | 2026-10-04 | 官方数据报告新增四类原生 Canvas 图表（折线 / 条形 / 热力格 / 环形），面板与导出自包含 HTML 共用同一套绘制 |
| v0.19.0 | 4db4f6f | 2026-10-05 | 一个提交归档 v0.16.0~v0.19.0 扩展累积：官方数据报告 V2 下半（阅读规律与建议 / 笔记密度）、新增「书架」「发现」页签、阅读人格（读书人版，含 16 型人物线描插画与可选 AI 润色，入口更名「🪞 阅读洞察」）；同时新增微信小程序移动端 `mobile/`（首页 / 人格 / 报告 / 书架 / 我的 + `wereadProxy` 云函数）与官网「阅读人格」栏目（`/persona/*`）/ 界面图库；manifest 版本落到 `0.19.0` |
| v0.20.0 | 30d71e6 | 2026-10-05 | 扩展中英双语（`_locales/`，v0.19.1）+ **本地找书**（`modules/finder.*` + `pinyin-data.js`：本地标签层 + 多维度搜书）；另含小程序书架/人格/设置/笔记等更新与官网/素材重生成；manifest 版本落到 `0.20.0`（提交信息记为「归档 v0.19.1」） |
| v0.20.1 | 5cde1eb | 2026-10-06 | 找书「正文检索一键化」修复 + 小程序 M11 每日卡片（`shared/daily-*` + `pages/daily`）+ 官网内容同步；manifest 落到 `0.20.1` |
| v0.24.0 | f2ff890 | 2026-10-06 | 一个提交归档 v0.20.1 之后累积：扩展**语音复习**（`modules/tts.js`，v0.24.0）+ **匿名使用统计**（`modules/telemetry.js`，v0.23.0）+ 小程序 M11~M15（含灵感漫游 M12 / 运营看板 M13 / 合规去 AI M15）+ **H5 移动端**（`h5/`）；红线改为「除匿名使用统计外零上传」；manifest 落到 `0.24.0` |
| v0.25.0 | 6f18282 | 2026-10-07 | 一个提交归档 v0.24.0 之后累积：扩展**找书修复**（「搜索框必须点清空才能再搜」+ 计数口径厘清：命中 X 本 · 共 Y 本 / 筛选结果 N 本）+ **数据备份**（`modules/backup.js` + `backup.css`，本地设置导出/导入）；另含 **H5 移动端阶段 0/1**（外壳 + 首页/人格/报告/书架/笔记/我的 + 云函数 relay/key/sync 动作）与小程序 M15；manifest 落到 `0.25.0` |

**未打 Tag 的版本**：
- v0.8.0（无独立提交）：商店追平版，改动未单独提交，已并入 v0.8.1 提交 `aecf919`；因无独立 commit，不单独补 tag。
- v0.8.2（提交 `6c064b0`，2026-09-27）：代码清理 + 中文输入法修复，已作为 Edge 更新 + 360 首次上架的上传版本；未单独打 tag。
- v0.8.3（无独立提交，2026-09-29）：感应区零遮挡 + 悬浮球悬停展开，改动已并入 v0.9.0 提交（`c5fc6e6` / `979ef20`）；因无独立 commit，不单独补 tag。
- v0.9.1 / v0.10.0（无独立提交，2026-09-29）：阅读统计补齐、笔记增强，改动已并入 v0.11.0 提交 `fadb96b`；因无独立 commit，不单独补 tag（其中 notes / official 两项截至归档时仍标「待实测」）。
- v0.12.0 / v0.12.1 / v0.12.2 / v0.12.3 / v0.12.4 / v0.13.0 / v0.13.1 / v0.13.2 / v0.14.0（无独立提交，2026-09-29~10-01）：笔记增强修补、官方数据报告 V2、DeepSeek 执行摘要、移除跳原文，改动已并入 v0.14.1 提交 `1687175`；因无独立 commit，不单独补 tag。
- v0.14.2 / v0.14.3 / v0.14.4 / v0.14.5 / v0.14.6 / v0.14.7（无独立提交，2026-10-01~10-03）：集中 API Key 入口、AI 人性化人格分析、支持与反馈合并入口、报告对象昵称与累计口径，改动已并入 v0.15.0 提交 `e77beb4`；因无独立 commit，不单独补 tag。
- v0.16.0（提交 `f63275a`，2026-10-04）：官方数据报告 V2 下半（规律建议 + 笔记密度），另新增展示图自动截图工具；未单独打 tag。
- v0.17.0 / v0.18.0（无独立提交，2026-10-04）：新增「书架」「发现」页签、阅读人格（读书人版）+ 手动触发，改动并入 v0.19.0 提交 `4db4f6f`；因无独立 commit，不单独补 tag。
- v0.19.1（无独立提交，2026-10-05）：扩展中英双语（`_locales/`），与 v0.20.0「本地找书」并入同一提交 `30d71e6`；因无独立 commit，不单独补 tag（另有留档包 `release/weread-enhancer-v0.19.1.zip`）。
- v0.23.0（无独立提交，2026-10-06）：匿名使用统计 `modules/telemetry.js`（默认开启、可一键关闭），与 v0.24.0「语音复习」并入同一提交 `f2ff890`；因无独立 commit，不单独补 tag（`0.21.0` / `0.22.0` 为「评论侧栏」「多模型」规划保留号，无代码）。

> ⚠️ **维护约定**：每次 `git tag v0.x.y` 发版后，**必须回来更新本表**（新增一行：Tag / Commit / 日期 / 说明），并更新顶部「当前归档版本」，保持归档历史与实际 tag 同步。

> 备注：v0.4.0 / v0.6.0 的 tag 指向打 tag 时的 HEAD（`62e38a7` / `519beb0`），与对应功能提交（`8022dfd` / `80536b1`）属同一版本迭代内的不同提交点。

## 目标
- 将当前稳定状态归档为可回滚的版本 `v0.1.0`
- 同步到 GitHub 私有仓库，建立后续迭代的版本管理流程

## 版本号规则
- v0.1.0：当前稳定点（MVP 第一版）
- v0.1.1：仅修复/小改动（不改变核心行为）
- v0.2.0：新增一个核心模块（例如自动阅读/主题/快捷键）
- v1.0.0：核心模块齐备、体验稳定、可发布

## 分支策略（最小化）
- main：稳定分支，只接受已验收的功能
- feature/*：功能分支（例如 feature/auto-read）
- dev：默认不启用；当需要并行多个功能且需要集成验证时再引入

## 提交规范（建议）
- feat: 新功能
- fix: 修复
- refactor: 重构
- docs: 文档
- chore: 杂项

## 入库/排除规则
### 应提交
- manifest.json
- content.js
- content.css
- README.md / Running.md
- session_log.md
- RPD_需求文档.md（如果希望需求-实现同库追溯）
- promo.py + screenshots/promo/（仓库首页 Banner 与功能卡片，README 按相对路径引用，必须入库）
- screenshots/store/（Edge/Chrome 商店上传素材，与展示图同源；360 素材在 release/360-素材/）

### 不提交（运行产物）
- 下载或导出的调试日志：weread-debug-*.json
- 日志目录（如果用作运行时输出目录）

## 执行计划（不执行，仅作为操作清单）
### 0. 预检
- 确认项目中不包含任何敏感信息（账号、Cookie、Token、个人隐私）
- 确认 `日志` 文件夹与 `weread-debug-*.json` 不进入版本控制

### 1. 初始化 git（本地）
在终端按顺序执行（macOS 用 `cd`，Windows 用 `Set-Location`；命令间用换行分隔，不用 `&&`）：

```powershell
cd "/Users/Admin/Knowledge/Coding/微信读书插件"
git init
git branch -M main
```

### 2. 添加 .gitignore（最小集合）
建议内容（后续执行时落到文件）：

```gitignore
# runtime logs
weread-debug-*.json
日志/

# OS
.DS_Store
Thumbs.db
```

### 3. 首次提交（main）

```powershell
cd "/Users/Admin/Knowledge/Coding/微信读书插件"
git add -A
git commit -m "chore: baseline v0.1.0"
```

### 4. 创建 GitHub 私有仓库（手动）
- GitHub 新建仓库：weread-enhancer
- 选择 Private
- 不要勾选 “Initialize this repository with a README”（本地已有）

创建完成后复制仓库地址（HTTPS），形如：
- https://github.com/<your-username-or-org>/weread-enhancer.git

### 5. 绑定远端并推送

```powershell
cd "/Users/Admin/Knowledge/Coding/微信读书插件"
git remote add origin "<YOUR_REMOTE_URL>"
git push -u origin main
```

### 6. 打 Tag 并发布 v0.1.0
本地打 tag 并推送：

```powershell
cd "/Users/Admin/Knowledge/Coding/微信读书插件"
git tag v0.1.0
git push origin v0.1.0
```

GitHub Release（网页操作）建议：
- Tag：v0.1.0
- 标题：v0.1.0
- 内容：说明已包含屏占比 + 日志系统（最小可用闭环）
- 附件：打一个可安装 zip（仅包含插件运行所需文件，不包含调试日志）
- 正文可内嵌展示图（用 raw 链接，把 `<tag>` 换成版本号）：
  `https://raw.githubusercontent.com/chengzilala/weread-enhancer/<tag>/screenshots/promo/github-banner.png`

### 7. 后续迭代工作流（模板）
- 新功能：
  - `git checkout -b feature/<name>`
  - 小步提交
  - 验收后合并到 main
- 发版：
  - `git tag v0.x.y`
  - GitHub Release + zip

