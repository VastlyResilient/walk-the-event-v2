# Art Director review: Walk the Event

Reviewer: independent art director. I did not build any of this and changed no app or pipeline code.
Date: 2026-10-31. Build: Vite dev server, localhost:5199.
Rendering: real-GPU Chrome (Playwright `channel=chrome`, ANGLE/Metal). Phone viewport 393×852 @2x (touch, mobile). Desktop viewport 1440×900 @2x.
All evidence is in `qa/art/`:

- Walk contact sheets: `sheet_mobile_walk.jpg`, `sheet_desktop_walk.jpg`, `sheet_mobile_up.jpg`, `sheet_desktop_up.jpg`
- Intro: `sheet_*_intro.jpg`
- Stations: `sheet_m_st_*.jpg`, `sheet_d_st_*.jpg`, re-runs `sheet_rt_*.jpg`
- Map and gallery: `sheet_*_map_gallery.jpg`
- Guide close-ups: `guide_test.png`, `z_guide_d60.png`, `z_d1850.png`
- Transition clips: `trans_all.jpg`
- My own upstairs colour check: `upstairs_colour_check.jpg`
- Raw frames: `m_*.png` and `d_*.png`

## Verdict

**Ship gate: FAIL.** All 28 rows score below 9 somewhere. The lowest scores are:

- **On-model guide: 3–5 almost everywhere.** The guide reads as a jointed mannequin, not the turnaround character.
- **Into the Dark: delight 3.** Several seconds of near-black frame, and the guide has left the frame.
- **Deep Blue (desktop) and several upstairs chapters: realism and polish 4–5.** The guide is giant, tilted or floating, and the occlusion mask leaves black smears on her.

The footage itself is good. Colour is right, nothing looks like a scan or LiDAR, and the cinematic rail feels real. Most of what fails the gate is the guide and how she is placed.

## Colour sign-off: **APPROVE**

- **Downstairs vs the Apple (QuickTime-look) reference.** Colour-only ΔE median is 2.42 overall, 2.45 on magenta/violet and 3.18 on white walls.
  - Skin is 3.62 median (worst 4.36). That is slightly over the ≈3 target but acceptable for 720p H.264.
  - In `qa/color/sheet.jpg` I cannot tell the reference and shipped frames apart at any of the seven timestamps.
- **The iPhone Photos screenshot ΔE (7.8) is not a defect.** It includes the phone display's own HDR tone mapping and screenshot compression.
- **Upstairs was not covered by `qa/color`, so I checked it myself.** I rendered Apple references with `bin/apple_tonemap` at 20, 75 and 105 s and compared them with the shipped SD frames.
  - Mean RGB matches within 5 levels: (3,1,155) vs (0,0,150); (16,2,162) vs (20,2,159); (105,64,163) vs (101,62,160).
  - The saturated blue upstairs is the real venue light, not a grading error.
- **There is no discoloured footage anywhere.**
- **Condition:** add the upstairs stills to `color_check.py` so the record is complete.

## Scores (1–10)

R = realism · P = polish · C = clarity · D = delight · G = on-model guide. "—" means not applicable.

### Downstairs chapters

| # | Chapter (frames) | R | P | C | D | G | Min | Main reasons |
|---|---|---|---|---|---|---|---|---|
| 1 | The Magenta Mile (0–300) | 8 | 7 | 7 | 7 | 5 | **5** | Footage is soft on phone (about 2× upscale). Phone has two walk instructions, and the rail knob overlaps the floor toggle. |
| 2 | Come Closer (300–674) | 8 | 7 | 8 | 8 | 5 | **5** | The glow is perspective-locked to the screen, which is good. The deep link opens on black (fix 9). |
| 3 | NOUSCON Corridor (674–974) | 8 | 6 | 7 | 6 | 5 | **5** | The guide is pasted dead-centre in front of the crowd with no interaction with it. The bubble stalls on "Next". |
| 4 | The White Curve (974–1169) | 8 | 7 | 8 | 7 | 5 | **5** | A good beat. The guide is unchanged from chapter 1 apart from a hand on her hip. |
| 5 | Violet Hall (1169–1424) | 7 | 6 | 6 | 6 | 5 | **5** | "Not in the footage… tap the beacon on the left" is confusing. On desktop the Mandala chip sits on the guide's head. |
| 6 | Projection Room (1424–1738) | 8 | 7 | 7 | 7 | 4 | **4** | The glow is clipped by the right edge and sits under the rail on phone. From behind, the head reads as a black helmet with a white stripe. |
| 7 | Deep Blue (1738–2158) | 5 | 4 | 7 | 7 | 4 | **4** | On desktop the guide fills about 85% of the frame height and is cut off at the bottom. A black occlusion smear crosses her torso. |
| 8 | The Atrium (2158–2458) | 7 | 6 | 6 | 6 | 5 | **5** | The station chip ("The…") is hidden under the bubble. The glow is clipped at the left edge on phone. |
| 9 | The Gallery (2458–2697) | 8 | 7 | 8 | 6 | 5 | **5** | Clean, but nothing happens here. |
| 10 | Terminal Row (2697–3012) | 8 | 7 | 7 | 7 | 5 | **5** | The glow is clipped at the right edge and collides with the rail on phone. |
| 11 | Into the Dark (3012–3567) | 5 | 5 | 5 | 3 | — | **3** | Several seconds of near-black frame (frame 3200 is almost entirely black on both viewports). The guide is hidden. No send-off before the stairs. |

### Upstairs

| Scope | R | P | C | D | G | Min | Main reasons |
|---|---|---|---|---|---|---|---|
| **Upstairs as a whole** | 7 | 6 | 7 | 6 | 4 | **4** | The footage is true to the venue. The guide floats or tilts in about half the chapters and has no station hooks, so the middle drags. |
| The Blue Ascent | 7 | 6 | 8 | 6 | 5 | 5 | She hovers over the stairs with no grounding or step contact. |
| The Long Corridor | 8 | 8 | 8 | 7 | 5 | 5 | The best-integrated upstairs shot: grounded, scaled correctly, with a shadow. |
| Disco Floor | 6 | 5 | 7 | 7 | 4 | 4 | The guide is rolled about 10° and floating, and is too large. |
| Violet Gallery | 5 | 4 | 6 | 6 | 3 | 3 | The occlusion hides everything but her head on desktop. On phone, black blobs cut into her. |
| The Plant Room | 6 | 5 | 7 | 6 | 3 | 3 | A black, hat-shaped occlusion artefact sits over her head. |
| The Balcony | 6 | 5 | 8 | 7 | 4 | 4 | She is tilted and appears to float beyond the rail. |

