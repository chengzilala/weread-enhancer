#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""接管浏览器，修改「已发布」的小红书图文笔记（重传配图）。

用法：
    python3 tools/xhs_edit.py --list-notes                       # 列出笔记管理页的笔记
    python3 tools/xhs_edit.py --probe --post A2 --index 0        # 只导出编辑页结构，不修改
    python3 tools/xhs_edit.py --post A2 --index 0                # 删旧图 → 按 帖子/A2-*/01- 02- … 重传

说明：
  --post  是「帖子/」下的文件夹编号（A2 / 主推 …）
  --index 是笔记管理页里的卡片序号（列表按发布时间倒序，见 --list-notes 输出）

安全闸：脚本跑到「发布笔记」前停下，最后一下由用户点，脚本绝不代替提交。
"""

import argparse
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from autoshot import ensure_browser  # noqa: E402

PROFILE = os.path.join(ROOT, ".autoshot", "xhs-profile")
MANAGER_URL = "https://creator.xiaohongshu.com/new/note-manager"
UPDATE_URL = "https://creator.xiaohongshu.com/publish/update?id=%s&noteType=normal"
POSTS_DIR = os.path.join(ROOT, "marketing", "小红书", "帖子")

WAIT_LOGIN_SEC = 600


def _log(msg):
    print(msg, flush=True)


def _ensure_ready(page, timeout=40):
    """等页面出现笔记卡片（管理页）或图片编辑区（编辑页）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if page.locator(".note-card").count() or page.locator(".img-list").count():
            return True
        page.wait_for_timeout(1000)
    return False


def wait_login(page):
    _log("\n👉 需要登录：请在弹出的浏览器里扫码登录（登录态会存进 .autoshot/xhs-profile/）。")
    deadline = time.time() + WAIT_LOGIN_SEC
    while time.time() < deadline:
        if page.locator(".note-card").count() or page.locator(".img-list").count():
            return True
        page.wait_for_timeout(2000)
    raise SystemExit("❌ 等待登录超时。")


# ------------------------------------------------------------------ 列笔记

