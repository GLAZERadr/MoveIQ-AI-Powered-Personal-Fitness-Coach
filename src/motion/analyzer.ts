import { ExerciseDefinition, FrameFeatures } from './exercises';
import { Cue, CueCandidate, DEFAULT_FEEDBACK_CONFIG, FeedbackConfig, TechniqueFeedbackEngine } from './feedback';
import { EmaFilter } from './geometry';
import { assessPoseQuality, qualityGuidance } from './quality';
import { CounterState, CountedRep, PartialRep, RepCounter } from './repCounter';
import { LANDMARK_INDEX, LandmarkName, PoseFrame, PoseLandmark, PoseQuality, QualityLevel, Side } from './types';

/** Landmarks retained for post-workout re-analysis (both sides; union of what the analyzers use). */
export const RETAINED_LANDMARKS: LandmarkName[] = [
  'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
  'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle',
];

/** Compact retained frame: [t, x0, y0, v0, x1, y1, v1, ...] for RETAINED_LANDMARKS, 3-decimal precision. */
export type RetainedFrame = number[] | [number]; // [t] alone = no person detected

export interface AnalyzerSnapshot {
  reps: number;
  partials: number;
  phase: CounterState;
  quality: PoseQuality;
  signal: number | null;
  guidance: string | null;
  lastCue: Cue | null;
}

export interface AnalyzerOutput {
  snapshot: AnalyzerSnapshot;
  newRep: CountedRep | null;
  newPartial: PartialRep | null;
  newCue: Cue | null;
}

export interface RepAssessment {
  rep: CountedRep;
  cues: string[];
  /** Mean quality score during the rep. */
  trackingScore: number;
}

export interface ExerciseAnalyzerOptions {
  feedback?: FeedbackConfig;
  /** Retain compact landmarks for re-analysis. Max ~15 frames/s are kept. */
  retainFrames?: boolean;
  retainMinIntervalMs?: number;
}

/**
 * Stateful per-set analyzer. Feed it PoseFrames in time order. It never treats an unusable frame as a
 * measurement: 'poor'/'none' quality frames contribute only a gap to the counter.
 */
export class ExerciseAnalyzer {
  readonly counter: RepCounter;
  readonly feedback: TechniqueFeedbackEngine;
  readonly assessments: RepAssessment[] = [];
  readonly qualityCounts: Record<QualityLevel, number> = { good: 0, partial: 0, poor: 0, none: 0 };
  readonly retained: RetainedFrame[] = [];

  private filter: EmaFilter;
  private side: Side | null = null;
  private repFrames: FrameFeatures[] = [];
  private repQuality: number[] = [];
  private lastRetainMs = -Infinity;
  private lastCue: Cue | null = null;
  private qualityScoreSum = 0;
  private qualityScoreN = 0;
  private lastSnapshot: AnalyzerSnapshot;

  constructor(
    readonly exercise: ExerciseDefinition,
    private readonly options: ExerciseAnalyzerOptions = {},
  ) {
    const cfg = exercise.config;
    this.counter = new RepCounter(cfg.counter);
    this.feedback = new TechniqueFeedbackEngine(options.feedback ?? DEFAULT_FEEDBACK_CONFIG);
    this.filter = new EmaFilter(cfg.smoothingAlpha, cfg.counter.maxGapMs);
    this.lastSnapshot = {
      reps: 0,
      partials: 0,
      phase: 'not_ready',
      quality: { level: 'none', score: 0, side: null, issues: ['no_person'], missing: [] },
      signal: null,
      guidance: null,
      lastCue: null,
    };
  }

