import type { Vec2 } from './types';

/**
 * A slider path sampled into a polyline with cumulative arc lengths.
 * Coordinates are in osu! playfield pixels (512x384).
 */
export interface SliderPath {
  xs: Float64Array;
  ys: Float64Array;
  /** cum[i] = arc length from point 0 to point i. */
  cum: Float64Array;
  length: number;
}

export function bezierAt(points: Vec2[], t: number): Vec2 {
  // De Casteljau
  const tmp = points.map((p) => ({ x: p.x, y: p.y }));
  for (let k = 1; k < tmp.length; k++) {
    for (let i = 0; i < tmp.length - k; i++) {
      tmp[i] = { x: tmp[i].x * (1 - t) + tmp[i + 1].x * t, y: tmp[i].y * (1 - t) + tmp[i + 1].y * t };
    }
  }
  return tmp[0];
}

/** Split bezier control points where two consecutive points coincide (osu! red-anchor convention). */
export function splitBezierSegments(points: Vec2[]): Vec2[][] {
  const segments: Vec2[][] = [];
  let cur: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (p.x === prev.x && p.y === prev.y) {
      if (cur.length > 1) segments.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  if (cur.length > 0) segments.push(cur);
  return segments;
}

function sampleBezier(points: Vec2[], out: Vec2[]): void {
  // Approximate length to pick a step count (about one sample per 2px).
  let approx = 0;
  for (let i = 1; i < points.length; i++) {
    approx += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  const steps = Math.max(2, Math.min(1000, Math.ceil(approx / 2)));
  for (let s = 0; s <= steps; s++) out.push(bezierAt(points, s / steps));
}

/** Circumscribed circle through three points or null if they are collinear. */
export function circumcircle(a: Vec2, b: Vec2, c: Vec2): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

function perfectCirclePoints(start: Vec2, mid: Vec2, end: Vec2, pixelLength: number): Vec2[] | null {
  const circ = circumcircle(start, mid, end);
  if (!circ || !isFinite(circ.r) || circ.r > 1e5) return null;
  const { cx, cy, r } = circ;
  const a0 = Math.atan2(start.y - cy, start.x - cx);
  const am = Math.atan2(mid.y - cy, mid.x - cx);
  const a1 = Math.atan2(end.y - cy, end.x - cx);
  const tau = Math.PI * 2;
  const norm = (v: number) => ((v % tau) + tau) % tau;
  const ccwMid = norm(am - a0);
  const ccwEnd = norm(a1 - a0);
  const dir = ccwMid < ccwEnd ? 1 : -1;
  const totalAngle = (pixelLength / r) * dir;
  const steps = Math.max(2, Math.min(1000, Math.ceil(Math.abs(pixelLength) / 2)));
  const out: Vec2[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = a0 + (totalAngle * s) / steps;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Catmull-Rom spline through control points (uniform parameterisation). */
function catmullPoints(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const steps = 16;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[n - 1]);
  return out;
}

/**
 * Build the geometric path of a slider head + control points, trimmed or extended to pixelLength.
 * Curve types: L (linear), P (perfect circle, falls back to bezier), B (bezier), C (catmull, approximated).
 */
export function buildSliderPath(head: Vec2, curveType: 'L' | 'P' | 'B' | 'C', controlPoints: Vec2[], pixelLength: number): SliderPath {
  const all = [head, ...controlPoints];
  let pts: Vec2[] = [];
  if (curveType === 'P' && all.length === 3) {
    pts = perfectCirclePoints(all[0], all[1], all[2], pixelLength) ?? [];
    if (pts.length === 0) {
      const segs = splitBezierSegments(all);
      segs.forEach((s) => sampleBezier(s, pts));
    }
  } else if (curveType === 'L') {
    pts = all;
  } else if (curveType === 'C') {
    pts = catmullPoints(all);
  } else {
    const segs = splitBezierSegments(all);
    segs.forEach((s) => sampleBezier(s, pts));
  }
  if (pts.length === 0) pts = [head, head];
  if (pts.length === 1) pts.push({ x: pts[0].x, y: pts[0].y });

  // Accumulate lengths, dropping zero-length duplicates.
  const xs: number[] = [pts[0].x];
  const ys: number[] = [pts[0].y];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - xs[xs.length - 1];
    const dy = pts[i].y - ys[ys.length - 1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-9) continue;
    xs.push(pts[i].x);
    ys.push(pts[i].y);
    cum.push(cum[cum.length - 1] + d);
  }
  if (xs.length === 1) {
    xs.push(xs[0] + 0.0001);
    ys.push(ys[0]);
    cum.push(0.0001);
  }
  // Trim to the authoritative length.
  const total = cum[cum.length - 1];
  if (total > pixelLength && pixelLength > 0) {
    let k = 1;
    while (k < cum.length && cum[k] < pixelLength) k++;
    const i0 = k - 1;
    const seg = cum[k] - cum[i0];
    const f = seg > 0 ? (pixelLength - cum[i0]) / seg : 0;
    const x = xs[i0] + (xs[k] - xs[i0]) * f;
    const y = ys[i0] + (ys[k] - ys[i0]) * f;
    xs.length = k;
    ys.length = k;
    cum.length = k;
    xs.push(x);
    ys.push(y);
    cum.push(pixelLength);
  } else if (total < pixelLength && pixelLength > 0) {
    // Extend along the final direction (osu! behaviour for under-length paths).
    const n = xs.length;
    const dx = xs[n - 1] - xs[n - 2];
    const dy = ys[n - 1] - ys[n - 2];
    const d = Math.hypot(dx, dy) || 1;
    const extra = pixelLength - total;
    xs.push(xs[n - 1] + (dx / d) * extra);
    ys.push(ys[n - 1] + (dy / d) * extra);
    cum.push(pixelLength);
  }
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    cum: Float64Array.from(cum),
    length: cum[cum.length - 1],
  };
}

/** Position along a sampled path at arc distance d (clamped to [0, length]). */
export function pathPointAt(path: SliderPath, d: number, out: Vec2): Vec2 {
  const { cum, xs, ys, length } = path;
  const dd = d <= 0 ? 0 : d >= length ? length : d;
  // binary search for segment
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dd) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (dd - cum[lo]) / seg : 0;
  out.x = xs[lo] + (xs[hi] - xs[lo]) * f;
  out.y = ys[lo] + (ys[hi] - ys[lo]) * f;
  return out;
}
