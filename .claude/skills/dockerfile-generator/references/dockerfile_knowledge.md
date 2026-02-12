# Dockerfile Knowledge Base

> Last updated: February 2026 | Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14

## Universal Multi-Stage Pattern

```dockerfile
# syntax=docker/dockerfile:1
ARG ${LANG}_VERSION=${DEFAULT}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

FROM ${BUILD_IMAGE} AS deps
WORKDIR /app
COPY --link ${DEP_FILES} ./
RUN --mount=type=cache,target=${CACHE_DIR} ${DEP_INSTALL}

FROM deps AS build
COPY --link . .
RUN ${BUILD_CMD}

FROM ${RUNTIME_IMAGE} AS runtime

ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="${APP_NAME}" \
      org.opencontainers.image.source="${REPO_URL}" \
      org.opencontainers.image.licenses="${LICENSE}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

WORKDIR /app
RUN <<EOF
${CREATE_USER_COMMANDS}
EOF
COPY --link --from=build --chown=${UID}:${GID} --chmod=555 ${ARTIFACTS} ./
ENV ${RUNTIME_ENVS}
USER ${UID}:${GID}
EXPOSE ${PORT}
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=${START_PERIOD} --start-interval=2s --retries=3 \
    CMD ${HEALTH_CMD}
ENTRYPOINT ${ENTRYPOINT}
```

## Language Substitution Table

| Field | Node.js (pnpm monorepo) | Node.js (standalone) | Python (uv) | Go (distroless) | Go (scratch) | Java (Maven) |
|-------|-------------------------|----------------------|--------------|------------------|--------------|--------------|
| BUILD_IMAGE | `node:24-slim-trixie` | `node:24-alpine3.22` | `python:3.14-slim-trixie` | `golang:1.24-alpine3.22` | same | `eclipse-temurin:21-jdk-alpine` |
| RUNTIME_IMAGE | `node:24-slim-trixie` | `node:24-alpine3.22` | `python:3.14-slim-trixie` | `gcr.io/distroless/static-debian12:nonroot` | `scratch` | `eclipse-temurin:21-jre-alpine` |
| DEP_FILES | `pnpm-lock.yaml pnpm-workspace.yaml` | `package.json package-lock.json` | `pyproject.toml uv.lock` | `go.mod go.sum` | same | `mvnw pom.xml .mvn` |
| CACHE_DIR | `/pnpm/store` (id=pnpm) | `/root/.npm` | `/root/.cache/uv` | `/go/pkg/mod` + `/root/.cache/go-build` | same | `/root/.m2` |
| CREATE_USER | `groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser` | Alpine `addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs` | `groupadd -r -g 1001 appuser && useradd -r -u 1001 -g appuser -d /app -s /bin/false appuser` | built-in `nonroot` (UID 65532) | UID `65532:65532` | Alpine `addgroup`/`adduser` |
| PORT | `4000` | `3000` | `8000` | `8080` | `8080` | `8080` |

## BuildKit Features (Required: Docker Engine 23.0+)

| Feature | Syntax | Purpose | Min Version |
|---------|--------|---------|-------------|
| Syntax directive | `# syntax=docker/dockerfile:1` | Enable BuildKit frontend features | Docker 18.09 |
| Cache mount | `RUN --mount=type=cache,target=/path` | Persistent pkg manager cache across builds | BuildKit 0.8 |
| Cache mount (apt) | `--mount=type=cache,target=/var/cache/apt,sharing=locked` | Apt cache without `rm -rf /var/lib/apt/lists/*` | BuildKit 0.8 |
| Secret mount (file) | `RUN --mount=type=secret,id=key cat /run/secrets/key` | Build-time secrets via file (never baked into layers) | BuildKit 0.8 |
| Secret mount (env) | `RUN --mount=type=secret,id=key,env=MY_KEY cmd` | Secret as env var (no file needed) | BuildKit 0.14 |
| SSH mount | `RUN --mount=type=ssh git clone git@github.com:org/repo.git` | Forward host SSH agent for private repos | BuildKit 0.8 |
| COPY --link | `COPY --link --from=stage ...` | Layer independence (enables rebase without rebuild) | BuildKit 0.8 |
| COPY --chmod (octal) | `COPY --link --chmod=555 ...` | Set permissions without extra RUN layer | BuildKit 0.8 |
| COPY --chmod (symbolic) | `COPY --chmod=+x ...` | Non-octal permission syntax | Dockerfile 1.14 |
| Cross-platform | `FROM --platform=$BUILDPLATFORM` + `ARG TARGETARCH TARGETOS` | Multi-arch builds (amd64/arm64) | BuildKit 0.8 |
| Heredoc RUN | `RUN <<EOF ... EOF` | Multi-line RUN without backslash continuation | BuildKit 0.10 |
| corepack | `RUN corepack enable` | Activate pnpm/yarn without global install | Node.js 16+ |

