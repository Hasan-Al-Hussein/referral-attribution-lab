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

`npm audit` currently reports 13 moderate findings and no high or critical findings. Twelve entries are a cascade through the Expo configuration toolchain. The concrete advisory is `uuid` below 11.1.1 through Expo's `xcode` parser and concerns caller-supplied buffers for UUID v3, v5, or v6. This application does not call those UUID variants or pass buffers to them.

The automated remediation proposes an incompatible downgrade from Expo 56 to Expo 46, so it was not applied. Dependencies remain locked to the Expo 56 compatibility set, and the advisory should be re-evaluated during the planned Expo 57 migration or when Expo updates its config-plugin dependency chain.

## Reporting a vulnerability

Please open a private GitHub security advisory for the repository. Do not include provider credentials, customer data, or exploit payloads in a public issue.
