import { ask } from '../ask/answer';
import type { Station } from '../core/data';
import { h } from './dom';
import { icons } from './icons';

export class AskDrawer {
  el = h('section', { class: 'drawer', role: 'dialog', 'aria-label': 'Ask Hermes' });
  private msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  private input = h('input', { type: 'text', placeholder: 'Ask about a station…', 'aria-label': 'Your question', enterkeyhint: 'send', maxlength: 240 }) as HTMLInputElement;
  onAnswer: (text: string) => void = () => {};
  onLink: (hash: string) => void = () => {};
  fallback = "That's not in my notes. Ask me about a station instead!";

  constructor(parent: HTMLElement, public stations: Station[]) {
    const form = h('form', { class: 'askrow' }, this.input, h('button', { class: 'btn pink', type: 'submit' }, 'Ask'));
    form.addEventListener('submit', (e) => { e.preventDefault(); this.send(this.input.value); });
    this.el.append(
      h('button', { class: 'icon-btn close', 'aria-label': 'Close', html: icons.close, onclick: () => this.close() }),
      h('h3', {}, 'Ask Hermes'),
      h('div', { class: 'sub' }, 'Answers come only from the station cards and what was on show.'),
      this.msgs,
      h('div', { class: 'suggest' }, ...['Who made Self Portrait?', 'What is Persistence 2?', 'Take me to the merch', "What's upstairs?"].map((q) => h('button', { type: 'button', onclick: () => this.send(q) }, q))),
      form,
    );
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('wheel', (e) => e.stopPropagation());
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    parent.append(this.el);
  }

  open(prefill?: string) {
    this.el.classList.add('on');
    if (prefill) this.send(prefill);
    else setTimeout(() => this.input.focus({ preventScroll: true }), 300);
  }
  close() { this.el.classList.remove('on'); this.input.blur(); }
  get isOpen() { return this.el.classList.contains('on'); }

  async send(q: string) {
    q = q.trim();
    if (!q) return;
    this.input.value = '';
    this.msgs.append(h('div', { class: 'msg me' }, q));
    const typing = h('div', { class: 'msg her' }, '…');
    this.msgs.append(typing);
    this.msgs.scrollTop = 1e6;
    const a = await ask(q, this.stations, this.fallback);
    typing.textContent = a.text;
    if (a.link) {
      const go = h('button', { class: 'go', type: 'button' }, a.link.label);
      go.addEventListener('click', () => { this.close(); this.onLink(a.link!.hash); });
      typing.append(h('br'), go);
    }
    this.msgs.scrollTop = 1e6;
    this.onAnswer(a.text);
  }
}
