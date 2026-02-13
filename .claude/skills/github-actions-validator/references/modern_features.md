# [H1][MODERN-FEATURES]
>**Dictum:** *Modern workflow features enable reuse, safety, and performance — validate correct usage and limits.*

<br>

---
## [1][REUSABLE_WORKFLOWS]
>**Dictum:** *Reusable workflows share entire pipelines across repositories — validate nesting, counts, and input types.*

<br>

### [1.1][LIMITS]

| [INDEX] | [CONSTRAINT]                 |            [LIMIT]            | [WHAT_TO_FLAG]                                                         |
| :-----: | ---------------------------- | :---------------------------: | ---------------------------------------------------------------------- |
|   [1]   | **Nesting depth**            |           10 levels           | Top-level caller + up to 9 levels of nested reusable workflows.        |
|   [2]   | **Unique workflows per run** |              50               | Total distinct reusable workflows across all nesting trees.            |
|   [3]   | **Input types**              | `string`, `number`, `boolean` | Any other `type:` value in `workflow_call` inputs is invalid.          |
|   [4]   | **Secret propagation**       |     Explicit or `inherit`     | `secrets: inherit` passes all caller secrets to the reusable workflow. |
|   [5]   | **Output references**        |  `jobs.<id>.outputs.<name>`   | Caller must match the exact job ID and output name from callee.        |

### [1.2][DETECTION_RULES]

| [INDEX] | [CHECK]                       | [TAG]          | [WHAT_TO_FLAG]                                                          |
| :-----: | ----------------------------- | -------------- | ----------------------------------------------------------------------- |
|   [1]   | **Invalid input type**        | `[REUSABLE]`   | `type:` not in `{string, number, boolean}` for `workflow_call` inputs.  |
|   [2]   | **Missing required secrets**  | `[REUSABLE]`   | Caller omits secrets consumed by the reusable workflow.                 |
|   [3]   | **Output reference mismatch** | `[REUSABLE]`   | Caller references output not exposed by the reusable workflow.          |
|   [4]   | **Circular call chain**       | `[REUSABLE]`   | Workflow A calls B which calls A (loop detection).                      |
|   [5]   | **SLSA L3 without reusable**  | `[PROVENANCE]` | `job_workflow_ref` claim requires reusable workflow for isolated build. |

[REFERENCE] Reusable workflow orchestration: [->advanced-triggers.md SS ORCHESTRATION_PATTERNS](../../../github-actions-generator/references/advanced-triggers.md).

---
## [2][DEPLOYMENT_ENVIRONMENTS]
>**Dictum:** *Environment protection rules gate deployments on approval and conditions — validate configuration.*

<br>

### [2.1][PROTECTION_RULES]

| [INDEX] | [RULE]                           |      [LIMIT]       | [VALIDATION]                                                          |
| :-----: | -------------------------------- | :----------------: | --------------------------------------------------------------------- |
|   [1]   | **Required reviewers**           |      Up to 6       | Must be org/team members with repo access.                            |
|   [2]   | **Wait timer**                   |  0-43,200 minutes  | Delay before deployment starts (max 30 days).                         |
|   [3]   | **Deployment branches/tags**     |   Pattern-based    | Restrict which refs can deploy to this environment.                   |
|   [4]   | **Environment secrets**          |   Scoped to env    | Only available to jobs targeting this environment.                    |
|   [5]   | **Custom deployment protection** | GitHub App webhook | Third-party gates: Datadog, Honeycomb, ServiceNow, New Relic, Sentry. |

### [2.2][CUSTOM_PROTECTION_RULES]

**Status:** GA for public repos (all plans) and private/internal repos (Enterprise only).

Custom deployment protection rules use GitHub Apps subscribing to the `deployment_protection_rule` webhook. External service approves/rejects based on health metrics, ITSM tickets, vulnerability scans, or other criteria.

| [INDEX] | [CHECK]                        | [TAG]   | [WHAT_TO_FLAG]                                                   |
| :-----: | ------------------------------ | ------- | ---------------------------------------------------------------- |
|   [1]   | **Undefined environment name** | `[ENV]` | Environment referenced in workflow not created in repo settings. |
|   [2]   | **Missing `url:` for deploy**  | `[ENV]` | Deployment jobs without `url:` lose deployment tracking in UI.   |
|   [3]   | **Protection gate timeout**    | `[ENV]` | External gate must respond within 30 days (default timeout).     |
|   [4]   | **No protection on prod**      | `[ENV]` | Production environment without any protection rules configured.  |

