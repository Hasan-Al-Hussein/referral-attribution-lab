import { createHash } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import * as Crypto from 'expo-crypto';

import { commitDemoReset } from '../src/application/commitDemoReset';
import {
  isReferralLifecycleCancelled,
  ReferralCoordinator,
  type SignupResult,
} from '../src/application/ReferralCoordinator';
import {
  REFERRAL_DESTINATION,
  type RawDeepLinkEvent,
  type ReferralAttribution,
} from '../src/domain/referral';
import { AnalyticsTracker } from '../src/services/analytics/AnalyticsTracker';
import { withTimeout } from '../src/services/operationTimeout';

import type {
  AnalyticsClient,
  ReferralEventName,
  ReferralEventRecord,
} from '../src/domain/analytics';
import type { DeepLinkService } from '../src/services/deepLinks/deepLinkService';
import type { MockReferralApi } from '../src/services/referrals/mockReferralApi';
import type { ShareResult, ShareService } from '../src/services/share/shareService';
import type {
  AcceptedReferralOutcome,
  ReferralAcceptanceReceipt,
  ReferralStorage,
} from '../src/services/storage/referralStorage';

const CODE_A = 'RAL-ABCD2345';
const CODE_B = 'RAL-ZYXW9876';
const FIXED_NOW = new Date('2026-07-31T12:00:00.000Z');

beforeAll(() => {
  jest.spyOn(Crypto, 'digestStringAsync').mockImplementation(async (_algorithm, value) =>
    createHash('sha256').update(value).digest('hex'),
  );
});

afterAll(() => {
  jest.restoreAllMocks();
});

class MemoryStorage implements ReferralStorage {
  readonly operations: string[];
  readonly processedAttributions = new Set<string>();
  readonly milestones = new Set<string>();
  readonly acceptedAnalyticsEvents: ReferralEventRecord[] = [];
  readonly pendingAnalyticsEvents = new Map<string, ReferralEventRecord>();
  readonly signupReceipts = new Map<string, ReferralAcceptanceReceipt>();
  acceptedOutcome: AcceptedReferralOutcome | null = null;
  resetCleanupGate: Promise<void> | undefined;
  getPendingError: Error | undefined;
  savePendingError: Error | undefined;
  completeJourneyFailuresRemaining = 0;
  savePendingGate: Promise<void> | undefined;
  onSavePendingStart: (() => void) | undefined;
  freezeGate: Promise<void> | undefined;
  onFreezeStart: (() => void) | undefined;
  markProcessedGate: Promise<void> | undefined;
  completeJourneyGate: Promise<void> | undefined;
  onCompleteJourneyStart: (() => void) | undefined;
  reservePendingAnalyticsError: Error | undefined;
  saveAcceptedOutcomeError: Error | undefined;
  saveAcceptedOutcomeGate: Promise<void> | undefined;
  analyticsStorageDelayMs = 0;
  resetGate: Promise<void> | undefined;
  private readonly generatedCodes = new Map<string, string>();
  private pendingAttribution: ReferralAttribution | null = null;
  private frozenAttribution: ReferralAttribution | null = null;
  private epoch = 0;

  constructor(operations: string[] = []) {
    this.operations = operations;
  }

  async getGeneratedCode(userId: string): Promise<string | null> {
    return this.generatedCodes.get(userId) ?? null;
  }

  async setGeneratedCode(userId: string, code: string): Promise<void> {
    this.generatedCodes.set(userId, code);
  }

  async getPendingAttribution(): Promise<ReferralAttribution | null> {
    if (this.getPendingError) throw this.getPendingError;
    return this.pendingAttribution;
  }

  async savePendingAttribution(attribution: ReferralAttribution): Promise<void> {
    const epoch = this.epoch;
    this.onSavePendingStart?.();
    if (this.savePendingGate) await this.savePendingGate;
    if (this.savePendingError) throw this.savePendingError;
    if (epoch !== this.epoch) return;
    this.operations.push('storage:save-pending');
    this.pendingAttribution = attribution;
  }

  async clearPendingAttribution(): Promise<void> {
    this.operations.push('storage:clear-pending');
    this.pendingAttribution = null;
  }

  async getFrozenAttribution(): Promise<ReferralAttribution | null> {
    return this.frozenAttribution;
  }

  async freezeAttribution(attribution: ReferralAttribution): Promise<void> {
    this.onFreezeStart?.();
    if (this.freezeGate) await this.freezeGate;
    this.operations.push('storage:freeze-attribution');
    this.frozenAttribution = attribution;
  }

  async completeReferralJourney(attribution: ReferralAttribution): Promise<void> {
    this.onCompleteJourneyStart?.();
    if (this.completeJourneyGate) await this.completeJourneyGate;
    this.operations.push('storage:complete-journey');
    if (this.completeJourneyFailuresRemaining > 0) {
      this.completeJourneyFailuresRemaining -= 1;
      throw new Error('cleanup unavailable');
    }
    if (this.frozenAttribution?.fingerprint !== attribution.fingerprint) {
      throw new Error('frozen attribution changed');
    }
    this.pendingAttribution = null;
    this.frozenAttribution = null;
  }

  async hasProcessedAttribution(fingerprint: string): Promise<boolean> {
    return this.processedAttributions.has(fingerprint);
  }

  async markAttributionProcessed(fingerprint: string): Promise<void> {
    if (this.markProcessedGate) await this.markProcessedGate;
    this.operations.push('storage:mark-processed');
    this.processedAttributions.add(fingerprint);
  }

  async hasMilestone(key: string): Promise<boolean> {
    await this.delayAnalyticsStorage();
    return this.milestones.has(key);
  }

  async markMilestone(key: string, event: ReferralEventRecord): Promise<void> {
    await this.delayAnalyticsStorage();
    this.operations.push('storage:mark-milestone');
    this.milestones.add(key);
    this.acceptedAnalyticsEvents.push(event);
  }

