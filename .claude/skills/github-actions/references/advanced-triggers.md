# [H1][ADVANCED-TRIGGERS]
>**Dictum:** *Trigger selection determines security context, secret access, and orchestration capability.*

<br>

---
## [1][TRIGGER_SELECTION]
>**Dictum:** *Scenario determines trigger type; path filters scope execution.*

<br>

| [INDEX] | [SCENARIO]                    | [TRIGGER]                           | [SECRETS] | [PATH_FILTER] |
| :-----: | ----------------------------- | ----------------------------------- | :-------: | :-----------: |
|   [1]   | **Standard PR validation**    | `pull_request`                      |    No     |      Yes      |
|   [2]   | **External PR with secrets**  | `workflow_run` after `pull_request` |    Yes    |      No       |
|   [3]   | **Deploy after CI**           | `workflow_run`                      |    Yes    |      No       |
|   [4]   | **External webhook/API**      | `repository_dispatch`               |    Yes    |      No       |
|   [5]   | **ChatOps slash commands**    | `issue_comment`                     |    Yes    |      No       |
|   [6]   | **Scheduled tasks**           | `schedule`                          |    Yes    |      No       |
|   [7]   | **Merge queue validation**    | `merge_group`                       |    Yes    |      No       |
|   [8]   | **Trusted ops on fork PRs**   | `pull_request_target`               |    Yes    |      Yes      |
|   [9]   | **Manual parametric trigger** | `workflow_dispatch`                 |    Yes    |      No       |

```yaml
on:
  push:
    paths: ['src/**', '!src/**/*.md', '!**/__tests__/**']
  pull_request:
    paths: ['packages/frontend/**', 'packages/shared/**']
```

---
## [2][WORKFLOW_RUN]
>**Dictum:** *Workflow chaining runs with target branch context for safe secret access.*

<br>

```yaml
on:
  workflow_run:
    workflows: ["CI Pipeline"]
    types: [completed]
    branches: [main]
jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA> # v6
      - uses: actions/download-artifact@<SHA> # v7
        with: { run-id: '${{ github.event.workflow_run.id }}', github-token: '${{ secrets.GITHUB_TOKEN }}' }
```

**Properties:** `.name`, `.conclusion`, `.head_sha`, `.head_branch`, `.id`, `.event`

[IMPORTANT] Max 3 levels of chaining. Artifacts accessible via `run-id` from triggering workflow.

---
## [3][REPOSITORY_DISPATCH]
>**Dictum:** *External API triggers enable cross-system orchestration.*

<br>

```yaml
on:
  repository_dispatch:
    types: [deploy-prod, deploy-staging, run-migration]
jobs:
  deploy:
    if: startsWith(github.event.action, 'deploy-')
    runs-on: ubuntu-latest
    environment: ${{ github.event.client_payload.environment || 'staging' }}
    steps:
      - run: printf 'Version: %s\n' "${{ github.event.client_payload.version }}"
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/OWNER/REPO/dispatches" \
  -d '{"event_type":"deploy-prod","client_payload":{"version":"v1.2.3"}}'
```

[CRITICAL] Only triggers on default branch. Cross-repo dispatch requires App token or PAT.

---
## [4][CHATOPS]
>**Dictum:** *Issue comment triggers require permission validation and argument sanitization.*

<br>

```yaml
on:
  issue_comment: { types: [created] }
jobs:
  deploy:
    if: |
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '/deploy') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-latest
    permissions: { pull-requests: write, deployments: write }
    steps:
      - uses: actions/github-script@<SHA> # v8
        with:
          script: |
            await github.rest.reactions.createForIssueComment({
              owner: context.repo.owner, repo: context.repo.repo,
              comment_id: context.payload.comment.id, content: 'rocket'
            });
```

[IMPORTANT] Verify `author_association`. Pass comment content through `env:` indirection. [REFERENCE] [->expressions-and-contexts.md§INJECTION_PREVENTION](./expressions-and-contexts.md).

---
## [5][WORKFLOW_DISPATCH]
>**Dictum:** *Manual triggers accept typed inputs with UI rendering.*

<br>

```yaml
on:
  workflow_dispatch:
    inputs:
      environment: { description: 'Deployment target', required: true, type: environment }
      log-level: { description: 'Verbosity', type: choice, default: 'info', options: [debug, info, warn, error] }
      dry-run: { description: 'Simulate', type: boolean, default: false }
      version: { description: 'Release version', required: true, type: string }
```

| [INDEX] | [TYPE]            | [UI_RENDERING]       | [NOTES]                     |
| :-----: | ----------------- | -------------------- | --------------------------- |
|   [1]   | **`string`**      | Free text            | Default if unspecified.     |
|   [2]   | **`boolean`**     | Checkbox             | `true` / `false`.           |
|   [3]   | **`choice`**      | Dropdown             | From `options:` list.       |
|   [4]   | **`number`**      | Numeric input        | Validated as integer/float. |
|   [5]   | **`environment`** | Environment selector | Respects protection rules.  |

