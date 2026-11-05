import * as THREE from 'three';
import { Audio } from '../core/audio';
import { asset, BASE, type Floor, type FloorId, type GuideLines, loadFloor, loadLines, loadStations, pick, type PresetLines, type Station } from '../core/data';
import { GuideAnimator } from '../guide/anim';
import { GuideBrain } from '../guide/brain';
import { buildGuide } from '../guide/model';
import { loadMeshyRig } from '../guide/meshy';
import { guideUniforms } from '../guide/materials';
import { PodViewer } from '../pod/pod';
import { Bubble } from '../ui/bubble';
import { StationCard } from '../ui/card';
import { AskDrawer } from '../ui/chat';
import { h, inertUnlessOn, reducedMotion, store, toast } from '../ui/dom';
import { icons } from '../ui/icons';
import { disclosure, SideMenu } from '../ui/menu';
import { FrameSource } from './frames';
import { StationOverlay } from './overlay';
import { WalkView } from './view';
import { PressPad } from './press';
import { GH, GW, SceneSense } from './sense';
import { floorGrid } from './debug';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function runWalk(root: HTMLElement) {
  const app = new WalkApp(root);
  await app.init();
  (window as any).__walk = app;
}

class WalkApp {
  stage = h('div', { class: 'stage' });
  overlayEl = h('div', { class: 'overlay' });
  view!: WalkView;
  floors = new Map<FloorId, Floor>();
  floor!: Floor;
  source!: FrameSource;
  sources = new Map<FloorId, FrameSource>();
  stations: Station[] = [];
  lines!: GuideLines;
  preset: string = store('wte.preset') || 'hype';
  overlay!: StationOverlay;
  brain!: GuideBrain;
  bubble!: Bubble;
  card!: StationCard;
  pod!: PodViewer;
  askD!: AskDrawer;
  audio = new Audio();
  // rail state
  cur = 0;
  vel = 0;
  holdDir = 0;
  glide: { from: number; to: number; t: number; dur: number; then?: () => void } | null = null;
  lastInput = performance.now();
  private lastReq = -1;
  private dir = 1;
  started = false;
  open: Station | null = null;
  inTransition = false;
  private returnFrame = -1;
  private usedClip: Station['transition'] = null;
  private lookTarget = new THREE.Vector2();
  private gyro = false;
  private moved = false;
  // dom
  private chapterTitle = h('strong');
  private chapterKicker = h('small');
  private rail = h('div', { class: 'rail', role: 'slider', 'aria-label': 'Walk progress', tabindex: '0' });
  private railFill = h('div', { class: 'fill' });
  private railHead = h('div', { class: 'head' });
  private railLabel = h('div', { class: 'label' });
  private floorBtns = new Map<FloorId, HTMLButtonElement>();
  private soundBtn!: HTMLButtonElement;
  private hint = h('div', { class: 'hint' });
  private intro!: HTMLElement;
  private outro!: HTMLElement;
  menu!: SideMenu;
  private menuBtn!: HTMLButtonElement;
  private menuSoundBtn!: HTMLButtonElement;
  private menuChapters = h('ol', { class: 'menu-list menu-chapters' });
  private menuStations = h('ul', { class: 'menu-list menu-stations' });
  private chapterBtns = new Map<string, HTMLButtonElement>();
  private whip = h('div', { class: 'whip' });
  private pad!: PressPad;
  private tiltBtn: HTMLButtonElement | null = null;
  private jogNow = false; // (owner) a hard press on the walk pad (or shift): she jogs, the pace cap opens to her jog
  private lastT = performance.now();
  private atEndPush = 0;
  fpsTrace: number[] = [];
  private floorTok = 0;
  private closeWhenOpen = false;
  /** Swipe target frame (null when not dragging / caught up) and whether a finger is down on the walk. */
  private dragTo: number | null = null;
  private dragDir = 0; // (finger held) the way the current drag last moved: +1 forward, -1 back, 0 none yet
  private dragMoveAt = 0;
  private dragging = false;
  private autoExpo = 1;
  private noGuide = new URLSearchParams(location.search).has('noguide');
  private noSense = new URLSearchParams(location.search).has('nosense');
  /** ?perf: on-screen readout for testing on phones (no devtools there): frame time, footage updates, freezes. */
  private perfEl: HTMLElement | null = new URLSearchParams(location.search).has('perf') ? document.body.appendChild(Object.assign(document.createElement('pre'), { style: 'position:fixed;left:6px;top:96px;z-index:99;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,monospace;color:#9f9;background:rgba(0,0,0,.72);border-radius:8px;pointer-events:none;white-space:pre' })) : null;
  private pf = { t0: 0, frames: 0, slow: 0, worst: 0, shownChanges: 0, lastShown: -1, lastShownAt: 0, curAtShown: 0, aheadSince: 0, freezes: 0, longestFreeze: 0, hidden: 0, lagMax: 0, js: 0, jsMax: 0, sec: { src: 0, ovl: 0, brain: 0, render: 0, sense: 0 } };
  private perfTick(now: number, dt: number) {
    const p = this.pf;
    if (!p.t0) { p.t0 = now; p.lastShownAt = now; }
    p.frames++;
    if (dt > 0.034) p.slow++;
    p.worst = Math.max(p.worst, dt * 1000);
    const sh = this.source.shown;
    if (sh !== p.lastShown) { p.shownChanges++; p.lastShown = sh; p.lastShownAt = now; p.curAtShown = this.cur; }
    const moving = Math.abs(this.vel) > 3 || this.holdDir !== 0;
    // a freeze = the scroll has moved on by more than 2 frames but the picture hasn't changed for over 250 ms
    // the clock starts when the scroll first gets more than 2 frames ahead of the picture (not at the last change)
    if (Math.abs(this.cur - sh) > 2 && sh === p.lastShown) { if (!p.aheadSince) p.aheadSince = now; } else p.aheadSince = 0;
    const stall = p.aheadSince ? now - p.aheadSince : 0;
    if (stall > 250) { p.longestFreeze = Math.max(p.longestFreeze, stall); if (stall < 250 + dt * 1000 + 1) p.freezes++; }
    if (moving) p.lagMax = Math.max(p.lagMax, Math.abs(sh - this.cur));
    if (this.started && !this.brain.rig.root.visible && this.brain.opacity > 0.5) p.hidden++;
    if (now - p.t0 > 1000) {
      const s = (now - p.t0) / 1000;
      this.perfEl!.textContent = `fps ${(p.frames / s).toFixed(0)}  slow ${p.slow}  worst ${p.worst.toFixed(0)}ms
js ${(p.js / Math.max(1, p.frames)).toFixed(1)}ms avg  ${p.jsMax.toFixed(0)}ms max
${Object.entries(p.sec).map(([k, v]) => `${k} ${(v / Math.max(1, p.frames)).toFixed(1)}`).join(' ')}
footage ${(p.shownChanges / s).toFixed(0)}/s  lag ${p.lagMax.toFixed(0)}f
freezes ${p.freezes}  longest ${p.longestFreeze.toFixed(0)}ms
guide hidden ${p.hidden}f  dpr ${this.view.renderer.getPixelRatio().toFixed(2)}
${this.source.tier} direct ${this.source.direct} webcodecs ${this.source.usingWebCodecs}
sense f${this.sense.frame} people ${this.sense.people.length} floorLum ${this.sense.floorLum.toFixed(3)}`;
      Object.assign(p, { t0: now, frames: 0, slow: 0, worst: 0, shownChanges: 0, lagMax: 0, js: 0, jsMax: 0, sec: { src: 0, ovl: 0, brain: 0, render: 0, sense: 0 } });
    }
  }
  /** Depth / people / colour read back from the footage around her (navigation + lighting). */
  sense = new SceneSense();
  private roomLum = -1;
  grid: THREE.Object3D | null = null;
  private prefetched = new Set<string>();
  guideKind: 'meshy' | 'toon' = 'meshy';
  private slowed = new Set<string>();

  constructor(public root: HTMLElement) {}

  get L(): PresetLines { return this.lines.presets[this.preset] ?? this.lines.presets.hype; }

