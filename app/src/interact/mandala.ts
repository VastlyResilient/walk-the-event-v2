import './mandala.css';
import { h } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { btn, fit, ico, loop, onResize, rng } from './common';

/*
 * "Mandala" (Kevin Esherick), interpreted. From the card: an agent on a sandboxed virtual machine is told to turn the
 * sandbox itself into a work of art, continually expanding and improving on it; every 24 hours the machine is wiped,
 * only a hash of the previous state is left, and that hash seeds the next day; each day the agent begins anew.
 * From the photos: a wall of six screens in a 2 × 3 grid, a mandala-like form at the centre, terminal logs alongside.
 *
 * This is not the artist's code. The six screens here are the recreation's own: the agent's eye (what it inspects),
 * the mandala, the visitor's memory of past days, its plan/editor, its terminal log and the state (clock + hash).
 * Every step is planned in the log first, then appears on the mandala. At the end of the simulated day the state is
 * serialised and hashed with real SHA-256; the screens are wiped and the hash's bytes seed the next day.
 */

type Kind = 'ring' | 'petals' | 'dots' | 'spokes' | 'arcs' | 'star' | 'lotus' | 'chevrons' | 'beads';
interface Move { kind: Kind; r: number; n: number; size: number; w: number; rot: number; col: string; fill: boolean }
type Step =
  | { t: 'add'; m: Move; look: number; desc: string; why: string; v: boolean }
  | { t: 'refine'; i: number; from: Move; to: Move; look: number; desc: string; why: string; v: boolean };
interface Day {
  n: number; seed: string; base: number; acc: [string, string]; R: () => number;
  moves: Move[]; steps: number; sched: number; hash: string | null; growth: [number, number][];
  card?: HTMLButtonElement; thumb?: HTMLCanvasElement; hashEl?: HTMLElement;
}
type ScreenKey = 'eye' | 'art' | 'days' | 'plan' | 'log' | 'state';

const KINDS: Kind[] = ['ring', 'petals', 'dots', 'spokes', 'arcs', 'star', 'lotus', 'chevrons', 'beads'];
const NAMES: Record<Kind, string> = { ring: 'ring', petals: 'petals', dots: 'dots', spokes: 'spokes', arcs: 'arcs', star: 'stars', lotus: 'lotus petals', chevrons: 'chevrons', beads: 'beads' };
const CREAM = '#f4ecdc';
const ACCENTS = ['#ff4fbf', '#6ff3ff', '#ffcf6b', '#b79bff'];
const ACC_NAMES = ['magenta', 'cyan', 'amber', 'violet'];
const DAY_S = 86400;
const K = 150; // scheduled steps per day (front-loaded: growth early, refinement late)
const START_T = 7 * 3600; // you arrive seven hours into the current day
const SPEEDS = [{ s: 1, label: '24 h', aria: 'Real time: a day lasts 24 hours' }, { s: 360, label: '4 min', aria: 'Fast: a day lasts 4 minutes' }, { s: 1440, label: '1 min', aria: 'Fastest: a day lasts 1 minute' }];
const BASE_PHASE = { plan: 0.95, do: 1.1, write: 0.3 };
const SECONDARY: ScreenKey[] = ['log', 'plan', 'state', 'days'];
const TITLES: Record<ScreenKey, [string, string]> = {
  eye: ['agent eye', 'inspect'], art: ['display', 'sandbox'], days: ['visitor memory', 'outside the sandbox'],
  plan: ['plan.md', 'editor'], log: ['agent@sandbox', 'tty1'], state: ['state', 'sha-256'],
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const fmt = (r: number) => r.toFixed(2).replace(/^0/, '');
const pad3 = (n: number) => String(n).padStart(3, '0');
const short = (hx: string) => `${hx.slice(0, 8)}…`;
const hms = (s: number) => { s = Math.max(0, Math.floor(s)); return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, '0')).join(':'); };
const hm = (s: number) => hms(s).slice(0, 5);
const schedT = (k: number) => DAY_S * Math.pow(k / (K + 1), 1.3);
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const bytes = (hx: string) => { const b: number[] = []; for (let i = 0; i < hx.length; i += 2) b.push(parseInt(hx.slice(i, i + 2), 16)); return b; };

