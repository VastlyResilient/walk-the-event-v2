"""Stop on a dime: after the visitor stops (swipe released, picture coasts to rest; or hold-to-walk released), how far
and how long does she keep walking? Per-frame log in the page (rAF), mobile profile.

  .venv/bin/python qa/tools/stop_probe.py <base> <floor> <frame,frame,...> [--hold]

Reports per stop: picture-rest time (camera < 0.05 m/s), her travel after the picture is at rest, the time until her
root is still (< 0.05 m/s), and her travel after the finger lifted.
"""
import asyncio, json, math, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, floor, frames = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
HOLD = "--hold" in sys.argv
LOG = """(() => { window.__sl = []; const a = window.__walk; const t0 = performance.now();
  const f = () => { const c = a.view.camera.position, p = a.brain.pos; window.__sl.push([performance.now() - t0, c.x, c.z, p.x, p.z, a.brain.spd, a.brain.dbgSrc + " st" + a.brain.stopT.toFixed(2) + " " + a.brain.state + " h" + a.brain.holdSet + " fix" + a.brain.holdFix + " " + a.brain.holdWhy, a.cur]); if (window.__sl.length < 900) requestAnimationFrame(f); };
  requestAnimationFrame(f); })()"""


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page(); pg.set_default_timeout(180000)
        await pg.goto(base.rstrip("/") + "/?autostart" + ("#floor-up" if floor == "upstairs" else ""))
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0 && window.__walk.floor.id === '%s'" % floor, timeout=60000)
        await pg.wait_for_timeout(5000)
        res = []
        for f in frames:
            await Q.set_frame(pg, max(0, f - 120), 2500)
            await pg.evaluate(LOG)
            if HOLD:
                await pg.evaluate("document.querySelector('.pad-fwd').style.display = ''")
                bb = await pg.locator(".pad-fwd").first.bounding_box()
                await pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2); await pg.mouse.down()
                await pg.wait_for_timeout(2500)
                tl = await pg.evaluate("performance.now()")
                await pg.mouse.up()
            else:
                for _ in range(2):
                    await pg.mouse.move(200, 650); await pg.mouse.down()
                    for k in range(10):
                        await pg.mouse.move(200, 650 - 30 * (k + 1)); await pg.wait_for_timeout(16)
                    tl = await pg.evaluate("performance.now()")
                    await pg.mouse.up(); await pg.wait_for_timeout(250)
            await pg.wait_for_timeout(4500)
            L = await pg.evaluate("window.__sl")
            t0 = await pg.evaluate("performance.now()") - L[-1][0]  # unused
            # relative release time
            rel = tl - (await pg.evaluate("performance.now()")) + L[-1][0] + 0  # approx
            cs, gs = [], []
            for a, b in zip(L, L[1:]):
                dt = max(1e-3, (b[0] - a[0]) / 1000)
                cs.append((b[0], abs(b[7] - a[7]) / dt / 30))  # (scroll position, ~m/s at ~30 fps footage); gs.append((b[0], math.hypot(b[3] - a[3], b[4] - a[4]) / dt))
            # picture at rest: the first time after the lift from which the scroll stays still
            rest = next((cs[i][0] for i in range(len(cs)) if cs[i][0] > rel and all(v < 0.02 for _, v in cs[i:])), None)
            if rest is None or not any(v > 0.5 for t, v in cs if rel - 300 < t < rel):
                print(f"{floor} f{f}: swipe did not walk (skipped)", flush=True); continue
            def at(t):
                return min(L, key=lambda q: abs(q[0] - t))
            # still: her speed under 0.1 m/s for 0.3 s
            still = next((gs[i][0] for i in range(len(gs)) if gs[i][0] >= rest and all(v < 0.1 for t, v in gs[i:] if t < gs[i][0] + 300)), None)
            a0, a1, a3 = at(rest), at(rest + 1000), at(rest + 3000)
            pk = max((v for t, v in gs if rest - 200 < t <= rest), default=0)
            r = dict(f=f, rest_s=(rest - rel) / 1000, vpk=pk, d1=math.hypot(a1[3] - a0[3], a1[4] - a0[4]), d3=math.hypot(a3[3] - a0[3], a3[4] - a0[4]), still_s=(still - rest) / 1000 if still else None)
            print(f"{floor} f{f}: picture at rest {r['rest_s']:.2f} s after lift; her speed then {pk:.2f} m/s; she ends {r['d1']:.2f} m (1 s) / {r['d3']:.2f} m (3 s) from where she was; still after {r['still_s'] if r['still_s'] is not None else float('nan'):.2f} s; {a3[6]}", flush=True)
            res.append(r)
            json.dump(dict(L=L, rel=rel, rest=rest), open(f"/tmp/stop_{floor}_{f}.json", "w"))
            if "--why" in sys.argv:
                print(await pg.evaluate('''(() => { const b = window.__walk.brain, p = b.pos, vb = b.viewBox(p); return JSON.stringify({ inside: vb.inside, camD: vb.camD, h: vb.h, glow: b.glowBad(p, true, 10), depth: b.depthBad(p), person: b.feetOnPerson(p), moves: b.holdMoves }); })()'''))
            if "--dump" in sys.argv:
                for i in range(0, len(L) - 1, 3):
                    a, b = L[i], L[i + 1]; dt = max(1e-3, (b[0] - a[0]) / 1000)
                    print(f"  t{(a[0] - rel) / 1000:+.2f} cur{a[7]:.1f} scroll{abs(b[7] - a[7]) / dt:5.1f}fps her{math.hypot(b[3] - a[3], b[4] - a[4]) / dt:5.2f} spd{a[5]:.2f} {a[6]}")


asyncio.run(main())
