# syntax=docker/dockerfile:1

# =============================================================================
# Next.js Production Dockerfile — Multi-Stage with BuildKit + Heredoc
# =============================================================================
# Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14 | node:24-slim-trixie
#
# Features:
#   - Syntax directive for automatic BuildKit frontend updates
#   - Multi-stage (base -> deps -> builder -> runtime) with named targets
#   - COPY --link for layer independence and parallel execution
#   - COPY --chmod to set permissions without extra RUN layer
#   - RUN --mount=type=cache for pnpm store persistence
#   - RUN --mount=type=secret,env= for build-time secrets (no file needed)
#   - RUN <<EOF heredoc syntax for multi-line scripts
#   - HEALTHCHECK with --start-period and --start-interval for SSR warmup
#   - STOPSIGNAL for graceful shutdown
#   - Non-root USER with explicit UID/GID
#   - OCI annotations via LABEL (org.opencontainers.image.*)
#   - Pulumi-injectable ARGs for CI/CD parameterization
#   - Multi-platform ready (linux/amd64, linux/arm64)
# =============================================================================

ARG NODE_VERSION=24

# --- Pulumi-injectable build metadata ----------------------------------------
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

# --- BASE --------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim-trixie AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- DEPS --------------------------------------------------------------------
FROM base AS deps
COPY --link pnpm-lock.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# --- BUILD -------------------------------------------------------------------
FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --link . .
# Mount SENTRY_AUTH_TOKEN as env var (BuildKit 0.14+, no file read needed)
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    pnpm run build

# --- RUNTIME -----------------------------------------------------------------
FROM node:${NODE_VERSION}-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="nextjs-app" \
      org.opencontainers.image.description="Next.js production container" \
      org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"

RUN <<EOF
groupadd -g 1001 appgroup
useradd -u 1001 -g appgroup -m -d /app -s /bin/false nextjs
EOF

COPY --link --from=builder --chown=1001:1001 --chmod=555 /app/.next/standalone ./
COPY --link --from=builder --chown=1001:1001 --chmod=444 /app/.next/static ./.next/static
COPY --link --from=builder --chown=1001:1001 --chmod=444 /app/public ./public

USER 1001:1001

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=2s --retries=3 \
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:3000',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]

ENTRYPOINT ["node", "server.js"]
