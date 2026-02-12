# GitHub Actions Best Practices

**Last Updated:** February 2026

## Security Checklist

- [ ] **Pin to SHA**: `uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`
- [ ] **Minimal permissions**: Top-level `permissions: contents: read`, job-level grants
- [ ] **Secrets via env**: Pass through `env:`, never in `run:` interpolation
- [ ] **Mask secrets**: `printf '::add-mask::%s\n' "$VALUE"` for dynamic sensitive values
- [ ] **No mutable refs**: Never `@main`, `@master`, `@latest` -- use SHA or major tag
- [ ] **Dependency review**: `actions/dependency-review-action@3c4e3dcb1aa7874d2c16be7d79418e9b7efd6261 # v4.8.2` on PRs
- [ ] **Sparse checkout**: Use `sparse-checkout:` to fetch only needed paths
- [ ] **Supply chain**: Cosign signing + `actions/attest-build-provenance@62fc1d596301d0ab9914e1fec14dc5c8d93f65cd # v3.2.0`
- [ ] **Immutable actions**: Publish via `actions/publish-immutable-action` to GHCR as OCI; or consume immutable refs via `ghcr.io/`
- [ ] **App tokens over PATs**: `actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v2.0.6` for cross-repo ops
- [ ] **Harden-Runner**: `step-security/harden-runner@002fdce3c6a235733a90a27c80493a3241e56863 # v2.12.0` as first step in sensitive jobs

### Safe Interpolation

```yaml
# SAFE -- env var
- env: { TITLE: '${{ github.event.pull_request.title }}' }
  run: [[ "$TITLE" =~ ^octocat ]] && printf '%s\n' "Match"

# UNSAFE -- direct interpolation in run:
- run: printf '%s\n' "${{ github.event.pull_request.title }}"
```

### PR Security Model

| Trigger | Secrets | Code Context | Risk |
|---------|---------|-------------|------|
| `pull_request` | No | PR branch | Safe |
| `pull_request_target` | Yes | Target branch | High -- never checkout PR code |
| `workflow_run` (after PR CI) | Yes | Target branch | Safe if correct |

## Performance Checklist

- [ ] **Caching**: `actions/cache@v5` (new backend, node24) or setup action's built-in cache (`cache: 'pnpm'`)
- [ ] **Concurrency**: Cancel outdated runs with `cancel-in-progress: true`; queue deploys with `cancel-in-progress: false`
- [ ] **Path filtering**: `paths:` to skip irrelevant workflows
- [ ] **Timeouts**: Job-level `timeout-minutes:` on every job
- [ ] **Matrix**: `fail-fast: false`, `max-parallel:`, `exclude:` expensive combos
- [ ] **Job summaries**: Write Markdown to `$GITHUB_STEP_SUMMARY` for rich build reports

### pnpm + Nx Caching

Three independent cache layers for pnpm/Nx monorepos:

| Layer | Path | Cache Key | Purpose |
|-------|------|-----------|---------|
| pnpm store | `$(pnpm store path)` | `${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}` | Package download cache |
| node_modules | `node_modules` / `.pnpm` | Same as pnpm store (or use `pnpm install --frozen-lockfile` each time) | Installed dependencies |
| Nx computation | `.nx/cache` | `${{ runner.os }}-nx-${{ hashFiles('pnpm-lock.yaml') }}` | Lint/test/build task outputs |

```yaml
# Combined pnpm store + Nx cache (v5 backend)
- uses: actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306 # v5.0.3
  with:
      path: |
          ~/.local/share/pnpm/store
          .nx/cache
      key: ${{ runner.os }}-pnpm-nx-${{ hashFiles('pnpm-lock.yaml') }}
      restore-keys: ${{ runner.os }}-pnpm-nx-
```

Alternatively, split into separate cache steps for independent invalidation:

```yaml
# pnpm store only
- uses: actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306 # v5.0.3
  with:
      path: ~/.local/share/pnpm/store
      key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
      restore-keys: ${{ runner.os }}-pnpm-

# Nx computation cache only
- uses: actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306 # v5.0.3
  with:
      path: .nx/cache
      key: ${{ runner.os }}-nx-${{ github.sha }}
      restore-keys: ${{ runner.os }}-nx-
```