def list_notes(page):
    page.goto(MANAGER_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    if not page.locator(".note-card").count():
        wait_login(page)
    cards = page.locator(".note-card")
    n = cards.count()
    _log("\n笔记管理页共 %d 篇（序号用于 --index）：\n" % n)
    for i in range(n):
        try:
            txt = " | ".join(cards.nth(i).inner_text().split("\n"))[:72]
        except Exception:
            txt = "(读取失败)"
        _log("[%d] %s" % (i, txt))


# ------------------------------------------------------------------ 解析 noteId

def resolve_note_id(ctx, page, index=None, title_kw=None):
    """去管理页点第 index 张卡片的「编辑」，从地址栏读 noteId。"""
    page.goto(MANAGER_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    if not page.locator(".note-card").count():
        wait_login(page)
    cards = page.locator(".note-card")
    n = cards.count()
    if index is None:
        idx = None
        for i in range(n):
            try:
                if title_kw and title_kw in cards.nth(i).inner_text():
                    idx = i
                    break
            except Exception:
                continue
        if idx is None:
            raise SystemExit("❌ 没找到含「%s」的笔记。" % title_kw)
        index = idx
    if index >= n:
        raise SystemExit("❌ 序号 %d 超出范围（共 %d 篇）。" % (index, n))
    card = cards.nth(index)
    card.hover()
    page.wait_for_timeout(600)
    btns = card.locator(".note-card__action-btn")
    _log("\n管理页第 %d 篇：%s" % (index, " | ".join(card.inner_text().split("\n"))[:60]))
    _log("  操作图标数 %d（第 4 个 = 编辑）" % btns.count())
    btns.nth(3).click()
    page.wait_for_timeout(5000)
    for p in reversed(ctx.pages):
        m = re.search(r"[?&]id=([0-9a-f]{24})", p.url)
        if m and "update" in p.url:
            _log("  → 编辑页 noteId = %s" % m.group(1))
            return m.group(1), p
    m = re.search(r"[?&]id=([0-9a-f]{24})", page.url)
    if m:
        return m.group(1), page
    return None, page


# ------------------------------------------------------------------ 探查

def probe(page, note_id):
    page.goto(UPDATE_URL % note_id, wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    _log("当前地址：%s" % page.url)
    html = page.locator(".img-list").first.evaluate("el => el.outerHTML") if page.locator(".img-list").count() else page.content()
    _log("\n===== 图片编辑区 HTML（前 4000 字）=====\n%s" % html[:4000])
    _log("\n===== 每张缩略图控件 =====")
    info = page.evaluate(
        """() => [...document.querySelectorAll('.pr')].map((pr, i) => ({
              idx: (pr.querySelector('.img-idx') || {}).textContent,
              close: !!pr.querySelector('.close-btn'),
              edit: !!pr.querySelector('.edit-btn'),
              visible: pr.getBoundingClientRect().height > 0,
           }))"""
    )
    for it in info:
        _log("  " + str(it))
    _log("\n===== 底部按钮 =====")
    for b in page.evaluate(
        """() => [...document.querySelectorAll('button')].map(e => e.className + ' :: ' + e.textContent.trim()).slice(0, 30)"""
    ):
        _log("  " + b)


# ------------------------------------------------------------------ 取新图

def post_images(key):
    folders = [d for d in os.listdir(POSTS_DIR) if os.path.isdir(os.path.join(POSTS_DIR, d))]
    hits = [d for d in folders if d == key or d.startswith(key + "-")]
    if not hits:
        raise SystemExit("❌ 帖子/ 下找不到编号 %s。现有：%s" % (key, "、".join(sorted(folders))))
    folder = os.path.join(POSTS_DIR, sorted(hits, key=len)[0])
    files = sorted(
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    )
    _log("\n新图来自：%s（%d 张）" % (os.path.relpath(folder, ROOT), len(files)))
    for f in files:
        _log("   " + os.path.basename(f))
    return files


# ------------------------------------------------------------------ 换图

_JS_DELETE_FIRST = """() => {
  const pr = document.querySelector('.pr');
  if (!pr) return 'no-pr';
  const btn = pr.querySelector('.close-btn');
  if (!btn) return 'no-btn';
  try { btn.click(); } catch (e) {}
  btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
  return 'ok';
}"""

_JS_CLICK_TEXT = """(label) => {
  const all = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim() === label);
  const vis = all.find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || all[all.length - 1];
  if (!vis) return false;
  vis.click();
  return true;
}"""


_JS_FIRST_SRC = """() => { const im = document.querySelector('.pr img.preview'); return im ? im.getAttribute('src') : ''; }"""

_JS_DELETE_BY_SRC = """(src) => {
  const pr = [...document.querySelectorAll('.pr')].find(
    p => { const im = p.querySelector('img.preview'); return im && im.getAttribute('src') === src; });
  if (!pr) return 'not-found';
  const btn = pr.querySelector('.close-btn');
  if (!btn) return 'no-btn';
  try { btn.click(); } catch (e) {}
  btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
  return 'ok';
}"""


def _count_pr(page):
    try:
        return page.locator(".pr").count()
    except Exception:
        return -1


def _delete_first(page):
    """删掉列表里的第一张（返回删除后的张数）。"""
    n = _count_pr(page)
    if n <= 0:
        return n
    res = page.evaluate(_JS_DELETE_FIRST)
    page.wait_for_timeout(800)
    n2 = _count_pr(page)
    if res != "ok":
        _log("    ⚠️ 删除返回：%s" % res)
    return n2


def _clear_to_one(page, max_try=30):
    """删到只剩 1 张（小红书要求至少保留 1 张，最后一张删不掉）。"""
    for i in range(max_try):
        n = _count_pr(page)
        if n <= 1:
            return True
        n2 = _delete_first(page)
        _log("    删除[%d]：%d → %d" % (i + 1, n, n2))
    return _count_pr(page) <= 1


def replace_images(page, files, clear_only=False):
    page.wait_for_selector(".img-list", timeout=60000)
    page.wait_for_timeout(1500)
    before = _count_pr(page)
    _log("\n现有图片：%d 张（目标换成 %d 张）" % (before, len(files)))

    # 1) 先删到只剩 1 张（最后一张小红书不让删，留作占位）
    ok = _clear_to_one(page)
    _log("  已删到剩余 %d 张（%s）" % (_count_pr(page), "成功" if ok else "失败"))
    if not ok:
        _log("  ⚠️ 未能删到 1 张，已中止（不改动线上笔记）。")
        return
    old_src = page.evaluate(_JS_FIRST_SRC)
    if clear_only:
        return

    # 2) 上传新图（新图会追加在末尾）
    upload_input = None
    inputs = page.locator('input[type="file"]')
    for want_multi in (True, False):
        for i in range(inputs.count()):
            acc = inputs.nth(i).get_attribute("accept") or ""
            multi = inputs.nth(i).get_attribute("multiple")
            if not ("jpg" in acc or "image" in acc):
                continue
            if want_multi and multi is None:
                continue
            upload_input = inputs.nth(i)
            break
        if upload_input is not None:
            break
    if upload_input is None:
        _log("  ⚠️ 没找到图片上传输入框，请手动上传。")
        return
    upload_input.set_input_files(files)
    _log("  已提交 %d 张新图，等待上传处理…" % len(files))

    deadline = time.time() + 180
    while time.time() < deadline:
        if _count_pr(page) >= len(files) + 1:
            break
        page.wait_for_timeout(2000)
    _log("  上传后共 %d 张" % _count_pr(page))

    # 3) 精确删掉残留的旧图（按 src 定位，不依赖顺序假设）
    for i in range(10):
        if _count_pr(page) <= len(files):
            break
        res = page.evaluate(_JS_DELETE_BY_SRC, old_src)
        page.wait_for_timeout(800)
        _log("    清理旧图[%d]：剩 %d 张（%s）" % (i + 1, _count_pr(page), res))
        if res == "not-found":
            break
    _log("  最终图片数：%d（目标 %d）" % (_count_pr(page), len(files)))
    if _count_pr(page) != len(files):
        _log("  ⚠️ 图片数不符，请在浏览器里手动核对后再发布。")


def main():
    ap = argparse.ArgumentParser(description="接管浏览器修改已发布的小红书笔记配图")
    ap.add_argument("--post", help="帖子编号（A2 / 主推 …），对应 帖子/<编号>-*/ 文件夹")
    ap.add_argument("--index", type=int, help="笔记管理页的卡片序号（用于定位 noteId）")
    ap.add_argument("--title", help="按标题关键词定位 noteId（与 --index 二选一）")
    ap.add_argument("--note-id", help="直接指定 noteId（24 位十六进制），优先级最高")
    ap.add_argument("--probe", action="store_true", help="只导出编辑页结构，不做任何修改")
    ap.add_argument("--clear-only", action="store_true", help="只清空旧图、不上传（排障用）")
    ap.add_argument("--list-notes", action="store_true", help="列出笔记管理页的笔记")
    args = ap.parse_args()

    if not (args.list_notes or args.note_id or args.post):
        raise SystemExit("❌ 请给 --post / --note-id / --list-notes 之一。")

    files = post_images(args.post) if (args.post and not (args.probe or args.list_notes or args.clear_only)) else []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ 未安装 Playwright：python3 -m pip install --user playwright")

    os.makedirs(os.path.dirname(PROFILE), exist_ok=True)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            PROFILE,
            executable_path=ensure_browser(),
            headless=False,
            viewport={"width": 1280, "height": 800},
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--window-position=60,60",  # 固定到屏幕左上，避免被 IDE 挡住找不到
                "--window-size=1300,900",
            ],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.bring_to_front()
        # 删除/清空时可能弹「确定」确认框，统一自动接受（含后续新开的标签页）
        ctx.on("page", lambda p: p.on("dialog", lambda d: d.accept()))
        for p in ctx.pages:
            p.on("dialog", lambda d: d.accept())
        keep_open = False
        try:
            if args.list_notes:
                list_notes(page)
            else:
                keep_open = not args.probe
                if args.note_id:
                    note_id, editor = args.note_id, page
                else:
                    note_id, editor = resolve_note_id(ctx, page, args.index, args.title)
                if not note_id:
                    raise SystemExit("❌ 没拿到 noteId，中止。")
                _log("\n→ 编辑页：%s" % (UPDATE_URL % note_id))
                editor.goto(UPDATE_URL % note_id, wait_until="domcontentloaded")
                editor.bring_to_front()
                editor.wait_for_timeout(6000)
                if not _ensure_ready(editor):
                    wait_login(editor)
                if args.probe:
                    probe(editor, note_id)
                elif args.clear_only:
                    replace_images(editor, [], clear_only=True)
                    _log("\n（--clear-only：未上传新图，浏览器保持打开供你查看。）")
                else:
                    replace_images(editor, files)
                    _log("\n✅ 已停在「发布笔记」前。请在浏览器里核对图片顺序与数量，")
                    _log("   确认无误后自己点「发布笔记」。脚本不会代你提交。")
        except SystemExit:
            raise
        except Exception as exc:
            _log("\n⚠️ 中断：%s" % exc)
            _log("   浏览器保持打开，可手动补完。")

        try:
            while keep_open:
                page.wait_for_timeout(3000)
        except Exception:
            pass


if __name__ == "__main__":
    main()
