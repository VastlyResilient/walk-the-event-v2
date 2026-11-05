"""Per-frame depth (Depth Anything V2 Base) + people masks (SegFormer ADE20K 'person').

Runs the networks at 15 fps on the stabilised walk and interpolates to 30 fps. Disparity is
normalised per frame by temporally smoothed percentiles, which removes most flicker.
Writes work/depth/<v>_depth.mp4, <v>_mask.mp4 (360x640 gray) and <v>_depth.json.

  python depth_masks.py <stabilised.mp4> <name>
"""
import json
import pathlib
import subprocess
import sys

import cv2
import numpy as np
import torch
from PIL import Image
from scipy.ndimage import gaussian_filter1d
from transformers import (AutoImageProcessor, AutoModelForDepthEstimation, SegformerForSemanticSegmentation,
                          SegformerImageProcessor)

ROOT = pathlib.Path(__file__).resolve().parent.parent
src, name = sys.argv[1], sys.argv[2]
out = ROOT / "work/depth"
out.mkdir(parents=True, exist_ok=True)
OW, OH = 360, 640
STEP = 2
dev = "mps"
dproc = AutoImageProcessor.from_pretrained("depth-anything/Depth-Anything-V2-Base-hf")
dmodel = AutoModelForDepthEstimation.from_pretrained("depth-anything/Depth-Anything-V2-Base-hf").to(dev).eval()
sproc = SegformerImageProcessor.from_pretrained("nvidia/segformer-b2-finetuned-ade-512-512")
smodel = SegformerForSemanticSegmentation.from_pretrained("nvidia/segformer-b2-finetuned-ade-512-512").to(dev).eval()
PERSON = 12  # ADE20K index for "person"

cap = cv2.VideoCapture(src)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
keys, disp, masks = [], [], []
i = 0
while True:
    ok, f = cap.read()
    if not ok:
        break
    if i % STEP == 0 or i == n - 1:
        im = Image.fromarray(cv2.cvtColor(cv2.resize(f, (540, 960), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))
        with torch.no_grad():
            d = dmodel(**dproc(images=im, return_tensors="pt").to(dev)).predicted_depth[0]
            d = torch.nn.functional.interpolate(d[None, None], (OH, OW), mode="bilinear", align_corners=False)[0, 0]
            logits = smodel(**sproc(images=im, return_tensors="pt").to(dev)).logits
            logits = torch.nn.functional.interpolate(logits, (OH, OW), mode="bilinear", align_corners=False)[0]
            prob = torch.softmax(logits, 0)[PERSON]
        keys.append(i)
        disp.append(d.cpu().numpy().astype(np.float32))
        masks.append((prob.cpu().numpy() * 255).astype(np.uint8))
        if len(keys) % 100 == 0:
            print(name, i, "/", n, flush=True)
    i += 1
n = i
disp = np.stack(disp)
lo = np.percentile(disp.reshape(len(disp), -1), 2, axis=1)
hi = np.percentile(disp.reshape(len(disp), -1), 99.5, axis=1)
lo_s, hi_s = gaussian_filter1d(lo, 4, mode="nearest"), gaussian_filter1d(hi, 4, mode="nearest")
norm = np.clip((disp - lo_s[:, None, None]) / (hi_s - lo_s)[:, None, None], 0, 1)
masks = np.stack(masks)


def writer(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{OW}x{OH}",
                             "-r", "30000/1001", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12",
                             "-pix_fmt", "yuv420p", str(path)], stdin=subprocess.PIPE)


wd, wm = writer(out / f"{name}_depth.mp4"), writer(out / f"{name}_mask.mp4")
keys = np.array(keys)
for fi in range(n):
    j = np.searchsorted(keys, fi)
    if j < len(keys) and keys[j] == fi:
        dd, mm = norm[j], masks[j].astype(np.float32)
    else:
        a, b = j - 1, min(j, len(keys) - 1)
        w = (fi - keys[a]) / max(1, keys[b] - keys[a])
        dd = norm[a] * (1 - w) + norm[b] * w
        mm = masks[a] * (1 - w) + masks[b] * w
    wd.stdin.write((dd * 255).astype(np.uint8).tobytes())
    wm.stdin.write(mm.astype(np.uint8).tobytes())
for w in (wd, wm):
    w.stdin.close()
    w.wait()
json.dump({"frames": n, "step": STEP, "model": "Depth-Anything-V2-Base-hf", "mask_model": "segformer-b2-ade (person)",
           "encoding": "8-bit normalised relative disparity, 0=far 255=near; percentiles smoothed sigma=4 keyframes",
           "lo": lo_s.tolist(), "hi": hi_s.tolist(), "keys": keys.tolist()}, open(out / f"{name}_depth.json", "w"))
print("done", name, n)
