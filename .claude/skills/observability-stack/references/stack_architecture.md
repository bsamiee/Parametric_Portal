# [H1][STACK_ARCHITECTURE]
>**Dictum:** *Architecture topology determines observability data flow.*

<br>

**Deployed:** Alloy -> Prometheus -> Grafana (metrics only). Logs/traces -> `otelcol.exporter.debug` (discarded).<br>
**Versions:** Alloy 1.13.0, Prometheus 3.5.1, Grafana 12.3.2.<br>
**Canonical:** `infrastructure/src/deploy.ts` (207 LOC). **Promtail EOL:** March 2, 2026.

[REFERENCE] Architecture overview and data flow diagram: [->SKILL.md](../SKILL.md#1canonical_implementation).

Alloy config syntax (formerly "River", renamed Alloy 1.8+). `_Ops.alloy(promUrl)` generates: OTLP receiver (4317 gRPC, 4318 HTTP), `otelcol.exporter.prometheus`, `prometheus.remote_write` to `${promUrl}/api/v1/write`, debug exporter for logs/traces.

---
## [1][DEPLOY_TS_RESOURCE_MAPPING]
>**Dictum:** *deploy.ts resource mapping defines the canonical deployment topology.*

<br>

### [1.1][CLOUD_K8S]

| [INDEX] | [COMPONENT]    | [WORKLOAD]  | [STORAGE]  | [SERVICE_PORTS]                      | [LINES]  |
| :-----: | -------------- | ----------- | ---------- | ------------------------------------ | -------- |
|   [1]   | **Alloy**      | DaemonSet.  | --.        | grpc:4317, http:4318, metrics:12345. | 147-150. |
|   [2]   | **Prometheus** | Deployment. | PVC (env). | 9090.                                | 151-152. |
|   [3]   | **Grafana**    | Deployment. | PVC (env). | 3000.                                | 151-153. |

Alloy DaemonSet (deploy.ts:148-149): args `['run', '/etc/alloy/config.alloy']`, resources `limits: 200m/256Mi, requests: 100m/128Mi`, ConfigMap at `/etc/alloy`.

`_k8sObserve(ns, items)` (deploy.ts:120-126): array-driven factory -- PVC + ConfigMap + Deployment + Service per item. Item shape: `{ name, image, port, cmd, config, configFile, configPath, dataPath, storageGi }`.

Prometheus (deploy.ts:152): cmd `['--config.file=/etc/prometheus/prometheus.yml', '--storage.tsdb.path=/prometheus', '--web.enable-remote-write-receiver', '--storage.tsdb.retention.time=${retentionDays}d']`.
Grafana (deploy.ts:153): default entrypoint, datasource provisioning at `/etc/grafana/provisioning/datasources`.

---
### [1.2][SELFHOSTED_DOCKER]

3 `docker.Container` resources. Config via `uploads`, data via `_Ops.dockerVol`. Shared network: `_Ops.dockerNets(networkId)`. Internal DNS: container names from `_Ops.names` (deploy.ts:68).

---
## [2][PROMETHEUS_VERSION_MATRIX]
>**Dictum:** *Version matrix determines available features and required flags.*

<br>

| [INDEX] | [VERSION] | [RELEASE] | [KEY_CHANGES]                                                | [FEATURE_FLAGS]                             |
| :-----: | --------- | --------- | ------------------------------------------------------------ | ------------------------------------------- |
|   [1]   | **3.0**   | Nov 2024  | Native histograms (experimental), UTF-8 names, `info()`.     | `native-histograms`, `promql-experimental`. |
|   [2]   | **3.5.1** | Jul 2025  | `mad_over_time`, `ts_of_*_over_time`, `sort_by_label` (LTS). | `promql-experimental-functions`.            |
|   [3]   | **3.6**   | Sep 2025  | `step()`, duration expressions.                              | `promql-duration-expr`.                     |
|   [4]   | **3.7**   | Oct 2025  | `first_over_time`, anchored rate.                            | `promql-extended-range-selectors`.          |
|   [5]   | **3.8**   | Nov 2025  | Native histograms **stable** (config-driven).                | `native-histograms` changes default.        |
|   [6]   | **3.9**   | Jan 2026  | `native-histograms` flag **no-op**, `/api/v1/features`.      | None needed for native histograms.          |
|   [7]   | **3.10**  | Feb 2026  | Maintenance release, stability.                              | No new flags.                               |

<br>

### [2.1][FEATURE_FLAGS]

| [INDEX] | [FLAG]                                | [STATUS]   | [FUNCTIONS_GATED]                                                          |
| :-----: | ------------------------------------- | ---------- | -------------------------------------------------------------------------- |
|   [1]   | **`promql-experimental-functions`**   | Active.    | `info()`, `double_exponential_smoothing()`, `mad_over_time()`, `limitk()`. |
|   [2]   | **`promql-duration-expr`**            | Active.    | `step()`, `min(duration)`, `max(duration)`.                                |
|   [3]   | **`promql-extended-range-selectors`** | Active.    | Anchored and smoothed rate.                                                |
|   [4]   | **`native-histograms`**               | **No-op**. | Use `scrape_native_histograms: true` in config.                            |

---
### [2.2][NATIVE_HISTOGRAMS]

Enable via `scrape_native_histograms: true` in global or per-job scrape config. Feature flag is no-op since 3.9.

```typescript
// deploy.ts:71 -- extend _Ops.prometheus(alloyHost) for native histograms:
const prometheusConfig = `global:
  scrape_interval: 15s
  scrape_native_histograms: true
scrape_configs:
  - job_name: alloy
    static_configs: [{ targets: ["${alloyHost}:${_CONFIG.ports.alloyMetrics}"] }]
  - job_name: prometheus
    static_configs: [{ targets: ["localhost:${_CONFIG.ports.prometheus}"] }]`;
```

| [INDEX] | [FEATURE]                  | [STATUS] | [ACTIVATION]                                      |
| :-----: | -------------------------- | -------- | ------------------------------------------------- |
|   [1]   | **Native histograms**      | Stable.  | `scrape_native_histograms: true`.                 |
|   [2]   | **NHCB (Classic Buckets)** | Stable.  | Automatic with `scrape_native_histograms: true`.  |
|   [3]   | **`info()` function**      | Stable.  | Available in PromQL.                              |
|   [4]   | **Remote write 2.0**       | Stable.  | `--web.enable-remote-write-receiver` (deploy.ts). |

---
## [3][RESOURCE_SIZING]
>**Dictum:** *Resource sizing prevents OOM kills and CPU throttling at scale.*

<br>

| [INDEX] | [TIER]            | [SCALE]        | [ALLOY]               | [PROMETHEUS]         | [GRAFANA]          |
| :-----: | ----------------- | -------------- | --------------------- | -------------------- | ------------------ |
|   [1]   | **Small (dev)**   | < 10k series.  | 0.25c/256Mi/1.        | 0.5c/512Mi/10Gi/1.   | 0.25c/256Mi/1Gi/1. |
|   [2]   | **Medium (prod)** | < 100k series. | 0.5c/512Mi/DaemonSet. | 2c/4Gi/50Gi/1.       | 0.5c/512Mi/5Gi/2.  |
|   [3]   | **Large (HA)**    | > 100k series. | 1c/1Gi/DaemonSet.     | 4c/8Gi/100Gi/2 (HA). | 1c/1Gi/10Gi/3.     |

Current: Alloy `200m/256Mi` limits (deploy.ts:148). Prometheus/Grafana: no limits (gap).
Large tier: PVC `gp3` (AWS). HA Prometheus: `--storage.tsdb.min-block-duration=2h` + `--storage.tsdb.max-block-duration=2h`.

---
## [4][EXTENSION_LOKI_TEMPO]
>**Dictum:** *Adding Loki and Tempo extends metrics-only to full 3-signal observability.*

<br>

### [4.1][LOKI]

Image `grafana/loki:3.6.x`. Schema: `store: "tsdb"`, `schema: "v13"`, `period: "24h"` -- **immutable after first deploy**.
Alloy: replace logs debug with `otelcol.exporter.loki` -> `loki.write`. Runtime: `OTEL_LOGS_EXPORTER=otlp`.
Sizing: 0.5c/512Mi/10Gi (small), 4c/8Gi/100Gi+ RF=3 (large). S3 backend for production.

---
### [4.2][TEMPO]

Image `grafana/tempo:2.7.x`. Alloy: replace traces debug with `otelcol.exporter.otlp` -> Tempo.
Grafana: add Tempo datasource + derived fields on Loki for trace correlation. Runtime: `OTEL_TRACES_EXPORTER=otlp`.

---
### [4.3][K8S_OBSERVE_EXTENSION]

```typescript
_k8sObserve(ns.metadata.name, [
    { name: 'prometheus', ... },
    { name: 'grafana', ... },
    { name: 'loki', image: 'grafana/loki:3.6.2', port: 3100, cmd: ['-config.file=/etc/loki/config.yaml'],
      config: lokiConfig, configFile: 'config.yaml', configPath: '/etc/loki', dataPath: '/loki', storageGi: 50 },
    { name: 'tempo', image: 'grafana/tempo:2.7.1', port: 3200, cmd: ['-config.file=/etc/tempo/config.yaml'],
      config: tempoConfig, configFile: 'config.yaml', configPath: '/etc/tempo', dataPath: '/tempo', storageGi: 50 },
]);
```

---
### [4.4][LOKI_CONFIG_TEMPLATE]

```yaml
auth_enabled: false
server: { http_listen_port: 3100 }
common: { replication_factor: 1, ring: { kvstore: { store: inmemory } } }
schema_config:
  configs:
    - from: "2025-01-01"
      store: tsdb
      object_store: filesystem
      schema: v13
      index: { prefix: index_, period: 24h }
storage_config: { filesystem: { directory: /loki/chunks } }
```

**WARNING:** `schema_config` is **immutable after first deploy**. Changes require a new period config entry with future `from` date.
