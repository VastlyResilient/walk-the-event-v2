# WALK THE EVENT v2: Master Build Prompt for Claude Code

> **For Bobby (setup, about 5 min)**
> 1. Make a fresh project folder and drop everything in like this. The names don't have to match exactly; the agent will inventory and map whatever you send.
> ```
> walk-the-event/
>   MASTER_PROMPT.md                ← this file
>   input/
>     videos/
>       downstairs.mov              ← IMG_3817 (has the stations)
>       upstairs.mov                ← IMG_3864 (no stations)
>     breakdown/                    ← screenshots from the downstairs video, station circled + labelled
>     stations/
>       <station-label>/            ← one folder per station: photos + the write-up card
>     mascot/
>       hermes-guide.png            ← the Hermes girl reference drawing
>   .env                            ← keys (see below)
> ```
> 2. `.env`. Put in whatever you have. The agent adapts to what's present.
> ```
> OPENROUTER_API_KEY=...          # required: video transitions, image gen, LLM, judge models
> VIDEO_BUDGET_USD=60             # hard spend cap for AI video generation
> TOTAL_BUDGET_USD=120            # hard cap for all paid API calls
> MESHY_API_KEY=...               # optional: image→3D + rigging + animations for the mascot
> XAI_API_KEY=...                 # optional: Grok live X search for research
> GITHUB_TOKEN=...                # optional: repo + research via gh
> RAILWAY_TOKEN=...               # optional: deploy
> ELEVENLABS_API_KEY=...          # optional: Hermes guide voice
> ```
> 3. Run it fully autonomous **in an isolated folder, VM or dev container. Never on a machine holding production credentials.** Set a spend limit on the OpenRouter key itself as well.
> ```
> cd walk-the-event
> claude --dangerously-skip-permissions
> ```
> Then paste: **`Read MASTER_PROMPT.md and execute it end to end. Do not stop to ask me anything.`**

---

## 0. ROLE AND BAR

You are the lead of a small studio team: creative director, technical director, VFX/media engineer, 3D character artist, front-end experience engineer, and QA. Your job is to build **"Walk the Event"**, an immersive, award-level web experience. Someone who missed the Nous Research / Hermes event in NYC can walk the venue from the real footage. A 3D Hermes guide character leads the way like a video-game companion, and every interactive station at the event can be discovered, entered and learned about.

The bar: an attendee says "that's exactly how it felt." A non-attendee loses their FOMO and smiles. Nous Research quote-posts it. It has to feel **real, cinematic, effortless and fun**: not a tech demo, not a slideshow, not a point cloud.

You run **fully autonomously with zero approvals**. Never pause to ask Bobby. When uncertain: research, prototype two approaches, test both, pick the winner, log the decision in `docs/DECISIONS.md`, move on.

---

## 1. WHAT FAILED IN v1 (DO NOT REPEAT, DO NOT REUSE ITS CODE)

A first prototype was rejected. Do not use or reference its code. Its failures are your hard constraints:

1. **Discolored footage.** Root cause, verified: both videos are **iPhone Dolby Vision HDR: HEVC Main 10, BT.2020 primaries, HLG transfer (arib-std-b67), 10-bit, with a DOVI config record.** v1 transcoded to 8-bit SDR without tone-mapping, so colors went washed and shifted. **Fix:** tone-map properly to BT.709 SDR. Use `libplacebo` with Dolby Vision support if your ffmpeg has it, otherwise `zscale` + `tonemap=hable` or `bt.2390`. Check every frame against a reference still exported from the original (QuickTime/Photos look) and match within ΔE ≈ 3 on skin tones, white walls and the magenta/violet lighting. Also produce an HDR HEVC variant for Safari on HDR screens if it's cleanly better; SDR stays the default.
2. **"LiDAR look."** v1 showed blue/purple fused depth points. **Banned:** no visible point clouds, depth-fused splats of the venue, wireframes, or "scan" aesthetics anywhere in the main experience. The **real footage is always the hero image.** 3D is used invisibly (camera solve, depth, occlusion, guide placement) or as **photoreal station splats** built from Bobby's photos.
3. **Floating, off-center frames and a slideshow feel.** Banned: thumbnails hanging in space, misaligned overlays, discrete jumps. Motion must be continuous and frame-accurate.
4. **Confusing UI.** One obvious way to move, one obvious way to interact, guided by the character. A first-time user should understand it in 3 seconds without reading.

