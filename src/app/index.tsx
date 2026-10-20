import { Redirect } from 'expo-router';
import React from 'react';
import { useDbQuery } from '../data/DbProvider';
import { getProfile } from '../db/repos/profile';
import { ErrorState, Loading, Screen } from '../ui/components';

export default function Index() {
  const q = useDbQuery((db) => getProfile(db));
  if (q.status === 'loading') return <Loading />;
  if (q.status === 'error') return <Screen><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  return <Redirect href={q.data?.onboardedAt ? '/(tabs)/home' : '/onboarding'} />;
}
