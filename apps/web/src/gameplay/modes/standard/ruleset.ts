/**
 * osu!standard ruleset.
 *
 * The ruleset is a deterministic state machine driven by timestamped inputs and time advances
 * (song time, ms). The live game and replay playback both use this class, so a recorded input
 * log reproduces the same judgments.
 *
 * Input contract:
 *  - update(t)            advance song time to t; finalises misses/followers/spinners whose time <= t.
 *  - setPointer(t, x, y)  pointer position in playfield pixels (512x384) at song time t.
 *  - setButtons(t, mask)  bitmask of held keys/buttons at song time t (bit 0..3). Rising edges are presses.
 * Callers must call update(t) before applying an input at t.
 */
import type { ParsedBeatmap, SliderObject, SpinnerObject, CircleObject, Vec2 } from '../../../beatmaps/types';
import { TimingInfo } from '../../../beatmaps/timing';
import { buildSliderPath, pathPointAt, type SliderPath } from '../../../beatmaps/curves';
import { approachPreemptMs, circleRadius, followRadius, hitWindows, PLAYFIELD_HEIGHT, PLAYFIELD_WIDTH } from '../../core/difficulty';
import type { ModdedSettings } from '../../core/mods';
import { ScoreTracker, difficultyMultiplier, type ObjectJudgment, type ScoreSnapshot, type FollowJudgment } from '../../scoring/score';

export interface ComboInfo {
  /** 1-based number shown on the object. */
  combo: number;
  /** Combo colour index (0..2 in the default palette). */
  color: number;
}

export interface CircleState extends ComboInfo {
  kind: 'circle';
  time: number;
  x: number;
  y: number;
  newCombo: boolean;
  /** Judgment once final. */
  judgment: ObjectJudgment | null;
  /** Song-time ms at which the object was hit or missed. */
  resolvedAt: number | null;
  /** Hit error in real ms (positive = late). */
  hitError: number | null;
}

export interface SliderState extends ComboInfo {
  kind: 'slider';
  time: number;
  endTime: number;
  x: number;
  y: number;
  newCombo: boolean;
  path: SliderPath;
  slides: number;
  pixelLength: number;
  headJudgment: ObjectJudgment | null;
  headHitError: number | null;
  followHits: number;
  followTotal: number;
  judgment: ObjectJudgment | null;
  resolvedAt: number | null;
  /** Ordered follow points: [time, type, distance]. */
  events: { time: number; kind: 'tick' | 'repeat' | 'tail'; distance: number; resolved: boolean }[];
  nextEvent: number;
}

export interface SpinnerState extends ComboInfo {
  kind: 'spinner';
  time: number;
  endTime: number;
  x: number;
  y: number;
  newCombo: boolean;
  requiredRotations: number;
  rotations: number;
  bonusSpins: number;
  judgment: ObjectJudgment | null;
  resolvedAt: number | null;
  lastAngle: number | null;
}

export type ObjectState = CircleState | SliderState | SpinnerState;

export type RulesetEvent =
  | { type: 'judgment'; index: number; judgment: ObjectJudgment; time: number; x: number; y: number }
  | { type: 'follow'; index: number; judgment: FollowJudgment; time: number; x: number; y: number }
  | { type: 'bonus'; index: number; spins: number; time: number }
  | { type: 'fail'; time: number };

export interface RulesetOptions {
  beatmap: ParsedBeatmap;
  mods: ModdedSettings;
  onEvent?: (e: RulesetEvent) => void;
}

export const BUTTON_MASK_ANY = 0b1111;

export class StandardRuleset {
  readonly objects: ObjectState[] = [];
  readonly timing: TimingInfo;
  readonly radius: number;
  readonly followR: number;
  readonly windowGreat: number;
  readonly windowGood: number;
  readonly windowMeh: number;
  readonly preemptSong: number;
  readonly rate: number;
  readonly score: ScoreTracker;
  readonly hitErrors: number[] = [];
  /** Score/accuracy samples taken at each resolved object: [songTime, score, accuracy]. */
  readonly progress: [number, number, number][] = [];
  failed = false;
  /** Latest song time processed. */
  now = -Infinity;
  pointer: Vec2 = { x: PLAYFIELD_WIDTH / 2, y: PLAYFIELD_HEIGHT / 2 };
  buttons = 0;
  private cursor = 0;
  private readonly followQueue: { obj: SliderState; index: number; event: SliderState['events'][number] }[] = [];
  private followPos = 0;
  private readonly onEvent?: (e: RulesetEvent) => void;
  private readonly mods: ModdedSettings;
  private readonly sliderMultiplier: number;
  private readonly tickRate: number;