  async init() {
    const probe = this.probeNet(); // in parallel with the data loads below
    this.root.append(this.stage);
    this.view = new WalkView(this.stage);
    this.stage.append(this.overlayEl, h('div', { class: 'shade-top' }), h('div', { class: 'shade-bot' }));
    this.buildIntro();
    const loadBar = this.intro.querySelector('.load i') as HTMLElement;
    const [down, stations, lines] = await Promise.all([loadFloor('downstairs'), loadStations(), loadLines()]);
    fetch(asset('data/music_upstairs.json')).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.beats) this.musicBeats = j.beats; }).catch(() => {});
    loadBar.style.width = '40%';
    this.floors.set('downstairs', down);
    this.stations = stations;
    this.lines = lines;
    this.overlay = new StationOverlay(this.overlayEl, this.view, stations);
    this.overlay.onOpen = (s) => this.openStation(s);
    // Two versions of the guide: the sculpted Meshy model (default) or the illustrated toon rig.
    this.guideKind = (new URLSearchParams(location.search).get('guide') || store('wte.guide') || 'meshy') === 'toon' ? 'toon' : 'meshy';
    let made = false;
    if (this.guideKind === 'meshy') {
      try {
        const { rig, anim } = await loadMeshyRig(asset('media/guide/hermes-v5.glb'));
        this.view.scene.add(rig.root);
        this.brain = new GuideBrain(rig, anim, this.view);
        made = true;
      } catch (e) { console.warn('meshy guide failed, using the toon guide', e); this.guideKind = 'toon'; }
    }
    if (!made) {
      const rig = buildGuide();
      this.view.scene.add(rig.root);
      this.brain = new GuideBrain(rig, new GuideAnimator(rig), this.view);
    }
    if (new URLSearchParams(location.search).get('debug') === 'grid') { this.grid = floorGrid(); this.view.scene.add(this.grid); }
    this.brain.sense = this.sense;
    this.brain.stations = stations;
    this.brain.lines = this.L;
    this.bubble = new Bubble(this.root);
    this.bubble.style = this.preset === 'hacker' ? 'hacker' : 'default';
    this.bubble.onTalking = (on) => { this.brain.talking = on; };
    this.brain.say = (t, hold) => this.bubble.say(t, hold);
    this.brain.busy = () => this.bubble.visible;
    this.pod = new PodViewer(this.root);
    this.card = new StationCard(this.root);
    // Back pressed while the push-in is still finishing (the card slides up early): close as soon as it lands
    this.card.onBack = () => { if (this.open) this.closeStation(); else if (this.inTransition) this.closeWhenOpen = true; };
    this.card.onAsk = (s) => this.askD.open(`Tell me about ${s.title}`);
    this.card.onShare = (s) => this.share(`#station-${s.id}`, s.title);
    this.card.onPhoto = (u) => {
      const lb = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Photo' }, h('img', { src: asset(u), alt: '' }));
      lb.addEventListener('click', () => lb.remove());
      lb.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.root.append(lb);
    };
    this.askD = new AskDrawer(this.root, stations);
    this.askD.fallback = this.L.ask_fallback;
    this.askD.onAnswer = (t) => { if (!this.open) this.bubble.say(t.length > 140 ? `${t.slice(0, 136)}…` : t, 5); };
    this.askD.onLink = (hsh) => this.handleHash(hsh);
    this.buildHud();
    this.buildMenu();
    this.buildOutro();
    for (const el of [this.card.el, this.askD.el, this.outro]) inertUnlessOn(el);
    this.root.append(this.whip, this.hint);
    await probe;
    await this.setFloor('downstairs', 0, false);
    loadBar.style.width = '100%';
    this.bindInput();
    // one bad frame (a GL hiccup, a NaN somewhere) must never stop the walk
    this.view.renderer.setAnimationLoop((ts: number) => {
      const t0 = performance.now();
      try { this.frame(ts); } catch (e) { console.error('frame', e); }
      if (this.perfEl) { const ms = performance.now() - t0; this.pf.js += ms; this.pf.jsMax = Math.max(this.pf.jsMax, ms); }
    });
    addEventListener('hashchange', () => this.handleHash(location.hash));
    (this.intro.querySelector('.go') as HTMLButtonElement).disabled = false;
    // the splat renderer (a 2.8 MB module + a second WebGL context) is built while the intro is on screen, where a few
    // hundred ms of work show as nothing; built later it was a visible hitch mid-walk even at a pause
    this.warmPodSoon();
    let returning = false;
    try { returning = sessionStorage.getItem('wte.started') === '1'; } catch { /* private mode */ }
    if (new URLSearchParams(location.search).has('autostart') || location.hash || returning) this.start();
    // warm upstairs data in the background
    loadFloor('upstairs').then((f) => this.floors.set('upstairs', f)).catch(() => {});
  }

  tier(): 'sd' | 'hd' {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'sd' || q === 'hd') return q;
    const saved = store('wte.tier');
    if (saved === 'sd' || saved === 'hd') return saved;
    if (innerWidth >= 900 && !matchMedia('(pointer: coarse)').matches) return 'hd';
    // Phones with high-density screens get 1080p (the footage is the star: 720p looked soft on an iPhone); lower-end
    // devices (small pixel ratio or little memory) keep 720p. Settings can force either.
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 6;
    // ...but only on a connection that keeps up: 1080p needs ~7.5 Mbit/s at walking pace; with headroom for the
    // walk's quicker moments a phone gets it from ~8 Mbit/s measured (the probe reads about half the link rate: ~15 real; Wi-Fi, 5G); on a typical cellular link the
    // 1080p footage outran the download and froze mid-walk
    if (this.netMbps > 0 && this.netMbps < 8) return 'sd';
    return devicePixelRatio >= 2.5 && mem >= 4 ? 'hd' : 'sd';
  }
  /** Measured download speed (Mbit/s) from a short ranged read of the 1080p footage; 0 = unknown. */
  private netMbps = 0;
  private async probeNet() {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; downlink?: number } }).connection;
    if (conn?.saveData) { this.netMbps = 1; return; }
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(asset('media/walk/downstairs/hd_01.mp4'), { headers: { Range: 'bytes=0-786431' }, signal: ctl.signal, cache: 'no-store' });
      const rd = res.body!.getReader();
      let bytes = 0, t1 = 0;
      const t0 = performance.now();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        if (!t1) t1 = performance.now(); // throughput from the first byte (latency is not bandwidth)
        else bytes += value.byteLength;
      }
      clearTimeout(timer);
      const sec = (performance.now() - (t1 || t0)) / 1000;
      this.netMbps = bytes > 100000 ? (bytes * 8) / 1e6 / Math.max(sec, 0.02) : 0;
    } catch { this.netMbps = 4; /* too slow to finish in 2.5 s */ }
  }

  async setFloor(id: FloorId, frame = 0, announce = true) {
    let fl = this.floors.get(id);
    if (!fl) { fl = await loadFloor(id); this.floors.set(id, fl); }
    this.floor = fl;
    let src = this.sources.get(id);
    if (!src) {
      src = new FrameSource(asset(`media/walk/${id}`), fl.meta, this.tier());
      this.sources.set(id, src);
    }
    this.source = src;
    // swap everything that depends on the floor in one go (frame() may run while the first segment loads)
    const tok = ++this.floorTok;
    this.view.setSource(fl, src);
    this.view.setFrame(frame);
    this.cur = frame;
    this.vel = 0;
    this.glide = null;
    this.lastReq = -1;
    this.brain.setFloor(fl);
    this.buildWalkCap(fl);
    this.sense.reset(fl); // never judge the new floor through the old floor's camera / depth grid
    this.roomLum = -1;
    await src.prime(frame);
    if (tok !== this.floorTok) return; // a later floor switch took over
    this.audio.setFloor(id);
    for (const [k, b] of this.floorBtns) { b.setAttribute('aria-current', String(k === id)); b.setAttribute('aria-pressed', String(k === id)); }
    this.buildRailMarks();
    this.buildMenuLists();
    if (announce) this.bubble.say(pick(this.L.chapters[fl.chapters[0].id] ?? this.L.stairs), 3.5);
  }

  // ---------------------------------------------------------------- HUD
  private buildHud() {
    // Minimal top bar: a quiet sound toggle and the menu button. Everything else lives in the side menu.
    // (owner: "very clean and immersive, as little clutter as possible": no wordmark, no progress rail on screen; the
    // menu keeps the wordmark, chapters and the map. The rail element stays built, unattached, for its bookkeeping)
    const top = h('div', { class: 'topbar' });
    this.soundBtn = h('button', { class: 'icon-btn ghost sound-btn', type: 'button', 'aria-label': 'Sound off', title: 'Sound (M)', html: icons.soundOff }) as HTMLButtonElement;
    this.soundBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleSound(); this.audio.blip(660); });
    this.menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open menu', title: 'Menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'side-menu', html: icons.menu }) as HTMLButtonElement;
    this.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); this.audio.blip(520); this.menu.open(this.menuBtn); });
    // (owner) tilt to look: a top-right toggle on phones (the device's motion turns the view, the whole walk long)
    if (typeof DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
      const tb = this.tiltBtn = h('button', { class: 'icon-btn ghost tilt-btn', type: 'button', 'aria-label': 'Tilt to look around', 'aria-pressed': 'false', title: 'Tilt to look', html: icons.tilt }) as HTMLButtonElement;
      tb.addEventListener('click', (e) => { e.stopPropagation(); this.audio.blip(this.gyro ? 440 : 760); void this.enableGyro(!this.gyro); });
    }
    top.append(h('div', { class: 'spacer' }), ...(this.tiltBtn ? [this.tiltBtn] : []), this.soundBtn, this.menuBtn);
    this.rail.append(h('div', { class: 'track' }), this.railFill, this.railHead, this.railLabel);
    // (owner) the walk pad, bottom right: forward over back, faster the harder (or further up) it's pressed
    this.pad = new PressPad(icons.up, icons.down);
    this.pad.onPress = () => { if (!this.started || this.open || this.inTransition) { this.pad.release(); return; } this.audio.ensure(); this.glide = null; this.dragTo = null; this.lastInput = performance.now(); if (!this.moved) { this.moved = true; this.hint.classList.remove('on'); } };
    const bottom = h('div', { class: 'bottom' }, h('div', { class: 'chapter', 'aria-live': 'polite' }, this.chapterKicker, this.chapterTitle), this.pad.el);
    this.root.append(top, bottom);
    // rail scrubbing
    const railTo = (e: PointerEvent) => {
      const r = this.rail.getBoundingClientRect();
      const t = clamp((e.clientY - r.top) / r.height, 0, 1);
      this.glideTo(t * (this.floor.end), 0.5);
    };
    this.rail.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.rail.setPointerCapture(e.pointerId); railTo(e); this.rail.classList.add('show-label'); });
    this.rail.addEventListener('pointermove', (e) => { if (e.buttons) railTo(e); });
    this.rail.addEventListener('pointerup', () => setTimeout(() => this.rail.classList.remove('show-label'), 900));
    this.rail.addEventListener('keydown', (e) => {
      const ch = this.floor.chapters;
      const t = this.cur / this.floor.meta.fps;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { const n = ch.find((c) => c.start > t + 0.5); if (n) this.glideTo(n.start * this.floor.meta.fps, 1); e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { const p = [...ch].reverse().find((c) => c.start < t - 1); this.glideTo((p?.start ?? 0) * this.floor.meta.fps, 1); e.preventDefault(); e.stopPropagation(); }
    });
  }

  private buildRailMarks() {
    this.rail.querySelectorAll('.tick,.dot').forEach((e) => e.remove());
    const N = this.floor.end + 1; // (the walk's own end, not the footage's)
    for (const c of this.floor.chapters) {
      const tk = h('button', { class: 'tick', 'data-label': c.title, 'aria-label': `Chapter: ${c.title}` });
      tk.style.top = `${((c.start * this.floor.meta.fps) / N) * 100}%`;
      tk.addEventListener('click', (e) => { e.stopPropagation(); this.glideTo(c.start * this.floor.meta.fps + 2, 1.1); });
      tk.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.rail.append(tk);
    }
    if (this.floor.id === 'downstairs') {
      for (const s of this.stations) {
        const d = h('button', { class: 'dot', 'data-label': s.title, 'aria-label': `Station: ${s.title}` });
        d.dataset.id = s.id;
        d.style.top = `${(s.click_frame / N) * 100}%`;
        d.addEventListener('pointerdown', (e) => e.stopPropagation());
        d.addEventListener('click', (e) => { e.stopPropagation(); this.goStation(s); });
        this.rail.append(d);
      }
    }
  }

  private updateHud() {
    const N = this.floor.end + 1;
    const p = this.cur / (N - 1);
    this.railFill.style.height = `${p * 100}%`;
    this.railHead.style.top = `${p * 100}%`;
    const t = this.cur / this.floor.meta.fps;
    const ch = this.floor.chapters.find((c) => t >= c.start && t < c.end) ?? this.floor.chapters[0];
    if (this.chapterTitle.textContent !== ch.title) {
      this.chapterTitle.textContent = ch.title;
      this.chapterTitle.classList.remove('swap');
      void this.chapterTitle.offsetWidth;
      this.chapterTitle.classList.add('swap');
      this.chapterKicker.textContent = `${this.floor.id === 'downstairs' ? 'Downstairs' : 'Upstairs'} · ${String(this.floor.chapters.indexOf(ch) + 1).padStart(2, '0')}`;
      this.railLabel.textContent = ch.title;
      this.rail.setAttribute('aria-valuetext', ch.title);
      for (const [id, b] of this.chapterBtns) b.setAttribute('aria-current', String(id === ch.id));
    }
    this.railLabel.style.top = `${p * 100}%`;
    this.rail.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  // ---------------------------------------------------------------- intro / outro / settings
  private buildIntro() {
    const go = h('button', { class: 'go', disabled: true, html: `Continue ${icons.play}` }) as HTMLButtonElement;
    go.addEventListener('click', () => { this.audio.setMuted(store('wte.muted') === '1'); this.syncSound(); this.start(); });
    const card = h('img', {
      class: 'recap-card', alt: 'NousCon NYC recap. Welcome to NousCon NYC Recap. It was a movie, so play it back!',
      src: asset('media/intro/recap-card-720.webp'),
      srcset: `${asset('media/intro/recap-card-720.webp')} 720w, ${asset('media/intro/recap-card-1254.webp')} 1254w`,
      sizes: 'min(86vw, 58vh, 520px)', width: '1254', height: '1254', fetchpriority: 'high', decoding: 'async',
    });
    this.intro = h('div', { class: 'intro' }, h('div', { class: 'inner' },
      h('h1', { class: 'sr-only' }, 'NousCon NYC Recap'),
      card,
      go,
      h('div', { class: 'load' }, h('i')),
    ));
    this.root.append(this.intro);
  }

  start() {
    if (this.started) return;
    this.started = true;
    try { sessionStorage.setItem('wte.started', '1'); } catch { /* private mode */ }
    const reveal = () => {
      // hold the title until the frame we're arriving at is decoded (shared links jump first)
      if (this.source.shown < 0 || Math.abs(this.source.shown - this.cur) > 6) { requestAnimationFrame(reveal); return; }
      this.intro.classList.add('out');
      setTimeout(() => this.intro.remove(), 1000);
    };
    reveal();
    const hash = location.hash;
    if (hash) {
      // Shared links: jump behind the intro (no long fly-in), then open / settle once the frame is up.
      this.brain.state = 'intro'; // no lines/bubbles until the intro has gone
      const endIntroWhenOut = () => { if (this.intro.classList.contains('out') || !this.intro.isConnected) this.brain.endIntro(); else requestAnimationFrame(endIntroWhenOut); };
      endIntroWhenOut();
      this.intro.style.transition = 'opacity 0.35s';
      const st = hash.startsWith('#station-') ? this.stations.find((x) => `#station-${x.id}` === hash) : null;
      const ch = hash.match(/^#chapter-(.+)$/)?.[1];
      if (st && this.floor.id === 'downstairs') {
        this.cur = st.click_frame;
        this.source.request(st.click_frame, 1);
        const go = () => { if (this.intro.classList.contains('out') || !this.intro.isConnected) setTimeout(() => this.openStation(st), 250); else requestAnimationFrame(go); };
        go();
      } else if (ch && this.floor.chapters.some((c) => c.id === ch)) {
        const c = this.floor.chapters.find((x) => x.id === ch)!;
        this.cur = c.start * this.floor.meta.fps + 2;
        this.source.request(this.cur, 1);
        history.replaceState(null, '', location.pathname + location.search);
      } else {
        const go = () => { if (this.intro.classList.contains('out') || !this.intro.isConnected) setTimeout(() => this.handleHash(hash), 300); else requestAnimationFrame(go); };
        go();
      }
      return;
    }
    this.brain.startIntro();
    setTimeout(() => this.bubble.say(this.L.intro[0], 3.2), 500);
    setTimeout(() => {
      this.brain.endIntro();
      const coarse = matchMedia('(pointer: coarse)').matches;
      this.bubble.say(this.L.intro[1] ?? this.L.tutorial.look, 4);
      this.hint.innerHTML = '';
      this.hint.append(h('div', { class: 'finger' }), coarse ? h('span', {}, 'Swipe up to walk') : h('span', { html: 'Scroll or <kbd>W</kbd> / <kbd>↑</kbd> to walk' }));
      if (!this.moved) this.hint.classList.add('on');
    }, 3700);
  }

  private buildOutro() {
    this.outro = h('div', { class: 'outro', role: 'dialog', 'aria-label': 'The end' }, h('div', { class: 'inner' },
      h('img', { class: 'guide-art', src: asset('media/guide/hermes-front.png'), alt: 'The Hermes guide' }),
      h('h2', { html: "That's the <em>night</em>." }),
      h('p', { class: 'outro-line' }, ''),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { this.outro.classList.remove('on'); this.goFloor('downstairs', 0); } }, 'Walk it again'),
        h('a', { class: 'btn', href: `${BASE}stations/` }, 'All stations'),
        h('button', { class: 'btn', onclick: () => this.share('', 'Walk the Event'), html: `${icons.share} Share` }),
        h('a', { class: 'btn pink', href: 'https://hermes-agent.nousresearch.com/', target: '_blank', rel: 'noopener' }, 'Get Hermes Agent'),
      ),
      h('div', { class: 'credits', html: CREDITS }),
    ));
    this.root.append(this.outro);
  }

  // ---------------------------------------------------------------- side menu (floor, chapters, stations, actions, settings)
  private buildMenu() {
    const seg = (opts: [string, string][], cur: string, fn: (v: string) => void) => {
      const s = h('div', { class: 'seg' });
      for (const [v, l] of opts) {
        const b = h('button', { 'aria-pressed': String(v === cur) }, l);
        b.addEventListener('click', () => { s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); fn(v); });
        s.append(b);
      }
      return s;
    };
    const row = (label: string, ctl: HTMLElement) => h('div', { class: 'setrow', role: 'group', 'aria-label': label }, h('span', {}, label), ctl);
    const settings = h('div', { class: 'menu-settings' },
      row('Guide personality', seg([['hype', 'Hype Host'], ['curator', 'Curator'], ['hacker', 'Hacker']], this.preset, (v) => {
        this.preset = v; store('wte.preset', v); this.brain.lines = this.L; this.askD.fallback = this.L.ask_fallback;
        this.bubble.style = v === 'hacker' ? 'hacker' : 'default'; this.bubble.say(pick(this.L.idle), 3);
      })),
      row('Guide look', seg([['meshy', 'Sculpted'], ['toon', 'Illustrated']], this.guideKind, (v) => {
        store('wte.guide', v); toast('Switching guide…'); setTimeout(() => location.reload(), 400); })),
      row('Video quality', seg([['auto', 'Auto'], ['sd', '720p'], ['hd', '1080p']], store('wte.tier') || 'auto', (v) => {
        store('wte.tier', v === 'auto' ? '' : v); toast('Applies on reload'); })),
      row('Station transitions', seg([['quick', 'Quick'], ['cinematic', 'Cinematic (AI)']], store('wte.trans') === 'cinematic' ? 'cinematic' : 'quick', (v) => store('wte.trans', v))),
      row('Motion', seg([['full', 'Full'], ['reduced', 'Reduced']], reducedMotion() ? 'reduced' : 'full', (v) => store('wte.reduced', v === 'reduced' ? '1' : '0'))),
      h('div', { class: 'setrow note' }, h('span', {}, 'Captions'), h('span', {}, 'Always on: every line Hermes says is typed out on screen.')),
    );
    const m = this.menu = new SideMenu(this.root);
    m.onToggle = (on) => {
      this.menuBtn.setAttribute('aria-expanded', String(on));
      this.root.classList.toggle('menu-on', on);
      if (on) { this.holdDir = 0; this.pad.release(); this.syncMenuSeen(); }
    };
    m.head.prepend(h('div', { class: 'menu-brand' }, h('b', { html: 'Walk the <i>Event</i>' }), h('span', {}, 'NousCon · NYC 2026')));
    // floor switch
    const floor = h('div', { class: 'menu-floor', role: 'group', 'aria-label': 'Floor' });
    for (const [id, label] of [['downstairs', 'Downstairs'], ['upstairs', 'Upstairs']] as const) {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-current': 'false' }, label) as HTMLButtonElement;
      b.addEventListener('click', () => { if (this.floor.id !== id) { m.close(); this.goFloor(id); } });
      this.floorBtns.set(id, b);
      floor.append(b);
    }
    // quick actions
    const tile = (icon: string, label: string, fn: () => void, extra: Record<string, string> = {}) => {
      const b = h('button', { class: 'menu-tile', type: 'button', ...extra, html: `${icon}<span>${label}</span>` }) as HTMLButtonElement;
      b.addEventListener('click', () => { this.audio.blip(660); fn(); });
      return b;
    };
    this.menuSoundBtn = tile(icons.soundOff, 'Sound off', () => this.toggleSound(), { 'aria-pressed': 'false' });
    const tiles = h('div', { class: 'menu-tiles' },
      h('a', { class: 'menu-tile', href: `${BASE}map/`, html: `${icons.map}<span>Map</span>` }),
      tile(icons.chat, 'Ask Hermes', () => { m.close(); this.askD.open(); }),
      this.menuSoundBtn);
    const kicker = (t: string, link?: HTMLElement) => h('div', { class: 'menu-k' }, h('span', {}, t), link ?? null);
    m.body.append(
      floor,
      tiles,
      kicker('Chapters'),
      this.menuChapters,
      kicker('Stations', h('a', { class: 'menu-k-link', href: `${BASE}stations/`, html: `Gallery ${icons.arrow}` })),
      this.menuStations,
      h('div', { class: 'menu-sep' }),
      disclosure('Settings', icons.gear, settings),
      disclosure('About & credits', icons.spark, h('div', { class: 'credits' },
        h('p', {}, 'A scroll-driven walk through NousCon NYC 2026, built from the real footage. Hermes shows you around.'),
        h('p', { html: CREDITS }))),
    );
    for (const s of this.stations) {
      const b = h('button', { type: 'button', class: 'menu-item' },
        h('span', { class: 'mi-t' }, s.title), s.artist ? h('span', { class: 'mi-s' }, s.artist) : null) as HTMLButtonElement;
      b.dataset.id = s.id;
      b.addEventListener('click', () => { m.close(); if (this.open) this.closeStation(true); this.goStation(s); });
      this.menuStations.append(h('li', {}, b));
    }
    this.syncSound();
  }

  /** The current floor's chapters in the menu (rebuilt on every floor change). */
  private buildMenuLists() {
    this.menuChapters.innerHTML = '';
    this.chapterBtns.clear();
    const fps = this.floor.meta.fps;
    const t = this.cur / fps;
    this.floor.chapters.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'menu-item', 'aria-current': String(t >= c.start && t < c.end) },
        h('span', { class: 'mi-n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'mi-t' }, c.title)) as HTMLButtonElement;
      b.addEventListener('click', () => { this.menu.close(); if (this.open) this.closeStation(true); this.glideTo(c.start * fps + 2, 1.1); });
      this.chapterBtns.set(c.id, b);
      this.menuChapters.append(h('li', {}, b));
    });
    this.syncMenuSeen();
  }
  private syncMenuSeen() {
    for (const b of this.menuStations.querySelectorAll<HTMLElement>('.menu-item')) b.classList.toggle('seen', this.overlay.seen.has(b.dataset.id!));
  }

  private async enableGyro(on: boolean) {
    if (on) {
      const D = DeviceOrientationEvent as any;
      if (typeof D?.requestPermission === 'function') {
        try { if ((await D.requestPermission()) !== 'granted') { toast('Gyroscope not allowed'); return; } } catch { return; }
      }
      this.gyro = true;
      this.orient0 = null; // the way the phone is held when it's switched on is "straight ahead"
      addEventListener('deviceorientation', this.onOrient);
      toast('Tilt your phone to look around');
    } else {
      this.gyro = false;
      removeEventListener('deviceorientation', this.onOrient);
      this.lookTarget.set(0, 0);
    }
    this.tiltBtn?.classList.toggle('on', this.gyro);
    this.tiltBtn?.setAttribute('aria-pressed', String(this.gyro));
  }
  private orient0: [number, number] | null = null;
  private orientAt = 0;
  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;
    // screen axes: in landscape the phone's tilt axes swap (and flip with the side it's turned to)
    const ang = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
    const [x, y] = ang === 90 ? [e.beta, -e.gamma] : ang === -90 || ang === 270 ? [-e.beta, e.gamma] : ang === 180 ? [-e.gamma, -e.beta] : [e.gamma, e.beta];
    const now = performance.now(), dt = Math.min(0.2, (now - (this.orientAt || now)) / 1000);
    this.orientAt = now;
    if (!this.orient0) this.orient0 = [x, y];
    // "straight ahead" follows a new way of holding the phone over ~8 s, so the view never sticks at the edge
    const k = Math.min(1, dt / 8);
    this.orient0[0] += (x - this.orient0[0]) * k; this.orient0[1] += (y - this.orient0[1]) * k;
    if (this.open || this.inTransition) return; // (a station's own camera move owns the view)
    this.lookTarget.set(clamp((x - this.orient0[0]) / 18, -1, 1), clamp((y - this.orient0[1]) / 22, -1, 1));
  };

  private toggleSound() {
    this.audio.setMuted(!this.audio.muted);
    store('wte.muted', this.audio.muted ? '1' : '0');
    this.syncSound();
  }
  private syncSound() {
    const on = !this.audio.muted;
    this.soundBtn.innerHTML = on ? icons.soundOn : icons.soundOff;
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    this.menuSoundBtn.innerHTML = `${on ? icons.soundOn : icons.soundOff}<span>${on ? 'Sound on' : 'Sound off'}</span>`;
    this.menuSoundBtn.setAttribute('aria-pressed', String(on));
  }

  private share(hash: string, title: string) {
    const url = `${location.origin}${location.pathname}${hash}`;
    const copy = () => (navigator.clipboard ? navigator.clipboard.writeText(url).then(() => toast('Link copied')) : Promise.reject()).catch(() => toast(url));
    if (navigator.share) navigator.share({ title: `Walk the Event · ${title}`, url }).catch((e) => { if (e?.name !== 'AbortError') copy(); });
    else copy();
  }

  // ---------------------------------------------------------------- input
  private bindInput() {
    const root = this.root;
    const touched = () => {
      this.lastInput = performance.now();
      if (!this.moved) { this.moved = true; this.hint.classList.remove('on'); }
    };
    addEventListener('wheel', (e) => {
      if (!this.started || this.open || this.inTransition) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      this.vel = clamp(this.vel + d * 1.6, -135, 135);
      this.glide = null;
      touched();
    }, { passive: false });
    // touch / pointer: vertical drag walks, horizontal drag looks
    let p0: { x: number; y: number; t: number; id: number; axis: '' | 'x' | 'y'; lx: number; ly: number; lt: number; bubble: boolean } | null = null;
    root.addEventListener('pointerdown', (e) => {
      if (!this.started || this.open || this.inTransition || this.source.shown < 0) return; // (ignore until the first frame is up)
      if ((e.target as HTMLElement).closest('button,a,input,.drawer,.card,.menu')) return;
      // drags that start on the speech bubble still walk; a tap there is the bubble's own (skip / dismiss)
      const bubble = !!(e.target as HTMLElement).closest('.bubble');
      p0 = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, axis: '', lx: e.clientX, ly: e.clientY, lt: performance.now(), bubble };
      this.dragging = true;
      this.dragDir = 0;
      this.dragTo = null;
      this.glide = null;
      this.vel *= 0.3;
      this.glide = null;
    });
    root.addEventListener('pointermove', (e) => {
      if (!p0 || e.pointerId !== p0.id) {
        // desktop: gentle pointer parallax
        if (e.pointerType === 'mouse' && !this.gyro && this.started && !this.open) this.lookTarget.set((e.clientX / innerWidth - 0.5) * 0.7, (e.clientY / innerHeight - 0.5) * 0.4);
        return;
      }
      const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
      if (!p0.axis && Math.hypot(dx, dy) > 8) p0.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      const now = performance.now();
      const ddy = e.clientY - p0.ly, dt = Math.max(1, now - p0.lt) / 1000;
      if (p0.axis === 'y') {
        const k = e.pointerType === 'mouse' ? 0.45 : 0.6;
        // the finger sets where to walk to; the walk moves there at a capped, smooth pace (frame()), so a fast swipe
        // is a quick continuous dash (footage plays through, she sprints alongside), never a 12-second teleport
        this.dragTo = (this.dragTo ?? 0) - ddy * k; // frames still to travel (relative: outside jumps can't strand it)
        this.vel = clamp((-ddy * k) / dt, -135, 135);
        if (Math.abs(ddy) > 0.5) { this.dragDir = -Math.sign(ddy); this.dragMoveAt = now; }
        touched();
      } else if (p0.axis === 'x') {
        this.lookTarget.x = clamp(dx / (innerWidth * 0.35), -1, 1);
        this.lookTarget.y = clamp(dy / (innerHeight * 0.5), -1, 1);
        touched();
      }
      p0.lx = e.clientX; p0.ly = e.clientY; p0.lt = now;
    });
    const end = (e: PointerEvent) => {
      if (!p0 || e.pointerId !== p0.id) return;
      const moved = Math.hypot(e.clientX - p0.x, e.clientY - p0.y);
      if (moved < 10 && performance.now() - p0.t < 450 && !p0.bubble) this.tap(e.clientX, e.clientY);
      if (p0.axis === 'x' && !this.gyro) this.lookTarget.set(0, 0);
      this.vel = 0; // (user) stop on a dime: no fling; the walk settles within STOP_S of the finger lifting
      p0 = null;
      this.dragging = false;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // keyboard
    const keys = new Set<string>();
    addEventListener('keydown', (e) => {
      if (!this.started) { if (e.key === 'Enter') this.start(); return; }
      if (e.key === 'Escape') { if (this.menu.isOpen) this.menu.close(); else if (this.askD.isOpen) this.askD.close(); else if (this.open) this.closeStation(); return; }
      const k = e.key.toLowerCase();
      if (k === 'm') { this.toggleSound(); return; }
      if (this.open || this.inTransition) return;
      if (['w', 's', 'arrowup', 'arrowdown', 'shift', ' '].includes(k)) { keys.add(k === ' ' ? 'w' : k); e.preventDefault(); }
      if (k === 'a' || k === 'arrowleft') this.lookTarget.x = -0.8;
      if (k === 'd' || k === 'arrowright') this.lookTarget.x = 0.8;
      if (k === 'enter') {
        const s = this.overlay.live[0]?.s;
        if (s) { this.openStation(s); e.preventDefault(); }
      }
      this.holdDir = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      if (this.holdDir) touched();
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      keys.delete(k === ' ' ? 'w' : k);
      if (['a', 'd', 'arrowleft', 'arrowright'].includes(k) && !this.gyro) this.lookTarget.x = 0;
      this.holdDir = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      this.shiftHeld = keys.has('shift');
    });
    addEventListener('keydown', (e) => { if (e.key === 'Shift') this.shiftHeld = true; });
  }
  private shiftHeld = false;
  /** Beat times of the upstairs track (data/music_upstairs.json), for her dance-walk. */
  private musicBeats: number[] = [];
  /** Music beat clock: on the tracked beats of the track that is playing; muted, a steady 128 bpm. */
  private beatNow() {
    const t = this.floor.id === 'upstairs' ? this.audio.musicTime : null, B = this.musicBeats;
    if (t === null || B.length < 8 || t < B[0] || t >= B[B.length - 1]) return (performance.now() / 1000) * (128 / 60);
    let lo = 0, hi = B.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo]) / (B[lo + 1] - B[lo]);
  }

  private tap(x: number, y: number) {
    this.audio.ensure();
    const s = this.overlay.hit(x, y);
    if (s) { this.openStation(s); return; }
    // tapping the guide makes her react
    const hs = this.brain.headScreen();
    if (hs && Math.abs(hs.x - x) < 60 && y > hs.y - 20 && y < hs.y + 260) {
      this.brain.hop();
      this.bubble.say(pick(this.L.idle), 3);
    } else if (this.floor.id === 'upstairs') {
      // no stations up here: tapping the party gets a reaction
      this.brain.hop();
      this.brain.react(y < innerHeight * 0.4 ? 'up' : 'around');
      const det = this.L.upstairs_details ?? [];
      const t = this.cur / this.floor.meta.fps;
      const near = det.reduce((b, d) => (Math.abs(d.t - t) < Math.abs(b.t - t) ? d : b), det[0]);
      if (near) this.bubble.say(near.line, 3.2);
    }
  }

  glideTo(f: number, dur = 1.2, then?: () => void) {
    this.dragTo = null;
    f = clamp(f, 0, this.floor.end);
    if (reducedMotion()) { this.cur = f; this.vel = 0; this.glide = null; then?.(); return; }
    this.glide = { from: this.cur, to: f, t: 0, dur: Math.max(0.35, Math.min(dur, 0.4 + Math.abs(f - this.cur) / 900)), then };
    this.vel = 0;
    this.lastInput = performance.now();
  }

  async goFloor(id: FloorId, frame = 0) {
    if (this.open) this.closeStation(true);
    if (id === this.floor.id) { this.glideTo(frame, 1.2); return; }
    this.whip.classList.remove('go');
    void this.whip.offsetWidth;
    this.whip.classList.add('go');
    this.audio.whoosh();
    this.inTransition = true;
    await new Promise((r) => setTimeout(r, 450));
    await this.setFloor(id, frame, true);
    this.inTransition = false;
  }

  goStation(s: Station) {
    const go = () => this.glideTo(s.click_frame, 1.4, () => this.openStation(s));
    if (this.floor.id !== 'downstairs') this.goFloor('downstairs', Math.max(0, s.click_frame - 30)).then(go);
    else go();
  }

  handleHash(hash: string) {
    if (!hash) return;
    if (!hash.startsWith('#station-')) history.replaceState(null, '', location.pathname + location.search);
    const m = hash.match(/^#(floor-(down|up)|chapter-(.+)|station-(.+)|map)$/);
    if (!m) return;
    if (!this.started) this.start();
    if (m[1] === 'map') { location.href = `${BASE}map/`; return; }
    if (m[2]) { this.goFloor(m[2] === 'down' ? 'downstairs' : 'upstairs'); return; }
    if (m[3]) {
      for (const [fid] of [['downstairs'], ['upstairs']] as [FloorId][]) {
        const fl = this.floors.get(fid);
        const ch = fl?.chapters.find((c) => c.id === m[3]);
        if (ch && fl) { const f = ch.start * fl.meta.fps + 2; if (fid === this.floor.id) this.glideTo(f, 1.2); else this.goFloor(fid, f); return; }
      }
      if (!this.floors.get('upstairs')) loadFloor('upstairs').then((f) => { this.floors.set('upstairs', f); this.handleHash(hash); });
      return;
    }
    if (m[4]) { const s = this.stations.find((x) => x.id === m[4]); if (s) this.goStation(s); }
  }

  // ---------------------------------------------------------------- stations
  async openStation(s: Station) {
    if (this.open || this.inTransition) return;
    this.inTransition = true;
    this.root.classList.add('transitioning');
    this.returnFrame = this.cur;
    this.vel = 0;
    this.holdDir = 0;
    this.pad.release();
    this.audio.duck(true);
    this.audio.whoosh();
    this.bubble.hide();
    this.brain.hop();
    const poly = this.overlay.live.find((l) => l.s.id === s.id);
    const tr = s.screen_region_track;
    const idx = clamp(Math.round(this.cur) - tr.start, 0, tr.polys.length - 1);
    const pts = tr.polys[idx];
    let cu = 0, cv = 0;
    for (let k = 0; k < pts.length; k += 2) { cu += pts[k]; cv += pts[k + 1]; }
    cu /= pts.length / 2; cv /= pts.length / 2;
    if (s.offscreen) { cu = 0.02; cv = 0.45; }
    void poly;
    this.view.dolly.set(clamp(cu, 0.05, 0.95), clamp(cv, 0.1, 0.9), 0);
    const rm = reducedMotion();
    this.pod.setInset(...StationCard.podInset());
    this.usedClip = null;
    let cardOpened = false;
    const cinematic = store('wte.trans') === 'cinematic';
    if (cinematic && s.transition && !rm && Math.abs(this.cur - s.transition.first_frame) < 240) {
      // AI camera move: glide to the exact frame the clip starts on, then cut seamlessly into it.
      await new Promise<void>((r) => this.glideTo(s.transition!.first_frame, 0.3, () => r()));
      this.returnFrame = s.transition.first_frame;
      this.usedClip = s.transition;
      const podOpen = this.pod.open(s);
      await this.pod.playTransition(asset(s.transition.url), this.view.overscan, this.view.contain ? { x: this.view.offsetX, w: this.view.width } : undefined);
      void podOpen;
    } else {
      // Quick, clean move (default): straight from where you are, a half-second depth push into the station with
      // the pink sweep, then the photo pod fades in while the card slides up. No glide first, no wait.
      const dur = rm ? 0.01 : 0.5;
      this.pod.prepare(s);
      // the card starts sliding up as the push reaches ~60%, so the whole open lands in ~0.55 s
      const cardAt = (t: number) => { if (t >= 0.56 && !cardOpened) { cardOpened = true; this.card.open(s); } };
      if (s.offscreen && !rm) {
        // photo-only station off to the left: a quick look toward it, then cut
        await this.animate(0.42, (t) => { const e = t * t * (3 - 2 * t); this.lookTarget.set(-1, 0); this.view.look.set(-e, 0); this.view.sweep = t; cardAt(t); });
      } else {
        await this.animate(dur, (t) => {
          const e = t * t * t; // eases in: accelerates into the work
          this.view.dolly.z = e * 2.0;
          this.view.sweep = t;
          cardAt(t);
        });
      }
      this.pod.reveal(rm ? 0.12 : 0.16);
    }
    this.open = s;
    this.overlay.seen.add(s.id);
    this.rail.querySelector(`.dot[data-id="${s.id}"]`)?.classList.add('seen');
    if (!cardOpened) this.card.open(s);
    this.root.classList.remove('transitioning');
    history.replaceState(null, '', `#station-${s.id}`);
    this.inTransition = false;
    if (this.closeWhenOpen) { this.closeWhenOpen = false; this.closeStation(); }
  }

  async closeStation(instant = false) {
    const s = this.open;
    if (!s) return;
    this.open = null;
    this.inTransition = true;
    // focus was on Back, which slides off with the card: hand it to the walk's own control
    if (this.card.el.contains(document.activeElement)) this.pad.fwd.focus({ preventScroll: true });
    this.card.close();
    if (!this.usedClip?.reverse_url || instant || reducedMotion()) this.pod.close();
    setTimeout(() => this.bubble.say(pick(this.L.stations[s.id]?.close ?? ['Onward!']), 3.2), 900);
    history.replaceState(null, '', location.pathname + location.search);
    if (this.usedClip?.reverse_url && !instant && !reducedMotion()) {
      this.view.dolly.z = 0;
      this.view.fade = 1;
      this.cur = this.returnFrame;
      await this.pod.playTransition(asset(this.usedClip.reverse_url), this.view.overscan, this.view.contain ? { x: this.view.offsetX, w: this.view.width } : undefined);
      this.pod.close(0.2);
      this.audio.duck(false);
      this.inTransition = false;
      return;
    }
    // quick pull-back: the pod fades as the footage eases out of the push (0.4 s)
    await this.animate(instant || reducedMotion() ? 0.01 : 0.4, (t) => {
      const e = 1 - t;
      this.view.dolly.z = e * e * e * 1.6;
      this.view.sweep = 0;
    });
    this.view.dolly.z = 0;
    this.view.fade = 1;
    this.lookTarget.set(0, 0);
    this.cur = this.returnFrame >= 0 ? this.returnFrame : this.cur;
    this.audio.duck(false);
    this.inTransition = false;
  }

  private animate(dur: number, fn: (t: number) => void) {
    return new Promise<void>((res) => {
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur);
        fn(t);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      step();
    });
  }

  /**
   * The guide paces the tour. While she is leading (visible), the walk never moves the camera faster than she can
   * believably cover and keep framed: at most WALK_CAP_MS along the walked path (her run tops out ~6 m/s and she needs
   * headroom to turn and catch up), and at most PAN_CAP rad/s of camera turn where the path bends (at swipe speed the
   * footage's U-turns would otherwise whip past several times faster than a person can walk round them). The limit is
   * per footage frame, looked up a little ahead in the travel direction so the walk eases into a turn instead of
   * braking in it. Glides (stations, chapters, menu jumps) and transitions are cuts and are not capped. Drags still
   * respond on the first frame (the cap only limits top speed).
   * (user) Stop on a dime: the walk never keeps more than STOP_S of travel in hand. Finger travel beyond what she can
   * walk in that time is dropped, a swipe has no fling, and wheel / hold-to-walk speed dies away within ~0.3 s, so the
   * picture (and she) comes to rest as soon as the visitor stops; it used to coast on for up to 3 s.
   */
  private static readonly STOP_S = 0.3;
  private static readonly WALK_CAP_MS = 1.6; // (round 6: she is a walker (<= 2.3 m/s); pipeline/blocking.py solves her track against this cap)
  private static readonly PAN_CAP = 0.6; // (round 6c: a slower, steadier turn; nobody 3 m away stays in frame at 1 rad/s)
  private static readonly MAX_FPS = 75; // at most 2.5x real time while she leads (round 6c; the footage people move at real pace)
  private static readonly JOG_CAP_MS = 2.9; // (owner: a hard press jogs) her light jog, 2.6-3.4 m/s
  private static readonly JOG_MAX_FPS = 96;
  private walkCap: Float32Array = new Float32Array(0);
  private jogCap: Float32Array = new Float32Array(0);
  private buildWalkCap(fl: Floor) {
    const cam = fl.cam, n = cam.frames, fps = fl.meta.fps;
    const sx = new Float32Array(n), sz = new Float32Array(n), yaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let ax = 0, az = 0, c = 0;
      for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(n - 1, i + k)); ax += cam.pos[j * 3]; az += cam.pos[j * 3 + 2]; c++; }
      sx[i] = ax / c; sz[i] = az / c;
      const qx = cam.quat[i * 4], qy = cam.quat[i * 4 + 1], qz = cam.quat[i * 4 + 2], qw = cam.quat[i * 4 + 3];
      // camera forward (0,0,-1) rotated by q, projected on the floor
      const fx = -(2 * (qx * qz + qy * qw)), fz = -(1 - 2 * (qx * qx + qy * qy));
      yaw[i] = Math.atan2(fx, fz);
    }
    const raw = new Float32Array(n), rawJ = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 8), b = Math.min(n - 1, i + 8);
      const step = Math.min(0.08, Math.hypot(sx[b] - sx[a], sz[b] - sz[a]) / Math.max(1, b - a)); // m per frame
      let dy = yaw[b] - yaw[a]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const turn = Math.abs(dy) / Math.max(1, b - a); // rad per frame
      raw[i] = Math.min(WalkApp.WALK_CAP_MS / Math.max(0.004, step), WalkApp.PAN_CAP / Math.max(1e-4, turn), WalkApp.MAX_FPS);
      rawJ[i] = Math.min(WalkApp.JOG_CAP_MS / Math.max(0.004, step), WalkApp.PAN_CAP / Math.max(1e-4, turn), WalkApp.JOG_MAX_FPS);
    }
    // ease in: the cap at frame i is the lowest within the next ~20 frames either way (direction-agnostic window)
    this.walkCap = new Float32Array(n);
    this.jogCap = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = raw[i], mj = rawJ[i];
      for (let k = -20; k <= 20; k += 2) { const j = i + k; if (j >= 0 && j < n) { if (raw[j] < m) m = raw[j]; if (rawJ[j] < mj) mj = rawJ[j]; } }
      this.walkCap[i] = Math.max(fps * 0.8, m); // never slower than a stroll
      this.jogCap[i] = Math.max(this.walkCap[i], mj);
    }
  }
  /** Frames per second the walk may move at frame f right now (unlimited when the guide isn't leading). */
  private walkCapAt(f: number, dir: number) {
    // never outrun the downloaded footage. With plenty buffered there is no limit; close to the edge of what has
    // arrived the walk settles to the pace the footage is arriving at (a steady glide on a slow connection, ~1.5 s
    // of footage kept in hand) instead of the picture freezing while the scroll runs on, or stepping GOP by GOP
    const buf = this.source.bufferAhead(f, dir || 1);
    const bufCap = this.source.arrivalFps * THREE.MathUtils.clamp((buf - 15) / 30, 0, 1) + Math.max(0, buf - 45) * 2;
    // (round 6: the guide's pace cap applies from the first frame, also while she fades in: the blocking track
    // (pipeline/blocking.py) is solved against it)
    if (!this.walkCap.length || this.noGuide || !this.brain || this.inTransition) return bufCap;
    const cap = this.jogNow ? this.jogCap : this.walkCap;
    return Math.min(bufCap, cap[Math.max(0, Math.min(cap.length - 1, Math.round(f)))]);
  }

  // ---------------------------------------------------------------- main loop
  private frame(ts?: number) {
    // dt from the rAF timestamp (the display's own frame clock): performance.now() at callback time jitters with the
    // work done before it, and that jitter went straight into the guide's motion
    const now = ts ?? performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastT) / 1000));
    this.lastT = now;
    this.fpsTrace.push(dt);
    if (this.fpsTrace.length > 600) this.fpsTrace.shift();
    this.source.sampleArrival(dt);
    const N = this.floor.end + 1; // the walk ends here (upstairs before the footage does: see WALK_END)
    const prev = this.cur;
    this.jogNow = !this.open && !this.inTransition && !this.glide && ((this.pad.dir !== 0 && this.pad.jog) || (this.holdDir !== 0 && this.shiftHeld));
    if (this.glide) {
      const g = this.glide;
      g.t += dt / g.dur;
      this.cur = g.from + (g.to - g.from) * easeInOut(Math.min(1, g.t));
      if (g.t >= 1) { this.glide = null; g.then?.(); }
    } else if (this.dragTo !== null && !this.open && !this.inTransition) {
      // following the finger at most ~6x walking pace (ease out over the last few frames)
      // (and never faster than the guide can lead: walkCap, see buildWalkCap)
      // (owner, mobile) swiped and kept the finger down where it ended: she keeps walking that way at the
      // hold-to-walk pace until the finger lifts (or moves again)
      if (this.dragging && this.dragDir && now - this.dragMoveAt > 90) this.dragTo += this.dragDir * this.floor.meta.fps * 1.6 * dt;
      const lim = Math.max(3, this.walkCapAt(this.cur, Math.sign(this.dragTo)) * WalkApp.STOP_S);
      this.dragTo = Math.max(-lim, Math.min(lim, this.dragTo));
      const gap = this.dragTo, maxStep = Math.min(135, this.walkCapAt(this.cur, Math.sign(gap))) * dt; // under the keyframe-only threshold: every frame gets decoded
      const step = Math.max(-maxStep, Math.min(maxStep, gap * Math.min(1, dt * 12) + Math.sign(gap) * Math.min(Math.abs(gap), 30 * dt)));
      const before = this.cur;
      this.cur = clamp(this.cur + step, 0, this.floor.end);
      this.dragTo -= this.cur - before;
      if (this.cur === before && Math.abs(step) > 0) this.dragTo = 0; // hit the end of the floor
      if (Math.abs(this.dragTo) < 0.5 && !this.dragging) this.dragTo = null; // caught up and released
    } else if (!this.open && !this.inTransition) {
      this.pad.tick(dt);
      if (this.pad.dir) {
        // the walk pad: a slow walk (0.6x the filmed pace) to a brisk one (1.6x) by how hard it's pressed; hard: a jog
        const target = this.pad.dir * this.floor.meta.fps * this.pad.rate;
        this.vel += (target - this.vel) * Math.min(1, dt * (Math.abs(target) > Math.abs(this.vel) ? 4 : 6));
      } else if (this.holdDir) {
        // holding walk keys: a brisk walk (1.6x the filmed pace; the guide steps out with it), shift to jog
        const target = this.holdDir * this.floor.meta.fps * (this.shiftHeld ? 3.0 : 1.6);
        this.vel += (target - this.vel) * Math.min(1, dt * 5);
      } else {
        const near = this.overlay.live.some((l) => !this.overlay.seen.has(l.s.id) && !this.slowed.has(l.s.id));
        this.vel *= Math.exp(-dt * (near ? 12 : 8)); // (STOP_S: ~0.3 s from the last wheel tick / letting go of walk)
        if (near && Math.abs(this.vel) < 12) for (const l of this.overlay.live) this.slowed.add(l.s.id);
        if (Math.abs(this.vel) < 0.5) this.vel = 0;
      }
      // the guide paces the tour: never faster than she can lead (speed above her pace is dropped, not owed: STOP_S)
      const cap = this.walkCapAt(this.cur, Math.sign(this.vel));
      this.vel = Math.max(-cap, Math.min(cap, this.vel));
      this.cur += this.vel * dt;
    }
    // scrolled back from the end: the end screen gets out of the way
    if (this.outro.classList.contains('on') && this.cur < N - 30) this.outro.classList.remove('on');
    // end of floor: downstairs -> stairs moment, upstairs -> outro
    if (this.cur >= N - 1 && (this.vel > 20 || this.holdDir > 0 || this.pad.dir > 0) && !this.inTransition && !this.open) {
      this.atEndPush += dt;
      if (this.atEndPush > 0.35) { this.atEndPush = 0; this.vel = 0; this.endOfFloor(); }
    } else this.atEndPush = 0;
    this.cur = clamp(this.cur, 0, N - 1);
    const fps = (this.cur - prev) / Math.max(dt, 1e-3);
    if (Math.abs(this.cur - prev) > 0.01) this.dir = Math.sign(this.cur - prev);
    // moved by any means (rail, map, keys held): the "how to walk" hint has done its job
    if (!this.moved && this.started && Math.abs(fps) > 8 && !this.glide) { this.moved = true; this.hint.classList.remove('on'); }
    const fi = Math.round(this.cur);
    let _t = performance.now();
    if (fi !== this.lastReq) { this.source.request(fi, this.dir, fps); this.lastReq = fi; }
    // the last stretch downstairs: get the upstairs footage downloading, so the stairs cut doesn't wait for it
    if (this.floor.id === 'downstairs' && fi > this.floor.end - 400 && !this.sources.has('upstairs')) {
      const up = this.floors.get('upstairs');
      if (up) { const s = new FrameSource(asset('media/walk/upstairs'), up.meta, this.tier()); this.sources.set('upstairs', s); s.prefetch(0); }
    }
    this.source.tick(this.cur);
    if (this.perfEl) { this.pf.sec.src += performance.now() - _t; }
    // look-around eases toward its target (springs back when released)
    const lt = reducedMotion() ? this.lookTarget.clone().multiplyScalar(0.3) : this.lookTarget;
    this.view.look.lerp(lt, Math.min(1, dt * 6));
    // Render the camera at the frame actually on screen so the guide never swims against the footage.
    // (always the frame actually on screen, however far decoding lags a fast scroll: she and the glows stay locked
    // to the footage instead of being hidden while it catches up)
    const shownF = this.source.shown >= 0 ? this.source.shown + (this.source.shown === fi ? this.cur - fi : 0) : this.cur;
    this.view.setFrame(shownF);
    const gp = this.brain.rig.root.position;
    const gz = this.view.project(gp.clone().setY(gp.y + 0.9));
    this.view.updateProjection(gz ? this.view.disparityForDepth(gz.z) : 0.4);
    if (this.grid) { const c = this.view.camera.position; this.grid.position.set(Math.round(c.x), c.y - this.floor.cam.camera_height_m, Math.round(c.z)); }
    this.lightFromRoom(dt);
    const tS = shownF / this.floor.meta.fps;
    const darkK = this.floor.id === 'downstairs' ? Math.min(1, Math.max(0, (tS - 100.6) / 0.6)) * Math.min(1, Math.max(0, (113.4 - tS) / 0.6)) : 0;
    // auto exposure: lift dim stretches so you can see into the venue (highlight-safe curve in the shader), but leave
    // spaces that are genuinely dark alone (the black passage, near-black frames)
    {
      const ac = this.floor.meta.avg_colors_every_15, c = ac[Math.min(ac.length - 1, Math.floor(shownF / 15))];
      let want = 1;
      if (c) {
        const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        const lum = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
        // lighter overall (owner, three times: "lighten up the venue more", "brighten the venue a bit more"): every
        // lit space gets at least +65%, dim stretches up to 4x (the curve is highlight-safe, so lights and screens
        // don't clip; her lighting reads the footage as shown, so she brightens with it)
        const lift = Math.min(4.0, Math.max(1.65, 0.23 / Math.max(lum, 1e-3)));
        want = 1 + (lift - 1) * Math.min(1, Math.max(0, (lum - 0.012) / 0.01)); // fades out for already-dark spaces
      }
      this.autoExpo += (want - this.autoExpo) * Math.min(1, dt * 1.5);
    }
    this.view.exposure = darkK > 0 ? this.autoExpo + (1 + 5 * darkK - this.autoExpo) * darkK : this.autoExpo;
    if (darkK > 0) {
      guideUniforms.uTint.value.lerp(this.tmpC.setRGB(0.36, 0.4, 0.44), darkK);
      guideUniforms.uRim.value.setRGB(0.25, 0.95, 0.85);
      guideUniforms.uRimStrength.value = 0.85;
      // (the black passage keeps its deliberate teal-ghost look: no room light along her height there)
      for (const u of [guideUniforms.uBandLo, guideUniforms.uBandMid, guideUniforms.uBandHi]) u.value.lerp(this.tmpC.setRGB(1, 1, 1), darkK);
    }
    {
      const hs = this.brain.opacity > 0.3 ? this.brain.headScreen() : null;
      const ft = hs ? this.view.project(this.brain.rig.root.position) : null;
      this.overlay.avoid = hs && ft ? { x0: hs.x - (ft.y - hs.y) * 0.32, y0: hs.y - 6, x1: hs.x + (ft.y - hs.y) * 0.32, y1: hs.y + (ft.y - hs.y) * 0.42 } : null;
    }
    {
      // the pointer beam starts at her presenting hand (Meshy guide), or her chest (illustrated guide)
      const b = this.brain, an = b.anim as unknown as { pointW?: number; pointSide?: string };
      const ts = b.teaseStation;
      const k = an.pointW ?? (b.gesture === 'point' ? 1 : 0);
      const bones = (b.rig as unknown as { bones?: Record<string, THREE.Object3D> }).bones;
      const hand = bones?.[`${an.pointSide ?? 'Right'}Hand`];
      const wp = hand ? hand.getWorldPosition(this.tmpV) : this.tmpV.copy(b.rig.root.position).setY(b.rig.root.position.y + 1.1);
      const sp = ts && k > 0.02 && b.opacity > 0.5 ? this.view.project(wp) : null;
      this.overlay.pointer = sp && ts ? { x: sp.x, y: sp.y, id: ts.id, k } : null;
    }
    _t = performance.now();
    this.overlay.update(dt, shownF, this.floor.id);
    if (this.perfEl) { this.pf.sec.ovl += performance.now() - _t; }
    // load each pod on approach (a station going live), so opening it is instant
    for (const l of this.overlay.live) {
      if (this.prefetched.has(l.s.id)) continue;
      this.prefetched.add(l.s.id);
      { const im = new Image(); im.src = asset(l.s.hero_url); im.decode?.().catch(() => {}); }
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = asset(l.s.pod_url);
      document.head.append(link);
      if (l.s.transition) { const v = document.createElement('link'); v.rel = 'prefetch'; v.href = asset(l.s.transition.url); document.head.append(v); }
    }
    _t = performance.now();
    this.brain.update({
      // aim: where the scroll is heading (the swipe's target, or where the wheel's speed dies away): she sets off at once
      dt, frame: shownF, cur: this.cur, aim: this.glide ? this.glide.to : this.dragTo !== null ? this.cur + this.dragTo : this.cur + this.vel / 8, userFps: this.glide ? 0 : fps, idle: (now - this.lastInput) / 1000, gliding: !!this.glide,
      live: this.overlay.live.map((l) => l.s), stationRects: this.overlay.live.map((l) => ({ id: l.s.id, ...l.rect })),
      open: this.open, inTransition: this.inTransition || (!!this.glide && Math.abs(this.glide.to - this.glide.from) > 90),
      jog: this.jogNow, beat: this.beatNow(),
    });
    if (this.perfEl) { this.pf.sec.brain += performance.now() - _t; }
    this.bubble.update(dt, this.brain.opacity > 0.3 ? this.brain.headScreen() : null, innerWidth, innerHeight, this.overlay.tagBoxes);
    if (this.noGuide) this.brain.rig.root.visible = false; // ?noguide: perf comparison only
    const synced = this.started && this.source.shown >= 0;
    this.brain.rig.root.visible = this.brain.rig.root.visible && synced;
    this.overlay.canvas.style.opacity = synced ? '1' : '0';
    this.updateHud();
    if (this.perfEl) this.perfTick(now, dt);
    if (this.started && !this.open) this.view.adapt(dt);
    // a station pod covers the screen: don't draw the walk underneath (halves GPU work on phones)
    // a station pod or a full-screen AI clip covers the walk: don't draw it underneath (halves GPU work on phones)
    if (!((this.open && !this.inTransition && this.pod.covering) || this.pod.clipShowing)) {
      _t = performance.now();
      this.view.render();
      if (this.perfEl) { this.pf.sec.render += performance.now() - _t; _t = performance.now(); }
      if (this.source.shown >= 0 && !this.noSense) this.sense.update(this.view.renderer, this.view.tex, this.source.shown, this.floor, this.source.direct ? this.source.frame : this.source.canvas);
      if (this.perfEl) { this.pf.sec.sense += performance.now() - _t; }
    }
  }

  /**
   * Light her like the footage right around her, as she walks (DECISIONS 60). From the sense grid (the decoded frame
   * shrunk off the main thread, ~6 Hz; no GPU readback here):
   * - sky light = the colour around her upper body, ground bounce = the floor under her feet; their colour keeps the
   *   room light's saturation (a white dress under deep blue light is blue, not grey-blue) at the room's brightness;
   * - key light = the bright fixtures in the footage, weighted toward the ones right above her, placed at their own
   *   depth; its colour is theirs, its strength how much they stand out;
   * - along her height: feet / waist / head multipliers from the footage beside her legs, body and above her head, so
   *   a pool of light on the floor lights her legs and walking under a spot lights her hair and shoulders;
   * - floor shadows: a soft blob cast away from the key light (stronger the more directional the light) plus a dense
   *   contact shadow under each planted shoe (meshy.ts), both hidden by people in front of them.
   * The grid changes in ~6 Hz steps and flickering lights jump, so every value goes through two cascaded low-pass
   * stages (~0.3 s together): smooth, never popping, still quick enough to dim as she steps into a shadow.
   */
  private lightFromRoom(dt: number) {
    const se = this.sense, v = this.view;
    if (!se.ready || !this.brain || this.brain.opacity < 0.05) return;
    const p = this.brain.rig.root.position;
    const a = se.toImage(p), b = a && se.toImage(this.tmpV.copy(p).setY(p.y + 1.6), this.ltHead);
    if (!a || !b) return;
    const S = this.lt, now = performance.now();
    // not lit for a while (hidden, a pod open, a floor switch): she reappears already in this spot's light, instead of
    // visibly fading over from wherever she was last seen
    const fresh = this.roomLum < 0 || now - S.last > 300;
    S.last = now;
    if (fresh || se.frame !== S.frame || S.at.distanceToSquared(p) > 0.0025) {
      if (!this.sampleRoomLight(a, b, p, fresh || se.frame !== S.frame)) return;
      S.frame = se.frame; S.at.copy(p);
    }
    const t = S.tgt, s1 = S.s1, s2 = S.s2;
    if (fresh || !Number.isFinite(s2[0] + s2[6] + s2[9] + s2[12] + s2[15] + s2[19])) { s1.set(t); s2.set(t); this.roomLum = 0; }
    else {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) / 0.15);
      for (let i = 0; i < t.length; i++) { s1[i] += (t[i] - s1[i]) * k; s2[i] += (s1[i] - s2[i]) * k; }
    }
    const rc = this.tmpC.setRGB(s2[0], s2[1], s2[2]), fc = this.floorCol.setRGB(s2[3], s2[4], s2[5]);
    // brightness of the on-screen values (the room colours are in her output space, see asShown; the gains below were
    // tuned on the on-screen values, so her overall brightness per room is what it was: only the colour changed)
    const lum = shownLum(rc), flum = shownLum(fc);
    this.roomLum = lum;
    // Light in proportion to the footage around her (linear), so her white dress sits at roughly the room's own
    // brightness, a touch above it, with a small floor so she never vanishes in the dark.
    // (the floor and the gain were raised with the lighter venue: in deep blue rooms she read as a silhouette)
    const T = Math.min(1.7, 0.14 + 3.0 * lum + 0.8 * flum);
    const lk = THREE.MathUtils.clamp(s2[19], 0, 1);
    const ldir = this.lightDir.set(s2[15], s2[16], s2[17]);
    if (ldir.lengthSq() < 1e-6) ldir.set(-0.3, 0.8, 0.5);
    ldir.normalize();
    lightCol(rc, 0.92, v.hemi.color);
    lightCol(fc, 0.8, v.hemi.groundColor).multiplyScalar(THREE.MathUtils.clamp(0.3 + 0.6 * flum / Math.max(lum, 1e-3), 0.3, 1));
    v.hemi.intensity = 1.25 * T * (1 - 0.3 * lk);
    // key light: the room's light colour with a quarter of the fixtures' own (fixtures read near-white in the footage
    // because they clip; the light they throw is what colours the walls)
    v.key.color.copy(v.hemi.color).lerp(lightCol(this.tmpC2.setRGB(s2[20], s2[21], s2[22]), 0.92, this.tmpC2), 0.25);
    v.key.position.copy(p).addScaledVector(ldir, 5);
    v.key.target.position.copy(p);
    v.key.intensity = (0.55 + 0.85 * lk) * T;
    // along her height
    guideUniforms.uBandLo.value.setRGB(s2[6], s2[7], s2[8]);
    guideUniforms.uBandMid.value.setRGB(s2[9], s2[10], s2[11]);
    guideUniforms.uBandHi.value.setRGB(s2[12], s2[13], s2[14]);
    guideUniforms.uShine.value = Math.min(1.2, 0.25 + 0.55 * T + 0.4 * lk);
    // (owner: her hair adapts too) the hair highlight moves toward the key light as it gets directional (meshy.ts)
    guideUniforms.uKeyDir.value.copy(ldir); guideUniforms.uKeyK.value = lk;
    const rig = this.brain.rig as unknown as { contact?: THREE.Mesh; ground?: { ao: number } };
    const onFloor = 0.8 + 0.2 * Math.min(1, flum / 0.05); // shadows read a little more on a lit floor
    if (rig.contact) {
      // shadow falls away from the light: offset, rotate and stretch the contact blob in her local frame
      const contact = rig.contact;
      const yaw = this.brain.yaw, cy = Math.cos(-yaw), sy = Math.sin(-yaw);
      const lx = ldir.x * cy - ldir.z * sy, lz = ldir.x * sy + ldir.z * cy; // light dir in root space (horizontal)
      const L = Math.hypot(lx, lz) || 1, sx = -lx / L, sz = -lz / L;
      // a low light casts a longer shadow
      const len = lk * THREE.MathUtils.clamp(1.6 - 1.4 * ldir.y, 0.4, 1.2);
      contact.position.set(sx * 0.32 * len, 0.004, sz * 0.32 * len);
      contact.rotation.set(-Math.PI / 2, 0, Math.atan2(-sz, sx));
      contact.scale.set(1 + 1.1 * len, 1 - 0.15 * lk, 1);
      // the soft blob is the light's shadow, the dense part is under each shoe: lighter than the old 0.6-0.95 disc,
      // which read as a dark hole on dim floors
      (contact.material as THREE.MeshBasicMaterial).opacity = (0.42 + 0.33 * lk) * onFloor * this.brain.opacity;
    }
    if (rig.ground) rig.ground.ao = 0.62 * onFloor;
    // a light tint on top keeps the hair shine in the room's colour; the rim picks up the room's coloured light
    const mx = Math.max(rc.r, rc.g, rc.b, 1e-3), hue = this.tmpC2.setRGB(rc.r / mx, rc.g / mx, rc.b / mx);
    const hsl = hue.getHSL(this.ltHsl);
    guideUniforms.uTint.value.setRGB(1, 1, 1).lerp(hue, 0.2);
    guideUniforms.uRim.value.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.15), 0.6);
    guideUniforms.uRimStrength.value = 0.06 + 0.16 * (1 - Math.min(1, lum / 0.25)) * Math.min(1, 0.4 + lum * 20);
    if (this.lightDbg) (this as unknown as { __light: unknown }).__light = { T: +T.toFixed(3), lk: +lk.toFixed(3), lo: guideUniforms.uBandLo.value.getHexString(), mid: guideUniforms.uBandMid.value.getHexString(), hi: guideUniforms.uBandHi.value.getHexString() };
  }
  /** Smoothed room-light state: targets from the sense grid and two low-pass stages (see lightFromRoom). */
  private lt = {
    frame: -1, at: new THREE.Vector3(1e9, 0, 0), last: 0,
    // room rgb, floor rgb, band lo / mid / hi rgb, key dir xyz, (spare), key k, key colour rgb
    tgt: new Float32Array(23), s1: new Float32Array(23), s2: new Float32Array(23),
  };
  private floorCol = new THREE.Color(0.5, 0.5, 0.5);
  private ltHead = { u: 0, v: 0, z: 0 };
  private ltHsl = { h: 0, s: 0, l: 0 };
  private lightDbg = new URLSearchParams(location.search).has('lightdbg'); // (qa/tools/light_shots.py reads __light)
  private lightDir = new THREE.Vector3(-0.3, 0.8, 0.5).normalize();
  private ltDir = new THREE.Vector3(-0.3, 0.8, 0.5).normalize();
  private ltK = 0;
  private ltKeyCol = new THREE.Color(1, 1, 1);
  /** Read the targets for lightFromRoom from the sense grid. `full`: the grid itself changed (re-find the lights). */
  private sampleRoomLight(a: { u: number; v: number }, b: { u: number; v: number }, p: THREE.Vector3, full: boolean) {
    const se = this.sense, t = this.lt.tgt;
    const hgt = Math.max(0.02, a.v - b.v), w = Math.max(0.06, hgt * 0.45);
    const up = se.ambientAround(a.u - w * 1.4, b.v - 0.06, a.u + w * 1.4, (a.v + b.v) / 2, this.tmpC);
    if (!up) return false;
    const upC = this.tmpC2.copy(up);
    const lo = se.ambientAround(a.u - w * 1.6, a.v - 0.02, a.u + w * 1.6, a.v + 0.06, this.tmpC) ?? upC;
    this.asShown(upC); if (lo !== upC) this.asShown(lo);
    t[0] = upC.r; t[1] = upC.g; t[2] = upC.b; t[3] = lo.r; t[4] = lo.g; t[5] = lo.b;
    // along her height: the footage beside her legs (and the floor at her feet), beside her body, and around and
    // above her head (light-weighted, so the fixtures up there count). Each band is a multiplier around 1: its
    // brightness relative to the three (softened by a square root, clamped) and a little of its colour.
    const bands = this.ltBands;
    if (se.ambientAround(a.u - w * 1.4, b.v + 0.6 * hgt, a.u + w * 1.4, a.v + 0.05, bands[0])
      && se.ambientAround(a.u - w * 1.4, b.v + 0.2 * hgt, a.u + w * 1.4, b.v + 0.6 * hgt, bands[1])
      && se.ambientAround(a.u - w * 1.6, b.v - 0.45 * hgt, a.u + w * 1.6, b.v + 0.2 * hgt, bands[2], true)) {
      let ml = 0, mr = 0, mg = 0, mb = 0;
      for (let i = 0; i < 3; i++) { const c = this.asShown(bands[i]); ml += lumLin(c); mr += c.r; mg += c.g; mb += c.b; }
      ml = Math.max(ml / 3, 1e-4);
      const sum = Math.max(mr + mg + mb, 1e-4);
      for (let i = 0; i < 3; i++) {
        const c = bands[i], l = Math.max(lumLin(c), 1e-5), cs = Math.max(c.r + c.g + c.b, 1e-5);
        const g = THREE.MathUtils.clamp(Math.sqrt(l / ml), 0.7, i === 2 ? 1.45 : 1.3);
        // chroma relative to the average, 30 % of it (a red floor light warms her legs, it doesn't paint them)
        t[6 + i * 3] = g * bandChroma(c.r / cs, mr / sum); t[7 + i * 3] = g * bandChroma(c.g / cs, mg / sum); t[8 + i * 3] = g * bandChroma(c.b / cs, mb / sum);
      }
    } else for (let i = 6; i < 15; i++) t[i] = 1;
    if (full) this.lightDirection(p, a, b);
    t[15] = this.ltDir.x; t[16] = this.ltDir.y; t[17] = this.ltDir.z; t[18] = 0; t[19] = this.ltK;
    t[20] = this.ltKeyCol.r; t[21] = this.ltKeyCol.g; t[22] = this.ltKeyCol.b;
    // never let a bad sample into the filter (a NaN there would stay forever): neutral instead
    for (let i = 0; i < t.length; i++) if (!Number.isFinite(t[i])) t[i] = i >= 6 && i < 15 ? 1 : i === 16 ? 1 : 0;
    return true;
  }
  private ltBands = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  /**
   * Footage colour (linear, from the sense grid) -> the linear colour her material must output to look the same on
   * screen. The background shader applies the auto-exposure curve and writes the result to the screen as it is (no
   * sRGB encode), while her material's output is sRGB-encoded; so the room light she gets is the decoded on-screen
   * value. (Measured: screen pixels match curve(linear) within 3-6/255; lit with curve(linear) as if it were linear,
   * she came out ~45/255 too light and pale: grey-lavender in the deep blue rooms, the "pasted on" look.)
   */
  private asShown(c: THREE.Color) {
    const ex = this.view.bgExposure;
    return c.setRGB(shownLinear(c.r, ex), shownLinear(c.g, ex), shownLinear(c.b, ex));
  }
  /**
   * Where the light comes from: the cells that stand out in the upper part of the sensed frame (ceiling spots,
   * windows, screens), weighted toward the ones in her column and above her head, each placed in the room at its own
   * (sensed) depth along its ray from that frame's camera. Sets the direction from her toward them, how directional
   * the light is (0..1: how strongly they stand out) and their colour.
   */
  private lightDirection(her: THREE.Vector3, a: { u: number }, b: { v: number }) {
    const se = this.sense;
    if (!se.ready || !this.floor) return;
    const rows = Math.floor(GH * 0.6), col = se.color;
    let sum = 0, n = 0, mxNear = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < GW; i++) { const k = (j * GW + i) * 3; sum += 0.2126 * col[k] + 0.7152 * col[k + 1] + 0.0722 * col[k + 2]; n++; }
    const avg = sum / Math.max(1, n);
    const cam = this.floor.cam, f = se.frame, I = cam.intrinsics;
    // (hoisted out of the cell loop: the camera basis, her offset from the camera and the depth fit; this runs ~6x/s)
    const q = this.tmpQ.fromArray(cam.quat, f * 4);
    const cr0 = this.tmpV2.set(1, 0, 0).applyQuaternion(q), cu0 = this.tmpV5.set(0, 1, 0).applyQuaternion(q), cf0 = this.tmpV6.set(0, 0, -1).applyQuaternion(q);
    const hx = her.x - cam.pos[f * 3], hy = her.y - cam.pos[f * 3 + 1], hz = her.z - cam.pos[f * 3 + 2];
    const fit = se.fitAt?.(f), fa = fit ? fit[0] : cam.depth_a[f] ?? 1, fb = fit ? fit[1] : cam.depth_b[f] ?? 0.16;
    const acc = this.tmpV3.set(0, 0, 0), d = this.tmpV4;
    let tot = 0, cr = 0, cg = 0, cb = 0;
    for (let j = 0; j < rows; j++) for (let i = 0; i < GW; i++) {
      const c = j * GW + i, k = c * 3, l = 0.2126 * col[k] + 0.7152 * col[k + 1] + 0.0722 * col[k + 2];
      const u = (i + 0.5) / GW, vv = (j + 0.5) / GH, du = (u - a.u) / 0.22;
      const near = Math.exp(-du * du) * (vv < b.v + 0.08 ? 1 : 0.35);
      mxNear = Math.max(mxNear, l * (0.4 + 0.6 * near));
      let wgt = l - avg * 1.6;
      if (wgt <= 0) continue;
      wgt *= wgt * (0.3 + 1.7 * near);
      const z = Math.min(14, Math.max(1.5, 1 / Math.max(0.05, fa * se.depth[c] + fb)));
      const x = ((u - I.cx) / I.fx) * z, y = -((vv - I.cy) / I.fy) * z;
      d.set(cr0.x * x + cu0.x * y + cf0.x * z - hx, cr0.y * x + cu0.y * y + cf0.y * z - hy, cr0.z * x + cu0.z * y + cf0.z * z - hz).normalize();
      d.y = Math.max(0.4, d.y); // lights are above her
      acc.addScaledVector(d.normalize(), wgt);
      tot += wgt; cr += col[k] * wgt; cg += col[k + 1] * wgt; cb += col[k + 2] * wgt;
    }
    this.ltK = avg > 1e-4 && tot > 0 ? THREE.MathUtils.clamp((mxNear / avg - 1.8) / 5, 0, 1) : 0;
    if (tot > 0 && acc.lengthSq() > 1e-8) { this.ltDir.copy(acc).normalize(); this.asShown(this.ltKeyCol.setRGB(cr / tot, cg / tot, cb / tot)); }
  }
  private tmpQ = new THREE.Quaternion();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  private tmpV4 = new THREE.Vector3();
  private tmpV5 = new THREE.Vector3();
  private tmpV6 = new THREE.Vector3();
  /**
   * Build the splat renderer while the intro is on screen (a 2.8 MB module + a second WebGL context: a few hundred ms
   * of work that shows as nothing there). If the walk starts first, it is left to the first station open, where the
   * poster covers it: built mid-walk, even at a pause, it was a visible hitch.
   */
  private warmPodSoon() {
    // download first, evaluate only if the intro is still up when it has arrived (evaluated mid-walk it froze the
    // picture); otherwise the first station open evaluates it behind its poster
    this.pod.prefetch().then((cached) => (cached && this.started ? null : this.pod.preload())).then((mod) => {
      if (!mod) return;
      if (this.started) return;
      const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
      const go = () => { if (!this.started) this.pod.warm(); };
      if (ric) ric(go, { timeout: 1500 }); else go();
    });
  }
  private tmpC2 = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();

  private async endOfFloor() {
    if (this.floor.id === 'downstairs') {
      this.bubble.say(pick(this.L.stairs), 3);
      await new Promise((r) => setTimeout(r, 600));
      await this.goFloor('upstairs', 0);
    } else {
      (this.outro.querySelector('.outro-line') as HTMLElement).textContent = pick(this.L.outro);
      this.outro.classList.add('on');
    }
  }
}

