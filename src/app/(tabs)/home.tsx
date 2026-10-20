import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { loadDashboard } from '../../data/dashboard';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { fmtDistance, fmtInt, fmtRunPace, fmtSwimDistance, fmtSwimPace, fmtWeight, fmtWeightDelta } from '../../data/format';
import { dismissRecommendation } from '../../db/repos/settings';
import { formatShortDate, todayLocal } from '../../domain/dates';
import { formatDuration } from '../../domain/units';
import { LineChart } from '../../ui/charts';
import {
  Button, Card, EmptyState, ErrorState, ListItem, Loading, MetricCard, ProgressBar, ProvenanceBadge, Row, Screen, SectionHeader, Title,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { colors, font } = useTheme();
  const today = todayLocal();
  const q = useDbQuery((db) => loadDashboard(db, today), [today]);
  const mutate = useMutation();

  if (q.status === 'loading') return <Screen><Loading /></Screen>;
  if (q.status === 'error') return <Screen><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const d = q.data;
  const sys = d.profile?.unitSystem ?? 'metric';
  const kcalTarget = d.goal?.dailyCalorieTargetKcal ?? null;
  const proteinTarget = d.goal?.dailyProteinTargetG ?? null;
  const w = fmtWeight(d.latestAvg?.averageKg ?? d.latest?.weightKg, sys);
  const recentRolling = d.rolling.slice(-14);

  const weekRunM = d.weekRuns.reduce((a, r) => a + r.distanceM, 0);
  const weekSwimM = d.weekSwims.reduce((a, s) => a + s.distanceM, 0);
  const weekReps = d.weekSessions.reduce((a, s) => a + s.totalReps, 0);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{`${greeting()}${d.profile?.displayName ? `, ${d.profile.displayName}` : ''}`}</Title>
      </View>

      {d.active ? (
        <Card style={{ borderColor: colors.primary, borderWidth: 1.5 }}>
          <Text style={[font.bodyStrong, { color: colors.text }]}>Workout in progress</Text>
          <Text style={[font.caption, { color: colors.textMuted }]}>Started {new Date(d.active.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Resume where you left off, or review and finish it.</Text>
          <Button title="Resume workout" icon="play" onPress={() => router.push({ pathname: '/workout/live', params: { sessionId: d.active!.id } })} />
        </Card>
      ) : (
        <Card>
          <Text style={[font.caption, { color: colors.textMuted }]}>Today’s workout</Text>
          {d.nextPlan ? (
            <>
              <Text style={[font.title, { color: colors.text }]}>{d.nextPlan.name}</Text>
              <Text style={[font.caption, { color: colors.textMuted }]}>
                {d.nextPlan.items.map((i) => `${i.targetSets}×${i.targetReps} ${i.exerciseId === 'pushup' ? 'push-ups' : i.exerciseId === 'squat' ? 'squats' : i.exerciseId}`).join(' · ')}
              </Text>
              <Button title="Start" icon="camera-outline" onPress={() => router.push({ pathname: '/workout/setup', params: { planId: d.nextPlan!.id } })} />
            </>
          ) : (
            <Button title="Choose a workout" onPress={() => router.push('/(tabs)/train')} />
          )}
        </Card>
      )}

      {d.recommendations.length > 0 && (
        <View style={{ gap: 8 }}>
          {d.recommendations.map((r) => (
            <Card key={r.ruleId} style={{ borderLeftWidth: 4, borderLeftColor: r.severity === 'attention' ? colors.warning : colors.info }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <ProvenanceBadge kind="rule" />
                  <Text style={[font.bodyStrong, { color: colors.text }]}>{r.title}</Text>
                </View>
                <Pressable onPress={() => mutate((db) => dismissRecommendation(db, r.ruleId, today))} accessibilityRole="button" accessibilityLabel={`Dismiss: ${r.title}`} hitSlop={12} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end' }}>
                  <Ionicons name="close" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
              <Text style={[font.body, { color: colors.textMuted }]}>{r.body}</Text>
              <Text style={[font.caption, { color: colors.textMuted }]}>Based on: {r.evidence.join('; ')}</Text>
            </Card>
          ))}
        </View>
      )}

      <Row>
        <MetricCard
          label={d.latestAvg?.averageKg != null ? 'Weight (7-day avg)' : 'Latest weight'}
          value={w.value}
          unit={w.unit}
          provenance={d.latestAvg?.averageKg != null ? 'calculated' : 'manual'}
          sub={d.rate.status === 'ok' ? `${fmtWeightDelta(d.rate.kgPerWeek, sys)} vs prior week` : d.latest ? 'Need 3+ weigh-ins per week for a trend' : 'No weigh-ins yet'}
          subTone={d.rate.status === 'ok' ? (d.rate.kgPerWeek <= 0 ? 'good' : 'muted') : 'muted'}
          onPress={() => router.push('/weight/edit')}
        >
          {recentRolling.length >= 2 ? (
            <LineChart height={60} series={[{ label: '7-day avg', values: recentRolling.map((r) => r.averageKg), dots: false }]} xLabels={recentRolling.map(() => '')} yUnit="" formatY={() => ''} accessibilitySummary="Recent weight trend" />
          ) : null}
        </MetricCard>
        <MetricCard
          label="Calories today"
          value={fmtInt(d.todayNutrition.kcal)}
          unit={kcalTarget ? `/ ${fmtInt(kcalTarget)}` : 'kcal'}
          provenance="manual"
          sub={d.todayNutrition.entries === 0 ? 'Nothing logged yet' : `${d.todayNutrition.entries} item${d.todayNutrition.entries === 1 ? '' : 's'} logged`}
          onPress={() => router.push('/(tabs)/cutting')}
        >
          {kcalTarget ? <ProgressBar value={d.todayNutrition.kcal / kcalTarget} label="Calories versus target" color={d.todayNutrition.kcal > kcalTarget * 1.05 ? colors.warning : colors.primary} /> : null}
        </MetricCard>
      </Row>
      <Row>
        <MetricCard label="Protein today" value={fmtInt(d.todayNutrition.proteinG)} unit={proteinTarget ? `/ ${fmtInt(proteinTarget)} g` : 'g'} provenance="manual" onPress={() => router.push('/(tabs)/cutting')}>
          {proteinTarget ? <ProgressBar value={d.todayNutrition.proteinG / proteinTarget} label="Protein versus target" /> : null}
        </MetricCard>
        <MetricCard label="This week" value={String(d.activeDays)} unit={`active day${d.activeDays === 1 ? '' : 's'}`} sub={`${d.weekSessions.length} workouts · ${weekReps} reps`} onPress={() => router.push('/(tabs)/progress')} />
      </Row>
      <Row>
        <MetricCard label="Running this week" value={fmtDistance(weekRunM, sys, 1).value} unit={fmtDistance(weekRunM, sys).unit} sub={`${d.weekRuns.length} run${d.weekRuns.length === 1 ? '' : 's'}`} onPress={() => router.push('/(tabs)/activities')} />
        <MetricCard label="Swimming this week" value={fmtSwimDistance(weekSwimM)} sub={`${d.weekSwims.length} swim${d.weekSwims.length === 1 ? '' : 's'}`} onPress={() => router.push({ pathname: '/(tabs)/activities', params: { tab: 'swim' } })} />
      </Row>

      <SectionHeader title="Recent activity" action={{ label: 'Add', onPress: () => router.push('/(tabs)/activities') }} />
      <Card>
        {[
          ...d.sessions.slice(0, 3).map((s) => ({ key: `w${s.id}`, date: s.localDate, el: (
            <ListItem key={`w${s.id}`} icon="body-outline" title={s.exerciseNames || 'Workout'} subtitle={`${s.totalReps} reps · ${s.sets} sets · ${formatDuration(s.activeDurationSec)}`} right={formatShortDate(s.localDate)} onPress={() => router.push(`/workout/${s.id}`)} />
          ) })),
          ...d.runs.slice(0, 3).map((r) => ({ key: `r${r.id}`, date: r.localDate, el: (
            <ListItem key={`r${r.id}`} icon="walk-outline" title={`${fmtDistance(r.distanceM, sys).value} ${fmtDistance(r.distanceM, sys).unit} run`} subtitle={`${formatDuration(r.durationSec)} · ${fmtRunPace(r.durationSec, r.distanceM, sys).value}${fmtRunPace(r.durationSec, r.distanceM, sys).unit}`} right={formatShortDate(r.localDate)} onPress={() => router.push(`/run/${r.id}`)} />
          ) })),
          ...d.swims.slice(0, 3).map((s) => ({ key: `s${s.id}`, date: s.localDate, el: (
            <ListItem key={`s${s.id}`} icon="water-outline" title={`${fmtSwimDistance(s.distanceM)} swim`} subtitle={`${formatDuration(s.durationSec)} · ${fmtSwimPace(s.durationSec, s.distanceM)}`} right={formatShortDate(s.localDate)} onPress={() => router.push(`/swim/${s.id}`)} />
          ) })),
        ]
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5)
          .map((x) => x.el)}
        {d.sessions.length + d.runs.length + d.swims.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No activity yet" message="Workouts, runs and swims you record will appear here." />
        ) : null}
      </Card>
    </Screen>
  );
}
