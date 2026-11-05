"""Per-sample trace around a frame window: shown frame, camera distance (cd), distance from P(shown), height, opacity.

  python qa/tools/near_probe.py <run> <floor_scenario> <f0> <f1> [every]
"""
import gzip, json, sys
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
run, sc, f0, f1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
every = int(sys.argv[5]) if len(sys.argv) > 5 else 3
r = json.load(gzip.open(ROOT / "qa/runs/audit" / run / "raw" / f"{sc}.json.gz"))
fl = r["floor"]
B = json.load(open(ROOT / f"app/public/data/blocking_{fl}.json"))
BP = np.array([p[:3] for p in B["P"]]); BF = np.array([p[3] for p in B["P"]])
cam = json.load(open(ROOT / f"app/public/data/camera_{fl}.json"))
CP = np.array(cam["pos"]).reshape(-1, 3)
S = sorted([s for s in r["samples"] if s.get("fl") == fl], key=lambda s: s["t"])
k = 0
for s in S:
    sh = s.get("shown")
    if sh is None or sh < f0 or sh > f1:
        continue
    k += 1
    if k % every:
        continue
    xi = sh / B["step"]; i0 = min(len(BP) - 2, int(xi)); t = xi - i0
    P = BP[i0] * (1 - t) + BP[i0 + 1] * t
    d = np.hypot(s["x"] - P[0], s["z"] - P[2]) if s.get("x") is not None else float("nan")
    pc = np.hypot(P[0] - CP[sh][0], P[2] - CP[sh][2])
    h = (s["by1"] - s["by0"]) / s["H"] if s.get("by0") is not None else float("nan")
    print(f"t {s['t']/1000:7.2f} sh {sh:5d} vf {s.get('vf',0):7.1f} gl {s['gl']} op {s.get('op',0):.2f} spd {s.get('spd',0):.2f} cd {s.get('cd',float('nan')):.2f} "
          f"P-cam {pc:.2f} her-P {d:.2f} h {h:.2f} flag {int(BF[i0])} state {s.get('state')} px {s.get('px',0):.0f}")
