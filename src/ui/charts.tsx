import React, { useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from './theme';

export interface Series {
  label: string;
  /** null = no observation (gap). Never interpolated. */
  values: (number | null)[];
  color?: string;
  dashed?: boolean;
  dots?: boolean;
}

interface Common {
  xLabels: string[];
  yUnit: string;
  height?: number;
  /** Summary read by screen readers in place of the graphic. */
  accessibilitySummary: string;
  formatY?: (v: number) => string;
  emptyMessage?: string;
}

const PAD = { left: 40, right: 8, top: 10, bottom: 22 };

function niceRange(values: number[], includeZero: boolean): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (includeZero) lo = Math.min(0, lo);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.1;
  return [includeZero && lo >= 0 ? 0 : lo - pad, hi + pad];
}

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(e.nativeEvent.layout.width)];
}

function Empty({ msg, height }: { msg: string; height: number }) {
  const { colors, font } = useTheme();
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[font.caption, { color: colors.textMuted, textAlign: 'center' }]}>{msg}</Text>
    </View>
  );
}

function Legend({ series }: { series: Series[] }) {
  const { colors, font } = useTheme();
  if (series.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }} importantForAccessibility="no-hide-descendants">
      {series.map((s) => (
        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={{ width: 10, height: 3, backgroundColor: s.color ?? colors.primary }} />
          <Text style={[font.caption, { color: colors.textMuted }]}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function LineChart({ series, xLabels, yUnit, height = 160, accessibilitySummary, formatY = (v) => v.toFixed(1), emptyMessage = 'No data yet' }: Common & { series: Series[] }) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
  if (all.length === 0) return <Empty msg={emptyMessage} height={height} />;

  const [lo, hi] = niceRange(all, false);
  const n = xLabels.length;
  const iw = Math.max(1, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <View style={{ gap: 6 }}>
      <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={accessibilitySummary}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {ticks.map((t) => (
              <React.Fragment key={t}>
                <Line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
                <SvgText x={PAD.left - 4} y={y(t) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">{formatY(t)}</SvgText>
              </React.Fragment>
            ))}
            <SvgText x={2} y={PAD.top - 1} fontSize={9} fill={colors.textMuted}>{yUnit}</SvgText>
            {series.map((s) => {
              const color = s.color ?? colors.primary;
              // Break the line at gaps (nulls) instead of interpolating.
              let d = '';
              let pen = false;
              s.values.forEach((v, i) => {
                if (v == null || !Number.isFinite(v)) {
                  pen = false;
                  return;
                }
                d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
                pen = true;
              });
              const showDots = s.dots ?? s.values.filter((v) => v != null).length < 40;
              return (
                <React.Fragment key={s.label}>
                  <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeDasharray={s.dashed ? '4 4' : undefined} />
                  {showDots && s.values.map((v, i) => (v == null ? null : <Circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={color} />))}
                </React.Fragment>
              );
            })}
            {n > 0 && <SvgText x={x(0)} y={height - 6} fontSize={10} fill={colors.textMuted} textAnchor="start">{xLabels[0]}</SvgText>}
            {n > 1 && <SvgText x={x(n - 1)} y={height - 6} fontSize={10} fill={colors.textMuted} textAnchor="end">{xLabels[n - 1]}</SvgText>}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </View>
      <Legend series={series} />
    </View>
  );
}

export function BarChart({ values, xLabels, yUnit, height = 140, accessibilitySummary, formatY = (v) => String(Math.round(v)), target, emptyMessage = 'No data yet', highlightLast }: Common & {
  values: (number | null)[];
  target?: number | null;
  highlightLast?: boolean;
}) {
  const { colors } = useTheme();
  const [width, onLayout] = useWidth();
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0 || present.every((v) => v === 0)) return <Empty msg={emptyMessage} height={height} />;
  const [, hiRaw] = niceRange([...present, ...(target ? [target] : [])], true);
  const hi = hiRaw;
  const n = values.length;
  const iw = Math.max(1, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const slot = iw / n;
  const bw = Math.max(4, Math.min(28, slot * 0.6));
  const y = (v: number) => PAD.top + ih - (v / hi) * ih;
  const labelEvery = Math.ceil(n / 8);

  return (
    <View onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={accessibilitySummary}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[0, hi / 2, hi].map((t) => (
            <React.Fragment key={t}>
              <Line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={colors.border} strokeWidth={1} />
              <SvgText x={PAD.left - 4} y={y(t) + 4} fontSize={10} fill={colors.textMuted} textAnchor="end">{formatY(t)}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={2} y={PAD.top - 1} fontSize={9} fill={colors.textMuted}>{yUnit}</SvgText>
          {values.map((v, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            return (
              <React.Fragment key={i}>
                {v != null && v > 0 ? (
                  <Rect x={cx - bw / 2} y={y(v)} width={bw} height={Math.max(1, y(0) - y(v))} rx={3}
                    fill={highlightLast && i === n - 1 ? colors.primary : colors.primary} opacity={highlightLast && i !== n - 1 ? 0.45 : 1} />
                ) : null}
                {i % labelEvery === 0 || i === n - 1 ? (
                  <SvgText x={cx} y={height - 6} fontSize={10} fill={colors.textMuted} textAnchor="middle">{xLabels[i]}</SvgText>
                ) : null}
              </React.Fragment>
            );
          })}
          {target ? <Line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} stroke={colors.warning} strokeDasharray="5 4" strokeWidth={1.5} /> : null}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
