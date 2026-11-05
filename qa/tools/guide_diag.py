"""Per-frame anchor diagnostics over one stretch (mobile, 4x throttle, steady scroll): every candidate spot the brain
scored, why each was rejected, the chosen target, her screen x now and at the predicted pan frame.

  python qa/tools/guide_diag.py <floor> <from_frame> <to_frame> [fps] [out.json] [base] [hold_s]
"""
import asyncio
import json
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, __import__("os").path.dirname(__file__))
_argv, sys.argv = sys.argv, sys.argv[:1]
import guide_probe as G  # noqa: E402
sys.argv = _argv

floor, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fps = float(sys.argv[4]) if len(sys.argv) > 4 else 45
out = sys.argv[5] if len(sys.argv) > 5 else f"/tmp/diag_{floor}_{f0}.json"
base = sys.argv[6] if len(sys.argv) > 6 else "http://127.0.0.1:5302/"
hold = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=G.ARGS)
        ctx = await br.new_context(**G.MOBILE)
        pg = await ctx.new_page()
        await pg.goto(base + "?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {max(0, f0 - 40)}; }})()")
        await pg.wait_for_timeout(2500)
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        await pg.evaluate(G.RECORDER)
        await pg.evaluate("window.__walk.brain.dbgLog = []")
        await pg.evaluate(f"""(() => {{ const a = window.__walk; window.__segT = setInterval(() => {{ if (a.cur < {f1}) {{ a.dragTo = (a.dragTo || 0) + {fps} / 20; }} }}, 50); }})()""")
        while await pg.evaluate("window.__walk.cur") < f1:
            await pg.wait_for_timeout(250)
        await pg.evaluate("clearInterval(window.__segT)")
        await pg.wait_for_timeout(int(hold * 1000))
        L = await pg.evaluate("window.__walk.brain.dbgLog")
        S = await pg.evaluate("window.__gp")
        await br.close()
    json.dump({"log": L, "samples": S}, open(out, "w"))
    print("wrote", out, len(L), "log rows", len(S), "samples")


asyncio.run(main())
