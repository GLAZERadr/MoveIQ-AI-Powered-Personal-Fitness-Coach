/**
 * Minimal async SQL interface. The app uses expo-sqlite behind it; tests use better-sqlite3
 * (real SQLite, same SQL) so migrations and repositories are exercised for real.
 * All statements MUST use bound parameters; never interpolate values into SQL.
 */
export type SqlValue = string | number | null;

export interface Db {
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  exec(sql: string): Promise<void>;
  /** Runs fn atomically; rolls back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
