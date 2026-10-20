import { LocalDate, addDays, dateRange, daysBetween } from './dates';

export interface WeightEntry {
  id: string;
  localDate: LocalDate;
  measuredAt: string;
  weightKg: number;
}

export interface DailyWeight {
  localDate: LocalDate;
  /** Mean of all weigh-ins recorded on this calendar day. */
  weightKg: number;
}

/** Collapses multiple weigh-ins on one day to their mean, sorted ascending by date. */
export function dailyWeights(entries: Pick<WeightEntry, 'localDate' | 'weightKg'>[]): DailyWeight[] {
  const byDay = new Map<LocalDate, number[]>();
  for (const e of entries) {
    if (!Number.isFinite(e.weightKg) || e.weightKg <= 0) continue;
    const arr = byDay.get(e.localDate) ?? [];
    arr.push(e.weightKg);
    byDay.set(e.localDate, arr);
  }
  return [...byDay.entries()]
    .map(([localDate, ws]) => ({ localDate, weightKg: ws.reduce((a, b) => a + b, 0) / ws.length }))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
}

export interface RollingPoint {
  localDate: LocalDate;
  /** Null when the trailing window contains fewer than `minObservations` weigh-in days. */
  averageKg: number | null;
  observations: number;
}

/**
 * Trailing rolling average over a calendar window (default 7 days: the day itself plus the 6 before).
 * Uses only days that actually have weigh-ins; missing days are never interpolated.
 * Emits one point per weigh-in day.
 */
export function rollingAverage(
  daily: DailyWeight[],
  windowDays = 7,
  minObservations = 3,
): RollingPoint[] {
  return daily.map((d) => {
    const from = addDays(d.localDate, -(windowDays - 1));
    const inWindow = daily.filter((x) => x.localDate >= from && x.localDate <= d.localDate);
    const n = inWindow.length;
    return {
      localDate: d.localDate,
      averageKg: n >= minObservations ? inWindow.reduce((a, b) => a + b.weightKg, 0) / n : null,
      observations: n,
    };
  });
}

export type WeeklyRate =
  | { status: 'ok'; kgPerWeek: number; percentOfBodyweightPerWeek: number; recentAvgKg: number; priorAvgKg: number }
  | { status: 'insufficient_data'; recentObservations: number; priorObservations: number; required: number };

/**
 * Weekly rate of change: mean of the last 7 calendar days (ending `asOf`) minus mean of the 7 days
 * before that. Each window needs `minObservations` weigh-in days, otherwise we report that there is
 * not enough data instead of guessing.
 */
export function weeklyRate(daily: DailyWeight[], asOf: LocalDate, minObservations = 3): WeeklyRate {
  const recentFrom = addDays(asOf, -6);
  const priorFrom = addDays(asOf, -13);
  const priorTo = addDays(asOf, -7);
  const recent = daily.filter((d) => d.localDate >= recentFrom && d.localDate <= asOf);
  const prior = daily.filter((d) => d.localDate >= priorFrom && d.localDate <= priorTo);
  if (recent.length < minObservations || prior.length < minObservations) {
    return { status: 'insufficient_data', recentObservations: recent.length, priorObservations: prior.length, required: minObservations };
  }
  const mean = (xs: DailyWeight[]) => xs.reduce((a, b) => a + b.weightKg, 0) / xs.length;
  const recentAvgKg = mean(recent);
  const priorAvgKg = mean(prior);
  const kgPerWeek = recentAvgKg - priorAvgKg;
  return { status: 'ok', kgPerWeek, percentOfBodyweightPerWeek: (kgPerWeek / priorAvgKg) * 100, recentAvgKg, priorAvgKg };
}

/**
 * Fraction of the way from start to target (0..1), based on the smoothed current value.
 * Works for both loss and gain goals. Returns null when start == target.
 */
export function progressToTarget(startKg: number, currentKg: number, targetKg: number): number | null {
  const total = targetKg - startKg;
  if (Math.abs(total) < 1e-9) return null;
  const done = currentKg - startKg;
  return Math.max(0, Math.min(1, done / total));
}

// ---------------------------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------------------------

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface NutritionValues {
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
}

export interface NutritionEntryLike extends NutritionValues {
  localDate: LocalDate;
  meal: Meal;
}

export interface NutritionTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  entries: number;
  /** How many entries had no value for each optional field (totals for those fields are partial). */
  missing: { carbsG: number; fatG: number; fiberG: number; sodiumMg: number };
}

/** Sums nutrition. Optional fields that are null are not treated as zero silently: they're counted in `missing`. */
export function sumNutrition(entries: NutritionValues[]): NutritionTotals {
  const t: NutritionTotals = {
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sodiumMg: 0,
    entries: entries.length,
    missing: { carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 0 },
  };
  for (const e of entries) {
    t.kcal += e.kcal;
    t.proteinG += e.proteinG;
    for (const k of ['carbsG', 'fatG', 'fiberG', 'sodiumMg'] as const) {
      const v = e[k];
      if (v == null) t.missing[k] += 1;
      else t[k] += v;
    }
  }
  return t;
}

