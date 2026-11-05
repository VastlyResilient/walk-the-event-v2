import type { Station } from '../core/data';

export interface Answer { text: string; link?: { label: string; hash: string } }

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ');
const ALIASES: Record<string, string[]> = {
  'led-camera-screens': ['led', 'camera', 'portrait', 'self portrait', 'gilded', 'frame', 'mirror', 'joshua', 'wolk', 'face', 'museum', 'come closer'],
  tvs: ['tv', 'tvs', 'mandala', 'kevin', 'esherick', 'sandbox', 'wiped', 'hash', 'six screens', 'wall of screens'],
  'projector-screens': ['projector', 'projection', 'glyph', 'shape of everything', 'jteve', 'sobs', 'sound', 'audiovisual'],
  'space-screen': ['space', 'solar', 'planet', 'orbit', 'hermes journey', 'journey', 'skills', 'memories', 'touch'],
  merch: ['merch', 'shirt', 'tee', 't-shirt', 'tshirt', 'swag', 'banner', 'rebellion', 'tyrants', 'wave'],
  'cpu-terminals': ['cpu', 'terminal', 'computer', 'airgap', 'air gap', 'persistence', 'morry', 'kolman', 'firewall', 'laptop', 'thermal'],
};

export function localAnswer(q: string, stations: Station[], fallback: string): Answer {
  const n = norm(q);
  if (/\b(upstairs|second floor|stairs|disco|balcony|plants?)\b/.test(n)) {
    return { text: 'Upstairs has no stations, just the good stuff: a blue staircase, a long glowing corridor, a disco floor and a balcony over the atrium.', link: { label: 'Take me upstairs', hash: '#floor-up' } };
  }
  if (/\b(how many|list|all|which|what) (stations|exhibits|works|pieces)\b|\bstations\b/.test(n) && !stations.some((s) => scoreFor(n, s) > 1)) {
    return { text: `Six stations downstairs: ${stations.map((s) => s.title).join(', ')}. Tap any glowing spot as we pass.`, link: { label: 'Show the map', hash: '#map' } };
  }
  let best: Station | null = null, bs = 0;
  for (const s of stations) { const sc = scoreFor(n, s); if (sc > bs) { bs = sc; best = s; } }
  if (best && bs > 0) {
    const who = best.artist && best.artist !== 'Nous Research' ? `${best.title} is by ${best.artist}${best.year ? ` (${best.year})` : ''}. ` : `${best.title}. `;
    const wantsWho = /\bwho\b|artist|made|created/.test(n);
    const body = wantsWho ? best.one_liner : firstSentences(best.body, 2);
    return { text: `${who}${body}`, link: { label: `Take me to ${best.title}`, hash: `#station-${best.id}` } };
  }
  return { text: fallback };
}

function scoreFor(n: string, s: Station) {
  let sc = 0;
  for (const a of ALIASES[s.id] ?? []) if (n.includes(a)) sc += a.length > 4 ? 2 : 1;
  for (const w of norm(s.title).split(' ')) if (w.length > 3 && n.includes(w)) sc += 2;
  return sc;
}

function firstSentences(t: string, k: number) {
  const parts = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  return parts.slice(0, k).join(' ').trim();
}

/** Ask the server proxy (Nous Hermes on OpenRouter, grounded in stations.json); fall back locally. */
export async function ask(q: string, stations: Station[], fallback: string): Promise<Answer> {
  const local = localAnswer(q, stations, fallback);
  const endpoint = (import.meta.env.VITE_ASK_URL as string | undefined) ?? '';
  if (!endpoint) return local;
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }), signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return local;
    const j = await r.json();
    if (!j.text) return local;
    return { text: j.text, link: j.station ? { label: 'Take me there', hash: `#station-${j.station}` } : local.link };
  } catch {
    return local;
  }
}
