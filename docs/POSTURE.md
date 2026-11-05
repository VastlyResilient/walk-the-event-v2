# POSTURE.md: guide posture spec, checked against real people

Target: a 1.60 m woman, short-sleeve top, full skirt to mid-calf, flat shoes, viewed small on a phone.
Rig: Hips, Spine, Spine01, Spine02, neck, Head, L/R Shoulder (clavicle), Arm (humerus), ForeArm, Hand. No finger bones and no forearm twist bone.
Reference photos: `work/ref/<pose>/` (each folder has `SOURCES.tsv`). Alamy files are watermarked previews kept only as private reference.
Numbers come from the cited studies where a source gives them. Everything else was measured by eye from the reference photos and is marked *(photo)* or *(practice)*. Treat each value as a range to land inside, not as an exact keyframe.

---

## 0. Conventions and body landmarks

**Angles** (all in the torso frame, Spine02, not world):

| Symbol | Meaning | 0° | + direction |
|---|---|---|---|
| **Elev** | Upper-arm elevation from hanging straight down | arm hanging | up (90° = horizontal, 180° = overhead) |
| **Plane** | Plane in which the arm is elevated (azimuth) | pure side (abduction, frontal plane) | toward the front (90° = pure forward flexion; negative = behind the body line) |
| **Abd / Flex** | Shorthand used for walking: abduction from body side / sagittal flexion (negative = extension, arm behind) | arm hanging | out / forward |
| **HumRot** | Upper-arm long-axis rotation, measured with the elbow bent 90° | forearm points straight forward | external (forearm swings out) = **+** |
| **Elbow** | Elbow flexion | straight | bend |
| **ProSup** | Forearm rotation | thumb up, palm facing the thigh (neutral) | supination (palm up) = **+**, pronation (palm down) = **−** |
| **Wrist** | Flexion/extension, radial/ulnar deviation | hand in line with forearm | extension (back of hand toward forearm) = **+** |
| **Yaw / Pitch / Roll** | Torso, neck and head turn, nod and side tilt | facing hips' forward | toward the named side / down / ear toward the named shoulder |

