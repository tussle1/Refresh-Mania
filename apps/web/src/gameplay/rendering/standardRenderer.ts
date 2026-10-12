/**
 * Canvas 2D renderer for osu!standard. It reads the ruleset directly and never touches React state.
 * Playfield coordinates (512x384) are mapped with a single transform per frame, which keeps object
 * placement exact at any window size and device pixel ratio.
 */
import type { ObjectState, SliderState, CircleState, SpinnerState } from '../modes/standard/ruleset';
import type { GameSession } from '../session';
import { approachPreemptMs, PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from '../core/difficulty';
import { pathPointAt, type SliderPath } from '../../beatmaps/curves';
import type { RulesetEvent } from '../modes/standard/ruleset';
import type { ObjectJudgment } from '../scoring/score';

export interface RenderOptions {
  backgroundDim: number;
  cursorSize: number;
  cursorTrail: boolean;
  trailLength: number;
  /** 0 = raw cursor, 1 = heavy smoothing. Visual only. */
  cursorSmoothing: number;
  hitErrorMeter: boolean;
  reducedMotion: boolean;
}

const COMBO_COLORS = ['#ff8fb3', '#7ad3ff', '#ffd166'];
const JUDGMENT_COLORS: Record<ObjectJudgment, string> = {
  great: '#7dffb2',
  good: '#7ad3ff',
  meh: '#ffd166',
  miss: '#ff6b6b',
};
const JUDGMENT_TEXT: Record<ObjectJudgment, string> = { great: '300', good: '100', meh: '50', miss: 'miss' };
const POPUP_MS = 550;

interface Popup {
  x: number;
  y: number;
  judgment: ObjectJudgment;
  t: number;
}

export class StandardRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private readonly popups: Popup[] = [];
  private readonly trail: { x: number; y: number; t: number }[] = [];
  private visual = { x: PLAYFIELD_WIDTH / 2, y: PLAYFIELD_HEIGHT / 2 };
  private lastFrameMs = 0;
  private firstVisible = 0;
  private readonly sliderPaths = new WeakMap<SliderState, Path2D>();
  private readonly unsubscribe: () => void;
  private background: CanvasImageSource | null = null;
  private breakActive = false;
  private readonly preempt: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly session: GameSession,
    public options: RenderOptions,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
    this.ctx = ctx;
    this.preempt = approachPreemptMs(session.settings.difficulty.approachRate) * session.settings.rate;
    this.unsubscribe = session.onRuleset((e) => this.onRulesetEvent(e));
    this.resize();
  }

  dispose(): void {
    this.unsubscribe();
  }

  setBackground(img: CanvasImageSource | null): void {
    this.background = img;
  }

  /** Recompute the canvas backing size for the current CSS size and device pixel ratio. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (cssW === this.width && cssH === this.height && dpr === this.dpr) return;
    this.width = cssW;
    this.height = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    // Fit 4:3 playfield inside the canvas with a small margin.
    this.scale = Math.min((cssW * 0.94) / PLAYFIELD_WIDTH, (cssH * 0.9) / PLAYFIELD_HEIGHT);
    this.ox = (cssW - PLAYFIELD_WIDTH * this.scale) / 2;
    this.oy = (cssH - PLAYFIELD_HEIGHT * this.scale) / 2 + cssH * 0.02;
  }

  /** Map a client (CSS px) point to playfield coordinates. */
  clientToPlayfield(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  private onRulesetEvent(e: RulesetEvent): void {
    if (e.type === 'judgment') {
      this.popups.push({ x: e.x, y: e.y, judgment: e.judgment, t: performance.now() });
      if (this.popups.length > 40) this.popups.shift();
    }
  }

  private playfieldTransform(): void {
    const k = this.scale * this.dpr;
    this.ctx.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);
  }

  private screenTransform(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private drawBackground(): void {
    const { ctx } = this;
    this.screenTransform();
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = '#0b0d14';
    ctx.fillRect(0, 0, w, h);
    const bg = this.background;
    if (bg && 'width' in bg) {
      const iw = (bg as HTMLImageElement).naturalWidth || (bg as HTMLImageElement).width;
      const ih = (bg as HTMLImageElement).naturalHeight || (bg as HTMLImageElement).height;
      if (iw && ih) {
        const s = Math.max(w / iw, h / ih);
        const dw = iw * s;
        const dh = ih * s;
        ctx.drawImage(bg, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    }
    ctx.fillStyle = `rgba(0,0,0,${this.options.backgroundDim})`;
    ctx.fillRect(0, 0, w, h);
    // Playfield panel
    ctx.fillStyle = 'rgba(8,10,18,0.55)';
    ctx.fillRect(this.ox, this.oy, PLAYFIELD_WIDTH * this.scale, PLAYFIELD_HEIGHT * this.scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.ox + 0.5, this.oy + 0.5, PLAYFIELD_WIDTH * this.scale - 1, PLAYFIELD_HEIGHT * this.scale - 1);
  }

  /** Draw a frame at chart time `now`. Safe to call every animation frame. */
  draw(now: number): void {
    const ruleset = this.session.ruleset;
    const perf = performance.now();
    const dt = this.lastFrameMs ? Math.min(100, perf - this.lastFrameMs) : 16;
    this.lastFrameMs = perf;
    this.resize();
    this.drawBackground();

    // Break detection (for the HUD and dimming).
    this.breakActive = this.session.parsed.breaks.some((b) => now >= b.start && now <= b.end);

    this.playfieldTransform();
    const objs = ruleset.objects;
    const preempt = this.preempt;
    // Advance firstVisible past objects that can no longer be on screen.
    while (this.firstVisible < objs.length && this.endOf(objs[this.firstVisible]) + 600 < now) this.firstVisible++;
    // Draw later objects first so earlier objects sit on top.
    let last = this.firstVisible;
    while (last < objs.length && objs[last].time - preempt <= now) last++;
    for (let i = last - 1; i >= this.firstVisible; i--) {
      this.drawObject(objs[i], now, preempt);
    }
    this.drawPopups(perf);
    this.updateCursor(perf, dt);
    this.drawCursorAndTrail(perf);
    this.screenTransform();
    this.drawHud(now);
  }

  private endOf(o: ObjectState): number {
    if (o.kind === 'circle') return o.time;
    return o.kind === 'slider' ? o.endTime : o.endTime;
  }

  private drawObject(o: ObjectState, now: number, preempt: number): void {
    if (o.kind === 'circle') this.drawCircle(o, now, preempt);
    else if (o.kind === 'slider') this.drawSlider(o, now, preempt);
    else this.drawSpinner(o, now, preempt);
  }

  private drawCircle(o: CircleState, now: number, preempt: number): void {
    const { ctx } = this;
    const r = this.session.ruleset.radius;
    const color = COMBO_COLORS[o.color];
    const hidden = this.session.settings.hidden;
    let alpha = Math.min(1, (now - (o.time - preempt)) / (preempt * 0.4));
    if (hidden) alpha = Math.min(alpha, Math.max(0, (o.time - now) / (preempt * 0.4)));
    let scale = 1;
    if (o.judgment !== null && o.resolvedAt !== null) {
      const since = now - o.resolvedAt;
      if (o.judgment === 'miss') {
        alpha = Math.min(alpha, Math.max(0, 1 - since / 400));
      } else {
        const p = Math.min(1, Math.max(0, since / 240));
        scale = 1 + p * 0.5;
        alpha = Math.max(0, 1 - p);
      }
      if (alpha <= 0) return;
    }
    if (alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.beginPath();
    ctx.arc(o.x, o.y, r * scale, 0, Math.PI * 2);
    ctx.fillStyle = o.judgment === 'miss' ? 'rgba(90,90,100,0.9)' : color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(o.combo), o.x, o.y + 1);
    if (o.judgment === null && !this.options.reducedMotion) {
      // Approach circle shrinks to the circle size at the hit time.
      const remain = Math.max(0, (o.time - now) / preempt);
      const ar = r * (1 + 3 * remain);
      ctx.beginPath();
      ctx.arc(o.x, o.y, ar, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.strokeStyle = color;
      ctx.stroke();
    } else if (o.judgment === null) {
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 2, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private sliderPath(s: SliderState): Path2D {
    let p = this.sliderPaths.get(s);
    if (!p) {
      p = new Path2D();
      const path: SliderPath = s.path;
      p.moveTo(path.xs[0], path.ys[0]);
      for (let i = 1; i < path.xs.length; i++) p.lineTo(path.xs[i], path.ys[i]);
      this.sliderPaths.set(s, p);
    }
    return p;
  }

  private drawSlider(s: SliderState, now: number, preempt: number): void {
    const { ctx } = this;
    const r = this.session.ruleset.radius;
    const color = COMBO_COLORS[s.color];
    const dur = s.endTime - s.time;
    const hiddenFade = this.session.settings.hidden ? Math.min(1, Math.max(0, (s.time - now) / (preempt * 0.4))) : 1;
    const approachAlpha = Math.min(1, Math.max(0, (now - (s.time - preempt)) / (preempt * 0.4)));
    const finishedAt = s.resolvedAt ?? Infinity;
    const after = Math.max(0, 1 - Math.max(0, now - finishedAt) / 300);
    const baseAlpha = Math.min(hiddenFade, approachAlpha) * after;
    if (baseAlpha <= 0) return;
    ctx.globalAlpha = baseAlpha;
    // Body: outline, then inner fill.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = this.sliderPath(s);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = r * 2;
    ctx.stroke(path);
    ctx.strokeStyle = 'rgba(40,44,60,0.85)';
    ctx.lineWidth = r * 2 - Math.max(3, r * 0.14);
    ctx.stroke(path);
    // Head and tail caps
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.12);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    const tail = pathPointAt(s.path, s.path.length, { x: 0, y: 0 });
    ctx.beginPath();
    ctx.arc(tail.x, tail.y, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.combo), s.x, s.y + 1);
    // Ball
    if (s.resolvedAt === null && now >= s.time && now <= s.endTime && dur > 0) {
      const d = this.session.ruleset.ballDistance(s, now);
      const p = pathPointAt(s.path, d, { x: 0, y: 0 });
      const inside = this.session.ruleset.buttons !== 0 && Math.hypot(p.x - this.session.ruleset.pointer.x, p.y - this.session.ruleset.pointer.y) <= this.session.ruleset.followR;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = inside ? '#ffffff' : 'rgba(255,255,255,0.6)';
      ctx.fill();
      if (inside) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.session.ruleset.followR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawSpinner(sp: SpinnerState, now: number, preempt: number): void {
    const { ctx } = this;
    const vis = Math.min(1, Math.max(0, (now - (sp.time - preempt)) / preempt));
    const fade = sp.resolvedAt !== null ? Math.max(0, 1 - (now - sp.resolvedAt) / 400) : 1;
    const alpha = vis * fade;
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    const cx = sp.x;
    const cy = sp.y;
    const R = 140;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,14,24,0.7)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();
    const frac = Math.min(1, sp.rotations / sp.requiredRotations);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 12, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffd166';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(`${Math.floor(sp.rotations)} / ${sp.requiredRotations}`, cx, cy + 4);
    if (sp.bonusSpins > 0) {
      ctx.font = '500 16px system-ui, sans-serif';
      ctx.fillText(`+${sp.bonusSpins} bonus`, cx, cy + 34);
    }
    ctx.globalAlpha = 1;
  }

  private drawPopups(perf: number): void {
    const { ctx } = this;
    if (this.popups.length === 0) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const age = perf - p.t;
      if (age > POPUP_MS) {
        this.popups.splice(i, 1);
        continue;
      }
      const k = age / POPUP_MS;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = JUDGMENT_COLORS[p.judgment];
      ctx.font = `700 ${Math.round(18 + (this.options.reducedMotion ? 0 : 6 * (1 - k)))}px system-ui, sans-serif`;
      ctx.fillText(JUDGMENT_TEXT[p.judgment], p.x, p.y - 40 * k);
    }
    ctx.globalAlpha = 1;
  }

  private updateCursor(perf: number, dt: number): void {
    const target = this.session.ruleset.pointer;
    const s = Math.min(0.95, Math.max(0, this.options.cursorSmoothing));
    // Visual-only smoothing: the ruleset always receives the raw pointer position.
    const factor = s === 0 ? 1 : 1 - Math.pow(s, dt / 16.7);
    this.visual = { x: this.visual.x + (target.x - this.visual.x) * factor, y: this.visual.y + (target.y - this.visual.y) * factor };
    if (this.options.cursorTrail) {
      this.trail.push({ x: this.visual.x, y: this.visual.y, t: perf });
      const max = this.options.trailLength;
      while (this.trail.length > max) this.trail.shift();
      while (this.trail.length > 0 && perf - this.trail[0].t > 400) this.trail.shift();
    } else if (this.trail.length) {
      this.trail.length = 0;
    }
  }

  private drawCursorAndTrail(perf: number): void {
    const { ctx } = this;
    const k = this.scale * this.dpr;
    ctx.save();
    this.playfieldTransform();
    if (this.options.cursorTrail) {
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const a = (i + 1) / this.trail.length;
        const age = Math.min(1, (perf - p.t) / 400);
        ctx.globalAlpha = a * (1 - age) * 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 * this.options.cursorSize, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
    }
    const pressed = this.session.ruleset.buttons !== 0;
    const size = 9 * this.options.cursorSize * (pressed ? 1.25 : 1);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(this.visual.x, this.visual.y, size, 0, Math.PI * 2);
    ctx.fillStyle = pressed ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
    ctx.fill();
    ctx.lineWidth = 2 / k * this.dpr;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  private drawHud(now: number): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    const snap = this.session.ruleset.snapshot();
    const r = this.session.ruleset;
    ctx.textBaseline = 'alphabetic';
    // Score & accuracy (top-right)
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText(String(snap.score).padStart(8, '0'), w - 20, 42);
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`${(snap.accuracy * 100).toFixed(2)}%`, w - 20, 66);
    // Combo (bottom-left)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText(`${snap.combo}x`, 20, h - 24);
    // Health bar (top-left)
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(20, 20, Math.min(300, w * 0.3), 8);
    ctx.fillStyle = snap.health > 0.3 ? '#7dffb2' : '#ff6b6b';
    ctx.fillRect(20, 20, Math.min(300, w * 0.3) * snap.health, 8);
    // Song progress (top)
    const last = Math.max(1, r.lastObjectEnd);
    const first = this.session.parsed.hitObjects[0]?.time ?? 0;
    const prog = Math.min(1, Math.max(0, (now - first) / Math.max(1, last - first)));
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 0, w * prog, 3);
    // Title / mods
    ctx.textAlign = 'left';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    const title = `${this.session.parsed.metadata.titleUnicode || this.session.parsed.metadata.title} [${this.session.parsed.metadata.version}]`;
    ctx.fillText(title, 20, 52);
    if (this.session.isReplaying) {
      ctx.fillStyle = '#ffd166';
      ctx.fillText('REPLAY (local recording)', 20, 70);
    }
    // Break indicator
    if (this.breakActive) {
      ctx.textAlign = 'center';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('BREAK', w / 2, h * 0.14);
    }
    // Hit error meter
    if (this.options.hitErrorMeter) {
      const errs = r.hitErrors.slice(-40);
      const mid = w / 2;
      const y = h - 18;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(mid - 100, y - 3, 200, 2);
      ctx.fillStyle = 'rgba(125,255,178,0.8)';
      for (const e of errs) {
        const x = mid + Math.max(-100, Math.min(100, (e / Math.max(1, r.windowMeh / r.rate)) * 100));
        ctx.fillRect(x - 1, y - 8, 2, 12);
      }
    }
    // Countdown before audio/objects begin
    if (now < 0 && now > this.session.introStartChart - 1 && this.session.parsed.hitObjects.length > 0) {
      const remaining = Math.max(0, Math.ceil(-now / 1000));
      if (remaining > 0 && remaining <= 2) {
        ctx.textAlign = 'center';
        ctx.font = '800 64px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(String(remaining), w / 2, h / 2);
      }
    }
  }
}
