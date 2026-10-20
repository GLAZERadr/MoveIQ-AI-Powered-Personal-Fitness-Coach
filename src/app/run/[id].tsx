import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { fmtDistance, fmtRunPace, fmtRunPaceFromSecPerKm } from '../../data/format';
import { deleteRun, getRun } from '../../db/repos/activities';
import { getTrack } from '../../db/repos/gps';
import { simplifyForMap } from '../../domain/gps';
import { RouteMap } from '../../gps/RouteMap';
import { getProfile } from '../../db/repos/profile';
import { formatShortDate } from '../../domain/dates';
import { paceSecPerKm, splitConsistency } from '../../domain/running';
import { formatDuration } from '../../domain/units';
import { BarChart } from '../../ui/charts';
import { Button, Card, ErrorState, KeyValue, Loading, MetricCard, Row, Screen, SectionHeader, Title, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const q = useDbQuery(async (db) => ({ run: await getRun(db, id), profile: await getProfile(db), track: await getTrack(db, id) }), [id]);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const { run } = q.data;
  if (!run) return <Screen edges={[]}><ErrorState error={new Error('This run no longer exists.')} /></Screen>;
  const sys = q.data.profile?.unitSystem ?? 'metric';
  const dist = fmtDistance(run.distanceM, sys);
  const pace = fmtRunPace(run.durationSec, run.distanceM, sys);
  const consistency = splitConsistency(run.splits);

  return (
    <Screen edges={[]}>
      <Title subtitle={`${formatShortDate(run.localDate)}${run.startedAt ? ` · ${new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} · ${run.kind}`}>Run</Title>
      {q.data.track.length > 1 ? <RouteMap points={simplifyForMap(q.data.track)} height={240} /> : null}
      <Row>
        <MetricCard label="Distance" value={dist.value} unit={dist.unit} provenance={q.data.track.length > 1 ? 'calculated' : 'manual'} />
        <MetricCard label="Duration" value={formatDuration(run.durationSec)} provenance="manual" />
      </Row>
      <Row>
        <MetricCard label="Avg pace" value={pace.value} unit={pace.unit} provenance="calculated" sub="Duration ÷ distance" />
        {run.avgHr ? <MetricCard label="Avg heart rate" value={String(run.avgHr)} unit="bpm" provenance="manual" sub={run.maxHr ? `Max ${run.maxHr} bpm` : undefined} /> : null}
      </Row>
      <Card>
        {run.cadenceSpm ? <KeyValue label="Cadence" value={`${run.cadenceSpm} spm`} provenance="manual" /> : null}
        {run.elevationGainM != null ? <KeyValue label="Elevation gain" value={`${Math.round(run.elevationGainM)} m`} provenance="manual" /> : null}
        {run.rpe ? <KeyValue label="Perceived exertion" value={`${run.rpe}/10`} provenance="manual" /> : null}
        {run.notes ? <Text style={[font.body, { color: colors.text }]}>{run.notes}</Text> : null}
        {!run.cadenceSpm && run.elevationGainM == null && !run.rpe && !run.notes ? <Text style={[font.caption, { color: colors.textMuted }]}>No optional details recorded.</Text> : null}
      </Card>

      <SectionHeader title="Splits" />
      <Card>
        {run.splits.length === 0 ? (
          <Text style={[font.caption, { color: colors.textMuted }]}>No splits were recorded for this run, so only overall metrics are shown.</Text>
        ) : (
          <>
            <BarChart
              values={run.splits.map((s) => paceSecPerKm(s.durationSec, s.distanceM))}
              xLabels={run.splits.map((_, i) => String(i + 1))}
              yUnit="s/km"
              accessibilitySummary={`Pace per split. Fastest split ${consistency ? consistency.fastestIndex + 1 : 1}.`}
            />
            {run.splits.map((s, i) => (
              <KeyValue key={i} label={`Split ${i + 1} · ${fmtDistance(s.distanceM, sys).value} ${fmtDistance(s.distanceM, sys).unit}`}
                value={`${formatDuration(s.durationSec)} · ${fmtRunPaceFromSecPerKm(paceSecPerKm(s.durationSec, s.distanceM) ?? 0, sys)}`} />
            ))}
            {consistency ? (
              <>
                <KeyValue label="Pace variation (SD)" value={`±${Math.round(consistency.stdDevSecPerKm)} s/km`} provenance="calculated" />
                <KeyValue label="Second half vs first" value={`${consistency.halfDeltaSecPerKm <= 0 ? 'faster' : 'slower'} by ${Math.abs(Math.round(consistency.halfDeltaSecPerKm))} s/km`} provenance="calculated" />
              </>
            ) : null}
          </>
        )}
      </Card>
      <Button title="Share run" icon="share-social-outline" onPress={() => router.push({ pathname: '/share', params: { type: 'run', id } })} />
      <Button title="Edit" variant="secondary" icon="create-outline" onPress={() => router.push({ pathname: '/run/edit', params: { id } })} />
      <Button title="Delete" variant="danger" icon="trash-outline" onPress={async () => {
        if (await confirm('Delete this run?', 'This permanently removes the run and its splits.')) {
          await mutate((db) => deleteRun(db, id));
          router.back();
        }
      }} />
    </Screen>
  );
}
