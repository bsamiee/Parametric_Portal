# [H1][EXAMPLES]
>**Dictum:** *Example workflows demonstrate validation pipeline usage.*

<br>

| [INDEX] | [FILE]                  | [PURPOSE]                                              | [COMMAND]                                                          |
| :-----: | ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
|   [1]   | `valid-ci.yml`          | Passes all checks with zero warnings                   | `bash scripts/validate_workflow.sh examples/valid-ci.yml`          |
|   [2]   | `with-errors.yml`       | Triggers every best_practice_checks.sh check (11 hits) | `bash scripts/validate_workflow.sh examples/with-errors.yml`       |
|   [3]   | `outdated-versions.yml` | Stale action tags, deprecated commands, legacy Node    | `bash scripts/validate_workflow.sh examples/outdated-versions.yml` |

**valid-ci.yml** -- Canonical passing workflow: `permissions: {}` deny-all, per-job minimal grants, harden-runner first step in every job, `timeout-minutes` on every job, concurrency group with `cancel-in-progress`, all actions SHA-pinned with `# vX.Y.Z` comments, matrix strategy, artifact upload, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY`.

**with-errors.yml** -- Every check in `best_practice_checks.sh` fires at least once: `[PERMISSIONS]`, `[UNPINNED]`, `[SHA-NO-COMMENT]`, `[TIMEOUT]`, `[RUNNER]`, `[CONCURRENCY]`, `[DEPRECATED-CMD]`, `[HARDEN]`, `[INJECTION]`, `[APP-TOKEN]`, `[IMMUTABLE]`. Each violation is annotated with `[VIOLATION]` comments.

**outdated-versions.yml** -- Demonstrates mutable tags for actions that have newer majors available, deprecated `::set-output`/`::save-state` commands, and EOL Node 16 usage. Each pattern is annotated with `[OUTDATED]` comments.
