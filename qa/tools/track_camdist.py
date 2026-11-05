"""Blocking track P: ground distance to the camera at its own frame, distribution and ranges below a limit.

  python qa/tools/track_camdist.py [limit=2.2]
"""
import json, sys
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
lim = float(sys.argv[1]) if len(sys.argv) > 1 else 2.2
for fl in ("downstairs", "upstairs"):
    B = json.load(open(ROOT / f"app/public/data/blocking_{fl}.json"))
    cam = json.load(open(ROOT / f"app/public/data/camera_{fl}.json"))
    CP = np.array(cam["pos"]).reshape(-1, 3)
    P = np.array([p[:3] for p in B["P"]]); F = np.array([p[3] for p in B["P"]])
    fr = np.arange(len(P)) * B["step"]
    ok = fr < len(CP)
    d = np.hypot(P[ok, 0] - CP[fr[ok], 0], P[ok, 2] - CP[fr[ok], 2])
    print(fl, "p5 %.2f p50 %.2f min %.2f; steps < %.1f: %d / %d" % (np.percentile(d, 5), np.percentile(d, 50), d.min(), lim, (d < lim).sum(), len(d)))
    bad = np.where(d < lim)[0]
    rng = []
    for i in bad:
        if rng and i - rng[-1][1] <= 1:
            rng[-1][1] = i
        else:
            rng.append([i, i])
    print("   ", ", ".join(f"{fr[a]}-{fr[b]} ({d[a:b+1].min():.2f})" for a, b in rng))
