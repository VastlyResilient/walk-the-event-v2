"""Pan lead check: for blocking-track steps in frame ranges, where P(f) falls on the phone screen through the camera
at f+15 and f+30 (fraction of the screen width; outside 0.15-0.85 = left behind by the turn).

  python qa/tools/pan_lead_check.py <blocking json> [floor]
"""
import json, sys
from pathlib import Path
import numpy as np
from scipy.spatial.transform import Rotation as Rot
ROOT = Path(__file__).resolve().parents[2]
B = json.load(open(sys.argv[1])); fl = sys.argv[2] if len(sys.argv) > 2 else B["floor"]
cam = json.load(open(ROOT / f"app/public/data/camera_{fl}.json"))
CP = np.array(cam["pos"]).reshape(-1, 3); R = Rot.from_quat(np.array(cam["quat"]).reshape(-1, 4)).as_matrix(); I = cam["intrinsics"]
VIS_W = (393 / 852) / (720 / 1280) / 1.075; U0 = (1 - VIS_W) / 2
P = np.array([p[:3] for p in B["P"]]); st = B["step"]
for a, b in [(735, 890), (1040, 1220), (1740, 1800), (2270, 2345)]:
    out = 0; n = 0; xs = []
    for i in range(a // st, b // st + 1):
        f = i * st
        for df in (15, 30):
            fF = min(len(CP) - 1, f + df)
            pc = (P[i] - CP[fF]) @ R[fF]; z = -pc[2]
            x = (I["cx"] + I["fx"] * pc[0] / z - U0) / VIS_W if z > 0.8 else -1
            n += 1; xs.append(x); out += (x < 0.15 or x > 0.85)
    print(f"{a}-{b}: future screen x outside 0.15-0.85 in {out}/{n} ({100 * out / max(1, n):.0f} %), x p5/p50/p95 {np.percentile(xs, [5, 50, 95]).round(2)}")
