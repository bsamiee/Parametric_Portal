# Grafana Dashboards Reference

> **Grafana 12.3+** dashboard JSON model. `schemaVersion: 39` (current stable). Provisioned via Pulumi ConfigMaps, never UI-created.
> **Datasource:** Prometheus only (`_Ops.grafana(promUrl)`, deploy.ts:59). Loki panels require extension.
> **Namespace:** `parametric` (deploy.ts:18). All dashboard ConfigMaps deploy here.
> **Features:** Grafana 12 introduces dashboard schema v2, dynamic dashboards, tabs, SQL Expressions, and Git Sync.

## Grafana 12.x Features

| Feature | Version | Status | Impact |
|---------|---------|--------|--------|
| Dashboard Schema v2 | 12.0 | Experimental (requires `kubernetesDashboards` + dynamic dashboards feature toggles) | New JSON structure with TabsLayout, GridLayout, AutoGridLayout, RowsLayout; backward-compatible |
| Dynamic Dashboards | 12.0 | Stable | Panels generated from query results; reduces static panel maintenance |
| Tabs | 12.0 | Stable | Group panels into tabs within a single dashboard; replaces row-based layout for complex views |
| SQL Expressions | 12.0 | Stable | Join and transform data from multiple sources using SQL syntax |
| Git Sync | 12.0 | Stable | Bidirectional sync between Grafana and Git; alternative to ConfigMap provisioning |
| Switch Template Variable | 12.3 | Stable | Boolean toggle variable replacing cumbersome drop-down menus for on/off states |
| Redesigned Logs Panel | 12.3 | Stable | Faster pattern recognition, clearer context, improved log exploration UX |
| Interactive Learning | 12.3 | Preview | In-product help and tutorials |
| Native Histogram Heatmap | 12.0+ | Stable | Heatmap panel renders native histograms without explicit bucket boundaries |
| `schemaVersion: 39` | 12.0+ | Current | Latest stable schema version for JSON model |

## Provisioning

Deploy two ConfigMaps: one for the dashboard provider config (tells Grafana where to find JSON files), one for the dashboard JSON files themselves.

```typescript
// Dashboard provider -- tells Grafana to load JSON from /var/lib/grafana/dashboards
const dashboardProvider = new k8s.core.v1.ConfigMap("grafana-dashboard-provider", {
    metadata: _Ops.meta(ns.metadata.name, 'grafana', 'grafana-dashboard-provider'),
    data: {
        "dashboards.yml": JSON.stringify({
            apiVersion: 1,
            providers: [{
                name: "default", orgId: 1, folder: "", type: "file",
                disableDeletion: false, editable: true,
                options: { path: "/var/lib/grafana/dashboards" },
            }],
        }),
    },
});
// Dashboard JSON files
const dashboards = new k8s.core.v1.ConfigMap("grafana-dashboards", {
    metadata: _Ops.meta(ns.metadata.name, 'grafana', 'grafana-dashboards'),
    data: {
        "http-overview.json": JSON.stringify(httpOverviewDashboard),
        "infrastructure.json": JSON.stringify(infrastructureDashboard),
    },
});
```

### Integration with `_k8sObserve`

The Grafana Deployment created by `_k8sObserve` (deploy.ts:120-126) mounts one ConfigMap at `configPath` (datasource provisioning). Dashboard provisioning requires two additional volume mounts:
1. Dashboard provider YAML at `/etc/grafana/provisioning/dashboards`
2. Dashboard JSON files at `/var/lib/grafana/dashboards`

Use `k8s.apps.v1.DeploymentPatch` (SSA, Pulumi v4.23+) to add volumes without modifying the `_k8sObserve` factory.

## HTTP Overview Dashboard

`uid: "http-overview"`, tags: `["http", "service", "overview"]`, refresh: `30s`, `schemaVersion: 39`

Variable: `$service` = `label_values(http_server_request_duration_seconds_count, service_name)`

### Stats Row (y=0)

Top-level KPIs. All use recording rules from `alert_rules.md` for consistency and performance.

| Type | Title | Query | Unit | h,w,x,y | Threshold Rationale |
|------|-------|-------|------|----------|---------------------|
| stat | Request Rate | `sum(http:requests:rate5m{service_name="$service"})` | reqps | 4,6,0,0 | No threshold; informational |
| stat | Error Rate | `http:errors:ratio5m{service_name="$service"}` | percentunit | 4,6,6,0 | green(0)/yellow(0.01)/red(0.05) -- matches HttpHighErrorRate (1%) and HttpCriticalErrorRate (5%) alert thresholds |
| stat | P99 Latency | `http:latency:p99_5m{service_name="$service"}` | s | 4,6,12,0 | green(0)/yellow(1)/red(5) -- yellow at 1s (degraded UX), red at 5s (matches HttpCriticalLatencyP99 alert) |
| stat | P50 Latency | `http:latency:p50_5m{service_name="$service"}` | s | 4,6,18,0 | green(0)/yellow(0.5)/red(2) -- P50 > 500ms indicates systemic issue, not just tail latency |

