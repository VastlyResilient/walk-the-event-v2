"""Track each station region through the stabilised downstairs walk and locate it in 3D.

Seed polygons come from the circled regions in the breakdown screenshots (normalised to the
video frame), mapped into stabilised frame space with the stabiliser's per-frame matrix.
Tracking: KLT features inside the region -> RANSAC homography frame to frame, forward and
backward from the matched frame, re-seeding features every 6 frames.
World position: least-squares intersection of camera rays through the region centre.
Writes app/public/data/stations.json (content + tracks).
"""
import json
import pathlib

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial.transform import Rotation as Rot

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 540, 960
# Object regions read off the breakdown screenshots (u, v in 0..1 of the video frame).
SEEDS = {
    "led-camera-screens": [(0.09, 0.36), (0.39, 0.43), (0.39, 0.6), (0.09, 0.65)],
    "space-screen": [(0.74, 0.34), (0.995, 0.33), (0.995, 0.56), (0.74, 0.565)],
    "merch": [(0.005, 0.355), (0.21, 0.37), (0.21, 0.56), (0.005, 0.57)],
    "cpu-terminals": [(0.77, 0.43), (0.88, 0.43), (0.88, 0.52), (0.77, 0.52)],
    "projector-screens": [(0.72, 0.33), (0.9, 0.33), (0.9, 0.475), (0.72, 0.48)],
    # TVs were only captured in photos: the arrow points off the left edge of the curved walkway.
    "tvs": [(0.0, 0.40), (0.07, 0.41), (0.07, 0.5), (0.0, 0.51)],
}
MAX_SPAN = {"tvs": 1.6}

st = json.load(open(ROOT / "data/stations.json"))
stab = json.load(open(ROOT / "work/stab/downstairs.mp4.transforms.json"))
mats = [np.array(m) for m in stab["matrices"]]
cam = json.load(open(ROOT / "app/public/data/camera_downstairs.json"))
NF = cam["frames"]

print("loading frames...", flush=True)
cap = cv2.VideoCapture(str(ROOT / "work/stab/downstairs.mp4"))
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY))
print(len(frames), "frames", flush=True)


def to_stab(poly_uv, fi):
    M = mats[fi]
    P = np.array([[u * 1080, v * 1920, 1] for u, v in poly_uv]).T
    Q = (M @ P).T
    return np.array([[x / 1080 * W, y / 1920 * H] for x, y in Q], np.float32)


def track(poly0, f0, step, limit):
    polys = {f0: poly0.copy()}
    poly = poly0.copy()
    pts = None
    f = f0
    lost = 0
    while 0 <= f + step < len(frames) and abs(f + step - f0) <= limit:
        g0, g1 = frames[f], frames[f + step]
        if pts is None or len(pts) < 25 or (f - f0) % 6 == 0:
            mask = np.zeros_like(g0)
            c = poly.mean(0)
            grown = (poly - c) * 1.6 + c
            cv2.fillConvexPoly(mask, grown.astype(np.int32), 255)
            pts = cv2.goodFeaturesToTrack(g0, 300, 0.005, 6, mask=mask)
        if pts is None or len(pts) < 8:
            break
        p1, s, _ = cv2.calcOpticalFlowPyrLK(g0, g1, pts, None, winSize=(21, 21), maxLevel=3)
        p0b, s2, _ = cv2.calcOpticalFlowPyrLK(g1, g0, p1, None, winSize=(21, 21), maxLevel=3)
        good = (s.ravel() == 1) & (s2.ravel() == 1) & (np.linalg.norm(pts - p0b, axis=2).ravel() < 1.0)
        if good.sum() < 8:
            lost += 1
            if lost > 3:
                break
            f += step
            polys[f] = poly.copy()
            pts = None
            continue
        Hm, inl = cv2.findHomography(pts[good], p1[good], cv2.RANSAC, 2.5)
        if Hm is None or inl.sum() < 14 or inl.sum() < 0.45 * good.sum():
            break  # track quality collapsed: stop rather than drift
        poly = cv2.perspectiveTransform(poly[None], Hm)[0]
        pts = p1[good][inl.ravel() == 1].reshape(-1, 1, 2)
        f += step
        polys[f] = poly.copy()
        c = poly.mean(0)
        if c[0] < -0.35 * W or c[0] > 1.35 * W or c[1] < -0.3 * H or c[1] > 1.3 * H:
            break
        area = cv2.contourArea(poly.astype(np.float32))
        if area < 40 or area > W * H * 1.5:
            break
    return polys


def visibility(poly):
    clip = np.clip(poly, [0, 0], [W, H])
    a = cv2.contourArea(poly.astype(np.float32))
    ai = cv2.contourArea(clip.astype(np.float32)) if a > 0 else 0
    inside = ai / a if a > 0 else 0
    size = ai / (W * H)
    return float(inside), float(size)


pos = np.array(cam["pos"]).reshape(-1, 3)
quat = np.array(cam["quat"]).reshape(-1, 4)
I = cam["intrinsics"]


