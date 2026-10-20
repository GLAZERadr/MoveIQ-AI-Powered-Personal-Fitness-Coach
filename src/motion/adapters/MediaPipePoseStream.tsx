/**
 * Adapter: react-native-pose-detection (MediaPipe Pose Landmarker, on-device) → engine-agnostic PoseFrame.
 * This is the only file that imports the inference library; swap it to change engines.
 *
 * Frames are processed natively; landmarks cross to JS only because we request them (`data.mode: 'live'`).
 * Nothing is recorded or uploaded: we receive 33×4 floats per frame and drop the image.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { PoseCamera, useCameraPermission } from 'react-native-pose-detection';
import { PoseEstimatorInfo, PoseFrame, PoseLandmark } from '../types';

export const ENGINE_INFO: PoseEstimatorInfo = {
  engine: 'MediaPipe Pose Landmarker via react-native-pose-detection',
  model: 'full (BlazePose GHUM, 33 landmarks)',
  isRealInference: true,
};

export { useCameraPermission };

const STRIDE = 4;

function toLandmarks(buf: Float32Array): PoseLandmark[] | null {
  if (buf.length < 33 * STRIDE) return null;
  const out: PoseLandmark[] = new Array(33);
  for (let i = 0; i < 33; i++) {
    const o = i * STRIDE;
    out[i] = { x: buf[o]!, y: buf[o + 1]!, z: buf[o + 2]!, visibility: buf[o + 3]! };
  }
  return out;
}

export interface PoseStreamProps {
  style?: StyleProp<ViewStyle>;
  /** Camera session on/off. Must be false when the screen is not focused or the app is backgrounded. */
  active: boolean;
  /** Inference on/off (off during rest and pause; preview keeps running). */
  detecting: boolean;
  facing: 'front' | 'back';
  showSkeleton: boolean;
  /** Called with every detected frame AND with `landmarks: null` when no body has been seen for a while. */
  onFrame: (frame: PoseFrame) => void;
  onReady?: (info: { delegate: string; targetFps: number }) => void;
  onFatalError?: (message: string) => void;
}

/** How often we emit an explicit "no person" frame when the native side is silent. */
const EMPTY_TICK_MS = 250;

export function PoseStream({ style, active, detecting, facing, showSkeleton, onFrame, onReady, onFatalError }: PoseStreamProps) {
  const lastFrameAt = useRef(0);
  const onFrameRef = useRef(onFrame);
  useLayoutEffect(() => {
    onFrameRef.current = onFrame;
  });

  // onPose only fires when a body is detected. Feed explicit empty frames so the analyzer
  // sees tracking loss instead of silently holding its last state.
  useEffect(() => {
    if (!active || !detecting) return;
    const t = setInterval(() => {
      const now = performance.now();
      if (now - lastFrameAt.current > EMPTY_TICK_MS) onFrameRef.current({ timestampMs: now, landmarks: null });
    }, EMPTY_TICK_MS);
    return () => clearInterval(t);
  }, [active, detecting]);

  return (
    <PoseCamera
      style={style}
      active={active}
      detection={detecting}
      facing={facing}
      maxPoses={1}
      overlay={showSkeleton ? { color: '#1FC96B', lineWidth: 3, pointRadius: 4, minVisibility: 0.5 } : false}
      data={{ mode: 'live', landmarks: true }}
      onPose={(f) => {
        // One monotonic JS clock for both detected and empty frames.
        const now = performance.now();
        lastFrameAt.current = now;
        onFrameRef.current({ timestampMs: now, landmarks: toLandmarks(f.landmarks) });
      }}
      onReady={(e) => onReady?.({ delegate: String(e.delegate), targetFps: e.targetFps })}
      onError={(e) => {
        if (e.fatal) onFatalError?.(e.message);
      }}
    />
  );
}
