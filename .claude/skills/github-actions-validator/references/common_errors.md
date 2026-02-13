# [H1][COMMON-ERRORS]
>**Dictum:** *Error catalog maps symptoms to root causes and fixes, aligned with actionlint rule names.*

<br>

---
## [1][SYNTAX_ERRORS]
>**Dictum:** *Structural errors prevent workflow parsing.*

<br>

| [INDEX] | [ERROR]                                         | [ACTIONLINT_RULE] | [FIX]                                                                               |
| :-----: | ----------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
|   [1]   | **`Unable to process file command 'workflow'`** | `syntax-check`    | Fix indentation, add missing colons.                                                |
|   [2]   | **`Required property is missing: name`**        | `syntax-check`    | Add `name:`, `on:`, `jobs:` at top level.                                           |
|   [3]   | **`Unexpected value 'on'`**                     | `events`          | Use `pull_request` not `pull-request`, `workflow_dispatch` not `workflow-dispatch`. |
|   [4]   | **`Unexpected key`**                            | `syntax-check`    | Remove unknown keys — check schema for valid properties.                            |
|   [5]   | **`Duplicate key`**                             | `syntax-check`    | YAML disallows duplicate mapping keys in same scope.                                |

---
## [2][EXPRESSION_ERRORS]
>**Dictum:** *Expression type mismatches and injection risks fail validation.*

<br>

| [INDEX] | [ERROR]                                  | [ACTIONLINT_RULE] | [FIX]                                                                    |
| :-----: | ---------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
|   [1]   | **`Unrecognized named-value`**           | `expression`      | Wrap in `${{ }}` or use bare expression in `if:`.                        |
|   [2]   | **`Expected boolean value, got string`** | `expression`      | Use `true`/`false` literals, not strings `'true'`.                       |
|   [3]   | **`Potential script injection`**         | `expression`      | Pass untrusted input through `env:` variable indirection.                |
|   [4]   | **`Constant condition at "if:"`**        | `if-cond`         | Remove constant `if: true`/`if: false` conditions.                       |
|   [5]   | **`Context access unavailable`**         | `expression`      | Context not available in this scope (e.g., `matrix` outside matrix job). |

### [2.1][EXPRESSION_INJECTION_DETECTION]

[CRITICAL] Direct interpolation of `${{ github.event.* }}` in `run:` blocks enables shell command injection from attacker-controlled PR titles, branch names, and commit messages.

**Untrusted fields** (attacker-controlled in fork PRs):

| [INDEX] | [FIELD]                                 | [ATTACK_VECTOR]                        |
| :-----: | --------------------------------------- | -------------------------------------- |
|   [1]   | `github.event.pull_request.title`       | PR title with shell metacharacters.    |
|   [2]   | `github.event.pull_request.body`        | PR body with injected commands.        |
|   [3]   | `github.event.pull_request.head.ref`    | Branch name with shell injection.      |
|   [4]   | `github.event.comment.body`             | Issue/PR comment body.                 |
|   [5]   | `github.event.head_commit.message`      | Commit message with injected commands. |
|   [6]   | `github.event.head_commit.author.name`  | Git author name (user-controlled).     |
|   [7]   | `github.event.head_commit.author.email` | Git author email (user-controlled).    |
|   [8]   | `github.event.discussion.title`         | Discussion title.                      |
|   [9]   | `github.event.discussion.body`          | Discussion body.                       |

```yaml
# UNSAFE: direct interpolation in run: block
- run: printf '%s\n' "${{ github.event.pull_request.title }}"

# SAFE: env var indirection
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
  run: printf '%s\n' "$PR_TITLE"
```

[REFERENCE] Injection prevention: [->expressions-and-contexts.md SS INJECTION_PREVENTION](../../../github-actions-generator/references/expressions-and-contexts.md).

---
## [3][DEPRECATED_COMMANDS]
>**Dictum:** *Removed commands require environment file replacements.*

<br>

| [INDEX] | [COMMAND]                          | [STATUS]            | [REPLACEMENT]                          |
| :-----: | ---------------------------------- | ------------------- | -------------------------------------- |
|   [1]   | **`::set-output name=KEY::VALUE`** | Removed (Jun 2023). | `echo "KEY=VALUE" >> "$GITHUB_OUTPUT"` |
|   [2]   | **`::save-state name=KEY::VALUE`** | Removed (Jun 2023). | `echo "KEY=VALUE" >> "$GITHUB_STATE"`  |
|   [3]   | **`::set-env name=KEY::VALUE`**    | Removed.            | `echo "KEY=VALUE" >> "$GITHUB_ENV"`    |
|   [4]   | **`::add-path::VALUE`**            | Removed.            | `echo "VALUE" >> "$GITHUB_PATH"`       |

