"""Walk audit: deterministic mobile acceptance test of the whole walkthrough (both floors), measuring per frame
whether the 3D guide behaves like a real human tour guide.

  .venv/bin/python qa/tools/walk_audit.py --base http://127.0.0.1:5301/ \
      --floors downstairs,upstairs --scenarios slow,swipes,flicks,stations,reverse --label NAME \
      [--throttle 4] [--seed 1] [--repeat 5] [--keep-frames]

Output: qa/runs/audit/<label>/ (with --repeat N: run1..runN/ plus an aggregate report at the top level)
  summary.json, report.md, graphs/<floor>_<scenario>.png, sheets/<floor>_<scenario>.jpg (contact sheet every ~1 s
  plus every failure moment), sheets/<floor>_<scenario>_fail.jpg (failure moments only, larger), fail_frames/*.jpg.
Exit code 1 if any metric FAILs in any run.

How it measures
  * Real phone input: Playwright Chrome (channel=chrome), the iPhone profile from qa_run.DEVICES, touch events through
    CDP Input.dispatchTouchEvent (pointerType "touch", like a finger), CPU throttled with
    Emulation.setCPUThrottlingRate (default 4x).
  * An injected requestAnimationFrame recorder buffers one sample per animation frame inside the page; Python drains
    the buffer every ~0.4 s, so sampling never blocks the render loop. The recorder runs before the app's own rAF
    callback each frame, so every sample is the state of the frame that was just presented (camera, guide, bones and
    sense all from the same frame).
  * Her body box is her ACTUAL skinned mesh: ~420 vertices of each SkinnedMesh under rig.root are skinned on the CPU
    with the live bone matrices and projected through the live camera. Her lowest point per foot comes from the sole
    vertices (vertices weighted to bones named *Foot*/*Toe*), so float/sink is measured at the sole, not a bone.
  * Screenshots: CDP Page.startScreencast frames (timestamped in the same wall clock as the samples), so every
    failure moment found afterwards has the picture that was on screen at that instant.

window.__walk fields this test reads (keep these stable, or update RECORDER_JS):
  __walk.cur, __walk.source.shown, __walk.started, __walk.open, __walk.inTransition, __walk.glide,
  __walk.floor.id, __walk.floor.meta.frames, __walk.floor.meta.fps, __walk.floor.cam.{pos,quat,intrinsics,
    depth_a,depth_b,camera_height_m,frames}, __walk.menu.isOpen (optional),
  __walk.view.{camera (matrixWorldInverse, projectionMatrix), width, height, offsetX, dolly.z (optional)},
  __walk.brain.{pos, yaw, state, opacity, rig.root, nav (optional: samples/blockers/rails, read once per floor),
    spd, gesture ('none' = no gesture), railAt, talking, laneW (optional)},
  __walk.brain.rig.bones (optional: Left/Right Arm, ForeArm, Hand, ToeBase (or Foot) world positions: posture + foot slide),
  __walk.brain.anim.pointW (optional: presenting-arm weight),
  __walk.brain.anim.mixer (optional: AnimationMixer; clip weights by clip name: /^(walk|run|sprint|stairs|jog)/ = stride
    clips, /^turn/ = turning in place, idle, /^(hop|cheer|jump)/ = airborne, anything else = gesture),
  Her body: every SkinnedMesh under rig.root (bones named *Foot*/*Toe* mark the soles).
  __walk.sense.{frame, depth, mask, people} (grid GW=36 x GH=64 over the image, depth = raw disparity 0..1).
  The metric depth conversion 1/(a*d+b) with floor.cam.depth_a/b[frame] is recomputed here (same as sense.ts and
  the guide's occlusion shader). Every access is wrapped: a missing field gives NaN/None, never a crash.
DOM: .intro, .tag[aria-label='Open <title>'], .card.on .btn.primary, .menu-btn, .menu-floor button.
Floor switching: downstairs end -> stairs moment (keep swiping), the side menu floor buttons, and the #floor-up hash
(the app has no ?floor= query param; the hash is its URL entry point).
"""
import argparse
import asyncio
import base64
import gzip
import io
import json
import math
import os
import pathlib
import random
import shutil
import sys
import time
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]

# ------------------------------------------------------------------------------------------------ thresholds
GRACE_S = 0.8                 # after a station card / floor switch / chapter glide / menu, she may fade back in
OFFSCREEN_MARGIN_PX = 4       # body box may poke this far past the viewport edge
OFFSCREEN_MAX_RUN_S = 0.3     # FAIL if any continuous off-screen stretch is longer
OFFSCREEN_MAX_FRAC = 0.01     # ... or off-screen in more than this fraction of visible frames
HIDDEN_MAX_RUN_S = 0.25       # root invisible / faded out while she should be visible
HIDDEN_MAX_FRAC = 0.005
TELEPORT_SPEED = 7.5          # m/s horizontal world speed in one frame
TELEPORT_VSPEED = 2.0         # m/s vertical world speed in one frame
TELEPORT_SCREEN_PX = 40       # px her own motion moves her on screen in one frame (normalised to a 33 ms frame)
GLIDE_LAT = 0.35              # m/s sideways (perpendicular to facing)
GLIDE_BACK = 0.3              # m/s backwards relative to facing
GLIDE_RUN_S = 0.25            # persistence for the glide checks
BACKSTEP_MAX_MS, BACKSTEP_MAX_S = 0.85, 1.6   # approved backward steps (round 6c)
SNAP_TURN_RATE = 12.0         # rad/s facing change within one frame (a fast human pivot peaks ~6-8 rad/s)
NOLOCO_SPEED = 0.3            # moving faster than this ...
NOLOCO_WEIGHT = 0.3           # ... with locomotion clip weight below this = sliding without walking
SMOOTH_YAW_P95 = 1.5           # rad/s   (previous criterion, still reported)
SMOOTH_ACC_P95 = 3.0           # m/s^2   (previous criterion, still reported)
JIT_WIN_S = 0.25               # centred moving-average window the jitter residual is taken against
JIT_SPEED_RMS = 0.08           # m/s     root speed minus its own 0.25 s centred average, RMS
JIT_YAW_RMS = 0.2              # rad/s   yaw rate minus its own 0.25 s centred average, RMS (round 5: was 0.08)
JIT_DV_MAX = 0.12              # m/s     max frame-to-frame change of root speed
ACC_P95_MAX = 5.0              # m/s^2
ACC_MAX = 7.0                  # m/s^2
YAWRATE_P95_MAX = 2.5          # rad/s while moving
FOOT_SLIDE_P95_MAX = 0.5      # m/s, planted (lowest) foot speed over the floor while walking, 95th percentile
FOOT_PLANT_H = 0.025          # (round 5) planted: lower sole within this of the floor ...
FOOT_PLANT_VZ = 0.3           # ... and its vertical speed below this (m/s)
FOOT_PLANTED_M = 0.04         # a foot counts as planted when its sole is within this of the lower foot
FLOAT_MAX = 0.06              # m sole above the floor
SINK_MAX = 0.06               # m sole below the floor
FLOAT_RUN_S = 0.2
AIR_CLIP_W = 0.05             # hop/cheer clip weight above this: airborne by design (excluded from float)
# depth consistency (monocular depth, coarse: robust thresholds + persistence; calibrated on the baseline)
DEPTH_RUN_S = 0.3
TORSO_RHO_MIN = 0.6           # footage at her torso nearer than 0.6x her distance: drawn in front of a wall/person
FEET_RHO_MAX = 1.8            # footage floor at her feet farther than 1.8x her distance: standing on air / too large
FEET_RHO_MIN = 0.55           # footage at her feet much nearer: feet inside / behind an object
OCC_FRAC_MAX = 0.25           # fraction of her body the occlusion shader discards (she is cut by scenery)
BLOCKER_RUN_S = 0.0           # owner: zero frames inside a blocker or on / across a rail
RAIL_ON_M = 0.25              # within this of a rail line = standing on it
PEOPLE_DIST = 0.5             # m from a sensed person
PEOPLE_OVER_FRAC = 0.05       # (fixed method) fraction of her body vertices drawn over a nearer person
PEOPLE_RUN_S = 0.15           # (round 9, coordinator) a stretch counts from 0.15 s (the runtime rule's window; with the hard shader cut a shorter flicker is a clean cut)
SIZE_MAX_FRAC = 0.6           # (round 5) while opacity >= 0.5 her box height / screen never above this, not one frame
SIZE_RUN_S = 0.0
SIZE_OLD_FRAC, SIZE_OLD_RUN_S = 0.5, 0.3   # previous rule, reported
GONE_INSIDE_MIN = 0.6         # (round 5) "gone": less than this fraction of her body box inside the viewport, or no box
GONE_MAX_RUN_S, GONE_MAX_FRAC = 1.0, 0.03     # (round 7 final bar)
CLIP_MAX_RUN_S, CLIP_MAX_FRAC = 2.0, 0.08   # "clipped": any part more than OFFSCREEN_MARGIN_PX outside (round 7)
FEET_LUM_MIN = 0.04           # (round 8) depth not judged where the footage under her feet is pitch black
PROX_MIN_M = 1.5              # (round 7) camera-proximity: her ground distance to the camera while drawn, never below
PEOPLE_MAX_STRETCHES, PEOPLE_MAX_FRAC = 3, 0.3
UPPER_ARM_UP_MAX = -0.25      # upper arm (shoulder->elbow) up-component above this = arm held out (a relaxed arm is ~-0.95)
FOREARM_UP_MAX = 0.35         # forearm (elbow->hand) pointing up more than ~20 deg
POSTURE_RUN_S = 0.2
FREEZE_MS = 100               # a frame longer than this is a freeze
FREEZE_MAX_FRAC = 0.005       # FAIL if more than this fraction of frames are freezes ...
HARD_FREEZE_MS = 300          # ... or any single frame is longer than this
FOOTAGE_FREEZE_MS = 250       # picture stuck while the scroll moved on (reported)
# scenario pacing
SLOW_FPS = 45                 # gentle continuous scroll, footage frames per second (~1.5x walking pace)
TOUCH_K = 0.6                 # app: frames per px of finger travel for touch
SHOT_MIN_DT = 0.06            # keep at most one screencast frame per 60 ms
SCREENCAST_W, SCREENCAST_H = 590, 1278

try:  # reuse the project's device profile and Chrome flags when qa_run.py is next to this file
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    _argv, sys.argv = sys.argv, sys.argv[:1]
    import qa_run as _Q  # noqa: E402
    sys.argv = _argv
    ARGS, DEVICES = _Q.ARGS, _Q.DEVICES
