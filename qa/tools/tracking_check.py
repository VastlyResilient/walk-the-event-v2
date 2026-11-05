"""Blocking-track following error from an audit run: per frame her runtime distance from P(shown frame), and her
screen box vs the solver's planned box (same projection as pipeline/blocking.py, phone viewport + overscan), with
p50 / p95 and how much of the size / offscreen failures coincide with large tracking error.

  python qa/tools/tracking_check.py <run label>
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as Rot

ROOT = Path(__file__).resolve().parents[2]
run = ROOT / "qa/runs/audit" / sys.argv[1]
OVERSCAN = 1.075
for f in sorted((run / "raw").glob("*.json.gz")):
    r = json.load(gzip.open(f))
    fl = r["floor"]
    B = json.load(open(Path(__import__("os").environ.get("BLOCK_DIR", str(ROOT / "app/public/data"))) / f"blocking_{fl}.json"))
    cam = json.load(open(ROOT / f"app/public/data/camera_{fl}.json"))
    P = np.array(cam["pos"]).reshape(-1, 3); Rm = Rot.from_quat(np.array(cam["quat"]).reshape(-1, 4)).as_matrix()
    I = cam["intrinsics"]
    BP = np.array([p[:3] for p in B["P"]]); BF = np.array([p[3] for p in B["P"]])
    S = sorted([s for s in r["samples"] if s.get("fl") == fl], key=lambda s: s["t"])
    g = lambda k: np.array([np.nan if s.get(k) is None else s[k] for s in S], float)
    x, z, sh, op = g("x"), g("z"), g("shown"), g("op")
    by0, by1, bx0, bx1, H, W = g("by0"), g("by1"), g("bx0"), g("bx1"), g("H"), g("W")
    gl = g("gl"); st = g("st")
    ok = (op > 0.5) & (sh >= 0) & (np.nan_to_num(gl) == 0) & (st > 0)
    fr = np.clip(np.nan_to_num(sh), 0, len(BP) * B["step"] - 1)
    xi = fr / B["step"]; i0 = np.minimum(len(BP) - 2, np.floor(xi).astype(int)); t = (xi - i0)[:, None]
    Pf = BP[i0] * (1 - t) + BP[np.minimum(len(BP) - 1, i0 + 1)] * t
    dist = np.hypot(x - Pf[:, 0], z - Pf[:, 2])
    # planned screen box height (fraction of the screen) at P(f)
    sv = 1 / OVERSCAN
    hp = np.full(len(S), np.nan)
    for k in np.where(ok)[0]:
        fi = int(fr[k])
        pc = (Pf[k] - P[fi]) @ Rm[fi]; zz = -pc[2]
        ph = (Pf[k] + [0, 1.62, 0] - P[fi]) @ Rm[fi]; zh = -ph[2]
        if zz < 0.3 or zh < 0.3:
            continue
        vf = I["cy"] - I["fy"] * pc[1] / zz; vh = I["cy"] - I["fy"] * ph[1] / zh
        hp[k] = (vf - vh) / sv
    hr = (by1 - by0) / H
    m = ok & ~np.isnan(dist)
    big = m & (hr > 0.6)
    ins = np.clip(np.minimum(bx1, W) - np.maximum(bx0, 0), 0, None) * np.clip(np.minimum(by1, H) - np.maximum(by0, 0), 0, None) / np.maximum(1e-6, (bx1 - bx0) * (by1 - by0))
    gone = m & (np.isnan(bx0) | (ins < 0.6))
    flagged = m & (BF[i0] % 4 != 0)
    print(f"{fl}/{r['scenario']}: dist her-P p50 {np.nanpercentile(dist[m], 50):.2f} p95 {np.nanpercentile(dist[m], 95):.2f} m; "
          f"height runtime p50 {np.nanpercentile(hr[m], 50):.2f} p95 {np.nanpercentile(hr[m], 95):.2f} vs planned p50 {np.nanpercentile(hp[m], 50):.2f} p95 {np.nanpercentile(hp[m], 95):.2f}; "
          f"too large: {int(big.sum())} frames, dist p50 there {np.nanpercentile(dist[big], 50) if big.any() else 0:.2f}, planned h there {np.nanpercentile(hp[big], 50) if big.any() and not np.all(np.isnan(hp[big])) else float('nan'):.2f}; "
          f"gone: {int(gone.sum())} frames, dist p50 there {np.nanpercentile(dist[gone], 50) if gone.any() else 0:.2f}, on solver-flagged steps {int((gone & flagged).sum())}; "
          f"settled (dist < 0.3): planned vs runtime height ratio p50 {np.nanmedian((hr / hp)[m & (dist < 0.3)]):.3f}")
