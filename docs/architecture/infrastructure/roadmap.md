# [H1][INFRASTRUCTURE_ROADMAP]
>**Dictum:** *Staged evolution prevents premature optimization.*

<br>

Scaling path from single-node MVP to high-availability production cluster.

---
## [1][CURRENT_STATE]

| [ASPECT]      | [VALUE]                                |
| ------------- | -------------------------------------- |
| Nodes         | 1 (control + worker)                   |
| Orchestration | K3s v1.32.11                           |
| Storage       | Longhorn v1.8.3 (distributed)          |
| Database      | CloudNativePG v0.22.1, PostgreSQL 17   |
| Object Storage| MinIO Operator v6.0.5                  |
| Cache         | Redis v20.6.0 with Sentinel            |
| TLS           | cert-manager v1.16.3                   |
| Observability | Grafana LGTM v3.0.1 (Mimir/Loki/Tempo) |
| Pod Security  | Kyverno v3.6.1 (5 policies)            |
| Dev Tooling   | 20 CLIs via Nix (k9s, stern, argocd)   |
| Architecture  | Multi-project platform                 |
| HA Readiness  | 95% (quorum failover configured)       |

---
## [2][SCALING_PATH]

| [STAGE] | [SETUP]             | [TRIGGER]              | [EFFORT] |
| :-----: | ------------------- | ---------------------- | :------: |
|   [1]   | Single K3s node     | Now (MVP)              |   Done   |
|   [2]   | Observability stack | Debugging difficulty   |   Done   |
|   [3]   | Developer Tooling   | Operator efficiency    |   Done   |
|   [4]   | Multi-node cluster  | CPU/RAM limits         |  Medium  |
|   [5]   | High Availability   | Uptime SLA requirement |   High   |

---
## [3][STAGE_DETAILS]

### [3.1][OBSERVABILITY]

**Status:** COMPLETED

**Components:**

| [INDEX] | [TOOL]  | [PURPOSE]             | [STATUS] |
| :-----: | ------- | --------------------- | -------- |
|   [1]   | Mimir   | Prometheus metrics    | Deployed |
|   [2]   | Grafana | Dashboards + alerting | Deployed |
|   [3]   | Loki    | Log aggregation       | Deployed |
|   [4]   | Tempo   | Distributed tracing   | Deployed |
|   [5]   | Alloy   | OTEL collector        | Deployed |

**Deployed via:** ArgoCD Application `argocd/monitoring.yaml` (LGTM v3.0.1)

**Access:** `https://grafana.parametric-portal.com`

[REFERENCE] See `docs/architecture/infrastructure/monitoring.md` for operations guide.

---
### [3.2][DEVELOPER_TOOLING]

**Status:** COMPLETED

**Components:**

| [INDEX] | [CATEGORY]   | [TOOLS]                                   | [STATUS]  |
| :-----: | ------------ | ----------------------------------------- | --------- |
|   [1]   | Container    | colima, docker, docker-compose            | Installed |
|   [2]   | Kubernetes   | kubectl, kubecolor, kubectx, kustomize    | Installed |
|   [3]   | Package Mgmt | helm, helm-diff                           | Installed |
|   [4]   | GitOps       | argocd, kubeseal                          | Installed |
|   [5]   | Debugging    | k9s, stern, kube-capacity, kubectl-tree   | Installed |
|   [6]   | OCI Tools    | skopeo, crane, dive, hadolint, lazydocker | Installed |

**Installed via:** Nix/Parametric_Forge (`modules/home/programs/container-tools/`)

**Features:**
- k9s hotkeys for ArgoCD, Kyverno, CloudNativePG, Traefik, SealedSecrets
- Shell aliases for common operations
- XDG-compliant environment variables

[REFERENCE] See `docs/architecture/infrastructure/tooling.md` for full reference.

---
### [3.3][MULTI_NODE]

**When:** Single node CPU >80% sustained or RAM >90%.

**Architecture:**

```
                    ┌─────────────────┐
                    │  Control Plane  │
                    │   (existing)    │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼───────┐ ┌──────▼──────┐ ┌───────▼───────┐
    │   Agent 1     │ │   Agent 2   │ │   Agent 3     │
    │  (workloads)  │ │ (workloads) │ │  (workloads)  │
    └───────────────┘ └─────────────┘ └───────────────┘
```

**Implementation:**
```bash
# On new nodes
curl -sfL https://get.k3s.io | K3S_URL=https://<control-plane>:6443 \
    K3S_TOKEN=<node-token> sh -
```

