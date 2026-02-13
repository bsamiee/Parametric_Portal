# [H1][DOCKERFILE_REFERENCE]
>**Dictum:** *Validation rules and fix patterns enforce production standards.*

<br>

[IMPORTANT] Docker Engine 29.2+ | BuildKit 0.27+ | Dockerfile syntax 1 (auto-resolving) | February 2026

---
## [1][BASE_IMAGES]
>**Dictum:** *Image selection determines attack surface and size.*

<br>

| [INDEX] | [IMAGE]                                                               | [SIZE] | [SHELL] | [USE_CASE]                                        |
| :-----: | --------------------------------------------------------------------- | :----: | :-----: | ------------------------------------------------- |
|   [1]   | **`scratch`**                                                         |  0 MB  |   No    | Go/Rust static binaries -- zero attack surface.   |
|   [2]   | **`gcr.io/distroless/static-debian12:nonroot`**                       |  2 MB  |   No    | Static binaries needing ca-certs (UID 65532).     |
|   [3]   | **`gcr.io/distroless/base-debian12:nonroot`**                         | 20 MB  |   No    | Dynamic binaries needing glibc.                   |
|   [4]   | **`alpine:3.23`**                                                     |  7 MB  |   Yes   | General minimal -- musl libc (test glibc compat). |
|   [5]   | **`node:24-slim-trixie`**                                             | 80 MB  |   Yes   | Node.js (glibc, Debian 13 security).              |
|   [6]   | **`python:3.14-slim-trixie`**                                         | 50 MB  |   Yes   | Python runtime (Debian 13).                       |
|   [7]   | **`golang:1.26-alpine3.23`**                                          | 250 MB |   Yes   | Go build stage only.                              |
|   [8]   | **`eclipse-temurin:21-jre-alpine` / `eclipse-temurin:25-jre-alpine`** | 190 MB |   Yes   | Java runtime (Alpine, LTS 21 or current 25).      |
|   [9]   | **`cgr.dev/chainguard/*`**                                            | varies |   No    | Daily-rebuilt, zero CVEs, SBOM included.          |

Pin: `alpine:3.23` (good), `alpine:3.23@sha256:...` (reproducible). Never `:latest`.

Chainguard: daily rebuilds (vs Google distroless periodic), multi-layer OCI caching, FIPS variants, free at `:latest`, production requires subscription.

---
## [2][SECURITY_RULES]
>**Dictum:** *Each rule maps to a concrete fix pattern.*

<br>

| [INDEX] | [RULE]                          | [FIX]                                                                     |
| :-----: | ------------------------------- | ------------------------------------------------------------------------- |
|   [1]   | **Non-root USER required**      | `groupadd`/`useradd` + `USER 1001:1001` (or distroless `nonroot`).        |
|   [2]   | **No secrets in ENV/ARG**       | `--mount=type=secret,id=key,env=VAR` or runtime injection.                |
|   [3]   | **COPY over ADD**               | ADD auto-extracts tars + fetches URLs; use `COPY` for local files.        |
|   [4]   | **Exec-form CMD/ENTRYPOINT**    | Shell form wraps in `/bin/sh -c` -- PID 1 cannot receive signals.         |
|   [5]   | **Pipefail**                    | `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` or `set -o pipefail`.       |
|   [6]   | **No sudo**                     | Run privileged ops before `USER`, drop with `USER`.                       |
|   [7]   | **No cert bypass**              | `-k`, `--no-check-certificate`, `--trusted-host` enable MITM.             |
|   [8]   | **`--no-install-recommends`**   | Prevents apt from pulling ~100 MB suggested packages.                     |
|   [9]   | **`--chown`/`--chmod` on COPY** | `COPY --link --chown=1001:1001 --chmod=555 src dst` (single layer).       |
|  [10]   | **OCI labels**                  | `LABEL org.opencontainers.image.title="..." ...revision/created/version`. |
|  [11]   | **Non-privileged ports**        | Ports < 1024 require root capability; use 3000/8000/8080.                 |
|  [12]   | **STOPSIGNAL**                  | `STOPSIGNAL SIGTERM` (or `SIGQUIT` for nginx).                            |

