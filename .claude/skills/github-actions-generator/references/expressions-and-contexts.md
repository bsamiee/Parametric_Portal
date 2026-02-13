# [H1][EXPRESSIONS-AND-CONTEXTS]
>**Dictum:** *Expression syntax resolves dynamic values before runner execution.*

<br>

---
## [1][SYNTAX]
>**Dictum:** *Expression delimiters and implicit evaluation rules govern value resolution.*

<br>

`${{ }}` for dynamic values. `if:` conditions are implicit (can omit `${{ }}`). Expressions resolve **before** runner execution — they are string interpolation, not runtime code.

---
## [2][CONTEXTS]
>**Dictum:** *Context objects expose workflow, runner, and event metadata.*

<br>

| [INDEX] | [CONTEXT]          | [KEY_PROPERTIES]                                                                            |
| :-----: | ------------------ | ------------------------------------------------------------------------------------------- |
|   [1]   | **`github`**       | `.event_name`, `.ref`, `.ref_name`, `.sha`, `.actor`, `.repository`, `.run_id`, `.workflow` |
|   [2]   | **`github.event`** | `.action`, `.pull_request.number/.head.ref/.base.ref/.head.sha`, `.head_commit.message`     |
|   [3]   | **`env`**          | `env.VAR_NAME` — workflow, job, step level; step-level overrides job-level.                 |
|   [4]   | **`runner`**       | `.os`, `.arch`, `.temp`, `.tool_cache`, `.environment`, `.debug`, `.name`.                  |
|   [5]   | **`secrets`**      | `secrets.NAME` — auto-masked in logs; `secrets.GITHUB_TOKEN` always available.              |
|   [6]   | **`vars`**         | `vars.NAME` — configuration variables (Settings > Variables); not masked.                   |
|   [7]   | **`matrix`**       | `matrix.KEY` — current matrix combination values.                                           |
|   [8]   | **`steps`**        | `steps.ID.outputs.NAME`, `steps.ID.outcome` (success/failure/cancelled/skipped).            |
|   [9]   | **`needs`**        | `needs.JOB.outputs.KEY`, `needs.JOB.result` (success/failure/cancelled/skipped).            |
|  [10]   | **`inputs`**       | `inputs.NAME` — `workflow_dispatch` / `workflow_call` typed inputs.                         |
|  [11]   | **`job`**          | `job.status`, `job.container.id`, `job.container.network`.                                  |
|  [12]   | **`strategy`**     | `strategy.fail-fast`, `strategy.job-index`, `strategy.job-total`, `strategy.max-parallel`.  |

**`runner` context expansions:**

| [INDEX] | [PROPERTY]               | [VALUE]                                                                    |
| :-----: | ------------------------ | -------------------------------------------------------------------------- |
|   [1]   | **`runner.os`**          | `Linux`, `Windows`, `macOS`.                                               |
|   [2]   | **`runner.arch`**        | `X64`, `ARM64`, `ARM`.                                                     |
|   [3]   | **`runner.environment`** | `github-hosted` or `self-hosted`.                                          |
|   [4]   | **`runner.debug`**       | `1` when debug logging enabled; unset otherwise. Use: `runner.debug == 1`. |
|   [5]   | **`runner.name`**        | Runner machine name.                                                       |
|   [6]   | **`runner.temp`**        | Temp directory path (cleaned after job).                                   |
|   [7]   | **`runner.tool_cache`**  | Tool cache directory path.                                                 |

---
## [3][FUNCTIONS]
>**Dictum:** *Built-in functions enable string matching, serialization, and status checks.*

<br>

