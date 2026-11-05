import '../styles.css';
import { asset, BASE, type FloorId } from '../core/data';
import { h } from '../ui/dom';
import { icons } from '../ui/icons';

interface MapData {
  name: FloorId;
  bounds: [number, number, number, number];
  walls: [number, number][][];
  path: [number, number][];
  path_frames: [number, number, number][];
  chapters: { id: string; title: string; frame: number; x: number; z: number }[];
  stations: { id: string; title: string; frame: number; x: number; z: number; path_x: number; path_z: number }[];
}

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** V3 "Hybrid Map": an illustrated plan of the walked route with chapter + station pins. */
export async function runMap(root: HTMLElement) {
  document.title = 'Walk the Event · Map';
  const style = h('style', {}, MAP_CSS);
  document.head.append(style);
  const wrap = h('div', { class: 'map-page' });
  root.append(wrap);
  const top = h('div', { class: 'topbar' },
    h('a', { class: 'brand', href: BASE }, h('b', { html: 'Walk the <i>Event</i>' }), h('span', {}, 'The map')),
    h('div', { class: 'spacer' }),
  );
  const tabs = h('div', { class: 'floor-pill', role: 'tablist' });
  top.append(tabs, h('a', { class: 'icon-btn', href: `${BASE}stations/`, 'aria-label': 'All stations', html: icons.grid }),
    h('a', { class: 'icon-btn', href: BASE, 'aria-label': 'Back to the walk', html: icons.close }));
  const svg = svgEl('svg', { class: 'plan', role: 'img', 'aria-label': 'Floor plan' }) as SVGSVGElement;
  const legend = h('div', { class: 'map-legend' },
    h('span', { html: '<i class="lg-pin"></i> Station · tap to fly in' }),
    h('span', { html: '<i class="lg-ch"></i> Chapter' }));
  const title = h('div', { class: 'map-title' });
  wrap.append(svg, top, title, legend);
  const data = new Map<FloorId, MapData>();
  for (const id of ['downstairs', 'upstairs'] as FloorId[]) data.set(id, await (await fetch(asset(`data/map_${id}.json`))).json());
  let cur: FloorId = location.hash === '#up' ? 'upstairs' : 'downstairs';
  const btns: Record<string, HTMLButtonElement> = {};
  for (const [id, label] of [['downstairs', 'Downstairs'], ['upstairs', 'Upstairs']] as const) {
    const b = h('button', { role: 'tab', onclick: () => { cur = id; draw(); } }, label) as HTMLButtonElement;
    btns[id] = b;
    tabs.append(b);
  }
  let raf = 0;
  const draw = () => {
    cancelAnimationFrame(raf);
    for (const [k, b] of Object.entries(btns)) b.setAttribute('aria-current', String(k === cur));
    const m = data.get(cur)!;
    title.innerHTML = `<small>${cur === 'downstairs' ? 'Ground floor · 6 stations' : 'Upper floor · the party'}</small><strong>${cur === 'downstairs' ? 'Downstairs' : 'Upstairs'}</strong>`;
    svg.innerHTML = '';
    const W = innerWidth, H = innerHeight;
    const [x0, z0, x1, z1] = m.bounds;
    const pad = { l: 40, r: 40, t: 130, b: 120 };
    const maxH = W > 900 ? H * 0.7 : H - pad.t - pad.b;
    const s = Math.min((W - pad.l - pad.r) / (x1 - x0), maxH / (z1 - z0));
    const ox = pad.l + ((W - pad.l - pad.r) - (x1 - x0) * s) / 2, oy = pad.t + ((H - pad.t - pad.b) - (z1 - z0) * s) / 2;
    const P = (x: number, z: number) => [ox + (x - x0) * s, oy + (z - z0) * s];
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = svgEl('defs', {});
    defs.innerHTML = `
      <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="rgba(246,243,238,0.22)" stroke-width="1.4"/></pattern>
      <filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <linearGradient id="route" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b5cff" stop-opacity="0.32"/><stop offset="1" stop-color="#ff3fb4" stop-opacity="0.28"/></linearGradient>`;
    svg.append(defs);
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const place = (x: number, y: number, w: number, hgt: number, preferLeft: boolean) => {
      const tries: [boolean, number][] = [[preferLeft, 0], [!preferLeft, 0], [preferLeft, -16], [preferLeft, 16], [!preferLeft, -16], [!preferLeft, 16], [preferLeft, -30], [preferLeft, 30]];
      for (const [left, dy] of tries) {
        const r = left ? { x0: x - 12 - w, y0: y + dy - hgt / 2, x1: x - 12, y1: y + dy + hgt / 2 } : { x0: x + 12, y0: y + dy - hgt / 2, x1: x + 12 + w, y1: y + dy + hgt / 2 };
        if (r.x0 < 6 || r.x1 > W - 6) continue;
        if (!placed.some((p) => !(r.x1 < p.x0 || r.x0 > p.x1 || r.y1 < p.y0 || r.y0 > p.y1))) { placed.push(r); return { left, dy }; }
      }
      return null;
    };
    // reserve every pin and chapter dot so labels never sit on them
    for (const c of m.chapters) { const [x, y] = P(c.x, c.z); placed.push({ x0: x - 7, y0: y - 7, x1: x + 7, y1: y + 7 }); }
    for (const st of m.stations) { const [x, y] = P(st.x, st.z); placed.push({ x0: x - 11, y0: y - 11, x1: x + 11, y1: y + 11 }); }
    const measure = (txt: string, cls: string) => {
      const t = svgEl('text', { class: cls, x: -999, y: -999 }); t.textContent = txt; svg.append(t);
      const bb = (t as SVGTextElement).getBBox(); t.remove(); return [bb.width, bb.height];
    };
    // structure masses (from solved points), hatched like an architect's plan
    for (const w of m.walls) {
      if (w.length < 3) continue;
      const d = w.map(([x, z], i) => `${i ? 'L' : 'M'}${P(x, z).join(',')}`).join('') + 'Z';
      svg.append(svgEl('path', { d, fill: 'url(#hatch)', stroke: 'rgba(246,243,238,0.25)', 'stroke-width': 1, 'stroke-linejoin': 'round' }));
    }
    const pd = m.path.map(([x, z], i) => `${i ? 'L' : 'M'}${P(x, z).join(',')}`).join('');
    // the walkable route: a soft wide band, then the walked line
    svg.append(svgEl('path', { d: pd, fill: 'none', stroke: 'url(#route)', 'stroke-width': Math.max(26, 4.2 * s), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    svg.append(svgEl('path', { d: pd, fill: 'none', stroke: 'rgba(246,243,238,0.85)', 'stroke-width': 2, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' }));
    const [sx, sy] = P(m.path[0][0], m.path[0][1]);
    const startG = svgEl('g', {});
    startG.append(svgEl('circle', { cx: sx, cy: sy, r: 6, fill: '#f6f3ee' }));
    const st = svgEl('text', { x: sx + 12, y: sy + 4, class: 'map-small' });
    st.textContent = cur === 'downstairs' ? 'Start' : 'Stairs';
    startG.append(st);
    svg.append(startG);
    // stations: pin at the object, tether to where you stood
    for (const st of m.stations) {
      const [x, y] = P(st.x, st.z);
      const [px, py] = P(st.path_x, st.path_z);
      const g = svgEl('g', { class: 'pin-st', tabindex: 0, role: 'link', 'aria-label': `Station ${st.title}` });
      g.append(svgEl('line', { x1: px, y1: py, x2: x, y2: y, stroke: '#ff3fb4', 'stroke-width': 1.5, 'stroke-dasharray': '3 4', opacity: 0.8 }));
      g.append(svgEl('circle', { cx: x, cy: y, r: 16, fill: 'rgba(255,63,180,0.18)', class: 'pulse' }));
      g.append(svgEl('circle', { cx: x, cy: y, r: 8, fill: '#ff3fb4', filter: 'url(#glow)' }));
      const [tw, th] = measure(st.title, 'map-st');
      const pl = place(x, y, tw + 4, th, x > W * 0.55) ?? { left: x > W * 0.55, dy: 0 };
      const lab = svgEl('text', { x: x + (pl.left ? -16 : 16), y: y + 6 + pl.dy, 'text-anchor': pl.left ? 'end' : 'start', class: 'map-st' });
      lab.textContent = st.title;
      g.append(lab);
      const go = () => { location.href = `${BASE}#station-${st.id}`; };
      g.addEventListener('click', go);
      g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
      svg.append(g);
    }
    // chapters
    const endPt = P(m.path[m.path.length - 1][0], m.path[m.path.length - 1][1]);
    m.chapters.forEach((c, i) => {
      const [x, y] = P(c.x, c.z);
      if (Math.hypot(x - endPt[0], y - endPt[1]) < 14) return; // shares the stairs/balcony marker below
      const g = svgEl('g', { class: 'pin-ch', tabindex: 0, role: 'link', 'aria-label': `Chapter ${c.title}` });
      g.append(svgEl('circle', { cx: x, cy: y, r: 4.5, fill: '#07050b', stroke: '#f6f3ee', 'stroke-width': 2 }));
      const label = `${String(i + 1).padStart(2, '0')} ${c.title}`;
      const [tw, th] = measure(label, 'map-ch');
      const pl = place(x, y, tw + 2, th, x > W / 2);
      if (pl) {
        const t = svgEl('text', { x: x + (pl.left ? -10 : 10), y: y + 4 + pl.dy, 'text-anchor': pl.left ? 'end' : 'start', class: 'map-ch' });
        t.textContent = label;
        g.append(t);
      }
      g.addEventListener('click', () => { location.href = `${BASE}#chapter-${c.id}`; });
      g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') location.href = `${BASE}#chapter-${c.id}`; });
      svg.append(g);
    });
    // stairs marker between floors
    const end = m.path[m.path.length - 1];
    const [ex, ey] = P(end[0], end[1]);
    const stairs = svgEl('g', { class: 'pin-ch', tabindex: 0, role: 'link' });
    stairs.append(svgEl('rect', { x: ex - 8, y: ey - 8, width: 16, height: 16, rx: 4, fill: '#f6f3ee' }));
    const stt = svgEl('text', { x: ex + 20, y: ey + 4, class: 'map-small' });
    stt.textContent = cur === 'downstairs' ? '11 Into the Dark · upstairs ↗' : '08 The Balcony';
    stairs.append(stt);
    stairs.addEventListener('click', () => { if (cur === 'downstairs') { cur = 'upstairs'; draw(); } });
    svg.append(stairs);
    // mini Hermes walking the route
    const mini = svgEl('g', { class: 'mini', transform: 'translate(-99,-99)' });
    mini.innerHTML = `<ellipse cx="0" cy="13" rx="9" ry="3" fill="rgba(0,0,0,0.45)"/>
      <path d="M-7 12 L-4 2 L4 2 L7 12 Z" fill="#f6f3ee" stroke="#07050b" stroke-width="1.2"/>
      <path d="M-5 12 L-5 4 M-2 12 L-2 3 M1 12 L1 3 M4 12 L4 4" stroke="#07050b" stroke-width="1.6"/>
      <circle cx="0" cy="-5" r="7.5" fill="#f4ddcf" stroke="#07050b" stroke-width="1.2"/>
      <path d="M-8.5 -2 C-9 -12 -4 -14.5 0 -14.5 C4 -14.5 9 -12 8.5 -2 L10 0 L5 -1 L5 -7 L-5 -7 L-5 -1 L-10 0 Z" fill="#141018"/>
      <path d="M-7.6 -9 C-4 -14 4 -14 7.6 -9" stroke="#fff" stroke-width="1.8" fill="none"/>
      <circle cx="-2.5" cy="-3.5" r="1.3" fill="#141018"/><circle cx="2.5" cy="-3.5" r="1.3" fill="#141018"/>`;
    svg.insertBefore(mini, svg.querySelector('.pin-st, .pin-ch'));
    const pf = m.path_frames;
    let t = 0;
    let last = performance.now();
    const tick = (now: number) => {
      t += Math.max(0, now - last) / 1000; // rAF timestamps can precede performance.now()
      last = now;
      const u = (((t * 0.035) % 1) + 1) % 1;
      const k = u * (pf.length - 1), i = Math.floor(k), f = k - i;
      const a = pf[i], b = pf[Math.min(pf.length - 1, i + 1)];
      const [x, y] = P(a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      const bob = Math.abs(Math.sin(t * 9)) * 2;
      mini.setAttribute('transform', `translate(${x},${y - 26 - bob}) scale(2)`);
      raf = requestAnimationFrame(tick);
    };
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(tick);
    else { const [x, y] = P(pf[0][1], pf[0][2]); mini.setAttribute('transform', `translate(${x},${y - 16})`); }
  };
  draw();
  addEventListener('resize', draw);
}

const MAP_CSS = `
.map-page { position: fixed; inset: 0; background: radial-gradient(120% 90% at 30% 10%, #1a0d2a 0%, #07050b 60%); overflow: hidden; touch-action: manipulation; }
.map-page .plan { position: absolute; inset: 0; width: 100%; height: 100%; }
.map-page a.icon-btn { pointer-events: auto; display: grid; place-items: center; text-decoration: none; }
.map-title { position: absolute; left: calc(18px + var(--safe-l)); bottom: calc(22px + var(--safe-b)); pointer-events: none; }
.map-title small { display: block; font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: var(--paper-dim); font-weight: 700; }
.map-title strong { font-family: var(--serif); font-weight: 400; font-size: 40px; line-height: 1; }
.map-legend { position: absolute; right: calc(16px + var(--safe-r)); bottom: calc(26px + var(--safe-b)); display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--paper-dim); font-weight: 600; text-align: right; }
.map-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: -1px; margin-right: 4px; }
.lg-pin { background: var(--pink); box-shadow: 0 0 8px var(--pink); } .lg-ch { border: 2px solid var(--paper); }
.map-ch { font: 600 11.5px var(--sans); fill: rgba(246,243,238,0.78); paint-order: stroke; stroke: #07050b; stroke-width: 4px; }
.map-st { font: 400 19px var(--serif); font-style: italic; fill: #fff; paint-order: stroke; stroke: #07050b; stroke-width: 5px; }
.map-small { font: 700 10px var(--sans); letter-spacing: .14em; text-transform: uppercase; fill: var(--paper); paint-order: stroke; stroke: #07050b; stroke-width: 4px; }
.pin-st, .pin-ch { cursor: pointer; }
.pin-st:hover .map-st, .pin-st:focus .map-st { fill: var(--pink); }
.pin-st .pulse { animation: mpulse 2s infinite; transform-box: fill-box; transform-origin: center; }
@keyframes mpulse { 0% { transform: scale(.6); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }
`;
