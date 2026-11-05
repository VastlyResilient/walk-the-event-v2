export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) (el as any)[k.toLowerCase()] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
}
export function toast(msg: string) {
  let t = document.querySelector<HTMLDivElement>('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout((t as any)._h);
  (t as any)._h = setTimeout(() => t!.classList.remove('on'), 2200);
}
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || localStorage.getItem('wte.reduced') === '1';
export function store(k: string, v?: string) {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ }
  return null;
}

/** Panels that slide away instead of unmounting: while they aren't `.on`, nothing in them takes focus or Tab stops. */
export function inertUnlessOn(el: HTMLElement) {
  const sync = () => { el.inert = !el.classList.contains('on'); };
  sync();
  new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] });
}
