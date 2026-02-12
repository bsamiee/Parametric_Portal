# syntax=docker/dockerfile:1

# =============================================================================
# Python Optimized — Multi-Stage with uv + BuildKit + Heredoc
# =============================================================================
# Docker Engine 27+ | BuildKit 0.14+ | Dockerfile 1.14 | python:3.14-slim-trixie
#
# Features:
#   - Syntax directive for automatic BuildKit frontend updates
#   - Multi-stage (builder -> runtime) with minimal runtime image
#   - uv package manager for 10-100x faster installs (replaces pip)
#   - RUN --mount=type=cache for apt and uv cache persistence
#   - RUN --mount=type=secret,env= for PyPI private index tokens (no file read)
#   - RUN <<EOF heredoc syntax for multi-line scripts
#   - COPY --link + --chmod for single-layer permission setting
#   - Non-root USER with explicit UID/GID
#   - HEALTHCHECK with --start-period and --start-interval via Python stdlib
#   - STOPSIGNAL for graceful shutdown
#   - OCI annotations via LABEL with Pulumi-injectable ARGs
#   - PYTHONDONTWRITEBYTECODE + PYTHONUNBUFFERED for container optimization
# =============================================================================

# --- Pulumi-injectable build metadata ----------------------------------------
ARG GIT_SHA="unknown"
ARG BUILD_DATE="unknown"
ARG IMAGE_VERSION="0.0.0"

# --- BUILD -------------------------------------------------------------------
FROM python:3.14-slim-trixie AS builder

WORKDIR /app

# Install build dependencies with apt cache mount (no rm -rf needed)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends gcc

# Install uv for fast dependency resolution
COPY --link --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency manifests first (layer cache optimization)
COPY --link pyproject.toml uv.lock ./

# Install dependencies with uv cache mount and optional private index secret
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=secret,id=pypi_token,env=UV_EXTRA_INDEX_URL \
    uv sync --frozen --no-dev --no-install-project

# Copy source after deps (changes to source do not invalidate dep cache)
COPY --link . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- RUNTIME -----------------------------------------------------------------
FROM python:3.14-slim-trixie AS runtime

ARG GIT_SHA
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="python-app" \
      org.opencontainers.image.description="Python production container (slim-trixie)" \
      org.opencontainers.image.source="https://github.com/org/repo" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

RUN <<EOF
groupadd -r -g 1001 appuser
useradd -r -u 1001 -g appuser -d /app -s /bin/false appuser
EOF

WORKDIR /app

# Copy the virtual environment from builder (contains all deps + app)
COPY --link --from=builder --chown=1001:1001 --chmod=555 /app/.venv /app/.venv
COPY --link --chown=1001:1001 --chmod=444 . .

# Put venv on PATH (no need for `source activate`)
ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER 1001:1001

EXPOSE 8000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]

ENTRYPOINT ["python", "-m"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
