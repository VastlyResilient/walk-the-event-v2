"""Across the upstairs solve bridge (3501-3518): her position in camera coordinates per update (should change only
by her own walking), and whether the brain carried her.

  .venv/bin/python qa/tools/seam_check.py
"""
import asyncio
import math

from playwright.async_api import async_playwright

HOOK = r"""(() => { const a = window.__walk, b = a.brain, u = b.update.bind(b); window.__seam = [];
  b.update = (c) => { u(c); const cam = a.view.camera; const p = b.pos.clone().applyMatrix4(cam.matrixWorldInverse);
    window.__seam.push([c.frame, p.x, p.y, p.z, b.carried ? 1 : 0, b.dbgSrc, b.spd, b.pos.x, b.pos.z]); }; })()"""


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=metal", "--enable-gpu"])
        pg = await (await br.new_context(viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True)).new_page()
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == "upstairs":
                break
            await pg.evaluate("window.__walk.goFloor('upstairs', 0)")
            await pg.wait_for_timeout(3000)
        await pg.evaluate("(() => { const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = 3470; })()")
        await pg.wait_for_timeout(2500)
        await pg.evaluate(HOOK)
        await pg.evaluate("window.__walk.dragTo = 70")
        await pg.wait_for_timeout(2500)
        S = await pg.evaluate("window.__seam")
        await br.close()
    prev = None
    for s in S:
        if prev and 3495 <= s[0] <= 3525:
            d = math.hypot(s[1] - prev[1], s[3] - prev[3])
            print(f"f {s[0]:.1f} cam-rel step {d:.3f} m carried {s[4]} src {s[5]} spd {s[6]:.2f} world step {math.hypot(s[7] - prev[7], s[8] - prev[8]):.3f}")
        prev = s


asyncio.run(main())
