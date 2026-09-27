# 会话交接：微信读书插件 — 浏览器商店上架

> **文档类型**：会话交接（可直接复制粘贴给新会话）
> **创建日期**：2026-07-07 ｜ **最近更新**：2026-07-07（本会话进展并入）
> **对应版本**：v0.8.1（已 git 提交 + tag + push）

---

## 最新进展（2026-07-07 本会话已完成）
- ✅ **Edge v0.8.1 安装包已打包**：`release/weread-enhancer-v0.8.1.zip`（含 manifest / content.js / content.css / README / 3 图标；zip 属 `.gitignore` 排除项，不入库）
- ✅ **Edge 文案已修正**（`plan_edge_store.md`）：删除错误快捷键 `T(主题)`，统一为 **空格/D/F/?**；补 v0.8.1 新功能（滚动模式适配 / 自绘滚动条）；打包命令版本号同步为 0.8.1
- ✅ **Chrome 归档文档已建** `plan_chrome_store.md`，但 **上架暂缓**（用户决定暂不付 $5 注册费）
- ✅ **360 归档文档已建并扩写为「新手完整版」** `plan_360_store.md`（从账号注册讲起，含 MV3 实测、crx 打包、ZIP 素材尺寸）
- ⏭️ **下一步重点**：Edge 提交更新（用户在 Partner Center 手动）；360 需先在 360 浏览器**实测 MV3 兼容性**
- ⏳ 以上文档改动 **尚未 git 提交**（等用户确认）

---

## 会话定位
- **性质**：**浏览器扩展商店上架**专项会话（打包 + 商店 Listing + 提交审核 + 归档），**不改功能代码**（除非上架审核要求的必要修正）。
- **任务范围（2026-07-07 更新优先级）**：
  1. ⭐ Edge 加载项商店：**更新提交 v0.8.1**（此前已上架过 v0.2.0）
  2. ⭐ 360 浏览器扩展：上架（文档见 `plan_360_store.md`）
  3. ⏸️ Chrome Web Store：**暂缓**（用户决定，因需一次性 $5 注册费；文档 `plan_chrome_store.md` 已就绪，待付费后再上）
  4. 每个商店**分别建文档归档**（已建：`plan_edge_store.md` / `plan_360_store.md` / `plan_chrome_store.md`）
- **不做**：新功能开发、v0.9.0 主线、横屏/双栏与全屏入主题（已搁置，见 `version_plan.md` 第 3 节）。

---

## 项目背景
- **项目**：微信悦读（Chrome/Edge 扩展，Manifest V3）
- **仓库**：`https://github.com/chengzilala/weread-enhancer`（private）
- **当前版本**：`manifest.json` = `v0.8.1`；已提交 `aecf919`/`a6a71b3`，tag `v0.8.1` 已推送
- **权限**：仅 `storage`（保存用户设置到本地）；仅在 `weread.qq.com` 运行；无远程代码/分析/广告
- **v0.8.1 相对 v0.2.0 新增能力**（上架文案需补充）：明亮/暗黑/护眼主题、自动阅读、快捷键、勿扰、全屏、新手引导、**滚动模式屏占比适配**、**滚动模式工具栏浮动**、**自绘悬浮滚动条**

---

## 上架现状（勿凭空假设，均已核实）
| 项 | 状态 |
|---|---|
| Edge Partner Center 账户 | 已注册；已提交过 v0.2.0（用户手动操作） |
| Chrome Web Store 账户 | ⏸️ 暂缓（用户决定暂不付 $5 注册费） |
| 360 账户 | ❓未注册（免注册费；详见 `plan_360_store.md`） |
| 图标 `icons/`（16/48/128） | ✅ 已备 |
| 隐私政策 `release/privacy.md` | ✅ 已备，URL：`https://github.com/chengzilala/weread-enhancer/blob/main/release/privacy.md` |
| 截图 `screenshots/resized/` | ✅ 已有 `screenshot-01~06.png` + `promo-tile-1400x560.png` / `promo-tile-440x280.png`（Edge/Chrome 尺寸） |
| 上架 zip（Edge/Chrome 通用） | ✅ 已打包 `release/weread-enhancer-v0.8.1.zip`（本会话生成；zip 不入库，需重打见下方命令） |
| Edge 商店中英文案 | ✅ 已修正（`plan_edge_store.md`）：去掉错误 `T` 快捷键、补 v0.8.1 新功能 |
| 归档文档 | ✅ 三份已建：`plan_edge_store.md` / `plan_chrome_store.md`（暂缓）/ `plan_360_store.md`（新手完整版） |
| 360 图片素材 | ⚠️ 需按 360 专用尺寸另做：效果图 560×350、详情页图标 48×48（可用 `icon-48.png`）等 |

