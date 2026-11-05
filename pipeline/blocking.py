"""Blocking track for the guide: her position as a function of footage frame, solved offline (like blocking a shot).

The footage is deterministic: the people, walls, rails and floor at frame f are the same on every visit; only the
visitor's scroll speed changes. So her place is solved once, globally, from the same data the app uses:

  candidates  a world grid on the measured free lane (0.25 m along the walked path x 0.25 m across, inside the lane
              with 0.28 m wall clearance), floor height from the nav map
  per frame   (every STEP footage frames, the frames whose depth / mask the nav map decoded) each candidate is
              projected with the solved camera and kept only if ALL hard constraints hold:
                - walkable: >= 0.6 m from a balustrade with a drop (0.45 m from other rails) and on the walked side,
                  >= blocker radius + 0.3 m from blockers
                - fully in frame on a phone (cover crop of the 9:16 footage to 393x852), 6 % margins left / top /
                  bottom, clear of the progress rail on the right (box right edge <= 0.90 of the screen)
                - height / screen 0.20-0.45
                - covers at most 25 % of a live station's glow rect (its tracked screen region)
                - not drawn over / inside a person: person-mask cells in her box whose floor-calibrated depth is from
                  0.6 m nearer to 0.25 m behind her (the shader would draw her over or into them) <= 3 % of her box;
                  people farther in front (they hide her correctly) <= 15 %
                - not behind a wall: footage at her torso nearer than 0.68 x her distance in <= 20 % of torso samples,
                  feet ratio 0.62-1.65 (feet not behind an object / not standing on air), scenery nearer than her by
                  0.9 m over <= 20 % of her box
  soft costs  composition (a third in from a side, feet in the lower half, height ~0.3 of the screen)
  DP          Viterbi over the frame steps. Her speed budget comes from the pace cap: at the fastest playback the
              app allows while she leads (WALK_CAP_MS along the path, PAN_CAP rad/s of turn: app.ts buildWalkCap,
              replicated here), a step lasts STEP / cap(f) seconds of real time, and she may cover at most
              0.9 x V_HER (2.3 m/s) x that, sideways included. Steps beyond it are penalised in the DP and the
              solved track is then smoothed and checked against the budget (reported). Plus movement,
              backward-along-the-path, lateral and side-switch costs.

Frames with no candidate meeting the hard constraints fall back to relaxed candidates (flagged) and are reported as
ranges, to be fixed in the data (lane widening, hand-placed spots, the walk-end trim).

Output: app/public/data/blocking_<floor>.json  {floor, step, fps, end, P: [[x, y, z, flag], ...] per step frame}
        and a verification contact sheet (her box from P(f) drawn on the footage) in OUT.

  python pipeline/blocking.py <downstairs|upstairs> [--sheet]
"""
import json
import os
import pathlib
import subprocess
import sys

import cv2
import numpy as np
from scipy.spatial.transform import Rotation as Rot

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = sys.argv[1]
SHEET = "--sheet" in sys.argv
OUT = pathlib.Path(os.environ.get("NAV_OUT", "/private/tmp/claude-501/nav"))
OUT.mkdir(parents=True, exist_ok=True)
STEP = 5
DW, DH = 360, 640
WALK_END = {"upstairs": 3770}   # app/src/core/data.ts

# phone framing: 9:16 footage covering a 393 x 852 viewport -> visible image u range
PHONE_AR = 393 / 852
OVERSCAN = 1.075                          # view.ts: the footage is shown 7.5 % zoomed in
VIS_W = PHONE_AR / (720 / 1280) / OVERSCAN  # visible image width fraction (view su)
U0 = (1 - VIS_W) / 2
VIS_H = 1 / OVERSCAN                      # visible image height fraction (view sv)
V0 = (1 - VIS_H) / 2
H_PX, W_PX = 1280, 720
SCR_W, SCR_H = 393, 852
GRID = 0.125              # across the lane
GRID_S = 0.125            # along the path (her per-step moves at the fastest playback are ~0.1-0.25 m)
WALL_CLEAR = 0.28
GUIDE_H = 1.70           # top of her screen box (hair): the runtime box measured 5 % taller than 1.62 m planned
BOX_HALF = 0.27          # her screen box half-width / her height (arms, skirt), as brain spotQuality
V_HER = 2.3              # m/s: she is a walker only; never faster, sideways repositioning included
WALK_CAP_MS, PAN_CAP, MAX_FPS = float(os.environ.get("WALK_CAP", "1.6")), float(os.environ.get("PAN_CAP", "0.6")), float(os.environ.get("MAX_FPS", "75"))   # the app's pace cap (app.ts buildWalkCap): fastest playback while she leads
X_MIN, X_MAX, Y_MIN, Y_MAX = 0.06, 0.90, 0.06, 0.94
H_MIN, H_MAX = 0.20, 0.45
# (round 7) ground distance to the camera: the runtime dissolves her below ~1.5 m (camera-proximity safety), so P keeps
# tracking headroom: tier 0 >= 2.2 m, tiers 1-2 >= 1.9 m, never below 1.7 m (the runtime re-targets anything nearer than 1.9 m)
CD_T0, CD_T12, CD_NEVER = float(os.environ.get("CD_T0", "2.2")), float(os.environ.get("CD_T12", "1.9")), float(os.environ.get("CD_NEVER", "1.7"))
BEHIND_T2 = float(os.environ.get("BEHIND_T2", "0.8"))   # (round 7) tier 2 may stand behind guests (correctly hidden) up to this
# (round 8, coordinator) lead the pan: in these ranges P is biased toward where the frame is going, from her screen x
# through the future camera at f+15 and f+30, penalised outside 0.15-0.85 of the screen
PAN_LEAD_RANGES = {"downstairs": [(735, 890), (1040, 1220), (1740, 1800), (2270, 2345)]}.get(NAME, [])
PAN_LEAD_W = float(os.environ.get("PAN_LEAD_W", "120"))
GLOW_M = float(os.environ.get("GLOW_M", "0"))   # (round 9) head-point margin beyond the QA region (x0+10..x1-10, y0..y1) in px
H_T12 = float(os.environ.get("H_T12", "0.47"))       # (round 7) tiers 1-2 height limit (was 0.52): the runtime follows P only up to 0.5 and dissolves her above 0.52
T2_HMIN = float(os.environ.get("T2_HMIN", "0.12"))     # (round 7) tier 2 may stand further back (smaller) where the near floor is full of guests

