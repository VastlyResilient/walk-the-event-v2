"""Round-5 summary of an audit run: pass table for the coordinator's metrics and the worst spans of each failing one.

  python qa/tools/audit_r5.py <label> [metric ...]
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
lab = sys.argv[1]
only = sys.argv[2:]
b = json.load(open(ROOT / "qa/runs/audit" / lab / "summary.json"))
ms = ["size", "proximity", "depth", "blockers_rails", "offscreen", "people", "smooth", "hidden", "teleport", "glide", "snap_turn", "posture", "perf", "float_sink", "foot_slide"]
print("metric        ", " ".join(f"{r['floor'][:2]}/{r['scenario'][:4]}" for r in b["results"]))
for m in ms:
    print(m.ljust(14), " ".join(("P" if r["metrics"].get(m, {"pass": True})["pass"] else "F").center(7) for r in b["results"]))
for m in (only or ["size", "proximity", "depth", "blockers_rails", "offscreen", "people"]):
    print(f"\n== {m}")
    for r in b["results"]:
        mm = r["metrics"].get(m)
        if mm is None:
            continue
        if mm["pass"] and not only:
            continue
        print(f"{r['floor'][:4]}/{r['scenario']}: {mm['value'][:230]}")
        for w in mm.get("worst", [])[:6]:
            print(f"    f{w['frame']} t={w['t_worst']:.1f} dur {w['dur']:.2f} {w['what'][:40]} = {w.get('value')}")
