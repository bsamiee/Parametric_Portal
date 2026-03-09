# [H1][SUPPLY-CHAIN]
>**Dictum:** *Supply chain validation detects insecure action consumption, missing attestations, and credential misuse.*

<br>

---
## [1][SHA_PINNING]
>**Dictum:** *Mutable refs are the primary supply chain attack vector — detect and flag unpinned actions.*

<br>

### [1.1][DETECTION_RULES]

| [INDEX] | [CHECK]                         | [TAG]         | [SEVERITY] | [WHAT_TO_FLAG]                                                |
| :-----: | ------------------------------- | ------------- | :--------: | ------------------------------------------------------------- |
|   [1]   | **Branch ref**                  | `[UNPINNED]`  |  CRITICAL  | `@main`, `@master`, `@develop` — mutable, trivially poisoned. |
|   [2]   | **Major tag only**              | `[UNPINNED]`  |    HIGH    | `@v1`, `@v6` — retargetable (tj-actions vector).              |
|   [3]   | **Minor/patch tag**             | `[UNPINNED]`  |   MEDIUM   | `@v4.2.1` — still mutable; SHA is only immutable format.      |
|   [4]   | **SHA without version comment** | `[PIN-AUDIT]` |    LOW     | `@<SHA>` without `# vN.N.N` — valid but unauditable.          |
|   [5]   | **Abbreviated SHA**             | `[UNPINNED]`  |    HIGH    | Less than 40 characters — not collision-resistant.            |

**Required format:** `owner/repo@<40-char-SHA> # vN.N.N`

### [1.2][TJ_ACTIONS_INCIDENT]

**March 2025 — CVE-2025-30066:** tj-actions/changed-files compromise affected 23,000+ repositories.

- Attacker retargeted ALL existing version tags to a malicious commit.
- Secrets extracted from Runner Worker process memory via injected CI step.
- Cascading supply chain: enabled by prior compromise of `reviewdog/action-setup@v1` (CVE-2025-30154).
- CISA advisory issued March 18, 2025.
- `step-security/harden-runner` first detected the anomalous network egress.

**Validator checks informed by incident:**
- [ALWAYS] Flag any `uses:` line without full 40-char SHA.
- [ALWAYS] Flag `tj-actions/*` without SHA pin — known targeted namespace.
- [ALWAYS] Flag workflows missing `step-security/harden-runner` as first step.

### [1.3][IMMUTABLE_ACTIONS]

**Status:** OCI immutable publishing **paused** (not progressing to GA). GitHub pivoted to **org-level SHA pinning enforcement** as the primary supply chain control.

| [INDEX] | [CHECK]                          | [WHAT_TO_FLAG]                                                            |
| :-----: | -------------------------------- | ------------------------------------------------------------------------- |
|   [1]   | **OCI `ghcr.io/` action refs**   | Informational — not yet GA; document as experimental if encountered.      |
|   [2]   | **Org SHA enforcement disabled** | Flag if repo is GHEC/GHES 3.12+ and enforcement not enabled.              |
|   [3]   | **`publish-immutable-action`**   | Flag as experimental — repo exists but not usable for external consumers. |

**Current posture:** SHA pinning + Dependabot/Renovate automated updates. Org setting "Require actions to be pinned to a full-length commit SHA" enforces `@<40-char-SHA>` format, rejects `@v1`/`@main` refs. Available in GitHub Enterprise Cloud and Server 3.12+.

---
## [2][OIDC_FEDERATION]
>**Dictum:** *OIDC eliminates long-lived credentials — detect static credential usage and missing permissions.*

<br>

**Required permission:** `id-token: write` at job level. Short-lived tokens per session — zero rotation overhead.

### [2.1][DETECTION_RULES]

| [INDEX] | [CHECK]                               | [TAG]          | [WHAT_TO_FLAG]                                                          |
| :-----: | ------------------------------------- | -------------- | ----------------------------------------------------------------------- |
|   [1]   | **Static cloud credentials**          | `[OIDC]`       | `secrets.AWS_ACCESS_KEY_ID` / `secrets.AWS_SECRET_ACCESS_KEY` in steps. |
|   [2]   | **Missing `id-token: write`**         | `[OIDC-PERM]`  | OIDC action present but `id-token: write` missing from permissions.     |
|   [3]   | **Old OIDC action versions**          | `[OIDC-VER]`   | Pre-current major versions of cloud auth actions.                       |
|   [4]   | **Missing subject claim restriction** | `[OIDC-TRUST]` | Flag if OIDC trust policy review is recommended.                        |

### [2.2][PROVIDER_MATRIX]

