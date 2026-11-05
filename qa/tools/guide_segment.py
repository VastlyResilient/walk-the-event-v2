"""Record the guide brain over one stretch of a floor at slow-scroll pace (mobile, 4x throttle) and print a trace.

  .venv/bin/python qa/tools/guide_segment.py <floor> <from_frame> <to_frame> [fps]
"""
import asyncio
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, __import__("os").path.dirname(__file__))
_argv, sys.argv = sys.argv, sys.argv[:1]
import guide_probe as G  # noqa: E402
sys.argv = _argv

floor, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
fps = float(sys.argv[4]) if len(sys.argv) > 4 else 45


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=G.ARGS)
        ctx = await br.new_context(**G.MOBILE)
        pg = await ctx.new_page()
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {f0}; }})()")
        await pg.wait_for_timeout(2500)
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        await pg.evaluate(G.RECORDER)
        # steady scroll like a held finger: hold the walk at fps footage frames per second
        await pg.evaluate(f"""(() => {{ const a = window.__walk; window.__segT = setInterval(() => {{ if (a.cur < {f1}) {{ a.dragTo = (a.dragTo || 0) + {fps} / 20; }} }}, 50); }})()""")
        while await pg.evaluate("window.__walk.cur") < f1:
            await pg.wait_for_timeout(250)
        await pg.evaluate("clearInterval(window.__segT)")
        S = await pg.evaluate("window.__gp")
        await br.close()
    last = None
    for i, s in enumerate(S):
        if not s["vis"]:
            continue
        h = (s["fyp"] or 0) - (s["hy"] or 0)
        off = s["fx"] is None or min(s["fx"], s["hx"]) - h * 0.2 < s["ox"] or max(s["fx"], s["hx"]) + h * 0.2 > s["ox"] + s["W"] or (s["fyp"] or 0) > s["H"]
        key = (s["src"], off)
        if key != last or i % (int(sys.argv[5]) if len(sys.argv) > 5 else 15) == 0:
            print(int(s["cur"]), s["src"], "OFF" if off else "in", "feet", s["fx"] and int(s["fx"]), s["fyp"] and int(s["fyp"]), "z", s["fz"] and round(s["fz"], 2),
                  "aS-sV %.2f sHer-sV %.2f lat %s spd %.2f pan %.2f" % (s["aS"] - s["sV"], (s["sHer"] or 0) - s["sV"], s["lat"] and round(s["lat"], 2), s["spd"], s.get("panT", 0)))
            last = key


asyncio.run(main())
