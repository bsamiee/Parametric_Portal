#!/usr/bin/env bash
# Node.js Dockerfile generation -- sourced by generate.sh
# Produces pnpm monorepo (4-stage) or standalone (3-stage) Dockerfiles
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [DISPATCH_TABLES] --------------------------------------------------------

declare -Ar _NODEJS_VARIANT=(
    [true]=_nodejs_monorepo
    [false]=_nodejs_standalone
)

# --- [FUNCTIONS] --------------------------------------------------------------

_nodejs_monorepo() {
    local -r ver="$1" port="$2" entry="$3" scope="$4"
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
}
_nodejs_standalone() {
    local -r ver="$1" port="$2" entry="$3"
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
}

# --- [EXPORT] -----------------------------------------------------------------

_nodejs_dockerfile() {
    local -r ver="$1" port="$2" entry="$3" scope="${4:-@scope/app}" monorepo="${5:-true}"
    local -r variant="${_NODEJS_VARIANT[${monorepo}]:-_nodejs_monorepo}"
    "${variant}" "${ver}" "${port}" "${entry}" "${scope}"
}
