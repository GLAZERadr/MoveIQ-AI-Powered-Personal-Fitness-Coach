import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { getRun, upsertRun } from '../../db/repos/activities';
import { getProfile } from '../../db/repos/profile';
import { todayLocal } from '../../domain/dates';
import { RunActivity, RunKind, splitTotalsMismatch } from '../../domain/running';
import { DistanceUnit, distanceUnitFor, formatDuration, fromMeters } from '../../domain/units';
import { RunForm, parseRunForm } from '../../domain/validation';
import { newId } from '../../lib/id';
import { Button, Card, ChipSelect, ErrorState, IconButton, Loading, Notice, Screen, SectionHeader, TextField } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { DateField, TimeField, today } from '../../ui/DateField';

const EMPTY: RunForm = { date: todayLocal(), time: '', distance: '', duration: '', kind: 'outdoor', avgHr: '', maxHr: '', cadence: '', elevation: '', rpe: '', notes: '', splits: [] };

export default function RunEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useDbQuery(async (d) => ({ profile: await getProfile(d), run: id ? await getRun(d, id) : null }), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <RunEditForm id={id} run={q.data.run} unit={distanceUnitFor(q.data.profile?.unitSystem ?? 'metric')} />;
}

function initialRunForm(r: RunActivity | null, unit: DistanceUnit): RunForm {
  if (!r) return { ...EMPTY, date: todayLocal() };
  const t = r.startedAt ? new Date(r.startedAt) : null;
  return {
      date: r.localDate,
      time: t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '',
      distance: String(+fromMeters(r.distanceM, unit).toFixed(3)),
      duration: formatDuration(r.durationSec),
      kind: r.kind,
      avgHr: r.avgHr?.toString() ?? '',
      maxHr: r.maxHr?.toString() ?? '',
      cadence: r.cadenceSpm?.toString() ?? '',
      elevation: r.elevationGainM?.toString() ?? '',
      rpe: r.rpe?.toString() ?? '',
      notes: r.notes ?? '',
      splits: r.splits.map((s) => ({ distance: String(+fromMeters(s.distanceM, unit).toFixed(3)), duration: formatDuration(s.durationSec) })),
  };
}

function RunEditForm({ id, run, unit }: { id?: string; run: RunActivity | null; unit: DistanceUnit }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const [form, setForm] = useState<RunForm>(() => initialRunForm(run, unit));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Stable id for this form: a retried save updates the same row instead of duplicating it.
  const [recordId] = useState(() => id ?? newId());

  const set = (patch: Partial<RunForm>) => setForm({ ...form, ...patch });
  const parsed = parseRunForm(form, unit);
  const mismatch = parsed.ok ? splitTotalsMismatch(parsed.value, parsed.value.splits) : null;

  async function save() {
    const r = parseRunForm(form, unit);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setSaving(true);
    try {
      await mutate((d) => upsertRun(d, { ...r.value, id: recordId }));
      router.back();
    } catch (e) {
      setErrors({ form: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <ChipSelect<RunKind> label="Type" value={form.kind} onChange={(kind) => set({ kind })}
        options={[{ value: 'outdoor', label: 'Outdoor' }, { value: 'treadmill', label: 'Treadmill' }, { value: 'trail', label: 'Trail' }]} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 3 }}><DateField label="Date" value={form.date} onChange={(date) => set({ date })} error={errors.date} maximumDate={today()} /></View>
        <View style={{ flex: 2 }}><TimeField label="Start (optional)" value={form.time} onChange={(time) => set({ time })} error={errors.time} optional /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Distance" value={form.distance} onChangeText={(distance) => set({ distance })} keyboardType="decimal-pad" suffix={unit} error={errors.distance} /></View>
        <View style={{ flex: 1 }}><TextField label="Duration" value={form.duration} onChangeText={(duration) => set({ duration })} placeholder="32:18" error={errors.duration} keyboardType="numbers-and-punctuation" /></View>
      </View>
      {parsed.ok ? (
        <Text style={[font.caption, { color: colors.textMuted }]}>Average pace: {formatDuration(parsed.value.durationSec / fromMeters(parsed.value.distanceM, unit))} /{unit} (calculated)</Text>
      ) : null}
      <SectionHeader title="Optional details" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Avg HR" value={form.avgHr} onChangeText={(avgHr) => set({ avgHr })} keyboardType="number-pad" suffix="bpm" error={errors.avgHr} /></View>
        <View style={{ flex: 1 }}><TextField label="Max HR" value={form.maxHr} onChangeText={(maxHr) => set({ maxHr })} keyboardType="number-pad" suffix="bpm" error={errors.maxHr} /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Cadence" value={form.cadence} onChangeText={(cadence) => set({ cadence })} keyboardType="number-pad" suffix="spm" error={errors.cadence} /></View>
        <View style={{ flex: 1 }}><TextField label="Elevation gain" value={form.elevation} onChangeText={(elevation) => set({ elevation })} keyboardType="decimal-pad" suffix="m" error={errors.elevation} /></View>
      </View>
      <ChipSelect label="Perceived exertion (RPE)" value={form.rpe || null} onChange={(rpe) => set({ rpe: rpe === form.rpe ? '' : rpe })}
        options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
      <TextField label="Notes" value={form.notes} onChangeText={(notes) => set({ notes })} multiline />

      <SectionHeader title="Splits (optional)" action={{ label: 'Add split', onPress: () => set({ splits: [...form.splits, { distance: unit === 'km' ? '1' : '1', duration: '' }] }) }} />
      {form.splits.length === 0 ? <Text style={[font.caption, { color: colors.textMuted }]}>Add splits only if you recorded them. MoveIQ never estimates splits from totals.</Text> : null}
      {form.splits.map((s, i) => (
        <Card key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', padding: 10 }}>
          <Text style={[font.bodyStrong, { color: colors.text, paddingBottom: 14 }]}>{i + 1}</Text>
          <View style={{ flex: 1 }}><TextField label="Distance" value={s.distance} suffix={unit} keyboardType="decimal-pad"
            onChangeText={(v) => set({ splits: form.splits.map((x, k) => (k === i ? { ...x, distance: v } : x)) })} /></View>
          <View style={{ flex: 1 }}><TextField label="Time" value={s.duration} placeholder="6:05" keyboardType="numbers-and-punctuation"
            onChangeText={(v) => set({ splits: form.splits.map((x, k) => (k === i ? { ...x, duration: v } : x)) })} /></View>
          <IconButton icon="trash-outline" label={`Remove split ${i + 1}`} size={20} onPress={() => set({ splits: form.splits.filter((_, k) => k !== i) })} />
        </Card>
      ))}
      {errors.splits ? <Notice tone="danger">Check your splits: each needs a distance above zero and a time like 6:05.</Notice> : null}
      {mismatch ? <Notice tone="warning">Your splits add up to a different distance or time than the totals. That’s allowed, but please double-check.</Notice> : null}
      {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
      <Button title="Save run" onPress={save} loading={saving} />
    </Screen>
  );
}
