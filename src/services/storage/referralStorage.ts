import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import {
  hasSameAnalyticsIdentity,
  isReferralEventRecord,
} from '../../domain/analytics';
import {
  isValidReferralCode,
  normalizeReferralCode,
  parseStoredReferralAttribution,
} from '../../domain/referral';
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  withTimeout,
} from '../operationTimeout';

import type { ReferralEventRecord } from '../../domain/analytics';
import type { ReferralAttribution } from '../../domain/referral';

const ACTIVE_EPOCH_KEY = '@referral-attribution-lab/active-epoch';
const EPOCH_PATTERN = /^[a-f0-9]{32}$/;
const BASE_KEYS = {
  journey: '@referral-attribution-lab/journey',
  processedAttributions: '@referral-attribution-lab/processed-attributions',
  milestones: '@referral-attribution-lab/analytics-milestones',
  analyticsOutbox: '@referral-attribution-lab/analytics-outbox',
  signupReceipts: '@referral-attribution-lab/signup-receipts',
  acceptedOutcome: '@referral-attribution-lab/accepted-outcome',
  generatedCodePrefix: '@referral-attribution-lab/generated-code',
} as const;
const LEGACY_KEYS = {
  pendingAttribution: '@referral-attribution-lab/pending-attribution',
  frozenReferralCode: '@referral-attribution-lab/frozen-code',
  frozenAttribution: '@referral-attribution-lab/frozen-attribution',
  journey: '@referral-attribution-lab/journey',
  processedAttributions: '@referral-attribution-lab/processed-attributions',
  milestones: '@referral-attribution-lab/analytics-milestones',
  analyticsOutbox: '@referral-attribution-lab/analytics-outbox',
  signupReceipts: '@referral-attribution-lab/signup-receipts',
  generatedCodePrefix: '@referral-attribution-lab/generated-code/',
} as const;

const pendingUpdates = new Map<string, Promise<void>>();
let activeEpochPromise: Promise<string> | undefined;
let activeEpochValue: string | undefined;
let epochGeneration = 0;
let epochPublicationGeneration = 0;

function createEpoch(): string {
  return Crypto.randomUUID().replaceAll('-', '').toLowerCase();
}

async function loadOrCreateEpoch(generation: number): Promise<string> {
  const persisted = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
  if (generation !== epochGeneration) {
    if (activeEpochValue) return activeEpochValue;
    throw new Error('Active referral epoch load was superseded.');
  }
  if (persisted && EPOCH_PATTERN.test(persisted)) {
    activeEpochValue = persisted;
    await migrateLegacyState(persisted, generation);
    assertStartupEpochCurrent(persisted, generation);
    await scavengeRetiredEpochs(persisted, generation);
    assertStartupEpochCurrent(persisted, generation);
    return persisted;
  }

  const created = createEpoch();
  if (generation !== epochGeneration) {
    if (activeEpochValue) return activeEpochValue;
    throw new Error('Active referral epoch creation was superseded.');
  }
  const initializedEpoch = await updateSerially(ACTIVE_EPOCH_KEY, async () => {
    const currentPointer = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    if (generation !== epochGeneration) {
      throw new Error('Active referral epoch creation was superseded.');
    }
    if (currentPointer && EPOCH_PATTERN.test(currentPointer)) {
      activeEpochValue = currentPointer;
      return currentPointer;
    }
    await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, created);
    if (generation !== epochGeneration) {
      await updateSerially(ACTIVE_EPOCH_KEY, async () => {
        if (activeEpochValue && activeEpochValue !== created) {
          await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, activeEpochValue);
        }
      });
      throw new Error('Active referral epoch creation was superseded.');
    }
    activeEpochValue = created;
    return created;
  });
  await migrateLegacyState(initializedEpoch, generation);
  assertStartupEpochCurrent(initializedEpoch, generation);
  await scavengeRetiredEpochs(initializedEpoch, generation);
  assertStartupEpochCurrent(initializedEpoch, generation);
  return initializedEpoch;
}

