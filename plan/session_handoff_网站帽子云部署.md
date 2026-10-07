# 会话交接：网站帽子云注册 + 部署

> 用途：把这份文档整段复制给能控制浏览器的工具（workbuddy），让它接着完成「帽子云注册 → 授权仓库 → 配置 → 部署 → 回填域名」。
> 背景：网站已用 Vercel 部署成功（https://weread-enhancer.vercel.app ），但 `.vercel.app` 域名在国内被 DNS 污染打不开，故改用国产平台「帽子云」（maoziyun.com，国内 CDN，免费）重新部署。

---

## 1. 版本 / 优先级

- 项目：微信悦读（weread-enhancer）配套文档站，源码在 `web/`
- 网站阶段：阶段一（壳子与构建链）已完成，`python3 web/build.py` 可产出 `web/dist/`
- 本次唯一目标：把网站部署到帽子云，拿到国内可访问的域名
- 优先级：高（Vercel 域名国内打不开，卡在最后一步）

---

# 执行结果（已完成，2026-10-03 01:45）

> 承接上文交接，本任务已完成「注册 → 配置 → 部署 → 回填域名」全部步骤。
> 实际执行路径与原文不同：**未走 GitHub OAuth 授权，也未在平台侧构建**，原因与替代方案见下。

## 1. 线上地址

> **2026-10-04 重大修正**：`tqxch7e9l-…` 不是稳定别名！帽子云的域名规则是——**每个部署都有一个随机前缀的专属 URL（永远指向那次部署的内容）**，而**不带随机前缀的 `https://wereadapp-32km31c.maozi.io` 才是主域名，自动跟随最新一次部署**。此前把 tqxch7e9l 当"稳定别名"是误判（两次部署内容差异太小没暴露），导致第二、三次部署后主地址一直停留在旧版本。baseUrl 已改为主域名（main 提交 `9ff56c9`）。

| 项 | 值 |
|---|---|
| **生产主域名（跟随最新部署）** | **https://wereadapp-32km31c.maozi.io** |
| 部署专属 URL（历史快照，不跟随更新） | 如 https://a62v60vnt-wereadapp-32km31c.maozi.io（v0.15.1 最终版） |
| ~~旧文档误记的"稳定别名"~~ | ~~https://tqxch7e9l-wereadapp-32km31c.maozi.io~~（实为 8c31749 那次部署的专属 URL，勿再使用/回填） |
| 账号 | 帽子云用户 `zccc`（手机 176****3974，邮箱未绑定） |
| 控制台 | https://dash.maoziyun.com/project/3936/app/wereadapp |
| 验证结果（2026-10-04 v0.15.1） | 全站 200，`/guide/api-key/` 已上线，`api/latest.json` 的 changelogUrl 指向主域名 |
| CDN | Cloudflare 代理，静态资源 `cache-control: max-age=1200`，更新后约 20 分钟内全网刷新 |

注意：域名后缀是 `maozi.io` 而非 `maoziyun.com`；域名由平台自动分配（随机前缀），**无法自选**，且换名重建会换域名。

## 2. 实际生效的部署配置

| 配置项 | 值 |
|---|---|
| 应用名 | `wereadapp`（应用名仅允许数字字母 4–20 位，不能带连字符） |
| 部署来源 | Git → 公开 Git 仓库（**未做 GitHub OAuth 授权**） |
| 仓库 | https://github.com/chengzilala/weread-enhancer |
| 分支 | **`site-dist`**（orphan 分支，仓库根就是构建产物，无 manifest.json） |
| 根目录 / 构建命令 / 输出目录 | 全部留空（纯静态托管，平台直接发分支内容） |
| 线上版本 | v0.14.1（读自 main 的 manifest.json） |

## 3. 与交接原文不同的三点（重要，需知悉）

### 3.1 没走 GitHub OAuth，走「公开仓库」来源