### Concurrency

```yaml
# CI: cancel outdated runs
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

# Deployment: queue runs, never cancel in-progress
concurrency:
  group: deploy-${{ inputs.environment || 'production' }}
  cancel-in-progress: false
```

## Workflow Design

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps: [...]
  test:
    runs-on: ubuntu-latest
    steps: [...]
  build:
    needs: [lint, test]
    steps: [...]
  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    steps: [...]
```

### Status Functions

| Function | When |
|----------|------|
| `success()` | All previous steps succeeded (default) |
| `failure()` | Any previous step failed |
| `always()` | Run regardless |
| `cancelled()` | Workflow cancelled |

### Reusable Workflows

```yaml
# Caller
jobs:
  call-build:
    uses: ./.github/workflows/reusable-build.yml
    with: { environment: production }
    secrets: inherit  # pass all secrets (or explicit: token: '${{ secrets.DEPLOY_TOKEN }}')

# Callee (workflow_call)
on:
  workflow_call:
    inputs:
      environment: { required: true, type: string }
    secrets:
      token: { required: false }  # required: false when using secrets: inherit
    outputs:
      build-id: { value: '${{ jobs.build.outputs.id }}' }
```

## Error Handling

```yaml
jobs:
  build:
    timeout-minutes: 30
    steps:
      - id: tests
        continue-on-error: true
        run: npm test
      - if: always()
        uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6.0.0
        with: { name: results, path: test-results/ }
      - if: steps.tests.outcome == 'failure'
        run: exit 1
```

## Job Summaries

```yaml
- run: |
    printf '%s\n' "## Build Results" >> "$GITHUB_STEP_SUMMARY"
    printf '%s\n' "| Metric | Value |" >> "$GITHUB_STEP_SUMMARY"
    printf '%s\n' "|--------|-------|" >> "$GITHUB_STEP_SUMMARY"
    printf '%s\n' "| Duration | ${SECONDS}s |" >> "$GITHUB_STEP_SUMMARY"
    printf '%s\n' "| Commit | \`${{ github.sha }}\` |" >> "$GITHUB_STEP_SUMMARY"
```

## Environments

```yaml
environment:
  name: ${{ github.ref_name == 'main' && 'production' || 'staging' }}
  url: ${{ github.ref_name == 'main' && 'https://example.com' || 'https://staging.example.com' }}
```

Protection rules (Settings > Environments): required reviewers, wait timer, deployment branches, environment secrets.

## Container Jobs

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container: { image: 'node:24-alpine', options: '--cpus 2 --memory 4g' }
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres }
        options: --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
      redis:
        image: redis:7
        options: --health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - env: { DATABASE_URL: 'postgres://postgres:postgres@postgres:5432/test', REDIS_URL: 'redis://redis:6379' }
        run: npm test
```

## Annotations and Summaries

| Command | Purpose |
|---------|---------|
| `::notice::` | Info (blue) |
| `::warning::` | Warning (yellow) |
| `::error file=f,line=n::` | Error (red) with location |
| `::group::`/`::endgroup::` | Collapsible log section |
| `::add-mask::` | Mask value in logs |
| `>> $GITHUB_STEP_SUMMARY` | Markdown in Actions UI |
| `>> $GITHUB_OUTPUT` | Set step outputs (`name=value`) |
| `>> $GITHUB_ENV` | Set env vars for subsequent steps (`name=value`) |

## Naming Conventions

| Resource | Convention | Example |
|----------|-----------|---------|
| Workflow file | lowercase-hyphen | `ci-pipeline.yml` |
| Job ID | lowercase-hyphen | `test-node` |
| Step name | Action-oriented | `Install dependencies` |

## YAML Anchors

Reduce duplication within a single workflow file. Define anchors with `&name`, reference with `*name`.

```yaml
# Define reusable step sequences
x-checkout-and-setup: &checkout-and-setup
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
  - uses: actions/setup-node@6044e13b5dc448c55e2357c09f80417699197238 # v6.2.0
    with: { node-version: '24', cache: 'pnpm' }
  - run: corepack enable && pnpm install --frozen-lockfile

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - *checkout-and-setup
      - run: pnpm lint
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - *checkout-and-setup
      - run: pnpm test
```

