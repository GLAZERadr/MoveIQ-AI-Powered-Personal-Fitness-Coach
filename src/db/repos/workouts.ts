import { LocalDate } from '../../domain/dates';
import { SetReport } from '../../motion/report';
import { PlannedExercise } from '../../workout/sessionMachine';
import { newId, nowIso } from '../../lib/id';
import { Db } from '../types';

export type SessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface WorkoutSessionRow {
  id: string;
  planId: string | null;
  status: SessionStatus;
  localDate: LocalDate;
  startedAt: string;
  endedAt: string | null;
  activeDurationSec: number;
  rpe: number | null;
  notes: string | null;
}

export interface SessionExercise extends PlannedExercise {
  id: string;
  exerciseName: string;
  position: number;
  sets: SetRecord[];
}

export interface SetRecord {
  id: string;
  setIndex: number;
  targetReps: number | null;
  completedReps: number;
  partialReps: number;
  source: 'camera' | 'manual';
  startedAt: string;
  endedAt: string;
  report: SetReport | null;
  poseFileUri: string | null;
}

interface SessionDbRow {
  id: string;
  plan_id: string | null;
  status: SessionStatus;
  local_date: string;
  started_at: string;
  ended_at: string | null;
  active_duration_sec: number;
  rpe: number | null;
  notes: string | null;
}

const mapSession = (r: SessionDbRow): WorkoutSessionRow => ({
  id: r.id,
  planId: r.plan_id,
  status: r.status,
  localDate: r.local_date,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  activeDurationSec: r.active_duration_sec,
  rpe: r.rpe,
  notes: r.notes,
});

/**
 * Creates the session and its exercise rows. INSERT OR IGNORE on the client-generated id means a
 * retried call (double tap, crash between write and navigation) never creates a duplicate session.
 */
export async function createSession(
  db: Db,
  input: { id: string; planId: string | null; localDate: LocalDate; exercises: PlannedExercise[] },
): Promise<void> {
  const now = nowIso();
  await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT OR IGNORE INTO workout_sessions (id, plan_id, status, local_date, started_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?)`,
      [input.id, input.planId, input.localDate, now, now, now],
    );
    if (res.changes === 0) return; // already created
    for (const [i, e] of input.exercises.entries()) {
      await tx.run('INSERT INTO workout_exercises (id, session_id, exercise_id, position, target_sets, target_reps, rest_sec) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        `${input.id}:${i}`, input.id, e.exerciseId, i, e.targetSets, e.targetReps, e.restSec,
      ]);
    }
  });
}

export async function getActiveSession(db: Db): Promise<WorkoutSessionRow | null> {
  const r = await db.first<SessionDbRow>("SELECT * FROM workout_sessions WHERE status IN ('active','paused') ORDER BY started_at DESC LIMIT 1");
  return r ? mapSession(r) : null;
}

export async function getSession(db: Db, id: string): Promise<WorkoutSessionRow | null> {
  const r = await db.first<SessionDbRow>('SELECT * FROM workout_sessions WHERE id = ?', [id]);
  return r ? mapSession(r) : null;
}

export async function setSessionStatus(
  db: Db,
  id: string,
  status: SessionStatus,
  extra: { activeDurationSec?: number; rpe?: number | null; notes?: string | null } = {},
): Promise<void> {
  const now = nowIso();
  const final = status === 'completed' || status === 'abandoned';
  await db.run(
    `UPDATE workout_sessions SET status = ?, ended_at = CASE WHEN ? THEN COALESCE(ended_at, ?) ELSE ended_at END,
       active_duration_sec = COALESCE(?, active_duration_sec), rpe = COALESCE(?, rpe), notes = COALESCE(?, notes), updated_at = ?
     WHERE id = ? AND status NOT IN ('completed','abandoned')`,
    [status, final ? 1 : 0, now, extra.activeDurationSec ?? null, extra.rpe ?? null, extra.notes ?? null, now, id],
  );
}

/** Post-completion edits (RPE / notes). */
export async function updateSessionNotes(db: Db, id: string, rpe: number | null, notes: string | null): Promise<void> {
  await db.run('UPDATE workout_sessions SET rpe = ?, notes = ?, updated_at = ? WHERE id = ?', [rpe, notes, nowIso(), id]);
}

/**
 * Persists one completed set with its analysis summary and optional pose-sequence reference in a
 * single transaction. Idempotent by set id.
 */
export async function saveSet(
  db: Db,
  input: {
    id: string;
    sessionId: string;
    exercisePosition: number;
    setIndex: number;
    targetReps: number | null;
    completedReps: number;
    partialReps: number;
    source: 'camera' | 'manual';
    startedAt: string;
    endedAt: string;
    restSec: number | null;
    report: SetReport | null;
    pose: { fileUri: string; frameCount: number; expiresAt: string } | null;
  },
): Promise<void> {
  const now = nowIso();
  await db.transaction(async (tx) => {
    const res = await tx.run(
      `INSERT OR IGNORE INTO exercise_sets (id, workout_exercise_id, set_index, target_reps, completed_reps, partial_reps, source, started_at, ended_at, rest_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.id, `${input.sessionId}:${input.exercisePosition}`, input.setIndex, input.targetReps, input.completedReps, input.partialReps, input.source, input.startedAt, input.endedAt, input.restSec],
    );
    if (res.changes === 0) return;
    if (input.report) {
      await tx.run('INSERT INTO motion_session_summaries (set_id, analyzer_version, report_json, created_at) VALUES (?, ?, ?, ?)', [
        input.id, input.report.analyzerVersion, JSON.stringify(input.report), now,
      ]);
    }
    if (input.pose) {
      await tx.run('INSERT INTO pose_sequence_refs (set_id, file_uri, frame_count, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
        input.id, input.pose.fileUri, input.pose.frameCount, now, input.pose.expiresAt,
      ]);
    }
    await tx.run('UPDATE workout_sessions SET updated_at = ? WHERE id = ?', [now, input.sessionId]);
  });
}

