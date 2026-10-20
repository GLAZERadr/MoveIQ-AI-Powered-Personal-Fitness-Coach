import React, { useState } from 'react';
import { Text } from 'react-native';
import { useDbQuery } from '../../data/DbProvider';
import { fmtDistance, fmtRunPaceFromSecPerKm, fmtSwimDistance, fmtWeight } from '../../data/format';
import { listMeasurements, listWeights } from '../../db/repos/body';
import { listRuns, listSwims } from '../../db/repos/activities';
import { getProfile } from '../../db/repos/profile';
import { listSessions, personalRecords, repTrends } from '../../db/repos/workouts';
import { dailyWeights } from '../../domain/cutting';
import { addDays, formatShortDate, todayLocal, weekStart } from '../../domain/dates';
import { paceSecPerKm, paceVsHeartRate, weeklyTotals } from '../../domain/running';
import { pacePer100m, strokeComparison } from '../../domain/swimming';
import { displayWeight, formatDuration, formatPace, METERS_PER_MILE } from '../../domain/units';
import { getExercise, setUnit } from '../../motion/exercises';
import { BarChart, LineChart } from '../../ui/charts';
import { Card, ErrorState, KeyValue, Loading, Screen, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

type Tab = 'overview' | 'strength' | 'running' | 'swimming' | 'body';

export default function Progress() {
  const { colors, font } = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [weeks, setWeeks] = useState<'4' | '12'>('12');
  const today = todayLocal();
  const nWeeks = Number(weeks);
  const from = addDays(weekStart(today), -7 * (nWeeks - 1));
  const q = useDbQuery(async (db) => ({
    profile: await getProfile(db),
    sessions: await listSessions(db, { from }),
    trends: await repTrends(db, from),
    prs: await personalRecords(db),
    runs: await listRuns(db, from),
    swims: await listSwims(db, from),
    weights: await listWeights(db, from),
    waist: await listMeasurements(db, 'waist'),
  }), [from]);

  const weekKeys = Array.from({ length: nWeeks }, (_, i) => addDays(from, i * 7));
  const wLabels = weekKeys.map((w) => formatShortDate(w));

  return (
    <Screen>
      <Title subtitle="Trends from your recorded data">Progress</Title>
      <Segmented value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'Overview' }, { value: 'strength', label: 'Strength' }, { value: 'running', label: 'Run' }, { value: 'swimming', label: 'Swim' }, { value: 'body', label: 'Body' },
      ]} />
      <Segmented value={weeks} onChange={setWeeks} options={[{ value: '4', label: '4 weeks' }, { value: '12', label: '12 weeks' }]} />
      {q.status === 'loading' ? <Loading /> : q.status === 'error' ? <ErrorState error={q.error} onRetry={q.reload} /> : (() => {
        const d = q.data;
        const sys = d.profile?.unitSystem ?? 'metric';
        const perWeek = <T extends { localDate: string }>(xs: T[], f: (items: T[]) => number) => weekKeys.map((w) => f(xs.filter((x) => weekStart(x.localDate) === w)));

        if (tab === 'overview') {
          const activeDays = weekKeys.map((w) => new Set([...d.sessions, ...d.runs, ...d.swims].filter((x) => weekStart(x.localDate) === w).map((x) => x.localDate)).size);
          const thisMonth = today.slice(0, 7);
          const month = <T extends { localDate: string }>(xs: T[]) => xs.filter((x) => x.localDate.startsWith(thisMonth));
          return (
            <>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Training consistency (active days per week)</Text>
                <BarChart values={activeDays} xLabels={wLabels} yUnit="days" highlightLast accessibilitySummary={`Active days per week. This week ${activeDays.at(-1)} days.`} emptyMessage="No training recorded in this period." />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>This month</Text>
                <KeyValue label="Workouts" value={`${month(d.sessions).length} · ${month(d.sessions).reduce((a, s) => a + s.totalReps, 0)} reps`} />
                <KeyValue label="Running" value={`${month(d.runs).length} · ${fmtDistance(month(d.runs).reduce((a, r) => a + r.distanceM, 0), sys, 1).value} ${fmtDistance(0, sys).unit}`} />
                <KeyValue label="Swimming" value={`${month(d.swims).length} · ${fmtSwimDistance(month(d.swims).reduce((a, s) => a + s.distanceM, 0))}`} />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>This week</Text>
                {(() => {
                  const ws = weekStart(today);
                  const wk = <T extends { localDate: string }>(xs: T[]) => xs.filter((x) => x.localDate >= ws);
                  const dw = dailyWeights(d.weights);
                  const thisW = dw.filter((x) => x.localDate >= ws);
                  return (
                    <>
                      <KeyValue label="Workouts" value={String(wk(d.sessions).length)} />
                      <KeyValue label="Run distance" value={`${fmtDistance(wk(d.runs).reduce((a, r) => a + r.distanceM, 0), sys, 1).value} ${fmtDistance(0, sys).unit}`} />
                      <KeyValue label="Swim distance" value={fmtSwimDistance(wk(d.swims).reduce((a, s) => a + s.distanceM, 0))} />
                      <KeyValue label="Weigh-ins" value={String(thisW.length)} />
                    </>
                  );
                })()}
              </Card>
            </>
          );
        }

        if (tab === 'strength') {
          const exIds = [...new Set(d.trends.map((t) => t.exerciseId))];
          const dates = [...new Set(d.trends.map((t) => t.localDate))].sort();
          return (
            <>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Best set per workout (reps)</Text>
                <LineChart
                  series={exIds.map((id, i) => ({ label: `${getExercise(id)?.name ?? id}${setUnit(id) === 's' ? ' (s)' : ''}`, color: [colors.primary, colors.info, colors.warning, colors.danger, colors.chartSecondary, colors.text][i % 6],
                    values: dates.map((dt) => d.trends.find((t) => t.localDate === dt && t.exerciseId === id)?.bestSetReps ?? null) }))}
                  xLabels={dates.map(formatShortDate)} yUnit="reps" formatY={(v) => String(Math.round(v))}
                  emptyMessage="Complete a workout to see repetition trends." accessibilitySummary="Best set repetitions per workout over time." />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Total reps per week</Text>
                <BarChart values={perWeek(d.sessions, (xs) => xs.reduce((a, s) => a + s.totalReps, 0))} xLabels={wLabels} yUnit="reps" highlightLast accessibilitySummary="Total repetitions per week." />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Personal records</Text>
                {d.prs.length === 0 ? <Text style={[font.caption, { color: colors.textMuted }]}>None yet.</Text> : d.prs.map((p) => <KeyValue key={p.exerciseId} label={`${p.name} (most reps in a set)`} value={`${p.reps} · ${formatShortDate(p.localDate)}`} />)}
              </Card>
            </>
          );
        }

        if (tab === 'running') {
          const runs = [...d.runs].sort((a, b) => a.localDate.localeCompare(b.localDate));
          const toUnit = (spk: number | null) => (spk == null ? null : sys === 'imperial' ? spk * (METERS_PER_MILE / 1000) : spk);
          const hr = paceVsHeartRate(runs);
          const wt = weeklyTotals(runs);
          return (
            <>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Average pace per run</Text>
                <LineChart
                  series={(['outdoor', 'treadmill', 'trail'] as const).filter((k) => runs.some((r) => r.kind === k)).map((k, i) => ({
                    label: k, color: [colors.primary, colors.info, colors.warning][i], values: runs.map((r) => (r.kind === k ? toUnit(paceSecPerKm(r.durationSec, r.distanceM)) : null)),
                  }))}
                  xLabels={runs.map((r) => formatShortDate(r.localDate))} yUnit={sys === 'imperial' ? 'min/mi' : 'min/km'} formatY={(v) => formatPace(v)}
                  emptyMessage="Log runs to see pace trends." accessibilitySummary="Average pace for each run. Lower is faster." />
                <Text style={[font.caption, { color: colors.textMuted }]}>Lower is faster. Run types are plotted separately because they aren’t directly comparable.</Text>
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Weekly distance</Text>
                <BarChart values={weekKeys.map((w) => { const t = wt.find((x) => x.weekStart === w); return t ? Number(fmtDistance(t.distanceM, sys).value) : 0; })}
                  xLabels={wLabels} yUnit={fmtDistance(0, sys).unit} highlightLast accessibilitySummary="Weekly running distance." />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Pace vs heart rate</Text>
                {hr.length < 2 ? (
                  <Text style={[font.caption, { color: colors.textMuted }]}>Shown when at least two runs have an average heart rate recorded.</Text>
                ) : (
                  <>
                    <LineChart series={[{ label: 'Meters per heartbeat', values: hr.map((p) => p.metersPerBeat) }]} xLabels={hr.map((p) => formatShortDate(p.localDate))} yUnit="m/beat"
                      formatY={(v) => v.toFixed(2)} accessibilitySummary="Distance covered per heartbeat for each run with heart-rate data. Higher means more distance at the same effort." />
                    {hr.slice(-4).map((p) => <KeyValue key={p.activityId} label={formatShortDate(p.localDate)} value={`${fmtRunPaceFromSecPerKm(p.paceSecPerKm, sys)} @ ${p.avgHr} bpm`} />)}
                    <Text style={[font.caption, { color: colors.textMuted }]}>Speed ÷ average heart rate. Affected by heat, terrain and fatigue. No training zones are inferred.</Text>
                  </>
                )}
              </Card>
            </>
          );
        }

        if (tab === 'swimming') {
          const swims = [...d.swims].sort((a, b) => a.localDate.localeCompare(b.localDate));
          const strokes = strokeComparison(swims, 'pool');
          return (
            <>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Pace per 100 m</Text>
                <LineChart
                  series={(['pool', 'open_water'] as const).filter((e) => swims.some((s) => s.environment === e)).map((e, i) => ({
                    label: e === 'pool' ? 'Pool' : 'Open water', color: i === 0 ? colors.primary : colors.info,
                    values: swims.map((s) => (s.environment === e ? pacePer100m(s.durationSec, s.distanceM) : null)),
                  }))}
                  xLabels={swims.map((s) => formatShortDate(s.localDate))} yUnit="/100m" formatY={(v) => formatPace(v)}
                  emptyMessage="Log swims to see pace trends." accessibilitySummary="Pace per 100 meters for each swim. Lower is faster." />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Weekly volume</Text>
                <BarChart values={perWeek(swims, (xs) => xs.reduce((a, s) => a + s.distanceM, 0))} xLabels={wLabels} yUnit="m" formatY={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))} highlightLast accessibilitySummary="Weekly swimming distance in meters." />
                <KeyValue label="Total time in period" value={formatDuration(swims.reduce((a, s) => a + s.durationSec, 0))} />
              </Card>
              <Card>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Pool pace by stroke</Text>
                {strokes.length === 0 ? <Text style={[font.caption, { color: colors.textMuted }]}>Record the stroke for pool swims to compare.</Text> : strokes.map((s) => (
                  <KeyValue key={s.stroke} label={`${s.stroke} (${s.sessions} swims, ${fmtSwimDistance(s.distanceM)})`} value={`${formatPace(s.avgPacePer100m)} /100m`} provenance="calculated" />
                ))}
              </Card>
            </>
          );
        }

        // body
        const dw = dailyWeights(d.weights);
        const weekly = weekKeys.map((w) => {
          const xs = dw.filter((x) => weekStart(x.localDate) === w);
          return xs.length ? displayWeight(xs.reduce((a, x) => a + x.weightKg, 0) / xs.length, sys).value : null;
        });
        const waist = d.waist.filter((m) => m.localDate >= from);
        return (
          <>
            <Card>
              <Text style={[font.bodyStrong, { color: colors.text }]}>Weekly average weight</Text>
              <LineChart series={[{ label: 'Weekly avg', values: weekly }]} xLabels={wLabels} yUnit={sys === 'imperial' ? 'lb' : 'kg'} emptyMessage="No weigh-ins in this period."
                accessibilitySummary="Average body weight for each week. Weeks without weigh-ins are left blank." />
              <Text style={[font.caption, { color: colors.textMuted }]}>Weeks without weigh-ins are left blank, not filled in.</Text>
              {dw.length > 0 ? <KeyValue label="Latest weigh-in" value={`${fmtWeight(dw.at(-1)!.weightKg, sys).value} ${fmtWeight(0, sys).unit} · ${formatShortDate(dw.at(-1)!.localDate)}`} provenance="manual" /> : null}
            </Card>
            <Card>
              <Text style={[font.bodyStrong, { color: colors.text }]}>Waist</Text>
              <LineChart series={[{ label: 'Waist', values: waist.map((m) => (sys === 'imperial' ? m.value / 2.54 : m.value)) }]} xLabels={waist.map((m) => formatShortDate(m.localDate))}
                yUnit={sys === 'imperial' ? 'in' : 'cm'} emptyMessage="No waist measurements in this period." accessibilitySummary="Waist measurements over time." />
            </Card>
          </>
        );
      })()}
    </Screen>
  );
}
