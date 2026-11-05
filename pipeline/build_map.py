"""Illustrated floor plan from the camera solve: vector walls (not points), the walked path, pins.

Walls: top-down occupancy of solved 3D points between 0.25 and 2.6 m, closed/blurred, contoured
and simplified to polylines. Writes app/public/data/map_<name>.json in world metres (x, z).
"""
import json
import pathlib
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
name = sys.argv[1]
cam = json.load(open(ROOT / f"app/public/data/camera_{name}.json"))
beats = json.load(open(ROOT / f"data/beats_{name}.json"))
P = np.array(cam["pos"]).reshape(-1, 3)
conf = np.array(cam["conf"])
fl = np.array(cam["floor_points_xz"])
fps = cam["fps"]
good = conf > 0
last = np.where(good)[0].max()
path = P[: last + 1][:, [0, 2]]
# drop the 100 s+ dark outro downstairs (unsolved, held)
if name == "downstairs":
    path = path[: int(100.4 * fps)]
lo = np.minimum(path.min(0), np.percentile(fl, 1, axis=0)) - 2
hi = np.maximum(path.max(0), np.percentile(fl, 99, axis=0)) + 2
RES = 0.15
W, H = (np.ceil((hi - lo) / RES)).astype(int) + 1
grid = np.zeros((H, W), np.float32)
for x, z in fl:
    i, j = int((z - lo[1]) / RES), int((x - lo[0]) / RES)
    if 0 <= i < H and 0 <= j < W:
        grid[i, j] += 1
grid = cv2.GaussianBlur(grid, (0, 0), 1.6)
occ = (grid > max(0.08, np.percentile(grid[grid > 0], 55))).astype(np.uint8) * 255
occ = cv2.morphologyEx(occ, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
occ = cv2.morphologyEx(occ, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# keep walls off the walked path (a person walked there, so it's open floor)
pathmask = np.zeros_like(occ)
pts = np.int32([((x - lo[0]) / RES, (z - lo[1]) / RES) for x, z in path])
cv2.polylines(pathmask, [pts], False, 255, int(1.2 / RES))
occ[pathmask > 0] = 0
cnts, _ = cv2.findContours(occ, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
walls = []
for c in cnts:
    if cv2.contourArea(c) < 6:
        continue
    a = cv2.approxPolyDP(c, 1.6, True)[:, 0, :]
    walls.append([[round(lo[0] + x * RES, 2), round(lo[1] + y * RES, 2)] for x, y in a])
# simplified path
pc = cv2.approxPolyDP(np.float32(path).reshape(-1, 1, 2), 0.12, False)[:, 0, :]
idx = np.linspace(0, len(path) - 1, 400).astype(int)
out = {
    "name": name,
    "bounds": [round(float(lo[0]), 2), round(float(lo[1]), 2), round(float(hi[0]), 2), round(float(hi[1]), 2)],
    "walls": walls,
    "path": [[round(float(x), 2), round(float(z), 2)] for x, z in pc],
    "path_frames": [[int(i), round(float(path[i, 0]), 2), round(float(path[i, 1]), 2)] for i in idx],
    "chapters": [],
    "stations": [],
}
for c in beats["chapters"]:
    f = min(int(c["start"] * fps) + 3, len(path) - 1)
    out["chapters"].append({"id": c["id"], "title": c["title"], "frame": f, "x": round(float(path[f, 0]), 2), "z": round(float(path[f, 1]), 2)})
if name == "downstairs":
    for s in json.load(open(ROOT / "app/public/data/stations.json"))["stations"]:
        wp = s["world_position"]
        out["stations"].append({"id": s["id"], "title": s["title"], "frame": s["click_frame"], "x": round(wp[0], 2), "z": round(wp[2], 2),
                                "path_x": round(float(path[s["click_frame"], 0]), 2), "path_z": round(float(path[s["click_frame"], 1]), 2)})
json.dump(out, open(ROOT / f"app/public/data/map_{name}.json", "w"))
print(name, len(walls), "wall polylines,", len(out["path"]), "path points")
dbg = cv2.cvtColor(occ, cv2.COLOR_GRAY2BGR)
cv2.polylines(dbg, [pts], False, (0, 0, 255), 2)
cv2.imwrite(str(ROOT / f"work/map_{name}.png"), dbg)
