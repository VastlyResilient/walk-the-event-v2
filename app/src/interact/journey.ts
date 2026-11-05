import './journey.css';
import * as THREE from 'three';
import { h } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { btn, ico, loop, onResize, rng } from './common';

/*
 * "Hermes Journey" (Nous Research), interpreted. From the write-up and the photos of the touch display: "NOUS RESEARCH /
 * HERMES JOURNEY" top left; "Skills and memories appear in the order Hermes learned them, oldest at the center."; a
 * translucent central sphere with glowing, named rings around it on a dusty disc; tap one and it opens into its own
 * orbit (name, a count of skills, memories and days, and a timeline from June to October 2026).
 *
 * What comes from the photos: the 17 orbit names (14 fully legible, three partly hidden by their own glow and shown
 * with dots), their colours, roughly where each sits on the disc and roughly how big it looks, the title lockup, the
 * opened-orbit layout (centred mini system with tilted rings, name + counts line above, month timeline below) and the
 * "TOUCH DISPLAY" plaque. What is illustrative: the learning order is read as distance from the centre (the screen's
 * own rule), and every count, date and individual skill/memory is made up for the recreation and labelled as such.
 */

const T0 = Date.UTC(2026, 5, 1), T1 = Date.UTC(2026, 9, 31, 23, 59);
const DAY = 864e5;
const MONTHS = [5, 6, 7, 8, 9].map((m) => ({ t: Date.UTC(2026, m, 1), s: ['JUN', 'JUL', 'AUG', 'SEP', 'OCT'][m - 5] }));
const fmt = (ms: number, year = true) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: year ? 'numeric' : undefined, timeZone: 'UTC' });
const frac = (t: number) => (t - T0) / (T1 - T0);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Orbits as seen on the screen, ordered by distance from the centre (oldest first). x/z: position on the disc. */
interface Def { name: string; c: string; core?: string; x: number; z: number; size: number; dim?: boolean; partial?: boolean }
const DEFS: Def[] = [
  { name: 'REWBS', c: '#8e9bff', x: -2.02, z: -4.68, size: 0.6, dim: true },
  { name: 'PHRAGG', c: '#ff4fc3', x: -4.52, z: -2.42, size: 0.66 },
  { name: 'CTHULHU', c: '#d07cff', x: 4.31, z: -2.81, size: 0.64, dim: true },
  { name: 'HMB', c: '#4ea4ff', x: 5.11, z: 1.2, size: 0.66 },
  { name: 'KXEE', c: '#3ff2ff', x: 1.42, z: -5.11, size: 0.68 },
  { name: 'MACBETH', c: '#7b88ff', x: -5.13, z: 1.7, size: 0.64, dim: true },
  { name: 'THEO', c: '#b47dff', core: '#ffc04a', x: 3.29, z: 4.6, size: 0.64 },
  { name: 'JO···', c: '#ffffff', x: -2.96, z: 5.17, size: 0.8, partial: true },
  { name: 'SUBHO', c: '#3fc6ff', x: -5.02, z: -5.78, size: 0.64 },
  { name: 'NEURALINK', c: '#e4ecff', x: 7.8, z: -1.46, size: 0.72 },
  { name: 'TEKNIUM', c: '#ff8a2e', x: -7.92, z: -0.72, size: 0.72 },
  { name: 'TU MADRE', c: '#5dff86', x: 4.72, z: -6.46, size: 0.72 },
  { name: 'SHLOMS', c: '#ff6fd6', x: -0.94, z: -8.12, size: 0.72 },
  { name: 'CA·······', c: '#ff4630', x: 0.59, z: 8.24, size: 1.15, partial: true },
  { name: 'WITCHEER', c: '#ff6a3d', x: 6.93, z: 5.03, size: 0.74 },
  { name: 'MO·····', c: '#efff3a', x: -7.02, z: 5.72, size: 0.86, partial: true },
  { name: 'SIDBIN', c: '#7dff3a', x: -3.68, z: 10.37, size: 1.05 },
];
const SYS_R = 12;

interface Node { kind: 'skill' | 'memory'; n: number; of: number; t: number; ring: number; th0: number; alpha: number }
interface Orbit {
  i: number; d: Def; pos: THREE.Vector3; color: THREE.Color; t0: number; t1: number; days: number; skills: number; memories: number;
  nodes: Node[]; rings: number; Ro: number;
  g: THREE.Group; disc: THREE.Mesh; mat: THREE.ShaderMaterial; glow: THREE.Sprite;
  label: HTMLButtonElement; dot: HTMLElement; shown: number; flash: number;
  sx: number; sy: number; sr: number; vis: boolean; z: number;
}

