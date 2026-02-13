# [H1][BEST-PRACTICES]
>**Dictum:** *Security hardening, supply chain integrity, and performance optimization govern workflow quality.*

<br>

---
## [1][SECURITY]
>**Dictum:** *Defense-in-depth layers prevent credential theft, injection, and unauthorized access.*

<br>

[CRITICAL]:
- [ALWAYS] SHA-pin every `uses:` reference — format: `owner/repo@<SHA> # vN.N.N`. [REFERENCE] Pinning protocol and incident history: [->version-discovery.md](./version-discovery.md).
- [ALWAYS] `step-security/harden-runner` as **first step** in every job — monitors network egress, file integrity, process activity. Block mode enforces endpoint allowlists.
- [ALWAYS] Minimal permissions at **job level** — top-level `permissions: {}` (deny-all default), grant per-job. [REFERENCE] Per-action permissions: [->version-discovery.md§COMMON_ACTIONS_INDEX](./version-discovery.md).
- [ALWAYS] OIDC federation for cloud auth (`id-token: write`) — eliminates static credentials entirely.
- [ALWAYS] `actions/create-github-app-token` for cross-repo ops — scoped, 1-hour expiry, survives offboarding.
- [NEVER] Direct `${{ }}` interpolation of untrusted input in `run:` blocks. [REFERENCE] Safe patterns: [->expressions-and-contexts.md§INJECTION_PREVENTION](./expressions-and-contexts.md).
- [NEVER] Mutable refs (`@main`, `@latest`, `@v1`) — SHA-pinned or immutable OCI only.

| [INDEX] | [TRIGGER]                 | [SECRETS] | [CODE_CONTEXT] | [RISK]                                      |
| :-----: | ------------------------- | :-------: | -------------- | ------------------------------------------- |
|   [1]   | **`pull_request`**        |    No     | PR branch      | Safe — no secret access.                    |
|   [2]   | **`pull_request_target`** |    Yes    | Default branch | High — never checkout PR head without gate. |
|   [3]   | **`workflow_run`**        |    Yes    | Default branch | Safe if validating conclusion.              |

[IMPORTANT] **Secure-by-Default (Dec 8, 2025 — enforced):** `pull_request_target` workflows now anchor execution to default-branch definitions. `GITHUB_REF` resolves to `refs/heads/main`; `GITHUB_SHA` points to default branch HEAD at run start. Environment policy evaluation aligns with the execution ref. This cuts off "pwn request" attacks by pinning workflow source to a trusted branch. [->advanced-triggers.md§PULL_REQUEST_TARGET](./advanced-triggers.md).

---
### [1.1][GITHUB_TOKEN_SCOPES]

| [INDEX] | [SCOPE]           | [LEVELS]            | [COMMON_USE]                       |
| :-----: | ----------------- | ------------------- | ---------------------------------- |
|   [1]   | `actions`         | read / write / none | Manage workflow runs               |
|   [2]   | `attestations`    | read / write / none | Build provenance, SBOM attestation |
|   [3]   | `checks`          | read / write / none | Check runs and suites              |
|   [4]   | `contents`        | read / write / none | Repo content, commits, releases    |
|   [5]   | `deployments`     | read / write / none | Create/manage deployments          |
|   [6]   | `discussions`     | read / write / none | GitHub Discussions                 |
|   [7]   | `id-token`        | write / none        | OIDC federation (no read level)    |
|   [8]   | `issues`          | read / write / none | Issues and comments                |
|   [9]   | `models`          | read / none         | GitHub Models inference API        |
|  [10]   | `packages`        | read / write / none | Upload/publish packages (GHCR)     |
|  [11]   | `pages`           | read / write / none | GitHub Pages builds                |
|  [12]   | `pull-requests`   | read / write / none | PRs, labels, reviews               |
|  [13]   | `security-events` | read / write / none | Code scanning, SARIF upload        |
|  [14]   | `statuses`        | read / write / none | Commit statuses                    |

