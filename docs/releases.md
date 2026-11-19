# Release procedures

## Release policy

Publish only from commits already merged into `main`. Release changes, including package versions and changelog entries, go through a pull request and passing CI before a version tag is created. The tag must point to a commit in `origin/main` history; a branch name or GitHub Release target label is not proof of ancestry.

The GitHub Actions workflow `.github/workflows/release.yml` uses Node.js 24, npm >=11.5.1, npm Trusted Publishing (OIDC), provenance, and the GitHub environment `npm`. The source repository and npm package must be public. Configure reviewers and tag restrictions on the environment as required; OIDC authentication does not itself enforce human approval. There is no long-lived npm token fallback.

Version `0.1.0` was bootstrapped locally without provenance, and `0.1.1` was published through GitHub OIDC with provenance. The `v0.1.1` tag was created before its implementation branch was merged; preserve that historical tag and package rather than moving or republishing them. See [verification evidence](verification.md) for the recorded results.

## Owner bootstrap and trusted publisher

A package owner must verify npm name control and ensure the npm account can publish a public package under that exact name. GitHub repository admin access is verified separately and does not establish npm permissions. Check npm policies, two-factor requirements, organization membership and name availability directly. Keep `package.json` repository metadata matched to the canonical `Liar0320/n8n-nodes-aws` identity; do not assume the author field authenticates the npm operator.

For a new package, trusted-publisher configuration may require a separately authorized initial bootstrap. Never treat this as permission to add a token fallback to CI. The bootstrap for this package is complete: version `0.1.0` is immutable, and `0.1.1` has verified OIDC provenance. Use a new version for any subsequent publication.

In npm package settings, configure GitHub Actions as a trusted publisher with the exact repository owner/name, workflow filename `release.yml`, and environment `npm`. In GitHub, create/protect environment `npm` with appropriate reviewers and release-tag restrictions. Grant the publishing job `id-token: write`; grant only the repository permissions needed by the workflow. The provider, identity, environment and workflow filename must match exactly. Keep forks and untrusted branches out of the publish path. Do not add `NODE_AUTH_TOKEN`, `NPM_TOKEN`, or a recovery token fallback to the OIDC publish job.

## Prepare an authorized release

1. Verify repository/package control and the trusted publisher mapping. Review every runtime file, dependency license and packaged notice.
2. In a pull request, update `package.json` and the lockfile to the intended SemVer version and add its nonempty dated section in `CHANGELOG.md`. Run CI and merge the release changes into `main` before tagging. The release automation requires exact version agreement and matching release notes.
3. Use Node 24 and npm >=11.5.1, then run:

   ```sh
   npm ci
   npm run validate
   npm run smoke:n8n
   ```

   `check:pack` within validation creates the checked tarball in `.artifacts/package/`. The smoke harness installs that artifact and n8n 2.48.4 in a temporary directory with fake credentials and deterministic offline SDK transport interception. It does not test live AWS. Inspect the packed file list, version, license/NOTICE and registry metadata. Confirm no credentials, tests, fixture secrets, development caches or unrelated files are included.
4. Fetch the remote history and update the local `main` checkout using a fast-forward-only pull. Confirm the intended release commit and create the annotated `v<package.json version>` tag from that checkout. Do not tag an unmerged feature branch, move an existing release tag, or reuse an npm version.
5. Run `node scripts/check-release-source.mjs` before pushing the tag. CI checks the same ancestry with full checkout history before installing dependencies, using OIDC, or publishing. A missing `origin/main`, shallow history, or commit outside main fails closed. After explicit release approval, push the immutable tag. Stable versions use `latest`; prerelease versions use `next`. Only environment rules actually saved in GitHub enforce a human approval pause.
6. The publish job uses npm OIDC and provenance with public access. Confirm npm's result before creating/announcing the GitHub Release. Automation creates GitHub Release notes from the matching checked-in changelog only after successful npm publication. Verify package integrity, version, intended dist-tag and provenance from the registry, and then review the release page. Record separately any explicitly approved real-AWS validation; do not label offline smoke as live validation.

## Failure recovery

* **Before publish:** no version was released merely because a tag exists. Fix a failed validation, artifact, identity or approval issue before retrying the authorized action. Do not skip checks, weaken tag validation or inject a token to bypass a failing trusted publisher.
* **OIDC rejected:** check npm >=11.5.1, `id-token: write`, exact repository/workflow/environment identity, package ownership and trusted-publisher settings. An unavailable package name or missing owner bootstrap needs owner action, not CI retries with invented credentials.
* **Ambiguous publish/network result:** query the registry for the exact version and integrity before retrying. npm versions are immutable; a successful version cannot be overwritten even after unpublishing. If it exists, do not rerun publish. If a published artifact is wrong, deprecate it as appropriate and release a new corrected version through review.
* **Wrong dist-tag:** an authorized owner may deliberately correct the tag after verifying the immutable version. Tag correction does not replace the package contents. Never promote a prerelease to `latest` by accident.
* **npm succeeds but GitHub Release fails:** do **not** rerun the publish workflow to recover the release page. Recover only the GitHub Release from the same existing tag and matching checked-in changelog. Extract that reviewed section to a local notes file, then an authorized operator can run `gh release create vX.Y.Z --verify-tag --notes-file /path/to/release-notes.txt` (and `--prerelease` for prereleases). Check whether the release already exists before creating it. Never create a different package artifact under that version or move the tag.
* **Missing provenance or unexpected contents:** stop promotion, investigate identity/artifact history and use a new version for any correction. Do not claim that deleting or retrying can rewrite a published version.

No step in this guide authorizes a live production invalidation or a change to the existing cleanup workflow.