/** Scales per-serving values by number of servings. */
export function scaleNutrition(perServing: NutritionValues, servings: number): NutritionValues {
  const s = (v: number | null) => (v == null ? null : v * servings);
  return {
    kcal: perServing.kcal * servings,
    proteinG: perServing.proteinG * servings,
    carbsG: s(perServing.carbsG),
    fatG: s(perServing.fatG),
    fiberG: s(perServing.fiberG),
    sodiumMg: s(perServing.sodiumMg),
  };
}

export interface DayAdherence {
  localDate: LocalDate;
  logged: boolean;
  kcal: number;
  proteinG: number;
  /** Null when the day is not logged or no target is set. */
  withinCalorieTarget: boolean | null;
  metProteinTarget: boolean | null;
}

/**
 * Adherence definitions (docs/METRICS.md):
 * - Calories: logged intake ≤ target × 1.05 (5% tolerance for logging imprecision).
 * - Protein: logged protein ≥ target × 0.9.
 * Unlogged days are reported as unlogged, not as "adherent" or "zero intake".
 */
export function weeklyAdherence(
  entries: NutritionEntryLike[],
  from: LocalDate,
  to: LocalDate,
  targets: { kcal: number | null; proteinG: number | null },
): { days: DayAdherence[]; loggedDays: number; loggingConsistency: number } {
  const days = dateRange(from, to).map((date) => {
    const dayEntries = entries.filter((e) => e.localDate === date);
    const logged = dayEntries.length > 0;
    const totals = sumNutrition(dayEntries);
    return {
      localDate: date,
      logged,
      kcal: totals.kcal,
      proteinG: totals.proteinG,
      withinCalorieTarget: logged && targets.kcal != null ? totals.kcal <= targets.kcal * 1.05 : null,
      metProteinTarget: logged && targets.proteinG != null ? totals.proteinG >= targets.proteinG * 0.9 : null,
    };
  });
  const loggedDays = days.filter((d) => d.logged).length;
  return { days, loggedDays, loggingConsistency: days.length ? loggedDays / days.length : 0 };
}

// ---------------------------------------------------------------------------------------------
// Energy estimates (always labelled as estimates in the UI)
// ---------------------------------------------------------------------------------------------

export type Sex = 'female' | 'male';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

/** Standard multipliers for Mifflin-St Jeor TDEE estimates. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/**
 * Mifflin-St Jeor (1990) resting energy estimate, kcal/day:
 *   10·kg + 6.25·cm − 5·age + s, where s = +5 (male) or −161 (female).
 * If sex is not provided we do NOT assume one; we return the range spanned by both constants.
 * Typical individual error is roughly ±10%.
 */
export function estimateBmr(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex | null;
}): { low: number; high: number; equation: 'mifflin_st_jeor' } | null {
  const { weightKg, heightCm, age, sex } = input;
  if (!(weightKg > 0 && heightCm > 0 && age > 0)) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (sex === 'male') return { low: base + 5, high: base + 5, equation: 'mifflin_st_jeor' };
  if (sex === 'female') return { low: base - 161, high: base - 161, equation: 'mifflin_st_jeor' };
  return { low: base - 161, high: base + 5, equation: 'mifflin_st_jeor' };
}

export function estimateTdee(bmr: { low: number; high: number }, level: ActivityLevel): { low: number; high: number } {
  const f = ACTIVITY_FACTORS[level];
  return { low: bmr.low * f, high: bmr.high * f };
}

export interface TargetWarning {
  code: 'calories_below_floor' | 'calories_below_bmr' | 'rate_too_fast' | 'target_bmi_low';
  message: string;
}

/**
 * Conservative sanity checks on a user's cutting configuration. These produce warnings only;
 * we never generate a more aggressive target in response.
 */
export function checkCutTargets(input: {
  calorieTargetKcal: number | null;
  bmrLow: number | null;
  currentKg: number | null;
  targetKg: number | null;
  heightCm: number | null;
  weeksToGoal: number | null;
}): TargetWarning[] {
  const w: TargetWarning[] = [];
  const { calorieTargetKcal, bmrLow, currentKg, targetKg, heightCm, weeksToGoal } = input;
  if (calorieTargetKcal != null && calorieTargetKcal < 1200) {
    w.push({
      code: 'calories_below_floor',
      message: 'This calorie target is below 1,200 kcal/day. Very low intakes are hard to sustain and are best done with professional supervision.',
    });
  } else if (calorieTargetKcal != null && bmrLow != null && calorieTargetKcal < bmrLow) {
    w.push({
      code: 'calories_below_bmr',
      message: 'This target is below your estimated resting energy needs. Consider a smaller deficit.',
    });
  }
  if (currentKg != null && targetKg != null && weeksToGoal != null && weeksToGoal > 0 && targetKg < currentKg) {
    const pctPerWeek = ((currentKg - targetKg) / currentKg / weeksToGoal) * 100;
    if (pctPerWeek > 1) {
      w.push({
        code: 'rate_too_fast',
        message: `Reaching this goal on time needs about ${pctPerWeek.toFixed(1)}% of body weight per week. Rates above ~1%/week make muscle retention harder. Consider a later date.`,
      });
    }
  }
  if (targetKg != null && heightCm != null && heightCm > 0) {
    const bmi = targetKg / (heightCm / 100) ** 2;
    if (bmi < 18.5) {
      w.push({ code: 'target_bmi_low', message: 'This target weight corresponds to a BMI under 18.5. Please review it with a health professional.' });
    }
  }
  return w;
}

