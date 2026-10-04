# 悦读且住 · 移动端（微信小程序）

只做「读完之后」的复盘与分享：阅读总览、阅读人格、阅读行为报告、书架。不包含屏占比 / 勿扰 / 自动阅读等桌面阅读增强功能。

- 需求文档：[../plan/RPD_小程序移动端_需求文档.md](../plan/RPD_小程序移动端_需求文档.md)
- 开发计划：[../plan/plan_小程序移动端.md](../plan/plan_小程序移动端.md)

## 目录结构

```
mobile/
├── project.config.json          # 开发者工具项目配置（miniprogramRoot / cloudfunctionRoot）
├── miniprogram/                 # 小程序前端
│   ├── app.js / app.json / app.wxss
│   ├── config.js                # 云开发环境 ID（需你填写）
│   ├── shared/                  # 公共模块：本地存储 / 网关调用 / 格式化 / 报告与人格计算
│   └── pages/                   # home 首页 · persona 人格 · report 报告 · shelf 书架 · settings 我的
└── cloudfunctions/
    └── wereadProxy/             # 云函数：官方网关中转（绕过 CORS）
```

## 第一次运行（零基础照做）

### 1. 准备
- 安装「微信开发者工具」（稳定版）。
- 有一个已注册的微信小程序账号（个人主体即可）。

### 2. 导入项目
1. 打开微信开发者工具 → 「导入项目」。
2. 目录选择本文件夹 `mobile/`（含 `project.config.json` 的那层）。
3. AppID 选择你自己的小程序 AppID。

### 3. 开通云开发
1. 开发者工具顶部点「云开发」→ 按引导开通（首次会创建环境）。
2. 记下环境 ID（形如 `cloud1-1a2b3c4d`）。
3. 打开 `miniprogram/config.js`，把 `CLOUD_ENV` 填成这个环境 ID（不填也能跑，但推荐填写，避免选错环境）。

### 4. 部署云函数
1. 在开发者工具左侧文件树找到 `cloudfunctions/wereadProxy`。
2. 右键 → 「上传并部署：云端安装依赖」。
3. 等右下角提示部署成功。

### 5. 使用
1. 编译运行小程序 → 底部「我的」。
2. 粘贴你的 `wrk-` 开头的 API Key（微信读书 App →「微信读书 Skill」页面复制）。
3. 点「保存并校验」→ 通过后回「首页」。

## 验证方式（阶段 0 范围）
- [ ] 「我的」页能保存并校验 `wrk-` Key，重开小程序无需再输。
- [ ] 未配置 Key 时，首页 / 人格 / 报告 / 书架显示引导，不报错。
- [ ] Key 格式不对（非 `wrk-` 开头）时前端直接拦截并提示。
- [ ] Key 失效时提示「API Key 无效或已失效」。
- [ ] 「清除 Key」后，各页回到引导态。

> 首页 / 报告 / 人格已实现（阶段 1）；书架仍为占位页，属阶段 2 内容。

## 说明
- API Key 只存手机本地（`wx.setStorageSync`），不登录、不绑定微信账号。
- 数据请求经云函数 `wereadProxy` 内存中转，中转不存储、不记录 Key。
