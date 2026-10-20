import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Image, Share, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { CloudError, SharePayload, cloud, resolveApiUrl } from '../cloud/client';
import { useDbQuery, useMutation } from '../data/DbProvider';
import { fmtDistance, fmtRunPace, fmtSwimDistance, fmtSwimPace } from '../data/format';
import { getRun, getSwim } from '../db/repos/activities';
import { getProfile } from '../db/repos/profile';
import { getSettings } from '../db/repos/settings';
import { getSession, getSessionExercises } from '../db/repos/workouts';
import { Db } from '../db/types';
import { formatShortDate } from '../domain/dates';
import { formatDuration } from '../domain/units';
import { setUnit } from '../motion/exercises';
import { nowIso } from '../lib/id';
import { Button, ErrorState, Loading, Notice, Screen } from '../ui/components';

const LOGO = require('../../assets/logo.png');

type ShareType = 'run' | 'swim' | 'workout';

interface CardData {
  kind: ShareType;
  title: string;
  date: string;
  hero: { value: string; unit: string };
  stats: { label: string; value: string }[];
  bars: number[] | null;
}

async function load(db: Db, type: ShareType, id: string): Promise<{ card: CardData; existingLink: { id: string; url: string } | null; apiUrl: string | null }> {
  const sys = (await getProfile(db))?.unitSystem ?? 'metric';
  const settings = await getSettings(db);
  const link = await db.first<{ id: string; url: string }>('SELECT id, url FROM share_links WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL', [type, id]);
  let card: CardData;
  if (type === 'run') {
    const r = await getRun(db, id);
    if (!r) throw new Error('Run not found.');
    const d = fmtDistance(r.distanceM, sys);
    const p = fmtRunPace(r.durationSec, r.distanceM, sys);
    card = {
      kind: 'run', title: `${r.kind === 'treadmill' ? 'Treadmill' : r.kind === 'trail' ? 'Trail' : 'Outdoor'} run`, date: r.localDate,
      hero: { value: d.value, unit: d.unit },
      stats: [{ label: 'Pace', value: `${p.value}${p.unit}` }, { label: 'Time', value: formatDuration(r.durationSec) }, ...(r.avgHr ? [{ label: 'Avg HR', value: `${r.avgHr} bpm` }] : []), ...(r.elevationGainM ? [{ label: 'Elev', value: `${Math.round(r.elevationGainM)} m` }] : [])],
      bars: r.splits.length >= 2 ? r.splits.map((s) => s.durationSec / s.distanceM) : null,
    };
  } else if (type === 'swim') {
    const s = await getSwim(db, id);
    if (!s) throw new Error('Swim not found.');
    card = {
      kind: 'swim', title: `${s.environment === 'pool' ? 'Pool' : 'Open-water'} swim`, date: s.localDate,
      hero: { value: fmtSwimDistance(s.distanceM).replace(/ (m|km)$/, ''), unit: fmtSwimDistance(s.distanceM).endsWith('km') ? 'km' : 'm' },
      stats: [{ label: 'Pace', value: fmtSwimPace(s.durationSec, s.distanceM) }, { label: 'Time', value: formatDuration(s.durationSec) }, ...(s.stroke ? [{ label: 'Stroke', value: s.stroke }] : [])],
      bars: null,
    };
  } else {
    const s = await getSession(db, id);
    if (!s) throw new Error('Workout not found.');
    const ex = await getSessionExercises(db, id);
    const total = ex.filter((e) => setUnit(e.exerciseId) === 'reps').reduce((a, e) => a + e.sets.reduce((b, x) => b + x.completedReps, 0), 0);
    card = {
      kind: 'workout', title: 'Bodyweight workout', date: s.localDate,
      hero: { value: String(total), unit: 'reps' },
      stats: [
        ...ex.filter((e) => e.sets.length).map((e) => ({ label: e.exerciseName, value: e.sets.map((x) => x.completedReps).join(' · ') + (setUnit(e.exerciseId) === 's' ? ' s' : '') })),
        { label: 'Time', value: formatDuration(s.activeDurationSec) },
      ],
      bars: ex.flatMap((e) => e.sets.map((x) => x.completedReps)),
    };
  }
  return { card, existingLink: link, apiUrl: resolveApiUrl(settings.cloudApiUrl) };
}

