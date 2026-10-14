#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信悦读 · 打赏登记后台（本地工具，零第三方依赖）

用法：
    python3 web/admin.py

启动后在浏览器打开 http://localhost:5180 ，用表单添加 / 修改 / 删除打赏记录，
数据直接写入 web/donate.json（与网站构建读的是同一份文件）。

登记完点页面上的「重新构建网站」，再到 web/dist 预览或重新部署线上即可。

说明：本工具只在本机运行，不对外网开放；它不在网站构建产物里（dist 不含它），
     所以不会随官网一起发布，也就不会被别人访问到。
"""

import json
import os
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent
ROOT = WEB.parent
DONATE_JSON = WEB / "donate.json"
BUILD_PY = WEB / "build.py"
PORT = int(os.environ.get("PORT", "5180"))


# ---------- 数据读写 ----------

def load_data():
    """读取 donate.json；文件不存在则返回空结构（保留 _readme / note 等原有键）"""
    if not DONATE_JSON.exists():
        return {"note": "", "updatedAt": "", "records": []}
    with DONATE_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("records", [])
    return data


def save_data(data):
    with DONATE_JSON.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def parse_amount(value):
    """金额：能转数字就转（去掉多余 0），转不了就原样保留为字符串"""
    if isinstance(value, (int, float)):
        return value
    text = str(value if value is not None else "").strip()
    if text == "":
        return 0
    try:
        num = float(text)
        return int(num) if num.is_integer() else num
    except ValueError:
        return text


def norm_record(raw, keep_id=None):
    """把表单数据规整成一条记录（build.py 只读 name/amount/date/message/anonymous，额外 id 会被忽略）"""
    return {
        "id": keep_id or (str(raw.get("id") or "").strip() or uuid.uuid4().hex[:8]),
        "name": str(raw.get("name") or "").strip(),
        "amount": parse_amount(raw.get("amount")),
        "date": str(raw.get("date") or "").strip(),
        "message": str(raw.get("message") or "").strip(),
        "anonymous": bool(raw.get("anonymous")),
    }


def touch(data):
    import datetime
    data["updatedAt"] = datetime.date.today().isoformat()
    return data


# ---------- 页面 ----------

PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>打赏登记 · 微信悦读</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #F5F6F8; color: #1F2430;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 15px; line-height: 1.6;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 28px 18px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #8A8F99; font-size: 13px; margin-bottom: 22px; }
  .card { background: #fff; border-radius: 14px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 6px rgba(31,36,48,.05); }
  .card h2 { font-size: 16px; margin: 0 0 14px; }
  label { display: block; font-size: 13px; color: #4A5060; margin: 12px 0 4px; }
  input[type=text], input[type=number], input[type=date], textarea {
    width: 100%; border: 1px solid #EDEFF3; border-radius: 10px;
    padding: 10px 12px; font-size: 15px; font-family: inherit; background: #FBFCFE; color: #1F2430;
  }
  input:focus, textarea:focus { outline: 2px solid #EAF0FF; border-color: #2F6BFF; }
  textarea { resize: vertical; min-height: 62px; }
  .row { display: flex; gap: 14px; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 150px; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; }
  .check input { width: 16px; height: 16px; }
  .actions { margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; }
  button {
    border: 0; border-radius: 10px; padding: 10px 20px; font-size: 15px; font-family: inherit;
    cursor: pointer; background: #2F6BFF; color: #fff; font-weight: 600;
  }
  button.ghost { background: #fff; color: #2F6BFF; border: 1px solid #2F6BFF; }
  button.small { padding: 5px 12px; font-size: 13px; font-weight: 500; }
  button.danger { background: #fff; color: #E5484D; border: 1px solid #E5484D; }
  button:disabled { opacity: .55; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #EDEFF3; vertical-align: top; }
  th { color: #8A8F99; font-weight: 500; font-size: 13px; }
  td.amount { color: #1a8917; font-weight: 600; white-space: nowrap; }
  td.date { white-space: nowrap; color: #4A5060; }
  td.ops { white-space: nowrap; text-align: right; }
  td.ops button { margin-left: 6px; }
  .msg { color: #4A5060; }
  .anon { color: #8A8F99; font-size: 12px; }
  .empty { color: #8A8F99; text-align: center; padding: 24px 0; }
  .stats { display: flex; gap: 28px; margin-bottom: 6px; }
  .stat b { display: block; font-size: 24px; color: #2F6BFF; }
  .stat span { font-size: 12px; color: #8A8F99; }
  pre.out { background: #0F1013; color: #C9D8FF; padding: 14px; border-radius: 10px; font-size: 12px;
            overflow-x: auto; margin: 12px 0 0; white-space: pre-wrap; }
  .toast { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%);
           background: #1F2430; color: #fff; padding: 10px 20px; border-radius: 999px; font-size: 14px;
           opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: .95; }
  .editing { background: #FFF8EC; }
</style>
</head>
<body>
<div class="wrap">
  <h1>打赏登记</h1>
  <div class="sub">微信悦读 · 本地后台（只在你自己的电脑上运行）。数据直接写入 web/donate.json。</div>

  <div class="card">
    <h2 id="formTitle">添加一笔</h2>
    <div class="row">
      <div>
        <label>昵称（留空显示「读者」）</label>
        <input type="text" id="f-name" placeholder="例如：小王" maxlength="24">
      </div>
      <div>
        <label>金额（元）</label>
        <input type="number" id="f-amount" placeholder="例如：20" step="0.01" min="0">
      </div>
      <div>
        <label>日期</label>
        <input type="date" id="f-date">
      </div>
    </div>
    <label>留言（可留空）</label>
    <textarea id="f-message" placeholder="例如：加油！" maxlength="200"></textarea>
    <div class="check">
      <input type="checkbox" id="f-anon">
      <label for="f-anon" style="margin:0;">匿名（名单里显示为「匿名读者」）</label>
    </div>
    <div class="actions">
      <button id="btnSave">添加</button>
      <button class="ghost" id="btnCancel" style="display:none">取消修改</button>
    </div>
  </div>

  <div class="card">
    <div class="stats">
      <div class="stat"><b id="sTotal">￥0</b><span>累计金额</span></div>
      <div class="stat"><b id="sCount">0</b><span>笔数</span></div>
    </div>
  </div>

  <div class="card">
    <h2>已登记（最新在上）</h2>
    <div id="list"><div class="empty">加载中…</div></div>
  </div>

  <div class="card">
    <h2>发布</h2>
    <div class="sub" style="margin:0 0 12px;">改完点下面的按钮重新构建网站；再到 <a href="http://localhost:5173/donate/" target="_blank">本地预览</a>（需另开 <code>python3 web/serve.py</code>）确认，最后重新部署线上。</div>
    <button id="btnBuild">重新构建网站</button>
    <pre class="out" id="buildOut" style="display:none"></pre>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
let editingId = null;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtMoney(n) {
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : v.toFixed(2).replace(/0+$/, '').replace(/\\.$/, '');
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  return res.json();
}

function resetForm() {
  editingId = null;
  $('formTitle').textContent = '添加一笔';
  $('btnSave').textContent = '添加';
  $('btnCancel').style.display = 'none';
  $('f-name').value = '';
  $('f-amount').value = '';
  $('f-date').value = todayStr();
  $('f-message').value = '';
  $('f-anon').checked = false;
}

function fillForm(r) {
  editingId = r.id;
  $('formTitle').textContent = '修改这笔';
  $('btnSave').textContent = '保存修改';
  $('btnCancel').style.display = '';
  $('f-name').value = r.name || '';
  $('f-amount').value = r.amount || '';
  $('f-date').value = r.date || todayStr();
  $('f-message').value = r.message || '';
  $('f-anon').checked = !!r.anonymous;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function refresh() {
  const data = await api('/api/records');
  const records = data.records || [];
  let total = 0;
  records.forEach((r) => { const v = Number(r.amount); if (isFinite(v)) total += v; });
  $('sTotal').textContent = '￥' + fmtMoney(total);
  $('sCount').textContent = records.length;

  if (!records.length) {
    $('list').innerHTML = '<div class="empty">还没有记录，用上面的表单添加第一笔吧。</div>';
    return;
  }
  const rows = records.slice().reverse().map((r) => {
    const name = r.anonymous ? '匿名读者' : (r.name || '读者');
    return '<tr class="' + (r.id === editingId ? 'editing' : '') + '">'
      + '<td class="date">' + esc(r.date || '') + '</td>'
      + '<td>' + esc(name) + (r.anonymous ? ' <span class="anon">匿名</span>' : '') + '</td>'
      + '<td class="amount">￥' + esc(fmtMoney(r.amount)) + '</td>'
      + '<td class="msg">' + esc(r.message || '') + '</td>'
      + '<td class="ops">'
      + '<button class="ghost small" data-edit="' + esc(r.id) + '">编辑</button>'
      + '<button class="danger small" data-del="' + esc(r.id) + '">删除</button>'
      + '</td></tr>';
  }).join('');
  $('list').innerHTML = '<table><thead><tr>'
    + '<th>日期</th><th>昵称</th><th>金额</th><th>留言</th><th></th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';

  $('list').querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit');
      const r = records.find((x) => x.id === id);
      if (r) fillForm(r);
    });
  });
  $('list').querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-del');
      const r = records.find((x) => x.id === id);
      const label = r ? ((r.anonymous ? '匿名读者' : (r.name || '读者')) + ' ￥' + fmtMoney(r.amount)) : '这条';
      if (!confirm('确定删除「' + label + '」吗？')) return;
      await api('/api/delete', { id });
      if (editingId === id) resetForm();
      toast('已删除');
      refresh();
    });
  });
}

$('btnSave').addEventListener('click', async () => {
  const payload = {
    name: $('f-name').value,
    amount: $('f-amount').value,
    date: $('f-date').value || todayStr(),
    message: $('f-message').value,
    anonymous: $('f-anon').checked,
  };
  if (editingId) payload.id = editingId;
  const res = await api(editingId ? '/api/update' : '/api/add', payload);
  if (res.ok) {
    toast(editingId ? '已保存' : '已添加');
    resetForm();
    refresh();
  } else {
    toast(res.error || '出错了');
  }
});

$('btnCancel').addEventListener('click', resetForm);

$('btnBuild').addEventListener('click', async () => {
  const btn = $('btnBuild');
  btn.disabled = true;
  btn.textContent = '构建中…';
  const res = await api('/api/rebuild', {});
  btn.disabled = false;
  btn.textContent = '重新构建网站';
  const out = $('buildOut');
  out.style.display = '';
  out.textContent = res.output || (res.ok ? '构建完成' : '构建失败');
  toast(res.ok ? '已重新构建' : '构建失败，请看输出');
});

resetForm();
refresh();
</script>
</body>
</html>
"""