### Stations (transition + pod + card)

| Station | Transition | R | P | C | D | G | Min | Main reasons |
|---|---|---|---|---|---|---|---|---|
| Self Portrait | Kling (ship) | 8 | 7 | 8 | 8 | — | **7** | The clip and the pod are both strong. A deep link shows the guide and glow over black for about 0.5 s before the clip. On phone the card covers about 55% of the pod. |
| Mandala | 2.5D fallback | 7 | 6 | 7 | 6 | — | **6** | The ghosted cross-dissolve reads like a slideshow. One run bounced back to frame 0 of the walk at 3.5 s, then reopened. |
| The Shape of Everything | 2.5D fallback | 8 | 7 | 8 | 7 | — | **7** | The glyph-wall pod is gorgeous. The entry is a near-cut. |
| Hermes Journey | Kling (ship) | 8 | 8 | 8 | 9 | — | **8** | The best moment in the build: a woman passes the lens and the screen is revealed. |
| The Merch Wall | 2.5D fallback | 7 | 6 | 7 | 6 | — | **6** | The double-exposure dissolve at about 2 s is visible. The pod is crushed blue, so the tee graphics are hard to read. |
| Persistence 2 | Kling (ship) | 9 | 8 | 8 | 8 | — | **8** | Coherent clip with a pixel-exact landing and legible terminals. |

### Map, gallery, intro and outro

| Surface | R | P | C | D | G | Min | Main reasons |
|---|---|---|---|---|---|---|---|
| Map | — | 6 | 7 | 6 | 5 | **5** | Labels collide. On desktop the map uses about 25% of the width. The guide marker is a 12 px icon. |
| Gallery (/stations/) | 8 | 8 | 7 | 8 | — | **7** | Beautiful full-bleed pods. The guide's bubble talks with no guide on screen, and its copy is wrong for this page ("Tap the glow", "big screen on the right?"). |
| Intro | 8 | 7 | 9 | 7 | 6 | **6** | "Start walking" wraps onto two lines. The guide shows through the title overlay, behind "Event". |
| Outro | — | 8 | 9 | 6 | 3 | **3** | The guide is absent, with no wave or goodbye. Link underlines show inside the pill buttons. |

## Prioritised fix list (top 10 first)

### 1. Re-model the guide to match the turnaround (G 3–5 → 9)
This is the biggest lift in the build. Compare `qa/art/guide_test.png` with `input/mascot/hermes-guide-turnaround.png`.

- **Hair**
  - Hair is a magenta-lit helmet. Make it glossy black with 1–2 crisp white specular bands, and cap the venue tint on hair at 15%.
  - Add volume. Give the flipped ends about 40% of the head width so they curl outwards at jaw level. Make the blunt bangs a separate, thicker mesh ending just above the eyebrows.
- **Headband**
  - It is currently a wide white shell, which reads as headphones or a stripe from behind. Rebuild it as a narrow band, about 6% of head height, set behind the bangs.
- **Face and head**
  - Eyes are about 15% of face width; increase them to about 22%.
  - Raise the eye line to the vertical centre of the face and add the freckles.
  - Shorten the forehead and neck by about 30%.
  - Raise head size by about 12%, to roughly 5.5 heads tall.
- **Top**
  - Replace the puff sleeves with straight short sleeves and turned-back cuffs.
  - Raise the waistband from hip to natural waist, about 8% of body height higher. The top is currently too long.
  - Lower the collar height by about 30%.
- **Arms and hands**
  - Remove the visible elbow and wrist seams.
  - Replace the mitten hands with 4-finger hands. Even a simple shape with the fingers held together reads better.
- **Mary Janes**
  - Add the strap and a flat sole. They are currently blobs.
- **Rendering**
  - Use a continuous 2–2.5 px ink outline. It is currently patchy.
  - Use 2-tone cel shading and a halftone dot pattern in the shirt shadows, as on the sheet.
  - This is what makes her read as an illustrated character placed in a real room rather than a game NPC.

### 2. Keep the guide at a consistent size, on the floor and upright
- **Size.** Keep her height between 24% and 34% of the viewport on phone, and between 28% and 38% on desktop.
  - At Deep Blue (frame 1850) on desktop she is about 85% of the height and cut off at the bottom.
  - At the Atrium (frame 2400) she is about 18%.
- **Grounding.** Plant her feet on the solved floor plane and add a contact shadow, 60% opacity at the feet.
- **Tilt.** Clamp roll to ±3°. This fixes Disco Floor, the Balcony and the Blue Ascent hover.

### 3. Clean up the occlusion mask (Deep Blue, Violet Gallery, Plant Room)
- Feather the person mask by 4–6 px.
- Occlude only when the person's depth is more than 0.5 m nearer than the guide.
- If more than 35% of her would be hidden, step her 0.6 m sideways rather than hiding her.
- The black smear across her torso at frame 1850 and the hat-shaped blob in the Plant Room must never ship.

### 4. Fix soft footage on phones
- Phones get the SD tier (720 px wide). After the cover crop, about 590 source pixels fill 1179 device pixels, a 2× upscale, and it looks soft next to the crisp UI.
- Serve the 1080 HD tier when DPR ≥ 2 on a good connection, or add a 900 px "md" tier.

### 5. Fix the Into the Dark outro (frames about 3150–3567)
- Lift exposure by about +1.5 stops through the black stretch, or speed-ramp it to 3×.
- Keep the guide in frame. Give her a lit silhouette or a small glow and a line such as "Mind the dark. Upstairs is this way!"
- Give the end card a guide wave and a "See you next year" pose. Today the outro has no character at all (outro G 3).

