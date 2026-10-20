/**
 * Adapter: react-native-pose-detection (MediaPipe Pose Landmarker, on-device) → engine-agnostic PoseFrame.
 * This is the only file that imports the inference library; swap it to change engines.
 *
 * Frames are processed natively; landmarks cross to JS only because we request them (`data.mode: 'live'`).
 * Nothing is recorded or uploaded: we receive 33×4 floats per frame and drop the image.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /** Called only when the detector can't start even after retrying on the CPU. */
  onFatalError?: (error: { code: string; message: string; details: string[] }) => void;
}

/** How often we emit an explicit "no person" frame when the native side is silent. */
const EMPTY_TICK_MS = 250;

export function PoseStream(props: PoseStreamProps) {
  // If the detector fails to start with automatic GPU/CPU selection, remount once forcing the CPU
  // (some devices' GPU drivers break MediaPipe's graph). Only then is the failure reported.
  const [delegate, setDelegate] = useState<'auto' | 'cpu'>('auto');
  return (
    <PoseStreamInner
      key={delegate}
      {...props}
      delegate={delegate}
      onFatalError={(e) => {
        if (delegate === 'auto' && e.code !== 'PERMISSION_DENIED') setDelegate('cpu');
        else props.onFatalError?.(e);
      }}
    />
  );
}

function PoseStreamInner({ style, active, detecting, facing, showSkeleton, onFrame, onReady, onFatalError, delegate }: PoseStreamProps & { delegate: 'auto' | 'cpu' }) {
  const lastFrameAt = useRef(0);
  // Last warnings/errors from the native pipeline, attached to a fatal error for diagnosis.
  const recentLogs = useRef<string[]>([]);
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
      delegate={delegate}
      logLevel="warn"
      onLog={(entries) => {
        for (const e of entries) recentLogs.current.push(`[${e.level}/${e.category}] ${e.message}`);
        recentLogs.current = recentLogs.current.slice(-8);
      }}
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
        if (e.fatal) onFatalError?.({ code: String(e.code), message: e.message, details: [...recentLogs.current, `delegate: ${delegate}`] });
      }}
    />
  );
}
