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

The user subsequently created the designated `https://github.com/Liar0320/n8n-nodes-aws` repository as **private**. `gh repo view` verifies `viewerPermission: ADMIN`, private visibility and initially empty refs; the Actions permissions API reports enabled Actions with read-only default workflow permissions. Remote existence/access is resolved. `npm view n8n-nodes-aws name version maintainers --json` previously returned structured E404; npm ownership remains unverified. The repository environments API currently returns no environments; a protected `npm` release environment is not configured.

No approved non-production AWS distribution, scoped test paths or credentials were supplied. Therefore live discovery, live IAM/session-token acceptance and Create → Wait → Get reaching AWS-confirmed Completed remain unverified. No production AWS/Redis/workflow action was performed.

Branch pushes and a review PR are authorized; no PR merge, release tag, npm publish, GitHub Release, repository visibility change or production n8n installation is authorized or performed. The OIDC/provenance publishing route still requires npm ownership/bootstrap/trusted-publisher mapping, a protected `npm` environment and explicit prerelease authorization. npm's current provenance prerequisites additionally require a public source repository; this designated repository remains private. Deterministic release tests do not prove a successful remote publication.
