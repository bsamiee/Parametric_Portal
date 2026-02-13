# [H1][DOCKERFILE_KNOWLEDGE]
>**Dictum:** *Generation patterns produce production-ready Dockerfiles.*

<br>

[IMPORTANT] Docker Engine 29.2+ | BuildKit 0.27+ | Dockerfile syntax 1 (auto-resolving) | February 2026

---
## [1][MULTI_STAGE_TEMPLATE]
>**Dictum:** *Universal template parameterized per language.*

<br>

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
LABEL org.opencontainers.image.title="${APP}" \
      org.opencontainers.image.source="${REPO}" \
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=${START} --start-interval=2s --retries=3 \
    CMD ${HEALTH_CMD}
ENTRYPOINT ${ENTRYPOINT}
```

---
## [2][LANGUAGE_SUBSTITUTION]
>**Dictum:** *Per-language values fill the universal template.*

<br>

| [INDEX] | [FIELD]           | [NODE_PNPM_MONOREPO]                               | [NODE_STANDALONE]                                   | [PYTHON_UV]                                          | [GO_DISTROLESS]                         | [JAVA_MAVEN]                |
| :-----: | ----------------- | -------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | --------------------------- |
|   [1]   | **BUILD_IMAGE**   | `node:24-slim-trixie`                              | `node:24-alpine3.23`                                | `python:3.14-slim-trixie`                            | `golang:1.26-alpine3.23`                | `temurin:21-jdk-alpine`     |
|   [2]   | **RUNTIME_IMAGE** | `node:24-slim-trixie`                              | `node:24-alpine3.23`                                | `python:3.14-slim-trixie`                            | `distroless/static-debian12:nonroot`    | `temurin:21-jre-alpine`     |
|   [3]   | **DEP_FILES**     | `pnpm-lock.yaml pnpm-workspace.yaml`               | `package.json package-lock.json`                    | `pyproject.toml uv.lock`                             | `go.mod go.sum`                         | `mvnw pom.xml .mvn`         |
|   [4]   | **CACHE_DIR**     | `/pnpm/store` (id=pnpm)                            | `/root/.npm`                                        | `/root/.cache/uv`                                    | `/go/pkg/mod` + `/root/.cache/go-build` | `/root/.m2`                 |
|   [5]   | **CREATE_USER**   | Debian: `groupadd -g 1001 appgroup && useradd ...` | Alpine: `addgroup -g 1001 -S nodejs && adduser ...` | Debian: `groupadd -r -g 1001 appuser && useradd ...` | Built-in `nonroot` UID 65532            | Alpine `addgroup`/`adduser` |
|   [6]   | **PORT**          | `4000`                                             | `3000`                                              | `8000`                                               | `8080`                                  | `8080`                      |

---
## [3][PNPM_MONOREPO]
>**Dictum:** *pnpm fetch + deploy pattern maximizes cache efficiency.*

<br>

**Stage sequence:** `base` (corepack enable) -> `deps` (fetch + install) -> `build` (nx build + pnpm deploy) -> `runtime`

**Key commands:**
- `pnpm fetch --frozen-lockfile` -- downloads to store without installing (cache-optimal)
- `pnpm install --frozen-lockfile --offline --ignore-scripts` -- offline install from fetched store
- `pnpm deploy --filter=@scope/app --prod /prod/app` -- extracts standalone deployment with prod deps
- Copy only `packages/*/package.json` files (not entire workspace) for selective dep resolution

**Runtime stage:**
- `node:24-slim-trixie` (glibc, Debian 13) over alpine (musl libc compatibility)
- `corepack enable` activates pnpm without global install (Node.js 16+)
- `COPY --link --from=build --chown=1001:1001 --chmod=555 /prod/app ./`
- `STOPSIGNAL SIGTERM` for graceful Node.js shutdown
- Exemplar: `apps/api/Dockerfile` is the production reference

---
## [4][CACHE_MOUNTS]
>**Dictum:** *Cache targets vary per package manager.*

<br>

| [INDEX] | [PKG_MGR]        | [CACHE_TARGET]                              | [NOTES]                           |
| :-----: | ---------------- | ------------------------------------------- | --------------------------------- |
|   [1]   | **pnpm**         | `/pnpm/store`                               | `id=pnpm` for cross-stage sharing |
|   [2]   | **npm**          | `/root/.npm`                                |                                   |
|   [3]   | **yarn**         | `/root/.yarn/cache`                         |                                   |
|   [4]   | **bun**          | `/root/.bun/install/cache`                  |                                   |
|   [5]   | **uv**           | `/root/.cache/uv`                           | 10-100x faster than pip           |
|   [6]   | **pip**          | `/root/.cache/pip`                          | Legacy; prefer uv                 |
|   [7]   | **Go**           | `/go/pkg/mod` + `/root/.cache/go-build`     | Two mounts required               |
|   [8]   | **Maven/Gradle** | `/root/.m2` or `/root/.gradle`              |                                   |
|   [9]   | **Cargo**        | `/usr/local/cargo/registry` + `/app/target` | Two mounts required               |
|  [10]   | **apt**          | `/var/cache/apt` + `/var/lib/apt`           | `sharing=locked`                  |
|  [11]   | **apk**          | Not needed                                  | `apk add --no-cache` sufficient   |

---
## [5][FRAMEWORK_NOTES]
>**Dictum:** *Framework-specific patterns supplement the universal template.*

<br>

| [INDEX] | [FRAMEWORK]        | [KEY_PATTERNS]                                                                                                                 |
| :-----: | ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
|   [1]   | **Next.js**        | `output: 'standalone'`, copy `.next/standalone` + `.next/static` + `public`, `NEXT_TELEMETRY_DISABLED=1`, `HOSTNAME="0.0.0.0"` |
|   [2]   | **FastAPI**        | uvicorn `--host 0.0.0.0 --proxy-headers`, uv over pip                                                                          |
|   [3]   | **Spring Boot**    | Layered JAR extraction, JRE not JDK runtime, `--start-period=40s`                                                              |
|   [4]   | **Express/Effect** | pnpm monorepo pattern (section 3), `NODE_OPTIONS="--enable-source-maps"`                                                       |
|   [5]   | **Django**         | gunicorn `--bind 0.0.0.0:8000 --workers 4`, collect static in build stage                                                      |
|   [6]   | **Remix**          | `output: 'server'`, copy `build/server` + `build/client` + `public`                                                            |

---
## [6][BUILD_ORCHESTRATION]
>**Dictum:** *Bake and buildx enable multi-platform, multi-target builds.*

<br>

```hcl
variable "GIT_SHA"    { default = "unknown" }
variable "BUILD_DATE" { default = "unknown" }
variable "REGISTRY"   { default = "ghcr.io/org" }
group "default" { targets = ["api", "worker"] }
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

**Multi-platform build with attestations:**
```bash
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --sbom=true --provenance=mode=max \
    --build-arg GIT_SHA="$(git rev-parse HEAD)" \
    --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t myapp:latest --push .
```
