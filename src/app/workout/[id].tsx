import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { deleteSession, getSession, getSessionExercises, updateSessionNotes } from '../../db/repos/workouts';
import { formatShortDate } from '../../domain/dates';
import { formatDuration } from '../../domain/units';
import { getExercise } from '../../motion/exercises';
import { deletePoseFiles, readPoseSequence } from '../../motion/poseStorage';
import { DEVIATION_LABELS, SetReport, improvementAreas, reanalyze } from '../../motion/report';
import {
  Button, Card, ChipSelect, ErrorState, KeyValue, Loading, Notice, ProvenanceBadge, Screen, SectionHeader, TextField, Title, confirm,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';

const ms = (v: number | null) => (v == null ? '–' : `${(v / 1000).toFixed(1)} s`);
const deg = (v: number | null) => (v == null ? '–' : `${Math.round(v)}°`);

function SetReportView({ report, reanalyzed }: { report: SetReport; reanalyzed?: SetReport | null }) {
  const { colors, font } = useTheme();
  const r = reanalyzed ?? report;
  const areas = improvementAreas(r);
  return (
    <View style={{ gap: 2 }}>
      {reanalyzed ? <Notice>Re-analysed from the stored landmark sequence (analyzer v{reanalyzed.analyzerVersion}).</Notice> : null}
      <KeyValue label="Counted reps" value={String(r.reps)} provenance="camera" />
      <KeyValue label="Not counted" value={`${r.partials.insufficient_depth} too shallow · ${r.partials.too_fast} too fast · ${r.partials.tracking_lost} tracking lost`} />
      <KeyValue label="Range of motion (avg ± SD)" value={`${deg(r.romMeanDeg)} ± ${deg(r.romStdDeg)}`} provenance="estimate" />
      <KeyValue label="Lowest angle (avg ± SD)" value={`${deg(r.depthMeanDeg)} ± ${deg(r.depthStdDeg)}`} provenance="estimate" />
      <KeyValue label="Tempo: lowering / rising" value={`${ms(r.tempo.descentMeanMs)} / ${ms(r.tempo.ascentMeanMs)}`} />
      <KeyValue label="Rep duration consistency" value={r.tempo.repCv == null ? '–' : `${Math.round((1 - Math.min(1, r.tempo.repCv)) * 100)}%`} />
      <KeyValue label="Tracking confidence" value={`${Math.round(r.tracking.meanScore * 100)}% · good in ${Math.round(r.tracking.goodFramePct)}% of frames`} />
      {r.deviations.length > 0 ? (
        <>
          <Text style={[font.bodyStrong, { color: colors.text, marginTop: 8 }]}>Possible technique deviations</Text>
          {r.deviations.map((d) => (
            <Text key={d.id} style={[font.caption, { color: colors.textMuted }]}>• {DEVIATION_LABELS[d.id] ?? d.id}: {d.reps} of {r.reps} well-tracked reps</Text>
          ))}
        </>
      ) : r.reps > 0 ? <Text style={[font.caption, { color: colors.textMuted, marginTop: 8 }]}>No consistent deviations detected in well-tracked reps.</Text> : null}
      {areas.length > 0 ? (
        <>
          <Text style={[font.bodyStrong, { color: colors.text, marginTop: 8 }]}>Areas to improve</Text>
          {areas.map((a) => <Text key={a} style={[font.caption, { color: colors.textMuted }]}>• {a}</Text>)}
        </>
      ) : null}
      <Text style={[font.bodyStrong, { color: colors.text, marginTop: 8 }]}>Data-quality notes</Text>
      {r.limitations.map((l) => <Text key={l} style={[font.caption, { color: colors.textMuted }]}>• {l}</Text>)}
    </View>
  );
}

export default function WorkoutReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const q = useDbQuery(async (db) => ({ session: await getSession(db, id), exercises: await getSessionExercises(db, id) }), [id]);
  const [rpe, setRpe] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [reanalyzed, setReanalyzed] = useState<Record<string, SetReport | null>>({});

  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const { session, exercises } = q.data;
  if (!session) return <Screen edges={[]}><ErrorState error={new Error('Workout not found.')} /></Screen>;

  const totalReps = exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.completedReps, 0), 0);
  const rpeValue = rpe ?? (session.rpe ? String(session.rpe) : null);
  const notesValue = notes ?? session.notes ?? '';

  async function runReanalysis(setId: string, uri: string, exerciseId: string) {
    const ex = getExercise(exerciseId);
    const seq = await readPoseSequence(uri);
    if (!ex || !seq) {
      setReanalyzed((m) => ({ ...m, [setId]: null }));
      return;
    }
    setReanalyzed((m) => ({ ...m, [setId]: reanalyze(ex, seq.frames) }));
  }

  return (
    <Screen edges={[]}>
      <Title subtitle={`${formatShortDate(session.localDate)} · ${formatDuration(session.activeDurationSec)} active`}>
        {session.status === 'completed' ? 'Workout complete' : session.status === 'abandoned' ? 'Workout discarded' : 'Workout in progress'}
      </Title>
      <Card>
        <KeyValue label="Total reps" value={String(totalReps)} />
        <KeyValue label="Sets" value={String(exercises.reduce((a, e) => a + e.sets.length, 0))} />
        <KeyValue label="Active time" value={formatDuration(session.activeDurationSec)} />
      </Card>

      {exercises.map((e) => (
        <View key={e.id} style={{ gap: 8 }}>
          <SectionHeader title={e.exerciseName} />
          {e.sets.length === 0 ? <Text style={[font.caption, { color: colors.textMuted }]}>No sets recorded.</Text> : null}
          {e.sets.map((s) => (
            <Card key={s.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[font.bodyStrong, { color: colors.text }]}>Set {s.setIndex + 1}: {s.completedReps}{s.targetReps ? ` / ${s.targetReps}` : ''} reps</Text>
                <ProvenanceBadge kind={s.source === 'camera' ? 'camera' : 'manual'} />
              </View>
              {s.report ? <SetReportView report={s.report} reanalyzed={reanalyzed[s.id]} /> : <Text style={[font.caption, { color: colors.textMuted }]}>Logged manually, no motion analysis.</Text>}
              {s.poseFileUri && !(s.id in reanalyzed) ? (
                <Button title="Re-analyse from stored movement" variant="ghost" icon="refresh" onPress={() => runReanalysis(s.id, s.poseFileUri!, e.exerciseId)} />
              ) : null}
              {s.id in reanalyzed && reanalyzed[s.id] === null ? <Notice tone="warning">The stored movement data is no longer available.</Notice> : null}
            </Card>
          ))}
        </View>
      ))}

      <SectionHeader title="How did it feel?" />
      <Card>
        <ChipSelect label="Perceived exertion (RPE 1–10, optional)" value={rpeValue}
          onChange={(v) => setRpe(v)}
          options={Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
        <TextField label="Notes" value={notesValue} onChangeText={setNotes} multiline />
        <Button title="Save" variant="secondary" onPress={() => mutate((db) => updateSessionNotes(db, id, rpeValue ? Number(rpeValue) : null, notesValue.trim() || null))} />
      </Card>

      {session.status === 'completed' ? (
        <Button title="Share workout" icon="share-social-outline" onPress={() => router.push({ pathname: '/share', params: { type: 'workout', id } })} />
      ) : null}
      <Button title="Delete workout" variant="danger" icon="trash-outline" onPress={async () => {
        if (!(await confirm('Delete this workout?', 'Its sets, report and stored movement data will be permanently deleted.'))) return;
        const files = await mutate((db) => deleteSession(db, id));
        deletePoseFiles(files);
        router.back();
      }} />
    </Screen>
  );
}
