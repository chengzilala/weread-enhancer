# 微信读书插件项目 - 会话记录

## 2026-06-13 会话条目：需求分析与方案设计 (完成)
- **目标**：根据用户提供的所有原型功能截图，1:1 还原其核心功能，整理需求文档和可行性方案。
- **已做**：
  - 阅读并确认理解了项目的 V1.0 全局开发规则。
  - 分析了商店截图及用户后续补充的 5 张完整功能设置细节大图。
  - 用户确认答疑方向：兼容 Chrome/Edge 标准、剔除无关广告、采用最全的快捷键体系接管。
  - 将所有需求彻底固化到 `implementation_plan.md`，明确了此版本为“直接在原始网页节点中注入悬浮操作面板”的技术形态，而非依赖浏览器的独立 Popup，以高度符合原设计美感。
  - 修改并推进了 `task.md` 的计划清单。
- **关键结论/决定**：
  - 核心架构彻底敲定：使用 Manifest V3 进行 Content Script 注入，由 `content.js` 操作 DOM 生成所有的 UI 表单。
  - 使用原生 HTML/CSS/JS 开发，零外部依赖保证速度极简。
- **产出物（文件/链接）**：
  - `implementation_plan.md`
  - `task.md`
- **风险/注意事项**：
  - 事件拦截（特别是在微信读书这样已有自身强控制的 WebApp）必须做精确防抖，避免滚轮上下造成连续无效翻页。

---

## 2026-06-13 会话条目：项目骨架与核心底座搭建 (进行中)
- **目标**：完成扩展包运行所需的基础配置与代码桩，让插件能够在浏览器里先“跑”起来进行本地调试。
- **已做**：
  - 完成 `manifest.json` 配置（Manifest V3）
  - 完成 `content.js` 基础 UI 框架（悬浮按钮 + 展开菜单）
  - 完成 `content.css` 样式（明亮/暗黑主题支持）
  - 完成 `README.md` 和 `Running.md` 文档
- **关键结论/决定**：
  - 采用 Content Script 注入方式，直接在微信读书页面内生成 UI
  - 使用原生 HTML/CSS/JS，零外部依赖
- **产出物（文件/链接）**：
  - `manifest.json`
  - `content.js`
  - `content.css`
  - `README.md`
  - `Running.md`
- **待办**：
  - 完成所有核心功能实现
  - 完善各设置面板

---

## 2026-06-25 会话条目：RPD 需求文档梳理 (已完成)
- **目标**：通读现有代码，梳理完整的产品需求文档（RPD），明确所有功能细节，为后续开发做准备。
- **已做**：
  - 通读所有现有文件，了解当前项目状态
  - 编写完成完整的 RPD 需求文档
- **关键结论/决定**：
  - 先完成需求文档，再开始代码开发
  - 核心功能分为：阅读设置、主题设置、自动阅读、快捷键、插件设置五大模块
  - 按 P0/P1 优先级分阶段开发
- **产出物（文件/链接）**：
  - `RPD_需求文档.md`
- **待办**：
  - 用户确认需求文档
  - 按阶段开始代码开发
- **风险/注意事项**：
  - 确保需求文档覆盖所有参考截图中的功能

---

## 2026-06-25 会话条目：阶段一 - 阅读设置开发 (已完成代码)
- **目标**：以最小原则，先完成「阅读设置」模块（屏占比调节功能），测试验证后再继续优化。
- **已做**：
  - 确认开发范围：屏占比调节
  - 实现阅读设置弹窗 UI
  - 实现屏占比滑块调节（50%-100%）
  - 实现数据持久化（chrome.storage.local）
  - 实现屏占比实时生效
- **关键结论/决定**：
  - 最小原则：先做屏占比调节，验证后再添加更多功能
  - 使用多个备选选择器尝试找到微信读书阅读区域
- **产出物（文件/链接）**：
  - 更新：`content.js`
  - 更新：`content.css`
- **待办**：
  - 用户测试验证功能
  - 根据测试结果调整 DOM 选择器
- **风险/注意事项**：
  - 微信读书页面结构可能变化，需要确认正确的 DOM 选择器

---

## 2026-06-25 会话条目：调试交互优化与日志系统 (已完成第一版)
- **目标**：先解决调试协作效率问题，为插件加入内置日志系统，减少依赖截图沟通。
- **已做**：
  - 确认当前问题根因之一是缺少稳定、可复用的运行时诊断信息
  - 在 `content.js` 中加入日志缓存、运行时错误捕获、页面结构采集、日志复制、日志下载
  - 在 `content.css` 中加入调试面板样式
  - 完成静态诊断检查，未发现新增语法错误
- **关键结论/决定**：
  - 先暂停继续猜测布局问题
  - 先建设“自动采集 + 一键复制/下载”的日志能力
- **产出物（文件/链接）**：
  - 更新：`content.js`
  - 更新：`content.css`
- **待办**：
  - 让用户用第一版日志系统采集一次真实页面日志
  - 基于真实日志再修阅读布局问题
- **风险/注意事项**：
  - 日志需要控制数量，避免占满本地存储

---

## 2026-06-25 会话条目：阶段一 - 阅读设置（屏占比）联调与验收 (已完成)
- **目标**：把「屏占比」做成可用、可解释、可验证的最小功能闭环。
- **已做**：
  - 将屏占比计算从“猜 DOM 结构”升级为“基于容器宽度的明确语义”（100% = 阅读区域容器宽度）
  - 增加基准模式迁移（旧 `screenBasePx` 自动失效并重算），避免升级后仍沿用旧基准导致“看起来无效”
  - 增加快捷按钮（100/90/80/70）避免拖动误差，点击后自动保存并采集诊断
  - 增加自动重排触发（resize/orientationchange），降低微信读书内部排版缓存导致的错乱概率
  - 通过运行日志验证：`screenBaseMode=container-v1`，100% 时内容宽度接近容器宽度
- **关键结论/决定**：
  - 屏占比的“百分比”必须定义清楚，否则会出现“100% 不对”的主观冲突
  - 以后所有布局类功能都必须配套：诊断快照 + 摘要输出
- **产出物（文件/链接）**：
  - 更新：`content.js`
  - 更新：`content.css`
- **待办**：
  - 进入下一阶段最小需求（待选：自动阅读 / 主题护眼 / 快捷键）

---

## 2026-06-25 会话条目：版本管理与 GitHub 归档方案计划 (已完成)
- **目标**：把当前"基础功能可用版"归档为一个可回滚版本，并同步到 GitHub，建立后续迭代的版本管理流程。
- **关键结论/决定**：
  - 版本号采用语义化简化规则：`v0.1.0`（当前稳定点）、`v0.1.1`（修复）、`v0.2.0`（新增核心模块）、`v1.0.0`（稳定发布）
  - 分支策略最小化：`main` 为稳定分支，功能开发用 `feature/*`；是否引入 `dev` 后续再定
  - 运行产物不入库：调试导出的 `weread-debug-*.json`、日志文件夹不提交
  - 文档与决策记录入库：`README.md`、`Running.md`、`session_log.md`、`RPD_需求文档.md`、`plan_github_versioning.md` 均随版本一起管理
  - 仓库名：`weread-enhancer`，可见性：`private`
- **执行记录**：
  - 1）已创建 `.gitignore`（忽略调试日志、日志目录、IDE 文件）
  - 2）已初始化 git 仓库，分支名 `main`
  - 3）已创建首次提交（`da8b001`），提交信息：`feat: 微信读书浏览器插件 v0.1.0 初始版本`
  - 4）已关联远端仓库 `https://github.com/chengzilala/weread-enhancer.git` 并推送 `main`
  - 5）已打 Tag `v0.1.0` 并推送至远端
  - 6）方案计划文档已单独保存为 `plan_github_versioning.md`
- **产出物（文件/链接）**：
  - 新建：`.gitignore`
  - 新建：`plan_github_versioning.md`
  - GitHub 仓库：https://github.com/chengzilala/weread-enhancer
- **待办**：
  - 后续可在 GitHub 上为 `v0.1.0` 创建 Release（附带 zip 产物）

---

## 2026-06-25 会话条目：工具栏浮动悬停功能 (已完成)
- **目标**：解决屏占比 ≥90% 时微信读书自带工具栏（目录、字号等）被推出视口的问题。鼠标移到感应区时对应工具栏淡入显示，移开后淡出隐藏。
- **关键结论/决定**：
  - 触发阈值：屏占比 ≥90% 时自动启用工具栏浮动模式
  - **顶部工具栏（readerTopBar）**：
    - JS 精确计算 pixel 位置（`(window.innerWidth - offsetWidth) / 2`），inline style 写死 left + width，`transform: none`
    - 默认 opacity:0，鼠标移到顶部 56px 感应区 → `wre-show-topbar` 类 → opacity:1
  - **右侧功能按钮（readerControls）**：
    - 经历多次迭代：CSS position:fixed → opacity-only → body margin → 最终用 `style.setProperty` inline style（最高优先级）覆盖原生 `margin-left: 548px`，改 `left: auto; right: 20px`
    - 保持原生 `position: absolute` 不动，确保字号/目录弹窗菜单定位正确
    - 默认 opacity:0，鼠标移到右侧 30px 感应区 → `wre-show-controls` 类 → opacity:1
    - 右侧感应区 z-index 设为 1（低于 controls 的 999999），controls 显示时同步绑 hover 事件防闪烁
  - **互不干扰**：两个独立感应区 + 独立 CSS 类名（`wre-show-topbar` / `wre-show-controls`），鼠标放哪边只显示哪边
  - 屏占比 <90% 自动移除浮动模式，还原原生布局
- **产出物（文件/链接）**：
  - 更新：`content.js`
  - 更新：`content.css`
  - 更新：`RPD_需求文档.md`（3.3.4 章节）

---

## 2026-06-25 会话条目：Edge 插件商店上架准备 (已完成)
- **目标**：将当前稳定版插件发布到 Microsoft Edge 加载项商店
- **已完成**：
  - 方案文档：`plan_edge_store.md`（完整步骤、审核备注模板、常见拒绝原因）
  - `manifest.json`：版本号 `1.0.0` → `0.2.0`，description 改为实际功能描述，添加 `icons` 字段
  - 图标：`icons/icon-16.png`（441B）、`icons/icon-48.png`（1010B）、`icons/icon-128.png`（2493B）— 蓝色圆形 + 白色 W 字
  - `privacy.md`：隐私政策声明（不收集数据、storage 权限用途、仅限 weread.qq.com）
  - `README.md`：更新为已实现功能描述 + 安装方式
  - `.gitignore`：新增 `*.zip`、`debug.log` 排除
  - 上架 zip 包：`release/weread-enhancer-v0.2.0.zip`（14795 bytes，6 个文件：manifest.json + content.js + content.css + 3 图标）
- **待用户执行**：
  - 截图：从 `screenshots/` 选取 2-3 张，裁剪为标准尺寸（1280x800 或 640x400），重命名为 screenshot-01.png 等
  - 注册 Edge Partner Center：https://partner.microsoft.com/dashboard
  - 上传 zip → 填写商店列表 → 粘贴中英文描述 → 上传截图 → 提交审核
  - 隐私政策 URL：`https://github.com/chengzilala/weread-enhancer/blob/main/release/privacy.md`

---

## 2026-06-26 会话条目：工具栏浮动优化 + Edge 商店上架归档 (v0.3.0)
- **目标**：完善工具栏浮动体验 + 提交 Edge 商店审核 + 目录结构整理
- **已完成**：
  - **动态检测触发**：从固定 90% 阈值改为 >85% + 动态元素溢出兜底，跨设备一致
  - **顶栏空间回收**：top 0 位置浮动，阅读内容不受影响，顶栏 opacity 0/1 原位透明/浮现
  - **Edge 商店上架**：提交审核（等待中），single purpose 适配、图标、截图、推广图、隐私政策全部就绪
  - **目录重构**：按 plan/dev/test/release/usage/screenshots/inbox 六大维度 + 根目录保留必选文件
  - **上架包**：`release/weread-enhancer-v0.2.0.zip`（6 文件，Python 生成，正斜杠路径，通过 Edge 校验）
