#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信悦读 · 网站构建脚本

把 web/content/（Obsidian vault）里的 Markdown 编译成 web/dist/ 纯静态网站，
并产出 dist/api/latest.json 作为插件侧的版本公告源。

- 零第三方依赖：只用 Python 标准库（本机 Python 3.9 即可）
- 单一事实源：版本号读仓库根 manifest.json；更新说明读「更新日志.md」最新一节
- 不认识的 Obsidian 私有语法不猜、不报错：降级为普通文字并进入告警清单

用法：
    python3 web/build.py
"""

import html
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

WEB = Path(__file__).resolve().parent
ROOT = WEB.parent
CONTENT = WEB / "content"
TEMPLATES = WEB / "templates"
ASSETS = WEB / "assets"
DIST = WEB / "dist"
ATTACHMENTS = CONTENT / "attachments"
MANIFEST = ROOT / "manifest.json"
ICONS = ROOT / "icons"

CONFIG = {}
LINK_INDEX = {}
VERSION = ""
PAGES = []
WARNINGS = []
GENERATED_URLS = set()

CALLOUT_TITLES = {
    "note": "说明",
    "info": "说明",
    "tip": "提示",
    "hint": "提示",
    "warning": "注意",
    "caution": "注意",
    "important": "重要",
    "danger": "警告",
}


def warn(msg):
    WARNINGS.append(msg)


# --------------------------------------------------------------------------
# 一、读取配置与内容
# --------------------------------------------------------------------------

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_front_matter(text):
    """解析文件头部的 --- YAML --- 块（只支持 front-matter 常用子集）。"""
    if not text.startswith("---"):
        return {}, text
    lines = text.split("\n")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "..."):
            end = i
            break
    if end is None:
        return {}, text

    meta = {}
    cur_key = None
    for raw in lines[1:end]:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        # 列表项：- value
        if stripped.startswith("- ") and cur_key:
            meta.setdefault(cur_key, [])
            if isinstance(meta[cur_key], list):
                meta[cur_key].append(scalar(stripped[2:]))
            continue
        m = re.match(r"^([A-Za-z0-9_\-\u4e00-\u9fff]+)\s*:\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        cur_key = None
        if val == "":
            meta[key] = []
            cur_key = key
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            meta[key] = [scalar(x) for x in inner.split(",") if x.strip()] if inner else []
        else:
            meta[key] = scalar(val)

    body = "\n".join(lines[end + 1:])
    return meta, body.lstrip("\n")


def scalar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    return v


def as_list(v):
    if isinstance(v, list):
        return [str(x) for x in v]
    if v in (None, "", False):
        return []
    return [str(v)]


def slug_to_dist(slug):
    """slug -> (dist 下的输出文件, 站点 URL)"""
    s = str(slug).strip().strip("/")
    if s == "":
        return DIST / "index.html", "/"
    return DIST / s / "index.html", "/" + s + "/"


def section_of(folder, sections):
    """按顶层目录名反查栏目；顶层文件返回 None"""
    for sec in sections:
        if folder == sec["dir"]:
            return sec
    return None


def collect_pages():
    sections = CONFIG["sections"]
    pages = []
    for src in sorted(CONTENT.rglob("*.md")):
        rel = src.relative_to(CONTENT)
        if any(part.startswith(".") or part.startswith("_") for part in rel.parts):
            continue
        if rel.parts and rel.parts[0] == "attachments":
            continue

        text = src.read_text(encoding="utf-8")
        meta, body = parse_front_matter(text)
        slug = meta.get("slug") or rel.with_suffix("").as_posix()
        out_file, url = slug_to_dist(slug)
        folder = rel.parent.as_posix()
        if folder == ".":
            folder = ""
        pages.append({
            "src": src,
            "rel": rel.as_posix(),
            "stem": src.stem,
            "title": str(meta.get("title") or src.stem),
            "slug": str(slug).strip("/"),
            "url": url,
            "out_file": out_file,
            "order": meta.get("order") if isinstance(meta.get("order"), int) else 999,
            "description": str(meta.get("description") or ""),
            "updatedAt": str(meta.get("updatedAt") or ""),
            "draft": meta.get("draft") is True,
            "aliases": as_list(meta.get("aliases")),
            "tags": as_list(meta.get("tags")),
            "folder": folder,
            "section": section_of(folder, sections),
            "body": body,
        })
    return pages


def build_link_index(pages):
    """可被 [[双链]] 命中的名字：文件名 / slug / slug 末段 / 别名 / 栏目名"""
    index = {}
    for p in pages:
        for key in [p["stem"], p["slug"], p["slug"].split("/")[-1]] + p["aliases"]:
            key = str(key).strip().lower()
            if key:
                index[key] = p["url"]
    for sec in CONFIG["sections"]:
        index[sec["title"].lower()] = "/%s/" % sec["key"]
        index[sec["key"].lower()] = "/%s/" % sec["key"]
    return index


# --------------------------------------------------------------------------
# 二、Markdown 渲染（标准 Markdown 子集 + Obsidian 通用语法）
# --------------------------------------------------------------------------

def slugify_heading(text):
    s = re.sub(r"<[^>]+>", "", text)
    s = re.sub(r"[^\w\u4e00-\u9fff\s-]", "", s, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s-]+", "-", s) or "section"


def render_embed(target, alias, page):
    """![[图片.png]] / ![[图片.png|说明]] -> <img>，附件从 attachments/ 复制到 dist"""
    name = target.strip()
    alias = (alias or "").strip()
    if "/" in name or name.lower().endswith((".md", ".pdf")):
        warn("不支持的嵌入（仅支持 attachments/ 下的图片）：%s ← %s" % (name, page["rel"]))
        return html.escape(alias or name)

    src_file = ATTACHMENTS / name
    if not src_file.exists():
        warn("图片缺失：attachments/%s ← %s" % (name, page["rel"]))
        return html.escape(alias or name)

    width = ""
    alt = alias or Path(name).stem
    if alias.isdigit():
        width = ' style="max-width:%spx"' % alias
        alt = Path(name).stem
    return '<img src="/assets/img/%s" alt="%s"%s loading="lazy">' % (
        html.escape(name, quote=True), html.escape(alt, quote=True), width)


def render_wikilink(target, alias, page):
    """[[文件名]] / [[文件名|显示文字]] -> 站内链接"""
    key = target.strip().lower()
    url = LINK_INDEX.get(key)
    if url is None:
        warn("双链解析失败：[[%s]] ← %s" % (target.strip(), page["rel"]))
        return html.escape((alias or target).strip())
    return '<a href="%s">%s</a>' % (url, html.escape((alias or target).strip()))


def render_std_image(alt, src, page):
    """![alt](src)：外链原样保留；相对路径按 attachments/ 解析并复制"""
    if re.match(r"^(https?:|data:|/)", src):
        return '<img src="%s" alt="%s" loading="lazy">' % (
            html.escape(src, quote=True), html.escape(alt, quote=True))
    name = Path(src).name
    src_file = ATTACHMENTS / name
    if src_file.exists():
        return '<img src="/assets/img/%s" alt="%s" loading="lazy">' % (
            html.escape(name, quote=True), html.escape(alt, quote=True))
    warn("图片缺失：%s ← %s" % (src, page["rel"]))
    return '<img src="%s" alt="%s">' % (html.escape(src, quote=True), html.escape(alt, quote=True))


def render_std_link(text, url):
    if url.startswith("#"):
        return '<a href="%s">%s</a>' % (html.escape(url, quote=True), text)
    if re.match(r"^https?:", url):
        return '<a href="%s" target="_blank" rel="noopener">%s</a>' % (
            html.escape(url, quote=True), text)
    return '<a href="%s">%s</a>' % (html.escape(url, quote=True), text)


def inline(text, page):
    stash = []

    def keep(fragment):
        stash.append(fragment)
        return "\x00%d\x00" % (len(stash) - 1)

    s = html.escape(text, quote=False)
    s = re.sub(r"`([^`]+)`", lambda m: keep("<code>%s</code>" % m.group(1)), s)
    s = re.sub(r"!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]",
               lambda m: keep(render_embed(m.group(1), m.group(2), page)), s)
    s = re.sub(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]",
               lambda m: keep(render_wikilink(m.group(1), m.group(2), page)), s)
    s = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)",
               lambda m: keep(render_std_image(m.group(1), m.group(2), page)), s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)",
               lambda m: keep(render_std_link(m.group(1), m.group(2))), s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", s)
    s = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", s)

    for i, fragment in enumerate(stash):
        s = s.replace("\x00%d\x00" % i, fragment)
    return s


def split_table_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", line)]


def is_block_start(line):
    return bool(
        re.match(r"^(#{1,6})\s+", line)
        or re.match(r"^\s*([-*+]|\d+[.)])\s+", line)
        or line.lstrip().startswith(">")
        or line.lstrip().startswith("```")
        or re.match(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$", line)
        or line.strip().startswith("|")
    )


def render_markdown(text, page, heading_ids=None):
    lines = text.replace("\r\n", "\n").split("\n")
    out = []
    i = 0
    n = len(lines)
    if heading_ids is None:
        heading_ids = {}

    while i < n:
        line = lines[i]

        if not line.strip():
            i += 1
            continue

        # 代码块
        if line.lstrip().startswith("```"):
            lang = line.strip()[3:].strip()
            i += 1
            buf = []
            while i < n and not lines[i].lstrip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1  # 跳过收尾的 ```
            cls = ' class="language-%s"' % html.escape(lang, quote=True) if lang else ""
            out.append("<pre><code%s>%s</code></pre>" % (cls, html.escape("\n".join(buf))))
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            level = len(m.group(1))
            text_in = m.group(2).strip()
            hid = slugify_heading(text_in)
            if hid in heading_ids:
                heading_ids[hid] += 1
                hid = "%s-%d" % (hid, heading_ids[hid])
            else:
                heading_ids[hid] = 0
            out.append('<h%d id="%s">%s</h%d>' % (level, hid, inline(text_in, page), level))
            i += 1
            continue

        # 分隔线
        if re.match(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$", line):
            out.append("<hr>")
            i += 1
            continue

        # 表格
        if line.strip().startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            headers = split_table_row(line)
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(split_table_row(lines[i]))
                i += 1
            thead = "".join("<th>%s</th>" % inline(c, page) for c in headers)
            tbody = "".join(
                "<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c, page) for c in row)
                for row in rows
            )
            out.append("<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>" % (thead, tbody))
            continue

        # 引用 / Callout
        if line.lstrip().startswith(">"):
            block = []
            while i < n and (lines[i].lstrip().startswith(">") or not lines[i].strip()):
                if not lines[i].strip():
                    if i + 1 < n and lines[i + 1].lstrip().startswith(">"):
                        block.append("")
                        i += 1
                        continue
                    break
                block.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            content = "\n".join(block)
            first = block[0].strip() if block else ""
            m = re.match(r"^\[!(\w+)\]([+-]?)\s*(.*)$", first)
            if m:
                kind = m.group(1).lower()
                title = m.group(3).strip() or CALLOUT_TITLES.get(kind, kind)
                css = kind if kind in CALLOUT_TITLES else "note"
                body = "\n".join(block[1:]).strip()
                inner = render_markdown(body, page, heading_ids) if body else ""
                out.append(
                    '<div class="callout callout-%s"><p class="callout-title">%s</p>'
                    '<div class="callout-body">%s</div></div>' % (
                        css, inline(title, page), inner)
                )
            else:
                out.append("<blockquote>%s</blockquote>" % render_markdown(content, page, heading_ids))
            continue

        # 列表
        if re.match(r"^\s*([-*+]|\d+[.)])\s+", line):
            items = []
            while i < n and re.match(r"^\s*([-*+]|\d+[.)])\s+", lines[i]):
                m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", lines[i])
                indent = len(m.group(1).replace("\t", "  "))
                ordered = bool(re.match(r"\d+", m.group(2)))
                items.append((indent, ordered, m.group(3).strip()))
                i += 1
            out.append(render_list(items, page))
            continue

        # 段落
        buf = [line]
        i += 1
        while i < n and lines[i].strip() and not is_block_start(lines[i]):
            buf.append(lines[i])
            i += 1
        out.append("<p>%s</p>" % inline("\n".join(buf), page))

    return "\n".join(out)


def render_list(items, page):
    res = []
    stack = []  # [indent, tag]
    for indent, ordered, text in items:
        tag = "ol" if ordered else "ul"
        while stack and indent < stack[-1][0]:
            _, t = stack.pop()
            res.append("</li></ul>" if t == "ul" else "</li></ol>")
        if not stack or indent > stack[-1][0]:
            res.append("<%s>" % tag)
            stack.append([indent, tag])
        else:
            res.append("</li>")
            if stack[-1][1] != tag:
                res.append("</%s><%s>" % (stack[-1][1], tag))
                stack[-1][1] = tag
        res.append("<li>%s" % inline(text, page))
    while stack:
        _, t = stack.pop()
        res.append("</li></ul>" if t == "ul" else "</li></ol>")
    return "".join(res)


# --------------------------------------------------------------------------
# 三、页面骨架（导航 / 目录 / 上下篇 / 页脚）
# --------------------------------------------------------------------------

def render_nav(current_url):
    parts = []
    for item in CONFIG["nav"]:
        active = ' class="active"' if item["url"] == current_url else ""
        parts.append('<a href="%s"%s>%s</a>' % (item["url"], active, html.escape(item["title"])))
    return "\n      ".join(parts)


def render_sidebar(page):
    sec = page.get("section")
    if not sec:
        return ""
    members = [p for p in PAGES if not p["draft"] and p["section"] and p["section"]["key"] == sec["key"]]
    links = []
    for p in sorted(members, key=lambda x: (x["order"], x["title"])):
        active = ' class="active"' if p["url"] == page["url"] else ""
        links.append('<li><a href="%s"%s>%s</a></li>' % (p["url"], active, html.escape(p["title"])))
    return (
        '<aside class="site-sidebar">\n'
        '  <p class="sidebar-title">%s</p>\n'
        '  <ul class="sidebar-list">\n    %s\n  </ul>\n'
        '</aside>' % (html.escape(sec["title"]), "\n    ".join(links))
    )


def render_prev_next(page):
    sec = page.get("section")
    if not sec:
        return ""
    members = sorted(
        [p for p in PAGES if not p["draft"] and p["section"] and p["section"]["key"] == sec["key"]],
        key=lambda x: (x["order"], x["title"]),
    )
    urls = [p["url"] for p in members]
    if page["url"] not in urls:
        return ""
    idx = urls.index(page["url"])
    prev_page = members[idx - 1] if idx > 0 else None
    next_page = members[idx + 1] if idx < len(members) - 1 else None
    if not prev_page and not next_page:
        return ""
    left = ('<a class="pn-prev" href="%s">← %s</a>' % (prev_page["url"], html.escape(prev_page["title"]))
            if prev_page else "<span></span>")
    right = ('<a class="pn-next" href="%s">%s →</a>' % (next_page["url"], html.escape(next_page["title"]))
             if next_page else "<span></span>")
    return '<nav class="prev-next">%s%s</nav>' % (left, right)


def render_footer():
    stores = CONFIG.get("storeUrls") or {}
    links = []
    for key, label in (("edge", "Edge 商店"), ("chrome", "Chrome 商店"), ("360", "360 商店")):
        if stores.get(key):
            links.append('<a href="%s" target="_blank" rel="noopener">%s</a>' % (
                html.escape(stores[key], quote=True), label))
    if not links:
        links.append('<a href="/start/">安装插件</a>')
    links.append('<a href="/changelog/">更新日志</a>')
    links.append('<a href="/privacy/">隐私政策</a>')
    links.append('<a href="%s" target="_blank" rel="noopener">GitHub</a>' % CONFIG["repoUrl"])
    if CONFIG.get("giteeUrl"):
        links.append('<a href="%s" target="_blank" rel="noopener">Gitee</a>' % CONFIG["giteeUrl"])
    return (
        '<div class="footer-inner">\n'
        '    <nav class="footer-links">%s</nav>\n'
        '    <p class="footer-meta">%s v%s · MIT License · © %s</p>\n'
        '  </div>' % (
            " ".join(links), html.escape(CONFIG["siteName"]), VERSION, date.today().year)
    )


def render_layout(page, content_html, extra_class=""):
    layout = (TEMPLATES / "layout.html").read_text(encoding="utf-8")
    tokens = {
        "{{SITE_NAME}}": html.escape(CONFIG["siteName"]),
        "{{TITLE}}": html.escape(page["title"] if page["url"] != "/"
                                  else "%s · %s" % (CONFIG["siteName"], CONFIG["siteDescription"][:40])),
        "{{DESCRIPTION}}": html.escape(page.get("description") or CONFIG["siteDescription"], quote=True),
        "{{NAV}}": render_nav(page["url"]),
        "{{SIDEBAR}}": render_sidebar(page),
        "{{CONTENT}}": content_html,
        "{{PREVNEXT}}": render_prev_next(page),
        "{{FOOTER}}": render_footer(),
        "{{BODY_CLASS}}": extra_class,
    }
    for key, val in tokens.items():
        layout = layout.replace(key, val)
    return layout


def article_header(page):
    meta_bits = []
    if page.get("updatedAt"):
        meta_bits.append("更新于 %s" % page["updatedAt"])
    if VERSION:
        meta_bits.append("适用插件 v%s" % VERSION)
    meta = '<p class="doc-meta">%s</p>' % " · ".join(meta_bits) if meta_bits else ""
    return '<header class="doc-header"><h1>%s</h1>%s</header>' % (
        inline(page["title"], page), meta)


# --------------------------------------------------------------------------
# 四、栏目索引页 / 更新日志 / latest.json
# --------------------------------------------------------------------------

def render_section_index(sec):
    members = sorted(
        [p for p in PAGES if not p["draft"] and p["section"] and p["section"]["key"] == sec["key"]],
        key=lambda x: (x["order"], x["title"]),
    )
    cards = []
    for p in members:
        desc = '<p class="card-desc">%s</p>' % html.escape(p["description"]) if p["description"] else ""
        cards.append(
            '<a class="card" href="%s"><p class="card-title">%s</p>%s</a>' % (
                p["url"], html.escape(p["title"]), desc)
        )
    intro = render_markdown(sec.get("intro", ""), {"rel": "site.config.json", "title": sec["title"]}) if sec.get("intro") else ""
    header = '<header class="doc-header"><h1>%s</h1><p class="doc-meta">%s</p></header>' % (
        html.escape(sec["title"]), html.escape(sec["description"]))
    body = "%s%s\n<ul class=\"card-list\">\n  <li>%s</li>\n</ul>" % (
        intro, "" if not intro else "", "</li>\n  <li>".join(cards))
    return header + body


def parse_changelog_latest():
    """从「更新日志.md」取最新一节：版本号 / 日期 / 一句说明"""
    page = next((p for p in PAGES if p["slug"] == "changelog"), None)
    fallback = (VERSION, date.today().isoformat(), "")
    if not page:
        warn("未找到「更新日志.md」，latest.json 的更新说明留空")
        return fallback

    lines = page["body"].split("\n")
    version, released, notice = "", "", ""
    for i, line in enumerate(lines):
        m = re.match(r"^##\s+(.*)$", line.strip())
        if not m:
            continue
        head = m.group(1)
        vm = re.search(r"v?(\d+\.\d+\.\d+)", head)
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", head)
        version = vm.group(1) if vm else ""
        released = dm.group(1) if dm else ""
        for follow in lines[i + 1:]:
            if follow.strip().startswith("#"):
                break
            text = follow.strip().lstrip("-*").strip()
            if text:
                notice = re.sub(r"\*\*|`", "", text)
                break
        break

    if version and version != VERSION:
        warn("更新日志最新一节是 v%s，与 manifest.json 的 v%s 不一致（以 manifest.json 为准）"
             % (version, VERSION))
    return (VERSION, released or page["updatedAt"] or fallback[1], notice)


def write_latest_json():
    version, released, notice = parse_changelog_latest()
    stores = {k: v for k, v in (CONFIG.get("storeUrls") or {}).items() if v}
    data = {
        "latestVersion": version,
        "releasedAt": released,
        "minSupportedVersion": CONFIG.get("minSupportedVersion", ""),
        "notice": notice or ("v%s 已发布" % version),
        "changelogUrl": CONFIG["baseUrl"].rstrip("/") + "/changelog/",
        "storeUrls": stores,
    }
    out = DIST / "api" / "latest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return data


# --------------------------------------------------------------------------
# 五、静态资源与构建主流程
# --------------------------------------------------------------------------

def copy_assets():
    dst = DIST / "assets"
    if ASSETS.exists():
        shutil.copytree(ASSETS, dst, dirs_exist_ok=True)
    (dst / "img").mkdir(parents=True, exist_ok=True)

    for icon in ("icon-16.png", "icon-48.png", "icon-128.png"):
        if (ICONS / icon).exists():
            shutil.copy2(ICONS / icon, dst / "img" / icon)

    if ATTACHMENTS.exists():
        for item in sorted(ATTACHMENTS.iterdir()):
            if item.name.startswith(".") or not item.is_file():
                continue
            target = dst / "img" / item.name
            if target.exists():
                warn("附件与站点资源重名，附件覆盖：%s" % item.name)
            shutil.copy2(item, target)


def check_duplicates():
    seen = {}
    for p in PAGES:
        if p["draft"]:
            continue
        if p["url"] in seen:
            warn("slug 重复：%s 与 %s 都指向 %s" % (p["rel"], seen[p["url"]], p["url"]))
        else:
            seen[p["url"]] = p["rel"]
        if p["slug"] not in ("", "/") and not p["description"]:
            warn("缺 description：%s" % p["rel"])


def check_dead_links():
    """扫描产物里的站内链接，确认都有对应页面"""
    for html_file in DIST.rglob("*.html"):
        text = html_file.read_text(encoding="utf-8")
        for href in re.findall(r'href="(/[^"#?]*)"', text):
            if href.startswith("/api/"):
                continue
            if href in GENERATED_URLS:
                continue
            target = DIST / href.lstrip("/")
            if href.endswith("/") or not target.suffix:
                target = target / "index.html"
            if not target.exists():
                warn("站内死链：%s ← %s" % (href, html_file.relative_to(DIST).as_posix()))


def build():
    global CONFIG, VERSION, PAGES, LINK_INDEX

    if not CONTENT.exists():
        print("❌ 找不到内容目录：%s" % CONTENT)
        return 1

    CONFIG = load_json(WEB / "site.config.json")
    manifest = load_json(MANIFEST)
    VERSION = manifest.get("version", "")

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)

    all_pages = collect_pages()
    PAGES = [p for p in all_pages if not p["draft"]]
    LINK_INDEX = build_link_index(all_pages)
    check_duplicates()

    # 1) 文章页
    for p in PAGES:
        body_html = render_markdown(p["body"], p)
        content = article_header(p) + body_html
        html_text = render_layout(p, content, extra_class="has-sidebar" if p["section"] else "")
        p["out_file"].parent.mkdir(parents=True, exist_ok=True)
        p["out_file"].write_text(html_text, encoding="utf-8")
        GENERATED_URLS.add(p["url"])

    # 2) 栏目索引页
    for sec in CONFIG["sections"]:
        out_file, url = slug_to_dist(sec["key"])
        page = {
            "title": sec["title"],
            "url": url,
            "description": sec["description"],
            "section": sec,
            "updatedAt": "",
        }
        content = '<p class="doc-meta">%s</p>' % html.escape(sec["description"]) + render_section_index(sec)
        html_text = render_layout(page, content, extra_class="has-sidebar")
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(html_text, encoding="utf-8")
        GENERATED_URLS.add(url)
        sec["url"] = url

    # 3) 资源、公告、死链检查
    copy_assets()
    latest = write_latest_json()
    GENERATED_URLS.update(["/privacy/", "/changelog/", "/about/", "/feedback/", "/faq/", "/start/"])
    check_dead_links()

    # 4) 摘要
    print("")
    print("✅ 构建完成：%s" % DIST)
    print("   页面 %d 篇 + 栏目索引 %d 个" % (len(PAGES), len(CONFIG["sections"])))
    print("   版本（读自 manifest.json）：v%s" % VERSION)
    print("   公告：%s（%s）" % (latest["notice"], latest["releasedAt"]))
    if WARNINGS:
        print("")
        print("⚠️  告警 %d 条：" % len(WARNINGS))
        for w in WARNINGS:
            print("   - %s" % w)
        return 0
    print("   告警：0 条")
    return 0


if __name__ == "__main__":
    sys.exit(build())
