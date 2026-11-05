import { asset } from './data';

/** Venue ambience (ducked, looping per floor) + tiny synthesized UI sounds. Muted until first tap. */
export class Audio {
  ctx: AudioContext | null = null;
  private amb: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  muted = true;
  floor = 'downstairs';

  ensure() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
    } catch { /* no audio */ }
  }

  setFloor(f: string) {
    this.floor = f;
    if (!this.amb) return;
    this.amb.src = asset(`media/audio/${f}.m4a`);
    if (!this.muted) this.amb.play().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.ensure();
    if (!this.amb && !m) {
      this.amb = new window.Audio(asset(`media/audio/${this.floor}.m4a`));
      this.amb.loop = true;
      this.amb.crossOrigin = 'anonymous';
      try {
        const src = this.ctx!.createMediaElementSource(this.amb);
        src.connect(this.gain!);
      } catch { this.amb.volume = 0.35; }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.4);
    if (!m) this.amb?.play().catch(() => {});
    else setTimeout(() => { if (this.muted) this.amb?.pause(); }, 900);
  }

  /** Playback position of the venue track while it is audibly playing (null when muted / paused). */
  get musicTime(): number | null {
    return this.amb && !this.muted && !this.amb.paused ? this.amb.currentTime : null;
  }

  duck(on: boolean) {
    if (this.gain && this.ctx && !this.muted) this.gain.gain.setTargetAtTime(on ? 0.16 : 0.42, this.ctx.currentTime, 0.3);
  }

  blip(freq = 880, dur = 0.06, vol = 0.05) {
    if (this.muted || !this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur * 2.5);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + dur * 3);
  }
  whoosh() {
    if (this.muted || !this.ctx) return;
    const n = this.ctx.sampleRate * 0.8, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / n) * Math.PI) ** 2;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = b; f.type = 'bandpass'; f.frequency.setValueAtTime(400, this.ctx.currentTime); f.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 0.7);
    g.gain.value = 0.12;
    s.connect(f).connect(g).connect(this.ctx.destination);
    s.start();
  }
}
