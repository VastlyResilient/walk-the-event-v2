import { h } from '../ui/dom';

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Device pixel ratio for 2D canvases: crisp, but capped so 3x phones don't push 9x the pixels. */
export const dpr2d = (cap = 2) => Math.min(devicePixelRatio || 1, cap);

/** Size a canvas to its CSS box. Returns CSS width/height and the scale used. */
export function fit(c: HTMLCanvasElement, cap = 2) {
  const r = c.getBoundingClientRect();
  const d = dpr2d(cap);
  const w = Math.max(1, Math.round(r.width * d)), hh = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
  return { w: r.width, h: r.height, d };
}

/**
 * requestAnimationFrame loop on real time (dt in seconds, clamped). Pauses itself while the tab is hidden.
 * Returns stop().
 */
export function loop(fn: (dt: number, t: number) => void) {
  let raf = 0, last = 0, t = 0, on = true;
  const tick = (now: number) => {
    if (!on) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    fn(dt, t);
  };
  const vis = () => { if (document.hidden) { cancelAnimationFrame(raf); last = 0; } else if (on) { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } };
  document.addEventListener('visibilitychange', vis);
  raf = requestAnimationFrame(tick);
  return () => { on = false; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); };
}

/** Observe an element's size. Returns disconnect(). */
export function onResize(el: Element, cb: () => void) {
  const ro = new ResizeObserver(() => cb());
  ro.observe(el);
  return () => ro.disconnect();
}

export function btn(label: string, opts: { cls?: string; icon?: string; aria?: string; onClick?: (e: MouseEvent) => void } = {}) {
  const b = h('button', { class: `ix-btn ${opts.cls ?? ''}`, 'aria-label': opts.aria ?? null, html: `${opts.icon ?? ''}<span>${label}</span>` });
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

/** Small inline icon set for the recreations (stroke icons, 24 grid). */
const s = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ico = {
  camera: s('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  snap: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4" fill="currentColor"/>'),
  sound: s('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  mute: s('<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  wipe: s('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  play: s('<path d="M7 4v16l13-8z" fill="currentColor"/>'),
  pause: s('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  send: s('<path d="M4 12 20 4l-6 16-3-7z"/>'),
  back: s('<path d="M15 18l-6-6 6-6"/>'),
  reset: s('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  flame: s('<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.7 2.3-5 .3 1.6 1 2.6 2 3 0-3 .2-5.6.7-8z"/>'),
};

/** Load an image (resolves when decoded). */
export function img(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.decoding = 'async';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** A short note pinned in the recreation explaining what's interpretive (facts come only from the card). */
export function note(text: string) {
  return h('p', { class: 'ix-note' }, text);
}
