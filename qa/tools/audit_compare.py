"""Side-by-side of two walk_audit summary.json files (measured values per metric and scenario).

  .venv/bin/python qa/tools/audit_compare.py <before summary.json> <after summary.json> [metric ...]
"""
import json
import sys

a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
want = sys.argv[3:]


def rows(d):
    out = {}
    for r in d.get("results", d if isinstance(d, list) else []):
        out[f"{r['floor'][:4]}/{r['scenario']}"] = r["metrics"]
    return out


A, B = rows(a), rows(b)
for key in B:
    print(f"== {key}")
    for m, v in B[key].items():
        if want and m not in want:
            continue
        va = A.get(key, {}).get(m)
        print(f"  {m:15s} before {'PASS' if va and va['pass'] else 'FAIL' if va else '----'} {va['value'] if va else '':70.70s} | after {'PASS' if v['pass'] else 'FAIL'} {v['value']}")
