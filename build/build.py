# -*- coding: utf-8 -*-
"""Assemble the single-file game: template + Matter.js + base64 portraits.

Usage: python build/build.py [output.html]   (default: 合成吴琨石.html)
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, "build")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "合成吴琨石.html")
if not os.path.isabs(OUT):
    OUT = os.path.join(ROOT, OUT)

tpl = open(os.path.join(B, "game.template.html"), encoding="utf-8").read()
matter = open(os.path.join(B, "matter.min.js"), encoding="utf-8").read().strip()
images = json.load(open(os.path.join(B, "images.json"), encoding="utf-8"))

assert "/*__MATTER__*/" in tpl, "matter placeholder missing"
assert "__IMAGES__" in tpl, "images placeholder missing"
assert len(images) == 8, "need 8 images"

img_js = json.dumps(images, ensure_ascii=False, separators=(",", ":"))
html = tpl.replace("/*__MATTER__*/", matter, 1).replace("__IMAGES__", img_js, 1)

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)

print("wrote", OUT)
print("size %.1f KB" % (os.path.getsize(OUT) / 1024))
