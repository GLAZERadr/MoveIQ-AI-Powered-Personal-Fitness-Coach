import { ExerciseAnalyzer } from '../analyzer';
import { PUSHUP, SQUAT } from '../exercises';
import { TechniqueFeedbackEngine } from '../feedback';
import { angleDeg, signedOffsetFromLine } from '../geometry';
import { assessPoseQuality } from '../quality';
import { buildSetReport, reanalyze } from '../report';
import { RepCounter } from '../repCounter';
import { PoseFrame } from '../types';
import { pushupLandmarks, repTrajectory, rng, squatLandmarks, toFrames } from './synthetic';

function run(frames: PoseFrame[], ex = PUSHUP, retain = false) {
  const a = new ExerciseAnalyzer(ex, { retainFrames: retain });
  const cues = [];
  for (const f of frames) {
    const out = a.process(f);
    if (out.newCue) cues.push(out.newCue);
  }
  return { a, cues };
}

const pushups = (reps: number, bottom = 80, repMs = 1500, hip = 0, extra: object = {}) =>
  toFrames(repTrajectory({ top: 170, bottom, reps, repMs }).map((d) => pushupLandmarks(d, hip, extra)));

describe('geometry', () => {
  it('computes interior angles', () => {
    expect(angleDeg({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90);
    expect(angleDeg({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNaN();
  });
  it('synthetic skeleton reproduces requested angles', () => {
    const l = pushupLandmarks(95);
    expect(PUSHUP.signal(l, 'left')).toBeCloseTo(95, 5);
    const s = squatLandmarks(100, 30);
    expect(SQUAT.signal(s, 'left')).toBeCloseTo(100, 5);
  });
  it('hip offset sign is positive for sag regardless of facing direction', () => {
    expect(signedOffsetFromLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.1 })).toBeGreaterThan(0);
    expect(signedOffsetFromLine({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0.5, y: 0.1 })).toBeGreaterThan(0);
  });
});

describe('push-up repetition counting', () => {
  it('counts valid reps', () => {
    const { a } = run(pushups(5));
    expect(a.counter.reps).toHaveLength(5);
    expect(a.counter.partials).toHaveLength(0);
  });

  it('rejects partial reps that do not reach depth, with an immediate depth cue', () => {
    const { a, cues } = run(pushups(3, 120));
    expect(a.counter.reps).toHaveLength(0);
    expect(a.counter.partials.map((p) => p.reason)).toEqual(['insufficient_depth', 'insufficient_depth', 'insufficient_depth']);
    expect(cues[0]?.id).toBe('depth');
  });

  it('does not count jitter around the top position', () => {
    const r = rng(1);
    const angles = Array.from({ length: 300 }, () => 165 + (r() * 2 - 1) * 8);
    const { a } = run(toFrames(angles.map((d) => pushupLandmarks(d))));
    expect(a.counter.reps).toHaveLength(0);
  });

  it('counts reps under realistic landmark noise', () => {
    const r = rng(42);
    const frames = toFrames(repTrajectory({ top: 170, bottom: 80, reps: 6, repMs: 1600 }).map((d) => pushupLandmarks(d, 0, { noise: 0.004, rand: r })));
    const { a } = run(frames);
    expect(a.counter.reps).toHaveLength(6);
  });

  it('rejects an abrupt single-frame spike (too fast to be a rep)', () => {
    const angles = [...Array(30).fill(170), 85, 170, ...Array(30).fill(170)];
    const { a } = run(toFrames(angles.map((d) => pushupLandmarks(d))));
    expect(a.counter.reps).toHaveLength(0);
  });

  it('never double-counts while lingering at the bottom or wobbling near thresholds', () => {
    // Down, wobble around the bottom threshold several times, then up: one rep.
    const angles = [
      ...Array(20).fill(170),
      ...[160, 150, 140, 120, 100, 95, 105, 96, 104, 95, 110, 98, 120, 140, 160, 170],
      ...Array(20).fill(170),
    ].flatMap((d) => [d, d, d]);
    const { a } = run(toFrames(angles.map((d) => pushupLandmarks(d))));
    expect(a.counter.reps).toHaveLength(1);
  });

  it('tolerates short landmark dropouts mid-rep', () => {
    const lms = repTrajectory({ top: 170, bottom: 80, reps: 3, repMs: 1800 }).map((d) => pushupLandmarks(d) as ReturnType<typeof pushupLandmarks> | null);
    // Drop 12 frames (~400 ms) in the middle of rep 2.
    for (let i = 60; i < 72; i++) lms[i] = null;
    const { a } = run(toFrames(lms));
    expect(a.counter.reps).toHaveLength(3);
  });

  it('abandons a rep when tracking is lost for longer than maxGapMs and recovers afterwards', () => {
    const lms = repTrajectory({ top: 170, bottom: 80, reps: 3, repMs: 1800, holdBetweenMs: 900 }).map(
      (d) => pushupLandmarks(d) as ReturnType<typeof pushupLandmarks> | null,
    );
    // Frames 33–80 (~1.6 s) are lost while rep 1 is descending (descent is detected ~frame 29).
    for (let i = 33; i < 81; i++) lms[i] = null;
    const { a } = run(toFrames(lms));
    expect(a.counter.partials.some((p) => p.reason === 'tracking_lost')).toBe(true);
    expect(a.counter.reps).toHaveLength(2);
  });

  it('does not count or coach on low-confidence landmarks', () => {
    const { a, cues } = run(pushups(4, 80, 1500, 0.12, { visibility: 0.3 }));
    expect(a.counter.reps).toHaveLength(0);
    expect(cues).toHaveLength(0);
    expect(a.snapshot.quality.level).toBe('poor');
    expect(a.snapshot.guidance).toMatch(/lighting|camera/i);
  });

  it('gives orientation guidance when the camera is not side-on', () => {
    const q = assessPoseQuality({ timestampMs: 0, landmarks: squatLandmarks(170) }, PUSHUP.config.quality, null);
    expect(q.issues).toContain('wrong_orientation');
    expect(q.level).toBe('poor');
  });

  it('flags a consistent hip sag once it persists, and rate-limits the cue', () => {
    const { a, cues } = run(pushups(6, 80, 1500, 0.12));
    expect(a.counter.reps).toHaveLength(6);
    const sagCues = cues.filter((c) => c.id === 'hip_sag');
    expect(sagCues.length).toBeGreaterThanOrEqual(1);
    expect(sagCues.length).toBeLessThan(6);
    // First cue only after persistence (≥ 2 reps).
    expect(cues[0]!.atMs).toBeGreaterThanOrEqual(a.counter.reps[1]!.endMs);
    expect(buildSetReport(a).deviations.find((d) => d.id === 'hip_sag')?.reps).toBe(6);
  });

  it('produces no technique cues for clean reps', () => {
    const { cues } = run(pushups(6));
    expect(cues).toHaveLength(0);
  });

  it('pausing mid-rep (no frames) does not create a rep; counting resumes afterwards', () => {
    const before = toFrames(repTrajectory({ top: 170, bottom: 80, reps: 2, repMs: 1500, holdEndMs: 0 }).map((d) => pushupLandmarks(d)));
    const halfRep = toFrames([170, 150, 120, 95, 85].map((d) => pushupLandmarks(d)), before.at(-1)!.timestampMs + 33);
    // Resume 20 s later (user paused) with 3 more reps.
    const after = toFrames(repTrajectory({ top: 170, bottom: 80, reps: 3, repMs: 1500 }).map((d) => pushupLandmarks(d)), halfRep.at(-1)!.timestampMs + 20000);
    // While paused, the screen feeds an explicit "no frame" tick so the gap is observed.
    const pauseTick: PoseFrame = { timestampMs: halfRep.at(-1)!.timestampMs + 19000, landmarks: null };
    const { a } = run([...before, ...halfRep, pauseTick, ...after]);
    expect(a.counter.reps).toHaveLength(5);
  });
});

describe('interruptions without empty frames', () => {
  it('a long silence mid-rep followed by valid frames does not complete the stale rep', () => {
    const halfRep = toFrames([170, 170, 170, 170, 170, 170, 170, 170, 170, 170, 170, 150, 120, 95, 85].flatMap((d) => [d, d]).map((d) => pushupLandmarks(d)));
    // Detection switched off for 10 s (no frames at all), then the user is back at the top.
    const resumed = toFrames(Array(30).fill(170).map((d) => pushupLandmarks(d)), halfRep.at(-1)!.timestampMs + 10000);
    const { a } = run([...halfRep, ...resumed]);
    expect(a.counter.reps).toHaveLength(0);
    expect(a.counter.partials.map((p) => p.reason)).toEqual(['tracking_lost']);
  });
});

describe('squat analysis', () => {
  const squats = (reps: number, lean = 20, o: Parameters<typeof squatLandmarks>[2] = {}, bottom = 85) =>
    toFrames(repTrajectory({ top: 175, bottom, reps, repMs: 2000 }).map((d) => squatLandmarks(d, lean, o)));

  it('counts valid squats', () => {
    const { a, cues } = run(squats(4), SQUAT);
    expect(a.counter.reps).toHaveLength(4);
    expect(cues).toHaveLength(0);
  });

  it('rejects shallow squats', () => {
    const { a } = run(squats(3, 20, {}, 125), SQUAT);
    expect(a.counter.reps).toHaveLength(0);
    expect(a.counter.partials[0]?.reason).toBe('insufficient_depth');
  });

  it('flags possible excessive forward lean', () => {
    const { a } = run(squats(4, 65), SQUAT);
    expect(buildSetReport(a).deviations.map((d) => d.id)).toContain('forward_lean');
  });

  it('assesses symmetry only when both legs are clearly visible', () => {
    const asym = (vis: number) =>
      toFrames(repTrajectory({ top: 175, bottom: 85, reps: 3, repMs: 2000 }).map((d) => squatLandmarks(d, 20, { farVisibility: vis, rightKneeDeg: Math.min(180, d + 25) })));
    expect(buildSetReport(run(asym(0.9), SQUAT).a).deviations.map((d) => d.id)).toContain('asymmetry');
    expect(buildSetReport(run(asym(0.3), SQUAT).a).deviations.map((d) => d.id)).not.toContain('asymmetry');
  });
});

describe('post-workout re-analysis', () => {
  it('re-evaluating retained landmarks reproduces the live result', () => {
    const { a } = run(pushups(5, 80, 1500, 0.12), PUSHUP, true);
    const live = buildSetReport(a);
    const re = reanalyze(PUSHUP, a.retained);
    expect(re.reps).toBe(live.reps);
    expect(re.deviations).toEqual(live.deviations);
    // Retained frames are 15 fps and 3-decimal quantized, so smoothed peaks differ slightly.
    expect(Math.abs(re.romMeanDeg! - live.romMeanDeg!)).toBeLessThan(4);
  });

  it('reports ROM and tempo', () => {
    const r = buildSetReport(run(pushups(4, 80, 2000)).a);
    expect(r.reps).toBe(4);
    expect(r.romMeanDeg!).toBeGreaterThan(70);
    expect(r.tempo.repMeanMs!).toBeGreaterThan(1000);
    expect(r.tracking.goodFramePct).toBeGreaterThan(95);
  });
});

describe('RepCounter configuration', () => {
  it('requires holding the top before the first rep counts', () => {
    const c = new RepCounter({ ...PUSHUP.config.counter, readyHoldMs: 1000 });
    // Starts mid-motion without a hold: never reaches READY.
    [170, 120, 90, 120, 170].forEach((v, i) => c.update(i * 300, v));
    expect(c.reps).toHaveLength(0);
  });
});

describe('TechniqueFeedbackEngine', () => {
  it('ignores cues while tracking is not good', () => {
    const f = new TechniqueFeedbackEngine();
    const cand = [{ id: 'x', message: 'm', priority: 1, immediate: true }];
    expect(f.onRep(cand, 0, 'partial')).toBeNull();
    expect(f.onRep(cand, 10_000, 'good')?.id).toBe('x');
  });
  it('picks the highest-priority cue and enforces global spacing', () => {
    const f = new TechniqueFeedbackEngine({ globalMinIntervalMs: 5000, perCueCooldownMs: 0, persistenceWindow: 1, persistenceRequired: 1 });
    const cands = [
      { id: 'low', message: '', priority: 1 },
      { id: 'high', message: '', priority: 5 },
    ];
    expect(f.onRep(cands, 0, 'good')?.id).toBe('high');
    expect(f.onRep(cands, 1000, 'good')).toBeNull();
    expect(f.onRep(cands, 6000, 'good')?.id).toBe('high');
  });
});