### Heredoc Syntax

Replace backslash-continuation patterns with heredoc for cleaner multi-line scripts:

```dockerfile
# BEFORE (error-prone backslash continuation)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# AFTER (heredoc — cleaner, no trailing backslashes)
RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates
rm -rf /var/lib/apt/lists/*
EOF
```

Heredoc with explicit shell interpreter:
```dockerfile
RUN <<EOF
#!/bin/bash
set -euo pipefail
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
EOF
```

## pnpm Monorepo Pattern (Matches `apps/api/Dockerfile`)

```dockerfile
# syntax=docker/dockerfile:1
# --- BASE + DEPS + BUILD ------------------------------------------------------
ARG NODE_VERSION=24
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

FROM node:${NODE_VERSION}-slim-trixie AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && corepack enable
WORKDIR /app

FROM base AS deps
COPY --link pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY --link package.json ./
COPY --link packages/*/package.json ./packages/
COPY --link apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline --ignore-scripts

FROM deps AS build
COPY --link packages ./packages
COPY --link apps/api ./apps/api
COPY --link tsconfig.base.json nx.json vite.config.ts vite.factory.ts ./
RUN pnpm exec nx run @parametric-portal/api:build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=@parametric-portal/api --prod /prod/api

# --- RUNTIME ------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE

LABEL org.opencontainers.image.title="parametric-api" \
      org.opencontainers.image.source="https://github.com/org/parametric-portal" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN <<EOF
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
EOF
WORKDIR /app
COPY --link --from=build --chown=1001:1001 --chmod=555 /prod/api ./
ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"
ENV API_PORT=4000
USER 1001:1001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:4000/live',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
EXPOSE 4000
ENTRYPOINT ["node", "dist/main.js"]
```

Key patterns:
- `pnpm fetch` downloads to store without installing (maximizes cache hits)
- `pnpm deploy --filter --prod` extracts standalone deployment with prod deps only
- Copy only needed `packages/*/package.json` files (not entire workspace)
- `corepack enable` activates pnpm without global install
- `--ignore-scripts` prevents postinstall during deps stage
- `slim-trixie` over `alpine` (glibc compatibility, security patches from Debian 13)
- `COPY --link` on every COPY for maximum layer independence
- `RUN <<EOF` heredoc for user creation (cleaner than `&&` chaining)
- `STOPSIGNAL SIGTERM` for graceful Node.js shutdown
- Pulumi-injectable ARGs for CI/CD metadata (GIT_SHA, BUILD_DATE)

## Cache Mount Targets

| Package Manager | Cache Target | Notes |
|-----------------|-------------|-------|
| pnpm | `/pnpm/store` | Use `id=pnpm` for cross-stage sharing |
| npm | `/root/.npm` | |
| yarn | `/root/.yarn/cache` | |
| bun | `/root/.bun/install/cache` | |
| pip | `/root/.cache/pip` | Legacy; prefer uv |
| uv | `/root/.cache/uv` | 10-100x faster than pip |
| Go modules | `/go/pkg/mod` + `/root/.cache/go-build` | Two mounts required |
| Maven | `/root/.m2` | |
| Gradle | `/root/.gradle` | |
| Cargo (Rust) | `/usr/local/cargo/registry` + `/app/target` | Two mounts required |
| apt | `/var/cache/apt` + `/var/lib/apt` | Use `sharing=locked` |
| apk | Not needed | `apk add --no-cache` is sufficient |

## Base Image Selection (February 2026)

