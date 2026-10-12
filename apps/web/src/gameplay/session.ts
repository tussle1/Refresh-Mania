/**
 * GameSession: one play of one difficulty in osu!standard.
 *
 * Live play: pointer/button events are timestamped from the browser event time, converted to song
 * time through the audio clock, and recorded into the replay log. Playback: the same log is applied
 * in order through the same `apply()` path, so the outcome is reproduced exactly.
 * The rendering loop calls `frame()`; no React state is touched here.
 */
import type { ParsedBeatmap } from '../beatmaps/types';
import { StandardRuleset, type RulesetEvent } from './modes/standard/ruleset';
import { applyMods, type ModId, type ModdedSettings } from './core/mods';
import { SongClock } from './audio/clock';
import { audioEngine, type HitsoundKind } from './audio/audioEngine';
import type { ReplayData } from './replay/replay';
import { REPLAY_FORMAT, REPLAY_VERSION } from './replay/replay';
import { approachPreemptMs } from './core/difficulty';
import type { ScoreSnapshot } from './scoring/score';

export type SessionPhase = 'running' | 'resuming' | 'paused' | 'ended';

export interface SessionResult {
  passed: boolean;
  snapshot: ScoreSnapshot;
  mods: ModId[];
  settings: ModdedSettings;
  durationMs: number;
  progress: [number, number, number][];
  hitErrors: number[];
  events: number[];
  hitErrorStats: { mean: number; unstableRate: number };
  /** Set only for live (recorded) plays. */
  replay: ReplayData | null;
}

export interface SessionOptions {
  parsed: ParsedBeatmap;
  beatmapHash: string;
  fileName: string;
  mods: ModId[];
  audioBuffer: AudioBuffer | null;
  audioOffsetMs: number;
  hitsounds: boolean;
  /** When set, the session plays back this replay instead of accepting live input. */
  replay?: ReplayData;
  onRulesetEvent?: (e: RulesetEvent) => void;
  onEnd?: (r: SessionResult) => void;
}

const RESUME_COUNTDOWN_MS = 1500;
const END_GRACE_MS = 1500;

