import * as Crypto from 'expo-crypto';

import {
  ANALYTICS_SCHEMA_VERSION,
  APP_VERSION,
  isReferralEventRecord,
} from '../../domain/analytics';
import {
  DEFAULT_OPERATION_TIMEOUT_MS,
  withTimeout,
} from '../operationTimeout';

import type {
  AnalyticsClient,
  PlatformName,
  ReferralDiagnosticReason,
  ReferralEventName,
  ReferralEventProperties,
  ReferralEventRecord,
} from '../../domain/analytics';
import type { ReferralAttribution } from '../../domain/referral';
import type { ReferralStorage } from '../storage/referralStorage';

export type AnalyticsDelivery = 'accepted' | 'duplicate' | 'failed';
export type AnalyticsListener = (event: ReferralEventRecord, delivery: AnalyticsDelivery) => void;

interface TrackOptions {
  once?: boolean;
  attributionKind?: ReferralEventProperties['attribution_kind'];
  reason?: ReferralDiagnosticReason;
  shareChannel?: string;
  isFirstSession?: boolean;
  matchGuaranteed?: boolean;
}

export interface AnalyticsFlushResult {
  accepted: number;
  duplicate: number;
  failed: number;
}

class AnalyticsLifecycleCancelledError extends Error {}

export class AnalyticsTracker {
  private readonly listeners = new Set<AnalyticsListener>();
  private readonly inFlightMilestones = new Map<string, Promise<AnalyticsDelivery>>();
  private lifecycle = 0;

  constructor(
    private readonly client: AnalyticsClient,
    private readonly storage: ReferralStorage,
    private readonly platform: PlatformName,
    private readonly now: () => Date = () => new Date(),
    private readonly createEventId: () => string = () => Crypto.randomUUID(),
    private readonly timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  ) {}

