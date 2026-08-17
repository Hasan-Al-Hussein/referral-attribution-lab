# Security and Privacy

## Trust model

Deep-link parameters, URL query strings, device storage, share outcomes, and analytics delivery are treated as untrusted or interruptible inputs. The mobile client is not an authority for account eligibility, anti-fraud decisions, or rewards.

## Controls implemented

- Referral codes are normalized and checked against a restricted alphabet and fixed length.
- Only the `onboarding/referral` destination is routable from a referral callback.
- Browser links accept HTTPS, with loopback HTTP allowed only for local development.
- Callback payloads are parsed into a small typed object. Raw provider objects are not stored or forwarded.
- Attribution fingerprints use SHA-256-derived identifiers and avoid storing email addresses in analytics records.
- Pending attribution expires after 30 days.
- Signup freezes the referral identity to prevent a later link from replacing an in-flight attribution.
- Duplicate callbacks and milestones are suppressed through durable receipts.
- Analytics events use an allowlisted event and diagnostic vocabulary.
- Android advertising ID permission is explicitly blocked.
- Provider keys, Firebase files, signing material, service-account keys, and `.env.local` are ignored by Git.
- Configuration validates Branch key mode, hostname-only domains, package IDs, and required files before native generation.
- The web demo has no provider credentials and performs no Firebase or Branch network delivery.

## Production requirements

Before using monetary rewards or real customer data, add an authenticated backend that owns:

- Globally unique referral-code issuance.
- Referral eligibility, expiry, self-referral prevention, abuse controls, and rate limits.
- Transactional signup acceptance and exactly-once reward settlement.
- Server-side event verification and an immutable reward ledger.
- Consent, retention, deletion, regional processing, and access-control policies.
- Secret storage, provider webhook verification, monitoring, and incident response.

## Dependency review

The dependency lock was refreshed with the compatible `npm audit fix` path, including patched `js-yaml` and `nanoid` transitive releases and current Expo 56 patch packages. After that remediation, `npm audit` reports 19 affected dependency nodes: 12 high and 7 moderate, with no critical findings. The count is a dependency-graph cascade rather than 19 independent vulnerabilities.

The unresolved findings reduce to build-toolchain advisories:

- `image-size` is pulled through Metro and has denial-of-service advisories in its ICNS, JXL, and HEIF parsers. The application does not accept user-supplied image files or invoke those parsers at runtime; exposure is limited to developer/CI bundling inputs controlled by the repository.
- `uuid` below 11.1.1 is pulled through Expo's `xcode` configuration parser and concerns caller-supplied buffers for UUID v3, v5, or v6. This application does not call those variants or pass buffers to them.

`npm audit fix --force` proposes downgrading the project to Expo 53 and React Native 0.72, which breaks the verified Expo 56 compatibility set and is not a safe remediation. The project therefore keeps its reproducible lock, restricts build inputs, runs tests and Prebuild inspection in CI, and will re-evaluate these advisories when compatible Metro/Xcode releases land. This is a documented residual build-time risk, not a claim of zero vulnerabilities.

Expo Doctor separately reports the Hermes V1 memory regression affecting the current Expo 56 / React Native 0.85 runtime. Expo identifies SDK 57 with React Native 0.86.2 or later as the compatible fix. That runtime migration should be performed as an intentional upgrade with native Prebuild, Android compilation, full regression tests, and physical-device profiling; it is not masked by downgrading or suppressing the check.

## Reporting a vulnerability

Please open a private GitHub security advisory for the repository. Do not include provider credentials, customer data, or exploit payloads in a public issue.
