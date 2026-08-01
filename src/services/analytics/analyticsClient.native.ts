import { getAnalytics, logEvent } from '@react-native-firebase/analytics';

import type { AnalyticsClient, ReferralEventRecord } from '../../domain/analytics';

function normalizeFirebaseProperties(event: ReferralEventRecord) {
  return Object.fromEntries(
    Object.entries(event.properties).map(([key, value]) => [
      key,
      typeof value === 'boolean' ? Number(value) : value,
    ]),
  );
}

export class FirebaseAnalyticsClient implements AnalyticsClient {
  async logEvent(event: ReferralEventRecord): Promise<void> {
    await Promise.resolve(
      logEvent(getAnalytics(), event.name, normalizeFirebaseProperties(event)),
    );
  }
}

export function createAnalyticsClient(): AnalyticsClient {
  return new FirebaseAnalyticsClient();
}