### 6. Stop glows clipping and colliding with HUD elements (phone frames 1440, 1850, 2400, 2700)
- When a glow is more than 25% off-screen, collapse it to an edge chevron plus its chip.
- Hide the progress rail, or fade it to 30%, during a live station window. The rail sits at x≈355–375 pt, right where the glows land.
- Make the bubble and station chips collision-aware:
  - Atrium: the "The Merch Wall" chip is hidden under the bubble.
  - Violet Hall (desktop): the Mandala chip sits on the guide's head.
  - Offset the chip by at least 12 pt from the bubble's bounding box.

### 7. Declutter the phone HUD (target clarity 9)
- Show one walk instruction, not two. Keep the "Hold to walk" pill and drop "SWIPE UP TO WALK", or fade the hint out after the first gesture.
- Start the rail at y ≥ 120 pt. Its top knob currently overlaps the Downstairs/Upstairs toggle at y 62–98 pt.
- Move the floor toggle into the top button row, or shrink it to 32 pt height.

### 8. Replace the dissolve on the fallback transitions (Mandala, Shape of Everything, Merch)
- The current entry is a ghosted double exposure at about 2 s, which reads as a slideshow.
- Replace it with:
  1. A 0.6 s push-in on the live walk frame (scale 1.00→1.18, ease-in, with a 0→6 px radial blur).
  2. An 8-frame crossfade into the pod photo, aligned on the station's tracked bounding box.
  3. A 4-frame crossfade into the splat.
- Alternatively, ship the Kling re-rolls with fixes:
  - Mandala: grade out the amber wash at frames 4–6 of 8 with a hue-qualified desaturation.
  - Shape of Everything: rotoscope out the white ribbon.

### 9. Never show the guide or glows over a black frame
- **The bug.** On a deep link (`#station-*`) the first 0.5–1 s shows the guide and the neon glow floating on black while the target frame decodes (see `sheet_rt_m_led-camera-screens.jpg` at 2.0 s).
- **The fix.** Keep the intro or poster up until the video source reports the target frame is shown (`source.shown === target`), then fade in the walk layer.
- **Two intermittent faults to investigate.**
  - A Mandala open snapped back to Magenta Mile frame 0 at 3.5 s, then reopened.
  - An entirely black page at 11 s (Self Portrait, phone).
  - Neither reproduced on re-run, but both were seen once in real GPU Chrome.

### 10. Desktop framing and the phone card
- **Desktop sidebars.** The portrait column is 507 of 1440 pt and the sides are near-black. Fill them with the current frame mirrored, blurred about 60 px, at 30–35% brightness, so the venue's light wraps the viewer.
- **Phone card.** On phone the station card opens covering about 55% of the pod, which defeats "drag to look". Open it as a 38% peek and let the user drag it up.

### 11–18. Further fixes

11. **Merch pod.** Lift midtones about +0.4 EV and pull 15% of the blue saturation in the pod only, so the tee prints read. The card already says it was under blue light.
12. **Gallery bubble.** Either show a small guide avatar next to the bubble, or drop it. Write gallery-specific lines. "Tap the glow" and "big screen on the right?" are wrong here.
13. **Intro.**
    - Add `white-space: nowrap` and `min-width: 200px` to "Start walking".
    - Hide the guide until the intro is dismissed, or raise the overlay opacity behind the title from 0.84 to 0.95.
14. **Button styling.** Remove link underlines inside pill buttons ("See it in the walk", "All stations", "Get Hermes Agent").
15. **Map.**
    - Scale the plan to 70% of viewport height on desktop.
    - Run a label collision pass: "05 Violet Hall" vs the path dots, "Self Portrait" vs the guide marker, and "06 Projection Room" vs "07 Deep Blue" on desktop.
    - Double the size of the guide marker.
16. **Violet Hall beacon.** Change the copy to something like "Mandala was just off-camera. Peek at it here →", and anchor the chip to the left edge rather than floating it mid-frame.
17. **Upstairs pacing.** Upstairs has no stations. Add 2–3 guide reactions tied to beats (disco ceiling, the cyan sign, the balcony look-down) with a small gesture each, such as a hop, a point up or leaning on the rail, so the second floor does not feel like a slideshow.
18. **Bubble typewriter.** It stalls visibly mid-word in stills ("Next", "Self P", "Ma"). Start at 2× speed for the first 6 characters, or render the full first word at once.

---

# Round 2 (re-score of the current build)

I used the same rubric, harshness and method as round 1: real-GPU Chrome at 393×852 @2x and 1440×900 @2x. All evidence is in `qa/art/round2/`:

- Walk: `sheet_mobile_walk.jpg`, `sheet_desktop_walk.jpg`, `sheet_*_up.jpg`
- Stations: `sheet_m_stations.jpg`, `sheet_d_stations.jpg`, `sheet_st_detail.jpg`
- Guide: `sheet_guide.jpg`, `z_guide35_head.png`
- Upstairs tilt: `sheet_tilt.jpg`
- Desktop side bars and the dark chapter: `z_sides_dark.png`
- Map and gallery: `sheet_*_map_gallery.jpg`

## Verdict

**Ship gate: still FAIL, but much closer.**

**Fixed and verified:**
- Guide size is consistent (Deep Blue is now normal).
- No black frame on deep links. The deep link now glides in from earlier in the walk.
- Glows collapse to an edge arrow plus chip, and the Mandala beacon is clear.
- The phone card opens at 44%.
- The merch pod is lifted, and the tee prints now read.
- The gallery has an avatar and gallery-specific lines.
- "Start walking" no longer wraps, and pill buttons have no underlines.
- The outro shows the guide drawing.
- The Plant Room artefact is gone.

**Lowest scores remaining:**
- **4:** upstairs Disco Floor and Violet Gallery. The roll clamp does not work upstairs.
- **5:** Into the Dark, the Balcony, upstairs as a whole.
- **6:** Merch transition.
- **7:** on-model guide everywhere.

**Colour: still APPROVED.** The footage did not change.

## Scores, round 2

R = realism · P = polish · C = clarity · D = delight · G = on-model guide. "—" means not applicable.

### Downstairs

