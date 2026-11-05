"""Contact sheet of the worst remaining frame per failing metric of an audit run (one tile per metric: the fail frame
of the scenario whose worst span is longest / largest).

  python qa/tools/worst_sheet.py <run> <out.jpg>
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
ROOT = Path(__file__).resolve().parents[2]
run = ROOT / "qa/runs/audit" / sys.argv[1]
b = json.load(open(run / "summary.json"))
ff = sorted((run / "fail_frames").glob("*.jpg"))
tiles = []
for m in ["offscreen", "hidden", "teleport", "glide", "snap_turn", "smooth", "foot_slide", "float_sink", "depth", "blockers_rails", "people", "size", "proximity", "posture", "perf"]:
    best = None
    for r in b["results"]:
        mm = r["metrics"].get(m)
        if not mm or mm["pass"] or not mm.get("worst"):
            continue
        w = mm["worst"][0]
        key = (w.get("dur") or 0) + abs(w.get("value") or 0) * 0.01
        if best is None or key > best[0]:
            best = (key, r["floor"], r["scenario"], w)
    if not best:
        continue
    _, fl, sc, w = best
    cand = [f for f in ff if f.name.startswith(f"{fl}_{sc}_") and f.name.endswith(f"_{m}.jpg")]
    if not cand:
        continue
    pick = min(cand, key=lambda f: abs(int(f.name.split("_f")[1].split("_")[0]) - (w.get("frame") or 0)))
    im = Image.open(pick).convert("RGB")
    d = ImageDraw.Draw(im); d.rectangle([0, 0, im.width, 44], fill=(0, 0, 0))
    d.text((6, 4), f"{m}: {fl} {sc} f{w.get('frame')}", fill=(255, 255, 0)); d.text((6, 24), f"{w.get('what', '')[:48]} = {w.get('value')} ({w.get('dur')} s)", fill=(255, 255, 255))
    tiles.append(im)
if tiles:
    W, H = tiles[0].size
    cols = min(5, len(tiles)); rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, H * rows))
    for i, im in enumerate(tiles):
        sheet.paste(im.resize((W, H)), ((i % cols) * W, (i // cols) * H))
    sheet.save(sys.argv[2], quality=85)
print(len(tiles), "tiles ->", sys.argv[2])
