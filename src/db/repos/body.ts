import { WeightEntry } from '../../domain/cutting';
import { LocalDate } from '../../domain/dates';
import { newId, nowIso } from '../../lib/id';
import { Db } from '../types';

interface WeightRow {
  id: string;
  local_date: string;
  measured_at: string;
  weight_kg: number;
  note: string | null;
}

export interface WeightEntryWithNote extends WeightEntry {
  note: string | null;
}

const mapWeight = (r: WeightRow): WeightEntryWithNote => ({
  id: r.id,
  localDate: r.local_date,
  measuredAt: r.measured_at,
  weightKg: r.weight_kg,
  note: r.note,
});

export async function listWeights(db: Db, from?: LocalDate): Promise<WeightEntryWithNote[]> {
  const rows = from
    ? await db.all<WeightRow>('SELECT * FROM body_weight_entries WHERE local_date >= ? ORDER BY local_date, measured_at', [from])
    : await db.all<WeightRow>('SELECT * FROM body_weight_entries ORDER BY local_date, measured_at');
  return rows.map(mapWeight);
}

export async function getWeight(db: Db, id: string): Promise<WeightEntryWithNote | null> {
  const r = await db.first<WeightRow>('SELECT * FROM body_weight_entries WHERE id = ?', [id]);
  return r ? mapWeight(r) : null;
}

/** Insert or update by id (idempotent for retried saves). */
export async function upsertWeight(db: Db, e: Omit<WeightEntryWithNote, 'id'> & { id?: string }): Promise<string> {
  const id = e.id ?? newId();
  const now = nowIso();
  await db.run(
    `INSERT INTO body_weight_entries (id, local_date, measured_at, weight_kg, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET local_date = excluded.local_date, measured_at = excluded.measured_at, weight_kg = excluded.weight_kg, note = excluded.note, updated_at = excluded.updated_at`,
    [id, e.localDate, e.measuredAt, e.weightKg, e.note, now, now],
  );
  return id;
}

export async function deleteWeight(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM body_weight_entries WHERE id = ?', [id]);
}

export type MeasurementKind = 'waist' | 'body_fat';

export interface Measurement {
  id: string;
  localDate: LocalDate;
  kind: MeasurementKind;
  /** cm for waist, percent for body fat. */
  value: number;
  method: string | null;
}

interface MeasurementRow {
  id: string;
  local_date: string;
  kind: MeasurementKind;
  value: number;
  method: string | null;
}

export async function listMeasurements(db: Db, kind?: MeasurementKind): Promise<Measurement[]> {
  const rows = kind
    ? await db.all<MeasurementRow>('SELECT * FROM body_measurements WHERE kind = ? ORDER BY local_date', [kind])
    : await db.all<MeasurementRow>('SELECT * FROM body_measurements ORDER BY local_date');
  return rows.map((r) => ({ id: r.id, localDate: r.local_date, kind: r.kind, value: r.value, method: r.method }));
}

export async function upsertMeasurement(db: Db, m: Omit<Measurement, 'id'> & { id?: string }): Promise<string> {
  const id = m.id ?? newId();
  const now = nowIso();
  await db.run(
    `INSERT INTO body_measurements (id, local_date, kind, value, unit, method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET local_date = excluded.local_date, kind = excluded.kind, value = excluded.value, unit = excluded.unit, method = excluded.method, updated_at = excluded.updated_at`,
    [id, m.localDate, m.kind, m.value, m.kind === 'waist' ? 'cm' : 'percent', m.method, now, now],
  );
  return id;
}

export async function deleteMeasurement(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM body_measurements WHERE id = ?', [id]);
}
