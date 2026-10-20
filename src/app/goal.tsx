import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../data/DbProvider';
import { WeightEntryWithNote, listWeights } from '../db/repos/body';
import { Goal, GoalKind, Profile, getPrimaryGoal, getProfile, savePrimaryGoal } from '../db/repos/profile';
import { checkCutTargets, dailyWeights, estimateBmr, estimateTdee, weeksUntil } from '../domain/cutting';
import { isLocalDate, todayLocal } from '../domain/dates';
import { displayWeight, parseDecimal, weightInputToKg } from '../domain/units';
import { Button, Card, ChipSelect, ErrorState, Loading, Notice, ProvenanceBadge, Screen, Segmented, TextField } from '../ui/components';
import { EffectiveTargets, loadTargets } from '../data/targets';
import { getSettings, setSetting } from '../db/repos/settings';
import { useTheme } from '../ui/theme';
import { DateField } from '../ui/DateField';

type GoalData = { goal: Goal | null; profile: Profile | null; weights: WeightEntryWithNote[]; autoTargets: boolean; targets: EffectiveTargets };

export default function GoalScreen() {
  const q = useDbQuery(async (db): Promise<GoalData> => ({
    goal: await getPrimaryGoal(db), profile: await getProfile(db), weights: await listWeights(db),
    autoTargets: (await getSettings(db)).autoTargets, targets: await loadTargets(db),
  }));
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <GoalForm data={q.data} />;
}

