import * as Crypto from 'expo-crypto';

export const REFERRAL_CODE_PATTERN = /^RAL-[A-HJ-NP-Z2-9]{8}$/;
export const REFERRAL_DESTINATION = 'onboarding/referral';
export const REFERRAL_CODE_UNAVAILABLE = 'UNAVAILABLE';
export const REFERRAL_CODE_INVALID = 'INVALID';

const ATTRIBUTION_KINDS = ['direct', 'deferred', 'demo-direct', 'demo-deferred'] as const;
const ATTRIBUTION_FINGERPRINT_PATTERN = /^(?:fp_[a-f0-9]{32}|[a-z0-9]{7})$/;
const MAX_CALLBACK_URI_LENGTH = 2_048;
const MAX_CALLBACK_TIMESTAMP_LENGTH = 20;
const MAX_PENDING_ATTRIBUTION_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type AttributionKind = 'direct' | 'deferred' | 'demo-direct' | 'demo-deferred';

export interface RawDeepLinkEvent {
  params?: Record<string, unknown>;
  uri?: string;
  error?: string;
}

export interface ReferralAttribution {
  referralCode: string;
  destination: typeof REFERRAL_DESTINATION;
  kind: AttributionKind;
  fingerprint: string;
  uri?: string;
  receivedAt: string;
  matchGuaranteed?: boolean;
}

export type AttributionParseResult =
  | { status: 'accepted'; attribution: ReferralAttribution }
  | { status: 'ignored'; reason: 'not_a_branch_click' }
  | {
      status: 'rejected';
      reason: 'provider_error' | 'missing_code' | 'invalid_code' | 'unsupported_destination';
      referralCode: string;
      detail?: string;
    };

export function normalizeReferralCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidReferralCode(value: unknown): value is string {
  return REFERRAL_CODE_PATTERN.test(normalizeReferralCode(value));
}

export function referralCodeForTelemetry(value: unknown): string {
  const normalized = normalizeReferralCode(value);
  if (!normalized) return REFERRAL_CODE_UNAVAILABLE;
  return REFERRAL_CODE_PATTERN.test(normalized) ? normalized : REFERRAL_CODE_INVALID;
}

export function isShareableReferralUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLoopbackDemoUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function asCallbackUri(value: unknown): string | undefined {
  const uri = asString(value);
  if (!uri || uri.length > MAX_CALLBACK_URI_LENGTH) return undefined;
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function asCallbackTimestamp(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > 1e20) return undefined;
    const canonical = String(value);
    return canonical.length <= MAX_CALLBACK_TIMESTAMP_LENGTH ? canonical : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || trimmed.length > MAX_CALLBACK_TIMESTAMP_LENGTH) {
    return undefined;
  }
  return trimmed.replace(/^0+(?=\d)/, '');
}

async function createAttributionFingerprint(value: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    value,
  );
  return `fp_${digest.slice(0, 32).toLowerCase()}`;
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export async function parseReferralAttribution(
  event: RawDeepLinkEvent,
  now: () => Date = () => new Date(),
): Promise<AttributionParseResult> {
  const params = event.params ?? {};
  const rawCode = params.referral_code ?? params.referralCode;
  const referralCode = referralCodeForTelemetry(rawCode);

  if (event.error) {
    return {
      status: 'rejected',
      reason: 'provider_error',
      referralCode,
      detail: event.error,
    };
  }

  const isDemo = asBoolean(params.__demo);
  if (!asBoolean(params['+clicked_branch_link']) && !isDemo) {
    return { status: 'ignored', reason: 'not_a_branch_click' };
  }

  if (!rawCode) {
    return { status: 'rejected', reason: 'missing_code', referralCode };
  }

  if (!isValidReferralCode(rawCode)) {
    return { status: 'rejected', reason: 'invalid_code', referralCode };
  }

  const destination = asString(params.$deeplink_path) ?? REFERRAL_DESTINATION;
  if (destination !== REFERRAL_DESTINATION) {
    return {
      status: 'rejected',
      reason: 'unsupported_destination',
      referralCode,
      detail: destination,
    };
  }

  const isDeferred = asBoolean(params['+is_first_session']);
  const matchGuaranteed = asOptionalBoolean(params['+match_guaranteed']);
  const kind: AttributionKind = isDemo
    ? isDeferred
      ? 'demo-deferred'
      : 'demo-direct'
    : isDeferred
      ? 'deferred'
      : 'direct';
  const normalizedCode = normalizeReferralCode(rawCode);
  const callbackUri = asCallbackUri(event.uri);
  const fingerprintInput = [
    normalizedCode,
    asCallbackTimestamp(params['+click_timestamp']) ?? 'no-timestamp',
    callbackUri ?? 'no-uri',
    kind,
  ].join('|');

  return {
    status: 'accepted',
    attribution: {
      referralCode: normalizedCode,
      destination: REFERRAL_DESTINATION,
      kind,
      fingerprint: await createAttributionFingerprint(fingerprintInput),
      ...(callbackUri ? { uri: callbackUri } : {}),
      receivedAt: now().toISOString(),
      ...(matchGuaranteed !== undefined ? { matchGuaranteed } : {}),
    },
  };
}

export function parseStoredReferralAttribution(
  value: unknown,
  now: () => Date = () => new Date(),
): ReferralAttribution | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const referralCode = normalizeReferralCode(candidate.referralCode);
  const receivedAt = asString(candidate.receivedAt);
  const receivedAtMilliseconds = receivedAt ? Date.parse(receivedAt) : Number.NaN;
  const ageMilliseconds = now().getTime() - receivedAtMilliseconds;
  const kind = candidate.kind;
  const fingerprint = candidate.fingerprint;
  const uri = asCallbackUri(candidate.uri);
  const matchGuaranteed = asOptionalBoolean(candidate.matchGuaranteed);

  if (
    !REFERRAL_CODE_PATTERN.test(referralCode) ||
    candidate.destination !== REFERRAL_DESTINATION ||
    !ATTRIBUTION_KINDS.includes(kind as AttributionKind) ||
    typeof fingerprint !== 'string' ||
    !ATTRIBUTION_FINGERPRINT_PATTERN.test(fingerprint) ||
    !receivedAt ||
    !Number.isFinite(receivedAtMilliseconds) ||
    ageMilliseconds > MAX_PENDING_ATTRIBUTION_AGE_MS ||
    ageMilliseconds < -MAX_CLOCK_SKEW_MS ||
    (candidate.uri !== undefined && !uri) ||
    (candidate.matchGuaranteed !== undefined && matchGuaranteed === undefined)
  ) {
    return null;
  }

  return {
    referralCode,
    destination: REFERRAL_DESTINATION,
    kind: kind as AttributionKind,
    fingerprint,
    receivedAt,
    ...(uri ? { uri } : {}),
    ...(matchGuaranteed !== undefined ? { matchGuaranteed } : {}),
  };
}
