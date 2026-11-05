"""Navigation map for the guide: where a person would walk beside the visitor, measured from the footage.

For each floor this writes app/public/data/nav_<floor>.json (schema in docs/NAV.md):
  samples  every STEP footage frames: path distance s (same definition as brain.ts S), corrected floor height,
           free lateral lane [latMin, latMax] and the preferred lateral offset for walking alongside, stairs flags
  steps    individual stair treads (front edge, height) on detected flights
  rails    world-space top-of-rail segments at hand height (balustrades / parapets you could rest a hand on)
  blockers static obstacles near the walked line (benches, cubes, plinths, columns)

Method (details and validation in docs/NAV.md):
 1. Camera height. The solve assumes the phone is 1.40 m above the floor. Checked independently of depth: for
    frames with >=2 isolated standing people (SegFormer mask) at different distances, the image rows of their feet
    and head-tops give the horizon row and camera height / person height (pure image geometry). Result: ~1.4 m for
    1.70 m people, and the horizon matches the track's pitch. The monocular depth, calibrated against the solve's
    feature points, puts the floor only ~0.9-1.1 m below the camera (near-floor depth ~30 % short), so it is NOT
    used for absolute heights.
 2. Floor: y_cam (lightly smoothed) - 1.40. On stairs the phone is held ~0.3 m in front of the feet, so the floor
    under the camera is camY(s + 0.3) - 1.40. Stair treads are found from image + depth edge evidence accumulated
    along the path (nosing lattice) and floor_y is quantised to treads.
 3. Depth is re-calibrated per frame against the floor itself: 1/z = a*d + b is refit so the walked floor 1-6 m
    ahead (known from step 2) lands on the observed disparity. Residuals ~1 % on flat floors. This calibrated depth
    is then used for lanes (is the floor at lateral offset x visible at the right depth, nothing solid at body
    height, no drop, no person), rails (surface tops at 0.7-1.25 m with open space above) and blockers (solid
    occupancy near the path).

  python pipeline/nav_study.py <downstairs|upstairs> [--validate]

Validation images go to /private/tmp/claude-501/nav/ (override with NAV_OUT).
"""
import json
import os
import pathlib
import subprocess
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d, median_filter, gaussian_filter
from scipy.spatial.transform import Rotation as Rot

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = sys.argv[1]
VALIDATE = "--validate" in sys.argv
OUT = pathlib.Path(os.environ.get("NAV_OUT", "/private/tmp/claude-501/nav"))
OUT.mkdir(parents=True, exist_ok=True)
CACHE = ROOT / "work/nav"
CACHE.mkdir(parents=True, exist_ok=True)
STEP = 5                 # nav sample spacing (footage frames); depth is analysed on the same frames
CAM_H = 1.40             # camera height above the floor under the visitor's feet (validated, see people_check)
PHONE_AHEAD = 0.30       # phone held this far in front of the feet (matters on stairs only)
DW, DH = 360, 640        # depth / mask resolution (work/depth)

cam = json.load(open(ROOT / f"app/public/data/camera_{NAME}.json"))
meta = json.load(open(ROOT / f"app/public/media/walk/{NAME}/meta.json"))
beats = json.load(open(ROOT / f"app/public/data/beats_{NAME}.json"))
N = cam["frames"]
FPS = meta["fps"]
P = np.array(cam["pos"]).reshape(-1, 3)
Rm = Rot.from_quat(np.array(cam["quat"]).reshape(-1, 4)).as_matrix()  # three.js camera -> world
I = cam["intrinsics"]
FX, FY, CX, CY = I["fx"], I["fy"], I["cx"], I["cy"]
DA, DB = np.array(cam["depth_a"]), np.array(cam["depth_b"])
CONF = np.array(cam["conf"])

# ---- path distance exactly like brain.ts (cumulative xz, 0.08 m cap per frame) and its smoothed lane path
S = np.concatenate([[0], np.cumsum(np.minimum(0.08, np.hypot(*np.diff(P[:, [0, 2]], axis=0).T)))])
idx = np.arange(N)
SMX = np.array([P[np.clip(idx + k, 0, N - 1), 0] for k in range(-12, 13)]).mean(0)  # brain smX (box +-12)
SMZ = np.array([P[np.clip(idx + k, 0, N - 1), 2] for k in range(-12, 13)]).mean(0)
TX = SMX[np.minimum(N - 1, idx + 6)] - SMX[np.maximum(0, idx - 6)]
TZ = SMZ[np.minimum(N - 1, idx + 6)] - SMZ[np.maximum(0, idx - 6)]
TL = np.hypot(TX, TZ) + 1e-9
TX, TZ = TX / TL, TZ / TL          # walking tangent; right = (-TZ, TX), as brain.lanePoint


def frame_at(s):
    return int(min(N - 1, np.searchsorted(S, s)))


def chapter_at(f):
    t = f / FPS
    for ch in beats["chapters"]:
        if ch["start"] <= t < ch["end"]:
            return ch["id"]
    return beats["chapters"][-1]["id"]


def beat_at(f):
    t = f / FPS
    b = [x for x in beats["beats"] if x["t"] <= t + 0.5]
    return b[-1]["visible"] if b else ""


# ---------------------------------------------------------------------------------------------- footage
def decode_gray(kind):
    """Depth / mask every STEP frames, decoded with OpenCV exactly as build_camera.py did for the depth fit."""
    p = CACHE / f"{NAME}_{kind}_s{STEP}.npy"
    if p.exists():
        return np.load(p)
    cap = cv2.VideoCapture(str(ROOT / f"work/depth/{NAME}_{kind}.mp4"))
    out, i = [], 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if i % STEP == 0:
            out.append(fr[:, :, 0].copy())
        i += 1
    a = np.stack(out)
    np.save(p, a)
    return a


def color_frame(f, w=720):
    """Colour frame f from the packed walk segment (ffmpeg honours BT.709; OpenCV would not)."""
    seg, k = divmod(f, meta["segment_frames"])
    src = ROOT / f"app/public/media/walk/{NAME}/sd_{seg:02d}.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf", f"select=eq(n\\,{k})", "-vsync", "0",
                        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
    a = np.frombuffer(r.stdout, np.uint8).reshape(1280, 1080, 3)[:, :720].copy()
    return a if w == 720 else cv2.resize(a, (w, int(w * 16 / 9)))


DEP = decode_gray("depth")
MSK = decode_gray("mask")
NS = len(DEP)
SF = np.arange(NS) * STEP  # sampled frames


def project(f, X):
    pc = (X - P[f]) @ Rm[f]
    z = -pc[..., 2]
    zs = np.where(np.abs(z) < 1e-6, 1e-6, z)
    return CX + FX * pc[..., 0] / zs, CY - FY * pc[..., 1] / zs, z


def unproject(f, u, v, z):
    pc = np.stack([(u - CX) / FX * z, -(v - CY) / FY * z, -z], -1)
    return pc @ Rm[f].T + P[f]


def sample_img(img, u, v, r=1, red=np.median):
    px = np.clip((u * DW).astype(int), 0, DW - 1)
    py = np.clip((v * DH).astype(int), 0, DH - 1)
    if r == 0:
        return img[py, px]
    return np.array([red(img[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]) for x, y in zip(px, py)])


