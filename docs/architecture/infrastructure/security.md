# [H1][INFRASTRUCTURE_SECURITY]
>**Dictum:** *Zero-trust defaults enforce defense in depth.*

<br>

Security configuration reference for network isolation, TLS, secrets, and container hardening.

---
## [1][NETWORK]
>**Dictum:** *Explicit allow rules replace implicit trust.*

<br>

Six NetworkPolicies in base namespace implement zero-trust networking. Default deny blocks all traffic; explicit policies allow specific flows. Additional monitoring namespace policies handle observability scraping.

<br>

### [1.1][POLICIES]

| [INDEX] | [POLICY]                | [TYPE]  | [RULE]                                             |
| :-----: | ----------------------- | ------- | -------------------------------------------------- |
|   [1]   | `default-deny-all`      | Both    | Block all ingress and egress                       |
|   [2]   | `allow-traefik-ingress` | Ingress | kube-system/traefik → ports 4000, 8080             |
|   [3]   | `allow-dns-egress`      | Egress  | All pods → kube-system DNS (53/UDP, 53/TCP)        |
|   [4]   | `allow-api-egress`      | Egress  | API pod → PostgreSQL (5432) + external HTTPS (443) |
|   [5]   | `allow-icons-to-api`    | Egress  | Icons pod → API pod (4000) for client-side calls   |
|   [6]   | `allow-cnpg-operator`   | Ingress | cnpg-system → postgres pod (8000) for metrics      |

---
### [1.2][MONITORING_POLICIES]

Additional policies in monitoring namespace (`infrastructure/platform/monitoring/networkpolicy.yaml`):

| [INDEX] | [POLICY]                   | [TYPE]  | [RULE]                                      |
| :-----: | -------------------------- | ------- | ------------------------------------------- |
|   [1]   | `allow-monitoring-egress`  | Egress  | Monitoring → all namespaces for scraping    |
|   [2]   | `allow-traefik-ingress`    | Ingress | kube-system/traefik → Grafana (3000)        |
|   [3]   | `allow-alloy-otlp-ingress` | Ingress | parametric-portal → Alloy OTLP (4317, 4318) |

---
### [1.3][TRAFFIC_FLOWS]

```
Internet
    │
    ▼
Traefik (kube-system)
    │
    ├──────────────────┐
    ▼                  ▼
API (4000)         Icons (8080)
    │
    ├────────────────────────────────┐
    ▼                                ▼
PostgreSQL (5432)              External HTTPS (443)
                               - api.anthropic.com
                               - github.com (OAuth)
                               - accounts.google.com
                               - login.microsoftonline.com
```

---
### [1.4][PRIVATE_CIDR_EXCLUSION]

External HTTPS egress excludes private networks to prevent internal scanning:

| [INDEX] | [CIDR]           | [RANGE]         |
| :-----: | ---------------- | --------------- |
|   [1]   | `10.0.0.0/8`     | Class A private |
|   [2]   | `172.16.0.0/12`  | Class B private |
|   [3]   | `192.168.0.0/16` | Class C private |

---
## [2][TLS]
>**Dictum:** *Modern cipher suites resist cryptographic attacks.*

<br>

### [2.1][TLS_OPTIONS]

**File:** `infrastructure/base/tlsoption.yaml`

| [INDEX] | [SETTING]   | [VALUE] | [RATIONALE]           |
| :-----: | ----------- | ------- | --------------------- |
|   [1]   | Min Version | TLS 1.2 | PCI-DSS compliance    |
|   [2]   | Max Version | TLS 1.3 | Modern security       |
|   [3]   | SNI Strict  | true    | Prevent cert mismatch |

---
### [2.2][CIPHER_SUITES]

**TLS 1.3 (auto-negotiated):**
- `TLS_AES_256_GCM_SHA384`
- `TLS_AES_128_GCM_SHA256`
- `TLS_CHACHA20_POLY1305_SHA256`

**TLS 1.2 (ECDHE for forward secrecy):**
- `TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384`
- `TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384`
- `TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305`
- `TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305`

---
### [2.3][CURVE_PREFERENCES]

| [INDEX] | [CURVE]   | [PRIORITY] |
| :-----: | --------- | :--------: |
|   [1]   | X25519    |  Highest   |
|   [2]   | CurveP384 |   Medium   |
|   [3]   | CurveP256 |   Lowest   |

---
### [2.4][CERTIFICATE_MANAGEMENT]

**File:** `infrastructure/overlays/prod/tlsstore.yaml`

