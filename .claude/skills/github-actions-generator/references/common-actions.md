# Common GitHub Actions Reference

**Last Updated:** February 2026

All actions SHA-pinned to 40-char commit hash. `node24` runtime required (Node 20 EOL April 2026, forced node24 March 2026). `actions/cache` v5 stable (Dec 2025, new backend). 10 GB free cache per repo.

## Action Catalog

| Action | Version | SHA | Key Inputs |
|--------|---------|-----|------------|
| `actions/checkout` | v6.0.2 | `de0fac2e4500dabe0009e67214ff5f5447ce83dd` | `fetch-depth`, `ref`, `token`, `submodules`, `sparse-checkout` |
| `actions/setup-node` | v6.2.0 | `6044e13b5dc448c55e2357c09f80417699197238` | `node-version`, `cache` (npm/yarn/pnpm), `cache-dependency-path`, `registry-url` |
| `actions/setup-python` | v6.2.0 | `a309ff8b426b58ec0e2a45f0f869d46889d02405` | `python-version`, `cache` (pip/pipenv/poetry), `cache-dependency-path` |
| `actions/setup-java` | v5.2.0 | `be666c2fcd27ec809703dec50e508c2fdc7f6654` | `distribution`, `java-version`, `cache` (maven/gradle/sbt) |
| `actions/setup-go` | v6.2.0 | `7a3fe6cf4cb3a834922a1244abfce67bcef6a0c5` | `go-version`, `cache`, `cache-dependency-path` |
| `actions/cache` | v5.0.3 | `cdf6c1fa76f9f475f3d7449005a359c84ca0f306` | `path`, `key`, `restore-keys` |
| `actions/upload-artifact` | v6.0.0 | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` | `name`, `path`, `retention-days`, `if-no-files-found` |
| `actions/download-artifact` | v7.0.0 | `37930b1c2abaa49bbe596cd826c3c89aef350131` | `name`, `path`, `run-id`, `github-token` |
| `actions/github-script` | v8.0.0 | `ed597411d8f924073f98dfc5c65a23a2325f34cd` | `script`, `github-token` |
| `nrwl/nx-set-shas` | v4.4.0 | `3e9ad7370203c1e93d109be57f3b72eb0eb511b1` | `main-branch-name`, `workflow-id` |
| `docker/setup-buildx-action` | v3.12.0 | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | _(none required)_ |
| `docker/login-action` | v3.7.0 | `c94ce9fb468520275223c153574b00df6fe4bcc9` | `registry`, `username`, `password` |
| `docker/build-push-action` | v6.19.2 | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` | `context`, `push`, `tags`, `platforms`, `cache-from`, `cache-to`, `build-args`, `provenance`, `sbom` |
| `docker/metadata-action` | v5.10.0 | `c299e40c65443455700f0fdfc63efafe5b349051` | `images`, `tags` |
| `aws-actions/configure-aws-credentials` | v6.0.0 | `8df5847569e6427dd6c4fb1cf565c83acfa8afa7` | `role-to-assume`, `aws-region`, `audience` |
| `azure/login` | v2.3.0 | `eec3c95657c1536435858eda1f3ff5437fee8474` | `creds`, `client-id`, `tenant-id`, `subscription-id` |
| `codecov/codecov-action` | v5.5.2 | `0561704f0f02c16a585d4c7555e57fa2e44cf909` | `token`, `files`, `fail_ci_if_error` |
| `softprops/action-gh-release` | v2.5.0 | `a06a81a03ee405af7f2048a818ed3f03bbf83c7b` | `tag_name`, `name`, `body`, `draft`, `prerelease`, `files` |
| `super-linter/super-linter` | v7.4.0 | `12150456a73e248bdc94d0794898f94e23127c88` | `validate_all_codebase`, `default_branch` |
| `slackapi/slack-github-action` | v2.1.0 | `b0fa283ad8fea605de13dc3f449259339835fc52` | `method`, `token`, `payload` |
| `sigstore/cosign-installer` | v4.0.0 | `faadad0cce49287aee09b3a48701e75088a2c6ad` | `cosign-release` |
| `actions/dependency-review-action` | v4.8.2 | `3c4e3dcb1aa7874d2c16be7d79418e9b7efd6261` | `fail-on-severity`, `allow-licenses`, `deny-licenses` |
| `actions/attest-build-provenance` | v3.2.0 | `62fc1d596301d0ab9914e1fec14dc5c8d93f65cd` | `subject-name`, `subject-digest`, `push-to-registry` |
| `actions/attest-sbom` | v3.0.0 | `4651f806c01d8637787e274ac3bdf724ef169f34` | `subject-name`, `subject-digest`, `sbom-path`, `push-to-registry` |
| `anchore/sbom-action` | v0.22.2 | `28d71544de8eaf1b958d335707167c5f783590ad` | `image`, `format`, `output-file`, `upload-artifact` |
| `aquasecurity/trivy-action` | 0.33.1 | `b6643a29fecd7f34b3597bc6acb0a98b03d33ff8` | `image-ref`, `format`, `output`, `severity` |
| `github/codeql-action` | v3.32.2 | `46a5d05688af3c0b623936fd3365ef1ae945c1cd` | `languages`, `sarif_file`, `category` |
| `actions/create-github-app-token` | v2.0.6 | `d72941d797fd3113feb6b93fd0dec494b13a2547` | `app-id`, `private-key`, `owner`, `repositories` |
| `actions/publish-immutable-action` | v0.0.4 | `4e89a6a924d2f75641255b9e589f4a7bc672f498` | _(none -- publishes action to GHCR as immutable OCI)_ |
| `step-security/harden-runner` | v2.12.0 | `002fdce3c6a235733a90a27c80493a3241e56863` | `egress-policy`, `allowed-endpoints` |

