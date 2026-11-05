"""Colour-correct frame reader: ffmpeg decodes honouring the BT.709 tags (OpenCV assumes BT.601)."""
import subprocess

import numpy as np


def frames(path, w, h):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         stdout=subprocess.PIPE, bufsize=w * h * 3 * 4)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)
    p.wait()
