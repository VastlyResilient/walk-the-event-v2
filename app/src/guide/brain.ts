import * as THREE from 'three';
import type { Floor, PresetLines, Station } from '../core/data';
import { asset, pick } from '../core/data';
import type { WalkView } from '../walk/view';
import type { AnimInput, Gesture } from './anim';
import { guideUniforms } from './materials';
import type { SceneSense } from '../walk/sense';

/** What the brain needs from a guide: works for the procedural toon rig and the Meshy rig. */
export interface BrainRig { root: THREE.Group; headCenter: THREE.Object3D; pool: THREE.Mesh }
/** Bisect switches for QA (round 9): ?off=walker,walkin,back,glow40,vel,wait,curve in the page URL. */
const OFF = new Set(((typeof location !== 'undefined' && new URLSearchParams(location.search).get('off')) || '').split(','));
export interface BrainAnimator { update(inp: AnimInput): void }

export interface BrainContext {
  dt: number;
  frame: number;
  userFps: number; // signed frames per second the visitor is travelling
  idle: number; // seconds since last input
  live: Station[]; // stations currently live
  stationRects: { id: string; x0: number; y0: number; x1: number; y1: number }[];
  open: Station | null;
  inTransition: boolean;
  gliding?: boolean;
  cur?: number; // the scroll position itself (smooth), vs frame = the decoded frame on screen (can burst)
  aim?: number; // where the scroll is heading (swipe target / fling coast), frames: lets her set off before the camera does
  jog?: boolean; // (owner) a hard press on the walk pad: she may jog (light jog, up to V_JOG_MAX)
  beat?: number; // music beat clock (integer = on the beat): her dance-walk steps on it
}

/**
 * Hand-placed no-go spots (world x, z, radius m) where the footage sense can't help: the black leather cube
 * cluster by the merch wall reads as floor in monocular depth, and the curved balcony's curb sits right on the
 * walked line. Same idea as nav-mesh blockers in a game level.
 */
const BLOCKERS: Record<string, [number, number, number][]> = {
  // cube bench (z -10.8..-7.2, measured from where she was seen standing on it) and the balcony curb
  downstairs: [[-19.6, -10.45, 0.62], [-19.6, -9.75, 0.62], [-19.6, -9.05, 0.62], [-19.6, -8.35, 0.62], [-19.6, -7.65, 0.62], [-2.3, -24.5, 0.4]],
  upstairs: [],
};

/**
 * (owner: "upstairs near the end she walks through a wall") stretches where the camera solve under-moves: through the
 * corridor from the plant room to the balcony the solved camera creeps at ~0.6 m/s (conf 0.5, interpolated) while the
 * phone walks on, then catches up with a 7.7 m jump at 3500-3510. A guide placed in that world slides against the
 * footage, into the corridor's left wall and out of the picture. There she is carried with the camera, as on unsolved
 * frames: she keeps her place in the picture, walking ahead with the visitor.
 */
const SOLVE_SLIDE: Record<string, [number, number][]> = {
  upstairs: [[3345, 3522]],
};

type State = 'intro' | 'follow' | 'idle' | 'tease' | 'present' | 'hidden' | 'race';

export class GuideBrain {
  state: State = 'intro';
  gesture: Gesture = 'none';
  private gestureUntil = 0;
  private hopReq = false;
  private t = 0;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  private prevYaw = 0;
  /** her turning speed (rad/s): facing is second order, so the turn rate itself never steps */
  private yawV = 0;
  private S: Float32Array = new Float32Array(0);
  private floorY: Float32Array = new Float32Array(0);
  private placed = false;
  private teased = new Set<string>();
  teaseStation: Station | null = null;
  private teaseUntil = 0;
  private lastChapter = '';
  private lastDetail = -1;
  private nextFidget = 8;
  private suggested = false;
  private lastLookBack = 0;
  private side = 1;
  opacity = 0;
  private saidDark = false;
  inDark = false;
  talking = false;
  mood: 'neutral' | 'happy' | 'surprised' = 'neutral';
  lines!: PresetLines;
  say: (text: string, hold?: number) => void = () => {};
  /** a line is on screen (quips wait for it) */
  busy: () => boolean = () => false;
  // (owner) light-hearted remarks when people are in her way or the visitor dawdles: never at anyone's expense
  private quipAt = -99;
  private quipLast = new Map<string, number>();
  private quipN = 0;
  private yieldT = 0;
  private crowdT = 0;
  private slowT = 0;
  private wasJog = false;
  private floor!: Floor;
  private tmp = new THREE.Vector3();
  /** Footage sense (depth / people / colour around her); null until the first readback. */
  sense: SceneSense | null = null;
  private stanceSign = 0;
  private urgent = false; // the visitor is about to walk into her: move now
  private raceDone = false;
  // the walked path, smoothed (+-12 frames): her lane runs along it (lateral offsets are along its right vector)
  private smX = new Float32Array(0);
  private smZ = new Float32Array(0);
  private sVs = -1; // smoothed visitor path distance (the shown frame can jump during fast flings)
  private vVs = 0; // smoothed visitor speed (m/s, signed)
  private lastSRaw = -1;
  private lead = 3; // how far ahead of the visitor her spot is (m along the path), eased
  /** Optional measured nav map (pipeline/nav_study.py): corrected floor heights, preferred lateral offsets, rails. */
  nav: { step: number; samples: { f: number; s: number; floor_y: number; lane: [number, number]; prefer: number; stairs?: boolean }[]; rails?: { a: number[]; b: number[]; side: string; frames: number[]; holdable: boolean; height: number; lat: number }[]; blockers?: { x: number; z: number; r: number }[]; spots?: { x: number; y: number; z: number; from_s: number; to_s: number }[] } | null = null;
  private blk: [number, number, number][] = [];
  /** Hand-on-rail target while she walks past a holdable rail (world), and which hand. */
  railAt: THREE.Vector3 | null = null;
  railSide: 'Left' | 'Right' = 'Right';
  private spd = 0; // forward speed (m/s): she walks where she faces, like a person
  private stepM = 0.03; // metres per footage frame (average), to match the visitor's pace
  /** 0..1 party energy (upstairs disco floor): bouncier walk, dancing when she stops. */
  energy = 0;
  private raceAnchor = 0; // path distance (m) she races to in the flickering corridor
  private raceEndS = 0;
  private waitSince = -1;
  private saidWait = false;
  private dancedIn = '';
  /** Which placement branch moved her this frame (diagnostics for qa/tools/guide_probe.py). */
  dbgSrc = '';

  constructor(public rig: BrainRig, public anim: BrainAnimator, public view: WalkView) {}

