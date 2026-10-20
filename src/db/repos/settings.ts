import { LocalDate } from '../../domain/dates';
import { Db } from '../types';

export interface AppSettings {
  /** Days to keep landmark sequences for post-workout re-analysis. 0 = do not retain. */
  poseRetentionDays: number;
  cameraFacing: 'front' | 'back';
  showSkeleton: boolean;
  /** Show workout status on the lock screen (iOS Live Activity / Android ongoing notification). */
  lockScreenStatus: boolean;
  hapticOnRep: boolean;
  /** Base URL of the optional MoveIQ cloud service (share links). Empty = default. */
  cloudApiUrl: string;
  /** Calorie/macro targets calculated automatically from profile + weight trend (vs. typed manually). */
  autoTargets: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  poseRetentionDays: 14,
  cameraFacing: 'front',
  showSkeleton: true,
  lockScreenStatus: true,
  hapticOnRep: true,
  cloudApiUrl: '',
  autoTargets: true,
};

export async function getSettings(db: Db): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings');
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in s) {
      try {
        (s as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
      } catch {
        // ignore malformed values, keep the default
      }
    }
  }
  return s;
}

export async function setSetting<K extends keyof AppSettings>(db: Db, key: K, value: AppSettings[K]): Promise<void> {
  await db.run('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}

export async function dismissRecommendation(db: Db, ruleId: string, on: LocalDate): Promise<void> {
  await db.run('INSERT OR IGNORE INTO recommendation_dismissals (rule_id, dismissed_on) VALUES (?, ?)', [ruleId, on]);
}

export async function dismissedRecommendations(db: Db, on: LocalDate): Promise<Set<string>> {
  const rows = await db.all<{ rule_id: string }>('SELECT rule_id FROM recommendation_dismissals WHERE dismissed_on = ?', [on]);
  return new Set(rows.map((r) => r.rule_id));
}
