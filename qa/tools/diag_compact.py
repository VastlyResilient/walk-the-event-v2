"""Compact per-frame view of a guide_diag.py trace.   python qa/tools/diag_compact.py trace.json [every]"""
import json
import sys

D = json.load(open(sys.argv[1]))
every = int(sys.argv[2]) if len(sys.argv) > 2 else 3
L = D["log"]
fr = [r for r in L if r.get("kind") == "frame"]
lo = {r["t"]: r for r in L if r.get("kind") == "loco"}
for r in fr[::every]:
    o = lo.get(r["t"], {})
    print(r["f"], r["src"][:5], "her %s spot %s ->pan %s dist %.2f spd %.2f risk %d err %s vdl %s vd %s hurry %s aL %s lat %s cam %s" % (
        r["herX"], r["spotX"], r["spotXpan"], r["dist"], r["spd"], r["panRisk"], o.get("err"), o.get("vdl"), o.get("vd"), o.get("hurry"), r["aL"], r["aLat"], r["aCam"]))