---
## [3][HEALTHCHECK]
>**Dictum:** *Health probes must use exec-form with `--start-interval`.*

<br>

| [INDEX] | [APP_TYPE]            | [INTERVAL] | [TIMEOUT] | [START_PERIOD] | [START_INTERVAL] | [RETRIES] | [CHECK_METHOD]                                                      |
| :-----: | --------------------- | :--------: | :-------: | :------------: | :--------------: | :-------: | ------------------------------------------------------------------- |
|   [1]   | **Node.js API**       |    30s     |    5s     |      10s       |        2s        |     3     | `CMD ["node", "-e", "require('http').get(...)"]`                    |
|   [2]   | **Python API**        |    30s     |    5s     |      10s       |        2s        |     3     | `CMD ["python", "-c", "import urllib.request; ..."]`                |
|   [3]   | **Java (Spring)**     |    30s     |    10s    |      40s       |        5s        |     3     | `CMD ["wget", "--spider", "http://localhost:8080/actuator/health"]` |
|   [4]   | **Background worker** |    60s     |    10s    |      15s       |        5s        |     3     | Check PID file or queue connection.                                 |
|   [5]   | **Distroless**        |    N/A     |    N/A    |      N/A       |       N/A        |    N/A    | Orchestrator probes (K8s/ECS) -- no shell.                          |

`--start-interval` (Docker Engine 25+, default 5s): probing frequency during `--start-period` warmup. Set lower (2s) for fast-starting services, higher (5s) for JVM/heavy apps.

**STOPSIGNAL by application:** Node.js/Python/Go/Java = `SIGTERM`. nginx = `SIGQUIT` (graceful drain).

---
## [4][HADOLINT_RULES]
>**Dictum:** *Key hadolint rules with severity and rationale.*

<br>

| [INDEX] | [RULE]     | [SEV] | [DESCRIPTION]                                                        |
| :-----: | ---------- | :---: | -------------------------------------------------------------------- |
|   [1]   | **DL3000** | error | Absolute WORKDIR required -- relative paths ambiguous across stages. |
|   [2]   | **DL3002** | warn  | Last USER not root -- container compromise = host root.              |
|   [3]   | **DL3004** | error | No sudo -- breaks audit trail.                                       |
|   [4]   | **DL3006** | warn  | Always tag image versions -- `:latest` non-reproducible.             |
|   [5]   | **DL3007** | warn  | No `:latest` tag -- same tag, different digests.                     |
|   [6]   | **DL3008** | warn  | Pin apt-get versions -- unpinned = rebuild variance.                 |
|   [7]   | **DL3013** | warn  | Pin pip versions -- same as DL3008 for Python.                       |
|   [8]   | **DL3015** | info  | `--no-install-recommends` -- prevents ~100 MB bloat.                 |
|   [9]   | **DL3018** | warn  | Pin apk versions -- same as DL3008 for Alpine.                       |
|  [10]   | **DL3020** | error | COPY not ADD for files -- ADD has implicit extraction.               |
|  [11]   | **DL3025** | warn  | Exec-form CMD/ENTRYPOINT -- shell form breaks signal handling.       |
|  [12]   | **DL3027** | warn  | `apt-get` not `apt` -- apt is interactive frontend.                  |
|  [13]   | **DL3042** | warn  | pip: `--no-cache-dir` or `--mount=type=cache`.                       |
|  [14]   | **DL3047** | info  | HEALTHCHECK exec-form CMD -- avoid shell conditionals.               |
|  [15]   | **DL3059** | info  | Combine consecutive RUN -- each = 1 layer.                           |
|  [16]   | **DL4006** | warn  | Set pipefail -- pipe failures silently swallowed without it.         |

---
## [5][CHECKOV_POLICIES]
>**Dictum:** *CKV_DOCKER and CKV2_DOCKER policies with fix rationale.*

<br>

**CKV_DOCKER (11 policies):**

