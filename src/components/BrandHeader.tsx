import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MotionPressable } from '../motion/MotionPressable';
import { useReducedMotion } from '../motion/MotionProvider';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

interface BrandHeaderProps {
  integrationMode: 'native' | 'web-demo';
}

export function BrandHeader({ integrationMode }: BrandHeaderProps): React.JSX.Element {
  const { colors, isDark, toggleTheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [iconSwap] = useState(() => new Animated.Value(1));
  const [modePulse] = useState(() => new Animated.Value(1));
  const isCompact = width < 620;
  const isDemo = integrationMode === 'web-demo';

  useEffect(() => {
    iconSwap.stopAnimation();
    if (reducedMotion) {
      iconSwap.setValue(1);
      return;
    }
    iconSwap.setValue(0.82);
    const animation = Animated.spring(iconSwap, {
      toValue: 1,
      damping: 17,
      stiffness: 260,
      mass: 0.68,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [iconSwap, isDark, reducedMotion]);

  useEffect(() => {
    modePulse.stopAnimation();
    if (reducedMotion) {
      modePulse.setValue(1);
      return;
    }
    const animation = Animated.sequence([
      Animated.timing(modePulse, {
        toValue: 1.7,
        duration: motion.feedback,
        easing: motion.easeOut,
        useNativeDriver: motion.nativeDriver,
      }),
      Animated.spring(modePulse, {
        toValue: 1,
        damping: 17,
        stiffness: 230,
        mass: 0.7,
        useNativeDriver: motion.nativeDriver,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [integrationMode, modePulse, reducedMotion]);

  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.brandRow}>
        <MotionSurface
          accentColor={colors.accent}
          borderRadius={14}
          intensity="quiet"
          style={styles.logoSurface}
        >
          <View
            accessibilityLabel="Referral Attribution Lab signal mark"
            accessibilityRole="image"
            style={[styles.logoTile, { backgroundColor: colors.accentSoft }]}
          >
            <View style={styles.markRail}>
              <View style={[styles.markLine, { backgroundColor: colors.accentStrong }]} />
              {[0, 1, 2].map((node) => (
                <View
                  key={node}
                  style={[
                    styles.markNode,
                    {
                      backgroundColor: node === 2 ? colors.solar : colors.surfaceElevated,
                      borderColor: node === 2 ? colors.solar : colors.accentStrong,
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={[styles.markMonogram, { color: colors.accentStrong }]}>RA</Text>
          </View>
        </MotionSurface>
        {!isCompact ? (
          <>
            <View style={[styles.divider, { backgroundColor: colors.borderStrong }]} />
            <View>
              <Text style={[styles.productName, { color: colors.ink }]}>Referral Attribution Lab</Text>
              <Text style={[styles.productMeta, { color: colors.inkSubtle }]}>Signal integrity across the referral journey</Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.actions}>
        <View
          accessibilityLabel={isDemo ? 'Web demo simulation' : 'Native SDK mode'}
          style={[
            styles.mode,
            {
              backgroundColor: isDemo ? colors.surfaceGlass : colors.successSoft,
              borderColor: isDemo ? colors.border : colors.success,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.dot,
              {
                backgroundColor: isDemo ? colors.accent : colors.success,
                transform: [{ scale: modePulse }],
              },
            ]}
          />
          <Text style={[styles.modeText, { color: isDemo ? colors.inkMuted : colors.success }]}>
            {isDemo ? (isCompact ? 'DEMO' : `${Platform.OS.toUpperCase()} DEMO`) : 'NATIVE SDK'}
          </Text>
        </View>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${isDark ? 'light' : 'dark'} theme`}
          borderRadius={22}
          focusColor={colors.accent}
          frameStyle={styles.themeFrame}
          glowColor={colors.accent}
          hitSlop={4}
          hoverTint={colors.accent}
          onPress={toggleTheme}
          preset="icon"
          contentStyle={({ pressed }) => [
            styles.themeButton,
            {
              backgroundColor: colors.surfaceGlass,
              borderColor: colors.border,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          {({ engagement }) => (
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: reducedMotion
                      ? '0deg'
                      : engagement.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', isDark ? '10deg' : '-10deg'],
                        }),
                  },
                  {
                    scale: reducedMotion
                      ? 1
                      : Animated.multiply(
                          iconSwap,
                          engagement.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.08],
                          }),
                        ),
                  },
                ],
              }}
            >
              <Feather name={isDark ? 'sun' : 'moon'} size={17} color={colors.ink} />
            </Animated.View>
          )}
        </MotionPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 82,
    width: '100%',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 13 },
  logoTile: {
    width: 74,
    height: 49,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoSurface: { width: 74 },
  markRail: { position: 'absolute', left: 11, right: 11, top: 12, height: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markLine: { position: 'absolute', left: 3, right: 3, height: 2, borderRadius: 1 },
  markNode: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  markMonogram: { position: 'absolute', left: 12, bottom: 6, fontFamily: typography.mono, fontSize: 13, lineHeight: 15, fontWeight: '800', letterSpacing: 1.4 },
  divider: { width: StyleSheet.hairlineWidth, height: 32 },
  productName: {
    fontFamily: typography.family,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  productMeta: {
    marginTop: 2,
    fontFamily: typography.family,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mode: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  modeText: {
    fontFamily: typography.family,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  themeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },
  themeFrame: { width: 44, height: 44, borderRadius: 22 },
});
