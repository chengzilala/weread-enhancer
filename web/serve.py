#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""微信悦读 · 本地预览服务器（零第三方依赖）

先构建再预览：
    python3 web/build.py
    python3 web/serve.py

默认地址 http://localhost:5173
"""

import http.server
import os
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent / "dist"
PORT = int(os.environ.get("PORT", "5173"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def send_error(self, code, message=None, explain=None):
        if code == 404 and (DIST / "index.html").exists():
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            body = (
                "<!doctype html><meta charset='utf-8'>"
                "<title>404 · 页面不存在</title>"
                "<div style='font-family:-apple-system,sans-serif;max-width:640px;margin:80px auto;padding:0 20px'>"
                "<h1>404 页面不存在</h1>"
                "<p>这个地址在站点里找不到，可能是链接写错了。</p>"
                "<p><a href='/'>回到首页</a></p></div>"
            )
            self.wfile.write(body.encode("utf-8"))
            return
        super().send_error(code, message, explain)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main():
    if not (DIST / "index.html").exists():
        print("❌ 还没构建过：先跑 `python3 web/build.py`")
        return 1
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print("🖥  本地预览：http://localhost:%d" % PORT)
        print("   目录：%s" % DIST)
        print("   按 Ctrl+C 停止")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")
    return 0


if __name__ == "__main__":
    sys.exit(main())
