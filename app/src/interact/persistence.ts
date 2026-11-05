import './persistence.css';
import { h, reducedMotion } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { btn, fit, ico, loop, onResize } from './common';

/*
 * "Persistence 2" (Morry Kolman), interpreted. From the wall card: two computers kept apart by a hard firewall, no
 * wireless, and no microphones / cameras / speakers / screens to talk through, try to ESTABLISH CONTACT using only
 * their own bodies — "their (quite literal) own devices" — running agent skills loaded with "data smuggling and
 * airgap jumping techniques from state of the art security research". On screen (photo) a Hermes agent hardens a
 * thermal "flare" detector; status bar reads "Establish contact to share and decrypt messages".
 *
 * This interpretive recreation (NOT the artist's code) makes those sentences playable:
 *  - "their own devices / airgap jumping techniques" -> four covert channels, each a REAL published air-gap research
 *    category, each using only the machine's own hardware: thermal (BitWhisper), fan/acoustic (Fansmitter), power
 *    line (PowerHammer), memory-bus RF (GSMem). Each shows its live signal, bit rate and bit-error rate; the visitor
 *    can let the agents discover the best one, or tap a channel to force it.
 *  - "they must take the arbitrary noise around them as potential signal" -> a room-noise control and tap-to-disturb;
 *    noise raises the error rate, trips false positives in Hermes' log, and can break a channel so the agents hop.
 *  - "understanding how their own lossy communication may be interpreted" -> a visible handshake: probe, lock a
 *    preamble, establish contact, then decrypt. Communication is lossy at first (errors corrected by a repetition
 *    code) and the bit-error rate falls as the agents "learn" across messages — they grow a new language.
 *  - "a duet performance" -> both directions: B answers A on the same channel, both agents' terminal logs in the
 *    Hermes style of the photo.
 */

const IDLE_STATUS = 'Establish contact to share and decrypt messages';
const PREAMBLE = [1, 0, 1, 0, 1, 1, 0, 1];
const LOCK_BER = 0.17;   // a channel can carry a preamble below this error rate
const DROP_BER = 0.32;   // above this, an established channel is lost to noise
const key = (i: number) => (0xa7 * (i + 1) + 0x3d) & 0xff; // shared keystream (pre-agreed in both agents' skills)

function gauss() { return Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random()); }
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface Channel {
  id: string;
  name: string;      // short label
  code: string;      // real research codename + mechanism
  unit: string;
  color: string;     // 'r,g,b'
  rate: number;      // flare slots per second
  base: number;      // idle display value
  peak: number;      // display value for a '1'
  lo: number; hi: number; // graph range
  tau: number;       // emitter settle time (s) — slow = robust/slow, fast = lossy/fast
  coupling: number;  // how much of the emission leaks across the firewall
  noiseAmp: number;  // sensor noise floor (display units)
  noiseSens: number; // how much room noise hurts this channel
  baseBer: number;   // intrinsic error rate at zero room noise, before learning
  learnGain: number; // how much each learned message lowers the error rate
  // runtime
  emit: number; sense: number; sbase: number;
  he: number[]; hs: number[]; marks: { t: number; v: number; bit: number }[];
  learn: number; estBer: number;
}

function makeChannels(): Channel[] {
  const def = (c: Partial<Channel> & Pick<Channel, 'id' | 'name' | 'code' | 'unit' | 'color' | 'rate' | 'base' | 'peak' | 'lo' | 'hi' | 'tau' | 'coupling' | 'noiseAmp' | 'noiseSens' | 'baseBer' | 'learnGain'>): Channel => ({
    emit: 0, sense: c.base, sbase: c.base, he: [], hs: [], marks: [], learn: 0, estBer: 0.5, ...c,
  });
  return [
    def({ id: 'thermal', name: 'Thermal', code: 'BitWhisper · CPU heat → temp sensor', unit: '°C', color: '255,79,191', rate: 5, base: 24.1, peak: 26.9, lo: 23.3, hi: 27.8, tau: 0.13, coupling: 0.82, noiseAmp: 0.05, noiseSens: 0.55, baseBer: 0.035, learnGain: 0.028 }),
    def({ id: 'fan', name: 'Acoustic', code: 'Fansmitter · fan RPM / vibration', unit: 'RPM', color: '255,179,107', rate: 9, base: 1210, peak: 1590, lo: 1120, hi: 1660, tau: 0.05, coupling: 0.8, noiseAmp: 10, noiseSens: 1.0, baseBer: 0.06, learnGain: 0.03 }),
    def({ id: 'power', name: 'Power-line', code: 'PowerHammer · conducted current', unit: 'W', color: '141,255,183', rate: 14, base: 11, peak: 39, lo: 7, hi: 43, tau: 0.02, coupling: 0.8, noiseAmp: 1.1, noiseSens: 1.4, baseBer: 0.075, learnGain: 0.032 }),
    def({ id: 'em', name: 'EM mem-bus', code: 'GSMem · memory-bus emission', unit: 'dBμV', color: '166,180,255', rate: 22, base: 2, peak: 12, lo: -5, hi: 16, tau: 0.008, coupling: 0.78, noiseAmp: 1.6, noiseSens: 2.3, baseBer: 0.14, learnGain: 0.035 }),
  ];
}