**Reality constraint:** the footage is a **straight, forward-facing walkthrough** (phone, portrait, ultra-wide). There is no 360 coverage and you can't see behind or to the sides. Don't promise free-roam over the video. Design around a **cinematic rail** with limited look-around (2.5D parallax). Make the stations and the guide the deep, interactive layers.

---

## 2. INPUTS: INVENTORY FIRST

Write `data/manifest.json` with every file, its type, dimensions/duration and a one-line description. Map breakdown screenshots ↔ station folders by label using vision plus fuzzy matching, and log any mismatches.

- **`input/videos/downstairs.mov`** (IMG_3817): about 117 s, 1080×1920 portrait after rotation, about 29.5 fps, HDR as above, AAC audio plus 5 Apple metadata tracks. **Contains all stations.** Known from a prior solve: the first **~95 s** track well. The last ~20 s are too dark to track, so treat them as an outro or trim them.
- **`input/videos/upstairs.mov`** (IMG_3864): about 130 s, same format, plus an extra **APAC spatial-audio** track. **No stations.** It starts on the staircase going up.
- **`input/breakdown/`**: screenshots taken from the downstairs video. Each shows a station circled or highlighted, with its **label**. They tell you **exactly where in the walk each station is.**
- **`input/stations/<label>/`**: per-station photos (some stations were **not fully captured in the video, only in these photos**) plus a **write-up card** (image or text) describing the station. That card is the source of truth for station content.
- **`input/mascot/hermes-guide.png`**: the Hermes guide. Manga/ink style, 1960s-retro. Black glossy bob with blunt bangs and flipped-out ends, white headband, large expressive eyes, white short-sleeve **double-breasted chef-style top with mandarin collar and two columns of black buttons**, white waistband, long **black-and-white vertically pleated A-line skirt**, black tights, black Mary Jane flats. **Stay on-model.** She's the Hermes mascot; credit Nous Research for the character in the credits.

**Watch the videos properly.** You can't "watch" video directly, so:
- Extract frames at 2 fps, look at every one, and write `data/beats_downstairs.json` / `data/beats_upstairs.json`: timestamp → what's visible (spaces, screens, crowds, lighting, landmarks, turns).
- Transcribe the audio (Whisper or similar) for ambience, announcements and speech.
- Derive chapters/sections with evocative names from what you see.

**Look at every image** in `breakdown/` and `stations/` with vision and write `data/stations.json`:
`{id, label, title, one_liner, body (from the card, verbatim where possible), highlights[], photos[], hero_photo, video_timestamp, visibility_window, screen_region_track, world_position, transition_assets, splat_asset, guide_lines[]}`.
**Never invent station facts.** Only use what's on the cards and photos. You may write the guide's playful lines, but they must be grounded in the card.

---

## 3. AUTONOMY, RESEARCH AND TEAM

**Research is unlimited.** Use it whenever you're below about 80% confident in a workflow:
- Web search and fetch, GitHub (`gh search repos/code`, read READMEs, issues and examples), YouTube (`yt-dlp --skip-download --write-auto-subs` for transcripts of tutorials), docs sites, Hugging Face model cards.
- **X/Twitter:** pages often block automated fetch. Use web search with `site:x.com` queries. If `XAI_API_KEY` is set, use Grok's live X search. Respect blocks; don't use scraping workarounds. Log any X link you couldn't read.
- Keep `docs/RESEARCH.md`: question → sources → conclusion → what you'll do.

