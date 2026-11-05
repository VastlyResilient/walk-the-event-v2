import './shape.css';
import { h } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { fit, ico, loop, onResize, rng } from './common';

/*
 * "The Shape of Everything" (Jteve Sobs), interpreted. Everything here is this recreation's own reading of the wall card,
 * not the artist's material:
 *  - "sound and moving image ... as one medium": one score drives both. Every glyph that turns over is a note, every
 *    chord change advances the icon panels, every shimmer is a spark of light, and the drawing reads the real Web Audio
 *    output (AnalyserNodes) so the picture breathes with what you hear.
 *  - "layers of generative ai": four stacked generative layers, each a voice and a picture: Drone (architecture lines),
 *    Glyphs (the grid, plucked notes), Icons (icon-image panels and tiles, pads), Haze (light and particles, shimmer).
 *    Tap to mute a layer, hold to solo it.
 *  - "speculative worldbuilding ... post-human futures, machine consciousness, architectures that evoke a beatific
 *    vision": three worlds to travel between, each a complete audiovisual environment (palette, glyph vocabulary,
 *    structures, scale, tempo, timbre). Travelling sweeps the new world across the wall while the sound glides with it.
 *  - Drawing a stroke on the wall turns it into a glyph that joins the score and loops in every world.
 */

const NG = 48; // glyphs per vocabulary
const CELL = 80; // atlas cell px
const ACOLS = 8;
const MAXU = 6; // visitor glyphs kept in the score
const LAYERS = ['Drone', 'Glyphs', 'Icons', 'Haze'] as const;

type Style = 0 | 1 | 2;
interface World {
  name: string; short: string; quote: string; style: Style;
  bg: [string, string, string]; ink: string; glow: string; accent: string; arch: string; archGlow: string; haze: string;
  panel: string[]; root: number; scale: number[]; chords: number[][]; tempo: number;
  drone: number[]; cutoff: number; lfo: number; trem: number; shimmer: number;
  pluck: { type: OscillatorType; decay: number; partial: number; bright: number };
  layerCol: [string, string, string, string];
}

const WORLDS: World[] = [
  {
    name: 'Post-human Futures', short: 'Post-human', quote: 'post-human futures', style: 0,
    bg: ['#22174f', '#0f0a28', '#05030c'], ink: '#efeaff', glow: '#9d86ff', accent: '#ff6ccf', arch: '#bfaeff', archGlow: '#7b5cff', haze: '#d4c8ff',
    panel: ['#8f7dff', '#c6b8ff', '#ff5cc6', '#5ee8ff', '#3b2b9a', '#f1ecff', '#2a1f6b'],
    root: 40, scale: [0, 2, 4, 7, 9], chords: [[0, 7, 11, 14, 16], [-3, 4, 7, 11, 14], [-7, 0, 4, 11, 14], [-5, 2, 7, 9, 14]], tempo: 2.6,
    drone: [1, 1.5, 2, 0], cutoff: 620, lfo: 0.07, trem: 0, shimmer: 0.5,
    pluck: { type: 'triangle', decay: 1.6, partial: 2.005, bright: 1 },
    layerCol: ['#9d86ff', '#efeaff', '#ff6ccf', '#7fe8ff'],
  },
  {
    name: 'Machine Consciousness', short: 'Machine', quote: 'machine consciousness', style: 1,
    bg: ['#08283f', '#041322', '#02060b'], ink: '#dcfbff', glow: '#38d6ff', accent: '#7dffcf', arch: '#6fe6ff', archGlow: '#1d8fff', haze: '#a8f6ff',
    panel: ['#38d6ff', '#0e5d8a', '#7dffcf', '#d8fbff', '#1b3a66', '#ffcf6b', '#0a2a44'],
    root: 45, scale: [0, 3, 5, 7, 10], chords: [[0, 7, 10, 14, 15], [-4, 0, 3, 7, 10], [-2, 2, 5, 7, 14], [-5, -2, 2, 5, 10]], tempo: 3.6,
    drone: [1, 2, 3, 0], cutoff: 430, lfo: 0.11, trem: 0.45, shimmer: 0.28,
    pluck: { type: 'square', decay: 0.7, partial: 3, bright: 0.45 },
    layerCol: ['#38d6ff', '#dcfbff', '#7dffcf', '#ffcf6b'],
  },
  {
    name: 'Beatific Architecture', short: 'Beatific', quote: 'architectures that evoke a beatific vision of the near future', style: 2,
    bg: ['#33223f', '#170f26', '#07050c'], ink: '#fff7e6', glow: '#ffc978', accent: '#ff9ed8', arch: '#ffe4ad', archGlow: '#ffae55', haze: '#fff0c8',
    panel: ['#ffe2a6', '#ffb35c', '#f6d2ff', '#b98cff', '#3a2550', '#fff7e6', '#5b3a7a'],
    root: 38, scale: [0, 2, 4, 6, 7, 9, 11], chords: [[0, 4, 7, 11, 14], [2, 6, 9, 14, 18], [-3, 0, 4, 7, 11], [-5, -1, 2, 6, 9]], tempo: 1.8,
    drone: [1, 1.5, 2, 3], cutoff: 900, lfo: 0.05, trem: 0, shimmer: 0.9,
    pluck: { type: 'sine', decay: 2.6, partial: 2.76, bright: 1.4 },
    layerCol: ['#ffae55', '#fff7e6', '#ff9ed8', '#fff0c8'],
  },
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const deg = (w: World, i: number) => { const n = w.scale.length; const k = ((i % n) + n) % n; return w.scale[k] + 12 * Math.floor(i / n); };

/* ---------------- glyph vocabularies (three styles, mirror-symmetric) ---------------- */

function glyphPath(R: () => number, s: number, style: Style) {
  const p = new Path2D();
  const P = (x: number, y: number): [number, number] => [x * s, y * s];
  const line = (x0: number, y0: number, x1: number, y1: number, mirror = true) => {
    p.moveTo(...P(x0, y0)); p.lineTo(...P(x1, y1));
    if (mirror && (x0 !== 0 || x1 !== 0)) { p.moveTo(...P(-x0, y0)); p.lineTo(...P(-x1, y1)); }
  };
  const circ = (x: number, y: number, r: number) => { p.moveTo(...P(x + r, y)); p.arc(x * s, y * s, r * s, 0, Math.PI * 2); };
  const poly = (pts: number[][], close = false, mirror = true) => {
    for (const sgn of mirror ? [1, -1] : [1]) {
      pts.forEach(([x, y], i) => (i ? p.lineTo(...P(x * sgn, y)) : p.moveTo(...P(x * sgn, y))));
      if (close) p.closePath();
    }
  };
  let parts = 0;
  if (style === 0) {
    const stem = R() < 0.55;
    if (stem) { line(0, -0.82, 0, 0.82, false); parts++; }
    if (R() < 0.4) { circ(0, stem ? (R() < 0.5 ? -0.35 : 0) : 0, [0.3, 0.5, 0.72][Math.floor(R() * 3)]); parts++; }
    if (R() < 0.26) { const up = R() < 0.5 ? 1 : -1; poly([[0, -0.7 * up], [0.68, 0.55 * up], [-0.68, 0.55 * up]], true, false); parts++; }
    for (const y of [-0.55, 0, 0.55]) if (R() < 0.24) { line(0, y, 0.25 + R() * 0.5, y); parts++; }
    if (R() < 0.3) { line(0, R() < 0.5 ? -0.1 : 0.2, 0.3 + R() * 0.5, R() < 0.5 ? -0.8 : 0.8); parts++; }
    if (R() < 0.28) { const y = (R() - 0.5) * 1.2, x = 0.35 + R() * 0.35; circ(x, y, 0.09); circ(-x, y, 0.09); parts++; }
    if (R() < 0.2) { p.moveTo(...P(0.5, -0.45)); p.arc(0, -0.45 * s, 0.5 * s, 0, Math.PI, true); parts++; }
    if (R() < 0.18) { poly([[0, -0.75], [0.6, 0], [0, 0.75], [-0.6, 0]], true, false); parts++; }
    if (R() < 0.2) { line(0.15, 0.2, 0.55, 0.62); line(0.15, -0.2, 0.55, -0.62); parts++; }
    if (parts < 2) { line(0, -0.8, 0, 0.8, false); circ(0, -0.42, 0.42); }
  } else if (style === 1) {
    // machine: rectilinear frames, brackets, ports, stepped traces
    if (R() < 0.36) { const w = 0.45 + R() * 0.3, hh = 0.35 + R() * 0.4; p.rect(-w * s, -hh * s, 2 * w * s, 2 * hh * s); parts++; }
    if (R() < 0.3) { poly([[0.45, -0.75], [0.72, -0.75], [0.72, 0.75], [0.45, 0.75]]); parts++; }
    if (R() < 0.42) { line(0, -0.8, 0, 0.5, false); line(0, 0.5, 0.35, 0.5); parts++; }
    if (R() < 0.3) { for (const y of [-0.45, 0, 0.45]) { const x = 0.32; p.rect((x - 0.07) * s, (y - 0.07) * s, 0.14 * s, 0.14 * s); p.rect((-x - 0.07) * s, (y - 0.07) * s, 0.14 * s, 0.14 * s); } parts++; }
    for (const y of [-0.55, 0, 0.55]) if (R() < 0.26) { line(0, y, 0.2 + R() * 0.5, y); parts++; }
    if (R() < 0.28) { circ(0, 0, 0.22); circ(0, 0, 0.06); parts++; }
    if (R() < 0.26) { poly([[0, -0.62], [0.3, -0.62], [0.3, -0.18], [0.62, -0.18], [0.62, 0.3]]); parts++; }
    if (R() < 0.2) { poly([[0.25, -0.5], [0.6, 0], [0.25, 0.5]]); parts++; }
    if (R() < 0.18) { line(0.12, 0.78, 0.12, 0.45); line(0.36, 0.78, 0.36, 0.45); parts++; }
    if (parts < 2) { p.rect(-0.5 * s, -0.5 * s, s, s); circ(0, 0, 0.2); }
  } else {
    // beatific: halos, ogive arches, rays, mandorlas, stars
    const halo = R() < 0.42;
    if (halo) { line(0, -0.15, 0, 0.82, false); circ(0, -0.48, 0.26); parts++; }
    if (R() < 0.36) { p.moveTo(...P(-0.58, 0.8)); p.lineTo(...P(-0.58, 0.05)); p.arcTo(-0.58 * s, -0.55 * s, 0, -0.85 * s, 0.9 * s); p.lineTo(...P(0, -0.85)); p.moveTo(...P(0.58, 0.8)); p.lineTo(...P(0.58, 0.05)); p.arcTo(0.58 * s, -0.55 * s, 0, -0.85 * s, 0.9 * s); p.lineTo(...P(0, -0.85)); parts++; }
    if (R() < 0.3) { const n = 8, cy = halo ? -0.48 : 0; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.moveTo(...P(Math.cos(a) * 0.36, cy + Math.sin(a) * 0.36)); p.lineTo(...P(Math.cos(a) * 0.62, cy + Math.sin(a) * 0.62)); } parts++; }
    if (R() < 0.3) { line(0, -0.25, 0.42, -0.25); parts++; }
    if (R() < 0.26) { p.moveTo(...P(0, -0.8)); p.quadraticCurveTo(0.7 * s, 0, 0, 0.8 * s); p.quadraticCurveTo(-0.7 * s, 0, 0, -0.8 * s); parts++; }
    if (R() < 0.24) { poly([[0, -0.72], [0.62, 0.55], [-0.62, 0.55]], true, false); parts++; }
    if (R() < 0.22) { p.moveTo(...P(0.6, 0.15)); p.arc(0, 0.15 * s, 0.6 * s, 0, Math.PI); parts++; }
    if (R() < 0.26) { circ(0, -0.85, 0.06); circ(0.32, -0.75, 0.05); circ(-0.32, -0.75, 0.05); parts++; }
    if (parts < 2) { circ(0, 0, 0.5); line(0, -0.8, 0, 0.8, false); }
  }
  return p;
}

