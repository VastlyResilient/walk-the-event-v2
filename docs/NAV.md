# Guide navigation map (`nav_<floor>.json`)

Where the 3D guide can walk beside the visitor: the corrected floor height along the walked path, the free lateral
lane at each point, a preferred walking offset, the stair treads, holdable rails and static blockers.

Regenerate with:

```
.venv/bin/python -I pipeline/nav_study.py upstairs   --validate
.venv/bin/python -I pipeline/nav_study.py downstairs --validate
```

It takes about 1 minute per floor. Depth and mask frames are cached in `work/nav/`. Validation images are written to
`/private/tmp/claude-501/nav/` (set `NAV_OUT` to change that).

## Inputs

- `app/public/data/camera_<floor>.json`: pose per frame, intrinsics, per-frame depth fit, `conf`.
- `work/depth/<floor>_depth.mp4` and `_mask.mp4` (360x640): the same depth and people-mask frames that are packed
  into the walk segments. They are decoded with OpenCV, exactly as `build_camera.py` decoded them for the depth fit.
- `app/public/media/walk/<floor>/sd_NN.mp4`: colour, decoded with ffmpeg (BT.709). Used for stair edges and for
  the review images.
- `app/public/data/beats_<floor>.json`: chapter names, used in notes and to guide the review.

## Method

### 1. Camera height: is 1.40 m right?

The solve sets the metric scale by assuming the phone is 1.40 m above the floor. I checked this without using
depth. I took frames with at least two isolated, standing people (connected components of the SegFormer mask,
person-shaped, not cut off by the image edge) at different distances. Their feet rows `vf` and head-top rows `vh`
fit `vf - v0 = (h / H_person) (vf - vh)`, which gives both the horizon row `v0` and the ratio of camera height to
person height.

| floor | frames | camera height (1.70 m people) | IQR | image horizon minus track horizon |
|---|---|---|---|---|
| downstairs | 132 | **1.37 m** | 1.28-1.45 | +0.001 of image height |
| upstairs | 102 | **1.42 m** | 1.31-1.51 | -0.019 of image height |

So 1.40 m and the track's pitch are both right.

The raw monocular depth does not agree. A RANSAC ground plane under the stored `depth_a/b` calibration puts the
floor only **0.94 m (downstairs) and 1.06 m (upstairs)** below the camera. Near-floor depth comes out about 30 %
short, because the calibration was fitted to the solve's feature points, which are mostly far walls. Raw depth is
therefore never used for absolute heights (see step 3).

### 2. Floor height `floor_y`

- Flat floor: `y_cam` (Gaussian smoothing, sigma 4 frames, which keeps landings and steps) minus 1.40.
- Stairs: segments where camera height rises against path distance faster than 0.2 m/m for at least 1 m, on a
  fully solved stretch (`conf == 1`), away from pose seams. Upstairs this finds frames 28-233 and 297-487 (two
  flights with a landing between them). Downstairs has no stairs on the walked line.
  - On stairs the phone is held about 0.3 m in front of the feet. The floor under the camera's ground point is
    therefore `camY(s + 0.3) - 1.40`, which is about 0.10 m higher than the old estimate while climbing.
  - **Treads.** Image-luminance and depth vertical-edge strength are sampled where each candidate nosing (at path
    distance s, on the floor ramp) projects into every frame 0.8-4 m behind it. A regular comb (period 0.22-0.40 m,
    any phase) is fitted to that evidence. Risers are fitted linearly to the floor at the tread centres, and
    `floor_y` is quantised to the treads.
  - Result: flight 1 has 10 treads (going 0.33 m, riser 0.127 m) and flight 2 has 11 treads (going 0.29 m, riser
    0.111 m). Total rise 2.4 m. Each tread is listed in `steps`.
- Pose seams: places where the camera height jumps faster than 0.5 m/s (solve fragment joins). Upstairs these are
  frames 1427, 3106 and 3510. They are listed in `seams`. The floor jumps with the camera there, so a target on the
  far side of a seam is seen from the other fragment's world.

### 3. Depth recalibrated to the floor

For every analysed frame, `1/z = a*d + b` is refitted by robust least squares so that the walked floor 1-6 m ahead
(the step 2 floor at lateral offsets -0.3, 0 and +0.3, with people masked out) lands on the observed disparity.

- Median residual: **0.8 % downstairs**, **1.6 % upstairs**. The affine model is fine; only its constants were off
  for the floor range.
