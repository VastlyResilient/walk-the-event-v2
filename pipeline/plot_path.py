import json, sys, numpy as np, cv2
name = sys.argv[1]
d = json.load(open(f'app/public/data/camera_{name}.json'))
P = np.array(d['pos']).reshape(-1, 3); fl = np.array(d['floor_points_xz']); conf = np.array(d['conf'])
allx = np.concatenate([P[:, 0], fl[:, 0]]); allz = np.concatenate([P[:, 2], fl[:, 1]])
mn = np.array([np.percentile(allx, 1), np.percentile(allz, 1)]); mx = np.array([np.percentile(allx, 99), np.percentile(allz, 99)])
mn = np.minimum(mn, [P[:, 0].min(), P[:, 2].min()]); mx = np.maximum(mx, [P[:, 0].max(), P[:, 2].max()])
S = 700 / max(mx - mn)
img = np.full((int((mx - mn)[1] * S) + 40, int((mx - mn)[0] * S) + 40, 3), 255, np.uint8)
tp = lambda x, z: (int((x - mn[0]) * S) + 20, int((z - mn[1]) * S) + 20)
for x, z in fl: cv2.circle(img, tp(x, z), 1, (190, 190, 190), -1)
for i in range(len(P) - 1):
    c = (0, 0, 255) if conf[i] == 0 else ((0, 160, 0) if conf[i] == 1 else (255, 120, 0))
    cv2.line(img, tp(P[i, 0], P[i, 2]), tp(P[i + 1, 0], P[i + 1, 2]), c, 2)
for t in range(0, len(P), 300): cv2.putText(img, f'{t/29.97:.0f}s', tp(P[t, 0], P[t, 2]), 0, 0.5, (0, 0, 0), 1)
cv2.imwrite(f'work/path_{name}.png', img)
sp = np.linalg.norm(np.diff(P, axis=0), axis=1) * 29.97
print('max speed', sp.max().round(2), 'p99', np.percentile(sp, 99).round(2), 'y', P[:, 1].min().round(2), P[:, 1].max().round(2))
