import '../styles.css';
import { BASE } from '../core/data';
import { h } from '../ui/dom';

/** V4 "World Mode" did not pass the art-director gate, so it is hidden (see docs/DECISIONS.md). */
export async function runLab(root: HTMLElement) {
  document.title = 'Walk the Event · Lab';
  root.append(h('div', { class: 'outro on', style: 'background:#07050b' }, h('div', { class: 'inner' },
    h('h2', { html: 'World mode <em>is resting</em>.' }),
    h('p', {}, 'Free-roam reconstructions of the venue looked like a scan, not like the night: smeared walls, floating people and a point-cloud feel. The real footage stays the hero, so this experiment is switched off.'),
    h('p', {}, 'The station pods are the 3D layer that made the cut.'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: BASE }, 'Back to the walk'),
      h('a', { class: 'btn', href: `${BASE}stations/` }, 'See the pods')),
  )));
}