function GoalForm({ data }: { data: GoalData }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const sys = data.profile?.unitSystem ?? 'metric';
  const [f, setF] = useState(() => {
    const g = data.goal;
    const w = (kg: number | null | undefined) => (kg == null ? '' : displayWeight(kg, sys).value.toFixed(1));
    return { kind: g?.kind ?? ('cut' as GoalKind), start: w(g?.startWeightKg ?? dailyWeights(data.weights).at(-1)?.weightKg), target: w(g?.targetWeightKg), date: g?.targetDate ?? '', kcal: g?.dailyCalorieTargetKcal?.toString() ?? '', protein: g?.dailyProteinTargetG?.toString() ?? '' };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(data.autoTargets);

  const unit = sys === 'imperial' ? 'lb' : 'kg';
  const p = data.profile;
  const latest = dailyWeights(data.weights).at(-1)?.weightKg ?? null;
  const toKg = (s: string) => {
    const n = parseDecimal(s);
    return n == null ? null : weightInputToKg(n, sys);
  };
  const age = p?.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const bmr = latest && p?.heightCm && age ? estimateBmr({ weightKg: latest, heightCm: p.heightCm, age, sex: p.sex }) : null;
  const tdee = bmr && p?.activityLevel ? estimateTdee(bmr, p.activityLevel) : null;
  const warnings = checkCutTargets({
    calorieTargetKcal: auto ? null : parseDecimal(f.kcal), bmrLow: bmr?.low ?? null, currentKg: latest ?? toKg(f.start), targetKg: toKg(f.target),
    heightCm: p?.heightCm ?? null, weeksToGoal: isLocalDate(f.date) ? weeksUntil(todayLocal(), f.date) : null,
  });

  async function save() {
    const e: Record<string, string> = {};
    const chk = (k: string, v: number | null, min: number, max: number, raw: string) => {
      if (raw.trim() !== '' && (v == null || v < min || v > max)) e[k] = 'Out of range.';
    };
    chk('start', toKg(f.start), 20, 400, f.start);
    chk('target', toKg(f.target), 20, 400, f.target);
    chk('kcal', parseDecimal(f.kcal), 500, 10000, f.kcal);
    chk('protein', parseDecimal(f.protein), 0, 600, f.protein);
    if (f.date && !isLocalDate(f.date)) e.date = 'Use the format YYYY-MM-DD.';
    setErrors(e);
    if (Object.keys(e).length) return;
    await mutate((db) => setSetting(db, 'autoTargets', auto));
    await mutate((db) => savePrimaryGoal(db, {
      id: data.goal?.kind === f.kind ? data.goal.id : undefined,
      kind: f.kind, startWeightKg: toKg(f.start), targetWeightKg: toKg(f.target), targetDate: f.date || null,
      dailyCalorieTargetKcal: parseDecimal(f.kcal), dailyProteinTargetG: parseDecimal(f.protein),
    }));
    router.back();
  }

  return (
    <Screen edges={[]}>
      <ChipSelect<GoalKind> label="Primary goal" value={f.kind} onChange={(kind) => setF({ ...f, kind })}
        options={[{ value: 'cut', label: 'Cut' }, { value: 'strength', label: 'Strength' }, { value: 'endurance', label: 'Endurance' }, { value: 'swim', label: 'Swim' }, { value: 'general', label: 'General' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Starting weight" value={f.start} onChangeText={(start) => setF({ ...f, start })} keyboardType="decimal-pad" suffix={unit} error={errors.start} /></View>
        <View style={{ flex: 1 }}><TextField label="Target weight" value={f.target} onChangeText={(target) => setF({ ...f, target })} keyboardType="decimal-pad" suffix={unit} error={errors.target} /></View>
      </View>
      <DateField label="Target date (optional)" value={f.date} onChange={(date) => setF({ ...f, date })} error={errors.date} optional minimumDate={new Date()} />
      <Segmented<'auto' | 'manual'> label="Daily calorie & macro targets" value={auto ? 'auto' : 'manual'} onChange={(v) => setAuto(v === 'auto')}
        options={[{ value: 'auto', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} />
      {auto ? (
        <Card>
          {data.targets.mode === 'auto' && data.targets.missing.length === 0 ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[font.bodyStrong, { color: colors.text }]}>{data.targets.kcal} kcal · {data.targets.proteinG} g protein</Text>
                <ProvenanceBadge kind="estimate" />
              </View>
              <Text style={[font.caption, { color: colors.textMuted }]}>{data.targets.carbsG} g carbs · {data.targets.fatG} g fat</Text>
              {data.targets.basis.map((b) => <Text key={b} style={[font.caption, { color: colors.textMuted }]}>• {b}</Text>)}
              <Text style={[font.caption, { color: colors.textMuted }]}>Recalculated automatically from your goal, profile and 7-day average weight. Changes to the goal above apply after saving.</Text>
            </>
          ) : (
            <Notice tone="warning">{`Automatic targets need your ${data.targets.missing.join(', ') || 'profile'}. Add them in Profile (and log a weigh-in), or switch to Manual.`}</Notice>
          )}
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><TextField label="Daily calories" value={f.kcal} onChangeText={(kcal) => setF({ ...f, kcal })} keyboardType="number-pad" suffix="kcal" error={errors.kcal} /></View>
          <View style={{ flex: 1 }}><TextField label="Daily protein" value={f.protein} onChangeText={(protein) => setF({ ...f, protein })} keyboardType="number-pad" suffix="g" error={errors.protein} /></View>
        </View>
      )}
      {tdee && !auto ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[font.caption, { color: colors.textMuted }]}>Estimated maintenance</Text>
            <ProvenanceBadge kind="estimate" />
          </View>
          <Text style={[font.bodyStrong, { color: colors.text }]}>{tdee.low === tdee.high ? Math.round(tdee.low) : `${Math.round(tdee.low)}–${Math.round(tdee.high)}`} kcal/day</Text>
          <Text style={[font.caption, { color: colors.textMuted }]}>Mifflin-St Jeor resting estimate × your activity factor, based on your latest weigh-in. Typical error is ±10%. Your actual weight trend is a better guide.</Text>
        </Card>
      ) : null}
      {warnings.map((w) => <Notice key={w.code} tone="warning">{w.message}</Notice>)}
      <Button title="Save targets" onPress={save} />
    </Screen>
  );
}
