"""Reproduce qa_run's sweep check (jump every 45 frames forward, 90 back; look 1 s later) and list off-screen samples.

  .venv/bin/python qa/tools/guide_sweep.py [floor]
"""
import asyncio
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, __import__("os").path.dirname(__file__))
_argv, sys.argv = sys.argv, sys.argv[:1]
import qa_run as Q  # noqa: E402
sys.argv = _argv
floor = sys.argv[1] if len(sys.argv) > 1 else "downstairs"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)
        pg = await (await b.new_context(**Q.DEVICES["mobile"])).new_page()
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await Q.wait_ready(pg)
        await pg.wait_for_timeout(3000)
        if floor != "downstairs":
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(4000)
        N = await pg.evaluate("window.__walk.floor.meta.frames")
        W, H = 393, 852
        for f in list(range(0, N, 45)) + list(range(N - 1, 0, -90)):
            await Q.set_frame(pg, f, 450)
            await pg.wait_for_timeout(600)
            st = await pg.evaluate(Q.STATE)
            src = await pg.evaluate("window.__walk.brain.dbgSrc")
            if st["op"] > 0.8 and st["head"] and st["guideFeet"]:
                if not (0 <= st["head"]["x"] <= W and 0 <= st["head"]["y"] <= H and st["guideFeet"]["y"] <= H * 1.02):
                    print("OFF", f, src, st["head"], st["guideFeet"], flush=True)
        await b.close()


asyncio.run(main())
