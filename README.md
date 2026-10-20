# MoveIQ

**Train smarter. Live stronger.** MoveIQ is a cross-platform (iOS and Android) fitness app with four modules:

| Module | What works today |
| --- | --- |
| **Bodyweight training (AI)** | On-device camera pose estimation (MediaPipe), push-up and squat rep counting with a temporal state machine, live form cues, rest/pause/resume, a post-workout report, and re-analysis from stored landmarks |
| **Cutting** | Weight log with 7-day rolling average and weekly rate, nutrition log with reusable foods, calorie/protein adherence, waist and body-fat log, target sanity checks |
| **Running** | Manual entry with optional splits/HR/cadence/elevation, pace, weekly distance, personal records, split consistency, pace vs HR |
| **Swimming** | Manual pool and open-water entry, pace per 100 m, pool distance consistency check, weekly volume, records, stroke comparison |

The app also includes a unified Home dashboard with rule-based recommendations, a Progress tab, **Strava-style sharing** (image card or public link), a **lock-screen workout status** (iOS Live Activity and Android ongoing notification), and an optional **cloud backup** on Neon.

> Offline-first: everything is stored in on-device SQLite and works without a network. The cloud service is optional and only used when the user taps *Back up* or *Create public link*.

## Repository layout

```
src/
  app/            Expo Router screens (tabs: home, train, activities, cutting, progress, profile)
  motion/         Pose types, geometry, quality gating, RepCounter state machine, exercises, feedback, analyzer, report
    adapters/     MediaPipePoseStream.tsx: the ONLY file that imports the pose-estimation library
  domain/         Pure, tested calculations: units, dates, running, swimming, cutting, recommendations, validation
  db/             SQLite migrations + repositories (parameterized SQL behind a Db interface)
  data/           DbProvider (expo-sqlite adapter, reactive queries), dashboard loader, formatting
  workout/        Workout session state machine (IDLE → ACTIVE ⇄ PAUSED → COMPLETED)
  lockscreen/     iOS Live Activity layout + lock-screen status service
  cloud/          Client for the optional cloud service (backup, share links)
  ui/             Design tokens, components, SVG charts
server/           Cloud service (Hono on Node): Neon Postgres + Neon Object Storage
docs/             METRICS.md, DEVICE_VALIDATION.md, BACKEND.md
DEVLOG.md         Development log
```

## Requirements

- Node 22+ (developed on Node 23.7, npm 11)
- **A development build.** The app uses native modules (MediaPipe pose detection, Live Activities), so **Expo Go won't work**.
  - iOS: macOS with **Xcode 26+** (full Xcode, not just Command Line Tools), iOS 16.4+ device or simulator. Live Activities need iOS 16.2+ and a real device for the lock screen.
  - Android: Android Studio with SDK 24+ and an emulator or device.
  - Or build in the cloud with EAS: `npx eas-cli@latest build --profile development`.

## Running the app

**Android phone?** Follow the step-by-step guide: [docs/ANDROID_SETUP.md](docs/ANDROID_SETUP.md). Google/GitHub sign-in setup: [docs/AUTH_SETUP.md](docs/AUTH_SETUP.md).

```bash
npm install
```

Physical iPhone (recommended for camera features):

```bash
npx expo run:ios --device
```

Android device or emulator:

```bash
npx expo run:android
```

After the first native build, start the JS dev server only:

```bash
npm start
```

### Simulator vs physical device

| Capability | iOS Simulator | Android Emulator | Physical device |
| --- | --- | --- | --- |
| All logging, charts, persistence, sharing an image | ✅ | ✅ | ✅ |
| Camera pose estimation | ❌ (no camera) | ⚠️ virtual scene camera only, not useful for real testing | ✅ |
| Live Activity on lock screen | ⚠️ renders, but no real lock screen | n/a | ✅ |
| Ongoing notification | n/a | ✅ | ✅ |

Camera coaching must be validated on a real device using [docs/DEVICE_VALIDATION.md](docs/DEVICE_VALIDATION.md). Simulators can still exercise the *manual reps* workout path.

## Cloud service (Neon)

The project is linked to Neon project `autumn-term-24911124` (branch `production`). `neon.ts` declares Postgres and an `assets` Object Storage bucket. `neon deploy` provisions them and writes credentials to `.env.local` (gitignored).

