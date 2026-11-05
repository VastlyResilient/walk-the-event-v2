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
