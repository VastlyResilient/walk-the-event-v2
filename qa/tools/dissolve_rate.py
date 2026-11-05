"""Dissolves (camera-proximity / size / stuck-at-edge) and walk-in re-entries per minute of walk, per scenario of an
audit run (from the brain's counters recorded per sample).

  python qa/tools/dissolve_rate.py <run>
"""
import gzip, json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
for f in sorted((ROOT / "qa/runs/audit" / sys.argv[1] / "raw").glob("*.json.gz")):
    r = json.load(gzip.open(f))
    S = [s for s in r["samples"] if s.get("st") == 1 and s.get("ndis") is not None and s.get("fl") == r["floor"]]
    if len(S) < 2:
        print(f.stem, "no counters"); continue
    mins = (S[-1]["t"] - S[0]["t"]) / 60000
    nd = S[-1]["ndis"] - S[0]["ndis"]; nr = S[-1]["nre"] - S[0]["nre"]
    print(f"{f.stem}: {nd / mins:.1f} dissolves/min ({nd} in {mins:.1f} min), {nr / mins:.1f} walk-ins/min")
