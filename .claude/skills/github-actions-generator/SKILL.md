---
name: github-actions-generator
description: Generate best-practice GitHub Actions workflows, custom actions, and configurations. Use when creating CI/CD workflows, reusable actions, or security scanning pipelines.
---

# GitHub Actions Generator

Generate production-ready GitHub Actions workflows and custom actions. Validate all output with `github-actions-validator`.

## Quick Reference

| Capability | Reference |
|------------|-----------|
| Workflows (CI/CD, automation) | `references/best-practices.md` |
| Action versions and SHAs | `references/common-actions.md` |
| Expressions, contexts, functions | `references/expressions-and-contexts.md` |
| Advanced triggers (workflow_run, dispatch, ChatOps) | `references/advanced-triggers.md` |
| Custom actions (composite, Docker, JS) | `references/custom-actions.md` |

## Process

1. Understand requirements (triggers, runners, dependencies)
2. Reference `best-practices.md` for patterns, `common-actions.md` for versions
3. Generate with: SHA-pinned actions, minimal permissions, concurrency, caching, timeouts
4. **Validate** with `github-actions-validator`
5. Fix and re-validate if needed

## Mandatory Standards

| Standard | Implementation |
|----------|---------------|
| Security | Pin to SHA, minimal permissions, mask secrets, `step-security/harden-runner` |
| Supply Chain | `actions/attest-build-provenance`, immutable OCI actions via GHCR, Cosign keyless signing |
| Auth | `actions/create-github-app-token` for cross-repo (never PATs), OIDC for cloud federation |
| Performance | `actions/cache@v5`, concurrency, shallow checkout, ARM64 runners |
| Outputs | `>> $GITHUB_OUTPUT`, `>> $GITHUB_STEP_SUMMARY` |
| Error Handling | Timeouts, cleanup with `if: always()` |
| Naming | Descriptive names, lowercase-hyphen files |

## Templates

| Template | Location |
|----------|----------|
| Basic Workflow | `assets/templates/workflow/basic_workflow.yml` |
| Reusable Workflow | `assets/templates/workflow/reusable_workflow.yml` |
| Composite Action | `assets/templates/action/composite/action.yml` |
| Docker Action | `assets/templates/action/docker/action.yml` |
| JavaScript Action | `assets/templates/action/javascript/action.yml` |

## Examples

| Example | Demonstrates |
|---------|-------------|
| `examples/workflows/nodejs-ci.yml` | Matrix testing, caching, artifact upload, coverage, job summaries |
| `examples/workflows/docker-build-push.yml` | Multi-platform builds, GHCR, BuildKit caching, attestation |
| `examples/workflows/monorepo-ci.yml` | Nx affected detection, pnpm workspace, cache v5 |
| `examples/security/dependency-review.yml` | Dependency scanning, license compliance |
| `examples/security/sbom-attestation.yml` | SBOM generation, attestation, Trivy scanning, SARIF upload |
| `examples/actions/setup-node-cached/action.yml` | Composite action with smart caching |

## Public Action Documentation

1. Search: `"[owner/repo] [version] github action documentation"`
2. Or use Context7 MCP: `resolve-library-id` then `get-library-docs`
3. Pin to SHA: `uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`
4. Verify SHA: `git ls-remote --tags https://github.com/[owner]/[repo] | grep 'refs/tags/[tag]'`

See `references/common-actions.md` for pre-verified versions (30+ actions with SHA pins).
