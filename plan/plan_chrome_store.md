# Google Chrome Web Store 上架 / 归档文档

> **文档类型**：商店上架方案 + 归档记录（Chrome Web Store）
> **创建日期**：2026-07-07
> **对应版本**：v0.8.2（Manifest V3）
> **关联文档**：`plan/plan_edge_store.md`（Edge，已上架 v0.2.0）、`plan/session_handoff_商店上架.md`
> **说明**：本文档承接 `plan_edge_store.md` 末条需求「同步一份 Chrome 相关文档并归档」。商店要求部分已于 2026-07-07 核实官方/权威来源，见文末「资料来源」。

> ⏸️ **当前状态：暂缓上架，且**排在所有商店最后**（2026-10-04 用户决定）**。原因：Chrome 需一次性 $5 注册费，暂不投入。
> **当前优先级：Edge（已上）→ 360 → QQ（渠道待核实）→ Chrome（最后）**。本文档资料已就绪，待决定付费后可直接按此上架。

---

## 一、账户

| 项 | 内容 / 状态 |
|---|---|
| 开发者后台 | https://chrome.google.com/webstore/devconsole |
| 注册费 | **一次性 $5 USD**（信用卡 / Google Pay），付费后账户即时激活 |
| 账户状态 | ❓**待确认是否已注册**（未核实，勿假设） |
| 发布上限 | 单账户最多 20 个扩展 |

---

## 二、提交版本与安装包

- `manifest.json` version = **0.8.2**，`manifest_version: 3` —— Chrome 现要求 MV3（MV2 已弃用），**本插件已满足，无需改造**。
- **复用 Edge 同一个 zip**：`release/weread-enhancer-v0.8.2.zip`（MV3 包 Chrome/Edge 通用）。
- ℹ️ 该 zip `release/` 下已生成（`.gitignore` 排除 `*.zip`，不入库）。
- zip 根目录必须直接包含 `manifest.json`；单包上限 128MB（本插件远低于）。
- 打包命令见文末附录（版本号 0.8.2）。

---

## 三、图片资产（对照 Chrome 要求）

| 资产 | Chrome 要求 | 现有文件 | 状态 |
|---|---|---|---|
| 商店图标 | 128×128 PNG（必需） | `icons/icon-128.png` | ✅ |
| 扩展图标 | 16 / 48 / 128 | `icons/icon-16/48/128.png` | ✅ |
| 截图 | 1280×800 或 640×400，1–5 张（至少 1 张必需） | `screenshots/store/store-01~05-1280x800.png` | ✅ 已实测 1280×800 |
| 小宣传图 | 440×280（必需 / 强烈建议） | `screenshots/store/promo-440x280.png` | ✅ |
| 大宣传图 Marquee | 1400×560（可选，精选位用） | `screenshots/store/promo-1400x560.png` | ✅ |

> ℹ️ 上述素材与 Edge 商店**同一套、直接复用**（尺寸要求一致），由 `promo.py` 一键生成：`python3 promo.py`。
> ℹ️ `screenshots/promo/`（Banner + 功能卡片）只用于 GitHub README，**不上传商店**；360 商店的 560×350 效果图在 `release/360-素材/`，尺寸不同勿混用。
> ℹ️ 旧素材 `screenshots/resized/` 为早期纯截图版，已被 `screenshots/store/` 取代。

---

## 四、商店 Listing 文案（v0.8.2，已按实际功能校正）

| 字段 | 内容 |
|---|---|
| **名称** | 微信悦读（≤75 字符） |
| **简短描述**（Summary，≤132 字符） | 增强微信读书网页版：屏占比调节、自动阅读、快捷键、勿扰与全屏，滚动模式工具栏浮动与自绘滚动条 |
| **分类** | 生产力（Productivity） |
| **支持语言** | 中文（简体） |
| **隐私政策 URL** | `https://github.com/chengzilala/weread-enhancer/blob/main/release/privacy.md` |
| **网站 URL** | `https://wereadapp-32km31c.maozi.io` |
| **支持邮箱** | 2195542745@qq.com |

> ⚠️ **快捷键已校正**：源代码 `content.js` 的 `handleAllKeyboard` 实测仅 **空格 / D / F / ?**，**无 T（主题）快捷键**。`plan_edge_store.md` 旧文案里的 `T (theme)` 为错误，切勿沿用，否则「描述与实际不符」可能被拒。

**详细描述（中文）**：

> 微信悦读是专为微信读书网页版（weread.qq.com）打造的阅读增强工具，帮助你打造更舒适、专注的网页阅读体验。
>
> **核心功能**：
> - **屏占比调节**：50%-100% 自由调整阅读区域宽度，滑块 + 快捷比例按钮，设置自动保存
> - **自动阅读**：速度、方向可调，空格键一键开始/暂停
> - **快捷键操作**：空格（自动阅读）、D（勿扰）、F（全屏）、?（帮助面板）
> - **勿扰模式**：隐藏干扰元素，专注沉浸阅读
> - **全屏模式**：一键进入沉浸全屏，退出自动恢复
> - **工具栏浮动**：屏占比过高或滚动模式下原生工具栏自动隐藏，鼠标移到感应区淡入显示，点击正常
> - **滚动模式适配**：滚动阅读模式下屏占比自适应，配自绘悬浮滚动条，滚动更顺滑
>
> **贴心之处**：
> - 所有设置自动保存，刷新页面无需重新调节
> - 首次安装/更新弹出新手引导
> - 零依赖、不收集任何用户数据，仅在 weread.qq.com 下运行

