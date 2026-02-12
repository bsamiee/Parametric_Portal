---
name: dockerfile-generator
description: Generate production-ready multi-stage Dockerfiles with BuildKit features, pnpm monorepo support, and security hardening. Use when creating, generating, or writing Dockerfiles.
---

# Dockerfile Generator

> Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14

## When to Use

- Creating/converting Dockerfiles (Node.js, Python, Go, Java, Rust)
- User asks to "create", "generate", "build", or "write" a Dockerfile
- Implementing multi-stage builds for CI/CD
- Containerizing pnpm monorepo applications

## Do NOT Use For

- Validating existing Dockerfiles (use dockerfile-validator)
- Building/running containers (`docker build` or Pulumi `@pulumi/docker`)
- Debugging running containers (`docker logs`/`exec`)

## Workflow

### 1. Gather Requirements

| Category | Required |
|----------|----------|
| Language | Language, version, framework, entry point |
| Deps | Package manager (pnpm/npm/uv/pip/go mod), system deps, build vs runtime |
| Config | Port(s), env vars, health endpoint, volumes |
| Build | Build commands, Nx target (monorepo), compilation flags |
| Prod | Image size constraints, security, multi-arch (amd64/arm64) |

### 2. Framework Research (if needed)

1. **context7 MCP** (preferred): resolve lib ID, fetch docs for "docker deployment production build"
2. **WebSearch fallback**: `"<framework> <version> dockerfile best practices production 2026"`

### 3. Generate Dockerfile

Apply patterns from `references/dockerfile_knowledge.md`. All generated Dockerfiles MUST include:

| Requirement | Implementation |
|-------------|---------------|
| Syntax directive | `# syntax=docker/dockerfile:1` |
| Header comment | Feature list with Docker Engine/BuildKit version requirements |
| Version ARG | `ARG NODE_VERSION=24` (parameterize base image) |
| Pulumi ARGs | `ARG GIT_SHA="unknown"` + `ARG BUILD_DATE="unknown"` + `ARG IMAGE_VERSION="0.0.0"` |
| Multi-stage | `FROM ... AS deps`, `FROM ... AS build`, `FROM ... AS runtime` |
| Cache mounts | `RUN --mount=type=cache,target=/path` for all pkg managers |
| Apt cache | `--mount=type=cache,target=/var/cache/apt,sharing=locked` (no `rm -rf`) |
| Secret mount | `RUN --mount=type=secret,id=key,env=VAR` (env-based, BuildKit 0.14+) |
| COPY --link | `COPY --link` on every COPY (layer independence) |
| COPY --chmod | `COPY --link --chmod=555 ...` (no extra `RUN chmod` layer) |
| Non-root user | `groupadd`/`useradd` + `USER 1001:1001` or distroless `nonroot` |
| OCI labels | `LABEL org.opencontainers.image.title="..." org.opencontainers.image.revision="${GIT_SHA}"` |
| HEALTHCHECK | Required if service exposes a port (exec-form, with `--start-interval`) |
| STOPSIGNAL | `STOPSIGNAL SIGTERM` for graceful shutdown |
| Exec-form entry | `ENTRYPOINT ["node", "main.js"]` (signal forwarding) |
| Heredoc RUN | `RUN <<EOF` for multi-line scripts (no backslash continuation) |

**Base image selection (February 2026):**

| Language | Build Image | Runtime Image |
|----------|------------|--------------|
| Node.js (pnpm) | `node:24-slim-trixie` | `node:24-slim-trixie` |
| Node.js (npm) | `node:24-alpine3.22` | `node:24-alpine3.22` |
| Python (uv) | `python:3.14-slim-trixie` | `python:3.14-slim-trixie` |
| Go | `golang:1.24-alpine3.22` | `gcr.io/distroless/static-debian12:nonroot` |
| Rust | `rust:1.84-slim-trixie` | `gcr.io/distroless/cc-debian12:nonroot` |
| Java | `eclipse-temurin:21-jdk-alpine` | `eclipse-temurin:21-jre-alpine` |
| Chainguard | `cgr.dev/chainguard/node:latest-dev` | `cgr.dev/chainguard/node:latest` |

**pnpm Monorepo (this project):**

| Pattern | Implementation |
|---------|---------------|
| corepack | `RUN corepack enable` (no global pnpm install) |
| Fetch first | `pnpm fetch --frozen-lockfile` (cache-optimal) |
| Offline install | `pnpm install --frozen-lockfile --offline --ignore-scripts` |
| Deploy extract | `pnpm deploy --filter=@scope/app --prod /prod/app` |
| Selective copy | Only needed `packages/*/package.json` files (not entire workspace) |
| Base image | `node:24-slim-trixie` (glibc, Debian 13, not alpine) |
| Exemplar | `apps/api/Dockerfile` is the production reference |

### 4. Generate .dockerignore

Always generate alongside Dockerfile. Use template from `references/dockerfile_knowledge.md`.

### 5. Validate

**REQUIRED.** Invoke dockerfile-validator skill (hadolint + Checkov + custom validation).

### 6. Iterate

Fix -> re-validate -> repeat (max 3 iterations). Common fixes: pin version tags, add USER, add HEALTHCHECK, combine RUN with heredoc, use COPY not ADD, add OCI labels, add STOPSIGNAL.

### 7. Final Review

**Deliverables:** Validated Dockerfile + .dockerignore + validation summary.

| Metric | Estimate |
|--------|----------|
| Node.js (slim-trixie) | ~80-200MB (vs ~1GB full) |
| Python (slim-trixie) | ~50-250MB (vs ~900MB full) |
| Go (distroless) | ~5-20MB (vs ~800MB full) |
| Java (JRE) | ~200-350MB (vs ~500MB+ JDK) |

**Multi-platform build command with attestations:**
```bash
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --sbom=true \
    --provenance=mode=max \
    --build-arg GIT_SHA="$(git rev-parse HEAD)" \
    --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t myapp:latest --push .
```

**Build orchestration with Bake (docker-bake.hcl):**
```hcl
group "default" { targets = ["api", "worker"] }
target "api" {
    dockerfile = "apps/api/Dockerfile"
    tags       = ["myregistry/api:latest"]
    platforms  = ["linux/amd64", "linux/arm64"]
    args       = { GIT_SHA = "${GIT_SHA}", BUILD_DATE = "${BUILD_DATE}" }
    attest     = ["type=sbom", "type=provenance,mode=max"]
}
```

## Scripts

`scripts/generate.sh` provides standalone CLI generation. Usage: `./generate.sh nodejs -s @scope/app -p 4000`

## Integration

- **dockerfile-validator** -- validates generated Dockerfiles (REQUIRED)
- **k8s-generator** -- Kubernetes deployments for the container
- **pulumi-k8s-generator** -- Pulumi K8s resources with the container image
