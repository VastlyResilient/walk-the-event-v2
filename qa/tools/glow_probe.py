"""QA glow check replay: steps the scrub position as qa_run's sweep does (45-frame jumps) and prints the guide's
placement source, head screen point and live glow rects at the given frames.

  .venv/bin/python qa/tools/glow_probe.py [base] frame [frame ...]
"""
import asyncio, sys
from playwright.async_api import async_playwright
sys.path.insert(0, __file__.rsplit("/", 1)[0])
import qa_run as Q  # noqa: E402

base = sys.argv[1]
frames = [int(x) for x in sys.argv[2:]]


async def main():
    async with async_playwright() as p:
        ctx = await (await p.chromium.launch(channel="chrome", headless=True, args=Q.ARGS)).new_context(**Q.DEVICES[__import__("os").environ.get("DEV", "mobile")])
        pg = await ctx.new_page()
        await pg.goto(base)
        await pg.wait_for_selector(".intro .go:not([disabled])", timeout=45000)
        await pg.click(".intro .go")
        await Q.wait_ready(pg)
        await pg.wait_for_timeout(4200)
        for f in frames:
            for g in (f - 90, f - 45, f):
                st = await Q.set_frame(pg, g, 450)
                await pg.wait_for_timeout(600)
                st = await pg.evaluate(Q.STATE)
                ex = await pg.evaluate("(() => { const b = window.__walk.brain; const P = b.blockAt(window.__walk.view.frame, b.pos.clone()); return { src: b.dbgSrc, vb: b.dbgVb, pos: [b.pos.x, b.pos.z], gbPos: b.glowBad(b.pos, true), gbP: b.glowBad(P, true, 40), gbAlt: b.altOk ? b.glowBad(b.alt, true, 10) : null, dAlt: Math.hypot(b.alt.x - b.pos.x, b.alt.z - b.pos.z), spd: b.spd, stepping: b.stepping, vdS: [b.vdS.x, b.vdS.z], yaw: b.yaw, cf: b.curveFree, still: b.stillT, back: b.backT, yawV: b.yawV, close: b.closeK, ghost: b.ghost, op: b.opacity, pin: b.pInView, alt: b.altOk, Ph: (() => { const v = window.__walk.view; const a = v.project(P), h = v.project(P.clone().setY(P.y + 1.7)); return a && h ? [Math.round(h.x), Math.round(h.y)] : null; })(), nr: b.curRects.length, dP: Math.hypot(P.x - b.pos.x, P.z - b.pos.z) }; })()")
                hit = any(r["x0"] + 10 < st["head"]["x"] < r["x1"] - 10 and r["y0"] < st["head"]["y"] < r["y1"] for r in st["rects"]) if st["head"] else None
                print(g, "src", ex["src"], "gbPos", ex["gbPos"], "gbP", ex["gbP"], "nr", ex["nr"], "pin", ex["pin"], "alt", ex["alt"], "gbAlt", ex["gbAlt"], "dAlt %.2f" % ex["dAlt"], "spd %.2f" % ex["spd"], "step", ex["stepping"], "vdS", [round(v, 2) for v in ex["vdS"]], "yaw %.2f" % ex["yaw"], "cf", ex["cf"], "still %.2f" % ex["still"], "back %.2f" % ex["back"], "yawV %.2f" % ex["yawV"], "closeK %.2f" % ex["close"], "ghost", ex["ghost"], "op %.2f" % ex["op"], "Ph", ex["Ph"], "dP %.2f" % ex["dP"], "vb", [round(x, 2) for x in ex["vb"]], "head", st["head"] and (round(st["head"]["x"]), round(st["head"]["y"])), "feet", st["guideFeet"] and (round(st["guideFeet"]["x"]), round(st["guideFeet"]["y"])), "op %.2f" % st["op"],
                      "rects", [(round(r["x0"]), round(r["y0"]), round(r["x1"]), round(r["y1"])) for r in st["rects"]], "gspeed", round(st["gspeed"], 2), "HIT" if hit else "")


asyncio.run(main())
