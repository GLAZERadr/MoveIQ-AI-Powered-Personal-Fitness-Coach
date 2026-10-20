import { ActivityLevel, Sex } from '../../domain/cutting';
import { UnitSystem } from '../../domain/units';
import { newId, nowIso } from '../../lib/id';
import { Db } from '../types';

export interface Profile {
  displayName: string | null;
  birthYear: number | null;
  sex: Sex | null;
  heightCm: number | null;
  activityLevel: ActivityLevel | null;
  experience: 'beginner' | 'intermediate' | 'advanced' | null;
  unitSystem: UnitSystem;
  dietaryPreferences: string | null;
  onboardedAt: string | null;
}

export type GoalKind = 'cut' | 'strength' | 'endurance' | 'swim' | 'general';

export interface Goal {
  id: string;
  kind: GoalKind;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  dailyCalorieTargetKcal: number | null;
  dailyProteinTargetG: number | null;
}

interface ProfileRow {
  display_name: string | null;
  birth_year: number | null;
  sex: Sex | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  experience: Profile['experience'];
  unit_system: UnitSystem;
  dietary_preferences: string | null;
  onboarded_at: string | null;
}

export async function getProfile(db: Db): Promise<Profile | null> {
  const r = await db.first<ProfileRow>("SELECT * FROM user_profile WHERE id = 'me'");
  if (!r) return null;
  return {
    displayName: r.display_name,
    birthYear: r.birth_year,
    sex: r.sex,
    heightCm: r.height_cm,
    activityLevel: r.activity_level,
    experience: r.experience,
    unitSystem: r.unit_system,
    dietaryPreferences: r.dietary_preferences,
    onboardedAt: r.onboarded_at,
  };
}

export async function saveProfile(db: Db, p: Profile): Promise<void> {
  const now = nowIso();
  await db.run(
    `INSERT INTO user_profile (id, display_name, birth_year, sex, height_cm, activity_level, experience, unit_system, dietary_preferences, onboarded_at, created_at, updated_at)
     VALUES ('me', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, birth_year = excluded.birth_year, sex = excluded.sex,
       height_cm = excluded.height_cm, activity_level = excluded.activity_level, experience = excluded.experience,
       unit_system = excluded.unit_system, dietary_preferences = excluded.dietary_preferences,
       onboarded_at = COALESCE(user_profile.onboarded_at, excluded.onboarded_at), updated_at = excluded.updated_at`,
    [p.displayName, p.birthYear, p.sex, p.heightCm, p.activityLevel, p.experience, p.unitSystem, p.dietaryPreferences, p.onboardedAt, now, now],
  );
}

interface GoalRow {
  id: string;
  kind: GoalKind;
  start_weight_kg: number | null;
  target_weight_kg: number | null;
  target_date: string | null;
  daily_calorie_target_kcal: number | null;
  daily_protein_target_g: number | null;
}

const mapGoal = (r: GoalRow): Goal => ({
  id: r.id,
  kind: r.kind,
  startWeightKg: r.start_weight_kg,
  targetWeightKg: r.target_weight_kg,
  targetDate: r.target_date,
  dailyCalorieTargetKcal: r.daily_calorie_target_kcal,
  dailyProteinTargetG: r.daily_protein_target_g,
});

export async function getPrimaryGoal(db: Db): Promise<Goal | null> {
  const r = await db.first<GoalRow>('SELECT * FROM fitness_goals WHERE is_primary = 1 AND archived_at IS NULL');
  return r ? mapGoal(r) : null;
}

/** Replaces the primary goal (the previous one is archived, keeping history). */
export async function savePrimaryGoal(db: Db, g: Omit<Goal, 'id'> & { id?: string }): Promise<string> {
  const now = nowIso();
  const existing = await getPrimaryGoal(db);
  if (existing && (!g.id || existing.id === g.id)) {
    await db.run(
      `UPDATE fitness_goals SET kind = ?, start_weight_kg = ?, target_weight_kg = ?, target_date = ?, daily_calorie_target_kcal = ?, daily_protein_target_g = ?, updated_at = ? WHERE id = ?`,
      [g.kind, g.startWeightKg, g.targetWeightKg, g.targetDate, g.dailyCalorieTargetKcal, g.dailyProteinTargetG, now, existing.id],
    );
    return existing.id;
  }
  const id = g.id ?? newId();
  await db.transaction(async (tx) => {
    await tx.run('UPDATE fitness_goals SET archived_at = ?, is_primary = 0 WHERE is_primary = 1 AND archived_at IS NULL', [now]);
    await tx.run(
      `INSERT INTO fitness_goals (id, kind, is_primary, start_weight_kg, target_weight_kg, target_date, daily_calorie_target_kcal, daily_protein_target_g, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [id, g.kind, g.startWeightKg, g.targetWeightKg, g.targetDate, g.dailyCalorieTargetKcal, g.dailyProteinTargetG, now, now],
    );
  });
  return id;
}
