# [H1][CUSTOM-ACTIONS]
>**Dictum:** *Action type selection determines runtime, startup cost, and capability scope.*

<br>

---
## [1][ACTION_TYPES]
>**Dictum:** *Three action types serve distinct runtime and capability requirements.*

<br>

| [INDEX] | [TYPE]         | [RUNTIME]     | [STARTUP] | [PRE/POST] | [USE_CASE]                                            |
| :-----: | -------------- | ------------- | :-------: | :--------: | ----------------------------------------------------- |
|   [1]   | **Composite**  | Shell/Actions |   Fast    |     No     | Combine steps; error propagation via `if: failure()`. |
|   [2]   | **Docker**     | Container     |   Slow    | Dockerfile | Custom environment/tools; language-agnostic.          |
|   [3]   | **JavaScript** | `node24`      |  Fastest  |    Yes     | API interactions; `@actions/core` toolkit.            |

<br>

### [1.1][DECISION_TREE]

| [INDEX] | [QUESTION]                      | [ANSWER] | [RECOMMENDATION]                              |
| :-----: | ------------------------------- | :------: | --------------------------------------------- |
|   [1]   | **Shared steps only?**          |   Yes    | Composite action.                             |
|   [2]   | **Custom runtime/tools?**       |   Yes    | Docker action.                                |
|   [3]   | **GitHub API / complex logic?** |   Yes    | JavaScript action.                            |
|   [4]   | **Full pipeline reuse?**        |   Yes    | Reusable workflow (`workflow_call`).          |
|   [5]   | **SLSA L3 provenance?**         |   Yes    | Reusable workflow (`job_workflow_ref` claim). |

---
## [2][DIRECTORY_STRUCTURE]
>**Dictum:** *Location determines consumption syntax.*

<br>

**Local actions** (monorepo pattern): `.github/actions/<name>/action.yml`

```yaml
- uses: ./.github/actions/setup-node-cached
```

**Standalone repos** (Marketplace): `action.yml` in repo root.

```yaml
- uses: owner/repo@<SHA> # vN.N.N
```

[IMPORTANT] Monorepo pattern `.github/actions/` keeps actions co-located with consuming workflows. Each action is self-contained with own `action.yml`.

---
## [3][METADATA]
>**Dictum:** *action.yml metadata defines inputs, outputs, and runtime configuration.*

<br>

```yaml
name: 'Action Name'
description: 'Brief description'
author: 'Author'
branding: { icon: 'package', color: 'blue' }  # Feather icon set

inputs:
  input-name: { description: 'Description', required: true, default: 'value' }

outputs:
  output-name:
    description: 'Description'
    value: ${{ steps.step-id.outputs.value }}  # composite only

runs:
  using: 'composite'     # or 'docker' or 'node24'
  steps: [...]           # composite
  # image: 'Dockerfile'  # docker
  # main: 'dist/index.js'  # javascript (pre: 'pre.js', post: 'post.js')
```

**Output limits:** 1 MiB per job (all outputs combined), 50 MiB per workflow run. Use artifacts for larger data.

[IMPORTANT] Composite inputs are always strings (no `type:` key). JavaScript actions support `pre:` and `post:` lifecycle steps for setup/cleanup.

---
## [4][ERROR_PROPAGATION]
>**Dictum:** *Composite actions propagate errors by default; granular control requires explicit outcome checks.*

<br>

```yaml
runs:
  using: 'composite'
  steps:
    - id: main
      shell: bash
      continue-on-error: true
      run: [MAIN_CMD]
    - if: always()
      shell: bash
      run: printf '%s\n' "Cleanup"  # runs even if main failed
    - if: steps.main.outcome == 'failure'
      shell: bash
      run: exit 1  # propagate failure after cleanup
```

[CRITICAL] Composite actions require `shell:` on every `run:` step. `continue-on-error` behavior with input variables is unpredictable — test thoroughly.

---
## [5][VERSIONING]
>**Dictum:** *Semantic version tags enable consumer stability guarantees.*

<br>

```bash
git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0
git tag -fa v1 -m "Update v1 to v1.0.0" && git push origin v1 --force
```

Consumers reference: `@v1.0.0` (exact), `@v1` (latest v1.x), `@SHA` (most secure). [REFERENCE] SHA pinning protocol: [->version-discovery.md§SHA_PINNING_FORMAT](./version-discovery.md).

---
## [6][RUNTIME]
>**Dictum:** *Runtime selection accounts for deprecation timeline and capability needs.*

<br>

