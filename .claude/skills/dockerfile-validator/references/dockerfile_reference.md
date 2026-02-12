# Dockerfile Reference

> Last updated: February 2026 | Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14

## Base Image Selection

| Image | Size | Shell | Security | Use Case |
|-------|------|-------|----------|----------|
| `scratch` | 0 MB | No | Zero surface | Go/Rust static binaries -- zero attack surface |
| `gcr.io/distroless/static-debian12:nonroot` | 2 MB | No | Minimal | Static binaries needing ca-certs (UID 65532) |
| `gcr.io/distroless/base-debian12:nonroot` | 20 MB | No | Minimal | Dynamic binaries needing glibc |
| `alpine:3.22` | 7 MB | Yes | Low | General minimal -- musl libc (test glibc compat) |
| `*-slim-trixie` | 50-80 MB | Yes | Medium | Python/Node when musl causes issues (Debian 13) |
| `*-slim-bookworm` | 50-80 MB | Yes | Medium | Legacy -- use trixie for new projects |
| `ubuntu:24.04` | 80 MB | Yes | Higher | Last resort -- full distro, large CVE surface |
| `cgr.dev/chainguard/*` | varies | No | Hardened | Daily-rebuilt minimal images with zero CVEs |

Pin: `alpine:3.22` (good), `alpine:3.22@sha256:...` (reproducible). Never `:latest`.

## Multi-Stage Builds

```dockerfile
# syntax=docker/dockerfile:1
FROM golang:1.24-alpine3.22 AS builder
WORKDIR /src
COPY --link go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download
COPY --link . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /app

FROM gcr.io/distroless/static-debian12:nonroot
COPY --link --from=builder --chmod=555 /app /app
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app"]
```

Name stages (`AS builder`). Copy only artifacts to final. Use minimal final base.

## Layer Optimization

**Order: least-changing -> most-changing** (base -> system deps -> app deps -> source)

```dockerfile
# Dependency files first (rarely change)
COPY --link package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --only=production
# Source last (changes frequently)
COPY --link . .
```

**Package manager cache strategies** (no cleanup needed with cache mounts):

| Pkg Mgr | With Cache Mount | Without Cache Mount (legacy) |
|---------|-----------------|------------------------------|
| apt | `--mount=type=cache,target=/var/cache/apt,sharing=locked` | `apt-get update && apt-get install -y --no-install-recommends pkg && rm -rf /var/lib/apt/lists/*` |
| apk | Not needed | `apk add --no-cache pkg` |
| pip | `--mount=type=cache,target=/root/.cache/pip` | `pip install --no-cache-dir pkg` |
| uv | `--mount=type=cache,target=/root/.cache/uv` | Not applicable (uv requires no cleanup) |
| npm | `--mount=type=cache,target=/root/.npm` | `npm ci --only=production` |
| pnpm | `--mount=type=cache,id=pnpm,target=/pnpm/store` | N/A |

## BuildKit Features

```dockerfile
# syntax=docker/dockerfile:1    <-- REQUIRED for --mount/--link

# Cache mounts -- persist across builds, never in final image
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# Secret mounts (file-based) -- not in final image or layer history
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

# Secret mounts (env-based, BuildKit 0.14+) -- cleaner, no file read
RUN --mount=type=secret,id=api_key,env=API_KEY some-command

# SSH mounts -- forward host SSH agent
RUN --mount=type=ssh git clone git@github.com:private/repo.git

# COPY --link -- layer independence, better caching in parallel builds
COPY --link --from=builder /app /app

# COPY --chmod -- set permissions in single layer (octal or symbolic)
COPY --link --from=builder --chmod=555 /app/binary /app/binary
COPY --link --chmod=+x scripts/entrypoint.sh /entrypoint.sh

# Heredoc RUN -- multi-line without backslash continuation
RUN <<EOF
apt-get update
apt-get install -y --no-install-recommends curl ca-certificates
rm -rf /var/lib/apt/lists/*
EOF

# Heredoc with explicit interpreter
RUN <<EOF
#!/bin/bash
set -euo pipefail
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
EOF
```

### Feature Version Matrix

