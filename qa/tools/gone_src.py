"""Gone stretches of one audit scenario with the brain's placement source (dbgSrc) during each, and a count of
dissolve / walk-in events.

  python qa/tools/gone_src.py <run> <floor_scenario>
"""
import collections, gzip, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
r = json.load(gzip.open(ROOT / "qa/runs/audit" / sys.argv[1] / "raw" / f"{sys.argv[2]}.json.gz"))
fl = r["floor"]
S = [s for s in r["samples"] if s.get("st") == 1 and s.get("fl") == fl]
run = None; out = []; ev = collections.Counter()
for s in S:
    src = s.get("src") or ""
    for k in ("+prox", "+edge", "+walkin", "+fadein"):
        if k in src: ev[k] += 1
    drawn = (s.get("op") or 0) >= 0.5 and s.get("vis")
    if s.get("bx0") is None:
        ins = 0
    else:
        W, H, ox = s["W"], s["H"], s["ox"]; bx0, bx1, by0, by1 = s["bx0"], s["bx1"], s["by0"], s["by1"]
        ix = max(0, min(bx1, ox + W) - max(bx0, ox)); iy = max(0, min(by1, H) - max(by0, 0)); ins = ix * iy / max(1e-6, (bx1 - bx0) * (by1 - by0))
    g = drawn and ins < 0.6 and not s.get("gl") and not s.get("tr")
    if g:
        if run is None: run = [s["t"], s["t"], s["shown"], collections.Counter()]
        run[1] = s["t"]; run[3][src] += 1
    elif run:
        out.append(run); run = None
tot = 0
for a, b, f, src in out:
    d = (b - a) / 1000 + 1 / 60; tot += d
    print(f"f{f} dur {d:.2f}", dict(src.most_common(3)))
print("total gone s", round(tot, 2), "events", dict(ev))
