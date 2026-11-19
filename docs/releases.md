# Release procedures

## Current state and authority

The source version is `0.1.0`. The owner authorized making `Liar0320/n8n-nodes-aws` public and a one-time local bootstrap publication of `n8n-nodes-aws@0.1.0` to `latest`, without provenance, using the authenticated npm account `lich0320`. Authorization is not proof of publication: verify the registry receipt and integrity before announcing success. PR merging, release tags, GitHub Releases and production changes are not part of this bootstrap authorization.

Supported release tooling uses Node.js 24 and **npm >=11.5.1** for trusted publishing. GitHub Actions workflow `.github/workflows/release.yml` publishes through npm OIDC using the GitHub environment **`npm`**. There is no long-lived npm token fallback. Repository protection and environment approval are part of release authorization, not substitutes for package ownership.

**CI prerequisites:** the source repository is now public, resolving the visibility prerequisite for future [npm provenance](https://docs.npmjs.com/generating-provenance-statements/#prerequisites). Configure the protected GitHub environment `npm` and npm trusted publisher after bootstrap. Keep CI's OIDC/provenance requirements unchanged; the local no-provenance bootstrap is a one-time explicitly approved exception, not a token fallback for CI.

## Owner bootstrap and trusted publisher

A package owner must verify npm name control and ensure the npm account can publish a public package under that exact name. GitHub repository admin access is verified separately and does not establish npm permissions. Check npm policies, two-factor requirements, organization membership and name availability directly. Keep `package.json` repository metadata matched to the canonical `Liar0320/n8n-nodes-aws` identity; do not assume the author field authenticates the npm operator.

For a new package, trusted-publisher configuration may require the package to exist. The owner has authorized a local bootstrap under their authenticated npm account without provenance. Publish only the reviewed, validated `0.1.0` tarball with `--ignore-scripts --access public --tag latest --provenance=false`; complete any npm browser/2FA challenge locally, never put credentials or OTPs into documentation, logs, or CI. If publication succeeds, `0.1.0` is consumed permanently: configure OIDC and use a new version for the first automated release. Local publication cannot retroactively acquire CI provenance.

Bootstrap completed on 2026-11-19: the registry confirmed `n8n-nodes-aws@0.1.0`, `latest: 0.1.0`, and exact artifact integrity (see [verification evidence](verification.md#verified-local-bootstrap-publication)). The version is now immutable. Configure the trusted publisher for a separately authorized subsequent version; never rerun the bootstrap command for `0.1.0`.

In npm package settings, configure GitHub Actions as a trusted publisher with the exact repository owner/name, workflow filename `release.yml`, and environment `npm`. In GitHub, create/protect environment `npm` with appropriate reviewers and release-tag restrictions. Grant the publishing job `id-token: write`; grant only the repository permissions needed by the workflow. The provider, identity, environment and workflow filename must match exactly. Keep forks and untrusted branches out of the publish path. Do not add `NODE_AUTH_TOKEN`, `NPM_TOKEN`, or a recovery token fallback to the OIDC publish job.

## Prepare an authorized release

1. Verify repository/package control and the trusted publisher mapping. Review every runtime file, dependency license and packaged notice.
2. Update `package.json` and the lockfile to the same intended SemVer version. Add a nonempty section in `CHANGELOG.md`, for example `## [0.1.1] - YYYY-MM-DD`. Use a real date. The release automation requires the **exact** package version's section and extracts its body through the next level-two heading. Missing or empty release notes fail validation.
3. Use Node 24 and npm >=11.5.1, then run:

   ```sh
   npm ci
   npm run validate
   npm run smoke:n8n
   ```

   `check:pack` within validation creates the checked tarball in `.artifacts/package/`. The smoke harness installs that artifact and n8n 2.48.4 in a temporary directory with fake credentials and deterministic offline SDK transport interception. It does not test live AWS. Inspect the packed file list, version, license/NOTICE and registry metadata. Confirm no credentials, tests, fixture secrets, development caches or unrelated files are included.
4. Review the exact workflow/tag rules. An authorized release tag must be `v` followed by the exact `package.json` version, for example `v0.1.1` or `v0.2.0-rc.1`; no leading-zero or arbitrary suffix aliases. The checked-out commit, tag and package version must agree. Do not move an already released tag or reuse an npm version.
5. Only after approval, create/push the reviewed release tag using the project's authorized process. Release workflow checks run before publication; the protected `npm` environment gates publishing. The stable SemVer path uses npm dist-tag **`latest`**; a version with a prerelease identifier uses **`next`** rather than accidentally promoting to `latest`. A prerelease such as `0.2.0-rc.1` remains a prerelease even when its tests pass.
6. The publish job uses npm OIDC and provenance with public access. Confirm npm's result before creating/announcing the GitHub Release. Automation creates GitHub Release notes from the matching checked-in changelog only after successful npm publication. Verify package integrity, version, intended dist-tag and provenance from the registry, and then review the release page. Record separately any explicitly approved real-AWS validation; do not label offline smoke as live validation.

## Failure recovery

* **Before publish:** no version was released merely because a tag exists. Fix a failed validation, artifact, identity or approval issue before retrying the authorized action. Do not skip checks, weaken tag validation or inject a token to bypass a failing trusted publisher.
* **OIDC rejected:** check npm >=11.5.1, `id-token: write`, exact repository/workflow/environment identity, package ownership and trusted-publisher settings. An unavailable package name or missing owner bootstrap needs owner action, not CI retries with invented credentials.
* **Ambiguous publish/network result:** query the registry for the exact version and integrity before retrying. npm versions are immutable; a successful version cannot be overwritten even after unpublishing. If it exists, do not rerun publish. If a published artifact is wrong, deprecate it as appropriate and release a new corrected version through review.
* **Wrong dist-tag:** an authorized owner may deliberately correct the tag after verifying the immutable version. Tag correction does not replace the package contents. Never promote a prerelease to `latest` by accident.
* **npm succeeds but GitHub Release fails:** do **not** rerun the publish workflow to recover the release page. Recover only the GitHub Release from the same existing tag and matching checked-in changelog. Extract that reviewed section to a local notes file, then an authorized operator can run `gh release create vX.Y.Z --verify-tag --notes-file /path/to/release-notes.txt` (and `--prerelease` for prereleases). Check whether the release already exists before creating it. Never create a different package artifact under that version or move the tag.
* **Missing provenance or unexpected contents:** stop promotion, investigate identity/artifact history and use a new version for any correction. Do not claim that deleting or retrying can rewrite a published version.

No step in this guide authorizes a live production invalidation or a change to the existing cleanup workflow.
