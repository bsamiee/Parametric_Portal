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
|   [2]   | Storage         | Longhorn       | v1.8.3        | Distributed, 3-replica, ReadWriteMany       |
|   [3]   | Ingress         | Traefik        | v3.3.5        | Auto SSL via ACME, CRD-based config         |
|   [4]   | TLS             | cert-manager   | v1.16.3       | DNS-01 challenge, wildcard certs, BYOD      |
|   [5]   | GitOps          | ArgoCD         | v7.8.28       | Auto-sync from git, prune orphaned          |
|   [6]   | Manifests       | Kustomize      | v5.5          | Native ArgoCD, no templating language       |
|   [7]   | Secrets         | Sealed Secrets | v2.17.1       | GitOps-native, encrypted in git             |
|   [8]   | Database        | CloudNativePG  | v0.22.1       | Operator for PostgreSQL 17, quorum failover |
|   [9]   | Object Storage  | MinIO Operator | v6.0.5        | S3-compatible, distributed mode             |
|  [10]   | Cache           | Redis          | v20.6.0       | Sentinel HA, replication mode               |
|  [11]   | Pod Security    | Kyverno        | v3.6.1        | Policy engine, 5 policies enforced          |
|  [12]   | Observability   | Grafana LGTM   | v3.0.1        | Mimir, Loki, Tempo, Alloy, Grafana          |
|  [13]   | Metrics         | metrics-server | v3.13.0       | HPA resource metrics, 2 replicas            |
|  [14]   | Task Runner     | mise           | latest        | Unified tool/env/task management            |
|  [15]   | Dev Tooling     | Nix            | 24.05         | 20 CLIs (kubectl, k9s, argocd, stern)       |
|  [16]   | Container Build | @nx/docker     | 22.3.3        | Nx-native, affected-aware builds            |
|  [17]   | Static Server   | spa-to-http    | latest        | 10MB image, Brotli, SPA mode                |
|  [18]   | Build Analytics | Nx Cloud       | -             | Remote caching, CI task analytics           |
|  [19]   | Quality         | knip, sherif   | latest        | Dead code detection, monorepo hygiene       |

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
├── argocd/                         # ArgoCD Applications (15 files)
│   ├── appproject.yaml            # Platform RBAC (source repos, namespaces)
│   ├── apps.yaml                  # Projects ApplicationSet (Git discovery)
│   ├── longhorn.yaml              # Storage CSI (sync-wave: -2)
│   ├── cert-manager.yaml          # TLS operator (sync-wave: -1)
│   ├── cloudnativepg.yaml         # PostgreSQL operator (sync-wave: -1)
│   ├── metrics-server.yaml        # HPA metrics (sync-wave: 0)
│   ├── redis.yaml                 # Caching layer (sync-wave: 0)
│   ├── minio-operator.yaml        # Object storage operator (sync-wave: 0)
│   ├── kyverno.yaml               # Policy engine (sync-wave: 0)
│   ├── minio-resources.yaml       # MinIO tenant (sync-wave: 1)
│   ├── kyverno-policies.yaml      # Policy definitions (sync-wave: 1)
│   ├── monitoring.yaml            # LGTM stack (sync-wave: 1)
│   └── monitoring-resources.yaml  # PodMonitors + dashboards (sync-wave: 1)
├── platform/                       # Shared platform services (6 folders)
│   ├── base/                      # Core namespace resources (8 files)
│   │   ├── namespace.yaml         # parametric-portal namespace
│   │   ├── rbac.yaml              # ServiceAccounts, Roles
│   │   ├── resourcequota.yaml     # 50 pods, 8 CPU, 16Gi memory
│   │   ├── networkpolicy.yaml     # 6 policies (deny-all + allows)
│   │   ├── poddisruptionbudget.yaml # 3 PDBs (API, Icons, Postgres)
│   │   ├── tlsoption.yaml         # TLS 1.2-1.3, ECDHE ciphers
│   │   ├── shared-middleware.yaml # Security headers, rate limiting
│   │   └── kustomization.yaml
│   ├── postgres/                  # CloudNativePG cluster (5 files)
│   │   ├── cluster.yaml           # 3-instance HA, quorum failover
│   │   ├── pooler.yaml            # PgBouncer connection pooling
│   │   ├── backup-objectstore.yaml # On-demand S3 backups
│   │   ├── scheduled-backup.yaml  # Daily backups, 7d retention
│   │   └── secret-s3.yaml         # S3 credentials template
│   ├── cert-manager/              # TLS automation (4 files)
│   │   ├── clusterissuer-clouddns.yaml # Google Cloud DNS
│   │   ├── clusterissuer-azuredns.yaml # Azure DNS
│   │   ├── kustomization.yaml
│   │   └── README.md
│   ├── minio/                     # Object storage (2 files)
│   │   ├── tenant.yaml            # 4-server MinIO cluster
│   │   └── kustomization.yaml
│   ├── kyverno/                   # Policy engine (3 folders)
│   │   ├── policies/              # 5 ClusterPolicies (PSS)
│   │   ├── exceptions/            # System + CNPG exceptions
│   │   └── kustomization.yaml
│   └── monitoring/                # LGTM stack resources (20 files)
│       ├── podmonitor-*.yaml      # 13 PodMonitors (all services)
│       ├── dashboard-*.yaml       # 6 Grafana dashboards
│       ├── prometheusrules.yaml   # 9 alert rules
│       ├── networkpolicy.yaml     # Monitoring egress/ingress
│       └── ingressroute.yaml      # Grafana HTTPS access
└── projects/                       # Project instances
    ├── _template/                 # Project template + README
    │   └── parametric-portal/     # Template structure
    │       ├── base/              # PROJECT.yaml, domains, certificate
    │       ├── apps/              # Application deployments
    │       └── overlays/          # Dev + prod environments
    └── parametric-portal/          # First project (API + Icons)
        ├── base/
        │   ├── PROJECT.yaml       # Project metadata
        │   ├── domains.yaml       # Domain configuration
        │   ├── certificate.yaml   # TLS certificate
        │   └── kustomization.yaml
        ├── apps/
        │   ├── api/               # Backend (6 files)
        │   └── icons/             # Frontend (5 files)
        └── overlays/
            ├── dev/               # Development (1 replica)
            └── prod/              # Production (HPA, hard anti-affinity)
```

[IMPORTANT] Multi-project platform: teams copy `_template/` to create new projects with isolated namespaces, custom domains, and shared platform services (PostgreSQL, MinIO, Redis).

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
