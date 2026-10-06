# 会话交接：网站发布协作（DeepSeek ↔ WorkBuddy）

> 用途：把这份文档整段复制给 DeepSeek，让它明白**它要产出什么**、**我需要什么**，最终由 WorkBuddy（能控制本机浏览器）完成帽子云部署上线。
> 一句话目标：**DeepSeek 备料（内容/产物）→ WorkBuddy 点部署（平台控制台）→ 线上生效并验证。**

---

## 1. 角色分工：谁在哪一步，谁做不了什么

| 角色 | 所在环境 | 负责 |
|---|---|---|
| 用户 | 人 | 决策（发哪个版本、是否直接发）；在 Trae 里提交源码 |
| **DeepSeek** | 另一会话（能力待确认，见第 3 节两种情形） | 改内容 / 写文档 / 出具「交接单」；若它在本机能跑命令，则自行构建 + 推 `site-dist` |
| **WorkBuddy（我）** | 本机 macOS：浏览器自动化 + 帽子云账号 + Python venv + 仓库读写 | 构建校验、推 `site-dist`（如 DeepSeek 未推）、**帽子云控制台点部署**、线上验证、报告 |

**关键约束（决定了分工的边界）**：
- **帽子云部署只有 WorkBuddy 能做。** 平台用 GitHub 公开仓库做来源、不支持 webhook 自动重建，每次都必须有人登录 `dash.maoziyun.com` 在控制台点一次「部署」。这一步依赖**带登录态的浏览器会话**（账号 `zccc`），DeepSeek 无论多强都到不了这一步，也不该尝试。
- **内容要落到本机磁盘才能构建。** 构建脚本读的是本地工作区的 `web/content/`，不是 GitHub。所以 DeepSeek 若只能产出文本，必须把内容给到 WorkBuddy 由我落盘；若 DeepSeek 就跑在这台机器上，它可以直接改文件。

---

## 2. 背景事实（DeepSeek 必读，别凭常识猜）

| 项 | 值 |
|---|---|
| 仓库路径 | `/Users/Admin/Knowledge/Coding/微信读书插件` |
| GitHub | `https://github.com/chengzilala/weread-enhancer.git` |
| 网站内容源 | `web/content/**/*.md`（Obsidian 语法：`[[双链]]`、`![[附件.png]]`） |
| 站点配置 | `web/site.config.json`（baseUrl / nav / sections / storeUrls） |
| **版本号唯一事实源** | `manifest.json` 的 `version`（网站页脚、公告、构建输出全部读它） |
| 更新日志 | `web/content/更新日志.md`，**倒序**，最新一节在最上面 |
| 构建脚本 | `web/build.py`（零依赖，但需要 Pillow 生成图库缩略图） |
| 构建命令 | `/Users/Admin/.workbuddy/binaries/python/envs/default/bin/python web/build.py` |
| 构建产物 | `web/dist/`（页面 + `assets/` + `api/latest.json`） |
| 部署分支 | `site-dist`（orphan 分支，**只含 dist 产物**，每次 force push 覆盖） |
| 托管平台 | 帽子云 `https://dash.maoziyun.com/project/3936/app/wereadapp`（账号 `zccc`） |
| **线上主域名** | **`https://wereadapp-32km31c.maozi.io`** |
| 插件公告接口 | `https://wereadapp-32km31c.maozi.io/api/latest.json`（插件读它判断"有新版本"） |

**链路全貌**：

```
web/content/*.md  →  build.py  →  web/dist/  →  推送 site-dist 分支  →  帽子云控制台点部署  →  wereadapp-32km31c.maozi.io
     ↑ DeepSeek 改这里        ↑ 我构建        ↑ 我或 DeepSeek 推          ↑ 只有我能点
```

---

## 3. 我需要 DeepSeek 做什么（按它的能力二选一）

### 情形 A：DeepSeek 能操作本机/仓库（可跑 git、python）

它负责到「推送 `site-dist`」为止，然后给我一张交接单，我接着点部署：

