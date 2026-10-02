# 会话交接：网站帽子云注册 + 部署

> 用途：把这份文档整段复制给能控制浏览器的工具（workbuddy），让它接着完成「帽子云注册 → 授权仓库 → 配置 → 部署 → 回填域名」。
> 背景：网站已用 Vercel 部署成功（https://weread-enhancer.vercel.app），但 **`.vercel.app` 域名在国内被 DNS 污染打不开**，故改用国产平台「帽子云」（maoziyun.com，国内 CDN，免费）重新部署。

---

## 1. 版本 / 优先级

- 项目：微信悦读（weread-enhancer）配套文档站，源码在 `web/`
- 网站阶段：阶段一（壳子与构建链）已完成，`python3 web/build.py` 可产出 `web/dist/`
- 本次唯一目标：把网站部署到**帽子云**，拿到国内可访问的 `*.maoziyun.com` 域名
- 优先级：高（Vercel 域名国内打不开，卡在最后一步）

---

## 2. 本会话已完成

1. 网站构建链全部写好：`web/build.py`（构建）、`web/serve.py`（预览）、`web/templates/layout.html`、`web/assets/site.css|site.js`
2. 内容源已备齐：`web/content/`（19 篇 markdown + 3 栏目索引，Obsidian 可直接打开）
3. 本地验证通过：构建无报错、预览 200、`dist/api/latest.json` 正常生成
4. 代码已推送到 GitHub：仓库 `chengzilala/weread-enhancer`，分支 `main`
5. Vercel 已部署成功（`https://weread-enhancer.vercel.app`），但**国内 DNS 污染无法访问**，需换帽子云
6. `web/site.config.json` 第 4 行 `baseUrl` 当前是 `https://weread-enhancer.vercel.app`，**部署到帽子云后必须改掉**

---

## 3. 下一步（谁做 / 是否需确认）

> 以下全部由 workbuddy 完成，注册帽子云账号需要用户的手机号/邮箱收验证码，用户本人已在场可配合。

1. **注册帽子云**（workbuddy 做，需用户配合收验证码）
   - 打开 https://dash.maoziyun.com/login → 注册/登录账号

2. **授权并导入仓库**（workbuddy 做）
   - 新建静态应用 → 点击授权访问 GitHub → 选择 `chengzilala/weread-enhancer` → 选 `main` 分支

3. **配置项目**（workbuddy 做）
   - 根目录：`web`
   - 构建命令：`python3 build.py`
   - 输出目录：`dist`
   - （帽子云字段名可能叫「构建目录 / 输出目录 / 根目录」，对应填这三项即可）

4. **部署**（workbuddy 做）
   - 点创建应用，等构建完成，记下分配的域名（形如 `https://xxx.maoziyun.com`）

5. **回填真实域名**（workbuddy 做，需用户确认域名）
   - 打开 `web/site.config.json`，把第 4 行 `baseUrl` 从 `https://weread-enhancer.vercel.app` 改成帽子云分配的域名
   - 改完 `git add web/site.config.json && git commit && git push`，帽子云会自动重建
   - **此步需先问用户确认域名**

---

## 4. 关键文件路径表

| 文件 | 路径 | 说明 |
|---|---|---|
| 站点配置 | `web/site.config.json` | baseUrl 在第 4 行，部署后必改 |
| 构建脚本 | `web/build.py` | 零依赖，Python 3.9，读仓库根 `manifest.json` 生成版本号 |
| 预览脚本 | `web/serve.py` | 本地 `python3 web/serve.py` → localhost:5173 |
| 文章源 | `web/content/` | Obsidian vault，唯一事实源 |
| 网站需求文档 | `plan/RPD_网站生态_需求文档.md` | 阶段一需求与状态 |
| 仓库地址 | https://github.com/chengzilala/weread-enhancer | main 分支 |

---

## 5. 红线提醒

1. **根目录必须设 `web`**：`build.py` 要读仓库根的 `manifest.json`，所以必须从仓库根目录部署、根目录填 `web`；填错会报 `FileNotFoundError: manifest.json`。
2. **部署后必须回填 `site.config.json` 的 baseUrl**，否则 `dist/api/latest.json` 里的 changelogUrl 和插件深链会指向 Vercel 的旧域名。
3. **不要动插件代码**：本地工作区还有一批**未提交的插件改动**（`manifest.json`、`background.js`、`modules/`、`plan/RPD_需求文档.md` 等），那些是另一条任务在改；本任务只处理 `web/` 和 `web/site.config.json`，不要 `git add .` 一把梭。
4. **不要提交密钥**：仓库里不应出现任何帽子云 token / API Key / 账号密码；部署走 Git 集成，不需要在代码里放凭据。
5. **构建命令是 Python**：帽子云环境大概率自带 Python 3；若报「找不到 python3」，改用 `python build.py` 再试，仍不行就回来找主会话加 Node 版兜底。
6. 注册/提交需在用户本人授权下进行（用户已在场配合）。
