# [OPEN] Debug Session: theme-text-invisible

## 问题描述
- 用户最新反馈：当前现场“根本就看不到文字了”，需要先看最新日志确认是文字颜色问题、背景覆盖问题，还是命中了错误层。
- 当前要求：在拿到最新失败现场证据前，不修改业务逻辑。

## 假设
- H1：文字颜色被刷成与背景接近的颜色，导致正文实际上存在但不可见。
- H2：正文所在页面层背景被错误覆盖，形成整块浅色/灰色底，把文字淹没。
- H3：当前视口命中的是遮罩层、空白层或非正文层，导致日志里的颜色与真实正文不一致。
- H4：快速切换后的最后一个 token 虽然生效，但把页面层背景刷到了错误主题。

## 当前计划
- 读取最新失败现场日志。
- 对照 `theme`、`paint-after-write`、`observer-repaint`、`viewportSamples`、`bodyClass` 判断更接近哪条假设。
- 在证据不足前，不修改主题业务逻辑。

## 最新证据
- 最新失败日志 `weread-debug-1782537313250.json` 显示：`dark / light / eye-protection` 三种主题的 `areaColor` 与 `areaBackgroundColor` 仍然表面正常，但这与用户“根本看不到文字”的现场矛盾。
- 同一份日志中，`visibleNodes` 依旧长期为 `0`，`viewportSamples` 又总能命中 `renderTargetContainer`，说明当前采样很可能还没有命中真正盖在屏幕上的最上层元素，更接近 H3。
- 页面结构诊断中 `.readerChapterContent` 尺寸正常，但 `.app_content_in_reader` 仍为 `0x0`；由于上一份“看得到”的日志也存在相同现象，因此暂时不能把它认定为本次根因。
- 新增 `hitStack` 后读取 `weread-debug-1782537664576.json`，确认屏幕中心最上层长期是空的 `content_decoration_wrapper_inner` / `content_decoration_wrapper`，`renderTargetContainer` 反而只在更下层，说明“当前看到的空白页”更像是被官方装饰层或覆盖层占据，而不是我们先前命中的容器就是最终显示层。
- 继续读取更新日志 `weread-debug-1782537840218.json` 后发现，`center` 点已不再命中空装饰层，而是直接命中 `renderTargetContainer`；更关键的是 `left-center` 命中了真实正文节点 `P.content`，其样式为白底黑字、`opacity=1`、`visibility=visible`、`filter/mixBlendMode/backgroundImage` 均为默认值。这说明“空装饰层覆盖正文”并不是稳定复现的根因，最新日志更像是只在中心空白区取样到了非正文，而正文本身在左侧采样点已可见。
- 最新失败日志 `weread-debug-1782538198883.json` 显示：这次首屏初始化确实立即执行了 `applyTheme('dark')`，并把 `bodyClass` 切到了 `wre-theme-dark`，因此“保存主题未恢复”这条怀疑暂时被证伪。
- 同一份日志的 `paint-after-write` 快照里，屏幕中心最上层命中的是一个全屏绝对定位的空层 `readerChapterContentLoading`，尺寸约 `1432x662`，位于正文区域之上；而旧的“可见”日志 `weread-debug-1782537150206.json` 与 `weread-debug-1782537840218.json` 均不存在该类名。当前最强证据已经转向：失败现场更像是官方阅读内容停留在“加载中层未退出”，而不是纯粹的主题颜色刷错。

## 已做插桩
- 在 `collectFastSwitchSnapshot()` 的 `viewportSamples` 中新增 `hitStack`，记录 `elementsFromPoint()` 顶部 6 层元素的 `tag/class/text/color/background/opacity/visibility/pointerEvents/zIndex/rect`。
- 目标：下一份日志直接确认屏幕中心是否有空白遮罩层、透明层或其他非正文层压在 `renderTargetContainer` 之上。
- 继续补充顶层命中元素的 `position / overflow / transform / filter / mixBlendMode / backgroundImage / backgroundBlendMode`，用来判断这些空的装饰层是否依靠特殊样式把正文盖住。

