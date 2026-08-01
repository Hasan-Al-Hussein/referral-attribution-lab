import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { commitDemoReset } from '../application/commitDemoReset';
import { getAcceptedReferralMilestones } from '../application/referralProgress';
import { useReferralRuntime } from '../application/ReferralRuntime';
import { runReferralShare } from '../application/runReferralShare';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { PageIntro } from '../components/PageIntro';
import { ReferralOrbit } from '../components/ReferralOrbit';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { AnimatedReveal } from '../motion/AnimatedReveal';
import { MotionPressable } from '../motion/MotionPressable';
import { useReducedMotion } from '../motion/MotionProvider';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

import type { GeneratedReferral } from '../application/ReferralCoordinator';
import type { RequiredReferralEventName } from '../domain/analytics';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Invite'>;
type Notice = {
  tone: 'info' | 'success' | 'error';
  title: string;
  message: string;
  journeyStatus?: 'rejected';
};

const MOCK_USER = { id: 'member_0194', name: 'Hasan', initials: 'HA' };
const LAB_CODE = 'RAL-H7K9P2Q4';

export function InviteScreen({ navigation }: Props): React.JSX.Element {
  const { colors, isDark } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const isWide = width >= 1200;
  const heroWide = width >= 680;
  const compact = width < 520;
  const { coordinator, clearLedger, events } = useReferralRuntime();
  const [referral, setReferral] = useState<GeneratedReferral | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const [chevronProgress] = useState(() => new Animated.Value(0));
  const [mobileTraceOpen, setMobileTraceOpen] = useState(false);
  const displayCode = referral?.referralCode ?? 'RAL ••••••••';
  const activeMilestones = useMemo(() => {
    if (!referral) return new Set<RequiredReferralEventName>();
    return getAcceptedReferralMilestones(events, referral.referralCode);
  }, [events, referral]);
  const architectureLabel = useMemo(
    () =>
      coordinator.integrationMode === 'native'
        ? 'Branch.io + Firebase Analytics'
        : 'Deterministic demo adapters',
    [coordinator.integrationMode],
  );

  useEffect(() => {
    chevronProgress.stopAnimation();
    if (reducedMotion) {
      chevronProgress.setValue(labOpen ? 1 : 0);
      return;
    }
    const animation = Animated.timing(chevronProgress, {
      toValue: labOpen ? 1 : 0,
      duration: motion.state,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [chevronProgress, labOpen, reducedMotion]);

  const generate = async () => {
    setNotice(null);
    setIsGenerating(true);
    try {
      const generated = await coordinator.generateReferral(MOCK_USER.id);
      setReferral(generated);
      setNotice({
        tone: 'success',
        title: 'Your referral link is ready',
        message: 'It is stable for this demo member and ready to share.',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'Could not generate the link',
        message: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const share = async () => {
    if (!referral) return;
    await runReferralShare({
      executeShare: () => coordinator.shareReferral(referral),
      setNotice,
      setSharing: setIsSharing,
    });
  };

  const simulate = (kind: 'direct' | 'deferred' | 'invalid') => {
    setNotice(null);
    coordinator.simulateLink(kind, referral?.referralCode ?? LAB_CODE);
    if (kind === 'invalid') {
      setNotice({
        tone: 'error',
        title: 'Malformed link safely rejected',
        message: 'The app stayed here and emitted explicit resolution-failure events.',
        journeyStatus: 'rejected',
      });
    }
  };

  const reset = async () => {
    setIsResetting(true);
    setNotice(null);
    const result = await commitDemoReset(
      () => coordinator.resetDemoState(),
      () => {
        clearLedger();
        setReferral(null);
        navigation.reset({
          index: 0,
          routes: [{ name: 'Invite' }],
        });
      },
    );
    if (result.ok) return;
    setIsResetting(false);
    setNotice({
      tone: 'error',
      title: result.committed
        ? 'Reset committed; refresh incomplete'
        : 'Reset could not be committed',
      message: result.committed
        ? `${result.message} Reopen the referral lab to refresh the screen.`
        : `${result.message} Your current journey is still available; try again.`,
    });
  };

  return (
    <ScreenShell>
      <View style={[styles.page, compact && styles.pageCompact]}>
        <PageIntro
          eyebrow="MEMBER REFERRALS"
          title="A trusted introduction, carried all the way through."
          description="Create a private link, share it in one tap, and preserve attribution from the first click to completed signup."
        />

        <View style={[styles.columns, !isWide && styles.stacked]}>
          <View style={styles.mainColumn}>
            <AnimatedReveal delay={motion.stagger * 2} distance={18} variant="forward">
              <MotionSurface
                accentColor={colors.accent}
                borderRadius={radii.xl}
                intensity="hero"
                testID="invite-hero-surface"
              >
                <LinearGradient
                  colors={
                    isDark
                      ? ['#143237', '#101F28', '#132B35']
                      : ['#E3F4F0', '#EDF4F7', '#FFF1E5']
                  }
                  locations={[0, 0.5, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.heroCard, compact && styles.heroCardCompact, { borderColor: colors.border }]}
                >
                  <View style={[styles.heroLayout, !heroWide && styles.heroStacked]}>
                  <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
                    <View style={styles.memberRow}>
                      <View style={[styles.avatar, { backgroundColor: colors.surfaceGlass }]}>
                        <Text style={[styles.avatarText, { color: colors.accentStrong }]}>{MOCK_USER.initials}</Text>
                      </View>
                      <View style={styles.memberCopy}>
                        <View style={styles.verifiedRow}>
                          <Feather name="shield" color={colors.success} size={14} />
                          <Text style={[styles.verified, { color: colors.success }]}>VERIFIED MEMBER</Text>
                        </View>
                        <Text style={[styles.memberName, { color: colors.ink }]}>Welcome back, {MOCK_USER.name}</Text>
                      </View>
                    </View>

                    <View>
                      <Text style={[styles.heroEyebrow, { color: colors.accentStrong }]}>YOUR INVITATION</Text>
                      <Text style={[styles.heroTitle, compact && styles.heroTitleCompact, { color: colors.ink }]}>Make every referral signal traceable.</Text>
                      <Text style={[styles.heroDescription, { color: colors.inkMuted }]}>Generate a durable identity, carry it through direct or deferred handoff, and verify every accepted milestone.</Text>
                    </View>

                    <View style={[styles.codePanel, { backgroundColor: colors.surfaceGlass, borderColor: colors.borderStrong }]}>
                      <View style={styles.codeHeading}>
                        <Text style={[styles.codeLabel, { color: colors.inkSubtle }]}>REFERRAL CODE</Text>
                        {referral ? (
                          <AnimatedReveal variant="scale" duration={motion.state} replayKey={referral.referralCode}>
                            <View style={[styles.readyPill, { backgroundColor: colors.successSoft }]}>
                              <View style={[styles.readyDot, { backgroundColor: colors.success }]} />
                              <Text style={[styles.readyText, { color: colors.success }]}>READY</Text>
                            </View>
                          </AnimatedReveal>
                        ) : null}
                      </View>
                      <AnimatedReveal variant="scale" replayKey={displayCode} duration={motion.feedback}>
                        <Text selectable style={[styles.code, { color: colors.ink }]}>{displayCode}</Text>
                      </AnimatedReveal>
                    </View>

                    {!referral ? (
                      <Button
                        label="Generate my referral link"
                        icon="zap"
                        loading={isGenerating}
                        onPress={() => void generate()}
                        fullWidth={!heroWide}
                      />
                    ) : (
                      <Button
                        label="Share my invitation"
                        icon="share-2"
                        loading={isSharing}
                        onPress={() => void share()}
                        fullWidth={!heroWide}
                      />
                    )}
                  </View>

                  <View style={[styles.orbitStage, !heroWide && styles.orbitStageCompact]}>
                    <ReferralOrbit
                      activeMilestones={activeMilestones}
                      size={heroWide ? 270 : 218}
                      status={notice?.journeyStatus ?? 'default'}
                    />
                    <Text style={[styles.orbitCaption, { color: colors.inkMuted }]}>Five milestones. One durable referral identity.</Text>
                  </View>
                </View>
                </LinearGradient>
              </MotionSurface>
            </AnimatedReveal>

            {referral ? (
              <AnimatedReveal replayKey={referral.url} distance={8}>
                <MotionSurface accentColor={colors.accent} borderRadius={radii.lg} intensity="quiet">
                  <View style={[styles.linkBox, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
                    <View style={[styles.linkIcon, { backgroundColor: colors.accentSoft }]}>
                      <Feather name="link" color={colors.accentStrong} size={17} />
                    </View>
                    <View style={styles.linkCopy}>
                      <Text style={[styles.linkLabel, { color: colors.inkSubtle }]}>SHAREABLE LINK</Text>
                      <Text selectable numberOfLines={2} style={[styles.link, { color: colors.inkMuted }]}>{referral.url}</Text>
                    </View>
                    <Feather name="check-circle" color={colors.success} size={19} />
                  </View>
                </MotionSurface>
              </AnimatedReveal>
            ) : null}
            {notice ? <StatusBanner {...notice} /> : null}

            <MotionSurface accentColor={colors.accent} borderRadius={radii.lg} intensity="quiet">
              <View style={[styles.lab, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
              <MotionPressable
                aria-expanded={labOpen}
                accessibilityRole="button"
                accessibilityLabel={labOpen ? 'Hide demo controls' : 'Show demo controls'}
                accessibilityState={{ expanded: labOpen }}
                borderRadius={radii.lg}
                focusColor={colors.accent}
                frameStyle={styles.labMotionHeader}
                hoverTint={colors.accent}
                onPress={() => setLabOpen((current) => !current)}
                preset="row"
                contentStyle={({ pressed }) => [
                  styles.labHeader,
                  pressed && styles.labHeaderPressed,
                ]}
              >
                <View style={[styles.labIcon, { backgroundColor: colors.accentSoft }]}>
                  <Feather name="sliders" color={colors.accentStrong} size={18} />
                </View>
                <View style={styles.labHeadingCopy}>
                  <Text style={[styles.labEyebrow, { color: colors.accentStrong }]}>RELIABILITY CONTROLS</Text>
                  <Text style={[styles.labTitle, { color: colors.ink }]}>Inspect direct, deferred, and failure paths</Text>
                </View>
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: reducedMotion
                          ? labOpen
                            ? '180deg'
                            : '0deg'
                          : chevronProgress.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['0deg', '180deg'],
                            }),
                      },
                    ],
                  }}
                >
                  <Feather name="chevron-down" color={colors.inkMuted} size={20} />
                </Animated.View>
              </MotionPressable>

              {labOpen ? (
                <AnimatedReveal duration={motion.feedback} distance={12} variant="forward">
                  <View style={[styles.labBody, { borderTopColor: colors.border }]}>
                    <StatusBanner
                      tone="info"
                      title="Demo fixture ; no provider handoff"
                      message="These controls inject deterministic Branch-shaped callbacks into the parser and state machine. Real Branch delivery, app-store installation, first-launch attribution, and Firebase delivery require a configured native build."
                    />
                    <Text style={[styles.labDescription, { color: colors.inkMuted }]}>
                      Direct and deferred controls inject Branch-shaped demo fixtures. The deferred option sets the first-session callback flag; it does not perform an install.
                    </Text>
                    <View style={styles.labButtons}>
                      <Button label="Simulate direct callback" icon="corner-down-right" variant="secondary" disabled={isGenerating || isSharing || isResetting} onPress={() => simulate('direct')} />
                      <Button
                        label="Simulate deferred callback"
                        icon="download-cloud"
                        variant="secondary"
                        disabled={isGenerating || isSharing || isResetting}
                        onPress={() => simulate('deferred')}
                      />
                      <Button label="Invalid payload" icon="shield-off" variant="danger" disabled={isGenerating || isSharing || isResetting} onPress={() => simulate('invalid')} />
                    </View>
                    <View style={[styles.techRow, { borderTopColor: colors.border }]}>
                      <Text style={[styles.techText, { color: colors.inkSubtle }]}>{architectureLabel}</Text>
                      <Text style={[styles.techText, { color: colors.inkSubtle }]}>{Platform.OS} · idempotent milestones</Text>
                    </View>
                    <Button label="Reset test state" icon="refresh-cw" variant="ghost" loading={isResetting} disabled={isGenerating || isSharing} onPress={() => void reset()} />
                  </View>
                </AnimatedReveal>
              ) : null}
              </View>
            </MotionSurface>

            {!isWide ? (
              <View style={styles.mobileTrace}>
                  <Button
                    label={mobileTraceOpen ? 'Hide technical trace' : 'View technical trace'}
                    icon={mobileTraceOpen ? 'chevron-up' : 'activity'}
                    variant="secondary"
                    fullWidth
                    accessibilityState={{ expanded: mobileTraceOpen }}
                    onPress={() => setMobileTraceOpen((current) => !current)}
                />
                {mobileTraceOpen ? (
                  <AnimatedReveal duration={motion.feedback} distance={12} variant="forward">
                    <EventLedger referralCode={referral?.referralCode ?? null} />
                  </AnimatedReveal>
                ) : null}
              </View>
            ) : null}
          </View>

          {isWide ? (
            <AnimatedReveal delay={motion.stagger * 3} style={styles.sideColumn}>
              <EventLedger referralCode={referral?.referralCode ?? null} />
            </AnimatedReveal>
          ) : null}
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 42, gap: 36 },
  pageCompact: { paddingTop: 28, gap: 28 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.72, minWidth: 0, width: '100%', gap: 16 },
  sideColumn: { flex: 0.88, minWidth: 300, width: '100%' },
  heroCard: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: 28,
    overflow: 'hidden',
    shadowColor: '#123E42',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 6,
  },
  heroCardCompact: { padding: 20 },
  heroLayout: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  heroStacked: { flexDirection: 'column', alignItems: 'stretch' },
  heroCopy: { flex: 1.2, minWidth: 0, gap: 22, alignItems: 'flex-start' },
  heroCopyCompact: { gap: 17 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: typography.family, fontSize: 14, fontWeight: '800' },
  memberCopy: { flex: 1 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verified: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 0.9 },
  memberName: { marginTop: 2, fontFamily: typography.family, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  heroEyebrow: { fontFamily: typography.family, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1 },
  heroTitle: { marginTop: 7, fontFamily: typography.family, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8 },
  heroTitleCompact: { fontSize: 26, lineHeight: 32, letterSpacing: -0.55 },
  heroDescription: { marginTop: 9, maxWidth: 520, fontFamily: typography.family, fontSize: 15, lineHeight: 23 },
  codePanel: { width: '100%', borderWidth: 1, borderRadius: radii.lg, padding: 17, gap: 7 },
  codeHeading: { minHeight: 22, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  codeLabel: { fontFamily: typography.family, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.05 },
  code: { flexShrink: 1, fontFamily: typography.mono, fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: 1.2 },
  readyPill: { minHeight: 24, borderRadius: radii.pill, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  readyDot: { width: 6, height: 6, borderRadius: 3 },
  readyText: { fontFamily: typography.family, fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.8 },
  orbitStage: { flex: 0.85, minWidth: 268, alignItems: 'center', justifyContent: 'center', gap: 5 },
  orbitStageCompact: { minWidth: 0, width: '100%', paddingTop: 2 },
  orbitCaption: { maxWidth: 240, textAlign: 'center', fontFamily: typography.family, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  linkBox: { borderWidth: 1, borderRadius: radii.lg, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  linkCopy: { flex: 1, gap: 2 },
  linkLabel: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 0.95 },
  link: { fontFamily: typography.family, fontSize: 13, lineHeight: 19 },
  lab: { borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  labMotionHeader: { width: '100%', borderRadius: radii.lg },
  labHeader: { minHeight: 76, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, cursor: Platform.OS === 'web' ? 'pointer' : undefined },
  labHeaderPressed: { opacity: 0.72 },
  labIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  labHeadingCopy: { flex: 1 },
  labEyebrow: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.05 },
  labTitle: { marginTop: 3, fontFamily: typography.family, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  labBody: { borderTopWidth: 1, padding: 18, gap: 16 },
  labDescription: { fontFamily: typography.family, fontSize: 14, lineHeight: 22 },
  labButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  techRow: { borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  techText: { fontFamily: typography.family, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  mobileTrace: { gap: 12 },
});
