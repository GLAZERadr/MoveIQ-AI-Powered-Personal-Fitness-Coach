/**
 * Route map with OpenStreetMap tiles (free, no API key) via Leaflet in a WebView.
 * Follows the OSM tile usage policy: visible attribution, identifying User-Agent and Referer,
 * standard tile.openstreetmap.org endpoint, normal client-side caching.
 * Without internet (tiles/Leaflet can't load), falls back to drawing the route alone.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import { useTheme } from '../ui/theme';

export type LatLon = [number, number];

type WebViewHandle = { injectJavaScript: (script: string) => void };
// The library's types omit `ref`, though the component forwards it to the native view at runtime.
const MapWebView = WebView as unknown as React.ComponentType<React.ComponentProps<typeof WebView> & { ref?: React.Ref<WebViewHandle> }>;

const USER_AGENT = 'MoveIQ/1.0 (fitness app; +https://moveiq-api.vercel.app)';
const BASE_URL = 'https://moveiq-api.vercel.app/';

function html(points: LatLon[], follow: boolean, dark: boolean): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#m{margin:0;height:100%;background:${dark ? '#131A16' : '#EEF2F0'}}
.leaflet-control-attribution{font-size:10px}${dark ? '.leaflet-tile{filter:brightness(.75) contrast(1.1) saturate(.8)}' : ''}</style>
</head><body><div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  if (!window.L) { window.ReactNativeWebView.postMessage('noleaflet'); return; }
  var map = L.map('m', { zoomControl: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  var line = L.polyline([], { color: '#1FC96B', weight: 5, opacity: .95 }).addTo(map);
  var start = L.circleMarker([0,0], { radius: 6, color: '#fff', weight: 2, fillColor: '#1FC96B', fillOpacity: 1 });
  var end = L.circleMarker([0,0], { radius: 7, color: '#fff', weight: 2, fillColor: '#E5484D', fillOpacity: 1 });
  var fitted = false;
  window.setRoute = function(pts, follow) {
    line.setLatLngs(pts);
    if (!pts.length) { map.setView([0,0], 2); return; }
    start.setLatLng(pts[0]).addTo(map);
    end.setLatLng(pts[pts.length-1]).addTo(map);
    if (follow) map.setView(pts[pts.length-1], Math.max(map.getZoom() || 16, 16));
    else if (!fitted) { map.fitBounds(line.getBounds(), { padding: [24,24], maxZoom: 17 }); fitted = true; }
  };
  window.setRoute(${JSON.stringify(points)}, ${follow});
  window.ReactNativeWebView.postMessage('ready');
})();
</script></body></html>`;
}

/** Equirectangular projection of the route into the box; good enough for a city-sized run. */
function RouteSketch({ points, height }: { points: LatLon[]; height: number }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const proj = useMemo(() => {
    if (points.length < 2 || w === 0) return null;
    const lat0 = points[0]![0];
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = points.map((p) => p[1] * k);
    const ys = points.map((p) => -p[0]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 16;
    const s = Math.min((w - 2 * pad) / Math.max(maxX - minX, 1e-9), (height - 2 * pad) / Math.max(maxY - minY, 1e-9));
    const ox = (w - (maxX - minX) * s) / 2;
    const oy = (height - (maxY - minY) * s) / 2;
    return xs.map((x, i) => [ox + (x - minX) * s, oy + (ys[i]! - minY) * s] as const);
  }, [points, w, height]);
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {proj ? (
        <Svg width={w} height={height}>
          <Polyline points={proj.map((p) => p.join(',')).join(' ')} stroke={colors.primary} strokeWidth={4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={proj[0]![0]} cy={proj[0]![1]} r={5} fill={colors.primary} />
          <Circle cx={proj[proj.length - 1]![0]} cy={proj[proj.length - 1]![1]} r={6} fill={colors.danger} />
        </Svg>
      ) : null}
    </View>
  );
}

export function RouteMap({ points, follow = false, height = 240, style }: { points: LatLon[]; follow?: boolean; height?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, font, radius, dark } = useTheme();
  const ref = useRef<WebViewHandle>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  // Initial HTML only depends on the first render; later points are pushed via injectJavaScript.
  const [source] = useState(() => ({ html: html(points, follow, dark), baseUrl: BASE_URL }));

  useEffect(() => {
    if (status === 'ready') ref.current?.injectJavaScript(`window.setRoute(${JSON.stringify(points)}, ${follow}); true;`);
  }, [points, follow, status]);

  useEffect(() => {
    const t = setTimeout(() => setStatus((s) => (s === 'loading' ? 'offline' : s)), 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={[{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceAlt }, style]}
      accessible accessibilityRole="image" accessibilityLabel={`Route map with ${points.length} points`}>
      {status !== 'offline' ? (
        <MapWebView
          ref={ref}
          source={source}
          userAgent={USER_AGENT}
          originWhitelist={['*']}
          javaScriptEnabled
          scrollEnabled={false}
          onMessage={(e) => setStatus(e.nativeEvent.data === 'ready' ? 'ready' : 'offline')}
          onError={() => setStatus('offline')}
          style={{ backgroundColor: 'transparent' }}
        />
      ) : (
        <>
          <RouteSketch points={points} height={height} />
          <Text style={[font.caption, { position: 'absolute', bottom: 6, left: 10, color: colors.textMuted }]}>Map unavailable offline: showing route only</Text>
        </>
      )}
    </View>
  );
}