---
## [3][JOB_SUMMARIES]
>**Dictum:** *Step summaries render Markdown in the workflow run UI — validate size limits.*

<br>

| [INDEX] | [CONSTRAINT]              |         [LIMIT]          | [WHAT_TO_FLAG]                                     |
| :-----: | ------------------------- | :----------------------: | -------------------------------------------------- |
|   [1]   | **Per-step size**         |          1 MiB           | Exceeding truncates with error annotation.         |
|   [2]   | **Per-job display count** |    20 step summaries     | Only first 20 step summaries rendered per job.     |
|   [3]   | **Content format**        | GitHub-flavored Markdown | Tables, badges, `<details>` sections, HTML tables. |
|   [4]   | **Secret masking**        |       Auto-applied       | Same masking rules as log output.                  |

```yaml
# Correct: quote the env file variable
- run: |
    echo "## Build Results" >> "$GITHUB_STEP_SUMMARY"
    echo "| Metric | Value |" >> "$GITHUB_STEP_SUMMARY"
    echo "|---|---|" >> "$GITHUB_STEP_SUMMARY"
    echo "| Status | ${{ job.status }} |" >> "$GITHUB_STEP_SUMMARY"
```

[IMPORTANT] Always quote `$GITHUB_STEP_SUMMARY` in `run:` blocks to prevent word splitting.

---
## [4][CONTAINER_JOBS]
>**Dictum:** *Container jobs provide isolated environments — validate images, networking, and health checks.*

<br>

### [4.1][NETWORKING]

| [INDEX] | [SCENARIO]           | [SERVICE_ACCESS]                                 | [PORT_MAPPING]                   |
| :-----: | -------------------- | ------------------------------------------------ | -------------------------------- |
|   [1]   | **Job in container** | Service name as hostname (`postgres://postgres`) | No port mapping needed.          |
|   [2]   | **Job on runner**    | `localhost` with mapped ports                    | `ports: ['5432:5432']` required. |

### [4.2][DETECTION_RULES]

| [INDEX] | [CHECK]                     | [TAG]         | [WHAT_TO_FLAG]                                                   |
| :-----: | --------------------------- | ------------- | ---------------------------------------------------------------- |
|   [1]   | **Missing health check**    | `[CONTAINER]` | Service container without `--health-cmd` in `options:`.          |
|   [2]   | **Invalid image reference** | `[CONTAINER]` | Unqualified image tag (no registry/version) — supply chain risk. |
|   [3]   | **Linux-only constraint**   | `[CONTAINER]` | Container jobs and services only run on Linux runners.           |
|   [4]   | **Missing credentials**     | `[CONTAINER]` | Private registry image without `credentials:` block.             |
|   [5]   | **Port conflict**           | `[CONTAINER]` | Multiple services mapping to same host port.                     |

```yaml
# Correct: container job with service health check
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: node:24
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
```

[IMPORTANT] When job runs in a container, service containers share a Docker network — use service name as hostname, no port mapping.

---
## [5][CONCURRENCY_CONTROL]
>**Dictum:** *Concurrency groups prevent redundant and conflicting runs — validate group naming and cancel semantics.*

<br>

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

| [INDEX] | [CHECK]                          | [TAG]           | [WHAT_TO_FLAG]                                                      |
| :-----: | -------------------------------- | --------------- | ------------------------------------------------------------------- |
|   [1]   | **Cancel-in-progress on deploy** | `[CONCURRENCY]` | `cancel-in-progress: true` on deployment jobs risks partial state.  |
|   [2]   | **Static group name**            | `[CONCURRENCY]` | Group without `${{ }}` context serializes ALL runs of the workflow. |
|   [3]   | **Missing concurrency on CI**    | `[CONCURRENCY]` | PR-triggered workflow without concurrency wastes runner minutes.    |

**Semantics:** Max 1 running + 1 pending per group. When a third run enters, the pending run is cancelled (not the running one). `cancel-in-progress: true` cancels the running job instead. Use `false` for deployments to avoid partial state.