| [INDEX] | [FUNCTION]             | [EXAMPLE]                                                            |
| :-----: | ---------------------- | -------------------------------------------------------------------- |
|   [1]   | **`contains(a, b)`**   | `contains(github.ref, 'refs/tags/')` — **case-insensitive**.         |
|   [2]   | **`startsWith(a, b)`** | `startsWith(github.ref, 'refs/tags/v')` — **case-insensitive**.      |
|   [3]   | **`endsWith(a, b)`**   | `endsWith(github.ref, '/main')` — **case-insensitive**.              |
|   [4]   | **`format(fmt, ...)`** | `format('https://img.shields.io/badge/{0}-{1}', 'build', 'passing')` |
|   [5]   | **`toJSON(val)`**      | `toJSON(github.event)` — debug context objects.                      |
|   [6]   | **`fromJSON(str)`**    | `fromJSON(needs.setup.outputs.matrix)` — dynamic matrix.             |
|   [7]   | **`hashFiles(pat..)`** | `hashFiles('**/pnpm-lock.yaml')` — returns `''` on no match.         |
|   [8]   | **`join(arr, sep)`**   | `join(needs.*.result, ',')`                                          |
|   [9]   | **`success()`**        | Default `if:` condition — all previous steps succeeded.              |
|  [10]   | **`failure()`**        | Any previous step failed.                                            |
|  [11]   | **`always()`**         | Run regardless of outcome.                                           |
|  [12]   | **`cancelled()`**      | Workflow was cancelled.                                              |

**Operators:** `()` > `!` > `<` `<=` `>` `>=` > `==` `!=` > `&&` > `||`

**`hashFiles` behavior:** Returns empty string `''` on no match (no error, no warning). Uses `@actions/glob` patterns. Multiple args = logical AND across patterns. Broken symlinks produce empty hash silently. Glob matching is case-insensitive on Windows, case-sensitive on Linux/macOS. `?` wildcard not supported — returns empty.

**`contains()` / `startsWith()` / `endsWith()`:** All three are **case-insensitive** for string comparisons. `contains('Hello', 'hello')` evaluates to `true`. When comparing against arrays, `contains()` checks for exact element match.

**Comparison semantics:** Falsy values: `false`, `0`, `-0`, `""`, `null`. GitHub ignores case for string `==`/`!=`. `NaN` relational comparisons always return `false`. Objects/arrays equal only when same instance.

---
## [4][PATTERNS]
>**Dictum:** *Common expression patterns cover conditionals, ternary, defaults, and cross-job aggregation.*

<br>

```yaml
# Branch/tag conditionals
if: github.ref == 'refs/heads/main'
if: startsWith(github.ref, 'refs/tags/v')

# Multi-condition with skip-ci
if: |
  github.event_name == 'push' &&
  github.ref == 'refs/heads/main' &&
  !contains(github.event.head_commit.message, '[skip ci]')

# Ternary — environment selection
environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}

# Default value
environment: ${{ inputs.environment || 'dev' }}

# Dynamic matrix from job output [->advanced-triggers.md§DYNAMIC_MATRIX]
strategy:
  matrix: ${{ fromJSON(needs.setup.outputs.matrix) }}

# Cache key composition
key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}-${{ github.ref_name }}

# Cross-job failure detection
if: always() && contains(join(needs.*.result, ','), 'failure')

# Status function combination — notify on failure but not cancellation
if: always() && needs.deploy.result == 'failure' && needs.deploy.result != 'cancelled'
```

---
## [5][CROSS_JOB_OUTPUTS]
>**Dictum:** *Job outputs enable data flow between dependent jobs.*

<br>

```yaml
jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.ver.outputs.version }}
      should-deploy: ${{ steps.check.outputs.deploy }}
    steps:
      - id: ver
        run: echo "version=$(jq -r .version package.json)" >> "$GITHUB_OUTPUT"
      - id: check
        run: echo "deploy=${{ github.ref == 'refs/heads/main' }}" >> "$GITHUB_OUTPUT"

  deploy:
    needs: setup
    if: needs.setup.outputs.should-deploy == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying ${{ needs.setup.outputs.version }}"
```

[IMPORTANT] All job outputs are strings. Boolean comparisons require string equality: `== 'true'`, not `== true`. Multi-line outputs require delimiter syntax.

---
## [6][INJECTION_PREVENTION]
>**Dictum:** *Environment variable indirection prevents injection attacks from untrusted input.*

