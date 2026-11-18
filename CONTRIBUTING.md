# Contributing

Use Node.js 24 and the checked-in npm lockfile. The supported target is self-hosted n8n 2.48.4; this is not a verified n8n Cloud package. The official AWS SDK runtime dependency is intentional. Do not substitute copied generated reference-node code to satisfy a dependency or lint restriction.

```sh
npm ci
npm run validate
npm run smoke:n8n
```

`validate` runs the repository's lint, type checks, unit tests, build and pack checks. The pack check places the checked artifact under `.artifacts/package/`. The n8n smoke check installs that artifact with n8n 2.48.4 into a temporary root and exercises loading/execution with fake credentials and deterministic offline SDK transport interception. It is **not** a live AWS integration test, real IAM verification, or a claim of successful publishing. Never use live credentials in these checks.

## Change expectations

* Keep the five operation contracts, one-envelope-per-input semantics, item pairing, explicit pagination and sanitized errors consistent with the README and tests.
* Keep distribution ID selection, stable CallerReference, exact path preservation and preflight validation explicit. Never turn partial failures into successful empty results or report completion before AWS returns `Completed`.
* Test transport mapping, credential behavior, failed/empty pages, pagination termination, mutation preflight, idempotency inputs, per-item results, and safe error fields with offline transport interception. Never put real account IDs, secrets, production workflow contents, or customer data in fixtures.
* Keep endpoint/signing scope explicit: commercial global `cloudfront.amazonaws.com`, SigV4 `us-east-1`. SDK attempts/timeouts are bounded; workflow polling also needs its own finite deadline.
* Add each future AWS service as its own implemented node. Reuse small infrastructure only when needed; do not add placeholder service nodes or an abstraction for hypothetical services.
* Update operation docs, importable sanitized examples and `CHANGELOG.md` when behavior changes. Preserve code/specification/icon provenance separately in `NOTICE`, and retain third-party notices if any third-party material is actually introduced.
* The generic icon is original. Do not copy AWS branding or generated code/icons from reference packages without verifying licensing and retaining required notices.

Use a feature branch and reviewable commits. Include the intended behavior, compatibility impact and exact checks run in the pull request. Do not claim a check passed if it was not run. Avoid production deployment, live invalidations and repository/npm administration in ordinary contributions. Any explicitly authorized live test must use a disposable distribution, scoped temporary credentials, reviewed paths and an independently recorded result; `/*` is not an acceptable default test path.

## Release changes

A source change is not a release. Do not create remote repositories, tags, GitHub Releases or npm versions as part of routine development. Read [release procedures](docs/releases.md) before a separately authorized release. npm ownership and repository control must be verified first; proposed metadata and an npm `E404` do not establish them. Never bypass OIDC with a token fallback when automated publishing fails.
