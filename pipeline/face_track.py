"""Privacy face blur, offline part: detect guest faces, track + smooth them, write per-frame blur ellipses.

  python face_track.py detect <floor> [stride]   # SCRFD on work/stab/<floor>.mp4 -> pipeline/faces/<floor>_dets.npz
  python face_track.py track  <floor>            # dets (+ people-mask head fallback) -> pipeline/faces/<floor>_tracks.json
  python face_track.py sheet  <floor> f1 f2 ...  # debug contact sheet of the blur on source frames

encode_walk.py reads <floor>_tracks.json (when pipeline/blur_config.json has "all_faces": true) and bakes the
blur into the colour panel only (depth / people mask panels untouched) before encoding, so the segment layout,
frame counts and GOPs are exactly those of a normal encode.

Detection: SCRFD-10G at native 1080x1920, run only on the horizontal band of the frame that contains people
(from the SegFormer people mask, work/depth/<floor>_mask.mp4), alternating plain frames and a CLAHE-lifted
grey copy (which catches the dim magenta / blue-lit faces the plain pass misses). Faces whose box is not on the
people mask (station screens, artworks, posters) are dropped. Tracks are linked across frames, gaps are
interpolated, boxes smoothed and padded, and the blur fades in/out over a few frames so nothing pops.
"""
import json
import pathlib
import subprocess
import sys
import time

import cv2
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from vread import frames as vframes  # noqa: E402

OUT = HERE / "faces"
W, H = 1080, 1920
MW, MH = 360, 640  # people mask size


def mask_frames(floor):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(ROOT / f"work/depth/{floor}_mask.mp4"), "-f", "rawvideo",
                          "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
    while True:
        b = p.stdout.read(MW * MH)
        if len(b) < MW * MH:
            break
        yield np.frombuffer(b, np.uint8).reshape(MH, MW)
    p.wait()


def nframes(floor):
    return json.load(open(ROOT / f"app/public/media/walk/{floor}/meta.json"))["frames"]


