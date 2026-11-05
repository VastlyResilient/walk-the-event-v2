import '../styles.css';
import { asset, BASE, loadLines, loadStations, pick, type Station } from '../core/data';
import { PodViewer } from '../pod/pod';
import { CARD_INSET_EVENT, interactButton, launchInteract, type CardInset } from '../ui/card';
import { h, store, toast } from '../ui/dom';
import { icons } from '../ui/icons';

/** V2 "Station Gallery": swipe through every station as a photoreal pod with its card. */
export async function runGallery(root: HTMLElement) {
  document.title = 'Walk the Event · Stations';
  document.head.append(h('style', {}, CSS));
  const [stations, lines] = await Promise.all([loadStations(), loadLines()]);
  const L = lines.presets[store('wte.preset') || 'hype'] ?? lines.presets.hype;
  const pod = new PodViewer(root);
  pod.setInset(0, innerWidth >= 900 ? 0 : innerHeight * 0.3);
  const top = h('div', { class: 'topbar' },
    h('a', { class: 'brand', href: BASE }, h('b', { html: 'Walk the <i>Event</i>' }), h('span', {}, 'Stations')),
    h('div', { class: 'spacer' }),
    h('a', { class: 'icon-btn', href: `${BASE}map/`, 'aria-label': 'Map', html: icons.map }),
    h('a', { class: 'icon-btn', href: BASE, 'aria-label': 'Back to the walk', html: icons.close }));
  const sheet = h('section', { class: 'gal-sheet', 'aria-live': 'polite' });
  const say = h('div', { class: 'gal-say' });
  const dots = h('div', { class: 'gal-dots', role: 'tablist' });
  const prev = h('button', { class: 'icon-btn gal-prev', 'aria-label': 'Previous station', html: icons.back });
  const next = h('button', { class: 'icon-btn gal-next', 'aria-label': 'Next station', html: icons.back });
  root.append(top, say, prev, next, sheet, dots);
  // keep the 3D photo centred above the compact sheet on phones (desktop: the panel floats over a corner)
  const measure = () => requestAnimationFrame(() => {
    const bottom = innerWidth >= 900 ? 0 : Math.min(sheet.offsetHeight, innerHeight * 0.42);
    root.style.setProperty('--sheet-top', `${innerHeight - sheet.getBoundingClientRect().top}px`);
    dispatchEvent(new CustomEvent<CardInset>(CARD_INSET_EVENT, { detail: { right: 0, bottom } }));
  });
  addEventListener('resize', () => measure());
  let i = Math.max(0, stations.findIndex((s) => `#${s.id}` === location.hash));
  stations.forEach((s, k) => dots.append(h('button', { role: 'tab', 'aria-label': s.title, onclick: () => show(k) })));
  let first = true;
  const show = (k: number) => {
    const dir = first ? 0 : k > i ? 1 : -1;
    first = false;
    i = (k + stations.length) % stations.length;
    const s: Station = stations[i];
    history.replaceState(null, '', `#${s.id}`);
    pod.open(s, dir);
    // warm the neighbours' photos so the next swipe crossfades instantly
    for (const d of [1, -1]) { const n = stations[(i + d + stations.length) % stations.length]; const im = new Image(); im.src = asset(n.hero_url); }
    dots.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    const by = [s.artist, s.year].filter(Boolean).join(', ');
    sheet.innerHTML = '';
    const more = h('div', { class: 'gal-body' }, h('p', { class: 'body' }, s.body), h('div', { class: 'src' }, `Source: ${s.body_source}.`));
    more.hidden = true;
    const label = h('span', {}, 'Read the wall card');
    const toggle = h('button', { class: 'gal-more', 'aria-expanded': 'false' }, label, h('i', { html: icons.back }));
    toggle.addEventListener('click', () => {
      more.hidden = !more.hidden;
      toggle.setAttribute('aria-expanded', String(!more.hidden));
      label.textContent = more.hidden ? 'Read the wall card' : 'Show less';
      measure();
    });
    const share = () => { const url = `${location.origin}${location.pathname}#${s.id}`; if (navigator.share) navigator.share({ title: s.title, url }).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => toast('Link copied')); };
    sheet.append(
      h('div', { class: 'eyebrow' }, `${String(i + 1).padStart(2, '0')} / ${String(stations.length).padStart(2, '0')}${s.offscreen ? ' · seen in photos' : ''}`),
      h('h2', {}, s.title),
      by ? h('div', { class: 'by' }, by) : '',
      h('p', { class: 'one' }, s.one_liner),
      toggle,
      more,
      h('div', { class: 'actions' },
        interactButton(s, (b) => { void launchInteract(s, b); }),
        h('a', { class: 'btn round', href: `${BASE}#station-${s.id}`, 'aria-label': 'See it in the walk', title: 'See it in the walk', html: icons.walk }),
        h('button', { class: 'btn round', 'aria-label': 'Share', title: 'Share', onclick: share, html: icons.share })),
    );
    measure();
    say.innerHTML = '';
    say.append(h('img', { class: 'gal-ava', src: asset('media/guide/hermes-front.png'), alt: '' }), h('span', {}, pick(L.stations[s.id]?.open ?? [s.one_liner])));
    say.classList.remove('on');
    void say.offsetWidth;
    say.classList.add('on');
  };
  prev.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => show(i + 1));
  addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  let sx = 0, sy = 0;
  root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    // a drag on the 3D photo turns it (pod), so stations are swiped on the sheet
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(e.target as HTMLElement).closest('.pod-layer')) show(i + (dx < 0 ? 1 : -1));
  }, { passive: true });
  show(i);
}

