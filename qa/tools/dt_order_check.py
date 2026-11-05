"""Which frame interval does a rAF-recorder sample's change belong to? Compares the brain's own dt (stored by a
wrapper) with the recorder's rAF interval of the same sample and of the previous one (mobile, 4x throttle).

  .venv/bin/python qa/tools/dt_order_check.py
"""
import asyncio
import statistics
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, __import__("os").path.dirname(__file__))
_argv, sys.argv = sys.argv, sys.argv[:1]
import qa_run as Q  # noqa: E402
sys.argv = _argv

INIT = r"""window.__dt = []; (function loop(ts) { requestAnimationFrame(loop); const a = window.__walk; if (!a || !a.brain) return;
  window.__dt.push([ts, a.brain.__lastDt || 0, a.brain.pos.x, a.brain.pos.z]); })(0);"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)
        ctx = await b.new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page()
        await pg.add_init_script(INIT)
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await Q.wait_ready(pg)
        await pg.evaluate("(() => { const b = window.__walk.brain, u = b.update.bind(b); b.update = (c) => { b.__lastDt = c.dt; u(c); }; })()")
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        await pg.evaluate("window.__dt = []; window.__walk.holdDir = 1; window.__busy = setInterval(() => { const t = performance.now(); while (performance.now() - t < Math.random() * 30) {} }, 23)")
        await pg.wait_for_timeout(6000)
        D = await pg.evaluate("window.__dt")
        await b.close()
    ts = [d[0] for d in D]; bd = [d[1] for d in D]
    iv = [None] + [(ts[i] - ts[i - 1]) / 1000 for i in range(1, len(ts))]
    same = [abs(bd[i] - iv[i]) for i in range(2, len(D))]
    prev = [abs(bd[i] - iv[i - 1]) for i in range(2, len(D))]
    sel = [i for i in range(2, len(D)) if abs(iv[i] - iv[i - 1]) > 0.004]
    print("uneven pairs", len(sel), "mean |dt - this|", round(statistics.mean([abs(bd[i] - iv[i]) for i in sel]) * 1000, 2) if sel else None,
          "mean |dt - previous|", round(statistics.mean([abs(bd[i] - iv[i - 1]) for i in sel]) * 1000, 2) if sel else None)
    print("samples", len(D), "median |brain dt - this interval|", round(statistics.median(same) * 1000, 2), "ms; vs previous interval",
          round(statistics.median(prev) * 1000, 2), "ms; mean", round(statistics.mean(same) * 1000, 2), round(statistics.mean(prev) * 1000, 2))


asyncio.run(main())
