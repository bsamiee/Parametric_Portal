# 0010. Longhorn Distributed Storage

Date: 2025-12-12
Status: Accepted
Deciders: Bardia Samiee

---
## Context

Multi-node HA cluster requires distributed storage for PostgreSQL, Redis, MinIO, and monitoring persistence. K3s default `local-path` storage is node-specific and unsuitable for workload mobility across nodes.

---
## Alternatives Considered

| Option              | Pros                                        | Cons                                            |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| local-path (K3s)    | Zero config, included with K3s              | Node-specific, no HA, data loss on node failure |
| Longhorn            | CNCF project, K3s-native, simple, 3-replica | Requires 3+ nodes for durability                |
| Rook-Ceph           | Enterprise-grade, rich features             | Complex, resource-intensive (6+ nodes)          |
| Cloud-managed (EBS) | Fully managed, highly durable               | Vendor lock-in, cost, requires cloud provider   |

---
## Decision

Adopt **Longhorn v1.8.3** via Helm chart for distributed block storage with 3-replica durability.

**Rationale:**
- CNCF Sandbox project maintained by Rancher/SUSE
- Native K3s integration with CSI driver
- 3-replica synchronous replication provides HA
- ReadWriteMany support for shared volumes
- Snapshot and backup to S3
- Automatic volume rebalancing across nodes
- Lower resource requirements vs Rook-Ceph

---
## Implementation

### ArgoCD Installation

Deployed via ApplicationSet with sync-wave `-2` (before all other services):

**File:** `infrastructure/argocd/longhorn.yaml`

**Configuration:**
```yaml
source:
  repoURL: https://charts.longhorn.io
  chart: longhorn
  targetRevision: v1.8.3
  helm:
    values:
      persistence:
        defaultClassReplicaCount: 3
      defaultSettings:
        defaultReplicaCount: 3
        replicaSoftAntiAffinity: false  # Hard anti-affinity
        backupTarget: s3://parametric-portal-backups@us-east-1/longhorn
```

### Storage Class

**Name:** `longhorn` (set as default)
**Access Modes:** ReadWriteOnce, ReadWriteMany
**Reclaim Policy:** Delete
**Volume Binding:** Immediate

### Resources Using Longhorn

| Service                     | PVC Size | Replicas | Total Storage            |
| --------------------------- | -------- | -------- | ------------------------ |
| PostgreSQL (3 instances)    | 10Gi × 3 | 3        | 90Gi raw (30Gi usable)   |
| Redis (master + 2 replicas) | 10Gi × 3 | 3        | 90Gi raw (30Gi usable)   |
| MinIO (4 servers × 2 vols)  | 50Gi × 8 | 3        | 1.2Ti raw (400Gi usable) |
| Mimir ingester              | 10Gi × 3 | 3        | 90Gi raw (30Gi usable)   |
| Loki write                  | 10Gi × 3 | 3        | 90Gi raw (30Gi usable)   |
| Tempo ingester              | 5Gi × 3  | 3        | 45Gi raw (15Gi usable)   |
| Grafana                     | 2Gi × 2  | 3        | 18Gi raw (6Gi usable)    |

**Total Cluster Storage:** ~1.6Ti raw, ~600Gi usable (with 3-replica overhead)

---
## Consequences

[+] Workloads survive node failures (PVCs available on any node)
[+] Automatic replication ensures data durability
[+] Snapshot support for disaster recovery
[+] S3 backup integration for off-cluster backups
[+] Volume expansion without downtime
[+] Built-in monitoring via Prometheus metrics

[-] Requires 3+ nodes for 3-replica durability
[-] Storage overhead: 3x raw capacity for usable capacity
[-] Network bandwidth for replication traffic
[-] Increased complexity vs local-path

[~] 100-200MB memory overhead per node for Longhorn manager
[~] S3 credentials required for backup target
[~] Initial sync may take time for large volumes

---
## Validation

```bash
# Verify Longhorn deployment
kubectl get pods -n longhorn-system

# Check storage class
kubectl get storageclass longhorn

# Verify PVCs
kubectl get pvc -A | grep longhorn

# Check volume health
kubectl get volumes.longhorn.io -n longhorn-system

# Monitor replication
kubectl get replicas.longhorn.io -n longhorn-system
```

### Failure Testing

```bash
# Simulate node failure (drain node)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Verify workloads reschedule with PVCs intact
kubectl get pods -n parametric-portal -o wide

# Verify volumes remain available
kubectl get pvc -n parametric-portal
```

---
## References

- Longhorn Documentation: https://longhorn.io/docs/1.8.3/
- CNCF Longhorn Project: https://www.cncf.io/projects/longhorn/
- K3s Storage Options: https://docs.k3s.io/storage
- ArgoCD sync-wave: https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/
