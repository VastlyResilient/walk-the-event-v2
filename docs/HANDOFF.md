# Walk the Event: handoff

**Live:** https://vastlyresilient.github.io/walk-the-event-v2/ · **Repo:** https://github.com/VastlyResilient/walk-the-event-v2

## What was built
- **`/` Cinematic Rail.** Both walks (downstairs 119 s, upstairs 129 s) as frame-accurate, scroll/swipe/key/hold-to-walk
  footage with momentum. Drag, mouse or (opt-in) gyro gives a 2.5D look-around with depth parallax. The Hermes guide
  walks the solved floor 2–5 m ahead, never covers a station glow, is occluded by people and pillars, and comments in
  comic bubbles (3 personalities). Six stations glow only inside their visibility windows; tap one for a camera move
  (AI clip or 2.5D dolly) into a photoreal splat pod with the artist's card. Ask Hermes drawer, chapter rail, floor switch,
  stairs moment, intro, outro, deep links, share links.
- **`/map/` Hybrid Map.** Illustrated plans of both floors from the camera solve, chapter and station pins, a mini Hermes
  walking the route. Pins fly into the footage.
- **`/stations/` Station Gallery.** Swipeable pods with cards; `#<station-id>` is shareable.
- **`/lab/`** is cut (see DECISIONS #16).
- **Hermes skill:** `skills/venue-guide/` (SKILL.md + links.json) maps requests like "take me to the robot demo" to deep links.
- **Launch kit:** `launch/` (promo videos, OG image), `docs/X_DRAFTS.md`.

## Two guide versions
- **Sculpted (default):** Bobby's Meshy model, Meshy-rigged and animated, with GPU hair and skirt flow (`app/src/guide/meshy.ts`, `media/guide/hermes-meshy.glb`).
- **Illustrated:** the procedural toon rig (`app/src/guide/model.ts` + `anim.ts`, exportable as `media/guide/hermes-guide.glb`).
- Switch in Settings → Guide look, or with `?guide=toon` / `?guide=meshy`.
- Rebuild the sculpted GLB:
  ```bash
  MESHY_API_KEY=... python pipeline/meshy.py rig work/meshy/rig_in.glb
  MESHY_API_KEY=... python pipeline/meshy.py animate 0,1,14,572,441,338,415 work/meshy/anim_loco.glb
  MESHY_API_KEY=... python pipeline/meshy.py animate 28,290,44,298,313,309,29,27 work/meshy/anim_gest.glb
  MESHY_API_KEY=... python pipeline/meshy.py animate 405,64,78,509,291,39,531 work/meshy/anim_party.glb
  RATIO=0.175 node tools/gltf/build-meshy.mjs work/meshy/rigged.glb app/public/media/guide/hermes-meshy.glb \
    work/meshy/anim_loco.glb:idle,walk,run,turn,stairs,look_around,sway work/meshy/anim_gest.glb:wave_big,wave_hand,hop,cheer,talk_open,talk_hip,call,heart \
    work/meshy/anim_party.glb:dance_joy,dance_night,dance_groove,sprint,wave_help,-,-
  ```
  (`-` skips a clip; every clip that shouldn't travel (idle, turn, gestures, dances) has its hips pinned horizontally so it plays on her spot, since Meshy's walk-turn swings the hips 1.3 m mid-clip; `PIN=` overrides the list.)
  The system Python here lacks CA certificates: prefix Meshy calls with `SSL_CERT_FILE=.venv/lib/python3.12/site-packages/certifi/cacert.pem`.
  ```
  ```

## Routes and deep links
`#floor-down` · `#floor-up` · `#chapter-<id>` (19 ids in `data/beats_*.json`) · `#station-<id>`:
led-camera-screens, tvs, projector-screens, space-screen, merch, cpu-terminals.

## Stations at a glance
| station | in walk at | live window | transition |
|---|---|---|---|
| Self Portrait (led-camera-screens) | 16.6 s | 8.4–17.5 s | AI camera move (kling-v3.0-std) |
| Mandala (tvs) | 39.5 s | 35.0–41.4 s | 2.5D depth dolly |
| The Shape of Everything (projector-screens) | 48.1 s | 46.5–49.8 s | 2.5D depth dolly |
| Hermes Journey (space-screen) | 64.5 s | 58.7–65.0 s | AI camera move (kling-v3.0-std) |
| The Merch Wall (merch) | 83.0 s | 76.6–83.7 s | 2.5D depth dolly |
| Persistence 2 (cpu-terminals) | 91.1 s | 88.1–92.3 s | AI camera move (kling-v3.0-std) |

## Spend
See `docs/SPEND.md`. Total **$5.61** of the $40 cap (video $5.46 of $25). The key had ~$46 of credit at the start.

## Known limitations (honest list)
- **No Hermes mascot drawing was supplied** at the start, so the turnaround and the illustrated guide were built from the brief's description. Bobby later supplied a Meshy sculpt and key, and that became the default sculpted guide. Meshy's auto-rig needs the runtime re-weighting described in DECISIONS #26; with no Meshy point preset, her point is procedural plus a pink pointer beam (DECISIONS #31, #33). Her hands are fused into the skirt in the sculpt; the seam is split at load, but very high arm raises (big wave, cheer) still stretch the sleeve at the armpit. Regenerating the model in an A-pose would remove that.
- **Downstairs 100–119 s** (the pitch-dark passage) can't be tracked. The guide steps out with a line and the footage plays on.
- **Upstairs** is stitched from 3 solve fragments joined at seams; the map's upstairs plan is approximate.
- **Pods** are single-photo splats (Apple SHARP, research licence): convincing within ±12°, not free-orbit.
- **Three of six transitions** use the 2.5D dolly. Their AI clips scored 7/10 after one re-roll, and the brief's gate is 8.
- **Ask Hermes** uses the local grounded engine on the static site until the proxy is deployed (`server/`, needs a Railway token).
- **Colour** matches Apple's renderer (ΔE ≈ 2.4 colour-only). iPhone Photos screenshots of HDR video come out ~7 ΔE
  flatter, a property of the screenshot/EDR pipeline (see `qa/color/REPORT.md`).
- **Scene sense** (DECISIONS #29) works from monocular depth and person masks at 36×64: thin rails or glass can be missed, and people partly out of frame are placed roughly. She avoids them well, not perfectly.
- Tested on Apple-silicon Chrome (GPU) and WebKit via Playwright with mobile emulation. No real-device cloud credentials were available.
- **Live deploy QA** (same suite against GitHub Pages): 88/88 on v2.1. Cold-CDN loads can occasionally exceed the localhost-scoped 3 s start-button target. See `qa/REPORT.md`.

## Re-run the pipeline on new footage
```bash
source .venv/bin/activate                    # torch, transformers, pycolmap, opencv
swiftc -O pipeline/apple_tonemap.swift -o bin/apple_tonemap
bin/apple_tonemap frames input/videos/X.mp4 1080 1920 | ffmpeg -f rawvideo -pix_fmt bgra -s 1080x1920 -r 30000/1001 -i - \
  -i input/videos/X.mp4 -map 0:v -map 1:a -c:v libx264 -crf 14 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a copy work/master/X.mp4
python pipeline/contact_sheets.py work/master/X.mp4 2           # look at every sheet, write data/beats_X.json
python pipeline/stabilize.py work/master/X.mp4 work/stab/X.mp4
python pipeline/depth_masks.py work/stab/X.mp4 X
python pipeline/encode_walk.py X                                # packs colour|depth|mask, writes app/public/media/walk/X
python pipeline/solve_camera.py work/stab/X.mp4 X 6             # (+ gap re-solves: fps end start tag)
python pipeline/build_camera.py X && python pipeline/build_map.py X
```
## Add a station
1. Put photos + the wall card in `input/stations/<LABEL>/`, and a circled screenshot from the walk in `input/breakdown/`.
2. `python pipeline/match_breakdowns.py`, then add the content to `data/stations.json` (verbatim card text only).
3. Add the circled region's polygon to `SEEDS` in `pipeline/track_stations.py`, then run it (writes tracks, window and 3D position).
4. Pod: `sharp predict -i hero.jpg -o work/sharp`, then `splat-transform … --decimate-adaptive 50%` → `.spz` in `app/public/media/pods/`
   and add its intrinsics to `pods/meta.json` (see DECISIONS #15).
5. Optional AI transition: `python pipeline/transitions.py <id>`, score it (`qa/transitions/scores.json`), then `python pipeline/ship_transitions.py`.
6. Add guide lines for it in `data/guide_lines.json` (all three presets).

## Privacy
`pipeline/blur_config.json`: add `{floor, start_s, end_s}` and re-run `encode_walk.py` to blur faces in that segment.
