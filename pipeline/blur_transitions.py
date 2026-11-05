"""Privacy face blur for the station transition clips (app/public/media/transitions/*.mp4).

  python pipeline/blur_transitions.py [id ...]      # default: every forward clip linked in stations.json

The clips are short (5 s, 720x1280), so there is no tracking: SCRFD runs on every frame (plain + CLAHE-lifted
copy, upscaled 2x for the small faces), and each detection is also applied to the 3 frames either side so the
blur never flickers off for a missed frame. Uses face_track.blur_frame, the same soft ellipse as the walk.
The forward clip is blurred in place and the _rev clip is re-made from it, as ship_transitions.py does.
Needs: pip install onnxruntime opencv-python numpy
"""
import json
import pathlib
import subprocess
import sys

import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from face_detect import SCRFD, enhance  # noqa: E402
from face_track import blur_frame  # noqa: E402

TR = ROOT / "app/public/media/transitions"
W, H = 720, 1280
SPREAD = 3
COMMON = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]


def read(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def write(frames, path, vf=None):
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", "24", "-i", "-"]
    p = subprocess.Popen(cmd + (["-vf", vf] if vf else []) + COMMON + [str(path)], stdin=subprocess.PIPE)
    for f in frames:
        p.stdin.write(f.tobytes())
    p.stdin.close()
    assert p.wait() == 0, path


def blur_clip(sid, det):
    fwd = TR / f"{sid}.mp4"
    frames = read(fwd)
    dets = []
    for f in frames:
        d = np.vstack([det.detect(f, 0.35, 2.0), det.detect(enhance(f), 0.45, 2.0)])
        dets.append(d)
    out, n = [], 0
    for i, f in enumerate(frames):
        ells = []
        for j in range(max(0, i - SPREAD), min(len(frames), i + SPREAD + 1)):
            for x0, y0, x1, y1, _ in dets[j]:
                ells.append(((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 1.0, 0))
        n += bool(len(dets[i]))
        out.append(blur_frame(f, ells))
    write(out, fwd)
    write(out[::-1], TR / f"{sid}_rev.mp4")
    print(f"{sid}: {len(frames)} frames, faces found in {n}")


if __name__ == "__main__":
    ids = sys.argv[1:] or [s["id"] for s in json.load(open(ROOT / "app/public/data/stations.json"))["stations"]
                          if s.get("transition")]
    det = SCRFD()
    for sid in ids:
        blur_clip(sid, det)
