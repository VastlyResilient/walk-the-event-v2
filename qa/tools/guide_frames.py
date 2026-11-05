"""Walk (drag-target) to given frames of a floor on the mobile profile and screenshot the guide there.

  .venv/bin/python qa/tools/guide_frames.py <floor> <outdir> "<query>" f1 f2 ...
"""
import asyncio
import sys

from playwright.async_api import async_playwright

ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
MOBILE = dict(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
floor, out, q = sys.argv[1], sys.argv[2], sys.argv[3]
fs = [int(x) for x in sys.argv[4:]]
BASE = "http://127.0.0.1:5302/"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=ARGS)
        pg = await (await b.new_context(**MOBILE)).new_page()
        await pg.goto(BASE + "?autostart" + q)
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        try:
            await pg.click("text=Start walking", timeout=3000)
            await pg.wait_for_timeout(2500)
        except Exception:
            pass
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        for f in fs:
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = Math.max(0, {f} - 90); }})()")
            await pg.wait_for_timeout(1500)
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.dragTo = {f} - a.cur; }})()")
            await pg.wait_for_timeout(2500)
            info = await pg.evaluate("""(() => { const a = window.__walk, b = a.brain, p = b.pos; const ft = a.view.project(p);
              return {cur: Math.round(a.cur), src: b.dbgSrc, st: b.state, p: [p.x, p.y, p.z].map(x => +x.toFixed(2)), ft: ft && [Math.round(ft.x), Math.round(ft.y), +ft.z.toFixed(2)],
                cam: a.view.camera.position.toArray().map(x => +x.toFixed(2))}; })()""")
            print(f, info, flush=True)
            tag = q.replace("&", "_").replace("=", "").replace("?", "")
            await pg.screenshot(path=f"{out}/{floor}_f{f}{tag}.png")
        await b.close()


asyncio.run(main())
