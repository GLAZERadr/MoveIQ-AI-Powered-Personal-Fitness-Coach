import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import { Platform, Share, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { CloudError, SharePayload, cloud, resolveApiUrl } from '../cloud/client';
import { useDbQuery, useMutation } from '../data/DbProvider';
import { fmtDistance, fmtRunPace, fmtSwimDistance, fmtSwimPace } from '../data/format';
import { getRun, getSwim } from '../db/repos/activities';
import { getTrack } from '../db/repos/gps';
import { simplifyForMap } from '../domain/gps';
import { CardData, EXPORT_WIDTH, PREVIEW_WIDTH, ShareCard, ShareFormat } from '../share/ShareCard';
import { getProfile } from '../db/repos/profile';
import { getSettings } from '../db/repos/settings';
import { getSession, getSessionExercises } from '../db/repos/workouts';
import { Db } from '../db/types';
import { formatDuration } from '../domain/units';
import { setUnit } from '../motion/exercises';
import { nowIso } from '../lib/id';
import { Button, ErrorState, Loading, Notice, Screen, Segmented } from '../ui/components';
import { useTheme } from '../ui/theme';

type ShareType = 'run' | 'swim' | 'workout';

async function load(db: Db, type: ShareType, id: string): Promise<{ card: CardData; existingLink: { id: string; url: string } | null; apiUrl: string | null }> {
  const sys = (await getProfile(db))?.unitSystem ?? 'metric';
  const settings = await getSettings(db);
  const link = await db.first<{ id: string; url: string }>('SELECT id, url FROM share_links WHERE entity_type = ? AND entity_id = ? AND revoked_at IS NULL', [type, id]);
  let card: CardData;
  if (type === 'run') {
    const r = await getRun(db, id);
    if (!r) throw new Error('Run not found.');
    const track = await getTrack(db, id);
    const d = fmtDistance(r.distanceM, sys);
    const p = fmtRunPace(r.durationSec, r.distanceM, sys);
    card = {
      kind: 'run', title: `${r.kind === 'treadmill' ? 'Treadmill' : r.kind === 'trail' ? 'Trail' : 'Outdoor'} run`, date: r.localDate,
      hero: { value: d.value, unit: d.unit },
      stats: [{ label: 'Pace', value: `${p.value}${p.unit}` }, { label: 'Time', value: formatDuration(r.durationSec) }, ...(r.avgHr ? [{ label: 'Avg HR', value: `${r.avgHr} bpm` }] : []), ...(r.elevationGainM ? [{ label: 'Elev', value: `${Math.round(r.elevationGainM)} m` }] : [])],
      // Speed per split (m/s): taller bar = faster km.
      bars: r.splits.length >= 2 ? r.splits.map((s) => s.distanceM / s.durationSec) : null,
      barsLabel: r.splits.length >= 2 ? 'Speed per split' : null,
      route: track.length > 1 ? simplifyForMap(track, 15) : null,
    };
  } else if (type === 'swim') {
    const s = await getSwim(db, id);
    if (!s) throw new Error('Swim not found.');
    card = {
      kind: 'swim', title: `${s.environment === 'pool' ? 'Pool' : 'Open-water'} swim`, date: s.localDate,
      hero: { value: fmtSwimDistance(s.distanceM).replace(/ (m|km)$/, ''), unit: fmtSwimDistance(s.distanceM).endsWith('km') ? 'km' : 'm' },
      stats: [{ label: 'Pace', value: fmtSwimPace(s.durationSec, s.distanceM) }, { label: 'Time', value: formatDuration(s.durationSec) }, ...(s.stroke ? [{ label: 'Stroke', value: s.stroke }] : [])],
      bars: null,
      barsLabel: null,
      route: null,
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
      bars: ex.filter((e) => setUnit(e.exerciseId) === 'reps').flatMap((e) => e.sets.map((x) => x.completedReps)),
      barsLabel: 'Reps per set',
      route: null,
    };
  }
  return { card, existingLink: link, apiUrl: resolveApiUrl(settings.cloudApiUrl) };
}

const FORMATS: { value: ShareFormat; label: string }[] = [
  { value: 'post', label: 'Post 4:5' },
  { value: 'story', label: 'Story 9:16' },
  { value: 'sticker', label: 'Sticker' },
];

export default function ShareScreen() {
  const { type, id } = useLocalSearchParams<{ type: ShareType; id: string }>();
  const { colors, font } = useTheme();
  const mutate = useMutation();
  const q = useDbQuery((db) => load(db, type, id), [type, id]);
  const cardRef = useRef<React.ComponentRef<typeof View>>(null);
  // Hidden Post-format copy: public links always use the opaque 4:5 card as their preview image.
  const linkCardRef = useRef<React.ComponentRef<typeof View>>(null);
  const [format, setFormat] = useState<ShareFormat>('post');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);

  if (q.status === 'loading') return <Screen edges={[]}><Loading /></Screen>;
  if (q.status === 'error') return <Screen edges={[]}><ErrorState error={q.error} onRetry={q.reload} /></Screen>;
  const { card, existingLink, apiUrl } = q.data;

  // PNG keeps the sticker's transparency; exported at 1080 px wide (1080×1350 post, 1080×1920 story).
  const capture = (result: 'tmpfile' | 'base64', ref = cardRef, width = EXPORT_WIDTH) =>
    captureRef(ref, { format: 'png', quality: 1, result, width });

  async function shareImage() {
    setBusy('image');
    setMsg(null);
    try {
      const uri = await capture('tmpfile');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share activity', UTI: 'public.png' });
    } catch (e) {
      setMsg({ tone: 'danger', text: `Could not create the image: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function saveImage() {
    setBusy('save');
    setMsg(null);
    try {
      // Android 10+: adding our own image to MediaStore needs no permission, so MoveIQ never asks to
      // read your photos. Older Android would need storage access, which we don't request.
      if (Platform.OS === 'android' && Number(Platform.Version) < 29) {
        setMsg({ tone: 'danger', text: 'Saving needs Android 10 or newer. Use Share image and pick your gallery app instead.' });
        return;
      }
      if (Platform.OS === 'ios') {
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          setMsg({ tone: 'danger', text: 'Allow MoveIQ to add photos to save the image.' });
          return;
        }
      }
      await MediaLibrary.Asset.create(await capture('tmpfile'));
      setMsg({
        tone: 'info',
        text: format === 'sticker'
          ? 'Sticker saved to your gallery. In Instagram Stories, tap the sticker icon → Photo (gallery) and pick it to place it on your photo.'
          : 'Saved to your gallery.',
      });
    } catch (e) {
      setMsg({ tone: 'danger', text: `Could not save the image: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function createLink() {
    setBusy('link');
    setMsg(null);
    try {
      const imagePngBase64 = await capture('base64', linkCardRef, 800);
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
      <Segmented value={format} onChange={setFormat} options={FORMATS} />
      {/* Checkerboard behind the sticker preview shows which parts are transparent. */}
      <View style={{ alignItems: 'center', borderRadius: 16, padding: format === 'sticker' ? 12 : 0, backgroundColor: format === 'sticker' ? '#6B7A72' : 'transparent' }}>
        <View ref={cardRef} collapsable={false} style={{ width: PREVIEW_WIDTH }}>
          <ShareCard card={card} format={format} />
        </View>
      </View>
      {format === 'sticker' ? (
        <Text style={[font.caption, { color: colors.textMuted }]}>Transparent background (shown grey here). Save it, then add it to a photo in Instagram Stories with the sticker tool.</Text>
      ) : null}
      {card.kind === 'run' && !card.route ? (
        <Text style={[font.caption, { color: colors.textMuted }]}>Record runs with GPS to get your route on the card.</Text>
      ) : null}
      <Button title="Share image" icon="share-social-outline" loading={busy === 'image'} disabled={busy != null} onPress={shareImage} accessibilityHint="Opens the share sheet with this image. Works offline." />
      <Button title="Save to photos" icon="download-outline" variant="secondary" loading={busy === 'save'} disabled={busy != null} onPress={saveImage} />
      {existingLink ? (
        <>
          <Notice>{`Public link: ${existingLink.url}`}</Notice>
          <Button title="Share link again" variant="secondary" icon="link-outline" onPress={() => Share.share({ message: existingLink.url, url: existingLink.url })} />
          <Button title="Revoke link" variant="danger" loading={busy === 'revoke'} onPress={revoke} />
        </>
      ) : (
        <Button title="Create public link" variant="secondary" icon="link-outline" loading={busy === 'link'} disabled={busy != null} onPress={createLink}
          accessibilityHint="Uploads the summary card so anyone with the link can view it." />
      )}
      <Notice>A public link uploads only the summary card and the stats shown (your route only if it’s on the card). Anyone with the link can view it until you revoke it.</Notice>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <View style={{ position: 'absolute', left: -10000, top: 0 }} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <View ref={linkCardRef} collapsable={false} style={{ width: PREVIEW_WIDTH }}>
          <ShareCard card={card} format="post" />
        </View>
      </View>
    </Screen>
  );
}
