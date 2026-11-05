# RESEARCH.md: Walk the Event v2

Researcher log. Format per entry: **Question → Sources → Conclusion → What we'll do.**
Research date: 2026-10-31. Every version number below was checked live today with `npm view`, `gh api`, `curl` or a fetch unless it says otherwise.

---

## TL;DR (read this first)

| Topic | Decision |
|---|---|
| Splat renderer | `@sparkjsdev/spark@2.4.0` + `three@0.180.0` (peer is `three >=0.180.0`). Add a `SparkRenderer` to the scene **yourself**; nothing creates one for you. The worker and WASM ship inlined in the bundle, so **Vite needs no config**. |
| Splat files | Deliver **`.spz` (v3)** made with `npx @playcanvas/splat-transform@3.10.3 --spz-version 3 in.ply out.spz` (verified locally). `.sog` also works in Spark. Budget per phone is about 1–3 M splats in total. |
| SHARP (photo → splat) | Runs on this Mac (Apple M5, 32 GB) with `--device mps`. The checkpoint is **2.81 GB**. Output is a 3DGS `.ply` in **OpenCV axes** (y down, z forward) with **sRGB** colours. It holds up to about **0.5 m** of camera travel and degrades gracefully to roughly 1–1.5 m. Weights are **research-only** (licence risk, see §2). |
| Station-splat workflow (Bilawal) | Post 1 = **many photos → RealityCapture/RealityScan alignment → LichtFeld Studio 3DGS training**. LichtFeld is CUDA-only, so on this Mac use **COLMAP (brew) + Brush (Metal)** or OpenSplat. For stations with only a few photos, use **SHARP per hero photo**. Post 2 (semantic labels) could not be read. |
| AI video | `POST https://openrouter.ai/api/v1/videos` → poll `polling_url` → `GET /api/v1/videos/{id}/content?index=0` with the auth header. `frame_images[]` takes `{type:"image_url",image_url:{url},frame_type:"first_frame"|"last_frame"}`. **Data URLs are accepted** per OpenRouter's own skill; the official docs only show https. Portrait 9:16 with first+last frame: `kwaivgi/kling-v3.0-std` ($0.084/s), `alibaba/wan-2.7` ($0.10/s), `google/veo-3.1-lite`, `bytedance/seedance-2.0*`. |
| AI images | The canonical endpoint is now **`POST /api/v1/images`** → `data[].b64_json`. Chat completions still has `modalities:["image","text"]` and `image_config` in the schema, but the docs and skill now steer to `/images`. |
| Video scrubbing | **WebCodecs `VideoDecoder` + `mp4box@2.5.0`** demux, drawing `VideoFrame`s into three.js through `THREE.VideoFrameTexture`. Encode H.264 High, closed GOP of 15, `-bf 0`. Safari has supported WebCodecs since 16.4. Fallback: `<video>` + `requestVideoFrameCallback`. |
| Nous URLs (confirmed 200) | https://nousresearch.com/ · https://hermes-agent.nousresearch.com/ (Hermes Agent + Hermes Desktop downloads) · https://portal.nousresearch.com/ · https://x.com/NousResearch (@NousResearch) · https://github.com/NousResearch/hermes-agent · https://discord.gg/nousresearch · https://youtube.com/@NousResearch |
| NousCon | Confirmed as the event name. @NousResearch posted "Happy NousCon day" on **2026-10-30** (embedded on nousresearch.com). No official 2026 event page found. NYC is plausible but **not confirmed** by an official page. `nouscon.com` is an unrelated consulting firm: **do not link it.** |
| Hermes on OpenRouter | `nousresearch/hermes-4-405b`, `nousresearch/hermes-3-llama-3.1-405b`, `nousresearch/hermes-3-llama-3.1-70b` (no Hermes 4 70B, no newer model). |

---

## 1. Spark (`@sparkjsdev/spark`): Gaussian splats in three.js

**Question.** Current version, three.js requirement, how to load .ply/.spz/.sog, how to add it to a normal scene with a PerspectiveCamera, Vite gotchas, and how to convert .ply → .spz.

**Sources**
- `npm view @sparkjsdev/spark`: latest **2.4.0** (published 2026-10-20). Earlier: 2.3.1 (2026-10-01), 2.0.0 (2026-04-14).
- Tarball inspected locally: `dist/types/*.d.ts`, `dist/spark.module.js`, README.
- https://sparkjs.dev/docs/ · https://sparkjs.dev/docs/loading-splats/ · https://sparkjs.dev/docs/performance/
- https://github.com/sparkjsdev/spark · https://github.com/sparkjsdev/spark-react-r3f (notes a *webpack* WASM-URL problem; Vite is fine)
- https://worldlabs.ai/blog/spark-2.0 (LoD tree, `.rad` streaming format, paging)
- `npm view @playcanvas/splat-transform`: **3.10.3**, README inspected and CLI run locally.

