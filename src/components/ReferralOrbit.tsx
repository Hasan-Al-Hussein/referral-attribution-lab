import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '../motion/MotionProvider';
import { motion, typography, useAppTheme } from '../theme/theme';

import {
  getReferralOrbitState,
  REFERRAL_ORBIT_MILESTONES,
} from './referralOrbitState';

import type { RequiredReferralEventName } from '../domain/analytics';

interface ReferralOrbitProps {
  activeMilestones: ReadonlySet<RequiredReferralEventName>;
  size?: number;
  status?: 'default' | 'attention' | 'rejected';
  success?: boolean;
}

const STAGE_ICONS: readonly (keyof typeof Feather.glyphMap)[] = [
  'link',
  'send',
  'mouse-pointer',
  'user-plus',
  'shield',
];
const JOURNEY_STAGES = REFERRAL_ORBIT_MILESTONES.map((stage, index) => ({
  ...stage,
  icon: STAGE_ICONS[index]!,
}));
const STEP_COUNT = JOURNEY_STAGES.length;
const MIN_STAGE_RAIL_WIDTH = 200;

export function ReferralOrbit({
  activeMilestones,
  size = 240,
  status = 'default',
  success = false,
}: ReferralOrbitProps): React.JSX.Element {
  const { colors, isDark } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const {
    acceptedStages,
    carrierTarget,
    completedCount,
    currentLabel,
    latestActiveIndex,
    milestoneKey,
  } = getReferralOrbitState(activeMilestones);
  const [progress] = useState(
    () => new Animated.Value(reducedMotion ? carrierTarget : 0),
  );
  const [nodeProgress] = useState(() =>
    JOURNEY_STAGES.map(
      (_, index) => new Animated.Value(reducedMotion && acceptedStages[index] ? 1 : 0),
    ),
  );
  const [entry] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [hover] = useState(() => new Animated.Value(0));
  const [celebration] = useState(() => new Animated.Value(success && reducedMotion ? 1 : 0));
  const nodeSize = Math.max(28, size * 0.112);
  const carrierSize = nodeSize + 8;
  const orbitRadius = size * 0.38;
  const center = size / 2;
  const compact = size < 200;

  const nodes = useMemo(
    () =>
      Array.from({ length: STEP_COUNT }, (_, index) => {
        const angle = -90 + index * (360 / STEP_COUNT);
        const radians = (angle * Math.PI) / 180;
        const x = center + Math.cos(radians) * orbitRadius;
        const y = center + Math.sin(radians) * orbitRadius;
        return {
          angle,
          x,
          y,
          left: x - nodeSize / 2,
          top: y - nodeSize / 2,
        };
      }),
    [center, nodeSize, orbitRadius],
  );

  const segments = useMemo(
    () =>
      nodes.map((node) => {
        const previous = { x: center, y: center };
        const deltaX = node.x - previous.x;
        const deltaY = node.y - previous.y;
        const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
        return {
          angle: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
          left: (previous.x + node.x) / 2 - length / 2,
          length,
          top: (previous.y + node.y) / 2 - 1.5,
        };
      }),
    [center, nodes],
  );

  useEffect(() => {
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(carrierTarget);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: carrierTarget,
      duration: motion.journey,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [carrierTarget, progress, reducedMotion]);

  useEffect(() => {
    const animations = nodeProgress.map((value, index) => {
      const accepted = milestoneKey[index] === '1';
      value.stopAnimation();
      if (reducedMotion) {
        value.setValue(accepted ? 1 : 0);
        return null;
      }
      return Animated.timing(value, {
        toValue: accepted ? 1 : 0,
        duration: motion.feedback,
        delay: accepted ? index * 28 : 0,
        easing: motion.easeOut,
        useNativeDriver: motion.nativeDriver,
      });
    });
    const activeAnimations = animations.filter((animation) => animation !== null);
    const group = Animated.parallel(activeAnimations);
    group.start();
    return () => {
      group.stop();
      nodeProgress.forEach((value) => value.stopAnimation());
    };
  }, [milestoneKey, nodeProgress, reducedMotion]);

  useEffect(() => {
    entry.stopAnimation();
    if (reducedMotion) {
      entry.setValue(1);
      return;
    }
    entry.setValue(0);
    const animation = Animated.spring(entry, {
      toValue: 1,
      damping: 19,
      stiffness: 210,
      mass: 0.72,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [entry, reducedMotion, status]);

  useEffect(() => {
    celebration.stopAnimation();
    if (!success || reducedMotion) {
      celebration.setValue(success ? 1 : 0);
      return;
    }
    celebration.setValue(0);
    const animation = Animated.timing(celebration, {
      toValue: 1,
      duration: motion.celebration,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [celebration, reducedMotion, success]);

  useEffect(
    () => () => {
      hover.stopAnimation();
      celebration.stopAnimation();
    },
    [celebration, hover],
  );

  const setHovered = (engaged: boolean) => {
    hover.stopAnimation();
    if (reducedMotion) {
      hover.setValue(0);
      return;
    }
    Animated.timing(hover, {
      toValue: engaged ? 1 : 0,
      duration: engaged ? motion.hoverIn : motion.hoverOut,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    }).start();
  };

  const hasAttention = status === 'attention' || status === 'rejected';
  const stateLabel = status === 'rejected'
    ? 'Rejected'
    : status === 'attention'
      ? 'Check details'
      : success
        ? 'Verified'
        : currentLabel;
  const stateColor = hasAttention ? colors.danger : colors.accentStrong;
  const stateSoft = hasAttention ? colors.dangerSoft : colors.accentSoft;
  const coreForeground = isDark ? colors.background : colors.white;
  const coreStateLabel = status === 'attention' ? 'DETAILS' : stateLabel.toUpperCase();
  const entryScale = entry.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const hoverScale = hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] });
  const hoverHaloScale = hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const haloScale = progress.interpolate({
    inputRange: [0, STEP_COUNT],
    outputRange: [0.82, success ? 1.12 : 1],
    extrapolate: 'clamp',
  });
  const carrierInputRange = [0, 1, 2, 3, 4, 5];
  const carrierX = progress.interpolate({
    inputRange: carrierInputRange,
    outputRange: [nodes[0]!.x, ...nodes.map((node) => node.x)],
    extrapolate: 'clamp',
  });
  const carrierY = progress.interpolate({
    inputRange: carrierInputRange,
    outputRange: [nodes[0]!.y, ...nodes.map((node) => node.y)],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      accessibilityRole="image"
      accessibilityLabel={`Referral journey: ${completedCount} of ${STEP_COUNT} milestones complete. Current state: ${stateLabel}.`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={[
        styles.container,
        {
          width: size,
          opacity: entry,
          transform: [
            {
              translateY: hover.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }),
            },
            { scale: Animated.multiply(entryScale, hoverScale) },
          ],
        },
      ]}
    >
      <View style={{ width: size, height: size }}>
        {success && !reducedMotion ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.celebrationRing,
                {
                  width: size * 0.48,
                  height: size * 0.48,
                  borderRadius: size * 0.24,
                  left: size * 0.26,
                  top: size * 0.26,
                  borderColor: colors.success,
                  opacity: celebration.interpolate({
                    inputRange: [0, 0.16, 1],
                    outputRange: [0, 0.34, 0],
                  }),
                  transform: [
                    {
                      scale: celebration.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.72, 1.72],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.celebrationRing,
                {
                  width: size * 0.48,
                  height: size * 0.48,
                  borderRadius: size * 0.24,
                  left: size * 0.26,
                  top: size * 0.26,
                  borderColor: colors.accent,
                  opacity: celebration.interpolate({
                    inputRange: [0, 0.3, 1],
                    outputRange: [0, 0.24, 0],
                  }),
                  transform: [
                    {
                      scale: celebration.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.62, 1.42],
                      }),
                    },
                  ],
                },
              ]}
            />
          </>
        ) : null}
        <Animated.View
          style={[
            styles.halo,
            {
              width: size * 0.57,
              height: size * 0.57,
              borderRadius: size * 0.285,
              left: size * 0.215,
              top: size * 0.215,
              backgroundColor: hasAttention ? colors.danger : colors.signalTeal,
              opacity: hasAttention ? 0.16 : 0.2,
              transform: [{ scale: Animated.multiply(haloScale, hoverHaloScale) }],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.orbit,
            {
              left: size * 0.08,
              top: size * 0.08,
              width: size * 0.84,
              height: size * 0.84,
              borderRadius: size * 0.42,
              borderColor: colors.borderStrong,
              transform: [
                {
                  rotate: hover.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '5deg'] }),
                },
              ],
            },
          ]}
        />

        {segments.map((segment, index) => {
          const segmentProgress = nodeProgress[index]!;
          return (
            <View
              key={`segment-${index}`}
              style={[
                styles.segmentBase,
                {
                  left: segment.left,
                  top: segment.top,
                  width: segment.length,
                  backgroundColor: colors.border,
                  transform: [{ rotate: `${segment.angle}deg` }],
                },
              ]}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  styles.segmentFill,
                  {
                    backgroundColor: colors.accent,
                    opacity: segmentProgress,
                    transform: [{ scaleX: segmentProgress }],
                  },
                ]}
              />
            </View>
          );
        })}

        <Animated.View
          style={[
            styles.coreFrame,
            {
              width: size * 0.4,
              height: size * 0.4,
              borderRadius: size * 0.2,
              left: size * 0.3,
              top: size * 0.3,
              backgroundColor: stateSoft,
              borderColor: stateColor,
              transform: [
                {
                  scale: hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] }),
                },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.core,
              {
                width: size * 0.34,
                height: size * 0.34,
                borderRadius: size * 0.17,
                backgroundColor: stateColor,
              },
            ]}
          >
            <Feather
              name={status === 'rejected' ? 'shield-off' : status === 'attention' ? 'alert-circle' : success ? 'check' : 'send'}
              size={compact ? 15 : 18}
              color={coreForeground}
            />
            <Text style={[styles.coreCount, compact && styles.coreCountCompact, { color: coreForeground }]}>
              {completedCount}/5
            </Text>
            <Text numberOfLines={1} style={[styles.coreLabel, compact && styles.coreLabelCompact, { color: coreForeground }]}>
              {coreStateLabel}
            </Text>
          </View>
        </Animated.View>

        {nodes.map((node, index) => {
          const stage = JOURNEY_STAGES[index]!;
          const stageProgress = nodeProgress[index]!;
          return (
            <Animated.View
              key={stage.label}
              style={[
                styles.node,
                {
                  width: nodeSize,
                  height: nodeSize,
                  borderRadius: nodeSize / 2,
                  left: node.left,
                  top: node.top,
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.borderStrong,
                  transform: [
                    {
                      scale: Animated.multiply(
                        hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }),
                        stageProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
                      ),
                    },
                  ],
                },
              ]}
            >
              <Feather name={stage.icon} color={colors.inkSubtle} size={nodeSize * 0.43} />
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  styles.nodeComplete,
                  {
                    borderRadius: nodeSize / 2,
                    backgroundColor: colors.accent,
                    opacity: stageProgress,
                    transform: [
                      {
                        scale: stageProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.72, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <Feather name={stage.icon} color={colors.white} size={nodeSize * 0.43} />
              </Animated.View>
            </Animated.View>
          );
        })}

        <Animated.View
          style={[
            styles.carrier,
            {
              width: carrierSize,
              height: carrierSize,
              borderRadius: carrierSize / 2,
              left: center - carrierSize / 2,
              top: center - carrierSize / 2,
              borderColor: colors.accentStrong,
              opacity: progress.interpolate({
                inputRange: [0, 0.18, STEP_COUNT],
                outputRange: [0, 1, 1],
                extrapolate: 'clamp',
              }),
              transform: [
                { translateX: Animated.subtract(carrierX, center) },
                { translateY: Animated.subtract(carrierY, center) },
                {
                  scale: hover.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
                },
              ],
            },
          ]}
        />
      </View>

      <View
        accessibilityLabel="Milestones: Create, Share, Click, Start, Verify"
        style={[styles.stageRail, { width: Math.max(size, MIN_STAGE_RAIL_WIDTH) }]}
      >
        {JOURNEY_STAGES.map((stage, index) => {
          const complete = acceptedStages[index] ?? false;
          const current = latestActiveIndex === index;
          return (
            <View key={stage.label} style={styles.stageCell}>
              <View
                style={[
                  styles.stageTick,
                  {
                    backgroundColor: complete ? colors.accent : colors.border,
                    opacity: complete ? 1 : 0.75,
                  },
                ]}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.stageLabel,
                  compact && styles.stageLabelCompact,
                  {
                    color: complete ? colors.accentStrong : colors.inkSubtle,
                    fontWeight: current ? '800' : '700',
                  },
                ]}
              >
                {stage.label.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  celebrationRing: { position: 'absolute', borderWidth: 2 },
  halo: { position: 'absolute' },
  orbit: { position: 'absolute', borderWidth: 1 },
  segmentBase: { position: 'absolute', height: 3, borderRadius: 2, overflow: 'hidden' },
  segmentFill: { borderRadius: 2 },
  coreFrame: {
    position: 'absolute',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0B8178',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  core: { alignItems: 'center', justifyContent: 'center', gap: 1, overflow: 'hidden' },
  coreCount: {
    fontFamily: typography.mono,
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  coreCountCompact: { fontSize: 17, lineHeight: 20 },
  coreLabel: {
    maxWidth: '88%',
    fontFamily: typography.family,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  coreLabelCompact: { fontSize: 10, lineHeight: 12, letterSpacing: 0.25 },
  node: {
    position: 'absolute',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#123E42',
    shadowOpacity: 0.13,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  nodeComplete: { alignItems: 'center', justifyContent: 'center' },
  carrier: {
    position: 'absolute',
    borderWidth: 2,
    shadowColor: '#0B8178',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  stageRail: { flexDirection: 'row', gap: 2, marginTop: 6 },
  stageCell: { flex: 1, minWidth: 0, alignItems: 'center', gap: 5 },
  stageTick: { width: '100%', height: 3, borderRadius: 2 },
  stageLabel: {
    fontFamily: typography.family,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.1,
  },
  stageLabelCompact: { fontSize: 10, lineHeight: 13, letterSpacing: 0 },
});
