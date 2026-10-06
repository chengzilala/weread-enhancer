# 微软 Edge 插件商店上架方案

**版本：v1.0 | 日期：2026-06-25**

---

## 一、背景与目标

当前插件已完成核心功能（屏占比调节 + 工具栏浮动悬停），达到基础可用状态。目标是将插件发布到 **Microsoft Edge 加载项商店**，供用户一键安装，提升分发效率和可信度。

---

## 二、上架前置准备清单

### 2.1 技术准备

| 项目 | 当前状态 | 需要做 | 优先级 |
|------|---------|--------|--------|
| manifest.json 版本号 | `1.0.0` | 调整为 `0.2.0`（与 Git tag 对齐），首次上架不强求 1.0 | P0 |
| 插件图标 | 无 | 制作 3 个尺寸：16x16 / 48x48 / 128x128 | P0 |
| 商店展示图 | ✅ 已就绪（`screenshots/store/`） | 直接上传，见步骤 4 | P1 |
| 隐私政策 | 无 | 撰写简单隐私声明（说明不收集用户数据） | P0 |
| 代码检查 | 有 debug.log 等调试产物 | 打包前清理，只保留必要文件 | P1 |

### 2.2 账户准备

| 项目 | 说明 |
|------|------|
| 注册 Edge Partner Center | 需要 Microsoft 账户，免费注册（个人开发者） |
| 地址 | https://partner.microsoft.com/dashboard |
| 费用 | 个人开发者免费；公司账户需 $19 一次性费用 |

---

## 三、执行步骤

### 步骤 1：生成插件图标（3 个尺寸）

```
icons/
  icon-16.png   → 16x16   （浏览器工具栏小图标）
  icon-48.png   → 48x48   （扩展管理页图标）
  icon-128.png  → 128x128 （商店展示 + 安装提示图标）
```

**方案**：用 SVG 模板生成 → 用在线工具批量导出 PNG（如 iloveimg.com 或 sharp/nsharp 脚本）。临时方案：先用纯色 + 文字占位，后续替换为正式设计。

manifest.json 添加：
```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

### 步骤 2：撰写隐私政策

Edge 商店要求提供隐私政策链接。创建一个简单的策略页面，说明插件的隐私实践。

**关键声明要点**：
- 插件 **不收集、不存储、不上传** 任何用户数据
- 所有设置保存在用户浏览器本地存储（`chrome.storage.local`），仅用户本人可访问
- 不包含分析、跟踪、广告代码
- 仅在 `weread.qq.com` 域名下运行

**存放方式**：已创建 `release/privacy.md`，对应 GitHub URL：

### 步骤 3：准备商店 Listing（中英文）

| 字段             | 内容                                                                            |
| -------------- | ----------------------------------------------------------------------------- |
| **名称**         | 微信悦读                                                                    |
| **简短描述（≤80字）** | 增强微信读书网页版：屏占比、自动阅读、快捷键、勿扰与全屏、阅读统计、笔记聚合导出、官方阅读数据报告与帮助中心 |
| **详细描述**       | 见下方"详细描述文案"                                                                   |
| **支持语言**       | 中文（简体）                                                                        |
| **分类**         | 生产力 / 辅助功能                                                                    |
| **隐私政策 URL**   | `https://github.com/chengzilala/weread-enhancer/blob/main/release/privacy.md` |
| **网站 URL**     | `https://wereadapp-32km31c.maozi.io`                                          |
| **支持邮箱**       | 2195542745@qq.com                                                             |

**详细描述文案（中文）**：

