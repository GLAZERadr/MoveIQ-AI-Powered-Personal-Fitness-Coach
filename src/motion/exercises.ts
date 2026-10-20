import { CueCandidate } from './feedback';
import { angleDeg, angleFromVertical, lm, sideName, signedOffsetFromLine } from './geometry';
import { QualityConfig } from './quality';
import { CountedRep, PartialRep, RepCounterConfig } from './repCounter';
import { PoseLandmark, Side } from './types';

export type ExerciseId = 'pushup' | 'squat' | 'lunge' | 'pike_pushup' | 'pullup' | 'plank';

/** Per-frame measurements collected while a rep is in progress. */
export type FrameFeatures = Record<string, number>;

export interface AnalysisConfig {
  version: number;
  quality: QualityConfig;
  counter: RepCounterConfig;
  /** EMA smoothing factor for the counting signal (0..1, higher = less smoothing). */
  smoothingAlpha: number;
  /** Exercise-specific cue thresholds. */
  thresholds: Record<string, number>;
}

export interface HoldCheck {
  /** Body is in the exercise position (hold time accrues). */
  inPosition: boolean;
  /** In position AND alignment criteria met. */
  aligned: boolean;
  cues: CueCandidate[];
}

export interface ExerciseDefinition {
  id: ExerciseId;
  name: string;
  /** 'reps' uses the RepCounter state machine; 'hold' accumulates time in position (e.g. plank). */
  mode: 'reps' | 'hold';
  /** What a set's target and result count: reps, or seconds held. */
  unit: 'reps' | 'seconds';
  /** Hold mode only: per-frame position/alignment assessment. */
  holdCheck?(l: PoseLandmark[], side: Side, cfg: AnalysisConfig): HoldCheck;
  /** Shown when tracking is fine but the body isn't in position yet. */
  positionHint?: string;
  signalLabel: string;
  cameraSetup: string[];
  requiredLandmarksText: string;
  instructions: string[];
  config: AnalysisConfig;
  /** The counting signal (degrees). */
  signal(l: PoseLandmark[], side: Side): number;
  /** Extra measurements per frame for technique assessment. */
  features(l: PoseLandmark[], side: Side, cfg: AnalysisConfig): FrameFeatures;
  /** Technique cue candidates for a completed rep, given the features recorded during that rep. */
  assessRep(rep: CountedRep, frames: FrameFeatures[], cfg: AnalysisConfig): CueCandidate[];
  /** Cue for a rejected rep, if any. */
  assessPartial(partial: PartialRep, cfg: AnalysisConfig): CueCandidate | null;
}

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : NaN);
const finite = (xs: (number | undefined)[]) => xs.filter((x): x is number => x != null && Number.isFinite(x));

// ---------------------------------------------------------------------------------------------
// Push-up: side view, camera at floor level ~2 m away.
// Signal: elbow angle (shoulder–elbow–wrist). Hip line: offset of hip from the shoulder–ankle line.
// ---------------------------------------------------------------------------------------------

