#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""半自动提交「中国版权保护中心」软件著作权登记（R11 计算机软件著作权登记申请）。

为什么这么做
    版权中心没有开放 API，只能浏览器操作；且登录要短信验证码、要实名核验、
    最后要本人点「提交」——这三步天然只能你来。所以做一个「你登录、脚本填表、
    你点提交」的半自动工具。

技术路线（与 tools/zhihu_publish.py 同一套）
    用「系统真实 Chrome 带调试端口启动 + Playwright 经 CDP 连上」的方式，
    浏览器就是你日常那个 Chrome（登录态存进独立 profile，一次登录之后免登），
    也不会被站点识别成自动化。

分工
    你   ：登录（短信验证码）、实名/人脸核验、最后点「提交」
    脚本 ：打开登记入口、等你登录、自动填表、上传两份 PDF、停在提交前

用法（在项目根目录执行）
    python3 marketing/软著申请/ruanzhu_submit.py --launch        # ① 启动 Chrome 并打开登记入口（你登录）
    python3 marketing/软著申请/ruanzhu_submit.py --dump          # ② 登录后看当前页表单有哪些字段
    python3 marketing/软著申请/ruanzhu_submit.py --list          # 看当前页可点的按钮/链接（找入口用）
    python3 marketing/软著申请/ruanzhu_submit.py --fill          # ③ 按 form_data.json 自动填表
    python3 marketing/软著申请/ruanzhu_submit.py --upload        # ④ 按 form_data.json 上传两份 PDF
    python3 marketing/软著申请/ruanzhu_submit.py --fill --upload # ③④ 一起
    python3 marketing/软著申请/ruanzhu_submit.py --shot          # 截当前页存到 .autoshot/ 便于排查

依赖
    python3 -m pip install --user playwright
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HERE = os.path.dirname(os.path.abspath(__file__))

# 独立 profile：登录态存这里，之后免登（.autoshot/ 已在 .gitignore，绝不入库）
PROFILE = os.path.join(ROOT, ".autoshot", "ruanzhu-profile")
SHOT_DIR = os.path.join(ROOT, ".autoshot")

# 表单数据（含个人信息，已在 .gitignore，不入库）
FORM_DATA = os.path.join(HERE, "form_data.json")

# 登记入口
ENTRY_URL = "https://register.ccopyright.com.cn/registration.html#/registerSoft"
HOME_URL = "https://register.ccopyright.com.cn/registration.html#/index"

REAL_BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]
# 独立端口，避免和 tools/zhihu_publish.py 等脚本的 9222 撞车
DEBUG_PORT = 9333


# ------------------------------------------------------------------ 浏览器（CDP）

def _port_open(port=DEBUG_PORT):
    s = socket.socket()
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _ensure_chrome(url=ENTRY_URL):
    """确保有「带调试端口的真实 Chrome」在跑；没有就启动一个。"""
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
         url],
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


def _connect(pw):
    browser = pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % DEBUG_PORT)
    ctx = browser.contexts[0]
    return ctx, _pick_page(ctx)


def _pick_page(ctx):
    """挑当前要操作的那个标签页：优先版权中心域名，其次最后一个非 chrome:// 页。"""
    pages = [p for p in ctx.pages if not p.url.startswith("chrome")]
    for p in pages:
        if "ccopyright" in p.url:
            return p
    if pages:
        return pages[-1]
    return ctx.new_page()


# ------------------------------------------------------------------ 页面操作

