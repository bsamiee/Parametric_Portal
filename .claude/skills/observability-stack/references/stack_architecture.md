# Stack Architecture Reference

> **Deployed:** Alloy -> Prometheus -> Grafana (metrics only). Logs/traces -> `otelcol.exporter.debug` (discarded).
> **Versions:** Alloy 1.13+ (OTel Collector v0.142.0), Prometheus 3.9+ (native histograms stable, feature flag is no-op), Grafana 12.3+ (dashboard schema v2, tabs, switch variables)
> **Canonical:** `infrastructure/src/deploy.ts` (207 LOC)
> **Promtail EOL:** March 2, 2026 -- use Alloy as unified collector (convert Promtail configs via `alloy convert --source-format=promtail`)

## Topology

```
App (Effect OTEL, deploy.ts:94-97) --OTLP(:4317/:4318)--> Alloy --remote_write--> Prometheus(:9090)
                                                             |--debug sink--> (logs discarded)
                                                             \--debug sink--> (traces discarded)
Grafana(:3000) --PromQL--> Prometheus
```

| Signal | Alloy Pipeline (deploy.ts:29-36) | Destination |
|--------|----------------------------------|-------------|
| Metrics | `otelcol.receiver.otlp` -> `otelcol.exporter.prometheus` -> `prometheus.remote_write` | Prometheus (:9090) |
| Logs | `otelcol.receiver.otlp` -> `otelcol.exporter.debug` | Discarded (`verbosity = "basic"`) |
| Traces | `otelcol.receiver.otlp` -> `otelcol.exporter.debug` | Discarded (`verbosity = "basic"`) |

### Alloy Configuration Syntax (deploy.ts:29-36)

Formerly called "River syntax" (renamed in Alloy 1.8+). The `_Ops.alloy(promUrl)` factory generates a complete Alloy config with:
- OTLP receiver on `0.0.0.0:4317` (gRPC) and `0.0.0.0:4318` (HTTP)
- `otelcol.exporter.prometheus` converting OTLP metrics to Prometheus exposition format
- `prometheus.remote_write` pushing to `${promUrl}/api/v1/write`
- Debug exporter for logs and traces (discard with `verbosity = "basic"`)

## deploy.ts Resource Mapping

### Cloud (K8s) -- deploy.ts:147-154

| Component | Workload | Storage | Service | Ports | Lines |
|-----------|----------|---------|---------|-------|-------|
| Alloy | DaemonSet | -- | ClusterIP (`grpc:4317`, `http:4318`, `metrics:12345`) | 4317, 4318, 12345 | 147-150 |
| Prometheus | Deployment (`_k8sObserve`) | PVC (env-driven `storageGi`) | ClusterIP | 9090 | 151-152 |
| Grafana | Deployment (`_k8sObserve`) | PVC (env-driven `storageGi`) | ClusterIP | 3000 | 151-153 |

**Alloy DaemonSet details (deploy.ts:148-149):**
- Container args: `['run', '/etc/alloy/config.alloy']`
- Resources: `limits: { cpu: '200m', memory: '256Mi' }, requests: { cpu: '100m', memory: '128Mi' }`
- Volume: ConfigMap `observe-alloy-cfg` mounted at `/etc/alloy`
- Labels: `{ app: 'alloy', stack: 'parametric', tier: 'observe' }`

**`_k8sObserve(ns, items)` (deploy.ts:120-126):**
Array-driven factory creating 4 resources per item: PVC + ConfigMap + Deployment + Service.

Item shape: `{ name: 'grafana' | 'prometheus', image, port, cmd, config, configFile, configPath, dataPath, storageGi }`.

Prometheus item (deploy.ts:152):
- `cmd`: `['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--web.enable-remote-write-receiver', '--storage.tsdb.retention.time=${retentionDays}d']`
- `config`: `_Ops.prometheus('alloy')` -- scrape config targeting `alloy:12345` + `localhost:9090`
- `configPath`: `/etc/prometheus`, `dataPath`: `/prometheus`

Grafana item (deploy.ts:153):
- `cmd`: `[]` (default entrypoint)
- `config`: `_Ops.grafana(promUrl)` -- Prometheus datasource provisioning YAML
- `configPath`: `/etc/grafana/provisioning/datasources`, `dataPath`: `/var/lib/grafana`

### Selfhosted (Docker) -- deploy.ts:187-189