**详细描述（英文）**：

> WeRead Enhancer is a reading enhancement tool for WeRead (weread.qq.com) that helps you build a more comfortable and focused web reading experience.
>
> **Key features**:
> - **Screen ratio**: freely adjust reading width from 50% to 100% with a slider and preset buttons; saved automatically
> - **Themes**: one-click switch between Light / Dark / Eye-care (sepia), stable with no leftover artifacts
> - **Auto reading**: adjustable speed and direction, start/pause with the spacebar
> - **Keyboard shortcuts**: Space (auto read), D (do-not-disturb), F (full screen), ? (help panel)
> - **Do-not-disturb**: hide distractions for immersive reading
> - **Full screen**: one-click immersive mode, restores automatically on exit
> - **Floating toolbar**: when the ratio is high or in scroll mode, the native toolbar auto-hides and reappears on hover
> - **Scroll-mode tuning**: adaptive screen ratio in scroll reading mode with a custom floating scrollbar for smoother scrolling
>
> **Nice to know**:
> - All preferences are saved automatically across page refreshes
> - A welcome guide appears on first install/update
> - Privacy-first: zero dependencies, no data collection, runs only on weread.qq.com

---

## 五、隐私实践问卷（Chrome 特有，比 Edge 更细）

Chrome 上架时需在「隐私实践 / Privacy practices」中逐项声明：

- **单一用途说明（Single purpose）**：
  > This extension has a single purpose: enhancing the reading experience on WeRead (weread.qq.com) — adjustable reading width, themes, auto-reading, and reading-focused UI tweaks.
- **数据收集**：不收集、不使用、不分享任何用户数据（全部选「不收集」）。
- **权限理由（Permission justification）**：
  > "storage": used SOLELY to save user preferences (screen ratio, theme, auto-read speed, do-not-disturb / full-screen state) to chrome.storage.local. No data is collected, tracked, or transmitted.
- **远程代码**：无（无 eval、无外部 `<script src>`、无远程指令）。
- **合规认证**：勾选符合 Chrome Web Store Developer Program Policies。

---

## 六、上架步骤

1. 登录 [Developer Dashboard](https://chrome.google.com/webstore/devconsole)，如首次则付 $5 并接受开发者协议
2. **New Item** → 上传 `release/weread-enhancer-v0.8.2.zip`
3. 填写 Store Listing：名称、简短描述、详细描述、分类、语言
4. 上传截图（1280×800 / 640×400）、小宣传图 440×280、（可选）大宣传图 1400×560
5. 填写隐私政策 URL + **隐私实践问卷** + 权限理由 + 单一用途说明
6. 分发设置：可见性选 **Public**、地区
7. **Submit for review**（通常 1–3 工作日；MV3 纯代码更新可能走自动审核更快）

---

## 七、审核状态记录（提交后填写）

| 项 | 记录 |
|---|---|
| 提交版本 | v0.8.2 |
| 提交日期 | （待填） |
| 审核状态 | （待填：审核中 / 通过 / 拒绝） |
| 商店链接 | （通过后填） |
| 拒绝原因与修正 | （如有） |

---

## 八、注意事项 / 常见拒绝原因

- **权限最小**：仅 `storage`，无 `<all_urls>`/`tabs`/`webRequest`，被拒风险低
- **描述须与实际一致**：勿写未实现功能（尤其已删的 `T` 主题快捷键）
- **无远程代码 / 无混淆**：代码可读，符合
- **单一用途**：阅读增强，功能相关，符合「单一用途」政策
- **关键词堆砌**：同一关键词勿重复超过 5 次
- 隐私政策 URL、支持邮箱、分类沿用 Edge 一致，便于统一维护
- **提交审核动作由用户手动完成**；未经用户明确要求不注册账户、不代替提交

---

## 附录：打包命令（v0.8.2，Python 跨平台，正斜杠路径）

```powershell
python3 -c "import zipfile; files=['manifest.json','content.js','content.css','README.md','icons/icon-16.png','icons/icon-48.png','icons/icon-128.png']; z=zipfile.ZipFile('release/weread-enhancer-v0.8.2.zip','w',zipfile.ZIP_DEFLATED); [z.write(f,f) for f in files]; z.close()"
```

- **包含**：`manifest.json`、`content.js`、`content.css`、`README.md`、`icons/`（3 png）
- **排除**：`.gitignore`、`dev/`、`plan/`、`test/`、`usage/`、`screenshots/`、`inbox/`、`release/`、`.dbg/`、`debug-*.md`

---

## 资料来源（2026-07-07 核实）

- Chrome Web Store 官方发布文档：https://github.com/GoogleChrome/webstore-docs/blob/master/publish.md
- 开发者后台：https://chrome.google.com/webstore/devconsole
- 提交要求（$5 费用 / MV3 / 图片尺寸 / 隐私实践 / 审核时长）来自多个权威指南交叉核对