cam = json.load(open(ROOT / f"app/public/data/camera_{NAME}.json"))
meta = json.load(open(ROOT / f"app/public/media/walk/{NAME}/meta.json"))
nav = json.load(open(ROOT / f"app/public/data/nav_{NAME}.json"))
stations = json.load(open(ROOT / "app/public/data/stations.json"))["stations"] if NAME == "downstairs" else []
N = cam["frames"]
FPS = meta["fps"]
END = min(N - 1, WALK_END.get(NAME, N - 1))
P = np.array(cam["pos"]).reshape(-1, 3)
Rm = Rot.from_quat(np.array(cam["quat"]).reshape(-1, 4)).as_matrix()
I = cam["intrinsics"]
FX, FY, CX, CY = I["fx"], I["fy"], I["cx"], I["cy"]

S = np.concatenate([[0], np.cumsum(np.minimum(0.08, np.hypot(*np.diff(P[:, [0, 2]], axis=0).T)))])
idx = np.arange(N)
SMX = np.array([P[np.clip(idx + k, 0, N - 1), 0] for k in range(-12, 13)]).mean(0)
SMZ = np.array([P[np.clip(idx + k, 0, N - 1), 2] for k in range(-12, 13)]).mean(0)
TX = SMX[np.minimum(N - 1, idx + 6)] - SMX[np.maximum(0, idx - 6)]
TZ = SMZ[np.minimum(N - 1, idx + 6)] - SMZ[np.maximum(0, idx - 6)]
TL = np.hypot(TX, TZ) + 1e-9
TX, TZ = TX / TL, TZ / TL

# the app's pace cap (frames / s) per footage frame, as app.ts buildWalkCap
def walk_cap():
    q = np.array(cam["quat"]).reshape(-1, 4)
    fxq = -(2 * (q[:, 0] * q[:, 2] + q[:, 1] * q[:, 3])); fzq = -(1 - 2 * (q[:, 0] ** 2 + q[:, 1] ** 2))
    yaw = np.arctan2(fxq, fzq)
    raw = np.zeros(N)
    for i in range(N):
        a, b = max(0, i - 8), min(N - 1, i + 8)
        step = min(0.08, np.hypot(SMX[b] - SMX[a], SMZ[b] - SMZ[a]) / max(1, b - a))
        dy = (yaw[b] - yaw[a] + np.pi) % (2 * np.pi) - np.pi
        turn = abs(dy) / max(1, b - a)
        raw[i] = min(WALK_CAP_MS / max(0.004, step), PAN_CAP / max(1e-4, turn), MAX_FPS)
    cap = np.array([max(FPS * 0.8, raw[max(0, i - 20):i + 21:2].min()) for i in range(N)])
    return cap


CAP = walk_cap()
CONF = np.array(cam["conf"])
DARK_FROM = {"downstairs": 2930}.get(NAME)   # brain.ts darkZone: the lantern passage (approved from ~2930: the Terminal Row doorway)

SMP = nav["samples"]
NF = np.array([q["f"] for q in SMP])
LANE = np.array([q["lane"] for q in SMP], float)
FLOOR = np.array([q["floor_y"] for q in SMP], float)
DA = np.array([q.get("da", 0) for q in SMP], float)
DB = np.array([q.get("db", 0) for q in SMP], float)
DEP = np.load(ROOT / f"work/nav/{NAME}_depth_s5.npy")
MSK = np.load(ROOT / f"work/nav/{NAME}_mask_s5.npy")


def frame_at(s):
    return int(min(N - 1, np.searchsorted(S, s)))


def sample_i(f):
    return int(np.clip(np.searchsorted(NF, f), 0, len(NF) - 1))


def lane_at(s):
    f = frame_at(s)
    i = int(np.clip(np.searchsorted(NF, f), 1, len(NF) - 1))
    return max(LANE[i - 1, 0], LANE[i, 0]), min(LANE[i - 1, 1], LANE[i, 1])


def floor_at(s):
    return float(np.interp(frame_at(s), NF, FLOOR))


def project(f, X):
    pc = (X - P[f]) @ Rm[f]
    z = -pc[..., 2]
    zs = np.where(np.abs(z) < 1e-6, 1e-6, z)
    return CX + FX * pc[..., 0] / zs, CY - FY * pc[..., 1] / zs, z


