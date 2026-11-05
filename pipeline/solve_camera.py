"""Camera solve with pycolmap (SIFT + sequential matching + incremental SfM).

Solve copies get CLAHE (not the shipped frames). Frames sampled at SOLVE_FPS.
Writes work/solve/<name>/sparse/<k>/ and data/solve_<name>_raw.json (registered frame poses).

  python solve_camera.py <stabilised.mp4> <name> [fps] [end_seconds]
"""
import json
import pathlib
import shutil
import sys

import cv2
import numpy as np
import pycolmap

ROOT = pathlib.Path(__file__).resolve().parent.parent
src, name = sys.argv[1], sys.argv[2]
SOLVE_FPS = float(sys.argv[3]) if len(sys.argv) > 3 else 6.0
END = float(sys.argv[4]) if len(sys.argv) > 4 else 1e9
START = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
TAG = sys.argv[6] if len(sys.argv) > 6 else name
work = ROOT / "work/solve" / TAG
imgdir = work / "images"
if work.exists():
    shutil.rmtree(work)
imgdir.mkdir(parents=True)

cap = cv2.VideoCapture(src)
fps = cap.get(cv2.CAP_PROP_FPS)
step = fps / SOLVE_FPS
clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
i, nxt, names = 0, 0.0, {}
while True:
    ok, f = cap.read()
    if not ok or i / fps > END:
        break
    if i / fps < START:
        i += 1
        continue
    if i >= nxt - 1e-6 or nxt < START * fps:
        nxt = max(nxt, i)
        g = cv2.resize(f, (540, 960), interpolation=cv2.INTER_AREA)
        lab = cv2.cvtColor(g, cv2.COLOR_BGR2LAB)
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        g = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        fn = f"f{i:05d}.jpg"
        cv2.imwrite(str(imgdir / fn), g, [cv2.IMWRITE_JPEG_QUALITY, 95])
        names[fn] = i
        nxt += step
    i += 1
print("solve frames", len(names), flush=True)

db = work / "db.db"
reader = pycolmap.ImageReaderOptions()
reader.camera_model = "SIMPLE_RADIAL"
ext = pycolmap.FeatureExtractionOptions()
ext.sift.max_num_features = 6000
ext.sift.peak_threshold = 0.004  # relaxed so the dark blue upstairs still yields features
pycolmap.extract_features(db, imgdir, camera_mode=pycolmap.CameraMode.SINGLE, reader_options=reader, extraction_options=ext)
pair = pycolmap.SequentialPairingOptions()
pair.overlap = 20
pair.quadratic_overlap = True
pycolmap.match_sequential(db, pairing_options=pair)
print("matched", flush=True)

opts = pycolmap.IncrementalPipelineOptions()
opts.min_num_matches = 12
opts.multiple_models = True
opts.min_model_size = 15
m = opts.mapper
m.init_min_num_inliers = 60
m.abs_pose_min_num_inliers = 18
m.abs_pose_min_inlier_ratio = 0.15
recs = pycolmap.incremental_mapping(db, imgdir, work / "sparse", opts)
summary = []
models = []
for k, rec in recs.items():
    frames = {}
    for img in rec.images.values():
        if not img.has_pose:
            continue
        cw = img.cam_from_world()
        R = cw.rotation.matrix()
        t = cw.translation
        frames[names[img.name]] = {"R_cw": R.tolist(), "t_cw": t.tolist(),
                                   "pts": [[float(p.xy[0]), float(p.xy[1]), int(p.point3D_id)] for p in img.points2D if p.has_point3D()][::3]}
    cam = list(rec.cameras.values())[0]
    pts = {int(pid): p.xyz.tolist() for pid, p in rec.points3D.items() if p.track.length() >= 3}
    models.append({"id": int(k), "camera": {"model": str(cam.model), "w": cam.width, "h": cam.height, "params": cam.params.tolist()},
                   "frames": frames, "points": pts})
    summary.append((int(k), len(frames), len(pts)))
print("models (id, frames, points):", summary, flush=True)
json.dump({"video_fps": fps, "solve_fps": SOLVE_FPS, "n_solve_frames": len(names), "models": models},
          open(ROOT / f"data/solve_{TAG}_raw.json", "w"))