| Feature | Min Docker | Min BuildKit | Dockerfile Frontend |
|---------|-----------|-------------|-------------------|
| `# syntax=docker/dockerfile:1` | 18.09 | 0.6 | Any |
| `RUN --mount=type=cache` | 18.09 | 0.8 | 1.2+ |
| `RUN --mount=type=secret` | 18.09 | 0.8 | 1.2+ |
| `RUN --mount=type=secret,env=` | 27.0 | 0.14 | 1.14+ |
| `RUN --mount=type=ssh` | 18.09 | 0.8 | 1.2+ |
| `COPY --link` | 23.0 | 0.8 | 1.4+ |
| `COPY --chmod` (octal) | 23.0 | 0.8 | 1.2+ |
| `COPY --chmod` (symbolic) | 27.0 | 0.14 | 1.14+ |
| Heredoc `RUN <<EOF` | 23.0 | 0.10 | 1.4+ |
| `FROM --platform=$BUILDPLATFORM` | 18.09 | 0.8 | 1.2+ |
| SBOM attestations | 24.0 | 0.11 | N/A (buildx) |
| Provenance attestations | 24.0 | 0.11 | N/A (buildx) |

## Security

| Rule | Why | Fix |
|------|-----|-----|
| Non-root USER | Root in container = root on host (shared kernel) | `addgroup -g 1001 -S app && adduser -S app -u 1001` then `USER 1001:1001` |
| No secrets in ENV/ARG | `docker history` exposes all ENV/ARG values | `--mount=type=secret,env=VAR` or runtime env injection |
| COPY over ADD | ADD auto-extracts tars + fetches URLs -- unexpected behavior | Use `COPY` for local files, `curl`/`wget` for URLs |
| Exec form CMD | Shell form wraps in `/bin/sh -c` -- PID 1 cannot receive signals | `CMD ["node", "app.js"]` not `CMD node app.js` |
| Pipefail | Without it, pipe failures are silently swallowed | `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` or `set -o pipefail` |
| No sudo | Breaks audit trail, enables privilege escalation after USER | Run privileged ops before `USER`, drop with `USER` |
| No cert bypass | `-k`, `--no-check-certificate`, `--trusted-host` enable MITM | Use proper CA certs or `--mount=type=secret` for custom CAs |
| `--no-install-recommends` | Prevents apt from pulling 100+ MB of suggested packages | Always include with `apt-get install` |
| `--chown`/`--chmod` on COPY | Avoids extra `RUN chown`/`chmod` layer (saves time + space) | `COPY --link --chown=1001:1001 --chmod=555 src dst` |
| OCI labels | Enable audit, provenance, and registry metadata | `LABEL org.opencontainers.image.title="..." ...` |
| No privileged ports | Ports < 1024 require root capability | Use ports > 1024 (3000, 8000, 8080) |
| STOPSIGNAL | Explicit signal for graceful shutdown | `STOPSIGNAL SIGTERM` (or `SIGQUIT` for nginx) |

## OCI Annotations

```dockerfile
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

LABEL org.opencontainers.image.title="my-app" \
      org.opencontainers.image.description="Production API service" \
      org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.authors="team@org.com" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"
```

Standard keys: `title`, `description`, `source`, `licenses`, `authors`, `revision`, `created`, `documentation`, `url`, `vendor`, `version`.

## Runtime

```dockerfile
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:8080/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]

EXPOSE 8080
WORKDIR /app          # absolute paths only
```

### HEALTHCHECK Guidelines

| App Type | interval | timeout | start-period | start-interval | retries | Check Method |
|----------|----------|---------|-------------|----------------|---------|-------------|
| Node.js API | 30s | 5s | 10s | 2s | 3 | `node -e "require('http').get(...)"` |
| Python API | 30s | 5s | 10s | 2s | 3 | `python -c "import urllib.request; ..."` |
| Java (Spring) | 30s | 10s | 40s | 5s | 3 | `wget --spider http://localhost:8080/actuator/health` |
| Background worker | 60s | 10s | 15s | 5s | 3 | Check PID file or queue connection |
| Distroless | N/A | N/A | N/A | N/A | N/A | Use orchestrator probes (K8s/ECS) |

### STOPSIGNAL by Application

| Application | Signal | Reason |
|-------------|--------|--------|
| Node.js | `SIGTERM` | Triggers `process.on('SIGTERM')` for graceful shutdown |
| Python (uvicorn) | `SIGTERM` | uvicorn handles SIGTERM with graceful drain |
| Go | `SIGTERM` | Signal handling via `signal.Notify` |
| nginx | `SIGQUIT` | Graceful shutdown (finish serving requests) |
| Java | `SIGTERM` | JVM shutdown hooks triggered |