| # | Chapter | R | P | C | D | G | Min | Round 1 min | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | The Magenta Mile | 8 | 8 | 8 | 8 | 7 | **7** | 5 | On first view the phone still shows "Swipe up" and the "Hold to walk" pill together. |
| 2 | Come Closer | 8 | 8 | 9 | 8 | 7 | **7** | 5 | Pointing while facing the visitor works. On phone the rail crosses her arm. |
| 3 | NOUSCON Corridor | 8 | 8 | 8 | 7 | 7 | **7** | 5 | |
| 4 | The White Curve | 8 | 8 | 8 | 8 | 7 | **7** | 5 | The Mandala beacon reads well here. |
| 5 | Violet Hall | 8 | 7 | 8 | 7 | 7 | **7** | 5 | Occlusion by a guest is now plausible. |
| 6 | Projection Room | 8 | 8 | 8 | 8 | 7 | **7** | 4 | The edge arrow works. |
| 7 | Deep Blue | 8 | 8 | 8 | 8 | 7 | **7** | 4 | Scale is fixed and the smear is gone. |
| 8 | The Atrium | 8 | 8 | 8 | 7 | 7 | **7** | 5 | |
| 9 | The Gallery | 8 | 8 | 8 | 7 | 7 | **7** | 5 | |
| 10 | Terminal Row | 8 | 8 | 8 | 8 | 7 | **7** | 5 | |
| 11 | Into the Dark | 5 | 6 | 7 | 6 | 7 | **5** | 3 | Frame 3200 is still near-black. She is fully lit and shadowless in a void. The bubble says "everything's red" over the black frame. The red room at 3500 is good. |

### Upstairs

| Scope | R | P | C | D | G | Min | Round 1 min | Note |
|---|---|---|---|---|---|---|---|---|
| **Upstairs as a whole** | 6 | 5 | 8 | 7 | 5 | **5** | 4 | Beat reactions help, but there is a systematic tilt bug. |
| The Blue Ascent | 7 | 7 | 8 | 7 | 7 | 7 | 5 | She still hovers slightly over the stairs. |
| The Long Corridor | 8 | 8 | 8 | 7 | 7 | 7 | 5 | |
| Disco Floor (frame 2300) | 4 | 4 | 8 | 6 | 4 | **4** | 4 | She is rolled about 30° on screen and floating. It persists for over 3.5 s with no gesture playing, so it is not an animation. |
| Violet Gallery (frame 2830) | 4 | 4 | 7 | 6 | 4 | **4** | 3 | Rolled about 35°. Her skirt is translucent, like a ghost, through the occluder, and a guest's head leaves a hat-shaped cut-out on hers. |
| The Plant Room | 8 | 8 | 8 | 7 | 7 | 7 | 3 | The artefact is gone. |
| The Balcony (frame 3700) | 5 | 5 | 8 | 7 | 5 | **5** | 4 | Rolled about 25° on screen. |

### Stations

| Station | R | P | C | D | G | Min | Round 1 min | Note |
|---|---|---|---|---|---|---|---|---|
| Self Portrait | 8 | 8 | 9 | 8 | — | **8** | 7 | No black frame. The glide-in reads well. |
| Mandala | 7 | 7 | 8 | 7 | — | **7** | 6 | During the glide the guide sits at about 50% opacity, like a ghost. |
| The Shape of Everything | 8 | 7 | 8 | 7 | — | **7** | 7 | During the 0.22 s cut the HUD, bubble and a ghost guide are superimposed on the pod. |
| Hermes Journey | 9 | 8 | 9 | 9 | — | **8** | 8 | |
| The Merch Wall | 7 | 6 | 8 | 7 | — | **6** | 6 | The push-in heads towards an off-screen station through a large magenta haze. The pod itself is now good. |
| Persistence 2 | 9 | 8 | 9 | 8 | — | **8** | 8 | |

### Map, gallery, intro, outro and the guide

| Surface | R | P | C | D | G | Min | Round 1 min | Note |
|---|---|---|---|---|---|---|---|---|
| Map | — | 7 | 8 | 7 | 7 | **7** | 5 | The marker hides the "03 NOUSCON Corridor" label. On desktop the map still uses about 25% of the width. |
| Gallery | 8 | 8 | 8 | 8 | 9 | **8** | 7 | The avatar and the lines are right for the page. |
| Intro | 8 | 7 | 9 | 7 | 7 | **7** | 6 | The guide still shows through the title. Her wave reads as a hand on her head. |
| Outro | — | 9 | 9 | 8 | 9 | **8** | 3 | The drawing is on-model. It is static; a small idle bob would lift delight. |
| Guide (turntable) | — | 8 | — | — | 7 | **7** | 4 | Round-1 items fixed: smooth skinned arms, fingers, cuffed sleeves, raised waist, flipped ends, bangs. |

**Why the guide is 7 and not 9:**
- The hair still renders magenta or purple in every scene instead of glossy black with white highlights.
- The headband is not visible from the front.
- The lower face is long and blank.
- Eyes are about 17% of face width, not about 22%.
- At in-scene size (about 250 px tall) the halftone and the ink line disappear.
- The skirt shows low-poly facets.
- Side by side with the 2D drawing in the outro, the gap is obvious.

## Remaining fixes, round 2 (most important first)

### 1. Upstairs roll bug (Disco Floor, Violet Gallery, Balcony) → 4 to 8+
- **The bug.** Her on-screen roll is 25–35° and persists for over 3.5 s with no gesture playing.
- **Probe readings** (`window.__walk.brain.rig.root.rotation`):
  - About (0.11, 1.23, 0.13) rad at frame 2300.
  - About (−2.95, −1.45, 3.06) at frame 2830, a ±π wrap.
- **Likely cause.** The clamp acts on Euler angles that wrap at ±π, or it ignores the camera's roll upstairs.
- **The fix.**
  - Measure roll in screen space as the projected head-to-mid-feet vector, and clamp that to ±3° after projection.
  - Re-plant her feet on the solved floor at frames 2300, 2830 and 3700.

### 2. Finish the guide to 9
- **Hair.** Cap the scene tint on hair at 10%, and add two white specular bands.
- **Headband.** Move it forward until it shows as a white band about 6% of head height across the crown above the bangs in front and three-quarter view. It is invisible today.
- **Face.** Shorten the chin and lower face about 15%, round out the cheeks, and grow the eyes from about 17% to about 22% of face width.
- **Ink and halftone.** Render the outline at a constant 2 px in screen space. Size halftone dots to at least 3 screen pixels so they survive at 250 px tall.
- **Skirt.** Smooth the facets with more pleat segments or smoothed normals.
- **Wave.** Put the hand above the head, palm out, with 2–3 side-to-side swings. The current pose reads as a hand on her head.