1. 改好 `web/content/`，并在 `web/content/更新日志.md` 顶部补对应版本一节
2. 确认 `manifest.json` 的 `version` = 要发布的版本
3. 构建：`/Users/Admin/.workbuddy/binaries/python/envs/default/bin/python web/build.py`（看到 `告警：0 条`）
4. 打包推送（`web/dist` → 全新 orphan 分支 `site-dist`，force push；详见第 6 节命令）
5. 填写第 5 节的「交接单」发给我

### 情形 B：DeepSeek 只是聊天窗口（碰不到本机文件）

它把「资料」交给我，由我落盘、构建、部署。**必须给全，缺一项我就得回头问**：

1. **完整文件内容**（不要只给 diff 片段，除非明确说明在哪个文件的哪一行替换）
   - 每个文件标注：目标路径（如 `web/content/功能教程/xxx.md`）+ 整段 Markdown 内容（要含 frontmatter）
2. **目标版本号**（写成 `0.24.0` 这种）；以及是否已在「更新日志.md」里补了该版本一节
3. **附件图片的本地路径**（二进制我没法从聊天里落盘——若新增图片，请说明图片在本机的存放路径，或让用户直接拷到 `web/content/attachments/`）
4. **一句话发布摘要**（用于部署 commit message）
5. 第 5 节交接单照填

> 无论 A/B：**不要替用户提交源码**（见第 7 节红线），DeepSeek 做到产物推送或内容交付即止。

---

## 4. 我（WorkBuddy）拿到后做什么

固定五步，DeepSeek 可据此判断"是否已全部完成"：

1. **诊断**：核对 `manifest.json` 版本 vs 更新日志最新一节是否一致；`git status --short -- web/ manifest.json` 看网站侧改动
2. **构建**：用带 Pillow 的解释器跑 `web/build.py`，期望 25 篇页面 + 4 个栏目、`告警：0 条`、38 张缩略图
3. **推分支**：`web/dist` → orphan `site-dist` → force push（GitHub 走代理常报 502，重试 3–4 次即通）
4. **点部署**：agent-browser 登录帽子云 → 应用 `wereadapp` → 「部署」→ 分支填 `site-dist` → 选 `Create "site-dist"` → 「立即部署」→ 等 25s 刷新列表确认「当前版本」
5. **验证并回报**：主域名逐页 200、`api/latest.json` 版本、`/changelog/` 含新版本、新配图可访问

---

## 5. 交接单模板（DeepSeek 复制填写后发我）

```text
【网站发布交接单】
1. 目标版本号：            （= manifest.json version，如 0.24.0）
2. 更新日志是否已补该版本： 是 / 否（若"否"，请说明是接受超前发布还是我等你补）
3. 内容改动清单：
   - web/content/xxx.md            —— 一句话说明
   - web/content/功能教程/xxx.md    —— 一句话说明
4. 新增/删除附件：
   - 新增 web/content/attachments/xxx.png（是否已在磁盘：是/否）
5. site-dist 远端 commit： 已推到 xxxxxxx / 未推（由 WorkBuddy 推）
6. 红线确认：未提交敏感文件（usage/GitHub账号资料.md 等）☑
              未 git add . 插件/移动端代码 ☑
7. 备注/风险（版本超前、待补内容等）：
```

---

## 6. 附：构建与推分支的准确命令（情形 A 用；我也用同一套）

```bash
REPO="/Users/Admin/Knowledge/Coding/微信读书插件"
PY=/Users/Admin/.workbuddy/binaries/python/envs/default/bin/python

# 1) 构建
cd "$REPO" && "$PY" web/build.py          # 期望末行：告警：0 条

# 2) 只取产物，做全新 orphan 分支（务必删掉嵌套 .git）
UN="$(git -C "$REPO" config user.name)"; UE="$(git -C "$REPO" config user.email)"
rm -rf /tmp/wrdeploy && mkdir -p /tmp/wrdeploy
cp -R "$REPO/web/dist/." /tmp/wrdeploy/
cd /tmp/wrdeploy && rm -f .git
git init -q -b site-dist
git config user.name "$UN"; git config user.email "$UE"
git add -A && git commit -q -m "deploy: vX.Y.Z 官网更新（摘要）"
git remote add origin https://github.com/chengzilala/weread-enhancer.git

# 3) 推送：502 是常态，重试到成功为止
for i in 1 2 3 4; do
  GIT_TERMINAL_PROMPT=0 git push --force origin site-dist 2>&1 | tail -2
  GIT_TERMINAL_PROMPT=0 git ls-remote origin refs/heads/site-dist | grep -q "$(git rev-parse HEAD)" && { echo PUSH_OK; break; }
  sleep 6
done
```

