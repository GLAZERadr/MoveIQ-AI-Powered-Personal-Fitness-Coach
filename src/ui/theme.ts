import { useColorScheme } from 'react-native';

/** Centralized design tokens. Components must use these instead of ad-hoc values. */

const palette = {
  green500: '#1FC96B',
  green600: '#17A858',
  green100: '#DDF7E8',
  green900: '#0B2A1A',
  red500: '#E5484D',
  amber500: '#E8A317',
  blue500: '#3E7BFA',
};

export interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  danger: string;
  warning: string;
  info: string;
  chartSecondary: string;
  overlay: string;
}

const light: Colors = {
  bg: '#F5F7F6',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF2F0',
  border: '#DCE3DF',
  text: '#0E1512',
  textMuted: '#5B6762',
  primary: palette.green600,
  primaryPressed: '#128A48',
  primarySoft: palette.green100,
  onPrimary: '#FFFFFF',
  danger: palette.red500,
  warning: '#B57A00',
  info: palette.blue500,
  chartSecondary: '#7C8B85',
  overlay: 'rgba(0,0,0,0.55)',
};

const dark: Colors = {
  bg: '#0A0F0C',
  surface: '#131A16',
  surfaceAlt: '#1B241F',
  border: '#26322B',
  text: '#ECF3EF',
  textMuted: '#97A59E',
  primary: palette.green500,
  primaryPressed: palette.green600,
  primarySoft: palette.green900,
  onPrimary: '#04140A',
  danger: '#FF6B6F',
  warning: palette.amber500,
  info: '#7AA5FF',
  chartSecondary: '#6E7D76',
  overlay: 'rgba(0,0,0,0.6)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  heading: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const },
  metric: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
  hero: { fontSize: 72, lineHeight: 80, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
};
/** Minimum touch target (iOS HIG 44pt, Material 48dp). */
export const MIN_TOUCH = 48;

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? dark : light;
  return { colors, dark: scheme === 'dark', spacing, radius, font };
}
