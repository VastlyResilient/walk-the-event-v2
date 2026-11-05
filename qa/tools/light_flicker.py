"""Guide lighting over time: walk a stretch at footage speed and record her light every rendered frame.

  .venv/bin/python qa/tools/light_flicker.py <base> [floor:from:to ...] [--pin] [-v]

Reports, per stretch, the largest frame-to-frame change of the hemisphere / key intensity (relative) and of the
light colour (max channel), plus how often the light reverses direction (flicker). Smooth = small steps, few reversals.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

VERBOSE = "-v" in sys.argv
PIN = "--pin" in sys.argv  # keep her 3.2 m ahead of the camera on the floor (the brain hides her in some stretches)
sys.argv = [a for a in sys.argv if a not in ("-v", "--pin")]
base = sys.argv[1].rstrip("/")
STRETCHES = [tuple(s.split(":")) for s in sys.argv[2:]] or [("downstairs", "2650", "3010"), ("upstairs", "1950", "2600")]

REC = """(() => { const a = window.__walk, v = a.view; a.__rec = []; const tick = () => {
  if (!a.__rec) return; const c = v.hemi.color;
  a.__rec.push([performance.now(), v.hemi.intensity, v.key.intensity, c.r, c.g, c.b, a.source.shown, a.brain.opacity, a.roomLum]);
  requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()"""


def stats(rec):
    import math
    big_h = big_k = big_c = 0.0
    rev = 0
    last_d = 0.0
    for p, q in zip(rec, rec[1:]):
        dh = (q[1] - p[1]) / max(p[1], 0.05)
        dk = (q[2] - p[2]) / max(p[2], 0.05)
        dc = max(abs(q[i] - p[i]) / max(p[i], 0.05) for i in (3, 4, 5))
        big_h, big_k, big_c = max(big_h, abs(dh)), max(big_k, abs(dk)), max(big_c, dc)
        if abs(dh) > 0.004:
            if last_d and math.copysign(1, dh) != math.copysign(1, last_d):
                rev += 1
            last_d = dh
    worst = max(range(1, len(rec)), key=lambda i: max(abs(rec[i][j] - rec[i - 1][j]) / max(rec[i - 1][j], 0.05) for j in (3, 4, 5)))
    if VERBOSE:
        for r in rec[max(0, worst - 4):worst + 3]:
            print("   ", [round(x, 3) for x in r])
    secs = (rec[-1][0] - rec[0][0]) / 1000
    return dict(frames=len(rec), secs=round(secs, 1), max_hemi_step=round(big_h, 4), max_key_step=round(big_k, 4), max_col_step=round(big_c, 4), reversals_per_s=round(rev / max(secs, 1e-3), 2))


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)
        pg = await (await br.new_context(**Q.DEVICES["mobile"])).new_page()
        await pg.goto(base + "/?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for floor, f0, f1 in STRETCHES:
            f0, f1 = int(f0), int(f1)
            for _ in range(6):
                if await pg.evaluate("window.__walk.floor.id") == floor:
                    break
                await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
                await pg.wait_for_timeout(3500)
            await Q.set_frame(pg, f0, 2500)
            if PIN:
                await pg.evaluate("""(() => { const a = window.__walk, b = a.brain; if (!b.__u) b.__u = b.update; const u = b.__u.bind(b);
                  b.update = (c) => { u(c); const cam = a.view.camera, f = new a.view.camera.position.constructor(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
                    b.pos.copy(cam.position).addScaledVector(f, 3.2).setY(cam.position.y - a.floor.cam.camera_height_m); b.rig.root.position.copy(b.pos);
                    b.yaw = Math.atan2(f.x, f.z); b.rig.root.rotation.set(0, b.yaw, 0); b.opacity = 1; b.rig.root.updateMatrixWorld(true); }; })()""")
            await pg.evaluate(REC)
            # walk at footage speed (30 fps): the app's own hold-to-walk path would be ideal; this sets cur directly
            await pg.evaluate(f"""new Promise((res) => {{ const a = window.__walk; const t0 = performance.now();
              const step = () => {{ const f = {f0} + (performance.now() - t0) / 1000 * 29.97; a.glide = null; a.vel = 0; a.cur = Math.min({f1}, f); a.lastInput = performance.now();
                if (f < {f1}) requestAnimationFrame(step); else res(); }}; requestAnimationFrame(step); }})""")
            rec = await pg.evaluate("(() => { const r = window.__walk.__rec; window.__walk.__rec = null; return r; })()")
            print(floor, f0, f1, json.dumps(stats(rec)), flush=True)
        await br.close()


asyncio.run(main())