function captureEpoch(): Promise<string> {
  activeEpochPromise ??= loadOrCreateEpoch(epochGeneration);
  return activeEpochPromise;
}

export function reloadReferralStorageRuntime(): void {
  epochGeneration += 1;
  epochPublicationGeneration += 1;
  activeEpochPromise = undefined;
  activeEpochValue = undefined;
  pendingUpdates.clear();
}

function epochKey(baseKey: string, epoch: string): string {
  return `${baseKey}:${epoch}`;
}

function generatedCodeKey(epoch: string, userId: string): string {
  return `${BASE_KEYS.generatedCodePrefix}:${epoch}:${encodeURIComponent(userId)}`;
}

async function finishEpochMutation<T>(
  epoch: string,
  key: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const result = await mutation();
  if (activeEpochValue !== epoch) await AsyncStorage.removeItem(key);
  return result;
}

async function writeCanonicalValue(
  epoch: string,
  key: string,
  value: unknown[] | object,
): Promise<void> {
  const isEmpty = Array.isArray(value)
    ? value.length === 0
    : Object.keys(value).length === 0;
  await finishEpochMutation(epoch, key, () =>
    isEmpty
      ? AsyncStorage.removeItem(key)
      : AsyncStorage.setItem(key, JSON.stringify(value)),
  );
}

function updateSerially<T>(key: string, update: () => Promise<T>): Promise<T> {
  const previous = pendingUpdates.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(update);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  pendingUpdates.set(key, tail);
  void tail.then(() => {
    if (pendingUpdates.get(key) === tail) pendingUpdates.delete(key);
  });
  return operation;
}

function parseSet(serialized: string | null): Set<string> {
  if (!serialized) return new Set();
  try {
    const values: unknown = JSON.parse(serialized);
    return new Set(
      Array.isArray(values)
        ? values.filter(
            (item): item is string => typeof item === 'string' && item.length <= 200,
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

function readSet(epoch: Promise<string>, baseKey: string): Promise<Set<string>> {
  return epoch.then((value) => {
    const key = epochKey(baseKey, value);
    return updateSerially(key, async () => {
      const values = parseSet(await AsyncStorage.getItem(key));
      await writeCanonicalValue(value, key, [...values].slice(-200));
      return values;
    });
  });
}

function addToBoundedSet(
  epoch: Promise<string>,
  baseKey: string,
  value: string,
  limit = 200,
): Promise<void> {
  return epoch.then((epochValue) => {
    const key = epochKey(baseKey, epochValue);
    return updateSerially(key, async () => {
      const values = parseSet(await AsyncStorage.getItem(key));
      values.add(value);
      await finishEpochMutation(epochValue, key, () =>
        AsyncStorage.setItem(key, JSON.stringify([...values].slice(-limit))),
      );
    });
  });
}

interface PersistedJourney {
  pending?: ReferralAttribution;
  frozen?: ReferralAttribution;
}

function canonicalizeJourney(journey: PersistedJourney): PersistedJourney {
  if (
    journey.frozen &&
    (!journey.pending || !sameAttribution(journey.pending, journey.frozen))
  ) {
    return { pending: journey.frozen, frozen: journey.frozen };
  }
  return journey;
}

function sameAttribution(
  first: ReferralAttribution,
  second: ReferralAttribution,
): boolean {
  return (
    first.referralCode === second.referralCode &&
    first.fingerprint === second.fingerprint &&
    first.receivedAt === second.receivedAt
  );
}

function parseJourney(serialized: string | null): PersistedJourney {
  if (!serialized) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const candidate = parsed as Record<string, unknown>;
    const pending = parseStoredReferralAttribution(candidate.pending);
    const frozen = parseStoredReferralAttribution(candidate.frozen);
    return canonicalizeJourney({
      ...(pending ? { pending } : {}),
      ...(frozen ? { frozen } : {}),
    });
  } catch {
    return {};
  }
}

async function writeJourney(key: string, journey: PersistedJourney): Promise<void> {
  journey = canonicalizeJourney(journey);
  if (!journey.pending && !journey.frozen) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify(journey));
}

function readEvents(serialized: string | null): ReferralEventRecord[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter(isReferralEventRecord) : [];
  } catch {
    return [];
  }
}

interface AcceptedAnalyticsState {
  milestoneKeys: string[];
  events: ReferralEventRecord[];
}

function readAcceptedAnalyticsState(serialized: string | null): AcceptedAnalyticsState {
  if (!serialized) return { milestoneKeys: [], events: [] };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (Array.isArray(parsed)) {
      return {
        milestoneKeys: parsed.filter(
          (item): item is string => typeof item === 'string' && item.length <= 200,
        ),
        events: [],
      };
    }
    if (!parsed || typeof parsed !== 'object') return { milestoneKeys: [], events: [] };
    const candidate = parsed as Record<string, unknown>;
    return {
      milestoneKeys: Array.isArray(candidate.milestoneKeys)
        ? candidate.milestoneKeys.filter(
            (item): item is string => typeof item === 'string' && item.length <= 200,
          )
        : [],
      events: Array.isArray(candidate.events)
        ? candidate.events.filter(isReferralEventRecord)
        : [],
    };
  } catch {
    return { milestoneKeys: [], events: [] };
  }
}