export async function getSessionExercises(db: Db, sessionId: string): Promise<SessionExercise[]> {
  const exRows = await db.all<{ id: string; exercise_id: string; name: string; position: number; target_sets: number; target_reps: number; rest_sec: number }>(
    `SELECT we.id, we.exercise_id, e.name, we.position, we.target_sets, we.target_reps, we.rest_sec FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id
     WHERE we.session_id = ? ORDER BY we.position`,
    [sessionId],
  );
  const setRows = await db.all<{
    id: string; workout_exercise_id: string; set_index: number; target_reps: number | null; completed_reps: number;
    partial_reps: number; source: 'camera' | 'manual'; started_at: string; ended_at: string; report_json: string | null; file_uri: string | null;
  }>(
    `SELECT s.*, m.report_json, p.file_uri FROM exercise_sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       LEFT JOIN motion_session_summaries m ON m.set_id = s.id
       LEFT JOIN pose_sequence_refs p ON p.set_id = s.id
     WHERE we.session_id = ? ORDER BY s.set_index`,
    [sessionId],
  );
  return exRows.map((e) => ({
    id: e.id,
    exerciseId: e.exercise_id,
    exerciseName: e.name,
    position: e.position,
    targetSets: e.target_sets,
    targetReps: e.target_reps,
    restSec: e.rest_sec,
    sets: setRows
      .filter((s) => s.workout_exercise_id === e.id)
      .map((s) => ({
        id: s.id,
        setIndex: s.set_index,
        targetReps: s.target_reps,
        completedReps: s.completed_reps,
        partialReps: s.partial_reps,
        source: s.source,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        report: s.report_json ? (JSON.parse(s.report_json) as SetReport) : null,
        poseFileUri: s.file_uri,
      })),
  }));
}

export interface SessionSummary extends WorkoutSessionRow {
  totalReps: number;
  sets: number;
  exerciseNames: string;
}

export async function listSessions(db: Db, opts: { from?: LocalDate; limit?: number } = {}): Promise<SessionSummary[]> {
  const rows = await db.all<SessionDbRow & { total_reps: number | null; sets: number; exercise_names: string | null }>(
    `SELECT ws.*,
       (SELECT SUM(s.completed_reps) FROM exercise_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.session_id = ws.id) AS total_reps,
       (SELECT COUNT(*) FROM exercise_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.session_id = ws.id) AS sets,
       (SELECT GROUP_CONCAT(e.name, ', ') FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id WHERE we.session_id = ws.id) AS exercise_names
     FROM workout_sessions ws
     WHERE ws.status = 'completed' AND ws.local_date >= ?
     ORDER BY ws.started_at DESC LIMIT ?`,
    [opts.from ?? '0000-00-00', opts.limit ?? 500],
  );
  return rows.map((r) => ({ ...mapSession(r), totalReps: r.total_reps ?? 0, sets: r.sets, exerciseNames: r.exercise_names ?? '' }));
}

