/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LATEST_SCHEMA_VERSION, migrate } from '../migrations';
import { deleteWeight, listMeasurements, listWeights, upsertMeasurement, upsertWeight } from '../repos/body';
import { deleteRun, getRun, listRuns, listSwims, upsertRun, upsertSwim } from '../repos/activities';
import { deleteFood, listEntries, listFoods, upsertEntry, upsertFood } from '../repos/nutrition';
import { getPrimaryGoal, getProfile, savePrimaryGoal, saveProfile } from '../repos/profile';
import {
  createSession, deletePlan, deleteSession, ensureStarterPlans, getActiveSession, getSessionExercises, listPlans, listSessions,
  personalRecords, purgeExpiredPoseRefs, saveSet, setSessionStatus,
} from '../repos/workouts';
import { deleteAllData, exportAll } from '../repos/dataPortability';
import { appendRecordingPoints, clearRecording, getRecordingPoints, getRecordingState, getTrack, saveTrack, setRecordingState } from '../repos/gps';
import { getSettings, setSetting } from '../repos/settings';
import { openTestDb } from './nodeDb';

let db: ReturnType<typeof openTestDb>;
beforeEach(async () => {
  db = openTestDb();
  await migrate(db);
});
afterEach(() => db.close());

describe('migrations', () => {
  it('apply once and are idempotent', async () => {
    const again = await migrate(db);
    expect(again).toEqual([]);
    const v = await db.first<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations');
    expect(v?.v).toBe(LATEST_SCHEMA_VERSION);
    const ex = await db.all<{ id: string }>('SELECT id FROM exercises WHERE camera_supported = 1 ORDER BY id');
    expect(ex.map((e) => e.id)).toEqual(['lunge', 'pike_pushup', 'plank', 'pullup', 'pushup', 'squat']);
  });

  it('enforces foreign keys and CHECK constraints', async () => {
    await expect(db.run('INSERT INTO running_splits (activity_id, split_index, distance_m, duration_sec) VALUES (?, 0, 1000, 300)', ['missing'])).rejects.toThrow(/FOREIGN KEY/);
    await expect(upsertWeight(db, { localDate: '2026-04-01', measuredAt: 'x', weightKg: -5, note: null })).rejects.toThrow(/CHECK/);
    await expect(
      upsertRun(db, { localDate: '2026-04-01', startedAt: null, distanceM: 0, durationSec: 100, kind: 'outdoor', avgHr: null, maxHr: null, cadenceSpm: null, elevationGainM: null, rpe: null, notes: null, splits: [] }),
    ).rejects.toThrow(/CHECK/);
  });

  it('persists across reopen (app restart)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'moveiq-')), 'test.db');
    const a = openTestDb(file);
    await migrate(a);
    await upsertWeight(a, { localDate: '2026-04-01', measuredAt: '2026-04-01T07:00:00Z', weightKg: 72.4, note: null });
    a.close();
    const b = openTestDb(file);
    expect(await migrate(b)).toEqual([]);
    expect((await listWeights(b))[0]?.weightKg).toBe(72.4);
    b.close();
  });
});

describe('profile & goals', () => {
  it('upserts the singleton profile and keeps goal history on replacement', async () => {
    await saveProfile(db, { displayName: 'Alex', birthYear: 1995, sex: null, heightCm: 178, activityLevel: 'moderate', experience: 'beginner', unitSystem: 'metric', dietaryPreferences: null, onboardedAt: '2026-01-01' });
    await saveProfile(db, { displayName: 'Alex P', birthYear: 1995, sex: null, heightCm: 178, activityLevel: 'moderate', experience: 'beginner', unitSystem: 'imperial', dietaryPreferences: null, onboardedAt: null });
    const p = await getProfile(db);
    expect(p).toMatchObject({ displayName: 'Alex P', unitSystem: 'imperial', onboardedAt: '2026-01-01' });

    const g1 = await savePrimaryGoal(db, { kind: 'cut', startWeightKg: 80, targetWeightKg: 74, targetDate: null, dailyCalorieTargetKcal: 2200, dailyProteinTargetG: 150 });
    const updated = await savePrimaryGoal(db, { id: g1, kind: 'cut', startWeightKg: 80, targetWeightKg: 73, targetDate: null, dailyCalorieTargetKcal: 2100, dailyProteinTargetG: 150 });
    expect(updated).toBe(g1);
    await savePrimaryGoal(db, { id: 'new', kind: 'strength', startWeightKg: null, targetWeightKg: null, targetDate: null, dailyCalorieTargetKcal: null, dailyProteinTargetG: null });
    expect((await getPrimaryGoal(db))?.kind).toBe('strength');
    const all = await db.all('SELECT * FROM fitness_goals');
    expect(all).toHaveLength(2);
  });
});