Shorthand: `permissions: read-all` / `permissions: write-all` / `permissions: {}` (deny-all). `write` implies `read` for all scopes except `id-token`.

---
## [2][SUPPLY_CHAIN]
>**Dictum:** *Layered controls secure artifacts from source to deployment.*

<br>

| [INDEX] | [CONTROL]             | [IMPLEMENTATION]                                                              |
| :-----: | --------------------- | ----------------------------------------------------------------------------- |
|   [1]   | **SHA pinning**       | [->version-discovery.md§SHA_PINNING_FORMAT](./version-discovery.md)           |
|   [2]   | **Harden-Runner**     | Audit mode first -> generate baseline -> enforce block mode with allowlist.   |
|   [3]   | **SLSA provenance**   | `actions/attest-build-provenance` = L2; reusable workflow caller = L3.        |
|   [4]   | **SBOM attestation**  | `anchore/sbom-action` (SPDX-JSON) + `actions/attest-sbom` -> registry.        |
|   [5]   | **Cosign signing**    | `sigstore/cosign-installer` keyless via OIDC — `cosign sign --yes`.           |
|   [6]   | **Immutable actions** | [->version-discovery.md§IMMUTABLE_ACTIONS](./version-discovery.md)            |
|   [7]   | **Dependency review** | `actions/dependency-review-action` on PRs — license + vulnerability gates.    |
|   [8]   | **Secret scanning**   | Push protection blocks detected secrets pre-merge; up to 500 custom patterns. |
|   [9]   | **Auto-maintenance**  | [->version-discovery.md§AUTOMATED_MAINTENANCE](./version-discovery.md)        |

<br>

### [2.1][OIDC_FEDERATION]

| [INDEX] | [PROVIDER] | [ACTION]                                | [KEY_INPUTS]                                    |
| :-----: | ---------- | --------------------------------------- | ----------------------------------------------- |
|   [1]   | **AWS**    | `aws-actions/configure-aws-credentials` | `role-to-assume`, `aws-region`                  |
|   [2]   | **GCP**    | `google-github-actions/auth`            | `workload_identity_provider`, `service_account` |
|   [3]   | **Azure**  | `azure/login`                           | `client-id`, `tenant-id`, `subscription-id`     |

Prerequisite: `permissions: { id-token: write }` at job level. Subject claims include repo, branch, environment for fine-grained trust policies. Short-lived tokens per session — zero rotation overhead.

---
### [2.2][TOKEN_SELECTION]

| [INDEX] | [TYPE]               | [SCOPE]            |  [LIFETIME]  | [CROSS_REPO] | [USE_CASE]           |
| :-----: | -------------------- | ------------------ | :----------: | :----------: | -------------------- |
|   [1]   | **`GITHUB_TOKEN`**   | Current repo       | Job duration |      No      | Standard in-repo CI. |
|   [2]   | **Fine-grained PAT** | Selected repos     | Up to 1 year |     Yes      | Personal automation. |
|   [3]   | **GitHub App token** | Installation repos |    1 hour    |     Yes      | Org-wide automation. |

[IMPORTANT] Prefer App tokens over PATs — scoped, auditable, account-independent.

---
## [3][PERFORMANCE]
>**Dictum:** *Caching, concurrency, and targeted execution minimize cost and latency.*

<br>

[IMPORTANT]:
- [ALWAYS] `actions/cache` or setup action built-in cache (`cache: 'pnpm'`) — v5 backend is ~80% faster uploads.
- [ALWAYS] `concurrency` groups with `cancel-in-progress: true` for CI; `false` for deploys.
- [ALWAYS] `timeout-minutes:` on every job — prevents runaway billing. Step-level `timeout-minutes:` also supported natively (not in composite actions).
- [ALWAYS] `paths:` / `paths-ignore:` filters to skip irrelevant workflows.
- [ALWAYS] Sparse checkout for monorepos — 96.6% clone time reduction in benchmarks.

