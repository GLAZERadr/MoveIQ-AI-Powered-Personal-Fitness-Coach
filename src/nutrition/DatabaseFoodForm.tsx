/**
 * Log food from the bundled USDA database: search → pick → enter the amount (grams or a standard
 * portion) → nutrition is calculated automatically from the per-100 g values.
 */
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FOOD_SOURCE_ID, FOOD_SOURCE_LABEL, foodIndex } from '../data/foods/database';
import { useDbQuery, useMutation } from '../data/DbProvider';
import { NutritionEntry, deleteEntry, recentDatabaseFoods, upsertEntry, upsertFood } from '../db/repos/nutrition';
import { Meal } from '../domain/cutting';
import { isLocalDate, todayLocal } from '../domain/dates';
import { FoodHit, FoodRow, nutritionForGrams, searchFoods } from '../domain/foodSearch';
import { parseDecimal } from '../domain/units';
import { newId } from '../lib/id';
import { Button, Card, ChipSelect, KeyValue, ListItem, Notice, ProvenanceBadge, SectionHeader, TextField, confirm } from '../ui/components';
import { DateField, today } from '../ui/DateField';
import { useTheme } from '../ui/theme';

const usdaId = (fdcId: number) => `usda:${fdcId}`;
const fdcFromItemId = (id: string | null) => (id?.startsWith('usda:') ? Number(id.slice(5)) : null);
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Display name: the Indonesian/common alias when one matched, plus the USDA description. */
function displayName(row: FoodRow, alias: string | null): string {
  return alias ? `${title(alias)} (${row[1]})` : row[1];
}

export function isDatabaseEntry(e: NutritionEntry | null): boolean {
  return fdcFromItemId(e?.foodItemId ?? null) != null;
}

