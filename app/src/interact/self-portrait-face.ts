import { SKIN } from './self-portrait-skin';

/*
 * Face data for "Self Portrait": the portrait library, head pose from MediaPipe's facial transformation matrix, the
 * pose + expression features used to match a visitor to a painting, and the matcher itself (with hysteresis).
 * The same pose() ran offline over every painting (see portraits.json), so the numbers are comparable.
 */

export type Blend = Record<string, number>;
export interface FaceData { yaw: number; pitch: number; roll: number; bs: Blend; lm: number[]; skin: number[]; skinSd: number[] }
export interface Portrait extends FaceData { id: string; title: string; artist: string; date: string; museum: string; url: string; license: string; img: string; thumb: string; w: number; h: number }
export interface Sitter extends FaceData { id: string; title: string; page: string; license: string; artist: string; img: string; w: number; h: number; mirror?: FaceData }

/** Yaw / pitch / roll in degrees from a column-major 4x4 (rotation columns normalised). Same as the offline tool. */
export function pose(m: ArrayLike<number>) {
  const n = (a: number, b: number, c: number) => { const l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };
  const [r00, r10, r20] = n(m[0], m[1], m[2]);
  const [, , r21] = n(m[4], m[5], m[6]);
  const [, , r22] = n(m[8], m[9], m[10]);
  const deg = 180 / Math.PI;
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -r20))) * deg,
    pitch: Math.atan2(r21, r22) * deg,
    roll: Math.atan2(r10, r00) * deg,
  };
}

/** The feature vector the match runs on: head pose plus a handful of expression blendshapes. */
export interface Feat { yaw: number; pitch: number; roll: number; smile: number; jaw: number; browUp: number; browDown: number; eye: number }
export function feat(p: { yaw: number; pitch: number; roll: number }, bs: Blend): Feat {
  const g = (k: string) => bs[k] ?? 0;
  return {
    yaw: p.yaw, pitch: p.pitch, roll: p.roll,
    // painted sitters rarely grin: a broad smile should still find the warmest of them, not a turned head
    smile: Math.min(0.7, (g('mouthSmileLeft') + g('mouthSmileRight')) / 2),
    jaw: g('jawOpen'),
    browUp: g('browInnerUp') * 0.6 + (g('browOuterUpLeft') + g('browOuterUpRight')) * 0.2,
    browDown: (g('browDownLeft') + g('browDownRight')) / 2,
    eye: (g('eyeWideLeft') + g('eyeWideRight')) / 2 - (g('eyeBlinkLeft') + g('eyeBlinkRight')) / 2 * 0.6 - (g('eyeSquintLeft') + g('eyeSquintRight')) / 2 * 0.4,
  };
}
// One unit of distance is "about this much" of each: pose dominates, expression decides between similar poses.
const SCALE: Feat = { yaw: 11, pitch: 16, roll: 9, smile: 0.3, jaw: 0.25, browUp: 0.3, browDown: 0.3, eye: 0.35 };
export function dist(a: Feat, b: Feat) {
  let s = 0;
  for (const k in SCALE) { const key = k as keyof Feat; const d = (a[key] - b[key]) / SCALE[key]; s += d * d; }
  return Math.sqrt(s);
}

/** Nearest portrait, switching only when another is clearly better for `hold` seconds. */
export function matcher(lib: Feat[], hold = 0.6) {
  let cur = -1, cand = -1, since = 0;
  const ds = new Float32Array(lib.length);
  return {
    get current() { return cur; },
    reset() { cur = -1; cand = -1; since = 0; },
    /** Feed one observation; returns the (possibly unchanged) match. */
    push(f: Feat, dt: number) {
      let best = 0;
      for (let i = 0; i < lib.length; i++) { ds[i] = dist(f, lib[i]); if (ds[i] < ds[best]) best = i; }
      if (cur < 0) { cur = best; cand = -1; return cur; }
      if (best !== cur && ds[best] < ds[cur] * 0.82 && ds[cur] - ds[best] > 0.18) {
        if (best !== cand) { cand = best; since = 0; }
        since += dt;
        if (since >= hold) { cur = best; cand = -1; since = 0; }
      } else { cand = -1; since = 0; }
      return cur;
    },
    /** Best right now, ignoring hysteresis (for the first lock after a scan). */
    best(f: Feat) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < lib.length; i++) { const d = dist(f, lib[i]); if (d < bd) { bd = d; best = i; } }
      return best;
    },
  };
}

export { SKIN };

/** Decode portraits.json landmarks (x,y * 10000) into a Float32Array of normalised x,y pairs. */
export function decodeLm(lm: number[]) {
  const out = new Float32Array(lm.length);
  for (let i = 0; i < lm.length; i++) out[i] = lm[i] / 10000;
  return out;
}

/* ---------------------------------------------------------------- live tracking (loaded only after "Use my camera") */
export interface Tracked { lm: Float32Array; z: Float32Array; pose: { yaw: number; pitch: number; roll: number }; bs: Blend; skin: number[] | null }
export type Frame = OffscreenCanvas | HTMLCanvasElement;
export interface Tracker { readonly busy: boolean; readonly kind: string; send(frame: Frame, t: number, stats: boolean): void; close(): void }
type OnResult = (r: Tracked | null, ms: number) => void;