export interface ReferralAcceptanceReceipt {
  accountId: string;
  referralCode: string;
}

export interface AcceptedReferralOutcome extends ReferralAcceptanceReceipt {
  attribution: ReferralAttribution;
}

export interface ReferralStorage {
  getGeneratedCode(userId: string): Promise<string | null>;
  setGeneratedCode(userId: string, code: string): Promise<void>;
  getPendingAttribution(): Promise<ReferralAttribution | null>;
  savePendingAttribution(attribution: ReferralAttribution): Promise<void>;
  clearPendingAttribution(): Promise<void>;
  getFrozenAttribution(): Promise<ReferralAttribution | null>;
  freezeAttribution(attribution: ReferralAttribution): Promise<void>;
  completeReferralJourney(attribution: ReferralAttribution): Promise<void>;
  hasProcessedAttribution(fingerprint: string): Promise<boolean>;
  markAttributionProcessed(fingerprint: string): Promise<void>;
  hasMilestone(key: string): Promise<boolean>;
  markMilestone(key: string, event: ReferralEventRecord): Promise<void>;
  getAcceptedAnalyticsEvents(): Promise<ReferralEventRecord[]>;
  getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]>;
  reservePendingAnalyticsEvent(event: ReferralEventRecord): Promise<ReferralEventRecord>;
  removePendingAnalyticsEvent(eventId: string): Promise<void>;
  getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null>;
  createSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<ReferralAcceptanceReceipt>;
  getAcceptedReferralOutcome(): Promise<AcceptedReferralOutcome | null>;
  saveAcceptedReferralOutcome(outcome: AcceptedReferralOutcome): Promise<void>;
  resetDemoState(timeoutMs?: number): Promise<void>;
}

function isReferralAcceptanceReceipt(value: unknown): value is ReferralAcceptanceReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.accountId === 'string' &&
    /^acct_[a-z0-9]{7}$/.test(receipt.accountId) &&
    typeof receipt.referralCode === 'string' &&
    isValidReferralCode(receipt.referralCode) &&
    normalizeReferralCode(receipt.referralCode) === receipt.referralCode
  );
}

function parseSignupReceipts(
  serialized: string | null,
): Record<string, ReferralAcceptanceReceipt> {
  if (!serialized) return {};
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, ReferralAcceptanceReceipt] =>
          entry[0].length <= 160 && isReferralAcceptanceReceipt(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function parseAcceptedReferralOutcome(value: unknown): AcceptedReferralOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const attribution = parseStoredReferralAttribution(candidate.attribution);
  if (!attribution || !isReferralAcceptanceReceipt(candidate)) return null;
  if (candidate.referralCode !== attribution.referralCode) return null;
  return {
    accountId: candidate.accountId as string,
    referralCode: attribution.referralCode,
    attribution,
  };
}

