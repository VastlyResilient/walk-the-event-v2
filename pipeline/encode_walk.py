"""Pack colour + depth + people-mask into one frame and encode scrub-friendly H.264 segments.

Layout per frame (sd tier): [ colour 720x1280 | depth 360x640 over mask 360x640 ]  -> 1080x1280
                  (hd tier): [ colour 1080x1920 | depth 540x960 over mask 540x960 ] -> 1620x1920
Segments are SEG frames long, closed GOP of GOP frames, no B-frames, faststart, so the
WebCodecs frame server can decode any frame from its GOP's keyframe.

  python encode_walk.py <name> [end_seconds]

Face privacy blur: with "all_faces": true in blur_config.json, the per-frame ellipses from
pipeline/faces/<name>_tracks.json (made by face_track.py detect + track) are blurred into the colour panel only.
WALK_OUT=<dir> writes the segments + meta.json somewhere else (tests).
"""
import os
import json
import pathlib
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vread import frames as vframes  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
name = sys.argv[1]
END = float(sys.argv[2]) if len(sys.argv) > 2 else 1e9
SEG, GOP = 300, 10
TIERS = {"sd": (720, 1280, 25), "hd": (1080, 1920, 23)}
out = pathlib.Path(os.environ["WALK_OUT"]) if os.environ.get("WALK_OUT") else ROOT / "app/public/media/walk" / name
out.mkdir(parents=True, exist_ok=True)

col = cv2.VideoCapture(str(ROOT / f"work/stab/{name}.mp4"))
dep = cv2.VideoCapture(str(ROOT / f"work/depth/{name}_depth.mp4"))
msk = cv2.VideoCapture(str(ROOT / f"work/depth/{name}_mask.mp4"))
fps = col.get(cv2.CAP_PROP_FPS)
n = min(int(col.get(cv2.CAP_PROP_FRAME_COUNT)), int(dep.get(cv2.CAP_PROP_FRAME_COUNT)), int(msk.get(cv2.CAP_PROP_FRAME_COUNT)), int(END * fps))


def enc(tier, seg):
    w, h, crf = TIERS[tier]
    W = w + w // 2
    path = out / f"{tier}_{seg:02d}.mp4"
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{h}",
                          "-r", "30000/1001", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
                          "-profile:v", "high", "-pix_fmt", "yuv420p", "-g", str(GOP), "-keyint_min", str(GOP),
                          "-sc_threshold", "0", "-bf", "0", "-x264-params", "open-gop=0",
                          "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                          "-color_range", "tv", "-movflags", "+faststart", "-an", str(path)], stdin=subprocess.PIPE)
    return p, path


_cfg = json.load(open(ROOT / "pipeline/blur_config.json"))
BLUR = [b for b in _cfg["segments"] if b["floor"] == name]
FACES = None
if _cfg.get("all_faces"):
    from face_track import blur_frame, load_tracks  # noqa: E402
    FACES = load_tracks(name)
    assert FACES is not None and len(FACES) >= n, f"run face_track.py detect/track {name} first"
_face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml") if BLUR else None


def blur_faces(img):
    g = cv2.cvtColor(cv2.resize(img, (540, 960)), cv2.COLOR_BGR2GRAY)
    for (x, y, w, h) in _face.detectMultiScale(g, 1.1, 4, minSize=(18, 18)):
        x, y, w, h = [int(v * 2) for v in (x, y, w, h)]
        pad = int(0.25 * w)
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        img[y0:y1, x0:x1] = cv2.GaussianBlur(img[y0:y1, x0:x1], (0, 0), max(8, w / 5))
    return img


colgen = vframes(ROOT / f"work/stab/{name}.mp4", 1080, 1920)
writers = {}
avg_colors = []
sizes = {t: [] for t in TIERS}
for i in range(n):
    seg = i // SEG
    if i % SEG == 0:
        for t, (p, path) in writers.items():
            p.stdin.close(); p.wait(); sizes[t].append(path.stat().st_size)
        writers = {t: enc(t, seg) for t in TIERS}
    c = next(colgen)
    if BLUR and any(b["start_s"] * fps <= i <= b["end_s"] * fps for b in BLUR):
        c = blur_faces(c.copy())
    if FACES is not None and FACES[i]:
        c = blur_frame(c, FACES[i])
    _, d = dep.read()
    _, m = msk.read()
    if i % 15 == 0:
        small = cv2.resize(c, (9, 16), interpolation=cv2.INTER_AREA).reshape(-1, 3)[:, ::-1]
        avg_colors.append([int(v) for v in np.median(small, 0)])
    for t, (p, _) in writers.items():
        w, h, _ = TIERS[t]
        cc = cv2.resize(c, (w, h), interpolation=cv2.INTER_AREA)
        dd = cv2.resize(d, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
        mm = cv2.resize(m, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
        p.stdin.write(np.hstack([cc, np.vstack([dd, mm])]).tobytes())
for t, (p, path) in writers.items():
    p.stdin.close(); p.wait(); sizes[t].append(path.stat().st_size)

meta = {"name": name, "fps": 30000 / 1001, "frames": n, "segment_frames": SEG, "gop": GOP,
        "segments": (n + SEG - 1) // SEG,
        "tiers": {t: {"w": w, "h": h, "packed_w": w + w // 2, "bytes": sizes[t]} for t, (w, h, _) in TIERS.items()},
        "layout": "colour left (w x h); right column: depth (top, w/2 x h/2) over people mask (bottom)",
        "avg_colors_every_15": avg_colors}
json.dump(meta, open(out / "meta.json", "w"))
print(name, n, {t: round(sum(v) / 1e6, 1) for t, v in sizes.items()}, "MB")
