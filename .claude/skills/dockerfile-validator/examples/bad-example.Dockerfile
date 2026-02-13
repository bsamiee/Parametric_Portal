# =============================================================================
# Bad Example — 20 Anti-Patterns for Validation Testing
# =============================================================================
# DO NOT USE IN PRODUCTION
#
# Every anti-pattern below has a numbered tag [N] that corresponds to the
# matching best practice in good-example.Dockerfile. Use this file as a
# validation target for dockerfile-validator.
# =============================================================================

# [1] ANTI-PATTERN: :latest tag — non-reproducible builds.
#     The same tag can point to different digests on different days.
#     FIX: Pin to specific version, e.g., FROM node:24-alpine3.23
FROM ubuntu:latest

# [2] ANTI-PATTERN: No multi-stage build — build tools ship to production.
#     FIX: Separate build stage from runtime stage.

# [3] ANTI-PATTERN: Separate RUN commands — each creates an unnecessary layer.
#     FIX: Combine into single RUN with && chaining or heredoc syntax (RUN <<EOF).
RUN apt-get update
RUN apt-get install -y curl

# [4] ANTI-PATTERN: No --no-install-recommends — pulls ~100MB of unneeded packages.
#     FIX: apt-get install -y --no-install-recommends curl
RUN apt-get install -y vim

# [5] ANTI-PATTERN: No apt cache cleanup — /var/lib/apt/lists/* persists (~30MB/layer).
#     FIX: rm -rf /var/lib/apt/lists/* or use --mount=type=cache,target=/var/cache/apt
RUN apt-get install -y git

# [6] ANTI-PATTERN: Relative WORKDIR — ambiguous path resolution across stages.
#     FIX: Use absolute path, e.g., WORKDIR /app
WORKDIR app

# [7] ANTI-PATTERN: COPY . . before dependency install — invalidates dep cache on any source change.
#     FIX: Copy dependency files first (package.json, requirements.txt), install, then COPY source.
COPY . .

# [8] ANTI-PATTERN: No version pin, no --no-cache-dir — non-reproducible and wastes space.
#     FIX: pip install flask==3.1.0 --no-cache-dir or --mount=type=cache,target=/root/.cache/pip
RUN pip install flask

# [9] ANTI-PATTERN: Hardcoded secrets in ENV — visible via docker history and layer inspection.
#     FIX: Use RUN --mount=type=secret,id=api_key,env=API_KEY or inject at runtime via orchestrator.
ENV API_KEY=secret123
ENV PASSWORD=admin

# [10] ANTI-PATTERN: ARG for secrets — visible in docker history (same as ENV).
#      FIX: Use --mount=type=secret,env= for build-time secrets (BuildKit 0.14+).
ARG DATABASE_URL=postgres://admin:password@db:5432/mydb

# [11] ANTI-PATTERN: SSH port exposed — lateral movement vector in container compromise.
#      FIX: Never expose port 22. Use orchestrator exec for debugging.
EXPOSE 22
EXPOSE 80

# [12] ANTI-PATTERN: No HEALTHCHECK — orchestrators cannot detect unhealthy state.
#      FIX: HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s CMD [...]

# [13] ANTI-PATTERN: No USER directive — container runs as root (UID 0).
#      Root in container = root on host (shared kernel).
#      FIX: RUN adduser/useradd + USER 1001:1001

# [14] ANTI-PATTERN: Shell-form CMD — wraps in /bin/sh -c, PID 1 cannot receive SIGTERM.
#      FIX: Exec-form CMD ["python", "app.py"]
CMD python app.py

# [15] ANTI-PATTERN: No COPY --link — layers are coupled, any upstream change invalidates all.
#      FIX: COPY --link for layer independence.

# [16] ANTI-PATTERN: No OCI labels — image has no metadata for registry browsing or auditing.
#      FIX: LABEL org.opencontainers.image.title="..." ...

# [17] ANTI-PATTERN: No # syntax=docker/dockerfile:1 directive — BuildKit features unavailable.
#      FIX: Add # syntax=docker/dockerfile:1 as first line.

# [18] ANTI-PATTERN: No .dockerignore — entire build context (node_modules, .git, etc.) is sent.
#      FIX: Create .dockerignore excluding .git, node_modules, tests, docs, .env*, *.pem

# [19] ANTI-PATTERN: No STOPSIGNAL — relies on implicit SIGTERM which some runtimes ignore.
#      FIX: STOPSIGNAL SIGTERM (or SIGQUIT for nginx)

# [20] ANTI-PATTERN: No RUN <<EOF heredoc — backslash continuation is error-prone and noisy.
#      FIX: Use heredoc syntax for multi-line RUN commands.
