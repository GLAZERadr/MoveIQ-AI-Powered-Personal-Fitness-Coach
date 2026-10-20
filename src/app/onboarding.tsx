import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useMutation } from '../data/DbProvider';
import { useAccountName } from '../auth/social';
import { upsertWeight } from '../db/repos/body';
import { GoalKind, savePrimaryGoal, saveProfile } from '../db/repos/profile';
import { ActivityLevel, Sex, checkCutTargets, estimateBmr, estimateTdee, weeksUntil } from '../domain/cutting';
import { isLocalDate, todayLocal } from '../domain/dates';
import { UnitSystem, inToCm, parseDecimal, weightInputToKg } from '../domain/units';
import { Button, Card, ChipSelect, Notice, ProgressBar, ProvenanceBadge, Screen, Segmented, TextField, Title } from '../ui/components';
import { useTheme } from '../ui/theme';
import { DateField } from '../ui/DateField';

const GOALS: { value: GoalKind; label: string; icon: 'flame-outline' | 'barbell-outline' | 'pulse-outline' | 'water-outline' | 'heart-outline' }[] = [
  { value: 'cut', label: 'Get lean / cut', icon: 'flame-outline' },
  { value: 'strength', label: 'Build strength', icon: 'barbell-outline' },
  { value: 'endurance', label: 'Improve endurance', icon: 'pulse-outline' },
  { value: 'swim', label: 'Swim performance', icon: 'water-outline' },
  { value: 'general', label: 'Overall fitness', icon: 'heart-outline' },
];

const LOGO = require('../../assets/logo.png');

const STEPS = 5;