_JS_CLICK_TEXT = """(label) => {
  const ok = (e) => { const t = (e.textContent || '').trim(); return t === label || t.includes(label); };
  const cands = [...document.querySelectorAll('button, a, [role="button"], div, span, li')]
    .filter(ok)
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
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


def _list_clickables(page):
    try:
        rows = page.eval_on_selector_all(
            "button, a, [role='button'], li",
            "els => els.map(e => (e.textContent || '').trim()).filter(t => t && t.length < 24)",
        )
        uniq = list(dict.fromkeys(rows))
        print("  可点文字（前 60 个）：")
        for t in uniq[:60]:
            print("    · %s" % t)
    except Exception as exc:
        print("  ⚠️ 读取失败：%s" % exc)


# 读出页面上可见的表单字段及其标签，用于填表 / 排查
_JS_DUMP_FORM = """() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = (el) => {
    if (el.id) {
      try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim(); } catch (e) {}
    }
    const lp = el.closest('label'); if (lp) return lp.textContent.trim();
    let p = el.parentElement, d = 0;
    while (p && d < 5) {
      const t = p.querySelector('label, .label, .el-form-item__label, .ant-form-item-label, .ivu-form-item-label');
      if (t && t.textContent.trim()) return t.textContent.trim();
      p = p.parentElement; d++;
    }
    return el.placeholder || el.name || el.getAttribute('aria-label') || '';
  };
  const out = [];
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    if (el.type === 'hidden') return;
    if (!vis(el)) return;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.name || '',
      placeholder: el.placeholder || '',
      label: labelOf(el),
      value: String(el.value || '').slice(0, 40),
      required: el.required || false,
    });
  });
  return out;
}"""


def dump_form(page):
    rows = page.evaluate(_JS_DUMP_FORM)
    if not rows:
        print("  （当前页没有可见表单字段——可能还没进到填表页）")
        return
    print("  当前页表单字段（共 %d 个）：" % len(rows))
    for r in rows:
        print("    [%s%s] 标签=%r 占位=%r name=%r 值=%r%s" % (
            r["tag"], ("/" + r["type"]) if r["type"] else "",
            r["label"], r["placeholder"], r["name"], r["value"],
            " *必填" if r["required"] else ""))


# 按「标签包含关键词」自动填值；支持 input/textarea/select，以及 radio/checkbox
_JS_AUTOFILL = """(rules) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = (el) => {
    if (el.id) {
      try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim(); } catch (e) {}
    }
    const lp = el.closest('label'); if (lp) return lp.textContent.trim();
    let p = el.parentElement, d = 0;
    while (p && d < 5) {
      const t = p.querySelector('label, .label, .el-form-item__label, .ant-form-item-label, .ivu-form-item-label');
      if (t && t.textContent.trim()) return t.textContent.trim();
      p = p.parentElement; d++;
    }
    return el.placeholder || el.name || el.getAttribute('aria-label') || '';
  };
  const setVal = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const results = [];
  for (const rule of rules) {
    const kind = rule.type || 'text';
    const want = rule.label || '';
    if (kind === 'radio' || kind === 'checkbox') {
      const cands = [...document.querySelectorAll('input[type="' + kind + '"]')].filter(vis);
      const el = cands.find(e => (labelOf(e) + ' ' + (e.value || '')).includes(rule.value || want));
      if (el) { el.click(); results.push([want, rule.value, 'ok']); }
      else { results.push([want, rule.value, 'MISS']); }
      continue;
    }
    if (kind === 'select') {
      const cands = [...document.querySelectorAll('select')].filter(vis);
      const el = cands.find(e => labelOf(e).includes(want));
      if (el) { setVal(el, rule.value); results.push([want, rule.value, 'ok']); }
      else { results.push([want, rule.value, 'MISS']); }
      continue;
    }
    const cands = [...document.querySelectorAll('input, textarea')]
      .filter(vis).filter(e => e.type !== 'hidden' && e.type !== 'file' && !e.readOnly);
    const el = cands.find(e => labelOf(e).includes(want));
    if (el) { setVal(el, rule.value); results.push([want, rule.value, 'ok']); }
    else { results.push([want, rule.value, 'MISS']); }
  }
  return results;
}"""


def autofill(page, rules):
    res = page.evaluate(_JS_AUTOFILL, rules)
    ok = 0
    for label, value, status in res:
        mark = "✓" if status == "ok" else "✗ 未找到"
        print("    %s %s = %s" % (mark, label, value))
        ok += 1 if status == "ok" else 0
    print("  填表完成：成功 %d / 共 %d" % (ok, len(res)))


def upload(page, rules):
    """按「附近文字包含关键词」把文件塞进对应的 input[type=file]。"""
    for rule in rules:
        label, path = rule.get("label", ""), rule.get("file", "")
        if not os.path.isabs(path):
            path = os.path.join(ROOT, path)
        if not os.path.exists(path):
            print("    ✗ 文件不存在：%s" % path)
            continue
        inputs = page.locator('input[type="file"]')
        n = inputs.count()
        picked = None
        for i in range(n):
            el = inputs.nth(i)
            try:
                txt = el.evaluate(
                    """(e) => { let p = e.parentElement, d = 0;
                        while (p && d < 5) { const s = (p.textContent || '').trim(); if (s) return s; p = p.parentElement; d++; }
                        return ''; }""")
            except Exception:
                txt = ""
            if (not label) or (label in txt):
                picked = i
                break
        if picked is None:
            print("    ✗ 没找到与 %r 匹配的上传框（页面共 %d 个）" % (label, n))
            continue
        try:
            inputs.nth(picked).set_input_files(path)
            print("    ✓ 已上传 %s → %s" % (os.path.basename(path), label or ("文件框#%d" % picked)))
        except Exception as exc:
            print("    ✗ 上传失败（%s）：%s" % (label, exc))


# ------------------------------------------------------------------ 主流程

def _load_form_data():
    if not os.path.exists(FORM_DATA):
        print("  ℹ️ 还没建 %s —— 先照《申请信息清单.md》把信息填成这个 JSON。" % os.path.basename(FORM_DATA))
        return {}
    with open(FORM_DATA, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser(description="半自动提交软著登记（中国版权保护中心）")
    ap.add_argument("--launch", action="store_true", help="启动 Chrome 并打开登记入口（你登录）")
    ap.add_argument("--dump", action="store_true", help="打印当前页表单字段")
    ap.add_argument("--list", action="store_true", help="打印当前页可点的按钮/链接文字")
    ap.add_argument("--fill", action="store_true", help="按 form_data.json 自动填表")
    ap.add_argument("--upload", action="store_true", help="按 form_data.json 上传两份 PDF")
    ap.add_argument("--shot", action="store_true", help="截当前页存到 .autoshot/")
    ap.add_argument("--click", help="点一个文字按钮（找不到入口时用）")
    ap.add_argument("--goto", help="跳到某个网址（默认登记入口）")
    args = ap.parse_args()

    if args.launch:
        _ensure_chrome(ENTRY_URL if not args.goto else args.goto)
        print("\n👉 浏览器已弹出。请在这个窗口里完成登录（短信验证码），然后回来继续：")
        print("   python3 marketing/软著申请/ruanzhu_submit.py --dump\n")
        return

    if not _port_open():
        raise SystemExit(
            "❌ 还没启动带调试端口的浏览器。请先跑：\n"
            "   python3 marketing/软著申请/ruanzhu_submit.py --launch")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ 未安装 Playwright。请先执行：\n   python3 -m pip install --user playwright")

    os.makedirs(SHOT_DIR, exist_ok=True)
    with sync_playwright() as pw:
        ctx, page = _connect(pw)
        try:
            page.bring_to_front()
        except Exception:
            pass

        if args.goto:
            page.goto(args.goto, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
        print("  当前页：%s\n         %s" % (page.title(), page.url))

        if args.click:
            if _click_text(page, args.click):
                print("  ✓ 已点「%s」" % args.click)
                page.wait_for_timeout(2500)
            else:
                print("  ✗ 没找到「%s」；用 --list 看可点文字。" % args.click)
                _list_clickables(page)

        if args.list:
            _list_clickables(page)
        if args.dump:
            dump_form(page)

        data = {}
        if args.fill or args.upload:
            data = _load_form_data()

        if args.fill:
            rules = data.get("fields") or []
            if not rules:
                print("  ℹ️ form_data.json 里没有 fields，跳过填表。")
            else:
                autofill(page, rules)

        if args.upload:
            rules = data.get("uploads") or []
            if not rules:
                print("  ℹ️ form_data.json 里没有 uploads，跳过上传。")
            else:
                upload(page, rules)

        if args.shot:
            path = os.path.join(SHOT_DIR, "ruanzhu-%s.png" % time.strftime("%H%M%S"))
            try:
                client = page.context.new_cdp_session(page)
                data = client.send("Page.captureScreenshot", {"format": "png"})
                import base64
                with open(path, "wb") as fh:
                    fh.write(base64.b64decode(data["data"]))
                print("  ✓ 截图：%s" % path)
            except Exception as exc:
                print("  ⚠️ 截图失败：%s" % exc)

        print("\n👉 核对页面无误后，最后的「提交」由你自己点。浏览器保持打开。\n")


if __name__ == "__main__":
    main()