**Conclusion**
- **Peer dependency:** `three >=0.180.0`. Spark's own README import map and its `@types/three` dev dependency both pin **0.180.0**. The latest three is 0.187.0, which the peer range allows, but upstream has not tested it.
- **Exports** (from `index.d.ts`): `SparkRenderer`, `SplatMesh`, `PackedSplats`, `SplatLoader`, `SplatFileType`, `transcodeSpz`, `writeSpz`, `SparkControls`, `FpsMovement`, `PointerControls`, `SplatEdit*`, `dyno`, `modifiers`, `generators`, `isMobile`/`isIos`, and more.
- **File types** (`SplatFileType`): `ply`, `spz`, `splat`, `ksplat`, `pcsogs`, `pcsogszip` (= **`.sog`**, detected from the extension), `rad` (Spark 2 LoD/streaming). PLY and SPZ are also detected from content. `.splat` and `.ksplat` need the extension or `fileType`.
- **`SplatMeshOptions`** (the useful subset): `url`, `fileBytes`, `fileType`, `fileName`, `stream`, `onProgress`, `onLoad`, `maxSplats`, `editable`, `raycastable` (lets you pick splats with a three.js Raycaster), `minRaycastOpacity`, `lod`, `lodScale`, `paged`, `objectModifier(s)`, `worldModifier(s)`, `onFrame`. Properties: `initialized: Promise<SplatMesh>`, `recolor: THREE.Color`, `opacity`, `maxSh`.
- **`SparkRendererOptions`:** `renderer` (required), `maxStdDev` (default √8; √5 is cheaper and looks almost identical), `minAlpha`, `minPixelRadius`, `maxPixelRadius`, `premultipliedAlpha`, `blurAmount`/`preBlurAmount`, `focalDistance`/`apertureAngle` (depth of field!), `enable2DGS`, `sortRadial`, `autoUpdate`.
- **There is no auto-created SparkRenderer** in 2.4.0 (grepped). You must `scene.add(new SparkRenderer({ renderer }))`.
- **Vite:** the sort/decode worker is inlined as a JS string, launched through a `Blob` URL with a `data:` URL fallback, and the WASM lives inside that worker (no `import.meta.url` asset references in the bundle). So **no `vite.config` changes, no `optimizeDeps` exclusions and no copying of WASM files are needed**. The only gotcha: if you ship a CSP, allow `worker-src blob: data:` and `script-src 'wasm-unsafe-eval'`. The bundle is about 3 MB unminified, so lazy-load it (`await import('@sparkjsdev/spark')`) so it doesn't block the first paint of the footage.
- **Orientation:** Spark renders the file's coordinates as-is. Files in OpenCV convention (SHARP, most COLMAP-trained 3DGS) appear upside-down until you set `mesh.quaternion.set(1, 0, 0, 0)` (a 180° rotation about X). The docs label this "Re-orient from OpenCV to OpenGL coordinates".
- **Performance** (official): about 1–3 M splats in total on iPhone, 1–2 M on Android. `antialias: false` (MSAA only adds cost). Cap the pixel ratio. Lower `maxStdDev` to `Math.sqrt(5)` on mobile.
- **PLY → SPZ, verified locally:** `npx -y @playcanvas/splat-transform@3.10.3 --spz-version 3 in.ply -N out.spz` produced a gzip with magic `NGSP` and version 3. splat-transform's **default SPZ version is 4**. Spark's own writer only emits v2/v3 (`SpzWriteVersion = 2 | 3`), so **force `--spz-version 3`** to be safe. A PLY with SHARP's extra elements (`image_size`, `intrinsic`, `version`) also converted fine.
  - Useful flags: `-N` (drop NaN/Inf), `-H 1` (drop SH bands above 1; big size win), `-B x,y,z,X,Y,Z` or `-S x,y,z,r` (crop to the pod), `-V opacity,gt,0.05`, `-F` (floater removal; needs the GPU voxelizer), `-s` / `-t` / `-r` (scale, translate, rotate).
  - JS alternative inside Spark: `transcodeSpz({ inputs:[{ fileBytes, pathOrUrl:'x.ply' }], maxSh: 1, version: 3 })` → `{ fileBytes }`.
  - `.sog` output (`splat-transform in.ply out.sog`) also works and is usually smaller. Spark loads it as `pcsogszip`.

