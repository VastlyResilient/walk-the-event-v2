import sys, cv2, numpy as np
out = sys.argv[1]; rows = []
for v in sys.argv[2:]:
    cap = cv2.VideoCapture(v); n = int(cap.get(7)); fr = []
    for t in [0, 0.2, 0.4, 0.6, 0.8, 0.999]:
        cap.set(1, int(t * (n - 1))); ok, f = cap.read()
        fr.append(cv2.resize(f, (180, 320)) if ok else np.zeros((320, 180, 3), np.uint8))
    rows.append(np.hstack(fr))
cv2.imwrite(out, np.vstack(rows))
