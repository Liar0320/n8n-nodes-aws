# n8n-nodes-aws

AWS CloudFront distribution discovery and cache invalidation for n8n. The package currently implements **one node**, CloudFront (`n8n-nodes-aws.awsCloudFront`), with five operations. Future AWS services should be separate nodes sharing only useful infrastructure; there are no empty service nodes.

## Availability and compatibility

`n8n-nodes-aws@0.1.0` is published publicly on [npm](https://www.npmjs.com/package/n8n-nodes-aws) under `latest`. The owner-authorized local bootstrap used npm account `lich0320` without provenance; registry integrity matched the validated tarball. The [GitHub repository](https://github.com/Liar0320/n8n-nodes-aws) is public and PR #1 CI passed. Future automated releases retain GitHub OIDC/provenance requirements; this release does not authorize production actions or claim live AWS verification.

The development compatibility baseline is:

| Component | Version / scope |
| --- | --- |
| Node.js | 24.x (`>=24 <25`) |
| n8n runtime | 2.48.4 baseline |
| `n8n-workflow` | 2.48.2 development API, aligned with n8n 2.48.4 |
| AWS CloudFront SDK | `@aws-sdk/client-cloudfront` 3.1171.0 |
| n8n node CLI | 0.57.4 |

Supported deployment scope is **self-hosted n8n**, not n8n Cloud verification. The official AWS SDK runtime dependency is intentional; the package is not a verified Cloud-installable package. Dependency ranges are not a claim that every n8n release has been exercised. Use the pinned baseline for initial validation; see the [changelog](CHANGELOG.md) for release status. This package supports only the AWS **commercial global CloudFront endpoint** `cloudfront.amazonaws.com`, signed with SigV4 region `us-east-1`. It does not expose endpoint/region overrides and does not support China or GovCloud partitions.

Verified locally on Node 24.13.0 and npm 11.6.2: 80 deterministic tests, build, packed-artifact checks, and all five operations through n8n 2.48.4's real CLI workflow engine (14 linked input items / 14 intercepted SDK commands). The installed node and masked credential fields were also inspected in the n8n editor. This is offline runtime verification, not live AWS or npm publication evidence; see [verification details](docs/verification.md).

## Installation

For self-hosted n8n, install `n8n-nodes-aws` through **Settings → Community Nodes**; the verified initial npm version is `0.1.0`. For a reviewed local checkout, use Node 24 and the repository lockfile:

```sh
npm ci
npm run validate
npm run smoke:n8n
```

For a non-production self-hosted n8n development instance, install the resulting tarball into its community-node directory, then restart that instance:

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install /absolute/path/to/checkout/.artifacts/package/n8n-nodes-aws-0.1.0.tgz
```

Use the actual tarball name emitted by the pack check under `.artifacts/package/`. Container deployments need the installed files in the persistent community-node directory or in a reviewed image; installing inside an ephemeral container does not survive recreation. Community-node loading must be enabled. After a verified publication, self-hosted administrators can install the verified package/version through **Settings → Community Nodes**. This package does not support n8n Cloud installation or claim Cloud verification.

## Credentials and least privilege

Create **AWS CloudFront API** credentials (`awsCloudFrontApi`):

* `accessKeyId`: required AWS access key ID.
* `secretAccessKey`: required secret access key, stored as a password field.
* `sessionToken`: optional token; include it for temporary STS credentials. The node does not refresh expiring sessions.
* `testDistributionId`: optional distribution to use when testing access. Without it, credential testing requires `cloudfront:ListDistributions`; with it, testing requires `cloudfront:GetDistribution` for that distribution.
No default AWS credential chain, instance-role discovery, or ambient credentials are required in place of these fields. Never put credentials in workflow JSON, path fields, screenshots, logs, or caller references. Prefer short-lived credentials and normal n8n credential access controls.

Grant only the actions used by the workflow:

| Operation / feature | IAM action | Resource |
| --- | --- | --- |
| List Distributions; distribution dropdown | `cloudfront:ListDistributions` | `*` |
| Get Distribution; targeted credential test | `cloudfront:GetDistribution` | distribution ARN |
| Create Invalidation | `cloudfront:CreateInvalidation` | distribution ARN |
| Get Invalidation | `cloudfront:GetInvalidation` | distribution ARN |
| List Invalidations | `cloudfront:ListInvalidations` | distribution ARN |

For a create-and-poll workflow, the following policy deliberately excludes account-wide discovery. Replace both placeholders before use:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
    "Resource": "arn:aws:cloudfront::123456789012:distribution/REPLACE_DISTRIBUTION_ID"
  }]
}
```

Add the other actions only when needed. Distribution ARNs have no region segment. The **From List** picker requires account-wide list permission even if execution only creates invalidations; use manual mode to avoid that permission.

## Operation reference

The node's internal name is `awsCloudFront`; its workflow type is `n8n-nodes-aws.awsCloudFront`. Select an operation using `operation`:

| Display operation | Value | Required operation inputs | Result payload |
| --- | --- | --- | --- |
| List Distributions | `listDistributions` | pagination fields | distribution summaries |
| Get Distribution | `getDistribution` | distribution selector | one distribution |
| Create Invalidation | `createInvalidation` | distribution selector, `paths`, `callerReference` | created or idempotently reused invalidation |
| Get Invalidation | `getInvalidation` | distribution selector, `invalidationId` | one invalidation and its status |
| List Invalidations | `listInvalidations` | distribution selector, pagination fields | invalidation summaries |

### Distribution selection

All operations except List Distributions accept `distributionIdMode`, which defaults to `manual`. In manual mode, provide the distribution ID in `distributionId` (not the domain, ARN, or URL). In `list` mode, select `distributionIdList` from the credential-backed dropdown. Expressions are supported through normal n8n parameter evaluation. Dropdown discovery is a separate AWS call; it is not the result pagination of a list operation.

### Lists, items, and pagination

Both list operations have `returnAll` (default `false`), `pageSize` (default `100`, integer `1–100`), and `marker` (default blank). A blank marker starts from the beginning. With Return All off, a request returns one AWS page. With Return All on, the node follows the AWS markers from the starting marker and collects the remaining pages, not necessarily all records from the beginning. Large accounts can consume time and memory; use explicit pages when appropriate.

AWS pagination is not a snapshot: concurrent changes can affect page contents. Treat returned markers as opaque and resume with the same operation and distribution. Use `nextMarker`, not an array length, to decide whether another page exists. The node detects non-advancing pagination instead of looping indefinitely. Call failures are not silently converted into a partial successful list.

Each input item is processed independently and produces **one output envelope**, including when a list has no results (`[]`). List results are not automatically split into n8n items. List envelopes have `nextMarker: null` at the end; `returnAll` exhausts the remaining pages. Non-list results do not include pagination fields. Use an n8n Split Out node if a downstream step requires one item per record. Pairing preserves the relationship to the input item. The node does not reorder input items or guarantee AWS-side ordering; workflow executions can overlap.

Successful output fields:

* **List Distributions:** `{ distributions: [...], nextMarker, isTruncated, requestIds: [...] }`. A summary has `distributionId`, `arn`, `domainName`, `aliases` (array), `enabled`, `status`, `comment`, and `lastModifiedTime`.
* **Get Distribution:** the distribution summary fields plus `etag`, `inProgressInvalidationBatches`, `defaultRootObject`, `httpVersion`, `isIpv6Enabled`, `priceClass`, `origins` (each with `id`, `domainName`, `originPath`), and `requestId`.
* **Create Invalidation / Get Invalidation:** `{ distributionId, invalidationId, status, createTime, callerReference, paths, requestId }`. `createTime` is an ISO timestamp; `paths` is the returned array. `requestId` is a string or `null`.
* **List Invalidations:** `{ distributionId, invalidations: [...], nextMarker, isTruncated, requestIds: [...] }`. Each summary has `distributionId`, `invalidationId`, `status`, and `createTime`.

The node preflights all Create Invalidation items before sending any mutation. With continue-on-error, invalid items produce errors and valid items can proceed after preflight. An AWS failure later in execution cannot roll back an earlier successful invalidation; this is not a cross-item transaction.

### Paths and invalidation scope

`paths` is a newline-delimited string, not a JSON array. Provide distribution-relative, case-sensitive paths starting with `/`, for example:

```text
/article/42
/article/42/
/assets/app-20261118.js
```

The node ignores whitespace-only blank lines, preserves every other line exactly, and removes exact duplicate paths while keeping first-occurrence order. It does not trim a malformed nonblank path into a valid one. Paths must start with `/`, have at most 4,000 characters, and must not contain raw whitespace/control characters, raw non-ASCII/RFC1738-unsafe characters, malformed percent escapes, or raw/percent-encoded `~`. Repeated slashes are preserved, not normalized. It submits paths rather than fetching URLs. Do not include a scheme or hostname. A path is not interpreted as a local filename. AWS limits and account quotas still apply; the node does not split a request into independently billed invalidations.

* `/article` and `/article/` are different cache paths. Invalidate both if both are served; do not assume directory recursion or slash normalization.
* A wildcard is supported by CloudFront **at the end** of a path. `/images/*` covers paths under that prefix, while `/images*` also covers names such as `/images-old`. `/*` targets the whole distribution. An asterisk elsewhere is preserved as a literal character, not treated as a general-purpose glob. No broad wildcard is added automatically.
* If the cache behavior includes query strings in the cache key, invalidate the relevant query-string variants explicitly (`/page?lang=en`), or use a deliberately scoped trailing wildcard such as `/page*`. That wildcard also matches other paths sharing the prefix; review the breadth before use.
* If objects vary by forwarded/cache-key headers, CloudFront invalidation of the path invalidates the cached header variants; it does not let you select a header/device variant. Device-specific URLs, alternate paths, and rewritten paths still need their own correct paths.
* Percent-encode unsafe/non-ASCII characters according to CloudFront's path requirements, but do not encode ordinary characters unnecessarily. CloudFront does not support invalidating `~` paths. Consult the [AWS invalidation rules](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/invalidation-specifying-objects.html) for quotas, query strings, wildcard placement, URI rewrites, default-root objects, and path encoding.
* If an origin-request function rewrites a viewer URI, follow AWS guidance on invalidating both viewer and rewritten URIs. A cache invalidation does not delete origin data, purge Redis, or refresh a browser's own cache.

### CallerReference and safe retries

`callerReference` is required and defaults to blank. Supply a **stable identifier from the upstream change/event**, for example `article-published:42:revision-17`. Persist it before making the request. Do not use a new timestamp, random UUID, or n8n execution ID on every retry of the same logical change.

CloudFront treats a repeated CallerReference with an identical invalidation batch as the same request and returns its existing result. Reusing that reference with changed paths raises `InvalidationBatchAlreadyExists`; it does not update the original invalidation. Preserve the exact path batch, including ordering, for retries. A genuinely new change needs a new reference. Retain the original request/reference when a network timeout makes acceptance ambiguous: retrying the same batch/reference is safer than creating a new logical request. See [AWS CreateInvalidation](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CreateInvalidation.html).

### Completion, retries, and errors

Create Invalidation does **not** wait for cache invalidation completion. `InProgress` is accepted work, not success at the propagation level. Poll Get Invalidation until AWS returns the exact status `Completed`, with a finite workflow deadline. The SDK is configured for at most **3 attempts per AWS request**, a **5-second connection timeout**, and a **30-second request timeout**. Pagination and workflow polling make multiple requests; these are not an overall workflow deadline. SDK retryability rules apply; there is no blanket retry of every AWS failure.

Errors use a generic sanitized `message` and safe `code`, HTTP `httpStatus`, and AWS `requestId` diagnostics when available. Raw AWS messages, request payloads, secrets, and SDK exception dumps are not exposed as node errors. Missing diagnostic fields are not invented. Do not build business logic by matching the generic message; use the code and operation context. Local input errors use `ValidationError`. By default execution stops on failure. With n8n's **On Error → Continue (using regular output)**, each failed input produces `{ error: { message, code, httpStatus?, requestId? } }` instead of a successful envelope; downstream logic must check for `error` before accessing results. A failure is never an empty successful list or a `Completed` invalidation.

## Safe workflow examples

[Import `examples/cloudfront-invalidation.json`](examples/cloudfront-invalidation.json) into the compatible development n8n instance. It is inactive and uses only a manual trigger, has no embedded credentials, and rejects unchanged placeholders. Select AWS credentials on both CloudFront nodes and set the real distribution, paths, and stable upstream event reference in **Prepare Request** before manually running it.

The example preserves the distribution/invalidation IDs, original paths, CallerReference, and absolute deadline across Wait/Get cycles. It reports success only for AWS's exact `Completed` status; `InProgress` waits again, timeout stops in a separate node, and errors/unexpected statuses stop as errors. It never converts an error or an exhausted deadline into success. A Wait node can make the workflow persist/resume; keep n8n execution storage and encryption configuration durable. Before a production adaptation, set polling and deadline values for your workload and persist the upstream event identity outside the workflow so a retry can reuse it.

For the required Redis/data/HTML ordering, read [Redis → HTML → CloudFront integration](docs/redis-html-cdn.md). No existing production cleanup workflow is changed or executed.

## Development, releases, and provenance

See [CONTRIBUTING.md](CONTRIBUTING.md), [release procedures](docs/releases.md), [CHANGELOG.md](CHANGELOG.md), and [NOTICE](NOTICE). Code is licensed under [MIT](LICENSE), copyright liar0320. The generic vector icon is original; it is not an AWS brand asset. AWS service documentation describes protocol semantics but is not copied generated working implementation. AWS and n8n names identify compatibility, not affiliation, endorsement, or verification.
