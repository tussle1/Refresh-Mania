/**
 * Web Audio wrapper: decoding, music/preview/effect buses, synthesized hitsounds and a menu
 * jukebox. The AudioContext is created lazily from a user gesture (browser autoplay policy).
 */
export class AudioLoadError extends Error {}

export type HitsoundKind = 'great' | 'good' | 'meh' | 'miss' | 'click' | 'finish';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private previewBus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private music: { source: AudioBufferSourceNode } | null = null;
  private preview: { source: AudioBufferSourceNode } | null = null;
  private jukebox: { stop: () => void } | null = null;
  private volumes = { master: 1, music: 0.6, effects: 0.7, preview: 0.5, muted: false };
  /** Decoded buffers keyed by object identity, so previews do not decode twice. */
  private readonly bufferCache = new WeakMap<Blob, AudioBuffer>();

  /** Create (or resume) the AudioContext. Must be called from a user gesture. */
  ensure(): AudioContext | null {
    if (typeof AudioContext === 'undefined' && typeof (globalThis as any).webkitAudioContext === 'undefined') return null;
    if (!this.ctx) {
      const Ctor = (globalThis.AudioContext ?? (globalThis as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.fxBus = this.ctx.createGain();
      this.previewBus = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.musicBus.connect(this.master);
      this.fxBus.connect(this.master);
      this.previewBus.connect(this.master);
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Seconds used as the clock source (audio clock when available, else performance time). */
  clockSeconds = (): number => (this.ctx ? this.ctx.currentTime : performance.now() / 1000);

  setVolumes(v: Partial<AudioEngine['volumes']>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.musicBus || !this.fxBus || !this.previewBus) return;
    const t = this.ctx.currentTime;
    const m = this.volumes.muted ? 0 : this.volumes.master;
    this.master.gain.setTargetAtTime(m, t, 0.01);
    this.musicBus.gain.setTargetAtTime(this.volumes.music, t, 0.01);
    this.fxBus.gain.setTargetAtTime(this.volumes.effects, t, 0.01);
    this.previewBus.gain.setTargetAtTime(this.volumes.preview, t, 0.01);
  }

  /** Decode an audio blob. Reports unsupported formats with a clear message. */
  async decode(blob: Blob, fileName = 'audio'): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(blob);
    if (cached) return cached;
    const ctx = this.ensure();
    if (!ctx) throw new AudioLoadError('This browser has no Web Audio support.');
    const bytes = await blob.arrayBuffer();
    try {
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      this.bufferCache.set(blob, buffer);
      return buffer;
    } catch {
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      throw new AudioLoadError(
        `Could not decode "${fileName}". ${ext ? `The browser may not support .${ext} files.` : ''} Supported: mp3, ogg (Vorbis/Opus), wav, m4a/aac depending on browser.`.trim(),
      );
    }
  }

  /** Start the beatmap track with buffer time == chart time. Returns the source for stopping. */
  startMusic(buffer: AudioBuffer, chartMs: number, rate: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus) return;
    this.stopMusic();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.musicBus);
    const startDelay = Math.max(0, -chartMs / 1000 / rate);
    const offset = Math.max(0, chartMs / 1000);
    if (offset < buffer.duration) source.start(ctx.currentTime + startDelay, offset);
    this.music = { source };
  }

  stopMusic(): void {
    if (!this.music) return;
    try {
      this.music.source.stop();
    } catch {
      /* already stopped */
    }
    this.music.source.disconnect();
    this.music = null;
  }

  /** Preview (song select). Starts at `seconds` into the track. */
  playPreview(buffer: AudioBuffer, seconds: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.previewBus) return;
    this.stopPreview();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.previewBus);
    source.start(0, Math.min(Math.max(0, seconds), Math.max(0, buffer.duration - 1)));
    this.preview = { source };
    source.onended = () => {
      if (this.preview?.source === source) this.preview = null;
    };
  }

  stopPreview(): void {
    if (!this.preview) return;
    try {
      this.preview.source.stop();
    } catch {
      /* ignore */
    }
    this.preview = null;
  }

  /** Synthesized hitsound (original sounds generated in code, no sample assets). */
  playHitsound(kind: HitsoundKind, when?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.fxBus) return;
    const t = when ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freq = kind === 'great' ? 1046 : kind === 'good' ? 880 : kind === 'finish' ? 660 : kind === 'miss' ? 110 : kind === 'meh' ? 523 : 784;
    osc.type = kind === 'miss' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (kind === 'miss') osc.frequency.linearRampToValueAtTime(70, t + 0.25);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === 'miss' ? 0.25 : 0.18, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'miss' ? 0.3 : 0.08));
    osc.connect(gain);
    gain.connect(this.fxBus);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  /** Current output level 0..1 (RMS), used by the menu visualizer. Returns 0 when silent/unavailable. */
  level(): number {
    if (!this.analyser) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  /** Simple synthesized menu loop (original; a 4/4 kick and pad at 120 BPM). Stops any previous loop. */
  startJukebox(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || this.jukebox) return;
    const bus = this.musicBus;
    const bpm = 120;
    const beat = 60 / bpm;
    let next = ctx.currentTime + 0.1;
    let beatIndex = 0;
    const chords = [
      [220, 277.18, 329.63],
      [196, 246.94, 293.66],
      [174.61, 220, 261.63],
      [196, 246.94, 293.66],
    ];
    const kick = (t: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + 0.32);
    };
    const pad = (t: number, freqs: number[]) => {
      for (const f of freqs) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.08, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 4);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + beat * 4 + 0.1);
      }
    };
    const timer = window.setInterval(() => {
      while (next < ctx.currentTime + 0.3) {
        if (beatIndex % 4 === 0) pad(next, chords[(beatIndex / 4) % chords.length]);
        if (beatIndex % 2 === 0) kick(next);
        next += beat;
        beatIndex++;
      }
    }, 100);
    this.jukebox = {
      stop: () => {
        window.clearInterval(timer);
      },
    };
  }

  stopJukebox(): void {
    this.jukebox?.stop();
    this.jukebox = null;
  }
}

export const audioEngine = new AudioEngine();
