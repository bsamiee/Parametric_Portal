# [H1][INFRASTRUCTURE_OVERVIEW]
>**Dictum:** *Single-page reference accelerates operator orientation.*

<br>

Production-grade Kubernetes infrastructure using K3s, Kustomize, ArgoCD, and Traefik v3.

---
## [1][STACK]
>**Dictum:** *Version pinning ensures reproducible deployments.*

<br>

| [INDEX] | [LAYER]         | [TOOL]         | [VERSION]     | [RATIONALE]                                 |
| :-----: | --------------- | -------------- | ------------- | ------------------------------------------- |
|   [1]   | Orchestration   | K3s            | v1.32.11+k3s1 | Single binary, 10s startup, Traefik bundled |
|   [2]   | Ingress         | Traefik        | v3.3.5        | Auto SSL via ACME, CRD-based config         |
|   [3]   | GitOps          | ArgoCD         | v7.8.28       | Auto-sync from git, prune orphaned          |
|   [4]   | Manifests       | Kustomize      | v5.5          | Native ArgoCD, no templating language       |
|   [5]   | Secrets         | Sealed Secrets | v2.17.1       | GitOps-native, encrypted in git             |
|   [6]   | Database        | CloudNativePG  | v1.28.0       | K8s-native PostgreSQL 17, HA, S3 backup     |
|   [7]   | Pod Security    | Kyverno        | v3.6.1        | Policy engine for PSS compliance            |
|   [8]   | Task Runner     | mise           | latest        | Unified tool/env/task management            |
|   [9]   | Dev Tooling     | Nix            | 24.05         | 20 CLIs (kubectl, k9s, argocd, stern)       |
|  [10]   | Container Build | @nx/docker     | 22.3.3        | Nx-native, affected-aware builds            |
|  [11]   | Static Server   | spa-to-http    | latest        | 10MB image, Brotli, SPA mode                |
|  [12]   | Observability   | Grafana LGTM   | v3.0.1        | Mimir, Loki, Tempo, Alloy, Grafana          |
|  [13]   | Build Analytics | Nx Cloud       | -             | Remote caching, CI task analytics           |
|  [14]   | Quality         | knip, sherif   | latest        | Dead code detection, monorepo hygiene       |

<br>

### [1.1][VPS_REQUIREMENTS]

| [INDEX] | [SPEC]  | [VALUE]      |
| :-----: | ------- | ------------ |
|   [1]   | vCPU    | 2            |
|   [2]   | RAM     | 8 GB         |
|   [3]   | Storage | 100 GB NVMe  |
|   [4]   | OS      | Ubuntu 24.04 |
|   [5]   | Price   | ~$7/month    |

---
## [2][TOPOLOGY]
>**Dictum:** *Folder structure encodes deployment strategy.*

<br>

```
infrastructure/
├── base/                           # Shared resources (all environments)
│   ├── kustomization.yaml          # Base configuration
│   ├── namespace.yaml              # parametric-portal namespace
│   ├── tlsoption.yaml              # TLS 1.2+ enforcement
│   ├── networkpolicy.yaml          # 5 network isolation policies
│   ├── poddisruptionbudget.yaml    # 3 PDBs (API, Icons, Postgres)
│   └── shared-middleware.yaml      # Domain-agnostic middleware
├── apps/                           # Per-app configs (multi-domain ready)
│   ├── api/                        # Domain: api.parametric-portal.com
│   │   ├── deployment.yaml         # Node.js pod (port 4000)
│   │   ├── service.yaml            # ClusterIP service
│   │   ├── ingressroute.yaml       # App-specific routes + TLS
│   │   ├── middleware.yaml         # App-specific CSP + headers
│   │   └── kustomization.yaml
│   └── icons/                      # Domain: parametric-portal.com
│       ├── deployment.yaml         # spa-to-http pod (port 8080)
│       ├── service.yaml            # ClusterIP service
│       ├── ingressroute.yaml       # App-specific routes + TLS
│       ├── middleware.yaml         # App-specific CSP + headers
│       └── kustomization.yaml
├── overlays/
│   ├── dev/                        # Development environment
│   │   └── kustomization.yaml      # 1 replica, dev tag, debug logging
│   └── prod/                       # Production environment
│       ├── kustomization.yaml      # Imports apps, HPA patches
│       ├── hpa-api.yaml            # Autoscaling (2-10 replicas)
│       └── tlsstore.yaml           # Default certificate store
├── platform/                       # Cluster-wide infrastructure
│   ├── kyverno/                    # Security policies (PSS Restricted)
│   │   ├── policies/               # 5 ClusterPolicies
│   │   └── exceptions/             # PolicyExceptions for system components
│   └── monitoring/                 # Observability stack resources
│       ├── ingressroute.yaml       # Grafana access
│       ├── podmonitor-argocd.yaml  # Prometheus scrape targets
│       └── dashboard-*.yaml        # Grafana dashboards
└── argocd/
    ├── apps.yaml                   # ApplicationSet (per-overlay)
    ├── kyverno.yaml                # Kyverno Helm chart
    ├── kyverno-policies.yaml       # Kyverno policies from platform/
    ├── monitoring.yaml             # LGTM Helm chart
    └── monitoring-resources.yaml   # Monitoring supporting resources
```

