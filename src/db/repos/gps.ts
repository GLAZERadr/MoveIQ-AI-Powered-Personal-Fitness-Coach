import { GpsPoint } from '../../domain/gps';
import { Db } from '../types';

export type RecordingStatus = 'recording' | 'paused';
export interface RecordingState {
  status: RecordingStatus;
  startedAt: number;
  segment: number;
}

const KEY = 'gpsRecording';

export async function getRecordingState(db: Db): Promise<RecordingState | null> {
  const r = await db.first<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [KEY]);
  return r ? (JSON.parse(r.value) as RecordingState) : null;
}

export async function setRecordingState(db: Db, s: RecordingState | null): Promise<void> {
  if (s) await db.run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [KEY, JSON.stringify(s)]);
  else await db.run('DELETE FROM app_settings WHERE key = ?', [KEY]);
}

export async function appendRecordingPoints(db: Db, points: Omit<GpsPoint, 'segment'>[], segment: number): Promise<void> {
  if (points.length === 0) return;
  await db.transaction(async (tx) => {
    for (const p of points) {
      await tx.run('INSERT OR IGNORE INTO gps_recording_points (t_ms, lat, lon, alt, accuracy, segment) VALUES (?, ?, ?, ?, ?, ?)', [
        Math.round(p.t), p.lat, p.lon, p.alt, p.accuracy, segment,
      ]);
    }
  });
}

type Row = { t_ms: number; lat: number; lon: number; alt: number | null; accuracy: number | null; segment: number };
const toPoint = (r: Row): GpsPoint => ({ t: r.t_ms, lat: r.lat, lon: r.lon, alt: r.alt, accuracy: r.accuracy, segment: r.segment });

export async function getRecordingPoints(db: Db): Promise<GpsPoint[]> {
  return (await db.all<Row>('SELECT t_ms, lat, lon, alt, accuracy, segment FROM gps_recording_points ORDER BY t_ms')).map(toPoint);
}

export async function clearRecording(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM gps_recording_points');
    await tx.run('DELETE FROM app_settings WHERE key = ?', [KEY]);
  });
}

export async function saveTrack(db: Db, activityId: string, points: GpsPoint[]): Promise<void> {
  for (const [i, p] of points.entries()) {
    await db.run('INSERT OR REPLACE INTO run_track_points (activity_id, seq, t_ms, lat, lon, alt, accuracy, segment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      activityId, i, Math.round(p.t), p.lat, p.lon, p.alt, p.accuracy, p.segment,
    ]);
  }
}

export async function getTrack(db: Db, activityId: string): Promise<GpsPoint[]> {
  return (await db.all<Row>('SELECT t_ms, lat, lon, alt, accuracy, segment FROM run_track_points WHERE activity_id = ? ORDER BY seq', [activityId])).map(toPoint);
}
