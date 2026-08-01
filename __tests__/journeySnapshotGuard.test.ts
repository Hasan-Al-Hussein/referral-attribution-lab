import { describe, expect, it } from '@jest/globals';

import { createJourneySnapshotGuard } from '../src/application/journeySnapshotGuard';

describe('journey snapshot hydration guard', () => {
  it('rejects a delayed journey A snapshot after journey B becomes current', () => {
    const guard = createJourneySnapshotGuard();
    const acceptA = guard.begin('fingerprint-a');
    const acceptB = guard.begin('fingerprint-b');

    expect(acceptA()).toBe(false);
    expect(acceptB()).toBe(true);
  });

  it('rejects every delayed snapshot after provider disposal', () => {
    const guard = createJourneySnapshotGuard();
    const accept = guard.begin('fingerprint-a');

    guard.dispose();

    expect(accept()).toBe(false);
  });
});
