import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { AccountCard } from '../../auth/AccountCard';
import { useDbQuery, useMutation } from '../../data/DbProvider';
import { deleteAllData, exportAll } from '../../db/repos/dataPortability';
import { Goal, getPrimaryGoal, getProfile, saveProfile, Profile } from '../../db/repos/profile';
import { AppSettings, getSettings, setSetting } from '../../db/repos/settings';
import { allPoseFiles, purgeExpiredPoseRefs } from '../../db/repos/workouts';
import { ActivityLevel, Sex } from '../../domain/cutting';
import { UnitSystem, cmToIn, inToCm, parseDecimal } from '../../domain/units';
import { ENGINE_INFO } from '../../motion/adapters/MediaPipePoseStream';
import { deletePoseFiles } from '../../motion/poseStorage';
import { Button, Card, ChipSelect, ErrorState, ListItem, Loading, Screen, SectionHeader, Segmented, TextField, Title, confirm } from '../../ui/components';
import { useTheme } from '../../ui/theme';

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors, font } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { color: colors.text }]}>{label}</Text>
        {hint ? <Text style={[font.caption, { color: colors.textMuted }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: colors.primary }} />
    </View>
  );
}

type ProfileData = { profile: Profile | null; settings: AppSettings; goal: Goal | null; poseFiles: number };

export default function ProfileScreen() {
  const q = useDbQuery(async (db): Promise<ProfileData> => ({ profile: await getProfile(db), settings: await getSettings(db), goal: await getPrimaryGoal(db), poseFiles: (await allPoseFiles(db)).length }));
  if (q.status === 'loading') return <Screen><Loading /></Screen>;
  if (q.status === 'error') return <Screen><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  if (!q.data.profile) return <Screen><ErrorState error={new Error('No profile yet. Restart the app to complete onboarding.')} /></Screen>;
  return <ProfileForm data={q.data} profile={q.data.profile} />;
}

