import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { auth, enabledProviders, sessionUser } from './auth.js';
import { db } from './db.js';
import { homePage, privacyPage, termsPage } from './pages.js';
import { env } from './env.js';
import { deleteObject, getObjectBytes, presignGet, putObject, storageHealth } from './storage.js';

/**
 * MoveIQ cloud API (deployed on Vercel; this file is the zero-config Hono entry). Two opt-in features:
 *  - Backups: JSON export snapshots → Object Storage; metadata → Postgres.
 *  - Share links: a summary card PNG → Object Storage; stats → Postgres; public page at /s/:id.
 *
 * Ownership: the app sends a random 256-bit device key (x-device-key). We store only its SHA-256.
 * This is not user authentication (see docs/BACKEND.md); add Neon Auth before a public launch.
 */

type Vars = { owner: string };
const app = new Hono<{ Variables: Vars }>();

const ownerFrom = (c: Context): string | null => {
  const key = c.req.header('x-device-key') ?? '';
  return /^[0-9a-f]{64}$/.test(key) ? createHash('sha256').update(key).digest('hex') : null;
};

/**
 * Owner of backups/shares: the signed-in account when there is a session (so backups follow the user
 * across devices), otherwise the anonymous device key. Both are stored as a SHA-256 hex digest.
 */
const requireOwner = async (c: Context<{ Variables: Vars }>, next: () => Promise<void>) => {
  const user = await sessionUser(c.req.raw.headers).catch(() => null);
  const owner = user ? createHash('sha256').update(`user:${user.id}`).digest('hex') : ownerFrom(c);
  if (!owner) return c.json({ error: 'Sign in or provide a device key.' }, 401);
  c.set('owner', owner);
  await next();
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const origin = (c: Context) => env.publicBaseUrl ?? new URL(c.req.url).origin;

app.onError((err, c) => {
  console.error('[api] error:', err.message);
  return c.json({ error: 'Internal server error.' }, 500);
});

// Better Auth endpoints: /api/auth/sign-in/social, /api/auth/callback/:provider, /api/auth/get-session, …
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth().handler(c.req.raw));

/** Which sign-in buttons the app should show. */
app.get('/v1/auth/providers', (c) => c.json({ providers: enabledProviders(), configured: !!process.env.BETTER_AUTH_SECRET }));

app.get('/v1/me', async (c) => {
  const user = await sessionUser(c.req.raw.headers);
  return user ? c.json({ user }) : c.json({ error: 'Not signed in.' }, 401);
});

// Public pages (Google OAuth consent screen requires home page, privacy policy and terms URLs).
// The logo is served from server/public/logo.png by Vercel's CDN.
app.get('/', (c) => c.html(homePage()));
app.get('/privacy', (c) => c.html(privacyPage()));
app.get('/terms', (c) => c.html(termsPage()));

/** Permanently deletes the signed-in account and everything the account owns in the cloud. */
app.delete('/v1/me', async (c) => {
  const user = await sessionUser(c.req.raw.headers);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  const owner = createHash('sha256').update(`user:${user.id}`).digest('hex');
  const backups = await db().query<{ object_key: string }>('DELETE FROM backups WHERE device_key_hash = $1 RETURNING object_key', [owner]);
  const shares = await db().query<{ image_key: string | null }>('DELETE FROM shares WHERE device_key_hash = $1 RETURNING image_key', [owner]);
  const keys = [...backups.rows.map((r) => r.object_key), ...shares.rows.map((r) => r.image_key).filter((k): k is string => !!k)];
  await Promise.all(keys.map((k) => deleteObject(k).catch(() => undefined)));
  // Better Auth tables: sessions and linked provider accounts first, then the user row.
  await db().query('DELETE FROM "session" WHERE "userId" = $1', [user.id]);
  await db().query('DELETE FROM "account" WHERE "userId" = $1', [user.id]);
  await db().query('DELETE FROM "user" WHERE id = $1', [user.id]);
  return c.json({ deleted: true, backups: backups.rowCount ?? 0, shares: shares.rowCount ?? 0 });
});

