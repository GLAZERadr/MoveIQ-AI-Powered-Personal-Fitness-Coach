import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { createSession, getActiveSession, lastPerformance, listPlans } from '../../db/repos/workouts';
import { todayLocal } from '../../domain/dates';
import { newId } from '../../lib/id';
import { useCameraPermission } from '../../motion/adapters/MediaPipePoseStream';
import { EXERCISES, EXERCISE_META, ExerciseId } from '../../motion/exercises';
import { PlannedExercise } from '../../workout/sessionMachine';
import { Suggestion, suggestNextTarget } from '../../workout/progression';
import { Button, Card, ChipSelect, ErrorState, IconButton, Loading, Notice, Screen, TextField, Title } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export default function WorkoutSetup() {
  const params = useLocalSearchParams<{ planId?: string; exerciseId?: string }>();
  const q = useDbQuery(async (db) => {
    const plans = await listPlans(db);
    const ids = [...new Set([...plans.flatMap((p) => p.items.map((i) => i.exerciseId)), ...Object.keys(EXERCISES)])];
    const last = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await lastPerformance(db, id)] as const)));
    return { plans, active: await getActiveSession(db), last };
  }, []);
  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const plan = params.planId ? q.data.plans.find((p) => p.id === params.planId) : null;
  const base: PlannedExercise[] = plan
    ? plan.items.filter((i) => i.exerciseId in EXERCISES)
    : params.exerciseId && params.exerciseId in EXERCISES
      ? [{ exerciseId: params.exerciseId, targetSets: 3, targetReps: EXERCISE_META[params.exerciseId as ExerciseId].defaultTarget, restSec: params.exerciseId === 'plank' ? 60 : 90 }]
      : [];
  // Automatic progression from the last completed session of each exercise.
  const suggest = (id: string, fallback: number) => suggestNextTarget(q.data.last[id] ?? null, fallback, EXERCISES[id as ExerciseId].unit);
  const initial = base.map((i) => ({ ...i, targetReps: suggest(i.exerciseId, i.targetReps).target }));
  return <SetupForm initial={initial} planId={params.planId ?? null} hasActive={!!q.data.active} suggest={suggest} />;
}

function SetupForm({ initial, planId, hasActive, suggest }: { initial: PlannedExercise[]; planId: string | null; hasActive: boolean; suggest: (id: string, fallback: number) => Suggestion }) {
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
      // Ask for notifications (lock-screen status, "rest over") now, not mid-set, where the
      // system dialog would interrupt the workout. Declining is fine; the workout still works.
      await Notifications.getPermissionsAsync()
        .then((p) => (p.granted || !p.canAskAgain ? p : Notifications.requestPermissionsAsync()))
        .catch(() => undefined);
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
              <View style={{ flex: 1 }}><TextField label={ex.unit === 'seconds' ? 'Target seconds' : 'Target reps'} value={String(it.targetReps)} onChangeText={(s) => update(i, { targetReps: num(s, 1, ex.unit === 'seconds' ? 600 : 200) })} keyboardType="number-pad" /></View>
              <View style={{ flex: 1 }}><TextField label="Rest (s)" value={String(it.restSec)} onChangeText={(s) => update(i, { restSec: num(s, 0, 900) })} keyboardType="number-pad" /></View>
            </View>
            {suggest(it.exerciseId, it.targetReps).reason ? (
              <Text style={[font.caption, { color: colors.primary }]}>Auto: {suggest(it.exerciseId, it.targetReps).reason}</Text>
            ) : null}
            <Text style={[font.bodyStrong, { color: colors.text, marginTop: 4 }]}>Camera setup</Text>
            {ex.cameraSetup.map((s, k) => <Text key={k} style={[font.caption, { color: colors.textMuted }]}>• {s}</Text>)}
            <Text style={[font.caption, { color: colors.textMuted }]}>Must be visible: {ex.requiredLandmarksText}</Text>
            <Text style={[font.bodyStrong, { color: colors.text, marginTop: 4 }]}>How to perform</Text>
            {ex.instructions.map((s, k) => <Text key={k} style={[font.caption, { color: colors.textMuted }]}>• {s}</Text>)}
            {items.length === 1 ? (
              <ChipSelect<ExerciseId> label="Change exercise" value={ex.id}
                onChange={(id) => update(i, { exerciseId: id, targetReps: suggest(id, EXERCISE_META[id].defaultTarget).target, restSec: id === 'plank' ? 60 : 90 })}
                options={(Object.keys(EXERCISES) as ExerciseId[]).map((id) => ({ value: id, label: EXERCISES[id].name }))} />
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
