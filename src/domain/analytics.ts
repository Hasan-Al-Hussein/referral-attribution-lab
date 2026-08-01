import {
  isValidReferralCode,
  normalizeReferralCode,
  REFERRAL_CODE_INVALID,
  REFERRAL_CODE_UNAVAILABLE,
} from './referral';

import type { AttributionKind } from './referral';

export const REQUIRED_REFERRAL_EVENTS = [
  'referral_link_generated',
  'referral_link_shared',
  'referral_link_clicked',
  'referral_signup_started',
  'referral_signup_completed',
] as const;

export const ANALYTICS_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export const FAILURE_REFERRAL_EVENTS = [
  'referral_link_generation_failed',
  'referral_link_share_cancelled',
  'referral_link_share_failed',
  'referral_deeplink_resolution_failed',
  'referral_code_rejected',
  'referral_signup_failed',
  'referral_state_cleanup_failed',
  'referral_duplicate_suppressed',
] as const;

export const REFERRAL_DIAGNOSTIC_REASONS = [
  'authentication_required',
  'code_generation_failed',
  'invalid_generated_code',
  'link_generation_failed',
  'invalid_generated_url',
  'user_dismissed',
  'share_provider_failed',
  'provider_error',
  'missing_code',
  'invalid_code',
  'unsupported_destination',
  'signup_referral_already_frozen',
  'signup_already_started',
  'callback_replayed',
  'signup_code_mismatch',
  'frozen_code_mismatch',
  'signup_not_started',
  'referral_acceptance_failed',
  'accepted_cleanup_failed',
  'callback_processing_failed',
  'subscription_failed',
  'pending_restore_failed',
] as const;

export type RequiredReferralEventName = (typeof REQUIRED_REFERRAL_EVENTS)[number];
export type FailureReferralEventName = (typeof FAILURE_REFERRAL_EVENTS)[number];
export type ReferralEventName = RequiredReferralEventName | FailureReferralEventName;
export type ReferralDiagnosticReason = (typeof REFERRAL_DIAGNOSTIC_REASONS)[number];
export type PlatformName = 'android' | 'ios' | 'web' | 'windows' | 'macos' | 'unknown';

export interface ReferralEventProperties {
  referral_code: string;
  platform: PlatformName;
  event_id: string;
  flow_id: string;
  occurred_at_utc: string;
  schema_version: number;
  app_version: string;
  attribution_kind?: AttributionKind;
  reason?: string;
  share_channel?: string;
  is_first_session?: boolean;
  match_guaranteed?: boolean;
}

export interface ReferralEventRecord {
  name: ReferralEventName;
  properties: ReferralEventProperties;
}

export interface AnalyticsClient {
  logEvent(event: ReferralEventRecord): Promise<void>;
}

const allReferralEvents = new Set<string>([
  ...REQUIRED_REFERRAL_EVENTS,
  ...FAILURE_REFERRAL_EVENTS,
]);
const requiredReferralEvents = new Set<string>(REQUIRED_REFERRAL_EVENTS);
const platformNames = new Set<string>(['android', 'ios', 'web', 'windows', 'macos', 'unknown']);
const attributionKinds = new Set<string>(['direct', 'deferred', 'demo-direct', 'demo-deferred']);
const diagnosticReasons = new Set<string>(REFERRAL_DIAGNOSTIC_REASONS);
const shareChannels = new Set<string>(['native-share', 'web-share', 'clipboard']);
const eventIdPattern = /^evt_[a-f0-9]{32}$/;
const flowIdPattern = /^[a-z0-9:_-]+$/i;
const eventKeys = new Set(['name', 'properties']);
const propertyKeys = new Set([
  'referral_code',
  'platform',
  'event_id',
  'flow_id',
  'occurred_at_utc',
  'schema_version',
  'app_version',
  'attribution_kind',
  'reason',
  'share_channel',
  'is_first_session',
  'match_guaranteed',
]);

export function isRequiredReferralEventName(
  value: ReferralEventName,
): value is RequiredReferralEventName {
  return requiredReferralEvents.has(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

export function isReferralEventRecord(value: unknown): value is ReferralEventRecord {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  const name = event.name;
  const properties = event.properties;
  if (Object.keys(event).some((key) => !eventKeys.has(key))) return false;
  if (typeof name !== 'string' || !allReferralEvents.has(name)) return false;
  if (!properties || typeof properties !== 'object') return false;

  const payload = properties as Record<string, unknown>;
  if (Object.keys(payload).some((key) => !propertyKeys.has(key))) return false;
  const referralCode = payload.referral_code;
  const isNormalizedCode =
    typeof referralCode === 'string' && normalizeReferralCode(referralCode) === referralCode;
  const codeIsAllowed = requiredReferralEvents.has(name)
    ? isNormalizedCode && isValidReferralCode(referralCode)
    : (isNormalizedCode && isValidReferralCode(referralCode)) ||
      referralCode === REFERRAL_CODE_UNAVAILABLE ||
      referralCode === REFERRAL_CODE_INVALID;
  const occurredAt = payload.occurred_at_utc;

  return (
    codeIsAllowed &&
    typeof payload.platform === 'string' &&
    platformNames.has(payload.platform) &&
    typeof payload.event_id === 'string' &&
    eventIdPattern.test(payload.event_id) &&
    isBoundedString(payload.flow_id, 160) &&
    flowIdPattern.test(payload.flow_id) &&
    typeof occurredAt === 'string' &&
    Number.isFinite(Date.parse(occurredAt)) &&
    payload.schema_version === ANALYTICS_SCHEMA_VERSION &&
    payload.app_version === APP_VERSION &&
    (payload.attribution_kind === undefined ||
      (typeof payload.attribution_kind === 'string' &&
        attributionKinds.has(payload.attribution_kind))) &&
    (payload.reason === undefined ||
      (typeof payload.reason === 'string' && diagnosticReasons.has(payload.reason))) &&
    (payload.share_channel === undefined ||
      (typeof payload.share_channel === 'string' &&
        shareChannels.has(payload.share_channel))) &&
    (payload.is_first_session === undefined || typeof payload.is_first_session === 'boolean') &&
    (payload.match_guaranteed === undefined || typeof payload.match_guaranteed === 'boolean')
  );
}

export function hasSameAnalyticsIdentity(
  first: ReferralEventRecord,
  second: ReferralEventRecord,
): boolean {
  const firstProperties = first.properties;
  const secondProperties = second.properties;
  return (
    first.name === second.name &&
    firstProperties.flow_id === secondProperties.flow_id &&
    firstProperties.referral_code === secondProperties.referral_code &&
    firstProperties.platform === secondProperties.platform &&
    firstProperties.schema_version === secondProperties.schema_version &&
    firstProperties.app_version === secondProperties.app_version &&
    firstProperties.attribution_kind === secondProperties.attribution_kind &&
    firstProperties.is_first_session === secondProperties.is_first_session &&
    firstProperties.match_guaranteed === secondProperties.match_guaranteed &&
    firstProperties.share_channel === secondProperties.share_channel &&
    firstProperties.reason === secondProperties.reason
  );
}
