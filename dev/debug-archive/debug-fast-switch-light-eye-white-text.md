# [OPEN] Debug Session: fast-switch-light-eye-white-text

## 1. 问题概述
- 现象：测试 `F1` 快速切换时，暗黑模式正常，但切到 `明亮 / 护眼` 后正文仍显示白字，肉眼看不清。
- 期望：`light` 应为白底深色字，`eye-protection` 应为米黄底深色字，即使在快速切换后也应稳定成立。
- 范围：`content.js` 中快速切换链路、旧样式清理、正文节点重刷、异步重建后的二次重刷。

## 2. 复现步骤
1. 打开微信读书阅读页正文页
2. 快速执行：暗黑 → 护眼 → 明亮 → 暗黑 或 暗黑 → 护眼 → 明亮
3. 每步间隔小于 1 秒
4. 观察 `light / eye-protection` 下正文是否仍为白字

## 3. 初始假设
- H1：快速切换后，旧暗黑主题残留的 `color / -webkit-text-fill-color` 没有被完全清除。
- H2：真正可见正文节点不在当前统一重刷命中的节点集合里，导致外层已变深色字，但内层显示文字仍保留白字。
- H3：切到 `light / eye-protection` 后微信读书异步重建了正文节点，而新节点没有被后续重刷覆盖。
- H4：问题不在普通 `color`，而在 `-webkit-text-fill-color` 或更高优先级样式仍保持白色。

## 4. 当前状态
- 状态：已进入新的独立调试会话，只聚焦 `F1` 下 `light / eye-protection` 白字问题。
- 最新动作：已在 `collectFastSwitchSnapshot()` 中新增 `mismatchCandidates` 扫描，专门记录 `light / eye-protection` 下仍显示白字、以及 `dark` 下若出现深色字的可见节点，并附带其 `inlineColor / inlineTextFillColor`。
- 继续收敛：由于 `.readerChapterContent` 下长期混入大量常驻浮层 DOM，现已把探针切换为“`renderTargetContainer` 内真实文本节点 + `Range.getBoundingClientRect()` 可视矩形”，不再依赖宿主元素自身 `rect.height`，以提高正文命中率。
- 日志瘦身：为避免导出日志体积过大，`fast-switch snapshot` 现仅保留 1 个正文区域、前 4 个命中文本节点、前 6 个颜色冲突候选；`subtreeSummary` 只在完全没有命中正文文本时输出精简版（前 4 个子节点、无递归 children）。
- 当前新增：由于文本节点探针仍未命中真正可见文字，继续补充“视口命中采样”，直接在正文区域的中心 / 左中 / 右中三个点通过 `elementsFromPoint()` 反查当前屏幕上真正显示的元素，并记录其颜色与 inline 样式。
- 约束：在拿到新的运行时证据前，不修改主题业务逻辑。