## Language-Specific Patterns

| Language | Build Base | Runtime Base | Key Flags |
|----------|-----------|-------------|-----------|
| Node.js (pnpm) | `node:24-slim-trixie` | `node:24-slim-trixie` | `pnpm fetch`, `pnpm deploy --filter --prod` |
| Node.js (npm) | `node:24-alpine3.22` | `node:24-alpine3.22` | `npm ci --only=production`, `USER 1001:1001` |
| Python (uv) | `python:3.14-slim-trixie` | `python:3.14-slim-trixie` | `uv sync --frozen --no-dev`, copy `.venv` |
| Python (pip) | `python:3.14-slim-trixie` | `python:3.14-slim-trixie` | `pip install --user --no-cache-dir`, copy `/root/.local` |
| Go | `golang:1.24-alpine3.22` | `distroless/static:nonroot` | `CGO_ENABLED=0 -trimpath -ldflags="-s -w"` |
| Rust | `rust:1.84-slim-trixie` | `gcr.io/distroless/cc-debian12:nonroot` | `cargo build --release --target-dir /app/target` |
| Java | `eclipse-temurin:21-jdk-alpine` | `21-jre-alpine` | Consider jlink custom JRE |

## Hadolint Rules (Key Subset)

| Rule | Sev | Description | Why |
|------|-----|-------------|-----|
| DL3000 | error | Use absolute WORKDIR | Relative paths are ambiguous across stages |
| DL3002 | warn | Last USER should not be root | Container compromise = host root access |
| DL3003 | warn | Use WORKDIR not `cd` | `cd` in RUN doesn't persist across layers |
| DL3004 | error | Do not use sudo | Breaks audit trail, use USER directive instead |
| DL3006 | warn | Always tag image versions | `:latest` makes builds non-reproducible |
| DL3007 | warn | Use specific tag, not `:latest` | Same image tag can point to different digests |
| DL3008 | warn | Pin versions in apt-get | Unpinned = different versions on rebuild |
| DL3009 | info | Delete apt lists after install | Lists persist ~30 MB per layer (or use cache mount) |
| DL3013 | warn | Pin versions in pip | Same as DL3008 for Python |
| DL3015 | info | Use `--no-install-recommends` | Prevents 100+ MB of unneeded apt packages |
| DL3018 | warn | Pin versions in apk | Same as DL3008 for Alpine |
| DL3019 | info | Use `--no-cache` with apk | Prevents index cache in layer |
| DL3020 | error | Use COPY not ADD for files | ADD has implicit tar extraction + URL fetch |
| DL3025 | warn | Use JSON form for CMD/ENTRYPOINT | Shell form can't receive signals (PID 1 issue) |
| DL3027 | warn | Do not use `apt` -- use `apt-get` | `apt` is interactive frontend, unstable in scripts |
| DL3042 | warn | Avoid cache directory with pip | Use `--no-cache-dir` or `--mount=type=cache` |
| DL3047 | info | Conditionals in HEALTHCHECK CMD | Use `|| exit 1` or exec-form `CMD [...]` |
| DL3059 | info | Combine consecutive RUN | Each RUN = 1 layer, fewer layers = smaller image |
| DL4006 | warn | Set pipefail shell option | Without pipefail, pipe failures are silent |

## Checkov Policies (CKV_DOCKER_*)

| ID | Description | Why |
|----|-------------|-----|
| CKV_DOCKER_1 | Port 22 (SSH) not exposed | SSH in containers = lateral movement vector |
| CKV_DOCKER_2 | HEALTHCHECK instruction exists | Orchestrators need health signal for routing/restart |
| CKV_DOCKER_3 | Non-root user created | Limits blast radius of container compromise |
| CKV_DOCKER_4 | COPY used instead of ADD | ADD has implicit extraction, unexpected behavior |
| CKV_DOCKER_5 | Update not alone without install | `apt-get update` alone creates stale cache layer |
| CKV_DOCKER_6 | LABEL maintainer (not MAINTAINER) | MAINTAINER deprecated since Docker 1.13 |
| CKV_DOCKER_7 | Version tag (not `:latest`) | `:latest` breaks reproducibility |
| CKV_DOCKER_8 | Last USER not root | Runtime process should not have root privileges |
| CKV_DOCKER_9 | `apt-get` not `apt` | `apt` CLI is unstable for scripted use |
| CKV_DOCKER_10 | WORKDIR uses absolute paths | Relative WORKDIR is ambiguous |
| CKV_DOCKER_11 | FROM aliases unique in multi-stage | Duplicate aliases cause ambiguous COPY --from references |