[IMPORTANT] Multi-domain architecture: each app folder owns its IngressRoute and Middleware. Adding a new app with a different domain requires only creating a new folder in `apps/`.

---
## [3][RESOURCES]
>**Dictum:** *Resource catalog enables impact assessment.*

<br>

### [3.1][BASE_RESOURCES]

| [INDEX] | [KIND]              | [NAME]                | [PURPOSE]                       |
| :-----: | ------------------- | --------------------- | ------------------------------- |
|   [1]   | Namespace           | parametric-portal     | Workload isolation              |
|   [2]   | TLSOption           | default               | TLS 1.2-1.3 enforcement         |
|   [3]   | NetworkPolicy       | default-deny-all      | Zero-trust baseline             |
|   [4]   | NetworkPolicy       | allow-traefik-ingress | Ingress from kube-system        |
|   [5]   | NetworkPolicy       | allow-api-egress      | DNS + PostgreSQL + HTTPS + OTLP |
|   [6]   | NetworkPolicy       | allow-icons-egress    | DNS + API service egress        |
|   [7]   | NetworkPolicy       | allow-cnpg-operator   | CNPG operator → postgres        |
|   [8]   | PodDisruptionBudget | api-pdb               | Min 1 available                 |
|   [9]   | PodDisruptionBudget | icons-pdb             | Min 1 available                 |
|  [10]   | PodDisruptionBudget | postgres-pdb          | Min 1 available                 |
|  [11]   | Middleware          | rate-limit-api        | Shared: 100-200 req/s           |
|  [12]   | Middleware          | rate-limit-web        | Shared: 50-100 req/s            |
|  [13]   | Middleware          | redirect-to-https     | Shared: Force HTTPS             |
|  [14]   | Middleware          | compress              | Shared: Gzip/Brotli             |
|  [15]   | IngressRoute        | http-redirect         | Shared: HTTP → HTTPS            |

---
### [3.2][APPLICATION_RESOURCES]

Each app folder contains its own resources. Per-app ownership enables independent domains.

**API App** (`infrastructure/apps/api/`):

| [INDEX] | [KIND]       | [NAME]               | [PURPOSE]                              |
| :-----: | ------------ | -------------------- | -------------------------------------- |
|   [1]   | Deployment   | api                  | Node.js backend (port 4000)            |
|   [2]   | Service      | api                  | ClusterIP for API                      |
|   [3]   | IngressRoute | api-https            | Routes for `api.parametric-portal.com` |
|   [4]   | Middleware   | api-security-headers | API-specific security headers          |
|   [5]   | Middleware   | api-middleware-chain | Composed API middlewares               |

**Icons App** (`infrastructure/apps/icons/`):

| [INDEX] | [KIND]       | [NAME]                 | [PURPOSE]                          |
| :-----: | ------------ | ---------------------- | ---------------------------------- |
|   [1]   | Deployment   | icons                  | Static SPA server (port 8080)      |
|   [2]   | Service      | icons                  | ClusterIP for frontend             |
|   [3]   | IngressRoute | icons-https            | Routes for `parametric-portal.com` |
|   [4]   | Middleware   | icons-security-headers | CSP with app-specific connect-src  |
|   [5]   | Middleware   | icons-www-redirect     | www → apex redirect                |
|   [6]   | Middleware   | icons-middleware-chain | Composed frontend middlewares      |