function parseStoredAttributionJson(serialized: string | null): ReferralAttribution | null {
  if (!serialized) return null;
  try {
    return parseStoredReferralAttribution(JSON.parse(serialized) as unknown);
  } catch {
    return null;
  }
}

function assertStartupEpochCurrent(epoch: string, generation: number): void {
  if (generation !== epochGeneration || activeEpochValue !== epoch) {
    throw new Error('Active referral epoch startup was superseded.');
  }
}

async function readStartupValue<T>(
  operation: Promise<T>,
  epoch: string,
  generation: number,
): Promise<T> {
  const value = await operation;
  assertStartupEpochCurrent(epoch, generation);
  return value;
}

async function mutateStartupValue<T>(
  operation: () => Promise<T>,
  epoch: string,
  generation: number,
): Promise<T> {
  assertStartupEpochCurrent(epoch, generation);
  const value = await operation();
  assertStartupEpochCurrent(epoch, generation);
  return value;
}

async function migrateLegacyState(epoch: string, generation: number): Promise<void> {
  const read = <T>(operation: Promise<T>) => readStartupValue(operation, epoch, generation);
  const mutate = <T>(operation: () => Promise<T>) =>
    mutateStartupValue(operation, epoch, generation);
  const allKeys = await read(AsyncStorage.getAllKeys());
  const generatedKeys = allKeys.filter((key) =>
    key.startsWith(LEGACY_KEYS.generatedCodePrefix),
  );
  const fixedLegacyKeys = Object.values(LEGACY_KEYS).filter(
    (key) => key !== LEGACY_KEYS.generatedCodePrefix,
  );
  const presentFixedKeys = fixedLegacyKeys.filter((key) => allKeys.includes(key));
  if (presentFixedKeys.length === 0 && generatedKeys.length === 0) return;

  const journeyKey = epochKey(BASE_KEYS.journey, epoch);
  const currentJourney = parseJourney(await read(AsyncStorage.getItem(journeyKey)));
  const legacyJourney = parseJourney(
    await read(AsyncStorage.getItem(LEGACY_KEYS.journey)),
  );
  const legacyPending =
    legacyJourney.pending ??
    parseStoredAttributionJson(
      await read(AsyncStorage.getItem(LEGACY_KEYS.pendingAttribution)),
    );
  const legacyFrozenAttribution =
    legacyJourney.frozen ??
    parseStoredAttributionJson(
      await read(AsyncStorage.getItem(LEGACY_KEYS.frozenAttribution)),
    );
  const legacyFrozenCodeValue = await read(
    AsyncStorage.getItem(LEGACY_KEYS.frozenReferralCode),
  );
  const legacyFrozenCode = isValidReferralCode(legacyFrozenCodeValue)
    ? normalizeReferralCode(legacyFrozenCodeValue)
    : undefined;
  const pending = currentJourney.pending ?? legacyPending ?? undefined;
  const frozen =
    currentJourney.frozen ??
    legacyFrozenAttribution ??
    (pending && legacyFrozenCode === pending.referralCode ? pending : undefined);
  await mutate(() =>
    finishEpochMutation(epoch, journeyKey, () =>
      writeJourney(journeyKey, {
        ...(pending ? { pending } : {}),
        ...(frozen ? { frozen } : {}),
      }),
    ),
  );

  const migrateSet = async (legacyKey: string, baseKey: string, limit: number) => {
    const targetKey = epochKey(baseKey, epoch);
    const values = new Set([
      ...parseSet(await read(AsyncStorage.getItem(targetKey))),
      ...parseSet(await read(AsyncStorage.getItem(legacyKey))),
    ]);
    await mutate(() => writeCanonicalValue(epoch, targetKey, [...values].slice(-limit)));
  };
  await migrateSet(LEGACY_KEYS.processedAttributions, BASE_KEYS.processedAttributions, 200);

  const milestoneKey = epochKey(BASE_KEYS.milestones, epoch);
  const currentMilestones = readAcceptedAnalyticsState(
    await read(AsyncStorage.getItem(milestoneKey)),
  );
  const legacyMilestones = readAcceptedAnalyticsState(
    await read(AsyncStorage.getItem(LEGACY_KEYS.milestones)),
  );
  const milestoneKeys = [
    ...new Set([...currentMilestones.milestoneKeys, ...legacyMilestones.milestoneKeys]),
  ].slice(-500);
  const milestoneEvents = [
    ...currentMilestones.events,
    ...legacyMilestones.events.filter(
      (event) =>
        !currentMilestones.events.some(
          (candidate) => candidate.properties.event_id === event.properties.event_id,
        ),
    ),
  ].slice(-500);
  await mutate(() =>
    writeCanonicalValue(
      epoch,
      milestoneKey,
      milestoneKeys.length || milestoneEvents.length
        ? { milestoneKeys, events: milestoneEvents }
        : {},
    ),
  );

  const outboxKey = epochKey(BASE_KEYS.analyticsOutbox, epoch);
  const currentOutbox = readEvents(await read(AsyncStorage.getItem(outboxKey)));
  const legacyOutbox = readEvents(
    await read(AsyncStorage.getItem(LEGACY_KEYS.analyticsOutbox)),
  );
  const outbox = [
    ...currentOutbox,
    ...legacyOutbox.filter(
      (event) =>
        !currentOutbox.some(
          (candidate) => candidate.properties.event_id === event.properties.event_id,
        ),
    ),
  ].slice(-100);
  await mutate(() => writeCanonicalValue(epoch, outboxKey, outbox));

  const receiptsKey = epochKey(BASE_KEYS.signupReceipts, epoch);
  const receipts = {
    ...parseSignupReceipts(
      await read(AsyncStorage.getItem(LEGACY_KEYS.signupReceipts)),
    ),
    ...parseSignupReceipts(await read(AsyncStorage.getItem(receiptsKey))),
  };
  await mutate(() => writeCanonicalValue(epoch, receiptsKey, receipts));

  for (const legacyKey of generatedKeys) {
    const rawUserId = legacyKey.slice(LEGACY_KEYS.generatedCodePrefix.length);
    let userId = rawUserId;
    try {
      userId = decodeURIComponent(rawUserId);
    } catch {
      // Baseline keys were allowed to contain an unescaped fixture identifier.
    }
    const code = await read(AsyncStorage.getItem(legacyKey));
    if (!isValidReferralCode(code)) continue;
    const key = generatedCodeKey(epoch, userId);
    if (!(await read(AsyncStorage.getItem(key)))) {
      await mutate(() =>
        finishEpochMutation(epoch, key, () =>
          AsyncStorage.setItem(key, normalizeReferralCode(code)),
        ),
      );
    }
  }

  const legacyKeys = [...new Set([...presentFixedKeys, ...generatedKeys])];
  await updateSerially(ACTIVE_EPOCH_KEY, async () => {
    assertStartupEpochCurrent(epoch, generation);
    const durableEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
    assertStartupEpochCurrent(epoch, generation);
    if (durableEpoch !== epoch) {
      throw new Error('Active referral epoch pointer changed during migration.');
    }
    await AsyncStorage.multiRemove(legacyKeys);
    assertStartupEpochCurrent(epoch, generation);
  });
}