Traefik auto-provisions certificates via Let's Encrypt ACME:
- Resolver: `letsencrypt`
- Domain: `${DOMAIN}`
- SANs: `*.${DOMAIN}`
- Challenge: TLS-ALPN-01 (no DNS provider required)

---
## [3][SECRETS]
>**Dictum:** *Encrypted secrets enable GitOps without exposure.*

<br>

### [3.1][SEALED_SECRETS]

Bitnami Sealed Secrets encrypts secrets with cluster-specific key. Encrypted secrets commit to git; controller decrypts at runtime.

**Workflow:**
1. Export environment variables
2. Run `mise run seal-secret <name> <namespace>`
3. Commit `sealed-<name>.yaml` to git
4. ArgoCD syncs encrypted secret to cluster
5. Controller decrypts to native Secret

---
### [3.2][SECRET_KEYS]

**Secret Name:** `api-secrets`

| [INDEX] | [KEY]                           | [PURPOSE]                     |
| :-----: | ------------------------------- | ----------------------------- |
|   [1]   | `POSTGRES_USER`                 | Database username             |
|   [2]   | `POSTGRES_PASSWORD`             | Database password             |
|   [3]   | `ENCRYPTION_KEY`                | AES-256-GCM key (base64)      |
|   [4]   | `ANTHROPIC_API_KEY`             | AI provider credentials       |
|   [5]   | `OAUTH_GITHUB_CLIENT_ID`        | GitHub OAuth app ID           |
|   [6]   | `OAUTH_GITHUB_CLIENT_SECRET`    | GitHub OAuth app secret       |
|   [7]   | `OAUTH_GOOGLE_CLIENT_ID`        | Google OAuth client ID        |
|   [8]   | `OAUTH_GOOGLE_CLIENT_SECRET`    | Google OAuth client secret    |
|   [9]   | `OAUTH_MICROSOFT_CLIENT_ID`     | Microsoft OAuth client ID     |
|  [10]   | `OAUTH_MICROSOFT_CLIENT_SECRET` | Microsoft OAuth client secret |

---
### [3.3][SECRET_ROTATION]

[IMPORTANT] Rotation requires new SealedSecret generation:

1. Update environment variables with new values
2. Run `mise run seal-secret api-secrets parametric-portal`
3. Commit updated `sealed-api-secrets.yaml`
4. ArgoCD syncs new secret
5. Restart pods: `kubectl rollout restart deployment/api -n parametric-portal`

---
## [4][CONTAINERS]
>**Dictum:** *Minimal privileges limit blast radius.*

<br>

### [4.1][SECURITY_CONTEXT]

**File:** `infrastructure/apps/api/deployment.yaml`

| [INDEX] | [SETTING]                  | [VALUE] | [EFFECT]                    |
| :-----: | -------------------------- | ------- | --------------------------- |
|   [1]   | `runAsNonRoot`             | true    | Prevent root execution      |
|   [2]   | `runAsUser`                | 1001    | Specific non-root UID       |
|   [3]   | `allowPrivilegeEscalation` | false   | Block privilege escalation  |
|   [4]   | `readOnlyRootFilesystem`   | true    | Immutable container layer   |
|   [5]   | `capabilities.drop`        | ALL     | Remove all Linux caps       |
|   [6]   | `fsGroup` (pod)            | 1001    | Group ownership for volumes |

---
### [4.2][RESOURCE_LIMITS]

| [INDEX] | [SERVICE] | [CPU_REQ] | [CPU_LIM] | [MEM_REQ] | [MEM_LIM] |
| :-----: | --------- | :-------: | :-------: | :-------: | :-------: |
|   [1]   | API       |   100m    |   1000m   |   256Mi   |    1Gi    |
|   [2]   | Icons     |    50m    |   500m    |   64Mi    |   256Mi   |

---
### [4.3][PROBES]

| [INDEX] | [PROBE]   | [PATH]   | [INITIAL] | [PERIOD] | [TIMEOUT] |
| :-----: | --------- | -------- | :-------: | :------: | :-------: |
|   [1]   | Liveness  | `/live`  |    10s    |   30s    |    10s    |
|   [2]   | Readiness | `/ready` |    5s     |   10s    |    5s     |

---
## [5][KYVERNO]
>**Dictum:** *Policy enforcement prevents security drift.*

<br>

Kyverno v3.6.1 enforces Pod Security Standards (Restricted) via cluster-wide policies.

<br>

### [5.1][POLICIES]