except Exception:  # (qa/tools is gitignored: keep a copy so this file works on its own)
    sys.argv = _argv if '_argv' in dir() else sys.argv
    ARGS = ["--js-flags=--expose-gc", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"]
    DEVICES = {"mobile": dict(viewport={"width": 393, "height": 852}, device_scale_factor=3, is_mobile=True, has_touch=True,
                              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")}

# ------------------------------------------------------------------------------------------------ in-page recorder
RECORDER_JS = r"""
(() => {
if (window.__wa) return;
const WA = window.__wa = { buf: [], on: false, errs: 0, lastErr: '', skin: null, skinRoot: null, prev: null, kF: -2, k: NaN, kAll: [], sc: null };
WA.drain = () => { const b = WA.buf; WA.buf = []; return b; };
// clip-name classes (old model: walk/run/sprint/stairs/turn/hop; v3 model: walk/run/turn_l/turn_r/cheer)
const STRIDE = /^(walk|run|sprint|stairs|jog)/i, TURN = /^turn/i, AIR = /^(hop|cheer|jump)/i;
const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch (e) { return d; } };
const mul = (e, x, y, z) => [e[0]*x + e[4]*y + e[8]*z + e[12], e[1]*x + e[5]*y + e[9]*z + e[13], e[2]*x + e[6]*y + e[10]*z + e[14], e[3]*x + e[7]*y + e[11]*z + e[15]];
// free x for a touch at height y (not on a button, tag, card or menu)
WA.freeX = (y, xs) => { for (const x of xs) { const el = document.elementFromPoint(x, y); if (!el || !el.closest('button,a,input,.drawer,.card,.menu,.rail,.tag')) return x; } return xs[0]; };

function setupSkin(root) {
  const meshes = [];
  root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const out = [];
  for (const m of meshes) {
    const g = m.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    if (!P || !SI || !SW) continue;
    const bones = m.skeleton.bones, n = P.count;
    const foot = {};
    bones.forEach((b, k) => { const nm = b.name || ''; if (/foot|toe|ankle/i.test(nm)) foot[k] = /left|(^|[_.])l([_.]|$)/i.test(nm) ? 'L' : /right|(^|[_.])r([_.]|$)/i.test(nm) ? 'R' : ''; });
    const body = [], stride = Math.max(1, Math.floor(n / 420));
    for (let i = 0; i < n; i += stride) body.push(i);
    const fl = { L: [], R: [] };
    for (let i = 0; i < n; i++) {
      let bw = 0, bk = -1;
      for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c); if (w > bw) { bw = w; bk = SI.getComponent(i, c); } }
      const s = foot[bk]; if (s === 'L' || s === 'R') fl[s].push([i, P.getY(i)]);
    }
    const pick = (a) => { a.sort((p, q) => p[1] - q[1]); return a.slice(0, 60).map((p) => p[0]); };
    const mk = (idx) => idx.map((i) => {
      const v = mul(m.bindMatrix.elements, P.getX(i), P.getY(i), P.getZ(i));
      return { b: v, si: [0, 1, 2, 3].map((c) => SI.getComponent(i, c)), sw: [0, 1, 2, 3].map((c) => SW.getComponent(i, c)) };
    });
    out.push({ m, body: mk(body), L: mk(pick(fl.L)), R: mk(pick(fl.R)) });
  }
  return out.length ? out : null;
}

function skinWorld(entry, M4) {
  const m = entry.m, bones = m.skeleton.bones, inv = m.skeleton.boneInverses, cache = {};
  const bm = (k) => cache[k] || (cache[k] = new M4().multiplyMatrices(bones[k].matrixWorld, inv[k]).elements);
  const W = new M4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).elements;
  const run = (list) => list.map((v) => {
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 4; c++) { const w = v.sw[c]; if (!w) continue; const e = bm(v.si[c]); const r = mul(e, v.b[0], v.b[1], v.b[2]); x += w * r[0]; y += w * r[1]; z += w * r[2]; }
    const r = mul(W, x, y, z); return [r[0], r[1], r[2]];
  });
  return { body: run(entry.body), L: run(entry.L), R: run(entry.R) };
}

// sensed-frame camera (for reading the depth grid at a world point)
function senseCam(cam, f) {
  const x = cam.quat[f*4], y = cam.quat[f*4+1], z = cam.quat[f*4+2], w = cam.quat[f*4+3];
  // rotation matrix R (camera -> world), rows
  const R = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]];
  const I = cam.intrinsics, a = (cam.depth_a && cam.depth_a[f]) ?? 1, b = (cam.depth_b && cam.depth_b[f]) ?? 0.16;
  return { f, R, c: [cam.pos[f*3], cam.pos[f*3+1], cam.pos[f*3+2]], I, a, b };
}
function toImg(sc, p) {
  const dx = p[0] - sc.c[0], dy = p[1] - sc.c[1], dz = p[2] - sc.c[2], R = sc.R;
  const vx = R[0][0]*dx + R[1][0]*dy + R[2][0]*dz, vy = R[0][1]*dx + R[1][1]*dy + R[2][1]*dz, vz = R[0][2]*dx + R[1][2]*dy + R[2][2]*dz;
  const z = -vz; if (z < 0.15) return null;
  return [sc.I.cx + sc.I.fx * vx / z, sc.I.cy - sc.I.fy * vy / z, z];
}

function median(a) { if (!a.length) return NaN; const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; }

function sample(ts) {
  const A = window.__walk; if (!A || !A.brain || !A.view || !A.floor) return;
  const B = A.brain, V = A.view, S = A.sense, cam = A.floor.cam;
  const now = performance.now();
  const o = { t: now, ts, ep: performance.timeOrigin + now, cur: safe(() => A.cur, NaN), shown: safe(() => A.source.shown, -1),
    vf: safe(() => V.frame, NaN), fl: safe(() => A.floor.id, ''), st: safe(() => A.started ? 1 : 0, 0), open: safe(() => A.open ? 1 : 0, 0),
    tr: safe(() => A.inTransition ? 1 : 0, 0), gl: safe(() => A.glide ? 1 : 0, 0), menu: safe(() => A.menu.isOpen ? 1 : 0, 0),
    dolly: safe(() => V.dolly.z, 0), intro: safe(() => { const e = document.querySelector('.intro'); return e && !e.classList.contains('out') ? 1 : 0; }, 0),
    W: V.width, H: V.height, ox: V.offsetX, conf: safe(() => cam.conf[Math.max(0, Math.round(A.source.shown))], NaN),
    state: safe(() => B.state, ''), ges: safe(() => B.gesture, ''), op: safe(() => B.opacity, NaN), vis: safe(() => B.rig.root.visible ? 1 : 0, 0),
    spd: safe(() => B.spd, NaN), lane: safe(() => B.laneW, NaN), yaw: safe(() => B.yaw, NaN), bdt: safe(() => B.lastDt, NaN), vbi: safe(() => B.dbgVb[0], NaN), vbh: safe(() => B.dbgVb[1], NaN), why: safe(() => B.dbgWhy, 0), src: safe(() => B.dbgSrc, ''), ndis: safe(() => B.proxDissolves + B.edgeDissolves, NaN), nre: safe(() => B.reentries, NaN) };
  const p = safe(() => [B.pos.x, B.pos.y, B.pos.z], null);
  if (!p) { WA.buf.push(o); return; }
  o.x = p[0]; o.y = p[1]; o.z = p[2];
  const camP = V.camera.position; o.cd = Math.hypot(camP.x - p[0], camP.z - p[2]);
  const M4 = V.camera.matrixWorld.constructor;
  const PV = new M4().multiplyMatrices(V.camera.projectionMatrix, V.camera.matrixWorldInverse).elements;
  const proj = (q) => { const c = mul(PV, q[0], q[1], q[2]); if (c[3] < 0.1) return null; return [V.offsetX + (c[0] / c[3] * 0.5 + 0.5) * V.width, (-c[1] / c[3] * 0.5 + 0.5) * V.height]; };
  // own on-screen motion this frame: previous world position seen through the current camera
  const pp = proj(p);
  if (pp) { o.px = pp[0]; o.py = pp[1]; }
  if (WA.prev && WA.prev.fl === o.fl) { const q = proj(WA.prev.p); if (pp && q) o.own = Math.hypot(pp[0] - q[0], pp[1] - q[1]); }
  WA.prev = { p, fl: o.fl };
  // skinned body
  const root = safe(() => B.rig.root, null);
  if (root && WA.skinRoot !== root) { WA.skinRoot = root; WA.skin = safe(() => setupSkin(root), null); }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, nb = 0, nbad = 0, solL = Infinity, solR = Infinity;
  const bodyW = [];
  if (WA.skin) {
    for (const e of WA.skin) {
      const r = safe(() => skinWorld(e, M4), null); if (!r) continue;
      for (const q of r.body) { bodyW.push(q); const s = proj(q); if (!s) { nbad++; continue; } nb++; if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0]; if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1]; }
      for (const q of r.L) if (q[1] < solL) solL = q[1];
      for (const q of r.R) if (q[1] < solR) solR = q[1];
    }
  } else {
    // fallback (no skinned mesh): a 1.6 m column at her position
    for (const dy of [0, 1.6]) for (const dx of [-0.25, 0.25]) { const s = proj([p[0] + dx, p[1] + dy, p[2]]); if (!s) { nbad++; continue; } nb++; x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]); }
  }
  if (nb) { o.bx0 = x0; o.by0 = y0; o.bx1 = x1; o.by1 = y1; }
  o.behind = nbad;
  if (solL < Infinity) o.solL = solL; if (solR < Infinity) o.solR = solR;
  const bones = safe(() => B.rig.bones, null);
  if (bones) {
    const g = (n) => { const b = bones[n]; if (!b) return null; const e = b.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    const tl = g('LeftToeBase') || g('LeftFoot'), tr = g('RightToeBase') || g('RightFoot');
    if (tl) { o.tlx = tl[0]; o.tlz = tl[2]; } if (tr) { o.trx = tr[0]; o.trz = tr[2]; }
  }
  // clip weights
  const acts = safe(() => B.anim.mixer._actions, null);
  if (acts) {
    let loco = 0, air = 0, other = 0, turn = 0, top = '', topW = 0;
    for (const a of acts) {
      const n = a.getClip().name, w = a.getEffectiveWeight ? a.getEffectiveWeight() : 0;
      if (!(w > 0)) continue;
      if (STRIDE.test(n)) loco += w; else if (TURN.test(n)) turn += w; else if (n === 'idle') {} else if (AIR.test(n)) air += w; else other = Math.max(other, w);
      if (w > topW) { topW = w; top = n; }
    }
    o.wloco = loco; o.wturn = turn; o.wair = air; o.wges = other; o.clip = top;
  }
  // posture: upper arm (Arm -> ForeArm) and forearm (ForeArm -> Hand) world directions (y = up component)
  if (bones) {
    const wp = (n) => { const b = bones[n]; if (!b) return null; const e = b.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    const dirY = (a, b) => { if (!a || !b) return NaN; const l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); return l > 1e-6 ? (b[1] - a[1]) / l : NaN; };
    for (const s of ['Left', 'Right']) {
      const sh = wp(s + 'Arm'), el = wp(s + 'ForeArm'), ha = wp(s + 'Hand');
      o['ua' + s[0]] = dirY(sh, el); o['fa' + s[0]] = dirY(el, ha);
    }
  }
  o.pointW = safe(() => B.anim.pointW, NaN); o.rail = safe(() => B.railAt ? 1 : 0, 0); o.talk = safe(() => B.talking ? 1 : 0, 0);
  // footage depth around her (sensed frame: the depth grid and its camera)
  const sf = safe(() => S.frame, -1);
  if (sf >= 0 && S.depth && S.depth.length) {
    const GW = 36, GH = Math.round(S.depth.length / GW);
    if (!WA.sc || WA.sc.f !== sf || WA.sc.cam !== cam) { WA.sc = senseCam(cam, sf); WA.sc.cam = cam; }
    const sc = WA.sc;
    const cell = (u, v) => (u < 0 || u > 1 || v < 0 || v > 1) ? -1 : Math.min(GH - 1, Math.floor(v * GH)) * GW + Math.min(GW - 1, Math.floor(u * GW));
    const zOf = (k) => 1 / Math.max(0.05, sc.a * S.depth[k] + sc.b);
    // per sensed frame: scale correction from the walked floor ahead (the camera path is floor someone walked on)
    if (WA.kF !== sf) {
      WA.kF = sf;
      const rs = [], N = cam.frames || Math.floor(cam.pos.length / 3), hC = cam.camera_height_m || 1.4;
      for (let g = sf + 10; g < Math.min(N, sf + 330); g += 4) {
        const r = toImg(sc, [cam.pos[g*3], cam.pos[g*3+1] - hC, cam.pos[g*3+2]]);
        if (!r || r[2] < 1.0 || r[2] > 7 || r[0] < 0.02 || r[0] > 0.98 || r[1] < 0.3 || r[1] > 0.995) continue;
        const k = cell(r[0], r[1]); if (k < 0 || S.mask[k] > 0.3) continue;
        rs.push(zOf(k) / r[2]);
      }
      if (rs.length >= 4) { WA.k = median(rs); WA.kAll.push(WA.k); if (WA.kAll.length > 300) WA.kAll.shift(); WA.kN = rs.length; }
      else { WA.k = median(WA.kAll); WA.kN = 0; }
    }
    const k = WA.k; o.sf = sf; o.kf = k; o.kn = WA.kN;
    const cr = safe(() => { const e = V.camera.matrixWorld.elements; const l = Math.hypot(e[0], e[2]) || 1; return [e[0] / l, e[2] / l]; }, [1, 0]);
    // q[4]: the same ratio with the depth metric the app itself uses (the floor-recalibrated per-frame fit, sense.metric:
    // what the occlusion shader and the brain see); the solve fit x one scale k per sensed frame is off where the fit
    // is non-linear or k is estimated from few path points (looking down into the atrium: k ~ 3)
    const metR = (c) => safe(() => S.metric(S.depth[c]), NaN);
    const rho = (pt) => { const r = toImg(sc, pt); if (!r) return null; const c = cell(r[0], r[1]); if (c < 0) return null; return [zOf(c) / (k > 0 ? k : 1) / r[2], S.mask[c], zOf(c), r[2], metR(c) / r[2]]; };
    const fr = [], fm = [], frR = [];
    for (const d of [-0.12, 0, 0.12]) { const q = rho([p[0] + cr[0] * d, p[1] + 0.05, p[2] + cr[1] * d]); if (q) { fr.push(q[0]); fm.push(q[1]); frR.push(q[4]); } }
    o.feetRho = median(fr); o.feetMask = fm.length ? Math.max(...fm) : NaN;
    // (round 8) mean footage luminance of the sense cells around her feet (3 x 3 cells, ~0.08 x 0.05 of the frame)
    { const r = toImg(sc, [p[0], p[1] + 0.03, p[2]]); if (r) { let sl = 0, nl = 0; const i0 = Math.floor(r[0] * GW), j0 = Math.floor(r[1] * GH);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= GW || j >= GH) continue; const q = (j * GW + i) * 3; sl += 0.2126 * S.color[q] + 0.7152 * S.color[q + 1] + 0.0722 * S.color[q + 2]; nl++; }
      if (nl) o.feetLum9 = sl / nl;
      // the cell under her feet itself (a sense cell is ~20 x 20 footage px: the coordinator's "5 x 5 patch" at the
      // sense resolution)
      if (i0 >= 0 && j0 >= 0 && i0 < GW && j0 < GH) { const q = (j0 * GW + i0) * 3; o.feetLum = 0.2126 * S.color[q] + 0.7152 * S.color[q + 1] + 0.0722 * S.color[q + 2]; } } }
    // (fixed method) the same, ignoring samples that land on a person: a passer-by in front is occlusion, not a wall
    { const fw = [], fwR = []; for (let i = 0; i < fr.length; i++) if (!(fm[i] > 0.45)) { fw.push(fr[i]); if (frR[i] === frR[i]) fwR.push(frR[i]); } o.feetWall = median(fw); o.feetWallR = median(fwR); }
    const tr = [], tw = [], twR = []; let pmask = 0;
    for (const [h, d] of [[0.55, 0], [0.95, 0], [1.3, 0], [0.95, -0.12], [0.95, 0.12]]) {
      const q = rho([p[0] + cr[0] * d, p[1] + h, p[2] + cr[1] * d]); if (!q) continue; tr.push(q[0]);
      if (!(q[1] > 0.45)) { tw.push(q[0]); if (q[4] === q[4]) twR.push(q[4]); }
      if (Math.abs(q[0] - 1) < 0.35) pmask = Math.max(pmask, q[1]);
    }
    o.torsoMed = median(tr); o.torsoMin = tr.length ? Math.min(...tr) : NaN; o.torsoPerson = pmask; o.torsoWall = median(tw); o.torsoWallR = median(twR);
    // the guide's occlusion shader test on her body vertices (uncalibrated metric, exactly as the shader does it)
    let occ = 0, occOld = 0, nOcc = 0, occP = 0, over = 0, overOld = 0;
    // fixed method: the fit the shader actually uses this frame (app's view.occFit: floor-recalibrated, expressed for
    // the linearised byte); old method: the solve's raw fit (what the shader used before that fix)
    const of = safe(() => (V.occFit && V.occFit.x > 0) ? [V.occFit.x, V.occFit.y] : null, null);
    const oa = of ? of[0] : sc.a, ob = of ? of[1] : sc.b;
    for (let i = 0; i < bodyW.length; i += 2) {
      const r = toImg(sc, bodyW[i]); if (!r) continue; const c = cell(r[0], r[1]); if (c < 0) continue;
      // the footage texture is sRGB, so the shader samples the depth byte LINEARISED (unlike the raw sense grid)
      const dr = S.depth[c], dl = dr <= 0.04045 ? dr / 12.92 : Math.pow((dr + 0.055) / 1.055, 2.4);
      const mr = S.mask[c], ml = mr <= 0.04045 ? mr / 12.92 : Math.pow((mr + 0.055) / 1.055, 2.4);
      nOcc++; const sz = 1 / Math.max(0.02, oa * dl + ob), szOld = 1 / Math.max(0.02, sc.a * dl + sc.b), m = ml;
      const t = Math.min(1, Math.max(0, (m - 0.35) / 0.3)), need = 0.9 + (0.3 - 0.9) * (t * t * (3 - 2 * t)); // (meshy.ts: people hide her from 0.3 m nearer)
      const hidden = r[2] - sz > need; // (round 9: the shader cuts hard at gap > need, meshy.ts 38971c6)
      if (hidden) { occ++; if (mr > 0.45) occP++; }
      if (r[2] - szOld > need) occOld++;
      // drawn OVER a person who is nearer the camera than this part of her (screen-space "standing on / in front of
      // someone"): a person cell, calibrated footage depth nearer than her by > 0.15 m, and the shader shows her
      if (!hidden && mr > 0.45 && k > 0 && zOf(c) / k < r[2] - 0.15) overOld++;
      // (round 8, coordinator) drawn on top of a person she should be hidden behind: a person cell whose footage depth
      // (the shader's own metric) is nearer than this part of her, and the shader still draws her there
      if (!hidden && mr > 0.45 && sz < r[2] - 0.1) { const sp = proj(bodyW[i]); if (sp && sp[0] >= V.offsetX && sp[0] <= V.offsetX + V.width && sp[1] >= 0 && sp[1] <= V.height) over++; }
    }
    o.occ = nOcc ? occ / nOcc : NaN; o.occOld = nOcc ? occOld / nOcc : NaN;
    o.occPerson = nOcc ? occP / nOcc : NaN; o.occWall = nOcc ? (occ - occP) / nOcc : NaN; o.personOver = bodyW.length ? over / Math.ceil(bodyW.length / 2) : NaN; // (round 8: of her whole body, only on-screen pixels count: an edge sliver is a sliver) o.personOverOld = nOcc ? overOld / nOcc : NaN;
    // nearest sensed person
    let pd = Infinity; for (const q of (S.people || [])) pd = Math.min(pd, Math.hypot(q.x - p[0], q.z - p[2]));
    if (pd < Infinity) o.pdist = pd; o.npeople = (S.people || []).length;
  }
  WA.buf.push(o);
}
function loop(ts) { requestAnimationFrame(loop); if (!WA.on) return; try { sample(ts); } catch (e) { WA.errs++; WA.lastErr = String(e && e.stack || e).slice(0, 300); } }
requestAnimationFrame(loop);
})();
"""


# ------------------------------------------------------------------------------------------------ driver
class Driver:
    """Phone-like input through CDP touch events, paced by wall-clock time (throttling can't change the gesture)."""

    def __init__(self, pg, cdp, rng):
        self.pg, self.cdp, self.rng = pg, cdp, rng
        self.log = []

    async def touch(self, kind, x=0, y=0):
        pts = [] if kind == "touchEnd" else [{"x": float(x), "y": float(y), "radiusX": 8, "radiusY": 8, "force": 1, "id": 1}]
        await self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

    async def state(self):
        return await self.pg.evaluate("(() => { const a = window.__walk; return { cur: a.cur, N: (a.floor.end !== undefined ? a.floor.end + 1 : a.floor.meta.frames), fps: a.floor.meta.fps, fl: a.floor.id, open: !!a.open, tr: a.inTransition, shown: a.source.shown }; })()")

    async def free_x(self, y):
        return await self.pg.evaluate(f"window.__wa.freeX({y}, [130, 200, 90, 250, 60])")

    async def drag(self, dy_px, dur, rest=0.0, ease=False, y0=None):
        """Finger drag: dy_px < 0 = swipe up (walk forward). rest > 0 holds the finger still before lifting (no fling)."""
        if y0 is None:
            y0 = 740 if dy_px < 0 else 170
        x = await self.free_x(y0)
        await self.touch("touchStart", x, y0)
        t0 = time.perf_counter()
        while True:
            k = min(1.0, (time.perf_counter() - t0) / max(dur, 1e-3))
            e = k * k * (3 - 2 * k) if ease else k
            await self.touch("touchMove", x, y0 + dy_px * e)
            if k >= 1:
                break
            await asyncio.sleep(0.016)
        if rest:
            await asyncio.sleep(rest)
        await self.touch("touchEnd")

    async def move_frames(self, frames, speed_px_s=900, rest=0.15):
        """Move the walk by ~frames footage frames with controlled drags that end without a fling."""
        px = abs(frames) / TOUCH_K
        sgn = -1 if frames > 0 else 1
        while px > 2:
            ch = min(px, 560)
            await self.drag(sgn * ch, ch / speed_px_s, rest=rest)
            px -= ch
            await asyncio.sleep(0.12)

    async def settle(self, timeout=4.0):
        prev, t0 = None, time.perf_counter()
        while time.perf_counter() - t0 < timeout:
            s = await self.state()
            if prev is not None and abs(s["cur"] - prev) < 0.3:
                return s
            prev = s["cur"]
            await asyncio.sleep(0.15)
        return await self.state()

    async def go_to(self, target, style="swipes"):
        """Walk to footage frame target (forward or back) with the given gesture style, landing without a fling."""
        for _ in range(80):
            s = await self.state()
            gap = target - s["cur"]
            if abs(gap) < 12:
                return s
            if abs(gap) > (900 if style == "flicks" else 650) and style in ("swipes", "flicks"):  # (flings coast ~250 frames)
                await self.gesture(style, 1 if gap > 0 else -1)
            else:
                await self.move_frames(gap)
                await self.settle(2.5)
        return await self.state()

    async def gesture(self, style, direction=1):
        r = self.rng
        if style == "flicks":
            px, dur, pause = r.uniform(260, 420), r.uniform(0.06, 0.11), r.uniform(0.3, 0.75)
        else:  # normal swipes
            px, dur, pause = r.uniform(220, 380), r.uniform(0.22, 0.38), r.uniform(0.6, 1.6)
        await self.drag(-direction * px, dur, ease=True)
        await asyncio.sleep(pause)


async def tap(pg, selector, timeout=3000):
    loc = pg.locator(selector).first
    await loc.wait_for(state="visible", timeout=timeout)
    await loc.tap(timeout=timeout)


# ------------------------------------------------------------------------------------------------ scenarios
async def end_margin(d):
    s = await d.state()
    return s["N"] - 6 - s["cur"], s


async def walk_forward(d, style, stop_frac=1.0):
    """Walk forward with a gesture style to stop_frac of the floor (or its end, without triggering the floor switch)."""
    if style == "slow":
        return await slow_forward(d, stop_frac)
    while True:
        rem, s = await end_margin(d)
        target = min(s["N"] - 6, stop_frac * (s["N"] - 1))
        if s["cur"] >= target - 12:
            return s
        if target - s["cur"] > (900 if style == "flicks" else 650):
            await d.gesture(style, 1)
        else:
            await d.go_to(target, style)
            return await d.state()


async def slow_forward(d, stop_frac=1.0, direction=1):
    """Gentle continuous scroll: long slow drags back to back at ~SLOW_FPS (the finger repositions in 60 ms)."""
    speed = SLOW_FPS / TOUCH_K  # px/s
    while True:
        s = await d.state()
        target = min(s["N"] - 6, stop_frac * (s["N"] - 1)) if direction > 0 else stop_frac * (s["N"] - 1)
        gap = (target - s["cur"]) * direction
        if gap < 12:
            return s
        ch = min(520, gap / TOUCH_K)
        last = ch < 520
        await d.drag(-direction * ch, ch / speed, rest=0.15 if last else 0.0)
        await asyncio.sleep(0.06)
        if last:
            await d.settle(3)


async def sc_slow(d, floor):
    await slow_forward(d, 1.0)
    await asyncio.sleep(2.5)


async def sc_swipes(d, floor):
    await walk_forward(d, "swipes")
    await asyncio.sleep(2.5)


async def sc_flicks(d, floor):
    await walk_forward(d, "flicks")
    await asyncio.sleep(2.5)


async def sc_reverse(d, floor):
    for frac, dirn in ((0.42, 1), (0.22, -1), (0.70, 1), (0.52, -1), (1.0, 1)):
        if dirn > 0:
            await walk_forward(d, "swipes", frac)
        else:
            await d.go_to(frac * ((await d.state())["N"] - 1), "swipes")
        await asyncio.sleep(1.2)
    await asyncio.sleep(2.0)


async def sc_stations(d, floor, stations, events):
    pg = d.pg
    if floor == "downstairs":
        for s in stations:
            await d.go_to(s["click_frame"], "swipes")
            await d.settle(3)
            t_idle = time.time()
            await asyncio.sleep(3.2)  # she presents it
            method = None
            try:
                await tap(pg, f".tag[aria-label='Open {s['title']}']", 2500)
                method = "tag"
            except Exception:
                try:
                    await pg.keyboard.press("Enter")
                    method = "enter"
                except Exception:
                    pass
            try:
                await pg.wait_for_function("window.__walk.open !== null && !window.__walk.inTransition", timeout=12000)
            except Exception:
                events.append({"t": time.time(), "what": f"station {s['id']}: card did not open ({method})"})
                continue
            events.append({"t": t_idle, "what": f"station {s['id']}: idle 3.2 s, opened via {method}"})
            await asyncio.sleep(2.0)
            try:
                await tap(pg, ".card.on .btn.primary", 3000)
            except Exception:
                await pg.keyboard.press("Escape")
            try:
                await pg.wait_for_function("window.__walk.open === null && !window.__walk.inTransition", timeout=12000)
            except Exception:
                events.append({"t": time.time(), "what": f"station {s['id']}: card did not close"})
            await asyncio.sleep(1.0)
    else:
        # upstairs has no stations: stop mid-chapter at each chapter and idle (she should stand and present the space)
        chs = await pg.evaluate("window.__walk.floor.chapters.map(c => [c.id, (c.start + c.end) / 2])")
        fps = (await d.state())["fps"]
        for cid, mid in chs:
            st = await d.state()
            f = min(st["N"] - 8, mid * fps)
            if f <= st["cur"] + 12:
                continue
            await d.go_to(f, "swipes")
            await d.settle(3)
            events.append({"t": time.time(), "what": f"chapter {cid}: idle 3.2 s"})
            await asyncio.sleep(3.2)
    await walk_forward(d, "swipes")
    await asyncio.sleep(2.0)


SCENARIOS = ["slow", "swipes", "flicks", "stations", "reverse"]
# how each upstairs scenario gets upstairs (every way a visitor can): side menu, #floor-up URL, natural end of downstairs
UP_ENTRY = {"slow": "menu", "swipes": "hash", "flicks": "end", "stations": "hash", "reverse": "menu"}


# ------------------------------------------------------------------------------------------------ one scenario run
async def run_scenario(browser, base, floor, scen, seed, throttle, outdir, stations, keep_frames):
    rng = random.Random(f"{seed}:{floor}:{scen}")
    ctx = await browser.new_context(**DEVICES["mobile"])
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    # (Vite's dev server answers 504 "Outdated Optimize Dep" while it re-bundles deps on a cold start: not an app error)
    pg.on("console", lambda m: errors.append(f"console.error: {m.text}"[:300]) if m.type == "error" and "favicon" not in m.text and "Outdated Optimize Dep" not in m.text else None)
    await pg.add_init_script(RECORDER_JS)
    cdp = await ctx.new_cdp_session(pg)
    frames_dir = outdir / "frames" / f"{floor}_{scen}"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    shots = []  # (epoch s, path)
    last_kept = [0.0]
    pending = set()

    def on_frame(ev):
        ts = ev["metadata"].get("timestamp") or time.time()
        if ts - last_kept[0] >= SHOT_MIN_DT:
            last_kept[0] = ts
            pth = frames_dir / f"{len(shots):05d}.jpg"
            pth.write_bytes(base64.b64decode(ev["data"]))
            shots.append((ts, str(pth)))
        tk = asyncio.ensure_future(cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))
        pending.add(tk)
        tk.add_done_callback(lambda f: (pending.discard(f), f.exception() if not f.cancelled() else None))

    cdp.on("Page.screencastFrame", on_frame)
    events = []
    entry = "load"
    url = base.rstrip("/") + "/?autostart" + (("&" + os.environ["AUDIT_QUERY"]) if os.environ.get("AUDIT_QUERY") else "")
    if floor == "upstairs":
        entry = UP_ENTRY.get(scen, "hash")
        if entry == "hash":
            url += "#floor-up"
        elif entry == "end":
            url += "#chapter-into-the-dark"
    t_wall0 = time.time()
    await pg.goto(url)
    await pg.wait_for_function("window.__walk && window.__walk.source && window.__walk.source.shown >= 0", timeout=60000)
    await cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 62, "maxWidth": SCREENCAST_W, "maxHeight": SCREENCAST_H, "everyNthFrame": 1})
    if throttle and throttle > 1:
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
    await pg.evaluate("window.__wa.on = true")
    samples = []
    stop = asyncio.Event()

    async def puller():
        while not stop.is_set():
            try:
                samples.extend(await pg.evaluate("window.__wa.drain()"))
            except Exception:
                pass
            await asyncio.sleep(0.4)

    pull_task = asyncio.ensure_future(puller())
    d = Driver(pg, cdp, rng)
    t_begin = None
    try:
        await asyncio.sleep(4.6)  # the hello (intro wave + first line), or the deep link landing
        if floor == "upstairs":
            if entry == "menu":
                await tap(pg, ".menu-btn")
                await asyncio.sleep(0.6)
                await tap(pg, ".menu-floor button:has-text('Upstairs')")
            elif entry == "end":
                # finish downstairs from the dark passage with phone swipes, then keep swiping at the end
                await pg.wait_for_function("window.__walk.floor.id === 'downstairs' && !window.__walk.glide", timeout=20000)
                await walk_forward(d, "swipes")
                for _ in range(12):
                    if (await d.state())["fl"] == "upstairs":
                        break
                    await d.drag(-300, 0.3)
                    await asyncio.sleep(0.5)
            await pg.wait_for_function("window.__walk.floor.id === 'upstairs' && !window.__walk.inTransition && window.__walk.source.shown >= 0", timeout=30000)
            events.append({"t": time.time(), "what": f"arrived upstairs via {entry}"})
            await asyncio.sleep(2.5)
        t_begin = time.time()
        events.append({"t": t_begin, "what": f"scenario {scen} starts"})
        if scen == "slow":
            await sc_slow(d, floor)
        elif scen == "swipes":
            await sc_swipes(d, floor)
        elif scen == "flicks":
            await sc_flicks(d, floor)
        elif scen == "stations":
            await sc_stations(d, floor, stations, events)
        elif scen == "reverse":
            await sc_reverse(d, floor)
        final = await d.state()
        events.append({"t": time.time(), "what": f"scenario end at frame {final['cur']:.0f}/{final['N']} on {final['fl']}"})
    except Exception as e:
        events.append({"t": time.time(), "what": f"driver error: {type(e).__name__}: {str(e)[:200]}"})
    await asyncio.sleep(0.5)
    stop.set()
    await pull_task
    try:
        samples.extend(await pg.evaluate("window.__wa.drain()"))
        rec_err = await pg.evaluate("[window.__wa.errs, window.__wa.lastErr]")
        nav = await pg.evaluate("(() => { const n = window.__walk.brain.nav; return n ? { samples: n.samples, blockers: n.blockers || [], rails: n.rails || [] } : null; })()")
    except Exception:
        rec_err, nav = [-1, "page gone"], None
    try:
        await cdp.send("Page.stopScreencast")
    except Exception:
        pass
    await asyncio.sleep(0.2)
    await ctx.close()
    return {"floor": floor, "scenario": scen, "entry": entry, "samples": samples, "shots": shots, "errors": errors,
            "events": events, "t_begin_epoch": t_begin, "wall_s": time.time() - t_wall0, "recorder_errors": rec_err,
            "nav": nav, "frames_dir": str(frames_dir), "keep_frames": keep_frames}


