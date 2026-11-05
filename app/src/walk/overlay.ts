import * as THREE from 'three';
import type { Station } from '../core/data';
import { h } from '../ui/dom';
import type { WalkView } from './view';

interface Live { s: Station; pts: [number, number][]; rect: { x0: number; y0: number; x1: number; y1: number }; beacon?: [number, number] }

/** Locked, pulsing Hermes-pink glow on stations while they are meaningfully in frame. */
export class StationOverlay {
  canvas = h('canvas');
  private ctx: CanvasRenderingContext2D;
  private tags = new Map<string, HTMLButtonElement>();
  live: Live[] = [];
  onOpen: (s: Station) => void = () => {};
  private t = 0;
  seen = new Set<string>();
  enabled = true;
  avoid: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** The guide presenting a station: a fine pink beam with a travelling spark from her hand to the glow. */
  pointer: { x: number; y: number; id: string; k: number } | null = null;
  /** Screen boxes of the tags currently readable (computed, so nobody has to force a layout to ask). */
  tagBoxes: { left: number; top: number; right: number; bottom: number }[] = [];
  private sizes = new Map<string, { w: number; h: number }>();
  private drewLast = true;

  constructor(parent: HTMLElement, public view: WalkView, public stations: Station[]) {
    parent.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    for (const s of stations) {
      const b = h('button', { class: 'tag', 'aria-label': `Open ${s.title}` }, h('i', {}, s.offscreen ? '←' : '+'), s.offscreen ? `${s.title} · just off-camera, peek` : s.title) as HTMLButtonElement;
      b.style.opacity = '0';
      b.tabIndex = -1;
      b.style.pointerEvents = 'none';
      b.addEventListener('click', (e) => { e.stopPropagation(); this.onOpen(s); });
      parent.append(b);
      this.tags.set(s.id, b);
    }
    this.resize();
    addEventListener('resize', () => { this.resize(); this.sizes.clear(); });
    document.fonts?.ready.then(() => this.sizes.clear());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2);
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawPointer(ctx: CanvasRenderingContext2D, p: { x: number; y: number; k: number }, r: { x0: number; y0: number; x1: number; y1: number }, edge: number, beacon?: [number, number], pts?: [number, number][]) {
    // aim at the edge beacon's arrow, or the nearest point of the glowing outline (never empty space)
    let tx: number, ty: number;
    if (beacon) [tx, ty] = beacon;
    else {
      tx = Math.max(r.x0 + 6, Math.min(r.x1 - 6, p.x)); ty = Math.max(r.y0 + 6, Math.min(r.y1 - 6, p.y));
      if (Math.hypot(tx - p.x, ty - p.y) < 30 && pts?.length) { // her hand is inside the box: go to the outline's centre
        tx = pts.reduce((a, q) => a + q[0], 0) / pts.length; ty = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      }
    }
    const dx = tx - p.x, dy = ty - p.y, L = Math.hypot(dx, dy);
    if (L < 12) return;
    const a = p.k * edge;
    // the beam draws out from her hand, then a spark keeps travelling along it
    const reach = Math.min(1, p.k * 1.6);
    const ex = p.x + dx * reach, ey = p.y + dy * reach;
    ctx.save();
    ctx.lineCap = 'round';
    const g = ctx.createLinearGradient(p.x, p.y, ex, ey);
    g.addColorStop(0, `rgba(255,63,180,${0.05 * a})`);
    g.addColorStop(0.35, `rgba(255,120,205,${0.55 * a})`);
    g.addColorStop(1, `rgba(255,190,232,${0.9 * a})`);
    ctx.strokeStyle = g;
    ctx.shadowColor = 'rgba(255,63,180,0.9)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = -this.t * 40;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    const u = (this.t * 0.9) % 1;
    if (reach >= 1) {
      ctx.fillStyle = `rgba(255,225,245,${a})`;
      ctx.beginPath();
      ctx.arc(p.x + dx * u, p.y + dy * u, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx, ty, 4 + 3 * Math.sin(this.t * 6) ** 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.drewLast = true;
  }

  private polyAt(s: Station, f: number): [number, number][] | null {
    const tr = s.screen_region_track;
    let i = f - tr.start;
    if (s.offscreen) i = Math.max(0, Math.min(tr.polys.length - 1, i)); // edge beacon holds its last known spot
    if (i < 0 || i > tr.polys.length - 1) return null;
    const a = tr.polys[Math.floor(i)], b = tr.polys[Math.min(tr.polys.length - 1, Math.ceil(i))];
    const t = i - Math.floor(i);
    const out: [number, number][] = [];
    for (let k = 0; k < a.length; k += 2) out.push([a[k] + (b[k] - a[k]) * t, a[k + 1] + (b[k + 1] - a[k + 1]) * t]);
    return out;
  }

  update(dt: number, f: number, floorId: string) {
    this.t += dt;
    const ctx = this.ctx;
    if (this.drewLast) ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.drewLast = false;
    this.tagBoxes = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.view.offsetX, 0, this.view.width, innerHeight);
    ctx.clip(); // glows live inside the footage column only
    this.live = [];
    for (const s of this.stations) {
      const tag = this.tags.get(s.id)!;
      const [w0, w1] = s.visibility_window;
      const poly = floorId === 'downstairs' && this.enabled ? this.polyAt(s, f) : null;
      const on = !!poly && f >= w0 - 2 && f <= w1 + 2;
      if (!on || !poly) { tag.style.opacity = '0'; tag.style.pointerEvents = 'none'; if (tag.tabIndex !== -1) tag.tabIndex = -1; continue; }
      // fade in/out at the window edges
      const edge = Math.min(1, (f - (w0 - 2)) / 8, ((w1 + 2) - f) / 8);
      const wp = new THREE.Vector3().fromArray(s.world_position);
      const pr = this.view.project(wp);
      const d = pr ? this.view.disparityForDepth(pr.z) : 0.4;
      const pts = poly.map(([u, v]) => this.view.imageToScreen(u, v, d) as [number, number]);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      this.live.push({ s, pts, rect });
      this.drewLast = true;
      // tag text never changes: measure once (reading offsetWidth every frame forces a layout)
      let sz = this.sizes.get(s.id);
      if (!sz) { tag.classList.remove('edge-left'); sz = { w: tag.offsetWidth || 140, h: tag.offsetHeight || 32 }; this.sizes.set(s.id, sz); }
      const pulse = 0.65 + 0.35 * Math.sin(this.t * 3.2);
      // visible fraction inside the footage column (minus the rail on phones)
      const vx1 = this.view.offsetX + this.view.width - (this.view.contain ? 0 : 58);
      const clipped = clipFrac(pts, this.view.offsetX, 64, vx1, innerHeight - 90);
      if (s.offscreen || clipped < 0.85) {
        const leftSide = s.offscreen || (rect.x0 + rect.x1) / 2 < (this.view.offsetX + vx1) / 2;
        const ey = Math.max(150, Math.min(innerHeight - 200, (rect.y0 + rect.y1) / 2));
        if (leftSide) {
          this.drawBeacon(ctx, this.view.offsetX + 8, ey, edge * pulse);
          tag.classList.add('edge-left');
          tag.style.left = `${this.view.offsetX + 52}px`;
        } else {
          this.drawBeaconRight(ctx, vx1 - 8, ey, edge * pulse);
          tag.classList.add('edge-left');
          tag.style.left = `${vx1 - 60 - sz.w}px`;
        }
        tag.style.top = `${ey}px`;
        rect.x0 = leftSide ? this.view.offsetX : vx1 - 140; rect.x1 = leftSide ? this.view.offsetX + 140 : vx1;
        this.live[this.live.length - 1].beacon = [leftSide ? this.view.offsetX + 8 : vx1 - 8, ey];
        rect.y0 = ey - 60; rect.y1 = ey + 60;
      } else {
        this.drawGlow(ctx, pts, edge, pulse);
        tag.classList.remove('edge-left');
        const cx = Math.max(76, Math.min(innerWidth - 130, (rect.x0 + rect.x1) / 2));
        tag.style.left = `${cx}px`;
        tag.style.top = `${Math.max(innerWidth < 520 ? 140 : 100, Math.min(innerHeight - 170, rect.y0 - 10))}px`;
      }
      // keep chips off her face and shoulders (with hysteresis so a chip never jitters between spots)
      const tw = sz.w, th = sz.h;
      const edgeChip = tag.classList.contains('edge-left');
      const L = parseFloat(tag.style.left);
      const box = (T: number) => edgeChip ? { l: L, t: T - th / 2, r: L + tw, b: T + th / 2 } : { l: L - tw / 2, t: T - th, r: L + tw / 2, b: T };
      if (this.avoid) {
        const T0 = parseFloat(tag.style.top);
        const a = this.avoid;
        const overlaps = (T: number, pad: number) => { const q = box(T); return !(q.r < a.x0 - pad || q.l > a.x1 + pad || q.b < a.y0 - pad || q.t > a.y1 + pad); };
        let lifted = tag.dataset.lift === '1';
        if (!lifted && overlaps(T0, 12)) lifted = true;
        else if (lifted && !overlaps(T0, 34)) lifted = false;
        tag.dataset.lift = lifted ? '1' : '';
        if (lifted) {
          // snap the lifted spot to a coarse grid so small idle sways don't move it
          const up = Math.round((edgeChip ? a.y0 - th / 2 - 16 : a.y0 - 16) / 24) * 24;
          const down = Math.round((edgeChip ? a.y1 + th / 2 + 16 : a.y1 + th + 16) / 24) * 24;
          tag.style.top = `${up >= 120 ? up : down}px`;
        }
      }
      if (edge > 0.3) { const q = box(parseFloat(tag.style.top)); this.tagBoxes.push({ left: q.l, top: q.t, right: q.r, bottom: q.b }); }
      tag.style.opacity = String(Math.max(0, edge));
      tag.style.pointerEvents = edge > 0.3 ? 'auto' : 'none';
      const tab = edge > 0.3 ? 0 : -1; // hidden tags are no Tab stops
      if (tag.tabIndex !== tab) tag.tabIndex = tab;
      if (this.pointer && this.pointer.id === s.id && this.pointer.k > 0.02) this.drawPointer(ctx, this.pointer, rect, edge, this.live[this.live.length - 1].beacon, pts);
    }
    ctx.restore();
  }

  private roundedPath(ctx: CanvasRenderingContext2D, pts: [number, number][], r: number) {
    ctx.beginPath();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const a = Math.min(r, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2);
      const b = Math.min(r, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2);
      const v0 = norm(p0, p1), v1 = norm(p2, p1);
      const s = [p1[0] + v0[0] * a, p1[1] + v0[1] * a], e = [p1[0] + v1[0] * b, p1[1] + v1[1] * b];
      if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      ctx.quadraticCurveTo(p1[0], p1[1], e[0], e[1]);
    }
    ctx.closePath();
  }

