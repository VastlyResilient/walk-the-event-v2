"""Top gone stretches of an audit run (her box < 60 % inside the screen while drawn), with a cause each:
solver-flagged (the track step is beyond tier 2 / a jump / over the speed budget), reversal (the scroll runs backwards),
tracking (she is > 0.8 m from P on a clean step), other.

  python qa/tools/gone_top.py <run label> [n]
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
run = ROOT / "qa/runs/audit" / sys.argv[1]
n_top = int(sys.argv[2]) if len(sys.argv) > 2 else 10
rows = []
for f in sorted((run / "raw").glob("*.json.gz")):
    r = json.load(gzip.open(f))
    fl, sc = r["floor"], r["scenario"]
    B = json.load(open(ROOT / f"app/public/data/blocking_{fl}.json"))
    BP = np.array([p[:3] for p in B["P"]]); BF = np.array([p[3] for p in B["P"]])
    S = sorted([s for s in r["samples"] if s.get("fl") == fl], key=lambda s: s["t"])
    g = lambda k: np.array([np.nan if s.get(k) is None else s[k] for s in S], float)
    x, z, sh, op, gl, ts = g("x"), g("z"), g("shown"), g("op"), g("gl"), g("ts") / 1000
    bx0, bx1, by0, by1, W, H, st = g("bx0"), g("bx1"), g("by0"), g("by1"), g("W"), g("H"), g("st")
    fr = np.clip(np.nan_to_num(sh), 0, len(BP) * B["step"] - 1); i0 = np.minimum(len(BP) - 2, (fr // B["step"]).astype(int))
    t = (fr / B["step"] - i0)[:, None]; Pf = BP[i0] * (1 - t) + BP[i0 + 1] * t
    d = np.hypot(x - Pf[:, 0], z - Pf[:, 2])
    ins = np.clip(np.minimum(bx1, W) - np.maximum(bx0, 0), 0, None) * np.clip(np.minimum(by1, H) - np.maximum(by0, 0), 0, None) / np.maximum(1e-6, (bx1 - bx0) * (by1 - by0))
    drawn = (op >= 0.5) & (np.nan_to_num(gl) == 0) & (st > 0)
    gone = drawn & (np.isnan(bx0) | (ins < 0.6))
    rate = np.gradient(fr, ts)
    i = 0
    while i < len(S):
        if not gone[i]:
            i += 1; continue
        j = i
        while j + 1 < len(S) and gone[j + 1]:
            j += 1
        dur = ts[j] - ts[i]
        seg = slice(i, j + 1)
        flagged = np.mean((BF[i0[seg]] & 15) != 0) > 0.3 or np.mean((BF[i0[seg]] & 3) == 3) > 0.3
        lantern = np.mean((BF[i0[seg]] & 16) != 0) > 0.5
        reversal = np.mean(rate[max(0, i - 30):j + 1] < -2) > 0.2
        cause = "lantern passage" if lantern else "solver-flagged" if flagged else "reversal" if reversal else "tracking" if np.nanmedian(d[seg]) > 0.8 else "other"
        k = i + int(np.argmax(np.nan_to_num(d[seg])))
        rows.append((dur, fl, sc, int(fr[i]), int(fr[j]), cause, float(np.nanmedian(d[seg])), float(np.nanmedian(rate[seg])), round(float(ts[k] - ts[0]), 2), int(fr[k])))
        i = j + 1
rows.sort(reverse=True)
print("dur_s floor scenario frames cause median_dist_from_P_m median_rate_fps t_worst frame_worst")
for r_ in rows[:n_top]:
    print(f"{r_[0]:.2f} {r_[1]} {r_[2]} {r_[3]}-{r_[4]} {r_[5]} {r_[6]:.2f} {r_[7]:.0f} {r_[8]} {r_[9]}")
causes = {}
for r_ in rows:
    causes[r_[5]] = causes.get(r_[5], 0) + r_[0]
print("total gone seconds by cause:", {k: round(v, 1) for k, v in sorted(causes.items(), key=lambda kv: -kv[1])})
