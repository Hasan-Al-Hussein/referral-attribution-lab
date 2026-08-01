import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { isReferralLifecycleCancelled } from '../application/ReferralCoordinator';
import { getAcceptedReferralMilestones } from '../application/referralProgress';
import { useReferralRuntime } from '../application/ReferralRuntime';
import { Button } from '../components/Button';
import { EventLedger } from '../components/EventLedger';
import { PageIntro } from '../components/PageIntro';
import { ReferralOrbit } from '../components/ReferralOrbit';
import { ScreenShell } from '../components/ScreenShell';
import { StatusBanner } from '../components/StatusBanner';
import { AnimatedReveal } from '../motion/AnimatedReveal';
import { MotionFieldFrame } from '../motion/MotionFieldFrame';
import { useReducedMotion } from '../motion/MotionProvider';
import { MotionSurface } from '../motion/MotionSurface';
import { motion, radii, typography, useAppTheme } from '../theme/theme';

import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;
type FieldErrors = { firstName?: string; email?: string };

function isValidEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim().toLowerCase());
}

export function OnboardingScreen({ route, navigation }: Props): React.JSX.Element {
  const { attribution } = route.params;
  const { colors, isDark } = useAppTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 1200;
  const arrivalWide = width >= 650;
  const compact = width < 520;
  const { coordinator, events } = useReferralRuntime();
  const isDemoFixture = attribution.kind.startsWith('demo-');
  const isSimulatedDeferred = attribution.kind === 'demo-deferred';
  const [hasStarted, setHasStarted] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [mobileTraceOpen, setMobileTraceOpen] = useState(false);
  const [focusedField, setFocusedField] = useState<'firstName' | 'email' | null>(null);
  const firstNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const projectLock = useRef(false);
  const activeMilestones = useMemo(() => {
    return getAcceptedReferralMilestones(
      events,
      attribution.referralCode,
      attribution.fingerprint,
    );
  }, [attribution.fingerprint, attribution.referralCode, events]);
  const includesReferrerMilestones =
    activeMilestones.has('referral_link_generated') &&
    activeMilestones.has('referral_link_shared');
  const includesGeneratedMilestone = activeMilestones.has('referral_link_generated');
  const simulatedHandoffCopy = includesReferrerMilestones
    ? 'Combined demo journey: create, share, and click are preserved, so onboarding begins at 3/5.'
    : includesGeneratedMilestone
      ? 'Partial demo journey: create and click are preserved; share was not accepted, so onboarding begins at 2/5.'
      : 'Standalone invitee trace: 1/5 is correct because create and share occur on the referrer’s device.';
  const introEyebrow = isSimulatedDeferred
    ? 'SIMULATED FIRST-LAUNCH CALLBACK'
    : isDemoFixture
      ? 'SIMULATED DIRECT-LINK CALLBACK'
      : attribution.kind.includes('deferred')
        ? 'FIRST-LAUNCH ATTRIBUTION'
        : 'REFERRED ONBOARDING';
  const introDescription = isDemoFixture
    ? isSimulatedDeferred
      ? 'This demo fixture validates and persists a deferred-shaped callback before onboarding.'
      : 'This demo fixture validates and persists a direct-link callback before onboarding.'
    : 'The referral was validated and saved before this screen opened, so the right invitation stays attached throughout signup.';
  const formHasError = Boolean(fieldErrors.firstName || fieldErrors.email || serverError);

  useEffect(() => {
    if (!hasStarted) return;
    const frame = requestAnimationFrame(() => firstNameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [hasStarted]);

  const begin = async () => {
    setServerError(null);
    setIsStarting(true);
    try {
      await coordinator.beginSignup(attribution.referralCode, attribution);
      setHasStarted(true);
    } catch (caught) {
      setServerError(caught instanceof Error ? caught.message : 'Signup could not be started.');
    } finally {
      setIsStarting(false);
    }
  };

  const complete = async () => {
    if (projectLock.current) return;
    setServerError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: FieldErrors = {};
    if (!firstName.trim()) nextErrors.firstName = 'Enter your first name.';
    if (!isValidEmail(normalizedEmail)) nextErrors.email = 'Enter a valid email address.';
    setFieldErrors(nextErrors);
    if (nextErrors.firstName) {
      firstNameRef.current?.focus();
      return;
    }
    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }

    projectLock.current = true;
    setIsSubmitting(true);
    try {
      const result = await coordinator.completeSignup(
        attribution.referralCode,
        normalizedEmail,
        attribution,
      );
      navigation.replace('Success', result);
    } catch (caught) {
      if (!isReferralLifecycleCancelled(caught)) {
        setServerError(caught instanceof Error ? caught.message : 'Signup could not be completed.');
      }
    } finally {
      projectLock.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <ScreenShell>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.page, compact && styles.pageCompact]}>
          <Button
            label="Back to referral lab"
            icon="arrow-left"
            variant="ghost"
            disabled={isStarting || isSubmitting}
            onPress={() => navigation.navigate('Invite')}
            style={styles.backButton}
          />
          <PageIntro
            eyebrow={introEyebrow}
            title="Your invitation found you."
            description={introDescription}
          />

          <View style={[styles.columns, !isWide && styles.stacked]}>
            <View style={styles.mainColumn}>
              <AnimatedReveal delay={motion.stagger * 2} distance={18} variant="forward">
                <MotionSurface
                  accentColor={colors.accent}
                  borderRadius={radii.xl}
                  intensity="hero"
                  testID="onboarding-attribution-surface"
                >
                  <LinearGradient
                    colors={
                      isDark
                        ? ['#143237', '#101F28', '#153139']
                        : ['#E3F4F0', '#EDF4F7', '#FFF1E5']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      styles.arrivalCard,
                      !arrivalWide && styles.arrivalStacked,
                      compact && styles.arrivalCardCompact,
                      { borderColor: colors.border },
                    ]}
                  >
                  <View style={[styles.arrivalCopy, compact && styles.arrivalCopyCompact]}>
                    <View style={styles.arrivalBadgeRow}>
                      <View style={[styles.arrivalIcon, { backgroundColor: colors.surfaceGlass }]}>
                        <Feather name="check" color={colors.success} size={18} />
                      </View>
                      <View style={styles.arrivalBadgeCopy}>
                        <Text style={[styles.arrivalEyebrow, { color: colors.success }]}>REFERRAL PRE-APPLIED</Text>
                        <Text style={[styles.arrivalMeta, { color: colors.inkMuted }]}>{attribution.kind.replace('-', ' ')} · destination verified</Text>
                      </View>
                    </View>
                    {isDemoFixture ? (
                      <View
                        accessibilityLabel="Demo fixture. No external provider handoff occurred."
                        style={[
                          styles.fixtureBadge,
                          { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                        ]}
                      >
                        <Feather name="monitor" color={colors.accentStrong} size={14} />
                        <Text style={[styles.fixtureBadgeText, { color: colors.accentStrong }]}>
                          DEMO FIXTURE · NO PROVIDER HANDOFF
                        </Text>
                      </View>
                    ) : null}
                    <Text style={[styles.arrivalTitle, { color: colors.ink }]}>
                      {isDemoFixture
                        ? compact
                          ? 'Callback accepted.'
                          : 'The simulated callback was accepted.'
                        : 'The link survived the handoff.'}
                    </Text>
                    <Text style={[styles.arrivalDescription, { color: colors.inkMuted }]}>
                      {compact
                        ? 'The code is persisted and locked for signup.'
                        : 'The code is persisted before navigation and becomes immutable when signup starts.'}
                    </Text>
                    {isSimulatedDeferred ? (
                      <View
                        style={[
                          styles.deviceHandoffNote,
                          { backgroundColor: colors.surfaceGlass, borderColor: colors.borderStrong },
                        ]}
                      >
                        <Feather name="repeat" color={colors.accentStrong} size={16} />
                        <Text style={[styles.deviceHandoffText, { color: colors.inkMuted }]}>
                          {compact && includesReferrerMilestones
                            ? 'Create, share, and click are preserved ; onboarding starts at 3/5.'
                            : simulatedHandoffCopy}
                        </Text>
                      </View>
                    ) : null}
                    <View style={[styles.appliedCode, { backgroundColor: colors.surfaceGlass, borderColor: colors.borderStrong }]}>
                      <View style={styles.appliedCodeCopy}>
                        <Text style={[styles.codeLabel, { color: colors.inkSubtle }]}>APPLIED CODE</Text>
                        <Text selectable style={[styles.code, { color: colors.ink }]}>{attribution.referralCode}</Text>
                      </View>
                      <View style={[styles.lockIcon, { backgroundColor: colors.successSoft }]}>
                        <Feather name="lock" color={colors.success} size={17} />
                      </View>
                    </View>
                    {!arrivalWide && !hasStarted ? (
                      <View style={[styles.mobileStart, { borderTopColor: colors.border }]}>
                        <View style={styles.mobileStartCopy}>
                          <Feather name="shield" color={colors.success} size={16} />
                          <Text style={[styles.mobileStartText, { color: colors.inkMuted }]}>Validated, persisted, and ready for secure signup.</Text>
                        </View>
                        {serverError ? <StatusBanner tone="error" title="Signup could not start" message={serverError} /> : null}
                        <Button
                          label="Start secure signup"
                          icon="arrow-right"
                          loading={isStarting}
                          fullWidth
                          onPress={() => void begin()}
                        />
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.arrivalOrbit}>
                    <ReferralOrbit
                      activeMilestones={activeMilestones}
                      size={arrivalWide ? 188 : 170}
                      status={formHasError ? 'attention' : 'default'}
                    />
                  </View>
                  </LinearGradient>
                </MotionSurface>
              </AnimatedReveal>

              {hasStarted || arrivalWide ? (
                <AnimatedReveal delay={motion.stagger * 3} distance={18} variant="forward">
                <MotionSurface
                  accentColor={formHasError ? colors.danger : colors.accent}
                  borderRadius={radii.xl}
                  intensity="standard"
                  testID="onboarding-form-surface"
                >
                  <View style={[styles.formCard, { backgroundColor: colors.surfaceGlass, borderColor: colors.border }]}>
                  <StepHeader step={hasStarted ? 2 : 1} />

                  {!hasStarted ? (
                    <AnimatedReveal replayKey="signup-introduction" distance={16} variant="forward">
                      <View style={styles.formStage}>
                      <View>
                        <Text style={[styles.formTitle, { color: colors.ink }]}>Complete the attributed signup</Text>
                        <Text style={[styles.formDescription, { color: colors.inkMuted }]}>Your referral remains protected as you move into the secure signup flow.</Text>
                      </View>
                      <View style={styles.trustList}>
                        <TrustRow icon="shield" label="Code validated before navigation" />
                        <TrustRow icon="save" label="Attribution persisted across restarts" />
                        <TrustRow icon="eye-off" label="No personal data in analytics events" />
                      </View>
                      {serverError ? <StatusBanner tone="error" title="Signup could not start" message={serverError} /> : null}
                      <Button label="Start secure signup" icon="arrow-right" loading={isStarting} fullWidth onPress={() => void begin()} />
                      </View>
                    </AnimatedReveal>
                  ) : (
                    <AnimatedReveal replayKey="signup-details" distance={18} variant="forward">
                      <View style={styles.formStage}>
                      <View>
                        <Text style={[styles.formTitle, { color: colors.ink }]}>A few details to continue</Text>
                        <Text style={[styles.formDescription, { color: colors.inkMuted }]}>This project uses a local endpoint. Nothing entered here leaves the device.</Text>
                      </View>

                      <View style={styles.fields}>
                        <View style={styles.fieldGroup}>
                          <Text style={[styles.label, { color: colors.ink }]}>First name</Text>
                          <MotionFieldFrame
                            backgroundColor={colors.surfaceElevated}
                            borderColor={fieldErrors.firstName ? colors.danger : colors.borderStrong}
                            error={Boolean(fieldErrors.firstName)}
                            focusColor={colors.accent}
                            focused={focusedField === 'firstName'}
                            style={styles.inputFrame}
                          >
                            <TextInput
                              ref={firstNameRef}
                              accessibilityLabel="First name"
                              accessibilityHint="Required"
                              aria-describedby={fieldErrors.firstName ? 'first-name-error' : undefined}
                              aria-invalid={Boolean(fieldErrors.firstName)}
                              autoComplete="name-given"
                              autoCapitalize="words"
                              placeholder="Your first name"
                              placeholderTextColor={colors.inkSubtle}
                              editable={!isSubmitting}
                              value={firstName}
                              onBlur={() => {
                                setFocusedField((current) => (current === 'firstName' ? null : current));
                                if (!firstName.trim()) setFieldErrors((current) => ({ ...current, firstName: 'Enter your first name.' }));
                              }}
                              onFocus={() => setFocusedField('firstName')}
                              onChangeText={(value) => {
                                setFirstName(value);
                                if (fieldErrors.firstName) {
                                  setFieldErrors(({ firstName: _ignored, ...current }) => current);
                                }
                              }}
                              returnKeyType="next"
                              onSubmitEditing={() => emailRef.current?.focus()}
                              style={[styles.input, { color: colors.ink }]}
                            />
                          </MotionFieldFrame>
                          <View style={styles.errorSlot}>
                            {fieldErrors.firstName ? (
                              <AnimatedReveal duration={motion.state} distance={4} replayKey={fieldErrors.firstName}>
                                <Text nativeID="first-name-error" accessibilityLiveRegion="polite" style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.firstName}</Text>
                              </AnimatedReveal>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.fieldGroup}>
                          <Text style={[styles.label, { color: colors.ink }]}>Email address</Text>
                          <MotionFieldFrame
                            backgroundColor={colors.surfaceElevated}
                            borderColor={fieldErrors.email ? colors.danger : colors.borderStrong}
                            error={Boolean(fieldErrors.email)}
                            focusColor={colors.accent}
                            focused={focusedField === 'email'}
                            style={styles.inputFrame}
                          >
                            <TextInput
                              ref={emailRef}
                              accessibilityLabel="Email address"
                              accessibilityHint="Required"
                              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                              aria-invalid={Boolean(fieldErrors.email)}
                              autoComplete="email"
                              autoCapitalize="none"
                              keyboardType="email-address"
                              placeholder="you@example.com"
                              placeholderTextColor={colors.inkSubtle}
                              editable={!isSubmitting}
                              value={email}
                              onBlur={() => {
                                setFocusedField((current) => (current === 'email' ? null : current));
                                if (!isValidEmail(email)) {
                                  setFieldErrors((current) => ({ ...current, email: 'Enter a valid email address.' }));
                                }
                              }}
                              onFocus={() => setFocusedField('email')}
                              onChangeText={(value) => {
                                setEmail(value);
                                if (fieldErrors.email) {
                                  setFieldErrors(({ email: _ignored, ...current }) => current);
                                }
                              }}
                              returnKeyType="done"
                              onSubmitEditing={() => void complete()}
                              style={[styles.input, { color: colors.ink }]}
                            />
                          </MotionFieldFrame>
                          <View style={styles.errorSlot}>
                            {fieldErrors.email ? (
                              <AnimatedReveal duration={motion.state} distance={4} replayKey={fieldErrors.email}>
                                <Text nativeID="email-error" accessibilityLiveRegion="polite" style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.email}</Text>
                              </AnimatedReveal>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.fieldGroup}>
                          <Text style={[styles.label, { color: colors.ink }]}>Referral code</Text>
                          <View accessibilityLabel={`Referral code ${attribution.referralCode}, locked`} style={[styles.lockedInput, { backgroundColor: colors.successSoft, borderColor: colors.success }]}>
                            <Text selectable style={[styles.lockedCode, { color: colors.ink }]}>{attribution.referralCode}</Text>
                            <Feather name="lock" color={colors.success} size={16} />
                          </View>
                          <Text style={[styles.helper, { color: colors.inkSubtle }]}>Applied automatically and protected from replacement.</Text>
                        </View>
                      </View>
                      {serverError ? <StatusBanner tone="error" title="Signup could not be completed" message={serverError} /> : null}
                      <Button label="Create demo account" icon="check-circle" loading={isSubmitting} fullWidth onPress={() => void complete()} />
                      <Text style={[styles.terms, { color: colors.inkSubtle }]}>Project fixture only. This does not create a real financial account.</Text>
                      </View>
                    </AnimatedReveal>
                  )}
                  </View>
                </MotionSurface>
                </AnimatedReveal>
              ) : null}

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
                    <AnimatedReveal duration={motion.feedback} distance={8}>
                      <EventLedger
                        referralCode={attribution.referralCode}
                        referralFingerprint={attribution.fingerprint}
                      />
                    </AnimatedReveal>
                  ) : null}
                </View>
              ) : null}
            </View>

            {isWide ? (
              <AnimatedReveal delay={motion.stagger * 3} style={styles.sideColumn}>
                <EventLedger
                  referralCode={attribution.referralCode}
                  referralFingerprint={attribution.fingerprint}
                />
              </AnimatedReveal>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenShell>
  );
}