# ----------------------------------------------------------------------------------------------- detect
def detect(floor, stride=1):
    from face_detect import SCRFD, enhance
    det = SCRFD()
    OUT.mkdir(exist_ok=True)
    n = nframes(floor)
    path = OUT / f"{floor}_dets.npz"
    rows, start = [], 0
    if path.exists():  # resume
        z = np.load(path)
        rows = list(z["d"]); start = int(z["next"])
    cg, mg = vframes(ROOT / f"work/stab/{floor}.mp4", W, H), mask_frames(floor)
    t0, done = time.time(), 0
    for i in range(n):
        c, m = next(cg), next(mg)
        if i < start or i % stride:
            continue
        r = (m > 40).any(1)
        if r.any():
            ys = np.nonzero(r)[0]
            y0 = max(0, int(ys[0] * 3) - 96)
            y1 = min(H, int(ys[-1] * 3) + 96)
            y0 = max(0, min(y0, y1 - 256))
            y1 = y0 + max(256, ((y1 - y0 + 31) // 32) * 32)
            if y1 > H:
                y0, y1 = max(0, H - (y1 - y0)), H
            mode = (i // stride) % 2  # 0 plain, 1 enhanced
            crop = c[y0:y1]
            d = det.detect(enhance(crop) if mode else crop, thr=0.25)
            for x0, a0, x1, a1, s in d:
                rows.append([i, x0, a0 + y0, x1, a1 + y0, s, mode])
        done += 1
        if done % 50 == 0:
            np.savez(path, d=np.array(rows, np.float32).reshape(-1, 7), next=i + 1)
            el = time.time() - t0
            print(f"{floor} f{i}/{n} {done / el:.2f} fps, dets {len(rows)}, eta {(n - i) / stride / (done / el) / 60:.0f} min",
                  flush=True)
    np.savez(path, d=np.array(rows, np.float32).reshape(-1, 7), next=n)
    print(floor, "detect done", len(rows))


def people_band(m):
    r = (m > 40).any(1)
    if not r.any():
        return None
    ys = np.nonzero(r)[0]
    return max(0, int(ys[0] * 3) - 96), min(H, int(ys[-1] * 3) + 96)


def pose_heads(kp, sc, ox=0, oy=0):
    """Head boxes from RTMO body keypoints (COCO order: 0 nose, 1-2 eyes, 3-4 ears, 5-6 shoulders). Only people
    whose face is at least partly towards the camera (nose or an eye visible)."""
    out = []
    for k, s in zip(kp, sc):
        face = s[:3].max()
        if face < 0.45:
            continue
        vis = [j for j in range(5) if s[j] > 0.3]
        if len(vis) < 2:
            continue
        pts = k[vis]
        span = float(np.max(np.linalg.norm(pts[:, None] - pts[None], axis=2)))
        size = span * 1.5
        if s[5] > 0.3 and s[6] > 0.3:
            size = max(size, 0.42 * float(np.linalg.norm(k[5] - k[6])))
        if size < 8:
            continue
        cx, cy = float(pts[:, 0].mean()), float(pts[:, 1].mean())
        cy += 0.08 * size  # keypoints sit at eye level; the face centre is a little lower
        out.append([cx - size / 2 + ox, cy - size * 0.6 + oy, cx + size / 2 + ox, cy + size * 0.6 + oy, float(face)])
    return out


def detect_pose(floor, stride=2):
    from rtmlib import RTMO
    model = RTMO(str(HERE / "models/rtmo-m_body7_640.onnx"), model_input_size=(640, 640), backend="onnxruntime",
                 device="cpu")
    OUT.mkdir(exist_ok=True)
    n = nframes(floor)
    path = OUT / f"{floor}_pose.npz"
    rows, start = [], 0
    if path.exists():
        z = np.load(path)
        rows = list(z["d"]); start = int(z["next"])
    cg, mg = vframes(ROOT / f"work/stab/{floor}.mp4", W, H), mask_frames(floor)
    t0, done = time.time(), 0
    for i in range(n):
        c, m = next(cg), next(mg)
        if i < start or i % stride:
            continue
        band = people_band(m)
        if band:
            y0, y1 = band
            kp, sc = model(np.ascontiguousarray(c[y0:y1]))
            for b in pose_heads(kp, sc, 0, y0):
                rows.append([i] + b + [2])
        done += 1
        if done % 50 == 0:
            np.savez(path, d=np.array(rows, np.float32).reshape(-1, 7), next=i + 1)
            el = time.time() - t0
            print(f"{floor} pose f{i}/{n} {done / el:.2f} fps, heads {len(rows)}, eta {(n - i) / stride / (done / el) / 60:.0f} min", flush=True)
    np.savez(path, d=np.array(rows, np.float32).reshape(-1, 7), next=n)
    print(floor, "pose done", len(rows))


# ----------------------------------------------------------------------------------------------- track
def weak_big(t):
    """A face track that is large but never scores well: either a dim/turned real face or the back of a head.
    These get a facing check from the pose model (see posecheck / track)."""
    s = np.array(t["s"])
    wmed = float(np.median([b[2] - b[0] for b in t["b"]]))
    return wmed >= 20 and not (np.median(s) >= 0.45 or np.mean(s > 0.5) >= 0.3)


def posecheck(floor, stride=3):
    """Run RTMO on the frames of weak, big face tracks and store every person's head + shoulder keypoints, so
    track() can tell a turned-away head (blur not needed) from a dim face (keep)."""
    from rtmlib import RTMO
    model = RTMO(str(HERE / "models/rtmo-m_body7_640.onnx"), model_input_size=(640, 640), backend="onnxruntime",
                 device="cpu")
    D = np.load(OUT / f"{floor}_dets.npz")["d"]
    want = set()
    for t in link(D):
        if weak_big(t):
            want.update(range(t["f"][0], t["f"][-1] + 1, stride))
    rows = []
    cg, mg = vframes(ROOT / f"work/stab/{floor}.mp4", W, H), mask_frames(floor)
    t0 = time.time()
    for i in range(max(want) + 1 if want else 0):
        c, m = next(cg), next(mg)
        if i not in want:
            continue
        band = people_band(m)
        if not band:
            continue
        y0, y1 = band
        kp, sc = model(np.ascontiguousarray(c[y0:y1]))
        for k, q in zip(kp, sc):
            r = [i]
            for j in range(7):
                r += [float(k[j, 0]), float(k[j, 1] + y0), float(q[j])]
            rows.append(r)
    np.save(OUT / f"{floor}_posecheck.npy", np.array(rows, np.float32).reshape(-1, 22))
    print(floor, "posecheck", len(want), "frames", len(rows), "people", f"{time.time() - t0:.0f}s")


def facing(t, PC):
    """Fraction of checked frames where the person under this box faces away / towards the camera."""
    away = towards = n = 0
    for f, b in zip(t["f"], t["b"]):
        rows = PC.get(int(f))
        if rows is None:
            continue
        w = b[2] - b[0]
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        best = None
        for r in rows:
            k = r[1:].reshape(7, 3)
            head = k[:5][k[:5, 2] > 0.2]
            if len(head) == 0:
                head = k[:5]
            hx, hy = float(np.median(head[:, 0])), float(np.median(head[:, 1]))
            d = np.hypot(hx - cx, hy - cy)
            if d < 1.2 * w and (best is None or d < best[0]):
                best = (d, k)
        if best is None:
            continue
        k = best[1]
        n += 1
        fv = k[:3, 2].max()
        if fv >= 0.5:
            towards += 1
        elif fv < 0.3:
            away += 1
    return n, away, towards


def iou(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[2], b[2]), min(a[3], b[3])
    i = max(0, x1 - x0) * max(0, y1 - y0)
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)


def mask_cover(m, b):
    x0, y0, x1, y1 = [int(round(v / 3)) for v in b[:4]]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(MW, max(x1, x0 + 1)), min(MH, max(y1, y0 + 1))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    return float((m[y0:y1, x0:x1] > 60).mean())


def smooth(v, r):
    if len(v) < 3:
        return v
    k = np.ones(2 * r + 1) / (2 * r + 1)
    pad = np.pad(v, ((r, r), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, j], k, "valid") for j in range(v.shape[1])], 1)