# ---------------------------------------------------------------------------------------------- 1. camera height
def people_check():
    """Camera height from standing people: feet row vf, head row vh, horizon v0: vf - v0 = (h / H_person)(vf - vh)."""
    ks, dv = [], []
    for i in range(NS):
        f = SF[i]
        M = (MSK[i] > 140).astype(np.uint8)
        n, _, st, _ = cv2.connectedComponentsWithStats(M)
        bl = []
        for j in range(1, n):
            x, y, w, h, a = st[j]
            if a < 300 or y <= 2 or y + h >= DH - 3 or x <= 1 or x + w >= DW - 1:
                continue
            if not (2.0 < h / w < 5.5) or a / (w * h) < 0.35:
                continue
            bl.append(((y + h) / DH, y / DH))
        if len(bl) < 2:
            continue
        bl = np.array(bl)
        if np.ptp(bl[:, 0]) < 0.06:
            continue
        A = np.c_[np.ones(len(bl)), bl[:, 0] - bl[:, 1]]
        v0, k = np.linalg.lstsq(A, bl[:, 0], rcond=None)[0]
        if not (0.3 < k < 1.3):
            continue
        fw = -Rm[f][:, 2].copy(); fw[1] = 0; fw /= np.linalg.norm(fw)
        dc = Rm[f].T @ fw
        ks.append(k)
        dv.append(v0 - (CY - FY * dc[1] / (-dc[2])))
    ks, dv = np.array(ks), np.array(dv)
    return {"frames_used": int(len(ks)), "camera_height_for_1p70m_people": round(float(1.70 * np.median(ks)), 3),
            "iqr": [round(float(1.7 * np.percentile(ks, 25)), 3), round(float(1.7 * np.percentile(ks, 75)), 3)],
            "horizon_image_minus_track_v": round(float(np.median(dv)), 4)}


