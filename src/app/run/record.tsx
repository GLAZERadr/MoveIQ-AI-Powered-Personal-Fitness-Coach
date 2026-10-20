import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { getAppDb, notifyDataChanged } from '../../data/DbProvider';
import { fmtDistance, fmtRunPaceFromSecPerKm } from '../../data/format';
import { getRecordingPoints, getRecordingState, RecordingState } from '../../db/repos/gps';
import { getProfile } from '../../db/repos/profile';
import { GpsPoint, currentPaceSecPerKm, simplifyForMap, trackStats } from '../../domain/gps';
import { UnitSystem, formatDuration } from '../../domain/units';
import { RouteMap } from '../../gps/RouteMap';
import { discardRecording, ensureLocationReady, finishRecording, pauseRecording, resumeRecording, startRecording } from '../../gps/recorder';
import { Button, Card, Notice, Row, Screen, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

/** GPS signal quality from horizontal accuracy (meters). */
function signal(acc: number | null): { label: string; tone: 'good' | 'ok' | 'bad' } {
  if (acc == null) return { label: 'Searching for GPS…', tone: 'bad' };
  if (acc <= 10) return { label: `GPS strong (±${Math.round(acc)} m)`, tone: 'good' };
  if (acc <= 25) return { label: `GPS ok (±${Math.round(acc)} m)`, tone: 'ok' };
  return { label: `GPS weak (±${Math.round(acc)} m). Move to open sky`, tone: 'bad' };
}

export default function RecordRun() {
  const { colors, font } = useTheme();
  const [state, setState] = useState<RecordingState | null>(null);
  const [points, setPoints] = useState<GpsPoint[]>([]);
  const [sys, setSys] = useState<UnitSystem>('metric');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; settings?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const refresh = useCallback(async () => {
    const db = await getAppDb();
    setState(await getRecordingState(db));
    setPoints(await getRecordingPoints(db));
  }, []);

  useEffect(() => {
    void (async () => {
      const db = await getAppDb();
      setSys((await getProfile(db))?.unitSystem ?? 'metric');
      await refresh();
    })();
    const t = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  // Before starting: warm up GPS in the foreground so the user can see signal quality.
  useEffect(() => {
    if (state) {
      watcher.current?.remove();
      watcher.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      const ready = await ensureLocationReady();
      if (!ready.ok) {
        if (!cancelled) setError({ text: ready.reason, settings: ready.canOpenSettings });
        return;
      }
      setError(null);
      const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (l) => setAccuracy(l.coords.accuracy));
      if (cancelled) sub.remove();
      else watcher.current = sub;
    })();
    return () => {
      cancelled = true;
      watcher.current?.remove();
      watcher.current = null;
    };
  }, [state]);

  const stats = trackStats(points);
  const last = points[points.length - 1];
  // Live elapsed: completed movement plus time since the last fix while recording.
  const liveElapsed = stats.elapsedSec + (state?.status === 'recording' && last && last.segment === state.segment ? Math.max(0, (now - last.t) / 1000) : 0);
  const avgPace = stats.distanceM > 20 ? stats.movingSec / (stats.distanceM / 1000) : null;
  const curPace = state?.status === 'recording' ? currentPaceSecPerKm(points) : null;
  const dist = fmtDistance(stats.distanceM, sys);
  const sig = signal(state ? (last?.accuracy ?? null) : accuracy);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!(await confirm('Finish run?', 'Save this run with its route and splits.', 'Finish', false))) return;
    setBusy(true);
    try {
      const res = await finishRecording();
      if (!res.ok) return setError({ text: res.reason });
      notifyDataChanged();
      router.replace(`/run/${res.activityId}`);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!(await confirm('Discard run?', 'The recorded route will be deleted.', 'Discard'))) return;
    await act(discardRecording);
    router.back();
  }

  return (
    <Screen edges={[]}>
      <RouteMap points={simplifyForMap(points)} follow={!!state} height={260} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: sig.tone === 'good' ? colors.primary : sig.tone === 'ok' ? colors.warning : colors.danger }} />
        <Text style={[font.caption, { color: colors.textMuted }]}>{state?.status === 'paused' ? 'Paused: GPS off' : sig.label}</Text>
      </View>

      <Card>
        <Text style={[font.caption, { color: colors.textMuted }]}>Time</Text>
        <Text style={[font.hero, { color: colors.text, fontSize: 56, lineHeight: 62 }]}>{formatDuration(liveElapsed)}</Text>
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={[font.caption, { color: colors.textMuted }]}>Distance</Text>
            <Text style={[font.metric, { color: colors.text }]}>{dist.value} <Text style={[font.body, { color: colors.textMuted }]}>{dist.unit}</Text></Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.caption, { color: colors.textMuted }]}>Current pace</Text>
            <Text style={[font.metric, { color: colors.text }]}>{curPace ? fmtRunPaceFromSecPerKm(curPace, sys) : '–'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.caption, { color: colors.textMuted }]}>Avg pace</Text>
            <Text style={[font.metric, { color: colors.text }]}>{avgPace ? fmtRunPaceFromSecPerKm(avgPace, sys) : '–'}</Text>
          </View>
        </Row>
        {stats.splits.length > 0 ? (
          <Text style={[font.caption, { color: colors.textMuted }]}>Last split: {formatDuration(stats.splits[stats.splits.length - 1]!.durationSec)}</Text>
        ) : null}
      </Card>

      {error ? (
        <Notice tone="warning">{error.text}</Notice>
      ) : null}
      {error?.settings ? <Button title="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} /> : null}

      {!state ? (
        <>
          <Button title="Start run" icon="play" loading={busy}
            onPress={() => act(async () => {
              const r = await startRecording();
              if (!r.ok) setError({ text: r.reason, settings: r.canOpenSettings });
            })} />
          {accuracy != null && accuracy > 25 ? <Text style={[font.caption, { color: colors.textMuted }]}>Tip: wait for a strong GPS signal for a more accurate start.</Text> : null}
          <Text style={[font.caption, { color: colors.textMuted }]}>
            Recording keeps going with the screen off. You’ll see a “Recording your run” notification. Location is used only while recording and the route stays on your phone.
          </Text>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {state.status === 'recording' ? (
            <Button title="Pause" icon="pause" variant="secondary" loading={busy} onPress={() => act(pauseRecording)} style={{ flex: 1 }} />
          ) : (
            <Button title="Resume" icon="play" variant="secondary" loading={busy} onPress={() => act(resumeRecording)} style={{ flex: 1 }} />
          )}
          <Button title="Finish" icon="flag" loading={busy} onPress={finish} style={{ flex: 1 }} />
        </View>
      )}
      {state ? <Button title="Discard run" variant="ghost" onPress={discard} /> : null}
    </Screen>
  );
}