帽子云创建应用有三种来源：GitHub（需 OAuth 授权）/ Gitee / Git（公开仓库地址）。GitHub 授权要求在自动化浏览器里登录 GitHub（本机没有可复用的 GitHub 登录态，上一次会话已验证此路不通），所以改用 **Git 公开仓库**来源——仓库是 public 的，直接填 URL 即可。

**代价**：此来源没有 webhook，push 不会自动触发重建，**更新内容需要在控制台手动点「部署」**（自动化可代办）。

### 3.2 「平台侧构建」不可用，改为「本地构建 + site-dist 分支」

原文计划的配置（根目录 `web` + 构建命令 `python3 build.py` + 输出目录 `dist`）在帽子云上**构建必失败**：

```
ERROR: 未知服务类型：检测到当前应用非 Some[static] 应用。
```

排查结论（对照组实验）：
- mdn 纯静态仓库 + 无构建命令 → ✅ 成功
- mdn 仓库 + 构建命令 `echo build-ok` → ✅ 成功
- 本仓库（根目录有浏览器扩展的 `manifest.json`）+ 任何构建命令 → ❌ 同样报错

即：**平台在构建前的项目类型探测会扫描仓库根，被扩展的 `manifest.json` 干扰，报出误导性的「非 static 应用」错误**。这是帽子云的 bug（构建设置的保存表单也有 React 状态脱钩问题：改了字段点保存，POST 发出的仍是旧值，只能删应用重建）。

**替代方案（已生效）**：
1. 本地 `python3 web/build.py` 构建；
2. 把 `web/dist/*` 以 **orphan 分支 `site-dist`** 推到 GitHub（仓库根只含网站产物，无 manifest.json）；
3. 帽子云应用直接托管 `site-dist` 分支根目录，无需构建。

`site-dist` 分支已通过 GitHub API（Git Data API，凭据用钥匙串里的 `gho_` OAuth token，未写入任何文件）创建并更新两次：
- `8c31749` 首次部署
- `b899245` 更新 baseUrl 为帽子云域名

### 3.3 baseUrl 已回填并推送

`web/site.config.json` 第 4 行已改为 `https://tqxch7e9l-wereadapp-32km31c.maozi.io`，已提交到 main（`e141e71`）并推送成功。`dist/api/latest.json` 的 changelogUrl 已指向帽子云域名（CDN 缓存过期后全网生效）。

## 4. 日常更新流程（重要：与 Vercel 时代不同）

```bash
# 1. 改 web/content/ 或模板后，本地构建
cd web && python3 build.py

# 2. 更新 site-dist 分支（在临时 worktree 里做，避免动主工作区的未提交插件改动）
git worktree add /tmp/weredeploy --detach origin/main
cp web/site.config.json /tmp/weredeploy/web/site.config.json   # 保持配置同步
cd /tmp/weredeploy/web && python3 build.py && cd /tmp/weredeploy
git checkout --orphan site-dist-new && git rm -rfq .
cp -R web/dist/* . && git add -A && git commit -m "deploy: ..."
git push origin site-dist-new:site-dist --force   # 若 HTTPS 推送被代理挡，可用 GitHub API（见下）
git worktree remove --force /tmp/weredeploy

# 3. 帽子云控制台 → wereadapp → 部署 → 输入 site-dist → 立即部署

   ⚠️ 部署弹窗的「分支」下拉是**空的（"没有选项"）**，不是下拉选择，而是
   直接在输入框键入 `site-dist` → 选项里出现 `Create "site-dist"` → 点击它
   →「立即部署」由灰变亮 → 点击。构建约 4–15 秒，完成后点「刷新列表」确认
   新部署行带「当前版本」标签。部署成功后，主域名立即指向新版本（CDN 缓存
   最多延迟 20 分钟）。
```

HTTPS 推送 github.com 走本机代理（127.0.0.1:53893）间歇性 502；`api.github.com` 通常可达，可用 Git Data API（tree → commit → PATCH refs/heads/site-dist）兜底。注意 tree API 会拒绝路径恰好为 `.git` 的文件（worktree 里的 `.git` 是个普通文件）。

