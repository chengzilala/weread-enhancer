#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信悦读 · 网站构建脚本

把 web/content/（Obsidian vault）里的 Markdown 编译成 web/dist/ 纯静态网站，
并产出 dist/api/latest.json 作为插件侧的版本公告源。

- 零第三方依赖：只用 Python 标准库（本机 Python 3.9 即可）
  - 唯一例外：若本机装有 Pillow，则为图库生成缩略图；没装也能正常构建（退回原图）
- 单一事实源：版本号只有一处——仓库根 manifest.json（页脚、dist/api/latest.json 都用它）；
  更新说明（日期 + 一句话）读「更新日志.md」最新一节，不与 manifest.json 做一致性校验
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
APP = ROOT / "h5"          # 网页版（H5 移动端）源码，与官网同域发布
APP_DIR = "app"            # 拷贝到 dist 下的子目录名（线上即 /app/）
APP_SKIP = {"README.md"}   # 只给开发者看，不上线

DONATE_JSON = WEB / "donate.json"   # 打赏名单数据（作者手动维护，字段说明见文件内 _readme）

CONFIG = {}
LINK_INDEX = {}
VERSION = ""
PAGES = []
WARNINGS = []
GENERATED_URLS = set()
THUMB_AVAILABLE = False

# 图库（图片栏目）约定：图片放 web/assets/img/gallery/，
# 缩略图由构建生成到 dist/assets/img/gallery/thumbs/（同名 .jpg）
GALLERY_URL_PREFIX = "/assets/img/gallery/"
GALLERY_THUMB_DIR = "thumbs"
GALLERY_THUMB_MAX = 1400
GALLERY_THUMB_QUALITY = 82

# 帮助文档站：除这几个「官网页面」留在根目录外，其余内容页统一挂到 /docs/ 下
# （参考 flomo 101：官网只讲「是什么」，用法教程独立成一个文档站）
SITE_SLUGS = {"", "about", "essay", "gallery", "privacy", "feedback"}
DOCS_DIR = "docs"

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
        base_slug = str(meta.get("slug") or rel.with_suffix("").as_posix()).strip("/")
        # 内容页统一进 /docs/；官网页面（首页 / 关于 / 图库 / 隐私 / 反馈）留在根目录
        out_slug = base_slug if base_slug in SITE_SLUGS else "%s/%s" % (DOCS_DIR, base_slug)
        out_file, url = slug_to_dist(out_slug)
        folder = rel.parent.as_posix()
        if folder == ".":
            folder = ""
        pages.append({
            "src": src,
            "rel": rel.as_posix(),
            "stem": src.stem,
            "title": str(meta.get("title") or src.stem),
            "slug": out_slug,
            "base_slug": base_slug,
            "url": url,
            "out_file": out_file,
            "order": meta.get("order") if isinstance(meta.get("order"), int) else 999,
            "description": str(meta.get("description") or ""),
            "tagline": str(meta.get("tagline") or ""),
            "heroTitle": str(meta.get("heroTitle") or ""),
            "visionText": str(meta.get("visionText") or ""),
            "hero": str(meta.get("hero") or ""),
            "updatedAt": str(meta.get("updatedAt") or ""),
            "reveal": False,
            "draft": meta.get("draft") is True,
            "aliases": as_list(meta.get("aliases")),
            "tags": as_list(meta.get("tags")),
            "folder": folder,
            "section": section_of(folder, sections),
            "body": body,
        })
    return pages


def section_url(sec):
    """栏目索引页地址（帮助文档站内，如 /docs/guide/）"""
    return "/%s/%s/" % (DOCS_DIR, sec["key"])


def build_link_index(pages):
    """可被 [[双链]] 命中的名字：文件名 / slug / slug 末段 / 别名 / 栏目名"""
    index = {}
    for p in pages:
        for key in [p["stem"], p["slug"], p["slug"].split("/")[-1]] + p["aliases"]:
            key = str(key).strip().lower()
            if key:
                index[key] = p["url"]
    for sec in CONFIG["sections"]:
        index[sec["title"].lower()] = section_url(sec)
        index[sec["key"].lower()] = section_url(sec)
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


def gallery_thumb_url(src):
    """图库原图 URL -> 缩略图 URL（约定：同名 .jpg）；不在顶层则返回 None"""
    rel = src[len(GALLERY_URL_PREFIX):]
    if not rel or "/" in rel:
        return None
    return "%s%s/%s.jpg" % (GALLERY_URL_PREFIX, GALLERY_THUMB_DIR, Path(rel).stem)


def render_gallery_image(alt, src):
    """图库图片 -> <a class="wre-gal-link"> 包裹；大图显示缩略图、点击看原图（渐入）"""
    full = html.escape(src, quote=True)
    thumb = gallery_thumb_url(src) if THUMB_AVAILABLE else None
    shown = html.escape(thumb or src, quote=True)
    text = html.escape(alt, quote=True)
    return ('<a class="wre-gal-link wre-reveal" href="%s" data-full="%s" title="%s">'
            '<img src="%s" alt="%s" loading="lazy"></a>') % (
        full, full, text, shown, text)


