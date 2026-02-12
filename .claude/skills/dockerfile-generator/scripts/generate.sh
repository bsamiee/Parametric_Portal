#!/usr/bin/env bash
# Unified Dockerfile/dockerignore generator -- pnpm monorepo aware
# BuildKit heredoc + secret env mount + STOPSIGNAL + Pulumi-injectable ARGs
set -Eeuo pipefail
shopt -s inherit_errexit

# --- [CONSTANTS] --------------------------------------------------------------
declare -Ar _DEFAULTS=(
    [nodejs_version]=24     [nodejs_port]=3000   [nodejs_entry]=dist/main.js
    [python_version]=3.14   [python_port]=8000   [python_entry]=app.py
    [golang_version]=1.24   [golang_port]=8080   [golang_binary]=app     [golang_base]=distroless
    [java_version]=21       [java_port]=8080     [java_tool]=maven
)

declare -Ar _DOCKERIGNORE_PATTERNS=(
    [nodejs]="node_modules/ .npm .yarn .pnp.* .pnpm-store dist/ build/ npm-debug.log* pnpm-debug.log* yarn-debug.log* yarn-error.log*"
    [python]="__pycache__/ *.py[cod] *\$py.class *.so .Python venv/ .venv/ .pytest_cache/ .tox/ *.egg-info/ dist/ build/ .mypy_cache/ .ruff_cache/"
    [golang]="vendor/ *.exe *.test *.out go.work go.work.sum"
    [java]="target/ *.class *.jar *.war *.ear .gradle/ build/ .mvn/ !.mvn/wrapper/maven-wrapper.jar"
    [generic]="dist/ build/ target/ out/"
)

declare -Ar _JAR_PATHS=(
    [maven]="target/app.jar"
    [gradle]="build/libs/app.jar"
)

# --- [TEMPLATES] --------------------------------------------------------------
_nodejs_dockerfile() {
    local -r ver="$1" port="$2" entry="$3" scope="${4:-@scope/app}" monorepo="${5:-true}"
    case "${monorepo}" in
        true)
            cat <<EOF
# syntax=docker/dockerfile:1
# --- BASE + DEPS + BUILD ------------------------------------------------------
ARG NODE_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

FROM node:\${NODE_VERSION}-slim-trixie AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="\$PNPM_HOME:\$PATH"
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
    --mount=type=cache,target=/var/lib/apt,sharing=locked \\
    apt-get update && apt-get install -y --no-install-recommends ca-certificates \\
    && corepack enable
WORKDIR /app

FROM base AS deps
COPY --link pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY --link package.json ./
COPY --link packages/*/package.json ./packages/
COPY --link apps/*/package.json ./apps/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline --ignore-scripts

FROM deps AS build
COPY --link packages ./packages
COPY --link apps ./apps
COPY --link tsconfig.base.json nx.json ./
RUN pnpm exec nx run ${scope}:build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \\
    pnpm deploy --filter=${scope} --prod /prod/app

# --- RUNTIME ------------------------------------------------------------------
FROM node:\${NODE_VERSION}-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="${scope}" \\
      org.opencontainers.image.source="https://github.com/org/repo" \\
      org.opencontainers.image.licenses="MIT" \\
      org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}" \\
      org.opencontainers.image.version="\${IMAGE_VERSION}"

RUN <<SHELL
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
SHELL
WORKDIR /app
COPY --link --from=build --chown=1001:1001 --chmod=555 /prod/app ./
ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"
ENV APP_PORT=${port}
USER 1001:1001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --start-interval=2s --retries=3 \\
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:${port}/live',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
EXPOSE ${port}
ENTRYPOINT ["node", "${entry}"]
EOF
            ;;
        *)
            cat <<EOF
# syntax=docker/dockerfile:1
ARG NODE_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

FROM node:\${NODE_VERSION}-slim-trixie AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="\$PNPM_HOME:\$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY --link pnpm-lock.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --prod

FROM base AS build
COPY --link pnpm-lock.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts
COPY --link . .
RUN pnpm run build

FROM node:\${NODE_VERSION}-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE

LABEL org.opencontainers.image.source="https://github.com/org/repo" \\
      org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}"

RUN <<SHELL
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
SHELL
WORKDIR /app
COPY --link --from=deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --link --from=build --chown=1001:1001 --chmod=555 /app/dist ./dist
COPY --link --from=build --chown=1001:1001 /app/package.json ./
ENV NODE_ENV=production
USER 1001:1001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --start-interval=2s --retries=3 \\
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:${port}/live',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
EXPOSE ${port}
ENTRYPOINT ["node", "${entry}"]
EOF
            ;;
    esac
}

