import { rng } from './common';

/* Procedurally gilded frames for "Self Portrait": rectangular, arched and oval, as at the station. */

export type Shape = 'rect' | 'arch' | 'oval';
export const LABEL: Record<Shape, string> = { rect: 'Rectangular', arch: 'Arched', oval: 'Oval' };

// ---------------------------------------------------------------- frame geometry
export function shapePath(c: CanvasRenderingContext2D | Path2D, s: Shape, W: number, H: number, d: number) {
  const x0 = d, y0 = d, x1 = W - d, y1 = H - d;
  const p = c as CanvasRenderingContext2D;
  if (s === 'rect') {
    const r = Math.max(0, W * 0.012 - d * 0.02);
    p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r); p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r); p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0); p.closePath();
  } else if (s === 'arch') {
    const r = (x1 - x0) / 2, cx = W / 2, cy = y0 + r;
    p.moveTo(x0, y1); p.lineTo(x0, cy); p.arc(cx, cy, r, Math.PI, 0); p.lineTo(x1, y1); p.closePath();
  } else {
    p.moveTo(W / 2 + (W / 2 - d), H / 2);
    p.ellipse(W / 2, H / 2, Math.max(1, W / 2 - d), Math.max(1, H / 2 - d), 0, 0, Math.PI * 2); p.closePath();
  }
}
/** Points along the shape at inset d, every ~step px (for beads and ornaments). */
function samplePath(s: Shape, W: number, H: number, d: number, step: number) {
  const pts: { x: number; y: number; a: number }[] = [];
  if (s === 'oval') {
    const rx = W / 2 - d, ry = H / 2 - d;
    const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = Math.max(8, Math.round(per / step));
    for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pts.push({ x: W / 2 + Math.cos(t) * rx, y: H / 2 + Math.sin(t) * ry, a: t }); }
    return pts;
  }
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + ((bx - ax) * i) / n, y: ay + ((by - ay) * i) / n, a: Math.atan2(by - ay, bx - ax) });
  };
  const x0 = d, y0 = d, x1 = W - d, y1 = H - d;
  if (s === 'rect') { seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0); }
  else {
    const r = (x1 - x0) / 2, cx = W / 2, cy = y0 + r;
    seg(x1, cy, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, cy);
    const n = Math.max(6, Math.round((Math.PI * r) / step));
    for (let i = 0; i < n; i++) { const t = Math.PI + (i / n) * Math.PI; pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r, a: t + Math.PI / 2 }); }
  }
  return pts;
}

