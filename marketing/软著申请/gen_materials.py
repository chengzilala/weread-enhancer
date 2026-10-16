#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
软著申请材料生成器 —— 为「微信悦读」浏览器扩展生成可直接打印/提交的材料。

产物（生成到本目录的「输出/」下，均为 A4 打印样式 HTML）：
  1. 源程序-<软件名>-V<版本>.html        前 30 页 + 后 30 页，每页 50 行，页眉页脚齐全
  2. 用户操作手册-<软件名>-V<版本>.html   由站内功能教程整合，含封面与目录

用法：
  python3 marketing/软著申请/gen_materials.py          # 生成 HTML（再手动打印为 PDF）
  python3 marketing/软著申请/gen_materials.py --pdf     # 尝试调用本机 Chrome 直接出 PDF

打印为 PDF：浏览器打开 HTML → Cmd/Ctrl + P → 目标选「另存为 PDF」→ 保存。
"""

import os
import re
import sys
import html
import glob
import subprocess

# ======================= 可改配置 =======================
SOFTWARE_NAME = "悦读浏览器阅读增强扩展软件"  # 软著全称：不要含「微信」等他人商标
SOFTWARE_VERSION = "1.0"                      # 软著登记版本号：首版填 1.0（与产品版本号无关）
AUTHOR = "chengzilala"                        # 著作权人：提交时建议填真实姓名
LINES_PER_PAGE = 50                           # 软著要求：源程序每页不少于 50 行
FRONT_PAGES, BACK_PAGES = 30, 30              # 源程序交「前 30 页 + 后 30 页」
# =======================================================

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "输出")
ATTACH = os.path.join(ROOT, "web", "content", "attachments")

# 源程序文件顺序（与 manifest 注入顺序一致；主逻辑 content.js 放最前）
SRC_FILES = [
    "content.js",
    "modules/stats.js",
    "modules/tts.js",
    "modules/notes.js",
    "modules/official.js",
    "modules/pinyin-data.js",
    "modules/finder.js",
    "modules/home-shelf.js",
    "modules/support-center.js",
    "modules/backup.js",
    "modules/help.js",
    "modules/reviews.js",
    "modules/telemetry.js",
    "background.js",
]

# 站内教程目录（手册内容来源）
GUIDE = os.path.join(ROOT, "web", "content")
# GitHub 功能卡片截图目录（手册配图来源）
SHOTS = os.path.join(ROOT, "screenshots", "promo")


def g(pattern):
    return [os.path.relpath(p, GUIDE) for p in sorted(glob.glob(os.path.join(GUIDE, pattern)))]


# 用户手册章节（标题, 相对 web/content 的文件/通配）
MANUAL_SECTIONS = [
    ("一、快速上手", ["快速上手.md"]),
    ("二、功能详解", g("功能教程/*.md")),
    ("三、阅读人格", g("阅读人格/*.md")),
    ("四、进阶技巧", g("进阶技巧/*.md")),
    ("五、知识资产（阅读方法）", g("知识资产/*.md")),
    ("六、手机版（H5）", g("H5 移动端/*.md")),
    ("七、微信小程序", g("微信小程序/*.md")),
    ("八、常见问题与反馈", ["常见问题.md", "反馈.md"]),
    ("九、隐私政策", ["隐私政策.md"]),
    ("十、关于本软件", ["关于.md"]),
]

# 教程文件 → 配图（文件名即功能卡片，取自 screenshots/promo/）
SHOT_NAMES = {
    "feature-01-reading-width.png": "阅读设置：屏占比调节与自动阅读",
    "feature-02-focus.png": "勿扰模式",
    "feature-03-immersive.png": "沉浸阅读",
    "feature-04-shortcuts.png": "快捷操作（空格 / D / F / ?）",
    "feature-05-diagnostics.png": "诊断日志",
    "feature-06-stats.png": "阅读统计与导出",
    "feature-07-notes.png": "笔记增强",
    "feature-08-official.png": "阅读洞察报告",
    "feature-09-welcome.png": "新手引导",
    "feature-10-fullscreen.png": "全屏模式",
    "feature-11-menu.png": "功能主菜单",
    "feature-12-support.png": "支持与反馈",
    "feature-13-api-key.png": "API Key 配置",
    "feature-14-persona.png": "阅读人格（读书人版 MBTI）",
    "feature-15-persona-share.png": "阅读人格分享图（手机版）",
    "feature-16-ai.png": "AI 解读（DeepSeek 润色）",
    "feature-17-shelf.png": "阅读洞察 · 书架",
    "feature-18-discover.png": "阅读洞察 · 发现（搜书 / 书评 / 推荐）",
    "feature-19-help.png": "帮助中心",
}

SHOT_MAP = {
    "快速上手.md": ["feature-11-menu.png", "feature-09-welcome.png"],
    "屏占比调节.md": ["feature-01-reading-width.png"],
    "自动阅读.md": ["feature-01-reading-width.png"],
    "沉浸夜读.md": ["feature-03-immersive.png"],
    "快捷键.md": ["feature-04-shortcuts.png"],
    "阅读统计.md": ["feature-06-stats.png"],
    "笔记增强.md": ["feature-07-notes.png"],
    "语音复习.md": ["feature-07-notes.png"],
    "官方数据.md": ["feature-08-official.png", "feature-17-shelf.png", "feature-18-discover.png"],
    "本地找书.md": ["feature-18-discover.png"],
    "API Key 使用说明.md": ["feature-13-api-key.png"],
    "数据备份与恢复.md": ["feature-12-support.png"],
    "阅读人格.md": ["feature-14-persona.png"],
    "阅读人格是什么.md": ["feature-14-persona.png"],
    "16 型图鉴.md": ["feature-14-persona.png"],
    "四维详解.md": ["feature-14-persona.png"],
    "分享图与隐私.md": ["feature-15-persona-share.png"],
    "账户与跨设备.md": ["feature-15-persona-share.png"],
    "每日卡片.md": ["feature-15-persona-share.png"],
    "关联网页账户.md": ["feature-15-persona-share.png"],
    "常见问题.md": ["feature-19-help.png", "feature-12-support.png"],
    "反馈.md": ["feature-12-support.png"],
}


# ----------------------- 公共工具 -----------------------
def software_version():
    # 软著登记版本号固定取自配置（首版 1.0），与产品自身版本号（manifest.json）无关
    return SOFTWARE_VERSION


def strip_front_matter(txt):
    if txt.startswith("---"):
        parts = txt.split("---", 2)
        if len(parts) >= 3:
            return parts[2].lstrip("\n")
    return txt


def inline(t):
    t = re.sub(r"!\[(.*?)\]\((.*?)\)",
               lambda m: '<img src="%s" alt="%s">' % (m.group(2), m.group(1)), t)
    t = re.sub(r"!\[\[(.+?)\]\]", lambda m: img_tag(m.group(1)), t)
    t = re.sub(r"\[(.*?)\]\((.*?)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", t)
    t = re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
    return t


def img_tag(name):
    p = os.path.join(ATTACH, name)
    if os.path.exists(p):
        return '<figure><img src="file://%s"><figcaption>%s</figcaption></figure>' % (p, name)
    return ""


def render_table(rows):
    cells = [r.strip().strip("|").split("|") for r in rows]
    if len(cells) >= 2:
        cells = [cells[0]] + cells[2:]  # 去掉分隔行
    out = ["<table>"]
    for i, row in enumerate(cells):
        tag = "th" if i == 0 else "td"
        out.append("<tr>" + "".join("<%s>%s</%s>" % (tag, inline(c.strip()), tag) for c in row) + "</tr>")
    out.append("</table>")
    return "\n".join(out)


def md_to_html(md):
    md = strip_front_matter(md)
    lines = md.split("\n")
    out, i = [], 0
    state = {"ul": False, "ol": False}

    def close_lists():
        if state["ul"]:
            out.append("</ul>"); state["ul"] = False
        if state["ol"]:
            out.append("</ol>"); state["ol"] = False

    while i < len(lines):
        s = lines[i].strip()
        if s.startswith(":::"):                       # 网站专用指令，跳过
            i += 1; continue
        if not s:
            close_lists(); i += 1; continue
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            close_lists()
            lvl = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (lvl, inline(m.group(2)), lvl))
            i += 1; continue
        if s.startswith(">"):                          # 引用 / callout
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                t = lines[i].strip()[1:].strip()
                t = re.sub(r"^\[!\w+\]\s*", "", t)
                buf.append(t); i += 1
            close_lists()
            out.append("<blockquote>%s</blockquote>" % "<br>".join(inline(x) for x in buf if x))
            continue
        m = re.match(r"^[-*]\s+(.*)$", s)
        if m:
            if not state["ul"]:
                close_lists(); out.append("<ul>"); state["ul"] = True
            out.append("<li>%s</li>" % inline(m.group(1))); i += 1; continue
        m = re.match(r"^\d+\.\s+(.*)$", s)
        if m:
            if not state["ol"]:
                close_lists(); out.append("<ol>"); state["ol"] = True
            out.append("<li>%s</li>" % inline(m.group(1))); i += 1; continue
        if s.startswith("|") and s.endswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip()); i += 1
            close_lists(); out.append(render_table(rows)); continue
        m = re.match(r"^!\[\[(.+?)\]\]$", s)
        if m:
            close_lists()
            t = img_tag(m.group(1))
            if t:
                out.append(t)
            i += 1; continue
        close_lists()
        out.append("<p>%s</p>" % inline(s)); i += 1
    close_lists()
    return "\n".join(out)


# ----------------------- 源程序 -----------------------
def read_source_lines():
    lines = []
    for rel in SRC_FILES:
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            code = f.read().replace("\t", "    ")
        lines.append("// ==================== 文件：%s ====================" % rel)
        lines.extend(code.split("\n"))
    return lines


SRC_CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; }
.page { position: relative; width: 210mm; height: 297mm; padding: 18mm 16mm 20mm;
        page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
.hdr { font-size: 8.5pt; color: #444; border-bottom: 1px solid #bbb;
       padding-bottom: 2mm; margin-bottom: 3mm; font-family: sans-serif; }
.code { margin: 0; font-family: "Courier New", Consolas, monospace; font-size: 8pt;
        line-height: 4mm; white-space: pre-wrap; word-break: break-all; color: #111; }
.ftr { position: absolute; left: 0; bottom: 8mm; width: 100%; text-align: center;
       font-size: 8.5pt; color: #444; font-family: sans-serif; }
"""


