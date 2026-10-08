#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成展示素材（GitHub 展示图 + 应用商店素材）。

做法：用 HTML/CSS 写版式，交给本机 Chrome 无头渲染成图，再用 PIL 精确缩放。
不引入任何第三方依赖（只用标准库 + Pillow）。

用法：
    python3 promo.py

产物（一图一岗，对应各上架位置）：
    screenshots/promo/   GitHub 仓库首页（README Banner + 功能亮点卡片，2 倍高清）
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
        '<div class="meta">官网 wereadapp-32km31c.maozi.io · MIT 开源 · 不收集任何数据</div>'
        '</div></div>'
    ) % (chips, feats)
    body = (body.replace("__ICON__", icon_uri())
                # 主图取景框裁剪源约 1470px 宽，而 800 CSS × 3 倍渲染 = 2400 设备像素，
                # 交给 Chrome 放大必糊；先 PIL 高质量放大到 2400 再交给 Chrome（upscale=True）。
                .replace("__SHOT__", uri_crop(SRC["persona"], SHARE_HERO_BOX, max_width=2400, upscale=True)))
    # 分享图以文字版式为主：3 倍超采样 + 降回后轻锐化，清晰度最佳。
    render(page(1080, 1440, body, SHARE_CSS),
           os.path.join(OUT_GITHUB, "share-1080x1440.png"), 1080, 1440, scale=3, final=(1080, 1440), sharpen=110)


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
        render(page(560, 350, body.replace("__ICON__", icon_uri()), SHOT360_CSS),
               os.path.join(OUT_360, name), 560, 350, scale=SCALE_HI, final=(560, 350))


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


def main():
    if not os.path.exists(CHROME):
        raise SystemExit("未找到 Chrome：%s" % CHROME)
    print("图标本体 → icons/ + mobile/素材/")
    build_icons()
    print("GitHub 展示图 → screenshots/promo/")
    build_banner()
    build_cards()
    print("朋友圈 / 群聊分享图 → screenshots/promo/share-1080x1440.png")
    build_share()
    print("Edge / Chrome 商店素材 → screenshots/store/")
    build_tiles()
    build_store_shots()
    print("360 商店素材 → release/360-素材/")
    build_360_shots()
    print("微软 Partner Center 上传包 → release/微软商店-上传/")
    build_ms_upload()
    print("完成。")


if __name__ == "__main__":
    main()
