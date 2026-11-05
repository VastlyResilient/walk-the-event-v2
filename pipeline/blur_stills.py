"""Privacy face blur for the station photos and the station splat made from one of them.

  python pipeline/blur_stills.py

STILLS lists hand-placed head ellipses (cx, cy, w, h in the 1200x1600 station photo; the detector misses these
profile / on-screen faces and fires on the printed shirt faces instead). Each photo and its _t thumbnail get
face_track.blur_frame. If the station's pod splat was made from that photo, the Gaussians that project into the
ellipse are recoloured with a blurred copy of their own colours, so the 3D view matches the blurred photo.
Run once: it overwrites the files in place.
Needs: pip install opencv-python numpy, and npx (for @playcanvas/splat-transform).
"""
import json
import pathlib
import subprocess
import sys
import tempfile

import cv2
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from face_track import blur_frame  # noqa: E402

MEDIA = ROOT / "app/public/media"
ST = "npx -y @playcanvas/splat-transform@3.10.3".split()
# photo -> ([head ellipses in 1200x1600 px], pod id made from this photo or None)
STILLS = {
    "merch_IMG_3828": ([(28, 885, 130, 180)], "merch"),
    "led-camera-screens_IMG_3852": ([(1104, 609, 16, 22)], None),
}


def blur_photo(name, ells):
    for suffix in ("", "_t"):
        p = MEDIA / f"stations/{name}{suffix}.jpg"
        img = cv2.imread(str(p))
        s = img.shape[1] / 1200
        out = blur_frame(img, [(cx, cy, w, h, 1.0, 1) for cx, cy, w, h in ells], s, s)
        cv2.imwrite(str(p), out, [cv2.IMWRITE_JPEG_QUALITY, 90])


def read_ply(path):
    with open(path, "rb") as f:
        hdr = b""
        while not hdr.endswith(b"end_header\n"):
            hdr += f.readline()
        lines = hdr.decode().split("\n")
        n = int(next(l for l in lines if l.startswith("element vertex")).split()[-1])
        props = []
        for l in lines[lines.index(next(l for l in lines if l.startswith("element vertex"))) + 1:]:
            if not l.startswith("property"):
                break
            props.append(l.split()[-1])
        v = np.frombuffer(f.read(n * 4 * len(props)), "<f4").reshape(n, len(props)).copy()
        rest = f.read()
    return hdr, props, v, rest


def blur_pod(pid, ells):
    meta = json.load(open(MEDIA / "pods/meta.json"))[pid]
    fx, _, cx, _, fy, cy = meta["intrinsic"][:6]
    iw, ih = meta["image_size"]
    s = iw / 1200
    spz = MEDIA / f"pods/{pid}.spz"
    with tempfile.TemporaryDirectory() as td:
        ply = pathlib.Path(td) / "in.ply"
        subprocess.run(ST + [str(spz), str(ply)], check=True, capture_output=True)
        hdr, props, v, rest = read_ply(ply)
        P = {k: i for i, k in enumerate(props)}
        x, y, z = v[:, P["x"]], v[:, P["y"]], v[:, P["z"]]
        ok = z > 1e-3
        u = np.where(ok, fx * x / np.where(ok, z, 1) + cx, -1)
        w = np.where(ok, fy * y / np.where(ok, z, 1) + cy, -1)
        dc = v[:, [P["f_dc_0"], P["f_dc_1"], P["f_dc_2"]]]
        # colour image of the splat at 1/8 photo size, blurred like the photo, sampled back inside the ellipse
        k = 8
        gw, gh = iw // k, ih // k
        gi = np.clip((u / k).astype(int), 0, gw - 1); gj = np.clip((w / k).astype(int), 0, gh - 1)
        inside = ok & (u >= 0) & (u < iw) & (w >= 0) & (w < ih)
        acc = np.zeros((gh, gw, 3)); cnt = np.zeros((gh, gw, 1))
        np.add.at(acc, (gj[inside], gi[inside]), dc[inside]); np.add.at(cnt, (gj[inside], gi[inside]), 1)
        acc, cnt = acc.astype(np.float32), cnt.astype(np.float32)
        changed = 0
        for ecx, ecy, ew, eh in ells:
            ecx, ecy, ew, eh = ecx * s, ecy * s, ew * s * 1.3, eh * s * 1.3
            sigma = max(2.0, 0.085 * min(ew, eh / 1.15)) / k
            # normalised blur, so empty cells don't pull the colour towards grey
            bl = cv2.GaussianBlur(acc, (0, 0), sigma) / np.maximum(cv2.GaussianBlur(cnt, (0, 0), sigma), 1e-6)[..., None]
            d = ((u - ecx) / (ew / 2)) ** 2 + ((w - ecy) / (eh / 2)) ** 2
            a = np.clip((1.25 - d) / 0.5, 0, 1) * inside  # soft edge, like blur_frame's feather
            m = a > 0
            dc[m] = dc[m] * (1 - a[m, None]) + bl[gj[m], gi[m]] * a[m, None]
            changed += int(m.sum())
        v[:, [P["f_dc_0"], P["f_dc_1"], P["f_dc_2"]]] = dc
        out = pathlib.Path(td) / "out.ply"
        with open(out, "wb") as f:
            f.write(hdr); f.write(v.astype("<f4").tobytes()); f.write(rest)
        subprocess.run(ST + ["--spz-version", "3", "-w", str(out), str(spz)], check=True, capture_output=True)
    print(f"{pid}.spz: recoloured {changed} of {len(v)} Gaussians")


if __name__ == "__main__":
    for name, (ells, pid) in STILLS.items():
        blur_photo(name, ells)
        print(f"{name}: blurred {len(ells)} head(s)")
        if pid:
            blur_pod(pid, ells)