_python_dockerfile() {
    local -r ver="$1" port="$2" entry="$3"
    cat <<EOF
# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

FROM python:\${PYTHON_VERSION}-slim-trixie AS builder
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\
    --mount=type=cache,target=/var/lib/apt,sharing=locked \\
    apt-get update && apt-get install -y --no-install-recommends gcc
COPY --link --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
COPY --link pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \\
    --mount=type=secret,id=pypi_token,env=UV_EXTRA_INDEX_URL \\
    uv sync --frozen --no-dev --no-install-project
COPY --link . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:\${PYTHON_VERSION}-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE

LABEL org.opencontainers.image.source="https://github.com/org/repo" \\
      org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}"

RUN <<SHELL
groupadd -r -g 1001 appuser
useradd -r -u 1001 -g appuser -d /app -s /bin/false appuser
SHELL
WORKDIR /app
COPY --link --from=builder --chown=1001:1001 --chmod=555 /app/.venv /app/.venv
COPY --link --chown=1001:1001 --chmod=444 . .
ENV PATH="/app/.venv/bin:\$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
USER 1001:1001
EXPOSE ${port}
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --start-interval=2s --retries=3 \\
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:${port}/health').read()"]
ENTRYPOINT ["python", "-m"]
CMD ["uvicorn", "${entry%.py}:app", "--host", "0.0.0.0", "--port", "${port}"]
EOF
}

_golang_dockerfile() {
    local -r ver="$1" port="$2" binary="$3" base="${4:-distroless}"
    cat <<EOF
# syntax=docker/dockerfile:1
ARG GO_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

FROM --platform=\$BUILDPLATFORM golang:\${GO_VERSION}-alpine3.22 AS builder
ARG TARGETARCH TARGETOS
WORKDIR /app
COPY --link go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    go mod download
COPY --link . .
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    --mount=type=secret,id=goprivate_token,env=GOPRIVATE_TOKEN \\
    CGO_ENABLED=0 GOOS=\${TARGETOS} GOARCH=\${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /${binary} .
EOF
    case "${base}" in
        distroless)
            cat <<EOF

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION
LABEL org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}" \\
      org.opencontainers.image.version="\${IMAGE_VERSION}"
COPY --link --from=builder --chmod=555 /${binary} /${binary}
USER nonroot:nonroot
EXPOSE ${port}
STOPSIGNAL SIGTERM
ENTRYPOINT ["/${binary}"]
EOF
            ;;
        scratch)
            cat <<EOF

FROM scratch AS runtime
COPY --link --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --link --from=builder --chmod=555 /${binary} /${binary}
USER 65532:65532
EXPOSE ${port}
STOPSIGNAL SIGTERM
ENTRYPOINT ["/${binary}"]
EOF
            ;;
        *)
            cat <<EOF

FROM alpine:3.22 AS runtime
ARG GIT_SHA
ARG BUILD_DATE
LABEL org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}"
RUN <<SHELL
apk --no-cache add ca-certificates
addgroup -g 1001 -S appgroup
adduser -S appuser -u 1001 -G appgroup
SHELL
WORKDIR /app
COPY --link --from=builder --chmod=555 /${binary} /app/${binary}
USER appuser
EXPOSE ${port}
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --start-interval=2s --retries=3 \\
    CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:${port}/health"]
ENTRYPOINT ["/app/${binary}"]
EOF
            ;;
    esac
}

_java_dockerfile() {
    local -r ver="$1" port="$2" tool="${3:-maven}"
    cat <<EOF
# syntax=docker/dockerfile:1
ARG JAVA_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

FROM eclipse-temurin:\${JAVA_VERSION}-jdk-alpine AS builder
WORKDIR /app
EOF
    case "${tool}" in
        maven)
            cat <<EOF
