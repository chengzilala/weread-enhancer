# GitHub 操作手册（微信读书插件专用）

> 当你代码改完一个版本，想把它存到 GitHub 上，或者改出问题了想回退，按下面步骤做就行。

---

## 一、日常工作流：把代码提交到 GitHub

每次你要把当前改动存到 GitHub，只有 **3 个步骤**：

### 步骤 1：打开终端

打开 IDE 的内置终端操作即可（或先在终端里 `cd "/Users/Admin/Knowledge/Coding/微信读书插件"` 进入项目目录）。

### 步骤 2：一条命令提交

复制下面整段，粘贴到终端按回车：

```powershell
git add content.js content.css manifest.json README.md Running.md session_log.md RPD_需求文档.md
git commit -m "feat: 简写你改了啥"
git push
```

> **注意**：把 `"feat: 简写你改了啥"` 改成你这次改了什么东西，例如：
> - `"fix: 修复屏占比刷新后不生效"`
> - `"feat: 新增自动阅读功能"`

### 步骤 3：完成

已经同步到 GitHub 了。去 https://github.com/chengzilala/weread-enhancer 刷新就能看到。

---

## 二、打版本标签（重要节点存档）

当你完成一个**完整功能**（比如做了"主题设置"），想标记为一个版本：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

> 版本号规则：
> - `v0.1.0` — 初始版本（已完成）
> - `v0.1.1` — 小修小补
> - `v0.2.0` — 加了一个大功能
> - `v1.0.0` — 正式发布版

打完 tag 后，可以去 GitHub 对应 tag 创建 Release，别人就能下载 zip 安装了。

### 打完 tag 后：Release 说明配上展示图

仓库首页和 Release 用的展示图，都由 `promo.py` 一处生成（改文案 / 换截图后重跑即可）：

```bash
python3 promo.py
```

| 用在哪 | 文件 | 说明 |
|---|---|---|
| 仓库首页顶部横幅 | `screenshots/promo/github-banner.png` | README 第一行已按**相对路径**引用 |
| 仓库首页「界面预览」 | `screenshots/promo/feature-01~05-*.png` | README 中已排列展示 |
| GitHub Release 正文 | 同上 | 用 raw 链接内嵌，见下方 |
| 商店上架素材（不上传 GitHub） | `screenshots/store/`、`release/360-素材/` | 仅本机留存，供 Edge/Chrome/360 后台上传 |

> ⚠️ README 用的是相对路径，**展示图必须一起提交**，否则仓库首页会裂图：
>
> ```powershell
> git add README.md promo.py screenshots/promo screenshots/store
> git commit -m "docs: 新增展示素材与 README 界面预览"
> git push
> ```
>
> Release 正文引用图片用 raw 链接（把 `<tag>` 换成版本号）：
> `https://raw.githubusercontent.com/chengzilala/weread-enhancer/<tag>/screenshots/promo/github-banner.png`

---

## 三、出了问题怎么办：回退到指定版本

### 情况 A：还没提交，想撤销改动

你改了一堆东西，发现改坏了，想恢复到上次提交的状态：

```powershell
git checkout -- content.js
```

> 这会把 `content.js` 还原到上次提交时的样子。把文件名换成你要恢复的文件就行。

如果想**全部文件都还原**：

```powershell
git checkout -- .
```

> ⚠️ 注意：这个操作会丢失你所有未提交的改动，慎重。

### 情况 B：已经提交了，但想回退到之前某个版本

先用这条命令看有哪些版本（黄色字就是版本标签）：

```powershell
git log --oneline --decorate -10
```

会看到类似：

```
da8b001 (HEAD -> main, tag: v0.1.0, origin/main) feat: 微信读书浏览器插件 v0.1.0 初始版本
```

如果你想**回退到 `v0.1.0`**，执行：

```powershell
git reset --hard v0.1.0
git push --force-with-lease
```

> ⚠️ 注意：`--hard` 会丢弃两个版本之间的所有改动。如果你只是想看看旧版本的样子，先试下一条。

### 情况 C：只是想临时看看旧版本，不改动当前代码

```powershell
git checkout v0.1.0
```

看完了想回到最新版：

```powershell
git checkout main
```

---

## 四、完整操作示例（常见场景）

### 场景：修复了一个 bug，想同步到 GitHub

```powershell
git add content.js
git commit -m "fix: 修复屏占比拖动不实时更新"
git push
```

### 场景：完成了"自动阅读"功能，想打一个新版本

```powershell
git add content.js content.css
git commit -m "feat: 新增自动阅读功能"
git tag v0.2.0
git push
git push origin v0.2.0
```

### 场景：新版改坏了，想还原到 v0.1.0

```powershell
git log --oneline --decorate -10
git reset --hard v0.1.0
git push --force-with-lease
```

---

## 五、一句话速查

| 你想做什么 | 执行这条命令 |
|---|---|
| 提交改动到 GitHub | `git add 文件名` → `git commit -m "说明"` → `git push` |
| 标记一个版本 | `git tag v0.2.0` → `git push origin v0.2.0` |
| 放弃未提交的改动 | `git checkout -- 文件名` |
| 回退到某个版本 | `git reset --hard v0.1.0` → `git push --force-with-lease` |
| 查看历史版本 | `git log --oneline --decorate -10` |
| 看看当前改了什么 | `git status` |

---

> **提示**：如果某条命令执行后报错，把报错信息复制给我，我帮你看看怎么回事。
