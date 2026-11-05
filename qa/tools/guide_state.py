"""Quick look at the guide brain's state and any page errors (mobile profile).

  .venv/bin/python qa/tools/guide_state.py [floor] [frame]
"""
import asyncio
import sys

from playwright.async_api import async_playwright

floor = sys.argv[1] if len(sys.argv) > 1 else "downstairs"
frame = int(sys.argv[2]) if len(sys.argv) > 2 else -1


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=metal", "--enable-gpu"])
        pg = await (await b.new_context(viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True)).new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        if frame >= 0:
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {frame}; }})()")
            await pg.wait_for_timeout(2000)
        print(await pg.evaluate("""(() => { const b = window.__walk.brain; return {st: b.state, op: b.opacity, p: b.pos.toArray(), src: b.dbgSrc,
          aS: b.aS, lat: b.aLat, lead: b.lead, vis: b.rig.root.visible, nospot: b.noSpot, feet: window.__walk.view.project(b.pos)}; })()"""))
        print(errs[:5])
        await b.close()


asyncio.run(main())
