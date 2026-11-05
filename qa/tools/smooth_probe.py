"""Swipe smoothness probe: walk a whole floor with real finger swipes on a throttled phone and measure what the eye
sees. Per animation frame it records the frame time, the frame the scroll wants (cur), the frame on screen (shown) and
the render pixel ratio; long tasks are recorded with the footage position they hit.

  python qa/tools/smooth_probe.py [base_url] [--floor downstairs|upstairs] [--cpu 4] [--net 4g|none] [--label NAME]

Reports (and writes qa/runs/smooth/<label>.json):
  hitches   frames longer than 33 / 50 / 100 ms (a 50 ms frame is a visible stutter)
  stalls    the picture holding still while the scroll moves, > 100 ms (a freeze)
  jumps     the picture skipping > 6 footage frames in one screen frame beyond what the scroll moved (a jolt)
  lag       |cur - shown| while moving (frames behind the finger)
  dpr       render-resolution changes (a visible soften/sharpen)
"""
import argparse, asyncio, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(__file__))
import qa_run as Q

REC = """
window.__sm = { f: [], lt: [] };
try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__sm.lt.push([e.startTime, e.duration, window.__walk ? window.__walk.cur : -1]); }).observe({ type: 'longtask', buffered: false }); } catch (e) {}
(function loop(t0) { requestAnimationFrame(t => { const a = window.__walk; if (a) window.__sm.f.push([t, t - t0, a.cur, a.source.shown, a.view.renderer.getPixelRatio(), a.floor.id, a.open ? 1 : 0, a.inTransition ? 1 : 0]); loop(t); }); })(performance.now());
"""

NET = {"4g": {"offline": False, "latency": 60, "downloadThroughput": 9e6 / 8, "uploadThroughput": 3e6 / 8},
       "3g": {"offline": False, "latency": 150, "downloadThroughput": 1.6e6 / 8, "uploadThroughput": 0.75e6 / 8}}


async def swipe(pg, dy=480, steps=24, hold=16):
    await pg.mouse.move(200, 720)
    await pg.mouse.down()
    for k in range(steps):
        await pg.mouse.move(200, 720 - dy * (k + 1) / steps)
        await pg.wait_for_timeout(hold)
    await pg.mouse.up()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default="http://127.0.0.1:5299/")
    ap.add_argument("--floor", default="downstairs")
    ap.add_argument("--cpu", type=float, default=4)
    ap.add_argument("--net", default="none")
    ap.add_argument("--label", default="probe")
    ap.add_argument("--seconds", type=float, default=150)
    a = ap.parse_args()
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg)
        if a.net in NET:
            await cdp.send("Network.enable")
            await cdp.send("Network.emulateNetworkConditions", NET[a.net])
        await pg.goto(a.base + ("#floor-up" if a.floor == "upstairs" else ""))
        if a.floor != "upstairs":  # a hash link starts the walk by itself
            await pg.wait_for_selector(".intro .go:not([disabled])", timeout=90000)
            await pg.click(".intro .go")
        await Q.wait_ready(pg)
        await pg.wait_for_timeout(3000)
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": a.cpu})
        await pg.evaluate(REC)
        t0 = asyncio.get_event_loop().time()
        n = 0
        # a visitor's rhythm: steady swipes, now and then a quicker flick, short pauses to look
        while asyncio.get_event_loop().time() - t0 < a.seconds:
            n += 1
            if n % 7 == 0: await swipe(pg, dy=560, steps=10, hold=12)      # flick
            else: await swipe(pg, dy=420, steps=24, hold=16)               # swipe
            await pg.wait_for_timeout(250 if n % 5 else 1200)
            st = await pg.evaluate("({cur: window.__walk.cur, end: (window.__walk.floor.end ?? window.__walk.floor.meta.frames - 1), fl: window.__walk.floor.id})")
            if st["fl"] != a.floor or st["cur"] >= st["end"] - 2: break
        F = await pg.evaluate("window.__sm.f")
        LT = await pg.evaluate("window.__sm.lt")
        await ctx.close()
    F = [x for x in F if x[5] == a.floor and not x[6] and not x[7]]
    dt = [x[1] for x in F[1:]]
    stalls, jumps, lags, run = [], [], [], 0.0
    for i in range(1, len(F)):
        dcur, dsh = F[i][2] - F[i - 1][2], F[i][3] - F[i - 1][3]
        moving = abs(dcur) > 0.05
        if moving: lags.append(abs(F[i][2] - F[i][3]))
        # a freeze: the picture holds while the frame the scroll wants is already a different one
        # (slow motion, where each footage frame is simply on screen longer, is not a freeze)
        if moving and dsh == 0 and round(F[i][2]) != F[i][3]: run += F[i][1]
        else:
            if run > 100: stalls.append([round(run), int(F[i][2])])
            run = 0
        if abs(dsh) - abs(dcur) > 6: jumps.append([int(F[i][3]), int(dsh), round(dcur, 1)])
    dpr = sum(1 for i in range(1, len(F)) if F[i][4] != F[i - 1][4])
    hitch = [[round(x[1]), int(x[2])] for x in F[1:] if x[1] > 50]
    sdt = sorted(dt)
    r = {"label": a.label, "floor": a.floor, "cpu": a.cpu, "net": a.net, "frames": len(F), "swipes": n,
         "reached": int(F[-1][2]) if F else 0,
         "ft_p50": round(statistics.median(dt), 1), "ft_p99": round(sdt[int(len(sdt) * .99)], 1), "ft_max": round(max(dt)),
         "over33": sum(1 for x in dt if x > 33.4), "over50": len(hitch), "over100": sum(1 for x in dt if x > 100),
         "stalls_100ms": len(stalls), "stall_max": max([s[0] for s in stalls], default=0),
         "jumps": len(jumps), "lag_p95": round(sorted(lags)[int(len(lags) * .95)], 1) if lags else 0, "lag_max": round(max(lags, default=0), 1),
         "dpr_changes": dpr, "longtasks": len(LT),
         "hitch_list": hitch[:40], "stall_list": stalls[:40], "jump_list": jumps[:40], "longtask_list": [[round(d), int(c)] for _, d, c in LT][:40]}
    os.makedirs("qa/runs/smooth", exist_ok=True)
    json.dump(r, open(f"qa/runs/smooth/{a.label}_{a.floor}.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in r.items() if not k.endswith("_list")}))
    print("hitches (ms, frame):", r["hitch_list"][:20])
    print("stalls (ms, frame):", r["stall_list"][:20])
    print("jumps (shown, dshown, dcur):", r["jump_list"][:12])
    print("longtasks (ms, frame):", r["longtask_list"][:20])


asyncio.run(main())
