import { type PropsWithChildren, useEffect, useState } from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { motion } from '../theme/theme';

import { useReducedMotion } from './MotionProvider';

interface MotionFieldFrameProps extends PropsWithChildren {
  backgroundColor: string;
  borderColor: string;
  error?: boolean;
  focusColor: string;
  focused: boolean;
  style?: StyleProp<ViewStyle>;
}

export function MotionFieldFrame({
  backgroundColor,
  borderColor,
  children,
  error = false,
  focusColor,
  focused,
  style,
}: MotionFieldFrameProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [engagement] = useState(() => new Animated.Value(focused || error ? 1 : 0));
  const ringColor = error ? borderColor : focusColor;

  useEffect(() => {
    engagement.stopAnimation();
    if (reducedMotion) {
      engagement.setValue(focused || error ? 1 : 0);
      return;
    }
    const animation = Animated.timing(engagement, {
      toValue: focused || error ? 1 : 0,
      duration: focused || error ? motion.hoverIn : motion.hoverOut,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [engagement, error, focused, reducedMotion]);

  return (
    <Animated.View
      style={[
        styles.frame,
        style,
        {
          backgroundColor,
          borderColor,
          shadowColor: ringColor,
          shadowOpacity: engagement.interpolate({
            inputRange: [0, 1],
            outputRange: [0, error ? 0.12 : 0.16],
          }),
          transform: [
            {
              scale: reducedMotion
                ? 1
                : engagement.interpolate({ inputRange: [0, 1], outputRange: [1, 1.006] }),
            },
          ],
        },
      ]}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            borderColor: ringColor,
            opacity: engagement,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    borderWidth: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  ring: {
    position: 'absolute',
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderWidth: 2,
    borderRadius: 19,
  },
});