def build_source_html(version):
    lines = read_source_lines()
    pages = [lines[i:i + LINES_PER_PAGE] for i in range(0, len(lines), LINES_PER_PAGE)]
    total = len(pages)
    if total <= FRONT_PAGES + BACK_PAGES:
        keep = list(range(total))
    else:
        keep = list(range(FRONT_PAGES)) + list(range(total - BACK_PAGES, total))

    head = ("<!DOCTYPE html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n"
            "<title>%s 源程序</title><style>%s</style></head><body>\n"
            % (SOFTWARE_NAME, SRC_CSS))
    parts = [head]
    for idx in keep:
        body = html.escape("\n".join(pages[idx]))
        parts.append(
            '<section class="page">'
            '<div class="hdr">%s　版本 V%s　源程序</div>'
            '<pre class="code">%s</pre>'
            '<div class="ftr">第 %d 页 / 共 %d 页</div>'
            '</section>' % (SOFTWARE_NAME, version, body, idx + 1, total))
    parts.append("</body></html>")
    return "\n".join(parts), total, len(keep)


# ----------------------- 用户手册 -----------------------
MANUAL_CSS = """
@page { size: A4; margin: 18mm; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
       color: #1a1a1a; font-size: 11.5pt; line-height: 1.95; margin: 0; }
.cover { text-align: center; padding-top: 95mm; page-break-after: always; }
.cover h1 { font-size: 28pt; margin: 0 0 8mm; border: none; page-break-before: auto; }
.cover .sub { font-size: 14pt; color: #555; margin-bottom: 6mm; }
.cover .meta { font-size: 12pt; color: #333; margin-top: 45mm; line-height: 2.4; }
h1 { font-size: 20pt; border-bottom: 2px solid #2F6BFF; padding-bottom: 2mm;
     margin-top: 12mm; page-break-before: always; }
h2 { font-size: 15pt; margin-top: 9mm; color: #123; }
h3 { font-size: 13pt; margin-top: 7mm; color: #123; }
p, li { font-size: 11.5pt; }
blockquote { border-left: 3px solid #2F6BFF; background: #f4f7ff; margin: 4mm 0;
             padding: 3mm 5mm; color: #334; }
code { background: #f0f2f5; padding: 0 1mm; border-radius: 2px; font-size: 10.5pt; }
img { max-width: 100%; border: 1px solid #ddd; border-radius: 3px; }
figure { margin: 5mm 0; text-align: center; page-break-inside: avoid; }
figure.shot { margin: 6mm 0; }
figure.shot img { max-height: 168mm; }
figcaption { font-size: 10pt; color: #888; margin-top: 2mm; }
table { border-collapse: collapse; width: 100%; margin: 4mm 0; }
th, td { border: 1px solid #ccc; padding: 2mm 3mm; font-size: 10.5pt; text-align: left; }
th { background: #eef3ff; }
a { color: #2F6BFF; text-decoration: none; }
article.doc { page-break-before: always; }
"""


