import { projectRoute } from '../../gps/RouteLine';
import { GpsPoint, cleanTrack, currentPaceSecPerKm, haversine, trackStats } from '../gps';

// Straight line northward: 1 degree latitude ≈ 111,195 m, so 0.0001° ≈ 11.12 m.
const M_PER_DEG = 111_194.93;
function line(opts: { meters: number; speedMps: number; startT?: number; segment?: number; stepM?: number; alt?: (i: number) => number | null; acc?: number }): GpsPoint[] {
  const step = opts.stepM ?? 5;
  const n = Math.round(opts.meters / step);
  return Array.from({ length: n + 1 }, (_, i) => ({
    t: (opts.startT ?? 0) + ((i * step) / opts.speedMps) * 1000,
    lat: (i * step) / M_PER_DEG,
    lon: 0,
    alt: opts.alt ? opts.alt(i) : null,
    accuracy: opts.acc ?? 5,
    segment: opts.segment ?? 0,
  }));
}

describe('gps track processing', () => {
  it('haversine matches known distance', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(M_PER_DEG, -1);
  });

  it('computes distance, time, moving time and exact km splits', () => {
    const s = trackStats(line({ meters: 3000, speedMps: 3.333 })); // 5:00/km
    expect(s.distanceM).toBeCloseTo(3000, -1);
    expect(s.elapsedSec).toBeCloseTo(900, 0);
    expect(s.movingSec).toBeCloseTo(900, 0);
    expect(s.splits).toHaveLength(3);
    s.splits.forEach((sp) => expect(sp.durationSec).toBeCloseTo(300, 0));
  });

  it('drops inaccurate fixes and GPS jumps', () => {
    const pts = line({ meters: 500, speedMps: 3 });
    pts.splice(40, 0, { ...pts[40]!, t: pts[40]!.t + 1, lat: pts[40]!.lat + 0.01 }); // 1 km teleport in 1 ms
    pts.push({ ...pts[pts.length - 1]!, t: pts[pts.length - 1]!.t + 1000, accuracy: 80 });
    const clean = cleanTrack(pts);
    expect(clean.length).toBe(pts.length - 2);
    expect(trackStats(pts).distanceM).toBeCloseTo(500, -1);
  });

  it('does not count paused time or the gap between segments', () => {
    const a = line({ meters: 1000, speedMps: 3.333, segment: 0 });
    const last = a[a.length - 1]!;
    // Resume 10 minutes later, 300 m further on (walked during the pause): not counted.
    const b = line({ meters: 1000, speedMps: 3.333, segment: 1, startT: last.t + 600_000 }).map((p) => ({ ...p, lat: p.lat + 1300 / M_PER_DEG }));
    const s = trackStats([...a, ...b]);
    expect(s.distanceM).toBeCloseTo(2000, -1);
    expect(s.elapsedSec).toBeCloseTo(600, 0);
  });

  it('standing still is not moving time', () => {
    const run = line({ meters: 500, speedMps: 3 });
    const end = run[run.length - 1]!;
    const stand = Array.from({ length: 60 }, (_, i) => ({ ...end, t: end.t + (i + 1) * 1000, lat: end.lat + (i % 2 ? 1e-6 : 0) }));
    const s = trackStats([...run, ...stand]);
    expect(s.elapsedSec - s.movingSec).toBeGreaterThan(55);
  });

  it('elevation gain ignores small noise', () => {
    const noisy = trackStats(line({ meters: 1000, speedMps: 3, alt: (i) => 100 + (i % 2 ? 1.5 : -1.5) }));
    expect(noisy.elevationGainM).toBe(0);
    const hill = trackStats(line({ meters: 1000, speedMps: 3, alt: (i) => 100 + i * 0.25 })); // +50 m
    expect(hill.elevationGainM!).toBeGreaterThan(45);
    expect(trackStats(line({ meters: 100, speedMps: 3 })).elevationGainM).toBeNull();
  });

  it('live pace uses the most recent distance window', () => {
    const slow = line({ meters: 600, speedMps: 2.5 });
    const fast = line({ meters: 400, speedMps: 4, startT: slow[slow.length - 1]!.t + 1250 }).map((p) => ({ ...p, lat: p.lat + 605 / M_PER_DEG }));
    expect(currentPaceSecPerKm([...slow, ...fast])!).toBeCloseTo(250, -1);
  });
});


describe('route projection for share cards', () => {
  it('fits the route inside the box with padding and keeps aspect', () => {
    const pts: [number, number][] = [[0, 0], [0.001, 0], [0.001, 0.002]];
    const p = projectRoute(pts, 200, 100, 10)!;
    for (const [x, y] of p) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(x).toBeLessThanOrEqual(190 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(y).toBeLessThanOrEqual(90 + 1e-9);
    }
    // North is up: the first (southern) point is lower on screen than the second.
    expect(p[0]![1]).toBeGreaterThan(p[1]![1]);
    expect(projectRoute([[0, 0]], 200, 100)).toBeNull();
  });
});
