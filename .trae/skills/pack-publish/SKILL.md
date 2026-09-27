---
name: "pack-publish"
description: "把浏览器扩展打包成干净 zip 并准备商店上架资料，含文案以代码为准校验与各商店尺寸。当用户要发版/打包/上架 Edge、Chrome、360 时触发。"
---

# 扩展打包与上架

## 使用场景
功能稳定、要打包上架或更新到浏览器商店时。

## 指令
1. **先校验事实（防凭记忆写错）**：grep 代码核对后再写文案——
   - 快捷键：看入口脚本键盘处理函数（本项目为 `content.js` 的 `handleAllKeyboard`）
   - 权限：`manifest.json` 的 `permissions`
   - 生效域名：`manifest.json` 的 `matches`
   - 以代码结果**覆盖**记忆与旧文案。
2. **版本号**：确认高于目标商店上次提交，`manifest.json` 递增。
3. **打包**（只含运行文件，正斜杠路径）：
   ```powershell
   python -c "import zipfile; files=['manifest.json','{{入口}}','{{样式}}','README.md','icons/icon-16.png','icons/icon-48.png','icons/icon-128.png']; z=zipfile.ZipFile('release/{{name}}-v{{ver}}.zip','w',zipfile.ZIP_DEFLATED); [z.write(f,f) for f in files]; z.close()"
   ```
   排除：plan/ dev/ test/ screenshots/ release/ 调试日志等。
4. **按商店备料**（平台事实表）：

   | 商店 | 费用 | 上传物 | 图片尺寸 |
   |---|---|---|---|
   | Edge | 个人免费 | `.zip` | 截图 1280×800/640×400；推广 440×280、1400×560 |
   | Chrome | $5 一次性 | `.zip` | 同 Edge |
   | 360 | 免费 | **含 .crx 的 ZIP** | 效果图 560×350、图标 48×48；MV3 需先实测、存 `.pem` |

## 红线
- 注册账户 / 点"提交审核"由用户手动，AI 不代做。
- `.pem` 私钥不入库。