export class GameSession {
  readonly ruleset: StandardRuleset;
  readonly clock: SongClock;
  readonly settings: ModdedSettings;
  readonly parsed: ParsedBeatmap;
  phase: SessionPhase = 'paused';
  /** Events in playback order (recorded when live, supplied when replaying). */
  readonly events: number[] = [];
  private readonly isReplay: boolean;
  private replayIndex = 0;
  private readonly startChart: number;
  private readonly endChart: number;
  private resumeDeadline = 0;
  private readonly opts: SessionOptions;
  private buttonsDown = 0;
  private ended = false;
  private lastPointer = { x: 256, y: 192 };
  private readonly rulesetListeners: ((e: RulesetEvent) => void)[] = [];

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.parsed = opts.parsed;
    this.isReplay = !!opts.replay;
    this.settings = applyMods(opts.parsed.difficulty, opts.replay ? opts.replay.mods : opts.mods);
    this.clock = new SongClock(() => audioEngine.clockSeconds());
    this.ruleset = new StandardRuleset({
      beatmap: opts.parsed,
      mods: this.settings,
      onEvent: (e) => this.handleRulesetEvent(e),
    });
    const first = opts.parsed.hitObjects[0];
    const preempt = approachPreemptMs(this.settings.difficulty.approachRate) * this.settings.rate;
    // Start the intro so the first object appears about one second before it is due (osu-style skip).
    this.startChart = first ? first.time - preempt - 1000 : 0;
    const last = this.ruleset.lastObjectEnd;
    this.endChart = last + END_GRACE_MS;
    if (opts.replay) this.events.push(...opts.replay.events);
  }

  onRuleset(fn: (e: RulesetEvent) => void): () => void {
    this.rulesetListeners.push(fn);
    return () => {
      const i = this.rulesetListeners.indexOf(fn);
      if (i >= 0) this.rulesetListeners.splice(i, 1);
    };
  }

  private handleRulesetEvent(e: RulesetEvent): void {
    if (e.type === 'judgment' && this.opts.hitsounds) {
      const kind: HitsoundKind = e.judgment;
      audioEngine.playHitsound(kind);
    }
    if (e.type === 'fail') this.finish(false);
    this.opts.onRulesetEvent?.(e);
    for (const l of this.rulesetListeners) l(e);
  }

  get isReplaying(): boolean {
    return this.isReplay;
  }

  get lastPointerPosition(): { x: number; y: number } {
    return this.lastPointer;
  }

  get chartTime(): number {
    return this.clock.now();
  }

  /** Begin the play (or playback). Audio starts when the chart reaches 0. */
  start(): void {
    // Chart time before 0 is the intro: the clock runs, the ruleset has nothing due, and audio starts
    // after the lead-in delay (see scheduleMusic).
    this.clock.start(this.startChart, this.settings.rate);
    this.scheduleMusic(this.startChart);
    this.phase = 'running';
  }

  private scheduleMusic(chartMs: number): void {
    const buf = this.opts.audioBuffer;
    if (buf) audioEngine.startMusic(buf, chartMs, this.settings.rate);
  }

  /** Map a browser event timestamp (performance.now basis) to chart time, applying audio offset. */
  private chartTimeOfEvent(timeStampMs: number): number {
    const nowSecs = audioEngine.clockSeconds();
    const eventSecs = nowSecs - (performance.now() - timeStampMs) / 1000;
    return this.clock.chartAtSec(eventSecs) - this.opts.audioOffsetMs;
  }

  /** Apply one input/tick at chart time t. Used identically by live play and replay playback. */
  private apply(t: number, kind: number, a: number, b: number): void {
    this.ruleset.update(t);
    if (kind === 0) this.ruleset.setPointer(t, a, b);
    else if (kind === 1) this.ruleset.setButtons(t, a);
  }

  private record(t: number, kind: number, a: number, b: number): void {
    this.events.push(t, kind, a, b);
  }

  /** Browser pointer move. `x`,`y` are playfield coordinates (512x384) computed by the view. */
  pointerMove(timeStampMs: number, x: number, y: number): void {
    this.lastPointer = { x, y };
    if (this.phase !== 'running' || this.isReplay) return;
    const t = this.chartTimeOfEvent(timeStampMs);
    this.apply(t, 0, x, y);
    this.record(t, 0, x, y);
  }

  /** Button mask changed (bit0 K1, bit1 K2, bit2 mouse left, bit3 mouse right). */
  buttons(timeStampMs: number, mask: number): void {
    if (this.isReplay) return;
    if (this.phase !== 'running') {
      this.buttonsDown = 0;
      return;
    }
    const t = this.chartTimeOfEvent(timeStampMs);
    this.apply(t, 1, mask, 0);
    this.record(t, 1, mask, 0);
    this.buttonsDown = mask;
  }

  /** Called every animation frame. Advances the ruleset and drives playback. */
  frame(): void {
    if (this.ended) return;
    if (this.phase === 'resuming') {
      if (performance.now() >= this.resumeDeadline) this.completeResume();
      return;
    }
    if (this.phase === 'paused') return;
    const now = this.clock.now();
    if (this.isReplay) {
      const ev = this.events;
      while (this.replayIndex < ev.length && ev[this.replayIndex] <= now) {
        const i = this.replayIndex;
        this.apply(ev[i], ev[i + 1], ev[i + 2], ev[i + 3]);
        this.replayIndex += 4;
      }
      this.ruleset.update(now);
    } else {
      this.apply(now, 2, 0, 0);
      this.record(now, 2, 0, 0);
    }
    if (this.ruleset.complete) this.finish(!this.ruleset.failed);
    else if (now >= this.endChart) this.finish(true);
  }

  /** Pause: freeze the clock, stop music and release all buttons. */
  pause(): void {
    if (this.phase !== 'running') return;
    if (!this.isReplay && this.buttonsDown) {
      const t = this.clock.now();
      this.apply(t, 1, 0, 0);
      this.record(t, 1, 0, 0);
      this.buttonsDown = 0;
    }
    this.clock.pause();
    audioEngine.stopMusic();
    this.phase = 'paused';
  }

  /** Resume with a short countdown; the clock stays frozen until it completes. */
  resume(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'resuming';
    this.resumeDeadline = performance.now() + RESUME_COUNTDOWN_MS;
  }

  /** Remaining countdown for resume UI (ms), 0 when not resuming. */
  get resumeRemainingMs(): number {
    return this.phase === 'resuming' ? Math.max(0, this.resumeDeadline - performance.now()) : 0;
  }

  private completeResume(): void {
    const at = this.clock.pausedAt;
    this.clock.start(at, this.settings.rate);
    this.scheduleMusic(at);
    this.phase = 'running';
  }

  /** Playback speed for replays (affects audio playback rate and the clock). */
  get playbackRate(): number {
    return this.settings.rate;
  }

  /** Finish the session and emit a result once. */
  finish(passed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    audioEngine.stopMusic();
    const snap = this.ruleset.snapshot();
    const duration = Math.max(0, this.clock.now() - this.startChart);
    let replay: ReplayData | null = null;
    if (!this.isReplay) {
      replay = {
        format: REPLAY_FORMAT,
        version: REPLAY_VERSION,
        mode: 0,
        source: 'local',
        beatmap: {
          hash: this.opts.beatmapHash,
          fileName: this.opts.fileName,
          title: this.parsed.metadata.titleUnicode || this.parsed.metadata.title,
          version: this.parsed.metadata.version,
          artist: this.parsed.metadata.artistUnicode || this.parsed.metadata.artist,
        },
        mods: this.opts.mods,
        rate: this.settings.rate,
        audioOffsetMs: this.opts.audioOffsetMs,
        recordedAt: Date.now(),
        events: [...this.events],
        claimed: { score: snap.score, maxCombo: snap.maxCombo, accuracy: snap.accuracy, passed },
      };
    }
    this.opts.onEnd?.({
      passed,
      snapshot: snap,
      mods: this.opts.mods,
      settings: this.settings,
      durationMs: duration,
      progress: this.ruleset.progress,
      hitErrors: this.ruleset.hitErrors,
      events: [...this.events],
      hitErrorStats: this.ruleset.hitErrorStats,
      replay,
    });
  }

  /** Chart time at which the intro starts (the clock's initial position). */
  get introStartChart(): number {
    return this.startChart;
  }

  get isEnded(): boolean {
    return this.ended;
  }
}
