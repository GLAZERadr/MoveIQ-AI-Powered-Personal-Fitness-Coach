import { LANDMARK_INDEX, LandmarkName, PoseLandmark, Side } from './types';

export interface Pt {
  x: number;
  y: number;
}

/** Interior angle ABC in degrees (0..180). NaN when a segment has zero length. */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle of segment from→to relative to vertical (0 = upright, 90 = horizontal), degrees. */
export function angleFromVertical(from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return NaN;
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

/**
 * Signed perpendicular offset of p from the line a→b, normalized by |ab|.
 * Positive = p lies "below" the line in image coordinates (greater y) when the line runs left↔right.
 */
export function signedOffsetFromLine(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return NaN;
  // Cross product z / len² gives offset in units of line length.
  const cross = (dx * (p.y - a.y) - dy * (p.x - a.x)) / (len * len);
  // Make the sign independent of whether the user faces left or right.
  return dx >= 0 ? cross : -cross;
}

export function sideName(side: Side, joint: 'Shoulder' | 'Elbow' | 'Wrist' | 'Hip' | 'Knee' | 'Ankle' | 'Heel' | 'FootIndex'): LandmarkName {
  return `${side}${joint}` as LandmarkName;
}

export function lm(landmarks: PoseLandmark[], name: LandmarkName): PoseLandmark {
  const l = landmarks[LANDMARK_INDEX[name]];
  if (!l) throw new Error(`Missing landmark ${name}`);
  return l;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Exponential smoothing for a scalar signal. Resets after a gap so stale values don't leak. */
export class EmaFilter {
  private value: number | null = null;
  private lastT = 0;
  constructor(
    private readonly alpha: number,
    private readonly resetAfterMs: number,
  ) {}

  next(x: number, t: number): number {
    if (this.value == null || t - this.lastT > this.resetAfterMs) this.value = x;
    else this.value = this.alpha * x + (1 - this.alpha) * this.value;
    this.lastT = t;
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}
