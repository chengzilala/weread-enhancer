#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「发帖即用」里每条帖子组装成一个独立文件夹：文案.txt + 按顺序排好的配图（微信读书 App 渠道）。

用途
    微信读书 App 只能在手机手动发。发帖时打开「帖子/<分类>/<序号-帖子>/」，
    文件夹里同时有【文案.txt】和【按上传顺序排好的配图】，复制 + 选图一步到位。

产物
    marketing/微信读书APP/帖子/
        01-综合·功能/
            01-综合全面版-首发主推/
                文案.txt
                01-配图-01-封面-1080x1440.png   ← 序号＝上传顺序，第一张即封面
                02-配图-02-阅读体验-1080x1440.png
                …
            …
        02-破圈·养号/ …
        03-种草·转化/ …
        04-场景·互动/ …

说明
    · 分类 / 顺序 / 文案 / 配图，全部来自「发帖即用」各 .txt（唯一依据）。
    · 母版图在 marketing/小红书/，本脚本只做「复制」，可随时重跑（重跑先清空旧产物）。
    · 「帖子/」是生成物、不入库（见 .gitignore）。

用法
    python3 tools/wereadapp_post_folders.py
"""

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH_DIR = os.path.join(ROOT, "marketing", "微信读书APP")
POST_DIR = os.path.join(CH_DIR, "发帖即用")
MASTER_DIR = os.path.join(ROOT, "marketing", "小红书")
OUT_DIR = os.path.join(CH_DIR, "帖子")

# 帖子头行（只在 01–04 号文件里出现）：
#   【A1 · 我的阅读人格】🖼 配图-10｜ 📍 书友（书圈）｜ # 阅读人格
#   【模板 1 · 参与「你在读什么书」话题】📍 书友（书圈）｜ # 你在读什么书
HEAD_RE = re.compile(r"^【(.+?)】(.*)$")
# 母版图引用：配图-02 / 配图-02-阅读体验 / 配图-干货-01 / 配图-破圈-04
REF_RE = re.compile(r"配图-[0-9A-Za-z\u4e00-\u9fff-]+")


def safe(name, limit=20):
    """把标题压成安全的文件夹名：只留中文 / 字母 / 数字，超长截断。"""
    s = re.sub(r"[^\u4e00-\u9fffA-Za-z0-9]", "", name)
    return s[:limit] or "未命名"


def master_files():
    """母版图真实文件名（marketing/小红书/配图-*.png）。"""
    return sorted(
        f for f in os.listdir(MASTER_DIR)
        if f.endswith(".png") and f.startswith("配图-")
    )


def extract_refs(raw):
    """从「🖼 …」片段里取出母版图引用（按出现顺序、去重）。"""
    s = re.sub(r"（[^）]*）", "", raw)  # 去掉（共 16 张…）这类说明

    def _expand(m):  # 区间：配图-01 … 配图-16
        a, b = int(m.group(1)), int(m.group(2))
        return " ".join("配图-%02d" % i for i in range(min(a, b), max(a, b) + 1))

    s = re.sub(r"配图-(\d+)\s*(?:…|\.{2,})\s*配图-(\d+)", _expand, s)
    refs = []
    for tok in REF_RE.findall(s):
        tok = tok.rstrip("-")
        if tok and tok not in refs:
            refs.append(tok)
    return refs


def resolve(tok, files):
    """把引用解析成唯一母版文件名：配图-02 → 配图-02-阅读体验-1080x1440.png。"""
    for f in files:
        if f == tok or f.startswith(tok + "-"):
            return f
    return None


def trim_tail(lines):
    """去掉正文块尾部的空行 / 装饰分隔行（如 ═══ 分节标题）。"""
    while lines and (not lines[-1].strip() or re.match(r"^[═=\s]+$", lines[-1])):
        lines.pop()
    return lines


def parse_posts(path):
    """把一份「发帖即用」.txt 解析成帖子块列表（保持文件中出现顺序）。"""
    posts, cur = [], None
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            ln = raw.rstrip("\n")
            m = HEAD_RE.match(ln)
            if m:
                if cur:
                    posts.append(cur)
                cur = {"head": ln, "title": m.group(1), "rest": m.group(2), "body": []}
            elif cur is not None:
                cur["body"].append(ln)
    if cur:
        posts.append(cur)
    return posts


def write_post(cat_dir, idx, post, files, done, missing):
    """组装一帖：marketing/微信读书APP/帖子/<分类>/<序号-帖子>/{文案.txt, 配图…}。"""
    head, title = post["head"], post["title"]
    pid, name = (p.strip() for p in title.split("·", 1)) if "·" in title else (title.strip(), "")

    folder = os.path.join(cat_dir, "%02d-%s-%s" % (idx, safe(pid, 8), safe(name)))
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)

    body = trim_tail(list(post["body"]))
    with open(os.path.join(folder, "文案.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join([head] + body).rstrip() + "\n")

    names = []
    for tok in extract_refs(post["rest"]):
        f = resolve(tok, files)
        if f is None:
            missing.append("%s ← %s" % (pid, tok))
        elif f not in names:
            names.append(f)
    for i, n in enumerate(names, 1):
        shutil.copy2(os.path.join(MASTER_DIR, n),
                     os.path.join(folder, "%02d-%s" % (i, n)))

    done.append((pid, name, len(names)))
    return len(names)


def main():
    files = master_files()
    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)  # 重跑：先清空旧产物，避免残留
    os.makedirs(OUT_DIR)

    txts = sorted(
        f for f in os.listdir(POST_DIR)
        if re.match(r"^0[1-5]-", f) and f.endswith(".txt")
    )

    done, missing = [], []
    total = 0
    for fn in txts:
        cat_dir = os.path.join(OUT_DIR, fn[:-4])  # 分类名＝文件名去 .txt
        os.makedirs(cat_dir, exist_ok=True)
        for idx, post in enumerate(parse_posts(os.path.join(POST_DIR, fn)), 1):
            total += write_post(cat_dir, idx, post, files, done, missing)

    print("✅ 已组装 %d 帖 → %d 个分类、%d 张配图" % (len(done), len(txts), total))
    print("   位置：%s" % os.path.relpath(OUT_DIR, ROOT))
    if missing:
        print("⚠️ 以下帖引用的图不存在，已跳过：")
        for x in missing:
            print("   - %s" % x)


if __name__ == "__main__":
    main()
