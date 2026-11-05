"""Stitch solve fragments into one metric, floor-aligned camera track per floor and export runtime data.

1. Gather every model from data/solve_<name>*_raw.json (main + gap re-solves).
2. Merge fragments that overlap in time: rotation = average of R_wcA · R_wcB^T over the overlap,
   then scale + translation by least squares on camera centres (robust to straight-line walks).
3. Fit the floor (RANSAC plane on low points), make it y=0 with +y up, and set metric scale so the
   median camera height is 1.40 m (phone held at chest height).
4. Interpolate a pose for every video frame (slerp + linear), flag frames with no nearby solve.
5. Per-frame depth calibration: fit 1/z = a*d + b between the 8-bit disparity video and the camera-space
   depth of solved points; smooth over time.
6. Export app/public/data/camera_<name>.json and a top-down occupancy map for the illustrated floor plan.

  python build_camera.py <name>
"""
import glob
import json
import pathlib
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial.transform import Rotation as Rot
from scipy.spatial.transform import Slerp

ROOT = pathlib.Path(__file__).resolve().parent.parent
name = sys.argv[1]
CAM_HEIGHT = 1.40
meta = json.load(open(ROOT / f"app/public/media/walk/{name}/meta.json"))
NF = meta["frames"]
FPS = meta["fps"]


def load_models():
    out = []
    for p in sorted(glob.glob(str(ROOT / f"data/solve_{name}*_raw.json"))):
        d = json.load(open(p))
        for m in d["models"]:
            if len(m["frames"]) < 20 or not (380 < m["camera"]["params"][0] < 620):
                continue  # tiny or badly self-calibrated fragments (focal far from ~480 px) are junk
            fr = {int(k): v for k, v in m["frames"].items()}
            ks = sorted(fr)
            Rcw = np.array([fr[k]["R_cw"] for k in ks])
            tcw = np.array([fr[k]["t_cw"] for k in ks])
            Rwc = np.transpose(Rcw, (0, 2, 1))
            C = -np.einsum("nij,nj->ni", Rwc, tcw)
            out.append({"src": pathlib.Path(p).stem, "frames": np.array(ks), "Rwc": Rwc, "C": C,
                        "obs": {k: fr[k]["pts"] for k in ks},
                        "points": {int(k): np.array(v) for k, v in m["points"].items()},
                        "cam": m["camera"]})
    return out


def interp(model, frames):
    """Pose of `model` at arbitrary video frames inside its range (None outside)."""
    ks = model["frames"]
    ok = (frames >= ks[0]) & (frames <= ks[-1])
    f = frames[ok]
    sl = Slerp(ks, Rot.from_matrix(model["Rwc"]))
    R = sl(f).as_matrix()
    C = np.stack([np.interp(f, ks, model["C"][:, i]) for i in range(3)], 1)
    return ok, R, C


def apply_sim3(model, s, R, t):
    model["Rwc"] = np.einsum("ij,njk->nik", R, model["Rwc"])
    model["C"] = s * model["C"] @ R.T + t
    model["points"] = {k: s * R @ v + t for k, v in model["points"].items()}
    model["scale"] = model.get("scale", 1.0) * s


def align(A, B):
    """Sim3 mapping B's world into A's world using their temporal overlap."""
    lo, hi = max(A["frames"][0], B["frames"][0]), min(A["frames"][-1], B["frames"][-1])
    if hi - lo < 6:
        return None
    f = np.arange(lo, hi + 1, 2)
    okA, RA, CA = interp(A, f)
    okB, RB, CB = interp(B, f)
    m = okA & okB
    RA, CA = RA[m[okA]], CA[m[okA]]
    RB, CB = RB[m[okB]], CB[m[okB]]
    if len(RA) < 4:
        return None
    Rrel = Rot.from_matrix(np.einsum("nij,nkj->nik", RA, RB)).mean().as_matrix()
    CBr = CB @ Rrel.T
    a, b = CA - CA.mean(0), CBr - CBr.mean(0)
    s = float((a * b).sum() / max((b * b).sum(), 1e-9))
    if s <= 0 or (b * b).sum() < 1e-6:
        # Nearly stationary overlap: keep scale from point spread instead.
        s = 1.0
    t = CA.mean(0) - s * CBr.mean(0)
    resid = float(np.linalg.norm(CA - (s * CBr + t), axis=1).mean())
    return s, Rrel, t, resid, len(RA)