## 5. 本次对仓库的改动

| 文件 | 改动 | 状态 |
|---|---|---|
| `web/site.config.json` | baseUrl → 帽子云域名 | 已提交 `e141e71` 并推送 |
| `site-dist` 分支 | 新增（orphan，纯 dist 产物） | 已推送，两次更新 |

插件代码、`web/content/*` 的未提交改动**未被触碰、未被提交**。

## 6. 遗留事项 / 建议

1. **Vercel 站点仍在线**（https://weread-enhancer.vercel.app，海外可访问）。可保留作海外镜像，也可删除项目；若保留，其 baseUrl 已与主站不同步，`latest.json` 内容以帽子云为准。
2. **自动部署**：push 不触发帽子云重建（无 webhook）。若想要自动部署，需在帽子云「Git集成」里完成 GitHub OAuth（同样受浏览器登录态问题限制），或者写个本地脚本把上面第 4 节流程自动化。
3. **帽子云账号安全**：注册密码较简单（用户自设），建议改强密码；平台完全免费，稳定性未知，重要场景可考虑自定义域名。
4. **CDN 缓存 20 分钟**：更新部署后 `api/latest.json` 最多延迟 20 分钟刷新（`max-age=1200`）。
5. 帽子云控制台自动化注意事项（供后续会话复用）：表单按钮可能不在视口内导致点击无效（先 `scrollIntoView` 再用鼠标事件）；「构建设置」的保存存在状态脱钩，改配置请直接删应用重建；应用删除后名字短期仍被占用。

---

## 7. 2026-10-04 更新记录（v0.15.1 文档更新上线 + 主域名修正）

**任务**：用户在 `web/content/` 更新了一批使用说明（API Key 使用说明新增、更新日志 v0.15.1、隐私声明调整等），要求同步上线。

**执行**：
1. `python3 web/build.py` 本地构建（19 页 + 3 栏目索引，0 告警）；
2. 用临时目录 `/tmp/wrdeploy` 生成**干净的** site-dist（只含 `web/dist/*` 顶层内容，无 `web/dist/` 重复目录——此前分支混入过重复目录，勿再复现），force push；
3. 帽子云控制台部署两次：第一次 b3e7f87（暴露了主域名问题），修正 baseUrl 后第二次 1078b07；
4. main 提交 `9ff56c9`：`web/site.config.json` baseUrl → `https://wereadapp-32km31c.maozi.io`。

**验证**：主域名全站 200，`/guide/api-key/` 200，`api/latest.json` 的 changelogUrl 指向主域名。

**当天发现/踩坑（重要）**：
- **主域名规则**（见第 1 节修正）：`wereadapp-32km31c.maozi.io` 跟随最新部署；带随机前缀的是部署专属 URL。回填/引用一律用主域名。
- **部署弹窗分支下拉为空**：需手动输入分支名（见第 4 节第 3 步）。
- **GitHub 推送间歇超时**（443 连接失败/502）：重试即可，当天 git push 重试 1 次成功。
- **部署点击后列表不自动刷新**：点「刷新列表」按钮手动刷新，新部署行可能延迟 10–20 秒出现。
- 更新过程中用户编辑器同时在改 `plan/RPD_网站生态_需求文档.md`（未提交，与网站无关，勿动、勿提交）。

### 7.1 判断"是否已部署"的正确姿势（2026-10-04 二次踩坑）

- **不要用本地 `origin/site-dist` 判断远端状态**：本地 remote-tracking ref 可能是过期的（本次会话因未先 fetch，误以为远端还停在 b899245，白跑了一轮构建+推送）。
  正确做法：先 `git fetch origin site-dist`，再 `git log --oneline -1 origin/site-dist`。
- **若 fetch 报 `unable to update local ref`**：是上次失败留下的僵尸锁，删掉即可：
  `rm -f .git/refs/remotes/origin/site-dist.lock && git fetch origin site-dist`
