"""The QA glow check alone (qa_run's full sweep: forward every 45 frames, back every 90), for bisecting.

  .venv/bin/python qa/tools/glow_sweep.py <base url incl. ?off=...> [mobile|desktop]
"""
import asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, dev = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "mobile")


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES[dev])
        pg = await ctx.new_page()
        await pg.goto(base)
        await pg.wait_for_selector(".intro .go:not([disabled])", timeout=45000)
        await pg.click(".intro .go")
        await Q.wait_ready(pg)
        await pg.wait_for_timeout(4200)
        # (the real-input walk qa_run does before its sweep, so the guide's state matches)
        if dev == "desktop":
            for delta in (40, 120, 400):
                for _ in range(25):
                    await pg.mouse.wheel(0, delta); await pg.wait_for_timeout(40)
                await pg.wait_for_timeout(700)
            for _ in range(20):
                await pg.mouse.wheel(0, -150); await pg.wait_for_timeout(40)
            await pg.wait_for_timeout(700)
            await pg.keyboard.down("w"); await pg.wait_for_timeout(1500); await pg.keyboard.up("w")
        else:
            for dist, steps in ((120, 12), (300, 10), (500, 6)):
                await pg.mouse.move(200, 600); await pg.mouse.down()
                for k in range(steps):
                    await pg.mouse.move(200, 600 - dist * (k + 1) / steps); await pg.wait_for_timeout(16)
                await pg.mouse.up(); await pg.wait_for_timeout(800)
            await pg.wait_for_timeout(2000)
        N = await pg.evaluate("(() => { const a = window.__walk; return a.floor.end !== undefined ? a.floor.end + 1 : a.floor.meta.frames; })()")
        blocked, off = [], []
        for f in list(range(0, N, 45)) + list(range(N - 1, 0, -90)):
            st = await Q.set_frame(pg, f, 450)
            await pg.wait_for_timeout(600)
            st = await pg.evaluate(Q.STATE)
            W, H = Q.DEVICES[dev]["viewport"]["width"], Q.DEVICES[dev]["viewport"]["height"]
            if st["op"] > 0.8 and st["head"] and st["guideFeet"]:
                if not (0 <= st["head"]["x"] <= W and 0 <= st["head"]["y"] <= H and st["guideFeet"]["y"] <= H * 1.02):
                    off.append(f)
                for r in st["rects"]:
                    if r["x0"] + 10 < st["head"]["x"] < r["x1"] - 10 and r["y0"] < st["head"]["y"] < r["y1"] and st["gspeed"] < 0.5:
                        src = await pg.evaluate("window.__walk.brain.dbgSrc")
                        blocked.append((f, src))
        print(dev, base, "settled glow overlaps", blocked, "off-screen", off, flush=True)


asyncio.run(main())
