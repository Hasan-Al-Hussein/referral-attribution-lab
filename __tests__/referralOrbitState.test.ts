import { describe, expect, it } from '@jest/globals';

import {
  getReferralOrbitState,
  REFERRAL_ORBIT_MILESTONES,
} from '../src/components/referralOrbitState';

import type { RequiredReferralEventName } from '../src/domain/analytics';

function accepted(
  ...events: readonly RequiredReferralEventName[]
): ReadonlySet<RequiredReferralEventName> {
  return new Set(events);
}

describe('referral orbit state', () => {
  it('maps a deferred clicked-only arrival to Click without implying prefix events', () => {
    expect(getReferralOrbitState(accepted('referral_link_clicked'))).toEqual({
      acceptedStages: [false, false, true, false, false],
      carrierTarget: 3,
      completedCount: 1,
      currentLabel: 'Click',
      latestActiveIndex: 2,
      milestoneKey: '00100',
    });
  });

  it('maps a normal prefix to the latest accepted stage', () => {
    expect(
      getReferralOrbitState(
        accepted(
          'referral_link_generated',
          'referral_link_shared',
          'referral_link_clicked',
        ),
      ),
    ).toMatchObject({
      acceptedStages: [true, true, true, false, false],
      carrierTarget: 3,
      completedCount: 3,
      currentLabel: 'Click',
      latestActiveIndex: 2,
      milestoneKey: '11100',
    });
  });

  it('keeps an empty journey ready at zero', () => {
    expect(getReferralOrbitState(accepted())).toMatchObject({
      acceptedStages: [false, false, false, false, false],
      carrierTarget: 0,
      completedCount: 0,
      currentLabel: 'Ready',
      latestActiveIndex: -1,
      milestoneKey: '00000',
    });
  });

  it('keeps the visual stage order aligned with the analytics contract', () => {
    expect(REFERRAL_ORBIT_MILESTONES.map(({ event }) => event)).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
      'referral_signup_started',
      'referral_signup_completed',
    ]);
  });
});
