/**
 * End-to-end check against a RUNNING server (npm run server:start), exercising Neon Postgres and
 * Neon Object Storage for real: health → backup upload/list/download/delete → share create/view/image/revoke.
 * Usage: SMOKE_URL=http://localhost:8787 npm run smoke:server
 */
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.SMOKE_URL ?? 'http://localhost:8787';
const deviceKey = randomBytes(32).toString('hex');
const headers = { 'content-type': 'application/json', 'x-device-key': deviceKey };

async function call(method: string, path: string, body?: unknown, h: Record<string, string> = headers) {
  const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, any>, text, res };
}

function step(name: string, detail: string) {
  console.log(`✔ ${name.padEnd(34)} ${detail}`);
}

// A tiny valid 1×1 PNG.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const health = await call('GET', '/health');
assert.equal(health.status, 200, `health failed: ${health.text}`);
step('GET /health', `postgres=${health.json.postgres} | storage=${health.json.storage}`);

const unauth = await call('GET', '/v1/backups', undefined, { 'content-type': 'application/json' });
assert.equal(unauth.status, 401);
step('rejects missing device key', '401');

const snapshot = { format: 'moveiq-export', schemaVersion: 1, exportedAt: new Date().toISOString(), tables: { body_weight_entries: [{ id: 'w1', weight_kg: 72.4 }] } };
const up = await call('POST', '/v1/backups', { snapshot, recordCounts: { body_weight_entries: 1 } });
assert.equal(up.status, 201, up.text);
step('POST /v1/backups (S3 put + PG insert)', `id=${up.json.id} bytes=${up.json.bytes}`);

const list = await call('GET', '/v1/backups');
assert.equal(list.json.backups.length, 1);
step('GET /v1/backups (PG select)', `${list.json.backups.length} backup(s)`);

const dl = await call('GET', `/v1/backups/${up.json.id}`);
assert.equal(dl.status, 200);
const object = await fetch(dl.json.url);
const roundTrip = (await object.json()) as typeof snapshot;
assert.deepEqual(roundTrip, snapshot);
step('presigned GET from Object Storage', `content round-trips (${object.status})`);

const other = await call('GET', `/v1/backups/${up.json.id}`, undefined, { 'x-device-key': randomBytes(32).toString('hex') });
assert.equal(other.status, 404);
step('other device cannot read backup', '404');

const share = await call('POST', '/v1/shares', { kind: 'run', title: 'Morning run', date: '2026-04-22', stats: [{ label: 'km', value: '8.0' }, { label: 'Pace', value: '6:02 /km' }], imagePngBase64: PNG_1PX });
assert.equal(share.status, 201, share.text);
step('POST /v1/shares (S3 PNG + PG row)', share.json.url);

const page = await fetch(share.json.url);
const html = await page.text();
assert.equal(page.status, 200);
assert.match(html, /Morning run/);
assert.match(html, /og:image/);
step('GET public share page', `${page.status}, ${html.length} bytes HTML with og:image`);

const img = await fetch(`${share.json.url}/image.png`);
const imgBytes = Buffer.from(await img.arrayBuffer());
assert.equal(img.status, 200);
assert.equal(imgBytes.toString('base64'), PNG_1PX);
step('GET share image (from Object Storage)', `${imgBytes.length} bytes, identical`);

const revoke = await call('DELETE', `/v1/shares/${share.json.id}`);
assert.equal(revoke.status, 200);
const gone = await fetch(share.json.url);
assert.equal(gone.status, 404);
step('DELETE share → page 404', `${gone.status}`);

const del = await call('DELETE', `/v1/backups/${up.json.id}`);
assert.equal(del.status, 200);
const after = await fetch(dl.json.url);
assert.notEqual(after.status, 200);
step('DELETE backup (PG + S3)', `object now ${after.status}`);

console.log('\nAll cloud service checks passed.');