def depth_plane_heights():
    """Camera height implied by a RANSAC ground plane in the original depth calibration (for the report)."""
    rng = np.random.default_rng(0)
    hs = []
    for i in range(0, NS, 3):
        f = SF[i]
        vv, uu = np.mgrid[DH // 2:DH:4, 2:DW:4]
        d = DEP[i][vv, uu] / 255.0
        m = MSK[i][vv, uu]
        z = 1 / np.maximum(0.05, DA[f] * d + DB[f])
        X = unproject(f, (uu + 0.5) / DW, (vv + 0.5) / DH, z)
        X = X[(m < 80) & (z < 5)]
        if len(X) < 50:
            continue
        best = None
        for _ in range(120):
            s3 = X[rng.choice(len(X), 3, replace=False)]
            nrm = np.cross(s3[1] - s3[0], s3[2] - s3[0])
            if np.linalg.norm(nrm) < 1e-9:
                continue
            nrm /= np.linalg.norm(nrm)
            nrm = nrm if nrm[1] > 0 else -nrm
            if nrm[1] < 0.8:
                continue
            dd = -nrm @ s3[0]
            k = (np.abs(X @ nrm + dd) < 0.04).sum()
            if best is None or k > best[0]:
                best = (k, nrm, dd)
        if best:
            hs.append(best[1] @ P[f] + best[2])
    return float(np.median(hs))


# ---------------------------------------------------------------------------------------------- 2. floor
def find_floor():
    ys = gaussian_filter1d(P[:, 1], 4, mode="nearest")
    # seams: pose jumps between solve fragments (the floor under the camera jumps with them)
    # (vertical speed > ~0.5 m/s over half a second; real stair climbing here is ~0.15 m/s)
    vz = np.abs(ys[np.minimum(N - 1, idx + 8)] - ys[np.maximum(0, idx - 8)])
    seams, f = [], 0
    while f < N:
        if vz[f] > 0.25:
            g = f
            while g + 1 < N and vz[g + 1] > 0.25:
                g += 1
            seams.append(int(f + np.argmax(vz[f:g + 1])))
            f = g + 1
        else:
            f += 1
    conf_edges = [int(f) for f in np.where(np.diff(CONF) != 0)[0]]
    # stairs: sustained slope of camera height over path distance on a reliable solve
    slope = np.zeros(N)
    for f in range(N):
        a, b = frame_at(S[f] - 0.6), frame_at(S[f] + 0.6)
        slope[f] = (ys[b] - ys[a]) / max(0.3, S[b] - S[a])
    steep = (np.abs(slope) > 0.2) & (CONF >= 1.0)
    for sm in seams:
        steep[max(0, sm - 60):sm + 60] = False
    runs, f = [], 0
    while f < N:
        if steep[f]:
            g = f
            while g + 1 < N and steep[g + 1]:
                g += 1
            if S[g] - S[f] >= 1.0:
                runs.append([f, g])
            f = g + 1
        else:
            f += 1
    # merge flights separated by a short landing (< 2.2 m) into one stair zone; keep flights for treads
    zones = []
    for r in runs:
        if zones and S[r[0]] - S[zones[-1][-1][1]] < 2.2 and np.sign(slope[r[0]]) == np.sign(slope[zones[-1][-1][0]]):
            zones[-1].append(r)
        else:
            zones.append([r])
    # floor under the camera: on stairs the feet are PHONE_AHEAD behind the phone
    stairw = np.zeros(N)
    for z in zones:
        for a, b in z:
            stairw[a:b + 1] = 1
    stairw = np.clip(gaussian_filter1d(stairw, 8), 0, 1)
    shifted = np.interp(np.minimum(S[-1], S + PHONE_AHEAD), S, ys)
    floor = (1 - stairw) * ys + stairw * shifted - CAM_H
    return ys, floor, slope, zones, seams, conf_edges


def find_treads(floor, zones):
    """Nosing lattice per flight from edge evidence (image luminance + depth) accumulated along the path."""
    steps = []
    if not zones:
        return steps, floor
    out = floor.copy()
    for zone in zones:
        for a, b in zone:
            s0, s1 = S[a] - 0.4, S[b] + 0.4
            sg = np.arange(s0, s1, 0.01)
            X = np.stack([np.interp(sg, S, SMX), np.interp(sg, S, floor) + 0.06, np.interp(sg, S, SMZ)], 1)
            E = np.zeros_like(sg); Nn = np.zeros_like(sg)
            fa, fb = frame_at(max(0, s0 - 4.0)), frame_at(s1)
            for f in range(fa - fa % STEP, fb + 1, STEP):
                i = f // STEP
                if i >= NS:
                    break
                g = color_frame(f, 360)
                g = gaussian_filter(cv2.cvtColor(g, cv2.COLOR_BGR2GRAY).astype(np.float32), 1.0)
                band = g[:, int(0.42 * DW):int(0.58 * DW)].mean(1)
                gy = np.abs(np.gradient(band)); gy /= np.percentile(gy, 95) + 1e-3
                db = gaussian_filter(DEP[i].astype(np.float32), 1.0)[:, int(0.42 * DW):int(0.58 * DW)].mean(1)
                gd = np.abs(np.gradient(db)); gd /= np.percentile(gd, 95) + 1e-3
                u, v, z = project(f, X)
                ds = sg - S[f]
                ok = (ds > 0.8) & (ds < 4.0) & (z > 0.3) & (v > 0.02) & (v < 0.98) & (np.abs(u - 0.5) < 0.15)
                rows = (v[ok] * DH).astype(int)
                E[ok] += gy[rows] + gd[rows]
                Nn[ok] += 1
            E = E / np.maximum(Nn, 1)
            E = E - median_filter(E, 41)
            # best lattice: period T in 0.22..0.40, phase by correlation with a comb
            best = None
            for T in np.arange(0.22, 0.40, 0.005):
                for ph in np.arange(0, T, 0.01):
                    ks = np.arange(sg[0] + ph, sg[-1], T)
                    sc = np.interp(ks, sg, E).mean()
                    if best is None or sc > best[0]:
                        best = (sc, T, ph)
            _, T, ph = best
            nos = np.arange(sg[0] + ph, sg[-1], T)
            nos = nos[(nos >= S[a] - 0.15) & (nos <= S[b] + 0.15)]
            if len(nos) < 3:
                continue
            # tread heights: regular risers fitted to the floor at tread centres
            mid = nos[:-1] + T / 2
            ym = np.interp(mid, S, floor)
            k = np.arange(len(mid))
            r, y0 = np.polyfit(k, ym, 1)
            sign = 1 if r > 0 else -1
            for j in range(len(mid)):
                yy = y0 + r * j
                fs = frame_at(nos[j])
                steps.append({"s": [round(float(nos[j]), 3), round(float(nos[j + 1]), 3)], "y": round(float(yy), 3),
                              "front": [round(float(np.interp(nos[j], S, SMX)), 3), round(float(yy), 3),
                                        round(float(np.interp(nos[j], S, SMZ)), 3)], "dir": sign, "f": fs})
                m = (S >= nos[j]) & (S < nos[j + 1])
                out[m] = yy
            print(f"  flight frames {a}-{b}: {len(mid)} treads, going {T:.3f} m, riser {abs(r):.3f} m, "
                  f"comb score {best[0]:.3f}")
    return steps, out


# ---------------------------------------------------------------------------------------------- 3. depth recalibration
def recalibrate(floor):
    """Per sampled frame refit 1/z = a*d + b so the walked floor 1-6 m ahead sits on the observed disparity."""
    A2 = np.full(NS, np.nan); B2 = np.full(NS, np.nan); RES = np.full(NS, np.nan)
    for i in range(NS):
        f = SF[i]
        lo, hi = frame_at(S[f] + 1.0), frame_at(S[f] + 6.0)
        ts, last = [], -1
        for t in range(lo, hi):
            if S[t] - last >= 0.2:
                ts.append(t); last = S[t]
        if len(ts) < 4:
            continue
        ts = np.array(ts)
        Q = np.concatenate([np.stack([SMX[ts] - TZ[ts] * l, floor[ts], SMZ[ts] + TX[ts] * l], 1) for l in (-0.3, 0, 0.3)])
        u, v, z = project(f, Q)
        ok = (z > 0.5) & (u > 0.02) & (u < 0.98) & (v > 0.02) & (v < 0.98)
        u, v, z = u[ok], v[ok], z[ok]
        if len(z) < 6:
            continue
        m = sample_img(MSK[i], u, v, 3, np.max)
        d = sample_img(DEP[i], u, v, 1) / 255.0
        sel = (m < 60) & (d < 0.995) & (d > 0.01)
        d, z = d[sel], z[sel]
        if len(d) < 8 or np.ptp(d) < 0.05:
            continue
        inv = 1 / z
        A = np.c_[d, np.ones_like(d)]
        w = np.ones_like(d)
        for _ in range(8):
            sol = np.linalg.lstsq(A * w[:, None], inv * w, rcond=None)[0]
            r = (A @ sol - inv) / inv
            s = 1.4826 * np.median(np.abs(r)) + 1e-3
            w = np.sqrt(np.clip(1.5 * s / np.maximum(np.abs(r), 1e-6), 0, 1))
        if sol[0] <= 0:
            continue
        A2[i], B2[i] = sol
        RES[i] = np.median(np.abs(A @ sol - inv) / inv)
    good = ~np.isnan(A2) & (RES < 0.08)
    # fill: neighbours (scale ratio to the original fit), then smooth
    ratio_a = np.where(good, A2 / DA[SF], np.nan)
    ratio_b = np.where(good, B2 / np.maximum(1e-4, DB[SF]), np.nan)
    gi = np.where(good)[0]
    ra = np.interp(np.arange(NS), gi, ratio_a[gi]) if len(gi) else np.ones(NS)
    rb = np.interp(np.arange(NS), gi, ratio_b[gi]) if len(gi) else np.ones(NS)
    ra = gaussian_filter1d(ra, 1.5); rb = gaussian_filter1d(rb, 1.5)
    a2 = np.where(good, A2, DA[SF] * ra)
    b2 = np.where(good, B2, DB[SF] * rb)
    return a2, b2, RES, good


# ---------------------------------------------------------------------------------------------- 4. lanes
LATS = np.round(np.arange(-3.0, 3.01, 0.1), 2)


def lane_status(floor, a2, b2, stairs):
    """free score per (sample, lateral offset) and people hits, from frames 1.8-4.2 m behind each sample."""
    free = np.full((NS, len(LATS)), np.nan)
    pers = np.zeros((NS, len(LATS)))
    for i in range(NS):
        t = SF[i]
        votes = np.zeros(len(LATS)); cnt = np.zeros(len(LATS)); pv = np.zeros(len(LATS))
        fa, fb = frame_at(S[t] - 4.2), frame_at(S[t] - 1.2)
        views = [f for f in range(fa - fa % STEP, fb + 1, STEP) if S[t] - S[f] >= 1.2 and CONF[f] > 0]
        for f in views[:: max(1, len(views) // 6)]:
            j = f // STEP
            if j >= NS:
                continue
            base = np.stack([SMX[t] - TZ[t] * LATS, np.full(len(LATS), floor[t]), SMZ[t] + TX[t] * LATS], 1)
            u, v, z = project(f, base + [0, 0.03, 0])
            vis = (z > 0.5) & (u > 0.01) & (u < 0.99) & (v > 0.01) & (v < 0.985)
            if not vis.any():
                continue
            dimg = DEP[j].astype(np.float32) / 255.0
            dobs = sample_img(dimg, np.clip(u, 0, 0.999), np.clip(v, 0, 0.999), 1)
            zobs = 1 / np.maximum(0.03, a2[j] * dobs + b2[j])
            ok_floor = np.abs(zobs - z) < 0.14 * z + 0.08
            front = zobs < z * 0.86 - 0.08
            drop = (zobs > z * 1.35 + 0.3) & (not stairs[t])
            blocked = front | drop
            person = np.zeros(len(LATS), bool)
            for hy in (0.5, 1.0, 1.45):
                ub, vb, zb = project(f, base + [0, hy, 0])
                okb = (zb > 0.5) & (ub > 0.0) & (ub < 1) & (vb > 0) & (vb < 1)
                db_ = sample_img(dimg, np.clip(ub, 0, 0.999), np.clip(vb, 0, 0.999), 1)
                zo = 1 / np.maximum(0.03, a2[j] * db_ + b2[j])
                mm = sample_img(MSK[j], np.clip(ub, 0, 0.999), np.clip(vb, 0, 0.999), 1) > 115
                person |= okb & mm & (np.abs(zo - zb) < 1.0)
                blocked |= okb & ~mm & (zo < zb - 0.35) & (zo > zb * 0.55)  # solid at/just before the spot
            st = vis & ~person
            votes[st] += (ok_floor & ~blocked)[st] * 1.0 + (~ok_floor & ~blocked)[st] * 0.5
            cnt[st] += 1
            pv[vis & person] += 1
            cnt[vis & person] += 1
        with np.errstate(invalid="ignore"):
            free[i] = np.where(cnt > 0, votes / np.maximum(cnt, 1), np.nan)
        pers[i] = np.where(cnt > 0, pv / np.maximum(cnt, 1), 0)
    return free, pers


def lanes_from(free, pers, stairs):
    lane = np.zeros((NS, 2))
    c0 = int(np.where(LATS == 0)[0][0])
    fr = free.copy()
    # samples nobody looked at (start of the walk, sharp turns): borrow the nearest sample that was seen
    seen = ~np.all(np.isnan(fr), axis=1)
    si = np.where(seen)[0]
    for i in np.where(~seen)[0]:
        if len(si):
            fr[i] = fr[si[np.argmin(np.abs(si - i))]]
    fr = np.where(np.isnan(fr), 0.45, fr)              # offsets outside every view: not counted as free
    fr = median_filter(fr, size=(3, 1), mode="nearest")
    ok = (fr >= 0.5) & (pers < 0.5)
    ok[:, c0 - 2:c0 + 3] = True                         # the walked line itself (+-0.2 m) is floor by definition
    for i in range(NS):
        l = c0
        while l - 1 >= 0 and ok[i, l - 1]:
            l -= 1
        r = c0
        while r + 1 < len(LATS) and ok[i, r + 1]:
            r += 1
        lane[i] = [LATS[l], LATS[r]]
    lane[:, 0] = median_filter(lane[:, 0], 5, mode="nearest")
    lane[:, 1] = median_filter(lane[:, 1], 5, mode="nearest")
    lane[:, 0] = np.minimum(lane[:, 0], -0.2)
    lane[:, 1] = np.maximum(lane[:, 1], 0.2)
    return lane, fr


def prefer_from(lane, fr, pers, rail_side):
    """Viterbi over samples: alongside the visitor (|lat| ~0.6), clear of edges, open side, few side switches."""
    cand = np.round(np.concatenate([np.arange(-1.0, -0.29, 0.1), np.arange(0.3, 1.01, 0.1)]), 2)
    ci = [int(np.argmin(np.abs(LATS - c))) for c in cand]
    cost = np.zeros((NS, len(cand)))
    for i in range(NS):
        lo, hi = lane[i]
        for k, c in enumerate(cand):
            clear = min(c - lo, hi - c)
            room = (hi if c > 0 else -lo)
            sc = 0.0
            sc += 3.0 * max(0, 0.4 - clear)                 # body + elbow room to wall / rail / furniture
            sc += 0.6 * abs(abs(c) - 0.6)                   # beside the visitor, not in front, not far off
            sc -= 0.25 * min(2.0, room)                     # the open side
            sc += 1.5 * pers[i, ci[k]] + 0.8 * (1 - fr[i, ci[k]])
            if rail_side[i] != 0:                           # a holdable rail: walk on its side, within reach
                sc += 0.5 if np.sign(c) != rail_side[i] else -0.3
            cost[i, k] = sc
    sw = np.abs(cand[:, None] - cand[None, :]) * 0.5 + (np.sign(cand[:, None]) != np.sign(cand[None, :])) * 1.2
    D = cost[0].copy(); bp = np.zeros((NS, len(cand)), int)
    for i in range(1, NS):
        tot = D[:, None] + sw
        bp[i] = tot.argmin(0)
        D = tot.min(0) + cost[i]
    path = [int(D.argmin())]
    for i in range(NS - 1, 0, -1):
        path.append(bp[i][path[-1]])
    pref = cand[np.array(path[::-1])]
    return np.round(gaussian_filter1d(pref.astype(float), 1.0), 2)


# ---------------------------------------------------------------------------------------------- 5. rails & blockers
def local_frame(X, f, floor):
    """path distance s, lateral offset and height above floor for world points X seen from frame f."""
    lo, hi = frame_at(S[f] - 1.0), frame_at(S[f] + 7.0)
    ii = np.arange(lo, hi + 1, 2)
    d2 = (X[:, None, 0] - SMX[ii][None]) ** 2 + (X[:, None, 2] - SMZ[ii][None]) ** 2
    j = ii[d2.argmin(1)]
    dx, dz = X[:, 0] - SMX[j], X[:, 2] - SMZ[j]
    lat = -TZ[j] * dx + TX[j] * dz
    along = TX[j] * dx + TZ[j] * dz
    return j, lat, X[:, 1] - floor[j], np.abs(along) < 0.5


def rails_and_blockers(floor, a2, b2):
    cands = []      # rail-top candidates: x, y, z, j(path frame), lat, h, f
    occ = {}        # (cx, cz) -> [solid, floor, sum h, n]
    G = 0.15
    for i in range(NS):
        f = SF[i]
        if CONF[f] == 0:
            continue
        D = DEP[i].astype(np.float32) / 255.0
        M = MSK[i]
        vv, uu = np.mgrid[1:DH:3, 1:DW:3]
        u, v = (uu + 0.5) / DW, (vv + 0.5) / DH
        z = 1 / np.maximum(0.03, a2[i] * D[vv, uu] + b2[i])
        X = unproject(f, u, v, z)
        Md = cv2.dilate((M > 50).astype(np.uint8), np.ones((15, 15), np.uint8))  # people + a margin (mask misses limbs)
        keep = (z < 5.5) & (Md[vv, uu] == 0)
        # rail tops: a point whose neighbour ~0.15 m higher in the image is much farther (open space above)
        up = np.maximum(0, vv - 9)
        zup = 1 / np.maximum(0.03, a2[i] * D[up, uu] + b2[i])
        edge = keep & (zup > z + 0.7) & (Md[up, uu] == 0)
        Xe = X[edge]
        if len(Xe):
            j, lat, h, near = local_frame(Xe, f, floor)
            sel = near & (h > 0.7) & (h < 1.25) & (np.abs(lat) > 0.35) & (np.abs(lat) < 3.0)
            for k in np.where(sel)[0]:
                cands.append((*Xe[k], j[k], lat[k], h[k], f))
        # occupancy for blockers
        Xk = X[keep]
        if len(Xk) > 4000:
            Xk = Xk[np.random.default_rng(i).choice(len(Xk), 4000, replace=False)]
        j, lat, h, near = local_frame(Xk, f, floor)
        inband = near & (np.abs(lat) < 2.8)
        for x_, z_, h_ in zip(Xk[inband, 0], Xk[inband, 2], h[inband]):
            key = (int(np.floor(x_ / G)), int(np.floor(z_ / G)))
            e = occ.setdefault(key, [0, 0, 0.0, 0, -1, 0])
            if 0.15 < h_ < 1.9:
                e[0] += 1; e[2] += h_; e[3] += 1
                if e[4] != i:
                    e[4] = i; e[5] += 1      # distinct frames that saw something solid here
            elif -0.08 < h_ < 0.08:
                e[1] += 1
    return np.array(cands) if cands else np.zeros((0, 8)), occ, G


def build_rails(cands, floor):
    rails = []
    if not len(cands):
        return rails
    for side, sg in (("right", 1), ("left", -1)):
        c = cands[np.sign(cands[:, 4]) == sg]
        if len(c) < 30:
            continue
        sv = S[c[:, 3].astype(int)]
        bins = np.arange(0, S[-1] + 0.25, 0.25)
        bi = np.digitize(sv, bins)
        rows = []
        for b in np.unique(bi):
            m = bi == b
            if m.sum() < 6 or len(np.unique(c[m, 6])) < 4:   # seen from >= 4 frames
                continue
            lat = np.median(c[m, 4]); h = np.median(c[m, 5])
            mad = np.median(np.abs(c[m, 4] - lat))
            if mad > 0.25:
                continue
            rows.append((bins[b - 1] + 0.125, lat, h, m.sum(), np.median(c[m, 0]), np.median(c[m, 1]),
                         np.median(c[m, 2])))
        rows = np.array(rows)
        if not len(rows):
            continue
        # runs of bins with gaps <= 0.5 m and smoothly varying offset
        start = 0
        for k in range(1, len(rows) + 1):
            if k == len(rows) or rows[k, 0] - rows[k - 1, 0] > 0.55 or abs(rows[k, 1] - rows[k - 1, 1]) > 0.35:
                run = rows[start:k]
                if run[-1, 0] - run[0, 0] >= 1.2:
                    # split into pieces of <= 2 m; endpoints at the run's measured lateral offset / height
                    edges = np.arange(run[0, 0], run[-1, 0] + 1e-6, 2.0)
                    if run[-1, 0] - edges[-1] > 0.6 or len(edges) == 1:
                        edges = np.append(edges, run[-1, 0])
                    else:
                        edges[-1] = run[-1, 0]
                    for e0, e1 in zip(edges[:-1], edges[1:]):
                        seg = run[(run[:, 0] >= e0 - 1e-6) & (run[:, 0] <= e1 + 1e-6)]
                        if len(seg) < 2:
                            continue
                        pts = []
                        for sx in (e0, e1):
                            j = frame_at(sx)
                            l = float(np.interp(sx, seg[:, 0], seg[:, 1]))
                            hh = float(np.median(seg[:, 2]))
                            pts.append([SMX[j] - TZ[j] * l, floor[j] + hh, SMZ[j] + TX[j] * l])
                        hh = float(np.median(seg[:, 2]))
                        latm = float(np.median(seg[:, 1]))
                        f0, f1 = frame_at(e0), frame_at(e1)
                        rails.append({"a": [round(v, 3) for v in pts[0]], "b": [round(v, 3) for v in pts[1]],
                                      "side": side, "frames": [int(f0), int(f1)],
                                      "s": [round(float(e0), 2), round(float(e1), 2)],
                                      "height": round(hh, 2), "lat": round(latm, 2),
                                      "holdable": bool(0.78 <= hh <= 1.15 and abs(latm) <= 1.7),
                                      "support": int(seg[:, 3].sum()),
                                      "note": ""})
                start = k
    return rails


def build_blockers(occ, G, floor, rails):
    keys = [k for k, e in occ.items() if e[0] >= 10 and e[5] >= 6 and e[0] / (e[0] + e[1] + 1e-9) > 0.7]
    if not keys:
        return []
    ks = np.array(keys)
    x0, z0 = ks.min(0)
    grid = np.zeros(tuple(ks.max(0) - ks.min(0) + 1), np.uint8)
    grid[ks[:, 0] - x0, ks[:, 1] - z0] = 1
    grid = cv2.morphologyEx(grid, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(grid.T.copy(), connectivity=8)
    out = []
    pathxz = np.stack([SMX, SMZ], 1)[::3]
    for j in range(1, n):
        x, y, w, h, a = st[j]
        ext = max(w, h) * G
        if a < 3 or ext > 2.6:
            continue  # specks / walls
        cells = np.argwhere(lab == j)  # (row=z, col=x)
        cxz = np.stack([(cells[:, 1] + x0 + 0.5) * G, (cells[:, 0] + z0 + 0.5) * G], 1)
        c = cxz.mean(0)
        r = float(np.sqrt(((cxz - c) ** 2).sum(1)).max() + G / 2)
        dpath = np.sqrt(((pathxz - c) ** 2).sum(1))
        fi = int(dpath.argmin()) * 3
        if dpath.min() < 0.45 or dpath.min() > 2.6 or r > 1.4:
            continue  # on the walked line (a person / noise) or too far
        # elongated & long = wall piece / rail, not a blocker
        if len(cxz) > 3:
            ev = np.linalg.eigvalsh(np.cov((cxz - c).T))
            if ev[-1] > 0 and np.sqrt(ev[0] / ev[-1]) < 0.2 and ext > 1.2:
                continue
        hs = [occ[(int(k[1] + x0), int(k[0] + z0))] for k in cells if (int(k[1] + x0), int(k[0] + z0)) in occ]
        hmean = float(sum(e[2] for e in hs) / max(1, sum(e[3] for e in hs)))
        out.append({"x": round(float(c[0]), 2), "z": round(float(c[1]), 2), "r": round(min(r, 1.2), 2),
                    "height": round(hmean * 1.6, 2), "f": fi, "dist_from_path": round(float(dpath.min()), 2),
                    "note": "", "source": "depth"})
    return out


def locate(f, u, v, floor):
    """World point where the ray through image (u, v) of frame f meets the floor (track geometry only, no depth)."""
    d = unproject(f, np.array(u), np.array(v), np.array(1.0)) - P[f]
    y = floor[f]
    for _ in range(5):
        t = (y - P[f][1]) / d[1]
        X = P[f] + t * d
        j = int(np.argmin((SMX - X[0]) ** 2 + (SMZ - X[2]) ** 2))
        y = floor[j]
    return X, j


# ---------------------------------------------------------------------------------------------- validation images
def stick(img, f, F, col, label=None):
    H, W = img.shape[:2]
    pts = np.array([F, F + [0, 1.6, 0], F + [-0.2, 0, 0], F + [0.2, 0, 0], F + [0, 0, -0.2], F + [0, 0, 0.2],
                    F + [0, 1.0, 0]])
    u, v, z = project(f, pts)
    if (z <= 0.2).any():
        return
    p = [(int(a * W), int(b * H)) for a, b in zip(u, v)]
    cv2.line(img, p[0], p[1], col, 3)
    cv2.circle(img, p[1], max(4, int(0.06 * abs(p[0][1] - p[1][1]))), col, 2)
    cv2.line(img, p[2], p[3], col, 2); cv2.line(img, p[4], p[5], col, 2)
    cv2.line(img, (p[6][0] - 12, p[6][1]), (p[6][0] + 12, p[6][1]), col, 2)
    if label:
        cv2.putText(img, label, (p[0][0] + 6, p[0][1] + 18), 0, 0.6, col, 2)


def brain_floor():
    fy = P[:, 1] - CAM_H
    return np.convolve(np.pad(fy, 20, mode="edge"), np.ones(41) / 41, "valid")


def render_checks(floor, samples, rails, blockers, frames, tag, L=3.0):
    bf = brain_floor()
    tiles = []
    for f in frames:
        img = color_frame(f)
        H, W = img.shape[:2]
        sT = S[f] + L
        t = frame_at(sT)
        ns = min(range(len(samples)), key=lambda k: abs(samples[k]["s"] - sT))
        smp = samples[ns]
        lat = smp["prefer"]
        # lane line on the floor at the target sample
        lo, hi = smp["lane"]
        ls = np.linspace(lo, hi, 30)
        Q = np.stack([SMX[t] - TZ[t] * ls, np.full(30, floor[t]), SMZ[t] + TX[t] * ls], 1)
        u, v, z = project(f, Q)
        okp = z > 0.3
        pts = np.stack([u[okp] * W, v[okp] * H], 1).astype(np.int32)
        if len(pts) > 1:
            cv2.polylines(img, [pts], False, (0, 255, 255), 3)
        for r in rails:
            if r["frames"][0] - 200 < f < r["frames"][1] + 50:
                A, B = np.array(r["a"]), np.array(r["b"])
                seg = np.linspace(A, B, 20)
                u, v, z = project(f, seg)
                k = z > 0.3
                if k.sum() > 1:
                    col = (255, 120, 0) if r["holdable"] else (160, 160, 160)
                    cv2.polylines(img, [np.stack([u[k] * W, v[k] * H], 1).astype(np.int32)], False, col, 4)
        for b in blockers:
            ang = np.linspace(0, 2 * np.pi, 24)
            fl = floor[min(N - 1, b["f"])]
            C = np.stack([b["x"] + b["r"] * np.cos(ang), np.full(24, fl), b["z"] + b["r"] * np.sin(ang)], 1)
            u, v, z = project(f, C)
            if (z > 0.3).all() and (z < 9).all():
                cv2.polylines(img, [np.stack([u * W, v * H], 1).astype(np.int32)], True, (0, 0, 255), 2)
        F_b = np.array([SMX[t] - TZ[t] * lat, bf[t], SMZ[t] + TX[t] * lat])
        F_n = np.array([SMX[t] - TZ[t] * lat, floor[t], SMZ[t] + TX[t] * lat])
        stick(img, f, F_b, (0, 0, 255), "old")
        stick(img, f, F_n, (0, 255, 0), "nav")
        cv2.putText(img, f"{NAME} f{f}  +{L:.0f} m  floor {floor[t]:.2f} (old {bf[t]:.2f})", (10, 34), 0, 0.85,
                    (255, 255, 255), 2)
        cv2.putText(img, f"lane [{lo:.1f},{hi:.1f}] prefer {lat:+.2f}{'  STAIRS' if smp['stairs'] else ''}",
                    (10, 70), 0, 0.85, (0, 255, 255), 2)
        tiles.append(cv2.resize(img, (360, 640)))
    rows = [np.hstack(tiles[k:k + 4] + [np.zeros_like(tiles[0])] * (4 - len(tiles[k:k + 4])))
            for k in range(0, len(tiles), 4)]
    p = OUT / f"nav_{NAME}_{tag}.jpg"
    cv2.imwrite(str(p), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return str(p)


def plot_profile(ys, floor, floor_q, steps, a2, b2, s0, s1, tag):
    """Side view: depth points near the path (re-calibrated), camera y, old brain floor, new floor."""
    bf = brain_floor()
    f0, f1 = frame_at(s0), frame_at(s1)
    ymin, ymax = floor[f0:f1 + 1].min() - 0.8, ys[f0:f1 + 1].max() + 0.4
    W, Hh, pad = 1800, 800, 50
    sx = (W - 2 * pad) / (s1 - s0); sy = (Hh - 2 * pad) / (ymax - ymin); sc = min(sx, sy)
    Hh = int((ymax - ymin) * sc + 2 * pad); W = int((s1 - s0) * sc + 2 * pad)
    img = np.full((Hh, W, 3), 255, np.uint8)

    def px(s, y):
        return np.stack([pad + (np.asarray(s) - s0) * sc, Hh - pad - (np.asarray(y) - ymin) * sc], -1).astype(np.int32)
    for g in np.arange(np.ceil(s0), s1, 1.0):
        x = int(pad + (g - s0) * sc); cv2.line(img, (x, pad), (x, Hh - pad), (225, 225, 225), 1)
        cv2.putText(img, f"{g:g}", (x - 6, Hh - pad + 18), 0, 0.45, (90, 90, 90), 1)
    for g in np.arange(np.ceil(ymin * 2) / 2, ymax, 0.5):
        y = int(Hh - pad - (g - ymin) * sc); cv2.line(img, (pad, y), (W - pad, y), (225, 225, 225), 1)
        cv2.putText(img, f"{g:g}", (4, y + 4), 0, 0.45, (90, 90, 90), 1)
    for f in range(f0 - f0 % STEP, f1, 10):
        i = f // STEP
        vv, uu = np.mgrid[int(DH * 0.35):DH:2, int(DW * 0.4):int(DW * 0.6):2]
        z = 1 / np.maximum(0.03, a2[i] * DEP[i][vv, uu] / 255.0 + b2[i])
        X = unproject(f, (uu + 0.5) / DW, (vv + 0.5) / DH, z)
        k = (MSK[i][vv, uu] < 100) & (z < 5)
        X = X[k]
        if not len(X):
            continue
        j, lat, h, near = local_frame(X, f, floor)
        m = near & (np.abs(lat) < 0.5)
        for p in px(S[j[m]], X[m, 1]):
            cv2.circle(img, tuple(p), 1, (200, 170, 140), -1)
    fr = np.arange(f0, f1)
    cv2.polylines(img, [px(S[fr], ys[fr])], False, (0, 0, 255), 2)
    cv2.polylines(img, [px(S[fr], bf[fr])], False, (0, 0, 0), 2)
    cv2.polylines(img, [px(S[fr], floor_q[fr])], False, (0, 170, 0), 3)
    for st in steps:
        if s0 <= st["s"][0] <= s1:
            a, b = px([st["s"][0], st["s"][0]], [st["y"], st["y"] + 0.03])
            cv2.circle(img, tuple(a), 4, (0, 120, 0), -1)
    cv2.putText(img, f"{NAME}: red camera y | black old brain floorY (cam y-1.4, box41) | green nav floor_y (treads) | "
                     f"dots: re-calibrated depth near path", (pad, 28), 0, 0.55, (0, 0, 0), 1)
    p = OUT / f"nav_{NAME}_profile_{tag}.png"
    cv2.imwrite(str(p), img)
    return str(p)


def plot_topdown(samples, rails, blockers, tag="map"):
    xs, zs = SMX, SMZ
    pad = 40
    x0, x1, z0, z1 = xs.min() - 3, xs.max() + 3, zs.min() - 3, zs.max() + 3
    sc = min(1400 / (x1 - x0), 1400 / (z1 - z0))
    W, H = int((x1 - x0) * sc + 2 * pad), int((z1 - z0) * sc + 2 * pad)
    img = np.full((H, W, 3), 255, np.uint8)

    def px(x, z):
        return np.stack([pad + (np.asarray(x) - x0) * sc, pad + (np.asarray(z) - z0) * sc], -1).astype(np.int32)
    L, R, Pp = [], [], []
    for smp in samples:
        f = smp["f"]
        for lat, arr in ((smp["lane"][0], L), (smp["lane"][1], R), (smp["prefer"], Pp)):
            arr.append((SMX[f] - TZ[f] * lat, SMZ[f] + TX[f] * lat))
    for arr, col in ((L, (200, 200, 255)), (R, (200, 200, 255)), (Pp, (0, 170, 0))):
        a = np.array(arr)
        for k in range(len(a) - 1):
            if np.hypot(*(a[k + 1] - a[k])) < 1.0:
                cv2.line(img, tuple(px(*a[k])), tuple(px(*a[k + 1])), col, 1)
    cv2.polylines(img, [px(xs, zs)], False, (0, 0, 0), 1)
    for r in rails:
        cv2.line(img, tuple(px(r["a"][0], r["a"][2])), tuple(px(r["b"][0], r["b"][2])),
                 (255, 120, 0) if r["holdable"] else (150, 150, 150), 3)
    for b in blockers:
        cv2.circle(img, tuple(px(b["x"], b["z"])), max(2, int(b["r"] * sc)), (0, 0, 255), 2)
    for smp in samples[::60]:
        f = smp["f"]
        cv2.putText(img, f"{f / FPS:.0f}s", tuple(px(SMX[f], SMZ[f]) + 4), 0, 0.4, (0, 0, 0), 1)
    cv2.putText(img, f"{NAME}: black walked path, blue lane edges, green preferred line, orange holdable rails, "
                     f"grey other rails, red blockers", (10, 20), 0, 0.5, (0, 0, 0), 1)
    p = OUT / f"nav_{NAME}_{tag}.png"
    cv2.imwrite(str(p), img)
    return str(p)



def review_sheets(floor, rails, blockers, tag=""):
    """One tile per rail / blocker, seen from ~2.5 m before it, for eyeballing (and the REVIEW table)."""
    paths = []
    for kind, items in (("rails", rails), ("blockers", blockers)):
        tiles = []
        for k, it in enumerate(items):
            if kind == "rails":
                smid = (it["s"][0] + it["s"][1]) / 2
                f = frame_at(max(0, it["s"][0] - 2.0))
            else:
                f = frame_at(max(0, S[min(N - 1, it["f"])] - 2.5))
            f = min(f - f % STEP, (NS - 1) * STEP)
            img = color_frame(f)
            H, W = img.shape[:2]
            if kind == "rails":
                seg = np.linspace(np.array(it["a"]), np.array(it["b"]), 30)
                u, v, z = project(f, seg)
                m = z > 0.3
                if m.sum() > 1:
                    cv2.polylines(img, [np.stack([u[m] * W, v[m] * H], 1).astype(np.int32)], False,
                                  (0, 165, 255) if it["holdable"] else (200, 200, 200), 6)
                lab = f"R{k} {it['side']} h{it['height']} lat{it['lat']} {'HOLD' if it['holdable'] else ''}"
            else:
                fl = floor[min(N - 1, it["f"])]
                ang = np.linspace(0, 2 * np.pi, 32)
                for hh in (0.0, it["height"]):
                    C = np.stack([it["x"] + it["r"] * np.cos(ang), np.full(32, fl + hh), it["z"] + it["r"] * np.sin(ang)], 1)
                    u, v, z = project(f, C)
                    if (z > 0.3).all():
                        cv2.polylines(img, [np.stack([u * W, v * H], 1).astype(np.int32)], True, (0, 0, 255), 3)
                lab = f"B{k} r{it['r']} h{it['height']} {it['source'][:6]}"
            cv2.putText(img, f"f{f} {lab}", (8, 40), 0, 0.9, (255, 255, 255), 2)
            tiles.append(cv2.resize(img, (300, 533)))
        if not tiles:
            continue
        rows = [np.hstack(tiles[i:i + 6] + [np.zeros_like(tiles[0])] * (6 - len(tiles[i:i + 6])))
                for i in range(0, len(tiles), 6)]
        pth = OUT / f"nav_{NAME}_{kind}{tag}.jpg"
        cv2.imwrite(str(pth), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 80])
        paths.append(str(pth))
    return paths


def plot_lanes(fr, lane, pref, stairs):
    """Free-space score per sample (x) and lateral offset (y): white free, black blocked; lane edges, prefer."""
    img = (np.clip(fr.T, 0, 1) * 255).astype(np.uint8)[::-1]
    img = cv2.cvtColor(cv2.resize(img, (fr.shape[0] * 2, len(LATS) * 6), interpolation=cv2.INTER_NEAREST),
                       cv2.COLOR_GRAY2BGR)
    H = img.shape[0]

    def y(l):
        return int((3.0 - l) / 6.0 * (H - 1))
    for i in range(len(lane)):
        x = 2 * i
        cv2.circle(img, (x, y(lane[i, 0])), 1, (255, 0, 0), -1)
        cv2.circle(img, (x, y(lane[i, 1])), 1, (255, 0, 0), -1)
        cv2.circle(img, (x, y(pref[i])), 1, (0, 170, 0), -1)
        if stairs[SF[i]]:
            cv2.line(img, (x, H - 6), (x, H - 1), (0, 0, 255), 2)
    for i in range(0, len(lane), 30):
        cv2.putText(img, f"{SF[i] / FPS:.0f}s", (2 * i, 12), 0, 0.35, (0, 0, 255), 1)
    pth = OUT / f"nav_{NAME}_lanes.png"
    cv2.imwrite(str(pth), img)
    return str(pth)


# ---------------------------------------------------------------------------------------------- review (by eye)
# The automatic rail / blocker detectors are noisy where the SegFormer person mask misses people, in the dark and
# around pose seams. Every detection was looked at in the review sheets (nav_<floor>_rails.jpg / _blockers.jpg,
# written with --validate); only confirmed ones are kept. Rails: (side, frame range overlapping the detection,
# holdable, note). Blockers: detected ones to DROP (x, z within 0.35 m) and objects placed by eye: base pixels
# (frame, u, v) of where the object meets the floor, intersected with the floor plane (track geometry only).
REVIEW = {
    "upstairs": {
        "rails": [("right", 0, 455, True, "stair balustrade: solid white parapet with a flat top beside the blue "
                                          "staircase, continuing round the stairwell at the top"),
                  ("left", 3790, 3872, False, "glass balustrade over the atrium (final view); depth sees through the "
                                              "glass so the measured top is low: look over it, don't place a hand")],
        "drop_all_auto_blockers": True,   # all upstairs detections were people, walls or seam artefacts
        # End of the floor: the camera stops at the glass balustrade and looks DOWN into the atrium, so no walked floor
        # ahead is in frame, and the depth there can't be calibrated (no floor ahead to fit it on; "fit_gap"). The
        # only balcony floor in frame is the walkway right of the glass (between the glass and the windows, two
        # guests at the rail further along); it is only ~0.7 m wide in frame, so the spot (placed by eye on the final
        # frame, mid-walkway, ~0.4 m from the glass) cannot keep 0.6 m; floor-rayed; used from `from_f` on.
        "spots": [],  # (the walk now ends at 3805, before that downward view: WALK_END in app/src/core/data.ts)
        # The automatic glass-balustrade rail is ~1 m off at the final balcony (depth sees through the glass, and the
        # world is tilted ~20 deg there): the guide stood 0.2 m from the visible edge while the map said 0.76 m.
        # Replaced by the visible edge itself, floor-rayed from the pixels where the glass meets the floor.
        # The solve drifts here (the same edge floor-rays ~0.6 m apart from frames 3790 and 3871), so each view's edge
        # is its own segment, active only for the frames it was seen from ("active").
        "manual_rails": [{"replace": "glass", "side": "left", "views": [(3790, 0.341, 0.499), (3790, 0.42, 0.72)],
                          "active": [3700, 3850],
                          "note": "glass balustrade over the atrium, placed by eye where the glass meets the floor (from "
                                  "frame 3790); a drop behind it"}],
        "drop": [],
        # Lanes widened by eye where the depth-measured free lane is far narrower than the floor the footage shows.
        # The Plant Room (upstairs 3105-3200): the walked line hugs the long planter on its left; the depth fit is
        # uncalibrated there (fit_gap up to 60 frames, the solve tilted: floor_y falls 1.3 m over 100 frames), and
        # the lane came out 0.4 m wide although the open room floor runs ~3 m to the right of the line (guests stand
        # at the far right; people are avoided live). (f0, f1, lo, hi, note): lane = [min(auto lo, lo), max(auto hi, hi)].
        "lanes": [(3105, 3200, -0.2, 1.6, "Plant Room: open floor right of the planter")],
        "manual": [
            {"views": [(730, 0.10, 0.62), (745, 0.09, 0.65), (760, 0.03, 0.67)], "r": 0.3, "height": 1.3, "kind": "center",
             "note": "glowing cyan light sign standing on the floor (beacon hall)"},
        ],
    },
    "downstairs": {
        "rails": [("right", 1100, 1320, True, "curved white balcony balustrade over the atrium (the curve)")],
        "drop_all_auto_blockers": False,
        "drop": [(-3.5, -26.73), (-3.7, -25.23), (1.51, -23.05), (-19.34, 5.9)],  # people / unseen
        "manual": [
            {"views": [(2330, 0.51, 0.72), (2330, 0.555, 0.99), (2370, 0.45, 0.70), (2370, 0.42, 0.95),
                       (2400, 0.36, 0.93)], "r": 0.35, "height": 0.45, "kind": "edge",
             "note": "black leather cube bench (monocular depth reads it as floor); circles hug its path-side edge"},
            {"views": [(480, 0.156, 0.72)], "r": 0.35, "height": 1.9, "kind": "center",
             "note": "portrait LED screen on a black stand (come-closer row)"},
            {"views": [(480, 0.267, 0.625)], "r": 0.35, "height": 1.9, "kind": "center",
             "note": "portrait LED screen on a black stand (come-closer row)"},
            {"views": [(480, 0.33, 0.57)], "r": 0.35, "height": 1.9, "kind": "center",
             "note": "portrait LED screen on a black stand (come-closer row)"},
            {"views": [(900, 0.555, 0.54), (900, 0.627, 0.545), (900, 0.70, 0.55)], "r": 0.22, "height": 0.95,
             "kind": "edge", "note": "velvet-rope stanchions with the rope between them"},
            {"views": [(1600, 0.72, 0.65)], "r": 0.4, "height": 1.2, "kind": "center",
             "note": "white display plinth with a glass case (projection room)"},
            {"views": [(1600, 0.85, 0.62)], "r": 0.4, "height": 1.0, "kind": "center",
             "note": "white display plinth (projection room)"},
            {"views": [(2750, 0.80, 0.61)], "r": 0.5, "height": 1.0, "kind": "center",
             "note": "white CPU-terminal plinth (row along the windows)"},
            {"xz": (-2.3, -24.5), "r": 0.4, "height": 0.15, "note": "curved balcony curb near the walked line (brain.ts)"},
        ],
    },
}


def apply_review(rails_auto, blockers_auto, floor):
    rv = REVIEW.get(NAME, {})
    rails = []
    for r in rails_auto:
        for side, f0, f1, hold, note in rv.get("rails", []):
            if r["side"] == side and r["frames"][1] >= f0 and r["frames"][0] <= f1:
                r = dict(r, holdable=bool(hold and r["holdable"] or hold and 0.75 <= r["height"] <= 1.2),
                         note=note, chapter=chapter_at((r["frames"][0] + r["frames"][1]) // 2))
                rails.append(r)
                break
    blockers = []
    if not rv.get("drop_all_auto_blockers"):
        for b in blockers_auto:
            if any(np.hypot(b["x"] - x, b["z"] - z) < 0.35 for x, z in rv.get("drop", [])):
                continue
            b["note"] = f"solid obstacle ~{b['height']:.1f} m tall seen in depth; footage: {beat_at(b['f'])[:80]}"
            blockers.append(b)
    for m in rv.get("manual", []):
        pts = []
        if "xz" in m:
            pts = [np.array([m["xz"][0], 0, m["xz"][1]])]
        else:
            for f, u, v in m["views"]:
                X, j = locate(f, u, v, floor)
                if m["kind"] == "center":   # base pixel is the object's front: centre is r further from the camera
                    d = X - P[f]; d[1] = 0; X = X + d / np.linalg.norm(d) * m["r"]
                else:                       # edge facing the path: centre is r further away from the path
                    d = X - np.array([SMX[j], X[1], SMZ[j]]); d[1] = 0
                    X = X + d / (np.linalg.norm(d) + 1e-6) * m["r"]
                pts.append(X)
            if m["kind"] == "center":
                pts = [np.mean(pts, 0)]
        for X in pts:
            dd = np.hypot(SMX - X[0], SMZ - X[2])
            blockers.append({"x": round(float(X[0]), 2), "z": round(float(X[2]), 2), "r": m["r"],
                             "height": m["height"], "f": int(dd.argmin()), "dist_from_path": round(float(dd.min()), 2),
                             "note": m["note"], "source": "placed by eye (floor-ray)" if "views" in m else "manual"})
    spots = []
    for m in rv.get("spots", []):
        X = np.mean([locate(f, u, v, floor)[0] for f, u, v in m["views"]], 0)
        spots.append({"x": round(float(X[0]), 2), "y": round(float(X[1]), 3), "z": round(float(X[2]), 2),
                      "from_s": round(float(S[m["from_f"]]), 2), "to_s": round(float(S[-1]) + 1, 2), "note": m["note"]})
    for m in rv.get("manual_rails", []):
        rails = [r for r in rails if m["replace"] not in r.get("note", "") or r.get("source")]
        pts = [locate(f, u, v, floor) for f, u, v in m["views"]]
        for (A, ja), (B, jb) in zip(pts[:-1], pts[1:]):
            lat = float(-TZ[ja] * (A[0] - SMX[ja]) + TX[ja] * (A[2] - SMZ[ja]))
            rails.append({"a": [round(float(A[0]), 3), round(float(A[1]) + 1.0, 3), round(float(A[2]), 3)],
                          "b": [round(float(B[0]), 3), round(float(B[1]) + 1.0, 3), round(float(B[2]), 3)],
                          "side": m["side"], "frames": [int(min(ja, jb)), int(max(ja, jb))], "s": [round(float(S[min(ja, jb)]), 2), round(float(S[max(ja, jb)]), 2)],
                          "height": 1.0, "lat": round(lat, 2), "holdable": False, "support": 0, "note": m["note"],
                          "chapter": chapter_at(ja), "source": "placed by eye (floor-ray)", "active": m["active"]})
    for r in rails:
        r["drop"] = True  # every reviewed rail here is a balustrade with a drop behind it (atrium, stairwell)
    return rails, blockers, spots


# ---------------------------------------------------------------------------------------------- main


def main():
    print(f"[{NAME}] {N} frames, {NS} samples")
    pc = people_check()
    hd = depth_plane_heights()
    print(f"  people check: {pc}; original depth puts the floor {hd:.2f} m below the camera")
    ys, floor, slope, zones, seams, conf_edges = find_floor()
    print(f"  stair zones (frames): {[[r for r in z] for z in zones]}; seams at frames {seams}")
    steps, floor_q = find_treads(floor, zones)
    stairs = np.zeros(N, bool); sdir = np.zeros(N, int)
    for z in zones:
        for a, b in z:
            stairs[a:b + 1] = True
            sdir[a:b + 1] = 1 if slope[(a + b) // 2] > 0 else -1
    a2, b2, res, good = recalibrate(floor_q)
    print(f"  depth re-calibration: {good.sum()}/{NS} frames, median residual {np.nanmedian(res[good]):.3f}")
    zone = np.zeros(N, bool)              # stair zone incl. landings: open risers read as drops, don't test for them
    for z in zones:
        zone[max(0, z[0][0] - 30):z[-1][1] + 30] = True
    free, pers = lane_status(floor_q, a2, b2, zone)
    lane, fr = lanes_from(free, pers, stairs)
    for f0, f1, lo_, hi_, _note in REVIEW.get(NAME, {}).get("lanes", []):
        m = (SF >= f0) & (SF <= f1)
        lane[m, 0] = np.minimum(lane[m, 0], lo_)
        lane[m, 1] = np.maximum(lane[m, 1], hi_)
    cands, occ, G = rails_and_blockers(floor_q, a2, b2)
    rails_auto = build_rails(cands, floor_q)
    blockers_auto = build_blockers(occ, G, floor_q, rails_auto)
    rails, blockers, spots = apply_review(rails_auto, blockers_auto, floor_q)
    print(f"  review: rails {len(rails_auto)} detected -> {len(rails)} kept; blockers {len(blockers_auto)} detected "
          f"-> {sum(b['source'] == 'depth' for b in blockers)} kept + {sum(b['source'] != 'depth' for b in blockers)} placed by eye")
    # rails per sample for the preferred side
    rail_side = np.zeros(NS)
    for r in rails:
        if r["holdable"]:
            m = (S[SF] >= r["s"][0] - 1.0) & (S[SF] <= r["s"][1] + 1.0)
            rail_side[m & stairs[SF]] = 1 if r["side"] == "right" else -1
    pref = prefer_from(lane, fr, pers, rail_side)
    samples = []
    for i in range(NS):
        f = SF[i]
        lo, hi = float(lane[i, 0]), float(lane[i, 1])
        p = float(np.clip(pref[i], lo + 0.25 if lo < -0.3 else lo, hi - 0.25 if hi > 0.3 else hi))
        samples.append({"f": int(f), "s": round(float(S[f]), 3), "floor_y": round(float(floor_q[f]), 3),
                        "lane": [round(lo, 2), round(hi, 2)], "prefer": round(p, 2),
                        "stairs": bool(stairs[f]), "stair_dir": int(sdir[f]),
                        # per-frame depth fit re-calibrated to the floor (1/z = da*d + db, d = byte/255): the brain's
                        # live scene sense uses it instead of the solve's feature-point fit (near floor ~30 % short)
                        "da": round(float(a2[i]), 4), "db": round(float(b2[i]), 4),
                        # frames to the nearest sample whose recalibration converged (0 = this one): far from any
                        # (the end of upstairs, looking down into the atrium) the depth can't be trusted for occlusion
                        "fit_gap": int(np.min(np.abs(np.where(good)[0] - i)) * STEP) if good.any() else 9999})
    bf = brain_floor()
    st_idx = np.where(stairs)[0]
    notes = (f"floor_y = floor under the walked path at s (world y). Camera height 1.40 m validated from standing people "
             f"({pc['frames_used']} frames: {pc['camera_height_for_1p70m_people']} m for 1.70 m people, track horizon "
             f"within {abs(pc['horizon_image_minus_track_v']):.3f} of image height); raw monocular depth puts the floor "
             f"only {hd:.2f} m below the camera, so depth is re-calibrated to the floor before use. "
             f"Lateral offsets are along the smoothed-path right vector (-tz, tx) exactly as brain.lanePoint. "
             f"Pose seams (floor jumps with the camera; a target across a seam is seen from the other fragment): frames {seams}. "
             f"Use floor_y at the guide's OWN s (nearest path point), never the target's: on stairs the floor rises "
             f"up to {max([0.0] + [float(np.interp(S[f] + 5.2, S, bf) - np.interp(S[f] + 2.0, S, bf)) for f in st_idx]):.2f} m "
             f"between 2.0 and 5.2 m ahead.")
    out = {"floor": NAME, "step": STEP, "camera_height_m": CAM_H, "lat_axis": "smoothed path right (-tz, tx), + = right",
           "samples": samples, "steps": steps, "rails": rails, "blockers": blockers, "spots": spots, "seams": seams,
           "checks": {"people": pc, "raw_depth_floor_below_camera_m": round(hd, 3),
                      "recalibrated_frames": int(good.sum()), "recal_median_residual": round(float(np.nanmedian(res[good])), 4)},
           "notes": notes}
    p = ROOT / f"app/public/data/nav_{NAME}.json"
    json.dump(out, open(p, "w"), separators=(",", ":"))
    print(f"  wrote {p}: {len(samples)} samples, {len(steps)} treads, {len(rails)} rails "
          f"({sum(r['holdable'] for r in rails)} holdable), {len(blockers)} blockers")
    if VALIDATE:
        imgs = [plot_topdown(samples, rails, blockers), plot_lanes(fr, lane, pref, stairs)]
        imgs += review_sheets(floor_q, rails_auto, blockers_auto, "_detected")
        imgs += review_sheets(floor_q, rails, blockers, "_final")
        if NAME == "upstairs":
            imgs.append(plot_profile(ys, floor, floor_q, steps, a2, b2, -0.5, 12.0, "stairs"))
            imgs.append(render_checks(floor_q, samples, rails, blockers, [0, 60, 120, 180, 240, 300, 360, 420], "stairs"))
            imgs.append(render_checks(floor_q, samples, rails, blockers, [700, 1500, 2600, 3200], "flat"))
        else:
            imgs.append(plot_profile(ys, floor, floor_q, steps, a2, b2, 0, 30.0, "start"))
            imgs.append(render_checks(floor_q, samples, rails, blockers, [150, 600, 1000, 1150, 1500, 2200, 2400, 2700], "flat"))
        print("  validation:", *imgs, sep="\n    ")


if __name__ == "__main__":
    main()
