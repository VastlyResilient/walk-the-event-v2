import type { DemuxMsg } from './demux.worker';

let worker: Worker | null = null;
let nextId = 0;
const listeners = new Map<number, (m: DemuxMsg) => void>();
/** Stream + demux a segment in the shared worker; `on` receives config, sample batches, then done (or error). */
function demux(url: string, on: (m: DemuxMsg) => void) {
  if (!worker) {
    worker = new Worker(new URL('./demux.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DemuxMsg>) => {
      const m = e.data;
      listeners.get(m.id)?.(m);
      if (m.type === 'done' || m.type === 'error') listeners.delete(m.id);
    };
  }
  const id = ++nextId;
  listeners.set(id, on);
  worker.postMessage({ id, url });
}

export interface WalkMeta {
  name: string;
  fps: number;
  frames: number;
  segment_frames: number;
  gop: number;
  segments: number;
  tiers: Record<string, { w: number; h: number; packed_w: number; bytes: number[] }>;
  avg_colors_every_15: [number, number, number][];
}

interface Segment {
  index: number;
  samples: { data: Uint8Array; key: boolean }[]; // grows as the download streams in
  config: VideoDecoderConfig;
  total: number;
  done: Promise<void>;
  complete: boolean;
}

/**
 * Frame-accurate footage source. Decodes whole GOPs with WebCodecs into a bounded cache of
 * VideoFrames and draws the requested frame into a 2D canvas (which three.js uploads). If
 * WebCodecs is unavailable it seeks <video> elements instead (same files: closed GOP, no B-frames).
 */
export class FrameSource {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private segs = new Map<number, Promise<Segment>>();
  private ready = new Map<number, Segment>();
  private cache = new Map<number, VideoFrame>();
  private decoder: VideoDecoder | null = null;
  private decoderCodec = '';
  private queue: { g: number; key: boolean }[] = []; // GOPs to decode (global frame of the keyframe); key = keyframe only
  private full = new Set<number>(); // GOPs whose every frame is decoded and cached
  private ahead = 3; // GOPs decoded ahead of the playhead
  private lastDir = 1;
  private fastAt = 0;
  private settleAt = 0; // when the last keyframe-only request was made (0 = none pending)
  private inflight = new Set<number>();
  private busy = false;
  private drawn = -1;
  private maxFrames: number;
  private fallback: HTMLVideoElement | null = null;
  private fallbackSeg = -1;
  private fallbackSeeking = false;
  private fallbackWant = -1;
  shown = -1;
  onDrawn: (f: number) => void = () => {};
  /** Fired when the source stops handing out VideoFrames (it fell back to <video>): the view rebuilds its texture. */
  onModeChange: () => void = () => {};
  /** The decoded frame on screen (WebCodecs path); the view uploads it straight to a texture. */
  frame: VideoFrame | null = null;
  bytesLoaded = 0;

  constructor(public base: string, public meta: WalkMeta, public tier: 'sd' | 'hd') {
    const t = meta.tiers[tier];
    this.canvas.width = t.packed_w;
    this.canvas.height = t.h;
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings)!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const mobile = matchMedia('(pointer: coarse)').matches;
    // the cache must hold the whole look-ahead window (ahead + current + one behind), or decoded frames are
    // evicted before they're shown and decoded again (that thrash was the phone stutter)
    this.ahead = mobile ? 2 : 3;
    this.maxFrames = (this.ahead + 2) * meta.gop + 6;
    if (!('VideoDecoder' in window) || new URLSearchParams(location.search).has('novc')) this.initFallback();
    this.direct = !this.fallback && canUploadVideoFrame();
  }

  /** WebCodecs frames go straight to WebGL when the browser can upload a VideoFrame; otherwise via the 2D canvas. */
  direct = false;

  /** Switch to drawing decoded frames into the 2D canvas (when direct upload turns out not to work). */
  useCanvas() { this.direct = false; this.frame = null; this.drawn = -1; if (this.pending >= 0) this.draw(this.pending); }

  get usingWebCodecs() {
    return !this.fallback;
  }

  url(seg: number) {
    return `${this.base}/${this.tier}_${String(seg).padStart(2, '0')}.mp4`;
  }

  /** Resolves as soon as the segment's header has arrived; its samples keep arriving (seg.done when complete). */
  private loadSegment(i: number): Promise<Segment> {
    if (i < 0 || i >= this.meta.segments) return Promise.reject(new Error('range'));
    let p = this.segs.get(i);
    if (p) return p;
    p = new Promise<Segment>((resolve, reject) => {
      let seg: Segment | null = null;
      let finish!: () => void, fail!: (e: Error) => void;
      const done = new Promise<void>((a, b) => { finish = a; fail = b; });
      done.catch(() => {});
      demux(new URL(this.url(i), location.href).href, (m) => {
        if (m.type === 'config') {
          seg = {
            index: i, samples: [], total: m.total, done, complete: false,
            config: { codec: m.codec, codedWidth: m.width, codedHeight: m.height, description: m.description, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true },
          };
          this.ready.set(i, seg);
          resolve(seg);
        } else if (m.type === 'samples' && seg) {
          for (let k = 0; k < m.keys.length; k++) seg.samples[m.start + k] = { data: m.data.subarray(m.offsets[k], m.offsets[k + 1]), key: !!m.keys[k] };
          this.arrived += m.keys.length;
          if (this.starved) { this.starved = false; this.pump(); }
        } else if (m.type === 'done') {
          this.bytesLoaded += m.bytes;
          if (seg) seg.complete = true;
          finish();
        } else if (m.type === 'error') {
          this.segs.delete(i);
          if (this.ready.get(i) === seg) this.ready.delete(i);
          const err = new Error(m.error);
          fail(err);
          reject(err);
        }
      });
    });
    this.segs.set(i, p);
    p.catch(() => this.segs.delete(i));
    return p;
  }
  /** A GOP was wanted before its samples had streamed in: pump again when more arrive. */
  private starved = false;

  /**
   * Keep the segments around the playhead loaded, nearest first in the travel direction, one download at a time
   * (parallel downloads split the bandwidth and finish late together; on a phone connection that was a footage
   * freeze while the scroll ran on). Segments outside the window are dropped.
   */
  private ensureWindow(si: number, dir: number) {
    const sgn = dir >= 0 ? 1 : -1;
    const order = [si, si + sgn, si + 2 * sgn, si - sgn, si + 3 * sgn].filter((k) => k >= 0 && k < this.meta.segments);
    this.wantSegs = order;
    for (const k of [...this.segs.keys()]) if (!order.includes(k) && Math.abs(k - si) > 3) { this.segs.delete(k); this.ready.delete(k); }
    this.fetchNext();
  }
  private wantSegs: number[] = [];
  private fetching = -1;
  private fetchNext() {
    if (this.fetching >= 0) return;
    const k = this.wantSegs.find((x) => !this.segs.has(x));
    if (k === undefined) return;
    this.fetching = k;
    const t0 = performance.now();
    this.loadSegment(k).then((seg) => seg.done).then(
      () => { const sec = (performance.now() - t0) / 1000; this.mbps = (this.meta.tiers[this.tier].bytes[k] * 8) / 1e6 / Math.max(sec, 0.05); },
      () => {},
    ).finally(() => { this.fetching = -1; this.fetchNext(); });
  }
  /** Last measured download speed (Mbit/s), from the most recent segment. */
  mbps = 0;
  private arrived = 0;
  private arrT = 0;
  /** Footage frames arriving per second (smoothed over ~1.5 s); 0 while nothing is downloading. */
  arrivalFps = 0;
  /** Update the arrival rate (called once per animation frame). */
  sampleArrival(dt: number) {
    this.arrT += dt;
    if (this.arrT < 0.25) return;
    const inst = this.fetching >= 0 ? this.arrived / this.arrT : 0;
    this.arrivalFps += (inst - this.arrivalFps) * Math.min(1, this.arrT / 1.5);
    this.arrived = 0; this.arrT = 0;
  }

  /** Frames from f in the travel direction whose footage is downloaded (the walk may not outrun this). */
  bufferAhead(f: number, dir: number): number {
    if (this.fallback) return 1e9;
    const S = this.meta.segment_frames, N = this.meta.frames;
    let si = Math.floor(f / S);
    // frames available in a segment: all of it once complete, else what has streamed in so far (from its start)
    const have = (k: number) => { const g = this.ready.get(k); return !g ? 0 : g.complete ? g.total : g.samples.length; };
    if (!this.ready.has(si)) return 0;
    if (dir >= 0) {
      while (have(si) >= (this.ready.get(si)!.total) && si + 1 < this.meta.segments && this.ready.has(si + 1)) si++;
      const last = si * S + have(si) - 1;
      return last >= N - 1 ? 1e9 : last - f; // loaded through the end of the footage: nothing left to wait for
    }
    // backwards needs whole segments (decoding starts at a GOP's keyframe, which is behind us)
    if (!this.ready.get(si)!.complete) return 0;
    while (si - 1 >= 0 && this.ready.get(si - 1)?.complete) si--;
    return si === 0 ? 1e9 : f - si * S;
  }

  /** Start downloading around a frame without showing anything (the next floor, while this one ends). */
  prefetch(frame = 0) { if (!this.fallback) this.ensureWindow(Math.floor(frame / this.meta.segment_frames), 1); }

  /** Preload the first segment so the first frame can show immediately. */
  async prime(frame = 0) {
    if (this.fallback) { this.request(frame, 1); return; }
    const si = Math.floor(frame / this.meta.segment_frames);
    this.ensureWindow(si, 1);
    await this.loadSegment(si);
    this.request(frame, 1);
  }

  /** Ask for frame f (direction = sign of travel) and draw the best frame available now. */
  request(f: number, dir: number, speed = 0) {
    f = Math.max(0, Math.min(this.meta.frames - 1, Math.round(f)));
    if (this.fallback) return this.requestFallback(f);
    const G = this.meta.gop;
    const S = this.meta.segment_frames;
    const g0 = Math.floor(f / G) * G;
    const sgn = dir >= 0 ? 1 : -1;
    this.lastDir = sgn;
    const ok = (g: number) => g >= 0 && g < this.meta.frames && !this.inflight.has(g);
    this.fastAt = Math.abs(speed) > 140 ? performance.now() : 0;
    if (Math.abs(speed) > 140) {
      // flying through (fast fling / glide): only every frame we can actually show matters. Decode keyframes
      // only (1 decode per GOP instead of 10); the full GOP fills in once the visitor slows down.
      this.queue = [g0, g0 + sgn * G, g0 + sgn * 2 * G].filter((g) => ok(g) && !this.cache.has(g)).map((g) => ({ g, key: true }));
    } else {
      const want: number[] = [g0];
      for (let k = 1; k <= this.ahead; k++) want.push(g0 + sgn * k * G);
      want.push(g0 - sgn * G);
      this.queue = want.filter((g) => ok(g) && !this.full.has(g)).map((g) => ({ g, key: false }));
    }
    this.ensureWindow(Math.floor(f / S), dir);
    this.pump();
    this.evict(f);
    this.draw(f);
  }

  private nearestCached(f: number) {
    if (this.cache.has(f)) return f;
    let best = -1, bd = 1e9;
    for (const k of this.cache.keys()) {
      const d = Math.abs(k - f);
      if (d < bd) { bd = d; best = k; }
    }
    return bd <= 12 ? best : -1;
  }

  private draw(f: number) {
    const k = this.nearestCached(f);
    if (k < 0 || (k === this.drawn && (!this.direct || this.frame === this.cache.get(k)))) return; // (re-decoded frames replace the cached one)
    const vf = this.cache.get(k)!;
    try {
      if (this.direct) this.frame = vf;
      else this.ctx.drawImage(vf, 0, 0, this.canvas.width, this.canvas.height);
      this.drawn = k;
      this.shown = k;
      this.onDrawn(k);
    } catch {
      /* frame closed underneath us; next request redraws */
    }
  }

  private evict(f: number) {
    if (this.cache.size <= this.maxFrames) return;
    // farthest first, and frames behind the direction of travel count as twice as far
    const G = this.meta.gop, d = this.lastDir;
    const cost = (k: number) => { const off = (k - f) * d; return off < 0 ? -off * 2 : off; };
    const keys = [...this.cache.keys()].sort((a, b) => cost(b) - cost(a));
    for (const k of keys) {
      if (this.cache.size <= this.maxFrames) break;
      if (k === this.drawn) continue;
      this.cache.get(k)!.close();
      this.cache.delete(k);
      this.full.delete(Math.floor(k / G) * G);
    }
  }

  private ensureDecoder(cfg: VideoDecoderConfig) {
    if (this.decoder && this.decoder.state !== 'closed' && this.decoderCodec === cfg.codec) return this.decoder;
    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: (vf) => {
        const f = Math.round(vf.timestamp / 1000);
        const old = this.cache.get(f);
        if (old && old !== vf) old.close();
        this.cache.set(f, vf);
      },
      error: (e) => {
        console.warn('decoder error', e);
        this.decoder = null;
        // a decoder that never produced a frame and keeps failing won't start: play the clips through <video> instead
        if (++this.decodeErrors >= 3 && this.shown < 0 && !this.cache.size) this.toFallback();
      },
    });
    this.decoder.configure(cfg);
    this.decoderCodec = cfg.codec;
    return this.decoder;
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const { g, key } = this.queue.shift()!;
        if (this.inflight.has(g) || (key ? this.cache.has(g) : this.full.has(g))) continue;
        const S = this.meta.segment_frames;
        const si = Math.floor(g / S);
        let seg = this.ready.get(si);
        if (!seg) {
          try { seg = await this.loadSegment(si); } catch { continue; }
        }
        const start = g - si * S;
        const end = key ? Math.min(start + 1, seg.total) : Math.min(start + this.meta.gop, seg.total);
        let arrived = true;
        for (let i = start; i < end; i++) if (!seg.samples[i]) { arrived = false; break; }
        if (!arrived) { this.queue.unshift({ g, key }); this.starved = true; break; } // still streaming in
        // some browsers ship WebCodecs but reject this stream: ask once, before the first decode, and fall back
        if (this.configOk === null) {
          this.configOk = await VideoDecoder.isConfigSupported(seg.config).then((r) => !!r.supported, () => true);
          if (!this.configOk) { this.toFallback(); return; }
        }
        this.inflight.add(g);
        const dec = this.ensureDecoder(seg.config);
        try {
          for (let i = start; i < end; i++) {
            const s = seg.samples[i];
            dec.decode(new EncodedVideoChunk({ type: i === start || s.key ? 'key' : 'delta', timestamp: (si * S + i) * 1000, data: s.data }));
          }
          await dec.flush();
          // only mark the GOP complete if every frame is actually cached (an eviction may have landed mid-decode)
          if (!key) { let all = true; for (let i = 0; i < end - start; i++) if (!this.cache.has(g + i)) { all = false; break; } if (all) this.full.add(g); }
        } catch { /* decoder reset by an error: the GOP is re-queued on the next request */ } finally {
          this.inflight.delete(g);
        }
        if (this.pending >= 0) this.draw(this.pending);
      }
    } finally {
      this.busy = false;
    }
  }

  pending = -1;
  /** Called every animation frame with the frame we'd like to show. */
  tick(f: number) {
    this.pending = Math.round(f);
    if (this.fallback) return;
    // the fling/jump is over: fill in the full GOP so the exact frame shows; keep asking until it does
    const now = performance.now();
    if (this.fastAt && now - this.fastAt > 110) { this.request(this.pending, this.lastDir, 0); this.settleAt = now; }
    else if (!this.fastAt && this.shown !== this.pending && !this.busy && now - this.settleAt > 150) { this.settleAt = now; this.request(this.pending, this.lastDir, 0); }
    this.draw(this.pending);
  }

  // ---- <video> fallback ------------------------------------------------------------
  private configOk: boolean | null = null;
  private decodeErrors = 0;
  private toFallback() {
    if (this.fallback) return;
    console.warn('WebCodecs cannot decode this walk here: using <video>');
    this.queue = [];
    try { this.decoder?.close(); } catch { /* already closed by its error */ }
    this.decoder = null;
    for (const vf of this.cache.values()) vf.close();
    this.cache.clear(); this.full.clear();
    this.initFallback();
    this.useCanvas();
    this.onModeChange();
    this.requestFallback(Math.max(0, this.pending));
  }

  private initFallback() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.addEventListener('seeked', () => {
      this.fallbackSeeking = false;
      try {
        this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
        const f = this.fallbackSeg * this.meta.segment_frames + Math.round(v.currentTime * this.meta.fps - 0.5);
        this.shown = f;
        this.onDrawn(f);
      } catch { /* not ready */ }
      if (this.fallbackWant >= 0) { const w = this.fallbackWant; this.fallbackWant = -1; this.requestFallback(w); }
    });
    this.fallback = v;
  }

  private requestFallback(f: number) {
    const v = this.fallback!;
    const S = this.meta.segment_frames;
    const si = Math.floor(f / S);
    if (this.fallbackSeeking) { this.fallbackWant = f; return; }
    if (si !== this.fallbackSeg) {
      this.fallbackSeg = si;
      v.src = this.url(si);
      v.load();
    }
    const t = (f - si * S + 0.5) / this.meta.fps;
    if (Math.abs(v.currentTime - t) < 0.5 / this.meta.fps && this.shown === f) return;
    this.fallbackSeeking = true;
    v.currentTime = t;
  }

  dispose() {
    for (const vf of this.cache.values()) vf.close();
    this.cache.clear();
    this.full.clear();
    this.decoder?.close();
  }
}

let uploadOk: boolean | null = null;
/** Can WebGL2 take a VideoFrame as a texture source here? (Checked once with a 2x2 frame.) */
function canUploadVideoFrame() {
  if (uploadOk !== null) return uploadOk;
  uploadOk = false;
  try {
    if (new URLSearchParams(location.search).has('nodirect') || typeof VideoFrame === 'undefined') return uploadOk;
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    c.getContext('2d')!.fillRect(0, 0, 2, 2);
    const vf = new VideoFrame(c, { timestamp: 0 });
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, vf as unknown as TexImageSource);
      uploadOk = gl.getError() === gl.NO_ERROR;
      gl.deleteTexture(t);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    vf.close();
  } catch { uploadOk = false; }
  return uploadOk;
}