| [INDEX] | [POLICY]                        | [RULE]                            | [RATIONALE]       |
| :-----: | ------------------------------- | --------------------------------- | ----------------- |
|   [1]   | `require-run-as-nonroot`        | `runAsNonRoot: true`              | PSS Restricted    |
|   [2]   | `disallow-privilege-escalation` | `allowPrivilegeEscalation: false` | PSS Restricted    |
|   [3]   | `require-ro-rootfs`             | `readOnlyRootFilesystem: true`    | Best Practice     |
|   [4]   | `require-requests-limits`       | CPU/memory limits required        | Resource fairness |
|   [5]   | `restrict-image-registries`     | Only `ghcr.io/*` allowed          | Supply chain      |

---
### [5.2][EXCEPTIONS]

| [INDEX] | [EXCEPTION]                | [SCOPE]                             | [RATIONALE]               |
| :-----: | -------------------------- | ----------------------------------- | ------------------------- |
|   [1]   | system-namespace-exception | kube-system, argocd, kyverno, cnpg  | Operators need privileges |
|   [2]   | cloudnativepg-exception    | `cnpg.io/podRole: instance` pods    | Database needs writes     |
|   [3]   | lgtm-stack-exception       | `lgtm-*`, `grafana-*` pod patterns  | LGTM needs relaxed rules  |

[REFERENCE] See `docs/architecture/infrastructure/kyverno.md` for operations guide.

---
## [6][HEADERS]
>**Dictum:** *Response headers mitigate browser-based attacks.*

<br>

Multi-domain architecture: each app defines its own security headers in `infrastructure/apps/<app>/middleware.yaml`. Shared rate limiting and compression in `infrastructure/base/shared-middleware.yaml`.

<br>

### [6.1][SECURITY_HEADERS]

| [INDEX] | [HEADER]                 | [VALUE]                            |
| :-----: | ------------------------ | ---------------------------------- |
|   [1]   | X-Frame-Options          | SAMEORIGIN (frontend) / DENY (API) |
|   [2]   | X-Content-Type-Options   | nosniff                            |
|   [3]   | X-XSS-Protection         | 1; mode=block                      |
|   [4]   | Referrer-Policy          | strict-origin-when-cross-origin    |
|   [5]   | X-Robots-Tag             | noindex, nofollow                  |
|   [6]   | X-Download-Options       | noopen                             |
|   [7]   | X-Permitted-Cross-Domain | none                               |

---
### [6.2][HSTS]

| [INDEX] | [SETTING]            | [VALUE]  |
| :-----: | -------------------- | -------- |
|   [1]   | stsSeconds           | 31536000 |
|   [2]   | stsIncludeSubdomains | true     |
|   [3]   | stsPreload           | true     |
|   [4]   | forceSTSHeader       | true     |

---
### [6.3][CONTENT_SECURITY_POLICY]

CSP is **per-app** to allow app-specific API connections via `connect-src`.

**Icons App** (`infrastructure/apps/icons/middleware.yaml`):

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' https://api.parametric-portal.com https://api.anthropic.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
```

[IMPORTANT] Each app's CSP `connect-src` must include its API domain. New apps define their own CSP in their middleware.yaml.

---
### [6.4][PERMISSIONS_POLICY]

All browser APIs disabled:
- accelerometer, camera, geolocation, gyroscope
- magnetometer, microphone, payment, usb

---
### [6.5][RATE_LIMITING]

Shared middleware in `infrastructure/base/shared-middleware.yaml`:

| [INDEX] | [MIDDLEWARE]     | [AVERAGE] | [BURST] | [SCOPE]       |
| :-----: | ---------------- | :-------: | :-----: | ------------- |
|   [1]   | `rate-limit-api` |   100/s   |   200   | API endpoints |
|   [2]   | `rate-limit-web` |   50/s    |   100   | Static assets |

[IMPORTANT] Rate limits use client IP with depth=1 (first X-Forwarded-For hop). Private CIDRs excluded from API limiter.

---
### [6.6][MIDDLEWARE_CHAINS]

Each app composes its middleware chain referencing shared + app-specific middleware:

**API Chain** (`infrastructure/apps/api/middleware.yaml`):
1. `base-security-headers` (shared)
2. `api-security-headers` (app-specific: frameDeny)
3. `rate-limit-api` (shared)
4. `compress` (shared)

**Icons Chain** (`infrastructure/apps/icons/middleware.yaml`):
1. `base-security-headers` (shared)
2. `icons-security-headers` (app-specific: CSP, permissions)
3. `rate-limit-web` (shared)
4. `icons-www-redirect` (app-specific)
5. `compress` (shared)

**Grafana Chain** (`infrastructure/platform/monitoring/ingressroute.yaml`):
1. `grafana-security-headers` (monitoring-specific)
2. `compress` (shared)