/** Gold moulding colour across the frame's width (0 = outer edge, 1 = sight edge). */
function goldAt(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [52, 32, 10]], [0.04, [120, 82, 30]], [0.1, [222, 178, 92]], [0.16, [255, 236, 168]], [0.22, [196, 146, 60]],
    [0.32, [104, 66, 22]], [0.4, [150, 104, 40]], [0.5, [214, 170, 86]], [0.56, [120, 80, 28]], [0.62, [178, 132, 58]],
    [0.74, [234, 196, 112]], [0.82, [150, 106, 42]], [0.88, [255, 226, 150]], [0.93, [112, 74, 26]], [1, [40, 24, 8]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [ta, a] = stops[i - 1], [tb, b] = stops[i];
      const k = (t - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

function ornament(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, petals = 7) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const grad = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 1.1);
  grad.addColorStop(0, '#fff2bf'); grad.addColorStop(0.35, '#e2b35a'); grad.addColorStop(0.75, '#8a5a1c'); grad.addColorStop(1, '#3a220a');
  // acanthus-like fan of petals
  for (let i = 0; i < petals; i++) {
    const a = -Math.PI / 2 + ((i - (petals - 1) / 2) / (petals - 1)) * Math.PI * 1.15;
    g.save();
    g.rotate(a + Math.PI / 2);
    g.beginPath();
    g.ellipse(0, -r * 0.55, r * 0.2, r * 0.58, 0, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = Math.max(0.6, r * 0.045);
    g.strokeStyle = 'rgba(40,22,6,.75)';
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.arc(0, 0, r * 0.32, 0, Math.PI * 2);
  const gb = g.createRadialGradient(-r * 0.1, -r * 0.12, 0, 0, 0, r * 0.34);
  gb.addColorStop(0, '#fff6d0'); gb.addColorStop(0.5, '#d9a64c'); gb.addColorStop(1, '#5c3a10');
  g.fillStyle = gb;
  g.fill();
  g.strokeStyle = 'rgba(40,22,6,.8)';
  g.stroke();
  g.restore();
}

/** Render a gilded frame (transparent sight opening) at pixel size W×H. */
export function renderFrame(s: Shape, W: number, H: number) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const B = Math.round(Math.min(W, H) * (s === 'oval' ? 0.115 : 0.105)); // moulding width
  // moulding profile: concentric strokes
  for (let i = 0; i <= B; i++) {
    const [r, gg, b] = goldAt(i / B);
    g.beginPath();
    shapePath(g, s, W, H, i + 0.5);
    g.strokeStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.lineWidth = 1.6;
    g.stroke();
  }
  const ring = new Path2D();
  shapePath(ring, s, W, H, 0);
  shapePath(ring, s, W, H, B);
  // raking light from the top left
  g.save();
  g.clip(ring, 'evenodd');
  g.globalCompositeOperation = 'soft-light';
  const lg = g.createLinearGradient(0, 0, W, H);
  lg.addColorStop(0, 'rgba(255,255,255,.9)'); lg.addColorStop(0.5, 'rgba(128,128,128,0)'); lg.addColorStop(1, 'rgba(0,0,0,.9)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  // worn gilding: fine speckle
  const R = rng(W * 7 + H);
  for (let i = 0; i < (W * H) / 90; i++) {
    const x = R() * W, y = R() * H;
    g.fillStyle = R() < 0.5 ? `rgba(60,34,8,${0.15 + R() * 0.25})` : `rgba(255,240,190,${0.1 + R() * 0.25})`;
    g.fillRect(x, y, 1 + R() * 1.4, 1 + R() * 1.4);
  }
  g.restore();
  // bead row
  const br = Math.max(1.4, B * 0.06);
  for (const p of samplePath(s, W, H, B * 0.56, br * 2.5)) {
    const gb = g.createRadialGradient(p.x - br * 0.35, p.y - br * 0.4, 0, p.x, p.y, br);
    gb.addColorStop(0, '#fff4c8'); gb.addColorStop(0.55, '#c99a44'); gb.addColorStop(1, '#4a2c0c');
    g.fillStyle = gb;
    g.beginPath(); g.arc(p.x, p.y, br, 0, Math.PI * 2); g.fill();
  }
  // carved ornaments
  const orn = B * 0.62;
  if (s === 'rect') {
    for (const [x, y, a] of [[B * 0.62, B * 0.62, -Math.PI / 4], [W - B * 0.62, B * 0.62, Math.PI / 4], [W - B * 0.62, H - B * 0.62, (3 * Math.PI) / 4], [B * 0.62, H - B * 0.62, (-3 * Math.PI) / 4]] as const) ornament(g, x, y, orn, a);
    for (const [x, y, a] of [[W / 2, B * 0.5, 0], [W / 2, H - B * 0.5, Math.PI]] as const) ornament(g, x, y, orn * 0.8, a, 9);
  } else if (s === 'arch') {
    ornament(g, W / 2, B * 0.52, orn * 1.05, 0, 9);
    ornament(g, B * 0.6, H - B * 0.6, orn * 0.85, (-3 * Math.PI) / 4);
    ornament(g, W - B * 0.6, H - B * 0.6, orn * 0.85, (3 * Math.PI) / 4);
    ornament(g, B * 0.5, W / 2, orn * 0.7, -Math.PI / 2, 5);
    ornament(g, W - B * 0.5, W / 2, orn * 0.7, Math.PI / 2, 5);
  } else {
    ornament(g, W / 2, B * 0.5, orn * 1.05, 0, 9);
    ornament(g, W / 2, H - B * 0.5, orn * 0.9, Math.PI, 7);
    ornament(g, B * 0.5, H / 2, orn * 0.72, -Math.PI / 2, 5);
    ornament(g, W - B * 0.5, H / 2, orn * 0.72, Math.PI / 2, 5);
  }
  // sight-edge shadow cast onto the painting
  const sight = new Path2D();
  shapePath(sight, s, W, H, B);
  g.save();
  g.clip(sight);
  g.shadowColor = 'rgba(0,0,0,.85)';
  g.shadowBlur = B * 0.35;
  g.lineWidth = B * 0.3;
  g.strokeStyle = 'rgba(0,0,0,.9)';
  g.beginPath(); shapePath(g, s, W, H, B - B * 0.15); g.stroke();
  g.restore();
  return { canvas: c, B };
}