export function DatabaseFoodForm({ entry, defaultMeal, defaultDate }: { entry: NutritionEntry | null; defaultMeal?: Meal; defaultDate?: string }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const index = useMemo(() => foodIndex(), []);
  const initialRow = useMemo(() => {
    const id = fdcFromItemId(entry?.foodItemId ?? null);
    return id != null ? index.byId.get(id) ?? null : null;
  }, [entry, index]);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ row: FoodRow; alias: string | null } | null>(() => (initialRow ? { row: initialRow, alias: null } : null));
  const [grams, setGrams] = useState(() => (entry?.servingQty ? String(+(entry.servingQty * entry.servings).toFixed(1)) : ''));
  const [meal, setMeal] = useState<Meal>(() => entry?.meal ?? defaultMeal ?? 'breakfast');
  const [date, setDate] = useState(() => entry?.localDate ?? defaultDate ?? todayLocal());
  const [error, setError] = useState<string | null>(null);
  const [recordId] = useState(() => entry?.id ?? newId());

  const recentQ = useDbQuery((db) => recentDatabaseFoods(db), []);
  const results: FoodHit[] = useMemo(() => (query.trim().length >= 2 ? searchFoods(index, query, 25) : []), [index, query]);

  const g = parseDecimal(grams);
  const validGrams = g != null && g > 0 && g <= 5000;
  const n = selected && validGrams ? nutritionForGrams(selected.row, g) : null;

  function choose(row: FoodRow, alias: string | null) {
    setSelected({ row, alias });
    // Default to the first standard portion when USDA lists one, otherwise 100 g.
    setGrams(String(row[9][0]?.[1] ?? 100));
    setError(null);
  }

  async function save() {
    if (!selected || !n || !validGrams) return setError('Enter how many grams you ate (1–5000).');
    if (!isLocalDate(date)) return setError('Pick a date.');
    const { row, alias } = selected;
    const name = alias ? displayName(row, alias) : entry && initialRow?.[0] === row[0] ? entry.name : row[1];
    await mutate(async (db) => {
      await db.transaction(async (tx) => {
        // Keep the per-100 g database values as a reusable food item, attributed to USDA.
        await upsertFood(tx, {
          id: usdaId(row[0]), name: row[1], servingQty: 100, servingUnit: 'g', source: FOOD_SOURCE_ID,
          kcal: row[3], proteinG: row[4], fatG: row[5], carbsG: row[6], fiberG: row[7], sodiumMg: row[8],
        });
        await upsertEntry(tx, {
          id: recordId, foodItemId: usdaId(row[0]), name, meal, localDate: date, source: FOOD_SOURCE_ID,
          loggedAt: entry?.loggedAt ?? new Date().toISOString(), servings: 1, servingQty: g!, servingUnit: 'g', ...n,
        });
      });
    });
    router.back();
  }

  if (!selected) {
    return (
      <View style={{ gap: 12 }}>
        <TextField label="Search food" value={query} onChangeText={setQuery} placeholder="nasi, tempe, telur, banana…" autoFocus
          hint="Indonesian or English. Nutrition is calculated from the amount you enter." />
        {query.trim().length < 2 && recentQ.status === 'ready' && recentQ.data.length > 0 ? (
          <>
            <SectionHeader title="Recent" />
            <Card>
              {recentQ.data.map((r) => {
                const row = index.byId.get(fdcFromItemId(r.foodItemId)!);
                return row ? <ListItem key={r.foodItemId} title={r.name} subtitle={`${row[3]} kcal · ${row[4]} g protein per 100 g`} onPress={() => choose(row, null)} /> : null;
              })}
            </Card>
          </>
        ) : null}
        {query.trim().length >= 2 ? (
          <Card>
            {results.length === 0 ? (
              <Text style={[font.caption, { color: colors.textMuted }]}>No match. Try another word (e.g. “chicken”, “rice”), or use “Enter manually”.</Text>
            ) : (
              results.map((h) => (
                <ListItem key={h.fdcId} title={h.alias ? title(h.alias) : h.name} subtitle={`${h.alias ? `${h.name} · ` : ''}${h.row[3]} kcal · ${h.row[4]} g protein per 100 g`}
                  onPress={() => choose(h.row, h.alias)} />
              ))
            )}
          </Card>
        ) : null}
        <Text style={[font.caption, { color: colors.textMuted }]}>Data: {FOOD_SOURCE_LABEL}. Works offline.</Text>
      </View>
    );
  }

  const { row, alias } = selected;
  return (
    <View style={{ gap: 12 }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <Text style={[font.bodyStrong, { color: colors.text, flex: 1 }]}>{alias ? title(alias) : row[1]}</Text>
          {!entry ? (
            <Pressable onPress={() => setSelected(null)} accessibilityRole="button" hitSlop={10}>
              <Text style={[font.bodyStrong, { color: colors.primary }]}>Change</Text>
            </Pressable>
          ) : null}
        </View>
        {alias ? <Text style={[font.caption, { color: colors.textMuted }]}>{row[1]}</Text> : null}
        <Text style={[font.caption, { color: colors.textMuted }]}>Per 100 g: {row[3]} kcal · {row[4]} g protein · {row[6]} g carbs · {row[5]} g fat</Text>
      </Card>

      <TextField label="Amount eaten" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" suffix="g" autoFocus={!entry}
        error={grams && !validGrams ? 'Enter grams between 1 and 5000.' : undefined} />
      {row[9].length > 0 ? (
        <ChipSelect label="Or pick a standard portion" value={null}
          onChange={(v) => setGrams(v)}
          options={[...row[9].map(([label, gr]) => ({ value: String(gr), label: `${label} (${gr} g)` })), { value: '100', label: '100 g' }]} />
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[font.bodyStrong, { color: colors.text }]}>{n ? `${n.kcal} kcal` : '–'}</Text>
          <ProvenanceBadge kind="calculated" />
        </View>
        <KeyValue label="Protein" value={n ? `${n.proteinG} g` : '–'} />
        <KeyValue label="Carbohydrates" value={n?.carbsG != null ? `${n.carbsG} g` : '–'} />
        <KeyValue label="Fat" value={n?.fatG != null ? `${n.fatG} g` : '–'} />
        <KeyValue label="Fiber" value={n ? (n.fiberG != null ? `${n.fiberG} g` : 'not in database') : '–'} />
        <KeyValue label="Sodium" value={n ? (n.sodiumMg != null ? `${n.sodiumMg} mg` : 'not in database') : '–'} />
        <Text style={[font.caption, { color: colors.textMuted }]}>Calculated from USDA values per 100 g. Actual food varies with recipe and preparation.</Text>
      </Card>

      <ChipSelect<Meal> label="Meal" value={meal} onChange={setMeal}
        options={[{ value: 'breakfast', label: 'Breakfast' }, { value: 'lunch', label: 'Lunch' }, { value: 'dinner', label: 'Dinner' }, { value: 'snack', label: 'Snack' }]} />
      <DateField label="Date" value={date} onChange={setDate} maximumDate={today()} />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button title="Save" onPress={save} disabled={!n} />
      {entry ? (
        <Button title="Delete entry" variant="danger" onPress={async () => {
          if (await confirm('Delete this entry?', 'This can’t be undone.')) {
            await mutate((db) => deleteEntry(db, entry.id));
            router.back();
          }
        }} />
      ) : null}
    </View>
  );
}
