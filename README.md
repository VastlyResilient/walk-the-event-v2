# Walk the Event: NousCon NYC 2026

**Live:** https://vastlyresilient.github.io/walk-the-event-v2/

Missed NousCon? Walk it. Scroll through the real phone footage of both floors while the Hermes guide, an
on-model toon companion, leads the way, points out every station and opens each one into a photoreal 3D pod
with the artist's own wall card.

- `/`: **Cinematic Rail**. Footage-first scroll walk with 2.5D look-around, the 3D guide, glowing stations,
  AI camera transitions into splat pods + cards, Ask Hermes.
- `/map/`: **Hybrid Map**. Illustrated floor plans drawn from the camera solve; tap a pin to fly into the footage.
- `/stations/`: **Station Gallery**. Swipe through every station pod; shareable per station (`/stations/#merch`).
- `/lab/`: World Mode. Cut (didn't pass the "no scan look" gate); see `docs/DECISIONS.md`.

Deep links: `#floor-down`, `#floor-up`, `#chapter-<id>`, `#station-<id>` (ids in `skills/venue-guide/SKILL.md`).

## Run it

```bash
cd app && npm install && npm run dev        # http://localhost:5199
npm run build                               # BASE_PATH=/repo-name/ for GitHub Pages
```

Optional Ask Hermes proxy (keeps the OpenRouter key server-side):

```bash
OPENROUTER_API_KEY=... ALLOW_ORIGIN=https://<site> node server/server.mjs   # then build with VITE_ASK_URL=https://<proxy>/ask
```

Without the proxy the drawer answers locally from the station cards, so it never breaks.

## How it's made

| Stage | What | Where |
|---|---|---|
| Colour | HLG/BT.2020 → BT.709 via Apple AVFoundation (QuickTime look), ffmpeg-only reads after | `pipeline/apple_tonemap.swift`, `pipeline/vread.py`, `qa/color/` |
| Watch | 2 fps contact sheets → beats + chapters, Whisper transcript | `pipeline/contact_sheets.py`, `data/beats_*.json` |
| Stabilise | KLT + similarity, Gaussian trajectory, 7% crop | `pipeline/stabilize.py` |
| Depth/masks | Depth Anything V2 + SegFormer person masks | `pipeline/depth_masks.py` |
| Camera solve | pycolmap, fragment stitching, floor levelling, metric scale | `pipeline/solve_camera.py`, `pipeline/build_camera.py` |
| Encode | colour + depth + mask packed per frame, H.264 closed GOP 10, 10 s segments | `pipeline/encode_walk.py` |
| Stations | breakdown frame matching, KLT/homography tracking, ray triangulation | `pipeline/match_breakdowns.py`, `pipeline/track_stations.py` |
| Pods | Apple SHARP single-photo splats → SPZ, rendered with Spark | `tools/ml-sharp`, `app/src/pod/pod.ts` |
| Transitions | OpenRouter first/last-frame video (Kling v3 / Veo 3.1 Lite), art-director scored | `pipeline/transitions.py`, `qa/transitions/` |
| Guide (sculpted, default) | Bobby's Meshy model → Meshy rig + 15 clips, skirt/sleeve re-weighting, GPU hair/skirt flow | `pipeline/meshy.py`, `tools/gltf/build-meshy.mjs`, `app/src/guide/meshy.ts` |
| Guide (illustrated) | procedural rig, IK foot-lock, toon + ink, behaviour brain, 3 personalities | `app/src/guide/`, `data/guide_lines.json` |
| Map | plan from the solve | `pipeline/build_map.py`, `app/src/map/` |

Everything is documented in `docs/` (`DECISIONS.md`, `RESEARCH.md`, `SPEND.md`, `HANDOFF.md`) and QA lives in `qa/`.

## Credits

Footage, photos and breakdowns: Bobby. Station texts are the artists' wall cards: Joshua Wolk (*Self Portrait*),
Kevin Esherick (*Mandala*), Jteve Sobs (*The Shape of Everything*), Morry Kolman (*Persistence 2*). *Hermes Journey*
and merch: [Nous Research](https://nousresearch.com/). The Hermes character belongs to Nous Research; this is a fan
rendition. Station pods are AI-reconstructed (Apple SHARP, research licence). Station transitions are AI-assisted
camera moves. Not an official Nous Research site.

## License

The code and pipeline (everything outside `app/public/media/`) are [MIT](LICENSE). The media is not: the event
footage, photos, audio, station pods, transitions and guide model are shared for this recap only, the station
texts belong to the artists, and the Hermes character belongs to Nous Research. Faces of guests are blurred
(`pipeline/face_track.py`, `pipeline/blur_transitions.py`, `pipeline/blur_stills.py`).