Anchors are file-scoped. For cross-file reuse, use reusable workflows or composite actions.

### ARM64 Runners in Matrix

```yaml
# Multi-architecture CI (ARM64 free for public repos)
strategy:
  matrix:
    include:
      - runner: ubuntu-latest
        arch: x64
      - runner: ubuntu-latest-arm64
        arch: arm64
runs-on: ${{ matrix.runner }}
```

## Reuse Strategy Decision Tree

| Need | Solution | When |
|------|----------|------|
| Share steps within one file | YAML anchors (`&name` / `*name`) | Same steps repeated across jobs in one workflow |
| Share steps across repos | Composite action (`.github/actions/` or standalone repo) | Reusable step template (setup, lint, deploy) |
| Share entire pipelines | Reusable workflow (`workflow_call`) | Full CI/CD pipeline template consumed by multiple repos |
| Orchestrate workflows | `workflow_run` trigger | Chain workflows after completion (e.g., deploy after CI) |

**Composite vs Reusable Workflow:**

| Dimension | Composite Action | Reusable Workflow |
|-----------|-----------------|-------------------|
| Scope | Steps within a job | Entire job(s) |
| Secrets | Inherited from caller job | Explicit `secrets:` or `secrets: inherit` |
| Runners | Caller's runner | Own `runs-on:` per job |
| Nesting | Unlimited | 4 levels max, 20 unique per run |
| Marketplace | Publishable | Not publishable |
| SLSA | No `job_workflow_ref` claim | Yes -- enables SLSA Build Level 3 |

## Supply Chain Security Hardening

| Control | Implementation |
|---------|---------------|
| SHA pinning | `@<40-char-sha> # vX.Y.Z` on every `uses:` |
| Immutable actions | Publish via `actions/publish-immutable-action` to GHCR as OCI; consume via `ghcr.io/owner/action@1.0.0` |
| Dependabot | `.github/dependabot.yml` with `package-ecosystem: "github-actions"` |
| Least privilege | Top-level `permissions: contents: read`, job-level grants |
| OIDC over secrets | `id-token: write` + cloud provider federation |
| App token over PAT | `actions/create-github-app-token` for cross-repo ops (scoped, short-lived, auditable) |
| Build attestation | `actions/attest-build-provenance` for SLSA L2 provenance |
| SBOM generation | `anchore/sbom-action` + `actions/attest-sbom` |
| Image signing | `sigstore/cosign-installer` keyless signing via OIDC |
| Dependency review | `actions/dependency-review-action` on PRs |
| Harden-Runner | `step-security/harden-runner@v2.12.0` as first step -- monitors egress, detects anomalous network/process activity |

## Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| `permissions: write-all` | Explicit minimal permissions |
| `@main` / `@latest` | Pin to SHA with version comment |
| No timeout on jobs | `timeout-minutes:` on every job |
| `actions/setup-node@v4` | Use latest major (v6) |
| `actions/cache@v3`/`v4` | v5 required (new backend, Dec 2025) |
| `npm ci` in pnpm workspace | `corepack enable` + `pnpm install --frozen-lockfile` |
| No Nx cache in CI | Cache `.nx/cache` directory between runs |
| `set-output` command | Use `>> $GITHUB_OUTPUT` (deprecated since Oct 2022) |
| `save-state` command | Use `>> $GITHUB_STATE` |
| Long-lived cloud credentials | Use OIDC federation (`id-token: write`) |
| PATs for cross-repo access | `actions/create-github-app-token` (scoped, short-lived, auditable) |
| Mutable action tags only | SHA pin + Dependabot for automated updates; or use immutable OCI actions via GHCR |
| No SBOM for container images | `anchore/sbom-action` + `actions/attest-sbom` |
| No egress monitoring | `step-security/harden-runner` as first step in security-sensitive jobs |
| Intel-only CI | Add `ubuntu-latest-arm64` to matrix for ARM64 coverage (free for public repos) |