def link(D, maxgap=12):
    """Greedy frame-to-frame association of boxes (rows [frame, x0, y0, x1, y1, score, ...])."""
    tracks, active = [], []
    byf = {}
    for r in D:
        byf.setdefault(int(r[0]), []).append(r)
    for f in sorted(byf):
        dets = sorted(byf[f], key=lambda r: -r[5])
        active = [t for t in active if f - t["f"][-1] <= maxgap]
        pairs = []
        for ti, t in enumerate(active):
            lb = t["b"][-1]
            lw = lb[2] - lb[0]
            gap = f - t["f"][-1]
            for di, r in enumerate(dets):
                bb = r[1:5]
                cd = np.hypot((bb[0] + bb[2] - lb[0] - lb[2]) / 2, (bb[1] + bb[3] - lb[1] - lb[3]) / 2)
                sr = (bb[2] - bb[0]) / max(lw, 1)
                ov = iou(lb, bb)
                if 0.72 < sr < 1.4 and (ov > 0.25 or cd < lw * (0.5 + 0.1 * gap)):
                    pairs.append((cd / max(lw, 1) - ov, ti, di))
        pairs.sort()
        tused, used = set(), set()
        for _, ti, di in pairs:
            if ti in tused or di in used:
                continue
            tused.add(ti); used.add(di)
            t = active[ti]; r = dets[di]
            t["f"].append(f); t["b"].append(r[1:5].copy()); t["s"].append(float(r[5]))
        for di, r in enumerate(dets):
            if di not in used:
                t = {"f": [f], "b": [r[1:5].copy()], "s": [float(r[5])]}
                tracks.append(t); active.append(t)
    return tracks


def emit(t, src, ell, n, hold):
    """Interpolate + smooth one track and append its per-frame ellipses (with fade in/out) to ell."""
    f = np.array(t["f"]); b = np.array(t["b"], np.float32)
    cx, cy = (b[:, 0] + b[:, 2]) / 2, (b[:, 1] + b[:, 3]) / 2
    w, h = b[:, 2] - b[:, 0], b[:, 3] - b[:, 1]
    fr = np.arange(f[0], f[-1] + 1)
    v = np.stack([np.interp(fr, f, x) for x in (cx, cy, w, h)], 1)
    v[:, :2] = smooth(v[:, :2], 3)
    v[:, 2:] = smooth(v[:, 2:], 7)  # size: smoother than position
    a0, a1 = max(0, f[0] - hold), min(n - 1, f[-1] + hold)
    m = min(4, len(v) - 1)
    v0 = (v[m] - v[0]) / max(m, 1)
    v1 = (v[-1] - v[-1 - m]) / max(m, 1)
    for i in range(a0, a1 + 1):
        k = min(max(i - f[0], 0), len(v) - 1)
        x, y, ww, hh = v[k]
        if i < f[0]:  # extrapolate with the end velocities so the ellipse keeps following the head
            x, y = x + v0[0] * (i - f[0]), y + v0[1] * (i - f[0])
        elif i > f[-1]:
            x, y = x + v1[0] * (i - f[-1]), y + v1[1] * (i - f[-1])
        alpha = min(1.0, (min(i - a0, a1 - i) + 1) / 5)
        ell[i].append([round(float(x), 1), round(float(y), 1), round(float(ww), 1), round(float(hh), 1), round(alpha, 2), src])
    return int(a1 - a0 + 1)


