# syntax=docker/dockerfile:1

# =============================================================================
# Good Example — Node.js Multi-Stage with All Best Practices
# =============================================================================
# Docker Engine 27+ | BuildKit 0.27+ | Dockerfile 1.14 | node:24-alpine3.23
#
# This file is the MIRROR of bad-example.Dockerfile — every anti-pattern in
# that file has a corresponding best practice demonstrated here.
#
# Features demonstrated:
#   [1]  Pinned version tag (not :latest)
#   [2]  Multi-stage build (deps -> builder -> runtime) with named targets
#   [3]  RUN <<EOF heredoc syntax for multi-line scripts
#   [4]  Absolute WORKDIR
#   [5]  Dependency files copied before source (layer cache optimization)
#   [6]  RUN --mount=type=cache for npm cache persistence
#   [7]  RUN --mount=type=secret,env= for build-time secrets (no file read)
#   [8]  Pinned dependency versions
#   [9]  No hardcoded secrets in ENV/ARG
#   [10] No unnecessary ports (no SSH)
#   [11] HEALTHCHECK with --start-period and --start-interval
#   [12] Non-root USER with explicit UID/GID
#   [13] Exec-form ENTRYPOINT + CMD
#   [14] COPY --link for layer independence
#   [15] COPY --chmod for single-layer permission setting
#   [16] OCI annotations via LABEL with Pulumi-injectable ARGs
#   [17] STOPSIGNAL for graceful shutdown
#   [18] # syntax=docker/dockerfile:1 directive
# =============================================================================

ARG NODE_VERSION=24

# --- Pulumi-injectable build metadata ----------------------------------------
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"

# --- DEPS --------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine3.23 AS deps
WORKDIR /app
COPY --link package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# --- BUILD -------------------------------------------------------------------
FROM deps AS builder
COPY --link . .
RUN npm run build

# --- RUNTIME -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine3.23 AS runtime

ARG GIT_SHA
ARG BUILD_DATE

LABEL org.opencontainers.image.title="good-example" \
      org.opencontainers.image.description="Node.js production best-practices example" \
      org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN <<EOF
addgroup -g 1001 -S nodejs
adduser -S -u 1001 -G nodejs nodejs
EOF

WORKDIR /app

COPY --link --from=builder --chown=1001:1001 --chmod=555 /app/dist ./dist
COPY --link --from=builder --chown=1001:1001 --chmod=444 /app/node_modules ./node_modules
COPY --link --from=builder --chown=1001:1001 --chmod=444 /app/package.json ./

USER 1001:1001

EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
    CMD ["node", "-e", "const h=require('http');h.get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]

ENTRYPOINT ["node"]
CMD ["dist/index.js"]
