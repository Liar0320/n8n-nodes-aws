# Verification evidence

## Verified local surface

- Node.js `v24.13.0`, npm `11.6.2`, self-hosted n8n `2.48.4`, development API `n8n-workflow@2.48.2`.
- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org` repaired an initial npm-generated transitive `ignore` lock mismatch. Subsequent `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org` succeeded: 551 packages installed.
- `npm run lint`: zero errors, one advisory warning about the original single-file icon lacking separate themed variants. It renders visibly in the dark n8n editor.
- `npm run typecheck`: passed.
- `npm test`: 80 tests passed, zero failed/skipped. Tests cover real SDK SigV4 signing and XML deserialization with fake long-lived/session credentials; node execution, paths, CallerReference conflicts/retries, pagination, empty lists, errors, per-item behavior, completion-state example boundaries, and release validation/tampering.
- `npm run build`: official `n8n-node build` succeeded.
- `npm run check:pack`: allowlisted packed runtime, registered node/credential, icon, codex and documentation; rejects source/tests/unrelated files, common credential patterns and embedded source content in maps; verifies archive/manifest/integrity agreement.
- `N8N_SMOKE_RUNTIME=/tmp/n8n-aws-runtime npm run smoke:n8n`: passed after installing the checked tarball into a new isolated community-node directory, not a symlink. The actual n8n CLI imported fake credentials/workflows and executed five multi-node workflows with normal expressions and item-link resolution. Default successful smoke removes its temporary install, fixtures, credentials, SQLite database and workflows. For a clean runtime installation, omit `N8N_SMOKE_RUNTIME`.

| Actual n8n operation | Linked inputs | Intercepted SDK commands |
| --- | ---: | ---: |
| List Distributions | 3 | 4 |
| Get Distribution | 4 | 3 |
| Create Invalidation | 3 | 2 |
| Get Invalidation | 2 | 2 |
| List Invalidations | 2 | 3 |

The difference between item and request counts includes explicit pagination, local validation errors and AWS-error simulation. The smoke asserts exact command inputs, fake credentials, returned data, safe errors, multi-item expression resolution, `pairedItem`, empty lists and continue-on-fail; it blocks external network sockets during execution. This is **offline engine evidence**, not an AWS integration run.

## Observed editor UI

The same packed artifact was installed into a separate throwaway community-node directory and opened in n8n's real editor on loopback. The node picker displayed **AWS CloudFront**, **Installed**, **Via npm**, and all five actions. Create Invalidation displayed manual Distribution ID by default, blank Paths and Caller Reference, and the explicit wildcard/partial-effects/submission-not-completion notice. The credential dialog displayed Access Key ID, Secret Access Key, optional Session Token and Test Distribution ID; browser inspection confirmed secret/token controls have `type=password`. No real AWS credentials were entered and no node was executed from that UI.

## Failures corrected during verification

- SDK `MaxItems` changed to numeric in the pinned current SDK; corrected compile errors instead of preserving older string examples.
- n8n's current tool-support type disallows `false`; omitted unsafe AI-tool exposure and documented the narrow lint exception.
- Exact `.node.ts` test import avoids resolution to adjacent `.node.json`; release tests use `.mts` to preserve ESM import semantics.
- macOS temporary-directory `/var` aliases canonicalized for the non-symlink artifact assertion.
- Isolated n8n broker/HTTP ports allocated separately; removed obsolete runner-enable configuration.
- n8n raw CLI JSON goes through its info logger, so smoke uses info level rather than suppressing its own evidence.
- Smithy's current request timeout only warns unless `throwOnRequestTimeout` is enabled; the client enables it to enforce the documented bound.

## Unverified external acceptance

The designated `https://github.com/Liar0320/n8n-nodes-aws` repository is now public with owner authorization. Implementation PR #1 has passing CI. npm account `lich0320` is authenticated locally; the registry returned E404 for the package before bootstrap, which is not proof of name control. A protected GitHub `npm` environment and trusted-publisher mapping remain prerequisites for automated publishing.

