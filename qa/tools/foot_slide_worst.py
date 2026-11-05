"""Worst foot-slide moments of an audit run: planted (lower) foot speed over the floor while walking, as walk_audit
measures it (ball-of-foot bones tlx/tlz, trx/trz; planted = lower sole, both when within 4 cm), top windows per scenario.

  python qa/tools/foot_slide_worst.py <run label> [top]
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
run = ROOT / "qa/runs/audit" / sys.argv[1]
top = int(sys.argv[2]) if len(sys.argv) > 2 else 5


def col(S, k):
    return np.array([np.nan if s.get(k) is None else s[k] for s in S], float)


def cvel(t, a, half=0.05):
    j = np.clip(np.searchsorted(t, t + half), 0, len(t) - 1)
    k = np.clip(np.searchsorted(t, t - half, side="right") - 1, 0, len(t) - 1)
    dt = t[j] - t[k]
    dt[dt <= 0] = np.nan
    return (a[j] - a[k]) / dt


for f in sorted((run / "raw").glob("*.json.gz")):
    r = json.load(gzip.open(f))
    S = sorted([s for s in r["samples"] if s.get("fl") == r["floor"]], key=lambda s: s["t"])
    if len(S) < 30:
        continue
    t = np.cumsum(np.maximum(np.nan_to_num(col(S, "bdt"), nan=1 / 60), 1 / 60))
    x, z, yaw = col(S, "x"), col(S, "z"), col(S, "yaw")
    spd = np.hypot(cvel(t, x), cvel(t, z))
    solL, solR = col(S, "solL"), col(S, "solR")
    vl = np.hypot(cvel(t, col(S, "tlx")), cvel(t, col(S, "tlz")))
    vr = np.hypot(cvel(t, col(S, "trx")), cvel(t, col(S, "trz")))
    pv = np.where(solL <= solR, vl, vr)
    pv = np.where(np.abs(solL - solR) < 0.04, np.fmin(vl, vr), pv)
    fr = col(S, "shown")
    seam = (r["floor"] == "upstairs") & (fr >= 3495) & (fr <= 3525)  # solve bridge: world positions jump with the camera
    walking = (spd > 0.3) & (spd < 6) & ~seam & (np.nan_to_num(col(S, "wloco"), nan=1) > 0.7) & (np.nan_to_num(col(S, "op"), nan=1) > 0.9)
    contact = np.fmin(solL, solR) - np.nanpercentile(np.fmin(solL, solR), 5) < 0.05
    walking &= contact
    pvw = np.where(walking, pv, np.nan)
    # 0.5 s windows: mean planted-foot speed
    out = []
    i = 0
    while i < len(S):
        j = np.searchsorted(t, t[i] + 0.5)
        seg = pvw[i:j]
        if np.sum(~np.isnan(seg)) > 10:
            out.append((float(np.nanmean(seg)), i, j))
        i = max(j, i + 1)
    out.sort(reverse=True)
    print(f"{r['floor']}/{r['scenario']}: walking p95 {np.nanpercentile(pvw, 95):.2f} m/s")
    for v, a, b in out[:top]:
        m = a + int(np.nanargmax(np.nan_to_num(pvw[a:b], nan=-1)))
        print(f"   frame {int(S[m].get('shown', S[m]['cur']))} t={S[m]['t'] / 1000 if S[m]['t'] > 1e4 else S[m]['t']:.1f}: window mean {v:.2f} m/s, peak {pvw[m]:.2f}; "
              f"root speed {spd[m]:.2f} m/s, yaw rate {abs(cvel(t, np.unwrap(np.nan_to_num(yaw)))[m]):.2f} rad/s, clip {S[m].get('clip')}")