| [INDEX] | [ID]              | [DESCRIPTION]                                                    |
| :-----: | ----------------- | ---------------------------------------------------------------- |
|   [1]   | **CKV_DOCKER_1**  | No SSH port (22) -- lateral movement vector.                     |
|   [2]   | **CKV_DOCKER_2**  | HEALTHCHECK required -- orchestrators need health signal.        |
|   [3]   | **CKV_DOCKER_3**  | Non-root user created -- limits blast radius.                    |
|   [4]   | **CKV_DOCKER_4**  | COPY not ADD -- ADD has implicit extraction.                     |
|   [5]   | **CKV_DOCKER_5**  | `apt-get update` not alone -- creates stale cache layer.         |
|   [6]   | **CKV_DOCKER_6**  | LABEL not MAINTAINER -- MAINTAINER deprecated since Docker 1.13. |
|   [7]   | **CKV_DOCKER_7**  | Version tag not `:latest` -- breaks reproducibility.             |
|   [8]   | **CKV_DOCKER_8**  | Last USER not root.                                              |
|   [9]   | **CKV_DOCKER_9**  | `apt-get` not `apt` -- apt CLI unstable for scripts.             |
|  [10]   | **CKV_DOCKER_10** | Absolute WORKDIR.                                                |
|  [11]   | **CKV_DOCKER_11** | Unique FROM aliases in multi-stage.                              |

**CKV2_DOCKER (17 graph policies) -- all prevent TLS/signature bypass:**

| [INDEX] | [ID_RANGE]            | [PATTERN]                                                      |
| :-----: | --------------------- | -------------------------------------------------------------- |
|   [1]   | **CKV2_DOCKER_1**     | No `sudo`.                                                     |
|   [2]   | **CKV2_DOCKER_2-3**   | No `curl -k`, `wget --no-check-certificate`.                   |
|   [3]   | **CKV2_DOCKER_4-5**   | No `pip --trusted-host`, `PYTHONHTTPSVERIFY=0`.                |
|   [4]   | **CKV2_DOCKER_6**     | No `NODE_TLS_REJECT_UNAUTHORIZED=0`.                           |
|   [5]   | **CKV2_DOCKER_7-8**   | No `apk --allow-untrusted`, `apt-get --allow-unauthenticated`. |
|   [6]   | **CKV2_DOCKER_9-11**  | No `--nogpgcheck`, RPM validation, `--force-yes`.              |
|   [7]   | **CKV2_DOCKER_12-13** | No `NPM_CONFIG_STRICT_SSL=false`, `strict-ssl false`.          |
|   [8]   | **CKV2_DOCKER_14-16** | No `GIT_SSL_NO_VERIFY`, `sslverify=false`, `PIP_TRUSTED_HOST`. |
|   [9]   | **CKV2_DOCKER_17**    | No `chpasswd` -- passwords in layer history.                   |

Suppress: `# checkov:skip=CKV_DOCKER_2:Reason here`

---
## [6][BUILDKIT_VERSION_MATRIX]
>**Dictum:** *Feature availability gates Dockerfile syntax choices.*

<br>

| [INDEX] | [FEATURE]                            | [MIN_DOCKER] | [MIN_BUILDKIT] |  [FRONTEND]  |
| :-----: | ------------------------------------ | :----------: | :------------: | :----------: |
|   [1]   | **`# syntax=docker/dockerfile:1`**   |    18.09     |      0.6       |     Any      |
|   [2]   | **`RUN --mount=type=cache`**         |    18.09     |      0.8       |     1.2+     |
|   [3]   | **`RUN --mount=type=secret`**        |    18.09     |      0.8       |     1.2+     |
|   [4]   | **`RUN --mount=type=secret,env=`**   |     27.0     |      0.14      |    1.14+     |
|   [5]   | **`COPY --link`**                    |     23.0     |      0.8       |     1.4+     |
|   [6]   | **`COPY --chmod` (octal)**           |     23.0     |      0.8       |     1.2+     |
|   [7]   | **`COPY --chmod` (symbolic)**        |     27.0     |      0.14      |    1.14+     |
|   [8]   | **Heredoc `RUN <<EOF`**              |     23.0     |      0.10      |     1.4+     |
|   [9]   | **`FROM --platform=$BUILDPLATFORM`** |    18.09     |      0.8       |     1.2+     |
|  [10]   | **SBOM/Provenance attestations**     |     24.0     |      0.11      | N/A (buildx) |
|  [11]   | **`HEALTHCHECK --start-interval`**   |     25.0     |      N/A       |     N/A      |
