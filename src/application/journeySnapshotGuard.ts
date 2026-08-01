export interface JourneySnapshotGuard {
  begin(fingerprint: string): () => boolean;
  dispose(): void;
}

export function createJourneySnapshotGuard(): JourneySnapshotGuard {
  let revision = 0;
  let currentFingerprint: string | undefined;
  let disposed = false;

  return {
    begin(fingerprint) {
      revision += 1;
      currentFingerprint = fingerprint;
      const snapshotRevision = revision;
      return () =>
        !disposed &&
        snapshotRevision === revision &&
        currentFingerprint === fingerprint;
    },
    dispose() {
      disposed = true;
      revision += 1;
      currentFingerprint = undefined;
    },
  };
}
