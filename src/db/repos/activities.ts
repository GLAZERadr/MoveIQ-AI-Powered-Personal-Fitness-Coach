import { LocalDate } from '../../domain/dates';
import { RunActivity, RunKind, RunSplit } from '../../domain/running';
import { SwimActivity, SwimEnvironment, SwimStroke } from '../../domain/swimming';
import { newId, nowIso } from '../../lib/id';
import { Db } from '../types';

interface RunRow {
  id: string;
  local_date: string;
  started_at: string | null;
  distance_m: number;
  duration_sec: number;
  kind: RunKind;
  avg_hr: number | null;
  max_hr: number | null;
  cadence_spm: number | null;
  elevation_gain_m: number | null;
  rpe: number | null;
  notes: string | null;
}

export async function listRuns(db: Db, from?: LocalDate): Promise<RunActivity[]> {
  const rows = from
    ? await db.all<RunRow>('SELECT * FROM running_activities WHERE local_date >= ? ORDER BY local_date DESC, started_at DESC', [from])
    : await db.all<RunRow>('SELECT * FROM running_activities ORDER BY local_date DESC, started_at DESC');
  const splits = await db.all<{ activity_id: string; split_index: number; distance_m: number; duration_sec: number }>(
    'SELECT * FROM running_splits ORDER BY activity_id, split_index',
  );
  const byRun = new Map<string, RunSplit[]>();
  for (const s of splits) {
    const arr = byRun.get(s.activity_id) ?? [];
    arr.push({ distanceM: s.distance_m, durationSec: s.duration_sec });
    byRun.set(s.activity_id, arr);
  }
  return rows.map((r) => mapRun(r, byRun.get(r.id) ?? []));
}

export async function getRun(db: Db, id: string): Promise<RunActivity | null> {
  const r = await db.first<RunRow>('SELECT * FROM running_activities WHERE id = ?', [id]);
  if (!r) return null;
  const splits = await db.all<{ distance_m: number; duration_sec: number }>(
    'SELECT distance_m, duration_sec FROM running_splits WHERE activity_id = ? ORDER BY split_index',
    [id],
  );
  return mapRun(r, splits.map((s) => ({ distanceM: s.distance_m, durationSec: s.duration_sec })));
}

function mapRun(r: RunRow, splits: RunSplit[]): RunActivity {
  return {
    id: r.id,
    localDate: r.local_date,
    startedAt: r.started_at,
    distanceM: r.distance_m,
    durationSec: r.duration_sec,
    kind: r.kind,
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
    cadenceSpm: r.cadence_spm,
    elevationGainM: r.elevation_gain_m,
    rpe: r.rpe,
    notes: r.notes,
    splits,
  };
}

/** Saves a run and replaces its splits atomically. Upsert by id makes retries safe. */
export async function upsertRun(db: Db, a: Omit<RunActivity, 'id'> & { id?: string; source?: 'manual' | 'gps' }): Promise<string> {
  const id = a.id ?? newId();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO running_activities (id, local_date, started_at, distance_m, duration_sec, kind, avg_hr, max_hr, cadence_spm, elevation_gain_m, rpe, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET local_date = excluded.local_date, started_at = excluded.started_at, distance_m = excluded.distance_m,
         duration_sec = excluded.duration_sec, kind = excluded.kind, avg_hr = excluded.avg_hr, max_hr = excluded.max_hr,
         cadence_spm = excluded.cadence_spm, elevation_gain_m = excluded.elevation_gain_m, rpe = excluded.rpe, notes = excluded.notes, updated_at = excluded.updated_at`,
      [id, a.localDate, a.startedAt, a.distanceM, Math.round(a.durationSec), a.kind, a.avgHr, a.maxHr, a.cadenceSpm, a.elevationGainM, a.rpe, a.notes, now, now],
    );
    if (a.source) await tx.run('UPDATE running_activities SET source = ? WHERE id = ?', [a.source, id]);
    await tx.run('DELETE FROM running_splits WHERE activity_id = ?', [id]);
    for (const [i, s] of a.splits.entries()) {
      await tx.run('INSERT INTO running_splits (activity_id, split_index, distance_m, duration_sec) VALUES (?, ?, ?, ?)', [id, i, s.distanceM, Math.round(s.durationSec)]);
    }
  });
  return id;
}

export async function deleteRun(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM running_activities WHERE id = ?', [id]);
}

interface SwimRow {
  id: string;
  local_date: string;
  started_at: string | null;
  distance_m: number;
  duration_sec: number;
  environment: SwimEnvironment;
  pool_length_m: number | null;
  pool_length_unit: 'm' | 'yd' | null;
  laps: number | null;
  stroke: SwimStroke | null;
  avg_hr: number | null;
  rpe: number | null;
  notes: string | null;
}

const mapSwim = (r: SwimRow): SwimActivity => ({
  id: r.id,
  localDate: r.local_date,
  startedAt: r.started_at,
  distanceM: r.distance_m,
  durationSec: r.duration_sec,
  environment: r.environment,
  poolLengthM: r.pool_length_m,
  poolLengthUnit: r.pool_length_unit,
  laps: r.laps,
  stroke: r.stroke,
  avgHr: r.avg_hr,
  rpe: r.rpe,
  notes: r.notes,
});

export async function listSwims(db: Db, from?: LocalDate): Promise<SwimActivity[]> {
  const rows = from
    ? await db.all<SwimRow>('SELECT * FROM swimming_activities WHERE local_date >= ? ORDER BY local_date DESC, started_at DESC', [from])
    : await db.all<SwimRow>('SELECT * FROM swimming_activities ORDER BY local_date DESC, started_at DESC');
  return rows.map(mapSwim);
}

export async function getSwim(db: Db, id: string): Promise<SwimActivity | null> {
  const r = await db.first<SwimRow>('SELECT * FROM swimming_activities WHERE id = ?', [id]);
  return r ? mapSwim(r) : null;
}

export async function upsertSwim(db: Db, a: Omit<SwimActivity, 'id'> & { id?: string }): Promise<string> {
  const id = a.id ?? newId();
  const now = nowIso();
  const pool = a.environment === 'pool';
  await db.run(
    `INSERT INTO swimming_activities (id, local_date, started_at, distance_m, duration_sec, environment, pool_length_m, pool_length_unit, laps, stroke, avg_hr, rpe, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET local_date = excluded.local_date, started_at = excluded.started_at, distance_m = excluded.distance_m,
       duration_sec = excluded.duration_sec, environment = excluded.environment, pool_length_m = excluded.pool_length_m,
       pool_length_unit = excluded.pool_length_unit, laps = excluded.laps, stroke = excluded.stroke, avg_hr = excluded.avg_hr,
       rpe = excluded.rpe, notes = excluded.notes, updated_at = excluded.updated_at`,
    [
      id, a.localDate, a.startedAt, a.distanceM, Math.round(a.durationSec), a.environment,
      pool ? a.poolLengthM : null, pool ? a.poolLengthUnit : null, pool ? a.laps : null,
      a.stroke, a.avgHr, a.rpe, a.notes, now, now,
    ],
  );
  return id;
}

export async function deleteSwim(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM swimming_activities WHERE id = ?', [id]);
}
