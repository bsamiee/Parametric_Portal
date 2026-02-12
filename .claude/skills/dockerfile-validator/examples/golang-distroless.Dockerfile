# syntax=docker/dockerfile:1

# =============================================================================
# Go Distroless — Multi-Stage Cross-Platform with BuildKit + Heredoc
# =============================================================================
# Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14 | golang:1.24-alpine3.22
#
# Features:
#   - Syntax directive for automatic BuildKit frontend updates
#   - Cross-compilation via BUILDPLATFORM + TARGETOS/TARGETARCH (no QEMU)
#   - Two cache mounts: /go/pkg/mod (modules) + /root/.cache/go-build (compiler)
#   - RUN --mount=type=secret,env= for private module auth (GOPRIVATE)
#   - RUN <<EOF heredoc syntax for multi-line scripts
#   - Static binary with stripped debug symbols (-ldflags='-w -s')
#   - gcr.io/distroless/static-debian12:nonroot (2MB, no shell, UID 65532)
#   - COPY --link + --chmod for single-layer artifact transfer
#   - OCI annotations via LABEL with Pulumi-injectable ARGs
#   - STOPSIGNAL for graceful shutdown
#   - Build: docker buildx build --platform linux/amd64,linux/arm64 -t app .
# =============================================================================

# --- Pulumi-injectable build metadata ----------------------------------------
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

# --- BUILD (runs on builder platform, cross-compiles for target) -------------
FROM --platform=$BUILDPLATFORM golang:1.24-alpine3.22 AS builder

ARG TARGETARCH
ARG TARGETOS

RUN apk add --no-cache git ca-certificates

WORKDIR /src

COPY --link go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download

COPY --link . .

# Cross-compile: GOOS/GOARCH set from TARGETOS/TARGETARCH build args
# -w strips DWARF, -s strips symbol table, -extldflags for static linking
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=secret,id=goprivate_token,env=GOPRIVATE_TOKEN \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build \
        -trimpath \
        -ldflags='-w -s -extldflags "-static"' \
        -o /app/server ./cmd/server

# --- RUNTIME (distroless:nonroot = UID:GID 65532:65532) ---------------------
FROM gcr.io/distroless/static-debian12:nonroot AS runtime

ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="go-service" \
      org.opencontainers.image.description="Go production container (distroless)" \
      org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

COPY --link --from=builder --chmod=555 /app/server /server

EXPOSE 8080

STOPSIGNAL SIGTERM

# HEALTHCHECK unavailable in distroless (no shell/curl) — use:
#   - Kubernetes: livenessProbe/readinessProbe with grpc/httpGet
#   - Docker Compose: healthcheck with test: ["CMD-SHELL", "..."] (requires shell image)
#   - ECS: container health check via awsvpc networking

ENTRYPOINT ["/server"]
