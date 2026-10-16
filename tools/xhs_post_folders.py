#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「小红书文案.md」里每篇要用的图，按帖子复制成一个个文件夹。

用途
    发帖时一次只打开一个文件夹就能传图，不用在 29 张母版里挑。
    源＝本目录母版图（promo.py 生成的 配图-*.png）；文案里的（配 …）是唯一依据。

产物
    marketing/小红书/帖子/<编号>-<短标题>/
        01-配图-破圈-01-阅读人格测试-1080x1440.png   ← 序号＝上传顺序，第一张即封面
        02-配图-10-阅读人格分享图-1080x1440.png
        …

说明
    · 母版图留在原地不动，本脚本只做「复制」，可随时重跑（重跑会先清空旧的帖子文件夹）。
    · 文案改了（换图 / 加篇）后，重跑本脚本即可刷新。
    · 「帖子/」是生成物、不入库（见 .gitignore）。

用法
    python3 tools/xhs_post_folders.py
"""

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XHS_DIR = os.path.join(ROOT, "marketing", "小红书")
TEXT_FILE = os.path.join(XHS_DIR, "小红书文案.md")
OUT_DIR = os.path.join(XHS_DIR, "帖子")

# 主推图文（## 2 段）：没有（配 …），按母版 配图-01…16 顺序取
MAIN_RE = re.compile(r"^##\s+2\.\s+主推图文")
MAIN_TITLE = "微信读书网页版被我改造了"
MAIN_PID = "主推"

# 篇目标题行：#### A1 · 标题（配 `x.png` + `y.png`） / ### 篇 1 · 标题（配 …）
POST_RE = re.compile(r"^#{3,4}\s+((?:篇\s*\d+)|(?:[A-F]\d+))\s+·\s+(.*?)（配 ([^）]*)）\s*$")


def safe(name, limit=20):
    """把标题压成安全的文件夹名：只留中文 / 字母 / 数字，超长截断。"""
    s = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", name)
    return s[:limit] or "未命名"


def main_files():
    """母版里 配图-01…配图-16 的真实文件名（按序号）。"""
    return sorted(
        f for f in os.listdir(XHS_DIR)
        if f.endswith(".png") and re.match(r"^配图-\d{2}-", f)
    )


def write_post(pid, title, names, done, missing, order=0):
    """把一篇的图复制进 marketing/小红书/帖子/<编号>-<短标题>/。"""
    files = [n for n in names if os.path.exists(os.path.join(XHS_DIR, n))]
    drop = [n for n in names if n not in files]
    if drop:
        missing.extend("%s ← %s" % (pid, n) for n in drop)
    if not files:
        return 0

    folder = os.path.join(OUT_DIR, "%s-%s" % (safe(pid, 8), safe(title)))
    if os.path.isdir(folder):
        shutil.rmtree(folder)          # 重跑：先清空，避免旧图残留
    os.makedirs(folder)
    for i, n in enumerate(files, 1):
        shutil.copy2(os.path.join(XHS_DIR, n), os.path.join(folder, "%02d-%s" % (i, n)))
    done.append((pid, title, len(files)))
    return len(files)


def main():
    with open(TEXT_FILE, encoding="utf-8") as fh:
        md = fh.read()

    os.makedirs(OUT_DIR, exist_ok=True)

    done, missing = [], []
    total = 0
    for ln in md.split("\n"):
        if MAIN_RE.match(ln):
            total += write_post(MAIN_PID, MAIN_TITLE, main_files(), done, missing)
            continue
        m = POST_RE.match(ln)
        if m:
            names = re.findall(r"`([^`]+\.png)`", m.group(3))
            total += write_post(m.group(1), m.group(2), names, done, missing)

    os.makedirs(OUT_DIR, exist_ok=True) if not done else None
    print("✅ 已整理 %d 篇 → %d 个文件夹、%d 张图" % (len(done), len(done), total))
    print("   位置：%s" % os.path.relpath(OUT_DIR, ROOT))
    if missing:
        print("⚠️ 以下篇目引用的图不存在，已跳过：")
        for x in missing:
            print("   - %s" % x)


if __name__ == "__main__":
    main()
