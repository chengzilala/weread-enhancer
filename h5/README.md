# 微信悦读 · H5（纯网页移动端）

把小程序「读完之后」的复盘 + 分享能力搬到**纯网页**，并保留小程序侧已关闭的 AI 能力。
需求文档：`plan/RPD_H5移动端_需求文档.md`。

- 技术栈：原生 HTML / CSS / JS（ES Module），**零外部依赖**。
- 数据来源：复用微信云函数 `wereadProxy` 的 HTTP 网关（控制台「HTTP 网关」路由）中转官方接口（浏览器无法直连）。
- 身份：无登录，用本机随机 `deviceId`（32 位十六进制）识别。
- Key：只提交一次给**你自己的云函数加密托管**（AES-256-GCM），本机只留掩码，可一键清除。
- 计算：阅读数据 / 人格 / 报告全部在浏览器本机按固定规则算出（`h5/src/core/*` 与小程序 `shared/*` 逐字一致）。

## ⚠️ 红线（改代码前必读）

1. **零外部依赖**：不引入任何 npm 包 / CDN 脚本。
2. **Key 不落本机明文**：`localStorage` 只存 `deviceId` / 掩码 / 昵称 / 接口缓存；明文只在提交那一刻经 HTTPS 发给云函数。
3. **旧代码不改**：小程序（`mobile/`）、官网（`web/`）、插件（根目录 `modules/` 等）不受本目录影响；H5 独立构建部署。
4. 样式类名统一前缀 `wre-`；版本号写在根 `manifest.json`（本目录 `config.js` 的 `APP_VERSION` 仅作展示）。

## 目录结构

```
h5/
├── index.html              外壳页（header / main#view / nav#tabbar）
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker（网络优先）
├── assets/
│   ├── app.css             移动端样式（品牌色 #2F6BFF）
│   ├── app.js              应用外壳：hash 路由（五栏 Tab + 二级页）+ 拦截态
│   ├── pwa.js              PWA 注册（仅 https / localhost）
│   └── icon.svg            图标
└── src/
    ├── config.js           全局配置（中转地址、超时）
    ├── store.js            本机存储（账户码 / 端点 / 掩码 / 昵称 / 缓存）；统一键 wre_account_*，与官网共用
    ├── api.js              中转客户端（relay / ai / keySave / ops…）
    ├── data.js             取数层（拼装官方接口 → 精简结构）
    ├── ai.js               AI 通道（H10 人格画像；托管 Key）
    ├── share.js            分享图（canvas）+ Web Share / 下载 / 复制链接
    ├── tts.js              语音复习（Web Speech API）
    ├── ui.js               esc / stateHtml / toast / copyText / confirmSignOut（退出前保存账户码弹层）
    ├── core/               纯计算（与小程序 shared 逐字一致，仅 CJS→ESM）
    │   ├── format.js  report-core.js  persona-core.js  home-core.js  errors.js
    │   ├── daily-core.js  daily-data.js  daily-generate.js  daily-ai.js  daily-store.js
    │   └── wander-core.js  wander-data.js  wander-ai.js  wander-store.js
    └── views/              页面：home / persona / report / shelf / me
                            + daily / wander / admin
```

## 一、部署云函数（中转服务）

H5 的全部数据、AI、Key 托管都经云函数完成，先按 `mobile/cloudfunctions/wereadProxy/index.js` 顶部「部署提醒」配置：

1. 上传部署 `wereadProxy`；把**超时时间改为 30 秒**（默认 3 秒不够）。
2. 「云开发控制台 → 数据库」新建集合 `wre_users`，权限选**「仅管理端可读写」**（存加密后的 Key）。
3. 「云函数 → wereadProxy → 配置 → 环境变量」新增：
   - `KEY_SECRET`：一串足够长的随机字符串，用于应用层加密。**一旦设置不要更改**，否则已托管的 Key 无法解密。
   - `H5_ORIGINS`：允许跨域的 H5 站点地址（如 `https://your.site`），多个用英文逗号分隔。**不配则退回 `Origin: *`**（仅调试用，上线务必收敛）。
4. 「云开发控制台 → HTTP 网关 → 域名及路由 → 添加路由」为 H5 另绑一个路径（如 `/h5`）到本函数：
   - 访问路径 `/h5`；关联资源选「云函数」→ `wereadProxy`
   - 「跨域设置」**关闭**（跨域由云函数自身的 `H5_ORIGINS` 处理，重复配置会出现两个 CORS 头反而报错）
   - 「路径透传」「身份认证」均关闭
   保存后得到形如 `https://<envId>-<随机串>.<地域>.app.tcloudbase.com/h5` 的地址。

## 二、配置中转地址（开发者一次性）

网关地址是**部署参数，终端用户无需填写**：把它写进 `h5/src/config.js` 的 `ENDPOINT` 即可（本仓库已内置）。

