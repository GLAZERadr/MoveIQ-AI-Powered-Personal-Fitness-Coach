import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDb, notifyDataChanged } from '../../data/DbProvider';
import { getSettings, AppSettings } from '../../db/repos/settings';
import { getSession, getSessionExercises, saveSet, setSessionStatus, SessionExercise } from '../../db/repos/workouts';
import { formatDuration } from '../../domain/units';
import { newId } from '../../lib/id';
import { endLockScreenStatus, startOrUpdateLockScreenStatus } from '../../lockscreen/lockScreenStatus';
import { AnalyzerSnapshot, ExerciseAnalyzer } from '../../motion/analyzer';
import { PoseStream } from '../../motion/adapters/MediaPipePoseStream';
import { EXERCISES, ExerciseId } from '../../motion/exercises';
import { savePoseSequence } from '../../motion/poseStorage';
import { buildSetReport } from '../../motion/report';
import { PoseFrame } from '../../motion/types';
import { activeDurationMs, initialSession, sessionReducer, SessionState } from '../../workout/sessionMachine';
import { Button, ErrorState, IconButton, Loading, Screen, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

const QUALITY_COLOR = { good: '#1FC96B', partial: '#E8A317', poor: '#E5484D', none: '#E5484D' } as const;
const QUALITY_LABEL = { good: 'Tracking good', partial: 'Tracking weak', poor: 'Tracking poor', none: 'No body detected' } as const;

type Loaded = { exercises: SessionExercise[]; settings: AppSettings; startedAt: string };

export default function LiveWorkout() {
  const { sessionId, manual } = useLocalSearchParams<{ sessionId: string; manual?: string }>();
  const db = useDb();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getSession(db, sessionId);
      if (!s) throw new Error('Workout not found.');
      if (s.status === 'completed' || s.status === 'abandoned') {
        router.replace(`/workout/${sessionId}`);
        return;
      }
      setLoaded({ exercises: await getSessionExercises(db, sessionId), settings: await getSettings(db), startedAt: s.startedAt });
    })().catch((e: Error) => setLoadError(e));
  }, [db, sessionId]);

  if (loadError) return <Screen><ErrorState error={loadError} onRetry={() => router.back()} /></Screen>;
  if (!loaded) return <Screen><Loading /></Screen>;
  return <LiveSession sessionId={sessionId} manual={manual === '1'} {...loaded} />;
}

function restoreState(exercises: SessionExercise[]): SessionState {
  // Resume after interruption: skip sets already persisted.
  const base = initialSession(exercises.map((e) => ({ exerciseId: e.exerciseId, targetSets: e.targetSets, targetReps: e.targetReps, restSec: e.restSec })));
  const completed = exercises.flatMap((e, ei) => e.sets.map((s) => ({ exerciseIndex: ei, setIndex: s.setIndex, reps: s.completedReps })));
  let exerciseIndex = 0;
  let setIndex = 0;
  for (const [ei, e] of exercises.entries()) {
    const done = e.sets.length;
    if (done < e.targetSets) {
      exerciseIndex = ei;
      setIndex = done;
      break;
    }
    exerciseIndex = ei + 1;
  }
  if (exerciseIndex >= exercises.length) return { ...base, completed, phase: 'completed' };
  return { ...base, completed, exerciseIndex, setIndex };
}

