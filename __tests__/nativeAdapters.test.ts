import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { Share } from 'react-native';
import branch from 'react-native-branch';

import { FirebaseAnalyticsClient } from '../src/services/analytics/analyticsClient.native';
import { BranchDeepLinkService } from '../src/services/deepLinks/deepLinkService.native';
import { NativeShareService } from '../src/services/share/shareService.native';

jest.mock('react-native-branch', () => ({
  __esModule: true,
  default: {
    createBranchUniversalObject: jest.fn(),
    subscribe: jest.fn(),
  },
}));

jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: jest.fn(() => ({ app: 'analytics-test-double' })),
  logEvent: jest.fn(() => Promise.resolve()),
}));

const mockCreateBranchUniversalObject = jest.mocked(branch.createBranchUniversalObject);
const mockBranchSubscribe = jest.mocked(branch.subscribe);
const mockGetAnalytics = jest.mocked(getAnalytics);
const mockLogEvent = jest.mocked(logEvent);

afterEach(() => {
  jest.restoreAllMocks();
  mockCreateBranchUniversalObject.mockReset();
  mockBranchSubscribe.mockReset();
  mockGetAnalytics.mockClear();
  mockLogEvent.mockClear();
});

describe('native Branch adapter', () => {
  it('creates the expected Branch payload and always releases the universal object', async () => {
    const release = jest.fn();
    const generateShortUrl = jest.fn(() =>
      Promise.resolve({ url: 'https://referral-lab.test-app.link/referral' }),
    );
    mockCreateBranchUniversalObject.mockResolvedValue({ generateShortUrl, release } as never);

    const service = new BranchDeepLinkService();
    await expect(service.createReferralLink('RAL-ABCD2345')).resolves.toBe(
      'https://referral-lab.test-app.link/referral',
    );

    expect(mockCreateBranchUniversalObject).toHaveBeenCalledWith(
      'referral/RAL-ABCD2345',
      expect.objectContaining({
        contentMetadata: { customMetadata: { referral_code: 'RAL-ABCD2345' } },
      }),
    );
    expect(generateShortUrl).toHaveBeenCalledWith(
      {
        feature: 'referral',
        channel: 'in_app_share',
        campaign: 'member_referral',
      },
      {
        $deeplink_path: 'onboarding/referral',
        $ios_nativelink: 'true',
        referral_code: 'RAL-ABCD2345',
      },
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the Branch object when short-link generation fails', async () => {
    const release = jest.fn();
    mockCreateBranchUniversalObject.mockResolvedValue(
      {
        generateShortUrl: jest.fn(() => Promise.reject(new Error('Branch unavailable'))),
        release,
      } as never,
    );

    await expect(
      new BranchDeepLinkService().createReferralLink('RAL-ABCD2345'),
    ).rejects.toThrow('Branch unavailable');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('forwards cached/cold or later/warm subscription callbacks without navigation', () => {
    const unsubscribe = jest.fn();
    mockBranchSubscribe.mockReturnValue(unsubscribe);
    const listener = jest.fn();
    const service = new BranchDeepLinkService();

    expect(service.subscribe(listener)).toBe(unsubscribe);
    const subscription = mockBranchSubscribe.mock.calls[0]?.[0] as {
      onOpenStart(): void;
      onOpenComplete(event: {
        error?: string;
        params?: Record<string, unknown>;
        uri?: string;
      }): void;
    };
    expect(subscription.onOpenStart()).toBeUndefined();
    subscription.onOpenComplete({
      uri: 'https://referral-lab.test-app.link/referral',
      params: { referral_code: 'RAL-ABCD2345' },
    });
    expect(listener).toHaveBeenCalledWith({
      uri: 'https://referral-lab.test-app.link/referral',
      params: { referral_code: 'RAL-ABCD2345' },
    });
  });

  it.each([
    { kind: 'direct' as const, code: 'RAL-ABCD2345', firstSession: false },
    { kind: 'deferred' as const, code: 'RAL-ABCD2345', firstSession: true },
    { kind: 'invalid' as const, code: 'BAD-CODE', firstSession: false },
  ])('labels the $kind demo fixture without claiming provider delivery', ({
    kind,
    code,
    firstSession,
  }) => {
    mockBranchSubscribe.mockReturnValue(jest.fn());
    const listener = jest.fn();
    const service = new BranchDeepLinkService();
    service.subscribe(listener);

    service.simulate(kind, 'RAL-ABCD2345');

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          __demo: true,
          '+is_first_session': firstSession,
          referral_code: code,
        }),
      }),
    );
  });
});

describe('native Firebase adapter', () => {
  it('uses the modular React Native Firebase call signature', async () => {
    const event = {
      name: 'referral_link_generated' as const,
      properties: {
        referral_code: 'RAL-ABCD2345',
        platform: 'android' as const,
        event_id: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        flow_id: 'referrer:RAL-ABCD2345',
        occurred_at_utc: '2026-07-31T12:00:00.000Z',
        schema_version: 1,
        app_version: '1.0.0',
        is_first_session: true,
        match_guaranteed: false,
      },
    };

    await new FirebaseAnalyticsClient().logEvent(event);

    expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    expect(mockLogEvent).toHaveBeenCalledWith(
      { app: 'analytics-test-double' },
      event.name,
      {
        ...event.properties,
        is_first_session: 1,
        match_guaranteed: 0,
      },
    );
  });
});

describe('native share adapter', () => {
  it.each([
    {
      action: Share.sharedAction,
      expected: { status: 'shared' as const, channel: 'native-share' as const },
    },
    { action: Share.dismissedAction, expected: { status: 'cancelled' as const } },
  ])('maps platform action $action truthfully', async ({ action, expected }) => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action });

    await expect(
      new NativeShareService().shareReferral(
        'https://referral-lab.test-app.link/referral',
        'RAL-ABCD2345',
      ),
    ).resolves.toEqual(expected);
  });

  it('maps a thrown platform error to a failed outcome', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('chooser unavailable'));

    await expect(
      new NativeShareService().shareReferral(
        'https://referral-lab.test-app.link/referral',
        'RAL-ABCD2345',
      ),
    ).resolves.toEqual({ status: 'failed', reason: 'chooser unavailable' });
  });
});