---

## 关键文件路径
| 文件 | 路径 |
|-----|------|
| manifest.json（v0.8.1） | `/Users/Admin/Knowledge/Coding/微信读书插件/manifest.json` |
| 核心逻辑 / 样式 | `content.js` / `content.css` |
| Edge 上架方案（含文案/审核备注模板） | `plan\plan_edge_store.md` |
| Chrome 上架/归档（暂缓） | `plan\plan_chrome_store.md` |
| 360 上架/归档（新手完整版） | `plan\plan_360_store.md` |
| Edge/Chrome 上架包（已打包） | `release\weread-enhancer-v0.8.1.zip` |
| 隐私政策 | `release\privacy.md` |
| 版本管理 + 归档历史 | `plan\version_plan.md`、`plan\plan_github_versioning.md` |
| 图标 | `icons\icon-16/48/128.png` |
| 上架截图（成品） | `screenshots\resized\` |

---

## 打包命令（v0.8.1，Python 跨平台，正斜杠路径）
```powershell
python -c "import zipfile; files=['manifest.json','content.js','content.css','README.md','icons/icon-16.png','icons/icon-48.png','icons/icon-128.png']; z=zipfile.ZipFile('release/weread-enhancer-v0.8.1.zip','w',zipfile.ZIP_DEFLATED); [z.write(f,f) for f in files]; z.close()"
```
- **包含**：`manifest.json`、`content.js`、`content.css`、`README.md`、`icons/`（3 png）
- **排除**：`.gitignore`、`dev/`、`plan/`、`test/`、`usage/`、`screenshots/`、`inbox/`、`release/`、`.dbg/`、`debug-*.md`、`*.json`(调试日志)
- zip 属 `.gitignore` 排除项，不入库

---

## 上架任务清单
### A. Edge（更新提交 v0.8.1）⭐当前重点
1. ✅ 打包 v0.8.1 zip（`release/weread-enhancer-v0.8.1.zip`）
2. ✅ 更新商店 Listing 文案（去 `T`、补 v0.8.1 新功能）
3. ⏭️ Partner Center → 现有扩展 → 更新包 → 提交审核（**用户手动**）

### B. Chrome Web Store（⏸️ 暂缓，待付 $5 后再做）
- 资料已备于 `plan_chrome_store.md`（可复用同一 zip、MV3 通用）；用户决定暂不投入

### C. 360 浏览器扩展 ⭐当前重点
1. ⏭️ 先在 360 浏览器实测 **MV3 兼容性**（决定能否上架，**用户手动**）
2. 打包 `.crx`（360 浏览器，妥存 `.pem`）→ 备 560×350 效果图等素材 → 压成 ZIP 上传
- 从账号注册起的详细新手步骤见 `plan_360_store.md`

### D. 归档（每个商店一份文档）✅ 已建
- `plan_edge_store.md` / `plan_chrome_store.md` / `plan_360_store.md`，各含账户 / 提交版本 / Listing 文案 / 素材 / 审核状态记录（状态待边做边填）

---

## 注意事项
- **版本号必须递增**且高于该商店上次提交版本，否则被拒（Edge 上次 v0.2.0 → 本次 v0.8.1 OK）
- **快捷键以代码为准**：实际为 **空格 / D / F / ?**（`content.js` 的 `handleAllKeyboard`，无 T/主题、无 C）。`plan_edge_store.md` 旧文案里错误的 `T` 已于本会话删除；**后续任何商店文案都不要再写 T**
- **360 与 Chrome/Edge 差异**：360 上传的是**内含 `.crx` 的 ZIP**（非直接传 crx），且图片尺寸独立（效果图 560×350、图标 48×48…），详见 `plan_360_store.md`；**上架前必测 MV3 兼容性**
- 权限理由 / 审核备注模板见 `plan_edge_store.md` 第四节（可复用）
- 隐私政策 URL、支持邮箱 `2195542745@qq.com`、分类"生产力/辅助功能"沿用
- 截图/宣传图用 `screenshots/resized/` 现成的；如尺寸不符各商店要求再调
- **上架完成后**：更新 `version_plan.md` 第 3 节「浏览器上架」进度；若因上架改了代码则按支线流程升 patch + 更新 `plan_github_versioning.md` 归档历史表
- 未经用户明确要求不 git 提交、不注册账户、不代替用户提交审核（提交动作通常由用户手动完成）