export default function Onboarding() {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [goal, setGoal] = useState<GoalKind | null>(null);
  const [experience, setExperience] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [units, setUnits] = useState<UnitSystem>('metric');
  const accountName = useAccountName();
  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? accountName ?? '';
  const [height, setHeight] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [sex, setSex] = useState<Sex | 'unspecified'>('unspecified');
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [weight, setWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parsed = useMemo(() => {
    const h = parseDecimal(height);
    const w = parseDecimal(weight);
    const tw = parseDecimal(targetWeight);
    return {
      heightCm: h == null ? null : units === 'imperial' ? inToCm(h) : h,
      weightKg: w == null ? null : weightInputToKg(w, units),
      targetKg: tw == null ? null : weightInputToKg(tw, units),
      birthYear: birthYear ? Number(birthYear) : null,
      calories: parseDecimal(calories),
      protein: parseDecimal(protein),
    };
  }, [height, weight, targetWeight, birthYear, calories, protein, units]);

  const age = parsed.birthYear ? new Date().getFullYear() - parsed.birthYear : null;
  const bmr = parsed.weightKg && parsed.heightCm && age ? estimateBmr({ weightKg: parsed.weightKg, heightCm: parsed.heightCm, age, sex: sex === 'unspecified' ? null : sex }) : null;
  const tdee = bmr ? estimateTdee(bmr, activity) : null;
  const warnings = checkCutTargets({
    calorieTargetKcal: parsed.calories,
    bmrLow: bmr?.low ?? null,
    currentKg: parsed.weightKg,
    targetKg: parsed.targetKg,
    heightCm: parsed.heightCm,
    weeksToGoal: isLocalDate(targetDate) ? weeksUntil(todayLocal(), targetDate) : null,
  });

  function validate(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 0 && !goal) e.goal = 'Choose a primary goal.';
    if (s === 2) {
      if (height && (parsed.heightCm == null || parsed.heightCm < 50 || parsed.heightCm > 260)) e.height = 'Enter a valid height.';
      if (weight && (parsed.weightKg == null || parsed.weightKg < 20 || parsed.weightKg > 400)) e.weight = 'Enter a valid weight.';
      if (birthYear && (!/^\d{4}$/.test(birthYear) || (age ?? 0) < 13 || (age ?? 0) > 110)) e.birthYear = 'Enter a 4-digit birth year (age 13+).';
    }
    if (s === 3) {
      if (targetWeight && (parsed.targetKg == null || parsed.targetKg < 20 || parsed.targetKg > 400)) e.targetWeight = 'Enter a valid weight.';
      if (targetDate && !isLocalDate(targetDate)) e.targetDate = 'Use the format YYYY-MM-DD.';
      if (targetDate && isLocalDate(targetDate) && targetDate <= todayLocal()) e.targetDate = 'Pick a future date.';
      if (calories && (parsed.calories == null || parsed.calories < 500 || parsed.calories > 10000)) e.calories = 'Enter a value between 500 and 10,000.';
      if (protein && (parsed.protein == null || parsed.protein < 0 || parsed.protein > 600)) e.protein = 'Enter a value between 0 and 600.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function finish() {
    setSaving(true);
    try {
      const now = new Date();
      await mutate(async (db) => {
        await db.transaction(async (tx) => {
          await saveProfile(tx, {
            displayName: name.trim() || null,
            birthYear: parsed.birthYear,
            sex: sex === 'unspecified' ? null : sex,
            heightCm: parsed.heightCm,
            activityLevel: activity,
            experience,
            unitSystem: units,
            dietaryPreferences: null,
            onboardedAt: now.toISOString(),
          });
          await savePrimaryGoal(tx, {
            kind: goal ?? 'general',
            startWeightKg: parsed.weightKg,
            targetWeightKg: parsed.targetKg,
            targetDate: isLocalDate(targetDate) ? targetDate : null,
            dailyCalorieTargetKcal: parsed.calories,
            dailyProteinTargetG: parsed.protein,
          });
          if (parsed.weightKg) {
            await upsertWeight(tx, { localDate: todayLocal(now), measuredAt: now.toISOString(), weightKg: parsed.weightKg, note: 'Onboarding' });
          }
        });
      });
      router.replace('/(tabs)/home');
    } finally {
      setSaving(false);
    }
  }

  const next = () => {
    if (!validate(step)) return;
    if (step === STEPS - 1) void finish();
    else setStep(step + 1);
  };

  const wUnit = units === 'imperial' ? 'lb' : 'kg';

  return (
    <Screen>
      <ProgressBar value={(step + 1) / STEPS} label={`Step ${step + 1} of ${STEPS}`} />
      {step === 0 && (
        <>
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }} accessible accessibilityLabel="MoveIQ. Train smarter. Live stronger.">
            <Image source={LOGO} style={{ width: 88, height: 88, borderRadius: 22 }} />
            <Text style={[font.heading, { color: colors.text }]}>MoveIQ</Text>
            <Text style={[font.body, { color: colors.textMuted }]}>Train Smarter. Live Stronger.</Text>
          </View>
          <Title subtitle="Choose your main focus. You can track everything either way.">What’s your primary goal?</Title>
          <ChipSelect options={GOALS} value={goal} onChange={setGoal} />
          {errors.goal ? <Text style={[font.caption, { color: colors.danger }]}>{errors.goal}</Text> : null}
        </>
      )}
      {step === 1 && (
        <>
          <Title subtitle="Used to tailor default workout targets.">Your experience</Title>
          <Segmented value={experience} onChange={setExperience} label="Training experience"
            options={[{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]} />
          <Segmented value={units} onChange={setUnits} label="Units" options={[{ value: 'metric', label: 'Metric (kg, km)' }, { value: 'imperial', label: 'Imperial (lb, mi)' }]} />
          <TextField label="Name (optional)" value={name} onChangeText={setName} placeholder="Alex" />
        </>
      )}
      {step === 2 && (
        <>
          <Title subtitle="All optional. Leave anything blank. Nothing is assumed.">About you</Title>
          <TextField label={`Current weight (${wUnit})`} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix={wUnit} error={errors.weight} />
          <TextField label={`Height (${units === 'imperial' ? 'in' : 'cm'})`} value={height} onChangeText={setHeight} keyboardType="decimal-pad" suffix={units === 'imperial' ? 'in' : 'cm'} error={errors.height} />
          <TextField label="Birth year" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" error={errors.birthYear} hint="Only used for energy estimates." />
          <Segmented value={sex} onChange={setSex} label="Sex (optional, only used by the energy equation)"
            options={[{ value: 'unspecified', label: 'Prefer not to say' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
          <ChipSelect value={activity} onChange={setActivity} label="Typical activity level"
            options={[
              { value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Light' }, { value: 'moderate', label: 'Moderate' },
              { value: 'active', label: 'Active' }, { value: 'very_active', label: 'Very active' },
            ]} />
        </>
      )}
      {step === 3 && (
        <>
          <Title subtitle="Set your own targets. You can change them anytime.">{goal === 'cut' ? 'Cutting goal' : 'Nutrition targets'}</Title>
          {tdee ? (
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[font.caption, { color: colors.textMuted }]}>Estimated maintenance energy</Text>
                <ProvenanceBadge kind="estimate" />
              </View>
              <Text style={[font.metric, { color: colors.text }]}>
                {tdee.low === tdee.high ? Math.round(tdee.low).toLocaleString() : `${Math.round(tdee.low).toLocaleString()}–${Math.round(tdee.high).toLocaleString()}`}
                <Text style={[font.body, { color: colors.textMuted }]}> kcal/day</Text>
              </Text>
              <Text style={[font.caption, { color: colors.textMuted }]}>
                Mifflin-St Jeor × activity factor. Individual error is often ±10% or more.{sex === 'unspecified' ? ' Shown as a range because sex was not provided.' : ''} Adjust based on your actual weight trend.
              </Text>
            </Card>
          ) : (
            <Notice>Add weight, height and birth year in the previous step to see an estimated maintenance range, or simply enter targets you already use.</Notice>
          )}
          <TextField label={`Target weight (${wUnit})`} value={targetWeight} onChangeText={setTargetWeight} keyboardType="decimal-pad" suffix={wUnit} error={errors.targetWeight} />
          <DateField label="Target date (optional)" value={targetDate} onChange={setTargetDate} error={errors.targetDate} optional minimumDate={new Date()} />
          <TextField label="Daily calorie target" value={calories} onChangeText={setCalories} keyboardType="number-pad" suffix="kcal" error={errors.calories} />
          <TextField label="Daily protein target" value={protein} onChangeText={setProtein} keyboardType="number-pad" suffix="g" error={errors.protein}
            hint={parsed.weightKg ? `For reference, 1.6 g/kg (a common evidence-based amount during a cut) is about ${Math.round(parsed.weightKg * 1.6)} g.` : undefined} />
          {warnings.map((w) => <Notice key={w.code} tone="warning">{w.message}</Notice>)}
        </>
      )}
      {step === 4 && (
        <>
          <Title subtitle="How MoveIQ handles your data">Privacy & camera</Title>
          <Card>
            <Text style={[font.bodyStrong, { color: colors.text }]}>Camera coaching runs on your phone</Text>
            <Text style={[font.body, { color: colors.textMuted }]}>
              During camera workouts, video frames are analysed on-device to estimate 33 body landmarks. Video is never recorded or uploaded. Only
              compact landmark coordinates are kept, for post-workout analysis, and they’re deleted automatically after 14 days (you can change this or turn it off).
            </Text>
          </Card>
          <Card>
            <Text style={[font.bodyStrong, { color: colors.text }]}>Your records stay on this device</Text>
            <Text style={[font.body, { color: colors.textMuted }]}>
              Weight, nutrition and activities are stored locally and work offline. Cloud backup and share links are optional and only happen when you tap them.
              You can export or delete everything in Profile.
            </Text>
          </Card>
          <Notice>Form feedback is an approximate estimate from a 2D camera view. It isn’t medical advice and can’t guarantee injury prevention.</Notice>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        {step > 0 ? <Button title="Back" variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        <Button title={step === STEPS - 1 ? 'Get started' : 'Next'} onPress={next} loading={saving} style={{ flex: 2 }} />
      </View>
    </Screen>
  );
}
