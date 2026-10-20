/**
 * iOS Live Activity layout for an in-progress workout (lock screen + Dynamic Island).
 * Runs in the widget extension: no hooks, imports, or module-scope references inside the function.
 */
import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type WorkoutActivityProps = {
  title: string;
  /** e.g. "Set 2/3". */
  setLabel: string;
  reps: number;
  targetReps: number;
  /** "Training", "Rest", "Paused". */
  phase: string;
  /** Unix ms when the rest ends; 0 when not resting. */
  restEndsAt: number;
};

const WorkoutActivity = (props: WorkoutActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const accent = environment.isLuminanceReduced ? '#FFFFFF' : '#1FC96B';
  const restSec = props.restEndsAt > 0 ? Math.max(0, Math.round((props.restEndsAt - Date.now()) / 1000)) : 0;
  const status = props.phase === 'Rest' ? `Rest ${Math.floor(restSec / 60)}:${String(restSec % 60).padStart(2, '0')}` : props.phase;
  return {
    banner: (
      <HStack modifiers={[padding({ all: 14 })]}>
        <VStack>
          <Text modifiers={[font({ weight: 'bold', size: 16 }), foregroundStyle(accent)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 })]}>{`${props.setLabel} · ${status}`}</Text>
        </VStack>
        <Text modifiers={[font({ weight: 'bold', size: 34 })]}>{`${props.reps}/${props.targetReps}`}</Text>
      </HStack>
    ),
    compactLeading: <Text modifiers={[foregroundStyle(accent)]}>{props.setLabel}</Text>,
    compactTrailing: <Text>{`${props.reps}`}</Text>,
    minimal: <Text modifiers={[foregroundStyle(accent)]}>{`${props.reps}`}</Text>,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ weight: 'bold' }), foregroundStyle(accent)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.setLabel}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ weight: 'bold', size: 26 })]}>{`${props.reps}/${props.targetReps}`}</Text>
        <Text modifiers={[font({ size: 12 })]}>reps</Text>
      </VStack>
    ),
    expandedBottom: <Text modifiers={[padding({ all: 10 })]}>{status}</Text>,
  };
};

export default createLiveActivity('WorkoutActivity', WorkoutActivity);