def build_manual_html(version):
    parts = ["<!DOCTYPE html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n"
             "<title>%s 用户操作手册</title><style>%s</style></head><body>\n" % (SOFTWARE_NAME, MANUAL_CSS)]
    # 封面
    parts.append(
        '<div class="cover"><h1>%s</h1><div class="sub">用户操作手册</div>'
        '<div class="meta">软件版本：V%s<br>著作权人：%s<br>运行环境：Microsoft Edge / Google Chrome（Manifest V3）<br>'
        '运行网站：https://weread.qq.com</div></div>' % (SOFTWARE_NAME, version, AUTHOR))
    # 目录
    parts.append("<h1>目录</h1><ol>")
    for title, _ in MANUAL_SECTIONS:
        parts.append("<li>%s</li>" % title)
    parts.append("</ol>")

    for title, files in MANUAL_SECTIONS:
        parts.append('<h1 class="section-title">%s</h1>' % title)
        for rel in files:
            p = os.path.join(GUIDE, rel)
            if not os.path.exists(p):
                continue
            with open(p, encoding="utf-8") as f:
                body = md_to_html(f.read())
            figs = ""
            for fn in SHOT_MAP.get(os.path.basename(rel), []):
                sp = os.path.join(SHOTS, fn)
                if os.path.exists(sp):
                    figs += ('<figure class="shot"><img src="file://%s">'
                             '<figcaption>图：%s</figcaption></figure>'
                             % (sp, SHOT_NAMES.get(fn, fn)))
            parts.append('<article class="doc">%s%s</article>' % (body, figs))
    parts.append("</body></html>")
    return "\n".join(parts)