- Frames without a good fit borrow the neighbours' correction ratio.
- After this, the depth profile matches the stair treads (`nav_upstairs_profile_stairs.png`).
- **The fit is shipped** (`da`, `db` per sample, on the raw byte/255 disparity) and used live: the guide's scene sense
  (`sense.ts metric()`) and the guide's occlusion shader (`view.ts occlusionFit()`, re-expressed for the linearised
  byte the shader samples, exact at her depth) read depth with it instead of the solve's feature-point fit.
  Measured in the app (`qa/tools/sense_depth_check.py upstairs`, sense depth of the walked floor 1.5-5 m ahead vs its
  true distance): with the solve's fit the median ratio is 0.89 overall but **0.28-0.67 in frames 2100-3300**
  (the tilted `conf 0.5` stretch), with `da/db` it is **0.95-1.10 everywhere** (median 1.036, |log ratio| p75 0.08 vs
  0.50). With the old fit, clear floor read as "something in front of her feet" and the shader cut her as if a wall
  stood in front of her there.

### 4. Lanes and the preferred offset

- For each sample t (every 5 frames), candidate spots are placed at lateral offsets -3..+3 m (0.1 m steps). The
  lateral axis is the right vector of the smoothed path, `(-tz, tx)`, which is what `brain.lanePoint` uses.
- Each spot is projected into up to 6 frames 1.2-4.2 m behind t and scored:
  - **Floor visible at the predicted depth:** free.
  - **Something nearer at the feet:** blocked. This covers rails, benches, walls and plinths.
  - **Floor much farther than predicted:** a drop such as a balcony edge. This test is skipped in stair zones,
    because open risers look like drops.
  - **Solid at hip, chest or head height just in front of the spot:** blocked.
  - **Person-mask pixel at body height at the right depth:** a person.
- `lane` is the contiguous free interval around the walked line, median-filtered over 5 samples. Offsets that no
  view covered do not count as free. Samples nobody looked at (the very start, sharp turns) borrow the nearest
  sample that was seen.
- `prefer` is chosen by Viterbi over the samples among |lat| 0.3-1.0 m. It favours about 0.6 m beside the
  visitor, at least 0.4 m of clearance, and the side with more room, away from people. It penalises side switches.
  On stairs it favours the side of a holdable rail.
- Lanes widened by eye (`lanes` in the REVIEW table): where the depth calibration did not converge the measured lane
  can come out far narrower than the floor the footage shows. Upstairs 3105-3200 (the Plant Room: the walked line
  hugs the planter, fit_gap up to 60 frames, the solve tilted) the lane was 0.4 m wide although the room floor runs
  ~3 m to the right; it is widened to [-0.2, +1.6] there (people are avoided live).

### 5. Rails and blockers

- **Rails.** A point counts if it is 0.7-1.25 m above the floor and 0.35-3 m to the side, and the pixel about
  0.15 m above it in the image is at least 0.7 m farther away (open space over a parapet or balustrade). People are
  excluded with a dilated mask. Candidates are binned along the path per side, need support from at least 4 frames
  and a consistent offset, and are joined into segments of at least 1.2 m (split into pieces of up to 2 m).
  `holdable` means the top is at 0.75-1.2 m and the rail is within reach of the lane.
- **Blockers.** A world xz occupancy grid (0.15 m cells) collects solid points 0.15-1.9 m above the floor (from at
  least 6 distinct frames) against floor hits. Compact components 0.45-2.6 m from the path become circles.
  Elongated components (walls) are dropped.
- **Review by eye.** Every detection was checked on review sheets (`nav_<floor>_rails_detected.jpg`,
  `nav_<floor>_blockers_detected.jpg`). The kept and dropped items, plus objects placed by hand, are in the
  `REVIEW` table in `nav_study.py`. Hand-placed objects use the image pixel where the object meets the floor,
  intersected with the floor plane (track geometry only, no depth).

## Schema (as produced)

