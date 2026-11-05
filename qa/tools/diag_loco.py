"""Per brain frame locomotion of a guide_diag.py trace in a frame window.   python qa/tools/diag_loco.py trace.json f0 f1"""
import json
import sys

D = json.load(open(sys.argv[1]))
f0, f1 = int(sys.argv[2]), int(sys.argv[3])
L = D["log"]
fr = {r["t"]: r for r in L if r.get("kind") == "frame"}
for r in L:
    if r.get("kind") != "loco":
        continue
    f = fr.get(r["t"])
    if not f or not (f0 <= f["f"] <= f1):
        continue
    print(f["f"], f"t {r['t']:.3f} yaw {r['yaw']} des {r['des']} err {r['err']} yawV {r['yawV']} vdS {r['vdS']} vd {r['vd']} wantV {r['wantV']} spd {f['spd']} dist {f['dist']} src {f['src']}")