  setFloor(floor: Floor) {
    this.floor = floor;
    const cam = floor.cam;
    const n = cam.frames;
    this.S = new Float32Array(n);
    this.floorY = new Float32Array(n);
    // path distance along the SMOOTHED walked path (+-12 frames): summing the solve's frame-to-frame jitter would make
    // the visitor look several times faster than they walk on noisy stretches (and her pace with it)
    this.smX = new Float32Array(n); this.smZ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0, c2 = 0;
      for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(n - 1, i + k)); sx += cam.pos[j * 3]; sz += cam.pos[j * 3 + 2]; c2++; }
      this.smX[i] = sx / c2; this.smZ[i] = sz / c2;
    }
    for (let i = 0; i < n; i++) {
      if (i > 0) this.S[i] = this.S[i - 1] + Math.min(0.08, Math.hypot(this.smX[i] - this.smX[i - 1], this.smZ[i] - this.smZ[i - 1]));
      this.floorY[i] = cam.pos[i * 3 + 1] - cam.camera_height_m;
    }
    // smooth floor height (removes solve noise, keeps stairs)
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -20; k <= 20; k++) { const j = i + k; if (j >= 0 && j < n) { s += this.floorY[j]; c++; } }
      sm[i] = s / c;
    }
    this.floorY = sm;
    this.stepM = n > 1 ? this.S[n - 1] / (n - 1) : 0.03;
    // solve-seam bridges: frames where the solved camera jumps (> 0.2 m per footage frame; upstairs 3501-3518 moves
    // ~7 m in 0.6 s while the real phone barely moved). The world itself slides there, so she is carried with the camera.
    this.bridge = new Uint8Array(n);
    for (let i = 0; i + 1 < n; i++) {
      const d = Math.hypot(cam.pos[i * 3 + 3] - cam.pos[i * 3], cam.pos[i * 3 + 4] - cam.pos[i * 3 + 1], cam.pos[i * 3 + 5] - cam.pos[i * 3 + 2]);
      if (d > 0.2) this.bridge[i] = 1;
    }
    // (round 7) unsolved stretches (conf 0 for >= 20 frames): no world data, she is carried with the camera there too
    this.unsolved = new Uint8Array(n);
    const darkFrom = floor.id === 'downstairs' ? 2930 : n;
    for (let i = 0; i < n;) {
      if ((cam.conf[i] ?? 1) !== 0) { i++; continue; }
      let j = i;
      while (j + 1 < n && (cam.conf[j + 1] ?? 1) === 0) j++;
      // (not in the downstairs dark passage from 2930: the lantern companion walks camera-relative there already)
      if (j - i + 1 >= 20) for (let k = i; k <= j && k < darkFrom; k++) this.unsolved[k] = 1;
      i = j + 1;
    }
    if (!OFF.has('slide')) for (const [a, b] of SOLVE_SLIDE[floor.id] ?? []) for (let k = a; k <= Math.min(b, n - 1); k++) this.unsolved[k] = 1;
    this.lastF = -1;
    this.raceDone = false;
    this.nav = null;
    this.fitFn = null;
    this.blk = BLOCKERS[floor.id] ?? [];
    this.blkExtra = [];
    this.aS = -1; this.aCam = null; this.aFix = null; this.goalSet = false; this.sVs = -1; this.lastSRaw = -1;
    this.block = null;
    fetch(asset(`data/blocking_${floor.id}.json`))
      .then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!(j && this.floor === floor && j.P?.length)) return;
        // (stations are downstairs only: their visibility windows are downstairs frames)
        if (!OFF.has('retime')) j.P = GuideBrain.retime(j.P, j.step, floor.id === 'downstairs' ? this.stations.map((st) => st.visibility_window) : []);
        // (a solver jump's in-between spots run straight through furniture (by the merch wall, through the cube bench):
        // now that she walks them (retime) she stopped dead at the bench and slid out of the picture. Spots inside a
        // blocker (+0.3 m) are pushed out to clear it, so her route bends round it)
        for (const q of j.P as number[][]) for (const [bx, bz, br] of [...(BLOCKERS[floor.id] ?? []), ...((j.blockers ?? []) as { x: number; z: number; r: number }[]).map((b) => [b.x, b.z, b.r])]) {
          const dx = q[0] - bx, dz = q[2] - bz, d = Math.hypot(dx, dz), need = br + 0.3;
          if (d < need && d > 1e-6 && !OFF.has('blkpush')) { q[0] = bx + (dx / d) * need; q[2] = bz + (dz / d) * need; }
        }
        this.block = j;
        this.blkExtra = ((j.blockers ?? []) as { x: number; z: number; r: number }[]).map((b) => [b.x, b.z, b.r] as [number, number, number]);
        // (round 7) steps the solver could not check (flag 16: unsolved camera, or a solve facing away from all of the
        // walked floor) are carried like unsolved frames, outside the downstairs lantern passage
        const st = j.step as number;
        (j.P as number[][]).forEach((q, i) => {
          if (!(q[3] & 16)) return;
          for (let k = Math.max(0, i * st - 2); k <= Math.min(n - 1, i * st + 2) && k < darkFrom; k++) this.unsolved[k] = 1;
        });
      })
      .catch(() => {});
    fetch(asset(`data/nav_${floor.id}.json`))
      .then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!j || this.floor !== floor) return;
        // solve seams leave small floor steps off the stairs: smooth them (+-4 samples = +-20 frames), keep the treads
        const N = j.samples as { floor_y: number; stairs?: boolean }[], sm = N.map((x) => x.floor_y);
        for (let i = 0; i < N.length; i++) {
          if (N[i].stairs) continue;
          let s = 0, c2 = 0;
          for (let k = -4; k <= 4; k++) { const q = N[i + k]; if (q && !q.stairs) { s += q.floor_y; c2++; } }
          sm[i] = s / c2;
        }
        N.forEach((x, i) => { x.floor_y = sm[i]; });
        this.nav = j;
        const nb = j.blockers as { x: number; z: number; r: number }[] | undefined;
        if (nb?.length) this.blk = nb.map((b) => [b.x, b.z, b.r] as [number, number, number]);
        this.aS = -1; this.aCam = null; this.aFix = null; // re-choose her spot with the measured lanes
        // the sense reads depth with the floor-recalibrated fit of the nearest nav sample
        const smp = j.samples as { f: number; da?: number; db?: number; fit_gap?: number }[], step = (j.step as number) || 5;
        // [a, b, trusted]: trusted = 0 beyond the floor's last (or before its first) frame where the floor
        // recalibration converged, by more than 25 frames: the end of upstairs looking down into the atrium, where
        // there is no walked floor ahead to calibrate the depth on
        const goodF = smp.filter((q) => (q.fit_gap ?? 0) === 0).map((q) => q.f);
        const g0 = goodF.length ? goodF[0] : -1e9, g1 = goodF.length ? goodF[goodF.length - 1] : 1e9;
        this.fitFn = smp[0]?.da ? (fr: number) => { const q = smp[Math.max(0, Math.min(smp.length - 1, Math.round(fr / step)))]; return q && q.da ? [q.da, q.db ?? 0, fr > g1 + 25 || fr < g0 - 25 ? 0 : 1] : null; } : null;
      }).catch(() => {});
    this.placed = false;
    this.teased.clear();
    this.lastChapter = '';
    this.lastDetail = -1;
  }

  private frameAtDistance(d: number) {
    const S = this.S;
    let lo = 0, hi = S.length - 1;
    if (d >= S[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] < d) lo = m; else hi = m; }
    return hi;
  }

  /** Static obstacles: the measured nav map's blockers (benches, cubes, plinths, columns) when loaded. */
  private blockers(): [number, number, number][] {
    if (this.blkSrcA === this.blk && this.blkSrcB === this.blkExtra && this.blkEff) return this.blkEff;
    const raw = this.blkExtra.length ? this.blk.concat(this.blkExtra) : this.blk;
    if (OFF.has('blkpath') || !this.smX.length) return raw;
    // (round 2) the visitor walked between them, so the walked path is passable: a blocker's radius is cut back to
    // leave 0.3 m either side of the walked line (the merch wall's cube circles left a 4 cm gap where the camera had
    // walked through, and she stuck there while the visitor walked into her). Cached; recomputed when the lists change.
    const n = this.smX.length;
    this.blkPD = new Float32Array(raw.length);
    this.blkEff = raw.map(([bx, bz, br], k) => {
      let dm = 1e9;
      for (let i = 0; i < n; i += 2) { const dx = this.smX[i] - bx, dz = this.smZ[i] - bz, d = dx * dx + dz * dz; if (d < dm) dm = d; }
      this.blkPD[k] = Math.sqrt(dm);
      return [bx, bz, Math.max(0.1, Math.min(br, Math.sqrt(dm) - 0.3))] as [number, number, number];
    });
    this.blkSrcA = this.blk; this.blkSrcB = this.blkExtra;
    return this.blkEff;
  }
  private blkEff: [number, number, number][] | null = null;
  private blkPD = new Float32Array(0); // each blocker's distance to the walked path (blockers())
  private blkSrcA: unknown = null;
  private blkSrcB: unknown = null;
  /** (round 9) blockers carried by the blocking track (hand-measured: the NOUSCON velvet rope). */
  private blkExtra: [number, number, number][] = [];

  /** Nav sample (interpolated) at path distance s, if the measured map is loaded (looked up by footage frame). */
  private navAt(s: number) {
    const N = this.nav?.samples;
    if (!N || N.length < 2) return null;
    const fr = this.frameAtDistance(s);
    let lo = 0, hi = N.length - 1;
    if (fr <= N[0].f) return N[0];
    if (fr >= N[hi].f) return N[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (N[m].f < fr) lo = m; else hi = m; }
    const a = N[lo], b = N[hi], t = (fr - a.f) / Math.max(1e-6, b.f - a.f);
    return { floor_y: a.floor_y + (b.floor_y - a.floor_y) * t, prefer: a.prefer + (b.prefer - a.prefer) * t, lane: a.lane, stairs: a.stairs || b.stairs };
  }

  /** Point on the lane at path distance s with lateral offset lat (+ = right of the walking direction). */
  private lanePoint(s: number, lat: number, out: THREE.Vector3, tangent?: THREE.Vector2) {
    const n = this.S.length;
    const i = this.frameAtDistance(s), i0 = Math.max(0, i - 1);
    const t = this.S[i] > this.S[i0] ? Math.max(0, Math.min(1, (s - this.S[i0]) / (this.S[i] - this.S[i0]))) : 1;
    const x = this.smX[i0] + (this.smX[i] - this.smX[i0]) * t, z = this.smZ[i0] + (this.smZ[i] - this.smZ[i0]) * t;
    const a = Math.max(0, i - 6), b = Math.min(n - 1, i + 6);
    let tx = this.smX[b] - this.smX[a], tz = this.smZ[b] - this.smZ[a];
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    if (tangent) tangent.set(tx, tz);
    const nv = this.navAt(s);
    out.set(x - tz * lat, nv ? nv.floor_y : this.floorY[i], z + tx * lat); // right = (-tz, tx)
    return out;
  }

  /** Path distance of the walked-path point nearest to p (searching around the visitor). */
  private nearestS(p: THREE.Vector3, sV: number) {
    const a = this.frameAtDistance(Math.max(0, sV - 3)), b = this.frameAtDistance(sV + 12);
    let best = a, bd = 1e9;
    for (let i = a; i <= b; i += 2) { const d = (this.smX[i] - p.x) ** 2 + (this.smZ[i] - p.z) ** 2; if (d < bd) { bd = d; best = i; } }
    return this.S[best];
  }

  // ---------------------------------------------------------------- anchor (where she means to stand)
  // The anchor is a spot on the measured lane: path distance aS = visitor + lead, lateral offset aLat. It is kept while
  // it stays good (in frame, readable size, inside the free lane, standable, clear of people and glows) and re-chosen
  // from candidates along the path when it stops being good. Where the solved path ahead is out of the picture, a
  // camera-relative spot on floor the footage shows at the visitor's level (aCam) is used instead.
  private aS = -1;
  private aLat = 0.45;
  private aCam: { d: number; l: number; y: number; fb?: boolean } | null = null;
  // camera-relative fallback (aCam.fb): ~3 m ahead of the camera and to the side it is turning toward, on the eye-height
  // floor, clamped into the free lane, checked against the footage depth at the point; smoothed (fbPos)
  private fbPos = new THREE.Vector3();
  private fbInit = false;
  private sizeT = 0;
  private aFix: THREE.Vector3 | null = null; // a measured off-lane spot (nav `spots`)
  private panT = 0; // > 0: hurrying to stay ahead of a camera pan
  private vdS = new THREE.Vector3(); // her smoothed desired velocity

  /** A lane spot that will be in view once the coming pan settles (frame fr), nearest to her: the far side of it. */
  private farSideOfPan(sV: number, fr: number) {
    const Send = this.S[Math.min(this.S.length - 1, this.floor.end ?? this.S.length - 1)] - 0.15;
    const P = new THREE.Vector3();
    let best: { s: number; lat: number; cam: null; sc: number } | null = null;
    for (const L of [2.5, 3.5, 4.5, 5.5, 7, 9]) {
      const s = Math.min(Send, sV + L), [l0, l1] = this.laneAt(s);
      for (const lat of [this.prefLat(s), l0 + 0.28, l1 - 0.28, (l0 + l1) / 2]) {
        const cl = this.clampLat(s, lat);
        this.lanePoint(s, cl, P);
        if (!this.inFrameAt(P, fr, 0.12) || !this.standable(P, false)) continue;
        const sc = P.distanceTo(this.pos);
        if (!best || sc < best.sc) best = { s, lat: cl, cam: null, sc };
      }
    }
    return best;
  } // camera-relative spot (ahead d, right l, floor y)
  private aBadT = 0;
  private lastSearch = -1;
  private anchorJumped = false;
  private goalVel = new THREE.Vector3();
  private goalPrev = new THREE.Vector3();
  private goalSet = false;
  private stepping = false;
  private offT = 0;
  private camBadT = 0;
  private passT = 0;
  private desperate = false;
  /** Diagnostics: why the last spotQuality call rejected its spot; candidate log while `dbgLog` is an array. */
  lastRej = '';
  dbgLog: unknown[] | null = null;
  private rej(why: string) { this.lastRej = why; return -1; }
  private verified = false;
  private ghost = false;
  private stillT = 0; // seconds the visitor has been standing still
  private stopT = 0; // (stop on a dime) seconds the scroll itself has been at rest with nothing in hand
  private holdFix = false; // the latched stop spot was moved to fix it (she walks there; otherwise she just halts)
  private tmpW = new THREE.Vector3();
  private tmpVd = new THREE.Vector3();
  private tmpG = new THREE.Vector3();
  private tmpQ = new THREE.Vector3();
  /** Diagnostics (qa/tools/guide_probe.py): no good in-frame spot exists right now / unseen re-entries so far. */
  noSpot = false;
  snaps = 0;

  /** Nav sample pair around path distance s (by footage frame). */
  private navPair(s: number) {
    const N = this.nav?.samples;
    if (!N || N.length < 2) return null;
    const fr = this.frameAtDistance(s);
    if (fr <= N[0].f) return { a: N[0], b: N[0], t: 0 };
    const hiI = N.length - 1;
    if (fr >= N[hiI].f) return { a: N[hiI], b: N[hiI], t: 0 };
    let lo = 0, hi = hiI;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (N[m].f < fr) lo = m; else hi = m; }
    return { a: N[lo], b: N[hi], t: (fr - N[lo].f) / Math.max(1e-6, N[hi].f - N[lo].f) };
  }

  /** Free lane at s: the narrower of the two neighbouring samples (walls, rails, furniture, measured from footage). */
  private laneAt(s: number): [number, number] {
    const p = this.navPair(s);
    if (!p) return [-0.6, 0.6];
    return [Math.max(p.a.lane[0], p.b.lane[0]), Math.min(p.a.lane[1], p.b.lane[1])];
  }

  /** Keep a lateral offset inside the lane with body clearance (0.28 m to a wall / rail / furniture edge). */
  private clampLat(s: number, lat: number) {
    const [lo, hi] = this.laneAt(s), c = 0.28;
    if (hi - lo < 2 * c) return (lo + hi) / 2;
    return Math.max(lo + c, Math.min(hi - c, lat));
  }

  /** Lateral offset of p from the smoothed path at path distance s (+ = right of the walking direction). */
  private latOf(p: THREE.Vector3, s: number) {
    const n = this.S.length, i = this.frameAtDistance(s);
    const a = Math.max(0, i - 6), b = Math.min(n - 1, i + 6);
    let tx = this.smX[b] - this.smX[a], tz = this.smZ[b] - this.smZ[a];
    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    return (p.x - this.smX[i]) * -tz + (p.z - this.smZ[i]) * tx;
  }

  /** Preferred lateral offset at s: the measured open side, or 0.4 m in from a holdable rail alongside. */
  private prefLat(s: number) {
    const nv = this.navAt(s);
    let lat = nv ? nv.prefer : this.side * 0.45;
    if (!nv?.stairs) {
      for (const r of this.nav?.rails ?? []) {
        const rs = (r as unknown as { s?: [number, number] }).s;
        if (r.holdable && rs && s >= rs[0] - 0.3 && s <= rs[1] + 0.3) { lat = r.lat - Math.sign(r.lat) * 0.7; break; }
      }
    }
    return this.clampLat(s, lat * (1 - 0.65 * this.fastK));
  }
  private fastK = 0;
  private sAim = 0;
  private loNow = 0.2;
  private edgeT = 0;
  private centreK = 0;

  /**
   * How good is a spot to stand at right now? -1 = unusable: not fully in frame (feet to head plus her arms, with a
   * margin, left of the phone's progress rail), too small / too big on screen, on a station's glow, not standable
   * (blocker, rail, person) or blocked in the footage. Otherwise a cost (lower is better).
   */
  private spotQuality(p: THREE.Vector3, rects: BrainContext['stationRects'], lo: number, hi: number, relaxed = false, frac0 = 0.29, lenient = false) {
    const v = this.view;
    const feet = v.project(p), head = v.project(this.tmpQ.copy(p).setY(p.y + 1.62));
    if (!feet || !head) return this.rej('behind');
    const W = v.width, H = v.height, ox = v.offsetX;
    const hgt = feet.y - head.y, frac = hgt / H;
    if (frac < lo || frac > hi) return this.rej(frac < lo ? 'small' : 'big');
    // (she is drawn upright on screen: the render clamps her on-screen lean to ~3 deg, so her box stands on her feet
    // even where the camera is rolled / pitched hard and the world vertical projects slanted)
    const half = hgt * (this.energy > 0.5 ? 0.3 : 0.22) + 6 + hgt * 0.05;
    const x0 = feet.x - half, x1 = feet.x + half;
    // strict: keep room to the frame edges (she lags her spot a little while walking); phones: left of the progress rail
    const xl = relaxed ? 0.04 : 0.09, xr = v.contain ? (relaxed ? 0.96 : 0.91) : relaxed ? (this.verified ? 0.985 : 0.94) : 0.85;
    if (x0 < ox + W * xl || x1 > ox + W * xr || head.y < H * (relaxed ? 0.06 : 0.1) || feet.y > H * (relaxed ? 0.96 : 0.93)) return this.rej('frame');
    for (const r of rects) if (!(x1 < r.x0 || x0 > r.x1 || feet.y < r.y0 || head.y > r.y1)) return this.rej('glow');
    // (lenient, the last resort in a crowd: people and the footage check only cost, they don't forbid; the lane,
    // blockers and rails still do)
    if (this.desperate) { // last resort: in the lane and in frame is all that's asked (plus no fixed obstacle)
      for (const [bx, bz, br] of this.blockers()) if ((p.x - bx) ** 2 + (p.z - bz) ** 2 < (br + 0.2) ** 2) return this.rej('blocker');
      { const db = this.depthBad(p); if (db) return this.rej(db); } // (never on air / behind a wall, even as a last resort)
      return Math.abs(frac - frac0) * 3 + 4;
    }
    if (this.verified) return Math.abs(frac - frac0) * 3 + (this.standable(p) ? 0 : 5);
    if (!this.standable(p, !lenient)) return this.rej('standable');
    if (frac < (lenient ? 0.15 : 0)) return this.rej('small');
    if (this.occludedAt(p)) return this.rej('occluded'); // hidden behind a wall / column / person from here
    { const db = this.depthBad(p); if (db) return this.rej(db); }
    if (this.feetOnPerson(p)) return this.rej('person'); // her feet would be drawn on someone standing behind her
    if (!this.desperate && this.nearDrop(p)) return this.rej('drop'); // within ~0.6 m of an edge the footage shows a drop behind
    const blk = this.sense ? this.sense.blocked(p) : 0;
    if (blk > (lenient ? 0.6 : relaxed ? 0.6 : 0.45)) return this.rej('blocked');
    const cx = ((x0 + x1) / 2 - ox) / W - 0.47; // a little left of centre on phones (the progress rail is on the right); the left edge is penalised harder below (the camera moving forward carries off-centre spots outward)
    return Math.abs(frac - frac0) * 3 + blk * 1.5 + Math.max(0, Math.abs(cx) - 0.12) * 2.5 + Math.max(0, -cx - 0.2) * 2 + this.centreK * Math.abs(cx) * 1.0;
  }

  /**
   * Floor height at p measured from the footage depth (sense grid, floor-recalibrated fit): the point where the camera
   * ray through p's feet meets what the depth sees there. null when unknown, a person stands there, or the ray hits
   * something that isn't floor near p (a wall, or a drop: the hit lands far from p horizontally).
   */
  private floorFromDepth(p: THREE.Vector3, yGuess: number) {
    const se = this.sense;
    if (!se?.ready || !se.floor) { this.lastRej = 'nf-nosense'; return null; }
    const cam = se.floor.cam, f = se.frame, o = { u: 0, v: 0, z: 0 };
    const cx = cam.pos[f * 3], cy = cam.pos[f * 3 + 1], cz = cam.pos[f * 3 + 2];
    let y = yGuess;
    for (let it = 0; it < 2; it++) {
      const r = se.toImage(this.tmpQ.set(p.x, y, p.z), o);
      if (!r) { this.lastRej = 'nf-offimage'; return null; }
      const k = se.cell(r.u, r.v);
      if (k < 0 || se.mask[k] > 0.45) { this.lastRej = k < 0 ? 'nf-offimage' : 'nf-person'; return null; }
      const t = se.metric(se.depth[k]) / r.z; // scale along the camera ray to what the footage sees
      const hx = cx + (p.x - cx) * t, hy = cy + (y - cy) * t, hz = cz + (p.z - cz) * t;
      if (Math.hypot(hx - p.x, hz - p.z) > 0.7) { this.lastRej = t < 1 ? 'nf-wall' : 'nf-drop'; return null; }
      y = hy;
    }
    return y;
  }

  /**
   * Is there floor at the visitor's level all the way from the visitor to p (in the footage depth)? Guards camera-
   * relative spots against a drop between (the atrium beyond the glass balustrade, a stairwell) and against "floor"
   * that is really the far side of a void. Returns p's measured floor height, or null.
   */
  private camFloorOk(p: THREE.Vector3, visFloor: number) {
    const c = this.view.camera.position, dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
    let y: number | null = null;
    for (const t of [0.5, 0.75, 1]) {
      const dd = d * t;
      if (dd < 1.5 && t < 1) continue; // below the bottom of the picture
      const q = this.tmpV2.set(c.x + dx * t, visFloor, c.z + dz * t);
      const fy = this.floorFromDepth(q, visFloor);
      // (loose in height: in the tilted-solve stretches the true floor leans ~15 deg in world space; a drop or the far
      // side of a void fails the ray test above, the atrium is metres below)
      if (fy !== null && Math.abs(fy - visFloor) > 0.35 + 0.2 * dd) this.lastRej = 'nf-height';
      if (fy === null || Math.abs(fy - visFloor) > 0.35 + 0.2 * dd) { this.lastRej += '@' + t; return null; }
      y = fy;
    }
    return y;
  }
  private tmpV2 = new THREE.Vector3();

  private camFwd = new THREE.Vector2(0, -1);
  private camPoint(d: number, l: number, y: number, out: THREE.Vector3) {
    const c = this.view.camera.position, fx = this.camFwd.x, fz = this.camFwd.y;
    return out.set(c.x + fx * d - fz * l, y, c.z + fz * d + fx * l); // right = (-fz, fx)
  }

  /**
   * Would a guide at p be in frame from the camera of footage frame fr (the frame the scroll is heading to)? At swipe
   * and fling speeds the camera pans several times faster than in the footage; a spot that is still in view where
   * the visitor is going saves her a sideways dash she couldn't make.
   */
  private futCam = new THREE.PerspectiveCamera();
  private futFrame = -1;
  /** diagnostics: horizontal screen position (0..1, null behind) of a floor point as seen from footage frame fr */
  private screenXAt(p: THREE.Vector3, fr: number) {
    const cam = this.floor.cam, fc = this.futCam;
    this.futFrame = fr;
    fc.position.fromArray(cam.pos, fr * 3); fc.quaternion.fromArray(cam.quat, fr * 4); fc.updateMatrixWorld(true);
    const a = this.tmpQ.copy(p).applyMatrix4(fc.matrixWorldInverse);
    if (a.z > -0.3) return null;
    a.applyMatrix4(this.view.camera.projectionMatrix);
    return +(a.x * 0.5 + 0.5).toFixed(3);
  }
  private inFrameAt(p: THREE.Vector3, fr: number, side = 0.04) {
    const cam = this.floor.cam, fc = this.futCam, v = this.view;
    if (fr !== this.futFrame) {
      this.futFrame = fr;
      fc.position.fromArray(cam.pos, fr * 3);
      fc.quaternion.fromArray(cam.quat, fr * 4);
      fc.updateMatrixWorld(true);
    }
    const a = this.tmpQ.copy(p).applyMatrix4(fc.matrixWorldInverse);
    if (a.z > -0.3) return false;
    a.applyMatrix4(v.camera.projectionMatrix);
    const fx = (a.x * 0.5 + 0.5), fy = (-a.y * 0.5 + 0.5);
    const b = this.tmpQ.copy(p).setY(p.y + 1.62).applyMatrix4(fc.matrixWorldInverse).applyMatrix4(v.camera.projectionMatrix);
    const hy = (-b.y * 0.5 + 0.5), half = (fy - hy) * 0.22 * v.height / v.width;
    return fx - half > side && fx + half < Math.min(0.9, 1 - side) && hy > 0.06 && fy < 0.96;
  }

  /**
   * The camera-relative fallback point for (d ahead, l right): on the floor at the camera's height minus its eye height,
   * pulled into the free lane where it lies beside the walked path (wall / rail clearance), standable (rails, blockers)
   * and where the footage depth shows floor at that point. null when not valid.
   */
  private fbRaw(d: number, l: number, sV: number, out: THREE.Vector3) {
    const eyeY = this.view.camera.position.y - this.floor.cam.camera_height_m;
    this.camPoint(d, l, eyeY, out);
    const s = this.nearestS(out, sV);
    const lat = this.latOf(out, s), [l0, l1] = this.laneAt(s);
    // (beside the walked path: inside its free lane; far off it, the camera looks across open floor the lane doesn't cover)
    if (lat > l0 - 1.5 && lat < l1 + 1.5) {
      const cl = this.clampLat(s, lat);
      if (Math.abs(cl - lat) > 1e-3) { this.lanePoint(s, cl, out); out.y = eyeY; }
    }
    if (!this.standable(out, false)) { this.lastRej = 'fb-standable'; return null; }
    const fy = this.floorFromDepth(out, eyeY);
    if (fy === null && this.lastRej === 'nf-drop' && ((this.navPair(sV)?.a as { fit_gap?: number } | undefined)?.fit_gap ?? 0) > 0) return out; // (uncalibrated depth: see above)
    if (fy === null || Math.abs(fy - eyeY) > 0.5) { if (fy !== null) this.lastRej = 'fb-height'; return null; }
    return out;
  }

  /** Choose a camera-relative fallback: 2.6-3.4 m ahead, 0.6-1.0 m to the side the camera is turning toward. */
  private pickFallback(sV: number, rects: BrainContext['stationRects'], panF: number, frac0: number) {
    const fNow = Math.round(this.view.frame ?? 0), ps = this.panSign || this.side || 1;
    const P = new THREE.Vector3();
    let best: { d: number; l: number; sc: number; p: THREE.Vector3 } | null = null;
    for (const d of [3.0, 2.6, 3.4, 2.2]) for (const l of [0.8 * ps, 0.6 * ps, 1.0 * ps, 0.3 * ps, 0, -0.5 * ps]) {
      const r = this.fbRaw(d, l, sV, P);
      if (!r) { if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: fNow, kind: 'fb', d, l, why: this.lastRej }); continue; }
      const q = this.spotQuality(P, rects, 0.12, 0.48, true, frac0, true);
      const inPan = panF < 0 || this.inFrameAt(P, panF, 0.08);
      if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: fNow, kind: 'fb', d, l, q: +q.toFixed(2), why: q < 0 ? this.lastRej : inPan ? 'ok' : 'gone-after-pan' });
      if (q < 0 || !inPan) continue;
      const sc = q + this.turnCost(P) + Math.abs(d - 3) * 0.3 + Math.abs(Math.abs(l) - 0.8) * 0.5 + (Math.sign(l) !== ps ? 1 : 0) + P.distanceTo(this.pos) * 0.08;
      if (!best || sc < best.sc) best = { d, l, sc, p: P.clone() };
    }
    return best;
  }

  private useFallback(fb: { d: number; l: number; p: THREE.Vector3 }) {
    const same = this.aCam?.fb && Math.abs(this.aCam.d - fb.d) < 0.05 && Math.abs(this.aCam.l - fb.l) < 0.05;
    this.aCam = { d: fb.d, l: fb.l, y: fb.p.y, fb: true }; this.aFix = null; this.aS = -1;
    if (!same && (!this.fbInit || this.fbPos.distanceTo(fb.p) > 0.3)) this.anchorJumped = true;
    if (!this.fbInit) { this.fbPos.copy(fb.p); this.fbInit = true; }
    this.camBadT = 0; this.noSpot = false;
  }
  private panSign = 0;
  /**
   * Blocking track (pipeline/blocking.py, docs/NAV.md): her floor position solved offline per footage frame (every
   * `step` frames), globally against the same footage the visitor sees: on walkable floor, in frame, readable size,
   * clear of people, walls, rails and station glows, and walkable at the pace cap. Her target is P(current frame).
   */
  private block: { step: number; end: number; P: [number, number, number, number][] } | null = null;
  /**
   * (owner: "she should not be stopping then walking as I scroll up") The solved track stands still in places for
   * 0.5-1.2 s while the camera walks on (downstairs at ~f0, 700, 1030, 1090, 1785, 1855, 2350, 2920; upstairs ~2240-2330,
   * 3155, 3250, 3455): she stopped and set off again under a steady scroll, and the camera closed in on her there (the
   * proximity fades). Re-timed along the same path: her distance along the track is smoothed over +-1 s (a moving
   * average of the cumulative path length, first sample pinned, at most 0.5 m from the solved spot), so she slows through
   * those places instead of stopping.
   * The path itself (every point she can stand on) is unchanged; only when she is where on it.
   */
  private static retime(P: number[][], step: number, keep: [number, number][]) {
    const n = P.length, L = new Float64Array(n);
    for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]);
    const W = 6, Ls = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const w = Math.min(W, i, n - 1 - i); let a = 0;
      for (let k = -w; k <= w; k++) a += L[i + k];
      // (never more than 0.5 m along the path from the solved spot: the solver's waits beside a station keep her out of
      // its glow and in view; a full smoothing moved her into the glow / out of frame there, QA f1125 / f1137)
      // (and not at all while a station is showing (+-1 s, eased): there she waits beside it, out of its glow, on purpose)
      const f = i * step;
      let k = 1;
      for (const [w0, w1] of keep) k = Math.min(k, Math.max(0, Math.min(1, (Math.max(w0 - f, f - w1)) / 30 - 1)));
      Ls[i] = L[i] + k * Math.max(-0.5, Math.min(0.5, a / (2 * w + 1) - L[i]));
    }
    // (owner: "she leaves the picture for about a second" by the merch table, upstairs ~f2190 / ~f3440) where the solver
    // found no in-view spot she could walk to in time it jumps her several metres in a few frames (flag 8, ~5 m in 20
    // frames = 7 m/s) and she fell behind, out of the picture. She now sets off earlier along the same path instead, so
    // no step asks more than a brisk walk at the hold pace (RETIME_DMAX per sample = 2.3 m/s at 1.6x the filmed pace)
    // (not across a step taken while a station is showing: there the solver's moves keep her beside it and out of its
    // glow on purpose, and setting off early pulled her to the frame edge by the TVs, f1012-1056)
    // (a step is capped where the solver flagged it (+4 jump / +8 over budget), not more than 10 frames into a station's
    // window (there its moves keep her beside the station on purpose; spreading the jumps by the TVs pulled her to the
    // frame edge, f1012-1056); and once she is setting off early the cap carries on back until she is on schedule
    // again: stopping at the first unflagged step piled it all into one 4.8 m jump by the merch table, f2265-2270)
    if (!OFF.has('pace')) {
      const Lo = Ls.slice();
      for (let i = n - 2; i >= 0; i--) {
        const f = (i + 1) * step;
        const ahead = Ls[i + 1] > Lo[i + 1] + 1e-6;
        const start = !!((P[i + 1][3] ?? 0) & 12) && !keep.some(([w0, w1]) => f >= w0 + 10 && f <= w1);
        if (ahead || start) Ls[i] = Math.max(Ls[i], Ls[i + 1] - GuideBrain.RETIME_DMAX * step / 5);
      }
    }
    const out: number[][] = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const d = Ls[i];
      while (j < n - 2 && L[j + 1] < d) j++;
      const seg = L[j + 1] - L[j], t = seg > 1e-9 ? Math.max(0, Math.min(1, (d - L[j]) / seg)) : 0;
      const a = P[j], b = P[j + 1];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, ...P[i].slice(3)]);
    }
    return out;
  }
  private blockAt(frame: number, out: THREE.Vector3) {
    const b = this.block!, n = b.P.length, x = Math.max(0, Math.min(n - 1, frame / b.step));
    const i = Math.min(n - 2, Math.floor(x)), t = Math.max(0, Math.min(1, x - i));
    const a = b.P[i], c = b.P[i + 1] ?? a;
    return out.set(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t);
  }
  /** The walked path's side of a rail near path distance s (the inside), for rail tests. */
  private railRef(sH: number) { const f = this.frameAtDistance(sH); return [this.smX[f], this.smZ[f]]; }
  /** Would her root at (x, z) be inside a blocker (+0.08 m) or within 0.3 m of / beyond an active rail? */
  private collides(x: number, z: number, sH: number) {
    for (const [bx, bz, br] of this.blockers()) if ((x - bx) ** 2 + (z - bz) ** 2 < (br + 0.08) ** 2) return true;
    const [qx, qz] = this.railRef(sH);
    for (const r of this.nav?.rails ?? []) {
      if (!this.railActive(r)) continue;
      const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
      const t = ((x - ax) * ux + (z - az) * uz) / L2;
      if (t < -0.08 || t > 1.08) continue;
      const sp = ux * (z - az) - uz * (x - ax), sq = ux * (qz - az) - uz * (qx - ax);
      if (Math.abs(sp) / Math.sqrt(L2) < 0.3 || (Math.sign(sp) !== Math.sign(sq) && Math.abs(sq) > 1e-6)) return true;
    }
    return false;
  }
  /** The rail half of collides: on / beyond an active rail (blockers she can steer round are not counted). */
  private railHit(x: number, z: number, sH: number) {
    const [qx, qz] = this.railRef(sH);
    for (const r of this.nav?.rails ?? []) {
      if (!this.railActive(r)) continue;
      const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
      const t = ((x - ax) * ux + (z - az) * uz) / L2;
      if (t < -0.08 || t > 1.08) continue;
      const sp = ux * (z - az) - uz * (x - ax), sq = ux * (qz - az) - uz * (qx - ax);
      if (Math.abs(sp) / Math.sqrt(L2) < 0.3 || (Math.sign(sp) !== Math.sign(sq) && Math.abs(sq) > 1e-6)) return true;
    }
    return false;
  }
  /** Remove the part of the wanted velocity that heads into a nearby blocker or rail (steer along / round it). */
  private constrainHeading(vd: THREE.Vector3, goal: THREE.Vector3, sH: number) {
    const px = this.pos.x, pz = this.pos.z;
    for (const [bx, bz, br] of this.blockers()) {
      const dx = px - bx, dz = pz - bz, d = Math.hypot(dx, dz), R = br + 0.25;
      if (d > R + 0.6 || d < 1e-3) continue;
      const nx = dx / d, nz = dz / d, inn = vd.x * nx + vd.z * nz; // < 0: toward it
      if (inn >= 0) continue;
      const w = Math.max(0, Math.min(1, 1 - (d - R) / 0.6)); // full at the clearance, none 0.6 m out
      vd.x -= inn * nx * w; vd.z -= inn * nz * w;
      // ...and round it on the side of her goal, keeping the pace
      const tx = -nz, tz = nx, side = Math.sign((goal.x - bx) * tx + (goal.z - bz) * tz) || 1;
      vd.x += tx * side * -inn * w * 0.8; vd.z += tz * side * -inn * w * 0.8;
    }
    const [qx, qz] = this.railRef(sH);
    for (const r of this.nav?.rails ?? []) {
      if (!this.railActive(r)) continue;
      const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
      const t = ((px - ax) * ux + (pz - az) * uz) / L2;
      if (t < -0.2 || t > 1.2) continue;
      const cx = ax + ux * Math.max(0, Math.min(1, t)), cz = az + uz * Math.max(0, Math.min(1, t));
      let nx = qx - cx, nz = qz - cz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; // toward the walked side
      const d = (px - cx) * nx + (pz - cz) * nz;
      if (d > 1.1) continue;
      const inn = vd.x * nx + vd.z * nz;
      if (inn >= 0) continue;
      const w = Math.max(0, Math.min(1, 1 - (d - 0.45) / 0.65));
      vd.x -= inn * nx * w; vd.z -= inn * nz * w;
    }
  }
  private sizeRisk = false;
  /** Her on-screen height (fraction of the screen) at p as seen from footage frame fr; 9 if the camera is at / past her. */
  private heightAt(p: THREE.Vector3, fr: number) {
    const cam = this.floor.cam, fc = this.futCam, v = this.view;
    if (fr !== this.futFrame) {
      this.futFrame = fr;
      fc.position.fromArray(cam.pos, fr * 3); fc.quaternion.fromArray(cam.quat, fr * 4); fc.updateMatrixWorld(true);
    }
    const a = this.tmpQ.copy(p).applyMatrix4(fc.matrixWorldInverse);
    if (a.z > -0.5) return 9;
    a.applyMatrix4(v.camera.projectionMatrix);
    const fy = -a.y * 0.5 + 0.5;
    const b = this.tmpQ.copy(p).setY(p.y + 1.62).applyMatrix4(fc.matrixWorldInverse).applyMatrix4(v.camera.projectionMatrix);
    return Math.abs(fy - (-b.y * 0.5 + 0.5));
  }
  /** Lane point 1.2-5 m ahead where her body box is most inside the picture (overflow px + size), or null. */
  private mostVisibleLane(sV: number, Send: number, rects: BrainContext['stationRects']) {
    const v = this.view, W = v.width, H = v.height, ox = v.offsetX, P = this.tmpW;
    let best: { s: number; lat: number; sc: number } | null = null;
    for (let L = 1.2; L <= 5.01; L += 0.4) {
      const s = Math.min(Send, sV + L), [l0, l1] = this.laneAt(s);
      for (const lat of [l0 + 0.28, (l0 + l1) / 2, l1 - 0.28]) {
        const cl = this.clampLat(s, lat);
        this.lanePoint(s, cl, P);
        if (!this.standable(P, false)) continue;
        const feet = v.project(P), head = v.project(this.tmpQ.copy(P).setY(P.y + 1.62));
        if (!feet || !head) continue;
        const hgt = feet.y - head.y, half = hgt * 0.27 + 6;
        const over = Math.max(0, ox + W * 0.04 - (feet.x - half)) + Math.max(0, feet.x + half - (ox + W * 0.94)) + Math.max(0, H * 0.06 - head.y) + Math.max(0, feet.y - H * 0.96);
        const frac = hgt / H;
        if (this.overGlow(P, rects)) continue; // (never in front of a station's glow)
        if (this.depthBad(P)) continue;
        const sc = over / W * 4 + Math.max(0, frac - 0.45) * 6 + Math.max(0, 0.15 - frac) * 3 + Math.abs(L - 3) * 0.05;
        if (!best || sc < best.sc) best = { s, lat: cl, sc };
      }
    }
    return best;
  }
  /** The current pan spot (aFix === panSpot): a fixed floor point where the camera will be looking ~1.2 s on. */
  private panSpot: THREE.Vector3 | null = null;
  private get onPanSpot() { return !!this.panSpot && this.aFix === this.panSpot; }

  /**
   * Keeping ahead of a camera pan: a FIXED floor point ~3 m in front of where the camera will be at frame fr2
   * (~1.2 s on at the current scroll rate), pulled into the free lane, standable, in the safe zone of that coming view
   * and preferably in view now as well; footage depth (where the point is in view now) must not show a wall or a
   * person there. Fixed in the world, so she walks to it on a straight line and the turning view arrives on her
   * (a camera-relative target would sweep round her and she'd chase it in circles).
   */
  private pickPanSpot(sV: number, rects: BrainContext['stationRects'], fr: number, fr2: number, frac0: number) {
    const cam = this.floor.cam, fc = this.futCam, fNow = Math.round(this.view.frame ?? 0);
    this.futFrame = fr2;
    fc.position.fromArray(cam.pos, fr2 * 3); fc.quaternion.fromArray(cam.quat, fr2 * 4); fc.updateMatrixWorld(true);
    const f = this.tmpW.set(0, 0, -1).applyQuaternion(fc.quaternion);
    const L = Math.hypot(f.x, f.z) || 1, fx = f.x / L, fz = f.z / L;
    const cx = fc.position.x, cz = fc.position.z, eyeY = fc.position.y - cam.camera_height_m;
    const P = new THREE.Vector3();
    let best: { p: THREE.Vector3; sc: number } | null = null;
    const fitGap = ((this.navPair(sV)?.a as { fit_gap?: number } | undefined)?.fit_gap ?? 0) > 0;
    for (const d of [3.0, 2.6, 3.4, 4.0]) for (const l of [0, 0.5, -0.5, 1.0, -1.0]) {
      P.set(cx + fx * d - fz * l, eyeY, cz + fz * d + fx * l);
      const s = this.nearestS(P, sV), lat = this.latOf(P, s), [l0, l1] = this.laneAt(s);
      if (lat > l0 - 1.5 && lat < l1 + 1.5) { const cl = this.clampLat(s, lat); if (Math.abs(cl - lat) > 1e-3) { this.lanePoint(s, cl, P); P.y = eyeY; } }
      let why = 'ok';
      if (!this.standable(P, false)) why = 'standable';
      else if (this.overGlow(P, rects)) why = 'glow';
      else if (!this.inFrameAt(P, fr2, 0.15)) why = 'not-in-coming-view';
      let inNow = false;
      if (why === 'ok') {
        inNow = this.spotQuality(P, rects, 0.1, 0.5, true, frac0, true) >= 0;
        if (inNow) {
          const fy = this.floorFromDepth(P, eyeY);
          if (fy === null && (this.lastRej === 'nf-wall' || this.lastRej === 'nf-person' || (this.lastRej === 'nf-drop' && !fitGap))) why = this.lastRej;
          else if (fy !== null && Math.abs(fy - eyeY) > 0.5) why = 'fb-height';
        } else if (this.view.project(P) && !this.fullyOff(P)) why = 'now-' + this.lastRej; // in the picture now but not a good spot
      }
      if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: fNow, kind: 'pan', d, l, why, inNow });
      if (why === 'ok' && P.distanceTo(this.pos) > 3.5) why = 'too-far'; // (a pan spot is a few steps away: further, it is travel, which the lane spots handle)
      if (why === 'ok' && !inNow && !(fr >= 0 && this.inFrameAt(P, fr, 0.08))) why = 'not-in-view-soon';
      if (why !== 'ok') continue;
      const sc = P.distanceTo(this.pos) * 0.35 + Math.abs(l) * 0.2 + (inNow ? 0 : 0.8) + (fr >= 0 && this.inFrameAt(P, fr, 0.1) ? 0 : 0.5) + this.turnCost(P) * 3;
      if (!best || sc < best.sc) best = { p: P.clone(), sc };
    }
    return best;
  }
  private usePanSpot(p: THREE.Vector3) {
    const was = this.anchorPoint(this.tmpW).clone();
    this.panSpot = p; this.aFix = p; this.aCam = null; this.aS = -1; this.fbInit = false; this.noSpot = false;
    if (p.distanceTo(was) > 0.3) this.anchorJumped = true;
  }
  /** Walking, a new spot that lies behind her costs a turn round (a person keeps going rather than doubling back). */
  private turnCost(P: THREE.Vector3) {
    if (this.spd < 0.5) return 0;
    const dx = P.x - this.pos.x, dz = P.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) return 0;
    const c = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / d;
    return (1 - c) * 0.35 * Math.min(1, this.spd / 1.5);
  }
  private tmpQuat = new THREE.Quaternion();

  private anchorPoint(out: THREE.Vector3) {
    if (this.aFix) return out.copy(this.aFix);
    if (this.aCam?.fb) return out.copy(this.fbPos);
    if (this.aCam) return this.camPoint(this.aCam.d, this.aCam.l, this.aCam.y, out);
    return this.lanePoint(this.aS, this.aLat, out);
  }

  /**
   * Re-choose the anchor. Candidates: spots on the measured lane ahead (best: that's where a person walked, inside
   * the walls), then spots in front of the camera on floor the footage itself shows at the visitor's level (for
   * stretches where the solved path ahead runs out of the picture: tilted / drifting solve, the camera looking across
   * a turn, the end of a floor). Scored for size, continuity with where she is, the open side and people.
   */
  private searchAnchor(sV: number, Lp: number, rects: BrainContext['stationRects'], racing: boolean, keepBonus: number, needF = -1) {
    const Send = this.S[Math.min(this.S.length - 1, this.floor.end ?? this.S.length - 1)] - 0.15; // (the walk's end)
    const leads = racing ? [Lp, Lp - 1, Lp + 1, Lp - 2, Lp - 3, Lp - 4.5, 3, 2.5] : [Lp, Lp - 0.5, Lp + 0.6, 2.5, 3.5, 4.5, 2.0, 5.5, 6.5, 7.5, 9, 11, 1.6];
    const lo = racing ? 0.09 : this.loNow, hi = 0.42, frac0 = racing ? 0.16 : 0.29 - 0.08 * this.fastK;
    const P = new THREE.Vector3();
    let best: { s: number; lat: number; cam: { d: number; l: number; y: number } | null; fix?: THREE.Vector3; sc: number } | null = null;
    const curLat = this.aLat;
    // where the camera will be shortly: the scroll's aim when it is well ahead, else ~0.5 s of the current pace
    const fNow = Math.round(this.view.frame ?? 0), nF = this.S.length;
    const futF = Math.abs(this.sAim - sV) > 1 ? this.frameAtDistance(Math.min(this.sAim, sV + 6)) : Math.abs(this.vVs) > 0.3 ? Math.max(0, Math.min(nF - 1, fNow + Math.round(Math.sign(this.vVs) * 15))) : -1;
    // ...and about a second of footage further on: the camera's pans are what push her out of the frame, so prefer
    // spots on the side it is turning toward
    const futF2 = Math.abs(this.vVs) > 0.3 || Math.abs(this.sAim - sV) > 1 ? Math.max(0, Math.min(nF - 1, fNow + Math.round(Math.sign(this.vVs || 1) * 40))) : -1;
    const visFloor = this.navAt(sV)?.floor_y ?? this.view.camera.position.y - this.floor.cam.camera_height_m;
    for (const pass of [0, 1, 2, 3]) {
      const relaxed = pass > 0, lenient = pass > 1;
      this.desperate = pass > 2;
      const seenS = new Set<number>();
      for (const L of leads) {
        const s = Math.min(Send, sV + L);
        const key = Math.round(s * 10);
        if (seenS.has(key) || s < 0) continue;
        seenS.add(key);
        const [l0, l1] = this.laneAt(s);
        const pref = this.prefLat(s);
        const lats = [pref, this.clampLat(s, curLat), this.clampLat(s, -pref), this.clampLat(s, pref * 0.4), l0 + 0.28, l1 - 0.28].filter((x, i, a) => x >= l0 + 0.2 && x <= l1 - 0.2 && a.findIndex((y) => Math.abs(y - x) < 0.08) === i);
        if (!lats.length) lats.push((l0 + l1) / 2);
        for (const lat of lats) {
          this.lanePoint(s, lat, P);
          let q = this.spotQuality(P, rects, relaxed ? 0.12 : lo, relaxed ? 0.48 : hi, relaxed, frac0, lenient);
          if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: Math.round(this.view.frame ?? 0), pass, kind: 'lane', L: +(s - sV).toFixed(2), lat: +lat.toFixed(2), q: +q.toFixed(2), why: q < 0 ? this.lastRej : (needF >= 0 && !this.inFrameAt(P, needF, 0.12) ? 'gone-after-pan' : 'ok') });
          if (q < 0) continue;
          if (!lenient && futF >= 0 && this.heightAt(P, futF) > 0.46) continue; // the camera is coming up on it: too large soon
          if (!this.desperate && this.crossesPeople(P) >= 0.5) continue; // she'd have to walk through someone / something
          if (needF >= 0 && !this.inFrameAt(P, needF, 0.12)) { if (!lenient) continue; q += 2; } // gone after the coming pan
          if (lenient) q += 1.5;
          if (futF >= 0 && !this.inFrameAt(P, futF)) q += 1.0; // out of view where the visitor is heading
          if (futF2 >= 0 && !this.inFrameAt(P, futF2)) q += 0.8;
          let sc = q + this.turnCost(P) + Math.abs((s - sV) - Lp) * (this.centreK ? 0.1 : 0.3) + P.distanceTo(this.pos) * (this.centreK ? 0.5 : 0.12) + Math.abs(lat - pref) * 0.3 + (Math.sign(lat) !== Math.sign(curLat) ? 0.15 : 0) + this.crossesPeople(P) * 0.8 + (relaxed ? 2 : 0);
          if (!this.aCam && this.aS >= 0 && Math.abs(s - this.aS) < 0.3 && Math.abs(lat - this.aLat) < 0.15) sc -= keepBonus;
          if (!best || sc < best.sc) best = { s, lat, cam: null, sc };
        }
      }
      // measured off-lane spots for this stretch (the balcony walkway at the end of upstairs, where the walked path
      // runs out under the visitor's feet and the camera looks down into the atrium)
      if (!this.desperate) for (const sp of this.nav?.spots ?? []) {
        if (sV < sp.from_s || sV > sp.to_s) continue;
        P.set(sp.x, sp.y, sp.z);
        const trusted = (this.fitFn?.(Math.round(this.view.frame ?? 0))?.[2] ?? 1) > 0;
        this.verified = !trusted; // (placed by eye on this view: the untrusted depth can't veto it)
        const q = this.spotQuality(P, rects, relaxed ? 0.12 : lo, relaxed ? 0.48 : hi, relaxed, frac0, lenient);
        this.verified = false;
        if (q < 0) continue;
        let sc = q + 0.2 + P.distanceTo(this.pos) * 0.12 + this.crossesPeople(P) * 0.8 + (relaxed ? 2 : 0);
        if (this.aFix && this.aFix.distanceTo(P) < 0.2) sc -= keepBonus;
        if (!best || sc < best.sc) best = { s: -1, lat: 0, cam: null, fix: P.clone(), sc };
      }
      // in front of the camera, on floor the footage shows at the visitor's own level (never over a drop / in a wall)
      const bl = best as { sc: number } | null;
      if (!lenient && (!bl || bl.sc > (this.centreK ? 0.4 : 1.6))) {
        for (const d of racing ? [5, 6.5, 4, 8] : [3, 3.6, 2.6, 4.4]) for (const l of [0.45 * this.side, -0.45 * this.side, 0, 0.9 * this.side, -0.9 * this.side, 1.3 * this.side, -1.3 * this.side]) {
          this.camPoint(d, l, visFloor, P);
          const fy = this.camFloorOk(P, visFloor);
          if (fy === null) { if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: Math.round(this.view.frame ?? 0), pass, kind: 'cam', d, l, why: this.lastRej }); continue; }
          P.y = fy;
          const q = this.spotQuality(P, rects, relaxed ? 0.12 : lo, relaxed ? 0.48 : hi, relaxed, frac0);
          if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), f: Math.round(this.view.frame ?? 0), pass, kind: 'cam', d, l, q: +q.toFixed(2), why: q < 0 ? this.lastRej : 'ok' });
          if (q < 0) continue;
          if (futF >= 0 && this.heightAt(P, futF) > 0.46) continue;
          if (needF >= 0 && !this.inFrameAt(P, needF, 0.12)) continue;
          let sc = q + 0.9 + this.turnCost(P) + P.distanceTo(this.pos) * 0.12 + (futF >= 0 && !this.inFrameAt(P, futF) ? 1.0 : 0) + (futF2 >= 0 && !this.inFrameAt(P, futF2) ? 0.8 : 0) + this.crossesPeople(P) * 0.8 + (relaxed ? 2 : 0);
          if (this.aCam && Math.abs(this.aCam.d - d) < 0.3 && Math.abs(this.aCam.l - l) < 0.2) sc -= keepBonus;
          if (!best || sc < best.sc) best = { s: -1, lat: 0, cam: { d, l, y: fy }, sc };
        }
      }
      if (!best && this.desperate) {
        // last resort, nothing on the lane in frame (the camera looking across a bend): straight ahead of the visitor
        // on their own floor level, in frame, clear of blockers and rails
        for (const d of [3, 3.6, 2.6, 4.4]) for (const l of [0, 0.4 * this.side, -0.4 * this.side, 0.8 * this.side, -0.8 * this.side]) {
          this.camPoint(d, l, visFloor, P);
          if (!this.standable(P, false)) continue;
          const q = this.spotQuality(P, rects, 0.12, 0.48, true, frac0, true);
          if (q < 0) continue;
          const sc = q + P.distanceTo(this.pos) * 0.12;
          if (!best || sc < best.sc) best = { s: -1, lat: 0, cam: { d, l, y: visFloor }, sc };
        }
      }
      if (best) break;
    }
    this.desperate = false;
    return best;
  }

  /** Keep / ease / re-choose the anchor for this frame and return her goal point (world). */
  private updateAnchor(dt: number, sV: number, vVis: number, rects: BrainContext['stationRects'], reset: boolean) {
    const racing = this.state === 'race';
    const Send = this.S[Math.min(this.S.length - 1, this.floor.end ?? this.S.length - 1)] - 0.15; // (the walk's end)
    // fast travel (swipes / flicks run the footage at up to ~6x walking pace): a longer lead and a line closer to the
    // middle, so the camera closing in on her doesn't push her out of the side of the frame
    this.fastK = Math.max(0, Math.min(1, (Math.abs(vVis) - 1.5) / 2.5));
    // anticipation: a swipe / fling says where the visitor is about to be; she sets off at once to stay ahead of that
    // (a person sees you start to jog), instead of being caught standing while the camera accelerates into her
    const ahead = Math.max(0, Math.min(5, this.sAim - sV - 0.5));
    const Lp = racing ? Math.max(2.5, this.raceAnchor - sV) : Math.min(8, Math.max(3.4 + Math.abs(vVis) * 0.5, ahead + 2.6));
    this.loNow = 0.2 - 0.07 * Math.max(this.fastK, Math.min(1, ahead / 3));
    const lo = racing ? 0.09 : this.loNow, hi = 0.42, frac0 = racing ? 0.16 : 0.29 - 0.08 * this.fastK;
    const out = this.tmpG;
    const walking = Math.abs(vVis) > 0.3 || ahead > 0.5;
    // smoothed camera heading (handheld sway must not swing a camera-relative spot around)
    {
      const cf = this.tmpQ.set(0, 0, -1).applyQuaternion(this.view.camera.quaternion);
      const L = Math.hypot(cf.x, cf.z) || 1, k = reset ? 1 : Math.min(1, dt * 2.5);
      this.camFwd.x += (cf.x / L - this.camFwd.x) * k; this.camFwd.y += (cf.z / L - this.camFwd.y) * k;
      this.camFwd.normalize();
    }
    if (!this.aCam && this.aS >= 0 && !reset) {
      this.aS = Math.min(Send, sV + this.lead);
      // ease the lead toward the pace-dependent distance (only while walking; standing, she waits where she is) and
      // the lateral offset toward the open side, but only through spots that stay good
      if (walking || racing) {
        const step = (racing ? 3 : Lp > this.lead ? 1.0 + 3.0 * Math.min(1, (Lp - this.lead) / 3) : 1.0) * dt;
        const nl = this.lead + Math.max(-step, Math.min(step, Lp - this.lead));
        if (Math.abs(nl - this.lead) > 1e-4) {
          const q = this.spotQuality(this.lanePoint(Math.min(Send, sV + nl), this.aLat, out), rects, lo, hi, false, frac0);
          if (q >= 0) { this.lead = nl; this.aS = Math.min(Send, sV + nl); }
        }
        const pref = this.prefLat(this.aS);
        const lr = (0.3 + 0.4 * this.fastK) * dt;
        const nlat = this.aLat + Math.max(-lr, Math.min(lr, pref - this.aLat));
        if (Math.abs(nlat - this.aLat) > 1e-4 && this.spotQuality(this.lanePoint(this.aS, nlat, out), rects, lo, hi, false, frac0) >= 0) this.aLat = nlat;
      }
      this.aLat = this.clampLat(this.aS, this.aLat); // the lane narrows (a doorway, the corridor): stay inside it
    } else if (this.aCam?.fb && !reset) {
      // the fallback follows the camera: re-placed every frame, smoothed (~0.3 s), re-validated against the depth
      const r = this.fbRaw(this.aCam.d, this.aCam.l, sV, out);
      if (r) { this.fbPos.lerp(r, 1 - Math.exp(-dt / 0.3)); this.camBadT = 0; }
      else this.camBadT += dt;
    } else if (this.aCam && !reset) {
      // a camera-relative spot keeps re-measuring the floor under it from the footage
      const visFloor = this.navAt(sV)?.floor_y ?? this.view.camera.position.y - this.floor.cam.camera_height_m;
      const fy = this.camFloorOk(this.camPoint(this.aCam.d, this.aCam.l, this.aCam.y, out), visFloor);
      if (fy !== null) { this.aCam.y += (fy - this.aCam.y) * Math.min(1, dt * 3); this.camBadT = 0; }
      else this.camBadT += dt; // the floor there stopped checking out (a new view): find another spot
    }
    let q = -1;
    if (!reset && (this.aS >= 0 || this.aCam || this.aFix)) {
      this.anchorPoint(out);
      this.verified = !!this.aFix && (this.fitFn?.(Math.round(this.view.frame ?? 0))?.[2] ?? 1) === 0;
      q = this.spotQuality(out, rects, lo, hi, false, frac0);
      if (q < 0) q = this.spotQuality(out, rects, 0.12, 0.48, true, frac0) >= 0 ? 0.5 : -1; // still acceptable, just not ideal
      this.verified = false;
    }
    // personal space: the visitor is walking into her (she'd fill the screen): pick a new spot now
    const pf = this.view.project(this.pos), ph = this.view.project(this.tmpQ.copy(this.pos).setY(this.pos.y + 1.62));
    const frac = pf && ph ? (pf.y - ph.y) / this.view.height : 0;
    this.urgent = vVis > 0.3 && frac > 0.42;
    {
      const fNow = Math.round(this.view.frame ?? 0), rate = this.vVs / Math.max(1e-3, this.stepM);
      if (Math.abs(rate) > 3) {
        const fF = Math.max(0, Math.min(this.floor.end ?? this.S.length - 1, fNow + Math.round(Math.max(-60, Math.min(60, rate * 0.6)))));
        if (this.heightAt(this.pos, fF) > 0.45 || (!reset && (this.aS >= 0 || this.aCam || this.aFix) && this.heightAt(this.anchorPoint(this.tmpV2), fF) > 0.47)) this.urgent = true;
      }
    }
    // her own body at / over a frame edge (she lags her spot, or the camera panned): look for a more central spot
    {
      const W = this.view.width, ox = this.view.offsetX;
      const atEdge = !!(pf && ph) && (Math.min(pf.x, ph.x) - (pf.y - ph.y) * 0.18 < ox + 2 || Math.max(pf.x, ph.x) + (pf.y - ph.y) * 0.18 > ox + W - 2 || pf.y > this.view.height - 2);
      this.edgeT = atEdge ? this.edgeT + dt : 0;
    }
    if (this.aCam && this.camBadT > 0.3) q = -1;
    // where she stands now the footage says she is behind something / on air / in front of a wall she's behind: move on
    this.depthBadT = this.depthBad(this.pos) ? this.depthBadT + dt : 0;
    if (this.depthBadT > 0.12) q = -1;
    // ...or she is drawn over a nearer person the shader doesn't hide her behind
    this.personT = this.feetOnPerson(this.pos) ? this.personT + dt : 0;
    if (this.personT > 0.1) q = -1;
    const trouble = (this.personT > 0.1 || this.depthBadT > 0.12) && this.t - this.lastSearch > 0.3;
    this.aBadT = q < 0 ? this.aBadT + dt : 0;
    const due = this.t - this.lastSearch > (walking ? 0.6 : 1.5); // a better spot may have opened up (e.g. back on the lane)
    // travelling fast: is her spot still in view where the camera is heading? (re-check ~4x a second)
    let futBad = false;
    if ((this.fastK > 0 || ahead > 1) && q >= 0 && this.t - this.lastSearch > 0.25) {
      const fNow = Math.round(this.view.frame ?? 0);
      const futF = ahead > 1 ? this.frameAtDistance(Math.min(this.sAim, sV + 6)) : Math.max(0, Math.min(this.S.length - 1, fNow + Math.round(Math.sign(vVis) * 15)));
      futBad = !this.inFrameAt(out, futF);
    }
    // her spot itself drifting toward a frame edge (the camera turning): move to a more central spot before she's cut
    let spotEdge = false;
    if (q >= 0 && this.t - this.lastSearch > 0.3) {
      const af = this.view.project(out);
      if (af) { const ux = (af.x - this.view.offsetX) / this.view.width; spotEdge = ux < 0.16 || ux > 0.76; }
    }
    const edgy = (this.edgeT > 0.12 || spotEdge) && this.t - this.lastSearch > 0.3;
    // predictive keep-in-frame: where will the camera be in ~0.6 s at the current scroll rate? If she (or her spot)
    // would leave the safe zone (12 % side margins) she moves now to a spot that is in view both now and then; with
    // none, to a spot on the far side of the pan (in view as soon as it settles)
    let panRisk = false, panF = -1, panF2 = -1;
    {
      const fNow = Math.round(this.view.frame ?? 0), rate = this.vVs / Math.max(1e-3, this.stepM); // footage frames / s
      const fEnd = this.floor.end ?? this.S.length - 1;
      this.panSign = 0;
      if (Math.abs(rate) > 4) {
        panF = Math.max(0, Math.min(fEnd, fNow + Math.round(Math.max(-60, Math.min(60, rate * 0.6)))));
        panF2 = Math.max(0, Math.min(fEnd, fNow + Math.round(Math.max(-60, Math.min(60, rate * 1.2)))));
        // which way the camera turns between now and ~1.2 s on (+1 = to its right)
        const cq = this.floor.cam.quat, f1 = this.tmpQ, f2 = this.tmpW;
        f1.set(0, 0, -1).applyQuaternion(this.tmpQuat.fromArray(cq, fNow * 4));
        f2.set(0, 0, -1).applyQuaternion(this.tmpQuat.fromArray(cq, panF2 * 4));
        const turn = f2.x * -f1.z + f2.z * f1.x; // f2 . right(f1), right = (-fz, fx)
        if (Math.abs(turn) > 0.08) this.panSign = Math.sign(turn);
        // (a camera-relative fallback moves with the camera: only her own body is checked against the coming view)
        if (this.onPanSpot) panRisk = this.t - this.lastSearch > 0.4 && !this.inFrameAt(out, panF2, 0.08) && !this.inFrameAt(out, panF, 0.08);
        else panRisk = this.t - this.lastSearch > 0.25 && (!this.inFrameAt(this.pos, panF, 0.12) || (q >= 0 && !this.aCam?.fb && !this.inFrameAt(out, panF, 0.12)));
      }
    }
    this.panT = panRisk ? 0.8 : Math.max(0, this.panT - dt);
    let fbUsed = false;
    if (panRisk) {
      this.lastSearch = this.t;
      let b: ReturnType<GuideBrain['searchAnchor']> | ReturnType<GuideBrain['farSideOfPan']> = this.searchAnchor(sV, Lp, rects, racing, 0, panF);
      // a world spot the continuing pan sweeps out again (off the middle of the view ~1.2 s on), or none at all: the
      // camera-relative fallback ahead on the side the camera turns toward, which travels with the view
      let sweep = !b;
      if (b && panF2 >= 0) {
        const bp = b.fix ? b.fix : b.cam ? this.camPoint(b.cam.d, b.cam.l, b.cam.y, this.tmpW) : this.lanePoint(b.s, b.lat, this.tmpW);
        const x2 = this.screenXAt(bp, panF2);
        sweep = x2 === null || x2 < 0.15 || x2 > 0.8;
      }
      if (sweep && panF2 >= 0) {
        const ps = this.pickPanSpot(sV, rects, panF, panF2, frac0);
        if (ps) { this.usePanSpot(ps.p); q = 0; fbUsed = true; b = null; }
      }
      if (sweep && !fbUsed) {
        const fb = this.pickFallback(sV, rects, panF, frac0);
        if (fb) { this.useFallback(fb); q = 0; fbUsed = true; b = null; }
      }
      if (!fbUsed && !b) b = this.farSideOfPan(sV, panF);
      if (b) {
        const was = this.anchorPoint(this.tmpW).clone();
        if (b.cam) { this.aCam = b.cam; this.aFix = null; this.aS = -1; this.fbInit = false; }
        else { this.fbInit = false; this.aCam = null; this.aFix = null; this.aS = b.s; this.aLat = b.lat; this.lead = b.s - sV; }
        if (this.anchorPoint(out).distanceTo(was) > 0.3) this.anchorJumped = true;
        this.noSpot = false;
        q = 0;
      }
    }
    // (while hurrying ahead of a pan the plan stands: the spot may be out of view until the pan arrives)
    // her size on screen out of the readable band for a moment (too close / too far): the fallback's distance band
    this.sizeT = pf && ph && (frac < 0.12 || frac > 0.46) ? this.sizeT + dt : 0;
    if (!fbUsed && !reset && this.sizeT > 0.35 && this.t - this.lastSearch > 0.3) {
      this.lastSearch = this.t;
      const fb = this.pickFallback(sV, rects, panF, frac0);
      if (fb) { this.useFallback(fb); q = 0; fbUsed = true; this.sizeT = 0; }
      else { q = -1; this.aBadT = Math.max(this.aBadT, 0.15); this.lastSearch = this.t - 0.2; } // no fallback here: re-choose now (the search and the most-visible lane point both keep her size readable)
    }
    const fbHold = (!!this.aCam?.fb && q >= 0 || this.onPanSpot) && this.panT > 0; // keeping ahead of a pan with the fallback: the plan stands
    if (!fbUsed && (reset || trouble || (this.panT <= 0 || this.aBadT > (this.onPanSpot ? 1.5 : 0.9)) && (this.aBadT > 0.1 || this.urgent || futBad || edgy) || (this.aS < 0 && !this.aCam && !this.aFix) || (due && !fbHold && (q > 0.6 || this.aCam !== null || Math.abs(this.lead - Lp) > 1.5)))) {
      if (reset || this.t - this.lastSearch > 0.1) {
        this.lastSearch = this.t;
        this.centreK = edgy ? 1 : 0;
        const b = this.searchAnchor(sV, Lp, rects, racing, q >= 0 && !edgy ? 0.6 : 0);
        this.centreK = 0;
        if (b) {
          const was = this.anchorPoint(this.tmpW).clone();
          if (b.fix) { this.aFix = b.fix; this.aCam = null; this.aS = -1; this.fbInit = false; }
          else if (b.cam) { this.aCam = b.cam; this.aFix = null; this.aS = -1; this.fbInit = false; }
          else { this.fbInit = false; this.aCam = null; this.aFix = null; this.aS = b.s; this.aLat = b.lat; this.lead = b.s - sV; this.side = Math.sign(b.lat) || this.side; }
          if (this.anchorPoint(out).distanceTo(was) > 0.3) this.anchorJumped = true;
          this.noSpot = false;
        } else {
          this.noSpot = true;
          let fbN: ReturnType<GuideBrain['pickFallback']> = null;
          if (reset || !this.placed) { this.aCam = null; this.fbInit = false; this.aS = Math.min(Send, sV + Lp); this.aLat = this.prefLat(this.aS); this.lead = this.aS - sV; }
          else if (this.panT > 0 && (fbN = this.pickFallback(sV, rects, panF, frac0))) this.useFallback(fbN); // panning: never stand still
          else if (q < 0 && this.spotQuality(this.tmpV2.copy(this.pos), rects, 0.12, 0.48, true, frac0, true) >= 0) {
            // nothing better anywhere, but where she stands right now is still fine: stay there (no walking off)
            const sH = this.nearestS(this.pos, sV);
            this.aCam = null; this.fbInit = false; this.aS = sH; this.aLat = this.clampLat(sH, this.latOf(this.pos, sH)); this.lead = sH - sV;
          } else if ((fbN = this.pickFallback(sV, rects, panF, frac0))) {
            this.useFallback(fbN); // no spot survives the filters: the camera-relative fallback
          } else if ((this.aS < 0 && !this.aCam && !this.aFix) || q < 0) {
            this.aFix = null; this.fbInit = false;
            // nowhere good in frame (the camera looks out over the atrium, at a wall...): never a spot off the lane
            // then; she keeps her place ahead on the lane (always real floor, out of the visitor's way) until a good
            // spot comes back into view
            // (at the very end of a floor the path runs out under the visitor's feet: she stands beside them at the
            // rail, never inside the camera)
            let sA = Math.min(Send, sV + Math.max(Lp, 2.5)), lat = this.clampLat(sA, this.prefLat(sA));
            const cp = this.view.camera.position, P2 = this.lanePoint(sA, lat, this.tmpV2);
            if (Math.hypot(P2.x - cp.x, P2.z - cp.z) < 1.5) {
              sA = Math.max(0, Math.min(sA, sV) - 1.2); // just behind the visitor's shoulder, at the lane's roomier side
              const [l0, l1] = this.laneAt(sA);
              lat = -l0 > l1 ? (l1 - l0 < 0.56 ? (l0 + l1) / 2 : l0 + 0.28) : (l1 - l0 < 0.56 ? (l0 + l1) / 2 : l1 - 0.28);
            } else if (this.overGlow(P2, rects)) {
              // never wait in front of a station's glow: the other side of the lane, or a little further on
              const [l0, l1] = this.laneAt(sA);
              for (const [ds, cl] of [[0, l0 + 0.28], [0, l1 - 0.28], [1.5, lat], [1.5, l0 + 0.28], [1.5, l1 - 0.28], [3, lat]]) {
                const s2 = Math.min(Send, sA + ds), l2 = this.clampLat(s2, cl);
                if (!this.overGlow(this.lanePoint(s2, l2, this.tmpV2), rects)) { sA = s2; lat = l2; break; }
              }
            }
            // ...and of the lane points within reach ahead, the one she is most visible at (least of her body outside
            // the picture, readable size): where the path bends out of view she waits at its visible start, not off-frame
            const vis = this.mostVisibleLane(sV, Send, rects);
            if (vis) { sA = vis.s; lat = vis.lat; }
            this.aCam = null; this.aS = sA; this.aLat = lat; this.lead = sA - sV;
          }
        }
      }
    }
    this.dbgSrc = this.onPanSpot ? 'pan' : this.aFix ? 'spot' : this.aCam?.fb ? 'fb' : this.aCam ? 'cam' : this.noSpot ? 'lane-nospot' : 'lane';
    if (this.dbgLog) {
      const fNow = Math.round(this.view.frame ?? 0), A = this.anchorPoint(this.tmpV2);
      this.dbgLog.push({ t: +this.t.toFixed(3), f: fNow, kind: 'frame', src: this.dbgSrc, q: +q.toFixed(2), aL: this.aS >= 0 ? +(this.aS - sV).toFixed(2) : null, aLat: +this.aLat.toFixed(2),
        aCam: this.aCam ? [+this.aCam.d.toFixed(2), +this.aCam.l.toFixed(2)] : null, panF, panRisk, panT: +this.panT.toFixed(2), futBad, edgy, urgent: this.urgent, aBadT: +this.aBadT.toFixed(2),
        herX: this.screenXAt(this.pos, fNow), herXpan: panF >= 0 ? this.screenXAt(this.pos, panF) : null, spotX: this.screenXAt(A, fNow), spotXpan: panF >= 0 ? this.screenXAt(A, panF) : null,
        dist: +A.distanceTo(this.pos).toFixed(2), spd: +this.spd.toFixed(2) });
    }
    return this.anchorPoint(out).clone();
  }

  private setGesture(g: Gesture, dur: number) {
    this.gesture = g;
    this.gestureUntil = this.t + dur;
  }

  hop() { this.hopReq = true; }

  react(kind: 'up' | 'around') {
    this.setGesture(kind === 'up' ? 'tada' : 'lookAround', 1.6);
    this.mood = 'happy';
    setTimeout(() => { this.mood = 'neutral'; }, 1600);
  }

  private fitFn: ((frame: number) => number[] | null) | null = null;
  private bridge = new Uint8Array(0);
  private lastF = -1;
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private carryM = new THREE.Matrix4();
  private carryN = new THREE.Matrix4();

  /**
   * Crossing a solve-seam bridge (the camera's world pose jumps while the footage is continuous): carry her, and her
   * goal, rigidly with the camera across the bridge part of the step, so she stays put against the footage instead of
   * the world sliding out from under her (which read as a 300 px jump / a 355 m/s dash). Not a teleport on screen.
   */
  private camPrev = new THREE.Matrix4();
  private camPrevOk = false;
  private camTmp = new THREE.Matrix4();
  private carryAcrossSeam(frame: number) {
    const f = frame, prev = this.lastF; // (fractional: the camera moves between integer frames too)
    this.lastF = f;
    const cm = this.view.camera.matrixWorld;
    const had = this.camPrevOk;
    this.camTmp.copy(this.camPrev); // (previous camera)
    this.camPrev.copy(cm); this.camPrevOk = true;
    if (!had || prev < 0 || Math.abs(f - prev) < 1e-4 || Math.abs(f - prev) > 120 || !this.placed) return;
    const lo = Math.floor(Math.min(prev, f)) - 1, hi = Math.ceil(Math.max(prev, f)) + 1;
    let touches = false;
    for (let i = Math.max(0, lo); i < hi && i < this.bridge.length; i++) if (this.bridge[i]) { touches = true; break; }
    if (!touches) return;
    // the camera's actual motion between the two rendered poses (interpolated frames), applied to her
    this.carryM.copy(this.camTmp).invert();
    this.carryN.copy(cm).multiply(this.carryM);
    this.pos.applyMatrix4(this.carryN); // (her height then settles onto the floor under her at stair pace)
    this.goalPrev.applyMatrix4(this.carryN);
    const fa = this.tmpQ.set(0, 0, -1).transformDirection(this.camTmp), fb = this.tmpV2.set(0, 0, -1).transformDirection(cm);
    const dy = angDiff(Math.atan2(fb.x, fb.z), Math.atan2(fa.x, fa.z));
    this.yaw += dy; this.prevYaw += dy; // (not a turn of hers: no yaw-rate spike for the animator)
    this.carried = true;
  }
  /** Diagnostics: she was carried across a seam bridge this frame. */
  carried = false;

  /** dt of the last update (QA: the interval a recorded change was actually produced in). */
  lastDt = 0;

  update(c: BrainContext) {
    const dt = c.dt;
    this.lastDt = dt;
    this.curRects = c.stationRects;
    // (the visitor is back: the nudge stance ends, she turns forward and walks on)
    if (c.idle < 1) { this.nudgeFacing = false; this.nudgePending = false; this.lastNudgeT = -1e9; }
    if (this.sense && this.sense.fitAt !== this.fitFn) this.sense.fitAt = this.fitFn;
    if (this.view.fitAt !== this.fitFn) this.view.fitAt = this.fitFn;
    this.carried = false; // the occlusion shader reads depth with it too
    this.t += dt;
    const f = Math.round(c.frame);
    const fl = this.floor;
    const tSec = f / fl.meta.fps;
    // dark outro downstairs or unsolved stretches: she steps out of frame
    const dark = false; // the dark passage keeps her as a lantern companion (see placement)
    // (round 6: the lantern companion from the Terminal Row doorway on, frame ~2930: no floor in view ahead there)
    const darkZone = fl.id === 'downstairs' && tSec > 2930 / 29.97;
    this.inDark = darkZone && tSec < 113.4;
    // upstairs: race down the flickering corridor, party on the disco floor
    const upstairs = fl.id === 'upstairs';
    const chNow = fl.chapters.find((x) => tSec >= x.start && tSec < x.end)?.id;
    if (!upstairs || tSec < 46) this.raceDone = false;
    const raceZone = upstairs && tSec >= 47 && tSec < 63 && !c.gliding && !c.inTransition && !this.raceDone;
    const partyZone = upstairs && (chNow === 'disco-floor' || chNow === 'violet-gallery');
    this.partyNow = partyZone;
    this.energy += ((partyZone ? 1 : raceZone ? 0.5 : 0) - this.energy) * Math.min(1, dt * 1.5);
    let want: State = this.state;
    if (this.state !== 'intro') {
      if (darkZone && tSec < 112 && !this.saidDark && !c.gliding) { this.saidDark = true; this.say(pick(this.lines.dark), 3.5); }
      if (!darkZone) this.saidDark = false;
      if (c.open) want = 'present';
      else if (dark && this.lowConfAround(f)) want = 'hidden';
      // present a station when the visitor slows down near it; walking past, she stays on the lane with them
      else if (this.teaseStation && this.t < this.teaseUntil && c.live.includes(this.teaseStation) && Math.abs(c.userFps) < 9) want = 'tease';
      else if (raceZone) want = 'race';
      else if (Math.abs(c.userFps) > 2) want = 'follow';
      else want = 'idle';
    }
    if (want !== this.state) this.enter(want, c);

    // pick a new tease when a station goes live
    if (this.state === 'follow' || this.state === 'idle') {
      const fresh = c.live.find((s) => !this.teased.has(s.id));
      if (fresh && !c.inTransition) {
        this.teased.add(fresh.id);
        this.teaseStation = fresh;
        this.teaseUntil = this.t + 5.5;
        if (Math.abs(c.userFps) < 9) this.enter('tease', c);
        if (!c.gliding) this.say(pick(this.lines.stations[fresh.id]?.teaser ?? [fresh.one_liner]), 4.5);
      }
    }

    // keep presenting while the visitor lingers at a station (and re-present one they come back to)
    if (this.state === 'idle' && !this.teaseStation && c.live.length && !c.inTransition && !c.gliding) {
      this.teaseStation = c.live[0];
      this.teaseUntil = this.t + 3;
      this.enter('tease', c);
    }
    if (this.state === 'tease' && this.teaseStation && Math.abs(c.userFps) < 2 && c.live.includes(this.teaseStation)) this.teaseUntil = Math.max(this.teaseUntil, this.t + 0.6);

    // chapter lines + upstairs details
    const ch = fl.chapters.find((x) => tSec >= x.start && tSec < x.end);
    // the dark chapter has two moments: the black doorway, then the red room
    const chKey = ch?.id === 'into-the-dark' && tSec >= 113.4 ? 'into-the-dark/red' : ch?.id;
    if (ch && chKey && !c.gliding && chKey !== this.lastChapter && this.state !== 'tease' && this.state !== 'present' && this.state !== 'intro') {
      this.lastChapter = chKey;
      let ls = this.lines.chapters[ch.id];
      if (ch.id === 'into-the-dark' && ls) {
        const red = ls.filter((l) => /red/i.test(l));
        ls = chKey === 'into-the-dark/red' ? (red.length ? red : ls) : ls.filter((l) => !/red/i.test(l));
      }
      if (ls?.length && Math.abs(c.userFps) < 400) this.say(pick(ls), 3.6);
    }
    if (fl.id === 'upstairs' && this.state === 'follow' && !c.gliding) {
      const det = this.lines.upstairs_details ?? [];
      const k = det.findIndex((d) => Math.abs(d.t - tSec) < 0.6);
      if (k >= 0 && k !== this.lastDetail) {
        this.lastDetail = k;
        this.say(det[k].line, 3.4);
        const g = pick(['lookAround', 'lookBack', 'wave', 'tada'] as Gesture[]);
        this.setGesture(g, 1.6);
        if (g === 'tada' || Math.random() < 0.3) this.hop();
      }
    }

    // ---- race: sprint ahead to an anchor down the corridor, wave until the visitor catches up, go again
    if (this.state === 'race') {
      let gap = this.raceAnchor - this.S[f];
      // walked back (or scrubbed): re-anchor just ahead instead of waving from far down the hall
      if (gap > 11 || c.userFps < -3) { this.raceAnchor = Math.min(this.S[f] + 5, this.raceEndS); gap = this.raceAnchor - this.S[f]; }
      if (gap < 3.0) {
        const next = Math.min(this.raceAnchor + 5.5, this.raceEndS);
        if (next <= this.raceAnchor + 1.5) { this.raceDone = true; } // caught her at the end: race over, walk on together
        else {
          this.raceAnchor = next;
          this.waitSince = -1;
          this.saidWait = false;
          if (Math.random() < 0.6) this.say(pick(this.lines.race_go ?? ['Again!']), 2.4);
        }
      }
    }
    // ---- party: on the disco floor she dances whenever she's standing still
    if (partyZone && chNow && this.dancedIn !== chNow && chNow === 'disco-floor' && !c.gliding) {
      this.dancedIn = chNow;
      this.say(pick(this.lines.dance ?? ['Dance with me!']), 3.4);
      this.hop();
      this.setGesture('dance', 4);
    }
    if (!upstairs) this.dancedIn = '';

    // ---- the visitor's position/speed along the path, smoothed: decoded frames can jump ahead in bursts on a fast
    // fling; she follows the smooth intent, not the bursts
    const sRaw = this.S[Math.max(0, Math.min(this.S.length - 1, Math.round(c.cur ?? f)))] ?? 0;
    let jumpCut = false;
    // (on the blocking track any discontinuity of the scroll position is a cut: the pace cap moves at most ~0.15 m of
    // path per rendered frame, so a change over 0.8 m in one frame is a jump (scrubber, deep link, chapter), not a walk; round 9: was 1.5 m, which let 45-frame scrubs (~1.35 m) leave her walking a long way across the picture)
    if (this.sVs < 0 || (this.lastSRaw >= 0 && Math.abs(sRaw - this.lastSRaw) > (this.block ? 0.8 : 12))) {
      // a real jump cut (chapter / deep link / floor) in one frame: start fresh at her spot ahead
      this.sVs = sRaw; this.vVs = 0; this.lead = 3; jumpCut = true;
    }
    // (a glide (station, chapter, menu) is a cut too, uncapped by the pace cap: on the track she is placed at once where
    // the glide lands and waits there)
    const glideStart = !!this.block && !!c.gliding && !this.wasGliding;
    this.wasGliding = !!c.gliding;
    if (glideStart) jumpCut = true;
    // (the visitor's pace from the scroll position itself: chapter / station glides report userFps 0 but still move)
    const vRaw = jumpCut || this.lastSRaw < 0 ? 0 : Math.max(-12, Math.min(12, (sRaw - this.lastSRaw) / Math.max(dt, 1e-3)));
    this.lastSRaw = sRaw;
    this.vVs += ((c.gliding ? vRaw : c.userFps * this.stepM) - this.vVs) * Math.min(1, dt * 6);
    this.sVs += this.vVs * dt + (sRaw - this.sVs) * Math.min(1, dt * 4);
    const sV = this.sVs, vVis = this.vVs;
    // (user: stop on a dime) the raw scroll, not the smoothed pace: she halts the moment the picture does
    this.stopT = !c.gliding && Math.abs(c.userFps) < 0.5 && (c.aim === undefined || !isFinite(c.aim) || Math.abs(c.aim - (c.cur ?? c.frame)) < 1) ? this.stopT + dt : 0;
    this.carryAcrossSeam(c.frame);
    {
      const N1 = this.S.length - 1, a = c.aim;
      this.sAim = a === undefined || !isFinite(a) ? sV : this.S[Math.max(0, Math.min(N1, Math.round(a)))] ?? sV;
    }

    // ---- placement: an anchor on the measured lane (path distance aS, lateral offset aLat) that is in frame, at a
    // readable size, inside the free lane (walls, rails, furniture) and clear of people / station glows. She WALKS to it.
    const racing = this.state === 'race';
    const lantern = darkZone; // downstairs dark passage only: no floor to read, she walks just ahead as a lantern
    if (!lantern) this.lanWas = false;
    const rects = c.stationRects;
    let goal: THREE.Vector3;
    let laneGoal = true;
    let faceYaw = Math.atan2(this.view.camera.position.x - this.pos.x, this.view.camera.position.z - this.pos.z);
    if (lantern) {
      laneGoal = false;
      const cam = this.view.camera;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const rt = new THREE.Vector3(-fwd.z, 0, fwd.x);
      // (the hand-over at the doorway, f2937: she slowed to turn toward the new spot while the camera walked on into
      // her, and perspective pushed her off the right edge for ~1 s. For the first 2 s of the passage she moves with
      // the camera (its step and its turn, fading out), as a companion walking beside you would; her own steps carry
      // the rest)
      const cy = Math.atan2(fwd.x, fwd.z);
      if (!this.lanWas) { this.lanCarryT = 2; this.lanCam.copy(cam.position); this.lanYaw = cy; }
      if (this.lanCarryT > 0 && !OFF.has('lancarry')) {
        const k = Math.min(1, this.lanCarryT / 0.6);
        let dy = cy - this.lanYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        const tx = cam.position.x - this.lanCam.x, tz = cam.position.z - this.lanCam.z;
        if (Math.abs(dy) < 0.3 && tx * tx + tz * tz < 0.25) {
          const a = dy * k, dx = this.pos.x - this.lanCam.x, dz = this.pos.z - this.lanCam.z, ca = Math.cos(a), sa = Math.sin(a);
          this.pos.x = this.lanCam.x + dx * ca + dz * sa + tx * k; this.pos.z = this.lanCam.z - dx * sa + dz * ca + tz * k;
          this.yaw += a; this.prevYaw += a;
        }
        this.lanCarryT -= dt;
      }
      this.lanCam.copy(cam.position); this.lanYaw = cy;
      // (the lantern spot starts where she is as the passage begins, and drifts to its place over ~2 s: from the
      // fixed spot she crossed the frame and walked out of its right edge for ~1 s at the doorway, f2943-2977)
      if (!this.lanWas) {
        const dx = this.pos.x - cam.position.x, dz = this.pos.z - cam.position.z;
        this.lanD = Math.max(2.1, Math.min(3.2, dx * fwd.x + dz * fwd.z));
        this.lanL = Math.max(-0.7, Math.min(0.7, dx * rt.x + dz * rt.z));
      }
      this.lanD += (2.6 - this.lanD) * Math.min(1, dt / 2);
      this.lanL += (-0.35 * this.side - this.lanL) * Math.min(1, dt / 2);
      goal = cam.position.clone().addScaledVector(fwd, this.lanD).addScaledVector(rt, this.lanL);
      goal.y = cam.position.y - fl.cam.camera_height_m;
      // (round 7) where that spot reads as standing on air (the black doorway: footage depth far behind her feet),
      // the nearest spot around it that the footage agrees with (re-chosen every 0.2 s)
      if (this.t - this.lanAt > 0.2) {
        this.lanAt = this.t; this.lanOk = false;
        if (this.depthBad(goal) || this.feetOnPerson(goal) || this.viewBox(goal).inside < 0.95) {
          let bd = 1e9;
          for (const d of [2.6, 2.3, 2.9, 2.1, 3.2]) for (const l of [-0.35, 0, 0.35, -0.7, 0.7]) {
            const q = this.tmpE.copy(cam.position).addScaledVector(fwd, d).addScaledVector(rt, l * this.side); q.y = goal.y;
            if (this.depthBad(q) || this.feetOnPerson(q) || this.viewBox(q).inside < 0.95) continue; // (and in the picture)
            const c = Math.abs(d - 2.6) + Math.abs(l + 0.35);
            if (c < bd) { bd = c; this.lanOff.set(d, l * this.side, 0); this.lanOk = true; }
          }
        }
      }
      if (this.lanOk) { goal.copy(cam.position).addScaledVector(fwd, this.lanOff.x).addScaledVector(rt, this.lanOff.y); goal.y = cam.position.y - fl.cam.camera_height_m; }
      this.aS = -1;
      this.lanWas = true;
      this.dbgGoal = goal;
      this.dbgSrc = 'lantern' + (this.lanOk ? '+lanfix' : '') + (this.depthBad(this.pos) ? '+lanbad' : '');
    } else if (this.block) {
      laneGoal = false;
      // (at a jump cut the picture is still decoding the new frame: place her for the frame being jumped to)
      const vf = this.view.frame ?? c.frame;
      // feed-forward: how fast P itself moves right now = dP/df x df/dt (the shown frame's rate, lightly smoothed), so
      // she walks WITH the track instead of chasing it (a pure chaser always trails: nearer the camera, larger)
      if (jumpCut || !this.placed || this.lastVf < 0 || c.gliding) this.vfRate = 0;
      // (the picture catching up a jump a frame or two after the cut (decode) is not motion: a step of more than 20
      // footage frames in one rendered frame within 1 s of a cut counts as none (it fed a 45-frame jump in as ~500 frames/s, and she walked
      // off along her track out of the picture after a jump to f1125, QA 'stays on screen'); steps cap at 150 frames/s)
      else if (Math.abs(vf - this.lastVf) > 20 && this.t - this.cutAt < 1.0 && !OFF.has('vfclamp')) this.vfRate = 0;
      else this.vfRate += (Math.max(-150, Math.min(150, (vf - this.lastVf) / Math.max(dt, 1e-3))) - this.vfRate) * Math.min(1, dt * 12);
      this.lastVf = vf;
      const fT = c.gliding && c.aim !== undefined && isFinite(c.aim) ? c.aim : jumpCut || !this.placed ? (c.cur ?? c.frame) : vf;
      goal = this.blockAt(fT, new THREE.Vector3());
      const g1 = this.blockAt(fT + Math.sign(this.vfRate || 1), this.tmpBF);
      const k1 = Math.abs(this.vfRate);
      this.blockFF.set((g1.x - goal.x) * k1, 0, (g1.z - goal.z) * k1);
      this.aS = -1; this.aCam = null; this.aFix = null;
      this.dbgSrc = 'block';
      // (round 7) P out of view (gone-level) or too near the camera: she walks toward the nearest in-view point on
      // the track's lane instead (re-chosen every 0.15 s); P in view again, she follows P
      this.unsolvedNow = this.unsolved[Math.max(0, Math.min(this.unsolved.length - 1, Math.round(vf)))] === 1;
      // (leaving a carried stretch her track spot can be ~1.3 m away; she slowed to turn toward it while the camera
      // turned on, and slid out of the picture (upstairs f2187-2202). For 1.5 s after a carry she keeps moving with the
      // camera (its step and turn, fading out) while she walks over to her spot)
      {
        const cam = this.view.camera, fw = this.tmpE.set(0, 0, -1).applyQuaternion(cam.quaternion);
        const cy = Math.atan2(fw.x, fw.z);
        if (this.wasUns && !this.unsolvedNow && this.placed && !jumpCut) this.exitCarryT = 1.5;
        this.wasUns = this.unsolvedNow;
        if (this.exitCarryT > 0 && this.ecOk && !OFF.has('exitcarry')) {
          const k = Math.min(1, this.exitCarryT / 0.6);
          let dy = cy - this.ecYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
          const tx = cam.position.x - this.ecCam.x, tz = cam.position.z - this.ecCam.z;
          if (Math.abs(dy) < 0.3 && tx * tx + tz * tz < 0.25) {
            const a = dy * k, dx = this.pos.x - this.ecCam.x, dz = this.pos.z - this.ecCam.z, ca = Math.cos(a), sa = Math.sin(a);
            this.pos.x = this.ecCam.x + dx * ca + dz * sa + tx * k; this.pos.z = this.ecCam.z - dx * sa + dz * ca + tz * k;
            this.yaw += a; this.prevYaw += a;
          }
          this.exitCarryT -= dt;
        }
        this.ecCam.copy(cam.position); this.ecYaw = cy; this.ecOk = true;
      }
      const vbP = this.viewBox(goal);
      const still = this.stillT > 0.8;
      // (and never with her head inside a live glow rect as the overlay draws it now, edge beacons included: QA rule)
      const pOk = vbP.inside >= (still ? 0.97 : 0.6) && vbP.camD >= 1.9 && vbP.h <= 0.5 && !this.glowBad(goal, true, 40)
        // (round 8) and not where a guest at about her depth would have her drawn through them (walkers crossing):
        // she steps aside to an in-view point instead, or waits there a beat
        && (OFF.has('walker') || this.pBadT < 0.15)
        // (round 9) and she isn't standing (or creeping) with her own head in a glow near it: the QA check is on HER head,
        // and she settles up to 0.25 m from P, so a P just clear of a beacon can leave her inside it
        && !(this.spd < 0.5 && this.glowBad(this.pos, true, 15));
      this.pBadT = this.feetOnPerson(goal) || this.depthBad(goal) ? this.pBadT + dt : 0; // (over 0.15 s: not a one-frame flicker)
      if (!pOk && !this.unsolvedNow) {
        if (this.t - this.altAt > 0.15 || !this.altOk) {
          this.altAt = this.t;
          this.altOk = this.inViewLanePoint(goal, this.nearestS(goal, sV), this.alt, still ? 0.92 : 0.8);
        }
        if (this.altOk) { goal.copy(this.alt); this.dbgSrc = 'block-alt'; }
        else if (this.glowBad(goal, true, 40)) {
          // (no in-view point found and P has her head in a live glow: the nearest sideways step at P's distance that
          // clears it, on floor the footage agrees with)
          // (round 9) first the track's own points a few frames either side (solver-checked floor), the nearest whose
          // head point clears every glow, then sideways steps
          let done = false;
          for (const k of [5, -5, 10, -10, 15, -15, 20, -20, 30, -30, 40, -40]) {
            const q = this.blockAt(fT + k, this.tmpE);
            const vq = this.viewBox(q);
            if (this.glowBad(q, true, 40) || vq.inside < 0.9 || vq.camD < 1.9 || vq.h > 0.5) continue;
            // (she must be able to walk there in a straight line: no blocker / rail between)
            let clear = true;
            for (let u = 0.2; u <= 1.001 && clear; u += 0.2) if (this.collides(this.pos.x + (q.x - this.pos.x) * u, this.pos.z + (q.z - this.pos.z) * u, sV)) clear = false;
            if (!clear) continue;
            goal.copy(q); this.dbgSrc = 'block-glowtrack'; done = true; break;
          }
          const e = this.view.camera.matrixWorld.elements, rl = Math.hypot(e[0], e[2]) || 1, rx = e[0] / rl, rz = e[2] / rl;
          for (const d of [0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0]) {
            if (done) break;
            const q = this.tmpE.set(goal.x + rx * d, goal.y, goal.z + rz * d);
            if (this.glowBad(q, true, 40) || this.viewBox(q).inside < 0.9 || this.depthBad(q) || this.collides(q.x, q.z, this.nearestS(q, sV))) continue;
            goal.copy(q); this.dbgSrc = 'block-glowstep'; done = true; break;
          }
          // (boxed between a glow at the frame edge and the velvet rope beside her, f1125: neither the track nor a
          // sideways step clears it. The nearest spot on a grid in front of the camera (2.4-4.6 m out, across the
          // picture) that clears every glow, reads as floor, has no rail on the way; re-chosen ~7 Hz)
          // (only once the visitor has stopped: walking on, her spot moves out of the glow by itself, and a long walk to
          // a far grid spot let the camera catch her up, f1123)
          if (!done && !OFF.has('glowgrid') && this.stillT > 0.3) {
            if (this.t - this.ggAt > 0.15) {
              this.ggAt = this.t; this.ggOk = false;
              const cp = this.view.camera.position, fl = Math.hypot(e[8], e[10]) || 1, fx = -e[8] / fl, fz = -e[10] / fl;
              let bd = 1e9;
              // (the glow's own 40 px margin first; then just clear of it (10 px), as the stop spot is checked)
              for (const m of [40, 10]) for (const d of [2.4, 2.8, 3.2, 3.8, 4.2, 4.6]) for (let l = -1.2; l <= 1.21; l += 0.2) {
                if (this.ggOk && m === 10) break;
                const q = this.tmpE.set(cp.x + fx * d + rx * l, goal.y, cp.z + fz * d + rz * l);
                const c = Math.hypot(q.x - goal.x, q.z - goal.z);
                if (c >= bd) continue;
                const vq = this.viewBoxInto(q, this.szVb2);
                if (vq.inside < 0.9 || vq.h > 0.42 || this.glowBad(q, true, m) || this.collides(q.x, q.z, this.nearestS(q, sV))) continue;
                let clear = true;
                // (no rail between: a bench or curb on the way she steers round)
                for (let u = 0.2; u <= 1.001 && clear; u += 0.2) if (this.railHit(this.pos.x + (q.x - this.pos.x) * u, this.pos.z + (q.z - this.pos.z) * u, sV)) clear = false;
                if (!clear || this.depthBad(q) || this.feetOnPerson(q)) continue;
                bd = c; this.ggPt.copy(q); this.ggOk = true;
              }
            }
            if (this.ggOk) { goal.copy(this.ggPt); this.dbgSrc = 'block-glowgrid'; }
          }
        } // (P's own motion stays the feed-forward: the in-view point is re-chosen near P as it moves)
      } else {
        this.altOk = false;
        // (round 8) P closer than 2.3 m to the camera (the tracking margin above the 1.56 m dissolve is thin while the
        // visitor walks): the same place on screen a little further back along the line of sight, where the footage
        // shows floor and nothing blocks it
        if (vbP.camD < 2.3 && !this.unsolvedNow && !OFF.has('back')) {
          const cp = this.view.camera.position, dx = goal.x - cp.x, dz = goal.z - cp.z, dl = Math.hypot(dx, dz) || 1;
          for (const d of [2.4, 2.6, 2.8]) {
            const q = this.tmpE.set(cp.x + (dx / dl) * d, goal.y, cp.z + (dz / dl) * d);
            const vq = this.viewBox(q);
            if (vq.inside < 0.6 || this.depthBad(q) || this.feetOnPerson(q) || this.glowBad(q, true, 40) || this.collides(q.x, q.z, this.nearestS(q, sV))) continue;
            goal.copy(q); this.dbgSrc = 'block-back'; this.backLocal.copy(q); this.view.camera.worldToLocal(this.backLocal); this.backAt = this.t; break;
          }
          if (this.dbgSrc !== 'block-back' && this.t - this.backAt < 1.5) {
            // (none reads now: she keeps the last valid farther spot, carried with the camera: walking on ahead of the
            // visitor at their pace instead of being walked into and dissolved)
            goal.copy(this.backLocal); this.view.camera.localToWorld(goal); goal.y = this.pos.y; this.dbgSrc = 'block-backhold';
          }
        }
      }
      // (owner: "she should be the same size") her distance along the line of sight is chosen for a steady size on
      // screen (keepSize): same place in the picture, nearer or farther, where the footage agrees
      if (!this.unsolvedNow) this.keepSize(goal, sV, dt, jumpCut || !this.placed || !!c.gliding);
      else this.szK = 1;
      this.pInView = pOk;
      // (at a frame edge with her goal in view, in frame wins: she turns and closes the gap like someone hurrying)
      this.edgeHurry = this.lastVbIn < 0.95 && this.opacity > 0.5 && (pOk || this.altOk || this.plOn);
      // (unsolved camera frames, conf 0, or a solve facing away from the walked floor: no world data. Her goal is
      // carried with the camera at her screen-relative place from the last checked frame; she walks to keep it
      // (facing travel, a walker's limits), so she stays where she was in the picture)
      if (this.unsolvedNow && this.placed && !jumpCut) {
        const cam = this.view.camera;
        if (!this.unsSet) {
          const vb0 = this.viewBox(this.pos);
          if (vb0.inside >= 0.8 && vb0.sx > 0.18 && vb0.sx < 0.82 && vb0.camD >= 2.0 && vb0.h <= 0.48 && this.opacity > 0.5) this.unsLocal.copy(this.pos); // (not kept at a frame edge: jogging into the corridor she was carried along the left edge)
          else {
            // (she was not well in the picture: the default spot, ~3 m ahead and a little to her side, on the floor)
            const fw = this.tmpE.set(0, 0, -1).transformDirection(cam.matrixWorld).setY(0).normalize();
            this.unsLocal.copy(cam.position).addScaledVector(fw, 3.0).add(this.tmpE2.set(-fw.z, 0, fw.x).multiplyScalar(-0.3 * this.side));
            this.unsLocal.y = cam.position.y - this.floor.cam.camera_height_m;
          }
          cam.worldToLocal(this.unsLocal); this.unsSet = true; this.unsPrev.copy(this.pos);
        }
        goal.copy(this.unsLocal); cam.localToWorld(goal); goal.y = this.pos.y;
        // (same size while carried: the carried spot eases along its line of sight into the size band; no world data
        // here, the picture's own ray keeps her where she is on screen)
        if (!OFF.has('size')) {
          const vbC = this.viewBoxInto(goal, this.szVb);
          if (vbC.inside >= 0.5 && vbC.h < 5) {
            // (round 2: carried she lags the turning camera, so the carried spot sits at the band's far end, >= 2.5 m:
            // nearer, the camera walked into her up the plant-room corridor, upstairs f3370-3480)
            const ht = Math.max(0.3, Math.min(0.35, vbC.h));
            const cp = cam.position, dC = vbC.camD, dT = Math.max(c.jog ? 2.7 : 2.5, Math.min(3.6, dC * vbC.h / ht));
            const f = 1 + (dT / Math.max(0.5, dC) - 1) * Math.min(1, dt * 1.5);
            if (Math.abs(f - 1) > 1e-4) {
              goal.x = cp.x + (goal.x - cp.x) * f; goal.z = cp.z + (goal.z - cp.z) * f;
              this.unsLocal.copy(goal); cam.worldToLocal(this.unsLocal);
            }
          }
        }
        const idt = 1 / Math.max(dt, 1e-3), kf = Math.min(1, dt * 10);
        this.unsFF.x += ((goal.x - this.unsPrev.x) * idt - this.unsFF.x) * kf;
        this.unsFF.z += ((goal.z - this.unsPrev.z) * idt - this.unsFF.z) * kf;
        // (round 2: capped at her jog when the visitor jogs: at the walk's 2.3 m/s the carried spot ran away from her up the
        // plant-room corridor (camera ~2.9 m/s), the camera walked into her and she faded, upstairs f3370-3500)
        const capC = c.jog && !OFF.has('carryjog') ? GuideBrain.V_JOG_MAX : 2.3;
        const fl2 = Math.hypot(this.unsFF.x, this.unsFF.z); if (fl2 > capC) this.unsFF.multiplyScalar(capC / fl2);
        this.unsPrev.copy(goal);
        this.blockFF.copy(this.unsFF); this.dbgSrc = 'block-carry';
      } else { this.unsSet = false; this.unsFF.set(0, 0, 0); }
      // (owner: "she still fades ... where the camera gets very close to her") the camera about to reach her and her
      // spot not leading her away from it: she walks (or jogs) on ahead along its line of sight (escapeCam)
      this.escapeCam(goal, sV, dt, jumpCut || !this.placed || !!c.gliding || this.unsolvedNow);
      // (round 2: boxed in by the merch wall) her way to the track runs through furniture: she walks ahead of the
      // visitor along the visitor's own path instead (pathLead)
      this.pathLead(goal, sV, vVis, dt, jumpCut || !this.placed || !!c.gliding || this.unsolvedNow);
      // (user, via coordinator) STOP = HOLD: once the visitor stops scrolling she stays where she is (at the point her
      // walk eases to a stop), facing the way on; she is not walked back to P nor sent to another spot because the
      // still-stance tightens P's checks. The latched spot is kept while it stays acceptable; if it fails for > 0.3 s
      // she makes the smallest move that fixes it. The latch is released as soon as the visitor scrolls again.
      const stoppedNow = this.stopT > 0.05 && Math.abs(c.userFps) < 0.5 && !c.gliding && !jumpCut && this.placed
        && (this.state === 'idle' || this.state === 'follow') && !lantern;
      if (!stoppedNow) { this.holdSet = false; this.holdBadT = 0; this.holdCarried = false; }
      else {
        if (!this.holdSet) {
          // (where she halts at an abrupt walker's stop, ~6 m/s^2 (one braking step), so she never turns back to a passed
          // point)
          const sd = (this.spd * this.spd) / (2 * GuideBrain.ACC_HALT);
          this.holdPos.set(this.pos.x + Math.sin(this.yaw) * sd, this.pos.y, this.pos.z + Math.cos(this.yaw) * sd);
          this.holdFix = false;
          if (!this.holdOk(this.holdPos, sV)) {
            // (her stopping point won't do, e.g. part of her out of frame: she walks straight on to the nearest point
            // ahead that does, in one smooth stop, rather than halting and then creeping to a fix)
            let ok = false;
            for (let d = sd + 0.15; d <= sd + 1.21 && !ok; d += 0.15) {
              const q = this.tmpE.set(this.pos.x + Math.sin(this.yaw) * d, this.pos.y, this.pos.z + Math.cos(this.yaw) * d);
              if (this.holdOk(q, sV)) { this.holdPos.copy(q); ok = true; }
            }
            if (ok) this.holdFix = true; else this.holdPos.copy(this.pos);
          }
          this.holdSet = true; this.holdBadT = 0;
        }
        // (no world data on unsolved frames: nothing to check her spot against, she simply stays)
        this.holdBadT = this.unsolvedNow || this.holdOk(this.holdPos, sV) ? 0 : this.holdBadT + dt;
        if (this.holdBadT > 0.3) {
          { const p = this.holdPos, vb = this.viewBox(p); this.holdWhy = `in${vb.inside.toFixed(2)} d${vb.camD.toFixed(2)} h${vb.h.toFixed(2)} g${+this.glowBad(p, true, 10)} dp${this.depthBad(p)} pp${+this.feetOnPerson(p)} c${+this.collides(p.x, p.z, this.nearestS(p, sV))}`; }
          // (the smallest move that fixes it: sideways / nearer / farther along the line of sight, nearest first)
          const e = this.view.camera.matrixWorld.elements, rl = Math.hypot(e[0], e[2]) || 1, rx = e[0] / rl, rz = e[2] / rl;
          const fl = Math.hypot(e[8], e[10]) || 1, fx = -e[8] / fl, fz = -e[10] / fl;
          let best = 1e9;
          for (let r = 0.25; r <= 1.51 && best > 1e8; r += 0.25) for (const [ax, az] of [[rx, rz], [-rx, -rz], [fx, fz], [-fx, -fz]]) {
            const q = this.tmpE.set(this.holdPos.x + ax * r, this.holdPos.y, this.holdPos.z + az * r);
            if (this.holdOk(q, sV)) { best = r; this.tmpE2.copy(q); break; }
          }
          if (best < 1e8) { this.holdPos.copy(this.tmpE2); this.holdBadT = 0; this.holdMoves++; this.holdFix = true; }
          else if (!OFF.has('holdfar')) {
            // (round 2: nothing within 1.5 m reads, e.g. the picture stepped on and left her spot outside it: her track
            // spot if it reads, else the nearest in-view lane point; she walks there)
            const P = this.blockAt(this.view.frame ?? 0, this.tmpE2);
            if (this.holdOk(P, sV) || this.inViewLanePoint(P, this.nearestS(P, sV), this.tmpE2, 0.9)) { this.holdPos.copy(this.tmpE2); this.holdBadT = 0; this.holdMoves++; this.holdFix = true; }
          }
        }
        // (round 2: on carried stretches (unsolved / the solve slide upstairs 3345-3522) the world itself slides against
        // the footage, so a world-fixed stop spot drifted off the screen as the picture stepped on (head x up to 1649 px
        // of 390). There the spot is held in the camera's frame: she stays where she is in the picture)
        if (this.unsolvedNow && !OFF.has('holdcarry')) {
          const cam = this.view.camera;
          if (!this.holdCarried) {
            const vbH = this.viewBoxInto(this.holdPos, this.szVb2);
            if (vbH.inside >= 0.8 && vbH.sx > 0.18 && vbH.sx < 0.82 && vbH.camD >= 2.0) { this.holdLocal.copy(this.holdPos); cam.worldToLocal(this.holdLocal); }
            else {
              // (her spot is not well in the picture as the carry starts: ~2.8 m ahead, a little to her side)
              const fw = this.tmpE2.set(0, 0, -1).transformDirection(cam.matrixWorld).setY(0).normalize();
              this.holdLocal.copy(cam.position).addScaledVector(fw, 2.8).add(this.tmpE.set(-fw.z, 0, fw.x).multiplyScalar(-0.3 * this.side));
              this.holdLocal.y = cam.position.y - this.floor.cam.camera_height_m;
              cam.worldToLocal(this.holdLocal);
            }
            this.holdCarried = true;
          }
          this.holdPos.copy(this.holdLocal); cam.localToWorld(this.holdPos); this.holdPos.y = this.pos.y;
        } else this.holdCarried = false;
        goal.copy(this.holdPos); this.blockFF.set(0, 0, 0); this.dbgSrc = 'block-hold';
      }
      this.urgent = false; this.panT = 0; this.edgeT = 0;
    } else {
      goal = this.updateAnchor(dt, sV, vVis, rects, jumpCut || !this.placed);
    }
    // feed-forward: how fast her spot itself is moving (the visitor's pace), so walking with you needs no catch-up
    if (this.goalSet && !this.anchorJumped) {
      const k = Math.min(1, dt * 8), idt = 1 / Math.max(dt, 1e-3);
      this.goalVel.x += ((goal.x - this.goalPrev.x) * idt - this.goalVel.x) * k;
      this.goalVel.z += ((goal.z - this.goalPrev.z) * idt - this.goalVel.z) * k;
      const gv = Math.hypot(this.goalVel.x, this.goalVel.z);
      if (gv > 7) this.goalVel.multiplyScalar(7 / gv);
    } else if (this.anchorJumped) this.goalVel.multiplyScalar(0.5);
    this.goalPrev.copy(goal); this.goalSet = true; this.anchorJumped = false;
    if (!this.placed || jumpCut) {
      this.cutAt = this.t;
      // first frame / jump cut (unseen: the picture itself just changed): start at the spot, facing the visitor
      this.pos.copy(goal);
      this.vel.set(0, 0, 0); this.spd = 0; this.goalVel.set(0, 0, 0);
      this.placed = true;
      this.yaw = Math.atan2(this.view.camera.position.x - goal.x, this.view.camera.position.z - goal.z);
      // (round 7) on the track she starts facing the way her track goes on (a half turn on the first step would
      // leave her standing while the visitor walks into her)
      if (this.block && !lantern) {
        const f0 = this.view.frame ?? c.frame, g2 = this.blockAt(f0 + 25, this.tmpBF);
        if (Math.hypot(g2.x - goal.x, g2.z - goal.z) > 0.3) this.yaw = Math.atan2(g2.x - goal.x, g2.z - goal.z);
      }
      this.prevYaw = this.yaw; this.yawV = 0;
      this.stepping = false;
    }
    // waiting stance: after a brief pause (between swipes) she stays ready to walk on; once the visitor has really
    // stopped she turns to face them, angled a little toward the way on (an open stance, not squarely back)
    this.stillT = Math.abs(vVis) < 0.2 ? this.stillT + dt : 0;
    if (this.block && (this.holdSet || this.nudgeFacing) && this.state !== 'tease' && this.state !== 'intro' && this.state !== 'present') {
      // (stop = hold) waiting to walk on: facing the way on (the camera's forward), her back to the visitor; after 60 s
      // without input she has turned round to face them (the nudge); the head still turns to the visitor (lookAt)
      if (!this.nudgeFacing) { const e = this.view.camera.matrixWorld.elements; faceYaw = Math.atan2(-e[8], -e[10]); } // (the camera's forward, now)
    } else if (this.state !== 'tease' && this.state !== 'intro') {
      if (!this.stepping && this.stillT < 1.0) faceYaw = this.yaw;
      else {
        const dOn = angDiff(Math.atan2(this.camFwd.x, this.camFwd.y), faceYaw);
        faceYaw += Math.sign(dOn) * Math.min(this.block ? 1.0 : 0.45, Math.abs(dOn));
      }
    }
    if (this.state === 'tease' && this.teaseStation) {
      // presenting stance (docs/POSTURE.md): beside the work, body angled ~35 deg from the visitor toward it (between
      // visitor and work, never squarely at the work); the animator turns the chest / head the rest of the way
      const st = this.teaseStation.world_position;
      const a1 = Math.atan2(st[0] - this.pos.x, st[2] - this.pos.z);
      const sd = angDiff(a1, faceYaw);
      if (Math.abs(sd) > 0.25 || this.stanceSign === 0) this.stanceSign = Math.sign(sd) || 1; // hysteresis: no swinging
      faceYaw = faceYaw + this.stanceSign * Math.min(0.6, Math.abs(sd) * 0.5);
    }

    // (round 7) the camera closing in on her: how near and how fast (she turns and steps away at once)
    {
      const cp = this.view.camera.position, cdN = Math.hypot(this.pos.x - cp.x, this.pos.z - cp.z);
      const rate = this.prevCamD >= 0 && !jumpCut ? (this.prevCamD - cdN) / Math.max(dt, 1e-3) : 0;
      this.prevCamD = cdN;
      this.closeRate += (Math.max(-5, Math.min(5, rate)) - this.closeRate) * Math.min(1, dt * 10);
      this.closeK = this.block && this.closeRate > 0.3 ? Math.max(0, Math.min(1, (3.0 - cdN) / 0.8)) : 0;
      // (owner: no fading when the camera gets close) already too large on screen (over ~0.43 of it) counts as the
      // camera closing in even while it pauses: she keeps moving out to her spot briskly instead of idling there big
      // (f1780-1794 by the TVs she stood at 0.48-0.5 of the screen until a small camera step dissolved her)
      if (this.block && this.opacity > 0.5 && !OFF.has('bighurry')) this.closeK = Math.max(this.closeK, Math.max(0, Math.min(1, (this.lastVbH - 0.43) / 0.05)));
      const cf = this.tmpE.set(0, 0, -1).transformDirection(this.view.camera.matrixWorld);
      const cy = Math.atan2(cf.x, cf.z);
      const pr = Number.isNaN(this.panYawPrev) || jumpCut ? 0 : angDiff(cy, this.panYawPrev) / Math.max(dt, 1e-3);
      this.panYawPrev = cy;
      this.panRate += (Math.max(-6, Math.min(6, pr)) - this.panRate) * Math.min(1, dt * 8);
    }
    // ---- locomotion: a person walks where they face. Turn toward the way you're going (slowing while the heading is
    // far off), ease in and out of the pace, step around people, and once arrived turn back to face the visitor.
    const camp = this.view.camera.position;
    const visitorMs = Math.abs(c.userFps) * this.stepM;
    // (at a frame edge she hurries back into the picture: a brisk jog, not a stroll)
    // (a walker, unless the visitor presses hard on the walk pad: then a light jog, up to V_JOG_MAX)
    // (slipping out at a frame edge she jogs a few steps back in, instead of trailing her spot out of the picture)
    // (and keeping ahead of a camera that comes on faster than a brisk walk: escapeCam)
    const escJog = this.escDanger && this.camSpd > 1.4 && !OFF.has('escjog');
    this.edgeJog = !OFF.has('edgejog') && !this.onStairs && this.placed && (this.edgeHurry || this.edgeT > 0.05 || escJog) ? Math.min(1, this.edgeJog + dt * 4) : Math.max(0, this.edgeJog - dt * 1.5);
    const jogOn = !!c.jog || this.edgeJog > 0.5;
    const vCap = jogOn ? GuideBrain.V_JOG_MAX : GuideBrain.V_WALK_MAX;
    const vmax = Math.min(vCap, racing ? 5.6 : Math.max(1.6 + this.energy * 0.3, visitorMs * 1.3 + 0.6, this.goalVel.length() * 1.15 + 0.4, this.edgeT > 0.05 ? 3.2 : 0, this.panT > 0 ? 5.0 : 0));
    const toG = new THREE.Vector3(goal.x - this.pos.x, 0, goal.z - this.pos.z);
    const dist = toG.length();
    const ffv = this.goalVel, ffs = Math.hypot(ffv.x, ffv.z);
    // her own place on the path: the floor under her feet, and the lane she walks along to reach her spot
    const sH = this.nearestS(this.pos, sV);
    // waypoint: follow the lane around bends toward a spot further along the path (never cut through a corner's wall)
    const wp = this.tmpW.copy(goal);
    if (laneGoal && !this.aCam && !this.aFix && this.aS >= 0 && Math.abs(this.aS - sH) > 1.0) {
      const latH = this.latOf(this.pos, sH);
      const s1 = sH + Math.sign(this.aS - sH) * 1.0;
      this.lanePoint(s1, this.clampLat(s1, latH + Math.max(-0.5, Math.min(0.5, this.aLat - latH))), wp);
    }
    // arrival with hysteresis: standing at her spot she stays put until it has moved well away (no creeping)
    const bff = this.block ? Math.hypot(this.blockFF.x, this.blockFF.z) : 0;
    if (this.block && !lantern) { if (this.stepping) { if (dist < 0.15 && bff < 0.05) this.stepping = false; } else if (dist > 0.25 || bff > 0.08) this.stepping = true; }
    else if (this.stepping) { if (dist < 0.22 && ffs < 0.15) this.stepping = false; }
    else if (dist > (this.urgent ? 0.3 : 0.5) || (ffs > 0.25 && dist > 0.15)) this.stepping = true;
    const vd = this.tmpVd.set(0, 0, 0);
    if (this.stepping) {
      const near = ffs > 0.5 ? 1 : Math.max(0, Math.min(1, 2.5 - dist)); // walking alongside: match her spot's own speed
      // (a spot coming toward her is walked to, not waited for: the part of its motion back toward her is dropped
      // unless she is already there; at a frame edge the pull to the spot is stronger)
      let ffx = ffv.x * near, ffz = ffv.z * near;
      {
        const gx = wp.x - this.pos.x, gz = wp.z - this.pos.z, gl = Math.hypot(gx, gz);
        if (gl > 0.5) { const al = (ffx * gx + ffz * gz) / gl; if (al < 0) { ffx -= (al * gx) / gl; ffz -= (al * gz) / gl; } }
      }
      const kG = this.block || this.edgeT > 0 || this.panT > 0 ? 2.8 : 2.2;
      if (this.block && !lantern) {
        // on the track: desired velocity = P's own velocity + K (P - x), K 2.5 / s (capped below at 2.3 m/s)
        ffx = this.blockFF.x; ffz = this.blockFF.z;
        const kP = this.edgeHurry ? 4 : 2.5;
        vd.set(ffx + (goal.x - this.pos.x) * kP, 0, ffz + (goal.z - this.pos.z) * kP);
      } else vd.set(ffx + (wp.x - this.pos.x) * kG, 0, ffz + (wp.z - this.pos.z) * kG);
      const vdc: number[] = this.dbgLog ? [ffx, ffz, (wp.x - this.pos.x) * kG, (wp.z - this.pos.z) * kG] : [];
      const mark = () => { if (this.dbgLog) vdc.push(vd.x, vd.z); };
      // step around people and fixed obstacles (she turns to walk round them: steering, never a sideways slide)
      const BL = this.blockers();
      for (let bi = 0; bi < BL.length; bi++) {
        const [bx, bz, br] = BL[bi];
        // (never pushed farther from it than her own spot is: a spot by a bench (the walked path past the merch
        // wall's cubes) left her held 0.6 m off it, the visitor walking into her; ?off=pushcap for the old 0.7 m)
        const gb = Math.hypot(goal.x - bx, goal.z - bz);
        // (nor across the walked line: by the merch wall a cube 0.6 m from it pushed her off the path and out of shot)
        const pd = BL === this.blkEff && bi < this.blkPD.length ? this.blkPD[bi] - 0.05 : 9;
        const dx = this.pos.x - bx, dz = this.pos.z - bz, d = Math.hypot(dx, dz), R = OFF.has('pushcap') ? br + 0.7 : Math.max(br + 0.15, Math.min(br + 0.7, pd, Math.max(br + 0.25, gb)));
        if (d < R && d > 1e-3) {
          // push out, and swing round it on the side her goal is (walk around the bench, not into it)
          const k = ((R - d) / R) * 4, tx = -dz / d, tz = dx / d, side = Math.sign((goal.x - bx) * tx + (goal.z - bz) * tz) || 1;
          vd.x += (dx / d) * k + tx * side * k * 0.8; vd.z += (dz / d) * k + tz * side * k * 0.8;
        }
      }
      mark();
      // rails: never onto / over one (balustrades, the balcony curve); steer back to the walked side
      for (const r of this.nav?.rails ?? []) {
        if (!this.railActive(r)) continue;
        const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
        const tt = ((this.pos.x - ax) * ux + (this.pos.z - az) * uz) / L2;
        if (tt < -0.1 || tt > 1.1) continue;
        const cx = ax + ux * Math.max(0, Math.min(1, tt)), cz = az + uz * Math.max(0, Math.min(1, tt));
        const qx = this.smX[this.frameAtDistance(sH)], qz = this.smZ[this.frameAtDistance(sH)]; // the walked side
        let nx = qx - cx, nz = qz - cz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        const d = (this.pos.x - cx) * nx + (this.pos.z - cz) * nz; // + = on the walked side
        if (d < 0.9) { const k = (0.9 - d) * 4; vd.x += nx * k; vd.z += nz * k; }
      }
      mark();
      // walls / furniture at the lane edges: keep her body inside the measured free lane while she walks
      if (laneGoal && !this.aCam && !this.aFix) {
        const [l0, l1] = this.laneAt(sH), latH = this.latOf(this.pos, sH);
        const i = this.frameAtDistance(sH), a = Math.max(0, i - 6), b = Math.min(this.S.length - 1, i + 6);
        let tx = this.smX[b] - this.smX[a], tz = this.smZ[b] - this.smZ[a]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const push = latH < l0 + 0.25 ? (l0 + 0.25 - latH) * 4 : latH > l1 - 0.25 ? -(latH - (l1 - 0.25)) * 4 : 0;
        if (push) { vd.x += -tz * push; vd.z += tx * push; } // right = (-tz, tx)
      }
      mark();
      if (this.sense) for (const pp of this.sense.people) {
        const dx = this.pos.x - pp.x, dz = this.pos.z - pp.z, d = Math.hypot(dx, dz);
        if (d < 1.1 && d > 1e-3 && Math.hypot(goal.x - pp.x, goal.z - pp.z) > 0.6) { const k = ((1.1 - d) / 1.1) * 1.5; vd.x += (dx / d) * k; vd.z += (dz / d) * k; }
      }
      mark();
      if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), kind: 'vd', c: vdc.map((x) => +x.toFixed(2)), wp: [+(wp.x - this.pos.x).toFixed(2), +(wp.z - this.pos.z).toFixed(2)], g: [+(goal.x - this.pos.x).toFixed(2), +(goal.z - this.pos.z).toFixed(2)] });
      // hard limits on the way she means to walk: near a blocker or a rail, the part of her heading into it goes
      // (she turns to walk along / round it, facing where she goes); the pushes above are only soft
      if (!(this.block && this.unsolvedNow)) this.constrainHeading(vd, goal, sH);
      const vl = Math.hypot(vd.x, vd.z);
      if (vl > vmax && this.block && !lantern) {
        // (round 7) on the track the cap keeps P's own motion and shortens only the correction: she keeps walking
        // with the visitor (never left standing while the camera comes at her) and closes the gap with what is left
        const fx = this.blockFF.x, fz = this.blockFF.z, fl0 = Math.hypot(fx, fz);
        if (fl0 >= vmax) vd.set(fx * vmax / fl0, 0, fz * vmax / fl0);
        else {
          const cx = vd.x - fx, cz = vd.z - fz;
          // |f + k c| = vmax: k = (-(f.c) + sqrt((f.c)^2 - |c|^2 (|f|^2 - vmax^2))) / |c|^2
          const fc = fx * cx + fz * cz, cc = cx * cx + cz * cz || 1e-9;
          const k = Math.max(0, Math.min(1, (-fc + Math.sqrt(Math.max(0, fc * fc - cc * (fl0 * fl0 - vmax * vmax)))) / cc));
          vd.set(fx + cx * k, 0, fz + cz * k);
        }
      } else if (vl > vmax) vd.multiplyScalar(vmax / vl);
    }
    // the targets come from the footage (path progress advances 1-3 decoded frames per render), so the velocity she
    // wants is low-passed (critically damped, ~0.25 s) before it reaches her: the motion on the rig stays continuous
    {
      const kS = 1 - Math.exp(-dt / (this.block ? 0.06 : this.panT > 0 || this.edgeT > 0.05 || this.urgent ? 0.15 : 0.3));
      if (!this.stepping) this.vdS.set(0, 0, 0);
      else this.vdS.x += (vd.x - this.vdS.x) * kS, this.vdS.z += (vd.z - this.vdS.z) * kS;
    }
    const vdl = Math.hypot(this.vdS.x, this.vdS.z);
    const moving = this.stepping && vdl > 0.12;
    const desired = moving ? Math.atan2(this.vdS.x, this.vdS.z) : faceYaw;
    this.dbgFace = desired; this.dbgMoving = moving;
    let err = angDiff(desired, this.yaw);
    // backpedal (round 6c): when the visitor reverses and the way to go is behind her, she first steps back, facing
    // the way she faces, at <= 0.8 m/s for <= 1.5 s (the animator plays the walk in reverse from her motion); if the
    // reversal goes on she turns into a normal walk
    {
      const behindNow = moving && Math.abs(err) > 2.0 && this.block !== null && this.closeK < 0.05;
      // (only from (nearly) standing: her forward pace first eases to zero, so the motion reverses without a jolt)
      if (!this.backT && behindNow && this.spd < 0.08 && this.t - this.backEnd > 1.0) this.backT = 1e-3;
      if (this.backT) {
        this.backT += dt;
        // (ending: she eases to a stop stepping back, then the normal turn-and-walk takes over without a jolt)
        if (this.backT > 1.25 || !moving || Math.abs(err) < 1.4 || vdl > 1.6 || this.closeK > 0.3) this.backEnding = true;
        if (this.backEnding && this.spd < 0.05) { this.backT = 0; this.backEnding = false; this.backEnd = this.t; }
      }
    }
    const backpedal = this.backT > 0;
    // turning round (the way on is nearly behind her): keep turning the way she already turns; near +-180 deg the
    // shorter side flips frame to frame and she would stall facing away
    if (Math.abs(err) > (this.block ? 2.9 : 2.4) && Math.abs(this.yawV) > 0.15 && Math.sign(err) !== Math.sign(this.yawV)) err += Math.sign(this.yawV) * 2 * Math.PI;
    // in a hurry (the visitor is closing in / dashing, her body is at a frame edge or a pan is about to leave her out,
    // or she has fallen behind her spot) she turns and accelerates like a person who has to move NOW
    // (and with her head inside a live glow: she turns and walks out of it briskly, never a slow turn standing in it)
    const hurry = Math.min(1, Math.max(this.urgent ? 1 : 0, this.fastK, this.closeK, this.edgeHurry ? 1 : 0, this.block && this.inGlow ? 1 : 0, this.edgeT > 0.05 || this.panT > 0 ? 1 : 0, ffs > 0.8 && dist > 1.2 ? (dist - 1.2) / 1.5 : 0));
    // turn rate: walking, a person curves at up to ~2.3 rad/s and keeps the sideways (centripetal) acceleration of
    // the curve under ~3.5 m/s^2 (a dash to stay in the picture: ~3.5 rad/s / 4.5 m/s^2); a sharper change of
    // direction is made by slowing to a stepping turn (on the spot, up to 2.4 rad/s, more in a hurry)
    const stepTurn = this.spd < 0.3;
    // (the 0.8 m arc limit gives way only to an escape: the camera closing in, her head inside a live glow, or a
    // frame edge she is about to leave; the 1.56 m dissolve stays the backstop)
    // (round 9, coordinator: in frame outranks curve smoothness) ... or her screen x through the camera of ~0.5 s ahead
    // (15 frames at the shown frame's rate direction) leaves 0.15-0.85
    {
      const fNow = Math.round(this.view.frame ?? c.frame), dir = this.vfRate < 0 ? -1 : 1, nF = this.floor.cam.frames - 1;
      // (her screen x through the cameras of ~0.25 s and ~0.5 s ahead; out of 0.2-0.8 in either, the turn comes first)
      let off = false;
      if (Math.abs(this.vfRate) > 1) for (const k of [15, 30]) {
        const sx = this.screenXAt(this.pos, Math.max(0, Math.min(nF, fNow + dir * k)));
        if (sx === null || sx < 0.2 || sx > 0.8) { off = true; break; }
      }
      this.inGlow = this.glowBad(this.pos, true, 10);
      this.curveFree = OFF.has('curve') || this.closeK > 0.4 || this.edgeHurry || this.inGlow || off || this.lastVbIn < 0.97;
    }
    // in frame wins: at a frame edge or ahead of a pan she turns and curves like someone dodging (still facing travel)
    const edge = this.edgeT > 0 || this.panT > 0.5 ? 1 : 0;
    // (with 4 m/s^2 along: total accel stays under ~6.8 m/s^2; and never more than 0.09 m/s of sideways velocity change
    // in one rendered frame, so a long frame doesn't become a lurch)
    const latMax = Math.min(3.5 + 1.0 * hurry + 1.0 * edge, OFF.has('vel') ? 99 : 0.09 / Math.max(dt, 1e-3));
    const turnRate = stepTurn ? Math.max(0.9, Math.min(2.4, Math.abs(err) * 2.2)) + (racing ? 0.4 : 0) + 3.0 * hurry
      : Math.min(2.3 + 1.2 * Math.max(hurry, racing ? 1 : 0) + 2.0 * edge, latMax / Math.max(0.3, this.spd),
        // (round 8, coordinator) walking, no arc tighter than a 0.8 m radius (yaw <= speed / 0.8, at least 1 rad/s): a
        // sharper turn is made by slowing first, then a stepping turn below 0.3 m/s
        this.block && !this.curveFree ? Math.max(1.0, this.spd / 0.8) : 99);
    // second-order facing: the wanted turn speed (brakes in time to land on the heading, no overshoot), reached
    // through a limited angular acceleration and a short lag, so the turn rate ramps rather than steps
    const turnAcc = 9 + 9 * hurry + 6 * edge;
    let wantW = 0;
    if (backpedal) wantW = 0;
    else if (moving || Math.abs(err) > 0.15 || Math.abs(this.yawV) > 0.05) { // standing: ignore tiny changes (camera sway)
      const stopW = Math.sqrt(2 * turnAcc * 0.8 * Math.abs(err));
      wantW = Math.sign(err) * Math.min(turnRate, stopW, Math.abs(err) * (moving ? 3.0 + 2.0 * hurry + 1.0 * edge : 4.0));
      if (!moving && Math.abs(err) < 0.04) wantW = 0;
    }
    {
      const kW = 1 - Math.exp(-dt / 0.07);
      let dw = (wantW - this.yawV) * kW;
      dw = Math.max(-turnAcc * dt, Math.min(turnAcc * dt, dw));
      this.yawV += dw;
      const step = this.yawV * dt;
      // never past the heading
      if (Math.abs(err) > 1e-4 && Math.sign(step) === Math.sign(err) && Math.abs(step) > Math.abs(err)) { this.yaw += err; this.yawV = err / Math.max(dt, 1e-3) * 0.5; }
      else this.yaw += step;
      err = angDiff(desired, this.yaw);
    }
    // pace: slower while the heading is still far off (turn first, then go), 0 when facing away from where she's going
    // (on the track she curves while walking: pace falls off more gently with the heading error, still along her facing)
    // (gentler fall-off only to escape a camera closing in; otherwise a person slows into a sharp turn)
    const ce = Math.max(0, Math.cos(this.block && !backpedal && (this.closeK > 0.2 || this.curveFree) ? err * 0.7 : err));
    let wantV = moving ? vdl * ce : 0;
    if (this.block && moving && !backpedal && Math.abs(err) > 0.3 && !this.curveFree) {
      // the turn this error asks for (the facing controller wants ~3 x err rad/s) at a 0.8 m radius allows this pace
      wantV = Math.min(wantV, Math.max(0.25, 0.8 * Math.max(1.0, 3.0 / Math.abs(err)) ));
    }
    if (backpedal) wantV = this.backEnding ? 0 : Math.min(0.8, vdl * Math.max(0, -Math.cos(err)));
    // and slow enough for the curve she is on: centripetal accel spd * turn speed stays under latMax
    if (moving && Math.abs(this.yawV) > 0.3) wantV = Math.min(wantV, Math.max(0.25, latMax / Math.abs(this.yawV)));
    // a person walks or jogs, never in between (the animator switches walk <-> jog at 2.6 / 2.2 m/s): she walks up
    // to 2.2 m/s; needing more she breaks into a jog of at least 3 m/s, and drops back to a walk once 2 m/s will do
    // (or she is nearly there)
    // someone is about to pass right in front of / beside her on screen (she'd be drawn over them): she lets them
    // pass, slowing (checked a third of a second ahead on her current line)
    // (not while the camera is closing in on her: slowing there let the visitor walk into her (the proximity fade by
    // the TVs, f1794); she still steers round them (the 1.1 m push above) and keeps clear of the camera)
    if (moving && wantV > 0.4 && this.sense?.people?.length && (this.closeK < 0.3 || OFF.has('closeyield'))) {
      const pr = this.tmpOcc2.set(this.pos.x + this.vel.x * 0.35, this.pos.y, this.pos.z + this.vel.z * 0.35);
      if (this.feetOnPerson(pr) && !this.feetOnPerson(this.pos)) { wantV = Math.min(wantV, Math.max(0.4, this.spd * 0.5)); this.yieldT += dt; }
    }
    // (round 9) her head inside a live glow: she walks out of it in an arc (>= 0.6 m/s, along her facing), never a slow
    // stepping turn standing in the glow
    if (this.block && this.inGlow && moving && !backpedal) wantV = Math.max(wantV, 0.6);
    wantV = Math.min(wantV, vCap);
    // (user: stop on a dime) the visitor has stopped: she halts where she is, in one braking step (the latched spot is
    // her stopping point), unless the spot had to be moved to fix it
    const halting = this.holdSet && !this.holdFix && !backpedal;
    if (halting) wantV = 0;
    // human acceleration: ~2.5 m/s^2 walking, up to ~4 m/s^2 in a hurry (a dash to stay ahead of the camera); never
    // more than 0.1 m/s change in one frame (a dropped frame doesn't become a lurch)
    const accUp = Math.min(4, 2.5 + 1.5 * Math.max(hurry, racing ? 1 : 0));
    const accDn = halting ? GuideBrain.ACC_HALT : racing || hurry > 0.5 ? 4 : 3;
    const dv = wantV - this.spd;
    const spd0 = this.spd;
    // (the change of her velocity vector per frame stays under ~0.115 m/s: speed change and curving share it; a halt
    // may brake at ACC_HALT also on a 30 fps phone)
    const dvMax = OFF.has('vel') ? 0.1 : halting ? Math.max(0.1, GuideBrain.ACC_HALT * Math.min(dt, 0.034))
      : Math.sqrt(Math.max(0.0016, 0.1 * 0.1 - (this.spd * Math.abs(this.yawV) * dt) ** 2));
    this.spd += Math.max(-Math.min(dvMax, accDn * dt), Math.min(Math.min(dvMax, accUp * dt), dv));
    if (this.spd < 0.04 && wantV === 0) this.spd = 0;
    if (this.dbgLog) this.dbgLog.push({ t: +this.t.toFixed(3), kind: 'loco', err: +err.toFixed(2), des: +desired.toFixed(3), yaw: +this.yaw.toFixed(3), vdS: [+this.vdS.x.toFixed(2), +this.vdS.z.toFixed(2)], vdl: +vdl.toFixed(2), vd: +Math.hypot(vd.x, vd.z).toFixed(2), wantV: +wantV.toFixed(2), step: this.stepping, yawV: +this.yawV.toFixed(2), hurry: +hurry.toFixed(2), dist: +dist.toFixed(2) });
    this.vel.set(Math.sin(this.yaw) * this.spd, 0, Math.cos(this.yaw) * this.spd);
    if (backpedal) this.vel.multiplyScalar(-1); // (stepping back: motion against her facing)
    {
      // backstop: a step that would end inside a blocker or on / over a rail is not taken (the heading limit above
      // keeps this from ever showing as a slide)
      const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
      // (a step heading into the margin: she slows at a walker's deceleration while the heading limit turns her;
      // never a stop or a shortened step, which would read as a lurch)
      const ahead = this.collides(this.pos.x + this.vel.x * 0.25, this.pos.z + this.vel.z * 0.25, sH);
      if (!(this.block && this.unsolvedNow) && (ahead || this.collides(nx, nz, sH)) && !this.collides(this.pos.x, this.pos.z, sH)) {
        // (one speed change per frame in all: the backstop's slowing replaces, not adds to, this frame's change)
        this.spd = Math.min(this.spd, Math.max(0, spd0 - Math.min(0.09, 4 * dt)));
        this.vel.set(Math.sin(this.yaw) * this.spd, 0, Math.cos(this.yaw) * this.spd);
        if (wantV > 0.8 && this.spd < 0.3) this.stuckT += dt;
      } else this.stuckT = Math.max(0, this.stuckT - dt * 2);
      this.pos.addScaledVector(this.vel, dt);
    }
    {
      // height = the floor under HER feet: the measured nav floor (seam-smoothed) of the walked-path sample nearest
      // to her in xz (searched -3..+12 m of path around the visitor, so a later pass over the same spot isn't picked),
      // kept inside that sample's +-0.35 m band of path, which holds the stair treads. Directly, every frame: no ramp
      // toward a stale spot's height. (Lantern: no floor to read, the camera's own floor. Where the solve is tilted
      // (conf < 1) a camera-relative spot keeps the floor height measured at it from the footage.)
      const band = this.floorBand(this.pos, sV);
      let ty = this.pos.y;
      if (lantern) ty = goal.y;
      else if (band) ty = Math.max(band[0], Math.min(band[1], this.pos.y));
      else ty = this.floorY[this.frameAtDistance(sH)];
      // (continuity: never more than 1.5 m/s vertically, e.g. where the nearest path sample flips across a seam)
      const dyH = ty - this.pos.y;
      this.pos.y += Math.sign(dyH) * Math.min(Math.abs(dyH), dt * 1.5);
    }
    // out of frame for a moment (a fast fling or a whip pan left her behind): step into her spot unseen, and fade in
    // there rather than visibly sliding back across the frame. Only ever while she is genuinely off screen.
    this.offT = this.fullyOff(this.pos) ? this.offT + dt : 0;
    // overrun: a swipe / fling carries the camera at several times walking pace right into her and she can't get out
    // of the way in time (she'd fill the screen, or the camera would pass through her). She dissolves for a moment
    // (~0.1 s) instead and steps back in at her spot ahead: never a giant close-up, never a visible jump.
    if (this.block) {
      // (round 7) camera-proximity safety: nearer than ~1.5 m (predicted 0.12 s ahead at the closing rate) or taller
      // than ~0.6 of the screen, she dissolves out at once (~2 frames); nearer than 1.3 m she is not drawn at all
      const vb = this.viewBox(this.pos);
      this.lastVbH = vb.h; this.lastVbIn = vb.inside;
      const pred = vb.camD - Math.max(0, this.closeRate) * 0.05; // (one frame of fade takes her below half opacity)
      const tooNear = vb.camD < 1.3;
      // (her height a moment ahead: it grows as 1 / distance while the camera closes in)
      const hPred = vb.h * vb.camD / Math.max(0.5, vb.camD - Math.max(0, this.closeRate) * 0.05);
      // (round 9) hysteresis: for 2.5 s after walking in she is dissolved again only at the bars themselves (the camera
      // about to pass within 1.5 m, or 0.57 of the screen), not at the early margins: no dissolve / walk-in loops
      const recent = this.t - this.reAt < 2.5;
      const gF = this.gesture !== 'none' && this.gesture !== 'talk' ? 1.1 : 1;
      // (user: no vanishing, she walks straight on) only at the hard limits now (QA size bar 0.6, the camera ~1.45 m
      // from her); before that the closing camera makes her hurry ahead (closeK)
      // (stepping aside out of the camera's path (giveway) and already half out of the picture: the size bar no
      // longer applies, only the distance; she leaves the frame at its edge as someone brushing past would)
      const leaving = this.escT > 0 && this.escWay === 1 && vb.inside < 0.5;
      if ((recent ? pred < 1.42 || (!leaving && vb.h * gF > 0.58) || tooNear : pred < 1.45 || (!leaving && hPred * gF > 0.56) || tooNear) && this.opacity > 0.05 && !this.ghost
        // (not while she is out of the picture: nothing to hide there, and no re-placing her)
        && (vb.inside > 0.05 || tooNear)) { this.ghost = true; this.proxDissolves++; this.dbgSrc += '+prox'; this.dbgWhy = pred < 1.56 || tooNear ? 1 : 2; }
      // (boxed in: furniture with no gap between her and her spot (by the merch wall a display table 7 cm from the cube
      // bench, where the solver itself had to jump her). Held by the backstop for 0.5 s with her spot in view and over
      // 1.2 m away she slips past: a quick fade out, stepping back on at her spot, instead of standing there while the
      // camera turns her out of the picture)
      if (this.stuckT > 0.5 && !this.ghost && this.opacity > 0.05 && dist > 1.2 && this.viewBox(goal).inside >= 0.6 && !OFF.has('unstick')) { this.ghost = true; this.stuckT = 0; this.dbgSrc += '+unstick'; }
      this.dbgVb[0] = vb.inside; this.dbgVb[1] = vb.h; this.dbgVb[2] = vb.camD;
      // (walking in: how fast her box comes into the picture; she is not dissolved while she is making progress)
      this.insRate += ((this.prevIns >= 0 ? (vb.inside - this.prevIns) / Math.max(dt, 1e-3) : 0) - this.insRate) * Math.min(1, dt * 8);
      this.prevIns = vb.inside;
      if (tooNear) this.opacity = 0;
      // walk-in re-entry: out of the picture (< 60 % of her box inside while drawn) for 0.35 s, or dissolved, she
      // comes back the way a person walks back into shot: from a floor point just outside the nearest frame edge,
      // walking in toward her goal (P, or the nearest in-view lane point), facing travel. Never a pop-in: she is only
      // moved while no part of her is in the picture.
      this.outT = vb.inside < 0.6 && this.opacity >= 0.5 ? this.outT + dt : 0;
      // (still partly in the picture after 0.35 s, stuck at an edge while her goal is in view: she dissolves out in
      // ~2 frames first, then walks in; never moved while visible)
      const settled = this.t - this.reAt > 2.5; // (just walked in: no edge dissolve for 2.5 s; fully out still re-enters)
      // (user: "she disappears, or comes back from another angle ... she should continue walking straight ahead")
      // no edge dissolve any more: partly out at an edge she walks back into the picture herself (in frame wins: she
      // hurries to her in-view goal); fully out (a pan left her behind) she keeps walking her route and the picture
      // comes back round to her; if she is still fully out after 0.6 s she steps back on at her spot ahead, walking the
      // route forward (a quick fade there), never walking in from a frame edge at another angle
      const waitT = 0.6;
      void settled;
      const hiddenNow = this.ghost && this.opacity < 0.08;
      if (!hiddenNow) this.hidWait = 0;
      // (and just after a cut (the picture itself changed: a jump, a glide) she is not left walking along a frame edge:
      // more than 40 % out for 0.15 s within 1.2 s of the cut, she steps on at her in-view spot)
      const afterCut = this.t - this.cutAt < 1.2 && vb.inside < 0.6 && this.outT > 0.15 && this.t - this.reAt > 0.6;
      const reenter = hiddenNow || afterCut || (this.outT >= waitT && vb.inside <= 0 && (settled || this.t - this.reAt > 0.6));
      if (reenter) {
        const vbG = this.viewBox(goal);
        const okG = vbG.inside >= 0.6 && vbG.camD >= 1.7 && vbG.h <= 0.5;
        // (user: she continues walking straight ahead) she steps back on at her spot ahead (P, or the in-view lane
        // point), facing the way the route goes on, at the visitor's pace, and fades in there in ~0.15 s
        if (okG && !OFF.has('stepon')) {
          this.pos.copy(goal); this.opacity = 0;
          const f0 = this.view.frame ?? c.frame, g2 = this.blockAt(f0 + 25 * (this.vfRate < 0 ? -1 : 1), this.tmpBF);
          const yawOn = Math.hypot(g2.x - goal.x, g2.z - goal.z) > 0.3 ? Math.atan2(g2.x - goal.x, g2.z - goal.z) : this.yaw;
          this.yaw = yawOn; this.prevYaw = yawOn; this.yawV = 0;
          this.spd = Math.min(GuideBrain.V_WALK_MAX, Math.abs(vVis));
          this.vel.set(Math.sin(yawOn) * this.spd, 0, Math.cos(yawOn) * this.spd);
          this.vdS.copy(this.vel); this.stepping = this.spd > 0.15;
          this.backT = 0; this.backEnding = false;
          this.ghost = false; this.quickFade = true; this.hidWait = 0;
          this.outT = 0; this.prevCamD = -1; this.closeRate = 0;
          this.reentries++; this.reAt = this.t; this.dbgSrc += '+stepon';
          if (this.unsolvedNow) this.unsSet = false;
        } else if (OFF.has('stepon') && okG && this.edgeEntry(goal, this.walkInPt)) {
          // (dev ?off=stepon: the old walk-in from the nearest frame edge. round 9 fix: the entry point gets its own
          // vector; edgeEntry's line checks reuse tmpE)
          this.pos.copy(this.walkInPt);
          const yawIn = Math.atan2(goal.x - this.pos.x, goal.z - this.pos.z);
          this.yaw = yawIn; this.prevYaw = yawIn; this.yawV = 0; // (turned while unseen: not a turn on screen)
          this.spd = 1.8;
          this.vel.set(Math.sin(yawIn) * this.spd, 0, Math.cos(yawIn) * this.spd);
          this.vdS.copy(this.vel); this.stepping = true;
          this.backT = 0; this.backEnding = false;
          this.ghost = false; this.opacity = 1; // (outside the picture: unseen until she steps in)
          this.outT = 0; this.prevCamD = -1; this.closeRate = 0;
          this.reentries++; this.reAt = this.t; this.dbgSrc += '+walkin';
          if (this.unsolvedNow) this.unsSet = false; // (re-anchor at the spot she walks in to)
        } else if (hiddenNow) {
          // nothing she could walk in to yet: wait unseen (still); after 0.25 s she fades back in where she stands if
          // she can be seen there at a safe size (never vanished for long)
          this.spd = 0; this.vel.set(0, 0, 0); this.vdS.set(0, 0, 0);
          this.hidWait += dt;
          if (this.hidWait > 0.1 && vb.inside >= 0.6 && vb.camD >= 1.6 && vb.h <= 0.48) { this.ghost = false; this.quickFade = true; this.dbgSrc += '+fadein'; }
        }
      }
    }
    if (!this.block) {
      const pz = this.view.project(this.pos);
      const camD = pz ? pz.z : 0;
      const closing = vVis > 0.6 && (!pz || camD < 1.8); // (at 1.8 m she already fills half the phone screen)
      // (on the blocking track there are no dissolves: the solved track never needs one)
      this.passT = !this.block && closing && dist > 1.5 && this.onScreen(goal) ? this.passT + dt : 0;
      if (this.passT > 0.08 && !this.ghost) this.ghost = true;
      // size guard (always, any pace): her on-screen height never above ~0.6 of the screen while she is drawn. Now
      // (> 0.52) or ~0.2 s ahead at the scroll rate (> 0.58), or the camera at / past her: she dissolves at once
      // (gone in ~2 frames) and a new spot is chosen; she steps in again only at a spot of readable size.
      {
        const fNow = Math.round(this.view.frame ?? 0), rate = this.vVs / Math.max(1e-3, this.stepM);
        const hNow = this.heightAt(this.pos, fNow);
        const fF = Math.abs(rate) > 2 ? Math.max(0, Math.min(this.floor.end ?? this.S.length - 1, fNow + Math.round(rate * 0.15))) : fNow;
        const hFut = fF !== fNow ? this.heightAt(this.pos, fF) : 0;
        this.sizeRisk = !this.block && (hNow > 0.53 || hFut > 0.57);
        if (this.sizeRisk && this.opacity > 0.05) {
          if (!this.ghost) { this.ghost = true; this.lastSearch = -1; this.aBadT = Math.max(this.aBadT, 0.2); this.dbgSrc += '+size'; }
        }
      }
      // (re-placed only at a goal she can be seen at in a readable size)
      const goalOk = this.heightAt(goal, Math.round(this.view.frame ?? 0)) < 0.5;
      if (this.ghost && this.opacity < 0.08 && !goalOk) { this.pos.copy(goal); this.spd = 0; this.vel.set(0, 0, 0); this.vdS.set(0, 0, 0); } // wait unseen at it
      else if (this.ghost && this.opacity < 0.08) {
        this.pos.copy(goal);
        this.spd = Math.min(ffs, vmax);
        this.yaw = this.spd > 0.15 ? Math.atan2(ffv.x, ffv.z) : faceYaw;
        this.prevYaw = this.yaw; this.yawV = 0;
        this.vel.set(Math.sin(this.yaw) * this.spd, 0, Math.cos(this.yaw) * this.spd);
        this.stepping = this.spd > 0.15;
        this.vdS.copy(this.vel);
        this.ghost = false; this.passT = 0; this.offT = 0;
        this.snaps++;
        this.dbgSrc += '+pass';
      } else if (this.ghost && this.passT === 0 && !this.sizeRisk && pz && camD > 1.8) this.ghost = false; // got clear after all
    }
    if (!this.block && this.offT > (this.fastK > 0.5 ? 0.2 : 0.35) && dist > 0.8 && this.onScreen(goal)) {
      this.pos.copy(goal);
      this.spd = Math.min(ffs, vmax);
      this.yaw = this.spd > 0.15 ? Math.atan2(ffv.x, ffv.z) : faceYaw;
      this.prevYaw = this.yaw; this.yawV = 0; // (placed facing that way while unseen: not a turn)
      this.vel.set(Math.sin(this.yaw) * this.spd, 0, Math.cos(this.yaw) * this.spd);
      this.stepping = this.spd > 0.15;
      this.vdS.copy(this.vel);
      this.opacity = Math.min(this.opacity, 0.4); // a quick fade-in, not a pop
      this.offT = 0;
      this.snaps++;
      this.dbgSrc += '+snap';
    }

    // a holdable rail alongside her (within reach and at her floor level): rest the near hand on it
    this.railAt = null;
    if (this.spd > 0.2 && this.spd < 3.5 && !this.navAt(sH)?.stairs && !this.onStairs) {
      let best: THREE.Vector3 | null = null, bd = 0.8, side = 'right';
      for (const r of this.nav?.rails ?? []) {
        if (!r.holdable) continue;
        const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
        const tt = Math.max(0, Math.min(1, ((this.pos.x - ax) * ux + (this.pos.z - az) * uz) / L2));
        // (the rail's stored floor heights don't line up with the path's floor everywhere; its position and its
        // height above the floor are reliable, so the hand goes to her floor + rail height)
        const dh = Math.hypot(ax + ux * tt - this.pos.x, az + uz * tt - this.pos.z);
        if (dh < bd) { bd = dh; side = r.side; best = new THREE.Vector3(ax + ux * tt, this.pos.y + Math.max(0.85, Math.min(1.0, r.height)), az + uz * tt); }
      }
      if (best) {
        this.railAt = best;
        // the rail's side is relative to the forward walking direction; walking back, it's the other hand
        const fwdSide = side === 'right' ? 'Right' : 'Left';
        const tg = new THREE.Vector2();
        this.lanePoint(sH, 0, this.tmpQ, tg);
        const back = Math.sin(this.yaw) * tg.x + Math.cos(this.yaw) * tg.y < 0; // walking against the path direction
        this.railSide = back ? (fwdSide === 'Right' ? 'Left' : 'Right') : fwdSide;
      }
    }
    const speed = this.spd;
    const yawRate = angDiff(this.yaw, this.prevYaw) / Math.max(dt, 1e-3);
    this.prevYaw = this.yaw;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.rig.root.updateMatrixWorld(true);
    {
      const pf = this.view.project(this.pos), ph = this.view.project(this.tmp.copy(this.pos).setY(this.pos.y + 1.6));
      if (pf && ph) {
        const tilt = Math.atan2(ph.x - pf.x, pf.y - ph.y); // screen-space lean
        const lim = 0.052;
        if (Math.abs(tilt) > lim) {
          const corr = tilt - Math.sign(tilt) * lim;
          const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.view.camera.quaternion); // toward the viewer: positive = counter-clockwise on screen
          const q = new THREE.Quaternion().setFromAxisAngle(axis, corr);
          this.rig.root.quaternion.premultiply(q);
          this.rig.root.updateMatrixWorld(true);
        }
      }
    }
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // (stepping back: a normal positive speed; the animator reads the direction from her motion vs her facing)
    const along = this.backT > 0 ? Math.hypot(this.vel.x, this.vel.z) : Math.max(0, this.vel.x * fwd.x + this.vel.z * fwd.z);

    // stairs: floor slope along her facing
    const fAhead = this.frameAtDistance(this.S[f] + 3.4);
    const fBack = this.frameAtDistance(this.S[f] + 2.4);
    const slope = (this.floorY[fAhead] - this.floorY[fBack]) / Math.max(0.3, this.S[fAhead] - this.S[fBack]);

    // ---- gestures
    if (this.t > this.gestureUntil) this.gesture = 'none';
    if (this.state === 'follow') {
      // (only with free hands: it used to cut a wave at a guest short after ~0.2 s)
      if (this.t - this.lastLookBack > 9 && speed < 2.2 && speed > 0.3 && this.gesture === 'none' && !this.passOn && !(this.waveAt && this.t < this.waveUntil)) {
        this.lastLookBack = this.t;
        this.setGesture('lookBack', 1.1);
        setTimeout(() => { if (this.state === 'follow' && this.gesture === 'lookBack') this.setGesture('beckon', 1.4); }, 1100);
      }
    } else if (this.state === 'idle') {
      if (c.idle > 6 && !this.suggested && this.energy < 0.5) {
        this.suggested = true;
        const next = this.nextStation(f);
        if (next) {
          const dist = Math.max(1, Math.round(this.S[Math.min(next.click_frame, this.S.length - 1)] - this.S[f]));
          this.say(this.lines.suggest_next.replace('{title}', next.title).replace('{distance}', `${dist} m`), 4);
          this.setGesture('beckon', 2.2);
        } else {
          // upstairs has no beacons: skip the lines that talk about them
          const idle = this.lines.idle.filter((l) => this.floor.id === 'downstairs' || !/beacon|glow|station/i.test(l));
          if (idle.length) this.say(pick(idle), 3.5);
          this.setGesture('talk', 2.5);
        }
      } else if (this.t > this.nextFidget && this.gesture === 'none') {
        this.setGesture(pick(['fidgetHeadband', 'lookAround', 'tapFoot', 'handOnHip'] as Gesture[]), 2.6);
        this.nextFidget = this.t + 7 + Math.random() * 5;
      }
      if (c.idle < 1) this.suggested = false;
      // (user, via coordinator) after 60 s without input she turns round on the spot to the visitor, then nudges them
      // on with a beckon; again at most every 45 s while they stay idle
      if (this.block && c.idle >= 60 && this.t - this.lastNudgeT >= 45 && !this.nudgePending) { this.nudgeFacing = true; this.nudgePending = true; }
      if (this.nudgePending) {
        const toCam = Math.atan2(camp.x - this.pos.x, camp.z - this.pos.z);
        if (Math.abs(angDiff(toCam, this.yaw)) < 0.5 && Math.abs(this.yawV) < 0.5) {
          const next = this.nextStation(f);
          const ls = (this.lines.nudge ?? ["Hey! Still with me? Let's keep going."]).filter((l) => (next || !l.includes('{title}')) && l !== this.lastNudge);
          const line = pick(ls.length ? ls : ["Hey! Still with me? Let's keep going."]);
          this.lastNudge = line;
          this.say(next ? line.replace('{title}', next.title) : line, 4);
          this.setGesture('beckon', 2.2);
          this.lastNudgeT = this.t; this.nudgePending = false; this.nudges++;
        }
      }
    } else if (this.state === 'tease') {
      if (speed < 1.2) this.gesture = 'point';
    } else if (this.state === 'race') {
      const waiting = speed < 0.3 && dist < 0.8;
      if (waiting) {
        if (this.waitSince < 0) this.waitSince = this.t;
        if (this.t - this.waitSince > 0.4) this.gesture = 'waveBig';
        if (!this.saidWait && this.t - this.waitSince > 1.4) { this.saidWait = true; this.say(pick(this.lines.race_wait ?? ['Catch up!']), 2.6); }
      } else this.waitSince = -1;
    }
    if (partyZone && speed < 0.35 && this.state !== 'tease' && (this.gesture === 'none' || this.gesture === 'talk' || this.gesture === 'fidgetHeadband' || this.gesture === 'tapFoot' || this.gesture === 'lookAround' || this.gesture === 'handOnHip')) this.gesture = 'dance';
    if (this.block && this.gesture === 'dance' && this.lastVbH > 0.4) this.gesture = 'none';
    if (this.talking && this.gesture === 'none' && speed < 0.3 && this.state !== 'tease') this.gesture = 'talk';
    this.quips(c, speed);
    this.greet(c, speed);
    this.passBy(c, speed);

    // ---- fade
    const vis = this.state === 'hidden' || c.inTransition || this.ghost ? 0 : 1;
    this.opacity += (vis - this.opacity) * Math.min(1, dt * (vis ? (this.quickFade ? 20 : 6) : this.ghost ? 50 : 22));
    if (this.opacity > 0.95) this.quickFade = false;
    guideUniforms.uOpacity.value = this.opacity;
    this.rig.pool.visible = this.inDark;
    (this.rig.pool.material as THREE.MeshBasicMaterial).opacity = 0.55 * this.opacity;
    this.rig.root.visible = this.opacity > 0.02;

    // point where the station is ON SCREEN: flatten the aim toward the image plane, or an arm aimed at a work
    // that's beyond her points straight away from the camera and disappears behind her body
    let pointAt: THREE.Vector3 | undefined;
    if (this.teaseStation) {
      const cam = this.view.camera, inv = cam.matrixWorldInverse;
      const sc = new THREE.Vector3().fromArray(this.teaseStation.world_position).applyMatrix4(inv);
      const hc = this.tmp.copy(this.pos).setY(this.pos.y + 1.3).applyMatrix4(inv);
      const d = sc.sub(hc);
      d.z = 0;
      if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
      d.normalize();
      d.y = Math.max(-0.2, Math.min(0.35, d.y));
      d.z = 0.45; // out toward the visitor: the arm extends in front of her body, never behind it
      const aim = hc.clone().addScaledVector(d.normalize(), 2).applyMatrix4(cam.matrixWorld);
      pointAt = this.rig.root.worldToLocal(aim);
    }
    // companion pose: point at the station, but keep her face toward the visitor (a 25% glance at the station)
    const camL = this.rig.root.worldToLocal(camp.clone());
    let lookAt = this.state === 'tease' && pointAt && this.gesture === 'point' ? camL.clone().lerp(pointAt.clone().setY(camL.y), 0.25) : camL;
    if (this.waveAt && this.t < this.waveUntil) lookAt = this.rig.root.worldToLocal(this.waveAt.clone()); // (she looks at who she waves to)
    this.anim.update({
      dt, speed: along, yawRate, slope: Math.max(-0.2, Math.min(0.8, slope)),
      railAt: this.railAt ? this.rig.root.worldToLocal(this.railAt.clone()) : undefined, railSide: this.railSide,
      stairs: !!this.navAt(this.nearestS(this.pos, this.S[f] ?? 0))?.stairs,
      gesture: this.gesture, pointAt, lookAt, hop: this.hopReq && !this.onStairs, talking: this.talking, mood: this.mood, energy: this.energy,
      jog: (!!c.jog || this.edgeJog > 0.5) && !this.onStairs,
      // (owner) walking into the dance room she dances as she walks, to the beat
      groove: this.partyNow && !OFF.has('groove') ? 1 : 0, beat: c.beat,
      pass: this.passOn ? 1 : 0, passAt: this.passOn ? this.rig.root.worldToLocal(this.passLocal.set(this.passX, this.pos.y + 1.0, this.passZ)) : undefined,
    });
    this.hopReq = false;
  }

  /**
   * (owner) Light remarks while walking: people in her way, the visitor taking it slow, breaking into a jog. Warm and
   * never at anyone's expense (the crowd is the event's success; a slow visitor is savouring it). At most one every
   * 30 s, each kind on its own longer cooldown, never over another line, never in the intro or at a station.
   */
  private quips(c: BrainContext, speed: number) {
    const dt = c.dt, fps = this.floor.meta.fps;
    this.yieldT = Math.max(0, this.yieldT - dt * 0.5);
    // people right in front of her while she walks (within 2.4 m, inside ~45 degrees of her heading)
    let ahead = 0;
    if (this.sense && speed > 0.4) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      for (const pp of this.sense.people) {
        const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.5 && d < 2.4 && (dx * fx + dz * fz) / d > 0.7) ahead++;
      }
    }
    this.crowdT = ahead > 0 || this.yieldT > 0.3 ? this.crowdT + dt : Math.max(0, this.crowdT - dt);
    // the visitor walking forward, but slowly (under ~0.45x the filmed pace), for a while
    const fwd = c.userFps;
    this.slowT = fwd > 1.5 && fwd < fps * 0.45 && !c.gliding ? this.slowT + dt : Math.max(0, this.slowT - dt * (fwd > fps * 0.45 ? 2 : 0.3));
    const jogStart = !!c.jog && !this.wasJog && speed > 1.8;
    if (!c.jog || speed > 1.8) this.wasJog = !!c.jog;
    const free = this.placed && this.opacity > 0.8 && this.t > 25 && !c.open && !c.inTransition && !c.gliding && !c.live.length
      && (this.state === 'follow' || this.state === 'idle') && !this.busy() && this.t - this.quipAt > 30 && this.quipN < 8;
    if (!free) return;
    const L = this.lines;
    const fire = (kind: 'crowd' | 'slow' | 'jog', cool: number) => {
      const ls = L[kind];
      if (!ls?.length || this.t - (this.quipLast.get(kind) ?? -999) < cool) return false;
      this.say(pick(ls), 3.4);
      this.quipAt = this.t; this.quipLast.set(kind, this.t); this.quipN++;
      return true;
    };
    if (jogStart && fire('jog', 90)) return;
    if (this.crowdT > 1.2 && fire('crowd', 45)) { this.crowdT = 0; return; }
    if (this.slowT > 8 && fire('slow', 75)) this.slowT = 0;
  }

  /**
   * (owner: "have her wave at people randomly, but not excessively") now and then she waves at a guest she is passing:
   * someone 1.2-4.5 m away in front of her, looking at them as she does. At most one every 25-45 s (random) and 6 a
   * visit, not in the first 30 s, not at a station, while talking, in the dance room or busy with another gesture.
   */
  private greet(c: BrainContext, speed: number) {
    if (OFF.has('greet') || !this.sense || this.waves >= 6) return;
    if (!(this.placed && this.opacity > 0.8 && this.t > 30 && this.t > this.nextWave && !c.open && !c.inTransition && !c.gliding && !c.live.length
      && (this.state === 'follow' || this.state === 'idle') && this.gesture === 'none' && !this.talking && !this.partyNow && !this.onStairs && speed < 2.2)) return;
    if (Math.random() > c.dt * 0.35) return; // (eligible: on average ~3 s until she picks someone)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let best: { x: number; z: number } | null = null, bd = 9;
    for (const pp of this.sense.people) {
      const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.2 || d > 4.5 || (dx * fx + dz * fz) / d < 0.2) continue;
      if (d < bd) { bd = d; best = pp; }
    }
    if (!best) return;
    this.waveAt = new THREE.Vector3(best.x, this.pos.y + 1.45, best.z);
    this.setGesture('wave', 1.5);
    this.waveUntil = this.t + 1.7;
    this.waves++;
    this.nextWave = this.t + 25 + Math.random() * 20;
  }
  /**
   * (owner: "as she walks by people, have her slowly hover her hand past them, to get by politely") passing close
   * beside someone (0.35-1.5 m to her side, up to 2 m ahead of her, walking 0.4-2.2 m/s) she now and then raises the hand
   * on their side a little, palm down / out, keeps it there while she slips past (until they are ~0.5 m behind her,
   * at most 2.6 s), then lowers it. Gentle and occasional: about two passes in three, then 14-26 s before the next,
   * at most 12 a visit; never while waving or with another gesture, presenting, talking at a station, on the stairs,
   * in the dance room or while the visitor is stopped.
   */
  private passBy(c: BrainContext, speed: number) {
    const se = this.sense;
    const ok = !OFF.has('passhand') && !!se && this.placed && this.opacity > 0.8 && !c.open && !c.inTransition && !c.gliding
      && (this.state === 'follow' || this.state === 'idle') && this.gesture === 'none' && !(this.waveAt && this.t < this.waveUntil)
      && !this.partyNow && !this.onStairs && !this.teaseStation && speed > 0.4 && speed < 2.2 && !this.holdSet;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (this.passOn) {
      // follow the same person (the nearest to where they were), until they are behind her
      let bd = 1.0, found = false;
      for (const pp of se?.people ?? []) {
        const d = Math.hypot(pp.x - this.passX, pp.z - this.passZ);
        if (d < bd) { bd = d; this.passX = pp.x; this.passZ = pp.z; found = true; }
      }
      const dx = this.passX - this.pos.x, dz = this.passZ - this.pos.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (!ok || !found || along < -0.5 || lat > 1.7 || this.t - this.passStart > 2.6) { this.passOn = false; this.nextPass = this.t + 14 + Math.random() * 12; }
      return;
    }
    if (!ok || this.t < this.nextPass || this.passN >= 12 || this.t < 10) return;
    let best = -1, bl = 9;
    const P = se!.people;
    for (let i = 0; i < P.length; i++) {
      const dx = P[i].x - this.pos.x, dz = P[i].z - this.pos.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along < 0 || along > 2.0 || lat < 0.35 || lat > 1.5) continue;
      if (Math.hypot(along, lat) < bl) { bl = Math.hypot(along, lat); best = i; }
    }
    if (best < 0) return;
    // (not every time: about two in three; a skipped pass waits a few seconds)
    if (Math.random() > 0.67) { this.nextPass = this.t + 4; return; }
    this.passOn = true; this.passStart = this.t; this.passN++;
    this.passX = P[best].x; this.passZ = P[best].z;
  }
  private passOn = false;
  private passStart = 0;
  private nextPass = 0;
  passN = 0; // (diagnostics) pass-by hands this visit
  private passX = 0;
  private passZ = 0;
  private passLocal = new THREE.Vector3();
  private waveAt: THREE.Vector3 | null = null;
  private waveUntil = 0;
  private nextWave = 0;
  private waves = 0;

  /** No hopping on stairs (both feet would leave the steps). */
  private get onStairs() {
    const f = Math.round(this.view.frame ?? 0), n = this.floorY.length;
    if (!n) return false;
    const a = this.floorY[Math.max(0, f - 15)], b = this.floorY[Math.min(n - 1, f + 45)];
    return Math.abs(b - a) > 0.25;
  }

  /** 0..1: how close the straight line from where she is to p passes to anyone standing there. */
  private crossesPeople(p: THREE.Vector3) {
    let worst = 0;
    const ax = this.pos.x, az = this.pos.z, bx = p.x - ax, bz = p.z - az, L2 = bx * bx + bz * bz || 1;
    for (const [cx, cz, cr] of this.blockers()) {
      const t = Math.max(0, Math.min(1, ((cx - ax) * bx + (cz - az) * bz) / L2));
      if (Math.hypot(ax + bx * t - cx, az + bz * t - cz) < cr) worst = Math.max(worst, 2.5); // path cuts through an obstacle
    }
    if (!this.sense) return worst;
    for (const pp of this.sense.people) {
      const t = Math.max(0, Math.min(1, ((pp.x - ax) * bx + (pp.z - az) * bz) / L2));
      const d = Math.hypot(ax + bx * t - pp.x, az + bz * t - pp.z);
      if (d < 0.6) worst = Math.max(worst, 1 - d / 0.6);
    }
    return worst;
  }

  /** Somewhere a person could stand: not inside a blocker (with a margin), not beyond / on a rail, not on a person. */
  /** [min, max] nav floor_y of the walked-path sample nearest to p (xz) and its +-0.35 m band of path. */
  private floorBand(p: THREE.Vector3, sV: number, out?: [number, number]): [number, number] | null {
    const N = this.nav?.samples;
    if (!N || N.length < 2) return null;
    let lo = 0, hi = N.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (N[m].s < sV - 3) lo = m; else hi = m; }
    let best = -1, bd = 1e18;
    for (let i = lo; i < N.length && N[i].s <= sV + 12; i++) {
      const f = Math.min(this.smX.length - 1, N[i].f), dx = this.smX[f] - p.x, dz = this.smZ[f] - p.z, d = dx * dx + dz * dz;
      if (N[i].s >= sV - 3 && d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    const s0 = N[best].s;
    let mn = 1e9, mx = -1e9;
    for (let i = Math.max(0, best - 6); i <= Math.min(N.length - 1, best + 6); i++) {
      if (Math.abs(N[i].s - s0) <= 0.35) { mn = Math.min(mn, N[i].floor_y); mx = Math.max(mx, N[i].floor_y); }
    }
    if (out) { out[0] = mn; out[1] = mx; return out; }
    return [mn, mx];
  }

  /** Rails are measured from the frames they were seen in; the solve drifts, so a rail only counts near those frames. */
  private railActive(r: { frames: number[]; active?: number[] }) {
    const f = this.view.frame ?? 0, a = r.active ?? [r.frames[0] - 300, r.frames[1] + 300];
    return f >= a[0] && f <= a[1];
  }

  private standable(p: THREE.Vector3, people = true) {
    for (const [bx, bz, br] of this.blockers()) if ((p.x - bx) ** 2 + (p.z - bz) ** 2 < (br + 0.3) ** 2) return false;
    if (people) for (const pp of this.sense?.people ?? []) if ((p.x - pp.x) ** 2 + (p.z - pp.z) ** 2 < 0.81) return false; // 0.9 m
    const rails = this.nav?.rails;
    if (rails?.length) {
      const sQ = this.nearestS(p, this.S[Math.round(this.view.frame ?? 0)] ?? 0), fq = this.frameAtDistance(sQ);
      const qx = this.smX[fq], qz = this.smZ[fq]; // the walked path near p: always the inside of any rail
      for (const r of rails) {
        if (!this.railActive(r)) continue;
        const ax = r.a[0], az = r.a[2], ux = r.b[0] - ax, uz = r.b[2] - az, L2 = ux * ux + uz * uz || 1;
        const t = ((p.x - ax) * ux + (p.z - az) * uz) / L2;
        if (t < -0.15 || t > 1.15) continue;
        const sp = ux * (p.z - az) - uz * (p.x - ax), sq = ux * (qz - az) - uz * (qx - ax);
        const dist = Math.abs(sp) / Math.sqrt(L2);
        const clear = (r as { drop?: boolean }).drop ? 0.6 : 0.45; // a balustrade with a drop behind it: keep well back
        if (dist < clear || (Math.sign(sp) !== Math.sign(sq) && Math.abs(sq) > 1e-6)) return false; // on it, or over it
      }
    }
    return true;
  }

  /** Would a guide standing at p cover a live station's glow (screen box overlap)? */
  private overGlow(p: THREE.Vector3, rects: BrainContext['stationRects']) {
    if (!rects.length) return false;
    const a = this.view.project(p), b = this.view.project(this.tmp.copy(p).setY(p.y + 1.62));
    if (!a || !b) return false;
    const hgt = a.y - b.y, x0 = Math.min(a.x, b.x) - hgt * 0.18, x1 = Math.max(a.x, b.x) + hgt * 0.18;
    return rects.some((r) => !(x1 < r.x0 || x0 > r.x1 || a.y < r.y0 || b.y > r.y1));
  }

  /**
   * Would the footage hide her at p (the occlusion shader's own test: scene depth more than ~0.9 m nearer than her at
   * her hips / chest / head)? Through a doorway, behind the wall corner, behind someone passing the camera.
   */
  /**
   * Would her feet be drawn over a person who stands farther away than she does (so she'd look like she's standing
   * on their head / body)? Checks the person mask just around her feet in the footage, at that person's depth.
   */
  private feetOnPerson(p: THREE.Vector3) {
    const se = this.sense;
    if (!se?.ready || !se.floor) return false;
    const o = { u: 0, v: 0, z: 0 };
    for (const [dx, hy] of [[0, 0.03], [-0.15, 0.03], [0.15, 0.03], [0, 0.25]]) {
      const r = se.toImage(this.tmpOcc.set(p.x + dx, p.y + hy, p.z), o);
      if (!r) continue;
      const k = se.cell(r.u, r.v);
      if (k < 0 || se.mask[k] < 0.45) continue;
      if (se.metric(se.depth[k]) > r.z + 0.25) return true; // a person behind her, under her feet on screen
    }
    // ...or a person nearer the camera than her overlapping her silhouette on screen whom the occlusion shader would
    // NOT hide her behind (nearer by less than its ~0.3 m person margin): she'd be drawn over them. Every sense cell
    // inside her screen box (skirt and arms included, ~0.6 m wide) is checked.
    const f0 = se.toImage(this.tmpOcc.set(p.x, p.y, p.z), o);
    if (!f0) return false;
    const fu = f0.u, fv = f0.v, zf = f0.z;
    const h0 = se.toImage(this.tmpOcc.set(p.x, p.y + 1.62, p.z), o);
    if (!h0) return false;
    const hv = h0.v, cam = se.floor.cam, fxn = cam.intrinsics.fx;
    const halfU = (0.3 * fxn) / zf; // her half-width in image u at her depth
    const GWn = 36, GHn = 64;
    const i0 = Math.max(0, Math.floor((fu - halfU) * GWn)), i1 = Math.min(GWn - 1, Math.floor((fu + halfU) * GWn));
    const j0 = Math.max(0, Math.floor(hv * GHn)), j1 = Math.min(GHn - 1, Math.floor(fv * GHn));
    let bad = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * GWn + i;
      if (se.mask[k] < 0.45) continue;
      const zo = se.metric(se.depth[k]);
      if (zo < zf - 0.1 && zo > zf - 0.4) bad++; // (nearer by more than ~0.3 m the shader hides her behind them: meshy.ts)
    }
    return bad >= 2;
  }
  /** Does the footage show a drop (floor far below / beyond) within ~0.6 m of p? Balcony edges, glass balustrades. */
  private nearDrop(p: THREE.Vector3) {
    const se = this.sense;
    if (!se?.ready || !se.floor) return false;
    const o = { u: 0, v: 0, z: 0 };
    for (const [dx, dz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.42, 0.42], [-0.42, 0.42], [0.42, -0.42], [-0.42, -0.42]]) {
      const r = se.toImage(this.tmpOcc.set(p.x + dx, p.y + 0.03, p.z + dz), o);
      if (!r || r.z > 6) continue;
      const k = se.cell(r.u, r.v);
      if (k < 0 || se.mask[k] > 0.45) continue;
      if (se.metric(se.depth[k]) > r.z * 1.5 + 0.6) return true;
    }
    return false;
  }
  private tmpOcc = new THREE.Vector3();
  /**
   * Does the footage depth disagree with her standing at p? Ratios of footage depth to her own distance (people cells
   * excluded, as the audit does): at the feet (+-0.12 m across) nearer than 0.62 (feet inside / behind an object) or
   * farther than 1.65 (floor far behind: on air, looks too large); at the torso (0.55 / 0.95 / 1.3 m) nearer than
   * 0.68 (in front of a wall she is behind). Returns the reason or ''.
   */
  depthBad(p: THREE.Vector3) {
    const se = this.sense;
    if (!se?.ready || !se.floor) return '';
    const o = { u: 0, v: 0, z: 0 }, cr = this.tmpCr;
    { const e = this.view.camera.matrixWorld.elements; const l = Math.hypot(e[0], e[2]) || 1; cr.set(e[0] / l, 0, e[2] / l); }
    const ratio = (x: number, y: number, z: number) => {
      const r = se.toImage(this.tmpOcc.set(x, y, z), o);
      if (!r) return NaN;
      const k = se.cell(r.u, r.v);
      if (k < 0 || se.mask[k] > 0.45) return NaN;
      return se.metric(se.depth[k]) / r.z;
    };
    const med = (a: number[]) => { const b = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
    const feet = med([-0.12, 0, 0.12].map((d) => ratio(p.x + cr.x * d, p.y + 0.05, p.z + cr.z * d)));
    if (feet < 0.62) return 'feet-behind';
    if (feet > 1.65 && !this.onStairs) return 'on-air';
    const torso = med([[0.55, 0], [0.95, 0], [1.3, 0], [0.95, -0.12], [0.95, 0.12]].map(([h, d]) => ratio(p.x + cr.x * d, p.y + h, p.z + cr.z * d)));
    if (torso < 0.68) return 'through-wall';
    return '';
  }
  private depthBadT = 0;
  private tmpOcc2 = new THREE.Vector3();
  static readonly V_WALK_MAX = 2.3;
  static readonly RETIME_DMAX = 0.24; // m along her track per 5 footage frames (retime)
  static readonly V_JOG_MAX = 3.6; // (owner: a hard press jogs) her light jog
  static readonly ACC_HALT = 6; // (stop on a dime) braking when the visitor stops: one abrupt walker's step
  private backT = 0;
  private backEnding = false;
  private backEnd = -9;
  private lastVf = -1;
  private vfRate = 0;
  private blockFF = new THREE.Vector3();
  private tmpBF = new THREE.Vector3();
  private wasGliding = false;
  private personT = 0;
  private tmpCr = new THREE.Vector3();
  // ---- round 7: camera-proximity safety, walk-in re-entry, unsolved-frame carry
  private unsolvedNow = false;
  private unsolved = new Uint8Array(0);
  private unsSet = false;
  private unsLocal = new THREE.Vector3();
  private unsPrev = new THREE.Vector3();
  private unsFF = new THREE.Vector3();
  private pInView = true;
  private alt = new THREE.Vector3();
  private altOk = false;
  private altAt = -9;
  private outT = 0; // seconds her body box has been mostly (> 40 %) outside the picture while drawn
  private prevCamD = -1;
  private closeK = 0; // 0..1: the camera is closing in on her (turn / step away now)
  private closeRate = 0; // m/s, smoothed: how fast the camera's ground distance to her shrinks
  reentries = 0;
  edgeDissolves = 0;
  private reAt = -9;
  private panRate = 0; // rad/s, smoothed camera yaw rate (+ = turning left)
  private panYawPrev = NaN;
  private lastVbH = 0;
  private hidWait = 0;
  private cutAt = -9; // (brain time of the last jump cut / placement)
  private holdSet = false;
  private holdPos = new THREE.Vector3();
  private holdLocal = new THREE.Vector3();
  private holdCarried = false;
  private holdBadT = 0;
  holdMoves = 0;
  holdWhy = ''; // (debug) the check the latched stop spot failed, last fix-up
  dbgFace = 0;
  dbgMoving = false;
  nudges = 0;
  private nudgeFacing = false;
  private nudgePending = false;
  private lastNudgeT = -1e9;
  private lastNudge = '';
  /** (stop = hold) The latched spot is acceptable: in view, readable size, clear of glows, walls, people, blockers. */
  private holdOk(p: THREE.Vector3, sV: number) {
    const vb = this.viewBox(p);
    return vb.inside >= 0.85 && vb.camD >= 1.9 && vb.h <= 0.5 && !this.glowBad(p, true, 10) && !this.depthBad(p) && !this.feetOnPerson(p)
      && !this.collides(p.x, p.z, this.nearestS(p, sV));
  }
  // ---- (owner: "she should be the same size") size keeper
  /** The band her on-screen height (feet to 1.70 m, fraction of the screen height) is kept in: ~0.33-0.40 (phone
   * portrait and desktop alike: the picture's height is the screen's on both; at ~2.2-2.7 m from the camera; round 2: was 0.31-0.38,
   * which a head-to-feet measure read as 0.28-0.35, below the middle of the owner's 0.30-0.40). */
  private readonly sizeLo = 0.33;
  private readonly sizeHi = 0.40;
  private szK = 1; // applied distance factor along the line of sight (smoothed)
  private szU = 0; // the share of the wanted correction that the footage allows (re-checked ~7 Hz)
  private szAt = -9;
  private szOff = new THREE.Vector3();
  private szOffVel = new THREE.Vector3();
  private tmpSz = new THREE.Vector3();
  private szVb = { inside: 0, h: 9, camD: 0, sx: 0.5 };
  private szVb2 = { inside: 0, h: 9, camD: 0, sx: 0.5 };
  private szBand: [number, number] = [0, 0];
  private szSet = false;
  szWhy = ''; // (diagnostics) why the last size move was refused
  sizeFixes = 0; // (diagnostics) frames her spot was moved along the line of sight
  /**
   * Same size everywhere: her spot (the track's P, or the in-view point that stands in for it) is moved along the
   * camera's line of sight through it, nearer or farther, until her height on screen is inside the band. The same
   * place in the picture (the ray only), so in-frame and the screen x the track chose are kept; the footage must agree
   * with the new spot (floor, no wall, no drop, no person, no blocker / rail, clear of every live glow), else the
   * nearest share of the move that does. The spot's own motion along the ray is fed forward, so she walks with it.
   * Kept at ~2.3 m or more from the camera, it is also the margin that keeps a closing camera from reaching her.
   */
  private keepSize(goal: THREE.Vector3, sV: number, dt: number, reset: boolean) {
    const cp = this.view.camera.position;
    if (OFF.has('size')) { this.szK = 1; return; }
    const vb = this.viewBoxInto(goal, this.szVb);
    let mIdeal = 1;
    if (vb.inside >= 0.5 && vb.h < 5 && vb.camD > 0.3) {
      // (a camera closing in on her aims for the band's small end: the margin to the hard limits grows with the pace)
      const hi = this.sizeHi - 0.03 * this.closeK;
      const ht = Math.max(this.sizeLo, Math.min(hi, vb.h));
      mIdeal = vb.h / ht;
      // (never nearer than 2.2 m nor farther than 4.2 m)
      mIdeal = Math.max(2.2 / vb.camD, Math.min(Math.max(1, 4.2 / vb.camD), mIdeal));
    }
    if (reset || this.t - this.szAt > 0.15) {
      this.szAt = this.t;
      if (Math.abs(mIdeal - 1) > 0.01) {
        let u = 0;
        for (const uu of [1, 0.7, 0.45, 0.2]) if (this.sizeOk(goal, 1 + (mIdeal - 1) * uu, sV, vb.inside)) { u = uu; break; }
        this.szU = u;
      }
    }
    const m = 1 + (mIdeal - 1) * this.szU;
    if (reset || !this.szSet) this.szK = m;
    else this.szK += (m - this.szK) * Math.min(1, dt * 2.5);
    this.szSet = true;
    const k = this.szK;
    const ox = (goal.x - cp.x) * (k - 1), oz = (goal.z - cp.z) * (k - 1);
    goal.x += ox; goal.z += oz;
    if (Math.abs(k - 1) > 0.02) {
      this.sizeFixes++;
      const band = this.floorBand(goal, sV, this.szBand);
      if (band) goal.y = Math.max(band[0], Math.min(band[1], goal.y));
    }
    // (the offset's own motion: fed forward like P's, so she walks with the moved spot instead of trailing it)
    if (reset) this.szOffVel.set(0, 0, 0);
    else {
      const idt = 1 / Math.max(dt, 1e-3), kf = Math.min(1, dt * 8);
      this.szOffVel.x += ((ox - this.szOff.x) * idt - this.szOffVel.x) * kf;
      this.szOffVel.z += ((oz - this.szOff.z) * idt - this.szOffVel.z) * kf;
      const l = Math.hypot(this.szOffVel.x, this.szOffVel.z); if (l > 2.5) this.szOffVel.multiplyScalar(2.5 / l);
    }
    this.szOff.set(ox, 0, oz);
    this.blockFF.x += this.szOffVel.x; this.blockFF.z += this.szOffVel.z;
  }
  // ---- (owner: no fade when the camera gets very close) escape ahead of a closing camera
  private ggAt = -9;
  private ggOk = false;
  private ggPt = new THREE.Vector3();
  private escT = 0; // > 0 while she is walking on ahead of the camera
  private escOk = false;
  private escAt = -9;
  private escLocal = new THREE.Vector3(); // the escape spot, in the camera's frame (it moves on with the camera)
  private escCamPrev = new THREE.Vector3();
  private escCamVel = new THREE.Vector3();
  private escHas = false;
  private camSpd = 0;
  private tmpEsc = new THREE.Vector3();
  escapes = 0; // (diagnostics)
  giveWays = 0; // (diagnostics) frames she stepped aside out of the camera's path
  private escWay = 0; // 1: the escape spot is the step aside
  private escDanger = false;
  static readonly ESC_RAYS = [1, 0.5, 0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4];
  /**
   * The camera is about to reach her (her distance 0.7 s ahead at its closing pace under ~1.95 m, or she is already
   * over 0.45 of the screen tall) and her spot does not lead her away from it: she walks on ahead along the camera's
   * line of sight through her, to ~0.8 m farther than she is (at least 2.5 m), held in the camera's frame so it moves
   * on with the visitor, the camera's own pace fed forward; at more than a brisk walk she jogs. The spot must read
   * (in frame, floor, no wall, no person, no blocker, clear of glows); else the same a little to either side (she
   * steps out of the camera's path, still in the picture). Kept for 0.6 s after the need ends (no flicking).
   */
  private escapeCam(goal: THREE.Vector3, sV: number, dt: number, reset: boolean) {
    const cam = this.view.camera, cp = cam.position;
    if (reset || !this.escHas) { this.escCamVel.set(0, 0, 0); this.escHas = true; }
    else {
      const idt = 1 / Math.max(dt, 1e-3), kf = Math.min(1, dt * 6);
      this.escCamVel.x += ((cp.x - this.escCamPrev.x) * idt - this.escCamVel.x) * kf;
      this.escCamVel.z += ((cp.z - this.escCamPrev.z) * idt - this.escCamVel.z) * kf;
    }
    this.escCamPrev.copy(cp);
    this.camSpd = Math.min(6, Math.hypot(this.escCamVel.x, this.escCamVel.z));
    if (reset || OFF.has('escape') || this.opacity < 0.5) { this.escT = 0; this.escOk = false; this.escDanger = false; return; }
    const vb = this.viewBoxInto(this.pos, this.szVb);
    const dHer = vb.camD, pred = dHer - Math.max(0, this.closeRate) * 0.7;
    const gD = Math.hypot(goal.x - cp.x, goal.z - cp.z);
    // (danger: the camera reaching her within ~0.7 s, or her already over 0.45 of the screen; acted on when her spot
    // does not lead her away from it, or the camera gains on her anyway (the escape spot is then the readable ray
    // nearest the middle of the picture, so it never walks her off toward an edge))
    const danger = vb.inside > 0.05 && (pred < 1.95 || vb.h > 0.45);
    this.escDanger = danger;
    const need = danger && (gD < dHer + 0.5 || this.closeRate > 0.3);
    if (need) { if (this.escT <= 0) this.escapes++; this.escT = 0.6; } else this.escT = Math.max(0, this.escT - dt);
    if (this.escT <= 0) { this.escOk = false; return; }
    if (this.t - this.escAt > 0.15 || !this.escOk) {
      this.escAt = this.t;
      const dx = this.pos.x - cp.x, dz = this.pos.z - cp.z, dl = Math.hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      // (rays from her own toward her spot's first: walking on ahead, she is already heading where she goes next)
      const aG = Math.max(-0.4, Math.min(0.4, Math.atan2(ux * (goal.z - cp.z) - uz * (goal.x - cp.x), ux * (goal.x - cp.x) + uz * (goal.z - cp.z))));
      const D = Math.max(2.5, Math.min(3.2, dHer + 0.8));
      // (every ray is tried; the one nearest the middle of the picture wins, a little toward her spot's ray: walking
      // off toward a frame edge at a brisk pace, a pan then carried her out of the picture, f1776)
      let ok = false, bc = 1e9;
      for (let i = 0; i < GuideBrain.ESC_RAYS.length; i++) {
        const a = i < 2 ? aG * GuideBrain.ESC_RAYS[i] : GuideBrain.ESC_RAYS[i];
        const ca = Math.cos(a), sa = Math.sin(a), rx = ux * ca - uz * sa, rz = ux * sa + uz * ca;
        const q = this.tmpEsc.set(cp.x + rx * D, this.pos.y, cp.z + rz * D);
        const band = this.floorBand(q, sV, this.szBand);
        if (band) q.y = Math.max(band[0], Math.min(band[1], q.y));
        const vq = this.viewBoxInto(q, this.szVb2);
        if (vq.inside < 0.8 || vq.h > 0.42 || vq.sx < 0.2 || vq.sx > 0.8) continue;
        const cost = Math.abs(vq.sx - 0.45) + 0.3 * Math.abs(a - aG);
        if (cost >= bc) continue;
        if (this.collides(q.x, q.z, this.nearestS(q, sV)) || this.glowBad(q, true, 40) || this.depthBad(q) || this.feetOnPerson(q)) continue;
        bc = cost; this.escLocal.copy(q); cam.worldToLocal(this.escLocal); ok = true; this.escWay = 0;
      }
      // (nothing ahead reads and the camera is about to reach her: the camera physically comes through where she is.
      // She steps aside out of its path, as someone would let you pass: sideways in the camera's frame, to the side of
      // the picture she is on, ~1.1 m clear of its line, so she leaves the frame at its edge instead of filling the
      // screen or dissolving; once she is out of the picture she steps back on ahead, as after any pan)
      if (!ok && pred < 1.75 && !this.plOn && !OFF.has('giveway')) {
        const hl = this.tmpEsc.copy(this.pos); cam.worldToLocal(hl);
        const sd = hl.x >= 0 ? 1 : -1, zl = hl.z;
        for (const sgn of [sd, -sd]) {
          const q = this.tmpEsc.set(sgn * Math.max(1.1, Math.abs(hl.x) + 0.7), 0, zl); cam.localToWorld(q);
          q.y = this.pos.y;
          if (this.collides(q.x, q.z, this.nearestS(q, sV))) continue;
          this.escLocal.set(sgn * Math.max(1.1, Math.abs(hl.x) + 0.7), 0, zl); ok = true; this.escWay = 1; break;
        }
      }
      this.escOk = ok;
    }
    if (!this.escOk) return;
    goal.copy(this.escLocal); cam.localToWorld(goal);
    if (this.escWay) this.giveWays++;
    const band = this.floorBand(goal, sV, this.szBand);
    goal.y = band ? Math.max(band[0], Math.min(band[1], this.pos.y)) : this.pos.y;
    this.blockFF.set(this.escCamVel.x, 0, this.escCamVel.z);
    const fl = Math.hypot(this.blockFF.x, this.blockFF.z); if (fl > GuideBrain.V_JOG_MAX) this.blockFF.multiplyScalar(GuideBrain.V_JOG_MAX / fl);
    this.dbgSrc += this.escWay ? '+giveway' : '+esc';
  }
  // ---- (round 2: "the camera walks into her by the merch wall") lead along the walked path
  private plT = 0; // > 0.25: leading along the walked path
  private plOn = false;
  private plAt = -9;
  private plL = 2.7; // path metres ahead of the visitor
  private plPrev = new THREE.Vector3();
  private plFF = new THREE.Vector3();
  private plHas = false;
  private tmpPl = new THREE.Vector3();
  pathLeads = 0; // (diagnostics)
  /** Does the straight segment a -> b pass through a blocker (its radius + m)? */
  private segBlocked(ax: number, az: number, bx: number, bz: number, m: number) {
    const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
    if (L2 < 1e-6) return false;
    for (const [cx, cz, cr] of this.blockers()) {
      const t = Math.max(0, Math.min(1, ((cx - ax) * ux + (cz - az) * uz) / L2));
      const dx = ax + ux * t - cx, dz = az + uz * t - cz;
      if (dx * dx + dz * dz < (cr + m) * (cr + m)) return true;
    }
    return false;
  }
  /** The walked (camera) path at path distance s, on her floor. */
  private pathPoint(s: number, out: THREE.Vector3) {
    const f = this.frameAtDistance(s), g = Math.max(0, f - 1), S = this.S;
    const t = f > g && S[f] > S[g] ? Math.max(0, Math.min(1, (s - S[g]) / (S[f] - S[g]))) : 1;
    return out.set(this.smX[g] + (this.smX[f] - this.smX[g]) * t, this.floorY[g] + (this.floorY[f] - this.floorY[g]) * t, this.smZ[g] + (this.smZ[f] - this.smZ[g]) * t);
  }
  /**
   * The track's way ahead runs through furniture (the solver jumped her across the merch wall's display table and
   * cube bench, f2290-2400: she walked into the 8 cm gap between them, stuck, while the visitor walked past her and
   * she grew to 0.5-0.9 of the screen, slid off the left edge and stepped back on ahead), or she is held by the
   * collision backstop: she walks ahead of the visitor along the visitor's own walked path (the camera's path is
   * floor someone really walked), ~2.7 m in front of the camera, in the picture, at the visitor's pace (the path
   * point's own motion fed forward). Kept for at least 2.5 s; back to the track once her way to it is clear.
   */
  private pathLead(goal: THREE.Vector3, sV: number, vVis: number, dt: number, reset: boolean) {
    // (only while the visitor walks: standing at a station the glow rules place her, QA f1767)
    if (reset || OFF.has('pathlead') || this.holdSet || !this.nav || this.stillT > 0.3) { this.plT = 0; this.plOn = false; this.plHas = false; return; }
    const dir = this.vfRate < -1 ? -1 : 1;
    // (looked at ~4 s ahead too: the track's later stretch through the furniture, so she is already on the walked
    // path before the boxed-in pocket, not stuck in it)
    const vf0 = this.view.frame ?? 0;
    const ahead = this.blockAt(vf0 + 30 * dir, this.tmpPl);
    let blocked = this.segBlocked(this.pos.x, this.pos.z, ahead.x, ahead.z, 0.1) || this.segBlocked(this.pos.x, this.pos.z, goal.x, goal.z, 0.1);
    for (let k = 1; k <= 3 && !blocked; k++) {
      const a1 = this.blockAt(vf0 + 30 * k * dir, this.tmpPl), ax = a1.x, az = a1.z, a2 = this.blockAt(vf0 + 30 * (k + 1) * dir, this.tmpPl);
      blocked = this.segBlocked(ax, az, a2.x, a2.z, 0.1);
    }
    // (or the track leaps away faster than she can walk and she is slipping out of the picture after it: by the TV
    // wall the station window moves her spot ~4 m sideways and she ran off the left edge after it, f1090-1130)
    const gd = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    const lost = (this.lastVbIn < 0.9 && gd > 1.8) || (gd > 2.5 && Math.hypot(this.goalVel.x, this.goalVel.z) > 1.5);
    const want = blocked || lost || this.stuckT > 0.2;
    // (on for >= 2.5 s, renewed while the way stays blocked: switching back and forth swung her across the pocket)
    this.plT = want ? (this.plOn ? Math.max(this.plT, 1.5) : this.plT + dt) : Math.max(0, this.plT - dt);
    if (!this.plOn && this.plT > 0.15) { this.plOn = true; this.pathLeads++; this.plT = 2.5; this.plAt = -9; }
    if (this.plOn && this.plT <= 0) this.plOn = false;
    if (!this.plOn) { this.plHas = false; return; }
    // (the lead is counted from where the camera is on its path now, not the smoothed scroll: on fast swipes the
    // camera runs ~1 m ahead of that and walked into her, f2204-2212)
    const sC = this.S[Math.max(0, Math.min(this.S.length - 1, Math.round(this.view.frame ?? 0)))] ?? sV;
    if (this.t - this.plAt > 0.15) {
      // the lead (path metres ahead of the visitor) whose point reads best: in the picture, ~2.7 m from the camera,
      // not on a person, not in a blocker
      this.plAt = this.t;
      const cp = this.view.camera.position;
      let bc = 1e9, bL = -1;
      for (let L = 1.5; L <= 5.01; L += 0.25) {
        const q = this.pathPoint(sC + dir * L, this.tmpPl);
        const vq = this.viewBoxInto(q, this.szVb2);
        if (vq.inside < 0.9 || vq.camD < 2.3 || vq.h > 0.4 || vq.sx < 0.2 || vq.sx > 0.8) continue;
        // (well inside the picture first: by the merch wall the walked line runs along the right edge for 2-3 m and
        // she slid out with any lag; then ~2.9 m out)
        // (a point she can walk to in a straight line first: around a cube on the way she swung wide, out of shot)
        const cost = Math.abs(vq.camD - 2.6) + 3 * Math.max(0, Math.abs(vq.sx - 0.5) - 0.12) + 0.3 * Math.abs(L - this.plL) + (this.segBlocked(this.pos.x, this.pos.z, q.x, q.z, 0.25) ? 1.5 : 0);
        if (cost >= bc) continue;
        if (this.collides(q.x, q.z, sC + dir * L) || this.feetOnPerson(q)) continue;
        // (walking past a glow is allowed (QA: only standing in one is not); clear of it is preferred)
        const cg = cost + (this.glowBad(q, true, 40) ? 0.6 : 0);
        if (cg >= bc) continue;
        bc = cg; bL = L;
      }
      void cp;
      // (none reads this moment: the last lead is kept rather than handing her back to the boxed-in track)
      if (bL >= 0) this.plL = bL;
    }
    const q0 = this.pathPoint(sC + dir * this.plL, this.tmpPl);
    // (where the walked line runs by a frame edge, the spot sits up to 0.4 m off it toward the middle of the picture,
    // where that is free: her lag or a swing wide then stays in shot, f2280-2300)
    {
      const vq = this.viewBoxInto(q0, this.szVb2), e = this.view.camera.matrixWorld.elements, rl = Math.hypot(e[0], e[2]) || 1;
      const m = vq.sx > 0.58 ? -Math.min(0.4, (vq.sx - 0.58) * 2.5) : vq.sx < 0.42 ? Math.min(0.4, (0.42 - vq.sx) * 2.5) : 0;
      if (m !== 0) {
        const nx = q0.x + (e[0] / rl) * m, nz = q0.z + (e[2] / rl) * m;
        if (!this.collides(nx, nz, sC + dir * this.plL)) { q0.x = nx; q0.z = nz; }
      }
    }
    // (the lead point's own motion is fed forward)
    if (!this.plHas) { this.plFF.set(0, 0, 0); this.plHas = true; }
    else {
      const idt = 1 / Math.max(dt, 1e-3), kf = Math.min(1, dt * 5);
      this.plFF.x += ((q0.x - this.plPrev.x) * idt - this.plFF.x) * kf;
      this.plFF.z += ((q0.z - this.plPrev.z) * idt - this.plFF.z) * kf;
      const l = Math.hypot(this.plFF.x, this.plFF.z); if (l > GuideBrain.V_JOG_MAX) this.plFF.multiplyScalar(GuideBrain.V_JOG_MAX / l);
    }
    this.plPrev.copy(q0);
    goal.x = q0.x; goal.z = q0.z;
    // (she follows the walked line itself, looking ~1.2 m ahead of her own place on it, until she is at the lead
    // spot: cutting across toward a spot beyond the cubes held her in their margins (f2360-2390), and a straight dash
    // to a rejoin point swung her wide off the line at its bend, out of shot (f2280-2300))
    {
      const sH = this.nearestS(this.pos, sV), sP = sH + dir * Math.max(1.0, Math.min(1.8, 0.9 + 0.35 * this.spd)), sL = sC + dir * this.plL;
      if ((sL - sP) * dir > 0) { const w = this.pathPoint(sP, this.tmpE2); goal.x = w.x; goal.z = w.z; }
    }
    const band = this.floorBand(goal, sV, this.szBand);
    goal.y = band ? Math.max(band[0], Math.min(band[1], this.pos.y)) : q0.y;
    this.blockFF.copy(this.plFF);
    void vVis;
    this.dbgSrc += '+path';
  }
  /** Would her spot moved along the line of sight by factor m read right (keepSize)? */
  private sizeOk(goal: THREE.Vector3, m: number, sV: number, in0: number) {
    const cp = this.view.camera.position, q = this.tmpSz;
    q.set(cp.x + (goal.x - cp.x) * m, goal.y, cp.z + (goal.z - cp.z) * m);
    const band = this.floorBand(q, sV, this.szBand);
    if (band) q.y = Math.max(band[0], Math.min(band[1], q.y));
    const vq = this.viewBoxInto(q, this.szVb2);
    if (vq.inside < Math.min(0.95, in0) || vq.camD < 2.0 || !this.feetInView(q)) { this.szWhy = 'view'; return false; }
    if (this.collides(q.x, q.z, this.nearestS(q, sV))) { this.szWhy = 'coll'; return false; }
    if (this.glowBad(q)) { this.szWhy = 'glow'; return false; }
    const db = this.depthBad(q);
    if (db) { this.szWhy = db; return false; }
    if (this.feetOnPerson(q)) { this.szWhy = 'person'; return false; }
    if (m > 1 && (this.occludedAt(q) || this.nearDrop(q))) { this.szWhy = 'occ'; return false; }
    this.szWhy = '';
    return true;
  }
  private walkInPt = new THREE.Vector3();
  private backLocal = new THREE.Vector3();
  private backAt = -9;
  private curveFree = false;
  private inGlow = false;
  private pBadT = 0;
  private edgeHurry = false;
  private edgeJog = 0;
  private partyNow = false;
  private lanWas = false;
  private lanD = 2.6;
  private lanYaw = 0;
  private lanCarryT = 0;
  private wasUns = false;
  private stuckT = 0;
  private exitCarryT = 0;
  private ecCam = new THREE.Vector3();
  private ecYaw = 0;
  private ecOk = false;
  private lanCam = new THREE.Vector3();
  dbgGoal: THREE.Vector3 | null = null; // (QA tools)
  private lanL = 0;
  private lastVbIn = 1;
  private curRects: BrainContext['stationRects'] = [];
  /** Would she, standing at p, cover a live station's glow (> 15 % of her box) or have her head inside one? (QA rule) */
  private glowBad(p: THREE.Vector3, headOnly = false, m = OFF.has('glow40') ? 10 : 40) {
    if (!this.curRects.length) return false;
    const a = this.view.project(p), b = this.view.project(this.tmpVB.copy(p).setY(p.y + 1.7));
    if (!a || !b) return false;
    const hpx = Math.max(1, a.y - b.y), half = 0.27 * hpx, x0 = a.x - half, x1 = a.x + half, y0 = b.y, y1 = a.y;
    for (const r of this.curRects) {
      const ox = Math.max(0, Math.min(x1, r.x1) - Math.max(x0, r.x0)), oy = Math.max(0, Math.min(y1, r.y1) - Math.max(y0, r.y0));
      if (!headOnly && (ox * oy) / Math.max(1, (x1 - x0) * (y1 - y0)) > 0.15) return true;
      // (the head point QA tests: 1.58 m above her feet)
      const c = this.view.project(this.tmpVB.copy(p).setY(p.y + 1.58));
      if (c && c.x > r.x0 - m && c.x < r.x1 + m && c.y > r.y0 - m && c.y < r.y1 + m) return true;
    }
    return false;
  }
  private quickFade = false;
  private insRate = 0;
  private prevIns = -1;
  /** Diagnostics (QA): her screen box [inside, height, camera distance] and the last dissolve reason (1 near, 2 size, 3 edge). */
  dbgVb = [0, 0, 0];
  dbgWhy = 0;
  private lanAt = -9;
  private lanOk = false;
  private lanOff = new THREE.Vector3();
  proxDissolves = 0;
  private tmpVB = new THREE.Vector3();
  private tmpE = new THREE.Vector3();
  private tmpE2 = new THREE.Vector3();
  /**
   * Her screen box at p through the rendered camera, as the audit measures it: feet to 1.70 m, half-width 0.19 x its
   * height; inside = fraction of the box inside the picture, h = box height / screen height, camD = ground distance to
   * the camera (m), sx = box centre x (0..1 of the picture), or inside 0 / h 9 when behind the camera.
   */
  private viewBox(p: THREE.Vector3) { return this.viewBoxInto(p, { inside: 0, h: 9, camD: 0, sx: 0.5 }); }
  /** viewBox written into out (no allocation: per-frame callers). */
  private viewBoxInto(p: THREE.Vector3, out: { inside: number; h: number; camD: number; sx: number }) {
    const v = this.view, cp = v.camera.position;
    const camD = Math.hypot(p.x - cp.x, p.z - cp.z);
    const a = v.project(p), b = v.project(this.tmpVB.copy(p).setY(p.y + 1.7));
    out.camD = camD;
    if (!a || !b || a.z < 0.3) { out.inside = 0; out.h = 9; out.sx = 0.5; return out; }
    const hpx = Math.max(1, a.y - b.y), half = 0.19 * hpx, cx = a.x; // (her body stands upright on screen over her feet: the rig lean limit, not world up)
    const x0 = cx - half, x1 = cx + half, y0 = b.y, y1 = a.y;
    const ox = v.offsetX, W = v.width, H = v.height;
    const ix = Math.max(0, Math.min(x1, ox + W) - Math.max(x0, ox)), iy = Math.max(0, Math.min(y1, H) - Math.max(y0, 0));
    out.inside = (ix * iy) / Math.max(1e-6, (x1 - x0) * (y1 - y0)); out.h = hpx / H; out.sx = (cx - ox) / W;
    return out;
  }
  /**
   * The nearest point to P on the track's lane (path distance sP -3..+6 m, across the measured lane) that she can be
   * seen at: body box >= 92 % inside, 2.1 m or more from the camera, height <= 0.45, footage depth agreeing (no wall,
   * no drop), not on a person. Written to out; false when there is none.
   */
  private inViewLanePoint(P: THREE.Vector3, sP: number, out: THREE.Vector3, minIn = 0.8) {
    let best = 1e9;
    const q = this.tmpE;
    for (let ds = -3; ds <= 6.01; ds += 0.5) {
      const s = sP + ds;
      if (s < 0 || s > this.S[this.S.length - 1]) continue;
      const [l0, l1] = this.laneAt(s);
      for (let k = 0; k <= 6; k++) {
        const lat = l0 + 0.25 + ((l1 - l0 - 0.5) * k) / 6;
        this.lanePoint(s, lat, q);
        const fr = this.frameAtDistance(s);
        q.y = this.floorY[fr];
        const band = this.floorBand(q, s);
        if (band) q.y = Math.max(band[0], Math.min(band[1], q.y));
        const vb = this.viewBox(q);
        if (vb.inside < minIn || vb.camD < 2.0 || vb.h > 0.47 || vb.h < 0.12) continue;
        if (this.collides(q.x, q.z, s)) continue;
        // (and well away from the frame edges: an in-view point by the edge left her drifting out of the picture as
        // the camera turned, f1750-1790 by the TVs; ?off=altmid for the old weighting)
        const d = Math.hypot(q.x - P.x, q.z - P.z) + 0.6 * Math.abs(vb.sx - 0.45) + (OFF.has('altmid') ? 0 : 4 * Math.max(0, Math.abs(vb.sx - 0.5) - 0.22));
        if (d >= best) continue;
        if (this.depthBad(q) || this.feetOnPerson(q) || this.glowBad(q)) continue;
        best = d; out.copy(q);
      }
    }
    if (best < 1e9) return true;
    // (none on the lane: further back along the camera's line of sight through P, the same place on screen but
    // smaller, where the footage shows floor)
    const cp = this.view.camera.position, dx = P.x - cp.x, dz = P.z - cp.z, dl = Math.hypot(dx, dz) || 1;
    for (const d of [2.2, 2.5, 2.8, 3.2, 3.6, 4.2]) {
      if (d < dl) continue;
      q.set(cp.x + (dx / dl) * d, P.y, cp.z + (dz / dl) * d);
      const vb = this.viewBox(q);
      if (vb.inside < minIn || vb.h > 0.47 || vb.h < 0.12) continue;
      if (this.depthBad(q) || this.feetOnPerson(q) || this.glowBad(q) || this.collides(q.x, q.z, this.nearestS(q, sP))) continue;
      out.copy(q); return true;
    }
    // (P out of view as well: a spot ahead of the camera on the floor of the lane's level, nearest P, where the
    // footage shows floor, no drop, no person, no blocker / rail)
    const e = this.view.camera.matrixWorld.elements, fl = Math.hypot(e[8], e[10]) || 1;
    const fx = -e[8] / fl, fz = -e[10] / fl, rx = -fz, rz = fx;
    let bd = 1e9;
    for (const d of [2.6, 3.2, 3.8]) for (const l of [-0.6, -0.2, 0.2, 0.6]) {
      q.set(cp.x + fx * d + rx * l, P.y, cp.z + fz * d + rz * l);
      const vb = this.viewBox(q);
      if (vb.inside < minIn || vb.h > 0.47 || vb.h < 0.12) continue;
      const c = Math.hypot(q.x - P.x, q.z - P.z);
      if (c >= bd) continue;
      if (this.depthBad(q) || this.feetOnPerson(q) || this.nearDrop(q) || this.glowBad(q) || this.collides(q.x, q.z, this.nearestS(q, sP))) continue;
      bd = c; out.copy(q);
    }
    return bd < 1e9;
  }
  /**
   * Walk-in re-entry: a floor point just outside the picture's edge (left or right, the side nearest T on screen,
   * then the other), at T's distance from the camera, from where she walks in to T. Prefers a side whose walk-in line
   * shows no wall in view. Written to out; false when no edge point is found.
   */
  private edgeEntry(T: THREE.Vector3, out: THREE.Vector3) {
    const cam = this.view.camera, e = cam.matrixWorld.elements;
    const rl = Math.hypot(e[0], e[2]) || 1, rx = e[0] / rl, rz = e[2] / rl;
    const vbT = this.viewBox(T);
    // (while the camera pans, the leading edge: the turn itself brings her in; else the edge nearest T on screen)
    const first = Math.abs(this.panRate) > 0.3 ? (this.panRate > 0 ? -1 : 1) : vbT.sx < 0.5 ? -1 : 1;
    let fallback = false;
    for (const side of [first, -first]) {
      const q = this.tmpE2;
      let found = false;
      for (let k = 0.1; k <= 5; k += 0.1) {
        q.set(T.x + rx * side * k, T.y, T.z + rz * side * k);
        if (this.viewBox(q).inside <= 0.02) { found = true; break; }
      }
      if (!found) continue;
      // the walk-in line: points of it in view must show floor (no wall / drop / person in the way)
      let clean = true, walkable = true;
      // (the whole walk-in line, the start point outside the picture included: never from beyond a rail / balustrade
      // or out of a blocker; the part in view must also read as floor)
      for (let u = 0; u < 1; u += 0.1) {
        const m = this.tmpE.set(q.x + (T.x - q.x) * u, T.y, q.z + (T.z - q.z) * u);
        if (this.collides(m.x, m.z, this.nearestS(m, this.sVs))) { walkable = false; clean = false; break; }
        if (this.viewBox(m).inside > 0.05 && (this.depthBad(m) || this.occludedAt(m))) clean = false;
      }
      if (clean) { out.copy(q); return true; }
      if ((walkable || OFF.has('walkin')) && !fallback) { out.copy(q); fallback = true; }
    }
    if (fallback || OFF.has('walkin')) return fallback;
    // (no walkable side line, e.g. a balustrade on one side and a wall on the other: a point on the walked lane itself
    // just out of the picture, nearest T, from where the straight line to T stays walkable)
    const sT = this.nearestS(T, this.sVs);
    let bd = 1e9;
    for (let ds = -4; ds <= 4.01; ds += 0.5) {
      const s = sT + ds;
      if (s < 0 || s > this.S[this.S.length - 1]) continue;
      const [l0, l1] = this.laneAt(s);
      for (let k = 0; k <= 4; k++) {
        const q = this.tmpE2;
        this.lanePoint(s, l0 + 0.25 + ((l1 - l0 - 0.5) * k) / 4, q); q.y = T.y;
        const d = Math.hypot(q.x - T.x, q.z - T.z);
        if (d >= bd || d > 4.5 || this.viewBox(q).inside > 0) continue;
        let ok = true;
        for (let u = 0; u < 1 && ok; u += 0.1) {
          const m = this.tmpE.set(q.x + (T.x - q.x) * u, T.y, q.z + (T.z - q.z) * u);
          if (this.collides(m.x, m.z, this.nearestS(m, this.sVs))) ok = false;
        }
        if (ok) { bd = d; out.copy(q); }
      }
    }
    return bd < 1e9;
  }

  private occludedAt(p: THREE.Vector3) {
    const se = this.sense;
    if (!se?.ready || !se.floor) return false;
    const o = { u: 0, v: 0, z: 0 };
    let hid = 0;
    for (const hy of [0.5, 1.0, 1.45]) {
      const r = se.toImage(this.tmpOcc.set(p.x, p.y + hy, p.z), o);
      if (!r) continue;
      const k = se.cell(r.u, r.v);
      if (k < 0) continue;
      if (se.metric(se.depth[k]) < r.z - 0.9) hid++;
    }
    return hid >= 2;
  }

  /** No part of her is in the picture (behind the camera, or her whole box beyond an edge). */
  private fullyOff(p: THREE.Vector3) {
    const a = this.view.project(p), b = this.view.project(this.tmp.copy(p).setY(p.y + 1.62));
    if (!a || !b) return true;
    const ox = this.view.offsetX, W = this.view.width, half = (a.y - b.y) * 0.3;
    return Math.max(a.x, b.x) + half < ox || Math.min(a.x, b.x) - half > ox + W || b.y > this.view.height || a.y < 0;
  }

  private feetInView(p: THREE.Vector3) {
    const a = this.view.project(p);
    return !!a && a.x > this.view.offsetX + 10 && a.x < this.view.offsetX + this.view.width - 10 && a.y < this.view.height;
  }

  private onScreen(p: THREE.Vector3) {
    const a = this.view.project(p), b = this.view.project(this.tmp.copy(p).setY(p.y + 1.6));
    if (!a || !b) return false;
    const ox = this.view.offsetX, W = this.view.width, half = (a.y - b.y) * 0.2 + 12; // her body's half-width + margin
    return Math.min(a.x, b.x) - half > ox && Math.max(a.x, b.x) + half < ox + W && b.y > 2 && a.y < this.view.height * 1.0;
  }

  private lowConfAround(f: number) {
    const c = this.floor.cam.conf;
    let z = 0;
    for (let k = -15; k <= 15; k += 3) if ((c[f + k] ?? 0) === 0) z++;
    return z > 8;
  }

  nextStation(f: number) {
    if (this.floor.id !== 'downstairs') return null;
    return this.stations.find((s) => s.click_frame > f + 15) ?? null;
  }
  stations: Station[] = [];

  private enter(s: State, c: BrainContext) {
    const prev = this.state;
    this.state = s;
    if (s === 'race') {
      const f = Math.round(c.frame);
      const endF = Math.min(this.S.length - 1, Math.round(63 * this.floor.meta.fps));
      this.raceEndS = this.S[endF] - 1.5;
      this.raceAnchor = Math.min(this.S[f] + 5, this.raceEndS);
      this.waitSince = -1;
      this.saidWait = false;
      if (!c.gliding) this.say(pick(this.lines.race_start ?? ['Race you!']), 3);
      this.hop();
    } else if (s === 'present') {
      this.hop();
      this.setGesture('tada', 1.6);
      this.mood = 'happy';
      setTimeout(() => { this.mood = 'neutral'; }, 2200);
    } else if (s === 'follow' && prev === 'idle' && c.userFps < -2) {
      this.say(pick(this.lines.reverse), 2.6);
    } else if (s === 'hidden' && this.floor.id === 'downstairs') {
      this.say(pick(this.lines.dark), 3.5);
    }
    if (s !== 'tease') this.teaseStation = s === 'present' ? this.teaseStation : null;
  }

  startIntro() {
    this.state = 'intro';
    this.setGesture('waveBig', 1.8); // a quick, small hello (owner: "more subtle and quick")
    this.mood = 'happy';
  }

  endIntro() {
    this.state = 'idle';
    this.mood = 'neutral';
  }

  /** Screen position of the top of her head (for the speech bubble). */
  headScreen() {
    const p = this.rig.headCenter.getWorldPosition(new THREE.Vector3());
    p.y += 0.22;
    return this.view.project(p);
  }
}

function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