# ---------------------------------------------------------------------------------------------- candidate grid
# The measured lane is narrowed by people as well as walls (nav_study counts a person standing there as not free).
# People are judged here per frame, so candidates extend up to EXT beyond the lane; those off-lane states must show
# floor in the footage at their feet and nothing nearer at body height in that very frame (strict depth test).
EXT = 1.5
gs, gl, gx, gz, gy, goff = [], [], [], [], [], []
S_GRID_END = S[min(N - 1, END + 300)]   # (candidates beyond the walk end too: the walked path continues past it)
for s in np.arange(0, S_GRID_END + 1e-6, GRID_S):
    lo, hi = lane_at(s)
    a, b = lo + WALL_CLEAR, hi - WALL_CLEAR
    lats = np.arange(np.ceil((a - EXT) / GRID) * GRID, b + EXT + 1e-6, GRID)
    f = frame_at(s)
    for lat in lats:
        gs.append(s); gl.append(lat); goff.append(not (a - 1e-6 <= lat <= b + 1e-6))
        gx.append(SMX[f] - TZ[f] * lat); gz.append(SMZ[f] + TX[f] * lat); gy.append(floor_at(s))
# Hand-placed spots (checked on the contact sheets): a floor pixel (u, v) of footage frame f_view, floor-rayed onto
# the floor under the visitor there, offered as an extra candidate during frames [f0, f1] only. They still pass every
# per-frame constraint (tiers); the off-lane floor test is skipped (placed by eye on visible floor).
HAND_SPOTS = {
    "upstairs": [
        # (tried: 3490 (0.38, 0.72) and (0.28, 0.80): every floor pixel there overlaps guests standing at her depth ("over"))
    ],
    "downstairs": [],
}


def floor_ray(f, u, v):
    pc = np.array([(u - CX) / FX, -(v - CY) / FY, -1.0])
    d = Rm[f] @ pc
    yf = float(np.interp(f, NF, FLOOR))
    t = (yf - P[f][1]) / d[1]
    return P[f] + d * t, yf


GWIN = [None] * len(gs)   # frame window per state (None = always)
for (fv, u, v, f0, f1, note) in HAND_SPOTS.get(NAME, []):
    X, yf = floor_ray(fv, u, v)
    d2 = (SMX - X[0]) ** 2 + (SMZ - X[2]) ** 2
    fi = int(np.argmin(d2))
    gs.append(S[fi]); gl.append(float(-TZ[fi] * (X[0] - SMX[fi]) + TX[fi] * (X[2] - SMZ[fi]))); goff.append(False)
    gx.append(float(X[0])); gz.append(float(X[2])); gy.append(yf); GWIN.append((f0, f1))
    print(f"  hand spot {note}: ({X[0]:.2f}, {yf:.2f}, {X[2]:.2f}) frames {f0}-{f1}")
GS, GL, GX, GZ, GY, GOFF = map(np.array, (gs, gl, gx, gz, gy, goff))
HAND = np.array([w is not None for w in GWIN])
HW0 = np.array([w[0] if w else -1 for w in GWIN]); HW1 = np.array([w[1] if w else 10 ** 9 for w in GWIN])
NSTATE = len(GS)
print(f"[{NAME}] {NSTATE} lane grid states over {S[END]:.1f} m of path; frames 0-{END}")

# (round 9) extra blockers measured by hand: the NOUSCON velvet rope and its stanchions (bases floor-projected at
# frames 900 / 931 / 960: (-0.1, -21.95) to (0.85, -22.05), the rope running on to the wall at about x -0.35)
EXTRA_BLOCKERS = {"downstairs": [{"x": x, "z": -22.0, "r": 0.3, "note": "NOUSCON velvet rope / stanchions"} for x in (-0.35, 0.0, 0.3, 0.6, 0.9)]}.get(NAME, [])

# static: blockers
ok_static = np.ones(NSTATE, bool)
for b in nav.get("blockers", []) + EXTRA_BLOCKERS:
    ok_static &= (GX - b["x"]) ** 2 + (GZ - b["z"]) ** 2 >= (b["r"] + 0.3) ** 2


def rail_ok(f):
    """Per frame: >= 0.6 m (drop) / 0.45 m from every active rail and on the walked side."""
    ok = np.ones(NSTATE, bool)
    for r in nav.get("rails", []):
        act = r.get("active") or [r["frames"][0] - 300, r["frames"][1] + 300]
        if not (act[0] <= f <= act[1]):
            continue
        ax, az, ux, uz = r["a"][0], r["a"][2], r["b"][0] - r["a"][0], r["b"][2] - r["a"][2]
        L2 = ux * ux + uz * uz or 1
        t = ((GX - ax) * ux + (GZ - az) * uz) / L2
        near = (t > -0.15) & (t < 1.15)
        sp = ux * (GZ - az) - uz * (GX - ax)
        fs = np.array([frame_at(s) for s in GS])
        sq = ux * (SMZ[fs] - az) - uz * (SMX[fs] - ax)
        dist = np.abs(sp) / np.sqrt(L2)
        clear = 0.6 if r.get("drop") else 0.45
        ok &= ~(near & ((dist < clear) | ((np.sign(sp) != np.sign(sq)) & (np.abs(sq) > 1e-6))))
    return ok


