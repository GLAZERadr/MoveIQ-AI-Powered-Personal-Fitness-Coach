import { evaluateRecommendations, RecommendationInput } from '../../domain/recommendations';
import { suggestNextTarget } from '../progression';
import { activeDurationMs, initialSession, sessionReducer, SessionAction, SessionState } from '../sessionMachine';

const plan = [
  { exerciseId: 'pushup', targetSets: 2, targetReps: 10, restSec: 60 },
  { exerciseId: 'squat', targetSets: 1, targetReps: 15, restSec: 0 },
];
const apply = (s: SessionState, ...actions: SessionAction[]) => actions.reduce(sessionReducer, s);

describe('workout session state machine', () => {
  it('runs IDLE → ACTIVE → (rest) → ... → COMPLETED', () => {
    let s = apply(initialSession(plan), { type: 'START', at: 0 });
    expect(s.phase).toBe('active');
    s = apply(s, { type: 'SET_DONE', at: 30_000, reps: 10 });
    expect(s).toMatchObject({ phase: 'resting', exerciseIndex: 0, setIndex: 1, restEndsAtMs: 90_000 });
    expect(apply(s, { type: 'REST_DONE', at: 60_000 }).phase).toBe('resting'); // too early
    s = apply(s, { type: 'REST_DONE', at: 90_000 }, { type: 'SET_DONE', at: 120_000, reps: 9 });
    expect(s).toMatchObject({ phase: 'resting', exerciseIndex: 1, setIndex: 0 });
    s = apply(s, { type: 'SKIP_REST', at: 125_000 }, { type: 'SET_DONE', at: 160_000, reps: 15 });
    expect(s.phase).toBe('completed');
    expect(s.completed.map((c) => c.reps)).toEqual([10, 9, 15]);
    expect(s.activeMs).toBe(160_000);
  });

  it('pause/resume excludes paused time and preserves remaining rest', () => {
    let s = apply(initialSession(plan), { type: 'START', at: 0 }, { type: 'SET_DONE', at: 10_000, reps: 10 });
    s = apply(s, { type: 'PAUSE', at: 20_000 });
    expect(s).toMatchObject({ phase: 'paused', restRemainingMs: 50_000 });
    s = apply(s, { type: 'RESUME', at: 120_000 });
    expect(s).toMatchObject({ phase: 'resting', restEndsAtMs: 170_000 });
    expect(activeDurationMs(s, 130_000)).toBe(30_000);
  });

  it('ignores invalid transitions', () => {
    const idle = initialSession(plan);
    expect(sessionReducer(idle, { type: 'SET_DONE', at: 0, reps: 5 })).toBe(idle);
    expect(sessionReducer(idle, { type: 'PAUSE', at: 0 })).toBe(idle);
    const done = apply(idle, { type: 'START', at: 0 }, { type: 'FINISH', at: 1000 });
    expect(done.phase).toBe('completed');
    expect(sessionReducer(done, { type: 'RESUME', at: 2000 })).toBe(done);
    expect(sessionReducer(done, { type: 'SET_DONE', at: 2000, reps: 3 })).toBe(done);
  });
});

describe('recommendation rules', () => {
  const base: RecommendationInput = { today: '2026-04-26', training: [], dailyWeights: [], nutrition: [], goal: null, lastCameraSession: null };

  it('produces nothing when no supporting data exists', () => {
    expect(evaluateRecommendations(base)).toEqual([]);
  });

  it('high-exertion rule needs two hard sessions and a hard latest session', () => {
    const one = { ...base, training: [{ kind: 'run' as const, localDate: '2026-04-25', rpe: 9 }] };
    expect(evaluateRecommendations(one)).toEqual([]);
    const two = { ...base, training: [{ kind: 'workout' as const, localDate: '2026-04-23', rpe: 8 }, { kind: 'run' as const, localDate: '2026-04-25', rpe: 9 }] };
    const r = evaluateRecommendations(two);
    expect(r.map((x) => x.ruleId)).toEqual(['high_exertion']);
    expect(r[0]!.evidence).toHaveLength(2);
    expect(evaluateRecommendations(two, new Set(['high_exertion']))).toEqual([]);
  });

  it('protein rule requires a target and at least 3 logged days', () => {
    const n = (d: string, p: number) => ({ localDate: d, meal: 'lunch' as const, kcal: 500, proteinG: p, carbsG: null, fatG: null, fiberG: null, sodiumMg: null });
    const goal = { kind: 'cut', proteinTargetG: 150, calorieTargetKcal: 2200 };
    expect(evaluateRecommendations({ ...base, goal, nutrition: [n('2026-04-25', 80), n('2026-04-26', 80)] })).toEqual([]);
    expect(evaluateRecommendations({ ...base, goal, nutrition: [n('2026-04-24', 80), n('2026-04-25', 80), n('2026-04-26', 80)] }).map((r) => r.ruleId)).toEqual(['low_protein']);
  });
});


describe('automatic progression', () => {
  it('adds a rep when every set hit the target', () => {
    expect(suggestNextTarget({ target: 10, results: [10, 11, 10] }, 10, 'reps')).toMatchObject({ target: 11 });
    expect(suggestNextTarget({ target: 30, results: [30, 32, 35] }, 30, 'seconds')).toMatchObject({ target: 35 });
  });
  it('keeps the target when sets fell short', () => {
    expect(suggestNextTarget({ target: 10, results: [10, 9, 6] }, 10, 'reps').target).toBe(10);
    expect(suggestNextTarget({ target: 10, results: [10, 9, 9] }, 10, 'reps').target).toBe(10);
  });
  it('uses the default without history', () => {
    expect(suggestNextTarget(null, 12, 'reps')).toEqual({ target: 12, reason: null });
  });
});
