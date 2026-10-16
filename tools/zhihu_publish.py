#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""半自动发布「知乎」回答 / 文章（正文走整段粘贴，保留换行）。

为什么有这条脚本
    知乎没有发布 API，页面操作只能靠浏览器。本脚本用「系统真实 Chrome 带调试端口
    启动 + Playwright 经 CDP 连上」的方式驱动（直接用 Playwright 启动会被知乎
    识别成自动化、问题页返回 code 40362），把「打开问题 → 写回答 → 传图 → 填正文」
    自动化，正文用「整段剪贴板粘贴」保证换行不被挤成一坨（与小红书同一套做法）。

流程
    1. 脚本打开知乎（浏览器窗口弹出）
    2. 你登录一次（扫码 / 账号），登录态存进 .autoshot/zhihu-profile/，之后免登
    3. 脚本自动：找到目标问题 → 点「写回答」→ 粘贴正文 → 上传该篇配图
    4. 停在「发布」前（默认），你核对后自己点；加 --publish 则由脚本点「发布」

正文来源：marketing/知乎/知乎文案.md（单一事实源）+ §0 统一引导语。
配图来源：marketing/知乎/帖子/<篇号>-<短标题>/（由 tools/zhihu_post_folders.py 生成）。

用法
    python3 tools/zhihu_publish.py --find                 # 搜目标问题，列出候选问题链接
    python3 tools/zhihu_publish.py --post 篇1 --url <问题网址>            # 填好后停在发布前
    python3 tools/zhihu_publish.py --post 篇1 --url <问题网址> --publish  # 连发布一起点
    python3 tools/zhihu_publish.py --post 篇1 --dry       # 只打印将发布的内容

依赖
    python3 -m pip install --user playwright