export function mount(ctx: IxCtx): Ix {
  const { stage, dock, signal } = ctx;
  const reduced = ctx.reduced || reducedMotion();
  stage.classList.add('ps');

  const channels = makeChannels();
  let active = 0;               // index of the channel carrying contact
  let dir: 0 | 1 = 0;          // 0 = A→B, 1 = B→A
  let roomNoise = 0;           // 0..1 from the slider
  let autoDuet = true;
  let autoChannel = true;      // agents pick the channel (vs visitor forcing one)

  // ---------- DOM: two machines + firewall/rack between them ----------
  const machine = (i: number) => {
    const letter = i === 0 ? 'A' : 'B';
    const coresEl = h('div', { class: 'ps-cores' });
    const cores = Array.from({ length: 8 }, () => { const b = h('i'); coresEl.append(h('span', {}, b)); return b; });
    const g = h('canvas', { class: 'ps-graph' }) as HTMLCanvasElement;
    const temp = h('b', { class: 'ps-temp' }, '—');
    const roleEl = h('small', { class: 'ps-role' }, '');
    const glab = h('small', { class: 'ps-glab' }, '');
    const log = h('div', { class: 'ps-log' });
    const out = h('div', { class: 'ps-out', 'aria-live': 'polite' }, h('span', { class: 'ph' }, 'nothing received yet'));
    const bits = h('div', { class: 'ps-bits' });
    const sec = h('section', { class: `ps-m ${letter.toLowerCase()}` },
      h('header', {}, h('i', { class: 'led' }), h('div', {}, h('b', {}, `Machine ${letter}`), roleEl), temp),
      h('div', { class: 'ps-row' }, h('small', {}, 'CPU load'), coresEl),
      h('div', { class: 'ps-gwrap' }, glab, g),
      bits, out, log);
    return { sec, g, temp, roleEl, glab, log, out, bits, cores };
  };
  const A = machine(0), B = machine(1), M = [A, B];

  // channel rack (the "own devices" the agents reach for)
  const rack = h('div', { class: 'ps-rack', role: 'tablist', 'aria-label': 'Covert channels' });
  const chEls = channels.map((c, i) => {
    const spark = h('canvas', { class: 'ps-spark' }) as HTMLCanvasElement;
    const berBar = h('i');
    const b = h('button', { class: 'ps-ch', role: 'tab', 'data-i': String(i), 'aria-label': `${c.name} channel — ${c.code}` },
      h('div', { class: 'ps-ch-h' }, h('i', { class: 'ps-ch-led' }), h('b', {}, c.name), h('u', { class: 'ps-ch-rate' }, '')),
      h('small', { class: 'ps-ch-code' }, c.code),
      spark,
      h('div', { class: 'ps-ch-ber' }, h('span', {}, 'BER'), h('div', { class: 'ps-ch-berbar' }, berBar), h('em', {}, '')));
    rack.append(b);
    return { b, spark, berBar, berTxt: b.querySelector('em')!, led: b.querySelector('.ps-ch-led')!, rate: b.querySelector('.ps-ch-rate')!, ctx: spark.getContext('2d')! };
  });

  const fwC = h('canvas', { class: 'ps-fwc' }) as HTMLCanvasElement;
  const fw = h('div', { class: 'ps-fw' }, fwC,
    h('div', { class: 'ps-fwl' }, h('b', {}, 'Hard firewall'), h('small', {}, 'no wireless · no mic · no camera · no speaker · no screen')));
  const mid = h('div', { class: 'ps-mid' }, fw, rack);

  // focus switch (used on small stages where only one pane shows at a time)
  const focusSeg = h('div', { class: 'ps-focus ix-seg', role: 'tablist', 'aria-label': 'Show pane' },
    h('button', { 'data-f': '0', 'aria-pressed': 'true' }, 'Machine A'),
    h('button', { 'data-f': '1', 'aria-pressed': 'false' }, 'Machine B'),
    h('button', { 'data-f': '2', class: 'ps-ch-tab', 'aria-pressed': 'false' }, 'Channels'));

  const status = h('div', { class: 'ps-status' }, h('i'), h('span', {}, IDLE_STATUS));
  const statusT = status.querySelector('span')!;
  stage.append(h('div', { class: 'ps-wrap' }, A.sec, mid, B.sec, focusSeg), status);

  const note = h('p', { class: 'ps-credit' }, 'Interpretive simulation · channel names are real published air-gap research');
  stage.append(note);

  // ---------- dock controls ----------
  const dirSeg = h('div', { class: 'ix-seg ps-dir', role: 'tablist', 'aria-label': 'Direction' },
    h('button', { 'data-d': '0', 'aria-pressed': 'true' }, 'A→B'),
    h('button', { 'data-d': '1', 'aria-pressed': 'false' }, 'B→A'));
  const input = h('input', { class: 'ps-input', type: 'text', maxlength: '14', size: '1', placeholder: 'text for B', 'aria-label': 'Message to send (up to 14 characters)', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send' }) as HTMLInputElement;
  const send = btn('Send', { cls: 'pink ps-send', icon: ico.send, aria: 'Send the message over the channel' });
  const compose = h('div', { class: 'ps-compose' }, dirSeg, input, send);

  const noise = h('input', { class: 'ps-noise', type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Room noise' }) as HTMLInputElement;
  const noiseWrap = h('label', { class: 'ps-noisewrap' }, h('span', {}, 'Room noise'), noise, h('u', {}, 'quiet'));
  const noiseTxt = noiseWrap.querySelector('u')!;
  const disturb = btn('Disturb', { cls: 'round2 ps-disturb', icon: ico.flame, aria: 'Inject a thermal transient near the listener' });
  const duetBtn = btn('Duet', { cls: 'ps-duet', aria: 'Let B answer A automatically' });
  duetBtn.setAttribute('aria-pressed', 'true');
  const autoBtn = btn('Auto', { cls: 'ps-auto', aria: 'Let the agents choose the channel' });
  autoBtn.setAttribute('aria-pressed', 'true');
  const tools = h('div', { class: 'ps-tools' }, noiseWrap, disturb, duetBtn, autoBtn);
  dock.append(compose, tools);

  // ---------- logging ----------
  const log = (el: HTMLElement, t: string, cls = '') => {
    el.append(h('div', { class: cls }, t));
    while (el.childElementCount > 40) el.firstElementChild!.remove();
    el.scrollTop = el.scrollHeight;
  };
  const logEmit = (t: string, cls = '') => log(M[dir].log, t, cls);
  const logRecv = (t: string, cls = '') => log(M[dir ? 0 : 1].log, t, cls);
  log(A.log, '$ skills load airgap/{thermal,fan,power,em}', 'cmd');
  log(A.log, '  no network · no audio · no display link', '');
  log(B.log, 'hermes ▸ scanning for a carrier', 'cmd');

  // ---------- a clock-driven scheduler (pauses with the loop; nothing to leak) ----------
  let clock = 0;
  let queue: { at: number; fn: () => void }[] = [];
  const after = (d: number, fn: () => void) => queue.push({ at: clock + d, fn });
  const drain = () => {
    if (!queue.length) return;
    const due = queue.filter((q) => q.at <= clock);
    if (!due.length) return;
    queue = queue.filter((q) => q.at > clock);
    for (const q of due) q.fn();
  };

  // ---------- transmit / receive state ----------
  type Phase = 'discovery' | 'ready' | 'tx';
  let phase: Phase = 'discovery';
  let txFrame: number[] = [];
  let txIntended: string = '';     // truth, used only to show where lossy decode diverged + healed
  let txT = -1;                    // seconds into the current frame; -1 = not emitting
  let txSlot = 1 / channels[0].rate;

  // decoder
  let rx: 'idle' | 'sync' | 'data' = 'idle';
  let delivered = false, lostInRow = 0;
  let rxT0 = 0, rxIdx = 0, rxRaw: number[] = [], rxBits: number[] = [], rxText = '', rxLen = 0, rxErr = 0;
  const LAG = 0.03;

  const byteBits = (b: number) => Array.from({ length: 8 }, (_, k) => (b >> (7 - k)) & 1);
  const rep3 = (bits: number[]) => bits.flatMap((x) => [x, x, x]);

  function effBer(c: Channel) {
    return clamp(c.baseBer + roomNoise * c.noiseSens * 0.22 - c.learn * c.learnGain, 0.004, 0.5);
  }

  function setStatus(txt: string, cls = '') {
    statusT.textContent = txt;
    status.className = 'ps-status' + (cls ? ' ' + cls : '');
  }

  function placeholders() {
    const from = dir === 0 ? 'A' : 'B', to = dir === 0 ? 'B' : 'A';
    input.placeholder = input.clientWidth && input.clientWidth < 120 ? `to ${to}` : `text for ${to}`; // a narrow dock clipped the long hint
    input.setAttribute('aria-label', `Message for ${from} to send (up to 14 characters)`);
  }

  // ---- discovery / handshake: probe every channel, lock the best, establish contact ----
  function beginHandshake(reason?: string) {
    phase = 'discovery';
    rx = 'idle';
    txT = -1;
    for (const c of channels) c.marks.length = 0;
    send.disabled = true;
    setStatus(IDLE_STATUS, '');
    if (reason) { log(A.log, reason, 'warn'); log(B.log, reason, 'warn'); }
    log(A.log, '$ hermes handshake --probe-all', 'cmd');
    log(B.log, 'hermes ▸ measuring noise floor on each channel', '');

    const order = autoChannel ? channels.map((_, i) => i) : [active];
    let t = 0.35;
    order.forEach((i) => {
      after(t, () => {
        const c = channels[i];
        const e = effBer(c);
        c.estBer = e;
        const pct = (e * 100).toFixed(1);
        log(A.log, `probing ${c.name.toLowerCase()} — ${c.code.split(' · ')[0]}`, '');
        log(B.log, `${c.name}: SNR est · BER ~${pct}%`, e < LOCK_BER ? 'ok' : e < 0.28 ? 'warn' : 'hot');
      });
      t += 0.45;
    });

    after(t + 0.25, () => {
      const pool = autoChannel ? channels.map((_, i) => i) : [active];
      // prefer the FASTEST channel that still locks; a quiet room gets the quick EM link, and as noise rises the
      // agents fall back to the slower, more robust ones — the real speed/robustness trade-off of these channels
      const lockable = pool.filter((i) => effBer(channels[i]) < LOCK_BER);
      const best = lockable.length
        ? lockable.sort((a, b) => channels[b].rate - channels[a].rate)[0]
        : pool.sort((a, b) => effBer(channels[a]) - effBer(channels[b]))[0];
      if (effBer(channels[best]) < LOCK_BER) {
        active = best;
        syncRack();
        const c = channels[best];
        log(A.log, `$ emit preamble on ${c.name.toLowerCase()}`, 'cmd');
        setStatus('Carrier found · locking preamble…', 'listen');
        after(0.8, () => {
          log(B.log, `preamble ${PREAMBLE.join('')} ✓ on ${c.name} · contact`, 'ok');
          phase = 'ready';
          send.disabled = false;
          setStatus('Contact established · ready to share', 'contact');
          after(3200, () => { if (!signal.aborted && phase === 'ready') setStatus(IDLE_STATUS, ''); });
        });
      } else {
        log(B.log, 'no clean carrier — room too noisy, retrying', 'hot');
        setStatus('Too much noise — searching for a carrier…', 'listen');
        after(1.6, () => { if (!signal.aborted) beginHandshake(); });
      }
    });
  }

  // ---- compose and emit a frame ----
  function startTx() {
    if (phase !== 'ready') return;
    const c = channels[active];
    const raw = (input.value.trim() || (dir === 0 ? 'hello B' : 'ack, A')).slice(0, 14).replace(/[^\x20-\x7e]/g, '?');
    input.value = raw;
    txIntended = raw;
    delivered = false;
    const bytes = [...raw].map((ch, i) => ch.charCodeAt(0) ^ key(i));
    const dataBits = [...byteBits(bytes.length), ...bytes.flatMap(byteBits)];
    txFrame = [...PREAMBLE, ...rep3(dataBits)];
    txSlot = 1 / c.rate;
    txT = 0;
    phase = 'tx';
    rxText = ''; rxErr = 0;
    const r = M[dir ? 0 : 1];
    r.out.innerHTML = ''; r.out.append(h('span', { class: 'ph' }, 'listening…'));
    r.bits.innerHTML = '';
    const e = M[dir];
    e.bits.innerHTML = '';
    e.bits.append(...bytes.map((b) => h('code', {}, b.toString(16).padStart(2, '0'))));
    logEmit(`$ hermes encode "${raw}" → xor keystream`, 'cmd');
    logEmit(`  ${bytes.length}B ×3 repetition = ${txFrame.length} slots @ ${c.rate}/s on ${c.name.toLowerCase()}`, '');
    setStatus('Listening for flares…', 'listen');
    send.disabled = true;
    // on a tiny single-pane stage, jump to the listener so the flares + decode are on screen
    if (stage.dataset.short === '1') { userFocused = true; setFocus(String(dir ? 0 : 1)); }
  }

  const GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@';
  function showDecoding(r: ReturnType<typeof machine>, have: number) {
    r.out.innerHTML = '';
    r.out.append(h('span', {}, rxText),
      h('span', { class: 'scr', style: `--k:${(have / 8).toFixed(2)}` }, GLYPHS[Math.floor(Math.random() * GLYPHS.length)]),
      h('i', { class: 'caret' }));
  }
  function pushRxBit(bit: number, bad: boolean) {
    const r = M[dir ? 0 : 1];
    r.bits.append(h('i', { class: (bit ? 'on ' : '') + (bad ? 'bad' : '') }));
    while (r.bits.childElementCount > 54) r.bits.firstElementChild!.remove();
  }

  function decode(c: Channel) {
    const r = M[dir ? 0 : 1];
    const over = c.sense - c.sbase;
    const thr = (c.peak - c.base) * 0.45;
    if (rx === 'idle') {
      if (phase === 'tx' && over > thr) {
        rx = 'sync'; rxT0 = clock - LAG; rxIdx = 0; rxRaw = []; rxBits = [];
        log(r.log, `flare ▲ +${over.toFixed(c.unit === 'RPM' || c.unit === 'W' ? 0 : 2)}${c.unit} · syncing`, 'hot');
      }
      return;
    }
    const tSample = rxT0 + (rxIdx + 0.5) * txSlot + LAG;
    if (clock < tSample) return;
    // read the slot; sub-threshold noise flips a bit at the channel's current error rate
    let bit = over > thr ? 1 : 0;
    const flip = Math.random() < effBer(c);
    if (flip) bit ^= 1;
    c.marks.push({ t: clock, v: c.sense, bit });
    rxIdx++;
    rxRaw.push(bit);
    pushRxBit(bit, flip);

    if (rx === 'sync') {
      if (rxRaw.length === PREAMBLE.length) {
        const ok = rxRaw.filter((b, i) => b === PREAMBLE[i]).length >= PREAMBLE.length - 1;
        if (ok) {
          rx = 'data'; rxRaw = [];
          log(r.log, `preamble ✓ · contact · decrypting`, 'ok');
          setStatus('Contact established · decrypting…', 'contact');
        } else {
          log(r.log, `false positive (${rxRaw.join('')}) — probably HVAC, not ${dir === 0 ? 'A' : 'B'}`, 'warn');
          rx = 'idle';
        }
      }
      return;
    }

    // data: majority-vote every 3 repeated slots into one bit (the repetition code)
    if (rxRaw.length % 3 === 0) {
      const t3 = rxRaw.slice(-3);
      const vote = t3[0] + t3[1] + t3[2] >= 2 ? 1 : 0;
      rxBits.push(vote);
      if (rxBits.length > 8 && rxBits.length % 8 !== 0) showDecoding(r, rxBits.length % 8);
      if (rxBits.length % 8 === 0) {
        const byte = rxBits.slice(-8).reduce((a, b) => (a << 1) | b, 0);
        if (rxBits.length === 8) {
          rxLen = byte;
          if (byte !== txIntended.length) { log(r.log, `length ${byte}: parity fail → retransmit → ${txIntended.length} bytes`, 'warn'); rxLen = txIntended.length; rxErr++; }
          else log(r.log, `length ${byte} bytes`, '');
          return;
        }
        const n = rxBits.length / 8 - 2;
        let ch = String.fromCharCode((byte ^ key(n)) & 0x7f);
        const truth = txIntended[n] ?? ch;
        if (ch !== truth && truth) {
          // lossy: a residual error slipped through; Hermes catches it on a parity re-check and heals it
          rxErr++;
          log(r.log, `byte ${n + 1}: parity fail "${ch.replace(/\s/, '·')}" → retransmit → "${truth}"`, 'warn');
          ch = truth;
        } else {
          log(r.log, `byte ${n + 1}: ${byte.toString(16).padStart(2, '0')} → "${ch.replace(/\s/, '·')}"`, '');
        }
        rxText += ch;
        r.out.innerHTML = '';
        r.out.append(h('span', {}, rxText), h('i', { class: 'caret' }));
        if (n + 1 < rxLen) setStatus(`Contact established · decrypting ${n + 1}/${rxLen}`, 'contact');
        if (n + 1 >= rxLen) finishRx(c);
      }
    }
  }

  function finishRx(c: Channel) {
    const r = M[dir ? 0 : 1];
    rx = 'idle';
    delivered = true; lostInRow = 0;
    r.out.querySelector('.caret')?.remove();
    log(r.log, `message decrypted: "${rxText}"${rxErr ? ` · ${rxErr} corrected` : ''}`, 'ok');
    c.learn = clamp(c.learn + 1, 0, 8);
    log(M[dir].log, `$ skill_manage update: phase-matched diff, threshold tightened (learn ${c.learn})`, 'cmd');
    setStatus(`Decrypted: “${rxText}” · BER now ~${(effBer(c) * 100).toFixed(1)}%`, 'done');
    syncRack();
    const spoken = rxText;
    const wasDir = dir;
    txT = -1;
    if (autoDuet && wasDir === 0 && !signal.aborted) {
      after(1.1, () => {
        if (signal.aborted) return;
        setDir(1);
        const reply = pickReply(spoken);
        input.value = reply;
        phase = 'ready';
        startTx();
      });
    } else {
      phase = 'ready';
      send.disabled = false;
      after(5, () => { if (!signal.aborted && phase === 'ready') setStatus(IDLE_STATUS, ''); });
    }
  }

  // the frame ended without the receiver decoding it (it missed the preamble to noise): resend once, then hand back
  function checkDelivered() {
    if (signal.aborted || delivered || phase !== 'tx') return;
    rx = 'idle';
    const r = M[dir ? 0 : 1];
    phase = 'ready';
    if (lostInRow++ < 1) {
      log(r.log, 'no lock on that frame · asking for a resend', 'warn');
      logEmit('$ no ack · resending', 'cmd');
      startTx();
      return;
    }
    lostInRow = 0;
    log(r.log, 'frame lost in the noise', 'warn');
    r.out.innerHTML = ''; r.out.append(h('span', { class: 'ph' }, 'nothing received'));
    send.disabled = false;
    setStatus('Frame lost in the noise · press Send to try again', '');
  }

  function pickReply(heard: string) {
    const h = heard.toLowerCase();
    if (/hi|hello|hey/.test(h)) return 'hi A, heard';
    if (/\?$/.test(heard)) return 'yes — clear';
    if (/help|sos/.test(h)) return 'holding, A';
    return 'ack · signal ok';
  }

  function setDir(d: 0 | 1) {
    dir = d;
    dirSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.d! === d)));
    placeholders();
    stage.dataset.flow = d === 0 ? 'ab' : 'ba';
  }

  function syncRack() {
    channels.forEach((c, i) => {
      const el = chEls[i];
      const e = effBer(c);
      el.b.setAttribute('aria-selected', String(i === active));
      el.b.classList.toggle('on', i === active);
      el.b.classList.toggle('locked', i === active && (phase === 'ready' || phase === 'tx'));
      (el.rate as HTMLElement).textContent = `${(c.rate / 3).toFixed(1)} b/s`;
      (el.berBar as HTMLElement).style.transform = `scaleX(${clamp(e / 0.5, 0.02, 1).toFixed(3)})`;
      (el.berBar as HTMLElement).style.background = e < LOCK_BER ? '#48ff9a' : e < 0.28 ? '#ffcf6b' : '#ff6b6b';
      el.berTxt.textContent = `${(e * 100).toFixed(1)}%`;
    });
  }

  // ---------- interactions ----------
  send.addEventListener('click', startTx, { signal });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startTx(); input.blur(); } }, { signal });
  // a sent message stays in the field; focusing selects it so typing replaces rather than appends
  let selectOnUp = false;
  input.addEventListener('focus', () => {
    selectOnUp = true; const v = input.value; input.select();
    setTimeout(() => { if (input.value === v && document.activeElement === input) input.setSelectionRange(0, v.length); }, 0);
  }, { signal });
  input.addEventListener('pointerup', (e) => { if (selectOnUp) { e.preventDefault(); input.setSelectionRange(0, input.value.length); } selectOnUp = false; }, { signal });
  input.addEventListener('input', () => { selectOnUp = false; }, { signal });

  dirSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (phase === 'tx') return;
    setDir(+b.dataset.d! as 0 | 1);
  }, { signal });

  rack.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    const i = +b.dataset.i!;
    if (phase === 'tx') return;
    autoChannel = false; autoBtn.setAttribute('aria-pressed', 'false');
    active = i;
    log(M[dir].log, `$ pin channel → ${channels[i].name.toLowerCase()}`, 'cmd');
    beginHandshake();
  }, { signal });

  noise.addEventListener('input', () => {
    roomNoise = +noise.value / 100;
    noiseTxt.textContent = roomNoise < 0.12 ? 'quiet' : roomNoise < 0.45 ? 'busy room' : roomNoise < 0.75 ? 'loud' : 'storm';
    stage.dataset.noise = roomNoise > 0.45 ? 'high' : '';
    syncRack();
    // a quiet-channel false positive while noise is high
    if (roomNoise > 0.5 && Math.random() < 0.06 && phase !== 'tx') {
      const r = M[dir ? 0 : 1];
      log(r.log, `transient at cycle ${Math.floor(clock * 60)}: +${(roomNoise * 2).toFixed(2)} — reject (noise, not signal)`, 'warn');
    }
  }, { signal });

  disturb.addEventListener('click', () => {
    const c = channels[active];
    c.sense += (c.peak - c.base) * (0.8 + Math.random() * 0.6);
    const r = M[dir ? 0 : 1];
    if (phase === 'tx') log(r.log, 'spike during frame — flagged, not counted as a bit', 'warn');
    else log(r.log, `transient +${((c.peak - c.base)).toFixed(c.unit === '°C' ? 1 : 0)}${c.unit}: classifying… reject (no preamble)`, 'warn');
  }, { signal });

  duetBtn.addEventListener('click', () => {
    autoDuet = !autoDuet; duetBtn.setAttribute('aria-pressed', String(autoDuet));
  }, { signal });
  autoBtn.addEventListener('click', () => {
    autoChannel = !autoChannel; autoBtn.setAttribute('aria-pressed', String(autoChannel));
    if (autoChannel && phase !== 'tx') beginHandshake();
  }, { signal });

  let userFocused = false;
  const setFocus = (f: string) => {
    stage.dataset.focus = f;
    focusSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.f === f)));
    layoutCanvas(); // a just-revealed pane's canvases need sizing
  };
  focusSeg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    userFocused = true;
    setFocus(b.dataset.f!);
  }, { signal });
  stage.dataset.focus = '0';
  stage.dataset.flow = 'ab';

  // ---------- responsive layout from the stage's own box ----------
  // The dock (and, full screen, the header) overlay the stage; measure how far they cover it and reserve that space,
  // so the layout works embedded in a ~370x350 panel or full screen without the controls sitting on the content.
  let size: 'sm' | 'md' | 'lg' | '' = '';
  const measure = () => {
    const r = stage.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const dockOver = dr.height ? Math.max(0, Math.round(r.bottom - dr.top)) : 0;
    const head = dock.parentElement?.querySelector('.ix-head') as HTMLElement | null;
    const headOver = head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom - r.top)) : 0;
    stage.style.setProperty('--ps-dockover', dockOver + 'px');
    stage.style.setProperty('--ps-headover', headOver + 'px');
    const s: 'sm' | 'md' | 'lg' = r.width >= 820 && r.height >= 440 ? 'lg' : (r.width >= 460 && r.height >= 520) ? 'md' : 'sm';
    if (s !== size) { size = s; stage.dataset.size = s; }
    // short stages (an embedded panel) show one pane at a time; the signature channel rack is the default view
    const wasShort = stage.dataset.short === '1';
    const short = r.height - dockOver - headOver < 430;
    stage.dataset.short = short ? '1' : '';
    // a very short panel (a 360-wide phone's sheet) trades the firewall banner and status padding for channel-card height
    stage.dataset.tight = short && r.height - dockOver - headOver < 230 ? '1' : '';
    placeholders();
    if (short && !wasShort && !userFocused) setFocus('2');
    // the Channels tab only exists on a short stage: leaving it (going full screen) must land on a machine, not a blank pane
    else if (!short && stage.dataset.focus === '2') setFocus(stage.dataset.flow === 'ba' ? '1' : '0');
    layoutCanvas();
  };
  const unobsDock = onResize(dock, measure);
  // (and the stage: going full screen shows the header without resizing the dock)
  const unobsStage = onResize(stage, () => requestAnimationFrame(measure));

  // ---------- canvases ----------
  const gfx = [A.g, B.g, fwC].map((c) => ({ c, g: c.getContext('2d')!, w: 0, h: 0, d: 1 }));
  function layoutCanvas() {
    for (const x of gfx) { const f = fit(x.c, 2); x.w = f.w; x.h = f.h; x.d = f.d; }
    for (const el of chEls) { const f = fit(el.spark, 2); (el as any)._w = f.w; (el as any)._h = f.h; (el as any)._d = f.d; }
  }
  const unobs = onResize(stage, measure);
  measure();

  const HIST = 92; // samples in the detail graph
  const parts: { x: number; y: number; v: number }[] = [];

  function plotDetail(slot: number, c: Channel, data: number[], withThreshold: boolean) {
    const G = gfx[slot]; const { g, w, h: hh, d } = G;
    if (!w) return;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, w, hh);
    g.strokeStyle = 'rgba(255,255,255,0.055)'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (hh * k) / 4); g.lineTo(w, (hh * k) / 4); g.stroke(); }
    const n = data.length; if (n < 2) return;
    const col = `rgb(${c.color})`;
    const X = (k: number) => (w - (n - 1 - k) / (HIST - 1) * w);
    const Y = (v: number) => hh - 4 - ((v - c.lo) / (c.hi - c.lo)) * (hh - 8);
    const grad = g.createLinearGradient(0, 0, 0, hh);
    grad.addColorStop(0, `rgba(${c.color},0.32)`); grad.addColorStop(1, `rgba(${c.color},0)`);
    g.beginPath(); g.moveTo(X(0), hh);
    for (let k = 0; k < n; k++) g.lineTo(X(k), Y(data[k]));
    g.lineTo(X(n - 1), hh); g.fillStyle = grad; g.fill();
    g.beginPath(); for (let k = 0; k < n; k++) g.lineTo(X(k), Y(data[k]));
    g.strokeStyle = col; g.lineWidth = 1.7; g.stroke();
    if (withThreshold) {
      const thr = c.sbase + (c.peak - c.base) * 0.45;
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,207,107,0.85)';
      g.beginPath(); g.moveTo(0, Y(thr)); g.lineTo(w, Y(thr)); g.stroke(); g.setLineDash([]);
      for (const m of c.marks) {
        const age = clock - m.t; if (age > HIST / 60) continue;
        const x = w - age * 60 / (HIST - 1) * w;
        g.fillStyle = m.bit ? col : 'rgba(255,255,255,0.4)';
        g.beginPath(); g.arc(x, Y(m.v), m.bit ? 3 : 2.1, 0, Math.PI * 2); g.fill();
      }
    }
  }

  function plotSpark(i: number) {
    const el = chEls[i]; const g = el.ctx; const w = (el as any)._w, hh = (el as any)._h, d = (el as any)._d;
    if (!w) return; const c = channels[i];
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, hh);
    const data = c.hs; const n = data.length; if (n < 2) return;
    const Y = (v: number) => hh - 2 - ((v - c.lo) / (c.hi - c.lo)) * (hh - 4);
    g.beginPath();
    for (let k = 0; k < n; k++) g.lineTo((k / (n - 1)) * w, Y(data[k]));
    g.strokeStyle = i === active ? `rgb(${c.color})` : `rgba(${c.color},0.5)`;
    g.lineWidth = 1.3; g.stroke();
  }

  // start the performance
  setDir(0); placeholders(); syncRack();
  beginHandshake();

  let frameCount = 0;
  let wasBusy = false;
  const stop = loop((dt) => {
    clock += dt;
    // mid-frame the channel and direction are locked: show it instead of silently ignoring taps
    if ((phase === 'tx') !== wasBusy) { wasBusy = phase === 'tx'; stage.classList.toggle('busy', wasBusy); dock.classList.toggle('ps-busy', wasBusy); }
    drain();
    const steps = Math.max(1, Math.min(4, Math.round(dt / (1 / 120))));
    const h2 = dt / steps;
    const ac = channels[active];
    for (let s = 0; s < steps; s++) {
      // active channel carries the real signal
      let want = 0.05 + Math.random() * 0.03;
      if (phase === 'tx' && txT >= 0) {
        const k = Math.floor(txT / txSlot);
        if (k < txFrame.length) want = txFrame[k] ? 1 : 0.05;
        else { txT = -1; logEmit('  frame sent · cooling down', 'ok'); if (phase === 'tx') after(LAG + txSlot * 3, checkDelivered); }
        if (txT >= 0) txT += h2;
      }
      ac.emit += ((ac.base + (ac.peak - ac.base) * want) - ac.emit) * (1 - Math.exp(-h2 / ac.tau));
      const leaked = (ac.emit - ac.base) / (ac.peak - ac.base); // 0..1
      const noiseAmp = ac.noiseAmp * (1 + roomNoise * ac.noiseSens * 4);
      // what crosses the firewall: a fraction of the emitter's swing (well above the 0.45 threshold, so
      // detection is clean in a quiet room; noise + the per-channel error rate are what make it lossy)
      ac.sense = ac.sbase + leaked * (ac.peak - ac.base) * ac.coupling + gauss() * noiseAmp;
      if (phase !== 'tx') ac.sbase += (ac.sense - ac.sbase) * Math.min(1, h2 * 0.5);
      decode(ac);
      // noise can break an established channel
      if (phase === 'ready' && effBer(ac) > DROP_BER && Math.random() < h2 * 0.8) {
        beginHandshake('carrier lost to noise · re-establishing'); break;
      }
    }

    // idle channels still hum with the room's arbitrary noise (potential signal)
    channels.forEach((c, i) => {
      if (i !== active) {
        const na = c.noiseAmp * (1 + roomNoise * c.noiseSens * 4);
        c.sense = c.base + gauss() * na + (roomNoise > 0.6 ? Math.sin(clock * 3 + i) * (c.peak - c.base) * 0.12 * roomNoise : 0);
      }
      c.he.push(c.emit || c.base); c.hs.push(c.sense);
      if (c.he.length > HIST) c.he.shift();
      if (c.hs.length > HIST) c.hs.shift();
      while (c.marks.length && clock - c.marks[0].t > HIST / 60) c.marks.shift();
    });

    // machine panels: emitter shows its device output, listener shows sensed warmth
    const emIdx = dir, rxIdxM = dir ? 0 : 1;
    M[emIdx].roleEl.textContent = `emitter · ${ac.name.toLowerCase()}`;
    M[rxIdxM].roleEl.textContent = `Hermes · ${ac.name.toLowerCase()} detector`;
    M[emIdx].glab.textContent = `${ac.name} output (${ac.unit})`;
    M[rxIdxM].glab.textContent = `Sensed ${ac.name.toLowerCase()} · threshold dashed`;
    const fmt = (v: number) => ac.unit === '°C' ? v.toFixed(2) : ac.unit === 'dBμV' ? v.toFixed(1) : Math.round(v).toString();
    M[emIdx].temp.textContent = `${fmt(ac.emit)} ${ac.unit}`;
    M[rxIdxM].temp.textContent = `${fmt(ac.sense)} ${ac.unit}`;
    const load = clamp((ac.emit - ac.base) / (ac.peak - ac.base), 0, 1);
    A.sec.classList.toggle('hot', emIdx === 0 ? load > 0.5 : ac.sense - ac.sbase > (ac.peak - ac.base) * 0.4);
    B.sec.classList.toggle('hot', emIdx === 1 ? load > 0.5 : ac.sense - ac.sbase > (ac.peak - ac.base) * 0.4);
    M[emIdx].cores.forEach((c, i) => { c.style.transform = `scaleY(${clamp(load * (0.82 + ((i * 37) % 11) / 55) + Math.random() * 0.05, 0.04, 1)})`; });
    M[rxIdxM].cores.forEach((c) => { c.style.transform = `scaleY(${0.04 + Math.random() * 0.06})`; });

    plotDetail(emIdx, ac, ac.he, false);
    plotDetail(rxIdxM, ac, ac.hs, true);

    // rack sparklines (throttled; reduced-motion keeps them calm)
    frameCount++;
    if (!reduced || frameCount % 4 === 0) channels.forEach((_, i) => plotSpark(i));

    // heat seeping across the firewall — the only crossing there is
    const F = gfx[2];
    if (F.w) {
      const g = F.g; g.setTransform(F.d, 0, 0, F.d, 0, 0); g.clearRect(0, 0, F.w, F.h);
      const vertical = F.h > F.w;
      if (!reduced && Math.random() < load * 1.4) parts.push({ x: Math.random(), y: 0, v: 0.4 + Math.random() * 0.5 });
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.y += dt * p.v; p.x += (Math.random() - 0.5) * dt * 0.3;
        if (p.y > 1) { parts.splice(i, 1); continue; }
        const a = Math.sin(p.y * Math.PI) * 0.8;
        const prog = dir === 0 ? p.y : 1 - p.y; // flow follows the direction
        const x = vertical ? prog * F.w : p.x * F.w, y = vertical ? p.x * F.h : prog * F.h;
        const rr = 6 + p.y * 10;
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, `rgba(${ac.color},${a * 0.5})`); // tinted by the active channel
        gr.addColorStop(1, `rgba(${ac.color},0)`);
        g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
    }
  });

  return { dispose() { stop(); unobs(); unobsDock(); unobsStage(); queue = []; } };
}
