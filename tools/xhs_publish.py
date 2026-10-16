#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""半自动发布「小红书」图文笔记。

流程（全程不需要你手动传图 / 打字）：
    1. 脚本打开小红书创作服务平台（浏览器窗口弹出）
    2. 你在窗口里扫码登录（登录态会存进 .autoshot/xhs-profile/，之后免登录）
    3. 脚本自动切「上传图文」→ 上传 marketing/小红书/ 的配图 → 填好标题 / 正文 / 话题
    4. 停在「发布」按钮前，你在浏览器里核对后自己点「发布」

正文来源：marketing/小红书/小红书文案.md 的「2. 主推图文 · 综合全面版」——单一事实源，
文案改了本脚本自动跟着变，不重复维护。

用法：
    python3 tools/xhs_publish.py --list                # 列出全部可发布篇目（按 A/B/C/D/E/F 分类）
    python3 tools/xhs_publish.py --list A              # 只看 A 破圈类
    python3 tools/xhs_publish.py                       # 默认发「综合全面版」（10 张图一起传）
    python3 tools/xhs_publish.py --post A1             # 发扩展笔记池里的 A1（自动只传该篇的配图）
    python3 tools/xhs_publish.py --post "篇 1"         # 发系列分篇（旧写法 --section 同样可用）
    python3 tools/xhs_publish.py --post A1 --dry       # 只打印将要上传的内容，不操作

篇目 → 文案位置：扩展笔记池见 `小红书文案.md` 第 3.5 节；系列分篇见第 3 节；排期见 `小红书运营计划.md` 第四节。

依赖（与 autoshot 相同，通常已装好）：
    python3 -m pip install --user playwright
