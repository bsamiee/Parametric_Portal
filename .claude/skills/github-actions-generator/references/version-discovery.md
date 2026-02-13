# [H1][VERSION-DISCOVERY]
>**Dictum:** *Evergreen action versioning replaces static catalogs — single source of truth for SHA resolution and permissions.*

<br>

---
## [1][DISCOVERY_PROTOCOL]
>**Dictum:** *Runtime resolution replaces static pinning.*

<br>

[IMPORTANT]:
- [ALWAYS] Resolve versions at generation time — never embed static SHAs in reference docs.
- [ALWAYS] Verify tags exist before pinning.
- [ALWAYS] Dereference annotated tags with `^{}` — lightweight tags resolve directly.

```bash
# Fetch latest release tag
gh api repos/{owner}/{repo}/releases/latest --jq '.tag_name'

# Resolve tag to full SHA (dereference annotated tags)
git ls-remote --tags https://github.com/{owner}/{repo} | grep 'refs/tags/{tag}' | tail -1 | cut -f1

# Batch resolve — all actions in workflow
grep -oP 'uses:\s+\K[^@]+' .github/workflows/*.yml | sort -u | while read action; do
  tag=$(gh api "repos/$action/releases/latest" --jq '.tag_name' 2>/dev/null)
  sha=$(git ls-remote --tags "https://github.com/$action" | grep "refs/tags/$tag" | tail -1 | cut -f1)
  printf '%s@%s # %s\n' "$action" "$sha" "$tag"
done
```

---
## [2][SHA_PINNING_FORMAT]
>**Dictum:** *Full SHA pins prevent supply-chain attacks via tag retargeting.*

<br>

Format: `owner/repo@<40-char-SHA> # vX.Y.Z`

**Incident: tj-actions/changed-files (CVE-2025-30066, March 2025):**
- Attacker retargeted ALL existing version tags to malicious commit.
- 23,000+ repos affected — secrets extracted from Runner Worker process memory.
- Cascading supply chain: enabled by prior compromise of `reviewdog/action-setup@v1` (CVE-2025-30154).
- CISA advisory issued March 18, 2025.
- `step-security/harden-runner` first detected the anomalous egress.

[CRITICAL]:
- [ALWAYS] Pin to full 40-character SHA with version comment suffix.
- [NEVER] Use mutable refs (`@main`, `@latest`, `@v1`) in production workflows.

---
## [3][AUTOMATED_MAINTENANCE]
>**Dictum:** *Automation replaces manual version tracking.*

<br>

```yaml
# .github/dependabot.yml — automated SHA updates
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule: { interval: "weekly" }
    groups:
      actions: { patterns: ["*"] }
```

Dependabot natively parses `# v4.2.2` comments after SHA pins — updates both SHA and comment on new release.

```json
// renovate.json — alternative with pinDigests
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", "helpers:pinGitHubActionDigests"]
}
```

Renovate resolves version tag from comment, fetches new SHA, updates both. `helpers:pinGitHubActionDigests` auto-converts tag refs to SHA pins.

---
## [4][IMMUTABLE_ACTIONS]
>**Dictum:** *Org-level SHA pinning enforcement replaces the stalled OCI immutable-publish approach.*

<br>

**Status:** OCI immutable publishing **paused** (not progressing to GA). GitHub pivoted to org-level SHA pinning enforcement as the primary supply chain control.

- **Original plan:** Actions packaged as immutable OCI containers in GHCR with version tags that cannot be retargeted. Registry stability issues blocked rollout.
- **Current approach:** Org/repo setting **"Require actions to be pinned to a full-length commit SHA"** — enforces `@<40-char-SHA>` format, rejects `@v1`/`@main` refs. Available in GitHub Enterprise Cloud and Server 3.12+.
- `actions/publish-immutable-action` repo exists but is **not usable** for external consumers.
- SHA pinning + Dependabot/Renovate automated updates is the recommended supply chain posture until immutable actions reach GA.

