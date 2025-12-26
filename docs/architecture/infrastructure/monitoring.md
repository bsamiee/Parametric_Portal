# [H1][INFRASTRUCTURE_MONITORING]
>**Dictum:** *Observability enables proactive incident response.*

<br>

Grafana LGTM stack v3.0.1 provides metrics (Mimir), logs (Loki), traces (Tempo), and dashboards (Grafana).

---
## [1][STACK]

| [INDEX] | [COMPONENT] | [PURPOSE]             | [VERSION] | [STORAGE] |
| :-----: | ----------- | --------------------- | --------- | --------- |
|   [1]   | Mimir       | Prometheus metrics    | v3.0.1    | 10Gi      |
|   [2]   | Loki        | Log aggregation       | v3.0.1    | 10Gi      |
|   [3]   | Tempo       | Distributed tracing   | v3.0.1    | 5Gi       |
|   [4]   | Alloy       | OTEL collector        | v3.0.1    | -         |
|   [5]   | Grafana     | Dashboards + alerting | v3.0.1    | 2Gi       |

**Deployed via:** ArgoCD Application `argocd/monitoring.yaml`

---
## [2][ACCESS]
>**Dictum:** *Single URL provides unified observability.*

<br>

| [INDEX] | [SERVICE] | [URL]                                   | [AUTH]   |
| :-----: | --------- | --------------------------------------- | -------- |
|   [1]   | Grafana   | `https://grafana.parametric-portal.com` | admin/\* |

**Initial Password:**
```bash
kubectl get secret -n monitoring lgtm-grafana -o jsonpath="{.data.admin-password}" | base64 -d
```

---
## [3][DATASOURCES]
>**Dictum:** *Pre-configured datasources enable immediate querying.*

<br>

| [INDEX] | [NAME] | [TYPE]     | [INTERNAL_URL]                      | [DEFAULT] |
| :-----: | ------ | ---------- | ----------------------------------- | :-------: |
|   [1]   | Mimir  | Prometheus | `http://lgtm-mimir:9009/prometheus` |    YES    |
|   [2]   | Loki   | Loki       | `http://lgtm-loki-gateway:80`       |     -     |
|   [3]   | Tempo  | Tempo      | `http://lgtm-tempo:3100`            |     -     |

---
## [4][DASHBOARDS]

### [4.1][INCLUDED]

| [INDEX] | [DASHBOARD]   | [FILE]                                                            |
| :-----: | ------------- | ----------------------------------------------------------------- |
|   [1]   | CloudNativePG | `infrastructure/platform/monitoring/dashboard-cloudnativepg.yaml` |

[REFERENCE] See `docs/architecture/infrastructure/roadmap.md` §6.1 for pending dashboards.

---
### [4.2][ADD_DASHBOARD]

1. Create ConfigMap with `grafana_dashboard: "1"` label
2. Add JSON dashboard in `data` field
3. Include in `infrastructure/platform/monitoring/kustomization.yaml`
4. Commit and ArgoCD syncs

---
## [5][METRICS]
>**Dictum:** *PodMonitors define scrape targets.*

<br>

### [5.1][SCRAPED_TARGETS]

| [INDEX] | [TARGET]          | [NAMESPACE]       | [PORT]  | [INTERVAL] |
| :-----: | ----------------- | ----------------- | ------- | ---------- |
|   [1]   | ArgoCD Server     | argocd            | metrics | 30s        |
|   [2]   | ArgoCD Controller | argocd            | metrics | 30s        |
|   [3]   | ArgoCD Repo       | argocd            | metrics | 30s        |
|   [4]   | CloudNativePG     | parametric-portal | (auto)  | 30s        |
|   [5]   | API               | parametric-portal | http    | 30s        |
|   [6]   | Icons             | parametric-portal | http    | 30s        |

<br>

### [5.2][PODMONITORS]

| [INDEX] | [FILE]                  | [SELECTOR]                       | [PORT] | [PATH]     |
| :-----: | ----------------------- | -------------------------------- | ------ | ---------- |
|   [1]   | `podmonitor-api.yaml`   | `app.kubernetes.io/name: api`    | http   | `/metrics` |
|   [2]   | `podmonitor-icons.yaml` | `app.kubernetes.io/name: icons`  | http   | `/metrics` |
|   [3]   | `podmonitor-argocd.yaml`| `app.kubernetes.io/name: argocd` | metrics| `/metrics` |
|   [4]   | `podmonitor-postgres.yaml`| `cnpg.io/cluster`              | (auto) | `/metrics` |

**Files:**
- `infrastructure/platform/monitoring/podmonitor-argocd.yaml`
- `infrastructure/platform/monitoring/podmonitor-api.yaml`
- `infrastructure/platform/monitoring/podmonitor-icons.yaml`
- `infrastructure/platform/monitoring/podmonitor-postgres.yaml`

