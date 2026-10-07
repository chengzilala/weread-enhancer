# 微信悦读 · H5（纯网页移动端）

把小程序「读完之后」的复盘 + 分享能力搬到**纯网页**，并保留小程序侧已关闭的 AI 能力。
需求文档：`plan/RPD_H5移动端_需求文档.md`。

- 技术栈：原生 HTML / CSS / JS（ES Module），**零外部依赖**。
- 数据来源：复用微信云函数 `wereadProxy` 的「HTTP 访问服务」中转官方网关（浏览器无法直连）。
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
├── index.html          外壳页（header / main#view / nav#tabbar）
├── assets/
│   ├── app.css         移动端样式（品牌色 #2F6BFF）
│   └── app.js          应用外壳：hash 路由 + 五栏 Tab + 拦截态
└── src/
    ├── config.js       全局配置（中转地址、超时）
    ├── store.js        本机存储（deviceId / 端点 / 掩码 / 资料 / 缓存）
    ├── api.js          中转客户端（relay / ai / keySave…）
    ├── data.js         取数层（拼装官方接口 → 精简结构）
    ├── ui.js           esc / stateHtml / toast / copyText
    ├── core/           纯计算（与小程序 shared 逐字一致，仅 CJS→ESM）
    │   ├── format.js  report-core.js  persona-core.js  home-core.js  errors.js
    └── views/          页面：home / persona / report / shelf / me
```

## 一、部署云函数（中转服务）

H5 的全部数据、AI、Key 托管都经云函数完成，先按 `mobile/cloudfunctions/wereadProxy/index.js` 顶部「部署提醒」配置：

1. 上传部署 `wereadProxy`；把**超时时间改为 30 秒**（默认 3 秒不够）。
2. 「云开发控制台 → 数据库」新建集合 `wre_users`，权限选**「仅管理端可读写」**（存加密后的 Key）。
3. 「云函数 → wereadProxy → 配置 → 环境变量」新增：
   - `KEY_SECRET`：一串足够长的随机字符串，用于应用层加密。**一旦设置不要更改**，否则已托管的 Key 无法解密。
   - `H5_ORIGINS`：允许跨域的 H5 站点地址（如 `https://your.site`），多个用英文逗号分隔。**不配则退回 `Origin: *`**（仅调试用，上线务必收敛）。
4. 「云开发控制台 → HTTP 访问服务」为 H5 另绑一个路径（如 `/h5`）到本函数，得到形如
   `https://<envId>.service.tcloudbase.com/h5` 的地址。

## 二、配置中转地址

三种方式任选其一（优先级：网址参数 > 本机保存 > `config.js` 常量）：

- **推荐**：打开 H5 → 首屏「配置中转服务地址」→ 填入上一步地址 → 保存。
- 网址参数：`https://your.site/?endpoint=https://xxx.service.tcloudbase.com/h5`（写入本机后长期生效）。
- 代码常量：把地址写进 `h5/src/config.js` 的 `ENDPOINT`（适合自动化部署）。

配好后「我的」页可随时查看 / 修改；再填写以 `wrk-` 开头的微信读书 Key（DeepSeek Key 可选）。

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

## 五、实现的页面（阶段 0 + 阶段 1）

| 页面 | 说明 |
| --- | --- |
| 首页 H2 | 周期切换（本周/本月/本年/累计）+ Hero + 迷你趋势 + 指标 + 偏好分类 + 时段 + 读得最多 |
| 人格 H3 | 本地规则判定阅读人格（4 维 / 16 型），含数据门槛引导 |
| 报告 H4 | 结构化文字报告（标题 / 指标 / 表格 / 卡片 / 列表） |
| 书架 H6 | 书架 + 笔记概览（电子书 / 专辑计数、笔记统计） |
| 我的 | Key 托管（填写→掩码→校验→清除）、DeepSeek Key、署名、中转地址、deviceId |

> 后续阶段（AI H10–H12、分享图、语音复习 H13、同步码 H8、运营看板 H14、PWA）见需求文档 §6。
