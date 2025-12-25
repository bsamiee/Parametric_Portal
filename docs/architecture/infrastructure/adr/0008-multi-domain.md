# 0008. Multi-Domain Architecture

Date: 2025-12-25
Status: Accepted

---
## Context

Monorepo will contain dozens of apps, each potentially with different root domains (e.g., `parametric-portal.com`, `parametric-icons.com`, `totally-different.io`). Centralized IngressRoute management doesn't scale.

---
## Decision

Use **per-app IngressRoutes and Middleware** stored in each app's folder.

---
## Alternatives Considered

| Option                      | Rejected Because                              |
| --------------------------- | --------------------------------------------- |
| Centralized IngressRoute    | Merge conflicts, all apps coupled in one file |
| ArgoCD env var substitution | Requires ArgoCD config changes, less portable |
| Kustomize replacements      | Complex for multi-domain, still centralized   |
| envsubst at deploy time     | Requires CMP sidecar, operational overhead    |

---
## Implementation

Each app folder contains:

```
infrastructure/apps/<app>/
├── deployment.yaml
├── service.yaml
├── ingressroute.yaml     # App-specific domain + TLS
├── middleware.yaml       # App-specific CSP + security headers
└── kustomization.yaml
```

Shared middleware (rate limiting, compression) remains in `base/shared-middleware.yaml`.

---
## Consequences

[+] Add new domain = create new folder
[+] No coupling between apps
[+] Each app owns its security headers and CSP
[+] Scales to dozens of apps without complexity increase
[+] No merge conflicts when multiple teams work on different apps
[-] Middleware duplication across apps (mitigated by shared middleware)
[-] Must remember to update app's middleware when adding new API endpoints
