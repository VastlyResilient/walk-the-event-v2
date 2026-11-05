"""Extract frames at 2 fps and tile them into labelled contact sheets for visual review."""
import pathlib
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
video, fps_out, per = sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 2.0, 20
name = pathlib.Path(video).stem
out = ROOT / "work/sheets" / name
out.mkdir(parents=True, exist_ok=True)
cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
step = fps / fps_out
tiles, idx = [], 0
targets = [int(round(i * step)) for i in range(int(n / step) + 1)]
ti = 0
f = 0
while ti < len(targets):
    ok, frame = cap.read()
    if not ok:
        break
    if f == targets[ti]:
        t = f / fps
        im = cv2.resize(frame, (216, 384), interpolation=cv2.INTER_AREA)
        cv2.rectangle(im, (0, 0), (92, 26), (0, 0, 0), -1)
        cv2.putText(im, f"{t:6.1f}s", (2, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        tiles.append(im)
        ti += 1
    f += 1
for s in range(0, len(tiles), per):
    grp = tiles[s:s + per]
    while len(grp) < per:
        grp.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(grp[r * 5:(r + 1) * 5]) for r in range(per // 5)]
    cv2.imwrite(str(out / f"sheet_{s // per:02d}.jpg"), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
print(name, len(tiles), "frames ->", out)