COPY --link mvnw pom.xml ./
COPY --link .mvn .mvn
RUN --mount=type=cache,target=/root/.m2 ./mvnw dependency:go-offline
COPY --link src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw clean package -DskipTests && mv target/*.jar target/app.jar
EOF
            ;;
        *)
            cat <<EOF
COPY --link gradlew ./
COPY --link gradle gradle
COPY --link build.gradle settings.gradle ./
RUN --mount=type=cache,target=/root/.gradle ./gradlew dependencies --no-daemon
COPY --link src ./src
RUN --mount=type=cache,target=/root/.gradle ./gradlew build -x test --no-daemon && mv build/libs/*.jar build/libs/app.jar
EOF
            ;;
    esac
    local -r jar_path="${_JAR_PATHS[${tool}]:-build/libs/app.jar}"
    cat <<EOF

FROM eclipse-temurin:\${JAVA_VERSION}-jre-alpine AS runtime

ARG GIT_SHA
ARG BUILD_DATE

LABEL org.opencontainers.image.revision="\${GIT_SHA}" \\
      org.opencontainers.image.created="\${BUILD_DATE}"

RUN <<SHELL
addgroup -g 1001 -S appgroup
adduser -S appuser -u 1001 -G appgroup
SHELL
WORKDIR /app
COPY --link --from=builder --chown=appuser:appgroup --chmod=555 /app/${jar_path} ./app.jar
USER appuser
EXPOSE ${port}
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --start-interval=5s --retries=3 \\
    CMD ["wget", "--spider", "-q", "http://localhost:${port}/actuator/health"]
ENTRYPOINT ["java", "-jar", "app.jar"]
EOF
}

_dockerignore() {
    local -r lang="${1:-generic}"
    cat <<'BASE'
# Version control
.git
.gitignore
.gitattributes
.gitmodules

# CI/CD
.github
.gitlab-ci.yml
.circleci
Jenkinsfile

# Documentation
*.md
docs/
LICENSE

# Docker (prevent recursive context)
Dockerfile*
.dockerignore
docker-compose*.yml
docker-bake.hcl

# Environment / Secrets
.env
.env.*
*.local
.envrc
*.pem
*.key
*.crt
credentials.json

# Logs
logs/
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store

# Testing
coverage/
.coverage
test-results/
.pytest_cache/
.tox/
playwright-report/
stryker.config.*

# Build artifacts
*.tsbuildinfo

# Monorepo tooling
.nx/cache
.nx/workspace-data
.vite
.turbo/

# Infrastructure / AI tooling
infrastructure/
pulumi/
.pulumi/
.claude/
.planning/
CLAUDE.md
BASE
    local -r patterns="${_DOCKERIGNORE_PATTERNS[${lang}]:-}"
    [[ -n "${patterns}" ]] && printf '\n# %s\n%s\n' "${lang}" "${patterns}"
}

# --- [USAGE] ------------------------------------------------------------------
_usage() {
    printf '%s\n' \
        "Usage: $0 <language> [OPTIONS]" \
        "Languages: nodejs, python, golang, java, dockerignore" \
        "Options: -v VERSION  -p PORT  -o OUTPUT  -e ENTRY  -s SCOPE (monorepo)" \
        "         -t TOOL (maven|gradle)  --distroless|--scratch|--alpine (Go)" \
        "         --standalone (Node.js without monorepo)  -l LANG (dockerignore)"
    exit "${1:-0}"
}

# --- [LANG_DISPATCH] ---------------------------------------------------------
declare -Ar _LANG_GENERATORS=(
    [nodejs]=_nodejs_dockerfile
    [python]=_python_dockerfile
    [golang]=_golang_dockerfile
    [java]=_java_dockerfile
)

# --- [MAIN] -------------------------------------------------------------------
main() {
    [[ $# -lt 1 ]] && _usage 1
    local lang="$1"; shift
    local version="" port="" output="Dockerfile" entry="" scope="" tool="" base="" monorepo="true"

    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--version)    version="$2"; shift 2 ;;
            -p|--port)       port="$2"; shift 2 ;;
            -o|--output)     output="$2"; shift 2 ;;
            -e|--entry)      entry="$2"; shift 2 ;;
            -s|--scope)      scope="$2"; shift 2 ;;
            -t|--tool)       tool="$2"; shift 2 ;;
            -l|--language)   lang="$2"; shift 2 ;;
            --distroless)    base="distroless"; shift ;;
            --scratch)       base="scratch"; shift ;;
            --alpine)        base="alpine"; shift ;;
            --standalone)    monorepo="false"; shift ;;
            -h|--help)       _usage 0 ;;
            *)               printf 'Unknown: %s\n' "$1"; _usage 1 ;;
        esac
    done

    case "${lang}" in
        dockerignore)
            output="${output:-.dockerignore}"; _dockerignore "${entry:-generic}" > "${output}"
            printf '[OK] Generated: %s (%s)\n' "${output}" "${lang}"; return ;;
    esac

    local -r generator="${_LANG_GENERATORS[${lang}]:-}"
    [[ -n "${generator}" ]] || { printf 'Unknown language: %s\n' "${lang}"; _usage 1; }

    case "${lang}" in
        nodejs)
            "${generator}" \
                "${version:-${_DEFAULTS[nodejs_version]}}" \
                "${port:-${_DEFAULTS[nodejs_port]}}" \
                "${entry:-${_DEFAULTS[nodejs_entry]}}" \
                "${scope:-@scope/app}" \
                "${monorepo}" > "${output}" ;;
        python)
            "${generator}" \
                "${version:-${_DEFAULTS[python_version]}}" \
                "${port:-${_DEFAULTS[python_port]}}" \
                "${entry:-${_DEFAULTS[python_entry]}}" > "${output}" ;;
        golang)
            "${generator}" \
                "${version:-${_DEFAULTS[golang_version]}}" \
                "${port:-${_DEFAULTS[golang_port]}}" \
                "${entry:-${_DEFAULTS[golang_binary]}}" \
                "${base:-${_DEFAULTS[golang_base]}}" > "${output}" ;;
        java)
            "${generator}" \
                "${version:-${_DEFAULTS[java_version]}}" \
                "${port:-${_DEFAULTS[java_port]}}" \
                "${tool:-${_DEFAULTS[java_tool]}}" > "${output}" ;;
    esac
    printf '[OK] Generated: %s (%s)\n' "${output}" "${lang}"
}

main "$@"