---
### [3.3][PRODUCTION_RESOURCES]

| [INDEX] | [KIND]                  | [NAME]  | [PURPOSE]                  |
| :-----: | ----------------------- | ------- | -------------------------- |
|   [1]   | HorizontalPodAutoscaler | api     | 2-10 replicas, CPU/memory  |
|   [2]   | TLSStore                | default | Let's Encrypt certificates |

---
## [4][ENVIRONMENTS]
>**Dictum:** *Environment comparison reveals deployment variance.*

<br>

| [INDEX] | [ASPECT]       | [DEV]                   | [PROD]                    |
| :-----: | -------------- | ----------------------- | ------------------------- |
|   [1]   | Namespace      | `parametric-portal-dev` | `parametric-portal`       |
|   [2]   | Image Tag      | `dev`                   | `sha-XXXXXXX` (immutable) |
|   [3]   | API Replicas   | 1 (fixed)               | 2-10 (HPA managed)        |
|   [4]   | Icons Replicas | 1 (fixed)               | 2-6 (HPA managed)         |
|   [5]   | API Memory     | 512Mi limit             | 1Gi limit                 |
|   [6]   | API CPU        | 500m limit              | 1000m limit               |
|   [7]   | Ingress        | None                    | Full Traefik setup        |
|   [8]   | TLS            | None                    | Let's Encrypt auto        |
|   [9]   | Rate Limiting  | None                    | 100-200 req/s API         |
|  [10]   | Log Level      | DEBUG                   | INFO                      |

---
## [5][QUICK_REFERENCE]
>**Dictum:** *Command reference accelerates operations.*

<br>

### [5.1][MISE_TASKS]

| [INDEX] | [COMMAND]                 | [PURPOSE]                        |
| :-----: | ------------------------- | -------------------------------- |
|   [1]   | `mise run setup-k3s`      | Bootstrap cluster + ArgoCD       |
|   [2]   | `mise run seal-secret`    | Encrypt secrets for GitOps       |
|   [3]   | `mise run backup-db`      | PostgreSQL backup with retention |
|   [4]   | `mise run "k8s:build"`    | Build prod Kustomize manifests   |
|   [5]   | `mise run "k8s:validate"` | Dry-run validation               |
|   [6]   | `mise run "k8s:diff"`     | Show current vs desired state    |

---
### [5.2][URLS]

| [INDEX] | [SERVICE] | [URL]                                                       |
| :-----: | --------- | ----------------------------------------------------------- |
|   [1]   | ArgoCD UI | `kubectl port-forward svc/argocd-server -n argocd 8080:443` |
|   [2]   | Grafana   | `https://grafana.parametric-portal.com`                     |
|   [3]   | API       | `https://api.parametric-portal.com`                         |
|   [4]   | Frontend  | `https://parametric-portal.com`                             |

---
### [5.3][PORTS]

| [INDEX] | [SERVICE]     | [INTERNAL] | [EXTERNAL] |
| :-----: | ------------- | :--------: | :--------: |
|   [1]   | API           |    4000    |    443     |
|   [2]   | Icons         |    8080    |    443     |
|   [3]   | Grafana       |    3000    |    443     |
|   [4]   | PostgreSQL    |    5432    |     -      |
|   [5]   | Traefik HTTP  |    8000    |     80     |
|   [6]   | Traefik HTTPS |    8443    |    443     |

---
### [5.4][CLI_TOOLS]

| [INDEX] | [ALIAS] | [COMMAND]   | [PURPOSE]         |
| :-----: | ------- | ----------- | ----------------- |
|   [1]   | `k`     | `kubecolor` | Colorized kubectl |
|   [2]   | `k9`    | `k9s`       | Cluster TUI       |
|   [3]   | `argo`  | `argocd`    | GitOps CLI        |
|   [4]   | `klog`  | `stern`     | Multi-pod logs    |

[REFERENCE] See `docs/architecture/infrastructure/tooling.md` for full CLI reference.

---
### [5.5][CONTAINER_IMAGES]

| [INDEX] | [IMAGE]                           | [PURPOSE]    |
| :-----: | --------------------------------- | ------------ |
|   [1]   | `ghcr.io/parametric-portal/api`   | Backend API  |
|   [2]   | `ghcr.io/parametric-portal/icons` | Frontend SPA |