describe('weights, measurements, nutrition CRUD', () => {
  it('create, edit (same id), delete', async () => {
    const id = await upsertWeight(db, { localDate: '2026-04-01', measuredAt: 't', weightKg: 80, note: null });
    await upsertWeight(db, { id, localDate: '2026-04-01', measuredAt: 't', weightKg: 79.5, note: 'edited' });
    expect(await listWeights(db)).toEqual([expect.objectContaining({ id, weightKg: 79.5, note: 'edited' })]);
    await deleteWeight(db, id);
    expect(await listWeights(db)).toEqual([]);
    await upsertMeasurement(db, { localDate: '2026-04-01', kind: 'waist', value: 84, method: 'tape' });
    expect((await listMeasurements(db, 'waist'))[0]?.value).toBe(84);
  });

  it('nutrition entries keep snapshot values when the saved food is deleted', async () => {
    const food = await upsertFood(db, { name: 'Oats 100%_test', servingQty: 40, servingUnit: 'g', kcal: 150, proteinG: 5, carbsG: 27, fatG: 3, fiberG: null, sodiumMg: null });
    await upsertEntry(db, { foodItemId: food, name: 'Oats', meal: 'breakfast', localDate: '2026-04-01', loggedAt: 't', servings: 2, servingQty: 40, servingUnit: 'g', kcal: 300, proteinG: 10, carbsG: 54, fatG: 6, fiberG: null, sodiumMg: null });
    expect(await listFoods(db, '100%_')).toHaveLength(1); // LIKE wildcards are escaped
    expect(await listFoods(db, 'zzz')).toHaveLength(0);
    await deleteFood(db, food);
    const [e] = await listEntries(db, '2026-04-01', '2026-04-01');
    expect(e).toMatchObject({ foodItemId: null, kcal: 300, carbsG: 54, fiberG: null });
  });
});

describe('activities', () => {
  const base = { startedAt: null, kind: 'outdoor' as const, avgHr: null, maxHr: null, cadenceSpm: null, elevationGainM: null, rpe: null, notes: null };

  it('saves runs with splits atomically, replaces splits on edit, cascades on delete', async () => {
    const id = await upsertRun(db, { ...base, localDate: '2026-04-26', distanceM: 2000, durationSec: 720, splits: [{ distanceM: 1000, durationSec: 360 }, { distanceM: 1000, durationSec: 360 }] });
    await upsertRun(db, { ...base, id, localDate: '2026-04-26', distanceM: 2000, durationSec: 720, splits: [{ distanceM: 2000, durationSec: 720 }] });
    expect((await getRun(db, id))?.splits).toHaveLength(1);
    // A retried save with the same id never duplicates.
    expect(await listRuns(db)).toHaveLength(1);
    await deleteRun(db, id);
    expect(await db.all('SELECT * FROM running_splits')).toEqual([]);
  });

  it('rolls back the whole run if a split is invalid', async () => {
    await expect(
      upsertRun(db, { ...base, id: 'bad', localDate: '2026-04-26', distanceM: 2000, durationSec: 720, splits: [{ distanceM: 1000, durationSec: 360 }, { distanceM: -1, durationSec: 360 }] }),
    ).rejects.toThrow();
    expect(await listRuns(db)).toHaveLength(0);
  });

  it('stores open-water swims without pool fields', async () => {
    await upsertSwim(db, { localDate: '2026-04-18', startedAt: null, distanceM: 1500, durationSec: 2304, environment: 'open_water', poolLengthM: 25, poolLengthUnit: 'm', laps: 60, stroke: null, avgHr: null, rpe: null, notes: null });
    const [s] = await listSwims(db);
    expect(s).toMatchObject({ environment: 'open_water', poolLengthM: null, laps: null });
  });
});

