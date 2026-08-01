import * as Crypto from 'expo-crypto';

import {
  isValidReferralCode,
  normalizeReferralCode,
  stableHash,
} from '../../domain/referral';
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  withTimeout,
} from '../operationTimeout';

import type { ReferralStorage } from '../storage/referralStorage';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_USER_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_KEY_LENGTH = 160;

export interface MockReferralApi {
  getOrCreateCode(userId: string): Promise<string>;
  acceptReferral(
    code: string,
    email: string,
    idempotencyKey: string,
  ): Promise<{ accountId: string }>;
  resetLifecycle?(): void;
}

interface MockReferralApiOptions {
  delay?: (milliseconds: number) => Promise<void>;
  randomBytes?: (length: number) => Promise<Uint8Array>;
  timeoutMs?: number;
}

class MockApiLifecycleCancelledError extends Error {
  constructor() {
    super('Mock referral API operation was cancelled by reset.');
  }
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function encodeCode(bytes: Uint8Array): string {
  return `RAL-${[...bytes]
    .slice(0, 8)
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('')}`;
}

export function createMockReferralApi(
  storage: ReferralStorage,
  options: MockReferralApiOptions = {},
): MockReferralApi {
  const wait = options.delay ?? defaultDelay;
  const randomBytes = options.randomBytes ?? Crypto.getRandomBytesAsync;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS;
  let lifecycle = 0;
  const pendingCodeRequests = new Map<string, Promise<string>>();
  const pendingAcceptances = new Map<
    string,
    { referralCode: string; promise: Promise<{ accountId: string }> }
  >();

  function isCurrent(capturedLifecycle: number): boolean {
    return capturedLifecycle === lifecycle;
  }

  async function boundary<T>(
    operation: Promise<T>,
    capturedLifecycle: number,
    operationName: string,
  ): Promise<T> {
    const result = await withTimeout(operation, operationName, timeoutMs);
    if (!isCurrent(capturedLifecycle)) throw new MockApiLifecycleCancelledError();
    return result;
  }

  return {
    resetLifecycle() {
      lifecycle += 1;
      pendingCodeRequests.clear();
      pendingAcceptances.clear();
    },

    getOrCreateCode(userId) {
      const capturedLifecycle = lifecycle;
      const normalizedUserId = userId.trim();
      if (!normalizedUserId || normalizedUserId.length > MAX_USER_ID_LENGTH) {
        return Promise.reject(new Error('Authenticated member identity is required.'));
      }

      const existingRequest = pendingCodeRequests.get(normalizedUserId);
      if (existingRequest) return existingRequest;

      const request = (async () => {
        await boundary(wait(420), capturedLifecycle, 'mock referral generation delay');
        const existing = await boundary(
          storage.getGeneratedCode(normalizedUserId),
          capturedLifecycle,
          'generated referral code read',
        );
        if (isValidReferralCode(existing)) return normalizeReferralCode(existing);

        const bytes = await boundary(
          randomBytes(8),
          capturedLifecycle,
          'referral code entropy',
        );
        const code = encodeCode(bytes);
        if (!isValidReferralCode(code)) throw new Error('Referral code generation failed.');
        await boundary(
          storage.setGeneratedCode(normalizedUserId, code),
          capturedLifecycle,
          'generated referral code write',
        );
        return code;
      })();
      pendingCodeRequests.set(normalizedUserId, request);
      const clearRequest = () => {
        if (pendingCodeRequests.get(normalizedUserId) === request) {
          pendingCodeRequests.delete(normalizedUserId);
        }
      };
      void request.then(clearRequest, clearRequest);
      return request;
    },

    async acceptReferral(code, email, idempotencyKey) {
      const capturedLifecycle = lifecycle;
      const normalizedCode = normalizeReferralCode(code);
      if (!isValidReferralCode(normalizedCode)) throw new Error('Referral code is invalid.');
      if (
        !idempotencyKey ||
        idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
      ) {
        throw new Error('Signup idempotency key is invalid.');
      }

      const receipt = await boundary(
        storage.getSignupReceipt(idempotencyKey),
        capturedLifecycle,
        'signup receipt read',
      );
      if (receipt) {
        if (receipt.referralCode !== normalizedCode) {
          throw new Error('Signup idempotency key conflicts with another referral.');
        }
        return { accountId: receipt.accountId };
      }

      const pending = pendingAcceptances.get(idempotencyKey);
      if (pending) {
        if (pending.referralCode !== normalizedCode) {
          throw new Error('Signup idempotency key conflicts with another referral.');
        }
        return pending.promise;
      }

      const promise = (async () => {
        await boundary(wait(700), capturedLifecycle, 'mock referral acceptance delay');
        if (email.toLowerCase().includes('+fail')) {
          throw new Error('The demo endpoint rejected this signup.');
        }

        const repeatedReceipt = await boundary(
          storage.getSignupReceipt(idempotencyKey),
          capturedLifecycle,
          'signup receipt retry read',
        );
        if (repeatedReceipt) {
          if (repeatedReceipt.referralCode !== normalizedCode) {
            throw new Error('Signup idempotency key conflicts with another referral.');
          }
          return { accountId: repeatedReceipt.accountId };
        }

        const accountId = `acct_${stableHash(`signup:${idempotencyKey}:${normalizedCode}`)}`;
        const persistedReceipt = await boundary(
          storage.createSignupReceipt(idempotencyKey, {
            accountId,
            referralCode: normalizedCode,
          }),
          capturedLifecycle,
          'atomic signup receipt creation',
        );
        return { accountId: persistedReceipt.accountId };
      })();
      pendingAcceptances.set(idempotencyKey, { referralCode: normalizedCode, promise });
      const clearAcceptance = () => {
        if (pendingAcceptances.get(idempotencyKey)?.promise === promise) {
          pendingAcceptances.delete(idempotencyKey);
        }
      };
      void promise.then(clearAcceptance, clearAcceptance);
      return promise;
    },
  };
}
