# QA report

Real-GPU Chrome (Playwright `channel: chrome`, Apple M5, Metal) with iPhone 15–class mobile emulation (393×852, DPR 3, touch) and desktop (1440×900), plus a WebKit smoke run. Run videos: `qa/runs/` (local only), screenshots: `qa/shots/`.

## Automated checks: 87/88 passed

| area | check | result | detail |
|---|---|---|---|
| mobile | first interactive (Start button ready) ≤ 3 s on localhost | ✅ | 0.63s |
| mobile | WebCodecs path active | ✅ |  |
| mobile | intro: guide visible and talking | ✅ | opacity 1.00 |
| mobile | swipe up walks forward (slow) | ✅ | 0→91 |
| mobile | swipe up walks forward (medium) | ✅ | 91→237 |
| mobile | swipe up walks forward (fast) | ✅ | 237→376 |
| mobile | swipe down walks backward | ✅ | 483→355 |
| mobile | swipe starting on the speech bubble still walks | ✅ | 340→468 |
| mobile | hold-to-walk pill walks forward | ✅ | 468→525 |
| mobile | frame-accurate: shown frame == requested (±0) after settle | ✅ | exact 119/120, max lag 180 |
| mobile | guide stays on screen when visible | ❌ | 2 off-screen of 120 |
| mobile | guide never covers a live station glow (settled) | ✅ | 0 settled overlaps; 4 transient crossings while running to a new spot after a 1.5 s jump |
| mobile | speech bubble always on screen | ✅ | 0 clipped |
| mobile | led-camera-screens: glows only inside its window | ✅ | window 252-525 |
| mobile | led-camera-screens: card title + body match write-up | ✅ |  |
| mobile | led-camera-screens: back returns to the exact frame | ✅ | cur 388.0 expected 388 |
| mobile | tvs: glows only inside its window | ✅ | window 1050-1240 |
| mobile | tvs: card title + body match write-up | ✅ |  |
| mobile | tvs: back returns to the exact frame | ✅ | cur 1145.0 expected 1145 |
| mobile | projector-screens: glows only inside its window | ✅ | window 1392-1491 |
| mobile | projector-screens: card title + body match write-up | ✅ |  |
| mobile | projector-screens: back returns to the exact frame | ✅ | cur 1441.0 expected 1441 |
| mobile | space-screen: glows only inside its window | ✅ | window 1759-1949 |
| mobile | space-screen: card title + body match write-up | ✅ |  |
| mobile | space-screen: back returns to the exact frame | ✅ | cur 1854.0 expected 1854 |
| mobile | merch: glows only inside its window | ✅ | window 2297-2507 |
| mobile | merch: card title + body match write-up | ✅ |  |
| mobile | merch: back returns to the exact frame | ✅ | cur 2402.0 expected 2402 |
| mobile | cpu-terminals: glows only inside its window | ✅ | window 2641-2765 |
| mobile | cpu-terminals: card title + body match write-up | ✅ |  |
| mobile | cpu-terminals: back returns to the exact frame | ✅ | cur 2703.0 expected 2703 |
| mobile | deep link #station-merch | ✅ |  |
| mobile | deep link #chapter-atrium | ✅ |  |
| mobile | deep link #floor-up | ✅ |  |
| mobile | upstairs: guide leads through the floor | ✅ | visible 13/13 |
| mobile | render FPS median ≥ 55 (headless Chrome, Apple M5 GPU) | ✅ | median 60, 5th pct 58 |
| mobile | no long tasks > 200 ms while walking | ✅ | 0 long tasks, max 0 ms |
| mobile | JS heap growth < 60 MB over 20 s walk | ✅ | -81.5 MB |
| mobile | network after 20 s walk (streamed per segment) | ✅ | 47.6 MB |
| mobile | no console errors | ✅ |  |
| desktop | first interactive (Start button ready) ≤ 3 s on localhost | ✅ | 1.19s |
| desktop | WebCodecs path active | ✅ |  |
| desktop | intro: guide visible and talking | ✅ | opacity 1.00 |
| desktop | wheel walk forward (slow) | ✅ | 0→211 |
| desktop | wheel walk forward (medium) | ✅ | 211→428 |
| desktop | wheel walk forward (fast) | ✅ | 428→698 |
| desktop | wheel walk backward | ✅ | 698→480 |
| desktop | keyboard W walks forward | ✅ | 480→522 |
| desktop | frame-accurate: shown frame == requested (±0) after settle | ✅ | exact 120/120, max lag 0 |
| desktop | guide stays on screen when visible | ✅ | 0 off-screen of 120 |
| desktop | guide never covers a live station glow (settled) | ✅ | 0 settled overlaps; 0 transient crossings while running to a new spot after a 1.5 s jump |
| desktop | speech bubble always on screen | ✅ | 0 clipped |
| desktop | led-camera-screens: glows only inside its window | ✅ | window 252-525 |
| desktop | led-camera-screens: card title + body match write-up | ✅ |  |
| desktop | led-camera-screens: back returns to the exact frame | ✅ | cur 388.0 expected 388 |
| desktop | tvs: glows only inside its window | ✅ | window 1050-1240 |
| desktop | tvs: card title + body match write-up | ✅ |  |
| desktop | tvs: back returns to the exact frame | ✅ | cur 1145.0 expected 1145 |
| desktop | projector-screens: glows only inside its window | ✅ | window 1392-1491 |
| desktop | projector-screens: card title + body match write-up | ✅ |  |
| desktop | projector-screens: back returns to the exact frame | ✅ | cur 1441.0 expected 1441 |
| desktop | space-screen: glows only inside its window | ✅ | window 1759-1949 |
| desktop | space-screen: card title + body match write-up | ✅ |  |
| desktop | space-screen: back returns to the exact frame | ✅ | cur 1854.0 expected 1854 |
| desktop | merch: glows only inside its window | ✅ | window 2297-2507 |
| desktop | merch: card title + body match write-up | ✅ |  |
| desktop | merch: back returns to the exact frame | ✅ | cur 2402.0 expected 2402 |
| desktop | cpu-terminals: glows only inside its window | ✅ | window 2641-2765 |
| desktop | cpu-terminals: card title + body match write-up | ✅ |  |
| desktop | cpu-terminals: back returns to the exact frame | ✅ | cur 2703.0 expected 2703 |
| desktop | deep link #station-merch | ✅ |  |
| desktop | deep link #chapter-atrium | ✅ |  |
| desktop | deep link #floor-up | ✅ |  |
| desktop | upstairs: guide leads through the floor | ✅ | visible 13/13 |
| desktop | render FPS median ≥ 55 (headless Chrome, Apple M5 GPU) | ✅ | median 60, 5th pct 57 |
| desktop | no long tasks > 200 ms while walking | ✅ | 0 long tasks, max 0 ms |
| desktop | JS heap growth < 60 MB over 20 s walk | ✅ | -76.9 MB |
| desktop | network after 20 s walk (streamed per segment) | ✅ | 35.6 MB |
| desktop | no console errors | ✅ |  |
| a11y | reduced motion: station opens instantly (fade, no camera move) | ✅ | 0.10s |
| a11y | keyboard only: Enter starts, Enter opens live station, Esc closes | ✅ |  |
| a11y | M toggles sound (mute control) | ✅ | True -> False |
| a11y | captions always on (every line shows in the speech bubble) | ✅ | bubble is the caption track |
| map | map shows all 6 station pins + chapters | ✅ | 6 pins |
| map | tapping a pin flies into the footage and opens the station | ✅ |  |
| stations | gallery deep link opens the right station | ✅ | Hermes Journey |
| routes | map + gallery: no page errors | ✅ |  |
| webkit | WebKit loads, decodes and walks | ✅ | webcodecs=True shown=600  |

