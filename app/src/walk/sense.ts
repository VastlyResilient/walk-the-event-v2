import * as THREE from 'three';
import type { Floor } from '../core/data';

/**
 * What the footage knows about the space around the guide, sampled a few times a second: a coarse grid of depth,
 * people mask and colour over the image, shrunk off the main thread. The brain uses it to keep her on visible floor
 * (not on rails, in walls or over a drop), out of people, and the app uses it to light her like the room around her.
 */
export const GW = 36;
export const GH = 64;

/** sRGB 8-bit -> linear, so values match what the shaders read from the sRGB footage texture. */
const SRGB_LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });

export interface Person { x: number; z: number; dist: number }

export class SceneSense {
  private busy = false;
  private last = 0;
  /** Latest grid: depth (0..1 disparity), mask (0..1), linear colour; and the frame it came from. */
  depth = new Float32Array(GW * GH);
  mask = new Float32Array(GW * GH);
  color = new Float32Array(GW * GH * 3);
  frame = -1;
  people: Person[] = [];
  floor: Floor | null = null;
  private q = new THREE.Quaternion();
  private qi = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();


  get ready() { return this.frame >= 0; }

  reset(floor: Floor) { this.floor = floor; this.frame = -1; this.people = []; }

  /**
   * Call every animation frame; samples the footage ~6 times a second. The decoded frame is shrunk to a tiny bitmap
   * off the main thread (createImageBitmap with resize) and read from a 108x128 canvas. (A GPU readback looked
   * free in Chrome but stalled Safari's main thread ~50 ms each time, which was the phone stutter.)
   */
  private cv: HTMLCanvasElement | null = null;
  private cx: CanvasRenderingContext2D | null = null;
  private bitmapOk = true;
  private bmFails = 0;
  update(_renderer: THREE.WebGLRenderer, _tex: THREE.Texture | null, frame: number, floor: Floor, src?: CanvasImageSource | VideoFrame | null) {
    if (floor !== this.floor) { this.floor = floor; this.frame = -1; this.people = []; }
    const now = performance.now();
    if (this.busy || !src || now - this.last < 160 || frame < 0) return;
    if ((src as VideoFrame).codedWidth === 0) return; // a VideoFrame closed by the decoder cache
    this.last = now;
    this.busy = true;
    const PW = GW * 3, PH = GH * 2; // packed frame = [colour 2/3 | depth over mask 1/3]
    if (!this.cv) { this.cv = document.createElement('canvas'); this.cv.width = PW; this.cv.height = PH; this.cx = this.cv.getContext('2d', { willReadFrequently: true }); }
    const f = Math.round(frame);
    const read = (img: CanvasImageSource) => {
      const cx = this.cx!;
      cx.drawImage(img, 0, 0, PW, PH);
      return cx.getImageData(0, 0, PW, PH).data;
    };
    const done = (px: Uint8ClampedArray | null) => {
      this.busy = false;
      if (!px || this.floor !== floor) return;
      const lin = SRGB_LIN;
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const k = j * GW + i;
          // colour: left 2/3 (2x2 average) ; depth: right 1/3 top half ; mask: right 1/3 bottom half
          let r = 0, g = 0, b = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const o = ((j * 2 + dy) * PW + i * 2 + dx) * 4; r += lin[px[o]]; g += lin[px[o + 1]]; b += lin[px[o + 2]]; }
          this.color[k * 3] = r / 4; this.color[k * 3 + 1] = g / 4; this.color[k * 3 + 2] = b / 4;
          this.depth[k] = px[(j * PW + GW * 2 + i) * 4] / 255; // depth / mask are data, not colour: raw values
          this.mask[k] = px[((j + GH) * PW + GW * 2 + i) * 4] / 255;
        }
      }
      this.frame = f;
      const ls: number[] = [];
      for (let j = GH - 7; j < GH - 1; j++) for (let i = Math.floor(GW * 0.3); i < Math.ceil(GW * 0.7); i++) if (this.mask[j * GW + i] < 0.5) ls.push(this.lumAt(j * GW + i));
      ls.sort((a, b) => a - b);
      this.floorLum = ls.length ? ls[Math.floor(ls.length / 2)] : 0;
      this.findPeople();
    };
    if (this.bitmapOk && typeof createImageBitmap === 'function') {
      createImageBitmap(src as ImageBitmapSource, { resizeWidth: PW, resizeHeight: PH, resizeQuality: 'low' })
        .then((bm) => { this.bmFails = 0; const px = read(bm); bm.close(); done(px); })
        .catch(() => { if (++this.bmFails > 3) this.bitmapOk = false; done(null); }); // (a frame closed mid-call is fine to skip)
    } else {
      try { done(read(src as CanvasImageSource)); } catch { done(null); }
    }
  }

  /** World point -> image uv (0..1, v down) and camera depth, using the camera of the sensed frame. */
  toImage(p: THREE.Vector3, out = { u: 0, v: 0, z: 0 }) {
    const cam = this.floor!.cam, f = this.frame, I = cam.intrinsics;
    this.q.fromArray(cam.quat, f * 4);
    this.qi.copy(this.q).invert();
    this.v.set(p.x - cam.pos[f * 3], p.y - cam.pos[f * 3 + 1], p.z - cam.pos[f * 3 + 2]).applyQuaternion(this.qi);
    const z = -this.v.z;
    if (z < 0.15) return null;
    out.u = I.cx + (I.fx * this.v.x) / z;
    out.v = I.cy - (I.fy * this.v.y) / z;
    out.z = z;
    return out;
  }

  floorLum = 0;
  private lumAt(k: number) { return 0.2126 * this.color[k * 3] + 0.7152 * this.color[k * 3 + 1] + 0.0722 * this.color[k * 3 + 2]; }

  /**
   * Optional per-frame depth fit re-calibrated to the floor (nav map `da`/`db`, set by the guide brain). The solve's
   * own fit was made on far feature points and reads the near floor ~15-30 % short, which made a clear floor under
   * her feet look like "something in front of her feet".
   */
  fitAt: ((frame: number) => number[] | null) | null = null;

  metric(d: number) {
    const cam = this.floor!.cam, fit = this.fitAt?.(this.frame);
    const a = fit ? fit[0] : cam.depth_a[this.frame] ?? 1, b = fit ? fit[1] : cam.depth_b[this.frame] ?? 0.16;
    return 1 / Math.max(0.05, a * d + b);
  }

  cell(u: number, v: number) {
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    return Math.min(GH - 1, Math.floor(v * GH)) * GW + Math.min(GW - 1, Math.floor(u * GW));
  }

  /**
   * How blocked is a guide standing at p? 0 = clear floor, 1 = clearly wrong (inside a wall, behind a rail,
   * over a drop, or overlapping a person). Points the camera can't see count as unknown (no penalty).
   */
  blocked(p: THREE.Vector3): number {
    if (!this.ready || !this.floor) return 0;
    let bad = 0, n = 0;
    const o = { u: 0, v: 0, z: 0 };
    // feet: the floor under her must be visible at the depth it should be
    for (const dx of [-0.16, 0, 0.16]) {
      const r = this.toImage(this.w.set(p.x + dx, p.y + 0.04, p.z), o);
      if (!r) continue;
      const k = this.cell(r.u, r.v);
      if (k < 0) continue;
      n++;
      const zo = this.metric(this.depth[k]);
      if (zo < r.z * 0.8 - 0.1) bad += 1.6; // something in front of her feet: rail, plinth, bench, wall, person
      else if (this.floorLum > 0.004 && this.lumAt(k) < this.floorLum * 0.3) bad += 1.2; // far darker than the floor: the top of a black cube / bench (depth misses those)
      else if (r.z < 3.2 && zo > r.z * 2.1 + 1.0) bad += 1.6; // floor far beyond where it should be: a real drop (balcony edge). Dark floors read a bit far, so the margin is wide
    }
    // body: hips, chest, head; nothing solid in front of her, and no person right where she stands
    for (const hy of [0.55, 1.05, 1.5]) {
      for (const dx of [-0.18, 0.18]) {
        const r = this.toImage(this.w.set(p.x + dx, p.y + hy, p.z), o);
        if (!r) continue;
        const k = this.cell(r.u, r.v);
        if (k < 0) continue;
        n++;
        const zo = this.metric(this.depth[k]);
        const person = this.mask[k] > 0.45;
        if (person && Math.abs(zo - r.z) < 1.3) bad += 1.4; // she'd be standing inside / bumping that person
        else if (zo < r.z * 0.7 - 0.25) bad += 0.8; // a wall, column or a person between us and her (she'd be hidden)
      }
    }
    for (const pp of this.people) { const d = Math.hypot(pp.x - p.x, pp.z - p.z); if (d < 0.75) bad += 2 * (1 - d / 0.75); }
    return n ? Math.min(1, bad / Math.max(3, n * 0.5)) : 0;
  }

  /** People on the floor near the camera, from the mask's lowest cells per column run, unprojected with depth. */
  private findPeople() {
    const cam = this.floor!.cam, f = this.frame, I = cam.intrinsics;
    this.q.fromArray(cam.quat, f * 4);
    const out: Person[] = [];
    let i = 0;
    while (i < GW) {
      // a run of columns containing a person
      const col = (x: number) => { let lo = -1; for (let j = GH - 1; j >= GH * 0.25; j--) if (this.mask[j * GW + x] > 0.5) { lo = j; break; } return lo; };
      let lo = col(i);
      if (lo < 0) { i++; continue; }
      let i1 = i, foot = lo;
      while (i1 + 1 < GW && col(i1 + 1) >= 0) { i1++; foot = Math.max(foot, col(i1)); }
      // depth: median-ish of masked cells above the feet in this run
      const ds: number[] = [];
      for (let x = i; x <= i1; x++) for (let j = Math.max(0, foot - 14); j <= foot; j++) if (this.mask[j * GW + x] > 0.5) ds.push(this.depth[j * GW + x]);
      ds.sort((a, b) => a - b);
      const z = this.metric(ds[Math.floor(ds.length / 2)] ?? 0);
      const u = (i + i1 + 1) / 2 / GW;
      if (z < 7) {
        // camera-space ray through the run's centre at depth z -> world, dropped to the floor
        this.v.set(((u - I.cx) / I.fx) * z, 0, -z).applyQuaternion(this.q);
        const x = cam.pos[f * 3] + this.v.x, wz = cam.pos[f * 3 + 2] + this.v.z;
        // wide runs are groups: one point per ~0.6 m of width
        const width = ((i1 - i + 1) / GW / I.fx) * z;
        const nP = Math.max(1, Math.min(4, Math.round(width / 0.6)));
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q).setY(0).normalize();
        for (let k = 0; k < nP; k++) {
          const off = nP > 1 ? (k / (nP - 1) - 0.5) * width * 0.8 : 0;
          out.push({ x: x + right.x * off, z: wz + right.z * off, dist: z });
        }
      }
      i = i1 + 1;
    }
    this.people = out;
  }

  /**
   * Average linear colour of the footage around a screen-space box in image uv (for lighting her like the room).
   * `bright` weights each cell by its own brightness, so a few light fixtures in the box count as light, not as a
   * small share of a dark ceiling.
   */
  ambientAround(u0: number, v0: number, u1: number, v1: number, out: THREE.Color, bright = false) {
    if (!this.ready) return null;
    let r = 0, g = 0, b = 0, n = 0;
    const i0 = Math.max(0, Math.floor(u0 * GW)), i1 = Math.min(GW - 1, Math.ceil(u1 * GW));
    const j0 = Math.max(0, Math.floor(v0 * GH)), j1 = Math.min(GH - 1, Math.ceil(v1 * GH));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j * GW + i) * 3, w = bright ? this.lumAt(j * GW + i) + 1e-4 : 1;
      r += this.color[k] * w; g += this.color[k + 1] * w; b += this.color[k + 2] * w; n += w;
    }
    if (!n) return null;
    return out.setRGB(r / n, g / n, b / n);
  }
}
