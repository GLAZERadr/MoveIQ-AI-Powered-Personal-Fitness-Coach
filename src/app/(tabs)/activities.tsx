import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { useDbQuery } from '../../data/DbProvider';
import { fmtDistance, fmtRunPace, fmtRunPaceFromSecPerKm, fmtSwimDistance, fmtSwimPace } from '../../data/format';
import { listRuns, listSwims } from '../../db/repos/activities';
import { getProfile } from '../../db/repos/profile';
import { addDays, formatShortDate, todayLocal, weekStart } from '../../domain/dates';
import { runPersonalRecords, weeklyTotals } from '../../domain/running';
import { swimPersonalRecords } from '../../domain/swimming';
import { formatDuration, formatPace } from '../../domain/units';
import { BarChart } from '../../ui/charts';
import { Button, Card, EmptyState, ErrorState, KeyValue, ListItem, Loading, MetricCard, Row, Screen, SectionHeader, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

const WEEKS = 8;

export default function Activities() {
  const { colors, font } = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'run' | 'swim'>(params.tab === 'swim' ? 'swim' : 'run');
  // Follow navigation params (e.g. Home → "Swimming") by adjusting state during render, not in an effect.
  const [lastParam, setLastParam] = useState(params.tab);
  if (params.tab !== lastParam) {
    setLastParam(params.tab);
    if (params.tab === 'swim' || params.tab === 'run') setTab(params.tab);
  }
  const q = useDbQuery(async (db) => ({ profile: await getProfile(db), runs: await listRuns(db), swims: await listSwims(db) }));

  if (q.status === 'loading') return <Screen><Loading /></Screen>;
  if (q.status === 'error') return <Screen><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const sys = q.data.profile?.unitSystem ?? 'metric';
  const today = todayLocal();
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(weekStart(today), -7 * (WEEKS - 1 - i)));
  const items = tab === 'run' ? q.data.runs : q.data.swims;
  const totals = weeklyTotals(items);
  const byWeek = weeks.map((w) => totals.find((t) => t.weekStart === w));
  const thisWeek = byWeek[byWeek.length - 1];

  return (
    <Screen>
      <Title subtitle="Manually logged runs and swims">Activities</Title>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'run', label: 'Running' }, { value: 'swim', label: 'Swimming' }]} />
      <Button title={tab === 'run' ? 'Add run' : 'Add swim'} icon="add" onPress={() => router.push(tab === 'run' ? '/run/edit' : '/swim/edit')} />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={tab === 'run' ? 'walk-outline' : 'water-outline'} title={tab === 'run' ? 'No runs yet' : 'No swims yet'}
            message="Log a session with its distance and duration. Pace, weekly volume and records are calculated from your entries." />
        </Card>
      ) : (
        <>
          <Row>
            <MetricCard label="This week" provenance="calculated"
              value={tab === 'run' ? fmtDistance(thisWeek?.distanceM ?? 0, sys, 1).value : fmtSwimDistance(thisWeek?.distanceM ?? 0)}
              unit={tab === 'run' ? fmtDistance(0, sys).unit : undefined}
              sub={`${thisWeek?.count ?? 0} session${thisWeek?.count === 1 ? '' : 's'} · ${formatDuration(thisWeek?.durationSec ?? 0)}`} />
            <MetricCard label="Avg pace this week" provenance="calculated"
              value={thisWeek && thisWeek.distanceM > 0
                ? tab === 'run' ? fmtRunPace(thisWeek.durationSec, thisWeek.distanceM, sys).value : formatPace((thisWeek.durationSec / thisWeek.distanceM) * 100)
                : '–'}
              unit={tab === 'run' ? fmtRunPace(1, 1, sys).unit : '/100m'}
              sub="Total time ÷ total distance" />
          </Row>
          <Card>
            <Text style={[font.bodyStrong, { color: colors.text }]}>Weekly {tab === 'run' ? 'distance' : 'volume'} (last {WEEKS} weeks)</Text>
            <BarChart
              values={byWeek.map((t) => (t ? (tab === 'run' ? Number(fmtDistance(t.distanceM, sys).value) : t.distanceM) : 0))}
              xLabels={weeks.map((w) => formatShortDate(w))}
              yUnit={tab === 'run' ? fmtDistance(0, sys).unit : 'm'}
              formatY={(v) => (tab === 'run' ? v.toFixed(0) : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))}
              highlightLast
              accessibilitySummary={`Weekly ${tab === 'run' ? 'running distance' : 'swimming volume'} for the last ${WEEKS} weeks. This week: ${tab === 'run' ? fmtDistance(thisWeek?.distanceM ?? 0, sys).value + ' ' + fmtDistance(0, sys).unit : fmtSwimDistance(thisWeek?.distanceM ?? 0)}.`}
            />
          </Card>
          <SectionHeader title="Personal records" />
          <Card>
            {tab === 'run'
              ? runPersonalRecords(q.data.runs).map((r) => (
                  <KeyValue key={`${r.kind}${r.label}`} label={`${r.label} (${r.kind})`}
                    value={r.metric === 'pace' ? fmtRunPaceFromSecPerKm(r.value, sys) : r.metric === 'distance' ? `${fmtDistance(r.value, sys).value} ${fmtDistance(r.value, sys).unit}` : formatDuration(r.value)} />
                ))
              : swimPersonalRecords(q.data.swims).map((r) => (
                  <KeyValue key={`${r.environment}${r.stroke}${r.label}`} label={`${r.label} (${r.environment === 'pool' ? 'pool' : 'open water'}${r.stroke ? `, ${r.stroke}` : ''})`}
                    value={r.metric === 'pace' ? `${formatPace(r.value)} /100m` : fmtSwimDistance(r.value)} />
                ))}
            <Text style={[font.caption, { color: colors.textMuted }]}>Pace records are whole-activity averages for sessions at least that long. {tab === 'run' ? 'Outdoor, trail and treadmill runs are kept separate.' : 'Pool and open-water swims are kept separate.'}</Text>
          </Card>
          <SectionHeader title="Recent sessions" />
          <Card>
            {tab === 'run'
              ? q.data.runs.map((r) => (
                  <ListItem key={r.id} icon="walk-outline" title={`${fmtDistance(r.distanceM, sys).value} ${fmtDistance(r.distanceM, sys).unit} · ${r.kind}`}
                    subtitle={`${formatDuration(r.durationSec)} · ${fmtRunPace(r.durationSec, r.distanceM, sys).value}${fmtRunPace(r.durationSec, r.distanceM, sys).unit}${r.splits.length ? ` · ${r.splits.length} splits` : ''}`}
                    right={formatShortDate(r.localDate)} onPress={() => router.push(`/run/${r.id}`)} />
                ))
              : q.data.swims.map((s) => (
                  <ListItem key={s.id} icon="water-outline" title={`${fmtSwimDistance(s.distanceM)} · ${s.environment === 'pool' ? 'Pool' : 'Open water'}`}
                    subtitle={`${formatDuration(s.durationSec)} · ${fmtSwimPace(s.durationSec, s.distanceM)}${s.stroke ? ` · ${s.stroke}` : ''}`}
                    right={formatShortDate(s.localDate)} onPress={() => router.push(`/swim/${s.id}`)} />
                ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
