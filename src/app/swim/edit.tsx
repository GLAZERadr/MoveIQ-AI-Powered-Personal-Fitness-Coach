import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { getSwim, upsertSwim } from '../../db/repos/activities';
import { todayLocal } from '../../domain/dates';
import { SwimActivity, SwimStroke, checkPoolDistance, pacePer100m } from '../../domain/swimming';
import { METERS_PER_YARD, formatDuration, formatPace } from '../../domain/units';
import { SwimForm, autoSwimDistance, parseSwimForm } from '../../domain/validation';
import { newId } from '../../lib/id';
import { Button, ChipSelect, ErrorState, Loading, Notice, Screen, SectionHeader, Segmented, TextField } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { DateField, TimeField, today } from '../../ui/DateField';

const EMPTY: SwimForm = { date: todayLocal(), time: '', distance: '', distanceUnit: 'm', duration: '', environment: 'pool', poolLength: '25', poolLengthUnit: 'm', laps: '', stroke: null, avgHr: '', rpe: '', notes: '' };

export default function SwimEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useDbQuery(async (d) => (id ? await getSwim(d, id) : null), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <SwimEditForm id={id} swim={q.data} />;
}

function initialSwimForm(s: SwimActivity | null): SwimForm {
  if (!s) return { ...EMPTY, date: todayLocal() };
  const yd = s.poolLengthUnit === 'yd';
  const t = s.startedAt ? new Date(s.startedAt) : null;
  return {
      date: s.localDate,
      time: t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '',
      distance: String(+(yd ? s.distanceM / METERS_PER_YARD : s.distanceM).toFixed(1)),
      distanceUnit: yd ? 'yd' : 'm',
      duration: formatDuration(s.durationSec),
      environment: s.environment,
      poolLength: s.poolLengthM != null ? String(+(yd ? s.poolLengthM / METERS_PER_YARD : s.poolLengthM).toFixed(1)) : '',
      poolLengthUnit: yd ? 'yd' : 'm',
      laps: s.laps?.toString() ?? '',
      stroke: s.stroke,
      avgHr: s.avgHr?.toString() ?? '',
      rpe: s.rpe?.toString() ?? '',
      notes: s.notes ?? '',
  };
}

function SwimEditForm({ id, swim }: { id?: string; swim: SwimActivity | null }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const [form, setForm] = useState<SwimForm>(() => initialSwimForm(swim));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [recordId] = useState(() => id ?? newId());

  const set = (patch: Partial<SwimForm>) => setForm({ ...form, ...patch });
  const parsed = parseSwimForm(form);
  const check = parsed.ok ? checkPoolDistance(parsed.value) : null;
  const pool = form.environment === 'pool';

  async function save() {
    const r = parseSwimForm(form);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setSaving(true);
    try {
      await mutate((d) => upsertSwim(d, { ...r.value, id: recordId }));
      router.back();
    } catch (e) {
      setErrors({ form: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <Segmented value={form.environment} onChange={(environment) => set({ environment })} options={[{ value: 'pool', label: 'Pool' }, { value: 'open_water', label: 'Open water' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 3 }}><DateField label="Date" value={form.date} onChange={(date) => set({ date })} error={errors.date} maximumDate={today()} /></View>
        <View style={{ flex: 2 }}><TimeField label="Start (optional)" value={form.time} onChange={(time) => set({ time })} error={errors.time} optional /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Distance" value={form.distance} onChangeText={(distance) => set({ distance })} keyboardType="decimal-pad" suffix={form.distanceUnit} error={errors.distance}
          placeholder={autoSwimDistance(form) ?? undefined} hint={autoSwimDistance(form) ? `Auto: ${autoSwimDistance(form)} ${form.distanceUnit} from lengths` : pool ? 'Or leave blank and enter pool length + lengths' : undefined} /></View>
        <View style={{ flex: 1 }}><TextField label="Duration" value={form.duration} onChangeText={(duration) => set({ duration })} placeholder="38:24" keyboardType="numbers-and-punctuation" error={errors.duration} /></View>
      </View>
      <Segmented label="Distance unit" value={form.distanceUnit} onChange={(distanceUnit) => set({ distanceUnit, poolLengthUnit: distanceUnit })} options={[{ value: 'm', label: 'Meters' }, { value: 'yd', label: 'Yards' }]} />
      {parsed.ok ? (
        <Text style={[font.caption, { color: colors.textMuted }]}>Average pace: {formatPace(pacePer100m(parsed.value.durationSec, parsed.value.distanceM))} /100m (calculated)</Text>
      ) : null}
      {pool ? (
        <>
          <SectionHeader title="Pool details (optional)" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><TextField label="Pool length" value={form.poolLength} onChangeText={(poolLength) => set({ poolLength })} keyboardType="decimal-pad" suffix={form.poolLengthUnit} error={errors.poolLength} /></View>
            <View style={{ flex: 1 }}><TextField label="Lengths swum" value={form.laps} onChangeText={(laps) => set({ laps })} keyboardType="number-pad" error={errors.laps} hint="One length = one pool length." /></View>
          </View>
          {check?.status === 'inconsistent' ? (
            <Notice tone="warning">
              {`${form.laps} lengths × ${form.poolLength} ${form.poolLengthUnit} = ${Math.round(check.expectedM / (form.poolLengthUnit === 'yd' ? METERS_PER_YARD : 1))} ${form.poolLengthUnit}, which doesn’t match the distance you entered. You can still save; your entry won’t be changed.`}
            </Notice>
          ) : null}
        </>
      ) : null}
      <ChipSelect<SwimStroke> label="Main stroke (optional)" value={form.stroke} onChange={(stroke) => set({ stroke: stroke === form.stroke ? null : stroke })}
        options={[{ value: 'freestyle', label: 'Freestyle' }, { value: 'breaststroke', label: 'Breaststroke' }, { value: 'backstroke', label: 'Backstroke' }, { value: 'butterfly', label: 'Butterfly' }, { value: 'mixed', label: 'Mixed' }]} />
      <TextField label="Average heart rate (optional)" value={form.avgHr} onChangeText={(avgHr) => set({ avgHr })} keyboardType="number-pad" suffix="bpm" error={errors.avgHr} />
      <ChipSelect label="Perceived exertion (RPE)" value={form.rpe || null} onChange={(rpe) => set({ rpe: rpe === form.rpe ? '' : rpe })}
        options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
      <TextField label="Notes" value={form.notes} onChangeText={(notes) => set({ notes })} multiline />
      {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
      <Button title="Save swim" onPress={save} loading={saving} />
    </Screen>
  );
}
