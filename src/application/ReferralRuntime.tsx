import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { createAnalyticsClient } from '../services/analytics/analyticsClient';
import {
  AnalyticsTracker,
  type AnalyticsDelivery,
} from '../services/analytics/AnalyticsTracker';
import { createDeepLinkService } from '../services/deepLinks/deepLinkService';
import { createMockReferralApi } from '../services/referrals/mockReferralApi';
import { createShareService } from '../services/share/shareService';
import { referralStorage } from '../services/storage/referralStorage';

import { createJourneySnapshotGuard } from './journeySnapshotGuard';
import { ReferralCoordinator } from './ReferralCoordinator';

import type { PlatformName, ReferralEventRecord } from '../domain/analytics';

export interface LedgerEntry {
  event: ReferralEventRecord;
  delivery: AnalyticsDelivery;
  sequence: number;
}

interface ReferralRuntimeValue {
  coordinator: ReferralCoordinator;
  events: LedgerEntry[];
  clearLedger(): void;
}

const ReferralRuntimeContext = createContext<ReferralRuntimeValue | null>(null);

function currentPlatform(): PlatformName {
  const value = Platform.OS as PlatformName;
  return ['android', 'ios', 'web', 'windows', 'macos'].includes(value) ? value : 'unknown';
}

export function ReferralRuntimeProvider({ children }: PropsWithChildren): React.JSX.Element {
  const runtime = useMemo(() => {
    const platform = currentPlatform();
    const tracker = new AnalyticsTracker(
      createAnalyticsClient(),
      referralStorage,
      platform,
    );
    const coordinator = new ReferralCoordinator(
      createDeepLinkService(),
      tracker,
      referralStorage,
      createMockReferralApi(referralStorage),
      createShareService(),
      platform,
    );
    return { tracker, coordinator };
  }, []);
  const [events, setEvents] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    let sequence = 0;
    const snapshotGuard = createJourneySnapshotGuard();
    const unsubscribe = runtime.tracker.subscribe((event, delivery) => {
      sequence += 1;
      setEvents((current) => [{ event, delivery, sequence }, ...current].slice(0, 30));
    });
    const unsubscribeJourney = runtime.coordinator.subscribeToJourney((attribution) => {
      const isCurrentSnapshot = snapshotGuard.begin(attribution.fingerprint);
      void runtime.tracker.getAcceptedJourneySnapshot(attribution).then((snapshot) => {
        if (!isCurrentSnapshot()) return;
        setEvents((current) => {
          if (!isCurrentSnapshot()) return current;
          const knownEventIds = new Set(
            current.map(({ event }) => event.properties.event_id),
          );
          const hydrated = snapshot
            .filter(({ properties }) => !knownEventIds.has(properties.event_id))
            .map((event) => {
              sequence += 1;
              return { event, delivery: 'accepted' as const, sequence };
            });
          return [...hydrated.reverse(), ...current].slice(0, 30);
        });
      });
    });
    runtime.coordinator.start();
    return () => {
      snapshotGuard.dispose();
      unsubscribe();
      unsubscribeJourney();
      runtime.coordinator.stop();
    };
  }, [runtime]);

  const value = useMemo<ReferralRuntimeValue>(
    () => ({ coordinator: runtime.coordinator, events, clearLedger: () => setEvents([]) }),
    [events, runtime.coordinator],
  );

  return (
    <ReferralRuntimeContext.Provider value={value}>
      {children}
    </ReferralRuntimeContext.Provider>
  );
}

export function useReferralRuntime(): ReferralRuntimeValue {
  const value = useContext(ReferralRuntimeContext);
  if (!value) throw new Error('useReferralRuntime must be used within ReferralRuntimeProvider');
  return value;
}
