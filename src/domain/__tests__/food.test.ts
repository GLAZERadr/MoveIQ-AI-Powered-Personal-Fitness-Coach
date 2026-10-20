import { FOOD_ALIASES } from '../../data/foods/aliases';
import { FoodRow, buildIndex, nutritionForGrams, searchFoods } from '../foodSearch';

const db = require('../../data/foods/usda-sr-legacy.json') as { foods: FoodRow[]; source: string };
const index = buildIndex(db.foods, FOOD_ALIASES);

describe('food database & search', () => {
  it('bundles the full USDA SR Legacy set', () => {
    expect(db.foods.length).toBe(7793);
    expect(db.source).toMatch(/USDA/);
  });

  it('every Indonesian alias points to an existing USDA record', () => {
    for (const a of FOOD_ALIASES) expect(index.byId.has(a.fdcId)).toBe(true);
  });

  it('finds staples by Indonesian name first', () => {
    expect(searchFoods(index, 'nasi')[0]?.fdcId).toBe(168878);
    expect(searchFoods(index, 'tempe')[0]?.name).toBe('Tempeh');
    expect(searchFoods(index, 'telur rebus')[0]?.fdcId).toBe(173424);
    expect(searchFoods(index, 'kangkung')[0]?.fdcId).toBe(169302);
  });

  it('finds English names with prefix matching and prefers simple entries', () => {
    expect(searchFoods(index, 'banana')[0]?.name).toBe('Bananas, raw');
    expect(searchFoods(index, 'chick brea').some((h) => h.fdcId === 171477)).toBe(true);
    expect(searchFoods(index, '')).toEqual([]);
    expect(searchFoods(index, 'zzqqxx')).toEqual([]);
  });

  it('scales per-100 g values to the eaten amount', () => {
    const banana = index.byId.get(173944)!; // 89 kcal, 1.1 g protein, 22.8 g carbs per 100 g
    const n = nutritionForGrams(banana, 118); // 1 medium banana per USDA portion
    expect(n.kcal).toBe(105);
    expect(n.proteinG).toBeCloseTo(1.3, 1);
    expect(n.carbsG).toBeCloseTo(26.9, 1);
    const tempe = index.byId.get(174272)!;
    expect(nutritionForGrams(tempe, 50)).toMatchObject({ kcal: 96, proteinG: 10.2, fiberG: null });
  });

  it('exposes USDA standard portions in grams', () => {
    const banana = index.byId.get(173944)!;
    expect(banana[9]).toContainEqual(['1 medium (7" to 7-7/8" long)', 118]);
  });
});
