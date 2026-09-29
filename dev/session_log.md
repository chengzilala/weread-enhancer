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