function makeAtlas(paths: Path2D[], ink: string, glow: string) {
  const c = document.createElement('canvas');
  c.width = CELL * ACOLS; c.height = CELL * Math.ceil(NG / ACOLS);
  const g = c.getContext('2d')!;
  g.lineCap = 'round'; g.lineJoin = 'round';
  paths.forEach((p, i) => {
    g.setTransform(1, 0, 0, 1, (i % ACOLS) * CELL + CELL / 2, Math.floor(i / ACOLS) * CELL + CELL / 2);
    // soft projector bloom in three passes (no shadowBlur: much cheaper to build)
    g.strokeStyle = glow;
    g.globalAlpha = 0.14; g.lineWidth = CELL * 0.2; g.stroke(p);
    g.globalAlpha = 0.32; g.lineWidth = CELL * 0.11; g.stroke(p);
    g.globalAlpha = 1; g.strokeStyle = ink; g.lineWidth = CELL * 0.05; g.stroke(p);
  });
  return c;
}

/** A column of dense "icon image" tiles (the side panels of the wall). */
function makePanel(seed: number, w: number, tallPx: number, pal: string[]) {
  const R = rng(seed);
  const ncol = Math.max(1, Math.round(w / 64));
  const tile = Math.max(18, Math.floor(w / ncol));
  const rows = Math.max(6, Math.ceil(tallPx / tile) + 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, tile * ncol); c.height = tile * rows;
  const g = c.getContext('2d')!;
  for (let k = 0; k < rows * ncol; k++) {
    const y0 = Math.floor(k / ncol) * tile, x0 = (k % ncol) * tile;
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(10,6,24,0.92)';
    g.fillRect(x0 + 1, y0 + 1, tile - 2, tile - 2);
    const m = 3 + Math.floor(R() * 5);
    const cs = (tile - 4) / m;
    const style = R();
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const sym = j < m / 2 ? j : m - 1 - j;
      const RR = rng(seed * 31 + k * 977 + i * 17 + sym);
      if (RR() < 0.35) continue;
      g.fillStyle = pal[Math.floor(RR() * pal.length)];
      g.globalAlpha = 0.45 + RR() * 0.55;
      const x = x0 + 2 + j * cs, y = y0 + 2 + i * cs;
      if (style < 0.4) g.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      else if (style < 0.75) { g.beginPath(); g.arc(x + cs / 2, y + cs / 2, cs * 0.4, 0, Math.PI * 2); g.fill(); }
      else { g.fillRect(x + cs * 0.3, y, cs * 0.4, cs); g.fillRect(x, y + cs * 0.3, cs, cs * 0.4); }
    }
  }
  return c;
}

function dotSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return c;
}

/* ---------------- the sound: four layer voices into one mix, each with its own analyser ---------------- */

