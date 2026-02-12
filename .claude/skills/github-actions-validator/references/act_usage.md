# Act and Actionlint Usage Reference

## Installation

```bash
bash scripts/install_tools.sh
```

## Actionlint (Static Analysis)

```bash
actionlint .github/workflows/ci.yml          # Single file
actionlint .github/workflows/*.yml            # All workflows
actionlint                                     # Default location
actionlint -format '{{json .}}'               # JSON output
actionlint -format sarif                       # SARIF (code scanning)
```

**Validates:** YAML syntax, schema, expressions, runner labels, action inputs/outputs, job dependencies, CRON syntax, glob patterns, shell scripts (shellcheck), security vulnerabilities.

**Exit codes:** 0 = success, 1 = errors found, 2 = fatal error.

### Actionlint Rule Names

Use these identifiers for targeted suppression in `.github/actionlint.yaml`.

| Rule | Checks |
|---|---|
| `syntax-check` | Workflow structure, YAML schema, missing keys |
| `expression` | `${{ }}` type checking, function calls, context access |
| `action` | Action inputs/outputs, required inputs, action.yml existence |
| `runner-label` | Valid runner labels (ubuntu-latest, etc.) |
| `glob` | Glob patterns in paths:/branches: filters |
| `job-needs` | Job dependency graph, undefined/circular `needs:` |
| `workflow-call` | Reusable workflow inputs/outputs/secrets |
| `events` | Workflow trigger event validation |
| `credentials` | Hard-coded credentials detection |
| `permissions` | GITHUB_TOKEN permission scopes |
| `deprecated-commands` | `set-output`, `save-state` usage |
| `env-var` | Environment variable naming/access |
| `id` | Job and step ID validation |
| `matrix` | Matrix strategy configuration |
| `shellcheck` | Shell script linting (requires shellcheck) |
| `pyflakes` | Python script linting (requires pyflakes) |

### Actionlint Configuration

```yaml
# .github/actionlint.yaml
shellcheck:
  enable: true
  shell: bash
pyflakes:
  enable: true
ignore:
  - 'SC2086'
self-hosted-runner:
  labels: [my-custom-runner, gpu-runner]
```

### CI Integration

```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2
- run: bash <(curl https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
- run: ./actionlint
```

## Act (Local Execution)

```bash
act -l                          # List workflows
act -l push                     # List workflows for event
act -n                          # Dry-run (validate without executing)
act push                        # Run push event workflows
act -j <job-id>                 # Run specific job
act -W .github/workflows/ci.yml # Run specific workflow
act -v                          # Verbose output
```

**Exit codes:** 0 = success, 1 = job failed, 2 = parse/execution error.

### Options

| Flag | Purpose |
|---|---|
| `--container-architecture linux/amd64` | Consistent platform (important on ARM Macs) |
| `-P ubuntu-latest=node:24-bookworm` | Custom Docker image (node24 runtime) |
| `-s GITHUB_TOKEN=ghp_xxx` | Pass secret |
| `--secret-file .secrets` | Secrets from file |
| `--env MY_VAR=value` | Environment variable |
| `--input myInput=value` | workflow_dispatch input |

### Configuration File

```bash
# .actrc (project root or HOME)
--container-architecture=linux/amd64
--action-offline-mode
```

## Limitations

| Limitation | Impact |
|---|---|
| Not 100% GitHub-compatible | Some features may behave differently |
| Docker required | Must be installed and running |
| Network actions | GitHub API actions may fail locally |
| Runner images | Default images differ from GitHub-hosted |
| Secrets | Must be provided manually for local testing |
| File location | act only validates `.github/workflows/` directory |

## Troubleshooting

| Issue | Solution |
|---|---|
| Cannot connect to Docker daemon | Start Docker Desktop or daemon |
| Workflow file not found | Run from repo root or use `-W` flag |
| Action not found | Use `-P` for alternative images or skip action |
| Out of disk space | `docker system prune -a` |