| Image | Size | Shell | Security | Use Case |
|-------|------|-------|----------|----------|
| `scratch` | 0 MB | No | Zero surface | Go/Rust static binaries -- no ca-certs, no timezone |
| `gcr.io/distroless/static-debian12:nonroot` | 2 MB | No | Minimal surface | Static binaries needing ca-certs + passwd |
| `gcr.io/distroless/base-debian12:nonroot` | 20 MB | No | Minimal surface | Dynamic binaries needing glibc |
| `alpine:3.22` | 7 MB | Yes | Low surface | General minimal -- musl libc (test glibc compat) |
| `node:24-alpine3.22` | 55 MB | Yes | Low surface | Node.js (musl, smaller, less compatible) |
| `node:24-slim-trixie` | 80 MB | Yes | Medium | Node.js (glibc, Debian 13 security) |
| `python:3.14-slim-trixie` | 50 MB | Yes | Medium | Python runtime (Debian 13) |
| `eclipse-temurin:21-jre-alpine` | 190 MB | Yes | Low surface | Java runtime (Alpine) |
| `cgr.dev/chainguard/node:latest` | 50 MB | No | Hardened | Chainguard node (daily CVE rebuild) |
| `cgr.dev/chainguard/python:latest` | 45 MB | No | Hardened | Chainguard python (daily CVE rebuild) |
| `cgr.dev/chainguard/static:latest` | 2 MB | No | Hardened | Static binaries (Chainguard daily rebuild) |

## Chainguard Images

Chainguard images are distroless, rebuilt daily with zero known CVEs:

```dockerfile
# Go with Chainguard runtime (no shell, no package manager)
FROM golang:1.24-alpine3.22 AS builder
# ... build steps ...

FROM cgr.dev/chainguard/static:latest AS runtime
COPY --link --from=builder --chmod=555 /app /app
ENTRYPOINT ["/app"]
```