export interface RepTrendPoint {
  localDate: LocalDate;
  exerciseId: string;
  bestSetReps: number;
  totalReps: number;
}

/** Per completed session and exercise: best single set and total reps. */
export async function repTrends(db: Db, from: LocalDate): Promise<RepTrendPoint[]> {
  const rows = await db.all<{ local_date: string; exercise_id: string; best: number; total: number }>(
    `SELECT ws.local_date, we.exercise_id, MAX(s.completed_reps) AS best, SUM(s.completed_reps) AS total
     FROM exercise_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workout_sessions ws ON ws.id = we.session_id
     WHERE ws.status = 'completed' AND ws.local_date >= ?
     GROUP BY ws.id, we.exercise_id ORDER BY ws.local_date`,
    [from],
  );
  return rows.map((r) => ({ localDate: r.local_date, exerciseId: r.exercise_id, bestSetReps: r.best, totalReps: r.total }));
}

/** Personal record = most reps in a single completed set, per exercise. */
export async function personalRecords(db: Db): Promise<{ exerciseId: string; name: string; reps: number; localDate: LocalDate }[]> {
  return db.all(
    `SELECT we.exercise_id AS exerciseId, e.name AS name, s.completed_reps AS reps, ws.local_date AS localDate
     FROM exercise_sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workout_sessions ws ON ws.id = we.session_id JOIN exercises e ON e.id = we.exercise_id
     WHERE ws.status = 'completed' AND s.completed_reps = (
       SELECT MAX(s2.completed_reps) FROM exercise_sets s2 JOIN workout_exercises we2 ON we2.id = s2.workout_exercise_id
       JOIN workout_sessions ws2 ON ws2.id = we2.session_id WHERE we2.exercise_id = we.exercise_id AND ws2.status = 'completed')
     GROUP BY we.exercise_id ORDER BY e.name`,
  );
}

export async function deleteSession(db: Db, id: string): Promise<string[]> {
  const files = await db.all<{ file_uri: string }>(
    `SELECT p.file_uri FROM pose_sequence_refs p JOIN exercise_sets s ON s.id = p.set_id JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.session_id = ?`,
    [id],
  );
  await db.run('DELETE FROM workout_sessions WHERE id = ?', [id]);
  return files.map((f) => f.file_uri);
}

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

export interface PlanItem extends PlannedExercise {
  substitutionExerciseId: string | null;
}

export interface Plan {
  id: string;
  name: string;
  notes: string | null;
  items: PlanItem[];
}

export async function listPlans(db: Db): Promise<Plan[]> {
  const plans = await db.all<{ id: string; name: string; notes: string | null }>('SELECT id, name, notes FROM workout_plans ORDER BY name');
  const items = await db.all<{ plan_id: string; exercise_id: string; substitution_exercise_id: string | null; target_sets: number; target_reps: number; rest_sec: number }>(
    'SELECT * FROM workout_plan_items ORDER BY plan_id, position',
  );
  return plans.map((p) => ({
    ...p,
    items: items
      .filter((i) => i.plan_id === p.id)
      .map((i) => ({ exerciseId: i.exercise_id, substitutionExerciseId: i.substitution_exercise_id, targetSets: i.target_sets, targetReps: i.target_reps, restSec: i.rest_sec })),
  }));
}

