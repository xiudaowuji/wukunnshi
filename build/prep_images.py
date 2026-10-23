# -*- coding: utf-8 -*-
"""Crop the 8 portraits into face-centred squares, resize, and export base64 data."""
import base64, json, io, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build")

# number -> (center x fraction, center y fraction, crop size as fraction of min side)
SPEC = {
    1: (0.50, 0.45, 0.84),
    2: (0.50, 0.52, 0.72),
    3: (0.50, 0.60, 0.58),
    4: (0.36, 0.60, 0.64),
    5: (0.38, 0.62, 0.68),
    6: (0.50, 0.42, 0.80),
    7: (0.58, 0.62, 0.62),
    8: (0.33, 0.63, 0.66),
}

SIZE = 240
data = {}
for num, (fx, fy, fs) in SPEC.items():
    src = os.path.join(ROOT, f"{num}.jpg")
    im = Image.open(src).convert("RGB")
    w, h = im.size
    side = min(w, h) * fs
    cx, cy = w * fx, h * fy
    box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
    # clamp inside the image while keeping the square size
    x0 = max(0, min(box[0], w - side))
    y0 = max(0, min(box[1], h - side))
    im = im.crop((int(round(x0)), int(round(y0)), int(round(x0 + side)), int(round(y0 + side))))
    im = im.resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=86, optimize=True, progressive=False)
    raw = buf.getvalue()
    data[str(num)] = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
    print(f"{num}.jpg  src={w}x{h}  crop={side:.0f}px  -> {len(raw)/1024:.1f} KB")

with open(os.path.join(OUT, "images.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
print("total base64 chars:", sum(len(v) for v in data.values()))

# ---- preview sheet: every crop shown as circles at small / medium / large size ----
radii = {8: 14, 7: 18, 6: 23, 5: 29, 4: 36, 3: 45, 2: 55, 1: 68}
S = 2.0
cols = [28, 60, 120]  # diameters in px
cell_w, cell_h = 265, 225
sheet = Image.new("RGB", (cell_w * 4, cell_h * 2 + 20), (24, 22, 30))
d = ImageDraw.Draw(sheet)
for idx, lvl in enumerate(range(8, 0, -1)):
    im = Image.open(io.BytesIO(base64.b64decode(data[str(lvl)].split(",", 1)[1]))).convert("RGB")
    gx, gy = (idx % 4) * cell_w, (idx // 4) * cell_h
    x = gx + 10
    for dia in cols:
        size = int(dia * S)
        thumb = im.resize((size, size), Image.LANCZOS)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
        sheet.paste(thumb, (x, gy + 30 + (240 - size) // 2), mask)
        d.ellipse((x, gy + 30 + (240 - size) // 2, x + size, gy + 30 + (240 - size) // 2 + size),
                  outline=(255, 255, 255, 60), width=1)
        x += size + 8
    d.text((gx + 10, gy + 8), f"L{lvl}  ({lvl}.jpg)", fill=(240, 240, 250))
sheet.save(os.path.join(OUT, "preview.png"))
print("preview written")
