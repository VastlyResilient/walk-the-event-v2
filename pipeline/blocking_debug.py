"""Debug helper: candidate counts and rejection reasons of the blocking solver at given steps.

  python pipeline/blocking_debug.py <floor> t1 t2 ...
"""
import sys

import numpy as np

floor, ts = sys.argv[1], [int(x) for x in sys.argv[2:]]
sys.argv = ["blocking.py", floor]
src = open(__file__.replace("blocking_debug.py", "blocking.py")).read()
src = src.split("# ---------------------------------------------------------------------------------------------- DP")[0]
g = {"__name__": "blocking_debug", "__file__": __file__.replace("blocking_debug.py", "blocking.py")}
exec(compile(src, "blocking.py", "exec"), g)
print("ok_static", int(g["ok_static"].sum()), "states", g["NSTATE"])
for t in ts:
    st, rl, c, why = g["evaluate"](t)
    f = t * 5
    cand = np.where((g["GS"] > g["S"][f] + 0.8) & (g["GS"] < g["S"][f] + 10))[0]
    print(t, f, "cand", len(cand), "rail_ok", int(g["rail_ok"](f)[cand].sum()), "strict", int(st.sum()), "relaxed", int(rl.sum()), why)

if "--start" in sys.argv[0:1] or True:
    pass