def ray(fi, u, v):
    """World ray through normalised pixel (u,v) for frame fi (three.js camera convention)."""
    x = (u - I["cx"]) / I["fx"]
    y = (v - I["cy"]) / I["fy"]
    d_cam = np.array([x, -y, -1.0])
    R = Rot.from_quat(quat[fi]).as_matrix()
    d = R @ d_cam
    return pos[fi], d / np.linalg.norm(d)


out = []
for s in st["stations"]:
    sid = s["id"]
    f0 = int(round(s["video_timestamp"] * 30000 / 1001))
    seed = to_stab(SEEDS[sid], f0)
    lim = int(MAX_SPAN.get(sid, 9.0) * 29.97)
    fw = track(seed, f0, 1, lim)
    bw = track(seed, f0, -1, lim)
    polys = {**bw, **fw}
    ks = sorted(polys)
    P = np.array([polys[k] for k in ks])
    # Temporal smoothing of the corners keeps the glow locked without jitter.
    P = gaussian_filter1d(P, 1.2, axis=0, mode="nearest")
    vis = []
    for k, p in zip(ks, P):
        inside, size = visibility(p)
        live = inside > 0.55 and size > 0.004
        if sid == "tvs":
            live = inside > 0.2  # off-frame beacon: live while the edge region is tracked
        vis.append((k, inside, size, live))
    live_frames = [k for k, _, _, l in vis if l]
    # Largest contiguous live run containing (or nearest to) f0
    runs, cur = [], []
    for k in live_frames:
        if cur and k != cur[-1] + 1:
            runs.append(cur); cur = []
        cur.append(k)
    if cur:
        runs.append(cur)
    run = min(runs, key=lambda r: 0 if r[0] <= f0 <= r[-1] else min(abs(r[0] - f0), abs(r[-1] - f0))) if runs else [f0]
    win = (run[0], run[-1])
    if sid == "tvs":
        win = (1050, 1240)  # photo-only: the edge beacon covers the whole curved walkway
    # Triangulate region centre from rays across the window (only well-solved frames).
    A = np.zeros((3, 3)); b = np.zeros(3); used = 0
    for k, p in zip(ks, P):
        if not (win[0] <= k <= win[1]) or cam["conf"][k] < 1:
            continue
        c = p.mean(0)
        o, d = ray(k, c[0] / W, c[1] / H)
        M = np.eye(3) - np.outer(d, d)
        A += M; b += M @ o; used += 1
    world = None
    if used >= 8:
        world = np.linalg.lstsq(A, b, rcond=None)[0]
        # sanity: must be in front of the camera at f0 and within 25 m
        o, d = ray(f0, *(P[ks.index(f0)].mean(0) / [W, H]))
        dist = np.dot(world - o, d)
        if dist < 0.5 or dist > 25:
            world = o + d * 4.0
    else:
        c = P[ks.index(f0)].mean(0)
        o, d = ray(f0, c[0] / W, c[1] / H)
        world = o + d * 4.0
    if sid == "tvs":
        # Off-frame to the left of the walkway: place it ~3 m left of the camera at the breakdown frame.
        o, _ = ray(f0, 0.5, 0.5)
        R = Rot.from_quat(quat[f0]).as_matrix()
        left = -R[:, 0]
        left[1] = 0
        left /= np.linalg.norm(left)
        world = o + left * 3.0
    world = np.array(world, dtype=float)
    world[1] = max(0.6, min(world[1], 2.2))
    track_json = {"start": int(ks[0]), "polys": np.round(P / [W, H], 4).reshape(len(ks), -1).tolist(),
                  "inside": [round(v[1], 3) for v in vis]}
    s2 = dict(s)
    s2.update({
        "click_frame": f0,
        "visibility_window": [int(win[0]), int(win[1])],
        "visibility_window_s": [round(win[0] / 29.97, 2), round(win[1] / 29.97, 2)],
        "screen_region_track": track_json,
        "world_position": np.round(world, 3).tolist(),
        "offscreen": sid == "tvs",
        "photo_urls": [f"media/stations/{sid}_{p.rsplit('.', 1)[0]}.jpg" for p in s["photos"]],
        "hero_url": f"media/stations/{sid}_{s['hero_photo'].rsplit('.', 1)[0]}.jpg",
        "pod_url": f"media/pods/{sid}.spz",
        "transition": None,
    })
    out.append(s2)
    print(f"{sid}: tracked {ks[0]}..{ks[-1]} ({len(ks)} f), live {win[0]}..{win[1]} ({(win[1]-win[0])/29.97:.1f}s), rays {used}, world {np.round(world, 2)}", flush=True)
    dbg = cv2.cvtColor(frames[f0], cv2.COLOR_GRAY2BGR)
    cv2.polylines(dbg, [P[ks.index(f0)].astype(np.int32)], True, (255, 0, 255), 2)
    for k in (win[0], win[1]):
        im = cv2.cvtColor(frames[k], cv2.COLOR_GRAY2BGR)
        cv2.polylines(im, [P[ks.index(k)].astype(np.int32)], True, (255, 0, 255), 2)
        dbg = np.hstack([dbg, im])
    cv2.imwrite(str(ROOT / f"work/track_{sid}.jpg"), cv2.resize(dbg, None, fx=0.5, fy=0.5))

st["stations"] = out
json.dump(st, open(ROOT / "app/public/data/stations.json", "w"), indent=1)