"""

import argparse
import os
import re
import socket
import subprocess
import sys
import time
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROFILE = os.path.join(ROOT, ".autoshot", "zhihu-profile")
ZHIHU_DIR = os.path.join(ROOT, "marketing", "知乎")
POSTS_DIR = os.path.join(ZHIHU_DIR, "帖子")
TEXT_FILE = os.path.join(ZHIHU_DIR, "知乎文案.md")

WAIT_LOGIN_SEC = 900
# type=question 直接只列「问题」，避免命中一堆专栏文章
SEARCH_URL = "https://www.zhihu.com/search?type=question&q="
WRITE_URL = "https://zhuanlan.zhihu.com/write"

# 知乎风控会识别 Playwright 启动的浏览器（问题页直接返回 code 40362），
# 因此改为：用系统真实 Chrome 正常启动（带调试端口），Playwright 再经 CDP 连上去。
REAL_BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
DEBUG_PORT = 9222


# ------------------------------------------------------------------ 读文案

def _md():
    with open(TEXT_FILE, encoding="utf-8") as fh:
        return fh.read()


def _norm_pid(pid):
    """把 1 / 篇1 / 篇 1 统一成 篇\\s*1 的正则片段。"""
    n = re.search(r"\d+", pid).group(0)
    return r"篇\s*%s" % n


def _block_after(md, keyword, pos=0):
    """取包含 keyword 的分段里、code fence 的第一块（用于取「统一引导语」等）。"""
    for sec in re.split(r"\n(?=#{2,4} )", md):
        if keyword in sec.split("\n", 1)[0]:
            m = re.search(r"```\n(.*?)\n```", sec, re.S)
            if m:
                return m.group(1).strip()
    return ""


def load_post(pid):
    """按篇号抽 问题 / 标题 / 正文（正文＝配图行之前最近的那个代码块）。"""
    md = _md()
    pat = re.compile(
        r"^\*\*配图（\d+\s*张[^）]*）\s*·\s*(%s)\s*·\s*([^*]+?)\*\*\s*[：:]" % _norm_pid(pid),
        re.M,
    )
    m = pat.search(md)
    if not m:
        raise SystemExit("❌ 文案里找不到 %s 的「配图」行，请检查格式。" % pid)
    title_short = m.group(2).strip()

    # 该篇所在的分段（追溯到上一个 ## 标题）
    start = md.rfind("\n## ", 0, m.start())
    section = md[start if start >= 0 else 0:m.start()]

    m_q = re.search(r"\*\*问题\*\*：(.+)", section)
    m_t = re.search(r"\*\*标题\*\*：(.+)", section)
    question = m_q.group(1).strip() if m_q else None
    heading = m_t.group(1).strip() if m_t else None

    blocks = re.findall(r"```\n(.*?)\n```", section, re.S)
    if not blocks:
        raise SystemExit("❌ 该篇没有正文代码块，请检查文案格式。")
    body = blocks[-1].strip()

    guide = _block_after(md, "每题统一「结尾引导语」")
    tail = _block_after(md, "评论区置顶")
    full_body = body + ("\n\n" + guide if guide else "")

    folder = os.path.join(POSTS_DIR, "%s-%s" % (_norm_pid(pid).replace(r"\s*", ""), title_short))
    images = []
    if os.path.isdir(folder):
        images = [os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith(".png")]
    return {
        "pid": pid, "short": title_short, "question": question, "heading": heading,
        "body": full_body, "guide": guide, "tail": tail, "images": images,
    }


# ------------------------------------------------------------------ 页面操作

_JS_CLICK_TEXT = """(label) => {
  const ok = (e) => {
    const t = e.textContent.trim();
    return t === label || t.includes(label);
  };
  const cands = [...document.querySelectorAll('button, a, [role="button"], div, span')]
    .filter(ok)
    .filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    // 取「最短文本」的节点：最贴近按钮本身，避免点到整块容器
    .sort((a, b) => a.textContent.length - b.textContent.length);
  for (const e of cands) {
    const target = e.closest('button, a, [role="button"]') || e;
    target.click();
    return true;
  }
  return false;
}"""


def _click_text(page, label, timeout=3000):
    try:
        return bool(page.evaluate(_JS_CLICK_TEXT, label))
    except Exception:
        return False


def _dump_buttons(page):
    """没找到按钮时，打印页面上所有可见的按钮 / 链接文字，便于排查。"""
    try:
        rows = page.eval_on_selector_all(
            "button, a, [role='button']",
            "els => els.map(e => e.textContent.trim()).filter(t => t && t.length < 20)",
        )
        uniq = list(dict.fromkeys(rows))
        print("   页面上的按钮/链接文字（前 40 个）：%s" % " | ".join(uniq[:40]))
    except Exception:
        pass


LOGIN_SHOT = os.path.join(ROOT, ".autoshot", "zhihu-state.png")


def _logged_in(page):
    """已登录判定：右上角有个人中心入口；未登录会显示「登录/注册」。

    注意别再拿页面里任意 Avatar 图片当依据——未登录时登录按钮也带头像图标，
    会误判成已登录（曾因此空点「发布」）。
    """
    try:
        if page.locator('.AppHeader-profile, .AppHeader-userInfo, .AppHeader-avatar').count() > 0:
            return True
    except Exception:
        pass
    try:
        header = page.locator('.AppHeader').first
        if header.count() > 0 and header.get_by_text("登录/注册").count() > 0:
            return False
    except Exception:
        pass
    try:
        return page.locator('.AppHeader a[href^="/people/"], .AppHeader img[class*="Avatar"]').count() > 0
    except Exception:
        return False


def _ensure_login(page, timeout=WAIT_LOGIN_SEC):
    """未登录时，在已打开的浏览器窗口里等用户扫码登录。"""
    if _logged_in(page):
        return True
    print("\n👉 需要登录知乎：请在浏览器窗口里扫码 / 账号登录（登录态会存进 .autoshot/zhihu-profile/，之后免登）。")
    print("   登录成功后脚本会自动继续……\n")
    _click_text(page, "登录/注册")            # 主动弹出登录框，方便扫码
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _logged_in(page):
            print("  ✓ 已检测到登录态。")
            page.wait_for_timeout(2000)
            return True
        try:
            page.screenshot(path=LOGIN_SHOT)
        except Exception:
            pass
        page.wait_for_timeout(4000)
    raise SystemExit("❌ 等待登录超时（%d 秒）。可重跑本脚本再试。" % WAIT_LOGIN_SEC)


def wait_login(page):
    return _ensure_login(page)


def _pure_question_links(page):
    """从当前页面里挑出问题链接（/question/NNN，含 /answer/MMM 后缀也收）。"""
    links = page.eval_on_selector_all(
        "a[href]", "els => els.map(e => [e.textContent.trim(), e.href])"
    )
    seen, rows = set(), []
    for text, href in links:
        m = re.match(r"https://www\.zhihu\.com/question/(\d+)", href.split("?")[0])
        if not m:
            continue
        link = "https://www.zhihu.com/question/%s" % m.group(1)
        if link in seen:
            continue
        seen.add(link)
        rows.append((text or "(无标题)", link))
    return rows


def find_question(page, query):
    """打开知乎「问题」搜索结果，列出候选问题链接。"""
    page.goto(SEARCH_URL + quote(query), wait_until="domcontentloaded")
    wait_login(page)
    page.wait_for_timeout(3500)
    rows = _pure_question_links(page)
    # 结果没出来时：切一次「问题」页签 + 滚动，尽量让卡片渲染
    if not rows:
        _click_text(page, "问题")
        page.wait_for_timeout(1500)
        page.mouse.wheel(0, 1200)
        page.wait_for_timeout(2500)
        rows = _pure_question_links(page)
    try:
        page.screenshot(path=LOGIN_SHOT, full_page=True)
    except Exception:
        pass
    if not rows:
        print("⚠️ 没抓到「问题」候选；已存一张当前页面截图：%s"
              % os.path.relpath(LOGIN_SHOT, ROOT))
        return
    print("\n候选问题（挑一个，用 --url 传它的网址）：\n")
    for i, (title, link) in enumerate(rows[:15], 1):
        print("  %2d. %s\n      %s" % (i, title, link))
    print()


def _copy_to_clipboard(text):
    try:
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return True
    except Exception:
        return False


def _editor(page, selectors, timeout=15000):
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        for sel in selectors:
            loc = page.locator(sel)
            if loc.count() > 0:
                return loc.last
        page.wait_for_timeout(500)
    return None


def fill_body(page, text, label="正文"):
    ed = _editor(page, ['div[contenteditable="true"]', ".public-DraftEditor-content", "textarea"])
    if ed is None:
        print("  ⚠️ 没找到正文编辑区，请手动粘贴正文。")
        return False
    ed.click()
    page.wait_for_timeout(400)
    mod = "Meta" if sys.platform == "darwin" else "Control"
    if _copy_to_clipboard(text):
        page.keyboard.press("%s+a" % mod)
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        page.keyboard.press("%s+v" % mod)
        page.wait_for_timeout(1200)
        print("  ✓ %s已整段粘贴（%d 字，保留换行）" % (label, len(text)))
        return True
    ed.press_sequentially(text, delay=0)
    print("  ✓ %s已逐字填入（未走剪贴板）" % label)
    return True


def _image_input(page):
    """找知乎编辑器里 accept 含 image/ 的隐藏 file input（真正的传图入口）。"""
    inputs = page.locator('input[type="file"]')
    for i in range(inputs.count()):
        el = inputs.nth(i)
        if "image/" in (el.get_attribute("accept") or ""):
            return el
    return None


def upload_images(page, files):
    """把该篇配图塞进编辑器。

    ⚠️ 踩坑记录（2026-10-14）：工具栏「图片」按钮会开下拉、且常被浮层
    （css-4cffwv）挡住，get_by_text / 真点击都唤不起文件框，导致「配图看着传了、
    其实一张没进」。实测最稳的是直接对 accept 含 image/ 的隐藏 file input
    做 set_input_files；之后再轮询等图真的渲染进编辑器，才允许点发布。
    """
    if not files:
        print("  ⚠️ 本篇没有配图，跳过。")
        return False
    done = False
    el = _image_input(page)
    if el is not None:
        el.set_input_files(files)
        done = True
    else:
        try:
            with page.expect_file_chooser(timeout=8000) as fc:
                if not (_click_text(page, "图片") or _click_text(page, "上传图片")):
                    page.click('button[aria-label="图片"]', timeout=3000)
            fc.value.set_files(files)
            done = True
        except Exception:
            pass
    if not done:
        print("  ⚠️ 没找到图片上传入口，请在浏览器里手动传图。")
        return False
    ed = _editor(page, ['div[contenteditable="true"]', ".public-DraftEditor-content"], timeout=4000)
    for _ in range(20):
        page.wait_for_timeout(2000)
        if ed is not None and ed.locator("img").count() >= len(files):
            break
    got = ed.locator("img").count() if ed is not None else -1
    print("  ✓ 已提交 %d 张配图（编辑器内已见 %d 张）…" % (len(files), got))
    return got >= len(files)


def _blocked(page):
    """判断当前是不是被知乎风控拦了（返回 code 40362 的错误 JSON 页）。"""
    try:
        html = page.content()
    except Exception:
        return False
    return "40362" in html or "请求存在异常" in html


def _pick_page(ctx):
    """挑一个知乎标签页用；没有就新开一个。"""
    for p in ctx.pages:
        if "zhihu.com" in (p.url or ""):
            return p
    return ctx.pages[0] if ctx.pages else ctx.new_page()


def _open_question(ctx, url, query):
    """打开问题页，返回承载该页的 page。

    先带站内 referer 直接访问；万一被风控拦成 code 40362，
    再退回「站内搜索 → 点结果链接」这条路径。
    """
    page = _pick_page(ctx)
    page.goto(url, wait_until="domcontentloaded",
              referer="https://www.zhihu.com/")
    page.wait_for_timeout(3500)
    if not _blocked(page):
        return page

    qid = re.search(r"/question/(\d+)", url).group(1)
    page.goto(SEARCH_URL + quote(query), wait_until="domcontentloaded")
    page.wait_for_timeout(3500)
    sel = 'a[href*="/question/%s"]' % qid
    loc = page.locator(sel).first
    if loc.count() == 0:                       # 结果还没渲染，滚一下再找
        page.mouse.wheel(0, 1500)
        page.wait_for_timeout(2500)
        loc = page.locator(sel).first
    before = len(ctx.pages)
    try:
        loc.scroll_into_view_if_needed(timeout=4000)
    except Exception:
        pass
    loc.click(timeout=6000)
    page.wait_for_timeout(2500)
    if len(ctx.pages) > before:                # 结果在新标签打开
        page = ctx.pages[-1]
        try:
            page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:
            pass
    page.wait_for_timeout(2500)
    return page


def publish_answer(ctx, post, do_publish):
    """在问题页写回答并（可选）发布，返回 (是否已发布, page)。"""
    page = _open_question(ctx, post["url"], post["question"] or post["short"])
    if _blocked(page):
        try:
            page.screenshot(path=LOGIN_SHOT)
        except Exception:
            pass
        raise SystemExit("❌ 问题页被知乎风控拦截（code 40362）；"
                         "截图见 .autoshot/zhihu-state.png，可稍后重试。")

    _ensure_login(page)                       # 未登录就先等扫码，别空点

    opened = False
    for label in ("写回答", "回答问题", "回答"):
        if _click_text(page, label):
            opened = True
            print("  ✓ 已点开回答编辑器（按钮：%s）" % label)
            break
    if not opened:
        try:
            page.screenshot(path=LOGIN_SHOT)
        except Exception:
            pass
        _dump_buttons(page)
        raise SystemExit("❌ 没找到「写回答」按钮；截图见 .autoshot/zhihu-state.png")
    page.wait_for_timeout(3000)

    # 填不上正文 / 传不了图时，宁可不发，也不发空回答（曾直接空点「发布」）
    if not fill_body(page, post["body"]):
        raise SystemExit("❌ 正文没填上（编辑器没找到？），已停止且未点发布。")
    if not upload_images(page, post["images"]):
        raise SystemExit("❌ 配图没传上，已停止且未点发布；请在浏览器里手动补图后自行发布。")

    if not do_publish:
        print("\n✅ 已填好，停在「发布回答」前。你在浏览器里核对图片 / 正文后自己点发布。")
        return False, page
    if _click_text(page, "发布回答"):
        print("  ✓ 已点「发布回答」，等待发布完成…")
        page.wait_for_timeout(6000)
        print("  ✓ 当前网址：%s" % page.url)
        return True, page
    print("  ⚠️ 没找到「发布回答」按钮，请在浏览器里手动点发布。")
    return False, page


def publish_article(page, post, do_publish):
    """写文章（专栏）并（可选）发布。"""
    page.goto(WRITE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    title = post["heading"] or post["short"]
    try:
        page.fill('textarea[placeholder*="标题"], input[placeholder*="标题"]', title, timeout=5000)
        print("  ✓ 标题：%s" % title)
    except Exception:
        print("  ⚠️ 没找到标题框，请手动填：%s" % title)
    fill_body(page, post["body"])
    upload_images(page, post["images"])
    if not do_publish:
        print("\n✅ 已填好，停在「发布」前。你在浏览器里核对后自己点发布。")
        return False
    if _click_text(page, "发布"):
        print("  ✓ 已点「发布」…")
        page.wait_for_timeout(6000)
        return True
    print("  ⚠️ 没找到「发布」按钮，请手动点。")
    return False


def _click_exact(page, label):
    """只点文本完全等于 label 的元素（子串匹配会误点「添加评论」这类）。"""
    try:
        return bool(page.evaluate(
            """(label) => {
              const els = [...document.querySelectorAll('button, [role="button"], a')]
                .filter(e => e.textContent.trim() === label
                             && e.getBoundingClientRect().width > 0);
              if (!els.length) return false;
              els[0].click();
              return true;
            }""", label))
    except Exception:
        return False


def post_comment(page, text):
    """在回答下方留「入口提示」评论（置顶需你手动点「…→置顶」）。"""
    if not text:
        return
    try:
        page.wait_for_timeout(1500)
        # 评论区在回答页最底部：先滚到底，输入框才会渲染出来
        for _ in range(10):
            page.mouse.wheel(0, 1000)
            page.wait_for_timeout(300)
        if page.locator("[contenteditable='true']").count() == 0:
            # 「添加评论」文本带零宽字符（\u200b），用 contains 匹配 + 真·点击展开
            try:
                btn = page.get_by_text("添加评论", exact=False).first
                btn.scroll_into_view_if_needed(timeout=3000)
                btn.click(timeout=4000)
            except Exception:
                _click_text(page, "添加评论")
            page.wait_for_timeout(2000)
        ed = _editor(page, ['div[contenteditable="true"]'], timeout=8000)
        if ed is None:
            print("  ⚠️ 没找到评论框，请手动发评论区置顶（内容见知乎文案 §0）。")
            return
        ed.click()
        if _copy_to_clipboard(text):
            mod = "Meta" if sys.platform == "darwin" else "Control"
            page.keyboard.press("%s+v" % mod)
            page.wait_for_timeout(1000)
        else:
            ed.press_sequentially(text, delay=0)
        if _click_exact(page, "发布") or _click_exact(page, "评论"):
            print("  ✓ 已提交评论区入口提示；请在评论里点「…→置顶」。")
        else:
            print("  ⚠️ 评论已填，请手动点发布并置顶。")
    except Exception as exc:
        print("  ⚠️ 评论区自动填写失败：%s（请手动发 §0 的置顶评论）" % exc)


# ------------------------------------------------------------------ 主流程

def _port_open(port=DEBUG_PORT):
    s = socket.socket()
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _ensure_chrome():
    """确保有「带调试端口的真实 Chrome」在跑，供 Playwright 经 CDP 连上。

    直接用 Playwright 启动会带自动化特征，知乎问题页会被拦成 code 40362；
    换成正常启动的系统 Chrome（只挂一个调试端口）就没有这个问题。
    """
    if _port_open():
        return True
    exe = next((p for p in REAL_BROWSERS if os.path.exists(p)), None)
    if exe is None:
        raise SystemExit("❌ 没找到系统 Chrome / Edge，无法走 CDP 方案。")
    os.makedirs(PROFILE, exist_ok=True)
    print("  启动浏览器：%s（调试端口 %d）" % (exe, DEBUG_PORT))
    subprocess.Popen(
        [exe, "--remote-debugging-port=%d" % DEBUG_PORT,
         "--user-data-dir=%s" % PROFILE,
         "--no-first-run", "--no-default-browser-check",
         "https://www.zhihu.com/"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(30):
        time.sleep(1)
        if _port_open():
            return True
    raise SystemExit(
        "❌ 浏览器没打开调试端口。若弹出的是「已在现有会话中打开」，"
        "请先把用同一下载目录开着的 Chrome 窗口全部关掉再重跑。")


def main():
    ap = argparse.ArgumentParser(description="半自动发布知乎回答 / 文章")
    ap.add_argument("--post", default="篇1", help="发哪一篇（篇1…篇8），默认 篇1")
    ap.add_argument("--url", help="目标问题网址（回答必填；--find 可先找）")
    ap.add_argument("--find", action="store_true", help="只搜目标问题并列出候选链接")
    ap.add_argument("--publish", action="store_true", help="连「发布」一起点（默认停在发布前）")
    ap.add_argument("--dry", action="store_true", help="只打印将发布的内容，不打开浏览器")
    args = ap.parse_args()

    post = load_post(args.post)
    print("将发布：%s（%s）" % (args.post, post["short"]))
    if post["question"]:
        print("  问题：%s" % post["question"])
    if post["heading"]:
        print("  标题：%s" % post["heading"])
    print("  配图：%d 张（%s）" % (len(post["images"]), "、".join(os.path.basename(f) for f in post["images"]) or "无"))
    print("  正文：%d 字" % len(post["body"]))
    if args.dry:
        print("\n---- 正文 ----\n%s\n---- 置顶评论 ----\n%s" % (post["body"], post["tail"]))
        return
    if not (args.url or args.find):
        raise SystemExit("❌ 回答/文章都要 --url（目标问题网址）；可先跑 --find 找问题。")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ 未安装 Playwright。请先执行：\n   python3 -m pip install --user playwright")

    post["url"] = args.url
    _ensure_chrome()
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % DEBUG_PORT)
        ctx = browser.contexts[0]
        page = _pick_page(ctx)
        try:
            if args.find:
                find_question(page, post["question"] or post["short"])
                return
            elif args.url.startswith(WRITE_URL):
                publish_article(page, post, args.publish)
            else:
                published, page = publish_answer(ctx, post, args.publish)
                if published:
                    post_comment(page, post["tail"])
        except SystemExit:
            raise
        except Exception as exc:
            print("\n⚠️ 自动填写中断：%s" % exc)
            print("   浏览器保持打开，可手动补完；内容见 marketing/知乎/知乎文案.md。\n")

        print("\n👉 浏览器是独立启动的真实 Chrome，核对后自己关掉窗口即可。\n")


if __name__ == "__main__":
    main()
