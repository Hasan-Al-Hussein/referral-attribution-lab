import type { ReferralAttribution } from '../domain/referral';

export type RootStackParamList = {
  Invite: undefined;
  Onboarding: { attribution: ReferralAttribution };
  Success: { accountId: string; referralCode: string; referralFingerprint: string };
};
