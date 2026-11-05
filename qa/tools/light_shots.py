"""Guide lighting before/after shots: the guide pinned at the same world spot per footage frame, plus a crop around her.

  .venv/bin/python qa/tools/light_shots.py <base> <out_dir> [spots.json]

Without spots.json she is walked up to each frame and her spot is recorded (out_dir/spots.json); with it, she is
pinned at exactly those spots (so a second run after a change compares like with like). Each spot writes
<floor>_<frame>.png (full mobile screen) and the lighting state (hemi / key / contact) to out_dir/light.json.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, out = sys.argv[1].rstrip("/"), sys.argv[2]
fixed = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
os.makedirs(out, exist_ok=True)
SPOTS = [("downstairs", f) for f in (1064, 1873, 2140, 2862, 2985, 3150, 3420)] + [("upstairs", f) for f in (1000, 1500, 2100, 2480, 2700)]

STATE = """(() => { const a = window.__walk, v = a.view, b = a.brain, c = b.rig.contact;
  const h = (x) => '#' + x.getHexString();
  return { hemi: [+v.hemi.intensity.toFixed(3), h(v.hemi.color), h(v.hemi.groundColor)], key: [+v.key.intensity.toFixed(3), h(v.key.color)],
    keyDir: v.key.position.clone().sub(v.key.target.position).normalize().toArray().map(x => +x.toFixed(2)),
    contact: c ? +c.material.opacity.toFixed(3) : null, roomLum: +a.roomLum.toFixed(4), expo: +v.bgExposure.toFixed(3),
    feet: v.project(b.rig.root.position), head: b.headScreen(), pos: b.pos.toArray().map(x => +x.toFixed(3)), yaw: +b.yaw.toFixed(3),
    extra: a.__light || null, shown: a.source.shown }; })()"""


async def main():
    spots = {}
    states = {}
    async with async_playwright() as p:
        br = await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)
        ctx = await br.new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page()
        await pg.goto(base + "/?autostart&lightdbg")
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
        await pg.wait_for_timeout(3000)
        for floor, frame in SPOTS:
            key = f"{floor}_{frame}"
            for _ in range(6):
                if await pg.evaluate("window.__walk.floor.id") == floor:
                    break
                await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
                await pg.wait_for_timeout(3500)
            await pg.evaluate("(() => { const b = window.__walk.brain; if (b.__u) { b.update = b.__u; } })()")
            await Q.set_frame(pg, max(0, frame - 60), 1500)
            for f in range(frame - 60, frame + 1, 4):
                await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {f}; a.lastInput = performance.now(); }})()")
                await pg.wait_for_timeout(70)
            await pg.wait_for_timeout(1200)
            for _ in range(20):  # the exact frame must be on screen (a slow decode / jump cut can leave another one)
                if abs(await pg.evaluate("window.__walk.source.shown") - frame) <= 2:
                    break
                await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {frame}; }})()")
                await pg.wait_for_timeout(500)
            if fixed and key in fixed:
                x, y, z, yaw = fixed[key]
            else:
                st = await pg.evaluate(STATE)
                x, y, z = st["pos"]; yaw = st["yaw"]
            spots[key] = [x, y, z, yaw]
            await pg.evaluate(f"""(() => {{ const b = window.__walk.brain; if (!b.__u) b.__u = b.update; const u = b.__u.bind(b);
              b.update = (c) => {{ u(c); b.pos.set({x}, {y}, {z}); b.rig.root.position.copy(b.pos); b.yaw = {yaw};
                b.rig.root.rotation.set(0, b.yaw, 0); b.opacity = 1; b.rig.root.updateMatrixWorld(true); }}; }})()""")
            await pg.wait_for_timeout(2200)
            await pg.screenshot(path=f"{out}/{key}.png")
            states[key] = await pg.evaluate(STATE)
            print(key, json.dumps(states[key]), flush=True)
        await br.close()
    json.dump(spots, open(f"{out}/spots.json", "w"), indent=1)
    json.dump(states, open(f"{out}/light.json", "w"), indent=1)


asyncio.run(main())
