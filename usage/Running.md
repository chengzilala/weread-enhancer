# 微信悦读 - 运行与安装说明

目前项目正处于开发阶段，您可以直接将本目录作为“未打包扩展”安装以进行实时测试。

## 如何在浏览器加载本地插件做调试：

### Microsoft Edge 浏览器
1. 在地址栏输入 `edge://extensions/` 访问扩展页面。
2. 在页面左下角（或右上角设置中），开启 **“开发人员模式”** 开关。
3. 点击顶部出现的 **“加载解压缩的扩展”** 按钮。
4. 浏览并选择当前文件夹（`微信读书插件` 所在的根目录），将其导入。
5. 当你在此文件夹内修改了 HTML/JS/CSS，只需在同一个页面点击扩展对应的“刷新（重新加载）”按钮，并刷新微信读书网页即可套用最新逻辑。

### Google Chrome 浏览器
1. 在地址栏输入 `chrome://extensions/` 访问扩展页面。
2. 开启右上角的 **“开发者模式”** 开关。
3. 点击左上角的 **“加载已解压的扩展程序”**。
4. 选择当前文件夹即可载入代码。随时点击刷新并回到网页重新检查功能。

## 配套网站本地预览

网站（文档站）源码在 `web/`，与插件同仓库，零第三方依赖（本机 Python 3.9 即可）：

```bash
python3 web/build.py    # 构建：生成 web/dist/ 与 web/dist/api/latest.json
python3 web/serve.py    # 本地预览：http://localhost:5173
```

- 文章源在 `web/content/`，可用 Obsidian 直接打开为 vault 编辑
- `web/dist/api/latest.json` 的版本号构建时自动读根目录 `manifest.json`
- 部署：`python3 web/build.py` 后把 `web/dist/` 产物推到 `site-dist` 分支，由帽子云静态托管（详见 `plan/session_handoff_网站帽子云部署.md`）
