/**
 * Client for the optional MoveIQ cloud service (server/), which stores data in Neon Postgres and
 * Neon Object Storage. The app works fully without it; every call here is user-initiated.
 *
 * Identity: a random 256-bit device key kept in the OS keychain/keystore (expo-secure-store). The
 * server stores only its SHA-256 hash and scopes backups/shares to it. This is not a user account:
 * losing the device key means losing access to its backups (documented limitation).
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { authClient } from '../auth/authClient';
export { resolveApiUrl } from './config';

const KEY_NAME = 'moveiq.deviceKey.v1';

export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'offline' | 'timeout' | 'server' | 'rejected',
  ) {
    super(message);
  }
}

async function deviceKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  return key;
}

async function sessionCookieHeader(): Promise<Record<string, string>> {
  try {
    const cookie = await authClient.getCookie();
    return cookie ? { cookie } : {};
  } catch {
    return {};
  }
}

async function request<T>(baseUrl: string | null, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  if (!baseUrl) throw new CloudError('Cloud service is not configured. Set its URL in Profile → Cloud.', 'not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      // When signed in, the Better Auth session cookie identifies the account (backups follow the user
      // across devices); the device key remains the fallback owner when signed out.
      headers: { 'content-type': 'application/json', 'x-device-key': await deviceKey(), ...(await sessionCookieHeader()), ...(init.headers ?? {}) },
      credentials: 'omit',
    });
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    throw new CloudError(aborted ? 'The cloud service did not respond in time.' : 'Could not reach the cloud service. Check your connection.', aborted ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `Server error (${res.status})`;
    throw new CloudError(msg, res.status >= 500 ? 'server' : 'rejected');
  }
  return json as T;
}

export interface BackupInfo {
  id: string;
  createdAt: string;
  bytes: number;
  recordCounts: Record<string, number>;
}

export const cloud = {
  health: (base: string | null) => request<{ ok: boolean; postgres: string; storage: string }>(base, '/health', { method: 'GET' }),
  uploadBackup: (base: string | null, snapshot: unknown, recordCounts: Record<string, number>) =>
    request<BackupInfo>(base, '/v1/backups', { method: 'POST', body: JSON.stringify({ snapshot, recordCounts }), timeoutMs: 60000 }),
  listBackups: (base: string | null) => request<{ backups: BackupInfo[] }>(base, '/v1/backups', { method: 'GET' }),
  downloadBackupUrl: (base: string | null, id: string) => request<{ url: string; expiresInSec: number }>(base, `/v1/backups/${encodeURIComponent(id)}`, { method: 'GET' }),
  deleteBackup: (base: string | null, id: string) => request<{ deleted: boolean }>(base, `/v1/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createShare: (base: string | null, payload: SharePayload) =>
    request<{ id: string; url: string }>(base, '/v1/shares', { method: 'POST', body: JSON.stringify(payload), timeoutMs: 45000 }),
  revokeShare: (base: string | null, id: string) => request<{ revoked: boolean }>(base, `/v1/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export interface SharePayload {
  kind: 'run' | 'swim' | 'workout';
  title: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  stats: { label: string; value: string }[];
  /** Optional PNG of the share card (base64, no data: prefix), max ~1.5 MB. */
  imagePngBase64?: string;
}
