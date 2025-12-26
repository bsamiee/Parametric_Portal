# syntax=docker/dockerfile:1
# --- FRONTEND SERVICE DOCKERFILE ----------------------------------------------
# React 19 SPA served via spa-to-http (10MB, zero-config, built-in Brotli)

ARG NODE_VERSION=22

# --- BASE + DEPS + BUILD ------------------------------------------------------
FROM node:${NODE_VERSION}-slim-bookworm AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates=20230311* \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY package.json ./
COPY packages/*/package.json ./packages/
COPY apps/parametric_icons/package.json ./apps/parametric_icons/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY packages ./packages
COPY apps/parametric_icons ./apps/parametric_icons
COPY apps/api/src/contracts ./apps/api/src/contracts
COPY tsconfig.base.json nx.json vite.config.ts vite.factory.ts ./
RUN pnpm exec nx run @parametric-portal/parametric-icons:build

# --- RUNTIME (spa-to-http) ----------------------------------------------------
FROM devforth/spa-to-http@sha256:f6e18f2ae51fd95f7f53808d8f4dad2e0ee874b70ae83fc79c872da89d2ddeb7 AS runtime
WORKDIR /code

COPY --link --from=build /app/apps/parametric_icons/dist .

ENV ADDRESS=0.0.0.0
ENV PORT=8080
ENV SPA_MODE=true
ENV BROTLI=true
ENV GZIP=true
ENV THRESHOLD=1024
ENV CACHE_MAX_AGE=604800
ENV LOGGER=true
ENV LOG_PRETTY=false
ENV CACHE=true
ENV CACHE_BUFFER=51200

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/', r => process.exit(r.statusCode < 400 ? 0 : 1))" || exit 1

EXPOSE 8080