### 3. Into the Dark (frames about 3100–3380)
- **The problem.** Frame 3200 is still near-black on both viewports, and the exposure lift is not visible.
- **The fix.**
  - Either lift about 2 stops, or match the guide to the scene: about 35% brightness, a teal rim light from the orb, and a soft ground shadow.
  - She currently reads as a fully lit sticker on black.
  - Move the "everything's red" line to frame 3400 or later, when the red room appears.

### 4. Fallback push-ins (Merch, Mandala, Shape of Everything)
- **Merch:** the push-in heads towards an off-screen station through a full-height magenta haze.
  - Glide until the station is at least 75% on screen before pushing in, or skip the push-in and cut directly.
  - Restrict any glow tint to the station's own mask.
- **Mandala and Merch:** during the glide the guide is half-transparent. Fade her out in 150 ms or less, or keep her fully opaque.
- **Shape of Everything:** hide the HUD and the bubble at transition start so nothing shows over the pod during the cut.

### 5. Violet Gallery occlusion
- Tighten the feather to about 2 px so the skirt is not see-through.
- Drop mask islands smaller than 3% of the guide's box, which removes the hat-shaped cut-out.
- If more than 35% of her would be hidden, step her 0.6 m sideways.

### 6. Desktop ambient side bars
- They show horizontal streaks from stretched edge pixels, plus a hard seam at the column edge.
- Use a real Gaussian blur of at least 40 px on a downscaled frame at about 30% brightness, and feather the seam over 24 px.

### 7. Phone composition near the rail
- In the intro and Come Closer, the rail (x≈355–375 pt) runs through her arm and shoulder.
- Keep her bounding box at least 16 pt left of the rail, or fade the rail to 30% where they overlap.

### 8. One walk instruction on phone
- On first view the "SWIPE UP TO WALK" hint and the "Hold to walk" pill appear together. Show only the hint until the first gesture, then the pill.

### 9. Desktop transitions jump from the column to full width
- The 507 pt portrait column snaps to full-bleed landscape when the transition starts. Expand the column over about 400 ms, or play the clip in the column and expand at the pod.

### 10. Map and intro polish
- **Map.**
  - Move the guide marker off the "03 NOUSCON Corridor" label (it currently reads "Corrido").
  - Separate the "TO UPSTAIRS" square from its text.
  - Scale the desktop map to about 70% of viewport height.
- **Intro.** Hide the guide, or use an overlay at 0.95 opacity, behind the title.

---

# Round 3 (re-score of the current build)

Same rubric and method as before: real-GPU Chrome at 393×852 @2x and 1440×900 @2x. All evidence is in `qa/art/round3/`:

- Walk: `sheet_mobile_walk.jpg`, `sheet_desktop_walk.jpg`
- Upstairs and other pages: `sheet_mobile_up_misc.jpg`, `sheet_desktop_up.jpg`
- Upstairs tilt: `sheet_tilt.jpg`
- Stations: `sheet_m_stations.jpg`, `sheet_d_stations.jpg`, `z_desk_clip.jpg`
- Guide: `sheet_guide.jpg`, `z_head.png`
- Desktop side bars and the dark chapter: `z_sides_dark.png`

## Verdict

**Ship gate: still FAIL**, but now on a short list.

**Fixed and verified:**
- **Upstairs roll.** All three problem frames (2300, 2830, 3700) are now upright and grounded.
- **Guide.** Hair is black, the headband reads across the crown, the face is rounder, eyes are larger, the skirt is smooth, and the wave goes above the head.
- **Into the Dark.** She is dimmed to the scene with a teal rim, and a dark-specific line plays.
- **Phone.** Only one walk instruction shows.
- **Intro.** The guide no longer shows through the title.
- **Desktop side bars.** No more edge streaking.

**Lowest scores remaining:**
- **6:** the Self Portrait and Persistence 2 station opens on desktop. This is a regression from round 2; see fix 1.
- **7:** the fallback transitions, upstairs delight, Violet Gallery, Into the Dark and the map.

**Colour: still APPROVED.**

## Scores, round 3

R = realism · P = polish · C = clarity · D = delight · G = on-model guide. "—" means not applicable.

### Downstairs

| # | Chapter | R | P | C | D | G | Min | Round 2 min | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | The Magenta Mile | 8 | 9 | 9 | 8 | 8 | **8** | 7 | |
| 2 | Come Closer | 8 | 9 | 9 | 9 | 8 | **8** | 7 | |
| 3 | NOUSCON Corridor | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| 4 | The White Curve | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| 5 | Violet Hall | 8 | 8 | 8 | 8 | 8 | **8** | 7 | |
| 6 | Projection Room | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| 7 | Deep Blue | 8 | 8 | 8 | 8 | 8 | **8** | 7 | On phone the rail still runs through the glow box (frame 1850). |
| 8 | The Atrium | 8 | 8 | 8 | 8 | 8 | **8** | 7 | The merch glow is clipped at the left edge without collapsing (frame 2400). |
| 9 | The Gallery | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| 10 | Terminal Row | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| 11 | Into the Dark | 7 | 7 | 8 | 8 | 8 | **7** | 5 | The dimmed teal guide reads as intentional. She still floats in a void with no ground cue. After a seek to frame 3500, the "Black doorway ahead" line played in the red room. |

### Upstairs

| Scope | R | P | C | D | G | Min | Round 2 min | Note |
|---|---|---|---|---|---|---|---|---|
| **Upstairs as a whole** | 8 | 8 | 8 | 7 | 8 | **7** | 5 | Upright and consistent. There are still long stretches with only a bubble and no interaction. |
| The Blue Ascent | 8 | 8 | 8 | 7 | 8 | 7 | 7 | |
| Disco Floor | 8 | 8 | 8 | 8 | 8 | **8** | 4 | Fixed. |
| Violet Gallery | 7 | 7 | 8 | 7 | 8 | **7** | 4 | Upright now, but a guest's bag renders as a translucent dark disc over her skirt. |
| The Balcony | 8 | 8 | 8 | 8 | 8 | **8** | 5 | Fixed. |

