import { lm, mean, sideName } from './geometry';
import { LandmarkName, PoseFrame, PoseQuality, QualityIssue, Side } from './types';

export type Joint = 'Shoulder' | 'Elbow' | 'Wrist' | 'Hip' | 'Knee' | 'Ankle';

export interface QualityConfig {
  /** Joints that must be visible on the analysed side. */
  requiredJoints: Joint[];
  /** Per-landmark visibility below which a landmark is treated as missing. */
  minVisibility: number;
  /** Mean visibility at or above which tracking is "good" (form cues allowed). */
  goodScore: number;
  /** Landmarks closer than this to the image edge are treated as out of frame. */
  frameMargin: number;
  /** Expected body axis (shoulder→ankle) for this exercise's camera setup. */
  orientation: 'horizontal' | 'vertical';
  /** The other side must beat the current side by this much before we switch (prevents flicker). */
  sideSwitchMargin: number;
}

function chainScore(frame: PoseFrame, side: Side, joints: Joint[]): number {
  const l = frame.landmarks;
  if (!l) return 0;
  return mean(joints.map((j) => lm(l, sideName(side, j)).visibility));
}

/** Picks the better-visible side for a side-view exercise, with hysteresis. */
export function chooseSide(frame: PoseFrame, cfg: QualityConfig, previous: Side | null): Side {
  const left = chainScore(frame, 'left', cfg.requiredJoints);
  const right = chainScore(frame, 'right', cfg.requiredJoints);
  if (previous === 'left') return right > left + cfg.sideSwitchMargin ? 'right' : 'left';
  if (previous === 'right') return left > right + cfg.sideSwitchMargin ? 'left' : 'right';
  return left >= right ? 'left' : 'right';
}

/**
 * Assesses whether this frame is usable. Missing/low-confidence landmarks are never treated as valid
 * measurements: the analyzer skips frames whose level is 'poor' or 'none'.
 */
export function assessPoseQuality(frame: PoseFrame, cfg: QualityConfig, previousSide: Side | null): PoseQuality {
  const l = frame.landmarks;
  if (!l) return { level: 'none', score: 0, side: null, issues: ['no_person'], missing: [] };

  const side = chooseSide(frame, cfg, previousSide);
  const names: LandmarkName[] = cfg.requiredJoints.map((j) => sideName(side, j));
  const issues = new Set<QualityIssue>();
  const missing: LandmarkName[] = [];
  const m = cfg.frameMargin;

  for (const n of names) {
    const p = lm(l, n);
    const outOfFrame = p.x < m || p.x > 1 - m || p.y < m || p.y > 1 - m;
    if (outOfFrame) issues.add('body_out_of_frame');
    if (p.visibility < cfg.minVisibility || outOfFrame) missing.push(n);
  }
  if (missing.length > 0 && !issues.has('body_out_of_frame')) issues.add('landmarks_low_confidence');

  const score = mean(names.map((n) => lm(l, n).visibility));

  const shoulder = lm(l, sideName(side, 'Shoulder'));
  const ankleName = cfg.requiredJoints.includes('Ankle') ? sideName(side, 'Ankle') : sideName(side, 'Hip');
  const ankle = lm(l, ankleName);
  const dx = Math.abs(ankle.x - shoulder.x);
  const dy = Math.abs(ankle.y - shoulder.y);
  const orientationOk = cfg.orientation === 'horizontal' ? dx > dy : dy > dx;
  if (!orientationOk && missing.length === 0) issues.add('wrong_orientation');

  let level: PoseQuality['level'];
  if (missing.length > 0 || !orientationOk) level = 'poor';
  else if (score >= cfg.goodScore) level = 'good';
  else level = 'partial';

  return { level, score, side, issues: [...issues], missing };
}

/** Actionable guidance for the most important quality problem. */
export function qualityGuidance(q: PoseQuality, orientation: QualityConfig['orientation']): string | null {
  if (q.level === 'good') return null;
  if (q.issues.includes('no_person')) return 'Step into view so your whole body is visible.';
  if (q.issues.includes('body_out_of_frame')) return 'Move the camera farther away so your full body is visible.';
  if (q.issues.includes('wrong_orientation')) {
    return orientation === 'horizontal'
      ? 'Place the camera at your side, at floor level, so it sees your body from the side.'
      : 'Place the camera at your side at hip height so it sees you standing.';
  }
  if (q.issues.includes('landmarks_low_confidence')) {
    const hasLower = q.missing.some((n) => /Hip|Knee|Ankle/.test(n));
    return hasLower
      ? 'Adjust the camera angle to show your hips and knees.'
      : 'Make sure the lighting is good and your arms are clearly visible.';
  }
  if (q.level === 'partial') return 'Tracking is weak. Improve the lighting or wear clothes that contrast with the background.';
  return null;
}
