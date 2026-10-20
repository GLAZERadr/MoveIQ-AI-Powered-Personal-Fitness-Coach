# Cloud service (Neon + Vercel)

**Production:** https://moveiq-api.vercel.app (Vercel project `moveiq-api`, team *adrian glazer's projects*). This is the app's default `extra.apiUrl`.

The mobile app is offline-first and fully usable without this service. It powers two optional, user-initiated features:

1. **Cloud backup**: uploads the same JSON as *Export data* (pose landmarks excluded).
2. **Share links**: a Strava-style public page `/s/<id>` with the activity summary card image and stats.

## Neon resources

- Project `autumn-term-24911124`, org `org-royal-glade-73080934`, branch `production`.
- `neon.ts` declares Object Storage bucket `assets` (private). `neon deploy` applies it and writes `.env.local`:
  - `DATABASE_URL` (pooled, `-pooler` host): app queries
  - `DATABASE_URL_UNPOOLED` (direct): migrations
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`: Object Storage
- Region: AWS us-east-2 (Object Storage supported).

## Drivers (per the Neon agent skills)

- **Postgres**: `pg` (node-postgres) `Pool`, max 5, on the pooled URL. The service is a long-running Node process; no session state is used, so PgBouncer transaction mode is safe. Migrations use a single `pg.Client` on the direct URL.
- **Object Storage**: `@aws-sdk/client-s3` with `forcePathStyle: true` (required by Neon). Credentials and endpoint come from the standard AWS env chain. Downloads use presigned GET URLs (10 min), so the bucket stays private.

## Schema (`server/migrate.ts`)

- `backups(id uuid, device_key_hash, object_key, bytes, schema_version, record_counts jsonb, created_at)`
- `shares(id text, device_key_hash, kind, title, activity_date, stats jsonb, image_key, created_at, revoked_at)`

The object is written before the row. If the insert fails, the object is deleted, so there's never a row without data.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | `SELECT version()` + `HeadBucket` |
| POST | `/v1/backups` | device key | Store a snapshot (≤ 4 MB, Vercel request limit 4.5 MB) |
| GET | `/v1/backups` | device key | List own backups |
| GET | `/v1/backups/:id` | device key | Presigned download URL |
| DELETE | `/v1/backups/:id` | device key | Delete row and object |
| POST | `/v1/shares` | device key | Create a share (stats + optional PNG ≤ 2 MB, magic bytes checked) |
| DELETE | `/v1/shares/:id` | device key | Revoke (deletes image) |
| GET | `/s/:id`, `/s/:id/image.png` | public | Share page (HTML-escaped, Open Graph tags) and image |

**Identity:** the app generates a random 256-bit key, stores it in the Keychain/Keystore (`expo-secure-store`, this device only), and sends it as `x-device-key`. The server stores only the SHA-256. This scopes data per device but **is not user authentication**: there's no account recovery or cross-device restore. Before a public deployment, add Neon Auth, rate limiting, and a deployed HTTPS origin (`PUBLIC_BASE_URL`).

## Deploying to Vercel

`server/` is a standalone package and its own Vercel project. Vercel's zero-config Hono support uses `server/app.ts` (`export default app`) as the entry, running on Fluid compute. `local.ts` is only for local runs.

- **Env vars** (production, marked sensitive): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, all copied from Neon's `.env.local`. If you rotate credentials in Neon, update them in Vercel too.
- **Pooling:** `attachDatabasePool(pool)` from `@vercel/functions` releases idle connections before an instance suspends (Neon's guidance for Vercel).
- **Migrations** are not run on cold start. Apply schema changes with `npm run db:migrate` (direct URL) before deploying code that needs them.
- **Limits:** Vercel caps request bodies at 4.5 MB, so backups are capped at 4 MB. Larger backups would need presigned direct-to-storage uploads.

Deploy:

```bash
npm run deploy:api
```

## Run and verify

```bash
npm run build:server
```

```bash
npm run server:start
```

```bash
npm run smoke:server
```

Against production:

```bash
SMOKE_URL=https://moveiq-api.vercel.app npm run smoke:server
```

The smoke test exercises health, auth rejection, backup upload/list/download round-trip, cross-device isolation, share create/page/image, revoke and delete against the real Neon services.
