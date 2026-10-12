import type { TimingPoint } from './types';

/**
 * Timing-point lookup. Points are assumed sorted by time.
 * Uninherited points define beat length and meter; inherited points define slider velocity multipliers.
 */
export class TimingInfo {
  private readonly uninherited: TimingPoint[];
  private readonly inherited: TimingPoint[];

  constructor(points: TimingPoint[]) {
    const sorted = [...points].sort((a, b) => a.time - b.time);
    this.uninherited = sorted.filter((p) => p.uninherited);
    this.inherited = sorted.filter((p) => !p.uninherited);
    if (this.uninherited.length === 0) {
      // Fallback: 120 BPM, which is what osu! assumes for unusable charts.
      this.uninherited.push({ time: 0, beatLength: 500, meter: 4, uninherited: true, volume: 100, effects: 0, sampleSet: 1, sampleIndex: 0 });
    }
  }

  /** Active uninherited (red line) point at time t. */
  redLineAt(t: number): TimingPoint {
    return lastAtOrBefore(this.uninherited, t) ?? this.uninherited[0];
  }

  beatLengthAt(t: number): number {
    const b = this.redLineAt(t).beatLength;
    return b > 0 && isFinite(b) ? b : 500;
  }

  /** Slider velocity multiplier active at time t (1 when no inherited point applies). */
  sliderVelocityAt(t: number): number {
    const p = lastAtOrBefore(this.inherited, t);
    if (!p || p.beatLength >= 0) return 1;
    const sv = -100 / p.beatLength;
    return sv > 0 && isFinite(sv) ? sv : 1;
  }

  /** Slider duration in ms for a slider of pixelLength × repeats at time t. */
  sliderDuration(t: number, pixelLength: number, repeats: number, sliderMultiplier: number): number {
    const pxPerBeat = 100 * sliderMultiplier * this.sliderVelocityAt(t);
    if (pxPerBeat <= 0) return 0;
    return (pixelLength * repeats * this.beatLengthAt(t)) / pxPerBeat;
  }

  /** Pixel distance between slider ticks. */
  tickDistance(t: number, sliderMultiplier: number, tickRate: number): number {
    const pxPerBeat = 100 * sliderMultiplier * this.sliderVelocityAt(t);
    return pxPerBeat / Math.max(0.0001, tickRate);
  }

  /** Time signature numerator at time t. */
  meterAt(t: number): number {
    return this.redLineAt(t).meter || 4;
  }
}

function lastAtOrBefore(arr: TimingPoint[], t: number): TimingPoint | undefined {
  let lo = 0;
  let hi = arr.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? arr[found] : undefined;
}