| [INDEX] | [PROVIDER] | [ACTION]                                | [CURRENT_MAJOR] | [KEY_INPUTS]                                    |
| :-----: | ---------- | --------------------------------------- | :-------------: | ----------------------------------------------- |
|   [1]   | **AWS**    | `aws-actions/configure-aws-credentials` |       v6        | `role-to-assume`, `aws-region`                  |
|   [2]   | **GCP**    | `google-github-actions/auth`            |       v3        | `workload_identity_provider`, `service_account` |
|   [3]   | **Azure**  | `azure/login`                           |       v2        | `client-id`, `tenant-id`, `subscription-id`     |

Subject claims include repo, branch, and environment for fine-grained trust policies.

### [2.3][COMMON_ERRORS]

| [INDEX] | [ERROR]                                                       | [CAUSE]                                                   |
| :-----: | ------------------------------------------------------------- | --------------------------------------------------------- |
|   [1]   | **`Not authorized to perform sts:AssumeRoleWithWebIdentity`** | Trust policy `sub` claim does not match workflow context. |
|   [2]   | **`No OpenIDConnect provider found`**                         | OIDC identity provider not created in cloud account.      |
|   [3]   | **Missing `id-token: write`**                                 | Permission absent from job-level `permissions:` block.    |

---
## [3][SBOM_AND_PROVENANCE]
>**Dictum:** *Attestation validation ensures artifacts carry verifiable provenance.*

<br>

### [3.1][SLSA_LEVELS]

| [INDEX] | [LEVEL]      | [REQUIREMENT]             | [IMPLEMENTATION]                                        |
| :-----: | ------------ | ------------------------- | ------------------------------------------------------- |
|   [1]   | **Build L1** | Documented build process. | Workflow file in repository.                            |
|   [2]   | **Build L2** | Signed provenance.        | `actions/attest-build-provenance` (v3) + OIDC.          |
|   [3]   | **Build L3** | Hardened build platform.  | Reusable workflows (isolated `job_workflow_ref` claim). |

**Required permissions:** `id-token: write`, `contents: read`, `attestations: write`.

### [3.2][DETECTION_RULES]

| [INDEX] | [CHECK]                       | [TAG]           | [WHAT_TO_FLAG]                                                   |
| :-----: | ----------------------------- | --------------- | ---------------------------------------------------------------- |
|   [1]   | **No provenance attestation** | `[PROVENANCE]`  | Container/binary release without `attest-build-provenance`.      |
|   [2]   | **No SBOM for containers**    | `[SBOM]`        | Docker build-push without `anchore/sbom-action` + `attest-sbom`. |
|   [3]   | **Missing attestation perms** | `[ATTEST-PERM]` | Attestation action present but `attestations: write` missing.    |
|   [4]   | **No cosign for signing**     | `[SIGNING]`     | Container push without `sigstore/cosign-installer` for signing.  |

### [3.3][VERIFICATION_SYNTAX]

**`gh attestation verify`** — GA in GitHub CLI (requires >= v2.47.0). Verifies Sigstore-signed provenance and SBOM attestations.

```bash
# Verify binary against repo attestations
gh attestation verify <file-path> --repo owner/repo

# Verify OCI image against org-wide attestations
gh attestation verify oci://ghcr.io/owner/image:tag --owner owner

# Offline verification with downloaded bundle
gh attestation verify <file-path> --bundle /path/to/attestation.jsonl

# JSON output for CI pipeline consumption
gh attestation verify <file-path> --repo owner/repo --format json
```

Key flags: `--repo` (single repo), `--owner` (org-wide), `--bundle` (offline), `--bundle-from-oci` (registry-stored), `--predicate-type` (non-default SLSA type), `--format json` (machine-readable).

---
## [4][HARDEN_RUNNER]
>**Dictum:** *Runtime monitoring detects supply chain compromise in CI — validate presence and configuration.*

<br>

**Canonical version:** v2.14.2. EDR-class agent for GitHub Actions runners.

### [4.1][CAPABILITIES]

| [INDEX] | [FEATURE]                     | [DESCRIPTION]                                                     |
| :-----: | ----------------------------- | ----------------------------------------------------------------- |
|   [1]   | **Network egress monitoring** | Logs all outbound connections; detects anomalous endpoints.       |
|   [2]   | **Process auditing**          | Tracks process creation and file integrity changes.               |
|   [3]   | **DNS exfiltration guard**    | Blocks public DNS resolver fallback (fixed in v2.14.1).           |
|   [4]   | **Baseline generation**       | Automated baseline from past outbound connections per job.        |
|   [5]   | **Socket syscall coverage**   | sendto/sendmsg/sendmmsg audit logging (security fix in v2.14.2).  |
|   [6]   | **Selective installation**    | Skips install on repos with `skip_harden_runner` custom property. |

### [4.2][DETECTION_RULES]