## Nx Monorepo Actions

| Action | Version | SHA | Purpose |
|--------|---------|-----|---------|
| `nrwl/nx-set-shas` | v4.4.0 | `3e9ad7370203c1e93d109be57f3b72eb0eb511b1` | Sets `NX_BASE`/`NX_HEAD` env vars for affected detection |

Usage: runs before `nx affected` to determine correct base SHA for PR and push contexts. Requires `fetch-depth: 0` on checkout.

## Permissions Quick Reference

| Action | Required Permissions |
|--------|---------------------|
| `checkout` | `contents: read` |
| `upload-artifact` / `download-artifact` | _(none beyond default)_ |
| `dependency-review-action` | `contents: read` |
| `attest-build-provenance` | `id-token: write`, `attestations: write` |
| `attest-sbom` | `id-token: write`, `contents: read`, `attestations: write`, `packages: write` |
| `cosign-installer` (keyless) | `id-token: write` |
| `github-script` (PR comments) | `pull-requests: write` |
| `docker/login-action` (GHCR) | `packages: write` |
| `create-github-app-token` | _(none -- uses App private key from secrets)_ |
| `publish-immutable-action` | `contents: read`, `packages: write`, `id-token: write` |
| `harden-runner` | _(none -- first step in job, monitors egress)_ |

## Supply Chain Security

```yaml
# Image signing with Cosign (keyless via OIDC)
permissions: { id-token: write, packages: write, attestations: write }
steps:
  - uses: step-security/harden-runner@002fdce3c6a235733a90a27c80493a3241e56863 # v2.12.0
    with: { egress-policy: audit }
  - uses: sigstore/cosign-installer@faadad0cce49287aee09b3a48701e75088a2c6ad # v4.0.0
  - id: build
    uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6.19.2
    with: { push: true, tags: '${{ steps.meta.outputs.tags }}', provenance: true, sbom: true }
  - run: cosign sign --yes "${{ env.IMAGE }}@${{ steps.build.outputs.digest }}"
  - uses: actions/attest-build-provenance@62fc1d596301d0ab9914e1fec14dc5c8d93f65cd # v3.2.0
    with: { subject-name: '${{ env.IMAGE }}', subject-digest: '${{ steps.build.outputs.digest }}', push-to-registry: true }
```

## GitHub App Token Authentication

Use `actions/create-github-app-token` instead of PATs for cross-repo operations. App tokens are scoped, short-lived, and auditable.

```yaml
- uses: actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v2.0.6
  id: app-token
  with:
    app-id: ${{ vars.APP_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}
    owner: ${{ github.repository_owner }}
    repositories: 'target-repo'   # optional -- scope to specific repos
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  with:
    repository: owner/target-repo
    token: ${{ steps.app-token.outputs.token }}
```

## Immutable Actions (OCI)

Publish actions to GHCR as immutable OCI artifacts. Consumers reference by SemVer; tags are immutable once published.

```yaml
# In the action repo's release workflow:
- uses: actions/publish-immutable-action@4e89a6a924d2f75641255b9e589f4a7bc672f498 # v0.0.4

# Consumers use GHCR reference instead of git tag:
- uses: ghcr.io/owner/action-name@1.0.0  # immutable, provenance-attested
```

## Finding New Actions

```bash
# Get SHA for a specific tag
git ls-remote --tags https://github.com/[owner]/[repo] | grep 'refs/tags/[tag]'
```

Use Dependabot for automatic updates:
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```
