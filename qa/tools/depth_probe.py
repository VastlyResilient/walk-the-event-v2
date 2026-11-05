"""Compare the brain's depth-consistency test with the audit recorder's at given frames (guide parked by the brain).

  python qa/tools/depth_probe.py <floor> f1 f2 ...
"""
import asyncio
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, __import__("os").path.dirname(__file__))
_argv, sys.argv = sys.argv, sys.argv[:1]
import guide_probe as G  # noqa: E402
import walk_audit as A  # noqa: E402
sys.argv = _argv

floor, fs = sys.argv[1], [int(x) for x in sys.argv[2:]]


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
        await pg.evaluate(A.RECORDER_JS)
        await pg.evaluate("window.__wa.on = true")
        for f in fs:
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = Math.max(0, {f} - 60); }})()")
            await pg.wait_for_timeout(1200)
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.dragTo = {f} - a.cur; }})()")
            await pg.wait_for_timeout(3000)
            r = await pg.evaluate("""(() => { const a = window.__walk, b = a.brain, se = a.sense; const S = window.__wa.buf; const o = S[S.length - 1];
              const p = b.pos; const k = se.toImage(p.clone()); const c = k ? se.cell(k.u, k.v) : -1;
              return { cur: Math.round(a.cur), src: b.dbgSrc, bad: b.depthBad(p), feetRho: o.feetRho, feetWall: o.feetWall, torsoWall: o.torsoWall, kf: o.kf,
                metricFeet: c >= 0 ? se.metric(se.depth[c]) : null, zHer: k ? k.z : null, mask: c >= 0 ? se.mask[c] : null }; })()""")
            print(f, r, flush=True)
        await br.close()


asyncio.run(main())