---
## [6][YAML_ANCHORS]
>**Dictum:** *YAML anchors reduce duplication within a single file — validate anchor/alias correctness and limitations.*

<br>

**Status:** Supported since September 2025. Basic YAML 1.2.2 anchors (`&name`) and aliases (`*name`) only.

### [6.1][LIMITATIONS]

| [INDEX] | [CONSTRAINT]           | [DETAIL]                                                                  |
| :-----: | ---------------------- | ------------------------------------------------------------------------- |
|   [1]   | **No merge keys**      | `<<: *anchor` is NOT supported — actionlint 1.7.10 reports this as error. |
|   [2]   | **File-scoped**        | Anchors cannot cross workflow files — use reusable workflows instead.     |
|   [3]   | **Sequence expansion** | Use `- *anchor` for sequence items, not `<<:` for mapping merge.          |
|   [4]   | **`uses:` is static**  | Anchors cannot dynamically construct `uses:` action references.           |

### [6.2][ACTIONLINT_CHECKS]

| [INDEX] | [CHECK]             | [TAG]    | [WHAT_TO_FLAG]                                    |
| :-----: | ------------------- | -------- | ------------------------------------------------- |
|   [1]   | **Undefined alias** | `[YAML]` | `*name` referenced before `&name` is defined.     |
|   [2]   | **Unused anchor**   | `[YAML]` | `&name` defined but never referenced via `*name`. |
|   [3]   | **Merge key `<<:`** | `[YAML]` | GitHub Actions does not support YAML merge keys.  |

```yaml
# Correct: anchor and alias for shared step sequences
x-setup: &setup
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  - uses: actions/setup-node@6044e13b5dc448c55e2357c09f80417699197238 # v6.2.0
    with: { node-version: '24', cache: 'pnpm' }
  - run: corepack enable && pnpm install --frozen-lockfile

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - *setup
      - run: pnpm lint
```

---
## [7][MATRIX_STRATEGY]
>**Dictum:** *Matrix strategy interaction semantics govern failure propagation and concurrency.*

<br>

| [INDEX] | [KEY]                   |        [DEFAULT]        | [BEHAVIOR]                                                                           |
| :-----: | ----------------------- | :---------------------: | ------------------------------------------------------------------------------------ |
|   [1]   | **`fail-fast`**         |         `true`          | Cancels all in-progress/queued matrix jobs when any job fails.                       |
|   [2]   | **`max-parallel`**      | Unlimited (runner pool) | Limits concurrent matrix jobs. Omit for maximum parallelism.                         |
|   [3]   | **`continue-on-error`** |         `false`         | Per-job: `true` masks failure from `fail-fast` and downstream `needs:` sees success. |

**Interaction semantics:** `continue-on-error: true` on a matrix job masks its failure from `fail-fast` — remaining matrix jobs continue. Downstream `needs:` jobs see the failed job's result as `success`, hiding real failures. **Recommended:** Use `fail-fast: false` without `continue-on-error`, then aggregate results via `needs.*.result` in a downstream job.

| [INDEX] | [CHECK]                         | [TAG]      | [WHAT_TO_FLAG]                                                       |
| :-----: | ------------------------------- | ---------- | -------------------------------------------------------------------- |
|   [1]   | **Non-array matrix value**      | `[MATRIX]` | Matrix values must be arrays: `os: [ubuntu-latest, windows-latest]`. |
|   [2]   | **Empty `include:` array**      | `[MATRIX]` | `include: []` produces zero matrix combinations.                     |
|   [3]   | **`continue-on-error` masking** | `[MATRIX]` | `continue-on-error: true` with `fail-fast: true` hides failures.     |
|   [4]   | **Exceeds 256 jobs**            | `[MATRIX]` | Matrix expansion exceeds 256 job limit per workflow.                 |

---
## [8][NODE_RUNTIME]
>**Dictum:** *Node.js runtime migration timeline governs action compatibility — validate against deadlines.*

<br>

| [INDEX] | [RUNTIME]      | [STATUS]                                                      |
| :-----: | -------------- | ------------------------------------------------------------- |
|   [1]   | **Node.js 12** | Removed — actions fail at runtime.                            |
|   [2]   | **Node.js 16** | Removed — actions fail at runtime.                            |
|   [3]   | **Node.js 20** | Deprecated — forced migration to node24 on **March 4, 2026**. |
|   [4]   | **Node.js 22** | Skipped — GitHub jumped node20 directly to node24.            |
|   [5]   | **Node.js 24** | Required — use `using: 'node24'` for JavaScript actions.      |