```yaml
# Sparse checkout — monorepo: only needed packages
- uses: actions/checkout@<SHA> # v6
  with:
    sparse-checkout: |
      packages/api
      packages/shared
    sparse-checkout-cone-mode: true
    fetch-depth: 1
```

| [INDEX] | [LAYER]             | [PATH]               | [CACHE_KEY]                                                |
| :-----: | ------------------- | -------------------- | ---------------------------------------------------------- |
|   [1]   | **pnpm store**      | `$(pnpm store path)` | `${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}` |
|   [2]   | **Nx computation**  | `.nx/cache`          | `${{ runner.os }}-nx-${{ hashFiles('pnpm-lock.yaml') }}`   |
|   [3]   | **Docker BuildKit** | GHA cache backend    | `cache-from: type=gha` / `cache-to: type=gha,mode=max`     |

<br>

### [3.1][WORKFLOW_AND_RUNNER_LIMITS]

| [INDEX] | [LIMIT]                         | [VALUE]                                             |
| :-----: | ------------------------------- | --------------------------------------------------- |
|   [1]   | **Matrix jobs**                 | 256 per workflow run (hard limit).                  |
|   [2]   | **Job execution (hosted)**      | 6 hours max per job.                                |
|   [3]   | **Job execution (self-hosted)** | 5 days max per job.                                 |
|   [4]   | **Workflow run time**           | 35 days max per run.                                |
|   [5]   | **Job queue time**              | 24 hours before auto-cancel.                        |
|   [6]   | **GITHUB_OUTPUT**               | 1 MB per job; 50 MB total per workflow run.         |
|   [7]   | **GITHUB_STEP_SUMMARY**         | 1 MiB per step; max 20 summaries displayed per job. |
|   [8]   | **Artifact (individual)**       | 10 GB per artifact.                                 |
|   [9]   | **Artifacts per job**           | 500 max.                                            |
|  [10]   | **Cache**                       | 10 GB per repository.                               |
|  [11]   | **Workflow queue rate**         | 500 runs / 10 seconds per repository.               |
|  [12]   | **API rate (GITHUB_TOKEN)**     | 1,000 requests / hour per repository.               |

**Concurrent jobs (GitHub-hosted standard runners):**

| [INDEX] | [PLAN]         | [CONCURRENT_JOBS] | [macOS] |
| :-----: | -------------- | :---------------: | :-----: |
|   [1]   | **Free**       |        20         |    5    |
|   [2]   | **Pro**        |        40         |    5    |
|   [3]   | **Team**       |        60         |    5    |
|   [4]   | **Enterprise** |        500        |   50    |

Larger runners (Team/Enterprise): up to 1,000 concurrent jobs; 100 GPU max.

---
### [3.2][RUNNERS]

| [INDEX] | [TYPE]        | [SPEC]          | [NOTES]                                                    |
| :-----: | ------------- | --------------- | ---------------------------------------------------------- |
|   [1]   | **Standard**  | 2 vCPU / 7 GB   | Default `ubuntu-latest`.                                   |
|   [2]   | **4-core**    | 4 vCPU / 16 GB  | Team/Enterprise plans; SSD-backed.                         |
|   [3]   | **8-64-core** | 8-64 vCPU       | Up to 256 GB RAM; SSD-backed.                              |
|   [4]   | **GPU (T4)**  | 4 vCPU / 28 GB  | Tesla T4 / 16 GB VRAM; $0.07/min.                          |
|   [5]   | **ARM64**     | 4 vCPU (Cobalt) | `ubuntu-24.04-arm` — free for public repos; ~37% cost cut. |

[IMPORTANT] ARM64 labels: `ubuntu-24.04-arm`, `ubuntu-22.04-arm`. No `-arm64` suffix — the canonical format is `-arm`. Free for public repos; Team/Enterprise for private repos.

---
### [3.3][SELF_HOSTED_SCALING]

**Actions Runner Controller (ARC)** — Kubernetes operator for ephemeral, autoscaling self-hosted runners.