def track(floor):
    n = nframes(floor)
    D = np.load(OUT / f"{floor}_dets.npz")["d"]
    pp = OUT / f"{floor}_pose.npz"
    P = np.load(pp)["d"] if pp.exists() else np.zeros((0, 7), np.float32)
    # drop boxes that are not on a person (station screens, artworks, posters, reflections)
    keepD, keepP = np.zeros(len(D), bool), np.zeros(len(P), bool)
    idxD, idxP = {}, {}
    for j, r in enumerate(D):
        idxD.setdefault(int(r[0]), []).append(j)
    for j, r in enumerate(P):
        idxP.setdefault(int(r[0]), []).append(j)
    for i, m in enumerate(mask_frames(floor)):
        for j in idxD.get(i, []):
            bb = D[j, 1:5]
            w, h = bb[2] - bb[0], bb[3] - bb[1]
            keepD[j] = 6 <= w <= 420 and 0.6 <= h / max(w, 1) <= 2.2 and mask_cover(m, bb) >= 0.35
        for j in idxP.get(i, []):
            keepP[j] = mask_cover(m, P[j, 1:5]) >= 0.2
    D, P = D[keepD], P[keepP]
    print(floor, "face dets on people", len(D), "of", keepD.size, "| pose heads", len(P), "of", keepP.size)

    ell = [[] for _ in range(n)]
    stats = {}
    good = []
    pc = OUT / f"{floor}_posecheck.npy"
    PC = {}
    if pc.exists():
        for r in np.load(pc):
            PC.setdefault(int(r[0]), []).append(r)
    away_dropped = 0
    for t in link(D):
        s = np.array(t["s"])
        ok = s.max() >= 0.55 or (len(s) >= 3 and s.mean() >= 0.33) or (len(s) >= 2 and s.max() >= 0.45)
        if ok and PC and np.median(s) < 0.6 and np.median([b[2] - b[0] for b in t["b"]]) >= 20:
            # big box that never scores well: drop it only when the body model says the person faces away
            # (back of a head / hair); dim or turned faces stay blurred
            n_, away, towards = facing(t, PC)
            if n_ >= 2 and away >= 0.6 * n_ and towards <= 0.15 * n_:
                ok = False
                away_dropped += 1
        if ok:
            good.append(t)
    stats["back_of_head_tracks_dropped"] = away_dropped
    stats["face_tracks"] = len(good)
    stats["face_track_frames"] = sum(emit(t, 0, ell, n, 7) for t in good)
    goodp = []
    for t in link(P, 16):
        s = np.array(t["s"])
        if (len(s) >= 2 and s.mean() >= 0.5) or s.max() >= 0.8:
            goodp.append(t)
    stats["pose_head_tracks"] = len(goodp)
    stats["pose_head_frames"] = sum(emit(t, 1, ell, n, 8) for t in goodp)
    stats["frames_with_blur"] = sum(1 for e in ell if e)
    stats["ellipses"] = sum(len(e) for e in ell)
    json.dump({"floor": floor, "frames": n, "format": "per frame: [cx, cy, w, h, alpha, src] in 1080x1920 colour px "
               "(unpadded head/face box); src 0 = SCRFD face track, 1 = RTMO pose head track", "stats": stats,
               "ellipses": ell}, open(OUT / f"{floor}_tracks.json", "w"), separators=(",", ":"))
    print(floor, stats)