**Still valid workflow commands:**
- `::add-mask::VALUE` — dynamically mask a value in subsequent logs.
- `::debug::MESSAGE` — debug-level log output.
- `::notice file=F,line=L::MESSAGE` — annotation on workflow run page.
- `::warning file=F,line=L::MESSAGE` — warning annotation.
- `::error file=F,line=L::MESSAGE` — error annotation.
- `::group::TITLE` / `::endgroup::` — collapsible log groups.

---
## [4][ACTION_ERRORS]
>**Dictum:** *Action resolution, input, and runtime errors require version-aware fixes.*

<br>

| [INDEX] | [ERROR]                                    | [ACTIONLINT_RULE] | [FIX]                                                              |
| :-----: | ------------------------------------------ | ----------------- | ------------------------------------------------------------------ |
|   [1]   | **`Can't find 'action.yml'`**              | `action`          | Verify spelling: `actions/checkout` not `actions/chekout`.         |
|   [2]   | **`Input required and not supplied`**      | `action`          | Add required inputs per action docs.                               |
|   [3]   | **`Unexpected input`**                     | `action`          | Remove undocumented inputs, check action metadata.                 |
|   [4]   | **Deprecated input**                       | `action`          | Input has `deprecationMessage` — use replacement from action docs. |
|   [5]   | **`Node.js 12/16 actions are deprecated`** | `action`          | Update to current major — node12/16 removed from runners.          |
|   [6]   | **`Node.js 20 actions are deprecated`**    | `action`          | Update to latest major (node24 required March 4, 2026).            |
|   [7]   | **Supply chain compromise**                | —                 | Pin to SHA, verify via `git ls-remote`, enable Dependabot.         |

### [4.1][OUTDATED_ACTION_VERSIONS]

