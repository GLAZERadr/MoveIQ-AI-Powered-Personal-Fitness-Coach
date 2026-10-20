import { listWeights } from '../db/repos/body';
import { listRuns, listSwims } from '../db/repos/activities';
import { listEntries } from '../db/repos/nutrition';
import { getPrimaryGoal, getProfile } from '../db/repos/profile';
import { dismissedRecommendations } from '../db/repos/settings';
import { getActiveSession, getSessionExercises, listPlans, listSessions } from '../db/repos/workouts';
import { Db } from '../db/types';
import { dailyWeights, rollingAverage, sumNutrition, weeklyRate } from '../domain/cutting';
import { addDays, weekStart } from '../domain/dates';
import { evaluateRecommendations } from '../domain/recommendations';
import { loadTargets } from './targets';

export async function loadDashboard(db: Db, today: string) {
  const since = addDays(today, -60);
  const [profile, goal, active, weights, nutrition, runs, swims, sessions, plans, dismissed, targets] = await Promise.all([
    getProfile(db),
    getPrimaryGoal(db),
    getActiveSession(db),
    listWeights(db, since),
    listEntries(db, addDays(today, -13), today),
    listRuns(db, since),
    listSwims(db, since),
    listSessions(db, { from: since }),
    listPlans(db),
    dismissedRecommendations(db, today),
    loadTargets(db),
  ]);

  const daily = dailyWeights(weights);
  const rolling = rollingAverage(daily);
  const latest = daily[daily.length - 1] ?? null;
  const latestAvg = [...rolling].reverse().find((r) => r.averageKg != null) ?? null;
  const rate = weeklyRate(daily, today);
  const todayNutrition = sumNutrition(nutrition.filter((n) => n.localDate === today));

  const ws = weekStart(today);
  const thisWeek = <T extends { localDate: string }>(xs: T[]) => xs.filter((x) => x.localDate >= ws && x.localDate <= today);
  const weekRuns = thisWeek(runs);
  const weekSwims = thisWeek(swims);
  const weekSessions = thisWeek(sessions);
  const activeDays = new Set([...weekRuns, ...weekSwims, ...weekSessions].map((x) => x.localDate));

  // Most recent camera-analysed session for the tracking-quality rule.
  let lastCamera: { localDate: string; goodFramePct: number } | null = null;
  const lastSession = sessions[0];
  if (lastSession) {
    const ex = await getSessionExercises(db, lastSession.id);
    const reports = ex.flatMap((e) => e.sets.map((s) => s.report)).filter((r) => r != null);
    if (reports.length) {
      lastCamera = { localDate: lastSession.localDate, goodFramePct: reports.reduce((a, r) => a + r!.tracking.goodFramePct, 0) / reports.length };
    }
  }

  const recommendations = evaluateRecommendations(
    {
      today,
      training: [
        ...sessions.map((s) => ({ kind: 'workout' as const, localDate: s.localDate, rpe: s.rpe })),
        ...runs.map((r) => ({ kind: 'run' as const, localDate: r.localDate, rpe: r.rpe })),
        ...swims.map((s) => ({ kind: 'swim' as const, localDate: s.localDate, rpe: s.rpe })),
      ],
      dailyWeights: daily,
      nutrition,
      goal: goal ? { kind: goal.kind, proteinTargetG: targets.proteinG, calorieTargetKcal: targets.kcal } : null,
      lastCameraSession: lastCamera,
    },
    dismissed,
  );

  // Next suggested session: the first plan, after any active session.
  const nextPlan = plans[0] ?? null;

  return {
    profile, goal, targets, active, latest, latestAvg, rate, rolling, daily, todayNutrition,
    weekRuns, weekSwims, weekSessions, activeDays: activeDays.size, runs, swims, sessions, nextPlan, recommendations,
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
