/**
 * Deterministic synthetic pose sequences for tests. Skeletons are built geometrically so the joint
 * angles the analyzers compute equal the requested angles (before noise).
 *
 * These test the analysis logic only. They are NOT evidence that camera-based inference works on a device.
 */
import { LANDMARK_INDEX, LandmarkName, PoseFrame, PoseLandmark } from '../types';

export const FPS = 30;
const DT = 1000 / FPS;
const rad = (d: number) => (d * Math.PI) / 180;

/** Small seeded PRNG (mulberry32) so "noisy" tests are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blank(visibility: number): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.3, z: 0, visibility }));
}

function set(l: PoseLandmark[], name: LandmarkName, x: number, y: number, visibility: number) {
  l[LANDMARK_INDEX[name]] = { x, y, z: 0, visibility };
}

export interface FrameOpts {
  visibility?: number;
  /** Visibility of the far (non-analysed) side. */
  farVisibility?: number;
  /** Positional noise amplitude (normalized units). */
  noise?: number;
  rand?: () => number;
}

function jitter(o: FrameOpts): () => number {
  const amp = o.noise ?? 0;
  const r = o.rand ?? Math.random;
  return () => (amp ? (r() * 2 - 1) * amp : 0);
}

/** Side-view push-up, left side facing camera. hipOffset is in units of shoulder–ankle length (+ = sag). */
export function pushupLandmarks(elbowDeg: number, hipOffset = 0, o: FrameOpts = {}): PoseLandmark[] {
  const v = o.visibility ?? 0.95;
  const fv = o.farVisibility ?? 0.3;
  const n = jitter(o);
  const l = blank(0.9);
  const S = { x: 0.3, y: 0.5 };
  const A = { x: 0.85, y: 0.5 };
  const H = { x: 0.575, y: 0.5 + hipOffset * 0.55 };
  const r = 0.12;
  const E = { x: S.x + r * Math.cos(rad(90)), y: S.y + r * Math.sin(rad(90)) };
  const wDir = rad(-90 + elbowDeg);
  const W = { x: E.x + r * Math.cos(wDir), y: E.y + r * Math.sin(wDir) };
  const K = { x: (H.x + A.x) / 2, y: (H.y + A.y) / 2 };
  for (const [side, vis] of [['left', v], ['right', fv]] as const) {
    set(l, `${side}Shoulder`, S.x + n(), S.y + n(), vis);
    set(l, `${side}Elbow`, E.x + n(), E.y + n(), vis);
    set(l, `${side}Wrist`, W.x + n(), W.y + n(), vis);
    set(l, `${side}Hip`, H.x + n(), H.y + n(), vis);
    set(l, `${side}Knee`, K.x + n(), K.y + n(), vis);
    set(l, `${side}Ankle`, A.x + n(), A.y + n(), vis);
  }
  return l;
}

/** Side-view squat, left side analysed. trunkLeanDeg = shoulder–hip angle from vertical. */
export function squatLandmarks(
  kneeDeg: number,
  trunkLeanDeg = 20,
  o: FrameOpts & { rightKneeDeg?: number } = {},
): PoseLandmark[] {
  const v = o.visibility ?? 0.95;
  const fv = o.farVisibility ?? 0.3;
  const n = jitter(o);
  const l = blank(0.9);
  const build = (deg: number, dx: number) => {
    const A = { x: 0.5 + dx, y: 0.85 };
    const K = { x: 0.5 + dx, y: 0.65 };
    const phi = rad(90 - deg);
    const H = { x: K.x + 0.2 * Math.cos(phi), y: K.y + 0.2 * Math.sin(phi) };
    const S = { x: H.x - 0.25 * Math.sin(rad(trunkLeanDeg)), y: H.y - 0.25 * Math.cos(rad(trunkLeanDeg)) };
    return { A, K, H, S };
  };
  const left = build(kneeDeg, 0);
  const right = build(o.rightKneeDeg ?? kneeDeg, 0.02);
  for (const [side, p, vis] of [['left', left, v], ['right', right, fv]] as const) {
    set(l, `${side}Shoulder`, p.S.x + n(), p.S.y + n(), vis);
    set(l, `${side}Elbow`, p.S.x + n(), p.S.y + 0.1 + n(), vis);
    set(l, `${side}Wrist`, p.S.x + n(), p.S.y + 0.2 + n(), vis);
    set(l, `${side}Hip`, p.H.x + n(), p.H.y + n(), vis);
    set(l, `${side}Knee`, p.K.x + n(), p.K.y + n(), vis);
    set(l, `${side}Ankle`, p.A.x + n(), p.A.y + n(), vis);
  }
  return l;
}

/** Angle trajectory: hold at top, then `reps` cosine-shaped reps from top to bottom and back. */
export function repTrajectory(opts: {
  top: number;
  bottom: number;
  reps: number;
  repMs: number;
  holdStartMs?: number;
  holdBetweenMs?: number;
  holdEndMs?: number;
}): number[] {
  const out: number[] = [];
  const push = (ms: number, f: (p: number) => number) => {
    const frames = Math.max(1, Math.round(ms / DT));
    for (let i = 0; i < frames; i++) out.push(f(i / frames));
  };
  push(opts.holdStartMs ?? 600, () => opts.top);
  for (let r = 0; r < opts.reps; r++) {
    push(opts.repMs, (p) => opts.bottom + ((opts.top - opts.bottom) * (1 + Math.cos(2 * Math.PI * p))) / 2);
    push(opts.holdBetweenMs ?? 300, () => opts.top);
  }
  push(opts.holdEndMs ?? 300, () => opts.top);
  return out;
}

export function toFrames(landmarks: (PoseLandmark[] | null)[], startMs = 0): PoseFrame[] {
  return landmarks.map((l, i) => ({ timestampMs: startMs + i * DT, landmarks: l }));
}
