// "Ask Hermes" proxy: answers visitor questions with a Nous Hermes model on OpenRouter, grounded ONLY in
// the station cards and walk beats. The key stays server-side. Deploy anywhere Node 20+ runs (Railway: `railway up`).
//   OPENROUTER_API_KEY=... PORT=8787 ALLOW_ORIGIN=https://<your-site> node server/server.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';

const KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOW_ORIGIN || '*';
const MODEL = process.env.ASK_MODEL || 'nousresearch/hermes-4-405b';
const FALLBACK_MODEL = 'nousresearch/hermes-3-llama-3.1-70b';
const here = new URL('.', import.meta.url);
const stations = JSON.parse(readFileSync(new URL('../app/public/data/stations.json', here))).stations;
const beats = ['downstairs', 'upstairs'].map((f) => JSON.parse(readFileSync(new URL(`../app/public/data/beats_${f}.json`, here))));

const facts = [
  'STATIONS (downstairs). Use only these facts:',
  ...stations.map((s) => `- id=${s.id} | ${s.title}${s.artist ? ` by ${s.artist}` : ''}${s.year ? ` (${s.year})` : ''}: ${s.body} Highlights: ${s.highlights.join('; ')}.`),
  'CHAPTERS:',
  ...beats.flatMap((b) => b.chapters.map((c) => `- ${b.video} / ${c.id}: ${c.title}: ${c.blurb}`)),
].join('\n');
const SYSTEM = `You are the Hermes guide for "Walk the Event", a recap of NousCon NYC 2026. Answer in 1-3 short, warm, slightly playful sentences.
Only use the facts below. If the answer is not in them, say plainly that it is not in your notes (do not speculate or guess where to look) and suggest one station. Never invent artists, dates, numbers or details.
If the question is about one station, end your reply with a line "STATION: <id>".\n\n${facts}`;

const hits = new Map();
function limited(ip) {
  const now = Date.now(), w = (hits.get(ip) || []).filter((t) => now - t < 60000);
  w.push(now); hits.set(ip, w);
  return w.length > 12;
}

async function askModel(model, q) {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Walk the Event' },
    body: JSON.stringify({ model, max_tokens: 220, temperature: 0.4, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }] }),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || '';
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  if (req.url === '/health') return res.end('ok');
  if (req.method !== 'POST' || req.url !== '/ask') { res.statusCode = 404; return res.end(); }
  if (limited(req.socket.remoteAddress)) { res.statusCode = 429; return res.end('{}'); }
  let body = '';
  for await (const c of req) { body += c; if (body.length > 2000) break; }
  try {
    const q = String(JSON.parse(body).q || '').slice(0, 240);
    if (!q || !KEY) throw new Error('bad request');
    let text;
    try { text = await askModel(MODEL, q); } catch { text = await askModel(FALLBACK_MODEL, q); }
    const m = text.match(/STATION:\s*([a-z-]+)/);
    text = text.replace(/STATION:\s*[a-z-]+/, '').trim();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ text, station: m && stations.some((s) => s.id === m[1]) ? m[1] : null }));
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}).listen(PORT, () => console.log(`ask proxy on :${PORT} using ${MODEL}`));
