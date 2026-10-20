/**
 * GPS run recording using the phone's own GNSS (expo-location): no paid APIs, no map keys.
 *
 * Android: an expo-location foreground service with a visible "Recording your run" notification
 * keeps receiving fixes while the screen is off. Because it is a user-started foreground service,
 * only "while using the app" location permission is needed, never "all the time".
 * Fixes are written straight to SQLite by the task, so a run survives the app being backgrounded,
 * swiped away, or killed by the OS; the recording screen just reads them back.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getAppDb } from '../data/DbProvider';
import { upsertRun } from '../db/repos/activities';
import { appendRecordingPoints, clearRecording, getRecordingPoints, getRecordingState, saveTrack, setRecordingState } from '../db/repos/gps';
import { cleanTrack, trackStats } from '../domain/gps';
import { toLocalDate } from '../domain/dates';
import { newId } from '../lib/id';

export const GPS_TASK = 'moveiq-gps-run';

// Must be defined at module scope so the OS can deliver fixes even when no screen is mounted.
TaskManager.defineTask(GPS_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const db = await getAppDb();
  const st = await getRecordingState(db);
  if (!st || st.status !== 'recording') return;
  await appendRecordingPoints(
    db,
    locations.map((l) => ({ t: l.timestamp, lat: l.coords.latitude, lon: l.coords.longitude, alt: l.coords.altitude, accuracy: l.coords.accuracy })),
    st.segment,
  );
});

export type StartResult = { ok: true } | { ok: false; reason: string; canOpenSettings?: boolean };

async function startUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK)) return;
  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 2,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'MoveIQ is recording your run',
      notificationBody: 'Tap to open. Location is used only while recording.',
      notificationColor: '#1FC96B',
      killServiceOnDestroy: false,
    },
  });
}

async function stopUpdates(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(GPS_TASK);
}

export async function ensureLocationReady(): Promise<StartResult> {
  if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: 'Location is turned off. Turn on location in your phone’s quick settings.' };
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, reason: 'MoveIQ needs location access while recording a run.', canOpenSettings: !perm.canAskAgain };
  }
  return { ok: true };
}

export async function startRecording(): Promise<StartResult> {
  const ready = await ensureLocationReady();
  if (!ready.ok) return ready;
  const db = await getAppDb();
  await clearRecording(db);
  await setRecordingState(db, { status: 'recording', startedAt: Date.now(), segment: 0 });
  try {
    await startUpdates();
  } catch (e) {
    await clearRecording(db);
    return { ok: false, reason: `Could not start GPS: ${(e as Error).message}` };
  }
  return { ok: true };
}

export async function pauseRecording(): Promise<void> {
  const db = await getAppDb();
  const st = await getRecordingState(db);
  if (!st || st.status !== 'recording') return;
  await setRecordingState(db, { ...st, status: 'paused' });
  await stopUpdates();
}

export async function resumeRecording(): Promise<void> {
  const db = await getAppDb();
  const st = await getRecordingState(db);
  if (!st || st.status !== 'paused') return;
  await setRecordingState(db, { ...st, status: 'recording', segment: st.segment + 1 });
  await startUpdates();
}

export async function discardRecording(): Promise<void> {
  await stopUpdates();
  await clearRecording(await getAppDb());
}

export type FinishResult = { ok: true; activityId: string } | { ok: false; reason: string };

/** Stops GPS, converts the track into a run (with measured splits) and saves the route. */
export async function finishRecording(kind: 'outdoor' | 'trail' = 'outdoor'): Promise<FinishResult> {
  await stopUpdates();
  const db = await getAppDb();
  const st = await getRecordingState(db);
  const raw = await getRecordingPoints(db);
  const stats = trackStats(raw);
  if (!st || stats.distanceM < 50 || stats.elapsedSec < 10) {
    return { ok: false, reason: 'This recording is too short to save (under 50 m). Keep going or discard it.' };
  }
  // Moving time is the honest duration for pace; fall back to elapsed if GPS rarely saw motion.
  const durationSec = Math.round(stats.movingSec >= stats.elapsedSec * 0.5 ? stats.movingSec : stats.elapsedSec);
  const id = newId();
  const start = new Date(stats.startedAt ?? st.startedAt);
  await db.transaction(async (tx) => {
    await upsertRun(tx, {
      id,
      source: 'gps',
      localDate: toLocalDate(start),
      startedAt: start.toISOString(),
      distanceM: Math.round(stats.distanceM),
      durationSec,
      kind,
      avgHr: null,
      maxHr: null,
      cadenceSpm: null,
      elevationGainM: stats.elevationGainM == null ? null : Math.round(stats.elevationGainM),
      rpe: null,
      notes: `Recorded with GPS. Elapsed (excluding pauses) ${Math.round(stats.elapsedSec / 60)} min.`,
      splits: stats.splits.map((s) => ({ distanceM: Math.round(s.distanceM), durationSec: Math.max(1, Math.round(s.durationSec)) })),
    });
    await saveTrack(tx, id, cleanTrack(raw));
    await tx.run('DELETE FROM gps_recording_points');
    await tx.run("DELETE FROM app_settings WHERE key = 'gpsRecording'");
  });
  return { ok: true, activityId: id };
}