function buildOrbits(): Omit<Orbit, 'g' | 'disc' | 'mat' | 'glow' | 'label' | 'dot'>[] {
  return DEFS.map((d, i) => {
    const R = rng(900 + i * 31);
    const start = T0 + (2 + i * 7.7 + R() * 2.5) * DAY;
    const span = Math.round(9 + R() * 26 + d.size * 8);
    const t1 = Math.min(T1 - DAY, start + span * DAY);
    const days = Math.max(1, Math.round((t1 - start) / DAY) + 1);
    const total = Math.round(16 + (d.size - 0.6) * 70 + R() * 12);
    const skills = Math.max(4, Math.round(total * (0.32 + R() * 0.3)));
    const memories = total - skills;
    // first learned day to last, oldest first; kinds interleaved by a seeded shuffle
    const kinds: ('skill' | 'memory')[] = [...Array(skills).fill('skill'), ...Array(memories).fill('memory')];
    for (let k = kinds.length - 1; k > 0; k--) { const j = Math.floor(R() * (k + 1)); [kinds[k], kinds[j]] = [kinds[j], kinds[k]]; }
    const ts = kinds.map((_, k) => (k === 0 ? start : start + Math.pow((k + R() * 0.8) / total, 1.15) * (t1 - start))).sort((a, b) => a - b);
    const rings = total > 44 ? 5 : total > 28 ? 4 : 3;
    // ring capacity grows with radius; older nodes fill the inner rings first ("oldest at the center" inside an orbit too)
    const caps = Array.from({ length: rings }, (_, j) => 0.45 + (j + 1) / rings);
    const capSum = caps.reduce((a, b) => a + b, 0);
    const counts = caps.map((c) => Math.max(1, Math.round((c / capSum) * total)));
    let diff = total - counts.reduce((a, b) => a + b, 0);
    for (let j = rings - 1; diff !== 0; j = (j - 1 + rings) % rings) { if (diff > 0) { counts[j]++; diff--; } else if (counts[j] > 1) { counts[j]--; diff++; } }
    const nodes: Node[] = [];
    let ring = 0, inRing = 0;
    const seen = { skill: 0, memory: 0 };
    ts.forEach((t, k) => {
      if (inRing >= counts[ring]) { ring++; inRing = 0; }
      const kind = kinds[k];
      seen[kind]++;
      nodes.push({ kind, n: seen[kind], of: kind === 'skill' ? skills : memories, t, ring, th0: (inRing / counts[ring]) * Math.PI * 2 + ring * 1.7 + (R() - 0.5) * 0.35, alpha: 0 });
      inRing++;
    });
    return {
      i, d, pos: new THREE.Vector3(d.x, 0, d.z), color: new THREE.Color(d.c), t0: start, t1, days, skills, memories, nodes, rings,
      Ro: 1.55 + d.size * 1.1, shown: 0, flash: 0, sx: 0, sy: 0, sr: 0, vis: false, z: 0,
    };
  });
}

