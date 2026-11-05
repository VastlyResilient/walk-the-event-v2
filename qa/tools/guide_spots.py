"""Why is (or isn't) there a good spot for the guide at given frames? Lists lane candidates ahead and the first reason
each one fails (behind / size / frame / glow / standable / blocked).

  .venv/bin/python qa/tools/guide_spots.py <floor> f1 f2 ...
"""
import asyncio
import sys

from playwright.async_api import async_playwright

floor = sys.argv[1]
fs = [int(x) for x in sys.argv[2:]]
JS = r"""(() => { const a = window.__walk, b = a.brain, v = a.view; const sV = b.sVs; const out = [];
  const P = b.pos.clone(), Q = b.pos.clone();
  for (const L of [1.6, 2, 2.5, 3, 3.5, 4, 4.5, 5.5, 6.5, 7.5, 9, 11]) {
    const s = sV + L; const [l0, l1] = b.laneAt(s);
    for (const lat of [l0 + 0.28, (l0 + l1) / 2, l1 - 0.28]) {
      b.lanePoint(s, lat, P);
      const feet = v.project(P), head = v.project(Q.copy(P).setY(P.y + 1.62));
      let why = 'ok'; let fr = 0;
      if (!feet || !head) why = 'behind';
      else {
        const hgt = feet.y - head.y, frac = hgt / v.height, half = hgt * 0.22 + 6;
        const x0 = Math.min(feet.x, head.x) - half, x1 = Math.max(feet.x, head.x) + half;
        if (frac < 0.12 || frac > 0.48) why = 'size ' + frac.toFixed(2);
        else if (x0 < v.offsetX + v.width * 0.03 || x1 > v.offsetX + v.width * 0.95 || head.y < v.height * 0.06 || feet.y > v.height * 0.96) why = `frame x${Math.round(x0)}-${Math.round(x1)} y${Math.round(head.y)}-${Math.round(feet.y)}`;
        else if (!b.standable(P)) why = 'standable';
        else why = 'ok ' + frac.toFixed(2) + ' blk ' + (b.sense ? b.sense.blocked(P).toFixed(2) : '-');
      }
      out.push(`L${L} lat${lat.toFixed(2)} [${l0},${l1}] ${why}`);
    }
  }
  // camera-relative candidates: floor continuity from the visitor, measured floor height, quality
  const visFloor = b.navAt(sV)?.floor_y ?? (v.camera.position.y - 1.4);
  for (const d of [2.2, 2.6, 3, 3.6, 4.4, 5.5]) for (const l of [-1.3, -0.9, -0.45, 0, 0.45, 0.9, 1.3, 1.8]) {
    b.camPoint(d, l, visFloor, P);
    const fy = b.camFloorOk(P, visFloor), f1 = b.floorFromDepth(P.clone(), visFloor);
    let why = fy === null ? `nofloor (direct ${f1 === null ? 'null' : (f1 - visFloor).toFixed(2)})` : 'floor ' + (fy - visFloor).toFixed(2);
    if (fy !== null) { P.y = fy; const q = b.spotQuality(P, [], 0.12, 0.48, true, 0.29, true); why += ' q ' + q.toFixed(2); }
    const pr = v.project(P); out.push(`cam d${d} l${l} ${why} px ${pr ? Math.round(pr.x) + ',' + Math.round(pr.y) : '-'}`);
  }
  const dbg = (P) => { const ft = v.project(P), hd = v.project(P.clone().setY(P.y + 1.62)); return JSON.stringify({ft, hd, W: v.width, H: v.height, ox: v.offsetX, en: b.energy, contain: v.contain}); };
  const qv = (P) => { b.verified = true; const r = b.spotQuality(P, [], 0.12, 0.48, true, 0.29, true); b.verified = false; return r.toFixed(2); };
  for (const sp of b.nav?.spots || []) {
    P.set(sp.x, sp.y, sp.z);
    const ft = v.project(P), hd = v.project(Q.copy(P).setY(P.y + 1.62));
    out.push(`spot ${sp.x},${sp.z} s ${sp.from_s}-${sp.to_s} sV ${sV.toFixed(1)} feet ${ft && [Math.round(ft.x), Math.round(ft.y), ft.z.toFixed(2)]} head ${hd && Math.round(hd.y)} ` +
      'q ' + b.spotQuality(P, [], 0.12, 0.48, true, 0.29, true).toFixed(2) + ' qv ' + qv(P) + ' dbg ' + dbg(P) + ' trust ' + (b.fitFn && b.fitFn(Math.round(v.frame))) + ` stand ${b.standable(P, false)} occ ${b.occludedAt(P)} person ${b.feetOnPerson(P)} drop ${b.nearDrop(P)} blk ${b.sense ? b.sense.blocked(P).toFixed(2) : '-'}`);
  }
  return { cur: Math.round(a.cur), src: b.dbgSrc, people: (b.sense?.people || []).length, out }; })()"""


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=["--use-angle=metal", "--enable-gpu"])
        pg = await (await br.new_context(viewport={"width": 393, "height": 852}, is_mobile=True, has_touch=True)).new_page()
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
            await pg.wait_for_timeout(1800)
            r = await pg.evaluate(JS)
            print(f, r["cur"], r["src"], "people", r["people"])
            for line in r["out"]:
                print("   ", line)
        await br.close()


asyncio.run(main())
