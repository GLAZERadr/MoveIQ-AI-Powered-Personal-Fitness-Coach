# Development log

## 2026-10-20: Initial build (MVP vertical slices for all four modules)

### Audit
- `General Projects/` held unrelated projects, so I created the new project `moveiq/` (Expo SDK 58, RN 0.88, React 19.3, TypeScript strict).
- Toolchain on this machine: Node 23.7, npm 11.4, Xcode **Command Line Tools only** (no Xcode.app), no Android SDK. Native builds and on-device camera testing can't run here.

### Decisions
- **Pose engine**: `react-native-pose-detection` 0.2.2 (MediaPipe Pose Landmarker, Expo module), chosen after checking npm metadata and sources. `react-native-vision-camera-mlkit` 2.x has no pose API; `react-native-mediapipe` has been unmaintained since 2024. Isolated behind `src/motion/adapters/MediaPipePoseStream.tsx`.
- **Own analysis engine**, not the library's single-threshold triggers.
- **Offline-first SQLite** is the source of truth. The **Neon backend** (requested separately) is limited to opt-in backup and share links, so the phone never holds DB credentials.
- **Lock screen** (user request mid-session): `expo-widgets` Live Activity (iOS) and `expo-notifications` ongoing notification (Android), plus a rest-over alert. Camera counting can't continue while locked, so the set auto-pauses.
- **Sharing** (user request mid-session): PNG share card through the system share sheet (offline), plus a public link (`/s/:id`) stored in Neon Postgres and Object Storage, revocable.

### Neon setup
- `npm i -g neon@latest` → neon 8.8.0.
- `neon init -y --org-id org-royal-glade-73080934 --project-id autumn-term-24911124 --branch production --services postgres,object-storage` → linked, `neon.ts` created, agent skills installed.
- `neon deploy` → browser auth completed; applied `+ bucket assets`; pulled 7 variables into `.env.local` (gitignored).

### Bugs found and fixed during implementation
- `tempo_fast` cue fired on normal 1.5 s reps (descent measured between thresholds under smoothing lag). Switched to whole-rep duration.
- RepCounter could continue a stale rep when valid frames resumed after a long silence (detection paused or phone locked). It now treats any gap > `maxGapMs` as tracking loss. Regression test added.
- `workout_exercises` lacked per-exercise targets, so interrupted sessions couldn't resume correctly. Added columns before the first release.
- Double `finish()` navigation race on the live screen. Guarded.
- React Compiler lint: 8 forms initialized state inside effects. Refactored to loader + prop-initialized form components. Fixed ref writes during render.

### Verification actually executed
- `npm test`: **74/74 passed** (motion 26, domain 28, SQLite persistence 13, session machine + recommendations 7).
- `npm run typecheck` (app + server): clean. `npm run lint`: exit 0, no findings.
- `npm run build`: exit 0. iOS and Android Hermes bundles exported (4.8 MB each).
- Bundle secret scan: 0 occurrences of the DB URL/host or S3 keys across the 55 exported files.
- `npm run server:start` against Neon: migrations applied, server up. `npm run smoke:server`: **11/11 checks passed** (Postgres 18.6, bucket `assets`).
- `expo start --dev-client`: Metro served iOS (HTTP 200, 8.6 MB) and Android (HTTP 200, 9.2 MB) dev bundles.

### Not verified (requires hardware or toolchain)
- Native iOS/Android compilation of the pose, widgets and notifications modules.
- Real camera inference, counting accuracy, Live Activity rendering. Procedure: `docs/DEVICE_VALIDATION.md`.

### Next
1. Build a dev client on a device (Xcode or EAS) and run the device validation; tune thresholds from real recordings and add them as fixtures.
2. Native date/time pickers; optional TTS cues.
3. Neon Auth + rate limiting + a deployed HTTPS origin before exposing share links publicly.
4. More exercises (lunge, plank, pike push-up) as new `ExerciseDefinition`s.

