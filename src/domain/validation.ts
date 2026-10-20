import { z } from 'zod';
import { isLocalDate } from './dates';
import { RunActivity, RunKind } from './running';
import { SwimActivity, SwimEnvironment, SwimStroke } from './swimming';
import { DistanceUnit, parseDecimal, parseDuration, toMeters, METERS_PER_YARD } from './units';

/** Raw string form state → validated, metric domain objects. Errors are keyed by field. */
export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const optionalInt = (min: number, max: number, label: string) =>
  z.string().trim().transform((s, ctx) => {
    if (s === '') return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: 'custom', message: `${label} must be a whole number from ${min} to ${max}.` });
      return z.NEVER;
    }
    return n;
  });

const optionalDecimal = (min: number, label: string) =>
  z.string().trim().transform((s, ctx) => {
    if (s === '') return null;
    const n = parseDecimal(s);
    if (n == null || n < min) {
      ctx.addIssue({ code: 'custom', message: `Enter a valid ${label}.` });
      return z.NEVER;
    }
    return n;
  });

const requiredPositiveDistance = z.string().trim().transform((s, ctx) => {
  const n = parseDecimal(s);
  if (n == null || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Distance must be greater than zero.' });
    return z.NEVER;
  }
  return n;
});

const requiredDuration = z.string().trim().transform((s, ctx) => {
  const n = parseDuration(s);
  if (n == null || n <= 0) {
    ctx.addIssue({ code: 'custom', message: 'Enter a duration like 32:18 or 1:02:05.' });
    return z.NEVER;
  }
  return n;
});

const localDate = z.string().trim().refine(isLocalDate, 'Use the format YYYY-MM-DD.');
const optionalTime = z.string().trim().refine((s) => s === '' || /^([01]?\d|2[0-3]):[0-5]\d$/.test(s), 'Use 24-hour HH:MM.');

function collect<T>(r: z.ZodSafeParseResult<T>): FormResult<T> {
  if (r.success) return { ok: true, value: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? 'form');
    errors[k] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Combines a local date + optional HH:MM into an ISO timestamp with the device's offset. */
function startedAtIso(date: string, time: string): string | null {
  if (!time) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export interface RunForm {
  date: string;
  time: string;
  distance: string;
  duration: string;
  kind: RunKind;
  avgHr: string;
  maxHr: string;
  cadence: string;
  elevation: string;
  rpe: string;
  notes: string;
  /** Each split: distance (in `unit`) and duration string. */
  splits: { distance: string; duration: string }[];
}

export function parseRunForm(f: RunForm, unit: DistanceUnit): FormResult<Omit<RunActivity, 'id'>> {
  const schema = z
    .object({
      date: localDate,
      time: optionalTime,
      distance: requiredPositiveDistance,
      duration: requiredDuration,
      avgHr: optionalInt(30, 250, 'Average heart rate'),
      maxHr: optionalInt(30, 250, 'Max heart rate'),
      cadence: optionalInt(60, 260, 'Cadence'),
      elevation: optionalDecimal(0, 'elevation gain'),
      rpe: optionalInt(1, 10, 'RPE'),
      splits: z.array(z.object({ distance: requiredPositiveDistance, duration: requiredDuration })),
    })
    .superRefine((v, ctx) => {
      if (v.avgHr != null && v.maxHr != null && v.avgHr > v.maxHr) ctx.addIssue({ code: 'custom', path: ['avgHr'], message: 'Average heart rate can’t exceed max.' });
    });
  const r = collect(schema.safeParse(f));
  if (!r.ok) return r;
  const v = r.value;
  return {
    ok: true,
    value: {
      localDate: v.date,
      startedAt: startedAtIso(v.date, v.time),
      distanceM: toMeters(v.distance, unit),
      durationSec: v.duration,
      kind: f.kind,
      avgHr: v.avgHr,
      maxHr: v.maxHr,
      cadenceSpm: v.cadence,
      elevationGainM: v.elevation,
      rpe: v.rpe,
      notes: f.notes.trim() || null,
      splits: v.splits.map((s) => ({ distanceM: toMeters(s.distance, unit), durationSec: s.duration })),
    },
  };
}

export interface SwimForm {
  date: string;
  time: string;
  distance: string;
  distanceUnit: 'm' | 'yd';
  duration: string;
  environment: SwimEnvironment;
  poolLength: string;
  poolLengthUnit: 'm' | 'yd';
  laps: string;
  stroke: SwimStroke | null;
  avgHr: string;
  rpe: string;
  notes: string;
}

export function parseSwimForm(f: SwimForm): FormResult<Omit<SwimActivity, 'id'>> {
  const schema = z.object({
    date: localDate,
    time: optionalTime,
    distance: requiredPositiveDistance,
    duration: requiredDuration,
    poolLength: optionalDecimal(10, 'pool length'),
    laps: optionalInt(1, 10000, 'Laps'),
    avgHr: optionalInt(30, 250, 'Average heart rate'),
    rpe: optionalInt(1, 10, 'RPE'),
  });
  const r = collect(schema.safeParse(f));
  if (!r.ok) return r;
  const v = r.value;
  const pool = f.environment === 'pool';
  const poolLengthM = pool && v.poolLength != null ? (f.poolLengthUnit === 'yd' ? v.poolLength * METERS_PER_YARD : v.poolLength) : null;
  if (poolLengthM != null && poolLengthM > 100) return { ok: false, errors: { poolLength: 'Pool length must be 100 m or less.' } };
  return {
    ok: true,
    value: {
      localDate: v.date,
      startedAt: startedAtIso(v.date, v.time),
      distanceM: f.distanceUnit === 'yd' ? v.distance * METERS_PER_YARD : v.distance,
      durationSec: v.duration,
      environment: f.environment,
      poolLengthM,
      poolLengthUnit: poolLengthM != null ? f.poolLengthUnit : null,
      laps: pool ? v.laps : null,
      stroke: f.stroke,
      avgHr: v.avgHr,
      rpe: v.rpe,
      notes: f.notes.trim() || null,
    },
  };
}
