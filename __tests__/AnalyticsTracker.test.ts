import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { getAcceptedReferralMilestones } from '../src/application/referralProgress';
import { REFERRAL_DESTINATION } from '../src/domain/referral';
import { AnalyticsTracker } from '../src/services/analytics/AnalyticsTracker';

import type { AnalyticsClient, ReferralEventRecord } from '../src/domain/analytics';
import type { ReferralAttribution } from '../src/domain/referral';
import type {
  AcceptedReferralOutcome,
  ReferralAcceptanceReceipt,
  ReferralStorage,
} from '../src/services/storage/referralStorage';

const CODE = 'RAL-ABCD2345';
const NOW = new Date('2026-07-31T12:00:00.000Z');

class TrackerStorage implements ReferralStorage {
  readonly milestones = new Set<string>();
  readonly accepted: ReferralEventRecord[] = [];
  readonly pending = new Map<string, ReferralEventRecord>();
  hasMilestoneError: Error | undefined;
  getPendingError: Error | undefined;

  async hasMilestone(key: string): Promise<boolean> {
    if (this.hasMilestoneError) throw this.hasMilestoneError;
    return this.milestones.has(key);
  }

  async markMilestone(key: string, event: ReferralEventRecord): Promise<void> {
    this.milestones.add(key);
    this.accepted.push(event);
  }

  async getAcceptedAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    return this.accepted;
  }

  async getPendingAnalyticsEvents(): Promise<ReferralEventRecord[]> {
    if (this.getPendingError) throw this.getPendingError;
    return [...this.pending.values()];
  }

  async reservePendingAnalyticsEvent(event: ReferralEventRecord): Promise<ReferralEventRecord> {
    const existing = [...this.pending.values()].find(
      (candidate) =>
        candidate.name === event.name &&
        candidate.properties.flow_id === event.properties.flow_id,
    );
    if (existing) return existing;
    this.pending.set(event.properties.event_id, event);
    return event;
  }

  async removePendingAnalyticsEvent(eventId: string): Promise<void> {
    this.pending.delete(eventId);
  }

  async getGeneratedCode(_userId: string): Promise<string | null> {
    return null;
  }
  async setGeneratedCode(_userId: string, _code: string): Promise<void> {}
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
  async getSignupReceipt(_idempotencyKey: string): Promise<ReferralAcceptanceReceipt | null> {
    return null;
  }
  async createSignupReceipt(
    _idempotencyKey: string,
    receipt: ReferralAcceptanceReceipt,
  ): Promise<ReferralAcceptanceReceipt> {
    return receipt;
  }
  async getAcceptedReferralOutcome(): Promise<AcceptedReferralOutcome | null> {
    return null;
  }
  async saveAcceptedReferralOutcome(_outcome: AcceptedReferralOutcome): Promise<void> {}
  async resetDemoState(): Promise<void> {}
}

class RecordingClient implements AnalyticsClient {
  readonly attempts: ReferralEventRecord[] = [];
  failuresRemaining = 0;
  gate: Promise<void> | undefined;

  async logEvent(event: ReferralEventRecord): Promise<void> {
    this.attempts.push(event);
    if (this.gate) await this.gate;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('injected analytics failure');
    }
  }
}

function sequentialEventIds(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return sequence.toString(16).padStart(32, '0');
  };
}

