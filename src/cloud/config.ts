import Constants from 'expo-constants';

export const DEFAULT_API_URL = 'https://moveiq-api.vercel.app';

export function resolveApiUrl(settingUrl: string): string | null {
  // Precedence: user setting > EXPO_PUBLIC_API_URL (build/dev-server time) > app.json extra.apiUrl.
  // On a physical phone, localhost is the phone itself: use the computer's LAN IP or a deployed URL.
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  const url = (settingUrl || fromEnv || fromConfig || '').trim().replace(/\/+$/, '');
  return url || null;
}
