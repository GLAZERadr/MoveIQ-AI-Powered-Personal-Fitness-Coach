import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { Measurement, MeasurementKind, deleteMeasurement, listMeasurements, upsertMeasurement } from '../../db/repos/body';
import { getProfile } from '../../db/repos/profile';
import { isLocalDate, todayLocal } from '../../domain/dates';
import { inToCm, parseDecimal } from '../../domain/units';
import { newId } from '../../lib/id';
import { Button, ErrorState, Loading, Screen, Segmented, TextField, confirm } from '../../ui/components';
import { DateField, today } from '../../ui/DateField';

export default function MeasurementEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useDbQuery(async (db) => ({ profile: await getProfile(db), all: await listMeasurements(db) }), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <MeasurementForm id={id} imperial={q.data.profile?.unitSystem === 'imperial'} existing={q.data.all.find((x) => x.id === id) ?? null} />;
}

function MeasurementForm({ id, imperial, existing: m }: { id?: string; imperial: boolean; existing: Measurement | null }) {
  const mutate = useMutation();
  const [kind, setKind] = useState<MeasurementKind>(() => m?.kind ?? 'waist');
  const [value, setValue] = useState(() => (m ? (m.kind === 'waist' && imperial ? (m.value / 2.54).toFixed(1) : String(m.value)) : ''));
  const [method, setMethod] = useState(() => m?.method ?? '');
  const [date, setDate] = useState(() => m?.localDate ?? todayLocal());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recordId] = useState(() => id ?? newId());

  async function save() {
    const n = parseDecimal(value);
    const e: Record<string, string> = {};
    const v = n == null ? null : kind === 'waist' && imperial ? inToCm(n) : n;
    if (v == null || v <= 0 || (kind === 'body_fat' && v >= 75) || (kind === 'waist' && (v < 30 || v > 250))) e.value = 'Enter a valid value.';
    if (!isLocalDate(date)) e.date = 'Use the format YYYY-MM-DD.';
    setErrors(e);
    if (Object.keys(e).length) return;
    await mutate((db) => upsertMeasurement(db, { id: recordId, localDate: date, kind, value: v!, method: method.trim() || null }));
    router.back();
  }

  return (
    <Screen edges={[]}>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'waist', label: 'Waist' }, { value: 'body_fat', label: 'Body fat %' }]} />
      <TextField label={kind === 'waist' ? `Waist (${imperial ? 'in' : 'cm'})` : 'Body fat (%)'} value={value} onChangeText={setValue} keyboardType="decimal-pad"
        suffix={kind === 'waist' ? (imperial ? 'in' : 'cm') : '%'} error={errors.value}
        hint={kind === 'waist' ? 'Measure at the navel, relaxed, at the end of a normal exhale.' : undefined} />
      {kind === 'body_fat' ? <TextField label="Method" value={method} onChangeText={setMethod} placeholder="e.g. smart scale, calipers, DEXA" hint="Readings from different methods aren’t directly comparable." /> : null}
      <DateField label="Date" value={date} onChange={setDate} error={errors.date} maximumDate={today()} />
      <Button title="Save" onPress={save} />
      {id ? (
        <Button title="Delete" variant="danger" onPress={async () => {
          if (await confirm('Delete this measurement?', 'This can’t be undone.')) {
            await mutate((db) => deleteMeasurement(db, id));
            router.back();
          }
        }} />
      ) : null}
    </Screen>
  );
}
