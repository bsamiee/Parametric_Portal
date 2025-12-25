# syntax=docker/dockerfile:1
# --- API SERVICE DOCKERFILE ---------------------------------------------------
# Effect HTTP API with PostgreSQL, OAuth, sessions

ARG NODE_VERSION=22

# --- BASE + DEPS + BUILD ------------------------------------------------------
FROM node:${NODE_VERSION}-slim-bookworm AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY package.json ./
COPY packages/*/package.json ./packages/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

FROM deps AS build
COPY packages ./packages
COPY apps/api ./apps/api
COPY tsconfig.base.json nx.json vite.config.ts vite.factory.ts ./
RUN pnpm exec nx run @parametric-portal/api:build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm deploy --filter=@parametric-portal/api --prod /prod/api

# --- RUNTIME ------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim-bookworm AS runtime

RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser

WORKDIR /app

COPY --link --from=build --chown=appuser:appgroup /prod/api ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--enable-source-maps"
ENV API_PORT=4000

USER appuser

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/live', r => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

EXPOSE 4000

ENTRYPOINT ["node", "dist/main.js"]
