# [H1][GRAFANA_DASHBOARDS]
>**Dictum:** *Dashboard panels map recording rules to visual monitoring.*

<br>

**Grafana 12.3.2**, `schemaVersion: 39`. Provisioned via Pulumi ConfigMaps, never UI-created.<br>
**Datasource:** Prometheus only (`_Ops.grafana(promUrl)`, deploy.ts:59). Loki panels require extension.

---
## [1][GRAFANA_12_FEATURES]
>**Dictum:** *Version-specific features determine dashboard capabilities.*

<br>

| [INDEX] | [FEATURE]                    | [VERSION] | [STATUS]     | [IMPACT]                                                      |
| :-----: | ---------------------------- | --------- | ------------ | ------------------------------------------------------------- |
|   [1]   | **Dashboard Schema v2**      | 12.0      | Experimental | TabsLayout, GridLayout, AutoGridLayout, RowsLayout.           |
|   [2]   | **Dynamic Dashboards**       | 12.0      | Stable       | Panels generated from query results.                          |
|   [3]   | **Tabs**                     | 12.0      | Stable       | Group panels into tabs within single dashboard.               |
|   [4]   | **SQL Expressions**          | 12.0      | Stable       | Join/transform data from multiple sources via SQL.            |
|   [5]   | **Switch Template Variable** | 12.3      | Stable       | Boolean toggle variable for on/off states.                    |
|   [6]   | **Native Histogram Heatmap** | 12.0+     | Stable       | Renders native histograms without explicit bucket boundaries. |

---
## [2][PROVISIONING]
>**Dictum:** *ConfigMap-based provisioning ensures reproducible dashboard deployment.*

<br>

Deploy two ConfigMaps: dashboard provider (where to find JSON), dashboard JSON files.

```typescript
const dashboardProvider = new k8s.core.v1.ConfigMap("grafana-dashboard-provider", {
    metadata: _Ops.meta(ns.metadata.name, 'grafana', 'grafana-dashboard-provider'),
    data: {
        "dashboards.yml": JSON.stringify({
            apiVersion: 1,
            providers: [{ name: "default", orgId: 1, folder: "", type: "file",
                disableDeletion: false, editable: true,
                options: { path: "/var/lib/grafana/dashboards" } }],
        }),
    },
});
const dashboards = new k8s.core.v1.ConfigMap("grafana-dashboards", {
    metadata: _Ops.meta(ns.metadata.name, 'grafana', 'grafana-dashboards'),
    data: {
        "http-overview.json": JSON.stringify(httpOverviewDashboard),
        "infrastructure.json": JSON.stringify(infrastructureDashboard),
    },
});
```

Integration with `_k8sObserve`: use `k8s.apps.v1.DeploymentPatch` (SSA, Pulumi v4.23+) to add dashboard provider at `/etc/grafana/provisioning/dashboards` and JSON at `/var/lib/grafana/dashboards`.

---
## [3][HTTP_OVERVIEW_DASHBOARD]
>**Dictum:** *HTTP dashboard surfaces request rate, error ratio, and latency distribution.*

<br>

`uid: "http-overview"`, tags: `["http", "service", "overview"]`, refresh: `30s`, `schemaVersion: 39`.
Variable: `$service` = `label_values(http_server_request_duration_seconds_count, service_name)`.

<br>

### [3.1][STATS_ROW]

| [INDEX] | [TYPE]   | [TITLE]       | [QUERY]                                               | [UNIT]      | [H_W_X_Y] | [THRESHOLDS]                  |
| :-----: | -------- | ------------- | ----------------------------------------------------- | ----------- | --------- | ----------------------------- |
|   [1]   | **stat** | Request Rate. | `sum(http:requests:rate5m{service_name="$service"})`. | reqps       | 4,6,0,0   | Informational.                |
|   [2]   | **stat** | Error Rate.   | `http:errors:ratio5m{service_name="$service"}`.       | percentunit | 4,6,6,0   | green/yellow(0.01)/red(0.05). |
|   [3]   | **stat** | P99 Latency.  | `http:latency:p99_5m{service_name="$service"}`.       | s           | 4,6,12,0  | green/yellow(1)/red(5).       |
|   [4]   | **stat** | P50 Latency.  | `http:latency:p50_5m{service_name="$service"}`.       | s           | 4,6,18,0  | green/yellow(0.5)/red(2).     |

---
### [3.2][SERIES_ROW]

| [INDEX] | [TYPE]         | [TITLE]                 | [QUERY]                                                                                                     | [UNIT] | [H_W_X_Y] |
| :-----: | -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------ | --------- |
|   [1]   | **timeseries** | Request Rate by Status. | `sum(rate(http_server_request_duration_seconds_count{service_name="$service"}[5m])) by (http_status_code)`. | reqps  | 8,12,0,4  |
|   [2]   | **timeseries** | Latency Distribution.   | `http:latency:p50_5m` + `p95_5m` + `p99_5m` (all `{service_name="$service"}`).                              | s      | 8,12,12,4 |

---
### [3.3][ERRORS_ROW]