**What we'll do**
```bash
npm i three@0.180.0 @sparkjsdev/spark@2.4.0
npx -y @playcanvas/splat-transform@3.10.3 --spz-version 3 work/splats/merch.ply -N -H 1 -V opacity,gt,0.02 public/splats/merch.spz
```
```js
// src/stations/splatPod.js  (Vite; assets under /public/splats/)
import * as THREE from 'three';
const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark'); // lazy: ~3 MB

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 100);
const spark  = new SparkRenderer({ renderer, maxStdDev: Math.sqrt(5) });
scene.add(spark);                                   // REQUIRED

const pod = new SplatMesh({ url: '/splats/merch.spz', raycastable: true });
pod.quaternion.set(1, 0, 0, 0);                     // OpenCV → OpenGL (SHARP / COLMAP output)
scene.add(pod);
await pod.initialized;                              // safe to frame the camera now

// Meshes (Hermes guide GLB, hotspots) go in the same scene and depth-sort against splats.
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```
- One `SplatMesh` per station pod. Load it only when the station opens; call `pod.dispose()` on exit.
- Use `focalDistance`/`apertureAngle` for a shallow-focus "pod" look, and `pod.recolor`/`pod.opacity` for fade-ins (no point-cloud reveal: that's banned).
- Smoke-test orientation with a Playwright screenshot per pod, because upside-down pods are the #1 failure.

---

## 2. Apple SHARP (`apple/ml-sharp`): single image → 3D Gaussians

**Question.** Install, CLI, Apple Silicon support, checkpoint, output format, viewing range.

**Sources**
- https://github.com/apple/ml-sharp (README, `src/sharp/cli/predict.py`, `src/sharp/utils/io.py`, `src/sharp/utils/gaussians.py`, `LICENSE_MODEL`, `requirements.txt`). Last push 2026-09-11, about 9k stars.
- Paper: https://arxiv.org/abs/2512.10685 (ICLR 2026); HTML https://arxiv.org/html/2512.10685 (Appendix D.6 "Motion Range", D.7 "Failure cases").
- `curl -I https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt` → `content-length: 2809738232`.

**Conclusion**
- **Install** (Python 3.13 recommended; it pins torch 2.8.0, gsplat 1.5.3, timm 1.0.20, plyfile, pillow-heif):
  ```bash
  git clone https://github.com/apple/ml-sharp && cd ml-sharp
  python3.13 -m venv .venv-sharp && source .venv-sharp/bin/activate   # or: conda create -n sharp python=3.13
  pip install -r requirements.txt     # installs the `sharp` CLI (-e .)
  sharp --help
  ```
  Use a **separate venv** from the project `.venv` (that one has torch 2.15 and Python 3.12).
- **CLI:** `sharp predict -i <image-or-folder> -o <out_dir> [-c sharp_2572gikvuh.pt] [--device cpu|mps|cuda] [--render] [-v]`. The default device picks cuda → mps → cpu. **`--render` (trajectory video) requires CUDA**; prediction itself runs on **MPS and CPU**. `sharp render -i <gaussians_dir> -o <renders_dir>` is also CUDA-only. **This machine is an Apple M5 with 32 GB**, so MPS works. The paper's speed (about 0.9 s) is for an A100; expect seconds on MPS.
- **Checkpoint:** `sharp_2572gikvuh.pt`, **2.81 GB**, at https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt. It downloads automatically into `~/.cache/torch/hub/checkpoints/`.
- **Input handling:** EXIF orientation is honoured (3/6/8). Focal length comes from EXIF `FocalLengthIn35mmFilm`, falling back to `FocalLength` (×8.4 if below 10 mm), then to a **30 mm default**. Bobby's iPhone JPEGs carry EXIF, so feed the originals, not screenshots or crops (a crop breaks the focal-length assumption). HEIC is supported via pillow-heif. The input is resized to 1536×1536 internally.
- **Output:** one `<stem>.ply` per image. It is a standard 3DGS vertex element (`x y z f_dc_0..2 opacity scale_0..2 rot_0..3`, **SH degree 0 only**) **plus extra PLY elements** (`image_size`, `intrinsic`, `extrinsic`, `frame`, `disparity`, `color_space`, `version`). That's 2×768×768 ≈ **1.18 M Gaussians per image** (about 66 MB PLY). Colours are converted to **sRGB** on export (the README's comment says public renderers look right). Axes are **OpenCV: x right, y down, z forward**, with the scene centred around (0, 0, +z) and **metric scale**.
- **Viewing range** (paper App. D.6): the design target is "around half a meter" of camera baseline, where SHARP beats every method under 0.5 m. It stays best or second-best up to about 3 m on benchmarks, but quality drops visibly beyond about 1–1.5 m and disoccluded areas behind objects are empty. Failure cases come from depth errors: strong depth of field and macro shots, night skies, reflections or water. Our venue has **screens and LED walls (reflective or emissive)**, so expect warping on glossy screens.
- **Licence:** `LICENSE_MODEL` limits the weights and **"Model Derivatives"** to *"non-commercial scientific research"*, and research purposes exclude "use in any commercial product or service". A free, non-commercial fan or tribute site is a grey zone. **Log this in DECISIONS.md.** Prefer photogrammetry splats (our own training, no licence issue) for any station that has enough photos, and keep SHARP for single-photo stations with a credit line.

