# Changelog

This file records source changes. Initial version `0.1.0` was published publicly to npm `latest` on 2026-11-19 through the owner-authorized local bootstrap without provenance; registry integrity was verified. Live AWS integration remains unverified.

## Unreleased

### Fixed

- Require release-tag commits to belong to `origin/main` history before dependency installation or publishing; reject shallow or unavailable source history.
- Replace release-operator notes and stale version claims in the README with installation and tested compatibility information.

## [0.1.1] - 2026-11-19

### Changed

- Update installation and release documentation to reflect the verified public `0.1.0` bootstrap and public GitHub repository.
- Document the one-time local bootstrap exception separately from the GitHub OIDC/provenance release policy and record exact artifact verification evidence.
- Prepare the first GitHub Actions trusted-publisher release; publication and provenance must be verified from the registry after the workflow completes.
- No CloudFront runtime behavior changes. Live AWS validation remains outside this documentation/release patch.

## [0.1.0] - 2026-11-18

### Added

- Initial self-hosted n8n CloudFront node: List Distributions, Get Distribution, Create Invalidation, Get Invalidation and List Invalidations.
- Explicit AWS credentials with optional session token and distribution-scoped credential testing; manual or credential-backed distribution selection.
- Official CloudFront SDK transport using the commercial global endpoint and `us-east-1` signing, bounded attempts and timeouts, sanitized errors, stable idempotency inputs and mutation preflight.
- One output envelope per input item, list pagination and empty-list handling.
- Offline tests, package/artifact checks and a pinned self-hosted n8n smoke harness; these do not verify real AWS permissions or production behavior.
- Sanitized inactive Create → Wait → Get example, least-privilege guidance, Redis/data/HTML/CDN ordering guide, provenance notices and OIDC release procedures.

### Compatibility

- Node.js 24.x, n8n 2.48.4 baseline, aligned `n8n-workflow` 2.48.2, AWS SDK 3.1171.0 and node CLI 0.57.4.
- Only the commercial global CloudFront endpoint is supported. Other AWS services and n8n Cloud verification are not included.
- Public GitHub source and a one-time local `0.1.0` bootstrap to `latest` without provenance are authorized. npm ownership is established only by registry acceptance; future OIDC/provenance releases still require trusted-publisher and protected-environment setup.

### Verification

- Reproducible `npm ci`; lint and typecheck passed (one advisory themed-icon warning).
- 80 deterministic tests passed; release build and packed-artifact allowlist passed.
- Packed artifact installed into isolated n8n 2.48.4: all five operations executed through the real CLI workflow engine, 14 linked items and 14 offline SDK commands; editor discovery and credential masking observed.
- Live AWS completion and an OIDC/npm prerelease remain unverified and require separate authorization and external prerequisites.
