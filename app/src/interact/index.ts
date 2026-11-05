import './interact.css';
import { asset, type Station } from '../core/data';
import { h, reducedMotion } from '../ui/dom';
import { icons } from '../ui/icons';

/** What every recreation gets handed. Everything it shows must come from the station card (`station`). */
export interface IxCtx {
  station: Station;
  /** Full-screen layer the experience draws into. */
  stage: HTMLElement;
  /** Bottom control bar (glass pills); pointer events on. */
  dock: HTMLElement;
  asset: (p: string) => string;
  reduced: boolean;
  coarse: boolean;
  /** Aborted on close: pass to addEventListener so listeners go away with the experience. */
  signal: AbortSignal;
}
export interface Ix { dispose(): void }
/** A running recreation: close it, or (embedded) switch it between its panel and full screen. */
export interface IxHandle { close(): void; setFull(on: boolean): void; readonly full: boolean }
type Mod = { mount(ctx: IxCtx): Ix | Promise<Ix> };

// One lazily-loaded module per station: nothing below is fetched until someone opens that station's recreation.
const LOADERS: Record<string, () => Promise<Mod>> = {
  'led-camera-screens': () => import('./self-portrait'),
  tvs: () => import('./mandala'),
  'projector-screens': () => import('./shape'),
  'space-screen': () => import('./journey'),
  merch: () => import('./merch'),
  'cpu-terminals': () => import('./persistence'),
};
export const hasInteract = (id: string) => id in LOADERS;

let current: IxHandle | null = null;

/**
 * Open a station's interactive recreation: full screen (gallery), or embedded in `opts.host` (the station panel, beside
 * the live 3D view; an expand button takes it full screen and back).
 */
export async function openInteract(s: Station, opts: { returnFocus?: HTMLElement; host?: HTMLElement } = {}): Promise<IxHandle | null> {
  current?.close();
  const load = LOADERS[s.id];
  if (!load) return null;
  const host = opts.host ?? null;
  let full = !host;
  const ac = new AbortController();
  const credit = s.artist ? `Interpretive recreation of ${s.title} by ${s.artist}` : `Interpretive recreation of ${s.title}`;
  const root = h('div', { class: `ix${host ? ' embed' : ''}`, role: host ? 'region' : 'dialog', 'aria-modal': host ? null : 'true', 'aria-label': credit, tabindex: '-1', 'data-ix': s.id });
  const stage = h('div', { class: 'ix-stage' });
  const dock = h('div', { class: 'ix-dock' });
  const closeBtn = h('button', { class: 'ix-close', 'aria-label': host ? 'Back to the station' : 'Close the recreation', title: host ? 'Back to the station (Esc)' : 'Close (Esc)', html: icons.close });
  const expandBtn = host ? h('button', { class: 'ix-expand', 'aria-label': 'Full screen', title: 'Full screen', html: EXPAND }) : null;
  const head = h('header', { class: 'ix-head' },
    h('div', { class: 'ix-titles' },
      h('div', { class: 'ix-eyebrow' }, h('i'), 'Interactive'),
      h('h2', {}, s.title),
      h('p', { class: 'ix-credit' }, credit, h('span', {}, ' · not the original work'))),
    closeBtn);
  const loading = h('div', { class: 'ix-loading', role: 'status' }, h('i'), h('span', {}, 'Building the room'));
  root.append(stage, head, dock, loading);
  if (expandBtn) root.append(expandBtn);
  // (full screen: on <body>, the panel's transform / backdrop-filter would otherwise trap position: fixed)
  const place = () => {
    root.classList.toggle('full', full);
    (full ? document.body : host!).append(root);
    document.body.classList.toggle('ix-open', full);
    root.setAttribute('aria-modal', full ? 'true' : 'false');
  };
  place();
  requestAnimationFrame(() => root.classList.add('on'));
  if (!host) root.focus({ preventScroll: true });

  // Keep every gesture and key inside the recreation (the walk, gallery swipes and shortcuts stay put underneath).
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'keydown', 'keyup', 'click'] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation(), { signal: ac.signal });
  }
  // (full screen owns the keyboard; embedded, the station around it keeps its keys)
  addEventListener('keydown', (e) => {
    if (!full) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (host) setFull(false); else close(); return; }
    if (!root.contains(e.target as Node)) e.stopImmediatePropagation();
  }, { capture: true, signal: ac.signal });
  addEventListener('keyup', (e) => { if (full && !root.contains(e.target as Node)) e.stopImmediatePropagation(); }, { capture: true, signal: ac.signal });

  let ix: Ix | null = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (current === handle) current = null;
    ac.abort();
    try { ix?.dispose(); } catch (e) { console.warn(e); }
    ix = null;
    root.classList.add('out');
    if (full) document.body.classList.remove('ix-open');
    setTimeout(() => root.remove(), 380);
    opts.returnFocus?.focus({ preventScroll: true });
  };
  const setFull = (on: boolean) => {
    if (!host || closed || on === full) return;
    full = on;
    place();
    if (on) root.focus({ preventScroll: true }); else expandBtn?.focus({ preventScroll: true });
  };
  const handle: IxHandle = { close, setFull, get full() { return full; } };
  current = handle;
  closeBtn.addEventListener('click', () => { if (host) setFull(false); else close(); });
  expandBtn?.addEventListener('click', () => setFull(true));

  try {
    const mod = await load();
    if (closed) return handle;
    const made = await mod.mount({ station: s, stage, dock, asset, reduced: reducedMotion(), coarse: matchMedia('(pointer: coarse)').matches, signal: ac.signal });
    if (closed) { made.dispose(); return handle; }
    ix = made;
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 500);
  } catch (e) {
    console.warn('recreation failed', e);
    if (closed) return handle;
    loading.innerHTML = '';
    loading.append(h('span', {}, 'This recreation could not start on this device.'));
  }
  return handle;
}

const EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
