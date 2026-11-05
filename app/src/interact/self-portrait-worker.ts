/*
 * "Self Portrait" face tracking, off the main thread: MediaPipe Face Landmarker (self-hosted WASM + model) runs here so
 * its start-up (several seconds of WASM / graph set-up) and its per-frame work never stall the picture.
 * A classic worker on purpose: the tasks-vision loader uses importScripts().
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { SKIN } from './self-portrait-skin';

// (typed by hand: the webworker lib would leak worker globals into the whole app's types)
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void; close(): void };
// MediaPipe reports its start-up INFO lines on console.error; keep those out of the page's error log (this worker only)
const cerr = console.error.bind(console);
console.error = (...a: unknown[]) => { if (typeof a[0] === 'string' && /^(INFO|I\d{4}|W\d{4})/.test(a[0])) return; cerr(...a); };
let lmk: FaceLandmarker | null = null;
let lastTs = -1;
const stat = new OffscreenCanvas(96, 72);
const sg = stat.getContext('2d', { willReadFrequently: true })!;

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const fs = await FilesetResolver.forVisionTasks(m.wasm);
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: m.model, delegate },
        runningMode: 'VIDEO' as const, numFaces: 1,
        outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      let delegate: 'GPU' | 'CPU' = 'GPU';
      try { lmk = await FaceLandmarker.createFromOptions(fs, opts('GPU')); } catch { delegate = 'CPU'; lmk = await FaceLandmarker.createFromOptions(fs, opts('CPU')); }
      ctx.postMessage({ type: 'ready', delegate });
    } catch (err) {
      ctx.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) });
    }
  } else if (m.type === 'frame') {
    const bmp = m.bmp as ImageBitmap;
    if (!lmk) { bmp.close(); ctx.postMessage({ type: 'result', face: null, ms: 0 }); return; }
    const t0 = performance.now();
    const ts = Math.max(lastTs + 1, Math.round(m.ts));
    lastTs = ts;
    let face = null;
    const transfer: Transferable[] = [];
    try {
      const r = lmk.detectForVideo(bmp, ts);
      const L = r.faceLandmarks[0];
      if (L) {
        const lm = new Float32Array(L.length * 2), z = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) { lm[i * 2] = L[i].x; lm[i * 2 + 1] = L[i].y; z[i] = L[i].z; }
        const bs: Record<string, number> = {};
        for (const c of r.faceBlendshapes[0]?.categories ?? []) bs[c.categoryName] = c.score;
        const mat = Array.from(r.facialTransformationMatrixes?.[0]?.data ?? []);
        let skin: number[] | null = null;
        if (m.stats) {
          sg.drawImage(bmp, 0, 0, 96, 72);
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
        face = { lm, z, bs, mat, skin };
        transfer.push(lm.buffer, z.buffer);
      }
    } catch (err) {
      console.warn(err);
    }
    bmp.close();
    ctx.postMessage({ type: 'result', face, ms: performance.now() - t0 }, transfer);
  } else if (m.type === 'close') {
    try { lmk?.close(); } catch { /* gone */ }
    lmk = null;
    ctx.close();
  }
};