```jsonc
{
  "floor": "upstairs", "step": 5, "camera_height_m": 1.4,
  "lat_axis": "smoothed path right (-tz, tx), + = right",
  "samples": [ { "f": 120, "s": 1.674, "floor_y": -0.705, "lane": [-0.9, 0.8], "prefer": 0.4,
                 "stairs": true, "stair_dir": 1,
                 "da": 0.7022, "db": 0.1086 } ],              // one per 5 footage frames; da/db: 1/z = da*d + db
  "steps":   [ { "s": [0.227, 0.557], "y": -1.213, "front": [x, y, z], "dir": 1, "f": 22 } ],   // treads
  "rails":   [ { "a": [x,y,z], "b": [x,y,z], "side": "right", "frames": [133, 248], "s": [1.88, 3.88],
                 "height": 1.0, "lat": 0.87, "holdable": true, "support": 1855, "note": "...", "chapter": "blue-ascent" } ],
  "blockers":[ { "x": -0.53, "z": -18.62, "r": 0.3, "height": 1.3, "f": 922, "dist_from_path": 1.88,
                 "note": "...", "source": "depth" | "placed by eye (floor-ray)" | "manual" } ],
  "seams": [1427, 3106, 3510],
  "checks": { "people": {...}, "raw_depth_floor_below_camera_m": 1.065, "recalibrated_frames": 544,
              "recal_median_residual": 0.016 },
  "notes": "..."
}
```

- `s` uses the same definition as `brain.ts` `S`: cumulative xz distance, capped at 0.08 m per frame.
- Rail `a` and `b` are world-space points on top of the rail.
- Counts: upstairs has 775 samples, 21 treads, 4 rails (3 holdable: the stair balustrade) and 1 blocker (the cyan
  light sign). Downstairs has 714 samples, 2 rails (both holdable: the curved balcony balustrade) and 27 blockers:
  12 from depth (corridor pillars, columns, a bench, plinths) and 15 placed by eye (cube bench, three LED screen
  stands, velvet-rope stanchions, plinths, the CPU-terminal plinth, the balcony curb).

## The stairs levitation (upstairs 0-14 s)

The floor estimate was not the cause:

- The old floor (`camY - 1.4`, box-smoothed over 41 frames) differs from the tread-quantised floor by at most
  **0.18 m** on the stairs. The mean is +0.10 m, because the phone is held ahead of the feet. The box smoothing
  itself adds at most 0.05 m.
- On flat floors the old and new floors agree to within 0.02 m.

The cause is in `brain.ts`. The guide's height chases the **target's** floor, `pos.y += (target.y - pos.y) * dt * 6`,
which settles in about 0.2 s. Her xz walks there at walking speed. Targets are picked 1.7-5.2 m ahead, and looking
up the stairs the on-screen size test favours the far leads.

- The floor rises up to **1.12 m between 2.0 m and 5.2 m ahead** (frame 211) and up to 1.02 m between 1.7 m and
  4.4 m ahead.
- So she rises to the far step almost at once, hangs up to about 1 m above the steps she is still walking over,
  then drops when a nearer target is chosen.

Fix: take the floor at her own path distance, `navAt(nearestS(pos)).floor_y` or a step from `steps`, never
`target.y`. Cap the vertical speed. The new lane-following code does this. The older `chooseTarget` path still
sets `target.y` from far frames.

## Validation images

All are in `/private/tmp/claude-501/nav/`:

- `nav_upstairs_profile_stairs.png`: side view along the path. Shows camera y, the old floor, the new tread floor
  and the recalibrated depth points; the depth's upper envelope sits on the treads.
- `nav_upstairs_stairs.jpg`: frames 0-420. A 1.6 m stick figure stands 3 m ahead at `prefer`; green is the new
  floor, red is the old one. Also drawn: the lane (yellow) and the stair balustrade rail (blue). The feet land on
  the treads.
- `nav_upstairs_flat.jpg`, `nav_downstairs_flat.jpg`: the same check on flat floors.
- `nav_<floor>_map.png`: top-down view of the path, lane edges, preferred line, rails and blockers.
- `nav_<floor>_lanes.png`: free-space score per sample (x) and lateral offset (y, top is +3 m, right side), with
  lane edges and the preferred offset.
- `nav_<floor>_rails_detected|final.jpg`, `nav_<floor>_blockers_detected|final.jpg`: the review sheets.
- `nav_downstairs_profile_start.png`, plus the earlier probes: `profile_upstairs_0_600.png` (the raw depth fan)
  and `cubes_check.jpg`.

## How the guide uses the map (brain.ts, Nov 2026)

- Every spot she stands on is chosen as an anchor `(s, lat)` on this map and validated each frame: `lat` is clamped
  to the free `lane` at `s` (the narrower of the two neighbouring samples) with 0.28 m body clearance, and the spot
  must be in frame (with margins), at a readable size, standable (blockers + 0.3 m, rail sides, people) and clear in
  the live footage depth. She then walks there (facing her direction of travel). Before, lateral offsets of
  `prefer +- 0.5 m` and a camera-front fallback were used without the lane bounds: walls, the planter, the far side
  of the atrium.
