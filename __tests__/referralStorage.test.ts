import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { REFERRAL_DESTINATION } from '../src/domain/referral';
import { AnalyticsTracker } from '../src/services/analytics/AnalyticsTracker';
import {
  referralStorage,
  reloadReferralStorageRuntime,
} from '../src/services/storage/referralStorage';

import type { ReferralEventRecord } from '../src/domain/analytics';
import type { ReferralAttribution } from '../src/domain/referral';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-crypto', () => {
  let sequence = 0;
  return {
    randomUUID: () => {
      sequence += 1;
      return sequence.toString(16).padStart(32, '0');
    },
  };
});

const ACTIVE_EPOCH_KEY = '@referral-attribution-lab/active-epoch';
const JOURNEY_PREFIX = '@referral-attribution-lab/journey';
const CODE = 'RAL-ABCD2345';

function attribution(
  referralCode = CODE,
  fingerprint = 'abc1234',
  receivedAt = new Date().toISOString(),
): ReferralAttribution {
  return {
    referralCode,
    destination: REFERRAL_DESTINATION,
    kind: 'deferred',
    fingerprint,
    receivedAt,
  };
}

function event(
  eventId = 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  flowId = 'invitee:abc1234',
): ReferralEventRecord {
  return {
    name: 'referral_link_clicked',
    properties: {
      referral_code: CODE,
      platform: 'android',
      event_id: eventId,
      flow_id: flowId,
      occurred_at_utc: new Date().toISOString(),
      schema_version: 1,
      app_version: '1.0.0',
    },
  };
}

async function currentJourneyKey(): Promise<string> {
  const epoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
  if (!epoch) throw new Error('Test epoch was not initialized');
  return `${JOURNEY_PREFIX}:${epoch}`;
}