models = load_models()
models.sort(key=lambda m: -len(m["frames"]))
print("fragments:", [(m["src"], len(m["frames"]), round(m["frames"][0] / FPS, 1), round(m["frames"][-1] / FPS, 1)) for m in models])
groups = [[m] for m in models]
merged = True
while merged and len(groups) > 1:
    merged = False
    best = None
    for i in range(len(groups)):
        for j in range(len(groups)):
            if i == j:
                continue
            for A in groups[i]:
                for B in groups[j]:
                    r = align(A, B)
                    if r and (best is None or r[4] > best[0]):
                        best = (r[4], i, j, r)
    if best:
        _, i, j, (s, R, t, resid, n) = best
        for B in groups[j]:
            apply_sim3(B, s, R, t)
        print(f"merge group {j} into {i}: overlap {n} samples, scale {s:.3f}, residual {resid:.3f}")
        groups[i] += groups[j]
        groups.pop(j)
        merged = True


def level_group(g, rng):
    """Rotate/scale/translate a group so its own floor is y=0, +y up, metric (camera height 1.40 m)."""
    pts = np.concatenate([np.stack(list(m["points"].values())) for m in g if m["points"]])
    C = np.concatenate([m["C"] for m in g])
    up = np.concatenate([m["Rwc"][:, :, 1] * -1 for m in g]).mean(0)
    up /= np.linalg.norm(up)
    hgt = (pts - C.mean(0)) @ up
    cand = pts[hgt < np.percentile(hgt, 35)]
    best = None
    for _ in range(2500):
        s3 = cand[rng.choice(len(cand), 3, replace=False)]
        nn = np.cross(s3[1] - s3[0], s3[2] - s3[0])
        if np.linalg.norm(nn) < 1e-12:
            continue
        nn /= np.linalg.norm(nn)
        if nn @ up < 0:
            nn = -nn
        if nn @ up < 0.85:
            continue
        dd = -nn @ s3[0]
        ch = np.median(C @ nn + dd)
        if ch <= 0:
            continue
        inl = (np.abs(cand @ nn + dd) < 0.015 * ch).sum()
        if best is None or inl > best[0]:
            best = (inl, nn, dd, ch)
    _, nn, dd, ch = best
    sc = CAM_HEIGHT / ch
    yv = nn
    f0 = g[0]["Rwc"][0][:, 2]
    f0 = f0 - (f0 @ yv) * yv
    f0 /= np.linalg.norm(f0)
    zv = -f0
    xv = np.cross(yv, zv)
    R = np.stack([xv, yv, zv])
    o0 = C[0] - (C[0] @ nn + dd) * nn
    for m in g:
        apply_sim3(m, sc, R, -sc * R @ o0)
    return sc

# Chain groups in time order: each joins the already-placed track by overlap, else at the seam.
groups.sort(key=lambda g: min(m["frames"][0] for m in g))
main = list(groups[0])
print("groups:", [[(m["src"], len(m["frames"])) for m in g] for g in groups])


def own_height(g):
    gp = np.concatenate([np.stack(list(m["points"].values())) for m in g if m["points"]])
    gC = np.concatenate([m["C"] for m in g])
    upg = np.concatenate([m["Rwc"][:, :, 1] * -1 for m in g]).mean(0)
    hh = (gp - gC.mean(0)) @ (upg / np.linalg.norm(upg))
    return -np.percentile(hh, 10)


