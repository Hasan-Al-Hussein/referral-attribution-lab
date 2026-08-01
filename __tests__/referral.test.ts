import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import * as Crypto from 'expo-crypto';

import {
  isLoopbackDemoUrl,
  isShareableReferralUrl,
  parseStoredReferralAttribution,
  REFERRAL_DESTINATION,
  parseReferralAttribution,
  stableHash,
  type RawDeepLinkEvent,
} from '../src/domain/referral';

const DIRECT_CODE = 'RAL-ABCD2345';
const NOW = new Date('2026-07-31T12:00:00.000Z');

beforeAll(() => {
  jest.spyOn(Crypto, 'digestStringAsync').mockImplementation(async (_algorithm, value) =>
    createHash('sha256').update(value).digest('hex'),
  );
});

afterAll(() => {
  jest.restoreAllMocks();
});

function branchEvent(overrides: Partial<RawDeepLinkEvent> = {}): RawDeepLinkEvent {
  return {
    uri: 'https://referral-lab.test-app.link/referral',
    params: {
      '+clicked_branch_link': true,
      '+is_first_session': false,
      '+click_timestamp': '1774958400',
      $deeplink_path: REFERRAL_DESTINATION,
      referral_code: DIRECT_CODE,
    },
    ...overrides,
  };
}

describe('parseReferralAttribution', () => {
  it.each([
    { firstSession: false, expectedKind: 'direct' },
    { firstSession: true, expectedKind: 'deferred' },
  ] as const)('accepts a valid $expectedKind Branch attribution', async ({ firstSession, expectedKind }) => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          '+is_first_session': firstSession,
          '+click_timestamp': '1774958400',
          $deeplink_path: REFERRAL_DESTINATION,
          referral_code: ' ral-abcd2345 ',
        },
      }),
      () => NOW,
    );

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('Expected an accepted attribution');

    expect(result.attribution).toMatchObject({
      referralCode: DIRECT_CODE,
      destination: REFERRAL_DESTINATION,
      kind: expectedKind,
      uri: 'https://referral-lab.test-app.link/referral',
      receivedAt: NOW.toISOString(),
    });
    expect(result.attribution.fingerprint).toMatch(/^fp_[a-f0-9]{32}$/);
  });

  it('rejects a missing referral code', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'missing_code',
      referralCode: 'UNAVAILABLE',
    });
  });

  it('rejects a malformed referral code after normalizing it', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
          referral_code: ' bad-code ',
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_code',
      referralCode: 'INVALID',
    });
  });

  it('rejects a valid code aimed at an unsupported destination', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: 'payments/transfer',
          referral_code: DIRECT_CODE,
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'unsupported_destination',
      referralCode: DIRECT_CODE,
      detail: 'payments/transfer',
    });
  });

  it('ignores a session that was not opened by a Branch click', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': false,
          referral_code: DIRECT_CODE,
        },
      }),
    );

    expect(result).toEqual({ status: 'ignored', reason: 'not_a_branch_click' });
  });

  it('redacts malformed and oversized payload values from telemetry-safe parse results', async () => {
    const sensitiveValue = `${'demo@example.com'.repeat(300)}-secret`;
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          referral_code: sensitiveValue,
        },
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      reason: 'invalid_code',
      referralCode: 'INVALID',
    });
    expect(JSON.stringify(result)).not.toContain('demo@example.com');
  });

  it('classifies provider errors without exposing malformed referral input', async () => {
    expect(
      await parseReferralAttribution({
        error: 'provider detail remains local',
        params: { referral_code: 'email@example.com' },
      }),
    ).toEqual({
      status: 'rejected',
      reason: 'provider_error',
      referralCode: 'INVALID',
      detail: 'provider detail remains local',
    });
  });

  it('captures Branch match certainty when the provider supplies it', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        params: {
          '+clicked_branch_link': true,
          '+is_first_session': true,
          '+match_guaranteed': false,
          referral_code: DIRECT_CODE,
        },
      }),
      () => NOW,
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.attribution).toMatchObject({
        kind: 'deferred',
        matchGuaranteed: false,
      });
    }
  });

  it('strips callback query and fragment data before persisting attribution', async () => {
    const result = await parseReferralAttribution(
      branchEvent({
        uri: 'https://referral-lab.test-app.link/referral?email=demo@example.com#private',
      }),
      () => NOW,
    );

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.attribution.uri).toBe('https://referral-lab.test-app.link/referral');
      expect(JSON.stringify(result.attribution)).not.toContain('demo@example.com');
    }
  });

  it('canonicalizes a real numeric Branch click timestamp identically to its string form', async () => {
    const numeric = await parseReferralAttribution(
      branchEvent({ params: { ...branchEvent().params, '+click_timestamp': 1774958400 } }),
      () => NOW,
    );
    const string = await parseReferralAttribution(branchEvent(), () => NOW);

    expect(numeric.status).toBe('accepted');
    expect(string.status).toBe('accepted');
    if (numeric.status === 'accepted' && string.status === 'accepted') {
      expect(numeric.attribution.fingerprint).toBe(string.attribution.fingerprint);
    }
  });

  it('keeps distinct genuine clicks on the same canonical URI separate by timestamp', async () => {
    const first = await parseReferralAttribution(
      branchEvent({ params: { ...branchEvent().params, '+click_timestamp': 1774958400 } }),
      () => NOW,
    );
    const second = await parseReferralAttribution(
      branchEvent({ params: { ...branchEvent().params, '+click_timestamp': 1774958401 } }),
      () => NOW,
    );

    expect(first.status).toBe('accepted');
    expect(second.status).toBe('accepted');
    if (first.status === 'accepted' && second.status === 'accepted') {
      expect(first.attribution.fingerprint).not.toBe(second.attribution.fingerprint);
    }
  });

  it('separates the supplied legacy 32-bit collision while preserving replay stability', async () => {
    const oldInput = (timestamp: string) =>
      [DIRECT_CODE, timestamp, 'https://referral-lab.test-app.link/referral', 'direct'].join('|');
    expect(stableHash(oldInput('10839909398915967361'))).toBe(
      stableHash(oldInput('13112062373858213305')),
    );

    const firstEvent = branchEvent({
      params: { ...branchEvent().params, '+click_timestamp': '10839909398915967361' },
    });
    const secondEvent = branchEvent({
      params: { ...branchEvent().params, '+click_timestamp': '13112062373858213305' },
    });
    const [first, replay, second] = await Promise.all([
      parseReferralAttribution(firstEvent, () => NOW),
      parseReferralAttribution(firstEvent, () => new Date(NOW.getTime() + 1_000)),
      parseReferralAttribution(secondEvent, () => NOW),
    ]);

    expect(first.status).toBe('accepted');
    expect(replay.status).toBe('accepted');
    expect(second.status).toBe('accepted');
    if (first.status === 'accepted' && replay.status === 'accepted' && second.status === 'accepted') {
      expect(first.attribution.fingerprint).toBe(replay.attribution.fingerprint);
      expect(first.attribution.fingerprint).not.toBe(second.attribution.fingerprint);
    }
  });
});

