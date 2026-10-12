/** Conversions from the chart difficulty values (CS/AR/OD) to playfield pixels and milliseconds. */

export const PLAYFIELD_WIDTH = 512;
export const PLAYFIELD_HEIGHT = 384;

/** Circle radius in playfield pixels. */
export function circleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

/** Real-time preempt (approach) duration in ms for AR. */
export function approachPreemptMs(ar: number): number {
  if (ar < 5) return 1200 + (600 * (5 - ar)) / 5;
  if (ar === 5) return 1200;
  return 1200 - (750 * (ar - 5)) / 5;
}

/** Real-time approach fade-in duration for AR (osu! uses 800ms at AR5 spanning the preempt). */
export function fadeInMs(ar: number): number {
  if (ar < 5) return 800 + (400 * (5 - ar)) / 5;
  if (ar === 5) return 800;
  return 800 - (500 * (ar - 5)) / 5;
}

/**
 * Hit windows in real-time milliseconds for OD (half-windows, i.e. ±ms).
 * Great 80-6*OD, Good 140-8*OD, Meh 200-10*OD; the miss window equals the Meh window.
 */
export interface HitWindows {
  great: number;
  good: number;
  meh: number;
}

export function hitWindows(od: number): HitWindows {
  return {
    great: 80 - 6 * od,
    good: 140 - 8 * od,
    meh: 200 - 10 * od,
  };
}

/** Slider follow-circle radius (2.4× the circle radius). */
export function followRadius(cs: number): number {
  return circleRadius(cs) * 2.4;
}