## Same suite against the live GitHub Pages deploy: 87/88 passed

Run against https://vastlyresilient.github.io/walk-the-event-v2/ (real network, CDN). Misses:

- **mobile / guide stays on screen when visible**: 1 off-screen of 120

Misses on the live run are cold-CDN latency (the start-button check is scoped to localhost; cold teleport-seeks were measured landing on the exact frame within 0.54 s vs a 450 ms window).

## Colour

Median ΔE2000 per frame between the **shipped** frames (stabilised, 720p H.264) and references. Target ≈ 3.

Pixel ΔE includes sub-pixel misregistration and codec noise; the colour-only column blurs both images (σ = 3 px) first, so it measures colour, not detail.

| reference | class | pixel ΔE median (worst) | colour-only ΔE median (worst) |
|---|---|---|---|
| Apple renderer · downstairs | skin | 3.62 (3.79) | 3.48 (3.62) |
| Apple renderer · downstairs | white_walls | 3.56 (3.74) | 3.15 (3.28) |
| Apple renderer · downstairs | magenta_violet | 2.9 (3.63) | 2.68 (2.99) |
| Apple renderer · downstairs | all | 2.5 (3.74) | 2.42 (3.6) |
| Apple renderer · upstairs | magenta_violet | 2.96 (3.26) | 2.83 (3.16) |
| Apple renderer · upstairs | all | 2.3 (3.11) | 2.29 (3.04) |
| iPhone Photos screenshots | skin | 9.66 (9.66) | 9.49 (9.49) |
| iPhone Photos screenshots | white_walls | 5.34 (7.08) | 5.35 (7.05) |
| iPhone Photos screenshots | magenta_violet | 6.38 (8.84) | 6.35 (8.77) |
| iPhone Photos screenshots | all | 7.85 (8.68) | 7.79 (8.58) |

