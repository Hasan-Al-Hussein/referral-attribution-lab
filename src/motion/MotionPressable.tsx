import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { motion } from '../theme/theme';

import { useReducedMotion } from './MotionProvider';

type MotionPreset = 'button' | 'icon' | 'row';

interface MotionRenderState extends PressableStateCallbackType {
  engagement: Animated.Value;
}

interface MotionPressableProps extends Omit<PressableProps, 'children' | 'style'> {
  borderRadius: number;
  children: ReactNode | ((state: MotionRenderState) => ReactNode);
  contentStyle?:
    | StyleProp<ViewStyle>
    | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  focusColor: string;
  frameStyle?: StyleProp<ViewStyle>;
  glowColor?: string | undefined;
  hoverTint?: string | undefined;
  preset?: MotionPreset;
  transformOnEngagement?: boolean;
}

const presetValues: Record<
  MotionPreset,
  { hoverX: number; hoverY: number; pressScale: number; rotation: number }
> = {
  button: { hoverX: 0, hoverY: -2.5, pressScale: 0.97, rotation: 0 },
  icon: { hoverX: 0, hoverY: -2, pressScale: 0.92, rotation: 5 },
  row: { hoverX: 4, hoverY: 0, pressScale: 0.99, rotation: 0 },
};

export function MotionPressable({
  borderRadius,
  children,
  contentStyle,
  disabled = false,
  focusColor,
  frameStyle,
  glowColor,
  hoverTint,
  onBlur,
  onFocus,
  onHoverIn,
  onHoverOut,
  onPressIn,
  onPressOut,
  preset = 'button',
  transformOnEngagement = true,
  ...pressableProps
}: MotionPressableProps): React.JSX.Element {
  const reducedMotion = useReducedMotion();
  const [engagement] = useState(() => new Animated.Value(0));
  const [pressScale] = useState(() => new Animated.Value(1));
  const [focused, setFocused] = useState(false);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const values = presetValues[preset];

  const updateEngagement = (engaged: boolean) => {
    engagement.stopAnimation();
    if (reducedMotion) {
      engagement.setValue(engaged ? 1 : 0);
      return;
    }
    Animated.timing(engagement, {
      toValue: engaged ? 1 : 0,
      duration: engaged ? motion.hoverIn : motion.hoverOut,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  const updatePress = (pressed: boolean) => {
    pressScale.stopAnimation();
    if (reducedMotion) {
      pressScale.setValue(1);
      return;
    }
    if (pressed) {
      Animated.timing(pressScale, {
        toValue: values.pressScale,
        duration: motion.press,
        easing: motion.easeOut,
        useNativeDriver: motion.nativeDriver,
      }).start();
      return;
    }
    Animated.spring(pressScale, {
      toValue: 1,
      damping: 18,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  useEffect(() => {
    if (disabled) {
      hoveredRef.current = false;
      focusedRef.current = false;
    }
    engagement.stopAnimation();
    pressScale.stopAnimation();
    engagement.setValue(
      !disabled && (hoveredRef.current || focusedRef.current) ? 1 : 0,
    );
    pressScale.setValue(1);

    return () => {
      engagement.stopAnimation();
      pressScale.stopAnimation();
    };
  }, [disabled, engagement, pressScale, reducedMotion]);

  const translateX = reducedMotion || !transformOnEngagement
    ? 0
    : engagement.interpolate({ inputRange: [0, 1], outputRange: [0, values.hoverX] });
  const translateY = reducedMotion || !transformOnEngagement
    ? 0
    : engagement.interpolate({ inputRange: [0, 1], outputRange: [0, values.hoverY] });
  const rotate = reducedMotion || !transformOnEngagement
    ? '0deg'
    : engagement.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', `${values.rotation}deg`],
      });

  return (
    <Animated.View
      style={[
        styles.frame,
        { borderRadius },
        frameStyle,
        { transform: [{ translateX }, { translateY }, { scale: pressScale }, { rotate }] },
      ]}
    >
      {glowColor ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              backgroundColor: glowColor,
              borderRadius,
              opacity: engagement.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }),
              shadowColor: glowColor,
              transform: [
                {
                  scale: engagement.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.025] }),
                },
              ],
            },
          ]}
        />
      ) : null}
      <Pressable
        {...pressableProps}
        disabled={disabled}
        onBlur={(event) => {
          focusedRef.current = false;
          setFocused(false);
          updateEngagement(hoveredRef.current);
          onBlur?.(event);
        }}
        onFocus={(event) => {
          focusedRef.current = true;
          setFocused(true);
          updateEngagement(true);
          onFocus?.(event);
        }}
        onHoverIn={(event) => {
          hoveredRef.current = true;
          updateEngagement(true);
          onHoverIn?.(event);
        }}
        onHoverOut={(event) => {
          hoveredRef.current = false;
          updateEngagement(focusedRef.current);
          onHoverOut?.(event);
        }}
        onPressIn={(event) => {
          updatePress(true);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          updatePress(false);
          onPressOut?.(event);
        }}
        style={(state) => [
          typeof contentStyle === 'function' ? contentStyle(state) : contentStyle,
        ]}
      >
        {(state) => (
          <>
            {typeof children === 'function' ? children({ ...state, engagement }) : children}
            {hoverTint ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: hoverTint,
                    opacity: engagement.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 0.1],
                    }),
                  },
                ]}
              />
            ) : null}
          </>
        )}
      </Pressable>
      <View
        pointerEvents="none"
        style={[
          styles.focusRing,
          { borderColor: focused && !disabled ? focusColor : 'transparent', borderRadius },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative', alignSelf: 'flex-start' },
  glow: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  focusRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 2,
  },
});