function LiveSession({ sessionId, manual, exercises, settings }: Loaded & { sessionId: string; manual: boolean }) {
  const { colors, font } = useTheme();
  const db = useDb();
  const [state, dispatch] = useReducer(sessionReducer, exercises, restoreState);
  const [snapshot, setSnapshot] = useState<AnalyzerSnapshot | null>(null);
  const [manualReps, setManualReps] = useState(0);
  const [focused, setFocused] = useState(true);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const analyzer = useRef<ExerciseAnalyzer | null>(null);
  const setStartedAt = useRef<string>(new Date().toISOString());
  const lastUiUpdate = useRef(0);
  const restNotificationId = useRef<string | null>(null);
  const finishing = useRef(false);

  const current = exercises[state.exerciseIndex];
  const exDef = current ? EXERCISES[current.exerciseId as ExerciseId] : null;
  const useCamera = !manual && !cameraError;

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Background / lock: camera must stop. An active set is paused so no rep spans the interruption.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (s !== 'active') dispatch({ type: 'PAUSE', at: Date.now() });
    });
    return () => sub.remove();
  }, []);

  // New analyzer per set, created when a set becomes active.
  useEffect(() => {
    if (state.phase === 'active' && exDef && !analyzer.current) {
      analyzer.current = new ExerciseAnalyzer(exDef, { retainFrames: settings.poseRetentionDays > 0 });
      setStartedAt.current = new Date().toISOString();
      setSnapshot(null);
      setManualReps(0);
    }
  }, [state.phase, exDef, settings.poseRetentionDays]);

  // Clock for rest countdown / duration.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (state.phase === 'resting' && state.restEndsAtMs != null && now >= state.restEndsAtMs) {
      dispatch({ type: 'REST_DONE', at: now });
      if (settings.hapticOnRep) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [now, state.phase, state.restEndsAtMs, settings.hapticOnRep]);

  // Persist status changes (pause/resume) so an interrupted session can be recovered.
  useEffect(() => {
    if (state.phase === 'paused') void setSessionStatus(db, sessionId, 'paused', { activeDurationSec: Math.round(state.activeMs / 1000) });
    if (state.phase === 'active' || state.phase === 'resting') void setSessionStatus(db, sessionId, 'active');
  }, [state.phase, db, sessionId, state.activeMs]);

  const reps = useCamera ? snapshot?.reps ?? 0 : manualReps;

  // Lock-screen status (iOS Live Activity / Android ongoing notification).
  useEffect(() => {
    if (!settings.lockScreenStatus || !exDef || !current || state.phase === 'idle' || state.phase === 'completed') return;
    void startOrUpdateLockScreenStatus({
      title: exDef.name,
      setLabel: `Set ${state.setIndex + 1}/${current.targetSets}`,
      reps: state.phase === 'resting' ? state.completed[state.completed.length - 1]?.reps ?? 0 : reps,
      targetReps: current.targetReps,
      phase: state.phase === 'resting' ? 'Rest' : state.phase === 'paused' ? 'Paused' : 'Training',
      restEndsAt: state.phase === 'resting' ? state.restEndsAtMs ?? 0 : 0,
    });
  }, [settings.lockScreenStatus, exDef, current, state.phase, state.setIndex, state.restEndsAtMs, state.completed, reps]);

  // "Rest over" local notification so a locked phone still alerts the user.
  useEffect(() => {
    const cancel = () => {
      if (restNotificationId.current) void Notifications.cancelScheduledNotificationAsync(restNotificationId.current).catch(() => undefined);
      restNotificationId.current = null;
    };
    cancel();
    if (state.phase === 'resting' && state.restEndsAtMs != null && settings.lockScreenStatus) {
      const seconds = Math.max(1, Math.round((state.restEndsAtMs - Date.now()) / 1000));
      void Notifications.scheduleNotificationAsync({
        content: { title: 'Rest over', body: 'Time for your next set.', data: { url: 'moveiq://workout/live' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
      }).then((id) => { restNotificationId.current = id; }).catch(() => undefined);
    }
    return cancel;
  }, [state.phase, state.restEndsAtMs, settings.lockScreenStatus]);

  const onFrame = useCallback((frame: PoseFrame) => {
    const a = analyzer.current;
    if (!a) return;
    const out = a.process(frame);
    if (out.newRep && settings.hapticOnRep) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const t = performance.now();
    if (out.newRep || out.newCue || out.newPartial || t - lastUiUpdate.current > 120) {
      lastUiUpdate.current = t;
      setSnapshot(out.snapshot);
    }
  }, [settings.hapticOnRep]);

  async function endSet() {
    if (!current || !exDef || state.phase !== 'active') return;
    setSaving(true);
    try {
      const a = analyzer.current;
      const setId = newId();
      const report = useCamera && a ? buildSetReport(a) : null;
      const completedReps = useCamera ? a?.counter.reps.length ?? 0 : manualReps;
      let pose = null;
      if (useCamera && a && settings.poseRetentionDays > 0 && a.retained.length > 0) {
        const uri = savePoseSequence(setId, a.retained, { exerciseId: exDef.id, analyzerVersion: exDef.config.version });
        pose = { fileUri: uri, frameCount: a.retained.length, expiresAt: new Date(Date.now() + settings.poseRetentionDays * 86_400_000).toISOString() };
      }
      await saveSet(db, {
        id: setId,
        sessionId,
        exercisePosition: current.position,
        setIndex: state.setIndex,
        targetReps: current.targetReps,
        completedReps,
        partialReps: useCamera ? a?.counter.partials.length ?? 0 : 0,
        source: useCamera ? 'camera' : 'manual',
        startedAt: setStartedAt.current,
        endedAt: new Date().toISOString(),
        restSec: current.restSec,
        report,
        pose,
      });
      analyzer.current = null;
      dispatch({ type: 'SET_DONE', at: Date.now(), reps: completedReps });
    } finally {
      setSaving(false);
    }
  }

  async function finish(abandon = false) {
    if (finishing.current) return;
    finishing.current = true;
    const at = Date.now();
    dispatch({ type: 'FINISH', at });
    analyzer.current = null;
    await setSessionStatus(db, sessionId, abandon ? 'abandoned' : 'completed', { activeDurationSec: Math.round(activeDurationMs(state, at) / 1000) });
    await endLockScreenStatus();
    notifyDataChanged();
    router.replace(abandon ? '/(tabs)/train' : `/workout/${sessionId}`);
  }

  // All sets done → complete automatically.
  useEffect(() => {
    if (state.phase === 'completed') void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  async function confirmFinish() {
    const hasSets = state.completed.length > 0;
    const inProgress = state.phase === 'active' && reps > 0;
    if (!hasSets && !inProgress) {
      if (await confirm('Discard workout?', 'No sets were completed. The workout will not be saved.', 'Discard')) await finish(true);
      return;
    }
    if (inProgress && (await confirm('Save current set?', `Save the ${reps} reps in this set before finishing?`, 'Save set', false))) await endSet();
    await finish();
  }

  if (!current || !exDef) return <Screen><Loading /></Screen>;

  const cameraOn = useCamera && focused && appActive && state.phase !== 'completed';
  const detecting = state.phase === 'active';
  const restLeft = state.phase === 'resting' && state.restEndsAtMs ? Math.max(0, Math.ceil((state.restEndsAtMs - now) / 1000)) : 0;
  const q = snapshot?.quality.level ?? 'none';
  const message = state.phase === 'active' ? snapshot?.guidance ?? snapshot?.lastCue?.message ?? (snapshot?.phase === 'not_ready' ? 'Hold the start position to begin counting.' : null) : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {useCamera ? (
        <PoseStream
          style={StyleSheet.absoluteFill}
          active={cameraOn}
          detecting={detecting}
          facing={settings.cameraFacing}
          showSkeleton={settings.showSkeleton}
          onFrame={onFrame}
          onFatalError={(m) => setCameraError(m)}
        />
      ) : null}
      <SafeAreaView style={{ flex: 1, justifyContent: 'space-between' }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={[styles.panel, { flexDirection: 'row', alignItems: 'center' }]}>
          <IconButton icon="close" label="Finish workout" color="#fff" onPress={confirmFinish} />
          <View style={{ flex: 1 }}>
            <Text style={[font.bodyStrong, { color: '#fff' }]}>{exDef.name}</Text>
            <Text style={[font.caption, { color: '#ddd' }]}>
              Set {state.setIndex + 1}/{current.targetSets} · target {current.targetReps} reps · {formatDuration(activeDurationMs(state, now) / 1000)}
            </Text>
          </View>
          {useCamera ? (
            <View accessibilityLabel={QUALITY_LABEL[q]} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: QUALITY_COLOR[q] }} />
              <Text style={[font.caption, { color: '#fff' }]}>{state.phase === 'active' ? QUALITY_LABEL[q] : 'Live'}</Text>
            </View>
          ) : null}
        </View>

        {cameraError ? (
          <View style={[styles.panel, { margin: 16 }]}>
            <Text style={[font.body, { color: '#fff' }]}>Camera tracking stopped: {cameraError}. You can continue by logging reps manually.</Text>
          </View>
        ) : null}

        {/* Center */}
        <View style={{ alignItems: 'center', gap: 12 }}>
          {state.phase === 'idle' ? (
            <View style={[styles.panel, { alignItems: 'center', gap: 12, padding: 20, marginHorizontal: 24 }]}>
              <Text style={[font.title, { color: '#fff', textAlign: 'center' }]}>{state.completed.length ? 'Resume workout' : 'Get in position'}</Text>
              <Text style={[font.body, { color: '#ddd', textAlign: 'center' }]}>{useCamera ? exDef.cameraSetup[0] : 'Count your reps and enter them when the set is done.'}</Text>
              <Button title={state.completed.length ? 'Resume' : 'Start set'} icon="play" onPress={() => dispatch({ type: 'START', at: Date.now() })} />
            </View>
          ) : state.phase === 'resting' ? (
            <View style={[styles.panel, { alignItems: 'center', padding: 24, gap: 8 }]} accessibilityLiveRegion="polite">
              <Text style={[font.caption, { color: '#ddd' }]}>REST</Text>
              <Text style={[font.hero, { color: '#fff' }]}>{formatDuration(restLeft)}</Text>
              <Text style={[font.body, { color: '#ddd' }]}>Next: {exDef.name}, set {state.setIndex + 1}</Text>
              <Button title="Skip rest" variant="secondary" onPress={() => dispatch({ type: 'SKIP_REST', at: Date.now() })} />
            </View>
          ) : state.phase === 'paused' ? (
            <View style={[styles.panel, { alignItems: 'center', padding: 24, gap: 8 }]}>
              <Text style={[font.title, { color: '#fff' }]}>Paused</Text>
              <Text style={[font.body, { color: '#ddd', textAlign: 'center' }]}>Camera analysis is off. Get back into the start position after resuming.</Text>
            </View>
          ) : useCamera ? (
            <View accessibilityLiveRegion="polite" accessibilityLabel={`${reps} reps`} style={{ alignItems: 'center' }}>
              <View style={{ width: 150, height: 150, borderRadius: 75, borderWidth: 6, borderColor: reps >= current.targetReps ? colors.primary : 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <Text style={[font.hero, { color: '#fff', fontSize: 64, lineHeight: 70 }]}>{reps}</Text>
                <Text style={[font.caption, { color: '#ddd' }]}>of {current.targetReps} reps</Text>
              </View>
              {snapshot && snapshot.partials > 0 ? <Text style={[font.caption, { color: '#ddd', marginTop: 6 }]}>{snapshot.partials} not counted</Text> : null}
            </View>
          ) : (
            <View style={[styles.panel, { alignItems: 'center', padding: 20, gap: 12 }]}>
              <Text style={[font.caption, { color: '#ddd' }]}>Manual reps</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
                <IconButton icon="remove-circle" label="Decrease reps" color="#fff" size={44} onPress={() => setManualReps(Math.max(0, manualReps - 1))} />
                <Text style={[font.hero, { color: '#fff' }]}>{manualReps}</Text>
                <IconButton icon="add-circle" label="Increase reps" color="#fff" size={44} onPress={() => setManualReps(manualReps + 1)} />
              </View>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={{ gap: 10, padding: 16 }}>
          {message ? (
            <View style={[styles.panel, { flexDirection: 'row', gap: 10, alignItems: 'center' }]} accessibilityLiveRegion="polite">
              <Ionicons name={snapshot?.guidance ? 'scan-outline' : 'chatbubble-ellipses-outline'} size={22} color={colors.primary} />
              <Text style={[font.body, { color: '#fff', flex: 1 }]}>{message}</Text>
            </View>
          ) : null}
          {state.phase === 'active' && reps >= current.targetReps ? (
            <Text style={[font.caption, { color: '#fff', textAlign: 'center' }]}>Target reached. Tap Done, or keep going.</Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {state.phase === 'active' || state.phase === 'resting' ? (
              <Pressable onPress={() => dispatch({ type: 'PAUSE', at: Date.now() })} accessibilityRole="button" accessibilityLabel="Pause" style={styles.round}>
                <Ionicons name="pause" size={28} color="#fff" />
              </Pressable>
            ) : state.phase === 'paused' ? (
              <Pressable onPress={() => dispatch({ type: 'RESUME', at: Date.now() })} accessibilityRole="button" accessibilityLabel="Resume" style={styles.round}>
                <Ionicons name="play" size={28} color="#fff" />
              </Pressable>
            ) : null}
            {state.phase === 'active' ? <Button title="Done with set" icon="checkmark" onPress={endSet} loading={saving} style={{ flex: 1 }} /> : null}
            {state.phase !== 'active' && state.phase !== 'idle' ? <Button title="Finish workout" variant="secondary" onPress={confirmFinish} style={{ flex: 1 }} /> : null}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: 'rgba(10,15,12,0.72)', borderRadius: 16, padding: 12, marginHorizontal: 12 },
  round: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
