import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery } from '../../data/DbProvider';
import { fmtInt, fmtWeight, fmtWeightDelta } from '../../data/format';
import { listMeasurements, listWeights } from '../../db/repos/body';
import { listEntries } from '../../db/repos/nutrition';
import { getPrimaryGoal, getProfile } from '../../db/repos/profile';
import { MEALS, dailyWeights, progressToTarget, rollingAverage, sumNutrition, weeklyAdherence, weeklyRate } from '../../domain/cutting';
import { addDays, dateRange, formatShortDate, todayLocal } from '../../domain/dates';
import { displayWeight } from '../../domain/units';
import { BarChart, LineChart } from '../../ui/charts';
import {
  Button, Card, EmptyState, ErrorState, IconButton, KeyValue, ListItem, Loading, MetricCard, Notice, ProgressBar, Row, Screen, SectionHeader, Segmented, Title,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';

const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' } as const;

export default function Cutting() {
  const [tab, setTab] = useState<'overview' | 'nutrition' | 'measurements'>('overview');
  return (
    <Screen>
      <Title subtitle="Weight trend, nutrition and body measurements">Cutting</Title>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'nutrition', label: 'Nutrition' }, { value: 'measurements', label: 'Measurements' }]} />
      {tab === 'overview' ? <Overview /> : tab === 'nutrition' ? <NutritionLog /> : <Measurements />}
    </Screen>
  );
}

function Overview() {
  const { colors, font } = useTheme();
  const today = todayLocal();
  const q = useDbQuery(async (db) => ({
    profile: await getProfile(db),
    goal: await getPrimaryGoal(db),
    weights: await listWeights(db, addDays(today, -90)),
    nutrition: await listEntries(db, addDays(today, -6), today),
  }), [today]);
  if (q.status === 'loading') return <Loading />;
  if (q.status === 'error') return <ErrorState error={q.error} onRetry={q.reload} />;
  const { profile, goal, weights, nutrition } = q.data;
  const sys = profile?.unitSystem ?? 'metric';
  const daily = dailyWeights(weights);
  const rolling = rollingAverage(daily);
  const latestAvg = [...rolling].reverse().find((r) => r.averageKg != null)?.averageKg ?? null;
  const rate = weeklyRate(daily, today);
  const progress = goal?.startWeightKg && goal.targetWeightKg && latestAvg ? progressToTarget(goal.startWeightKg, latestAvg, goal.targetWeightKg) : null;
  const adherence = weeklyAdherence(nutrition, addDays(today, -6), today, { kcal: goal?.dailyCalorieTargetKcal ?? null, proteinG: goal?.dailyProteinTargetG ?? null });

  const windowDates = dateRange(addDays(today, -29), today);
  const dailyByDate = new Map(daily.map((d) => [d.localDate, d.weightKg]));
  const rollingByDate = new Map(rolling.map((r) => [r.localDate, r.averageKg]));
  const toDisplay = (kg: number | null | undefined) => (kg == null ? null : displayWeight(kg, sys).value);
  const w = fmtWeight(latestAvg, sys);

  return (
    <>
      <Button title="Log weight" icon="add" onPress={() => router.push('/weight/edit')} />
      <Row>
        <MetricCard label="7-day average" value={w.value} unit={w.unit} provenance="calculated" sub={latestAvg == null ? 'Needs 3+ weigh-ins in 7 days' : undefined} />
        <MetricCard label="Weekly change" provenance="calculated"
          value={rate.status === 'ok' ? fmtWeightDelta(rate.kgPerWeek, sys) : '–'}
          sub={rate.status === 'ok' ? `${rate.percentOfBodyweightPerWeek.toFixed(1)}% of body weight` : `Need ≥${rate.required} weigh-ins in each of the last two weeks (have ${rate.recentObservations} and ${rate.priorObservations})`}
          subTone={rate.status === 'ok' && rate.kgPerWeek < 0 ? 'good' : 'muted'} />
      </Row>
      <Card>
        <Text style={[font.bodyStrong, { color: colors.text }]}>Weight trend, last 30 days</Text>
        <LineChart
          series={[
            { label: 'Weigh-ins', values: windowDates.map((d) => toDisplay(dailyByDate.get(d))), color: colors.chartSecondary, dots: true },
            { label: '7-day average', values: windowDates.map((d) => toDisplay(rollingByDate.get(d))), dots: false },
          ]}
          xLabels={windowDates.map(formatShortDate)}
          yUnit={sys === 'imperial' ? 'lb' : 'kg'}
          emptyMessage="Log your weight to see a trend."
          accessibilitySummary={`Weight over the last 30 days. Latest 7-day average ${w.value} ${w.unit}.`}
        />
        <Text style={[font.caption, { color: colors.textMuted }]}>
          Daily weight moves with water, glycogen, salt and food in your gut. The 7-day average shows the trend better. A change in weight is not necessarily a change in fat.
        </Text>
      </Card>
      {goal?.targetWeightKg ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[font.bodyStrong, { color: colors.text }]}>Progress to target</Text>
            <Text style={[font.caption, { color: colors.textMuted }]}>{fmtWeight(goal.startWeightKg, sys).value} → {fmtWeight(goal.targetWeightKg, sys).value} {fmtWeight(0, sys).unit}</Text>
          </View>
          {progress != null ? <ProgressBar value={progress} label="Progress toward target weight" /> : null}
          <Text style={[font.caption, { color: colors.textMuted }]}>{progress != null ? `${Math.round(progress * 100)}% based on your 7-day average` : 'Shown once there is a 7-day average and a starting weight.'}</Text>
        </Card>
      ) : null}
      <SectionHeader title="This week’s nutrition" action={{ label: 'Targets', onPress: () => router.push('/goal') }} />
      <Card>
        <BarChart
          values={adherence.days.map((d) => (d.logged ? d.kcal : null))}
          xLabels={adherence.days.map((d) => formatShortDate(d.localDate).split(' ')[1] ?? d.localDate)}
          yUnit="kcal"
          target={goal?.dailyCalorieTargetKcal ?? null}
          emptyMessage="No food logged in the last 7 days."
          accessibilitySummary={`Calories logged on each of the last 7 days${goal?.dailyCalorieTargetKcal ? ` against a ${goal.dailyCalorieTargetKcal} kcal target` : ''}. ${adherence.loggedDays} of 7 days logged.`}
        />
        <KeyValue label="Days logged" value={`${adherence.loggedDays} / 7`} provenance="calculated" />
        {goal?.dailyCalorieTargetKcal ? <KeyValue label="Days within calorie target (+5%)" value={`${adherence.days.filter((d) => d.withinCalorieTarget).length} / ${adherence.loggedDays}`} provenance="calculated" /> : null}
        {goal?.dailyProteinTargetG ? <KeyValue label="Days meeting protein (≥90%)" value={`${adherence.days.filter((d) => d.metProteinTarget).length} / ${adherence.loggedDays}`} provenance="calculated" /> : null}
        {!goal?.dailyCalorieTargetKcal ? <Notice>Set a calorie and protein target to see adherence.</Notice> : null}
        <Text style={[font.caption, { color: colors.textMuted }]}>Recorded intake only. Exercise calories are not added to your target, which avoids double-counting.</Text>
      </Card>
    </>
  );
}

