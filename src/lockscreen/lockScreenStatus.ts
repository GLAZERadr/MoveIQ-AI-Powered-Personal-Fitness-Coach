/**
 * Shows the in-progress workout on the lock screen.
 *  - iOS: a Live Activity (expo-widgets). Requires a development build on iOS 16.2+ with Live Activities enabled.
 *  - Android: an ongoing (non-dismissable) local notification that we update in place (expo-notifications).
 *
 * Note: camera-based rep counting stops when the phone locks (the OS suspends the camera). The lock-screen
 * status shows the last known state, rest countdown and set progress; it does not keep tracking.
 * All failures are swallowed: lock-screen status is a convenience and must never break a workout.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';
import type { WorkoutActivityProps } from './WorkoutActivity';

type LiveActivityHandle = { update(p: WorkoutActivityProps): void; end(...args: unknown[]): Promise<void> };

let iosActivity: LiveActivityHandle | null = null;
const ANDROID_CHANNEL = 'workout-status';
const ANDROID_NOTIFICATION_ID = 'moveiq-active-workout';
let androidReady = false;

async function ensureAndroidChannel(): Promise<boolean> {
  if (androidReady) return true;
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Workout in progress',
    importance: AndroidImportance.LOW, // silent, no heads-up
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
  });
  androidReady = true;
  return true;
}

function body(p: WorkoutActivityProps): string {
  if (p.phase === 'Rest' && p.restEndsAt > 0) {
    const end = new Date(p.restEndsAt);
    return `${p.setLabel} · Rest until ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${p.reps}/${p.targetReps} reps`;
  }
  return `${p.setLabel} · ${p.phase} · ${p.reps}/${p.targetReps} reps`;
}

export async function startOrUpdateLockScreenStatus(p: WorkoutActivityProps): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      if (iosActivity) {
        iosActivity.update(p);
      } else {
        const mod = await import('./WorkoutActivity');
        iosActivity = mod.default.start(p, 'moveiq://workout/live') as unknown as LiveActivityHandle;
      }
    } else if (Platform.OS === 'android') {
      if (!(await ensureAndroidChannel())) return;
      await Notifications.scheduleNotificationAsync({
        identifier: ANDROID_NOTIFICATION_ID,
        content: { title: p.title, body: body(p), sticky: true, autoDismiss: false, data: { url: 'moveiq://workout/live' } },
        trigger: { channelId: ANDROID_CHANNEL },
      });
    }
  } catch {
    // Unsupported device/OS version or user disabled Live Activities: ignore.
  }
}

export async function endLockScreenStatus(): Promise<void> {
  try {
    if (Platform.OS === 'ios' && iosActivity) {
      const a = iosActivity;
      iosActivity = null;
      await a.end('immediate');
    } else if (Platform.OS === 'android') {
      await Notifications.dismissNotificationAsync(ANDROID_NOTIFICATION_ID);
    }
  } catch {
    // ignore
  }
}
