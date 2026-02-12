---
name: dockerfile-validator
description: Comprehensive toolkit for validating, linting, and securing Dockerfiles. Use this skill when validating Dockerfile syntax, checking security best practices, optimizing image builds. Applies to all Dockerfile variants (Dockerfile, Dockerfile.prod, Dockerfile.dev, etc.).
---

# Dockerfile Validator

> Docker Engine 27+ | BuildKit 0.14+ | hadolint 2.14+ | Checkov latest

Self-contained script: `scripts/dockerfile-validate.sh`. Auto-installs hadolint + Checkov in temp venvs, runs 5-stage validation, cleans up on exit via bash trap.

## When to Use

- Validate/lint/check/optimize any Dockerfile
- Security audit of container images
- Pre-commit Dockerfile review

## Do NOT Use For

- Generating Dockerfiles (use dockerfile-generator)
- Building/running containers (`pnpm exec nx run api:docker:build`)
- Debugging running containers (`docker logs`, `docker exec`)

## Quick Start

```bash
bash scripts/dockerfile-validate.sh Dockerfile
bash scripts/dockerfile-validate.sh Dockerfile.prod
FORCE_TEMP_INSTALL=true bash scripts/dockerfile-validate.sh Dockerfile  # test temp install
```

## Validation Stages

| Stage | Tool | Checks |
|-------|------|--------|
| 1. Syntax | hadolint | Instruction validation, ShellCheck on RUN, 60+ lint rules |
| 2. Security | Checkov | 11 CKV_DOCKER policies + 17 CKV2_DOCKER graph checks |
| 3. Extended Security | custom | Secrets, sudo, cert bypass (curl/wget/pip/npm/git), chpasswd, dangerous packages |
| 4. Best Practices | custom | :latest, USER, HEALTHCHECK, STOPSIGNAL, MAINTAINER, ADD, apt, WORKDIR, shell form, cache cleanup, COPY order, BuildKit syntax, OCI labels, heredoc suggestions |
| 5. Optimization | custom | Base image size, multi-stage, layer count, BuildKit features (--mount, --link, --chmod), heredoc opportunities, secret env mounts, .dockerignore, Chainguard suggestions |

Exit codes: `0` all passed (warnings allowed), `1` validation failure (errors only), `2` critical error.

## Mandatory Workflow

### 1. Pre-Validation
Read the Dockerfile first to understand context.

### 2. Run Validation
```bash
bash scripts/dockerfile-validate.sh <Dockerfile>
```

### 3. Post-Validation
1. **Summarize by severity**: critical (secrets, cert bypass, no USER) -> high (:latest, sudo, SSH port) -> medium (cache cleanup, version pinning, missing OCI labels) -> low (style, layer count, STOPSIGNAL, heredoc)
2. **Read reference file**: `references/dockerfile_reference.md` for fix patterns
3. **Propose fixes** with concrete code from reference patterns
4. **Offer to apply** fixes to the Dockerfile

## Key Validation Rules

| Category | Check | Reference |
|----------|-------|-----------|
| Base image | Pin version (not :latest), prefer slim-trixie/distroless/Chainguard | DL3006, DL3007, CKV_DOCKER_7 |
| Security | Non-root USER with UID/GID | DL3002, CKV_DOCKER_3, CKV_DOCKER_8 |
| Security | No secrets in ENV/ARG | Custom + CKV2_DOCKER_17 |
| Security | No cert bypass flags | CKV2_DOCKER_2 through CKV2_DOCKER_6 |
| Security | No sudo, no chpasswd | CKV2_DOCKER_1, CKV2_DOCKER_17, DL3004 |
| Security | No SSH port (22) | CKV_DOCKER_1 |
| BuildKit | COPY --link on all COPY statements | Custom optimization |
| BuildKit | COPY --chmod (no separate RUN chmod) | Custom optimization |
| BuildKit | RUN --mount=type=cache for pkg managers | Custom optimization |
| BuildKit | RUN --mount=type=secret,env= (not file-based) | Custom security |
| BuildKit | RUN <<EOF heredoc for multi-line scripts | Custom optimization |
| Runtime | HEALTHCHECK present (exec-form with --start-interval) | CKV_DOCKER_2, DL3047 |
| Runtime | STOPSIGNAL for graceful shutdown | Custom best practice |
| Runtime | Exec-form ENTRYPOINT/CMD | DL3025 |
| Runtime | Absolute WORKDIR | DL3000, CKV_DOCKER_10 |
| Metadata | OCI labels (org.opencontainers.image.* with revision/created) | Custom best practice |
| Metadata | Pulumi-injectable ARGs (GIT_SHA, BUILD_DATE) | Custom IaC pattern |
| Layers | Combine consecutive RUN with heredoc | DL3059 |
| Layers | apt --no-install-recommends | DL3015 |

## Resources

| Path | Purpose |
|------|---------|
| `scripts/dockerfile-validate.sh` | Self-contained 5-stage validator with auto-install/cleanup |
| `references/dockerfile_reference.md` | Best practices, security, version matrix, hadolint/Checkov reference |
| `examples/good-example.Dockerfile` | Node.js multi-stage with all 18 best practices |
| `examples/bad-example.Dockerfile` | 20 anti-patterns with inline explanations and fix references |
| `examples/security-issues.Dockerfile` | Intentional security vulns with severity tags and CKV rule references |
| `examples/python-optimized.Dockerfile` | Python multi-stage with uv and BuildKit optimization |
| `examples/golang-distroless.Dockerfile` | Go cross-platform distroless with secret env mounts |
| `examples/.dockerignore.example` | Build context exclusion patterns |

## Tool Installation

Auto-installed by script. For permanent install:

| Tool | Install | Min Version |
|------|---------|-------------|
| hadolint | `brew install hadolint` | >= 2.14.0 |
| Checkov | `pip3 install checkov` | latest (Python 3.9-3.14) |
| Python | required for temp install | >= 3.9 |

## Troubleshooting

| Error | Fix |
|-------|-----|
| FROM must be first non-comment | Move `ARG` defining base tag before `FROM` |
| Unknown instruction | Check spelling (common: RUNS, COPIES, FRUM) |
| COPY failed: file not found | Verify path relative to build context, check .dockerignore |
| Hardcoded secrets detected | Use `--mount=type=secret,env=VAR` or runtime config |
| Slow builds | Layer cache ordering, .dockerignore, BuildKit, multi-stage |
| COPY --link not recognized | Ensure `# syntax=docker/dockerfile:1` as first line, Docker 23.0+ |
| Secret mount not working | Requires `docker buildx build --secret id=key,src=file` at build time |
| Heredoc not recognized | Ensure `# syntax=docker/dockerfile:1` as first line, BuildKit 0.10+ |
