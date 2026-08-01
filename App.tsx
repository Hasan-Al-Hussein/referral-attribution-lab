import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ReferralRuntimeProvider, useReferralRuntime } from './src/application/ReferralRuntime';
import { MotionProvider, useReducedMotion } from './src/motion/MotionProvider';
import { InviteScreen } from './src/screens/InviteScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { SuccessScreen } from './src/screens/SuccessScreen';
import { AppThemeProvider, useAppTheme } from './src/theme/theme';

import type { SignupResult } from './src/application/ReferralCoordinator';
import type { ReferralAttribution } from './src/domain/referral';
import type { RootStackParamList } from './src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

function AppNavigator(): React.JSX.Element {
  const { isDark, colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const { coordinator } = useReferralRuntime();
  const routeReferral = useCallback((attribution: ReferralAttribution) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Onboarding', { attribution });
    }
  }, []);
  const routeAccepted = useCallback((result: SignupResult) => {
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [{ name: 'Success', params: result }] });
    }
  }, []);
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.surface,
      text: colors.ink,
      border: colors.border,
      primary: colors.accent,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={() => coordinator.setNavigator(routeReferral, routeAccepted)}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack.Navigator
        initialRouteName="Invite"
        screenOptions={{
          headerShown: false,
          animation: reducedMotion ? 'none' : 'slide_from_right',
          gestureEnabled: true,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Invite" component={InviteScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Success" component={SuccessScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <MotionProvider>
          <ReferralRuntimeProvider>
            <AppNavigator />
          </ReferralRuntimeProvider>
        </MotionProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}
