---
name: github-actions-validator
description: Validates GitHub Actions workflow files (.github/workflows/*.yml) using actionlint (static analysis), act (local execution), and custom best-practice checks. Detects deprecated commands, missing permissions, unpinned actions, missing timeouts, deprecated runners, and missing concurrency groups.
---

# GitHub Actions Validator

## When to Use

- Validating `.github/workflows/*.yml` for syntax errors and best practices
- Testing workflows locally with `act` before pushing
- Checking action versions for deprecation or outdated tags
- Pre-commit validation of workflow files

## Setup

```bash
bash .claude/skills/github-actions-validator/scripts/install_tools.sh
```

## Validation Workflow (MUST FOLLOW)

1. **Run validation** on target file or directory:
   ```bash
   bash .claude/skills/github-actions-validator/scripts/validate_workflow.sh <path>
   ```
   Flags: `--lint-only`, `--test-only`, `--check-versions`, `--check-best-practices`

2. **For EACH error** -- consult the matching reference file, find the error pattern, extract the fix

3. **Quote the fix** -- error message, cause from reference, fix code applied to user's workflow

4. **Verify public actions** -- check `references/action_versions.md` first, web search for unknown actions

5. **Provide summary** -- list all fixes, warnings, and best practice recommendations

## Best Practice Checks (--check-best-practices)

| Check | Tag | What It Detects |
|---|---|---|
| Deprecated commands | `[DEPRECATED-CMD]` | `::set-output`, `::save-state` usage |
| Missing permissions | `[PERMISSIONS]` | No top-level `permissions:` block |
| Unpinned actions | `[UNPINNED]` | Actions using tag instead of SHA |
| Missing timeout | `[TIMEOUT]` | Jobs without `timeout-minutes` |
| Deprecated runners | `[RUNNER]` | `ubuntu-20.04`, `macos-13`, `windows-2019` |
| Missing concurrency | `[CONCURRENCY]` | No `concurrency:` group |
| Cache v4->v5 | `[CACHE-V5]` | `actions/cache@v4` (v5 available) |
| PAT usage | `[APP-TOKEN]` | PATs for cross-repo ops (use `create-github-app-token` instead) |
| No harden-runner | `[HARDEN]` | Missing `step-security/harden-runner` in security-sensitive jobs |
| Immutable actions | `[IMMUTABLE]` | Consider OCI-published immutable actions via GHCR |

## Actionlint Rule Names (for targeted suppression)

| Rule | Checks |
|---|---|
| `syntax-check` | Workflow structure, YAML schema |
| `expression` | `${{ }}` type checking |
| `action` | Action inputs/outputs validation |
| `runner-label` | Valid runner labels |
| `glob` | Glob patterns in filters |
| `job-needs` | Job dependency graph |
| `workflow-call` | Reusable workflow validation |
| `events` | Trigger event validation |
| `credentials` | Hard-coded credentials |
| `permissions` | GITHUB_TOKEN scopes |
| `deprecated-commands` | `set-output`/`save-state` |
| `env-var` | Environment variables |
| `id` | Job/step ID validation |
| `matrix` | Matrix strategy |
| `shellcheck` | Shell script linting |
| `pyflakes` | Python script linting |

## Error-to-Reference Mapping

| Error Pattern | Reference File |
|---|---|
| `runs-on`, runner labels | `runners.md` |
| `cron`, `schedule` | `common_errors.md` - Schedule Errors |
| `${{`, `expression`, `if:` | `common_errors.md` - Expression Errors |
| `needs:`, job dependency | `common_errors.md` - Job Configuration |
| `uses:`, action, input | `common_errors.md` - Action Errors |
| `set-output`, `save-state` | `common_errors.md` - Deprecated Commands |
| `untrusted`, injection | `common_errors.md` - Expression Errors |
| `syntax`, `yaml` | `common_errors.md` - Syntax Errors |
| `docker`, `container` | `act_usage.md` - Troubleshooting |
| `@v3`, deprecated, outdated | `action_versions.md` |
| `workflow_call`, reusable, OIDC | `modern_features.md` |
| SLSA, attestation, cosign, SBOM | `modern_features.md` - Supply Chain Security |
| YAML anchors, `&name`, `*name` | `modern_features.md` - YAML Anchors |
| node20 deprecated, node24 required | `modern_features.md` - Node.js Runtime Migration |
| OIDC federation, keyless, cloud auth | `modern_features.md` - OIDC Authentication |
| deployment protection, environment gates | `modern_features.md` - Deployment Environments |
| immutable action, OCI, GHCR action | `modern_features.md` - Immutable Actions |
| app token, cross-repo, PAT replacement | `modern_features.md` - GitHub App Token Authentication |
| harden-runner, egress, supply chain monitoring | `modern_features.md` - Step Security Harden-Runner |
| `permissions`, `timeout` | `common_errors.md` - Best Practices |

## Reference Files

| File | Content |
|---|---|
| `references/act_usage.md` | Act + actionlint usage, rule names, limitations |
| `references/common_errors.md` | Error catalog with fixes, deprecated commands |
| `references/action_versions.md` | Current versions, deprecation, SHA pinning |
| `references/modern_features.md` | Reusable workflows, SBOM, OIDC, concurrency |
| `references/runners.md` | GitHub-hosted runners, deprecations, ARM64 |

## Troubleshooting

| Issue | Solution |
|---|---|
| Tools not found | `bash scripts/install_tools.sh` |
| Docker not running | Start Docker or use `--lint-only` |
| Permission denied | `chmod +x scripts/*.sh` |
| act fails, GitHub works | See `act_usage.md` Limitations |
