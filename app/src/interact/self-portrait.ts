import './self-portrait.css';
import { h } from '../ui/dom';
import type { Ix, IxCtx } from './index';
import { btn, ico, img, loop, onResize } from './common';
import { LABEL, renderFrame, shapePath, type Shape } from './self-portrait-frame';
import { createRenderer, type DrawState, type Renderer } from './self-portrait-gl';
import { decodeLm, feat, loadTracker, matcher, type Feat, type Portrait, type Sitter, type Tracked, type Tracker } from './self-portrait-face';

/*
 * "Self Portrait" (Joshua Wolk), interpreted. From the card: in a row of gilded frames a camera studies the face of
 * whoever stands before it, searches centuries of portraiture from the Met, the Art Institute of Chicago and the
 * Cleveland Museum of Art for a matching pose and expression, then lays the painted face over the living one.
 *
 * Here: MediaPipe Face Landmarker (self-hosted, loaded only after "Use my camera") tracks 478 landmarks, head pose and
 * expression; the nearest of 24 public-domain portraits from those three museums is picked (pose first, expression
 * second, with hysteresis), and its painted face is warped onto yours over the face mesh in WebGL, inside a gilded
 * frame with an old-master finish. Until the camera is switched on, a demo sitter (CC0 photographs of real people)
 * shows the effect. Nothing leaves the device. This is not the artist's code.
 */

const DIR = 'media/interact/self-portrait/';
const SHAPES: Shape[] = ['rect', 'arch', 'oval'];
const SHAPE_ICON: Record<Shape, string> = {
  rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="1"/></svg>',
  arch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 20.5V10a6 6 0 0 1 12 0v10.5z"/></svg>',
  oval: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="12" rx="6.5" ry="8.5"/></svg>',
};
const SCAN_S = 1.9; // the "studying your face" moment

type Phase = 'away' | 'scan' | 'shown';

/** source-normalised -> out-normalised affine (column-major 2x3), built in source pixels so rotation keeps its shape. */
function viewMatrix(out: Float32Array, srcW: number, srcH: number, aspect: number, cx: number, cy: number, ch: number, rot = 0, rcx = cx, rcy = cy) {
  const cw = ch * aspect;
  const c = Math.cos(rot), s = Math.sin(rot);
  const x0 = cx - cw / 2, y0 = cy - ch / 2;
  // P' = R (P - Rc) + Rc, P = (x*srcW, y*srcH); out = (P' - C0) / (cw, ch)
  out[0] = (c * srcW) / cw; out[1] = (s * srcW) / ch;
  out[2] = (-s * srcH) / cw; out[3] = (c * srcH) / ch;
  out[4] = (rcx - (c * rcx - s * rcy) - x0) / cw;
  out[5] = (rcy - (s * rcx + c * rcy) - y0) / ch;
  return out;
}

/** data: URL -> Blob, synchronously (keeps the share inside the tap's user activation). */
function dataUrlToBlob(url: string) {
  const [head, b64] = url.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.slice(5, head.indexOf(';')) });
}

