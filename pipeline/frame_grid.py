"""Footage frames with a u/v grid (image fractions) and the phone's visible crop, for placing spots by eye.

  python pipeline/frame_grid.py <floor> <out.jpg> f1 f2 ...
"""
import json
import pathlib
import subprocess
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
floor, out, fs = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:]]
meta = json.load(open(ROOT / f"app/public/media/walk/{floor}/meta.json"))
VIS_W = (393 / 852) / (720 / 1280) / 1.075
U0, V0 = (1 - VIS_W) / 2, (1 - 1 / 1.075) / 2
tiles = []
for f in fs:
    seg, k = divmod(f, meta["segment_frames"])
    src = ROOT / f"app/public/media/walk/{floor}/sd_{seg:02d}.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"select=eq(n\\,{k})", "-vsync", "0", "-frames:v", "1",
                        "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
    img = np.frombuffer(r.stdout, np.uint8).reshape(1280, 1080, 3)[:, :720].copy()
    for i in range(1, 10):
        x = int(i / 10 * 720); y = int(i / 10 * 1280)
        cv2.line(img, (x, 0), (x, 1279), (255, 255, 255), 1); cv2.line(img, (0, y), (719, y), (255, 255, 255), 1)
        cv2.putText(img, f".{i}", (x + 3, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)
        cv2.putText(img, f".{i}", (5, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 0), 2)
    cv2.rectangle(img, (int(U0 * 720), int(V0 * 1280)), (int((U0 + VIS_W) * 720), int((1 - V0) * 1280)), (0, 255, 0), 2)
    cv2.putText(img, str(f), (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 2, (0, 0, 255), 4)
    tiles.append(cv2.resize(img, (360, 640)))
cv2.imwrite(out, np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])
print(out)