### Stations

| Station | R | P | C | D | G | Min | Round 2 min | Note |
|---|---|---|---|---|---|---|---|---|
| Self Portrait | 8 | 6 | 8 | 8 | — | **6** | 8 | On phone it is 8. On desktop the clip plays in a hard-edged column over the already-rendered full-bleed splat, and the splat's ragged black edge shows on the right (2.5–3 s). |
| Mandala | 7 | 7 | 8 | 7 | — | **7** | 7 | The push-in goes into a dark blur with the edge arrow still showing, then cuts to the pod. |
| The Shape of Everything | 7 | 7 | 8 | 7 | — | **7** | 7 | Same as Mandala. |
| Hermes Journey | 9 | 7 | 9 | 9 | — | **7** | 8 | On phone it is 9. On desktop the clip column has hard seams against the splat. |
| The Merch Wall | 7 | 7 | 8 | 7 | — | **7** | 6 | The haze is gone. The push-in still heads towards an off-screen station with the arrow visible. |
| Persistence 2 | 9 | 6 | 8 | 8 | — | **6** | 8 | On desktop the gallery clip column sits between two halves of the terminal splat. It reads as a floating frame over a different image. |

### Map, gallery, intro, outro and the guide

| Surface | R | P | C | D | G | Min | Round 2 min | Note |
|---|---|---|---|---|---|---|---|---|
| Map | — | 7 | 8 | 7 | 8 | **7** | 7 | The marker still truncates "03 NOUSCON Corrido". The "TO UPSTAIRS" icon shows a stray "1". |
| Gallery | 8 | 8 | 8 | 8 | 9 | **8** | 8 | |
| Intro | 8 | 8 | 9 | 8 | 8 | **8** | 7 | |
| Outro | — | 9 | 9 | 8 | 9 | **8** | 8 | |
| Guide (turntable) | — | 8 | — | 8 | 8 | **8** | 7 | |

**Why the guide is 8 and not 9:**
- The neck is about 40% too long; the collar should nearly meet the jaw.
- The three hair shine bands do not show in the turntable or in scene.
- From behind (Deep Blue, Atrium, Terminal Row while she points) the head reads as a black helmet with a white line. The flipped ends and the shine are lost.
- The sleeve caps still puff slightly.

## Remaining fixes, round 3 (most important first)

### 1. Desktop AI-clip compositing (Self Portrait, Hermes Journey, Persistence 2) → 6 to 9
- **The problem.**
  - The clip plays in a hard-edged column while the full-bleed pod splat is already visible on both sides. This is a banned floating frame.
  - At 2.5–3 s on Self Portrait, the splat's ragged black boundary is visible at the right edge, which reads as a scan edge.
- **The fix.**
  - While the clip plays, render the sides as the same ambient blur used on the walk, sampled from the clip, and keep the pod hidden.
  - When the clip ends, widen the column to full-bleed over about 400 ms while crossfading into the pod.
  - Clamp the pod camera, or add an 8–10% edge vignette, so the splat boundary never shows.

### 2. Fallback push-ins towards off-camera stations (Mandala, Shape of Everything, Merch)
- Hide the edge arrow during the transition.
- If the station is less than 75% on screen at the clean frame, replace the push-in with a 0.3 s directional blur-pan towards the arrow's side, then an 8-frame cut or crossfade to the pod. Today the push-in is into a dark, empty blur.

### 3. Finish the guide to 9
- Shorten the neck about 40%.
- Make the hair shine bands visible: raise their intensity until they read at 250 px tall.
- Give the back-of-head silhouette the flipped ends, so the back view isn't a helmet.
- Flatten the sleeve-cap puff by about 30%.

### 4. Into the Dark
- Add a faint teal light pool and a contact shadow under her feet, so she stands on something rather than floating in the void.
- Guard the "Black doorway ahead" line so it never plays once the red room is visible (from 113.4 s), including after a seek.

### 5. Remaining glow collisions on phone
- **Deep Blue (frame 1850):** the rail crosses the Hermes Journey glow box.
- **Atrium (frame 2400):** the Merch Wall glow is clipped at the left edge.
- Apply the collapse rule in both cases, or nudge the glow inward by at least 16 pt.

### 6. Violet Gallery occluder
- The guest's bag renders as a translucent dark disc over her skirt. Make the occluder opaque inside its mask: alpha 1 with a 2 px edge feather.

### 7. Map
- Move the guide marker so "03 NOUSCON Corridor" reads in full.
- Remove the stray "1" glyph before "TO UPSTAIRS".

### 8. Bubbles during the deep-link fly-in
- While gliding to a deep-linked station, the bubble talks about the stations it passes ("Golden frames on the left!" en route to Merch and Hermes Journey). Mute bubbles during the glide, or show the target station's line.

---

# Round 4 (re-score of the current build at http://127.0.0.1:5299/)

Same rubric and method: real-GPU Chrome at 393×852 @2x and 1440×900 @2x. All evidence is in `qa/art/round4/`:

- Walk: `sheet_mobile_walk.jpg`, `sheet_desktop_walk.jpg`
- Upstairs and other pages: `sheet_mobile_up_misc.jpg`
- Stations: `sheet_m_stations.jpg`, `sheet_d_stations.jpg`
- Desktop clips and pods: `z_desk_clips.jpg`, `z_desk_pods.jpg`
- Guide: `sheet_guide.jpg`, `z_head35.png`
- Specific defects: `z_issues.png`

**Caveat on round 3.** The coordinator reports that an unrelated server took over IPv6 localhost:5199 partway through round 3. Every round-3 frame I scored shows this app with the round-3 changes visible, so I believe those scores stand. Round 4 used only 127.0.0.1:5299.

## Verdict

**Ship gate: still FAIL**, but this is now polish-level. Ten rows reach 9.

