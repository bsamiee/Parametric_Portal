# Custom GitHub Actions Guide

**Last Updated:** February 2026

## Action Types

| Type | Runtime | Startup | Use Case |
|------|---------|---------|----------|
| Composite | Shell/Actions | Fast | Combine multiple steps, error propagation via `if: failure()` |
| Docker | Container | Slow | Custom environment/tools, language-agnostic |
| JavaScript | `node24` | Fastest | API interactions, complex logic, @actions/core toolkit |

### Decision Tree

| Question | Answer | Recommendation |
|----------|--------|---------------|
| Need shared steps only? | Yes | Composite action |
| Need custom runtime/tools? | Yes | Docker action |
| Need GitHub API / complex logic? | Yes | JavaScript action |
| Need full pipeline reuse? | Yes | Reusable workflow (`workflow_call`), not an action |
| Need SLSA L3 provenance? | Yes | Reusable workflow (provides `job_workflow_ref` claim) |

## Directory Structure

**Local actions** (same repo): `.github/actions/<name>/action.yml`

```yaml
- uses: ./.github/actions/setup-node-cached
```

**Standalone repos** (Marketplace): `action.yml` in repo root.

```yaml
- uses: owner/repo@v1
- uses: owner/repo@SHA  # most secure
```

## Metadata (action.yml)

```yaml
name: 'Action Name'
description: 'Brief description'
author: 'Author'
branding:
  icon: 'package'     # Feather icon name
  color: 'blue'       # white|yellow|blue|green|orange|red|purple|gray-dark

inputs:
  input-name:
    description: 'Description'
    required: true
    default: 'value'

outputs:
  output-name:
    description: 'Description'
    value: ${{ steps.step-id.outputs.value }}  # composite only

runs:
  using: 'composite'     # or 'docker' or 'node24'
  steps: [...]           # composite
  # image: 'Dockerfile'  # docker
  # main: 'dist/index.js'  # javascript
```

## Composite Error Propagation

```yaml
# Errors in composite steps propagate to the caller by default.
# Use continue-on-error + outcome checks for granular control:
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

## Versioning

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
# Update major version tag
git tag -fa v1 -m "Update v1 to v1.0.0"
git push origin v1 --force
```

Users reference: `@v1.0.0` (exact), `@v1` (latest v1.x), `@SHA` (most secure).

## Runtime Requirements (Feb 2026)

| Runtime | Status |
|---------|--------|
| `node24` | Required -- use `using: 'node24'` in JavaScript actions |
| `node20` | Deprecated -- forced migration to node24 on March 4, 2026 |
| `node16` | Removed -- actions fail |
| `docker` | Stable -- use `using: 'docker'` with `image: 'Dockerfile'` |
| `composite` | Stable -- use `using: 'composite'` with `steps:` |

## Marketplace Requirements

1. Public repository with `action.yml` in root
2. Branding metadata (icon + color)
3. README.md with usage examples
4. Semantic version tags
5. Node 24 runtime for JavaScript actions (node20 EOL April 2026)

See `assets/templates/action/` for composite, Docker, and JavaScript action templates.
