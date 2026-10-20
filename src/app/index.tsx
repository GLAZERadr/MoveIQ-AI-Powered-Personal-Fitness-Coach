import { Redirect } from 'expo-router';
import React from 'react';
import { useDbQuery } from '../data/DbProvider';
import { getProfile } from '../db/repos/profile';
import { ErrorState, Loading, Screen } from '../ui/components';

export default function Index() {
  const q = useDbQuery(async (db) => ({
    profile: await getProfile(db),
    welcomeSeen: !!(await db.first<{ value: string }>("SELECT value FROM app_settings WHERE key = 'welcomeSeen'")),
  }));
  if (q.status === 'loading') return <Loading />;
  if (q.status === 'error') return <Screen><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  // Everyone sees the sign-in screen once (also existing users after this update).
  if (!q.data.welcomeSeen) return <Redirect href="/welcome" />;
  return <Redirect href={q.data.profile?.onboardedAt ? '/(tabs)/home' : '/onboarding'} />;
}
