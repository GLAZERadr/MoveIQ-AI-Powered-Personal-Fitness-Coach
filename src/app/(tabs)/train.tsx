import { router } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery } from '../../data/DbProvider';
import { listPlans, listSessions, personalRecords } from '../../db/repos/workouts';
import { formatShortDate } from '../../domain/dates';
import { formatDuration } from '../../domain/units';
import { EXERCISES } from '../../motion/exercises';
import { Button, Card, EmptyState, ErrorState, ListItem, Loading, ProvenanceBadge, Screen, SectionHeader, Segmented, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export default function Train() {
  const { colors, font } = useTheme();
  const [tab, setTab] = useState<'workouts' | 'library' | 'history'>('workouts');
  const q = useDbQuery(async (db) => ({
    plans: await listPlans(db),
    sessions: await listSessions(db, { limit: 50 }),
    prs: await personalRecords(db),
    catalog: await db.all<{ id: string; name: string; category: string; camera_supported: number }>('SELECT * FROM exercises ORDER BY camera_supported DESC, name'),
  }));

  return (
    <Screen>
      <Title subtitle="Camera-coached bodyweight training">Train</Title>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'workouts', label: 'Workouts' }, { value: 'library', label: 'Exercises' }, { value: 'history', label: 'History' }]} />
      {q.status === 'loading' ? <Loading /> : q.status === 'error' ? <ErrorState error={q.error} onRetry={q.reload} /> : (
        <>
          {tab === 'workouts' && (
            <>
              <SectionHeader title="Quick start" />
              {Object.values(EXERCISES).map((ex) => (
                <Card key={ex.id} onPress={() => router.push({ pathname: '/workout/setup', params: { exerciseId: ex.id } })} accessibilityLabel={`Start ${ex.name} with camera coaching`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[font.title, { color: colors.text, fontSize: 18 }]}>{ex.name}</Text>
                    <ProvenanceBadge kind="camera" />
                  </View>
                  <Text style={[font.caption, { color: colors.textMuted }]}>{ex.instructions[0]}</Text>
                </Card>
              ))}
              <SectionHeader title="Workout plans" />
              {q.data.plans.map((p) => (
                <Card key={p.id}>
                  <Text style={[font.bodyStrong, { color: colors.text }]}>{p.name}</Text>
                  {p.items.map((i, idx) => (
                    <Text key={idx} style={[font.caption, { color: colors.textMuted }]}>
                      {idx + 1}. {EXERCISES[i.exerciseId as keyof typeof EXERCISES]?.name ?? i.exerciseId}: {i.targetSets} × {i.targetReps}, rest {i.restSec}s
                    </Text>
                  ))}
                  <Button title="Start plan" icon="play" onPress={() => router.push({ pathname: '/workout/setup', params: { planId: p.id } })} />
                </Card>
              ))}
            </>
          )}
          {tab === 'library' && (
            <Card>
              {q.data.catalog.map((e) => (
                <ListItem
                  key={e.id}
                  icon={e.camera_supported ? 'scan-outline' : 'ellipse-outline'}
                  title={e.name}
                  subtitle={e.camera_supported ? `${e.category} · Camera rep counting & form cues` : `${e.category} · Camera analysis not available yet`}
                  onPress={e.camera_supported ? () => router.push({ pathname: '/workout/setup', params: { exerciseId: e.id } }) : undefined}
                />
              ))}
            </Card>
          )}
          {tab === 'history' && (
            <>
              {q.data.prs.length > 0 && (
                <Card>
                  <Text style={[font.bodyStrong, { color: colors.text }]}>Personal records (most reps in one set)</Text>
                  {q.data.prs.map((p) => (
                    <Text key={p.exerciseId} style={[font.body, { color: colors.textMuted }]}>{p.name}: {p.reps} reps · {formatShortDate(p.localDate)}</Text>
                  ))}
                </Card>
              )}
              <Card>
                {q.data.sessions.length === 0 ? (
                  <EmptyState icon="barbell-outline" title="No workouts yet" message="Completed workouts and their reports appear here." />
                ) : (
                  q.data.sessions.map((s) => (
                    <ListItem key={s.id} icon="body-outline" title={s.exerciseNames || 'Workout'} subtitle={`${s.totalReps} reps · ${s.sets} sets · ${formatDuration(s.activeDurationSec)}${s.rpe ? ` · RPE ${s.rpe}` : ''}`} right={formatShortDate(s.localDate)} onPress={() => router.push(`/workout/${s.id}`)} />
                  ))
                )}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
