import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { commitDemoReset } from '../application/commitDemoReset';
import { getAcceptedReferralMilestones } from '../application/referralProgress';
import { useReferralRuntime } from '../application/ReferralRuntime';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { ReferralOrbit } from '../components/ReferralOrbit';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { AnimatedReveal } from '../motion/AnimatedReveal';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Success'>;

export function SuccessScreen({ route, navigation }: Props): React.JSX.Element {
  const { accountId, referralCode, referralFingerprint } = route.params;
  const { colors, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 1200;
  const compact = width < 520;
  const { coordinator, clearLedger, events } = useReferralRuntime();
  const [mobileTraceOpen, setMobileTraceOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<{
    committed: boolean;
    message: string;
  } | null>(null);
  const activeMilestones = useMemo(
    () => getAcceptedReferralMilestones(events, referralCode, referralFingerprint),
    [events, referralCode, referralFingerprint],
  );

  const restart = async () => {
    setIsResetting(true);
    setResetError(null);
    const result = await commitDemoReset(
      () => coordinator.resetDemoState(),
      () => {
        clearLedger();
        navigation.reset({
          index: 0,
          routes: [{ name: 'Invite' }],
        });
      },
    );
    if (result.ok) return;
    setIsResetting(false);
    setResetError({ committed: result.committed, message: result.message });
  };

  return (
    <ScreenShell>
      <View style={styles.page}>
        <View style={[styles.columns, !isWide && styles.stacked]}>
          <View style={styles.mainColumn}>
            <AnimatedReveal variant="scale">
              <MotionSurface
                accentColor={colors.success}
                borderRadius={radii.xl}
                intensity="hero"
                testID="success-celebration-surface"
              >
                <LinearGradient
                  colors={
                    isDark
                      ? ['#143237', '#101F28', '#153139']
                      : ['#E3F4F0', '#EDF4F7', '#FFF1E5']
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.successCard, { borderColor: colors.border }]}
                >
                <ReferralOrbit
                  activeMilestones={activeMilestones}
                  size={compact ? 200 : 238}
                  success={activeMilestones.has('referral_signup_completed')}
                />
                <AnimatedReveal delay={motion.stagger}>
                  <View style={[styles.completePill, { backgroundColor: colors.successSoft }]}>
                    <Feather name="check-circle" color={colors.success} size={15} />
                    <Text style={[styles.completePillText, { color: colors.success }]}>ATTRIBUTED SIGNUP COMPLETE</Text>
                  </View>
                </AnimatedReveal>
                <AnimatedReveal delay={motion.stagger * 2}>
                  <Text accessibilityLiveRegion="polite" accessibilityRole="header" style={[styles.title, compact && styles.titleCompact, { color: colors.ink }]}>The referred signup is complete.</Text>
                </AnimatedReveal>
                <AnimatedReveal delay={motion.stagger * 3}>
                  <Text style={[styles.description, { color: colors.inkMuted }]}>The invitee-side journey completed with the same protected referral identity that arrived on the original link.</Text>
                </AnimatedReveal>

                <View style={[styles.receipt, { backgroundColor: colors.surfaceGlass, borderColor: colors.borderStrong }]}>
                  <ReceiptRow compact={compact} label="Referral code" value={referralCode} />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <ReceiptRow compact={compact} label="Demo account" value={accountId} />
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <ReceiptRow compact={compact} label="Reward status" value="Validation queued" />
                </View>

                <View style={[styles.note, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
                  <View style={[styles.noteIcon, { backgroundColor: colors.accentSoft }]}>
                    <Feather name="server" color={colors.accentStrong} size={17} />
                  </View>
                  <Text style={[styles.noteText, { color: colors.inkMuted }]}>Production rewards belong to an idempotent backend ledger, not the mobile client.</Text>
                </View>
                {resetError ? (
                  <View style={styles.resetError}>
                    <StatusBanner
                      tone="error"
                      title={
                        resetError.committed
                          ? 'Reset committed; refresh incomplete'
                          : 'Reset could not be committed'
                      }
                      message={
                        resetError.committed
                          ? `${resetError.message} Reopen the referral lab to refresh the screen.`
                          : `${resetError.message} Your completed receipt remains available; try again.`
                      }
                    />
                  </View>
                ) : null}
                <Button label="Run the flow again" icon="refresh-cw" loading={isResetting} fullWidth onPress={() => void restart()} />
                </LinearGradient>
              </MotionSurface>
            </AnimatedReveal>

            {!isWide ? (
              <View style={styles.mobileTrace}>
                <Button
                  label={mobileTraceOpen ? 'Hide technical trace' : 'View completed trace'}
                  icon={mobileTraceOpen ? 'chevron-up' : 'activity'}
                  variant="secondary"
                  fullWidth
                  accessibilityState={{ expanded: mobileTraceOpen }}
                  onPress={() => setMobileTraceOpen((current) => !current)}
                />
                {mobileTraceOpen ? (
                  <AnimatedReveal duration={motion.feedback} distance={8}>
                    <EventLedger
                      referralCode={referralCode}
                      referralFingerprint={referralFingerprint}
                    />
                  </AnimatedReveal>
                ) : null}
              </View>
            ) : null}
          </View>

          {isWide ? (
            <AnimatedReveal delay={motion.stagger * 2} style={styles.sideColumn}>
              <EventLedger
                referralCode={referralCode}
                referralFingerprint={referralFingerprint}
              />
            </AnimatedReveal>
          ) : null}
        </View>
      </View>
    </ScreenShell>
  );
}

function ReceiptRow({ label, value, compact }: { label: string; value: string; compact: boolean }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.receiptRow, compact && styles.receiptRowCompact]}>
      <Text style={[styles.receiptLabel, { color: colors.inkSubtle }]}>{label}</Text>
      <Text selectable style={[styles.receiptValue, compact && styles.receiptValueCompact, { color: colors.ink }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 44 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.72, minWidth: 0, width: '100%', gap: 14 },
  sideColumn: { flex: 0.88, minWidth: 300, width: '100%' },
  successCard: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: 30,
    alignItems: 'center',
    gap: 17,
    overflow: 'hidden',
    shadowColor: '#123E42',
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 6,
  },
  completePill: { maxWidth: '100%', minHeight: 34, borderRadius: radii.pill, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  completePillText: { flexShrink: 1, textAlign: 'center', fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.05 },
  title: { maxWidth: 580, textAlign: 'center', fontFamily: typography.family, fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -1.25 },
  titleCompact: { fontSize: 32, lineHeight: 38, letterSpacing: -0.85 },
  description: { maxWidth: 560, textAlign: 'center', fontFamily: typography.family, fontSize: 16, lineHeight: 25 },
  receipt: { width: '100%', borderWidth: 1, borderRadius: radii.lg, padding: 18, gap: 13, marginTop: 3 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18 },
  receiptRowCompact: { flexDirection: 'column', gap: 3 },
  receiptLabel: { fontFamily: typography.family, fontSize: 13, lineHeight: 19 },
  receiptValue: { flexShrink: 1, textAlign: 'right', fontFamily: typography.mono, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  receiptValueCompact: { textAlign: 'left' },
  divider: { height: StyleSheet.hairlineWidth },
  note: { width: '100%', borderWidth: 1, borderRadius: radii.lg, padding: 15, flexDirection: 'row', gap: 12, alignItems: 'center' },
  noteIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  noteText: { flex: 1, fontFamily: typography.family, fontSize: 13, lineHeight: 20 },
  resetError: { width: '100%' },
  mobileTrace: { gap: 12 },
});
