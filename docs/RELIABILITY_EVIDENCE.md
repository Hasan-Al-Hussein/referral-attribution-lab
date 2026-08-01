# Reliability Evidence

This document separates what the repository proves automatically from what still requires external systems, signed builds, or physical devices.

## Verification matrix

| Capability | Automated evidence | Remaining external evidence |
| --- | --- | --- |
| Referral normalization and validation | Unit tests cover whitespace, case, alphabet, destinations, expiry, malformed inputs, and untrusted URLs | None for the pure domain policy |
| Stable referral identity | Deterministic storage tests cover creation, restart, corruption rejection, and concurrent generation | Global uniqueness must be enforced by a production API |
| Direct and deferred callback handling | Coordinator tests cover warm, cold, first-session, duplicate, invalid, and early-navigation cases | Real Branch delivery on signed physical-device builds |
| Attribution durability | Storage and coordinator tests cover persistence-before-routing, expiry, migration, accepted receipt recovery, and reset epochs | Production backup and multi-device account policy |
| Event delivery | Analytics tests cover typed properties, outbox retries, stable event IDs, milestone receipts, and duplicate suppression | Firebase DebugView or warehouse ingestion from a configured app |
| Signup idempotency | Mock API tests cover canonical identity, concurrent calls, conflict behavior, timeout, and accepted receipt recovery | Transactional production account and reward services |
| Native configuration | Config tests and prebuild scripts inspect package IDs, Branch mode, domains, Android intent filters, iOS entitlements, and Firebase files | Domain association files, provider dashboard routing, signing, and stores |
| Interface behavior | Production web export plus responsive and reduced-motion implementation | Physical accessibility and device interaction pass |

## Failure cuts modeled

The test suite exercises interruption or duplication at the following boundaries:

1. After a callback is accepted but before navigation is ready.
2. After attribution is persisted but before analytics delivery.
3. During simultaneous callback and signup operations.
4. After the mock backend accepts signup but before completion side effects finish.
5. During reset epoch publication and stale-writer cleanup.
6. During repeated direct or deferred callback delivery.
7. During share cancellation, clipboard fallback, timeout, or failure.

## Honest proof boundary

Generated projects and CI can prove native structure and Android compilation without contacting providers. They cannot prove a real Branch callback, App Links or Universal Links association, a store-mediated deferred install, Firebase network ingestion, or production reward settlement.

Those claims require the runbook in [NATIVE_PROOF_RUNBOOK.md](NATIVE_PROOF_RUNBOOK.md), provider projects controlled by the operator, signed builds, configured web association files, physical devices, and a backend that owns eligibility and settlement.

## Reproduce locally

```bash
npm ci
npm run typecheck
npm run lint
npm test -- --coverage
npm run build:web
npx expo-doctor
```

Use `npm run native:verify:android` or `npm run native:verify:ios` only after supplying the non-secret test variables and package-correct Firebase fixtures described in the native runbook.