> 微信悦读是专为微信读书网页版（weread.qq.com）打造的阅读增强工具，帮助你打造更舒适、专注的网页阅读体验。
>
> **核心功能**：
> - **屏占比调节**：50%-100% 自由调整阅读区域宽度，滑块 + 快捷比例按钮，设置自动保存
> - **自动阅读**：速度、方向可调，空格键一键开始/暂停
> - **快捷键操作**：空格（自动阅读）、D（勿扰）、F（全屏）、?（帮助面板）
> - **勿扰模式 / 全屏模式**：一键进入沉浸阅读，退出自动恢复
> - **工具栏浮动**：屏占比过高或滚动模式下原生工具栏自动隐藏，鼠标移到感应区淡入显示，点击正常
> - **滚动模式适配**：滚动阅读模式下屏占比自适应，配自绘悬浮滚动条，滚动更顺滑
> - **阅读统计与导出**：统计前台阅读时长（今日 / 本周 / 本月 / 本书），显示当前书籍进度与最近书目，一键导出 HTML / PDF / Markdown / CSV / JSON
> - **笔记增强**：一键聚合本书全部划线与想法/批注（按章节分组、可搜索），支持干净复制与 Markdown / 纯文本 / HTML / PDF 导出（需在插件内配置自己的微信读书 API Key）
> - **阅读洞察（阅读行为报告）**：用你自己的 API Key 拉取官方阅读数据，在本机生成「阅读行为报告」（数据全景 / 阅读轨迹 / 时段分布 / 偏好画像 / 成就勋章 / 笔记行为 / 完读率等）；首屏另有 **「🧬 我的阅读人格」**——本机算出人格代码 + 称号 + 词语分析，并可生成手机版分享图（16 型各配自绘线描插画，随插件内置、运行时不联网）；含 **「📚 书架」「🔍 发现」** 页签（搜书 / 推荐 / 书评 / 相似书 / 书籍详情）；支持本周 / 本月 / 本年 / 累计切换与导出；可选接入 DeepSeek Key 生成 AI 解读
> - **帮助中心与支持反馈**：一键跳转配套教程网站，内置反馈与打赏入口
>
> **贴心之处**：
> - 所有设置自动保存，刷新页面无需重新调节
> - 首次安装/更新弹出新手引导
> - 隐私优先：零依赖、不收集任何用户数据，仅在 weread.qq.com 下运行

**英文描述（Store Listing English）**：

> ⚠️ 更正：旧 listing 里的「主题切换 / T（主题）」为**过时内容**（主题功能已整体取消），务必用下面这版，避免审核判为"描述与功能不符"。

> WeRead Enhancer is a reading enhancement tool for the WeRead web reader (weread.qq.com) that helps you build a more comfortable and focused web reading experience. It runs only on weread.qq.com — zero dependencies, no analytics, no data collection.
>
> **Key features**:
> - **Screen ratio**: freely adjust the reading width from 50% to 100% with a slider and preset buttons; saved automatically.
> - **Floating toolbar**: when the ratio is high or in scroll mode, the native toolbar auto-hides and fades in on hover of the top/right hot zones; clicks work in both paging and scroll modes.
> - **Scroll-mode tuning**: adaptive, centered reading width without overflow, plus a custom floating scrollbar (fades in near the right edge, draggable to jump), remembered after refresh.
> - **Auto reading**: adjustable speed and direction, start/pause with the spacebar.
> - **Keyboard shortcuts**: Space (auto reading), D (do-not-disturb), F (full screen), ? (help panel).
> - **Do-not-disturb / Full screen**: immersive reading modes that restore your previous ratios and state on exit.
> - **Onboarding & settings memory**: a welcome guide on first install/update; all settings restore automatically after a page refresh.
> - **Reading stats & export**: track foreground reading time (today / this week / this month / this book), show current book progress and your 10 most recent books (clickable), and export to an HTML report / PDF / Markdown / CSV / JSON.
> - **Notes enhancement**: aggregate all highlights and thoughts/annotations of the current book by chapter, with a built-in search box; one-click clean copy (rich text + clean plain text without Markdown symbols) and export to Markdown / plain text / HTML / PDF; select text on the page for a "copy" bubble with official watermark cleanup. Reading your notes requires configuring your own WeRead API key.
> - **Reading Insights**: paste your own WeRead "wrk-" API key (in the same "API Key" entry as the optional DeepSeek key) to pull your own official reading data and generate an on-device reading behavior report — timeline, reading-hours distribution, preference profile, most-read books, achievements, note behavior, completion rate and more. The first screen also shows **My Reading Persona**: computed on your device into a readable code, with a main title, trait nicknames, evidence, and word analysis (top words / sentiment / catchphrases / themes / CSS word cloud), plus a shareable portrait image (16 personas, each with a self-drawn line-art illustration of a public-domain cultural figure; bundled with the extension, no network at runtime, no real photos). Switch week / month / year / all-time and export to Markdown / HTML / PDF. Includes **Bookshelf** and **Discover** tabs (book search with multiple scopes and paging, recommendations, public reviews with stars, similar books, and book details / table of contents). Fully on-device and reusable; an optional DeepSeek key upgrades the executive summary to AI-written text while all numbers stay computed locally.
> - **Diagnostics & help**: a built-in log system exportable to JSON; a Help Center with a silent new-version check (shows a red dot when an update is available).
>
> **Privacy**: runs only on weread.qq.com. Settings are saved locally (storage permission only). No data is collected, transmitted, or shared.

