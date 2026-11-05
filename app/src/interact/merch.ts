import './merch.css';
import * as THREE from 'three';
import { h } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { btn, ico, img, loop } from './common';

/*
 * "The Merch Wall", interpreted. From the card: white tees pinned to a dark wall under blue light; one reads
 * "NOUS RESEARCH" above a figure and "THE ONLY WAY OUT IS THROUGH YOU & ME", with the smaller lines
 * "DECENTRALIZED TECHNOLOGY IS FREEDOM" and "DIVINITY THROUGH DISTRIBUTION"; another frames a manga-style girl with a
 * headband inside "REBELLION TO TYRANTS IS OBEDIENCE TO GOD."; others show a laptop riding a great wave and a spiral
 * ringed with "NOUS"; a "NOUSCON NYC 2026" banner hangs nearby.
 *
 * The prints are cut straight from the station photos (media/interact/merch/*: "_blue" is the photo as taken, "_day"
 * is the same crop white-balanced offline, so its colours are an estimate). Visitors switch the light (blue gallery
 * light, a torch they move with a finger, or daylight), take a tee or the banner off its pins, turn it, and open the
 * print up close where every transcribed line (and each image, described only in the card's words) is marked where
 * it sits. The spiral is printed on the back of its tee in the photos, so it hangs back-out here too.
 */

type Shape =
  | { t: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'ring'; cx: number; cy: number; rx: number; ry: number; w: number; a0?: number; a1?: number }
  | { t: 'disc'; cx: number; cy: number; rx: number; ry: number };
interface Spot { kind: 'text' | 'small' | 'image'; text: string; note?: string; of?: string; shape: Shape }
interface PieceDef {
  id: string; kind: 'tee' | 'banner'; title: string; sub: string;
  /** crop size (px) of the photo cuts */ iw: number; ih: number;
  day: boolean; back?: boolean; scale?: number; top?: number;
  pins?: [number, number, 'magnet' | 'pin'][];
  spots: Spot[];
  photoNote: string;
}
const R = (x0: number, y0: number, x1: number, y1: number): Shape => ({ t: 'rect', x0, y0, x1, y1 });
const PIECES: PieceDef[] = [
  {
    id: 'nous', kind: 'tee', iw: 380, ih: 575, day: true, scale: 0.36, top: 0.17,
    title: '“THE ONLY WAY OUT IS THROUGH YOU & ME”', sub: '“NOUS RESEARCH” above a figure, and two smaller lines',
    pins: [[0.3, 0.06, 'magnet'], [0.69, 0.1, 'magnet'], [0.94, 0.3, 'magnet'], [0.23, 0.95, 'magnet'], [0.78, 0.95, 'magnet']],
    photoNote: 'Print cut from the station photo',
    spots: [
      { kind: 'text', text: 'NOUS RESEARCH', shape: R(16, 6, 350, 62) },
      { kind: 'image', text: 'A figure', note: 'beneath “NOUS RESEARCH”', shape: R(20, 60, 342, 490) },
      { kind: 'text', text: 'THE ONLY WAY OUT IS THROUGH YOU & ME', shape: R(26, 488, 358, 517) },
      { kind: 'small', text: 'DECENTRALIZED TECHNOLOGY IS FREEDOM', shape: R(90, 535, 305, 550) },
      { kind: 'small', text: 'DIVINITY THROUGH DISTRIBUTION', shape: R(114, 547, 281, 561) },
    ],
  },
  {
    id: 'manga', kind: 'tee', iw: 480, ih: 505, day: true, scale: 0.5, top: 0.2,
    title: '“REBELLION TO TYRANTS IS OBEDIENCE TO GOD.”', sub: 'A manga-style girl with a headband, framed inside the words',
    pins: [[0.42, 0.035, 'pin'], [0.6, 0.035, 'pin'], [0.8, 0.09, 'pin'], [0.95, 0.27, 'pin'], [0.79, 0.5, 'pin'], [0.22, 0.965, 'pin'], [0.78, 0.965, 'pin']],
    photoNote: 'Print cut from the station photo',
    spots: [
      { kind: 'image', text: 'A manga-style girl with a headband', note: 'framed inside the words', shape: { t: 'disc', cx: 242, cy: 254, rx: 186, ry: 198 } },
      { kind: 'text', text: 'REBELLION TO TYRANTS IS OBEDIENCE TO GOD.', note: 'around the girl', shape: { t: 'ring', cx: 242, cy: 254, rx: 204, ry: 216, w: 40, a0: 128, a1: 412 } },
    ],
  },
  {
    id: 'wave', kind: 'tee', iw: 875, ih: 860, day: true, scale: 0.56, top: 0.2,
    title: 'A laptop riding a great wave', sub: 'Printed across the chest',
    pins: [[0.29, 0.05, 'magnet'], [0.72, 0.05, 'magnet'], [0.9, 0.33, 'magnet']],
    photoNote: 'Print cut from the station photo',
    spots: [
      { kind: 'image', text: 'A laptop', of: 'A laptop riding a great wave', shape: R(52, 12, 490, 498) },
      { kind: 'image', text: 'riding a great wave', of: 'A laptop riding a great wave', shape: R(18, 182, 858, 852) },
    ],
  },
  {
    id: 'spiral', kind: 'tee', iw: 725, ih: 710, day: true, back: true, scale: 0.6, top: 0.17,
    title: 'A spiral ringed with “NOUS”', sub: 'On the back of the tee, as in the photos',
    pins: [[0.62, 0.05, 'magnet'], [0.08, 0.14, 'magnet']],
    photoNote: 'Print cut from the station photo',
    spots: [
      { kind: 'image', text: 'A spiral', of: 'A spiral ringed with the word “NOUS”', shape: { t: 'disc', cx: 362, cy: 356, rx: 258, ry: 258 } },
      { kind: 'text', text: 'NOUS', note: 'the word ringed around the spiral', shape: { t: 'ring', cx: 362, cy: 356, rx: 305, ry: 305, w: 78 } },
    ],
  },
  {
    id: 'banner', kind: 'banner', iw: 332, ih: 710, day: false,
    title: '“NOUSCON NYC 2026”', sub: 'The banner hanging nearby',
    photoNote: 'From the station photo, partly behind a tee',
    spots: [
      { kind: 'text', text: 'NOUSCON', of: 'NOUSCON NYC 2026', shape: R(12, 66, 332, 236) },
      { kind: 'text', text: 'NYC 2026', of: 'NOUSCON NYC 2026', shape: R(12, 486, 304, 634) },
    ],
  },
];
const TW = 1.3, TH = 1.42; // tee size (world units)
const TEX_W = 1024, TEX_H = Math.round((1024 * TH) / TW);
type Mode = 'blue' | 'torch' | 'day';
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** T-shirt silhouette in a unit box (y down). */
function teePath(g: CanvasRenderingContext2D, W: number, H: number) {
  const P = (x: number, y: number): [number, number] => [x * W, y * H];
  g.beginPath();
  g.moveTo(...P(0.37, 0.03));
  g.quadraticCurveTo(...P(0.5, 0.15), ...P(0.63, 0.03));
  g.lineTo(...P(0.83, 0.07));
  g.lineTo(...P(0.995, 0.27));
  g.lineTo(...P(0.9, 0.39));
  g.lineTo(...P(0.785, 0.31));
  g.quadraticCurveTo(...P(0.79, 0.65), ...P(0.8, 0.985));
  g.quadraticCurveTo(...P(0.5, 0.995), ...P(0.2, 0.985));
  g.quadraticCurveTo(...P(0.21, 0.65), ...P(0.215, 0.31));
  g.lineTo(...P(0.1, 0.39));
  g.lineTo(...P(0.005, 0.27));
  g.lineTo(...P(0.17, 0.07));
  g.closePath();
}