### [8.1][MIGRATION_TIMELINE]

| [INDEX] | [DATE]             | [EVENT]                                                                                    |
| :-----: | ------------------ | ------------------------------------------------------------------------------------------ |
|   [1]   | **Fall 2025**      | Runner v2.328+ supports node20 and node24 side-by-side.                                    |
|   [2]   | **March 4, 2026**  | node24 forced default. node20 fails unless `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true`. |
|   [3]   | **April 30, 2026** | Node.js 20 reaches upstream EOL.                                                           |
|   [4]   | **Summer 2026**    | node20 fully removed — environment variable override stops working.                        |

### [8.2][DETECTION_RULES]

| [INDEX] | [CHECK]                                  | [TAG]       | [WHAT_TO_FLAG]                                                          |
| :-----: | ---------------------------------------- | ----------- | ----------------------------------------------------------------------- |
|   [1]   | **node20 action**                        | `[RUNTIME]` | Actions using `runs.using: 'node20'` — will break after March 4, 2026.  |
|   [2]   | **Old action major**                     | `[RUNTIME]` | `actions/cache@v3`/`@v4`, `actions/checkout@v4` — require latest major. |
|   [3]   | **`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`** | `[RUNTIME]` | Early testing env var — flag if present in production workflows.        |

[IMPORTANT] Early testing: set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` as workflow env var. node24 is incompatible with macOS 13.4 and earlier; ARM32 self-hosted runners are unsupported.

---
## [9][WORKFLOW_DISPATCH_INPUTS]
>**Dictum:** *Manual trigger inputs have type constraints and count limits.*

<br>

| [INDEX] | [CONSTRAINT]         |                        [LIMIT]                         | [WHAT_TO_FLAG]                                              |
| :-----: | -------------------- | :----------------------------------------------------: | ----------------------------------------------------------- |
|   [1]   | **Max inputs**       |                           25                           | Increased from 10 — actionlint 1.7.10 validates this limit. |
|   [2]   | **Payload size**     |                      65,535 chars                      | Total payload for API-triggered dispatches.                 |
|   [3]   | **Valid types**      | `string`, `boolean`, `choice`, `number`, `environment` | Other types are invalid.                                    |
|   [4]   | **`choice` options** |                     Required list                      | `type: choice` without `options:` list is an error.         |

---
## [10][ACTIONLINT_FEATURES]
>**Dictum:** *actionlint 1.7.10 validation capabilities inform what can be statically checked.*

<br>

| [INDEX] | [FEATURE]                          | [VERSION] | [DESCRIPTION]                                                     |
| :-----: | ---------------------------------- | :-------: | ----------------------------------------------------------------- |
|   [1]   | **YAML anchor validation**         |  1.7.10   | Checks undefined aliases, unused anchors, merge key `<<:` errors. |
|   [2]   | **Deprecated input detection**     |   1.7.9   | Flags inputs with `deprecationMessage` in action metadata.        |
|   [3]   | **`node24` runtime support**       |   1.7.8   | Recognizes `using: 'node24'` in action metadata.                  |
|   [4]   | **Constant `if:` detection**       |  1.7.10   | Detects `if: true`, `if: false`, and complex constant conditions. |
|   [5]   | **`workflow_call` input type**     |  1.7.10   | Flags invalid `type:` values in reusable workflow inputs.         |
|   [6]   | **`workflow_dispatch` 25 inputs**  |  1.7.10   | Validates the relaxed 25-input limit.                             |
|   [7]   | **`ubuntu-slim` label**            |   1.7.9   | Recognizes the slim runner label.                                 |
|   [8]   | **`windows-2025` label**           |  1.7.10   | Recognizes the Windows Server 2025 runner label.                  |
|   [9]   | **`models` permission**            |   1.7.8   | Validates `models` in job-level `permissions:`.                   |
|  [10]   | **`artifact-metadata` permission** |  1.7.10   | Validates `artifact-metadata` in job-level `permissions:`.        |
