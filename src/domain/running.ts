import { LocalDate, weekStart } from './dates';
import { DistanceUnit, METERS_PER_MILE } from './units';

export type RunKind = 'outdoor' | 'treadmill' | 'trail';

export interface RunSplit {
  distanceM: number;
  durationSec: number;
}

export interface RunActivity {
  id: string;
  localDate: LocalDate;
  startedAt: string | null;
  distanceM: number;
  durationSec: number;
  kind: RunKind;
  avgHr: number | null;
  maxHr: number | null;
  cadenceSpm: number | null;
  elevationGainM: number | null;
  rpe: number | null;
  notes: string | null;
  splits: RunSplit[];
}

/**
 * Average pace in seconds per kilometer: duration_s / distance_km.
 * Returns null for non-positive or non-finite input instead of producing Infinity/NaN.
 */
export function paceSecPerKm(durationSec: number, distanceM: number): number | null {
  if (!(durationSec > 0) || !(distanceM > 0) || !Number.isFinite(durationSec) || !Number.isFinite(distanceM)) {
    return null;
  }
  return durationSec / (distanceM / 1000);
}

/** Pace in seconds per selected display unit (km or mile). */
export function pacePerUnit(durationSec: number, distanceM: number, unit: DistanceUnit): number | null {
  const perKm = paceSecPerKm(durationSec, distanceM);
  if (perKm == null) return null;
  return unit === 'mi' ? perKm * (METERS_PER_MILE / 1000) : perKm;
}

export interface SplitConsistency {
  /** Pace for each split, seconds per km. */
  pacesSecPerKm: number[];
  meanPaceSecPerKm: number;
  /** Population standard deviation of split paces, seconds per km. */
  stdDevSecPerKm: number;
  /** Coefficient of variation (stdDev / mean). Lower = more even pacing. */
  coefficientOfVariation: number;
  fastestIndex: number;
  slowestIndex: number;
  /** Second-half mean pace minus first-half mean pace. Negative = negative split (sped up). */
  halfDeltaSecPerKm: number;
}

/**
 * Split consistency, only computed from splits the user actually supplied.
 * Requires at least two valid splits; never interpolates missing ones.
 */
export function splitConsistency(splits: RunSplit[]): SplitConsistency | null {
  const paces = splits.map((s) => paceSecPerKm(s.durationSec, s.distanceM));
  if (paces.length < 2 || paces.some((p) => p == null)) return null;
  const p = paces as number[];
  const mean = p.reduce((a, b) => a + b, 0) / p.length;
  const variance = p.reduce((a, b) => a + (b - mean) ** 2, 0) / p.length;
  const std = Math.sqrt(variance);
  const half = Math.floor(p.length / 2);
  const firstHalf = p.slice(0, half);
  const secondHalf = p.slice(p.length - half);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    pacesSecPerKm: p,
    meanPaceSecPerKm: mean,
    stdDevSecPerKm: std,
    coefficientOfVariation: std / mean,
    fastestIndex: p.indexOf(Math.min(...p)),
    slowestIndex: p.indexOf(Math.max(...p)),
    halfDeltaSecPerKm: avg(secondHalf) - avg(firstHalf),
  };
}

/** Sum of supplied split distances/durations, used to flag disagreement with the activity totals. */
export function splitTotalsMismatch(
  activity: Pick<RunActivity, 'distanceM' | 'durationSec'>,
  splits: RunSplit[],
): { distanceDiffM: number; durationDiffSec: number } | null {
  if (splits.length === 0) return null;
  const d = splits.reduce((a, s) => a + s.distanceM, 0);
  const t = splits.reduce((a, s) => a + s.durationSec, 0);
  const distanceDiffM = d - activity.distanceM;
  const durationDiffSec = t - activity.durationSec;
  // Tolerances: 1% distance (GPS/rounding), 2 s duration.
  if (Math.abs(distanceDiffM) <= activity.distanceM * 0.01 && Math.abs(durationDiffSec) <= 2) return null;
  return { distanceDiffM, durationDiffSec };
}

