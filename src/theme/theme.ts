import {
  createContext,
  createElement,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Easing, Platform } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export interface AppTheme {
  isDark: boolean;
  mode: ThemeMode;
  toggleTheme(): void;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    surfaceGlass: string;
    ink: string;
    inkMuted: string;
    inkSubtle: string;
    border: string;
    borderStrong: string;
    accent: string;
    accentStrong: string;
    accentSoft: string;
    ctaStart: string;
    ctaEnd: string;
    signalMist: string;
    signalBlue: string;
    signalTeal: string;
    solar: string;
    success: string;
    successSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    white: string;
    black: string;
    overlay: string;
  };
}

const lightColors: AppTheme['colors'] = {
  background: '#F3F7F7',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#E8F0F0',
  surfaceGlass: 'rgba(255, 255, 255, 0.84)',
  ink: '#102A2E',
  inkMuted: '#486267',
  inkSubtle: '#61777B',
  border: '#D2E0E0',
  borderStrong: '#89A6A8',
  accent: '#0B8178',
  accentStrong: '#075F5B',
  accentSoft: '#DDF3EF',
  ctaStart: '#0B8178',
  ctaEnd: '#0A5872',
  signalMist: '#D9EFEC',
  signalBlue: '#397FAD',
  signalTeal: '#2BAA9D',
  solar: '#D87532',
  success: '#08725A',
  successSoft: '#DDF4EC',
  warning: '#8A4D12',
  warningSoft: '#FFF0DD',
  danger: '#A91F38',
  dangerSoft: '#FFE9EE',
  white: '#FFFFFF',
  black: '#0A1517',
  overlay: 'rgba(11, 47, 50, 0.09)',
};

const darkColors: AppTheme['colors'] = {
  background: '#091518',
  surface: '#102126',
  surfaceElevated: '#173039',
  surfaceMuted: '#1E3940',
  surfaceGlass: 'rgba(16, 33, 38, 0.9)',
  ink: '#EFF9F8',
  inkMuted: '#B8CCCE',
  inkSubtle: '#91AAAD',
  border: '#29474E',
  borderStrong: '#52737A',
  accent: '#5DD6C7',
  accentStrong: '#8AE8DD',
  accentSoft: '#143E3B',
  ctaStart: '#168E84',
  ctaEnd: '#176781',
  signalMist: '#D9EFEC',
  signalBlue: '#74AEDA',
  signalTeal: '#5DD6C7',
  solar: '#F0A15C',
  success: '#63D4AD',
  successSoft: '#153B31',
  warning: '#F1B76D',
  warningSoft: '#49331E',
  danger: '#FF8DA1',
  dangerSoft: '#48212D',
  white: '#FFFFFF',
  black: '#121212',
  overlay: 'rgba(0, 9, 11, 0.38)',
};

const ThemeContext = createContext<AppTheme | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren): React.JSX.Element {
  // The lab is light-first, with a deliberately authored dark theme for inspection.
  const [mode, setMode] = useState<ThemeMode>('light');
  const value = useMemo<AppTheme>(
    () => ({
      isDark: mode === 'dark',
      mode,
      toggleTheme: () => setMode((current) => (current === 'light' ? 'dark' : 'light')),
      colors: mode === 'dark' ? darkColors : lightColors,
    }),
    [mode],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme(): AppTheme {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useAppTheme must be used within AppThemeProvider');
  return value;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  hero: 48,
  section: 64,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const typography = {
  family: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  }),
} as const;

export const motion = {
  press: 140,
  hoverIn: 180,
  hoverOut: 120,
  state: 200,
  feedback: 220,
  route: 320,
  reveal: 360,
  journey: 400,
  backdrop: 760,
  celebration: 720,
  stagger: 44,
  easeOut: Easing.bezier(0.16, 1, 0.3, 1),
  nativeDriver: Platform.OS !== 'web',
} as const;
