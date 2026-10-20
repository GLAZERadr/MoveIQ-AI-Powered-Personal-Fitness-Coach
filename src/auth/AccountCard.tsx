import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_API_URL, resolveApiUrl } from '../cloud/config';
import { Button, Card, Notice } from '../ui/components';
import { useTheme } from '../ui/theme';
import { SocialProvider, authClient } from './authClient';

const LABEL: Record<SocialProvider, { title: string; icon: 'logo-google' | 'logo-github' }> = {
  google: { title: 'Continue with Google', icon: 'logo-google' },
  github: { title: 'Continue with GitHub', icon: 'logo-github' },
};

type ProvidersState = { status: 'loading' } | { status: 'ready'; providers: SocialProvider[] } | { status: 'offline' };

function useProviders(): ProvidersState {
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
 * Optional account. Signing in is never required: all training data stays on the device either way.
 * When signed in, cloud backups belong to the account, so they can be listed from any phone.
 */
export function AccountCard() {
  const { colors, font } = useTheme();
  const session = authClient.useSession();
  const providers = useProviders();
  const [busy, setBusy] = useState<SocialProvider | 'signout' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: SocialProvider) {
    setBusy(provider);
    setError(null);
    try {
      const res = await authClient.signIn.social({ provider, callbackURL: '/' });
      if (res.error) setError(res.error.message ?? 'Sign-in failed.');
      // On native, the session is stored by the Expo plugin; refresh our view of it.
      await session.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy('signout');
    try {
      await authClient.signOut();
      await session.refetch();
    } finally {
      setBusy(null);
    }
  }

  const user = session.data?.user;
  return (
    <Card>
      {user ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="person-circle-outline" size={36} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[font.bodyStrong, { color: colors.text }]}>{user.name || 'Signed in'}</Text>
              <Text style={[font.caption, { color: colors.textMuted }]}>{user.email}</Text>
            </View>
          </View>
          <Text style={[font.caption, { color: colors.textMuted }]}>Cloud backups and share links now belong to this account. Your training data still lives on this phone.</Text>
          <Button title="Sign out" variant="secondary" loading={busy === 'signout'} onPress={signOut} />
        </>
      ) : (
        <>
          <Text style={[font.body, { color: colors.text }]}>Sign in to keep cloud backups with your account and restore them on a new phone. Optional: everything works without an account.</Text>
          {session.isPending || providers.status === 'loading' ? null : providers.status === 'offline' ? (
            <Notice tone="warning">Can’t reach the sign-in service. Check your connection.</Notice>
          ) : providers.providers.length === 0 ? (
            <Notice>Sign-in isn’t set up on the server yet.</Notice>
          ) : (
            providers.providers.map((p) => (
              <Button key={p} title={LABEL[p].title} icon={LABEL[p].icon} variant="secondary" loading={busy === p} disabled={busy != null} onPress={() => signIn(p)} />
            ))
          )}
        </>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Card>
  );
}
