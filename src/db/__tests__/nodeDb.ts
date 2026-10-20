import Database from 'better-sqlite3';
import { Db, SqlValue } from '../types';

/** Test adapter: real SQLite (better-sqlite3) behind the same Db interface the app uses. */
export function openTestDb(path = ':memory:'): Db & { close(): void } {
  const raw = new Database(path);
  raw.pragma('foreign_keys = ON');
  let depth = 0;
  const db: Db & { close(): void } = {
    async run(sql: string, params: SqlValue[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: r.changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const sp = `sp${depth++}`;
      raw.exec(`SAVEPOINT ${sp}`);
      try {
        const out = await fn(db);
        raw.exec(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
  return db;
}
