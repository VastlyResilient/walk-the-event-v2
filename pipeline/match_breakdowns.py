"""Find the exact video frame each breakdown screenshot was taken from.

Coarse: normalised cross-correlation of tiny grayscale thumbnails over every frame of
both walks. Fine: SIFT + RANSAC homography inlier count on the top candidates.
Writes data/breakdown_matches.json.
"""
import json
import pathlib
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIDEOS = {"downstairs": ROOT / "work/master/downstairs.mp4", "upstairs": ROOT / "work/master/upstairs.mp4"}
TW, TH = 27, 48


def thumbs(path):
    cap = cv2.VideoCapture(str(path))
    out = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(cv2.resize(f, (TW, TH), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
        out.append(g)
    return np.stack(out)


def norm(a):
    a = a.reshape(len(a), -1) if a.ndim == 3 else a.reshape(1, -1)
    a = a - a.mean(1, keepdims=True)
    return a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-6)


def video_region(img):
    """Crop the letterboxed video area out of a phone screenshot (rows that aren't near-black UI)."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    rows = np.where(g[:, w // 4: 3 * w // 4].mean(1) > 12)[0]
    top, bot = rows[rows > h * 0.02].min(), rows[rows < h * 0.98].max()
    crop = img[top:bot]
    # The video is 9:16; trim to that aspect around the centre of the crop.
    ch = crop.shape[0]
    want = int(round(w * 16 / 9))
    if ch > want:
        o = (ch - want) // 2
        crop = crop[o:o + want]
    return crop, int(top)


def frame_at(path, n):
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, n)
    ok, f = cap.read()
    return f


def main():
    sift = cv2.SIFT_create(4000)
    cache = ROOT / "work/thumbs.npz"
    if cache.exists():
        T = dict(np.load(cache))
    else:
        T = {k: thumbs(v) for k, v in VIDEOS.items()}
        np.savez(cache, **T)
    TN = {k: norm(v) for k, v in T.items()}
    results = {}
    for shot in sorted((ROOT / "input/breakdown").glob("*.jpeg")):
        img = cv2.imread(str(shot))
        crop, top = video_region(img)
        q = cv2.cvtColor(cv2.resize(crop, (TW, TH), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
        qn = norm(q)[0]
        cands = []
        for k in T:
            s = TN[k] @ qn
            for i in np.argsort(-s)[:12]:
                cands.append((float(s[i]), k, int(i)))
        cands.sort(reverse=True)
        qg = cv2.cvtColor(cv2.resize(crop, (540, 960)), cv2.COLOR_BGR2GRAY)
        kq, dq = sift.detectAndCompute(qg, None)
        best = None
        for score, k, i in cands[:16]:
            for j in range(max(0, i - 6), i + 7, 2):
                f = frame_at(VIDEOS[k], j)
                if f is None:
                    continue
                fg = cv2.cvtColor(cv2.resize(f, (540, 960)), cv2.COLOR_BGR2GRAY)
                kf, df = sift.detectAndCompute(fg, None)
                if df is None or len(df) < 8:
                    continue
                m = cv2.BFMatcher().knnMatch(dq, df, k=2)
                good = [a for a, b in (p for p in m if len(p) == 2) if a.distance < 0.75 * b.distance]
                if len(good) < 8:
                    continue
                src = np.float32([kq[g.queryIdx].pt for g in good])
                dst = np.float32([kf[g.trainIdx].pt for g in good])
                H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
                inl = int(mask.sum()) if mask is not None else 0
                if best is None or inl > best["inliers"]:
                    best = {"video": k, "frame": j, "inliers": inl, "ncc": score, "H_shot540_to_frame540": H.tolist()}
        # Refine to the single best frame around the winner.
        k, i = best["video"], best["frame"]
        for j in range(max(0, i - 3), i + 4):
            f = frame_at(VIDEOS[k], j)
            fg = cv2.cvtColor(cv2.resize(f, (540, 960)), cv2.COLOR_BGR2GRAY)
            kf, df = sift.detectAndCompute(fg, None)
            if df is None or len(df) < 8:
                continue
            m = cv2.BFMatcher().knnMatch(dq, df, k=2)
            good = [a for a, b in (p for p in m if len(p) == 2) if a.distance < 0.75 * b.distance]
            if len(good) < 8:
                continue
            src = np.float32([kq[g.queryIdx].pt for g in good])
            dst = np.float32([kf[g.trainIdx].pt for g in good])
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
            inl = int(mask.sum()) if mask is not None else 0
            if inl > best["inliers"]:
                best.update(frame=j, inliers=inl, H_shot540_to_frame540=H.tolist())
        best["time_s"] = round(best["frame"] * 1001 / 30000, 3)
        best["crop_top_px"] = top
        best["crop_size"] = [int(crop.shape[1]), int(crop.shape[0])]
        results[shot.name] = best
        print(shot.name, {k: v for k, v in best.items() if not k.startswith("H")}, flush=True)
        cv2.imwrite(str(ROOT / f"work/match_{shot.stem}.jpg"),
                    np.hstack([cv2.resize(crop, (360, 640)), cv2.resize(frame_at(VIDEOS[k], best["frame"]), (360, 640))]))
    (ROOT / "data/breakdown_matches.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