### Series Row (y=4)

Time-series panels for trend analysis.

| Type | Title | Query | Unit | h,w,x,y |
|------|-------|-------|------|----------|
| timeseries | Request Rate by Status | `sum(rate(http_server_request_duration_seconds_count{service_name="$service"}[5m])) by (http_status_code)` | reqps | 8,12,0,4 |
| timeseries | Latency Distribution | `http:latency:p50_5m{service_name="$service"}` + `http:latency:p95_5m{service_name="$service"}` + `http:latency:p99_5m{service_name="$service"}` | s | 8,12,12,4 |

### Errors Row (y=12)

Error-focused panels for incident investigation.

| Type | Title | Query | Unit | h,w,x,y |
|------|-------|-------|------|----------|
| timeseries | Error Rate (5xx) | `sum(rate(http_server_request_duration_seconds_count{service_name="$service", http_status_code=~"5.."}[5m])) by (http_status_code)` | reqps | 8,12,0,12 |
| timeseries | Active Connections | `http_server_active_requests{service_name="$service"}` | short | 8,12,12,12 |

### Native Histogram Panels (Prometheus 3.8+)

With native histograms enabled (`scrape_native_histograms: true`), add a heatmap panel for latency distribution:

| Type | Title | Query | Unit | h,w,x,y |
|------|-------|-------|------|----------|
| heatmap | Latency Heatmap | `sum(rate(http_server_request_duration_seconds{service_name="$service"}[5m]))` | s | 8,24,0,20 |

Native histogram heatmaps render automatically in Grafana 12+ without bucket boundaries -- the histogram resolution adapts dynamically.

## Infrastructure Dashboard

`uid: "infrastructure-overview"`, tags: `["infrastructure", "kubernetes", "resources"]`, refresh: `30s`, `schemaVersion: 39`

Variable: `$namespace` = `label_values(kube_pod_info, namespace)` (default: `parametric`)

### Pod Row (y=0)

| Type | Title | Query | Unit | h,w,x,y | What to Watch |
|------|-------|-------|------|----------|---------------|
| timeseries | Pod CPU Usage | `sum(rate(container_cpu_usage_seconds_total{namespace="$namespace"}[5m])) by (pod)` | cores | 8,12,0,0 | Compare against `requests.cpu` from deploy.ts:168; sustained usage > requests triggers HPA |
| timeseries | Pod Memory Usage | `sum(container_memory_usage_bytes{namespace="$namespace"}) by (pod)` | bytes | 8,12,12,0 | Compare against `limits.memory` from deploy.ts:168; approaching limit triggers OOMKill |

### Node Row (y=8)

| Type | Title | Query | Unit | h,w,x,y | Threshold Rationale |
|------|-------|-------|------|----------|---------------------|
| gauge | Node CPU | `100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)` | percent | 6,8,0,8 | green(0)/yellow(70)/red(90) -- 70% sustained = schedule pressure; 90% = risk of CPU throttling across pods |
| gauge | Node Memory | `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100` | percent | 6,8,8,8 | green(0)/yellow(70)/red(90) -- 70% = approaching eviction threshold; 90% = kernel OOM killer active |
| gauge | Node Disk | `(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100` | percent | 6,8,16,8 | green(0)/yellow(80)/red(95) -- 80% = plan expansion; 95% = imminent write failures, kubelet eviction |

### PVC Row (y=14)

| Type | Title | Query | Unit | h,w,x,y | What to Watch |
|------|-------|-------|------|----------|---------------|
| table | PVC Utilization | `kubelet_volume_stats_used_bytes{namespace="$namespace"} / kubelet_volume_stats_capacity_bytes{namespace="$namespace"}` | percentunit | 8,24,0,14 | Prometheus PVC (`_k8sObserve`, deploy.ts:121) and Grafana PVC; >80% needs storage expansion |

## Grafana 12 Dashboard Schema v2 (Experimental)

Schema v2 is automatically enabled with the Dynamic Dashboards feature toggle and also requires `kubernetesDashboards` feature toggle. Supports multiple layout types: GridLayout, AutoGridLayout, RowsLayout, and TabsLayout.

**WARNING:** Schema v2 is experimental. Do not use in production without understanding that data migration is one-way. Dashboards saved in v2 cannot be reverted to v1.

### TabsLayout (replaces row-based layout for complex views)

