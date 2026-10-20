import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { fmtSwimDistance, fmtSwimPace } from '../../data/format';
import { deleteSwim, getSwim } from '../../db/repos/activities';
import { formatShortDate } from '../../domain/dates';
import { checkPoolDistance } from '../../domain/swimming';
import { formatDuration } from '../../domain/units';
import { Button, Card, ErrorState, KeyValue, Loading, MetricCard, Notice, Row, Screen, Title, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export default function SwimDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const q = useDbQuery((db) => getSwim(db, id), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const s = q.data;
  if (!s) return <Screen edges={[]}><ErrorState error={new Error('This swim no longer exists.')} /></Screen>;
  const check = checkPoolDistance(s);

  return (
    <Screen edges={[]}>
      <Title subtitle={`${formatShortDate(s.localDate)} · ${s.environment === 'pool' ? 'Pool' : 'Open water'}`}>Swim</Title>
      <Row>
        <MetricCard label="Distance" value={fmtSwimDistance(s.distanceM)} provenance="manual" />
        <MetricCard label="Duration" value={formatDuration(s.durationSec)} provenance="manual" />
      </Row>
      <MetricCard label={`Avg pace${s.environment === 'open_water' ? ' (open water)' : ' (pool)'}`} value={fmtSwimPace(s.durationSec, s.distanceM)} provenance="calculated" sub="Duration ÷ distance × 100" />
      <Card>
        {s.poolLengthM != null ? <KeyValue label="Pool length" value={s.poolLengthUnit === 'yd' ? `${Math.round(s.poolLengthM / 0.9144)} yd` : `${s.poolLengthM} m`} provenance="manual" /> : null}
        {s.laps != null ? <KeyValue label="Lengths" value={String(s.laps)} provenance="manual" /> : null}
        {s.stroke ? <KeyValue label="Stroke" value={s.stroke} provenance="manual" /> : null}
        {s.avgHr ? <KeyValue label="Avg heart rate" value={`${s.avgHr} bpm`} provenance="manual" /> : null}
        {s.rpe ? <KeyValue label="Perceived exertion" value={`${s.rpe}/10`} provenance="manual" /> : null}
        {s.notes ? <Text style={[font.body, { color: colors.text }]}>{s.notes}</Text> : null}
      </Card>
      {check.status === 'inconsistent' ? <Notice tone="warning">{`Lengths × pool length = ${Math.round(check.expectedM)} m, which differs from the recorded distance by ${Math.round(Math.abs(check.diffM))} m.`}</Notice> : null}
      <Button title="Share swim" icon="share-social-outline" onPress={() => router.push({ pathname: '/share', params: { type: 'swim', id } })} />
      <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/swim/edit', params: { id } })} />
      <Button title="Delete" variant="danger" icon="trash-outline" onPress={async () => {
        if (await confirm('Delete this swim?', 'This permanently removes the swim.')) {
          await mutate((db) => deleteSwim(db, id));
          router.back();
        }
      }} />
    </Screen>
  );
}