"""

import argparse
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from autoshot import ensure_browser  # noqa: E402  复用同一套「Chrome for Testing」

PROFILE = os.path.join(ROOT, ".autoshot", "xhs-profile")
PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish"
XHS_DIR = os.path.join(ROOT, "marketing", "小红书")
TEXT_FILE = os.path.join(XHS_DIR, "小红书文案.md")

# 轮询上限：登录 + 页面加载
WAIT_LOGIN_SEC = 600


# ------------------------------------------------------------------ 读文案

def _section(md, keyword):
    """按 `## ` 分段，返回包含 keyword 的那一段。"""
    parts = re.split(r"\n(?=## )", md)
    for p in parts:
        if keyword in p.split("\n", 1)[0]:
            return p
    raise SystemExit("❌ 在 %s 里找不到分段：%s" % (os.path.relpath(TEXT_FILE, ROOT), keyword))


def _find_block(md, selector):
    """按 selector 取「一块」文案，返回 (块文本, 标题行)。

    selector 支持两种写法：
      - 篇目编号（A1 / B7 / C2 / D3 / E5 / F1）→ 匹配 4 级标题 `#### A1 · …`（扩展笔记池）
      - 其它关键词（主推图文 / 篇 1 / 系列分篇）→ 匹配 2 级标题 `## …`
    """
    sel = selector.strip()
    lines = md.split("\n")
    if re.fullmatch(r"[A-Fa-f]\d+", sel):
        pat = re.compile(r"^####\s+%s\s+·" % re.escape(sel.upper()))
    elif re.fullmatch(r"篇\s*\d+", sel):
        pat = re.compile(r"^###\s+篇\s*%s\s+·" % re.search(r"\d+", sel).group(0))
    else:
        pat = None
    if pat is not None:
        start = next((i for i, ln in enumerate(lines) if pat.match(ln)), None)
        if start is None:
            raise SystemExit("❌ 文案里找不到篇目：%s（应形如 A1 / B7 / 篇 1）" % selector)
        end = len(lines)
        for j in range(start + 1, len(lines)):
            if re.match(r"^#{2,4}\s", lines[j]):
                end = j
                break
        return "\n".join(lines[start:end]), lines[start]
    sec = _section(md, selector)
    return sec, sec.split("\n", 1)[0]


def load_post(selector="主推图文"):
    """从文案 md 里抽出标题 / 正文 / 话题 / 配图，保持「文档 = 发布内容」一致。"""
    with open(TEXT_FILE, encoding="utf-8") as fh:
        md = fh.read()
    block, heading = _find_block(md, selector)

    m_title = re.search(r"\*\*标题\*\*：(.+)", block)
    m_body = re.search(r"```\n(.*?)\n```", block, re.S)
    m_tags = re.search(r"\*\*话题\*\*：(.+)", block)
    if not (m_title and m_body):
        raise SystemExit("❌ 该分段缺少「**标题**：」或正文代码块，请检查文案格式。")

    title = m_title.group(1).strip()
    body = m_body.group(1).strip()
    tags = re.findall(r"`(#[^`]+)`", m_tags.group(1)) if m_tags else []
    # 标题行里的 `xxx.png` 即本篇要用的配图（可多张）；没写则为空 → 交由 images() 兜底
    img_names = re.findall(r"`([^`]+\.png)`", heading)
    return title, body, tags, img_names


def list_posts(category=None):
    """列出文案里的可发布篇目（可限定分类 A/B/C/D/E/F）。"""
    with open(TEXT_FILE, encoding="utf-8") as fh:
        md = fh.read()
    want = category.strip().upper() if category else None
    print("可发布篇目（用 --post 编号 指定）：\n")
    cur = None
    for ln in md.split("\n"):
        m_sec = re.match(r"^###\s+([A-F])\.\s", ln)
        m_post = re.match(r"^####\s+([A-F]\d+)\s+·\s+(.*?)\s*$", ln)
        if m_sec:
            cur = m_sec.group(1)
            if want and cur != want:
                continue
            print("【%s 类】" % cur)
        if m_post:
            if want and cur != want:
                continue
            name = re.sub(r"（配.*?）\s*$", "", m_post.group(2)).strip()
            print("  --post %-4s  %s" % (m_post.group(1), name))
    print("\n另有固定篇：--post 主推图文 / --post 篇 1 … 篇 8")


def images(names=None):
    """按文案引用的顺序取图；未指定（或引用的图缺失）时回退为主推 10 图（配图-01…10）。"""
    all_files = sorted(f for f in os.listdir(XHS_DIR) if f.lower().endswith(".png"))
    if not all_files:
        raise SystemExit("❌ %s 下没有配图，请先跑：python3 promo.py" % os.path.relpath(XHS_DIR, ROOT))
    if names:
        picked = [n for n in names if n in all_files]
        missing = [n for n in names if n not in all_files]
        if missing:
            print("  ⚠️ 文案引用的配图不存在，已跳过：%s" % "、".join(missing))
        if picked:
            return [os.path.join(XHS_DIR, n) for n in picked]
    main = [f for f in all_files if re.match(r"^配图-\d{2}-", f)]
    return [os.path.join(XHS_DIR, f) for f in (main or all_files)]


# ------------------------------------------------------------------ 页面操作

# JS：按「叶子节点文本完全相等」找元素，优先挑视口内可见的那个再点。
# 小红书页签/按钮常有重叠的粘性克隆节点，用 Playwright 原生点击会报 outside of the viewport。
_JS_CLICK_TEXT = """(label) => {
  const all = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim() === label);
  const vis = all.find(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && r.left >= 0;
  }) || all[all.length - 1];
  if (!vis) return false;
  vis.click();
  return true;
}"""


def _try_click(page, selectors, timeout=3000):
    """按候选选择器逐个尝试点击，成功返回 True。"""
    for sel in selectors:
        try:
            page.click(sel, timeout=timeout)
            return True
        except Exception:
            continue
    return False


def wait_login(page):
    """等页面出现「上传图文」入口（即已进入发布页 + 已登录）。"""
    print("\n👉 浏览器已打开小红书创作服务平台。")
    print("   请用手机扫码登录（选「小红书」App 扫码）。登录态会保存，下次免登。")
    print("   登录成功后脚本会自动继续……\n")
    deadline = time.time() + WAIT_LOGIN_SEC
    while time.time() < deadline:
        # 发布页出现图片上传入口 = 已登录且到发布表单
        if page.locator('input[type="file"]').count() > 0:
            return True
        page.wait_for_timeout(2000)
    raise SystemExit("❌ 等待登录超时（%d 秒）。可重跑本脚本再试。" % WAIT_LOGIN_SEC)


def pick_image_tab(page):
    """切到「上传图文」页签。

    发布页默认停在「上传视频」（此时页面里的 file 输入框只收视频，accept 里没有 image），
    必须先切到「上传图文」，图片输入框才会出现。页签元素常有粘连/遮挡导致 Playwright 点击
    报「outside of the viewport」，故用 JS 按可见性精确点击。
    """
    try:
        page.evaluate(_JS_CLICK_TEXT, "上传图文")
    except Exception:
        pass
    page.wait_for_timeout(2000)


def upload_images(page, files):
    """上传配图。

    「上传图片」按钮触发一个原生文件选择器，用 expect_file_chooser 拦截最稳；
    若拦截失败，则兜底直接给 accept 含 image 的输入框塞文件。
    """
    done = False
    try:
        with page.expect_file_chooser(timeout=8000) as fc:
            page.evaluate(_JS_CLICK_TEXT, "上传图片")
        fc.value.set_files(files)
        done = True
    except Exception:
        inputs = page.locator('input[type="file"]')
        for i in range(inputs.count()):
            el = inputs.nth(i)
            if "image" in (el.get_attribute("accept") or ""):
                el.set_input_files(files)
                done = True
                break
    if done:
        print("  ✓ 已提交 %d 张配图，等待上传处理…" % len(files))
    else:
        print("  ⚠️ 没找到图片上传入口，请在浏览器里手动上传配图。")
    # 等标题输入框出现 = 图片处理完成、进入表单
    try:
        page.wait_for_selector('input[placeholder*="标题"]', timeout=60000)
    except Exception:
        page.wait_for_timeout(8000)


def fill_title(page, title):
    for sel in ['input[placeholder*="标题"]', 'input.d-text', 'input[type="text"]']:
        try:
            page.fill(sel, title, timeout=4000)
            print("  ✓ 标题：%s" % title)
            return
        except Exception:
            continue
    print("  ⚠️ 没找到标题输入框，请手动填写：%s" % title)


def _copy_to_clipboard(text):
    """把文本写入系统剪贴板（macOS 用 pbcopy）。"""
    try:
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return True
    except Exception:
        return False


def fill_body(page, body, tags):
    text = body + ("\n\n" + " ".join(tags) if tags else "")
    editors = page.locator('div[contenteditable="true"], .ql-editor, textarea[placeholder*="正文"]')
    if editors.count() == 0:
        print("  ⚠️ 没找到正文输入区，请手动粘贴正文（见 marketing/小红书/小红书文案.md）。")
        return
    ed = editors.first
    ed.click()
    page.wait_for_timeout(300)

    mod = "Meta" if sys.platform == "darwin" else "Control"
    # 小红书编辑器会把「Shift+Enter 软换行」显示成一坨，改用「整段剪贴板粘贴」保留换行
    if _copy_to_clipboard(text):
        page.keyboard.press("%s+a" % mod)
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        page.keyboard.press("%s+v" % mod)
        page.wait_for_timeout(800)
        print("  ✓ 正文 + 话题已粘贴（共 %d 字，保留换行）" % len(text))
        return

    # 回退：逐行输入，换行用 Enter（比 Shift+Enter 更稳）
    for line in text.split("\n"):
        ed.press_sequentially(line, delay=0)
        ed.press("Enter")
    print("  ✓ 正文 + 话题已逐行填入（共 %d 字）" % len(text))


def reveal_publish_button(page):
    """把「发布」按钮滚进视野（窗口较小时它可能落在视口之外，用户点不到）。"""
    try:
        page.evaluate("""() => {
          const all = [...document.querySelectorAll('*')].filter(
            e => e.childElementCount === 0 && e.textContent.trim() === '发布');
          const b = all[all.length - 1];
          if (b) b.scrollIntoView({ block: 'center' });
        }""")
    except Exception:
        pass
    page.wait_for_timeout(500)


def main():
    ap = argparse.ArgumentParser(description="半自动发布小红书图文笔记")
    ap.add_argument("--post", default="主推图文",
                    help="发哪一篇：编号（A1/B7/C2/D3/E5/F1…）或关键词（主推图文 / 篇 1 …篇 8），默认「主推图文」")
    ap.add_argument("--section", help="（旧写法，等同 --post 的关键词形式）")
    ap.add_argument("--list", nargs="?", const="", default=None,
                    metavar="分类", help="列出可发布篇目；可跟分类（A/B/C/D/E/F）筛选")
    ap.add_argument("--dry", action="store_true", help="只打印将发布的内容，不做任何操作")
    args = ap.parse_args()

    if args.list is not None:
        list_posts(args.list or None)
        return

    selector = args.section or args.post
    title, body, tags, img_names = load_post(selector)
    files = images(img_names)

    print("将发布：%s" % selector)
    print("  标题：%s" % title)
    print("  配图：%d 张（%s）" % (len(files), "、".join(os.path.basename(f) for f in files)))
    print("  话题：%s" % (" ".join(tags) if tags else "（无）"))
    if args.dry:
        return

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ 未安装 Playwright。请先执行：\n   python3 -m pip install --user playwright")

    os.makedirs(os.path.dirname(PROFILE), exist_ok=True)
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            PROFILE,
            executable_path=ensure_browser(),
            headless=False,
            viewport={"width": 1280, "height": 660},
            args=["--no-first-run", "--no-default-browser-check"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(PUBLISH_URL, wait_until="domcontentloaded")

        try:
            wait_login(page)
            pick_image_tab(page)
            upload_images(page, files)
            fill_title(page, title)
            fill_body(page, body, tags)
            reveal_publish_button(page)
        except SystemExit:
            raise
        except Exception as exc:
            print("\n⚠️ 自动填写中断：%s" % exc)
            print("   浏览器保持打开，可手动补完；下面的内容可直接复制：\n")
            print("标题：%s\n\n正文：\n%s\n\n话题：%s\n" % (title, body, " ".join(tags)))

        print("\n✅ 已停在「发布」前。请在弹出的浏览器里核对图片 / 标题 / 正文 / 话题，")
        print("   确认无误后自己点「发布」。")
        print("   发完直接关掉浏览器窗口即可结束本脚本。\n")

        # 保持窗口，直到用户关闭浏览器
        try:
            while True:
                page.wait_for_timeout(3000)
        except Exception:
            pass
        finally:
            try:
                ctx.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
