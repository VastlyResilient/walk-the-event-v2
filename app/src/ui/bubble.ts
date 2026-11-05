import { h } from './dom';

/**
 * The guide's captions: terminal-style text typed out next to her head (no box), a "> " prompt and a blinking block
 * cursor while she types. Same look for every personality (the personality changes the words, not the style).
 */
export class Bubble {
  el = h('div', { class: 'bubble' });
  /** screen readers get each line once, whole (the typed-out copy is hidden from them) */
  private sr = h('span', { class: 'sr', role: 'status', 'aria-live': 'polite' });
  private line = h('span', { class: 'line', 'aria-hidden': 'true' });
  private typed = document.createTextNode('');
  private caret = h('span', { class: 'caret' });
  private ghost = h('span', { class: 'ghost' });
  private text = '';
  private shown = 0;
  private drawn = -1;
  private until = 0;
  private typing = false;
  private bw = 0;
  private bh = 0;
  private x = -999;
  private y = -999;
  /** kept for callers; every style renders as the terminal caption */
  style: 'default' | 'hacker' = 'default';
  onTalking: (on: boolean) => void = () => {};
  instant = false;

  constructor(parent: HTMLElement) {
    this.line.append(h('span', { class: 'prompt' }, '>'), this.typed, this.caret, this.ghost);
    this.el.append(this.sr, this.line);
    parent.append(this.el);
    addEventListener('resize', () => { if (this.visible) { this.bw = this.el.offsetWidth; this.bh = this.el.offsetHeight; } });
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.typing) { this.shown = this.text.length; } else this.hide();
    });
  }

  say(text: string, hold = 3.5) {
    // some lines carry their own prompt (the caption draws one); keep "9 m" / "2 min" together on one line
    text = text.replace(/^\s*>\s*/, '').replace(/(\d) (?=(m|s|min|ft)\b)/g, '$1\u00a0');
    this.text = text;
    this.shown = this.instant ? text.length : 0;
    this.drawn = -1;
    this.typing = true;
    this.until = performance.now() / 1000 + text.length * 0.028 + hold;
    this.el.dataset.style = this.style;
    this.el.classList.add('on', 'typing');
    this.sr.textContent = text;
    this.onTalking(true);
    this.render();
    // the untyped rest is laid out invisibly, so the caption has its final size from the first letter: measure once
    this.bw = this.el.offsetWidth;
    this.bh = this.el.offsetHeight;
  }

  hide() {
    this.el.classList.remove('on', 'typing');
    this.typing = false;
    this.onTalking(false);
    this.until = 0;
  }

  get visible() { return this.el.classList.contains('on'); }

  /** text-only updates (no node churn, no layout reads): typed part, the zero-width cursor, the invisible rest */
  private render() {
    const n = Math.floor(this.shown);
    if (n === this.drawn) return;
    this.drawn = n;
    this.typed.data = this.text.slice(0, n);
    this.ghost.textContent = this.text.slice(n);
  }

  update(dt: number, anchor: { x: number; y: number } | null, W: number, H: number, avoid: { left: number; top: number; right: number; bottom: number }[] = []) {
    const now = performance.now() / 1000;
    if (this.typing) {
      this.shown += dt * 46;
      if (this.shown >= this.text.length) { this.shown = this.text.length; this.typing = false; this.el.classList.remove('typing'); this.onTalking(false); }
      this.render();
    }
    if (this.until && now > this.until) this.hide();
    if (!this.visible) return;
    const bw = this.bw, bh = this.bh;
    let ax = anchor ? anchor.x : W * 0.5, ay = anchor ? anchor.y : H * 0.55;
    ay = Math.max(ay, bh + 90);
    const tx = Math.max(16, Math.min(W - bw - 38, ax - bw * 0.35));
    let ty = Math.max(70, Math.min(H - bh - 140, ay - bh - 18));
    let tx2 = tx;
    // Never sit on a station tag or on her face: try above, then slide sideways.
    const head = anchor ? { l: ax - 55, r: ax + 55, t: ay - 4, b: ay + 130 } : null;
    const hits = (x: number, y: number) =>
      avoid.some((r) => r.right > r.left && !(x + bw < r.left - 8 || x > r.right + 8 || y + bh < r.top - 8 || y > r.bottom + 8)) ||
      (!!head && !(x + bw < head.l || x > head.r || y + bh < head.t || y > head.b));
    if (hits(tx2, ty)) {
      const cands: [number, number][] = [];
      for (const r of avoid) cands.push([tx2, r.top - bh - 14]);
      cands.push([Math.max(16, ax - bw - 40), ty], [Math.min(W - bw - 38, ax + 40), ty]);
      for (const r of avoid) { cands.push([Math.max(16, r.left - bw - 12), ty], [Math.min(W - bw - 38, r.right + 12), ty]); }
      const ok = cands.find(([x, y]) => y >= 66 && y + bh <= H - 130 && !hits(x, y));
      if (ok) [tx2, ty] = ok;
    }
    // ease toward the target so the bubble glides with her head
    this.x = this.x < -900 ? tx2 : this.x + (tx2 - this.x) * Math.min(1, dt * 14);
    this.y = this.y < -900 ? ty : this.y + (ty - this.y) * Math.min(1, dt * 14);
    this.el.style.left = `${this.x}px`;
    this.el.style.top = `${this.y}px`;
    const tail = Math.max(18, Math.min(bw - 18, ax - this.x));
    this.el.style.setProperty('--tx', `${tail}px`);
  }
}