describe('workout sessions', () => {
  const plan = [
    { exerciseId: 'pushup', targetSets: 2, targetReps: 10, restSec: 60 },
    { exerciseId: 'squat', targetSets: 1, targetReps: 15, restSec: 60 },
  ];

  it('creating twice with the same id does not duplicate (retry-safe)', async () => {
    await createSession(db, { id: 's1', planId: null, localDate: '2026-04-26', exercises: plan });
    await createSession(db, { id: 's1', planId: null, localDate: '2026-04-26', exercises: plan });
    expect(await db.all('SELECT * FROM workout_sessions')).toHaveLength(1);
    expect(await db.all('SELECT * FROM workout_exercises')).toHaveLength(2);
  });

  it('recovers an interrupted session, then completes it with persisted sets and summaries', async () => {
    await createSession(db, { id: 's1', planId: null, localDate: '2026-04-26', exercises: plan });
    const set = {
      sessionId: 's1', exercisePosition: 0, targetReps: 10, partialReps: 1, source: 'camera' as const,
      startedAt: 't0', endedAt: 't1', restSec: 60, pose: { fileUri: 'file:///pose/a.json', frameCount: 300, expiresAt: '2026-05-10T00:00:00Z' },
      report: { exerciseId: 'pushup', analyzerVersion: 1 } as never,
    };
    await saveSet(db, { ...set, id: 'set1', setIndex: 0, completedReps: 10 });
    await saveSet(db, { ...set, id: 'set1', setIndex: 0, completedReps: 10 }); // retry
    await saveSet(db, { ...set, id: 'set2', setIndex: 1, completedReps: 8, pose: null });
    await setSessionStatus(db, 's1', 'paused');

    // "App restart": the active session is discoverable.
    expect((await getActiveSession(db))?.id).toBe('s1');
    await setSessionStatus(db, 's1', 'completed', { activeDurationSec: 600, rpe: 8 });
    expect(await getActiveSession(db)).toBeNull();

    // Completed sessions can't be re-opened by a stale status write.
    await setSessionStatus(db, 's1', 'active');
    const [summary] = await listSessions(db);
    expect(summary).toMatchObject({ status: 'completed', totalReps: 18, sets: 2, rpe: 8, activeDurationSec: 600 });

    const ex = await getSessionExercises(db, 's1');
    expect(ex[0]?.sets.map((s) => s.completedReps)).toEqual([10, 8]);
    expect(ex[0]?.sets[0]?.poseFileUri).toBe('file:///pose/a.json');
    expect((await personalRecords(db))[0]).toMatchObject({ exerciseId: 'pushup', reps: 10 });

    expect(await purgeExpiredPoseRefs(db, '2026-05-11T00:00:00Z')).toEqual(['file:///pose/a.json']);
    expect((await getSessionExercises(db, 's1'))[0]?.sets[0]?.poseFileUri).toBeNull();
    expect(await deleteSession(db, 's1')).toEqual([]);
    expect(await db.all('SELECT * FROM exercise_sets')).toEqual([]);
  });

  it('seeds starter plans once and never re-adds a plan the user deleted', async () => {
    await ensureStarterPlans(db);
    await ensureStarterPlans(db);
    const plans = await listPlans(db);
    expect(plans.map((p) => p.id).sort()).toEqual(['starter-full-body', 'starter-legs-core', 'starter-upper']);
    expect(plans.find((p) => p.id === 'starter-legs-core')?.items.map((i) => i.exerciseId)).toEqual(['squat', 'lunge', 'plank']);
    await deletePlan(db, 'starter-upper');
    await ensureStarterPlans(db);
    expect((await listPlans(db)).map((p) => p.id)).not.toContain('starter-upper');
  });

  it('upgrading an older install flags newly supported exercises and keeps user data', async () => {
    await db.run("UPDATE exercises SET camera_supported = 0 WHERE id IN ('lunge','plank')");
    await upsertWeight(db, { localDate: '2026-04-01', measuredAt: 't', weightKg: 80, note: null });
    await migrate(db);
    const flags = await db.all<{ id: string; camera_supported: number }>("SELECT id, camera_supported FROM exercises WHERE id IN ('lunge','plank')");
    expect(flags.every((f) => f.camera_supported === 1)).toBe(true);
    expect(await listWeights(db)).toHaveLength(1);
  });
});

describe('gps recording persistence', () => {
  it('buffers fixes idempotently, saves the track with the run, and cascades on delete', async () => {
    await setRecordingState(db, { status: 'recording', startedAt: 1, segment: 0 });
    const pts = [1000, 2000, 3000].map((t, i) => ({ t, lat: 0.0001 * i, lon: 0, alt: null, accuracy: 5 }));
    await appendRecordingPoints(db, pts, 0);
    await appendRecordingPoints(db, pts, 0); // re-delivered batch
    expect(await getRecordingPoints(db)).toHaveLength(3);
    expect((await getRecordingState(db))?.status).toBe('recording');
    const runId = await upsertRun(db, { source: 'gps', localDate: '2026-04-26', startedAt: null, distanceM: 22, durationSec: 2, kind: 'outdoor', avgHr: null, maxHr: null, cadenceSpm: null, elevationGainM: null, rpe: null, notes: null, splits: [] });
    await saveTrack(db, runId, await getRecordingPoints(db));
    await clearRecording(db);
    expect(await getRecordingPoints(db)).toHaveLength(0);
    expect(await getRecordingState(db)).toBeNull();
    expect(await getTrack(db, runId)).toHaveLength(3);
    expect((await db.first<{ source: string }>('SELECT source FROM running_activities WHERE id = ?', [runId]))?.source).toBe('gps');
    await deleteRun(db, runId);
    expect(await getTrack(db, runId)).toHaveLength(0);
  });
});

describe('settings, export, deletion', () => {
  it('stores typed settings with defaults', async () => {
    expect((await getSettings(db)).poseRetentionDays).toBe(14);
    await setSetting(db, 'poseRetentionDays', 0);
    expect((await getSettings(db)).poseRetentionDays).toBe(0);
  });

  it('exports all personal data and deletes it completely', async () => {
    await upsertWeight(db, { localDate: '2026-04-01', measuredAt: 't', weightKg: 80, note: null });
    await createSession(db, { id: 's1', planId: null, localDate: '2026-04-26', exercises: [{ exerciseId: 'pushup', targetSets: 1, targetReps: 5, restSec: 0 }] });
    const e = await exportAll(db);
    expect(e.tables.body_weight_entries).toHaveLength(1);
    expect(e.tables).not.toHaveProperty('pose_sequence_refs');
    await deleteAllData(db);
    const after = await exportAll(db);
    expect(Object.values(after.tables).every((rows) => rows.length === 0)).toBe(true);
    // Non-personal catalog remains.
    expect((await db.all('SELECT * FROM exercises')).length).toBeGreaterThan(0);
  });
});