**Fixed and verified:**
- **Desktop AI clips.** They play inside the footage column with feathered edges and ambient side panels, and the final pods are clean. Round 3's lowest score (6) is resolved.
- **Into the Dark.** The teal pool under her feet grounds her, and the lines are now right: doorway lines in the dark, red-room lines in the red room.
- **Upstairs.** All chapters are upright.
- **Violet Gallery.** The bag is now opaque and reads as a real object in front of her.
- **Phone glows.** They collapse correctly.
- **Guide.** The neck is shorter and the flipped ends are bigger.

**Lowest scores remaining:**
- **7:** The White Curve. The Mandala chip runs across the guide's eyes.
- **8:** every chapter where she turns away to point (a white "+" cross glyph on her hair), the three fallback stations, Persistence 2 on desktop, the map, and the outro.

**Colour: still APPROVED.**

## Scores, round 4

R = realism · P = polish · C = clarity · D = delight · G = on-model guide. "—" means not applicable.

### Downstairs

| # | Chapter | R | P | C | D | G | Min | Round 3 min | Note |
|---|---|---|---|---|---|---|---|---|---|
| 1 | The Magenta Mile | 9 | 9 | 9 | 9 | 9 | **9** | 8 | |
| 2 | Come Closer | 9 | 9 | 9 | 9 | 9 | **9** | 8 | |
| 3 | NOUSCON Corridor | 9 | 9 | 9 | 9 | 9 | **9** | 8 | |
| 4 | The White Curve | 9 | 7 | 9 | 8 | 9 | **7** | 8 | On phone the "Mandala · just off-camera, peek" chip is drawn across her eyes (frame 1064). |
| 5 | Violet Hall | 9 | 8 | 9 | 8 | 9 | **8** | 8 | The Mandala chip touches her shoulder (frame 1205). |
| 6 | Projection Room | 9 | 9 | 9 | 9 | 9 | **9** | 8 | |
| 7 | Deep Blue | 9 | 9 | 9 | 9 | 8 | **8** | 8 | She turns away to point, and the white "+" shine cross shows on her crown. |
| 8 | The Atrium | 9 | 9 | 9 | 9 | 8 | **8** | 8 | Same cross glyph. |
| 9 | The Gallery | 9 | 9 | 9 | 8 | 8 | **8** | 8 | Same cross glyph. |
| 10 | Terminal Row | 9 | 9 | 9 | 9 | 8 | **8** | 8 | Same cross glyph. |
| 11 | Into the Dark | 9 | 9 | 9 | 9 | 9 | **9** | 7 | The teal pool works and the lines are right. |

### Upstairs

| Scope | R | P | C | D | G | Min | Round 3 min | Note |
|---|---|---|---|---|---|---|---|---|
| **Upstairs as a whole** | 9 | 9 | 9 | 8 | 9 | **8** | 7 | Correct throughout. It is still mostly bubbles, with no hands-on moment. |
| Disco Floor | 9 | 9 | 9 | 9 | 9 | 9 | 8 | |
| Violet Gallery | 9 | 9 | 9 | 9 | 9 | 9 | 7 | |
| The Balcony | 9 | 9 | 9 | 9 | 9 | 9 | 8 | |

### Stations

| Station | R | P | C | D | G | Min | Round 3 min | Note |
|---|---|---|---|---|---|---|---|---|
| Self Portrait | 9 | 9 | 9 | 9 | — | **9** | 6 | |
| Mandala | 8 | 9 | 9 | 8 | — | **8** | 7 | The look-pan, then cut, is clean, but there is no "walk up to it" moment. |
| The Shape of Everything | 8 | 9 | 9 | 8 | — | **8** | 7 | Same. |
| Hermes Journey | 9 | 9 | 9 | 9 | — | **9** | 7 | |
| The Merch Wall | 8 | 9 | 9 | 8 | — | **8** | 7 | Same as Mandala. |
| Persistence 2 | 9 | 8 | 9 | 9 | — | **8** | 6 | On desktop, around 4.0 s, the clip-to-pod handoff double-exposes the clip column over the pod, with a ragged black splat hole right of centre. It is clean by 5.5 s. |

### Map, gallery, intro, outro and the guide

| Surface | R | P | C | D | G | Min | Round 3 min | Note |
|---|---|---|---|---|---|---|---|---|
| Map | — | 8 | 9 | 8 | 9 | **8** | 7 | "03 NOUSCON Corrido" is still truncated by the marker. The stairs label is fixed. |
| Gallery | 9 | 9 | 9 | 9 | 9 | **9** | 8 | |
| Intro | 9 | 9 | 9 | 9 | 9 | **9** | 8 | On deep links the title ghosts over the moving walk for about 0.5 s (see fix 7). |
| Outro | — | 9 | 9 | 8 | 9 | **8** | 8 | The drawing is static. |
| Guide (turntable) | — | 8 | — | 9 | 8 | **8** | 8 | Front and three-quarter views are on-model, about 9. The back view shows the shine bands as a white "+" and "−" (or "×") that reads like a plaster or sticker. |

## Remaining fixes, round 4 (most important first)

### 1. Hair shine renders as a cross glyph
- The intersecting white strokes on her crown show as a "+" or "×" whenever she faces away: Deep Blue, Atrium, Gallery, Terminal Row and the turntable back view.
- Replace them with 2–3 non-intersecting curved arcs that follow the skull, the anime ring highlight. Each about 25% of head width, set on the upper third of the hair.

### 2. Station chips collide with the guide's face
- **The White Curve (frame 1064):** the Mandala chip crosses her eyes.
- **Violet Hall (frame 1205):** the chip sits on her shoulder.
- Treat her projected head and shoulder box, plus 12 pt, as a no-go zone for chips. Move the chip above or below the edge arrow instead.

### 3. Fallback stations top out at 8 (Mandala, Shape of Everything, Merch)
- The transition is clean but has no approach.
- **Cheapest fix:** a 1.2 s dolly inside the pod splat itself, from 1.6× distance to the final card framing (ease-out) after the cut, so the visitor "walks up" to the work.
- **Alternative:** ship Kling re-rolls with the round-1 fixes (grade out the amber on Mandala, rotoscope the ribbon on Shape of Everything).

### 4. Desktop clip-to-pod handoff (Persistence 2, about 4.0 s)
- Crossfade into the pod inside the column first, then widen. Or hold the last clip frame for about 6 frames until the splat has finished loading, so the ragged hole and the double exposure never show.

