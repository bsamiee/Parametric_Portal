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
| Database      | CloudNativePG PostgreSQL 17            |
| Observability | Grafana LGTM v3.0.1 (Mimir/Loki/Tempo) |
| Pod Security  | Kyverno v3.6.1 (PSS Restricted)        |
| Dev Tooling   | 20 CLIs via Nix (k9s, stern, argocd)   |
| HA            | None                                   |

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
## [6][PENDING_ITEMS]

| [INDEX] | [ITEM]             | [DESCRIPTION]                                        | [PRIORITY] |
| :-----: | ------------------ | ---------------------------------------------------- | :--------: |
|   [1]   | SealedSecrets      | Migrate `secret.yaml` and `secret-s3.yaml` to sealed |    HIGH    |
|   [2]   | Grafana Dashboards | API, Icons, Traefik, ArgoCD, Kyverno, Cluster        |   MEDIUM   |
|   [3]   | KUBECONFIG Init    | Create `~/.config/kube/` directory on first deploy   |    LOW     |

### [6.1][DASHBOARDS]

| [DASHBOARD]        | [SOURCE]          |
| ------------------ | ----------------- |
| API Node.js        | Custom            |
| Icons Frontend     | Custom            |
| Traefik Ingress    | grafana.com/14055 |
| ArgoCD             | grafana.com/14584 |
| Kyverno            | grafana.com/15987 |
| Kubernetes Cluster | grafana.com/315   |

### [6.2][SECRETS]

Plain YAML secrets require SealedSecrets migration:
- `infrastructure/apps/api/secret.yaml`
- `infrastructure/apps/postgres/secret-s3.yaml`

**Command:** `mise run seal-secret <name> <namespace>`
