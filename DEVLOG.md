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
