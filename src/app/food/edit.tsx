import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { FoodItem, NutritionEntry, deleteEntry, getEntry, listFoods, upsertEntry, upsertFood } from '../../db/repos/nutrition';
import { Meal, scaleNutrition } from '../../domain/cutting';
import { isLocalDate, todayLocal } from '../../domain/dates';
import { parseDecimal } from '../../domain/units';
import { newId } from '../../lib/id';
import { Button, Card, ChipSelect, ErrorState, ListItem, Loading, Notice, Screen, SectionHeader, TextField, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

interface FoodFields {
  name: string; servingQty: string; servingUnit: string; kcal: string; protein: string; carbs: string; fat: string; fiber: string; sodium: string;
}
const EMPTY: FoodFields = { name: '', servingQty: '1', servingUnit: 'serving', kcal: '', protein: '', carbs: '', fat: '', fiber: '', sodium: '' };
const str = (n: number | null) => (n == null ? '' : String(+n.toFixed(1)));

export default function FoodEdit() {
  const params = useLocalSearchParams<{ id?: string; meal?: Meal; date?: string }>();
  const q = useDbQuery(async (db) => (params.id ? await getEntry(db, params.id) : null), [params.id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <FoodForm id={params.id} entry={q.data} defaultMeal={params.meal} defaultDate={params.date} />;
}

function fieldsFromEntry(e: NutritionEntry): FoodFields {
  const per = (v: number | null) => (v == null ? null : v / e.servings);
  return { name: e.name, servingQty: str(e.servingQty ?? 1), servingUnit: e.servingUnit ?? 'serving', kcal: str(per(e.kcal)), protein: str(per(e.proteinG)), carbs: str(per(e.carbsG)), fat: str(per(e.fatG)), fiber: str(per(e.fiberG)), sodium: str(per(e.sodiumMg)) };
}

function FoodForm({ id, entry, defaultMeal, defaultDate }: { id?: string; entry: NutritionEntry | null; defaultMeal?: Meal; defaultDate?: string }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const [search, setSearch] = useState('');
  const foodsQ = useDbQuery((db) => listFoods(db, search), [search]);
  const foods = foodsQ.status === 'ready' ? foodsQ.data : [];
  const [fields, setFields] = useState<FoodFields>(() => (entry ? fieldsFromEntry(entry) : EMPTY));
  const [foodItemId, setFoodItemId] = useState<string | null>(() => entry?.foodItemId ?? null);
  const [servings, setServings] = useState(() => (entry ? String(entry.servings) : '1'));
  const [meal, setMeal] = useState<Meal>(() => entry?.meal ?? defaultMeal ?? 'breakfast');
  const [date, setDate] = useState(() => entry?.localDate ?? defaultDate ?? todayLocal());
  const [saveFood, setSaveFood] = useState(!entry);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recordId] = useState(() => id ?? newId());

  const pick = (f: FoodItem) => {
    setFoodItemId(f.id);
    setSaveFood(false);
    setFields({ name: f.name, servingQty: str(f.servingQty), servingUnit: f.servingUnit, kcal: str(f.kcal), protein: str(f.proteinG), carbs: str(f.carbsG), fat: str(f.fatG), fiber: str(f.fiberG), sodium: str(f.sodiumMg) });
  };
  const set = (patch: Partial<FoodFields>) => setFields({ ...fields, ...patch });

  async function save() {
    const e: Record<string, string> = {};
    const num = (k: keyof FoodFields, required: boolean) => {
      const raw = fields[k].trim();
      if (raw === '') {
        if (required) e[k] = 'Required.';
        return null;
      }
      const n = parseDecimal(raw);
      if (n == null || n < 0) e[k] = 'Enter a number ≥ 0.';
      return n;
    };
    if (!fields.name.trim()) e.name = 'Enter a name.';
    const qty = num('servingQty', true);
    if (qty != null && qty <= 0) e.servingQty = 'Must be greater than 0.';
    const per = { kcal: num('kcal', true), proteinG: num('protein', true), carbsG: num('carbs', false), fatG: num('fat', false), fiberG: num('fiber', false), sodiumMg: num('sodium', false) };
    const sv = parseDecimal(servings);
    if (sv == null || sv <= 0) e.servings = 'Must be greater than 0.';
    if (!isLocalDate(date)) e.date = 'Use the format YYYY-MM-DD.';
    setErrors(e);
    if (Object.keys(e).length) return;

    const perServing = { kcal: per.kcal!, proteinG: per.proteinG!, carbsG: per.carbsG, fatG: per.fatG, fiberG: per.fiberG, sodiumMg: per.sodiumMg };
    const total = scaleNutrition(perServing, sv!);
    await mutate(async (db) => {
      await db.transaction(async (tx) => {
        let fid = foodItemId;
        if (saveFood) fid = await upsertFood(tx, { name: fields.name.trim(), servingQty: qty!, servingUnit: fields.servingUnit.trim() || 'serving', ...perServing });
        await upsertEntry(tx, {
          id: recordId, foodItemId: fid, name: fields.name.trim(), meal, localDate: date,
          loggedAt: entry?.loggedAt ?? new Date().toISOString(), servings: sv!, servingQty: qty, servingUnit: fields.servingUnit.trim() || 'serving', ...total,
        });
      });
    });
    router.back();
  }

  return (
    <Screen edges={[]}>
      {!id ? (
        <>
          <TextField label="Search my foods" value={search} onChangeText={setSearch} placeholder="Oats, chicken…" />
          {foods.length > 0 ? (
            <Card>
              {foods.slice(0, 8).map((f) => (
                <ListItem key={f.id} title={f.name} subtitle={`${f.servingQty} ${f.servingUnit} · ${Math.round(f.kcal)} kcal · ${Math.round(f.proteinG)} g protein`} onPress={() => pick(f)} />
              ))}
            </Card>
          ) : search ? <Text style={[font.caption, { color: colors.textMuted }]}>No saved foods match. Enter it below.</Text> : null}
          <SectionHeader title={foodItemId ? 'Selected food' : 'New food'} />
        </>
      ) : null}
      <TextField label="Food or meal name" value={fields.name} onChangeText={(name) => set({ name })} error={errors.name} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Serving size" value={fields.servingQty} onChangeText={(servingQty) => set({ servingQty })} keyboardType="decimal-pad" error={errors.servingQty} /></View>
        <View style={{ flex: 1 }}><TextField label="Unit" value={fields.servingUnit} onChangeText={(servingUnit) => set({ servingUnit })} placeholder="g, cup, piece" /></View>
      </View>
      <Text style={[font.caption, { color: colors.textMuted }]}>Nutrition per serving, as you entered it:</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Calories" value={fields.kcal} onChangeText={(kcal) => set({ kcal })} keyboardType="decimal-pad" suffix="kcal" error={errors.kcal} /></View>
        <View style={{ flex: 1 }}><TextField label="Protein" value={fields.protein} onChangeText={(protein) => set({ protein })} keyboardType="decimal-pad" suffix="g" error={errors.protein} /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Carbs (opt.)" value={fields.carbs} onChangeText={(carbs) => set({ carbs })} keyboardType="decimal-pad" suffix="g" error={errors.carbs} /></View>
        <View style={{ flex: 1 }}><TextField label="Fat (opt.)" value={fields.fat} onChangeText={(fat) => set({ fat })} keyboardType="decimal-pad" suffix="g" error={errors.fat} /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><TextField label="Fiber (opt.)" value={fields.fiber} onChangeText={(fiber) => set({ fiber })} keyboardType="decimal-pad" suffix="g" error={errors.fiber} /></View>
        <View style={{ flex: 1 }}><TextField label="Sodium (opt.)" value={fields.sodium} onChangeText={(sodium) => set({ sodium })} keyboardType="decimal-pad" suffix="mg" error={errors.sodium} /></View>
      </View>
      <TextField label="Number of servings" value={servings} onChangeText={setServings} keyboardType="decimal-pad" error={errors.servings} />
      <ChipSelect<Meal> label="Meal" value={meal} onChange={setMeal}
        options={[{ value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' }]} />
      <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" error={errors.date} />
      {!foodItemId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[font.body, { color: colors.text }]}>Save to my foods for reuse</Text>
          <Switch value={saveFood} onValueChange={setSaveFood} accessibilityLabel="Save to my foods for reuse" />
        </View>
      ) : null}
      {Object.keys(errors).length ? <Notice tone="danger">Please fix the highlighted fields.</Notice> : null}
      <Button title="Save" onPress={save} />
      {id ? (
        <Button title="Delete entry" variant="danger" onPress={async () => {
          if (await confirm('Delete this entry?', 'This can’t be undone.')) {
            await mutate((db) => deleteEntry(db, id));
            router.back();
          }
        }} />
      ) : null}
    </Screen>
  );
}
