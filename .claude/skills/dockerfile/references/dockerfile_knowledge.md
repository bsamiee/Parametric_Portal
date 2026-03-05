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

| [INDEX] | [STACK]       | [BUILD_IMAGE]             | [RUNTIME_IMAGE]             |
| :-----: | ------------- | ------------------------- | --------------------------- |
|   [1]   | PNPM          | `node:24-slim-trixie`     | `node:24-slim-trixie`       |
|   [2]   | NODE          | `node:24-alpine3.23`      | `node:24-alpine3.23`        |
|   [3]   | PYTHON_UV     | `python:3.14-slim-trixie` | `python:3.14-slim-trixie`   |
|   [4]   | GO_DISTROLESS | `golang:1.26-alpine3.23`  | `distroless/static:nonroot` |
|   [5]   | JAVA          | `temurin:21-jdk-alpine`   | `temurin:21-jre-alpine`     |

**Dependency Files:**
1. `pnpm-lock.yaml pnpm-workspace.yaml`
2. `package.json package-lock.json`
3. `pyproject.toml uv.lock`
4. `go.mod go.sum`
5. `mvnw pom.xml .mvn/`

**Cache Directories:**
1. `/pnpm/store` (id=pnpm for cross-stage sharing)
2. `/root/.npm`
3. `/root/.cache/uv`
4. `/go/pkg/mod` + `/root/.cache/go-build`
5. `/root/.m2`

**Default Ports:**
1. `4000` (monorepo orchestrator)
2. `3000` (standalone)
3. `8000` (ASGI/WSGI)
4. `8080` (HTTP)
5. `8080` (Spring)

**User Creation (UID/GID 1001):**
- **PNPM/PYTHON_UV** (Debian): `groupadd -g 1001 appgroup && useradd -r -u 1001 -g appgroup -s /sbin/nologin appuser`
- **NODE/JAVA** (Alpine): `addgroup -g 1001 -S nodejs && adduser -u 1001 -S -G nodejs -s /sbin/nologin nodejs`
- **GO_DISTROLESS**: Built-in `nonroot` user (UID 65532) — no creation needed

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

| [INDEX] | [PKG_MGR]    | [CACHE_TARGET]                          |
| :-----: | ------------ | --------------------------------------- |
|   [1]   | pnpm         | `/pnpm/store`                           |
|   [2]   | npm          | `/root/.npm`                            |
|   [3]   | yarn         | `/root/.yarn/cache`                     |
|   [4]   | bun          | `/root/.bun/install/cache`              |
|   [5]   | uv           | `/root/.cache/uv`                       |
|   [6]   | pip          | `/root/.cache/pip`                      |
|   [7]   | Go           | `/go/pkg/mod` + `/root/.cache/go-build` |
|   [8]   | Maven/Gradle | `/root/.m2` or `/root/.gradle`          |
|   [9]   | Cargo        | `/usr/local/cargo/registry` + target    |
|  [10]   | apt          | `/var/cache/apt` + `/var/lib/apt`       |
|  [11]   | apk          | Not needed                              |

**Notes:**
1. pnpm: `id=pnpm` for cross-stage sharing
5. uv: 10-100x faster than pip
6. pip: Legacy; prefer uv
7. Go: Two mounts required
9. Cargo: Two mounts required (`/app/target` abbreviated above)
10. apt: Add `sharing=locked`
11. apk: `apk add --no-cache` sufficient

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