### 步骤 4：准备商店素材（已就绪，由 `promo.py` 生成）

改文案 / 换截图后，一条命令即可重新生成全部素材：

```bash
python3 promo.py
```

**上传对照表（一图一岗）**：

| 上传位置 | 文件 | 尺寸 | 画面内容 |
|---|---|---|---|
| 截图（1–10 张，必需） | `screenshots/store/store-01-1280x800.png` … `store-05-1280x800.png` | 1280×800 | 品牌蓝标题栏 + 界面：屏占比自由调节 / 沉浸式阅读 / 勿扰模式 / 快捷操作 / 诊断日志 |
| 小宣传磁贴（必需） | `screenshots/store/promo-440x280.png` | 440×280 | Logo + 名称 + 一句话定位 |
| 大宣传磁贴（可选，精选位用） | `screenshots/store/promo-1400x560.png` | 1400×560 | 左侧卖点清单 + 右侧双界面预览 |
| 商店图标 | `icons/icon-128.png` | 128×128 | 已有 |

> ℹ️ GitHub 仓库首页用的 Banner 与功能亮点卡片在 `screenshots/promo/`，**只用于 README 展示，不上传商店**。
> ⚠️ 360 商店要求的 560×350 效果图在 `release/360-素材/`，尺寸与 Edge/Chrome 不通用，勿混用。

### 步骤 5：打包 ZIP

```powershell
# 在项目目录执行（用 Python 生成，确保 zip 内为正斜杠路径）
python3 -c "import zipfile; files=['manifest.json','content.js','content.css','README.md','icons/icon-16.png','icons/icon-48.png','icons/icon-128.png']; z=zipfile.ZipFile('release/weread-enhancer-v0.8.2.zip','w',zipfile.ZIP_DEFLATED); [z.write(f,f) for f in files]; z.close()"
```

或手动创建 zip，包含：
```
weread-enhancer-v0.8.2.zip
├── manifest.json
├── content.js
├── content.css
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

> 注意：ZIP 中不要包含 `.gitignore`、`dev/`、`plan/`、`test/`、`usage/`、`screenshots/`、`inbox/`、`release/`、`.dbg/`、`debug-*.md` 等非运行文件。

### 步骤 6：提交审核

1. 登录 [Edge Partner Center](https://partner.microsoft.com/dashboard)
2. 点击 **"创建新的扩展"**
3. **上传包**：选择 `.zip` 文件
4. **填写商店列表**：粘贴准备好的中英文描述
5. **上传截图**：拖入 2-4 张截图
6. **填写隐私政策 URL**：粘贴 GitHub 链接
7. **填写说明备注**（审核人员看的）：简述插件功能和权限理由
   > 本插件仅在 weread.qq.com 下运行，使用 chrome.storage 权限仅用于保存用户设置到本地。
8. **提交审核**
9. 等待 1-3 个工作日

---

## 四、审核说明备注模板

提交时可粘贴以下内容到"给审核团队的备注"：

```
This extension injects a custom settings panel into the WeRead (weread.qq.com) web reader
to enhance the reading experience. It runs ONLY on weread.qq.com.

Features:
- Screen ratio: adjust the reading area width (50%-100%).
- Auto reading: adjustable scroll speed and direction, toggled with the spacebar.
- Keyboard shortcuts: Space (auto read), D (do-not-disturb), F (full screen), ? (help panel).
- Do-not-disturb and full-screen immersive modes.
- Floating toolbar and adaptive screen ratio in scroll mode, with a custom floating scrollbar.
- Reading statistics with local export (HTML / PDF / Markdown / CSV / JSON).
- Notes enhancement: aggregate the user's own highlights and thoughts, using the user's OWN
  WeRead API key (stored locally); it only reads the user's own book notes.
- Official reading report: fetch the user's OWN official data with their API key; optional
  DeepSeek summary using the user's OWN DeepSeek key.
- Help center and feedback entries.
- Onboarding guide shown on first install / update.

Permission justification
- "storage": used SOLELY to save user preferences (screen ratio, auto-read speed,
  do-not-disturb and full-screen state) to browser local storage (chrome.storage.local).
- Host permissions (i.weread.qq.com / api.deepseek.com / companion site): used ONLY when the
  user actively opens the notes / official-data panels, to fetch the user's OWN data with the
  user's OWN API key, or to silently check the companion site's version file. No data is ever
  collected, tracked, or transmitted to the developer.