```json
{
  "apiVersion": "v2alpha1",
  "kind": "DashboardWithAccessInfo",
  "metadata": { "name": "http-overview" },
  "spec": {
    "title": "HTTP Overview",
    "schemaVersion": 39,
    "timeSettings": { "from": "now-1h", "to": "now" },
    "variables": [],
    "layout": {
      "kind": "TabsLayout",
      "spec": {
        "tabs": [
          {
            "kind": "TabsLayoutTab",
            "spec": {
              "title": "Overview",
              "layout": {
                "kind": "GridLayout",
                "spec": {
                  "items": [
                    {
                      "kind": "GridLayoutItem",
                      "spec": {
                        "x": 0, "y": 0, "width": 12, "height": 4,
                        "element": { "kind": "Panel", "spec": { "title": "Request Rate", "vizConfig": {} } }
                      }
                    }
                  ]
                }
              }
            }
          },
          {
            "kind": "TabsLayoutTab",
            "spec": {
              "title": "Latency",
              "layout": {
                "kind": "GridLayout",
                "spec": { "items": [] }
              }
            }
          },
          {
            "kind": "TabsLayoutTab",
            "spec": {
              "title": "Errors",
              "layout": {
                "kind": "GridLayout",
                "spec": { "items": [] }
              }
            }
          }
        ]
      }
    }
  }
}
```

### Layout Types

| Layout | Use When | Description |
|--------|----------|-------------|
| `GridLayout` | Default, manual positioning | Grid-based panel placement with x/y/width/height coordinates |
| `AutoGridLayout` | Uniform panel sizes | Automatic grid positioning; panels wrap to fill available space |
| `RowsLayout` | Collapsible sections | Panels organized in collapsible rows (similar to v1 row panels) |
| `TabsLayout` | Complex multi-view dashboards | Panels grouped into tabs; tabs can nest any layout type inside |

### Recommended Tab Structure

**HTTP Overview Dashboard:**
- **Overview** tab: Stats row (request rate, error rate, P99, P50)
- **Latency** tab: Request rate by status, latency distribution, native histogram heatmap
- **Errors** tab: Error rate (5xx), active connections

**Infrastructure Dashboard:**
- **Compute** tab: Pod CPU/memory, node health
- **Storage** tab: PVC utilization, disk predictions
- **Network** tab: Traffic rates, connection counts

## Extension: Loki Integration

Deploy Loki first (see `stack_architecture.md#loki-36`), then extend `_Ops.grafana()` (deploy.ts:59):

```typescript
const datasources = {
    apiVersion: 1,
    datasources: [
        { name: "Prometheus", type: "prometheus", access: "proxy",
          url: "http://prometheus.parametric.svc.cluster.local:9090",
          isDefault: true, editable: false },
        { name: "Loki", type: "loki", access: "proxy",
          url: "http://loki.parametric.svc.cluster.local:3100",
          editable: false,
          jsonData: {
              derivedFields: [{
                  datasourceUid: "prometheus",
                  matcherRegex: "traceID=(\\w+)",
                  name: "TraceID",
                  url: "$${__value.raw}",
              }],
          },
        },
    ],
};
```

### Log Panels (Loki Datasource)

`datasourceUid: "loki"`

| Type | Title | LogQL | Options |
|------|-------|-------|---------|
| logs | Error Logs | `{service_name="$service"} \|= "error" \| logfmt \| level = "error"` | showTime, wrapLogMessage, enableLogDetails, sortOrder: Descending |
| logs | Structured Logs | `{service_name="$service"} \| json \| __error__=""` | showLabels, prettifyLogMessage, enableLogDetails |
| timeseries | Log Volume by Level | `sum(count_over_time({service_name="$service"} \| json \| __error__="" [1m])) by (level)` | drawStyle: bars, stacking: normal |

### Logs Explorer Dashboard (Loki)

`uid: "logs-explorer"`, tags: `["logs", "loki", "explorer"]`, refresh: `30s`, `schemaVersion: 39`

Variables: `$service` = `label_values(service_name)` (Loki), `$level` = custom `debug,info,warn,error,fatal` (multi, includeAll)

| Type | Title | LogQL | h,w,x,y |
|------|-------|-------|----------|
| timeseries | Log Volume | `sum(count_over_time({service_name="$service"} \| json \| level =~ "$level" \| __error__="" [1m])) by (level)` | 6,24,0,0 |
| logs | Log Stream | `{service_name="$service"} \| json \| level =~ "$level" \| __error__=""` | 18,24,0,6 |

Log Volume: `drawStyle: "bars"`, `stacking: { mode: "normal" }`. Log Stream: `showLabels`, `prettifyLogMessage`, `enableLogDetails`.

### Recommended Tab Structure (Logs Explorer)

- **Volume** tab: Log volume timeseries with level breakdown
- **Stream** tab: Live log stream with filtering
- **Errors** tab: Error-only view with extracted fields
