#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""半自动发布「少数派」文章（正文走整段粘贴，保留换行）。

为什么有这条脚本
    少数派没有发布 API，页面操作只能靠浏览器。少数派编辑器是「所见即所得」富文本
    （基于 CKEditor），但也支持「粘贴 Markdown 自动转换」。本脚本用「系统真实 Chrome
    带调试端口启动 + Playwright 经 CDP 连上」的方式驱动（与知乎同一套做法），把
    「打开编辑器 → 填标题 → 粘正文 → 传配图 → 填标签」自动化；正文用「整段剪贴板
    粘贴」保证换行不被挤成一坨。

流程
    1. 脚本打开少数派编辑器（浏览器窗口弹出）
    2. 你登录一次（扫码 / 账号），登录态存进 .autoshot/sspai-profile/，之后免登
    3. 脚本自动：填标题 → 粘贴正文 → 上传配图 → 填标签
    4. 停在「发布」前（默认），你核对后自己点；加 --publish 则由脚本点「发布」

正文来源：marketing/少数派/少数派文案.md（单一事实源，文案改了本脚本自动跟着变）。
配图来源：marketing/少数派/帖子/<篇号>-<短标题>/（由 tools/sspai_post_folders.py 生成，
        文件名带 01- 上传序号，第一张＝题图 / 封面）。

用法
    python3 tools/sspai_publish.py --list                 # 列出三篇
    python3 tools/sspai_publish.py --post 篇1             # 填好后停在「发布」前
    python3 tools/sspai_publish.py --post 篇1 --publish   # 连「发布」一起点
    python3 tools/sspai_publish.py --post 篇1 --dry       # 只打印将发布的内容，不开浏览器
    python3 tools/sspai_publish.py --probe                # 打开编辑器并打印可填字段（登录后排查用）

发布前仍需你在浏览器里手动完成（脚本会逐条提示）：
    · 编辑器侧栏的「利益相关声明」开关 → 选「自我宣传」（少数派硬性要求）
    · 题图（若脚本没自动传上，可手动传帖子文件夹里的 01-*.png）
    · 选「立即发布」或「投稿编辑部」

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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROFILE = os.path.join(ROOT, ".autoshot", "sspai-profile")
SSPAI_DIR = os.path.join(ROOT, "marketing", "少数派")
POSTS_DIR = os.path.join(SSPAI_DIR, "帖子")
TEXT_FILE = os.path.join(SSPAI_DIR, "少数派文案.md")

WAIT_LOGIN_SEC = 900
EDITOR_URL = "https://sspai.com/write"

# 少数派用「真实系统 Chrome 带调试端口 + Playwright 经 CDP 连上」的方式驱动，
# 避免被识别为自动化；端口与知乎脚本（9222）错开，两个渠道可同时开。
REAL_BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
DEBUG_PORT = 9223

# 少数派编辑器（CKEditor/wangEditor 皮肤）实测选择器（2026-10-14 --probe 校正）：
#   标题 = textarea.el-textarea__inner（placeholder「请输入标题...」）
#   正文 = .ck-content 可编辑块；配图 = 隐藏 input.upload-input；标签 = input.multiselect__input
TITLE_SELECTORS = [
    'textarea.el-textarea__inner',
    'textarea[placeholder*="请输入标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    '[contenteditable="true"][data-placeholder*="标题"]',
    '.editor-title textarea',
]
BODY_SELECTORS = [
    '.ck-content[contenteditable="true"]',
    '.ck-editor__editable[contenteditable="true"]',
    '.wangEditor-txt[contenteditable="true"]',
    '.x-editor-inst[contenteditable="true"]',
    '.ProseMirror',
    'div[contenteditable="true"]',
]
TAG_SELECTORS = [
    'input.multiselect__input',
    'input[placeholder*="标签"]',
    'input[placeholder*="添加标签"]',
]
UPLOAD_SELECTORS = [
    'input.upload-input',
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
]


# ------------------------------------------------------------------ 读文案

def _md():
    with open(TEXT_FILE, encoding="utf-8") as fh:
        return fh.read()