class Engine {
  ac: AudioContext;
  master: GainNode;
  mix: GainNode;
  mixAn: AnalyserNode;
  layers: { gain: GainNode; an: AnalyserNode; buf: Float32Array<ArrayBuffer> }[] = [];
  wbuf: Float32Array<ArrayBuffer>;
  srcs: AudioScheduledSourceNode[] = [];
  droneO: OscillatorNode[] = []; droneG: GainNode[] = []; droneF: BiquadFilterNode; droneAmp: GainNode; droneLvl: GainNode;
  trem: GainNode; tremO: OscillatorNode; lfo: OscillatorNode;
  padO: OscillatorNode[] = []; padSwell: GainNode;
  noiseBP: BiquadFilterNode;
  voices = 0;
  cutoff = 600;
  private offT = 0;
  constructor(w: World) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ac = (this.ac = new AC());
    const now = ac.currentTime;
    this.master = ac.createGain(); this.master.gain.value = 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ac.destination);
    // generated reverb (exponentially decaying stereo noise)
    const len = Math.floor(ac.sampleRate * 2.6);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    const k = Math.pow(0.0005, 1 / len);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let e = 1; for (let i = 0; i < len; i++) { d[i] = (Math.random() * 2 - 1) * e; e *= k; } }
    const rev = ac.createConvolver(); rev.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = 0.42;
    this.mix = ac.createGain();
    this.mix.connect(this.master); this.mix.connect(rev); rev.connect(wet); wet.connect(this.master);
    this.mixAn = ac.createAnalyser(); this.mixAn.fftSize = 512; this.mixAn.smoothingTimeConstant = 0;
    this.mix.connect(this.mixAn);
    this.wbuf = new Float32Array(this.mixAn.fftSize);
    for (let i = 0; i < 4; i++) {
      const gain = ac.createGain();
      const an = ac.createAnalyser(); an.fftSize = 256;
      gain.connect(an); an.connect(this.mix);
      this.layers.push({ gain, an, buf: new Float32Array(an.fftSize) });
    }
    // 0 · drone: four saws through a breathing low-pass, a tremolo for the machine world
    this.droneF = ac.createBiquadFilter(); this.droneF.type = 'lowpass'; this.droneF.Q.value = 5;
    this.droneAmp = ac.createGain();
    this.droneLvl = ac.createGain(); this.droneLvl.gain.value = 0.055;
    this.droneF.connect(this.droneAmp); this.droneAmp.connect(this.droneLvl); this.droneLvl.connect(this.layers[0].gain);
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.detune.value = [-7, 6, 3, -4][i];
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.droneF); o.start(now);
      this.droneO.push(o); this.droneG.push(g); this.srcs.push(o);
    }
    this.lfo = ac.createOscillator();
    const lg = ac.createGain(); lg.gain.value = 240;
    this.lfo.connect(lg); lg.connect(this.droneF.frequency); this.lfo.start(now); this.srcs.push(this.lfo);
    this.tremO = ac.createOscillator(); this.trem = ac.createGain(); this.trem.gain.value = 0;
    this.tremO.connect(this.trem); this.trem.connect(this.droneAmp.gain); this.tremO.start(now); this.srcs.push(this.tremO);
    // 2 · pads: five voices that glide from chord to chord
    const padF = ac.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1500;
    this.padSwell = ac.createGain(); this.padSwell.gain.value = 0.5;
    const padLvl = ac.createGain(); padLvl.gain.value = 0.022;
    padF.connect(this.padSwell); this.padSwell.connect(padLvl); padLvl.connect(this.layers[2].gain);
    for (let i = 0; i < 10; i++) {
      const o = ac.createOscillator(); o.type = i < 5 ? 'triangle' : 'sine'; o.detune.value = i < 5 ? -6 : 7;
      const pn = ac.createStereoPanner(); pn.pan.value = ((i % 5) / 4) * 1.2 - 0.6;
      o.connect(pn); pn.connect(padF); o.start(now);
      this.padO.push(o); this.srcs.push(o);
    }
    // 3 · shimmer bed: looping noise through a high band-pass (plus pings, below)
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ac.createBufferSource(); ns.buffer = nb; ns.loop = true;
    this.noiseBP = ac.createBiquadFilter(); this.noiseBP.type = 'bandpass'; this.noiseBP.Q.value = 0.8;
    const ng = ac.createGain(); ng.gain.value = 0.014;
    ns.connect(this.noiseBP); this.noiseBP.connect(ng); ng.connect(this.layers[3].gain); ns.start(now); this.srcs.push(ns);
    this.world(w, 0, 0.01);
  }
  get running() { return this.ac.state === 'running'; }
  set on(v: boolean) {
    const t = this.ac.currentTime;
    clearTimeout(this.offT);
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(v ? 0.8 : 0, t, 0.12);
    if (v) { if (this.ac.state === 'suspended') void this.ac.resume(); }
    else this.offT = window.setTimeout(() => { if (this.ac.state === 'running') void this.ac.suspend(); }, 500);
  }
  layer(i: number, on: boolean) { this.layers[i].gain.gain.setTargetAtTime(on ? 1 : 0, this.ac.currentTime, 0.1); }
  world(w: World, chord: number, glide = 0.7) {
    const t = this.ac.currentTime;
    const f0 = mtof(w.root - 12);
    w.drone.forEach((r, i) => {
      if (r) this.droneO[i].frequency.setTargetAtTime(f0 * r, t, glide);
      this.droneG[i].gain.setTargetAtTime(r ? 1 / (1 + i * 0.5) : 0, t, glide);
    });
    this.cutoff = w.cutoff;
    this.droneF.frequency.setTargetAtTime(w.cutoff, t, glide);
    this.lfo.frequency.setTargetAtTime(w.lfo, t, 0.3);
    this.tremO.frequency.setTargetAtTime(w.tempo / 2, t, 0.3);
    this.trem.gain.setTargetAtTime(w.trem * 0.5, t, glide);
    this.droneAmp.gain.setTargetAtTime(1 - w.trem * 0.5, t, glide);
    this.noiseBP.frequency.setTargetAtTime(w.style === 2 ? 7600 : w.style === 1 ? 4200 : 6200, t, glide);
    this.chord(w, chord, glide);
  }
  chord(w: World, idx: number, glide = 0.35) {
    const t = this.ac.currentTime;
    const ch = w.chords[idx % w.chords.length];
    for (let i = 0; i < 10; i++) this.padO[i].frequency.setTargetAtTime(mtof(w.root + 12 + ch[i % 5]), t, glide);
    this.padSwell.gain.cancelScheduledValues(t);
    this.padSwell.gain.setTargetAtTime(1, t, 0.35);
    this.padSwell.gain.setTargetAtTime(0.45, t + 1.4, 1.6);
  }
  pluck(w: World, midi: number, pan: number, vel: number, bright: number) {
    if (this.voices > 18 || this.ac.state !== 'running') return;
    const ac = this.ac, t = ac.currentTime + 0.004, P = w.pluck;
    const o = ac.createOscillator(), o2 = ac.createOscillator();
    o.type = P.type; o2.type = 'sine';
    o.frequency.value = mtof(midi); o2.frequency.value = mtof(midi) * P.partial;
    const g = ac.createGain(), g2 = ac.createGain(); g2.gain.value = 0.35;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = (700 + bright * 4200) * P.bright;
    const pn = ac.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1);
    const pk = (P.type === 'square' ? 0.045 : 0.095) * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0006, t + P.decay);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(pn); pn.connect(this.layers[1].gain);
    o.start(t); o2.start(t); o.stop(t + P.decay + 0.05); o2.stop(t + P.decay + 0.05);
    this.voices++;
    o.onended = () => { this.voices--; try { pn.disconnect(); } catch { /* gone */ } };
  }
  ping(midi: number, pan: number, vel: number) {
    if (this.voices > 22 || this.ac.state !== 'running') return;
    const ac = this.ac, t = ac.currentTime + 0.004;
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(midi) * 1.5;
    const g = ac.createGain();
    const pn = ac.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045 * vel, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 2.4);
    o.connect(g); o2.connect(g); g.connect(pn); pn.connect(this.layers[3].gain);
    o.start(t); o2.start(t); o.stop(t + 2.5); o2.stop(t + 2.5);
    this.voices++;
    o.onended = () => { this.voices--; try { pn.disconnect(); } catch { /* gone */ } };
  }
  swell() { const t = this.ac.currentTime; const g = this.droneLvl.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0.1, t, 0.05); g.setTargetAtTime(0.055, t + 0.25, 0.8); }
  pen(x: number, y: number) { const t = this.ac.currentTime; this.droneF.frequency.setTargetAtTime(this.cutoff * (0.45 + x * 2.6), t, 0.06); this.droneF.Q.setTargetAtTime(2 + (1 - y) * 11, t, 0.1); }
  penUp() { const t = this.ac.currentTime; this.droneF.frequency.setTargetAtTime(this.cutoff, t, 0.6); this.droneF.Q.setTargetAtTime(5, t, 0.6); }
  rms(i: number) { const L = this.layers[i]; L.an.getFloatTimeDomainData(L.buf); let s = 0; for (let k = 0; k < L.buf.length; k += 2) s += L.buf[k] * L.buf[k]; return Math.sqrt(s / (L.buf.length / 2)); }
  dispose() {
    clearTimeout(this.offT);
    for (const s of this.srcs) { try { s.stop(); } catch { /* already */ } }
    void this.ac.close().catch(() => { /* closed */ });
  }
}

/* ---------------- the wall ---------------- */

interface Cell { x: number; y: number; col: number; row: number; gl: number; wi: number; next: number; nextW: number; flip: number; flash: number; hot: number; user: UGlyph | null }
interface UGlyph { pts: number[]; fx: number; fy: number; motif: { step: number; d: number }[]; canvas: HTMLCanvasElement; trace: number; cell: Cell | null }
interface Arch { canvas: HTMLCanvasElement; nodes: number[]; edges: number[]; orbits: number[]; rose: number[] }

