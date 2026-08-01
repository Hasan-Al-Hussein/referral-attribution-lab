import { type PropsWithChildren, useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { motion } from '../theme/theme';

import { useReducedMotion } from './MotionProvider';

interface MotionSurfaceProps extends PropsWithChildren {
  accentColor: string;
  borderRadius: number;
  intensity?: 'quiet' | 'standard' | 'hero';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const intensityValues = {
  quiet: { lift: 0, scale: 1, glow: 0.035, sweep: 0.025 },
  standard: { lift: -1.5, scale: 1.0015, glow: 0.06, sweep: 0.045 },
  hero: { lift: -4, scale: 1.004, glow: 0.095, sweep: 0.065 },
} as const;

/**
 * Adds pointer-responsive depth to informational surfaces without making them
 * pretend to be buttons. It never changes the cursor or enters the tab order.
 */
export function MotionSurface({
  accentColor,
  borderRadius,
  children,
  intensity = 'standard',
  style,
  testID,
}: MotionSurfaceProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [engagement] = useState(() => new Animated.Value(0));
  const values = intensityValues[intensity];

  useEffect(
    () => () => {
      engagement.stopAnimation();
    },
    [engagement],
  );

  const setEngaged = (engaged: boolean) => {
    engagement.stopAnimation();
    if (reducedMotion) {
      engagement.setValue(0);
      return;
    }
    Animated.timing(engagement, {
      toValue: engaged ? 1 : 0,
      duration: engaged ? motion.hoverIn : motion.hoverOut,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  const pointerProps: Pick<ViewProps, 'onPointerEnter' | 'onPointerLeave'> = {
    onPointerEnter: () => setEngaged(true),
    onPointerLeave: () => setEngaged(false),
  };

  return (
    <Animated.View
      {...pointerProps}
      testID={testID}
      style={[
        styles.host,
        { borderRadius },
        style,
        {
          transform: [
            {
              translateY: reducedMotion
                ? 0
                : engagement.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, values.lift],
                  }),
            },
            {
              scale: reducedMotion
                ? 1
                : engagement.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, values.scale],
                  }),
            },
          ],
        },
      ]}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.overlayClip,
          { borderRadius },
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.rim,
            {
              borderColor: accentColor,
              borderRadius,
              opacity: engagement.interpolate({
                inputRange: [0, 1],
                outputRange: [0, values.glow],
              }),
            },
          ]}
        />
        <Animated.View
          style={[
            styles.sweep,
            {
              backgroundColor: accentColor,
              opacity: engagement.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, values.sweep, 0],
              }),
              transform: [
                { rotate: '16deg' },
                {
                  translateX: engagement.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-180, 760],
                  }),
                },
              ],
            },
          ]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'relative', width: '100%' },
  overlayClip: { overflow: 'hidden' },
  rim: { borderWidth: 2 },
  sweep: {
    position: 'absolute',
    top: -120,
    bottom: -120,
    left: -90,
    width: 54,
  },
});