// ---------- textures & shaders
function glowTex(inner: string, mid: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.3, mid); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft blue clouds and a central bloom under the disc (the dust itself is a point cloud, crisp at any zoom). */
function nebulaTex(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = size / 512, m = size / 2;
  const R = rng(7);
  const bloom = g.createRadialGradient(m, m, 0, m, m, m);
  bloom.addColorStop(0, 'rgba(60,80,255,0.42)'); bloom.addColorStop(0.45, 'rgba(40,50,220,0.18)'); bloom.addColorStop(1, 'rgba(20,20,120,0)');
  g.fillStyle = bloom;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2, r = (40 + R() * 190) * s;
    const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r, rr = (40 + R() * 100) * s;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    const hue = 228 + R() * 30;
    gr.addColorStop(0, `hsla(${hue},95%,55%,${0.04 + R() * 0.06})`); gr.addColorStop(1, `hsla(${hue},95%,50%,0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  }
  g.globalCompositeOperation = 'destination-in';
  const mk = g.createRadialGradient(m, m, 110 * s, m, m, m);
  mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mk;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DISC_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// one orbit as on the screen: a bright sparkly outer band, finer inner rings that fill in as it is learned, a small core
const DISC_FS = `uniform vec3 uColor; uniform vec3 uCore; uniform float uTime, uOpacity, uSeed, uFill, uDim, uFlash; varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float band(float r, float c, float w){ float x = (r - c) / w; return exp(-x * x); }
void main(){
  vec2 p = vUv - 0.5; float r = length(p) * 2.0; if (r > 1.0) discard;
  float a = atan(p.y, p.x) + uTime * (0.22 + 0.12 * fract(uSeed * 0.37));
  vec2 cell = vec2(floor((a + 3.14159) * 15.0), floor(r * 30.0));
  float h1 = hash(cell + uSeed * 7.0);
  float spark = step(0.5, h1) * (0.6 + 0.4 * sin(uTime * 2.6 + h1 * 40.0));
  float f = uFill;
  float outer = band(r, 0.8, 0.07 + 0.03 * f) * (0.55 + 0.45 * f);
  float inner = smoothstep(0.1, 0.35, f) * band(r, 0.6, 0.028) + smoothstep(0.4, 0.65, f) * band(r, 0.44, 0.024) + smoothstep(0.7, 0.95, f) * band(r, 0.3, 0.02);
  float core = exp(-r * r / 0.01);
  float lit = outer * (0.5 + 0.9 * spark) + inner * (0.45 + 0.7 * spark);
  float haze = 0.1 * smoothstep(0.98, 0.25, r) * (0.4 + 0.6 * f);
  float k = mix(1.0, 0.42, uDim) * (1.0 + uFlash * 1.4);
  vec3 col = (uColor * (lit + haze) + uCore * core * 1.3) * k;
  gl_FragColor = vec4(col, clamp(lit + haze + core, 0.0, 1.0) * uOpacity);
}`;

const SPHERE_VS = `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`;
// the translucent lavender sphere at the centre (the oldest)
const SPHERE_FS = `uniform float uTime, uFade; varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main(){
  float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
  float bands = 0.04 * sin(vP.y * 9.0 + sin(vP.x * 4.0 + uTime * 0.3) * 1.5);
  vec3 col = mix(vec3(0.24, 0.22, 0.5), vec3(0.78, 0.74, 1.0), f) + bands;
  gl_FragColor = vec4(col * uFade, (0.5 + 0.45 * f) * uFade);
}`;

const NODE_VS = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uPx; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uPx; vC = aColor; vA = aAlpha; }`;
const NODE_FS = `uniform float uOpacity; varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float core = smoothstep(0.2, 0.12, d); float glow = exp(-d * d * 20.0) * 0.7;
  float a = (core + glow) * vA * uOpacity; if (a < 0.01) discard; gl_FragColor = vec4(mix(vC, vec3(1.0), core * 0.45) * (core + glow), a); }`;

/** The dusty disc with its sweeping arms, as on the screen: points denser along two log-spiral arms. */
function dust(n: number) {
  const R = rng(23);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x: number, z: number;
    if (i < n * 0.62) {
      const arm = i % 2, u = R();
      const th = u * 4.4 + arm * Math.PI + 0.4, r = 2.2 + u * 13.5, s = 0.4 + u * 1.6;
      x = Math.cos(th) * r + (R() - 0.5) * s; z = Math.sin(th) * r + (R() - 0.5) * s;
    } else {
      const a = R() * Math.PI * 2, r = 1.4 + Math.pow(R(), 0.7) * 16;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    pos.set([x, (R() - 0.5) * 0.25 - 0.15, z], i * 3);
    const b = 0.35 + R() * 0.65;
    col.set([0.62 * b, 0.68 * b, 1.0 * b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const FONT_ID = 'jr-font';

export function mount(ctx: IxCtx): Ix {
  const { stage, dock, signal, reduced } = ctx;
  stage.classList.add('jr');
  // the screen's title face is a wood-type western serif; Rye is a close stand-in (falls back to the app serif)
  if (!document.getElementById(FONT_ID)) {
    document.head.append(h('link', { id: FONT_ID, rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Rye&display=swap' }));
  }

  const renderer = new THREE.WebGLRenderer({ antialias: !ctx.coarse, powerPreference: 'high-performance' });
  const dpr = Math.min(devicePixelRatio || 1, ctx.coarse ? 1.75 : 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x04061c);
  renderer.domElement.className = 'jr-canvas';

  // ---------- DOM: the touch display's own overlay
  const labels = h('div', { class: 'jr-labels' });
  const bezel = h('div', { class: 'jr-bezel' }, h('span', { class: 'jr-plaque' }, 'Touch display'));
  const nameEl = h('h3', { class: 'jr-name' });
  const countsEl = h('div', { class: 'jr-counts' });
  const progEl = h('div', { class: 'jr-prog' });
  const orbitHead = h('div', { class: 'jr-orbit', 'aria-live': 'polite' }, nameEl, countsEl, progEl);
  const hud = h('div', { class: 'jr-hud' },
    h('div', { class: 'jr-brand' }, h('small', {}, 'Nous Research'), h('b', {}, 'Hermes Journey')),
    h('div', { class: 'jr-head' },
      h('p', { class: 'jr-cap' }, 'Skills and memories appear in the order Hermes learned them, oldest at the center.'),
      h('p', { class: 'jr-note' }, 'Orbit names read from photos of the screen (three partly hidden by glow). Counts, dates and individual skills are illustrative.'),
      orbitHead));
  const tip = h('div', { class: 'jr-tip', 'aria-live': 'polite' });
  stage.append(renderer.domElement, labels, bezel, hud, tip);

  // ---------- scene
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04061c, 0.008);
  const FOV = 42;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
  const TAN = Math.tan((FOV * Math.PI) / 360);

  const R = rng(11);
  const sp = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const u = R() * 2 - 1, a = R() * Math.PI * 2, r = 90 + R() * 110, s = Math.sqrt(1 - u * u);
    sp.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xd4dbff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false }));
  scene.add(stars);
  const nebT = nebulaTex(512);
  const neb = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), new THREE.MeshBasicMaterial({ map: nebT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  neb.rotation.x = -Math.PI / 2;
  neb.position.y = -0.2;
  scene.add(neb);
  const dotT = glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0.5)');
  const dustPts = new THREE.Points(dust(ctx.coarse ? 3200 : 5200), new THREE.PointsMaterial({ size: 0.055, map: dotT, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dustPts);

  const sphereMat = new THREE.ShaderMaterial({ vertexShader: SPHERE_VS, fragmentShader: SPHERE_FS, uniforms: { uTime: { value: 0 }, uFade: { value: 1 } }, transparent: true, depthWrite: false });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.95, 48, 32), sphereMat);
  sphere.position.y = 0.35;
  scene.add(sphere);
  const gt = glowTex('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.22)');
  const sphereGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: 0x8f86ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  sphereGlow.scale.setScalar(4.4);
  sphereGlow.position.y = 0.35;
  scene.add(sphereGlow);

  // ---------- orbits
  const discGeo = new THREE.PlaneGeometry(1, 1);
  const orbits: Orbit[] = buildOrbits().map((o) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: DISC_VS, fragmentShader: DISC_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: o.color }, uCore: { value: new THREE.Color(o.d.core ?? o.d.c) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uSeed: { value: o.i + 1 }, uFill: { value: 0 }, uDim: { value: o.d.dim ? 1 : 0 }, uFlash: { value: 0 } },
    });
    const disc = new THREE.Mesh(discGeo, mat);
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(o.d.size * 2.4);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: o.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.scale.setScalar(o.d.size * 2.6);
    const g = new THREE.Group();
    g.position.copy(o.pos);
    g.add(disc, glow);
    g.visible = false;
    scene.add(g);
    const label = h('button', { class: `jr-label${o.d.dim ? ' dim' : ''}`, style: `--c:${o.d.c}`, 'aria-label': `Open the ${o.d.partial ? 'partly hidden orbit' : o.d.name} orbit`, tabindex: '-1' }, o.d.name) as HTMLButtonElement;
    label.addEventListener('click', () => open(o.i), { signal });
    labels.append(label);
    const dot = h('i', { class: 'jr-odot', style: `--c:${o.d.c};--p:${frac(o.t0)}` });
    return Object.assign(o, { g, disc, mat, glow, label, dot });
  });

  // ---------- the opened orbit (built on demand, one at a time)
  interface Open { o: Orbit; g: THREE.Group; pts: THREE.Points; pos: Float32Array; alpha: Float32Array; size: Float32Array; basis: { u: THREE.Vector3; v: THREE.Vector3; r: number; w: number }[]; lineMats: THREE.LineBasicMaterial[]; nodeMat: THREE.ShaderMaterial; link: THREE.Line; linkMat: THREE.LineBasicMaterial; coreMat: THREE.MeshBasicMaterial; coreGlow: THREE.SpriteMaterial; sx: Float32Array; sy: Float32Array; amt: number }
  let opened: Open | null = null;
  let mode: 'system' | 'orbit' = 'system';
  let selNode = -1;
  function buildOpen(o: Orbit): Open {
    const g = new THREE.Group();
    g.position.copy(o.pos);
    const tint = o.color.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    const RR = rng(4000 + o.i);
    const basis = Array.from({ length: o.rings }, (_, j) => {
      const r = o.Ro * (0.3 + (0.7 * (j + 1)) / o.rings);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((RR() - 0.5) * 0.32, RR() * Math.PI, (RR() - 0.5) * 0.26));
      return { u: new THREE.Vector3(1, 0, 0).applyQuaternion(q), v: new THREE.Vector3(0, 0, 1).applyQuaternion(q), r, w: (0.32 / Math.pow(r / o.Ro + 0.2, 1.5)) * (j % 2 ? -1 : 1) * (reduced ? 0.25 : 1) };
    });
    const lineMats: THREE.LineBasicMaterial[] = [];
    for (const b of basis) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 128; k++) { const a = (k / 128) * Math.PI * 2; pts.push(b.u.clone().multiplyScalar(Math.cos(a) * b.r).addScaledVector(b.v, Math.sin(a) * b.r)); }
      const m = new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      lineMats.push(m);
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
    }
    // the core: the orbit's first-learned item sits at its centre, with a short spin axis like the screen's
    const coreMat = new THREE.MeshBasicMaterial({ color: o.color.clone().lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, opacity: 0 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(o.Ro * 0.055, 24, 16), coreMat);
    const coreGlow = new THREE.SpriteMaterial({ map: gt, color: o.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const cg = new THREE.Sprite(coreGlow);
    cg.scale.setScalar(o.Ro * 0.6);
    const axisMat = new THREE.LineBasicMaterial({ color: o.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    lineMats.push(axisMat);
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.05, -o.Ro * 0.32, 0), new THREE.Vector3(-0.05, o.Ro * 0.32, 0)]), axisMat);
    g.add(core, cg, axis);
    // skills: larger, in the orbit's colour; memories: small and white (as on the screen)
    const n = o.nodes.length;
    const pos = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n), col = new Float32Array(n * 3);
    const white = new THREE.Color('#ffffff');
    o.nodes.forEach((nd, k) => { const c = nd.kind === 'skill' ? o.color : white; col.set([c.r, c.g, c.b], k * 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const nodeMat = new THREE.ShaderMaterial({ vertexShader: NODE_VS, fragmentShader: NODE_FS, uniforms: { uPx: { value: dpr }, uOpacity: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, nodeMat);
    pts.frustumCulled = false;
    g.add(pts);
    const linkMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const link = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), linkMat);
    link.frustumCulled = false;
    g.add(link);
    g.scale.setScalar(0.3);
    scene.add(g);
    for (const nd of o.nodes) nd.alpha = 0;
    return { o, g, pts, pos, alpha, size, basis, lineMats, nodeMat, link, linkMat, coreMat, coreGlow, sx: new Float32Array(n), sy: new Float32Array(n), amt: 0 };
  }
  function disposeOpen(op: Open) {
    scene.remove(op.g);
    op.g.traverse((ob) => {
      const m = ob as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) mt.dispose();
    });
  }

  // ---------- dock: back, play, timeline
  const backBtn = btn('All orbits', { icon: ico.back, aria: 'Back to all orbits', cls: 'jr-back' });
  const playBtn = btn('Play the journey', { icon: ico.play, cls: 'jr-play' });
  const range = h('input', { type: 'range', min: '0', max: '1000', value: '0', class: 'jr-range', 'aria-label': 'Timeline, June to October 2026' }) as HTMLInputElement;
  const tlLabel = h('small', {}, 'Timeline');
  const dateEl = h('b', { class: 'jr-date' });
  const fill = h('i', { class: 'jr-fill' });
  const spanEl = h('i', { class: 'jr-span' });
  const ticks = h('div', { class: 'jr-ticks' });
  const rail = h('div', { class: 'jr-rail' }, fill, spanEl, ...orbits.map((o) => o.dot), ticks);
  const months = h('div', { class: 'jr-months' }, ...MONTHS.map((m) => h('span', { style: `--p:${frac(m.t)}` }, m.s, h('em', {}, ' 2026'))));
  const tlBox = h('div', { class: 'jr-tl' }, h('div', { class: 'jr-tl-top' }, tlLabel, dateEl), h('div', { class: 'jr-track' }, months, rail, range));
  dock.append(backBtn, playBtn, tlBox);

  // ---------- time
  let now = reduced ? T1 : T0;
  let play: { from: number; to: number; dur: number; wait: number } | null = reduced ? null : { from: T0, to: T1, dur: 15, wait: 0.8 };
  const setPlayUi = () => {
    const on = !!play;
    const inOrbit = mode === 'orbit';
    const label = on ? 'Pause' : inOrbit ? 'Play this orbit' : 'Play the journey';
    playBtn.innerHTML = `${on ? ico.pause : ico.play}<span>${label}</span>`;
    playBtn.setAttribute('aria-label', label);
    playBtn.setAttribute('aria-pressed', String(on));
  };
  function startPlay() {
    if (mode === 'orbit' && opened) {
      const o = opened.o;
      const from = o.t0 - DAY * 1.5, to = Math.min(T1, o.t1 + DAY);
      now = from;
      play = { from, to, dur: clamp(o.days * 0.22, 4, 8), wait: 0.15 };
    } else {
      now = now >= T1 - DAY ? T0 : now;
      play = { from: now, to: T1, dur: 15 * (1 - frac(now)) + 0.5, wait: 0.1 };
    }
    setPlayUi();
  }
  playBtn.addEventListener('click', () => { if (play) { play = null; setPlayUi(); } else startPlay(); }, { signal });
  range.addEventListener('input', () => { now = T0 + (+range.value / 1000) * (T1 - T0); if (play) { play = null; setPlayUi(); } }, { signal });
  backBtn.addEventListener('click', () => close(), { signal });

  // ---------- camera rig: target + spherical (theta around y, phi from the pole, distance); goal values eased in
  const cur = { target: new THREE.Vector3(), theta: 0, phi: 1.05, dist: 26 };
  const goal = { target: new THREE.Vector3(), theta: 0, phi: 1.05, dist: 26 };
  let fitDist = 26, fitPhi = 1.05;
  let lastTouch = -10, clock = 0, idle = 0, swayT = 0;
  const camOff = { y: 0, want: 0 };
  let W = 1, H = 1, top = 0, bottom = 0;
  let lSize: { w: number; h: number }[] = []; // measured label sizes (reset on resize)
  let ppw = 1;

  function regions() {
    const rc = stage.getBoundingClientRect();
    // the shell's header (full screen) and dock overlay the stage: keep the "screen" between them
    const head = stage.parentElement?.querySelector<HTMLElement>('.ix-head');
    let t = 8;
    if (head && head.offsetParent !== null) {
      let b = 0;
      for (const c of Array.from(head.children) as HTMLElement[]) b = Math.max(b, c.getBoundingClientRect().bottom);
      if (b > rc.top) t = Math.max(8, b - rc.top + 6);
    }
    let dt = rc.bottom;
    for (const c of Array.from(dock.children) as HTMLElement[]) if (c.offsetParent !== null) dt = Math.min(dt, c.getBoundingClientRect().top);
    const bm = Math.max(10, rc.bottom - dt + 12);
    return { t, b: bm };
  }
  // framing: find the distance at which the projected bounds (perspective included: the front of the disc looms larger)
  // fit the screen area, then offset the view so those bounds sit centred in it
  const probe = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
  const pv = new THREE.Vector3();
  const ring: THREE.Vector3[] = [];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
  function bounds(R: number, lift: number, sink: number, phi: number, d: number) {
    probe.aspect = W / H;
    probe.updateProjectionMatrix();
    probe.position.setFromSphericalCoords(d, phi, goal.theta);
    probe.lookAt(0, 0, 0);
    probe.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of ring) for (const y of [lift, -sink]) {
      pv.set(q.x * R, y, q.z * R).project(probe);
      const sx = ((pv.x + 1) / 2) * W, sy = ((1 - pv.y) / 2) * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  }
  function fit() {
    const hudH = hud.offsetHeight;
    // the area the system must fit in: inside the bezel, under the on-screen heading
    const reserveTop = top + hudH + (mode === 'orbit' ? 10 : 2);
    const regionB = H - bottom - 14;
    const vw = W - 28, vh = Math.max(80, regionB - reserveTop);
    const orbit = mode === 'orbit' && opened;
    const R = orbit ? opened!.o.Ro * 1.04 : SYS_R;
    const lift = orbit ? R * 0.34 : 0.9, sink = orbit ? R * 0.34 : 0.2;
    // landscape: a low, photo-like angle; tall panels look down more steeply so the disc fills the height
    const e = orbit ? clamp(0.42 + (vh / vw - 0.7) * 0.5, 0.42, 1.05) : clamp(0.5 + (vh / vw - 0.6) * 0.55, 0.5, 1.0);
    fitPhi = Math.PI / 2 - e;
    let lo = R * 0.8, hi = R * 30;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2, b = bounds(R, lift, sink, fitPhi, mid);
      if (b.x1 - b.x0 <= vw && b.y1 - b.y0 <= vh) hi = mid; else lo = mid;
    }
    fitDist = hi;
    const b = bounds(R, lift, sink, fitPhi, fitDist);
    // drawn small (embedded panels): smaller orbit names so they don't pile up
    if (!orbit) {
      const micro = b.x1 - b.x0 < 330;
      if (labels.classList.contains('micro') !== micro) { labels.classList.toggle('micro', micro); lSize = []; }
    }
    camOff.want = (b.y0 + b.y1) / 2 - (reserveTop + regionB) / 2;
  }
  function aim(snap = false) {
    fit();
    goal.dist = fitDist;
    goal.phi = fitPhi;
    goal.target.copy(mode === 'orbit' && opened ? opened.o.pos : new THREE.Vector3());
    if (snap || reduced) { cur.dist = goal.dist; cur.phi = goal.phi; cur.target.copy(goal.target); camOff.y = camOff.want; }
  }
  let firstLayout = true, asleep = false;
  const layout = () => {
    const rc = stage.getBoundingClientRect();
    // (hidden behind another panel tab: stop drawing until it has a size again)
    asleep = rc.width < 2 || rc.height < 2;
    if (asleep) return;
    W = rc.width; H = rc.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    stage.classList.toggle('jr-narrow', W < 600);
    stage.classList.toggle('jr-tiny', W < 420 || H < 520);
    stage.classList.toggle('jr-short', H < 380);
    const r = regions();
    top = r.t; bottom = r.b;
    bezel.style.top = `${top}px`; bezel.style.bottom = `${bottom}px`;
    hud.style.top = `${top + 10}px`;
    lSize = [];
    // (panel <-> full screen: re-frame, scaling the current distance so the system doesn't jump)
    const prevFit = fitDist;
    aim(firstLayout);
    if (!firstLayout) cur.dist *= fitDist / prevFit;
    firstLayout = false;
  };
  const unobs = onResize(stage, layout);
  // the heading's height changes with its text: re-fit without undoing the visitor's own zoom
  const unobsH = onResize(hud, () => { const f = fitDist; fit(); goal.dist *= fitDist / f; });
  const unobsD = onResize(dock, layout);
  // the timeline narrows when an orbit opens (no stage resize): five "MON 2026" labels need about 380 px
  const unobsT = onResize(tlBox, () => tlBox.classList.toggle('narrow', tlBox.offsetWidth < 380));
  layout();

  // ---------- open / close an orbit
  function setHead() {
    const inOrbit = mode === 'orbit' && opened;
    stage.classList.toggle('open', !!inOrbit);
    backBtn.hidden = !inOrbit;
    if (inOrbit) {
      const o = opened!.o;
      nameEl.textContent = o.d.name;
      nameEl.style.setProperty('--c', o.d.c);
      countsEl.textContent = `${o.skills} skills · ${o.memories} memories · ${o.days} days`;
      spanEl.style.cssText = `--a:${frac(o.t0)};--b:${frac(o.t1)};--c:${o.d.c}`;
      ticks.innerHTML = '';
      for (const nd of o.nodes) ticks.append(h('i', { class: nd.kind, style: `--p:${frac(nd.t)}` }));
      tlBox.style.setProperty('--c', o.d.c);
    } else {
      ticks.innerHTML = '';
    }
    setPlayUi();
  }
  function open(i: number) {
    const o = orbits[i];
    if (o.shown < 0.5) return;
    if (opened && opened.o !== o) { disposeOpen(opened); opened = null; }
    if (!opened) opened = buildOpen(o);
    mode = 'orbit';
    selNode = -1;
    tip.classList.remove('on');
    // (a journey that is playing keeps playing: this orbit fills in as its days pass)
    setHead();
    aim();
    lastTouch = clock;
  }
  function close() {
    if (mode !== 'orbit') return;
    mode = 'system';
    selNode = -1;
    tip.classList.remove('on');
    if (play && play.to !== T1) { play = null; }
    setHead();
    aim();
    lastTouch = clock;
  }
  setHead();

  // ---------- gestures: drag to turn, pinch / wheel to zoom, two-finger twist, tap to open / pick
  const ptrs = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; t: number; moved: boolean } | null = null;
  let pinch: { d: number; a: number } | null = null;
  let vTheta = 0, vPhi = 0;
  const cv = renderer.domElement;
  const limits = () => (mode === 'orbit' ? [fitDist * 0.45, fitDist * 2.2] : [fitDist * 0.42, fitDist * 1.7]);
  const zoomBy = (k: number) => {
    const [a, b] = limits();
    cur.dist = clamp(cur.dist * k, a, b);
    goal.dist = cur.dist;
  };
  const pinchState = () => {
    const [p, q] = [...ptrs.values()];
    return { d: Math.hypot(p.x - q.x, p.y - q.y), a: Math.atan2(q.y - p.y, q.x - p.x) };
  };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastTouch = clock;
    vTheta = vPhi = 0;
    if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else { if (down) down.moved = true; pinch = pinchState(); }
  }, { signal });
  cv.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    lastTouch = clock;
    if (ptrs.size === 1) {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) down.moved = true;
      if (!down?.moved) return;
      const k = 3.2 / Math.max(320, Math.min(W, H));
      vTheta = -dx * k; vPhi = -dy * k * 0.8;
      cur.theta += vTheta; goal.theta = cur.theta;
      cur.phi = clamp(cur.phi + vPhi, 0.18, 1.38); goal.phi = cur.phi;
    } else if (ptrs.size === 2 && pinch) {
      const s = pinchState();
      zoomBy(pinch.d / Math.max(1, s.d));
      let da = s.a - pinch.a;
      if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      cur.theta -= da; goal.theta = cur.theta;
      pinch = s;
    }
  }, { signal });
  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { const [q] = [...ptrs.values()]; down = { x: q.x, y: q.y, t: performance.now(), moved: true }; }
    if (ptrs.size > 0) return;
    const d = down;
    down = null;
    if (e.type === 'pointerup' && d && !d.moved && performance.now() - d.t < 600) { vTheta = vPhi = 0; tap(e.clientX, e.clientY); }
    // pinching out of an open orbit goes back to the whole system
    if (mode === 'orbit' && cur.dist > fitDist * 1.6) close();
  };
  cv.addEventListener('pointerup', up, { signal });
  cv.addEventListener('pointercancel', up, { signal });
  let wheelT = 0;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.exp(clamp(e.deltaY, -60, 60) * 0.0025));
    lastTouch = clock;
    clearTimeout(wheelT);
    wheelT = window.setTimeout(() => { if (mode === 'orbit' && cur.dist > fitDist * 1.6) close(); }, 220);
  }, { signal, passive: false });

  function tap(cx: number, cy: number) {
    const rc = stage.getBoundingClientRect();
    const x = cx - rc.left, y = cy - rc.top;
    if (mode === 'system') {
      let best = -1, bs = Infinity;
      for (const o of orbits) {
        if (!o.vis) continue;
        const d = Math.hypot(x - o.sx, y - o.sy), lim = Math.max(o.sr * 1.15, 22);
        if (d < lim && d / lim < bs) { bs = d / lim; best = o.i; }
      }
      if (best >= 0) open(best);
      return;
    }
    if (!opened) return;
    let best = -1, bd = ctx.coarse ? 28 : 22;
    for (let k = 0; k < opened.o.nodes.length; k++) {
      if (opened.alpha[k] < 0.5) continue;
      const d = Math.hypot(x - opened.sx[k], y - opened.sy[k]);
      if (d < bd) { bd = d; best = k; }
    }
    if (best >= 0) { selectNode(best === selNode ? -1 : best); return; }
    const o = opened.o;
    const span = o.Ro * ppw * 1.25;
    if (Math.hypot(x - o.sx, y - o.sy) > span) close();
    else selectNode(-1);
  }
  function selectNode(k: number) {
    selNode = k;
    if (k < 0 || !opened) { tip.classList.remove('on'); return; }
    const o = opened.o, nd = o.nodes[k];
    const day = Math.round((nd.t - o.t0) / DAY) + 1;
    tip.innerHTML = '';
    tip.append(
      h('span', { class: `k ${nd.kind}`, style: `--c:${o.d.c}` }, nd.kind === 'skill' ? 'Skill' : 'Memory'),
      h('b', {}, `${nd.kind === 'skill' ? 'Skill' : 'Memory'} ${nd.n} of ${nd.of}`),
      h('span', {}, `Learned ${fmt(nd.t)} · day ${day} of ${o.days}`),
      h('small', {}, `#${k + 1} learned in ${o.d.name} · illustrative`),
    );
    tip.style.setProperty('--c', o.d.c);
    tip.classList.add('on');
  }

  // ---------- labels: nearest first, nudged clear of each other, eased so they don't jitter as the disc turns
  const lOff = new Float32Array(orbits.length);
  const boxes: { l: number; r: number; t: number; b: number }[] = [];
  const order: number[] = [];
  const lx = new Float32Array(orbits.length), ly = new Float32Array(orbits.length);
  function placeLabels(dt: number, show: boolean) {
    if (lSize.length !== orbits.length || !lSize[0].w) lSize = orbits.map((o) => ({ w: o.label.offsetWidth, h: o.label.offsetHeight }));
    order.length = 0;
    for (const o of orbits) if (o.vis) order.push(o.i);
    order.sort((a, b) => orbits[a].z - orbits[b].z);
    boxes.length = 0;
    const k = 1 - Math.pow(0.0004, dt);
    for (const i of order) {
      const sz = lSize[i];
      const l = lx[i] - sz.w / 2 + 3, r = lx[i] + sz.w / 2 - 3;
      let want = 0;
      for (let pass = 0; pass < 6; pass++) {
        const t = ly[i] - sz.h + want + 4, bt = ly[i] + want - 4;
        const hit = boxes.find((q) => l < q.r && r > q.l && t < q.b && bt > q.t);
        if (!hit) break;
        const upv = hit.t - bt - 1, dn = hit.b - t + 1;
        want += Math.abs(upv) <= Math.abs(dn) ? upv : dn;
      }
      lOff[i] += (want - lOff[i]) * k;
      const y = ly[i] + lOff[i];
      boxes.push({ l, r, t: y - sz.h + 4, b: y - 4 });
      orbits[i].label.style.transform = `translate(${lx[i].toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const o of orbits) {
      const on = o.vis && show;
      o.label.style.opacity = on ? '1' : '0';
      o.label.style.pointerEvents = on ? 'auto' : 'none';
      o.label.tabIndex = on ? 0 : -1;
    }
  }

  // ---------- frame
  const v = new THREE.Vector3(), w = new THREE.Vector3(), fwd = new THREE.Vector3(0, 0, -1);
  const sph = new THREE.Spherical();
  let lastDate = '', lastRange = -1, lastProg = '';
  const project = (p: THREE.Vector3) => {
    w.copy(p).applyMatrix4(camera.matrixWorldInverse);
    const depth = -w.z;
    w.applyMatrix4(camera.projectionMatrix);
    return { x: ((w.x + 1) / 2) * W, y: ((1 - w.y) / 2) * H, depth, ok: depth > 0.1 };
  };

  const stop = loop((dt, t) => {
    if (asleep) return;
    clock = t;
    // time
    if (play) {
      if (play.wait > 0) play.wait -= dt;
      else {
        now += ((play.to - play.from) / play.dur) * dt;
        if (now >= play.to) { now = play.to; play = null; setPlayUi(); }
      }
    }
    now = clamp(now, T0, T1);
    const rv = Math.round(frac(now) * 1000);
    if (rv !== lastRange) { range.value = String(rv); fill.style.setProperty('--p', String(rv / 1000)); lastRange = rv; }
    const ds = fmt(now);
    if (ds !== lastDate) { dateEl.textContent = ds; lastDate = ds; }

    // camera: ease toward the goal; drift gently when nobody is touching
    if (!ptrs.size) {
      if (Math.abs(vTheta) > 1e-5 || Math.abs(vPhi) > 1e-5) {
        cur.theta += vTheta; goal.theta = cur.theta;
        cur.phi = clamp(cur.phi + vPhi, 0.18, 1.38); goal.phi = cur.phi;
        const damp = Math.pow(0.04, dt);
        vTheta *= damp; vPhi *= damp;
      }
      if (!reduced && t - lastTouch > 4) idle = Math.min(1, idle + dt * 0.25);
    }
    const kc = reduced ? 1 : 1 - Math.exp(-dt * 4.2);
    cur.target.lerp(goal.target, kc);
    cur.dist += (goal.dist - cur.dist) * kc;
    cur.phi += (goal.phi - cur.phi) * kc;
    cur.theta += (goal.theta - cur.theta) * Math.min(1, kc * 2);
    camOff.y += (camOff.want - camOff.y) * kc;
    if (ptrs.size || t - lastTouch <= 4) idle = Math.max(0, idle - dt * 1.5);
    swayT += dt * idle;
    // idle: the view breathes, swaying a little either side and in and out, then settles back when touched
    sph.set(cur.dist * (1 + 0.025 * idle * Math.sin(swayT * 0.21)), cur.phi + 0.04 * idle * Math.sin(swayT * 0.13), cur.theta + 0.16 * idle * Math.sin(swayT * 0.17));
    camera.position.setFromSpherical(sph).add(cur.target);
    camera.lookAt(cur.target);
    camera.setViewOffset(W, H, 0, camOff.y, W, H);
    camera.updateMatrixWorld();
    ppw = (H / 2) / (cur.dist * TAN);
    fwd.copy(cur.target).sub(camera.position).setY(0).normalize();

    // the whole system
    sphereMat.uniforms.uTime.value = t;
    sphere.rotation.y += dt * 0.08;
    const openAmt = opened ? opened.amt : 0;
    // inside an opened orbit the big sphere steps back (it would sit right behind the heading)
    const sf = 1 - 0.85 * ease(openAmt);
    sphereMat.uniforms.uFade.value = sf;
    (sphereGlow.material as THREE.SpriteMaterial).opacity = 0.55 * sf;
    let count = 0;
    for (const o of orbits) {
      const want = now >= o.t0 ? 1 : 0;
      if (want && o.shown < 0.02 && play) o.flash = 1;
      o.shown += (want - o.shown) * Math.min(1, dt * (reduced ? 30 : 5));
      if (want) count++;
      o.flash = Math.max(0, o.flash - dt * 1.4);
      const fillv = clamp((now - o.t0) / Math.max(DAY, o.t1 - o.t0), 0, 1);
      const isSel = opened?.o === o;
      const fade = opened ? 1 - (isSel ? 1 : 0.92) * ease(openAmt) : 1;
      o.g.visible = o.shown > 0.01;
      const pop = o.shown < 0.999 ? o.shown * (1 + 0.3 * Math.sin(o.shown * Math.PI)) : 1;
      o.g.scale.setScalar(Math.max(0.001, pop) * (isSel ? 1 + 0.6 * ease(openAmt) : 1));
      o.mat.uniforms.uTime.value = t;
      o.mat.uniforms.uFill.value = fillv;
      o.mat.uniforms.uFlash.value = o.flash;
      o.mat.uniforms.uOpacity.value = fade;
      (o.glow.material as THREE.SpriteMaterial).opacity = (0.16 + 0.5 * o.flash) * fade * (o.d.dim ? 0.4 : 1);
      const c = project(o.pos);
      o.sx = c.x; o.sy = c.y; o.z = c.depth;
      o.sr = o.d.size * ((H / 2) / (Math.max(0.5, c.depth) * TAN));
      // label anchor: the ring's far edge, so the name sits just above the ring on screen
      const a = project(v.copy(o.pos).addScaledVector(fwd, o.d.size * 0.95));
      lx[o.i] = c.x; ly[o.i] = Math.min(a.y, c.y - o.sr * 0.3) - 1;
      o.vis = o.shown > 0.5 && c.ok && c.x > -40 && c.x < W + 40 && c.y > -20 && c.y < H + 40;
      o.dot.classList.toggle('on', !!want);
    }
    placeLabels(dt, mode === 'system' && openAmt < 0.4);

    // the opened orbit
    if (opened) {
      const op = opened, o = op.o;
      const wantOpen = mode === 'orbit' ? 1 : 0;
      op.amt += (wantOpen - op.amt) * Math.min(1, dt * (reduced ? 30 : 3.2));
      if (!wantOpen && op.amt < 0.01) { disposeOpen(op); opened = null; }
      else {
        const e = ease(op.amt);
        op.g.scale.setScalar(0.3 + 0.7 * e);
        op.nodeMat.uniforms.uOpacity.value = e;
        op.nodeMat.uniforms.uPx.value = dpr * clamp(Math.min(W, H) / 520, 0.8, 1.35);
        op.coreMat.opacity = e;
        op.coreGlow.opacity = 0.9 * e;
        op.lineMats.forEach((m, j) => { m.opacity = (j === op.lineMats.length - 1 ? 0.75 : 0.32) * e; });
        let learned = 0;
        const n = o.nodes.length;
        for (let k = 0; k < n; k++) {
          const nd = o.nodes[k], b = op.basis[nd.ring];
          const target = now >= nd.t ? 1 : 0;
          if (target) learned++;
          nd.alpha += (target - nd.alpha) * Math.min(1, dt * (reduced ? 30 : 6));
          const th = nd.th0 + t * b.w;
          const cx = Math.cos(th) * b.r, cz = Math.sin(th) * b.r;
          const px = b.u.x * cx + b.v.x * cz, py = b.u.y * cx + b.v.y * cz, pz = b.u.z * cx + b.v.z * cz;
          op.pos[k * 3] = px; op.pos[k * 3 + 1] = py; op.pos[k * 3 + 2] = pz;
          op.alpha[k] = nd.alpha;
          const base = nd.kind === 'skill' ? 13 : 6.5;
          op.size[k] = (base + (1 - nd.alpha) * nd.alpha * 4 * 10) * (k === selNode ? 1.7 : 1);
          // screen position for picking and the tooltip
          const s = op.g.scale.x;
          v.set(o.pos.x + px * s, o.pos.y + py * s, o.pos.z + pz * s);
          const p = project(v);
          op.sx[k] = p.x; op.sy[k] = p.y;
        }
        const geo = op.pts.geometry;
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
        geo.attributes.aSize.needsUpdate = true;
        // a line from the core to the picked node (the screen links nodes to the centre like this)
        const lp = op.link.geometry.attributes.position as THREE.BufferAttribute;
        if (selNode >= 0) {
          lp.setXYZ(1, op.pos[selNode * 3], op.pos[selNode * 3 + 1], op.pos[selNode * 3 + 2]);
          lp.needsUpdate = true;
          op.linkMat.opacity += (0.6 * e - op.linkMat.opacity) * Math.min(1, dt * 8);
          // above the node; else below; else (short panels) beside it
          const rw = tip.offsetWidth, rh = tip.offsetHeight, nx = op.sx[selNode], ny = op.sy[selNode];
          let tx = nx - rw / 2, ty = ny - rh - 16;
          if (ty < top + 4) {
            ty = ny + 18;
            if (ty + rh > H - bottom - 4) { ty = clamp(ny - rh / 2, top + 4, Math.max(top + 4, H - bottom - rh - 4)); tx = nx > W / 2 ? nx - rw - 18 : nx + 18; }
          }
          tx = clamp(tx, 8, Math.max(8, W - rw - 8));
          tip.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`;
        } else op.linkMat.opacity = 0;
        if (mode === 'orbit') {
          const prog = (now < o.t0 ? `Not started by ${fmt(now, false)} · begins ${fmt(o.t0, false)}`
            : learned < n ? `By ${fmt(now, false)}: ${learned} of ${n} learned`
            : `All ${n} learned, ${fmt(o.t0, false)} – ${fmt(o.t1, false)}`) + (o.d.partial ? ' · name partly hidden in our photos' : '') + ' · counts illustrative';
          if (prog !== lastProg) { progEl.textContent = prog; lastProg = prog; }
          const dayN = clamp(Math.floor((now - o.t0) / DAY) + 1, 0, o.days);
          const tl = now < o.t0 ? `${o.d.name} · not started` : `${o.d.name} · day ${dayN} of ${o.days}`;
          if (tlLabel.textContent !== tl) tlLabel.textContent = tl;
        }
      }
    }
    if (mode === 'system') { const tl = `Timeline · ${count} of ${orbits.length} orbits`; if (tlLabel.textContent !== tl) tlLabel.textContent = tl; }
    renderer.render(scene, camera);
  });

  if (import.meta.env.DEV) (window as any).__jr = { orbits, open, close, get now() { return now; }, set now(x: number) { now = x; } };

  return {
    dispose() {
      stop();
      unobs(); unobsH(); unobsD(); unobsT();
      clearTimeout(wheelT);
      if (opened) { disposeOpen(opened); opened = null; }
      scene.traverse((ob) => {
        const m = ob as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mt of mats) mt.dispose();
      });
      discGeo.dispose();
      gt.dispose();
      dotT.dispose();
      nebT.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      document.getElementById(FONT_ID)?.remove();
    },
  };
}