| [INDEX] | [CHECK]                           | [TAG]      | [WHAT_TO_FLAG]                                              |
| :-----: | --------------------------------- | ---------- | ----------------------------------------------------------- |
|   [1]   | **Missing harden-runner**         | `[HARDEN]` | Security-sensitive job without harden-runner as first step. |
|   [2]   | **Not first step**                | `[HARDEN]` | harden-runner present but not the first step in `steps:`.   |
|   [3]   | **Audit-only in prod**            | `[HARDEN]` | `egress-policy: audit` in production/deploy environments.   |
|   [4]   | **Empty allowlist in block mode** | `[HARDEN]` | `egress-policy: block` without `allowed-endpoints`.         |
|   [5]   | **Old version**                   | `[HARDEN]` | Version < v2.14.2 — missing socket syscall audit fix.       |

---
## [5][TOKEN_HYGIENE]
>**Dictum:** *Token selection and scope validation prevent credential over-provisioning.*

<br>

### [5.1][TOKEN_SELECTION]

| [INDEX] | [TYPE]               | [SCOPE]            |  [LIFETIME]  | [CROSS_REPO] | [USE_CASE]           |
| :-----: | -------------------- | ------------------ | :----------: | :----------: | -------------------- |
|   [1]   | **`GITHUB_TOKEN`**   | Current repo       | Job duration |      No      | Standard in-repo CI. |
|   [2]   | **Fine-grained PAT** | Selected repos     | Up to 1 year |     Yes      | Personal automation. |
|   [3]   | **GitHub App token** | Installation repos |    1 hour    |     Yes      | Org-wide automation. |

### [5.2][DETECTION_RULES]

| [INDEX] | [CHECK]                       | [TAG]           | [WHAT_TO_FLAG]                                                  |
| :-----: | ----------------------------- | --------------- | --------------------------------------------------------------- |
|   [1]   | **PAT for cross-repo**        | `[APP-TOKEN]`   | `secrets.*_PAT` or `secrets.*_TOKEN` for cross-repo operations. |
|   [2]   | **`permissions: write-all`**  | `[PERMISSIONS]` | Overly broad permissions — use explicit per-job scopes.         |
|   [3]   | **`permissions: {}` missing** | `[PERMISSIONS]` | No top-level deny-all default.                                  |
|   [4]   | **Secrets in `run:` blocks**  | `[INJECTION]`   | `${{ secrets.* }}` directly interpolated in `run:` blocks.      |

### [5.3][APP_TOKEN_ERRORS]

| [INDEX] | [ERROR]                                          | [CAUSE]                                                          |
| :-----: | ------------------------------------------------ | ---------------------------------------------------------------- |
|   [1]   | **`Could not create installation access token`** | App not installed on the target org/repo.                        |
|   [2]   | **`Resource not accessible by integration`**     | Missing permissions in the GitHub App configuration.             |
|   [3]   | **Token expired**                                | Token generated too early — regenerate before the step (1h TTL). |

---
## [6][DEPENDENCY_REVIEW]
>**Dictum:** *Automated dependency review gates PRs on license and vulnerability policy.*

<br>

| [INDEX] | [CHECK]                       | [TAG]       | [WHAT_TO_FLAG]                                                    |
| :-----: | ----------------------------- | ----------- | ----------------------------------------------------------------- |
|   [1]   | **No dependency review**      | `[DEP-REV]` | PR workflow without `actions/dependency-review-action`.           |
|   [2]   | **No secret scanning**        | `[SECRETS]` | Push protection not enabled — up to 500 custom patterns.          |
|   [3]   | **No gitleaks**               | `[SECRETS]` | Missing `gitleaks/gitleaks-action` for CI-level secret scanning.  |
|   [4]   | **No Dependabot for actions** | `[MAINT]`   | Missing `.github/dependabot.yml` with `github-actions` ecosystem. |

---
## [7][NODE_RUNTIME]
>**Dictum:** *Runtime deprecation detection prevents workflow failures on forced migration.*

<br>

| [INDEX] | [RUNTIME]  | [STATUS]                                  |    [DEADLINE]     |
| :-----: | ---------- | ----------------------------------------- | :---------------: |
|   [1]   | **node16** | Removed.                                  | Already enforced. |
|   [2]   | **node20** | Deprecated — forced migration to node24.  |  March 4, 2026.   |
|   [3]   | **node22** | Skipped — GitHub jumped node20 -> node24. |       N/A.        |
|   [4]   | **node24** | Current default.                          |      Active.      |

[IMPORTANT]:
- [ALWAYS] Flag actions still bundled with node20 runtime — will break after March 4, 2026.
- [ALWAYS] Flag `actions/cache@v3` or `@v4` — requires v5 for node24 compatibility.
- [ALWAYS] Flag `actions/checkout@v4` or earlier — v6 is current stable with node22+ runtime.
