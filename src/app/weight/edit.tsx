import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { fmtWeight } from '../../data/format';
import { WeightEntryWithNote, deleteWeight, getWeight, listWeights, upsertWeight } from '../../db/repos/body';
import { getProfile } from '../../db/repos/profile';
import { addDays, formatShortDate, isLocalDate, todayLocal } from '../../domain/dates';
import { UnitSystem, displayWeight, parseDecimal, weightInputToKg } from '../../domain/units';
import { newId } from '../../lib/id';
import { Button, Card, ErrorState, ListItem, Loading, Screen, SectionHeader, TextField, confirm } from '../../ui/components';

export default function WeightEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useDbQuery(async (db) => ({
    profile: await getProfile(db),
    entry: id ? await getWeight(db, id) : null,
    recent: await listWeights(db, addDays(todayLocal(), -30)),
  }), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  // key: switching to another entry from the recent list remounts the form with that entry's values.
  return <WeightForm key={id ?? 'new'} id={id} sys={q.data.profile?.unitSystem ?? 'metric'} entry={q.data.entry} recent={q.data.recent} />;
}

function WeightForm({ id, sys, entry, recent }: { id?: string; sys: UnitSystem; entry: WeightEntryWithNote | null; recent: WeightEntryWithNote[] }) {
  const mutate = useMutation();
  const [value, setValue] = useState(() => (entry ? displayWeight(entry.weightKg, sys).value.toFixed(1) : ''));
  const [date, setDate] = useState(() => entry?.localDate ?? todayLocal());
  const [note, setNote] = useState(() => entry?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [recordId] = useState(() => id ?? newId());
  const unit = sys === 'imperial' ? 'lb' : 'kg';

  async function save() {
    const n = parseDecimal(value);
    const e: Record<string, string> = {};
    const kg = n == null ? null : weightInputToKg(n, sys);
    if (kg == null || kg < 20 || kg > 400) e.value = 'Enter a valid body weight.';
    if (!isLocalDate(date)) e.date = 'Use the format YYYY-MM-DD.';
    else if (date > todayLocal()) e.date = 'Date can’t be in the future.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const measuredAt = date === todayLocal() ? new Date().toISOString() : new Date(`${date}T08:00:00`).toISOString();
      await mutate((db) => upsertWeight(db, { id: recordId, localDate: date, measuredAt: entry && entry.localDate === date ? entry.measuredAt : measuredAt, weightKg: kg!, note: note.trim() || null }));
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <TextField label={`Weight (${unit})`} value={value} onChangeText={setValue} keyboardType="decimal-pad" suffix={unit} error={errors.value} autoFocus={!id}
        hint="For the clearest trend, weigh in the morning after using the bathroom, before eating." />
      <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={errors.date} />
      <TextField label="Note (optional)" value={note} onChangeText={setNote} />
      <Button title="Save" onPress={save} loading={saving} />
      {id ? (
        <Button title="Delete entry" variant="danger" onPress={async () => {
          if (await confirm('Delete this weigh-in?', 'This can’t be undone.')) {
            await mutate((db) => deleteWeight(db, id));
            router.back();
          }
        }} />
      ) : null}
      {!id && recent.length > 0 ? (
        <>
          <SectionHeader title="Recent weigh-ins" />
          <Card>
            {recent.slice().reverse().slice(0, 14).map((w) => {
              const f = fmtWeight(w.weightKg, sys);
              return <ListItem key={w.id} title={`${f.value} ${f.unit}`} subtitle={w.note ?? undefined} right={formatShortDate(w.localDate)}
                onPress={() => router.replace({ pathname: '/weight/edit', params: { id: w.id } })} />;
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