export function weeksUntil(from: LocalDate, to: LocalDate): number {
  return daysBetween(from, to) / 7;
}

// ---------------------------------------------------------------------------------------------
// Automatic daily targets (estimates; always overridable by the user)
// ---------------------------------------------------------------------------------------------

export interface AutoTargets {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  maintenanceKcal: number;
  basis: string[];
}

export type AutoTargetsResult = { ok: true; targets: AutoTargets } | { ok: false; missing: string[] };

/**
 * Daily targets from profile + current weight:
 *  - maintenance = Mifflin-St Jeor × activity factor (midpoint of the range if sex isn't given);
 *  - cut: deficit ≈ 0.5% of body weight per week (7,700 kcal/kg), capped at 25% of maintenance and
 *    750 kcal/day, never below 1,200 kcal or the estimated resting energy;
 *  - protein 2.0 g/kg while cutting, otherwise 1.6 g/kg; fat 0.8 g/kg; carbs fill the remainder.
 */
export function computeAutoTargets(input: {
  goal: 'cut' | 'strength' | 'endurance' | 'swim' | 'general';
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | null;
  activity: ActivityLevel | null;
}): AutoTargetsResult {
  const missing: string[] = [];
  if (!input.weightKg) missing.push('body weight');
  if (!input.heightCm) missing.push('height');
  if (!input.age) missing.push('birth year');
  if (!input.activity) missing.push('activity level');
  if (missing.length) return { ok: false, missing };
  const w = input.weightKg!;
  const bmr = estimateBmr({ weightKg: w, heightCm: input.heightCm!, age: input.age!, sex: input.sex })!;
  const bmrMid = (bmr.low + bmr.high) / 2;
  const tdee = estimateTdee({ low: bmrMid, high: bmrMid }, input.activity!).low;
  const basis = [
    `Maintenance ≈ ${Math.round(tdee)} kcal (Mifflin-St Jeor × ${ACTIVITY_FACTORS[input.activity!]} activity${input.sex ? '' : ', sex not given so the middle of the range'})`,
  ];
  let kcal = tdee;
  const cutting = input.goal === 'cut';
  if (cutting) {
    const wanted = (0.005 * w * 7700) / 7;
    const deficit = Math.min(wanted, tdee * 0.25, 750);
    const floor = Math.max(1200, bmrMid);
    kcal = Math.max(floor, tdee - deficit);
    basis.push(`Deficit ${Math.round(tdee - kcal)} kcal/day ≈ ${(((tdee - kcal) * 7) / 7700).toFixed(2)} kg/week (aiming ~0.5% of body weight)`);
    if (kcal === floor) basis.push('Held at the safe minimum (1,200 kcal or your resting needs)');
  } else {
    basis.push('Maintenance calories (goal is not cutting)');
  }
  const proteinPerKg = cutting ? 2.0 : 1.6;
  const proteinG = proteinPerKg * w;
  const fatG = 0.8 * w;
  const carbsG = Math.max(0, (kcal - proteinG * 4 - fatG * 9) / 4);
  basis.push(`Protein ${proteinPerKg} g/kg · fat 0.8 g/kg · carbs fill the rest`);
  const r5 = (v: number) => Math.round(v / 5) * 5;
  return {
    ok: true,
    targets: { kcal: Math.round(kcal / 10) * 10, proteinG: r5(proteinG), fatG: r5(fatG), carbsG: r5(carbsG), maintenanceKcal: Math.round(tdee), basis },
  };
}

/** Body-mass index (kg/m²). A population screening number; it doesn't distinguish fat from muscle. */
export function bmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0 && heightCm > 0)) return null;
  return weightKg / (heightCm / 100) ** 2;
}

/**
 * When the target weight would be reached at the current weekly rate. Only when the trend is
 * moving toward the target; otherwise null (we don't project a date we can't support).
 */
export function projectGoalDate(currentKg: number, targetKg: number, kgPerWeek: number, from: LocalDate): LocalDate | null {
  const remaining = targetKg - currentKg;
  if (Math.abs(remaining) < 0.1) return from;
  if (kgPerWeek === 0 || Math.sign(remaining) !== Math.sign(kgPerWeek)) return null;
  const weeks = remaining / kgPerWeek;
  if (weeks > 104) return null;
  return addDays(from, Math.ceil(weeks * 7));
}