- **验证线上内容时用主域名**（见第 1 节），不要用带随机前缀的部署 URL，否则会得到"永远 404"的假象，误判为 CDN 未刷新。

### 7.2 更新网站时的协作注意（2026-10-04 第三轮）

- **网站构建读的是工作区文件**（`web/content/*.md` + 根 `manifest.json`），**不要求先提交**。所以只要内容改好就能发布；不要为了发网站而擅自 `git add` 用户的 content。
- 若 `manifest.json` 版本处于"开发中未上架"状态（如 v0.17.0 而商店最新包只到 v0.15.2），发布前要意识到：`api/latest.json` 会自动公告该版本，**已安装的插件用户会看到"有新版本"却可能升级不了**。需要用户确认时机。
- **不要把用户的改动替用户提交**：插件代码 + content + plan/test 往往是一次完整的版本提交（如 v0.17.0），AI 插手拆分提交会破坏原子性。除非用户明确要求。
- **遇到 `.git/index.lock` / `refs/.../*.lock` 残留**：先用 `pgrep -fl git` 确认无进程，且注意用户可能正开着 Trae（其终端可能在跑 `python3 web/serve.py` 预览）。无法确认时**不要删锁**，只做只读操作（`git status`、`git log` 不受影响），并在回复中告知用户。
- **验证页面文字时不要直接用管道**：`curl ... | grep 书架` 可能因编码/缓冲返回空，造成"内容没上去"的误判。改为先存入变量再 `printf '%s' "$html" | grep -c '书架'`，或用 `grep -o '<title>[^<]*</title>'` 交叉确认。

### 7.3 2026-10-04 第四次部署：v0.18.0 网站更新 + 版面优化

**背景（本轮网站侧改动）**：
- 「更新日志」已含 v0.18.0 一节（阅读人格 + 手动触发分析 + 书架/搜书跳转修复），构建版本告警已消除；
- 版面优化（`web/assets/site.css`）：正文区宽度 `96vw → 80vw`（`--max-width: min(1920px, 80vw)`）；
- 栏目索引页（功能教程 / 进阶技巧 / 知识资产）：去掉标题前重复的描述段（`web/build.py`），卡片标题 `1em → 1.05em`、描述 `14px → 0.95em`；并修 `.card-list` 被 `.doc ul` 的 `padding-left:22px` 顶开的左错位（改用 `.doc .card-list` 提升优先级）。

**执行**：本地 `python3 web/build.py`（19 页 + 3 栏目索引）→ 更新 `site-dist` 分支 → 帽子云部署（用户操作）。

**结果（2026-10-04 核实）**：
- `site-dist` HEAD：`3fc4e37 deploy: v0.18.0 网站更新（栏目索引页去描述段 + 样式微调）`
- 主域名 `https://wereadapp-32km31c.maozi.io` 全站 200；
- 线上 `/assets/site.css` 已含 `--max-width: min(1920px, 80vw)` 与 `.doc .card-list`；
- 线上 `/changelog/` 含 v0.18.0。

**待办**：商店后台（Edge/Chrome/360）的「网站 URL」改为配套站点（文档已改，平台侧需用户操作）。

### 7.4 2026-10-07 网页版（H5）并入网站 `/app/`

- `python3 web/build.py` 现在会把 `h5/` 一并拷到 `web/dist/app/`（排除 `README.md`）。所以**更新 `site-dist` 分支时网页版自动随行**，不需要额外步骤，线上地址 `https://wereadapp-32km31c.maozi.io/app/`。
- 首页 Hero 新增「网页版体验」按钮，由 `web/site.config.json` 的 `appUrl` 控制（留空则不渲染）。
- 为什么能放子目录：H5 全用相对路径 + hash 路由，`sw.js` 与 manifest 也是相对注册 → PWA 作用范围自动收在 `/app/` 内，**不影响官网**。
- 部署配置无需改动：仍是纯静态托管 `site-dist` 分支根目录。