def _pid_num(pid):
    """把 1 / 篇1 / 篇 1 统一成数字。"""
    return re.search(r"\d+", pid).group(0)


def _pid_folder(pid):
    """篇号 → 发帖文件夹前缀（与 tools/sspai_post_folders.py 的命名一致）。"""
    return "篇%s" % _pid_num(pid)


def _clean_body(text):
    """去掉只给作者看的内部批注（`> 配图建议：…`），返回 (正文, 删除行数)。

    这些行是写作时的配图提示，不该出现在读者看到的正文里；其余 `> 说明` 等保留。
    """
    kept, dropped = [], 0
    for ln in text.split("\n"):
        if re.match(r"^\s*>\s*配图建议", ln):
            dropped += 1
            continue
        kept.append(ln)
    return "\n".join(kept).strip(), dropped


def list_posts():
    md = _md()
    rows = re.findall(r"^\*\*配图（\d+\s*张[^）]*）\s*·\s*(篇\s*\d+)\s*·\s*([^*]+?)\*\*", md, re.M)
    print("可发布篇目（用 --post 篇号 指定）：\n")
    for pid, short in rows:
        print("  --post %-4s  %s" % (pid.replace(" ", ""), short.strip()))
    print()


def load_post(pid):
    """按篇号抽 标题 / 正文 / 标签 / 配图（正文＝配图行之前最近的那个代码块）。"""
    md = _md()
    pat = re.compile(
        r"^\*\*配图（\d+\s*张[^）]*）\s*·\s*(篇\s*%s)\s*·\s*([^*]+?)\*\*\s*[：:]" % _pid_num(pid),
        re.M,
    )
    m = pat.search(md)
    if not m:
        raise SystemExit("❌ 文案里找不到「篇 %s」的配图行，请检查格式（应形如 `**配图（N 张）· 篇 X · 短标题**：…`）。" % _pid_num(pid))
    short = m.group(2).strip()

    # 该篇所在分段：标题 / 正文在「配图」行**之前**（追溯到上一个 ## 标题）；
    # 标签 / 分类在「配图」行**之后**（到下一个 ## 标题为止）。
    start = md.rfind("\n## ", 0, m.start())
    section = md[start if start >= 0 else 0:m.start()]
    nxt = md.find("\n## ", m.end())
    tail = md[m.end():nxt if nxt >= 0 else len(md)]

    m_t = re.search(r"\*\*标题\*\*：(.+)", section)
    if not m_t:
        raise SystemExit("❌ 该篇没有「**标题**：」行，请检查文案格式。")
    title = m_t.group(1).strip()

    m_tags = re.search(r"\*\*标签\s*/\s*分类\*\*：(.+)", tail)
    tags = re.findall(r"`([^`]+)`", m_tags.group(1)) if m_tags else []

    blocks = re.findall(r"```\n(.*?)\n```", section, re.S)
    if not blocks:
        raise SystemExit("❌ 该篇没有正文代码块，请检查文案格式。")
    body, dropped = _clean_body(blocks[-1])

    folder = os.path.join(POSTS_DIR, "%s-%s" % (_pid_folder(pid), short))
    images = []
    if os.path.isdir(folder):
        images = [os.path.join(folder, f) for f in sorted(os.listdir(folder)) if f.lower().endswith(".png")]
    return {
        "pid": _pid_folder(pid), "short": short, "title": title,
        "body": body, "dropped": dropped, "tags": tags, "images": images, "folder": folder,
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


_JS_CLICK_BTN_EXACT = """(label) => {
  const bs = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(b => (b.textContent || '').trim() === label);
  for (const b of bs) {
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) { b.click(); return true; }
  }
  return false;
}"""


def _click_button_exact(page, label):
    """按「按钮文字完全相等」点击（用于「裁切并使用」这类含相似词按钮，避免误点）。"""
    try:
        return bool(page.evaluate(_JS_CLICK_BTN_EXACT, label))
    except Exception:
        return False


def _first_visible(page, selectors, timeout=15000):
    """在候选选择器里找一个「可见」的元素，返回 locator（找不到返回 None）。"""
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        for sel in selectors:
            loc = page.locator(sel)
            n = loc.count()
            for i in range(n):
                el = loc.nth(i)
                try:
                    if el.is_visible():
                        return el
                except Exception:
                    continue
        page.wait_for_timeout(500)
    return None


def _body_editor(page, timeout=15000):
    """返回正文编辑器：候选里**面积最大**的那个可见 contenteditable（主编辑区）。"""
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        js = """(sels) => {
          let best = null, bestArea = 0, idx = -1;
          const all = [];
          for (const s of sels) {
            document.querySelectorAll(s).forEach(e => all.push(e));
          }
          all.forEach((e, i) => {
            const r = e.getBoundingClientRect();
            if (r.width > 80 && r.height > 60) {
              const area = r.width * r.height;
              if (area > bestArea) { bestArea = area; best = i; }
            }
          });
          return best;
        }"""
        try:
            idx = page.evaluate(js, BODY_SELECTORS)
        except Exception:
            idx = -1
        if idx is not None and idx >= 0:
            js_handle = """(args) => {
              const [sels, idx] = args;
              const all = [];
              for (const s of sels) {
                document.querySelectorAll(s).forEach(e => all.push(e));
              }
              const e = all[idx];
              e.scrollIntoView({block: 'center'});
              e.setAttribute('data-sspai-body', '1');
              return true;
            }"""
            try:
                page.evaluate(js_handle, [BODY_SELECTORS, idx])
                return page.locator('[data-sspai-body="1"]').first
            except Exception:
                return None
        page.wait_for_timeout(500)
    return None


def _copy_to_clipboard(text):
    try:
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return True
    except Exception:
        return False


def _probe(page):
    """打印页面上可填字段 / 按钮，便于登录后校正选择器。"""
    try:
        fields = page.eval_on_selector_all(
            "input, textarea, [contenteditable]",
            """els => els.map(e => {
              const r = e.getBoundingClientRect();
              return [e.tagName, e.getAttribute('type') || '', e.getAttribute('placeholder') || '',
                      (e.className || '').toString().slice(0, 60), Math.round(r.width) + 'x' + Math.round(r.height)];
            })""",
        )
        print("\n---- 可填字段（tag / type / placeholder / class / 尺寸）----")
        for row in fields:
            print("  " + " | ".join(str(x) for x in row))
    except Exception as exc:
        print("  ⚠️ 读取字段失败：%s" % exc)
    try:
        btns = page.eval_on_selector_all(
            "button, a, [role='button']",
            "els => els.map(e => e.textContent.trim()).filter(t => t && t.length < 20)",
        )
        uniq = list(dict.fromkeys(btns))
        print("\n---- 按钮 / 链接文字（前 50 个）----")
        print("  " + " | ".join(uniq[:50]))
    except Exception:
        pass
    print("\n---- 关键选择器命中数 / file 输入属性 ----")
    for group, sels in (("title", TITLE_SELECTORS), ("body", BODY_SELECTORS),
                        ("tag", TAG_SELECTORS), ("upload", UPLOAD_SELECTORS)):
        for sel in sels:
            try:
                loc = page.locator(sel)
                n = loc.count()
                extra = ""
                if n and group == "upload":
                    el = loc.first
                    extra = " accept=%r disabled=%s" % (
                        el.get_attribute("accept"), el.get_attribute("disabled"))
                print("  [%s] %-40s → %d%s" % (group, sel, n, extra))
            except Exception as exc:
                print("  [%s] %-40s → err %s" % (group, sel, exc))
    print()


LOGIN_SHOT = os.path.join(ROOT, ".autoshot", "sspai-state.png")
FILLED_SHOT = os.path.join(ROOT, ".autoshot", "sspai-filled.png")


def wait_editor(page, timeout=WAIT_LOGIN_SEC):
    """等编辑器就绪：出现标题输入框即视为「已登录 + 进入编辑器」。"""
    if _first_visible(page, TITLE_SELECTORS, timeout=8000):
        return True
    print("\n👉 需要登录少数派（并完成实名认证）：请在浏览器窗口里扫码 / 账号登录。")
    print("   登录态会存进 .autoshot/sspai-profile/，之后免登。")
    print("   登录成功后，请确认已进入编辑器（网址 %s）；脚本会自动继续……\n" % EDITOR_URL)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _first_visible(page, TITLE_SELECTORS, timeout=3000):
            print("  ✓ 已检测到编辑器。")
            page.wait_for_timeout(1500)
            return True
        try:
            page.screenshot(path=LOGIN_SHOT)
        except Exception:
            pass
        page.wait_for_timeout(4000)
    raise SystemExit("❌ 等待登录 / 编辑器超时（%d 秒）。可重跑本脚本再试。" % WAIT_LOGIN_SEC)


def fill_title(page, title):
    el = _first_visible(page, TITLE_SELECTORS, timeout=8000)
    if el is None:
        print("  ⚠️ 没找到标题输入框，请手动填写标题：%s" % title)
        return False
    try:
        el.click()
        el.fill(title)
        print("  ✓ 标题：%s" % title)
        return True
    except Exception:
        try:
            el.click()
            page.keyboard.type(title, delay=0)
            print("  ✓ 标题（逐字键入）：%s" % title)
            return True
        except Exception as exc:
            print("  ⚠️ 标题填写失败：%s（请手动填：%s）" % (exc, title))
            return False


def fill_body(page, text):
    ed = _body_editor(page)
    if ed is None:
        print("  ⚠️ 没找到正文编辑区，请手动粘贴正文。")
        return False
    try:
        ed.click()
        page.wait_for_timeout(400)
        mod = "Meta" if sys.platform == "darwin" else "Control"
        if _copy_to_clipboard(text):
            page.keyboard.press("%s+a" % mod)
            page.keyboard.press("Backspace")
            page.wait_for_timeout(200)
            page.keyboard.press("%s+v" % mod)
            page.wait_for_timeout(1500)
            print("  ✓ 正文已整段粘贴（%d 字，保留换行）" % len(text))
        else:
            ed.press_sequentially(text, delay=0)
            print("  ✓ 正文已逐字填入（未走剪贴板）")
    except Exception as exc:
        print("  ⚠️ 正文粘贴失败：%s（请手动粘贴正文）" % exc)
        return False
    # 粘贴 Markdown 时编辑器会提示「是否转换」→ 点「立即转换」拿到富文本
    for label in ("立即转换", "转换"):
        if _click_text(page, label):
            print("  ✓ 已点「%s」（Markdown → 富文本）" % label)
            page.wait_for_timeout(800)
            break
    return True


def insert_body_images(page, files):
    """把正文配图插到正文末尾。

    少数派**没有**给正文配图单独的 file input（页面上唯一的 input.upload-input 是「题图」框）。
    正文插图必须走编辑器：光标移到正文末尾 → 新起一个空段落 → 输入 `/` 唤出「插入」菜单 →
    点「图片」（该入口的 file chooser 支持多选）→ 一次把全部图交上去。
    """
    if not files:
        print("  ⚠️ 本篇没有正文配图，跳过。")
        return False
    ed = _body_editor(page)
    if ed is None:
        print("  ⚠️ 没找到正文编辑区，配图请手动拖入：%s"
              % os.path.relpath(os.path.dirname(files[0]), ROOT))
        return False
    try:
        page.evaluate("""() => {
          const ed = document.querySelector('[contenteditable="true"]');
          if (!ed) return;
          ed.focus();
          const r = document.createRange();
          r.selectNodeContents(ed); r.collapse(false);
          const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        }""")
        page.wait_for_timeout(400)
        page.keyboard.press("Enter")          # 新起一个空段落
        page.wait_for_timeout(400)
        page.keyboard.type("/")               # 唤出「插入」菜单
        page.wait_for_timeout(900)
        item = page.locator(".slash-list-item--image").first
        if item.count() == 0 or not item.is_visible():
            page.keyboard.press("Backspace")  # 清掉刚打进去的 「/」
            print("  ⚠️ 没唤出「插入图片」菜单，配图请手动拖入：%s"
                  % os.path.relpath(os.path.dirname(files[0]), ROOT))
            return False
        with page.expect_file_chooser(timeout=6000) as fc:
            item.click()
        fc.value.set_files(files)             # 入口支持多选，一次全部上传
        # 等图片上传完（轮询编辑器内 img 数量，最多等 60 秒）
        deadline = time.time() + 60
        while time.time() < deadline:
            n = page.evaluate('() => document.querySelectorAll(\'[contenteditable="true"] img\').length')
            if n >= len(files):
                break
            page.wait_for_timeout(1500)
        print("  ✓ 已上传 %d 张正文配图（插在正文末尾，可在浏览器里拖动位置）" % len(files))
        return True
    except Exception as exc:
        print("  ⚠️ 正文配图上传失败：%s（请手动把图拖进编辑器：%s）"
              % (exc, os.path.relpath(os.path.dirname(files[0]), ROOT)))
        return False


def set_cover(page, cover):
    """设置题图（封面）。

    少数派题图走页面上的 input.upload-input；选完文件会弹「添加题图」裁切框，
    需再点「裁切并使用」确认。
    """
    if not cover:
        print("  ⚠️ 本篇没有题图，跳过。")
        return False
    loc = page.locator("input.upload-input").first
    if loc.count() == 0:
        print("  ⚠️ 没找到题图上传框，请手动传题图：%s" % os.path.basename(cover))
        return False
    try:
        loc.set_input_files([cover])
        page.wait_for_timeout(3000)
        if _click_button_exact(page, "裁切并使用") or _click_button_exact(page, "确定"):
            page.wait_for_timeout(2000)
        print("  ✓ 题图：%s" % os.path.basename(cover))
        return True
    except Exception as exc:
        print("  ⚠️ 题图上传失败：%s（请手动传 %s）" % (exc, os.path.basename(cover)))
        return False


def fill_tags(page, tags):
    """填标签（vue-multiselect：聚焦输入框 → 键入 → 回车确认即可建标签）。

    标签输入框宽高为 0、不可见，Playwright 直接点不到；实测用 JS `focus()` 能拿到焦点
    （点外层容器反而会把字打进正文）。填前先清掉草稿里已有标签，保证可重复运行。
    """
    if not tags:
        print("  ⚠️ 本篇没写标签，跳过。")
        return False
    if page.locator("input.multiselect__input").count() == 0:
        print("  ⚠️ 没找到标签输入框，请手动添加标签：%s" % " / ".join(tags))
        return False
    try:
        page.evaluate("""() => {
          document.querySelectorAll('.multiselect__tag-icon').forEach(i => i.click());
        }""")
        page.wait_for_timeout(300)
    except Exception:
        pass
    ok = 0
    landed = []
    for t in tags:
        try:
            page.evaluate("""() => {
              const i = document.querySelector('input.multiselect__input');
              if (i) i.focus();
            }""")
            page.wait_for_timeout(300)
            page.keyboard.type(t, delay=50)
            page.wait_for_timeout(700)
            page.keyboard.press("Enter")
            page.wait_for_timeout(600)
            # 少数派标签是站内词表：输入后回车会选中下拉里高亮的那项，可能与所填文字不同，如实回报。
            actual = page.evaluate("""() => {
              const ts = [...document.querySelectorAll('.multiselect__tag')];
              const last = ts[ts.length - 1];
              return last ? last.textContent.replace(/\\s+/g, ' ').trim() : '';
            }""")
            if actual and actual != t:
                print("  ⚠️ 标签「%s」站内匹配为「%s」" % (t, actual))
            landed.append(actual or t)
            ok += 1
        except Exception as exc:
            print("  ⚠️ 标签「%s」填写失败：%s（请手动补）" % (t, exc))
    if ok:
        print("  ✓ 标签：%s" % " / ".join(landed))
        return True
    return False


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
    """确保有「带调试端口的真实 Chrome」在跑，供 Playwright 经 CDP 连上。"""
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
         EDITOR_URL],
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