export function mount(ctx: IxCtx): Ix {
  const { stage, dock, signal, reduced } = ctx;
  const ixRoot = stage.parentElement;
  stage.classList.add('sh');
  const canvas = h('canvas', { class: 'sh-canvas', role: 'img', 'aria-label': 'A projected wall of generative glyphs, icon panels and architecture lines, driven by one score. Tap to send a wave of notes; draw a stroke to compose a glyph that joins the loop.' }) as HTMLCanvasElement;
  const cta = h('button', { class: 'sh-cta', 'aria-label': 'Tap to hear it: start the sound' },
    h('span', { class: 'sh-cta-i', html: ico.sound }), h('span', { class: 'sh-cta-t' }, h('b', {}, 'Tap to hear it'), h('small', {}, 'sound and picture are one score')));
  const hint = h('div', { class: 'sh-hint gone' }, 'Tap: a wave · Draw: compose a glyph');
  const card = h('div', { class: 'sh-card', role: 'status', 'aria-live': 'polite' });
  stage.append(canvas, card, hint, cta);

  // ---- dock: [sound] [worlds] / [layers]
  const shDock = h('div', { class: 'sh-dock' });
  const soundBtn = h('button', { class: 'ix-btn round sh-sound', 'aria-label': 'Turn sound on', 'aria-pressed': 'false', html: ico.mute });
  const worldSeg = h('div', { class: 'ix-seg sh-worlds', role: 'group', 'aria-label': 'Travel between worlds' });
  const worldBtns = WORLDS.map((w, i) => {
    const b = h('button', { 'aria-pressed': String(i === 0), title: w.name, 'aria-label': `Travel to ${w.name}` }, w.short);
    b.addEventListener('click', () => travel(i), { signal });
    worldSeg.append(b);
    return b;
  });
  const layerSeg = h('div', { class: 'sh-layers', role: 'group', 'aria-label': 'Layers: tap to mute, hold to solo' });
  const on = [true, true, true, true];
  const layerBtns = LAYERS.map((name, i) => {
    const b = h('button', { 'aria-pressed': 'true', title: `${name}: tap to mute or unmute, hold to solo`, 'aria-label': `${name} layer` }, h('i'), name);
    let holdT = 0, held = false;
    b.addEventListener('pointerdown', () => { held = false; clearTimeout(holdT); holdT = window.setTimeout(() => { held = true; solo(i); }, 480); }, { signal });
    const cancel = () => clearTimeout(holdT);
    b.addEventListener('pointerup', cancel, { signal });
    b.addEventListener('pointerleave', cancel, { signal });
    b.addEventListener('pointercancel', cancel, { signal });
    b.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    b.addEventListener('dblclick', () => solo(i), { signal });
    b.addEventListener('click', () => { if (held) { held = false; return; } setLayer(i, !on[i]); }, { signal });
    layerSeg.append(b);
    return b;
  });
  shDock.append(soundBtn, worldSeg, layerSeg);
  dock.append(shDock);

  // ---- state
  const seed = Math.floor(Math.random() * 1e9);
  const R = rng(seed ^ 0x9e3779b9);
  let cur = 0, prev = -1, wk = 1; // world crossfade 0..1
  const paths: (Path2D[] | null)[] = [null, null, null];
  const atlas: ([HTMLCanvasElement, HTMLCanvasElement] | null)[] = [null, null, null];
  const ensureAtlas = (i: number) => {
    if (atlas[i]) return atlas[i]!;
    const w = WORLDS[i];
    const PR = rng(seed + i * 7919);
    paths[i] = Array.from({ length: NG }, () => glyphPath(PR, CELL * 0.34, w.style));
    atlas[i] = [makeAtlas(paths[i]!, w.ink, w.glow), makeAtlas(paths[i]!, '#ffffff', w.accent)];
    return atlas[i]!;
  };
  ensureAtlas(0);
  const warm: number[] = [];
  warm.push(window.setTimeout(() => ensureAtlas(1), 700), window.setTimeout(() => ensureAtlas(2), 1300));
  const sprite = dotSprite();

  let engine: Engine | null = null;
  let sound = false, userMuted = false;
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(() => { timers.delete(id); if (!signal.aborted) fn(); }, ms); timers.add(id); };

  // ---- layout (from the stage's own size and whatever overlays it: the title block, the expand button, our dock)
  const g = canvas.getContext('2d')!;
  let W = 0, H = 0, D = 1;
  let x0 = 0, y0 = 0, ww = 0, wh = 0, side = 0, gap = 0, cs = 50, cols = 0, rows = 0, gx0 = 0, gy0 = 0, waveY = 0, waveH = 0;
  let cells: Cell[] = [];
  const panels: ([HTMLCanvasElement, HTMLCanvasElement] | null)[] = [null, null, null];
  const archs: (Arch | null)[] = [null, null, null];
  const bgs: (CanvasGradient | null)[] = [null, null, null];
  const users: UGlyph[] = [];
  let particles: Float32Array = new Float32Array(0);
  const visible = (el: Element | null | undefined) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };

  const layout = () => {
    const f = fit(canvas, ctx.coarse ? 2 : 1.5);
    W = f.w; H = f.h; D = f.d;
    if (W < 2 || H < 2) return;
    const sr = stage.getBoundingClientRect();
    let top = 10, bot = 10;
    const ti = visible(ixRoot?.querySelector('.ix-head .ix-titles'));
    if (ti && ti.bottom > sr.top) top = Math.max(top, ti.bottom - sr.top + 10);
    const ex = visible(ixRoot?.querySelector('.ix-expand'));
    if (ex && ex.bottom > sr.top) top = Math.max(top, ex.bottom - sr.top + 8);
    const dr = visible(shDock);
    if (dr && dr.top < sr.bottom) bot = Math.max(bot, sr.bottom - dr.top + 10);
    if (H - top - bot < 150) top = Math.max(6, H - bot - 150);
    const mx = clamp(W * 0.03, 8, 44);
    x0 = mx; ww = W - mx * 2; y0 = top; wh = Math.max(80, H - top - bot);
    side = Math.round(clamp(ww * 0.13, 30, 190));
    gap = Math.round(clamp(ww * 0.015, 6, 18));
    waveH = Math.round(clamp(wh * 0.08, 14, 34));
    const gw = ww - side * 2 - gap * 2, gh = wh - waveH;
    cs = clamp(Math.sqrt((gw * gh) / 44), 26, 104);
    cols = Math.max(3, Math.floor(gw / cs)); rows = Math.max(3, Math.floor(gh / cs));
    cs = Math.min(gw / cols, gh / rows, 110);
    gx0 = x0 + side + gap + (gw - cols * cs) / 2 + cs / 2;
    gy0 = y0 + (gh - rows * cs) / 2 + cs / 2;
    waveY = gy0 + rows * cs - cs / 2 + waveH / 2;
    cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: gx0 + c * cs, y: gy0 + r * cs, col: c, row: r, gl: Math.floor(R() * NG), wi: cur, next: -1, nextW: cur, flip: 0, flash: 0, hot: 0, user: null });
    for (const u of users) seat(u);
    panels.fill(null); archs.fill(null); bgs.fill(null);
    const n = Math.round(clamp((ww * wh) / 7000, 24, 110) * (reduced ? 0.6 : 1));
    particles = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) { particles[i * 5] = x0 + R() * ww; particles[i * 5 + 1] = y0 + R() * wh; particles[i * 5 + 2] = 6 + R() * 18; particles[i * 5 + 3] = 1.5 + R() * 3.5; particles[i * 5 + 4] = R() * 6.28; }
    // place the overlays on the wall
    const cx = x0 + ww / 2, cy = y0 + wh / 2;
    stage.style.setProperty('--sh-cx', `${cx}px`);
    stage.style.setProperty('--sh-cy', `${cy}px`);
    stage.style.setProperty('--sh-fs', `${clamp(ww / 16, 18, 40)}px`);
  };
  const ensurePanels = (i: number) => {
    if (!panels[i]) panels[i] = [makePanel(seed + 11 + i * 3, side, wh, WORLDS[i].panel), makePanel(seed + 12 + i * 3, side, wh, WORLDS[i].panel)];
    return panels[i]!;
  };
  const ensureBg = (i: number) => {
    if (!bgs[i]) {
      const w = WORLDS[i];
      const gr = g.createRadialGradient(x0 + ww / 2, y0 + wh * 0.45, 10, x0 + ww / 2, y0 + wh * 0.45, Math.max(W, H) * 0.78);
      gr.addColorStop(0, w.bg[0]); gr.addColorStop(0.55, w.bg[1]); gr.addColorStop(1, w.bg[2]);
      bgs[i] = gr;
    }
    return bgs[i]!;
  };

  /** Each world's structures, drawn once per size into a cache; the frame loop only animates on top. */
  const ensureArch = (i: number): Arch => {
    if (archs[i]) return archs[i]!;
    const w = WORLDS[i];
    const d = Math.min(D, 1.25);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * d)); c.height = Math.max(1, Math.round(H * d));
    const a = c.getContext('2d')!;
    a.setTransform(d, 0, 0, d, 0, 0);
    a.lineCap = 'round'; a.lineJoin = 'round';
    const AR = rng(seed + 101 * (i + 1));
    const cx = x0 + ww / 2, base = y0 + wh, top = y0;
    const out: Arch = { canvas: c, nodes: [], edges: [], orbits: [], rose: [] };
    const pth = new Path2D();
    if (w.style === 2) {
      // a nave of nested ogive arches rising to a rose window, floor lines converging on the altar of light
      const ogive = (l: number, r: number, spring: number, rise: number) => {
        const sp = r - l, mid = (l + r) / 2;
        const rr = (rise * rise + (sp * sp) / 4) / sp, beta = Math.atan2(rise, rr - sp / 2);
        pth.moveTo(l, base); pth.lineTo(l, spring); pth.arc(l + rr, spring, rr, Math.PI, Math.PI + beta, false);
        pth.moveTo(r, base); pth.lineTo(r, spring); pth.arc(r - rr, spring, rr, 0, -beta, true);
        return mid;
      };
      // nested lancets (always pointed: the rise is kept above half the span)
      const ahMax = wh * 0.95, sMax = Math.min(ww * 0.9, ahMax * 0.78);
      for (let k = 0; k < 5; k++) {
        const sp = sMax * (1 - k * 0.17), ah = ahMax * (1 - k * 0.13);
        const rise = Math.min(ah * 0.85, Math.max(ah * 0.5, sp * 0.64));
        ogive(cx - sp / 2, cx + sp / 2, base - (ah - rise), rise);
      }
      // a side arcade where the wall is wider than the nave
      const sa = clamp(wh * 0.3, 34, 120);
      for (const dir of [-1, 1]) {
        let e = cx + dir * sMax / 2;
        while (dir < 0 ? e - sa > x0 - 1 : e + sa < x0 + ww + 1) {
          const l = dir < 0 ? e - sa : e, r = dir < 0 ? e : e + sa;
          ogive(l, r, base - wh * 0.32, sa * 0.78);
          e += dir * sa;
        }
      }
      const rx = cx, ry = top + wh * 0.3, rr = Math.min(ww, wh) * 0.13;
      out.rose = [rx, ry, rr];
      pth.moveTo(rx + rr, ry); pth.arc(rx, ry, rr, 0, Math.PI * 2);
      pth.moveTo(rx + rr * 0.45, ry); pth.arc(rx, ry, rr * 0.45, 0, Math.PI * 2);
      for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; const px = rx + Math.cos(t) * rr * 0.72, py = ry + Math.sin(t) * rr * 0.72; pth.moveTo(px + rr * 0.27, py); pth.arc(px, py, rr * 0.27, 0, Math.PI * 2); }
      for (let k = -6; k <= 6; k++) { pth.moveTo(cx + k * ww * 0.09, base); pth.lineTo(cx + k * ww * 0.012, base - wh * 0.16); }
      for (let k = 0; k < 4; k++) { const y = base - wh * 0.16 * (1 - Math.pow(0.55, k + 1)); const hw = ww * 0.5 * (1 - (k + 1) * 0.16); pth.moveTo(cx - hw, y); pth.lineTo(cx + hw, y); }
    } else if (w.style === 1) {
      // a neural lattice around a core, with orthogonal circuit traces
      const n = Math.round(clamp((ww * wh) / 9000, 16, 34));
      for (let k = 0; k < n; k++) { const r = Math.sqrt(AR()) * 0.5, t = AR() * Math.PI * 2; out.nodes.push(cx + Math.cos(t) * r * ww * 0.95, top + wh * 0.48 + Math.sin(t) * r * wh * 0.9); }
      for (let k = 0; k < n; k++) {
        const ds: [number, number][] = [];
        for (let j = 0; j < n; j++) if (j !== k) ds.push([Math.hypot(out.nodes[j * 2] - out.nodes[k * 2], out.nodes[j * 2 + 1] - out.nodes[k * 2 + 1]), j]);
        ds.sort((p, q) => p[0] - q[0]);
        for (let m = 0; m < 3; m++) { const j = ds[m][1]; if (j > k || m === 0) out.edges.push(k, j); }
      }
      for (let e = 0; e < out.edges.length; e += 2) { const a1 = out.edges[e] * 2, b1 = out.edges[e + 1] * 2; pth.moveTo(out.nodes[a1], out.nodes[a1 + 1]); pth.lineTo(out.nodes[b1], out.nodes[b1 + 1]); }
      for (let k = 0; k < n; k++) { const px = out.nodes[k * 2], py = out.nodes[k * 2 + 1]; pth.moveTo(px + 3, py); pth.arc(px, py, 3, 0, Math.PI * 2); }
      const cy = top + wh * 0.48, cr = Math.min(ww, wh) * 0.12;
      for (let k = 1; k <= 3; k++) { const s = cr * k * 0.55; pth.moveTo(cx, cy - s); pth.lineTo(cx + s, cy); pth.lineTo(cx, cy + s); pth.lineTo(cx - s, cy); pth.closePath(); }
      for (let k = 0; k < 10; k++) {
        const sx = AR() < 0.5 ? x0 : x0 + ww, sy = top + AR() * wh, mx = sx + (cx - sx) * (0.3 + AR() * 0.4);
        pth.moveTo(sx, sy); pth.lineTo(mx, sy); pth.lineTo(mx, cy + (sy - cy) * 0.3); pth.lineTo(cx + (mx - cx) * 0.4, cy + (sy - cy) * 0.3);
      }
    } else {
      // orbits around a sphere, and a skyline of lattice spires
      const oy = top + wh * 0.44;
      const R0 = Math.min(ww, wh) * 0.1;
      pth.moveTo(cx + R0, oy); pth.arc(cx, oy, R0, 0, Math.PI * 2);
      for (let k = 0; k < 5; k++) {
        const rx = ww * (0.18 + k * 0.085), ry = wh * (0.06 + k * 0.035), rot = (AR() - 0.5) * 0.7;
        out.orbits.push(cx, oy, rx, ry, rot, 0.2 + AR() * 0.5);
        pth.moveTo(cx + Math.cos(rot) * rx, oy + Math.sin(rot) * rx); pth.ellipse(cx, oy, rx, ry, rot, 0, Math.PI * 2);
      }
      const nsp = Math.round(clamp(ww / 40, 8, 22));
      for (let k = 0; k < nsp; k++) {
        const fx = (k + 0.5) / nsp, x = x0 + fx * ww, center = 1 - Math.abs(fx - 0.5) * 1.6;
        const hh = wh * (0.12 + 0.3 * center * (0.6 + AR() * 0.4)), bw = 3 + AR() * 6;
        pth.moveTo(x - bw, base); pth.lineTo(x - 1, base - hh); pth.lineTo(x + 1, base - hh); pth.lineTo(x + bw, base);
        for (let y = base - 12; y > base - hh + 10; y -= 14) { const t1 = (base - y) / hh; const hw1 = bw * (1 - t1) + 1; pth.moveTo(x - hw1, y); pth.lineTo(x + hw1, y - 12); }
        pth.moveTo(x, base - hh); pth.lineTo(x, base - hh - 10 - AR() * 16);
      }
      pth.moveTo(x0, base - 1); pth.lineTo(x0 + ww, base - 1);
    }
    a.beginPath(); a.rect(x0 - 2, y0 - 2, ww + 4, wh + 4); a.clip();
    a.strokeStyle = w.archGlow; a.globalAlpha = 0.16; a.lineWidth = 5; a.stroke(pth);
    a.strokeStyle = w.arch; a.globalAlpha = 0.75; a.lineWidth = 1.1; a.stroke(pth);
    archs[i] = out;
    return out;
  };

  const seat = (u: UGlyph) => {
    if (u.cell) u.cell.user = null;
    if (!cells.length) return;
    const col = Math.round(u.fx * (cols - 1)), row = Math.round(u.fy * (rows - 1));
    let best: Cell | null = null, bd = 1e9;
    for (const c of cells) { if (c.user) continue; const dd = Math.abs(c.col - col) + Math.abs(c.row - row); if (dd < bd) { bd = dd; best = c; } }
    u.cell = best;
    if (best) best.user = u;
  };

  const unobs = onResize(stage, layout);
  const unobs2 = onResize(shDock, layout);
  layout();

  // ---- levels: from the real audio when it is running, otherwise from the same score's events
  const env = [0.5, 0, 0, 0];
  const lv = [0, 0, 0, 0];
  const peak = [0.02, 0.02, 0.01, 0.005];
  const vis = [1, 1, 1, 1];
  let mixPeak = 0.05;

  // ---- sound on/off
  const setSoundUI = () => {
    soundBtn.innerHTML = sound ? ico.sound : ico.mute;
    soundBtn.setAttribute('aria-pressed', String(sound));
    soundBtn.setAttribute('aria-label', sound ? 'Turn sound off' : 'Turn sound on');
    soundBtn.classList.toggle('pulse', !sound && !engine);
  };
  const startSound = () => {
    try { engine ??= new Engine(WORLDS[cur]); } catch { cta.querySelector('b')!.textContent = 'No audio on this device'; return false; }
    for (let i = 0; i < 4; i++) engine.layer(i, on[i]);
    engine.chord(WORLDS[cur], chordIdx, 0.01);
    sound = true; engine.on = true;
    cta.classList.add('gone');
    later(() => cta.remove(), 600);
    setSoundUI();
    if (!hintShown) { hintShown = true; hint.classList.remove('gone'); later(() => hint.classList.add('gone'), 6500); }
    return true;
  };
  let hintShown = false;
  soundBtn.classList.add('pulse');
  soundBtn.addEventListener('click', () => {
    if (!sound) { userMuted = false; startSound(); }
    else { sound = false; userMuted = true; if (engine) engine.on = false; setSoundUI(); }
  }, { signal });
  cta.addEventListener('click', () => { userMuted = false; if (startSound()) burst(x0 + ww / 2, y0 + wh / 2, 1); }, { signal });

  // ---- layers
  const setLayer = (i: number, v: boolean) => {
    on[i] = v;
    layerBtns[i].setAttribute('aria-pressed', String(v));
    engine?.layer(i, v);
    layerBtns.forEach((b) => b.classList.remove('solo'));
  };
  const solo = (i: number) => {
    const isSolo = on.every((v, k) => v === (k === i));
    for (let k = 0; k < 4; k++) setLayer(k, isSolo ? true : k === i);
    if (!isSolo) layerBtns[i].classList.add('solo');
    if (!sound && !userMuted) startSound();
  };

  // ---- the score
  let step = 0, stepT = 0, tempo = WORLDS[0].tempo, chordIdx = 0;
  let panelSweep = 1, archPulse = 0;
  const pulses: number[] = []; // machine: [edgeIndex, t]
  const sparks: number[] = []; // haze: [x, y, life]
  const pointer = { x: -1, y: -1, down: false, mouse: false };

  const noteFor = (c: Cell) => {
    const w = WORLDS[cur];
    const n = w.scale.length;
    const hgt = (rows - 1 - c.row) / Math.max(1, rows - 1);
    return w.root + 24 + deg(w, ((c.col + c.gl) % n) + n * Math.floor(hgt * 2.4));
  };
  const playCell = (c: Cell, vel: number) => {
    env[1] = Math.min(1.4, env[1] + 0.35 * vel);
    if (sound && engine) engine.pluck(WORLDS[cur], noteFor(c), ((c.x - x0) / ww) * 1.8 - 0.9, vel, 1 - c.row / rows);
    if (WORLDS[cur].style === 1 && archs[cur]) spawnPulse(c.x, c.y);
  };
  const turn = (c: Cell, delay: number, vel: number, toW = cur, silent = false) => {
    if (c.user) return;
    later(() => {
      if (c.flip > 0 && toW === c.wi) return;
      c.next = Math.floor(R() * NG); c.nextW = toW;
      c.flip = 0.0001; c.flash = 1;
      if (!silent) playCell(c, vel);
    }, delay);
  };
  const burst = (x: number, y: number, vel = 0.9) => {
    if (on[1]) for (const c of cells) {
      const d = Math.hypot(c.x - x, c.y - y) / cs;
      if (d < 3.6) { if (c.user) { later(() => playUser(c.user!, 0.8), d * 70); continue; } turn(c, d * 70, Math.max(0.2, 1 - d / 4) * vel, cur, d > 2.6 && (c.col + c.row) % 2 === 1); }
    }
    if (on[0]) { engine?.swell(); env[0] += 0.5; archPulse = 1; }
    if (on[3]) shimmer(x, y, 0.9);
    if (on[2] && R() < 0.35) advanceChord();
  };
  const shimmer = (x: number, y: number, vel: number) => {
    const w = WORLDS[cur];
    env[3] = Math.min(1.4, env[3] + 0.5 * vel);
    for (let k = 0; k < 3; k++) sparks.push(x + (R() - 0.5) * cs, y + (R() - 0.5) * cs, 1);
    if (sparks.length > 120) sparks.splice(0, sparks.length - 120);
    if (sound && engine) engine.ping(w.root + 36 + deg(w, Math.floor(R() * w.scale.length * 1.5)), ((x - x0) / ww) * 2 - 1, vel);
  };
  const advanceChord = () => {
    chordIdx++;
    env[2] = Math.min(1.4, env[2] + 0.8);
    panelSweep = 0;
    if (sound && engine) engine.chord(WORLDS[cur], chordIdx);
  };
  const spawnPulse = (x: number, y: number) => {
    const A = archs[cur]; if (!A || !A.edges.length) return;
    let best = 0, bd = 1e12;
    for (let e = 0; e < A.edges.length; e += 2) { const k = A.edges[e] * 2; const dd = (A.nodes[k] - x) ** 2 + (A.nodes[k + 1] - y) ** 2 + R() * cs * cs * 4; if (dd < bd) { bd = dd; best = e; } }
    pulses.push(best, 0);
    if (pulses.length > 80) pulses.splice(0, pulses.length - 80);
  };
  const playUser = (u: UGlyph, vel: number) => {
    const w = WORLDS[cur];
    u.trace = 0.0001;
    if (u.cell) u.cell.flash = 1;
    u.motif.forEach((m, i) => later(() => {
      env[1] = Math.min(1.4, env[1] + 0.3);
      if (sound && engine && on[1]) engine.pluck(w, w.root + 24 + deg(w, m.d), u.cell ? ((u.cell.x - x0) / ww) * 1.8 - 0.9 : 0, vel, 0.8);
    }, i * 90));
  };

  const tick = () => {
    step++;
    const w = WORLDS[cur];
    if (on[1] && cells.length) {
      const pat = Math.floor(step / 16) % 4;
      let pick: Cell[];
      if (pat === 0) pick = cells.filter((c) => c.col === step % cols && R() < 0.6);
      else if (pat === 1) pick = cells.filter((c) => (c.col + c.row) % (cols + rows) === step % (cols + rows) && R() < 0.7);
      else if (pat === 2) pick = [cells[Math.floor(R() * cells.length)], cells[Math.floor(R() * cells.length)]];
      else pick = cells.filter((c) => c.row === step % rows && R() < 0.5);
      pick.slice(0, 3).forEach((c, i) => turn(c, i * 40, 0.55 - i * 0.1));
      // visitor glyphs loop with the bar
      for (const u of users) for (const m of u.motif) if (m.step === step % 16) {
        env[1] = Math.min(1.4, env[1] + 0.4);
        if (u.cell) u.cell.flash = 1;
        if (m === u.motif[0]) u.trace = 0.0001;
        if (sound && engine) engine.pluck(w, w.root + 24 + deg(w, m.d), u.cell ? ((u.cell.x - x0) / ww) * 1.8 - 0.9 : 0, 0.7, 0.9);
      }
    }
    if (step % 16 === 0) { env[0] += 0.35; archPulse = Math.max(archPulse, 0.7); }
    if (on[2] && step % 32 === 0) advanceChord();
    if (on[3] && R() < w.shimmer * 0.3) shimmer(x0 + R() * ww, y0 + R() * wh * 0.8, 0.4 + R() * 0.4);
  };

  // ---- travel between worlds: the new vocabulary sweeps across the wall while the sound glides into the new key
  const card0 = (i: number) => {
    const w = WORLDS[i];
    card.innerHTML = '';
    card.append(h('b', {}, w.name), h('small', {}, `from the card: “${w.quote}” · interpreted`));
    card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
    later(() => card.classList.remove('on'), 2600);
  };
  const travel = (i: number) => {
    if (i === cur) return;
    ensureAtlas(i); ensureArch(i);
    prev = cur; cur = i; wk = reduced ? 0.999 : 0;
    worldBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    const w = WORLDS[i];
    chordIdx = 0;
    if (engine) engine.world(w, 0);
    env[2] = 1; panelSweep = 0; archPulse = 1;
    for (const c of cells) {
      const dly = reduced ? 0 : (c.col / Math.max(1, cols - 1)) * 900 + R() * 140;
      turn(c, dly, 0.45, i, (c.row + c.col) % 3 !== 0);
    }
    for (const u of users) renderUser(u);
    card0(i);
    hint.classList.add('gone');
  };

  // ---- drawing: a stroke becomes a mirrored glyph that joins the loop
  let stroke: number[] = [], drawing = false, pathLen = 0, penAcc = 0, fade = 0, fadeStroke: number[] = [];
  let lastTap = 0, lastTapCell: Cell | null = null;
  const cellAt = (x: number, y: number) => {
    const c = Math.round((x - gx0) / cs), r = Math.round((y - gy0) / cs);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return null;
    return cells[r * cols + c] ?? null;
  };
  const renderUser = (u: UGlyph) => {
    const w = WORLDS[cur];
    const c = u.canvas, a = c.getContext('2d')!;
    a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, CELL, CELL);
    a.setTransform(1, 0, 0, 1, CELL / 2, CELL / 2);
    const s = CELL * 0.36;
    const p = new Path2D();
    for (const sgn of [1, -1]) for (let i = 0; i < u.pts.length; i += 2) (i ? p.lineTo(u.pts[i] * s * sgn, u.pts[i + 1] * s) : p.moveTo(u.pts[i] * s * sgn, u.pts[i + 1] * s));
    a.lineCap = 'round'; a.lineJoin = 'round';
    a.strokeStyle = w.accent; a.globalAlpha = 0.18; a.lineWidth = CELL * 0.2; a.stroke(p);
    a.globalAlpha = 0.4; a.lineWidth = CELL * 0.1; a.stroke(p);
    a.globalAlpha = 1; a.strokeStyle = '#ffffff'; a.lineWidth = CELL * 0.045; a.stroke(p);
  };
  const compose = () => {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (let i = 0; i < stroke.length; i += 2) { minx = Math.min(minx, stroke[i]); maxx = Math.max(maxx, stroke[i]); miny = Math.min(miny, stroke[i + 1]); maxy = Math.max(maxy, stroke[i + 1]); }
    const span = Math.max(maxx - minx, maxy - miny);
    if (span < 16) return;
    const scx = (minx + maxx) / 2, scy = (miny + maxy) / 2, sc = span / 2;
    // resample to 28 points along the path
    const N = 28, seg: number[] = [0];
    for (let i = 2; i < stroke.length; i += 2) seg.push(seg[seg.length - 1] + Math.hypot(stroke[i] - stroke[i - 2], stroke[i + 1] - stroke[i - 1]));
    const total = seg[seg.length - 1] || 1;
    const pts: number[] = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const d = (k / (N - 1)) * total;
      while (j < seg.length - 2 && seg[j + 1] < d) j++;
      const t = (d - seg[j]) / Math.max(1e-6, seg[j + 1] - seg[j]);
      const ax = stroke[j * 2], ay = stroke[j * 2 + 1], bx = stroke[j * 2 + 2] ?? ax, by = stroke[j * 2 + 3] ?? ay;
      pts.push(((ax + (bx - ax) * t) - scx) / sc, ((ay + (by - ay) * t) - scy) / sc);
    }
    // the motif: points along the stroke become notes across the bar, higher on the wall = higher pitch
    const nn = clamp(Math.round(total / 70), 3, 8);
    const motif = Array.from({ length: nn }, (_, k) => {
      const p = Math.round((k / (nn - 1 || 1)) * (N - 1));
      const yy = pts[p * 2 + 1] * sc + scy;
      const hgt = 1 - clamp((yy - y0) / wh, 0, 1);
      return { step: Math.round((k * 16) / nn) % 16, d: Math.round(hgt * 9) };
    });
    const col = clamp((scx - gx0) / cs, 0, cols - 1), row = clamp((scy - gy0) / cs, 0, rows - 1);
    const cv = document.createElement('canvas'); cv.width = cv.height = CELL;
    const u: UGlyph = { pts, fx: cols > 1 ? col / (cols - 1) : 0, fy: rows > 1 ? row / (rows - 1) : 0, motif, canvas: cv, trace: 0, cell: null };
    renderUser(u);
    users.push(u);
    if (users.length > MAXU) { const old = users.shift()!; if (old.cell) old.cell.user = null; }
    seat(u);
    if (!on[1]) setLayer(1, true);
    playUser(u, 0.9);
    card.innerHTML = '';
    card.append(h('b', {}, 'Your glyph joined the score'), h('small', {}, `it loops in every world · ${users.length} of ${MAXU} · double-tap it to remove`));
    card.classList.remove('on'); void card.offsetWidth; card.classList.add('on');
    later(() => card.classList.remove('on'), 2400);
    hint.classList.add('gone');
  };

  const pos = (e: PointerEvent) => { const rc = canvas.getBoundingClientRect(); return [e.clientX - rc.left, e.clientY - rc.top] as const; };
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    pointer.x = x; pointer.y = y; pointer.down = true; pointer.mouse = e.pointerType === 'mouse';
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ }
    if (!sound && !userMuted) startSound();
    const c = cellAt(x, y), now = performance.now();
    if (c && c.user && lastTapCell === c && now - lastTap < 380) {
      const u = c.user; users.splice(users.indexOf(u), 1); c.user = null; c.flash = 1; lastTapCell = null;
      return;
    }
    lastTap = now; lastTapCell = c;
    burst(x, y);
    stroke = [x, y]; drawing = false; pathLen = 0; penAcc = 0;
  }, { signal });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    pointer.x = x; pointer.y = y; pointer.mouse = e.pointerType === 'mouse';
    if (!pointer.down || !stroke.length) return;
    const lx = stroke[stroke.length - 2], ly = stroke[stroke.length - 1];
    const d = Math.hypot(x - lx, y - ly);
    if (d < 3) return;
    stroke.push(x, y); pathLen += d; penAcc += d;
    if (stroke.length > 1200) stroke.splice(0, 2);
    if (pathLen > 26) drawing = true;
    if (drawing) {
      engine?.pen(clamp((x - x0) / ww, 0, 1), clamp((y - y0) / wh, 0, 1));
      if (penAcc > 48) {
        penAcc = 0;
        const w = WORLDS[cur];
        const hgt = 1 - clamp((y - y0) / wh, 0, 1);
        env[1] = Math.min(1.4, env[1] + 0.2);
        if (sound && engine && on[1]) engine.pluck(w, w.root + 24 + deg(w, Math.round(hgt * 9)), ((x - x0) / ww) * 1.8 - 0.9, 0.4, 0.6);
        const c = cellAt(x, y); if (c) c.flash = Math.max(c.flash, 0.6);
      }
    }
  }, { signal });
  const up = () => {
    if (!pointer.down) return;
    pointer.down = false;
    if (drawing) { engine?.penUp(); compose(); fadeStroke = stroke; fade = 1; }
    stroke = []; drawing = false;
    if (!pointer.mouse) { pointer.x = -1; pointer.y = -1; }
  };
  canvas.addEventListener('pointerup', up, { signal });
  canvas.addEventListener('pointercancel', up, { signal });
  canvas.addEventListener('pointerleave', () => { if (!pointer.down) { pointer.x = -1; pointer.y = -1; } }, { signal });
  ixRoot?.addEventListener('keydown', (e) => {
    if (e.target !== ixRoot) return;
    if (e.key >= '1' && e.key <= '3') travel(Number(e.key) - 1);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!sound && !userMuted) startSound(); burst(x0 + ww / 2, y0 + wh / 2); }
  }, { signal });

  // ---- frame
  let scroll = 0, meterF = 0;
  const lerpA = (k: number) => (prev >= 0 && wk < 1 ? k : 1);
  const stroke2 = (pts: number[], col: string, a: number) => {
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) (i ? g.lineTo(pts[i], pts[i + 1]) : g.moveTo(pts[i], pts[i + 1]));
    g.strokeStyle = col; g.globalAlpha = a * 0.25; g.lineWidth = 9; g.stroke();
    g.globalAlpha = a; g.lineWidth = 2.2; g.strokeStyle = '#ffffff'; g.stroke();
  };

  const stop = loop((dt, t) => {
    if (W < 2 || !cells.length) return;
    const w = WORLDS[cur];
    tempo += (w.tempo - tempo) * Math.min(1, dt * 1.5);
    stepT += dt * tempo;
    let guard = 0;
    while (stepT >= 1 && guard++ < 4) { stepT -= 1; tick(); }
    if (wk < 1) { wk = Math.min(1, wk + dt / 2.4); if (wk >= 1) prev = -1; }
    if (!reduced) scroll += dt * 12;
    panelSweep = Math.min(1, panelSweep + dt / 1.6);
    archPulse = Math.max(0, archPulse - dt * 1.4);
    fade = Math.max(0, fade - dt * 2);

    // levels
    const live = !!(engine && engine.running);
    for (let i = 0; i < 4; i++) {
      env[i] *= Math.exp(-dt * (i === 0 ? 1.2 : 3));
      let v: number;
      if (live) { const r = engine!.rms(i); peak[i] = Math.max(r, peak[i] * Math.exp(-dt * 0.25), [0.004, 0.004, 0.002, 0.001][i]); v = r / peak[i]; }
      else v = on[i] ? (i === 0 ? clamp(0.45 + 0.2 * Math.sin(t * 6.28 * w.lfo * 4) + env[0], 0, 1) : clamp(env[i], 0, 1)) : 0;
      lv[i] += (v - lv[i]) * Math.min(1, dt * 14);
      vis[i] += ((on[i] ? 1 : 0) - vis[i]) * Math.min(1, dt * 5);
    }
    if (++meterF % 3 === 0) layerBtns.forEach((b, i) => b.style.setProperty('--lv', lv[i].toFixed(2)));
    const A0 = 0.06; // a muted layer stays as a faint ghost on the wall
    const vD = A0 + (1 - A0) * vis[0], vG = A0 + (1 - A0) * vis[1], vI = A0 + (1 - A0) * vis[2], vH = vis[3];

    g.setTransform(D, 0, 0, D, 0, 0);
    g.globalCompositeOperation = 'source-over';
    // the wall in its world's light
    g.globalAlpha = 1;
    if (prev >= 0 && wk < 1) { g.fillStyle = ensureBg(prev); g.fillRect(0, 0, W, H); g.globalAlpha = wk; }
    g.fillStyle = ensureBg(cur); g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;

    // layer 0 · architecture (drone)
    g.globalCompositeOperation = 'lighter';
    const drawArch = (i: number, a: number) => {
      const A = ensureArch(i);
      const reveal = i === cur ? (reduced ? 1 : clamp(wk * 1.25, 0, 1)) : 1;
      g.save();
      if (reveal < 1) {
        g.beginPath();
        if (WORLDS[i].style === 1) g.arc(x0 + ww / 2, y0 + wh * 0.48, reveal * Math.hypot(ww, wh) * 0.55, 0, Math.PI * 2);
        else g.rect(0, y0 + wh * (1 - reveal) - 4, W, H);
        g.clip();
      }
      g.globalAlpha = a * vD * (0.3 + 0.6 * lv[0] + 0.3 * archPulse);
      g.drawImage(A.canvas, 0, 0, W, H);
      g.restore();
    };
    if (prev >= 0 && wk < 1) drawArch(prev, 1 - wk);
    drawArch(cur, lerpA(wk));
    // living parts of the architecture
    const Ac = ensureArch(cur);
    g.globalAlpha = vD * (0.5 + 0.5 * lv[0]);
    const dsz = clamp(cs * 0.22, 6, 14);
    if (w.style === 0) {
      for (let k = 0; k < Ac.orbits.length; k += 6) {
        const [ox, oy, rx, ry, rot, sp] = Ac.orbits.slice(k, k + 6);
        const an = (reduced ? k : t * sp * (tempo / 2.6)) + k;
        const ex = Math.cos(an) * rx, ey = Math.sin(an) * ry;
        const px = ox + ex * Math.cos(rot) - ey * Math.sin(rot), py = oy + ex * Math.sin(rot) + ey * Math.cos(rot);
        g.drawImage(sprite, px - dsz, py - dsz, dsz * 2, dsz * 2);
      }
    } else if (w.style === 1) {
      for (let k = 0; k < pulses.length; k += 2) {
        pulses[k + 1] += dt * 1.6;
        const e = pulses[k], p = pulses[k + 1];
        const a1 = Ac.edges[e] * 2, b1 = Ac.edges[e + 1] * 2;
        const px = Ac.nodes[a1] + (Ac.nodes[b1] - Ac.nodes[a1]) * p, py = Ac.nodes[a1 + 1] + (Ac.nodes[b1 + 1] - Ac.nodes[a1 + 1]) * p;
        g.drawImage(sprite, px - dsz, py - dsz, dsz * 2, dsz * 2);
      }
      for (let k = pulses.length - 2; k >= 0; k -= 2) if (pulses[k + 1] >= 1) pulses.splice(k, 2);
    } else if (Ac.rose.length) {
      const [rx, ry, rr] = Ac.rose;
      g.strokeStyle = w.arch; g.lineWidth = 1;
      g.globalAlpha = vD * (0.25 + 0.6 * lv[0] + 0.4 * archPulse);
      g.beginPath();
      const rot = reduced ? 0 : t * 0.08;
      for (let k = 0; k < 24; k++) { const an = rot + (k / 24) * Math.PI * 2; g.moveTo(rx + Math.cos(an) * rr * 1.1, ry + Math.sin(an) * rr * 1.1); g.lineTo(rx + Math.cos(an) * rr * (1.6 + 0.5 * lv[0]), ry + Math.sin(an) * rr * (1.6 + 0.5 * lv[0])); }
      g.stroke();
    }

    // layer 2 · icon panels (pads)
    g.globalCompositeOperation = 'source-over';
    const ptop = y0, pbot = y0 + wh - waveH;
    const drawPanels = (i: number, a: number) => {
      const [pl, pr] = ensurePanels(i);
      for (const [pn, x, dir] of [[pl, x0, 1], [pr, x0 + ww - side, -1]] as const) {
        g.save();
        g.beginPath(); g.rect(x, ptop, side, pbot - ptop); g.clip();
        const ph = pn.height, off = (((scroll * dir) % ph) + ph) % ph;
        g.globalAlpha = a * vI * (0.45 + 0.4 * lv[2]);
        g.drawImage(pn, x, ptop - off, side, ph * (side / pn.width));
        g.drawImage(pn, x, ptop - off + ph * (side / pn.width), side, ph * (side / pn.width));
        g.restore();
      }
    };
    if (prev >= 0 && wk < 1) drawPanels(prev, 1 - wk);
    drawPanels(cur, lerpA(wk));
    if (panelSweep < 1 && vis[2] > 0.1) {
      // the chord change runs down the icon panels
      g.globalCompositeOperation = 'lighter';
      const sy = ptop + (pbot - ptop) * panelSweep, band = Math.max(18, side * 0.6);
      g.globalAlpha = (1 - panelSweep) * 0.5 * vis[2];
      g.fillStyle = w.accent;
      g.fillRect(x0, sy - band / 2, side, band);
      g.fillRect(x0 + ww - side, ptop + (pbot - ptop) * (1 - panelSweep) - band / 2, side, band);
    }

    // layer 1 · glyph grid
    g.globalCompositeOperation = 'lighter';
    // icon tiles: each glyph sits in a faint frame (Icons layer)
    if (vis[2] > 0.02) {
      g.globalAlpha = vis[2] * (0.03 + 0.14 * lv[2] + 0.12 * (1 - panelSweep));
      g.strokeStyle = w.panel[1]; g.lineWidth = 1;
      g.beginPath();
      for (const c of cells) g.rect(c.x - cs * 0.44, c.y - cs * 0.44, cs * 0.88, cs * 0.88);
      g.stroke();
    }
    for (const c of cells) {
      if (c.flip > 0) {
        c.flip += dt / (reduced ? 0.5 : 0.38);
        if (c.flip >= 0.5 && c.next >= 0) { c.gl = c.next; c.wi = c.nextW; c.next = -1; }
        if (c.flip >= 1) c.flip = 0;
      }
      c.flash = Math.max(0, c.flash - dt * 1.6);
      const near = pointer.x >= 0 ? Math.max(0, 1 - Math.hypot(c.x - pointer.x, c.y - pointer.y) / (cs * 2.2)) : 0;
      c.hot += ((pointer.down ? near : near * 0.4) - c.hot) * Math.min(1, dt * 8);
      const flipA = c.flip > 0 ? Math.abs(Math.cos(Math.PI * c.flip)) : 1;
      const sy = reduced ? 1 : flipA;
      const sc = 0.9 * (1 + c.hot * 0.2 + c.flash * 0.08);
      const gw2 = cs * sc, gh2 = gw2 * sy;
      const tw = reduced ? 0 : 0.06 * Math.sin(t * 1.3 + c.col * 0.7 + c.row);
      let a = vG * Math.min(1, 0.42 + 0.3 * lv[1] + c.flash * 0.55 + c.hot * 0.4 + tw);
      if (reduced && c.flip > 0) a *= flipA;
      g.globalAlpha = a;
      if (c.user) {
        g.drawImage(c.user.canvas, c.x - gw2 / 2, c.y - gh2 / 2, gw2, gh2);
        g.strokeStyle = w.accent; g.globalAlpha = a * 0.7; g.lineWidth = 1.2;
        const q = cs * 0.44, k = cs * 0.12;
        g.beginPath();
        g.moveTo(c.x - q, c.y - q + k); g.lineTo(c.x - q, c.y - q); g.lineTo(c.x - q + k, c.y - q);
        g.moveTo(c.x + q - k, c.y + q); g.lineTo(c.x + q, c.y + q); g.lineTo(c.x + q, c.y + q - k);
        g.stroke();
        const u = c.user;
        if (u.trace > 0) {
          u.trace += dt / 1.1;
          if (u.trace >= 1) u.trace = 0;
          else {
            const n = u.pts.length / 2, fi = u.trace * (n - 1), i0 = Math.floor(fi), fr = fi - i0;
            const s = gw2 * 0.36, sv = gh2 * 0.36;
            const px = u.pts[i0 * 2] + ((u.pts[Math.min(n - 1, i0 + 1) * 2] ?? 0) - u.pts[i0 * 2]) * fr;
            const py = u.pts[i0 * 2 + 1] + ((u.pts[Math.min(n - 1, i0 + 1) * 2 + 1] ?? 0) - u.pts[i0 * 2 + 1]) * fr;
            g.globalAlpha = 1;
            const ds = cs * 0.18;
            g.drawImage(sprite, c.x + px * s - ds, c.y + py * sv - ds, ds * 2, ds * 2);
            g.drawImage(sprite, c.x - px * s - ds, c.y + py * sv - ds, ds * 2, ds * 2);
          }
        }
        continue;
      }
      const at = ensureAtlas(c.wi);
      const img = c.hot > 0.35 || (c.flash > 0.7 && (c.col * 3 + c.row) % 4 === 0) ? at[1] : at[0];
      g.drawImage(img, (c.gl % ACOLS) * CELL, Math.floor(c.gl / ACOLS) * CELL, CELL, CELL, c.x - gw2 / 2, c.y - gh2 / 2, gw2, gh2);
    }

    // layer 3 · light haze and particles (shimmer)
    if (vH > 0.01) {
      const hx = x0 + ww / 2, hy = y0 + wh * 0.35;
      g.globalAlpha = vH * (0.05 + 0.16 * lv[3]);
      g.drawImage(sprite, hx - ww * 0.6, hy - wh * 0.6, ww * 1.2, wh * 1.2);
      const n = particles.length / 5;
      const lift = 0.35 + lv[3] * 1.4;
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        if (!reduced) {
          particles[o + 1] -= particles[o + 2] * dt * lift;
          particles[o] += Math.sin(t * 0.4 + particles[o + 4]) * dt * 4;
          if (particles[o + 1] < y0) { particles[o + 1] = y0 + wh; particles[o] = x0 + R() * ww; }
        }
        const s = particles[o + 3] * (1 + lv[3] * 0.8);
        g.globalAlpha = vH * (0.12 + 0.6 * lv[3]) * (0.5 + 0.5 * Math.sin(t * 1.7 + particles[o + 4] * 3));
        g.drawImage(sprite, particles[o] - s, particles[o + 1] - s, s * 2, s * 2);
      }
      for (let k = 0; k < sparks.length; k += 3) {
        sparks[k + 2] -= dt * 1.3;
        const life = sparks[k + 2];
        if (life <= 0) continue;
        const s = cs * (0.15 + (1 - life) * 0.5);
        g.globalAlpha = vH * life;
        g.drawImage(sprite, sparks[k] - s, sparks[k + 1] - s, s * 2, s * 2);
        g.strokeStyle = w.haze; g.lineWidth = 1;
        g.beginPath(); g.moveTo(sparks[k] - s, sparks[k + 1]); g.lineTo(sparks[k] + s, sparks[k + 1]); g.moveTo(sparks[k], sparks[k + 1] - s); g.lineTo(sparks[k], sparks[k + 1] + s); g.stroke();
      }
      for (let k = sparks.length - 3; k >= 0; k -= 3) if (sparks[k + 2] <= 0) sparks.splice(k, 3);
    }

    // the waveform of the actual mix, drawn along the foot of the wall
    {
      const xa = gx0 - cs / 2, xb = gx0 + (cols - 0.5) * cs, n = 72;
      g.globalAlpha = 0.8;
      g.strokeStyle = w.accent; g.lineWidth = 1.4;
      g.beginPath();
      if (live) {
        const buf = engine!.wbuf;
        engine!.mixAn.getFloatTimeDomainData(buf);
        let m = 0; for (let i = 0; i < buf.length; i += 4) m = Math.max(m, Math.abs(buf[i]));
        mixPeak = Math.max(m, mixPeak * Math.exp(-dt * 0.5), 0.01);
        for (let i = 0; i < n; i++) { const v = buf[Math.floor((i / (n - 1)) * (buf.length - 1))] / mixPeak; const x = xa + ((xb - xa) * i) / (n - 1); i ? g.lineTo(x, waveY + v * waveH * 0.42) : g.moveTo(x, waveY + v * waveH * 0.42); }
      } else {
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1), x = xa + (xb - xa) * u;
          const v = (lv[0] * 0.35 * Math.sin(u * 9 + t * 3) + lv[1] * 0.4 * Math.sin(u * 47 + t * 11) + lv[2] * 0.3 * Math.sin(u * 23 - t * 5) + lv[3] * 0.25 * Math.sin(u * 97 + t * 17)) * Math.sin(u * Math.PI);
          i ? g.lineTo(x, waveY + v * waveH * 0.42) : g.moveTo(x, waveY + v * waveH * 0.42);
        }
      }
      g.stroke();
    }

    // the pen: the live stroke, then its afterglow
    if (drawing && stroke.length > 3) stroke2(stroke, w.accent, 0.9);
    else if (fade > 0 && fadeStroke.length > 3) stroke2(fadeStroke, w.accent, fade * 0.8);

    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  });

  return {
    dispose() {
      stop(); unobs(); unobs2();
      warm.forEach(clearTimeout);
      timers.forEach(clearTimeout); timers.clear();
      engine?.dispose(); engine = null;
      shDock.remove(); canvas.remove(); card.remove(); hint.remove(); cta.remove();
      stage.classList.remove('sh');
      atlas.fill(null); archs.fill(null); panels.fill(null);
    },
  };
}