function ProfileForm({ data, profile }: { data: ProfileData; profile: Profile }) {
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const [draft, setDraft] = useState<Profile & { heightText: string }>(() => ({
    ...profile,
    heightText: profile.heightCm == null ? '' : (profile.unitSystem === 'imperial' ? cmToIn(profile.heightCm) : profile.heightCm).toFixed(0),
  }));
  const [busy, setBusy] = useState<string | null>(null);
  const s = data.settings;
  const setS = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => mutate((db) => setSetting(db, k, v));

  async function saveProfileDraft() {
    const h = parseDecimal(draft.heightText);
    const heightCm = h == null ? null : draft.unitSystem === 'imperial' ? inToCm(h) : h;
    await mutate((db) => saveProfile(db, { ...draft, heightCm: heightCm && heightCm >= 50 && heightCm <= 260 ? heightCm : null }));
  }

  async function exportData() {
    setBusy('export');
    try {
      const data = await mutate((db) => exportAll(db));
      const file = new File(Paths.cache, `moveiq-export-${data.exportedAt.slice(0, 10)}.json`);
      file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export MoveIQ data' });
    } finally {
      setBusy(null);
    }
  }

  async function wipe() {
    if (!(await confirm('Delete all data?', 'This permanently deletes your profile, workouts, movement data, weights, nutrition and activities from this device.', 'Delete everything'))) return;
    const files = await mutate((db) => deleteAllData(db));
    deletePoseFiles(files);
    router.replace('/onboarding');
  }

  return (
    <Screen>
      <Title>Profile & settings</Title>

      <SectionHeader title="Account" />
      <AccountCard />

      <SectionHeader title="Profile" />
      <Card>
        <TextField label="Name" value={draft.displayName ?? ''} onChangeText={(v) => setDraft({ ...draft, displayName: v || null })} />
        <Segmented<UnitSystem> label="Units" value={draft.unitSystem} onChange={(unitSystem) => {
          const h = parseDecimal(draft.heightText);
          const heightText = h == null ? '' : (unitSystem === 'imperial' ? cmToIn(draft.unitSystem === 'imperial' ? inToCm(h) : h) : draft.unitSystem === 'imperial' ? inToCm(h) : h).toFixed(0);
          setDraft({ ...draft, unitSystem, heightText });
        }} options={[{ value: 'metric', label: 'Metric (kg, km)' }, { value: 'imperial', label: 'Imperial (lb, mi)' }]} />
        <TextField label={`Height (${draft.unitSystem === 'imperial' ? 'in' : 'cm'})`} value={draft.heightText} onChangeText={(heightText) => setDraft({ ...draft, heightText })} keyboardType="decimal-pad" />
        <TextField label="Birth year" value={draft.birthYear?.toString() ?? ''} onChangeText={(v) => setDraft({ ...draft, birthYear: /^\d{4}$/.test(v) ? Number(v) : null })} keyboardType="number-pad" />
        <Segmented<Sex | 'unspecified'> label="Sex (optional, only for energy estimates)" value={draft.sex ?? 'unspecified'} onChange={(v) => setDraft({ ...draft, sex: v === 'unspecified' ? null : v })}
          options={[{ value: 'unspecified', label: 'Not set' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }]} />
        <ChipSelect<ActivityLevel> label="Activity level" value={draft.activityLevel} onChange={(activityLevel) => setDraft({ ...draft, activityLevel })}
          options={[{ value: 'sedentary', label: 'Sedentary' }, { value: 'light', label: 'Light' }, { value: 'moderate', label: 'Moderate' }, { value: 'active', label: 'Active' }, { value: 'very_active', label: 'Very active' }]} />
        <Button title="Save profile" variant="secondary" onPress={saveProfileDraft} />
      </Card>
      <Card>
        <ListItem icon="flag-outline" title="Goal & targets" subtitle={`${data.goal?.kind ?? 'No goal'} · targets ${data.settings.autoTargets ? 'calculated automatically' : 'set manually'}`} onPress={() => router.push('/goal')} />
      </Card>

      <SectionHeader title="Camera coaching" />
      <Card>
        <Segmented<'front' | 'back'> label="Camera" value={s.cameraFacing} onChange={(v) => setS('cameraFacing', v)} options={[{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }]} />
        <ToggleRow label="Show skeleton overlay" value={s.showSkeleton} onChange={(v) => setS('showSkeleton', v)} />
        <ToggleRow label="Vibrate on each rep" value={s.hapticOnRep} onChange={(v) => setS('hapticOnRep', v)} />
        <ToggleRow label="Show workout on lock screen" hint="Live Activity on iOS, ongoing notification on Android, plus a 'rest over' alert. Camera counting pauses while the phone is locked." value={s.lockScreenStatus} onChange={(v) => setS('lockScreenStatus', v)} />
        <Text style={[font.caption, { color: colors.textMuted }]}>Engine: {ENGINE_INFO.engine}, model {ENGINE_INFO.model}. Runs on-device.</Text>
      </Card>

      <SectionHeader title="Privacy" />
      <Card>
        <ChipSelect label="Keep movement data for post-workout analysis" value={String(s.poseRetentionDays)} onChange={(v) => setS('poseRetentionDays', Number(v))}
          options={[{ value: '0', label: 'Don’t keep' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
        <Text style={[font.caption, { color: colors.textMuted }]}>
          Only body-landmark coordinates (13 body points, about 15 per second) are stored, never video. They stay on this device and are excluded from exports. Currently stored: {data.poseFiles} set(s).
        </Text>
        <Button title="Delete stored movement data now" variant="secondary" onPress={async () => {
          if (!(await confirm('Delete movement data?', 'Workout summaries are kept. Re-analysis won’t be available for past sets.'))) return;
          const files = await mutate((db) => purgeExpiredPoseRefs(db, '9999-12-31'));
          deletePoseFiles(files);
        }} />
      </Card>

      <SectionHeader title="Your data" />
      <Card>
        <Button title="Export all data (JSON)" icon="download-outline" variant="secondary" loading={busy === 'export'} onPress={exportData} />
        <Button title="Delete all data" icon="trash-outline" variant="danger" onPress={wipe} />
      </Card>

      <Text style={[font.caption, { color: colors.textMuted, textAlign: 'center' }]}>MoveIQ provides fitness information, not medical advice.</Text>
    </Screen>
  );
}
