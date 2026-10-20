import { LocalDate } from './dates';

export type SwimEnvironment = 'pool' | 'open_water';
export type SwimStroke = 'freestyle' | 'breaststroke' | 'backstroke' | 'butterfly' | 'mixed';

export interface SwimActivity {
  id: string;
  localDate: LocalDate;
  startedAt: string | null;
  distanceM: number;
  durationSec: number;
  environment: SwimEnvironment;
  /** Always meters internally, even when the user entered yards. */
  poolLengthM: number | null;
  poolLengthUnit: 'm' | 'yd' | null;
  laps: number | null;
  stroke: SwimStroke | null;
  avgHr: number | null;
  rpe: number | null;
  notes: string | null;
}

/** pace per 100 m (seconds) = duration_s / distance_m × 100. Null for invalid input. */
export function pacePer100m(durationSec: number, distanceM: number): number | null {
  if (!(durationSec > 0) || !(distanceM > 0) || !Number.isFinite(durationSec) || !Number.isFinite(distanceM)) {
    return null;
  }
  return (durationSec / distanceM) * 100;
}

export type PoolDistanceCheck =
  | { status: 'consistent'; expectedM: number }
  | { status: 'inconsistent'; expectedM: number; diffM: number }
  | { status: 'not_applicable' };

/**
 * For pool swims with both pool length and lap count, checks that laps × length ≈ distance.
 * A "lap" here means one pool length. We flag, never overwrite: the user may have counted
 * lengths differently or stopped mid-length.
 */
export function checkPoolDistance(
  a: Pick<SwimActivity, 'environment' | 'poolLengthM' | 'laps' | 'distanceM'>,
): PoolDistanceCheck {
  if (a.environment !== 'pool' || a.poolLengthM == null || a.laps == null) return { status: 'not_applicable' };
  const expectedM = a.poolLengthM * a.laps;
  const diffM = a.distanceM - expectedM;
  // Half a metre tolerance absorbs yard↔metre rounding.
  if (Math.abs(diffM) <= 0.5) return { status: 'consistent', expectedM };
  return { status: 'inconsistent', expectedM, diffM };
}

export interface SwimRecord {
  label: string;
  activityId: string;
  value: number;
  environment: SwimEnvironment;
  stroke: SwimStroke | null;
  metric: 'pace' | 'distance';
}

export const SWIM_PR_DISTANCES_M = [100, 400, 1000, 1500] as const;

/**
 * Personal records, never mixing pool and open water (different conditions, no walls to push off).
 * Pace records are grouped by stroke when stroke is known; unknown stroke is its own group.
 */
export function swimPersonalRecords(activities: SwimActivity[]): SwimRecord[] {
  const out: SwimRecord[] = [];
  const envs: SwimEnvironment[] = ['pool', 'open_water'];
  for (const env of envs) {
    const ofEnv = activities.filter((a) => a.environment === env);
    if (ofEnv.length === 0) continue;
    const strokes = [...new Set(ofEnv.map((a) => a.stroke))];
    for (const stroke of strokes) {
      const group = ofEnv.filter((a) => a.stroke === stroke);
      for (const d of SWIM_PR_DISTANCES_M) {
        let best: SwimActivity | null = null;
        let bestPace = Infinity;
        for (const a of group) {
          if (a.distanceM < d) continue;
          const p = pacePer100m(a.durationSec, a.distanceM);
          if (p != null && p < bestPace) {
            bestPace = p;
            best = a;
          }
        }
        if (best) {
          out.push({
            label: `Fastest avg /100m, ${d} m+`,
            activityId: best.id,
            value: bestPace,
            environment: env,
            stroke,
            metric: 'pace',
          });
        }
      }
    }
    const longest = ofEnv.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
    out.push({ label: 'Longest swim', activityId: longest.id, value: longest.distanceM, environment: env, stroke: null, metric: 'distance' });
  }
  return out;
}

export interface StrokeSummary {
  stroke: SwimStroke;
  sessions: number;
  distanceM: number;
  avgPacePer100m: number;
}

/** Distance-weighted average pace per stroke. Only sessions with a recorded stroke. Pool only by default. */
export function strokeComparison(activities: SwimActivity[], environment: SwimEnvironment = 'pool'): StrokeSummary[] {
  const map = new Map<SwimStroke, { sessions: number; distanceM: number; durationSec: number }>();
  for (const a of activities) {
    if (a.stroke == null || a.environment !== environment || !(a.distanceM > 0)) continue;
    const s = map.get(a.stroke) ?? { sessions: 0, distanceM: 0, durationSec: 0 };
    s.sessions += 1;
    s.distanceM += a.distanceM;
    s.durationSec += a.durationSec;
    map.set(a.stroke, s);
  }
  return [...map.entries()].map(([stroke, s]) => ({
    stroke,
    sessions: s.sessions,
    distanceM: s.distanceM,
    avgPacePer100m: (s.durationSec / s.distanceM) * 100,
  }));
}