  async getAcceptedAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return this.acceptedAnalyticsEvents;
  }

  async getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return [...this.pendingAnalyticsEvents.values()];
  }

  async reservePendingAnalyticsEvent(event: ReferralEventRecord): Promise<ReferralEventRecord> {
    await this.delayAnalyticsStorage();
    if (this.reservePendingAnalyticsError) throw this.reservePendingAnalyticsError;
    const existing = [...this.pendingAnalyticsEvents.values()].find(
      (candidate) =>
        candidate.name === event.name &&
        candidate.properties.flow_id === event.properties.flow_id,
    );
    if (existing) return existing;
    this.operations.push('storage:save-analytics');
    this.pendingAnalyticsEvents.set(event.properties.event_id, event);
    return event;
  }

  async removePendingAnalyticsEvent(eventId: string): Promise<void> {
    await this.delayAnalyticsStorage();
    this.operations.push('storage:remove-analytics');
    this.pendingAnalyticsEvents.delete(eventId);
  }

  async getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null> {
    return this.signupReceipts.get(idempotencyKey) ?? null;
  }

  async createSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<ReferralAcceptanceReceipt> {
    const existing = this.signupReceipts.get(idempotencyKey);
    if (existing) return existing;
    this.signupReceipts.set(idempotencyKey, receipt);
    return receipt;
  }

  async getAcceptedReferralOutcome(): Promise<AcceptedReferralOutcome | null> {
    return this.acceptedOutcome;
  }

  async saveAcceptedReferralOutcome(outcome: AcceptedReferralOutcome): Promise<void> {
    if (this.saveAcceptedOutcomeGate) await this.saveAcceptedOutcomeGate;
    if (this.saveAcceptedOutcomeError) throw this.saveAcceptedOutcomeError;
    this.acceptedOutcome = outcome;
  }

  private async delayAnalyticsStorage(): Promise<void> {
    if (this.analyticsStorageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.analyticsStorageDelayMs));
    }
  }

  async resetDemoState(timeoutMs = 5_000): Promise<void> {
    if (this.resetGate) {
      await withTimeout(this.resetGate, 'active referral epoch publication', timeoutMs);
    }
    this.epoch += 1;
    this.generatedCodes.clear();
    this.pendingAttribution = null;
    this.frozenAttribution = null;
    this.processedAttributions.clear();
    this.milestones.clear();
    this.acceptedAnalyticsEvents.length = 0;
    this.pendingAnalyticsEvents.clear();
    this.signupReceipts.clear();
    this.acceptedOutcome = null;
    if (this.resetCleanupGate) {
      try {
        await withTimeout(
          this.resetCleanupGate,
          'retired referral epoch cleanup',
          timeoutMs,
        );
      } catch {
        // Cleanup follows the durable commit and is non-critical.
      }
    }
  }
}

class MemoryAnalyticsClient implements AnalyticsClient {
  readonly attempts: ReferralEventRecord[] = [];
  readonly events: ReferralEventRecord[] = [];
  readonly failingEvents = new Set<ReferralEventName>();
  gate: Promise<void> | undefined;
  delayMs = 0;

  constructor(private readonly operations: string[]) {}

  async logEvent(event: ReferralEventRecord): Promise<void> {
    this.operations.push(`analytics:${event.name}`);
    this.attempts.push(event);
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.gate) await this.gate;
    if (this.failingEvents.has(event.name)) throw new Error('Analytics unavailable');
    this.events.push(event);
  }
}

class FakeDeepLinkService implements DeepLinkService {
  readonly mode: DeepLinkService['mode'];
  createError: Error | undefined;
  createdUrl: string | undefined;
  subscribeError: Error | undefined;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  private listener: ((event: RawDeepLinkEvent) => void) | undefined;

  constructor(mode: DeepLinkService['mode'] = 'web-demo') {
    this.mode = mode;
  }

  async createReferralLink(referralCode: string): Promise<string> {
    if (this.createError) throw this.createError;
    return this.createdUrl ?? `https://referral-lab.test-app.link/r/${referralCode}`;
  }

  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void {
    this.subscribeCalls += 1;
    if (this.subscribeError) throw this.subscribeError;
    this.listener = listener;
    return () => {
      this.unsubscribeCalls += 1;
      this.listener = undefined;
    };
  }

  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    this.listener?.(validBranchEvent(kind === 'deferred', kind === 'invalid' ? 'BAD-CODE' : referralCode));
  }

  emit(event: RawDeepLinkEvent): void {
    this.listener?.(event);
  }
}

class FakeReferralApi implements MockReferralApi {
  readonly acceptedReferrals: { code: string; email: string; idempotencyKey: string }[] = [];
  generatedCode = CODE_A;
  acceptError: Error | undefined;
  generationGate: Promise<void> | undefined;
  acceptanceGate: Promise<void> | undefined;
  private lifecycle = 0;

  constructor(private readonly storage: MemoryStorage) {}

  async getOrCreateCode(): Promise<string> {
    const lifecycle = this.lifecycle;
    if (this.generationGate) await this.generationGate;
    if (lifecycle !== this.lifecycle) throw new Error('generation cancelled');
    return this.generatedCode;
  }

  async acceptReferral(
    code: string,
    email: string,
    idempotencyKey: string,
  ): Promise<{ accountId: string }> {
    const lifecycle = this.lifecycle;
    this.acceptedReferrals.push({ code, email, idempotencyKey });
    if (this.acceptanceGate) await this.acceptanceGate;
    if (lifecycle !== this.lifecycle) throw new Error('acceptance cancelled');
    if (this.acceptError) throw this.acceptError;
    const receipt = await this.storage.createSignupReceipt(idempotencyKey, {
      accountId: 'acct_test123',
      referralCode: code,
    });
    return { accountId: receipt.accountId };
  }

  resetLifecycle(): void {
    this.lifecycle += 1;
  }
}

class FakeShareService implements ShareService {
  result: ShareResult = { status: 'shared', channel: 'native-share' };
  thrownError: Error | undefined;
  gate: Promise<void> | undefined;

  async shareReferral(): Promise<ShareResult> {
    if (this.gate) await this.gate;
    if (this.thrownError) throw this.thrownError;
    return this.result;
  }
}

interface Harness {
  coordinator: ReferralCoordinator;
  storage: MemoryStorage;
  analyticsClient: MemoryAnalyticsClient;
  deepLinks: FakeDeepLinkService;
  referralApi: FakeReferralApi;
  shareService: FakeShareService;
  operations: string[];
}

function createHarness(
  timeoutMs = 10_000,
  createEventId?: () => string,
  existingStorage?: MemoryStorage,
  deepLinkMode: DeepLinkService['mode'] = 'web-demo',
): Harness {
  const operations: string[] = [];
  const storage = existingStorage ?? new MemoryStorage(operations);
  const analyticsClient = new MemoryAnalyticsClient(operations);
  let eventSequence = 0;
  const analytics = new AnalyticsTracker(
    analyticsClient,
    storage,
    'android',
    () => FIXED_NOW,
    createEventId ?? (() => {
      eventSequence += 1;
      return eventSequence.toString(16).padStart(32, '0');
    }),
    timeoutMs,
  );
  const deepLinks = new FakeDeepLinkService(deepLinkMode);
  const referralApi = new FakeReferralApi(storage);
  const shareService = new FakeShareService();
  const coordinator = new ReferralCoordinator(
    deepLinks,
    analytics,
    storage,
    referralApi,
    shareService,
    'android',
    timeoutMs,
  );
  return {
    coordinator,
    storage,
    analyticsClient,
    deepLinks,
    referralApi,
    shareService,
    operations,
  };
}