**Implementation notes**
- Solve the arm as a world-space aim with swing-twist decomposition. Swing the Arm toward (Elev, Plane), apply HumRot as twist about the humerus, then set Elbow. The project already does world-space, axis-agnostic aiming (DECISIONS #31/#43).
- **There is no twist bone.** Put about 60% of ProSup as ForeArm long-axis roll and about 40% as Hand roll, and keep the total at 90° or less. All on the hand gives a candy-wrapper wrist; all on the forearm twists the elbow skin.
- **Scapulohumeral rhythm.** A real shoulder blade moves with the arm. Above about 30° Elev, give the Shoulder (clavicle) bone extra elevation ≈ (Elev − 30°) × 0.25, capped at about 25°. Add 5–10° protraction (forward) when Plane is above 45° and the hand is ahead of the body. *A flat, motionless shoulder under a raised arm is the most common "fake arm" tell.*
- **Distal lag.** On every gesture the shoulder starts first, the elbow follows about 40–80 ms later, and the wrist/hand about 60–120 ms later. The hand also arrives last and settles last (follow-through). Never drive all joints with one shared curve.
- **Ease.** Gesture strokes follow a minimum-jerk profile, `s = 10t³ − 15t⁴ + 6t⁵` (bell-shaped velocity). Allow at most about 3% overshoot, and only on fast flicks (wave starts, beckons). Don't use sine in-out on every channel, and never use linear.
- **Holds are never frozen.** During any hold, layer about 0.5–1° of slow noise (0.2–0.6 Hz) on the shoulder and elbow, and breathing on Spine01/02 (§6).
- **Look-at split** for any gaze target: eyes up to 15° (if the face has eye control) → Head ≤ 50° yaw / 25° pitch → neck → Spine02 up to 15° → Spine01 up to 10° → Spine up to 5°. Drive each with a critically damped spring: head half-life 80–120 ms, chest 200–300 ms. The head starts 50–150 ms before the chest.

**Landmarks for a 1.60 m woman.** These use standard segment fractions of height (Drillis & Contini). Use them to check hand heights in renders.

| Landmark | × H | Height (m) |
|---|---|---|
| Eye | 0.936 | 1.50 |
| Chin | 0.87 | 1.39 |
| Shoulder (acromion) | 0.818 | 1.31 |
| Elbow, arm hanging ≈ natural waist | 0.63 | 1.01 |
| Hip joint (greater trochanter) | 0.53 | 0.85 |
| Wrist, arm hanging | 0.485 | 0.78 |
| Fingertip, arm hanging | 0.377 | 0.60 |
| Knee | 0.285 | 0.46 |
| Skirt hem (mid-calf) | ≈0.19 | ≈0.30 |
| Upper arm / forearm / hand length | 0.186 / 0.146 / 0.108 | 0.30 / 0.23 / 0.17 |
| Shoulder width (biacromial) | ≈0.22 | ≈0.35 |

**Rig caveat (DECISIONS #33/#34/#43).** The sculpt's hands are fused into the skirt and the armpit stretches above about 50° Elev. Each table gives an **ideal** value (what real people do) and, where it matters, a **rig minimum** (the lowest value that still reads correctly on a phone). For readability, the gesturing arm's silhouette should stay at least 15 cm clear of the torso and skirt in the camera's image plane.

---

## 1. Presenting an exhibit ("here we have…")

**What real guides do** (ref `01_present/01–06`). The guide stands **beside** the object, never in front of it, about 0.6–1.2 m to its side. Her body is angled about halfway between the visitor and the object. The arm **nearer the object** presents it, so her chest stays open to the visitor.

The eyes do the work. She glances at the object on the stroke (about 0.3–0.6 s), then looks back at the visitor and talks to them. She does *not* keep staring at the object. Ref 02 shows the hand reaching to the painting while the head is fully turned to the visitor.

**Hand shape.** Close-range presenting uses a relaxed open hand with the palm down or vertical (ref 02, 05). The palm-up "offer" (Kendon's *open hand supine*, Müller's palm-up open hand) appears when she hands the topic to the listener ("take a look at this"). It is lower, closer to the body, and often two-handed (ref 04, 06).

**Staging (top view).** Visitor V, guide G and object O form a triangle with G at one corner. G's pelvis faces about 30–45° away from the G→V line, toward O. Chest yaw adds about 10–15° more toward O during the stroke. Head yaw returns to the visitor within 0.6 s of the stroke.

### 1A. One-arm side presentation (default)

| Joint | Ideal | Rig min / notes |
|---|---|---|
| Presenting Arm Elev | 45–70° (hand at waist-to-chest height, 1.0–1.25 m) | 35° |
| Plane | 30–60° (diagonal, forward and out toward the object) | aim it in the screen plane |
| HumRot | +10 to +20° external | |
| Elbow | 15–35° (soft, never locked) | |
| ProSup | palm down/vertical "this one": −30 to 0°. Palm-up "offer": +60 to +90° | blend between them per line |
| Wrist | +10–20° extension, 0–10° ulnar; fingertips lead toward the object | |
| Clavicle | +5–10° elevation, +5° protraction | |
| Other arm | hangs relaxed, Elbow 10–20°, hand at the skirt side. Or the forearm rests across the waist (see 1B) | |
| Pelvis yaw (toward O) | 30–45° from facing the visitor | |
| Spine01+02 yaw | +10–15° more toward O on the stroke, back to +5° in the hold | |
| Head yaw / pitch / roll | stroke: 20–40° toward O. Hold: back to the visitor, roll 3–6° toward the presenting side | |
| Gaze | O for 0.3–0.6 s → visitor, with a re-glance at O every 2–4 s while talking | |
| Weight | about 60–70% on the leg nearer the visitor, with the other foot turned out 20–30° toward O | |

**Timing** (gesture phases, the usual pattern in gesture studies *(practice)*):

| Phase | Duration | Notes |
|---|---|---|
| Preparation (hand leaves rest) | 0.30–0.50 s | minimum-jerk; the shoulder leads |
| Stroke (to apex) | 0.15–0.35 s | the apex lands on, or up to 0.2 s before, the stressed word ("**here** we have") |
| Post-stroke hold | 0.8–3 s | add one small re-emphasis beat (hand dips 2–4 cm and recovers over 0.3 s) per sentence |
| Retraction | 0.40–0.70 s | to rest, or straight into the next gesture without fully retracting |

### 1B. User's reference variant: hand raised by the shoulder pointing aside, other arm across the waist

Ref `01_present/07` is the closest real photo. DECISIONS #40 describes it: the hand is lifted beside the shoulder, the elbow stays down by the ribs, and the fingers point out to the side and slightly back toward the object. The body faces the visitor.

| Joint | Raised arm | Arm across the waist |
|---|---|---|
| Elev | 20–35° (elbow stays near the ribs, 5–15 cm out) | 5–15° |
| Plane | 0–30° | 20–40° |
| HumRot | **+40 to +70° external** (the forearm swings out so the hand sits outside the shoulder line) | **−60 to −80° internal** (the forearm comes across the belly) |
| Elbow | 110–135° (hand 0–15 cm above shoulder height, 10–20 cm out from the shoulder) | 85–100° |
| ProSup | 0 to +45°: palm faces forward/up, open hand, fingers toward the object | 0 to −30°: palm toward the body |
| Wrist | +20–35° extension, 10° radial | 0–10° flexion |
| Hand position | ≈1.30–1.45 m high, 0.25–0.35 m out from the midline | resting on the opposite hip or waist at ≈0.95–1.0 m, or cupping the raised arm's elbow |
| Torso | Spine yaw 0–15° toward the object; chest open to the visitor | |
| Head | yaw 0–10° toward the object, **roll 5–10° toward the raised hand**, smile; gaze on the visitor | |
| Stance | weight on the leg *away* from the object (hip pushed to that side, pelvis roll 3–5°); the other knee bent 5–10° | |

Timing is as in 1A, with a raise of 0.35–0.5 s. When the across-waist arm can't be enabled (fused hands), keep that arm relaxed at the side with Elbow 15–25°.

**Fake tells to avoid (both variants)**
- Standing between the visitor and the object, or squarely facing the object with her back half to the visitor.
- Staring at the object for the whole line, or at the camera while the hand presents nothing. The real sequence is a glance at the object, then back to the visitor.
- A locked straight elbow with a rigid, flat "blade" hand. A mannequin-like 90° horizontal arm.
- The back of the hand toward the visitor while presenting. The palm must be visible or at least edge-on.
- All joints arriving at once; no clavicle lift; a dead-still hold.
- An arm aimed toward or away from the camera, which foreshortens it to nothing on a phone. Aim it in the screen plane (DECISIONS #31).

Sources: Kendon open-hand families https://www.cambridge.org/core/books/abs/gesture/two-gesture-families-of-the-open-hand/C9BDAFEA757966C69DD41ACEA26FDBBA · pointing hand shapes and palm orientation https://link.springer.com/10.1007/s10919-017-0270-3 · palm-up gesture literature https://www.frontiersin.org/journals/communication/articles/10.3389/fcomm.2018.00023/epub · photos: https://www.flickr.com/photos/8952189@N05/1737332635 · https://www.flickr.com/photos/39069710@N08/6152398825 · https://commons.wikimedia.org/wiki/File:Wolken_und_Licht._Impressionismus_in_Holland,_Museum_Barberini,_Potsdam-40427.jpg · https://commons.wikimedia.org/wiki/File:Periscope_app_streaming_a_guided_tour_in_Städel_museum,_Frankfurt-3308.jpg · https://commons.wikimedia.org/wiki/File:Tour_guide_at_the_National_Museum_of_the_American_Indian.jpg · https://www.flickr.com/photos/77742560@N06/16315083605 · https://www.alamy.com/happy-asian-lady-pointing-aside-at-copy-space-and-smiling-at-camera-demonstrating-empty-place-for-your-ad-or-design-image468339961.html

---

## 2. Pointing to the side, or ahead at a distance (no index finger)

**What it looks like** (ref `02_point/01–04`). For far targets, people straighten the arm and raise it to roughly the target's eye-level direction. Head and gaze go to the target first, then the arm follows. The torso turns up to about 45°; beyond that, the feet step round (§8). Speakers usually glance back at the listener during the hold to check they are looking.

**Without an index finger**, use Kendon's *open hand, palm vertical*: fingers together and extended, thumb up, palm facing medially. It reads as "that way / over there". It is the normal hand shape for directions, and it is softer than a finger point.

**Where to aim on a phone.** The person pointing lines up eye, fingertip and target. Observers watching from the side, as our camera does, instead extend the **arm–finger line**, and they tend to read it as higher than intended (Herbort & Kunde). So aim the shoulder→hand vector at the target in screen space, and drop it about 3–5° below the eye-line solution.

| Joint | Far target (> 5 m) | Near-side target (1–3 m, low) |
|---|---|---|
| Elev | 75–95° (rig min 40° plus the pointer beam) | 30–50° |
| Plane | ahead: 60–90°; to the side: 0–30° | 20–50° |
| HumRot | 0 to +10° | 0 to +15° |
| Elbow | 5–15° | 20–40° |
| ProSup | 0 (palm vertical, thumb up). Max ±20° | −20 to 0 |
| Wrist | 0 to +10°, in line with the forearm (the line *is* the pointer) | +10–20° |
| Clavicle | +10–20° elevation, +10° protraction | +5° |
| Other arm | hangs, Elbow 10–20° | hangs |
| Spine02+01 yaw | 15–35° toward the target | 10–20° |
| Head yaw / pitch | onto the target; pitch up 0–10° for far targets | onto the target; pitch down 10–20° |
| Gaze | target → (after 0.6–1.0 s) the visitor → target | same |
| Weight | shifts 60–70% onto the leg on the target side; the front foot may open 15–30° toward it | |

| Timing | Value |
|---|---|
| Gaze/head onset before arm onset | 100–250 ms |
| Raise | 0.35–0.55 s, minimum-jerk; the hand arrives last |
| Hold | 0.8–1.5 s, plus an optional small second push (+3–5° Elev, 0.25 s) on "**there**" |
| Lower | 0.5–0.7 s |

**Fake tells:** the arm moves before the head and eyes; a perfectly straight, hyperextended arm; a palm-down point (it reads as a "calm down" or "stop" gesture); pointing while the body stays square and the shoulder doesn't lift; a horizontal arm aimed at the camera; the hand dropping instantly with no hold.

Sources: Herbort & Kunde, interpreting pointing https://psychologie.uni-wuerzburg.de/fileadmin/06020300/Publications/Herbort_-_2015jephpp_-_Spatial__Mis-_Interpretation_of_Pointing_Gestures_to_Distal_Referents.pdf · https://psychologie.uni-wuerzburg.de/fileadmin/06020300/Publications/Herbort_-_2016psyres_-_How_to_point_and_to_interpret_pointing_gestures.pdf · hand shapes https://link.springer.com/10.1007/s10919-017-0270-3 · https://www.cambridge.org/core/books/abs/gesture/two-gesture-families-of-the-open-hand/C9BDAFEA757966C69DD41ACEA26FDBBA · photos: https://www.flickr.com/photos/115357548@N08/25664578601 · https://www.flickr.com/photos/158579213@N02/36783252351 · https://www.flickr.com/photos/82605142@N00/1041771232 · https://www.flickr.com/photos/13760856@N07/8259103627

---

## 3. Waving

### 3A. Hello (intro, facing the visitor at 2–5 m)

**What it looks like** (ref `03_wave/01–03`). The upper arm stays fairly low and out to the side-front. The elbow is sharply bent, so the forearm is near vertical. The hand sits beside the head, between shoulder and ear height, palm to the visitor, fingers slightly spread. The wave is the **forearm rocking side to side about the elbow** (the upper arm rotating on its long axis), with the wrist trailing.

A smaller, politer variant (ref 01) keeps the hand at shoulder height and waves mostly from the wrist.

| Joint | Friendly hello (ref 02, 03) | Small polite (ref 01) |
|---|---|---|
| Elev | 40–70° | 20–35° |
| Plane | 30–50° | 30–60° |
| HumRot | base +70 to +90° external (forearm vertical, palm forward); **oscillate ±15–25°** | base +60–80°; oscillate ±5–10° |
| Elbow | 100–125° | 120–135° |
| ProSup | −10 to +10 (palm faces the visitor) | same |
| Wrist | base +10° extension; radial/ulnar ±10–15°, lagging the forearm by about 1/8 cycle | **±15–25° radial/ulnar is the main motion** |
| Hand position | ≈1.35–1.55 m high, 0.20–0.35 m out from the shoulder | ≈1.25–1.35 m, 0.15 m out |
| Head | roll 5–10° toward the waving hand, slight chin dip, smile; gaze on the visitor | same |
| Torso | 0–10° lean toward the visitor; on the opening beat Spine02 rolls 2–3° away from the raised arm (counterbalance) | none |

| Timing | Value |
|---|---|
| Raise | 0.25–0.40 s |
| Oscillation | **2.0–3.0 Hz** for elbow-driven waves; 3–4 Hz for a small wrist wave. Waves recorded from people span about 1.5–3 Hz, and slower waves are driven more by the elbow |
| Cycles | 2–4. Amplitude starts largest and decays about 15–25% per cycle, with ±10% random variation in each cycle's period |
| Lower | 0.40–0.60 s, often while starting to talk or walk |

### 3B. "Come on, catch up!" from down a corridor (8–15 m)

**What it looks like** (ref `03_wave/04–07`). There are two beats.
1. **Big overhead attention wave.** The arm goes high and nearly straight, and the whole arm sweeps side to side from the shoulder. The other arm often stays down. A small bounce onto the toes is optional.
2. **Beckon toward the direction of travel.** The body half-turns toward where she's going, the head stays on the visitor, and the arm makes a big scoop from in front of her back toward her shoulder, repeated. Palm up (ref 07) is normal in the US. Palm down is the polite beckon in much of East and Southeast Asia; not needed for an NYC audience.

| Joint | Overhead wave | Beckon "this way" |
|---|---|---|
| Elev | 140–170° ideal (rig: as high as the sleeve allows, ≥ 110°) | 50–80° at the start of the scoop → 30–45° at the end |
| Plane | 20–45° | 60–90° (in front) |
| HumRot | +40–60° | 0 to +20° |
| Elbow | 10–30° | **25° → 110°** per scoop (flexes to pull the hand toward the shoulder) |
| ProSup | palm toward the visitor | +60 to +90° (palm up / toward self) |
| Wrist | ±15° flexion, lagging the arm | flexes +20° at the end of each scoop (the "come" flick) |
| Oscillation | whole-arm sweep **±20–30°** in the frontal plane at **1.0–1.5 Hz**, 2–4 cycles | **1.2–1.6 Hz**, 2–3 scoops |
| Clavicle | +20–25° elevation | +5–10° |
| Torso | faces the visitor; heels lift 2–4 cm on beats (optional) | pelvis and chest yaw 30–60° toward the travel direction; head yaw back to the visitor |
| Then | → beckon | → turn (§8) and walk/run on |

**Fake tells:** waving with a straight arm from the shoulder at the small-hello distance; a perfectly regular sine with constant amplitude; a frozen hand with only the elbow moving (or the reverse); the arm flying up instantly with no shoulder lift; the face not looking at the visitor; an overhead arm that stretches the armpit mesh (use the beckon instead if the rig can't do it).

Sources: waving frequency and elbow-versus-wrist modulation https://arxiv.org/pdf/2003.02348 · palm-down beckoning in Asia https://codex-mundi.pages.dev/en/entries/palm-down-beckoning · photos: https://www.flickr.com/photos/27865228@N06/4597055957 · https://www.flickr.com/photos/29988733@N04/15218052672 · https://www.flickr.com/photos/43927576@N00/4236465456 · https://www.flickr.com/photos/93587218@N00/234118635 · https://www.flickr.com/photos/72098626@N00/20012108132 · https://www.alamy.com/woman-with-arm-in-the-air-waving-image2261188.html · https://www.alamy.com/beautiful-young-woman-beckoning-come-here-gesture-with-hands-inviting-happy-and-smiling-image389834687.html

---

## 4. Walking arm swing (~1.2 m/s) and running arms (~3 m/s)

### 4A. Walk, 1.2 m/s (ref `04_walk_run/01–04`)

**What it looks like.** The arms hang close and swing as relaxed pendulums, mostly *behind* the body line. Each arm swings forward with the opposite leg. The swing is small, about a hand's length at the wrist. The elbow bends a little more on the forward swing. The hands pass just outside the skirt and never cross the midline. The shoulders counter-rotate against the hips. The head stays almost still.

| Parameter | Value | Source/notes |
|---|---|---|
| Step length | 0.62–0.68 m | from H = 1.60; women use shorter steps and higher cadence than men |
| Cadence | **108–118 steps/min** (step 1.8–1.97 Hz) | women average about 117 steps/min at 1.28 m/s |
| Stride (and arm-swing) period | 1.02–1.11 s, **arm:leg frequency 1:1** | below about 0.8 m/s the arms switch to 2:1 (two swings per stride). Matters for slow strolls |
| Phase | each arm **opposite** to the same-side leg. The right arm is most forward at **left heel strike**, lagging it by 0–8% of the cycle | |
| Shoulder Flex | **+8 to +14° forward ↔ −16 to −22° back**, total range 25–33° | measured ranges ≈ 20–25° (shoulder) and ≈ 29–33° (elbow marker) at 4 km/h |
| Shoulder Abd | 6–12° (clears the full skirt), ±2° in time with the swing (out on the back swing) | the skirt is the constraint *(photo 02)* |
| HumRot | 0 to −10° (slightly internal) | palm faces the thigh |
| Elbow | mean 20–25°, **range 15–20°**: ≈12° at full back swing ↔ ≈32–38° at full forward swing | elbow range 15–30° in the literature; elbow flexion contributes most to amplitude changes with speed |
| ProSup | −10 to −20° (palm faces back and in) | |
| Wrist | 5–10° flexion; lags the elbow by about 8–10% of the cycle (passive whip) | |
| Pelvis yaw | ±4–6° (the forward leg's hip leads) | |
| Thorax yaw (Spine02 vs Hips) | ±3–5°, **opposite** to the pelvis | ~9°/cycle at mid-thoracic to lumbar |
| Vertical bob (Hips) | 3–4 cm peak to peak, twice per stride, highest at mid-stance | |
| Lateral sway | 2–3 cm peak to peak, once per stride; women show a little more pelvic roll (±3–4°) | |
| Head | pitch ±1–2°, yaw ±1°: stabilised against the trunk | |
| Step width | 5–8 cm (feet close to one line) | |

### 4B. Run/jog, 3 m/s (ref `04_walk_run/05–07`)

**What it looks like.** The elbows stay bent near a right angle, with the hands loosely cupped at lower-ribs-to-waist height. The forearms swing forward and slightly in toward the midline, never crossing the sternum. The upper arm drives back more than forward. Shoulders stay low and relaxed, and the trunk leans slightly forward.

| Parameter | Value | Notes |
|---|---|---|
| Cadence | **160–172 steps/min** (stride period 0.70–0.75 s) | the short leg puts her at the high end |
| Step length | 1.05–1.12 m | |
| Shoulder Flex | +15 to +25° forward ↔ −35 to −45° back (range 50–65°) | |
| Shoulder Abd | 10–20° | |
| Elbow | **mean 80–100°**; about 100–110° at the front of the swing ↔ about 70–80° at the back | runners bend the elbow to cut shoulder torque by about a third; coaching cue ≈90° |
| Hand path | front: ≈ waist to lower ribs (1.0–1.1 m), 5–10 cm toward the midline; back: just behind the hip | ref 05 |
| ProSup / Wrist | neutral, thumbs up; wrist neutral, hand loosely cupped | |
| Trunk lean | 5–8° forward (from the ankles, not bent at the waist) | |
| Thorax counter-rotation | ±8–12° | |
| Vertical bob | 6–9 cm; flight phase present | |

**Fake tells:** arms swinging symmetrically forward and back about vertical (real swing is biased backward); straight, stiff arms in a walk; the same arm and leg forward together; arms swinging through the skirt; no trunk counter-rotation; head bobbing with the body; elbows locked at exactly 90° with no change while running; sprinter-style pumping at a jog; hands crossing the midline; the arm cycle drifting out of phase with the feet (drive both from the same foot-locked gait phase).

Sources: arm ROM during gait (Verbecque et al. 2018) https://documentserver.uhasselt.be//bitstream/1942/26634/1/1-s2.0-S0966636218313006-main.pdf · arm swing ≈30° and spinal rotation at 4 km/h https://pmc.ncbi.nlm.nih.gov/articles/PMC12023011/ · 2:1 vs 1:1 frequency https://en.wikipedia.org/wiki/Arm_swing_in_human_locomotion · arm-swing dynamics (Collins et al. 2009) https://pmc.ncbi.nlm.nih.gov/articles/PMC2817299 · sex differences in cadence and step length https://pmc.ncbi.nlm.nih.gov/articles/PMC7522423 · elbow angle while walking vs running (Yegian et al.) https://hsrc.himmelfarb.gwu.edu/smhs_psych_facpubs/1801 · running arm cues https://runningmagazine.ca/?p=78687 · photos: https://www.flickr.com/photos/40837632@N05/14691423683 · https://www.flickr.com/photos/40837632@N05/9250277370 · https://www.flickr.com/photos/40837632@N05/9247499315 · https://commons.wikimedia.org/w/index.php?curid=113207368 · https://www.flickr.com/photos/134352277@N06/19098102316

---

## 5. Stairs in a long full skirt

**What real women do** (ref `05_stairs/01–08`). They pinch or gather the skirt at the **sides, slightly to the front**, about mid-thigh, between thumb and fingers or in a loose fist. They lift it only a little and pull it slightly outward and forward, so the front hem clears the toes. The arms stay long, with soft elbows and hands near hip height (ref 01, 03, 04). The lift is held steady: no arm swing.

Going up, the trunk leans forward a little and the eyes scan 2–3 treads ahead. Going down, the body is upright, the head is down more, and the hem matters more because the skirt hides the feet.

Etiquette guides mostly advise one hand on the skirt and one on the rail when a rail is available. They disagree on side versus front lift. For a **mid-calf** skirt, the honest reading is that a light lift is enough; floor-length gowns need more.

| Parameter | Ascent, both hands lift | Descent, both hands lift |
|---|---|---|
| Grip point on the skirt | side seam to 5 cm forward of it, at mid-thigh (fabric ≈0.62–0.70 m high when hanging) | same, or slightly more forward |
| Hand height while lifted | **0.82–0.92 m** (≈ hip joint), 8–12 cm above the relaxed wrist | 0.80–0.88 m |
| Hem lift | front/sides **+8–12 cm** (hem from ≈0.30 m to ≈0.40 m, still below the knee); the back hem stays down | +5–10 cm, front |
| Elev / Plane | 10–20° / 0–20° (hands just outside the skirt bulk, slightly forward) | same |
| HumRot | −10 to −20° | same |
| Elbow | **20–45°** | 15–30° |
| ProSup | −30 to −60° (pronated: knuckles face out and forward) | same |
| Wrist | 10–20° extension, slight ulnar (pinch) | same |
| Arm motion | none relative to the trunk (hold); hands bob with the body only | same |
| Trunk pitch (Spine chain) | **5–12° forward**, peaking at push-off (about double the descent value) | **0–5°** |
| Head pitch | 15–25° down, gaze 2–3 treads ahead | **20–35° down**, glancing at the next tread |
| Cadence | 85–100 steps/min, one step per tread, step over step | 90–105 steps/min |
| Vertical rise per step | = riser (15–18 cm), smooth rise; pelvis leads with the stepping leg | controlled lower; knee bends over the toes |
| Skirt motion (GPU cloth) | the front panel tents over the lifting knee; side panels hang from the pinch points in vertical folds | the hem flares forward on each step-down |

**Variant: one hand on the handrail** (ref 06, 07). Rails sit about 0.86–0.97 m high (typical code range).

| | Rail hand | Skirt hand |
|---|---|---|
| Hand position | on the rail, 10–30 cm **ahead** of the hip; ascent ≈ hip-to-waist height | free side, front-side pinch at hip height, lifting +8–12 cm |
| Elbow | 20–40° | 20–40° |
| Elev / Plane | 20–35° / 40–70° (reaching forward and out to the rail) | 10–15° / 10–20° |
| ProSup | −80 to −90° (palm down on the rail) | −30 to −60° |
| Behaviour | the hand slides along the rail, or **re-grips every 1–2 steps** (lift, move 30–40 cm forward, set down over 0.25 s); never skates with a fixed offset | held |
| Body | leans 3–6° toward the rail; pelvis turned 5–10° toward it | |

**Fake tells:** arms swinging as on flat ground while "holding" the skirt; hands lifting a floor-length amount (to the waist) for a mid-calf skirt; hands inside the skirt volume (fused-hand bleed); head up and staring forward on a descent; no forward lean on the ascent; a rail hand floating above the rail or sliding at a constant offset; the body rising in steps not matched to the treads (foot-lock to the measured treads, DECISIONS #39/#43).

Sources: trunk flexion on stairs (Krebs et al. via) https://johk.pl/wp-content/uploads/2023/02/10.2478_v10078-010-0047-9.pdf · https://ojs.ub.uni-konstanz.de/cpa/article/view/2996/2841 · long-dress stair practice https://www.azazie.com/blog/how-to-walk-in-a-floor-length-prom-dress-without-tripping/ · https://www.jovani.com/blog/prom/how-to-walk-in-long-prom-dresses/ · https://www.mumsnet.com/talk/wedding/3699687-Walking-down-stairs-in-big-dress · photos: https://www.flickr.com/photos/8457667@N08/52893762586 · https://www.flickr.com/photos/8457667@N08/43839123601 · https://www.alamy.com/stock-photo-young-woman-standing-in-woods-lifting-skirt-cropped-side-view-15511679.html · https://www.alamy.com/blonde-female-is-going-down-the-stairs-she-is-wearing-a-long-black-dress-with-bare-shoulders-and-high-heels-image366754706.html · https://www.alamy.com/woman-going-up-the-stairs-in-apartment-house-image459866094.html

---

## 6. Idle standing while waiting

**What it looks like** (ref `06_idle/01–05`, `01_present/03`). Weight sits mostly on one leg. The hip on that side pushes out a little and the free knee is slightly bent, with that foot forward and turned out. The hands are clasped loosely in front at the low belly (guide, host, flight-attendant posture) or hang at the sides with soft elbows.

She is never still. There is slow drifting sway, breathing, an occasional weight shift to the other leg, glances around, and the head tilting toward the visitor.

| Parameter | Value |
|---|---|
| Weight split | 60–75% on the stance leg |
| Pelvis (stance side) | lateral shift 2–4 cm toward the stance leg; roll 3–5° (free-side hip drops) |
| Free leg | knee 5–15°, foot 5–10 cm forward, turned out 15–25° |
| Spine compensation | Spine01/02 roll 2–3° opposite the pelvis roll (shoulders stay level) |
| **Weight shift** | to the other leg every **8–30 s**, irregular (use a random interval, not a timer); transfer over 0.8–1.5 s, which needs a tiny foot re-plant on about 1 in 3 shifts |
| Postural sway | Hips ±0.5–1.0 cm, 0.1–0.5 Hz, **noise not sine** (sum 3+ incommensurate frequencies, or 1/f noise). Standing COP drifts slowly ("rambling") with a faster tremble on top |
| Head micro-motion | very small (people standing still move their head at about 7 mm/s on average) plus glances: a 10–30° yaw every 3–8 s, held 1–3 s, mostly back to the visitor |
| Breathing | **12–18 breaths/min** (0.2–0.3 Hz); Spine02 pitch −0.5…+0.5°, clavicles +0.5–1° on the in-breath. The in-breath is shorter than the out-breath (about 40/60) |
| Blink (if the face supports it) | every 2–6 s, irregular |

| Hands option | Elev / Plane | HumRot | Elbow | ProSup | Hand position |
|---|---|---|---|---|---|
| Clasped in front (default guide) | 10–20° / 70–90° | −30 to −50° | **45–80°** | −20 to +10 | hands overlapped at **0.85–0.95 m**, just below the navel, 5–10 cm in front of the skirt (ref 01, 02; ref 03 is lower and looser) |
| At the sides | 5–10° / 0° | −5 to −15° | 10–20° | −10 to −20° | wrist ≈0.80 m, by the skirt side |
| Fidget (every 10–40 s, optional) | re-clasp (swap the top hand), smooth the skirt, touch the hair: 0.8–1.5 s each | | | | |

**Fake tells:** equal weight on straight legs (mannequin); a visible perfect loop every 2–4 s; sine breathing that moves the whole body; perfectly mirrored arms; the head locked on the camera; no shifts at all, or shifts on a metronome; the feet sliding during a weight shift.

Sources: prolonged standing, COP migration (Duarte & Zatsiorsky) https://repositorio.usp.br/item/000995658 · rambling/trembling https://repositorio.usp.br/item/000995651 · https://bmclab.pesquisa.ufabc.edu.br/pubs/pmcvii.pdf · standing head motion ≈7 mm/s https://www.frontiersin.org/articles/10.3389/fpsyg.2020.00698/pdf · photos: https://commons.wikimedia.org/wiki/File:Young_woman_in_red_sari.jpg · https://commons.wikimedia.org/wiki/File:Singapore_Airlines_flight_attendants.jpg · https://commons.wikimedia.org/wiki/File:Woman_in_a_field_(Unsplash).jpg · https://www.flickr.com/photos/95286689@N00/445035365 · https://www.flickr.com/photos/40837632@N05/6555401871

---

## 7. Light happy dancing at a party (guide-appropriate)

**What it looks like** (ref `07_dance/01–03`). It is a bounce plus a step-touch. Knees flex on every beat, and the weight steps side to side every two beats. The elbows are bent with the hands loose at waist-to-shoulder height, thumbs or loose fists out, moving small with the beat (ref 01). The head tilts and the face is smiling, sometimes looking down or aside. The hip pushes toward the weighted side. The raised-arms "club" pose (ref 02) is the upper limit, used for one or two beats at most.

Motion-capture studies of people moving freely to music find the overall bounce locks to the beat. Head and hand speed rise with a clearer pulse and more percussive music.

| Parameter | Value |
|---|---|
| Tempo | track BPM; if unknown, 110–124 BPM (1.8–2.1 Hz) |
| Bounce | knee flexion 5–15° on each beat → Hips down 2–4 cm; **down on the beat**; the low point lands 0–50 ms after the beat |
| Step-touch | step to the side 15–25 cm every 2 beats, alternating; feet locked when planted |
| Hip sway | lateral ±3–5 cm, roll ±4–6° toward the weighted leg, every 2 beats |
| Shoulders / chest | Spine02 yaw ±5–10° and roll ±3° in counter-phase to the hips; an optional shoulder bob (clavicle +3–5°) on the off-beats |
| Arms | Elev 25–45°, Plane 30–60°, Elbow **70–110°**, hands at 1.0–1.3 m, loose; small pumps (±10° Elev or ±15° Elbow) on each beat, the two arms alternating or slightly offset |
| Accent | every 8–16 beats: one arm lifts higher (Elev +30°) for 1–2 beats, or a small turn of 45–90° using foot steps |
| Head | roll ±5–8° with the sway every 2 beats, nod 3–5° on beats; gaze alternates between the visitor and down/aside |
| Variation | change the move every 8 or 16 beats (bounce-only → step-touch → arm accent); randomize amplitude ±20% |

**Fake tells:** off-beat or tempo-less motion; the whole loop repeating identically; fully extended flailing arms; hips pinned while the torso grooves; the upper body bouncing without knee bend; the feet sliding during step-touches; constant full intensity (people drift in and out of energy).

Sources: motion capture of movement to music https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00183/pdf · https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.01382/pdf · bouncing to the beat https://www.eurekalert.org/multimedia/1037101 · photos: https://www.alamy.com/young-beautiful-brunette-german-woman-celebrating-octoberfest-wearing-traditional-dress-dancing-happy-and-cheerful-smiling-moving-casual-and-confiden-image347408621.html · https://www.alamy.com/photo-of-young-beautiful-girls-dancing-on-party-in-night-club-wearing-classy-stylish-dresses-smiling-relaxing-together-image384490302.html · https://www.alamy.com/stock-photo-smiling-happy-girl-dancing-and-wearing-white-shirt-and-black-pants-173256811.html

---

## 8. Turning in place and turning while walking

**What real people do** (ref `08_turn/01`). Turning starts at the top and works down: eyes, then head, then trunk, then pelvis, then feet. This head-first order holds across turn sizes and speeds in healthy adults. The feet only change heading **during swing**. A planted foot may pivot a little on the ball or heel, but it never slides.

Mid-walk, people mostly use a **step turn**: to turn left, plant the right foot and step the left foot out toward the new heading. It keeps a wide base and is the preferred strategy at normal speed. A **spin turn**, pivoting on the inside stance foot, is used at slow speeds and in tight spaces. It needs more pivot and is less stable.

### 8A. Turning in place

| Turn | Steps | Duration | Pattern |
|---|---|---|---|
| 45–60° | 1–2 | 0.6–0.9 s | step the outer foot open 30–45°, bring the other foot alongside |
| 90° | 2 | 0.9–1.2 s | lead foot: step, opening 45–60° toward the new heading; trail foot: step alongside, finishing the turn |
| 180° | **2–3** (healthy adults: median 2–2.5 steps in about 1.5 s on a quick test); use 3 steps / 1.6–2.0 s for a relaxed guide | | each step adds 60–90°; feet lift 3–6 cm |

### 8B. Turning while walking (90° corner)

| Parameter | Value |
|---|---|
| Steps to complete | 2–3, with the turn spread across them |
| Speed | drops 10–20% through the turn (the project already slows through turns) |
| Lean into the turn | 3–6° roll (Hips to Spine), scaled by v²/r |
| Strategy | step turn by default; spin turn only below about 0.8 m/s |
| Foot placement | each new foot lands already rotated toward the path tangent; the stance foot pivots at most 10–20° on the forefoot |
| Arm swing | continues, slightly reduced on the inside arm |

**Segment timing for any turn** (angles relative to the final heading change θ):

| Segment | Onset (vs first foot leaving the ground) | Reaches θ at |
|---|---|---|
| Eyes (saccade) | −250 to −150 ms | immediately, within eye range |
| Head | −200 to −100 ms | about 40–50% of the turn duration (the head arrives early, then waits) |
| Chest (Spine02) | −100 to 0 ms | about 70% |
| Pelvis | 0 to +100 ms | about 85% |
| Feet | stepping, from 0 | 100% |

Peak head-vs-pelvis twist mid-turn: 20–35° for a 90° turn, up to about 45° for 180° in place. Healthy people separate head and trunk rotation; Parkinsonian turning is "en bloc" with no separation, which is exactly what reads as robotic.

**Fake tells:** rotating the whole character as one rigid block about the root (en bloc); feet skating or spinning in place while the root turns; turning without any step; the head arriving last; instant 180° snaps; a turn that doesn't slow her down; an arrival "orbit" (DECISIONS #33).

Sources: Hase & Stein 1999, step vs spin turns (abstract and citations) https://data.zhenzhi.com/details/1/863728395 · step-turn advantages (Taylor et al. 2005) https://pubmed.ncbi.nlm.nih.gov/16129503/ · turn classification (Golyski 2017) https://sites.gatech.edu/p-golyski/wp-content/uploads/sites/755/2018/01/Golyski-2017-A-computational-algorithm-for-classifying-step-and-spin-turns-using-pelvic-center-of-mass-trajectory-and-foot-position.pdf · step vs spin preferences by speed https://pmc.ncbi.nlm.nih.gov/articles/PMC6151057 · top-down head-trunk-pelvis order (Akram et al.) https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/10.3389/fbioe.2017.00051/pdf · en bloc in PD https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2020.00022/pdf · 180° turn steps and time https://eprints.soton.ac.uk/464945/ · photo: https://www.alamy.com/stock-photo-rear-view-shot-of-young-woman-walking-with-her-friend-looking-back-87464772.html

---

## 9. Render checklist (run on every gesture clip)

1. **Silhouette at phone size**: the gesture reads at 200 px character height; the arm is clear of the torso and skirt in the image plane.
2. **Order**: eyes/head lead every look and turn; the shoulder leads, then elbow, then hand on every gesture, and the hand settles last.
3. **Clavicle**: moves on any Elev above 30°.
4. **Palm**: visible or edge-on to the visitor when presenting or waving; never the back of the hand.
5. **Elbow**: never 0° (except the far point, which sits at 5° or more), never hyperextended.
6. **Holds breathe**: noise and breathing present, no frozen frames longer than 0.3 s.
7. **Feet**: no foot moves while its contact flag is on (measure the world velocity of a planted foot: it should stay under 0.05 m/s).
8. **No loop seams**: idle and dance vary per cycle.
9. **Weight**: idle, presenting and pointing all stand asymmetrically (60–75% on one leg).
10. **Cloth**: hands stay outside the skirt volume except at intended pinch points.

---

## 10. Free references worth borrowing from

| Reference | What to borrow |
|---|---|
| **TalkingHead** (met4citizen, MIT), three.js full-body avatar: https://github.com/met4citizen/TalkingHead | Data-driven `gestureTemplates` that override only the arm bones over a base pose, `poseTemplates` authored with weight on one leg and mirrored automatically, mood-dependent idle loops with probabilistic timing, `makeEyeContact`/`lookAt` with idle-vs-speaking eye-contact ratios, and spring-damper "dynamic bones" for hair and cloth. |
| **Daniel Holden, "Inverse Kinematics and Foot Locking"**: https://theorangeduck.com/page/inverse-kinematics-foot-locking (code: https://github.com/orangeduck/GenoView-InverseKinematics), plus "Dead Blending" https://theorangeduck.com/page/dead-blending and "Perfect Tracking with Springs" https://theorangeduck.com/page/perfect-tracking-springs | Contact detection from toe velocity (0.1–0.5 m/s) and height (≈0.1 m) with a 5-frame majority filter; lock/unlock with `lockDistance`/`unlockDistance`; inertialized blend in and out of the lock; a soft-clamped two-bone leg IK. The spring helpers suit look-at and gesture targets. |
| **orangeduck/Motion-Matching** (MIT code; the dataset is CC BY-NC-ND): https://github.com/orangeduck/Motion-Matching | An Emscripten web build of motion matching with inertialization and springs. Worth borrowing as "motion matching lite": a small database of the existing Meshy clips searched by future trajectory and foot positions, instead of hand-tuned walk/turn/stop switches. |
| **three.js examples**: additive blending https://threejs.org/examples/#webgl_animation_skinning_additive_blending and CCD IK https://threejs.org/examples/#webgl_animation_skinning_ik | `AnimationUtils.makeClipAdditive` to layer breathing, sway and gesture beats additively over Meshy locomotion, so the arms aren't replaced by one stiff override. `CCDIKSolver` with per-link rotation limits is a ready-made, angle-constrained arm/hand reach for rail grabs and skirt pinches. |
