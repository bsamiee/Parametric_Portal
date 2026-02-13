#!/usr/bin/env bash
# Python Dockerfile generation -- sourced by generate.sh
# Produces uv-based 2-stage Dockerfile with secret mount support
set -Eeuo pipefail
shopt -s inherit_errexit
IFS=$'\n\t'

# --- [EXPORT] -----------------------------------------------------------------

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
COPY --link --from=ghcr.io/astral-sh/uv:0.6.2 /uv /usr/local/bin/uv
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