async function scavengeRetiredEpochs(
  activeEpoch: string,
  generation: number,
): Promise<void> {
  const allKeys = await readStartupValue(
    AsyncStorage.getAllKeys(),
    activeEpoch,
    generation,
  );
  const retiredKeys = allKeys.filter((key) => {
    if (!key.startsWith('@referral-attribution-lab/') || key === ACTIVE_EPOCH_KEY) return false;
    const match = key.match(/:([a-f0-9]{32})(?::|$)/);
    return Boolean(match?.[1] && match[1] !== activeEpoch);
  });
  for (const retiredKey of retiredKeys) {
    await updateSerially(ACTIVE_EPOCH_KEY, async () => {
      assertStartupEpochCurrent(activeEpoch, generation);
      const durableEpoch = await AsyncStorage.getItem(ACTIVE_EPOCH_KEY);
      assertStartupEpochCurrent(activeEpoch, generation);
      if (durableEpoch !== activeEpoch) {
        throw new Error('Active referral epoch pointer changed during scavenging.');
      }
      await AsyncStorage.removeItem(retiredKey);
      assertStartupEpochCurrent(activeEpoch, generation);
    });
  }
}

export const referralStorage: ReferralStorage = {
  getGeneratedCode(userId) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = generatedCodeKey(value, userId);
      return updateSerially(key, async () => {
        const code = await AsyncStorage.getItem(key);
        if (!isValidReferralCode(code)) {
          if (code !== null) await finishEpochMutation(value, key, () => AsyncStorage.removeItem(key));
          return null;
        }
        const normalized = normalizeReferralCode(code);
        if (normalized !== code) {
          await finishEpochMutation(value, key, () => AsyncStorage.setItem(key, normalized));
        }
        return normalized;
      });
    });
  },
  setGeneratedCode(userId, code) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = generatedCodeKey(value, userId);
      return updateSerially(key, () =>
        finishEpochMutation(value, key, () => AsyncStorage.setItem(key, code)),
      );
    });
  },
  getPendingAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        const journey = parseJourney(serialized);
        if (serialized && !journey.pending && !journey.frozen) {
          await finishEpochMutation(value, key, () => AsyncStorage.removeItem(key));
        } else if (serialized) {
          await finishEpochMutation(value, key, () => writeJourney(key, journey));
        }
        return journey.pending ?? null;
      });
    });
  },
  savePendingAttribution(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        if (journey.frozen && !sameAttribution(journey.frozen, attribution)) {
          throw new Error('Another referral attribution is already frozen.');
        }
        await finishEpochMutation(value, key, () =>
          writeJourney(key, { ...journey, pending: attribution }),
        );
      });
    });
  },
  clearPendingAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        delete journey.pending;
        await finishEpochMutation(value, key, () => writeJourney(key, journey));
      });
    });
  },
  getFrozenAttribution() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        const journey = parseJourney(serialized);
        if (serialized) {
          await finishEpochMutation(value, key, () => writeJourney(key, journey));
        }
        return journey.frozen ?? null;
      });
    });
  },
  freezeAttribution(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        if (journey.frozen && !sameAttribution(journey.frozen, attribution)) {
          throw new Error('Another referral attribution is already frozen.');
        }
        await finishEpochMutation(value, key, () =>
          writeJourney(key, { ...journey, frozen: attribution }),
        );
      });
    });
  },
  completeReferralJourney(attribution) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.journey, value);
      return updateSerially(key, async () => {
        const journey = parseJourney(await AsyncStorage.getItem(key));
        if (!journey.pending && !journey.frozen) return;
        if (!journey.frozen || !sameAttribution(journey.frozen, attribution)) {
          throw new Error('Frozen referral attribution changed before cleanup.');
        }
        await finishEpochMutation(value, key, () => AsyncStorage.removeItem(key));
      });
    });
  },
  async hasProcessedAttribution(fingerprint) {
    const epoch = captureEpoch();
    return (await readSet(epoch, BASE_KEYS.processedAttributions)).has(fingerprint);
  },
  markAttributionProcessed(fingerprint) {
    const epoch = captureEpoch();
    return addToBoundedSet(epoch, BASE_KEYS.processedAttributions, fingerprint);
  },
  async hasMilestone(key) {
    const epoch = captureEpoch();
    const value = await epoch;
    const storageKey = epochKey(BASE_KEYS.milestones, value);
    return updateSerially(storageKey, async () => {
      const state = readAcceptedAnalyticsState(await AsyncStorage.getItem(storageKey));
      await writeCanonicalValue(
        value,
        storageKey,
        state.milestoneKeys.length || state.events.length ? state : {},
      );
      return state.milestoneKeys.includes(key);
    });
  },
  markMilestone(key, event) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const storageKey = epochKey(BASE_KEYS.milestones, value);
      return updateSerially(storageKey, async () => {
        const state = readAcceptedAnalyticsState(await AsyncStorage.getItem(storageKey));
        const milestoneKeys = [...new Set([...state.milestoneKeys, key])].slice(-500);
        const events = [
          ...state.events.filter(
            (candidate) =>
              !(
                candidate.name === event.name &&
                candidate.properties.flow_id === event.properties.flow_id
              ),
          ),
          event,
        ].slice(-500);
        await finishEpochMutation(value, storageKey, () =>
          AsyncStorage.setItem(storageKey, JSON.stringify({ milestoneKeys, events })),
        );
      });
    });
  },
  getAcceptedAnalyticsEvents() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.milestones, value);
      return updateSerially(key, async () => {
        const state = readAcceptedAnalyticsState(await AsyncStorage.getItem(key));
        await writeCanonicalValue(
          value,
          key,
          state.milestoneKeys.length || state.events.length ? state : {},
        );
        return state.events;
      });
    });
  },
  getPendingAnalyticsEvents() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => {
        const events = readEvents(await AsyncStorage.getItem(key)).slice(-100);
        await writeCanonicalValue(value, key, events);
        return events;
      });
    });
  },
  reservePendingAnalyticsEvent(event) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => {
        const events = readEvents(await AsyncStorage.getItem(key));
        const sameMilestone = (candidate: ReferralEventRecord) =>
          candidate.name === event.name &&
          candidate.properties.flow_id === event.properties.flow_id;
        const matching = events.filter(sameMilestone);
        const existing = matching.find((candidate) =>
          hasSameAnalyticsIdentity(candidate, event),
        );
        const withoutConflicts = events.filter(
          (candidate) => !sameMilestone(candidate) || candidate === existing,
        );
        const reserved = existing ?? event;
        const next = existing ? withoutConflicts : [...withoutConflicts, event];
        await finishEpochMutation(value, key, () =>
          AsyncStorage.setItem(key, JSON.stringify(next.slice(-100))),
        );
        return reserved;
      });
    });
  },
  removePendingAnalyticsEvent(eventId) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.analyticsOutbox, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        if (!serialized) return;
        const events = readEvents(serialized).filter(
          ({ properties }) => properties.event_id !== eventId,
        );
        if (events.length === 0) {
          await finishEpochMutation(value, key, () => AsyncStorage.removeItem(key));
        } else {
          await finishEpochMutation(value, key, () =>
            AsyncStorage.setItem(key, JSON.stringify(events)),
          );
        }
      });
    });
  },
  getSignupReceipt(idempotencyKey) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.signupReceipts, value);
      return updateSerially(key, async () => {
        const receipts = parseSignupReceipts(await AsyncStorage.getItem(key));
        await writeCanonicalValue(value, key, receipts);
        return receipts[idempotencyKey] ?? null;
      });
    });
  },
  createSignupReceipt(idempotencyKey, receipt) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.signupReceipts, value);
      return updateSerially(key, async () => {
        const receipts = parseSignupReceipts(await AsyncStorage.getItem(key));
        const existing = receipts[idempotencyKey];
        if (existing) {
          if (existing.referralCode !== receipt.referralCode) {
            throw new Error('Signup idempotency key conflicts with another referral.');
          }
          return existing;
        }
        const next = Object.fromEntries(
          [...Object.entries(receipts), [idempotencyKey, receipt]].slice(-100),
        );
        await finishEpochMutation(value, key, () =>
          AsyncStorage.setItem(key, JSON.stringify(next)),
        );
        return receipt;
      });
    });
  },
  getAcceptedReferralOutcome() {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.acceptedOutcome, value);
      return updateSerially(key, async () => {
        const serialized = await AsyncStorage.getItem(key);
        let outcome: AcceptedReferralOutcome | null = null;
        if (serialized) {
          try {
            outcome = parseAcceptedReferralOutcome(JSON.parse(serialized) as unknown);
          } catch {
            outcome = null;
          }
        }
        if (outcome) {
          await finishEpochMutation(value, key, () =>
            AsyncStorage.setItem(key, JSON.stringify(outcome)),
          );
        } else if (serialized) {
          await finishEpochMutation(value, key, () => AsyncStorage.removeItem(key));
        }
        return outcome;
      });
    });
  },
  saveAcceptedReferralOutcome(outcome) {
    const epoch = captureEpoch();
    return epoch.then((value) => {
      const key = epochKey(BASE_KEYS.acceptedOutcome, value);
      return updateSerially(key, async () => {
        const valid = parseAcceptedReferralOutcome(outcome);
        if (!valid) throw new Error('Accepted referral outcome is invalid.');
        await finishEpochMutation(value, key, () =>
          AsyncStorage.setItem(key, JSON.stringify(valid)),
        );
      });
    });
  },
  resetDemoState(timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
    return (async () => {
      let capturedEpoch: string;
      try {
        capturedEpoch = await withTimeout(
          captureEpoch(),
          'active referral epoch load',
          timeoutMs,
        );
      } catch (error) {
        epochGeneration += 1;
        epochPublicationGeneration += 1;
        activeEpochPromise = undefined;
        pendingUpdates.delete(ACTIVE_EPOCH_KEY);
        throw error;
      }
      const committed = await updateSerially(ACTIVE_EPOCH_KEY, async () => {
        const previousEpoch = activeEpochValue ?? capturedEpoch;
        const nextEpoch = createEpoch();
        const publicationGeneration = ++epochPublicationGeneration;
        const pointerWrite = Promise.resolve(
          AsyncStorage.setItem(ACTIVE_EPOCH_KEY, nextEpoch),
        );
        const pointerCommit = pointerWrite.then(() => {
          if (publicationGeneration !== epochPublicationGeneration) return false;
          epochGeneration += 1;
          activeEpochValue = nextEpoch;
          activeEpochPromise = Promise.resolve(nextEpoch);
          return true;
        });
        try {
          const isCommitted = await withTimeout(
            pointerCommit,
            'active referral epoch publication',
            timeoutMs,
          );
          if (!isCommitted) {
            throw new Error('Active referral epoch publication was superseded.');
          }
        } catch (error) {
          if (publicationGeneration === epochPublicationGeneration) {
            epochPublicationGeneration += 1;
          }
          void pointerWrite
            .then(() =>
              updateSerially(ACTIVE_EPOCH_KEY, async () => {
                const authoritativeEpoch = activeEpochValue ?? previousEpoch;
                await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, authoritativeEpoch);
              }),
            )
            .catch(() => undefined);
          throw error;
        }
        return { epoch: nextEpoch, generation: epochGeneration };
      });

      try {
        await withTimeout(
          scavengeRetiredEpochs(committed.epoch, committed.generation),
          'retired referral epoch cleanup',
          timeoutMs,
        );
      } catch {
        // Pointer publication is the reset commit. Startup scavenging and
        // post-write tombstones retry non-critical physical cleanup.
      }
      if (
        committed.generation === epochGeneration &&
        activeEpochValue === committed.epoch
      ) {
        const confirmation = Promise.resolve(
          AsyncStorage.setItem(ACTIVE_EPOCH_KEY, committed.epoch),
        ).then(() => {
          if (
            committed.generation === epochGeneration &&
            activeEpochValue === committed.epoch
          ) {
            return;
          }
          return updateSerially(ACTIVE_EPOCH_KEY, async () => {
            if (activeEpochValue) {
              await AsyncStorage.setItem(ACTIVE_EPOCH_KEY, activeEpochValue);
            }
          });
        });
        try {
          await withTimeout(
            confirmation,
            'active referral epoch confirmation',
            timeoutMs,
          );
        } catch {
          void confirmation.catch(() => undefined);
          // The first publication is already the durable reset commit. A late
          // confirmation checks the generation and serially repairs any winner.
        }
      }
    })();
  },
};