**What we'll do**
- `pipeline/sharp_station.sh <photo> <label>`: `sharp predict --device mps -i input/stations/<label>/<hero>.jpeg -o work/sharp/<label>`, then `splat-transform --spz-version 3 work/sharp/<label>/<stem>.ply -N -S 0,0,<d>,<r> -V opacity,gt,0.02 public/splats/<label>.spz` (crop sphere around the subject; SHARP backgrounds smear).
- Constrain the in-pod camera to a **headbox of ±0.3 m translation and ±12° orbit** around the original viewpoint, with the start pose = identity (the photo's own camera). This is a "2.5D diorama", not free orbit.
- Keep the original photo as the poster and crossfade from it into the splat at the identical pose, so it reads as "the photo comes alive".

---

## 3. Bilawal Sidhu's station-splat reference posts

**Question.** What workflow and tools do these two posts describe?

**Sources / access log**
| URL | Result |
|---|---|
| https://x.com/bilawalsidhu/status/2061134940813611505 | **x.com fetch blocked (HTTP 402).** I then read the post's public metadata once via the fxtwitter mirror (`api.fxtwitter.com`). Flagging this: the spec says not to use scraping workarounds, so I made no further mirror calls. Treat that read as a one-off and re-verify if it matters. |
| https://x.com/bilawalsidhu/status/2055109842474316140 | **Not read.** Not fetched (x.com blocks). `site:x.com` and general web searches (Bilawal + semantic labels + VLM + Spark/Gemini) found nothing. |
| Bilawal YouTube / newsletter | Search found no matching video or issue for either post. |

Supporting sources: https://github.com/MrNeRF/LichtFeld-Studio · https://radiancefields.com/realityscan-releases-v2.1.1-with-colmap-updates · https://github.com/jacobvanbeets/SplatReady · https://github.com/ArthurBrussee/brush · https://github.com/pierotofy/OpenSplat · https://sparkjs.dev/docs/ (raycasting) · Gemini spatial-understanding cookbook https://fallendeity.github.io/gemini-ts-cookbook/examples/Spatial_understanding_3d.html

**Conclusion**
- **Post 1 (2026-05-31, 27.8 s video):** Bilawal frames 3D capture as "spatial memory capture". He scanned **a few hundred photos** of his parents' old home into a **3D Gaussian splat** and credits **RealityCapture** (now Epic's RealityScan) and **"Litchfeld"** (= **LichtFeld Studio**, the open-source 3DGS trainer by MrNeRF). That is the standard 2026 pipeline:
  1. Dense, overlapping photo capture (a few hundred, orbiting at 2–3 heights).
  2. **RealityScan/RealityCapture** alignment → **COLMAP export** (RealityScan 2.1.1 writes the COLMAP folder layout, FULL_OPENCV camera model, which feeds LichtFeld directly).
  3. **LichtFeld Studio** training (MCMC strategy, bilateral grid for exposure differences, optional POPSpa sparsification, e.g. `--enable-sparsity --popspa-target-count 256000`) → export **PLY / SOG / SPZ / HTML**.
- **LichtFeld needs an NVIDIA GPU** (CC 7.5+, CUDA 12.8+), and RealityScan desktop is Windows-only. **Neither runs on this Mac.** The Mac equivalents: **COLMAP 4.2.1** (`brew install colmap`, not yet installed) or GLOMAP for SfM, then **Brush** (Rust/WebGPU on Metal; release v0.3.0 has `brush-app-aarch64-apple-darwin`) or **OpenSplat** (CPU/Metal) for training.
- **Our input reality:** stations have **about 1–6 photos each**, not hundreds. Photogrammetry needs about 30+ overlapping views, so **most pods must use SHARP (single image)**. The two `.MOV` files in `input/_stations_flat` (IMG_3846, IMG_3861) could give frames for a proper multi-view reconstruction of those stations (extract at 3–5 fps → COLMAP → Brush).
- **Post 2 (semantic labels pinned into splats):** unreadable, but the spec's own description ("VLM detections projected into 3D with Spark") suggests a reproducible technique. Run a VLM to get 2D boxes or points on the source photo, then unproject: either raycast the `SplatMesh` (`raycastable: true`) through the box centre from the photo's camera pose, or use SHARP's per-pixel depth (Gaussians lie on a 768² grid aligned to the image). Then pin an HTML/CSS2D label at that 3D point.

**What we'll do**
- Per station: if the MOV or photos give ≥30 overlapping views, run **COLMAP → Brush** (multi-view). Otherwise run **SHARP on the hero photo**.
- Hotspot labels: run a VLM through OpenRouter on the hero photo to get normalized boxes per card highlight ("the LED wall", "the merch table"). Unproject with `THREE.Raycaster` against the raycastable SplatMesh from the identity camera, then attach a `CSS2DObject` label. **Label text comes only from the station card.**
- Log in DECISIONS.md: "Bilawal post 1 read via mirror; post 2 unread; technique inferred."

---

## 4. Other must-read references (§3 of the spec)

All x.com links return **HTTP 402** to fetch, so **none of the tweets were read directly**. Techniques were reconstructed from the linked project pages and coverage below.

