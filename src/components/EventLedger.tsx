import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';

import {
  getAcceptedReferralMilestones,
  scopeReferralEntries,
} from '../application/referralProgress';
import { useReferralRuntime } from '../application/ReferralRuntime';
import {
  FAILURE_REFERRAL_EVENTS,
  REQUIRED_REFERRAL_EVENTS,
  type ReferralEventName,
} from '../domain/analytics';
import { AnimatedReveal } from '../motion/AnimatedReveal';
import { useReducedMotion } from '../motion/MotionProvider';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

const shortLabels: Record<ReferralEventName, string> = {
  referral_link_generated: 'Link generated',
  referral_link_shared: 'Link shared',
  referral_link_clicked: 'Link clicked',
  referral_signup_started: 'Signup started',
  referral_signup_completed: 'Signup completed',
  referral_link_generation_failed: 'Generation failed',
  referral_link_share_cancelled: 'Share cancelled',
  referral_link_share_failed: 'Share failed',
  referral_deeplink_resolution_failed: 'Link rejected',
  referral_code_rejected: 'Code rejected',
  referral_signup_failed: 'Signup failed',
  referral_state_cleanup_failed: 'Accepted state cleanup pending',
  referral_duplicate_suppressed: 'Duplicate suppressed',
};

const warningEvents = new Set<ReferralEventName>([
  'referral_link_share_cancelled',
  'referral_duplicate_suppressed',
]);
const failureEvents = new Set<ReferralEventName>(
  FAILURE_REFERRAL_EVENTS.filter((name) => !warningEvents.has(name)),
);

interface EventLedgerProps {
  referralCode?: string | null;
  referralFingerprint?: string | null;
}

export function EventLedger({ referralCode, referralFingerprint }: EventLedgerProps): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const isWebTrace = Platform.OS === 'web';
  const { events } = useReferralRuntime();
  const scopedEvents = scopeReferralEntries(events, referralCode, referralFingerprint);
  const scopedCode = referralCode ?? scopedEvents[0]?.event.properties.referral_code;
  const completedNames = scopedCode
    ? getAcceptedReferralMilestones(scopedEvents, scopedCode, referralFingerprint)
    : new Set();
  const completedCount = REQUIRED_REFERRAL_EVENTS.filter((name) => completedNames.has(name)).length;
  const [counterScale] = useState(() => new Animated.Value(1));
  const previousCount = useRef(completedCount);

  useEffect(() => {
    counterScale.stopAnimation();
    if (reducedMotion || previousCount.current === completedCount) {
      counterScale.setValue(1);
      previousCount.current = completedCount;
      return;
    }
    previousCount.current = completedCount;
    const animation = Animated.sequence([
      Animated.timing(counterScale, {
        toValue: 1.08,
        duration: 90,
        easing: motion.easeOut,
        useNativeDriver: motion.nativeDriver,
      }),
      Animated.spring(counterScale, {
        toValue: 1,
        damping: 18,
        stiffness: 260,
        mass: 0.7,
        useNativeDriver: motion.nativeDriver,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [completedCount, counterScale, reducedMotion]);

  return (
    <MotionSurface
      accentColor={colors.accent}
      borderRadius={radii.lg}
      intensity="standard"
      testID="event-ledger-surface"
    >
      <View style={[styles.card, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.eyebrow, { color: colors.success }]}>
              {isWebTrace ? 'LOCAL EVENT TRACE' : 'LIVE TELEMETRY'}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.ink }]}>Referral journey</Text>
        </View>
        <Animated.View style={[styles.counter, { backgroundColor: colors.accentSoft, transform: [{ scale: counterScale }] }]}>
          <Text style={[styles.counterText, { color: colors.accentStrong }]}>{completedCount}/5</Text>
        </Animated.View>
      </View>
      <Text style={[styles.description, { color: colors.inkMuted }]}>
        {isWebTrace
          ? 'Demo evidence from the in-browser adapter, scoped to this exact referral journey.'
          : 'Invitee milestones are scoped to this exact referral journey.'}
      </Text>

      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 5, now: completedCount }}
        accessibilityLabel={`${completedCount} of 5 referral milestones complete`}
        style={styles.progressTrack}
      >
        {REQUIRED_REFERRAL_EVENTS.map((name, index) => (
          <LedgerProgressSegment
            key={name}
            complete={completedNames.has(name)}
            index={index}
          />
        ))}
      </View>

      <View style={styles.funnel}>
        {REQUIRED_REFERRAL_EVENTS.map((name, index) => (
          <LedgerMilestone
            key={name}
            complete={completedNames.has(name)}
            index={index}
            label={shortLabels[name]}
            last={index === REQUIRED_REFERRAL_EVENTS.length - 1}
          />
        ))}
      </View>

      {scopedEvents.length ? (
        <View style={[styles.log, { borderTopColor: colors.border }]}>
          <View style={styles.logHeading}>
            <Text style={[styles.logHeadingText, { color: colors.ink }]}>
              {isWebTrace ? 'Latest local-adapter delivery' : 'Latest delivery'}
            </Text>
            <Text style={[styles.logCount, { color: colors.inkSubtle }]}>{scopedEvents.length} events</Text>
          </View>
          {scopedEvents.slice(0, 5).map(({ event, delivery, sequence }) => {
            const isWarning = delivery === 'duplicate' || warningEvents.has(event.name);
            const isFailure = delivery === 'failed' || failureEvents.has(event.name);
            const eventColor =
              isFailure ? colors.danger : isWarning ? colors.warning : colors.success;
            const eventIcon =
              delivery === 'duplicate'
                ? 'copy'
                : isFailure
                  ? 'alert-circle'
                  : isWarning
                    ? 'alert-triangle'
                    : 'check';
            return (
              <AnimatedReveal
                key={`${sequence}-${event.properties.event_id}`}
                distance={7}
                duration={motion.feedback}
              >
                <View style={styles.logRow}>
                  <View style={[styles.eventGlyph, { backgroundColor: `${eventColor}18` }]}>
                    <Feather
                      name={eventIcon}
                      color={eventColor}
                      size={13}
                    />
                  </View>
                  <View style={styles.logCopy}>
                    <Text numberOfLines={1} style={[styles.logName, { color: colors.ink }]}>{event.name}</Text>
                    <Text numberOfLines={2} style={[styles.logMeta, { color: colors.inkSubtle }]}>
                      {event.properties.referral_code} · {event.properties.platform} ·{' '}
                      {isWebTrace && delivery === 'accepted'
                        ? 'delivered to local adapter'
                        : delivery}
                    </Text>
                  </View>
                </View>
              </AnimatedReveal>
            );
          })}
        </View>
      ) : (
        <View style={[styles.empty, { backgroundColor: colors.surfaceMuted }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceElevated }]}>
            <Feather name="activity" color={colors.accentStrong} size={17} />
          </View>
          <View style={styles.emptyCopy}>
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>Waiting for the first milestone</Text>
            <Text style={[styles.emptyText, { color: colors.inkMuted }]}>
              {isWebTrace
                ? 'Generate a link to start the local trace.'
                : 'Generate a link to start the trace.'}
            </Text>
          </View>
        </View>
      )}
      </View>
    </MotionSurface>
  );
}

