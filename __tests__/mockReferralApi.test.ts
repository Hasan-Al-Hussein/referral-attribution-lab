import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createMockReferralApi } from '../src/services/referrals/mockReferralApi';

import type { ReferralEventRecord } from '../src/domain/analytics';
import type { ReferralAttribution } from '../src/domain/referral';
import type {
  AcceptedReferralOutcome,
  ReferralAcceptanceReceipt,
  ReferralStorage,
} from '../src/services/storage/referralStorage';

const CODE_B = 'RAL-ZYXW9876';

class ApiStorage implements ReferralStorage {
  readonly generatedCodes = new Map<string, string>();
  readonly receipts = new Map<string, ReferralAcceptanceReceipt>();
  receiptWrites = 0;
  private receiptQueue: Promise<void> = Promise.resolve();

  async getGeneratedCode(userId: string): Promise<string | null> {
    return this.generatedCodes.get(userId) ?? null;
  }
  async setGeneratedCode(userId: string, code: string): Promise<void> {
    this.generatedCodes.set(userId, code);
  }
  async getSignupReceipt(idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null> {
    return this.receipts.get(idempotencyKey) ?? null;
  }
  createSignupReceipt(
    idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<ReferralAcceptanceReceipt> {
    const operation = this.receiptQueue.then(() => {
      const existing = this.receipts.get(idempotencyKey);
      if (existing) {
        if (existing.referralCode !== receipt.referralCode) {
          throw new Error('Signup idempotency key conflicts with another referral.');
        }
        return existing;
      }
      this.receiptWrites += 1;
      this.receipts.set(idempotencyKey, receipt);
      return receipt;
    });
    this.receiptQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async getPendingAttribution(): Promise<ReferralAttribution | null> {
    return null;
  }
  async savePendingAttribution(_attribution: ReferralAttribution): Promise<void> {}
  async clearPendingAttribution(): Promise<void> {}
  async getFrozenAttribution(): Promise<ReferralAttribution | null> {
    return null;
  }
  async freezeAttribution(_attribution: ReferralAttribution): Promise<void> {}
  async completeReferralJourney(_attribution: ReferralAttribution): Promise<void> {}
  async hasProcessedAttribution(_fingerprint: string): Promise<boolean> {
    return false;
  }
  async markAttributionProcessed(_fingerprint: string): Promise<void> {}
  async hasMilestone(_key: string): Promise<boolean> {
    return false;
  }
  async markMilestone(_key: string): Promise<void> {}
  async getAcceptedAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return [];
  }
  async getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return [];
  }
  async reservePendingAnalyticsEvent(
    event: ReferralEventRecord,
  ): Promise<ReferralEventRecord> {
    return event;
  }
  async removePendingAnalyticsEvent(_eventId: string): Promise<void> {}
  async getAcceptedReferralOutcome(): Promise<AcceptedReferralOutcome | null> {
    return null;
  }
  async saveAcceptedReferralOutcome(_outcome: AcceptedReferralOutcome): Promise<void> {}
  async resetDemoState(): Promise<void> {}
}

function createApi(
  storage: ApiStorage,
  randomBytes = async () => new Uint8Array(8),
  delay: (milliseconds: number) => Promise<void> = async () => undefined,
  timeoutMs = 10_000,
) {
  return createMockReferralApi(storage, {
    delay,
    randomBytes,
    timeoutMs,
  });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('mock referral API', () => {
  it('coalesces concurrent generation and returns a stable valid member code', async () => {
    const storage = new ApiStorage();
    let randomCalls = 0;
    const api = createApi(storage, async () => {
      randomCalls += 1;
      return new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    const [first, second] = await Promise.all([
      api.getOrCreateCode('member-1'),
      api.getOrCreateCode('member-1'),
    ]);
    expect(first).toBe('RAL-ABCDEFGH');
    expect(second).toBe(first);
    expect(randomCalls).toBe(1);
    await expect(api.getOrCreateCode('member-1')).resolves.toBe(first);
    expect(randomCalls).toBe(1);
  });

  it('rejects missing authentication and replaces corrupt local code state', async () => {
    const storage = new ApiStorage();
    storage.generatedCodes.set('member-1', 'email@example.com');
    const api = createApi(storage);

    await expect(api.getOrCreateCode('  ')).rejects.toThrow(
      'Authenticated member identity is required.',
    );
    await expect(api.getOrCreateCode('member-1')).resolves.toBe('RAL-AAAAAAAA');
    expect(storage.generatedCodes.get('member-1')).toBe('RAL-AAAAAAAA');
  });

  it('uses one idempotent acceptance receipt across concurrency and restart', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);
    const key = 'signup:abc1234';

    const [first, concurrent] = await Promise.all([
      api.acceptReferral('RAL-ABCD2345', 'new@example.com', key),
      api.acceptReferral('RAL-ABCD2345', 'new@example.com', key),
    ]);
    expect(concurrent).toEqual(first);
    expect(storage.receiptWrites).toBe(1);

    const afterRestart = createApi(storage);
    await expect(
      afterRestart.acceptReferral('RAL-ABCD2345', 'changed@example.com', key),
    ).resolves.toEqual(first);
    expect(storage.receiptWrites).toBe(1);
    await expect(
      afterRestart.acceptReferral(CODE_B, 'new@example.com', key),
    ).rejects.toThrow('conflicts with another referral');
  });

  it('canonicalizes case and whitespace before idempotency comparison and hashing', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);
    const key = 'signup:canonical';

    const first = await api.acceptReferral(' ral-abcd2345 ', 'new@example.com', key);
    await expect(
      api.acceptReferral('RAL-ABCD2345', 'changed@example.com', key),
    ).resolves.toEqual(first);
    expect(storage.receipts.get(key)).toMatchObject({ referralCode: 'RAL-ABCD2345' });
    expect(storage.receiptWrites).toBe(1);
  });

  it('atomically creates one receipt across two API instances and rejects conflicts', async () => {
    const storage = new ApiStorage();
    const firstApi = createApi(storage);
    const secondApi = createApi(storage);
    const key = 'signup:shared-storage';

    const [first, second] = await Promise.all([
      firstApi.acceptReferral(' ral-abcd2345 ', 'first@example.com', key),
      secondApi.acceptReferral('RAL-ABCD2345', 'second@example.com', key),
    ]);
    expect(second).toEqual(first);
    expect(storage.receiptWrites).toBe(1);

    const conflictStorage = new ApiStorage();
    const conflictA = createApi(conflictStorage);
    const conflictB = createApi(conflictStorage);
    const outcomes = await Promise.allSettled([
      conflictA.acceptReferral('RAL-ABCD2345', 'first@example.com', key),
      conflictB.acceptReferral(CODE_B, 'second@example.com', key),
    ]);
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(conflictStorage.receiptWrites).toBe(1);
  });

  it('keeps a rejected acceptance retryable and creates no receipt', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);
    const key = 'signup:retry123';

    await expect(
      api.acceptReferral('RAL-ABCD2345', 'demo+fail@example.com', key),
    ).rejects.toThrow('rejected this signup');
    expect(storage.receipts.size).toBe(0);
    await expect(
      api.acceptReferral('RAL-ABCD2345', 'demo@example.com', key),
    ).resolves.toMatchObject({ accountId: expect.stringMatching(/^acct_[a-z0-9]{7}$/) });
  });

  it('rejects invalid acceptance inputs before creating a receipt', async () => {
    const storage = new ApiStorage();
    const api = createApi(storage);

    await expect(
      api.acceptReferral('BAD-CODE', 'new@example.com', 'signup:abc1234'),
    ).rejects.toThrow('Referral code is invalid');
    await expect(
      api.acceptReferral('RAL-ABCD2345', 'new@example.com', ''),
    ).rejects.toThrow('idempotency key is invalid');
    expect(storage.receipts.size).toBe(0);
  });

  it('bounds a never-settling dependency and remains usable after lifecycle reset', async () => {
    jest.useFakeTimers();
    const storage = new ApiStorage();
    const never = () => new Promise<void>(() => undefined);
    const api = createApi(storage, async () => new Uint8Array(8), never, 50);

    const hung = api.acceptReferral('RAL-ABCD2345', 'new@example.com', 'signup:hung');
    const timedOut = expect(hung).rejects.toThrow('timed out');
    await jest.advanceTimersByTimeAsync(50);
    await timedOut;
    expect(storage.receipts.size).toBe(0);

    api.resetLifecycle?.();
    const recovered = createApi(storage);
    await expect(
      recovered.acceptReferral('RAL-ABCD2345', 'new@example.com', 'signup:recovered'),
    ).resolves.toMatchObject({ accountId: expect.stringMatching(/^acct_[a-z0-9]{7}$/) });
  });

  it('does not create a receipt when delayed acceptance completes after reset', async () => {
    const storage = new ApiStorage();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = createApi(storage, async () => new Uint8Array(8), () => gate);

    const acceptance = api.acceptReferral(
      'RAL-ABCD2345',
      'new@example.com',
      'signup:cancelled',
    );
    api.resetLifecycle?.();
    release?.();

    await expect(acceptance).rejects.toThrow('cancelled');
    expect(storage.receipts.size).toBe(0);
  });
});
