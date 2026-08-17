# Reliability Evidence

This document maps important referral guarantees to deterministic repository evidence and separates them from claims that still require providers, signed builds, stores, or physical devices.

## Verification snapshot

| Gate | Verified result |
| --- | --- |
| `npm run typecheck` | Passed with no emit |
| `npm run lint` | Passed with zero warnings |
| `npm test -- --runInBand` | 12 suites, 174 tests passed |
| `npm test -- --runInBand --coverage` | 90.40% statements, 82.63% branches, 90.82% functions, 93.22% lines |
| `npx expo-doctor` | 21 of 22 checks passed; dependency alignment passed and the known Expo 56 Hermes regression remains |
| `npm run build:web` | Production Expo web bundle generated |
| Native structure CI | Android/iOS Prebuild inspected; Android debug binary compiled with non-networked fixtures |

Coverage is used as a gap signal, not a completeness claim. Critical coordination, analytics, storage, share, and reset behavior is tested by observable outcome rather than by percentage alone.

### Coverage by critical subsystem

| Subsystem | Statements | Lines |
| --- | ---: | ---: |
| `ReferralCoordinator` | 90.41% | 94.62% |
| `AnalyticsTracker` | 93.93% | 95.40% |
| `referralStorage` | 87.52% | 90.54% |
| `runReferralShare` | 100% | 100% |
| `commitDemoReset` | 100% | 100% |

## Capability matrix

| Capability | Deterministic repository proof | Remaining external proof |
| --- | --- | --- |
| Referral normalization and validation | Whitespace, case, alphabet, route, expiry, malformed input, and untrusted-URL tests | None for the pure domain policy |
| Stable referral identity | Creation, restart, corruption rejection, concurrent generation, and per-epoch persistence tests | Global uniqueness from a production API |
| Direct callback handling | Warm, cold, early-navigation, duplicate, invalid, and replay tests | Real Universal/App Link delivery on a signed build |
| Deferred callback handling | First-session metadata, persist-before-route, cold restore, and deterministic browser fixture | Store-mediated app-not-installed → install → first-launch delivery |
| Attribution durability | Migration, accepted-receipt recovery, frozen identity, expiry, and reset-epoch tests | Production multi-device and backup policy |
| Event delivery | Typed properties, stable IDs, outbox retries, milestone receipts, and duplicate suppression | Firebase DebugView or warehouse ingestion |
| Signup idempotency | Canonical identity, concurrent calls, conflicts, timeouts, and accepted-receipt recovery | Transactional account, eligibility, and reward services |
| Native configuration | Branch modes, domains, package IDs, Firebase files, intent filters, entitlements, and generated runtime probes | Provider dashboard configuration, signing, and domain association |
| Product interface | Production web export, responsive implementation, semantic labels, keyboard focus, and reduced-motion behavior | Physical-device accessibility and interaction pass |

## Selected adversarial review resolutions

These are the highest-value failure modes modeled by the suite.

| Risk | Engineering resolution | Deterministic evidence |
| --- | --- | --- |
| Link intake and signup mutate the journey concurrently | Callback, start, and completion share one serialized transition boundary; freeze prevents replacement | Controlled link-versus-freeze interleaving |
| Accepted signup is relabeled failed because analytics or cleanup times out | Backend receipt is the commit point; post-commit telemetry and cleanup are retryable | Analytics timeout, cleanup failure, cumulative latency, and receipt retry |
| Reset reports success before durable state changes | Active-epoch pointer publication is the reset commit; failed publication keeps the previous epoch authoritative | Rejected pointer, hung read/write, retry, and cold reload |
| A late old-epoch write overwrites the new session | Every mutation checks the current generation; stale writes are repaired behind the winning pointer | Late-write, same-turn overlap, and simulated reload tests |
| Branch subscription setup fails during startup | SDK setup is isolated; outbox flush and pending/accepted restoration still execute | Subscribe-throws recovery test |
| Legacy storage is lost during upgrade | Valid codes, journeys, receipts, milestones, processed fingerprints, and outbox entries migrate into the active epoch | Baseline and extended migration fixtures |
| Same code is reused across different invitees | Referrer milestones are code-scoped; clicked/start/completed require the exact invitee fingerprint | Same-code/different-fingerprint progress tests |
| Weak callback hashing collides | Callback identity uses SHA-256 truncated to 128 bits; legacy fingerprints remain read-only compatibility | Supplied collision, numeric timestamp, replay stability, and legacy persistence tests |
| Corrupt local records remain physically stored | Every read path bounds and canonicalizes valid data or removes malformed records under a per-key lock | Poisoned marker, milestone, outbox, receipt, and cleanup/write race tests |
| Crash occurs after backend acceptance but before success presentation | Accepted attribution and receipt restore analytics, cleanup, and navigation after restart | Three post-receipt commit-to-presentation cuts |
| Outbox record has a valid shape but the wrong immutable identity | Reservation compares the complete event identity and replaces poisoned collisions before delivery | Wrong-code and wrong-platform collision tests |
| Reset occurs while post-commit completion work is still running | Acceptance remains recoverable, while lifecycle cancellation prevents stale-screen navigation | Reset-during-analytics and reset-during-cleanup tests |
| Attribution digest never settles | Parsing and digest work is bounded by coordinator lifecycle; reset opens a fresh queue | Never-settling digest, reset, and fresh callback |
| Native test keys are accidentally configured as production | Test/live Branch variables are validated and mapped explicitly; invalid prefixes fail closed | Development, preview, production, legacy-alias, and negative probes |
| Product actions wait on one cumulative analytics timeout | Each storage/provider stage is independently bounded and instrumentation is non-blocking | Delayed-but-in-budget generate/share/start/complete tests |