**Considerations:**
- Node affinity for stateful workloads
- PodDisruptionBudgets already configured
- HPA will auto-distribute across nodes

---
### [3.4][HIGH_AVAILABILITY]

**When:** Uptime SLA >99.9% required.

**Architecture:**

```
              ┌─────────────────────────────────────┐
              │          Load Balancer              │
              │    (DNS round-robin or HAProxy)     │
              └──────────────┬──────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐    ┌───────▼───────┐    ┌───────▼───────┐
│  Control 1    │    │  Control 2    │    │  Control 3    │
│  (etcd)       │◄──►│  (etcd)       │◄──►│  (etcd)       │
└───────────────┘    └───────────────┘    └───────────────┘
```

**Implementation:**
- Migrate from SQLite to embedded etcd (K3s supports this)
- Add 2 additional control plane nodes
- Configure external load balancer or DNS failover
- Backup etcd snapshots to external storage

**Considerations:**
- Requires 3+ control plane nodes for etcd quorum
- Higher operational complexity
- Consider managed Kubernetes if team resources limited

---
## [4][COST_PROJECTION]

| [STAGE]       | [NODES] | [ESTIMATED_COST] |
| ------------- | :-----: | :--------------: |
| MVP           |    1    |    ~$7/month     |
| Observability |    1    |    ~$7/month     |
| Multi-node    |   3-4   |  ~$25-30/month   |
| HA            |   6+    |   ~$50+/month    |

[IMPORTANT] Costs based on comparable VPS pricing. Actual costs vary by provider.

---
## [5][DECISION_CRITERIA]

**Stay at current stage if:**
- Resource utilization <70%
- No SLA requirements
- Debugging is manageable with logs

**Move to next stage if:**
- Resource constraints blocking feature development
- Customer-facing SLA commitments
- Team spending >20% time on operational issues

---
## [6][COMPLETED_ITEMS]

| [INDEX] | [ITEM]             | [DESCRIPTION]                                        | [VERSION] |
| :-----: | ------------------ | ---------------------------------------------------- | :-------: |
|   [1]   | Platform Services  | Longhorn, cert-manager, MinIO, Redis                 | Dec 2025  |
|   [2]   | Grafana Dashboards | 6 dashboards (API, ArgoCD, CNPG, Cluster, Kyverno, Traefik) | Dec 2025  |
|   [3]   | PodMonitors        | 13 PodMonitors for all platform services             | Dec 2025  |
|   [4]   | PostgreSQL HA      | Quorum failover + PgBouncer connection pooling       | Dec 2025  |
|   [5]   | Storage HA         | Longhorn 3-replica distributed storage               | Dec 2025  |
|   [6]   | Monitoring         | LGTM stack with Prometheus/Grafana/Loki/Tempo        | Dec 2025  |
|   [7]   | Multi-Project Arch | Platform/projects folder structure                   | Dec 2025  |

---
## [7][PENDING_ITEMS]

| [INDEX] | [ITEM]             | [DESCRIPTION]                                        | [PRIORITY] |
| :-----: | ------------------ | ---------------------------------------------------- | :--------: |
|   [1]   | SealedSecrets      | Seal credentials for platform services               |    HIGH    |
|   [2]   | Domain Values      | Replace hardcoded domains with actual domains        |    HIGH    |
|   [3]   | DNS Provider       | Configure GCP Cloud DNS or Azure DNS credentials     |    HIGH    |
|   [4]   | S3 Bucket          | Create S3 bucket for PostgreSQL/Longhorn backups     |   MEDIUM   |
|   [5]   | Multi-Node Deploy  | 3 server + 3 agent K3s cluster                       |   MEDIUM   |
|   [6]   | PSS Policies       | Add 3 remaining Pod Security Standard policies       |    LOW     |

### [7.1][SECRETS]

Secret templates ready for sealing:
- `infrastructure/platform/postgres/secret-s3.yaml`
- `infrastructure/projects/parametric-portal/apps/api/secret.yaml`
- Redis password secret
- Longhorn backup secret
- Grafana admin secret
- ghcr.io registry credentials

**Command:** `kubeseal --cert <cert> < secret.yaml > sealed-secret.yaml`

### [7.2][DOMAINS]

Hardcoded domains require replacement:
- Update `infrastructure/projects/parametric-portal/base/domains.yaml` with actual domains
- Update 17 locations: IngressRoutes, Middleware (CSP), TLSStore, Deployments
