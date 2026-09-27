---
description: "微信悦读（weread-enhancer）项目的技术栈、约束与红线；始终生效"
alwaysApply: true
---

# 项目规则 — 微信悦读（weread-enhancer）

> **母本**：`AI协作规划库/1-规则_Rules/项目规则_project_rules.md` 的「范例」段。此处为已激活副本，修改请同步母本。
> 通用角色/红线在同目录 `general_rules.md`（每项目一份副本）里，不在此重复。

---

- **项目定位**：微信读书网页版（weread.qq.com）阅读增强扩展，正式名「微信悦读」，英文仓库名 `weread-enhancer`。
- **技术栈**：Manifest V3 + 原生 HTML/CSS/JS，**零外部依赖**。
- **作用范围**：仅在 `weread.qq.com` 运行。
- **权限**：仅 `storage`（本地保存用户设置）；无远程代码 / 分析 / 广告。
- **命名**：注入 UI 的 CSS 类名统一前缀 `wre-`，防样式污染。
- **不可做**：旧代码不重写，新功能进 `modules/` 新模块；不夸大商店文案。
- **版本**：`v主.次.补`；大版本 `git tag` + `release/` 打 zip（zip 不入库）。
- **红线**：商店文案的快捷键/权限/域名，以 `content.js`、`manifest.json` 实测为准（当前快捷键仅 `空格 / D / F / ?`）。
