# Transition QA scores

I reviewed the highest-numbered clip for each model (merch = `_2`, the rest = `_1`). I checked the 12 QA strips, 16-frame contact sheets, dense frame runs on the suspect sections, SSIM of each clip's endpoints against the required frames, and ffmpeg scene-change scores. **No hard cuts were found in any clip** (peak scene score < 0.1). The failures are dissolves, morphs and misregistration.

Frame positions are given as "frame N of 8" to match the QA strips.
Columns: F1 = first frame, Ln = last frame, Tmp = temporal coherence, Txt = display/text, Ppl = people, Lgt = lighting, Cool = cool factor, Ov = overall.
Overall is capped at the lower of Tmp and Ppl.

| Station | Model | F1 | Ln | Tmp | Txt | Ppl | Lgt | Cool | **Ov** | Pick / Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| merch | veo | 9 | 7 | 6 | 6 | 4 | 8 | 6 | **4** | |
| merch | kling | 9 | 9 | 7 | 7 | 7 | 6 | 8 | **7** | (superseded, see re-roll) |
| led-camera-screens | veo | 9 | 5 | 8 | 7 | 8 | 9 | 6 | **6** | |
| led-camera-screens | kling | 10 | 8 | 9 | 8 | 8 | 9 | 7 | **8** | kling / **ship** |
| tvs | veo | 8 | 6 | 2 | 3 | 2 | 7 | 4 | **2** | |
| tvs | kling | 8 | 8 | 8 | 8 | 7 | 6 | 8 | **7** | (see re-roll) |
| projector-screens | veo | 8 | 5 | 2 | 4 | 2 | 8 | 4 | **2** | |
| projector-screens | kling | 9 | 8 | 8 | 7 | 8 | 8 | 8 | **7** | (see re-roll) |
| space-screen | veo | 9 | 6 | 7 | 4 | 7 | 9 | 6 | **5** | |
| space-screen | kling | 10 | 9 | 8 | 6 | 8 | 9 | 9 | **7** | (see re-roll) |
| cpu-terminals | veo | 9 | 5 | 5 | 7 | 3 | 7 | 6 | **3** | |
| cpu-terminals | kling | 10 | 10 | 9 | 9 | 8 | 8 | 8 | **8** | kling / **ship** |

## Patterns across all clips

- **Kling wins every station.** Veo 3.1 Lite fakes the move with cross-dissolves twice: on tvs at frames 3-5 of 8 and on projector-screens at frames 2-3, where people go translucent and floors are double-exposed. Its final frame is also misregistered by about 40px (last-frame SSIM 0.67-0.88, against 0.82-0.95 for Kling), so it would snap visibly when the hero photo takes over.
- **Every clip has a small pop between frame 0 and frame 1**, worst on tvs (about 0.09). Drop frame 0 and start on frame 1 over the real walk frame with a 2-3 frame crossfade. A 4-6 frame crossfade into the hero photo at the end would also hide the remaining softness gap.

## Notes on the picks

- **merch (kling, caution):** at frame 6 of 8 the wall's light jumps from violet to UV-blue as if a switch flipped. The route via the mirror kiosk and a seated cashier invents a lot of venue. Veo grows a disembodied arm at frames 4-5.
- **led-camera-screens (kling, ship):** clean walk-and-turn, stable screens, accurate landing.
- **tvs (kling, caution):** an amber/orange off-palette wash at frames 4-5 of 8; slight smearing as the walker exits. Veo is unusable: it dissolves, and TV 1 shows a pistol until the last 0.3s.
- **projector-screens (kling, caution):** a white ribbon artifact stretches from the cube's base at frames 4-7 of 8; glyphs are mushy at frames 4-5.
- **space-screen (kling, caution):** the best "wow" moment, with a woman passing the lens. The screen swaps content twice at frames 3-6 of 8. Veo invents a "YOUR HOROSCOPE" title and then dissolves it away.
- **cpu-terminals (kling, ship):** the strongest clip. Coherent people, stable terminal text, a pixel-exact landing (SSIM 0.95).

## Re-roll (Kling, one attempt per station below 8)

I scored the re-rolls with the same rubric and the same checks: contact sheets, dense frame runs, endpoint SSIM, and scene-change peaks. Again, no hard cuts.

| Station | Clip | F1 | Ln | Tmp | Txt | Ppl | Lgt | Cool | **Ov** | Prompt fix held? |
|---|---|---|---|---|---|---|---|---|---|---|
| merch | `_3` | 9 | 10 | 7 | 8 | 7 | 6 | 8 | **7** | Partly. Wall blue now ramps in, but a new amber display case appears at frames 4-5 of 8 and there's a rough whip at 3.4s. |
| tvs | `_2` | 8 | 8 | 8 | 8 | 7 | 5 | 7 | **7** | No. Amber pendant lights and a cream ceiling at frames 4-6, plus a yellow atrium at frames 3-4. |
| projector-screens | `_2` | 9 | 9 | 8 | 8 | 8 | 8 | 8 | **7** | No. The white ribbon from the cube persists at frames 3-7 (glyphs and landing improved). |
| space-screen | `_2` | 10 | 9 | 9 | 8 | 8 | 9 | 9 | **8** | Yes. One constellation picture from reveal to end. |

## Final picks (re-roll once, then fall back)

| Station | Pick | Clip | Overall | Verdict |
|---|---|---|---|---|
| merch | kling-v3.0-std | `_3` (re-roll) | 7 | **fallback** |
| led-camera-screens | kling-v3.0-std | `_1` | 8 | **ship** |
| tvs | kling-v3.0-std | `_1` (original; re-roll's amber is worse) | 7 | **fallback** |
| projector-screens | kling-v3.0-std | `_2` (re-roll) | 7 | **fallback** |
| space-screen | kling-v3.0-std | `_2` (re-roll) | 8 | **ship** |
| cpu-terminals | kling-v3.0-std | `_1` | 8 | **ship** |

The "caution" verdicts in the first table are superseded. Under the brief, anything below 8 after one re-roll falls back to the 2.5D dolly.
For merch, tvs and projector the "pick" is the better Kling clip, kept for reference only. For the three clips that ship, still drop frame 0 and crossfade both ends as noted above.