GFRAME = np.array([frame_at(s) for s in GS])


def glow_rects(f):
    out = []
    for st in stations:
        w0, w1 = st["visibility_window"]
        tr = st["screen_region_track"]
        i = f - tr["start"]
        if st.get("offscreen"):
            i = max(0, min(len(tr["polys"]) - 1, i))   # an edge beacon holds its last known spot (overlay.ts)
        if not (w0 - 2 <= f <= w1 + 2) or i < 0 or i >= len(tr["polys"]):
            continue
        p = np.array(tr["polys"][i]).reshape(-1, 2)
        # the live rect as overlay.ts makes it, in phone screen px (393 x 852): the glow's screen bbox, or, for an
        # off-camera station or a glow less than 85 % visible (rail 58 px, top 64, bottom 90 px), a 140 x 120 edge
        # beacon rect at the nearer side
        x = (p[:, 0] - U0) / VIS_W * SCR_W; y = (p[:, 1] - V0) / VIS_H * SCR_H
        x0, y0, x1, y1 = x.min(), y.min(), x.max(), y.max()
        vx1 = SCR_W - 58
        ia = max(0, min(x1, vx1) - max(x0, 0)) * max(0, min(y1, SCR_H - 90) - max(y0, 64))
        frac = ia / max(1e-6, (x1 - x0) * (y1 - y0))
        if st.get("offscreen") or frac < 0.85:
            left = st.get("offscreen") or (x0 + x1) / 2 < vx1 / 2
            ey = max(150, min(SCR_H - 200, (y0 + y1) / 2))
            x0, x1 = (0, 140) if left else (vx1 - 140, vx1)
            y0, y1 = ey - 60, ey + 60
        out.append((x0, y0, x1, y1))
    return out