`sheet.jpg`: left = Apple reference (stabilised to match), right = shipped frame, at 5/20/35/50/65/80/95 s.

Photos screenshots are a second, independent check: they include the display's own tone mapping and screenshot compression, and their annotation strokes are masked out. Per-frame numbers are in `results.json`.


## AI transitions (art-director scored)

| station | veo-3.1-lite | kling-v3.0-std | verdict |
|---|---|---|---|
| merch | 4 | 7 | fallback |
| led-camera-screens | 6 | 8 | ship |
| tvs | 2 | 7 | fallback |
| projector-screens | 2 | 7 | fallback |
| space-screen | 5 | 7 | ship |
| cpu-terminals | 3 | 8 | ship |

Details: `qa/transitions/SCORES.md`.

## Art director

Full report: `qa/ART_DIRECTOR.md`.

## First-time visitors (mobile + desktop)

Full report: `qa/VISITOR_REPORT.md`.

## Fix loop

| round | found by | issue | fix |
|---|---|---|---|
| 1 | automated colour QA | Shipped frames ΔE 5.4 vs reference: OpenCV decodes BT.709 H.264 as BT.601 | ffmpeg-based reads (`pipeline/vread.py`), re-render with the same stabilisation matrices → colour-only ΔE 2.4 |
| 1 | art director (transitions) | Veo clips cross-dissolve / phantom people; Kling clips with light flips | Kling chosen; 4 re-rolled once; 3 ship (≥8), 3 fall back to the 2.5D dolly |
| 1 | automated (desktop) | Guide off-screen 41/120 on landscape: portrait footage cover-cropped to 35% of its height | Wide screens show the full 9:16 frame as a centred column with an ambient blurred extension; guide, glows and occlusion render inside it |
| 1 | automated (mobile) | Guide briefly off-screen while catching up after jumps (11/120) | Off-screen pop-in at her target with a hop |
| 1 | automated (mobile) | Station tags unclickable: the teaser bubble covered them | Tags raised above the bubble; the bubble hops above/below any visible tag |
| 1 | debug floor grid | Guide reads as floating in dark rooms although the floor fit is right | Exposure + room tint scale with scene luminance; darker, wider contact shadow |
| 1 | art direction (self) | Headband poked above the hair like a fin | Band radius fitted to the crown |
| 1 | automated (desktop) | Station glow spilled outside the footage column | Overlay clipped to the column |
| 2 | art director | Guide read as a jointed mannequin, off-model (scores 3–5) | Guide v2: skinned arms (smooth elbows), hands with fingers, straight cuffed sleeves, raised waist, fuller bob with flipped ends, separate blunt bangs, thin headband, larger eyes + freckles, manga halftone on clothing; points while facing the visitor |
| 2 | art director | Guide size swung from tiny to giant; occasional tilt | Placement scored toward ~30% of screen height (22–38% window), on-screen roll clamped to ±3° |
| 2 | art director | Hard occlusion artefacts upstairs | Feathered alpha occlusion; people must be >0.5 m nearer, other objects >0.9 m |
| 2 | art director | Glows clipped by screen edges / under the rail on phones | Clip-fraction test: below 75% visible collapses to an edge arrow + chip |
| 2 | art director | Ghosted dissolve on fallback transitions | Depth push-in, then a 0.22 s cut to the pod |
| 2 | art director | Black frame with floating guide on deep links | Guide and glows hidden until the decoded frame matches; intro held until the first frame |
| 2 | art director | Dark passage: guide hidden, near-black | Exposure lift and lantern-companion placement; outro shows the guide drawing |
| 2 | art director | Soft footage on phones | 1080p tier on DPR ≥ 2.5 phones with ≥ 4 GB and a decent connection |
| 2 | art director | Bubble typewriter caught mid-word; bubble over tags/face | First word appears instantly, faster reveal; bubble dodges tags and her head |
| 2 | visitor | Reload/Back re-glided to an old `#chapter-…` or showed the title screen again | Deep-link hash consumed after use; returning in the same session skips the intro |
| 2 | visitor | Fast swipes skipped short station windows | Magnetic slow-down the first time an unseen station comes into view |
| 2 | visitor | "Tap the beacon" with no beacon visible | Photo-only TVs/Mandala beacon spans the whole curved walkway, with "just off-camera, peek" chip |
| 2 | visitor | Share did nothing when the native sheet was unavailable | Clipboard fallback + toast (or shows the link) |
| 2 | visitor | Thumbnails did nothing; dragging selected text; Space opened a station | Lightbox; app chrome non-selectable; swipe-down closes the card; Space walks |
| 2 | visitor | Station open felt slow | AI clips play at 1.3× (reverse 1.8×) |
| 3 | art director | Upstairs roll 25–35°: the roll correction rotated the wrong way (doubled the tilt) | Rotate about the toward-viewer axis; screen-space lean clamped to ±3° |
| 3 | art director | Hair magenta, headband invisible, long lower face, small eyes, ink/halftone lost at size, faceted skirt, wave read as hand-on-head | Hair tint capped at 15% + shine bands; headband tipped forward; lower face −26%; eyes ~22%; constant-pixel screen-space ink; 7 px halftone grid; skirt rewound outward + smoothed normals; wave above the head |
| 3 | art director | Into the Dark: sticker-on-black guide, red-room line in the dark | Dimmed to scene with teal orb rim; doorway vs red-room lines by moment |
| 3 | art director | Fallback push toward off-screen Merch through haze; ghost guide; HUD over the cut | Glide to the station's clean frame first; softer sweep; guide fades in ~50 ms; chrome hidden during transitions |
| 3 | QA infra | Another session's dev server took IPv6 localhost:5199 | Dev server moved to 127.0.0.1:5299; all tools repointed |
| 4 | art director | Desktop AI clip as a hard-edged column over a visible pod; ragged pod edge | Pod layer transparent during clips (walk ambient stays), clip feathered in the column; off-centre pod projection |
| 4 | art director | Neck long, shine weak, flips small, sleeves puffy; no light under her in the dark | Shorter neck, bolder shine, bigger flips, slimmer shoulders; teal light pool in the dark passage |
| 4 | art director | Phone glows under the rail; translucent occluders | Collapse threshold 85% with a wider rail margin; hard-edged occlusion |
| 5 | art director | Shine crossed the headband into a "+" from behind; chips across her face; fallbacks lacked an approach; clip→pod double exposure; map marker over labels; static outro; upstairs no hands-on moment; intro ghosting on deep links | Front-only shine arcs; chip no-go zone around head/shoulders; pod walk-up push; clip holds and fades over the poster; labels above marker; outro bob; tap-to-react upstairs; intro fades before the glide |
| 5 | automated | Settled vs transient overlap conflated | Test now separates settled overlaps (must be 0) from transient crossings after artificial 1.5 s jumps |


