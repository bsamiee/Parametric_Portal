# Alert Rules Reference

> **Status:** Not currently deployed. `_k8sObserve` (deploy.ts:120-126) provisions scrape config only. Rules require separate ConfigMap + `rule_files` mount.
> **Prerequisite:** Application-level alerts (HTTP, Queue, DB) require the app to expose corresponding metrics via OTEL SDK.
> **Namespace:** `parametric` (deploy.ts:18). All K8s alert rules deploy to this namespace.
> **Prometheus:** 3.9+ (native histograms stable, `--enable-feature=native-histograms` is no-op since 3.9). Classic `_bucket` expressions below remain compatible.
> **RATIONALE for `for:` durations:** 0m = already happened (e.g., OOMKill), 2-3m = critical SLO violations, 5m = standard detection, 10m = sustained conditions, 30m = trend confirmation.
> **`keep_firing_for` (3.0+ stable):** Prevents alert flapping when condition briefly clears during evaluation. Use 5m for rollout oscillations, 10m for error rate fluctuations, 15m for SLO violations that briefly resolve then recur.

## Recording Rules

Group: `http-recording-rules`, interval: `15s` (matches deploy.ts:71 `scrape_interval: 15s`)

| Record | Expression | Why Pre-compute |
|--------|-----------|-----------------|
| `http:requests:rate5m` | `sum(rate(http_server_request_duration_seconds_count[5m])) by (service_name, http_method, http_status_code)` | Avoids re-computing rate() in every dashboard panel and alert |
| `http:latency:p50_5m` | `histogram_quantile(0.50, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le, service_name))` | Quantile computation is expensive; pre-compute for dashboard use |
| `http:latency:p95_5m` | `histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le, service_name))` | P95 is the primary SLI for latency-sensitive services |
| `http:latency:p99_5m` | `histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds_bucket[5m])) by (le, service_name))` | P99 catches tail latency issues invisible at P95 |
| `http:errors:rate5m` | `sum(rate(http_server_request_duration_seconds_count{http_status_code=~"5.."}[5m])) by (service_name)` | Isolates server errors from client errors (4xx) |
| `http:errors:ratio5m` | `http:errors:rate5m / http:requests:rate5m` | Normalized error rate; independent of traffic volume |

### Native Histogram Alternative (Prometheus 3.8+ stable, 3.9+ no flag)

With `scrape_native_histograms: true` (see `stack_architecture.md`), quantile recording rules can use `histogram_quantile()` directly on native histogram series -- no `_bucket` suffix needed. The classic `_bucket` expressions above remain compatible and work regardless of native histogram status.

