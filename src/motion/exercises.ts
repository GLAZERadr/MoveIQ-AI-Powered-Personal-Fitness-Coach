import { CueCandidate } from './feedback';
import { angleDeg, angleFromVertical, lm, sideName, signedOffsetFromLine } from './geometry';
import { QualityConfig } from './quality';
import { CountedRep, PartialRep, RepCounterConfig } from './repCounter';
import { PoseLandmark, Side } from './types';

export type ExerciseId = 'pushup' | 'squat';

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

export interface ExerciseDefinition {
  id: ExerciseId;
  name: string;
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

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = { pushup: PUSHUP, squat: SQUAT };

export function getExercise(id: string): ExerciseDefinition | null {
  return (EXERCISES as Record<string, ExerciseDefinition>)[id] ?? null;
}