/**
 * MediaPipe Face Landmarker, from this site (WASM + model are self-hosted). Preferably in a worker (start-up and
 * per-frame work stay off the main thread), GPU delegate with a CPU fallback; on the main thread where workers can't.
 */
export async function loadTracker(asset: (p: string) => string, onResult: OnResult): Promise<Tracker> {
  const base = new URL(asset('media/interact/self-portrait/'), location.href).href;
  const wasm = base + 'wasm', model = base + 'face_landmarker.task';
  const canWorker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && 'transferToImageBitmap' in OffscreenCanvas.prototype;
  if (canWorker) {
    try { return await workerTracker(wasm, model, onResult); } catch (e) { console.warn('face worker unavailable, tracking on the main thread', e); }
  }
  return mainTracker(wasm, model, onResult);
}

const toTracked = (f: { lm: Float32Array; z: Float32Array; bs: Blend; mat: ArrayLike<number> | null; skin: number[] | null }): Tracked =>
  ({ lm: f.lm, z: f.z, bs: f.bs, skin: f.skin, pose: f.mat && f.mat.length >= 16 ? pose(f.mat) : { yaw: 0, pitch: 0, roll: 0 } });

function workerTracker(wasm: string, model: string, onResult: OnResult) {
  return new Promise<Tracker>((resolve, reject) => {
    const w = new Worker(new URL('./self-portrait-worker.ts', import.meta.url));
    let busy = false, ready = false, closed = false;
    const to = setTimeout(() => { if (!ready) { w.terminate(); reject(new Error('face worker timed out')); } }, 45000);
    const t: Tracker = {
      get busy() { return busy; },
      kind: 'worker',
      send(frame, ts, stats) {
        if (busy || closed) return;
        busy = true;
        const bmp = (frame as OffscreenCanvas).transferToImageBitmap();
        w.postMessage({ type: 'frame', bmp, ts, stats }, [bmp]);
      },
      close() { if (closed) return; closed = true; try { w.postMessage({ type: 'close' }); } catch { /* gone */ } setTimeout(() => w.terminate(), 200); },
    };
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { ready = true; clearTimeout(to); (t as { kind: string }).kind = `worker-${m.delegate}`; resolve(t); }
      else if (m.type === 'error') { clearTimeout(to); w.terminate(); reject(new Error(m.message)); }
      else if (m.type === 'result') { busy = false; if (!closed) onResult(m.face ? toTracked(m.face) : null, m.ms); }
    };
    w.onerror = (e) => { clearTimeout(to); w.terminate(); reject(new Error(e.message || 'face worker failed')); };
    w.postMessage({ type: 'init', wasm, model });
  });
}

async function mainTracker(wasm: string, model: string, onResult: OnResult): Promise<Tracker> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const fs = await FilesetResolver.forVisionTasks(wasm);
  const opts = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO' as const, numFaces: 1,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let lmk: Awaited<ReturnType<typeof FaceLandmarker.createFromOptions>>;
  let kind = 'main-GPU';
  try { lmk = await FaceLandmarker.createFromOptions(fs, opts('GPU')); } catch { kind = 'main-CPU'; lmk = await FaceLandmarker.createFromOptions(fs, opts('CPU')); }
  const stat = document.createElement('canvas');
  stat.width = 96; stat.height = 72;
  const sg = stat.getContext('2d', { willReadFrequently: true })!;
  let lastT = -1;
  return {
    busy: false,
    kind,
    send(frame, t, stats) {
      const ts = Math.max(lastT + 1, Math.round(t));
      lastT = ts;
      const t0 = performance.now();
      const r = lmk.detectForVideo(frame as HTMLCanvasElement, ts);
      const L = r.faceLandmarks[0];
      if (!L) { onResult(null, performance.now() - t0); return; }
      const lm = new Float32Array(L.length * 2), z = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) { lm[i * 2] = L[i].x; lm[i * 2 + 1] = L[i].y; z[i] = L[i].z; }
      const bs: Blend = {};
      for (const c of r.faceBlendshapes[0]?.categories ?? []) bs[c.categoryName] = c.score;
      let skin: number[] | null = null;
      if (stats) {
        sg.drawImage(frame, 0, 0, 96, 72);
        const d = sg.getImageData(0, 0, 96, 72).data;
        const acc = [0, 0, 0], acc2 = [0, 0, 0];
        for (const i of SKIN) {
          const x = Math.min(95, Math.max(0, Math.round(lm[i * 2] * 96))), y = Math.min(71, Math.max(0, Math.round(lm[i * 2 + 1] * 72)));
          const o = (y * 96 + x) * 4;
          for (let k = 0; k < 3; k++) { const v = d[o + k] / 255; acc[k] += v; acc2[k] += v * v; }
        }
        skin = [];
        for (let k = 0; k < 3; k++) skin.push(acc[k] / SKIN.length);
        for (let k = 0; k < 3; k++) skin.push(Math.sqrt(Math.max(0, acc2[k] / SKIN.length - skin[k] * skin[k])));
      }
      onResult(toTracked({ lm, z, bs, mat: r.facialTransformationMatrixes?.[0]?.data ?? null, skin }), performance.now() - t0);
    },
    close() { try { lmk.close(); } catch { /* already gone */ } },
  };
}