No approved non-production AWS distribution, scoped test paths or credentials were supplied. Therefore live discovery, live IAM/session-token acceptance and Create → Wait → Get reaching AWS-confirmed Completed remain unverified. No production AWS/Redis/workflow action was performed.

The owner authorized one local public bootstrap of `n8n-nodes-aws@0.1.0` to `latest` without provenance. This authorization does not prove publication and does not authorize PR merging, release tags, GitHub Releases, production n8n installation or live AWS mutations. Record the registry version/integrity after the publish command succeeds. Future automated releases retain OIDC/provenance requirements, protected-environment setup and explicit release authorization. Deterministic tests and publish dry-runs do not prove a successful remote publication.

## Verified local bootstrap publication

On 2026-11-19, `npm publish .artifacts/package/n8n-nodes-aws-0.1.0.tgz --ignore-scripts --access public --tag latest --provenance=false --registry=https://registry.npmjs.org/` returned success after an npm browser authentication challenge. The first registry lookup briefly exposed the `0.0.0-stage` placeholder; no second upload was attempted. Subsequent authenticated registry queries confirmed version `0.1.0`, maintainer `lich0320`, and `latest: 0.1.0`.

- SHA-512 integrity: `sha512-aP9VWYFiMOkNc9jGT3LprkovEbttLnAzOHEyGnGUveS+I/c6fy3LGWuU9FZHIiw7x7ZquA1K1BdNqc5RmB+f8w==`, matching the checked artifact.
- Registry SHA-1: `8d8e271483e8647f3639a71337f56e914c8531ee`.
- `npm run validate` passed: 80 tests, type checking, build and 27-file artifact allowlist; lint retained one advisory themed-icon warning.
- A fresh smoke-runtime installation exceeded the command deadline. Retrying with the existing isolated n8n 2.48.4 runtime passed all five operations, 14 linked items and 14 deterministic offline SDK commands against this exact artifact; temporary test state was removed.
- This bootstrap has no provenance. No tag, GitHub Release, production n8n installation or AWS mutation was performed. These post-publication documentation updates are not part of the immutable published tarball; do not rebuild and republish `0.1.0`.

## Verified GitHub OIDC release 0.1.1

On 2026-11-19, the owner authorized the next package release. Commit `8432657ec2c3cf50c0113ebd0b3924c9c303dfc1` and tag `v0.1.1` triggered [Release run 44445695038](https://github.com/Liar0320/n8n-nodes-aws/actions/runs/44445695038). Both `publish` and `github-release` jobs succeeded. No PR merge or AWS mutation was performed.

- The registry confirmed version `0.1.1` and `latest: 0.1.1`; its SHA-512 integrity matched the checked local/CI artifact: `sha512-ziowmdNOd7h8aIGxWjXoyTwmrwQLvSeB+pkipnz7rvpjqnbrucJLWdAxB3+hyPiXWN16oPGcG9Ag65cTNfb3qg==`.
- Registry publisher metadata identifies `GitHub Actions` with `trustedPublisher.id: github`, and `dist.attestations.provenance.predicateType` is `https://slsa.dev/provenance/v1`.
- [GitHub Release v0.1.1](https://github.com/Liar0320/n8n-nodes-aws/releases/tag/v0.1.1) is published, not draft or prerelease. An initial version lookup briefly returned E404; direct registry verification subsequently succeeded without any repeated publish.
- Local validation passed 80 tests, build, typecheck, package checks and the isolated n8n five-operation smoke. CI repeated validation and packed n8n smoke successfully.
- At release preflight, GitHub environment `npm` allowed tag pattern `v*`, had administrator bypass enabled and no `required_reviewers` rule in the saved API response. The release was not held for human environment approval; this is not evidence of an approval gate being exercised.
- CI emitted advisory warnings for checkout/setup-node v4 action runtimes and the existing themed-icon warning; these did not fail this release.
- This section was added after publication and is not part of the immutable `0.1.1` tarball. Live AWS behavior remains unverified.