# ------------------------------------------------------------------------------------------------ analysis helpers
def runs(mask):
    """Contiguous True runs as (i0, i1) inclusive."""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def col(S, k, default=np.nan):
    return np.array([s.get(k, default) if s.get(k, default) is not None else default for s in S], dtype=float)


def load_world(base, floor, nav_page):
    def get(url):
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    cam = get(base.rstrip("/") + f"/data/camera_{floor}.json")
    if nav_page:
        nav = nav_page
    else:
        nav = get(base.rstrip("/") + f"/data/nav_{floor}.json")
        N = nav["samples"]
        sm = [x["floor_y"] for x in N]
        for i, x in enumerate(N):  # same seam smoothing as brain.ts setFloor
            if x.get("stairs"):
                continue
            vals = [N[i + k]["floor_y"] for k in range(-4, 5) if 0 <= i + k < len(N) and not N[i + k].get("stairs")]
            sm[i] = sum(vals) / len(vals)
        for i, x in enumerate(N):
            x["floor_y"] = sm[i]
    pos = np.array(cam["pos"], dtype=float).reshape(-1, 3)
    n = len(pos)
    smx, smz = np.zeros(n), np.zeros(n)
    idx = np.arange(n)
    for k in range(-12, 13):
        j = np.clip(idx + k, 0, n - 1)
        smx += pos[j, 0]
        smz += pos[j, 2]
    smx /= 25
    smz /= 25
    # path distance S exactly as brain.ts (smoothed path, capped 0.08 m per frame)
    S = np.concatenate([[0], np.cumsum(np.minimum(0.08, np.hypot(np.diff(smx), np.diff(smz))))])
    ns = nav["samples"]
    nf = np.array([x["f"] for x in ns])
    nsd = np.array([x["s"] for x in ns])
    nfy = np.array([x["floor_y"] for x in ns])
    nx, nz = smx[np.clip(nf, 0, n - 1)], smz[np.clip(nf, 0, n - 1)]
    # (round 9) hand-measured blockers carried by the blocking track (the NOUSCON velvet rope)
    try:
        extra = get(base.rstrip("/") + f"/data/blocking_{floor}.json").get("blockers") or []
    except Exception:
        extra = []
    return {"cam": cam, "nav": nav, "nf": nf, "S": S, "ns": nsd, "nfy": nfy, "nx": nx, "nz": nz, "stairs": np.array([bool(x.get("stairs")) for x in ns]), "extra_blockers": extra}


