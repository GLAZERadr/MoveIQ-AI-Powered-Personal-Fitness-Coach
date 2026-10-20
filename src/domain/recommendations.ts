import { DailyWeight, NutritionEntryLike, sumNutrition, weeklyRate } from './cutting';
import { LocalDate, addDays, dateRange } from './dates';

/**
 * Deterministic, explainable recommendation rules. Each rule:
 *  - declares exactly which records it needs,
 *  - returns null when those records don't exist (no guessing about sleep, readiness or recovery),
 *  - lists the evidence it used so the UI can show "why".
 */

export interface Recommendation {
  ruleId: string;
  title: string;
  body: string;
  evidence: string[];
  severity: 'info' | 'attention';
}

export interface TrainingRecord {
  kind: 'workout' | 'run' | 'swim';
  localDate: LocalDate;
  rpe: number | null;
}

export interface RecommendationInput {
  today: LocalDate;
  training: TrainingRecord[];
  dailyWeights: DailyWeight[];
  nutrition: NutritionEntryLike[];
  goal: { kind: string; proteinTargetG: number | null; calorieTargetKcal: number | null } | null;
  lastCameraSession: { localDate: LocalDate; goodFramePct: number } | null;
}

type Rule = (i: RecommendationInput) => Recommendation | null;

const inLastDays = (date: LocalDate, today: LocalDate, days: number) => date > addDays(today, -days) && date <= today;

export const highExertionRule: Rule = ({ today, training }) => {
  const recent = training.filter((t) => inLastDays(t.localDate, today, 7) && t.rpe != null);
  const hard = recent.filter((t) => (t.rpe ?? 0) >= 8);
  const latest = [...recent].sort((a, b) => b.localDate.localeCompare(a.localDate))[0];
  if (hard.length < 2 || !latest || (latest.rpe ?? 0) < 8) return null;
  return {
    ruleId: 'high_exertion',
    title: 'Review today’s intensity',
    body: `You logged ${hard.length} demanding sessions this week, and your latest one had a high perceived exertion. Consider reviewing today’s planned intensity.`,
    evidence: hard.map((t) => `${t.kind} on ${t.localDate}: RPE ${t.rpe}`),
    severity: 'attention',
  };
};

export const lowProteinRule: Rule = ({ today, nutrition, goal }) => {
  const target = goal?.proteinTargetG;
  if (!target) return null;
  const days = dateRange(addDays(today, -6), today);
  const logged = days.map((d) => nutrition.filter((n) => n.localDate === d)).filter((e) => e.length > 0);
  if (logged.length < 3) return null;
  const avg = logged.reduce((a, e) => a + sumNutrition(e).proteinG, 0) / logged.length;
  if (avg >= target * 0.9) return null;
  return {
    ruleId: 'low_protein',
    title: 'Protein below your target',
    body: `On the ${logged.length} days you logged this week, protein averaged ${Math.round(avg)} g against your ${Math.round(target)} g target. Enough protein helps you keep muscle while cutting.`,
    evidence: [`${logged.length} logged days`, `average ${Math.round(avg)} g/day`, `target ${Math.round(target)} g/day`],
    severity: 'info',
  };
};

export const fastWeightLossRule: Rule = ({ today, dailyWeights, goal }) => {
  if (goal?.kind !== 'cut') return null;
  const r = weeklyRate(dailyWeights, today);
  if (r.status !== 'ok' || r.percentOfBodyweightPerWeek > -1) return null;
  return {
    ruleId: 'fast_weight_loss',
    title: 'Weight is dropping quickly',
    body: `Your 7-day average weight fell about ${Math.abs(r.percentOfBodyweightPerWeek).toFixed(1)}% compared with the week before. Some of this may be water, but losing more than about 1% per week makes it harder to keep muscle. Consider whether your calorie target is too low.`,
    evidence: [`previous 7-day avg ${r.priorAvgKg.toFixed(1)} kg`, `last 7-day avg ${r.recentAvgKg.toFixed(1)} kg`],
    severity: 'attention',
  };
};

export const weighInGapRule: Rule = ({ today, dailyWeights, goal }) => {
  if (goal?.kind !== 'cut' || dailyWeights.length === 0) return null;
  const last = dailyWeights[dailyWeights.length - 1]!;
  if (inLastDays(last.localDate, today, 7)) return null;
  return {
    ruleId: 'weigh_in_gap',
    title: 'No weigh-ins this week',
    body: 'Weighing in a few mornings a week keeps your trend line accurate, because single weigh-ins fluctuate with water and food.',
    evidence: [`last weigh-in ${last.localDate}`],
    severity: 'info',
  };
};

export const trainingGapRule: Rule = ({ today, training }) => {
  if (training.length === 0) return null;
  if (training.some((t) => inLastDays(t.localDate, today, 7))) return null;
  const last = [...training].sort((a, b) => b.localDate.localeCompare(a.localDate))[0]!;
  return {
    ruleId: 'training_gap',
    title: 'Time for a session?',
    body: 'You haven’t logged any training in the last 7 days. A short bodyweight session is an easy way back in.',
    evidence: [`last session ${last.localDate} (${last.kind})`],
    severity: 'info',
  };
};

export const trackingQualityRule: Rule = ({ today, lastCameraSession }) => {
  if (!lastCameraSession || !inLastDays(lastCameraSession.localDate, today, 14)) return null;
  if (lastCameraSession.goodFramePct >= 60) return null;
  return {
    ruleId: 'tracking_quality',
    title: 'Improve camera setup',
    body: 'Tracking quality was low in your last camera workout. Try more light, a camera placed farther away, and a side-on angle so your whole body is visible.',
    evidence: [`good tracking in ${Math.round(lastCameraSession.goodFramePct)}% of frames on ${lastCameraSession.localDate}`],
    severity: 'info',
  };
};

export const RULES: Rule[] = [highExertionRule, fastWeightLossRule, lowProteinRule, trackingQualityRule, weighInGapRule, trainingGapRule];

export function evaluateRecommendations(input: RecommendationInput, dismissed: Set<string> = new Set()): Recommendation[] {
  return RULES.map((r) => r(input)).filter((r): r is Recommendation => r != null && !dismissed.has(r.ruleId));
}
