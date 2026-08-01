import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
  type AccessibilityState,
  type ViewStyle,
} from 'react-native';

import { MotionPressable } from '../motion/MotionPressable';
import { useReducedMotion } from '../motion/MotionProvider';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

interface ButtonProps {
  label: string;
  onPress(): void;
  icon?: keyof typeof Feather.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  accessibilityState,
  style,
}: ButtonProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [pressPulse] = useState(() => new Animated.Value(0));
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const inactive = disabled || loading;
  const backgroundColor = isDanger
    ? colors.dangerSoft
    : variant === 'secondary'
      ? colors.surfaceGlass
      : variant === 'ghost'
        ? 'transparent'
        : colors.ctaStart;
  const foregroundColor = isPrimary
    ? colors.white
    : isDanger
      ? colors.danger
      : variant === 'secondary'
        ? colors.ink
        : colors.inkMuted;

  useEffect(
    () => () => {
      pressPulse.stopAnimation();
    },
    [pressPulse],
  );

  const triggerPressResponse = () => {
    pressPulse.stopAnimation();
    pressPulse.setValue(0);
    if (reducedMotion) return;
    Animated.timing(pressPulse, {
      toValue: 1,
      duration: motion.feedback,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled: inactive, busy: loading }}
      aria-expanded={accessibilityState?.expanded}
      android_ripple={{
        color: isPrimary
          ? 'rgba(255,255,255,0.18)'
          : `${isDanger ? colors.danger : colors.accent}18`,
      }}
      borderRadius={radii.pill}
      disabled={inactive}
      focusColor={colors.accent}
      frameStyle={[styles.motionFrame, fullWidth && styles.fullWidth, style]}
      hoverTint={isDanger ? colors.danger : isPrimary ? undefined : colors.accent}
      onPress={onPress}
      onPressIn={triggerPressResponse}
      preset="button"
      transformOnEngagement={variant === 'primary' || variant === 'secondary'}
      contentStyle={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderColor:
            variant === 'secondary'
              ? colors.borderStrong
              : isDanger
                ? colors.danger
                : backgroundColor,
          opacity: pressed && reducedMotion ? 0.8 : 1,
        },
        fullWidth && styles.fullWidth,
        inactive && styles.disabled,
      ]}
    >
      {({ engagement }) => (
        <>
        {isPrimary ? (
          <LinearGradient
            colors={[colors.ctaStart, colors.ctaEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {isPrimary ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shine,
              {
                opacity: engagement.interpolate({
                  inputRange: [0, 0.52, 1],
                  outputRange: [0, 0.28, 0],
                }),
                transform: [
                  { rotate: '18deg' },
                  {
                    translateX: engagement.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-90, 280],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        {isPrimary ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shine,
              {
                opacity: pressPulse.interpolate({
                  inputRange: [0, 0.45, 1],
                  outputRange: [0, 0.34, 0],
                }),
                transform: [
                  { rotate: '18deg' },
                  {
                    translateX: pressPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-90, 280],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        <View style={[styles.content, loading && styles.loadingContent]}>
          {icon ? (
            <Animated.View
              style={{
                transform: [
                  {
                    translateX: reducedMotion
                      ? 0
                      : pressPulse.interpolate({
                          inputRange: [0, 0.55, 1],
                          outputRange: [0, 2, 0],
                        }),
                  },
                ],
              }}
            >
              <Feather name={icon} color={foregroundColor} size={18} />
            </Animated.View>
          ) : null}
          <Text style={[styles.label, { color: foregroundColor }]}>{label}</Text>
        </View>
        {loading ? <ActivityIndicator color={foregroundColor} size="small" style={styles.loader} /> : null}
        </>
      )}
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  motionFrame: {
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  base: {
    minHeight: 50,
    paddingHorizontal: 21,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },
  fullWidth: { width: '100%' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  loadingContent: { opacity: 0 },
  loader: { position: 'absolute' },
  shine: {
    position: 'absolute',
    left: -24,
    top: -36,
    width: 44,
    height: 122,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  label: {
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.05,
  },
  disabled: { opacity: 0.46, cursor: Platform.OS === 'web' ? 'auto' : undefined },
});