function hex(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(text: string) {
  try {
    if (crypto?.subtle) return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  } catch { /* insecure context: fall through */ }
  // FNV-1a fallback, widened to 64 hex chars (only where crypto.subtle is unavailable, i.e. non-secure contexts)
  let out = '';
  for (let k = 0; k < 8; k++) {
    let x = 0x811c9dc5 ^ k;
    for (let i = 0; i < text.length; i++) { x ^= text.charCodeAt(i); x = Math.imul(x, 16777619); }
    out += (x >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

/** The whole state of the sandbox, as the text that gets hashed. */
const stateText = (d: Day) => JSON.stringify({
  day: d.n, seed: d.seed, steps: d.steps,
  layers: d.moves.map((m) => [m.kind, m.n, +m.r.toFixed(3), +m.size.toFixed(3), +m.w.toFixed(2), +m.rot.toFixed(3), m.col, m.fill ? 1 : 0]),
});

/** A day's parameters come straight from its seed's bytes (shown in the log when a day starts). */
function makeDay(n: number, seed: string): Day {
  const b = bytes(seed);
  const base = [8, 10, 12, 16][b[0] % 4];
  const a0 = b[1] % 4, a1 = (a0 + 1 + ((b[1] >> 2) % 3)) % 4;
  const R = rng(((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0);
  return { n, seed, base, acc: [ACCENTS[a0], ACCENTS[a1]], R, moves: [], steps: 0, sched: 0, hash: null, growth: [[0, 0]] };
}
function derivation(d: Day) {
  const b = bytes(d.seed);
  const a0 = b[1] % 4, a1 = (a0 + 1 + ((b[1] >> 2) % 3)) % 4;
  return [
    { from: 0, to: 2, text: `seed[0] ${d.seed.slice(0, 2)} → ${b[0]} mod 4 → ${d.base}-fold symmetry` },
    { from: 2, to: 4, text: `seed[1] ${d.seed.slice(2, 4)} → accents ${ACC_NAMES[a0]} + ${ACC_NAMES[a1]}` },
    { from: 4, to: 12, text: `seed[2..5] ${d.seed.slice(4, 12)} → the day's random stream` },
  ];
}

const fillable = (k: Kind) => k !== 'spokes' && k !== 'arcs' && k !== 'chevrons' && k !== 'ring';
function describeAdd(m: Move) {
  if (m.kind === 'ring') return `add a ${m.n > 1 ? 'double ' : ''}ring at r ${fmt(m.r)}`;
  return `add a ring of ${m.n} ${NAMES[m.kind]} at r ${fmt(m.r)}`;
}

/** The agent's next idea, using the day's random stream. `extra` = layers already planned but not yet drawn. */
function planStep(d: Day, sugg: { r: number; a: number } | null, extra = 0): Step {
  const R = d.R, L = d.moves.length + extra;
  const look = d.moves.length ? Math.floor(R() * d.moves.length) : -1;
  const v = !!sugg;
  if (L === 0) {
    const kind: Kind = (['star', 'lotus', 'dots'] as Kind[])[bytes(d.seed)[6] % 3];
    const n = Math.min(d.base, 8);
    const m: Move = { kind, r: 0.035, n, size: 0.06, w: 2, rot: 0, col: CREAM, fill: true };
    return { t: 'add', m, look, desc: `place a ${n}-fold ${NAMES[kind].replace(/s$/, '')} at the centre`, why: 'first stroke, from the seed', v };
  }
  const frontier = Math.min(0.97, 0.06 + L * 0.03);
  const maxL = 40 + d.base;
  const pAdd = sugg ? (sugg.r > frontier + 0.04 ? 1 : 0.55) : L < 6 ? 1 : clamp(1.15 - L / maxL, 0.12, 0.92);
  if (R() < pAdd || d.moves.length === 0) {
    const r = sugg ? clamp(sugg.r, 0.05, 0.98) : R() < 0.75 ? frontier * (0.88 + R() * 0.12) : 0.08 + R() * frontier * 0.9;
    const kind: Kind = r < 0.1 ? (R() < 0.5 ? 'dots' : 'ring') : KINDS[Math.floor(R() * KINDS.length)];
    const ref = look >= 0 ? d.moves[look] : null;
    const matchRef = !!ref && ref.kind !== 'ring' && ref.n >= 4 && R() < 0.45;
    const sym = matchRef ? ref!.n : [d.base / 2, d.base, d.base, d.base * 2, d.base * 3][Math.floor(R() * 5)];
    const n = kind === 'ring' ? (R() < 0.3 ? 64 : 1) : r < 0.15 ? Math.min(sym, 8) : sym;
    const size = kind === 'ring' ? 0.05 : Math.min(0.2, ((Math.PI * 2 * r) / n) * (0.7 + R() * 0.6));
    const col = R() < 0.14 ? d.acc[Math.floor(R() * 2)] : CREAM;
    const m: Move = { kind, r, n, size, w: 1 + R() * 2.2, rot: sugg ? sugg.a : R() < 0.5 ? 0 : Math.PI / n, col, fill: fillable(kind) && col === CREAM && R() < 0.35 };
    const why = sugg ? 'where the visitor pointed' : matchRef && kind !== 'ring' && r >= 0.15 ? `matching layer ${look + 1}'s ${sym}-fold symmetry` : r > frontier * 0.85 ? 'expanding outward' : 'filling a gap';
    return { t: 'add', m, look, desc: describeAdd(m), why, v };
  }
  // refine an existing layer: the one the visitor pointed nearest to, or the one just examined
  let i = look;
  if (sugg) { let best = 9; d.moves.forEach((m, k) => { const dd = Math.abs(m.r - sugg.r); if (dd < best) { best = dd; i = k; } }); }
  const from = d.moves[i];
  const to: Move = { ...from };
  const ops: string[] = ['stroke', 'stroke', 'recolour'];
  if (from.kind !== 'ring') ops.push('interleave', 'grow');
  if (from.kind !== 'ring' && from.n * 2 <= 96 && from.r > 0.15) ops.push('densify', 'densify');
  if (fillable(from.kind)) ops.push('fill');
  const op = ops[Math.floor(R() * ops.length)];
  let desc = '';
  const L1 = i + 1;
  switch (op) {
    case 'stroke': to.w = clamp(from.w * (R() < 0.5 ? 0.6 : 1.55), 0.6, 4); desc = `refine stroke weight on layer ${L1} (${from.w.toFixed(1)} → ${to.w.toFixed(1)})`; break;
    case 'recolour': { const c = from.col === CREAM ? d.acc[Math.floor(R() * 2)] : CREAM; to.col = c; if (c !== CREAM) to.fill = false; desc = `recolour layer ${L1} ${c === CREAM ? 'cream' : ACC_NAMES[ACCENTS.indexOf(c)]}`; break; }
    case 'interleave': to.rot = from.rot + Math.PI / from.n; desc = `rotate layer ${L1} half a step to interleave`; break;
    case 'grow': { const k = from.size > 0.15 ? 0.8 : 1.25; to.size = Math.min(0.22, from.size * k); desc = `${k > 1 ? 'enlarge' : 'tighten'} the ${NAMES[from.kind]} on layer ${L1}`; break; }
    case 'densify': to.n = from.n * 2; to.size = from.size * 0.72; desc = `densify layer ${L1}: ${from.n} → ${to.n} ${NAMES[from.kind]}`; break;
    case 'fill': to.fill = !from.fill; desc = `${to.fill ? 'fill' : 'outline'} the ${NAMES[from.kind]} on layer ${L1}`; break;
  }
  return { t: 'refine', i, from, to, look: sugg ? i : look, desc, why: sugg ? 'nearest the visitor’s point' : 'improving what is there', v };
}
function apply(d: Day, s: Step) {
  if (s.t === 'add') d.moves.push(s.m); else d.moves[s.i] = s.to;
  d.steps++;
}

/** Draw one layer into ctx at radius scale R (px), up to progress p (0..1). */
function drawMove(g: CanvasRenderingContext2D, m: Move, R: number, p = 1, widthMul = 1) {
  const r = m.r * R, s = m.size * R;
  const count = Math.max(1, Math.ceil(m.n * Math.min(1, p * 1.05)));
  g.strokeStyle = m.col;
  g.fillStyle = m.col;
  g.lineWidth = Math.max(0.6, m.w * R * 0.004) * widthMul;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (m.kind === 'ring') {
    g.beginPath();
    g.arc(0, 0, r, m.rot, m.rot + Math.PI * 2 * Math.min(1, p));
    g.stroke();
    if (m.n > 40) { g.beginPath(); g.arc(0, 0, r + s * 0.12, m.rot, m.rot + Math.PI * 2 * Math.min(1, p)); g.stroke(); }
    return;
  }
  const doFill = m.fill && fillable(m.kind) && widthMul === 1;
  for (let i = 0; i < count; i++) {
    const a = m.rot + (i / m.n) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    g.save();
    g.transform(ca, sa, -sa, ca, sa * r, -ca * r);
    g.beginPath();
    switch (m.kind) {
      case 'petals': g.ellipse(0, 0, s * 0.28, s * 0.7, 0, 0, Math.PI * 2); break;
      case 'dots': g.arc(0, 0, s * 0.16, 0, Math.PI * 2); break;
      case 'beads': g.arc(0, 0, s * 0.09, 0, Math.PI * 2); g.moveTo(s * 0.3, 0); g.arc(0, 0, s * 0.3, 0, Math.PI * 2); break;
      case 'spokes': g.moveTo(0, s * 0.6); g.lineTo(0, -s * 0.6); break;
      case 'arcs': g.arc(0, s * 0.5, s * 0.55, Math.PI * 1.15, Math.PI * 1.85); break;
      case 'chevrons': g.moveTo(-s * 0.35, s * 0.2); g.lineTo(0, -s * 0.25); g.lineTo(s * 0.35, s * 0.2); break;
      case 'star':
        for (let j = 0; j <= 10; j++) { const rr = j % 2 ? s * 0.18 : s * 0.42, aa = (j / 10) * Math.PI * 2; g.lineTo(Math.sin(aa) * rr, -Math.cos(aa) * rr); }
        break;
      case 'lotus':
        g.moveTo(0, s * 0.55);
        g.bezierCurveTo(s * 0.55, s * 0.1, s * 0.2, -s * 0.45, 0, -s * 0.7);
        g.bezierCurveTo(-s * 0.2, -s * 0.45, -s * 0.55, s * 0.1, 0, s * 0.55);
        break;
    }
    if (doFill) g.fill(); else g.stroke();
    g.restore();
  }
}
const lerpMove = (a: Move, b: Move, p: number, discrete: Move): Move => ({
  ...discrete, r: a.r + (b.r - a.r) * p, size: a.size + (b.size - a.size) * p, w: a.w + (b.w - a.w) * p, rot: a.rot + (b.rot - a.rot) * p,
});
/** Draw a refinement in progress: numbers glide, discrete changes (count, colour, fill) cross-fade. */
function drawRefine(g: CanvasRenderingContext2D, from: Move, to: Move, R: number, p: number) {
  const disc = from.n !== to.n || from.col !== to.col || from.fill !== to.fill;
  const a0 = g.globalAlpha;
  if (!disc) { drawMove(g, lerpMove(from, to, p, to), R); return; }
  g.globalAlpha = a0 * (1 - p); drawMove(g, lerpMove(from, to, p, from), R);
  g.globalAlpha = a0 * p; drawMove(g, lerpMove(from, to, p, to), R);
  g.globalAlpha = a0;
}
function renderMoves(g: CanvasRenderingContext2D, moves: Move[], size: number, skip = -1) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  g.setTransform(1, 0, 0, 1, size / 2, size / 2);
  for (let i = 0; i < moves.length; i++) if (i !== skip) drawMove(g, moves[i], size * 0.47);
}
function compass(x: number, y: number, r: number) {
  if (r < 0.12) return 'the centre';
  const a = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(a / 45) % 8];
  return `the ${dir}${r > 0.85 ? ' edge' : ''}`;
}

export async function mount(ctx: IxCtx): Promise<Ix> {
  const { stage, dock, signal, reduced } = ctx;
  stage.classList.add('md');
  if (reduced) stage.classList.add('md-reduced');
  let dead = false;
  const mono = (getComputedStyle(stage).getPropertyValue('--mono') || 'monospace').trim();

  // ---------- the wall
  const screens = {} as Record<ScreenKey, HTMLElement>;
  const tbars = {} as Record<ScreenKey, HTMLElement>;
  const legend = (k: ScreenKey) => {
    const order: ScreenKey[] = ['eye', 'art', 'days', 'plan', 'log', 'state'];
    return `<span class="md-legend" aria-hidden="true">${order.map((o) => `<i${o === k ? ' class="on"' : ''}></i>`).join('')}</span>`;
  };
  const mk = (k: ScreenKey, ...kids: Node[]) => {
    const tb = h('button', { class: 'md-tbar', type: 'button', tabindex: '-1', 'aria-label': `${TITLES[k][0]} screen. Show the next screen` },
    );
    tb.innerHTML = `${legend(k)}<b>${TITLES[k][0]}</b><span>${TITLES[k][1]}</span><em class="md-next">next ▸</em>`;
    tbars[k] = tb;
    const el = h('section', { class: `md-screen md-s-${k}`, 'data-k': k }, ...(k === 'art' ? [] : [tb]), ...kids);
    screens[k] = el;
    return el;
  };

  // art (the mandala)
  const canvas = h('canvas', { class: 'md-canvas', role: 'img', 'aria-label': 'The mandala the agent is making. Tap or drag on it to suggest where the agent works next.' }) as HTMLCanvasElement;
  const hud = h('div', { class: 'md-hud', 'aria-hidden': 'true' });
  const hudL = h('span', {}), hudR = h('span', {});
  hud.append(hudL, hudR);
  const hint = h('div', { class: 'md-hint' }, h('span', { class: 'long' }, 'Tap or drag: suggest where the agent works next'), h('span', { class: 'short' }, 'Tap: suggest a spot'));
  const ovText = h('p', {});
  const backBtn = h('button', { class: 'md-back', type: 'button' }, 'Back to today');
  const ov = h('div', { class: 'md-ov' }, ovText, backBtn);
  const cap = h('div', { class: 'md-cap', 'aria-live': 'polite' });
  mk('art', canvas, hud, cap, hint, ov);

  // eye
  const eyeC = h('canvas', { class: 'md-eyec', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const eyeLbl = h('div', { class: 'md-eyelbl' }, 'idle');
  mk('eye', eyeC, h('i', { class: 'md-cross' }), eyeLbl);

  // days (the visitor's memory: the sandbox itself keeps only the hash)
  const chain = h('div', { class: 'md-chain' });
  mk('days', chain, h('p', { class: 'md-memo' }, 'A wipe leaves only the hash. These pictures are kept by this page, not by the sandbox.'));

  // plan / editor
  const ed = h('div', { class: 'md-ed' });
  mk('plan', ed);

  // log
  const logEl = h('div', { class: 'md-log', 'aria-live': 'off' });
  mk('log', logEl);

  // state
  const dayEl = h('b', { class: 'md-dayn' }, 'Day');
  const clockEl = h('span', { class: 'md-clock' }, 'T+00:00:00');
  const cdEl = h('div', { class: 'md-cd' }, '--:--:--');
  const spark = h('canvas', { class: 'md-spark', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const countEl = h('div', { class: 'md-count' });
  const seedEl = h('code', {});
  const liveEl = h('code', { class: 'live' });
  const seedLbl = h('small', {}, 'seed');
  mk('state', h('div', { class: 'md-stat-in' },
    h('div', { class: 'md-row1' }, dayEl, clockEl),
    h('small', {}, 'wiped in'), cdEl,
    spark, countEl,
    h('div', { class: 'md-hashes' }, seedLbl, seedEl, h('small', {}, 'state sha-256 · live'), liveEl)));

  const wall = h('div', { class: 'md-wall' }, ...(['eye', 'art', 'days', 'plan', 'log', 'state'] as ScreenKey[]).map((k) => screens[k]));
  stage.append(h('div', { class: 'md-room' }), wall);

  // ---------- dock
  const pauseBtn = btn('', { cls: 'round', icon: ico.pause, aria: 'Pause the agent' });
  pauseBtn.setAttribute('aria-pressed', 'false');
  const seg = h('div', { class: 'md-seg', role: 'group', 'aria-label': 'How long a day lasts' }, h('span', {}, 'Day'));
  const segBtns = SPEEDS.map((sp, i) => {
    const b = h('button', { type: 'button', 'aria-label': sp.aria, 'aria-pressed': String(i === 1) }, sp.label);
    seg.append(b);
    return b;
  });
  const wipeBtn = btn('Wipe now', { cls: 'pink', icon: ico.wipe, aria: 'Wipe the sandbox now: hash the state and seed the next day' });
  dock.append(pauseBtn, seg, wipeBtn);

  // ---------- state
  const days: Day[] = [];
  let day!: Day;
  let simT = START_T;
  let speed = SPEEDS[1].s;
  let paused = false;
  let S = 600;
  const artC = document.createElement('canvas');
  const glowC = document.createElement('canvas');
  const ag = artC.getContext('2d')!;
  const gg = glowC.getContext('2d')!;
  const refreshGlow = () => { gg.clearRect(0, 0, glowC.width, glowC.height); gg.drawImage(artC, 0, 0, glowC.width, glowC.height); };
  const redrawArt = (skip = -1) => { if (!day) return; renderMoves(ag, day.moves, S, skip); refreshGlow(); };

  // agent
  type Phase = 'plan' | 'do' | 'write';
  let cur: { s: Step; phase: Phase; t: number; f: number; sched: boolean; said: number } | null = null;
  let queue: Step[] = [];
  let sugg: { r: number; a: number; label: string } | null = null;
  let eyeAt = { x: 0, y: -0.3 }, eyeTo = { x: 0, y: -0.3 };
  let idleT = 3;
  let liveHash = '';
  let hashTicket = 0;

  // ---------- log
  const LOG_MAX = 90;
  const log = (t: string, cls = '', stamp = true) => {
    const ln = h('div', { class: cls });
    if (stamp) ln.append(h('i', {}, hm(simT)));
    ln.append(t);
    logEl.append(ln);
    while (logEl.childElementCount > LOG_MAX) logEl.firstElementChild!.remove();
    // WebKit lets a bottom-aligned overflowing column spill downward, hiding the newest lines: drop what doesn't fit
    while (logEl.childElementCount > 1 && logEl.scrollHeight > logEl.clientHeight + 1) logEl.firstElementChild!.remove();
  };

  // ---------- editor (plan.md)
  let edDone: string[] = [];
  function renderEditor() {
    const s = cur?.s;
    const lines: string[] = [];
    lines.push(`<div class="c">// day ${day.n} · step ${day.steps + (cur ? 1 : 0)} · T+${hm(simT)}</div>`);
    lines.push('<div class="k">plan</div><ol class="md-plan">');
    for (const d of edDone.slice(-1)) lines.push(`<li class="done">${esc(d)}</li>`);
    if (s) lines.push(`<li class="now${s.v ? ' v' : ''}">${esc(s.desc)}</li>`);
    for (const q of queue.slice(0, 3)) lines.push(`<li>${esc(q.desc)}</li>`);
    lines.push('</ol>');
    if (s) {
      const m = s.t === 'add' ? s.m : s.to;
      const idx = s.t === 'add' ? day.moves.length + 1 : s.i + 1;
      lines.push(`<div class="k">layer_${pad3(idx)}.json <span class="c">${s.t === 'add' ? 'new' : 'edit'} · ${esc(s.why)}</span></div><pre>`);
      const show = (x: unknown) => typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(2)) : typeof x === 'string' ? `"${x === CREAM ? 'cream' : ACC_NAMES[ACCENTS.indexOf(x)] ?? x}"` : String(x);
      const f = (k: keyof Move, v: string) => {
        if (s.t === 'refine' && s.from[k] !== s.to[k]) return `<span class="del">- ${k}: ${show(s.from[k])}</span>\n<span class="add">+ ${k}: ${v}</span>`;
        return `  ${k}: ${v}`;
      };
      const rows = (['kind', 'n', 'r', 'size', 'w', 'rot', 'col', 'fill'] as (keyof Move)[]).map((k) => f(k, show(m[k])));
      if (s.t === 'add') rows.forEach((_, i) => { rows[i] = `<span class="add">+${rows[i].slice(1)}</span>`; });
      lines.push(rows.join('\n'), '</pre>');
    } else {
      const next = day.sched < K ? schedT(day.sched + 1) : DAY_S;
      lines.push(`<div class="c">idle · next step at T+${hm(next)}${speed === 1 ? ` (in ${hms(next - simT).slice(3)})` : ''}</div>`);
    }
    ed.innerHTML = lines.join('');
  }

  // ---------- chain of days
  function addCard(d: Day) {
    const th = h('canvas', { width: '112', height: '112' }) as HTMLCanvasElement;
    const hashEl = h('code', {}, 'live');
    const card = h('button', { class: 'md-dcard live', type: 'button', 'aria-label': `Day ${d.n}` }, th, h('b', {}, `Day ${d.n}`), hashEl) as HTMLButtonElement;
    if (chain.childElementCount) chain.append(h('span', { class: 'md-link', 'aria-hidden': 'true' }, h('i', {}, 'hash'), '→', h('i', {}, 'seed')));
    chain.append(card);
    d.card = card; d.thumb = th; d.hashEl = hashEl;
    card.addEventListener('click', () => { if (d !== day && d.hash) openPreview(d); }, { signal });
    // keep the strip short: the oldest days fall out of memory too
    while (chain.childElementCount > 2 * 10 - 1) { chain.firstElementChild!.remove(); chain.firstElementChild?.remove(); }
    requestAnimationFrame(() => { chain.scrollLeft = chain.scrollWidth; });
  }
  function finishCard(d: Day) {
    if (!d.card || !d.thumb || !d.hashEl) return;
    const tg = d.thumb.getContext('2d')!;
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.fillStyle = '#050307'; tg.fillRect(0, 0, 112, 112);
    tg.setTransform(1, 0, 0, 1, 56, 56);
    for (const m of d.moves) drawMove(tg, m, 112 * 0.46);
    d.card.classList.remove('live');
    d.hashEl.textContent = `#${short(d.hash!)}`;
    d.card.setAttribute('aria-label', `Day ${d.n}, ended with hash ${d.hash!.slice(0, 12)}. Show it.`);
  }
  function liveThumb() {
    if (!day.thumb) return;
    const tg = day.thumb.getContext('2d')!;
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.fillStyle = '#050307'; tg.fillRect(0, 0, 112, 112);
    tg.drawImage(artC, 0, 0, S, S, 112 * 0.02, 112 * 0.02, 112 * 0.96, 112 * 0.96);
  }

  // ---------- preview of a remembered day
  let preview: { d: Day; c: HTMLCanvasElement } | null = null;
  function openPreview(d: Day) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    renderMoves(c.getContext('2d')!, d.moves, S);
    preview = { d, c };
    const next = days.find((x) => x.n === d.n + 1);
    ovText.textContent = `Day ${d.n}, remembered. Its final state hashed to #${short(d.hash!)}${next ? `, the seed of day ${next.n}` : ''}.`;
    stage.classList.add('previewing');
    for (const x of days) x.card?.classList.toggle('on', x === d);
  }
  function closePreview() {
    preview = null;
    stage.classList.remove('previewing');
    for (const x of days) x.card?.classList.remove('on');
  }
  backBtn.addEventListener('click', closePreview, { signal });

  // ---------- state screen
  let lastStat = '';
  function updateStat(force = false) {
    const key = `${day.n}|${Math.floor(simT)}|${day.moves.length}|${day.steps}|${liveHash}`;
    if (!force && key === lastStat) return;
    lastStat = key;
    dayEl.textContent = `Day ${day.n}`;
    clockEl.textContent = `T+${hms(Math.min(simT, DAY_S))}`;
    cdEl.textContent = hms(DAY_S - simT);
    countEl.textContent = `${day.moves.length} layers · ${day.steps} steps`;
    hudL.textContent = `Day ${day.n} · ${day.moves.length} layers`;
    hudR.textContent = `wipe ${hm(DAY_S - simT)}`;
  }
  function setSeedLabels() {
    const prev = days.find((x) => x.n === day.n - 1);
    seedLbl.textContent = prev ? `seed = hash of day ${prev.n}` : 'seed (genesis, this recreation)';
    seedEl.textContent = short(day.seed) + day.seed.slice(-8);
    seedEl.title = day.seed;
  }
  function rehash() {
    const ticket = ++hashTicket;
    const d = day;
    void sha256(stateText(d)).then((hx) => {
      if (dead || ticket !== hashTicket || d !== day) return;
      liveHash = hx;
      liveEl.textContent = `${hx.slice(0, 16)}…${hx.slice(-6)}`;
      liveEl.classList.remove('flash'); void liveEl.offsetWidth; liveEl.classList.add('flash');
      if (d.hashEl) d.hashEl.textContent = `live #${hx.slice(0, 6)}`;
    });
  }
  let sw = 0, sh = 0, sd = 1;
  function drawSpark() {
    if (!sw || !day) return;
    const g = spark.getContext('2d')!;
    g.setTransform(sd, 0, 0, sd, 0, 0);
    g.clearRect(0, 0, sw, sh);
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.fillRect(0, sh - 1, sw, 1);
    const maxL = 60;
    g.beginPath();
    for (const [t, l] of day.growth) g.lineTo((t / DAY_S) * sw, sh - 2 - (Math.min(l, maxL) / maxL) * (sh - 4));
    g.lineTo((simT / DAY_S) * sw, sh - 2 - (Math.min(day.moves.length, maxL) / maxL) * (sh - 4));
    g.strokeStyle = '#ff7ccc'; g.lineWidth = 1.5; g.stroke();
    const x = (Math.min(simT, DAY_S) / DAY_S) * sw;
    g.fillStyle = 'rgba(255,124,204,.12)'; g.fillRect(0, 0, x, sh);
    g.fillStyle = '#fff'; g.fillRect(x - 0.5, 0, 1, sh);
  }

  // ---------- agent steps
  const fillQueue = () => {
    while (queue.length < 3) {
      const extra = queue.filter((q) => q.t === 'add').length + (cur && cur.s.t === 'add' ? 1 : 0);
      queue.push(planStep(day, null, extra));
    }
  };
  const lookPoint = (i: number) => {
    const m = day.moves[i];
    return m ? { x: Math.sin(m.rot) * m.r, y: -Math.cos(m.rot) * m.r } : { x: 0, y: 0 };
  };
  function start(s: Step, f: number, sched: boolean) {
    cur = { s, phase: 'plan', t: 0, f, sched, said: 0 };
    if (s.look >= 0) eyeTo = lookPoint(s.look);
    renderEditor();
  }
  const terse = () => !!cur && cur.f < 0.4;
  function phaseDur(p: Phase) { return BASE_PHASE[p] * (cur ? cur.f : 1); }
  function stepAgent(dt: number) {
    if (!cur) return;
    const c = cur;
    c.t += dt;
    const s = c.s;
    if (c.phase === 'plan') {
      const d = phaseDur('plan');
      if (c.said === 0) {
        c.said = 1;
        if (!terse() && s.look >= 0) log(`$ examine layer ${s.look + 1} --symmetry`, 'cmd');
      }
      if (c.said === 1 && c.t > d * 0.45) {
        c.said = 2;
        const m = day.moves[s.look];
        if (!terse() && m) log(`  ${m.kind === 'ring' ? 'continuous ring' : `${m.n}-fold`} ✓ ${m.kind === 'ring' ? '' : NAMES[m.kind]}`, 'ok');
        log(terse() ? `$ ${s.desc}` : `$ plan: ${s.desc}`, 'cmd');
        const m2 = s.t === 'add' ? s.m : s.to;
        eyeTo = { x: Math.sin(m2.rot) * m2.r, y: -Math.cos(m2.rot) * m2.r };
      }
      if (c.t >= d) {
        c.phase = 'do'; c.t = 0;
        if (s.t === 'refine') redrawArt(s.i); // the layer lifts off the canvas while it is reworked
      }
    } else if (c.phase === 'do') {
      if (c.t >= phaseDur('do')) { c.phase = 'write'; c.t = 0; }
    } else if (c.t >= phaseDur('write')) {
      commit();
    }
  }
  function commit() {
    if (!cur) return;
    const s = cur.s;
    apply(day, s);
    if (cur.sched) day.sched++;
    ag.setTransform(1, 0, 0, 1, S / 2, S / 2);
    drawMove(ag, s.t === 'add' ? s.m : s.to, S * 0.47);
    refreshGlow();
    const idx = s.t === 'add' ? day.moves.length : s.i + 1;
    log(`  ✓ write layer_${pad3(idx)}.json · ${day.moves.length} layers`, 'ok');
    edDone.push(s.desc); if (edDone.length > 4) edDone.shift();
    day.growth.push([simT, day.moves.length]);
    cur = null;
    renderEditor();
    rehash();
    liveThumb();
    drawSpark();
    updateStat();
  }
  /** Fast-forward: steps due faster than they can be drawn are applied at once (a time-lapse). */
  function timeLapse(n: number) {
    const before = day.steps;
    for (let i = 0; i < n; i++) {
      const s = queue.shift() ?? planStep(day, null);
      apply(day, s);
      day.sched++;
      day.growth.push([schedT(day.sched), day.moves.length]);
      fillQueue();
    }
    redrawArt();
    log(`  … time-lapse: ${day.steps - before} steps applied (${day.moves.length} layers)`, 'ok');
    rehash(); liveThumb(); drawSpark(); renderEditor();
  }
  function agentTick(dt: number) {
    if (cur) { stepAgent(dt); return; }
    if (simT >= DAY_S) { void startWipe('24 hours elapsed'); return; }
    if (sugg) {
      const s = planStep(day, sugg);
      log(`> responding to the visitor: ${s.t === 'add' ? 'next layer goes there' : `refine layer ${s.i + 1}, nearest`}`, 'v');
      start(s, speed >= 1440 ? 0.6 : 1, false);
      sugg = null;
      return;
    }
    let due = 0;
    while (day.sched + due < K && schedT(day.sched + due + 1) <= simT) due++;
    if (due >= 4) { timeLapse(due - 1); due = 1; }
    if (due >= 1) {
      fillQueue();
      const nextT = day.sched + 2 <= K ? schedT(day.sched + 2) : DAY_S;
      const avail = Math.max(0, nextT - simT) / speed;
      const total = BASE_PHASE.plan + BASE_PHASE.do + BASE_PHASE.write;
      start(queue.shift()!, clamp((avail * 0.85) / total, 0.15, 1), true);
      fillQueue();
      return;
    }
    // between steps (real time): the agent keeps inspecting its work
    if ((idleT -= dt) <= 0 && day.moves.length) {
      const i = Math.floor(Math.random() * day.moves.length);
      const m = day.moves[i];
      eyeTo = lookPoint(i);
      const checks = [`examine layer ${i + 1} symmetry`, `compare layer ${i + 1} with its neighbours`, `check stroke weights near r ${fmt(m.r)}`];
      log(`$ ${checks[Math.floor(Math.random() * checks.length)]}`, 'cmd');
      log(`  ${m.kind === 'ring' ? 'ring' : `${m.n}-fold`} ✓ · keep`, 'ok');
      idleT = 6 + Math.random() * 4;
      renderEditor();
    }
  }

  // ---------- the wipe
  type Seq = { t: number; hx: string; from: Day; marks: Set<string>; first: Step | null; next: Day | null };
  let seq: Seq | null = null;
  async function startWipe(reason: string) {
    if (seq) return;
    closePreview();
    if (cur) { // finish the stroke in hand before the machine goes down
      const s = cur.s; cur = null; apply(day, s); redrawArt();
    }
    const from = day;
    seq = { t: 0, hx: '', from, marks: new Set(), first: null, next: null };
    wipeBtn.disabled = true;
    log(`$ ${reason}`, 'cmd');
    log('$ sha256sum state.json', 'cmd');
    const hx = await sha256(stateText(from));
    if (dead || !seq) return;
    from.hash = hx;
    seq.hx = hx;
  }
  const once = (k: string) => { if (!seq || seq.marks.has(k)) return false; seq.marks.add(k); return true; };
  function seqTick(dt: number) {
    if (!seq || !seq.hx) return;
    seq.t += dt;
    const t = seq.t, hx = seq.hx;
    if (t > 0.1 && once('hash')) cap.textContent = 'The whole state collapses into one SHA-256 hash';
    if (t > 1.3 && once('logged')) {
      log(`  ${hx}`, 'hash');
      finishCard(seq.from);
      seedLbl.textContent = `kept: hash of day ${seq.from.n}`;
      seedEl.textContent = `${hx.slice(0, 16)}…${hx.slice(-8)}`;
      screens.state.classList.remove('turn'); void screens.state.offsetWidth; screens.state.classList.add('turn');
    }
    if (t > 2.4 && once('wipe')) {
      log('$ wipe --all /sandbox', 'cmd');
      cap.textContent = 'The machine is wiped. Only the hash is left behind';
      stage.classList.add('wiping');
      const next = makeDay(seq.from.n + 1, hx);
      seq.next = next;
    }
    if (t > 2.75 && once('clear')) {
      // everything inside the sandbox goes: the art, the log, the plan
      day = seq.next!;
      days.push(day);
      simT = 0; queue = []; edDone = []; liveHash = ''; sugg = null;
      artC.getContext('2d')!.clearRect(0, 0, S, S);
      refreshGlow();
      logEl.textContent = '';
      liveEl.textContent = '—';
      log(`$ boot sandbox-vm · day ${day.n}`, 'cmd');
      log(`  seed ← ${hx.slice(0, 32)}…`, 'hash');
      addCard(day);
      setSeedLabels();
      updateStat(true);
      drawSpark();
      renderEditor();
    }
    if (t > 3.2 && once('unwipe')) { stage.classList.remove('wiping'); cap.textContent = `The hash becomes the seed of day ${day.n}`; }
    const der = derivation(day);
    der.forEach((dv, i) => { if (t > 3.4 + i * 0.5 && once(`d${i}`)) log(`  ${dv.text}`, 'v'); });
    if (t > 4.9 && once('first')) {
      seq.first = planStep(day, null);
      log(`$ plan: ${seq.first.desc}`, 'cmd');
    }
    if (t > 5.8 && once('end')) {
      const s = seq.first!;
      apply(day, s);
      day.sched = 1;
      simT = schedT(1);
      day.growth.push([simT, 1]);
      redrawArt();
      log(`  ✓ write layer_001.json · 1 layer`, 'ok');
      log('  the agent begins anew: no memory of yesterday, only its hash', 'ok');
      cap.textContent = '';
      seq = null;
      wipeBtn.disabled = false;
      fillQueue();
      renderEditor(); rehash(); liveThumb(); updateStat(true);
    }
  }

  // ---------- input: tap / drag a suggestion
  const ripples: { r: number; a: number; t: number }[] = [];
  let drag: { r: number; a: number; x: number; y: number } | null = null;
  const toArt = (e: PointerEvent) => {
    const rc = canvas.getBoundingClientRect();
    const x = e.clientX - rc.left - rc.width / 2, y = e.clientY - rc.top - rc.height / 2;
    const rad = Math.min(rc.width, rc.height) * 0.46;
    const r = Math.hypot(x, y) / rad;
    return { r, a: Math.atan2(x, -y) - rot, x, y };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (preview) { closePreview(); return; }
    if (seq) return;
    const p = toArt(e);
    if (p.r > 1.1) return;
    drag = p;
    canvas.setPointerCapture(e.pointerId);
    ripples.push({ r: p.r, a: p.a, t: 0 });
    hint.classList.add('gone');
  }, { signal });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toArt(e);
    if (Math.hypot(p.x - drag.x, p.y - drag.y) > 18) ripples.push({ r: Math.min(p.r, 1), a: p.a, t: 0 });
    drag = p;
  }, { signal });
  const release = () => {
    if (!drag || seq) { drag = null; return; }
    const r = Math.min(drag.r, 1);
    const label = `${compass(drag.x, drag.y, r)}, r ${fmt(r)}`;
    sugg = { r, a: drag.a, label };
    log(`[visitor] suggests ${label}`, 'v');
    drag = null;
  };
  canvas.addEventListener('pointerup', release, { signal });
  canvas.addEventListener('pointercancel', () => { drag = null; }, { signal });

  // ---------- controls
  wipeBtn.addEventListener('click', () => void startWipe('wipe requested by a visitor'), { signal });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.innerHTML = paused ? ico.play : ico.pause;
    pauseBtn.setAttribute('aria-label', paused ? 'Resume the agent' : 'Pause the agent');
    pauseBtn.setAttribute('aria-pressed', String(paused));
    log(paused ? '  (paused by a visitor)' : '  (resumed)', 'v');
  }, { signal });
  segBtns.forEach((b, i) => b.addEventListener('click', () => {
    speed = SPEEDS[i].s;
    segBtns.forEach((x, j) => x.setAttribute('aria-pressed', String(i === j)));
    log(`  (a day now lasts ${SPEEDS[i].label})`, 'v');
    renderEditor();
  }, { signal }));

  // compact layouts: one secondary screen at a time, the title bar cycles through them
  let sec: ScreenKey = 'log';
  let mode: 'wall' | 'tall' | 'side' | 'stack' = 'wall';
  for (const k of SECONDARY) {
    tbars[k].addEventListener('click', () => {
      if (mode !== 'side' && mode !== 'stack') return;
      sec = SECONDARY[(SECONDARY.indexOf(sec) + 1) % SECONDARY.length];
      applyAreas();
    }, { signal });
  }

  // ---------- layout from the stage's own size
  const g = canvas.getContext('2d')!;
  const eg = eyeC.getContext('2d')!;
  let W = 0, H = 0, D = 1, EW = 0, EH = 0, ED = 1;
  function applyAreas() {
    const area: Partial<Record<ScreenKey, string>> = {};
    if (mode === 'wall') Object.assign(area, { eye: '1/1', art: '1/2', days: '1/3', plan: '2/1', log: '2/2', state: '2/3' });
    else if (mode === 'tall') Object.assign(area, { art: '1/1/2/3', log: '2/1', state: '2/2', plan: '3/1', days: '3/2' });
    else if (mode === 'side') Object.assign(area, { art: '1/1', [sec]: '1/2' });
    else Object.assign(area, { art: '1/1', [sec]: '2/1' });
    for (const k of Object.keys(screens) as ScreenKey[]) {
      const a = area[k];
      screens[k].classList.toggle('off', !a);
      if (a) screens[k].style.gridArea = a;
    }
    wall.dataset.mode = mode;
    for (const k of SECONDARY) tbars[k].tabIndex = mode === 'side' || mode === 'stack' ? 0 : -1;
    requestAnimationFrame(sizeCanvases);
  }
  function sizeCanvases() {
    if (dead || !day) return;
    const f = fit(canvas, 2);
    W = f.w; H = f.h; D = f.d;
    const want = Math.max(64, Math.round(Math.min(W, H) * D));
    if (Math.abs(want - S) > 2 || artC.width !== S) {
      S = want;
      artC.width = artC.height = S;
      glowC.width = glowC.height = Math.max(16, Math.round(S / 7));
      if (cur?.s.t === 'refine' && cur.phase !== 'plan') redrawArt(cur.s.i); else redrawArt();
      if (preview) openPreview(preview.d);
    }
    if (!screens.eye.classList.contains('off')) { const e = fit(eyeC, 1.5); EW = e.w; EH = e.h; ED = e.d; } else EW = 0;
    if (!screens.state.classList.contains('off')) { const sp = fit(spark, 2); sw = sp.w; sh = sp.h; sd = sp.d; drawSpark(); }
  }
  function layout() {
    if (dead || !day) return;
    const sr = stage.getBoundingClientRect();
    if (sr.width < 10 || sr.height < 10) return;
    const root = stage.parentElement;
    const head = root?.querySelector('.ix-head') as HTMLElement | null;
    const titles = head?.querySelector('.ix-titles') as HTMLElement | null;
    let top = 10;
    if (head && getComputedStyle(head).display !== 'none' && titles) top = Math.max(top, titles.getBoundingClientRect().bottom - sr.top + 10);
    let minTop = Infinity;
    for (const c of dock.children) { const r = (c as HTMLElement).getBoundingClientRect(); if (r.height) minTop = Math.min(minTop, r.top); }
    const bottom = minTop < Infinity ? Math.max(10, sr.bottom - minTop + 10) : 10;
    // the panel's expand button sits over the top-right corner: keep title bars clear of it
    const exp = root?.querySelector('.ix-expand') as HTMLElement | null;
    wall.classList.toggle('corner', !!exp && exp.getBoundingClientRect().width > 0);
    const side = sr.width >= 700 ? 32 : 10;
    const aw = sr.width - side * 2, ah = sr.height - top - bottom;
    wipeBtn.querySelector('span')!.textContent = sr.width < 400 ? 'Wipe' : 'Wipe now';
    let cols = '', rows = '', ww = 0, wh = 0, gap = 8;
    if (aw >= 680 && ah >= 340 && aw / ah >= 1.25) {
      mode = 'wall'; gap = 12;
      let cw = (aw - gap * 2) / 3, ch = cw / 1.6;
      if (ch * 2 + gap > ah) { ch = (ah - gap) / 2; cw = Math.min(cw, ch * 1.78); }
      cols = `repeat(3, ${cw}px)`; rows = `repeat(2, ${ch}px)`; ww = cw * 3 + gap * 2; wh = ch * 2 + gap;
    } else if (ah >= aw * 1.3 && aw >= 300 && ah >= 560) {
      mode = 'tall';
      const w = Math.min(aw, 620);
      let rh = Math.max(110, Math.min(200, (ah - w - gap * 2) / 2));
      const m = Math.min(w, ah - rh * 2 - gap * 2);
      rh = (ah - m - gap * 2) / 2;
      rh = Math.min(rh, 220);
      cols = `repeat(2, ${(w - gap) / 2}px)`; rows = `${m}px ${rh}px ${rh}px`; ww = w; wh = m + rh * 2 + gap * 2;
    } else if (aw / ah >= 1.05) {
      mode = 'side'; gap = 6;
      let m = Math.min(ah, aw * 0.6);
      if (aw - m - gap < 150) m = aw - 150 - gap;
      const s2 = Math.min(aw - m - gap, 360);
      cols = `${m}px ${s2}px`; rows = `${ah}px`; ww = m + gap + s2; wh = ah;
    } else {
      mode = 'stack'; gap = 6;
      const sH = clamp(ah * 0.36, 104, 200);
      const mH = Math.min(ah - sH - gap, aw * 1.05);
      cols = `${aw}px`; rows = `${mH}px ${sH}px`; ww = aw; wh = mH + gap + sH;
    }
    wall.style.cssText = `grid-template-columns:${cols};grid-template-rows:${rows};gap:${gap}px;width:${ww}px;height:${wh}px;left:${(sr.width - ww) / 2}px;top:${top + Math.max(0, (ah - wh) / 2)}px`;
    applyAreas();
  }
  const unobs = onResize(stage, layout);
  const unobsDock = onResize(dock, layout);

  // ---------- history: days 1 and 2 already happened (computed here, deterministically, from a genesis seed)
  const genesis = await sha256('mandala · genesis seed of this recreation');
  if (dead) return { dispose() { /* closed while loading */ } };
  let seed = genesis;
  for (let n = 1; n <= 2; n++) {
    const d = makeDay(n, seed);
    while (d.sched < K) { apply(d, planStep(d, null)); d.sched++; d.growth.push([schedT(d.sched), d.moves.length]); }
    d.hash = await sha256(stateText(d));
    days.push(d);
    seed = d.hash;
  }
  day = makeDay(3, seed);
  days.push(day);
  while (day.sched < K && schedT(day.sched + 1) <= START_T) { apply(day, planStep(day, null)); day.sched++; day.growth.push([schedT(day.sched), day.moves.length]); }
  for (const d of days) { addCard(d); if (d.hash) finishCard(d); }
  layout();
  redrawArt();
  setSeedLabels();
  fillQueue();
  log('$ boot sandbox-vm', 'cmd', false);
  log('  instruction: turn this sandbox into a work of art,', 'ok', false);
  log('  continually expanding and improving on it', 'ok', false);
  log(`  day ${day.n} · seed ${day.seed.slice(0, 16)}… (hash of day 2)`, 'hash', false);
  log(`  … ${day.steps} steps since the last wipe`, 'ok');
  rehash();
  renderEditor();
  updateStat(true);

  // ---------- frame
  let rot = 0;
  let statT = 0, sparkT = 0;
  const stop = loop((dt) => {
    if (!W) return;
    const running = !paused;
    if (running) {
      if (seq) seqTick(dt);
      else {
        simT = Math.min(DAY_S, simT + dt * speed);
        agentTick(dt);
      }
      if (!reduced) rot += dt * 0.03;
    }
    if ((statT -= dt) <= 0) { statT = 0.12; updateStat(); if (!cur && !seq && speed > 1) renderEditorClock(); }
    if ((sparkT -= dt) <= 0) { sparkT = 0.5; drawSpark(); }
    drawArt(dt);
    if (EW) drawEye(dt);
  });
  let edClockT = 0;
  function renderEditorClock() { if ((edClockT += 0.12) > 0.5) { edClockT = 0; renderEditor(); } }

  function drawArt(dt: number) {
    g.setTransform(D, 0, 0, D, 0, 0);
    g.fillStyle = '#050307';
    g.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, rad = Math.min(W, H) * 0.46;
    const size = rad / 0.47;
    const src = preview ? preview.c : artC;
    let scale = 1, alpha = 1, spin = 0;
    if (seq && seq.hx && !seq.marks.has('clear')) {
      const e = clamp(seq.t / 1.3);
      const ee = e * e * e;
      scale = reduced ? 1 : 1 - 0.94 * ee;
      alpha = 1 - (reduced ? e : ee) * 0.95;
      spin = reduced ? 0 : ee * 2.4;
      if (seq.t > 2.4) alpha = 0;
    } else if (seq && seq.marks.has('clear')) alpha = 0;
    g.save();
    g.translate(cx, cy);
    g.rotate(rot + spin);
    g.scale(scale, scale);
    if (alpha > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55 * alpha;
      if (!preview) g.drawImage(glowC, -size * 0.52, -size * 0.52, size * 1.04, size * 1.04);
      g.globalAlpha = alpha;
      g.globalCompositeOperation = 'source-over';
      g.drawImage(src, -size / 2, -size / 2, size, size);
    }
    g.globalAlpha = 1;
    // the step in progress
    if (cur && !preview) {
      const s = cur.s;
      if (cur.phase === 'plan' || cur.phase === 'do') {
        // the agent's attention: a dashed guide where it is about to work
        const m = s.t === 'add' ? s.m : s.from;
        g.setLineDash([3, 5]);
        g.strokeStyle = s.v ? 'rgba(111,243,255,.7)' : 'rgba(255,207,107,.55)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(0, 0, m.r * rad, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      if (cur.phase !== 'plan') {
        const p = cur.phase === 'do' ? ease(clamp(cur.t / Math.max(0.01, phaseDur('do')))) : 1;
        if (s.t === 'add') {
          g.globalAlpha = 0.28; drawMove(g, s.m, rad, p, 3);
          g.globalAlpha = 1; drawMove(g, s.m, rad, p);
        } else {
          g.globalAlpha = 0.3; drawMove(g, p < 1 ? s.from : s.to, rad, 1, 3);
          g.globalAlpha = 1; drawRefine(g, s.from, s.to, rad, p);
        }
      }
    }
    // the first stroke of a new day, drawn out of the hash
    if (seq && seq.first) {
      const p = ease(clamp((seq.t - 4.9) / 0.9));
      drawMove(g, seq.first.t === 'add' ? seq.first.m : seq.first.to, rad, p);
    }
    // visitor ripples, repeated with the day's symmetry
    const fold = day ? day.base : 12;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.t += dt;
      if (rp.t > 1.2) { ripples.splice(i, 1); continue; }
      g.strokeStyle = `rgba(111,243,255,${(1 - rp.t / 1.2) * 0.75})`;
      g.lineWidth = 1.4;
      g.beginPath();
      for (let k = 0; k < fold; k++) {
        const a = rp.a + (k / fold) * Math.PI * 2;
        const x = Math.sin(a) * rp.r * rad, y = -Math.cos(a) * rp.r * rad, rr = 3 + rp.t * 22;
        g.moveTo(x + rr, y); g.arc(x, y, rr, 0, Math.PI * 2);
      }
      g.stroke();
    }
    if (drag || sugg) {
      const r = Math.min(1, drag ? drag.r : sugg!.r);
      g.setLineDash([2, 4]);
      g.strokeStyle = 'rgba(111,243,255,.8)';
      g.lineWidth = 1.2;
      g.beginPath(); g.arc(0, 0, r * rad, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    if (seq && seq.hx && seq.t > 0.1) drawHash(cx, cy, rad);
    if (day && day.moves.length === 0 && !cur && !seq) {
      g.fillStyle = 'rgba(244,236,220,.5)';
      g.font = `600 11px ${mono}`;
      g.textAlign = 'center';
      g.fillText('blank sandbox', cx, cy + 4);
    }
  }
  /** The 64 hex characters: they rise out of the collapsing art, settle into a block, and outlast the wipe. */
  function drawHash(cx: number, cy: number, rad: number) {
    const s = seq!;
    const t = s.t, hx = s.hx;
    const fs = Math.max(8, Math.min(22, (rad * 1.7) / 16 / 0.62));
    const cw = fs * 0.62, lh = fs * 1.4;
    const k = reduced ? clamp((t - 0.2) / 0.6) : ease(clamp((t - 0.35) / 0.95));
    const alpha = clamp((t - 0.1) / 0.5) * (1 - clamp((t - 5.0) / 0.8));
    if (alpha <= 0) return;
    const der = s.next ? derivation(s.next) : [];
    const lit = der.filter((_, i) => t > 3.4 + i * 0.5);
    g.font = `600 ${fs}px ${mono}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2 + rot;
      const rr = rad * (0.95 - 0.35 * k);
      const rx = cx + Math.sin(a) * rr, ry = cy - Math.cos(a) * rr;
      const gx = cx + ((i % 16) - 7.5) * cw, gy = cy + (Math.floor(i / 16) - 1.5) * lh;
      const x = rx + (gx - rx) * k, y = ry + (gy - ry) * k;
      const on = lit.some((d) => i >= d.from && i < d.to);
      const latest = lit.length && i >= lit[lit.length - 1].from && i < lit[lit.length - 1].to;
      g.globalAlpha = alpha * (s.next && !on && t > 3.4 ? 0.45 : 1);
      g.fillStyle = on ? (latest ? '#6ff3ff' : '#ffcf6b') : '#ffcf6b';
      g.fillText(hx[i], x, y);
    }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
  }
  function drawEye(dt: number) {
    const kk = 1 - Math.exp(-dt * 3);
    eyeAt = { x: eyeAt.x + (eyeTo.x - eyeAt.x) * kk, y: eyeAt.y + (eyeTo.y - eyeAt.y) * kk };
    eg.setTransform(ED, 0, 0, ED, 0, 0);
    eg.fillStyle = '#040305';
    eg.fillRect(0, 0, EW, EH);
    const Rart = S * 0.47;
    const view = 0.3; // half-width of the inspected region, in mandala radii
    const z = (EW / 2) / (view * Rart);
    eg.save();
    eg.translate(EW / 2, EH / 2);
    eg.scale(z, z);
    eg.translate(-eyeAt.x * Rart, -eyeAt.y * Rart);
    if (!seq || !seq.marks.has('clear')) eg.drawImage(artC, -S / 2, -S / 2, S, S);
    if (cur && cur.phase !== 'plan') {
      const p = cur.phase === 'do' ? ease(clamp(cur.t / Math.max(0.01, phaseDur('do')))) : 1;
      if (cur.s.t === 'add') drawMove(eg, cur.s.m, Rart, p); else drawRefine(eg, cur.s.from, cur.s.to, Rart, p);
    }
    eg.restore();
    const r = Math.hypot(eyeAt.x, eyeAt.y);
    const txt = cur ? `${cur.phase === 'plan' ? 'inspect' : cur.phase === 'do' ? 'draw' : 'verify'} · r ${fmt(r)}` : seq ? 'offline' : `look · r ${fmt(r)}`;
    if (eyeLbl.textContent !== txt) eyeLbl.textContent = txt;
  }

  return {
    dispose() {
      dead = true;
      stop(); unobs(); unobsDock();
      stage.classList.remove('md', 'md-reduced', 'wiping', 'previewing');
    },
  };
}
