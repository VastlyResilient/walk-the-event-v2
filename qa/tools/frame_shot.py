"""Mobile screenshot of the walk at a footage frame (approached with a short real walk, then held there).

  .venv/bin/python qa/tools/frame_shot.py <base> <floor> <frame> <out.png>
"""
import asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, floor, frame, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page()
        await pg.goto(base.rstrip("/") + "/?autostart" + ("#floor-up" if floor == "upstairs" else ""))
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0 && window.__walk.floor.id === '%s'" % floor, timeout=60000)
        await pg.wait_for_timeout(4000)
        await Q.set_frame(pg, max(0, frame - 60), 1500)
        for f in range(frame - 60, frame + 1, 4):  # a slow walk up to the frame (small steps: no jump cut)
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {f}; a.lastInput = performance.now(); }})()")
            await pg.wait_for_timeout(70)
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=out)
        print(out, await pg.evaluate("window.__walk.source.shown"))


asyncio.run(main())
