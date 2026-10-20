/**
 * Postgres migrations for the cloud service. Runs on the DIRECT (unpooled) connection, as Neon
 * recommends for schema changes. Append-only and idempotent: `npm run db:migrate`.
 */
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from './auth.js';
import { env } from './env.js';

export const SERVER_MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS backups (
  id uuid PRIMARY KEY,
  device_key_hash text NOT NULL CHECK (length(device_key_hash) = 64),
  object_key text NOT NULL UNIQUE,
  bytes integer NOT NULL CHECK (bytes > 0),
  schema_version integer,
  record_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backups_owner_created ON backups (device_key_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 32),
  device_key_hash text NOT NULL CHECK (length(device_key_hash) = 64),
  kind text NOT NULL CHECK (kind IN ('run','swim','workout')),
  title text NOT NULL CHECK (length(title) <= 120),
  activity_date date NOT NULL,
  stats jsonb NOT NULL,
  image_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS shares_owner ON shares (device_key_hash);
`,
  },
];

export async function migrate(connectionString = env.databaseUrlUnpooled): Promise<number[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ version: number }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const applied: number[] = [];
    for (const m of SERVER_MIGRATIONS) {
      if (done.has(m.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
        await client.query('COMMIT');
        applied.push(m.version);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

/** Creates/updates Better Auth's tables (user, session, account, verification) on the direct connection. */
export async function migrateAuth(connectionString = env.databaseUrlUnpooled): Promise<string[]> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(authOptions(pool));
    const changes = [...toBeCreated.map((t) => `create ${t.table}`), ...toBeAdded.map((t) => `alter ${t.table}`)];
    if (changes.length) await runMigrations();
    return changes;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  migrate()
    .then((v) => console.log(v.length ? `Applied migrations: ${v.join(', ')}` : 'App schema is up to date.'))
    .then(() => migrateAuth())
    .then((c) => console.log(c.length ? `Auth schema: ${c.join(', ')}` : 'Auth schema is up to date.'))
    .catch((e: Error) => {
      console.error('Migration failed:', e.message);
      process.exit(1);
    });
}