## Checkov Graph Policies (CKV2_DOCKER_*)

| ID | Description | Why |
|----|-------------|-----|
| CKV2_DOCKER_1 | No `sudo` usage | Breaks audit trail, enables privilege escalation |
| CKV2_DOCKER_2 | No `curl -k`/`--insecure` | Disables TLS cert validation, enables MITM |
| CKV2_DOCKER_3 | No `wget --no-check-certificate` | Same MITM risk as CKV2_DOCKER_2 |
| CKV2_DOCKER_4 | No `pip --trusted-host` | Bypasses PyPI TLS validation |
| CKV2_DOCKER_5 | No `PYTHONHTTPSVERIFY=0` | Disables all Python HTTPS verification |
| CKV2_DOCKER_6 | No `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disables Node.js TLS certificate checking |
| CKV2_DOCKER_7 | No `apk --allow-untrusted` | Installs unverified Alpine packages |
| CKV2_DOCKER_8 | No `apt-get --allow-unauthenticated` | Installs unsigned Debian packages |
| CKV2_DOCKER_9 | No `--nogpgcheck` (dnf/yum/tdnf) | Skips RPM signature validation |
| CKV2_DOCKER_10 | RPM signature validation enforced | Unsigned RPMs may contain tampered binaries |
| CKV2_DOCKER_11 | No `--force-yes` | Disables apt signature validation + allows downgrades |
| CKV2_DOCKER_12 | No `NPM_CONFIG_STRICT_SSL=false` | Disables npm registry TLS |
| CKV2_DOCKER_13 | No `strict-ssl false` (npm/yarn) | Same as CKV2_DOCKER_12 via config |
| CKV2_DOCKER_14 | No `GIT_SSL_NO_VERIFY` | Disables git HTTPS certificate validation |
| CKV2_DOCKER_15 | No `sslverify=false` (yum/dnf) | Disables repo TLS for RPM managers |
| CKV2_DOCKER_16 | No `PIP_TRUSTED_HOST` env var | Same as CKV2_DOCKER_4 via environment |
| CKV2_DOCKER_17 | No `chpasswd` | Embeds passwords in image layer history |

Suppress: `# checkov:skip=CKV_DOCKER_2:Reason here`

## Cache Strategy Decision Tree

```
Is the package manager cache useful across builds?
+-- YES -> Use RUN --mount=type=cache,target=<cache-dir>
|   +-- apt? -> Add sharing=locked (parallel builds)
|   +-- Cross-stage? -> Add id=<name> for shared identity
|   +-- CI? -> Pair with buildx --cache-from/--cache-to for registry cache
+-- NO -> Use inline cleanup (--no-cache-dir, rm -rf)
```

## Build Orchestration (docker-bake.hcl)

```hcl
// Bake file for monorepo parallel builds with attestations
variable "GIT_SHA"    { default = "unknown" }
variable "BUILD_DATE" { default = "unknown" }
variable "REGISTRY"   { default = "ghcr.io/org" }

group "default" { targets = ["api", "worker"] }

target "api" {
    dockerfile = "apps/api/Dockerfile"
    context    = "."
    tags       = ["${REGISTRY}/api:${GIT_SHA}"]
    platforms  = ["linux/amd64", "linux/arm64"]
    args       = { GIT_SHA = GIT_SHA, BUILD_DATE = BUILD_DATE }
    attest     = ["type=sbom", "type=provenance,mode=max"]
    cache-from = ["type=gha"]
    cache-to   = ["type=gha,mode=max"]
}
```

## Analysis Tools

| Tool | Purpose | Command |
|------|---------|---------|
| hadolint | Dockerfile lint | `hadolint Dockerfile` |
| Checkov | Security scan | `checkov -f Dockerfile --framework dockerfile` |
| dive | Layer analysis | `dive myimage:latest` |
| Docker Scout | CVE scan | `docker scout cves myimage:latest` |
| Trivy | Vuln scan | `trivy image myimage:latest` |
| Grype | Vuln scan | `grype myimage:latest` |
| Syft | SBOM gen | `syft myimage:latest -o spdx-json` |
| cosign | Sign/verify | `cosign verify myregistry/myimage:latest` |