```bash
npm run build:server
```

```bash
npm run server:start
```

The server listens on `:8787` and applies Postgres migrations on startup. To check it end to end against the real Neon services:

```bash
npm run smoke:server
```

The API is deployed on Vercel at **https://moveiq-api.vercel.app**, which is the app's default (`app.json → extra.apiUrl`). You can override it with `EXPO_PUBLIC_API_URL` or in **Profile → Cloud backup → Service URL**, e.g. `http://localhost:8787` for a local server. Details are in [docs/BACKEND.md](docs/BACKEND.md).

> The phone never receives database or storage credentials. Only the server talks to Neon.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Jest: motion engine, domain calculations, SQLite persistence (real SQLite via better-sqlite3), session machine, recommendations, validation |
| `npm run typecheck` | `tsc` for the app and the server |
| `npm run lint` | `expo lint` (ESLint + React Compiler rules) |
| `npm run build` | typecheck → compile server → `expo export` iOS + Android JS bundles |
| `npm run db:migrate` | Apply server Postgres migrations (direct/unpooled connection) |

## Key technical decisions

- **Pose estimation: MediaPipe Pose Landmarker via [`react-native-pose-detection`](https://www.npmjs.com/package/react-native-pose-detection) 0.2.x.** It's an Expo module (SDK ≥ 56, RN ≥ 0.85) that runs BlazePose (33 landmarks + visibility) natively on iOS and Android, with the model bundled at build time. Alternatives considered (Oct 2026):
  - `react-native-vision-camera-mlkit` 2.x: v2 implements only OCR and barcode, **no pose**.
  - `react-native-mediapipe`: unmaintained since 2024.
  - ML Kit plugins for VisionCamera v4: stale.

  The library's built-in "triggers" are single-threshold counters, which don't meet our requirements. We stream landmarks to our own engine instead. The library is young and single-maintainer, and it sits behind one adapter file so it can be swapped.
- **Rep counting** is a per-exercise state machine (`NOT_READY → READY → DESCENDING → BOTTOM → ASCENDING → rep`). It uses EMA smoothing, hysteresis, a top-hold requirement, min/max rep duration, and confidence gating. A gap longer than `maxGapMs` (even when followed by valid frames) abandons the rep in progress. Configuration lives in `src/motion/exercises.ts`, separate from the UI.
- **Form cues** are only issued from well-tracked reps, only when a deviation persists across reps, at most one at a time, rate-limited, and worded as "possible …".
- **Privacy:** no video is recorded. Retained data is 12 landmarks × (x, y, visibility) at about 15 fps, stored locally and auto-deleted after 14 days (configurable to 0, 7, 14 or 30). It's excluded from exports and cloud backups.
- **Local DB:** expo-sqlite with WAL, foreign keys, CHECK constraints, versioned migrations, and client-generated UUIDs with upserts, so retries never duplicate data.
- **Lock screen:** `expo-widgets` Live Activity on iOS and an `expo-notifications` ongoing notification on Android, plus a "rest over" local notification. The OS suspends the camera when the phone locks, so an active set auto-pauses. The lock screen shows set progress and the rest countdown, not live counting.
- **Backend:** node-postgres on Neon's pooled URL (long-running Node process), the direct URL for migrations, and the AWS S3 SDK with `forcePathStyle` for Neon Object Storage. These follow the installed Neon agent skills.

See [docs/METRICS.md](docs/METRICS.md) for every formula and definition.

## Known limitations

- Camera inference has **not yet been run on a physical device** in this environment (no Xcode or Android SDK installed). The analysis engine is tested with deterministic synthetic landmark sequences, which test the logic but are not evidence of on-device inference. Follow [docs/DEVICE_VALIDATION.md](docs/DEVICE_VALIDATION.md).
- Thresholds (e.g. push-up bottom ≤ 100°, squat bottom ≤ 105°) are starting values that need tuning with real recordings.
- Joint angles are 2D estimates from one camera. Depth, symmetry and lean are approximate.
- Spoken cues (TTS) are not implemented yet. Cues are visual plus haptic.
- Cloud identity is a per-device key, not a user account, and the deployed API has no rate limiting yet. Add Neon Auth and rate limiting before a public launch.
- Date entry uses text fields (YYYY-MM-DD); native date pickers are a planned enhancement.