def floor_band(world, x, z, frame):
    """Floor height band under her: nearest walked-path nav sample, searched like brain.nearestS (path distance
    S(frame)-3 m .. S(frame)+12 m, so a later pass of the path over the same spot can't be picked), +-0.35 m of path."""
    nf, nx, nz, S = world["nf"], world["nx"], world["nz"], world["S"]
    sV = S[int(np.clip(frame, 0, len(S) - 1))]
    sn = S[np.clip(nf, 0, len(S) - 1)]
    sel = np.where((sn >= sV - 3) & (sn <= sV + 12))[0]
    if not len(sel):
        sel = np.arange(len(nf))
    d2 = (nx[sel] - x) ** 2 + (nz[sel] - z) ** 2
    i = sel[int(np.argmin(d2))]
    s0 = world["ns"][i]
    band = np.where(np.abs(world["ns"] - s0) <= 0.35)[0]
    fy = world["nfy"][band]
    return float(world["nfy"][i]), float(fy.min()), float(fy.max()), i, float(math.sqrt(d2.min()))


def rail_blocker(world, x, z, path_i, frame=None):
    nav = world["nav"]
    inside = False
    for b in (nav.get("blockers", []) or []) + (world.get("extra_blockers") or []):
        if (x - b["x"]) ** 2 + (z - b["z"]) ** 2 < b["r"] ** 2:
            inside = True
    rail = False
    qx, qz = world["nx"][path_i], world["nz"][path_i]
    for r in nav.get("rails", []) or []:
        act = r.get("active")  # a rail placed from one view only (the solve drifts): valid for those frames only
        if act and frame is not None and not (act[0] <= frame <= act[1]):
            continue
        ax, az = r["a"][0], r["a"][2]
        ux, uz = r["b"][0] - ax, r["b"][2] - az
        L2 = ux * ux + uz * uz or 1
        t = ((x - ax) * ux + (z - az) * uz) / L2
        if t < -0.05 or t > 1.05:
            continue
        sp = ux * (z - az) - uz * (x - ax)
        sq = ux * (qz - az) - uz * (qx - ax)
        dist = abs(sp) / math.sqrt(L2)
        if dist < RAIL_ON_M or (np.sign(sp) != np.sign(sq) and abs(sq) > 1e-6):
            rail = True
    return inside, rail


def central_vel(t, a, half=0.05):
    """Velocity by central difference over +-half seconds (robust to per-frame jitter)."""
    j = np.searchsorted(t, t + half)
    k = np.searchsorted(t, t - half, side="right") - 1
    j = np.clip(j, 0, len(t) - 1)
    k = np.clip(k, 0, len(t) - 1)
    dt = t[j] - t[k]
    dt[dt <= 0] = np.nan
    return (a[j] - a[k]) / dt