- Where the solved path ahead is out of the picture (the tilted stretches, the camera looking across a turn, the end
  of upstairs), a camera-relative spot is allowed only if the live depth shows floor at the visitor's level all the
  way from the visitor to the spot (`camFloorOk`: no drop, not the far side of a void).
- `seams` stretches with `conf 0` upstairs use the lane like everywhere else (they used to switch to the downstairs
  "lantern" placement 2.4 m in front of the camera: over the atrium in the last 4 frames). The solve bridge at
  frames 3501-3518 (the camera jumps ~7 m in 0.6 s of footage) carries her rigidly with the camera.

### Round 2 additions

- Every reviewed rail carries `"drop": true` (balustrades over the atrium / stairwell): the brain keeps 0.6 m from the
  rail line (0.45 m otherwise) and steers back when walking within 0.9 m; spots within ~0.6 m of an edge where the live
  depth shows a drop behind are rejected as well.
- The automatic glass-balustrade rail at the end of upstairs was ~1 m off (depth sees through glass; the solve is tilted
  ~20 deg there): with it the guide stood 0.2 m from the visible edge while the map said 0.76 m. It is replaced by the
  visible edge, floor-rayed from the pixels where the glass meets the floor (`manual_rails` in the REVIEW table). The
  same edge floor-rays ~0.6 m apart from frames 3790 and 3871 (solve drift), so each view gives its own segment with an
  `active` frame range; the brain only applies a rail within its active range (default: its frames +-300).
- `spots` (off-lane standing spots, floor-rayed by eye, with `from_s`/`to_s`) are supported by the pipeline and the
  brain. None are kept: on the final upstairs frame the only balcony floor in frame is a ~0.6 m strip of walkway at the
  right edge beside two guests; a guide placed there is cut by the frame edge or hidden by the end view's depth.

## Blocking track (round 6): her position solved offline per footage frame

The footage is deterministic, so her place is solved once, globally, instead of being searched live from noisy per-frame
sensing. `pipeline/blocking.py <floor> [--sheet]` writes `app/public/data/blocking_<floor>.json`:
`{floor, step: 5, fps, end, v_her, walk_cap_ms, P: [[x, floor y, z, flag], ...], violations: [[f0, f1], ...]}`.

- **Candidates**: a world grid along the smoothed walked path (0.125 m along x 0.125 m across). Lateral offsets cover
  the measured lane with 0.28 m wall clearance, plus up to 1.5 m beyond it. The measured lane is also narrowed by
  people (nav_study counts a standing person as not free); people are judged per frame here. Off-lane states must show
  floor at her feet in the footage (feet ratio 0.85-1.2) and nothing nearer at body height, in that very frame.
- **Hard constraints per step** (every 5 frames: the frames whose depth / mask the nav map decoded, with the nav map's
  floor-calibrated depth fit da/db):
  - walkable: >= 0.6 m from a balustrade with a drop (0.45 m from other rails), on the walked side; blocker radius +
    0.3 m clear;
  - in frame on a phone (cover crop of the 9:16 footage to 393x852): her box (height x 0.27 each side) 6 % from the
    left, top and bottom, right edge <= 0.90 of the screen (progress rail);
  - height / screen 0.20-0.45;
  - covers <= 25 % of a live station's tracked glow rect;
  - people: person-mask cells in her box from 0.6 m nearer to 0.25 m behind her (drawn over / into them) <= 3 % of
    the box, people farther in front (they hide her correctly) <= 15 %;
  - walls: footage at her torso nearer than 0.68 x her distance in <= 20 % of torso samples, feet ratio 0.62-1.65,
    scenery 0.9 m nearer than her in <= 20 % of the box.
- **Soft costs**: composition (centre a third in from a side, feet in the lower half, height ~0.3) and people fraction.
- **DP**: Viterbi over the steps. Her speed budget comes from the pace cap: the fastest playback the app allows while
  she leads (`WALK_CAP_MS` = 1.6 m/s along the path, `PAN_CAP` = 1 rad/s, at most 120 fps = 4x real time;
  app.ts `buildWalkCap`, replicated in the solver). A step lasts 5 / cap(f) seconds of real time; she may cover at
  most 0.9 x 2.3 m/s x that, sideways included. A longer step is a flagged last resort (+200). Costs also cover
  movement, moving backward along the path, lateral moves and side switches. Relaxed candidates (2 % margins, size
  0.15-0.5, people <= 12 %) keep the track continuous where nothing strict is reachable (+60 per step, flagged).
