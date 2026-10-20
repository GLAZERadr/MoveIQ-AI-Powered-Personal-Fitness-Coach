/**
 * In-memory workout session state machine (pure, testable). Persistence happens in the repository
 * when sets complete and when the session changes status, so a crash loses at most the current set.
 *
 *   idle ──START──▶ active ──SET_DONE──▶ resting ──REST_DONE/SKIP_REST──▶ active ...
 *   active|resting ──PAUSE──▶ paused ──RESUME──▶ (previous phase)
 *   any non-final ──FINISH──▶ completed        (last SET_DONE also completes)
 * Invalid transitions are ignored (state is returned unchanged) rather than throwing.
 */

export interface PlannedExercise {
  exerciseId: string;
  targetSets: number;
  targetReps: number;
  restSec: number;
}

export type Phase = 'idle' | 'active' | 'resting' | 'paused' | 'completed';

export interface CompletedSet {
  exerciseIndex: number;
  setIndex: number;
  reps: number;
}

export interface SessionState {
  phase: Phase;
  pausedFrom: 'active' | 'resting' | null;
  plan: PlannedExercise[];
  exerciseIndex: number;
  setIndex: number;
  restEndsAtMs: number | null;
  /** Remaining rest when paused during rest. */
  restRemainingMs: number | null;
  completed: CompletedSet[];
  /** Accumulated active (unpaused) time. */
  activeMs: number;
  lastResumedAtMs: number | null;
}

export type SessionAction =
  | { type: 'START'; at: number }
  | { type: 'SET_DONE'; at: number; reps: number }
  | { type: 'REST_DONE'; at: number }
  | { type: 'SKIP_REST'; at: number }
  | { type: 'PAUSE'; at: number }
  | { type: 'RESUME'; at: number }
  | { type: 'FINISH'; at: number };

export function initialSession(plan: PlannedExercise[]): SessionState {
  return {
    phase: 'idle',
    pausedFrom: null,
    plan,
    exerciseIndex: 0,
    setIndex: 0,
    restEndsAtMs: null,
    restRemainingMs: null,
    completed: [],
    activeMs: 0,
    lastResumedAtMs: null,
  };
}

function accrue(s: SessionState, at: number): number {
  return s.lastResumedAtMs == null ? s.activeMs : s.activeMs + Math.max(0, at - s.lastResumedAtMs);
}

export function sessionReducer(s: SessionState, a: SessionAction): SessionState {
  switch (a.type) {
    case 'START':
      if (s.phase !== 'idle' || s.plan.length === 0) return s;
      return { ...s, phase: 'active', lastResumedAtMs: a.at };

    case 'SET_DONE': {
      if (s.phase !== 'active') return s;
      const ex = s.plan[s.exerciseIndex]!;
      const completed = [...s.completed, { exerciseIndex: s.exerciseIndex, setIndex: s.setIndex, reps: Math.max(0, Math.round(a.reps)) }];
      const lastSetOfExercise = s.setIndex + 1 >= ex.targetSets;
      const lastExercise = s.exerciseIndex + 1 >= s.plan.length;
      if (lastSetOfExercise && lastExercise) {
        return { ...s, completed, phase: 'completed', activeMs: accrue(s, a.at), lastResumedAtMs: null };
      }
      const nextExercise = lastSetOfExercise ? s.exerciseIndex + 1 : s.exerciseIndex;
      const nextSet = lastSetOfExercise ? 0 : s.setIndex + 1;
      return {
        ...s,
        completed,
        exerciseIndex: nextExercise,
        setIndex: nextSet,
        phase: ex.restSec > 0 ? 'resting' : 'active',
        restEndsAtMs: ex.restSec > 0 ? a.at + ex.restSec * 1000 : null,
      };
    }

    case 'REST_DONE':
      if (s.phase !== 'resting' || s.restEndsAtMs == null || a.at < s.restEndsAtMs) return s;
      return { ...s, phase: 'active', restEndsAtMs: null };

    case 'SKIP_REST':
      if (s.phase !== 'resting') return s;
      return { ...s, phase: 'active', restEndsAtMs: null };

    case 'PAUSE':
      if (s.phase !== 'active' && s.phase !== 'resting') return s;
      return {
        ...s,
        phase: 'paused',
        pausedFrom: s.phase,
        restRemainingMs: s.phase === 'resting' && s.restEndsAtMs != null ? Math.max(0, s.restEndsAtMs - a.at) : null,
        activeMs: accrue(s, a.at),
        lastResumedAtMs: null,
      };

    case 'RESUME':
      if (s.phase !== 'paused') return s;
      return {
        ...s,
        phase: s.pausedFrom ?? 'active',
        pausedFrom: null,
        restEndsAtMs: s.pausedFrom === 'resting' && s.restRemainingMs != null ? a.at + s.restRemainingMs : null,
        restRemainingMs: null,
        lastResumedAtMs: a.at,
      };

    case 'FINISH':
      if (s.phase === 'completed' || s.phase === 'idle') return s;
      return { ...s, phase: 'completed', activeMs: accrue(s, a.at), lastResumedAtMs: null, restEndsAtMs: null };
  }
}

export function activeDurationMs(s: SessionState, now: number): number {
  return accrue(s, now);
}