| [INDEX] | [RUNTIME]       | [STATUS]                                                  |
| :-----: | --------------- | --------------------------------------------------------- |
|   [1]   | **`node24`**    | Required — use `using: 'node24'` for JavaScript actions.  |
|   [2]   | **`docker`**    | Stable — `using: 'docker'` with `image: 'Dockerfile'`.    |
|   [3]   | **`composite`** | Stable — `using: 'composite'` with `steps:`.              |

**Toolkit:** `@actions/core@3.x`, `@actions/github@9.x`. Bundle with `@vercel/ncc@0.38.x build index.js --minify`.

---
## [7][JAVASCRIPT_ACTIONS]
>**Dictum:** *JavaScript actions provide the richest runtime with pre/post lifecycle and ncc bundling.*

<br>

**Lifecycle:** `pre:` runs before job steps (setup). `main:` runs as the action step. `post:` runs after job completes (cleanup, even on failure).

```yaml
runs:
  using: 'node24'
  pre: 'dist/pre.js'
  pre-if: runner.os == 'linux'    # default: always() — runs pre unconditionally
  main: 'dist/index.js'
  post: 'dist/post.js'
  post-if: always()               # default: always() — runs post even on failure
```

**`pre-if` / `post-if`:** Status check functions evaluate against **job** status, not action status. `step` context is unavailable in `pre-if` (no steps have run yet). Both default to `always()`.

**I/O patterns:**

```javascript
const core = require('@actions/core');
core.setOutput('result', JSON.stringify({ status: 'ok', version: '1.0.0' }));
core.setSecret(token);  // masks in all subsequent logs
```

---
## [8][DOCKER_ACTIONS]
>**Dictum:** *Docker actions provide isolated environments with custom toolchains.*

<br>

```dockerfile
FROM golang:1.23 AS builder
COPY . .
RUN CGO_ENABLED=0 go build -o /action ./...

FROM gcr.io/distroless/static:nonroot
COPY --from=builder /action /action
ENTRYPOINT ["/action"]
```

```yaml
runs:
  using: 'docker'
  image: 'Dockerfile'
  env:
    INPUT_NAME: ${{ inputs.input-name }}  # inputs available as INPUT_* env vars
  args: ['--flag', '${{ inputs.param }}']  # passed to ENTRYPOINT, overrides CMD
  entrypoint: '/custom.sh'                # overrides Dockerfile ENTRYPOINT
```

**Consumer override:** `entrypoint:` in action.yml overrides Dockerfile `ENTRYPOINT`. `args:` overrides Dockerfile `CMD`. Consumer workflows cannot override action's entrypoint — it is set by the action author.

[IMPORTANT] Docker actions only run on Linux runners. Container startup adds 5-30s overhead. Prefer distroless/scratch base images.

---
## [9][LOCAL_ACTION_CACHING]
>**Dictum:** *Split cache pattern enables granular restore/save control in composite actions.*

<br>

```yaml
# Composite action — split cache for deterministic control
steps:
  - uses: actions/cache/restore@<SHA> # v5
    id: cache
    with:
      path: ~/.local/share/tool
      key: ${{ runner.os }}-tool-${{ hashFiles('**/lockfile') }}
      restore-keys: ${{ runner.os }}-tool-
  - if: steps.cache.outputs.cache-hit != 'true'
    shell: bash
    run: install-tool.sh
  - uses: actions/cache/save@<SHA> # v5
    if: steps.cache.outputs.cache-hit != 'true'
    with:
      path: ~/.local/share/tool
      key: ${{ steps.cache.outputs.cache-primary-key }}
```

[IMPORTANT] Prefix cache keys with action name to avoid collision across actions: `my-action-${{ runner.os }}-...`. Split pattern prevents save on cache hit (avoids redundant uploads).

---
## [10][TESTING]
>**Dictum:** *Action testing validates inputs, outputs, and error paths before publication.*

<br>

| [INDEX] | [STRATEGY]               | [TOOL]                     | [SCOPE]                                    |
| :-----: | ------------------------ | -------------------------- | ------------------------------------------ |
|   [1]   | **Unit test composites** | Workflow with known inputs | Test each step outcome in isolation.       |
|   [2]   | **Integration test**     | `nektos/act`               | Run full action locally against Docker.    |
|   [3]   | **CI validation**        | Dedicated test workflow    | `.github/workflows/test-action.yml` on PR. |
|   [4]   | **Output validation**    | `actions/github-script`    | Assert outputs match expected values.      |

---
## [11][MARKETPLACE]
>**Dictum:** *Marketplace publication requires specific metadata and runtime compliance.*

<br>

1. Public repository with `action.yml` in root.
2. Branding metadata (icon + color) — Feather icon set.
3. README.md with usage examples.
4. Semantic version tags (`v1`, `v1.0.0`).
5. Node 24 runtime for JavaScript actions (node20 forced migration March 4, 2026).