LEVELED = len(groups) > 1
rng = np.random.default_rng(0)
if LEVELED:
    for g in groups:
        level_group(g, np.random.default_rng(1))
    for g in groups[1:]:
        ref = max(main, key=lambda m: m["frames"][-1])
        gm = min(g, key=lambda m: m["frames"][0])
        gap = (gm["frames"][0] - ref["frames"][-1]) / FPS
        hr = ref["Rwc"][-1][:, 2]; hg = gm["Rwc"][0][:, 2]
        yaw = np.arctan2(hr[0], hr[2]) - np.arctan2(hg[0], hg[2])
        Ry = Rot.from_euler("y", yaw).as_matrix()
        k = max(0, len(ref["C"]) - 10)
        vel = (ref["C"][-1] - ref["C"][k]) / max(1e-6, (ref["frames"][-1] - ref["frames"][k]) / FPS)
        vel[1] = 0
        if gap < 0:  # overlapping in time: start where the reference was at that moment
            okA, _, CA = interp(ref, np.array([gm["frames"][0]]))
            anchor = CA[0] if okA[0] else ref["C"][-1]
        else:
            anchor = ref["C"][-1] + vel * gap
        tvec = anchor - Ry @ gm["C"][0]
        tvec[1] = 0
        for m in g:
            apply_sim3(m, 1.0, Ry, tvec)
            m["weak"] = True
        print(f"chained leveled group at seam (gap {gap:.1f}s, yaw {np.degrees(yaw):.0f} deg)")
        main += g
others = []

if not LEVELED:
    # Floor plane from the main group (RANSAC on the lowest points relative to camera up).
    pts = np.concatenate([np.stack(list(m["points"].values())) for m in main if m["points"]])
    cams_C = np.concatenate([m["C"] for m in main])
    up_cam = np.concatenate([m["Rwc"][:, :, 1] * -1 for m in main]).mean(0)  # camera -y is image up
    up_cam /= np.linalg.norm(up_cam)
    rng = np.random.default_rng(0)
    best = None
    h = (pts - cams_C.mean(0)) @ up_cam
    cand = pts[h < np.percentile(h, 35)]
    for _ in range(3000):
        s3 = cand[rng.choice(len(cand), 3, replace=False)]
        n = np.cross(s3[1] - s3[0], s3[2] - s3[0])
        if np.linalg.norm(n) < 1e-9:
            continue
        n /= np.linalg.norm(n)
        if n @ up_cam < 0:
            n = -n
        if n @ up_cam < 0.85:
            continue
        d = -n @ s3[0]
        dist = np.abs(cand @ n + d)
        tol = 0.01 * np.median(np.abs(cams_C @ n + d)) + 1e-6
        inl = (dist < tol).sum()
        if best is None or inl > best[0]:
            best = (inl, n, d)
    _, n, d = best
    cam_h = np.median(cams_C @ n + d)
    scale = CAM_HEIGHT / cam_h
    scale_guess = CAM_HEIGHT / cam_h
    print(f"floor normal·up={n @ up_cam:.3f}, camera height {cam_h:.3f} units -> scale {scale:.3f} m/unit")
    # World transform: y = up (n), origin = foot of the first camera, x/z arbitrary but heading-aligned.
    y = n
    first = main[np.argmin([m["frames"][0] for m in main])]
    fwd = first["Rwc"][0][:, 2]
    fwd = fwd - (fwd @ y) * y
    fwd /= np.linalg.norm(fwd)
    z = -fwd  # three.js cameras look down -z; start heading = -z
    x = np.cross(y, z)
    Rw = np.stack([x, y, z])  # rows
    o = first["C"][0] - (first["C"][0] @ n + d) * n


else:
    n = np.array([0.0, 1.0, 0.0]); d = 0.0; cam_h = CAM_HEIGHT; scale = 1.0; scale_guess = 1.0
    Rw = np.eye(3); o = np.zeros(3)
    print("groups leveled individually (metric, floor y=0)")


def to_world(P):
    return ((P - o) @ Rw.T) * scale