| Component | Resource | Config Injection | Volume | Line |
|-----------|----------|-----------------|--------|------|
| Alloy | `docker.Container` | `uploads: [{ content, file: '/etc/alloy/config.alloy' }]` | -- | 187 |
| Prometheus | `docker.Container` | `uploads: [{ content, file: '/etc/prometheus/prometheus.yml' }]` | `_Ops.dockerVol('observe-prom-vol', ...)` at `/prometheus` | 188 |
| Grafana | `docker.Container` | `uploads: [{ content, file: '/etc/grafana/provisioning/datasources/datasources.yaml' }]` | `_Ops.dockerVol('observe-grafana-vol', ...)` at `/var/lib/grafana` | 189 |

Shared helpers: `_Ops.dockerNets(networkId)` (deploy.ts:52), `_Ops.dockerPort(port)` (deploy.ts:53), `_Ops.dockerVol(id, name, path)` (deploy.ts:54).

Internal DNS: Selfhosted containers resolve each other by container name (e.g., `observe-alloy`, `observe-prometheus`). Names from `_Ops.names` (deploy.ts:68).

## Prometheus Version Matrix

| Version | Release | Key Changes | Feature Flags |
|---------|---------|-------------|---------------|
| 3.0 | Nov 2024 | Native histograms (experimental), UTF-8 metric names, `holt_winters` -> `double_exponential_smoothing`, `info()` | `native-histograms`, `promql-experimental-functions` |
| 3.3 | Apr 2025 | `irate()`/`idelta()` support native histograms | Same as 3.0 |
| 3.5 LTS | Jul 2025 | `mad_over_time`, `ts_of_min/max/last_over_time`, `sort_by_label` | `promql-experimental-functions` |
| 3.6 | Sep 2025 | `step()` function, `min()`/`max()` on durations | `promql-duration-expr` |
| 3.7 | Oct 2025 | `first_over_time`, `ts_of_first_over_time`, anchored rate | `promql-extended-range-selectors` |
| 3.8 | Nov 2025 | **Native histograms stable** (config-driven, not flag-driven) | `native-histograms` changes default of `scrape_native_histograms` |
| 3.9 | Jan 2026 | `native-histograms` flag is **no-op**, `/api/v1/features` endpoint | None needed for native histograms |
| 3.10 | Feb 2026 | Maintenance release, stability improvements | No new flags |

### Feature Flag Reference

| Flag | Status (3.9+) | Functions Gated |
|------|---------------|-----------------|
| `promql-experimental-functions` | Active | `info()`, `double_exponential_smoothing()`, `mad_over_time()`, `sort_by_label()`, `ts_of_*_over_time()`, `first_over_time()`, `limitk()`, `limit_ratio()` |
| `promql-duration-expr` | Active | `step()`, `min(duration)`, `max(duration)` |
| `promql-extended-range-selectors` | Active | Anchored and smoothed rate |
| `native-histograms` | **No-op since 3.9** | Use `scrape_native_histograms: true` in config instead |

## Prometheus 3.9+ Configuration

### Native Histograms (Stable)

Native histograms are **stable** since Prometheus 3.8. Since 3.9, the `--enable-feature=native-histograms` flag is a complete no-op. Enable via `scrape_native_histograms: true` in the global scrape config (per-job override also supported).

```typescript
// deploy.ts:71 -- _Ops.prometheus(alloyHost) generates this config
// To add native histogram support, extend the global section:
const prometheusConfig = `global:
  scrape_interval: 15s
  scrape_native_histograms: true
scrape_configs:
  - job_name: alloy
    static_configs: [{ targets: ["${alloyHost}:${_CONFIG.ports.alloyMetrics}"] }]
  - job_name: prometheus
    static_configs: [{ targets: ["localhost:${_CONFIG.ports.prometheus}"] }]`;
```

| Feature | Prometheus 3.8+ Status | How to Enable |
|---------|----------------------|---------------|
| Native histograms | Stable | `scrape_native_histograms: true` (global or per-job) |
| NHCB (Classic Buckets) | Stable | Automatic with `scrape_native_histograms: true` |
| `info()` function | Stable | Available in PromQL; correlates info-type metrics |
| UTF-8 metric names | Stable | No config needed; metric names can contain UTF-8 |
| Remote write 2.0 | Stable | `--web.enable-remote-write-receiver` (already in deploy.ts:152) |

`scrape_native_histograms: true` enables NHCB scraping and switches content negotiation to prefer protobuf exposition format. Per-job override supported via `scrape_native_histograms` on individual `scrape_configs` entries.

### Prometheus Command Flags (deploy.ts:152)

