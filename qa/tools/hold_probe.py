"""Stop = hold, and the 60 s nudge (mobile profile, real swipes).

For each stop point: jump near it, walk there with real swipes, stop. Then
  - hold: her root displacement from 1 s to 5 s after the stop (< 0.15 m) and from the stop (reported), and her yaw
    vs the camera's forward direction at 5 s (<= 30 deg);
  - nudge (with --nudge): wait until 60 s without input + 4 s; she faces the camera (<= 35 deg) and a nudge line shows.

  .venv/bin/python qa/tools/hold_probe.py <base> <floor> <frame,frame,frame> [--nudge]
"""
import asyncio, json, math, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, floor, frames = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
NUDGE = "--nudge" in sys.argv
lines = json.load(open(Q.ROOT / "app/public/data/guide_lines.json"))["presets"]
NUDGES = {l.split("{title}")[0][:18] for p in lines.values() for l in p.get("nudge", [])}
ST = """(() => { const a = window.__walk, b = a.brain, c = a.view.camera; const e = c.matrixWorld.elements;
  const fy = Math.atan2(-e[8], -e[10]); const ty = Math.atan2(c.position.x - b.pos.x, c.position.z - b.pos.z);
  return { x: b.pos.x, z: b.pos.z, yaw: b.yaw, fwd: fy, toCam: ty, cur: a.cur, shown: a.source.shown, src: b.dbgSrc, state: b.state,
           bubble: a.bubble.visible ? a.bubble.el.textContent : '', op: b.opacity, nudges: b.nudges, holdMoves: b.holdMoves, face: b.dbgFace, moving: b.dbgMoving, stepping: b.stepping, ges: b.gesture, yawV: b.yawV }; })()"""


def ad(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page()
        await pg.goto(base.rstrip("/") + "/?autostart" + ("#floor-up" if floor == "upstairs" else ""))
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0 && window.__walk.floor.id === '%s'" % floor, timeout=60000)
        await pg.wait_for_timeout(5000)
        for f in frames:
            await Q.set_frame(pg, max(0, f - 90), 1500)
            for _ in range(3):  # real swipes up (walk forward)
                await pg.mouse.move(200, 650); await pg.mouse.down()
                for k in range(10):
                    await pg.mouse.move(200, 650 - 30 * (k + 1)); await pg.wait_for_timeout(16)
                await pg.mouse.up(); await pg.wait_for_timeout(250)
            # wait for the walk to coast to a stop (shown frame steady)
            prev = -1
            for _ in range(40):
                st = await pg.evaluate(ST)
                if abs(st["cur"] - prev) < 0.3:
                    break
                prev = st["cur"]; await pg.wait_for_timeout(100)
            s0 = await pg.evaluate(ST)
            tr = []
            for i in range(50):
                await pg.wait_for_timeout(100)
                tr.append(await pg.evaluate(ST))
            s1 = tr[9]; s5 = tr[-1]
            d15 = max(math.hypot(q["x"] - s1["x"], q["z"] - s1["z"]) for q in tr[9:])
            d05 = max(math.hypot(q["x"] - s0["x"], q["z"] - s0["z"]) for q in tr)
            yawf = math.degrees(ad(s5["yaw"], s5["fwd"]))
            ok = d15 < 0.15 and yawf <= 30
            print(f"{floor} stop at f{s0['shown']}: moved {d15:.2f} m from 1 s to 5 s ({d05:.2f} m from the stop), yaw vs forward {yawf:.0f} deg, src {s5["src"]}, state {s5["state"]}, face-vs-fwd {math.degrees(ad(s5["face"], s5["fwd"])):.0f} moving {s5["moving"]} stepping {s5["stepping"]} ges {s5["ges"]} yawV {s5["yawV"]:.2f} -> {'PASS' if ok else 'FAIL'}", flush=True)
            if NUDGE:
                await pg.wait_for_timeout(60000 - 5000 - 6000)
                seen = ""
                n0 = s0["nudges"]  # (counted from the stop: the nudge comes 60 s after the last swipe)
                for _ in range(60):  # (from 58 s: the bubble types the line out over ~2 s and shows it for 4 s)
                    st = await pg.evaluate(ST)
                    txt = st["bubble"].lstrip("> ").strip()
                    if txt and st["nudges"] > n0 and any(n.strip().lstrip("> ")[:10] in txt for n in NUDGES):
                        seen = txt
                    if seen and ad(st["yaw"], st["toCam"]) < math.radians(35):
                        break
                    await pg.wait_for_timeout(250)
                st = await pg.evaluate(ST)
                fc = math.degrees(ad(st["yaw"], st["toCam"]))
                ok2 = bool(seen) and fc <= 35
                print(f"{floor} 60 s idle at f{st['shown']}: facing the camera within {fc:.0f} deg, nudge line '{seen[:60]}', nudges {st['nudges']} -> {'PASS' if ok2 else 'FAIL'}", flush=True)


asyncio.run(main())
