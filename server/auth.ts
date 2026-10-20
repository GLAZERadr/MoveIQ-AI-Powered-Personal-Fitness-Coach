/**
 * Sign-in with Google and GitHub for the mobile app.
 *
 * Better Auth (self-managed, on this Vercel API) with users/sessions stored in Neon Postgres.
 * Neon's Managed Auth documents only browser redirect flows; Better Auth's official Expo plugin
 * covers the native flow: system browser for OAuth → deep link `moveiq://` back into the app →
 * session cookie kept in the phone's secure storage and sent to this API on each request.
 *
 * Provider redirect URIs to register: {BETTER_AUTH_URL}/api/auth/callback/{google|github}
 */
import { expo } from '@better-auth/expo';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type pg from 'pg';
import { db } from './db.js';

export const APP_SCHEME = 'moveiq';

function socialProviders(): BetterAuthOptions['socialProviders'] {
  const p: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) p.google = { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) p.github = { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET };
  return p;
}

export function enabledProviders(): string[] {
  return Object.keys(socialProviders() ?? {});
}

export function authOptions(pool: pg.Pool): BetterAuthOptions {
  return {
    database: pool,
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    socialProviders: socialProviders(),
    // Sign-in is social-only; no passwords are stored.
    emailAndPassword: { enabled: false },
    trustedOrigins: [`${APP_SCHEME}://`],
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    plugins: [expo()],
  };
}

let instance: ReturnType<typeof betterAuth> | null = null;

export function auth() {
  if (!instance) {
    if (!process.env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set.');
    instance = betterAuth(authOptions(db()));
  }
  return instance;
}

/** The signed-in user for a request, or null (also null when auth isn't configured). */
export async function sessionUser(headers: Headers): Promise<{ id: string; email: string; name: string } | null> {
  if (!process.env.BETTER_AUTH_SECRET) return null;
  const s = await auth().api.getSession({ headers });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
}