Key differences from Google distroless:
- Daily rebuilds (vs Google's periodic updates)
- Multi-layer images for better OCI caching
- FIPS-compliant variants available
- Free developer images at `:latest`; production images require subscription

## Security Rules

| Rule | Bad | Good |
|------|-----|------|
| Pin versions | `FROM node:latest` | `FROM node:24-alpine3.22` |
| Non-root | No `USER` directive | `groupadd`/`useradd` + `USER 1001:1001` |
| No secrets in ENV | `ENV API_KEY=secret` | `RUN --mount=type=secret,id=key,env=API_KEY ...` |
| No secrets in ARG | `ARG DB_PASS=secret` | `RUN --mount=type=secret,id=db_pass,env=DB_PASS ...` |
| Minimal base | Full OS image | slim/distroless/scratch/Chainguard |
| Exec form | `CMD npm start` | `ENTRYPOINT ["node", "main.js"]` |
| Non-privileged port | `EXPOSE 80` | `EXPOSE 8080` (>1024) |
| COPY not ADD | `ADD . /app` | `COPY --link . /app` |
| COPY --chmod | Extra `RUN chmod` layer | `COPY --chmod=555 ...` (single layer) |
| OCI labels | No LABEL | `LABEL org.opencontainers.image.title="..."` |
| Graceful shutdown | No STOPSIGNAL | `STOPSIGNAL SIGTERM` |
| Multi-line scripts | Backslash continuation | `RUN <<EOF ... EOF` |

## ENTRYPOINT vs CMD

| Directive | Use When |
|-----------|----------|
| `ENTRYPOINT ["binary"]` | Container IS the application (production services) |
| `CMD ["binary", "arg"]` | Default that users commonly change (dev/utility) |
| `ENTRYPOINT` + `CMD` | Fixed binary with configurable default flags |

## Framework Notes

| Framework | Key Patterns |
|-----------|-------------|
| Next.js | `output: 'standalone'` in config, copy `.next/standalone` + `.next/static` + `public`, `NEXT_TELEMETRY_DISABLED=1`, `HOSTNAME="0.0.0.0"` |
| FastAPI | uvicorn with `--host 0.0.0.0 --proxy-headers`, use uv instead of pip |
| Spring Boot | Layered JAR extraction, JRE not JDK for runtime, `--start-period=40s` |
| Express/Effect | pnpm monorepo pattern above, `NODE_OPTIONS="--enable-source-maps"` |
| Django | gunicorn with `--bind 0.0.0.0:8000 --workers 4`, collect static in build stage |
| Remix | `output: 'server'`, copy `build/server` + `build/client` + `public` |

## Multi-Platform Build

```dockerfile
# Cross-compilation pattern (no QEMU, native speed)
FROM --platform=$BUILDPLATFORM golang:1.24-alpine3.22 AS builder
ARG TARGETARCH TARGETOS
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o app
```

```bash
# Build + push multi-platform image with attestations
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --sbom=true \
    --provenance=mode=max \
    --build-arg GIT_SHA="$(git rev-parse HEAD)" \
    --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t myapp:latest --push .

# Build with secret (not baked into image)
docker buildx build --secret id=npmrc,src=$HOME/.npmrc -t myapp:latest .
```

## Build Orchestration (docker-bake.hcl)

Docker Bake (GA since Docker Desktop 4.38) enables declarative build orchestration:

```hcl
// docker-bake.hcl — monorepo build orchestration
variable "GIT_SHA"    { default = "unknown" }
variable "BUILD_DATE" { default = "unknown" }
variable "REGISTRY"   { default = "ghcr.io/org" }

group "default" {
    targets = ["api", "worker"]
}

target "api" {
    dockerfile = "apps/api/Dockerfile"
    context    = "."
    tags       = ["${REGISTRY}/api:latest", "${REGISTRY}/api:${GIT_SHA}"]
    platforms  = ["linux/amd64", "linux/arm64"]
    args       = { GIT_SHA = GIT_SHA, BUILD_DATE = BUILD_DATE }
    attest     = ["type=sbom", "type=provenance,mode=max"]
    cache-from = ["type=gha"]
    cache-to   = ["type=gha,mode=max"]
}

target "worker" {
    inherits   = ["api"]
    dockerfile = "apps/worker/Dockerfile"
    tags       = ["${REGISTRY}/worker:latest", "${REGISTRY}/worker:${GIT_SHA}"]
}
```

Usage: `docker buildx bake --set *.args.GIT_SHA=$(git rev-parse HEAD)`

## Supply Chain Security

| Feature | Command | Purpose |
|---------|---------|---------|
| SBOM generation | `docker buildx build --sbom=true` | Attach SPDX-JSON SBOM to image |
| Provenance | `docker buildx build --provenance=mode=max` | SLSA provenance attestation |
| Image signing | `cosign sign myregistry/myapp:latest` | Sigstore keyless signing |
| CVE scanning | `docker scout cves myapp:latest` | Vulnerability detection |
| Layer analysis | `dive myapp:latest` | Layer size and efficiency |
| SBOM extraction | `docker buildx imagetools inspect --format '{{json .SBOM}}'` | View attached SBOM |

## Scanning Tools

| Tool | Command | Purpose |
|------|---------|---------|
| hadolint | `hadolint Dockerfile` | Dockerfile lint (60+ rules) |
| Checkov | `checkov -f Dockerfile --framework dockerfile` | Security policies (28 checks) |
| Trivy | `trivy image myapp:latest` | OS + library vulnerability scan |
| Docker Scout | `docker scout cves myapp:latest` | CVE scan with remediation advice |
| dive | `dive myapp:latest` | Layer analysis and waste detection |
| Syft | `syft myapp:latest -o spdx-json` | SBOM generation (SPDX/CycloneDX) |
| Grype | `grype myapp:latest` | Vulnerability scanner (anchore) |
| cosign | `cosign verify myregistry/myapp:latest` | Image signature verification |

## Pulumi IaC Integration

Dockerfiles should expose injectable ARGs that Pulumi can parameterize at build time:

```typescript
// Pulumi TypeScript — build and push Docker image
const image = new docker.Image("api", {
    imageName: pulumi.interpolate`${registry.server}/api:${gitSha}`,
    build: {
        context: ".",
        dockerfile: "apps/api/Dockerfile",
        platform: "linux/amd64",
        args: {
            GIT_SHA: gitSha,
            BUILD_DATE: new Date().toISOString(),
            IMAGE_VERSION: version,
        },
        builderVersion: docker.BuilderVersion.BuilderBuildKit,
    },
});
```

Key patterns:
- `ARG GIT_SHA="unknown"` -- Pulumi passes commit SHA for traceability
- `ARG BUILD_DATE="unknown"` -- Pulumi passes build timestamp
- `ARG IMAGE_VERSION="0.0.0"` -- Pulumi passes semantic version
- `LABEL org.opencontainers.image.revision="${GIT_SHA}"` -- queryable by Pulumi/K8s
- `HEALTHCHECK` compatible with K8s probes (same endpoint, different mechanism)
