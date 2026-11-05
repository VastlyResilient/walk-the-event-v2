"""Summarise a guide_diag.py trace: per brain frame her target, screen x now / at the pan frame, and for each search
the candidates by reject reason.   python qa/tools/diag_read.py trace.json [every]"""
import collections
import json
import sys

D = json.load(open(sys.argv[1]))
every = int(sys.argv[2]) if len(sys.argv) > 2 else 1
L, S = D["log"], D["samples"]
# screen-space offscreen per sample (body box vs viewport) keyed by brain time is not available; use order instead
by_t = collections.OrderedDict()
for r in L:
    by_t.setdefault(r["t"], []).append(r)
n = 0
tot = collections.Counter()
for t, rows in by_t.items():
    fr = [r for r in rows if r.get("kind") == "frame"]
    cands = [r for r in rows if r.get("kind") in ("lane", "cam", "fb", "pan")]
    c = collections.Counter((r["kind"], r["why"]) for r in cands)
    tot.update(c)
    f = fr[0] if fr else None
    n += 1
    if f is None:
        continue
    if cands or n % every == 0:
        print(f"t {t:.2f} f {f['f']} {f['src']:<11} q {f['q']:5.2f} aL {f['aL']} lat {f['aLat']} cam {f['aCam']} panF {f['panF']} risk {int(f['panRisk'])} panT {f['panT']} "
              f"her {f['herX']} ->{f['herXpan']} spot {f['spotX']} ->{f['spotXpan']} dist {f['dist']} spd {f['spd']} edgy {int(f['edgy'])} fut {int(f['futBad'])} bad {f['aBadT']}")
        lo = [r for r in rows if r.get("kind") == "loco"]
        if lo:
            o = lo[0]
            print(f"    loco err {o['err']} vdl {o['vdl']} vd {o['vd']} wantV {o['wantV']} step {int(o['step'])} yawV {o['yawV']} hurry {o['hurry']}")
        vv = [r for r in rows if r.get("kind") == "vd"]
        if vv:
            print("    vd ff,goal | +blockers | +rails | +lane | +people:", vv[0]["c"], "wp", vv[0]["wp"], "goal", vv[0]["g"])
        if cands:
            ok = [r for r in cands if r["why"] == "ok"]
            print("    search:", dict(c), " ok:", [(r["kind"], r.get("L", r.get("d")), r.get("lat", r.get("l")), r.get("q")) for r in ok[:6]])
print("TOTAL", dict(tot))
# samples: her box vs viewport
off = 0
for s in S:
    if not s.get("vis"):
        continue
    if s.get("fx") is None:
        off += 1
        continue
print("samples", len(S))
F = [r for r in L if r.get("kind") == "frame"]
off = [r for r in F if r["herX"] is None or r["herX"] < 0.03 or r["herX"] > 0.92]
print(f"her feet outside [0.03, 0.92] of the view: {len(off)}/{len(F)} brain frames ({100 * len(off) / max(1, len(F)):.1f}%)")
srcs = collections.Counter(r["src"] for r in F)
print("sources", dict(srcs))