export const CREDITS = `Footage, photos and station breakdowns by Bobby. Station texts are the artists' own wall cards:
<b>Self Portrait</b>, Joshua Wolk · <b>Mandala</b>, Kevin Esherick · <b>The Shape of Everything</b>, Jteve Sobs ·
<b>Persistence 2</b>, Morry Kolman · <b>Hermes Journey</b> and merch, <a href="https://nousresearch.com/" target="_blank" rel="noopener">Nous Research</a>.
The Hermes guide character belongs to <a href="https://nousresearch.com/" target="_blank" rel="noopener">Nous Research</a>; this 3D companion is a fan rendition.
Station pods are AI-reconstructed 3D photos (Apple SHARP, research licence). Station transitions are AI-assisted camera moves.
Not an official Nous Research site. Built with three.js and Spark.`;

// ---- room light helpers (App.lightFromRoom); module functions, so the per-frame lighting allocates nothing
/** Linear luminance. */
function lumLin(c: THREE.Color) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
/** Linear -> sRGB-encoded value. */
function encSrgb(x: number) { return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }
/** Luminance of the on-screen (encoded) values of a colour in her output space. */
function shownLum(c: THREE.Color) { return 0.2126 * encSrgb(c.r) + 0.7152 * encSrgb(c.g) + 0.0722 * encSrgb(c.b); }
/** One footage channel (linear) -> the background's exposure curve, shown as is -> decoded (see App.asShown). */
function shownLinear(x: number, ex: number) {
  const d = ex > 1.001 ? 1 - Math.pow(1 - Math.min(1, x), ex) : Math.min(1, x);
  return d <= 0.04045 ? d / 12.92 : Math.pow((d + 0.055) / 1.055, 2.4);
}
/** A band's channel share relative to the bands' average share, 30 % of it, clamped. */
function bandChroma(share: number, avgShare: number) {
  // (a channel that is black in all three bands, e.g. green and blue in the red room, has no share to compare: neutral)
  return avgShare > 1e-4 ? THREE.MathUtils.clamp(1 + (share / avgShare - 1) * 0.3, 0.75, 1.35) : 1;
}
/**
 * Light colour at unit luminance, keeping the room light's saturation (normalised by its luminance, not its brightest
 * channel, which turned saturated rooms into a pale wash; capped for near-pure hues); very dark samples are noisy, so
 * they get less colour.
 */
function lightCol(c: THREE.Color, sat: number, out: THREE.Color) {
  const l = lumLin(c), m = Math.max(c.r, c.g, c.b, 1e-5), n = Math.max(l, 0.3 * m, 1e-5);
  const k = sat * THREE.MathUtils.smoothstep(l, 0.0004, 0.004);
  return out.setRGB(1 + (c.r / n - 1) * k, 1 + (c.g / n - 1) * k, 1 + (c.b / n - 1) * k);
}
