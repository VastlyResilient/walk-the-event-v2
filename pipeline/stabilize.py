"""Gentle 2D stabilisation (similarity transform, Gaussian-smoothed trajectory, fixed light crop).

No gyro metadata survived in the supplied MP4s (no Apple metadata tracks), so Gyroflow is
out and this ffmpeg has no libvidstab. This is the classic KLT + RANSAC similarity approach.

  python stabilize.py <in.mp4> <out.mp4>
Writes <out>.transforms.json with the per-frame correction so overlays can be reproduced.
"""
import json
import subprocess
import sys

import os
import sys as _sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d

_sys.path.insert(0, os.path.dirname(__file__))
from vread import frames as vframes  # noqa: E402

src, dst = sys.argv[1], sys.argv[2]
ZOOM = 1.07          # ~3.5% crop on each side
SIGMA = 18           # frames; keeps the walking rhythm but removes jitter and bob
MAXC = 0.03          # max correction as a fraction of width (beyond this we let the shake through)

cap = cv2.VideoCapture(src)
W, H = int(cap.get(3)), int(cap.get(4))
REUSE = os.environ.get('REUSE') and os.path.exists(dst + '.transforms.json')
fps = cap.get(cv2.CAP_PROP_FPS)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
s = 0.5
prev = None
motion = []
while not REUSE:
    ok, f = cap.read()
    if not ok:
        break
    g = cv2.cvtColor(cv2.resize(f, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    m = [0.0, 0.0, 0.0, 0.0]
    if prev is not None:
        p0 = cv2.goodFeaturesToTrack(prev, 400, 0.01, 12)
        if p0 is not None and len(p0) > 20:
            p1, st, _ = cv2.calcOpticalFlowPyrLK(prev, g, p0, None, winSize=(21, 21), maxLevel=3)
            good = st.ravel() == 1
            if good.sum() > 20:
                A, inl = cv2.estimateAffinePartial2D(p0[good], p1[good], method=cv2.RANSAC, ransacReprojThreshold=2.0)
                if A is not None and inl.sum() > 15:
                    da = np.arctan2(A[1, 0], A[0, 0])
                    ds = np.log(np.hypot(A[0, 0], A[1, 0]))
                    m = [A[0, 2] / s, A[1, 2] / s, da, ds]
    motion.append(m)
    prev = g
if REUSE:
    old = __import__('json').load(open(dst + '.transforms.json'))
    mats = [np.array(m) for m in old['matrices']]
    motion = np.zeros((len(mats), 4)); smooth = np.zeros((len(mats), 4)); corr = np.zeros((len(mats), 4))
else:
  motion = np.array(motion)
  traj = np.cumsum(motion, axis=0)
  smooth = np.stack([gaussian_filter1d(traj[:, i], SIGMA, mode="nearest") for i in range(4)], 1)
  corr = smooth - traj
  lim = MAXC * W
  corr[:, 0] = np.clip(corr[:, 0], -lim, lim)
  corr[:, 1] = np.clip(corr[:, 1], -lim, lim)
  corr[:, 2] = np.clip(corr[:, 2], -0.03, 0.03)
  corr[:, 3] = np.clip(corr[:, 3], -0.03, 0.03)

  mats = []
  for dx, dy, da, ds in corr:
      sc = ZOOM * np.exp(ds)
      c, sn = sc * np.cos(da), sc * np.sin(da)
      # rotate/scale about the centre, then translate by the correction
      M = np.array([[c, -sn, 0], [sn, c, 0]], dtype=np.float64)
      M[:, 2] = np.array([W / 2, H / 2]) - M[:, :2] @ np.array([W / 2, H / 2]) + np.array([dx, dy])
      mats.append(M)

cap = cv2.VideoCapture(src)
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                       "-r", "30000/1001", "-i", "-", "-i", src, "-map", "0:v", "-map", "1:a", "-c:v", "libx264",
                       "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
                       "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "copy", "-shortest", dst],
                      stdin=subprocess.PIPE)
for M, f in zip(mats, vframes(src, W, H)):
    out = cv2.warpAffine(f, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    ff.stdin.write(out.tobytes())
ff.stdin.close()
ff.wait()
json.dump({"zoom": ZOOM, "sigma": SIGMA, "matrices": [M.tolist() for M in mats],
           "raw_motion_px": np.abs(motion[:, :2]).mean(0).tolist(),
           "residual_after_px": np.abs(np.diff(smooth[:, :2], axis=0) - 0).mean(0).tolist()},
          open(dst + ".transforms.json", "w"))
print("stabilised", len(mats), "frames; mean |corr| px", np.abs(corr[:, :2]).mean(0))