function validBranchEvent(deferred = false, referralCode = CODE_A): RawDeepLinkEvent {
  return {
    uri: `https://referral-lab.test-app.link/r/${referralCode}`,
    params: {
      '+clicked_branch_link': true,
      '+is_first_session': deferred,
      '+click_timestamp': '1774958400',
      $deeplink_path: REFERRAL_DESTINATION,
      referral_code: referralCode,
    },
  };
}

function attributionFor(referralCode = CODE_A, deferred = false): ReferralAttribution {
  const kind = deferred ? 'deferred' : 'direct';
  const uri = `https://referral-lab.test-app.link/r/${referralCode}`;
  const fingerprintInput = [referralCode, '1774958400', uri, kind].join('|');
  return {
    referralCode,
    destination: REFERRAL_DESTINATION,
    kind,
    fingerprint: `fp_${createHash('sha256').update(fingerprintInput).digest('hex').slice(0, 32)}`,
    uri,
    receivedAt: FIXED_NOW.toISOString(),
  };
}

function eventsNamed(client: MemoryAnalyticsClient, name: ReferralEventName): ReferralEventRecord[] {
  return client.events.filter((event) => event.name === name);
}

function completedEvent(
  attribution: ReferralAttribution,
  eventId = 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
): ReferralEventRecord {
  return {
    name: 'referral_signup_completed',
    properties: {
      referral_code: attribution.referralCode,
      platform: 'android',
      event_id: eventId,
      flow_id: `invitee:${attribution.fingerprint}`,
      occurred_at_utc: FIXED_NOW.toISOString(),
      schema_version: 1,
      app_version: '1.0.0',
      attribution_kind: attribution.kind,
      is_first_session:
        attribution.kind === 'deferred' || attribution.kind === 'demo-deferred',
    },
  };
}