- **产出物（文件/链接）**：
  - 更新：`content.js`、`content.css`、`README.md`、`manifest.json`
  - 新增：`icons/`、`release/privacy.md`、`DIR_STRUCTURE.md`（后合并入 README）
  - 仓库：[chengzilala/weread-enhancer](https://github.com/chengzilala/weread-enhancer)
- **里程碑**：
  - `v0.2.0` → `v0.3.0`（阅读设置 + 工具栏浮动稳定版，Edge 商店待审核）

---

## 2026-06-27 会话条目：主题文字颜色串色修复 (进行中)
- **目标**：修复主题切换后正文文字颜色残留，重点解决“明亮/护眼仍显示白字”的问题。
- **已做**：
  - 排查 `content.js` 的 `applyThemeColors(theme)`，确认此前只对第一个 `.readerChapterContent` 做文字重刷。
  - 将主题上色范围改为所有 `.readerChapterContent`，覆盖双页、预渲染或多正文节点场景。
  - 为正文节点及其子元素补充 `-webkit-text-fill-color` 同步，降低 `color` 已变更但实际文本仍沿用旧颜色的概率。
  - 将主题颜色观察范围从单个正文节点放宽到 `.app_content_in_reader`，避免新正文节点出现后未及时重刷。
  - 运行静态诊断，`content.js` 当前无新增语法/诊断错误。
- **关键结论/决定**：
  - 当前更像是“只刷中了第一个正文容器，用户正在看的那个容器没刷到”，而不是简单的颜色值写错。
  - 先用最小改动验证“多正文容器 + 文本填充色”这条路径，再根据新日志决定是否继续清理旧 inline style。
- **产出物（文件/链接）**：
  - 更新：`content.js`
- **待办**：
  - 让用户重新测试暗黑 → 明亮 → 护眼切换，并导出最新日志。
  - 若仍存在串色，再继续增加“切主题时清理旧 inline style”的处理。

- **追加进展（同日）**：
  - 基于最新日志确认：暗黑主题下正文颜色已是浅色，但官方主题按钮仍显示“深色”，说明官方实际仍停留在白天模式。
  - 将官方主题同步逻辑从“只看 `wr_whiteTheme`”改为“优先识别 `.readerControls_item.dark/.white` 与 tooltip 文案（深色/浅色）”。
  - 新增 `syncOfficialTheme(theme, reason)`：切换插件主题时按目标模式重试同步，并在状态不符时主动点击官方对应按钮。
  - 在 `MutationObserver` 的自动修正路径中也复用该同步逻辑，避免只修 body class、不修官方真实状态。
  - 继续收窄暗黑同步问题：为 `syncOfficialTheme()` 增加精细日志，记录点击前快照、切换 body class 后快照，以及点击官方按钮后 50/150/300ms 的状态检查。
  - 当前策略不再继续猜测“为什么没切过去”，而是要求下一份日志直接给出按钮类名、tooltip 文案和识别结果的时间序列。
  - 基于新日志最终确认：程序化点击官方主题按钮在当前页面环境下不生效，因此移除了 `content.js` 中整段官方主题自动同步逻辑。
  - 当前方案正式收敛为“插件独立控制背景与文字”，并同步更新主题面板提示文案与 `plan/主题需求梳理.md` 测试清单，删除“自动切官方夜间/白天”的旧承诺。
  - 运行静态诊断与文档残留检查，确认 `content.js` 无新增报错，文档中无残留“自动同步官方主题”表述。
  - 用户按新版清单测试后反馈：`A2`（明亮）与 `A3`（护眼）仍未通过。
  - 结合日志与代码判断，继续收敛为“暗黑主题遗留的白色 inline style 没有被彻底清理”这一方向。
  - 在 `applyThemeColors()` 中新增“清理上一次已刷样式”的逻辑，并把容器层的 `color / -webkit-text-fill-color` 也纳入统一重刷，避免从暗黑切回明亮/护眼时残留白字。
  - 按运行时调试流程新增 `debug-theme-residual-text.md` 与临时采样插桩，最终确认不是明亮/护眼失效，而是暗黑主题背景进入过慢。
  - 在主题容器层和顶栏补充 `transition: none !important` 与 `animation: none !important`，消除暗黑切换初期的错误过渡。
  - 用户最终确认修复成立；已移除本轮临时调试插桩，并清理调试会话文件。
  - 用户后续又反馈“暗黑字体看不到”，为避免误判，单独建立 `debug-dark-text-invisible-now.md` 做证据隔离。
  - 结合最新日志 `weread-debug-1782532193899.json` 与用户反馈，确认暗黑模式当前已恢复正常，后续问题继续聚焦 `A2/A3` 的明亮/护眼链路。
  - 基于 `debug-light-eye-white-text.md` 的运行时采样，确认 `A2` 明亮与 `A3` 护眼在最新复测中均表现正常，用户最终确认通过。
  - 已移除本轮明亮/护眼的临时采样插桩，并删除对应调试会话文件。
  - 已将 `plan/主题需求梳理.md` 中 `A1-A4` 更新为已通过状态，确保测试文档与当前结果一致。
-  用户在 `F1` 快速切换测试中继续反馈“暗黑正文看不见”；经多轮日志比对后确认，问题尚未证明出在主题切换链路，而是调试采样长期命中分页节点、浮层与工具栏。
-  当前已把 `debug-fast-switch-dark-text` 的取证策略升级为“换正文锚点”：不再盲扫 `readerChapterContent *`，改为跳过工具栏/tooltip/顶栏，并优先抓取长文本、无交互控件、无更长子文本的叶子节点，准备让下一份日志直接命中真正正文段落。
-  最新一轮日志显示“长文本叶子节点”筛选过严，`sampledNodeCount` 长时间为 0；因此继续收敛为“正文文本节点取样”，直接遍历 `.readerChapterContent` 内可见文本节点，再回溯到宿主元素记录颜色，避免再次把真正正文全部过滤掉。
-  由于“正文文本节点取样”在当前页面结构下仍未命中正文，继续补充子树结构取证：为 `.readerChapterContent` 输出前两层子节点摘要（`tag/class/textLength/sampleText`），下一份日志先用来定位正文究竟挂在哪个容器上。
-  针对用户最新反馈“暗黑正常，但明亮/护眼还是白字”，新开 `debug-fast-switch-light-eye-white-text.md` 独立会话；本轮仍不动业务逻辑，只新增 `mismatchCandidates` 取证，准备直接定位 `light / eye-protection` 下仍为白字的可见节点及其残留 inline 样式来源。
-  用户确认自己始终在正文页后，重新审视最新日志，判断问题不在“用户复现场景错误”，而在于当前探针仍未命中真正显示出来的正文文字；因此继续只改插桩，将取证范围改为 `renderTargetContainer` 内真实文本节点，并用 `Range.getBoundingClientRect()` 判断文本是否真正可见，避免被宿主元素 `height=0` 误过滤。
-  用户反馈“日志现在输出特别多”，因此继续只调整调试插桩体积：`fast-switch snapshot` 缩减为单个正文区域、少量命中文本节点与少量冲突候选；只有在完全没命中正文时，才额外输出一份精简 `subtreeSummary` 兜底。
-  最新精简日志仍显示：`light / eye-protection` 的容器级颜色正常，但 `sampledNodeCount` 与 `mismatchCandidateCount` 依旧为 0，说明问题已收敛为“探针没有打到真正显示出来的正文文字”；因此继续只改插桩，新增视口命中采样，从正文区域中心/左中/右中三个点用 `elementsFromPoint()` 直接反查屏幕上真正显示的元素颜色。
-  继续分析最新 `dark` 失败日志 `weread-debug-1782536572816.json` 后确认：`token` 与白字刷色本身都正常，`paint-after-write` 阶段的 `renderTargetContainer` 已是白字；但视口命中的实际页面层落在 `renderTargetContainer` 下的封面 / 尾页 / 试读结束容器，这些层此前没有统一跟随主题背景切换，因而更接近“白字压在浅色页面层上”的问题，而非文字未刷色。
-  针对上述结论，已在 `content.js` 中把主题背景覆盖范围从外层正文容器扩展到 `renderTargetContainer`、其直接页面层，以及 `horizontal_reader_back_cover_wrapper`、`reader_flyleaf_container`、`horizontalReaderCoverPage`、`*needPay_container*` 等特殊页面容器；静态诊断已确认无新增报错，等待用户重新复测暗黑可见性。
-  用户最新复测反馈“现在所有模式都看到字了”；对应日志 `weread-debug-1782537150206.json` 也显示 `dark / light / eye-protection` 三种主题均出现了正确的背景与文字组合：暗黑为 `rgb(18, 18, 18) + rgb(255, 255, 255)`，明亮为 `rgb(255, 255, 255) + rgb(0, 0, 0)`，护眼为 `rgb(245, 230, 200) + rgb(26, 10, 0)`，且旧 token 会被正确跳过，说明本轮“文字不可见”问题已收敛。
-  由于该日志后半段还存在一次额外的护眼切换，当前足以确认“三种模式都能看见字”，但若要严格勾选 `F1 | 暗黑 -> 护眼 -> 明亮 -> 暗黑`，仍建议以一份只包含这条测试路径的日志或用户口头确认作为最终凭据。
-  随后用户再次反馈“直接打开网页就没有文字”；最新失败日志 `weread-debug-1782538198883.json` 证实初始化恢复主题本身正常，首屏已立即切到 `wre-theme-dark`，但 `paint-after-write` 顶层命中的是全屏绝对定位的 `readerChapterContentLoading`，而之前“可见”日志没有该层，问题更接近官方加载层卡住而非文字颜色刷错。
-  基于上述证据，已在 `content.js` 中加入最小修复：新增 `hasVisibleReadableText(root)` 用于判断正文是否已真正就绪；正文重刷时跳过 `.readerChapterContentLoading` 子树；若正文已就绪但 loading 层仍存在，则主动将其隐藏并触发一次 `scheduleWereadLayoutReflow('loading-overlay-release')`，等待用户按“重载插件 -> 直接打开阅读页”路径重新验证。
-  用户复测后仍然复现；继续分析修复后日志 `weread-debug-1782538831881.json`，确认 `readerChapterContentLoading` 依旧长时间停留在 `hitStack[0]`，且没有出现“已释放首屏 loading 覆盖层”日志，说明先前“正文已就绪再释放”条件根本没有被满足。
-  因此将策略进一步收窄为“超时释放卡住的空 loading 层”：在 `applyThemeColors()` 启动 300ms 后，如果 `.readerChapterContentLoading` 仍是大尺寸、空文本、覆盖正文区域的顶层元素，则直接隐藏该层并触发 `scheduleWereadLayoutReflow('loading-overlay-timeout-release')`，避免继续被永久卡在空白首屏。
-  最新日志 `weread-debug-1782539191856.json` 证实“超时释放卡住的 loading 层”已经执行成功，但同时暴露出新的调试误差：由于 `body` 挂着 `wre-theme-dark` / `wre-toolbar-floating` 等类，上一轮用于排除插件 UI 的 `wre-*` 过滤把正文容器也误判为噪音，导致 `hitFound=false`、`isNoise=true` 的结果不可信。
-  已将采样过滤修正为只排除真正的插件 UI 元素（如 `#we-read-enhancer-root`、`[id^="wre-"]`、`.wre-modal*`、`.wre-slider` 等），不再因 `body` 主题类误伤正文层；等待用户再导一份最新日志验证真实命中层。
-  继续分析最新日志 `weread-debug-1782539514953.json` 后确认：`sizedDescendants` 仍始终为 0，但这份失败日志与此前“看得到字”的日志在容器级结构上几乎完全一致，包括 `screenRatio=100`、`.app_content_in_reader=0x0`、`readerChapterContent`/`readerChapterContent_container` 尺寸正常，因此当前容器级采样已无法区分“可见”与“不可见”现场。
-  为避免继续被祖先容器的混合 `textContent` 误导，已在 `content.js` 中新增 `textCandidates` 取证：即使文本节点的 `Range rect` 为 0，也会记录其父元素类名、文本摘要、rect 与关键样式。下一份日志将直接用来判断真实章节文本是“存在但被压成 0/移出视口/透明”，还是压根没有进入渲染树。
-  最新日志 `weread-debug-1782555619903.json` 已证实：新增的 `textCandidates` 前 8 个候选全部来自 `readerFooter_ending_time`、`back_lang_title`、`wr_flyleaf_module_rating_*` 等结束页/扉页层，且 `rect` 全部为 `0x0`；同时 `visibleNodes=0`、`sizedDescendants=0`。这说明当前失败现场下，`renderTargetContainer` 中没有被探测到任何真实章节段落节点，至少前排渲染树里只剩结束页/扉页/试读提示等隐藏层文本。
-  据此判断，当前更像“正文章节层未进入可见渲染树或切到了错误内容分支”，而不是主题颜色继续刷错。后续排查应转向确认 `renderTargetContainer` 直接子层的真实类名/尺寸与官方内容分支，而非继续围绕颜色覆盖做盲修。
-  最新日志 `weread-debug-1782556138320.json` 进一步证实：`wr_canvasContainer` 下两块 canvas 已生成且尺寸正常，但中心/左中/右中三个像素采样全部为透明 RGBA；同时 canvas 上方仍稳定压着 `wr_underline*` 与 `content_decoration_wrapper*` 等官方装饰层，说明当前主因已进一步收敛为“官方 canvas 渲染链路异常或渲染时机滞后”，而非插件文字颜色刷错。
-  为验证 canvas 是“始终透明”还是“稍后才画出内容”，已在 `applyThemeColors()` 启动后新增固定时间点 `16/80/200/500/1000/1800ms` 的 `canvas-timeline-*` 快照，沿用现有 `fast-switch snapshot` 与 `canvasDiagnostics` 结构。下一份日志将直接用于比对 canvas 像素何时由透明转为非透明，以及这段时间内上方 `loading / decoration` 覆盖链是否变化。
-  最新两份日志 `weread-debug-1782556547268.json` 与 `weread-debug-1782556546796.json` 进一步收敛为时序问题：在 `500ms`、`1000ms` 这两个快照时点，`canvasDiagnosticCount` 仍然为 0，说明首屏前 1 秒内根本没有进入可诊断的 canvas 渲染状态；直到更后面的 `paint-after-write` 与 `canvas-timeline-1800ms` 段才首次出现两块 canvas。
-  但这两块 canvas 即使出现后，`rect` 仍为 `0x0`，且像素采样仍全部为透明 RGBA；这说明当前问题更接近“官方 canvas 渲染链路启动晚且仍未真正画出内容”。同时，日志后半段中心视口又被 `wre-debug-output / wre-modal-*` 调试弹窗污染，因此这些日志适合判断 canvas 出现时机，不再适合继续判断最终肉眼可见的顶层覆盖链。
-  已在 `content.js` 的 `canvasDiagnostics` 中继续补充最小取证：新增 `parentChain` 记录每块 canvas 向上最多 5 层父容器的类名与尺寸/样式状态；新增 `hasNonTransparentPixels`、`nonTransparentSamples` 与 `firstNonTransparentHit`，按 `token + canvas 索引` 记住该 canvas 第一次出现非透明像素的阶段与相对启动耗时。下一份日志将用于确认 canvas 首次挂载在哪个父层下，以及它是否会在更晚阶段真正画出内容。
-  最新日志 `weread-debug-1782556812828.json` 与 `weread-debug-1782556811906.json` 已把根因进一步前移：两块 canvas 虽已创建，但始终没有任何非透明像素；同时 `parentChain` 明确显示它们挂在 `wr_canvasContainer -> 匿名层 -> renderTargetContainer` 之下，而这个 `renderTargetContainer` 的计算样式反复为 `display:none`。因此当前问题更接近“官方把承载 canvas 的根容器隐藏了”，而不再只是“canvas 启动晚/没画出来”。
-  基于这一证据，已在 `paint()` 中加入最小实验性修复：当 `probeRoot` 命中 `.renderTargetContainer` 且其计算样式为 `display:none` 时，直接强制该节点及其直接父层恢复 `display:block / visibility:visible / opacity:1`，并触发一次 `scheduleWereadLayoutReflow('render-target-force-visible')`。等待用户按最短路径复测，确认正文是否因此恢复可见。
-  用户按“重载插件 -> 直接打开阅读页”复测后仍反馈“正文文字没有出现”；最新三份日志 `weread-debug-1782557187564.json`、`weread-debug-1782557188202.json`、`weread-debug-1782557188340.json` 彼此结论一致：都出现了 1 次 `已强制恢复隐藏的 renderTargetContainer`，并且后续再没有任何 `renderTargetContainer display:none` 的记录，说明这次“强制恢复可见”修复确实已执行并生效。
-  但同一批日志也同时表明：即便 `renderTargetContainer` 已恢复为 `display:block`，两块 canvas 的 `hasNonTransparentPixels` 仍始终为 `false`、`firstNonTransparentHit` 仍始终为 `null`；横向比对三份日志都没有出现任何非透明像素样本。这说明“容器被隐藏”已不再是最后一层根因，问题继续收敛为“canvas 渲染链路本身没有真正产出可见像素”。
-  此外，最新失败日志的顶层命中已从先前的 `readerChapterContentLoading` / 装饰覆盖层，收敛为多数时间直接命中 `renderTargetContainer` 本身，说明当前肉眼空白并不是再次被 loading 或 `display:none` 直接挡住，而更像是一个已经可见、但内容仍为空的渲染承载层。
-  基于上述新结论，本轮继续遵守“最小原则”，未再改主题或布局业务逻辑，只在 `content.js` 的调试链路中补了两类状态：其一是 `canvasDiagnostics[*].drawStats / lifecycle / canvasId`，用于确认官方是否真的对每块 canvas 发生过绘制调用、是否存在频繁重建/尺寸变化/父层切换；其二是 `renderBranchSummary`，将当前 `renderTargetContainer` 归纳为更易读的 `likelyBranch`（如 `cover-or-ending-branch`、`need-pay-or-preview-branch`、`canvas-present-but-transparent` 等）。
-  下一轮拿到新日志后，排查顺序将进一步收窄为：先看 `drawStats.totalCalls` 是否长期为 0；若不为 0，再看 `recentCalls` 与 `callsByMethod` 判断官方是否在“画了又清空”；同时结合 `lifecycle.parentChangeCount` 和 `renderBranchSummary.likelyBranch` 判断是否其实一直停在错误内容分支。这一步仍属于纯取证，不代表已确认具体修复方案。
-  用户继续按“重载插件 -> 直接打开阅读页”路径复测，结果仍然“没字”；最新四份日志 `weread-debug-1782558006852.json`、`weread-debug-1782558007483.json`、`weread-debug-1782558007608.json`、`weread-debug-1782558007721.json` 给出了目前最强的新证据：`renderBranchSummary.likelyBranch` 在整轮采样中稳定为 `need-pay-or-preview-branch`，而不是 `canvas-present-but-transparent`。这说明当前页面根容器并没有进入“正文章节渲染分支”，而是一直停在试读/预览相关内容路径。
-  同时，这四份日志中即便后期再次出现了 2 块 canvas，`drawStats` 仍完全为空，说明官方没有对这些 canvas 发起任何可观测的 2D 绘制调用；再结合 `directChildLayers` 持续出现 `wr_horizontal_reader_needPay_container*`、`horizontal_reader_back_cover_wrapper`、`reader_flyleaf_container`、`horizontalReaderCoverPage`，以及多块全屏 `reader_float_*` 浮层，可将当前问题进一步收敛为“页面停在错误内容分支/浮层态”，而不是单纯的主题、遮罩或 canvas 像素问题。
-  基于这一最新结论，已在 `content.js` 中加入最小实验性修复：当 `paint()` 发现正文仍不可见且 `reader_float_*` 面板以大尺寸覆盖阅读区时，临时将这些面板隐藏，并通过 `triggerWereadBranchRecovery('reader-float-overlay-release')` 立即 + 延迟各触发一次页面重排，目的是验证这些官方浮层是否正是把页面卡在 `need-pay-or-preview-branch` 的阻塞因子。当前仍未触碰主题颜色逻辑，等待用户复测和新日志验证。
-  用户复测后最新日志 `weread-debug-1782558596110.json` 显示：这轮 `reader_float_*` 实验性修复一次都没有触发，日志中没有 `已临时隐藏阻塞正文的 reader_float 浮层`，也没有 `reader-float-overlay-release` 相关重排；但开头却立刻出现了 `已释放首屏 loading 覆盖层`，而随后快照仍是 `visibleNodes=0` 且 `renderBranchSummary.likelyBranch=need-pay-or-preview-branch`。这说明当前更可能是 `hasVisibleReadableText()` 被错误分支中的官方浮层文本误判为“正文已就绪”，从而提前走到了 loading 释放分支，导致后续 float 修复压根没有执行机会。下一步应优先收窄 `hasVisibleReadableText()` 的过滤范围，排除 `reader_float_*` 等官方全屏浮层，再复测。
-  已按上述判断对 `hasVisibleReadableText()` 做最小收紧：新增排除 `[class*="reader_float_"]`、`.readerCatalog`、`.readerNotePanel`、`.readerAIChatPanel`、`.readerControls`、`.wr_tooltip_container`、`.renderTarget_pager`、`.wr_dialog`、`.wr_mask` 等非正文层文本，目的是防止“正文可见性”再次被官方浮层或分页器文本污染。当前不再扩展其他逻辑，等待用户复测验证该改动是否能让后续 `reader_float_*` 修复真正触发。
-  用户复测后确认“字出来了”；对应最新成功日志组 `weread-debug-1782558979173.json` 至 `weread-debug-1782558979849.json` 也首次给出稳定的运行时证据：每份日志都出现了 1 次 `已临时隐藏阻塞正文的 reader_float 浮层`，并触发 `reader-float-overlay-release` 与 `reader-float-overlay-release-followup` 两次重排，实际隐藏了 5 个全屏 `reader_float_*` 面板。由此可确认，本轮“收紧正文可见性判定 + 释放 reader_float 浮层”这条修复链已经真正跑通，并与用户肉眼恢复可见相一致。
-  不过同一批成功日志也暴露出新的取证缺口：`renderBranchSummary.likelyBranch` 仍显示 `need-pay-or-preview-branch`，`visibleNodes` 仍为 0，`drawStats` 也没有记录到 canvas 绘制调用。说明日志探针对“正文已恢复可见”的刻画仍滞后于用户现场。当前应把“肉眼恢复可见”视为本轮修复成立的最高优先级结论；若后续还需继续调试，应优先优化探针准确性，而不是回滚这次修复。
-  用户继续执行 A1-A4 测试后反馈：`A1` 通过、`A2/A3` 不通过、`A4` 通过。对应最新日志组 `weread-debug-1782565281719.json` 至 `weread-debug-1782565282481.json` 内部实际记录了 `eye-protection -> light -> dark` 三段连续切换，但三段在 `paint-after-write` 快照里都仍停在 `need-pay-or-preview-branch`，`visibleNodes` 始终为 0，且没有一次 `已临时隐藏阻塞正文的 reader_float 浮层` / `reader-float-overlay-release` 触发。
-  这说明 `A2/A3` 当前失败的直接原因不是主题配色本身错误，而是主题切换场景下页面再次卡回“结束页/扉页/needPay”错误内容分支，同时之前已经验证有效的 `reader_float` 浮层释放修复没有得到执行机会。日志中的 `eye-protection` 与 `light` 颜色值本身是正确的，问题发生在内容分支而非颜色参数。
-  已据此补一层最小触发修正：新增 `hasSuspiciousReaderBranchMarkers()`，当 `renderTargetContainer` 下仍存在 `back_cover / flyleaf / needPay / renderTarget_pager` 这类错误内容分支标记，且本次主题切换已超过 `100ms` 时，就提前执行一次 `releaseBlockingReaderFloatOverlays()`，不再把 `reader_float` 释放完全绑在 `hasVisibleReadableText()` 之后。目的是让之前已经验证有效的浮层释放链在 A2/A3 切换场景下也能拿到执行机会。
-  用户随后复测反馈：`A2` 通过、`A3` 通过。对应最新成功日志 `weread-debug-1782565669560.json` 与 `weread-debug-1782565680493.json` 记录了 `light -> eye-protection -> light -> eye-protection` 的切换序列，主题配色值都正确；但日志层面没有再次捕获 `reader_float` 释放，而是持续出现 `loading-overlay-release`，`renderBranchSummary.likelyBranch` 仍停在 `need-pay-or-preview-branch`，`visibleNodes` 仍为 0。当前应以用户肉眼通过结果作为 A2/A3 已恢复的最高优先级结论，并明确日志探针对“正文可见”仍存在滞后和保守偏差。
-  用户继续反馈暗黑模式下“黑色看不到文字”，并提供截图显示页码/标题仍可见但正文主段落几乎融入黑底。最新失败日志 `weread-debug-1782566011405.json` 至 `weread-debug-1782566012419.json` 中，`dark` token 的 `paint-after-write` 快照仍显示白字黑底，和用户现场矛盾，说明当前探针没有命中屏幕上真正显示的正文层。
-  已据此补一层最小取证：在 `collectFastSwitchSnapshot()` 中新增 `viewportSamples[*].textProbe`，通过 `caretRangeFromPoint / caretPositionFromPoint` 直接读取采样点下方的文本节点样式；同时新增 `nearestReadableCandidates`，收集离视口采样点最近的长段落候选及其真实颜色。下一步只需让用户在暗黑失败现场导出新日志，再看这两个新字段来确认真实可见正文层的颜色来源。
-  用户随后反馈暗黑模式“能看到”。对应最新成功日志 `weread-debug-1782566313079.json` 至 `weread-debug-1782566314765.json` 中，新加的 `viewportSamples[*].textProbe` 全部为空，`nearestReadableCandidates` 也为空；与此同时 `canvasDiagnostics` 仍显示 `hasNonTransparentPixels=false`，但 `overlayHitStack` 稳定命中 `wr_underline_*`、`content_decoration*`、`renderTargetPageInfo*` 等装饰层。由此可进一步确认：屏幕上真实可见的正文并不是普通 DOM 文本，也未必落在当前可直接取像素的 canvas 采样点上，而更可能走了官方装饰/覆盖渲染链路。当前日志探针仍不能脱离用户肉眼结果独立判断通过/失败。
-  用户再次执行 A1-A4 验证后反馈：`A1` 通过、`A2/A3` 不通过、`A4` 通过。对应最新日志 `weread-debug-1782566487159.json` 至 `weread-debug-1782566488072.json` 高度一致：都记录了 `light -> eye-protection -> dark` 三段切换，但没有一次 `loading-overlay-release` 或 `reader_float` 释放，`renderBranchSummary.likelyBranch` 也始终停在 `need-pay-or-preview-branch`。
-  与前几轮一样，这组回归日志里 `light/eye-protection/dark` 的颜色参数看上去都正常，新增的 `textProbe` 与 `nearestReadableCandidates` 也依然为空，依旧无法直接解释用户肉眼为何判定 `A2/A3` 失败。当前能确认的是：现有探针仍然不足以稳定描述真实可见正文层，因此 A2/A3 的通过/失败仍应继续以用户肉眼结果为最终判断依据。
-  已继续增强运行时取证，但仍不改主题业务逻辑：在 `collectFastSwitchSnapshot()` 中新增 `viewportSamples[*].strongLayerProbe`，记录每个视口采样点命中层向上的候选链、祖先链，以及 `::before / ::after` 的内容与颜色；同时新增 `nearestTextLikeElementCandidates`，扫描正文区内所有“文本样”可见元素，包括 SVG/装饰层元素，并记录 `fontSize / lineHeight / webkitTextFillColor / textShadow / maskImage` 等样式。下一步只需让用户再次在失败现场导出日志，再优先看这两个新字段，确认真实正文是否走了 SVG、伪元素或装饰覆盖渲染链路。
-  用户最新一轮验证反馈变为：`A1` 不通过、`A2` 通过、`A3` 通过、`A4` 不通过。对应最新日志 `weread-debug-1782567074508.json` 至 `weread-debug-1782567076965.json`，主题序列稳定包含 `light -> dark -> eye-protection -> light -> dark -> eye-protection`，仅触发 1 次 `reader_float` 释放，且没有任何 `loading-overlay-release`。
-  这批日志里所有主题的 `renderBranchSummary.likelyBranch` 仍停在 `need-pay-or-preview-branch`，`strongLayerProbe.firstCandidate` 主要命中 `renderTargetContainer` / `contentWrapper`，可见文本是“全书完 / 已阅读 / 读完的第 / 微信读书推荐值”等结束页内容；`nearestTextLikeElementCandidates` 仍只抓到空 `svg`。因此可确认：本轮 `A1/A4` 失败时页面再次主要落在错误内容分支，而不是主题颜色参数本身错误；但由于 `A2/A3` 在同一批日志下仍被用户肉眼判定为通过，进一步说明当前探针仍不能独立替代用户现场结果。
-  已据此加入一层最小恢复修复：当 `theme === 'dark'`、正文仍不可见且命中结束页标记时，新增 `releaseEndingBranchOverlays()`，临时隐藏 `.horizontal_reader_back_cover_wrapper`、`.reader_flyleaf_container`、`.horizontalReaderCoverPage`、`readerFooter_ending_*`、`back_lang_*`、`wr_flyleaf_module_rating*` 等结束页/扉页节点，并触发 `ending-branch-release` 重排。下一步只需让用户复测 `A1/A4`，再看日志里是否出现 `已临时隐藏阻塞正文的结束页分支节点` 与 `ending-branch-release`。
-  用户复测后反馈 `A1`、`A4` 仍不通过。最新日志 `weread-debug-1782865607133.json` 中，仅出现 1 次 `已临时隐藏阻塞正文的 reader_float 浮层`，没有任何 `已临时隐藏阻塞正文的结束页分支节点`，也没有 `ending-branch-release`。说明新加的结束页恢复修复这次根本没得到执行机会。
-  同一份日志里，暗黑阶段 `paint-after-write` 快照仍稳定停在 `need-pay-or-preview-branch`，`strongLayerProbe.firstCandidate` 与 `textCandidates` 继续被“全书完 / 已阅读 / 读完的第 / 微信读书推荐值”等结束页文本主导。因此当前更准确的结论是：这层修复前面的进入条件还不够宽
-  已据此放宽条件：新增 `hasEndingBranchTextSignals()`，直接用文本特征正则匹配结束页文本。用户再次复测后反馈：**`A1` 通过、`A4` 通过**。至此 `A1-A4` 四项单步/闭环测试全部通过。
-  用户再次复测后反馈 `A2`/`A3` 回归不通过。最新日志 `weread-debug-1782867302030.json` 表明图片页仍以"全书完"结束页文本为主导，且任何修复都未触发（`hits: {}`）。根因已明确：结束页文本检查只在 `theme === 'dark'` 时执行，但 `A2` 是 `light`、`A3` 是 `eye-protection`，所以修复跳过了。
-  已去掉 `theme === 'dark'` 限制，使结束页分支释放条件覆盖所有主题。
-  用户再次复测：`A1/A4` 不通过，`A2/A3` 通过，交替成败模式持续。经分析确认根本原因是 canvas 渲染时序 vs JS 刷色时序的竞争：`intervals = [0,30,100,300,800,2000]ms` 的延迟队列无论如何调整，都无法稳定覆盖 canvas 的实际绘制时刻。因此决定转向纯 CSS `filter` 方案，不再逐元素刷 inline style。
-  已实施 filter 方案重构：
  -  在 `wreThemeColors` 中为三种主题新增 `filter` 属性：`dark: invert(1) hue-rotate(180deg)`、`eye-protection: sepia(0.4)`、`light: none`
  -  从 `wreThemeBackgroundSelector` 移除 `.renderTargetContainer` 和 `.renderTargetContainer > div`，改为在所有主题 CSS 中统一注入 `background: transparent !important`
  -  扩展 `wreThemeCSS`，为每个主题新增 `.renderTargetContainer, canvas { filter: ... !important }` 规则
  -  大幅简化 `applyThemeColors`：移除 token 竞争机制、MutationObserver、6 级延迟 paint、所有调试快照和分支恢复逻辑；仅保留 `clearLastPaintedThemeStyles` + 顶层 DOM 文字 inline 刷色
  -  正文文字颜色现在完全由 CSS `filter` 处理，随 body class 切换即时生效，无时序竞争
  -  后续修复过程中发现 CSS filter 规则需包含 `.wr_canvasContainer`（canvas 的实际父容器），且 `clearLastPaintedThemeStyles` 需清理 `filter` 属性防止残留
  -  JS 级 filter 改为往 `wr_canvasContainer` 父层挂 inline filter，配合 100/400/1000/2000ms 延迟兜底处理 canvas 晚创建
  -  **最终验证结果（2025-07-01）：`A1-A4` 全部通过，`F1` 快速连续切换通过。filter 方案稳定生效，canvas 响应延迟问题已从根本上解决。**

---

## 2026-09-27 会话条目：P0 收尾（去死码 + 行尾归一 + 文档纠错）(已完成)
- **目标**：按「项目现状分析」给出的 P0 执行顺序，把仓库从"欠账"状态收回干净可回溯状态（不引入新功能）。
- **已做**：
  - 清理 `content.js` 死调试代码 1286 行（3468 → 2182 行）：删除 `collectFastSwitchSnapshot`（约 907 行）、canvas 调试钩子（`installCanvasDebugHooks`/`recordCanvasDrawCall`/`getCanvasDebugId`）、`scheduleCanvasTimelineSnapshots`，以及 `hasVisibleReadableText`/`release*Overlays`/`revealHiddenRenderTargetContainer` 等**已无调用点**的分支恢复函数；同时移除仅被它们引用的 7 个模块级变量（`wreCanvas*`/`wreThemeTokenStartTimes`）与未使用的 `wreColorObserver`/`wreColorLastSet`。`applyThemeColors`（CSS filter 方案）与日志系统保持不变；IDE 诊断无报错、全文 grep 无残留引用。
  - 新增 `.gitattributes`（`* text=auto eol=lf` + 二进制白名单），并将 `content.js` 从 CRLF 归一为 LF，消除"整文件幽灵 diff"（diff 从 3468 行噪声降为 `0 插入 / 1286 删除`）。
  - 归档 4 个调试会话文件到 `dev/debug-archive/`，并把 `debug-fast-switch-dark-invisible.md` 状态从 `[OPEN]` 更正为 `[RESOLVED / 已归档]`（该问题随 filter 重构后 A1–A4/F1 已通过）。
  - 文档纠错：修正 18 处过期路径（`…/ChesterObsidian/Coding/…` → `…/Knowledge/Coding/…`，5 个文件）；`dev/log.md` 的 Windows 下载路径改为 macOS `~/Downloads/`；`plan/主题需求梳理.md` 暗黑色值对齐代码 `#121212` / `#ffffff`；`README.md` 删掉代码中不存在的 `T（切换主题）` 快捷键（以 `handleAllKeyboard` 为准：空格 / D / F / ?）；`RPD_需求文档.md` 的 `T` 快捷键标注为"待新增"、头部版本澄清为"文档 v0.7（对应产品 v0.8.1）"。
  - 修复快捷键 `?`：中文输入法**全角**或**组词**状态下 `?` 实际为 `？`（`event.key` 不匹配），导致「快捷键说明」帮助面板打不开；改用物理键 `Slash` + Shift 兜底识别 `?`/`？`，并新增 `event.isComposing` 守卫避免打断拼音输入（回归 R5 待复测）。
- **关键结论/决定**：
  - `content.js` 减重约 37%，纯删死码、不改任何运行逻辑；主题仍为 CSS filter 方案，诊断日志系统保留（`?` 面板）。
  - 收尾三原则：**代码为准**（快捷键/域名/权限先 grep 再写）、**纯删不加**（不借清理之名改逻辑）、**可回溯**（调试文件归档而非直接删）。
- **产出物（文件/链接）**：
  - 更新：`content.js`（-1286 行）、`README.md`、`plan/主题需求梳理.md`、`plan/RPD_需求文档.md`、`dev/log.md`、`usage/GitHub操作手册.md`、`plan/plan_github_versioning.md`、`plan/plan_360_store.md`、两份 `plan/session_handoff_*.md`
  - 新建：`.gitattributes`、`dev/debug-archive/`（含 4 个归档调试文件）
  - 规则/文档：`.trae/rules/general_rules.md`（母本 / 工作区 / 项目三份同步）新增「需求实时回灌文档」条款；`plan/RPD_需求文档.md` 在 3.5.2 增加「输入法兼容」需求，并新增「附：文档变更记录」章节记录本次回灌
- **待办**：
  - 用户确认后统一提交（工作区还含另一会话的"工作区/规则整理"改动，需决定合并为一次提交还是拆开）。
  - 提交前建议 `git add --renormalize .` 让 `.gitattributes` 生效。
  - 后续 P1（体验）：自动阅读到书末自动停止、快捷键自定义、图标优化。
- **风险/注意事项**：
  - 本次仅删无用代码、未触碰业务逻辑，但**仍建议在浏览器回归一次**主题切换 / 屏占比 / 自动阅读，确认无异常。
  - `.trae/` 会进 git 仓库但不会进上架 zip（打包只挑运行文件）；本次新增的 `.gitattributes` 也不进 zip。

---

## 2026-09-27 会话条目：发布 v0.8.2 + 商店上架准备 (已完成)
- **目标**：把 P0 收尾成果推送远端，并按既定策略（立即发 v0.8.2；Edge 更新 + 360 首次上架）备齐上架物料。
- **已做**：
  - 推送两个历史提交到 `origin/main`：`030c25b`（清理死码 + `?` 输入法修复）、`30521d1`（文档修正）；本地已与远端同步。
  - `manifest.json` 版本 `0.8.1 → 0.8.2`；`README.md` 结构树的 zip 名称同步。
  - 重打上架包 `release/weread-enhancer-v0.8.2.zip`（仅 7 个运行文件，29K；包内 manifest 已核实为 0.8.2 / 权限 storage / 域名 weread.qq.com）。
  - 新建 360 素材目录 `release/360-素材/`：`功能说明.txt`、`图标-48x48.png`（复制自 icon-48）、`效果图-01~05-560x350.png`（由 1280×800 截图等比缩放，尺寸已校验）。
  - 文档同步 v0.8.2：`plan/RPD_需求文档.md`（当前版本 + 文档变更记录新增一行）、`plan/version_plan.md`（新增 v0.8.2 段落 + 版本对照表）、`plan/plan_edge_store.md` / `plan_360_store.md` / `plan_chrome_store.md` / `plan/session_handoff_商店上架.md` / `dev/可复制项目指南.md`（版本号与打包命令 `python`→`python3`）。
- **关键结论/决定**：
  - 本次为**补丁发布**：只做代码清理与输入法修复，不新增功能，降低商店审核风险。
  - 上架打包**只含运行文件**：`manifest.json` / `content.js` / `content.css` / `README.md` / `icons/` 三图；`.trae/`、`plan/`、`dev/`、`release/` 等一律不进包。
  - 360 上传的是**内含 `.crx` 的 ZIP**（非直接传 crx），且图片尺寸独立（效果图 560×350、图标 48×48）。
- **产出物（文件/链接）**：
  - `release/weread-enhancer-v0.8.2.zip`（新）
  - `release/360-素材/`（功能说明.txt + 图标-48x48.png + 效果图-01~05-560x350.png）
  - 更新：`manifest.json`、`README.md`、`plan/RPD_需求文档.md`、`plan/version_plan.md`、`plan/plan_edge_store.md`、`plan/plan_360_store.md`、`plan/plan_chrome_store.md`、`plan/session_handoff_商店上架.md`、`dev/可复制项目指南.md`
- **待办**：
  - **Edge**：Partner Center → 现有扩展 → 上传 `weread-enhancer-v0.8.2.zip` → 提交审核（**用户手动**）。
  - **360**：装 360 浏览器 → 实测 MV3 → 打包 `.crx`（妥存 `.pem`）→ 与 `release/360-素材/` 一起压 ZIP → 上传（**用户手动**）。
  - 本次 manifest 升版 + 文档 + 素材改动**尚未 git 提交**（等用户确认）；上架后补 tag `v0.8.2`。
- **风险/注意事项**：
  - `release/*.zip` 属 `.gitignore` 排除项，不入库；`.pem` 私钥**严禁入库**。
  - 用户提供的 GitHub token 仅用于本次推送，**未写入任何文件/日志**，建议用后在 GitHub 撤销。

---

## 2026-09-29 会话条目：感应区零遮挡 + 悬浮球悬停展开（v0.8.3）(已完成)
- **目标**：① 解决用户反馈「官方『下一页』点击区被插件改动遮挡、不好点击」；② 悬浮球（🤖）鼠标悬停即展开菜单，无需点击。先了解目录结构，再定位问题并修复。
- **已做**：
  - 通读目录结构与关键文档（README / RPD / version_plan / session_log / 三份上架方案 / 会话交接），确认项目七大目录与 v0.8.2 现状。
  - 定位遮挡源：屏占比高时启用的两个**透明感应层**——`#wre-toolbar-trigger`（`top:0;height:100px;z-index:999997`）与 `#wre-toolbar-trigger-right`（`top:0;bottom:0;width:120px;z-index:999996`）；两者是普通 div，全透明也会吃掉点击，右侧那条正好压住官方翻页点击区。
  - 与用户确认改法（选「改鼠标位置判断」；←/→ 快捷键问题本轮不动）。
  - 改写 `content.js` 的 `ensureToolbarTrigger()`：删除两个感应层，改为 `document` 上监听 `mousemove`，用 `clientY ≤ 100` / `innerWidth - clientX ≤ 120` 判断贴近边缘来呼出顶栏/右侧按钮；新增常量 `WRE_TOPBAR_ZONE_PX` / `WRE_CONTROLS_ZONE_PX` 与 `wreToolbarMoveHandler`，移除 `wreToolbarTrigger`。
  - `removeToolbarFloating()` 改为移除 mousemove 监听并置空 handler；淡出计时器改为幂等（`if (timer) return`），避免移动鼠标时反复重置计时。
  - 顺手修正 `pinTopBar()` 中已过期的注释。
  - 悬浮球交互改造：在 `bindEvents()` 中新增 `openMenu()` / `scheduleCloseMenu()`，`fab` 与 `#wre-main-menu` 各自绑定 `mouseenter` → 立即展开、`mouseleave` → 250ms 延迟收起（两者间移动不误收）；`fab` 的 click 由 `menu.classList.toggle('wre-visible')` 改为 `openMenu()`（保持展开，避免"点一下反而收起"），仍保留点击退出勿扰模式。
  - `manifest.json` 版本 `0.8.2 → 0.8.3`；同步 `plan/RPD_需求文档.md`（3.3.4 感应方式与 100/120px 数值、3.1 悬浮球悬停交互、1.3 当前版本、头部版本与日期、变更记录新增两行）与 `plan/version_plan.md`（新增 v0.8.3 段落 + 版本号对照表）。
- **关键结论/决定**：
  - 遮挡根因是「透明覆盖层仍属于可点击元素」，与 z-index 高低无关；只要元素在页面之上就会拦截点击。
  - 修复原则：感应只读鼠标坐标、不落任何 DOM 覆盖层 → 从根本上不可能遮挡。
  - 会话中发现但**本轮不改**：帮助面板写了「← / → 上一页/下一页（启用）」，而 `handleAllKeyboard` 实际只实现 空格 / D / F / ?，属文档与代码不一致，用户选择「先不动」。
  - 版本按项目规则升 patch 号（v0.8.3）。
- **产出物（文件/链接）**：
  - 更新：`content.js`（`ensureToolbarTrigger` / `removeToolbarFloating` / `pinTopBar` 注释 / 顶部变量）
  - 更新：`manifest.json`（0.8.3）
  - 更新：`plan/RPD_需求文档.md`、`plan/version_plan.md`
- **待办**：
  - ✅ **全部由用户实测通过（2026-09-29）**：遮挡修复（屏占比 90%~100% / 滚动模式下，右侧点击可正常翻下一页）+ 悬浮球悬停展开（悬停即出菜单、移开收起，交互正常）。
  - 用户当前选择「先不动」：本次改动未 git 提交、未重新打包（`release/` 现有 zip 仍为 v0.8.2）。
  - 商店方案类文档（`plan_360_store.md` / `plan_edge_store.md` / `plan_chrome_store.md` / `session_handoff_商店上架.md`）的「下一步操作」仍写 v0.8.2，建议随下次打包一起升到 0.8.3（历史提交记录保持不动）。
  - 帮助面板「← / →」文档与代码不一致问题，待用户决定实现或删文案。
- **风险/注意事项**：
  - 本次改动尚未 git 提交；工作区还残留另一批未提交改动（`plan_360_store.md`、`plan_edge_store.md`、`session_handoff_商店上架.md`、`.gitignore`、`release/360上传包/`、`备忘录.md`），提交时需决定是否合并。
  - 若用户浏览器里仍加载旧版插件，需在扩展管理页手动「重新加载」后才会生效。
  - 若某些场景下 `mousemove` 未触发（如触屏设备无鼠标移动），工具栏将无法呼出；当前插件面向桌面浏览器，暂不处理。

---

## 2026-09-29 会话条目：工作区结构梳理 + 规则/技能按项目分发（已完成）
- **目标**：定下 Trae 的打开方式（代码窗口 + 知识库窗口双窗口并行），并让通用规则与 5 个 skill 在**代码窗口**里真正生效。
- **已做**：
  - 实测确认：Trae 只读「工作区根」下的 `.trae/`，父目录 `Coding` 的规则与技能**不会自动继承**（打开代码窗口后 Rules/Skill 面板确实丢失）。
  - 改写 `Coding.code-workspace`：`folders` 从 `.` 改为项目子目录；加注释模板（逗号写在行首，去掉任意一行的 `//` 都不会触发逗号错误；三种启用组合均已用 JSON 校验通过）。
  - 新建 `Coding/.vscode/settings.json`：知识库窗口排除 `.obsidian`，避免 AI 检索被几万个插件文件污染。
  - 复制 5 个 skill 到 `微信读书插件/.trae/skills/`（`diff -r` 校验与来源完全一致）。
  - 新建 `微信读书插件/.trae/rules/general_rules.md`（项目内副本，仅改开头说明块）；`project_rules.md` 里指向父目录的死链改成同目录引用。
  - 更新 `dev/可复制项目指南.md` 至 **v1.1**：§2 目录树补 `.trae/`，新增 §2.1 每项来源表、§2.2 三层分发模型、§2.3 新项目启动清单；§0、§9 同步。
- **关键结论/决定**：
  - **双窗口并行**：代码窗口 = `Coding.code-workspace`（根 = 项目）；知识库窗口 = 打开文件夹 `Coding`。
  - **规则/技能按项目复制，不建全局**；隔离性靠复制，不靠继承。
  - **三层分发**：母本（`AI协作规划库/`）→ `Coding/.trae/` → 各项目 `.trae/`；**只改母本再向下同步**，禁止在项目副本里单点改。
  - 约定：**改代码只在代码窗口**；同一批文件不同时在两个窗口让 AI 动；跨窗口信息靠文档传递。
  - **不改 `Coding.code-workspace` 的文件名**（改名 = 新工作区身份 = 历史会话会"消失"）。
- **产出物（文件/链接）**：
  - `Coding/Coding.code-workspace`（改写）
  - `Coding/.vscode/settings.json`（新建）
  - `微信读书插件/.trae/rules/general_rules.md`（新建）、`.trae/rules/project_rules.md`（改引用）
  - `微信读书插件/.trae/skills/`（gen-rpd / pack-publish / session-handoff / session-log / test-checklist）
  - `微信读书插件/dev/可复制项目指南.md`（v1.1）
- **待办**：
  - 重开代码窗口后确认：Rules 面板 2 条、Skill 面板 5 个。
  - 沿用既有待办（见 `Coding/plan/session_handoff_工作区迁移与会话还原.md`）：README/version_plan 中不存在的快捷键 `T` 待修正（需确认）；Edge v0.8.1 更新提交、360 MV3 实测（用户手动）。
- **风险/注意事项**：
  - 同一份通用规则现有 2 处、skill 现有 3 处副本，**必须只改母本再同步**，否则漂移。
  - `.trae/` 会进 git 仓库，但**不会进上架 zip**（打包只挑运行文件）。
  - 双窗口 = 两套对话历史与记忆（按工作区路径绑定），属正常现象，不是记录丢失。

---

## 2026-09-29 会话条目：阅读统计与数据导出模块（v0.9.0）(已实现、实测通过并归档)
- **目标**：按 RPD 9.1 落地「阅读统计与数据导出」。用户选定范围 = **最小可用**（阅读时长统计：今日/本周/本月/本书 + 面板 + 导出），导出格式选定 **JSON / CSV / Markdown** 三种；进度追踪、最近书目顺延到后续版本。
- **已做**：
  - 接入点摸底：菜单容器 `#wre-main-menu`（`createUI()` 生成）、点击分发 `handleMenuClick()`、存储 `chrome.storage.local`（`storage` 权限已有）。
  - 架构决定：走「新功能进新模块、旧代码不动」——新增 `modules/stats.js` + `modules/stats.css`，在 `manifest.json` 的 `content_scripts` 注册（`stats.js` 先于 `content.js` 加载，共享同一隔离世界，可直接复用 content.js 的全局 `log()` 与 `#we-read-enhancer-root`）。
  - 为什么不用 RPD 9.4.3 原设想的「动态 `<script>` 注入」：那样注入的脚本会落到页面主世界（MAIN world），拿不到 content.js 的作用域；改为 manifest 静态注册即可共享隔离世界。
  - 计时逻辑：15s 心跳结算；`visibilitychange` 转后台与 `pagehide` 时立即结算并落盘；落盘节流 30s；异常大间隔（休眠/断点）按 3×心跳封顶。
  - 书籍识别：书名优先（`.readerTopBar_title*` → `document.title` 去掉「微信读书」后缀）；书名未就绪时用 `url:<URL片段>` 临时占位，拿到书名后自动合并为一条记录。
  - 面板：主菜单「📊 阅读统计」入口（插在「主题设置」之后）+ 4 张卡片（今日/本周/本月/本书）+ 近 14 天条形明细 + 导出按钮区 + 口径说明。
  - 导出：JSON（全量结构化）、CSV（含 BOM，Excel 不乱码）、Markdown（汇总表 + 按书累计 + 每日明细）。
  - 追加导出（同日第二次改动，用户要求「加 PDF/HTML，样式做好看些」）：
    - 新增自包含 HTML 报表：顶栏（绿色竖条标题 + 导出时间）、4 张汇总卡片、按书籍累计表、每日明细表、口径说明页脚；单文件内联样式、响应式（窄屏卡片转 2 列）、含 A4 `@page` 打印样式与 `print-color-adjust:exact`（保证 PDF 保留配色）。
    - 新增 PDF 导出：`window.open('')` + `document.write(报表 HTML)` 打开排版页 → 400ms 后唤起 `print()`，用户在打印对话框选「另存为 PDF」；报表页另带「打印 / 另存为 PDF」按钮（`no-print`，不打印出来）。零第三方依赖，符合项目「无远程代码」约束。
    - 面板导出按钮改为 5 个：HTML 报表 / PDF / Markdown / CSV / JSON，并加了 PDF 被弹窗拦截时的提示文案。
    - 视觉验证：用 browser_use 子代理真实渲染报表（宽屏 960px + 窄屏 400px）取截图与计算样式，确认布局/对齐/对比度（全部 ≥ 4.5:1 AA）正常；据反馈修掉两处瑕疵——斑马纹 `#fcfdfc` 太淡改 `#f6f8f7`、窄屏下右下角悬浮打印按钮压住页脚（新增 `@media screen{body{padding-bottom:96px}}`）。临时预览文件已删除。
  - 旧代码只加 1 个分支：`content.js` 的 `handleMenuClick()` 增加 `case 'stats'` 分流，避免落到 `default` 打出「尚未实现」的误导日志。
  - `manifest.json` 版本 `0.8.3 → 0.9.0`（新功能按规则升次版本号）。
  - 校验：`python3` 校验 manifest JSON 通过、`content_scripts` 注册项正确；IDE 诊断无新增报错（本机无 node，未能跑 `node --check`）。
- **产出物（文件/链接）**：
  - 新建：`modules/stats.js`、`modules/stats.css`
  - 归档：Git 提交 `979ef20`（feat(stats) HTML/PDF 导出）+ Git Tag `v0.9.0` + `release/weread-enhancer-v0.9.0.zip`（40 KB，9 文件）
  - 修改：`manifest.json`（版本 0.9.0 + 注册模块）、`content.js`（仅 `case 'stats'`）、`plan/RPD_需求文档.md`（新增 9.1.0 实现状态、重写 9.1.5 存储结构、1.3 版本、2.1 功能总览、变更记录）、`plan/version_plan.md`（v0.9.0 表格 + 已完成部分、第 5 节版本号对照）、`plan/plan_github_versioning.md`（归档历史 + 当前归档版本）、`README.md`（功能列表 + 项目结构）
- **待办**：
  - ✅ 用户实测已通过（2026-09-29）：面板计时、切后台/切书分段、五种导出（HTML/PDF/Markdown/CSV/JSON）均正常。
  - ✅ 已提交 `979ef20` → 打 Tag `v0.9.0` → 打包 `release/weread-enhancer-v0.9.0.zip`（40 KB，9 文件）；归档历史已同步至 `plan/plan_github_versioning.md`。
  - 后续版本：RPD 9.1.2 阅读进度追踪、9.1.3 最近书目列表与点击跳转。
- **风险/注意事项**：
  - 书名解析依赖 `.readerTopBar_title*` 与 `document.title`；若微信读书改 DOM 导致取不到书名，会退化成 `url:片段` 记录（面板会显示该临时键），排查看 `[stats]` 开头的日志。
  - 只统计 `/web/reader/` 阅读页，书城/书架等页面不计时。
  - 时长为本地估算，与微信读书 App 官方统计不会一致；页面挂着不动也会计入（本轮未做空闲检测）。
  - 存储采用「整份对象覆盖写 + 30s 节流」，长期使用后需关注写入体积（明细已在启动时清理 400 天前的数据）。
  - PDF 导出依赖浏览器允许弹出新窗口（`window.open`）；若站点或浏览器策略拦截，会只打日志不报错，需用户允许弹窗后重试。打印对话框由浏览器提供，用户需手动选「另存为 PDF」。
  - 生成打印页用的是 `document.write`（TS 提示该 API 已弃用，但在 Content Script 里生成可打印文档仍是标准做法，暂保留）。

---

## 2026-09-29 会话条目：阅读统计补齐进度追踪 + 最近书目（v0.9.1）(已实现、待实测)
- **目标**：按 RPD 9.1 继续开发，补齐 v0.9.0 遗留的两项——9.1.2 阅读进度追踪、9.1.3 的「本书进度」与「最近 10 本书列表 + 点击跳转」。
- **已做**：
  - **进度采集（9.1.2）**：微信读书官方无稳定进度接口，改为探测页面文本。`PROGRESS_TEXT_SELECTORS`（`.readerFooter` / `[class*="progress"]` / `[class*="percent"]` 等）先扫，`parseProgressText()` 用正则解析 `45%` 与 `12/340` 两种写法；再兜底在 `[class*="reader"]`（最多 400 个）里找「短且带 %」的文本。章节名由 `CHAPTER_SELECTORS`（`.readerChapterContent h1~h3`、`[class*="chapterTitle"]` 等）取首个长度 ≤60 的文本。
  - 采集时机：`tick()`（15s 心跳）调用 `updateProgress()`，`attach()` 初始化时也调一次；**只有值真正变化才写库**；采不到时保留上次值，面板显示「进度未知」，绝不误写。
  - **存储**：`SCHEMA_VERSION` `1` → `2`，书籍新增 `progress: { percent, chapter, index, total, updatedAt }`；旧数据不需迁移（缺失即降级）。
  - **面板（9.1.3）**：`renderPanel()` 结构改为 卡片 → 当前书籍进度 → 近 14 天明细 → 最近阅读（最多 10 本）→ 导出 → 说明；`getSummary()` 新增 `bookProgress` / `bookLastReadAt`。
  - **点击跳转**：最近书目条目带 `data-wre-stats-open=<bookId>`，body 点击监听里 `window.open('https://weread.qq.com/web/reader/' + bookId, '_blank')`；无 `bookId` 的条目不加该属性、不可点。
  - **导出同步**：CSV 增「当前进度」列；Markdown 书籍表增「进度」列 + 新增「最近阅读（最多 10 本）」小节；HTML/PDF 报表书籍表增「进度」列 + 新增「最近阅读」卡片区块（含排版/响应式/打印 `break-inside:avoid` 样式）。
  - **样式**：`modules/stats.css` 新增 `.wre-stats-progress*`（进度卡：head + track/fill + meta）与 `.wre-stats-recent*`（列表项 + `is-clickable` 悬停），复用 `--wre-*` 主题变量；移除已弃用的 `.wre-stats-book` 规则。
  - `manifest.json` 版本 `0.9.0 → 0.9.1`，描述补充「阅读统计与导出」。
  - 校验：`python3` 校验 manifest JSON 通过（0.9.1，描述 54 字）；IDE 诊断无新增报错（仅 `document.write` 既有弃用提示，本机无 node 未能跑 `node --check`）。
- **产出物（文件/链接）**：
  - 修改：`modules/stats.js`、`modules/stats.css`、`manifest.json`、`plan/RPD_需求文档.md`（9.1.0 状态表、9.1.2/9.1.3 改写、9.1.4 导出内容、9.1.5 存储结构 v2、9.6/9.7、变更记录）、`plan/version_plan.md`（v0.9.x 段落 + 第 5 节版本号对照）、`README.md`（功能列表）
  - 未产出：暂未提交 / 未打 tag / 未打包（等用户实测通过）
- **待办**：
  - 用户在扩展管理页「重新加载」插件后实测：本书进度显示、最近书目点击跳转、五种导出是否含进度/最近书目。
  - 实测通过后：按 `pack-publish` 技能提交 + 打 Tag `v0.9.1` + 打 `release/weread-enhancer-v0.9.1.zip` + 同步归档文档。
- **风险/注意事项**：
  - 进度完全靠 DOM 文本探测：微信读书改版会导致采不到（降级「进度未知」属预期）。改版时优先补 `PROGRESS_TEXT_SELECTORS` / `CHAPTER_SELECTORS`，排查看 `[stats] 更新阅读进度` 日志。
  - 章节名选择器可能命中封面/目录里的短文本，理论上存在误采；当前限制「长度 ≤60」以降低概率。
  - 跳转用的 `bookId` 取自 URL 片段，仅在阅读页产生；从其他页面点开的记录可能无 `bookId`（不可点）。

---

## 2026-09-29 会话条目：笔记增强模块（v0.10.0）(已实现、待实测)
- **目标**：按 RPD 9.2 开发笔记增强，一轮做全三块——9.2.1 划线快速复制、9.2.2 划线批量导出、9.2.3 想法/批注聚合面板。数据来源经用户确认为「官方同源接口优先 + DOM 兜底」。
- **已做**：
  - **新建 `modules/notes.js`**（IIFE，`'use strict'`，独立模块不改 content.js 逻辑）：
    - 数据层：`fetchJson()` 带 `credentials:'include'`，401/403 标记 `unauthorized`；`fetchBookNotes(bookId)` 用 `Promise.all` 并行请求 `bookmarklist` / `review/list(listType=11&mine=1)` / `chapterInfos` 三个同源接口，**两块划线/想法均失败才抛错**（优先抛未登录错误）；`normalizeBookmark` / `normalizeReview` / `buildChapterMap` 归一化数据（`createTime` 秒/毫秒兼容）。
    - 统一状态入口 `loadNotes(force)`：解析当前书 `bookId`（`/web/reader/<id>`）→ 命中 5 分钟内存缓存直接用 → 未登录给提示 → 接口失败回退 `scrapeDomNotes()`（多候选选择器抓页面已渲染划线）→ 统一渲染/错误/空态。
    - 面板：菜单入口 `data-wre-notes-entry`（挂在 stats 入口之后，兼容回退到主题设置项）；`#wre-notes-modal` 面板含 Tab（划线 / 想法）、按章节分组列表、条目可点击「跳回原文」。
    - 导出：`buildMarkdown()`（`# 《书名》读书笔记` + 按章节划线 + 想法小节）/ `buildPlainText()`，复用 `downloadFile()`。
    - 选中复制（9.2.1）：`mouseup`/`keyup` 后读取选区，在选区上方弹出 `#wre-notes-copybtn` 浮标（`mousedown` preventDefault 防丢选区），点击复制；`copy` 事件监听改写 `text/plain` / `text/html`。
    - 水印清洗：`TAIL_WATERMARKS` / `BARE_WATERMARK`（需前置空行）/ `TAIL_INLINE_WATERMARK` 保守匹配，仅命中特征才改写，每次清洗写 `[notes]` 日志可回溯。
    - 跳原文：`window.find()` 定位；跨书用 `localStorage` 的 `wrePendingJump` 传递待定位文本，新页面轮询定位（20 次 × 500ms，超时明确提示）。
    - `bootstrap()` 用 MutationObserver 等待 `#we-read-enhancer-root` 后 `attach()`。
  - **新建 `modules/notes.css`**：面板/条目/浮标/提示/toast 样式，全部挂在 `#wre-notes-*` 下，复用 `--wre-*` 主题变量。
  - `manifest.json` 版本 `0.9.1 → 0.10.0`，描述加「笔记导出」，`css` 加 `modules/notes.css`、`js` 加 `modules/notes.js`（stats 之后、content.js 之前）。
  - `content.js` 仅 `handleMenuClick()` 增加 `case 'notes': break;` 分流（面板由 notes.js 自行接管）。
  - **数据不落盘**：面板数据只在内存缓存 5 分钟，不写 storage，缩小隐私面，符合项目「不收集数据」红线。
  - 校验：本机无 node，改用 `osascript -l JavaScript` + `new Function()` 对三个 JS 文件做语法检查（全部 OK）；`python3` 校验 manifest JSON 通过。
- **产出物（文件/链接）**：
  - 新建：`modules/notes.js`、`modules/notes.css`、`test/笔记增强测试清单.md`
  - 修改：`manifest.json`、`content.js`（仅加分流）、`plan/RPD_需求文档.md`（9.2.0 状态、9.6/9.7、变更记录）、`plan/version_plan.md`（v0.10.0 段落）、`README.md`（功能列表 + 项目结构）、`release/privacy.md`（新增 Notes 小节）
  - 未产出：暂未提交 / 未打 tag / 未打包（等用户实测通过）
- **待办**：
  - 用户在扩展管理页「重新加载」插件后实测：面板划线/想法、导出、选中复制、水印清洗、跳原文。
  - 实测通过后：按 `pack-publish` 技能提交 + 打 Tag `v0.10.0` + 打 `release/weread-enhancer-v0.10.0.zip` + 同步归档文档。
- **风险/注意事项**：
  - 同源接口字段可能随微信读书改版变动；接口失败会自动回退 DOM 抓取（数据可能不全），排查看 `[notes]` 日志。
  - 水印清洗采用保守策略（「微信读书」单独成行需前置空行才删），以降低误删正文风险。
  - 跨书跳原文依赖 `localStorage` 传递，若微信读书改版路径需同步更新 `READER_PATH_RE`。

---

## 2026-09-29 会话条目：修复笔记接口「参数格式错误」——笔记改走官方网关
- **目标**：用户实测反馈「修完 bookId 后笔记接口仍失败」。定位并修复，使「📝 笔记」面板能正常读出划线/想法。
- **定位过程（重点）**：
  - 用户第 2 份日志显示 `bookId` 已修对（`74332a90813ab86c4g019d98`），但接口回 **「接口业务错误：参数格式错误」**，随后回退 DOM 只抓到 1 条。
  - 下载阅读页 webpack chunk 逆向：页面真实调用是 **POST** + body `{bookId, syncKey}`，且 axios 拦截器会给请求加 **`x-wrpa-0` 反爬签名头**（由 `window.__WRPA__.sr()` 现算，失败兜底常量 `2097d7b063d6f8b5`）。我们原来用 GET query + 小写 `synckey` + 无签名头 → 被服务端判「参数格式错误」。
  - 结论：网页同源接口已被反爬加固，硬碰脆弱。经用户选择，改走**官方 Agent 网关**（项目已实现 `background.js` + `modules/official.js`，manifest 已接线 `0.11.0`）。
- **已做**：
  - `modules/notes.js`：新增 `sendBg()`（与后台通信）、`fetchBookNotesViaOfficial(bookId)`（先 `wre-official-status` 判有无 Key；有 Key 则并行调 `wre-official-call` → `api_name=/book/bookmarklist` 参数驼峰 `bookId`、`api_name=/review/list/mine` 参数小写 `bookid`；归一化复用 `normalizeBookmark`/`normalizeReview`，章节表用回包 `chapters`）；`fetchBookNotes` 改为**官方网关优先 → 网页同源接口 → 页面抓取**三级兜底。
  - 未配置 Key 且网页接口失败时，面板 `sourceNote` 明确提示「打开「☁️ 官方数据 → 设置」粘贴 wrk- Key 即可完整读取」，避免误判为插件坏了。
  - 导出 Markdown 的「数据来源」标注新增官方口径；模块头注释与版本号更新为 `v0.11.0`。
  - 全部诊断继续走统一日志 `[notes]`（新增「官方网关取笔记完成/失败」日志，含各接口 keys 便于排查字段差异）。
- **产出物**：
  - 修改：`modules/notes.js`、`plan/RPD_需求文档.md`（9.2.0 数据来源改为三级优先级）
  - 校验：`osascript -l JavaScript` + `new Function()` 语法检查通过（notes.js / background.js / official.js）
- **待办**：
  - 用户重新加载扩展后实测：先在「☁️ 官方数据 → 设置」粘贴 `wrk-` Key 并校验通过，再开「📝 笔记」验证划线/想法完整、导出与跳原文正常。
- **风险/注意事项**：
  - 官方接口字段名若与预期不符，看 `[notes] 官方网关取笔记完成` 日志里的 `bookmarkKeys` / `reviewKeys` 快速校准。
  - 网页同源接口（第二级兜底）当前基本不可用，保留仅为兼容旧环境；不要依赖它。

### 同日补充：根因确认与最终修复（实测通过）
- **根因（两次实测日志定位）**：
  - 网关本身正常（`/_list`、`/user/notebooks` 均成功：413 本、9662 条笔记），但 `/book/bookmarklist`、`/review/list/mine` 均回 `errcode -2003「参数格式错误」`，HTTP 499、耗时仅约 0.36s → 服务端快速拒绝，非超时。
  - **bookId 是两套编号**：阅读页网址的是 23 位字符串（`74332a90813ab86c4g019d98`），官方接口要的是纯数字 ID（`3300082609`）。这就是 -2003 的原因。
- **修复**：
  - `modules/notes.js` 新增 `resolveOfficialBookId(title)`：直连失败时用书名调 `/store/search`(scope=10)，优先取书名对得上的那本，拿到官方 `bookId` 后重试两个笔记接口。
  - 新增 `fetchOfficialReviews(bookId)`：`/review/list/mine` 默认每页 20 条，按 `synckey` + `hasMore` 循环取完（上限 10 页），避免想法被截断。
  - `background.js`：HTTP 非 2xx 时把响应体前 300 字放进 `snippet`，便于从统一日志看到服务端真实报错。
- **实测结果**：书名「这就是ChatGPT」反查得 `bookId=3300082609`，重试成功，取到 **24 条划线 / 5 条想法 / 8 个章节**，面板显示正常。
- **文档回灌**：`plan/RPD_需求文档.md` 9.2.0 增补「官方网关两个易错点」（bookId 两套编号 + 想法接口分页）。

### 同日续：v0.12.0 导出扩展（复制笔记 / HTML / PDF）
- **用户要求**：笔记面板增加「复制笔记、导出 PDF、导出 HTML」，并把导出样式做好看。
- **实现（均在 `modules/notes.js`，旧代码未动）**：
  - 工具栏新增「复制笔记 / 导出 HTML / 导出 PDF」三个按钮（原「刷新 / 导出 Markdown / 导出纯文本」保留，共 6 个，窄屏自动换行）。
  - `buildNotesReportHtml(data)` + `notesReportStyles()`：单文件 HTML 报表，样式直接沿用 `modules/stats.js` 的 `reportStyles()` 设计语言（`--accent:#07c160` 绿色主色、hero 头、3 张概览卡片「划线 / 想法 / 覆盖章节」、章节虚线分隔、想法用左侧绿条卡片、`@media print` 下 A4 + `break-inside:avoid`）。
  - `openNotesForPrint(html)`：PDF 走「新窗口打印视图 + 自动唤起打印」（与 stats 完全同一套做法），窗口被拦时明确提示并写日志。
  - `buildNotesClipboardHtml(data)` + `copyNotesRich()`：复制笔记时剪贴板**同时写 `text/html`（内联样式，粘到飞书/Word 保留排版）与 `text/plain`（Markdown，粘到代码编辑器/Obsidian 得 Markdown）**；`ClipboardItem` 不可用时回退 `copyText(markdown)`。
  - `escapeMultiline()`：导出时把换行转 `<br>`，保留原文换行。
  - `sourceLabel(data)`：抽出数据来源文案（Markdown / HTML / 剪贴板三处共用）。
- **版本**：`manifest.json` `0.11.0` → `0.12.0`。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过（notes.js / background.js / manifest.json）。
- **文档回灌**：RPD 9.2.0 与 9.2.2（导出格式加 HTML/PDF + 一键复制）、`plan/version_plan.md`（新增 v0.12.0 段）、`README.md`（笔记增强特性行）、`test/笔记增强测试清单.md`（1.4 改六按钮、新增 2.7~2.9 与 4.6~4.10）。
- **待办**：用户重载扩展实测；通过后再归档（tag v0.12.0 + zip）。

---

## 2026-09-29 会话条目：v0.11.0 提交与归档（已完成）
- **目标**：用户指令「提交当前版本」→ 把工作区累积的 v0.9.1 + v0.10.0 + v0.11.0 改动提交，并按 `pack-publish` 技能完成打 Tag、打包、归档文档同步。
- **已做**：
  - 提交前核查：`git status` 界定范围为「运行必需 + 项目文档」；排除 `release/weread-enhancer-v*/`、`*.zip`、`*.pem`、`.trae/`、`inbox/`（均在 `.gitignore`）。
  - 安全检查：全仓 grep `wrk-` 仅命中 `official.js` 的占位符 `wrk-xxxxxxxx` 与 RPD 文档示例，**无真实 Key 入库**。
  - 校验：`osascript -l JavaScript` + `new Function()` 对 `background.js` / `content.js` / `modules/{stats,notes,official}.js` 做语法检查全部 OK；`python3` 校验 manifest JSON（`0.11.0`，css/js/background/host_permissions 注册项正确）。
  - 提交 `fadb96b`（17 文件，+4293/-86）并推送 `origin/main`。
  - 打 Tag `v0.11.0` 并推送。
  - 打包 `release/weread-enhancer-v0.11.0.zip`（73 KB，14 文件，`testzip()` 无损坏）：在原 9 文件基础上加入 `background.js` 与 `modules/{notes,official}.{js,css}`。
  - 归档文档同步：`plan/plan_github_versioning.md`（当前归档版本 + 归档历史新增 v0.11.0 行 + 未打 tag 版本补 v0.9.1 / v0.10.0 说明）、`plan/version_plan.md`（第 3 节标题与模块表、新增 v0.11.0 官方数据小节、第 5 节版本号对照）、`README.md`（zip 名改 v0.11.0）。
  - 本次一个提交内含三个版本：v0.9.1 / v0.10.0 因无独立 commit，未单独打 tag（与 v0.8.3 并入 v0.9.0 的处理方式一致）。
- **产出物（文件/链接）**：
  - Git 提交 `fadb96b`、Git Tag `v0.11.0`
  - `release/weread-enhancer-v0.11.0.zip`（73 KB，14 文件）
  - 修改文档：`plan/plan_github_versioning.md`、`plan/version_plan.md`、`README.md`、`dev/session_log.md`
- **待办**：
  - 浏览器实测（重载插件）：`test/笔记增强测试清单.md`、`test/官方数据测试清单.md`、以及 v0.9.1 的进度追踪与最近书目。
  - 实测通过后：更新商店截图 → 提交 Edge / 360 审核（上传包已备好）。
  - `notes.js` / `official.js` 的实现细节条目仍缺一条 session_log 记录（对应会话未落痕），如需补写可在下次会话补齐。
- **风险/注意事项**：
  - 本次归档的 notes / official 两项在文档中仍标注「待实测」，属**未验证版本**；若实测发现问题，需修复后升版本号再打 tag，不要移动已有 tag。
  - 归档的历史 zip（v0.9.0 及更早）仍在 `release/` 本地，不进 git；需要时从本地保留或 GitHub Release 附件获取。
  - 官方数据功能为**可选开关**（默认关闭）且新增 `i.weread.qq.com` host 权限，商店提交前需确认隐私政策已同步（本次已更新 `release/privacy.md`）。

---

## 2026-09-29 会话条目：笔记功能改为「Key 必选」＋ 一键跳转设置（v0.12.1）
- **目标**：用户明确「笔记需要 Key 才能实现，Key 是必选项」——未配置 Key 或 Key 有问题时，先引导用户去配 Key，再使用笔记功能；并在笔记面板提供跳转到 Key 设置页的入口。
- **已做（均在 `modules/notes.js` / `modules/official.js` / `modules/notes.css`，未动旧代码）**：
  - **Key 必选拦截**：`loadNotes()` 取书后先查 `wre-official-status`，`hasKey=false` 时直接进入「引导态」（`panelState.needsKey='missing'`），**不再**尝试网页接口 / 页面抓取兜底。
  - **Key 失效识别**：`fetchBookNotesViaOfficial()` 遇到后台返回 `code:'nokey'`（未配置）或 `code:'auth'`（HTTP 401/403，Key 无效/失效）时，返回 `{__needsKey}` 哨兵；`fetchBookNotes()` 转抛 `code='needsKey'` 错误，`loadNotes()` 捕获后进入引导态（`needsKey='invalid'`），并跳过没有意义的 bookId 反查重试。
  - **引导态 UI**：新增 `renderKeyGuide(reason)`（标题区分「需要先配置」/「已失效」）+ `modules/notes.css` 新增 `.wre-notes-guide*` / `.wre-notes-warn-actions` 样式；含「⚙️ 去配置 Key」与「我已配置，重新检测」两个按钮及获取方式提示。
  - **跨模块跳转**：`notes.js` 的 `openOfficialKeySettings()` 派发 `document` 自定义事件 `wre-open-key-settings` 并关闭笔记面板；`official.js` 在 `bootstrap()` 监听该事件 → `activeTab='settings'` + `openPanel()`。解耦实现，不模拟点击、不暴露全局函数。
  - Key 有效但网关临时失败时仍保留页面抓取兜底，警示条（`.wre-notes-warn`）上附「去设置检查 Key」按钮。
- **产出物**：
  - 修改：`modules/notes.js`、`modules/official.js`、`modules/notes.css`、`manifest.json`（`0.12.0` → `0.12.1`）
  - 文档回灌：`plan/RPD_需求文档.md`（9.2.0 增 v0.12.1 说明 + 变更记录两行）、`plan/version_plan.md`（新增 v0.12.1 段）、`README.md`（笔记特性行）、`test/笔记增强测试清单.md`（2.9/2.10 改写 + 新增第七组、原第七组顺延为第八组）
  - 校验：`osascript -l JavaScript` + `new Function()` / `JSON.parse` 语法检查通过（notes.js / official.js / background.js / manifest.json v0.12.1）
- **待办**：
  - 用户重载扩展实测第七组验收项（未配置 Key 拦截、跳转设置、失效提示、重新检测）。
  - 与 v0.12.0 的导出/复制一起实测通过后，再走 `pack-publish` 归档（`0.12.0` 与 `0.12.1` 若无独立 commit，可并入同一 tag，与以往处理一致）。
- **风险/注意事项**：
  - 判定「Key 有问题」目前只认 `code:'auth'` / `'nokey'`；若官方对失效 Key 返回其它 code，会落到「页面抓取兜底」而非引导态，需据实测日志再收敛。
  - 跳转依赖 `official.js` 已加载（同一 workspace 的 content script）；若该模块未注入，按钮点击不会打开设置页（当前 manifest 已注册，正常可用）。

### 同日续：v0.12.2 「复制笔记」纯文本去除 Markdown 符号
- **用户反馈**：复制笔记后粘到记事本 / 微信会带 `#` `*` `>` 等 Markdown 符号，希望是干净的纯文本格式。
- **实现（仅 `modules/notes.js`）**：
  - `handleCopyNotes()` 传给 `copyNotesRich()` 的 `text/plain` 内容由 `buildMarkdown(data)` 改为 `buildPlainText(data)`（`【划线】` / `[章节]` / 数字序号，无 Markdown 符号），直接可读。
  - `copyNotesRich(markdown, html)` 形参更名为 `plainText`；`text/html` 富文本格式保留不变（粘到飞书 / Word 仍保留排版）。
  - Toast 回退文案「已复制笔记（Markdown）」→「已复制笔记（纯文本）」，模块头注释同步更新。
- **版本**：`manifest.json` `0.12.1` → `0.12.2`。
- **文档回灌**：`plan/RPD_需求文档.md`（9.2.0 增 v0.12.2 说明 + 9.2.2 一键复制描述 + 变更记录一行）、`plan/version_plan.md`（新增 v0.12.2 段）、`README.md`（笔记特性行）、`test/笔记增强测试清单.md`（4.9 改写 + 新增 4.10，原 4.10 顺延 4.11）。
- **校验**：`osascript -l JavaScript` + `new Function()` / `JSON.parse` 语法检查通过。
- **待办**：随 v0.12.0/v0.12.1 一起实测后归档。

### 同日续：v0.12.3 笔记面板新增搜索定位
- **用户要求**：笔记增加搜索功能，方便定位到自己的笔记。
- **实现（`modules/notes.js` + `modules/notes.css`，未动旧代码）**：
  - 新增状态 `searchQuery` 与 `renderSearchBar()`（搜索框 + 条件「×」清空按钮）、`filterGroups(groups)`（关键词命中章节名 → 整组保留；否则按「摘要 + 正文」逐条匹配，返回 `{groups, matched, active}`）。
  - `renderPanel()` 数据就绪分支插入搜索框，过滤后的 `groupHtml` 带「找到 N 条匹配」提示；无结果给「没有找到包含『xx』的划线/想法」空态。
  - `buildPanel()` 给 `#wre-notes-body` 增加 `input` 事件监听 → `handlePanelInput()`：更新 `searchQuery`、重绘、恢复焦点与光标（`setSelectionRange`）。
  - `handlePanelClick()` 增加 `[data-wre-notes-search-clear]` 分支：清空搜索并重绘、聚焦搜索框。
  - `openPanel()` 打开时把 `searchQuery` 复位为空（避免上次搜索词残留）。
  - `modules/notes.css` 新增 `.wre-notes-search*` 样式（复用 `--wre-primary` / `--wre-border` / `--wre-hover-bg` 变量，深浅主题自适应）。
- **版本**：`manifest.json` `0.12.2` → `0.12.3`。
- **文档回灌**：`plan/RPD_需求文档.md`（9.2.0 增 v0.12.3 说明 + 变更记录一行）、`plan/version_plan.md`（新增 v0.12.3 段）、`README.md`（笔记特性行）、`test/笔记增强测试清单.md`（3.4 + 新增「三·一、搜索定位」3A.1~3A.8）。
- **校验**：`osascript -l JavaScript` + `new Function()` / `JSON.parse` 语法检查通过；`GetDiagnostics` 无新增错误。
- **待办**：随前面各版本一起实测后归档。

### 同日续：v0.12.4 修复「点击笔记定位原文」失效
- **用户反馈**：点击笔记条目「定位到原文」没实现，不能跳转到原文。
- **根因**：原「跳原文」仅用 `window.find()`。微信读书正文里划线文本常跨多个内联元素（`span`/`<br>`/注音等），`window.find` 只按「连续字符串」匹配，跨节点时匹配不到 → 表现为点笔记无跳转。
- **修复（仅 `modules/notes.js`，未动旧代码）**：
  - 新增 `normalizeForMatch(text)`：去掉所有空白 + 转小写，用于跨节点模糊匹配。
  - 新增 `revealNode(node)`：命中后 `scrollIntoView` 居中 + 临时绿色高亮（2 秒自动还原）。
  - 新增 `locateTextInReader(text)`：先 `window.find` 快速路径；失败则 `TreeWalker` 遍历正文文本节点（`.app_content` / `.readerChapterContent` 等容器优先，`document.body` 兜底），归一化后做「单节点 + 相邻节点拼接（≤12 节点 / 400 字符）」子串匹配。
  - `jumpToItem()` 同书定位改用 `locateTextInReader`，定位失败时 toast 提示目标章节名；`handlePendingJump()` 跨书定位同步改用该函数。
- **版本**：`manifest.json` `0.12.3` → `0.12.4`。
- **文档回灌**：`plan/RPD_需求文档.md`（9.2.0 增 v0.12.4 说明 + 变更记录一行）、`plan/version_plan.md`（新增 v0.12.4 段）、`test/笔记增强测试清单.md`（第六组 6.1/6.2 改写 + 新增 6.4/6.5）。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **已知限制（待实测确认）**：若正文为 canvas 渲染（翻页模式，无 DOM 文本节点），`TreeWalker` 也定位不到，仅能提示章节名；如需 canvas 章节级定位，需另接微信读书阅读器内部章节跳转（涉及章节 hash 映射，复杂度高），留待用户实测反馈后再评估。
- **待办**：用户重载扩展实测第六组（尤其 6.4 跨节点文本）；随前面版本一起归档。

### 同日续：v0.13.0 官方数据报告 V2·上半（接入书架 + 笔记，第二步）
- **用户目标**：在已跑通的报告骨架（V1 只用 `/readdata/detail`）基础上，「第二步接入」书架与笔记数据源，补齐此前在附录标注「待补」的章节。
- **数据层（`modules/official.js`）**：
  - 新增 `/shelf/sync`（**无参数**）与 `/user/notebooks`（**游标分页**：首页 `count:100`，下一页带上一页末条 `sort` 作 `lastSort`，上限 5 页，超限置 `truncated`）拉取；新增 `slimShelf()` / `slimNotebook()` 精简字段（丢弃封面）。
  - 新增概览缓存 `OVERVIEW_CACHE_KEY = 'wreOfficialOverviewCache'`（30 分钟，与周期无关）；`readOverviewCache()` / `writeOverviewCache()`，**仅当书架与笔记两路都成功才写缓存**。
  - `loadReport(force)` 重构为 `Promise.all([loadDetail(force), loadOverview(force)])` 并行拉取；新增状态机 `overviewState = idle|loading|ok|partial|error`，单路失败降级为 `partial` 并给出中文提示，报告主体不受影响。
- **统计函数**：`shelfCounts()`（严格官方口径：总数 = books + albums +（mp 非空 ? 1 : 0）；私密 = secret 命中 + 文章收藏入口）、`shelfCategories()`（按电子书 `category` 聚合，前 15 类）、`notebookStats()`（总条数优先官方 `totalNoteCount`，分项为明细求和；笔记最多前 10）、`finishStats()`（完读率，不计专辑）、`finishedBooks()`（读完按 `readUpdateTime` 降序，前 20）。
- **报告模型**：`buildReportModel(data, mode, overviewData)` 新增「2.2 书架结构 / 九、知识脉络 / 十、笔记行为 / 十一、完读率 / 十二、已读完书目」；`数据来源` 行动态拼接三接口；附录新增书架/笔记口径，并把「下一阶段将补充」收窄为「想法与划线深度解读 / 价值取向与精神底色」。调用点（`buildStandaloneHtml` / `exportMarkdown`）透传 `overview`。
- **`background.js`**：清 Key（`wre-official-clear` 与清缓存分支）时一并清理 `wreOfficialOverviewCache`。
- **版本**：`manifest.json` `0.12.4` → `0.13.0`；`official.js` 头部版本注释同步。
- **校验（本机无 Node，用 JXA 桩环境）**：
  - 语法检查 `osascript -l JavaScript` + `new Function()`：`official.js` / `background.js` 均 **OK**。
  - 桩环境冒烟（`chrome.runtime.sendMessage` 同步桩 + 微任务在脚本末尾 drain）：正常路径 `overviewState=ok`、书架总数 5（3 书+1 专辑+1 文章）、私密 2、笔记三项求和、完读率 2/3、已读完书目按时间降序；**partial 降级**（书架失败→`partial`、报告主体仍 `ok`、九/十二 隐藏、提示出现）；**分页截断**（5 页上限、`truncated=true`、调用 5 次）；新章节在 Markdown 与 HTML 中均正确渲染（含条形 `bar-td`）。**全部符合预期**。
- **文档回灌**：`test/官方数据测试清单.md`（标题/前置改 v0.13.0；4.2/4.9/4.10/4.20/4.21 改写 + 新增 4.22~4.29；5.5/5.6；6.4；8.9~8.11；9.1；十·口径补书架/笔记）、`README.md`（官方数据功能行补新章节与缓存/降级说明）、`plan/RPD_需求文档.md`（10.2.3 章节骨架与四段标注第二步完成、10.5 十三-3 拆「已完成/待办」、变更记录一行）、`plan/version_plan.md`（新增 v0.13.0 段）。
- **待办**：用户重载扩展后按测试清单实测（重点 4.22~4.29 的书架/笔记章节、5.5 概览缓存、8.9/8.10 与 App 口径核对）；时段热力 / 原生 Canvas 图表留待后续。

### 同日续：v0.13.1 笔记「跳原文」适配翻页/canvas 模式
- **用户反馈**：点击笔记「定位到原文」仍无法跳转，并导出调试日志。
- **日志诊断（根因）**：用户阅读页是**翻页模式**——`mode: page`、`scrollMode: false`、`readingModeGuess = { hasHorizontalReader:true, hasCanvas:true, hasReaderContent:false }`，正文画在 canvas 上、DOM 里无正文文本节点；故 v0.12.4 的 `window.find` / `TreeWalker` 文本定位对 canvas 全部失效。
- **修复（仅 `modules/notes.js`）**：
  - `jumpTargets` 补充 `chapterUid` 字段。
  - 新增 `detectCanvasMode()`：判 `hasCanvas` + `hasHorizontalReader` + 正文容器 `textContent` 长度，输出 `isCanvas`。
  - 新增 `wait()` + `jumpToChapter(chapterName)`（async）：点击顶栏章节标题呼出目录 → 轮询（5×200ms）等目录面板出现（候选 `.readerCatalog` / `[class*="catalog"]` / `[class*="chapterList"]` 等）→ 按章节名匹配目录项并点击（章节级，不精确到行）。
  - `jumpToItem` 改 async：文本定位失败 → `detectCanvasMode()`，命中 canvas 则 `jumpToChapter()` 降级；仍失败给明确 toast。全链路打 `[notes]` 诊断日志（canvas 判定、目录面板候选结构、章节项采样），便于一次实测定位剩余结构问题。
- **版本**：`manifest.json` `0.13.0` → `0.13.1`。
- **文档回灌**：`plan/RPD_需求文档.md`（9.2.0 增 v0.13.1 说明）、`plan/version_plan.md`（新增 v0.13.1 段）、`test/笔记增强测试清单.md`（第六组 6.5 改写 + 新增 6.6）。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **已知限制/待确认**：翻页模式只能定位到**章节级**（无法精确到某一行，因正文在 canvas 上）；目录面板 DOM 结构为启发式选择器，需用户实测后按日志 `candidates` / `sample` 精确校正。
- **待办**：用户重载扩展后，按第六组 6.5/6.6 实测；若目录跳转失败，导出日志看 `未找到可见目录面板` 或 `目录面板内未找到匹配章节项` 的候选结构，据此精确修复。

### 同日续：v0.13.1 内修复「window.find 假成功、视觉不跳转」
- **用户反馈**：再导日志「没有成功」。
- **日志关键**：`[notes] 已在正文定位到目标文本`（needle「钱是一种力量…」）——即 `window.find` 返回 true，但用户视觉上没跳转。
- **根因**：上一版 `locateTextInReader` 先走 `window.find`，命中即 `return true`，**没执行 `revealNode`（scrollIntoView + 高亮）**；而 `window.find` 在微信读书翻页/正文容器（overflow:hidden）里只「找到」文本、默认滚动不可靠，且无任何视觉反馈 → 表现为「没跳转」。同时确认 DOM 里**确有**正文文本（window.find 能找到），并非纯 canvas。
- **修复（仅 `modules/notes.js`）**：
  - `locateTextInReader` 调序：**TreeWalker 优先**（命中后 `revealNode` 滚动+高亮），`window.find` 降为兜底。
  - `revealNode` 改进：`closest` 优先取 `p/section` 再 `div` 再 `span`（高亮/滚动范围更明显）；`scrollIntoView` 去掉 `behavior:'smooth'` 改用 instant，确保在 `overflow:hidden` 正文容器内可靠滚动。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后，点划线验证「滚动 + 绿色高亮」是否可见；若仍不动，导出日志看是 `TreeWalker 在正文容器内定位成功` / `全页兜底定位成功` 还是走 `window.find` 兜底。

### 同日续：v0.13.1 内修复「翻页模式文本定位假成功」
- **用户反馈**：第三次导日志，仍无视觉跳转。
- **日志关键**：`TreeWalker 在正文容器内定位成功`（连续 5 次，needle「钱是一种力量…」「注重三种力量：剑、宝石」）——TreeWalker 找到了 DOM 文本节点，但用户视觉上仍无反应。
- **根因**：翻页模式（`readingModeGuess = { hasHorizontalReader:true, hasCanvas:true, hasReaderContent:false }`）下，正文画在 canvas 上，**DOM 里的文字是隐藏的**（供无障碍/复制用）。TreeWalker 遍历到这些隐藏文本 → `revealNode` 对隐藏元素滚动/高亮 → 视觉无任何变化，即「假成功」；且 `jumpToItem` 里文本定位成功即 `return`，**章节跳转从未被触发**。
- **修复（仅 `modules/notes.js`）**：`jumpToItem` 同书分支**先 `detectCanvasMode()`**，命中 `isCanvas` 则跳过文本定位、直接走 `jumpToChapter()` 章节级跳转（首次真正触发）；只有 DOM/滚动模式才走文本定位。翻页模式章节跳转失败时给出明确 toast。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后点划线——此为**首次真正走目录跳转**，需重点验证 `jumpToChapter` 的启发式目录点击是否命中；若失败，日志会带 `未找到可见目录面板`（含 `candidates`）或 `目录面板内未找到匹配章节项`（含 `sample`），据此精确校正目录选择器。

### 同日续：v0.13.1 内修正「目录呼出方式 + 章节项匹配」
- **用户反馈**：第四次导日志，目录跳转仍未命中。
- **日志关键**：`检测到翻页模式` → `尝试点击顶栏标题呼出目录`（title「富爸爸穷爸爸」）→ `目录面板内未找到匹配章节项`（`panelCls: "readerControls_item catalog"`、`sample: []`）。`canvasInfo.chapterTextLen = 17647`，进一步印证 DOM 里有完整正文文本（隐藏）。
- **根因**：① 顶栏标题显示的是**书名**「富爸爸穷爸爸」而非章节名，点它未必呼出目录；② 轮询面板选择器 `[class*="catalog"]` 误匹配到底部控制栏的**目录按钮**（`.readerControls_item.catalog`），把它当目录面板，里面当然没有章节项 → `sample: []`。
- **修复（仅 `modules/notes.js`）**：`jumpToChapter` 重写——① 优先点底部控制栏的「目录」按钮（`.readerControls_item.catalog` 等），顶栏标题仅兜底；② 不再依赖特定目录面板类名，改为**在整页可见元素里按章节名匹配、取文本最短（最具体）者**点击；③ 失败采样整页可见文本（≤40 字），供下一步精确修复。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后点划线；若仍未命中，日志 `未能在目录中找到匹配章节项` 的 `sample` 会暴露目录面板打开后的真实章节项文本/结构，据此做最后校准。

### 同日续：v0.13.1 内修正「误点自己笔记面板的章节标题」
- **用户反馈**：第五次导日志，目录按钮点击成功但仍未跳转。
- **日志关键**：`点击「目录」按钮呼出目录` → `命中章节项，点击跳转`，但 `matched: "序言1 条"`、`cls: "wre-notes-chapter-title"`——**匹配到的是插件自己笔记面板里的章节标题**（「序言」+ 笔记条数「1 条」），不是微信读书目录面板的章节项；点它自然没跳转。
- **根因**：`findChapterItem` 整页匹配时，笔记面板一直开着，其章节标题（含章节名、文本更短）被优先命中；同时把「点到自己 UI」误判成「命中目录项」。
- **修复（仅 `modules/notes.js`）**：`findChapterItem` 排除插件自身 UI——先排除 `#we-read-enhancer-root` 容器内元素，再排除 `className`/`id` 含 `wre-` 的元素；轮询次数 8→12（约 3 秒），给目录面板更多渲染时间。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后点划线；若仍未命中，日志 `sample` 将首次暴露微信读书目录面板的真实章节项文本（或证明目录面板未打开），据此做最后校准。

### 同日续：v0.13.1 内加「真实点击序列 + 目录容器诊断」
- **用户反馈**：第六次导日志，目录按钮点击后目录面板仍未打开。
- **日志关键**：`未能在目录中找到匹配章节项`，`sample` 里全是底部控制栏/顶栏文字（「目录」「笔记」「上一页」「下一跳」「字号」「深色」等），**没有任何章节列表**（无「序言」「第一课…」）→ 证明点「目录」按钮后**目录面板根本没渲染出来**。
- **根因（推断）**：微信读书用 React，`.click()` 派发的原生 click 可能未触发其事件处理（部分按钮监听 `mousedown`/`pointerdown`/`touchstart`），目录面板未被呼出。
- **修复（仅 `modules/notes.js`）**：① 新增 `simulateClick()`，用完整鼠标事件序列（pointerdown → mousedown → pointerup → mouseup → click）替代 `.click()`；② 失败时新增 `catalogContainers` 诊断——dump 所有 className 含 `catalog/chapter/menu/drawer/panel/sidebar` 的容器（含隐藏的）的 `cls/tag/display/visible/textLen/text`，一次暴露目录面板真实结构。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后点划线；若仍失败，日志 `catalogContainers` 会列出目录面板真实容器的类名与章节项文本，据此做最终一次精确修复。

### 同日续：v0.13.1 内定位到「章节标题」才是目录入口
- **用户反馈**：第七次导日志，`catalogContainers` 首次曝光 DOM 结构。
- **日志关键**：① `renderTargetPageInfo_header_chapterTitle`（SPAN，text「讨论学习环节」）是**当前章节标题**，显示在页面顶部；② `menu_container js_reader_navBarMenu`（display:block、visible:true、**textLen:0**）是目录菜单容器，但**空**（未展开）；③ 底部「目录」按钮 `.readerControls_item.catalog` 点击后菜单仍未展开。结论：翻页模式呼出目录的正确入口是**点章节标题**，而非底部「目录」按钮。
- **修复（仅 `modules/notes.js`）**：`jumpToChapter` 呼出目录顺序改为「章节标题 `.renderTargetPageInfo_header_chapterTitle`/`.renderTargetPageInfo_header` → 底部『目录』按钮 → 顶栏标题（兜底）」。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户重载扩展后点划线；点章节标题后目录应在 `menu_container js_reader_navBarMenu` 展开章节列表，`findChapterItem` 整页匹配应能命中章节项并点击跳转。

### 同日续：v0.13.1 内翻页模式定位降级为「引导切滚动模式」
- **用户反馈**：第八次导日志，点章节标题后目录仍未展开。
- **日志关键**：点 `.renderTargetPageInfo_header_chapterTitle`（「讨论学习环节」）后，`menu_container js_reader_navBarMenu` 的 `textLen` 仍为 **0**（目录菜单始终空、未展开）。
- **根因（已确认）**：微信读书 web 版翻页模式下，目录呼出无法通过内容脚本 `dispatchEvent`（含完整鼠标事件序列）触发——疑似 `isTrusted` 校验或事件绑定位置特殊；「章节标题」「底部目录按钮」均非可靠入口。翻页模式正文在 canvas，本就只能章节级，且章节级 UI 呼出在内容脚本里不可控。
- **决策**：翻页模式定位**降级为明确引导**，不再反复盲试 UI 点击——章节跳转失败时 toast 提示「翻页模式无法精确跳转划线，建议切到『上下滚动阅读』模式后重试，切好后再点笔记即可精确定位」。滚动模式下正文是 DOM 可见文本，文本定位（TreeWalker + scrollIntoView + 高亮）已能精确工作。
- **修复（仅 `modules/notes.js`）**：`jumpToItem` 翻页模式分支失败 toast 改为上述引导文案。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过。
- **待办**：用户在滚动模式下实测「点笔记 → 精确定位 + 绿色高亮」；确认后即可收尾本功能。

### 同日续：v0.13.2 报告补「阅读人格画像」章节
- **用户反馈**：导出报告「缺少对阅读人的阅读内容分析 / 性格行为类型的人格化分析」；要求对比是否满足 PRD 与测试清单。
- **对比结论**：结构满足 PRD/测试清单（人格化分析在 PRD 里本就标注为「尚未覆盖·属主观解读」），但用户期望的「人格画像」层确实缺失——报告停留在「数据罗列」，缺「人格化」收尾。
- **对齐（AskUserQuestion）**：用户选**客观规则化类型画像**（不接原文接口、不做主观语义，守住「禁止主观心理推断」红线）。
- **实现（仅 `modules/official.js`）**：新增 `buildPersona`，按固定阈值把 5 个客观维度归类为类型标签，输出「维度/类型画像/判定依据」三元组，数据不足维度自动省略——完读倾向（≥60% 善始善终 / ≥30% 随性而为 / <30% 广泛涉猎）、笔记投入（平均每本 ≥5 深度精读 / ≥1 适度批注 / <1 少记浏览）、主题聚焦（第一分类占比 ≥50% 主题聚焦 / <30% 且分类≥5 兴趣广博 / 其余 多元均衡）、内容形态（有声书占比 ≥30% 听读兼修 / 否则 以读为主）、阅读时段（峰值 21–5 夜读 / 6–8 晨读 / 11–13 午间 / 其余 日间，仅累计周期）；新增「十三、阅读人格画像」章节（十二之后、附录之前）；附录「分析边界」与「尚未覆盖」措辞同步（价值取向与精神底色注明为主观语义、以十三章客观替代）。
- **版本**：`manifest.json` `0.13.1` → `0.13.2`；`official.js` 头部版本注释同步。
- **校验**：语法检查通过；桩环境冒烟（`/tmp/wre_smoke4.js`）验证十三章渲染——5 个维度标签全部正确（完读倾向=善始善终型 67%、笔记投入=深度精读型、主题聚焦=多元均衡型、内容形态=以读为主型、阅读时段=夜读型 23:00）。
- **文档回灌**：`test/官方数据测试清单.md`（标题 v0.13.2 + 前置补十三章 + 新增 4.30 + 4.21/6.4 同步）、`README.md`（功能行补「阅读人格画像」）、`plan/RPD_需求文档.md`（10.2.3 骨架加十三章、10.5 十三-3「已完成」改 v0.13.2、变更记录加一行）、`plan/version_plan.md`（新增 v0.13.2 段）。
- **待办**：用户重载扩展后按 4.30 实测十三章；时段热力 / 原生 Canvas 图表留待后续。

### 同日续：v0.14.0 AI 人格化执行摘要（DeepSeek，可选）
- **用户目标**：报告「一、执行摘要」目前是规则化文案，缺「人格化」收尾；用户希望接近 workbuddy 那种「有人味」的解读。
- **方案（用户选定）**：**客观数据 + DeepSeek 写文字**——数字本地算准、人格化文字交给 DeepSeek 生成，最接近 workbuddy 效果（不用 AI 算数字，AI 只把已算好的客观统计写成自然语言）。
- **实现**：
  - `background.js`：新增 DeepSeek 转发 `callDeepSeek()`（POST `api.deepseek.com/chat/completions`，`deepseek-chat`，30s 超时）＋ 可选 Key 管理消息 `wre-ai-status` / `wre-ai-save`（须 `sk-` 开头）/ `wre-ai-clear` / `wre-ai-chat`；Key 存 `wreDeepSeekKey`，日志只留掩码。
  - `modules/official.js`：设置面板新增「AI 增强（DeepSeek，可选）」区（独立于 `wrk-` Key）；报告加载成功后若已配 DeepSeek Key 自动触发 `runAIEnhance()`——`fetchAnnualTrend()`（最近 4 年 `annually`）＋ `fetchBookContents()`（笔记最多前 5 本书的 `/book/bookmarklist` 划线 + `/review/list/mine` 想法，各最多 6 条）→ `buildAIPrompt()` 拼客观事实 → DeepSeek → `splitParagraphs()` 分段 → `aiSummary` 写入「一、执行摘要」；未配/失败/空返回则 `aiState='skipped'|'error'` 退回规则化摘要（不阻塞报告主体）。
  - `manifest.json`：`host_permissions` 增 `https://api.deepseek.com/*`，版本 `0.13.2` → `0.14.0`，描述补「含 DeepSeek AI 人格化解读，可选」。
- **版本**：`manifest.json` `0.13.2` → `0.14.0`。
- **校验（本机无 Node，用 JXA 桩环境）**：语法检查 `osascript -l JavaScript` + `new Function()` OK；桩环境冒烟（`/tmp/wre_smoke5.js`）——`splitParagraphs` 分段正确、`buildAIPrompt` 含年度趋势/划线样本、`loadReport` 全链路 `aiState=ok`、AI 摘要 3 段正确写入「一、执行摘要」、Markdown **不含** `object Promise`（此前串接 Promise 的坑已修复）、`md 不含规则化摘要首句` 验证 AI 替换生效。**全部符合预期**。
- **文档回灌**：`test/官方数据测试清单.md`（标题/前置补 v0.14.0 + 新增第十一组 11.1~11.12）、`README.md`（官方数据功能行补「可选接入 DeepSeek」+ 结构注释）、`plan/RPD_需求文档.md`（新增 10.2.9 + 10.5 十三-7 + 10.6 风险三行 + 变更记录一行）、`plan/version_plan.md`（新增 v0.14.0 段）、`release/privacy.md` 与 `web/content/隐私政策.md`（新增 AI 增强小节 + 权限/域名说明）。
- **待办**：用户重载扩展后按第十一组实测（重点 11.5 AI 摘要替换、11.10 隐私红线、11.8 失败退回）；通过后归档。

### 同日续：v0.14.1 移除「点击笔记跳转定位原文」功能
- **用户反馈**：「这个功能去掉，不用跳转了」——因翻页模式下微信读书 web 版正文画在 canvas、目录呼出又不受内容脚本 `dispatchEvent` 控制（历经 8 轮排查确认），跳原文功能始终无法可靠工作，用户决定直接移除。
- **实现（仅 `modules/notes.js`）**：删除整个「跳原文」功能块——`findTextInPage` / `normalizeForMatch` / `revealNode` / `locateTextInReader` / `detectCanvasMode` / `wait` / `simulateClick` / `jumpToChapter` / `findChapterItem` / `jumpToItem` / `handlePendingJump`；同步删除状态 `jumpTargets`、常量 `PENDING_JUMP_KEY`/`PENDING_JUMP_TTL`、条目渲染里的 `data-wre-notes-jump` 属性与 `title="点击尝试定位到原文"`、面板底部「点击任意条目会尝试定位」提示、`handlePanelClick` 的跳转分支、`attach()` 里的 `handlePendingJump()` 调用；头部注释第 7 点删除。
- **版本**：`manifest.json` `0.14.0` → `0.14.1`。
- **校验**：`osascript -l JavaScript` + `new Function()` 语法检查通过；`GetDiagnostics` 无新增错误（仅余既有的 `execCommand`/`document.write` 弃用、`highlightGroups`/`isPanelOpen` 类型提示）。
- **文档回灌**：`README.md`（功能行删「可跳回原文」）、`test/笔记增强测试清单.md`（删跳原文测试项 3A.6/6.1/6.3/6.4/6.6）、`plan/RPD_需求文档.md`（跳原文标注已移除）、`plan/version_plan.md`（补 v0.14.1 移除段）。

### 同日续：v0.14.2 API Key 集中入口
- **用户需求**：把散在「官方数据面板 → ⚙️ 设置」页签里的两个 Key（微信读书 `wrk-`、DeepSeek `sk-`）集中到一个独立入口「🔑 API Key」，单独做成一个功能入口统一填写。
- **决策（AskUserQuestion 确认）**：入口命名为「🔑 API Key」放进现有「设置」分组；官方数据面板移除旧「⚙️ 设置」页签，Key 只在新入口填。
- **实现**：
  - `modules/official.js`：移除面板页签栏，官方数据面板只留「📊 阅读行为报告」；新增独立弹层 `#wre-api-key-modal`（`buildKeyPanel` / `renderSettings` / `openKeyPanel` / `closeKeyPanel`），集中展示 `wrk-` Key 与 DeepSeek Key 两个配置区；`render` 只画报告、`renderSettings` 只画 Key 配置；`openPanel`/`openKeyPanel` 互斥；主菜单注入「🔑 API Key」（插在「恢复默认」之后）；报告空态按钮与 `wre-open-key-settings` 事件均改打开新面板。
  - `content.js`：`handleMenuClick()` 增 `case 'api-key'` 分流。
  - `modules/notes.js`：引导态/警示条/注释文案统一由「☁️ 官方数据 → 设置」改为「🔑 API Key」，按钮图标 `⚙️` → `🔑`。
  - `manifest.json`：版本 `0.14.1` → `0.14.2`。
- **版本**：`manifest.json` `0.14.1` → `0.14.2`。
- **校验**：`notes.js` 旧文案 grep 已清零；待 `GetDiagnostics` 确认无新增错误。
- **文档回灌**：`plan/RPD_需求文档.md`（10.2.1 面板位置 / 10.2.9 / 10.3 UI / 10.5 十三-8 / 变更记录）、`plan/version_plan.md`（新增 v0.14.2 段 + 版本对照表）、`test/官方数据测试清单.md`（1.3/2.1/2.2/第十一组文案 + 新增第十二组 12.1~12.10）、`test/笔记增强测试清单.md`（引导态跳转文案）、`README.md`（功能行 + 结构注释）、`release/privacy.md` 与 `web/content/隐私政策.md`（「⚙️ 设置」改为「🔑 API Key」）。
- **待办**：用户重载扩展后按第十二组实测（重点 12.1 菜单入口、12.4 无旧页签、12.5 双面板互斥、12.7/12.8 两个 Key 都能在新入口配）。

---

## 2026-10-04 会话条目：需求方案（网站生态补齐 + 阅读人格 16 型）(方案已定稿，未开发)
- **目标**：把两块需求固化成可开发的文档——① 网站生态 RPD 补齐待定项 + 新增「API Key 使用说明」；② 新增「阅读人格（读书人版 MBTI）」需求。
- **已做**：
  - 网站生态 RPD（`plan/RPD_网站生态_需求文档.md`）：v0.3 把三处待定转已确认（知识资产首版沿用 4 篇；无自有域名、用帽子云自动分配域名；Obsidian 用独立 vault `web/content/`）；v0.5 新增「API Key 使用说明页」需求。
  - 新建 `plan/RPD_阅读人格_需求文档.md`（v0.1.1）：四维模型 + 16 型命名 + 人格卡 + 词语分析 + 边界红线 + 阶段/验收/风险。
  - 事实核对：以 `background.js`、`modules/official.js` 为准，核对两把 Key（`wrk-` / `sk-`）的获取、保存即校验、存储位置、掩码日志、DeepSeek 外发范围与错误文案；核对现有画像实现（`buildPersonaTags`、`AI_PERSONA_PROMPT`、`runAIEnhance`）。
  - 资料调研：MBTI 四维与 16 型中文命名；已有先例 `wereadwave.cn`「阅读人格画像」、SLCP 四维框架；通用 MBTI 结果页信息骨架。
- **关键结论/决定**：
  - 网站「API Key 使用说明」写成「功能教程」独立一篇（`guide/api-key`），必须覆盖 6 段（是什么 / 怎么获取 / 怎么配 / DeepSeek 可选 / 隐私 / 错误对照）；红线：示例只用占位符、全篇不出现真实 Key、不引导把 Key 发给他人。
  - 阅读人格**不套 MBTI 原版四维**（E/I、S/N 无法从行为数据推出），改用可算的阅读四维：深潜 D/广撒 B · 求实 F/求意 M · 理性 L/感性 E · 计划 P/随兴 R → 16 型。
  - 三处待定经确认：采用本文四维；16 型称号先用初稿；**V1 只做在插件报告内**（分享卡与网站栏目延后 P1）。
  - 定位：结构化判定（本机规则、可复算、带证据）为主，AI 仅润色；**不改动**现有 10.2.9 / 10.2.10 / 十三章内容。
- **产出物（文件/链接）**：
  - `plan/RPD_网站生态_需求文档.md`（v0.5）
  - `plan/RPD_阅读人格_需求文档.md`（v0.1.1，V1 需求基线）
- **待办**：
  - 开发未开始（用户明确「只管分析需求」）；开工时从「十四-1 四维判定 + 人格卡」起步。
  - 网站侧：`guide/api-key` 文章待写；另发现线上「功能教程」缺「主题切换」一篇（待定是否补）。
- **风险/注意事项**：
  - 阅读人格最大技术风险：中文分词零依赖（不可引 jieba），方案为停用词 + n-gram，验收量化为「TOP10 至少 6 个是人话词」。
  - 合规：对外不使用 MBTI® 商标名、不用「科学 / 准确率」表述，页面固定声明「非心理测评、非专业鉴定」。
  - 口径：报告内所有数字须与主体一致，禁止两处数字打架；判定不依赖 AI，保证可复算。

## 2026-10-04 会话条目：需求追加（阅读人格 · 手机版分享图）(已定稿，未开发)
- **目标**：在 `plan/RPD_阅读人格_需求文档.md` 中加入「输出手机版图片、一键复制分享给朋友圈/朋友」的需求。
- **已做**：新增 3.10「手机版分享图与一键分享」；同步更新 0 需求三件事、2 总览表、4 UI·UX、5 技术实现、6 分阶段（十四-5）、7 成功标准、8 风险；更新附 A-1 已确认项与附 B 变更记录；文档版本 v0.1.1 → **v0.2**。
- **关键结论/决定**（用户确认）：
  - 分享图**进 V1 必做（P0）**，不再是 P1；
  - **V1 不放二维码**，仅以文字域名署名；
  - 图片内容四块全要：人格卡主体 + 词语分析亮点（TOP3 词 + 口头禅）+ 数据证据 + 品牌署名；
  - 规格：竖版宽 1080、高自适应；固定浅色底；系统字体；Canvas 2D 零依赖；一键「复制图片」为主、下载 PNG 兜底；
  - 红线：不做「直接唤起微信/发朋友圈」（浏览器无此能力）；不擅自新增权限（保持 manifest 仅 storage），图片写剪贴板不可用时降级为下载。
- **产出物（文件/链接）**：`plan/RPD_阅读人格_需求文档.md`（v0.2）；`plan/RPD_网站生态_需求文档.md`（v0.5，未改）。
- **待办**：开发未开始（用户明确「只管分析需求」）；开工起点仍为「十四-1」，分享图排在「十四-5（P0）」。
- **风险/注意事项**：剪贴板写图片兼容性（实测为准、留下载兜底）；分享图内容过多影响手机可读性（只留亮点）；分享图须不含账号标识/隐私字段。

---

## 2026-10-04 会话条目：网站 v0.18.0 部署上线 + 版面优化
- **目标**：把配套文档站更新到 v0.18.0 内容并上线，同时按用户反馈优化版面；顺带修正商店上架文档里的网站地址。
- **已做**：
  - 版面优化（`web/assets/site.css`）：正文区宽度收为占窗口 80%（`--max-width: min(1920px, 80vw)`，原 `96vw`）。
  - 栏目索引页（功能教程 / 进阶技巧 / 知识资产）：去掉标题前重复输出的 13px 灰色描述段（`web/build.py`）；卡片标题 `1em → 1.05em`、描述 `14px → 0.95em`。
  - 修卡片左错位：`.card-list` 的 `padding: 0` 被 `.doc ul { padding-left: 22px }`（优先级 0,1,1）盖过，改用 `.doc .card-list`（0,2,0）胜出，卡片左边缘与 h1/正文对齐（浏览器实测差值 0px）。
  - 商店上架文档「网站 URL / 主页 URL」由 GitHub 仓库改为配套站点 `https://wereadapp-32km31c.maozi.io`（`plan/plan_edge_store.md`、`plan/plan_chrome_store.md`、`plan/plan_360_store.md`）。
  - 本地 `python3 web/build.py`（19 页 + 3 栏目索引）→ 更新 `site-dist` orphan 分支 → 帽子云控制台「立即部署」（用户操作）。
- **关键结论/决定**：
  - 帮助文档关联地址，代码侧（`modules/help.js` 的 `SITE_BASE`、`manifest.json` 的 `homepage_url`、`web/site.config.json` 的 `baseUrl`）本就已是主域名，唯一需改的是**商店后台/上架文档里的「网站 URL」**。
  - 帽子云**主域名 `https://wereadapp-32km31c.maozi.io` 跟随最新部署**；带随机前缀的是那次部署的专属快照 URL，勿当"稳定别名"回填。
  - 页脚版本号与插件「最新版本」都读 `manifest.json`，单一事实源不变。
- **产出物（文件/链接）**：
  - 线上站点：`https://wereadapp-32km31c.maozi.io`（`site-dist` HEAD `3fc4e37 deploy: v0.18.0 网站更新（栏目索引页去描述段 + 样式微调）`）
  - 改动文件：`web/assets/site.css`、`web/build.py`、`plan/plan_edge_store.md`、`plan/plan_chrome_store.md`、`plan/plan_360_store.md`
  - 部署记录：`plan/session_handoff_网站帽子云部署.md` 7.3 节（第四次部署）
- **待办**：
  - 商店后台（Edge Partner Center / Chrome 开发者后台 / 360 应用中心）的「网站 URL」需用户改成 `https://wereadapp-32km31c.maozi.io`（文档已改，平台侧待用户操作）。
  - 可选：静态资源加版本指纹（`site.css?v=X.Y.Z`）以根治 CDN/浏览器缓存问题（曾提议，未批准）。
- **风险/注意事项**：
  - 帽子云走 Cloudflare，静态资源 `cache-control: max-age=1200`（约 20 分钟全网刷新），不同节点可能缓存不同副本——排查样式改动须绕缓存（`?_cb=` 缓存戳 + `fetch(..., {cache:'reload'})`）。
  - 帽子云无 webhook，push 不自动部署，更新后须在控制台手动「立即部署」（分支下拉为空，须手输 `site-dist`）。

## 2026-10-04 会话条目：需求追加（阅读人格 · 分享图人物插画）(仅改需求，未开发)
- **目标**：在 `plan/RPD_阅读人格_需求文档.md` 的「手机版分享图」中加入「图片里要有一个很有名的、非宗教非政治的人物形象」需求。
- **已做**：3.10 图片内容新增第 1 块「人物插画」并给出 16 型人物对照（初稿）；同步 0 需求三件事、2 总览表（新增「人物插画」行）、4 UI·UX、5 技术实现（`modules/persona-figures.js` + 内联 SVG）、6 阶段（十四-5）、7 成功标准、8 风险、附 A-1、附 B；文档版本 v0.2.3 → **v0.3**。
- **关键结论/决定**（用户确认）：
  - 人物范围：**公共领域世界级文化名人**（文学家 / 科学家 / 艺术家）；
  - 对应关系：**16 型各配一个专属人物**（非共用、非按四大族群各一个）；
  - 风格：**自绘线描 / 版画风**；
  - 硬约束：**只能用内置自绘插画**——不用真人照片、不联网抓图、不引外链；**排除宗教人物与政治人物**（僧侣 / 教皇 / 君主 / 将领 / 政治家）。
- **产出物（文件/链接）**：`plan/RPD_阅读人格_需求文档.md`（v0.3）。
- **待办**：本次**只改需求、不做开发**（用户明确）；插画落地排在「十四-5（P0）」；16 型人物对照为初稿，落地前可再调。
- **风险/注意事项**：名人形象涉肖像权 / 版权（只用公有领域 + 自绘）；人物"涉宗教 / 政治"踩线（清单逐条过审、进测试清单）；16 张插画工作量大 / 体积涨（线描头像、单张 ≤8KB、合计 ≤~130KB）。

## 2026-10-04 会话条目：需求追加（网站 · 产品展示图库栏目）(仅改需求，未开发)
- **目标**：在 `plan/RPD_网站生态_需求文档.md` 中新增一个网站栏目，单独展示所有产品展示图片。
- **已做**：新增 3.9「产品展示图库」（P0）；同步 1.2 复刻对照表、2.1 总览表、3.1 目录树（`产品展示/`）、3.2 页面清单（`/showcase/`）、3.4 顶部导航、4.2 UI、5.4 构建步骤（新增第 7 步扫描图库）、6 新增「阶段六」、7 成功标准（第 11 条）、8 风险表、附 A（条数 9→11）、附 B-2、附 C；文档版本 v0.5 → **v0.6**。
- **关键结论/决定**（用户确认）：
  - 栏目形态：**分组图库**（缩略图网格 + 点击看大图 lightbox）；
  - 展示范围：**真实界面截图 + 站点宣传图**（商店素材暂不纳入，后续可另加分组）；
  - 图片来源：作者**已在其他会话 / 工具生成的成品图**，**存放地址待用户提供**（拿到后再定稿源目录）；
  - 栏目路径初稿：`/showcase/`，导航名「产品展示」；源目录初稿 `web/content/产品展示/`。
- **产出物（文件/链接）**：`plan/RPD_网站生态_需求文档.md`（v0.6）。
- **待办**：等用户提供**图片存放地址**后定稿图库源目录并落实阶段六；本次**只改需求、不做开发**。
- **风险/注意事项**：图内混入真实 Key / 隐私（逐图检查）；旧图与新版界面不一致（发版即同步、标注适用版本）；图体积拖慢加载（构建生成缩略图、保持零第三方请求）；「产品展示」偏宣传与站点"像文档"定位冲突（独立栏目 + 图注中性化）。

---

## 2026-10-04 会话条目：移动端（微信小程序）需求分析定稿（仅需求，未开发）
- **目标**：分析移动端定位（阅读数据行为分析展示渠道），产出需求文档；**本任务只做需求分析，不做开发**。
- **已做**：
  - 核实关键前提：官方网关有 CORS 限制（依据 `background.js` 注释），移动端必须中转；确认**云函数出网不受小程序 request 域名白名单限制**，可做中转。
  - 产出需求文档 `plan/RPD_小程序移动端_需求文档.md`（v0.1），含功能总览、详细需求、UI、技术方案、分阶段、成功标准、风险表。
  - 过程纠偏：上一轮误做了开发（建 `mobile/` 代码），经用户确认后**已全部回退删除**，恢复到「只有需求文档」的状态。
- **关键结论/决定**（用户确认「按推荐来」）：
  - 形态：**微信小程序 + 云开发**；Key **只存手机本机**（不登录、不绑定微信账号）。
  - 底部 Tab：首页 / 人格 / 报告 / 我的（书架、笔记归入「我的」，P1）。
  - 分享：首版先做「转发小程序卡片」，竖版分享图放阶段 2。
  - 静默 openid：**首版不做**；头像昵称不做（`wx.getUserProfile` 已不适用，需主动填写）。
  - 数据字段口径对齐插件：`/readdata/detail` 的 `totalReadTime`/`readDays`/`dayAverageReadTime`/`compare`/`readStat`/`readTimes`/`readLongest`；mode = weekly/monthly/annually/overall。
- **产出物（文件/链接）**：
  - `plan/RPD_小程序移动端_需求文档.md`（唯一产出）
- **待办**：
  - 阶段 1：阅读人格（从 `official.js` 抽纯计算为 `persona-core`）、阅读行为报告（`report-core`）。
  - 阶段 2：转发小程序卡片 + 竖版分享图、书架、笔记。
  - 阶段 3：隐私保护指引、类目确认、提审上线。
  - **以上均待用户明确确认后再进入开发。**
- **风险/注意事项**：
  - 云函数中转 Key 属「内存中转、不存储」，但隐私声明需如实改写（Key 会经过服务）。
  - 云开发按量计费，开通时确认当前免费额度；接口做缓存减少调用。
  - 官方网关/风控可能变化（`skill_version` 集中一处便于升级）；小程序审核涉及类目与第三方数据可能被追问。
  - 教训：需求阶段严格只出文档，**未经确认不写代码**（gen-rpd 红线）。

---

## 2026-10-04 会话条目：开发网站「图库」专属栏目（已落地，未发布）
- **目标**：按 RPD 3.9 把网站「图库（界面图库）」栏目从草稿做成可用功能——分组图墙 + 缩略图 + 点击放大。
- **已做**：
  - 构建端 `web/build.py`：
    - 新增 `generate_thumbnails()`：为 `web/assets/img/gallery/` 原图生成缩略图到 `dist/assets/img/gallery/thumbs/`（长边 ≤1400、JPEG q82、RGBA 自动垫白底）；Pillow 可选，未装则告警并退回原图，构建不中断。
    - 新增 `render_gallery_image()` + `gallery_thumb_url()`：把图库图渲染为 `<a class="wre-gal-link" href=原图 data-full=原图 title=alt><img src=缩略图 loading="lazy"></a>`；`render_std_image` 增加图库分支。
    - 调整 `build()` 顺序：`copy_assets()` + `generate_thumbnails()` 提到页面渲染之前（渲染时按缩略图可用性决定引用）。
  - 样式 `web/assets/site.css`：多列图墙（`.doc p:has(> a.wre-gal-link)`，默认 46.5%、≥1400px 30.3%、≤860px 100%）+ lightbox 覆盖层样式（`.wre-lightbox` / `body.wre-lb-open` 锁滚动）。
  - 交互 `web/assets/site.js`：新增零依赖 lightbox IIFE——点缩略图弹大图 + 图注，`Esc` / 点背景 / 点 × 关闭。
  - 内容 `web/content/界面图库.md`：顶部介绍句补「点击任意图片可看大图（按 Esc 或点空白处关闭）」。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md`：v0.7 → **v0.8**，覆盖 1.2 / 1.5 / 2.1 / 3.1 / 3.2 / 3.4 / 3.9 / 4.2 / 5.4 / 6.6 / 7 / 附 B / 附 C 共 12 处。
- **关键结论/决定**（用户经提问确认）：
  - 路径与导航名：**沿用现有 `/gallery/` +「图片」**（推翻原规划的 `/showcase/` +「产品展示」）。
  - 展示形态：**分组网格 + 点击放大（lightbox）**。
  - 商店尺寸素材：**纳入本栏目**（磁贴 / 截图 / 效果图，与草稿一致）。
- **产出物（文件/链接）**：
  - `web/build.py`（缩略图生成 + 图墙图渲染 + build() 重排）
  - `web/assets/site.css`、`web/assets/site.js`（图墙 + lightbox）
  - `web/content/界面图库.md`（7 组图墙，38 张图）
  - `plan/RPD_网站生态_需求文档.md`（v0.8）
  - 构建结果：`python3 web/build.py` → 页面 25 篇 + 栏目索引 4 个 / 版本 v0.19.0 / 告警 0 条；缩略图 38 张 ≈4.1MB（原图 ≈26MB）。
- **待办**：
  - 可选：发布到线上（沿用 orphan 分支流程推 `site-dist`，帽子云部署由用户自理）。
  - 遗留（非本轮）：GitHub 侧 `site-dist` 待网络恢复后重推（Gitee 已成功）；清理 worktree `/tmp/weredeploy` 与分支 `site-dist-new`。
- **风险/注意事项**：
  - Pillow 为构建的**唯一软依赖**：装了才出缩略图，未装则页面直接引用原图（体积大但可用）。
  - 图墙多列依赖 CSS `:has`，老浏览器降级为逐张整行（仍可正常浏览）。
  - 浏览器核验时曾命中缓存的旧 `site.js`（无灯箱）与窄窗单列，均非代码缺陷——强制刷新即好。
  - 商店素材红线：文案 / 尺寸与 `manifest.json`、实际界面一致，不夸大（延续项目规则）。

---

## 2026-10-04 会话条目：网站首页与图库改版需求（大图 · 极简 · 顺滑）(仅改需求，未开发)
- **目标**：用户反馈「首页效果展示不好、全是图片」，要求改成**响应式、大图少文字、图片顺滑**的展示效果，并重列首页需求。
- **澄清**：现存 `/` 首页实为**纯文字**（卖点列表 + 三步开始 + 知识资产引导），「全是图片」的是 `/gallery/` 图库页；经提问确认**两个页面都改**、文字保留到「**大图为主 + 极简文案**」。
- **已做**：`plan/RPD_网站生态_需求文档.md` v0.9 → **v0.10**：
  - 新增 **3.11「首页落地页」**（重列首页需求）：Hero 主视觉大图 + 功能大图区（一屏一组）+ 极简能力清单 + 知识资产入口 + 安装 CTA；文字极简（主标/副标各 ≤1 句、功能标题 ≤12 字、补充 ≤30 字）；滚动**渐入** + 悬停**微放大**（原生 CSS `transition` + JS `IntersectionObserver`，200–400ms，`prefers-reduced-motion` 降级为静态）；响应式三档（≥1024 / 768–1023 / <768）；首屏**零第三方请求**。
  - **3.9 图库**：由「缩略图小网格」改为**响应式大图** + 极简文案 + 顺滑渐入（保留 lightbox）。
  - 同步 1.2、3.2、4.1（新增"展示型页面是例外"）、4.2、5.4（新增第 10 步：动效资源）、6 新增**阶段八**、7 新增第 13 条成功标准、8 新增 4 条风险、附 A（条数 → 13）、附 C。
- **关键结论/决定**（用户确认）：**大图为主 + 极简文案**；**两个页面都改**；动效只用**原生 CSS/JS**、不引第三方动画库；首页 / 图库为「**展示型页面例外**」，正文类页面仍保持文档风。
- **产出物（文件/链接）**：`plan/RPD_网站生态_需求文档.md`（v0.10）。
- **待办**：本次**只改需求、不做开发**；改版落地排在**阶段八（P0）**，待用户明确指令。
- **风险/注意事项**：大图体积（懒加载 + 缩略图优先）；低端机 / 大图下动效卡顿（只动 `transform`/`opacity` + `prefers-reduced-motion` 降级）；首页改版偏离"像文档"定位（限定为例外）；首页大图与插件当前界面脱节（发版即同步、标注适用版本）。

---

## 2026-10-04 会话条目：阶段八落地 · 首页与图库改版（大图 · 极简 · 顺滑）(完成)
- **目标**：按 RPD v0.10 的 3.9 / 3.11 / 6.8，把首页改为**大图落地页**、图库改为**响应式大图**，并加入滚动渐入动效。
- **已做**：
  - 构建端 `web/build.py`：
    - `collect_pages()` 增 `heroTitle` / `tagline` / `hero` front-matter 字段 + `reveal` 开关。
    - 新增 `render_home()` + `home_install_button()`：首页 = Hero（主标 + 副标 + 安装/快速上手按钮 + 主视觉大图）+ 正文 + 底部 CTA（安装 / 快速上手 / 更新日志 · 隐私 · 图库）。
    - `build()` 主循环：`slug == ""` 走 `render_home()`，`body` 加 `.home` 类并开启 `reveal`。
    - `render_gallery_image()` 加 `wre-reveal`；`render_std_image()` 仅在**图库页**才包成灯箱链接，其他页面（首页）按普通大图输出并可选 `wre-reveal`；标题/纯文字段落按 `reveal` 加渐入类。
  - 内容 `web/content/首页.md`：重写为极简大图结构——Hero（front-matter）+ 6 个功能大图块（专注与勿扰 / 沉浸阅读 / 阅读统计与导出 / 笔记增强 / 阅读洞察 / 阅读人格，标题 ≤12 字、补充 ≤30 字）+「还能做什么」6 条图标清单 + 知识资产入口。
  - 样式 `web/assets/site.css`：图库由 3–4 列小网格改为**宽屏两列大图 / <768 单列**（圆角 + 边框 + 悬停微放大 + 阴影抬升）；新增首页落地页样式（Hero / 功能大图区 / 两列 chip 清单 / 底部 CTA）；新增通用滚动渐入 `.wre-reveal`（380ms，`prefers-reduced-motion: no-preference` 下生效）。
  - 交互 `web/assets/site.js`：新增 `IntersectionObserver` IIFE——进入视口加 `.wre-in` 触发渐入 + 上移；`prefers-reduced-motion` 或不支持 IO 时直接显示。
  - 模板 `web/templates/layout.html`：head 加 `<noscript>` 兜底，JS 关闭时 `.wre-reveal` 直接显示。
  - 文档回灌：`plan/RPD_网站生态_需求文档.md` 6.8 五项勾选（首页大图落地页 / 图库响应式大图 / IO 动效 / 懒加载+缩略图 / 三档核验）。
- **关键结论/决定**：
  - 首页走**独立渲染路径**（`render_home`）而非纯 Markdown 拼装；正文仍是 Markdown，构建只注入 Hero 与 CTA。
  - 灯箱只在**图库页**生效（`render_std_image` 按 `slug == "gallery"` 判定），首页大图点击不弹灯箱。
  - 首页大图用**原图 + `loading="lazy"`**（画质优先）；图库用**缩略图**（体积优先）。
  - 知识资产入口因**暂无合适配图**，暂为「一句话 + 链接」，已在 6.8 标注后续补图。
- **产出物（文件/链接）**：
  - `web/build.py`（render_home / home_install_button / front-matter 字段 / reveal 渲染）
  - `web/content/首页.md`（大图落地页内容）
  - `web/assets/site.css`、`web/assets/site.js`（大图布局 + 渐入动效）
  - `web/templates/layout.html`（noscript 兜底）
  - 构建结果：`python3 web/build.py` → 页面 25 篇 + 栏目索引 4 个 / 版本 v0.19.0 / 告警 0 条；缩略图 38 张。
  - 浏览器核验：首页 Hero / 6 大图区 / chip 清单 / CTA 全部就位且渐入正常；图库宽屏两列大图 + 灯箱（Esc / 点背景 / × 关闭）正常；1200px / 700px 两档无横向溢出。
- **待办**：
  - 可选：发布到线上（沿用 orphan 分支推 `site-dist`，帽子云部署由用户自理）。
  - 后续：为首页「知识资产入口」补一张合适配图。
- **风险/注意事项**：
  - 图库懒加载图片未预留 `aspect-ratio`，加载完成前高度为 0，存在轻微布局位移（CLS，非阻断）。
  - 「极速跳转」掠过的元素会停在 `opacity:0`，再次进入视口才现身（IntersectionObserver 正常懒现身行为，非永久卡死）。
  - 首页大图用原图，单图体积较大，靠 `loading="lazy"` 控制首屏开销。

---

## 2026-10-04 会话条目：首页补「开源地址」与「作者的话」(完成)
- **目标**：承接阶段八首页改版，按用户两次追加要求——① 首页**最前方**加 GitHub / Gitee 地址；② 把一段「初心 / 作者的话」放首页合适位置、文字可优化。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：
    - 新增 `topbar`：`<nav class="home-toplinks">开源地址 · GitHub · Gitee</nav>`，置于 `render_home()` 返回值**最前**（Hero 之前）；链接取自 `CONFIG["repoUrl"]` 与 `CONFIG["giteeUrl"]`（后者有值才输出）。
    - callout 渲染：整块加 `wre-reveal`，内部改用 `dict(page, reveal=False)` 渲染（避免「空框先出现」再填字的观感）。
  - 内容 `web/content/首页.md`：末尾（知识资产之后、CTA 之前）追加 callout「我为什么要做这个」——两段：动机（市面无合意工具→自用→同类需求不止我一个）+ 承诺（做**产品**而非工具、长期打磨、**永久免费、无广告**）。
  - 样式 `web/assets/site.css`：新增 `.home-toplinks`（居中、`·` 分隔、hover 变强调色）；新增 `.home .doc .callout`（限宽 46em 居中、左强调边、标题放大）卡片样式。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 页面结构：6 条 → **7 条**（第 1 条补「最前方附一行开源地址（GitHub / Gitee）」；新增第 5 条「作者的话」，注明放于知识资产之后、CTA 之前）。
- **关键结论/决定**：
  - 开源地址用**独立一行 topbar**（非塞进 Hero），保证「最前方」且不抢主视觉。
  - 作者的话用 **callout 卡片**承载（与文档风一致），文案由口语化改写为克制两段，加粗「产品」「永久免费、无广告」。
- **产出物（文件/链接）**：
  - `web/build.py`（topbar + callout 渐入调整）
  - `web/content/首页.md`（作者的话 callout）
  - `web/assets/site.css`（`.home-toplinks` / `.home .doc .callout`）
  - `plan/RPD_网站生态_需求文档.md`（3.11）
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0；浏览器核验（浅色 / 深色）卡片位置与渐入正常、无溢出。
- **待办**：
  - 可选：发布到线上（沿用 orphan 分支推 `site-dist`，帽子云部署由用户自理）。
- **风险/注意事项**：
  - 无 Gitee 地址时 topbar 只输出 GitHub（条件已处理）。
  - 核验时曾遇「已存在标签页」缓存旧页（无 callout），硬刷新即好，非代码缺陷。

---

## 2026-10-04 会话条目：首页最顶部预留「微信小程序入口」(完成)
- **目标**：用户要求在首页**最顶部**加入微信小程序入口——「暂时开发中，先预留」。
- **已做**：
  - 配置 `web/site.config.json`：新增 `"miniappUrl": ""`（空 = 未上线占位；填链接即自动变为可点击入口）。
  - 构建端 `web/build.py`（`render_home()`）：新增 `miniapp` 行，置于 `topbar`（开源地址）**之上**、Hero 之前——即主内容**最顶部**。
    - 未配置链接：`<nav class="home-miniapp is-soon">微信小程序 + <span>开发中 · 敬请期待</span></nav>`（占位、不可点）。
    - 配置了 `miniappUrl`：输出可点击 `进入 →` 链接。
  - 样式 `web/assets/site.css`：新增 `.home-miniapp` 系（居中、`flex-wrap`、灰色标签 + 虚线药丸 `.home-miniapp-status`、`.home-miniapp-link` 强调色）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11：页面结构由 7 条改为 **8 条**，新增第 1 条「页面最顶部：微信小程序入口（预留）+ 开源地址」，原 Hero 起顺延。
- **关键结论/决定**：
  - 入口放在**首页主内容最顶部**（开源地址之上），与「开源地址」同为独立一行、不抢主视觉。
  - 「预留」用**配置开关**实现：`miniappUrl` 为空即显示「开发中」占位，未来填链接一键启用，无需改模板。
- **产出物（文件/链接）**：
  - `web/site.config.json`、`web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：入口位于「开源地址」之上、居中、灰色标签 + 虚线药丸；1280px / 390px 两档均无横向溢出、无控制台报错。
- **待办**：
  - 小程序上线后：把小程序码/链接填入 `site.config.json` 的 `miniappUrl` 即可启用入口。
- **风险/注意事项**：
  - 小程序正式入口形态（链接 or 二维码）未定，当前仅占位文案，后续可能需改为展示小程序码。

---

## 2026-10-04 会话条目：首页「开源地址」改为按钮样式(完成)
- **目标**：用户要求把首页「开源地址 GitHub · Gitee」的展示优化，**按「安装到 Edge」的样式**（即按钮化）。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：GitHub / Gitee 由纯文本链接改为 `<a class="home-btn">`（复用首页按钮组件），分隔符 `·` 去掉、改由 flex 间距分隔。
  - 样式 `web/assets/site.css`：`.home-toplinks` 改为按钮行（`gap: 10px`、居中），移除旧的 `.home-toplinks a` 文本色规则，让 `.home-btn` 样式生效。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 1 条：注明开源地址为「按钮样式，与『安装到 Edge』同款的次级按钮」。
- **关键结论/决定**：GitHub / Gitee 用**次级按钮**（白底描边胶囊，即「安装到 Edge」同组件的非主色变体），与主 CTA（绿色「安装到 Edge」）形成主次层级，不抢主视觉。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：GitHub / Gitee 为胶囊按钮、padding/圆角与 Edge 按钮一致（白底次级）；行顺序「小程序 → 开源地址 → Hero」正确；无横向溢出、无控制台报错。
- **待办**：无。
- **风险/注意事项**：
  - 初版误用 `.home-btn-sm` 想缩小按钮，但该规则定义在 `.home-btn` 之前被后者覆盖（同优先级后者胜），属无效类；已删除该无效类，直接沿用 `.home-btn` 尺寸，与 Edge 按钮完全一致。

---

## 2026-10-04 会话条目：首页「作者的话」移到顶部(完成)
- **目标**：用户要求把首页「我为什么要做这个」这段从原来位置**放到顶部**。
- **已做**：
  - 内容 `web/content/首页.md`：把 `> [!note] 我为什么要做这个` callout 从正文**末尾（知识资产之后、CTA 之前）**移到正文**最前**（紧接 Hero，位于首个 `## 专注与勿扰` 之前）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11：页面结构顺序调整——「作者的话」由第 6 条上移为**第 3 条**（紧接 Hero、正文顶部）；功能大图区 / 能力清单 / 知识资产入口顺延为 4 / 5 / 6，末尾 CTA / 页脚不变。
- **关键结论/决定**：作者的话作为「**前言**」置于 Hero 之后、功能大图区之前，读者第一眼看到主视觉后紧接读到作者动机与「永久免费、无广告」承诺。
- **产出物（文件/链接）**：
  - `web/content/首页.md`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0；生成 HTML 顺序核对为「小程序 → 开源地址 → Hero → 作者的话(callout) → 功能大图区…」。
- **待办**：无。
- **风险/注意事项**：callout 仍在首屏附近，滚动渐入（IntersectionObserver）在加载即入视口时会立即现身，无异常。

---

## 2026-10-04 会话条目：首页 Hero 文案排版美化(完成)
- **目标**：用户反馈 Hero 主标「让微信读书网页版更好用」与副标「屏占比、自动阅读…一个插件全搞定」**太素、没有美感**，要求调整样式。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：副标按「——」拆分为两层——`.home-hero-sub-list`（功能清单）+ `.home-hero-sub-punch`（结语）；无「——」时按整句渲染。
  - 样式 `web/assets/site.css`：
    - `.home-hero` 顶部加柔和**绿色光晕**（`radial-gradient(... var(--accent-soft) ...)`，随明暗配色）。
    - `.home-hero-title`：加大加粗（`clamp(2.1em,4.4vw,3.1em)` / `font-weight:800` / `letter-spacing:-0.015em` / `text-wrap:balance`）+ **青绿渐变字**（`@supports` 包 `background-clip:text`，不支持则退回纯色）。
    - `.home-hero-sub`：限宽 38em、行高 1.7、字距微调；`.home-hero-sub-punch`：强调色、加粗、略放大、另起一行。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：补充主标渐变 / 副标分层 / 顶部光晕的视觉要求。
- **关键结论/决定**：Hero 走「大标题 + 分层副标 + 柔光」的展示型排版，与首页「大图落地页」定位一致；渐变与光晕均用 CSS 变量，明暗两套自动适配。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验（浅色 + 深色）：主标 38.8px/800 且 `background-clip:text` 生效、渐变深灰→绿；副标两行分层（灰 + 绿、后者更大更粗）；顶部光晕可见；无横向溢出、无控制台报错。
- **待办**：无。
- **风险/注意事项**：渐变字依赖 `background-clip:text`，已用 `@supports` 兜底；副标分层依赖 tagline 含「——」，缺失时自动降级为整句。

---

## 2026-10-04 会话条目：首页小程序占位简化 + 开源地址并入按钮组(完成)
- **目标**：用户要求——① 小程序行去掉「开发中 · 敬请期待」（没必要）；② 开源地址 GitHub / Gitee 与「安装到 Edge」**放一起**。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：
    - 小程序入口：未配置 `miniappUrl` 时只渲染 `<span>微信小程序</span>`，**删除「开发中 · 敬请期待」**占位；配置后仍变为「进入 →」链接。
    - 开源地址：GitHub / Gitee 按钮并入 Hero 的 `.home-actions`，与「安装到 Edge」「快速上手」**同排同款**；删除独立 `.home-toplinks` 行与「开源地址」标签。
    - `return` 去掉 `topbar`（`miniapp + hero + body + cta`）。
  - 样式 `web/assets/site.css`：删除 `.home-miniapp.is-soon` / `.home-miniapp-status` / 整段 `.home-toplinks`（不再使用）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11：第 1 条去除「开发中」占位；第 2 条按钮组改为「安装 / 快速上手 / GitHub / Gitee，开源地址与安装按钮同排同款」。
- **关键结论/决定**：开源地址不再单独成行，作为 Hero 按钮组的一员；小程序入口保留在页面最顶部、仅作标签占位（不写「开发中」）。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：页面已无「开发中/敬请期待/开源地址」字样；四按钮同处一行（顶边一致）；GitHub/Gitee 与 Edge 按钮同为药丸形（半径 999px、padding 10/22、高 55px）；无横向溢出、无页面级 JS 报错。
- **待办**：无。
- **风险/注意事项**：四按钮在窄屏由 `flex-wrap` 自动换行（未加特殊媒体查询），宽屏保持单行。

---

## 2026-10-04 会话条目：首页 Hero 改「极简高对比」(完成)
- **目标**：用户再反馈 Hero「太丑」，经提问确认方向——**极简高对比**：标题纯深色加粗、副标**单行灰色纯文字**、绿色只留给按钮。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：撤掉副标「——」分层逻辑，恢复为整句一行渲染（`inline(tagline, page)`）。
  - 样式 `web/assets/site.css`：
    - `.home-hero-title`：**移除青绿渐变字**（删 `@supports`+`background-clip:text`），改**纯深色** `var(--text)`、`font-weight:800` 不变。
    - `.home-hero`：**移除顶部柔和绿色光晕**（删 `radial-gradient`）。
    - 删除 `.home-hero-sub-list` / `.home-hero-sub-punch`（不再分层）；`.home-hero-sub` 限宽 40em、单行灰字。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：视觉要求改为「极简高对比——主标纯深色加大加粗、副标单行灰色、Hero 不加渐变/光晕，绿色只用于按钮」。
- **关键结论/决定**：首页 Hero 收敛为「黑白灰 + 绿色点缀（仅按钮）」的高对比排版，去掉渐变与光晕等装饰，观感更干净耐看。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：主标 `rgb(35,38,43)` 纯色、`background-clip` 非 text（渐变已失效）；副标单色 `rgb(107,114,128)` 单行（桌面 1280px 实测 1 行，约 <965px 才折行）；`.home-hero` 背景 none（无光晕）；4 按钮配色正确；无横向溢出、无页面级 JS 报错。
- **待办**：无。
- **风险/注意事项**：副标整句较长，窄屏会折成两行（正常换行，非缺陷）。

---

## 2026-10-04 会话条目：微信小程序入口并入首页按钮组(完成)
- **目标**：用户要求「微信小程序 也放一起，跟 github」——把原独立在页面最顶部的小程序入口，并入 Hero 按钮组。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：
    - 新增 `miniapp_btn`：`miniappUrl` 有值时渲染为 `<a class="home-btn">微信小程序</a>`，为空时渲染为占位按钮 `<span class="home-btn home-btn-soon">微信小程序</span>`。
    - Hero 按钮组顺序改为：**安装到 Edge / 快速上手 / 微信小程序 / GitHub / Gitee**（同一行 `.home-actions`）。
    - 删除页面最顶部的 `.home-miniapp` 导航块，`return` 由 `miniapp + hero + ...` 改为 `hero + ...`。
  - 样式 `web/assets/site.css`：删除 `.home-miniapp` / `.home-miniapp-name` / `.home-miniapp-link`；新增 `.home-btn-soon`（占位态：`cursor:default` + 文字弱化为 `--text-soft`，hover 不位移）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11：删除原「页面最顶部小程序入口」条目，页面结构由 8 条并为 7 条；Hero 按钮组加入「微信小程序」，并注明小程序未上线时渲染为占位按钮。
- **关键结论/决定**：小程序入口不再是独立顶部行，而作为 Hero 按钮组的一员（暂为不可点的占位按钮，`miniappUrl` 一填即变链接）。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
- **待办**：小程序上线后，在 `web/site.config.json` 填入 `miniappUrl` 即自动启用点击。
- **风险/注意事项**：占位按钮（`home-btn-soon`）不可点且颜色略浅，用于提示「暂未上线」。

---

## 2026-10-04 会话条目：首页 Hero 改「功能标签」方案三(完成)
- **目标**：用户第三次反馈 Hero「还是太丑」。此前逐次微调（渐变→纯色）未收敛，改为**先出方案、再落地**：本地起对比页展示 3 个排版方案，用户选定**方案三 · 标签清单**。
- **已做**：
  - 需求确认方式：新建临时对比页 `/tmp/wre-hero-mock/index.html`（3 个 Hero 变体），用 `python3 -m http.server 8921` 预览，用户对比后选定方案三。
  - 落地 `web/build.py`（`render_home()`）：把 tagline 拆为「功能标签 + 结语」——按「——」切分，前半按 `、,，/` 切词生成 `span.hero-chip`，后半作为结语 `p.home-hero-sub`；无「——」时整句作标签来源、无结语。
  - 落地 `web/assets/site.css`：新增 `.home-hero-chips`（flex 居中、换行、gap 10px）与 `.hero-chip`（灰底 `--bg-soft`、`--border` 描边、999px 圆角、`--text-soft` 文字、0.9em）；`.home-hero-title` 由 800/大写号收敛为 **700 字重、clamp(1.9em,3.4vw,2.5em)、行高 1.3、字距 .02em**；`.home-hero-sub` 改为结语小字（去 max-width）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 1 条：Hero 结构由「主标 + 副标」改为「主标 + **功能标签行(chip)** + **一句结语** + 大图 + 按钮组」，并注明主标 700 字重、标签窄屏自动换行。
  - 清理：删除临时对比页 `/tmp/wre-hero-mock/`，停掉 8921 预览服务。
- **关键结论/决定**：Hero 走「大标题 + 一排功能小标签 + 一句结语 + 按钮组」；功能词来自 tagline 自动拆分，**改文案只需改 front-matter 的 tagline**，无需改模板。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 产物核对：`dist/index.html` 第 45 行为 6 个 `span.hero-chip`（屏占比/自动阅读/阅读统计/笔记导出/阅读洞察/阅读人格），第 46 行为结语「一个插件全搞定」。
  - 浏览器核验：与预览「方案三」渲染一致；窄屏标签/按钮自动换行、宽屏单行。
- **待办**：无。
- **风险/注意事项**：功能标签由 tagline 的「、」自动拆分，若 tagline 写作习惯变化（改用空格/顿号以外的分隔），需同步调整拆分正则。

---

## 2026-10-04 会话条目：作者的话上移到 Hero 内（按钮下、大图前）(完成)
- **目标**：用户要求「作者的话」**再往上提**；经确认落点为——**按钮组下方、Hero 主视觉大图之前**。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：用正则 `^(?:>[^\n]*\n)+\s*\n?` 从**正文开头**截出 callout 块，单独渲染为 `note_html`；正文其余部分（`body_src`）照常渲染。Hero 结构插入 `note_html`——位于 `.home-hero-text` 之后、`.home-hero-media` 之前。
  - 样式 `web/assets/site.css`：`.home .doc .callout` 增加 `text-align: left;`（Hero 容器为居中，避免卡片内文字跟随居中）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：作者的话位置由「紧接 Hero，置于正文顶部」改为「**置于 Hero 内——按钮组下方、主视觉大图之前**」。
- **关键结论/决定**：作者的话仍以 **Markdown callout 为唯一内容源**（写在 `首页.md` 正文开头），渲染时由构建脚本挪进 Hero；内容与排版分离，改文案依旧只改 Markdown。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 产物核对：`dist/index.html` 第 42–52 行顺序为 `h1 → chips → sub → 按钮组 → .callout(作者的话) → .home-hero-media(大图)`。
- **待办**：无。
- **风险/注意事项**：截取逻辑依赖「callout 位于正文开头且以 `>` 起始」；若日后把 callout 移到正文中间或改成非 callout 写法，需同步调整该正则。

---

## 2026-10-04 会话条目：作者的话移至页面最顶部(完成)
- **目标**：用户再要求「还是提到最顶部」——作者的话放到**页面最顶部、大标题之前**。
- **已做**：
  - 构建端 `web/build.py`（`render_home()`）：`note_html` 从 Hero 内部移到**返回值最前**——`return note_html + "\n" + hero + ...`（此时 callout 是 `article.doc` 的第一个子元素）。
  - 样式 `web/assets/site.css`：`.home .doc .callout` 外边距由 `28px auto 0` 改为 `margin: 0 auto`（顶部间距交给 `.site-body` 的 `padding-top: 32px`）。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11：页面结构前两条**互换**——第 1 条为「作者的话（最顶部）」、第 2 条为首屏 Hero。
- **关键结论/决定**：作者的话最终固定在**页面最顶部**（大标题之上，左对齐卡片）；内容仍以 `首页.md` 正文开头的 callout 为唯一来源。
- **产出物（文件/链接）**：
  - `web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：`article.doc` 前三个子元素为 `callout(作者的话) → section.home-hero → h2#专注与勿扰`；callout `text-align:left`、滚动到顶部时 top=78.5px，未被 sticky 顶栏（高 58.5px）遮挡；无横向溢出、控制台无页面级 JS 报错。
- **待办**：无。
- **风险/注意事项**：无新增（沿用 callout 截取正则）。

---

## 2026-10-04 会话条目：作者的话「去卡片化」改成前言 + 文案精简(完成)
- **目标**：用户反馈作者的话放到最顶部后「样式太割裂」，并要求顺带优化这一块文案。
- **已做**：
  - 文案精简 `web/content/首页.md`：`做好之后才发现` → `做完才发现`；`能真正帮到人，也让人有所成长。这是我反复提醒自己的事。我会把它当作长期的事慢慢打磨，并承诺永久免费、无广告。` → `真的帮到人，也让人有所成长。这是我反复提醒自己的事——我会长期打磨它，并承诺永久免费、无广告。`（保留「产品」「永久免费、无广告」加粗）。
  - 样式 `web/assets/site.css`：`.home .doc .callout` **去卡片化**——`border:0 / background:none / border-radius:0 / padding:0`，改**居中**（`text-align:center`，`max-width:42em`）；`.callout-title` 改小字标签（0.82em、`600` 字重、字距 `0.22em`、深灰）；`.callout-body p` 改浅灰（`--text-soft`、0.96em、行高 1.95）；新增 `.callout::after` **36px 居中细线**做与 Hero 标题的过渡。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 1 条：注明作者的话为「去卡片化前言（小字标签 + 浅灰正文 + 短细线过渡）」。
- **关键结论/决定**：顶部作者的话不走卡片样式，而作为 Hero 之上的一段「前言」——视觉上从属、不抢主标题。
- **产出物（文件/链接）**：
  - `web/content/首页.md`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：`border-width` 全 0、`background-color: rgba(0,0,0,0)`、无阴影；标题 `#23262b`/15.15px/600/字距 3.33px；正文 `#6b7280`/17.74px；`::after` 细线 36×1px、`#e6e8ec`、水平居中，位于前言与 `h1` 之间；无横向溢出、控制台无报错。
- **待办**：无。
- **风险/注意事项**：`::after` 细线为纯装饰伪元素，若后续前言需要改为左对齐排版，需同步去掉或调整该细线。

---

## 2026-10-04 会话条目：首页按钮悬停变绿(完成)
- **目标**：用户要求「鼠标放上去，自动变成绿色」（首页 Hero 按钮组）。
- **已做**：
  - 样式 `web/assets/site.css`：`.home-btn:hover` 由「仅描边变绿」改为**填充主色绿 + 文字转白**（`background: var(--accent); color:#fff; border-color: var(--accent)`），并给 `.home-btn` 的 `transition` 增加 `background-color / color` 各 220ms，过渡更顺。
  - 占位按钮修正：把 `.home-btn-soon` 选择器提升为 `.home-btn.home-btn-soon`（含 `:hover`），提高优先级以覆盖新的 `.home-btn:hover`，确保「微信小程序」占位按钮**悬停不变绿**。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：补「按钮悬停统一填充主色绿、文字转白；小程序占位按钮不参与悬停变色」。
- **关键结论/决定**：全站首页按钮（Hero 与底部 CTA）悬停统一变绿；唯一例外是未上线的小程序占位按钮（避免造成「可点击」的误导）。
- **产出物（文件/链接）**：
  - `web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验（真实 `:hover` 触达 + 等 220ms 过渡结束读数）：快速上手 / GitHub / Gitee 悬停 → bg `rgb(26,137,23)`、color `rgb(255,255,255)`；安装到 Edge 本就绿色，仅多出 `rgba(26,137,23,.28)` 阴影；微信小程序悬停保持 `rgb(255,255,255)` + `rgb(107,114,128)` 不变；移开指针全部回落；无 JS 报错。
- **待办**：无。
- **风险/注意事项**：若希望小程序占位按钮也参与悬停变绿，删掉 `.home-btn.home-btn-soon:hover` 规则即可。

---

## 2026-10-04 会话条目：小程序占位按钮放开悬停变绿 + 主按钮悬停加深(完成)
- **目标**：用户要求「（微信小程序）放开；而且其他绿色了，第一个 edge 自动变色」——即占位按钮也参与悬停变绿，且「安装到 Edge」在悬停时要有可见颜色变化。
- **已做**：
  - 样式 `web/assets/site.css`：
    - 新增变量 `--accent-hover`（亮色主题 `#146c12`、暗色主题 `#74d171`），供「按下感」加深/提亮使用。
    - 删除 `.home-btn.home-btn-soon:hover` 覆盖规则，占位按钮改由通用 `.home-btn:hover` 接管 → **悬停同样变绿 + 白字**（仅保留 `cursor: default`）。
    - `.home-btn-primary:hover` 增加 `background/border-color: var(--accent-hover)` → 「安装到 Edge」悬停由 `#1a8917` 变为 `#146c12`，**可见变深**；保留绿色阴影。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：改为「按钮悬停统一填充主色绿 + 白字；主按钮悬停额外转为更深一档绿；小程序占位按钮同样参与悬停变色」。
- **关键结论/决定**：首页所有按钮（含小程序占位）悬停统一变绿；主按钮以「更深一档绿 + 阴影」区分主次。
- **产出物（文件/链接）**：
  - `web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验（真实 `:hover` + 过渡结束读数）：快速上手 / 微信小程序 / GitHub / Gitee 悬停 → bg `rgb(26,137,23)`、白字；安装到 Edge 悬停 → bg `rgb(20,108,18)`（#146c12）；移开指针 5 个按钮全部回落；无 JS 报错。
- **待办**：无。
- **风险/注意事项**：小程序占位按钮目前悬停会变绿但点击无跳转（预留态），待 `miniappUrl` 配置后即为真实入口。

---

## 2026-10-04 会话条目：主按钮随同组悬停联动退白(完成)
- **目标**：用户要求「安装到 edge 这个在鼠标停到其他地方，要自动变成白色」——鼠标移到同组其他按钮上时，主按钮退为白色。
- **已做**：
  - 样式 `web/assets/site.css`：新增 `.home-actions:has(.home-btn:not(.home-btn-primary):hover) .home-btn-primary:not(:hover)` —— 同组有「非主按钮」被悬停、且主按钮自身未被悬停时，主按钮改为 `--bg-card` 底 + `--text` 字 + `--border` 描边、去掉阴影。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 2 条：补「鼠标停在同组其他按钮上时主按钮退为白色次级态，避免两个按钮同时高亮」。
- **关键结论/决定**：一组按钮里同时只保留一个高亮项——鼠标在次级按钮时，主按钮让位变白。
- **产出物（文件/链接）**：
  - `web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验（真实 `:hover`，读稳定态）：无悬停时 Edge = `rgb(26,137,23)`/白字；悬停快速上手 / 微信小程序 / GitHub / Gitee 时 Edge 均变 `rgb(255,255,255)`/`rgb(35,38,43)`，同时被悬停的兄弟为 `rgb(26,137,23)`；悬停 Edge 自身时为深绿 `rgb(20,108,18)`；无 JS 报错。
- **待办**：无。
- **风险/注意事项**：依赖 CSS `:has()`（Chrome 105+/Safari 15.4+/Firefox 121+）；不支持的老浏览器仅表现为「主按钮不联动变白」，不影响其余样式。

---

## 2026-10-05 会话条目：首页「我为什么要做这个」保留作者原文案(完成)
- **目标**：用户先反馈该段「内容不够合适」，试选 A 极简版后，明确要求「文字内容不要变动，我之前的文字要保留」——**不改写作者文字**，恢复原文案。
- **已做**：
  - 内容 `web/content/首页.md`：开头 callout 恢复为作者原文案（标题「我为什么要做这个」+ 两段：动机 + 承诺），**逐字保留作者原话**，不做润色改写。
  - 文档回灌 `plan/RPD_网站生态_需求文档.md` 3.11 第 1 条：恢复为「我为什么要做这个」，并新增约束「**文字内容由作者自定，不得改写**」。
  - 样式无改动：`web/assets/site.css` 中 `.home .doc .callout` 的去卡片化前言样式继续适配（居中弱化 + 细线过渡）。
- **关键结论/决定**：该段文字属于作者自述，**只调样式/位置，不改文字**；后续如需调整仅限排版。
- **产出物（文件/链接）**：
  - `web/content/首页.md`、`plan/RPD_网站生态_需求文档.md`
  - 构建结果：`python3 web/build.py` → 告警 0 条，版本 v0.19.0。
  - 浏览器核验：`web/dist/index.html` 顶部 callout 标题为「我为什么要做这个」，正文为作者原文两段，居中弱化样式与细线过渡正常，无 JS 报错。
- **待办**：无。
- **风险/注意事项**：无。

---

## 2026-10-05 会话条目：移动端阶段 2.5 体验打磨 + 阶段 2.6 P2 延展（A 类 + B 类）(完成)
- **目标**：先把小程序五页重复的「加载/空态/错误/无 Key」与错误文案收敛成单一来源（A 类）；再按用户全选推进 B 类——B1 头像昵称、B2 静默 openid 云同步、B3 DeepSeek AI 画像（明知会改写「不接大模型 / 不采集 openid」的首版承诺，用户仍选择全做）。
- **已做**：
  - **A 类（阶段 2.5）**：新增公共状态组件 `components/wre-state/*`（loading/empty/error/nokey 四态，全局注册于 `app.json`）；新增 `shared/errors.js` 收敛 `code → 文案` 与 Key 判定（五页统一 `messageOf` / `isKeyError`）；云函数加重试与错误码细分（`rate`/5xx）。
  - **B1**：`shared/store.js` 增 profile 存取；「我的」页新增「我的资料」（`chooseAvatar` + `type="nickname"`，`fs.saveFile` 长期保存）；`shared/persona-share.js` 的 `renderPersonaShare(canvas, persona, profile)` 署名改用昵称。
  - **B2**：云函数重构为 `event.action` 分流（无 action 仍走网关中转）；新增 `handleSync`（`getWXContext().OPENID` 隔离、只存 persona 视图、400KB 上限、集合自动创建兜底）；新增 `shared/sync.js`；人格页进入先 `syncGet` 秒显、算完静默 `syncPut`，失败不阻断。
  - **B3**：云函数新增 `handleAi`（转发 DeepSeek，`sk-` 校验、30s 超时、日志仅掩码）；新增 `shared/ai.js`（复刻插件 `AI_READING_PERSONA_PROMPT`，用已算好的四维/证据拼 prompt）；「我的」页新增 DeepSeek Key 卡；人格页新增「生成 AI 画像」卡片（换行保留、同代码不丢 aiText）。
  - **文档回灌**：`plan/plan_小程序移动端.md`（决策表 3→「已启用」、新增阶段 2.6 表、红线与不做清单同步、超时 20→30s）；`plan/RPD_小程序移动端_需求文档.md`（M8/M9 转「已实现」、新增 M10、§9 决策、§8 风险）；`plan/小程序_发布前准备.md` v1.3（隐私指引改为须声明「昵称头像」「相册仅写入」+ openid/AI 补充说明、自检清单加 `wre_sync`、提审备注改写）；`mobile/README.md`（超时 30s、建集合、shared 模块、说明）；`test/移动端小程序测试清单.md`（10.8/10.9、11.2 改写、新增第十二章 B 类 22 条）。
- **关键结论/决定**：B2/B3 使对外口径变化——**须在《用户隐私保护指引》如实补充**（openid 上云、头像昵称收集、AI 外发），这是阶段 3.1 的前置；B3 只做「人格画像润色」一处，报告「执行摘要」仍为规则化、未接 AI。
- **产出物（文件/链接）**：
  - 新增：`mobile/miniprogram/components/wre-state/{index.js,wxml,wxss,json}`、`mobile/miniprogram/shared/{errors.js,sync.js,ai.js}`
  - 修改：`mobile/cloudfunctions/wereadProxy/index.js`、`mobile/miniprogram/{app.json,app.wxss}`、五页 `pages/*/index.{js,wxml}`、`pages/persona/index.wxss`、`pages/settings/index.{js,wxml,wxss}`、`mobile/miniprogram/shared/{store.js,persona-share.js}`
  - 文档：见上「文档回灌」五项 + 本条目
  - 校验：`GetDiagnostics` 仅剩既有 CommonJS→ES 模块 Hint，无报错
- **待办**：真机验收（测试清单第十二章）；阶段 3.1 隐私指引按新口径配置；3.3 体验版回归 + 提审。
- **风险/注意事项**：云函数部署后必须把超时改为 **30 秒**并新建 `wre_sync` 集合（权限「仅创建者可读写」）；B1 隐私接口（chooseAvatar/nickname）与 `saveImageToPhotosAlbum` **未声明则组件/接口被禁用**；云端存的是「人格结果视图」（含划线摘录），如需更保守可后续改为只存统计值。

---

## 2026-10-05 会话条目：首页底部 CTA 卡片留白修复(完成)
- **目标**：用户反馈首页底部 CTA 卡片（「装上，开始读」）「这里太空了，重新优化下」——卡片顶部有一大块空白。
- **根因**：
  - 功能大图区规则 `.home .doc h2 { margin: 76px 0 10px }`（窄屏 `52px`）**优先级高于** `.home-cta h2 { margin: 0 0 6px }`（前者 2 个类 vs 后者 1 个类），导致 CTA 标题被加上 52~76px 上边距，卡片顶部凭空多出一大块空白，上下留白不对称。
  - 另有 `.doc p { margin: 12px 0 }` 覆盖 `.home-cta-links { margin: 16px 0 0 }`，使末行链接底部多出 12px。
- **已做**（`web/assets/site.css`，仅样式，不改文字/结构）：
  - `.home-cta h2` → `.home .doc .home-cta h2`（含 `padding:0;border:0`），压过 `.home .doc h2` 的大上边距。
  - `.home-cta-links` → `.home .doc .home-cta-links`，压过 `.doc p` 的通用上下边距（底部归零）。
- **关键结论/决定**：根源是「首页通用标题/段落规则」误伤了 CTA 内的元素，一律用提高选择器优先级的方式在 CTA 局部覆盖，不改动通用规则本身（避免影响功能大图区）。
- **产出物（文件/链接）**：
  - `web/assets/site.css`
  - 构建结果：`python3 web/build.py` → 告警 1 条（既有：manifest v0.19.1 与更新日志 v0.19.0 不一致，与本次无关）。
  - 浏览器核验（1440px 与 756px 两档）：CTA 标题 `margin-top` = 0px / `margin-bottom` = 6px；上下空白严格对称（1440：41/41px，756：29/29px）；卡片高度 256.77px（1440）、227.41px（756）；无 JS 报错、无横向溢出。
- **待办**：无。
- **风险/注意事项**：无。

---

## 2026-10-05 会话条目：首页底部 CTA 二合一（并入首屏 Hero，删除重复）(完成)
- **目标**：用户指出首页底部 CTA 卡片（「装上，开始读」+ 安装/快速上手 + 链接行）与顶部 Hero 按钮组**重复**，「二合一，放到一起，放到顶部，现在重复了 没必要」。
- **已做**：
  - `web/build.py`：`render_home()` 删除整段 `cta` 构造，返回值由 `note_html + hero + body + cta` 改为 `note_html + hero + body`；同步更新函数 docstring 与区块注释（去掉「+ 底部 CTA」）。
  - `web/assets/site.css`：删除已无用的 `.home-cta` / `.home-cta h2` / `.home-cta-links` 规则及窄屏 `.home-cta { margin-top:56px; padding:28px 18px }`，仅保留一句注释说明「已并入 Hero」。
  - `plan/RPD_网站生态_需求文档.md`（v0.10）：3.11 删除「底部 CTA」条目并加注「不设底部 CTA」说明；同步更新 1.2 页面表、3.2 首页描述、5.3（渲染步骤）、6.8 阶段八勾选项。
- **关键结论/决定**：安装 / 快速上手 / 微信小程序 / GitHub / Gitee **只在首屏 Hero 按钮组出现一次**，页尾不再重复第二组；原 CTA 的「更新日志 / 隐私政策」入口页脚已有、「界面图库」在顶部导航已有，故删除不丢入口。
- **产出物（文件/链接）**：`web/build.py`、`web/assets/site.css`、`plan/RPD_网站生态_需求文档.md`；`python3 web/build.py` 通过（页面 25 篇 + 索引 4 个；告警 1 条为既有版本号不一致，与本次无关）。
- **待办**：无。
- **风险/注意事项**：无。

---

## 2026-10-05 会话条目：小程序分享图高清化 + 一键转发微信(完成)
- **目标**：用户反馈「生成竖版分享图，图片清晰度不够，提升；另外，除了保存相册，还可以直接一键在微信中转发给其他人」。
- **已做**：
  - `mobile/miniprogram/shared/persona-share.js`：拆出 `paintShare(ctx, persona, profile, scale)`（在给定上下文按逻辑坐标绘制并返回内容高度）；`renderPersonaShare` 改为**两遍绘制**——第一遍按逻辑宽 1080 测内容高度，第二遍按倍率 `min(2, 4096/1080, 4096/内容高)` 放大后备缓冲后重绘，返回缓冲像素尺寸（即导出图片像素）。保证缓冲任一边 ≤ 4096（iOS 上限）。
  - `mobile/miniprogram/pages/persona/index.js`：`canvasToTemp` 改为按「整块缓冲」导出（去掉 width/height 裁剪参数，`destWidth/destHeight` = 缓冲像素）；新增 `shareImage()`，调 `wx.showShareImageMenu({ path })` 一键转发图片给好友，旧版微信不支持时给可读提示。
  - `mobile/miniprogram/pages/persona/index.wxml`：分享弹层动作区新增「转发给朋友」主按钮（保存到相册降为次按钮）；入口文案改为「生成后可一键转发给微信好友，或保存到相册」。
  - `mobile/miniprogram/pages/persona/index.wxss`：更新离屏画布注释（缓冲尺寸由 js 按高清倍率设置，不再固定对应）。
- **关键结论/决定**：一键转发用官方 `wx.showShareImageMenu`（基础库 2.14.3+，本地/临时路径即可，无需先存相册）；清晰度靠「放大后备缓冲 + 按倍率 ctx.scale 重绘」实现，倍率受 iOS 4096 上限约束（成品宽度约为 1080 的 1.3–2 倍）。
- **产出物（文件/链接）**：`mobile/miniprogram/shared/persona-share.js`、`mobile/miniprogram/pages/persona/index.{js,wxml,wxss}`；文档回灌：`plan/RPD_小程序移动端_需求文档.md`（M5 与 §9 决策 2）、`test/移动端小程序测试清单.md`（八. 新增 8.13–8.15）。`GetDiagnostics` 无报错。
- **待办**：真机验收（测试清单八. 8.13–8.15 + 第十二章）；阶段 3 隐私指引 / 体验版回归 / 提审。
- **风险/注意事项**：`showShareImageMenu` 只在较新基础库可用（已做能力判断兜底）；高清导出后图片像素变大、体积略增，导出失败已由 `canvasToTemp` 兜底 toast。

---

## 2026-10-05 会话条目：快速上手页「方式 A」加入商店跳转按钮（新增 `:::store` 指令）(完成)
- **目标**：用户要求「快速上手 → 方式 A：从商店安装」一节「加入商店跳转」（点按钮直达商店），并顺带把《API Key 使用说明》的「二、怎么获取」按 App 截图更新（已改文案、图片待用户放入）。
- **已做**：
  - `web/build.py`：新增 `render_store_buttons()`——按 `site.config.json` 的 `storeUrls` 渲染「安装到 Edge / Chrome / 360」按钮组（首个为主按钮，未配置的商店不显示，全未配置则回退「安装插件」）；在 `render_markdown()` 增加 `:::store` 块指令处理（单行或成对皆可），并在 `is_block_start()` 登记 `:::`；样式复用 `.home-actions` / `.home-btn`。
  - `web/assets/site.css`：新增 `.store-actions { justify-content: flex-start; margin: 14px 0 6px; }`（内容页里左对齐、贴合正文）。
  - `web/content/快速上手.md`：方式 A 的「商店状态」提示框下方加 `:::store`，实现按钮一键跳商店；`updatedAt` 改 2026-10-05。
  - `web/content/功能教程/API Key 使用说明.md`：二、怎么获取——按 App 截图改为「我 → 设置 → 微信读书 Skill → 快速配置②获取 API Key → 复制 Key」，并预留 3 张图引用；`updatedAt` 改 2026-10-05。
  - `plan/RPD_网站生态_需求文档.md`：语法支持清单新增 `:::store` 一行；1.2 页面表 `/start/` 描述补「方式 A 商店一键安装（`:::store` 按钮）」。
- **关键结论/决定**：内容页要放「商店跳转」时用 `:::store` 指令，商店链接的唯一事实源仍是 `site.config.json` 的 `storeUrls`（改链接只改配置，不动正文）。
- **产出物（文件/链接）**：`web/build.py`、`web/assets/site.css`、`web/content/快速上手.md`、`web/content/功能教程/API Key 使用说明.md`、`plan/RPD_网站生态_需求文档.md`。构建通过（页面 25 篇 + 索引 4 个）。
- **待办**：用户把 3 张 App 截图另存到 `web/content/attachments/`（文件名：`微信读书Skill入口.png`、`微信读书Skill快速配置.png`、`微信读书Skill获取Key.png`）后，重新构建即生效。
- **风险/注意事项**：构建现有 4 条告警——3 条为上述待放入的图片缺失、1 条为版本号（manifest v0.20.0 vs 更新日志 v0.19.0）不一致，均与本次无关。浏览器核验：`/start/` 按钮 href 指向 Edge 商店、`target=_blank`、悬停转深绿（主按钮本就绿底白字，悬停加深）、无横向溢出、无 JS 报错。

---

## 2026-10-05 会话条目：快速上手页「方式 B」补下载地址 + 新手排错说明 (完成)
- **目标**：用户反馈「方式 B 开发者模式加载」缺下载入口——没有文件无从加载；要求补 GitHub / Gitee 地址，并针对新手写清楚。
- **已做**：
  - `web/content/快速上手.md`：方式 B 拆成三段——① 前置 `[!tip]`「第一步：先下载插件文件」（Gitee 推荐：仓库主页 →「克隆/下载」→「下载 ZIP」；GitHub：仓库主页 → Code → Download ZIP，另给 GitHub 直链 ZIP）；② 5 步有序列表（解压 → `edge://extensions/` → 开「开发人员模式」→「加载解压缩的扩展」选**文件夹本身** → 打开 weread.qq.com 看悬浮球）；③ `[!warning]`「卡住了看这里」3 条（找不到加载按钮 / 提示找不到 `manifest.json` / 如何更新到最新版）。
  - `plan/RPD_网站生态_需求文档.md`：1.2 页面表 `/start/` 描述补「方式 B 先给 GitHub·Gitee 下载地址与 5 步新手说明 + 常见卡点警示」。
- **关键结论/决定**：**Gitee 的归档直链（`/repository/archive/main.zip`）对匿名请求返回 `reject by [gitee]`（HTTP 400）**，不适合作为给新手的直链；改用「进仓库主页 → 点下载 ZIP」的 UI 路径，更稳。GitHub 直链（`/archive/refs/heads/main.zip`）实测 200 + `application/zip`，保留。
- **产出物（文件/链接）**：`web/content/快速上手.md`、`plan/RPD_网站生态_需求文档.md`。构建通过。
- **待办**：同上一节——3 张 App 截图仍待用户放入 `web/content/attachments/`。
- **风险/注意事项**：构建仍为 4 条既有告警（3 图缺失 + 版本号不一致）。浏览器核验：提示框 2 条要点 3 个链接均 `target=_blank` + `rel=noopener`；5 步列表与警示框结构正确；`scrollWidth = innerWidth = 756` 无横向溢出；控制台无报错。

---

## 2026-10-06 会话条目：小程序 M12 灵感漫游（深度主题综述）P1 开发完成 (完成)
- **目标**：按已定稿的 M12（v0.10）开发「灵感漫游」——与 M11 每日卡片分开的独立功能：**每周一篇、多素材编织的主题综述**（六段式），含素材门槛（划线 ≥300 且 想法 ≥100）、铜/银/金分级解锁、每周限流、历史归档 + 随机漫游、竖版分享图。
- **已做**：
  - `shared/wander-core.js`（纯函数）：`TIERS`（铜/银/金：weekly 1/2/3、sparks/seeds/words 递增）、`tierOf/tierByKey/nextTier/tierProgress`（门槛与分级进度）、`weekStart/weekKey/weekLabel`（周键=周一日期）、`prepareWander`（选够规模的主题、尽量避开上一期、跨书铺开、划线/想法交替、同文本去重、全部用过→`resetUsed`）、`makeIssue/toView`（组刊与视图，来源含 `kindLabel/open`、火花/种子结构化）。主题打标复用 `daily-core.tagAndGroup`（算法不漂移）。
  - `shared/wander-data.js`：`fetchCounts`（`/user/notebooks` 各书 `noteCount/reviewCount` 求和估门槛）+ `fetchPool`（复用 M11 `daily-data.fetchPool`）。
  - `shared/wander-store.js`：本机键 `wre_wander_issues / wre_wander_used / wre_wander_quota / wre_wander_seen`；每周限流（`weekLeft/bumpWeek`）、已用素材、归档（52 期）/收藏/`randomIssue`、入口「新」标（`isNew/markSeen`）。只存本机、不上云。
  - `shared/wander-ai.js`：六段式 JSON 成文（标题/摘要/正文/外部火花/创作种子）+ 本地降级（未填 Key/失败→本地模板，永不 reject）；**红线**：外部火花只做概念呼应、**不点名具体文献**，UI 标「AI 联想 · 未核实」。
  - `shared/wander-share.js`：竖版分享图，主色 `#7C5CFF`（区分每日卡片微信绿），2× 高清 + 后备缓冲 ≤4096，含标题/摘要/正文/来源（≤3 条）/品牌署名。
  - `pages/wander/*`（js/json/wxml/wxss）：六段式展示（正文标 AI生成/本地模板、来源可点开、火花带未核实标、种子 angle+line）；未解锁进度引导、素材不足引导、往期归档列表 + 随机漫游 + 返回本期；分享图弹层。加载/错误态复用 `wre-state`。
  - 入口与注册：`app.json` 注册 `pages/wander/index`；首页新增紫色「灵感漫游」入口卡（紧随每日卡片，含「新」标）；「我的」新增「灵感漫游 · 往期归档」一行。
  - `cloudfunctions/wereadProxy/index.js`：`AI_MAX_TOKENS` 900 → 2000（支撑金档约 1000 字正文 + JSON，防截断）。
- **关键结论/决定**：① M12 = 每周、多素材主题综述；M11 = 每日、单条深读，两者共用取数（`daily-data.fetchPool`）与 AI 通道（云函数 `action:'ai'`），不新增云函数职责。② 周键用周一日期，归档同周仅留最新一期。③ 未达门槛/素材不足/接口失败一律**引导或降级**，不硬出刊。④ 分享图紫色，与 M11 微信绿区分。
- **产出物（文件/链接）**：`mobile/miniprogram/shared/wander-{core,data,store,ai,share}.js`、`mobile/miniprogram/pages/wander/index.{js,json,wxml,wxss}`、`mobile/miniprogram/app.json`、`mobile/miniprogram/pages/home/index.{js,wxml,wxss}`、`mobile/miniprogram/pages/settings/index.{js,wxml}`、`mobile/cloudfunctions/wereadProxy/index.js`。文档回灌：`plan/RPD_小程序移动端_需求文档.md`（v0.11：M12 状态 + §6 阶段 5 勾选）、`plan/plan_小程序移动端.md`（阶段 5 任务表 + 勾选）、`plan/小程序_发布前准备.md`（§五 隐私指引新增「④ 灵感漫游」+ 自检清单）。`GetDiagnostics` 无报错。
- **待办**：真机验收（门槛引导、六段式渲染、每周限流、归档/随机漫游、分享图、入口「新」标）；阶段 3 备案通过后提审（隐私指引需含新增「④ 灵感漫游」）。
- **风险/注意事项**：金档正文较长（约 1000 字），已上调 `AI_MAX_TOKENS=2000` 并保留解析兜底（JSON 解析失败→本地模板）；素材门槛依赖 `/user/notebooks` 的 `noteCount/reviewCount` 估算，若官方字段口径变化会影响门槛判定（失败时走引导）。

---

## 2026-10-06 会话条目：每日卡片 / 灵感漫游改为「必须配 DeepSeek Key」+ 分享图统一主题蓝（阶段 B/C）(完成)
- **目标**：① 「每日卡片」原在未配 DeepSeek Key 时退回「本地模板」，用户评价本地生成效果很差；二选一后用户选定「**必须配 AI 才能用**」，范围含「每日卡片 + 灵感漫游」；② 分享图内容偏少、配色与小程序不统一（要求统一色调）、「生成数据分享图」按钮文字未上下居中。
- **已做**：
  - 阶段 C（必须配 AI）：`pages/daily/index.js`、`pages/wander/index.js`（onShow / onPullDownRefresh / generate 三处加 DeepSeek Key 前置拦截；AI 失败**不退回本地模板**——有内容页内提示、无内容整页报错 + 重试，且不消耗次数）；`pages/daily/index.wxml`、`pages/wander/index.wxml` 新增 `!hasDsKey` 引导态；`shared/daily-generate.js`（首页弹窗入口加 `nokey_ds` 与 AI 失败提前返回）；`pages/home/index.js`（`maybeDailyPopup(hasKey && !!store.getDeepSeekKey())`）；删除三页 wxml 的「本地模板」徽标 / 提示分支及对应 wxss（`.note__badge--local` / `.note__hint`），分享图徽标固定为「AI 生成」；`pages/settings/index.{wxml,js}` 说明 DeepSeek Key 不再标「可选」；`daily-ai.js` / `wander-ai.js` / `daily-core.js` / `wander-core.js` / `ai.js` 注释同步。
  - 阶段 B（分享图）：5 张竖版分享图主色由微信绿改**主题蓝 `#2F6BFF`**（浅底 `#F0F4FF`），**灵感漫游保留紫 `#7C5CFF`**；`home/report/shelf/daily/persona-share.js` 增补板块、条目上限与「一句数据总结」；`app.wxss` 的 `.wre-btn` 改 flex 居中（修「生成数据分享图」文字未上下居中）。
- **关键结论/决定**：每日卡片 / 灵感漫游的价值即 AI 解读，本地模板不对外展示；DeepSeek Key 为**使用前置**（未配 → 页面引导、不生成内容）。首页自动弹窗走 `daily-generate.js` 独立入口，已同步收紧，避免未配 Key 仍弹本地卡。
- **产出物（文件/链接）**：`mobile/miniprogram/pages/{daily,wander,home,settings}/*`、`shared/daily-{ai,generate,share,core}.js`、`shared/wander-{ai,share,core}.js`、`shared/{home,report,shelf,persona}-share.js`、`app.wxss`；文档回灌：`plan/RPD_小程序移动端_需求文档.md`（M11/M12 + §6）、`plan/plan_小程序移动端.md`（4.4 / 4.6 / 4.9 / 5.5 / 5.6 / 5.9 + 里程碑 + AI 边界）、`mobile/README.md`、`plan/小程序_发布前准备.md`（§二 定性 + §五 ③④）、`test/移动端小程序测试清单.md`（13.x 改写 + 新增第十四章 M12）。`GetDiagnostics` 无报错。
- **待办**：真机验收阶段 A（关联准确 / 说明共情）、阶段 B（分享图配色与内容、按钮居中）、阶段 C（未配 Key 引导、AI 失败不降级）；阶段 3 备案通过后提审。阶段 B / C 改动**未提交**。
- **风险/注意事项**：未配 DeepSeek Key 时每日卡片 / 灵感漫游**完全不可用**（产品取舍，不做本地降级）；若旧卡片数据带 `ai:false`，UI / 分享图仍按「AI 生成」展示（次日自然消失）。

---

## 2026-10-06 会话条目：小程序 M13 管理员运营看板 + 插件匿名使用统计 (完成代码，待部署/真机验证)
- **目标**：按已定稿的 M13 开发——① 同一个小程序、不另做、不设角色体系，用 openid 白名单识别「你」，只对管理员多显示一块「📊 运营看板」，其余用户**服务端不下发**（非前端隐藏）；② 看板三块数据：A 小程序使用量（今日去重人数 / 次数 / 新增 / 累计）、B 插件使用量（今日活跃 / 累计活跃 / 版本分布）、C 我的阅读数据（复用 M2 / M4）；③ 打开时懒生成 / 拉取，不依赖真推送；④ 插件侧新增**匿名使用统计**（默认开启 + 首次启动明示 + 设置内一键关闭），红线由「零上传」改为「除匿名使用统计外零上传」。
- **已做**：
  - 云函数 `wereadProxy/index.js`：新增 `OPS_COLLECTION='wre_ops_daily'` / `OPS_RETENTION_DAYS=90` / `ADMIN_OPENIDS`（读环境变量）；`cstDate`（UTC+8 日期）、`cleanToken`（只留 `[0-9a-zA-Z._-]`）、`bumpDaily`（update→inc(1)，不存在则 set，集合不存在则 createCollection）、`aggregate`（按 uid 汇总：今日去重人数 / 次数 / 新增 / 累计 / 版本分布 / truncated）、`cleanupOld`（删 90 天前）；4 个 handler：`handleOpsPing`（openid+天去重记小程序活跃）、`handleOpsWhoami`（只回 `{ok,admin}`）、`handleOpsAdmin`（非白名单回 `code:'forbidden'`，不下发数字）、`handleOpsReport`（白名单字段入库）；HTTP 入口 `handleHttp`（`POST /report` 且 `action=opsReport`→200，`OPTIONS`→204，未知 action→400）+ CORS 头；`exports.main` 新增 HTTP 入口判断与 4 个 action 分支。
  - 小程序侧：`shared/ops.js`（`ping/whoami/fetchAdmin` 封装，通用 `call()` 走 `wx.cloud.callFunction`）；`app.js` `onLaunch` 末尾 `ops.ping().catch(()=>{})`（打开即上报、失败静默）；新页面 `pages/admin/*`（A/B/C 三块卡片 + 版本分布列表 + 下拉刷新，加载 / 无权限 / 错误态复用 `wre-state`，C 块复用 `data.fetchReadData` + `fetchOverview` + `notebookStats` + `fmtDuration`）；`app.json` 注册 `pages/admin/index`；`settings` 页 `onShow` 调 `ops.whoami()` 置 `isAdmin`，仅管理员在「更多」下显示「📊 运营看板」入口（`goAdmin`）。
  - 插件侧：`modules/telemetry.js`（IIFE 挂 `window.WRETelemetry`；`TELEMETRY_ENDPOINT` 留空即不上报；`reportActive` 每天至多一次、`telemetryEnabled===false` 跳过、`crypto.randomUUID` 生成匿名标识、`Content-Type: text/plain` 简单请求免预检、网络失败不记「已报」；`schedule` 延迟 3 秒上报不抢加载）；`content.js`（`WRE_DEFAULT_STATE` 加 `telemetryEnabled:true`、「📖 阅读设置」加「📊 匿名使用统计」开关 + `updateTelemetryUI()`、欢迎弹窗加说明段、`init()` 中 `createUI()` 后调 `WRETelemetry.schedule(WRE_STATE)`）；`manifest.json`（`version` 0.20.1→**0.23.0**、`host_permissions` 加 `https://*.tcloudbase.com/*`、`content_scripts` 在 `help.js` 后加 `modules/telemetry.js`）。
  - 文档与合规同步：`release/privacy.md`（数据收集段 + 新增 Anonymous Usage Statistics 章节 + 权限表 + 保留 90 天）、`plan/RPD_需求文档.md`、`plan/RPD_小程序移动端_需求文档.md`、`plan/plan_小程序移动端.md`（新增阶段 6 任务表）、`plan/小程序_发布前准备.md`（v1.4：自检清单 + §5.2 新增「⑤ 使用量统计」）、`test/移动端小程序测试清单.md`（新增第十五章 M13 五组 21 条）、`mobile/README.md`（§7 运营看板 4 步配置）、仓库根 `README.md`、网站 `web/content/隐私政策.md`、`web/content/关于.md`、`web/content/更新日志.md`（v0.23.0 条目）。
- **关键结论/决定**：① 看板权限用**服务端不下发**（`opsAdmin` 校验 openid 白名单），而非前端隐藏，满足「接口层取不到」。② 统计去重策略：文档 ID = `kind_日期_uid`，每天每 uid 至多一条 → 条数即去重人数，`opens` 用 `command.inc(1)` 累加。③ 插件上报走云开发 **HTTP 访问服务**（简单请求 + CORS 头，可读回执），上报内容白名单最小化：随机匿名标识 + 版本号 + 日期（服务端记）+ 事件名。④ 红线变更：项目红线由「零上传」→「除匿名使用统计外零上传」，四处文案（插件隐私政策 / 主文档 / 小程序文档 / 网站）已统一。
- **产出物（文件/链接）**：`mobile/cloudfunctions/wereadProxy/index.js`、`mobile/miniprogram/shared/ops.js`、`mobile/miniprogram/pages/admin/index.{js,json,wxml,wxss}`、`mobile/miniprogram/pages/settings/index.{js,wxml}`、`mobile/miniprogram/app.{js,json}`、`modules/telemetry.js`、`content.js`、`manifest.json`；文档：`release/privacy.md`、`plan/RPD_需求文档.md`、`plan/RPD_小程序移动端_需求文档.md`、`plan/plan_小程序移动端.md`、`plan/小程序_发布前准备.md`、`test/移动端小程序测试清单.md`、`mobile/README.md`、`README.md`、`web/content/{隐私政策,关于,更新日志}.md`。`GetDiagnostics` 无报错。
- **待办（部署 / 真机，非本次可代做）**：① 建云数据库集合 `wre_ops_daily`；② 云函数配环境变量 `ADMIN_OPENIDS`（填你自己的 openid）；③ 云开发控制台开启「HTTP 访问服务」并把 `/report` 绑到 `wereadProxy`；④ 重新部署 `wereadProxy`；⑤ 把 HTTP 访问服务地址填进 `modules/telemetry.js` 的 `TELEMETRY_ENDPOINT`；⑥ 按 `test/移动端小程序测试清单.md` 第十五章真机回归。
- **风险/注意事项**：`TELEMETRY_ENDPOINT` 留空＝**完全不上报**（静默跳过），这是本次交付的默认状态，需手动填才生效；插件 manifest 版本已到 `0.23.0` 但**尚未提交 / 打包 / 上架**；小程序《用户隐私保护指引》需在后台同步勾选 / 补充「⑤ 使用量统计」，否则可能影响审核。

---

## 2026-10-06 会话条目：小程序分享图清晰度（去掉 2× 硬上限 → 最大倍率导出） (完成代码，待真机验证)
- **目标**：用户反馈「小程序生成的分享图不清楚」。定位根因并彻底提升清晰度；澄清后确定方案为**「不动版式，只拉满倍率」**（保持 1080 版式比例，在 iOS 画布 4096 上限内取最大导出倍率）。
- **已做**：
  - 6 个共享绘制层 `mobile/miniprogram/shared/{home,report,shelf,daily,wander,persona}-share.js`：导出倍率由 `const scale = Math.min(2, MAX_SIDE / W, MAX_SIDE / logicalH);` 改为 `const scale = Math.min(MAX_SIDE / W, MAX_SIDE / logicalH);`（去掉硬编码 2× 上限），并同步头部与函数上方注释（「2× 高清重绘」→「最大倍率高清重绘（保证后备缓冲任一边 ≤4096）」）。
  - 6 个页面导出层 `mobile/miniprogram/pages/{home,report,shelf,daily,wander,persona}/index.js`：`canvasToTemp` 的 `wx.canvasToTempFilePath` 新增 `fileType: 'png'`，避免默认 JPEG 有损压缩再掉清晰度。
  - 文档回灌：`plan/plan_小程序移动端.md`（表格 / 2.4b / 4.6 / 5.7 的「2×」→「最大倍率」）、`plan/RPD_小程序移动端_需求文档.md`（第 129 / 417 行）、`test/移动端小程序测试清单.md`（8.13 改为「按最大倍率高清导出，宽度约为 1080 的 1.3–3.8 倍」）。`GetDiagnostics` 无报错。
- **关键结论/决定**：分享图清晰度＝导出倍率；原代码 `Math.min(2, ...)` 把短图也压到 2×（2160px）。去掉后受 `MAX_SIDE/logicalH` 约束，**短图**（logicalH < 2048）最高可达 `4096/1080≈3.79×`（≈4100px 宽）；**长图**（logicalH ≥ 2048，如 report/home/shelf）仍被 `MAXH=3200` 逻辑高上限压到约 1.28–1.99×——这是用户选择「不动版式」的必然取舍，长图若要更清晰须加宽画布（已否掉的方案）。
- **产出物（文件/链接）**：`mobile/miniprogram/shared/{home,report,shelf,daily,wander,persona}-share.js`、`mobile/miniprogram/pages/{home,report,shelf,daily,wander,persona}/index.js`；文档：`plan/plan_小程序移动端.md`、`plan/RPD_小程序移动端_需求文档.md`、`test/移动端小程序测试清单.md`。
- **待办**：真机验证清晰度（生成分享图后放大看文字 / 线描是否清晰不糊），重点看短图（每日卡片 / 灵感漫游 / 人格）是否明显变清晰；本次改动**未提交**。
- **风险/注意事项**：① 长图提升有限（受高度上限约束），如需长图也显著变清晰需另议「加宽画布」方案；② 高倍率下后备缓冲更大，低端机绘制 / 导出耗时略增，若发现生成变慢或内存告警需评估下调倍率；③ `fileType:'png'` 使导出文件体积大于 JPEG，保存相册路径需真机确认无异常。

---

## 2026-10-06 会话条目：插件 M14 语音复习（听自己的笔记）落地 v0.24.0 (完成代码，待真机验证)
- **目标**：按插件主文档第 14 章开发「语音复习」——把**用户自己的**划线 / 想法用**浏览器内置 TTS** 读出来，用于通勤 / 走路 / 闭眼等不方便看的场景复习。范围 A＋B 档（去 C）：A 档＝单条划线 / 自己的想法 / 连续朗读；B 档＝听全部 / 只听想法。入口不新增主菜单，在「📝 笔记」就地加「▶ 听」。
- **已做**：
  - 新增 `modules/tts.js`（IIFE 挂 `window.WRETTS`）：`supported` / `playOne(text, el)` / `playList([{text, element}])` / `togglePause` / `stop` / `next` / `prev`；语音从 `speechSynthesis.getVoices()` 优先挑本机 `zh-CN`（拿不到退默认并提示）；**文本按句分段**（≤80 字 / 段）逐段朗读，规避 Chrome 长句被截断；`start`/`jumpTo` 用 `runToken` + 30ms 延迟规避 `cancel→speak` 竞态；切后台（`visibilitychange`）/ `pagehide` 立即停止；弹窗底部自建控制条（上一条 / 暂停·继续 / 下一条 / 第 N 共 M 条 / 停止 + 「本机朗读 · 不联网、不上传」）；日志沿用统一 `log()`，前缀 `[TTS]`。
  - 新增 `modules/tts.css`：条目右上「▶ 听」圆钮（`.wre-notes-listen`）、朗读中条目左边框高亮（`.is-tts-active`）、底部控制条（`.wre-tts-bar`）；仅补充 `#wre-notes-modal .wre-modal-body { flex:1 1 auto; min-height:0 }` 让控制条稳定贴底。
  - 接入 `modules/notes.js`（**不改**原有取数 / 搜索 / 导出）：`renderToolbar` 增「▶ 连续朗读 / ▶ 听全部 / ▶ 只听想法」+ 本机朗读提示（不支持时改为「当前浏览器不支持…」）；`renderGroups` 每条划线 / 想法挂「▶ 听」；新增辅助 `ttsApi` / `itemSpeechText` / `speechTextFromItem` / `flattenGroupsToQueue` / `collectVisibleQueue` / `stopTts`；`handlePanelClick` 增四处分支（连续朗读＝当前列表含搜索过滤、听全部＝本书划线+想法、只听想法＝仅想法，空则 Toast）；`closePanel` 与 `renderPanel`（切 Tab / 搜索 / 刷新重绘前）调 `stopTts()`。
  - `manifest.json`：`version` 0.23.0 → **0.24.0**；`content_scripts.css` 加 `modules/tts.css`、`js` 在 `notes.js` **之前**加 `modules/tts.js`（保证 `window.WRETTS` 先就绪）；**不新增任何权限 / 主机**。
  - 文档与清单：`plan/RPD_需求文档.md`（第 14 章状态改「已实现（v0.24.0）」+ 14.6 四项打勾 + 实现落点 + 新增变更记录行；2.1 总览表由「储备 · 规划」改「已实现」）、`README.md`（新增功能项 + 结构里登记 `tts.js/tts.css` 与测试清单）、新增 `test/语音复习测试清单.md`（八组：入口 / 单条 / 连续+控制条 / B 档 / 搜索联动 / 停止边界 / 降级文案 / 回归）。
- **关键结论/决定**：① 技术只用 **Web Speech API**，零依赖 / 零成本 / 不联网 / **不新增权限**（manifest 无改动权限）；② 朗读范围 A＋B，**不做** C 档（人格播报 / 报告摘要朗读）；③ 入口就地加在「📝 笔记」，**不新增主菜单 / 独立页**；④ 音频本机合成、**不上传、不提供分享 / 导出**（划线属书中原文），文案只用「朗读 / 听」；⑤ 列表重绘（切 Tab / 搜索）先停播——DOM 条目引用会失效，避免读到错位内容。
- **产出物（文件/链接）**：`modules/tts.js`、`modules/tts.css`、`modules/notes.js`、`manifest.json`；文档：`plan/RPD_需求文档.md`、`README.md`、`test/语音复习测试清单.md`。本地用 `python3` 校验 `manifest.json` 合法（版本 0.24.0、js 顺序正确）；`GetDiagnostics` 无报错（本机无 node，未跑 `node --check`）。
- **待办**：真机 / 浏览器验收 `test/语音复习测试清单.md` 八组（重点：中文语音是否可用、长划线不被截断、切后台 / 关面板即停、快捷键不被抢）；本次改动**未提交**。
- **风险/注意事项**：① 浏览器若无可用的中文语音（`getVoices()` 为空），朗读会走默认语音、发音可能生硬——已做提示但不报错；② Chrome 已知「长文本 / 切页面」节流问题，已用「分段朗读 + 失焦即停」缓解，**不做后台常驻播放**；③ `speechSynthesis` 在部分环境首次调用需用户手势，本实现均由按钮点击触发，符合要求；④ 朗读声音由系统语音提供，不同操作系统音色不同属预期。

---

## 2026-10-06 会话条目：H5 移动端（纯网页 App）阶段 0 + 阶段 1 落地 (完成代码，待部署，本地验证通过)
- **目标**：按 `plan/RPD_H5移动端_需求文档.md`（v0.1）开发纯网页 H5 移动端——把小程序「读完之后」的复盘 / 分享搬到网页，并**保留小程序侧已关闭的 AI**。本阶段交付需求 §6 的**阶段 0（地基）+ 阶段 1（核心展示）**。
- **已做**：
  - **云函数 `mobile/cloudfunctions/wereadProxy/index.js` 扩展 H5 动作（H0，不新写后端）**：`handleHttp` 在原有 `opsReport` 之外新增 `relay` / `ai` / `keySave` / `keyGet` / `keyClear` / `syncGet` / `syncPut`；新增 H5 常量（`USERS_COLLECTION='wre_users'`、`KEY_SECRET`、`H5_ORIGINS`、`DEVICE_MIN_LEN`）与一整套函数（`cleanDeviceId` / `validDeviceId` / `deriveSecret` / `encryptSecret` / `decryptSecret` / `readUserDoc` / `getHostedKey` / `handleKeySave` / `handleKeyGet` / `handleKeyClear` / `handleH5Relay` / `handleH5Ai` / `handleH5Sync`）；CORS 由固定 `HTTP_HEADERS` 改为 `buildCorsHeaders(origin)` + `httpReply(status, obj, origin)`，**未配 `H5_ORIGINS` 退回 `*`，配了则只回显白名单来源**；未知 action 返 400；文件头 docblock 增 H5 动作说明 + 部署提醒④（建 `wre_users`、设 `KEY_SECRET` / `H5_ORIGINS`、HTTP 访问服务绑 `/h5`）。
  - **Key 加密托管（H1）**：应用层 **AES-256-GCM**，密钥由 `KEY_SECRET` 经 SHA-256 派生；存储格式 `v1:<iv b64>:<tag b64>:<密文 b64>`；文档 `_id = deviceId`，字段 `{ enc, masked, aiEnc, aiMasked, createdAt, updatedAt }`；响应**只回掩码**，明文仅在云函数内存中用于中转；`keyClear` 删托管字段。
  - **新建独立 `h5/` 目录（纯静态、零依赖、ES Module，与 `web/` 互不影响）**：
    - 外壳：`index.html`（header / `main#view` / `nav#tabbar`）、`assets/app.css`（移动端样式，品牌色 `#2F6BFF`）、`assets/app.js`（hash 路由 + 五栏 Tab + 两级拦截态：未配中转地址 / 未配 Key）。
    - `src/`：`config.js`（ENDPOINT / 超时）、`store.js`（`deviceId` 32 位 hex / 端点 / 掩码 / 昵称 / 带 TTL 缓存）、`api.js`（`call()` POST + `AbortController` 超时，导出 `relay/verifyKey/ai/keySave/keyGet/keyClear/syncGet/syncPut`）、`data.js`（取数层：`fetchReadData/fetchOverview/fetchCorpus/...`）、`ui.js`（`esc/stateHtml/toast/copyText`）。
    - `src/core/`：把小程序 `shared/*` **逐字改写为 ESM（仅 CommonJS→ESM，算法单一来源）**——`format.js`、`report-core.js`、`persona-core.js`、`home-core.js`、`errors.js`（补 H5 错误码 `noendpoint/nodevice/nosecret/ai_nokey/save/action`）。
    - `src/views/`：**H2 首页**（周期切换 + Hero + 迷你趋势 + 指标 + 偏好分类 + 时段 + 读得最多 + 入口）、**H3 阅读人格**（先查数据门槛再拉语料重算）、**H4 报告**（`buildReportBlocks` + 多种块渲染）、**H6 书架 + H7 笔记概览**（`shelfCounts/notebookStats`）、**我的**（微信读书 Key 保存/校验、DeepSeek Key、昵称、中转地址、deviceId 复制、一键清除）。
    - `h5/README.md`：新增——云函数部署（超时 30s / 建集合 `wre_users` / 设 `KEY_SECRET` 与 `H5_ORIGINS` / HTTP 访问服务绑 `/h5`）、配置中转地址三种方式、本地预览（`python3 -m http.server 8930`）、上线清单、已实现页面表。
  - **文档回灌**：`README.md` 项目结构新增 `h5/` 节点。
- **关键结论/决定**：① 代码落点＝独立 `h5/`，与 `mobile/`、`web/` 平级、独立部署（需求 §9-1）；② 数据中转**复用现有云函数**，只扩 action（§9-2）；③ Key **用户明示同意后加密托管、可一键清除**（红线同步放开，§9-3）；④ 无登录，用**匿名 `deviceId`**（§9-5）；⑤ `core` 与小程序 `shared` 保持**逐字一致**防漂移；⑥ CORS 从 `*` 收敛为 `H5_ORIGINS` 白名单（§8）；⑦ 浏览器无法直连官方网关（OPTIONS 预检 401），全部数据必须经云函数中转（§1.1-1）。
- **产出物（文件/链接）**：
  - 云函数：`mobile/cloudfunctions/wereadProxy/index.js`
  - H5 新目录：`h5/index.html`、`h5/assets/app.css`、`h5/assets/app.js`、`h5/src/{config,store,api,data,ui}.js`、`h5/src/core/{format,report-core,persona-core,home-core,errors}.js`、`h5/src/views/{home,persona,report,shelf,me}.js`、`h5/README.md`
  - 文档：`README.md`
  - **验证**：`GetDiagnostics` 全绿（云函数仅剩一条 CommonJS Hint，无语法错误）；本机 `python3 -m http.server 8930` 起静态服务，浏览器核验——**页面正常渲染非白屏**，顶部「微信悦读」+ 首屏「配置中转服务地址」卡片（输入框 + 保存按钮）齐全，`assets/*` 与 `src/**/*.js` **全部 200**，**无任何 console / JS 模块错误**（`@vite/client` 404 为浏览器代理注入、与本项目无关）。
- **待办**（后续阶段，均待用户指令）：
  - 阶段 2：**H10 AI 人格画像 / H11 每日卡片 / H12 灵感漫游**（走托管 Key）。
  - 阶段 3：**H5 分享**（canvas 竖版分享图 + Web Share / 下载 / 复制链接）、H6/H7 细节、H9 头像昵称。
  - 阶段 4：**H13 语音复习**（Web Speech API）、**H8 跨设备同步码**、**H14 运营看板**、PWA。
  - 上线侧（用户自理）：部署云函数 HTTP 访问服务、建集合、设环境变量、把线上域名加入 `H5_ORIGINS`。
- **风险/注意事项**：① `KEY_SECRET` **一旦设置不可更改**，否则已托管 Key 无法解密；② 未配 `H5_ORIGINS` 会退回 `Origin: *`（仅调试用，上线务必收敛）；③ `deviceId` 即身份、无登录，泄露可被冒用（随机 ≥32 位、仅存本机、服务端只回掩码）；④ 本地预览域名需临时加入 `H5_ORIGINS` 方可跨域调试；⑤ 本次 H5 改动**未提交**。

---

## 2026-10-07 会话条目：H5 移动端 阶段 2 + 3 + 4 全部落地 · 一次性测试 (完成代码，本地验证通过；待部署 / 待真机验收)
- **目标**：按需求 §6 把 H5 剩余功能**一次性开发完成**——阶段 2（H10/H11/H12 AI 回顾）、阶段 3（H5 分享 / H6·H7 / H9）、阶段 4（H13 朗读 / H8 同步码 / H14 运营看板 / PWA），随后统一做一次测试。
- **已做**：
  - **阶段 2 · AI 回顾**：
    - **`h5/src/core/` 逐字移植小程序 `shared/*`（仅 CJS→ESM）**：`daily-core.js`、`daily-data.js`、`daily-generate.js`（去本机 Key 检查，只走托管 AI 路径）、`daily-ai.js`、`daily-store.js`；`wander-core.js`、`wander-data.js`、`wander-ai.js`（六段式提示词逐字一致）、`wander-store.js`。H5 差异：数据层签名无 `apiKey`（Key 由服务端按 deviceId 托管）。
    - **H10 AI 人格画像**：`src/ai.js` 提供 `generatePersonaPortrait/buildPersonaPrompt/callAI`；`views/persona.js` 新增 AI 润色卡（`ai` 按钮，`aiBusy` 门控）、分享、朗读；AI 只润色、失败退回本机判定。
    - **H11 每日卡片** `views/daily.js`：取材自己的划线 / 想法 → AI 成文；本机存档、往期回看、收藏、分享、朗读；每日限次重新生成。
    - **H12 灵感漫游** `views/wander.js`：铜/银/金分级 + 每周限次；六段式综述 + 原文下划线（`wre-mine`）+ 外部火花（标「AI 联想 · 未核实」）+ 创作种子；往期归档 / 随机漫游 / 规则弹层。
  - **阶段 3 · 延展与传播**：
    - **H5 分享** `src/share.js`：`makeShareCard`（canvas 竖版零依赖）、`downloadImage`、`shareCard`（Web Share → 下载兜底）、`copyLink`、`openShareSheet` / `presentShareCard`（先出图 → 弹层 → 用户点击时再触发分享，保证用户手势）。
    - **H9 署名**：`store.getProfile/setProfile`（昵称，仅本机）；分享图 footer 带署名。
  - **阶段 4 · 增强**：
    - **H13 朗读** `src/tts.js`：`speechSynthesis`，分段朗读（≤80 字）规避 Chrome 截断；底部控制条（暂停 / 上下条 / 停止）；切后台 / `pagehide` 即停；`setTtsToast` 注入统一 toast；已接入每日卡片 / 灵感漫游 / 人格。
    - **H8 同步码**：`store.setDeviceId`（校验 32 位 hex，清除本机掩码）＋「我的」页「复制同步码 / 用同步码恢复」；跨设备粘贴即可找回同一份托管 Key。
    - **H14 运营看板** `views/admin.js`：口令门（本机 `wre_h5_admin_token`）→ 云函数 `opsAdmin` 聚合小程序 / 插件 / H5 三段匿名用量；只读。
    - **PWA**：`h5/manifest.webmanifest` + `h5/sw.js`（网络优先，仅同源 GET）+ `h5/assets/pwa.js`（仅 https/localhost 注册，失败静默）；`index.html` 接入 manifest / icon / pwa.js。
  - **接线**：
    - `assets/app.js`：新增**二级页路由** `SECONDARY`（`daily / wander / admin`，进入隐藏 TabBar、页面自带返回）；`app.go` 支持 Tab 与二级页；启动注入 `setTtsToast(toast)`。
    - `views/home.js`：首页入口新增「🗂 每日卡片 / 🧭 灵感漫游」。
    - `views/me.js`：新增「同步码（跨设备找回）」卡与「运营看板」入口；`views/admin.js` 加返回条。
    - `assets/app.css`：新增全部新视图类名（`wre-back/wre-btn-row/wre-dailycard/wre-related/wre-spark/wre-seed/wre-history/wre-block/wre-share-mask·panel/wre-tts-bar/wre-link-inline` 等）。
  - **文档回灌**：`plan/RPD_H5移动端_需求文档.md` §6 阶段 0–4 全部打勾（H8 补注「复制 deviceId → 新设备粘贴恢复」）；`h5/README.md`（目录结构 + 「实现的页面（阶段 0–4）」表）。
  - **一次性测试（本轮）**：`GetDiagnostics` 全部新 / 改文件**无 error**（仅剩 Hint：未用变量 / `execCommand` 弃用等）；本地 `python3 -m http.server 8930` + 浏览器核验：首屏「配置中转服务地址」卡 + 五栏 Tab 正常；**控制台零错误**。
- **修复（本轮发现并已处理）**：
  1. **ESM 致命链断裂**：`wander-store.js` 从 `wander-core.js` 导入 `hashKey`，但后者只 `export { dateKey }` → 链接期 `SyntaxError`，`assets/app.js` 整图失败（空白主内容）。修复：`wander-core.js` 改为 `export { dateKey, hashKey }`（顺带修正了沿用小程序侧「`used[hashKey(...)]` 因 `hashKey` 为 undefined 导致去重失效」的隐患）。**浏览器二次硬刷新后该错误消失、控制台归零。**
  2. **AI 提示词字段不匹配**：`src/ai.js` 的 `buildPersonaPrompt` 用了 `dim.leftLabel/pct`，而 `persona-core` 维度实为 `dim.left.label/leftPct` → 提示词会输出 `undefined`。修复：改为读 `dim.left.label / dim.leftPct / dim.right.label`；`views/persona.js` 的分享 chips 与朗读文案同步改用正确字段。
- **关键结论/决定**：① AI 只做「润色 / 串联」，绝不改变本机已算好的事实，失败不退回本地模板冒充；② 分享采用「先出图 → 弹层 → 用户手势触发分享」，兼容移动端 Web Share 限制；③ TTS 零依赖、本机合成、不联网、不上传、切后台即停；④ H8 采用「deviceId 即同步码」的最小形态（用户自行复制），符合 §9-5「无登录、跨设备留 P2」；⑤ PWA 仅壳缓存，业务数据仍网络优先。
- **产出物（文件/链接）**：
  - 新增：`h5/src/core/{daily-core,daily-data,daily-generate,daily-ai,daily-store,wander-core,wander-data,wander-ai,wander-store}.js`、`h5/src/{ai,share,tts}.js`、`h5/src/views/{daily,wander,admin}.js`、`h5/manifest.webmanifest`、`h5/sw.js`、`h5/assets/pwa.js`、`h5/assets/icon.svg`。
  - 修改：`h5/index.html`、`h5/assets/app.js`、`h5/assets/app.css`、`h5/src/store.js`、`h5/src/ai.js`、`h5/src/views/{home,persona,me}.js`、`h5/src/core/wander-core.js`、`plan/RPD_H5移动端_需求文档.md`、`h5/README.md`。
  - **验证**：`GetDiagnostics` 无 error；本地起服务浏览器核验「零 console 错误 + 五栏 + 设置门正常」。
- **待办**：
  - 用户侧部署：云函数 `wereadProxy` 的 `H5_ORIGINS` 白名单、`KEY_SECRET`、`wre_users` 集合、HTTP 访问服务绑 `/h5`，以及 DeepSeek Key（AI 功能）。
  - 真机验收：AI 三处（H10/H11/H12）在托管 Key 下能生成、未配 / 失效有引导；分享图能分享 / 下载；TTS 能播放 / 暂停 / 停止；H8 同步码跨设备找回；H14 口令看板。
  - 本次 H5 改动**未提交**（待用户确认后按 `git-sync` / `pack-publish` 处理）。
- **风险/注意事项**：① 无后端 endpoint 时所有路由统一显示设置门（属预期，非错误）；② 官方网关变更 / Key 风控 → 统一错误码降级；③ 移动浏览器 TTS 差异（iOS 需用户手势、语音包不一）已在交互上规避；④ AI 成本由用户自付 Key，已用「每日限次 / 每周分级」限流；⑤ `hashKey` 去重修复后，H5 与小程序在该处行为不再逐字一致（H5 为修正版）。

## 2026-10-07 会话条目：H5 云端联调打通 + 并入官网 /app/ 发布 (完成代码，云端已联调；待重新部署云函数 / 待真机验收)
- **目标**：让 H5 真正跑起来——① 打通云函数网关（Key 托管链路）；② 决定并落地「H5 与官网」的部署关系。
- **已做**：
  - **云端部署联调**（用户操作 + 我逐项验证）：云开发控制台为 `wereadProxy` 绑 HTTP 网关路由 `/h5`（**新控制台该项叫「HTTP 网关」，旧版开发者工具内置控制台没有此菜单**）；执行超时 3s → 30s；环境变量 `KEY_SECRET`；新建集合 `wre_users`。验证序列：路由连通 → `nosecret`（未配密钥）→ `param`（已配、缺参数）→ 用假 Key 走完「写入 → 读掩码 → 清除 → 再读确认」四步全通（测试数据已清理）。
  - **H5 内置网关地址**：`h5/src/config.js` 的 `ENDPOINT` 写死为 `https://cloud1-d4g1dq0sc7f62329d-1500443307.ap-shanghai.app.tcloudbase.com/h5`；**删除首屏「配置中转服务地址」拦截页**与「我的」页里的地址输入项——该配置属开发者一次性配置，不该让终端用户填。
  - **官网合并发布（本次决定）**：`web/build.py` 新增 `copy_app()`（`h5/` → `dist/app/`，排除 `README.md`）；`web/site.config.json` 新增 `appUrl: "/app/"`；首页 Hero 按钮组新增「网页版体验」（排在「快速上手」与「微信小程序」之间）。
- **修复（本轮发现并已处理）**：
  1. **`keySave` 更新路径报 `-501007 不能更新_id的值`**：读回的托管文档被**原样回写**，把云开发自带的 `_id` 一起写了回去。已改为回写前 `delete base._id`（见 `mobile/cloudfunctions/wereadProxy/index.js` 的 `handleKeySave`）。**该 bug 只在「第二次保存」（文档已存在）时触发**，首次写入的测试覆盖不到——上一条会话的 curl 自测正是首次写入，因此漏过。
- **关键结论/决定**：
  - **H5 与官网「合并部署、源码独立」**：官网用绝对路径（`/assets/...`）必须占域名根；H5 全用相对路径 + hash 路由，`sw.js` 与 manifest 也是相对注册 → 放进 `/app/` **零改造**，且 SW 作用范围自动收在 `/app/` 内，不波及官网。
  - **网关跨域不必额外配**：实测 HTTP 网关自身会加 `Access-Control-Allow-Origin`（且与云函数的不重复），控制台路由的「跨域设置」保持开启即可，`H5_ORIGINS` 可留空。
- **产出物（文件/链接）**：
  - 修改：`web/build.py`、`web/site.config.json`、`mobile/cloudfunctions/wereadProxy/index.js`、`h5/src/config.js`、`h5/assets/app.js`、`h5/src/views/me.js`、`h5/README.md`、`plan/session_handoff_网站帽子云部署.md`。
  - 线上路径：官网 `https://wereadapp-32km31c.maozi.io`，网页版 `https://wereadapp-32km31c.maozi.io/app/`。
- **验证**：`python3 web/build.py` → 25 页 + 4 栏目索引、**0 告警**、37 个文件进 `dist/app/`（`README.md` 未带入）；在 `web/dist` 起本地服务，`/`、`/app/`、`/app/index.html`、`/app/assets/app.js`、`/app/src/views/home.js`、`/app/manifest.webmanifest`、`/app/sw.js` **全部 200**。
- **待办**：
  - **重新上传部署云函数 `wereadProxy`**（含 `_id` 修复），否则更新路径仍报错。
  - 网站 + H5 一起发布：重建 `site-dist` 分支 → 帽子云控制台点部署。
  - 真机验收：填真实 `wrk-` Key、AI 三处、分享图、朗读、同步码、口令看板。
- **风险/注意事项**：① 云函数改动**必须重新部署**才生效（改本机文件不自动同步云端）；② `/app/` 依赖静态托管的目录索引，机制与现有 `/guide/` 相同，风险低；③ 本次改动**未提交**（待用户确认后按 `git-sync` / `pack-publish` 处理）。

## 2026-10-07 会话条目：小程序 / H5 阅读人格严格复刻插件板式 (代码已完成，待真机/浏览器验收)
- **目标**：小程序与 H5 的「阅读人格」结果页内容过少，**严格完整复刻插件板式**。
- **已做**：
  - **H5**（`h5/src/views/persona.js`、`h5/assets/app.css`）：引入 `personaYear`；重写 `dimRow`（对齐插件 `buildPersonaDimHtml`——极名 + 百分比 + 依据 + 居中/数据不足态）；新增 `wordsHtml`（对齐 `buildPersonaWordsHtml`——高频词 TOP10 条形 / 情绪三色条 + 图例 / 主题词 chips / 字号映射词云 / 口头禅）；重写 `personaHtml` 为单张 `.wre-persona` 主卡（头部含人物插画 + 分享 + 绰号 + 一句话 + AI 块 + 四维 + 数据证据 + 原文证据 + 语料提示 + 词语分析 + 边界声明）。
  - **小程序**（`pages/persona/index.{js,wxml,wxss}`）：`renderResult` 补齐视图模型（`dims` rightPct/leftPick/rightPick/basisText、`words.top.barPct`、`words.cloud.size`、`quotes.yearText`、`figureUri`）；WXML 结果块重写为单张 `.wre-card.persona`，逐块对齐插件；WXSS 整体重写（rpx，数值按 `official.css` 比例换算）。
- **关键结论**：复刻权威源 = 插件 `modules/official.js` 的 `buildPersonaSectionHtml()` / `buildPersonaDimHtml()` / `buildPersonaWordsHtml()` 与 `modules/official.css`；三端数据同源（`persona-core`），差异只在渲染层。
- **产出物**：`h5/src/views/persona.js`、`h5/assets/app.css`、`mobile/miniprogram/pages/persona/index.{js,wxml,wxss}`；文档回灌 `plan/RPD_阅读人格_需求文档.md`（v0.3.4）、`plan/RPD_H5移动端_需求文档.md`、`plan/RPD_小程序移动端_需求文档.md`、`test/移动端小程序测试清单.md`（新增 5.9~5.12）。
- **验证**：`GetDiagnostics` 两处改动文件均无 error（仅无害 Hint）。视觉/交互留待真机与浏览器验收。
- **待办**：小程序重新编译预览、H5 刷新页面复验；按 `test/移动端小程序测试清单.md` 5.9~5.12 走查。
- **风险/注意事项**：① 版本号沿用当前开发版 `0.26.0`（上个已归档 Tag 为 v0.25.0），本次未再递增；② 本次改动**未提交**（待用户确认后按 `git-sync` / `pack-publish` 处理）。