## 2026-10-20: Android focus (user's device is Android)
- `expo prebuild --platform android` succeeded: MediaPipe `pose_landmarker_full.task` (9.0 MB) downloaded, sha256 verified and bundled; `POST_NOTIFICATIONS` merged from expo-notifications; location/microphone stripped.
- Blocked legacy storage permissions; added `expo-system-ui` (Android dark mode); cloud URL now accepts `EXPO_PUBLIC_API_URL`.
- Added `eas.json` (development/preview profiles build APKs) and `docs/ANDROID_SETUP.md`.
- Not done: the EAS cloud build itself (needs the user's Expo login).

## 2026-10-20: API deployed to Vercel
- `server/` is now a standalone package (`moveiq-api`); `index.ts` renamed to `local.ts` so Vercel's zero-config Hono detection uses `app.ts`. Added `attachDatabasePool` (@vercel/functions). Backup cap lowered to 4 MB (Vercel 4.5 MB body limit).
- Vercel project `moveiq-api` (team adrian-glazers-projects); 6 Neon env vars added as sensitive production secrets.
- First deploy failed: `tsc` couldn't resolve `@hono/node-server` (needed only by local.ts); added it as a server devDependency. Second deploy: Ready.
- Production: https://moveiq-api.vercel.app. `SMOKE_URL=https://moveiq-api.vercel.app npm run smoke:server` → 11/11 passed. App default `extra.apiUrl` now points there.

## 2026-10-20: Google and GitHub sign-in
- Neon Managed Auth documents only browser redirect flows (no React Native/deep-link guidance), so I used self-managed Better Auth 1.7.11 + `@better-auth/expo` on the Vercel API, with users and sessions in Neon Postgres (the neon-auth skill's self-managed path).
- `npm run db:migrate` created `user`, `session`, `account`, `verification` in Neon. Sign-in is social-only (no passwords).
- Backups and shares are owned by the account when signed in, otherwise by the device key.
- App: Profile → Account card (Continue with Google/GitHub, sign out); session cookie stored in SecureStore and sent to the API.
- Deployed with BETTER_AUTH_SECRET/URL on Vercel; live `/v1/auth/providers` → `[]` (awaiting the user's OAuth credentials); prod smoke 11/11.
- Not verified yet: a real Google/GitHub sign-in round-trip (needs credentials + the Android dev build).

## 2026-10-20: OAuth keys + brand assets
- User supplied Google and GitHub OAuth credentials; saved to `.env.auth.local` and pushed to Vercel (sensitive) via `npm run auth:push`. Live `/v1/auth/providers` → `google, github`.
- Live check of the authorize step: GitHub accepts the client (shows its sign-in page). **Google returns `redirect_uri_mismatch`** for `https://moveiq-api.vercel.app/api/auth/callback/google`. The URI must be added to the Google client's Authorized redirect URIs (user action).
- Logo redrawn as vector geometry (`scripts/generate-brand-assets.py`): iOS icon, Android adaptive foreground/background/monochrome, splash (#071822), `assets/logo.png`. Used on onboarding and the share card. Verified via Android prebuild (mipmaps + splash generated) and bundle export.

## 2026-10-20: Google publishing requirements
- Public pages on the API: `/` (home), `/privacy`, `/terms` (`server/pages.ts`), logo via `server/public/logo.png`; optional `GOOGLE_SITE_VERIFICATION` meta tag. `SUPPORT_EMAIL` env set on Vercel.
- Account deletion: `DELETE /v1/me` removes the user's backups, shares (DB + objects), sessions, provider accounts and user row; app Account card has "Delete account" (in the next APK build).
- Verified live: all pages 200, logo served, `/v1/me` DELETE → 401 when signed out, prod smoke 11/11.

## 2026-10-20: v1.1.0: GPS recording, OSM maps, date pickers, 4 new exercises, delete account
- **GPS run recording** (free: device GNSS via expo-location). Android foreground service ("Recording your run" notification) keeps recording with the screen off; only "while using" permission (ACCESS_BACKGROUND_LOCATION explicitly removed). Fixes are written to SQLite by the background task, so runs survive backgrounding or a kill. `src/domain/gps.ts`: accuracy/jump filtering, segment-aware distance, moving time, smoothed elevation with hysteresis, per-km splits interpolated between real fixes. 7 tests; found and fixed an altitude-noise bug (±1.5 m noise counted as 300 m climb).
- **Maps:** OpenStreetMap tiles via Leaflet 1.9.4 in a WebView (attribution, identifying UA/Referer per the OSM tile policy); SVG route fallback offline. Routes stay on device (excluded from exports/backups/shares). Privacy policy updated (location + OSM tile requests).
- **Date/time pickers** (native Android dialogs) replace typed YYYY-MM-DD/HH:MM everywhere.
- **Exercises:** lunge, pike push-up, pull-up (rep state machine with exercise-specific signals and cues) and plank (new hold mode: time in position, longest hold, % aligned, windowed cues). 13 new tests. Nose added to retained landmarks for pull-up chin checks. Catalog seed upserts camera support on existing installs; starter plans "Upper body" and "Legs & core" are added once and never re-added if deleted.
- Delete account button (from the previous round) ships in this build. Google sign-in verified fixed (Google now shows its account chooser).
- Checks: 96/96 tests, typecheck and lint clean, Android prebuild permissions verified, bundle exports. EAS preview build 10d27d87 (v1.1.0, versionCode 2).

## 2026-10-21: v1.2.0: training fix, sign-in screen, food database, automatic calculations
- **Training bug (user report):** "Camera tracking stopped: com.google.mediapipe.framework.Graph" on the release APK. The library's `DETECTOR_INIT_FAILED` (both GPU and CPU builds failed) with a class-name message = MediaPipe's JNI couldn't load a Java class: R8 minification (on by default in Expo release builds). Fix: `expo-build-properties` disables minify/shrinkResources for Android release (verified in generated gradle.properties). Also: automatic CPU-delegate retry, on-screen diagnostics (error code + last native warnings), workout no longer auto-pauses on 'inactive' (permission dialogs); notification permission requested on the setup screen instead of mid-set. **Unverified until tested on the phone.**
- **Sign-in/sign-up screen** (`/welcome`): Google/GitHub (first sign-in creates the account), or continue without an account; shown once to everyone including existing installs; name pre-fills onboarding.
- **Cloud backup removed** from Profile and from the privacy policy (server endpoints left in place, unused).
- **Food database:** USDA FoodData Central SR Legacy (7,793 foods, public domain) converted by `scripts/build-food-db.py` into a bundled offline JSON; 75 Indonesian/English aliases mapped to exact USDA records (test-verified); prefix search; nutrition = per-100 g × grams or USDA standard portions. 6 tests.
- **Automatic calculations:** daily kcal/protein/fat/carb targets (Mifflin-St Jeor × activity; cut ≈0.5% BW/week, capped, floored), updating with the 7-day average (toggle Automatic/Manual); BMI; projected goal date (only when trending toward target); swim distance from lengths × pool length; workout auto-progression (+1 rep / +5 s when all sets hit target). 10 new tests.
- Checks: 112/112 tests, typecheck/lint clean, Android bundle 6.5 MB. EAS build 1768bd87 (v1.2.0, versionCode 3).