export const PUSHUP: ExerciseDefinition = {
  id: 'pushup',
  name: 'Push-up',
  mode: 'reps',
  unit: 'reps',
  signalLabel: 'Elbow angle',
  cameraSetup: [
    'Put the phone on the floor about 2 m (6–7 ft) to your side, in landscape or portrait.',
    'Your whole body, from head to feet, should be in frame from the side.',
    'Use good lighting and avoid strong light behind you.',
  ],
  requiredLandmarksText: 'Shoulder, elbow, wrist, hip and ankle on the side facing the camera.',
  instructions: [
    'Hands slightly wider than shoulders, body in a straight line from head to heels.',
    'Lower until your elbows bend to about 90°, then press back to straight arms.',
    'Hold the top position briefly so tracking can start.',
  ],
  config: {
    version: 1,
    quality: {
      requiredJoints: ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Ankle'],
      minVisibility: 0.5,
      goodScore: 0.7,
      frameMargin: 0.01,
      orientation: 'horizontal',
      sideSwitchMargin: 0.15,
    },
    counter: {
      topThreshold: 150,
      bottomThreshold: 100,
      hysteresis: 8,
      readyHoldMs: 300,
      minRepMs: 500,
      maxRepMs: 12000,
      maxGapMs: 1000,
    },
    smoothingAlpha: 0.5,
    thresholds: {
      hipSagOffset: 0.07,
      hipPikeOffset: -0.08,
      lockoutAngle: 158,
      fastRepMs: 900,
      depthAttemptAngle: 130,
    },
  },
  signal(l, side) {
    return angleDeg(lm(l, sideName(side, 'Shoulder')), lm(l, sideName(side, 'Elbow')), lm(l, sideName(side, 'Wrist')));
  },
  features(l, side) {
    return {
      hipOffset: signedOffsetFromLine(lm(l, sideName(side, 'Shoulder')), lm(l, sideName(side, 'Ankle')), lm(l, sideName(side, 'Hip'))),
    };
  },
  assessRep(rep, frames, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const offsets = finite(frames.map((f) => f.hipOffset));
    const cues: CueCandidate[] = [];
    if (offsets.length >= 3 && max(offsets) > t.hipSagOffset!) {
      cues.push({ id: 'hip_sag', priority: 3, message: 'Possible hip sag. Brace your core to keep a straight line.' });
    }
    if (offsets.length >= 3 && min(offsets) < t.hipPikeOffset!) {
      cues.push({ id: 'hip_pike', priority: 2, message: 'Hips may be rising. Keep them in line with your shoulders and ankles.' });
    }
    if (rep.topPeakSignal < t.lockoutAngle!) {
      cues.push({ id: 'lockout', priority: 1, message: 'Possibly not fully extending. Finish each rep with straight arms.' });
    }
    if (rep.endMs - rep.startMs < t.fastRepMs!) {
      cues.push({ id: 'tempo_fast', priority: 1, message: 'Slow down and control each rep.' });
    }
    return cues;
  },
  assessPartial(p, cfg) {
    if (p.reason === 'insufficient_depth' && p.minSignal < cfg.thresholds.depthAttemptAngle!) {
      return { id: 'depth', priority: 4, immediate: true, message: 'Not counted. Lower a bit further, toward 90° at the elbows.' };
    }
    if (p.reason === 'too_fast') {
      return { id: 'too_fast', priority: 2, immediate: true, message: 'That rep was too quick to count. Slow it down.' };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Bodyweight squat: side view, camera at hip height ~2.5 m away.
// Signal: knee angle (hip–knee–ankle). Trunk: shoulder–hip segment angle from vertical.
// Left/right symmetry is only assessed when BOTH knees are reliably visible (more front-facing setups).
// ---------------------------------------------------------------------------------------------

export const SQUAT: ExerciseDefinition = {
  id: 'squat',
  name: 'Bodyweight squat',
  mode: 'reps',
  unit: 'reps',
  signalLabel: 'Knee angle',
  cameraSetup: [
    'Place the phone at about hip height, 2.5–3 m (8–10 ft) to your side.',
    'Your shoulders, hips, knees and ankles must stay in frame for the whole rep.',
    'A slight diagonal angle works, but do not face the camera straight on.',
  ],
  requiredLandmarksText: 'Shoulder, hip, knee and ankle on the side facing the camera.',
  instructions: [
    'Feet about shoulder-width apart, toes slightly out.',
    'Sit back and down until your thighs are about parallel to the floor, then stand tall.',
    'Stand still for a moment at the start so tracking can begin.',
  ],
  config: {
    version: 1,
    quality: {
      requiredJoints: ['Shoulder', 'Hip', 'Knee', 'Ankle'],
      minVisibility: 0.5,
      goodScore: 0.7,
      frameMargin: 0.01,
      orientation: 'vertical',
      sideSwitchMargin: 0.15,
    },
    counter: {
      topThreshold: 160,
      bottomThreshold: 105,
      hysteresis: 8,
      readyHoldMs: 300,
      minRepMs: 600,
      maxRepMs: 15000,
      maxGapMs: 1000,
    },
    smoothingAlpha: 0.5,
    thresholds: {
      forwardLeanDeg: 55,
      asymmetryDeg: 15,
      symmetryMinVisibility: 0.75,
      fastRepMs: 1100,
      depthAttemptAngle: 140,
    },
  },
  signal(l, side) {
    return angleDeg(lm(l, sideName(side, 'Hip')), lm(l, sideName(side, 'Knee')), lm(l, sideName(side, 'Ankle')));
  },
  features(l, side, cfg) {
    const f: FrameFeatures = {
      trunkLean: angleFromVertical(lm(l, sideName(side, 'Hip')), lm(l, sideName(side, 'Shoulder'))),
      knee: angleDeg(lm(l, sideName(side, 'Hip')), lm(l, sideName(side, 'Knee')), lm(l, sideName(side, 'Ankle'))),
    };
    const vis = Math.min(
      ...(['Hip', 'Knee', 'Ankle'] as const).flatMap((j) => [lm(l, sideName('left', j)).visibility, lm(l, sideName('right', j)).visibility]),
    );
    if (vis >= cfg.thresholds.symmetryMinVisibility!) {
      f.kneeLeft = angleDeg(lm(l, 'leftHip'), lm(l, 'leftKnee'), lm(l, 'leftAnkle'));
      f.kneeRight = angleDeg(lm(l, 'rightHip'), lm(l, 'rightKnee'), lm(l, 'rightAnkle'));
    }
    return f;
  },
  assessRep(rep, frames, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const cues: CueCandidate[] = [];
    // Trunk lean is evaluated in the bottom third of the rep (lowest knee angles), where it matters.
    const withKnee = frames.filter((f) => Number.isFinite(f.knee) && Number.isFinite(f.trunkLean));
    if (withKnee.length >= 3) {
      const sorted = [...withKnee].sort((a, b) => a.knee! - b.knee!);
      const bottom = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
      const lean = bottom.reduce((a, f) => a + f.trunkLean!, 0) / bottom.length;
      if (lean > t.forwardLeanDeg!) {
        cues.push({ id: 'forward_lean', priority: 3, message: 'Possible excessive forward lean. Keep your chest up.' });
      }
    }
    const sym = frames.filter((f) => Number.isFinite(f.kneeLeft) && Number.isFinite(f.kneeRight));
    if (sym.length >= 3) {
      const sorted = [...sym].sort((a, b) => a.kneeLeft! + a.kneeRight! - (b.kneeLeft! + b.kneeRight!));
      const bottom = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
      const diff = bottom.reduce((a, f) => a + Math.abs(f.kneeLeft! - f.kneeRight!), 0) / bottom.length;
      if (diff > t.asymmetryDeg!) {
        cues.push({ id: 'asymmetry', priority: 2, message: 'Possible left-right imbalance at the bottom. Distribute weight evenly.' });
      }
    }
    if (rep.endMs - rep.startMs < t.fastRepMs!) {
      cues.push({ id: 'tempo_fast', priority: 1, message: 'Slow down and control each rep.' });
    }
    return cues;
  },
  assessPartial(p, cfg) {
    if (p.reason === 'insufficient_depth' && p.minSignal < cfg.thresholds.depthAttemptAngle!) {
      return { id: 'depth', priority: 4, immediate: true, message: 'Not counted. Try to squat a little deeper.' };
    }
    if (p.reason === 'too_fast') {
      return { id: 'too_fast', priority: 2, immediate: true, message: 'That rep was too quick to count. Slow it down.' };
    }
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Lunge (forward/reverse/split squat): side view, camera at hip height ~2.5 m.
// Signal: FRONT knee angle = the smaller knee angle when both legs are visible.
// ---------------------------------------------------------------------------------------------

function lungeKnee(l: PoseLandmark[], side: Side): number {
  const knee = (s: Side) => angleDeg(lm(l, sideName(s, 'Hip')), lm(l, sideName(s, 'Knee')), lm(l, sideName(s, 'Ankle')));
  const other: Side = side === 'left' ? 'right' : 'left';
  const otherVisible = (['Hip', 'Knee', 'Ankle'] as const).every((j) => lm(l, sideName(other, j)).visibility >= 0.5);
  const a = knee(side);
  return otherVisible ? Math.min(a, knee(other)) : a;
}

export const LUNGE: ExerciseDefinition = {
  id: 'lunge',
  name: 'Lunge',
  mode: 'reps',
  unit: 'reps',
  signalLabel: 'Front knee angle',
  cameraSetup: [
    'Place the phone at hip height, 2.5–3 m (8–10 ft) to your side.',
    'Keep both legs in frame through the whole step.',
    'Alternate legs or do one side per set. Each lunge counts as one rep.',
  ],
  requiredLandmarksText: 'Shoulder, hip, knee and ankle on the side facing the camera.',
  instructions: [
    'Stand tall, step forward (or back) and lower until both knees are bent about 90°.',
    'Keep your torso upright, then push back to standing.',
    'Pause standing for a moment at the start so tracking can begin.',
  ],
  config: {
    version: 1,
    quality: { requiredJoints: ['Shoulder', 'Hip', 'Knee', 'Ankle'], minVisibility: 0.5, goodScore: 0.7, frameMargin: 0.01, orientation: 'vertical', sideSwitchMargin: 0.15 },
    counter: { topThreshold: 158, bottomThreshold: 110, hysteresis: 8, readyHoldMs: 300, minRepMs: 700, maxRepMs: 15000, maxGapMs: 1000 },
    smoothingAlpha: 0.5,
    thresholds: { forwardLeanDeg: 35, fastRepMs: 1100, depthAttemptAngle: 145 },
  },
  signal: lungeKnee,
  features(l, side) {
    return {
      trunkLean: angleFromVertical(lm(l, sideName(side, 'Hip')), lm(l, sideName(side, 'Shoulder'))),
      knee: lungeKnee(l, side),
    };
  },
  assessRep(rep, frames, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const cues: CueCandidate[] = [];
    const withKnee = frames.filter((f) => Number.isFinite(f.knee) && Number.isFinite(f.trunkLean));
    if (withKnee.length >= 3) {
      const bottom = [...withKnee].sort((a, b) => a.knee! - b.knee!).slice(0, Math.max(1, Math.ceil(withKnee.length / 3)));
      const lean = bottom.reduce((a, f) => a + f.trunkLean!, 0) / bottom.length;
      if (lean > t.forwardLeanDeg!) cues.push({ id: 'forward_lean', priority: 3, message: 'Possible forward lean. Keep your torso upright.' });
    }
    if (rep.endMs - rep.startMs < t.fastRepMs!) cues.push({ id: 'tempo_fast', priority: 1, message: 'Slow down and control each rep.' });
    return cues;
  },
  assessPartial(p, cfg) {
    if (p.reason === 'insufficient_depth' && p.minSignal < cfg.thresholds.depthAttemptAngle!) {
      return { id: 'depth', priority: 4, immediate: true, message: 'Not counted. Lower until your front knee is about 90°.' };
    }
    if (p.reason === 'too_fast') return { id: 'too_fast', priority: 2, immediate: true, message: 'That rep was too quick to count. Slow it down.' };
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Pike push-up: side view, floor level. Hips stay high (inverted V); signal: elbow angle.
// ---------------------------------------------------------------------------------------------

export const PIKE_PUSHUP: ExerciseDefinition = {
  id: 'pike_pushup',
  name: 'Pike push-up',
  mode: 'reps',
  unit: 'reps',
  signalLabel: 'Elbow angle',
  cameraSetup: [
    'Put the phone on the floor about 2 m to your side.',
    'Your hands, hips and feet must all be in frame.',
  ],
  requiredLandmarksText: 'Shoulder, elbow, wrist, hip and ankle on the side facing the camera.',
  instructions: [
    'Start in an inverted V: hands and feet on the floor, hips high.',
    'Bend your elbows to lower the top of your head toward the floor, then press back up.',
    'Hold the top position briefly so tracking can start.',
  ],
  config: {
    version: 1,
    quality: { requiredJoints: ['Shoulder', 'Elbow', 'Wrist', 'Hip', 'Ankle'], minVisibility: 0.5, goodScore: 0.7, frameMargin: 0.01, orientation: 'horizontal', sideSwitchMargin: 0.15 },
    counter: { topThreshold: 150, bottomThreshold: 105, hysteresis: 8, readyHoldMs: 300, minRepMs: 600, maxRepMs: 12000, maxGapMs: 1000 },
    smoothingAlpha: 0.5,
    thresholds: { minHipHeight: -0.12, fastRepMs: 900, depthAttemptAngle: 135 },
  },
  signal(l, side) {
    return angleDeg(lm(l, sideName(side, 'Shoulder')), lm(l, sideName(side, 'Elbow')), lm(l, sideName(side, 'Wrist')));
  },
  features(l, side) {
    // Negative offset = hip above the shoulder–ankle line (that's the pike).
    return { hipOffset: signedOffsetFromLine(lm(l, sideName(side, 'Shoulder')), lm(l, sideName(side, 'Ankle')), lm(l, sideName(side, 'Hip'))) };
  },
  assessRep(rep, frames, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const offsets = finite(frames.map((f) => f.hipOffset));
    const cues: CueCandidate[] = [];
    if (offsets.length >= 3 && max(offsets) > t.minHipHeight!) cues.push({ id: 'hips_drop', priority: 3, message: 'Hips may be dropping. Keep them high in an inverted V.' });
    if (rep.endMs - rep.startMs < t.fastRepMs!) cues.push({ id: 'tempo_fast', priority: 1, message: 'Slow down and control each rep.' });
    return cues;
  },
  assessPartial(p, cfg) {
    if (p.reason === 'insufficient_depth' && p.minSignal < cfg.thresholds.depthAttemptAngle!) {
      return { id: 'depth', priority: 4, immediate: true, message: 'Not counted. Lower your head a bit further.' };
    }
    if (p.reason === 'too_fast') return { id: 'too_fast', priority: 2, immediate: true, message: 'That rep was too quick to count. Slow it down.' };
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Pull-up: camera in front of or behind you. Signal: elbow angle (straight at the dead hang).
// A rep = hang → pull (elbows bent) → back to hang. Chin clearance uses nose vs. wrist height.
// ---------------------------------------------------------------------------------------------

export const PULLUP: ExerciseDefinition = {
  id: 'pullup',
  name: 'Pull-up',
  mode: 'reps',
  unit: 'reps',
  signalLabel: 'Elbow angle',
  cameraSetup: [
    'Place the phone 2–3 m in front of or behind the bar, angled up so your hands and hips are in frame.',
    'Your hands on the bar and your elbows must stay visible at the top.',
  ],
  requiredLandmarksText: 'Shoulder, elbow, wrist and hip.',
  instructions: [
    'Start from a dead hang with straight arms.',
    'Pull until your chin is over the bar, then lower all the way down.',
    'Hang still for a moment at the start so tracking can begin.',
  ],
  config: {
    version: 1,
    quality: { requiredJoints: ['Shoulder', 'Elbow', 'Wrist', 'Hip'], minVisibility: 0.5, goodScore: 0.7, frameMargin: 0.01, orientation: 'vertical', sideSwitchMargin: 0.15 },
    counter: { topThreshold: 150, bottomThreshold: 95, hysteresis: 8, readyHoldMs: 300, minRepMs: 800, maxRepMs: 12000, maxGapMs: 1000 },
    smoothingAlpha: 0.5,
    thresholds: { lockoutAngle: 160, fastRepMs: 1100, depthAttemptAngle: 130, noseMinVisibility: 0.5 },
  },
  signal(l, side) {
    return angleDeg(lm(l, sideName(side, 'Shoulder')), lm(l, sideName(side, 'Elbow')), lm(l, sideName(side, 'Wrist')));
  },
  features(l, side, cfg): FrameFeatures {
    const nose = lm(l, 'nose');
    const wrist = lm(l, sideName(side, 'Wrist'));
    // Positive = nose above the hands (image y grows downward). Only when the nose is reliably seen.
    return nose.visibility >= cfg.thresholds.noseMinVisibility! ? { chinClearance: wrist.y - nose.y } : {};
  },
  assessRep(rep, frames, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const cues: CueCandidate[] = [];
    const clear = finite(frames.map((f) => f.chinClearance));
    if (clear.length >= 3 && max(clear) < 0) cues.push({ id: 'chin_below_bar', priority: 3, message: 'Chin may not be clearing the bar. Pull a little higher.' });
    if (rep.topPeakSignal < t.lockoutAngle!) cues.push({ id: 'partial_hang', priority: 2, message: 'Possibly not lowering fully. Straighten your arms at the bottom.' });
    if (rep.endMs - rep.startMs < t.fastRepMs!) cues.push({ id: 'tempo_fast', priority: 1, message: 'Control the way down.' });
    return cues;
  },
  assessPartial(p, cfg) {
    if (p.reason === 'insufficient_depth' && p.minSignal < cfg.thresholds.depthAttemptAngle!) {
      return { id: 'depth', priority: 4, immediate: true, message: 'Not counted. Pull higher, chin toward the bar.' };
    }
    if (p.reason === 'too_fast') return { id: 'too_fast', priority: 2, immediate: true, message: 'That rep was too quick to count.' };
    return null;
  },
};

// ---------------------------------------------------------------------------------------------
// Plank (hold): side view, floor level. Time accrues while the body is horizontal and supported;
// "aligned" time requires the hip to stay near the shoulder–ankle line.
// ---------------------------------------------------------------------------------------------

export const PLANK: ExerciseDefinition = {
  id: 'plank',
  name: 'Plank',
  mode: 'hold',
  unit: 'seconds',
  signalLabel: 'Hip line',
  positionHint: 'Get into a plank: forearms or hands on the floor, body in a straight line, side-on to the camera.',
  cameraSetup: [
    'Put the phone on the floor about 2 m to your side.',
    'Your whole body, from head to feet, should be in frame from the side.',
  ],
  requiredLandmarksText: 'Shoulder, elbow, hip and ankle on the side facing the camera.',
  instructions: [
    'Forearm or straight-arm plank: elbows or hands under your shoulders.',
    'Keep a straight line from head to heels: no sagging, no piking.',
    'The timer runs only while you are in position.',
  ],
  config: {
    version: 1,
    quality: { requiredJoints: ['Shoulder', 'Elbow', 'Hip', 'Ankle'], minVisibility: 0.5, goodScore: 0.7, frameMargin: 0.01, orientation: 'horizontal', sideSwitchMargin: 0.15 },
    // Only maxGapMs is used in hold mode (tolerated tracking gap before the hold breaks).
    counter: { topThreshold: 0, bottomThreshold: 0, hysteresis: 0, readyHoldMs: 0, minRepMs: 0, maxRepMs: 0, maxGapMs: 1000 },
    smoothingAlpha: 0.5,
    thresholds: { sagOffset: 0.07, pikeOffset: -0.09, maxBodyTiltDeg: 35, cueWindowMs: 3000 },
  },
  signal: () => NaN,
  features: () => ({}),
  assessRep: () => [],
  assessPartial: () => null,
  holdCheck(l, side, cfg) {
    const t = cfg.thresholds as Record<string, number>;
    const sh = lm(l, sideName(side, 'Shoulder'));
    const an = lm(l, sideName(side, 'Ankle'));
    const tilt = 90 - angleFromVertical(an, sh); // 0 = perfectly horizontal
    const offset = signedOffsetFromLine(sh, an, lm(l, sideName(side, 'Hip')));
    const elbow = lm(l, sideName(side, 'Elbow'));
    const supported = elbow.y > sh.y; // elbow/hand below the shoulder = arms supporting the body
    const inPosition = tilt <= t.maxBodyTiltDeg! && supported && Number.isFinite(offset);
    const cues: CueCandidate[] = [];
    if (inPosition && offset > t.sagOffset!) cues.push({ id: 'hip_sag', priority: 3, message: 'Possible hip sag. Squeeze your glutes and brace.' });
    if (inPosition && offset < t.pikeOffset!) cues.push({ id: 'hip_pike', priority: 2, message: 'Hips may be too high. Lower them into a straight line.' });
    return { inPosition, aligned: inPosition && cues.length === 0, cues };
  },
};

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  pushup: PUSHUP,
  squat: SQUAT,
  lunge: LUNGE,
  pike_pushup: PIKE_PUSHUP,
  pullup: PULLUP,
  plank: PLANK,
};

export const EXERCISE_META: Record<ExerciseId, { category: string; defaultTarget: number; plural: string }> = {
  pushup: { category: 'push', defaultTarget: 10, plural: 'push-ups' },
  squat: { category: 'legs', defaultTarget: 15, plural: 'squats' },
  lunge: { category: 'legs', defaultTarget: 12, plural: 'lunges' },
  pike_pushup: { category: 'push', defaultTarget: 8, plural: 'pike push-ups' },
  pullup: { category: 'pull', defaultTarget: 5, plural: 'pull-ups' },
  plank: { category: 'core', defaultTarget: 30, plural: 's plank' },
};

/** "3×10 push-ups", "3×30 s plank". */
export function describeTarget(exerciseId: string, sets: number, target: number): string {
  const meta = (EXERCISE_META as Record<string, { plural: string }>)[exerciseId];
  return `${sets}×${target} ${meta?.plural ?? exerciseId}`;
}

/** Display unit for a set result of this exercise. */
export function setUnit(exerciseId: string): 'reps' | 's' {
  return getExercise(exerciseId)?.unit === 'seconds' ? 's' : 'reps';
}

export function getExercise(id: string): ExerciseDefinition | null {
  return (EXERCISES as Record<string, ExerciseDefinition>)[id] ?? null;
}
