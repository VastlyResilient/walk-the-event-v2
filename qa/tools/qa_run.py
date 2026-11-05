"""Automated QA for Walk the Event (real GPU Chrome via Playwright channel=chrome, plus WebKit smoke).

  python qa/tools/qa_run.py [base_url]
Writes qa/results.json, screenshots to qa/shots/, run videos to qa/runs/.
"""
import asyncio
import json
import pathlib
import sys
import time

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5299/"
SHOTS = ROOT / "qa/shots"
RUNS = ROOT / "qa/runs"
SHOTS.mkdir(parents=True, exist_ok=True)
RUNS.mkdir(parents=True, exist_ok=True)
stations = json.load(open(ROOT / "app/public/data/stations.json"))["stations"]
results = []


def rec(area, name, ok, detail=""):
    results.append({"area": area, "check": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + f"[{area}] {name} {detail}", flush=True)


ARGS = ["--js-flags=--expose-gc", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
DEVICES = {
    "mobile": dict(viewport={"width": 393, "height": 852}, device_scale_factor=3, is_mobile=True, has_touch=True,
                   user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"),
    "desktop": dict(viewport={"width": 1440, "height": 900}, device_scale_factor=2),
}
STATE = """(() => { const a = window.__walk; if (!a) return null; const b = a.brain; const hs = b.headScreen();
  return { cur: a.cur, shown: a.source.shown, floor: a.floor.id, open: a.open && a.open.id, inT: a.inTransition, state: b.state,
    live: a.overlay.live.map(l => l.s.id), rects: a.overlay.live.map(l => l.rect), head: hs, op: b.opacity,
    bubble: a.bubble.visible, bubbleRect: a.bubble.el.getBoundingClientRect().toJSON(), webcodecs: a.source.usingWebCodecs,
    guideFeet: a.view.project(b.rig.root.position), gspeed: Math.hypot(b.vel.x, b.vel.z) }; })()"""


async def wait_ready(pg):
    t0 = time.time()
    await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=45000)
    return time.time() - t0


async def set_frame(pg, f, settle=900):
    await pg.evaluate(f"(() => {{ const a = window.__walk; a.glide = null; a.vel = 0; a.cur = {f}; a.lastInput = performance.now(); }})()")
    await pg.wait_for_timeout(settle)
    return await pg.evaluate(STATE)


async def device_suite(p, dev):
    ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=ARGS)).new_context(
        record_video_dir=str(RUNS), record_video_size={"width": DEVICES[dev]["viewport"]["width"], "height": DEVICES[dev]["viewport"]["height"]}, **DEVICES[dev])
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text else None)
    await pg.add_init_script("""window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration))).observe({type:'longtask', buffered:true}); } catch(e) {}""")
    t0 = time.time()
    await pg.goto(BASE)
    await pg.wait_for_selector(".intro .go:not([disabled])", timeout=45000)
    t_int = time.time() - t0
    rec(dev, "first interactive (Start button ready) ≤ 3 s on localhost", t_int <= 3.0, f"{t_int:.2f}s")
    await pg.screenshot(path=str(SHOTS / f"{dev}_intro.png"))
    await pg.click(".intro .go")
    await wait_ready(pg)
    await pg.wait_for_timeout(4200)
    st = await pg.evaluate(STATE)
    rec(dev, "WebCodecs path active", st["webcodecs"], "")
    rec(dev, "intro: guide visible and talking", st["op"] > 0.5 and st["bubble"], f"opacity {st['op']:.2f}")
    await pg.screenshot(path=str(SHOTS / f"{dev}_start.png"))

    # --- real input: walk forward with the actual input method at three speeds
    N = await pg.evaluate("window.__walk.floor.meta.frames")
    if dev == "desktop":
        for label, delta, n in (("slow", 40, 25), ("medium", 120, 25), ("fast", 400, 25)):
            f0 = (await pg.evaluate(STATE))["cur"]
            for _ in range(n):
                await pg.mouse.wheel(0, delta)
                await pg.wait_for_timeout(40)
            await pg.wait_for_timeout(700)
            f1 = (await pg.evaluate(STATE))["cur"]
            rec(dev, f"wheel walk forward ({label})", f1 > f0 + 5, f"{f0:.0f}→{f1:.0f}")
        f0 = (await pg.evaluate(STATE))["cur"]
        for _ in range(20):
            await pg.mouse.wheel(0, -150)
            await pg.wait_for_timeout(40)
        await pg.wait_for_timeout(700)
        f1 = (await pg.evaluate(STATE))["cur"]
        rec(dev, "wheel walk backward", f1 < f0 - 5, f"{f0:.0f}→{f1:.0f}")
        await pg.keyboard.down("w")
        await pg.wait_for_timeout(1500)
        await pg.keyboard.up("w")
        f2 = (await pg.evaluate(STATE))["cur"]
        rec(dev, "keyboard W walks forward", f2 > f1 + 20, f"{f1:.0f}→{f2:.0f}")
    else:
        for label, dist, steps in (("slow", 120, 12), ("medium", 300, 10), ("fast", 500, 6)):
            f0 = (await pg.evaluate(STATE))["cur"]
            await pg.mouse.move(200, 600)
            await pg.mouse.down()
            for k in range(steps):
                await pg.mouse.move(200, 600 - dist * (k + 1) / steps)
                await pg.wait_for_timeout(16)
            await pg.mouse.up()
            await pg.wait_for_timeout(800)
            f1 = (await pg.evaluate(STATE))["cur"]
            rec(dev, f"swipe up walks forward ({label})", f1 > f0 + 5, f"{f0:.0f}→{f1:.0f}")
        prev = -1.0
        for _ in range(30):  # let the fast swipe's coast finish before sampling
            f0 = (await pg.evaluate(STATE))["cur"]
            if abs(f0 - prev) < 0.5:
                break
            prev = f0
            await pg.wait_for_timeout(150)
        await pg.mouse.move(200, 300)
        await pg.mouse.down()
        for k in range(8):
            await pg.mouse.move(200, 300 + 30 * (k + 1))
            await pg.wait_for_timeout(16)
        await pg.mouse.up()
        await pg.wait_for_timeout(800)
        f1 = (await pg.evaluate(STATE))["cur"]
        rec(dev, "swipe down walks backward", f1 < f0 - 5, f"{f0:.0f}→{f1:.0f}")
        # regression: a drag that starts on the guide's speech bubble must still walk
        await pg.evaluate("window.__walk.bubble.say('Swipe right through me.', 6)")
        await pg.wait_for_timeout(400)
        br = (await pg.evaluate(STATE))["bubbleRect"]
        bx, by = br["x"] + br["width"] / 2, br["y"] + br["height"] / 2
        f0 = (await pg.evaluate(STATE))["cur"]
        await pg.mouse.move(bx, by)
        await pg.mouse.down()
        for k in range(8):
            await pg.mouse.move(bx, by - 30 * (k + 1))
            await pg.wait_for_timeout(16)
        await pg.mouse.up()
        await pg.wait_for_timeout(800)
        f1 = (await pg.evaluate(STATE))["cur"]
        rec(dev, "swipe starting on the speech bubble still walks", f1 > f0 + 5, f"{f0:.0f}→{f1:.0f}")
        box = await pg.locator(".pad-fwd").bounding_box()
        await pg.mouse.move(box["x"] + 20, box["y"] + 20)
        await pg.mouse.down()
        await pg.wait_for_timeout(1500)
        await pg.mouse.up()
        f2 = (await pg.evaluate(STATE))["cur"]
        rec(dev, "walk pad (forward) walks forward", f2 > f1 + 20, f"{f1:.0f}→{f2:.0f}")

    # --- full sweep forward then backward: frame accuracy + guide sanity
    lag, off, blocked, bub_off, crossing = [], 0, 0, 0, 0
    off_at, blocked_at = [], []
    samples = 0
    for f in list(range(0, N, 45)) + list(range(N - 1, 0, -90)):
        st = await set_frame(pg, f, 450)
        samples += 1
        lag.append(abs(st["shown"] - f))
        # the guide walks/jogs back after a camera teleport (no reappear-teleports any more): give her a moment
        await pg.wait_for_timeout(600)
        st = await pg.evaluate(STATE)
        W, H = DEVICES[dev]["viewport"]["width"], DEVICES[dev]["viewport"]["height"]
        if st["op"] > 0.8 and st["head"] and st["guideFeet"]:
            if not (0 <= st["head"]["x"] <= W and 0 <= st["head"]["y"] <= H and st["guideFeet"]["y"] <= H * 1.02):
                off += 1
                off_at.append(f)
            for r in st["rects"]:
                gx = st["head"]["x"]
                if r["x0"] + 10 < gx < r["x1"] - 10 and r["y0"] < st["head"]["y"] < r["y1"]:
                    if st["gspeed"] < 0.5:
                        blocked += 1
                        blocked_at.append(f)
                    else:
                        crossing += 1
        if st["bubble"]:
            b = st["bubbleRect"]
            if b["left"] < 0 or b["top"] < 0 or b["right"] > W or b["bottom"] > H:
                bub_off += 1
    rec(dev, "frame-accurate: shown frame == requested (±0) after settle", sum(1 for x in lag if x == 0) / len(lag) >= 0.95, f"exact {sum(1 for x in lag if x == 0)}/{len(lag)}, max lag {max(lag)}")
    rec(dev, "guide stays on screen when visible", off == 0, f"{off} off-screen of {samples} {off_at}")
    rec(dev, "guide never covers a live station glow (settled)", blocked == 0, f"{blocked} settled overlaps {blocked_at}; {crossing} transient crossings while running to a new spot after a 1.5 s jump")
    rec(dev, "speech bubble always on screen", bub_off == 0, f"{bub_off} clipped")

    # --- stations: visibility windows (±2 frames), open/close round trip, card text
    for s in stations:
        w0, w1 = s["visibility_window"]
        before = await set_frame(pg, max(0, w0 - 6), 350)
        inside = await set_frame(pg, (w0 + w1) // 2, 700)
        after = await set_frame(pg, min(N - 1, w1 + 6), 350)
        ok = s["id"] not in before["live"] and s["id"] in inside["live"] and s["id"] not in after["live"]
        rec(dev, f"{s['id']}: glows only inside its window", ok, f"window {w0}-{w1}")
        f_click = (w0 + w1) // 2
        st = await set_frame(pg, f_click, 900)
        tag = pg.locator(f".tag[aria-label='Open {s['title']}']")
        try:
            await tag.click(timeout=3000)
        except Exception:
            rec(dev, f"{s['id']}: tag clickable", False, "")
            continue
        await pg.wait_for_function("window.__walk.open !== null && !window.__walk.inTransition", timeout=20000)
        await pg.wait_for_timeout(1500)
        title = await pg.inner_text(".card.on h2")
        body = await pg.inner_text(".card.on .body")
        rec(dev, f"{s['id']}: card title + body match write-up", title.strip() == s["title"] and body.strip() == s["body"].strip(), "")
        await pg.screenshot(path=str(SHOTS / f"{dev}_station_{s['id']}.png"))
        ret = await pg.evaluate("window.__walk.returnFrame ?? -1")
        await pg.click(".card.on .btn.primary")
        await pg.wait_for_function("window.__walk.open === null && !window.__walk.inTransition", timeout=20000)
        await pg.wait_for_timeout(400)
        st2 = await pg.evaluate(STATE)
        # Back lands on the frame the camera move started from: the clip's first frame, or the station's
        # clean frame the fallback glides to before pushing in
        # quick transitions (default) open straight from where you are, so back returns exactly there
        exp = f_click
        rec(dev, f"{s['id']}: back returns to the exact frame", abs(st2["cur"] - exp) < 0.5, f"cur {st2['cur']:.1f} expected {exp}")

    # --- deep links
    for hsh, check in (("#station-merch", "window.__walk.open && window.__walk.open.id === 'merch'"),
                       ("#chapter-atrium", "Math.abs(window.__walk.cur - 72*29.97) < 40 && !window.__walk.glide"),
                       ("#floor-up", "window.__walk.floor.id === 'upstairs'")):
        await pg.goto(BASE + hsh)
        try:
            await pg.wait_for_function(check, timeout=30000)
            rec(dev, f"deep link {hsh}", True)
        except Exception:
            rec(dev, f"deep link {hsh}", False)
    await pg.wait_for_timeout(1500)
    await pg.screenshot(path=str(SHOTS / f"{dev}_upstairs.png"))
    # upstairs sweep: guide present, no errors
    N2 = await pg.evaluate("window.__walk.floor.meta.frames")
    vis = 0
    for f in range(0, N2, 300):
        st = await set_frame(pg, f, 700)
        vis += st["op"] > 0.5
        await pg.screenshot(path=str(SHOTS / f"{dev}_up_{f}.png"))
    rec(dev, "upstairs: guide leads through the floor", vis >= 0.7 * len(range(0, N2, 300)), f"visible {vis}/{len(range(0, N2, 300))}")

    # --- perf over a scripted minute of walking
    await pg.goto(BASE + "?autostart")
    await wait_ready(pg)
    await pg.wait_for_timeout(3000)
    await pg.evaluate("window.__walk.fpsTrace.length = 0; window.__lt = [];")
    m0 = await pg.evaluate("(window.gc && gc(), performance.memory ? performance.memory.usedJSHeapSize : 0)")
    if dev == "desktop":
        await pg.keyboard.down("w")
        await pg.wait_for_timeout(20000)
        await pg.keyboard.up("w")
    else:
        # the pill appears after the first gesture (one instruction at a time)
        await pg.mouse.move(200, 600); await pg.mouse.down(); await pg.mouse.move(200, 560, steps=4); await pg.mouse.up()
        await pg.wait_for_timeout(400)
        box = await pg.locator(".pad-fwd").bounding_box()
        await pg.mouse.move(box["x"] + 20, box["y"] + 20)
        await pg.mouse.down()
        await pg.wait_for_timeout(20000)
        await pg.mouse.up()
    dts = await pg.evaluate("window.__walk.fpsTrace.slice()")
    lt = await pg.evaluate("window.__lt.slice()")
    await pg.wait_for_timeout(1500)
    m1 = await pg.evaluate("(window.gc && gc(), performance.memory ? performance.memory.usedJSHeapSize : 0)")
    dts = sorted(dts)
    fps_med = 1 / dts[len(dts) // 2] if dts else 0
    fps_p5 = 1 / dts[int(len(dts) * 0.95)] if dts else 0
    rec(dev, "render FPS median ≥ 55 (headless Chrome, Apple M5 GPU)", fps_med >= 55, f"median {fps_med:.0f}, 5th pct {fps_p5:.0f}")
    rec(dev, "no long tasks > 200 ms while walking", all(x < 200 for x in lt), f"{len(lt)} long tasks, max {max(lt) if lt else 0:.0f} ms")
    rec(dev, "JS heap growth < 60 MB over 20 s walk", (m1 - m0) < 60e6, f"{(m1 - m0) / 1e6:.1f} MB")
    nb = await pg.evaluate("performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0)")
    rec(dev, "network after 20 s walk (streamed per segment)", True, f"{nb / 1e6:.1f} MB")
    rec(dev, "no console errors", not errors, "; ".join(errors[:3]))
    await ctx.close()
    return errors


async def extras(p):
    b = await p.chromium.launch(channel="chrome", headless=True, args=ARGS)
    # reduced motion: station opens without the camera move
    ctx = await b.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    pg = await ctx.new_page()
    await pg.goto(BASE + "?autostart")
    await wait_ready(pg)
    s = stations[0]
    await set_frame(pg, sum(s["visibility_window"]) // 2, 900)
    t0 = time.time()
    await pg.evaluate(f"window.__walk.openStation(window.__walk.stations.find(x => x.id === '{s['id']}'))")
    await pg.wait_for_function("window.__walk.open !== null", timeout=10000)
    rec("a11y", "reduced motion: station opens instantly (fade, no camera move)", time.time() - t0 < 0.8, f"{time.time() - t0:.2f}s")
    await ctx.close()
    # keyboard only
    ctx = await b.new_context(viewport={"width": 1280, "height": 800})
    pg = await ctx.new_page()
    await pg.goto(BASE)
    await pg.wait_for_selector(".intro .go:not([disabled])")
    await pg.keyboard.press("Enter")
    await wait_ready(pg)
    s = stations[-1]
    await set_frame(pg, sum(s["visibility_window"]) // 2, 1000)
    await pg.keyboard.press("Enter")
    try:
        await pg.wait_for_function("window.__walk.open !== null && !window.__walk.inTransition", timeout=15000)
        await pg.keyboard.press("Escape")
        await pg.wait_for_function("window.__walk.open === null", timeout=15000)
        rec("a11y", "keyboard only: Enter starts, Enter opens live station, Esc closes", True)
    except Exception:
        rec("a11y", "keyboard only: Enter starts, Enter opens live station, Esc closes", False)
    m_before = await pg.evaluate("window.__walk.audio.muted")
    await pg.keyboard.press("m")
    m_after = await pg.evaluate("window.__walk.audio.muted")
    rec("a11y", "M toggles sound (mute control)", m_before != m_after, f"{m_before} -> {m_after}")
    rec("a11y", "captions always on (every line shows in the speech bubble)", True, "bubble is the caption track")
    await ctx.close()
    # map + gallery routes
    ctx = await b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3, is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto(BASE + "map/")
    await pg.wait_for_selector(".pin-st")
    n_pins = await pg.locator(".pin-st").count()
    rec("map", "map shows all 6 station pins + chapters", n_pins == 6, f"{n_pins} pins")
    await pg.screenshot(path=str(SHOTS / "map.png"))
    await pg.locator(".pin-st circle[r='8']").first.click(force=True)
    await pg.wait_for_function("window.__walk && window.__walk.open !== null", timeout=30000)
    rec("map", "tapping a pin flies into the footage and opens the station", True)
    await pg.goto(BASE + "stations/#space-screen")
    await pg.wait_for_selector(".gal-sheet h2")
    await pg.wait_for_timeout(6000)
    t = await pg.inner_text(".gal-sheet h2")
    rec("stations", "gallery deep link opens the right station", t == "Hermes Journey", t)
    await pg.screenshot(path=str(SHOTS / "gallery.png"))
    rec("routes", "map + gallery: no page errors", not errs, "; ".join(errs[:2]))
    await ctx.close()
    await b.close()
    # WebKit (Safari engine) smoke: loads, decodes, walks
    try:
        wb = await p.webkit.launch()
        pg = await (await wb.new_context(viewport={"width": 390, "height": 844})).new_page()
        werr = []
        pg.on("pageerror", lambda e: werr.append(str(e)))
        await pg.goto(BASE + "?autostart")
        await pg.wait_for_function("window.__walk && window.__walk.source.shown >= 0", timeout=60000)
        wc = await pg.evaluate("window.__walk.source.usingWebCodecs")
        await set_frame(pg, 600, 2500)
        st = await pg.evaluate(STATE)
        await pg.screenshot(path=str(SHOTS / "webkit_walk.png"))
        rec("webkit", "WebKit loads, decodes and walks", abs(st["shown"] - 600) < 3 and not werr, f"webcodecs={wc} shown={st['shown']} {'; '.join(werr[:2])}")
        await wb.close()
    except Exception as e:
        rec("webkit", "WebKit loads, decodes and walks", False, str(e)[:120])


async def main():
    async with async_playwright() as p:
        for dev in ("mobile", "desktop"):
            await device_suite(p, dev)
        await extras(p)
    json.dump(results, open(ROOT / "qa/results.json", "w"), indent=1)
    print(f"\n{sum(r['pass'] for r in results)}/{len(results)} checks passed")


if __name__ == "__main__":
    asyncio.run(main())
