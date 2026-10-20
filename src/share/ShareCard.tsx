/**
 * Strava-style share cards in three formats:
 *  - post    4:5  (1080×1350)  feed posts
 *  - story   9:16 (1080×1920)  Instagram/WhatsApp stories
 *  - sticker transparent PNG   white text + route, to place on your own photo
 * Rendered at a fixed preview width; exported at 1080 px wide by react-native-view-shot.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Text, TextStyle, View } from 'react-native';
import { formatShortDate } from '../domain/dates';
import { LatLon, RouteLine } from '../gps/RouteLine';

const LOGO = require('../../assets/logo.png');

export type ShareFormat = 'post' | 'story' | 'sticker';
export const PREVIEW_WIDTH = 300;
export const EXPORT_WIDTH = 1080;

export interface CardData {
  kind: 'run' | 'swim' | 'workout';
  title: string;
  date: string;
  hero: { value: string; unit: string };
  stats: { label: string; value: string }[];
  /** Bar heights (bigger = better: speed per split, or reps per set). */
  bars: number[] | null;
  barsLabel: string | null;
  /** GPS route (simplified), when the run was recorded with GPS. */
  route: LatLon[] | null;
}

const C = { bg: '#0B1F17', green: '#1FC96B', muted: '#9FB8AB', soft: '#CFE3D8', white: '#FFFFFF' };
// Sticker text sits on unknown photos: white with a soft dark halo stays readable on any background.
const halo: TextStyle = { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } };

function icon(kind: CardData['kind']) {
  return kind === 'run' ? 'walk' : kind === 'swim' ? 'water' : 'body';
}

function Bars({ bars, height, color }: { bars: number[]; height: number; color: string }) {
  const max = Math.max(...bars);
  return (
    <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
      {bars.map((b, i) => (
        <View key={i} style={{ flex: 1, height: `${Math.max(10, (b / max) * 100)}%`, backgroundColor: color, opacity: 0.9, borderRadius: 3 }} />
      ))}
    </View>
  );
}

function Header({ card, sticker }: { card: CardData; sticker?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Image source={LOGO} style={{ width: 26, height: 26, borderRadius: 7 }} accessibilityIgnoresInvertColors />
      <Text style={[{ color: C.white, fontWeight: '800', fontSize: 15 }, sticker && halo]}>MoveIQ</Text>
      <Text style={[{ color: sticker ? C.white : C.muted, marginLeft: 'auto', fontSize: 12 }, sticker && halo]}>{formatShortDate(card.date)}</Text>
    </View>
  );
}

function Stats({ card, sticker, size = 16 }: { card: CardData; sticker?: boolean; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {card.stats.map((s) => (
        <View key={s.label}>
          <Text style={[{ color: sticker ? C.white : C.muted, fontSize: 11 }, sticker && halo]}>{s.label}</Text>
          <Text style={[{ color: C.white, fontSize: size, fontWeight: '700' }, sticker && halo]}>{s.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Hero({ card, size, sticker }: { card: CardData; size: number; sticker?: boolean }) {
  return (
    <Text style={[{ color: C.white, fontSize: size, fontWeight: '800', fontVariant: ['tabular-nums'] }, sticker && halo]}>
      {card.hero.value}
      <Text style={{ fontSize: size * 0.36, color: sticker ? C.white : C.muted }}> {card.hero.unit}</Text>
    </Text>
  );
}

export function ShareCard({ card, format }: { card: CardData; format: ShareFormat }) {
  const W = PREVIEW_WIDTH;
  const inner = W - 36;

  if (format === 'sticker') {
    return (
      <View style={{ width: W, padding: 14, gap: 10, backgroundColor: 'transparent' }}>
        {card.route ? <RouteLine points={card.route} width={inner + 8} height={150} color={C.white} strokeWidth={5} pad={8} /> : null}
        <Hero card={card} size={52} sticker />
        <Stats card={card} sticker size={17} />
        <Header card={card} sticker />
      </View>
    );
  }

  const story = format === 'story';
  const H = story ? (W * 16) / 9 : (W * 5) / 4;
  const visualH = story ? 230 : card.route ? 110 : 60;
  return (
    <View style={{ width: W, height: H, backgroundColor: C.bg, borderRadius: story ? 0 : 18, padding: 18, gap: story ? 14 : 10 }}>
      <Header card={card} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={icon(card.kind)} size={18} color={C.green} />
        <Text style={{ color: C.soft, fontSize: 14, fontWeight: '600' }}>{card.title}</Text>
      </View>
      {story && card.route ? <RouteLine points={card.route} width={inner} height={visualH} color={C.green} strokeWidth={5} startColor={C.white} endColor={C.green} /> : null}
      <Hero card={card} size={story ? 64 : 52} />
      <Stats card={card} size={story ? 18 : 16} />
      <View style={{ flex: 1, justifyContent: 'flex-end', gap: 6 }}>
        {!story && card.route ? (
          <RouteLine points={card.route} width={inner} height={visualH} color={C.green} strokeWidth={4} startColor={C.white} endColor={C.green} pad={6} />
        ) : card.bars && card.bars.length >= 2 ? (
          <>
            {card.barsLabel ? <Text style={{ color: C.muted, fontSize: 10 }}>{card.barsLabel}</Text> : null}
            <Bars bars={card.bars} height={story ? 90 : 56} color={C.green} />
          </>
        ) : null}
        {story ? <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>Tracked with MoveIQ</Text> : null}
      </View>
    </View>
  );
}
