/**
 * Better Auth client for Google/GitHub sign-in (see server/auth.ts).
 * OAuth runs in the system browser and returns via the `moveiq://` deep link; the session cookie is
 * kept in the OS keystore (expo-secure-store), never in plain AsyncStorage.
 */
import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_API_URL, resolveApiUrl } from '../cloud/config';

export const authClient = createAuthClient({
  // Sign-in always uses the deployed API (or EXPO_PUBLIC_API_URL / app.json); the per-device
  // "Service URL" override in Profile applies to backup/share requests only.
  baseURL: resolveApiUrl('') ?? DEFAULT_API_URL,
  plugins: [
    expoClient({
      scheme: 'moveiq',
      storagePrefix: 'moveiq',
      storage: SecureStore,
    }),
  ],
});

export type SocialProvider = 'google' | 'github';