def evaluate(t, back_m=0.0):
    """Hard-constraint mask (strict), relaxed mask and soft cost for every state at step t (frame 5t)."""
    f = min(END, t * STEP)
    if CONF[f] == 0 or (DARK_FROM and f >= DARK_FROM):
        # unsolved frame: nothing can be checked; any state near her lane ahead is acceptable (flag 16)
        sV = S[f]
        strict = np.zeros(NSTATE, bool); cost = np.full(NSTATE, np.inf)
        m = (GS > sV + 1.0) & (GS < sV + 5) & ok_static
        if not m.any():
            m = (GS > S[END] - 5) & ok_static
        cost[m] = 0.5
        return strict, m, cost, {"unsolved": True}
    si = sample_i(f)
    dep, msk = DEP[min(si, len(DEP) - 1)].astype(np.float32) / 255.0, MSK[min(si, len(MSK) - 1)].astype(np.float32) / 255.0
    da, db = DA[si], DB[si]
    sV = S[f]
    # (ahead of the visitor on the path; where the path runs out ahead (the camera stands at the end) the last few
    # metres of it, whichever are in view)
    near_end = (GS > S[END] - 5) & (GS < S_GRID_END + 1)
    win = ~HAND | ((HW0 <= f) & (f <= HW1))
    cand = np.where(((((GS > sV + 0.8 - back_m) | near_end) & (GS < sV + 10)) | HAND) & win & ok_static & rail_ok(f))[0]
    strict = np.zeros(NSTATE, bool); relaxed = np.zeros(NSTATE, bool); cost = np.full(NSTATE, np.inf)
    why = {}
    if not len(cand):
        return strict, relaxed, cost, why
    feet = np.stack([GX[cand], GY[cand], GZ[cand]], -1)
    head = feet + np.array([0, GUIDE_H, 0])
    uf, vf, zf = project(f, feet)
    uh, vh, zh = project(f, head)
    u158, v158, _ = project(f, feet + np.array([0, 1.58, 0]))   # (round 7) the head point QA tests (headScreen: 1.58-1.60 m above her feet)
    front = (zf > 0.8) & (zh > 0.8)
    if back_m > 0 and front.mean() < 0.02:
        # (round 7) the camera faces away from all of the walked floor (low-confidence solve before the upstairs seam):
        # nothing can be checked here, as an unsolved frame; the runtime carries her with the camera (flag 16)
        strict = np.zeros(NSTATE, bool); cost = np.full(NSTATE, np.inf)
        m = (GS > sV + 1.0) & (GS < sV + 5) & ok_static
        if not m.any():
            m = (GS > S[END] - 5) & ok_static
        cost[m] = 0.5
        return strict, m, cost, {"unsolved": True, "facing_away": True}
    # on the phone's screen (cover crop + overscan), as fractions of its width / height
    fy_s = (vf - V0) / VIS_H; hy_s = (vh - V0) / VIS_H
    h = fy_s - hy_s
    hw_img = BOX_HALF * (vf - vh) * (H_PX / W_PX)      # her box half-width in image-u units
    xs = (uf - U0) / VIS_W
    hws = hw_img / VIS_W
    bxa, bxb = xs - hws, xs + hws
    # fraction of her box outside the screen (right edge: the progress rail at 0.92)
    inx = np.clip(np.minimum(bxb, 0.92) - np.maximum(bxa, 0.0), 0, None) / np.maximum(1e-6, bxb - bxa)
    iny = np.clip(np.minimum(fy_s, 1.0) - np.maximum(hy_s, 0.0), 0, None) / np.maximum(1e-6, h)
    outside = 1 - inx * iny
    def margins(m):
        return (bxa >= m) & (bxb <= min(X_MAX, 0.92 - m + 0.06)) & (hy_s >= m) & (fy_s <= 1 - m)
    in0, in1 = margins(X_MIN), margins(0.03)
    # glow (live rects as overlay.ts makes them): cover fraction; her head never inside one
    glow_cov = np.zeros(len(cand)); head_in = np.zeros(len(cand), bool)
    bx0, bx1 = bxa * SCR_W, bxb * SCR_W
    by0, by1 = hy_s * SCR_H, fy_s * SCR_H
    hx = ((uh - U0) / VIS_W) * SCR_W
    for (r0, q0, r1, q1) in glow_rects(f):
        ox = np.clip(np.minimum(bx1, r1) - np.maximum(bx0, r0), 0, None)
        oy = np.clip(np.minimum(by1, q1) - np.maximum(by0, q0), 0, None)
        glow_cov = np.maximum(glow_cov, (ox * oy) / np.maximum(1e-9, (bx1 - bx0) * (by1 - by0)))
        y158 = ((v158 - V0) / VIS_H) * SCR_H; x158 = ((u158 - U0) / VIS_W) * SCR_W
        # (QA: head x0+10..x1-10, y0..y1, at the head point 1.58 m above her feet, exactly)
        head_in |= (x158 > r0 + 10 - GLOW_M) & (x158 < r1 - 10 + GLOW_M) & (y158 > q0 - GLOW_M) & (y158 < q1 + GLOW_M)
    # depth / people over her box: 5 columns x 10 rows
    cu = (np.linspace(-0.8, 0.8, 5)[None, :, None] * hw_img[:, None, None] + uf[:, None, None])
    cv = (vh[:, None, None] + (vf - vh)[:, None, None] * np.linspace(0.04, 0.98, 10)[None, None, :])
    cu, cv = np.broadcast_arrays(cu, cv)
    px = np.clip((cu * DW).astype(int), 0, DW - 1); py = np.clip((cv * DH).astype(int), 0, DH - 1)
    d = dep[py, px]; m = msk[py, px]
    zsc = 1.0 / np.maximum(0.05, da * d + db)
    zme = zf[:, None, None]
    person = m > 0.45
    # a person from 0.33 m nearer (the shader's 0.3 m person margin + its 0.06 ramp) to 0.25 m behind her: she would
    # be drawn OVER / INTO them (wrong occlusion) -- never; nearer than that the shader hides her behind them (correct)
    over = person & (zsc > zme - 0.33) & (zsc < zme + 0.25)
    behind = person & (zsc <= zme - 0.33)
    nper = ~person
    nsamp = 50.0
    over_f = over.sum((1, 2)) / nsamp
    behind_f = behind.sum((1, 2)) / nsamp
    torso = np.zeros_like(person); torso[:, :, 2:7] = True    # rows ~0.15-0.65 from the head down: torso
    tw = nper & torso
    wall_f = (tw & (zsc < zme * 0.68)).sum((1, 2)) / np.maximum(1, tw.sum((1, 2)))
    cut_f = (nper & (zsc < zme - 0.9)).sum((1, 2)) / nsamp
    feet_row = np.where(nper[:, :, -1], zsc[:, :, -1] / zme[:, :, 0], np.nan)
    with np.errstate(all="ignore"):
        feet_r = np.nanmedian(feet_row, axis=1)
    feet_ok = np.isnan(feet_r) | ((feet_r >= 0.62) & (feet_r <= 1.65))
    depth_ok = (wall_f <= 0.2) & feet_ok & (cut_f <= 0.2)
    wall_strict = (tw & (zsc < zme * 0.85)).sum((1, 2)) / np.maximum(1, tw.sum((1, 2)))
    off = GOFF[cand]
    depth_ok &= ~off | ((~np.isnan(feet_r)) & (feet_r >= 0.85) & (feet_r <= 1.2) & (wall_strict <= 0.1) & (cut_f <= 0.05))
    # NEVER (any tier): wrong occlusion / inside a person, walls, gone (< 60 % visible), size > 0.6, head in a glow
    cdist = np.hypot(GX[cand] - P[f, 0], GZ[cand] - P[f, 2])
    never_ok = front & depth_ok & (over_f <= 0.03) & (outside <= 0.3) & (h <= 0.6) & ~head_in & (cdist >= CD_NEVER)   # (gone = < 60 % visible; 0.3: margin for her arms beyond the planning box)
    t0 = never_ok & in0 & (h >= H_MIN) & (h <= H_MAX) & (glow_cov <= 0.25) & (behind_f <= 0.15) & (cdist >= CD_T0)
    t1 = never_ok & in1 & (h >= H_MIN) & (h <= H_T12) & (glow_cov <= 0.25) & (behind_f <= 0.5) & (cdist >= CD_T12)
    t2 = never_ok & (outside <= 0.25) & (h >= T2_HMIN) & (h <= H_T12) & (glow_cov <= 0.4) & (behind_f <= BEHIND_T2) & (cdist >= CD_T12)
    t3 = never_ok & (h >= 0.12)     # beyond tier 2 but inside every NEVER rule: only to keep her walkable (flagged)
    tier = np.where(t0, 0, np.where(t1, 1, np.where(t2, 2, np.where(t3, 3, 9))))
    if os.environ.get("DEBUG_HAND"):
        for k_ in np.where(HAND[cand])[0]:
            print(f"    [hand f{f}] front {front[k_]} depth {depth_ok[k_]} wall {wall_f[k_]:.2f} feet {feet_r[k_]:.2f} cut {cut_f[k_]:.2f} over {over_f[k_]:.2f} behind {behind_f[k_]:.2f} outside {outside[k_]:.2f} h {h[k_]:.2f} head_in {head_in[k_]} tier {tier[k_]}")
    # soft cost: a guide a few steps ahead -- height ~0.28-0.34 of the screen, feet in the lower middle (not at the bottom
    # edge), a third in from a side (clear of the right-hand rail)
    comp = (1.5 * np.minimum(np.abs(xs - 0.36), np.abs(xs - 0.62)) + 4.0 * np.maximum(0, np.abs(h - 0.31) - 0.03)
            + 1.0 * np.maximum(0, 0.66 - fy_s) + 4.0 * np.maximum(0, fy_s - 0.84))
    c = comp + 1.0 * behind_f + 0.8 * off + 3.0 * np.maximum(0, sV + 0.8 - GS[cand])   # (behind the visitor on the path: only where the camera looks back / aside)
    if any(a <= f <= b for a, b in PAN_LEAD_RANGES):
        for df in (15, 30):
            fF = min(END, f + df)
            uF, _, zF = project(fF, feet)
            xF = np.where(zF > 0.8, (uF - U0) / VIS_W, -1.0)
            c = c + PAN_LEAD_W * (np.maximum(0, 0.15 - xF) + np.maximum(0, xF - 0.85))
    strict[cand] = tier == 0
    relaxed[cand] = (tier >= 1) & (tier <= 3)
    cost[cand] = np.where(tier == 0, c, np.where(tier == 1, c + 30, np.where(tier == 2, c + 90, np.where(tier == 3, c + 250, np.inf))))
    TIER[t][cand] = tier
    why = {"t0": int(t0.sum()), "t1": int((t1 & ~t0).sum()), "t2": int((t2 & ~t1 & ~t0).sum()),
           "never_fail": {"front": int((~front).sum()), "depth": int((front & ~depth_ok).sum()), "over_person": int((front & (over_f > 0.03)).sum()),
                          "gone": int((front & (outside > 0.4)).sum()), "size>0.6": int((front & (h > 0.6)).sum()), "head_in_glow": int((front & head_in).sum())}}
    return strict, relaxed, cost, why


