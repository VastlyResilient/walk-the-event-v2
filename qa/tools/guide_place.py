"""Freeze the guide at a given world spot at a given frame and screenshot it (to judge a candidate spot by eye).

  .venv/bin/python qa/tools/guide_place.py <floor> <frame> <x> <y> <z> <out.png>
"""
import asyncio
import sys

from playwright.async_api import async_playwright

floor, f, x, y, z, out = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=metal", "--enable-gpu"])
        pg = await (await br.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True)).new_page()
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = {f}; }})()")
        await pg.wait_for_timeout(2500)
        await pg.evaluate(f"""(() => {{ const b = window.__walk.brain, u = b.update.bind(b);
          b.update = (c) => {{ u(c); b.pos.set({x}, {y}, {z}); b.rig.root.position.copy(b.pos);
            b.yaw = Math.atan2(window.__walk.view.camera.position.x - {x}, window.__walk.view.camera.position.z - {z}); b.rig.root.rotation.set(0, b.yaw, 0); b.rig.root.updateMatrixWorld(true); }}; }})()""")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=out)
        print(await pg.evaluate(f"(() => {{ const v = window.__walk.view; const a = v.project(window.__walk.brain.pos); return a && [Math.round(a.x), Math.round(a.y), +a.z.toFixed(2)]; }})()"))
        await br.close()


asyncio.run(main())
