#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「少数派文案.md」里每篇要用的图，按帖子复制成一个个文件夹。

用途
    少数派横版图散在 screenshots/store/ 与 screenshots/promo/ 两处，发帖时来回找很麻烦。
    本脚本按文案里每篇的「**配图（N 张）· 篇 X · 短标题**：…」行，把该篇要用的图
    复制进 marketing/少数派/帖子/<篇号>-<短标题>/，发帖时只打开一个文件夹就能传图。

产物
    marketing/少数派/帖子/篇1-产品体验主文/
        01-github-banner.png       ← 序号＝上传顺序，第一张即题图 / 封面
        02-store-01-1280x800.png
        …

图名写法（文案里用简写即可，脚本自动解析到真实文件）
    store-01             → screenshots/store/store-01-1280x800.png
    feature-13-api-key   → screenshots/promo/feature-13-api-key.png（feature-* / github-banner 同理）
    配图-10 / 配图-破圈-01 → marketing/小红书/配图-<简写>-*.png（竖版复用，前缀匹配）
    marketing/小红书/xx.png → 相对仓库根的完整路径

说明
    · 母版图留在原地不动，本脚本只做「复制」，可随时重跑（重跑会先清空旧的帖子文件夹）。
    · 文案改了（换图 / 加篇）后，重跑本脚本即可刷新。
    · 「帖子/」是生成物、不入库（见 .gitignore 的 marketing/**/帖子/）。

用法
    python3 tools/sspai_post_folders.py
"""

import glob
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SSPAI_DIR = os.path.join(ROOT, "marketing", "少数派")
TEXT_FILE = os.path.join(SSPAI_DIR, "少数派文案.md")
OUT_DIR = os.path.join(SSPAI_DIR, "帖子")
STORE_DIR = os.path.join(ROOT, "screenshots", "store")
PROMO_DIR = os.path.join(ROOT, "screenshots", "promo")
XHS_DIR = os.path.join(ROOT, "marketing", "小红书")

# 配图行：**配图（8 张）· 篇 1 · 产品体验主文**：`github-banner`（…）→ …
POST_RE = re.compile(r"^\*\*配图（(\d+)\s*张[^）]*）\s*·\s*(篇\s*\d+)\s*·\s*([^*]+?)\*\*\s*[：:]\s*(.+)$")
TOKEN_RE = re.compile(r"`([^`]+)`")


def safe(name, limit=20):
    """把标题压成安全的文件夹名：只留中文 / 字母 / 数字，超长截断。"""
    s = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", name)
    return s[:limit] or "未命名"


def resolve(tok):
    """把文案里的简写图名解析成仓库内的真实路径；解析不到返回 None。"""
    tok = tok.strip()
    if not tok:
        return None
    # 1) 相对仓库根的完整路径（如 marketing/小红书/配图-10-…png）
    if tok.endswith(".png") and "/" in tok:
        p = os.path.join(ROOT, tok)
        return p if os.path.exists(p) else None
    # 2) store-NN → screenshots/store/
    if re.match(r"^store-\d{2}$", tok):
        p = os.path.join(STORE_DIR, "%s-1280x800.png" % tok)
        return p if os.path.exists(p) else None
    # 3) feature-* / github-banner → screenshots/promo/
    if tok.startswith("feature-") or tok == "github-banner":
        p = os.path.join(PROMO_DIR, "%s.png" % tok)
        return p if os.path.exists(p) else None
    # 4) 其余按「小红书竖版母版前缀」匹配（配图-10 / 配图-破圈-01，或省略前缀的 10）
    prefix = tok if tok.startswith("配图-") else "配图-%s" % tok
    hits = sorted(glob.glob(os.path.join(XHS_DIR, prefix + "-*.png")))
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise SystemExit("⚠️ 图名 `%s` 匹配到多张，请写全：%s" % (tok, hits))
    return None


def write_post(pid, title, tokens, done, missing):
    """把一篇的图复制进 marketing/少数派/帖子/<篇号>-<短标题>/。"""
    resolved = []
    for t in tokens:
        p = resolve(t)
        if p:
            resolved.append(p)
        else:
            missing.append("%s ← %s" % (pid, t))
    if not resolved:
        return 0

    folder = os.path.join(OUT_DIR, "%s-%s" % (safe(pid, 8), safe(title)))
    if os.path.isdir(folder):
        shutil.rmtree(folder)          # 重跑：先清空，避免旧图残留
    os.makedirs(folder)
    for i, p in enumerate(resolved, 1):
        shutil.copy2(p, os.path.join(folder, "%02d-%s" % (i, os.path.basename(p))))
    done.append((pid, title, len(resolved)))
    return len(resolved)


def main():
    with open(TEXT_FILE, encoding="utf-8") as fh:
        md = fh.read()

    done, missing, total = [], [], 0
    for ln in md.split("\n"):
        m = POST_RE.match(ln)
        if m:
            tokens = TOKEN_RE.findall(m.group(4))
            total += write_post(m.group(2), m.group(3), tokens, done, missing)

    print("✅ 已整理 %d 篇 → %d 张图" % (len(done), total))
    for pid, title, n in done:
        print("   · %s-%s（%d 张）" % (pid.replace(" ", ""), title, n))
    print("   位置：%s" % os.path.relpath(OUT_DIR, ROOT))
    if missing:
        print("⚠️ 以下篇目引用的图不存在，已跳过：")
        for x in missing:
            print("   - %s" % x)


if __name__ == "__main__":
    main()
