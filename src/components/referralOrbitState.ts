import type { RequiredReferralEventName } from '../domain/analytics';

export const REFERRAL_ORBIT_MILESTONES = [
  { label: 'Create', event: 'referral_link_generated' },
  { label: 'Share', event: 'referral_link_shared' },
  { label: 'Click', event: 'referral_link_clicked' },
  { label: 'Start', event: 'referral_signup_started' },
  { label: 'Verify', event: 'referral_signup_completed' },
] as const satisfies readonly {
  label: string;
  event: RequiredReferralEventName;
}[];

export interface ReferralOrbitState {
  acceptedStages: readonly boolean[];
  carrierTarget: number;
  completedCount: number;
  currentLabel: string;
  latestActiveIndex: number;
  milestoneKey: string;
}

export function getReferralOrbitState(
  activeMilestones: ReadonlySet<RequiredReferralEventName>,
): ReferralOrbitState {
  const acceptedStages = REFERRAL_ORBIT_MILESTONES.map(({ event }) =>
    activeMilestones.has(event),
  );
  const latestActiveIndex = acceptedStages.lastIndexOf(true);

  return {
    acceptedStages,
    carrierTarget: latestActiveIndex + 1,
    completedCount: acceptedStages.filter(Boolean).length,
    currentLabel:
      latestActiveIndex >= 0
        ? REFERRAL_ORBIT_MILESTONES[latestActiveIndex]?.label ?? 'Ready'
        : 'Ready',
    latestActiveIndex,
    milestoneKey: acceptedStages.map((accepted) => (accepted ? '1' : '0')).join(''),
  };
}