| [INDEX] | [ACTION]                  | [OUTDATED] | [CURRENT] | [SHA]                                      |
| :-----: | ------------------------- | :--------: | :-------: | ------------------------------------------ |
|   [1]   | actions/checkout          |   v3, v4   |  v6.0.2   | `de0fac2e4500dabe0009e67214ff5f5447ce83dd` |
|   [2]   | actions/setup-node        |   v3, v4   |  v6.2.0   | `6044e13b5dc448c55e2357c09f80417699197238` |
|   [3]   | actions/cache             |   v3, v4   |  v5.0.3   | `cdf6c1fa76f9f475f3d7449005a359c84ca0f306` |
|   [4]   | actions/upload-artifact   |   v3, v4   |  v6.0.0   | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` |
|   [5]   | actions/download-artifact |   v3, v4   |  v7.0.0   | `37930b1c2abaa49bbe596cd826c3c89aef350131` |
|   [6]   | github/codeql-action      |   v2, v3   |  v4.32.2  | `45cbd0c69e560cd9e7cd7f8c32362050c9b7ded2` |

[REFERENCE] Full SHA map: [->_action-sha-map.md](../../../_action-sha-map.md).

---
## [5][JOB_CONFIGURATION]
>**Dictum:** *Runner labels and job dependencies must reference valid identifiers.*

<br>

| [INDEX] | [ERROR]                                               | [ACTIONLINT_RULE] | [FIX]                                                       |
| :-----: | ----------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
|   [1]   | **`label "ubuntu-lastest" is unknown`**               | `runner-label`    | Use valid labels. [REFERENCE] [->runners.md](./runners.md). |
|   [2]   | **`Job 'X' depends on job 'Y' which does not exist`** | `job-needs`       | Match exact job ID in `needs:`.                             |
|   [3]   | **`Circular dependency detected`**                    | `job-needs`       | Break circular `needs:` chain.                              |
|   [4]   | **Missing `timeout-minutes:`**                        | —                 | Default is 6 hours — add explicit timeout to every job.     |
|   [5]   | **`-arm64` suffix on runner label**                   | `runner-label`    | Use `-arm` suffix: `ubuntu-24.04-arm` not `-arm64`.         |

---
## [6][REUSABLE_WORKFLOW_ERRORS]
>**Dictum:** *Reusable workflow configuration has strict type and reference constraints.*

<br>

| [INDEX] | [ERROR]                                      | [ACTIONLINT_RULE] | [FIX]                                                             |
| :-----: | -------------------------------------------- | ----------------- | ----------------------------------------------------------------- |
|   [1]   | **Invalid `type:` in `workflow_call` input** | `workflow-call`   | Use `string`, `number`, or `boolean` only.                        |
|   [2]   | **Missing required input**                   | `workflow-call`   | Caller must supply all `required: true` inputs.                   |
|   [3]   | **Output reference mismatch**                | `workflow-call`   | Caller output path must match `jobs.<id>.outputs.<name>`.         |
|   [4]   | **`secrets: inherit` with explicit secrets** | `workflow-call`   | Cannot combine `secrets: inherit` with named secret declarations. |
|   [5]   | **Nesting exceeds 10 levels**                | —                 | Maximum 10 levels of workflow nesting (caller + 9 deep).          |

---
## [7][SCHEDULE_ERRORS]
>**Dictum:** *CRON expressions require valid field ranges and correct syntax.*

<br>

| [INDEX] | [ERROR]                       | [ACTIONLINT_RULE] | [FIX]                                                                            |
| :-----: | ----------------------------- | ----------------- | -------------------------------------------------------------------------------- |
|   [1]   | **`Invalid CRON expression`** | `events`          | Format: `minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sunday)`.  |
|   [2]   | **Too-frequent schedule**     | —                 | Minimum interval is every 5 minutes for public repos (rate limited by GitHub).   |
|   [3]   | **Timezone expectation**      | —                 | All `schedule` cron expressions evaluate in **UTC only** — no timezone override. |

```yaml
# Bad:  cron: '0 0 * * 8'    # Weekday 8 does not exist
# Bad:  cron: '* * * * *'    # Every minute — will be rate-limited
# Good: cron: '0 0 * * 0'    # Sunday at midnight UTC
# Good: cron: '30 6 * * 1-5' # Weekdays at 06:30 UTC
```

---
## [8][PATH_FILTER_ERRORS]
>**Dictum:** *Glob patterns require directory separators.*

<br>

| [INDEX] | [ERROR]                             | [ACTIONLINT_RULE] | [FIX]                             |
| :-----: | ----------------------------------- | ----------------- | --------------------------------- |
|   [1]   | **`Invalid glob pattern: '**.js'`** | `glob`            | Use `**/*.js` not `**.js`.        |
|   [2]   | **No `?` wildcard support**         | —                 | `hashFiles` does not support `?`. |

---
## [9][ENVIRONMENT_AND_SECRETS]
>**Dictum:** *Secret access requires exact name matching and platform-aware syntax.*

<br>

| [INDEX] | [ERROR]                          | [ACTIONLINT_RULE] | [FIX]                                                                         |
| :-----: | -------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
|   [1]   | **`Secret MY_SECRET not found`** | —                 | Verify name in repository settings (case-sensitive).                          |
|   [2]   | **Env var not accessible**       | —                 | Unix: `echo "$MY_VAR"`, Windows: `echo $env:MY_VAR`.                          |
|   [3]   | **Short secret not masked**      | —                 | Secrets shorter than 4 characters are NOT masked in logs.                     |
|   [4]   | **Secret in `run:` block**       | `expression`      | Pass via `env:` indirection — never interpolate `${{ secrets.* }}` in `run:`. |

---
## [10][PERMISSIONS_ERRORS]
>**Dictum:** *Permission blocks require valid scope names and follow least-privilege.*

<br>

| [INDEX] | [ERROR]                             | [ACTIONLINT_RULE] | [FIX]                                                                                                                                                                                                                          |
| :-----: | ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   [1]   | **Invalid permission scope**        | `permissions`     | Valid scopes: `actions`, `attestations`, `checks`, `contents`, `deployments`, `id-token`, `issues`, `models`, `packages`, `pages`, `pull-requests`, `repository-projects`, `security-events`, `statuses`, `artifact-metadata`. |
|   [2]   | **`write-all` / no `permissions:`** | —                 | Add top-level `permissions: {}` for least privilege default.                                                                                                                                                                   |
|   [3]   | **Missing `id-token: write`**       | —                 | Required for OIDC federation (AWS/GCP/Azure auth actions).                                                                                                                                                                     |
|   [4]   | **Missing `attestations: write`**   | —                 | Required for `actions/attest-build-provenance` / `attest-sbom`.                                                                                                                                                                |

---
## [11][DEBUGGING]
>**Dictum:** *Debug techniques expose runtime state for diagnosis.*

<br>

| [INDEX] | [METHOD]              | [HOW]                                                                |
| :-----: | --------------------- | -------------------------------------------------------------------- |
|   [1]   | **Debug logging**     | Set secrets: `ACTIONS_STEP_DEBUG=true`, `ACTIONS_RUNNER_DEBUG=true`. |
|   [2]   | **Interactive debug** | `uses: mxschmitt/action-tmate@v3` with `if: failure()`.              |
|   [3]   | **Dump context**      | `run: printf '%s\n' '${{ toJSON(github) }}'`.                        |
|   [4]   | **Re-run with debug** | GitHub UI "Re-run all jobs" > "Enable debug logging" checkbox.       |