/** Where a print sits on the tee texture (px). */
const printRect = (d: PieceDef) => {
  const pw = TEX_W * (d.scale ?? 0.5), ph = (pw * d.ih) / d.iw;
  return { x: (TEX_W - pw) / 2, y: TEX_H * (d.top ?? 0.2), w: pw, h: ph };
};

/** Cotton, seams and soft folds; the print multiplied in. `back` draws the back of the tee (high collar). */
const clothCache: Partial<Record<'front' | 'back', HTMLCanvasElement>> = {};
function teeCanvas(print: HTMLImageElement | null, d: PieceDef | null, back: boolean) {
  const base = clothCache[back ? 'back' : 'front'] ?? (clothCache[back ? 'back' : 'front'] = clothCanvas(back));
  if (!print || !d) return base;
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0);
  teePath(g, TEX_W, TEX_H);
  g.save();
  g.clip();
  const r = printRect(d);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(print, r.x, r.y, r.w, r.h);
  g.restore();
  return c;
}
function clothCanvas(back: boolean) {
  const W = TEX_W, H = TEX_H;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  teePath(g, W, H);
  g.save();
  g.clip();
  g.fillStyle = '#f4f2ee';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {
    const x = (0.22 + i * 0.07 + Math.sin(i * 7.1 + (back ? 2 : 0)) * 0.02) * W;
    const gr = g.createLinearGradient(x - 40, 0, x + 40, 0);
    gr.addColorStop(0, 'rgba(0,0,30,0)'); gr.addColorStop(0.5, `rgba(0,0,30,${0.03 + (i % 3) * 0.015})`); gr.addColorStop(1, 'rgba(0,0,30,0)');
    g.fillStyle = gr;
    g.fillRect(x - 40, H * 0.32, 80, H * 0.7);
  }
  const side = g.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0.18, 'rgba(0,0,20,0.12)'); side.addColorStop(0.3, 'rgba(0,0,20,0)'); side.addColorStop(0.7, 'rgba(0,0,20,0)'); side.addColorStop(0.82, 'rgba(0,0,20,0.12)');
  g.fillStyle = side;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.014)';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.strokeStyle = 'rgba(40,40,60,0.22)';
  g.lineWidth = 3;
  g.beginPath();
  if (back) { g.moveTo(0.37 * W, 0.03 * H + 10); g.quadraticCurveTo(0.5 * W, 0.07 * H, 0.63 * W, 0.03 * H + 10); }
  else { g.moveTo(0.37 * W + 6, 0.03 * H + 14); g.quadraticCurveTo(0.5 * W, 0.15 * H + 18, 0.63 * W - 6, 0.03 * H + 14); }
  g.moveTo(0.17 * W, 0.07 * H); g.lineTo(0.215 * W, 0.31 * H);
  g.moveTo(0.83 * W, 0.07 * H); g.lineTo(0.785 * W, 0.31 * H);
  g.moveTo(0.05 * W, 0.32 * H); g.lineTo(0.13 * W, 0.42 * H);
  g.moveTo(0.95 * W, 0.32 * H); g.lineTo(0.87 * W, 0.42 * H);
  g.moveTo(0.2 * W, 0.955 * H); g.lineTo(0.8 * W, 0.955 * H);
  g.stroke();
  if (back) {
    // back of the collar: a soft fold of shadow under the rib
    const sh = g.createLinearGradient(0, 0.03 * H, 0, 0.09 * H);
    sh.addColorStop(0, 'rgba(0,0,30,0.12)'); sh.addColorStop(1, 'rgba(0,0,30,0)');
    g.fillStyle = sh; g.fillRect(0.3 * W, 0.03 * H, 0.4 * W, 0.06 * H);
  } else {
    // inside of the collar and the neck label
    g.fillStyle = 'rgba(0,0,30,0.07)';
    g.beginPath(); g.moveTo(0.38 * W, 0.035 * H); g.quadraticCurveTo(0.5 * W, 0.13 * H, 0.62 * W, 0.035 * H); g.quadraticCurveTo(0.5 * W, 0.075 * H, 0.38 * W, 0.035 * H); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0.48 * W, 0.05 * H, 0.04 * W, 0.03 * H);
    g.strokeStyle = 'rgba(0,0,30,0.15)'; g.lineWidth = 2; g.strokeRect(0.48 * W, 0.05 * H, 0.04 * W, 0.03 * H);
  }
  g.restore();
  return c;
}

