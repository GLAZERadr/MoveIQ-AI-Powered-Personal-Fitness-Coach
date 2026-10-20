import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { createSession, getActiveSession, listPlans } from '../../db/repos/workouts';
import { todayLocal } from '../../domain/dates';
import { newId } from '../../lib/id';
import { useCameraPermission } from '../../motion/adapters/MediaPipePoseStream';
import { EXERCISES, ExerciseId } from '../../motion/exercises';
import { PlannedExercise } from '../../workout/sessionMachine';
import { Button, Card, ErrorState, IconButton, Loading, Notice, Screen, TextField, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export default function WorkoutSetup() {
  const params = useLocalSearchParams<{ planId?: string; exerciseId?: string }>();
  const q = useDbQuery(async (db) => ({ plans: await listPlans(db), active: await getActiveSession(db) }), []);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const plan = params.planId ? q.data.plans.find((p) => p.id === params.planId) : null;
  const initial: PlannedExercise[] = plan
    ? plan.items.filter((i) => i.exerciseId in EXERCISES)
    : params.exerciseId && params.exerciseId in EXERCISES
      ? [{ exerciseId: params.exerciseId, targetSets: 3, targetReps: params.exerciseId === 'squat' ? 15 : 10, restSec: 90 }]
      : [];
  return <SetupForm initial={initial} planId={params.planId ?? null} hasActive={!!q.data.active} />;
}

function SetupForm({ initial, planId, hasActive }: { initial: PlannedExercise[]; planId: string | null; hasActive: boolean }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const permission = useCameraPermission({ ask: false });
  const [items, setItems] = useState<PlannedExercise[]>(initial);
  const [starting, setStarting] = useState(false);

  const update = (i: number, patch: Partial<PlannedExercise>) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const num = (s: string, min: number, max: number) => {
    const n = Number(s.replace(/\D/g, ''));
    return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
  };

  async function start(useCamera: boolean) {
    if (items.length === 0) return;
    setStarting(true);
    try {
      if (useCamera && !permission.granted) {
        const res = await permission.request();
        if (!res.granted) return;
      }
      const id = newId();
      await mutate((db) => createSession(db, { id, planId, localDate: todayLocal(), exercises: items }));
      router.replace({ pathname: '/workout/live', params: { sessionId: id, manual: useCamera ? '0' : '1' } });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Screen edges={[]}>
      {hasActive ? (
        <Notice tone="warning">You have an unfinished workout. Starting a new one keeps the old one paused until you finish it from Home.</Notice>
      ) : null}
      {items.length === 0 ? <ErrorState error={new Error('This workout has no camera-supported exercises.')} /> : null}
      {items.map((it, i) => {
        const ex = EXERCISES[it.exerciseId as ExerciseId];
        return (
          <Card key={i}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Title>{ex.name}</Title>
              {items.length > 1 ? <IconButton icon="trash-outline" label={`Remove ${ex.name}`} onPress={() => setItems(items.filter((_, idx) => idx !== i))} size={20} /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><TextField label="Sets" value={String(it.targetSets)} onChangeText={(s) => update(i, { targetSets: num(s, 1, 20) })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><TextField label="Target reps" value={String(it.targetReps)} onChangeText={(s) => update(i, { targetReps: num(s, 1, 200) })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><TextField label="Rest (s)" value={String(it.restSec)} onChangeText={(s) => update(i, { restSec: num(s, 0, 900) })} keyboardType="number-pad" /></View>
            </View>
            <Text style={[font.bodyStrong, { color: colors.text, marginTop: 4 }]}>Camera setup</Text>
            {ex.cameraSetup.map((s, k) => <Text key={k} style={[font.caption, { color: colors.textMuted }]}>• {s}</Text>)}
            <Text style={[font.caption, { color: colors.textMuted }]}>Must be visible: {ex.requiredLandmarksText}</Text>
            <Text style={[font.bodyStrong, { color: colors.text, marginTop: 4 }]}>How to perform</Text>
            {ex.instructions.map((s, k) => <Text key={k} style={[font.caption, { color: colors.textMuted }]}>• {s}</Text>)}
            {ex.id === 'pushup' && items.length === 1 ? (
              <Button variant="ghost" title="Swap for squats" onPress={() => update(i, { exerciseId: 'squat', targetReps: 15 })} />
            ) : ex.id === 'squat' && items.length === 1 ? (
              <Button variant="ghost" title="Swap for push-ups" onPress={() => update(i, { exerciseId: 'pushup', targetReps: 10 })} />
            ) : null}
          </Card>
        );
      })}
      {permission.status === 'denied' ? (
        <Card>
          <Text style={[font.bodyStrong, { color: colors.text }]}>Camera access is off</Text>
          <Text style={[font.caption, { color: colors.textMuted }]}>Camera coaching needs camera access. Video is analysed on-device and never stored. You can enable it in Settings or log reps manually.</Text>
          <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} />
        </Card>
      ) : null}
      {permission.error ? <Notice tone="warning">The pose-detection module isn’t available in this build (for example, Expo Go). Use a development build for camera coaching. Manual logging still works.</Notice> : null}
      <Button title="Start with camera coaching" icon="camera" loading={starting} disabled={items.length === 0 || permission.status === 'denied' || !!permission.error} onPress={() => start(true)} />
      <Button title="Log reps manually instead" variant="secondary" disabled={items.length === 0 || starting} onPress={() => start(false)} />
    </Screen>
  );
}