function NutritionLog() {
  const { colors, font } = useTheme();
  const [date, setDate] = useState(todayLocal());
  const q = useDbQuery(async (db) => ({ entries: await listEntries(db, date, date), goal: await getPrimaryGoal(db) }), [date]);
  const isToday = date === todayLocal();

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
        <Text accessibilityRole="header" style={[font.bodyStrong, { color: colors.text }]}>{isToday ? 'Today' : formatShortDate(date)}</Text>
        <IconButton icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} style={{ opacity: isToday ? 0.3 : 1 }} />
      </View>
      {q.status === 'loading' ? <Loading /> : q.status === 'error' ? <ErrorState error={q.error} onRetry={q.reload} /> : (() => {
        const t = sumNutrition(q.data.entries);
        const g = q.data.goal;
        return (
          <>
            <Card>
              <Row gap={8}>
                {[
                  { label: 'Calories', v: t.kcal, target: g?.dailyCalorieTargetKcal, unit: 'kcal', missing: 0 },
                  { label: 'Protein', v: t.proteinG, target: g?.dailyProteinTargetG, unit: 'g', missing: 0 },
                  { label: 'Carbs', v: t.carbsG, target: null, unit: 'g', missing: t.missing.carbsG },
                  { label: 'Fat', v: t.fatG, target: null, unit: 'g', missing: t.missing.fatG },
                ].map((m) => (
                  <View key={m.label} style={{ flex: 1, minWidth: 70, gap: 4 }} accessible accessibilityLabel={`${m.label} ${Math.round(m.v)} ${m.unit}${m.target ? ` of ${m.target}` : ''}`}>
                    <Text style={[font.caption, { color: colors.textMuted }]}>{m.label}</Text>
                    <Text style={[font.bodyStrong, { color: colors.text }]}>{fmtInt(m.v)}{m.target ? <Text style={[font.caption, { color: colors.textMuted }]}> / {fmtInt(m.target)}</Text> : null}</Text>
                    {m.target ? <ProgressBar value={m.v / m.target} /> : null}
                    {m.missing > 0 ? <Text style={[font.caption, { color: colors.warning, fontSize: 10 }]}>{m.missing} item(s) missing</Text> : null}
                  </View>
                ))}
              </Row>
            </Card>
            {MEALS.map((meal) => {
              const items = q.data.entries.filter((e) => e.meal === meal);
              const kcal = items.reduce((a, e) => a + e.kcal, 0);
              return (
                <Card key={meal}>
                  <SectionHeader title={`${MEAL_LABEL[meal]}${items.length ? ` · ${fmtInt(kcal)} kcal` : ''}`} action={{ label: 'Add', onPress: () => router.push({ pathname: '/food/edit', params: { meal, date } }) }} />
                  {items.map((e) => (
                    <ListItem key={e.id} title={e.name} subtitle={`${e.servings} × ${e.servingQty ?? ''} ${e.servingUnit ?? 'serving'} · ${Math.round(e.proteinG)} g protein`}
                      right={`${fmtInt(e.kcal)} kcal`} onPress={() => router.push({ pathname: '/food/edit', params: { id: e.id } })} />
                  ))}
                  {items.length === 0 ? <Text style={[font.caption, { color: colors.textMuted }]}>Nothing logged.</Text> : null}
                </Card>
              );
            })}
            <Text style={[font.caption, { color: colors.textMuted }]}>All nutrition values are entered by you. MoveIQ doesn’t look up or estimate food data.</Text>
          </>
        );
      })()}
    </>
  );
}