app.get('/health', async (c) => {
  const result = { ok: true, postgres: 'unknown', storage: 'unknown' };
  try {
    const r = await db().query<{ v: string }>('SELECT version() AS v');
    result.postgres = `ok (${r.rows[0]?.v.split(' ').slice(0, 2).join(' ')})`;
  } catch (e) {
    result.ok = false;
    result.postgres = `error: ${(e as Error).message}`;
  }
  try {
    await storageHealth();
    result.storage = `ok (bucket "${env.bucket}")`;
  } catch (e) {
    result.ok = false;
    result.storage = `error: ${(e as Error).name}`;
  }
  return c.json(result, result.ok ? 200 : 503);
});

// ---------------------------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------------------------

app.post('/v1/backups', requireOwner, bodyLimit({ maxSize: 4 * 1024 * 1024, onError: (c) => c.json({ error: 'Backup too large (4 MB max).' }, 413) }), async (c) => {
  const body = await c.req.json<{ snapshot?: { format?: string; schemaVersion?: number }; recordCounts?: Record<string, number> }>().catch(() => null);
  if (!body?.snapshot || body.snapshot.format !== 'moveiq-export') return c.json({ error: 'Body must contain a MoveIQ export snapshot.' }, 400);
  const owner = c.get('owner');
  const id = randomUUID();
  const json = JSON.stringify(body.snapshot);
  const objectKey = `backups/${owner}/${id}.json`;
  // Object first, then the row: a failed insert leaves an orphan object at worst, never a row without data.
  await putObject(objectKey, json, 'application/json');
  try {
    const r = await db().query<{ created_at: Date }>(
      'INSERT INTO backups (id, device_key_hash, object_key, bytes, schema_version, record_counts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at',
      [id, owner, objectKey, Buffer.byteLength(json), body.snapshot.schemaVersion ?? null, JSON.stringify(body.recordCounts ?? {})],
    );
    return c.json({ id, createdAt: r.rows[0]!.created_at.toISOString(), bytes: Buffer.byteLength(json), recordCounts: body.recordCounts ?? {} }, 201);
  } catch (e) {
    await deleteObject(objectKey).catch(() => undefined);
    throw e;
  }
});

app.get('/v1/backups', requireOwner, async (c) => {
  const r = await db().query<{ id: string; created_at: Date; bytes: number; record_counts: Record<string, number> }>(
    'SELECT id, created_at, bytes, record_counts FROM backups WHERE device_key_hash = $1 ORDER BY created_at DESC LIMIT 50',
    [c.get('owner')],
  );
  return c.json({ backups: r.rows.map((b) => ({ id: b.id, createdAt: b.created_at.toISOString(), bytes: b.bytes, recordCounts: b.record_counts })) });
});

const UUID = /^[0-9a-f-]{36}$/;

app.get('/v1/backups/:id', requireOwner, async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) return c.json({ error: 'Not found.' }, 404);
  const r = await db().query<{ object_key: string }>('SELECT object_key FROM backups WHERE id = $1 AND device_key_hash = $2', [id, c.get('owner')]);
  const row = r.rows[0];
  if (!row) return c.json({ error: 'Not found.' }, 404);
  return c.json({ url: await presignGet(row.object_key, 600), expiresInSec: 600 });
});

app.delete('/v1/backups/:id', requireOwner, async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) return c.json({ error: 'Not found.' }, 404);
  const r = await db().query<{ object_key: string }>('DELETE FROM backups WHERE id = $1 AND device_key_hash = $2 RETURNING object_key', [id, c.get('owner')]);
  const row = r.rows[0];
  if (!row) return c.json({ error: 'Not found.' }, 404);
  await deleteObject(row.object_key);
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------------------------
// Share links (Strava-style public activity pages)
// ---------------------------------------------------------------------------------------------

interface ShareBody {
  kind?: string;
  title?: string;
  date?: string;
  stats?: { label?: unknown; value?: unknown }[];
  imagePngBase64?: string;
}

