"""At given frames: the sense grid around the guide's body (person mask, footage depth vs her depth) and the brain's
people / occlusion verdicts for her current spot; saves a screenshot per frame.

  .venv/bin/python qa/tools/guide_people_check.py <floor> <outdir> f1 f2 ...
"""
import asyncio
import sys

from playwright.async_api import async_playwright

floor, outdir = sys.argv[1], sys.argv[2]
fs = [int(x) for x in sys.argv[3:]]
JS = r"""(() => { const a = window.__walk, b = a.brain, se = a.sense; const p = b.pos, o = { u: 0, v: 0, z: 0 }, out = [];
  for (const [dx, hy] of [[0, 0.03], [-0.2, 0.3], [0.2, 0.3], [-0.2, 0.6], [0.2, 0.6], [-0.2, 1.0], [0.2, 1.0], [0, 1.4]]) {
    const r = se.toImage(p.clone().set(p.x + dx, p.y + hy, p.z), o); if (!r) { out.push('behind'); continue; }
    const k = se.cell(r.u, r.v); if (k < 0) { out.push('offgrid'); continue; }
    out.push(`dx${dx} h${hy}: mask ${se.mask[k].toFixed(2)} zo ${se.metric(se.depth[k]).toFixed(2)} z ${r.z.toFixed(2)} cell ${k % 36},${Math.floor(k / 36)}`);
  }
  return { cur: Math.round(a.cur), sf: se.frame, src: b.dbgSrc, feetOnPerson: b.feetOnPerson(p), occluded: b.occludedAt(p), people: se.people.length, out }; })()"""


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
        for f in fs:
            await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.dragTo = null; a.cur = {f}; }})()")
            await pg.wait_for_timeout(2500)
            r = await pg.evaluate(JS)
            print(f, {k: v for k, v in r.items() if k != "out"}, flush=True)
            for line in r["out"]:
                print("   ", line)
            await pg.screenshot(path=f"{outdir}/people_{floor}_{f}.png")
        await br.close()


asyncio.run(main())
