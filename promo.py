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

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

OUT_GITHUB = os.path.join(ROOT, "screenshots", "promo")
OUT_STORE = os.path.join(ROOT, "screenshots", "store")
OUT_360 = os.path.join(ROOT, "release", "360-素材")

ICON = os.path.join(ROOT, "icons", "icon-128.png")
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
SCALE_HI = 3      # 高倍渲染：Banner / 卡片 / 磁贴 / 360，超采样后再缩放，边缘更锐
SCALE_STD = 2     # 商店 1280x800 截图：源图仅 2864 宽，3 倍(3840)会超过源分辨率反被放大，故保持 2 倍

_uri_cache = {}


def _encode_uri(im, max_width, key):
    if key in _uri_cache:
        return _uri_cache[key]
    if im.width > max_width:
        im = im.resize((max_width, round(im.height * max_width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=QUALITY, subsampling=0, optimize=True)
    value = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    _uri_cache[key] = value
    return value


def uri(path, max_width=2900):
    """把图片转成内联 data URI。

    ⚠️ max_width 必须 ≥ 该图在页面中的「设备像素宽度」（CSS 宽度 × 渲染倍率），
       否则 <img> 的 object-fit:cover 会把它二次放大，出图就会发虚。
    统一用 JPEG 4:4:4（无色度抽样），避免截图里的小字被色度压缩糊掉。
    """
    return _encode_uri(Image.open(path).convert("RGB"), max_width, (path, max_width))


def uri_crop(path, box, max_width=1800):
    """按比例框裁剪后转 data URI（box=(l, t, r, b)，取值 0~1）。

    用于 360 商店效果图：560x350 太小，整页缩进去文字必然糊，
    所以只截取关键控件区域并铺满画面，让文字在 560 宽下仍可辨认。
    """
    im = Image.open(path).convert("RGB")
    W, H = im.size
    l, t, r, b = box
    im = im.crop((int(l * W), int(t * H), int(r * W), int(b * H)))
    return _encode_uri(im, max_width, (path, box, max_width))


def icon_uri():
    with open(ICON, "rb") as fh:
        return "data:image/png;base64," + base64.b64encode(fh.read()).decode()


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


def render(html, out_path, width, height, scale=2, final=None):
    """用 Chrome 无头渲染 HTML 并截图；final 为最终目标尺寸（None 表示保留 scale 倍图）。"""
    tmp = tempfile.mkdtemp(prefix="wre-promo-")
    try:
        html_path = os.path.join(tmp, "a.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(html)
        shot_path = os.path.join(tmp, "a.png")
        subprocess.run(
            [
                CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb",
                "--force-device-scale-factor=%d" % scale,
                "--window-size=%d,%d" % (width, height),
                "--screenshot=" + shot_path,
                "file://" + html_path,
            ],
            check=True, capture_output=True,
        )
        im = Image.open(shot_path).convert("RGB")
        if final:
            im = im.resize(final, Image.LANCZOS)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        im.save(out_path)
        print("  ✓ %-46s %dx%d" % (os.path.relpath(out_path, ROOT), im.size[0], im.size[1]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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
      <span class="chip">阅读统计</span><span class="chip">官方数据报告</span>
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
    ("feature-08-official.png", "☁️", "官方数据报告", "OFFICIAL DATA",
     "凭 API Key 拉取官方阅读数据，生成本机阅读行为报告，可选 DeepSeek 人格化解读。", "official"),
    ("feature-09-welcome.png", "🎉", "新手引导", "ONBOARDING",
     "首次安装或版本更新自动弹出欢迎面板，几步上手核心玩法。", "welcome"),
    ("feature-10-fullscreen.png", "🖥️", "全屏模式", "FULLSCREEN",
     "F 键一键全屏，保留屏占比与勿扰状态，退出自动恢复原样。", "fullscreen"),
    ("feature-11-menu.png", "🧭", "功能主菜单", "COMMAND MENU",
     "悬浮球悬停即展开，阅读设置、统计、笔记、官方数据一个入口全搞定。", "menu"),
    ("feature-12-support.png", "💗", "支持与反馈", "SUPPORT",
     "内置支持中心，问题反馈与交流入口一步直达。", "support"),
    ("feature-13-api-key.png", "🔑", "API Key 配置", "API KEY",
     "集中管理微信读书 wrk- 与 DeepSeek sk- Key，本地保存、不上传。", "api-key"),
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
      <div class="item"><span class="dot">✓</span>阅读统计 &amp; 官方数据报告：一键导出</div>
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

STORE_SHOTS = [
    ("store-01-1280x800.png", "屏占比自由调节", "width"),
    ("store-02-1280x800.png", "沉浸式阅读", "immersive"),
    ("store-03-1280x800.png", "勿扰模式与主题", "focus"),
    ("store-04-1280x800.png", "快捷操作", "shortcut"),
    ("store-05-1280x800.png", "诊断日志", "diag"),
    ("store-06-1280x800.png", "阅读统计与导出", "stats"),
    ("store-07-1280x800.png", "笔记增强", "notes"),
    ("store-08-1280x800.png", "官方数据报告", "official"),
    ("store-09-1280x800.png", "功能主菜单", "menu"),
    ("store-10-1280x800.png", "全屏模式", "fullscreen"),
]


def build_store_shots():
    for name, caption, key in STORE_SHOTS:
        body = (
            '<div class="w"><div class="bar"><div class="bl">'
            '<img src="__ICON__"><div class="t">%s</div></div>'
            '<div class="br">微信悦读 · WeRead Enhancer</div></div>'
            '<div class="body"><img src="%s"></div></div>'
        ) % (caption, uri(SRC[key], 2900))
        render(page(1280, 800, body.replace("__ICON__", icon_uri()), SHOT_CSS),
               os.path.join(OUT_STORE, name), 1280, 800, scale=SCALE_STD, final=(1280, 800))


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

SHOTS_360 = [
    ("效果图-01-560x350.png", "屏占比自由调节", "width", (0.30, 0.045, 0.70, 0.457)),
    ("效果图-02-560x350.png", "沉浸式阅读", "immersive", (0.02, 0.08, 0.60, 0.678)),
    ("效果图-03-560x350.png", "勿扰模式与主题", "focus", (0.30, 0.00, 0.70, 0.412)),
    ("效果图-04-560x350.png", "快捷操作", "shortcut", (0.30, 0.00, 0.70, 0.412)),
    ("效果图-05-560x350.png", "诊断日志", "diag", (0.22, 0.216, 0.78, 0.793)),
]

# 360 效果图沿用早期手工截图：560x350 太小，其裁剪框是围绕手工图逐张调好的；
# 自动抓图尺寸/版式不同，若直接套用会错位，故这里单独固定用手工图，保持不变。
SRC_360 = {key: _MANUAL_SRC[key] for _, _, key, _ in SHOTS_360}


def build_360_shots():
    for name, caption, key, box in SHOTS_360:
        body = (
            '<div class="w"><div class="bar"><img src="__ICON__"><div class="t">%s</div></div>'
            '<div class="body"><img src="%s"></div></div>'
        ) % (caption, uri_crop(SRC_360[key], box))
        render(page(560, 350, body.replace("__ICON__", icon_uri()), SHOT360_CSS),
               os.path.join(OUT_360, name), 560, 350, scale=SCALE_HI, final=(560, 350))


def main():
    if not os.path.exists(CHROME):
        raise SystemExit("未找到 Chrome：%s" % CHROME)
    print("GitHub 展示图 → screenshots/promo/")
    build_banner()
    build_cards()
    print("Edge / Chrome 商店素材 → screenshots/store/")
    build_tiles()
    build_store_shots()
    print("360 商店素材 → release/360-素材/")
    build_360_shots()
    print("完成。")


if __name__ == "__main__":
    main()