| [INDEX] | [TYPE]         | [TITLE]             | [QUERY]                                                                                                                              | [UNIT] | [H_W_X_Y]  |
| :-----: | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- |
|   [1]   | **timeseries** | Error Rate (5xx).   | `sum(rate(http_server_request_duration_seconds_count{service_name="$service", http_status_code=~"5.."}[5m])) by (http_status_code)`. | reqps  | 8,12,0,12  |
|   [2]   | **timeseries** | Active Connections. | `http_server_active_requests{service_name="$service"}`.                                                                              | short  | 8,12,12,12 |

---
### [3.4][NATIVE_HISTOGRAM_HEATMAP]

| [INDEX] | [TYPE]      | [TITLE]          | [QUERY]                                                                         | [UNIT] | [H_W_X_Y] |
| :-----: | ----------- | ---------------- | ------------------------------------------------------------------------------- | ------ | --------- |
|   [1]   | **heatmap** | Latency Heatmap. | `sum(rate(http_server_request_duration_seconds{service_name="$service"}[5m]))`. | s      | 8,24,0,20 |

Renders automatically in Grafana 12+ without bucket boundaries -- resolution adapts dynamically.

---
## [4][INFRASTRUCTURE_DASHBOARD]
>**Dictum:** *Infrastructure dashboard monitors pod resources, node health, and storage utilization.*

<br>

`uid: "infrastructure-overview"`, tags: `["infrastructure", "kubernetes"]`, refresh: `30s`.
Variable: `$namespace` = `label_values(kube_pod_info, namespace)` (default: `parametric`).

<br>

### [4.1][POD_ROW]

| [INDEX] | [TYPE]         | [TITLE]        | [QUERY]                                                                              | [UNIT] | [H_W_X_Y] |
| :-----: | -------------- | -------------- | ------------------------------------------------------------------------------------ | ------ | --------- |
|   [1]   | **timeseries** | Pod CPU Usage. | `sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[5m])) by (pod)`. | cores  | 8,12,0,0  |
|   [2]   | **timeseries** | Pod Memory.    | `sum(container_memory_usage_bytes{namespace="$namespace"}) by (pod)`.                | bytes  | 8,12,12,0 |

---
### [4.2][NODE_ROW]

| [INDEX] | [TYPE]    | [TITLE]      | [QUERY]                                                                                                 | [UNIT]  | [H_W_X_Y] | [THRESHOLDS]              |
| :-----: | --------- | ------------ | ------------------------------------------------------------------------------------------------------- | ------- | --------- | ------------------------- |
|   [1]   | **gauge** | Node CPU.    | `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`.                                     | percent | 6,8,0,8   | green/yellow(70)/red(90). |
|   [2]   | **gauge** | Node Memory. | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`.                              | percent | 6,8,8,8   | green/yellow(70)/red(90). |
|   [3]   | **gauge** | Node Disk.   | `(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100`. | percent | 6,8,16,8  | green/yellow(80)/red(95). |

---
### [4.3][PVC_ROW]

| [INDEX] | [TYPE]    | [TITLE]          | [QUERY]                                                                                                                  | [UNIT]      | [H_W_X_Y] |
| :-----: | --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | --------- |
|   [1]   | **table** | PVC Utilization. | `kubelet_volume_stats_used_bytes{namespace="$namespace"} / kubelet_volume_stats_capacity_bytes{namespace="$namespace"}`. | percentunit | 8,24,0,14 |

---
## [5][DASHBOARD_SCHEMA_V2]
>**Dictum:** *Schema v2 migration is one-way -- evaluate before converting.*

<br>

Requires `kubernetesDashboards` + dynamic dashboards feature toggles. **WARNING:** One-way migration -- v2 dashboards cannot revert to v1.

Layout types: `GridLayout` (manual x/y/w/h), `AutoGridLayout` (auto-wrap), `RowsLayout` (collapsible), `TabsLayout` (grouped tabs).

<br>

### [5.1][RECOMMENDED_TAB_STRUCTURE]

**HTTP Overview:** Overview (stats) | Latency (distribution + heatmap) | Errors (5xx + connections).<br>
**Infrastructure:** Compute (pod CPU/memory, node health) | Storage (PVC, disk predictions) | Network (traffic, connections).

---
## [6][EXTENSION_LOKI_INTEGRATION]
>**Dictum:** *Loki integration adds log panels alongside metric dashboards.*

<br>

Deploy Loki first (see `stack_architecture.md`), then extend `_Ops.grafana()` (deploy.ts:59) with Loki datasource including `derivedFields` for trace correlation.

<br>

### [6.1][LOG_PANELS]

| [INDEX] | [TYPE]         | [TITLE]              | [LOGQL]                                                                                    |
| :-----: | -------------- | -------------------- | ------------------------------------------------------------------------------------------ |
|   [1]   | **logs**       | Error Logs.          | `{service_name="$service"} \|= "error" \| logfmt \| level = "error"`.                      |
|   [2]   | **logs**       | Structured Logs.     | `{service_name="$service"} \| json \| __error__=""`.                                       |
|   [3]   | **timeseries** | Log Volume by Level. | `sum(count_over_time({service_name="$service"} \| json \| __error__="" [1m])) by (level)`. |

---
### [6.2][LOGS_EXPLORER_DASHBOARD]

`uid: "logs-explorer"`, variables: `$service` (Loki `label_values`), `$level` (custom multi: debug,info,warn,error,fatal).
Tabs: **Volume** (log volume timeseries) | **Stream** (live log stream) | **Errors** (error-only with extracted fields).
