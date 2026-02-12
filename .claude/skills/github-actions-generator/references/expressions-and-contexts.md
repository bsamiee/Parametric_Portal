# GitHub Actions Expressions and Contexts

**Last Updated:** February 2026

## Syntax

`${{ }}` for dynamic values. `if:` conditions are implicit (can omit `${{ }}`). Expressions resolve **before** runner execution.

## Contexts

| Context | Key Properties |
|---------|---------------|
| `github` | `.event_name`, `.ref`, `.ref_name`, `.sha`, `.actor`, `.repository`, `.run_id`, `.workflow` |
| `github.event` | `.action`, `.pull_request.number/.head.ref/.base.ref`, `.head_commit.message` |
| `env` | `env.VAR_NAME` |
| `runner` | `.os` (Linux/Windows/macOS), `.arch` (X64/ARM64), `.temp` |
| `secrets` | `secrets.NAME` (auto-masked) |
| `matrix` | `matrix.KEY` |
| `steps` | `steps.ID.outputs.NAME`, `steps.ID.outcome` (success/failure/cancelled/skipped) |
| `needs` | `needs.JOB.outputs.KEY`, `needs.JOB.result` |
| `inputs` | `inputs.NAME` (workflow_dispatch / workflow_call) |
| `vars` | `vars.NAME` (configuration variables, Settings > Variables) |

## Functions

| Function | Example |
|----------|---------|
| `contains(a, b)` | `contains(github.ref, 'refs/tags/')` |
| `startsWith(a, b)` | `startsWith(github.ref, 'refs/tags/v')` |
| `endsWith(a, b)` | `endsWith(github.ref, '/main')` |
| `format(fmt, ...)` | `format('Building {0} on {1}', github.ref_name, runner.os)` |
| `toJSON(val)` | `toJSON(github)` |
| `fromJSON(str)` | `fromJSON(needs.setup.outputs.matrix)` |
| `hashFiles(pat...)` | `hashFiles('**/package-lock.json')` |
| `success()` / `failure()` / `always()` / `cancelled()` | Step/job status checks |

## Operators (by precedence)

`()` > `!` > `<` `<=` `>` `>=` > `==` `!=` > `&&` > `||`

## Common Patterns

```yaml
if: github.ref == 'refs/heads/main'
if: startsWith(github.ref, 'refs/tags/v')
if: |
  github.event_name == 'push' &&
  github.ref == 'refs/heads/main' &&
  !contains(github.event.head_commit.message, '[skip ci]')

# Ternary
environment: ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}

# Default
environment: ${{ inputs.environment || 'dev' }}

# Dynamic matrix
strategy:
  matrix: ${{ fromJSON(needs.setup.outputs.matrix) }}

# Cache key
key: ${{ runner.os }}-${{ hashFiles('**/*.lock') }}-${{ github.ref_name }}
```

## Safe Interpolation

```yaml
# UNSAFE: - run: printf '%s\n' "${{ github.event.pull_request.title }}"
# SAFE:
- env: { PR_TITLE: '${{ github.event.pull_request.title }}' }
  run: printf '%s\n' "$PR_TITLE"
```