## Five-event contract

| Event | Accepted condition |
| --- | --- |
| `referral_link_generated` | A stable code and usable Branch or reviewer URL both resolve |
| `referral_link_shared` | The platform reports a successful share handoff |
| `referral_link_clicked` | A valid, non-duplicate attribution callback is persisted |
| `referral_signup_started` | Referred signup begins and freezes its originating identity |
| `referral_signup_completed` | Account/referral acceptance succeeds and a receipt exists |

Every required event carries:

- normalized `referral_code`
- `platform`
- random 128-bit `event_id`, stable for retries of one outbox record
- `flow_id`
- `schema_version`
- `app_version`
- `occurred_at_utc`
- optional direct/deferred classification and first-session context

### Failure and diagnostic coverage

- `referral_link_generation_failed`
- `referral_link_share_cancelled`
- `referral_link_share_failed`
- `referral_deeplink_resolution_failed`
- `referral_code_rejected`
- `referral_signup_failed`
- `referral_state_cleanup_failed`
- `referral_duplicate_suppressed`

Diagnostics use bounded reason values. Untrusted URLs, raw provider payloads, email addresses, and credentials are not forwarded as event properties.

## Failure cuts exercised

1. Callback accepted before navigation is ready.
2. Attribution persisted before analytics delivery.
3. Callback and signup operations overlap.
4. Backend accepts signup before completion analytics.
5. Backend accepts signup before local cleanup.
6. Backend accepts signup before Success navigation.
7. Reset pointer publication fails or stalls.
8. An obsolete reset write settles after a newer winner.
9. Direct or deferred callbacks are replayed.
10. Share is cancelled, unavailable, times out, or fails.
11. Local data is truncated, malformed, oversized, or from a legacy schema.
12. Native SDK configuration is incomplete, mismatched, or uses the wrong environment mode.

## Native configuration evidence

The repository evaluates native configuration without committing provider credentials:

- Branch test and live keys are separated and prefix-validated.
- Test mode is enabled only for development/preview configuration.
- Android and iOS Firebase files must match the expected package/bundle identifier.
- Branch domains are hostname-only, unique, and present in the generated platform configuration.
- Android intent filters and install-referrer wiring are inspected after Prebuild.
- iOS associated domains and NativeLink runtime options are inspected after Prebuild.
- CI compiles an Android debug binary with package-correct, non-networked fixtures.

This proves configuration generation and compilation. It does not prove provider network startup or link association on a signed device.

## Honest proof boundary

Repository tests and CI prove:

- parser and domain policy
- persistence, ordering, retries, migration, and recovery
- event schema and adapter call shape
- deterministic browser behavior
- generated Android/iOS configuration structure
- Android compilation with local fixtures

They do not prove:

- real Branch dashboard routing
- Android `assetlinks.json` or iOS AASA association
- a physical cold/warm callback
- store-mediated deferred installation
- Firebase DebugView or warehouse ingestion
- global code uniqueness
- production authentication, fraud rules, or reward settlement

Those claims require configured provider projects, matching signed builds and domains, physical devices, Play internal testing or TestFlight, and an authoritative backend. The exact procedure is documented in [NATIVE_PROOF_RUNBOOK.md](NATIVE_PROOF_RUNBOOK.md).

## Reproduce locally

```bash
npm ci
npm run typecheck
npm run lint
npm test -- --coverage
npm run build:web
npx expo-doctor
```

Use `npm run native:verify:android` or `npm run native:verify:ios` only after supplying the safe variables and package-correct Firebase fixtures described in the native runbook.