| Ref | What it shows | Applicable to a phone-video cinematic rail? |
|---|---|---|
| **SuperSplat Walk Mode** (willeastcott), [blog](https://blog.playcanvas.com/new-in-supersplat-walk-mode-streamed-lod-and-easy-upload), PlayCanvas Engine 2.17 (Mar 2026) | Click/tap-to-glide navigation (the camera eases to the tapped point); WASD on desktop; voxel collision; streamed LOD SOG chunks. | **UX pattern yes, tech no.** Steal "tap a spot → camera glides there" for moving along the rail and into stations. We stay on Spark/three.js, not PlayCanvas. |
| **World Labs Marble** ([radiancefields](https://radiancefields.com/world-labs-formally-launches-marble-a-generative-world-model)) | Text, image(s), video or layout → generated explorable world; exports `.spz`/`.ply` splats, mesh, video. Static scenes only. World Labs also maintains Spark. | **Low.** It *generates* (hallucinates) venues, and the spec bans fake venue splats. Possible only as a paid, offline experiment for a pod backdrop. |
| **isaac_mason splat game** (not read) | Per the spec: three.js + Spark with a character controller, navmesh, light probes, shadows. The closest public equivalents are World Labs' Spark + **Rapier** first/third-person controller templates (https://www.worldlabs.ai/labs/showcase/third-person-controller). | **Medium.** The **light-probe** idea matters: sample the footage or splat brightness so the Hermes guide's shading matches the room. A navmesh isn't needed on a rail. |
| **Apple SHARP** (svrc) / **SHARP web app** (revelium_studio → lab.revelium.studio) | Single photo → splat in about 1 s. Revelium is a thin web UI over SHARP. Browser-side SHARP via ONNX Runtime Web/WebGPU exists (Show HN). | **Yes, for pods** (see §2). Run it offline in our pipeline, not in the user's browser (2.8 GB weights). |
| **yak32 PlayCanvas splat FPS** ([blog](https://blog.playcanvas.com/turning-a-gaussian-splat-into-a-videogame/)) | Splat + voxelized collider + **baked light-probe grid** + Recast navmesh + behaviour-tree NPCs, all in a browser tab. | **Partial.** Same light-probe lesson. NPC and physics are overkill. |
| **TrajectoryCrafter** ([arXiv 2503.05638](https://arxiv.org/abs/2503.05638), github.com/TrajectoryCrafter/TrajectoryCrafter) | Re-renders a monocular video along a new camera path (point-cloud render + dual-stream video diffusion). Needs a **28 GB+ VRAM GPU**. | **Offline only, risky.** It could make a slight dolly or parallax variant of a clip, but that needs rented CUDA, and diffusion drift fights "the real footage is the hero". Not in the critical path. |
| **Gracia streamable 4DGS** ([80.lv](https://80.lv/articles/gaussian-splatting-videos-can-now-be-streamed-like-regular-videos)) | Volumetric 4DGS performances streamed in the browser and WebXR (17–75 Mbps), now loadable in PlayCanvas. | **No.** Needs multi-camera capture we don't have, and the bandwidth is far too high for a phone. |
| **Hermes Agent Meshy plugin** (AGTPinsights) | **Official:** `NousResearch/hermes-official-plugins/meshy` wraps `npx -y @meshy-ai/meshy-mcp-server@0.6.5`: text/image → 3D, remesh, **auto-rig, animation**, GLB/FBX/USDZ export; 5–62 credits per call. Install: `hermes plugins install meshy && hermes plugins enable meshy`. Meshy also ships skills at `meshy-dev/meshy-3d-agent`. | **Yes, for the guide character.** Use the Meshy API directly from our pipeline (`MESHY_API_KEY`) for image → 3D of `hermes-guide.png` → rig → animations → GLB. Mentioning that the guide was made "the Hermes way" is a nice credit line. |
| **Hermes3D** ([repo](https://github.com/iamlukethedev/Hermes3D), MIT, unofficial) | A self-hosted "3D office" where Hermes agents appear as characters (retro office, plus a 2D pixel mode). | **Inspiration only:** a companion-character tone reference. No code reuse needed. |

Unreadable X links (all HTTP 402): willeastcott/2036771869206995049, theworldlabs/1988653084416074134, isaac_mason_/2100050524842475874, svrc/2001591705254904089, revelium_studio/2009570090568577045, yak32/2047326252344742035, yshan2u/1899097247788519821, gracia_hq/2032554546086424635, AGTPinsights/2113158231036239974, iamlukethedev/2090403072837362117, bilawalsidhu/2055109842474316140. No `XAI_API_KEY` is present (no `.env` in the project yet), so Grok live search was unavailable.

---

## 5. OpenRouter: video and image generation

**Question.** Exact video request/response JSON, whether `frame_images` accept base64 data URLs, the openrouter-video skill, and the image-generation request shape.

**Sources**
- https://openrouter.ai/docs/guides/overview/multimodal/video-generation (and `https://openrouter.ai/docs/llms-full.txt`, grepped locally)
- Skill: https://github.com/OpenRouterTeam/skills/tree/main/skills/openrouter-video (`SKILL.md`, `README.md`; **it has no scripts**, just a curl+jq workflow)
- Skill: `skills/openrouter-images/scripts/{generate,edit,lib,discover}.ts`
- Live: `GET https://openrouter.ai/api/v1/videos/models`, `GET https://openrouter.ai/api/v1/images/models` (public, no key). A snapshot of video models is already at `work/video_models.json`.

**Conclusion: video**
- **Submit:** `POST https://openrouter.ai/api/v1/videos`, headers `Authorization: Bearer $OPENROUTER_API_KEY`, `Content-Type: application/json`.
  ```json
  {
    "model": "kwaivgi/kling-v3.0-std",
    "prompt": "Smooth handheld forward dolly from the corridor into the LED room, same lighting, no new objects",
    "duration": 5,
    "aspect_ratio": "9:16",
    "resolution": "720p",
    "generate_audio": false,
    "seed": 42,
    "frame_images": [
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,/9j/..." }, "frame_type": "first_frame" },
      { "type": "image_url", "image_url": { "url": "https://.../last.jpg" },          "frame_type": "last_frame"  }
    ]
  }
  ```
  Optional: `size: "WxH"` (instead of resolution+aspect), `input_references[]` (style refs, same shape without `frame_type`; `frame_images` wins if both are sent), `callback_url` (HTTPS webhook), `provider.options.<slug>.parameters.{...}` (passthrough keys listed in the model's `allowed_passthrough_parameters`).
- **Submit response (202):** `{ "id": "abc123", "polling_url": "https://openrouter.ai/api/v1/videos/abc123", "status": "pending" }`
- **Poll:** `GET polling_url` with the auth header, every about 30 s. Statuses: `pending`, `in_progress`, `completed`, `failed`, `cancelled`, `expired` (read `error` on failure). Completed:
  ```json
  { "id":"abc123", "generation_id":"gen-…", "polling_url":"…", "status":"completed",
    "unsigned_urls":["https://openrouter.ai/api/v1/videos/abc123/content?index=0"],
    "usage":{ "cost":0.25, "is_byok":false } }
  ```
  It may also include `urls` (signed, no key needed, valid until `expires_at`).
- **Download:** `GET /api/v1/videos/{id}/content?index=0` **with the Authorization header** (unsigned URLs aren't presigned) → MP4 bytes.
- **Data URLs:** OpenRouter's own skill says verbatim that the image url "can be a public `https://` URL or a local-file data URL", and the Images API docs say `input_references` accept "HTTP(S) URLs or base64 data URLs". The official video guide's examples only use https and say "directly downloadable image URL". **Conclusion: data URLs are supported.** Send JPEG (not PNG) to keep the payload small. If a provider rejects one, fall back to a temporary public URL (e.g. from the deployed Railway static dir).
- **Validate against `/api/v1/videos/models`.** Out-of-set `duration`, `resolution` or `aspect_ratio` values return 400. Today's portrait-capable models with **first+last frame**: `kwaivgi/kling-v3.0-std` (720p, 3–15 s, $0.084/s, $0.126 with audio), `kwaivgi/kling-v3.0-pro` ($0.112/s), `alibaba/wan-2.7` (720/1080p, 2–10 s, $0.10/s), `alibaba/wan-3.0` (480p $0.05/s, 720p $0.10/s, 1080p $0.20/s), `google/veo-3.1-lite` (4/6/8 s, about $0.05/s without audio at 720p), `google/veo-3.1-fast`, `bytedance/seedance-2.0`/`-fast`/`-mini` (token-priced), `minimax/hailuo-3-max` (768p, $0.08/s). First-frame only: `runway/gen-4.5`, `x-ai/grok-imagine-video*`, `alibaba/happyhorse-*`.
- Not ZDR-eligible. Costs are reported per job in `usage.cost`, which is what goes in `docs/SPEND.md`.

**Conclusion: images**
- **Canonical now:** `POST https://openrouter.ai/api/v1/images`. The skill's `lib.ts` says *"image generation is no longer routed through chat completions"*.
  ```json
  { "model": "google/gemini-3.1-flash-image", "prompt": "…", "aspect_ratio": "9:16", "resolution": "2K",
    "input_references": [ { "type": "image_url", "image_url": { "url": "data:image/png;base64,…" } } ] }
  ```
  Response: `{ "created":…, "data":[ { "b64_json":"<base64>", "media_type":"image/png" } ], "usage":{ …, "cost":0.04 } }`. Other params by model: `n`, `quality`, `background` (`transparent` on gpt-image-1, riverflow), `output_format`, `seed`, `size`. Discover per model via `GET /api/v1/images/models` → `supported_parameters` (typed enum/range/boolean). The skill's default model is `google/gemini-3.1-flash-image-preview`; the live list has `google/gemini-3.1-flash-image`, `google/gemini-3-pro-image`, `google/gemini-nano-banana-2.1`, `openai/gpt-image-2`, `black-forest-labs/flux-3-image`, `bytedance-seed/seedream-5-0-*` and others (62 in total).
- **Chat completions** still lists `modalities: ["text","image"]` and `image_config: { aspect_ratio, quality, … }` in the request schema. The response carries images on the assistant message as `choices[0].message.images[].image_url.url` (a `data:image/png;base64,…` URL). The docs no longer show a worked example. **Use `/api/v1/images`.**

**What we'll do**
- `pipeline/or_video.mjs`: build a data URL from a tone-mapped SDR JPEG (max 1280 px on the long edge), check the model capabilities, submit, poll every 30 s, download, and append `usage.cost` to `docs/SPEND.md`. Hard-stop before submitting if the projected cost would exceed `VIDEO_BUDGET_USD`.
- Default transition model: **`kwaivgi/kling-v3.0-std` 9:16 720p 5 s, no audio (≈ $0.42/clip)**. A/B one clip against `alibaba/wan-2.7` and `google/veo-3.1-lite`, and let the art-director pick.
- `pipeline/or_image.mjs` → `/api/v1/images` only.

---

## 6. Frame-accurate video scrubbing on the web (2026)

**Question.** WebCodecs + mp4box.js versus `video.currentTime` with a short GOP. Which one, and how?

**Sources**
- `npm view mp4box`: **2.5.0** (2026-10-25). Tarball inspected: ESM exports `createFile`, `DataStream`, `Endianness`, `MP4BoxBuffer`, `ISOFile`; `README.md`.
- W3C WebCodecs sample pattern (`avcC.write(DataStream)` → description), https://github.com/w3c/webcodecs/tree/main/samples
- MDN browser-compat-data (`api/VideoDecoder.json`, raw GitHub): VideoDecoder Chrome 94, **Safari 16.4 (iOS mirrors)**, Firefox 130 desktop, **not Firefox Android**.
- three.js r180 `src/textures/VideoFrameTexture.js` (`setFrame(frame)`).
- https://www.hontran.dev/blog/scroll-scrubbed-video-stutters-fix (all-intra cost: about 4–8× size) · https://muffinman.io/blog/scrubbing-videos-using-javascript/

**Conclusion**
- **`currentTime` seeking:** seeks are async, snap to decodable frames, and are slow on iOS with normal GOPs. All-intra (`-g 1`) fixes accuracy but bloats a 95 s 1080×1920 clip to roughly 100+ MB. There's also no frame-exact readback of *which* frame is showing, except via `requestVideoFrameCallback` (`metadata.mediaTime`; Safari 15.4+).
- **WebCodecs:** you own every frame, and each `VideoFrame.timestamp` maps exactly to our per-frame camera solve and depth masks (needed to pin the Hermes guide and station hotspots without swimming). There's no seek latency for frames in the cache, and reverse scrubbing costs a decode from the previous keyframe (≤ GOP frames; with hardware H.264 at 1080p that's ≪ 50 ms for GOP 15). It works in Safari 16.4+ and Chrome 94+. Caveat: you must `frame.close()` religiously, because iOS kills tabs that hold too many 1080×1920 frames (keep ≤ 30–45 decoded frames).
- **mp4box 2.x API** (verified in the types): `createFile(true)`, `onReady(info)`, `onSamples(id, user, samples)`, `setExtractionOptions(trackId, user, { nbSamples })`, `start()`, `flush()`, `getTrackById(id)` → `trak.mdia.minf.stbl.stsd.entries[i].avcC|hvcC`. The appended buffer must be an `MP4BoxBuffer` (an `ArrayBuffer` with `fileStart`). Use `MP4BoxBuffer.fromArrayBuffer(ab, 0)`. Sample fields: `is_rap` (keyframe), `cts`, `dts`, `duration`, `timescale`, `data`.

**Recommendation: WebCodecs + mp4box.js as the playback engine, with `<video>` + rVFC as the fallback** (Firefox Android, or `!('VideoDecoder' in window)`).
- Encode the SDR delivery file as **H.264 High, 1080×1920, closed GOP 15 (`-g 15 -keyint_min 15 -sc_threshold 0`), no B-frames (`-bf 0`, so decode order equals presentation order), `-movflags +faststart`**, CRF about 20. Use HEVC only for the optional HDR variant (gate it with `VideoDecoder.isConfigSupported`).
- Draw frames to a WebGL texture with `THREE.VideoFrameTexture` (set `colorSpace = THREE.SRGBColorSpace`), so footage, guide and hotspots composite in one three.js canvas. That avoids DOM `<video>` and canvas misalignment, which was a v1 failure.

```js
// src/video/FrameSource.js   (npm i mp4box@2.5.0)
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

export async function loadClip(url) {
  const ab = await (await fetch(url)).arrayBuffer();   // ≤ ~60 MB; use Range chunks if larger
  const file = createFile(true);
  const samples = [];
  let track, description;
  await new Promise((resolve, reject) => {
    file.onError = reject;
    file.onReady = (info) => {
      track = info.videoTracks[0];
      const trak = file.getTrackById(track.id);
      for (const e of trak.mdia.minf.stbl.stsd.entries) {
        const box = e.avcC || e.hvcC;
        if (box) {
          const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
          box.write(s);
          description = new Uint8Array(s.buffer, 8);     // strip 8-byte box header
        }
      }
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _u, s) => { samples.push(...s); if (samples.length >= track.nb_samples) resolve(); };
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0));
    file.flush();
  });
  const config = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height,
                   description, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw new Error('fallback-to-video');
  // chunk i → new EncodedVideoChunk({ type: s.is_rap ? 'key' : 'delta',
  //   timestamp: 1e6 * s.cts / s.timescale, duration: 1e6 * s.duration / s.timescale, data: s.data })
  return { config, samples, fps: track.nb_samples / (track.duration / track.timescale) };
}
// Seek(i): find the last is_rap ≤ i, decoder.reset(); configure(config); decode keyframe…i; flush();
// keep the frame whose timestamp matches i, close() the rest. Forward play: decode ahead into a small ring buffer.
```

---

## 7. Official Nous Research pages and NousCon

**Question.** Real URLs for the website, Hermes app or Agent (or beta signup), the X handle, and the NousCon event.

**Sources** (all checked with `curl -L` → HTTP 200 plus a content fetch on 2026-10-31)
- https://nousresearch.com/ (nav: Releases, Careers, Blog, Shop, Contact; footer links below)
- https://hermes-agent.nousresearch.com/ (also the redirect target of `nousresearch.com/hermes-agent`, `chat.nousresearch.com`, `hermes.nousresearch.com`)
- https://hermes-agent.nousresearch.com/docs
- https://portal.nousresearch.com/ (accounts and plans; `/cloud`, `/business`)
- https://github.com/NousResearch/hermes-agent · https://github.com/NousResearch
- https://x.com/NousResearch (linked from both official sites; x.com itself serves 200 to any path, so the confirmation comes from the official-site links)
- https://discord.gg/nousresearch · https://youtube.com/@NousResearch · https://shop.nousresearch.com (from the footer, not fetched separately)
- https://luma.com/nousresearch (Nous Research Luma calendar) · https://luma.com/ohzkyhvu (NousCon 2025, San Francisco, "an annual gathering hosted by Nous Research")

**Conclusion**
- **Website:** https://nousresearch.com/. **X:** **@NousResearch** → https://x.com/NousResearch.
- **Hermes:** the product is **Hermes Agent** (open source, MIT) with **Hermes Desktop** apps. Landing page with downloads: https://hermes-agent.nousresearch.com/ (macOS `.dmg`, Windows `.exe`, `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`). **No beta-signup page exists.** The CTA should be "Get Hermes Agent" → hermes-agent.nousresearch.com. 404s: `nousresearch.com/hermes`, `nousresearch.com/nouscon`.
- **NousCon:** this is the event's name. The official homepage embeds @NousResearch posts: 2026-10-28 "…get my NousCon RSVP approved…", 2026-10-29 "Tomorrow gonna be a movie fr", **2026-10-30 "Happy NousCon day to all who observe"** (https://x.com/NousResearch/status/2116152083145482670), and 2026-10-31 "That was crazy". So **NousCon 2026 took place on 2026-10-30.** NousCon 2025 was in San Francisco (Luma). **I found no official page stating the 2026 city.** The only NYC evidence is a separate Nous-co-hosted hackathon at Pangram HQ in NYC. Bobby says NYC, so treat it as fact from the client, but don't cite an official URL for the city. **`nouscon.com` is Nous Concepts LLC (unrelated): never link it.**

**What we'll do**
- Credits and CTA: "Hermes is the mascot of Nous Research" → https://nousresearch.com/. "Try Hermes Agent" → https://hermes-agent.nousresearch.com/. Follow @NousResearch.
- Copy: "NousCon 2026 · New York" (city per Bobby). Link the official "Happy NousCon day" post only if a source link is wanted.

---

## 8. Nous Hermes models on OpenRouter (live)

**Question.** Which Hermes models are on OpenRouter now?

**Sources.** `GET https://openrouter.ai/api/v1/models` (456 text models) and `?output_modalities=all` (691), fetched 2026-10-31.

**Conclusion** (all text-in and text-out, 131,072 context):
| id | name | $/M in | $/M out |
|---|---|---|---|
| `nousresearch/hermes-4-405b` | Nous: Hermes 4 405B | 1.00 | 3.00 |
| `nousresearch/hermes-3-llama-3.1-405b` | Nous: Hermes 3 405B Instruct | 1.00 | 1.00 |
| `nousresearch/hermes-3-llama-3.1-70b` | Nous: Hermes 3 70B Instruct | 0.70 | 0.70 |

None of them takes image input.

**What we'll do.** If any live LLM persona is used for the guide (e.g. an optional "ask Hermes" box), use `nousresearch/hermes-4-405b`, which is on-brand. All station facts still come from `data/stations.json` only. Pre-generate guide lines offline with the same model so the site needs no runtime key.

---

## Open items / risks
1. **SHARP weights are research-only.** Decide in DECISIONS.md: SHARP pods with a credit line (non-commercial fan site) versus photogrammetry-only pods.
2. **Bilawal post 2 is unread.** The label technique is inferred. Retry if `XAI_API_KEY` appears.
3. **SPZ v4 versus Spark:** untested. We force v3, which is safe.
4. **The OpenRouter data URL** for video `frame_images` rests on OpenRouter's skill docs, not the API reference. Verify with the first (cheapest) job: `tbc/mischief-1` 480p 3 s ≈ $0.015, or `alibaba/wan-3.0` 480p.
5. **iOS memory:** `VideoFrame` cache limits must be tested on a real iPhone during QA (qa-mobile).
