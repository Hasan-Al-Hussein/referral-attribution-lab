import { type PropsWithChildren, useEffect, useRef, useState } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '../theme/theme';

import { useReducedMotion } from './MotionProvider';

interface AnimatedRevealProps extends PropsWithChildren {
  delay?: number;
  distance?: number;
  duration?: number;
  replayKey?: string | number | boolean;
  style?: StyleProp<ViewStyle>;
  variant?: 'rise' | 'scale' | 'fade' | 'forward' | 'backward';
}

export function AnimatedReveal({
  children,
  delay = 0,
  distance = 12,
  duration = motion.reveal,
  replayKey,
  style,
  variant = 'rise',
}: AnimatedRevealProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  const wasReduced = useRef(reducedMotion);

  useEffect(() => {
    const reducedBeforeThisRender = wasReduced.current;
    wasReduced.current = reducedMotion;
    progress.stopAnimation();
    if (reducedMotion || reducedBeforeThisRender) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress, reducedMotion, replayKey]);

  const transform =
    variant === 'scale'
      ? [
          {
            scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
          },
        ]
      : variant === 'rise'
        ? [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ]
        : variant === 'forward' || variant === 'backward'
          ? [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [variant === 'forward' ? distance : -distance, 0],
                }),
              },
            ]
        : undefined;

  return (
    <Animated.View style={[style, { opacity: progress }, transform ? { transform } : null]}>
      {children}
    </Animated.View>
  );
}
