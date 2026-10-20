import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_API_URL, resolveApiUrl } from '../cloud/config';
import { Button, Card, Notice, confirm } from '../ui/components';
import { useTheme } from '../ui/theme';
import { SocialProvider, authClient } from './authClient';
import { PROVIDER_LABEL as LABEL, signInWith, useProviders } from './social';

/**
 * Optional account. Signing in is never required: all training data stays on the device either way.
 * When signed in, share links belong to the account.
 */
export function AccountCard() {
  const { colors, font } = useTheme();
  const session = authClient.useSession();
  const providers = useProviders();
  const [busy, setBusy] = useState<SocialProvider | 'signout' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: SocialProvider) {
    setBusy(provider);
    setError(null);
    const r = await signInWith(provider);
    if (!r.ok && !r.cancelled) setError(r.error);
    await session.refetch();
    setBusy(null);
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

  async function deleteAccount() {
    if (!(await confirm('Delete your account?', 'This permanently deletes your MoveIQ account and the share links it owns. Data on this phone is kept.', 'Delete account'))) return;
    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`${resolveApiUrl('') ?? DEFAULT_API_URL}/v1/me`, {
        method: 'DELETE',
        headers: { cookie: await authClient.getCookie() },
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Server error (${res.status})`);
      await authClient.signOut().catch(() => undefined);
      await session.refetch();
    } catch (e) {
      setError(`Could not delete the account: ${(e as Error).message}`);
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
          <Text style={[font.caption, { color: colors.textMuted }]}>Share links you create belong to this account. Your training data lives on this phone.</Text>
          <Button title="Sign out" variant="secondary" loading={busy === 'signout'} disabled={busy != null} onPress={signOut} />
          <Button title="Delete account" variant="ghost" loading={busy === 'delete'} disabled={busy != null} onPress={deleteAccount} />
        </>
      ) : (
        <>
          <Text style={[font.body, { color: colors.text }]}>Sign in or create an account with Google or GitHub. Optional: everything works without an account.</Text>
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
