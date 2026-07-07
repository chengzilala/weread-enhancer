# 代码管理方案与执行计划（GitHub）

## 版本信息
- 仓库名称：weread-enhancer
- 可见性：private
- 本地目录：d:\Knowledge\ChesterObsidian\Coding\微信读书插件
- 当前归档版本：v0.8.1（滚动模式与工具栏体验优化，2026-07-07）

## 归档历史（Git Tags）

> 数据来源：`git for-each-ref refs/tags` + `git log`（日期为 Tag 创建日期）；各版本功能详情见 `version_plan.md` 第 2 节。

| 版本 Tag | Commit | 日期 | 说明 |
|---------|--------|------|------|
| v0.1.0 | da8b001 | 2026-06-25 | 项目骨架 + 基础屏占比 + 日志系统 |
| v0.2.0 | f7d04cd | 2026-06-25 | Edge 商店上架版 + 工具栏浮动悬停 |
| v0.3.0 | d5b53c8 | 2026-06-26 | 阅读设置 + 工具栏浮动稳定版归档 |
| v0.3.1 | 4efe6dc | 2026-06-26 | 明亮/暗黑主题切换补丁 |
| v0.3.2 | daa8eb4 | 2026-06-26 | 暗黑/护眼主题 CSS 改进补丁 |
| v0.4.0 | 62e38a7 | 2026-07-03 | 主题设置完成（CSS filter 方案 + 使用官方主题） |
| v0.5.0 | 73716ed | 2026-07-03 | 自动阅读完成（滚动/速度/方向/空格快捷键/持久化） |
| v0.6.0 | 519beb0 | 2026-07-03 | 快捷键系统 + 全屏模式完成 |
| v0.7.0 | e571061 | 2026-07-07 | 新手引导 + 性能优化 + Bug 修复 + 测试清单 |
| v0.8.1 | aecf919 | 2026-07-07 | 追平 v0.8.0 上架 + 滚动模式与工具栏体验优化 |

**未打 Tag 的版本**：
- v0.8.0（无独立提交）：商店追平版，改动未单独提交，已并入 v0.8.1 提交 `aecf919`；因无独立 commit，不单独补 tag。

> ⚠️ **维护约定**：每次 `git tag v0.x.y` 发版后，**必须回来更新本表**（新增一行：Tag / Commit / 日期 / 说明），并更新顶部「当前归档版本」，保持归档历史与实际 tag 同步。

> 备注：v0.4.0 / v0.6.0 的 tag 指向打 tag 时的 HEAD（`62e38a7` / `519beb0`），与对应功能提交（`8022dfd` / `80536b1`）属同一版本迭代内的不同提交点。

## 目标
- 将当前稳定状态归档为可回滚的版本 `v0.1.0`
- 同步到 GitHub 私有仓库，建立后续迭代的版本管理流程

## 版本号规则
- v0.1.0：当前稳定点（MVP 第一版）
- v0.1.1：仅修复/小改动（不改变核心行为）
- v0.2.0：新增一个核心模块（例如自动阅读/主题/快捷键）
- v1.0.0：核心模块齐备、体验稳定、可发布

## 分支策略（最小化）
- main：稳定分支，只接受已验收的功能
- feature/*：功能分支（例如 feature/auto-read）
- dev：默认不启用；当需要并行多个功能且需要集成验证时再引入

## 提交规范（建议）
- feat: 新功能
- fix: 修复
- refactor: 重构
- docs: 文档
- chore: 杂项

## 入库/排除规则
### 应提交
- manifest.json
- content.js
- content.css
- README.md / Running.md
- session_log.md
- RPD_需求文档.md（如果希望需求-实现同库追溯）

### 不提交（运行产物）
- 下载或导出的调试日志：weread-debug-*.json
- 日志目录（如果用作运行时输出目录）

## 执行计划（不执行，仅作为操作清单）
### 0. 预检
- 确认项目中不包含任何敏感信息（账号、Cookie、Token、个人隐私）
- 确认 `日志` 文件夹与 `weread-debug-*.json` 不进入版本控制

### 1. 初始化 git（本地）
在 PowerShell（不使用 &&）按顺序执行：

```powershell
Set-Location "d:\Knowledge\ChesterObsidian\Coding\微信读书插件"
git init
git branch -M main
```

### 2. 添加 .gitignore（最小集合）
建议内容（后续执行时落到文件）：

```gitignore
# runtime logs
weread-debug-*.json
日志/

# OS
.DS_Store
Thumbs.db
```

### 3. 首次提交（main）

```powershell
Set-Location "d:\Knowledge\ChesterObsidian\Coding\微信读书插件"
git add -A
git commit -m "chore: baseline v0.1.0"
```

### 4. 创建 GitHub 私有仓库（手动）
- GitHub 新建仓库：weread-enhancer
- 选择 Private
- 不要勾选 “Initialize this repository with a README”（本地已有）

创建完成后复制仓库地址（HTTPS），形如：
- https://github.com/<your-username-or-org>/weread-enhancer.git

### 5. 绑定远端并推送

```powershell
Set-Location "d:\Knowledge\ChesterObsidian\Coding\微信读书插件"
git remote add origin "<YOUR_REMOTE_URL>"
git push -u origin main
```

### 6. 打 Tag 并发布 v0.1.0
本地打 tag 并推送：

```powershell
Set-Location "d:\Knowledge\ChesterObsidian\Coding\微信读书插件"
git tag v0.1.0
git push origin v0.1.0
```

GitHub Release（网页操作）建议：
- Tag：v0.1.0
- 标题：v0.1.0
- 内容：说明已包含屏占比 + 日志系统（最小可用闭环）
- 附件：打一个可安装 zip（仅包含插件运行所需文件，不包含调试日志）

### 7. 后续迭代工作流（模板）
- 新功能：
  - `git checkout -b feature/<name>`
  - 小步提交
  - 验收后合并到 main
- 发版：
  - `git tag v0.x.y`
  - GitHub Release + zip

