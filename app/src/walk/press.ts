import { h } from '../ui/dom';

/**
 * Pressure walk pad (owner: "the more pressure I apply, the quicker she walks; pressed hard she jogs"): two small
 * outline buttons, forward over back. Each press yields a level 0..1 (light = a slow walk, firm = a brisk walk,
 * hard = a jog) from whichever signal this device really has:
 * - force: Touch.force / PointerEvent.pressure, when it varies (3D Touch iPhones, styluses, many Android screens);
 * - contact size: a finger pressed harder flattens, so its contact area grows against this device's lightest touch;
 * - push: sliding the thumb along the arrow while holding (works everywhere, including iPhones since the XR, whose
 *   browsers report no pressure at all, and a mouse).
 * With no pressure signal the level builds over the first second to a brisk walk; a jog then needs the push.
 */
export class PressPad {
  el: HTMLElement;
  /** +1 forward, -1 back, 0 released */
  dir = 0;
  /** smoothed press level 0..1 */
  level = 0;
  jog = false;
  onPress: () => void = () => {};
  readonly fwd: HTMLButtonElement;
  private back: HTMLButtonElement;
  private p: { id: number; btn: HTMLButtonElement; d: number; x0: number; y0: number; t0: number; force: number; area: number; area0: number; push: number } | null = null;
  // what this device reports, learnt over the session
  private forceLo = Infinity;
  private forceHi = -Infinity;
  private areaLight = 0; // lightest touchdown contact seen (CSS px^2)
  private areaLo = Infinity;
  private areaHi = -Infinity;

  constructor(fwdIcon: string, backIcon: string) {
    this.fwd = h('button', { class: 'pad-btn pad-fwd', type: 'button', 'aria-label': 'Walk forward (press harder to go faster)', html: fwdIcon }) as HTMLButtonElement;
    this.back = h('button', { class: 'pad-btn pad-back', type: 'button', 'aria-label': 'Walk back (press harder to go faster)', html: backIcon }) as HTMLButtonElement;
    this.el = h('div', { class: 'pad' }, this.fwd, this.back);
    for (const [btn, d] of [[this.fwd, 1], [this.back, -1]] as const) {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (this.p) return;
        try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
        const area = this.areaOf(e);
        this.p = { id: e.pointerId, btn, d, x0: e.clientX, y0: e.clientY, t0: performance.now(), force: this.forceOf(e), area, area0: area, push: 0 };
        if (area > 0) this.areaLight = this.areaLight ? Math.min(this.areaLight * 1.02, area) : area; // (drifts up slowly: one feather-light tap can't make every press read hard)
        this.dir = d;
        btn.classList.add('active');
        this.onPress();
      });
      btn.addEventListener('pointermove', (e) => {
        const p = this.p;
        if (!p || e.pointerId !== p.id) return;
        p.force = this.forceOf(e) || p.force;
        const a = this.areaOf(e); if (a > 0) p.area = a;
        // push along the arrow: up for forward, down for back
        p.push = Math.max(0, (p.y0 - e.clientY) * p.d);
      });
      const up = (e: PointerEvent) => { if (this.p && e.pointerId === this.p.id) this.release(); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      // Touch.force / radius: iOS reports them on touch events only
      const touch = (e: TouchEvent) => {
        const p = this.p; if (!p) return;
        const t = e.targetTouches[0]; if (!t) return;
        if (t.force > 0) { p.force = t.force; this.seeForce(t.force); }
        if (t.radiusX > 0 && t.radiusY > 0) { const a = Math.PI * t.radiusX * t.radiusY; p.area = a; this.seeArea(a); }
      };
      btn.addEventListener('touchstart', touch, { passive: true });
      btn.addEventListener('touchmove', touch, { passive: true });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private forceOf(e: PointerEvent) {
    // pointer pressure is 0.5 (or 0 / 1) on hardware that can't sense it: only other values count as real
    const f = e.pointerType === 'mouse' ? 0 : e.pressure;
    if (f > 0 && f !== 0.5 && f !== 1) this.seeForce(f);
    return f;
  }
  private areaOf(e: PointerEvent) {
    if (e.pointerType === 'mouse' || !(e.width > 2 && e.height > 2)) return 0;
    const a = (Math.PI / 4) * e.width * e.height;
    this.seeArea(a);
    return a;
  }
  private seeForce(f: number) { this.forceLo = Math.min(this.forceLo, f); this.forceHi = Math.max(this.forceHi, f); }
  private seeArea(a: number) { this.areaLo = Math.min(this.areaLo, a); this.areaHi = Math.max(this.areaHi, a); }
  /** the device has shown a usable pressure signal (it has varied) */
  get sensing() { return this.forceHi - this.forceLo > 0.04 || this.areaHi > this.areaLo * 1.15; }

  release() {
    if (!this.p) return;
    this.p.btn.classList.remove('active', 'jog');
    this.p.btn.style.removeProperty('--p');
    this.p = null;
    this.dir = 0;
  }

  /** Per frame: the press level, the jog latch and the glow. */
  tick(dt: number) {
    const p = this.p;
    let raw = 0;
    if (p) {
      const held = (performance.now() - p.t0) / 1000;
      const ramp = Math.min(1, held / 0.9);
      const sm = ramp * ramp * (3 - 2 * ramp);
      const forceK = this.forceHi - this.forceLo > 0.04 ? Math.max(0, Math.min(1, (p.force - 0.12) / 0.6)) : 0;
      const areaK = this.areaHi > this.areaLo * 1.15 && this.areaLight > 0 ? Math.max(0, Math.min(1, (p.area / this.areaLight - 1.08) / 0.85)) : 0;
      const pushK = Math.max(0, Math.min(1, p.push / 64));
      // light touch on a pressure screen: a slow walk; no pressure signal: the press builds to a brisk walk
      const base = this.sensing ? 0.3 + 0.12 * sm : 0.32 + 0.33 * sm;
      raw = Math.max(base, forceK, areaK, pushK);
    }
    this.level += (raw - this.level) * Math.min(1, dt * (raw > this.level ? 9 : 6));
    if (!p) { this.level = 0; this.jog = false; return; }
    if (!this.jog && this.level > 0.84) this.jog = true;
    else if (this.jog && this.level < 0.7) this.jog = false;
    p.btn.style.setProperty('--p', this.level.toFixed(3));
    p.btn.classList.toggle('jog', this.jog);
  }

  /** Footage pace while pressed, as a multiple of the filmed pace (the guide's pace cap still applies). */
  get rate() {
    if (!this.dir) return 0;
    if (this.jog) return 3.0;
    return 0.6 + 1.0 * Math.min(1, this.level / 0.8);
  }
}
