# 0009. CloudNativePG

Date: 2025-12-25
Status: Accepted
Deciders: Bardia Samiee

---
## Context

Database state must integrate with GitOps workflow. The infrastructure requires PostgreSQL for API persistence.

---
## Alternatives Considered

| Option              | Pros                                       | Cons                             |
| ------------------- | ------------------------------------------ | -------------------------------- |
| External managed    | Zero ops, automatic backups                | Vendor lock-in, egress costs     |
| Docker container    | Simple local dev                           | No HA, manual backups, no GitOps |
| CloudNativePG       | K8s-native, GitOps, auto-failover, backups | Operator complexity              |
| Zalando Postgres-Op | Mature, Patroni-based                      | Heavier footprint, less active   |

---
## Decision

Adopt **CloudNativePG v1.28.0** via Helm chart v0.27.0 for GitOps-native PostgreSQL management.

**Rationale:**
- Declarative Cluster CRD integrates with ArgoCD sync
- Barman Cloud Plugin for S3-compatible backup/restore
- Single-node K3s compatible with `instances: 1`
- Automatic secret generation for connection credentials
- Rolling updates with switchover for zero-downtime upgrades

---
## Implementation

### Operator Installation

Add to mise.toml `setup-k3s` task after ArgoCD:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm upgrade --install cnpg cnpg/cloudnative-pg \
    --namespace cnpg-system \
    --create-namespace \
    --wait
```

### Cluster Resources

| File                      | Purpose                        |
| ------------------------- | ------------------------------ |
| `cluster.yaml`            | PostgreSQL 17 Cluster CRD      |
| `backup-objectstore.yaml` | On-demand backup resource      |
| `scheduled-backup.yaml`   | Daily 2AM UTC backup schedule  |
| `kustomization.yaml`      | Kustomize manifest aggregation |

### Connection String

CloudNativePG auto-generates secret `parametric-portal-db-app` with:

```
postgresql://app:$PASSWORD@parametric-portal-db.parametric-portal.svc.cluster.local:5432/parametric_portal
```

Update `infrastructure/apps/api/deployment.yaml` env vars to reference:

```yaml
- name: POSTGRES_HOST
  value: "parametric-portal-db.parametric-portal.svc.cluster.local"
- name: POSTGRES_USER
  valueFrom:
    secretKeyRef:
      name: parametric-portal-db-app
      key: username
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: parametric-portal-db-app
      key: password
```

---
## Consequences

[+] Database lifecycle managed via Git commits
[+] Automatic backup with 7-day retention
[+] Connection credentials auto-rotated
[+] Horizontal scaling to 3+ instances when needed
[-] Operator adds ~50MB memory overhead
[-] S3 credentials required for backups
[-] Requires cnpg-system namespace
[~] Local development continues using Docker PostgreSQL
[~] Production uses CloudNativePG via ArgoCD sync

---
## Validation

```bash
# Verify operator
kubectl get pods -n cnpg-system

# Verify cluster
kubectl get clusters -n parametric-portal

# Verify backups
kubectl get backups -n parametric-portal
```
