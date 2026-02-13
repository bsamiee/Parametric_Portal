#!/usr/bin/env bash
# Go Dockerfile generation -- sourced by generate.sh
# Produces cross-compiled binary with distroless/scratch/alpine runtime
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [DISPATCH_TABLES] --------------------------------------------------------

declare -Ar _GO_RUNTIME_EMITTERS=(
    [distroless]=_golang_runtime_distroless
    [scratch]=_golang_runtime_scratch
    [alpine]=_golang_runtime_alpine
)

# --- [FUNCTIONS] --------------------------------------------------------------

_golang_builder() {
    local -r ver="$1" binary="$2"
    cat <<EOF
# syntax=docker/dockerfile:1
ARG GO_VERSION=${ver}
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"
FROM --platform=\$BUILDPLATFORM golang:\${GO_VERSION}-alpine3.23 AS builder
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
}
_golang_runtime_distroless() {
    local -r port="$1" binary="$2"
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
}
_golang_runtime_scratch() {
    local -r port="$1" binary="$2"
    cat <<EOF
FROM scratch AS runtime
COPY --link --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --link --from=builder --chmod=555 /${binary} /${binary}
USER 65532:65532
EXPOSE ${port}
STOPSIGNAL SIGTERM
ENTRYPOINT ["/${binary}"]
EOF
}
_golang_runtime_alpine() {
    local -r port="$1" binary="$2"
    cat <<EOF
FROM alpine:3.23 AS runtime
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
}

# --- [EXPORT] -----------------------------------------------------------------

_golang_dockerfile() {
    local -r ver="$1" port="$2" binary="$3" base="${4:-distroless}"
    _golang_builder "${ver}" "${binary}"
    local -r emitter="${_GO_RUNTIME_EMITTERS[${base}]:-_golang_runtime_distroless}"
    "${emitter}" "${port}" "${binary}"
}
