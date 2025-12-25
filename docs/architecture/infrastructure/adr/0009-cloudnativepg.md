# [H1][ADR-0009-CLOUDNATIVEPG]
>**Dictum:** *Kubernetes-native PostgreSQL enables GitOps-driven database lifecycle.*

<br>

**Status:** Accepted
**Date:** 2025-12-25
**Deciders:** Bardia Samiee

---
## [1][CONTEXT]
>**Dictum:** *Database state must integrate with GitOps workflow.*

<br>

The infrastructure requires PostgreSQL for API persistence. Options evaluated:

| [INDEX] | [OPTION]              | [PROS]                                      | [CONS]                           |
| :-----: | --------------------- | ------------------------------------------- | -------------------------------- |
|   [1]   | External managed      | Zero ops, automatic backups                 | Vendor lock-in, egress costs     |
|   [2]   | Docker container      | Simple local dev                            | No HA, manual backups, no GitOps |
|   [3]   | CloudNativePG         | K8s-native, GitOps, auto-failover, backups  | Operator complexity              |
|   [4]   | Zalando Postgres-Op   | Mature, Patroni-based                       | Heavier footprint, less active   |

---
## [2][DECISION]
>**Dictum:** *CloudNativePG provides declarative database management.*

<br>

Adopt **CloudNativePG v1.28.0** via Helm chart v0.27.0 for GitOps-native PostgreSQL management.

**Rationale:**
- Declarative Cluster CRD integrates with ArgoCD sync
- Barman Cloud Plugin for S3-compatible backup/restore
- Single-node K3s compatible with `instances: 1`
- Automatic secret generation for connection credentials
- Rolling updates with switchover for zero-downtime upgrades

---
## [3][IMPLEMENTATION]
>**Dictum:** *Operator installation precedes cluster creation.*

<br>

### [3.1][OPERATOR_INSTALLATION]

Add to mise.toml `setup-k3s` task after ArgoCD:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm upgrade --install cnpg cnpg/cloudnative-pg \
    --namespace cnpg-system \
    --create-namespace \
    --wait
```

### [3.2][CLUSTER_RESOURCES]

| [INDEX] | [FILE]                  | [PURPOSE]                           |
| :-----: | ----------------------- | ----------------------------------- |
|   [1]   | `cluster.yaml`          | PostgreSQL 17 Cluster CRD           |
|   [2]   | `backup-objectstore.yaml` | On-demand backup resource         |
|   [3]   | `scheduled-backup.yaml` | Daily 2AM UTC backup schedule       |
|   [4]   | `kustomization.yaml`    | Kustomize manifest aggregation      |

### [3.3][CONNECTION_STRING]

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
## [4][CONSEQUENCES]
>**Dictum:** *Trade-offs inform future decisions.*

<br>

### [4.1][POSITIVE]

- Database lifecycle managed via Git commits
- Automatic backup with 7-day retention
- Connection credentials auto-rotated
- Horizontal scaling to 3+ instances when needed

### [4.2][NEGATIVE]

- Operator adds ~50MB memory overhead
- S3 credentials required for backups
- Requires cnpg-system namespace

### [4.3][NEUTRAL]

- Local development continues using Docker PostgreSQL
- Production uses CloudNativePG via ArgoCD sync

---
## [5][VALIDATION]
>**Dictum:** *Acceptance criteria confirm implementation.*

<br>

```bash
# Verify operator
kubectl get pods -n cnpg-system

# Verify cluster
kubectl get clusters -n parametric-portal

# Verify backups
kubectl get backups -n parametric-portal
```