- **Unsolved frames** (camera conf 0, and the downstairs dark passage from 3009, where the brain keeps the lantern
  companion) carry no constraints (flag 16).
- **Output and checks**: the track is smoothed over 5 steps; her speed at the fastest playback is checked over
  ~0.6 s windows. Flags: 1 relaxed, 2 nothing valid, 4 a jump, 8 over the speed budget, 16 unsolved. Violated frame
  ranges are printed with, per range, the number of strict candidates per step and how many candidates failed only one
  constraint. The contact sheet draws her box from P(f) on the footage every 20 frames (`--sheet`; green ok, orange
  relaxed, red nothing valid, white rectangle = the phone's visible crop).
- **Runtime** (brain.ts): with the track loaded her target is P(shown frame); at a jump cut it is P(the target frame).
  She follows it with the normal locomotion (facing travel, accel limits, a walker: never above 2.3 m/s). The live
  spot search, dissolves and unseen re-placements are off on the track. The downstairs dark passage keeps the lantern
  companion. Live occlusion stays in the shader.
- **Pace cap**: with her limited to 2.3 m/s, a 2.0 m/s camera cap leaves too little headroom (downstairs 290 of 714
  steps violated). At 1.6 m/s: downstairs 76, upstairs 127. At 1.3 m/s (about real time): downstairs 63. The app uses
  1.6 m/s and 4x.

### Tiers (round 6b)

The DP always outputs the best realistic option:

- **tier 0**: everything above.
- **tier 1** (+30): she may stand behind a nearer person (nearer by more than the shader's 0.3 m, so she is really
  hidden) with up to 50 % of her body hidden; height up to 0.52; frame margins 3 %.
- **tier 2** (+90): up to 25 % of her box outside the frame; up to 40 % of a glow covered.
- **flagged transit** (+250): only the NEVER rules hold. It is used where nothing within tier 2 is reachable at her
  walking speed.
- **NEVER**, under any tier: over a drop or within 0.6 m of glass or rails; inside a wall, blocker or person; drawn
  over a nearer person (a person from 0.33 m nearer to 0.25 m behind her); less than 60 % visible; size > 0.6; head
  inside a glow; speed > 2.3 m/s (+2000; a forced jump +1e5).

The solver reports frames per tier and the violated ranges (beyond tier 2, a jump, or over the speed budget).
Projection matches the runtime (cover crop and the view's 7.5 % overscan): the planned height at a settled spot
equals the measured runtime height (checked at upstairs 2140 / 3160 / 3790). Composition prefers height 0.28-0.34 and
feet in the lower middle (0.66-0.84 of the screen).

### Violated ranges: verdicts (cap 1.6 m/s, from the `--ranges` contact sheets)

Downstairs (tier0 82.4 %, tier1 5.0 %, tier2 6.0 %, beyond 39 steps):
- 835-850: crowd crossing the hall entrance; valid spots exist but people sweep them faster than she can follow at the cap (speed / jump).
- 1080-1225: White Curve: the walkway is a narrow curve with a guest walking just ahead, the rail on the right and the off-camera beacon on the left; only near spots remain (height > 0.52, transit). Needs a hand-placed spot ahead on the walkway or a slower cap here.
- 1260-1270, 1350: momentary crowd crossings (one or two steps).
- 1750-1785: projection room: groups standing in the open floor; tier 1 with speed overruns.
- 1860-1865, 1985-2005: Deep Blue column / crowd edges: tier 2-3 for a step or two.
- 2090-2100, 2185-2205: atrium crowd: speed overruns.
- 2250-2290, 2365-2395: merch area between the cube benches and seated guests: little floor in frame, transit.
- 2665-2685: Terminal Row approach: speed overruns.
- 2930-3567: lantern passage (unsolved by design).

Upstairs (tier0 76.9 %, tier1 6.0 %, tier2 11.0 %, beyond 45 steps):
- 245, 395-475: top of the stairs: a man walking up behind the camera fills the near floor; dark landing; tier 2-3.
- 575-585: dark corridor with guests; transit.
- 2190-2205: Disco Floor entrance crowd; transit.
- 2340-2460: dark blue room: monocular depth is unreliable on the dark floor; only near spots pass (h > 0.45, transit).
- 2715-2920: dense crowd (the bar room): every spot in frame is behind or among guests; tier 1-3 with speed overruns.
- 3155, 3270: single steps.
- 3425-3500: before the solve seam (3501-3518): the walked path leaves the view; transit.
- 3740-3770: balcony approach before the new walk end (3770).

### Round 7: camera distance, smaller / behind tier 2, path-behind floor, facing-away steps

- **Camera distance** (ground distance from the camera at the step's frame): tier 0 >= 2.2 m, tiers 1-2 >= 1.9 m,
  never below 1.7 m (`CD_T0`, `CD_T12`, `CD_NEVER`). The runtime dissolves her below ~1.5 m, so P keeps tracking
  headroom; anything nearer than 1.9 m is re-targeted at runtime (below).
- **Tier 2** may also stand behind guests (correctly hidden by the shader) for up to 80 % of her box, and further
  back, down to 0.12 of the screen (`BEHIND_T2`, `T2_HMIN`), where the near floor is full of guests.
- **Path behind**: where no state ahead on the path is in front of the camera at tier <= 2 (the camera turned aside or
  back), the floor up to 4 m behind the visitor is a candidate (+3 per metre behind).
- **Facing away**: where even then under 2 % of the candidates are in front of the camera (the low-confidence solve
  before the upstairs seam, 3445-3495), the step is flagged 16 like an unsolved frame.
- Steps beyond tier 2 / jumps / over the speed budget (round 6c -> round 7): downstairs 41 -> 36 / 714, upstairs 57 ->
  59 / 755 (the camera-distance rule costs about 14 upstairs; the facing-away flag removes 10).

**Runtime use (brain.ts)**: she follows P(shown frame) while P is in view (>= 60 % of her box inside, >= 1.9 m from the
camera, height <= 0.52); otherwise the nearest in-view point on the track's lane (body >= 80 % inside, >= 2.0 m, no
wall / drop / person / blocker, re-chosen every 0.15 s). Steps flagged 16 (and conf-0 runs of 20+ frames): her goal is
carried with the camera at her screen place from the last checked frame (or a default spot 3 m ahead), and she walks
to keep it. Camera proximity: predicted ground distance < 1.56 m or height > 0.52, she dissolves in ~1 frame; < 1.3 m
she is not drawn. Out of frame for 0.35 s (or dissolved) she walks back in from just outside the frame edge (the
leading edge while the camera pans, else the edge nearest her goal), facing travel, at 1.8 m/s.

## Known limits

- **Parts of the upstairs `conf 0.5` stretches (frames about 2160-3060, 72-102 s) have a tilted world up**, about 13-21 degrees by the depth
  plane. Camera y drifts there, so a vertical guide leans in the image. `floor_y`
  stays "camera minus 1.4", which is right under the camera but not a true level.
- **Seams** at upstairs frames 1427, 3106 and 3510: the floor jumps. Avoid targets that span a seam.
- **Lanes are per footage moment** and include the people present then; they widen once crowds pass. Lanes in the
  dark (downstairs after 100 s, `conf 0`) are borrowed from the last seen sample.
- **Rails.** Only parapet- or balustrade-type rails with open space above them are found. Wall-mounted handrails
  are not (the wall continues above them). The upstairs glass balustrade at the end has a measured top of 0.73 m,
  because depth sees through glass, so it is marked not holdable. The bottom 1.9 m of the stair balustrade is
  outside the first frames' view.
- **Blockers.** Monocular depth misses black furniture (the cube bench reads as floor), so that bench is placed by
  hand. All upstairs depth detections were people, walls or seam artefacts and were dropped; only the cyan sign
  remains. Positions placed by eye are about ±0.4 m (floor-ray at 3-7 m).
- **`brain.ts` hand-placed cube blockers** (x = -19.6, z -10.45..-7.65) lie **on the walked line**. The camera
  walked through x = -19.6 at z -11.8..-5.7 with `conf 1` (`cubes_check.jpg`). The bench is beside the path, so
  those circles block the walked line itself. The nav file has the bench along its path-side edge instead.
- **`sense.ts`** reads the raw depth byte and, once the nav map is loaded, converts it with `da/db` (above). The
  guide's occlusion shader samples the byte linearised (sRGB texture); `view.ts` re-expresses the fit for that.
  QA tools that emulate the shader should read `__walk.view.occFit` (the uniform actually used).