# Per-frame poses (prefer the fragment with most frames covering each video frame).
frames = np.arange(NF)
Rall = np.tile(np.eye(3), (NF, 1, 1))
Call = np.zeros((NF, 3))
conf = np.zeros(NF)
for m in sorted(main, key=lambda m: len(m["frames"])):
    ok, R, C = interp(m, frames)
    idx = frames[ok]
    # don't let a fragment cover gaps larger than 1.2 s between its own solved frames
    ks = m["frames"]
    gapmask = np.ones(len(idx), bool)
    j = np.searchsorted(ks, idx)
    j = np.clip(j, 1, len(ks) - 1)
    gapmask = (ks[j] - ks[j - 1]) < FPS * 1.2
    sel = idx[gapmask]
    Rall[sel] = R[gapmask]
    Call[sel] = C[gapmask]
    conf[sel] = 0.5 if m.get("weak") else 1.0
# Fill unsolved frames by holding/blending nearest solved poses.
solved = np.where(conf > 0)[0]
for f in np.where(conf == 0)[0]:
    j = np.searchsorted(solved, f)
    a = solved[max(0, j - 1)]
    b = solved[min(len(solved) - 1, j)]
    w = 0 if a == b else (f - a) / (b - a)
    Rall[f] = Slerp([0, 1], Rot.from_matrix([Rall[a], Rall[b]]))(w).as_matrix()
    Call[f] = Call[a] * (1 - w) + Call[b] * w
# Reject pose outliers (jumps away from a running median) and re-interpolate them.
from scipy.ndimage import median_filter
Cw0 = to_world(Call)
med = np.stack([median_filter(Cw0[:, i], size=61, mode="nearest") for i in range(3)], 1)
bad = np.linalg.norm(Cw0 - med, axis=1) > 0.45
fwd_cam = Rall[:, :, 2]
fmed = np.stack([median_filter(fwd_cam[:, i], size=31, mode="nearest") for i in range(3)], 1)
fmed /= np.linalg.norm(fmed, axis=1, keepdims=True) + 1e-9
bad |= (fwd_cam * fmed).sum(1) < np.cos(np.radians(25))
print(f"rejected {bad.sum()} outlier poses")
conf[bad] = 0
good = np.where(~bad)[0]
for f in np.where(bad)[0]:
    j = np.searchsorted(good, f)
    a, b = good[max(0, j - 1)], good[min(len(good) - 1, j)]
    w = 0 if a == b else (f - a) / (b - a)
    Rall[f] = Slerp([0, 1], Rot.from_matrix([Rall[a], Rall[b]]))(w).as_matrix()
    Call[f] = Call[a] * (1 - w) + Call[b] * w
# Gentle temporal smoothing (removes solve jitter, keeps real motion).
Cw = to_world(Call)
Cw = np.stack([gaussian_filter1d(Cw[:, i], 2.0, mode="nearest") for i in range(3)], 1)
Rw_all = np.einsum("ij,njk->nik", Rw, Rall)
# Convert OpenCV camera (x right, y down, z fwd) to three.js camera (x right, y up, z back).
flip = np.diag([1, -1, -1])
Rthree = np.einsum("nij,jk->nik", Rw_all, flip)
q = Rot.from_matrix(Rthree).as_quat()  # x,y,z,w
for i in range(1, len(q)):
    if np.dot(q[i], q[i - 1]) < 0:
        q[i] = -q[i]
q = np.stack([gaussian_filter1d(q[:, i], 1.5, mode="nearest") for i in range(4)], 1)
q /= np.linalg.norm(q, axis=1, keepdims=True)

# Intrinsics (shared SIMPLE_RADIAL from the biggest fragment), normalised to the 540x960 solve image.
cam = max(main, key=lambda m: len(m["frames"]))["cam"]
fpx, cx, cy = cam["params"][0], cam["params"][1], cam["params"][2]
W, H = cam["w"], cam["h"]

# Depth calibration per solve frame.
dep = cv2.VideoCapture(str(ROOT / f"work/depth/{name}_depth.mp4"))
fits = {}
allpts = {}
for m in main:
    for k, P in m["points"].items():
        allpts[(m["src"], k)] = P