<br>

[CRITICAL]:
- [NEVER] Interpolate `${{ github.event.* }}` directly in `run:` — attacker-controlled PR titles, branch names, and commit messages can inject shell commands.
- [ALWAYS] Route untrusted values through `env:` block, then reference as shell variable.

```yaml
# SAFE — env var indirection
- env:
    PR_TITLE: ${{ github.event.pull_request.title }}
    PR_BODY: ${{ github.event.pull_request.body }}
    COMMENT: ${{ github.event.comment.body }}
  run: |
    printf 'Title: %s\n' "$PR_TITLE"
    printf 'Body: %s\n' "$PR_BODY"
```

**Untrusted fields** (attacker-controlled in fork PRs):
- `github.event.pull_request.title`, `.body`, `.head.ref`
- `github.event.comment.body`
- `github.event.head_commit.message`, `.author.name`, `.author.email`
- `github.event.discussion.title`, `.body`

---
## [7][GITHUB_OUTPUT]
>**Dictum:** *Step outputs use file-based protocol for structured data exchange.*

<br>

```yaml
# Simple key-value
- run: echo "version=1.2.3" >> "$GITHUB_OUTPUT"

# Multi-line output (delimiter syntax)
- run: |
    {
      echo "changelog<<EOF"
      git log --oneline v1.1.0..HEAD
      echo "EOF"
    } >> "$GITHUB_OUTPUT"

# JSON output (for fromJSON consumption)
- run: echo "matrix=$(jq -c . matrix.json)" >> "$GITHUB_OUTPUT"
```

| [INDEX] | [FILE]                     | [PURPOSE]                                              | [SIZE_LIMIT]                    |
| :-----: | -------------------------- | ------------------------------------------------------ | ------------------------------- |
|   [1]   | **`$GITHUB_OUTPUT`**       | Step outputs — `steps.ID.outputs.KEY`.                 | 1 MiB/job, 50 MiB/workflow run. |
|   [2]   | **`$GITHUB_STATE`**        | Step state — persisted between pre/main/post.          | —                               |
|   [3]   | **`$GITHUB_ENV`**          | Environment variables — available to subsequent steps. | 48 KiB/variable.                |
|   [4]   | **`$GITHUB_PATH`**         | PATH additions — available to subsequent steps.        | —                               |
|   [5]   | **`$GITHUB_STEP_SUMMARY`** | Job summary — Markdown rendered on workflow run page.  | 1 MiB/step, 20 summaries/job.   |

---
## [8][JOB_SUMMARIES]
>**Dictum:** *Job summaries render Markdown on workflow run pages for human-readable reporting.*

<br>

```yaml
- run: |
    echo "## Test Results" >> "$GITHUB_STEP_SUMMARY"
    echo "| Suite | Passed | Failed |" >> "$GITHUB_STEP_SUMMARY"
    echo "|---|---|---|" >> "$GITHUB_STEP_SUMMARY"
    echo "| Unit | 142 | 0 |" >> "$GITHUB_STEP_SUMMARY"
```

- GitHub-flavored Markdown: tables, badges, expandable `<details>` sections.
- Max 1 MiB per step; exceeding truncates with error annotation. Max 20 step summaries displayed per job.
- Secrets auto-masked in summaries — same masking rules as log output.
- Supports badges via `![](url)`, collapsible regions via `<details><summary>`, and HTML tables.

---
## [9][SECRET_MASKING]
>**Dictum:** *Secrets are automatically masked in logs; custom masking extends protection.*

<br>

- Secrets referenced via `${{ secrets.NAME }}` are auto-masked in all log output.
- `::add-mask::VALUE` — dynamically mask any value in subsequent log lines.
- Structured values (JSON) are masked as whole strings — individual fields may leak if extracted.
- Short secrets (<4 chars) are NOT masked — use longer values.

```yaml
- run: echo "::add-mask::$DYNAMIC_TOKEN"
  env:
    DYNAMIC_TOKEN: ${{ steps.auth.outputs.token }}
```