# ---------------------------------------------------------------------------------------------- DP
T = END // STEP + 1
TIER = [np.full(NSTATE, 9, np.int8) for _ in range(T)]
# real seconds per step at the fastest allowed playback, and her distance budget per step
DT_STEP = np.array([np.sum(1.0 / CAP[t * STEP:min(N, t * STEP + STEP)]) for t in range(T)])
V_TRACK = float(os.environ.get("V_TRACK", "1.9"))   # P itself moves at most this at the fastest playback: headroom to 2.3 for her to close errors
DMAX_T = V_TRACK * DT_STEP
DMAX = GRID + 1e-3
# neighbours within 3 x DMAX (beyond DMAX: a flagged hurry)
from scipy.spatial import cKDTree  # noqa: E402
tree = cKDTree(np.c_[GX, GZ])
print(f"  evaluating {T} steps ...", flush=True)
EV = [evaluate(t) for t in range(T)]
# (round 7) where nothing ahead on the path is in front of the camera at tier <= 2 (the camera turned aside / back),
# the floor of the path just walked (up to 4 m behind the visitor) is in view: she may stand there
for t in range(T):
    w_ = EV[t][3]
    if isinstance(w_, dict) and not w_.get("unsolved") and (w_.get("t0", 0) + w_.get("t1", 0) + w_.get("t2", 0)) == 0:
        TIER[t][:] = 9
        EV[t] = evaluate(t, back_m=4.8)
