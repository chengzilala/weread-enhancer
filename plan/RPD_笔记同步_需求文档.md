# RPD 需求文档 · 笔记同步到 Obsidian

> 立项：2026-10-16 ｜ 版本目标：`0.29.1 → 0.30.0`
> 前置分析：[可行性分析_笔记同步.md](file:///Users/Admin/Knowledge/Coding/微信读书插件/plan/可行性分析_笔记同步.md)（已拍板：只做 Obsidian、先做「下载 Markdown」、内容含划线/想法/AI 摘要/书评/热门划线/阅读人格）

---

## 1. 项目概述

| 项 | 内容 |
|---|---|
| **定位** | 把微信悦读已抓到的读书数据，**一键落进本地 Obsidian vault**，变成可检索、可双链的 Markdown 知识资产 |
| **目标用户** | 用 Obsidian（或任意 Markdown 笔记软件）管理读书笔记的微信读书重度用户 |
| **当前状态** | 数据层已就绪（`modules/notes.js` 已有划线/想法取数与归一化、已有下载能力）；**缺"写进笔记库"这一层** |
| **明确不做** | Notion / flomo / Readwise（只预留）；H5 / 小程序端同步（本地写盘依赖桌面浏览器） |

### 1.1 需求三要素（Skill 要求先固化）

- **用户目标**：不想再手动复制粘贴、逐条排版；希望微信读书的划线 / 想法 / 书评 / AI 解读，自动变成 Obsidian 里的 `.md`，并和已有笔记形成网络。
- **输入 → 输出**：输入＝扩展已抓到的 `highlights`（划线）+ `thoughts`（想法/批注）+（V2 起）书评 / 热门划线 / AI 摘要 / 阅读人格；输出＝**每本书一个 `.md` 文件**，落到用户指定目录（默认浏览器下载目录）。
- **成功标准**：见 §7。

---

## 2. 核心功能需求（总览）

| 模块 | 描述 | 优先级 |
|---|---|---|
| **A. 单本同步** | 「📝 笔记」面板一键导出**当前书**为 Obsidian 规格 Markdown（划线 + 想法，按章分组、稳定 block id、想法与划线配对） | **P0** |
| **B. 批量同步** | 「一键导出全部有笔记的书」：遍历书架逐本拉取，各生成一个 `.md`，带进度与「停止」 | **P0** |
| **C. 设置项** | 文件名格式、导出目录提示、是否含想法、是否含时间戳；连通/写入方式说明 | **P0** |
| **D. AI 摘要 / 复习卡** | 复用扩展 DeepSeek，生成全书摘要与复习卡，写进文件「📌 摘要」节 | P1 |
| **E. 阅读人格（读书人版）** | 导出 `阅读人格-YYYYMM.md`（复用 `official.js` 既有生成结果） | P1 |
| **F. 书评 / 热门划线** | 接入 `/review/list`（公开书评）与 `/book/bestbookmarks`（热门划线），作独立小节 | P1 |
| **G. 书目索引** | 生成 `_索引.md`（按年份/分类列书目 + wikilink） | P1 |
| **H. 直写 Obsidian** | 走 Obsidian Local REST API 直写（免手动搬运） | P1（后置） |
| **I. 灵感漫游 / 每日卡片** | 数据在 H5 / 小程序端，扩展端取不到 → **另议** | P2 |

---

## 3. 详细功能需求

### 3.1 A. 单本同步（P0）

- **入口**：「📝 笔记」面板工具栏新增按钮 **「🔗 同步到 Obsidian」**（放在「复制笔记」之后）。
- **交互**：点击 → 用**当前已加载数据**（含搜索态过滤后的数据）渲染为 Obsidian 规格 Markdown → 触发下载 → toast「已生成《书名》.md，放入你的 vault 即可」。
- **数据**：复用现有 `currentFilteredData()`（划线 / 想法 / 章节分组 / 来源）；不新增请求。
- **边界**：数据未就绪 → toast 提示，不产生空文件；`title` 缺失 → 用「未知书籍」。
- **假设**（可覆盖）：不额外请求 `/book/info`，frontmatter 只写 title / bookId / source / syncedAt / 计数。

### 3.2 B. 批量同步（P0）

- **入口**：「📝 笔记」面板工具栏按钮 **「📚 批量同步（全部有笔记的书）」**；或主菜单「🔗 同步到 Obsidian」独立面板。
- **流程**：读书架（复用后台网关）→ 过滤出**有笔记的书** → 逐本拉取划线 / 想法 → 逐本渲染并下载 → 显示「已同步 3/12」进度 → 可「停止」。
- **边界**：单本失败不阻塞其它（记录到日志）；同一本重复同步 = 整文件覆盖，不叠加；`/user/notebooks` 分页按官方 `count + lastSort` 游标翻页（沿用现有做法）。
- **假设**：MVP 采用「逐本下载」而非「打包 zip」（避免新增 `downloads` 权限与打包依赖）；下载同名重名由浏览器加 `(1)` 兜底。

### 3.3 文件规格 v1（P0，**核心交付物**）

```markdown
---
type: weread-highlights
title: 《置身事内》
wereadId: 33000xxxx
source: 微信读书官方网关
syncedAt: 2026-10-16 10:00
highlights: 24
thoughts: 5
tags: [读书笔记/微信读书]
---

# 《置身事内》读书笔记

> 本文件由「微信悦读」生成，重复同步会整篇覆盖；请勿直接编辑，批注请另建文件用块引用指向本文件。

## 第一章 地方政府的权力与事务

> 划线原文…… ^wr-bk-9f3a2c

💭 自己的想法正文（对应原文：……） ^wr-rv-7d1b0e
<small>2026-09-01 21:03</small>
```

- **frontmatter 必填**：`type`（固定 `weread-highlights`，供识别/检索）、`title`、`wereadId`、`source`、`syncedAt`、计数。
- **正文**：章节 `## H2`；划线用引用块；想法用 `💭` + 配对到其对应划线之后（用 `range` 配对，配不上的单列到章节末）；每条带稳定 block id。
- **block id 规则**：划线 `^wr-bk-<bookmarkId>`，想法 `^wr-rv-<reviewId>`；**无 id 时**（DOM 兜底来源）退化为 `^wr-h-<序号>` 并在文中标注来源不完整。
- **文件名**：`《书名》.md`（清洗非法字符 `/\\:*?"<>|`、去首尾空白、超长截断）。
- **假设**：目录结构不在扩展侧创建（`<a download>` 无法建目录），用户在下载目录 / vault 侧自行组织；设置项只提供"文件名规则"提示。

### 3.4 C. 设置项（P0）

在「📝 笔记」面板设置区（或同步面板内）新增：

| 项 | 值 | 默认 |
|---|---|---|
| 含想法/批注 | 开关 | 开 |
| 含时间戳 | 开关 | 开 |
| 文件名格式 | `《书名》` / 自定义前缀 | `《书名》.md` |
| 使用说明 | 静态文案：把浏览器下载目录指向 vault 子目录即等于"同步" | — |

- **存储**：`chrome.storage.local` 单键 `wreSyncNotes: { includeThoughts, includeTime, prefix }`；日志只记录开关值，不含正文。

### 3.5 D~H（P1，本轮不实现，留规划）

- **D. AI 摘要 / 复习卡**：复用 `background.js` 现有 `wre-ai-chat`（DeepSeek）；按需生成（点同步时若开启才生成），写入「📌 摘要」节；失败静默跳过、不影响文件主体。
- **E. 阅读人格**：复用 `official.js` 阶段十四结果；导出为 `阅读人格-YYYYMM.md`。
- **F. 书评 / 热门划线**：新接 `/review/list`、`/book/bestbookmarks`，作文件内独立小节（需在「文件规格 v2」扩字段）。
- **G. 书目索引**：`_索引.md`，按年份分组列 `[[《书名》]]` + 一句话。
- **H. 直写**：Obsidian Local REST API（HTTP 27123 + Bearer Key）；`manifest.json` 用 `optional_host_permissions` 运行时申请 `http://127.0.0.1/*`；后台 service worker 发 `PUT /vault/<path>`；提供「测试连接」。

---

## 4. UI · UX 需求

- **入口**：复用「📝 笔记」面板工具栏（不新增顶级菜单），批次按钮加**进度条 + 停止**。
- **文案**：中文人话；明示「数据在本机生成、不上传、不需要额外账号」；明示「把下载目录设为 vault 子目录 = 自动入库」。
- **视觉**：沿用 `wre-` 前缀与现有面板风格（新模块自带 `sync-notes.css`）。
- **反馈**：单本成功 toast；批量逐本进度；失败列在面板底部并可复制。
- **不打扰**：不弹无关确认框；批量前只提示"将导出 N 本书"。

---

## 5. 技术实现方案

- **技术栈**：沿用 MV3 + 原生 JS，零外部依赖。
- **新文件**：
  - `modules/sync-notes.js`：文件规格渲染（`buildObsidianMarkdown(model)`）、下载、批量调度（进度/停止）、设置读写。**不改既有导出逻辑**。
  - `modules/sync-notes.css`：面板/按钮样式。
  - `test/笔记同步测试清单.md`：验收清单。
- **旧代码只动一处**：`modules/notes.js` 的 `renderToolbar()` 增 1 个按钮 + 1 个点击事件（`document.dispatchEvent(new CustomEvent('wre-notes-sync-export', { detail: { data, mode } }))`），与既有 `wre-open-key-settings` 的同款解耦做法一致；**不重写 notes.js 任何既有逻辑**。
- **取数**：
  - 单本：直接用事件携带的已加载数据（零新请求）。
  - 批量：新模块调后台 `wre-official-call`（`/user/notebooks` 或 `/shelf/sync` 取书单 → 逐本 `/book/bookmarklist` + `/review/list/mine`），沿用现有归一化字段口径。
- **下载**：复用 `Blob + URL.createObjectURL + <a download>`（无需 `downloads` 权限）。
- **manifest 变更**：仅注册 `sync-notes.js` / `sync-notes.css`；**新增默认权限 0 个**（H 阶段才用 `optional_host_permissions`）。
- **隐私**：数据不外传；日志沿用统一 `log()`，仅记条数/来源/开关，不记正文与 Key。

---

## 6. 分阶段规划

### 阶段十五-1 MVP · 单本同步（P0）✅ 已完成（2026-10-16，v0.30.0）
- [x] `modules/sync-notes.js` 新建：`buildObsidianMarkdown(data)`（frontmatter + 章节 + 引用块 + 想法配对 + block id）+ 文件名清洗 + 下载
- [x] `modules/notes.js` 工具栏增「🔗 同步到 Obsidian」按钮 + `wre-notes-sync-export` 事件（仅动这一处）
- [x] `modules/sync-notes.css` + `manifest.json` 注册
- [x] 设置项（含想法 / 含时间）落 `chrome.storage.local` 键 `wreSyncNotes`
- [x] 日志接入统一 `log()`（前缀 `[sync-notes]`）

### 阶段十五-2 MVP · 批量同步（P0）
- [ ] 书架列表 → 过滤有笔记的书 → 逐本拉取（复用后台网关）
- [ ] 进度条 + 「停止」；单本失败不阻塞并汇总
- [ ] 面板入口与说明文案

### 阶段十五-3 内容增厚（P1）
- [ ] AI 摘要 / 复习卡写入「📌 摘要」节（可选开关，复用 DeepSeek）
- [ ] 阅读人格导出 `阅读人格-YYYYMM.md`
- [ ] 接入书评（`/review/list`）与热门划线（`/book/bestbookmarks`）为独立小节
- [ ] `_索引.md` 书目索引

### 阶段十五-4 直写 Obsidian（P1）
- [ ] Obsidian Local REST API 设置区 + 「测试连接」
- [ ] `optional_host_permissions` 运行时申请 `http://127.0.0.1/*`；后台 `PUT /vault/<path>`
- [ ] 覆盖式写入校验（识别 `type: weread-highlights` 才覆盖）

### 阶段十五-5 收尾
- [ ] README / `web/content/功能教程/笔记同步.md` / `release/privacy.md` 回灌
- [ ] `test/笔记同步测试清单.md`
- [ ] `manifest.json` 版本 `0.29.1 → 0.30.0`（**红线：版本号必须递增**）

---

## 7. 成功标准

1. 在阅读页打开「📝 笔记」→ 点「🔗 同步到 Obsidian」，得到 `《书名》.md`，含 frontmatter、按章分组、每条带 `^wr-bk-*` / `^wr-rv-*`，想法挂在其对应划线下方。
2. 批量：一次导出 N 本书，各得一个文件，进度可见、可停止、单本失败不阻塞。
3. 重复同步：同一本书文件名稳定、**整篇覆盖不叠加**，不产生重复条目。
4. 浏览器下载目录设为 vault 子目录时，Obsidian 侧**无需任何额外操作**即可看到文件。
5. 全程本地：Network 面板无第三方请求；日志不含正文与 Key。
6. 版本号递增；文档三处回灌。

---

## 8. 风险与应对

| 风险 | 应对 |
|---|---|
| `<a download>` 无法创建目录结构 | MVP 只生成单文件，靠用户把下载目录设为 vault 子目录；目录组织留到 H 阶段（直写） |
| 批量下载被浏览器合并/拦截（同名加 `(1)`、多文件下载需授权） | 文件名稳定（同书同名 → 二次同步浏览器给 `(1)`，提示用户覆盖旧文件）；批量前提示"浏览器可能询问是否允许多文件下载" |
| 用户直接在同步文件里编辑被覆盖 | 文件头醒目提示 + frontmatter `type` 标记；推荐块引用另存批注 |
| 无 id 的兜底数据（DOM 抓取）block id 不稳定 | 退化为序号 id 并标注"本次数据不完整" |
| AI 摘要消耗 token | 默认关闭、按需生成、失败静默跳过、沿用现有 Key 与隐私声明 |
| V2 新接口（`/review/list`、`/book/bestbookmarks`）字段变更 | 复用现有"官方优先 + 三级兜底 + 来源标注"；文件保留 `source` 字段 |
| 新权限引发商店/用户疑虑 | MVP **零新增默认权限**；直写阶段走 `optional_host_permissions` 运行时申请，并同步 `privacy.md` 与商店文案 |

---

## 9. 已确认决策（2026-10-16）

- 文件命名：**`《书名》.md`**（非法字符清洗、超长截断；同名由浏览器 `(1)` 兜底）。
- 默认内容：**划线 + 想法全含**，并提供 **「包含想法/批注」「包含时间戳」两个开关**（`chrome.storage.local` 键 `wreSyncNotes`）。
- 开发顺序：**先做单本 MVP**（阶段十五-1，已完成），批量同步下一步（阶段十五-2）。

**下一步**：阶段十五-2 批量同步（书架 → 过滤有笔记的书 → 逐本拉取并下载，带进度/停止）。
