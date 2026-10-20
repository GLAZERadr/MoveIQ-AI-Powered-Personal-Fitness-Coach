import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID. Generated client-side so retried writes reuse the same id (idempotent inserts). */
export function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : Crypto.randomUUID();
}

export const nowIso = () => new Date().toISOString();
