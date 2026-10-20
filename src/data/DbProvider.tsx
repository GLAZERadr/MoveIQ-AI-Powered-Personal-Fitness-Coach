import { useFocusEffect } from 'expo-router';
import * as SQLite from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { migrate } from '../db/migrations';
import { ensureStarterPlans, purgeExpiredPoseRefs } from '../db/repos/workouts';
import { deletePoseFiles } from '../motion/poseStorage';
import { Db, SqlValue } from '../db/types';

function wrap(raw: SQLite.SQLiteDatabase, inTransaction = false): Db {
  const self: Db = {
    async run(sql, params: SqlValue[] = []) {
      const r = await raw.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => raw.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlValue[] = []) => raw.getFirstAsync<T>(sql, params),
    exec: (sql) => raw.execAsync(sql),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (inTransaction) return fn(self);
      let out!: T;
      // Exclusive transactions keep other async queries from interleaving with ours.
      await raw.withExclusiveTransactionAsync(async (txn) => {
        out = await fn(wrap(txn, true));
      });
      return out;
    },
  };
  return self;
}

export async function openAppDb(): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync('moveiq.db');
  await raw.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const db = wrap(raw);
  await migrate(db);
  await ensureStarterPlans(db);
  // Retention policy: drop expired landmark sequences on every launch.
  deletePoseFiles(await purgeExpiredPoseRefs(db, new Date().toISOString()));
  return db;
}

// ---------------------------------------------------------------------------------------------
// Change notifications: mutations bump a version so mounted queries refresh.
// ---------------------------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
export function notifyDataChanged(): void {
  listeners.forEach((l) => l());
}

interface DbContextValue {
  db: Db;
}
const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({ children, fallback, errorView }: { children: React.ReactNode; fallback: React.ReactNode; errorView: (e: Error, retry: () => void) => React.ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    openAppDb()
      .then((d) => !cancelled && setDb(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e : new Error(String(e))));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) return <>{errorView(error, () => { setError(null); setAttempt((a) => a + 1); })}</>;
  if (!db) return <>{fallback}</>;
  return <DbContext.Provider value={{ db }}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used inside <DbProvider>');
  return ctx.db;
}

export type QueryState<T> = { status: 'loading'; data: undefined; error: undefined; reload: () => void }
  | { status: 'ready'; data: T; error: undefined; reload: () => void }
  | { status: 'error'; data: undefined; error: Error; reload: () => void };

/**
 * Runs `fn` against the DB and re-runs it when the screen regains focus or any mutation calls
 * notifyDataChanged(). Charts and summaries therefore always reflect persisted records.
 */
export function useDbQuery<T>(fn: (db: Db) => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const db = useDb();
  const [state, setState] = useState<{ data?: T; error?: Error; loaded: boolean }>({ loaded: false });
  // Latest-callback ref, updated after render so the stable `load` always calls the current query.
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  const seq = useRef(0);
  const depsKey = JSON.stringify(deps);

  const load = useCallback(() => {
    const id = ++seq.current;
    fnRef.current(db)
      .then((data) => id === seq.current && setState({ data, loaded: true }))
      .catch((e: unknown) => id === seq.current && setState({ error: e instanceof Error ? e : new Error(String(e)), loaded: true }));
    // depsKey changes when the caller's inputs change, which must trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, depsKey]);

  useEffect(() => {
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);

  useFocusEffect(load);

  if (!state.loaded) return { status: 'loading', data: undefined, error: undefined, reload: load };
  if (state.error) return { status: 'error', data: undefined, error: state.error, reload: load };
  return { status: 'ready', data: state.data as T, error: undefined, reload: load };
}

/** Runs a write and notifies queries. */
export function useMutation() {
  const db = useDb();
  return useCallback(
    async <T,>(fn: (db: Db) => Promise<T>): Promise<T> => {
      const out = await fn(db);
      notifyDataChanged();
      return out;
    },
    [db],
  );
}