describe('persisted attribution validation', () => {
  const validAttribution = {
    referralCode: DIRECT_CODE,
    destination: REFERRAL_DESTINATION,
    kind: 'deferred' as const,
    fingerprint: 'abc1234',
    receivedAt: NOW.toISOString(),
    uri: 'https://referral-lab.test-app.link/referral',
    matchGuaranteed: true,
  };

  it('accepts a recent, complete attribution record', () => {
    expect(parseStoredReferralAttribution(validAttribution, () => NOW)).toEqual(
      validAttribution,
    );
  });

  it('accepts a legacy seven-character fingerprint only as persisted compatibility', () => {
    expect(parseStoredReferralAttribution(validAttribution, () => NOW)?.fingerprint).toBe(
      'abc1234',
    );
  });

  it.each([
    ['stale', { ...validAttribution, receivedAt: '2026-06-01T00:00:00.000Z' }],
    ['future-dated', { ...validAttribution, receivedAt: '2026-08-02T00:00:00.000Z' }],
    ['wrong destination', { ...validAttribution, destination: 'payments/transfer' }],
    ['bad fingerprint', { ...validAttribution, fingerprint: 'not-valid' }],
    ['oversized URI', { ...validAttribution, uri: `https://referral-lab.test/${'x'.repeat(2_100)}` }],
  ])('rejects %s persisted input', (_label, value) => {
    expect(parseStoredReferralAttribution(value, () => NOW)).toBeNull();
  });
});

describe('shareable referral URLs', () => {
  it.each(['https://referral-lab.test-app.link/r/code', 'https://example.test/?referral_code=RAL-ABCD2345'])(
    'accepts an HTTPS link: %s',
    (value) => expect(isShareableReferralUrl(value)).toBe(true),
  );

  it.each([
    'http://localhost:8765/?referral_code=RAL-ABCD2345',
    'http://127.0.0.1:4173/?referral_code=RAL-ABCD2345',
    'http://[::1]:19006/?referral_code=RAL-ABCD2345',
  ])('classifies loopback HTTP links only as local demo URLs: %s', (value) => {
    expect(isShareableReferralUrl(value)).toBe(false);
    expect(isLoopbackDemoUrl(value)).toBe(true);
  });

  it('does not classify lookalike or non-HTTP hosts as loopback demo URLs', () => {
    expect(isLoopbackDemoUrl('http://localhost.example/referral')).toBe(false);
    expect(isLoopbackDemoUrl('https://localhost/referral')).toBe(false);
  });

  it.each(['', 'not a URL', 'http://insecure.example/r/code', 'referrallab://onboarding'])(
    'rejects an unusable link: %s',
    (value) => expect(isShareableReferralUrl(value)).toBe(false),
  );
});