---
## [5][COMMON_ACTIONS_INDEX]
>**Dictum:** *Action index lists capabilities and permissions — single source of truth.*

<br>

| [INDEX] | [ACTION]                                    | [MAJOR] | [KEY_INPUTS]                                                     | [REQUIRED_PERMISSIONS]                                                        |
| :-----: | ------------------------------------------- | :-----: | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
|   [1]   | **`actions/checkout`**                      |   v6    | `fetch-depth`, `ref`, `token`, `sparse-checkout`                 | `contents: read`                                                              |
|   [2]   | **`actions/setup-node`**                    |   v6    | `node-version`, `cache` (npm/yarn/pnpm), `registry-url`          | _(none)_                                                                      |
|   [3]   | **`actions/setup-python`**                  |   v5    | `python-version`, `cache` (pip/pipenv/poetry)                    | _(none)_                                                                      |
|   [4]   | **`actions/setup-java`**                    |   v4    | `distribution`, `java-version`, `cache` (maven/gradle)           | _(none)_                                                                      |
|   [5]   | **`actions/setup-go`**                      |   v5    | `go-version`, `cache`                                            | _(none)_                                                                      |
|   [6]   | **`actions/cache`**                         |   v5    | `path`, `key`, `restore-keys`                                    | _(none)_                                                                      |
|   [7]   | **`actions/upload-artifact`**               |   v6    | `name`, `path`, `retention-days`, `if-no-files-found`            | _(none)_                                                                      |
|   [8]   | **`actions/download-artifact`**             |   v7    | `name`, `path`, `run-id`                                         | _(none)_                                                                      |
|   [9]   | **`actions/github-script`**                 |   v8    | `script`, `github-token`                                         | `pull-requests: write` (for PR comments)                                      |
|  [10]   | **`nrwl/nx-set-shas`**                      |   v4    | `main-branch-name`, `workflow-id`                                | _(none)_                                                                      |
|  [11]   | **`docker/setup-buildx-action`**            |   v3    | _(none required)_                                                | _(none)_                                                                      |
|  [12]   | **`docker/login-action`**                   |   v3    | `registry`, `username`, `password`                               | `packages: write` (GHCR)                                                      |
|  [13]   | **`docker/build-push-action`**              |   v6    | `context`, `push`, `tags`, `platforms`, `cache-from`, `cache-to` | _(none)_                                                                      |
|  [14]   | **`docker/metadata-action`**                |   v5    | `images`, `tags`                                                 | _(none)_                                                                      |
|  [15]   | **`aws-actions/configure-aws-credentials`** |   v6    | `role-to-assume`, `aws-region`                                   | `id-token: write`                                                             |
|  [16]   | **`azure/login`**                           |   v2    | `client-id`, `tenant-id`, `subscription-id`                      | `id-token: write`                                                             |
|  [17]   | **`google-github-actions/auth`**            |   v3    | `workload_identity_provider`, `service_account`                  | `id-token: write`                                                             |
|  [18]   | **`codecov/codecov-action`**                |   v5    | `token`, `files`, `fail_ci_if_error`                             | _(none)_                                                                      |
|  [19]   | **`softprops/action-gh-release`**           |   v2    | `tag_name`, `name`, `body`, `files`                              | `contents: write`                                                             |
|  [20]   | **`super-linter/super-linter`**             |   v7    | `validate_all_codebase`, `default_branch`                        | _(none)_                                                                      |
|  [21]   | **`slackapi/slack-github-action`**          |   v2    | `method`, `token`, `payload`                                     | _(none)_                                                                      |
|  [22]   | **`sigstore/cosign-installer`**             |   v4    | `cosign-release`                                                 | `id-token: write` (keyless)                                                   |
|  [23]   | **`actions/dependency-review-action`**      |   v4    | `fail-on-severity`, `allow-licenses`, `deny-licenses`            | `contents: read`                                                              |
|  [24]   | **`actions/attest-build-provenance`**       |   v3    | `subject-name`, `subject-digest`, `push-to-registry`             | `id-token: write`, `attestations: write`                                      |
|  [25]   | **`actions/attest-sbom`**                   |   v3    | `subject-name`, `subject-digest`, `sbom-path`                    | `id-token: write`, `contents: read`, `attestations: write`, `packages: write` |
|  [26]   | **`anchore/sbom-action`**                   |   v0    | `image`, `format`, `output-file`                                 | _(none)_                                                                      |
|  [27]   | **`aquasecurity/trivy-action`**             |   v0    | `image-ref`, `format`, `severity`                                | _(none)_                                                                      |
|  [28]   | **`github/codeql-action`**                  |   v4    | `languages`, `sarif_file`                                        | `security-events: write`                                                      |
|  [29]   | **`actions/create-github-app-token`**       |   v2    | `app-id`, `private-key`, `owner`, `repositories`                 | _(none -- uses App private key)_                                              |
|  [30]   | **`step-security/harden-runner`**           |   v2    | `egress-policy`, `allowed-endpoints`                             | _(none -- first step in job)_                                                 |
|  [31]   | **`peter-evans/create-pull-request`**       |   v7    | `branch`, `title`, `body`, `commit-message`                      | `contents: write`, `pull-requests: write`                                     |
|  [32]   | **`peter-evans/slash-command-dispatch`**    |   v4    | `commands`, `permission`                                         | _(none)_                                                                      |
|  [33]   | **`dorny/paths-filter`**                    |   v3    | `filters`, `base`                                                | `contents: read`                                                              |
|  [34]   | **`google-github-actions/setup-gcloud`**    |   v2    | `version`, `project_id`                                          | _(none)_                                                                      |
|  [35]   | **`gitleaks/gitleaks-action`**              |   v2    | `scan_mode`                                                      | _(none)_                                                                      |