  subscribe(listener: AnalyticsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetLifecycle(): void {
    this.lifecycle += 1;
    this.inFlightMilestones.clear();
  }

  async track(
    name: ReferralEventName,
    referralCode: string,
    flowId: string,
    options: TrackOptions = {},
  ): Promise<AnalyticsDelivery> {
    const lifecycle = this.lifecycle;
    const once = options.once ?? true;
    const milestoneKey = `${flowId}:${name}`;
    const properties: ReferralEventProperties = {
      referral_code: referralCode,
      platform: this.platform,
      event_id: this.nextEventId(),
      flow_id: flowId,
      occurred_at_utc: this.now().toISOString(),
      schema_version: ANALYTICS_SCHEMA_VERSION,
      app_version: APP_VERSION,
      ...(options.attributionKind ? { attribution_kind: options.attributionKind } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.shareChannel ? { share_channel: options.shareChannel } : {}),
      ...(options.isFirstSession !== undefined
        ? { is_first_session: options.isFirstSession }
        : {}),
      ...(options.matchGuaranteed !== undefined
        ? { match_guaranteed: options.matchGuaranteed }
        : {}),
    };
    const event: ReferralEventRecord = { name, properties };

    if (!isReferralEventRecord(event)) {
      if (this.isCurrent(lifecycle)) this.emit(event, 'failed');
      return 'failed';
    }

    if (!once) return this.deliverBestEffort(event, lifecycle);
    return this.deliverOnce(event, milestoneKey, true, lifecycle);
  }

  async flushPending(): Promise<AnalyticsFlushResult> {
    const lifecycle = this.lifecycle;
    const result: AnalyticsFlushResult = { accepted: 0, duplicate: 0, failed: 0 };
    let events: ReferralEventRecord[];
    try {
      events = await this.boundary(
        this.storage.getPendingAnalyticsEvents(),
        lifecycle,
        'analytics outbox read',
      );
    } catch {
      if (this.isCurrent(lifecycle)) result.failed += 1;
      return result;
    }

    for (const event of events) {
      if (!this.isCurrent(lifecycle)) break;
      const milestoneKey = `${event.properties.flow_id}:${event.name}`;
      const delivery = await this.deliverOnce(event, milestoneKey, false, lifecycle);
      if (!this.isCurrent(lifecycle)) break;
      result[delivery] += 1;
    }
    return result;
  }

  async getAcceptedJourneySnapshot(
    attribution: ReferralAttribution,
  ): Promise<ReferralEventRecord[]> {
    const lifecycle = this.lifecycle;
    try {
      const events = await this.boundary(
        this.storage.getAcceptedAnalyticsEvents(),
        lifecycle,
        'accepted analytics snapshot read',
      );
      const referrerFlowPrefix = `referrer:${attribution.referralCode}`;
      const inviteeFlow = `invitee:${attribution.fingerprint}`;
      return events.filter(({ name, properties }) => {
        if (properties.referral_code !== attribution.referralCode) return false;
        if (name === 'referral_link_generated' || name === 'referral_link_shared') {
          return properties.flow_id.startsWith(referrerFlowPrefix);
        }
        return properties.flow_id === inviteeFlow;
      });
    } catch {
      return [];
    }
  }

  private deliverOnce(
    event: ReferralEventRecord,
    milestoneKey: string,
    persistBeforeDelivery: boolean,
    lifecycle: number,
  ): Promise<AnalyticsDelivery> {
    const inFlightKey = `${lifecycle}:${milestoneKey}`;
    const existing = this.inFlightMilestones.get(inFlightKey);
    if (existing) return existing;

    const operation = this.deliverOnceUnlocked(
      event,
      milestoneKey,
      persistBeforeDelivery,
      lifecycle,
    );
    this.inFlightMilestones.set(inFlightKey, operation);
    void operation.then(
      () => this.clearInFlight(inFlightKey, operation),
      () => this.clearInFlight(inFlightKey, operation),
    );
    return operation;
  }

  private async deliverOnceUnlocked(
    event: ReferralEventRecord,
    milestoneKey: string,
    persistBeforeDelivery: boolean,
    lifecycle: number,
  ): Promise<AnalyticsDelivery> {
    let deliveryEvent = event;
    try {
      if (
        await this.boundary(
          this.storage.hasMilestone(milestoneKey),
          lifecycle,
          'analytics milestone read',
        )
      ) {
        await this.removePendingEventIgnoringFailure(event.properties.event_id, lifecycle);
        if (this.isCurrent(lifecycle)) this.emit(event, 'duplicate');
        return 'duplicate';
      }
      if (persistBeforeDelivery) {
        deliveryEvent = await this.boundary(
          this.storage.reservePendingAnalyticsEvent(event),
          lifecycle,
          'analytics outbox reservation',
        );
      }
      await this.boundary(
        this.client.logEvent(deliveryEvent),
        lifecycle,
        'analytics client delivery',
      );
      await this.boundary(
        this.storage.markMilestone(milestoneKey, deliveryEvent),
        lifecycle,
        'analytics milestone write',
      );
      await this.removePendingEventIgnoringFailure(
        deliveryEvent.properties.event_id,
        lifecycle,
      );
      if (this.isCurrent(lifecycle)) this.emit(deliveryEvent, 'accepted');
      return 'accepted';
    } catch (error) {
      if (!(error instanceof AnalyticsLifecycleCancelledError) && this.isCurrent(lifecycle)) {
        this.emit(deliveryEvent, 'failed');
      }
      return 'failed';
    }
  }

  private async deliverBestEffort(
    event: ReferralEventRecord,
    lifecycle: number,
  ): Promise<AnalyticsDelivery> {
    try {
      await this.boundary(
        this.client.logEvent(event),
        lifecycle,
        'analytics diagnostic delivery',
      );
      if (this.isCurrent(lifecycle)) this.emit(event, 'accepted');
      return 'accepted';
    } catch (error) {
      if (!(error instanceof AnalyticsLifecycleCancelledError) && this.isCurrent(lifecycle)) {
        this.emit(event, 'failed');
      }
      return 'failed';
    }
  }

  private async removePendingEventIgnoringFailure(
    eventId: string,
    lifecycle: number,
  ): Promise<void> {
    try {
      await this.boundary(
        this.storage.removePendingAnalyticsEvent(eventId),
        lifecycle,
        'analytics outbox removal',
      );
    } catch {
      // A stale outbox item is safe: the durable milestone suppresses redelivery.
    }
  }

  private async boundary<T>(
    operation: Promise<T>,
    lifecycle: number,
    operationName: string,
  ): Promise<T> {
    const result = await withTimeout(operation, operationName, this.timeoutMs);
    if (!this.isCurrent(lifecycle)) throw new AnalyticsLifecycleCancelledError();
    return result;
  }

  private isCurrent(lifecycle: number): boolean {
    return lifecycle === this.lifecycle;
  }

  private nextEventId(): string {
    return `evt_${this.createEventId().replaceAll('-', '').toLowerCase()}`;
  }

  private clearInFlight(
    key: string,
    operation: Promise<AnalyticsDelivery>,
  ): void {
    if (this.inFlightMilestones.get(key) === operation) {
      this.inFlightMilestones.delete(key);
    }
  }

  private emit(event: ReferralEventRecord, delivery: AnalyticsDelivery): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event, delivery);
      } catch {
        // Observers must not change analytics or business delivery semantics.
      }
    });
  }
}
