import { listWeights } from '../db/repos/body';
import { getPrimaryGoal, getProfile } from '../db/repos/profile';
import { getSettings } from '../db/repos/settings';
import { Db } from '../db/types';
import { computeAutoTargets, dailyWeights, rollingAverage } from '../domain/cutting';
import { addDays, todayLocal } from '../domain/dates';

export interface EffectiveTargets {
  mode: 'auto' | 'manual';
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  maintenanceKcal: number | null;
  /** How the automatic numbers were derived (shown to the user). */
  basis: string[];
  /** Profile fields needed for automatic targets that are missing. */
  missing: string[];
  weightKg: number | null;
}

/** The weight used for calculations: latest 7-day average, else the latest weigh-in. */
export async function currentWeightKg(db: Db): Promise<number | null> {
  const daily = dailyWeights(await listWeights(db, addDays(todayLocal(), -60)));
  const avg = [...rollingAverage(daily)].reverse().find((r) => r.averageKg != null)?.averageKg;
  return avg ?? daily[daily.length - 1]?.weightKg ?? null;
}

export async function loadTargets(db: Db): Promise<EffectiveTargets> {
  const [settings, profile, goal, weightKg] = await Promise.all([getSettings(db), getProfile(db), getPrimaryGoal(db), currentWeightKg(db)]);
  const manual: EffectiveTargets = {
    mode: 'manual', kcal: goal?.dailyCalorieTargetKcal ?? null, proteinG: goal?.dailyProteinTargetG ?? null, fatG: null, carbsG: null,
    maintenanceKcal: null, basis: [], missing: [], weightKg,
  };
  if (!settings.autoTargets) return manual;
  const r = computeAutoTargets({
    goal: goal?.kind ?? 'general',
    weightKg,
    heightCm: profile?.heightCm ?? null,
    age: profile?.birthYear ? new Date().getFullYear() - profile.birthYear : null,
    sex: profile?.sex ?? null,
    activity: profile?.activityLevel ?? null,
  });
  // Missing profile data: fall back to any manual values, and say what's needed.
  if (!r.ok) return { ...manual, mode: 'auto', missing: r.missing };
  return { mode: 'auto', ...r.targets, missing: [], weightKg };
}
