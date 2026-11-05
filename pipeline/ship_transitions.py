"""Ship art-director-approved AI transitions: trim frame 0, encode forward + reversed, link in stations.json.

Only clips with verdict "ship" (overall >= 8) are used; everything else keeps the 2.5D dolly fallback.
"""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
scores = json.load(open(ROOT / "qa/transitions/scores.json"))
log = json.load(open(ROOT / "work/transitions/log.json"))
out = ROOT / "app/public/media/transitions"
out.mkdir(parents=True, exist_ok=True)
stp = ROOT / "app/public/data/stations.json"
st = json.load(open(stp))
for s in st["stations"]:
    sc = scores.get(s["id"], {})
    s["transition"] = None
    if sc.get("verdict") != "ship":
        continue
    model = sc["pick"]
    n = sc.get("n")
    cands = [e for e in log if e["station"] == s["id"] and e["model"].endswith(model) and (n is None or e["n"] == n)]
    src = ROOT / cands[-1]["file"]
    f, r = out / f"{s['id']}.mp4", out / f"{s['id']}_rev.mp4"
    common = ["-an", "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
              "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "trim=start_frame=1,setpts=PTS-STARTPTS,scale=720:1280", *common, str(f)], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(f), "-vf", "reverse", *common, str(r)], check=True)
    s["transition"] = {"url": f"media/transitions/{s['id']}.mp4", "reverse_url": f"media/transitions/{s['id']}_rev.mp4",
                       "first_frame": s["click_frame"], "model": cands[-1]["model"], "score": sc.get(model, {}).get("overall")}
    print("shipped", s["id"], model, f.stat().st_size // 1024, "KB")
json.dump(st, open(stp, "w"), indent=1)