const CSS = `
body { touch-action: pan-y; }
.gal-sheet { position: absolute; z-index: 9; left: 0; right: 0; bottom: 0; max-height: 72vh; overflow: auto; touch-action: pan-y; padding: 16px calc(18px + var(--safe-r)) calc(46px + var(--safe-b)) calc(18px + var(--safe-l)); background: linear-gradient(180deg, rgba(22, 14, 32, 0.72), rgba(9, 6, 14, 0.9) 96px), rgba(9, 6, 14, 0.5); backdrop-filter: blur(24px) saturate(1.35); -webkit-backdrop-filter: blur(24px) saturate(1.35); border-top: 1px solid rgba(255, 255, 255, 0.14); border-radius: 24px 24px 0 0; box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.45); }
.gal-sheet .eyebrow { font-size: 10px; letter-spacing: .22em; text-transform: uppercase; font-weight: 800; color: var(--pink); }
.gal-sheet h2 { font-family: var(--serif); font-weight: 400; font-size: clamp(30px, 8vw, 44px); line-height: .98; margin: 4px 0 3px; }
.gal-sheet .by { color: var(--paper-dim); font-weight: 600; font-size: 13px; }
.gal-sheet .one { font-size: 14.5px; line-height: 1.42; max-width: 46ch; margin: 8px 0 0; font-weight: 500; }
.gal-sheet .body { font-size: 14.5px; line-height: 1.6; color: rgba(246,243,238,.84); max-width: 60ch; margin: 6px 0 0; user-select: text; -webkit-user-select: text; }
.gal-sheet .src { font-size: 11px; color: var(--paper-dim); margin-top: 6px; font-style: italic; }
.gal-more { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 4px 0; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; font-weight: 800; color: var(--paper-dim); }
.gal-more i svg { width: 12px; height: 12px; display: block; transform: rotate(-90deg); transition: transform .3s var(--ease); }
.gal-more[aria-expanded='true'] i svg { transform: rotate(90deg); }
.gal-sheet .actions { flex-wrap: nowrap; margin-top: 12px; align-items: center; }
.gal-dots { position: absolute; z-index: 10; bottom: calc(18px + var(--safe-b)); left: 50%; transform: translateX(-50%); display: flex; gap: 8px; }
.gal-dots button { width: 8px; height: 8px; border-radius: 50%; background: var(--paper-faint); transition: all .3s; }
.gal-dots button[aria-selected='true'] { width: 26px; border-radius: 8px; background: var(--pink); }
.gal-prev, .gal-next { position: absolute; z-index: 10; top: 40%; }
.gal-prev { left: calc(12px + var(--safe-l)); } .gal-next { right: calc(12px + var(--safe-r)); transform: scaleX(-1); }
.gal-say { position: absolute; z-index: 10; top: calc(112px + var(--safe-t)); right: calc(16px + var(--safe-r)); max-width: min(290px, 74vw); display: flex; gap: 10px; align-items: flex-start; font: 500 13px/1.5 var(--mono); letter-spacing: -0.01em; color: var(--cyan); text-shadow: 0 0 1px rgba(0,10,14,.95), 0 1px 2px rgba(0,6,10,.95), 0 0 5px rgba(0,4,8,.8), 0 0 12px rgba(0,4,8,.55), 0 0 22px rgba(0,4,8,.35); opacity: 0; transform: translateY(-4px); transition: opacity .3s ease, transform .35s var(--ease); pointer-events: none; }
.gal-say.on { opacity: 1; transform: none; }
.gal-say span { position: relative; padding-left: 2ch; }
.gal-say span::before { content: '>'; position: absolute; left: 0; color: rgba(127,246,255,.55); }
.gal-ava { width: 30px; height: 30px; object-fit: cover; object-position: 50% 4%; flex: none; border-radius: 50%; background: #f3efe8; border: 1px solid rgba(127,246,255,.6); box-shadow: 0 0 10px rgba(127,246,255,.25); }
.topbar { z-index: 11; }
/* the speech bubble owns the top right here: the 3D-photo hints sit just above the sheet instead */
.pod-hints { bottom: calc(var(--sheet-top, 260px) + 12px); }
.topbar a.icon-btn { display: grid; place-items: center; text-decoration: none; }
@media (min-width: 900px) {
  .gal-sheet { right: auto; left: 24px; bottom: 56px; width: 380px; max-height: calc(100vh - 170px); border-radius: 22px; border: 1px solid rgba(255,255,255,.13); padding: 20px 22px; }
  .gal-sheet h2 { font-size: 40px; }
}
`;