def _pick_page(ctx):
    for p in ctx.pages:
        if "sspai.com" in (p.url or ""):
            return p
    return ctx.pages[0] if ctx.pages else ctx.new_page()


def main():
    ap = argparse.ArgumentParser(description="半自动发布少数派文章")
    ap.add_argument("--post", default="篇1", help="发哪一篇（篇1 / 篇2 / 篇3），默认 篇1")
    ap.add_argument("--list", action="store_true", help="列出可发布篇目")
    ap.add_argument("--publish", action="store_true", help="连「发布」一起点（默认停在发布前）")
    ap.add_argument("--dry", action="store_true", help="只打印将发布的内容，不打开浏览器")
    ap.add_argument("--probe", action="store_true", help="打开编辑器并打印可填字段（登录后排查用）")
    args = ap.parse_args()

    if args.list:
        list_posts()
        return

    post = load_post(args.post)
    images = post["images"]
    cover = images[0] if images else None
    body_imgs = images[1:]
    print("将发布：%s（%s）" % (post["pid"], post["short"]))
    print("  标题：%s" % post["title"])
    print("  标签：%s" % (" / ".join(post["tags"]) if post["tags"] else "（无）"))
    print("  题图：%s" % (os.path.basename(cover) if cover else "（无）"))
    print("  正文配图：%d 张（%s）" % (len(body_imgs),
          "、".join(os.path.basename(f) for f in body_imgs) or "无"))
    if post["dropped"]:
        print("  （已剔除 %d 行内部批注「> 配图建议」）" % post["dropped"])
    print("  正文：%d 字" % len(post["body"]))
    print("  发帖文件夹：%s" % os.path.relpath(post["folder"], ROOT))
    if args.dry:
        print("\n---- 正文 ----\n%s" % post["body"])
        return

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ 未安装 Playwright。请先执行：\n   python3 -m pip install --user playwright")

    _ensure_chrome()
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % DEBUG_PORT)
        ctx = browser.contexts[0]
        page = _pick_page(ctx)
        try:
            if page.url.split("?")[0].rstrip("/") != EDITOR_URL.rstrip("/"):
                page.goto(EDITOR_URL, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            wait_editor(page)

            if args.probe:
                _probe(page)
                return

            fill_title(page, post["title"])
            fill_body(page, post["body"])
            insert_body_images(page, body_imgs)
            set_cover(page, cover)
            fill_tags(page, post["tags"])

            if not args.publish:
                try:
                    page.screenshot(path=FILLED_SHOT, full_page=False)
                    print("\n  （已存一张填充后的截图：%s）" % os.path.relpath(FILLED_SHOT, ROOT))
                except Exception:
                    pass
                print("\n✅ 已填好，停在「发布」前。请在浏览器里核对：")
                print("   ① 正文格式（Markdown 是否已转富文本、`> 说明` 等是否要保留）")
                print("   ② 题图 = %s；正文配图 %d 张（都插在正文末尾，位置可拖动）"
                      % (os.path.basename(cover) if cover else "（空，请手动传）", len(body_imgs)))
                print("   ③ 侧栏「利益相关声明」开关 → 选「自我宣传」（少数派硬性要求）")
                print("   ④ 标签 / 分类")
                print("   确认无误后，点工具栏「发布」→ 选「立即发布」或「投稿编辑部」。")
                return
            if _click_text(page, "发布"):
                page.wait_for_timeout(1500)
                for label in ("立即发布", "投稿"):
                    if _click_text(page, label):
                        print("  ✓ 已选「%s」…" % label)
                        break
                page.wait_for_timeout(5000)
                print("  ✓ 已提交，当前网址：%s" % page.url)
            else:
                print("  ⚠️ 没找到「发布」按钮，请在浏览器里手动点。")
        except SystemExit:
            raise
        except Exception as exc:
            print("\n⚠️ 自动填写中断：%s" % exc)
            print("   浏览器保持打开，可手动补完；内容见 marketing/少数派/少数派文案.md。\n")

        print("\n👉 浏览器是独立启动的真实 Chrome，核对后自己关掉窗口即可。\n")


if __name__ == "__main__":
    main()