[IMPORTANT] Column `[MAJOR]` shows the current major version series. Always resolve exact SHA via discovery protocol at generation time — never use bare `@vN` tags.

---
## [6][ARTIFACTS]
>**Dictum:** *Artifact v6/v7 provides immutable, immediately-available cross-job data transfer.*

<br>

| [INDEX] | [PROPERTY]         | [VALUE]                                                     |
| :-----: | ------------------ | ----------------------------------------------------------- |
|   [1]   | **Immutability**   | Cannot be altered after upload — new upload = new ID.       |
|   [2]   | **Availability**   | Immediately downloadable — no wait for workflow completion. |
|   [3]   | **Retention**      | 1-90 days (default 90); configurable per upload.            |
|   [4]   | **Max size**       | 10 GB per artifact.                                         |
|   [5]   | **Cross-workflow** | Download via `run-id` from `workflow_run` trigger.          |
|   [6]   | **Versions**       | upload-artifact v6, download-artifact v7 (current stable).  |

```yaml
- uses: actions/upload-artifact@<SHA> # v6
  with:
    name: build-output
    path: dist/
    retention-days: 7
    if-no-files-found: error
```

---
## [7][SIGNING_VERIFICATION]
>**Dictum:** *Attestation verification closes the supply chain loop from build to consumption.*

<br>

**`gh attestation verify`** — GA in GitHub CLI. Verifies Sigstore-signed build provenance and SBOM attestations.

```bash
# Verify binary against repo attestations
gh attestation verify <file-path> --repo owner/repo

# Verify OCI image against org-wide attestations
gh attestation verify oci://ghcr.io/owner/image:tag --owner owner

# Offline verification with downloaded bundle
gh attestation verify <file-path> --bundle /path/to/attestation.jsonl

# Verify non-default predicate type
gh attestation verify <file-path> --repo owner/repo --predicate-type https://spdx.dev/Document/v2.3

# JSON output for CI pipeline consumption
gh attestation verify <file-path> --repo owner/repo --format json
```

Key flags: `--repo` (single repo), `--owner` (org-wide), `--bundle` (offline), `--bundle-from-oci` (registry-stored), `--predicate-type` (non-default SLSA type), `--format json` (machine-readable).
