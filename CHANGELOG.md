# Changelog

This file records source changes. A dated version section is release metadata, not proof that a version was published. No npm release or live AWS integration run has been verified for this initial source delivery.

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
- Initial source version; the designated private GitHub repository and admin access are verified. Publication and npm ownership remain unverified; private-source provenance and release-environment setup are external release blockers.

### Verification

- Reproducible `npm ci`; lint and typecheck passed (one advisory themed-icon warning).
- 80 deterministic tests passed; release build and packed-artifact allowlist passed.
- Packed artifact installed into isolated n8n 2.48.4: all five operations executed through the real CLI workflow engine, 14 linked items and 14 offline SDK commands; editor discovery and credential masking observed.
- Live AWS completion and an OIDC/npm prerelease remain unverified and require separate authorization and external prerequisites.
