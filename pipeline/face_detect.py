"""Face detectors for the privacy blur (see face_track.py).

SCRFD-10G (InsightFace buffalo_l det_10g.onnx, run with onnxruntime) is the main detector: it is the most reliable
here on small, dim, magenta/blue-lit and profile faces. YuNet (OpenCV zoo) is kept for comparison tests.
Models live in pipeline/models/ (det_10g.onnx from github.com/deepinsight/insightface releases v0.7 buffalo_l.zip,
yunet.onnx = face_detection_yunet_2023mar.onnx from github.com/opencv/opencv_zoo).
Needs: pip install onnxruntime opencv-python numpy
"""
import pathlib

import cv2
import numpy as np

MODELS = pathlib.Path(__file__).resolve().parent / "models"


def nms(boxes, scores, thr=0.4):
    if len(boxes) == 0:
        return []
    x0, y0, x1, y1 = boxes.T
    area = (x1 - x0) * (y1 - y0)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(i)
        xx0 = np.maximum(x0[i], x0[order[1:]]); yy0 = np.maximum(y0[i], y0[order[1:]])
        xx1 = np.minimum(x1[i], x1[order[1:]]); yy1 = np.minimum(y1[i], y1[order[1:]])
        inter = np.clip(xx1 - xx0, 0, None) * np.clip(yy1 - yy0, 0, None)
        iou = inter / (area[i] + area[order[1:]] - inter + 1e-9)
        order = order[1:][iou < thr]
    return keep


class SCRFD:
    def __init__(self, path=MODELS / "det_10g.onnx", threads=0):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.log_severity_level = 3
        if threads:
            so.intra_op_num_threads = threads
        self.s = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
        self.inp = self.s.get_inputs()[0].name
        self.strides = (8, 16, 32)
        self._anchors = {}

    def _centers(self, h, w, stride):
        k = (h, w, stride)
        if k not in self._anchors:
            gy, gx = np.mgrid[:h, :w]
            c = (np.stack([gx, gy], -1).reshape(-1, 2) * stride).astype(np.float32)
            self._anchors[k] = np.repeat(c, 2, 0)  # 2 anchors per cell
        return self._anchors[k]

    def detect(self, bgr, thr=0.3, scale=1.0):
        """Returns array of [x0, y0, x1, y1, score] in input-image pixels."""
        h0, w0 = bgr.shape[:2]
        H, W = int(round(h0 * scale / 32)) * 32, int(round(w0 * scale / 32)) * 32
        sx, sy = W / w0, H / h0
        img = cv2.resize(bgr, (W, H), interpolation=cv2.INTER_LINEAR if scale > 1 else cv2.INTER_AREA)
        blob = cv2.dnn.blobFromImage(img, 1 / 128, (W, H), (127.5, 127.5, 127.5), swapRB=True)
        outs = self.s.run(None, {self.inp: blob})
        boxes, scores = [], []
        for i, st in enumerate(self.strides):
            sc = outs[i][:, 0]
            bb = outs[i + 3] * st
            c = self._centers(H // st, W // st, st)
            m = sc >= thr
            if not m.any():
                continue
            c, bb = c[m], bb[m]
            boxes.append(np.stack([c[:, 0] - bb[:, 0], c[:, 1] - bb[:, 1], c[:, 0] + bb[:, 2], c[:, 1] + bb[:, 3]], 1))
            scores.append(sc[m])
        if not boxes:
            return np.zeros((0, 5), np.float32)
        boxes = np.concatenate(boxes); scores = np.concatenate(scores)
        boxes[:, [0, 2]] /= sx; boxes[:, [1, 3]] /= sy
        k = nms(boxes, scores)
        return np.hstack([boxes[k], scores[k, None]]).astype(np.float32)


class YuNet:
    def __init__(self, path=MODELS / "yunet.onnx"):
        self.d = cv2.FaceDetectorYN.create(str(path), "", (320, 320), 0.3, 0.3, 5000)

    def detect(self, bgr, thr=0.3, scale=1.0):
        img = cv2.resize(bgr, None, fx=scale, fy=scale) if scale != 1 else bgr
        self.d.setInputSize((img.shape[1], img.shape[0]))
        self.d.setScoreThreshold(thr)
        _, f = self.d.detect(img)
        if f is None:
            return np.zeros((0, 5), np.float32)
        b = f[:, :4] / scale
        return np.hstack([b[:, :2], b[:, :2] + b[:, 2:4], f[:, 14:15]]).astype(np.float32)


def enhance(bgr):
    """Lift dim, saturated stage lighting: CLAHE on luminance, applied to a desaturated copy."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l = cv2.createCLAHE(2.5, (8, 8)).apply(lab[..., 0])
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    g = cv2.addWeighted(g, 0.5, l, 0.5, 0)
    g = cv2.createCLAHE(3.0, (8, 8)).apply(g)
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
