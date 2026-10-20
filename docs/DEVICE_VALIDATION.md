# Physical-device validation

Unit tests drive the analysis engine with synthetic landmark sequences. They prove the logic, **not** that camera inference works. Run this procedure on at least one iPhone and one Android phone before relying on camera coaching.

## 0. Build

- iOS: `npx expo run:ios --device` (Xcode 26+, signing team selected). Android: `npx expo run:android --device`.
- Check the build log for the `react-native-pose-detection` model step ("full" model). On iOS, also check that the `expo-widgets` extension target was created.
- Optional sanity check of the native install: `npx react-native-pose-detection doctor`.

## 1. Permissions and lifecycle

| Step | Expected |
| --- | --- |
| Train → Push-up → *Start with camera coaching* | System camera prompt shows the MoveIQ explanation text |
| Deny | Setup shows "Camera access is off" with *Open Settings*; *Log reps manually* still works |
| Allow, start | Preview plus skeleton overlay; "Hold the start position…" |
| Background the app mid-set | Set pauses; camera indicator turns off |
| Revoke camera permission in Settings, reopen | No crash; camera unavailable message or prompt |
| Finish workout | Camera indicator turns off; report opens |

## 2. Tracking quality guidance

| Scenario | Expected message |
| --- | --- |
| Step out of frame | "Step into view…" or "Move the camera farther away…" |
| Face the camera for push-ups | "Place the camera at your side, at floor level…" |
| Dim light | "Make sure the lighting is good…" or tracking shown as weak/poor |
| Knees hidden (squat) | "Adjust the camera angle to show your hips and knees." |

No form cues should appear while the quality indicator isn't green.

## 3. Counting accuracy (record results)

For each exercise, have a person do the sets below while a second person counts. Record the app count vs the true count.

| Set | Push-up | Squat |
| --- | --- | --- |
| 10 full reps, normal tempo | expect 10 | expect 10 |
| 5 full + 5 half reps | expect 5 counted, ~5 "not counted" | same |
| 10 fast reps (< 1 s) | count, possibly with "Slow down" | same |
| Hold the bottom 5 s mid-set, then continue | no double count | no double count |
| Walk out of frame mid-rep for 3 s, return, continue | interrupted rep not counted; counting resumes after holding the top | same |
| Phone on a wobbly surface / slight shaking | no phantom reps at rest | same |

Acceptance target for v1: **≥ 95% count agreement on full-ROM sets and 0 phantom reps at rest.** If not met, tune `config.counter` in `src/motion/exercises.ts` and add a regression test.

## 4. Form cues

- Push-ups with deliberate hip sag for 4+ reps: "Possible hip sag…" appears after rep 2 or 3, not every rep.
- Squats with strong forward lean: "Possible excessive forward lean…".
- Clean reps: no cues.

## 5. Report and re-analysis

- Report shows reps, not-counted reasons, ROM ± SD, tempo, tracking %, deviations and limitations.
- *Re-analyse from stored movement* gives the same rep count.
- Set retention to *Don't keep* and do a set: no re-analysis button for that set.
- Force-quit mid-workout and reopen: Home shows *Resume workout*; completed sets are intact.

## 6. Lock screen

- iOS: start a workout with *Show workout on lock screen* on, lock the phone. A Live Activity shows exercise, set and reps; during rest it shows the rest time; a "Rest over" notification fires.
- Android: the ongoing notification is visible on the lock screen and updates between sets.
- Finishing the workout removes the Live Activity / notification.

## 7. Performance

Watch for dropped frames or heat over a 10-minute session. The library lowers its frame rate under thermal pressure. Reps should still count at ≥ 10 fps (expected on the "lite" model for budget Android phones; switch `model` in `app.json` if needed).

## Recording real sequences for regression tests

To turn a device session into a test fixture: keep retention on, complete a set, export the JSON from `Documents/pose-sequences/<setId>.json` (Xcode → Devices → Download Container, or `adb`), and replay it in a test with `reanalyze(EXERCISE, frames)`.