  constructor(opts: RulesetOptions) {
    const { beatmap, mods } = opts;
    this.mods = mods;
    this.onEvent = opts.onEvent;
    this.timing = new TimingInfo(beatmap.timingPoints);
    const d = mods.difficulty;
    this.radius = circleRadius(d.circleSize);
    this.followR = followRadius(d.circleSize);
    this.rate = mods.rate;
    const w = hitWindows(d.overallDifficulty);
    // Windows are real-time ms; song time runs `rate` times faster, so scale them into song time.
    this.windowGreat = w.great * this.rate;
    this.windowGood = w.good * this.rate;
    this.windowMeh = w.meh * this.rate;
    this.preemptSong = approachPreemptMs(d.approachRate) * this.rate;
    this.sliderMultiplier = beatmap.difficulty.sliderMultiplier;
    this.tickRate = beatmap.difficulty.sliderTickRate;
    const flip = (y: number) => (mods.flipVertical ? PLAYFIELD_HEIGHT - y : y);

    const objCount = beatmap.hitObjects.length;
    const drainStart = beatmap.hitObjects[0]?.time ?? 0;
    const lastObj = beatmap.hitObjects[objCount - 1];
    const drainEnd = lastObj ? ('endTime' in lastObj ? lastObj.endTime : lastObj.time) : 0;
    const drainSeconds = Math.max(1, (drainEnd - drainStart) / 1000);
    const diffMul = difficultyMultiplier(d.hpDrainRate, d.circleSize, d.overallDifficulty, objCount, drainSeconds);
    const hpGain = 0.05;
    const hpLoss = 0.03 + 0.012 * d.hpDrainRate;
    this.score = new ScoreTracker(diffMul, mods.scoreMultiplier || 1, hpGain, hpLoss);

    for (const o of beatmap.hitObjects) {
      if (o.type === 'circle') {
        this.objects.push(this.makeCircle(o, flip));
      } else if (o.type === 'slider') {
        this.objects.push(this.makeSlider(o, flip));
      } else if (o.type === 'spinner') {
        this.objects.push(this.makeSpinner(o));
      }
    }
    // Combo numbering: a new combo starts at a new-combo object (and at the first object).
    let comboNo = 0;
    let colorNo = 0;
    for (const obj of this.objects) {
      if (obj.newCombo || comboNo === 0) {
        comboNo = 1;
        colorNo = (colorNo + 1) % 3;
      } else {
        comboNo++;
      }
      obj.combo = comboNo;
      obj.color = colorNo;
    }
    // Build the follow queue (sorted by time).
    this.objects.forEach((obj, index) => {
      if (obj.kind !== 'slider') return;
      for (const ev of obj.events) this.followQueue.push({ obj, index, event: ev });
    });
    this.followQueue.sort((a, b) => a.event.time - b.event.time);
  }

  private makeCircle(o: CircleObject, flip: (y: number) => number): CircleState {
    return { kind: 'circle', time: o.time, x: o.x, y: flip(o.y), newCombo: o.newCombo, combo: 0, color: 0, judgment: null, resolvedAt: null, hitError: null };
  }