  process(frame: PoseFrame): AnalyzerOutput {
    const ex = this.exercise;
    const cfg = ex.config;
    this.retain(frame);

    const quality = assessPoseQuality(frame, cfg.quality, this.side);
    this.qualityCounts[quality.level] += 1;
    if (quality.side) this.side = quality.side;

    let signal: number | null = null;
    if ((quality.level === 'good' || quality.level === 'partial') && frame.landmarks && quality.side) {
      const raw = ex.signal(frame.landmarks, quality.side);
      if (Number.isFinite(raw)) signal = this.filter.next(raw, frame.timestampMs);
      this.qualityScoreSum += quality.score;
      this.qualityScoreN += 1;
    }

    const events = this.counter.update(frame.timestampMs, signal);

    // Collect features only while a rep is in progress, and only from good-quality frames
    // (form cues are never derived from partial-confidence landmarks).
    const inRep = this.counter.state === 'descending' || this.counter.state === 'bottom' || this.counter.state === 'ascending';
    if (inRep && quality.level === 'good' && frame.landmarks && quality.side) {
      this.repFrames.push(ex.features(frame.landmarks, quality.side, cfg));
    }
    if (inRep && signal != null) this.repQuality.push(quality.score);

    let newRep: CountedRep | null = null;
    let newPartial: PartialRep | null = null;
    let newCue: Cue | null = null;

    for (const e of events) {
      if (e.type === 'state' && e.to === 'descending') {
        this.repFrames = [];
        this.repQuality = [];
        if (frame.landmarks && quality.side && quality.level === 'good') {
          this.repFrames.push(ex.features(frame.landmarks, quality.side, cfg));
        }
      }
      if (e.type === 'rep') {
        newRep = e.rep;
        const candidates = ex.assessRep(e.rep, this.repFrames, cfg);
        const repLevel = this.repQualityLevel();
        this.assessments.push({
          rep: e.rep,
          // Only record deviations when the rep was well tracked; otherwise they may be artefacts.
          cues: repLevel === 'good' ? candidates.map((c) => c.id) : [],
          trackingScore: this.repQuality.length ? this.repQuality.reduce((a, b) => a + b, 0) / this.repQuality.length : 0,
        });
        newCue = this.feedback.onRep(candidates, frame.timestampMs, repLevel) ?? newCue;
      }
      if (e.type === 'partial') {
        newPartial = e.partial;
        const cand: CueCandidate | null = ex.assessPartial(e.partial, cfg);
        newCue = this.feedback.onRep(cand ? [cand] : [], frame.timestampMs, quality.level === 'good' ? 'good' : quality.level) ?? newCue;
      }
    }
    if (newCue) this.lastCue = newCue;

    this.lastSnapshot = {
      reps: this.counter.reps.length,
      partials: this.counter.partials.length,
      phase: this.counter.state,
      quality,
      signal,
      guidance: qualityGuidance(quality, cfg.quality.orientation),
      lastCue: this.lastCue,
    };
    return { snapshot: this.lastSnapshot, newRep, newPartial, newCue };
  }

  get snapshot(): AnalyzerSnapshot {
    return this.lastSnapshot;
  }

  get meanTrackingScore(): number {
    return this.qualityScoreN ? this.qualityScoreSum / this.qualityScoreN : 0;
  }

  private repQualityLevel(): QualityLevel {
    if (this.repQuality.length === 0) return 'none';
    const m = this.repQuality.reduce((a, b) => a + b, 0) / this.repQuality.length;
    return m >= this.exercise.config.quality.goodScore ? 'good' : 'partial';
  }

  private retain(frame: PoseFrame): void {
    if (!this.options.retainFrames) return;
    const minInterval = this.options.retainMinIntervalMs ?? 66;
    if (frame.timestampMs - this.lastRetainMs < minInterval) return;
    this.lastRetainMs = frame.timestampMs;
    this.retained.push(encodeFrame(frame));
  }
}

const q3 = (n: number) => Math.round(n * 1000) / 1000;

export function encodeFrame(frame: PoseFrame): RetainedFrame {
  const t = Math.round(frame.timestampMs);
  if (!frame.landmarks) return [t];
  const out: number[] = [t];
  for (const name of RETAINED_LANDMARKS) {
    const l = frame.landmarks[LANDMARK_INDEX[name]];
    out.push(q3(l?.x ?? 0), q3(l?.y ?? 0), q3(l?.visibility ?? 0));
  }
  return out;
}

/** Rebuilds a 33-landmark frame. Landmarks that were not retained get visibility 0 (never "valid"). */
export function decodeFrame(r: RetainedFrame): PoseFrame {
  const t = r[0] as number;
  if (r.length === 1) return { timestampMs: t, landmarks: null };
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  RETAINED_LANDMARKS.forEach((name, i) => {
    landmarks[LANDMARK_INDEX[name]] = { x: r[1 + i * 3]!, y: r[2 + i * 3]!, z: 0, visibility: r[3 + i * 3]! };
  });
  return { timestampMs: t, landmarks };
}