export async function mount(ctx: IxCtx): Promise<Ix> {
  const { stage, dock, signal } = ctx;
  const base = ctx.asset(DIR);
  const [lib, demo] = await Promise.all([
    fetch(base + 'portraits.json').then((r) => r.json() as Promise<{ portraits: Portrait[] }>),
    fetch(base + 'demo.json').then((r) => r.json() as Promise<{ sitters: Sitter[] }>),
  ]);
  const P = lib.portraits;
  const PL = P.map((p) => decodeLm(p.lm));
  const PF: Feat[] = P.map((p) => feat(p, p.bs));
  const sitters = demo.sitters.map((s) => ({ s, im: img(base + s.img) }));
  await sitters[0].im; // the first demo sitter is on screen at once

  // ---------------------------------------------------------------- DOM
  stage.classList.add('sp');
  const pic = h('canvas', { class: 'sp-pic', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const gilt = h('canvas', { class: 'sp-gilt', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const prompt = h('div', { class: 'sp-prompt', 'aria-live': 'polite' }, 'come closer');
  const scanText = h('div', { class: 'sp-scan', 'aria-live': 'polite' });
  const frameEl = h('div', { class: 'sp-frame', role: 'img', 'aria-label': 'Your portrait in a gilded frame' }, h('span', { class: 'sp-cam' }, h('i')), pic, gilt, prompt, scanText);
  const thumb = h('img', { class: 'sp-thumb', alt: '', decoding: 'async', crossorigin: 'anonymous' }) as HTMLImageElement;
  const tTitle = h('p', { class: 'sp-title' });
  const tBy = h('p', { class: 'sp-by' });
  const tMus = h('a', { class: 'sp-mus', target: '_blank', rel: 'noopener' }) as HTMLAnchorElement;
  const tNote = h('p', { class: 'sp-meta' });
  const label = h('div', { class: 'sp-label' }, thumb, h('div', { class: 'sp-text' }, tTitle, tBy, tMus, tNote));
  const toast = h('div', { class: 'ix-toast' });
  stage.append(h('div', { class: 'sp-wall' }), frameEl, label, toast);
  let toastT = 0;
  const say = (t: string, ms = 2800) => { toast.textContent = t; toast.classList.add('on'); clearTimeout(toastT); toastT = window.setTimeout(() => toast.classList.remove('on'), ms); };

  const camBtn = btn('Use my camera', { cls: 'pink', icon: ico.camera, aria: 'Use my camera (stays on this device)' });
  const seg = h('div', { class: 'ix-seg sp-seg', role: 'group', 'aria-label': 'Frame shape' });
  const segBtns = SHAPES.map((s) => {
    const b = h('button', { 'aria-pressed': 'false', 'aria-label': `${LABEL[s]} frame`, title: `${LABEL[s]} frame`, html: SHAPE_ICON[s] });
    b.addEventListener('click', () => setShape(s), { signal });
    seg.append(b);
    return b;
  });
  const snapBtn = btn('Save', { cls: 'round sp-save', icon: ico.snap, aria: 'Save this portrait' });
  snapBtn.querySelector('span')?.remove();
  snapBtn.title = 'Save this portrait';
  dock.append(camBtn, seg, snapBtn);

  // ---------------------------------------------------------------- renderer
  // the most frontal painting is the reference layout for the per-vertex feathering
  const refI = P.reduce((b, p, i) => (Math.abs(p.yaw) + Math.abs(p.roll) < Math.abs(P[b].yaw) + Math.abs(P[b].roll) ? i : b), 0);
  let R: Renderer;
  try { R = createRenderer(pic, PL[refI], ctx.coarse ? 'low' : 'high'); }
  catch (e) { stage.classList.remove('sp'); throw e; }

  // ---------------------------------------------------------------- portraits (images load on demand)
  const imCache = new Map<number, Promise<HTMLImageElement>>();
  const portraitImg = (i: number) => { let p = imCache.get(i); if (!p) { p = img(base + P[i].img); p.catch(() => imCache.delete(i)); imCache.set(i, p); } return p; };
  let shownI = -1; // painting in slot 0
  let fadeT = 1, fading = false, pendingI = -1;
  async function showPortrait(i: number, instant = false) {
    if (i === shownI) { if (!fading) setCaption(i); return; }
    if (i === pendingI) return;
    pendingI = i;
    let im: HTMLImageElement;
    try { im = await portraitImg(i); } catch { pendingI = -1; return; }
    if (disposed || pendingI !== i) return;
    pendingI = -1;
    const p = P[i];
    if (shownI < 0 || instant) { R.setPortrait(0, im, PL[i], p.skin, p.skinSd); shownI = i; fading = false; fadeT = 1; }
    else { R.setPortrait(1, im, PL[i], p.skin, p.skinSd); fading = true; fadeT = 0; nextI = i; }
    setCaption(i);
  }
  let nextI = -1;
  function setCaption(i: number) {
    const p = P[i];
    thumb.src = base + p.thumb;
    thumb.alt = `${p.title}, ${p.artist}`;
    tTitle.textContent = p.title;
    tBy.textContent = p.date ? `${p.artist}, ${p.date}` : p.artist;
    tMus.textContent = p.museum;
    tMus.href = p.url;
    tMus.title = `${p.title} at ${p.museum} (${p.license})`;
    label.classList.add('on');
  }
  const flickerCaption = (k: number) => {
    const p = P[k];
    thumb.src = base + p.thumb; thumb.alt = '';
    tTitle.textContent = p.title; tBy.textContent = p.artist; tMus.textContent = p.museum; tMus.removeAttribute('href');
  };
  const match = matcher(PF, 0.6);

  // ---------------------------------------------------------------- shared tracking state
  const NL = 478;
  const sm = new Float32Array(NL * 2), smZ = new Float32Array(NL), tgt = new Float32Array(NL * 2), tgtZ = new Float32Array(NL);
  let hasFace = false, smInit = false;
  let curFeat: Feat | null = null;
  const vMean = [0.6, 0.45, 0.36], vSd = [0.1, 0.09, 0.08];
  const view = new Float32Array(6);
  let phase: Phase = 'away', phaseT = 0, presentT = 0, absentT = 9, faceMix = 0, scanBest = -1, lastFlick = -1;
  // camera framing (source px), smoothed
  const cam = { cx: 0, cy: 0, ch: 0, init: false };

  // ---------------------------------------------------------------- demo sitter
  let mode: 'demo' | 'starting' | 'live' = 'demo';
  let demoI = 0, demoT = 0, demoMirror = false;
  const DEMO_LEN = ctx.reduced ? 9 : 12;
  let demoLm = decodeLm(sitters[0].s.lm);
  function setSitter(i: number, mirror: boolean) {
    demoI = i; demoMirror = mirror && !!sitters[i].s.mirror;
    const s = sitters[i].s, d = demoMirror ? s.mirror! : s;
    demoLm = decodeLm(d.lm);
    vMean.splice(0, 3, ...d.skin); vSd.splice(0, 3, ...d.skinSd);
    sitters[i].im.then((im) => { if (!disposed && mode === 'demo' && demoI === i) R.setSource(im, im.naturalWidth, im.naturalHeight, demoMirror); });
    tNote.textContent = `Demo sitter: CC0 photo by ${s.artist.split(' ').slice(0, 2).join(' ')}, via Wikimedia Commons`;
    match.reset();
  }
  // the order runs frontal-smiling, turned-and-looking-up, neutral-with-a-tilt, then the turn mirrored
  const DEMO_SEQ: [number, boolean][] = [[0, false], [1, false], [2, false], [1, true]];
  let demoSeq = 0;
  setSitter(...DEMO_SEQ[0]);
  for (const s of sitters) s.im.catch(() => {});
  const ease = (x: number) => x * x * (3 - 2 * x);

  function demoStep(dt: number) {
    demoT += dt;
    if (demoT >= DEMO_LEN) { demoT = 0; demoSeq = (demoSeq + 1) % DEMO_SEQ.length; setSitter(...DEMO_SEQ[demoSeq]); phase = 'away'; presentT = 0; }
    const s = sitters[demoI].s, d = demoMirror ? s.mirror! : s;
    const t = demoT, m = ctx.reduced ? 0 : 1;
    // steps up to the frame (0-1.6 s), stays, steps back at the end
    const near = ctx.reduced ? 1 : t < 1.2 ? 0 : t < 2.6 ? ease((t - 1.2) / 1.4) : t < DEMO_LEN - 1.4 ? 1 : 1 - ease((t - (DEMO_LEN - 1.4)) / 1.4);
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (let i = 0; i < NL; i++) { const x = demoLm[i * 2], y = demoLm[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const sw = s.w, shh = s.h, fcx = ((x0 + x1) / 2) * sw, fcy = ((y0 + y1) / 2) * shh, fh = (y1 - y0) * shh;
    const want = fh / 0.4, far = Math.min(shh, sw / aspect);
    const ch = Math.min(far, far + (want - far) * near);
    const breath = Math.sin(t * 1.6) * 0.008 * m, sway = Math.sin(t * 0.55 + demoI) * m;
    const rot = sway * 0.05; // about +-3 degrees of head tilt
    const chh = ch * (1 - breath);
    const cx = Math.min(Math.max(fcx + sway * fh * 0.06, (chh * aspect) / 2), sw - (chh * aspect) / 2);
    const cy = Math.min(Math.max(fcy + chh * 0.06, chh / 2), shh - chh / 2);
    viewMatrix(view, sw, shh, aspect, cx, cy, chh, rot, fcx, fcy);
    sm.set(demoLm); smInit = true; hasFace = true;
    curFeat = feat({ yaw: d.yaw, pitch: d.pitch, roll: d.roll - (rot * 180) / Math.PI }, d.bs);
    return near > 0.92;
  }

  // ---------------------------------------------------------------- camera
  let video: HTMLVideoElement | null = null, stream: MediaStream | null = null;
  let tracker: Tracker | null = null, trackerP: Promise<Tracker> | null = null;
  // the frame handed to the tracker: the camera, mirrored and at most 512 px (an OffscreenCanvas when it can go to a worker)
  const det: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
  const dg = det.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  let lastVideoT = -1, lastUpT = -1, lastSendT = 0, statT = 0, detCount = 0, detMs = 0;
  function onTracked(r: Tracked | null, ms: number) {
    if (disposed || mode === 'demo') return;
    detMs += ms; detCount++;
    if (!r) { hasFace = false; return; }
    tgt.set(r.lm.subarray(0, NL * 2)); tgtZ.set(r.z.subarray(0, NL));
    if (!smInit || !hasFace) { sm.set(tgt); smZ.set(tgtZ); smInit = true; }
    hasFace = true;
    curFeat = feat(r.pose, r.bs);
    if (r.skin) for (let c = 0; c < 3; c++) { vMean[c] += (r.skin[c] - vMean[c]) * 0.5; vSd[c] += (Math.max(0.03, r.skin[c + 3]) - vSd[c]) * 0.5; }
  }

  async function startCam() {
    if (mode !== 'demo') { stopCam(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { say('No camera here: showing the demo sitter'); return; }
    camBtn.classList.add('busy');
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        stream = null;
        say((e as DOMException)?.name === 'NotAllowedError' ? 'Camera permission denied: showing the demo sitter' : 'Camera unavailable: showing the demo sitter');
        return;
      }
      if (disposed) { stopCam(); return; }
      video = h('video', { playsinline: true, muted: true, autoplay: true }) as HTMLVideoElement;
      video.muted = true; video.playsInline = true;
      video.srcObject = stream;
      try { await video.play(); } catch { /* autoplay of a muted inline video: fine to continue */ }
      if (disposed || !video) { stopCam(); return; }
      mode = 'starting';
      stage.classList.add('live');
      camBtn.querySelector('span')!.textContent = 'Stop camera';
      camBtn.classList.remove('pink');
      camBtn.setAttribute('aria-label', 'Stop the camera');
      R.setSource(video, video.videoWidth || 640, video.videoHeight || 480, true);
      cam.init = false; phase = 'away'; presentT = 0; absentT = 9; faceMix = 0; hasFace = false; smInit = false; match.reset();
      label.classList.remove('on'); // the demo's painting isn't yours: the caption returns with your own match
      tNote.textContent = 'Your camera stays on this device: nothing is uploaded or saved.';
      say('Camera on: it stays on this device');
      scanText.textContent = 'loading the face model…';
      scanText.classList.add('on');
      try {
        trackerP ??= loadTracker(ctx.asset, onTracked);
        const tr = await trackerP;
        if (disposed) return;
        tracker = tr;
      } catch (e) {
        console.warn('face tracking failed', e);
        trackerP = null;
        stopCam();
        say('Face tracking could not start here: showing the demo sitter');
        return;
      }
      scanText.classList.remove('on');
      if (mode === 'starting') mode = 'live';
    } finally { camBtn.classList.remove('busy'); }
  }
  function stopCam() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video = null; }
    stage.classList.remove('live');
    camBtn.querySelector('span')!.textContent = 'Use my camera';
    camBtn.classList.add('pink');
    camBtn.setAttribute('aria-label', 'Use my camera (stays on this device)');
    scanText.classList.remove('on');
    if (mode !== 'demo') {
      mode = 'demo';
      demoT = 0; phase = 'away'; presentT = 0; faceMix = 0;
      setSitter(...DEMO_SEQ[demoSeq]);
      if (shownI >= 0) setCaption(shownI);
    }
  }
  camBtn.addEventListener('click', startCam, { signal });

  function track(now: number) {
    if (!video || !tracker || video.readyState < 2 || tracker.busy) return;
    if (video.currentTime === lastVideoT || now - lastSendT < 28) return; // a new camera frame, at most ~35 per second
    lastVideoT = video.currentTime; lastSendT = now;
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.min(1, 512 / Math.max(vw, vh));
    const w = Math.round(vw * k), hh = Math.round(vh * k);
    if (det.width !== w || det.height !== hh) { det.width = w; det.height = hh; }
    // the tracker sees the mirror image, so everything downstream (pose, match, warp) is in the picture's own space
    dg.setTransform(-1, 0, 0, 1, w, 0);
    dg.drawImage(video, 0, 0, w, hh);
    const stats = now - statT > 250; // the sitter's skin colour, a few times a second
    if (stats) statT = now;
    try { tracker.send(det, now, stats); } catch (e) { console.warn(e); }
  }

  // ---------------------------------------------------------------- layout (from the stage's own size)
  let shape: Shape = 'rect';
  let aspect = 0.8; // picture (sight) aspect, set by layout
  let giltKey = '';
  let frameB = 0;
  function setShape(s: Shape) {
    shape = s;
    segBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(SHAPES[i] === s)));
    frameEl.dataset.shape = s;
    giltKey = '';
    layout();
  }
  function layout() {
    const sr = stage.getBoundingClientRect();
    const W = sr.width, H = sr.height;
    if (W < 10 || H < 10) return;
    const root = stage.closest('.ix');
    const head = root?.querySelector<HTMLElement>('.ix-head');
    const titles = head?.querySelector<HTMLElement>('.ix-titles');
    let top = 12;
    if (head && titles && getComputedStyle(head).display !== 'none') top = Math.max(12, titles.getBoundingClientRect().bottom - sr.top + 10);
    let bottom = 12;
    const kids = [...dock.children] as HTMLElement[];
    if (kids.length) bottom = Math.max(12, sr.bottom - Math.min(...kids.map((k) => k.getBoundingClientRect().top)) + 10);
    const expand = root?.querySelector<HTMLElement>('.ix-expand');
    const expandW = expand && getComputedStyle(expand).display !== 'none' ? 52 : 0;
    const aw = W - 24, ah = H - top - bottom;
    // two arrangements: label under the frame, or beside it; take whichever gives the bigger picture
    const LH = ah > 300 ? 58 : 50;
    const fhStack = Math.min(ah - LH - 10, aw * 1.25);
    const gap = aw >= 560 ? 28 : 14;
    const lwSide = Math.min(300, Math.max(136, aw * (aw >= 560 ? 0.26 : 0.34)));
    const fhSide = Math.min(ah, (aw - lwSide - gap) * 1.25);
    const side = fhSide > fhStack * 1.05;
    let fw: number, fh: number, lw: number;
    if (side) {
      lw = lwSide; fh = fhSide; fw = fh * 0.8;
      const gx = 12 + (aw - (fw + gap + lw)) / 2, gy = top + (ah - fh) / 2;
      frameEl.style.cssText = `left:${gx}px;top:${gy}px;width:${fw}px;height:${fh}px`;
      label.dataset.layout = 'side';
      label.dataset.size = lw < 200 ? 's' : 'l';
      label.dataset.tight = String(ah < 330);
      label.style.cssText = `left:${gx + fw + gap}px;top:0;width:${lw}px`;
      // keep the (vertically centred) label inside the free band between the head and the dock
      const lh = label.offsetHeight, want = gy + fh * (aw >= 560 ? 0.6 : 0.5);
      label.style.top = `${Math.max(top + lh / 2, Math.min(H - bottom - lh / 2, want))}px`;
    } else {
      fh = fhStack; fw = fh * 0.8;
      const gy = top + Math.max(0, (ah - fh - LH - 10) / 2);
      frameEl.style.cssText = `left:${(W - fw) / 2}px;top:${gy}px;width:${fw}px;height:${fh}px`;
      lw = Math.min(aw - expandW, Math.max(fw + 40, 260));
      label.style.cssText = `left:${(W - lw) / 2}px;top:${gy + fh + 10}px;width:${lw}px;height:${LH}px`;
      label.dataset.layout = 'stack';
    }
    frameEl.style.setProperty('--fw', `${fw}px`);
    // gilded frame bitmap (re-rendered only when its size or shape changes)
    const d = Math.min(devicePixelRatio || 1, 2);
    const gw = Math.round(fw * d), gh = Math.round(fh * d);
    const key = `${shape}:${gw}x${gh}`;
    if (key !== giltKey) {
      giltKey = key;
      const fr = renderFrame(shape, gw, gh);
      gilt.width = gw; gilt.height = gh;
      gilt.getContext('2d')!.drawImage(fr.canvas, 0, 0);
      frameB = fr.B / d;
    }
    // the picture sits under the moulding, clipped to the sight shape
    const inset = frameB * 0.85;
    const pw = fw - inset * 2, ph = fh - inset * 2;
    aspect = pw / ph;
    let radius = '0';
    if (shape === 'oval') radius = '50%';
    else if (shape === 'arch') radius = `${pw / 2}px ${pw / 2}px 0 0 / ${pw / 2}px ${pw / 2}px 0 0`;
    else radius = `${Math.max(0, fw * 0.012 - inset * 0.02)}px`;
    pic.style.cssText = `left:${inset}px;top:${inset}px;width:${pw}px;height:${ph}px;border-radius:${radius}`;
    const cap = ctx.coarse ? 520 : 680;
    const pd = Math.min(d, cap / pw);
    R.resize(pw * pd, ph * pd);
    prompt.style.top = `${inset + ph * (shape === 'rect' ? 0.06 : 0.12)}px`;
    scanText.style.bottom = `${inset + ph * (shape === 'oval' ? 0.1 : 0.05)}px`;
  }
  setShape('rect');
  const unobsStage = onResize(stage, layout);
  const unobsDock = onResize(dock, layout);
  requestAnimationFrame(layout);

  // ---------------------------------------------------------------- snapshot
  snapBtn.addEventListener('click', () => {
    const OW = 1080, FH = 1350, OH = 1530;
    const out = document.createElement('canvas');
    out.width = OW; out.height = OH;
    const g = out.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 0, OH);
    bg.addColorStop(0, '#2a1230'); bg.addColorStop(1, '#0d060d');
    g.fillStyle = bg; g.fillRect(0, 0, OW, OH);
    const fr = renderFrame(shape, OW, FH);
    const inset = fr.B * 0.85;
    // paint this frame once more at print size (inside this task, so the canvas still holds it), then restore
    const [cw0, ch0] = [pic.width, pic.height];
    R.resize(OW - inset * 2, FH - inset * 2);
    R.redraw();
    g.save();
    g.beginPath(); shapePath(g, shape, OW, FH, inset); g.clip();
    g.drawImage(pic, inset, inset, OW - inset * 2, FH - inset * 2);
    g.restore();
    R.resize(cw0, ch0);
    R.redraw();
    g.drawImage(fr.canvas, 0, 0);
    g.textAlign = 'center';
    g.fillStyle = '#f3e3c3';
    g.font = 'italic 40px Georgia, serif';
    if (shownI >= 0 && phase === 'shown') {
      const p = P[shownI];
      g.fillText(`after ${p.title}`, OW / 2, FH + 66, OW - 80);
      g.font = '26px Georgia, serif';
      g.fillStyle = 'rgba(243,227,195,.75)';
      g.fillText(`${p.artist}${p.date ? `, ${p.date}` : ''} · ${p.museum}`, OW / 2, FH + 108, OW - 80);
    } else g.fillText('Self Portrait', OW / 2, FH + 80);
    g.font = '20px system-ui, sans-serif';
    g.fillStyle = 'rgba(243,227,195,.45)';
    g.fillText('Interpretive recreation of Self Portrait by Joshua Wolk · not the original work', OW / 2, OH - 34, OW - 80);
    const blob = dataUrlToBlob(out.toDataURL('image/jpeg', 0.92));
    const file = new File([blob], 'self-portrait-recreation.jpg', { type: 'image/jpeg' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    let canShareFile = false;
    try { canShareFile = ctx.coarse && typeof navigator.share === 'function' && !!nav.canShare?.({ files: [file] }); } catch { canShareFile = false; }
    if (canShareFile) {
      navigator.share({ files: [file], title: 'My old-master portrait' })
        .then(() => say('Portrait shared'))
        .catch((e: unknown) => { if ((e as DOMException)?.name !== 'AbortError') download(blob, file.name); });
      return;
    }
    download(blob, file.name);
  }, { signal });
  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, rel: 'noopener' }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    say('Portrait saved');
  }

  // ---------------------------------------------------------------- frame loop
  let disposed = false;
  let fpsN = 0, fpsT = 0;
  const st: DrawState = { view, face: null, mix: [0, 0], vMean, vSd, light: [0.5, 0.42], lightR: 0.3, scan: 0, box: [0, 0, 1, 1], lines: 0 };
  const box = [0, 0, 0, 0];
  const stop = loop((dt) => {
    if (R.lost) return;
    const now = performance.now();
    fpsN++; fpsT += dt;
    if (fpsT >= 1) {
      stage.dataset.fps = String(Math.round(fpsN / fpsT));
      stage.dataset.tfps = String(Math.round(detCount / fpsT));
      stage.dataset.tms = detCount ? (detMs / detCount).toFixed(1) : '0';
      stage.dataset.match = shownI >= 0 ? P[shownI].id : '';
      stage.dataset.phase = phase;
      fpsN = 0; fpsT = 0; detCount = 0; detMs = 0;
    }
    let big = false;
    if (mode === 'demo') {
      big = demoStep(dt);
    } else if (video && video.readyState >= 2) {
      if (video.currentTime !== lastUpT) { lastUpT = video.currentTime; R.updateSource(); }
      track(now);
      const vw = video.videoWidth, vh = video.videoHeight;
      // smooth the landmarks: quick when the head moves, steady when it rests
      if (hasFace) {
        let mv = 0;
        for (let i = 0; i < NL * 2; i += 16) mv += Math.abs(tgt[i] - sm[i]);
        mv /= NL / 8;
        const k = 1 - Math.pow(1 - Math.min(0.92, 0.35 + mv * 60), dt * 60);
        for (let i = 0; i < NL * 2; i++) sm[i] += (tgt[i] - sm[i]) * k;
        for (let i = 0; i < NL; i++) smZ[i] += (tgtZ[i] - smZ[i]) * k;
      }
      // frame the face like a portrait: a slow camera operator, face at about 40% of the picture's height
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      if (hasFace) for (let i = 0; i < NL; i++) { const x = sm[i * 2], y = sm[i * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const fhp = (y1 - y0) * vh;
      big = hasFace && fhp / vh > 0.17;
      const full = Math.min(vh, vw / aspect);
      let tch = full, tcx = vw / 2, tcy = vh / 2;
      if (hasFace) { tch = Math.min(full, Math.max(fhp / 0.4, fhp / 0.62)); tcx = ((x0 + x1) / 2) * vw; tcy = ((y0 + y1) / 2) * vh + tch * 0.06; }
      if (!cam.init) { cam.cx = tcx; cam.cy = tcy; cam.ch = tch; cam.init = true; }
      const kc = 1 - Math.exp(-dt * (hasFace ? 3.2 : 1.2));
      cam.ch += (tch - cam.ch) * kc; cam.cx += (tcx - cam.cx) * kc; cam.cy += (tcy - cam.cy) * kc;
      const ch = Math.min(cam.ch, full), cw = ch * aspect;
      const cx = Math.min(Math.max(cam.cx, cw / 2), vw - cw / 2), cy = Math.min(Math.max(cam.cy, ch / 2), vh - ch / 2);
      viewMatrix(view, vw, vh, aspect, cx, cy, ch);
      if (mode === 'starting') big = false;
    }

    // phase: away ("come closer") -> scan ("studying your face") -> shown (the painted face)
    if (big) { presentT += dt; absentT = 0; } else { absentT += dt; presentT = 0; }
    phaseT += dt;
    const setPhase = (p: Phase) => { phase = p; phaseT = 0; };
    if (phase === 'away' && presentT > 0.3 && curFeat) { setPhase('scan'); scanBest = -1; }
    else if (phase === 'scan') {
      if (!big && absentT > 0.5) setPhase('away');
      else if (phaseT > SCAN_S * 0.45 && scanBest < 0 && curFeat) { scanBest = match.best(curFeat); portraitImg(scanBest).catch(() => {}); }
      else if (phaseT >= (ctx.reduced ? 0.7 : SCAN_S) && scanBest >= 0) { match.reset(); match.push(PF[scanBest], 0); showPortrait(scanBest, true); setPhase('shown'); }
    } else if (phase === 'shown') {
      if (absentT > (mode === 'demo' ? 0.2 : 1.4)) setPhase('away');
      else if (curFeat && big && !fading) { const i = match.push(curFeat, dt); if (i !== shownI && i >= 0) showPortrait(i); }
    }
    // overlays
    prompt.classList.toggle('on', phase === 'away' && mode !== 'starting');
    if (phase === 'scan') {
      const half = phaseT < SCAN_S * 0.45;
      scanText.textContent = half ? 'studying your face…' : `searching ${P.length} portraits…`;
      scanText.classList.add('on');
      if (!half && !ctx.reduced) { const k = Math.floor(phaseT * 14) % P.length; if (k !== lastFlick) { lastFlick = k; flickerCaption((k * 7) % P.length); } }
    } else if (mode !== 'starting') scanText.classList.remove('on');

    // the painted face fades in after the scan and out when the sitter leaves
    const wantMix = phase === 'shown' && hasFace && big ? 1 : 0;
    faceMix += (wantMix - faceMix) * (1 - Math.exp(-dt * (wantMix ? 3.5 : 8)));
    if (fading) {
      fadeT = Math.min(1, fadeT + dt / 0.45);
      if (fadeT >= 1) { R.swapSlots(); shownI = nextI; fading = false; }
    }
    st.mix[0] = faceMix * (fading ? 1 - fadeT : 1);
    st.mix[1] = fading ? faceMix * fadeT : 0;
    st.face = smInit && hasFace ? { lm: sm, z: mode === 'demo' ? null : smZ } : null;
    // light and scan box follow the face (in picture coordinates)
    if (st.face) {
      let bx0 = 9, by0 = 9, bx1 = -9, by1 = -9;
      for (let i = 0; i < NL; i += 3) {
        const x = sm[i * 2], y = sm[i * 2 + 1];
        const ox = view[0] * x + view[2] * y + view[4], oy = view[1] * x + view[3] * y + view[5];
        if (ox < bx0) bx0 = ox; if (ox > bx1) bx1 = ox; if (oy < by0) by0 = oy; if (oy > by1) by1 = oy;
      }
      box[0] = bx0; box[1] = by0; box[2] = bx1; box[3] = by1;
      const k = 1 - Math.exp(-dt * 4);
      st.light[0] += ((bx0 + bx1) / 2 - st.light[0]) * k;
      st.light[1] += ((by0 + by1) / 2 - 0.02 - st.light[1]) * k;
      st.lightR += (Math.max(0.12, (by1 - by0) * 0.85) - st.lightR) * k;
      st.box = [bx0 - 0.03, by0 - 0.03, bx1 + 0.03, by1 + 0.03];
    }
    st.scan = phase === 'scan' && !ctx.reduced ? Math.min(1, phaseT / SCAN_S) : 0;
    st.lines = phase === 'scan' ? Math.sin(Math.min(1, phaseT / SCAN_S) * Math.PI) : 0;
    R.draw(st);
  });

  return {
    dispose() {
      disposed = true;
      clearTimeout(toastT);
      stop();
      unobsStage(); unobsDock();
      stopCam();
      tracker = null;
      trackerP?.then((t) => t.close()).catch(() => {});
      R.dispose();
    },
  };
}
