import { asset, type Station } from '../core/data';
import { h } from './dom';
import { icons } from './icons';

/** Fired on window whenever the card's footprint changes, so the 3D photo can stay centred in what's visible. */
export const CARD_INSET_EVENT = 'wte:card-inset';
export type CardInset = { right: number; bottom: number };

const wide = () => matchMedia('(min-width: 900px)').matches;
/** Desktop side panel: width + its outer margins (kept in sync with the .card rules in styles.css). */
const panelW = () => Math.round(Math.min(560, Math.max(400, innerWidth * 0.36)));
/** Phones: the panel takes ~58% of the screen; the live room keeps the top. */
const sheetH = () => Math.round(Math.max(390, Math.min(innerHeight - 220, innerHeight * 0.58)));
const PANEL_MARGIN = 14;

let safeProbe: HTMLElement | null = null;
const safeBottom = () => {
  if (!safeProbe) { safeProbe = h('div', { style: 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden' }); document.body.append(safeProbe); }
  return safeProbe.offsetHeight;
};

/** Lazy: the interactive recreations (and their CSS) only load when someone asks for one. */
export function launchInteract(s: Station, from?: HTMLElement | null) {
  from?.classList.add('loading');
  return import('../interact/index')
    .then((m) => m.openInteract(s, { returnFocus: from ?? undefined }))
    .catch((e) => console.warn('interact failed to load', e))
    .finally(() => from?.classList.remove('loading'));
}

export function interactButton(s: Station, onClick: (btn: HTMLElement) => void) {
  const b = h('button', { class: `btn interact${s.title.length > 15 ? ' long' : ''}`, 'aria-label': `Interact with ${s.title}`, title: `Interact with ${s.title}` },
    h('span', { class: 'ix-ico', html: icons.play }),
    h('span', { class: 'ix-txt' }, h('small', {}, 'Interact with'), h('b', {}, s.title)));
  b.addEventListener('click', () => onClick(b));
  return b;
}

/**
 * Station panel (owner: "more organized, so they can interact with it, while the 3D view keeps going so it's like
 * being there"). The live 3D photo of the station stays in view (above the panel on phones, left of it on desktop) and
 * the panel holds the station: title and actions, then three tabs: Try it (the interactive recreation, running right
 * here; expand for full screen), About (the wall card) and Photos. Phones: tap / drag the handle to shrink the panel to
 * its header and see more of the room; drag it down further to leave.
 */
export class StationCard {
  el = h('section', { class: 'card', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Station' });
  onBack: () => void = () => {};
  onAsk: (s: Station) => void = () => {};
  onShare: (s: Station) => void = () => {};
  onPhoto: (url: string) => void = () => {};
  /** (gallery-style full-screen launch; the panel embeds the recreation itself) */
  onInteract: (s: Station, btn: HTMLElement) => void = (s, btn) => { void launchInteract(s, btn); };
  station: Station | null = null;
  private mini = false;
  private ix: { close(): void; setFull(on: boolean): void } | null = null;
  private ixTimer = 0;
  private tabs = new Map<string, { tab: HTMLButtonElement; panel: HTMLElement }>();

  /** The pod inset to use before the panel has measured itself (it refines it via CARD_INSET_EVENT). */
  static podInset(): [number, number] {
    return wide() ? [panelW() + PANEL_MARGIN * 2, 0] : [0, sheetH()];
  }

  constructor(parent: HTMLElement) {
    parent.append(this.el);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    // phones: drag the handle / header: up = full panel, down = shrink to the header, further down = leave
    let ty: number | null = null, dy = 0;
    const start = (y: number, t: EventTarget | null) => {
      if (wide() || !(t as HTMLElement).closest('.grab,.card-head') || (t as HTMLElement).closest('button')) return;
      ty = y; dy = 0;
    };
    const move = (y: number) => {
      if (ty === null) return false;
      dy = y - ty;
      if (Math.abs(dy) < 6) return false;
      this.el.style.transition = 'none';
      this.el.style.transform = `translateY(${Math.max(this.mini ? -60 : -20, dy) * (dy < 0 ? 0.3 : 1)}px)`;
      return true;
    };
    const end = () => {
      if (ty === null) return;
      ty = null;
      this.el.style.transition = '';
      this.el.style.transform = '';
      if (dy > 120 && this.mini) this.onBack();
      else if (dy > 50) this.setMini(true);
      else if (dy < -30) this.setMini(false);
    };
    this.el.addEventListener('touchstart', (e) => start(e.touches[0].clientY, e.target), { passive: true });
    this.el.addEventListener('touchmove', (e) => { if (move(e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
    this.el.addEventListener('touchend', end);
    this.el.addEventListener('touchcancel', end);
    this.el.addEventListener('mousedown', (e) => start(e.clientY, e.target));
    addEventListener('mousemove', (e) => { if (ty !== null && e.buttons) move(e.clientY); });
    addEventListener('mouseup', end);
    addEventListener('resize', () => { if (this.station) this.measure(); });
  }

  open(s: Station, backLabel = 'Back to the walk') {
    this.closeIx();
    this.station = s;
    this.mini = false;
    this.el.classList.remove('mini');
    const by = [s.artist, s.year].filter(Boolean).join(', ');
    this.el.innerHTML = '';
    this.el.setAttribute('aria-label', s.title);
    this.tabs.clear();
    const host = h('div', { class: 'ix-host' }, h('div', { class: 'ix-wait' }, h('i'), h('span', {}, 'Setting up the piece')));
    const panels: [string, string, HTMLElement][] = [
      ['try', 'Try it', h('div', { class: 'panel try' }, host)],
      ['about', 'About', h('div', { class: 'panel about' },
        h('p', { class: 'one' }, s.one_liner),
        s.highlights.length ? h('ul', { class: 'points', 'aria-label': 'Highlights' }, ...s.highlights.map((x) => h('li', {}, x))) : '',
        h('div', { class: 'more-head' }, 'The wall card'),
        h('p', { class: 'body' }, s.body),
        h('div', { class: 'src' }, `Source: ${s.body_source}.`))],
      ['photos', 'Photos', h('div', { class: 'panel photos' }, ...s.photo_urls.map((u) => {
        const img = h('img', { src: asset(u.replace('.jpg', '_t.jpg')), alt: `${s.title} photo`, loading: 'lazy' });
        img.addEventListener('click', () => this.onPhoto(u));
        return img;
      }))],
    ];
    const tabBar = h('div', { class: 'card-tabs', role: 'tablist', 'aria-label': `${s.title} sections` });
    for (const [id, label, panel] of panels) {
      const tab = h('button', { class: 'card-tab', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': 'false', onclick: () => this.show(id) }, label) as HTMLButtonElement;
      panel.id = `panel-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `tab-${id}`);
      tabBar.append(tab);
      this.tabs.set(id, { tab, panel });
    }
    this.el.append(
      h('div', { class: 'grab', role: 'button', 'aria-label': 'Show more or less of the room', onclick: () => this.setMini(!this.mini) }),
      h('header', { class: 'card-head' },
        h('div', { class: 'card-titles' },
          h('div', { class: 'eyebrow' }, s.offscreen ? 'Station · seen in photos' : 'Station'),
          h('h2', {}, s.title),
          by ? h('div', { class: 'by' }, by) : ''),
        h('div', { class: 'card-acts' },
          h('button', { class: 'btn round pink', 'aria-label': 'Ask Hermes about this', title: 'Ask Hermes about this', onclick: () => this.onAsk(s), html: `${icons.chat}<span class="lbl">Ask</span>` }),
          h('button', { class: 'btn round', 'aria-label': 'Share', title: 'Share', onclick: () => this.onShare(s), html: `${icons.share}<span class="lbl">Share</span>` }),
          // .primary stays on Back: it's the panel's dismiss action (and what the QA suite presses)
          h('button', { class: 'btn round primary back', 'aria-label': backLabel, title: backLabel, onclick: () => this.onBack(), html: icons.close }))),
      tabBar,
      h('div', { class: 'card-panels' }, ...panels.map((p) => p[2])),
    );
    this.show('try');
    this.measure();
    requestAnimationFrame(() => { this.measure(); this.el.classList.add('on'); });
    void document.fonts?.ready.then(() => { if (this.station === s) this.measure(); });
    // the recreation starts once the camera has arrived at the station (its code and assets load lazily)
    this.ixTimer = window.setTimeout(() => {
      if (this.station !== s) return;
      void import('../interact/index').then(async (m) => {
        if (this.station !== s) return;
        const hd = await m.openInteract(s, { host });
        if (this.station !== s) { hd?.close(); return; }
        this.ix = hd;
        host.querySelector('.ix-wait')?.remove();
        if (!hd) { host.append(h('p', { class: 'ix-none' }, 'This station has no interactive version.')); this.show('about'); }
      }).catch((e) => { console.warn('interact failed to load', e); this.show('about'); });
    }, 450);
  }

  private show(id: string) {
    for (const [k, { tab, panel }] of this.tabs) {
      const on = k === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    this.el.dataset.tab = id;
  }

  private setMini(on: boolean) {
    if (wide() || !this.station || on === this.mini) return;
    this.mini = on;
    this.el.classList.toggle('mini', on);
    this.measure();
  }

  /** The room stays visible in what the panel leaves free: tell the 3D photo where that is. */
  private measure() {
    const inset: CardInset = wide()
      ? { right: panelW() + PANEL_MARGIN * 2, bottom: 0 }
      : { right: 0, bottom: this.mini ? this.miniH() : sheetH() };
    dispatchEvent(new CustomEvent<CardInset>(CARD_INSET_EVENT, { detail: inset }));
  }
  private miniH() {
    const head = this.el.querySelector('.card-head') as HTMLElement | null, tabs = this.el.querySelector('.card-tabs') as HTMLElement | null;
    return (head?.offsetHeight ?? 60) + (tabs?.offsetHeight ?? 40) + 22 + safeBottom();
  }

  private closeIx() {
    clearTimeout(this.ixTimer);
    this.ix?.close();
    this.ix = null;
  }

  close() { this.closeIx(); this.el.classList.remove('on', 'mini'); this.mini = false; this.station = null; }
}