---
### [5.3][POSTGRESQL_METRICS]

CloudNativePG exports metrics via `monitoring.enablePodMonitor: true`:

| [INDEX] | [METRIC]                      | [PURPOSE]          |
| :-----: | ----------------------------- | ------------------ |
|   [1]   | `cnpg_pg_stat_activity_count` | Active connections |
|   [2]   | `cnpg_pg_database_size_bytes` | Database size      |
|   [3]   | `cnpg_pg_stat_replication_*`  | Replication lag    |
|   [4]   | `cnpg_collector_up`           | Collector health   |

---
## [6][LOGS]
>**Dictum:** *LogQL queries enable log exploration.*

<br>

### [6.1][QUERY_EXAMPLES]

```logql
# API logs (last hour)
{namespace="parametric-portal", app="api"}

# Error logs only
{namespace="parametric-portal"} |= "error"

# Rate of errors
rate({namespace="parametric-portal"} |= "error" [5m])
```

---
## [7][RESOURCES]

| [INDEX] | [COMPONENT] | [CPU_REQ] | [CPU_LIM] | [MEM_REQ] | [MEM_LIM] |
| :-----: | ----------- | :-------: | :-------: | :-------: | :-------: |
|   [1]   | Mimir       |   100m    |   500m    |   256Mi   |   512Mi   |
|   [2]   | Loki        |   100m    |   500m    |   256Mi   |   512Mi   |
|   [3]   | Tempo       |    50m    |   250m    |   128Mi   |   256Mi   |
|   [4]   | Alloy       |    50m    |   250m    |   64Mi    |   256Mi   |
|   [5]   | Grafana     |    50m    |   250m    |   128Mi   |   256Mi   |

---
## [8][NETWORK]

Monitoring namespace network policies allow:

| [INDEX] | [RULE]                      | [PURPOSE]                    |
| :-----: | --------------------------- | ---------------------------- |
|   [1]   | Egress to kube-system       | DNS resolution               |
|   [2]   | Egress to parametric-portal | Scrape API/Icons metrics     |
|   [3]   | Egress to argocd            | Scrape ArgoCD metrics        |
|   [4]   | Egress to cnpg-system       | Scrape CNPG operator metrics |
|   [5]   | Ingress from kube-system    | Traefik → Grafana            |

**File:** `infrastructure/platform/monitoring/networkpolicy.yaml`

---
## [9][OPERATIONS]

### [9.1][CHECK_STATUS]

```bash
# Pod status
kubectl get pods -n monitoring

# Storage usage
kubectl get pvc -n monitoring

# Grafana logs
kubectl logs -n monitoring -l app.kubernetes.io/name=grafana
```

---
### [9.2][RESTART_COMPONENTS]

```bash
# Restart Grafana
kubectl rollout restart deployment/lgtm-grafana -n monitoring

# Restart all monitoring
kubectl rollout restart deployment -n monitoring
```

---
## [10][ALERTING]

PrometheusRules define alerting thresholds.

**File:** `infrastructure/platform/monitoring/prometheusrules.yaml`

| [INDEX] | [ALERT]                   | [THRESHOLD]             | [SEVERITY] |
| :-----: | ------------------------- | ----------------------- | :--------: |
|   [1]   | APIHighErrorRate          | 5xx rate > 1% for 5m    |  critical  |
|   [2]   | APIHighLatency            | p95 > 1s for 10m        |  warning   |
|   [3]   | PostgreSQLHighConnections | > 80 connections for 5m |  warning   |
|   [4]   | PostgreSQLReplicationLag  | > 30s for 5m            |  critical  |
|   [5]   | PodCrashLooping           | restarts > 0 in 15m     |  critical  |
|   [6]   | PVCUsageHigh              | > 80% for 10m           |  warning   |
|   [7]   | KyvernoPolicyViolation    | policy fail in 5m       |  warning   |

---
## [11][TROUBLESHOOTING]

| [INDEX] | [SYMPTOM]             | [CHECK]                                     | [FIX]                           |
| :-----: | --------------------- | ------------------------------------------- | ------------------------------- |
|   [1]   | No metrics in Grafana | `kubectl get pods -n monitoring`            | Check Mimir pod logs            |
|   [2]   | Dashboard not loading | `kubectl logs -n monitoring -l app=grafana` | Check sidecar provisioner       |
|   [3]   | Logs missing          | `kubectl logs -n monitoring -l app=loki`    | Check Loki storage              |
|   [4]   | High memory usage     | `kubectl top pods -n monitoring`            | Increase limits or add replicas |