本地调试可用网址参数临时覆盖，优先级：网址参数 > 本机 localStorage > `config.js` 常量：

```
http://localhost:8930/?endpoint=https://xxx.app.tcloudbase.com/h5
```

配好后打开 H5，填写以 `wrk-` 开头的微信读书 Key（DeepSeek Key 可选）即可使用。

> **与官网同一套账户**：官网（`/`）与网页版（`/app/`）同域名同 origin，共用同一组存储键 `wre_account_*`（旧 `wre_h5_*` 首次加载自动迁移，登录态不丢）与同一个登录系统；官网「我的账户」页 `/account/` 直接 `import` 本目录的 `store / api / ui` 模块，因此两端是同一份账户实现，登录态天然互通、无需同步。

## 三、本地预览

本项目无需构建（纯静态），用任意静态服务器即可（ES Module 不能用 `file://` 直开）：

```bash
cd h5
python3 -m http.server 8930
# 浏览器打开 http://localhost:8930/
```

调试中转可用一次性参数，避免手改配置：

```
http://localhost:8930/?endpoint=https://xxx.service.tcloudbase.com/h5
```

> 本地域名不在 `H5_ORIGINS` 白名单时会被 CORS 拦截；调试期可临时把本地地址加入白名单（如 `http://localhost:8930`），或暂不配 `H5_ORIGINS`。

## 四、上线

把 `h5/` 目录整份上传到任意静态托管（对象存储 / 静态网站托管 / CDN），确保：

- 站点支持 HTTPS（Key 提交必须加密传输）。
- 把线上域名补进云函数环境变量 `H5_ORIGINS`。
- 页面与 `assets/`、`src/` 保持相对路径结构不变。

## 五、实现的页面（阶段 0 – 阶段 4）

底部五栏：首页 / 人格 / 报告 / 书架 / 我的；二级页（自带返回）：每日卡片 / 灵感漫游 / 运营看板。

| 页面 | 说明 |
| --- | --- |
| 首页 H2 | 周期切换（本周/本月/本年/累计）+ Hero + 迷你趋势 + 指标 + 偏好分类 + 时段 + 读得最多；底部入口含每日卡片 / 灵感漫游 |
| 人格 H3 | 本地规则判定阅读人格（4 维 / 16 型），含数据门槛引导 |
| 人格 H10 | AI 润色画像（走托管 DeepSeek Key；失败退回本机判定） |
| 报告 H4 | 结构化文字报告（标题 / 指标 / 表格 / 卡片 / 列表） |
| 每日卡片 H11 | 从自己的划线 / 想法取材，AI 成文；本机存档、回看、收藏、分享、朗读；每日限次重新生成；**往期回顾**列表可点开看整张卡片（「回到今天」返回） |
| 灵感漫游 H12 | 铜/银/金分级 + 每周限次；六段式 AI 综述 + 原文下划线 + 外部火花 + 创作种子；往期归档 / 随机漫游 |
| 书架 H6 / 笔记 H7 | 书架 + 笔记概览（电子书 / 专辑计数、笔记统计） |
| 分享 H5 | 竖版分享图（canvas 零依赖）→ Web Share / 下载 PNG / 复制链接 |
| 朗读 H13 | Web Speech API：想法 / 划线 / 每日卡片 / 灵感漫游 / 人格画像，可暂停 / 上下条 / 停止；切后台即停 |
| 我的账户 | 身份头（昵称首字头像 / 账户码掩码 / 退出登录）、已连接 Key 状态（填→掩码→校验→清除）、DeepSeek Key、跨设备登录（H8 账户码 + 复制/显示）、昵称托管、每日卡片 · 往期回顾入口、运营看板入口（H14）。**不设 Key 门槛**，换设备时可直接进来用账户码登录；官网 `/account/` 是同套账户的另一入口 |
| 运营看板 H14 | 云函数 `opsAdmin` 按「账户码」白名单校验（免口令），聚合小程序 / 插件 / H5 三段匿名用量 |
| PWA | `manifest.webmanifest` + `sw.js`（网络优先），支持加主屏 |

> **运营看板怎么认管理员（两套机制别混，均免口令）**
> - **H5 看板**：按「账户码（deviceId）」白名单认人。在云开发控制台 → 云函数 → `wereadProxy` → 配置 → 环境变量，新增 `ADMIN_DEVICE_IDS`（英文逗号分隔，值＝你在 H5「我的 → 我的账户」点「显示完整」后复制的账户码）。**不配则 H5 看板关闭**（接口直接返回「看板未开启」）。前端无需输入任何口令，打开「运营看板」即自动识别；账户码不在白名单时提示无权限。
> - **小程序看板**：走 `ADMIN_OPENIDS`（你自己 openid 白名单，多个用英文逗号分隔），仅白名单账号可见。

> 各阶段勾选见需求文档 §6（已全部完成）。
