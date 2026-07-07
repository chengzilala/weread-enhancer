# 会话交接：微信读书插件 — 功能优化支线

> **文档类型**：会话交接（可直接复制粘贴给新会话）
> **创建日期**：2026-07-07
> **对应版本**：v0.8.0（支线走 v0.8.x 补丁号）

---

## 会话定位
- **性质**：主线版本之外的**功能优化 / 打磨支线**（小改进、体验优化、性能、Bug 修复），**不引入** v0.9.0 主线的大功能。
- **与主线的区别**：
  - 主线 v0.9.0 = 新功能 + 模块化（阅读统计、笔记增强、更多主题、`modules/` 目录）→ 由**另一条会话**负责
  - 本支线 = 在 v0.8.0 基础上做**补丁级优化**，版本走 `v0.8.1 / v0.8.2 …`（保持 v0.9.0 干净留给主线）
- **版本约定**（项目既有规则）：`v0.x.0` = 新增核心功能模块；`v0.x.y` = 小修复/优化补丁。因此本支线每次改动升 **patch 号**。

---

## 项目背景
- **项目**：微信读书辅助增强版（Chrome/Edge 扩展，Manifest V3）
- **仓库**：`https://github.com/chengzilala/weread-enhancer`
- **当前版本**：`v0.8.0`（manifest.json，商店追平版，含屏占比/主题/自动阅读/快捷键/勿扰/全屏/新手引导）
- **Edge 商店**：已提交过 v0.2.0；v0.8.0 的 zip 已构建（`release/weread-enhancer-v0.8.0.zip`），截图 + 提交为用户手动操作
- **代码结构**：`content.js` 为**单文件**（约 119KB / 3200+ 行），尚**未模块化**（无 `modules/` 目录）；主题采用 **CSS filter 方案**（暗黑 `invert(1) hue-rotate(180deg)`、护眼 `sepia(0.4)`、明亮 `none`）

---

## 关键文件路径
| 文件 | 路径 |
|-----|------|
| manifest.json（v0.8.0） | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\manifest.json` |
| 核心逻辑 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\content.js` |
| 样式 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\content.css` |
| PRD 需求文档（v0.7） | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\plan\RPD_需求文档.md` |
| 版本管理文档 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\plan\version_plan.md` |
| Edge 上架方案 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\plan\plan_edge_store.md` |
| 隐私政策 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\release\privacy.md` |
| 项目规则 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\dev\project-rules-v1.0.md` |
| 会话记录 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\dev\session_log.md` |
| 测试清单 | `d:\Knowledge\ChesterObsidian\Coding\微信读书插件\test\`（快捷键 / 自动阅读 / 新手引导） |

---

## 候选优化方向（待用户确认，勿凭空造 Bug）
> 以下为方向池，实际做哪些由用户在会话内指定；储备需求参见 `version_plan.md` 第 3 节「待定需求」。
- 交互 / 体验：面板布局微调、快捷键提示完善、感应区触发手感优化
- 性能：初始化耗时、MutationObserver / 滚动监听开销、日志系统精简
- 稳定性：主题切换边界场景、全屏 / 勿扰状态互斥、刷新恢复一致性
- 快捷键自定义绑定、自动阅读速度曲线优化
- 代码内小重构（**不动主线模块化计划**，仅局部清理）
## 优化点
- 阅读比例达到100%之后，顶栏没有办法点击了。（已完成）
- 滚动方式下，阅读比例调整没有正确适配。（已完成）
- 滚动栏，右侧有一个当前滚动进度条，默认隐藏，当鼠标移动到最右侧时，弹出滚动栏。（已完成）
- 快捷键，横屏和双栏模式的切换。（⏸️ 搁置 → 见下方问题，已转入 `version_plan.md` 后续规划）
- 全屏模式也加入到主题中，支持切换。（⏸️ 搁置，随横屏/双栏一并延后）

### ⏸️ 搁置说明：横屏/双栏快捷键（2026-07-07）
- **原生按钮定位已完成**：右侧工具栏 `.readerControls` 第 4 个按钮 `.readerControls_item.isNormalReader` 即「双栏阅读」切换（经 tooltip 探测确认，工具栏 tooltip 顺序：目录 / Ai问书 / 笔记 / 双栏阅读 / 字号 / 深色）。
- **卡点**：脚本模拟点击该按钮**完全无效**——已依次尝试 `.click()`、完整原生事件序列（pointerdown→mousedown→mouseup→click）、React `onClick` 直呼，在**翻页模式和滚动模式下均无反应**（按钮 class 不变、无二级浮层、正文无任何变化）。
- **根因推测**：① 按钮非 React 组件（元素上无 `__reactProps` key）；② 微信读书极可能对该按钮校验 `event.isTrusted`，直接拒绝脚本合成事件。
- **后续方向**：放弃"模拟点击原生按钮"，改为**插件自绘布局**（用 CSS 自己实现横屏/双栏，思路同屏占比方案），或深挖微信读书内部事件通道 / API。全屏加入主题面板一并延后。
- 本次相关失败尝试代码（C 键、主题面板切换按钮、临时诊断 `\` 及 `toggleColumnMode/simulateNativeClick/probeControlTooltips/inspectReadingSettings`）已回退，保持 v0.8.x 干净。

---

## 支线工作流程
1. 在 v0.8.0 代码上改动 → 升 patch：`manifest.json` `0.8.0 → 0.8.1`
2. 同步更新 README / `version_plan.md`（补丁记录）
3. 如需上架：用 Python 打包（正斜杠路径），产物 `release/weread-enhancer-v0.8.x.zip`
   - **包含**：`manifest.json`、`content.js`、`content.css`、`README.md`、`icons/`（3 png）
   - **排除**：`.gitignore`、`dev/`、`plan/`、`test/`、`usage/`、`screenshots/`、`inbox/`、`release/`、`.dbg/`、`debug-*.md`
4. 打包命令模板见 `plan/plan_edge_store.md` 步骤 5
5. **提交 GitHub 并归档**：`git commit` → `git tag v0.x.y` → `git push origin main` + `git push origin v0.x.y`
6. **⚠️ 每次打 tag 后必须更新 `plan/plan_github_versioning.md` 的「归档历史」表**（新增一行 Tag/Commit/日期/说明 + 更新顶部「当前归档版本」）

---

## 注意事项
- 优化改动**不要提前实现 v0.9.0 主线功能**（阅读统计 / 笔记 / 更多主题 / 模块化），避免两条线冲突
- manifest 版本号必须递增，否则商店拒绝提交
- 主题相关改动优先沿用 CSS filter 方案，避免回到「逐元素刷 inline style」的旧时序坑
- 改动前先 `Read` 对应代码；`content.js` 是大单文件，改前先定位再动
- 未经用户明确要求不要 git 提交