# ------------------------------------------------------------------------------------------------ analysis
def _qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def analyze(res, base, method="fixed"):
    """method "fixed" (default, decides pass/fail) vs "old" (the original measurement, reported alongside). The fixed
    method (a) divides each sample's change by the dt of the brain update that produced it (brain.lastDt), not by
    the rAF timestamp interval around the sample; (b) ignores position
    / facing changes made while she is faded out (opacity < 0.1: nobody can see them); (c) emulates the occlusion
    shader with the fit the app reports it uses (view.occFit); (d) where the solved camera itself jumps (> 0.2 m per
    footage frame: the upstairs solve bridge 3501-3518) judges her motion relative to the camera: her previous position
    and facing are carried by the camera's own rigid motion across the bridge before her displacement is measured."""
    fixed = method == "fixed"
    floor = res["floor"]
    S = [s for s in res["samples"] if s.get("fl") == floor]
    S.sort(key=lambda s: s["t"])
    out = {"floor": floor, "scenario": res["scenario"], "entry": res["entry"], "n_samples": len(S), "events": [],
           "metrics": {}, "errors": res["errors"][:20], "n_errors": len(res["errors"]), "recorder_errors": res["recorder_errors"],
           "wall_s": round(res["wall_s"], 1)}
    if len(S) < 30:
        out["metrics"]["telemetry"] = {"pass": False, "value": f"only {len(S)} samples on {floor}", "worst": []}
        return out, None
    world = load_world(base, floor, res.get("nav"))
    fps = world["cam"].get("fps", 29.97)
    ep = col(S, "ep") / 1000.0
    t0 = res["t_begin_epoch"] or ep[0]
    # keep the arrival (intro / floor landing) too: from the first sample on this floor
    t = ep - t0
    n = len(S)
    shown = col(S, "shown")
    cur = col(S, "cur")
    W = col(S, "W")
    H = col(S, "H")
    ox = col(S, "ox")
    st = col(S, "st")
    blocked = (col(S, "open", 0) > 0) | (col(S, "tr", 0) > 0) | (col(S, "gl", 0) > 0) | (col(S, "menu", 0) > 0) | (np.nan_to_num(col(S, "dolly", 0)) > 0.01) | (col(S, "intro", 0) > 0)
    # grace after any blocked stretch
    sv = (st > 0) & (shown >= 0) & ~blocked
    last_block = -1e9
    for i in range(n):
        if blocked[i] or not (st[i] > 0 and shown[i] >= 0):
            last_block = t[i]
        elif t[i] - last_block < GRACE_S:
            sv[i] = False
    card = (col(S, "open", 0) > 0) | (col(S, "tr", 0) > 0)
    dt_frame = np.diff(col(S, "ts")) / 1000.0
    dt_frame = np.concatenate([[np.nan], dt_frame])
    x, y, z = col(S, "x"), col(S, "y"), col(S, "z")
    yaw = col(S, "yaw")
    xw, yw, zw = x.copy(), y.copy(), z.copy()  # world positions (floor, blockers, rails)
    seam_pair = np.zeros(n, bool)
    if fixed:
        # derivatives on the rAF presentation clock (ts), not performance.now() at callback time (jittery: it moved
        # with whatever ran before the recorder in that frame)
        tsr = col(S, "ts") / 1000.0
        if not np.any(np.isnan(tsr)):
            t = tsr - tsr[0] + t[0]
        # (a) the interval each sample's change was produced in: consecutive samples differ by exactly one brain
        # update, whose dt the app reports (brain.lastDt); the rAF timestamp interval only approximates it
        bdt = col(S, "bdt")
        dt_frame = np.where(np.isnan(bdt) | (bdt <= 0), dt_frame, bdt)
        # (d) motion relative to the camera across solve bridges: where the interval between two samples touches a
        # bridge step, her previous position is carried by the camera's actual motion between the two rendered
        # (interpolated) poses before her displacement is measured; facing likewise (dyaw_fix). Positions unroll into
        # xc/yc/zc (a constant offset after each bridge, so velocities elsewhere are unchanged).
        CP = np.array(world["cam"]["pos"], float).reshape(-1, 3)
        CQ = np.array(world["cam"]["quat"], float).reshape(-1, 4)
        nf_ = len(CP)
        bridge = np.concatenate([np.linalg.norm(np.diff(CP, axis=0), axis=1) > 0.2, [False]])
        vfr = col(S, "vf")

        def pose(fr):
            i0 = int(np.clip(np.floor(fr), 0, nf_ - 1)); i1 = min(nf_ - 1, i0 + 1); t_ = float(np.clip(fr - i0, 0, 1))
            q0, q1 = CQ[i0], CQ[i1] if np.dot(CQ[i0], CQ[i1]) >= 0 else -CQ[i1]
            q = q0 * (1 - t_) + q1 * t_; q = q / np.linalg.norm(q)
            return CP[i0] * (1 - t_) + CP[i1] * t_, _qmat(q)

        xc, yc, zc = x.copy(), y.copy(), z.copy()
        dyaw_fix = np.full(n, np.nan)
        for i in range(1, n):
            if np.isnan(x[i]) or np.isnan(x[i - 1]) or np.isnan(vfr[i]) or np.isnan(vfr[i - 1]) or np.isnan(xc[i - 1]):
                continue
            lo_, hi_ = int(np.floor(min(vfr[i], vfr[i - 1]))) - 1, int(np.ceil(max(vfr[i], vfr[i - 1]))) + 1
            px_, py_, pz_ = x[i - 1], y[i - 1], z[i - 1]
            if hi_ - lo_ <= 122 and bridge[max(0, lo_):max(0, hi_)].any():
                (Pa, Ra), (Pb, Rb) = pose(vfr[i - 1]), pose(vfr[i])
                px_, py_, pz_ = Rb @ (Ra.T @ (np.array([px_, py_, pz_]) - Pa)) + Pb
                fa_v, fb_v = Ra @ np.array([0, 0, -1.0]), Rb @ np.array([0, 0, -1.0])
                pyaw = yaw[i - 1] + (np.arctan2(fb_v[0], fb_v[2]) - np.arctan2(fa_v[0], fa_v[2]))
                dyaw_fix[i] = abs((yaw[i] - pyaw + np.pi) % (2 * np.pi) - np.pi)
                seam_pair[i] = True
            xc[i], yc[i], zc[i] = xc[i - 1] + x[i] - px_, yc[i - 1] + y[i] - py_, zc[i - 1] + z[i] - pz_
        x, y, z = xc, yc, zc
    bx0, by0, bx1, by1 = col(S, "bx0"), col(S, "by0"), col(S, "bx1"), col(S, "by1")
    vis = col(S, "vis", 0)
    op = col(S, "op")
    flags = {}
    worst = {}

    def frame_at(i):
        return int(shown[i]) if shown[i] >= 0 else int(cur[i])

    def spans(mask, min_s, value=None, what="", top=6, higher_worse=True):
        """Runs of mask lasting >= min_s; returns list of span dicts sorted worst first, and the boolean mask of those."""
        sel = np.zeros(n, bool)
        out_sp = []
        for i0, i1 in runs(mask):
            dur = t[i1] - t[i0] + (np.nanmedian(dt_frame) if n > 1 else 0.016)
            if dur + 1e-9 < min_s:
                continue
            sel[i0:i1 + 1] = True
            if value is not None:
                seg = value[i0:i1 + 1]
                if np.all(np.isnan(seg)):
                    iw = i0
                else:
                    iw = i0 + int(np.nanargmax(seg) if higher_worse else np.nanargmin(seg))
                v = value[iw]
            else:
                iw, v = i0, None
            out_sp.append({"t": round(float(t[i0]), 2), "dur": round(float(dur), 2), "t_worst": round(float(t[iw]), 2), "frame": frame_at(iw),
                           "value": None if v is None or np.isnan(v) else round(float(v), 3), "what": what, "i": int(iw)})
        out_sp.sort(key=lambda s: (-s["dur"] if value is None else (-(s["value"] or 0) if higher_worse else (s["value"] or 0)), -s["dur"]))
        return out_sp[:top], sel, out_sp

    M = out["metrics"]
    nsv = int(sv.sum())
    out["visible_frames"] = nsv
    out["duration_s"] = round(float(t[-1] - t[0]), 1)
    # ---- offscreen
    m = OFFSCREEN_MARGIN_PX
    off_amt = np.fmax.reduce([ox + 0 - bx0 - m, bx1 - (ox + W) - m, 0 - by0 - m, by1 - H - m, np.zeros(n)])
    nobox = np.isnan(bx0)
    offm = sv & ((off_amt > 0) | nobox) & (vis > 0)
    off_amt = np.where(nobox, 999, off_amt)
    top, sel, allsp = spans(offm, 0.0, off_amt, "body box outside viewport (px)")
    longest = max([s["dur"] for s in allsp], default=0.0)
    frac = offm.sum() / max(1, nsv)
    old_off = f"old single rule: longest {longest:.2f}s, {100 * frac:.2f}%"
    # (round 5) two tiers, judged while she is drawn (opacity >= 0.5; a dissolve counts as hidden)
    drawn = sv & (vis > 0) & (np.nan_to_num(op, nan=1) >= 0.5)
    ix = np.clip(np.minimum(bx1, ox + W) - np.maximum(bx0, ox), 0, None)
    iy = np.clip(np.minimum(by1, H) - np.maximum(by0, 0), 0, None)
    area = np.maximum(1e-6, (bx1 - bx0) * (by1 - by0))
    inside = np.where(nobox, 0.0, ix * iy / area)
    gone = drawn & (nobox | (inside < GONE_INSIDE_MIN))
    clip = drawn & ((off_amt > 0) | nobox)
    _, _, gsp = spans(gone, 0.0, 1 - inside, "gone: body box mostly outside the viewport (1 - inside fraction)")
    _, _, csp = spans(clip, 0.0, off_amt, "clipped: body box past the viewport edge (px)")
    g_long = max([q["dur"] for q in gsp], default=0.0); g_frac = gone.sum() / max(1, nsv)
    c_long = max([q["dur"] for q in csp], default=0.0); c_frac = clip.sum() / max(1, nsv)
    M["offscreen"] = {"pass": g_long <= GONE_MAX_RUN_S and g_frac <= GONE_MAX_FRAC and c_long <= CLIP_MAX_RUN_S and c_frac <= CLIP_MAX_FRAC,
                      "value": f"gone longest {g_long:.2f}s, {100 * g_frac:.2f}% (<= {GONE_MAX_RUN_S}s, {100 * GONE_MAX_FRAC:.0f}%); clipped longest {c_long:.2f}s, {100 * c_frac:.2f}% (<= {CLIP_MAX_RUN_S}s, {100 * CLIP_MAX_FRAC:.0f}%); [{old_off}]",
                      "gone_longest_s": g_long, "gone_frac": g_frac, "clip_longest_s": c_long, "clip_frac": c_frac, "old_longest_s": longest, "old_frac": frac,
                      "worst": sorted(gsp, key=lambda q: -q["dur"])[:4] + sorted(csp, key=lambda q: -q["dur"])[:3]}
    flags["offscreen"] = gone | clip
    # ---- hidden
    hid = sv & ((vis < 1) | (np.nan_to_num(op) < 0.5))
    top, sel, allsp = spans(hid, 0.0, None, "root invisible / faded while she should be visible")
    longest = max([s["dur"] for s in allsp], default=0.0)
    frac = hid.sum() / max(1, nsv)
    M["hidden"] = {"pass": longest <= HIDDEN_MAX_RUN_S and frac <= HIDDEN_MAX_FRAC, "value": f"longest {longest:.2f}s, {100 * frac:.2f}% of visible frames",
                   "longest_s": longest, "frac": frac, "worst": sorted(allsp, key=lambda s: -s["dur"])[:6]}
    flags["hidden"] = hid
    # ---- teleport / jump (per frame; only while she is on screen in both frames)
    dtf = np.maximum(np.nan_to_num(dt_frame, nan=1 / 60), 1 / 60)
    hsp = np.concatenate([[0], np.hypot(np.diff(x), np.diff(z))]) / dtf
    vsp = np.concatenate([[0], np.abs(np.diff(y))]) / dtf
    own = col(S, "own")
    if fixed:  # across a solve bridge her own screen motion is just her screen displacement (camera-relative)
        pxs, pys = col(S, "px"), col(S, "py")
        own_cam = np.concatenate([[np.nan], np.hypot(np.diff(pxs), np.diff(pys))])
        own = np.where(seam_pair, own_cam, own)
    own_n = own * np.minimum(1.0, 0.0333 / dtf)
    onscr = sv & ~offm & ~nobox
    if fixed:  # (b) a change made while she is faded out (opacity < 0.1) can't be seen
        onscr = onscr & (np.nan_to_num(op, nan=1) >= 0.1)
    both = onscr & np.concatenate([[False], onscr[:-1]])
    tel = both & ((hsp > TELEPORT_SPEED) | (vsp > TELEPORT_VSPEED) | (own_n > TELEPORT_SCREEN_PX))
    sev = np.fmax.reduce([hsp / TELEPORT_SPEED, vsp / TELEPORT_VSPEED, np.nan_to_num(own_n) / TELEPORT_SCREEN_PX])
    top, sel, allsp = spans(tel, 0.0, sev, "jump (x threshold)")
    for s_ in allsp:
        i = s_["i"]
        s_["what"] = f"jump: {hsp[i]:.1f} m/s horiz, {vsp[i]:.1f} m/s vert, {np.nan_to_num(own_n[i]):.0f}px own screen move"
    M["teleport"] = {"pass": len(allsp) == 0, "value": f"{len(allsp)} jumps; max {np.nanmax(np.where(both, hsp, 0)):.1f} m/s, vert {np.nanmax(np.where(both, vsp, 0)):.2f} m/s, screen {np.nanmax(np.where(both, np.nan_to_num(own_n), 0)):.0f}px",
                     "count": len(allsp), "worst": top}
    flags["teleport"] = tel
    # ---- glide
    vx, vz = central_vel(t, x), central_vel(t, z)
    fx, fz = np.sin(yaw), np.cos(yaw)
    along = vx * fx + vz * fz
    lat = np.abs(vx * fz - vz * fx)
    spd = np.hypot(vx, vz)
    wloco = col(S, "wloco")
    have_w = not np.all(np.isnan(wloco))
    g_lat = sv & ~nobox & (lat > GLIDE_LAT)
    g_back = sv & ~nobox & (along < -GLIDE_BACK)
    # (round 6c, approved: on a scroll reversal she may step back, facing the way she faced, <= 0.8 m/s for <= 1.5 s;
    # the animator plays the walk in reverse there. A backward stretch within those limits is not a glide.)
    if fixed:
        for i0, i1 in runs(g_back):
            dur_ = t[i1] - t[i0]
            if dur_ <= BACKSTEP_MAX_S and np.nanmax(-along[i0:i1 + 1]) <= BACKSTEP_MAX_MS:
                g_back[i0:i1 + 1] = False
    g_nol = sv & ~nobox & (spd > NOLOCO_SPEED) & (np.nan_to_num(wloco, nan=1) < NOLOCO_WEIGHT) if have_w else np.zeros(n, bool)
    t1, s1, a1 = spans(g_lat, GLIDE_RUN_S, lat, "sideways slide (m/s lateral)")
    t2, s2, a2 = spans(g_back, GLIDE_RUN_S, -along, "moving backwards (m/s)")
    t3, s3, a3 = spans(g_nol, GLIDE_RUN_S, spd, "moving without walk clip (m/s)")
    allg = a1 + a2 + a3
    M["glide"] = {"pass": not allg, "value": f"{len(a1)} sideways, {len(a2)} backwards, {len(a3)} no-walk-clip stretches; lateral p95 {np.nanpercentile(lat[sv], 95) if nsv else 0:.2f} m/s, max {np.nanmax(np.where(sv, lat, 0)):.2f}",
                  "lat_p95": float(np.nanpercentile(lat[sv], 95)) if nsv else 0, "worst": sorted(allg, key=lambda s: -s["dur"])[:8],
                  "clip_weights_read": have_w}
    flags["glide"] = s1 | s2 | s3
    # ---- snap turns: her facing swings faster than a person can turn (normalised per 1/60 s frame)
    dyaw = np.concatenate([[0], np.abs((np.diff(yaw) + np.pi) % (2 * np.pi) - np.pi)])
    if fixed:
        dyaw = np.where(np.isnan(dyaw_fix), dyaw, dyaw_fix)
    yrate = dyaw / dtf
    snap = both & (yrate > SNAP_TURN_RATE)
    t1, s1, a1 = spans(snap, 0.0, yrate, "snap turn (rad/s)")
    M["snap_turn"] = {"pass": not a1, "value": f"{len(a1)} snap turns; yaw rate p99 {np.nanpercentile(yrate[both], 99) if both.any() else 0:.1f} rad/s, max {np.nanmax(np.where(both, yrate, 0)):.1f} rad/s",
                      "worst": a1[:6]}
    flags["snap_turn"] = s1
    # ---- floor under her (nav map), blockers and rails
    sole = np.fmin(col(S, "solL"), col(S, "solR"))
    fy, flo, fhi, pdist = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
    inb, onr, on_stairs = np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool)
    for i in range(n):
        if np.isnan(xw[i]):
            continue
        a_, lo_, hi_, pi_, dd_ = floor_band(world, xw[i], zw[i], frame_at(i))
        fy[i], flo[i], fhi[i], pdist[i] = a_, lo_, hi_, dd_
        on_stairs[i] = bool(world["stairs"][pi_])
        inb[i], onr[i] = rail_blocker(world, xw[i], zw[i], pi_, frame_at(i))
    err = np.where(sole > fhi, sole - fhi, np.where(sole < flo, sole - flo, 0.0))
    foot_contact = sole - flo  # lower sole above the floor band's bottom: < 5 cm = the foot is on the ground
    # ---- foot slide (planted foot = lower sole, on the ground; ball-of-foot bone speed over the floor while walking)
    solL, solR = col(S, "solL"), col(S, "solR")
    tlx, tlz, trx, trz = col(S, "tlx"), col(S, "tlz"), col(S, "trx"), col(S, "trz")
    vl = np.hypot(central_vel(t, tlx), central_vel(t, tlz))
    vr = np.hypot(central_vel(t, trx), central_vel(t, trz))
    planted_v = np.where(solL <= solR, vl, vr)
    both_down = np.abs(solL - solR) < FOOT_PLANTED_M
    planted_v = np.where(both_down, np.fmin(vl, vr), planted_v)
    # walking = moving with the walk/run cycle actually playing (turn-in-place and blends are judged by snap_turn/glide)
    walking = sv & (spd > 0.3) & ~nobox & (np.nan_to_num(wloco, nan=1) > 0.7)
    pv_old = planted_v[walking & ~np.isnan(planted_v) & ~np.isnan(foot_contact) & (foot_contact < 0.05)]
    p95_old = float(np.percentile(pv_old, 95)) if len(pv_old) else float("nan")
    # (round 5) planted = the lower sole within 2.5 cm of the floor AND moving vertically < 0.3 m/s: the swing foot
    # descending into heel strike (toe 2-7 m/s with the ankle 3-5 cm up) is not a planted foot
    sole_low = np.where(solL <= solR, solL, solR)
    sole_vz = np.abs(central_vel(t, sole_low))
    planted = walking & ~np.isnan(planted_v) & ~np.isnan(foot_contact) & (foot_contact < FOOT_PLANT_H) & (np.nan_to_num(sole_vz, nan=9) < FOOT_PLANT_VZ)
    pv = planted_v[planted]
    p50 = float(np.percentile(pv, 50)) if len(pv) else float("nan")
    p95 = float(np.percentile(pv, 95)) if len(pv) else float("nan")
    # smoothness (coordinator criteria): on walking frames outside deliberate turns (|yaw change over 0.5 s| < 0.8 rad)
    yr_s = np.abs(central_vel(t, np.unwrap(np.nan_to_num(col(S, "yaw")))))
    yaw_u = np.unwrap(np.nan_to_num(col(S, "yaw")))
    turn = np.zeros(n, bool)
    for i_ in range(n):
        j0 = np.searchsorted(t, t[i_] - 0.25); j1 = min(n - 1, np.searchsorted(t, t[i_] + 0.25))
        turn[i_] = abs(yaw_u[j1] - yaw_u[j0]) > 0.8
    axv, azv = central_vel(t, vx), central_vel(t, vz)
    acc = np.hypot(axv, azv)
    wk = walking & ~turn
    yr95 = float(np.nanpercentile(yr_s[wk], 95)) if wk.any() else float("nan")
    ac95 = float(np.nanpercentile(acc[wk], 95)) if wk.any() else float("nan")
    old_smooth = f"old criterion: yaw-rate p95 {yr95:.2f} (< {SMOOTH_YAW_P95}), accel p95 {ac95:.2f} (< {SMOOTH_ACC_P95}) on walking frames outside turns"
    # new criterion (coordinator): jitter = residual of root speed and yaw rate about their own 0.25 s centred moving
    # average, judged on frames where she is on screen in this and the previous frame (no seam pairs, no fades);
    # plus accel p95 / max and yaw rate p95 while moving. Accel from velocity over +-0.05 s, differentiated again.
    ok = both & ~seam_pair & ~np.isnan(hsp)
    if fixed:
        ok &= ~np.isnan(dyaw_fix) | ~seam_pair
    dyaw_s = np.concatenate([[0], ((np.diff(np.unwrap(np.nan_to_num(yaw))) + np.pi) % (2 * np.pi) - np.pi)]) / dtf
    def cma(a, m_):
        r_ = np.full(n, np.nan)
        for i_ in np.nonzero(m_)[0]:
            j0 = np.searchsorted(t, t[i_] - JIT_WIN_S / 2); j1 = np.searchsorted(t, t[i_] + JIT_WIN_S / 2, side="right")
            seg = a[j0:j1][m_[j0:j1]]
            r_[i_] = a[i_] - seg.mean()
        return r_
    rs, ry = cma(hsp, ok), cma(dyaw_s, ok)
    rms_s = float(np.sqrt(np.nanmean(rs[ok] ** 2))) if ok.any() else float("nan")
    rms_y = float(np.sqrt(np.nanmean(ry[ok] ** 2))) if ok.any() else float("nan")
    okp = ok & np.concatenate([[False], ok[:-1]])
    dv = np.concatenate([[0], np.abs(np.diff(hsp))])
    dv_max = float(np.nanmax(np.where(okp, dv, 0))) if okp.any() else 0.0
    # derivatives on the brain's own clock (each sample's change was produced over brain.lastDt; the presentation
    # clock is offset by a frame around dropped frames, which fakes accel spikes of hundreds of m/s^2)
    tb = np.cumsum(dtf) if fixed else t
    vxb, vzb = central_vel(tb, x), central_vel(tb, z)
    acc = np.hypot(central_vel(tb, vxb), central_vel(tb, vzb))
    # judged only where the whole +-0.1 s derivative window is on screen (a fade-in after an unseen re-place is not motion)
    okw = ok.copy()
    for i_ in np.nonzero(ok)[0]:
        j0 = np.searchsorted(tb, tb[i_] - 0.1); j1 = np.searchsorted(tb, tb[i_] + 0.1, side="right")
        okw[i_] = bool(ok[j0:j1].all())
    ak = okw & (spd > 0.05)
    a95 = float(np.nanpercentile(acc[ak], 95)) if ak.any() else 0.0
    amax = float(np.nanmax(acc[ak])) if ak.any() else 0.0
    mv = ok & (spd > 0.3)
    yrm95 = float(np.nanpercentile(yr_s[mv], 95)) if mv.any() else 0.0
    # (round 8) curvature radius while walking (speed / yaw rate; frames moving > 0.3 m/s and turning > 0.05 rad/s), p10
    cm_ = mv & (np.abs(yr_s) > 0.05)
    rad10 = float(np.nanpercentile(spd[cm_] / np.abs(yr_s[cm_]), 10)) if cm_.any() else float("nan")
    yfast = float((np.abs(yr_s[mv]) > 1.5).mean()) if mv.any() else 0.0
    # (round 5) passing = speed jitter, max speed change, accel max, yaw jitter (<= 0.2); accel p95 / yaw-rate p95 reported
    sm_pass = rms_s <= JIT_SPEED_RMS and rms_y <= JIT_YAW_RMS and dv_max <= JIT_DV_MAX and amax <= ACC_MAX
    sw = []
    for nm, arr, msk, lim, what in (("dv", dv, okp, JIT_DV_MAX, "frame-to-frame speed change (m/s)"), ("acc", acc, ak, ACC_MAX, "root accel (m/s^2)"),
                                    ("rs", np.abs(rs), ok, 3 * JIT_SPEED_RMS, "speed jitter residual (m/s)"), ("ry", np.abs(ry), ok, 3 * JIT_YAW_RMS, "yaw-rate jitter residual (rad/s)")):
        _, _, al = spans(msk & (np.nan_to_num(arr) > lim), 0.0, arr, what)
        sw += al[:3]
    # (reported) time spent between walk and jog (2.3-2.9 m/s), and the longest such stretch
    band = ok & (spd > 2.3) & (spd < 2.9)
    _, _, bsp = spans(band, 0.0, spd, "")
    band_txt = f"; between walk and jog (2.3-2.9 m/s) {100 * band.sum() / max(1, int((ok & (spd > 0.3)).sum())):.1f}% of moving frames, longest {max([q['dur'] for q in bsp], default=0):.2f}s"
    M["smooth"] = {"pass": bool(sm_pass),
                   "value": f"jitter RMS speed {rms_s:.3f} m/s (<= {JIT_SPEED_RMS}), yaw {rms_y:.3f} rad/s (<= {JIT_YAW_RMS}); max dv/frame {dv_max:.3f} m/s (<= {JIT_DV_MAX}); "
                            f"accel max {amax:.2f} (<= {ACC_MAX}) m/s^2; reported: accel p95 {a95:.2f}, yaw-rate p95 moving {yrm95:.2f} rad/s, walking frames yawing > 1.5 rad/s {100 * yfast:.0f} %, curvature radius p10 {rad10:.2f} m{band_txt}. [{old_smooth}]",
                   "rms_speed": rms_s, "rms_yaw": rms_y, "dv_max": dv_max, "acc_p95": a95, "acc_max": amax, "yawrate_p95": yrm95,
                   "old_pass": (not (yr95 > SMOOTH_YAW_P95)) and (not (ac95 > SMOOTH_ACC_P95)), "worst": sorted(sw, key=lambda w: -(w["value"] or 0))[:8]}
    M["foot_slide"] = {"pass": not (p95 > FOOT_SLIDE_P95_MAX), "value": f"planted foot p50 {p50:.2f} m/s, p95 {p95:.2f} m/s over {len(pv)} walking frames (sole < {FOOT_PLANT_H * 100:.1f} cm, vertical < {FOOT_PLANT_VZ} m/s); old definition (sole < 5 cm) p95 {p95_old:.2f} m/s over {len(pv_old)}",
                       "p50": p50, "p95": p95, "worst": []}
    # ---- float / sink
    air = np.nan_to_num(col(S, "wair"), nan=0) > AIR_CLIP_W
    # only where the solve is trusted (conf 1): in conf 0.5 stretches world up is tilted and floor_y is not level
    # (NAV.md known limits); there the footage-depth check at her feet judges standing instead
    solid = np.nan_to_num(col(S, "conf", 1), nan=1) >= 1
    fl_m = sv & ~nobox & ~air & solid & (err > FLOAT_MAX)
    sk_m = sv & ~nobox & ~air & solid & (err < -SINK_MAX)
    t1, s1, a1 = spans(fl_m, FLOAT_RUN_S, err, "floating (sole above floor, m)")
    t2, s2, a2 = spans(sk_m, FLOAT_RUN_S, err, "sinking (sole below floor, m)", higher_worse=False)
    ev = err[sv & ~np.isnan(err)]
    M["float_sink"] = {"pass": not (a1 or a2), "value": f"{len(a1)} float / {len(a2)} sink stretches; sole-floor p5 {np.percentile(ev, 5) if len(ev) else 0:+.3f} m, p95 {np.percentile(ev, 95) if len(ev) else 0:+.3f} m (airborne clips excluded: {int((sv & air).sum())} frames)",
                       "p5": float(np.percentile(ev, 5)) if len(ev) else None, "p95": float(np.percentile(ev, 95)) if len(ev) else None,
                       "worst": sorted(a1 + a2, key=lambda s: -s["dur"])[:8]}
    flags["float_sink"] = s1 | s2
    # ---- depth consistency
    feet, torso, occ, tper = col(S, "feetRho"), col(S, "torsoMed"), col(S, "occ" if fixed else "occOld"), col(S, "torsoPerson")
    if not fixed and np.all(np.isnan(occ)):
        occ = col(S, "occ")  # (runs recorded before occOld existed)
    occ_person = col(S, "occPerson")
    if fixed and not np.all(np.isnan(col(S, "occWall"))):
        # a passer-by walking in front of her is correct occlusion, reported separately; walls / scenery fail
        occ, feet, torso = col(S, "occWall"), col(S, "feetWall"), col(S, "torsoWall")
        if not np.all(np.isnan(col(S, "feetWallR"))):  # (round 5) the app's own depth metric
            feet, torso = col(S, "feetWallR"), col(S, "torsoWallR")
    kf = col(S, "kf")
    conf = col(S, "conf", 1)
    # depth only where the camera solve is trusted (conf 0 = unsolved / pitch dark: projection and depth are meaningless)
    dvalid = sv & ~nobox & ~np.isnan(kf) & (np.nan_to_num(conf, nan=1) > 0)
    # (round 8, coordinator) pitch black under her feet (mean luminance < 0.04): footage depth is meaningless there, as conf 0
    dvalid &= ~(np.nan_to_num(col(S, "feetLum"), nan=1) < FEET_LUM_MIN)
    d_wall = dvalid & (torso < TORSO_RHO_MIN) & (np.nan_to_num(tper) < 0.5)
    d_air = dvalid & (feet > FEET_RHO_MAX) & ~on_stairs  # (open risers read as drops: skipped on stairs, as nav_study does)
    d_feet = dvalid & (feet < FEET_RHO_MIN)
    d_occ = dvalid & (occ > OCC_FRAC_MAX)
    t1, s1, a1 = spans(d_wall, DEPTH_RUN_S, -torso, "through wall: footage at her torso nearer than her (-ratio)")
    t2, s2, a2 = spans(d_air, DEPTH_RUN_S, feet, "on air / looks larger: footage floor behind her feet (ratio)")
    t3, s3, a3 = spans(d_feet, DEPTH_RUN_S, -feet, "feet behind an object (-ratio)")
    t4, s4, a4 = spans(d_occ, DEPTH_RUN_S, occ, "body cut by scenery (occluded fraction)")
    for sp_ in a1 + a3:
        sp_["value"] = -sp_["value"] if sp_["value"] is not None else None
    M["depth"] = {"pass": not (a1 or a2 or a3),  # (round 5: cut-by-scenery reported, not failing)
                  "value": (f"{len(a1)} through-wall, {len(a2)} on-air/larger, {len(a3)} feet-behind, {len(a4)} cut-by-scenery stretches; "
                            f"feet ratio p5/p50/p95 {np.nanpercentile(feet[dvalid], 5) if dvalid.any() else 0:.2f}/{np.nanpercentile(feet[dvalid], 50) if dvalid.any() else 0:.2f}/{np.nanpercentile(feet[dvalid], 95) if dvalid.any() else 0:.2f}, "
                            f"torso ratio p5 {np.nanpercentile(torso[dvalid], 5) if dvalid.any() else 0:.2f}, occluded p95 {np.nanpercentile(occ[dvalid], 95) if dvalid.any() else 0:.2f}"
                            + (f"; occluded by people (correct, not failing) p95 {np.nanpercentile(occ_person[dvalid], 95):.2f}, {int(np.nansum(dvalid & (occ_person > OCC_FRAC_MAX)))} frames > {OCC_FRAC_MAX}" if fixed and dvalid.any() and not np.all(np.isnan(occ_person)) else "")),
                  "worst": sorted(a1 + a2 + a3 + a4, key=lambda s: -s["dur"])[:10]}
    flags["depth"] = s1 | s2 | s3 | s4
    # ---- blockers / rails
    t1, s1, a1 = spans(sv & inb, BLOCKER_RUN_S, None, "inside a nav blocker")
    t2, s2, a2 = spans(sv & onr, BLOCKER_RUN_S, None, "on / across a rail")
    M["blockers_rails"] = {"pass": not (a1 or a2), "value": f"{len(a1)} in-blocker, {len(a2)} rail stretches ({int((sv & inb).sum())} / {int((sv & onr).sum())} frames)",
                           "worst": sorted(a1 + a2, key=lambda s: -s["dur"])[:6]}
    flags["blockers_rails"] = s1 | s2
    # ---- people
    pd_ = col(S, "pdist")
    pov = col(S, "personOver")
    if fixed and not np.all(np.isnan(pov)):
        # screen space: her body drawn over a person who is nearer the camera than her (the "standing on people" look);
        # the sensed 3D person positions are too noisy for a distance test (see DECISIONS #48)
        # (round 8, coordinator) only while she is drawn (opacity >= 0.5, root visible): a dissolved / invisible guide never scores
        pdrawn = sv & ~nobox & (np.nan_to_num(op, nan=1) >= 0.5) & (vis > 0)
        pm = pdrawn & (np.nan_to_num(pov) > PEOPLE_OVER_FRAC)
        t1, s1, a1 = spans(pm, PEOPLE_RUN_S, pov, "drawn on top of a nearer person she should be hidden behind (body fraction)")
        # (round 9) the max fraction is judged over the counted stretches (>= 0.15 s); the all-frames max is reported
        pmax_all = float(np.nanmax(np.where(pdrawn, np.nan_to_num(pov), 0))) if nsv else 0.0
        pmax = float(np.nanmax(np.where(s1, np.nan_to_num(pov), 0))) if s1.any() else 0.0
        M["people"] = {"pass": len(a1) <= PEOPLE_MAX_STRETCHES and pmax <= PEOPLE_MAX_FRAC, "value": f"{len(a1)} stretches (<= {PEOPLE_MAX_STRETCHES}) >= {PEOPLE_RUN_S}s drawn on top of a nearer person, max body fraction {pmax:.2f} (<= {PEOPLE_MAX_FRAC}; all frames {pmax_all:.2f}); body fraction p99 {np.nanpercentile(pov[sv & ~nobox], 99) if nsv else 0:.2f}, max {np.nanmax(np.where(sv, pov, 0)):.2f} (3D distance < 0.5 m in {int(np.nansum(sv & (pd_ < PEOPLE_DIST)))} frames, not failing)",
                       "worst": a1[:6]}
    else:
        pm = sv & (pd_ < PEOPLE_DIST)
        t1, s1, a1 = spans(pm, PEOPLE_RUN_S, -pd_, "within 0.5 m of a person (m)")
        for sp_ in a1:
            sp_["value"] = -sp_["value"] if sp_["value"] is not None else None
        M["people"] = {"pass": not a1, "value": f"{len(a1)} stretches; min distance {np.nanmin(np.where(sv, pd_, np.inf)) if nsv else float('nan'):.2f} m",
                       "worst": a1[:6]}
    flags["people"] = s1
    # ---- size (fills the screen = placed too near / in front of the floor)
    hfrac = (by1 - by0) / H
    drawn_s = sv & (np.nan_to_num(op, nan=1) >= 0.5) & (vis > 0)
    # (no box while drawn = she is at / behind the camera: the camera passed through her)
    sm_ = drawn_s & (nobox | (hfrac > SIZE_MAX_FRAC))
    _, _, a_old = spans(sv & ~nobox & (hfrac > SIZE_OLD_FRAC), SIZE_OLD_RUN_S, hfrac, "")
    t1, s1, a1 = spans(sm_, SIZE_RUN_S, np.where(nobox, 99, hfrac), "too large (box height / screen; 99 = at / behind the camera)")
    M["size"] = {"pass": not a1, "value": f"{len(a1)} stretches > {SIZE_MAX_FRAC} while drawn (old rule: {len(a_old)}); height/screen p5 {np.nanpercentile(hfrac[sv & ~nobox], 5) if nsv else 0:.2f}, p95 {np.nanpercentile(hfrac[sv & ~nobox], 95) if nsv else 0:.2f}, max {np.nanmax(np.where(drawn_s, hfrac, 0)):.2f}",
                 "worst": a1[:6]}
    flags["size"] = s1
    # ---- camera proximity (round 7): her ground distance to the camera while drawn (opacity >= 0.5) never < 1.5 m
    cdist = col(S, "cd")
    pm_ = drawn_s & (np.nan_to_num(cdist, nan=99) < PROX_MIN_M)
    t1, s1, a1 = spans(pm_, 0.0, -np.nan_to_num(cdist, nan=99), "camera proximity (- ground distance to the camera, m)")
    for sp_ in a1:
        sp_["value"] = -sp_["value"] if sp_["value"] is not None else None
    M["proximity"] = {"pass": int(pm_.sum()) == 0, "value": f"{int(pm_.sum())} drawn frames nearer than {PROX_MIN_M} m in {len(a1)} stretches; min drawn distance {np.nanmin(np.where(drawn_s, cdist, np.inf)) if drawn_s.any() else float('nan'):.2f} m",
                      "frames": int(pm_.sum()), "worst": a1[:6]}
    flags["proximity"] = s1
    # ---- posture sanity: an arm raised / stuck out while no gesture is active (bind-pose / T-pose leak)
    uaL, uaR, faL, faR = col(S, "uaL"), col(S, "uaR"), col(S, "faL"), col(S, "faR")
    ges = np.array([s.get("ges", "") or "" for s in S])
    calm = (ges == "none") & (np.nan_to_num(col(S, "pointW"), nan=0) < 0.05) & (col(S, "rail", 0) < 1) & (np.nan_to_num(col(S, "wges"), nan=0) < 0.2)
    # (round 5) a jog carries bent arms high by design: posture judges bind-pose leaks, so jog / run frames are not calm
    clipn = np.array([str(s_.get("clip", "") or "") for s_ in S])
    calm &= ~np.char.startswith(np.char.lower(clipn), "jog") & ~np.char.startswith(np.char.lower(clipn), "run")
    arm_up = np.fmax.reduce([uaL - UPPER_ARM_UP_MAX, uaR - UPPER_ARM_UP_MAX, faL - FOREARM_UP_MAX, faR - FOREARM_UP_MAX])
    have_arms = not np.all(np.isnan(arm_up))
    pm_ = sv & ~nobox & calm & (arm_up > 0)
    t1, s1, a1 = spans(pm_, POSTURE_RUN_S, arm_up, "arm raised with no gesture (excess up-component)")
    M["posture"] = {"pass": not a1, "value": (f"{len(a1)} stretches; upper-arm up-component p99 {np.nanpercentile(np.fmax(uaL, uaR)[sv & calm], 99) if (sv & calm).any() else float('nan'):+.2f}, forearm p99 {np.nanpercentile(np.fmax(faL, faR)[sv & calm], 99) if (sv & calm).any() else float('nan'):+.2f} (calm frames {int((sv & calm).sum())})") if have_arms else "arm bones not found",
                    "worst": a1[:6]}
    flags["posture"] = s1
    # ---- perf
    ft = dt_frame[1:] * 1000
    ft = ft[~np.isnan(ft)]
    nfz = int((ft > FREEZE_MS).sum())
    fz_m = np.concatenate([[False], (dt_frame[1:] * 1000) > FREEZE_MS])
    # footage freeze: picture stuck while the scroll moved on
    ff = np.zeros(n, bool)
    ahead_since = None
    lastsh, lastsh_t = None, t[0]
    for i in range(n):
        if shown[i] != lastsh:
            lastsh, lastsh_t = shown[i], t[i]
        if abs(cur[i] - shown[i]) > 2 and shown[i] == lastsh:
            ahead_since = t[i] if ahead_since is None else ahead_since
        else:
            ahead_since = None
        if ahead_since is not None and (t[i] - ahead_since) * 1000 > FOOTAGE_FREEZE_MS:
            ff[i] = True
    top_fz = []
    for i in np.argsort(-np.nan_to_num(dt_frame))[:6]:
        if dt_frame[i] * 1000 > FREEZE_MS:
            top_fz.append({"t": round(float(t[i]), 2), "dur": round(float(dt_frame[i]), 3), "t_worst": round(float(t[i]), 2), "frame": frame_at(i), "value": round(float(dt_frame[i] * 1000)), "what": "frame time (ms)", "i": int(i)})
    ffsp = runs(ff)
    perf_pass = (nfz / max(1, len(ft)) <= FREEZE_MAX_FRAC) and (len(ft) == 0 or ft.max() <= HARD_FREEZE_MS) and len(res["errors"]) == 0
    n50 = int((ft > 50).sum()) if len(ft) else 0  # (round 9: "mobile is never laggy": hitches over 50 ms reported)
    M["perf"] = {"pass": bool(perf_pass), "value": f"frame p50 {np.percentile(ft, 50):.1f} ms, p95 {np.percentile(ft, 95):.1f} ms, p99 {np.percentile(ft, 99):.1f} ms, max {ft.max():.0f} ms, {n50} hitches > 50 ms, {nfz} frames > {FREEZE_MS} ms; {len(ffsp)} footage freezes > {FOOTAGE_FREEZE_MS} ms; {len(res['errors'])} console errors",
                 "p50": float(np.percentile(ft, 50)), "p95": float(np.percentile(ft, 95)), "freezes": nfz, "footage_freezes": len(ffsp),
                 "console_errors": res["errors"][:5], "worst": top_fz}
    flags["perf"] = fz_m
    for k_, v_ in M.items():
        v_["pass"] = bool(v_["pass"])
    # events relative to t0
    out["events"] = [{"t": round(e["t"] - t0, 2), "what": e["what"]} for e in res["events"]]
    series = dict(t=t, sv=sv, card=card, bx0=bx0, bx1=bx1, by0=by0, by1=by1, W=W, H=H, ox=ox, lat=lat, along=along, spd=spd,
                  err=err, feet=feet, torso=torso, occ=occ, ft=np.concatenate([[np.nan], dt_frame[1:] * 1000]), shown=shown, cur=cur,
                  flags=flags, pdist=pd_, hfrac=hfrac, ep=ep, frame=np.array([frame_at(i) for i in range(n)]), wloco=wloco)
    return out, series