**`ref` parameter:** API triggers specify branch/tag/SHA via `ref` field in request body. UI triggers use branch picker dropdown. Max 25 inputs, 65,535 chars payload.

---
## [6][SCHEDULE]
>**Dictum:** *Cron schedules run in UTC with no native timezone support.*

<br>

[IMPORTANT] All `schedule` cron expressions evaluate in **UTC only** (no timezone override). Timezone support is on GitHub roadmap (Q1 2026 preview). Convert local times manually. Schedules only run on the default branch.

---
## [7][MERGE_GROUP]
>**Dictum:** *Merge queue validates combined changes before merge to target branch.*

<br>

```yaml
on:
  pull_request:
  merge_group: { types: [checks_requested] }
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA> # v6
      - run: npm test
```

[CRITICAL] Add `merge_group` alongside `pull_request` when using merge queue — without it, required checks never report.

**Context properties:** `base_ref`, `base_sha`, `head_ref`, `head_sha`, `head_commit.*`

---
## [8][PULL_REQUEST_TARGET]
>**Dictum:** *Target-branch triggers require strict isolation from PR head code.*

<br>

**Dec 8, 2025 enforcement (active):** Workflow source always comes from default branch — no matter which branch the PR targets. `GITHUB_REF` resolves to `refs/heads/main`; `GITHUB_SHA` points to default branch HEAD at run start. Environment protection rules evaluate against the execution ref. This eliminates "pwn request" attacks where malicious PRs modified workflow definitions.

[CRITICAL]:
- [NEVER] Checkout PR head without environment protection gate (required reviewers).
- [ALWAYS] Use for labeling, commenting, triage only.

```yaml
on:
  pull_request_target: { types: [opened, labeled] }
jobs:
  triage:
    runs-on: ubuntu-latest
    permissions: { pull-requests: write }
    steps:
      - uses: actions/github-script@<SHA> # v8
        with:
          script: |
            await github.rest.issues.addLabels({
              ...context.repo, issue_number: context.issue.number, labels: ['needs-review']
            });
```

---
## [9][DYNAMIC_MATRIX]
>**Dictum:** *Dynamic matrix generation enables data-driven parallel job execution.*

<br>

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.set-matrix.outputs.matrix }}
    steps:
      - id: set-matrix
        run: |
          echo "matrix=$(jq -c . <<'EOF'
          {"include":[{"project":"api","node":"20"},{"project":"web","node":"22"}]}
          EOF
          )" >> "$GITHUB_OUTPUT"
  build:
    needs: setup
    strategy:
      fail-fast: true
      max-parallel: 4
      matrix: ${{ fromJSON(needs.setup.outputs.matrix) }}
    runs-on: ubuntu-latest
    steps:
      - run: echo "Building ${{ matrix.project }} on Node ${{ matrix.node }}"
```

| [INDEX] | [KEY]                   | [DEFAULT]                   | [BEHAVIOR]                                                                                                                      |
| :-----: | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | **`fail-fast`**         | `true`                      | Cancels all in-progress/queued matrix jobs when any job fails.                                                                  |
|   [2]   | **`max-parallel`**      | Unlimited (runner pool cap) | Limits concurrent matrix jobs. Omit for maximum parallelism.                                                                    |
|   [3]   | **`continue-on-error`** | `false`                     | Per-job override: `true` prevents that job's failure from triggering fail-fast, and downstream `needs:` jobs see it as success. |

**Interaction semantics:** `continue-on-error: true` on a matrix job masks its failure from `fail-fast` — remaining matrix jobs continue. However, downstream `needs:` jobs see the failed job's result as `success`, which can hide real failures. **Recommended pattern:** Use `fail-fast: false` (let all matrix jobs run) without `continue-on-error`, then aggregate results in a downstream job via `needs.*.result`.

[IMPORTANT] `uses:` values are static strings — not dynamically generated. Max 256 jobs per matrix.

---
## [10][ORCHESTRATION_PATTERNS]
>**Dictum:** *Promotion chains, reusable workflows, and concurrency groups enforce deployment order.*

<br>

| [INDEX] | [PATTERN]                 | [KEY_RULES]                                                                                                |
| :-----: | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
|   [1]   | **Environment promotion** | Chain via `needs:` — each with independent protection rules (reviewers, wait timers, branch restrictions). |
|   [2]   | **Reusable workflows**    | Max 2 nesting levels, 50 unique/run. `secrets: inherit` at each level. `job_workflow_ref` for SLSA L3.     |
|   [3]   | **Concurrency groups**    | Max 1 running + 1 pending/group. `cancel-in-progress: true` for CI; `false` for deploys (state risk).      |

[REFERENCE] [->best-practices.md§ORGANIZATIONAL_CONTROLS](./best-practices.md).
