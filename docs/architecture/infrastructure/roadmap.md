# [H1][INFRASTRUCTURE_ROADMAP]
>**Dictum:** *Staged evolution prevents premature optimization.*

<br>

Scaling path from single-node MVP to high-availability production cluster.

---
## [1][CURRENT_STATE]

| [ASPECT]      | [VALUE]              |
| ------------- | -------------------- |
| Nodes         | 1 (control + worker) |
| Orchestration | K3s v1.32            |
| Database      | External PostgreSQL  |
| Observability | None                 |
| HA            | None                 |

---
## [2][SCALING_PATH]

| [STAGE] | [SETUP]             | [TRIGGER]              | [EFFORT] |
| :-----: | ------------------- | ---------------------- | :------: |
|   [1]   | Single K3s node     | Now (MVP)              |   Done   |
|   [2]   | Observability stack | Debugging difficulty   |  Medium  |
|   [3]   | Multi-node cluster  | CPU/RAM limits         |  Medium  |
|   [4]   | High Availability   | Uptime SLA requirement |   High   |

---
## [3][STAGE_DETAILS]

### [3.1][OBSERVABILITY]

**When:** First production incident requiring deeper debugging.

**Components:**

| [INDEX] | [TOOL]     | [PURPOSE]             |
| :-----: | ---------- | --------------------- |
|   [1]   | Prometheus | Metrics collection    |
|   [2]   | Grafana    | Dashboards + alerting |
|   [3]   | Loki       | Log aggregation       |
|   [4]   | Tempo      | Distributed tracing   |

**Implementation:**
- Deploy via Helm charts to `monitoring` namespace
- Configure Traefik metrics endpoint
- Add Grafana dashboards for K3s, Traefik, application metrics
- Set up alerting rules for resource exhaustion, error rates

---
### [3.2][MULTI_NODE]

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
### [3.3][HIGH_AVAILABILITY]

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
