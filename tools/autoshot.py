#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自动抓取「微信悦读」真实界面截图，给 promo.py 当素材。

原理
    用 Playwright 启动本机 Chrome，把本仓库当作「已解压扩展」加载进来，
    再用一个固定的独立用户目录保存登录态。脚本自动打开各个面板并截图，
    全程不需要你手动截图。

首次使用（只需一次）
    python3 tools/autoshot.py --login
    → 会弹出一个 Chrome 窗口，扫码登录微信读书、并（可选）配好 API Key，
      回到终端按回车结束。登录态会存进 .autoshot/chrome-profile/。

之后每次出图
    python3 tools/autoshot.py --url "<你在读的某本书的网址>"
    python3 promo.py

依赖
    python3 -m pip install --user playwright
    （测试用浏览器 Chrome for Testing 由本脚本首次运行时自动下载到 .autoshot/，
      共约 180MB，只下一次。为什么不用系统 Chrome：官方 Chrome 从 137 起
      移除了 --load-extension，已无法从命令行加载未打包的扩展。）

产物
    screenshots/auto/<场景名>.png   （2 倍高清，2880×1800）
"""

import argparse
import os
import platform
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(ROOT, ".autoshot", "chrome-profile")
OUT_DIR = os.path.join(ROOT, "screenshots", "auto")
DEFAULT_URL = "https://weread.qq.com/"

# 测试用浏览器（Chrome for Testing）：官方明确它仍支持 --load-extension
CFT_VERSION = "154.0.8037.92"
CFT_DIR = os.path.join(ROOT, ".autoshot", "cft")
CFT_URL = ("https://registry.npmmirror.com/-/binary/chrome-for-testing/%s/%s/"
           "chrome-%s.zip") % (CFT_VERSION, "{arch}", "{arch}")

ROOT_SEL = "#we-read-enhancer-root"
MENU = "#wre-main-menu"
FAB = "#wre-fab"


# ------------------------------------------------------------------ 页面操作

def js_reset(page):
    """关掉所有已展开的面板 / 菜单，回到干净状态。"""
    page.evaluate(
        """() => {
            document.querySelectorAll('#we-read-enhancer-root .wre-visible')
                .forEach((el) => el.classList.remove('wre-visible'));
        }"""
    )


def wait_visible(page, selector, timeout=8000):
    page.wait_for_function(
        "(sel) => { const el = document.querySelector(sel);"
        " return !!el && el.classList.contains('wre-visible'); }",
        arg=selector,
        timeout=timeout,
    )


def open_menu(page, label=None):
    """展开主菜单；label 非空时再点对应条目。

    菜单是靠 FAB 的 mouseenter 展开的，所以每次都要先把鼠标挪开，
    否则鼠标还停在 FAB 上、不会再次触发 mouseenter（这是自动化的常见坑）。
    """
    js_reset(page)
    page.mouse.move(1, 1)
    page.wait_for_timeout(120)
    page.hover(FAB)
    try:
        page.wait_for_function(
            "(sel) => { const el = document.querySelector(sel);"
            " return !!el && el.classList.contains('wre-visible'); }",
            arg=MENU,
            timeout=4000,
        )
    except Exception:
        force_open(page, MENU)  # 兜底：直接展开菜单
    if label:
        page.click("%s .wre-menu-item:has-text('%s')" % (MENU, label))


def force_open(page, selector):
    """不依赖点击，直接把某面板置为可见（用于「新手引导」这类弹窗）。"""
    page.evaluate(
        "(sel) => { const el = document.querySelector(sel);"
        " if (el) el.classList.add('wre-visible'); }",
        selector,
    )


def wait_reader(page, timeout=8000):
    """等正文出现（书页才有；首页没有则忽略）。"""
    try:
        page.wait_for_selector(
            ".readerChapterContent, .readerChapterContent_container",
            state="visible",
            timeout=timeout,
        )
        return True
    except Exception:
        return False


# ------------------------------------------------------------------ 各场景

def sc_reading(page):
    """纯正文（沉浸阅读）。"""
    pass


def sc_menu(page):
    """主菜单展开。"""
    open_menu(page)


def sc_read_settings(page):
    open_menu(page, "阅读设置")
    wait_visible(page, "#wre-read-settings-modal")


def sc_shortcuts(page):
    open_menu(page, "快捷键说明")
    wait_visible(page, "#wre-shortcuts-modal")


def sc_debug(page):
    open_menu(page, "调试日志")
    wait_visible(page, "#wre-debug-modal")


def sc_stats(page):
    open_menu(page, "阅读统计")
    wait_visible(page, "#wre-stats-modal")


def sc_notes(page):
    open_menu(page, "笔记")
    wait_visible(page, "#wre-notes-modal")


def sc_official(page):
    open_menu(page, "官方数据")
    wait_visible(page, "#wre-official-modal", timeout=15000)
    page.wait_for_timeout(2500)  # 等官方接口回数据


def sc_api_key(page):
    open_menu(page, "API Key")
    wait_visible(page, "#wre-api-key-modal")


def sc_support(page):
    open_menu(page, "支持与反馈")
    wait_visible(page, "#wre-support-center-modal")


def sc_welcome(page):
    force_open(page, "#wre-welcome-modal")


def sc_dnd(page):
    """勿扰模式：按 D（真实按键，扩展会校验 isTrusted）。"""
    js_reset(page)
    page.keyboard.press("d")
    page.wait_for_timeout(600)


def sc_fullscreen(page):
    js_reset(page)
    page.keyboard.press("f")
    page.wait_for_timeout(800)


# (场景名 → 出图文件名 / 中文标题 / 动作)
SCENES = [
    ("reading", "沉浸阅读", sc_reading),
    ("menu", "主菜单", sc_menu),
    ("read-settings", "阅读设置 · 屏占比", sc_read_settings),
    ("shortcuts", "快捷键说明", sc_shortcuts),
    ("debug", "调试日志", sc_debug),
    ("welcome", "新手引导", sc_welcome),
    ("stats", "阅读统计", sc_stats),
    ("notes", "笔记增强", sc_notes),
    ("official", "官方数据", sc_official),
    ("api-key", "API Key", sc_api_key),
    ("support", "支持与反馈", sc_support),
    ("dnd", "勿扰模式", sc_dnd),
    ("fullscreen", "全屏模式", sc_fullscreen),
]


# ------------------------------------------------------------------ 主流程

def _cft_binary():
    arch = "mac-arm64" if platform.machine() == "arm64" else "mac-x64"
    return os.path.join(CFT_DIR, "chrome-%s" % arch,
                        "Google Chrome for Testing.app", "Contents", "MacOS",
                        "Google Chrome for Testing")


def ensure_browser():
    """返回 Chrome for Testing 可执行文件；缺失时自动从国内镜像下载（仅首次）。"""
    exe = _cft_binary()
    if os.path.exists(exe):
        return exe
    arch = "mac-arm64" if platform.machine() == "arm64" else "mac-x64"
    url = CFT_URL.format(arch=arch)
    print("首次运行：下载测试用浏览器（约 180MB，仅一次）…\n  %s" % url)
    os.makedirs(CFT_DIR, exist_ok=True)
    zip_path = os.path.join(CFT_DIR, "cft.zip")
    urllib.request.urlretrieve(url, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(CFT_DIR)
    os.remove(zip_path)
    if not os.path.exists(exe):
        raise SystemExit("❌ 浏览器解压后未找到可执行文件：%s" % exe)
    return exe


def launch(pw):
    os.makedirs(os.path.dirname(PROFILE), exist_ok=True)
    return pw.chromium.launch_persistent_context(
        PROFILE,
        executable_path=ensure_browser(),
        headless=False,
        viewport={"width": 1440, "height": 900},
        device_scale_factor=2,
        args=[
            "--disable-extensions-except=%s" % ROOT,
            "--load-extension=%s" % ROOT,
            "--no-first-run",
            "--no-default-browser-check",
        ],
    )


def do_login(ctx):
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(DEFAULT_URL, wait_until="domcontentloaded")
    print("\n👉 已打开微信读书。请在窗口里扫码登录，并（可选）配好 API Key。")
    print("   完成后回到这里按回车键结束。")
    input()
    print("✅ 登录态已保存到 %s" % os.path.relpath(PROFILE, ROOT))


def do_capture(ctx, url, only):
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(url, wait_until="domcontentloaded")

    try:
        page.wait_for_selector(ROOT_SEL, timeout=30000)
    except Exception:
        raise SystemExit(
            "❌ 没等到扩展界面（#we-read-enhancer-root）。\n"
            "   请确认：1) 就是在用本脚本启动的 Chrome；2) 已执行过 --login 并登录。"
        )

    if not wait_reader(page):
        print("⚠️ 没检测到正文（可能停在首页或未登录）。面板类截图仍会生成，但背景不是书页。")
    page.wait_for_timeout(1500)  # 让正文/字体渲染稳定
    js_reset(page)               # 关掉首次安装自动弹出的「新手引导」，避免挡住后续操作

    os.makedirs(OUT_DIR, exist_ok=True)
    scenes = [s for s in SCENES if (not only or s[0] in only)]
    ok, fail = 0, 0
    for key, title, fn in scenes:
        try:
            js_reset(page)  # 每个场景都从干净状态开始
            fn(page)
            page.wait_for_timeout(500)
            path = os.path.join(OUT_DIR, key + ".png")
            page.screenshot(path=path)
            ok += 1
            print("  ✓ %-14s %s" % (key, title))
        except Exception as exc:  # 单个场景失败不影响其余
            fail += 1
            print("  ✗ %-14s %s：%s" % (key, title, exc))
        finally:
            js_reset(page)

    print("\n完成：成功 %d / 失败 %d → %s" % (ok, fail, os.path.relpath(OUT_DIR, ROOT)))


def main():
    ap = argparse.ArgumentParser(description="自动抓取微信悦读界面截图")
    ap.add_argument("--url", default=DEFAULT_URL, help="要抓图的读书页网址（默认微信读书首页）")
    ap.add_argument("--login", action="store_true", help="仅打开浏览器让你登录/配置，然后保存登录态")
    ap.add_argument("--only", nargs="*", help="只抓指定场景（留空=全部）")
    args = ap.parse_args()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit(
            "❌ 未安装 Playwright。请先执行：\n"
            "   python3 -m pip install --user playwright"
        )

    with sync_playwright() as pw:
        ctx = launch(pw)
        try:
            if args.login:
                do_login(ctx)
            else:
                do_capture(ctx, args.url, args.only)
        finally:
            ctx.close()


if __name__ == "__main__":
    main()