  private drawGlow(ctx: CanvasRenderingContext2D, pts: [number, number][], alpha: number, pulse: number) {
    // grow the region a touch so the line sits just outside the object
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const g = pts.map(([x, y]) => [cx + (x - cx) * 1.08, cy + (y - cy) * 1.08] as [number, number]);
    ctx.save();
    ctx.globalAlpha = alpha;
    this.roundedPath(ctx, g, 14);
    ctx.fillStyle = `rgba(255,63,180,${0.08 * pulse})`;
    ctx.fill();
    ctx.shadowColor = 'rgba(255,63,180,0.95)';
    ctx.shadowBlur = 26 * pulse;
    ctx.strokeStyle = `rgba(255,63,180,${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,225,245,0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  private drawBeacon(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    const grd = ctx.createRadialGradient(this.view.offsetX, y, 0, this.view.offsetX, y, 120);
    grd.addColorStop(0, 'rgba(255,63,180,0.55)');
    grd.addColorStop(1, 'rgba(255,63,180,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(this.view.offsetX, y - 120, 140, 240);
    ctx.strokeStyle = 'rgba(255,225,245,0.95)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,63,180,1)';
    ctx.shadowBlur = 16;
    const o = 6 * Math.sin(this.t * 4);
    for (const k of [0, 14]) {
      ctx.beginPath();
      ctx.moveTo(x + 18 + k + o, y - 12);
      ctx.lineTo(x + 6 + k + o, y);
      ctx.lineTo(x + 18 + k + o, y + 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBeaconRight(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
    ctx.save();
    ctx.translate(2 * x, 0);
    ctx.scale(-1, 1);
    this.drawBeacon(ctx, x - 8, y, alpha);
    ctx.restore();
  }

  hit(x: number, y: number): Station | null {
    for (const l of this.live) {
      const pad = 22;
      if (x >= l.rect.x0 - pad && x <= l.rect.x1 + pad && y >= l.rect.y0 - pad && y <= l.rect.y1 + pad) return l.s;
      if (l.s.offscreen && x < this.view.offsetX + 120 && Math.abs(y - (l.rect.y0 + l.rect.y1) / 2) < 120) return l.s;
    }
    return null;
  }
}

function polyArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; a += x0 * y1 - x1 * y0; }
  return Math.abs(a) / 2;
}

/** Fraction of polygon area inside an axis-aligned box (Sutherland-Hodgman clip). */
function clipFrac(p: [number, number][], x0: number, y0: number, x1: number, y1: number) {
  const full = polyArea(p);
  if (full < 1) return 0;
  let out = p;
  const edges: [(q: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(q) => q[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(q) => q[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(q) => q[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(q) => q[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]],
  ];
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return 0;
  }
  return polyArea(out) / full;
}

function norm(a: [number, number], b: [number, number]): [number, number] {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}