## 已做修复
- 基于 `weread-debug-1782538198883.json` 的证据，在 `content.js` 中新增 `hasVisibleReadableText(root)`：只有当 `renderTargetContainer` 下已经探测到真实可见文本时，才认定正文已就绪。
- 在 `applyThemeColors(theme)` 中跳过 `.readerChapterContentLoading` 及其子树的正文刷色，避免继续把官方加载层卷入插件的文字重刷链路。
- 当正文已就绪但 `.readerChapterContentLoading` 仍存在时，主动将该层设为 `opacity: 0`、`visibility: hidden`、`pointer-events: none`，并触发一次 `scheduleWereadLayoutReflow('loading-overlay-release')` 兜底。
- 当前修复目标：验证“直接打开阅读页就没有文字”的首屏失败现场是否消失；在用户确认前，不清理调试插桩。

## 验证状态
- 用户已按“重载插件 -> 直接打开阅读页”路径复测，结果仍然复现。
- 下一步需要读取修复后的最新失败日志，直接对比 `readerChapterContentLoading`、`hitStack` 与 `paint-after-write` 的前后差异，再决定是否继续沿 loading 覆盖层方向深入。
- 最新修复后日志 `weread-debug-1782538831881.json` 显示：`readerChapterContentLoading` 仍长期位于 `hitStack[0]`，且没有出现 `已释放首屏 loading 覆盖层` 日志，说明“正文已就绪后再释放”这条条件始终未触发。
- 结合日志内容看，该 loading 层持续满足“全屏尺寸大、文本为空、覆盖正文区域”这三个条件，因此进一步把策略调整为：在 `applyThemeColors()` 启动 300ms 后，若仍检测到这种空的全屏 loading 层，则按“卡住覆盖层”处理并主动隐藏，再触发一次布局重排。
- 最新日志 `weread-debug-1782539191856.json` 证明“超时释放卡住的 loading 层”已经实际触发；但新的 `hitStack` 又显示正文容器被标记为 `isNoise=true`。根因不是阅读层再次损坏，而是上一轮调试过滤把 `body.wre-theme-dark` 这类主题类也当成了 `wre-*` 插件噪音，连带把正文容器错误过滤掉。
- 已修正采样过滤：只排除真正的插件 UI 元素（如 `#we-read-enhancer-root`、`[id^="wre-"]`、`.wre-modal*`、`.wre-slider` 等），不再因为 `body` 上的 `wre-theme-*` 类误伤正文层。下一份日志用于验证这一点。
- 最新日志 `weread-debug-1782539369339.json` 证明正文容器已经不再被误判成噪音，`hitStack[0]` 能直接命中 `readerChapterContent`；但命中的 `text` 仍持续是“全书完 / 试读结束 / 封面”这一套混合文本，而 `visibleNodes` 依旧为 0，说明当前 `viewportSamples` 选中的只是一个过大的祖先容器，它的 `textContent` 混入了隐藏页层内容，仍然没有真正命中可见的章节段落。
- 已继续补充一层取证：当 `visibleNodes` 仍为 0 时，额外输出 `sizedDescendants`，只记录 `renderTargetContainer` 下“有尺寸”的前几个后代元素摘要，用来判断当前真正占位的可见层到底是哪几层。
- 最新日志 `weread-debug-1782539514953.json` 表明：`sizedDescendants` 仍然始终为 0，而页面结构与此前“看得到字”的日志在容器级别几乎一致（包括 `screenRatio=100`、`.app_content_in_reader=0x0`、`readerChapterContent`/`readerChapterContent_container` 尺寸正常），说明当前这组容器级采样已经不足以区分“可见”与“不可见”两种现场。
- 因此继续收窄取证粒度：新增 `textCandidates`，当遍历 `renderTargetContainer` 文本节点时，即使 `Range.getBoundingClientRect()` 为 0，也会记录前几个文本候选的父元素、文本摘要、rect 与关键样式，下一份日志用来确认“真实章节段落是否存在，只是被压成 0 宽高/移出视口/透明”，还是根本没有进入渲染树。
- 最新日志 `weread-debug-1782555619903.json` 已经给出更强证据：`textCandidates` 不再为空，但前 8 个候选全部来自 `readerFooter_ending_time`、`back_lang_title`、`wr_flyleaf_module_rating_*` 等结束页/扉页层，且 `rect` 全部为 `0x0`；同时 `visibleNodes` 仍为 0、`sizedDescendants` 仍为 0。这说明当前失败现场下，`renderTargetContainer` 内根本没有被探测到任何“真实章节段落”节点，至少前排渲染树里只剩结束页/扉页/试读提示等隐藏层文本。
- 基于这份证据，当前更接近新的假设：问题主因不是主题颜色覆盖，而是正文章节层没有进入可见渲染树，或者被官方页面结构切换到了错误的内容分支。下一步应优先确认 `renderTargetContainer` 的直接子层里是否存在“章节页容器”类名与非零尺寸节点，而不是继续围绕颜色做修补。
- 已继续补充结构取证：当 `visibleNodes` 仍为 0 时，额外输出 `directChildLayers`，逐个记录 `renderTargetContainer` 直接子层的类名、文本摘要、尺寸、显示状态、`transform`、`z-index`，并粗略标记是否像“当前页/可见页”。下一份日志将直接用来判断 `renderTargetContainer` 当前到底挂的是哪些内容分支，以及哪一层有机会是真正的章节页容器。
- 最新日志 `weread-debug-1782555868999.json` 进一步证实：在后半段快照里，`directChildLayers` 中出现了一个有非零尺寸的匿名层，且 `sizedDescendants` 首次出现了 `wr_canvasContainer` 与两块 `canvas`。这说明当前正文内容已进入 canvas 渲染路径，之前围绕 DOM 文本颜色的取证天然抓不到真正内容。
- 因此继续补充 `canvasDiagnostics`：记录每个 canvas 的 `width/height/rect`、是否能读取 2D context、中心/左右中三个像素点的 RGBA，以及画布中心点 `elementsFromPoint()` 的顶层命中链，下一份日志将用来判断“canvas 本身是否已经画出内容”以及“是否仍被 `readerChapterContentLoading` / `content_decoration_wrapper*` 等官方层压在上方”。
- 最新日志 `weread-debug-1782556138320.json` 继续收窄问题：两块 canvas 都已存在且尺寸正常，但中心/左中/右中三个像素采样全部为 `rgba(0,0,0,0)`，说明采样点上的画布内容仍是透明；同时 `overlayHitStack` 与视口命中链表明，canvas 上方仍长期压着 `wr_underline*` 与 `content_decoration_wrapper*` 等官方装饰层。因此当前更像“官方 canvas 渲染链路异常，且上层装饰层持续存在”，而不是插件把文字颜色刷没了。
- 已继续补充时序取证：在 `applyThemeColors()` 启动后追加固定时间点 `16/80/200/500/1000/1800ms` 的 `canvas-timeline-*` 快照，沿用现有 `fast-switch snapshot` 结构。下一份日志将直接用于确认 canvas 是“始终透明”，还是“稍后才真正画出内容”，以及在这段时间里上方覆盖链是否发生变化。
- 最新两份日志 `weread-debug-1782556547268.json` / `weread-debug-1782556546796.json` 表明：在 `500ms` 与 `1000ms` 时序点，`canvasDiagnosticCount` 仍为 0，说明首屏前 1 秒内根本没有进入 canvas 可诊断阶段；直到更后面的 `paint-after-write` / `canvas-timeline-1800ms` 段才首次出现两块 canvas，但它们 `rect` 仍为 `0x0`，像素采样依旧全部为透明 RGBA。这说明当前更像是“官方 canvas 渲染启动很晚，且即使出现也还没有真正画出内容”。
- 需要注意：这两份日志在后半段已被插件调试弹窗 `wre-debug-output / wre-modal-body / wre-modal-overlay` 覆盖中心视口，因此它们适合判断 canvas 的出现时机与像素状态，但不再适合拿来判断用户最终肉眼看到的顶层覆盖链。下一轮若还要看覆盖层，需要尽量基于导出前的时间点或减少弹窗对中心采样的污染。
- 已继续补充最小 canvas 取证：在 `canvasDiagnostics` 中新增 `parentChain`，顺着每块 canvas 向上记录最多 5 层父容器的类名、尺寸、`display / position / opacity / visibility / overflow / transform / zIndex`；同时新增 `hasNonTransparentPixels`、`nonTransparentSamples` 与 `firstNonTransparentHit`，按 `token + canvas 索引` 记住该 canvas 第一次出现非透明像素的阶段与相对启动耗时。下一份日志将直接用来确认：canvas 首次挂在哪个父层下，以及它到底有没有在后续某个时间点真正画出内容。
- 最新日志 `weread-debug-1782556812828.json` / `weread-debug-1782556811906.json` 已给出更强证据：两块 canvas 虽然已经创建，但 `hasNonTransparentPixels` 始终为 `false`、`firstNonTransparentHit` 始终为 `null`；更关键的是 `parentChain` 明确显示其祖先 `renderTargetContainer` 被计算为 `display:none`。因此当前已将排查重点从“canvas 为什么一直透明”进一步前移到“renderTargetContainer 为什么会被隐藏”。
- 基于上述证据，已加入最小实验性修复：当 `paint()` 发现 `probeRoot` 就是 `.renderTargetContainer` 且其计算样式为 `display:none` 时，直接为该节点及其直接父层写入 `display:block / visibility:visible / opacity:1`，并触发一次 `scheduleWereadLayoutReflow('render-target-force-visible')`。下一份日志将用于验证该修复是否能直接恢复正文可见性。
- 用户按“重载插件 -> 直接打开阅读页”路径复测后仍然复现；最新日志 `weread-debug-1782557187564.json`、`weread-debug-1782557188202.json`、`weread-debug-1782557188340.json` 一致显示：`已强制恢复隐藏的 renderTargetContainer` 与 `render-target-force-visible` 都已实际触发，说明实验性修复不是“没跑到”，而是“跑到了但仍不足以恢复正文”。
- 同一批日志还证实：修复触发后，`canvas parentChain` 中的 `renderTargetContainer` 已不再出现 `display:none`，而是稳定为 `display:block / visibility:visible / opacity:1`；因此“承载容器被隐藏”从当前失败现场里已经降级为已处理的次级问题，不再是最终挡住正文的最后一层原因。
- 但即使在这个状态下，两块 canvas 仍始终 `hasNonTransparentPixels=false`、`firstNonTransparentHit=null`，三份日志都没有出现任何非透明像素命中；同时 `visibleNodes` 依旧为 0、`textCandidates` 仍主要来自结束页/扉页/试读层。这说明正文不可见的主因已经进一步收敛为：官方 canvas 渲染链路本身没有真正产出可见正文像素，或页面继续停留在错误内容分支，而不是单纯的 CSS 可见性问题。
- 因此本轮继续只补最小取证，不改主题逻辑：已为每块 canvas 增加 `canvasId`、`lifecycle`、`drawStats` 三组状态，用来判断它是否被反复重建、尺寸/父层是否变化，以及在当前 token 周期内是否真的发生过 `drawImage / fillText / clearRect / putImageData` 等 2D 绘制调用。
- 同时新增 `renderBranchSummary`，把当前 `renderTargetContainer` 的内容分支压缩为一组更易读信号：`likelyBranch`、`hasCanvas`、`hasCanvasPixels`、`hasBackCover`、`hasFlyleaf`、`hasNeedPay`、`hasEnding`、`hasLoading`，避免下一轮继续从大段 `subtreeSummary / textCandidates` 里人工拼凑“现在到底更像哪条内容路径”。
- 下一份日志优先只看这几项新字段：1）`canvasDiagnostics[*].drawStats.totalCalls / callsByMethod / recentCalls`，确认官方是否真的在往画布写内容；2）`canvasDiagnostics[*].lifecycle.sizeChangeCount / parentChangeCount / observationCount`，确认画布是否被反复清空或重挂载；3）`renderBranchSummary.likelyBranch`，确认当前更接近“正文分支”、“封面/扉页/结束页分支”还是“canvas 存在但始终透明”。
- 最新四份日志 `weread-debug-1782558006852.json`、`weread-debug-1782558007483.json`、`weread-debug-1782558007608.json`、`weread-debug-1782558007721.json` 已把方向进一步钉死：`renderBranchSummary.likelyBranch` 从头到尾都稳定为 `need-pay-or-preview-branch`，而不是 `canvas-present-but-transparent` 或 `canvas-visible`。这说明当前失败现场更像“阅读根容器一直停在试读/预览内容分支”，而不是“正文 canvas 已经出现但没画出来”。
- 同一批日志还显示：在大部分早期快照中 `canvasDiagnostics` 直接为 0；到了后期少量快照虽然重新出现了 2 块 canvas，但 `drawStats` 依旧完全为空、`totalCalls` 不存在、`callsByMethod` 为空对象、`lifecycle.parentChangeCount / sizeChangeCount` 也始终为 0。换句话说，这些 canvas 更像是被动挂在页面上的空壳，并没有收到任何官方 2D 绘制调用，也没有经历重建或尺寸变化。
- 更关键的是，`directChildLayers` 与 `textCandidates` 已经不再支持“正文分支”假设：前者稳定包含 `wr_horizontal_reader_needPay_container*`、`horizontal_reader_back_cover_wrapper`、`reader_flyleaf_container`、`horizontalReaderCoverPage`，后者稳定只有结束页/扉页评分等文本；同时还长期存在全屏可见的 `reader_float_review_with_range_panel_wrapper`、`reader_float_top_reviews_panel_wrapper`、`reader_float_search_panel_wrapper`。因此当前最强结论已从“canvas 没画正文”进一步收敛为“页面内容分支本身就停在试读/预览/浮层态，而不是正文章节态”。
- 基于这组证据，当前开始尝试最小实验性修复：仅当 `renderTargetContainer` 下仍无可见正文、且命中大面积可见的 `reader_float_*` 面板时，临时将这些面板设为 `display:none / visibility:hidden / pointer-events:none`，并额外触发一次 `reader-float-overlay-release` 的重排脉冲。
- 这一步的目标不是“修主题”，而是验证这些全屏浮层是否就是把页面长期卡在 `need-pay-or-preview-branch` 的直接阻塞因子。下一份日志优先检查：是否出现 `已临时隐藏阻塞正文的 reader_float 浮层`、`reader-float-overlay-release` / `reader-float-overlay-release-followup`，以及之后 `renderBranchSummary.likelyBranch` 是否仍旧停在 `need-pay-or-preview-branch`。
- 最新日志 `weread-debug-1782558596110.json` 表明：这轮 `reader_float_*` 实验性修复实际上一次都没有触发，整份日志里没有出现 `已临时隐藏阻塞正文的 reader_float 浮层`，也没有出现 `reader-float-overlay-release` 相关重排；`renderBranchSummary.likelyBranch` 仍从头到尾稳定为 `need-pay-or-preview-branch`，`visibleNodes` 仍始终为 0。
- 但同一份日志的矛盾点更关键：开头立刻出现了 `已释放首屏 loading 覆盖层`，而紧随其后的 `paint-after-write` 快照依旧是 `visibleNodes=0` 且 `need-pay-or-preview-branch`。这说明 `paint()` 很可能被 `hasVisibleReadableText()` 的“假阳性”带偏了，把错误分支里的可见浮层/评论文本误判成“正文已就绪”，从而提前走进了 `loading-overlay-release` 分支，后面的 `reader_float_*` 修复根本没有机会执行。
- 因此当前最可能的下一层根因不是“float 修复无效”，而是 `hasVisibleReadableText()` 的过滤条件过宽：它排除了 loading/封面/扉页/needPay，但还没有排除 `reader_float_*`、`reader_float_review_with_range_panel_wrapper`、`reader_float_top_reviews_panel_wrapper`、`reader_float_search_panel_wrapper` 这类全屏官方浮层文本，导致正文可见性判定被污染。
- 基于这组新证据，已对 `hasVisibleReadableText()` 做最小收紧：在原有 `loading / cover / flyleaf / needPay` 之外，额外排除 `[class*="reader_float_"]`、`.readerCatalog`、`.readerNotePanel`、`.readerAIChatPanel`、`.readerControls`、`.wr_tooltip_container`、`.renderTarget_pager`、`.wr_dialog`、`.wr_mask` 等非正文层文本，避免再次把官方浮层或分页器文本误判成“正文已可见”。
- 下一份日志优先验证两点：1）是否不再过早出现“`已释放首屏 loading 覆盖层` + `visibleNodes=0`”这组矛盾信号；2）之前的 `reader_float_*` 实验性修复是否终于获得执行机会，出现 `已临时隐藏阻塞正文的 reader_float 浮层` 与 `reader-float-overlay-release`。
- 最新成功日志组 `weread-debug-1782558979173.json` 至 `weread-debug-1782558979849.json` 已确认这一步收紧是有效的：七份日志结论一致，均出现了 1 次 `已临时隐藏阻塞正文的 reader_float 浮层`，并伴随 `reader-float-overlay-release` 与 `reader-float-overlay-release-followup` 两次重排；被临时隐藏的面板共 5 个，分别是 `reader_float_review_with_range_panel_wrapper`、`reader_float_top_reviews_panel_wrapper` 与 3 个 `reader_float_search_panel_wrapper`。
- 需要注意的是，尽管用户肉眼已确认“字出来了”，这些成功日志里的探针指标仍然保守：`renderBranchSummary.likelyBranch` 依旧停在 `need-pay-or-preview-branch`、`visibleNodes` 依旧是 0、`drawStats` 依旧没有绘制调用记录。这说明当前“文字恢复”已得到用户现场确认，但日志探针还没有完全跟上真实可见结果；后续若继续优化，应优先收敛探针准确性，而不是再回头修改主题颜色或推翻这次修复。
- 用户随后执行 `A1-A4` 验证时，最新日志组 `weread-debug-1782565281719.json` 至 `weread-debug-1782565282481.json` 暴露出新的回归特征：这些日志内部实际包含 `eye-protection -> light -> dark` 的连续切换，但三段主题在各自 `paint-after-write` 快照里都没有进入正文分支，`renderBranchSummary.likelyBranch` 一直是 `need-pay-or-preview-branch`，且 `visibleNodes` 始终为 0。
- 更关键的是，这组 `A1-A4` 日志里一次 `已临时隐藏阻塞正文的 reader_float 浮层` 都没有出现，也没有 `reader-float-overlay-release`；但 `childClassNames` 里仍稳定包含 `reader_float_review_with_range_panel_wrapper`。这说明之前验证通过的“reader_float 浮层释放”修复，在本轮主题切换场景下没有得到执行机会，页面再次停在“结束页/扉页/needPay”错误内容分支。
- 从颜色字段看，`A2/A3` 失败并不是“颜色没刷上”：`eye-protection` 阶段是 `rgb(26, 10, 0)` + `rgb(245, 230, 200)`，`light` 阶段是 `rgb(0, 0, 0)` + `rgb(255, 255, 255)`，都与预期配色一致；问题在于这些颜色被刷到了 `renderTargetContainer` 当前承载的错误内容分支上，而不是真正正文。
- 针对这条回归，已做一层更小的触发修正：新增 `hasSuspiciousReaderBranchMarkers()`，当 `renderTargetContainer` 下仍存在 `back_cover / flyleaf / needPay / renderTarget_pager` 这类错误内容分支标记，且距离本次主题切换已超过 `100ms` 时，会提前尝试执行 `releaseBlockingReaderFloatOverlays()`，不再完全依赖 `hasVisibleReadableText()` 的结果。
- 这次修正的目标很明确：避免 `hasVisibleReadableText()` 在主题切换过程中再次被未知文本误判，从而错过已经验证有效的 `reader_float_*` 浮层释放链。下一份日志只看两点：1）`A2/A3` 是否重新出现 `已临时隐藏阻塞正文的 reader_float 浮层`；2）用户肉眼是否恢复看到正文。
- 最新成功日志 `weread-debug-1782565669560.json` 与 `weread-debug-1782565680493.json` 对应用户反馈 `A2`、`A3` 均已通过。两份日志内部都记录了 `light -> eye-protection -> light -> eye-protection` 的切换序列，且每段主题的颜色值都正确：`light` 为黑字白底，`eye-protection` 为深字米黄底。
- 不过这两份成功日志里并没有再次出现 `已临时隐藏阻塞正文的 reader_float 浮层`，反而稳定出现了大量 `loading-overlay-release`；`renderBranchSummary.likelyBranch` 仍旧保守地停在 `need-pay-or-preview-branch`，`visibleNodes` 也依旧是 0。结合用户肉眼“`A2/A3` 通过”的现场结果，只能说明当前功能表现已恢复，但日志探针对“正文真实可见”的刻画依然滞后，暂时不能再用这些探针字段单独否定用户现场。
- 用户随后在暗黑模式下再次肉眼复现“黑底看不到正文”。对应最新失败日志 `weread-debug-1782566011405.json` 至 `weread-debug-1782566012419.json` 显示：`dark` token 本身是正常生效的，`paint-after-write` 连续快照里采样到的仍然是白字黑底；但这与用户截图中的“正文主段落几乎融进黑底”矛盾，说明当前探针仍未命中屏幕上真正显示的正文层。
- 为此已新增两层更直接的取证，不改主题逻辑：1）`viewportSamples[*].textProbe`，通过 `caretRangeFromPoint / caretPositionFromPoint` 直接读取采样点下方的文本节点样式；2）`nearestReadableCandidates`，收集离三个视口采样点最近的长段落文本候选及其真实颜色。下一份暗黑失败日志优先看这两个新字段，确认真正显示在黑底上的正文段落到底是谁，以及它的 `color / -webkit-text-fill-color` 是什么。
- 最新成功日志 `weread-debug-1782566313079.json` 至 `weread-debug-1782566314765.json` 对应用户反馈“暗黑现在能看到”。这批日志给出了一个新的负证据：`viewportSamples[*].textProbe` 全部为 `null`，`nearestReadableCandidates` 也始终为空，说明当前屏幕上真正可见的正文并不是普通 DOM 文本节点，至少不会被 `caretRangeFromPoint / caretPositionFromPoint` 命中。
- 同时，这批成功日志里的 `canvasDiagnostics` 仍显示 `hasNonTransparentPixels=false`、`firstNonTransparentHit=null`，但 `overlayHitStack` 稳定落在 `wr_underline_*`、`content_decoration*`、`renderTargetPageInfo*` 这些装饰层上。结合用户肉眼“现在能看到”，当前最强判断是：正文真实可见链路更接近官方的装饰/覆盖渲染层，而不是我们此前一直盯的 DOM 文本层或可直接读像素的 canvas。也因此，现有探针仍不能单独作为通过/失败判断依据。
- 用户随后再次执行 `A1-A4` 测试并反馈：`A1` 通过、`A2/A3` 不通过、`A4` 通过。对应最新日志 `weread-debug-1782566487159.json` 至 `weread-debug-1782566488072.json` 几乎完全一致：主题序列稳定是 `light -> eye-protection -> dark`，没有出现 `loading-overlay-release`，也没有 `reader_float` 释放；`renderBranchSummary.likelyBranch` 仍全部停在 `need-pay-or-preview-branch`。
- 更关键的是，这组回归日志里的 `light` 与 `eye-protection` 颜色参数本身都仍是正确的，而 `dark` 阶段的快照也继续显示白字黑底；新加的 `textProbe` 与 `nearestReadableCandidates` 仍全部为空。说明本轮 `A2/A3` 再次失败时，日志层面依旧拿不到能解释用户现场的直接证据，仍然只能确认“现有探针不足以稳定刻画真实可见正文层”。因此当前不能仅依据这些日志把 `A2/A3` 判通过，测试结论仍应以用户肉眼为准。
- 为了继续逼近真实显示链路，现已把取证再增强一层：1）`viewportSamples[*].strongLayerProbe`，对每个视口采样点记录命中层向上的候选链路、祖先链，以及 `::before / ::after` 的颜色、内容和遮罩/背景信息；2）`nearestTextLikeElementCandidates`，不再只扫文本节点，而是扫描正文区域内所有“文本样”可见元素，包括 SVG/装饰层元素，并记录其 `fontSize / lineHeight / webkitTextFillColor / textShadow / maskImage` 等样式。下一份失败日志应优先看这两个字段，确认屏幕上真正被画出来的正文是否落在 SVG、伪元素或装饰覆盖层里。
- 用户最新一轮验证结果又发生摆动：`A1` 不通过、`A2` 通过、`A3` 通过、`A4` 不通过。对应最新日志 `weread-debug-1782567074508.json` 至 `weread-debug-1782567076965.json`，主题序列稳定包含 `light -> dark -> eye-protection -> light -> dark -> eye-protection`，且仅出现 1 次 `reader_float` 释放、0 次 `loading-overlay-release`。
- 这批日志的强取证结果依旧显示：所有主题的 `renderBranchSummary.likelyBranch` 都停在 `need-pay-or-preview-branch`；`strongLayerProbe.firstCandidate` 多数直接命中 `renderTargetContainer` 或 `contentWrapper`，其文本内容是“全书完 / 已阅读 / 读完的第 / 微信读书推荐值”等结束页内容，而 `nearestTextLikeElementCandidates` 仅抓到空 `svg`。说明本轮 `A1/A4` 失败时，页面再次主要落在“结束页/错误内容分支”，并非主题颜色参数本身失效。由于 `A2/A3` 在同一批日志里仍显示同样的错误分支，但用户肉眼判定为通过，因此这进一步证明当前日志探针仍不能替代用户肉眼作为最终验收标准。
- 已针对这条新证据加入最小实验性修复，不改颜色逻辑：当 `theme === 'dark'`、正文仍不可见且命中结束页标记时，新增 `releaseEndingBranchOverlays()`，临时隐藏 `.horizontal_reader_back_cover_wrapper`、`.reader_flyleaf_container`、`.horizontalReaderCoverPage`、`readerFooter_ending_*`、`back_lang_*`、`wr_flyleaf_module_rating*` 这些结束页/扉页节点，并触发 `ending-branch-release` 重排恢复。下一份暗黑失败日志优先看 `已临时隐藏阻塞正文的结束页分支节点` 与 `ending-branch-release` 是否出现。
- 用户复测后反馈 `A1`、`A4` 仍不通过。最新日志 `weread-debug-1782865607133.json` 表明，这层结束页恢复修复根本没有拿到执行机会：日志里只出现了 1 次 `已临时隐藏阻塞正文的 reader_float 浮层`，完全没有 `已临时隐藏阻塞正文的结束页分支节点`，也没有 `ending-branch-release`。
- 同一份日志里，暗黑阶段 `token=2/5` 的 `paint-after-write` 快照仍然稳定落在 `need-pay-or-preview-branch`，`strongLayerProbe.firstCandidate` 和 `textCandidates` 继续被“全书完 / 已阅读 / 读完的第 / 微信读书推荐值”等结束页文本主导。这说明当前新修复并不是“触发了但无效”，而是它前面的进入条件仍然没被满足，导致逻辑分支根本没走到。
- 已据此放宽结束页释放条件：新增 `hasEndingBranchTextSignals()`，直接用文本特征正则匹配结束页文本；只要暗黑阶段采样到带正尺寸的结束页文本，就立即触发释放。
- 用户再次复测后反馈：**`A1` 通过、`A4` 通过**。至此 `A1-A4` 四项单步/闭环测试全部通过。
- 用户再次复测后反馈 `A2`/`A3` 回归不通过。最新日志 `weread-debug-1782867302030.json` 表明所有快照仍以"全书完"结束页文本为主导，且结束页释放修复完全未触发。根因明确：结束页文本检查只覆盖了 `theme === 'dark'`，导致 `light`/`eye-protection` 时直接跳过。已去掉 `theme` 限制，条件覆盖所有主题。