### 5. Map label
- Move the guide marker, or nudge the label left, so "03 NOUSCON Corridor" reads in full.

### 6. Outro and upstairs delight
- **Outro:** give the guide drawing a 2–3 s idle loop (bob plus blink), or a one-shot wave.
- **Upstairs:** add one hands-on beat, for example tap the disco ceiling to make her hop, or a look-down tilt at the Balcony.

### 7. Intro on deep links
- The title still ghosts over the moving walk for about 0.5 s (Mandala, Shape of Everything, Hermes Journey at 1 s). Finish the intro fade before the glide starts.

---

# Round 5 (final re-score, http://127.0.0.1:5299/ only)

Same rubric and method: real-GPU Chrome at 393×852 @2x and 1440×900 @2x. All evidence is in `qa/art/round5/`:

- Walk: `sheet_mobile_walk.jpg`, `sheet_desktop_walk.jpg`
- Upstairs, the tap reaction (`tap_up_*`, `tap2_touch.png`), outro and map: `sheet_mobile_up_misc.jpg`
- Stations: `sheet_m_stations.jpg`, `sheet_d_stations.jpg`
- Desktop clip-to-pod handoff, every 250 ms: `sheet_handoff.jpg`
- Pod walk-up: `sheet_walkup.jpg`
- Guide: `sheet_guide.jpg`
- Deep-link glide: `z_glide.jpg`

## Final verdict

**Ship gate: PASS on every surface a visitor reaches by walking or tapping. FAIL on one row: deep-link fly-in (7).**

Every chapter, upstairs, every station opened from the walk, the map, gallery, intro, outro and the guide now score 9 or above. The only row below 9 is the arrival path for shared station links (`/#station-*`). Those links are how people will land from a quote-post, so fix it before launch. It is a contained fix; see fix 1 below.

**Colour: APPROVED** (see round 1; the footage is unchanged).

**Fixed and verified this round:**
- **Hair.** Two front-crown arcs; the "+" seen from behind is gone, including in the pointing chapters.
- **Station chips.** They hop clear of her head and shoulders at frames 1064 and 1205.
- **Pods.** All pods walk up after landing.
- **Desktop handoff.** The Persistence 2 handoff is clean from 3.5 to 3.75 s, with no ghost and no splat hole.
- **Map.** Labels sit above the marker, so "03 NOUSCON Corridor" reads in full.
- **Upstairs tap.** Tapping triggers tada (ceiling) or look-around (lower) with a line, on both touch and mouse.

## Scores, round 5

R = realism · P = polish · C = clarity · D = delight · G = on-model guide. "—" means not applicable.

### Downstairs

| # | Chapter | R | P | C | D | G | Min | Round 4 min |
|---|---|---|---|---|---|---|---|---|
| 1 | The Magenta Mile | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| 2 | Come Closer | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| 3 | NOUSCON Corridor | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| 4 | The White Curve | 9 | 9 | 9 | 9 | 9 | **9** | 7 |
| 5 | Violet Hall | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| 6 | Projection Room | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| 7 | Deep Blue | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| 8 | The Atrium | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| 9 | The Gallery | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| 10 | Terminal Row | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| 11 | Into the Dark | 9 | 9 | 9 | 9 | 9 | **9** | 9 |

### Upstairs

| Scope | R | P | C | D | G | Min | Round 4 min |
|---|---|---|---|---|---|---|---|
| **Upstairs as a whole** | 9 | 9 | 9 | 9 | 9 | **9** | 8 |
| Disco Floor (with tap tada) | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| Violet Gallery | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| The Balcony | 9 | 9 | 9 | 9 | 9 | 9 | 9 |

### Stations (opened from the walk)

| Station | R | P | C | D | G | Min | Round 4 min |
|---|---|---|---|---|---|---|---|
| Self Portrait | 9 | 9 | 9 | 9 | — | **9** | 9 |
| Mandala | 9 | 9 | 9 | 9 | — | **9** | 8 |
| The Shape of Everything | 9 | 9 | 9 | 9 | — | **9** | 8 |
| Hermes Journey | 9 | 9 | 9 | 9 | — | **9** | 9 |
| The Merch Wall | 9 | 9 | 9 | 9 | — | **9** | 8 |
| Persistence 2 | 9 | 9 | 9 | 9 | — | **9** | 8 |
| **Deep-link fly-in (`#station-*`), any station** | 7 | 7 | 8 | 8 | 7 | **7** | n/a |

The deep-link fly-in was not scored as its own row before; earlier rounds folded it into each station's score.
- On desktop, during the glide (around 2 s), the guide renders at about 75% of the frame height and is cut off by the footage column's edge. Seen on Mandala and The Merch Wall.
- Walk bubbles from other places play during the glide: "Welcome to the Magenta Mile!" in the Atrium and in Violet Hall, and "Pillars on the right" on the White Curve.

### Map, gallery, intro, outro and the guide

| Surface | R | P | C | D | G | Min | Round 4 min |
|---|---|---|---|---|---|---|---|
| Map | — | 9 | 9 | 9 | 9 | **9** | 8 |
| Gallery | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| Intro | 9 | 9 | 9 | 9 | 9 | **9** | 9 |
| Outro | — | 9 | 9 | 9 | 9 | **9** | 8 |
| Guide (turntable and in scene) | — | 9 | — | 9 | 9 | **9** | 8 |

## Remaining fixes (final)

### 1. Deep-link fly-in (the one remaining gate item)
While `openStation` glides from a deep link, do one of the following:
- Hide the guide and mute all bubbles until the station frame is reached.
- Or skip the glide: seek straight to `click_frame` behind the intro poster, then play the transition.

Also clamp the guide's screen height to the 22–38% walk rule in every state, so she can never render near the camera or be cut off by the column edge.

### 2. Optional polish (does not block the gate)
- **Chip and arrow anchoring.** When a chip hops above her head, it separates from its edge arrow by about 80 pt (frames 1064, 1440, 1850, 2700 on phone). A 1 px hairline, or moving the arrow with the chip, would keep them reading as one unit.
- **Tada hand on the rail.** On phone at Disco Floor, her raised right hand crosses the rail. Include the gesture's raised-hand bounds in the "keep left of the rail" box.