# ----------------------------------------------------------------------------------------------- blur
def blur_frame(img, ells, sx=1.0, sy=1.0):
    """Soft-edged elliptical blur. img: colour panel (any size); ells in 1080x1920 px; sx, sy scale to img."""
    if not ells:
        return img
    out = img.copy()
    Hh, Ww = img.shape[:2]
    for cx, cy, w, h, alpha, src in ells:
        if alpha <= 0:
            continue
        cx, cy, w, h = cx * sx, cy * sy, w * sx, h * sy
        if src == 0:  # face box -> padded head ellipse (hair, ears, turned/profile heads), nudged up a little
            ew, eh = w * 1.75, h * 1.9
            cy -= h * 0.08
        else:  # pose head box is already head-sized
            ew, eh = w * 1.3, h * 1.3
        ew, eh = max(ew, 6), max(eh, 6)
        feather = max(2.0, 0.18 * min(ew, eh))
        x0, y0 = int(max(0, cx - ew / 2 - 2 * feather)), int(max(0, cy - eh / 2 - 2 * feather))
        x1, y1 = int(min(Ww, cx + ew / 2 + 2 * feather + 1)), int(min(Hh, cy + eh / 2 + 2 * feather + 1))
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        sigma = max(2.0, 0.085 * min(ew, eh / 1.15))  # ~face width / 12: features gone, still reads as footage
        pad = int(3 * sigma) + 1
        X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(Ww, x1 + pad), min(Hh, y1 + pad)
        roi = out[Y0:Y1, X0:X1].astype(np.float32)
        bl = cv2.GaussianBlur(roi, (0, 0), sigma, borderType=cv2.BORDER_REPLICATE)
        m = np.zeros((Y1 - Y0, X1 - X0), np.float32)
        cv2.ellipse(m, (int(round((cx - X0) * 4)), int(round((cy - Y0) * 4))),
                    (int(round(ew / 2 * 4)), int(round(eh / 2 * 4))), 0, 0, 360, 1.0, -1, cv2.LINE_AA, 2)
        m = cv2.GaussianBlur(m, (0, 0), feather) * alpha
        m = m[..., None]
        out[Y0:Y1, X0:X1] = np.clip(roi * (1 - m) + bl * m + 0.5, 0, 255).astype(np.uint8)
    return out


def load_tracks(floor):
    p = OUT / f"{floor}_tracks.json"
    return json.load(open(p))["ellipses"] if p.exists() else None


def sheet(floor, fs, dst=None, debug=False, crop_h=760):
    """Before/after review sheet: per frame a full-res crop (crop_h rows centred on the people) side by side.
    debug=True outlines the ellipses (green = face track, yellow = pose head) and raw face dets dropped (red)."""
    ells = load_tracks(floor)
    raw = np.load(OUT / f"{floor}_dets.npz")["d"] if debug else None
    want = sorted(int(f) for f in fs)
    cg, mg = vframes(ROOT / f"work/stab/{floor}.mp4", W, H), mask_frames(floor)
    tiles = []
    for i in range(want[-1] + 1):
        c, m = next(cg), next(mg)
        if i not in want:
            continue
        e = ells[i]
        if e:
            cy = float(np.median([x[1] for x in e]))
        else:
            band = people_band(m)
            cy = (band[0] + band[1]) / 2 if band else H / 2
        y0 = int(min(max(0, cy - crop_h / 2), H - crop_h))
        a = c.copy()
        bimg = blur_frame(c.copy(), e)
        if debug:
            for x in e:
                col = (0, 255, 0) if x[5] == 0 else (0, 255, 255)
                k = 1.75 if x[5] == 0 else 1.3
                cv2.ellipse(bimg, (int(x[0]), int(x[1])), (int(x[2] * k / 2), int(x[3] * k / 2 * (1.9 / 1.75 if x[5] == 0 else 1))), 0, 0, 360, col, 1)
            for r in raw[raw[:, 0] == i]:
                cv2.rectangle(a, (int(r[1]), int(r[2])), (int(r[3]), int(r[4])), (0, 0, 255) if r[5] < 0.5 else (0, 128, 255), 1)
        a, bimg = a[y0:y0 + crop_h], bimg[y0:y0 + crop_h]
        cv2.putText(a, f"{floor} f{i}  before", (12, 34), 0, 1.0, (255, 255, 255), 2)
        cv2.putText(bimg, f"after  ({len(e)} blurred)", (12, 34), 0, 1.0, (255, 255, 255), 2)
        tiles.append(np.hstack([a, np.full((crop_h, 8, 3), 255, np.uint8), bimg]))
    dst = dst or OUT / f"{floor}_sheet.jpg"
    cv2.imwrite(str(dst), np.vstack([np.vstack([t, np.full((8, t.shape[1], 3), 255, np.uint8)]) for t in tiles]),
                [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(dst)


if __name__ == "__main__":
    cmd, floor = sys.argv[1], sys.argv[2]
    if cmd == "detect":
        detect(floor, int(sys.argv[3]) if len(sys.argv) > 3 else 1)
    elif cmd == "pose":
        detect_pose(floor, int(sys.argv[3]) if len(sys.argv) > 3 else 2)
    elif cmd == "posecheck":
        posecheck(floor)
    elif cmd == "track":
        track(floor)
    elif cmd in ("sheet", "debug"):
        fs = [x for x in sys.argv[3:] if not x.startswith("--out=")]
        out = [x[6:] for x in sys.argv[3:] if x.startswith("--out=")]
        sheet(floor, fs, out[0] if out else None, debug=cmd == "debug")
