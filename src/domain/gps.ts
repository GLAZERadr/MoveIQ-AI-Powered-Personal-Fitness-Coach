/**
 * GPS track processing for recorded runs (pure, tested).
 *
 * Points come from the phone's GNSS via expo-location. Raw fixes are noisy, so we:
 *  - drop fixes with poor horizontal accuracy,
 *  - drop physically implausible jumps (speed spikes),
 *  - only sum distance within a recording segment (pause/resume starts a new segment),
 *  - count "moving time" only where the runner is actually moving,
 *  - compute elevation gain with hysteresis so altitude noise isn't counted as climbing.
 * Per-km splits are derived from the recorded track (time at each km boundary is interpolated
 * between the two real fixes that straddle it); they are measured, not invented.
 */

export interface GpsPoint {
  t: number; // epoch ms
  lat: number;
  lon: number;
  alt: number | null; // meters
  accuracy: number | null; // horizontal, meters
  segment: number; // increments on resume after pause
}

export const GPS_CONFIG = {
  maxAccuracyM: 25,
  maxSpeedMps: 9, // ~2:00/km sprint; faster jumps are GPS glitches
  minMovingSpeedMps: 0.6, // below this (walking in place / standing) time isn't "moving"
  maxGapForMovingMs: 15_000, // long gaps (tunnel) don't count as moving
  elevationHysteresisM: 3,
};

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: Pick<GpsPoint, 'lat' | 'lon'>, b: Pick<GpsPoint, 'lat' | 'lon'>): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Removes inaccurate fixes, duplicates and implausible jumps. Keeps time order. */
export function cleanTrack(points: GpsPoint[], cfg = GPS_CONFIG): GpsPoint[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: GpsPoint[] = [];
  for (const p of sorted) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.accuracy != null && p.accuracy > cfg.maxAccuracyM) continue;
    const prev = out[out.length - 1];
    if (prev && prev.segment === p.segment) {
      const dt = (p.t - prev.t) / 1000;
      if (dt <= 0) continue;
      if (haversine(prev, p) / dt > cfg.maxSpeedMps) continue;
    }
    out.push(p);
  }
  return out;
}

export interface Split {
  distanceM: number;
  durationSec: number;
}

export interface TrackStats {
  distanceM: number;
  /** Sum of segment durations (excludes paused time). */
  elapsedSec: number;
  /** Time spent actually moving. */
  movingSec: number;
  elevationGainM: number | null;
  splits: Split[];
  points: number;
  startedAt: number | null;
  endedAt: number | null;
}

export function trackStats(raw: GpsPoint[], splitM = 1000, cfg = GPS_CONFIG): TrackStats {
  const pts = cleanTrack(raw, cfg);
  let distance = 0;
  let elapsed = 0;
  let moving = 0;
  const splits: Split[] = [];
  let splitStartTime = 0; // in "elapsed" seconds
  let nextBoundary = splitM;

  // Elevation: centered moving average (5 fixes) to suppress GNSS altitude jitter, then hysteresis.
  const alts = pts.map((p) => (p.alt != null && Number.isFinite(p.alt) ? p.alt : null));
  const smoothAlt = alts.map((_, i) => {
    const w = alts.slice(Math.max(0, i - 2), i + 3).filter((a): a is number => a != null);
    return alts[i] == null || w.length === 0 ? null : w.reduce((a, b) => a + b, 0) / w.length;
  });
  let gain = 0;
  let altRef: number | null = null;
  let altCount = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const alt = smoothAlt[i];
    if (alt != null) {
      altCount++;
      if (altRef == null) altRef = alt;
      else if (alt - altRef > cfg.elevationHysteresisM) {
        gain += alt - altRef;
        altRef = alt;
      } else if (altRef - alt > cfg.elevationHysteresisM) altRef = alt;
    }
    const prev = pts[i - 1];
    if (!prev || prev.segment !== p.segment) continue;
    const dt = (p.t - prev.t) / 1000;
    const d = haversine(prev, p);
    const elapsedBefore = elapsed;
    const distBefore = distance;
    distance += d;
    elapsed += dt;
    if (d / dt >= cfg.minMovingSpeedMps && dt * 1000 <= cfg.maxGapForMovingMs) moving += dt;
    // Record each km boundary crossed within this step, interpolating time linearly between the fixes.
    while (distance >= nextBoundary && d > 0) {
      const frac = (nextBoundary - distBefore) / d;
      const tAt = elapsedBefore + frac * dt;
      splits.push({ distanceM: splitM, durationSec: tAt - splitStartTime });
      splitStartTime = tAt;
      nextBoundary += splitM;
    }
  }
  // Final partial split (only if meaningful).
  const rest = distance - (nextBoundary - splitM);
  if (splits.length > 0 && rest >= 50) splits.push({ distanceM: rest, durationSec: elapsed - splitStartTime });

  return {
    distanceM: distance,
    elapsedSec: elapsed,
    movingSec: moving,
    elevationGainM: altCount >= 2 ? gain : null,
    splits,
    points: pts.length,
    startedAt: pts[0]?.t ?? null,
    endedAt: pts[pts.length - 1]?.t ?? null,
  };
}

/** Pace over the last `windowM` meters of the current segment (s/km), for the live display. */
export function currentPaceSecPerKm(raw: GpsPoint[], windowM = 200): number | null {
  const pts = cleanTrack(raw);
  const last = pts[pts.length - 1];
  if (!last) return null;
  let d = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.segment !== last.segment) break;
    d += haversine(a, b);
    if (d >= windowM) {
      const dt = (last.t - a.t) / 1000;
      return dt > 0 ? dt / (d / 1000) : null;
    }
  }
  return null;
}

/** Reduces a track for drawing (keeps shape; Douglas-Peucker-like by distance step). */
export function simplifyForMap(points: GpsPoint[], minStepM = 5): [number, number][] {
  const out: [number, number][] = [];
  let last: GpsPoint | null = null;
  for (const p of points) {
    if (!last || haversine(last, p) >= minStepM || last.segment !== p.segment) {
      out.push([p.lat, p.lon]);
      last = p;
    }
  }
  return out;
}
