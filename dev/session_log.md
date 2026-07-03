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
