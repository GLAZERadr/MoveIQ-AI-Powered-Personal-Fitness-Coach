import { ExerciseAnalyzer, RetainedFrame, decodeFrame } from './analyzer';
import { ExerciseDefinition } from './exercises';
import { mean, stdDev } from './geometry';
import { PartialReason } from './repCounter';

export interface SetReport {
  exerciseId: string;
  analyzerVersion: number;
  reps: number;
  partials: Record<PartialReason, number>;
  /** Range of motion per rep, degrees (top peak − bottom), and its consistency. */
  romMeanDeg: number | null;
  romStdDeg: number | null;
  /** Lowest signal reached per rep, degrees (approximate depth). */
  depthMeanDeg: number | null;
  depthStdDeg: number | null;
  tempo: { descentMeanMs: number | null; ascentMeanMs: number | null; repMeanMs: number | null; repCv: number | null };
  tracking: { meanScore: number; goodFramePct: number; framesAnalyzed: number };
  /** How many well-tracked reps showed each possible deviation. */
  deviations: { id: string; reps: number }[];
  cuesShown: { id: string; message: string; atMs: number }[];
  limitations: string[];
}

export function buildSetReport(analyzer: ExerciseAnalyzer): SetReport {
  const ex = analyzer.exercise;
  const reps = analyzer.counter.reps;
  const roms = reps.map((r) => r.topPeakSignal - r.minSignal).filter(Number.isFinite);
  const depths = reps.map((r) => r.minSignal);
  const durations = reps.map((r) => r.endMs - r.startMs);
  const partials: Record<PartialReason, number> = { insufficient_depth: 0, too_fast: 0, too_slow: 0, tracking_lost: 0 };
  for (const p of analyzer.counter.partials) partials[p.reason] += 1;

  const dev = new Map<string, number>();
  for (const a of analyzer.assessments) for (const id of a.cues) dev.set(id, (dev.get(id) ?? 0) + 1);

  const qc = analyzer.qualityCounts;
  const total = qc.good + qc.partial + qc.poor + qc.none;
  const goodPct = total ? (qc.good / total) * 100 : 0;

  const limitations: string[] = [
    'Joint angles are 2D estimates from a single camera and are affected by camera angle, clothing and body proportions.',
  ];
  if (goodPct < 60) limitations.push('Tracking quality was low for a large part of this set, so technique observations are limited.');
  if (ex.id === 'squat' && !analyzer.assessments.some((a) => a.cues.includes('asymmetry'))) {
    limitations.push('Left-right symmetry is only assessed when both legs are clearly visible.');
  }
  if (partials.tracking_lost > 0) limitations.push(`${partials.tracking_lost} rep(s) could not be evaluated because tracking was lost.`);

  const m = (xs: number[]) => (xs.length ? mean(xs) : null);
  const s = (xs: number[]) => (xs.length >= 2 ? stdDev(xs) : null);
  const repMean = m(durations);

  return {
    exerciseId: ex.id,
    analyzerVersion: ex.config.version,
    reps: reps.length,
    partials,
    romMeanDeg: m(roms),
    romStdDeg: s(roms),
    depthMeanDeg: m(depths),
    depthStdDeg: s(depths),
    tempo: {
      descentMeanMs: m(reps.map((r) => r.descentMs)),
      ascentMeanMs: m(reps.map((r) => r.ascentMs)),
      repMeanMs: repMean,
      repCv: repMean && durations.length >= 2 ? stdDev(durations) / repMean : null,
    },
    tracking: { meanScore: analyzer.meanTrackingScore, goodFramePct: goodPct, framesAnalyzed: total },
    deviations: [...dev.entries()].map(([id, n]) => ({ id, reps: n })).sort((a, b) => b.reps - a.reps),
    cuesShown: analyzer.feedback.issued.map((c) => ({ id: c.id, message: c.message, atMs: c.atMs })),
    limitations,
  };
}

/** Re-runs the analysis engine over a retained landmark sequence (post-workout mode). */
export function reanalyze(exercise: ExerciseDefinition, frames: RetainedFrame[]): SetReport {
  const analyzer = new ExerciseAnalyzer(exercise, { retainFrames: false });
  for (const f of frames) analyzer.process(decodeFrame(f));
  return buildSetReport(analyzer);
}

export const DEVIATION_LABELS: Record<string, string> = {
  hip_sag: 'Possible hip sag',
  hip_pike: 'Hips possibly rising',
  lockout: 'Possibly incomplete lockout',
  tempo_fast: 'Rushed reps',
  forward_lean: 'Possible excessive forward lean',
  asymmetry: 'Possible left-right imbalance',
};

/** Areas for improvement derived from deviations seen in ≥ 30% of well-tracked reps. */
export function improvementAreas(report: SetReport): string[] {
  if (report.reps === 0) return [];
  const out = report.deviations
    .filter((d) => d.reps / report.reps >= 0.3)
    .map((d) => `${DEVIATION_LABELS[d.id] ?? d.id} in ${d.reps} of ${report.reps} reps`);
  if (report.partials.insufficient_depth > 0) out.push(`${report.partials.insufficient_depth} attempt(s) did not reach counted depth`);
  if (report.tempo.repCv != null && report.tempo.repCv > 0.35) out.push('Rep tempo varied a lot. Try a steadier rhythm.');
  return out;
}
