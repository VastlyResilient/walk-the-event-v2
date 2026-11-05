"""Guide motion probe: walks a whole floor on the mobile profile (4x CPU throttle) at a given scroll style and
records the guide every rendered frame, then reports what a visitor would notice.

  .venv/bin/python qa/tools/guide_probe.py [base_url] [floor] [mode ...] [--shots DIR] [--json OUT]

  floor: upstairs | downstairs | both (default both)
  mode:  slow | swipe | flick (default: all three)

Per visible frame (walk shown, no station open, not in a transition) it measures:
  - frame:    feet-to-head box (plus body half-width) inside the footage column (2 px margin)
  - glide:    horizontal speed > 0.15 m/s while her facing is > 45 deg off her direction of travel (a slide)
  - teleport: a visible jump faster than 7.5 m/s horizontally
  - lane:     how far she stands outside the measured free lane (nav map) at her own path distance (walls, rails)
  - floor:    her height vs the nav floor_y under her own feet
  - depth:    footage depth at her feet / torso pixels vs her own camera distance, from the sense grid
              (feet ratio < 0.75: something in front of her feet; > 1.7: floor far behind her = air;
               torso ratio < 0.65: a wall / column between the camera and her body)
  - size:     her on-screen height as a fraction of the screen
Screenshots of the first few moments of each problem kind go to --shots (default qa/shots/guide_probe).
"""
import asyncio
import json
import math
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
ARGS = ["--js-flags=--expose-gc", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
MOBILE = dict(viewport={"width": 393, "height": 852}, device_scale_factor=3, is_mobile=True, has_touch=True,
              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")

argv = [a for a in sys.argv[1:]]
opts = {}
for flag in ("--shots", "--json", "--throttle"):
    if flag in argv:
        i = argv.index(flag)
        opts[flag] = argv[i + 1]
        del argv[i:i + 2]
BASE = argv[0] if argv else "http://127.0.0.1:5302/"
FLOORS = {"both": ["upstairs", "downstairs"]}.get(argv[1] if len(argv) > 1 else "both", [argv[1]] if len(argv) > 1 else [])
MODES = argv[2:] or ["slow", "swipe", "flick"]
SHOTS = pathlib.Path(opts.get("--shots", ROOT / "qa/shots/guide_probe"))
SHOTS.mkdir(parents=True, exist_ok=True)
THR = float(opts.get("--throttle", 4))

RECORDER = r"""(() => {
  const a = window.__walk, b = a.brain, v = a.view, se = a.sense;
  if (b.__probe) { window.__gp = []; return; }
  b.__probe = true;
  window.__gp = []; window.__gpNow = [];
  const orig = b.update.bind(b);
  const V = b.pos.constructor;
  const tmp = new V(), tmp2 = new V();
  let lastSense = -1, sm = { feet: null, torso: null, blk: null };
  let prev = null;
  b.update = (c) => {
    orig(c);
    try {
    const p = b.pos, t = performance.now();
    const f = Math.round(c.frame);
    const feet = v.project(tmp.copy(p)), head = v.project(tmp2.set(p.x, p.y + 1.65, p.z));
    const outro = !!(a.outro && a.outro.classList.contains('on'));
    const vis = b.opacity > 0.5 && !c.open && !c.inTransition && a.started && a.source.shown >= 0 && !outro;
    // lateral offset vs the measured free lane at her own path distance
    let lat = null, lane = null, fy = null, sHer = null;
    try {
      sHer = b.nearestS(p, b.S[f] ?? 0);
      const i = b.frameAtDistance(sHer), n = b.S.length;
      const i0 = Math.max(0, i - 6), i1 = Math.min(n - 1, i + 6);
      let tx = b.smX[i1] - b.smX[i0], tz = b.smZ[i1] - b.smZ[i0];
      const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      lat = (p.x - b.smX[i]) * -tz + (p.z - b.smZ[i]) * tx;
      const nv = b.navAt(sHer);
      if (nv) { lane = nv.lane; fy = nv.floor_y; }
      // distance from the walked path point itself (beyond the path ends = off the measured floor)
      var along = (p.x - b.smX[i]) * tx + (p.z - b.smZ[i]) * tz;
    } catch (e) {}
    // footage depth at her feet / torso (only when a new sense grid arrived)
    if (se.ready && se.frame !== lastSense) {
      lastSense = se.frame;
      const o = { u: 0, v: 0, z: 0 };
      const at = (y) => { const r = se.toImage(tmp.set(p.x, p.y + y, p.z), o); if (!r) return null; const k = se.cell(r.u, r.v); if (k < 0) return null; return { zo: se.metric(se.depth[k]), z: r.z, m: se.mask[k] }; };
      const fe = at(0.04), to = at(1.0);
      sm = { feet: fe ? fe.zo / fe.z : null, torso: to && to.m < 0.45 ? to.zo / to.z : null, blk: se.blocked(p) };
    }
    const rec = { t, cur: c.cur ?? c.frame, f, fl: a.floor.id, st: b.state, x: p.x, y: p.y, z: p.z, yaw: b.yaw,
      vis, W: v.width, H: v.height, ox: v.offsetX,
      fx: feet ? feet.x : null, fyp: feet ? feet.y : null, fz: feet ? feet.z : null, hx: head ? head.x : null, hy: head ? head.y : null,
      lat, lane, nfy: fy, along, sf: sm.feet, stor: sm.torso, blk: sm.blk, open: !!c.open, inT: !!c.inTransition, gl: !!c.gliding,
      ufps: c.userFps, spd: b.spd, src: b.dbgSrc, lead: b.lead, aS: b.aS, sV: b.sVs, sHer, Send: b.S[b.S.length - 1], nospot: !!b.noSpot, snaps: b.snaps || 0, panT: b.panT || 0 };
    window.__gp.push(rec);
    if (window.__gp.length > 200000) window.__gp.shift();
    } catch (e) { window.__gpErr = String(e); }
  };
})()"""

ANG = lambda d: (d + math.pi) % (2 * math.pi) - math.pi


def analyse(S, floor):
    S = [s for s in S if s["fl"] == floor]
    out = {"samples": len(S)}
    vis = 0
    issues = {k: [] for k in ("frame", "glide", "teleport", "lane", "floor", "feet_occluded", "air", "behind_wall", "size")}
    worst = {k: 0.0 for k in issues}
    dts = []
    # smoothed velocity over ~100 ms windows
    for i, s in enumerate(S):
        if i:
            dts.append(s["t"] - S[i - 1]["t"])
        if not s["vis"] or s["fx"] is None or s["hy"] is None:
            continue
        vis += 1
        hgt = s["fyp"] - s["hy"]
        half = hgt * 0.2
        x0 = min(s["fx"], s["hx"]) - half
        x1 = max(s["fx"], s["hx"]) + half
        over = max(s["ox"] + 2 - x0, x1 - (s["ox"] + s["W"] - 2), 2 - s["hy"], s["fyp"] - (s["H"] - 2), 0)
        if over > 0:
            issues["frame"].append(s); worst["frame"] = max(worst["frame"], over)
        frac = hgt / s["H"]
        if frac > 0.48:
            issues["size"].append(s); worst["size"] = max(worst["size"], frac)
        # velocity: look back ~100 ms
        j = i
        while j > 0 and S[i]["t"] - S[j]["t"] < 100:
            j -= 1
        if j < i and S[j]["vis"] and S[i]["t"] - S[j]["t"] > 30:
            dt = (S[i]["t"] - S[j]["t"]) / 1000
            vx, vz = (s["x"] - S[j]["x"]) / dt, (s["z"] - S[j]["z"]) / dt
            sp = math.hypot(vx, vz)
            if sp > 0.15:
                err = abs(ANG(math.atan2(vx, vz) - s["yaw"]))
                if err > math.radians(45):
                    issues["glide"].append(dict(s, gsp=sp, gerr=math.degrees(err))); worst["glide"] = max(worst["glide"], sp * math.sin(min(err, math.pi / 2)))
        if i and S[i - 1]["vis"]:
            dt = max(1e-3, (s["t"] - S[i - 1]["t"]) / 1000)
            d = math.hypot(s["x"] - S[i - 1]["x"], s["z"] - S[i - 1]["z"])
            if d / dt > 7.5 and d > 0.15:
                issues["teleport"].append(dict(s, jump=d)); worst["teleport"] = max(worst["teleport"], d)
        onlane = (s.get("src") or "lane").startswith("lane")  # camera-relative spots are judged by the footage depth
        if onlane and s["lane"] and s["lat"] is not None:
            o = max(s["lane"][0] - s["lat"], s["lat"] - s["lane"][1], 0)
            if o > 0.2:
                issues["lane"].append(dict(s, out=o)); worst["lane"] = max(worst["lane"], o)
        if onlane and s["nfy"] is not None:
            e = s["y"] - s["nfy"]
            if abs(e) > 0.15:
                issues["floor"].append(dict(s, err=e)); worst["floor"] = max(worst["floor"], abs(e))
        if s["sf"] is not None:
            if s["sf"] < 0.75:
                issues["feet_occluded"].append(s)
            if s["sf"] > 1.7:
                issues["air"].append(s); worst["air"] = max(worst["air"], s["sf"])
        if s["stor"] is not None and s["stor"] < 0.65:
            issues["behind_wall"].append(s)
    out["visible"] = vis
    out["fps"] = round(1000 / (sum(dts) / len(dts)), 1) if dts else None
    out["frame_ms_p95"] = round(sorted(dts)[int(len(dts) * 0.95)], 1) if dts else None
    rep = {}
    for k, L in issues.items():
        # episodes: contiguous runs (gap < 250 ms)
        eps = []
        for s in L:
            if eps and s["t"] - eps[-1]["t1"] < 250:
                eps[-1]["t1"] = s["t"]; eps[-1]["c1"] = s["cur"]; eps[-1]["n"] += 1
            else:
                eps.append({"t0": s["t"], "t1": s["t"], "c0": s["cur"], "c1": s["cur"], "n": 1, "st": s.get("src") or s["st"]})
        rep[k] = {"pct": round(100 * len(L) / max(1, vis), 2), "episodes": len(eps), "worst": round(worst[k], 2),
                  "where": [f"f{int(e['c0'])}-{int(e['c1'])}({e['st']},{(e['t1'] - e['t0']) / 1000:.1f}s)" for e in eps[:12]]}
    out["issues"] = rep
    vs = [s for s in S if s["vis"]]
    out["snaps"] = (S[-1].get("snaps") or 0) - (S[0].get("snaps") or 0) if S else 0
    out["nospot_pct"] = round(100 * sum(1 for s in vs if s.get("nospot")) / max(1, len(vs)), 2)
    # depth ratio baseline (how the sense metric reads on her own floor)
    fr = sorted(s["sf"] for s in S if s["vis"] and s["sf"] is not None)
    out["feet_depth_ratio_median"] = round(fr[len(fr) // 2], 2) if fr else None
    return out


async def drive(pg, mode, N, shot):
    """Scroll from frame ~0 to the end of the floor in the given style."""
    W, H = MOBILE["viewport"]["width"], MOBILE["viewport"]["height"]
    t_end = time.time() + 420
    n = 0
    while time.time() < t_end:
        cur = await pg.evaluate("window.__walk.cur")
        if cur >= N - 25:
            break
        x = W * 0.5
        if mode == "slow":
            # small, slow drags: ~25 px over 0.4 s, short rest
            await pg.mouse.move(x, H * 0.6); await pg.mouse.down()
            for k in range(12):
                await pg.mouse.move(x, H * 0.6 - 5 * (k + 1)); await pg.wait_for_timeout(33)
            await pg.wait_for_timeout(120)
            await pg.mouse.up()
            await pg.wait_for_timeout(150)
        elif mode == "swipe":
            await pg.mouse.move(x, H * 0.75); await pg.mouse.down()
            for k in range(12):
                await pg.mouse.move(x, H * 0.75 - 25 * (k + 1)); await pg.wait_for_timeout(18)
            await pg.mouse.up()
            await pg.wait_for_timeout(700)
        else:  # flick: fast, released with momentum
            await pg.mouse.move(x, H * 0.8); await pg.mouse.down()
            for k in range(6):
                await pg.mouse.move(x, H * 0.8 - 80 * (k + 1)); await pg.wait_for_timeout(10)
            await pg.mouse.up()
            await pg.wait_for_timeout(450)
        n += 1
        if n % (40 if mode == "slow" else 8) == 0:
            await pg.wait_for_timeout(2500)  # stop and look around (stations, the view)
        await shot(f"{mode}")
    # walk the last metres to the very end (a drag target, so the end-of-floor push / outro doesn't fire)
    await pg.evaluate(f"(() => {{ const a = window.__walk; a.vel = 0; a.dragTo = {N} - 1 - a.cur; }})()")
    await pg.wait_for_timeout(2500)
    await shot(f"{mode}_end")
    await pg.wait_for_timeout(4000)  # stand at the end of the floor
    await shot(f"{mode}_end", force=True)


async def run_floor(p, floor, mode):
    from playwright.async_api import async_playwright  # noqa
    br = await p.chromium.launch(channel="chrome", headless=True, args=ARGS)
    ctx = await br.new_context(**MOBILE)
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    await pg.goto(BASE + "?autostart")
    await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
    for _ in range(6):
        if await pg.evaluate("window.__walk.floor.id") == floor:
            break
        await pg.evaluate(f"window.__walk.goFloor('{floor}', 0)")
        await pg.wait_for_timeout(3000)
    await pg.wait_for_function(f"window.__walk.floor.id === '{floor}' && window.__walk.source.shown >= 0 && !window.__walk.inTransition", timeout=60000)
    await pg.wait_for_timeout(4500)
    cdp = await ctx.new_cdp_session(pg)
    await cdp.send("Emulation.setCPUThrottlingRate", {"rate": THR})
    await pg.evaluate(RECORDER)
    N = await pg.evaluate("window.__walk.floor.meta.frames")
    taken = {}

    async def shot(tag, force=False):
        # screenshot the moment a problem is on screen now (first few per kind)
        st = await pg.evaluate(r"""(() => { const g = window.__gp || []; const s = g[g.length - 1]; if (!s) return null;
          const k = []; if (s.vis && s.fx !== null && s.hy !== null) { const h = s.fyp - s.hy, half = h * 0.2;
            if (Math.min(s.fx, s.hx) - half < s.ox + 2 || Math.max(s.fx, s.hx) + half > s.ox + s.W - 2 || s.hy < 2 || s.fyp > s.H - 2) k.push('frame');
            if (s.lane && s.lat !== null && (s.lat < s.lane[0] - 0.2 || s.lat > s.lane[1] + 0.2)) k.push('lane');
            if (s.sf !== null && s.sf > 1.7) k.push('air'); if (s.stor !== null && s.stor < 0.65) k.push('wall');
            if (h / s.H > 0.48) k.push('size'); }
          return { k, cur: Math.round(s.cur) }; })()""")
        if not st:
            return
        kinds = st["k"] or (["end"] if force else [])
        for k in kinds:
            if taken.get(k, 0) >= 4 and not force:
                continue
            taken[k] = taken.get(k, 0) + 1
            await pg.screenshot(path=str(SHOTS / f"{floor}_{tag}_{k}_f{st['cur']}.png"))
            break

    await drive(pg, mode, N, shot)
    S = await pg.evaluate("window.__gp")
    await br.close()
    r = analyse(S, floor)
    r["errors"] = errors[:5]
    return r, S


async def main():
    from playwright.async_api import async_playwright
    allr = {}
    async with async_playwright() as p:
        for floor in FLOORS:
            for mode in MODES:
                r, S = await run_floor(p, floor, mode)
                allr[f"{floor}/{mode}"] = r
                iss = r["issues"]
                print(f"\n== {floor} / {mode}: {r['visible']} visible frames, {r['fps']} fps (p95 {r['frame_ms_p95']} ms), feet depth ratio median {r['feet_depth_ratio_median']}, unseen re-entries {r['snaps']}, no good spot {r['nospot_pct']}%", flush=True)
                for k, v in iss.items():
                    print(f"  {k:14s} {v['pct']:6.2f}%  episodes {v['episodes']:3d}  worst {v['worst']:6.2f}  {' '.join(v['where'][:8])}", flush=True)
                if opts.get("--json"):
                    pathlib.Path(opts["--json"]).with_suffix("").mkdir(parents=True, exist_ok=True)
                    json.dump(S, open(pathlib.Path(opts["--json"]).with_suffix("") / f"{floor}_{mode}.json", "w"))
    if opts.get("--json"):
        json.dump(allr, open(opts["--json"], "w"), indent=1)


if __name__ == "__main__":
    asyncio.run(main())
