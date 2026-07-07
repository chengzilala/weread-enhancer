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
| 商店展示图 | 截图文件夹已有 5 张 | 选取并转换为 1280x800 或 640x400 PNG | P1 |
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
| **名称**         | 微信读书屏占比调节器                                                                    |
| **简短描述（≤80字）** | 增强微信读书网页版：屏占比调节、明亮/暗黑/护眼主题、自动阅读、快捷键、勿扰与全屏模式                                     |
| **详细描述**       | 见下方"详细描述文案"                                                                   |
| **支持语言**       | 中文（简体）                                                                        |
| **分类**         | 生产力 / 辅助功能                                                                    |
| **隐私政策 URL**   | `https://github.com/chengzilala/weread-enhancer/blob/main/release/privacy.md` |
| **网站 URL**     | `https://github.com/chengzilala/weread-enhancer`                              |
| **支持邮箱**       | 2195542745@qq.com                                                             |

**详细描述文案（中文）**：

> 微信读书辅助增强版是专为微信读书网页版（weread.qq.com）打造的阅读增强工具，帮助你打造更舒适、专注的网页阅读体验。
>
> **核心功能**：
> - **屏占比调节**：50%-100% 自由调整阅读区域宽度，滑块 + 快捷比例按钮，设置自动保存
> - **主题切换**：明亮 / 暗黑 / 护眼（米黄）三主题一键切换，切换稳定无残留
> - **自动阅读**：速度、方向可调，空格键一键开始/暂停
> - **快捷键操作**：空格（自动阅读）、D（勿扰）、T（主题）、F（全屏）、?（帮助面板）
> - **勿扰模式**：隐藏干扰元素，专注沉浸阅读
> - **全屏模式**：一键进入沉浸全屏，退出自动恢复
> - **工具栏浮动**：屏占比过高时原生工具栏自动隐藏，鼠标移到感应区淡入显示，点击正常
>
> **贴心之处**：
> - 所有设置自动保存，刷新页面无需重新调节
> - 首次安装/更新弹出新手引导
> - 零依赖、不收集任何用户数据，仅在 weread.qq.com 下运行

**英文描述（Store Listing English）**：

> WeRead Enhancer is a reading enhancement tool for WeRead (weread.qq.com) that helps you build a more comfortable and focused web reading experience.
>
> **Key features**:
> - **Screen ratio**: freely adjust reading width from 50% to 100% with a slider and preset buttons; saved automatically
> - **Themes**: one-click switch between Light / Dark / Eye-care (sepia), stable with no leftover artifacts
> - **Auto reading**: adjustable speed and direction, start/pause with the spacebar
> - **Keyboard shortcuts**: Space (auto read), D (do-not-disturb), T (theme), F (full screen), ? (help panel)
> - **Do-not-disturb**: hide distractions for immersive reading
> - **Full screen**: one-click immersive mode, restores automatically on exit
> - **Floating toolbar**: when the ratio is high, the native toolbar auto-hides and reappears on hover
>
> **Nice to know**:
> - All preferences are saved automatically across page refreshes
> - A welcome guide appears on first install/update
> - Privacy-first: zero dependencies, no data collection, runs only on weread.qq.com

### 步骤 4：制作截图（1-10 张）

现有截图文件夹：`screenshots/`，已有 5 张。需要：

1. 选取最佳的 2-3 张
2. 尺寸调整为 **1280x800** 或 **640x400**
3. 重命名为英文：`screenshot-01.png`、`screenshot-02.png` ...

**截图内容建议**：
- 截图1：微信读书页面 + 插件设置面板展开（展示屏占比功能）
- 截图2：100% 屏占比效果（工具栏隐藏）
- 截图3：鼠标悬停工具栏淡入显示效果

### 步骤 5：打包 ZIP

```powershell
# 在项目目录执行（用 Python 生成，确保 zip 内为正斜杠路径）
python -c "import zipfile; files=['manifest.json','content.js','content.css','README.md','icons/icon-16.png','icons/icon-48.png','icons/icon-128.png']; z=zipfile.ZipFile('release/weread-enhancer-v0.8.0.zip','w',zipfile.ZIP_DEFLATED); [z.write(f,f) for f in files]; z.close()"
```

或手动创建 zip，包含：
```
weread-enhancer-v0.8.0.zip
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
- Themes: switch between Light / Dark / Eye-care (sepia) modes via CSS filter.
- Auto reading: adjustable scroll speed and direction, toggled with the spacebar.
- Keyboard shortcuts: Space (auto read), D (do-not-disturb), T (theme), F (full screen), ? (help panel).
- Do-not-disturb and full-screen immersive modes.
- Onboarding guide shown on first install / update.

Permission justification
- "storage": used SOLELY to save user preferences (screen ratio, theme, auto-read
  speed, do-not-disturb and full-screen state) to browser local storage
  (chrome.storage.local). No data is ever collected, tracked, or transmitted.

No remote code, analytics, tracking, or ads are included.

How to test:
1. Install the extension.
2. Open any book page on https://weread.qq.com.
3. A control panel appears at the top-right corner; adjust screen ratio, switch themes,
   start auto reading, or press ? to open the help/debug panel.

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

## 七、执行任务分配

| 序号 | 任务 | 执行方式 | 状态 |
|------|------|---------|------|
| 1 | 更新 manifest.json（版本号 + 图标引用） | 已完成 | ✅ |
| 2 | 生成 3 个图标 PNG | 已完成（`icons/`） | ✅ |
| 3 | 创建 icons/ 目录 | 已完成 | ✅ |
| 4 | 撰写 privacy.md | 已完成（`release/privacy.md`） | ✅ |
| 5 | 更新 README.md（补充实际功能说明） | 已完成 | ✅ |
| 6 | 准备中英文商店文案 | 文档中已有 | ✅ |
| 7 | 截图整理与尺寸调整 | **用户操作**（从 `screenshots/` 选取 2-3 张，裁剪为 1280x800 或 640x400） | ⏳ 待执行 |
| 8 | 重新打包上架 zip | 我来打包 | 🔄 即将执行 |
| 9 | 注册 Partner Center + 上传提交 | 用户操作（已提交审核） | ✅ |

---

## 八、后续迭代（上架后）

- 首次审核通过后，发布到 Public 可见
- 后续功能更新 → 改版本号 → 重新打包 → Partner Center 更新提交
- 可同步上架到 **Chrome Web Store**（Chrome 用的是同一个 manifest.json，可复用）
- 积累用户评价后可申请"精选扩展"推荐位
- 增加主流浏览器的上架：360浏览器、Google Chrome 浏览器，为我同步一份相关文档。分别将相关资料做好归档记录
