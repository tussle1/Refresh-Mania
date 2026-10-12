/**
 * Song clock. Chart time advances with the audio context clock (or performance.now when no audio
 * is available), scaled by the playback rate. Pausing freezes the chart position.
 */
export class SongClock {
  private anchorSec = 0;
  private anchorChart = 0;
  private running = false;
  private frozen = 0;
  private rate = 1;

  constructor(private readonly nowSec: () => number) {}

  /** Current chart time (ms). */
  now(): number {
    return this.running ? this.chartAtSec(this.nowSec()) : this.frozen;
  }

  /** Chart time at an arbitrary clock-seconds timestamp (used to map input event times). */
  chartAtSec(sec: number): number {
    return this.anchorChart + (sec - this.anchorSec) * 1000 * this.rate;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get playbackRate(): number {
    return this.rate;
  }

  start(chartMs: number, rate: number): void {
    this.anchorSec = this.nowSec();
    this.anchorChart = chartMs;
    this.rate = rate;
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.frozen = this.now();
    this.running = false;
  }

  /** Set the frozen position (used when the chart is seeked while paused). */
  seekPaused(chartMs: number): void {
    this.frozen = chartMs;
  }

  get pausedAt(): number {
    return this.frozen;
  }
}
