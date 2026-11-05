import * as THREE from 'three';
import { asset, type Station } from '../core/data';
import { CARD_INSET_EVENT, type CardInset } from '../ui/card';
import { h, reducedMotion } from '../ui/dom';

type PodMeta = Record<string, { intrinsic: number[]; image_size: number[]; z_med: number }>;
let metaP: Promise<PodMeta> | null = null;
const podMeta = () => (metaP ??= fetch(asset('media/pods/meta.json')).then((r) => r.json()).catch((e) => { metaP = null; throw e; }));

// How far a single-photo splat can be pushed before it shows its seams (measured on all six pods).
const YAW_MAX = 0.3; // ~17°
const PITCH_MAX = 0.122; // ~7°
const ZOOM_MIN = -0.18; // lerp toward the pivot, relative to the 0.22 walk-up (0.04 = near the photo's own viewpoint)
const ZOOM_MAX = 0.2; // 0.42: closer and splats near the lens start to smear
const coarse = () => matchMedia('(pointer: coarse)').matches;
const tiltIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2.5" transform="rotate(-14 12 12)"/><path d="M3.5 9.5a9 9 0 0 0 0 5M20.5 9.5a9 9 0 0 1 0 5"/></svg>';

/** Soft limit: free inside ±lim, then increasingly stiff (rubber band) up to ~1.25·lim. */
const soft = (v: number, lim: number) => {
  const a = Math.abs(v);
  if (a <= lim) return v;
  const over = a - lim;
  return Math.sign(v) * (lim + (over / (1 + over / (lim * 0.25))));
};

/**
 * Photoreal station pod: the hero photo crossfades into its SHARP Gaussian splat (rendered with Spark) from the
 * identical viewpoint. Then it's yours to play with, inside what a single-photo splat can show: inertial drag
 * (±17° yaw, ±7° pitch, rubber-banded), pinch / wheel dolly, device-tilt parallax on phones, a slow breathing
 * orbit when idle, and double-tap to reset.
 */
export class PodViewer {
  layer = h('div', { class: 'pod-layer', 'aria-hidden': 'true' });
  private poster = h('img', { class: 'poster', alt: '' }) as HTMLImageElement;
  /** Same photo, blurred and dimmed, behind everything: whatever the splat can't cover (past its edges) reads as soft backdrop. */
  private back = h('img', { class: 'pod-back', alt: '' }) as HTMLImageElement;
  private badge = h('div', { class: 'pod-badge' }, '3D photo');
  private tiltBtn = h('button', { class: 'pod-tilt', 'aria-pressed': 'false', 'aria-label': 'Tilt your phone to look around', html: `${tiltIcon}<span>Tilt to look</span>` });
  /** Small corner hints (bottom-left of the visible photo, clear of the subject); they fade after ~3 s or the first touch. */
  private hints = h('div', { class: 'pod-hints' }, this.badge, this.tiltBtn);
  private hintTimer = 0;
  private maskKey = '';
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  private mesh: any = null;
  private spark: any = null;
  private zMed = 2;
  private t = 0;
  // view state (radians / dolly fraction) with velocities for inertia
  private yaw = 0;
  private pitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private zoom = 0;
  private zoomT = 0;
  private breath = 0; // 0..1 idle orbit weight
  private idle = 0; // seconds since the last touch
  private resetting = false;
  private tilt = { on: false, yaw: 0, pitch: 0, sYaw: 0, sPitch: 0, b0: NaN, g0: NaN };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; z: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  private touchedOnce = false;
  private active = false;
  private raf = 0;
  private dragging = false;
  private fovPhoto = 60;
  private aspectPhoto = 0.75;
  rightInset = 0;
  bottomInset = 0;
  private insetT = { r: 0, b: 0 };
  private lastT = 0;
  private openId = '';
  private pivot = new THREE.Vector3();
  /** True once the pod fully covers the screen (the walk can stop rendering underneath). */
  get covering() { return this.active && this.layer.classList.contains('on') && !this.layer.classList.contains('clip') && this.layer.style.opacity !== '0'; }