# ---------- HTTP 服务 ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "WRE-DonateAdmin/1.0"

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else str(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False))

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE, "text/html; charset=utf-8")
            return
        if self.path == "/api/records":
            data = load_data()
            self._json({"records": data.get("records") or [],
                        "note": data.get("note") or "",
                        "updatedAt": data.get("updatedAt") or ""})
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        body = self._read_body()
        if self.path == "/api/add":
            return self._add(body)
        if self.path == "/api/update":
            return self._update(body)
        if self.path == "/api/delete":
            return self._delete(body)
        if self.path == "/api/rebuild":
            return self._rebuild()
        self._json({"ok": False, "error": "not found"}, 404)

    def _add(self, body):
        data = load_data()
        if body.get("amount") in ("", None) and not str(body.get("name") or "").strip():
            return self._json({"ok": False, "error": "昵称或金额至少填一个"})
        data["records"].append(norm_record(body))
        touch(data)
        save_data(data)
        self._json({"ok": True})

    def _update(self, body):
        rid = str(body.get("id") or "").strip()
        data = load_data()
        for i, r in enumerate(data["records"]):
            if str(r.get("id") or "") == rid:
                data["records"][i] = norm_record(body, keep_id=rid)
                touch(data)
                save_data(data)
                return self._json({"ok": True})
        self._json({"ok": False, "error": "找不到这条记录"})

    def _delete(self, body):
        rid = str(body.get("id") or "").strip()
        data = load_data()
        before = len(data["records"])
        data["records"] = [r for r in data["records"] if str(r.get("id") or "") != rid]
        if len(data["records"]) == before:
            return self._json({"ok": False, "error": "找不到这条记录"})
        touch(data)
        save_data(data)
        self._json({"ok": True})

    def _rebuild(self):
        try:
            proc = subprocess.run(
                [sys.executable, str(BUILD_PY)],
                cwd=str(ROOT), capture_output=True, text=True, timeout=120,
            )
            output = (proc.stdout or "") + (proc.stderr or "")
            self._json({"ok": proc.returncode == 0, "output": output.strip()})
        except Exception as e:  # noqa: BLE001
            self._json({"ok": False, "output": "构建出错：%s" % e})

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    if not BUILD_PY.exists():
        print("❌ 找不到 web/build.py，确认目录是否正确")
        return 1
    url = "http://localhost:%d" % PORT
    with ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("🖥  打赏登记后台：%s" % url)
        print("   数据文件：%s" % DONATE_JSON)
        print("   按 Ctrl+C 停止")
        if not os.environ.get("WRE_NO_BROWSER"):
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
    return 0


if __name__ == "__main__":
    sys.exit(main())
