#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成展示素材（GitHub 展示图 + 应用商店素材）。

做法：用 HTML/CSS 写版式，交给本机 Chrome 无头渲染成图，再用 PIL 精确缩放。
不引入任何第三方依赖（只用标准库 + Pillow）。

用法：
    python3 promo.py

产物（一图一岗，对应各上架位置）：
    screenshots/promo/   GitHub 仓库首页（README Banner + 功能亮点卡片，2 倍高清）
    marketing/小红书/  小红书笔记配图（3:4 竖版 1080x1440，封面 + 分主题系列，可多图连发）
    screenshots/store/   Edge / Chrome 商店（宣传磁贴 440x280 / 1400x560 + 1280x800 截图）
    release/360-素材/    360 商店（效果图 560x350，360 规格与 Edge/Chrome 不通用）
"""

import base64
import io
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

OUT_GITHUB = os.path.join(ROOT, "screenshots", "promo")
OUT_STORE = os.path.join(ROOT, "screenshots", "store")
OUT_360 = os.path.join(ROOT, "release", "360-素材")
# 微软 Partner Center / Chrome 商店「上传包」：按槽位分好文件夹，直接拖到对应位置上传
OUT_MS = os.path.join(ROOT, "release", "微软商店-上传")
# H5（PWA）图标落点：与 icon.svg 同款设计，供「安装成桌面应用 / 加到主屏」使用
H5_ASSETS = os.path.join(ROOT, "h5", "assets")

# 品牌 logo 的矢量母版（蓝圆 + 白 W）。展示图里所有出现 logo 的位置都内联它，
# 因为是矢量、任意渲染倍率都绝对清晰，彻底摆脱「128px 位图放大发虚」。
LOGO_SVG = os.path.join(ROOT, "assets", "logo.svg")
EFF = os.path.join(ROOT, "screenshots", "效果参考图")
SS = os.path.join(ROOT, "screenshots")

# 素材来源（均为插件真实界面截图；统一取高分辨率原图，避免被放大后发虚）
# ⚠️ 商店截图在页面里会被放大到 2560 设备像素宽，所以必须用 ≥2560 的原图，
#    不要用 screenshots/resized/ 里 1280 宽的缩略图。
#
# 自动抓图（推荐）：先跑 `python3 tools/autoshot.py`，它会把真实界面截图写到
# screenshots/auto/。存在自动图时优先用它，没有就回退到下面的手工图，保证老流程不坏。
AUTO_DIR = os.path.join(SS, "auto")

_MANUAL_SRC = {
    "width": os.path.join(EFF, "微信图片_20260613151713_19_3084.png"),      # 阅读设置：屏占比 / 阅读进度 / 主题色
    "focus": os.path.join(EFF, "微信图片_20260613151713_20_3084.png"),      # 插件设置：勿扰模式 / 插件主题色
    "immersive": os.path.join(EFF, "微信图片_20260613151713_21_3084.png"),  # 沉浸阅读正文
    "shortcut": os.path.join(EFF, "微信图片_20260613151713_22_3084.png"),   # 快捷键说明
    "diag": os.path.join(SS, "Snipaste_2026-06-26_10-05-25.png"),   # 调试日志（2864x1588）
    "read": os.path.join(SS, "Snipaste_2026-06-26_10-05-52.png"),   # 沉浸阅读正文（2864x1520）
}

# SRC 键 → tools/autoshot.py 抓取的场景文件名
_AUTO_SCENE = {
    "width": "read-settings",
    "focus": "dnd",
    "immersive": "reading",
    "shortcut": "shortcuts",
    "diag": "debug",
    "read": "reading",
    # —— 全功能扩展（新增 8 个场景，覆盖全部面板）——
    "menu": "menu",
    "stats": "stats",
    "notes": "notes",
    "official": "official",
    "api-key": "api-key",
    "support": "support",
    "welcome": "welcome",
    "fullscreen": "fullscreen",
    # —— 阅读洞察分支（新增）——
    "shelf": "shelf",
    "discover": "discover",
    "persona": "persona",
    "persona-share": "persona-share",
    "ai": "ai",
    "help": "help",
}


def _pick_source(key):
    auto = os.path.join(AUTO_DIR, _AUTO_SCENE[key] + ".png")
    if os.path.exists(auto):
        return auto
    # 新增场景没有手工图，缺失时统一回退到沉浸阅读正文，保证老流程不坏
    return _MANUAL_SRC.get(key) or _MANUAL_SRC["read"]


SRC = {key: _pick_source(key) for key in _AUTO_SCENE}

# 清晰度档位
QUALITY = 95      # 内联 JPEG 质量（4:4:4 无色度抽样），偏高减少小字糊化
SCALE_HI = 3      # 高倍渲染：Banner / 卡片 / 磁贴，超采样后再缩放，边缘更锐
STORE_SCALE = 1   # 商店截图：源图已按功能面板裁剪放大，用 1 倍渲染可避免 <img> 先被放大再缩小而发虚

# 图标：直接用矢量母版（assets/logo.svg），任何倍率自适应渲染，无需再准备多档位图。

_uri_cache = {}
_logo_cache = {}


def _svg_uri(path):
    """把 SVG 内联成 data URI（矢量）；浏览器按目标尺寸实时渲染，任意倍率都清晰。"""
    with open(path, "rb") as fh:
        return "data:image/svg+xml;base64," + base64.b64encode(fh.read()).decode()


def _encode_uri(im, max_width, key, upscale=False):
    if key in _uri_cache:
        return _uri_cache[key]
    if im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    elif upscale and im.width < max_width:
        # 源图不够宽、但页面显示尺寸又大于源分辨率时：先用高质量放大补齐 + 轻锐化，
        # 交给 Chrome 缩小；比让浏览器临时放大更实（同矢量 logo 的思路）。
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=120, threshold=2))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=QUALITY, subsampling=0, optimize=True)
    value = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    _uri_cache[key] = value
    return value


def uri(path, max_width=2900, upscale=False):
    """把图片转成内联 data URI。

    ⚠️ max_width 必须 ≥ 该图在页面中的「设备像素宽度」（CSS 宽度 × 渲染倍率），
       否则 <img> 的 object-fit:cover 会把它二次放大，出图就会发虚。
       源图本身不够宽时，传 upscale=True 让 PIL 先高质量补齐，别让 Chrome 放大。
    统一用 JPEG 4:4:4（无色度抽样），避免截图里的小字被色度压缩糊掉。
    """
    return _encode_uri(Image.open(path).convert("RGB"), max_width, (path, max_width), upscale)


def uri_crop(path, box, max_width=1800, upscale=False):
    """按比例框裁剪后转 data URI（box=(l, t, r, b)，取值 0~1）。

    用于 360 商店效果图：560x350 太小，整页缩进去文字必然糊，
    所以只截取关键控件区域并铺满画面，让文字在 560 宽下仍可辨认。
    """
    im = Image.open(path).convert("RGB")
    W, H = im.size
    l, t, r, b = box
    im = im.crop((int(l * W), int(t * H), int(r * W), int(b * H)))
    return _encode_uri(im, max_width, (path, box, max_width), upscale)


def icon_uri():
    """页面内联用的 logo：直接内联矢量 SVG，任何渲染倍率下都绝对清晰。"""
    return _svg_uri(LOGO_SVG)


def logo_png(size):
    """把矢量 logo 光栅化成 size×size 的透明 PNG（给需要独立 PNG 的槽位，如商店徽标）。

    先用 2 倍尺寸渲染再 LANCZOS 缩回，边缘最锐。
    """
    if size in _logo_cache:
        return _logo_cache[size]
    big = size * 2
    html = page(big, big, '<img src="%s" style="width:100%%;height:100%%;display:block">' % icon_uri())
    im = _capture(html, big, big, 2, rgba=True).resize((size, size), Image.LANCZOS)
    _logo_cache[size] = im
    return im


def page(width, height, body, css=""):
    return (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        "*{margin:0;padding:0;box-sizing:border-box}"
        "html,body{width:%dpx;height:%dpx;overflow:hidden;"
        "font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;"
        "-webkit-font-smoothing:antialiased}"
        "%s</style></head><body>%s</body></html>"
        % (width, height, css, body)
    )


def _capture(html, width, height, scale, rgba=False):
    """用 Chrome 无头把 HTML 渲染成 PIL 图；rgba=True 时保留透明背景。"""
    tmp = tempfile.mkdtemp(prefix="wre-promo-")
    try:
        html_path = os.path.join(tmp, "a.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(html)
        shot_path = os.path.join(tmp, "a.png")
        cmd = [
            CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
            "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb",
            "--force-device-scale-factor=%d" % scale,
            "--window-size=%d,%d" % (width, height),
        ]
        if rgba:
            cmd.append("--default-background-color=00000000")
        cmd += ["--screenshot=" + shot_path, "file://" + html_path]
        subprocess.run(cmd, check=True, capture_output=True)
        return Image.open(shot_path).convert("RGBA" if rgba else "RGB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def render(html, out_path, width, height, scale=2, final=None, sharpen=0):
    """用 Chrome 无头渲染 HTML 并截图；final 为最终目标尺寸（None 表示保留 scale 倍图）。

    sharpen>0 时在降回 final 尺寸后再做一次轻锐化（UnsharpMask percent=sharpen），
    抵消缩放带来的轻微发虚——这是纯文字版式提升清晰度最有效的一步。
    """
    im = _capture(html, width, height, scale)
    if final:
        im = im.resize(final, Image.LANCZOS)
        if sharpen:
            im = im.filter(ImageFilter.UnsharpMask(radius=1.1, percent=sharpen, threshold=2))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    im.save(out_path)
    print("  ✓ %-46s %dx%d" % (os.path.relpath(out_path, ROOT), im.size[0], im.size[1]))


# ---------------------------------------------------------------- Banner 1280x400

BANNER_CSS = """
.hero{position:relative;width:100%;height:100%;padding:0 52px;display:flex;align-items:center;gap:30px;overflow:hidden;
      background:linear-gradient(115deg,#08235E 0%,#1E52D6 42%,#2F6BFF 72%,#6FA8FF 100%)}
.hero:before{content:"";position:absolute;width:560px;height:560px;border-radius:50%;top:-260px;right:-120px;
      background:radial-gradient(circle,rgba(255,255,255,.22),rgba(255,255,255,0) 68%)}
.hero:after{content:"";position:absolute;width:420px;height:420px;border-radius:50%;bottom:-260px;left:110px;
      background:radial-gradient(circle,rgba(130,185,255,.32),rgba(130,185,255,0) 70%)}
.left{position:relative;z-index:2;flex:1 1 auto;max-width:566px}
.brand{display:flex;align-items:center;gap:16px}
.logo{width:66px;height:66px;border-radius:18px;box-shadow:0 10px 24px rgba(0,0,0,.28)}
.name{font-size:40px;font-weight:800;color:#fff;letter-spacing:2px;line-height:1.08}
.en{font-size:15px;color:#BBD3FF;letter-spacing:3px;margin-top:5px}
.tag{margin-top:20px;font-size:23px;font-weight:600;color:#EAF1FF;letter-spacing:1px}
.chips{margin-top:20px;display:flex;flex-wrap:wrap;gap:10px}
.chip{font-size:14px;color:#fff;padding:7px 14px;border-radius:999px;
      background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32)}
.right{position:relative;z-index:2;flex:0 0 auto}
.shot{width:512px;height:320px;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.6);
      box-shadow:0 26px 60px rgba(3,20,60,.5);transform:rotate(-2.2deg)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:center top}
"""

BANNER_BODY = """
<div class="hero">
  <div class="left">
    <div class="brand">
      <img class="logo" src="__ICON__">
      <div><div class="name">微信悦读</div><div class="en">WEREAD ENHANCER</div></div>
    </div>
    <div class="tag">让微信读书网页版，更好读</div>
    <div class="chips">
      <span class="chip">屏占比调节</span><span class="chip">自动阅读</span><span class="chip">笔记增强</span>
      <span class="chip">阅读统计</span><span class="chip">阅读洞察</span><span class="chip">AI 阅读人格</span>
    </div>
  </div>
  <div class="right"><div class="shot"><img src="__READ__"></div></div>
</div>
"""


def build_banner():
    html = page(1280, 400, BANNER_BODY.replace("__ICON__", icon_uri()).replace("__READ__", uri(SRC["read"], 1600)), BANNER_CSS)
    render(html, os.path.join(OUT_GITHUB, "github-banner.png"), 1280, 400, scale=SCALE_HI)


# ------------------------------------------------------- 功能亮点卡片 640x500

CARD_CSS = """
.card{width:100%;height:100%;padding:22px;display:flex;flex-direction:column;
      background:linear-gradient(160deg,#E9F0FF 0%,#FFFFFF 54%);border:1px solid #DCE6FF}
.shot{flex:0 0 350px;border-radius:14px;overflow:hidden;background:#fff;
      border:1px solid #D3E0FF;box-shadow:0 12px 26px rgba(30,80,200,.16)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:center top}
.meta{margin-top:20px;display:flex;align-items:center;gap:14px}
.badge{width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;
      font-size:22px;background:linear-gradient(140deg,#2F6BFF,#5B9BFF);box-shadow:0 8px 18px rgba(47,107,255,.35)}
.tt{font-size:23px;font-weight:800;color:#12203A;letter-spacing:1px;line-height:1.2}
.tt .en{display:block;font-size:11px;font-weight:600;color:#8497B4;letter-spacing:2px;margin-top:4px}
.desc{margin-top:12px;font-size:16px;line-height:1.6;color:#54678A}
"""

CARDS = [
    ("feature-01-reading-width.png", "📐", "屏占比调节", "CUSTOM READING WIDTH",
     "50%–100% 自由调节阅读区宽度，滑块 + 快捷比例，设置自动保存。", "width"),
    ("feature-02-focus.png", "🌙", "勿扰模式", "DO NOT DISTURB",
     "一键隐藏干扰元素，配明 / 暗双主题，专注沉浸阅读。", "focus"),
    ("feature-03-immersive.png", "📖", "沉浸阅读", "IMMERSIVE READING",
     "工具栏浮动悬停，滚动模式自适应居中，悬浮滚动条随手可拖。", "immersive"),
    ("feature-04-shortcuts.png", "⌨️", "快捷操作", "KEYBOARD SHORTCUTS",
     "空格自动阅读，D 勿扰，F 全屏，? 呼出帮助面板。", "shortcut"),
    ("feature-05-diagnostics.png", "🩺", "诊断日志", "BUILT-IN DIAGNOSTICS",
     "内置统一日志系统，一键导出 JSON，排查问题不靠猜。", "diag"),
    ("feature-06-stats.png", "📊", "阅读统计", "READING STATS",
     "前台时长（今日 / 本周 / 本月 / 本书）、书籍进度与最近书目，一键导出 HTML / PDF / Markdown / CSV / JSON。", "stats"),
    ("feature-07-notes.png", "📝", "笔记增强", "NOTES ENHANCER",
     "按章节聚合全部划线与想法，关键词实时搜索，复制 / Markdown / HTML / PDF 一键导出。", "notes"),
    ("feature-08-official.png", "🪞", "阅读洞察", "READING INSIGHTS",
     "凭 API Key 拉取官方阅读数据，生成本机阅读行为报告，可选 DeepSeek 人格化解读。", "official"),
    ("feature-09-welcome.png", "🎉", "新手引导", "ONBOARDING",
     "首次安装或版本更新自动弹出欢迎面板，几步上手核心玩法。", "welcome"),
    ("feature-10-fullscreen.png", "🖥️", "全屏模式", "FULLSCREEN",
     "F 键一键全屏，保留屏占比与勿扰状态，退出自动恢复原样。", "fullscreen"),
    ("feature-11-menu.png", "🧭", "功能主菜单", "COMMAND MENU",
     "悬浮球悬停即展开，阅读设置、统计、笔记、阅读洞察一个入口全搞定。", "menu"),
    ("feature-12-support.png", "💗", "支持与反馈", "SUPPORT",
     "内置支持中心，问题反馈与交流入口一步直达。", "support"),
    ("feature-13-api-key.png", "🔑", "API Key 配置", "API KEY",
     "集中管理微信读书 wrk- 与 DeepSeek sk- Key，本地保存、不上传。", "api-key"),
    ("feature-14-persona.png", "🧬", "阅读人格", "READING PERSONA",
     "基于官方阅读数据在本机算出 4 位人格代码 + 主称号 + 四维进度，附数据与原文证据，零依赖可复算。", "persona"),
    ("feature-15-persona-share.png", "📤", "人格分享图", "SHARE CARD",
     "一键生成竖版手机分享图，复制到剪贴板或下载 PNG，随手发朋友圈。", "persona-share"),
    ("feature-16-ai.png", "🤖", "AI 解读", "AI INSIGHTS",
     "配置 DeepSeek Key 后一键生成人格化解读；数字仍由本机规则计算，失败自动退回规则文案。", "ai"),
    ("feature-17-shelf.png", "📚", "书架概览", "MY SHELF",
     "汇总电子书 / 专辑 / 公众号数量并分区展示封面、作者、进度与来源，支持显示更多。", "shelf"),
    ("feature-18-discover.png", "🔍", "发现与搜书", "DISCOVER",
     "多范围搜书、个性化推荐、公开书评与相似书，一屏完成选书前的了解。", "discover"),
    ("feature-19-help.png", "📖", "帮助中心", "HELP CENTER",
     "主菜单一键跳转配套教程网站，启动时静默检查新版本并红点提示。", "help"),
]


def build_cards():
    for name, badge, title, en, desc, key in CARDS:
        body = (
            '<div class="card"><div class="shot"><img src="%s"></div>'
            '<div class="meta"><div class="badge">%s</div>'
            '<div class="tt">%s<span class="en">%s</span></div></div>'
            '<div class="desc">%s</div></div>'
        ) % (uri(SRC[key], 1900), badge, title, en, desc)
        render(page(640, 500, body, CARD_CSS), os.path.join(OUT_GITHUB, name), 640, 500, scale=SCALE_HI)


# ------------------------------------------- 朋友圈 / 群聊分享图 1080x1440 (4:5)

# 一张竖版「一图流」：品牌 → 主界面（阅读人格）→ 8 条核心亮点 → 安装入口。
# 4:5 在朋友圈单图与群聊预览里都不被裁切；底部不放二维码，只写商店名与官网（用户选定的口径）。

SHARE_CSS = """
.share{width:100%;height:100%;display:flex;flex-direction:column;background:#EEF3FF}
.head{flex:0 0 300px;position:relative;overflow:hidden;padding:0 56px;display:flex;flex-direction:column;justify-content:center;
      background:linear-gradient(120deg,#08235E 0%,#1E52D6 45%,#2F6BFF 78%,#6FA8FF 100%)}
.head:before{content:"";position:absolute;width:560px;height:560px;border-radius:50%;top:-280px;right:-150px;
      background:radial-gradient(circle,rgba(255,255,255,.22),rgba(255,255,255,0) 68%)}
.brand{position:relative;z-index:2;display:flex;align-items:center;gap:22px}
.brand img{width:86px;height:86px;border-radius:22px;box-shadow:0 12px 28px rgba(0,0,0,.30)}
.name{font-size:50px;font-weight:800;color:#fff;letter-spacing:3px;line-height:1.02}
.en{font-size:14px;color:#BBD3FF;letter-spacing:5px;margin-top:7px}
.tag{position:relative;z-index:2;margin-top:20px;font-size:26px;font-weight:700;color:#EAF1FF;letter-spacing:1px}
.chips{position:relative;z-index:2;margin-top:16px;display:flex;flex-wrap:wrap;gap:9px}
.chip{font-size:14px;color:#fff;padding:6px 13px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3)}
.mid{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;gap:20px;padding:24px 56px 0}
.shot{flex:0 0 460px;width:800px;border-radius:20px;overflow:hidden;background:#fff;border:1px solid #D3E0FF;
      box-shadow:0 18px 42px rgba(30,80,200,.20)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:center}
.feats{flex:1 1 auto;width:100%;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:14px}
.feat{display:flex;align-items:center;gap:15px;padding:12px 18px;border-radius:16px;background:#fff;border:1px solid #DDE7FF;
      box-shadow:0 6px 16px rgba(30,80,200,.07)}
.feat .b{flex:0 0 48px;height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:25px;
      background:linear-gradient(140deg,#2F6BFF,#5B9BFF);box-shadow:0 8px 16px rgba(47,107,255,.28)}
.feat .t{font-size:22px;font-weight:800;color:#12203A;letter-spacing:.5px}
.feat .d{font-size:14px;color:#5A6E93;margin-top:3px;line-height:1.3}
.foot{flex:0 0 116px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;
      background:linear-gradient(100deg,#0C2C74 0%,#1E52D6 55%,#2F6BFF 100%)}
.foot .row{display:flex;align-items:center;gap:12px;font-size:21px;font-weight:700;color:#fff;letter-spacing:.5px}
.foot .k{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.42);border-radius:10px;padding:4px 13px;font-size:19px}
.foot .meta{font-size:16px;color:#D6E4FF;letter-spacing:.5px}
"""

SHARE_FEATS = [
    ("📐", "屏占比调节", "50%–100% 自由调节阅读区宽度"),
    ("📖", "沉浸阅读", "工具栏浮动悬停，滚动自适应"),
    ("⌨️", "快捷操作", "空格自动阅读，D 勿扰，F 全屏"),
    ("🌙", "勿扰 + 全屏", "隐藏干扰元素，明 / 暗双主题"),
    ("📊", "阅读统计导出", "时长 · 进度，一键导出 5 种格式"),
    ("📝", "笔记增强", "划线想法聚合，搜索 + 导出"),
    ("🪞", "阅读洞察", "用官方数据生成本机阅读报告"),
    ("🧬", "阅读人格 MBTI", "从你读过的书算出人格代码"),
]

SHARE_CHIPS = ["本地找书", "新手引导", "诊断日志", "帮助中心", "隐私安全 · 不收集数据"]

# 主图取「阅读人格」面板（最抓眼、且本身就是为朋友圈分享做的功能）；
# 取景框避开顶部工具条，完整框住人格卡（比例贴合 800×460 取景框）。
SHARE_HERO_BOX = (0.245, 0.50, 0.756, 0.97)


def build_share():
    feats = "".join(
        '<div class="feat"><div class="b">%s</div><div><div class="t">%s</div><div class="d">%s</div></div></div>' % f
        for f in SHARE_FEATS)
    chips = "".join('<span class="chip">%s</span>' % c for c in SHARE_CHIPS)
    body = (
        '<div class="share">'
        '<div class="head"><div class="brand"><img src="__ICON__">'
        '<div><div class="name">微信悦读</div><div class="en">WEREAD ENHANCER</div></div></div>'
        '<div class="tag">让微信读书网页版，更好读</div>'
        '<div class="chips">%s</div></div>'
        '<div class="mid"><div class="shot"><img src="__SHOT__"></div>'
        '<div class="feats">%s</div></div>'
        '<div class="foot">'
        '<div class="row">Edge 商店搜索 <span class="k">微信悦读</span> 即可安装</div>'
        '<div class="meta">官网 reader.chesterlee.cn · GPL-3.0 开源 · 不收集任何数据</div>'
        '</div></div>'
    ) % (chips, feats)
    body = (body.replace("__ICON__", icon_uri())
                # 主图取景框裁剪源约 1470px 宽，而 800 CSS × 3 倍渲染 = 2400 设备像素，
                # 交给 Chrome 放大必糊；先 PIL 高质量放大到 2400 再交给 Chrome（upscale=True）。
                .replace("__SHOT__", uri_crop(SRC["persona"], SHARE_HERO_BOX, max_width=2400, upscale=True)))
    # 分享图以文字版式为主：3 倍超采样 + 降回后轻锐化，清晰度最佳。
    render(page(1080, 1440, body, SHARE_CSS),
           os.path.join(OUT_GITHUB, "share-1080x1440.png"), 1080, 1440, scale=3, final=(1080, 1440), sharpen=110)


# ------------------------------------------- 小红书图文（1080x1440，3:4 竖版，可多图连发）

# 小红书笔记主图以 3:4 竖版（1080x1440）最稳，单篇最多 18 张。
# 这里出一套「封面 + 分主题」的系列图，全面覆盖各项功能，直接连发即可。
# 产物直接落到渠道包 marketing/小红书/（与 release/360-素材/ 同属「渠道素材」，不另存副本）。
OUT_XHS = os.path.join(ROOT, "marketing", "小红书")

XHS_CSS = """
.post{width:100%;height:100%;display:flex;flex-direction:column;background:#EEF3FF}
.head{flex:0 0 auto;position:relative;overflow:hidden;padding:44px 56px 32px;
      background:linear-gradient(120deg,#08235E 0%,#1E52D6 46%,#2F6BFF 78%,#6FA8FF 100%)}
.head:before{content:"";position:absolute;width:520px;height:520px;border-radius:50%;top:-260px;right:-140px;
      background:radial-gradient(circle,rgba(255,255,255,.20),rgba(255,255,255,0) 68%)}
.kicker{position:relative;z-index:2;display:inline-block;font-size:23px;font-weight:700;color:#EAF1FF;
      background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32);border-radius:999px;padding:8px 20px}
.tt{position:relative;z-index:2;margin-top:18px;font-size:58px;font-weight:900;color:#fff;line-height:1.18;letter-spacing:1px}
.sub{position:relative;z-index:2;margin-top:14px;font-size:26px;color:#DCE8FF;line-height:1.45}
.body{flex:1 1 auto;display:flex;flex-direction:column;gap:24px;padding:30px 56px 0;overflow:hidden}
.shot{flex:0 0 500px;border-radius:24px;overflow:hidden;background:#fff;border:1px solid #D3E0FF;
      box-shadow:0 18px 40px rgba(30,80,200,.18)}
.shot img{width:100%;height:100%;object-fit:cover;object-position:top center}
.feats{flex:1 1 auto;display:grid;grid-auto-rows:1fr;gap:18px}
.feat{display:flex;align-items:center;gap:22px;background:#fff;border:1px solid #DDE7FF;border-radius:20px;
      padding:0 26px;box-shadow:0 6px 16px rgba(30,80,200,.07)}
.feat .e{flex:0 0 64px;height:64px;border-radius:18px;display:flex;align-items:center;justify-content:center;
      font-size:32px;background:linear-gradient(140deg,#2F6BFF,#5B9BFF);box-shadow:0 8px 18px rgba(47,107,255,.3)}
.feat .t{font-size:31px;font-weight:800;color:#12203A;letter-spacing:.5px}
.feat .d{font-size:23px;color:#586C91;margin-top:6px;line-height:1.35}
.foot{flex:0 0 104px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 56px;
      background:linear-gradient(100deg,#0C2C74 0%,#1E52D6 55%,#2F6BFF 100%)}
.foot .l{display:flex;align-items:center;gap:14px}
.foot img{width:50px;height:50px;border-radius:13px}
.foot .n{font-size:25px;font-weight:800;color:#fff;letter-spacing:1px}
.foot .m{font-size:19px;color:#D6E4FF;margin-top:2px}
.foot .r{font-size:22px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);
      border:1px solid rgba(255,255,255,.42);border-radius:12px;padding:9px 18px;white-space:nowrap}
"""

# 小红书取景框：与商店截图同源（screenshots/auto/ 的 2880×1800），按比例复用已调好的取景。
# 键名用 SRC 的键（见 _AUTO_SCENE），不是场景文件名。
XHS_BOX = {
    "read":          (0.300, 0.000, 1.000, 1.000),
    "width":         (0.239, 0.263, 0.768, 0.750),
    "shortcut":      (0.243, 0.266, 0.760, 0.742),
    "menu":          (0.000, 0.047, 0.747, 0.734),
    "notes":         (0.280, 0.291, 0.730, 0.705),
    "stats":         (0.155, 0.102, 0.856, 0.747),
    "official":      (0.279, 0.270, 0.729, 0.684),
    "persona":       (0.279, 0.385, 0.729, 0.799),
    "shelf":         (0.279, 0.270, 0.729, 0.684),
    "discover":      (0.279, 0.270, 0.729, 0.684),
    "ai":            (0.279, 0.270, 0.729, 0.684),
    "support":       (0.126, 0.153, 0.873, 0.836),
    # —— 补充场景（2026-10 新增，均为真实界面）——
    "focus":         (0.520, 0.000, 1.000, 1.000),
    "diag":          (0.135, 0.156, 0.865, 0.828),
    "fullscreen":    (0.000, 0.000, 1.000, 1.000),
    "help":          (0.000, 0.000, 1.000, 1.000),
}

# (文件名, 角标, 标题, 副标题, 取景 key, [(emoji, 标题, 说明)…], 右下角标)
XHS_POSTS = [
    ("配图-01-封面-1080x1440.png", "微信读书网页版 · 阅读增强", "微信读书网页版\n被我改造了 ✨",
     "10 张图看懂「微信悦读」全部功能", "persona",
     [("📐", "屏占比自由调", "50%–100%，想多宽就多宽"),
      ("📝", "笔记一键导出", "划线想法聚合，还能「读」出来听"),
      ("🧬", "阅读人格 MBTI", "从你读过的书，算出人格代码")],
     "滑动看全部 →"),

    ("配图-02-阅读体验-1080x1440.png", "01 阅读体验", "读起来，终于不「挤」了", "网页版最别扭的几处，一次补齐",
     "width",
     [("📐", "屏占比调节", "50%–100% 自由掌控正文宽度"),
      ("📖", "沉浸阅读", "工具栏浮动悬停，滚动条随手可拖"),
      ("🌙", "勿扰 + 全屏", "隐藏干扰元素，明 / 暗双主题"),
      ("⌨️", "自动阅读 + 快捷键", "空格开读 · D 勿扰 · F 全屏")],
     "01/15"),

    ("配图-03-笔记与朗读-1080x1440.png", "02 笔记 & 朗读", "划过的线，别让它躺着", "聚合 · 搜索 · 复制 · 导出 · 听",
     "notes",
     [("📝", "笔记一键聚合", "按章节归好，关键词秒定位"),
      ("📤", "复制 / 导出", "Markdown / HTML / PDF 都能出"),
      ("🔊", "语音复习", "把笔记「读」出来，通勤也能复习")],
     "02/15"),

    ("配图-04-统计与备份-1080x1440.png", "03 统计 & 备份", "你读了多少，数据说了算", "时长 / 进度 / 报表，一键带走",
     "stats",
     [("📊", "阅读统计", "今日 / 本周 / 本月 / 本书一目了然"),
      ("📥", "五种格式导出", "HTML / PDF / Markdown / CSV / JSON"),
      ("🗄️", "数据备份", "标签 / 统计 / 设置本地导出与恢复")],
     "03/15"),

    ("配图-05-阅读洞察-1080x1440.png", "04 阅读洞察", "你的阅读，值得一份报告", "官方数据 → 本机生成，可复算",
     "official",
     [("🪞", "阅读行为报告", "时段 / 偏好 / 完读率，深度画像"),
      ("🧬", "阅读人格 MBTI", "4 位代码 + 主称号 + 数据证据"),
      ("🤖", "AI 解读（可选）", "6 家国产大模型润色执行摘要")],
     "04/15"),

    ("配图-06-书架与找书-1080x1440.png", "05 书架 · 找书", "书多了，也能一秒找到", "书架 / 标签 / 搜书 / 评论",
     "shelf",
     [("📚", "书架概览", "电子书 / 专辑 / 公众号分区看"),
      ("🔎", "本地找书", "自己打标签，按拼音首字母搜"),
      ("🔍", "发现与搜书", "推荐 / 公开书评 / 找相似书"),
      ("💭", "评论侧栏", "边读边看这一章的公开评论")],
     "05/15"),

    ("配图-07-隐私与安全-1080x1440.png", "06 隐私 & 安全", "你的阅读数据，只留在本机", "不上传 · 不外发 · 可关统计",
     "support",
     [("🔒", "只读本机", "设置与数据都存本地，不上传"),
      ("📊", "匿名统计可一键关", "默认开启的活跃统计，随手就能关"),
      ("🩺", "诊断日志", "内置日志系统，一键导出 JSON"),
      ("📖", "帮助中心", "教程一站直达，更新还有红点提醒")],
     "06/15"),

    ("配图-08-手机版-1080x1440.png", "07 手机版", "电脑读累了，手机接着看", "阅读报告 + 人格分享图，打开即用",
     "discover",
     [("📱", "H5 即开即用", "浏览器打开，不用装 App"),
      ("📄", "阅读报告", "时长 / 时段 / 偏好，看得懂"),
      ("🎨", "人格分享图", "竖版卡片，随时发朋友圈")],
     "07/15"),

    ("配图-09-安装指南-1080x1440.png", "08 怎么用", "装好打开，马上就能用", "跟着教程几步就能装好",
     "menu",
     [("①", "装个浏览器插件", "照着教程几步就装好"),
      ("②", "打开网页版", "打开微信读书网页版自动生效"),
      ("🎉", "新手引导", "首次打开，几步上手核心玩法"),
      ("③", "手机也能用", "浏览器打开手机版即用")],
     "08/15"),

    ("配图-11-沉浸阅读-1080x1440.png", "10 沉浸阅读", "正文居中，越读越沉", "工具栏浮动悬停，滚动条随手可拖",
     "read",
     [("📖", "沉浸阅读", "滚动模式自适应居中，专注正文"),
      ("🖱️", "悬浮工具栏", "鼠标悬停才现身，不挡字"),
      ("📜", "悬浮滚动条", "随手可拖，长文翻页更快")],
     "10/15"),

    ("配图-12-评论侧栏-1080x1440.png", "11 评论侧栏", "边读边看这一章的评论", "别人怎么想，一屏看到",
     "focus",
     [("💬", "章节评论", "划到哪看到哪，随正文同步"),
      ("👀", "公开书评", "看看大家这一章读出了什么"),
      ("📖", "不打断正文", "侧栏可开可关，读完接着读")],
     "11/15"),

    ("配图-13-调试日志-1080x1440.png", "12 调试日志", "出了问题，一眼看清", "内置统一日志，一键导出 JSON",
     "diag",
     [("🩺", "统一日志", "插件运行记录集中在一处"),
      ("📤", "一键导出", "导出 JSON，排查不靠猜"),
      ("🔒", "只存本机", "日志不上传，随时可清")],
     "12/15"),

    ("配图-14-AI解读-1080x1440.png", "13 AI 解读", "让 AI 把你的阅读讲给你听", "可选 DeepSeek，数字仍本机算",
     "ai",
     [("🤖", "一键生成", "基于你的阅读报告生成解读"),
      ("🧮", "数字本机算", "人格代码由本机规则计算"),
      ("🛟", "失败退回", "AI 不可用自动退回规则文案")],
     "13/15"),

    ("配图-15-帮助中心-1080x1440.png", "14 帮助中心", "不会用？一站看完教程", "主菜单直达配套教程站",
     "help",
     [("📖", "教程一站直达", "从安装到进阶，按需查看"),
      ("🔔", "更新有红点", "静默检查新版本，有更新才提醒"),
      ("🔗", "主菜单直达", "一键打开帮助中心")],
     "14/15"),

    ("配图-16-全屏模式-1080x1440.png", "15 全屏模式", "F 键全屏，只剩书和自己", "保留屏占比与勿扰，退出即恢复",
     "fullscreen",
     [("🖥️", "一键全屏", "F 键进入，干净无干扰"),
      ("🎛️", "状态保留", "屏占比 / 勿扰设置照旧生效"),
      ("↩️", "退出恢复", "退出全屏自动回到原样")],
     "15/15"),
]


def _xhs_foot(corner):
    # 小红书判「站外引导」极严（含图片），角标不放任何网址/域名，只留品牌名与一句定位。
    return (
        '<div class="foot"><div class="l"><img src="%s">'
        '<div><div class="n">微信悦读</div><div class="m">网页版阅读增强</div></div></div>'
        '<div class="r">%s</div></div>' % (icon_uri(), corner)
    )


def build_xhs():
    for name, kicker, title, sub, key, feats, corner in XHS_POSTS:
        # 取景裁剪后约 1500px 宽，而 1000 CSS × 2 倍渲染 = 2000 设备像素，
        # 先 PIL 高质量放大再交给 Chrome，避免浏览器临时放大发虚。
        shot = uri_crop(SRC[key], XHS_BOX[key], max_width=2000, upscale=True)
        feats_html = "".join(
            '<div class="feat"><div class="e">%s</div><div><div class="t">%s</div><div class="d">%s</div></div></div>' % f
            for f in feats)
        body = (
            '<div class="post"><div class="head"><div class="kicker">%s</div>'
            '<div class="tt">%s</div><div class="sub">%s</div></div>'
            '<div class="body"><div class="shot"><img src="%s"></div><div class="feats">%s</div></div>'
            '%s</div>'
        ) % (kicker, title.replace("\n", "<br>"), sub, shot, feats_html, _xhs_foot(corner))
        render(page(1080, 1440, body, XHS_CSS),
               os.path.join(OUT_XHS, name), 1080, 1440, scale=2, final=(1080, 1440), sharpen=100)


# 阅读人格分享图 × 小红书：竖版分享图按 3:4 取景铺满，底部另起一条品牌栏（不压图面文字）。
XHS_SHARE_CSS = """
.fb{width:100%;height:100%;display:flex;flex-direction:column;background:#EEF3FF}
.fb .imgwrap{flex:1 1 auto;overflow:hidden;background:linear-gradient(150deg,#E7EFFF,#F7FAFF)}
.fb .imgwrap img{width:100%;height:100%;object-fit:cover;object-position:top center}
.fb .foot{flex:0 0 104px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 56px;
      background:linear-gradient(100deg,#0C2C74 0%,#1E52D6 55%,#2F6BFF 100%)}
.fb .foot .l{display:flex;align-items:center;gap:14px}
.fb .foot img{width:50px;height:50px;border-radius:13px}
.fb .foot .n{font-size:25px;font-weight:800;color:#fff;letter-spacing:1px}
.fb .foot .m{font-size:19px;color:#D6E4FF;margin-top:2px}
.fb .foot .r{font-size:22px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);
      border:1px solid rgba(255,255,255,.42);border-radius:12px;padding:9px 18px;white-space:nowrap}
"""


def build_xhs_share():
    body = (
        '<div class="fb"><div class="imgwrap"><img src="%s"></div>'
        '<div class="foot"><div class="l"><img src="%s">'
        '<div><div class="n">微信悦读</div><div class="m">手机版 · 一键生成分享图</div></div></div>'
        '<div class="r">09/15</div></div></div>'
    ) % (uri(SRC["persona-share"], 2160), icon_uri())
    render(page(1080, 1440, body, XHS_SHARE_CSS),
           os.path.join(OUT_XHS, "配图-10-阅读人格分享图-1080x1440.png"), 1080, 1440, scale=2, final=(1080, 1440), sharpen=90)


# ------------------------------------------------- 小红书 · 破圈层海报卡（纯排版）
# 破圈内容（提问 / 干货 / 情绪）走「原创设计海报」，而不是界面截图——
# 海报是自己的排版，不存在「伪造界面」问题；真实功能截图仍走上面的 build_xhs()。

XHS_POSTER_CSS = """
.po{position:relative;width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden;
    background:linear-gradient(158deg,#08235E 0%,#1E52D6 50%,#2F6BFF 100%)}
.po:before{content:"";position:absolute;width:780px;height:780px;border-radius:50%;top:-330px;right:-260px;
    background:radial-gradient(circle,rgba(255,255,255,.18),rgba(255,255,255,0) 68%)}
.po:after{content:"";position:absolute;width:640px;height:640px;border-radius:50%;bottom:-330px;left:-240px;
    background:radial-gradient(circle,rgba(130,185,255,.28),rgba(130,185,255,0) 70%)}
.po .kicker{position:relative;z-index:2;align-self:flex-start;margin:104px 0 0 84px;font-size:27px;font-weight:700;
    color:#EAF1FF;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.34);
    border-radius:999px;padding:11px 28px}
.po .mid{position:relative;z-index:2;flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;padding:0 84px}
.po .em{font-size:130px;line-height:1;margin-bottom:26px}
.po .tt{font-size:92px;font-weight:900;color:#fff;line-height:1.24;letter-spacing:2px}
.po .sub{margin-top:36px;font-size:34px;color:#D6E4FF;line-height:1.55}
.po .foot{position:relative;z-index:2;flex:0 0 118px;display:flex;align-items:center;justify-content:space-between;
    gap:16px;padding:0 84px;background:rgba(6,20,58,.5)}
.po .foot .l{display:flex;align-items:center;gap:16px}
.po .foot img{width:56px;height:56px;border-radius:15px}
.po .foot .n{font-size:28px;font-weight:800;color:#fff;letter-spacing:1px}
.po .foot .m{font-size:21px;color:#C6DAFF;margin-top:3px}
.po .foot .r{font-size:24px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);
    border:1px solid rgba(255,255,255,.42);border-radius:12px;padding:10px 20px;white-space:nowrap}
"""

XHS_STEPS_CSS = """
.st{width:100%;height:100%;display:flex;flex-direction:column;background:#F4F7FF}
.st .head{flex:0 0 auto;padding:74px 84px 38px;background:linear-gradient(120deg,#0C2C74 0%,#2F6BFF 100%)}
.st .kicker{font-size:24px;font-weight:700;color:#DCE8FF;letter-spacing:1px}
.st .tt{margin-top:16px;font-size:66px;font-weight:900;color:#fff;line-height:1.22}
.st .list{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:30px;padding:46px 84px 30px}
.st .row{display:flex;align-items:flex-start;gap:30px;background:#fff;border:1px solid #DDE7FF;border-radius:26px;
    padding:36px 38px;box-shadow:0 10px 26px rgba(30,80,200,.08)}
.st .num{flex:0 0 86px;height:86px;border-radius:24px;display:flex;align-items:center;justify-content:center;
    font-size:42px;font-weight:900;color:#fff;background:linear-gradient(140deg,#2F6BFF,#5B9BFF);
    box-shadow:0 8px 18px rgba(47,107,255,.3)}
.st .tx .t{font-size:38px;font-weight:800;color:#12203A;letter-spacing:.5px}
.st .tx .d{margin-top:12px;font-size:27px;color:#586C91;line-height:1.45}
.st .foot{flex:0 0 112px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 84px;
    background:linear-gradient(100deg,#0C2C74 0%,#1E52D6 55%,#2F6BFF 100%)}
.st .foot .l{display:flex;align-items:center;gap:14px}
.st .foot img{width:52px;height:52px;border-radius:13px}
.st .foot .n{font-size:26px;font-weight:800;color:#fff;letter-spacing:1px}
.st .foot .m{font-size:19px;color:#D6E4FF;margin-top:2px}
.st .foot .r{font-size:22px;font-weight:700;color:#fff;background:rgba(255,255,255,.16);
    border:1px solid rgba(255,255,255,.42);border-radius:12px;padding:9px 18px;white-space:nowrap}
"""

# 提问 / 情绪海报：(文件名, 角标, emoji, 主标题(可含\n), 副标题, 右下角标)
XHS_POSTERS = [
    ("配图-破圈-01-阅读人格测试-1080x1440.png", "趣味测试 · MBTI", "🧬",
     "你的阅读人格\n是 16 型里的哪一种？", "用你真正读过的书算出来\n不是问卷，也不瞎编", "A1"),
    ("配图-破圈-02-16型读书人-1080x1440.png", "读书人版 MBTI", "🔮",
     "16 型读书人\n你是哪一个？", "深夜深潜型 · 逛书店的采购员 · 赶集的说书人…", "A2"),
    ("配图-破圈-03-什么时间读书-1080x1440.png", "灵魂拷问", "🌙",
     "你最爱\n什么时间读书？", "数据不会骗你：我一大半阅读时间\n都在晚上 10 点以后", "A3"),
    ("配图-破圈-04-划线没整理-1080x1440.png", "扎心现场", "📝",
     "划线 1000 条\n一条没整理？", "说的是你吗（也说的是以前的我）", "A4"),
    ("配图-破圈-05-年度报告-1080x1440.png", "年末回顾", "📊",
     "你的年度报告\n暴露了你是哪种人", "读了多少、爱读什么，一目了然", "A5"),
    ("配图-情绪-01-深夜读书-1080x1440.png", "深夜读物", "🕯️",
     "深夜读书\n是成年人的仪式感", "世界安静下来，才轮到自己", "D1"),
    ("配图-情绪-02-周五晚上-1080x1440.png", "周末仪式", "🍵",
     "周五晚上：\n一杯茶、一本书、一台电脑", "这大概就是我要的生活", "D2"),
    ("配图-情绪-03-自我投资-1080x1440.png", "价值共鸣", "🌱",
     "读书\n是最便宜的自我投资", "几十块，换一个人的几年", "D3"),
    ("配图-情绪-04-电脑桌面-1080x1440.png", "生活切片", "💻",
     "我的电脑桌面\n藏着我的阅读习惯", "你的是什么样？", "D4"),
    ("配图-情绪-05-通勤听书-1080x1440.png", "通勤场景", "🚇",
     "通勤 40 分钟\n我用「听笔记」读完一本", "碎片时间，也能复习自己的书", "D5"),
]

# 干货步骤卡：(文件名, 角标, 标题, [(序号, 小标题, 说明)…], 右下角标)
XHS_STEPS = [
    ("配图-干货-01-三步笔记法-1080x1440.png", "读书方法", "划线之后怎么办？3 步整理法",
     [("1", "一键聚合", "本书划线 / 想法，按章节自动归好"),
      ("2", "搜索筛选", "关键词实时定位，选中就能复制"),
      ("3", "导出 / 听", "导出 Markdown，或把笔记「读」出来听")],
     "A9"),
    ("配图-干货-02-听笔记-1080x1440.png", "碎片时间", "把笔记「读」出来听",
     [("1", "聚合本书笔记", "划线 + 想法，按章节排好"),
      ("2", "选一段播放", "本机合成语音，不联网"),
      ("3", "通勤 / 闭眼复习", "走路、地铁上都能过一遍")],
     "A11"),
    ("配图-干货-03-拼音找书-1080x1440.png", "找书技巧", "书多了，一秒找到",
     [("1", "本地给书打标签", "输入即联想，避免标签分裂"),
      ("2", "拼音首字母搜", "rzjx → 认知觉醒"),
      ("3", "书名 / 作者 / 笔记数", "多种条件实时筛选")],
     "B8"),
]


def _xhs_poster(name, kicker, emoji, title, sub, corner):
    body = (
        '<div class="po"><div class="kicker">%s</div>'
        '<div class="mid"><div class="em">%s</div><div class="tt">%s</div><div class="sub">%s</div></div>'
        '%s</div>'
    ) % (kicker, emoji, title.replace("\n", "<br>"), sub.replace("\n", "<br>"), _xhs_foot(corner))
    render(page(1080, 1440, body, XHS_POSTER_CSS),
           os.path.join(OUT_XHS, name), 1080, 1440, scale=2, final=(1080, 1440), sharpen=100)


def _xhs_steps(name, kicker, title, rows, corner):
    rows_html = "".join(
        '<div class="row"><div class="num">%s</div><div class="tx"><div class="t">%s</div>'
        '<div class="d">%s</div></div></div>' % r for r in rows)
    body = (
        '<div class="st"><div class="head"><div class="kicker">%s</div><div class="tt">%s</div></div>'
        '<div class="list">%s</div>%s</div>'
    ) % (kicker, title, rows_html, _xhs_foot(corner))
    render(page(1080, 1440, body, XHS_STEPS_CSS),
           os.path.join(OUT_XHS, name), 1080, 1440, scale=2, final=(1080, 1440), sharpen=100)


def build_xhs_extra():
    """破圈层海报卡（提问 / 情绪 / 干货），供「不带产品」的引流笔记配图。"""
    for name, kicker, emoji, title, sub, corner in XHS_POSTERS:
        _xhs_poster(name, kicker, emoji, title, sub, corner)
    for name, kicker, title, rows, corner in XHS_STEPS:
        _xhs_steps(name, kicker, title, rows, corner)


# ------------------------------------------------------------ 商店宣传磁贴

SMALL_CSS = """
.t{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
   overflow:hidden;background:linear-gradient(140deg,#1E52D6 0%,#2F6BFF 55%,#6FA8FF 100%)}
.t:after{content:"";position:absolute;width:320px;height:320px;border-radius:50%;top:-150px;right:-120px;
   background:radial-gradient(circle,rgba(255,255,255,.24),rgba(255,255,255,0) 70%)}
.logo{width:64px;height:64px;border-radius:16px;box-shadow:0 8px 20px rgba(0,0,0,.28);position:relative;z-index:2}
.name{margin-top:16px;font-size:31px;font-weight:800;color:#fff;letter-spacing:3px;position:relative;z-index:2}
.en{margin-top:7px;font-size:11px;color:#C6DAFF;letter-spacing:3px;position:relative;z-index:2}
.sub{margin-top:14px;font-size:13px;color:#EAF1FF;position:relative;z-index:2}
"""

SMALL_BODY = """
<div class="t">
  <img class="logo" src="__ICON__">
  <div class="name">微信悦读</div>
  <div class="en">WEREAD ENHANCER</div>
  <div class="sub">让微信读书网页版，更好读</div>
</div>
"""

LARGE_CSS = """
.b{position:relative;width:100%;height:100%;padding:0 64px;display:flex;align-items:center;gap:40px;overflow:hidden;
   background:linear-gradient(115deg,#08235E 0%,#1E52D6 44%,#2F6BFF 74%,#74ACFF 100%)}
.b:before{content:"";position:absolute;width:640px;height:640px;border-radius:50%;top:-300px;right:-140px;
   background:radial-gradient(circle,rgba(255,255,255,.2),rgba(255,255,255,0) 68%)}
.b:after{content:"";position:absolute;width:460px;height:460px;border-radius:50%;bottom:-280px;left:-80px;
   background:radial-gradient(circle,rgba(130,185,255,.3),rgba(130,185,255,0) 70%)}
.left{position:relative;z-index:2;flex:1 1 auto;max-width:620px}
.brand{display:flex;align-items:center;gap:18px}
.logo{width:78px;height:78px;border-radius:20px;box-shadow:0 12px 28px rgba(0,0,0,.3)}
.name{font-size:47px;font-weight:800;color:#fff;letter-spacing:3px;line-height:1.05}
.en{font-size:16px;color:#BBD3FF;letter-spacing:3px;margin-top:7px}
.tag{margin-top:22px;font-size:25px;font-weight:600;color:#EAF1FF}
.list{margin-top:22px;display:flex;flex-direction:column;gap:11px}
.item{display:flex;align-items:center;gap:12px;font-size:18px;color:#E7EFFF}
.dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;
   font-size:12px;color:#fff;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5)}
.right{position:relative;z-index:2;flex:0 0 auto;width:530px;height:412px}
.card{position:absolute;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.58);
   box-shadow:0 24px 56px rgba(3,20,60,.48)}
.card img{width:100%;height:100%;object-fit:cover;object-position:center top}
.c1{width:406px;height:254px;right:0;top:6px;transform:rotate(2deg)}
.c2{width:362px;height:226px;left:0;bottom:4px;transform:rotate(-3deg)}
"""

LARGE_BODY = """
<div class="b">
  <div class="left">
    <div class="brand">
      <img class="logo" src="__ICON__">
      <div><div class="name">微信悦读</div><div class="en">WEREAD ENHANCER</div></div>
    </div>
    <div class="tag">让微信读书网页版，更好读</div>
    <div class="list">
      <div class="item"><span class="dot">✓</span>屏占比调节：50%–100% 自由掌控阅读宽度</div>
      <div class="item"><span class="dot">✓</span>自动阅读 + 快捷操作：空格开始 / 暂停</div>
      <div class="item"><span class="dot">✓</span>笔记增强：划线想法一键聚合与导出</div>
      <div class="item"><span class="dot">✓</span>阅读统计 &amp; 阅读洞察：一键导出</div>
      <div class="item"><span class="dot">✓</span>AI 阅读人格：读书人版 MBTI 与手机分享图</div>
    </div>
  </div>
  <div class="right">
    <div class="card c1"><img src="__S1__"></div>
    <div class="card c2"><img src="__S2__"></div>
  </div>
</div>
"""


def build_tiles():
    render(page(440, 280, SMALL_BODY.replace("__ICON__", icon_uri()), SMALL_CSS),
           os.path.join(OUT_STORE, "promo-440x280.png"), 440, 280, scale=SCALE_HI, final=(440, 280))
    body = (LARGE_BODY.replace("__ICON__", icon_uri())
            .replace("__S1__", uri(SRC["width"], 1300))
            .replace("__S2__", uri(SRC["immersive"], 1300)))
    render(page(1400, 560, body, LARGE_CSS),
           os.path.join(OUT_STORE, "promo-1400x560.png"), 1400, 560, scale=SCALE_HI, final=(1400, 560))


# ------------------------------------------------- 商店截图（自带标题栏 1280x800）

SHOT_CSS = """
.w{width:100%;height:100%;display:flex;flex-direction:column;background:#fff}
.bar{flex:0 0 64px;height:64px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;
     background:linear-gradient(100deg,#1E52D6 0%,#2F6BFF 62%,#5B9BFF 100%)}
.bl{display:flex;align-items:center;gap:12px}
.bl img{width:34px;height:34px;border-radius:9px}
.bl .t{font-size:22px;font-weight:700;color:#fff;letter-spacing:1px}
.br{font-size:14px;color:rgba(255,255,255,.85);letter-spacing:1px}
.body{flex:1 1 auto;overflow:hidden}
.body img{width:100%;height:100%;object-fit:cover;object-position:center}
"""

# 商店截图规格固定 1280x800，整窗塞进去功能面板太小、文字发糊，故按功能面板位置裁剪放大。
# box=(l,t,r,b) 为 0~1 比例，围绕面板取景、并让框接近画面比例（体区 1280x736≈1.74），铺满时不裁切内容。
STORE_SHOTS = [
    ("store-01-1280x800.png", "屏占比自由调节", "width",      (0.239, 0.263, 0.768, 0.750)),
    ("store-02-1280x800.png", "沉浸式阅读",     "immersive",  (0.025, 0.060, 0.475, 0.475)),
    ("store-03-1280x800.png", "勿扰模式与主题", "focus",      (0.025, 0.060, 0.475, 0.475)),
    ("store-04-1280x800.png", "快捷操作",       "shortcut",   (0.243, 0.266, 0.760, 0.742)),
    ("store-05-1280x800.png", "诊断日志",       "diag",       (0.135, 0.156, 0.865, 0.828)),
    ("store-06-1280x800.png", "阅读统计与导出", "stats",      (0.155, 0.102, 0.856, 0.747)),
    ("store-07-1280x800.png", "笔记增强",       "notes",      (0.280, 0.291, 0.730, 0.705)),
    ("store-08-1280x800.png", "阅读洞察",     "official",   (0.279, 0.270, 0.729, 0.684)),
    ("store-09-1280x800.png", "功能主菜单",     "menu",       (0.000, 0.047, 0.747, 0.734)),
    ("store-10-1280x800.png", "全屏模式",       "fullscreen", (0.025, 0.005, 0.475, 0.420)),
    ("store-11-1280x800.png", "阅读人格 MBTI",  "persona",    (0.279, 0.385, 0.729, 0.799)),
]


def build_store_shots():
    for name, caption, key, box in STORE_SHOTS:
        body = (
            '<div class="w"><div class="bar"><div class="bl">'
            '<img src="__ICON__"><div class="t">%s</div></div>'
            '<div class="br">微信悦读 · WeRead Enhancer</div></div>'
            '<div class="body"><img src="%s"></div></div>'
        ) % (caption, uri_crop(SRC[key], box, max_width=2600))
        render(page(1280, 800, body.replace("__ICON__", icon_uri()), SHOT_CSS),
               os.path.join(OUT_STORE, name), 1280, 800, scale=STORE_SCALE, final=(1280, 800))


# ------------------------------------------------- 360 商店效果图（560x350）

SHOT360_CSS = """
.w{width:100%;height:100%;display:flex;flex-direction:column;background:#fff}
.bar{flex:0 0 30px;height:30px;padding:0 14px;display:flex;align-items:center;gap:8px;
     background:linear-gradient(100deg,#1E52D6 0%,#2F6BFF 62%,#5B9BFF 100%)}
.bar img{width:18px;height:18px;border-radius:5px}
.bar .t{font-size:14px;font-weight:700;color:#fff;letter-spacing:.5px}
.body{flex:1 1 auto;overflow:hidden}
.body img{width:100%;height:100%;object-fit:cover;object-position:center}
"""

# 360 效果图：统一改用真实书页自动图（screenshots/auto/，1440x900），裁剪框按自动图重新调校。
SHOTS_360 = [
    ("效果图-01-560x350.png", "屏占比自由调节", "width", (0.239, 0.263, 0.769, 0.747)),
    ("效果图-02-560x350.png", "沉浸式阅读", "immersive", (0.025, 0.060, 0.475, 0.471)),
    ("效果图-03-560x350.png", "勿扰模式与主题", "focus", (0.025, 0.060, 0.475, 0.471)),
    ("效果图-04-560x350.png", "快捷操作", "shortcut", (0.242, 0.253, 0.768, 0.734)),
    ("效果图-05-560x350.png", "诊断日志", "diag", (0.126, 0.153, 0.873, 0.836)),
]

SRC_360 = {key: SRC[key] for _, _, key, _ in SHOTS_360}


def build_360_shots():
    for name, caption, key, box in SHOTS_360:
        body = (
            '<div class="w"><div class="bar"><img src="__ICON__"><div class="t">%s</div></div>'
            '<div class="body"><img src="%s"></div></div>'
        ) % (caption, uri_crop(SRC_360[key], box))
        # 源裁剪约 1526px 宽；渲染倍率必须让「设备像素 ≤ 源像素」才不会先被浏览器放大。
        # 560 CSS × 2 = 1120 设备像素 < 1526 → 全程只做「缩小」，再叠加轻锐化，小字最实。
        render(page(560, 350, body.replace("__ICON__", icon_uri()), SHOT360_CSS),
               os.path.join(OUT_360, name), 560, 350, scale=2, final=(560, 350), sharpen=120)


# ------------------------------- 360 创作者中心（平台实际要求，2026-10 实测）
# 与旧文档不同：图标 192×192、封面图小图 472×296、市场推荐图 1120×700（1–5 张）。
# 封面/推荐图与商店截图同为 16:10，直接由 screenshots/store/ 等比缩放，风格一致且最清晰。
PLAT360_COVER = "store-01-1280x800.png"
PLAT360_RECOMM = [
    "store-01-1280x800.png",
    "store-02-1280x800.png",
    "store-04-1280x800.png",
    "store-06-1280x800.png",
    "store-07-1280x800.png",
]


def _fit(src, dst, size):
    im = Image.open(src).convert("RGB")
    tw, th = size
    if im.width / im.height > tw / th:          # 源更宽 → 左右裁
        nw = int(round(im.height * tw / th)); x = (im.width - nw) // 2
        im = im.crop((x, 0, x + nw, im.height))
    else:                                        # 源更高 → 上下裁
        nh = int(round(im.width * th / tw)); y = (im.height - nh) // 2
        im = im.crop((0, y, im.width, y + nh))
    im.resize((tw, th), Image.LANCZOS).save(dst)


def build_360_platform():
    logo_png(192).save(os.path.join(OUT_360, "图标-192x192.png"))
    _fit(os.path.join(OUT_STORE, PLAT360_COVER),
         os.path.join(OUT_360, "封面图小图-472x296.png"), (472, 296))
    for i, name in enumerate(PLAT360_RECOMM, 1):
        _fit(os.path.join(OUT_STORE, name),
             os.path.join(OUT_360, "市场推荐图-%02d-1120x700.png" % i), (1120, 700))


# ------------------------------------------- 微软 Partner Center / Chrome 上传包

# 截图槽位「最多 6 张」，这里挑最能代表产品的 6 张（列表顺序 = 上传顺序）。
# 源文件来自 screenshots/store/（全量），此处只做「按槽位归类」的拷贝，不改内容。
MS_SCREENSHOTS = [
    ("01-屏占比自由调节", "store-01-1280x800.png"),
    ("02-沉浸式阅读",     "store-02-1280x800.png"),
    ("03-快捷操作",       "store-04-1280x800.png"),
    ("04-阅读统计与导出", "store-06-1280x800.png"),
    ("05-笔记增强",       "store-07-1280x800.png"),
    ("06-阅读人格MBTI",   "store-11-1280x800.png"),
]


def _copy(src, dst):
    if not os.path.exists(src):
        raise SystemExit("缺少素材：%s（请先跑 build_store_shots / build_tiles）" % src)
    shutil.copyfile(src, dst)


def build_ms_upload():
    """按 Microsoft Partner Center 的槽位分好文件夹，方便直接上传。

    槽位（来自「合作伙伴中心」要求）：
        扩展徽标      300x300（最小 128，1:1）
        小促销磁贴    440x280
        大促销磁贴    1400x560
        屏幕截图      精确 1280x800 或 640x400，最多 6 张
    """
    # 1) 扩展徽标 300x300（由矢量母版 assets/logo.svg 光栅化，任意尺寸都清晰）
    d1 = os.path.join(OUT_MS, "1-扩展徽标-300x300")
    os.makedirs(d1, exist_ok=True)
    logo_png(300).save(os.path.join(d1, "扩展徽标-300x300.png"))

    # 2) 小促销磁贴 440x280
    d2 = os.path.join(OUT_MS, "2-小促销磁贴-440x280")
    os.makedirs(d2, exist_ok=True)
    _copy(os.path.join(OUT_STORE, "promo-440x280.png"),
          os.path.join(d2, "小促销磁贴-440x280.png"))

    # 3) 大促销磁贴 1400x560
    d3 = os.path.join(OUT_MS, "3-大促销磁贴-1400x560")
    os.makedirs(d3, exist_ok=True)
    _copy(os.path.join(OUT_STORE, "promo-1400x560.png"),
          os.path.join(d3, "大促销磁贴-1400x560.png"))

    # 4) 屏幕截图 1280x800（最多 6 张）
    d4 = os.path.join(OUT_MS, "4-屏幕截图-1280x800-最多6张")
    os.makedirs(d4, exist_ok=True)
    for label, fname in MS_SCREENSHOTS:
        _copy(os.path.join(OUT_STORE, fname), os.path.join(d4, label + "-1280x800.png"))


def build_icons():
    """由矢量母版 assets/logo.svg 重新光栅化仓库里的图标本体与小程序头像。

    这些是「真身」logo（扩展图标 / 小程序头像），不再是展示图里的插画；
    logo 要改只改 assets/logo.svg，重跑本脚本即全部刷新。
    """
    targets = [
        (os.path.join(ROOT, "icons", "icon-16.png"), 16),
        (os.path.join(ROOT, "icons", "icon-48.png"), 48),
        (os.path.join(ROOT, "icons", "icon-128.png"), 128),
        (os.path.join(ROOT, "mobile", "素材", "小程序头像-144x144.png"), 144),
        (os.path.join(ROOT, "release", "360-素材", "图标-48x48.png"), 48),
    ]
    for path, size in targets:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        logo_png(size).save(path)
        print("  ✓ %-46s %dx%d" % (os.path.relpath(path, ROOT), size, size))


def build_h5_icons():
    """H5（PWA）图标：由矢量母版光栅化成 PNG，供「安装成桌面应用 / 加到主屏」。

    浏览器安装 PWA 时更认 PNG 位图（Windows 任务栏 / macOS 程序坞 / 安卓自适应图标），
    只给 SVG 时部分平台会退回默认图标，故与 h5/assets/icon.svg 同款设计另出 192 / 512。
    与 assets/logo.svg 内容一致（同一份矢量母版），改图标只改 SVG，重跑本脚本即刷新。
    """
    for size in (192, 512):
        path = os.path.join(H5_ASSETS, "icon-%d.png" % size)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        logo_png(size).save(path)
        print("  ✓ %-46s %dx%d" % (os.path.relpath(path, ROOT), size, size))


def main():
    if not os.path.exists(CHROME):
        raise SystemExit("未找到 Chrome：%s" % CHROME)
    print("图标本体 → icons/ + mobile/素材/")
    build_icons()
    print("H5（PWA）图标 → h5/assets/")
    build_h5_icons()
    print("GitHub 展示图 → screenshots/promo/")
    build_banner()
    build_cards()
    print("朋友圈 / 群聊分享图 → screenshots/promo/share-1080x1440.png")
    build_share()
    print("小红书图文 → marketing/小红书/")
    build_xhs()
    build_xhs_share()
    build_xhs_extra()
    print("Edge / Chrome 商店素材 → screenshots/store/")
    build_tiles()
    build_store_shots()
    print("360 商店素材 → release/360-素材/")
    build_360_shots()
    print("360 创作者中心素材 → release/360-素材/")
    build_360_platform()
    print("微软 Partner Center 上传包 → release/微软商店-上传/")
    build_ms_upload()
    print("完成。")


if __name__ == "__main__":
    main()