  constructor(parent: HTMLElement) {
    this.layer.append(this.back, this.poster, this.hints);
    parent.append(this.layer);
    const L = this.layer;
    L.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.pod-tilt')) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { L.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      this.dragging = true;
      this.resetting = false;
      this.poke();
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.zoomT };
      }
      // double-tap (or double-click) anywhere on the photo: back to the photo's own view
      const now = performance.now();
      if (this.pointers.size === 1 && now - this.lastTap.t < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 40) {
        this.reset();
        this.lastTap.t = 0;
      } else this.lastTap = { t: now, x: e.clientX, y: e.clientY };
      // Android: tilt needs no permission prompt, so the first touch turns it on
      if (!this.tilt.on && coarse() && 'DeviceOrientationEvent' in window && typeof (DeviceOrientationEvent as any).requestPermission !== 'function') this.enableTilt();
    });
    L.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.zoomT = THREE.MathUtils.clamp(this.pinch.z + Math.log(d / this.pinch.d) * 0.42, ZOOM_MIN, ZOOM_MAX);
        this.poke();
        return;
      }
      // finger drags the scene (drag right = look from the left); rubber-band past the limits
      const kx = 1 / Math.max(320, Math.min(innerWidth, 900));
      const resist = (v: number, lim: number, d: number) => (Math.sign(d) === Math.sign(v) && Math.abs(v) > lim ? 0.3 : 1);
      const ddy = dx * kx * 0.62 * resist(this.yaw, YAW_MAX, dx);
      const ddp = dy * kx * 0.32 * resist(this.pitch, PITCH_MAX, dy);
      this.yaw += ddy;
      this.pitch += ddp;
      // velocity for the fling (per 60 Hz frame), smoothed
      this.vYaw = this.vYaw * 0.5 + ddy * 0.5;
      this.vPitch = this.vPitch * 0.5 + ddp * 0.5;
      this.poke();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) this.dragging = false;
    };
    L.addEventListener('pointerup', up);
    L.addEventListener('pointercancel', up);
    L.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      this.zoomT = THREE.MathUtils.clamp(this.zoomT - d * (e.ctrlKey ? 0.004 : 0.0012), ZOOM_MIN, ZOOM_MAX); // ctrlKey = trackpad pinch
      this.resetting = false;
      this.poke();
    }, { passive: false });
    // iOS Safari: keep a two-finger pinch on the pod from zooming the page
    L.addEventListener('gesturestart', (e) => e.preventDefault());
    this.tiltBtn.addEventListener('click', (e) => { e.stopPropagation(); if (this.tilt.on) this.disableTilt(); else this.enableTilt(); });
    this.tiltBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    addEventListener(CARD_INSET_EVENT, (e) => { const d = (e as CustomEvent<CardInset>).detail; this.insetT = { r: d.right, b: d.bottom }; this.placeHints(); });
    addEventListener('resize', () => this.resize());
  }

  private poke() {
    this.idle = 0;
    if (!this.touchedOnce) { this.touchedOnce = true; this.quietHints(); }
  }

  private quietHints() { clearTimeout(this.hintTimer); this.hints.classList.add('quiet'); }
  private placeHints() {
    this.layer.style.setProperty('--pod-hint-b', `${Math.round(this.insetT.b)}px`);
    // (the poster, shown until the 3D photo is ready, fills what the station panel leaves free, like the 3D view)
    this.layer.style.setProperty('--pod-b', `${Math.round(this.insetT.b)}px`);
    this.layer.style.setProperty('--pod-r', `${Math.round(this.insetT.r)}px`);
  }

  /** Back to the photo's own viewpoint (double-tap). */
  reset() { this.resetting = true; this.vYaw = this.vPitch = 0; this.zoomT = 0; }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const ang = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
    // portrait: gamma = left/right, beta = forward/back; landscape swaps them
    let lr = e.gamma, fb = e.beta;
    if (ang === 90) { lr = e.beta; fb = -e.gamma; } else if (ang === -90 || ang === 270) { lr = -e.beta; fb = e.gamma; }
    const T = this.tilt;
    if (Number.isNaN(T.g0)) { T.g0 = lr; T.b0 = fb; }
    // high-pass: the neutral pose follows how you're holding the phone, so it never drifts off to a limit
    T.g0 += (lr - T.g0) * 0.012;
    T.b0 += (fb - T.b0) * 0.012;
    T.yaw = THREE.MathUtils.clamp((lr - T.g0) / 22, -1, 1) * YAW_MAX * 0.75;
    T.pitch = THREE.MathUtils.clamp((fb - T.b0) / 22, -1, 1) * PITCH_MAX * 0.7;
  };

  async enableTilt() {
    const DOE = (window as any).DeviceOrientationEvent;
    if (!DOE) return;
    try {
      // iOS 13+: must be asked from inside a user gesture (this runs from the button's click)
      if (typeof DOE.requestPermission === 'function' && (await DOE.requestPermission()) !== 'granted') { this.tiltBtn.querySelector('span')!.textContent = 'Tilt blocked'; return; }
    } catch { return; }
    this.tilt.on = true;
    this.tilt.g0 = this.tilt.b0 = NaN;
    addEventListener('deviceorientation', this.onOrient);
    this.tiltBtn.setAttribute('aria-pressed', 'true');
    this.tiltBtn.querySelector('span')!.textContent = 'Tilt on';
  }

  private disableTilt() {
    this.tilt.on = false;
    this.tilt.yaw = this.tilt.pitch = 0;
    removeEventListener('deviceorientation', this.onOrient);
    this.tiltBtn.setAttribute('aria-pressed', 'false');
    this.tiltBtn.querySelector('span')!.textContent = 'Tilt to look';
  }

  /** Build the splat renderer ahead of time (first station in view), so the first open doesn't hitch. */
  private warmP: Promise<any> | null = null;
  warm() {
    return (this.warmP ??= this.preload().then((mod) => { if (mod) this.ensureRenderer(mod); return mod; }));
  }
  /** Download the splat module into the HTTP cache without evaluating it (false: no chunk name, i.e. dev). */
  prefetch(): Promise<boolean> {
    const url = document.querySelector<HTMLMetaElement>('meta[name="spark-chunk"]')?.content;
    if (!url) return Promise.resolve(false);
    return fetch(url, { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).then(() => true, () => true);
  }
  /** Fetch + evaluate the splat module only (no renderer yet): the heavy, early part, meant for the intro. */
  private modP: Promise<any> | null = null;
  preload() {
    return (this.modP ??= import('@sparkjsdev/spark').catch(() => { this.modP = null; this.warmP = null; return null; }));
  }

  private ensureRenderer(mod: any) {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    // splats are fill-rate heavy and Spark sorts per rendered frame: phones render them at 1.25x
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, coarse() ? 1.25 : 2));
    this.renderer.domElement.style.opacity = '0';
    this.renderer.domElement.style.transition = 'none';
    this.layer.insertBefore(this.renderer.domElement, this.poster);
    this.scene = new THREE.Scene();
    this.spark = new mod.SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);
  }

  /** Load the pod without showing it (the walk keeps playing the camera move on top). */
  prepare(s: Station) {
    this.layer.style.transition = 'none';
    this.layer.style.opacity = '0';
    this.open(s);
  }

  /** Quick cut from the walk to the pod. */
  reveal(secs: number) {
    this.t = 0; // walk-up starts at the cut
    void this.layer.offsetWidth;
    this.layer.style.transition = `opacity ${secs}s ease-out`;
    this.layer.style.opacity = '1';
    setTimeout(() => { this.layer.style.transition = ''; this.layer.style.opacity = ''; }, secs * 1000 + 50);
  }

  private seq = 0;
  /** True while an AI clip is on screen (it covers the walk). */
  clipShowing = false;
  private rendered = 0;
  async open(s: Station, dir = 0) {
    const switching = this.active && this.openId !== s.id && dir !== 0;
    const my = ++this.seq;
    const current = () => this.active && this.seq === my;
    this.active = true;
    this.openId = s.id;
    this.touchedOnce = false;
    this.badge.textContent = coarse() ? '3D · drag · pinch' : '3D · drag · scroll';
    this.hints.classList.remove('quiet');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.quietHints(), 3200);
    this.placeHints();
    this.tiltBtn.classList.toggle('show', coarse() && 'DeviceOrientationEvent' in window && typeof (DeviceOrientationEvent as any).requestPermission === 'function');
    const url = asset(s.hero_url);
    this.back.src = url;
    this.maskKey = '';
    this.renderer?.domElement.style.removeProperty('mask-image');
    this.renderer?.domElement.style.removeProperty('-webkit-mask-image');
    if (switching) await this.crossfadePoster(url, dir, current);
    else { this.poster.style.transition = 'none'; this.poster.src = url; this.poster.style.opacity = '1'; }
    if (!current()) return;
    this.layer.classList.add('on');
    // per-pod grade: the merch photos were shot under deep UV-blue light, lift them so the prints read
    const grade = s.id === 'merch' ? 'brightness(1.28) saturate(0.85)' : '';
    this.layer.style.filter = grade;
    this.yaw = this.pitch = this.vYaw = this.vPitch = 0;
    this.zoom = this.zoomT = 0;
    this.breath = 0;
    this.idle = 0;
    this.t = 0;
    // gallery: while someone flicks through quickly, don't start a splat load for every station they pass
    if (switching) { await new Promise((r) => setTimeout(r, 380)); if (!current()) return; }
    let meta: PodMeta[string] | undefined;
    try { meta = (await podMeta())[s.id]; } catch { meta = undefined; }
    if (!current()) return;
    if (!meta) { this.badge.textContent = 'Photo'; return; }
    const [W, H] = meta.image_size;
    this.fovPhoto = (2 * Math.atan(H / 2 / meta.intrinsic[4]) * 180) / Math.PI;
    this.aspectPhoto = W / H;
    this.zMed = meta.z_med;
    try {
      const mod = await this.warm();
      if (!mod) throw new Error('spark unavailable');
      if (!current()) return;
      this.ensureRenderer(mod);
      this.renderer!.domElement.style.opacity = '0';
      this.disposeMesh();
      this.mesh = new mod.SplatMesh({ url: asset(s.pod_url) });
      this.mesh.quaternion.set(1, 0, 0, 0); // OpenCV -> OpenGL
      this.scene!.add(this.mesh);
      this.resize();
      this.loop();
      const mine = this.mesh;
      await mine.initialized;
      if (!current() || this.mesh !== mine) return;
      // render a few frames at the exact photo pose underneath the photo, then fade only the photo away:
      // the splat is already fully opaque below it, so there's no dip through the black background
      this.rendered = 0;
      const revealSplat = () => {
        if (!current() || this.mesh !== mine) return;
        if (this.rendered < 4) { requestAnimationFrame(revealSplat); return; } // never reveal a canvas that hasn't drawn yet
        const c = this.renderer!.domElement;
        c.style.transition = 'none';
        c.style.opacity = '1';
        this.poster.style.transition = 'opacity 0.7s ease';
        this.poster.style.opacity = '0';
      };
      setTimeout(revealSplat, 350);
    } catch (e) {
      if (!current()) return; // superseded by another station, not a failure
      console.warn('pod fallback to photo', e);
      this.badge.textContent = 'Photo';
    }
  }

  private resize() {
    if (!this.renderer) return;
    this.renderer.setSize(innerWidth, innerHeight);
    this.project();
  }

  /** Projection for the visible area (left of the card / above the sheet): the photo is centred in it and covers it. */
  private project() {
    const W = innerWidth, H = innerHeight, r = this.rightInset, bI = this.bottomInset;
    const w = W - r, h = H - bI; // (the station panel is opaque: the room is framed in exactly what it leaves free)
    const hfovPhoto = 2 * Math.atan(Math.tan((this.fovPhoto * Math.PI) / 360) * this.aspectPhoto);
    const needV = 2 * Math.atan(Math.tan(hfovPhoto / 2) * (h / w));
    const fovVis = Math.min((this.fovPhoto * Math.PI) / 180, needV) * 0.96;
    // Full virtual frame = canvas + insets; the canvas is a sub-window of it, so the photo centre sits mid-visible-area.
    const fullW = W + r, fullH = H + (H - h);
    this.camera.aspect = fullW / fullH;
    this.camera.fov = (2 * Math.atan(Math.tan(fovVis / 2) * (fullH / h)) * 180) / Math.PI;
    // (phones: a portrait photo cropped to the wide strip above the panel showed mostly ceiling, the station low in
    // the frame; look a little lower, where the work hangs; the photo still covers the strip)
    const lower = bI > 0 ? Math.min(0.22 * h, (Math.tan((this.fovPhoto * Math.PI) / 360) / Math.tan(fovVis / 2) - 1) * h * 0.5) : 0;
    this.camera.setViewOffset(fullW, fullH, r, H - h + Math.max(0, lower), W, H);
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.active || !this.renderer) return;
    this.raf = requestAnimationFrame(this.loop);
    // an interactive recreation is open on top: no splat work at all
    if (document.body.classList.contains('ix-open')) { this.lastT = 0; return; }
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 1 / 60; // real time: same motion at 30 or 120 Hz
    this.lastT = now;
    this.t += dt;
    this.idle += dt;
    const k60 = dt * 60;
    const rm = reducedMotion();
    // the card's footprint changed (peek height measured, panel resized): glide the framing to it
    if (Math.abs(this.insetT.r - this.rightInset) > 0.5 || Math.abs(this.insetT.b - this.bottomInset) > 0.5) {
      const k = 1 - Math.pow(0.0008, dt);
      this.rightInset += (this.insetT.r - this.rightInset) * k;
      this.bottomInset += (this.insetT.b - this.bottomInset) * k;
      this.project();
    }
    if (!this.dragging) {
      // fling: inertia with friction, then springs back inside the limits
      this.yaw += this.vYaw * k60;
      this.pitch += this.vPitch * k60;
      this.vYaw *= Math.pow(0.93, k60);
      this.vPitch *= Math.pow(0.9, k60);
      const spring = (v: number, lim: number) => (Math.abs(v) > lim ? (Math.sign(v) * lim - v) * (1 - Math.pow(0.82, k60)) : 0);
      this.yaw += spring(this.yaw, YAW_MAX);
      this.pitch += spring(this.pitch, PITCH_MAX);
      if (this.resetting) {
        const k = 1 - Math.pow(0.86, k60);
        this.yaw -= this.yaw * k;
        this.pitch -= this.pitch * k;
        if (Math.abs(this.yaw) + Math.abs(this.pitch) < 0.002 && Math.abs(this.zoom) < 0.002) this.resetting = false;
      } else if (this.idle > 3.5) {
        // left alone: drift slowly home, where the splat looks its best
        const k = 1 - Math.pow(0.992, k60);
        this.yaw -= this.yaw * k;
        this.pitch -= this.pitch * k;
      }
    } else {
      this.vYaw *= Math.pow(0.6, k60); // finger resting: no fling on release
      this.vPitch *= Math.pow(0.6, k60);
    }
    this.zoom += (this.zoomT - this.zoom) * (1 - Math.pow(0.85, k60));
    // idle breathing orbit: a slow figure-eight that fades in when nobody's touching
    const wantBreath = rm ? 0 : this.idle > 2.2 ? 1 : 0;
    this.breath += (wantBreath - this.breath) * (1 - Math.pow(0.985, k60));
    const ramp = Math.min(1, this.t / 2.5);
    const b = this.breath * ramp;
    // device tilt, low-passed so hand tremor doesn't shimmer the splat
    const kt = 1 - Math.pow(0.88, k60);
    this.tilt.sYaw += (this.tilt.yaw - this.tilt.sYaw) * kt;
    this.tilt.sPitch += (this.tilt.pitch - this.tilt.sPitch) * kt;
    const yaw = soft(this.yaw + this.tilt.sYaw + b * 0.11 * Math.sin(this.t * 0.31), YAW_MAX);
    const pitch = soft(this.pitch + this.tilt.sPitch + b * 0.035 * Math.sin(this.t * 0.62 + 0.8), PITCH_MAX);
    const r = this.zMed;
    this.pivot.set(0, 0, -r);
    this.camera.position.set(Math.sin(yaw) * Math.cos(pitch) * r, Math.sin(pitch) * r, -r + Math.cos(yaw) * Math.cos(pitch) * r);
    // walk up to the work: an ease-out push from the photo's viewpoint over the first 1.4 s, then a slow breath
    const walkUp = rm ? 0.12 : 0.22 * (1 - Math.pow(1 - Math.min(1, this.t / 1.4), 3));
    const dolly = THREE.MathUtils.clamp(walkUp + this.zoom + b * 0.02 * Math.sin(this.t * 0.2), 0.02, 0.44);
    this.camera.position.lerp(this.pivot, dolly);
    this.camera.lookAt(this.pivot);
    const visible = this.layer.classList.contains('on') && !this.layer.classList.contains('clip') && this.layer.style.opacity !== '0';
    if (visible) { this.updateMask(); this.renderer.render(this.scene!, this.camera); this.rendered++; }
  };

  /**
   * A single photo only covers its own frustum: past its edges the splat smears into stretched streaks (most visible on
   * desktop, where the photo is framed left of the card and the breathing orbit swings an edge into view). Project the
   * photo's edge rays (a little past the median depth) and feather the canvas out just inside them; the blurred copy
   * of the photo underneath fills the rest.
   */
  private edgeV = new THREE.Vector3();
  private updateMask() {
    if (!this.renderer || !this.mesh) return;
    const W = innerWidth, H = innerHeight;
    const ty = Math.tan((this.fovPhoto * Math.PI) / 360), tx = ty * this.aspectPhoto;
    // a little past the median depth: background beyond it may smear a touch under the feather, nearer content (pushed
    // outward by the walk-up dolly) is kept
    const D = this.zMed * 1.7;
    const P = (x: number, y: number) => {
      this.edgeV.set(x * tx * D, y * ty * D, -D).project(this.camera);
      return [((this.edgeV.x + 1) / 2) * W, ((1 - this.edgeV.y) / 2) * H];
    };
    // the projected frame is a slightly keystoned quad under yaw/pitch: take its inner bounding box
    const tl = P(-1, 1), tr = P(1, 1), bl = P(-1, -1), br = P(1, -1);
    const L = Math.max(tl[0], bl[0]), R = Math.min(tr[0], br[0]), T = Math.max(tl[1], tr[1]), B = Math.min(bl[1], br[1]);
    const f = Math.max(24, Math.min(W, H) * 0.06); // feather
    const q = (v: number) => Math.round(v / 2) * 2;
    const key = `${q(L)}|${q(R)}|${q(T)}|${q(B)}|${W}x${H}`;
    if (key === this.maskKey) return;
    this.maskKey = key;
    const c = this.renderer.domElement.style;
    if (L <= -f && R >= W + f && T <= -f && B >= H + f) { c.removeProperty('mask-image'); c.removeProperty('-webkit-mask-image'); return; }
    const hz = `linear-gradient(90deg, transparent ${q(L)}px, #000 ${q(L + f)}px, #000 ${q(R - f)}px, transparent ${q(R)}px)`;
    const vt = `linear-gradient(180deg, transparent ${q(T)}px, #000 ${q(T + f)}px, #000 ${q(B - f)}px, transparent ${q(B)}px)`;
    c.setProperty('mask-image', `${hz}, ${vt}`);
    c.setProperty('-webkit-mask-image', `${hz}, ${vt}`);
    c.setProperty('mask-composite', 'intersect');
    c.setProperty('-webkit-mask-composite', 'source-in');
  }

  /** Play an AI camera-move clip full-screen (first frame == current walk frame). Resolves when done. */
  playTransition(url: string, overscan: number, col?: { x: number; w: number }, onFirstFrame?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const v = h('video', { class: 'transition', muted: true, playsinline: true, preload: 'auto' }) as HTMLVideoElement;
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      v.playbackRate = url.includes('_rev') ? 2.4 : 1.7;
      v.defaultPlaybackRate = v.playbackRate;
      v.style.transform = `scale(${overscan})`;
      if (col) { v.style.left = `${col.x}px`; v.style.width = `${col.w}px`; v.style.right = 'auto'; v.style.overflow = 'hidden'; v.style.clipPath = 'inset(0)'; }
      v.style.opacity = '0';
      v.style.transition = 'opacity 0.16s';
      this.layer.append(v);
      this.layer.classList.add('on', 'clip');
      this.layer.style.transition = 'none';
      this.layer.style.opacity = '1';
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.clipShowing = false;
        this.t = 0; // the pod's walk-up starts as the clip lands
        v.style.transition = 'opacity 0.5s 0.15s';
        v.style.opacity = '0';
        setTimeout(() => v.remove(), 600);
        this.layer.style.transition = '';
        this.layer.style.opacity = '';
        this.layer.classList.remove('clip');
        resolve();
      };
      v.addEventListener('playing', () => { v.style.opacity = '1'; setTimeout(() => { if (!done) this.clipShowing = true; }, 180); onFirstFrame?.(); }, { once: true });
      v.addEventListener('ended', finish);
      v.addEventListener('error', finish);
      setTimeout(finish, 9000);
      v.play().catch(finish);
    });
  }

  /** Snap the framing to these insets (the card refines them later through CARD_INSET_EVENT, smoothly). */
  setInset(right: number, bottom = 0) {
    this.rightInset = right; this.bottomInset = bottom;
    this.insetT = { r: right, b: bottom };
    this.resize();
  }

  private disposeMesh() {
    if (this.mesh) { this.scene?.remove(this.mesh); this.mesh.dispose?.(); this.mesh = null; }
  }

  /** Gallery: decode the next photo first, then slide-crossfade it over the current one (no black flash). */
  private async crossfadePoster(url: string, dir: number, current: () => boolean) {
    const next = h('img', { class: 'poster', alt: '' }) as HTMLImageElement;
    next.src = url;
    try { await next.decode(); } catch { /* show it anyway */ }
    if (!current()) return; // a later swipe already took over
    const old = this.poster;
    // the old photo (same view as the splat) snaps back on under everything, then the splat fades off it
    old.style.transition = 'none';
    old.style.transform = 'none';
    old.style.opacity = '1';
    void old.offsetWidth;
    if (this.renderer) { this.renderer.domElement.style.transition = 'opacity 0.25s ease'; this.renderer.domElement.style.opacity = '0'; }
    next.style.transition = 'none';
    next.style.opacity = '0';
    next.style.transform = `translateX(${dir * 6}%) scale(1.04)`;
    this.layer.insertBefore(next, this.hints);
    void next.offsetWidth;
    next.style.transition = 'opacity 0.45s ease, transform 0.6s cubic-bezier(.2,.8,.2,1)';
    next.style.opacity = '1';
    next.style.transform = 'none';
    old.style.transition = 'opacity 0.45s ease, transform 0.6s cubic-bezier(.2,.8,.2,1)';
    old.style.transform = `translateX(${-dir * 4}%) scale(0.98)`;
    this.poster = next;
    setTimeout(() => { old.remove(); if (this.poster === next) next.style.transition = ''; }, 620);
    await new Promise((r) => setTimeout(r, 260));
  }

  close(fade = 0.28) {
    clearTimeout(this.hintTimer);
    this.layer.style.transition = `opacity ${fade}s ease-out`;
    setTimeout(() => { if (!this.active) this.layer.style.transition = ''; }, fade * 1000 + 60);
    this.active = false;
    this.openId = '';
    this.lastT = 0;
    this.pointers.clear();
    this.dragging = false;
    this.pinch = null;
    cancelAnimationFrame(this.raf);
    this.layer.classList.remove('on');
    if (this.renderer) this.renderer.domElement.style.opacity = '0';
    setTimeout(() => { if (!this.active) this.disposeMesh(); }, 700);
  }
}
