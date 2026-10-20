import { FOOD_ALIASES } from './aliases';
import { FoodIndex, FoodRow, buildIndex } from '../../domain/foodSearch';

export const FOOD_SOURCE_ID = 'provider:usda-sr-legacy' as const;
export const FOOD_SOURCE_LABEL = 'USDA FoodData Central (SR Legacy, public domain)';

let index: FoodIndex | null = null;

/** Loads the ~1 MB database lazily on first use (keeps app start fast). */
export function foodIndex(): FoodIndex {
  if (!index) {
    const db = require('./usda-sr-legacy.json') as { foods: FoodRow[] };
    index = buildIndex(db.foods, FOOD_ALIASES);
  }
  return index;
}
