/**
 * Engine-agnostic pose types. Any estimator (MediaPipe today, something else later) adapts to these.
 * Landmark indices follow the 33-point BlazePose/MediaPipe topology, which ML Kit also uses.
 */

export const LANDMARK_NAMES = [
  'nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner', 'rightEye', 'rightEyeOuter',
  'leftEar', 'rightEar', 'mouthLeft', 'mouthRight', 'leftShoulder', 'rightShoulder', 'leftElbow',
  'rightElbow', 'leftWrist', 'rightWrist', 'leftPinky', 'rightPinky', 'leftIndex', 'rightIndex',
  'leftThumb', 'rightThumb', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle',
  'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex',
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];
export const LANDMARK_INDEX: Record<LandmarkName, number> = Object.fromEntries(
  LANDMARK_NAMES.map((n, i) => [n, i]),
) as Record<LandmarkName, number>;

export interface PoseLandmark {
  /** Normalized 0..1 across the analysed image, origin top-left, y grows downward. */
  x: number;
  y: number;
  /** Relative depth; noisy and unused by the 2D analyzers. */
  z: number;
  /** 0..1 confidence that the landmark is visible / correctly placed. */
  visibility: number;
}

export interface PoseFrame {
  /** Monotonic milliseconds. */
  timestampMs: number;
  /** 33 landmarks, or null when no person was detected in this frame. */
  landmarks: PoseLandmark[] | null;
}

export type Side = 'left' | 'right';

export type QualityLevel = 'good' | 'partial' | 'poor' | 'none';

export type QualityIssue =
  | 'no_person'
  | 'landmarks_low_confidence'
  | 'body_out_of_frame'
  | 'wrong_orientation'
  | 'too_close';

export interface PoseQuality {
  level: QualityLevel;
  /** Mean visibility of the exercise's required landmarks on the chosen side (0..1). */
  score: number;
  side: Side | null;
  issues: QualityIssue[];
  missing: LandmarkName[];
}

/** Abstraction implemented by native adapters. UI code depends on this, not on a specific engine. */
export interface PoseEstimatorInfo {
  engine: string;
  model: string;
  /** True only when frames come from a real inference pipeline. */
  isRealInference: boolean;
}
