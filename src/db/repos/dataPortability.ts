import { LATEST_SCHEMA_VERSION } from '../migrations';
import { Db } from '../types';

/** Tables included in exports, in dependency order. Pose landmark sequences are deliberately excluded. */
const EXPORT_TABLES = [
  'user_profile', 'fitness_goals', 'workout_plans', 'workout_plan_items', 'workout_sessions', 'workout_exercises',
  'exercise_sets', 'motion_session_summaries', 'body_weight_entries', 'body_measurements', 'food_items',
  'nutrition_entries', 'running_activities', 'running_splits', 'swimming_activities', 'app_settings',
] as const;

export interface DataExport {
  format: 'moveiq-export';
  schemaVersion: number;
  exportedAt: string;
  note: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportAll(db: Db): Promise<DataExport> {
  const tables: DataExport['tables'] = {};
  for (const t of EXPORT_TABLES) tables[t] = await db.all<Record<string, unknown>>(`SELECT * FROM ${t}`);
  return {
    format: 'moveiq-export',
    schemaVersion: LATEST_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    note: 'Units: kg, cm, meters, seconds, kcal. Camera landmark sequences are not included.',
    tables,
  };
}

export function recordCounts(e: DataExport): Record<string, number> {
  return Object.fromEntries(Object.entries(e.tables).map(([k, v]) => [k, v.length]));
}

/** Deletes all personal data. The exercise catalog (non-personal) is kept. Returns pose files to delete. */
export async function deleteAllData(db: Db): Promise<string[]> {
  const files = (await db.all<{ file_uri: string }>('SELECT file_uri FROM pose_sequence_refs')).map((r) => r.file_uri);
  await db.transaction(async (tx) => {
    for (const t of [
      'share_links', 'recommendation_dismissals', 'pose_sequence_refs', 'motion_session_summaries', 'exercise_sets',
      'workout_exercises', 'workout_sessions', 'workout_plan_items', 'workout_plans', 'nutrition_entries', 'food_items',
      'running_splits', 'running_activities', 'swimming_activities', 'body_measurements', 'body_weight_entries',
      'fitness_goals', 'user_profile', 'app_settings',
    ]) {
      await tx.run(`DELETE FROM ${t}`);
    }
  });
  return files;
}
