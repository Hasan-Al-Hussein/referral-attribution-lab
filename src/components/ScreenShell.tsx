import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReferralRuntime } from '../application/ReferralRuntime';
import { useReducedMotion } from '../motion/MotionProvider';
import { motion, useAppTheme } from '../theme/theme';

import { BrandHeader } from './BrandHeader';

import type { PropsWithChildren } from 'react';

export function ScreenShell({ children }: PropsWithChildren): React.JSX.Element {
  const { colors, isDark } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const { coordinator } = useReferralRuntime();
  const { width } = useWindowDimensions();
  const [sceneEntry] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const wasReduced = useRef(reducedMotion);
  const horizontalPadding = width < 520 ? 18 : width < 900 ? 28 : 36;

  useEffect(() => {
    const reducedBeforeThisRender = wasReduced.current;
    wasReduced.current = reducedMotion;
    sceneEntry.stopAnimation();
    if (reducedMotion || reducedBeforeThisRender) {
      sceneEntry.setValue(1);
      return;
    }
    sceneEntry.setValue(0);
    const animation = Animated.timing(sceneEntry, {
      toValue: 1,
      duration: motion.backdrop,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, sceneEntry]);

  useEffect(
    () => () => {
      sceneEntry.stopAnimation();
    },
    [sceneEntry],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={
            isDark
              ? ['#10262A', colors.background, '#101D2A']
              : ['#DCEFED', colors.background, '#EEF3F7']
          }
          locations={[0, 0.52, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          style={[
            styles.atmosphere,
            styles.atmosphereTop,
            {
              backgroundColor: colors.signalBlue,
              opacity: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] }),
              transform: [
                {
                  translateY: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.atmosphere,
            styles.atmosphereBottom,
            {
              backgroundColor: colors.solar,
              opacity: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.07] }),
              transform: [
                {
                  translateY: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [42, 0] }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orbitLine,
            {
              borderColor: colors.border,
              opacity: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.52] }),
              transform: [
                {
                  scale: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.signalDot,
            styles.signalDotOne,
            {
              backgroundColor: colors.accent,
              opacity: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.36] }),
              transform: [
                { scale: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.signalDot,
            styles.signalDotTwo,
            {
              backgroundColor: colors.signalBlue,
              opacity: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0, 0.32] }),
              transform: [
                { scale: sceneEntry.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
              ],
            },
          ]}
        />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: horizontalPadding }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.maxWidth}>
          <BrandHeader integrationMode={coordinator.integrationMode} />
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, overflow: 'hidden' },
  scrollContent: { flexGrow: 1, paddingBottom: 64 },
  maxWidth: { width: '100%', maxWidth: 1180, alignSelf: 'center' },
  atmosphere: { position: 'absolute', width: 360, height: 360, borderRadius: 180 },
  atmosphereTop: { right: -130, top: -170 },
  atmosphereBottom: { left: -210, bottom: -220 },
  orbitLine: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    borderWidth: 1,
    right: -310,
    top: 160,
  },
  signalDot: { position: 'absolute', width: 7, height: 7, borderRadius: 4 },
  signalDotOne: { right: '13%', top: 128 },
  signalDotTwo: { left: '8%', top: 310, width: 5, height: 5, borderRadius: 3 },
});
