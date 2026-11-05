"""Meshy rigging + animation for the user's Hermes model. Key comes from MESHY_API_KEY (never stored).

  python meshy.py rig <in.glb>            -> work/meshy/rig_task.json, rigged + walk/run GLBs
  python meshy.py library <search>        -> list preset actions
  python meshy.py animate <id,id,...> <out.glb>
  python meshy.py gen <image.png> <out_dir>  -> image-to-3D in A-pose (Meshy latest), GLB + task json
"""
import base64
import json
import os
import pathlib
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "work/meshy"
KEY = os.environ["MESHY_API_KEY"]
API = "https://api.meshy.ai/openapi/v1"


def req(method, url, body=None):
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=300) as resp:
        return json.loads(resp.read())


def wait(kind, tid):
    while True:
        t = req("GET", f"{API}/{kind}/{tid}")
        print(kind, t["status"], t.get("progress"), flush=True)
        if t["status"] in ("SUCCEEDED", "FAILED", "CANCELED"):
            return t
        time.sleep(6)


def download(url, path):
    with urllib.request.urlopen(url, timeout=300) as r:
        pathlib.Path(path).write_bytes(r.read())
    print("saved", path, pathlib.Path(path).stat().st_size)


cmd = sys.argv[1]
if cmd == "rig":
    OUT = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else OUT
    data = base64.b64encode(pathlib.Path(sys.argv[2]).read_bytes()).decode()
    tid = req("POST", f"{API}/rigging", {"model_url": f"data:application/octet-stream;base64,{data}", "height_meters": 1.6})["result"]
    t = wait("rigging", tid)
    (OUT / "rig_task.json").write_text(json.dumps(t, indent=1))
    if t["status"] == "SUCCEEDED":
        r = t["result"]
        download(r["rigged_character_glb_url"], OUT / "rigged.glb")
        download(r["basic_animations"]["walking_glb_url"], OUT / "walking.glb")
        download(r["basic_animations"]["running_glb_url"], OUT / "running.glb")
    print("credits", t.get("consumed_credits"), t.get("task_error"))
elif cmd == "gen":
    img = pathlib.Path(sys.argv[2]); out = pathlib.Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
    body = {"image_url": "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode(), "ai_model": "latest",
            "pose_mode": "a-pose", "should_texture": True, "texture_resolution": "2k", "should_remesh": True,
            "topology": "triangle", "target_polycount": 80000, "target_formats": ["glb"], "multi_view_thumbnails": True}
    tid = req("POST", f"{API}/image-to-3d", body)["result"]
    t = wait("image-to-3d", tid)
    (out / "gen_task.json").write_text(json.dumps(t, indent=1))
    print("credits", t.get("consumed_credits"), t.get("task_error"))
    if t["status"] == "SUCCEEDED":
        download(t["model_urls"]["glb"], out / "gen.glb")
        for i, u in enumerate(t.get("thumbnail_urls") or []):
            pass  # thumbnails are optional (shape varies: list of urls or a dict of views)
elif cmd == "retex":
    # same mesh + same UVs, new 4K texture (and PBR maps) painted from the same reference image
    tid_in, img, out = sys.argv[2], pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]); out.mkdir(parents=True, exist_ok=True)
    body = {"input_task_id": tid_in, "image_style_url": "data:image/png;base64," + base64.b64encode(img.read_bytes()).decode(),
            "ai_model": "latest", "enable_original_uv": True, "enable_pbr": True, "texture_resolution": os.environ.get("RES", "4k"),
            "target_formats": ["glb"]}
    tid = req("POST", f"{API}/retexture", body)["result"]
    t = wait("retexture", tid)
    (out / "retex_task.json").write_text(json.dumps(t, indent=1))
    print("credits", t.get("consumed_credits"), t.get("task_error"))
    if t["status"] == "SUCCEEDED":
        download(t["model_urls"]["glb"], out / "retex.glb")
        for i, tx in enumerate(t.get("texture_urls") or []):
            for k, u in tx.items():
                download(u, out / f"{k}_{i}.png")
elif cmd == "library":
    q = urllib.parse.quote(sys.argv[2]) if len(sys.argv) > 2 else ""
    import urllib.parse
    res = req("GET", f"{API}/animations/library?search={urllib.parse.quote(sys.argv[2])}&page_size=50")
    items = res if isinstance(res, list) else res.get("result", res.get("data", res))
    for a in items:
        print(a.get("action_id"), "|", a.get("name"), "|", a.get("category"), "|", a.get("sub_category"))
elif cmd == "animate":
    rig = json.loads(pathlib.Path(os.environ.get("RIG_TASK", OUT / "rig_task.json")).read_text())
    ids = [int(x) for x in sys.argv[2].split(",")]
    body = {"rig_task_id": rig["id"], "action_ids": ids, "post_process": {"operation_type": "change_fps", "fps": 30}} if len(ids) > 1 else {"rig_task_id": rig["id"], "action_id": ids[0]}
    tid = req("POST", f"{API}/animations", body)["result"]
    t = wait("animations", tid)
    print(json.dumps({k: t.get(k) for k in ("status", "consumed_credits", "task_error")}))
    if t["status"] == "SUCCEEDED":
        download(t["result"]["animation_glb_url"], sys.argv[3])
