import { ExerciseAnalyzer } from '../analyzer';
import { LUNGE, PIKE_PUSHUP, PLANK, PULLUP } from '../exercises';
import { buildSetReport, reanalyze } from '../report';
import { PoseFrame } from '../types';
import { lungeLandmarks, pullupLandmarks, pushupLandmarks, repTrajectory, toFrames } from './synthetic';

function run(frames: PoseFrame[], ex = LUNGE) {
  const a = new ExerciseAnalyzer(ex, { retainFrames: true });
  for (const f of frames) a.process(f);
  return a;
}

describe('lunge', () => {
  const lunges = (reps: number, bottom = 88, lean = 10) =>
    toFrames(repTrajectory({ top: 175, bottom, reps, repMs: 2000 }).map((d) => lungeLandmarks(d, Math.min(178, d + 5), lean)));

  it('counts full lunges using the front knee', () => {
    const a = run(lunges(5));
    expect(a.counter.reps).toHaveLength(5);
    expect(buildSetReport(a).deviations).toEqual([]);
  });
  it('rejects shallow lunges', () => {
    const a = run(lunges(3, 130));
    expect(a.counter.reps).toHaveLength(0);
    expect(a.counter.partials[0]?.reason).toBe('insufficient_depth');
  });
  it('flags forward lean', () => {
    expect(buildSetReport(run(lunges(4, 88, 45))).deviations.map((d) => d.id)).toContain('forward_lean');
  });
});

describe('pike push-up', () => {
  const pikes = (reps: number, hip: number) => toFrames(repTrajectory({ top: 170, bottom: 85, reps, repMs: 1800 }).map((d) => pushupLandmarks(d, hip)));
  it('counts reps with hips high and no cue', () => {
    const a = run(pikes(4, -0.3), PIKE_PUSHUP);
    expect(a.counter.reps).toHaveLength(4);
    expect(buildSetReport(a).deviations).toEqual([]);
  });
  it('flags hips dropping', () => {
    expect(buildSetReport(run(pikes(4, 0), PIKE_PUSHUP)).deviations.map((d) => d.id)).toContain('hips_drop');
  });
});

describe('pull-up', () => {
  const pulls = (reps: number, chin: boolean, bottom = 70) =>
    toFrames(repTrajectory({ top: 172, bottom, reps, repMs: 2200 }).map((d) => pullupLandmarks(d, chin)));
  it('synthetic elbow angle is exact', () => {
    expect(PULLUP.signal(pullupLandmarks(90, true), 'left')).toBeCloseTo(90, 3);
  });
  it('counts full pull-ups and does not flag chin when it clears', () => {
    const a = run(pulls(5, true), PULLUP);
    expect(a.counter.reps).toHaveLength(5);
    expect(buildSetReport(a).deviations.map((d) => d.id)).not.toContain('chin_below_bar');
  });
  it('flags chin not clearing the bar, also on re-analysis', () => {
    const a = run(pulls(4, false), PULLUP);
    expect(a.counter.reps).toHaveLength(4);
    expect(buildSetReport(a).deviations.map((d) => d.id)).toContain('chin_below_bar');
    expect(reanalyze(PULLUP, a.retained).deviations.map((d) => d.id)).toContain('chin_below_bar');
  });
  it('half pulls are not counted', () => {
    expect(run(pulls(3, false, 125), PULLUP).counter.reps).toHaveLength(0);
  });
});

describe('plank (hold mode)', () => {
  const hold = (seconds: number, hip = 0, start = 0) => toFrames(Array.from({ length: seconds * 30 }, () => pushupLandmarks(85, hip)), start);

  it('accumulates hold time while in position', () => {
    const a = run(hold(20), PLANK);
    const r = buildSetReport(a);
    expect(r.hold!.totalSec).toBeGreaterThanOrEqual(19);
    expect(r.hold!.bestSec).toBeGreaterThanOrEqual(19);
    expect(r.hold!.alignedPct).toBeGreaterThan(95);
    expect(r.reps).toBe(r.hold!.totalSec);
    expect(r.deviations).toEqual([]);
  });

  it('stops the clock when the user leaves the frame and keeps the best unbroken hold', () => {
    const first = hold(10);
    const gap: PoseFrame[] = Array.from({ length: 10 }, (_, i) => ({ timestampMs: first.at(-1)!.timestampMs + (i + 1) * 300, landmarks: null }));
    const second = hold(5, 0, gap.at(-1)!.timestampMs + 33);
    const r = buildSetReport(run([...first, ...gap, ...second], PLANK));
    expect(r.hold!.totalSec).toBeGreaterThanOrEqual(14);
    expect(r.hold!.totalSec).toBeLessThanOrEqual(15);
    expect(r.hold!.bestSec).toBeGreaterThanOrEqual(9);
    expect(r.hold!.bestSec).toBeLessThanOrEqual(10);
  });

  it('flags hip sag and reduces aligned time', () => {
    const a = new ExerciseAnalyzer(PLANK);
    const cues: string[] = [];
    for (const f of hold(15, 0.12)) {
      const o = a.process(f);
      if (o.newCue) cues.push(o.newCue.id);
    }
    const r = buildSetReport(a);
    expect(cues).toContain('hip_sag');
    expect(r.hold!.alignedPct).toBeLessThan(5);
  });

  it('does not run the clock when standing (not in position)', () => {
    expect(buildSetReport(run(toFrames(Array.from({ length: 300 }, () => lungeLandmarks(175, 175))), PLANK)).hold!.totalSec).toBe(0);
  });
});