async function settleAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('ReferralCoordinator', () => {
  it.each([
    { deferred: false, kind: 'direct', firstSession: false },
    { deferred: true, kind: 'deferred', firstSession: true },
  ] as const)(
    'accepts, tracks, and routes a valid $kind attribution',
    async ({ deferred, kind, firstSession }) => {
      const { coordinator, analyticsClient } = createHarness();
      const navigated: ReferralAttribution[] = [];
      coordinator.setNavigator((attribution) => navigated.push(attribution));

      await coordinator.handleDeepLink(validBranchEvent(deferred));

      expect(navigated).toHaveLength(1);
      expect(navigated[0]).toMatchObject({ referralCode: CODE_A, kind });
      expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
      expect(eventsNamed(analyticsClient, 'referral_link_clicked')[0]?.properties).toMatchObject({
        referral_code: CODE_A,
        platform: 'android',
        attribution_kind: kind,
        is_first_session: firstSession,
      });
    },
  );

  it('persists an accepted attribution before analytics and routing', async () => {
    const { coordinator, storage, operations } = createHarness();
    let pendingAtRoute: Promise<ReferralAttribution | null> | undefined;
    coordinator.setNavigator(() => {
      pendingAtRoute = storage.getPendingAttribution();
      operations.push('navigation:referral-onboarding');
    });

    await coordinator.handleDeepLink(validBranchEvent());

    const saveIndex = operations.indexOf('storage:save-pending');
    const analyticsIndex = operations.indexOf('analytics:referral_link_clicked');
    const routeIndex = operations.indexOf('navigation:referral-onboarding');
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(analyticsIndex).toBeGreaterThan(saveIndex);
    expect(routeIndex).toBeGreaterThan(analyticsIndex);
    await expect(pendingAtRoute).resolves.toMatchObject({ referralCode: CODE_A });
  });

  it.each([
    {
      label: 'missing code',
      event: {
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: REFERRAL_DESTINATION,
        },
      },
      reason: 'missing_code',
      rejectionEventCount: 1,
    },
    {
      label: 'invalid code',
      event: validBranchEvent(false, 'BAD-CODE'),
      reason: 'invalid_code',
      rejectionEventCount: 1,
    },
    {
      label: 'unsupported destination',
      event: {
        params: {
          '+clicked_branch_link': true,
          $deeplink_path: 'payments/transfer',
          referral_code: CODE_A,
        },
      },
      reason: 'unsupported_destination',
      rejectionEventCount: 0,
    },
  ])('rejects $label without persisting or routing', async ({ event, reason, rejectionEventCount }) => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    await coordinator.handleDeepLink(event);

    expect(navigated).toHaveLength(0);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_deeplink_resolution_failed')[0]?.properties.reason).toBe(
      reason,
    );
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(rejectionEventCount);
  });

  it('suppresses duplicate click analytics while recording the replay', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    const event = validBranchEvent();

    await coordinator.handleDeepLink(event);
    await coordinator.handleDeepLink(event);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')[0]?.properties).toMatchObject({
      referral_code: CODE_A,
      platform: 'android',
      reason: 'callback_replayed',
    });
    expect(storage.processedAttributions.size).toBe(1);
    expect(navigated).toHaveLength(1);
  });

  it('serializes concurrent duplicate callbacks into one click and one route', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    const event = validBranchEvent();

    await Promise.all([
      coordinator.handleDeepLink(event),
      coordinator.handleDeepLink(event),
      coordinator.handleDeepLink(event),
    ]);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')).toHaveLength(2);
    expect(storage.processedAttributions.size).toBe(1);
    expect(navigated).toHaveLength(1);
  });

  it('isolates distinct concurrent codes and leaves the newest pending before signup', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    await Promise.all([
      coordinator.handleDeepLink(validBranchEvent(false, CODE_A)),
      coordinator.handleDeepLink(validBranchEvent(false, CODE_B)),
    ]);

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(2);
    expect(
      eventsNamed(analyticsClient, 'referral_link_clicked').map(
        ({ properties }) => properties.referral_code,
      ),
    ).toEqual([CODE_A, CODE_B]);
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: CODE_B,
    });
    expect(navigated.map(({ referralCode }) => referralCode)).toEqual([CODE_A, CODE_B]);
  });

  it('emits the complete required funnel with common analytics properties', async () => {
    const { coordinator, analyticsClient, referralApi, storage } = createHarness();
    const generated = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(generated);
    await coordinator.handleDeepLink(validBranchEvent());
    const attribution = attributionFor();
    await coordinator.beginSignup(CODE_A, attribution);
    const result = await coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution);

    expect(analyticsClient.events.map((event) => event.name)).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
      'referral_signup_started',
      'referral_signup_completed',
    ]);
    for (const event of analyticsClient.events) {
      expect(event.properties).toMatchObject({
        referral_code: CODE_A,
        platform: 'android',
        occurred_at_utc: FIXED_NOW.toISOString(),
        schema_version: 1,
        app_version: '1.0.0',
      });
      expect(event.properties.event_id).toMatch(/^evt_[a-f0-9]{32}$/);
      expect(event.properties.flow_id).toBeTruthy();
    }
    expect(eventsNamed(analyticsClient, 'referral_link_shared')[0]?.properties.share_channel).toBe(
      'native-share',
    );
    expect(referralApi.acceptedReferrals).toEqual([
      {
        code: CODE_A,
        email: 'new.user@example.com',
        idempotencyKey: `signup:${attribution.fingerprint}`,
      },
    ]);
    expect(result).toEqual({
      accountId: 'acct_test123',
      referralCode: CODE_A,
      referralFingerprint: attribution.fingerprint,
    });
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    await expect(storage.getFrozenAttribution()).resolves.toBeNull();
  });

  it('records deliberate repeat shares as distinct user attempts', async () => {
    const { coordinator, analyticsClient } = createHarness();
    const generated = await coordinator.generateReferral('authenticated-user-1');

    await coordinator.shareReferral(generated);
    await coordinator.shareReferral(generated);

    const shares = eventsNamed(analyticsClient, 'referral_link_shared');
    expect(shares).toHaveLength(2);
    expect(shares[0]?.properties.event_id).not.toBe(shares[1]?.properties.event_id);
    expect(shares[0]?.properties.flow_id).not.toBe(shares[1]?.properties.flow_id);
  });

  it.each([
    {
      label: 'cancelled',
      result: { status: 'cancelled' } as ShareResult,
      expectedEvent: 'referral_link_share_cancelled' as const,
    },
    {
      label: 'failed',
      result: { status: 'failed', reason: 'chooser included sensitive detail' } as ShareResult,
      expectedEvent: 'referral_link_share_failed' as const,
    },
  ])('does not count a $label share as shared', async ({ result, expectedEvent }) => {
    const { coordinator, shareService, analyticsClient } = createHarness();
    shareService.result = result;

    await expect(
      coordinator.shareReferral({ referralCode: CODE_A, url: 'https://referral-lab.test/r' }),
    ).resolves.toEqual(result);
    expect(eventsNamed(analyticsClient, 'referral_link_shared')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, expectedEvent)).toHaveLength(1);
    expect(JSON.stringify(analyticsClient.events)).not.toContain('sensitive detail');
  });

  it('converts a rejected share provider promise into an observable failed result', async () => {
    const { coordinator, shareService, analyticsClient } = createHarness();
    shareService.thrownError = new Error('chooser unavailable');

    await expect(
      coordinator.shareReferral({ referralCode: CODE_A, url: 'https://referral-lab.test/r' }),
    ).resolves.toEqual({ status: 'failed', reason: 'chooser unavailable' });
    expect(eventsNamed(analyticsClient, 'referral_link_share_failed')).toHaveLength(1);
  });

  it('freezes the referral code at signup start and ignores later code substitution', async () => {
    const { coordinator, referralApi, analyticsClient, storage } = createHarness();
    const attribution = attributionFor(CODE_A);
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((nextAttribution) => navigated.push(nextAttribution));

    await coordinator.handleDeepLink(validBranchEvent(false, CODE_A));
    navigated.length = 0;
    await expect(coordinator.beginSignup(CODE_A, attribution)).resolves.toBe(CODE_A);
    await coordinator.handleDeepLink(validBranchEvent(false, CODE_B));
    const result = await coordinator.completeSignup(CODE_B, 'new.user@example.com', attribution);

    expect(navigated).toHaveLength(0);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')[0]?.properties).toMatchObject({
      referral_code: CODE_B,
      reason: 'signup_referral_already_frozen',
    });
    expect(referralApi.acceptedReferrals[0]?.code).toBe(CODE_A);
    expect(result.referralCode).toBe(CODE_A);
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')[0]?.properties.referral_code).toBe(
      CODE_A,
    );
  });

  it('retains recovery state and logs failure when signup completion fails', async () => {
    const { coordinator, referralApi, storage, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    referralApi.acceptError = new Error('Referral endpoint unavailable');

    await expect(
      coordinator.completeSignup(CODE_B, 'new.user@example.com', attribution),
    ).rejects.toThrow('Referral endpoint unavailable');

    await expect(storage.getPendingAttribution()).resolves.toMatchObject({ referralCode: CODE_A });
    await expect(storage.getFrozenAttribution()).resolves.toMatchObject({
      referralCode: CODE_A,
      fingerprint: attribution.fingerprint,
    });
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')[0]?.properties).toMatchObject({
      referral_code: CODE_A,
      platform: 'android',
      attribution_kind: 'direct',
      reason: 'referral_acceptance_failed',
    });
  });

  it('returns backend success when atomic cleanup fails and retries cleanup without a failure event', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    storage.completeJourneyFailuresRemaining = 1;

    await expect(
      coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution),
    ).resolves.toEqual({
      accountId: 'acct_test123',
      referralCode: CODE_A,
      referralFingerprint: attribution.fingerprint,
    });
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_state_cleanup_failed')).toHaveLength(1);
    await expect(storage.getPendingAttribution()).resolves.toBeTruthy();
    await expect(storage.getFrozenAttribution()).resolves.toBeTruthy();

    coordinator.start();
    await settleAsyncWork();
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    await expect(storage.getFrozenAttribution()).resolves.toBeNull();
  });

  it('serializes link intake behind signup freeze so a competing journey cannot replace or route', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const attributionA = attributionFor(CODE_A);
    await storage.savePendingAttribution(attributionA);
    const freezeStarted = deferred();
    const releaseFreeze = deferred();
    storage.onFreezeStart = freezeStarted.resolve;
    storage.freezeGate = releaseFreeze.promise;
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    const signupStart = coordinator.beginSignup(CODE_A, attributionA);
    await freezeStarted.promise;
    const competingLink = coordinator.handleDeepLink(validBranchEvent(false, CODE_B));
    await settleAsyncWork();
    expect(navigated).toHaveLength(0);

    releaseFreeze.resolve();
    await expect(signupStart).resolves.toBe(CODE_A);
    await expect(competingLink).resolves.toBeUndefined();

    await expect(storage.getPendingAttribution()).resolves.toEqual(attributionA);
    await expect(storage.getFrozenAttribution()).resolves.toEqual(attributionA);
    expect(navigated).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')[0]?.properties).toMatchObject({
      referral_code: CODE_B,
      reason: 'signup_referral_already_frozen',
    });
  });

  it.each([
    'uuid',
    'outbox',
  ] as const)('returns the same accepted receipt when completion %s instrumentation fails', async (failure) => {
    let failEventIds = false;
    let sequence = 0;
    const { coordinator, storage, analyticsClient, referralApi } = createHarness(
      10_000,
      () => {
        if (failEventIds) throw new Error('UUID unavailable');
        sequence += 1;
        return sequence.toString(16).padStart(32, '0');
      },
    );
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    if (failure === 'uuid') failEventIds = true;
    else storage.reservePendingAnalyticsError = new Error('outbox unavailable');

    const first = await coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution);
    failEventIds = false;
    storage.reservePendingAnalyticsError = undefined;
    const retry = await coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution);

    expect(first).toEqual(retry);
    expect(first.accountId).toBe('acct_test123');
    expect(storage.signupReceipts.size).toBe(1);
    expect(new Set([...storage.signupReceipts.values()].map(({ accountId }) => accountId))).toEqual(
      new Set(['acct_test123']),
    );
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')).toHaveLength(0);
    expect(referralApi.acceptedReferrals).toHaveLength(2);
  });

  it('returns accepted success after completion analytics times out and retries the same receipt', async () => {
    jest.useFakeTimers();
    const { coordinator, analyticsClient, storage } = createHarness(50);
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    analyticsClient.gate = new Promise<void>(() => undefined);

    const completion = coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution);
    await jest.advanceTimersByTimeAsync(50);
    await expect(completion).resolves.toMatchObject({ accountId: 'acct_test123' });
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')).toHaveLength(0);

    analyticsClient.gate = undefined;
    await expect(
      coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution),
    ).resolves.toMatchObject({ accountId: 'acct_test123' });
    expect(storage.signupReceipts.size).toBe(1);
  });

  it('keeps generate, share, start, and complete successful when analytics stages are individually in budget', async () => {
    jest.useFakeTimers();
    const { coordinator, storage, analyticsClient } = createHarness(50);
    storage.analyticsStorageDelayMs = 30;
    analyticsClient.delayMs = 30;

    const generation = coordinator.generateReferral('authenticated-user');
    await jest.advanceTimersByTimeAsync(250);
    const generated = await generation;

    const sharing = coordinator.shareReferral(generated);
    await jest.advanceTimersByTimeAsync(250);
    await expect(sharing).resolves.toMatchObject({ status: 'shared' });

    const intake = coordinator.handleDeepLink(validBranchEvent());
    await jest.advanceTimersByTimeAsync(250);
    await intake;
    const attribution = attributionFor();

    const start = coordinator.beginSignup(CODE_A, attribution);
    await jest.advanceTimersByTimeAsync(250);
    await expect(start).resolves.toBe(CODE_A);

    const completion = coordinator.completeSignup(CODE_A, 'accepted@example.com', attribution);
    await jest.advanceTimersByTimeAsync(250);
    await expect(completion).resolves.toMatchObject({ accountId: 'acct_test123' });
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')).toHaveLength(0);
  });

  it('routes once when a processed marker times out, lands late, and the callback retries warm', async () => {
    jest.useFakeTimers();
    const { coordinator, storage, analyticsClient } = createHarness(50);
    const markerGate = deferred();
    storage.markProcessedGate = markerGate.promise;
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    const first = coordinator.handleDeepLink(validBranchEvent()).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toBeInstanceOf(Error);
    expect(navigated).toHaveLength(1);

    markerGate.resolve();
    await jest.advanceTimersByTimeAsync(0);
    storage.markProcessedGate = undefined;
    await coordinator.handleDeepLink(validBranchEvent());

    expect(navigated).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')).toHaveLength(1);
  });

  it('continues outbox flush and pending-route recovery when provider subscription throws', async () => {
    const { coordinator, storage, analyticsClient, deepLinks } = createHarness();
    const pending = attributionFor();
    await storage.savePendingAttribution(pending);
    const queued = completedEvent(pending);
    storage.pendingAnalyticsEvents.set(queued.properties.event_id, queued);
    deepLinks.subscribeError = new Error('native Branch unavailable');
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    coordinator.start();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(navigated).toEqual([pending]);
    expect(analyticsClient.events).toContainEqual(queued);
    expect(
      eventsNamed(analyticsClient, 'referral_deeplink_resolution_failed')[0]?.properties.reason,
    ).toBe('subscription_failed');
  });

  it('bounds a hung fingerprint digest and reset opens a fresh journey queue', async () => {
    jest.useFakeTimers();
    const { coordinator, deepLinks, analyticsClient } = createHarness(50);
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    coordinator.start();
    jest.mocked(Crypto.digestStringAsync).mockImplementationOnce(
      () => new Promise<string>(() => undefined),
    );

    deepLinks.emit(validBranchEvent());
    await jest.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(
      eventsNamed(analyticsClient, 'referral_deeplink_resolution_failed').some(
        ({ properties }) => properties.reason === 'callback_processing_failed',
      ),
    ).toBe(true);
    expect(navigated).toHaveLength(0);

    await coordinator.resetDemoState();
    deepLinks.emit(validBranchEvent());
    await jest.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    expect(navigated).toHaveLength(1);
  });

  it('recovers Success after a post-receipt/pre-analytics restart without another account', async () => {
    const storage = new MemoryStorage();
    const attribution = attributionFor();
    await storage.savePendingAttribution(attribution);
    await storage.freezeAttribution(attribution);
    await storage.createSignupReceipt(`signup:${attribution.fingerprint}`, {
      accountId: 'acct_test123',
      referralCode: CODE_A,
    });
    const restarted = createHarness(10_000, undefined, storage);
    const recovered: SignupResult[] = [];
    restarted.coordinator.setNavigator(() => undefined, (result) => recovered.push(result));

    restarted.coordinator.start();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(recovered).toEqual([
      {
        accountId: 'acct_test123',
        referralCode: CODE_A,
        referralFingerprint: attribution.fingerprint,
      },
    ]);
    expect(eventsNamed(restarted.analyticsClient, 'referral_signup_completed')).toHaveLength(1);
    expect(restarted.referralApi.acceptedReferrals).toHaveLength(0);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
  });

  it('recovers Success after analytics/pre-cleanup restart without duplicate delivery', async () => {
    const storage = new MemoryStorage();
    const attribution = attributionFor();
    const event = completedEvent(attribution);
    await storage.savePendingAttribution(attribution);
    await storage.freezeAttribution(attribution);
    await storage.createSignupReceipt(`signup:${attribution.fingerprint}`, {
      accountId: 'acct_test123',
      referralCode: CODE_A,
    });
    await storage.markMilestone(`${event.properties.flow_id}:${event.name}`, event);
    const restarted = createHarness(10_000, undefined, storage);
    const recovered: SignupResult[] = [];
    restarted.coordinator.setNavigator(() => undefined, (result) => recovered.push(result));

    restarted.coordinator.start();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(recovered).toHaveLength(1);
    expect(eventsNamed(restarted.analyticsClient, 'referral_signup_completed')).toHaveLength(0);
    expect(storage.acceptedAnalyticsEvents.filter(({ name }) => name === event.name)).toHaveLength(1);
    expect(restarted.referralApi.acceptedReferrals).toHaveLength(0);
  });

  it('recovers Success from a retained outcome after cleanup/pre-navigation restart', async () => {
    const storage = new MemoryStorage();
    const attribution = attributionFor();
    const event = completedEvent(attribution);
    await storage.savePendingAttribution(attribution);
    await storage.freezeAttribution(attribution);
    await storage.createSignupReceipt(`signup:${attribution.fingerprint}`, {
      accountId: 'acct_test123',
      referralCode: CODE_A,
    });
    await storage.saveAcceptedReferralOutcome({
      accountId: 'acct_test123',
      referralCode: CODE_A,
      attribution,
    });
    await storage.markMilestone(`${event.properties.flow_id}:${event.name}`, event);
    await storage.completeReferralJourney(attribution);
    const restarted = createHarness(10_000, undefined, storage);
    const recovered: SignupResult[] = [];
    restarted.coordinator.setNavigator(() => undefined, (result) => recovered.push(result));

    restarted.coordinator.start();
    await settleAsyncWork();
    await settleAsyncWork();

    expect(recovered).toHaveLength(1);
    expect(eventsNamed(restarted.analyticsClient, 'referral_signup_completed')).toHaveLength(0);
    expect(restarted.referralApi.acceptedReferrals).toHaveLength(0);
  });

  it('cancels stale navigable success when reset occurs during post-commit analytics', async () => {
    const { coordinator, storage, analyticsClient, referralApi } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    const analyticsGate = deferred();
    analyticsClient.gate = analyticsGate.promise;
    const navigable: SignupResult[] = [];
    const completion = coordinator
      .completeSignup(CODE_A, 'accepted@example.com', attribution)
      .then((result) => navigable.push(result))
      .catch((error: unknown) => error);
    await settleAsyncWork();

    await coordinator.resetDemoState();
    analyticsGate.resolve();

    const outcome = await completion;
    expect(isReferralLifecycleCancelled(outcome)).toBe(true);
    expect(navigable).toHaveLength(0);
    expect(referralApi.acceptedReferrals).toHaveLength(1);
    expect(storage.acceptedOutcome).toBeNull();
  });

  it('cancels stale navigable success when reset occurs during post-commit cleanup', async () => {
    const { coordinator, storage, referralApi } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    const cleanupStarted = deferred();
    const cleanupGate = deferred();
    storage.onCompleteJourneyStart = cleanupStarted.resolve;
    storage.completeJourneyGate = cleanupGate.promise;
    const navigable: SignupResult[] = [];
    const completion = coordinator
      .completeSignup(CODE_A, 'accepted@example.com', attribution)
      .then((result) => navigable.push(result))
      .catch((error: unknown) => error);
    await cleanupStarted.promise;

    await coordinator.resetDemoState();
    cleanupGate.resolve();

    const outcome = await completion;
    expect(isReferralLifecycleCancelled(outcome)).toBe(true);
    expect(navigable).toHaveLength(0);
    expect(referralApi.acceptedReferrals).toHaveLength(1);
  });

  it('rejects same-code attribution substitution with a different fingerprint', async () => {
    const { coordinator, referralApi, analyticsClient } = createHarness();
    const original = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, original);
    const substituted = { ...original, fingerprint: 'other01' };

    await expect(
      coordinator.completeSignup(CODE_A, 'new@example.com', substituted),
    ).rejects.toThrow('persisted referral attribution');
    expect(referralApi.acceptedReferrals).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')[0]?.properties.reason).toBe(
      'frozen_code_mismatch',
    );
  });

  it('keeps a pending referral retryable when click analytics delivery fails', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    analyticsClient.failingEvents.add('referral_link_clicked');

    await coordinator.handleDeepLink(validBranchEvent());

    await expect(storage.getPendingAttribution()).resolves.toMatchObject({ referralCode: CODE_A });
    expect(storage.processedAttributions.size).toBe(0);
    expect(navigated).toHaveLength(1);
    expect(analyticsClient.attempts.map((event) => event.name)).toContain('referral_link_clicked');
  });

  it('logs generation failure with a referral code and platform context', async () => {
    const { coordinator, deepLinks, analyticsClient } = createHarness();
    deepLinks.createError = new Error('Branch unavailable');

    await expect(coordinator.generateReferral('authenticated-user-1')).rejects.toThrow(
      'Branch unavailable',
    );

    expect(eventsNamed(analyticsClient, 'referral_link_generation_failed')[0]?.properties).toMatchObject(
      {
        referral_code: CODE_A,
        platform: 'android',
        reason: 'link_generation_failed',
      },
    );
  });

  it('suppresses a new same-code callback after signup has already frozen attribution', async () => {
    const { coordinator, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);

    await coordinator.handleDeepLink(validBranchEvent());

    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_duplicate_suppressed')[0]?.properties.reason).toBe(
      'signup_already_started',
    );
  });

  it('rejects starting another attribution when a different code is already frozen', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const attributionA = attributionFor(CODE_A);
    await storage.savePendingAttribution(attributionA);
    await storage.freezeAttribution(attributionFor(CODE_B));

    await expect(coordinator.beginSignup(CODE_A, attributionA)).rejects.toThrow(
      'Another referral is already attached',
    );
    expect(eventsNamed(analyticsClient, 'referral_signup_started')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('rejects unauthenticated generation and unusable provider URLs without success events', async () => {
    const { coordinator, deepLinks, analyticsClient } = createHarness();

    await expect(coordinator.generateReferral('  ')).rejects.toThrow(
      'Authenticated member identity is required.',
    );
    deepLinks.createdUrl = 'http://insecure.example/referral';
    await expect(coordinator.generateReferral('authenticated-user-1')).rejects.toThrow(
      'unusable URL',
    );

    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(0);
    expect(
      eventsNamed(analyticsClient, 'referral_link_generation_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toEqual(['authentication_required', 'invalid_generated_url']);
  });

  it('accepts loopback HTTP only for the credential-free web demo adapter', async () => {
    const webHarness = createHarness();
    webHarness.deepLinks.createdUrl = 'http://localhost:8765/referral';

    await expect(
      webHarness.coordinator.generateReferral('authenticated-web-user'),
    ).resolves.toEqual({
      referralCode: expect.stringMatching(/^RAL-/),
      url: 'http://localhost:8765/referral',
    });
    expect(eventsNamed(webHarness.analyticsClient, 'referral_link_generated')).toHaveLength(1);

    const nativeHarness = createHarness(10_000, undefined, undefined, 'native');
    nativeHarness.deepLinks.createdUrl = 'http://localhost:8765/referral';

    await expect(
      nativeHarness.coordinator.generateReferral('authenticated-native-user'),
    ).rejects.toThrow('unusable URL');
    expect(eventsNamed(nativeHarness.analyticsClient, 'referral_link_generated')).toHaveLength(0);
    expect(
      eventsNamed(nativeHarness.analyticsClient, 'referral_link_generation_failed')[0]?.properties
        .reason,
    ).toBe('invalid_generated_url');
  });

  it('coalesces concurrent generation for the same authenticated member', async () => {
    const { coordinator, analyticsClient } = createHarness();

    const [first, second] = await Promise.all([
      coordinator.generateReferral('authenticated-user-1'),
      coordinator.generateReferral('authenticated-user-1'),
    ]);

    expect(second).toEqual(first);
    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(1);
  });

  it('buffers a restored cold-start route until navigation is ready and unsubscribes cleanly', async () => {
    const { coordinator, storage, deepLinks } = createHarness();
    const pending = attributionFor(CODE_A, true);
    await storage.savePendingAttribution(pending);

    coordinator.start();
    coordinator.start();
    await settleAsyncWork();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    expect(navigated).toEqual([pending]);
    expect(deepLinks.subscribeCalls).toBe(1);
    coordinator.stop();
    coordinator.stop();
    expect(deepLinks.unsubscribeCalls).toBe(1);
    deepLinks.emit(validBranchEvent(false, CODE_B));
    await settleAsyncWork();
    expect(navigated).toHaveLength(1);
  });

  it('processes a subscribed warm callback and reports subscription setup failure', async () => {
    const warm = createHarness();
    const navigated: ReferralAttribution[] = [];
    warm.coordinator.setNavigator((attribution) => navigated.push(attribution));
    warm.coordinator.start();
    warm.deepLinks.emit(validBranchEvent());
    await settleAsyncWork();
    expect(navigated).toHaveLength(1);

    const failed = createHarness();
    failed.deepLinks.subscribeError = new Error('native module unavailable');
    failed.coordinator.start();
    await settleAsyncWork();
    expect(
      eventsNamed(failed.analyticsClient, 'referral_deeplink_resolution_failed')[0]
        ?.properties.reason,
    ).toBe('subscription_failed');
  });

  it('does not replay a buffered attribution after reset', async () => {
    const { coordinator } = createHarness();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.resetDemoState();
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    expect(navigated).toHaveLength(0);
  });

  it('makes reset a barrier against a delayed pending-attribution write and route', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const writeStarted = deferred();
    const releaseWrite = deferred();
    storage.onSavePendingStart = writeStarted.resolve;
    storage.savePendingGate = releaseWrite.promise;
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));

    const oldOperation = coordinator.handleDeepLink(validBranchEvent());
    const oldOutcome = oldOperation.then(
      () => undefined,
      (error: unknown) => error,
    );
    await writeStarted.promise;
    await coordinator.resetDemoState();
    releaseWrite.resolve();

    await expect(oldOutcome).resolves.toBeInstanceOf(Error);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_link_clicked')).toHaveLength(0);
    expect(navigated).toHaveLength(0);

    storage.savePendingGate = undefined;
    await coordinator.handleDeepLink(validBranchEvent(false, CODE_B));
    expect(navigated.at(-1)?.referralCode).toBe(CODE_B);
  });

  it('cancels delayed generation and sharing without recreating post-reset telemetry', async () => {
    const { coordinator, referralApi, shareService, analyticsClient } = createHarness();
    const generationGate = deferred();
    const shareGate = deferred();
    referralApi.generationGate = generationGate.promise;
    shareService.gate = shareGate.promise;
    const oldGeneration = coordinator.generateReferral('member-before-reset');
    const oldShare = coordinator.shareReferral({
      referralCode: CODE_A,
      url: 'https://referral-lab.test-app.link/r/RAL-ABCD2345',
    });
    const generationOutcome = oldGeneration.catch((error: unknown) => error);
    const shareOutcome = oldShare.catch((error: unknown) => error);
    await Promise.resolve();

    await coordinator.resetDemoState();
    generationGate.resolve();
    shareGate.resolve();

    await expect(generationOutcome).resolves.toBeInstanceOf(Error);
    await expect(shareOutcome).resolves.toBeInstanceOf(Error);
    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_link_shared')).toHaveLength(0);

    referralApi.generationGate = undefined;
    shareService.gate = undefined;
    referralApi.generatedCode = CODE_B;
    const fresh = await coordinator.generateReferral('member-after-reset');
    await coordinator.shareReferral(fresh);
    expect(fresh.referralCode).toBe(CODE_B);
    expect(eventsNamed(analyticsClient, 'referral_link_generated')).toHaveLength(1);
    expect(eventsNamed(analyticsClient, 'referral_link_shared')).toHaveLength(1);
  });

  it('cancels delayed backend acceptance without a receipt or late failure telemetry', async () => {
    const { coordinator, referralApi, storage, analyticsClient } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);
    const acceptanceGate = deferred();
    referralApi.acceptanceGate = acceptanceGate.promise;
    const completion = coordinator.completeSignup(CODE_A, 'new@example.com', attribution);
    const outcome = completion.catch((error: unknown) => error);
    await settleAsyncWork();

    await coordinator.resetDemoState();
    acceptanceGate.resolve();

    await expect(outcome).resolves.toBeInstanceOf(Error);
    expect(storage.signupReceipts.size).toBe(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_completed')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')).toHaveLength(0);
  });

  it('surfaces a never-settling reset dependency and recovers on an explicit retry', async () => {
    jest.useFakeTimers();
    const { coordinator, storage } = createHarness(50);
    storage.resetGate = new Promise<void>(() => undefined);

    const reset = coordinator.resetDemoState().catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(reset).resolves.toBeInstanceOf(Error);

    await expect(coordinator.handleDeepLink(validBranchEvent())).rejects.toThrow(
      'active referral epoch publication timed out',
    );

    storage.resetGate = undefined;
    await expect(coordinator.resetDemoState()).resolves.toBeUndefined();
    await expect(coordinator.handleDeepLink(validBranchEvent())).resolves.toBeUndefined();
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: CODE_A,
    });
  });

  it('does not cumulatively time out a committed reset with slow publication and hung cleanup', async () => {
    jest.useFakeTimers();
    const { coordinator, storage } = createHarness(50);
    storage.resetGate = new Promise<void>((resolve) => setTimeout(resolve, 40));
    storage.resetCleanupGate = new Promise<void>(() => undefined);
    const onCommitted = jest.fn();

    const reset = commitDemoReset(() => coordinator.resetDemoState(), onCommitted);
    await jest.advanceTimersByTimeAsync(90);

    await expect(reset).resolves.toEqual({ ok: true, committed: true });
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent completion into one backend acceptance', async () => {
    const { coordinator, referralApi } = createHarness();
    const attribution = attributionFor();
    await coordinator.handleDeepLink(validBranchEvent());
    await coordinator.beginSignup(CODE_A, attribution);

    const [first, second] = await Promise.all([
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution),
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attribution),
    ]);

    expect(second).toEqual(first);
    expect(referralApi.acceptedReferrals).toHaveLength(1);
  });

  it('rejects completion before signup starts without calling the backend', async () => {
    const { coordinator, referralApi, analyticsClient } = createHarness();

    await expect(
      coordinator.completeSignup(CODE_A, 'new.user@example.com', attributionFor()),
    ).rejects.toThrow('Signup must start');
    expect(referralApi.acceptedReferrals).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_signup_failed')[0]?.properties.reason).toBe(
      'signup_not_started',
    );
  });

  it('reports callback and pending-restore persistence failures from start', async () => {
    const callback = createHarness();
    callback.storage.savePendingError = new Error('storage write failed');
    callback.coordinator.start();
    callback.deepLinks.emit(validBranchEvent());
    await settleAsyncWork();
    expect(
      eventsNamed(callback.analyticsClient, 'referral_deeplink_resolution_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toContain('callback_processing_failed');

    const restore = createHarness();
    restore.storage.getPendingError = new Error('storage read failed');
    restore.coordinator.start();
    await settleAsyncWork();
    expect(
      eventsNamed(restore.analyticsClient, 'referral_deeplink_resolution_failed').map(
        ({ properties }) => properties.reason,
      ),
    ).toContain('pending_restore_failed');
  });

  it('exposes integration metadata and delegates demo simulation', async () => {
    const { coordinator, analyticsClient } = createHarness();
    coordinator.start();

    expect(coordinator.integrationMode).toBe('web-demo');
    expect(coordinator.platformName).toBe('android');
    coordinator.simulateLink('invalid', CODE_A);
    await settleAsyncWork();
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('rejects a mismatched code before signup freeze', async () => {
    const { coordinator, storage, analyticsClient } = createHarness();
    const attribution = attributionFor(CODE_A);

    await expect(coordinator.beginSignup(CODE_B, attribution)).rejects.toThrow(
      'does not match',
    );
    await expect(storage.getFrozenAttribution()).resolves.toBeNull();
    expect(eventsNamed(analyticsClient, 'referral_signup_started')).toHaveLength(0);
    expect(eventsNamed(analyticsClient, 'referral_code_rejected')).toHaveLength(1);
  });

  it('regresses reset into fresh generate/share/deferred, direct, and invalid journeys', async () => {
    const { coordinator, referralApi, analyticsClient, storage } = createHarness();
    const initial = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(initial);
    await coordinator.handleDeepLink(validBranchEvent(false, initial.referralCode));
    const initialAttribution = attributionFor(initial.referralCode);
    await coordinator.beginSignup(initial.referralCode, initialAttribution);
    await coordinator.completeSignup(
      initial.referralCode,
      'first@example.com',
      initialAttribution,
    );

    await coordinator.resetDemoState();
    const ledgerStart = analyticsClient.events.length;
    const navigated: ReferralAttribution[] = [];
    coordinator.setNavigator((attribution) => navigated.push(attribution));
    referralApi.generatedCode = CODE_B;
    const generated = await coordinator.generateReferral('authenticated-user-1');
    await coordinator.shareReferral(generated);
    const deferredEvent = validBranchEvent(true, generated.referralCode);
    await coordinator.handleDeepLink(deferredEvent);

    expect(generated.referralCode).toBe(CODE_B);
    expect(navigated.at(-1)).toMatchObject({
      referralCode: generated.referralCode,
      kind: 'deferred',
    });
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: generated.referralCode,
      kind: 'deferred',
    });
    expect(
      analyticsClient.events.slice(ledgerStart).map(({ name }) => name),
    ).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
    ]);

    await coordinator.resetDemoState();
    const directStart = analyticsClient.events.length;
    await coordinator.handleDeepLink(validBranchEvent(false, CODE_A));
    expect(navigated.at(-1)).toMatchObject({ referralCode: CODE_A, kind: 'direct' });
    expect(analyticsClient.events.slice(directStart).map(({ name }) => name)).toEqual([
      'referral_link_clicked',
    ]);
    await expect(storage.getPendingAttribution()).resolves.toMatchObject({
      referralCode: CODE_A,
      kind: 'direct',
    });

    await coordinator.resetDemoState();
    const invalidStart = analyticsClient.events.length;
    await coordinator.handleDeepLink(validBranchEvent(false, 'BAD-CODE'));
    expect(navigated).toHaveLength(2);
    expect(analyticsClient.events.slice(invalidStart).map(({ name }) => name)).toEqual([
      'referral_deeplink_resolution_failed',
      'referral_code_rejected',
    ]);
    await expect(storage.getPendingAttribution()).resolves.toBeNull();
  });
});