  private makeSlider(o: SliderObject, flip: (y: number) => number): SliderState {
    const head = { x: o.x, y: flip(o.y) };
    const pts = o.curvePoints.map((p) => ({ x: p.x, y: flip(p.y) }));
    const path = buildSliderPath(head, o.curveType, pts, o.pixelLength);
    const duration = this.timing.sliderDuration(o.time, path.length, o.repeats, this.sliderMultiplier);
    const endTime = o.time + duration;
    const slides = o.repeats;
    const L = path.length;
    const events: SliderState['events'] = [];
    const tick = this.timing.tickDistance(o.time, this.sliderMultiplier, this.tickRate);
    if (tick > 0 && L > 0 && duration > 0) {
      const spanDur = duration / slides;
      let spanCap = 0;
      for (let s = 0; s < slides; s++) {
        const spanStart = o.time + s * spanDur;
        let k = 1;
        for (let d = tick; d < L - 1e-6 && spanCap < 4000; d = tick * ++k) {
          const frac = d / L;
          const t = spanStart + spanDur * (s % 2 === 0 ? frac : 1 - frac);
          // Avoid placing ticks at the very end of a span (osu! keeps them inside).
          if (t > spanStart + 1 && t < spanStart + spanDur - 1) events.push({ time: t, kind: 'tick', distance: d, resolved: false });
          spanCap++;
        }
      }
    }
    for (let s = 1; s < slides; s++) {
      events.push({ time: o.time + (duration * s) / slides, kind: 'repeat', distance: s % 2 === 1 ? L : 0, resolved: false });
    }
    events.push({ time: endTime, kind: 'tail', distance: slides % 2 === 1 ? L : 0, resolved: false });
    events.sort((a, b) => a.time - b.time);
    return {
      kind: 'slider',
      time: o.time,
      endTime,
      x: head.x,
      y: head.y,
      newCombo: o.newCombo,
      combo: 0,
      color: 0,
      path,
      slides,
      pixelLength: L,
      headJudgment: null,
      headHitError: null,
      followHits: 0,
      followTotal: events.length,
      judgment: null,
      resolvedAt: null,
      events,
      nextEvent: 0,
    };
  }

  private makeSpinner(o: SpinnerObject): SpinnerState {
    const durationSec = (o.endTime - o.time) / 1000;
    const od = this.mods.difficulty.overallDifficulty;
    // Approximation: required rotations scale with spinner duration and OD.
    const required = Math.max(1, Math.floor(durationSec * (3 + od * 0.2)));
    return {
      kind: 'spinner',
      time: o.time,
      endTime: o.endTime,
      x: PLAYFIELD_WIDTH / 2,
      y: PLAYFIELD_HEIGHT / 2,
      newCombo: o.newCombo,
      combo: 0,
      color: 0,
      requiredRotations: required,
      rotations: 0,
      bonusSpins: 0,
      judgment: null,
      resolvedAt: null,
      lastAngle: null,
    };
  }

  /** Ball distance along a slider path at song time t (0 = head). */
  ballDistance(s: SliderState, t: number): number {
    const dur = s.endTime - s.time;
    if (dur <= 0) return 0;
    const p = Math.min(1, Math.max(0, (t - s.time) / dur)) * s.slides;
    const span = Math.min(Math.floor(p), s.slides - 1);
    const f = p - span;
    return (span % 2 === 0 ? f : 1 - f) * s.pixelLength;
  }

  private emitJudgment(index: number, judgment: ObjectJudgment, time: number, x: number, y: number) {
    this.onEvent?.({ type: 'judgment', index, judgment, time, x, y });
  }

  private record(time: number) {
    this.progress.push([time, this.score.score, this.score.accuracy]);
  }

  private resolveCircle(index: number, c: CircleState, judgment: ObjectJudgment, t: number, hitError: number | null) {
    c.judgment = judgment;
    c.resolvedAt = t;
    c.hitError = hitError;
    this.score.judgeObject(judgment);
    if (hitError !== null) this.hitErrors.push(hitError);
    this.emitJudgment(index, judgment, t, c.x, c.y);
    this.record(t);
    this.checkFail(t);
  }

  private checkFail(t: number) {
    if (this.failed) return;
    const shouldFail = (this.mods.suddenDeath && this.score.counts.miss > 0) || (!this.mods.noFail && this.score.health <= 0);
    if (shouldFail) {
      this.failed = true;
      this.onEvent?.({ type: 'fail', time: t });
    }
  }

  private classify(absRealMs: number): ObjectJudgment | null {
    if (absRealMs <= this.windowGreat / this.rate) return 'great';
    if (absRealMs <= this.windowGood / this.rate) return 'good';
    if (absRealMs <= this.windowMeh / this.rate) return 'meh';
    return null;
  }

  private inRadius(x: number, y: number, p: Vec2, r: number): boolean {
    const dx = p.x - x;
    const dy = p.y - y;
    return dx * dx + dy * dy <= r * r;
  }

