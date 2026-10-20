import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { env } from './env.js';

/**
 * node-postgres pool on Neon's pooled connection string (-pooler host, PgBouncer transaction mode).
 * Locally this is a long-running Node process; on Vercel it runs on Fluid compute, where Neon recommends
 * node-postgres plus attachDatabasePool so idle connections are released before an instance is suspended.
 * No session state (SET, LISTEN, prepared statements by name) is used, so pooled mode is safe.
 */
let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.databaseUrl, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    pool.on('error', (e) => console.error('[db] idle client error:', e.message));
    attachDatabasePool(pool);
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
