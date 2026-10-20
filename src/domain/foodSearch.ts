import { NutritionValues } from './cutting';

/** One row of the bundled USDA database (values per 100 g). */
export type FoodRow = [
  fdcId: number, name: string, category: number, kcal: number, protein: number, fat: number, carbs: number,
  fiber: number | null, sodium: number | null, portions: [string, number][],
];

export interface FoodHit {
  fdcId: number;
  name: string;
  /** The alias that matched, e.g. "tempe", if any. */
  alias: string | null;
  row: FoodRow;
}

export const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();

export interface FoodIndex {
  rows: FoodRow[];
  byId: Map<number, FoodRow>;
  words: string[][]; // normalized words per row
  aliases: { name: string; words: string[]; fdcId: number }[];
}

export function buildIndex(rows: FoodRow[], aliases: { names: string[]; fdcId: number }[]): FoodIndex {
  return {
    rows,
    byId: new Map(rows.map((r) => [r[0], r])),
    words: rows.map((r) => normalize(r[1]).split(' ')),
    aliases: aliases.flatMap((a) => a.names.map((n) => ({ name: n, words: normalize(n).split(' '), fdcId: a.fdcId }))),
  };
}

const allPrefixed = (q: string[], words: string[]) => q.every((t) => words.some((w) => w.startsWith(t)));

/**
 * Search: every query word must prefix-match a word in the food's name (or one of its aliases).
 * Ranking: alias matches first (exact > prefix), then foods whose first word matches, then simpler
 * (shorter) names, which favours "Bananas, raw" over long branded variants.
 */
export function searchFoods(index: FoodIndex, query: string, limit = 30): FoodHit[] {
  const q = normalize(query).split(' ').filter(Boolean);
  if (q.length === 0) return [];
  const scored = new Map<number, { score: number; alias: string | null }>();
  for (const a of index.aliases) {
    if (!allPrefixed(q, a.words)) continue;
    const exact = normalize(a.name) === q.join(' ');
    const score = (exact ? 2000 : 1000) - a.words.length;
    const prev = scored.get(a.fdcId);
    if (!prev || prev.score < score) scored.set(a.fdcId, { score, alias: a.name });
  }
  index.rows.forEach((r, i) => {
    const words = index.words[i]!;
    if (!allPrefixed(q, words)) return;
    if (scored.has(r[0])) return;
    const first = words[0]!.startsWith(q[0]!) ? 200 : 0;
    const simple = /\b(raw|cooked|boiled|roasted)\b/.test(normalize(r[1])) ? 20 : 0;
    scored.set(r[0], { score: first + simple - Math.min(150, r[1].length), alias: null });
  });
  return [...scored.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([id, s]) => ({ fdcId: id, name: index.byId.get(id)![1], alias: s.alias, row: index.byId.get(id)! }));
}

/** Nutrition for an eaten amount in grams (database values are per 100 g). */
export function nutritionForGrams(row: FoodRow, grams: number): NutritionValues {
  const f = grams / 100;
  const r1 = (v: number) => Math.round(v * f * 10) / 10;
  return {
    kcal: Math.round(row[3] * f),
    proteinG: r1(row[4]),
    fatG: r1(row[5]),
    carbsG: r1(row[6]),
    fiberG: row[7] == null ? null : r1(row[7]),
    sodiumMg: row[8] == null ? null : Math.round(row[8] * f),
  };
}