  private finishSlider(index: number, s: SliderState, t: number) {
    if (s.resolvedAt !== null) return;
    let judgment: ObjectJudgment;
    if (s.headJudgment === null || s.headJudgment === 'miss') judgment = 'miss';
    else {
      const ratio = s.followTotal === 0 ? 1 : s.followHits / s.followTotal;
      if (ratio >= 1) judgment = s.headJudgment;
      else if (ratio >= 0.5) judgment = 'good';
      else if (ratio > 0) judgment = 'meh';
      else judgment = 'miss';
    }
    s.judgment = judgment;
    s.resolvedAt = t;
    this.score.judgeObject(judgment);
    this.emitJudgment(index, judgment, t, s.x, s.y);
    this.record(t);
    this.checkFail(t);
  }

  private isResolved(obj: ObjectState): boolean {
    if (obj.kind === 'circle') return obj.judgment !== null;
    return obj.resolvedAt !== null;
  }

  /** Advance the ruleset to song time t, resolving everything due by then. */
  update(t: number): void {
    if (t < this.now) return;
    // Resolve follow points (ticks/repeats/tails) due by t, in time order.
    while (this.followPos < this.followQueue.length && this.followQueue[this.followPos].event.time <= t) {
      const item = this.followQueue[this.followPos++];
      if (item.obj.resolvedAt !== null) continue;
      this.resolveFollow(item.index, item.obj, item.event, item.event.time);
    }
    // Each object resolves on its own timing; a long slider must not hold back later misses.
    const missLate = this.windowMeh;
    const n = this.objects.length;
    for (let i = this.cursor; i < n; i++) {
      const obj = this.objects[i];
      if (obj.time > t) break;
      if (obj.kind === 'circle') {
        if (obj.judgment === null && obj.time + missLate < t) {
          this.resolveCircle(i, obj, 'miss', obj.time + missLate, null);
        }
      } else if (obj.kind === 'slider') {
        if (obj.headJudgment === null && obj.time + missLate < t) obj.headJudgment = 'miss';
        if (obj.resolvedAt === null && obj.endTime < t) this.finishSlider(i, obj, obj.endTime);
      } else if (obj.resolvedAt === null && obj.endTime < t) {
        this.resolveSpinner(i, obj, obj.endTime);
      }
    }
    while (this.cursor < n && this.isResolved(this.objects[this.cursor])) this.cursor++;
    this.now = t;
  }

  private resolveFollow(index: number, s: SliderState, ev: SliderState['events'][number], t: number) {
    if (ev.resolved) return;
    ev.resolved = true;
    const d = ev.distance;
    const ballPos = pathPointAt(s.path, d, { x: 0, y: 0 });
    const held = this.buttons !== 0;
    const hit = held && this.inRadius(ballPos.x, ballPos.y, this.pointer, this.followR);
    const kind = ev.kind;
    if (hit) {
      s.followHits++;
      const j: FollowJudgment = kind === 'tick' ? 'tick' : kind === 'repeat' ? 'repeat' : 'tail';
      this.score.judgeFollow(j);
      this.onEvent?.({ type: 'follow', index, judgment: j, time: t, x: ballPos.x, y: ballPos.y });
    } else {
      const j: FollowJudgment = kind === 'tick' ? 'tickMiss' : kind === 'repeat' ? 'repeatMiss' : 'tailMiss';
      this.score.judgeFollow(j);
      this.onEvent?.({ type: 'follow', index, judgment: j, time: t, x: ballPos.x, y: ballPos.y });
    }
    s.nextEvent++;
    if (kind === 'tail') this.finishSlider(index, s, t);
  }

  private resolveSpinner(index: number, sp: SpinnerState, t: number) {
    if (sp.resolvedAt !== null) return;
    const ratio = sp.rotations / sp.requiredRotations;
    let judgment: ObjectJudgment;
    if (ratio >= 1) judgment = 'great';
    else if (ratio >= 0.75) judgment = 'good';
    else judgment = 'miss';
    sp.judgment = judgment;
    sp.resolvedAt = t;
    this.score.judgeObject(judgment);
    if (sp.rotations > sp.requiredRotations) {
      sp.bonusSpins = Math.floor(sp.rotations - sp.requiredRotations);
      if (sp.bonusSpins > 0) {
        this.score.addSpinnerBonus(sp.bonusSpins);
        this.onEvent?.({ type: 'bonus', index, spins: sp.bonusSpins, time: t });
      }
    }
    this.emitJudgment(index, judgment, t, sp.x, sp.y);
    this.record(t);
    this.checkFail(t);
  }