**Must-read references.** Open each, extract the technique, and note it in RESEARCH.md:
- **Bobby's station-splat reference (top priority):** https://x.com/bilawalsidhu/status/2061134940813611505. Reproduce its splat workflow for the station pods. If you can't read it, find the same workflow via search or Bilawal's YouTube, and note what you used.
- Semantic labels pinned into splats (VLM detections projected into 3D with Spark): https://x.com/bilawalsidhu/status/2055109842474316140
- SuperSplat Walk Mode (immersive splat UX benchmark): https://x.com/willeastcott/status/2036771869206995049
- World Labs Marble (photos/video → explorable world; also maintains Spark): https://x.com/theworldlabs/status/1988653084416074134
- three.js + Spark splat game with character controller, navmesh, light probes, shadows: https://x.com/isaac_mason_/status/2100050524842475874
- Apple SHARP (single photo → splat in about 1 s): https://x.com/svrc/status/2001591705254904089 · web app: https://x.com/revelium_studio/status/2009570090568577045
- Splat FPS in browser with physics and NPCs (PlayCanvas): https://x.com/yak32/status/2047326252344742035
- TrajectoryCrafter (re-render a monocular video's camera path): https://x.com/yshan2u/status/1899097247788519821
- Streamable 4DGS (Gracia): https://x.com/gracia_hq/status/2032554546086424635
- Hermes Agent's official **Meshy** plugin (3D models from text or photos): https://x.com/AGTPinsights/status/2113158231036239974
- Hermes3D (Hermes agents as 3D characters): https://x.com/iamlukethedev/status/2090403072837362117
- Also search X and YouTube for: "scroll-driven video website", "video game companion guide UX", "character composited into video three.js", "Apple product page scroll video technique", "awwwards immersive venue tour".

**Team.** Create Claude Code subagents in `.claude/agents/` and run them in parallel wherever work is independent:
`researcher` · `media-engineer` (tone-map, stabilize, encode, depth, masks, tracking) · `station-engineer` (station matching, tracking, splats, AI transitions) · `character-artist` (mascot 3D, rig, animations, shader) · `experience-dev` (front-end) · `writer` (guide lines, UI copy, launch copy) · `art-director` (independent critic: scores every screen and clip against the rubric, and is never the one who built it) · `qa-mobile` · `qa-desktop`.

**Budgets.** Track every paid call in `docs/SPEND.md`. Never exceed `VIDEO_BUDGET_USD` / `TOTAL_BUDGET_USD`. If you'd exceed one, use the free fallbacks below.

---

## 4. BUILD PHASES (EACH ENDS IN A GATE)

### Phase 1: Media foundation
1. Tone-map HDR→SDR correctly (§1). Make a color-check sheet `qa/color/` comparing original vs output frames. **Gate:** the art-director signs off on color.
2. Stabilize gently. Use Gyroflow if usable motion metadata exists in the Apple tracks (research it), otherwise ffmpeg `vidstab` two-pass with a light crop. Keep it natural. No warping.
3. Encode for **frame-accurate scrubbing**. Evaluate (a) H.264 with short GOP (keyint 6–12) plus `requestVideoFrameCallback`, (b) WebCodecs `VideoDecoder` with a decoded-frame ring buffer, (c) chaptered files. Benchmark smoothness on iPhone-class Safari and Android Chrome, pick the best and document why. Target 720×1280 at the right bitrate, with a 1080×1920 tier for desktop. Split into chapter files so first load is fast.
4. Per-frame **depth** (temporally consistent: Video Depth Anything or Depth Anything 3 on video), **people masks** (SAM 2 video propagation), and a **camera solve**. COLMAP/pycolmap or GLOMAP at 6–10 fps, then interpolate to 30 fps with splines. Known from v1: downstairs solves cleanly (about 287/351 frames at 3 fps). Upstairs is dark and fragments, so apply CLAHE to the solve copies only, use relaxed registration thresholds, and stitch segments using shared frames. Ship depth as a small grayscale video for the runtime.
5. Original audio: keep venue ambience. Clean it, normalize it, and make it loopable per chapter. Use the upstairs spatial audio if it helps.

### Phase 2: Stations (downstairs only)
1. **Locate.** For each breakdown screenshot, find the matching video frame. Mask the drawn annotation, then use perceptual hash plus feature matching at full frame rate. Read the circled region and the label.
2. **Track.** Propagate the station region forward and back through the video (SAM 2 or CoTracker) to get, per frame, a clean **polygon/mask and a visibility score**. Define the **visibility window**: the station is "live" (glowing, clickable) only while it's meaningfully in frame.
3. **Locate in 3D.** Triangulate each station's world position from the tracked region plus camera poses. The guide needs this to walk to it and point at it.
4. **Station splat pods (Bucket 2).** Follow Bobby's referenced workflow. Default chain: multiple photos → Marble multi-image world or a trained splat (LichtFeld/Postshot/Brush if a GPU exists). Single photo → Apple SHARP (or Marble single-image). Clean it in SuperSplat, compress to `.spz`/`.sog`, and render with Spark. The pod must look photoreal from its **hero viewpoint** and allow a gentle orbit (±25°) without breaking. If a splat isn't good enough, use a 2.5D depth-parallax photo for that station and log it. Never ship a broken splat.
5. **AI camera transitions (OpenRouter).** OpenRouter has async video generation:
   - Discover: `GET https://openrouter.ai/api/v1/videos/models` and pick models whose `supported_frame_images` include **both `first_frame` and `last_frame`** and that support **9:16**. Expected candidates to compare: Google Veo 3.1 / Veo 3.1 Lite, ByteDance Seedance 2.0, Alibaba Wan 2.7, xAI Grok Imagine Video.
   - Submit: `POST https://openrouter.ai/api/v1/videos` with `frame_images: [{type:"image_url", image_url:{url}, frame_type:"first_frame"}, {..., frame_type:"last_frame"}]`, then poll `polling_url` and download from `unsigned_urls`. Frame images may need **public HTTPS URLs**, so host them temporarily (Railway static, R2, or a signed URL). Research the `openrouter-video` skill: https://github.com/OpenRouterTeam/skills/tree/main/skills/openrouter-video
   - **First frame** = the exact paused walk frame at the moment of click (pre-render from the station's best "click" timestamp, plus 1–2 alternates across the visibility window). **Last frame** = the station hero photo, reframed to 9:16. Outpaint with an image model if needed, matching the venue's lighting.
   - **Prompt template** (have an LLM refine it per station from the beats and photos): *"Smooth, stabilized gimbal camera move through a real event venue. The camera glides forward and arcs gently toward [station description], ending framed exactly on it. Photoreal, true to the original lighting: [magenta / violet / white] LED wash, white walls, polished floor. Preserve every on-screen display and its text exactly. People stay natural and unchanged, no morphing. No new objects, no text overlays, no cuts. Shallow depth-of-field pull onto the station at the end. Duration 4–6 s."*
   - Generate **2–3 candidates per station across at least 2 models.** The art-director scores them (vision judge) on: first-frame fidelity, last-frame fidelity, temporal coherence, display/text integrity, people artifacts, lighting continuity and "cool factor." Keep the best. Re-roll once if the top score is below 8/10, then fall back.
   - **Fallback (free, always available):** 2.5D depth dolly-push into the station region with parallax, focus pull, a Hermes-pink light sweep, then a match-cut to the hero photo or pod.
   - Label AI-generated transitions honestly in the credits ("AI-assisted camera transitions").
6. **Station content panel.** Card from the write-up: title, one-liner, body, highlights, photo strip, "Ask Hermes about this" button, share link `#station-<id>`, back.

### Phase 3: The Hermes guide (3D, video-game companion)
1. **Turnaround sheet.** Using an image-output model on OpenRouter (filter `output_modalities=image`), generate front, ¾, side and back views **strictly on-model** to the reference, plus a neutral A-pose. The art-director rejects anything off-model (hair silhouette, headband, button columns, pleat pattern, Mary Janes).
2. **Image→3D.** Try Meshy (API or the Hermes Meshy plugin), Tripo, Hunyuan3D or Rodin, and pick the best. Retopologize or decimate to mobile budget: **glTF/GLB ≤ 3 MB** (meshopt/Draco, KTX2), ≤ 25k tris.
3. **Rig and animate.** Auto-rig (Meshy, or Mixamo-compatible via research). Required clips: idle (with 2–3 fidgets), walk, jog, run, turn-in-place, look-back-over-shoulder, beckon "follow me", point (left/right/forward), wave, excited hop, "ta-da" present, talk gestures (2–3), sit/lean idle, climb stairs. Blend with an `AnimationMixer` state machine and crossfades. Use **root motion with foot-locking: no sliding or floating.**
4. **Look.** Cel/toon shading with crisp **ink outlines** (inverted-hull or post outline) to match the manga drawing, plus a soft rim light tinted from the live footage color around her, and a contact shadow. She should read as an illustrated character stepped into a real place. Intentional, like a game companion, not a bad composite.
5. **Placement in the footage (the key trick).** Use the camera solve. Put her on the floor **at the position the camera will reach ~2.5–4 s ahead on the path**, so she naturally walks the real route and never through walls. Scale to correct height (she's about 1.6 m). Occlusion: when a person or pillar is closer than her (depth + SAM masks), mask her behind it. If the solve jitters anywhere, switch that segment to ground-plane homography anchoring and smooth it.
6. **Behavior (state machine).**
   - User moves forward: she walks or jogs ahead, glances back, beckons.
   - User stops: she turns, idles, fidgets. After about 6 s she suggests the next thing.
   - User scrolls backward: she spins around and jogs back.
   - Station enters frame: she breaks off toward it, points, and a speech bubble pops (station teaser).
   - Station opened: she hops into the transition and "presents" the card with a ta-da.
   - Chapter change: one-liner about the space.
   - Stairs: she bounds up the stairs ahead of you into upstairs.
   - Upstairs (no stations): she comments on spaces, light, views and vibe, and points out cool details from the beats.
7. **Her voice.** The `writer` agent writes a **guide script** (`data/guide_lines.json`): 1–2 lines per chapter, 2–3 per station (teaser, open, close), and idle quips. Tone: clever, warm, slightly mischievous, crypto/AI-native but accessible. ≤ 90 characters per bubble. Never invents facts. Comic-style speech bubbles that follow her head, typewriter reveal, skippable. Optional TTS (ElevenLabs if a key exists, otherwise skip) with a mute toggle and captions always on.

### Phase 4: The experience
**Stack:** Vite + TypeScript, three.js (character, overlays, depth-parallax shader), Spark (`@sparkjsdev/spark`) for station pods, GSAP + Lenis (or native) for scroll feel, and WebCodecs or the chosen scrub method. A small Node server (Railway) for the "Ask Hermes" proxy. Never expose keys client-side.

**Core loop (Bucket 1: footage as-is):**
- **Move:** scroll / swipe up / trackpad / W-S / arrow keys walks you forward and back along the rail. Momentum-smoothed and frame-accurate. On mobile, a subtle "hold to walk" pill as an alternative.
- **Look:** drag (or the phone gyroscope, with a tap to enable) for a **limited 2.5D look-around** (about ±10–12°) using the depth map. This adds parallax so it feels like being there. Never shows holes; clamp or inpaint edges.
- **Stations:** when in frame, the tracked region gets a **live, perfectly locked glow** (outline + bloom in Hermes pink, pulsing softly) plus a small label tag that sticks to it. Tap it and the transition plays, then the pod and card appear. Back plays the transition in reverse to the exact same frame.
- **Chapters:** thin progress rail with chapter ticks and station dots. Tapping one glides there.
- **Floors:** Downstairs → (stairs moment with the guide) → Upstairs. A floor switch is also in the menu.
- **Intro:** 3–4 s title sequence. Hermes waves: "You missed it? I'll walk you through." Then a one-gesture tutorial with an animated hint, not text walls.
- **Outro:** end card with share, "Get the Hermes beta app" (link only to official Nous pages you can verify), and credits.
- **Sound:** venue ambience (ducked), soft UI sounds, the guide's voice (optional). Muted by default on mobile until the first tap.
- **Ask Hermes (Hermes app tie-in):** a chat drawer where users ask about stations. A server proxy to a **Nous Hermes model on OpenRouter** (check `/api/v1/models`; fall back to any strong model), grounded **only** in `stations.json` + beats. Answers appear in her speech bubble. Deep links: `#floor-down`, `#floor-up`, `#chapter-<id>`, `#station-<id>`, so a Hermes agent can send someone straight to a station. Write a Hermes skill `skills/venue-guide/` that maps natural requests ("take me to the robot demo") to these links.
- **Design language:** dark, premium, minimal chrome. Typography and a palette pulled from the venue's magenta/violet and the mascot's black-and-white ink. Glass panels used sparingly. Everything respects safe areas and `prefers-reduced-motion` (fades instead of camera moves).

**Performance budgets:** first interactive ≤ 3 s on 4G mid-range phones. 60 fps on iPhone 13+ and recent Pixel; never below 45. Total initial download ≤ 15 MB, with the rest streamed per chapter and station. Mascot GLB ≤ 3 MB. Each station pod ≤ 8 MB, loaded on approach.

---

## 5. THE THREE BUCKETS AS VARIATIONS

Build one codebase with routes, so Bobby can A/B and pick:

| Route | Variation | What it is | Role |
|---|---|---|---|
| `/` | **V1 "Cinematic Rail"** (Bucket 1 + 2) | Footage-first scroll walk + 2.5D look + 3D guide + glowing stations → AI transition → splat pod | **Ship default.** Must be flawless. |
| `/map` | **V3 "Hybrid Map"** (Bucket 3) | Clean illustrated floor plan drawn from the camera path (vector, not points), with chapter and station pins and a mini Hermes walking the map. Tap a pin to fly into the footage at that exact moment. Ideal for "just show me the stations." | Second entry point, also the "Map" button inside V1 |
| `/stations` | **V2 "Station Gallery"** (Bucket 2 standalone) | Swipeable carousel of station pods (splats) with cards. Hermes introduces each | Shareable per-station pages |
| `/lab` | **V4 "World Mode"** (experimental) | Marble video→world (or trained splat) per chapter for limited free-roam around the rail, with the guide. Labeled "AI-reconstructed" | **Only ship if it passes the art-director gate (no LiDAR look).** Otherwise hide it and log why |

Also ship **three guide personality presets** (toggle in settings, default first): *Hype Host* (energetic, playful) · *Curator* (calm, insightful) · *Hacker Cool* (dry wit, terminal-flavored bubbles).

---

## 6. QA: AGENTS USE IT LIKE REAL PEOPLE

Headless SwiftShader is far too slow and misleading for splats and video. **Test with real GPU rendering:** headed Chrome or Playwright `channel: "chrome"` on a GPU machine, plus WebKit for Safari behavior, plus mobile emulation (iPhone 15 / Pixel 8 viewports, touch, DPR 3). Use BrowserStack or a real-device cloud if credentials exist.

Automated checks (Playwright, scripted):
- Full downstairs and upstairs walk, forward and backward, at three scroll speeds. Record video of each run in `qa/runs/`.
- Every station: glows **only** while in frame (check visibility windows ±2 frames), the glow stays locked to the object (overlay IoU ≥ 0.85 against the tracked mask), the click target works, the transition plays, the pod loads, the card text matches the write-up, and back returns to the exact frame.
- Guide: never slides (foot velocity vs root motion), never clips through people or pillars incorrectly, never blocks a station glow or the card, bubbles are on-screen and legible. Run a state-machine coverage report.
- Color: a sampled-frame ΔE check against the reference stills.
- Perf: FPS trace, long tasks, memory over a 5-min session, network waterfall vs budgets.
- Deep links, share links, reduced-motion mode, keyboard-only, captions, mute.

Human-style review:
- `qa-mobile` and `qa-desktop` act as **first-time visitors** with no instructions. They must find every station and the upstairs. They log any moment of confusion with timestamped screenshots.
- `art-director` scores every chapter, transition and pod from 1–10 on *realism · polish · clarity · delight · on-model guide*. **Ship gate: no score below 9.** Fix and re-test in a loop until it passes. Keep `qa/REPORT.md`.
- Produce a 60-second screen-captured walkthrough (portrait and landscape). Watch it frame-by-frame for glitches.

---

## 7. LAUNCH KIT
- Deploy to Railway (or Cloudflare Pages + R2 for media if that's faster) behind a clean URL. GitHub repo with README.
- OG/Twitter card image, plus a 20–30 s promo video (portrait and landscape) captured from the real experience, **not mocked**.
- Three X post drafts tagging @NousResearch, each with the promo video and a deep link to the best station.
- Hermes skill `venue-guide` + a short note on how a Hermes agent would use the deep links.
- `docs/HANDOFF.md`: what was built, live URL, routes, decisions, spend, known limitations, and how to add a station or re-run the pipeline on new footage.

---

## 8. HARD RULES
- Real footage is the hero. Nothing discolored, nothing that looks like a scan.
- Never invent station facts. Only the write-up cards and photos.
- Never expose API keys client-side. Respect spend caps.
- Label AI-generated transitions and any AI-reconstructed views in the credits.
- Credit Nous Research for the Hermes character. Link only to official Nous pages you've verified exist.
- If someone visible in the footage might reasonably object (close-up faces), add an easy blur toggle per segment in the pipeline config.
- Don't stop until every gate passes. If something is impossible, ship the best fallback, document it, and move on.

## 9. DEFINITION OF DONE
- [ ] Color matches the original (signed off), smooth frame-accurate scroll walk on both floors
- [ ] Every station from `breakdown/` is located, tracked, glowing only when visible, and opens with a transition (AI or fallback) into a pod + card
- [ ] Stations captured only in photos still appear at the right spot in the walk and transition in convincingly
- [ ] 3D Hermes guide on-model, toon/ink-shaded, foot-locked, occluded correctly, leading and commenting everywhere
- [ ] `/`, `/map`, `/stations` shipped; `/lab` shipped or documented as cut
- [ ] All QA gates pass with art-director scores ≥ 9; perf budgets met
- [ ] Live URL, repo, promo videos, X drafts, Hermes skill and HANDOFF.md delivered