function Measurements() {
  const { colors, font } = useTheme();
  const q = useDbQuery(async (db) => ({ waist: await listMeasurements(db, 'waist'), bf: await listMeasurements(db, 'body_fat'), profile: await getProfile(db) }));
  if (q.status === 'loading') return <Loading />;
  if (q.status === 'error') return <ErrorState error={q.error} onRetry={q.reload} />;
  const imperial = q.data.profile?.unitSystem === 'imperial';
  const { waist, bf } = q.data;
  return (
    <>
      <Button title="Add measurement" icon="add" onPress={() => router.push('/measurement/edit')} />
      <Card>
        <Text style={[font.bodyStrong, { color: colors.text }]}>Waist circumference</Text>
        <LineChart series={[{ label: 'Waist', values: waist.map((m) => (imperial ? m.value / 2.54 : m.value)) }]} xLabels={waist.map((m) => formatShortDate(m.localDate))}
          yUnit={imperial ? 'in' : 'cm'} emptyMessage="No waist measurements yet." accessibilitySummary={`Waist measurements over time, ${waist.length} entries.`} />
        {waist.length >= 2 ? (
          <KeyValue label="Change since first" value={`${(((waist.at(-1)!.value - waist[0]!.value) / (imperial ? 2.54 : 1))).toFixed(1)} ${imperial ? 'in' : 'cm'}`} provenance="calculated" />
        ) : null}
      </Card>
      <Card>
        <Text style={[font.bodyStrong, { color: colors.text }]}>Body-fat estimates</Text>
        {bf.length === 0 ? <EmptyState icon="analytics-outline" title="None recorded" message="Optional. Enter a value from a scale, calipers or a scan, along with the method used." /> : null}
        {bf.slice().reverse().map((m) => (
          <ListItem key={m.id} title={`${m.value.toFixed(1)}%`} subtitle={m.method ? `Method: ${m.method}` : 'Method not specified'} right={formatShortDate(m.localDate)}
            onPress={() => router.push({ pathname: '/measurement/edit', params: { id: m.id } })} />
        ))}
        <Text style={[font.caption, { color: colors.textMuted }]}>Body-fat numbers depend heavily on the method. Compare readings taken the same way. MoveIQ never estimates body fat from weight alone.</Text>
      </Card>
      {waist.length > 0 ? (
        <Card>
          {waist.slice().reverse().map((m) => (
            <ListItem key={m.id} title={`${(imperial ? m.value / 2.54 : m.value).toFixed(1)} ${imperial ? 'in' : 'cm'} waist`} right={formatShortDate(m.localDate)}
              onPress={() => router.push({ pathname: '/measurement/edit', params: { id: m.id } })} />
          ))}
        </Card>
      ) : null}
    </>
  );
}