export async function savePlan(db: Db, plan: Omit<Plan, 'id'> & { id?: string }): Promise<string> {
  const id = plan.id ?? newId();
  const now = nowIso();
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO workout_plans (id, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes, updated_at = excluded.updated_at`,
      [id, plan.name, plan.notes, now, now],
    );
    await tx.run('DELETE FROM workout_plan_items WHERE plan_id = ?', [id]);
    for (const [i, it] of plan.items.entries()) {
      await tx.run(
        'INSERT INTO workout_plan_items (id, plan_id, exercise_id, substitution_exercise_id, position, target_sets, target_reps, rest_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [`${id}:${i}`, id, it.exerciseId, it.substitutionExerciseId, i, it.targetSets, it.targetReps, it.restSec],
      );
    }
  });
  return id;
}

export async function deletePlan(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM workout_plans WHERE id = ?', [id]);
}

const STARTER_PLANS: Plan[] = [
  {
    id: 'starter-full-body',
    name: 'Bodyweight basics',
    notes: 'Push-ups and squats, 3 sets each.',
    items: [
      { exerciseId: 'pushup', substitutionExerciseId: null, targetSets: 3, targetReps: 10, restSec: 90 },
      { exerciseId: 'squat', substitutionExerciseId: null, targetSets: 3, targetReps: 15, restSec: 90 },
    ],
  },
  {
    id: 'starter-upper',
    name: 'Upper body',
    notes: 'Push-ups, pike push-ups and pull-ups (needs a bar).',
    items: [
      { exerciseId: 'pushup', substitutionExerciseId: null, targetSets: 3, targetReps: 10, restSec: 90 },
      { exerciseId: 'pike_pushup', substitutionExerciseId: 'pushup', targetSets: 3, targetReps: 8, restSec: 90 },
      { exerciseId: 'pullup', substitutionExerciseId: null, targetSets: 3, targetReps: 5, restSec: 120 },
    ],
  },
  {
    id: 'starter-legs-core',
    name: 'Legs & core',
    notes: 'Squats, lunges and a plank hold (seconds).',
    items: [
      { exerciseId: 'squat', substitutionExerciseId: null, targetSets: 3, targetReps: 15, restSec: 90 },
      { exerciseId: 'lunge', substitutionExerciseId: 'squat', targetSets: 3, targetReps: 12, restSec: 90 },
      { exerciseId: 'plank', substitutionExerciseId: null, targetSets: 3, targetReps: 30, restSec: 60 },
    ],
  },
];

/** Adds any starter template the user doesn't have yet (never overwrites or re-adds edited ones). */
export async function ensureStarterPlans(db: Db): Promise<void> {
  const seeded = new Set((await db.all<{ key: string }>("SELECT key FROM app_settings WHERE key LIKE 'starterPlan:%'")).map((r) => r.key));
  const existing = new Set((await db.all<{ id: string }>('SELECT id FROM workout_plans')).map((r) => r.id));
  for (const p of STARTER_PLANS) {
    const key = `starterPlan:${p.id}`;
    if (seeded.has(key)) continue;
    if (!existing.has(p.id)) await savePlan(db, p);
    await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, 'true')", [key]);
  }
}

/** Removes expired pose sequences from the DB and returns the files the caller must delete. */
export async function purgeExpiredPoseRefs(db: Db, nowIsoStr: string): Promise<string[]> {
  const rows = await db.all<{ file_uri: string }>('SELECT file_uri FROM pose_sequence_refs WHERE expires_at <= ?', [nowIsoStr]);
  await db.run('DELETE FROM pose_sequence_refs WHERE expires_at <= ?', [nowIsoStr]);
  return rows.map((r) => r.file_uri);
}

export async function allPoseFiles(db: Db): Promise<string[]> {
  return (await db.all<{ file_uri: string }>('SELECT file_uri FROM pose_sequence_refs')).map((r) => r.file_uri);
}

/** Sets from the most recent completed session that included this exercise (for auto-progression). */
export async function lastPerformance(db: Db, exerciseId: string): Promise<{ target: number | null; results: number[] } | null> {
  const last = await db.first<{ id: string }>(
    `SELECT we.id FROM workout_exercises we JOIN workout_sessions ws ON ws.id = we.session_id
     WHERE we.exercise_id = ? AND ws.status = 'completed'
       AND EXISTS (SELECT 1 FROM exercise_sets s WHERE s.workout_exercise_id = we.id)
     ORDER BY ws.started_at DESC LIMIT 1`,
    [exerciseId],
  );
  if (!last) return null;
  const sets = await db.all<{ target_reps: number | null; completed_reps: number }>(
    'SELECT target_reps, completed_reps FROM exercise_sets WHERE workout_exercise_id = ? ORDER BY set_index',
    [last.id],
  );
  return { target: sets[0]?.target_reps ?? null, results: sets.map((s) => s.completed_reps) };
}