| Flag | Purpose |
|------|---------|
| `--config.file=/etc/prometheus/prometheus.yml` | Config location (mounted from ConfigMap) |
| `--storage.tsdb.path=/prometheus` | TSDB data directory (PVC mount) |
| `--web.enable-remote-write-receiver` | Accept remote_write from Alloy |
| `--storage.tsdb.retention.time=${retentionDays}d` | Data retention (env-driven, default 15d) |

## Resource Sizing

| Tier | Scale | Alloy (cpu/mem/storage/replicas) | Prometheus (cpu/mem/storage/replicas) | Grafana (cpu/mem/storage/replicas) |
|------|-------|---------------------------------|--------------------------------------|------------------------------------|
| Small (dev) | < 10k series | 0.25c/256Mi/--/1 | 0.5c/512Mi/10Gi/1 | 0.25c/256Mi/1Gi/1 |
| Medium (prod) | < 100k series | 0.5c/512Mi/--/DaemonSet | 2c/4Gi/50Gi/1 | 0.5c/512Mi/5Gi/2 |
| Large (HA) | > 100k series | 1c/1Gi/--/DaemonSet | 4c/8Gi/100Gi/2 (HA) | 1c/1Gi/10Gi/3 |

**deploy.ts current sizing:** Alloy: `200m/256Mi` limits, `100m/128Mi` requests (line 148). Prometheus/Grafana: no resource limits (via `_k8sObserve`, line 123 -- gap).

Large tier: PVC storage class `gp3` (AWS) or equivalent SSD. Prometheus HA: use `--storage.tsdb.min-block-duration=2h` + `--storage.tsdb.max-block-duration=2h` for Thanos/Cortex compaction compatibility.

## Extension: Adding Loki + Tempo

### Loki 3.6+

| Concern | Detail |
|---------|--------|
| Image | `grafana/loki:3.6.x` |
| Resource | `docker.Container` (selfhosted) or `_k8sObserve` entry (cloud) |
| Schema | TSDB v13: `store: "tsdb"`, `schema: "v13"`, `period: "24h"` -- **immutable after first deploy** |
| Alloy change | Replace logs `otelcol.exporter.debug` with `otelcol.exporter.loki` -> `loki.write` |
| Grafana change | Add Loki datasource to `_Ops.grafana()` (deploy.ts:59) |
| Runtime env | `OTEL_LOGS_EXPORTER=otlp` (change from `none` at deploy.ts:95) |
| Sizing (small) | 0.5c/512Mi/10Gi |
| Sizing (large) | 4c/8Gi/100Gi+, RF=3, `zone_awareness_enabled: true` |
| Storage (prod) | S3 backend with `replication_factor: 3` |

**Loki 3.6 features:** Horizontally scalable compactor (no single-point-of-failure), OTel tracing library refactoring (lower overhead), TSDB v13 improvements.

### Tempo 2.7+

| Concern | Detail |
|---------|--------|
| Image | `grafana/tempo:2.7.x` |
| Resource | `docker.Container` (selfhosted) or `_k8sObserve` entry (cloud) |
| Alloy change | Replace traces `otelcol.exporter.debug` with `otelcol.exporter.otlp` -> Tempo |
| Grafana change | Add Tempo datasource + derived fields on Loki for trace correlation |
| Runtime env | `OTEL_TRACES_EXPORTER=otlp` (change from `none` at deploy.ts:97) |

### Adding to `_k8sObserve` (cloud)

```typescript
// Extend the _k8sObserve call at deploy.ts:151-154 with Loki and Tempo items:
_k8sObserve(ns.metadata.name, [
    // existing
    { name: 'prometheus', ... },
    { name: 'grafana', ... },
    // extension (requires _k8sObserve type union update for name field)
    { name: 'loki', image: 'grafana/loki:3.6.2', port: 3100, cmd: ['-config.file=/etc/loki/config.yaml'], config: lokiConfig, configFile: 'config.yaml', configPath: '/etc/loki', dataPath: '/loki', storageGi: 50 },
    { name: 'tempo', image: 'grafana/tempo:2.7.1', port: 3200, cmd: ['-config.file=/etc/tempo/config.yaml'], config: tempoConfig, configFile: 'config.yaml', configPath: '/etc/tempo', dataPath: '/tempo', storageGi: 50 },
]);
```

### Loki Config Template

```yaml
auth_enabled: false
server:
  http_listen_port: 3100
common:
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
schema_config:
  configs:
    - from: "2025-01-01"
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
storage_config:
  filesystem:
    directory: /loki/chunks
```

**WARNING:** `schema_config` is **immutable after first deploy**. Changing `store`, `schema`, or `period` requires a new period config entry with a future `from` date, not modification of existing entries.
