# 目录结构说明

```
微信读书插件/
│
├── manifest.json          # 🔧 扩展入口（不动）
├── content.js             # 🔧 核心逻辑（不动）
├── content.css            # 🔧 样式（不动）
├── icons/                 # 🔧 插件图标（不动）
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
│
├── README.md              # 📖 项目首页
├── .gitignore
├── DIR_STRUCTURE.md       # 📋 本文件
│
├── plan/                  # 📋 规划
│   ├── RPD_需求文档.md
│   ├── plan_edge_store.md
│   └── plan_github_versioning.md
│
├── dev/                   # 🔧 开发
│   ├── session_log.md
│   └── project-rules-v1.0.md
│
├── test/                  # 🧪 测试（预留）
│
├── release/               # 🚀 上线
│   ├── privacy.md
│   └── weread-enhancer-v0.2.0.zip
│
├── screenshots/           # 📸 截图
│   └── 微信图片_*.png
│
├── usage/                 # 📖 使用指南
│   ├── Running.md
│   └── GitHub操作手册.md
│
└── inbox/                 # 📥 待归类
    ├── debug.log
    └── 备注
```

## 维度说明

| 目录 | 维度 | 存放内容 |
|------|------|----------|
| `plan/` | 规划 | 需求文档、方案文档 |
| `dev/` | 开发 | 开发日志、编码规范 |
| `test/` | 测试 | 测试相关（预留） |
| `release/` | 上线 | 隐私政策、商店包 |
| `usage/` | 使用 | 安装指南、操作手册 |
| `screenshots/` | 截图 | 功能效果截图 |
| `inbox/` | 待归类 | 未分类文件 |

## 注意事项

- `manifest.json`、`content.js`、`content.css`、`icons/` 为浏览器扩展必需文件，必须留在根目录
- `README.md` 保留在根目录作为 GitHub 项目首页展示
- `inbox/` 中的文件定期审查，移到对应目录或删除