# ------------------------------------------------------------------------------------------------ graphs
FLAG_COLORS = {"offscreen": "#d62728", "hidden": "#9467bd", "teleport": "#ff7f0e", "glide": "#e377c2", "snap_turn": "#aa3377", "float_sink": "#8c564b",
               "depth": "#17becf", "blockers_rails": "#bcbd22", "people": "#7f7f7f", "size": "#1f77b4", "proximity": "#000000", "posture": "#ee7733", "perf": "#2ca02c"}


def plot(series, res_out, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    t = series["t"]
    fig, ax = plt.subplots(7, 1, figsize=(15, 17), sharex=True)
    title = f"{res_out['floor']} / {res_out['scenario']} (entry {res_out['entry']}): " + ", ".join(f"{k} {'PASS' if v['pass'] else 'FAIL'}" for k, v in res_out["metrics"].items())
    fig.suptitle(title, fontsize=10)

    def shade(a, keys):
        for i0, i1 in runs(~series["sv"]):
            a.axvspan(t[i0], t[i1], color="#dddddd", alpha=0.5, lw=0)
        for k in keys:
            for i0, i1 in runs(series["flags"].get(k, np.zeros(len(t), bool))):
                a.axvspan(t[i0], t[i1] + 0.02, color=FLAG_COLORS[k], alpha=0.25, lw=0)

    a = ax[0]
    a.plot(t, series["cur"], lw=0.8, label="scroll cur")
    a.plot(t, series["shown"], lw=0.8, label="footage shown")
    a.set_ylabel("footage frame")
    a.legend(loc="upper left", fontsize=7)
    shade(a, ["perf"])
    a = ax[1]
    W, H = np.nanmedian(series["W"]), np.nanmedian(series["H"])
    a.plot(t, series["bx0"], lw=0.7, label="box left")
    a.plot(t, series["bx1"], lw=0.7, label="box right")
    a.plot(t, series["by0"], lw=0.7, label="box top")
    a.plot(t, series["by1"], lw=0.7, label="box bottom (feet)")
    for v in (0, W, H):
        a.axhline(v, color="k", lw=0.6, ls="--")
    a.set_ylim(-150, H + 150)
    a.set_ylabel("screen px (0, W, H dashed)")
    a.legend(loc="upper left", fontsize=7, ncol=4)
    shade(a, ["offscreen", "hidden", "size"])
    a = ax[2]
    a.plot(t, series["lat"], lw=0.7, label="lateral |v| (m/s)")
    a.plot(t, series["along"], lw=0.7, label="along facing (m/s)")
    a.plot(t, series["spd"], lw=0.5, alpha=0.6, label="speed")
    a.axhline(GLIDE_LAT, color="r", lw=0.7, ls="--")
    a.axhline(-GLIDE_BACK, color="r", lw=0.7, ls="--")
    a.set_ylim(-2, 6)
    a.set_ylabel("m/s")
    a.legend(loc="upper left", fontsize=7, ncol=3)
    shade(a, ["glide", "teleport", "snap_turn"])
    a = ax[3]
    a.plot(t, series["err"], lw=0.7, label="sole - floor (m)")
    a.axhline(FLOAT_MAX, color="r", lw=0.7, ls="--")
    a.axhline(-SINK_MAX, color="r", lw=0.7, ls="--")
    a.set_ylim(-0.4, 0.4)
    a.set_ylabel("m")
    a.legend(loc="upper left", fontsize=7)
    shade(a, ["float_sink"])
    a = ax[4]
    a.plot(t, series["feet"], lw=0.7, label="footage/her depth at feet")
    a.plot(t, series["torso"], lw=0.7, label="... at torso (median)")
    a.plot(t, series["occ"], lw=0.7, label="occluded body fraction")
    for v, c in ((FEET_RHO_MAX, "r"), (FEET_RHO_MIN, "r"), (TORSO_RHO_MIN, "m"), (OCC_FRAC_MAX, "g")):
        a.axhline(v, color=c, lw=0.6, ls="--")
    a.set_ylim(0, 4)
    a.set_ylabel("ratio")
    a.legend(loc="upper left", fontsize=7, ncol=3)
    shade(a, ["depth", "blockers_rails"])
    a = ax[5]
    a.plot(t, series["pdist"], lw=0.7, label="nearest person (m)")
    a.plot(t, series["hfrac"], lw=0.7, label="her height / screen")
    a.axhline(PEOPLE_DIST, color="r", lw=0.6, ls="--")
    a.axhline(SIZE_MAX_FRAC, color="b", lw=0.6, ls="--")
    a.set_ylim(0, 4)
    a.legend(loc="upper left", fontsize=7)
    shade(a, ["people", "size", "posture"])
    a = ax[6]
    a.plot(t, series["ft"], lw=0.6, label="frame time (ms)")
    a.axhline(FREEZE_MS, color="r", lw=0.7, ls="--")
    a.set_ylim(0, max(120, min(600, np.nanmax(series["ft"]) * 1.1 if np.isfinite(np.nanmax(series["ft"])) else 120)))
    a.set_ylabel("ms")
    a.set_xlabel("seconds since scenario start (grey = not expected visible: card / transition / glide / grace)")
    a.legend(loc="upper left", fontsize=7)
    shade(a, ["perf"])
    fig.tight_layout(rect=(0, 0, 1, 0.98))
    fig.savefig(path, dpi=80)
    plt.close(fig)


# ------------------------------------------------------------------------------------------------ contact sheets
def nearest_shot(shots, ts):
    if not shots:
        return None
    arr = [s[0] for s in shots]
    i = int(np.searchsorted(arr, ts))
    cands = [j for j in (i - 1, i) if 0 <= j < len(shots)]
    j = min(cands, key=lambda j: abs(arr[j] - ts))
    return shots[j] if abs(arr[j] - ts) < 0.4 else None


def flags_at(series, i):
    return [k for k, m in series["flags"].items() if m[i]]


def contact_sheets(res, series, res_out, sheet_path, fail_path, fail_dir):
    from PIL import Image, ImageDraw, ImageFont
    shots = res["shots"]
    if not shots or series is None:
        return []
    t, ep = series["t"], series["ep"]
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 13)
        fsm = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 11)
    except Exception:
        font = fsm = ImageFont.load_default()
    # failure moments: the worst instant of every failing span, plus span starts, deduped (cap 48)
    fails = []
    for name, mm in res_out["metrics"].items():
        if mm["pass"]:
            continue
        for w in mm.get("worst", [])[:8]:
            if "i" in w:
                fails.append((w["i"], name, w))
    fails.sort(key=lambda f: t[f[0]])
    ded = []
    for f in fails:
        if ded and abs(t[f[0]] - t[ded[-1][0]]) < 0.25:
            continue
        ded.append(f)
    ded = ded[:48]
    fail_idx = {f[0] for f in ded}
    # periodic every ~1 s
    per = []
    nxt = t[0]
    for i in range(len(t)):
        if t[i] >= nxt:
            per.append(i)
            nxt = t[i] + 1.0
    picks = sorted(set(per) | fail_idx)
    W = int(np.nanmedian(series["W"]))
    H = int(np.nanmedian(series["H"]))

    def tile(i, scale):
        sh = nearest_shot(shots, ep[i])
        if not sh:
            return None
        im = Image.open(sh[1]).convert("RGB")
        kx, ky = im.width / W, im.height / H
        dr = ImageDraw.Draw(im)
        fl = flags_at(series, i)
        if not np.isnan(series["bx0"][i]):
            dr.rectangle([series["bx0"][i] * kx, series["by0"][i] * ky, series["bx1"][i] * kx, series["by1"][i] * ky], outline=(255, 40, 40) if fl else (60, 255, 90), width=3)
        im = im.resize((int(im.width * scale), int(im.height * scale)))
        canvas = Image.new("RGB", (im.width, im.height + 44), (16, 16, 20))
        canvas.paste(im, (0, 44))
        d2 = ImageDraw.Draw(canvas)
        d2.text((4, 2), f"t={t[i]:.2f}s f={series['frame'][i]}{'' if series['sv'][i] else ' (n/a)'}", fill=(235, 235, 235), font=font)
        d2.text((4, 22), ", ".join(fl) if fl else "ok", fill=(255, 90, 90) if fl else (120, 220, 120), font=fsm)
        if i in fail_idx:
            d2.rectangle([0, 0, canvas.width - 1, canvas.height - 1], outline=(255, 40, 40), width=4)
        return canvas

    def sheet(idxs, scale, cols, path, header):
        tiles = [tl for tl in (tile(i, scale) for i in idxs) if tl is not None]
        if not tiles:
            return
        tw, th = tiles[0].width, tiles[0].height
        rows = math.ceil(len(tiles) / cols)
        S_ = Image.new("RGB", (cols * tw, rows * th + 30), (8, 8, 10))
        ImageDraw.Draw(S_).text((6, 6), header, fill=(255, 255, 255), font=font)
        for k, tl in enumerate(tiles):
            S_.paste(tl, ((k % cols) * tw, 30 + (k // cols) * th))
        S_.save(path, quality=80)

    hdr = f"{res_out['floor']} / {res_out['scenario']}: " + " ".join(f"{k}:{'P' if v['pass'] else 'F'}" for k, v in res_out["metrics"].items())
    sheet(picks, 0.30, 10, sheet_path, hdr + "   (red border = failure moment, box = her skinned body)")
    saved = []
    if ded:
        sheet([f[0] for f in ded], 0.5, 6, fail_path, hdr + "   failure moments")
        fail_dir.mkdir(parents=True, exist_ok=True)
        for i, name, w in ded:
            tl = tile(i, 1.0)
            if tl is not None:
                p = fail_dir / f"{res_out['floor']}_{res_out['scenario']}_t{t[i]:07.2f}_f{series['frame'][i]}_{name}.jpg"
                tl.save(p, quality=85)
                saved.append(str(p))
    return saved


# ------------------------------------------------------------------------------------------------ report
METRIC_ORDER = ["offscreen", "hidden", "teleport", "glide", "snap_turn", "smooth", "foot_slide", "float_sink", "depth", "blockers_rails", "people", "size", "proximity", "posture", "perf"]


def write_report(outdir, results, args, wall):
    cells = {(r["floor"], r["scenario"]): r for r in results}
    cols_ = [(f, s) for f in args.floors for s in args.scenarios if (f, s) in cells]
    L = [f"# Walk audit: {args.label}", "",
         f"Base {args.base}, mobile profile (393x852 @3x, touch), CPU throttle {args.throttle}x, seed {args.seed}, wall time {wall / 60:.1f} min.", "",
         "| metric | " + " | ".join(f"{f[:4]}/{s}" for f, s in cols_) + " |",
         "|---|" + "---|" * len(cols_)]
    for m in METRIC_ORDER:
        row = []
        for c in cols_:
            mm = cells[c]["metrics"].get(m)
            mo = (cells[c].get("metrics_old") or {}).get(m)
            row.append("n/a" if mm is None else ("PASS" if mm["pass"] else "**FAIL**") + ("" if mo is None or mo["pass"] == mm["pass"] else f" (old {'PASS' if mo['pass'] else 'FAIL'})"))
        L.append(f"| {m} | " + " | ".join(row) + " |")
    overall = all(mm["pass"] for r in results for mm in r["metrics"].values())
    L += ["", f"**Overall: {'PASS' if overall else 'FAIL'}**", ""]
    L += ["Thresholds: " + ", ".join(f"{k}={v}" for k, v in THRESHOLDS().items()), ""]
    for r in results:
        L += [f"## {r['floor']} / {r['scenario']} (entry: {r['entry']}, {r.get('duration_s', 0)} s, {r['n_samples']} frames, {r.get('visible_frames', 0)} expected-visible)", ""]
        L += [f"Graph: `graphs/{r['floor']}_{r['scenario']}.png`  Sheet: `sheets/{r['floor']}_{r['scenario']}.jpg`  Failures: `sheets/{r['floor']}_{r['scenario']}_fail.jpg`", ""]
        L += ["| metric | result | measured (fixed method) | old method |", "|---|---|---|---|"]
        for m in METRIC_ORDER:
            mm = r["metrics"].get(m)
            mo = (r.get("metrics_old") or {}).get(m)
            if mm:
                L.append(f"| {m} | {'PASS' if mm['pass'] else '**FAIL**'} | {mm['value']} | " + (f"{'PASS' if mo['pass'] else 'FAIL'}: {mo['value']}" if mo else "") + " |")
        for m in METRIC_ORDER:
            mm = r["metrics"].get(m)
            if mm and not mm["pass"] and mm.get("worst"):
                L.append(f"\nWorst {m}:")
                for w in mm["worst"][:6]:
                    L.append(f"- t={w['t_worst']:.2f}s (span {w['t']:.2f}+{w['dur']:.2f}s) footage frame {w['frame']}: {w['what']}" + (f" = {w['value']}" if w.get("value") is not None else ""))
        if r.get("n_errors"):
            L.append(f"\nConsole errors ({r['n_errors']}): " + "; ".join(r["errors"][:3]))
        if r.get("recorder_errors") and r["recorder_errors"][0]:
            L.append(f"\nRecorder errors: {r['recorder_errors']}")
        L.append("\nEvents: " + "; ".join(f"{e['t']:.1f}s {e['what']}" for e in r["events"]))
        L.append("")
    (outdir / "report.md").write_text("\n".join(L))
    return overall


def THRESHOLDS():
    g = globals()
    keys = ["GRACE_S", "OFFSCREEN_MARGIN_PX", "OFFSCREEN_MAX_RUN_S", "OFFSCREEN_MAX_FRAC", "HIDDEN_MAX_RUN_S", "HIDDEN_MAX_FRAC", "TELEPORT_SPEED",
            "TELEPORT_VSPEED", "TELEPORT_SCREEN_PX", "SNAP_TURN_RATE", "GLIDE_LAT", "GLIDE_BACK", "GLIDE_RUN_S", "NOLOCO_SPEED", "NOLOCO_WEIGHT", "FOOT_SLIDE_P95_MAX", "JIT_SPEED_RMS", "JIT_YAW_RMS", "JIT_DV_MAX", "ACC_P95_MAX", "ACC_MAX", "YAWRATE_P95_MAX",
            "FLOAT_MAX", "SINK_MAX", "FLOAT_RUN_S", "DEPTH_RUN_S", "TORSO_RHO_MIN", "FEET_RHO_MAX", "FEET_LUM_MIN", "FEET_RHO_MIN", "OCC_FRAC_MAX", "BLOCKER_RUN_S",
            "RAIL_ON_M", "PEOPLE_DIST", "PEOPLE_RUN_S", "PEOPLE_MAX_STRETCHES", "PEOPLE_MAX_FRAC", "SIZE_MAX_FRAC", "SIZE_RUN_S", "GONE_INSIDE_MIN", "GONE_MAX_RUN_S", "GONE_MAX_FRAC", "CLIP_MAX_RUN_S", "CLIP_MAX_FRAC", "PROX_MIN_M", "UPPER_ARM_UP_MAX", "FOREARM_UP_MAX", "POSTURE_RUN_S", "FREEZE_MS", "FREEZE_MAX_FRAC", "HARD_FREEZE_MS"]
    return {k: g[k] for k in keys}


def strip(r):
    r = dict(r)
    for mm in list(r["metrics"].values()) + list((r.get("metrics_old") or {}).values()):
        for w in mm.get("worst", []):
            w.pop("i", None)
    return r


async def run_suite(args, outdir):
    from playwright.async_api import async_playwright
    stations = json.loads(urllib.request.urlopen(args.base.rstrip("/") + "/data/stations.json", timeout=30).read())["stations"]
    stations = sorted(stations, key=lambda s: s["click_frame"])
    outdir.mkdir(parents=True, exist_ok=True)
    for sub in ("graphs", "sheets", "fail_frames"):
        (outdir / sub).mkdir(exist_ok=True)
    results = []
    t0 = time.time()
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=not args.headed, args=ARGS)
        for floor in args.floors:
            for scen in args.scenarios:
                ts = time.time()
                print(f"[{outdir.name}] {floor}/{scen} ...", flush=True)
                res = await run_scenario(browser, args.base, floor, scen, args.seed, args.throttle, outdir, stations, args.keep_frames)
                (outdir / "raw").mkdir(exist_ok=True)
                with gzip.open(outdir / "raw" / f"{floor}_{scen}.json.gz", "wt") as fh:
                    json.dump(res, fh)
                out, series = analyze(res, args.base)
                out["metrics_old"] = analyze(res, args.base, "old")[0]["metrics"]
                if series is not None:
                    plot(series, out, outdir / "graphs" / f"{floor}_{scen}.png")
                    out["fail_frames"] = contact_sheets(res, series, out, outdir / "sheets" / f"{floor}_{scen}.jpg", outdir / "sheets" / f"{floor}_{scen}_fail.jpg", outdir / "fail_frames")
                if not args.keep_frames:
                    shutil.rmtree(res["frames_dir"], ignore_errors=True)
                results.append(out)
                print(f"   {time.time() - ts:.0f}s: " + " ".join(f"{k}={'P' if v['pass'] else 'FAIL'}" for k, v in out["metrics"].items()), flush=True)
        await browser.close()
    if not args.keep_frames:
        shutil.rmtree(outdir / "frames", ignore_errors=True)
    wall = time.time() - t0
    overall = write_report(outdir, results, args, wall)
    json.dump({"label": args.label, "base": args.base, "throttle": args.throttle, "seed": args.seed, "wall_s": wall, "pass": overall,
               "thresholds": THRESHOLDS(), "results": [strip(r) for r in results]}, open(outdir / "summary.json", "w"), indent=1, default=float)
    print(f"[{outdir.name}] {'PASS' if overall else 'FAIL'} in {wall / 60:.1f} min -> {outdir / 'report.md'}", flush=True)
    return overall, results


def reanalyze(args, outdir):
    """Re-run the analysis, graphs and sheets from a finished run's raw telemetry (threshold tuning without a browser)."""
    results = []
    for sub in ("graphs", "sheets", "fail_frames"):
        (outdir / sub).mkdir(parents=True, exist_ok=True)
    for floor in args.floors:
        for scen in args.scenarios:
            p = outdir / "raw" / f"{floor}_{scen}.json.gz"
            if not p.exists():
                continue
            res = json.load(gzip.open(p, "rt"))
            res["shots"] = [s_ for s_ in res["shots"] if pathlib.Path(s_[1]).exists()]
            out, series = analyze(res, args.base)
            out["metrics_old"] = analyze(res, args.base, "old")[0]["metrics"]
            if series is not None:
                plot(series, out, outdir / "graphs" / f"{floor}_{scen}.png")
                out["fail_frames"] = contact_sheets(res, series, out, outdir / "sheets" / f"{floor}_{scen}.jpg", outdir / "sheets" / f"{floor}_{scen}_fail.jpg", outdir / "fail_frames") if res["shots"] else []
            results.append(out)
            print(f"{floor}/{scen}: " + " ".join(f"{k}={'P' if v['pass'] else 'FAIL'}" for k, v in out["metrics"].items()), flush=True)
    overall = write_report(outdir, results, args, 0)
    json.dump({"label": args.label, "base": args.base, "throttle": args.throttle, "seed": args.seed, "pass": overall, "reanalyzed": True,
               "thresholds": THRESHOLDS(), "results": [strip(r) for r in results]}, open(outdir / "summary.json", "w"), indent=1, default=float)
    return overall


def aggregate(outdir, all_runs, args):
    keys = sorted({(r["floor"], r["scenario"]) for run in all_runs for r in run}, key=lambda k: (args.floors.index(k[0]), args.scenarios.index(k[1])))
    L = [f"# Walk audit aggregate: {args.label} ({len(all_runs)} runs)", "", "PASS count per metric per scenario (runs passing / runs).", "",
         "| metric | " + " | ".join(f"{f[:4]}/{s}" for f, s in keys) + " |", "|---|" + "---|" * len(keys)]
    agg = {}
    for m in METRIC_ORDER:
        row = []
        for k in keys:
            vals = [r["metrics"][m]["pass"] for run in all_runs for r in run if (r["floor"], r["scenario"]) == k and m in r["metrics"]]
            agg.setdefault(m, {})[f"{k[0]}/{k[1]}"] = [int(sum(vals)), len(vals)]
            row.append(f"{sum(vals)}/{len(vals)}" if sum(vals) == len(vals) else f"**{sum(vals)}/{len(vals)}**")
        L.append(f"| {m} | " + " | ".join(row) + " |")
    overall = all(v[0] == v[1] for d in agg.values() for v in d.values())
    L += ["", f"**Overall: {'PASS' if overall else 'FAIL'}** (every metric must pass in every run)", "", "Per-run reports: " + ", ".join(f"`run{i + 1}/report.md`" for i in range(len(all_runs)))]
    (outdir / "report.md").write_text("\n".join(L))
    json.dump({"label": args.label, "runs": len(all_runs), "pass": overall, "pass_counts": agg}, open(outdir / "summary.json", "w"), indent=1)
    return overall


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base", default="http://127.0.0.1:5301/")
    ap.add_argument("--floors", default="downstairs,upstairs")
    ap.add_argument("--scenarios", default=",".join(SCENARIOS))
    ap.add_argument("--label", default=time.strftime("audit_%Y%m%d_%H%M%S"))
    ap.add_argument("--throttle", type=float, default=4)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--keep-frames", action="store_true", help="keep every screencast frame (large)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "qa/runs/audit"))
    ap.add_argument("--reanalyze", action="store_true", help="re-run analysis/graphs/sheets from <out>/<label>/raw (no browser); needs --keep-frames for sheets")
    args = ap.parse_args()
    args.floors = [f for f in args.floors.split(",") if f]
    args.scenarios = [s for s in args.scenarios.split(",") if s]
    bad = [s for s in args.scenarios if s not in SCENARIOS] + [f for f in args.floors if f not in ("downstairs", "upstairs")]
    if bad:
        ap.error(f"unknown: {bad}")
    if not args.base.endswith("/"):
        args.base += "/"
    outdir = pathlib.Path(args.out) / args.label
    if args.reanalyze:
        ok = reanalyze(args, outdir)
    elif args.repeat <= 1:
        ok, _ = asyncio.run(run_suite(args, outdir))
    else:
        all_runs, oks = [], []
        for k in range(args.repeat):
            ok_k, res = asyncio.run(run_suite(args, outdir / f"run{k + 1}"))
            all_runs.append(res)
            oks.append(ok_k)
        ok = aggregate(outdir, all_runs, args) and all(oks)
        print(f"aggregate {'PASS' if ok else 'FAIL'} -> {outdir / 'report.md'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