async function currentEpochKey(baseKey: string): Promise<string> {
  const epoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
  if (!epoch) throw new Error('Test epoch was not initialized');
  return `${baseKey}:${epoch}`;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  reloadReferralStorageRuntime();
  await referralStorage.resetDemoState();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('referralStorage', () => {
  it('removes malformed and stale pending or frozen attribution as one journey record', async () => {
    const key = await currentJourneyKey();
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        pending: { referralCode: 'email@example.com' },
        frozen: attribution(CODE, 'stale001', '2020-01-01T00:00:00.000Z'),
      }),
    );

    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(key)).resolves.toBeNull();

    const fresh = attribution(CODE, 'frsh001');
    await referralStorage.savePendingAttribution(fresh);
    await referralStorage.freezeAttribution(fresh);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(fresh);
  });

  it('serializes invalid cleanup with a concurrent valid write so cleanup cannot delete it', async () => {
    const key = await currentJourneyKey();
    await AsyncStorage.setItem(key, JSON.stringify({ pending: { referralCode: 'invalid' } }));
    const originalGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    if (!originalGetItem) throw new Error('AsyncStorage getItem mock is unavailable');
    const readStarted = deferred();
    const releaseRead = deferred();
    let gated = false;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (storageKey) => {
      if (storageKey === key && !gated) {
        gated = true;
        readStarted.resolve();
        await releaseRead.promise;
      }
      return originalGetItem(storageKey);
    });

    const invalidRead = referralStorage.getPendingAttribution();
    await readStarted.promise;
    const fresh = attribution(CODE, 'frsh002');
    const concurrentWrite = referralStorage.savePendingAttribution(fresh);
    releaseRead.resolve();

    await expect(invalidRead).resolves.toBeNull();
    await concurrentWrite;
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
  });

  it('keeps pending and frozen identity together when atomic completion cleanup fails', async () => {
    const journey = attribution();
    await referralStorage.savePendingAttribution(journey);
    await referralStorage.freezeAttribution(journey);
    const key = await currentJourneyKey();
    const originalRemove = jest.mocked(AsyncStorage.removeItem).getMockImplementation();
    if (!originalRemove) throw new Error('AsyncStorage removeItem mock is unavailable');
    let failOnce = true;
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementation(async (storageKey) => {
      if (storageKey === key && failOnce) {
        failOnce = false;
        throw new Error('injected cleanup failure');
      }
      return originalRemove(storageKey);
    });

    await expect(referralStorage.completeReferralJourney(journey)).rejects.toThrow(
      'injected cleanup failure',
    );
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(journey);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(journey);

    await referralStorage.completeReferralJourney(journey);
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
  });

  it('serializes concurrent bounded-set writes without losing unrelated values', async () => {
    await Promise.all([
      referralStorage.markAttributionProcessed('fingerprint-a'),
      referralStorage.markAttributionProcessed('fingerprint-b'),
      referralStorage.markMilestone('flow-a:clicked', event(undefined, 'flow-a')),
      referralStorage.markMilestone(
        'flow-b:clicked',
        event('evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'flow-b'),
      ),
    ]);

    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(true);
    await expect(referralStorage.hasProcessedAttribution('fingerprint-b')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('flow-b:clicked')).resolves.toBe(true);
    await expect(referralStorage.getAcceptedAnalyticsEvents()).resolves.toHaveLength(2);
  });

  it('reserves one stable outbox event per milestone and filters poisoned entries', async () => {
    const first = event();
    const retryCandidate = event(
      'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      first.properties.flow_id,
    );
    await expect(referralStorage.reservePendingAnalyticsEvent(first)).resolves.toEqual(first);
    await expect(
      referralStorage.reservePendingAnalyticsEvent(retryCandidate),
    ).resolves.toEqual(first);

    const outboxKey = (await AsyncStorage.getAllKeys()).find((key) =>
      key.startsWith('@referral-attribution-lab/analytics-outbox:'),
    );
    if (!outboxKey) throw new Error('Outbox key was not created');
    await AsyncStorage.setItem(
      outboxKey,
      JSON.stringify([
        first,
        { name: 'not_allowed', properties: { referral_code: 'email@example.com' } },
      ]),
    );

    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([first]);
    await referralStorage.removePendingAnalyticsEvent(first.properties.event_id);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
  });

  it('replaces a schema-valid wrong-code/platform outbox collision before delivery', async () => {
    const requested = event();
    const poisoned: ReferralEventRecord = {
      ...requested,
      properties: {
        ...requested.properties,
        referral_code: 'RAL-ZYXW9876',
        platform: 'ios',
        event_id: 'evt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    };
    const outboxKey = await currentEpochKey('@referral-attribution-lab/analytics-outbox');
    await AsyncStorage.setItem(outboxKey, JSON.stringify([poisoned]));
    const delivered: ReferralEventRecord[] = [];
    const tracker = new AnalyticsTracker(
      { logEvent: async (record) => void delivered.push(record) },
      referralStorage,
      'android',
      () => new Date(requested.properties.occurred_at_utc),
      () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    await expect(
      tracker.track(requested.name, CODE, requested.properties.flow_id),
    ).resolves.toBe('accepted');

    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.properties).toMatchObject({
      referral_code: CODE,
      platform: 'android',
    });
    expect(JSON.stringify(delivered)).not.toContain('RAL-ZYXW9876');
    await expect(referralStorage.hasMilestone(`${requested.properties.flow_id}:${requested.name}`))
      .resolves.toBe(true);
  });

  it('canonically rewrites poisoned processed, milestone, outbox, and receipt blobs', async () => {
    const processedKey = await currentEpochKey('@referral-attribution-lab/processed-attributions');
    const milestoneKey = await currentEpochKey('@referral-attribution-lab/analytics-milestones');
    const outboxKey = await currentEpochKey('@referral-attribution-lab/analytics-outbox');
    const receiptKey = await currentEpochKey('@referral-attribution-lab/signup-receipts');
    const validEvent = event();
    const receipt = { accountId: 'acct_abc1234', referralCode: CODE };
    await AsyncStorage.multiSet([
      [processedKey, JSON.stringify(['fingerprint-a', { email: 'private@example.com' }])],
      [milestoneKey, JSON.stringify(['flow-a:clicked', { secret: 'private' }])],
      [outboxKey, JSON.stringify([validEvent, { secret: 'private@example.com' }])],
      [
        receiptKey,
        JSON.stringify({
          'signup:valid': receipt,
          'signup:poison': { accountId: 'email@example.com', referralCode: CODE },
        }),
      ],
    ]);

    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(true);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([validEvent]);
    await expect(referralStorage.getSignupReceipt('signup:valid')).resolves.toEqual(receipt);

    expect(await AsyncStorage.getItem(processedKey)).toBe(JSON.stringify(['fingerprint-a']));
    expect(JSON.parse((await AsyncStorage.getItem(milestoneKey)) ?? '{}')).toEqual({
      milestoneKeys: ['flow-a:clicked'],
      events: [],
    });
    expect(await AsyncStorage.getItem(outboxKey)).toBe(JSON.stringify([validEvent]));
    expect(JSON.parse((await AsyncStorage.getItem(receiptKey)) ?? '{}')).toEqual({
      'signup:valid': receipt,
    });
    expect(
      (await Promise.all(
        [processedKey, milestoneKey, outboxKey, receiptKey].map((key) =>
          AsyncStorage.getItem(key),
        ),
      )).join('|'),
    ).not.toContain('private@example.com');

    await AsyncStorage.setItem(processedKey, JSON.stringify({ email: 'private@example.com' }));
    await expect(referralStorage.hasProcessedAttribution('missing')).resolves.toBe(false);
    await expect(AsyncStorage.getItem(processedKey)).resolves.toBeNull();
  });

  it('serializes poisoned-set cleanup before a concurrent valid processed write', async () => {
    const key = await currentEpochKey('@referral-attribution-lab/processed-attributions');
    await AsyncStorage.setItem(key, JSON.stringify({ secret: 'private@example.com' }));
    const originalGetItem = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    if (!originalGetItem) throw new Error('AsyncStorage getItem mock is unavailable');
    const readStarted = deferred();
    const releaseRead = deferred();
    let gated = false;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (storageKey) => {
      if (storageKey === key && !gated) {
        gated = true;
        readStarted.resolve();
        await releaseRead.promise;
      }
      return originalGetItem(storageKey);
    });

    const poisonedRead = referralStorage.hasProcessedAttribution('missing');
    await readStarted.promise;
    const validWrite = referralStorage.markAttributionProcessed('fingerprint-valid');
    releaseRead.resolve();

    await expect(poisonedRead).resolves.toBe(false);
    await validWrite;
    await expect(referralStorage.hasProcessedAttribution('fingerprint-valid')).resolves.toBe(true);
    expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify(['fingerprint-valid']));
  });

  it('migrates valid unscoped baseline and extended state into the active epoch', async () => {
    const legacyAttribution = attribution(CODE, 'legacy1');
    const legacyEvent = event('evt_cccccccccccccccccccccccccccccccc', 'invitee:legacy1');
    const legacyReceipt = { accountId: 'acct_abc1234', referralCode: CODE };
    await AsyncStorage.multiSet([
      ['@referral-attribution-lab/pending-attribution', JSON.stringify(legacyAttribution)],
      ['@referral-attribution-lab/frozen-code', CODE],
      ['@referral-attribution-lab/processed-attributions', JSON.stringify(['legacy1'])],
      ['@referral-attribution-lab/analytics-milestones', JSON.stringify(['invitee:legacy1:clicked'])],
      ['@referral-attribution-lab/analytics-outbox', JSON.stringify([legacyEvent])],
      ['@referral-attribution-lab/signup-receipts', JSON.stringify({ 'signup:legacy1': legacyReceipt })],
      ['@referral-attribution-lab/generated-code/member-legacy', CODE],
    ]);
    reloadReferralStorageRuntime();

    await expect(referralStorage.getGeneratedCode('member-legacy')).resolves.toBe(CODE);
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(legacyAttribution);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(legacyAttribution);
    await expect(referralStorage.hasProcessedAttribution('legacy1')).resolves.toBe(true);
    await expect(referralStorage.hasMilestone('invitee:legacy1:clicked')).resolves.toBe(true);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([legacyEvent]);
    await expect(referralStorage.getSignupReceipt('signup:legacy1')).resolves.toEqual(
      legacyReceipt,
    );
    for (const key of [
      '@referral-attribution-lab/pending-attribution',
      '@referral-attribution-lab/frozen-code',
      '@referral-attribution-lab/processed-attributions',
      '@referral-attribution-lab/analytics-milestones',
      '@referral-attribution-lab/analytics-outbox',
      '@referral-attribution-lab/signup-receipts',
      '@referral-attribution-lab/generated-code/member-legacy',
    ]) {
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    }
  });

  it('canonicalizes an already-split journey to the frozen attribution', async () => {
    const frozen = attribution(CODE, 'frozen1');
    const pending = attribution('RAL-ZYXW9876', 'pending1');
    const key = await currentJourneyKey();
    await AsyncStorage.setItem(key, JSON.stringify({ pending, frozen }));
    reloadReferralStorageRuntime();

    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(frozen);
    await expect(referralStorage.getFrozenAttribution()).resolves.toEqual(frozen);
    expect(JSON.parse((await AsyncStorage.getItem(key)) ?? '{}')).toEqual({
      pending: frozen,
      frozen,
    });
  });

  it('atomically creates one canonical signup receipt and rejects a conflicting code', async () => {
    const receipt = { accountId: 'acct_abc1234', referralCode: CODE };
    const [first, second] = await Promise.all([
      referralStorage.createSignupReceipt('signup:abc1234', receipt),
      referralStorage.createSignupReceipt('signup:abc1234', receipt),
    ]);
    expect(first).toEqual(receipt);
    expect(second).toEqual(receipt);
    await expect(
      referralStorage.createSignupReceipt('signup:abc1234', {
        accountId: 'acct_def5678',
        referralCode: 'RAL-ZYXW9876',
      }),
    ).rejects.toThrow('conflicts with another referral');
  });

  it('switches epoch before cleanup so a delayed old write cannot restore reset state', async () => {
    const oldJourneyKey = await currentJourneyKey();
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const writeStarted = deferred();
    const releaseWrite = deferred();
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (storageKey, value) => {
      if (storageKey === oldJourneyKey) {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
      return originalSet(storageKey, value);
    });

    const oldWrite = referralStorage.savePendingAttribution(attribution(CODE, 'old0001'));
    await writeStarted.promise;
    await referralStorage.resetDemoState();
    const fresh = attribution('RAL-ZYXW9876', 'new0001');
    await referralStorage.savePendingAttribution(fresh);
    releaseWrite.resolve();
    await oldWrite;

    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
    expect(await currentJourneyKey()).not.toBe(oldJourneyKey);
    await expect(AsyncStorage.getItem(oldJourneyKey)).resolves.toBeNull();
  });

  it('scavenges a retired epoch namespace during process-style reload', async () => {
    const retiredKey = `@referral-attribution-lab/journey:${'f'.repeat(32)}`;
    await AsyncStorage.setItem(retiredKey, JSON.stringify({ pending: attribution() }));
    reloadReferralStorageRuntime();

    await referralStorage.getPendingAttribution();

    await expect(AsyncStorage.getItem(retiredKey)).resolves.toBeNull();
  });

  it('generation-fences a late startup scavenger from the winning epoch', async () => {
    jest.useFakeTimers();
    await referralStorage.savePendingAttribution(attribution());
    reloadReferralStorageRuntime();
    const originalGetAllKeys = jest.mocked(AsyncStorage.getAllKeys).getMockImplementation();
    if (!originalGetAllKeys) throw new Error('AsyncStorage getAllKeys mock is unavailable');
    const scavengerStarted = deferred();
    const releaseScavenger = deferred();
    let getAllKeysCalls = 0;
    const getAllKeysSpy = jest.spyOn(AsyncStorage, 'getAllKeys').mockImplementation(async () => {
      getAllKeysCalls += 1;
      if (getAllKeysCalls === 2) {
        scavengerStarted.resolve();
        await releaseScavenger.promise;
      }
      return originalGetAllKeys();
    });

    const lateStartup = referralStorage.getPendingAttribution().catch((error: unknown) => error);
    await scavengerStarted.promise;
    const timedOutReset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(timedOutReset).resolves.toBeInstanceOf(Error);

    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    const winningEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    const fresh = attribution('RAL-ZYXW9876', 'freshc1');
    await referralStorage.savePendingAttribution(fresh);
    releaseScavenger.resolve();
    await expect(lateStartup).resolves.toBeInstanceOf(Error);
    getAllKeysSpy.mockImplementation(originalGetAllKeys);

    reloadReferralStorageRuntime();
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
  });

  it('never writes a stale initial pointer after a newer epoch wins', async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    reloadReferralStorageRuntime();
    const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    if (!originalGet) throw new Error('AsyncStorage getItem mock is unavailable');
    const creationStarted = deferred();
    const releaseCreation = deferred();
    let pointerReads = 0;
    const pointerSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key) => {
      if (key === ACTIVE_EPOCH_KEY) {
        pointerReads += 1;
        if (pointerReads === 1) {
          creationStarted.resolve();
          await releaseCreation.promise;
        }
      }
      return originalGet(key);
    });

    const lateStartup = referralStorage.getGeneratedCode('late-loader').catch(
      (error: unknown) => error,
    );
    await creationStarted.promise;
    const timedOutReset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(timedOutReset).resolves.toBeInstanceOf(Error);

    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    const winningEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    await referralStorage.setGeneratedCode('winning-member', CODE);
    releaseCreation.resolve();
    await expect(lateStartup).resolves.toBeNull();
    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
    pointerSpy.mockImplementation(originalGet);

    reloadReferralStorageRuntime();
    await expect(referralStorage.getGeneratedCode('winning-member')).resolves.toBe(CODE);
    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
  });

  it('keeps the prior epoch authoritative when pointer publication fails', async () => {
    const oldJourney = attribution();
    await referralStorage.savePendingAttribution(oldJourney);
    const previousEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    let failPointer = true;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation((key, value) => {
      if (key === ACTIVE_EPOCH_KEY && failPointer) {
        failPointer = false;
        return Promise.reject(new Error('pointer unavailable'));
      }
      return originalSet(key, value);
    });

    await expect(referralStorage.resetDemoState(50)).rejects.toThrow('pointer unavailable');
    pointerSpy.mockImplementation(originalSet);
    expect(await AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).toBe(previousEpoch);
    reloadReferralStorageRuntime();
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(oldJourney);
    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await referralStorage.setGeneratedCode('fresh-member', CODE);
    await expect(referralStorage.getGeneratedCode('fresh-member')).resolves.toBe(CODE);
  });

  it('reasserts the prior pointer after a timed-out publication resolves late', async () => {
    jest.useFakeTimers();
    const oldJourney = attribution();
    await referralStorage.savePendingAttribution(oldJourney);
    const previousEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const releasePointer = deferred();
    let gatePointer = true;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      if (key === ACTIVE_EPOCH_KEY && gatePointer) {
        gatePointer = false;
        await releasePointer.promise;
      }
      return originalSet(key, value);
    });

    const reset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(reset).resolves.toBeInstanceOf(Error);
    releasePointer.resolve();
    await jest.runAllTimersAsync();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    pointerSpy.mockImplementation(originalSet);

    expect(await AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).toBe(previousEpoch);
    reloadReferralStorageRuntime();
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(oldJourney);
    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await referralStorage.setGeneratedCode('fresh-member', CODE);
    await expect(referralStorage.getGeneratedCode('fresh-member')).resolves.toBe(CODE);
  });

  it('keeps the successful retry authoritative when a timed-out publication settles in the same turn', async () => {
    jest.useFakeTimers();
    const oldJourney = attribution();
    await referralStorage.savePendingAttribution(oldJourney);
    const previousEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const firstPointer = deferred();
    const secondPointer = deferred();
    const secondStarted = deferred();
    let pointerWrites = 0;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      if (key === ACTIVE_EPOCH_KEY) {
        pointerWrites += 1;
        if (pointerWrites === 1) await firstPointer.promise;
        if (pointerWrites === 2) {
          secondStarted.resolve();
          await secondPointer.promise;
        }
      }
      return originalSet(key, value);
    });

    const timedOutReset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(timedOutReset).resolves.toBeInstanceOf(Error);
    const retry = referralStorage.resetDemoState(50);
    await secondStarted.promise;

    secondPointer.resolve();
    firstPointer.resolve();
    await retry;
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    pointerSpy.mockImplementation(originalSet);

    const winningEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    expect(winningEpoch).not.toBe(previousEpoch);
    await referralStorage.setGeneratedCode('winning-member', CODE);
    reloadReferralStorageRuntime();
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getGeneratedCode('winning-member')).resolves.toBe(CODE);
    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
  });

  it('recovers a fresh epoch load after the initial active-pointer read hangs', async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    reloadReferralStorageRuntime();
    const originalGet = jest.mocked(AsyncStorage.getItem).getMockImplementation();
    if (!originalGet) throw new Error('AsyncStorage getItem mock is unavailable');
    let hangInitialRead = true;
    const readSpy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((key) => {
      if (key === ACTIVE_EPOCH_KEY && hangInitialRead) {
        hangInitialRead = false;
        return new Promise<string | null>(() => undefined);
      }
      return originalGet(key);
    });

    const reset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(reset).resolves.toBeInstanceOf(Error);
    readSpy.mockImplementation(originalGet);

    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    await referralStorage.setGeneratedCode('fresh-member', CODE);
    await expect(referralStorage.getGeneratedCode('fresh-member')).resolves.toBe(CODE);
  });

  it('evicts a hung initial pointer lock so reset retry works in the same runtime', async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    reloadReferralStorageRuntime();
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const initialWriteStarted = deferred();
    let hangInitialWrite = true;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation((key, value) => {
      if (key === ACTIVE_EPOCH_KEY && hangInitialWrite) {
        hangInitialWrite = false;
        initialWriteStarted.resolve();
        return new Promise<void>(() => undefined);
      }
      return originalSet(key, value);
    });

    void referralStorage.getGeneratedCode('hung-loader').catch(() => undefined);
    await initialWriteStarted.promise;
    const timedOutReset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(timedOutReset).resolves.toBeInstanceOf(Error);

    pointerSpy.mockImplementation(originalSet);
    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    await referralStorage.setGeneratedCode('fresh-member', CODE);
    await expect(referralStorage.getGeneratedCode('fresh-member')).resolves.toBe(CODE);
  });

  it('serially repairs the winner after an evicted initial pointer write resolves late', async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
    reloadReferralStorageRuntime();
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const initialWriteStarted = deferred();
    const releaseInitialWrite = deferred();
    let delayInitialWrite = true;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      if (key === ACTIVE_EPOCH_KEY && delayInitialWrite) {
        delayInitialWrite = false;
        initialWriteStarted.resolve();
        await releaseInitialWrite.promise;
      }
      return originalSet(key, value);
    });

    const lateInitialization = referralStorage.getGeneratedCode('late-loader').catch(
      (error: unknown) => error,
    );
    await initialWriteStarted.promise;
    const timedOutReset = referralStorage.resetDemoState(50).catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(50);
    await expect(timedOutReset).resolves.toBeInstanceOf(Error);

    await expect(referralStorage.resetDemoState(50)).resolves.toBeUndefined();
    const winningEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    await referralStorage.setGeneratedCode('winning-member', CODE);
    releaseInitialWrite.resolve();
    await expect(lateInitialization).resolves.toBeInstanceOf(Error);
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    pointerSpy.mockImplementation(originalSet);

    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
    reloadReferralStorageRuntime();
    await expect(referralStorage.getGeneratedCode('winning-member')).resolves.toBe(CODE);
    await expect(AsyncStorage.getItem(ACTIVE_EPOCH_KEY)).resolves.toBe(winningEpoch);
  });

  it('treats hung post-commit namespace cleanup as non-critical', async () => {
    jest.useFakeTimers();
    const oldJourney = attribution();
    await referralStorage.savePendingAttribution(oldJourney);
    const originalSet = jest.mocked(AsyncStorage.setItem).getMockImplementation();
    if (!originalSet) throw new Error('AsyncStorage setItem mock is unavailable');
    const originalGetAllKeys = jest.mocked(AsyncStorage.getAllKeys).getMockImplementation();
    if (!originalGetAllKeys) throw new Error('AsyncStorage getAllKeys mock is unavailable');
    let delayPointer = true;
    const pointerSpy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      if (key === ACTIVE_EPOCH_KEY && delayPointer) {
        delayPointer = false;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return originalSet(key, value);
    });
    const getAllKeysSpy = jest.spyOn(AsyncStorage, 'getAllKeys').mockImplementation(
      () => new Promise<readonly string[]>(() => undefined),
    );

    const reset = referralStorage.resetDemoState(50);
    await jest.advanceTimersByTimeAsync(90);
    await expect(reset).resolves.toBeUndefined();
    pointerSpy.mockImplementation(originalSet);
    getAllKeysSpy.mockImplementation(originalGetAllKeys);

    const fresh = attribution('RAL-ZYXW9876', 'fresh01');
    await referralStorage.savePendingAttribution(fresh);
    await expect(referralStorage.getPendingAttribution()).resolves.toEqual(fresh);
  });

  it('resets every demo namespace, including generated codes and receipts', async () => {
    const journey = attribution();
    await referralStorage.setGeneratedCode('member-1', CODE);
    await referralStorage.savePendingAttribution(journey);
    await referralStorage.freezeAttribution(journey);
    await referralStorage.markAttributionProcessed('fingerprint-a');
    await referralStorage.markMilestone('flow-a:clicked', event());
    await referralStorage.reservePendingAnalyticsEvent(event());
    await referralStorage.createSignupReceipt('signup:abc1234', {
      accountId: 'acct_abc1234',
      referralCode: CODE,
    });
    await referralStorage.saveAcceptedReferralOutcome({
      accountId: 'acct_abc1234',
      referralCode: CODE,
      attribution: journey,
    });

    await referralStorage.resetDemoState();

    await expect(referralStorage.getGeneratedCode('member-1')).resolves.toBeNull();
    await expect(referralStorage.getPendingAttribution()).resolves.toBeNull();
    await expect(referralStorage.getFrozenAttribution()).resolves.toBeNull();
    await expect(referralStorage.hasProcessedAttribution('fingerprint-a')).resolves.toBe(false);
    await expect(referralStorage.hasMilestone('flow-a:clicked')).resolves.toBe(false);
    await expect(referralStorage.getPendingAnalyticsEvents()).resolves.toEqual([]);
    await expect(referralStorage.getSignupReceipt('signup:abc1234')).resolves.toBeNull();
    await expect(referralStorage.getAcceptedReferralOutcome()).resolves.toBeNull();
  });
});
