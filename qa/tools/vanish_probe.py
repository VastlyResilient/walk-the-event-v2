"""Vanish probe: walk a whole floor forward like a visitor (real swipes, or hold-to-walk) and log every moment she
disappears or comes back: dissolves (camera proximity / stuck at an edge), walk-ins from a frame edge, fade-ins, jumps
of her position while drawn (> 0.4 m in one frame), and stretches fully out of frame (> 0.3 s).

  .venv/bin/python qa/tools/vanish_probe.py <base> <floor> [--hold] [--from F] [--to F]
"""
import asyncio, math, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base, floor = sys.argv[1], sys.argv[2]
HOLD = "--hold" in sys.argv
arg = lambda k, d: int(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
F0, F1 = arg("--from", 0), arg("--to", 10**9)
REC = """(() => { window.__vl = []; const a = window.__walk, b = a.brain; let px = null, pz = 0, pn = { d: 0, r: 0 };
  if (true) b.dbgLog = []; const f = () => { const p = b.pos; const lg = b.dbgLog ? b.dbgLog.filter((e) => e.kind === 'loco').at(-1) : null; if (b.dbgLog) b.dbgLog.length = 0; const vb = b.dbgVb; const n = { d: b.proxDissolves + b.edgeDissolves, r: b.reentries };
    const ev = []; if (n.d > pn.d) ev.push('dissolve:' + b.dbgWhy); if (n.r > pn.r) ev.push(/stepon/.test(b.dbgSrc) ? 'stepon' : 'walkin'); if (/fadein/.test(b.dbgSrc)) ev.push('fadein');
    if (px !== null && b.opacity > 0.5 && Math.hypot(p.x - px, p.z - pz) > 0.4) ev.push('jump');
    window.__vl.push([a.source.shown, b.opacity, vb[0], ev.join(','), b.dbgSrc, +p.x.toFixed(2), +p.z.toFixed(2), +vb[1].toFixed(2), +vb[2].toFixed(2), +b.spd.toFixed(2), +Math.hypot(b.goalPrev.x - p.x, b.goalPrev.z - p.z).toFixed(2), +b.closeK.toFixed(2), +b.closeRate.toFixed(2), lg ? `err${lg.err} want${lg.wantV} vdl${lg.vdl} step${+lg.step} hur${lg.hurry} glow${+b.inGlow} cf${+b.curveFree}` : '']);
    px = p.x; pz = p.z; pn = n; requestAnimationFrame(f); };
  requestAnimationFrame(f); })()"""


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES["mobile"])
        pg = await ctx.new_page(); pg.set_default_timeout(180000)
        await pg.goto(base.rstrip("/") + "/?autostart" + ("#floor-up" if floor == "upstairs" else ""))
        await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0 && window.__walk.floor.id === '%s'" % floor, timeout=60000)
        await pg.wait_for_timeout(4000)
        if F0: await Q.set_frame(pg, F0, 2500)
        await pg.evaluate(REC)
        end = min(F1, await pg.evaluate("window.__walk.floor.end - 5"))
        if HOLD:
            await pg.evaluate("document.querySelector('.pad-fwd').style.display = ''")
            bb = await pg.locator(".pad-fwd").first.bounding_box()
            await pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2); await pg.mouse.down()
        stuck, last = 0, -1
        while True:
            cur = await pg.evaluate("window.__walk.cur")
            if cur >= end or await pg.evaluate("window.__walk.floor.id") != floor: break
            if await pg.evaluate("!!window.__walk.open"):
                await pg.evaluate("window.__walk.closeStation()"); await pg.wait_for_timeout(800)
            stuck = stuck + 1 if abs(cur - last) < 1 else 0; last = cur
            if stuck > 25: print("stuck at", cur); break
            if HOLD:
                await pg.wait_for_timeout(400)
            else:
                await pg.mouse.move(200, 600); await pg.mouse.down()
                for k in range(8):
                    await pg.mouse.move(200, 600 - 30 * (k + 1)); await pg.wait_for_timeout(16)
                await pg.mouse.up(); await pg.wait_for_timeout(180)
        if HOLD: await pg.mouse.up()
        L = await pg.evaluate("window.__vl")
        out, outF = 0, None
        n = {"stepon": 0, "dissolve": 0, "walkin": 0, "fadein": 0, "jump": 0, "offscreen": 0}
        for q in L:
            for e in filter(None, q[3].split(",")):
                k = e.split(":")[0]
                if k == "fadein" and n.get("_lastfade") == q[0]: continue
                n[k] += 1; n["_lastfade"] = q[0] if k == "fadein" else n.get("_lastfade")
                print(f"  f{q[0]} {e} src={q[4]} op={q[1]:.2f} in={q[2]:.2f}")
                if "--ctx" in sys.argv and k == "dissolve":
                    i = L.index(q)
                    for r in L[max(0, i - 40):i + 1:4]: print(f"      f{r[0]} h{r[7]} camD{r[8]} spd{r[9]} toGoal{r[10]} closeK{r[11]} rate{r[12]} {r[4]} {r[13]}")
            if q[2] < 0.3 and q[1] > 0.5: out += 1; outF = outF or q[0]
            else:
                if out > 18: n["offscreen"] += 1; print(f"  f{outF} offscreen {out} frames")
                out, outF = 0, None
        n.pop("_lastfade", None)
        print(f"{floor} {'hold' if HOLD else 'swipes'} f{L[0][0]}..f{L[-1][0]} ({len(L)} frames): {n}", flush=True)


asyncio.run(main())