function wallTex() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#17181d';
  g.fillRect(0, 0, 1024, 512);
  // grain: a small noise tile stamped across (cheap), then the panel seams on top
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tg = tile.getContext('2d')!;
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) { tg.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; tg.fillRect(r() * 128, r() * 128, 2, 2); }
  g.fillStyle = g.createPattern(tile, 'repeat')!;
  g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 3;
  for (let x = 128; x < 1024; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  g.beginPath(); g.moveTo(0, 150); g.lineTo(1024, 150); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let x = 130; x < 1024; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  // old pin holes
  for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(r() * 1024, r() * 512, 1.6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** The NOUSCON NYC 2026 banner: tall condensed letters in a misty blue (as in the photo), stacked or in one line. */
function bannerCanvas(vertical: boolean) {
  const W = vertical ? 512 : 2048, H = vertical ? 1240 : 380;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1452'); bg.addColorStop(0.5, '#101a6a'); bg.addColorStop(1, '#0a1046');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const v = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(60,90,255,0.18)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  const word = (txt: string, x: number, y: number, size: number, maxW: number) => {
    g.save();
    g.font = `800 ${size}px Manrope, system-ui, sans-serif`;
    const mw = g.measureText(txt).width;
    const sx = Math.min(0.62, maxW / mw);
    g.translate(x, y);
    g.scale(sx, 1);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // the mist: the letters dripping downward in soft fading copies
    g.shadowColor = 'rgba(110,140,255,0.9)';
    g.shadowBlur = size * 0.18;
    for (let i = 6; i >= 1; i--) { g.fillStyle = `rgba(90,120,255,${0.07 * (7 - i) / 6})`; g.fillText(txt, 0, i * size * 0.07); }
    g.fillStyle = 'rgba(150,175,255,0.85)';
    g.fillText(txt, 0, 0);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(205,218,255,0.75)';
    g.fillText(txt, 0, 0);
    g.restore();
  };
  if (vertical) {
    word('NOUSCON', W / 2, H * 0.27, 300, W * 0.86);
    word('NYC 2026', W / 2, H * 0.8, 300, W * 0.84);
  } else {
    word('NOUSCON NYC 2026', W / 2, H * 0.7, 250, W * 0.88);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const MODES: Record<Mode, { clear: number; sky: number; ground: number; hemi: number; dir: number; dirI: number; rimI: number; roam: number; roamI: number; roamA: number; key: number; keyI: number }> = {
  blue: { clear: 0x050716, sky: 0x5b68ff, ground: 0x060820, hemi: 1.7, dir: 0x4655ff, dirI: 2.6, rimI: 0.9, roam: 0xc9d2ff, roamI: 9, roamA: 0.36, key: 0xdde4ff, keyI: 13 },
  torch: { clear: 0x020308, sky: 0x313c9a, ground: 0x020308, hemi: 0.16, dir: 0x4655ff, dirI: 0.22, rimI: 0.06, roam: 0xffefd6, roamI: 34, roamA: 0.22, key: 0xffefd6, keyI: 16 },
  day: { clear: 0x0f1013, sky: 0xffffff, ground: 0x3a3a42, hemi: 1.5, dir: 0xfff6ea, dirI: 2.3, rimI: 0.45, roam: 0xffffff, roamI: 0, roamA: 0.36, key: 0xffffff, keyI: 9 },
};

interface Sheet { geo: THREE.PlaneGeometry; base: Float32Array; freeWall: Float32Array; freeHeld: Float32Array; sign: number }
interface Piece {
  def: PieceDef; i: number; group: THREE.Group; sheets: Sheet[]; mats: THREE.MeshStandardMaterial[]; meshes: THREE.Mesh[];
  w: number; h: number; home: THREE.Vector3; rest: number; yaw: number; vYaw: number; goal: number | null; pitch: number;
  phase: number; focus: number; kick: number; pins: THREE.Object3D[];
  frontC?: HTMLCanvasElement;
}

export async function mount(ctx: IxCtx): Promise<Ix> {
  const { stage, dock, signal } = ctx;
  stage.classList.add('mw');
  dock.classList.add('mw-dock');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, ctx.coarse ? 1.75 : 2));
  renderer.setClearColor(MODES.blue.clear);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.className = 'mw-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');

  // ---- HTML layers: hint, info card (focused piece), reader (the print up close)
  const verb = ctx.coarse ? 'Tap' : 'Click';
  const hint = h('div', { class: 'mw-hint' }, `${verb} a tee or the banner`, h('span', {}, ctx.coarse ? 'Drag across the wall to move the light' : 'Move across the wall to steer the light'));
  const info = h('div', { class: 'mw-info', 'aria-live': 'polite' });
  const reader = h('div', { class: 'mw-reader', 'aria-hidden': 'true' });
  const sheetEl = h('div', { class: 'mw-sheet' });
  const imDay = h('img', { class: 'mw-im day', alt: '', draggable: 'false' }) as HTMLImageElement;
  const imBlue = h('img', { class: 'mw-im blue', alt: '', draggable: 'false' }) as HTMLImageElement;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'mw-marks');
  svg.innerHTML = `<defs><mask id="mw-hole" maskUnits="userSpaceOnUse"><rect class="mw-mfull" fill="#fff"/><g class="mw-mhole"></g></mask></defs><rect class="mw-dim" mask="url(#mw-hole)"/><g class="mw-out"></g>`;
  sheetEl.append(imBlue, imDay, svg);
  const torchEl = h('div', { class: 'mw-torch' });
  const cap = h('div', { class: 'mw-cap', 'aria-live': 'polite' });
  const zoomHint = h('div', { class: 'mw-zhint' }, ctx.coarse ? 'Pinch to read the small print' : 'Scroll to zoom · drag to look around');
  reader.append(sheetEl, torchEl, zoomHint, cap);
  stage.append(renderer.domElement, hint, info, reader);

  // ---- dock: [pin back] [turn] [read]   [‹] [›]   and the light switch
  const PIN_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4.5"/><path d="M12 12.5V21"/></svg>';
  const RET_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';
  const pinBtn = btn('Pin it back', { icon: PIN_ICO, aria: 'Pin it back on the wall' });
  pinBtn.title = 'Pin it back on the wall';
  const turnBtn = btn('Turn', { icon: ico.reset, aria: 'Turn the tee around' });
  turnBtn.title = 'Turn the tee around';
  const readBtn = btn('Read the print', { cls: 'cyan', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5M8 10.5h5M10.5 8v5"/></svg>' });
  const backBtn = btn('Back', { icon: RET_ICO, aria: 'Back to the tee' });
  backBtn.title = 'Back';
  const prevBtn = btn('', { cls: 'round', aria: 'Previous line', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>' });
  const nextBtn = btn('', { cls: 'round', aria: 'Next line', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>' });
  const segBtns: Record<Mode, HTMLButtonElement> = {
    blue: h('button', { type: 'button', 'aria-pressed': 'true', title: 'Blue gallery light' }, 'Blue') as HTMLButtonElement,
    torch: h('button', { type: 'button', 'aria-pressed': 'false', title: 'A torch you move with your finger' }, 'Torch') as HTMLButtonElement,
    day: h('button', { type: 'button', 'aria-pressed': 'false', title: 'Daylight: estimated true colours', 'aria-label': 'Daylight' }, h('span', { class: 'lg' }, 'Daylight'), h('span', { class: 'sm' }, 'Day')) as HTMLButtonElement,
  };
  const seg = h('div', { class: 'ix-seg mw-seg', role: 'group', 'aria-label': 'Light' }, segBtns.blue, segBtns.torch, segBtns.day);
  const acts = h('div', { class: 'mw-acts' }, pinBtn, turnBtn, readBtn, backBtn, prevBtn, nextBtn);
  dock.append(acts, seg);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const hemi = new THREE.HemisphereLight(MODES.blue.sky, MODES.blue.ground, MODES.blue.hemi);
  scene.add(hemi);
  const dirL = new THREE.DirectionalLight(MODES.blue.dir, MODES.blue.dirI);
  dirL.position.set(-2, 4, 5);
  scene.add(dirL);
  const rim = new THREE.DirectionalLight(0x9fb4ff, MODES.blue.rimI);
  rim.position.set(3, 2, 2);
  scene.add(rim);
  // the roaming light: sweeps the wall on its own, follows a finger / the mouse when asked (the torch)
  const roam = new THREE.SpotLight(MODES.blue.roam, 0, 16, 0.36, 0.8, 1.1);
  roam.position.set(0, 1.5, 5.5);
  scene.add(roam, roam.target);
  const key = new THREE.SpotLight(0xffffff, 0, 14, 0.32, 0.6, 1.2);
  key.position.set(0.6, 1.8, 6);
  scene.add(key, key.target);

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex(), roughness: 0.92 });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), wallMat);
  wall.position.z = -0.14;
  scene.add(wall);

  // ---- metal: magnets (disc + hook), push pins
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0b0, metalness: 0.9, roughness: 0.38 });
  const magGeo = new THREE.CylinderGeometry(0.05, 0.052, 0.026, 22).rotateX(Math.PI / 2);
  const hookGeo = new THREE.TorusGeometry(0.022, 0.0055, 6, 14, Math.PI * 1.25).rotateZ(-Math.PI * 0.12);
  const pinHeadGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 10).rotateX(Math.PI / 2);
  const makePin = (type: 'magnet' | 'pin') => {
    const g = new THREE.Group();
    if (type === 'magnet') {
      const m = new THREE.Mesh(magGeo, metal);
      const hk = new THREE.Mesh(hookGeo, metal);
      hk.position.set(0, 0.006, 0.022);
      g.add(m, hk);
    } else {
      const m = new THREE.Mesh(pinHeadGeo, metal);
      m.position.z = 0.015;
      g.add(m);
    }
    scene.add(g);
    return g;
  };
  // a few empty magnets scattered on the wall (as in the photos)
  const spare: { o: THREE.Object3D; u: number; v: number }[] = [];
  for (let i = 0; i < 7; i++) { const o = makePin('magnet'); spare.push({ o, u: ((i * 0.618) % 1) * 2 - 1, v: ((i * 0.377 + 0.2) % 1) * 2 - 1 }); }

  const loader = (p: string) => img(ctx.asset(p));
  const prints = await Promise.all(PIECES.map((d) => (d.kind === 'tee' ? loader(`media/interact/merch/${d.id}_day.jpg`).catch(() => null) : Promise.resolve(null))));
  if (signal.aborted) { renderer.dispose(); return { dispose() {} }; }

  const texOf = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const plainFront = texOf(teeCanvas(null, null, false));
  await nextFrame();
  const plainBack = texOf(teeCanvas(null, null, true));
  await nextFrame();
  const bannerV = bannerCanvas(true);
  await nextFrame();
  const bannerH = bannerCanvas(false);
  if (signal.aborted) { renderer.dispose(); return { dispose() {} }; }

  const SEG_X = 20, SEG_Y = 22;
  /** pin influence: 0 at a pin, 1 far from every pin */
  const freeFrom = (base: Float32Array, pins: [number, number][], w: number, hh: number, rad: number) => {
    const out = new Float32Array(base.length / 3);
    for (let k = 0; k < out.length; k++) {
      const x = base[k * 3], y = base[k * 3 + 1];
      let f = 1;
      for (const [u, v] of pins) {
        const px = (u - 0.5) * w, py = (0.5 - v) * hh;
        const d2 = ((x - px) ** 2 + (y - py) ** 2) / (rad * rad);
        f *= 1 - Math.exp(-d2);
      }
      out[k] = f;
    }
    return out;
  };

  const pieces: Piece[] = [];
  for (let i = 0; i < PIECES.length; i++) {
    const def = PIECES[i];
    const group = new THREE.Group();
    const sheets: Sheet[] = [], mats: THREE.MeshStandardMaterial[] = [], meshes: THREE.Mesh[] = [];
    let w = TW, hh = TH;
    let pinObjs: THREE.Object3D[] = [];
    if (def.kind === 'tee') {
      await nextFrame(); // spread the canvas work over frames (no long tasks)
      if (signal.aborted) break;
      const printed = teeCanvas(prints[i], def, !!def.back);
      const frontTex = def.back ? plainFront : texOf(printed);
      const backTex = def.back ? texOf(printed) : plainBack;
      const held: [number, number][] = [[0.3, 0.04], [0.7, 0.04]];
      const wallPins = (def.pins ?? []).map(([u, v]) => [u, v] as [number, number]);
      for (const sign of [1, -1]) {
        const geo = new THREE.PlaneGeometry(TW, TH, SEG_X, SEG_Y);
        if (sign < 0) geo.rotateY(Math.PI);
        const base = Float32Array.from((geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
        const mat = new THREE.MeshStandardMaterial({ map: sign > 0 ? frontTex : backTex, roughness: 0.88, alphaTest: 0.5 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.i = i;
        mesh.userData.back = sign < 0;
        group.add(mesh);
        sheets.push({ geo, base, sign, freeWall: freeFrom(base, wallPins, TW, TH, 0.26), freeHeld: freeFrom(base, held, TW, TH, 0.3) });
        mats.push(mat); meshes.push(mesh);
      }
      pinObjs = (def.pins ?? []).map(([, , type]) => makePin(type));
    } else {
      const geo = new THREE.PlaneGeometry(1, 1, 14, 20);
      const base = Float32Array.from((geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
      const mat = new THREE.MeshStandardMaterial({ map: bannerV, roughness: 0.82, side: THREE.DoubleSide, emissive: 0x3048ff, emissiveMap: bannerV, emissiveIntensity: 0.35 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.i = i;
      group.add(mesh);
      const top: [number, number][] = [[0.06, 0.02], [0.94, 0.02]];
      sheets.push({ geo, base, sign: 1, freeWall: freeFrom(base, top, 1, 1, 0.3), freeHeld: freeFrom(base, top, 1, 1, 0.3) });
      mats.push(mat); meshes.push(mesh);
      pinObjs = [makePin('pin'), makePin('pin')];
      w = 0.95; hh = 2.3;
    }
    scene.add(group);
    const rest = def.back ? Math.PI : 0;
    pieces.push({ def, i, group, sheets, mats, meshes, w, h: hh, home: new THREE.Vector3(), rest, yaw: rest, vYaw: 0, goal: null, pitch: 0, phase: i * 1.7, focus: 0, kick: 0, pins: pinObjs });
  }
  if (signal.aborted) { renderer.dispose(); return { dispose() {} }; }
  const banner = pieces[pieces.length - 1];
  const tees = pieces.filter((p) => p.def.kind === 'tee');

  // ---- layout from the stage's own size: pick whichever arrangement shows the pieces biggest
  let W = 1, H = 1, topRes = 48, topFree = 14, botRes = 90;
  const camBase = new THREE.Vector3(0, 0, 8);
  const tanH = Math.tan((camera.fov * Math.PI) / 360);
  type Lay = { tees: [number, number][]; banner: [number, number, number, number, boolean] };
  const LAYS: Lay[] = [
    // a row with the banner at the end (as on the wall in the photos)
    { tees: [[-2.85, 0.06], [-1.37, -0.08], [0.11, 0.1], [1.59, -0.04]], banner: [2.95, 0.05, 0.95, 2.3, true] },
    // 2 × 2 with the banner beside
    { tees: [[-1.27, 0.82], [0.2, 0.74], [-1.27, -0.82], [0.2, -0.9]], banner: [1.6, -0.04, 0.95, 3.1, true] },
    // 2 × 2 with the banner across the top
    { tees: [[-0.73, 0.06], [0.73, -0.02], [-0.73, -1.56], [0.73, -1.64]], banner: [0, 1.32, 2.7, 0.56, false] },
  ];
  let layIdx = -1;
  const headEl = () => stage.parentElement?.querySelector<HTMLElement>('.ix-head') ?? null;
  const layout = () => {
    const rc = stage.getBoundingClientRect();
    W = Math.max(1, rc.width); H = Math.max(1, rc.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const he = headEl();
    const headOn = !!he && he.offsetParent !== null && getComputedStyle(he).display !== 'none';
    // with the shell's header showing, keep clear of it; embedded there is only a small expand button top-right
    topRes = headOn ? Math.max(40, he!.offsetHeight - 22) : 50;
    topFree = headOn ? topRes : 12;
    botRes = Math.max(56, dock.offsetHeight - 14);
    const compact = H < 540;
    stage.classList.toggle('compact', compact);
    stage.classList.toggle('tiny', H < 320);
    dock.classList.toggle('narrow', W < 440);
    stage.style.setProperty('--mw-free', `${topFree}px`);
    stage.style.setProperty('--mw-top', `${topRes}px`);
    stage.style.setProperty('--mw-bot', `${botRes}px`);
    const aw = W - 24, ah = Math.max(60, H - topRes - botRes - (compact ? 26 : 44));
    let best = -1, bestS = 0, bx = 0, by = 0;
    LAYS.forEach((L, li) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of L.tees) { x0 = Math.min(x0, x - TW / 2); x1 = Math.max(x1, x + TW / 2); y0 = Math.min(y0, y - TH / 2); y1 = Math.max(y1, y + TH / 2 + 0.05); }
      const [bxx, byy, bw, bh] = L.banner;
      x0 = Math.min(x0, bxx - bw / 2); x1 = Math.max(x1, bxx + bw / 2); y0 = Math.min(y0, byy - bh / 2); y1 = Math.max(y1, byy + bh / 2 + 0.05);
      const s = Math.min(aw / (x1 - x0), ah / (y1 - y0));
      if (s > bestS * 1.04 || best < 0) { best = li; bestS = s; bx = (x0 + x1) / 2; by = (y0 + y1) / 2; }
    });
    const L = LAYS[best];
    L.tees.forEach(([x, y], k) => tees[k].home.set(x, y, 0));
    const [bxx, byy, bw, bh, vert] = L.banner;
    banner.home.set(bxx, byy, 0.01);
    banner.w = bw; banner.h = bh;
    banner.meshes[0].scale.set(bw, bh, 1);
    if (best !== layIdx) {
      const m = banner.mats[0];
      m.map = m.emissiveMap = vert ? bannerV : bannerH;
      m.needsUpdate = true;
      layIdx = best;
    }
    // camera distance so the wall shows at bestS px per unit, its centre in the middle of the free area
    const d = H / (2 * tanH * bestS);
    const cyPx = topRes + 6 + ah / 2;
    camBase.set(bx, by - (H / 2 - cyPx) / bestS, d);
    // pins stay on the wall at each piece's home
    for (const p of pieces) {
      const pins = p.def.kind === 'tee' ? (p.def.pins ?? []).map(([u, v]) => [u, v]) : [[0.06, 0.02], [0.94, 0.02]];
      p.pins.forEach((o, k) => {
        const [u, v] = pins[k];
        o.position.set(p.home.x + (u - 0.5) * p.w, p.home.y + (0.5 - v) * p.h, p.def.kind === 'tee' ? 0.075 : 0.03);
      });
    }
    spare.forEach((s, k) => s.o.position.set(bx + s.u * (W / bestS) * 0.52, by + s.v * (H / bestS) * 0.5 + (k % 2 ? 0.2 : -0.1), -0.12));
    layoutReader();
  };

  // ---- focus a piece: it comes off its pins and floats forward
  let sel = -1;
  let mode: Mode = 'blue';
  let lastInput = -10;
  const focusTarget = new THREE.Vector3();
  const computeFocus = (p: Piece, out: THREE.Vector3) => {
    const infoH = info.offsetHeight || 60;
    const top = topFree + 4, bot = H - botRes - infoH - 6;
    const avail = Math.max(80, bot - top);
    const ppu = Math.min(avail / (p.h * 1.06), (W * 0.9) / (p.w * (p.def.kind === 'tee' ? 1.12 : 1.02)), 720 / p.h);
    const d = H / (2 * tanH * ppu);
    const cy = top + avail / 2;
    out.set(camBase.x, camBase.y + (H / 2 - cy) / ppu, camBase.z - d);
    return out;
  };
  const setInfo = () => {
    stage.classList.toggle('focused', sel >= 0);
    info.innerHTML = '';
    if (sel < 0) return;
    const d = PIECES[sel];
    info.append(h('b', {}, d.title), h('span', {}, d.sub),
      h('small', {}, ctx.coarse ? `Tap the ${d.kind === 'tee' ? 'print' : 'banner'} or pinch to read every line` : `Click the ${d.kind === 'tee' ? 'print' : 'banner'} or scroll to read every line`));
  };
  const syncDock = () => {
    const reading = readerOn;
    const isTee = sel >= 0 && PIECES[sel].kind === 'tee';
    pinBtn.hidden = reading || sel < 0;
    turnBtn.hidden = reading || !isTee;
    readBtn.hidden = reading || sel < 0;
    (readBtn.querySelector('span') as HTMLElement).textContent = sel >= 0 && !isTee ? 'Read the banner' : 'Read the print';
    backBtn.hidden = prevBtn.hidden = nextBtn.hidden = !reading;
    acts.hidden = !reading && sel < 0;
    requestAnimationFrame(() => { if (!signal.aborted) layout(); });
  };
  const focus = (i: number) => {
    sel = i;
    const p = pieces[i];
    p.yaw = p.rest - 0.8; p.vYaw = 0; p.goal = null;
    hint.classList.add('gone');
    setInfo();
    syncDock();
  };
  const unfocus = () => {
    if (sel >= 0) { pieces[sel].vYaw = 0; pieces[sel].kick = 1; }
    sel = -1;
    setInfo();
    syncDock();
  };
  pinBtn.addEventListener('click', unfocus, { signal });
  turnBtn.addEventListener('click', () => { if (sel >= 0) { const T = pieces[sel]; T.goal = Math.round(T.yaw / Math.PI) * Math.PI + Math.PI; T.vYaw = 0; } }, { signal });
  readBtn.addEventListener('click', () => { if (sel >= 0) openReader(sel, 0); }, { signal });

  // ---- the light switch
  const setMode = (m: Mode) => {
    mode = m;
    (Object.keys(segBtns) as Mode[]).forEach((k) => segBtns[k].setAttribute('aria-pressed', String(k === m)));
    stage.dataset.light = m;
    lastInput = m === 'torch' ? performance.now() / 1000 : lastInput;
  };
  (Object.keys(segBtns) as Mode[]).forEach((k) => segBtns[k].addEventListener('click', () => setMode(k), { signal }));
  stage.dataset.light = 'blue';

  // ================= reader: the print up close =================
  let readerOn = false, rp = -1, rs = 0, readerT = 0, zhT = 0;
  let fs = 1, z = 1, tx = 0, ty = 0;
  const reg = { x: 0, y: 0, w: 1, h: 1 };
  // zoom limit: never more than ~3.6 screen px per photo px (the crops are photo resolution)
  const zmax = () => Math.max(2, Math.min(7, 3.6 / fs));
  const applySheet = () => { sheetEl.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${fs * z})`; };
  const clampSheet = () => {
    const d = PIECES[rp];
    const sw = d.iw * fs * z, sh = d.ih * fs * z;
    const slack = 24;
    tx = sw <= reg.w ? reg.x + (reg.w - sw) / 2 : Math.min(reg.x + slack, Math.max(reg.x + reg.w - sw - slack, tx));
    ty = sh <= reg.h ? reg.y + (reg.h - sh) / 2 : Math.min(reg.y + slack, Math.max(reg.y + reg.h - sh - slack, ty));
  };
  const spotBox = (s: Shape) => (s.t === 'rect' ? [s.x0, s.y0, s.x1, s.y1] : [s.cx - s.rx - (s.t === 'ring' ? s.w / 2 : 0), s.cy - s.ry - (s.t === 'ring' ? s.w / 2 : 0), s.cx + s.rx + (s.t === 'ring' ? s.w / 2 : 0), s.cy + s.ry + (s.t === 'ring' ? s.w / 2 : 0)]);
  const zoomToSpot = (animate: boolean) => {
    const d = PIECES[rp];
    const [x0, y0, x1, y1] = spotBox(d.spots[rs].shape);
    const bw = x1 - x0, bh = y1 - y0;
    z = Math.max(1, Math.min(zmax(), (reg.w * 0.88) / (bw * fs), (reg.h * 0.78) / (bh * fs)));
    tx = reg.x + reg.w / 2 - ((x0 + x1) / 2) * fs * z;
    ty = reg.y + reg.h / 2 - ((y0 + y1) / 2) * fs * z;
    clampSheet();
    sheetEl.classList.toggle('live', !animate);
    applySheet();
  };
  function layoutReader() {
    if (rp < 0) return;
    const d = PIECES[rp];
    const capH = cap.offsetHeight || 70;
    reg.x = 12; reg.w = W - 24;
    reg.y = topFree + 4;
    reg.h = Math.max(60, H - botRes - capH - 16 - reg.y);
    // keep whatever crop point sat in the middle of the view in the middle after the refit
    const mx = (reg.x + reg.w / 2 - tx) / (fs * z), my = (reg.y + reg.h / 2 - ty) / (fs * z);
    fs = Math.min(reg.w / d.iw, reg.h / d.ih);
    tx = reg.x + reg.w / 2 - mx * fs * z;
    ty = reg.y + reg.h / 2 - my * fs * z;
    clampSheet();
    sheetEl.classList.add('live');
    applySheet();
  }
  const ringPath = (s: Extract<Shape, { t: 'ring' }>) => {
    const a0 = ((s.a0 ?? -90) * Math.PI) / 180, a1 = ((s.a1 ?? 270) * Math.PI) / 180;
    const P = (a: number) => `${(s.cx + s.rx * Math.cos(a)).toFixed(1)} ${(s.cy + s.ry * Math.sin(a)).toFixed(1)}`;
    const full = Math.abs(a1 - a0) >= Math.PI * 1.99;
    if (full) { const m = (a0 + a1) / 2; return `M${P(a0)}A${s.rx} ${s.ry} 0 1 1 ${P(m)}A${s.rx} ${s.ry} 0 1 1 ${P(a1 - 0.001)}`; }
    return `M${P(a0)}A${s.rx} ${s.ry} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${P(a1)}`;
  };
  const drawMarks = () => {
    const d = PIECES[rp];
    const s = d.spots[rs].shape;
    svg.setAttribute('viewBox', `0 0 ${d.iw} ${d.ih}`);
    for (const r of svg.querySelectorAll<SVGRectElement>('.mw-mfull, .mw-dim')) { r.setAttribute('width', String(d.iw)); r.setAttribute('height', String(d.ih)); }
    const hole = svg.querySelector('.mw-mhole')!, out = svg.querySelector('.mw-out')!;
    let holeS = '', outS = '';
    if (s.t === 'rect') {
      const pad = Math.max(3, Math.min(12, (s.y1 - s.y0) * 0.18));
      const a = `x="${s.x0 - pad}" y="${s.y0 - pad}" width="${s.x1 - s.x0 + pad * 2}" height="${s.y1 - s.y0 + pad * 2}" rx="${pad * 1.4}"`;
      holeS = `<rect ${a} fill="#000"/>`;
      outS = `<rect ${a} class="mw-ol" pathLength="1"/>`;
    } else if (s.t === 'disc') {
      const a = `cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"`;
      holeS = `<ellipse ${a} fill="#000"/>`;
      outS = `<ellipse ${a} class="mw-ol" pathLength="1"/>`;
    } else {
      const p = ringPath(s);
      holeS = `<path d="${p}" fill="none" stroke="#000" stroke-width="${s.w}" stroke-linecap="round"/>`;
      outS = `<path d="${p}" class="mw-band" stroke-width="${s.w}" pathLength="1"/><path d="${p}" class="mw-ol thin" pathLength="1"/>`;
    }
    hole.innerHTML = holeS;
    out.innerHTML = outS;
    // replay the draw-on
    out.classList.remove('draw');
    void (out as SVGGElement).getBoundingClientRect();
    out.classList.add('draw');
  };
  const setCaption = () => {
    const d = PIECES[rp];
    const sp = d.spots[rs];
    const kind = sp.kind === 'image' ? 'Image' : sp.kind === 'small' ? 'Small print' : 'Text';
    cap.innerHTML = '';
    const label = h('small', {}, `${kind} · ${rs + 1} of ${d.spots.length}`);
    let main: HTMLElement;
    if (sp.of) {
      const at = sp.of.indexOf(sp.text);
      main = h(sp.kind === 'image' ? 'em' : 'q', { class: sp.kind === 'image' ? 'img' : 'txt' }, sp.of.slice(0, at), h('mark', {}, sp.text), sp.of.slice(at + sp.text.length));
    } else if (sp.kind === 'image') main = h('em', { class: 'img' }, sp.text);
    else main = h('q', { class: `txt${sp.kind === 'small' ? ' small' : ''}` }, sp.text);
    const note = sp.note ? h('span', { class: 'note' }, sp.note) : null;
    const src = h('span', { class: 'src' }, `${d.photoNote}${d.day && mode === 'day' ? ' · daylight colours estimated' : mode === 'blue' || !d.day ? ' · as photographed' : ''}`);
    cap.append(label, main, ...(note ? [note] : []), src);
  };
  const showSpot = (i: number, animate = true) => {
    const d = PIECES[rp];
    rs = (i + d.spots.length) % d.spots.length;
    setCaption();
    drawMarks();
    layoutReader();
    if (animate) zoomToSpot(true);
  };
  const syncReaderImages = () => {
    if (rp < 0) return;
    const d = PIECES[rp];
    const showDay = d.day && mode === 'day';
    reader.classList.toggle('dayimg', showDay);
    reader.classList.toggle('torch', mode === 'torch');
    if (readerOn) setCaption();
  };
  const openReader = (i: number, spot: number) => {
    const d = PIECES[i];
    rp = i;
    imBlue.src = ctx.asset(`media/interact/merch/${d.id}_blue.jpg`);
    imDay.src = d.day ? ctx.asset(`media/interact/merch/${d.id}_day.jpg`) : imBlue.src;
    imBlue.style.width = imDay.style.width = `${d.iw}px`;
    imBlue.style.height = imDay.style.height = `${d.ih}px`;
    sheetEl.style.width = `${d.iw}px`; sheetEl.style.height = `${d.ih}px`;
    imDay.alt = `${d.kind === 'tee' ? 'The print' : 'The banner'}: ${d.title}`;
    readerOn = true;
    readerT = 0;
    reader.classList.add('on');
    reader.setAttribute('aria-hidden', 'false');
    stage.classList.add('reading');
    zoomHint.classList.remove('gone');
    clearTimeout(zhT);
    zhT = window.setTimeout(() => zoomHint.classList.add('gone'), 3800);
    syncReaderImages();
    syncDock();
    // first fit the whole print, then glide to the line
    rs = spot;
    setCaption();
    drawMarks();
    layoutReader();
    z = 1; clampSheet(); sheetEl.classList.add('live'); applySheet();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (readerOn) zoomToSpot(true); }));
  };
  const closeReader = () => {
    readerOn = false;
    reader.classList.remove('on');
    reader.setAttribute('aria-hidden', 'true');
    stage.classList.remove('reading');
    syncDock();
  };
  backBtn.addEventListener('click', closeReader, { signal });
  prevBtn.addEventListener('click', () => showSpot(rs - 1), { signal });
  nextBtn.addEventListener('click', () => showSpot(rs + 1), { signal });
  for (const k of Object.keys(segBtns) as Mode[]) segBtns[k].addEventListener('click', syncReaderImages, { signal });
  stage.addEventListener('keydown', (e) => {
    if (!readerOn) return;
    if (e.key === 'ArrowRight') { showSpot(rs + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { showSpot(rs - 1); e.preventDefault(); }
  }, { signal });

  // reader gestures: drag to pan, pinch / wheel to zoom, tap a marked line to jump to it
  const rPtr = new Map<number, { x: number; y: number }>();
  let rDown: { x: number; y: number; t: number; moved: boolean } | null = null;
  let pinch0: { d: number; z: number; mx: number; my: number; tx: number; ty: number } | null = null;
  const toCrop = (cx: number, cy: number) => { const rc = stage.getBoundingClientRect(); return [(cx - rc.left - tx) / (fs * z), (cy - rc.top - ty) / (fs * z)]; };
  const hitSpot = (d: PieceDef, x: number, y: number) => {
    let best = -1;
    d.spots.forEach((sp, k) => {
      const s = sp.shape;
      let inside = false;
      if (s.t === 'rect') inside = x >= s.x0 - 6 && x <= s.x1 + 6 && y >= s.y0 - 6 && y <= s.y1 + 6;
      else {
        const r = Math.hypot((x - s.cx) / s.rx, (y - s.cy) / s.ry);
        inside = s.t === 'disc' ? r <= 1 : Math.abs(r - 1) * s.rx <= s.w / 2 + 6;
      }
      if (inside && (best < 0 || (d.spots[best].kind === 'image' && sp.kind !== 'image'))) best = k;
    });
    return best;
  };
  const zoomAt = (nz: number, px: number, py: number) => {
    nz = Math.max(1, Math.min(zmax(), nz));
    const k = nz / z;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    z = nz;
    clampSheet();
    applySheet();
  };
  const torchAt = (cx: number, cy: number) => {
    const rc = stage.getBoundingClientRect();
    reader.style.setProperty('--tx', `${cx - rc.left}px`);
    reader.style.setProperty('--ty', `${cy - rc.top}px`);
  };
  reader.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.mw-cap')) return;
    rPtr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { reader.setPointerCapture(e.pointerId); } catch { /* ok */ }
    sheetEl.classList.add('live');
    torchAt(e.clientX, e.clientY);
    if (rPtr.size === 1) rDown = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (rPtr.size === 2) {
      const [a, b] = [...rPtr.values()];
      const rc = stage.getBoundingClientRect();
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z, mx: (a.x + b.x) / 2 - rc.left, my: (a.y + b.y) / 2 - rc.top, tx, ty };
      if (rDown) rDown.moved = true;
    }
  }, { signal });
  reader.addEventListener('pointermove', (e) => {
    if (mode === 'torch') torchAt(e.clientX, e.clientY);
    const p = rPtr.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (rPtr.size >= 2 && pinch0) {
      const [a, b] = [...rPtr.values()];
      const rc = stage.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rc.left, my = (a.y + b.y) / 2 - rc.top;
      const nz = Math.max(1, Math.min(zmax(), pinch0.z * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d))));
      const k = nz / pinch0.z;
      tx = mx - (pinch0.mx - pinch0.tx) * k;
      ty = my - (pinch0.my - pinch0.ty) * k;
      z = nz;
      clampSheet();
      applySheet();
      zoomHint.classList.add('gone');
      return;
    }
    if (rDown && Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 7) rDown.moved = true;
    if (rDown?.moved) { tx += dx; ty += dy; clampSheet(); applySheet(); }
  }, { signal });
  const rUp = (e: PointerEvent) => {
    if (!rPtr.has(e.pointerId)) return;
    rPtr.delete(e.pointerId);
    if (rPtr.size < 2) pinch0 = null;
    if (rPtr.size > 0) return;
    const tap = rDown && !rDown.moved && performance.now() - rDown.t < 500;
    rDown = null;
    if (tap && rp >= 0) {
      const [x, y] = toCrop(e.clientX, e.clientY);
      const k = hitSpot(PIECES[rp], x, y);
      if (k >= 0 && k !== rs) showSpot(k);
    }
  };
  reader.addEventListener('pointerup', rUp, { signal });
  reader.addEventListener('pointercancel', rUp, { signal });
  reader.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rc = stage.getBoundingClientRect();
    sheetEl.classList.add('live');
    zoomAt(z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - rc.left, e.clientY - rc.top);
    zoomHint.classList.add('gone');
  }, { signal, passive: false });

  // ================= wall + focused piece: pointer input =================
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const torchGoal = new THREE.Vector3(0, 0, 0);
  let torchLive = false;
  const el = renderer.domElement;
  const ptr = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; lx: number; t: number } | null = null;
  let pinchD = 0;
  const setRay = (cx: number, cy: number) => {
    const rc = el.getBoundingClientRect();
    ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const aimTorch = (cx: number, cy: number) => {
    setRay(cx, cy);
    if (ray.ray.intersectPlane(wallPlane, torchGoal)) { torchLive = true; lastInput = performance.now() / 1000; }
  };
  /** Which line of the print sits under a hit on the tee (uv → crop px). */
  const spotFromHit = (hit: THREE.Intersection) => {
    const p = pieces[hit.object.userData.i as number];
    if (p.def.kind !== 'tee' || !hit.uv) return 0;
    const onBack = !!hit.object.userData.back;
    if (onBack !== !!p.def.back) return 0;
    const r = printRect(p.def);
    const X = hit.uv.x * TEX_W, Y = (1 - hit.uv.y) * TEX_H;
    const cx = ((X - r.x) / r.w) * p.def.iw, cy = ((Y - r.y) / r.h) * p.def.ih;
    const k = hitSpot(p.def, cx, cy);
    return k >= 0 ? k : 0;
  };
  const pick = (cx: number, cy: number) => {
    setRay(cx, cy);
    return ray.intersectObjects(pieces.flatMap((p) => p.meshes))[0] ?? null;
  };
  el.addEventListener('pointerdown', (e) => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    if (ptr.size === 1) down = { x: e.clientX, y: e.clientY, lx: e.clientX, t: performance.now() };
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); down = null; }
    if (sel < 0 && ptr.size === 1) aimTorch(e.clientX, e.clientY);
  }, { signal });
  el.addEventListener('pointermove', (e) => {
    const p = ptr.get(e.pointerId);
    if (!p) {
      // hover with a mouse: the light follows
      if (e.pointerType === 'mouse' && sel < 0) aimTorch(e.clientX, e.clientY);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (sel >= 0 && d - pinchD > 28) {
        ptr.clear();
        const hit = pick((a.x + b.x) / 2, (a.y + b.y) / 2);
        openReader(sel, hit && hit.object.userData.i === sel ? spotFromHit(hit) : 0);
      }
      return;
    }
    if (!down) return;
    const dx = e.clientX - down.lx;
    down.lx = e.clientX;
    if (sel < 0) { aimTorch(e.clientX, e.clientY); return; }
    const t = pieces[sel];
    if (t.def.kind !== 'tee') return;
    t.goal = null;
    t.yaw += dx * 0.011;
    t.vYaw = t.vYaw * 0.4 + dx * 0.011 * 0.6;
    t.pitch = Math.max(-0.35, Math.min(0.35, (e.clientY - down.y) * 0.003));
  }, { signal });
  const up = (e: PointerEvent) => {
    if (!ptr.has(e.pointerId)) return;
    ptr.delete(e.pointerId);
    if (!down) return;
    if (ptr.size > 0) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8 && performance.now() - down.t < 600;
    down = null;
    if (sel >= 0) pieces[sel].pitch = 0;
    if (!tap || e.type === 'pointercancel') return;
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      const i = hit.object.userData.i as number;
      if (i === sel) openReader(i, spotFromHit(hit));
      else focus(i);
    } else if (sel >= 0) unfocus();
  };
  el.addEventListener('pointerup', up, { signal });
  el.addEventListener('pointercancel', up, { signal });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptr.size) torchLive = false; }, { signal });
  el.addEventListener('wheel', (e) => {
    if (sel < 0 || readerOn) return;
    e.preventDefault();
    if (e.deltaY < -2) { const hit = pick(e.clientX, e.clientY); openReader(sel, hit && hit.object.userData.i === sel ? spotFromHit(hit) : 0); }
  }, { signal, passive: false });

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  ro.observe(dock);
  syncDock();
  layout();
  for (const p of pieces) { p.group.position.copy(p.home); p.group.rotation.y = p.rest; }
  // compile the shaders off the main thread where the browser can, then upload the textures a frame at a time
  await nextFrame();
  // one material at a time (each program build is its own small task), using the scene's lights
  const byMat = new Map<THREE.Material, THREE.Object3D>();
  scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m && !Array.isArray(m) && !byMat.has(m)) byMat.set(m, o); });
  for (const o of byMat.values()) {
    try { await renderer.compileAsync(o, camera, scene); } catch { /* compiles on first render instead */ }
    await nextFrame();
    if (signal.aborted) break;
  }
  const texs = new Set<THREE.Texture>([bannerH]);
  scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.map) texs.add(m.map); });
  for (const t of texs) { await nextFrame(); if (signal.aborted) break; renderer.initTexture(t); }
  await nextFrame();
  if (signal.aborted) { renderer.dispose(); renderer.forceContextLoss(); return { dispose() {} }; }

  // ================= animate =================
  const tmpC = new THREE.Color();
  let sweepT = 0;
  const tmpC2 = new THREE.Color();
  const stop = loop((dt, t) => {
    const rm = ctx.reduced ? 0.2 : 1;
    if (readerOn) readerT += dt;
    // fully covered by the reader: skip the GL work
    if (readerOn && readerT > 0.5) return;
    const M = MODES[mode];
    const kl = 1 - Math.pow(0.02, dt);
    tmpC.setHex(M.clear); renderer.getClearColor(tmpC2); tmpC2.lerp(tmpC, kl); renderer.setClearColor(tmpC2);
    hemi.color.lerp(tmpC.setHex(M.sky), kl); hemi.groundColor.lerp(tmpC.setHex(M.ground), kl);
    hemi.intensity += (M.hemi - hemi.intensity) * kl;
    dirL.color.lerp(tmpC.setHex(M.dir), kl); dirL.intensity += (M.dirI - dirL.intensity) * kl;
    rim.intensity += (M.rimI - rim.intensity) * kl;
    rim.color.lerp(tmpC.setHex(mode === 'day' ? 0xffffff : 0x9fb4ff), kl);
    roam.color.lerp(tmpC.setHex(M.roam), kl);
    roam.angle += (M.roamA - roam.angle) * kl;
    key.color.lerp(tmpC.setHex(M.key), kl);

    for (const T of pieces) {
      T.focus += ((sel === T.i ? 1 : 0) - T.focus) * (1 - Math.pow(ctx.reduced ? 0.0005 : 0.015, dt));
      const f = T.focus;
      const ease = f * f * (3 - 2 * f);
      if (f > 0.001) computeFocus(T, focusTarget);
      T.group.position.lerpVectors(T.home, f > 0.001 ? focusTarget : T.home, ease);
      // arc out from the wall a little on the way
      T.group.position.z += Math.sin(ease * Math.PI) * 0.4;
      if (sel !== T.i) { T.yaw = T.rest + (T.yaw - T.rest) * Math.pow(0.04, dt); T.vYaw = 0; }
      else if (!down) {
        T.yaw += T.vYaw * dt * 60;
        T.vYaw *= Math.pow(0.9, dt * 60);
        const goal = T.goal ?? Math.round(T.yaw / Math.PI) * Math.PI;
        if (Math.abs(T.vYaw) < 0.02) { T.yaw += (goal - T.yaw) * (1 - Math.pow(0.03, dt)); if (Math.abs(goal - T.yaw) < 0.002) T.goal = null; }
      }
      // back on the wall: a swing on the pins after being dropped back, then the slow idle sway
      T.kick *= Math.pow(0.2, dt);
      const onWall = 1 - f;
      const swing = onWall * (rm * 0.012 * Math.sin(t * 0.72 + T.phase * 1.3) + T.kick * 0.07 * Math.sin(t * 6.5) * onWall);
      T.group.rotation.set(T.pitch * f, T.yaw, swing);
      const dim = sel >= 0 && sel !== T.i ? 0.25 : 1;
      for (const m of T.mats) { const c = m.color.r + (dim - m.color.r) * Math.min(1, dt * 6); m.color.setScalar(c); }
      // cloth: pinned points hold, the rest sways and sags; turning makes it flutter
      const flutter = Math.min(1, Math.abs(T.vYaw) * 6);
      const isTee = T.def.kind === 'tee';
      const hw = isTee ? TW * 0.3 : 0.5;
      for (const S of T.sheets) {
        const pos = S.geo.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        const b = S.base;
        for (let k = 0, v = 0; k < arr.length; k += 3, v++) {
          const x = b[k], y = b[k + 1];
          const free = S.freeWall[v] + (S.freeHeld[v] - S.freeWall[v]) * f;
          if (isTee) {
            const bulge = 0.065 * Math.max(0, 1 - (x / hw) ** 2) * (0.35 + 0.65 * f) * (y < TH * 0.36 ? 1 : 0.6);
            const sway = rm * free * (0.03 * Math.sin(t * 1.5 + T.phase + y * 2.6 + x * 1.2) + flutter * 0.07 * Math.sin(t * 9 + y * 6 + x * 3) + T.kick * 0.05 * Math.sin(t * 7 + y * 3));
            arr[k] = x + rm * free * 0.01 * Math.sin(t * 1.1 + T.phase + y * 3);
            arr[k + 1] = y - free * 0.022;
            arr[k + 2] = S.sign * bulge + sway;
          } else {
            const free2 = Math.min(1, free * 1.2);
            arr[k + 2] = rm * free2 * (0.03 * Math.sin(t * 1.2 + x * 4 + T.phase) + 0.012 * Math.sin(t * 2.3 + y * 5));
          }
        }
        pos.needsUpdate = true;
        S.geo.computeVertexNormals();
      }
    }
    // the roaming light: a finger / mouse aims it; left alone it sweeps slowly along the wall
    const now = performance.now() / 1000;
    const idle = now - lastInput > 3.5 || !torchLive;
    if (idle) torchLive = false;
    sweepT += dt * (ctx.reduced ? 0 : 1);
    const span = Math.max(1, (W / H) * camBase.z * tanH * 0.75);
    const gx = idle ? camBase.x + Math.sin(sweepT * 0.23) * span : torchGoal.x;
    const gy = idle ? camBase.y - 0.2 + Math.sin(sweepT * 0.31) * 0.25 : torchGoal.y;
    const kt = 1 - Math.pow(idle ? 0.3 : 0.0005, dt);
    roam.target.position.x += (gx - roam.target.position.x) * kt;
    roam.target.position.y += (gy - roam.target.position.y) * kt;
    roam.position.set(roam.target.position.x * 0.7, roam.target.position.y + 1.4, camBase.z * 0.75);
    const roamOn = sel < 0 ? M.roamI * (idle && ctx.reduced && mode !== 'torch' ? 0 : 1) : M.roamI * (mode === 'torch' ? 0.15 : 0);
    roam.intensity += (roamOn - roam.intensity) * Math.min(1, dt * 3);
    roam.distance = camBase.z * 2.2;
    // key light on the chosen piece
    const kti = sel >= 0 ? M.keyI : 0;
    key.intensity += (kti - key.intensity) * Math.min(1, dt * 4);
    key.distance = camBase.z * 2;
    if (sel >= 0) { key.target.position.copy(pieces[sel].group.position); key.position.set(camBase.x + 0.6, camBase.y + 1.8, camBase.z * 0.9); }
    // camera: a slow idle drift
    const drift = ctx.reduced ? 0 : 1;
    camera.position.set(camBase.x + drift * 0.05 * Math.sin(t * 0.17), camBase.y + drift * 0.03 * Math.sin(t * 0.23 + 1), camBase.z);
    camera.lookAt(camera.position.x * 0.9 + camBase.x * 0.1, camera.position.y * 0.9 + camBase.y * 0.1, 0);
    renderer.render(scene, camera);
  });

  return {
    dispose() {
      stop();
      ro.disconnect();
      clearTimeout(zhT);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) { const s = mt as THREE.MeshStandardMaterial; s.map?.dispose(); s.emissiveMap?.dispose(); mt.dispose(); }
      });
      bannerV.dispose(); bannerH.dispose(); plainFront.dispose(); plainBack.dispose();
      delete clothCache.front; delete clothCache.back;
      renderer.dispose();
      renderer.forceContextLoss();
      imDay.removeAttribute('src'); imBlue.removeAttribute('src');
    },
  };
}