export interface WeeklyTotal {
  weekStart: LocalDate;
  distanceM: number;
  durationSec: number;
  count: number;
}

/** Totals grouped by ISO week (Monday start) of each activity's local date. Sorted ascending. */
export function weeklyTotals(
  activities: { localDate: LocalDate; distanceM: number; durationSec: number }[],
): WeeklyTotal[] {
  const map = new Map<LocalDate, WeeklyTotal>();
  for (const a of activities) {
    const ws = weekStart(a.localDate);
    const t = map.get(ws) ?? { weekStart: ws, distanceM: 0, durationSec: 0, count: 0 };
    t.distanceM += a.distanceM;
    t.durationSec += a.durationSec;
    t.count += 1;
    map.set(ws, t);
  }
  return [...map.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Personal-record definitions (documented in docs/METRICS.md):
 * - "Fastest average pace, runs ≥ D": lowest whole-activity average pace among runs of the same
 *   kind with distance ≥ D. Treadmill and outdoor runs are not compared with each other.
 * - "Longest run": greatest distance. "Longest duration": greatest moving time entered.
 * We never derive a time for a sub-distance from a longer run (that would require splits we may not have).
 */
export const RUN_PR_DISTANCES_M = [1000, 5000, 10000, 21097.5, 42195] as const;

export interface RunRecord {
  label: string;
  activityId: string;
  value: number;
  kind: RunKind;
  metric: 'pace' | 'distance' | 'duration';
}

export function runPersonalRecords(activities: RunActivity[]): RunRecord[] {
  const records: RunRecord[] = [];
  const kinds: RunKind[] = ['outdoor', 'trail', 'treadmill'];
  for (const kind of kinds) {
    const ofKind = activities.filter((a) => a.kind === kind);
    if (ofKind.length === 0) continue;
    for (const d of RUN_PR_DISTANCES_M) {
      let best: RunActivity | null = null;
      let bestPace = Infinity;
      for (const a of ofKind) {
        if (a.distanceM < d) continue;
        const pace = paceSecPerKm(a.durationSec, a.distanceM);
        if (pace != null && pace < bestPace) {
          bestPace = pace;
          best = a;
        }
      }
      if (best) {
        records.push({ label: `Fastest avg pace, ${labelDistance(d)}+`, activityId: best.id, value: bestPace, kind, metric: 'pace' });
      }
    }
    const longest = ofKind.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
    records.push({ label: 'Longest run', activityId: longest.id, value: longest.distanceM, kind, metric: 'distance' });
    const longestTime = ofKind.reduce((a, b) => (b.durationSec > a.durationSec ? b : a));
    records.push({ label: 'Longest duration', activityId: longestTime.id, value: longestTime.durationSec, kind, metric: 'duration' });
  }
  return records;
}

function labelDistance(m: number): string {
  if (m === 21097.5) return 'half marathon';
  if (m === 42195) return 'marathon';
  return `${m / 1000} km`;
}

export interface PaceHrPoint {
  activityId: string;
  localDate: LocalDate;
  paceSecPerKm: number;
  avgHr: number;
  /** Meters per minute per heartbeat-per-minute ("meters per beat"). Higher = more efficient. */
  metersPerBeat: number;
}

/** Only activities with both pace and average HR. No zone inference. */
export function paceVsHeartRate(activities: RunActivity[]): PaceHrPoint[] {
  return activities
    .filter((a) => a.avgHr != null && a.avgHr > 0)
    .map((a) => {
      const pace = paceSecPerKm(a.durationSec, a.distanceM);
      if (pace == null) return null;
      const speedMPerMin = a.distanceM / (a.durationSec / 60);
      return {
        activityId: a.id,
        localDate: a.localDate,
        paceSecPerKm: pace,
        avgHr: a.avgHr as number,
        metersPerBeat: speedMPerMin / (a.avgHr as number),
      };
    })
    .filter((p): p is PaceHrPoint => p != null)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}