needed = {}
for m in main:
    for fidx in m["frames"][::2]:
        needed.setdefault(int(fidx), []).append(m)
fi = 0
cur = None
for target in sorted(needed):
    while fi <= target:
        ok, cur = dep.read()
        fi += 1
    if cur is None:
        continue
    dimg = cur[:, :, 0].astype(np.float32) / 255.0
    zs, ds = [], []
    for m in needed[target]:
        kidx = int(np.where(m["frames"] == target)[0][0])
        Rwc, C = m["Rwc"][kidx], m["C"][kidx]
        for u, v, pid in m["obs"][target]:
            P = m["points"].get(int(pid))
            if P is None:
                continue
            pc = Rwc.T @ (P - C)
            if pc[2] <= 0:
                continue
            zm = pc[2] * scale
            px, py = int(u / W * dimg.shape[1]), int(v / H * dimg.shape[0])
            if 0 <= px < dimg.shape[1] and 0 <= py < dimg.shape[0]:
                zs.append(zm)
                ds.append(dimg[py, px])
    if len(zs) < 25:
        continue
    zs, ds = np.array(zs), np.array(ds)
    inv = 1 / zs
    bestf = None
    for _ in range(200):
        i2 = rng.choice(len(zs), 2, replace=False)
        if abs(ds[i2[0]] - ds[i2[1]]) < 0.02:
            continue
        a = (inv[i2[0]] - inv[i2[1]]) / (ds[i2[0]] - ds[i2[1]])
        b = inv[i2[0]] - a * ds[i2[0]]
        if a <= 0:
            continue
        r = np.abs(a * ds + b - inv) / inv
        inl = r < 0.2
        if bestf is None or inl.sum() > bestf[0]:
            bestf = (inl.sum(), inl)
    if bestf is None:
        continue
    inl = bestf[1]
    A = np.stack([ds[inl], np.ones(inl.sum())], 1)
    a, b = np.linalg.lstsq(A, inv[inl], rcond=None)[0]
    if a > 0:
        fits[target] = (float(a), float(b), int(inl.sum()))
fk = np.array(sorted(fits))
fa = np.array([fits[k][0] for k in fk])
fb = np.array([fits[k][1] for k in fk])
fa = gaussian_filter1d(fa, 3, mode="nearest")
fb = gaussian_filter1d(fb, 3, mode="nearest")
A_all = np.interp(frames, fk, fa)
B_all = np.interp(frames, fk, fb)
print(f"depth fits: {len(fits)} frames, a median {np.median(fa):.3f}, b median {np.median(fb):.3f}")

# Top-down occupancy for the illustrated floor plan.
P = to_world(np.stack(list(allpts.values())))
band = P[(P[:, 1] > 0.25) & (P[:, 1] < 2.6)]
floor_pts = band[:, [0, 2]]

out = {
    "name": name, "fps": FPS, "frames": NF,
    "intrinsics": {"fx": fpx / W, "fy": fpx / H, "cx": cx / W, "cy": cy / H, "note": "normalised to image width/height"},
    "camera_height_m": CAM_HEIGHT,
    "pos": np.round(Cw, 3).ravel().tolist(),
    "quat": np.round(q, 4).ravel().tolist(),
    "conf": conf.round(2).tolist(),
    "depth_a": np.round(A_all, 4).tolist(), "depth_b": np.round(B_all, 4).tolist(),
    "floor_points_xz": np.round(floor_pts[rng.choice(len(floor_pts), min(6000, len(floor_pts)), replace=False)], 2).tolist(),
}
json.dump(out, open(ROOT / f"app/public/data/camera_{name}.json", "w"))
print(f"wrote camera_{name}.json: {NF} frames, solved {(conf > 0).mean() * 100:.0f}%, path length {np.linalg.norm(np.diff(Cw, axis=0), axis=1).sum():.1f} m")