若构建告警「未安装 Pillow，跳过图库缩略图」，补装一次：
`/Users/Admin/.workbuddy/binaries/python/envs/default/bin/pip install pillow -i https://pypi.tuna.tsinghua.edu.cn/simple`

---

## 7. 红线与已知坑（DeepSeek 必须遵守）

1. **只碰网站文件**：`web/content/**`、`web/assets/**`、`web/templates/**`、`web/build.py`、`web/site.config.json`；`manifest.json` 只允许改 `version`。**不要动** 插件代码（`modules/`、`background.js`、`manifest.json` 其它字段）、`mobile/`（小程序）、`dev/`。
2. **绝不 `git add .`**：仓库里同时有多条任务线的未提交改动，一把梭会把别人的半成品混进来。
3. **敏感文件不提交**：`usage/GitHub账号资料.md` 等一律不进仓库。
4. **不替用户提交源码**：内容改动的提交由用户在 Trae 里统一完成；DeepSeek/我最多只提交**部署产物**到 `site-dist`。
5. **图片引用**：正文用 `![[文件名.png]]`，附件放 `web/content/attachments/`；新图片会随构建自动打包，不需要单独提交到仓库。
6. **新增页面/栏目**：新页面 frontmatter 必须有 `title` / `slug` / `order` / `description` / `updatedAt`；若新增**栏目**，还要在 `web/site.config.json` 的 `sections` 里加 `{key,dir,title,description}` 并在 `nav` 加导航项，否则不会被生成。
7. **版本一致性**：`manifest.json` 的 `version` 与「更新日志.md」最新一节**应对齐**。若故意超前发布，请在交接单第 7 项写明。
8. **验证域名别用带随机前缀的**：`tqxch7e9l-…`、`bst6lq8gp-…` 这类是**单次部署的快照 URL，永远停在那一版**，用它验证会得到"永远 404"的假象，误判成"CDN 没刷新"。**只认 `https://wereadapp-32km31c.maozi.io`**。
9. **CDN 缓存**：`max-age=1200`（约 20 分钟）。验证时加 `?cb=<时间戳>` 绕过缓存。
10. **中文文本别用 grep 管道判断**：本机 `grep` 对 UTF-8 中文长管道偶发返回空，会误判"内容没更新"。用 Python 计数或读文件长度校验。
11. **僵尸锁**：仓库常有 `.git/index.lock`、`.git/refs/remotes/origin/HEAD.lock` 残留（用户在 Trae 里跑着编辑器）。不确定是否有活跃 git 进程时**不要删**，只做只读操作。
12. **平台已知 bug**：构建设置表单保存状态脱钩（改配置只能删应用重建）；应用名删除后短期被占用；域名随机分配不可自选；**push 不会触发重建**，必须手动点部署。

---

## 8. 验收标准（线上达到才算完成）

- 主域名以下路径全部 200：`/`、`/start/`、`/guide/`、`/guide/api-key/`、`/persona/`、`/gallery/`、`/changelog/`、`/faq/`、`/privacy/`、`/about/`、`/tips/`、`/thinking/`
- `api/latest.json` 的 `latestVersion` = 目标版本号，`notice` 文案与更新日志一致
- `/changelog/` 页面含目标版本号
- 本次新增的配图 URL 返回 200

**回执格式**（我给用户/DeepSeek 的完成报告）：

```text
【发布完成】
部署提交：site-dist = <commit> → 帽子云当前版本 <url-id>
线上验证：<N>/<N> 页 200；公告 <版本号>；changelog 含 <版本号>
待你处理：<未提交文件 / 版本不一致等>
```

---

> 参考：WorkBuddy 侧已把整套流程固化为技能 `~/.workbuddy/skills/weread-site-publish/SKILL.md`；更详细的历史踩坑与部署史见本仓库 `plan/session_handoff_网站帽子云部署.md`。两份文档可一并提供给接手方。
