"""How well does the live scene sense read depth on the walked floor? For a set of frames, the footage depth at the
walked path 1.5-5 m ahead (lane centre, people masked out) is compared with its true camera distance, with the
solve's feature-point fit and with the nav map's floor-recalibrated fit (`da`/`db`).

  .venv/bin/python qa/tools/sense_depth_check.py [floor]
"""
import asyncio
import json
import statistics
import sys

from playwright.async_api import async_playwright

ARGS = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
MOBILE = dict(viewport={"width": 393, "height": 852}, device_scale_factor=2, is_mobile=True, has_touch=True)
floor = sys.argv[1] if len(sys.argv) > 1 else "upstairs"

JS = r"""(() => { const a = window.__walk, b = a.brain, se = a.sense; if (!se.ready || !b.nav) return null;
  const f = se.frame, s0 = b.S[f], out = { orig: [], recal: [] }, o = { u: 0, v: 0, z: 0 };
  const P = b.pos.clone();
  for (let ds = 1.5; ds <= 5; ds += 0.25) {
    b.lanePoint(s0 + ds, 0, P);
    const r = se.toImage(P.setY(P.y + 0.03), o); if (!r) continue;
    const k = se.cell(r.u, r.v); if (k < 0 || se.mask[k] > 0.3) continue;
    const keep = se.fitAt; se.fitAt = null; const zo = se.metric(se.depth[k]); se.fitAt = keep;
    out.orig.push(zo / r.z); if (keep) out.recal.push(se.metric(se.depth[k]) / r.z);
  }
  return out; })()"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel="chrome", headless=True, args=ARGS)
        pg = await (await b.new_context(**MOBILE)).new_page()
        await pg.goto("http://127.0.0.1:5302/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for _ in range(5):
            if await pg.evaluate("window.__walk.floor.id") == floor:
                break
            await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
            await pg.wait_for_timeout(3000)
        N = await pg.evaluate("window.__walk.floor.meta.frames")
        allo, allr = [], []
        for f in range(150, N - 200, 150):
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = {f}; }})()")
            await pg.wait_for_timeout(1200)
            r = await pg.evaluate(JS)
            if not r or not r["orig"]:
                continue
            mo, mr = statistics.median(r["orig"]), (statistics.median(r["recal"]) if r["recal"] else None)
            allo += r["orig"]; allr += r["recal"]
            print(f, "orig %.2f" % mo, "recal %s" % (mr and "%.2f" % mr), flush=True)
        print("ALL median orig %.3f recal %.3f; |log ratio| p75 orig %.3f recal %.3f" % (
            statistics.median(allo), statistics.median(allr),
            sorted(abs(__import__('math').log(x)) for x in allo)[int(len(allo) * .75)],
            sorted(abs(__import__('math').log(x)) for x in allr)[int(len(allr) * .75)]))
        await b.close()


asyncio.run(main())
