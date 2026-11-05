"""Her position relative to one nav rail through a frame window of an audit scenario (side + distance), with the
placement source, to find how she got onto / beyond it.

  python qa/tools/rail_trace.py <run> <floor_scenario> <f0> <f1> <rail index in nav rails>
"""
import gzip, json, math, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
run, sc, f0, f1, ri = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
r = json.load(gzip.open(ROOT / "qa/runs/audit" / run / "raw" / f"{sc}.json.gz"))
q = json.load(open(ROOT / f"app/public/data/nav_{r['floor']}.json"))["rails"][ri]
ax, az = q["a"][0], q["a"][2]; ux, uz = q["b"][0] - ax, q["b"][2] - az; L2 = ux * ux + uz * uz
prev = None; k = 0
for s in r["samples"]:
    if f0 <= s.get("shown", -1) <= f1 and s.get("x") is not None:
        x, z = s["x"], s["z"]; t = ((x - ax) * ux + (z - az) * uz) / L2; d = (ux * (z - az) - uz * (x - ax)) / math.sqrt(L2)
        src = s.get("src"); k += 1
        if src != prev or k % 15 == 0:
            print(round(s["t"] / 1000, 2), s["shown"], src, f"({x:.2f},{z:.2f}) t {t:.2f} d {d:+.2f} op {s['op']:.2f} vbi {s.get('vbi', 0):.2f}")
        prev = src