def render_std_image(alt, src, page):
    """![alt](src)：外链原样保留；相对路径按 attachments/ 解析并复制"""
    if re.match(r"^(https?:|data:|/)", src):
        # 仅图库页把图片包成「缩略图 + 点击看原图」；其他页面（如首页）按普通大图展示
        if page.get("slug") == "gallery" and src.startswith(GALLERY_URL_PREFIX):
            return render_gallery_image(alt, src)
        cls = ' class="wre-reveal"' if page.get("reveal") else ""
        return '<img%s src="%s" alt="%s" loading="lazy">' % (
            cls, html.escape(src, quote=True), html.escape(alt, quote=True))
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


def render_store_buttons():
    """内容页「商店跳转」按钮组（内容里写 `:::store` 指令）：只渲染已配置链接的商店

    商店链接来自 site.config.json 的 storeUrls；都没配则回退到「安装插件」（回快速上手）。
    """
    stores = CONFIG.get("storeUrls") or {}
    items = []
    for key, label in (("edge", "安装到 Edge"), ("chrome", "安装到 Chrome"), ("360", "安装到 360")):
        url = stores.get(key)
        if not url:
            continue
        primary = " home-btn-primary" if not items else ""
        items.append('<a class="home-btn%s" href="%s" target="_blank" rel="noopener">%s</a>' % (
            primary, html.escape(url, quote=True), label))
    if not items:
        items.append('<a class="home-btn home-btn-primary" href="/docs/start/">安装插件</a>')
    return '<div class="home-actions store-actions">%s</div>' % " ".join(items)


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
        or line.lstrip().startswith(":::")
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

        # 商店跳转按钮块：:::store（单行，或 :::store ... ::: 成对）
        if line.lstrip().startswith(":::"):
            i += 1
            while i < n and lines[i].strip() and not lines[i].lstrip().startswith(":::"):
                i += 1
            if i < n and lines[i].lstrip().startswith(":::"):
                i += 1
            out.append(render_store_buttons())
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
            out.append('<h%d%s id="%s">%s</h%d>' % (
                level, ' class="wre-reveal"' if page.get("reveal") else "",
                hid, inline(text_in, page), level))
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
                # 渐入由整块 callout 承担，内部段落不再各自渐入（避免空框先出现）
                inner = render_markdown(body, dict(page, reveal=False), heading_ids) if body else ""
                reveal = " wre-reveal" if page.get("reveal") else ""
                out.append(
                    '<div class="callout callout-%s%s"><p class="callout-title">%s</p>'
                    '<div class="callout-body">%s</div></div>' % (
                        css, reveal, inline(title, page), inner)
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
        inner = inline("\n".join(buf), page)
        # 首页开启渐入：纯文字段落随滚动现身（含图片的段落由图片自身渐入，避免叠加）
        cls = ' class="wre-reveal"' if page.get("reveal") and "<img" not in inner else ""
        out.append("<p%s>%s</p>" % (cls, inner))

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
    """顶栏：主导航（site.config.json 的 nav，flomo 式少链接）+「登录」+ 绿色胶囊「装到 Edge」"""
    links = []
    for item in CONFIG["nav"]:
        active = ' class="active"' if item["url"] == current_url else ""
        links.append('<a href="%s"%s>%s</a>' % (
            item["url"], active, html.escape(item["title"])))
    nav = "\n      ".join(links)

    stores = CONFIG.get("storeUrls") or {}
    store_url = stores.get("edge") or "/docs/start/"
    store_label = "装到 Edge" if stores.get("edge") else "安装插件"
    store_ext = ' target="_blank" rel="noopener"' if store_url.startswith("http") else ""
    return (
        '<nav class="site-nav">\n      %s\n      </nav>\n'
        '      <div class="site-cta">\n'
        '        <a class="btn btn-ghost" href="/account/">登录</a>\n'
        '        <a class="btn btn-primary" href="%s"%s>%s</a>\n'
        '      </div>' % (nav, html.escape(store_url, quote=True), store_ext, store_label)
    )


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
        links.append('<a href="/docs/start/">安装插件</a>')
    links.append('<a href="/docs/">帮助文档</a>')
    links.append('<a href="/docs/changelog/">更新日志</a>')
    links.append('<a href="/essay/">创作手记</a>')
    links.append('<a href="/account/">我的账户</a>')
    links.append('<a href="/privacy/">隐私政策</a>')
    if CONFIG.get("personalSiteUrl"):
        links.append('<a href="%s" target="_blank" rel="noopener">个人网站</a>' % html.escape(CONFIG["personalSiteUrl"], quote=True))
    links.append('<a href="%s" target="_blank" rel="noopener">GitHub</a>' % CONFIG["repoUrl"])
    if CONFIG.get("giteeUrl"):
        links.append('<a href="%s" target="_blank" rel="noopener">Gitee</a>' % CONFIG["giteeUrl"])
    return (
        '<div class="footer-inner">\n'
        '    <nav class="footer-links">%s</nav>\n'
        '    <p class="footer-meta">%s v%s · GPL-3.0 License · © %s</p>\n'
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
    return '<header class="doc-header"><h1>%s</h1></header>' % inline(page["title"], page)


# --------------------------------------------------------------------------
# 三·五、帮助文档站（/docs/）——VuePress 原味：顶栏 + 左栏目录树 + 正文单栏 + 上/下页
# --------------------------------------------------------------------------

def write_page(out_file, html_text, url):
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(html_text, encoding="utf-8")
    GENERATED_URLS.add(url)


def page_by_base_slug(slug):
    slug = str(slug).strip("/")
    return next((p for p in PAGES if p["base_slug"] == slug), None)


def section_pages(sec):
    return sorted(
        [p for p in PAGES if not p["draft"] and p["section"] and p["section"]["key"] == sec["key"]],
        key=lambda x: (x["order"], x["title"]),
    )


def docs_tree_html(current_url):
    """左侧目录树：按 site.config.json 的 docs.tree 分组渲染（section 展开为栏目全部页面）"""
    tree = (CONFIG.get("docs") or {}).get("tree") or []
    groups = []

    def link(p):
        active = ' class="active"' if p["url"] == current_url else ""
        return '  <a href="%s"%s>%s</a>' % (p["url"], active, html.escape(p["title"]))

    for grp in tree:
        sec_key = grp.get("section")
        if sec_key:
            sec = next((s for s in CONFIG["sections"] if s["key"] == sec_key), None)
            if sec:
                url = section_url(sec)
                active = ' class="active"' if current_url == url else ""
                head = '<a href="%s"%s>%s</a>' % (url, active, html.escape(grp.get("title") or sec["title"]))
                items = [link(p) for p in section_pages(sec)]
            else:
                head, items = html.escape(grp.get("title") or ""), []
        else:
            head = html.escape(grp.get("title") or "")
            items = [link(p) for p in
                     (page_by_base_slug(it.get("slug")) for it in (grp.get("items") or [])) if p]
        groups.append(
            '  <div class="docs-group">\n    <p class="docs-group-title">%s</p>\n%s\n  </div>' % (
                head, "\n".join(items))
        )

    home_cls = "docs-home active" if current_url == "/docs/" else "docs-home"
    home = '  <a class="%s" href="/docs/">帮助文档首页</a>' % home_cls
    return '<nav class="docs-tree">\n%s\n%s\n</nav>' % (home, "\n".join(groups))


def docs_flat_pages():
    """按目录树顺序摊平的文档页（用于「上一页 / 下一页」）"""
    tree = (CONFIG.get("docs") or {}).get("tree") or []
    out = []
    for grp in tree:
        sec_key = grp.get("section")
        if sec_key:
            sec = next((s for s in CONFIG["sections"] if s["key"] == sec_key), None)
            if sec:
                out.extend(section_pages(sec))
        else:
            for it in (grp.get("items") or []):
                p = page_by_base_slug(it.get("slug"))
                if p:
                    out.append(p)
    return out


def render_docs_prev_next(page):
    flat = docs_flat_pages()
    urls = [p["url"] for p in flat]
    if page["url"] not in urls:
        return ""
    idx = urls.index(page["url"])
    prev_page = flat[idx - 1] if idx > 0 else None
    next_page = flat[idx + 1] if idx < len(flat) - 1 else None
    if not prev_page and not next_page:
        return ""
    left = ('<a class="prev" href="%s">%s</a>' % (prev_page["url"], html.escape(prev_page["title"]))
            if prev_page else "<span></span>")
    right = ('<a class="next" href="%s">%s</a>' % (next_page["url"], html.escape(next_page["title"]))
             if next_page else "<span></span>")
    return '<nav class="pager">%s%s</nav>' % (left, right)


def render_docs_layout(page, content_html):
    layout = (TEMPLATES / "docs.html").read_text(encoding="utf-8")
    docs_title = (CONFIG.get("docs") or {}).get("title") or "帮助文档"
    tokens = {
        "{{SITE_NAME}}": html.escape(CONFIG["siteName"]),
        "{{TITLE}}": html.escape("%s · %s" % (page["title"], docs_title)),
        "{{DESCRIPTION}}": html.escape(page.get("description") or CONFIG["siteDescription"], quote=True),
        "{{DOCS_TREE}}": docs_tree_html(page["url"]),
        "{{CONTENT}}": content_html,
        "{{PREVNEXT}}": render_docs_prev_next(page),
    }
    for key, val in tokens.items():
        layout = layout.replace(key, val)
    return layout


def render_docs_home():
    """帮助文档站首页 /docs/：一句话介绍 + 从哪里开始 + 常用链接"""
    sec_url = {s["key"]: section_url(s) for s in CONFIG["sections"]}
    stores = CONFIG.get("storeUrls") or {}
    edge = stores.get("edge") or "/docs/start/"
    content = "\n".join([
        '<header class="doc-header"><h1>微信悦读 · 帮助文档</h1></header>',
        '<p>微信悦读是微信读书的阅读增强工具：桌面插件 + H5 网页版 + 微信小程序。这里把它「怎么用」，一篇一篇讲清楚。</p>',
        '<div class="callout callout-tip"><p class="callout-title">提示</p><div class="callout-body">'
        '<p>第一次来？建议从 <a href="/docs/start/">快速上手</a> 开始，两分钟就能装好。</p></div></div>',
        '<h2>从哪里开始</h2>',
        '<ul>',
        '<li><a href="/docs/start/">快速上手</a> —— 把它装到浏览器里，并确认能用。</li>',
        '<li><a href="%s">功能教程</a> —— 按模块分篇，一篇讲清一个功能怎么用。</li>' % sec_url.get("guide", "/docs/guide/"),
        '<li><a href="%s">H5 移动端</a> / <a href="%s">微信小程序</a> —— 手机上怎么看数据、看人格、生成分享图。</li>'
        % (sec_url.get("h5", "/docs/h5/"), sec_url.get("miniapp", "/docs/miniapp/")),
        '<li><a href="%s">阅读人格</a> —— 从你真正读过的书里，算出你的「读书人」代码。</li>' % sec_url.get("persona", "/docs/persona/"),
        '<li><a href="%s">知识资产</a> —— 不装插件也值得看的阅读方法。</li>' % sec_url.get("thinking", "/docs/thinking/"),
        '</ul>',
        '<h2>常用链接</h2>',
        '<ul>',
        '<li><a href="%s" target="_blank" rel="noopener">装到 Edge（加载项商店）</a></li>' % html.escape(edge, quote=True),
        '<li><a href="/app/">H5 网页版</a></li>',
        '<li><a href="/docs/changelog/">更新日志</a></li>',
        '<li><a href="/feedback/">反馈建议</a></li>',
        '</ul>',
    ])
    page = {
        "title": "帮助文档",
        "url": "/docs/",
        "description": "微信悦读的使用教程：装好、用起来、读完复盘。左边是目录，右边只讲一件事。",
        "section": None,
        "updatedAt": "",
    }
    out_file, url = slug_to_dist(DOCS_DIR)
    write_page(out_file, render_docs_layout(page, content), url)


def render_docs_section_index(sec):
    """栏目索引页（/docs/<key>/）：栏目名 + 说明 + 该栏目下所有文章卡片"""
    page = {
        "title": sec["title"],
        "url": section_url(sec),
        "description": sec["description"],
        "section": sec,
        "updatedAt": "",
    }
    desc = '<p class="docs-sec-desc">%s</p>' % html.escape(sec["description"]) if sec.get("description") else ""
    content = '<header class="doc-header"><h1>%s</h1></header>%s%s' % (
        html.escape(sec["title"]), desc, render_section_index(sec))
    out_file, url = slug_to_dist("%s/%s" % (DOCS_DIR, sec["key"]))
    write_page(out_file, render_docs_layout(page, content), url)
    sec["url"] = url


def write_redirect(old_url, new_url, title="页面已迁移"):
    """为旧地址写一个「自动跳转」页（meta refresh + JS），保住已发布/已收藏的链接"""
    out_file = DIST / old_url.strip("/") / "index.html"
    target = CONFIG["baseUrl"].rstrip("/") + new_url
    html_text = (
        '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="robots" content="noindex,follow">\n'
        '<meta http-equiv="refresh" content="0; url=%s">\n'
        '<link rel="canonical" href="%s">\n'
        '<title>%s</title>\n'
        '<script>location.replace("%s");</script>\n'
        '</head>\n<body>\n<p>页面已迁移到 <a href="%s">%s</a>。</p>\n</body>\n</html>\n' % (
            new_url, html.escape(target, quote=True), html.escape(title),
            new_url, new_url, new_url)
    )
    write_page(out_file, html_text, old_url)


# --------------------------------------------------------------------------
# 首页落地页（大图 · 极简 · 顺滑）——Hero + 功能大图区
# --------------------------------------------------------------------------

def home_install_button():
    """首页「安装」按钮：有商店链接则跳商店，否则回退到快速上手"""
    stores = CONFIG.get("storeUrls") or {}
    url = stores.get("edge") or "/docs/start/"
    label = "安装到 Edge" if stores.get("edge") else "安装插件"
    ext = ' target="_blank" rel="noopener"' if url.startswith("http") else ""
    return '<a class="home-btn home-btn-primary" href="%s"%s>%s</a>' % (
        html.escape(url, quote=True), ext, label)


def home_action_item(btn_html, note="", tip=""):
    """首页 Hero 按钮组的一项：按钮 + 一行小字说明（note） + 悬停提示（tip）。

    note 常显，说明「这是什么、什么时候用」；tip 悬停/聚焦时由 CSS 显示更完整的解释。
    btn_html 为已生成的按钮标签（<a>/<span>），这里在其开始标签末尾补一个 data-tip 属性。
    """
    if tip:
        idx = btn_html.find(">")
        if idx != -1:
            btn_html = btn_html[:idx] + ' data-tip="%s"' % html.escape(tip, quote=True) + btn_html[idx:]
    note_html = '<span class="home-action-note">%s</span>' % html.escape(note) if note else ""
    return '<div class="home-action">%s%s</div>' % (btn_html, note_html)


# 作者个人名片（跨域 iframe）：名片页自包含、零依赖；高度由名片页 postMessage 自适应
PS_CARD_URL = "https://chesterlee.cn/card.html"
PS_CARD_TEMPLATE = """<div class="ps-card-embed">
<iframe id="ps-card" src="__URL__" title="张诚 · Chester 名片" style="width:100%;border:0;display:block;height:360px" loading="lazy"></iframe>
<script>
(function () {
  var box = document.getElementById('ps-card');
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'ps-card-height' && box) {
      box.style.height = e.data.height + 'px';
    }
  });
})();
</script>
</div>"""


def render_card_embed():
    """首页顶部的个人名片：原样输出 iframe + 自适应高度脚本（不加 sandbox，保证整卡可跳出跳转）"""
    return PS_CARD_TEMPLATE.replace("__URL__", PS_CARD_URL)


def render_home(page):
    """首页 = 「关于作者」区块（个人名片 + 作者的话） + Hero（front-matter，含安装等按钮组） + 正文（功能大图区等）"""
    title = page.get("heroTitle") or page["title"]
    tagline = page.get("tagline") or page.get("description") or ""

    media = ""
    if page.get("hero"):
        media = ('<div class="home-hero-media wre-reveal">'
                 '<img src="%s" alt="%s" decoding="async" fetchpriority="high"></div>') % (
            html.escape(page["hero"], quote=True), html.escape(title, quote=True))

    # 安装到 Edge（插件）：电脑端入口 —— 按钮 + 一行小字 + 悬停提示
    install_item = home_action_item(
        home_install_button(),
        "电脑浏览器 · 读的时候用",
        "在电脑浏览器（Edge / Chrome）里安装的插件，管「读的过程」：屏占比、自动阅读、笔记导出、阅读统计、阅读洞察等。",
    )

    # 网页版（H5）入口：配置 appUrl 后出现；与官网同域，线上路径 /app/
    app_url = CONFIG.get("appUrl") or ""
    app_item = home_action_item(
        '<a class="home-btn" href="%s">H5 移动端</a>' % html.escape(app_url, quote=True),
        "手机浏览器 · 读完复盘（带 AI）",
        "手机浏览器打开就能用，不用安装。管「读完之后」：数据总览、阅读人格、行为报告、每日卡片、灵感漫游，保留 AI 深度解析。",
    ) if app_url else ""

    # 桌面版：把「微信悦读」装成桌面应用的手把手教程（电脑 / 手机都覆盖）
    desktop_item = home_action_item(
        '<a class="home-btn" href="/docs/h5/desktop/">桌面版</a>',
        "电脑 / 手机 · 装成 App",
        "把手上的「微信悦读」装到桌面、像 App 一样用：电脑（Windows / Mac）装成桌面应用，手机 H5 与微信小程序也能加到桌面，桌面图标一点就开。含 Windows / Mac、iPhone、安卓全步骤。",
    )

    # 微信小程序入口（已上线）：配置 miniappUrl 时按钮跳外链；否则鼠标悬停自动浮出小程序码、点击看大图
    # （浏览器本身打不开小程序，只能扫码 / 微信里搜名字）
    miniapp_url = CONFIG.get("miniappUrl") or ""
    if miniapp_url:
        miniapp_item = home_action_item(
            '<a class="home-btn" href="%s" target="_blank" rel="noopener">微信小程序</a>' % html.escape(miniapp_url, quote=True),
            "微信里 · 读完复盘（无 AI）",
            "在微信里搜「悦读且住」打开就能用：复盘数据、阅读人格、行为报告，还能管理纸质书。合规精简版，不含 AI。",
        )
    else:
        miniapp_item = home_action_item(
            '<a class="home-btn wre-gal-link" href="#miniapp-qr" role="button"'
            ' data-full="/assets/img/miniapp-qr.png"'
            ' data-hover="1"'
            ' data-cap="微信小程序「悦读且住」 · 用微信扫码打开">微信小程序</a>',
            "微信里 · 读完复盘（无 AI）",
            "已上线：在微信里搜「悦读且住」就能打开，或点按钮扫码。复盘数据、阅读人格、行为报告，还能管理纸质书。合规精简版，不含 AI。",
        )

    # 开源地址（GitHub / Gitee）：与「安装到 Edge」同排、同款按钮
    src_items = [home_action_item(
        '<a class="home-btn" href="%s" target="_blank" rel="noopener">GitHub</a>' % html.escape(CONFIG["repoUrl"], quote=True),
        "源码仓库",
        "在 GitHub 上查看或下载源码，反馈问题、提建议也在这里。",
    )]
    if CONFIG.get("giteeUrl"):
        src_items.append(home_action_item(
            '<a class="home-btn" href="%s" target="_blank" rel="noopener">Gitee</a>' % html.escape(CONFIG["giteeUrl"], quote=True),
            "源码仓库 · 国内更快",
            "Gitee 是国内的源码镜像，访问和下载更快，适合国内网络。",
        ))

    # 副标：拆成「功能标签（chip）+ 一句结语」——tagline 形如「A、B、C——结语」
    tag_feats, tag_punch = (tagline.split("——", 1) + [""])[:2] if "——" in tagline else (tagline, "")
    feats = [f.strip() for f in re.split(r"[、,，/]", tag_feats) if f.strip()]
    chips = "".join('<span class="hero-chip">%s</span>' % inline(f, page) for f in feats)
    sub_html = ""
    if chips:
        sub_html += '    <div class="home-hero-chips">%s</div>\n' % chips
    if tag_punch.strip():
        sub_html += '    <p class="home-hero-sub">%s</p>\n' % inline(tag_punch.strip(), page)

    # 正文开头的 callout（作者的话）提到页面最顶部（大标题之前）
    body_src = page["body"]
    note_html = ""
    m = re.match(r"^(?:>[^\n]*\n)+\s*\n?", body_src)
    if m:
        note_html = render_markdown(m.group(0), page).strip()
        body_src = body_src[m.end():]

    hero = (
        '<section class="home-hero">\n'
        '  <div class="home-hero-text">\n'
        '    <h1 class="home-hero-title">%s</h1>\n'
        '%s'
        '    <div class="home-actions">%s%s%s%s%s</div>\n'
        '  </div>\n'
        '  %s\n'
        '</section>' % (inline(title, page), sub_html,
                         install_item, app_item, desktop_item, miniapp_item, " ".join(src_items), media)
    )

    # 愿景横幅：品牌绿底 + 白色书法大字，独立一块（参考「让天下没有难做的生意」式标语）
    vision = ""
    vision_text = page.get("visionText") or ""
    if vision_text:
        vision = (
            '<section class="home-vision">\n'
            '  <p class="home-vision__text">%s</p>\n'
            '</section>\n' % html.escape(vision_text)
        )

    # 「关于作者」区块：个人名片 + 作者的话合成一组（愿景横幅 + Hero 之后）
    note_block = ('\n' + note_html) if note_html else ''
    author_band = '<section class="author-band">\n%s%s\n</section>\n' % (render_card_embed(), note_block)

    body = render_markdown(body_src, page)
    return vision + hero + author_band + "\n" + body


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
    # 栏目名已由左侧栏标题展示，正文区不再重复输出 <h1>
    body = '<ul class="card-list">\n  <li>%s</li>\n</ul>' % "</li>\n  <li>".join(cards)
    return body


def render_account_page():
    """官网「我的账户」页：与 /app/ 网页版共用同一套账户与登录系统

    页面骨架（标题 + 空壳）由构建输出；交互逻辑在 /assets/account.js，
    该脚本直接 import 网页版（/app/src/）的 store / api / ui 模块，
    因此两端是同一份账户实现；又因官网在 /、网页版在 /app/（同域名同 origin，
    同一 localStorage），登录态天然互通，无需任何同步机制。
    """
    page = {
        "title": "我的账户",
        "url": "/account/",
        "description": "一个账户，处处通用：官网与网页版共用同一个账户码，Key 与昵称随账户跨设备同步。",
        "section": None,
        "updatedAt": "",
    }
    lead = ('一个账户，处处通用：官网与 <a href="/app/">网页版</a> 共用同一个账户码，'
            '微信读书 Key 与昵称都挂在你的账户下，换设备用账户码登录即可找回。')
    content = (
        '<p class="acct-lead">' + lead + '</p>'
        + '<div id="acctRoot" class="acct"><p class="acct-loading">正在读取账户信息…</p></div>'
        + '<script type="module" src="/assets/account.js"></script>'
    )
    out_file, url = slug_to_dist("account")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(render_layout(page, content, extra_class="has-account"), encoding="utf-8")
    GENERATED_URLS.add(url)


# --------------------------------------------------------------------------
# 打赏名单页（/donate/）——数据源 web/donate.json，作者手动登记
# --------------------------------------------------------------------------

DONATE_AVATAR_COLORS = ["#1a8917", "#2f6bff", "#e8663d", "#8a5cf6", "#0ea5a5", "#d9a441", "#d64545", "#5fbf5c"]


def fmt_amount(value):
    """金额格式化：整数不带小数，带小数最多两位并去掉末尾 0"""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "0"
    if abs(n - round(n)) < 1e-9:
        return str(int(round(n)))
    return ("%.2f" % n).rstrip("0").rstrip(".")


def avatar_color(name):
    """按昵称稳定取一个首字圆标底色（同一昵称颜色固定，匿名时同样稳定）"""
    n = 0
    for ch in str(name):
        n = (n * 31 + ord(ch)) & 0x7FFFFFFF
    return DONATE_AVATAR_COLORS[n % len(DONATE_AVATAR_COLORS)]


def load_donate():
    if not DONATE_JSON.exists():
        warn("未找到 donate.json，打赏名单页将显示为空")
        return {}
    try:
        return load_json(DONATE_JSON)
    except Exception as e:  # noqa: BLE001 —— 数据文件坏了不应中断整站构建
        warn("donate.json 解析失败：%s" % e)
        return {}


def render_donate_list(records):
    """打赏名单：按日期倒序，每条含首字圆标 / 昵称 / 金额 / 日期 / 留言，支持匿名"""
    if not records:
        return '<p class="donate-empty">还没有打赏记录。欢迎成为第一位支持者 ❤</p>'
    rows = []
    for r in sorted(records, key=lambda x: str(x.get("date") or ""), reverse=True):
        anon = r.get("anonymous") is True
        name = "匿名读者" if anon else (str(r.get("name") or "").strip() or "读者")
        amount = fmt_amount(r.get("amount"))
        date = str(r.get("date") or "").strip()
        msg = str(r.get("message") or "").strip()
        initial = "匿" if anon else (name[:1] or "读")
        meta = '<div class="donate-date">%s</div>' % html.escape(date) if date else ""
        message = '<p class="donate-msg">%s</p>' % html.escape(msg) if msg else ""
        rows.append(
            '<li class="donate-item">'
            '<span class="donate-avatar" style="background:{color}">{initial}</span>'
            '<div class="donate-main">'
            '<div class="donate-head"><span class="donate-name">{name}</span>'
            '<span class="donate-amount">￥{amount}</span></div>'
            '{meta}{message}'
            '</div></li>'.format(
                color=avatar_color(name), initial=html.escape(initial),
                name=html.escape(name), amount=html.escape(amount),
                meta=meta, message=message)
        )
    return '<ul class="donate-list">%s</ul>' % "".join(rows)


def render_donate_page():
    """官网「打赏名单」页：公开登记每一笔打赏（累积金额 / 笔数 / 名单）＋ 收款码

    数据全在 web/donate.json，由作者收到打赏后手动登记；本页只读取、渲染，不做任何网络请求。
    """
    data = load_donate()
    records = data.get("records") or []
    total = 0.0
    for r in records:
        try:
            total += float(r.get("amount") or 0)
        except (TypeError, ValueError):
            pass
    note = str(data.get("note") or "本名单由作者手动登记，每一笔打赏都会记上，欢迎监督。")
    updated = str(data.get("updatedAt") or "")

    page = {
        "title": "打赏名单",
        "url": "/donate/",
        "description": "微信悦读的打赏记录：所有支持都公开登记——谁支持了、支持了多少，一目了然。",
        "section": None,
        "updatedAt": updated,
    }

    stats = (
        '<div class="donate-stats">'
        '<div class="donate-stat"><span class="donate-stat__num">￥%s</span>'
        '<span class="donate-stat__label">累计打赏</span></div>'
        '<div class="donate-stat"><span class="donate-stat__num">%d</span>'
        '<span class="donate-stat__label">打赏笔数</span></div>'
        '</div>' % (html.escape(fmt_amount(total)), len(records))
    )

    pay = (
        '<h2>随喜支持</h2>'
        '<p>如果「微信悦读」帮到了你，欢迎扫码随喜，金额随意。收到后我会把每一笔都记进下面的名单里，做到公开透明。</p>'
        '<div class="donate-codes">'
        '<div class="donate-code"><img src="/assets/img/donate/wechat.png" alt="微信收款码" loading="lazy"><span>微信</span></div>'
        '<div class="donate-code"><img src="/assets/img/donate/alipay.png" alt="支付宝收款码" loading="lazy"><span>支付宝</span></div>'
        '</div>'
    )

    note_line = html.escape(note)
    if updated:
        note_line += "（更新于 %s）" % html.escape(updated)

    content = (
        article_header(page)
        + '<p class="donate-lead">谢谢每一个支持「微信悦读」的人。这里把收到的每一笔打赏都公开记下来——'
        + '谁支持了、支持了多少，清清楚楚。产品永久免费、无广告，打赏纯属随喜。</p>'
        + stats
        + pay
        + '<h2>打赏名单</h2>'
        + '<p class="donate-note">' + note_line + '</p>'
        + render_donate_list(records)
    )

    out_file, url = slug_to_dist("donate")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(render_layout(page, content, extra_class="has-donate"), encoding="utf-8")
    GENERATED_URLS.add(url)


def parse_changelog_latest():
    """从「更新日志.md」取最新一节：日期 / 一句说明

    版本号不在这里取——全站版本号只有一个事实源，就是仓库根 manifest.json
    （页脚、dist/api/latest.json 都用它），所以不做「更新日志 vs manifest」的一致性校验。
    """
    page = next((p for p in PAGES if p["base_slug"] == "changelog"), None)
    fallback = (VERSION, date.today().isoformat(), "")
    if not page:
        warn("未找到「更新日志.md」，latest.json 的更新说明留空")
        return fallback

    lines = page["body"].split("\n")
    released, notice = "", ""
    for i, line in enumerate(lines):
        m = re.match(r"^##\s+(.*)$", line.strip())
        if not m:
            continue
        head = m.group(1)
        dm = re.search(r"(\d{4}-\d{2}-\d{2})", head)
        released = dm.group(1) if dm else ""
        for follow in lines[i + 1:]:
            if follow.strip().startswith("#"):
                break
            text = follow.strip().lstrip("-*").strip()
            if text:
                notice = re.sub(r"\*\*|`", "", text)
                break
        break

    return (VERSION, released or page["updatedAt"] or fallback[1], notice)


def write_latest_json():
    version, released, notice = parse_changelog_latest()
    stores = {k: v for k, v in (CONFIG.get("storeUrls") or {}).items() if v}
    data = {
        "latestVersion": version,
        "releasedAt": released,
        "minSupportedVersion": CONFIG.get("minSupportedVersion", ""),
        "notice": notice or ("v%s 已发布" % version),
        "changelogUrl": CONFIG["baseUrl"].rstrip("/") + "/docs/changelog/",
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


def copy_app():
    """把网页版（h5/）整份拷到 dist/app/，与官网同域发布（线上地址 /app/）

    H5 全用相对路径 + hash 路由，且 sw.js / manifest 也是相对注册，
    因此放进子目录即可，作用范围自动收在 /app/ 内，不影响官网。
    必须在 dist 清空之后调用。
    """
    if not APP.exists():
        warn("未找到网页版目录 h5/，跳过（线上将没有 /app/）")
        return
    dst = DIST / APP_DIR
    count = 0
    for item in sorted(APP.rglob("*")):
        rel = item.relative_to(APP)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if rel.as_posix() in APP_SKIP:
            continue
        target = dst / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            count += 1
    print("   📱 网页版（H5）：%d 个文件 → dist/%s/" % (count, APP_DIR))


def generate_thumbnails():
    """为图库原图生成缩略图（需 Pillow；缺失则跳过，页面退回原图，构建照常）"""
    global THUMB_AVAILABLE
    src_dir = ASSETS / "img" / "gallery"
    if not src_dir.exists():
        return
    try:
        from PIL import Image
    except ImportError:
        warn("未安装 Pillow，跳过图库缩略图（页面将直接加载原图，体积较大）")
        return

    out_dir = DIST / "assets" / "img" / "gallery" / GALLERY_THUMB_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for f in sorted(src_dir.iterdir()):
        if not f.is_file() or f.name.startswith("."):
            continue
        if f.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            continue
        try:
            im = Image.open(f)
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            else:
                im = im.convert("RGB")
            im.thumbnail((GALLERY_THUMB_MAX, GALLERY_THUMB_MAX), Image.LANCZOS)
            im.save(out_dir / (f.stem + ".jpg"), "JPEG",
                    quality=GALLERY_THUMB_QUALITY, optimize=True)
            count += 1
        except Exception as e:  # noqa: BLE001 —— 单图失败不应中断构建
            warn("缩略图生成失败：%s（%s）" % (f.name, e))

    if count:
        THUMB_AVAILABLE = True
        print("   🖼 图库缩略图：%d 张 → dist/assets/img/gallery/%s/" % (count, GALLERY_THUMB_DIR))
    else:
        warn("图库未生成任何缩略图，页面将直接加载原图")


def check_duplicates():
    seen = {}
    for p in PAGES:
        if p["draft"]:
            continue
        if p["url"] in seen:
            warn("slug 重复：%s 与 %s 都指向 %s" % (p["rel"], seen[p["url"]], p["url"]))
        else:
            seen[p["url"]] = p["rel"]
        if p["base_slug"] not in ("", "/") and not p["description"]:
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

    # 资源与图库缩略图（须先于页面渲染：渲染时按缩略图可用性决定引用）
    copy_assets()
    generate_thumbnails()
    copy_app()

    # 1) 页面：官网页（含首页）用 layout.html；帮助文档页用 docs.html（VuePress 版式）
    # 部分页面名已由顶部导航体现，正文区不再重复输出大标题
    no_main_title = {"gallery", "faq", "changelog", "start", "about"}
    for p in PAGES:
        if p["base_slug"] == "":
            # 首页：大图落地页（Hero + 功能大图区 + CTA），开启滚动渐入
            p["reveal"] = True
            html_text = render_layout(p, render_home(p), extra_class="home")
        elif p["base_slug"] in SITE_SLUGS:
            body_html = render_markdown(p["body"], p)
            content = ("" if p["base_slug"] in no_main_title else article_header(p)) + body_html
            # 「创作手记」独立页用专属窄栏排版（见 site.css 的 .essay）
            if p["base_slug"] == "essay":
                extra_class = "essay"
            elif p["section"]:
                extra_class = "has-sidebar"
            else:
                extra_class = ""
            html_text = render_layout(p, content, extra_class=extra_class)
        else:
            # 帮助文档页（/docs/…）：标题 + 正文
            content = article_header(p) + render_markdown(p["body"], p)
            html_text = render_docs_layout(p, content)
        write_page(p["out_file"], html_text, p["url"])

    # 2) 帮助文档站：栏目索引页 + 文档站首页
    for sec in CONFIG["sections"]:
        render_docs_section_index(sec)
    render_docs_home()

    # 2.5) 官网「我的账户」页（与 /app/ 网页版共用同一套账户）
    render_account_page()

    # 2.6) 官网「打赏名单」页（数据源 web/donate.json）
    render_donate_page()

    # 2.7) 旧地址 -> /docs/ 新地址：自动跳转，保住已发布/已收藏的链接
    for p in PAGES:
        if p["base_slug"] and p["base_slug"] not in SITE_SLUGS:
            old_url = "/%s/" % p["base_slug"]
            if old_url != p["url"]:
                write_redirect(old_url, p["url"], p["title"])
    for sec in CONFIG["sections"]:
        old_url = "/%s/" % sec["key"]
        if old_url != section_url(sec):
            write_redirect(old_url, section_url(sec), sec["title"])

    # 3) 公告、死链检查
    latest = write_latest_json()
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