function StepHeader({ step }: { step: 1 | 2 }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.stepHeader}>
      <View>
        <Text style={[styles.stepEyebrow, { color: colors.accentStrong }]}>SECURE SIGNUP</Text>
        <Text style={[styles.stepLabel, { color: colors.inkMuted }]}>Step {step} of 2</Text>
      </View>
      <View style={styles.stepBars}>
        {[1, 2].map((item) => (
          <AnimatedStepBar key={item} active={item <= step} />
        ))}
      </View>
    </View>
  );
}

function AnimatedStepBar({ active }: { active: boolean }): React.JSX.Element {
  const { colors } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reducedMotion && active ? 1 : 0));

  useEffect(() => {
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(active ? 1 : 0);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: motion.state,
      easing: motion.easeOut,
      useNativeDriver: motion.nativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [active, progress, reducedMotion]);

  return (
    <View style={[styles.stepBar, { backgroundColor: colors.border }]}>
      <Animated.View
        style={[
          styles.stepBarFill,
          {
            backgroundColor: colors.accent,
            opacity: progress,
            transform: [
              {
                scaleX: reducedMotion
                  ? active
                    ? 1
                    : 0
                  : progress.interpolate({ inputRange: [0, 1], outputRange: [0.08, 1] }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function TrustRow({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }): React.JSX.Element {
  const { colors } = useAppTheme();
  return (
    <View style={styles.trustRow}>
      <View style={[styles.trustIcon, { backgroundColor: colors.accentSoft }]}>
        <Feather name={icon} color={colors.accentStrong} size={16} />
      </View>
      <Text style={[styles.trustText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 24, gap: 30 },
  pageCompact: { paddingTop: 18, gap: 22 },
  backButton: { alignSelf: 'flex-start' },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  stacked: { flexDirection: 'column' },
  mainColumn: { flex: 1.72, minWidth: 0, width: '100%', gap: 16 },
  sideColumn: { flex: 0.88, minWidth: 300, width: '100%' },
  arrivalCard: { borderWidth: 1, borderRadius: radii.xl, padding: 25, flexDirection: 'row', alignItems: 'center', gap: 20, overflow: 'hidden' },
  arrivalStacked: { flexDirection: 'column', alignItems: 'stretch' },
  arrivalCardCompact: { padding: 18, gap: 16 },
  arrivalCopy: { flex: 1, minWidth: 0, gap: 14 },
  arrivalCopyCompact: { gap: 11 },
  arrivalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  arrivalBadgeCopy: { flex: 1, minWidth: 0 },
  arrivalIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  arrivalEyebrow: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.05 },
  arrivalMeta: { marginTop: 2, fontFamily: typography.family, fontSize: 12, lineHeight: 18, textTransform: 'capitalize' },
  fixtureBadge: {
    alignSelf: 'flex-start',
    minHeight: 30,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  fixtureBadgeText: {
    flexShrink: 1,
    fontFamily: typography.family,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  arrivalTitle: { fontFamily: typography.family, fontSize: 25, lineHeight: 31, fontWeight: '800', letterSpacing: -0.55 },
  arrivalDescription: { fontFamily: typography.family, fontSize: 14, lineHeight: 22 },
  deviceHandoffNote: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  deviceHandoffText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  appliedCode: { borderWidth: 1, borderRadius: radii.lg, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  appliedCodeCopy: { flex: 1, minWidth: 0 },
  codeLabel: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1 },
  code: { marginTop: 4, flexShrink: 1, fontFamily: typography.mono, fontSize: 22, lineHeight: 29, fontWeight: '700', letterSpacing: 1 },
  lockIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  mobileStart: { borderTopWidth: 1, paddingTop: 14, gap: 12 },
  mobileStartCopy: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mobileStartText: { flex: 1, fontFamily: typography.family, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  arrivalOrbit: { alignItems: 'center', justifyContent: 'center' },
  formCard: { borderWidth: 1, borderRadius: radii.xl, padding: 26, gap: 20, shadowColor: '#123E42', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  formStage: { gap: 20 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  stepEyebrow: { fontFamily: typography.family, fontSize: 10, lineHeight: 14, fontWeight: '800', letterSpacing: 1.05 },
  stepLabel: { marginTop: 2, fontFamily: typography.family, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  stepBars: { flex: 1, maxWidth: 190, flexDirection: 'row', gap: 7 },
  stepBar: { flex: 1, height: 5, borderRadius: 3, overflow: 'hidden' },
  stepBarFill: { width: '100%', height: '100%', borderRadius: 3 },
  formTitle: { fontFamily: typography.family, fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6 },
  formDescription: { marginTop: 7, fontFamily: typography.family, fontSize: 15, lineHeight: 23 },
  trustList: { gap: 12 },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trustIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trustText: { flex: 1, fontFamily: typography.family, fontSize: 14, lineHeight: 20 },
  fields: { gap: 17 },
  fieldGroup: { gap: 7 },
  label: { fontFamily: typography.family, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  inputFrame: { minHeight: 54, borderRadius: radii.md },
  input: { minHeight: 52, borderRadius: radii.md, borderWidth: 0, paddingHorizontal: 15, fontFamily: typography.family, fontSize: 16 },
  fieldError: { fontFamily: typography.family, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  errorSlot: { minHeight: 18 },
  lockedInput: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lockedCode: { flex: 1, minWidth: 0, fontFamily: typography.mono, fontSize: 14, lineHeight: 20, fontWeight: '700', letterSpacing: 0.7 },
  helper: { fontFamily: typography.family, fontSize: 12, lineHeight: 18 },
  terms: { textAlign: 'center', fontFamily: typography.family, fontSize: 12, lineHeight: 18 },
  mobileTrace: { gap: 12 },
});
