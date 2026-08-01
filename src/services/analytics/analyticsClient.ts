import type { AnalyticsClient, ReferralEventRecord } from '../../domain/analytics';

export class DemoAnalyticsClient implements AnalyticsClient {
  async logEvent(event: ReferralEventRecord): Promise<void> {
    // The demo ledger is fed by AnalyticsTracker. This adapter intentionally
    // has no network side effects in the credential-free web build.
    void event;
  }
}

export function createAnalyticsClient(): AnalyticsClient {
  return new DemoAnalyticsClient();
}
