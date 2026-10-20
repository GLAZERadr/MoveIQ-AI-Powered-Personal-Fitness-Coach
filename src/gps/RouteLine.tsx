import React, { useMemo } from 'react';
import Svg, { Circle, Polyline } from 'react-native-svg';

export type LatLon = [number, number];

/**
 * Projects lat/lon points into a w×h box (equirectangular, correct aspect for city-sized routes),
 * centred with padding. Pure; also used for the offline map fallback.
 */
export function projectRoute(points: LatLon[], w: number, h: number, pad = 16): [number, number][] | null {
  if (points.length < 2 || w <= 0 || h <= 0) return null;
  const k = Math.cos((points[0]![0] * Math.PI) / 180);
  const xs = points.map((p) => p[1] * k);
  const ys = points.map((p) => -p[0]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1e-9), (h - 2 * pad) / Math.max(maxY - minY, 1e-9));
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  return xs.map((x, i) => [ox + (x - minX) * s, oy + (ys[i]! - minY) * s]);
}

/** The route as a line (no map tiles), for the offline fallback and share cards. */
export function RouteLine({ points, width, height, color, strokeWidth = 4, startColor, endColor, pad = 16 }: {
  points: LatLon[]; width: number; height: number; color: string; strokeWidth?: number; startColor?: string; endColor?: string; pad?: number;
}) {
  const proj = useMemo(() => projectRoute(points, width, height, pad), [points, width, height, pad]);
  if (!proj) return null;
  const first = proj[0]!;
  const last = proj[proj.length - 1]!;
  return (
    <Svg width={width} height={height}>
      <Polyline points={proj.map((p) => p.join(',')).join(' ')} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {startColor ? <Circle cx={first[0]} cy={first[1]} r={strokeWidth + 1} fill={startColor} /> : null}
      {endColor ? <Circle cx={last[0]} cy={last[1]} r={strokeWidth + 2} fill={endColor} /> : null}
    </Svg>
  );
}