function createTracker(
  storage = new TrackerStorage(),
  client = new RecordingClient(),
  timeoutMs = 10_000,
) {
  return {
    storage,
    client,
    tracker: new AnalyticsTracker(
      client,
      storage,
      'ios',
      () => NOW,
      sequentialEventIds(),
      timeoutMs,
    ),
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('AnalyticsTracker', () => {
  it('coalesces concurrent once-only milestone delivery', async () => {
    const { tracker, client, storage } = createTracker();
    let release: (() => void) | undefined;
    client.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = tracker.track('referral_link_clicked', CODE, 'invitee:abc1234');
    const second = tracker.track('referral_link_clicked', CODE, 'invitee:abc1234');
    await Promise.resolve();
    await Promise.resolve();
    release?.();

    await expect(Promise.all([first, second])).resolves.toEqual(['accepted', 'accepted']);
    expect(client.attempts).toHaveLength(1);
    expect(storage.milestones).toEqual(
      new Set(['invitee:abc1234:referral_link_clicked']),
    );
  });

  it('keeps a stable event in the outbox after failure and flushes it later', async () => {
    const { tracker, client, storage } = createTracker();
    client.failuresRemaining = 1;
    const deliveries: string[] = [];
    const unsubscribe = tracker.subscribe((event, delivery) => {
      deliveries.push(`${event.properties.event_id}:${delivery}`);
    });

    await expect(
      tracker.track('referral_signup_completed', CODE, 'invitee:abc1234'),
    ).resolves.toBe('failed');
    const pendingEvent = [...storage.pending.values()][0];
    expect(pendingEvent).toBeDefined();

    await expect(tracker.flushPending()).resolves.toEqual({
      accepted: 1,
      duplicate: 0,
      failed: 0,
    });
    expect(storage.pending.size).toBe(0);
    expect(client.attempts).toHaveLength(2);
    expect(client.attempts[0]?.properties.event_id).toBe(
      client.attempts[1]?.properties.event_id,
    );
    expect(deliveries).toEqual([
      `${pendingEvent?.properties.event_id}:failed`,
      `${pendingEvent?.properties.event_id}:accepted`,
    ]);

    unsubscribe();
    await tracker.track('referral_signup_completed', CODE, 'invitee:abc1234');
    expect(deliveries).toHaveLength(2);
  });

  it('reports invalid required-event payloads as failed without calling the client', async () => {
    const { tracker, client } = createTracker();

    await expect(
      tracker.track('referral_link_generated', 'UNAVAILABLE', 'referrer:unavailable'),
    ).resolves.toBe('failed');
    expect(client.attempts).toHaveLength(0);
  });

  it('turns milestone-storage failure into a failed delivery instead of throwing', async () => {
    const storage = new TrackerStorage();
    storage.hasMilestoneError = new Error('storage unavailable');
    const { tracker, client } = createTracker(storage);

    await expect(
      tracker.track('referral_signup_started', CODE, 'invitee:abc1234'),
    ).resolves.toBe('failed');
    expect(client.attempts).toHaveLength(0);
  });

  it('isolates throwing observers and gives repeat diagnostics distinct event IDs', async () => {
    const { tracker, client } = createTracker();
    tracker.subscribe(() => {
      throw new Error('observer failed');
    });

    await expect(
      tracker.track('referral_duplicate_suppressed', CODE, 'invitee:abc1234', {
        reason: 'callback_replayed',
        once: false,
      }),
    ).resolves.toBe('accepted');
    await tracker.track('referral_duplicate_suppressed', CODE, 'invitee:abc1234', {
      reason: 'callback_replayed',
      once: false,
    });

    expect(client.attempts).toHaveLength(2);
    expect(client.attempts[0]?.properties.event_id).not.toBe(
      client.attempts[1]?.properties.event_id,
    );
  });

  it('reports best-effort diagnostic failure without adding it to the outbox', async () => {
    const { tracker, client, storage } = createTracker();
    client.failuresRemaining = 1;

    await expect(
      tracker.track('referral_signup_failed', CODE, 'invitee:abc1234', {
        reason: 'referral_acceptance_failed',
        once: false,
      }),
    ).resolves.toBe('failed');
    expect(storage.pending.size).toBe(0);
  });

  it('reports an outbox read failure from startup flush', async () => {
    const storage = new TrackerStorage();
    storage.getPendingError = new Error('outbox unavailable');
    const { tracker } = createTracker(storage);

    await expect(tracker.flushPending()).resolves.toEqual({
      accepted: 0,
      duplicate: 0,
      failed: 1,
    });
  });

  it('uses collision-resistant IDs for the concrete legacy 32-bit collision inputs', async () => {
    const { tracker, client } = createTracker();

    await tracker.track('referral_link_clicked', CODE, 'invitee:13auvky');
    await tracker.track('referral_link_clicked', CODE, 'invitee:19hyv32');

    const ids = client.attempts.map(({ properties }) => properties.event_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^evt_[a-f0-9]{32}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('gives diagnostics new IDs across tracker restarts', async () => {
    const storage = new TrackerStorage();
    const client = new RecordingClient();
    const first = new AnalyticsTracker(
      client,
      storage,
      'ios',
      () => NOW,
      () => '11111111111111111111111111111111',
    );
    const restarted = new AnalyticsTracker(
      client,
      storage,
      'ios',
      () => NOW,
      () => '22222222222222222222222222222222',
    );

    await first.track('referral_duplicate_suppressed', CODE, 'invitee:abc1234', {
      reason: 'callback_replayed',
      once: false,
    });
    await restarted.track('referral_duplicate_suppressed', CODE, 'invitee:abc1234', {
      reason: 'callback_replayed',
      once: false,
    });

    expect(client.attempts.map(({ properties }) => properties.event_id)).toEqual([
      'evt_11111111111111111111111111111111',
      'evt_22222222222222222222222222222222',
    ]);
  });

  it('bounds a hung analytics client and allows the next delivery to proceed', async () => {
    jest.useFakeTimers();
    const storage = new TrackerStorage();
    const client = new RecordingClient();
    client.gate = new Promise<void>(() => undefined);
    const { tracker } = createTracker(storage, client, 50);

    const hung = tracker.track('referral_link_clicked', CODE, 'invitee:hung001');
    await jest.advanceTimersByTimeAsync(50);
    await expect(hung).resolves.toBe('failed');

    client.gate = undefined;
    await expect(
      tracker.track('referral_link_clicked', CODE, 'invitee:next001'),
    ).resolves.toBe('accepted');
  });

  it('prevents a delayed startup flush from recreating state after reset', async () => {
    const storage = new TrackerStorage();
    const client = new RecordingClient();
    let release: (() => void) | undefined;
    client.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { tracker } = createTracker(storage, client);
    await storage.reservePendingAnalyticsEvent({
      name: 'referral_link_clicked',
      properties: {
        referral_code: CODE,
        platform: 'ios',
        event_id: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        flow_id: 'invitee:startup1',
        occurred_at_utc: NOW.toISOString(),
        schema_version: 1,
        app_version: '1.0.0',
      },
    });

    const flush = tracker.flushPending();
    await Promise.resolve();
    await Promise.resolve();
    tracker.resetLifecycle();
    storage.pending.clear();
    storage.milestones.clear();
    release?.();

    await expect(flush).resolves.toEqual({ accepted: 0, duplicate: 0, failed: 0 });
    expect(storage.pending.size).toBe(0);
    expect(storage.milestones.size).toBe(0);
  });

  it('hydrates the same cold-restart journey milestones without re-emitting analytics', async () => {
    const storage = new TrackerStorage();
    const client = new RecordingClient();
    const firstRuntime = createTracker(storage, client).tracker;
    const journey: ReferralAttribution = {
      referralCode: CODE,
      destination: REFERRAL_DESTINATION,
      kind: 'deferred',
      fingerprint: 'jrney01',
      receivedAt: NOW.toISOString(),
    };

    await firstRuntime.track('referral_link_generated', CODE, `referrer:${CODE}`);
    await firstRuntime.track(
      'referral_link_shared',
      CODE,
      `referrer:${CODE}:share:first`,
      { shareChannel: 'native-share' },
    );
    await firstRuntime.track('referral_link_clicked', CODE, 'invitee:jrney01', {
      attributionKind: 'deferred',
      isFirstSession: true,
    });
    await firstRuntime.track('referral_signup_completed', CODE, 'invitee:other01');
    const attemptsBeforeRestart = client.attempts.length;

    const restarted = createTracker(storage, client).tracker;
    const snapshot = await restarted.getAcceptedJourneySnapshot(journey);

    expect(snapshot.map(({ name }) => name)).toEqual([
      'referral_link_generated',
      'referral_link_shared',
      'referral_link_clicked',
    ]);
    expect(
      getAcceptedReferralMilestones(
        snapshot.map((event) => ({ event, delivery: 'accepted' as const })),
        CODE,
        journey.fingerprint,
      ).size,
    ).toBe(3);
    expect(client.attempts).toHaveLength(attemptsBeforeRestart);
  });
});
