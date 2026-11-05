"""AI camera transitions: walk frame (first) -> station hero photo (last), via OpenRouter video.

  python transitions.py [station_id ...]
Candidates go to work/transitions/<id>/<model>_<n>.mp4 with a JSON log; every call is budget-guarded
and logged to docs/SPEND.md.
"""
import json
import pathlib
import sys
import time
import urllib.request

import cv2
from PIL import Image, ImageOps

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import orclient as o  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "work/transitions"
st = {s["id"]: s for s in json.load(open(ROOT / "app/public/data/stations.json"))["stations"]}
MODELS = [
    ("google/veo-3.1-lite", {"duration": 4, "resolution": "720p", "aspect_ratio": "9:16", "generate_audio": False}, 4 * 0.03 + 0.02),
    ("kwaivgi/kling-v3.0-std", {"duration": 5, "resolution": "720p", "aspect_ratio": "9:16", "generate_audio": False}, 5 * 0.084 + 0.03),
]
LIGHT = {
    "led-camera-screens": "hot magenta and red LED wash",
    "tvs": "pink-violet wash on white walls",
    "projector-screens": "deep blue and violet light",
    "space-screen": "deep blue light",
    "merch": "cool blue and violet light",
    "cpu-terminals": "soft white light with a warm floor glow",
}
DESC = {
    "led-camera-screens": "a row of tall portrait screens on black stands, each showing a gilded digital picture frame",
    "tvs": "a white wall with six screens in a two by three grid",
    "projector-screens": "a wall-sized projection of glowing glyphs and icons",
    "space-screen": "a large touch screen on a black stand in front of white curtains, showing glowing orbits",
    "merch": "white t-shirts pinned to a dark wall",
    "cpu-terminals": "a white plinth with a monitor showing a terminal and a closed laptop",
}


EXTRA = {
    "merch": " Keep exactly the same violet-blue light for the whole move; no lighting changes or flashes.",
    "tvs": " Only the pink-violet venue light; no amber, orange or warm tones at any point.",
    "projector-screens": " The projection wall and the white cube stay perfectly still; no streaks, ribbons or trails.",
    "space-screen": " The touch screen keeps showing the same image the whole time; its picture never changes.",
}
ONLY = [m for m in __import__("os").environ.get("MODELS", "").split(",") if m]


def frames_for(sid):
    s = st[sid]
    d = OUT / sid
    d.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(ROOT / "work/stab/downstairs.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, s["click_frame"])
    ok, f = cap.read()
    first = d / "first.jpg"
    cv2.imwrite(str(first), cv2.resize(f, (720, 1280), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 92])
    im = ImageOps.exif_transpose(Image.open(ROOT / "input/stations" / s["folder"] / s["hero_photo"])).convert("RGB")
    w, h = im.size
    tw = int(h * 9 / 16)
    if tw <= w:
        box = ((w - tw) // 2, 0, (w - tw) // 2 + tw, h)
    else:
        th = int(w * 16 / 9)
        box = (0, (h - th) // 2, w, (h - th) // 2 + th)
    last = d / "last.jpg"
    im.crop(box).resize((720, 1280), Image.LANCZOS).save(last, quality=92)
    return first, last


def prompt(sid):
    return (f"One continuous, smooth, stabilized first-person camera move through a real event venue at night, filmed hands-free. The camera glides forward and arcs gently "
            f"toward {DESC[sid]}, ending framed exactly on it. Photoreal, true to the original lighting: {LIGHT[sid]}, white walls, "
            f"polished stone floor. Preserve every on-screen display and its text exactly. People stay natural and unchanged, no morphing. "
            f"No new objects, no camera equipment, no hands, no text overlays, no cuts, no scene changes. Shallow depth-of-field pull onto the station at the end." + EXTRA.get(sid, ""))


def submit(model, params, first, last, p, est, note):
    o.guard("video", est)
    body = {"model": model, "prompt": p, **params,
            "frame_images": [{"type": "image_url", "image_url": {"url": o.data_url(first)}, "frame_type": "first_frame"},
                             {"type": "image_url", "image_url": {"url": o.data_url(last)}, "frame_type": "last_frame"}]}
    r = o.req("POST", "https://openrouter.ai/api/v1/videos", body, timeout=120)
    return r


def poll(job, timeout=900):
    url = job.get("polling_url") or f"https://openrouter.ai/api/v1/videos/{job['id']}"
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = o.req("GET", url)
        stt = r.get("status")
        if stt in ("completed", "succeeded", "complete"):
            return r
        if stt in ("failed", "error", "cancelled"):
            raise RuntimeError(json.dumps(r)[:400])
        time.sleep(8)
    raise TimeoutError("poll timeout")


def download(r, job, path):
    urls = r.get("unsigned_urls") or r.get("urls") or []
    url = urls[0] if urls else f"https://openrouter.ai/api/v1/videos/{job['id']}/content?index=0"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {o.KEY}"} if "openrouter.ai" in url else {})
    with urllib.request.urlopen(req, timeout=300) as resp:
        path.write_bytes(resp.read())


def main():
    ids = sys.argv[1:] or list(st)
    log_path = OUT / "log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else []
    jobs = []
    for sid in ids:
        first, last = frames_for(sid)
        for model, params, est in MODELS:
            if ONLY and model not in ONLY:
                continue
            n = sum(1 for e in log if e["station"] == sid and e["model"] == model) + 1
            try:
                job = submit(model, params, first, last, prompt(sid), est, f"{sid} transition")
                jobs.append((sid, model, n, job, est))
                print("submitted", sid, model, job.get("id"), flush=True)
            except Exception as e:
                print("submit failed", sid, model, e, flush=True)
    for sid, model, n, job, est in jobs:
        out = OUT / sid / f"{model.split('/')[1]}_{n}.mp4"
        try:
            r = poll(job)
            download(r, job, out)
            cost = (r.get("usage") or {}).get("cost") or est
            o.log_spend("video", model, float(cost), f"{sid} transition #{n}")
            log.append({"station": sid, "model": model, "n": n, "file": str(out.relative_to(ROOT)), "cost": cost})
            print("done", sid, model, out.name, cost, flush=True)
        except Exception as e:
            o.log_spend("video", model, est, f"{sid} transition #{n} (failed: {str(e)[:60]})")
            print("failed", sid, model, e, flush=True)
        log_path.write_text(json.dumps(log, indent=1))


if __name__ == "__main__":
    main()