function LedgerProgressSegment({
  complete,
  index,
}: {
  complete: boolean;
  index: number;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reducedMotion && complete ? 1 : 0));

  useEffect(() => {
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(complete ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: complete ? 1 : 0,
      delay: complete ? index * 28 : 0,
      duration: motion.feedback,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [complete, index, progress, reducedMotion]);

  return (
    <View style={[styles.progressSegment, { backgroundColor: colors.surfaceMuted }]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.progressSegmentFill,
          {
            backgroundColor: colors.accent,
            opacity: progress,
            transform: [{ scaleX: progress }],
          },
        ]}
      />
    </View>
  );
}

function LedgerMilestone({
  complete,
  index,
  label,
  last,
}: {
  complete: boolean;
  index: number;
  label: string;
  last: boolean;
}): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    scale.stopAnimation();
    if (!complete || reducedMotion) {
      scale.setValue(1);
      return;
    }
    scale.setValue(1);
    const animation = Animated.sequence([
      Animated.spring(scale, {
        toValue: 1.16,
        damping: 14,
        stiffness: 260,
        mass: 0.65,
        useNativeDriver: motion.nativeDriver,
      }),
      Animated.spring(scale, {
        toValue: 1,
        damping: 18,
        stiffness: 240,
        mass: 0.7,
        useNativeDriver: motion.nativeDriver,
      }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      scale.setValue(1);
    };
  }, [complete, reducedMotion, scale]);

  return (
    <View style={styles.funnelItem}>
      <View style={styles.railColumn}>
        <Animated.View
          style={[
            styles.check,
            {
              backgroundColor: complete ? colors.accent : colors.surfaceElevated,
              borderColor: complete ? colors.accent : colors.borderStrong,
              transform: [{ scale }],
            },
          ]}
        >
          <Feather name={complete ? 'check' : 'circle'} color={complete ? colors.white : colors.inkSubtle} size={13} />
        </Animated.View>
        {!last ? <View style={[styles.rail, { backgroundColor: complete ? colors.accentSoft : colors.border }]} /> : null}
      </View>
      <View style={styles.funnelCopy}>
        <Text style={[styles.funnelLabel, { color: complete ? colors.ink : colors.inkMuted }]}>{label}</Text>
        <Text style={[styles.funnelIndex, { color: colors.inkSubtle }]}>0{index + 1}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 22,
    gap: 18,
    shadowColor: '#123E42',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 },
  headingCopy: { flex: 1 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  eyebrow: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.05 },
  title: { marginTop: 4, fontFamily: typography.family, fontSize: 21, lineHeight: 27, fontWeight: '700', letterSpacing: -0.35 },
  counter: { minWidth: 46, height: 34, borderRadius: 17, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  counterText: { fontFamily: typography.mono, fontSize: 12, fontWeight: '800' },
  description: { fontFamily: typography.family, fontSize: 13, lineHeight: 20 },
  progressTrack: { width: '100%', height: 5, flexDirection: 'row', gap: 4 },
  progressSegment: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  progressSegmentFill: { borderRadius: 3 },
  funnel: { gap: 0 },
  funnelItem: { minHeight: 45, flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  railColumn: { width: 30, alignItems: 'center' },
  check: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rail: { flex: 1, width: 2, minHeight: 15, marginVertical: 2 },
  funnelCopy: { flex: 1, minHeight: 30, paddingTop: 5, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  funnelLabel: { flex: 1, fontFamily: typography.family, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  funnelIndex: { fontFamily: typography.mono, fontSize: 11, lineHeight: 19, fontVariant: ['tabular-nums'] },
  log: { borderTopWidth: 1, paddingTop: 16, gap: 12 },
  logHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  logHeadingText: { fontFamily: typography.family, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  logCount: { fontFamily: typography.family, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  logRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  eventGlyph: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logCopy: { flex: 1 },
  logName: { fontFamily: typography.mono, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  logMeta: { marginTop: 2, fontFamily: typography.family, fontSize: 11, lineHeight: 16 },
  empty: { padding: 15, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: 11 },
  emptyIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  emptyCopy: { flex: 1 },
  emptyTitle: { fontFamily: typography.family, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  emptyText: { marginTop: 2, fontFamily: typography.family, fontSize: 12, lineHeight: 18 },
});
