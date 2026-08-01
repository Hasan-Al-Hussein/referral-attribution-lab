import {
  REQUIRED_REFERRAL_EVENTS,
  type ReferralEventRecord,
  type RequiredReferralEventName,
} from '../domain/analytics';

import type { AnalyticsDelivery } from '../services/analytics/AnalyticsTracker';

export interface ReferralLedgerEntry {
  event: ReferralEventRecord;
  delivery: AnalyticsDelivery;
}

const requiredMilestones = new Set<string>(REQUIRED_REFERRAL_EVENTS);
const referrerMilestones = new Set<RequiredReferralEventName>([
  'referral_link_generated',
  'referral_link_shared',
]);

function inviteeFingerprint(flowId: string): string | undefined {
  return flowId.startsWith('invitee:') ? flowId.slice('invitee:'.length) : undefined;
}

function belongsToJourney(
  entry: ReferralLedgerEntry,
  referralCode: string,
  referralFingerprint?: string | null,
): boolean {
  const { properties } = entry.event;
  if (properties.referral_code !== referralCode) return false;
  const eventFingerprint = inviteeFingerprint(properties.flow_id);
  if (!eventFingerprint) return true;
  return Boolean(referralFingerprint && eventFingerprint === referralFingerprint);
}

export function scopeReferralEntries<T extends ReferralLedgerEntry>(
  entries: readonly T[],
  referralCode?: string | null,
  referralFingerprint?: string | null,
): T[] {
  const scopedCode = referralCode ?? entries[0]?.event.properties.referral_code;
  if (!scopedCode) return [];
  const scopedFingerprint =
    referralFingerprint ??
    (referralCode ? undefined : inviteeFingerprint(entries[0]?.event.properties.flow_id ?? ''));
  return entries.filter((entry) => belongsToJourney(entry, scopedCode, scopedFingerprint));
}

export function getAcceptedReferralMilestones(
  entries: readonly ReferralLedgerEntry[],
  referralCode: string,
  referralFingerprint?: string | null,
): Set<RequiredReferralEventName> {
  const accepted = new Set<RequiredReferralEventName>();
  for (const { event, delivery } of entries) {
    if (
      delivery === 'accepted' &&
      belongsToJourney({ event, delivery }, referralCode, referralFingerprint) &&
      requiredMilestones.has(event.name)
    ) {
      const name = event.name as RequiredReferralEventName;
      if (
        referrerMilestones.has(name) ||
        event.properties.flow_id === `invitee:${referralFingerprint ?? ''}`
      ) {
        accepted.add(name);
      }
    }
  }
  return accepted;
}
