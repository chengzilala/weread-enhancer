#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信悦读 · 一键打包脚本

按根目录 manifest.json 的引用，自动收集全部运行文件并打包到 release/。
不再手写文件清单，避免漏打 background.js / modules/ / assets/。
打包前会校验：manifest 引用的文件必须都存在，缺一个就中止并列出。

用法：
    python3 pack.py

产物：
    release/weread-enhancer-v<manifest 版本号>.zip
"""

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.json"
RELEASE_DIR = ROOT / "release"
PLUGIN_NAME = "weread-enhancer"


def collect_runtime_files(manifest):
    """按 manifest.json 的引用顺序收集运行必需文件（相对路径，正斜杠）。"""
    files = []

    def add(path):
        if path and path not in files:
            files.append(path)

    add("manifest.json")

    # Service Worker
    add(manifest.get("background", {}).get("service_worker"))

    # content_scripts 的 js / css（含 modules/ 新模块）
    for cs in manifest.get("content_scripts", []):
        for path in cs.get("js", []):
            add(path)
        for path in cs.get("css", []):
            add(path)

    # 图标
    for path in manifest.get("icons", {}).values():
        add(path)

    # 可被网页访问的资源（打赏 / 反馈 / 公众号二维码等）
    for war in manifest.get("web_accessible_resources", []):
        for path in war.get("resources", []):
            add(path)

    # 说明文件（存在则附带）
    if (ROOT / "README.md").is_file():
        add("README.md")

    return files


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    version = manifest["version"]

    files = collect_runtime_files(manifest)

    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        print("❌ 打包中止：manifest 引用了以下文件，但本地不存在：")
        for f in missing:
            print(f"   - {f}")
        sys.exit(1)

    RELEASE_DIR.mkdir(exist_ok=True)
    zip_path = RELEASE_DIR / f"{PLUGIN_NAME}-v{version}.zip"

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(ROOT / f, arcname=f)

    size_kb = zip_path.stat().st_size / 1024
    print(f"✅ 校验通过：共 {len(files)} 个运行文件")
    print(f"📦 已生成 {zip_path.relative_to(ROOT)}  ({size_kb:.1f} KB)")
    print(f"   版本 v{version}，包内文件：")
    for f in files:
        print(f"   - {f}")


if __name__ == "__main__":
    main()