No remote code, analytics, tracking, or ads are included.

How to test:
1. Install the extension.
2. Open any book page on https://weread.qq.com.
3. A control panel appears at the top-right corner; adjust the screen ratio, start auto
   reading, or press ? to open the help panel. (Notes / official-data features require the
   user's own WeRead API key.)

The extension is open source: https://github.com/chengzilala/weread-enhancer
```

---

## 五、常见拒绝原因与应对

| 拒绝原因 | 应对 |
|---------|------|
| 权限过大 | 当前只用 `storage`，权限最小，风险低 |
| 缺少隐私政策 | 步骤 2 中准备好 |
| 图标不清晰 | 步骤 1 中确保图标边缘清晰、尺寸准确 |
| 截图不完整 | 截图需清晰展示插件功能和使用场景 |
| 描述不准确 | 描述只写实际已实现的功能，不夸大 |

---

## 六、版本号策略（上架后）

| 分支 | 说明 |
|------|------|
| GitHub tag `v0.x.y` | 代码仓库的版本标记 |
| `manifest.json` 的 `version` | 商店包版本，提交时必须与上次不同（如 `0.2.0` → `0.2.1`） |

每次更新到商店都需要递增 `manifest.json` 的 `version` 字段，否则提交会被拒绝。

---

## 七、首次上架任务分配（已完成，历史留档）

| 序号 | 任务 | 执行方式 | 状态 |
|------|------|---------|------|
| 1 | 更新 manifest.json（版本号 + 图标引用） | 已完成 | ✅ |
| 2 | 生成 3 个图标 PNG | 已完成（`icons/`） | ✅ |
| 3 | 创建 icons/ 目录 | 已完成 | ✅ |
| 4 | 撰写 privacy.md | 已完成（`release/privacy.md`） | ✅ |
| 5 | 更新 README.md（补充实际功能说明） | 已完成 | ✅ |
| 6 | 准备中英文商店文案 | 已完成 | ✅ |
| 7 | 商店截图与宣传磁贴 | 已完成（`screenshots/store/`，由 `promo.py` 生成） | ✅ |
| 8 | 重新打包上架 zip | 已完成（现由 `pack.py` 一键打包） | ✅ |
| 9 | 注册 Partner Center + 上传提交 | 已完成（v0.8.2 已上架） | ✅ |

---

## 八、后续迭代（上架后）

- 首次审核通过后，发布到 Public 可见
- 后续功能更新 → 改版本号 → 重新打包 → Partner Center 更新提交
- 可同步上架到 **Chrome Web Store**（Chrome 用的是同一个 manifest.json，可复用）
- 积累用户评价后可申请"精选扩展"推荐位
- 增加主流浏览器的上架：360浏览器、Google Chrome 浏览器，为我同步一份相关文档。分别将相关资料做好归档记录

---

## 九、更新提交记录

### v0.8.2｜已完成
| 项 | 记录 |
|---|---|
| 提交版本 | **v0.8.2** |
| 提交日期 | 2026-09-27 |
| 提交包 | `release/weread-enhancer-v0.8.2.zip` |
| 上次商店版本 | v0.2.0（本次为追平更新） |
| 审核状态 | ✅ **已通过，已上架** |

### v0.15.0｜已完成
| 项 | 记录 |
|---|---|
| 提交版本 | **v0.15.0** |
| 提交包 | `release/weread-enhancer-v0.15.0.zip` |
| 上次商店版本 | v0.8.2 |
| 本次要点 | 追平功能：阅读统计与导出、笔记增强、官方数据阅读行为报告（含可选 DeepSeek AI 解读）、帮助中心、支持与反馈；**移除主题设置** |
| 审核状态 | ✅ **已上架** |

### v0.15.1｜本次
| 项 | 记录 |
|---|---|
| 提交版本 | **v0.15.1** |
| 提交日期 | 2026-10-04 |
| 提交包 | `release/weread-enhancer-v0.15.1.zip`（由 `pack.py` 自动打包，22 个运行文件） |
| 上次商店版本 | v0.15.0 |
| 本次要点 | 重新打包提交：排查商店版功能异常（本地版正常、商店版异常），用 `pack.py` 确保包内含 `background.js` / `modules/` / `assets/` 全部运行文件 |
| 审核状态 | ⏳ **待提交**（用户在 Partner Center 上传 zip 并提交后更新此状态） |

### ⏭️ 下一步（更新至最新版）
> 截至 2026-10-06，代码最新版为 **v0.20.1**（较商店已上架 v0.15.0 落后 5 个小版本）。建议直接用 `python3 pack.py` 生成最新包，在 Partner Center **一次性提交更新**（无需逐版追），本次要点：阅读人格（读书人版）/ 书架 / 发现页签、本地找书、中英双语。

---

## 十、Edge 后台「隐私」页填写文案（v0.19.0 · 可直接复制）

> 用途：Partner Center → 扩展 → **隐私**页，逐字复制下面各框内容即可。
> 事实依据（以代码为准）：`manifest.json` 权限仅 `storage`；主机权限 3 条——`https://i.weread.qq.com/*`、`https://api.deepseek.com/*`、`https://wereadapp-32km31c.maozi.io/*`；生效域名仅 `weread.qq.com`；全部 JS 随包分发、**无远程代码**。
> 每框限 1000 字符（英文按字符计，中文按字计，均远低于上限）。

### 10.1 单一用途描述（Single purpose）

**中文（推荐直接粘贴）**
```
微信悦读只有一个用途：增强微信读书网页版（weread.qq.com）的阅读体验。
它在该网站页面内注入自绘的控制面板与阅读辅助功能（屏占比调节、自动阅读、快捷键、勿扰/全屏、阅读统计、笔记聚合、阅读洞察）。
所有设置仅保存在浏览器本地。
仅当用户主动点击「笔记」「阅读洞察」时，才使用用户自己填写的微信读书 API Key 读取用户本人的笔记与官方阅读数据；AI 解读为可选，使用用户自己的 DeepSeek Key。
除此之外不运行、不收集、不追踪任何数据。
```

**English（备选）**
```
WeRead Enhancer has a single purpose: to enhance the reading experience on the WeRead web reader (weread.qq.com). It injects its own control panel and reading aids (screen ratio, auto reading, shortcuts, DND/full-screen, reading stats, notes aggregation, reading insights) into that site's pages only. All settings are stored locally in the browser. Only when the user actively opens Notes/Insights does it use the user's OWN WeRead API key to read the user's OWN notes and official reading data; the AI summary is optional and uses the user's OWN DeepSeek key. It does not run, collect, or track anything else.
```

### 10.2 权限理由 —— storage

**English（推荐直接粘贴）**
```
"storage" is used solely to save the user's own preferences and short-lived caches locally in the browser (chrome.storage.local): screen ratio, auto-read speed and direction, DND/full-screen state, onboarding status, and cached copies of the user's own notes/report. It is never used to collect, transmit, or share data. Nothing leaves the user's device because of this permission, and uninstalling the extension removes it.
```

**中文（备选）**
```
"storage" 仅用于把用户本人的偏好设置与短期缓存保存在浏览器本地（chrome.storage.local）：屏占比、自动阅读速度与方向、勿扰/全屏状态、新手引导状态，以及用户本人笔记/报告的缓存副本。该权限不用于收集、传输或共享任何数据，不会使任何数据离开用户设备；卸载扩展即被清除。
```

### 10.3 权限理由 —— 主机权限 https://i.weread.qq.com/*

**English（推荐直接粘贴）**
```
Used ONLY after the user enters their OWN WeRead API key and actively opens the Notes or Insights panel. The extension's service worker then sends the user's own key to the official WeRead gateway (POST https://i.weread.qq.com/api/agent/gateway) to read the user's OWN highlights, thoughts, shelf and reading data, which are displayed and exported locally. Requests are made only on user action; the data is never sent anywhere else.
```

**中文（备选）**
```
仅在用户填写自己的微信读书 API Key 并主动打开「笔记」或「阅读洞察」面板后使用。扩展的后台脚本会把用户自己的 Key 发往微信读书官方网关（POST https://i.weread.qq.com/api/agent/gateway），读取用户本人的划线、想法、书架与阅读数据，并在本地展示/导出。请求仅在用户操作时发起，数据不会发往其他任何地方。
```

### 10.4 权限理由 —— 主机权限 https://api.deepseek.com/*

**English（推荐直接粘贴）**
```
Optional. Used only when the user enters their OWN DeepSeek API key and clicks "generate AI interpretation". The service worker then calls https://api.deepseek.com to generate human-readable text; only a small sample of the user's own notes is sent for that single purpose. If the user has not added a key or does not click the button, no request is made.
```

**中文（备选）**
```
可选权限。仅在用户填写自己的 DeepSeek API Key 并点击「生成 AI 解读」时使用。后台脚本会调用 https://api.deepseek.com 生成可读文字，仅为此目的发送用户本人笔记的一小段样本。未填 Key 或未点击时，不会发起任何请求。
```

### 10.5 权限理由 —— 主机权限 https://wereadapp-32km31c.maozi.io/*

**English（推荐直接粘贴）**
```
Used only to (1) silently check the companion website's version file (GET /api/latest.json, result cached for 24 hours) so the extension can show a "new version available" hint, and (2) open the companion help/tutorial pages in a new tab when the user clicks the Help entry. No user data is sent in these requests.
```

**中文（备选）**
```
仅用于两件事：(1) 静默检查配套网站的版本文件（GET /api/latest.json，结果缓存 24 小时），以便在入口旁提示「有新版本」；(2) 当用户点击「帮助中心」时，在新标签页打开配套的帮助/教程页面。这些请求不发送任何用户数据。
```

### 10.6 主机权限理由（后台为「一个合并框」，实测确认）

> ⚠️ 实测：Edge 后台把 `permissions` + `content_scripts` 里所有匹配模式**合并成一条「主机权限理由」**（单框，限 1000 字符），**不是每条一个框**。此时把下面合并版整段粘进去即可（10.3–10.5 供逐条参考/备用）。

**中文（推荐直接粘贴）**
```
主机权限仅服务于扩展在微信读书（weread.qq.com）上的单一用途，且仅在用户主动操作时使用：
1) weread.qq.com（content_scripts）：在微信读书阅读页注入扩展自绘的控制面板与阅读辅助功能。
2) i.weread.qq.com：当用户填写自己的微信读书 API Key 并打开「笔记/阅读洞察」时，后台脚本调用官方网关（POST /api/agent/gateway）读取用户本人的划线、想法、书架与阅读数据，并在本地展示/导出。
3) api.deepseek.com：可选；仅在用户填写自己的 DeepSeek Key 并点击 AI 按钮时，用其本人笔记生成可读摘要。
4) wereadapp-32km31c.maozi.io：仅静默检查版本文件（GET /api/latest.json，缓存 24 小时）与在用户点击时打开配套帮助页。
不向开发者回传任何数据；无分析、无跟踪、无广告；无远程代码。
```

**English（备选）**
```
Host permissions serve only the extension's single purpose on WeRead (weread.qq.com), and only on user action:
1) weread.qq.com (content_scripts): inject the extension's own control panel and reading aids into the WeRead reader pages.
2) i.weread.qq.com: when the user enters their OWN WeRead API key and opens Notes/Insights, the service worker calls the official gateway (POST /api/agent/gateway) to read the user's OWN highlights, thoughts, shelf and reading data, shown/exported locally.
3) api.deepseek.com: optional; only when the user adds their OWN DeepSeek key and clicks the AI button, to generate a readable summary of their own notes.
4) wereadapp-32km31c.maozi.io: only a silent version check (GET /api/latest.json, cached 24h) and opening companion Help pages on user click.
No data is sent to the developer; no analytics, tracking, or ads; no remote code.
```

### 10.7 其他勾选项

| 问题 | 选择 |
|---|---|
| 是否使用远程代码（Remote code） | **否**（全部 JavaScript 随包分发，不在运行时下载/执行远程代码） |
| 是否收集或传输用户数据 | 设置仅存本地；仅当用户主动使用笔记/洞察时，用**用户自己的 Key** 读取**用户自己的数据**，不向开发者回传 |
| 是否包含分析/广告/跟踪 | **否** |

### 10.8 可直接粘贴的「给审核团队的备注」（简版）

```
WeRead Enhancer runs ONLY on weread.qq.com and injects a self-drawn control panel plus reading aids. Permissions are minimal:
- storage: saves the user's own preferences/caches locally (chrome.storage.local); no data leaves the device.
- i.weread.qq.com: used only when the user enters their OWN WeRead API key and opens Notes/Insights, to read the user's OWN data via the official gateway; requests are user-initiated only.
- api.deepseek.com: optional; used only when the user adds their OWN DeepSeek key and clicks the AI button.
- wereadapp-32km31c.maozi.io: only a silent version check (/api/latest.json) and opening Help pages on user click.
No remote code, analytics, tracking, or ads. All JavaScript ships inside the package.

How to test: install, open any book on https://weread.qq.com, then use the floating entry (bottom-right) or the panel (top-right) to adjust screen ratio / start auto reading / press "?" for the help panel. Notes and Insights require the user's own WeRead API key.
```