| Record | Expression | Why |
|--------|-----------|-----|
| `http:latency:p50_5m` | `histogram_quantile(0.50, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | No `_bucket`/`le` needed |
| `http:latency:p95_5m` | `histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | Single series per histogram |
| `http:latency:p99_5m` | `histogram_quantile(0.99, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | No `_bucket`/`le` needed |
| `http:latency:avg_5m` | `histogram_avg(sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | Replaces `_sum/_count` division |
| `http:latency:stddev_5m` | `histogram_stddev(sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | Latency variability |
| `http:latency:fraction_under_200ms` | `histogram_fraction(0, 0.2, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | Precise SLO fraction |
| `http:latency:fraction_under_500ms` | `histogram_fraction(0, 0.5, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))` | Precise SLO fraction |

`histogram_fraction` provides exact fraction under threshold without bucket boundary interpolation errors -- strictly better than classic `_bucket{le="0.2"} / _count` for SLO measurement.

## HTTP Alerts

Metric: `http_server_request_duration_seconds` histogram (OTEL SDK, exposed via Alloy -> Prometheus pipeline).

| Alert | Expression | For | Severity | Threshold Rationale |
|-------|-----------|-----|----------|---------------------|
| HttpHighLatencyP99 | `http:latency:p99_5m > 2` | 5m | warning | 2s: exceeds typical user-facing SLA (200ms-1s target); indicates slow queries or external dependency degradation. 5m `for` avoids firing on transient spikes. |
| HttpCriticalLatencyP99 | `http:latency:p99_5m > 5` | 3m | critical | 5s: user-facing requests timing out (browser default 30s, mobile 10s); 3m `for` confirms sustained degradation before paging. |
| HttpHighErrorRate | `http:errors:ratio5m > 0.01` | 5m | warning | 1% 5xx: statistically significant error rate above baseline noise; early signal before user impact compounds. `keep_firing_for: 10m` -- error spikes oscillate around threshold during partial outages. |
| HttpCriticalErrorRate | `http:errors:ratio5m > 0.05` | 3m | critical | 5% 5xx: 1-in-20 requests failing; user-visible degradation warranting immediate investigation. Page on-call. `keep_firing_for: 15m` -- at this severity, brief clearance does not mean resolution. |
| HttpLatencySLOViolation | `(1 - histogram_fraction(0, 0.2, sum(rate(http_server_request_duration_seconds[5m])) by (service_name))) > 0.1` | 5m | warning | Native histogram (3.8+): >10% of requests exceeding 200ms SLO. `histogram_fraction` provides precise measurement without bucket boundary interpolation. 5m `for` filters transient spikes. `keep_firing_for: 15m` -- SLO violations often resolve briefly then recur. |
| HttpNoRequests | `sum(rate(http_server_request_duration_seconds_count[5m])) by (service_name) == 0` | 10m | critical | Zero traffic for 10m: service is down, routing is broken, or load balancer health check is failing. Long `for` avoids firing during planned maintenance windows. |

## Container Alerts

Requires: kube-state-metrics + cAdvisor (standard K8s). Applies to namespace `parametric` (deploy.ts:18).

| Alert | Expression | For | Severity | Threshold Rationale |
|-------|-----------|-----|----------|---------------------|
| ContainerCpuThrottling | `sum(rate(container_cpu_cfs_throttled_seconds_total{namespace="parametric"}[5m])) by (pod, container) > 0.25` | 10m | warning | 25% throttle rate: measurably degrades P99 latency (each throttle event pauses the container for up to 100ms CFS period). 10m `for` filters burst workloads. |
| ContainerMemoryHigh | `container_memory_usage_bytes{namespace="parametric"} / container_spec_memory_limit_bytes > 0.85` | 10m | warning | 85%: OOMKill imminent. Linux OOM killer activates when cgroup limit is reached; 85% gives ~15% headroom for GC spikes. Deploy.ts sets `limits == requests` (line 168) for Guaranteed QoS. |
| ContainerOOMKill | `increase(kube_pod_container_status_restarts_total{namespace="parametric"}[1h]) > 0 and kube_pod_container_status_last_terminated_reason{reason="OOMKilled"} == 1` | 0m | critical | Already OOMKilled: immediate alert (0m `for`). Memory limit is already breached; increase limits or fix the leak. |
| PodRestartLoop | `increase(kube_pod_container_status_restarts_total{namespace="parametric"}[1h]) > 3` | 5m | critical | 3 restarts/hr: crash loop confirmed. K8s exponential backoff means 3 restarts within 1hr indicates persistent failure, not transient startup issue. |

### deploy.ts Resource Context

- API container: `limits == requests` for CPU and memory (deploy.ts:168) -- Guaranteed QoS, OOMKill only at exact limit
- Alloy container: `limits: { cpu: '200m', memory: '256Mi' }, requests: { cpu: '100m', memory: '128Mi' }` (deploy.ts:148) -- Burstable QoS
- Prometheus/Grafana: no resource limits set (via `_k8sObserve`, deploy.ts:123) -- BestEffort QoS, first evicted under pressure

## Queue Alerts

Metrics: `job_queue_depth`, `job_queue_processed_total`, `job_queue_failed_total` (app-exposed via OTEL SDK).

| Alert | Expression | For | Severity | Threshold Rationale |
|-------|-----------|-----|----------|---------------------|
| QueueDepthHigh | `job_queue_depth > 1000` | 10m | warning | 1000 jobs: typical queue processes ~100/min; 1000 pending means ~10min backlog. 10m `for` confirms growth trend, not burst ingestion. |
| QueueDepthCritical | `job_queue_depth > 5000` | 5m | critical | 5000 jobs: 5x warning threshold; ~50min backlog at normal throughput. Scale workers or investigate blocked consumers. |
| QueueProcessingStalled | `rate(job_queue_processed_total[5m]) == 0 and job_queue_depth > 0` | 10m | critical | Zero throughput with pending work: all workers are dead, connection pool exhausted, or Redis is unreachable. 10m confirms it is not a brief pause between batches. |
| QueueHighFailureRate | `rate(job_queue_failed_total[5m]) / rate(job_queue_processed_total[5m]) > 0.1` | 10m | warning | 10% failure: significantly above baseline (~0.1%); check DLQ, error patterns, and downstream dependencies. |

## Database Alerts

Metrics: `db_pool_active_connections`, `db_pool_max_connections`, `db_query_duration_seconds` (app-exposed via OTEL SDK).

| Alert | Expression | For | Severity | Threshold Rationale |
|-------|-----------|-----|----------|---------------------|
| DbConnectionPoolExhausted | `db_pool_active_connections / db_pool_max_connections > 0.85` | 5m | warning | 85%: new queries may queue waiting for a connection. PostgreSQL default `max_connections=100`; at 85 active, connection acquisition latency rises sharply. |
| DbConnectionPoolSaturated | `db_pool_active_connections / db_pool_max_connections > 0.95` | 2m | critical | 95%: 5 connections remain; imminent connection failures. 2m `for` because at this utilization, failures cascade quickly. |
| DbSlowQueries | `histogram_quantile(0.95, rate(db_query_duration_seconds_bucket[5m])) > 1` | 10m | warning | P95 > 1s: queries taking 20x longer than typical (<50ms). Review query plans via `EXPLAIN ANALYZE`, check for missing indexes, lock contention. |

## Certificate Alerts

Metric: `probe_ssl_earliest_cert_expiry` (blackbox exporter). Relevant when Ingress TLS is configured (deploy.ts:175).

| Alert | Expression | For | Severity | Threshold Rationale |
|-------|-----------|-----|----------|---------------------|
| CertificateExpiringSoon | `(probe_ssl_earliest_cert_expiry - time()) / 86400 < 30` | 1h | warning | 30d: buffer for manual renewal or debugging failed automated renewal (cert-manager). 1h `for` avoids flapping on temporary clock skew. |
| CertificateExpiringCritical | `(probe_ssl_earliest_cert_expiry - time()) / 86400 < 7` | 1h | critical | 7d: automated renewal has failed (Let's Encrypt renews at 30d). Manual intervention required. |

## ConfigMap Provisioning

Deploy rules as a ConfigMap in namespace `parametric` (deploy.ts:18), then mount into Prometheus and add `rule_files` to the scrape config.

```typescript
// Separate from _k8sObserve items -- rules are a shared ConfigMap, not per-component
const rules = new k8s.core.v1.ConfigMap("prometheus-rules", {
    metadata: _Ops.meta(ns.metadata.name, 'prometheus', 'prometheus-rules'),
    data: {
        "recording-rules.yml": JSON.stringify(recordingRules),
        "http-alerts.yml": JSON.stringify(httpAlerts),
        "container-alerts.yml": JSON.stringify(containerAlerts),
        "queue-alerts.yml": JSON.stringify(queueAlerts),
        "database-alerts.yml": JSON.stringify(databaseAlerts),
        "certificate-alerts.yml": JSON.stringify(certAlerts),
    },
});
// Mount into Prometheus Deployment via additional volume + volumeMount
// Add rule_files: ["/etc/prometheus/rules/*.yml"] to _Ops.prometheus() config
```

### Integration with `_k8sObserve`

The `_k8sObserve` factory (deploy.ts:120-126) creates one ConfigMap per item for the component's own config. Alert rules require a second volume mount on the Prometheus Deployment. Two approaches:

1. **Extend `_k8sObserve` item shape** -- add optional `extraVolumes` / `extraVolumeMounts` fields
2. **Post-creation patch** -- use `k8s.apps.v1.DeploymentPatch` (SSA, Pulumi v4.23+) to add the rules volume

Approach 2 is less invasive and does not require changing the shared factory signature.