function ShareCard({ card }: { card: CardData }) {
  const icon = card.kind === 'run' ? 'walk' : card.kind === 'swim' ? 'water' : 'body';
  const max = card.bars ? Math.max(...card.bars) : 1;
  return (
    <View style={{ backgroundColor: '#0B1F17', borderRadius: 20, padding: 22, gap: 14, aspectRatio: 4 / 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Image source={LOGO} style={{ width: 30, height: 30, borderRadius: 8 }} accessibilityIgnoresInvertColors />
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>MoveIQ</Text>
        <Text style={{ color: '#9FB8AB', marginLeft: 'auto' }}>{formatShortDate(card.date)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon} size={22} color="#1FC96B" />
        <Text style={{ color: '#CFE3D8', fontSize: 16, fontWeight: '600' }}>{card.title}</Text>
      </View>
      <Text style={{ color: '#fff', fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {card.hero.value}<Text style={{ fontSize: 22, color: '#9FB8AB' }}> {card.hero.unit}</Text>
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
        {card.stats.map((s) => (
          <View key={s.label}>
            <Text style={{ color: '#9FB8AB', fontSize: 12 }}>{s.label}</Text>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{s.value}</Text>
          </View>
        ))}
      </View>
      {card.bars ? (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4, minHeight: 50 }}>
          {card.bars.map((b, i) => (
            <View key={i} style={{ flex: 1, height: `${Math.max(8, (b / max) * 100)}%`, backgroundColor: '#1FC96B', opacity: 0.85, borderRadius: 3 }} />
          ))}
        </View>
      ) : <View style={{ flex: 1 }} />}
    </View>
  );
}

export default function ShareScreen() {
  const { type, id } = useLocalSearchParams<{ type: ShareType; id: string }>();
  const mutate = useMutation();
  const q = useDbQuery((db) => load(db, type, id), [type, id]);
  const cardRef = useRef<React.ComponentRef<typeof View>>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const { card, existingLink, apiUrl } = q.data;

  async function shareImage() {
    setBusy('image');
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share activity', UTI: 'public.png' });
    } catch (e) {
      setMsg({ tone: 'danger', text: `Could not create the image: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function createLink() {
    setBusy('link');
    setMsg(null);
    try {
      const imagePngBase64 = await captureRef(cardRef, { format: 'png', quality: 0.9, result: 'base64', width: 800 });
      const payload: SharePayload = { kind: card.kind, title: card.title, date: card.date, stats: [{ label: card.hero.unit, value: card.hero.value }, ...card.stats], imagePngBase64 };
      const res = await cloud.createShare(apiUrl, payload);
      await mutate((db) => db.run('INSERT OR REPLACE INTO share_links (id, entity_type, entity_id, url, created_at) VALUES (?, ?, ?, ?, ?)', [res.id, type, id, res.url, nowIso()]));
      await Share.share({ message: `${card.title}: ${card.hero.value} ${card.hero.unit} ${res.url}`, url: res.url });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof CloudError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!existingLink) return;
    setBusy('revoke');
    try {
      await cloud.revokeShare(apiUrl, existingLink.id);
      await mutate((db) => db.run('UPDATE share_links SET revoked_at = ? WHERE id = ?', [nowIso(), existingLink.id]));
      setMsg({ tone: 'info', text: 'Link revoked. It no longer works.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof CloudError ? e.message : (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen edges={[]}>
      <View ref={cardRef} collapsable={false}>
        <ShareCard card={card} />
      </View>
      <Button title="Share image" icon="image-outline" loading={busy === 'image'} onPress={shareImage} accessibilityHint="Opens the share sheet with an image of this card. Works offline." />
      {existingLink ? (
        <>
          <Notice>{`Public link: ${existingLink.url}`}</Notice>
          <Button title="Share link again" variant="secondary" icon="link-outline" onPress={() => Share.share({ message: existingLink.url, url: existingLink.url })} />
          <Button title="Revoke link" variant="danger" loading={busy === 'revoke'} onPress={revoke} />
        </>
      ) : (
        <Button title="Create public link" variant="secondary" icon="link-outline" loading={busy === 'link'} onPress={createLink}
          accessibilityHint="Uploads this summary card to the MoveIQ cloud so anyone with the link can view it." />
      )}
      <Notice>A public link uploads only this summary card and the stats shown. Anyone with the link can view it until you revoke it.</Notice>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Screen>
  );
}
