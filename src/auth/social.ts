import { useEffect, useState } from 'react';
import { DEFAULT_API_URL, resolveApiUrl } from '../cloud/config';
import { SocialProvider, authClient } from './authClient';

export const PROVIDER_LABEL: Record<SocialProvider, { title: string; icon: 'logo-google' | 'logo-github' }> = {
  google: { title: 'Continue with Google', icon: 'logo-google' },
  github: { title: 'Continue with GitHub', icon: 'logo-github' },
};

export type ProvidersState = { status: 'loading' } | { status: 'ready'; providers: SocialProvider[] } | { status: 'offline' };

/** Which providers the server has configured (so we never show a button that can't work). */
export function useProviders(): ProvidersState {
  const [state, setState] = useState<ProvidersState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`${resolveApiUrl('') ?? DEFAULT_API_URL}/v1/auth/providers`)
      .then((r) => r.json() as Promise<{ providers: string[] }>)
      .then((j) => !cancelled && setState({ status: 'ready', providers: j.providers.filter((p): p is SocialProvider => p === 'google' || p === 'github') }))
      .catch(() => !cancelled && setState({ status: 'offline' }));
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * Social sign-in. There is no separate sign-up: the first sign-in with a Google/GitHub account
 * creates the MoveIQ account automatically.
 */
export async function signInWith(provider: SocialProvider): Promise<{ ok: true } | { ok: false; error: string; cancelled?: boolean }> {
  try {
    const res = await authClient.signIn.social({ provider, callbackURL: '/' });
    if (res.error) return { ok: false, error: res.error.message ?? 'Sign-in failed.' };
    const s = await authClient.getSession();
    if (!s.data?.user) return { ok: false, error: 'Sign-in was cancelled.', cancelled: true };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The signed-in account's display name (used to pre-fill onboarding), or null. */
export function useAccountName(): string | null {
  const s = authClient.useSession();
  return s.data?.user?.name ?? null;
}
