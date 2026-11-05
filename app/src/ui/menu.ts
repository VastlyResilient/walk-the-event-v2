import { h } from './dom';
import { icons } from './icons';

/**
 * Slide-in side menu: frosted glass panel from the right edge with a soft scrim.
 * Closes on scrim tap, Esc, swipe right or the close button; focus is trapped inside while open and returns to the
 * button that opened it. All open/close motion is CSS (transform + opacity), the swipe follows the finger.
 */
export class SideMenu {
  scrim = h('div', { class: 'menu-scrim', 'aria-hidden': 'true' });
  panel = h('nav', { class: 'menu', id: 'side-menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Menu', inert: true });
  body = h('div', { class: 'menu-body' });
  head = h('div', { class: 'menu-head' });
  closeBtn = h('button', { class: 'menu-x', type: 'button', 'aria-label': 'Close menu', html: icons.close }) as HTMLButtonElement;
  onToggle: (open: boolean) => void = () => {};
  private opener: HTMLElement | null = null;
  private isOpenNow = false;

  constructor(parent: HTMLElement) {
    this.head.append(this.closeBtn);
    this.panel.append(this.head, this.body);
    parent.append(this.scrim, this.panel);
    this.closeBtn.addEventListener('click', () => this.close());
    this.scrim.addEventListener('click', () => this.close());
    // nothing inside the menu (or on the scrim) drives the walk underneath
    for (const el of [this.panel, this.scrim]) {
      for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    }
    this.panel.addEventListener('keydown', (e) => this.onKey(e));
    this.bindSwipe();
  }

  get isOpen() { return this.isOpenNow; }

  open(opener?: HTMLElement) {
    if (this.isOpenNow) return;
    this.isOpenNow = true;
    this.opener = opener ?? (document.activeElement as HTMLElement | null);
    this.panel.inert = false;
    this.panel.style.transform = '';
    document.body.classList.add('menu-open');
    this.panel.classList.add('on');
    this.scrim.classList.add('on');
    this.onToggle(true);
    // focus the first real control once the slide has started (no scroll jump)
    requestAnimationFrame(() => (this.panel.querySelector<HTMLElement>('.menu-body [aria-current="true"], .menu-body button, .menu-body a') ?? this.closeBtn).focus({ preventScroll: true }));
  }

  close() {
    if (!this.isOpenNow) return;
    this.isOpenNow = false;
    this.panel.classList.remove('on');
    this.scrim.classList.remove('on');
    this.panel.style.transform = '';
    this.scrim.style.opacity = '';
    document.body.classList.remove('menu-open');
    this.panel.inert = true;
    this.onToggle(false);
    this.opener?.focus({ preventScroll: true });
  }

  toggle(opener?: HTMLElement) { if (this.isOpenNow) this.close(); else this.open(opener); }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...this.panel.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.closest('[inert]') && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Swipe right (towards the edge it came from) to dismiss; the panel follows the finger. */
  private bindSwipe() {
    let s: { x: number; y: number; t: number; id: number; axis: '' | 'x' | 'y'; w: number; dx: number } | null = null;
    let suppressClick = false;
    this.panel.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      s = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, axis: '', w: this.panel.offsetWidth, dx: 0 };
    });
    this.panel.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (s.axis !== 'x') return;
      s.dx = Math.max(0, dx);
      this.panel.classList.add('dragging');
      this.panel.style.transform = `translate3d(${s.dx}px,0,0)`;
      this.scrim.style.opacity = String(1 - s.dx / s.w);
    });
    const end = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const was = s;
      s = null;
      if (was.axis !== 'x') return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      this.panel.classList.remove('dragging');
      const v = was.dx / Math.max(1, performance.now() - was.t);
      if (was.dx > was.w * 0.3 || (v > 0.5 && was.dx > 30)) this.close();
      else { this.panel.style.transform = ''; this.scrim.style.opacity = ''; }
    };
    this.panel.addEventListener('pointerup', end);
    this.panel.addEventListener('pointercancel', end);
    this.panel.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
}

/** A disclosure section inside the menu (Settings, About): animated height via grid rows, collapsed content inert. */
export function disclosure(label: string, icon: string, content: HTMLElement, onOpen?: () => void) {
  const id = `menu-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const btn = h('button', { class: 'menu-row menu-disc', type: 'button', 'aria-expanded': 'false', 'aria-controls': id, html: `${icon}<span>${label}</span>${icons.chevron}` }) as HTMLButtonElement;
  const inner = h('div', { class: 'menu-disc-inner' }, content);
  const region = h('div', { class: 'menu-disc-body', id, role: 'region', 'aria-label': label, inert: true }, inner);
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    region.classList.toggle('on', open);
    region.inert = !open;
    if (open) {
      onOpen?.();
      // bring the opened section into view inside the menu's own scroller (never scrollIntoView: it scrolls the page)
      const sc = btn.closest<HTMLElement>('.menu-body');
      if (sc) setTimeout(() => sc.scrollTo({ top: Math.max(0, sc.scrollTop + btn.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8), behavior: 'smooth' }), 140);
    }
  });
  return h('div', { class: 'menu-disc-wrap' }, btn, region);
}