for _f in [int(x) for x in os.environ.get("DEBUG_STEPS", "").split(",") if x]:
    print(f"    [debug f{_f}]", EV[_f // STEP][3])
cost_prev = None
back = []
nostrict, norelax = [], []
for t in range(T):
    strict, relaxed, cst, why = EV[t]
    valid = np.where(np.isfinite(cst))[0]
    if not strict.any():
        nostrict.append(t)
    if not len(valid):
        norelax.append(t)
        # nothing in view at all: any state ahead on the lane (big cost) so the track stays continuous
        f = min(END, t * STEP)
        _, _, zz = project(f, np.stack([GX, GY, GZ], -1))
        valid = np.where((zz > 1.5) & (zz < 8) & ok_static)[0]
        if not len(valid):
            valid = np.array([int(np.argmin(np.abs(GS - S[f] - 2)))])
        cst = cst.copy(); cst[valid] = 100.0
    cur = {}
    if not cost_prev:
        for j in valid:
            cur[j] = (cst[j], -1)
    else:
        pidx = np.array(list(cost_prev.keys()))
        pc = np.array([cost_prev[k][0] for k in pidx])
        ptree = cKDTree(np.c_[GX[pidx], GZ[pidx]])
        for j in valid:
            nb = ptree.query_ball_point([GX[j], GZ[j]], max(GRID + 0.01, 2.5 * DMAX_T[t]))
            if not nb:
                # no reachable predecessor: cheapest predecessor anywhere (a jump; flagged)
                k = int(np.argmin(pc)); cur[j] = (pc[k] + cst[j] + 1e5, int(pidx[k])); continue
            nb = np.array(nb)
            pj = pidx[nb]
            dist = np.hypot(GX[pj] - GX[j], GZ[pj] - GZ[j])
            ds = GS[j] - GS[pj]
            tc = 0.4 * dist + 1.0 * np.maximum(0, -ds) + 0.8 * np.abs(GL[j] - GL[pj]) + 1.0 * (np.sign(GL[j]) != np.sign(GL[pj])) * (np.abs(GL[pj]) > 0.1)
            # her speed budget is hard: a step longer than she can walk at the fastest playback only as a flagged
            # last resort (a hop smaller than one grid cell across is tolerated: smoothing spreads it)
            lim = max(DMAX_T[t] * 1.1, 0.02)
            over = dist > np.maximum(lim, np.where(np.abs(GL[j] - GL[pj]) > 1e-6, 0.0, 0.0) + lim)
            lat_hop = (np.abs(GL[j] - GL[pj]) > 1e-6) & (np.abs(GS[j] - GS[pj]) < 1e-6) & (dist <= GRID + 1e-3)
            tc = tc + np.where(over, 2000.0 + 500.0 * (dist - lim), 0.0)   # (her 2.3 m/s is a NEVER rule)
            tot = pc[nb] + tc
            k = int(np.argmin(tot))
            cur[j] = (tot[k] + cst[j], int(pj[k]))
    back.append(cur)
    cost_prev = cur

# backtrack
# (the walk ends here and the visitor lingers on this view: she must end on a tier-0 spot if there is any)
end_t0 = [k for k in back[-1] if TIER[T - 1][k] == 0]
path = [min(end_t0 or back[-1], key=lambda k: back[-1][k][0])]
for t in range(T - 1, 0, -1):
    path.append(back[t][path[-1]][1])
path = path[::-1]

flags = []
for t, j in enumerate(path):
    strict, relaxed, cst, why = EV[t]
    unsolved = isinstance(why, dict) and why.get("unsolved")
    tj = int(TIER[t][j])
    fl = 16 if unsolved else (tj if tj <= 2 else 3)
    if t and not unsolved and np.hypot(GX[j] - GX[path[t - 1]], GZ[j] - GZ[path[t - 1]]) > max(DMAX_T[t] * 1.1, 0.02) * V_HER / V_TRACK + 1e-3:
        fl |= 4
    flags.append(fl)
flags = np.array(flags)


# smooth the solved track over 3 steps (spreads grid hops) and check her speed against the budget
PX, PY, PZ = GX[path].astype(float), GY[path].astype(float), GZ[path].astype(float)
k = np.array([1, 2, 3, 2, 1], float); k /= k.sum()
for A in (PX, PY, PZ):
    B = np.convolve(np.r_[A[:1], A[:1], A, A[-1:], A[-1:]], k, mode="valid")
    A[:] = B
# her speed at the fastest playback, over ~0.6 s of real time (distance over time, not mean of per-step rates)
D = np.r_[0, np.cumsum(np.hypot(np.diff(GX[path]), np.diff(GZ[path])))]  # (the solved grid track: the smoothing only rounds its corners)
TT = np.r_[0, np.cumsum(DT_STEP[1:])]
win = np.zeros(T)
for t in range(T):
    a = np.searchsorted(TT, TT[t] - 0.3); b = min(T - 1, np.searchsorted(TT, TT[t] + 0.3))
    win[t] = (D[b] - D[a]) / max(1e-3, TT[b] - TT[a])
print(f"  her speed at the pace cap's fastest playback: p95 {np.percentile(win, 95):.2f} m/s, max {win.max():.2f} m/s "
      f"(budget {V_HER}); steps over budget: {int((win > V_HER).sum())}")
rawd = np.r_[0, np.hypot(np.diff(GX[path]), np.diff(GZ[path]))]
print("  DT_STEP pct", np.percentile(DT_STEP, [1, 50, 99]).round(3), "raw step m pct", np.percentile(rawd, [50, 90, 99]).round(3), "raw speed pct", np.percentile(rawd[1:] / DT_STEP[1:], [50, 90, 95, 99]).round(2), "cam speed pct", np.percentile(np.diff(S[np.minimum(END, np.arange(T) * STEP)]) / DT_STEP[1:], [50, 95, 99]).round(2))
ratio = rawd / np.maximum(1e-6, DMAX_T * 1.1)
for t in np.argsort(-ratio)[:8]:
    print(f"    fast step t={t} f={t * STEP}: {rawd[t]:.3f} m vs limit {DMAX_T[t] * 1.1:.3f} (dt {DT_STEP[t]:.3f} s), tier {flags[t] & 3}, prev tier {flags[max(0, t - 1)] & 3}, unsolved {bool(flags[t] & 16)}")
flags = np.where((win > V_HER) & ((flags & 16) == 0), flags | 8, flags)


def ranges(mask):
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j + 1 < len(mask) and mask[j + 1]:
                j += 1
            out.append([int(i * STEP), int(min(END, j * STEP))])
            i = j + 1
        else:
            i += 1
    return out


bad = ((flags & 3) == 3) | ((flags & 12) != 0)   # beyond tier 2, a jump, or over her speed budget
for hj in np.where(HAND)[0]:
    print(f"  hand spot state {hj}: tiers per step in its window:", [(int(t * STEP), int(TIER[t][hj])) for t in range(max(0, HW0[hj] // STEP), min(T, HW1[hj] // STEP + 1))])
print(f"  steps with no candidate meeting every hard constraint: {len(nostrict)}; no candidate at all: {len(norelax)}")
solved = (flags & 16) == 0
nsol = max(1, int(solved.sum()))
print(f"  frames per tier (solved steps {nsol}): tier0 {100 * ((flags & 3) == 0)[solved].mean():.1f}%, tier1 {100 * ((flags & 3) == 1)[solved].mean():.1f}%, "
      f"tier2 {100 * ((flags & 3) == 2)[solved].mean():.1f}%, beyond tier 2 {int(((flags & 3) == 3)[solved].sum())} steps; jumps {int(((flags & 4) > 0).sum())}, over speed budget {int(((flags & 8) > 0).sum())}")
print(f"  solved track violations: {int(bad.sum())} of {T} steps")
print(f"  violated frame ranges: {ranges(bad)}")
# reasons in the violated ranges
for a, b in ranges(bad)[:40]:
    ts_ = range(a // STEP, b // STEP + 1)
    nst = [int(EV[t][0].sum()) for t in ts_]
    mo = {}
    for t in ts_:
        for k_, v_ in (EV[t][3].get("miss_only") or {}).items():
            mo[k_] = mo.get(k_, 0) + v_
    fl_ = [int(flags[t]) for t in ts_]
    print(f"    {a}-{b}: strict candidates per step min {min(nst)} median {int(np.median(nst))}; flags {sorted(set(fl_))}; "
          f"candidates failing only one constraint (summed): {mo}")

out = {"floor": NAME, "step": STEP, "fps": FPS, "end": END, "v_her": V_HER, "walk_cap_ms": WALK_CAP_MS, "blockers": EXTRA_BLOCKERS,
       "P": [[round(float(x), 3), round(float(y), 3), round(float(z), 3), int(fl)] for x, y, z, fl in zip(PX, PY, PZ, flags)],
       "violations": ranges(bad),
       "note": "P[i] = her floor position at footage frame i*step (x, floor y, z, flag: 0 ok, 1 relaxed constraints, "
               "2 nothing valid, +4 a jump, +8 over her 2.3 m/s budget at the fastest playback). Solved offline by "
               "pipeline/blocking.py (docs/NAV.md)."}
json.dump(out, open(ROOT / f"app/public/data/blocking_{NAME}.json", "w"))
print(f"  wrote app/public/data/blocking_{NAME}.json")

# ---------------------------------------------------------------------------------------------- contact sheet
if SHEET:
    def color_frame(f):
        seg, k = divmod(f, meta["segment_frames"])
        src = ROOT / f"app/public/media/walk/{NAME}/sd_{seg:02d}.mp4"
        r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"select=eq(n\\,{k})", "-vsync", "0",
                            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
        return np.frombuffer(r.stdout, np.uint8).reshape(1280, 1080, 3)[:, :720].copy()

    every = int(os.environ.get("SHEET_EVERY", "20"))
    tiles = []
    if "--ranges" in sys.argv:
        # only the violated ranges (and 10 frames either side), every 10 frames: for the per-range verdicts
        fr_list = sorted({min(END, max(0, f)) for a, b in ranges(bad) for f in range(a - 10, b + 11, 10)})
        tag = "ranges"
    else:
        fr_list = list(range(0, END + 1, every))
        tag = ""
    for f in fr_list:
        t = f // STEP
        j = path[t]
        X = np.array([PX[t], PY[t], PZ[t]])
        u, v, z = project(f, X); uh, vh, _ = project(f, X + [0, GUIDE_H, 0])
        img = color_frame(f)
        h = v - vh; hw = BOX_HALF * h * (H_PX / W_PX)
        tr_ = flags[t] & 3
        col = [(0, 220, 0), (0, 220, 220), (0, 140, 255), (0, 0, 255)][tr_]
        if flags[t] & 16:
            col = (200, 200, 200)
        cv2.rectangle(img, (int((u - hw) * 720), int(vh * 1280)), (int((u + hw) * 720), int(v * 1280)), col, 5)
        x0, x1 = int(U0 * 720), int((U0 + VIS_W) * 720)
        y0, y1 = int(V0 * 1280), int((V0 + VIS_H) * 1280)
        cv2.rectangle(img, (x0, y0), (x1, y1), (255, 255, 255), 2)   # the phone's visible crop
        cv2.putText(img, f"{f} t{tr_}" + ("j" if flags[t] & 4 else "") + ("v" if flags[t] & 8 else ""), (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (255, 255, 255), 4)
        tiles.append(cv2.resize(img, (144, 256)))
    per = 12
    rows = [np.hstack(tiles[i:i + per] + [np.zeros_like(tiles[0])] * (per - len(tiles[i:i + per]))) for i in range(0, len(tiles), per)]
    for k in range(0, len(rows), 6):
        cv2.imwrite(str(OUT / f"blocking_{NAME}{tag}_{k // 6:02d}.jpg"), np.vstack(rows[k:k + 6]), [cv2.IMWRITE_JPEG_QUALITY, 80])
    print(f"  contact sheets: {OUT}/blocking_{NAME}_*.jpg")