app.post('/v1/shares', requireOwner, bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'Share too large (2 MB max).' }, 413) }), async (c) => {
  const b = await c.req.json<ShareBody>().catch(() => null);
  if (!b || !['run', 'swim', 'workout'].includes(b.kind ?? '')) return c.json({ error: 'kind must be run, swim or workout.' }, 400);
  if (!b.title || typeof b.title !== 'string' || b.title.length > 120) return c.json({ error: 'title is required (max 120 chars).' }, 400);
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return c.json({ error: 'date must be YYYY-MM-DD.' }, 400);
  if (!Array.isArray(b.stats) || b.stats.length === 0 || b.stats.length > 12) return c.json({ error: 'stats must be 1–12 items.' }, 400);
  const stats = b.stats.map((s) => ({ label: String(s.label ?? '').slice(0, 40), value: String(s.value ?? '').slice(0, 60) }));

  const id = randomBytes(12).toString('base64url'); // 16 chars, unguessable
  let imageKey: string | null = null;
  if (b.imagePngBase64) {
    const bytes = Buffer.from(b.imagePngBase64, 'base64');
    const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) return c.json({ error: 'imagePngBase64 must be a PNG.' }, 400);
    imageKey = `shares/${id}.png`;
    await putObject(imageKey, bytes, 'image/png');
  }
  try {
    await db().query('INSERT INTO shares (id, device_key_hash, kind, title, activity_date, stats, image_key) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      id, c.get('owner'), b.kind, b.title, b.date, JSON.stringify(stats), imageKey,
    ]);
  } catch (e) {
    if (imageKey) await deleteObject(imageKey).catch(() => undefined);
    throw e;
  }
  return c.json({ id, url: `${origin(c)}/s/${id}` }, 201);
});

app.delete('/v1/shares/:id', requireOwner, async (c) => {
  const r = await db().query<{ image_key: string | null }>(
    'UPDATE shares SET revoked_at = now() WHERE id = $1 AND device_key_hash = $2 AND revoked_at IS NULL RETURNING image_key',
    [c.req.param('id') ?? '', c.get('owner')],
  );
  const row = r.rows[0];
  if (!row) return c.json({ error: 'Not found.' }, 404);
  if (row.image_key) await deleteObject(row.image_key);
  return c.json({ revoked: true });
});

async function activeShare(id: string) {
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(id)) return null;
  const r = await db().query<{ kind: string; title: string; activity_date: string; stats: { label: string; value: string }[]; image_key: string | null }>(
    "SELECT kind, title, to_char(activity_date, 'YYYY-MM-DD') AS activity_date, stats, image_key FROM shares WHERE id = $1 AND revoked_at IS NULL",
    [id],
  );
  return r.rows[0] ?? null;
}

app.get('/s/:id/image.png', async (c) => {
  const s = await activeShare(c.req.param('id') ?? '');
  if (!s?.image_key) return c.text('Not found', 404);
  const obj = await getObjectBytes(s.image_key);
  if (!obj) return c.text('Not found', 404);
  return c.body(obj.bytes as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=300' });
});

app.get('/s/:id', async (c) => {
  const id = c.req.param('id') ?? '';
  const s = await activeShare(id);
  if (!s) return c.html('<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:system-ui">This activity link is no longer available.</p>', 404);
  const base = origin(c);
  const img = s.image_key ? `${base}/s/${id}/image.png` : null;
  const statsText = s.stats.map((x) => `${x.value} ${x.label}`).join(' · ');
  const title = escapeHtml(`${s.title} · ${s.activity_date}`);
  return c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · MoveIQ</title>
<meta property="og:title" content="${title}"><meta property="og:description" content="${escapeHtml(statsText)}">
${img ? `<meta property="og:image" content="${escapeHtml(img)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<style>body{margin:0;background:#0A0F0C;color:#ECF3EF;font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center}
main{max-width:480px;width:100%;padding:24px 16px}img{width:100%;border-radius:16px}h1{font-size:22px}dl{display:grid;grid-template-columns:1fr 1fr;gap:12px}
dt{color:#97A59E;font-size:13px}dd{margin:0;font-size:18px;font-weight:700}footer{color:#97A59E;font-size:12px;margin-top:24px}</style></head>
<body><main>${img ? `<img src="${escapeHtml(img)}" alt="${title}">` : ''}<h1>${title}</h1>
<dl>${s.stats.map((x) => `<div><dt>${escapeHtml(x.label)}</dt><dd>${escapeHtml(x.value)}</dd></div>`).join('')}</dl>
<footer>Shared from MoveIQ. Values were entered by the athlete or calculated from their entries.</footer></main></body></html>`);
});

export default app;