  /** Pointer moved at song time t. Must be preceded by update(t). */
  setPointer(t: number, x: number, y: number): void {
    this.pointer = { x, y };
    // Spinner rotation: accumulate angle changes while spinning.
    if (this.buttons !== 0) {
      const sp = this.activeSpinner(t);
      if (sp) {
        const cx = sp.x;
        const cy = sp.y;
        const angle = Math.atan2(y - cy, x - cx);
        if (sp.lastAngle !== null) {
          let delta = angle - sp.lastAngle;
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;
          sp.rotations += Math.abs(delta) / (2 * Math.PI);
        }
        sp.lastAngle = angle;
      }
    } else {
      const sp = this.activeSpinner(t);
      if (sp) sp.lastAngle = null;
    }
  }

  private activeSpinner(t: number): SpinnerState | null {
    for (let i = this.cursor; i < this.objects.length; i++) {
      const o = this.objects[i];
      if (o.kind === 'spinner' && o.resolvedAt === null && o.time <= t && t <= o.endTime) return o;
      if (o.kind === 'spinner' && o.time > t) break;
    }
    return null;
  }

  /** Button state changed at song time t. Presses (rising edges) try to hit the earliest matching object. */
  setButtons(t: number, mask: number): void {
    const pressed = mask & ~this.buttons;
    const prevHeld = this.buttons !== 0;
    this.buttons = mask & BUTTON_MASK_ANY;
    if (pressed !== 0) this.tryHit(t);
    // Releasing while a spinner is running resets its angle tracking.
    if (prevHeld && this.buttons === 0) {
      const sp = this.activeSpinner(t);
      if (sp) sp.lastAngle = null;
    }
  }

  private tryHit(t: number): void {
    for (let i = this.cursor; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj.kind === 'spinner') continue;
      if (obj.kind === 'circle' && obj.judgment !== null) continue;
      if (obj.kind === 'slider' && (obj.headJudgment !== null || obj.resolvedAt !== null)) continue;
      // Objects are sorted: once a pending object starts after the window, nothing later can match.
      if (obj.time - this.windowMeh > t) break;
      if (Math.abs(t - obj.time) > this.windowMeh) continue;
      const diffReal = (t - obj.time) / this.rate;
      const judgment = this.classify(Math.abs(diffReal));
      if (judgment === null) continue;
      if (!this.inRadius(obj.x, obj.y, this.pointer, this.radius)) continue;
      if (obj.kind === 'circle') {
        this.resolveCircle(i, obj, judgment, t, diffReal);
      } else {
        obj.headJudgment = judgment;
        obj.headHitError = diffReal;
        this.hitErrors.push(diffReal);
        this.emitJudgment(i, judgment, t, obj.x, obj.y);
        // Head hits count as the first follow point for slider ticks; the follow queue continues.
      }
      return;
    }
  }

  /** Snapshot of score state (for HUD and results). */
  snapshot(): ScoreSnapshot {
    return this.score.snapshot(this.objects.length);
  }

  /** True when every object is resolved (or the play failed). */
  get complete(): boolean {
    return this.cursor >= this.objects.length || this.failed;
  }

  /** Song time of the last object's resolution (for end-of-map detection). */
  get lastObjectEnd(): number {
    const last = this.objects[this.objects.length - 1];
    if (!last) return 0;
    if (last.kind === 'circle') return last.time;
    return last.endTime;
  }

  get hitErrorStats(): { mean: number; unstableRate: number } {
    const e = this.hitErrors;
    if (e.length === 0) return { mean: 0, unstableRate: 0 };
    const mean = e.reduce((a, b) => a + b, 0) / e.length;
    const variance = e.reduce((a, b) => a + (b - mean) * (b - mean), 0) / e.length;
    return { mean, unstableRate: Math.sqrt(variance) * 10 };
  }

}
