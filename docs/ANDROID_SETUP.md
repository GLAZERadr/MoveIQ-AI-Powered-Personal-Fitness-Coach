# Running MoveIQ on your Android phone

MoveIQ uses native code (MediaPipe pose detection), so it can't run in **Expo Go**. You install a **development build**: your own APK of MoveIQ that loads the app's code from your Mac while you develop.

Requirements: Android 7.0+ (API 24), with the phone and Mac on the **same Wi-Fi**.

## Option A: build in the cloud (recommended; no Android Studio needed)

### 1. One-time: Expo account
Create a free account at <https://expo.dev/signup>, then log in on your Mac:

```bash
npx eas-cli@latest login
```

### 2. Build the APK (about 10–20 minutes, runs on Expo's servers)

```bash
npx eas-cli@latest build --platform android --profile development
```

The first time, answer **Yes** to "create an EAS project" and "generate a new Android Keystore". When it finishes, it prints a link and a QR code.

### 3. Install on the phone
1. Open the link (or scan the QR code) on your phone and download the `.apk`.
2. When Android asks, allow your browser to **install unknown apps** (Settings → Apps → *your browser* → Install unknown apps).
3. Open the downloaded file and tap **Install**. If Play Protect warns about an unknown developer, choose **Install anyway**. It's your own build.

You only need to rebuild the APK when native packages or `app.json` change. JavaScript changes just reload.

### 4. Start the app's code server on your Mac
In the project folder:

```bash
npm start
```

Open **MoveIQ** on the phone. The development launcher lists your Mac's server; tap it (or scan the QR code in the terminal from inside the launcher).

If it doesn't connect (common on office or guest Wi-Fi, which blocks device-to-device traffic), use a tunnel instead:

```bash
npx expo start --dev-client --tunnel
```

### 5. First launch
- Complete onboarding.
- Train → Push-up → *Start with camera coaching* → **Allow** camera.
- When you start a workout with the lock-screen setting on, **Allow** notifications (needed for the lock-screen status and the "Rest over" alert on Android 13+).
- Set up the phone as described in the camera setup card: on the floor, about 2 m to your side, whole body in frame.

## Option B: USB cable + Android Studio (builds on your Mac)

1. Install [Android Studio](https://developer.android.com/studio). In its first-run wizard, install the Android SDK.
2. Add to `~/.zshrc`, then open a new terminal:
   ```
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```
3. On the phone: Settings → About phone → tap **Build number** 7 times → Developer options → enable **USB debugging**. Plug in and accept the prompt.
4. Run:
   ```bash
   npx expo run:android --device
   ```

## Cloud backup and share links

These use the deployed API at **https://moveiq-api.vercel.app** (Vercel + Neon). It's the app's default, so there's nothing to configure and it works on any network, including mobile data and release builds. To test with a local server instead, set Profile → Cloud backup → Service URL to `http://<your-mac-ip>:8787` (development builds only).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "No development servers found" | Same Wi-Fi? Try `--tunnel`. Check that the macOS firewall allows `node`. |
| Camera shows "module isn't available" | You opened it in Expo Go. Use the MoveIQ app you installed. |
| Pose tracking is slow (< 10 fps) on a budget phone | In `app.json`, change the pose-detection `"model": "full"` to `"lite"`, then rebuild the APK. |
| No lock-screen notification | Settings → Apps → MoveIQ → Notifications → allow "Workout in progress". |
| Reps miscounted | Follow `docs/DEVICE_VALIDATION.md` and report the case so thresholds can be tuned. |
