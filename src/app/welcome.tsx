import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { PROVIDER_LABEL, signInWith, useProviders } from '../auth/social';
import { useDb } from '../data/DbProvider';
import { getProfile } from '../db/repos/profile';
import { Button, Loading, Notice, Screen } from '../ui/components';
import { useTheme } from '../ui/theme';
import type { SocialProvider } from '../auth/authClient';

const LOGO = require('../../assets/logo.png');

/** Sign in / sign up. Social sign-in creates the account on first use, so one screen does both. */
export default function Welcome() {
  const { colors, font } = useTheme();
  const db = useDb();
  const providers = useProviders();
  const [busy, setBusy] = useState<SocialProvider | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function proceed() {
    await db.run("INSERT INTO app_settings (key, value) VALUES ('welcomeSeen', 'true') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const profile = await getProfile(db);
    router.replace(profile?.onboardedAt ? '/(tabs)/home' : '/onboarding');
  }

  async function signIn(p: SocialProvider) {
    setBusy(p);
    setError(null);
    const r = await signInWith(p);
    setBusy(null);
    if (r.ok) await proceed();
    else if (!r.cancelled) setError(r.error);
  }

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <View style={{ alignItems: 'center', gap: 8 }} accessible accessibilityLabel="MoveIQ. Train smarter. Live stronger.">
          <Image source={LOGO} style={{ width: 104, height: 104, borderRadius: 26 }} />
          <Text style={[font.heading, { color: colors.text, fontSize: 32, lineHeight: 38 }]}>MoveIQ</Text>
          <Text style={[font.body, { color: colors.textMuted }]}>Train Smarter. Live Stronger.</Text>
        </View>
        <View style={{ gap: 12 }}>
          <Text style={[font.title, { color: colors.text, textAlign: 'center' }]}>Sign in or create an account</Text>
          <Text style={[font.caption, { color: colors.textMuted, textAlign: 'center' }]}>
            New here? Continuing with Google or GitHub creates your MoveIQ account automatically. No password needed.
          </Text>
          {providers.status === 'loading' ? (
            <Loading />
          ) : providers.status === 'offline' ? (
            <Notice tone="warning">You’re offline, so sign-in isn’t available right now. You can continue without an account and sign in later from Profile.</Notice>
          ) : (
            providers.providers.map((p) => (
              <Button key={p} title={PROVIDER_LABEL[p].title} icon={PROVIDER_LABEL[p].icon} loading={busy === p} disabled={busy != null} onPress={() => signIn(p)} />
            ))
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button title="Continue without an account" variant="ghost" disabled={busy != null} onPress={async () => {
            setBusy('skip');
            await proceed();
          }} />
        </View>
        <Text style={[font.caption, { color: colors.textMuted, textAlign: 'center' }]}>
          Your workouts, food and activities are stored on this phone. By continuing you agree to the Terms and Privacy Policy at moveiq-api.vercel.app.
        </Text>
      </View>
    </Screen>
  );
}