# ----------------------- 出 PDF（可选） -----------------------
def try_export_pdf(html_path, pdf_path):
    cands = [
        os.path.join(ROOT, ".autoshot", "cft", "chrome-mac-arm64",
                     "Google Chrome for Testing.app", "Contents", "MacOS",
                     "Google Chrome for Testing"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    chrome = next((c for c in cands if os.path.exists(c)), None)
    if not chrome:
        return False
    try:
        subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                        "--print-to-pdf=%s" % pdf_path, "file://%s" % html_path],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        return True
    except Exception:
        return False


def make_submission_pdf(pdf_path, front=30, back=30):
    """按软著规范把长文档切成「前 front 页 + 后 back 页」；不足则原样返回。"""
    try:
        from pypdf import PdfReader, PdfWriter
    except Exception:
        return None
    try:
        reader = PdfReader(pdf_path)
        n = len(reader.pages)
        if n <= front + back:
            return pdf_path
        writer = PdfWriter()
        for i in list(range(front)) + list(range(n - back, n)):
            writer.add_page(reader.pages[i])
        out = pdf_path[:-4] + "-提交版(前%d+后%d).pdf" % (front, back)
        with open(out, "wb") as f:
            writer.write(f)
        return out
    except Exception:
        return None


def main():
    version = software_version()
    os.makedirs(OUT, exist_ok=True)

    src_html, total_pages, kept = build_source_html(version)
    src_path = os.path.join(OUT, "源程序-%s-V%s.html" % (SOFTWARE_NAME, version))
    with open(src_path, "w", encoding="utf-8") as f:
        f.write(src_html)

    man_html = build_manual_html(version)
    man_path = os.path.join(OUT, "用户操作手册-%s-V%s.html" % (SOFTWARE_NAME, version))
    with open(man_path, "w", encoding="utf-8") as f:
        f.write(man_html)

    print("软件名称：%s  V%s" % (SOFTWARE_NAME, version))
    print("源程序  → %s" % src_path)
    print("          全文共 %d 页，已抽取前 %d + 后 %d = %d 页" %
          (total_pages, FRONT_PAGES, BACK_PAGES, kept))
    print("用户手册 → %s" % man_path)

    if "--pdf" in sys.argv:
        for hp in (src_path, man_path):
            pp = hp[:-5] + ".pdf"
            ok = try_export_pdf(hp, pp)
            print("  出 PDF：%s -> %s" % ("成功" if ok else "跳过（未找到 Chrome）", pp
                                        if ok else "（可手动打印）"))
        # 用户手册通常较长：按软著规范额外切出「前 30 页 + 后 30 页」提交版
        man_pdf = man_path[:-5] + ".pdf"
        if os.path.exists(man_pdf):
            cut = make_submission_pdf(man_pdf, FRONT_PAGES, BACK_PAGES)
            if cut:
                print("  手册提交版（前%d+后%d）→ %s" % (FRONT_PAGES, BACK_PAGES, cut))


if __name__ == "__main__":
    main()