- Runner Scale Sets: ephemeral container-based runners; clean scale-up/down.
- ScaleSet Listener patches EphemeralRunnerSet replica count via K8s APIs.
- Install via Helm: `oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller`.
- Runner Groups: security boundaries controlling which orgs/repos access which runners.

---
## [4][CONTAINER_SERVICES]
>**Dictum:** *Service containers provide ephemeral backing services for integration tests.*

<br>

| [INDEX] | [SERVICE]    | [IMAGE]       | [HEALTH_CMD]      | [ENV]                                   |
| :-----: | ------------ | ------------- | ----------------- | --------------------------------------- |
|   [1]   | **Postgres** | `postgres:17` | `pg_isready`      | `POSTGRES_PASSWORD`, `POSTGRES_DB`      |
|   [2]   | **Redis**    | `redis:7`     | `redis-cli ping`  | _(none)_                                |
|   [3]   | **MySQL**    | `mysql:8`     | `mysqladmin ping` | `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE` |

Networking: service name as hostname inside container jobs (`postgres://postgres:5432`). VM runners use `localhost` with port mapping.

---
## [5][ORGANIZATIONAL_CONTROLS]
>**Dictum:** *Repository rulesets and required workflows enforce org-wide CI standards.*

<br>

- **Required workflows via rulesets**: org/enterprise-level CI enforcement; replaces deprecated `required_workflows` feature.
- **Ruleset features**: branch targeting, bypass rules for admins, evaluation/dry-run mode before enforcement.
- **Merge queue integration**: required workflow rulesets require `merge_group` event trigger alongside `pull_request`.
- **Environment protection**: required reviewers (1 of N), wait timers (1-43,200 min), deployment branch restrictions.

### [5.1][CUSTOM_DEPLOYMENT_PROTECTION_RULES]

**Status:** Generally Available. Powered by GitHub Apps via webhooks and callbacks.

- GitHub sends `deployment_protection_rule` webhook payload when a job reaches a protected environment.
- App responds via `POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule` with `state: "approved"` or `state: "rejected"`.
- Status reports support Markdown (up to 1,024 characters).
- Integrations: Datadog, ServiceNow, Honeycomb — external gates for canary metrics, change management, SLO verification.

---
## [6][ANTI_PATTERNS]
>**Dictum:** *Known anti-patterns require specific remediations.*

<br>

| [INDEX] | [ANTI_PATTERN]                                | [FIX]                                                                    |
| :-----: | --------------------------------------------- | ------------------------------------------------------------------------ |
|   [1]   | **`permissions: write-all`**                  | Explicit minimal permissions per job.                                    |
|   [2]   | **`@main` / `@latest` / `@v1`**               | SHA-pin with version comment; Dependabot auto-updates.                   |
|   [3]   | **No timeout on jobs**                        | `timeout-minutes:` on every job.                                         |
|   [4]   | **`actions/cache@v3`/`v4`**                   | v5 required — Node 24 runtime, faster backend (~80% upload speedup).     |
|   [5]   | **`set-output` / `save-state`**               | `>> $GITHUB_OUTPUT` / `>> $GITHUB_STATE`.                                |
|   [6]   | **Long-lived cloud credentials**              | OIDC federation (`id-token: write`).                                     |
|   [7]   | **PATs for cross-repo ops**                   | `actions/create-github-app-token` — scoped, auditable, 1-hour TTL.       |
|   [8]   | **No harden-runner**                          | `step-security/harden-runner` as first step; detected tj-actions breach. |
|   [9]   | **No SBOM for containers**                    | `anchore/sbom-action` + `actions/attest-sbom`.                           |
|  [10]   | **Intel-only CI**                             | ARM64 matrix: `ubuntu-24.04-arm` — free for public repos.                |
|  [11]   | **`cancel-in-progress` on deploy**            | Serialize deploys: `cancel-in-progress: false` (state corruption).       |
|  [12]   | **Checkout PR head in `pull_request_target`** | Environment protection gate with required reviewers.                     |
