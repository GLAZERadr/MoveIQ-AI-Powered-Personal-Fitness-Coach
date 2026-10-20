import { Meal, NutritionEntryLike, NutritionValues } from '../../domain/cutting';
import { LocalDate } from '../../domain/dates';
import { newId, nowIso } from '../../lib/id';
import { Db } from '../types';

/** Where nutrition values came from. Only 'user' exists today; providers are a future integration. */
export type NutritionSource = 'user' | `provider:${string}`;

export interface FoodItem extends NutritionValues {
  id: string;
  name: string;
  servingQty: number;
  servingUnit: string;
  source: NutritionSource;
}

export interface NutritionEntry extends NutritionEntryLike {
  id: string;
  foodItemId: string | null;
  name: string;
  loggedAt: string;
  servings: number;
  servingQty: number | null;
  servingUnit: string | null;
  source: NutritionSource;
}

interface FoodRow {
  id: string;
  name: string;
  serving_qty: number;
  serving_unit: string;
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  source: NutritionSource;
}

const mapFood = (r: FoodRow): FoodItem => ({
  id: r.id,
  name: r.name,
  servingQty: r.serving_qty,
  servingUnit: r.serving_unit,
  kcal: r.kcal,
  proteinG: r.protein_g,
  carbsG: r.carbs_g,
  fatG: r.fat_g,
  fiberG: r.fiber_g,
  sodiumMg: r.sodium_mg,
  source: r.source,
});

export async function listFoods(db: Db, search = ''): Promise<FoodItem[]> {
  const rows = await db.all<FoodRow>("SELECT * FROM food_items WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE", [
    `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
  ]);
  return rows.map(mapFood);
}

export async function upsertFood(db: Db, f: Omit<FoodItem, 'id' | 'source'> & { id?: string; source?: NutritionSource }): Promise<string> {
  const id = f.id ?? newId();
  const now = nowIso();
  await db.run(
    `INSERT INTO food_items (id, name, serving_qty, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, serving_qty = excluded.serving_qty, serving_unit = excluded.serving_unit, kcal = excluded.kcal,
       protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fiber_g = excluded.fiber_g, sodium_mg = excluded.sodium_mg,
       source = excluded.source, updated_at = excluded.updated_at`,
    [id, f.name, f.servingQty, f.servingUnit, f.kcal, f.proteinG, f.carbsG, f.fatG, f.fiberG, f.sodiumMg, f.source ?? 'user', now, now],
  );
  return id;
}

export async function deleteFood(db: Db, id: string): Promise<void> {
  // Entries keep their snapshot values; the link is set to NULL by the foreign key.
  await db.run('DELETE FROM food_items WHERE id = ?', [id]);
}

interface EntryRow {
  id: string;
  food_item_id: string | null;
  name: string;
  meal: Meal;
  local_date: string;
  logged_at: string;
  servings: number;
  serving_qty: number | null;
  serving_unit: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
  source: NutritionSource;
}

const mapEntry = (r: EntryRow): NutritionEntry => ({
  id: r.id,
  foodItemId: r.food_item_id,
  name: r.name,
  meal: r.meal,
  localDate: r.local_date,
  loggedAt: r.logged_at,
  servings: r.servings,
  servingQty: r.serving_qty,
  servingUnit: r.serving_unit,
  kcal: r.kcal,
  proteinG: r.protein_g,
  carbsG: r.carbs_g,
  fatG: r.fat_g,
  fiberG: r.fiber_g,
  sodiumMg: r.sodium_mg,
  source: r.source,
});

export async function listEntries(db: Db, from: LocalDate, to: LocalDate): Promise<NutritionEntry[]> {
  const rows = await db.all<EntryRow>('SELECT * FROM nutrition_entries WHERE local_date BETWEEN ? AND ? ORDER BY local_date, logged_at', [from, to]);
  return rows.map(mapEntry);
}

export async function getEntry(db: Db, id: string): Promise<NutritionEntry | null> {
  const r = await db.first<EntryRow>('SELECT * FROM nutrition_entries WHERE id = ?', [id]);
  return r ? mapEntry(r) : null;
}

/** Values are the totals for this entry (already multiplied by servings). */
export async function upsertEntry(db: Db, e: Omit<NutritionEntry, 'id' | 'source'> & { id?: string; source?: NutritionSource }): Promise<string> {
  const id = e.id ?? newId();
  const now = nowIso();
  await db.run(
    `INSERT INTO nutrition_entries (id, food_item_id, name, meal, local_date, logged_at, servings, serving_qty, serving_unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET food_item_id = excluded.food_item_id, name = excluded.name, meal = excluded.meal, local_date = excluded.local_date,
       logged_at = excluded.logged_at, servings = excluded.servings, serving_qty = excluded.serving_qty, serving_unit = excluded.serving_unit,
       kcal = excluded.kcal, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
       sodium_mg = excluded.sodium_mg, source = excluded.source, updated_at = excluded.updated_at`,
    [id, e.foodItemId, e.name, e.meal, e.localDate, e.loggedAt, e.servings, e.servingQty, e.servingUnit, e.kcal, e.proteinG, e.carbsG, e.fatG, e.fiberG, e.sodiumMg, e.source ?? 'user', now, now],
  );
  return id;
}

export async function deleteEntry(db: Db, id: string): Promise<void> {
  await db.run('DELETE FROM nutrition_entries WHERE id = ?', [id]);
}

/** Most recently logged database foods (for quick re-use), newest first. */
export async function recentDatabaseFoods(db: Db, limit = 8): Promise<{ foodItemId: string; name: string }[]> {
  return db.all(
    `SELECT food_item_id AS foodItemId, name FROM nutrition_entries
     WHERE food_item_id LIKE 'usda:%' GROUP BY food_item_id ORDER BY MAX(logged_at) DESC LIMIT ?`,
    [limit],
  );
}
