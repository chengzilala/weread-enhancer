# 微信悦读 · 项目总索引

> **状态**：已上线（扩展 v0.32.0 + 官网/文档站 + H5 + 微信小程序 + 云函数）
> **最后整理**：2026-11-10
> **本文件只做「哪里有什么、哪些能删」**；域名 / 备案 / 服务器细节看唯一台账 [部署上线备案/README.md](../部署上线备案/README.md)。

---

## 一、线上资产

| 渠道 | 地址 | 说明 |
|---|---|---|
| Microsoft Edge 加载项 | [商店页](https://microsoftedge.microsoft.com/addons/detail/%E5%BE%AE%E4%BF%A1%E6%82%A6%E8%AF%BB/nkcckbonpafeclefhlhbencibkaabmgb) | 扩展正式上架渠道 |
| 官网 + 帮助文档站 | <https://reader.chesterlee.cn> | 源在 `web/`，产物 `web/dist/`（不入库） |
| H5 移动端 | 与官网同域 | 源在 `h5/`，部署方式见 `h5/README.md` |
| 微信小程序「悦读且住」 | 微信内搜索 | 源在 `mobile/miniprogram/`，已备案 `陇ICP备2026009894号-1X` |
| 统一账户 | <https://account.chesterlee.cn> | 插件 / 网页 / 小程序共用 uid（可选登录） |
| 云函数 | 微信云开发（`wereadProxy`） | 源在 `mobile/cloudfunctions/` |
| 代码仓库 | [GitHub](https://github.com/chengzilala/weread-enhancer) ｜ [Gitee](https://gitee.com/chengzila/weread-enhancer) | 双远程，内容一致 |
| 备案（页脚已挂） | `陇ICP备2026009894号-2` + `甘公网安备62052302000062号` | 明细只在部署台账 |

---

## 二、目录职责与去留

| 目录 / 文件 | 作用 | 去留 |
|---|---|---|
| `manifest.json` `content.js` `content.css` `background.js` `popup.*` | 扩展本体（入口 / 核心 / Service Worker / 工具栏弹窗） | 🔴 运行必需 |
| `modules/` | 各功能模块（统计 / 笔记 / 朗读 / 洞察 / 找书 / 备份 / 评论…），由 manifest 注入 | 🔴 运行必需 |
| `icons/` `_locales/` `assets/` | 图标、多语言包、打赏/反馈/公众号二维码（web_accessible） | 🔴 运行必需 |
| `web/` | 官网 + 文档站源码；`web/content/` 是文章唯一事实源 | 🔴 线上源码 |
| `h5/` | H5 移动端源码（核心算法与小程序 `shared/` 同源） | 🔴 线上源码 |
| `mobile/` | 微信小程序 + 云函数 `wereadProxy` | 🔴 线上源码 |
| `tools/` | 发布 / 发帖自动化脚本（知乎、小红书、少数派、微信读书 APP 等） | 🟡 运营工具 |
| `release/` | `pack.py` 打的扩展 zip、`promo.py` 出的商店素材 | 🟢 脚本产物，可随时重建 |
| `screenshots/` | README 与商店展示图（`promo/`、`store/`） | 🟡 展示素材 |
| `marketing/` | 各平台推广文案 + `软著申请/`（材料生成与半自动提交脚本） | 🟡 运营 / 申请 |
| `plan/` `dev/` `test/` `usage/` | 需求文档、开发日志、验收清单、运行手册 | 🟡 资料，**互相引用，留原位** |
| `archive/` | 归档区（已结束使命、仅留痕的内容） | ⚪ 可删，见 [archive/README.md](archive/README.md) |
| `.autoshot/` | 浏览器自动化用的独立 Chrome profile 与截图 | ⚪ 本地缓存，不入库 |

> `web/dist/`、`release/*.zip`、`.autoshot/` 都是**产物**，删了能重建；源码不要动。

---

## 三、绝不能删（删了线上或打包会坏）

1. **`manifest.json` 里引用的所有文件** —— `pack.py` 严格按它收集，缺一个直接中止；`modules/` 少一个模块扩展就报错。
2. **`web/content/`** —— 官网与文档站的唯一内容源，`build.py` 从它生成整站。
3. **`mobile/` 下的 `app.json` / 页面 / `shared/`** —— 小程序部署必需；云函数目录名与 `config.json` 改了要重新上传。
4. **`icons/` 与 `_locales/`** —— 商店审核与 `__MSG_` 文案依赖。
5. **备案号与页脚挂载** —— 上线合规项，改动前先看台账。

---

## 四、常用命令（都在项目根目录执行）

```bash
python3 pack.py                      # 打扩展安装包 → release/weread-enhancer-v<版本>.zip（版本取 manifest）
python3 promo.py                     # 重出商店素材 → release/360-素材、release/微软商店-上传
python3 web/build.py                 # 重建官网 + 文档站 → web/dist（部署见台账 §2.1）
python3 marketing/软著申请/gen_materials.py --pdf   # 重出软著两份 60 页 PDF
python3 marketing/软著申请/ruanzhu_submit.py --help # 软著半自动填报（最后一步人工点提交）
```

- **发版顺序**：改 `manifest.json` 版本号（只增不减）→ `pack.py` → 上传商店 → 回灌 `web/content/更新日志.md` → 重建官网。
- **部署到服务器**：只按台账 [§2.1](file:///Users/Admin/Knowledge/Coding/部署上线备案/README.md) 的「怎么更新」那一列做，不要另起姿势。
- **H5 / 小程序**：分别看 `h5/README.md`、`mobile/README.md`。

---

## 五、敏感文件（绝不入库、不写日志、不贴外网）

| 文件 | 内容 |
|---|---|
| `marketing/软著申请/form_data.json` | 版权中心账号密码 + 申请数据（已 gitignore） |
| `marketing/软著申请/申请信息清单.md` | 身份证号等个人信息（已 gitignore） |
| `marketing/软著申请/输出/` | 软著提交用的两份 60 页 PDF（已 gitignore；丢了用 `gen_materials.py --pdf` 重出） |
| `.autoshot/` | 浏览器登录态 profile（已 gitignore） |
| `通用信息/.private/密码.md`（工作区级） | 各平台明文密码，只在本机 |

---

## 六、维护约定

1. **域名 / 备案 / 服务器**：只改 `部署上线备案/README.md`，各项目 README 只留回链。
2. **版本号**：只改 `manifest.json`，README 徽章与打包名自动跟随。
3. **过期结论**：先搬进 `archive/` 并在其 README 表格写一行「为什么可归档」，再删。
4. **新功能落地**：代码进 `modules/` 或对应端，验收清单进 `test/`，需求回灌 `plan/`。
