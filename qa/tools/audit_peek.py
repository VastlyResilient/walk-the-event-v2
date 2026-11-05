"""Print walk_audit metric values for one recorded scenario (raw json.gz) without a browser.

  .venv/bin/python qa/tools/audit_peek.py <label> <floor>_<scenario> [base]
"""
import gzip
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
_argv, sys.argv = sys.argv, sys.argv[:1]
import walk_audit as W  # noqa: E402
sys.argv = _argv

label, key = sys.argv[1], sys.argv[2]
base = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:5302/"
res = json.load(gzip.open(W.ROOT / f"qa/runs/audit/{label}/raw/{key}.json.gz"))
out = W.analyze(res, base)
out = out[0] if isinstance(out, tuple) else out
for k, v in out["metrics"].items():
    print(f"{k:15s} {'PASS' if v['pass'] else 'FAIL'}  {v['value']}")
    if not v["pass"]:
        for w in (v.get("worst") or [])[:6]:
            print("      ", {kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in w.items() if kk in ("t", "f", "dur", "what", "sev", "frame", "i")})
