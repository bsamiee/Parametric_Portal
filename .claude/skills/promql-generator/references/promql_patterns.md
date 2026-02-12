# PromQL Query Patterns

## RED Method (Request-Driven Services)

| Signal | PromQL |
|--------|--------|
| Request rate | `sum(rate(http_requests_total{job="api"}[5m]))` |
| Request rate by endpoint | `sum by (endpoint) (rate(http_requests_total{job="api"}[5m]))` |
| Error ratio (0-1) | `sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` |
| Success rate | `1 - (sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])))` |
| Latency P95 (classic) | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` |
| Latency P95 (native, 3.8+) | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds[5m])))` |
| Latency P95 by endpoint | `histogram_quantile(0.95, sum by (endpoint, le) (rate(http_request_duration_seconds_bucket[5m])))` |
| Avg latency | `sum(rate(http_request_duration_seconds_sum[5m])) / sum(rate(http_request_duration_seconds_count[5m]))` |
| Avg latency (native, 3.8+) | `histogram_avg(rate(http_request_duration_seconds[5m]))` |

## USE Method (Resources)

| Resource | Signal | PromQL |
|----------|--------|--------|
| CPU | Utilization % | `(1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100` |
| CPU | By instance | `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)` |
| CPU | Saturation | `node_load1 / count without (cpu, mode) (node_cpu_seconds_total{mode="idle"})` |
| Memory | Utilization % | `((node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes) * 100` |
| Memory | Saturation | `rate(node_vmstat_pswpout[5m])` |
| Disk | Utilization % | `((node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes) * 100` |
| Disk | Time to full (h) | `(node_filesystem_avail_bytes / deriv(node_filesystem_avail_bytes[1h])) / 3600` |
| Disk | I/O saturation | `rate(node_disk_io_time_weighted_seconds_total[5m])` |
| Network | MB/s rx/tx | `rate(node_network_receive_bytes_total[5m]) / 1024^2` |
| Network | Errors/s | `rate(node_network_receive_errs_total[5m]) + rate(node_network_transmit_errs_total[5m])` |

## SLO / Burn Rate

Formula: `error_budget = 1 - slo_target`. Budget remaining: `1 - (error_rate / error_budget)`.

| Pattern | PromQL |
|---------|--------|
| Error budget remaining (99.9%) | `1 - (sum(rate(http_requests_total{status_code=~"5.."}[30d])) / sum(rate(http_requests_total[30d]))) / 0.001` |
| Budget consumed % | `(sum(rate(http_requests_total{status_code=~"5.."}[30d])) / sum(rate(http_requests_total[30d]))) / 0.001 * 100` |
| Burn rate (1h window) | `(sum(rate(http_requests_total{status_code=~"5.."}[1h])) / sum(rate(http_requests_total[1h]))) / 0.001` |
| Latency SLO (% under 200ms) | `(sum(rate(http_request_duration_seconds_bucket{le="0.2"}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))) * 100` |
| Latency SLO (native, 3.8+) | `histogram_fraction(0, 0.2, rate(http_request_duration_seconds[5m])) * 100` |

### Multi-Window Burn Rate Alerts (Google SRE)

```promql
# Page: 2% budget in 1h (burn rate 14.4), long AND short window
(sum(rate(http_requests_total{status_code=~"5.."}[1h])) / sum(rate(http_requests_total[1h]))) > 14.4 * 0.001
and
(sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) > 14.4 * 0.001

# Ticket: 5% budget in 6h (burn rate 6)
(sum(rate(http_requests_total{status_code=~"5.."}[6h])) / sum(rate(http_requests_total[6h]))) > 6 * 0.001
and
(sum(rate(http_requests_total{status_code=~"5.."}[30m])) / sum(rate(http_requests_total[30m]))) > 6 * 0.001
```

| Burn Rate | Budget Consumed | Exhaust Time | Severity |
|-----------|-----------------|-------------|----------|
| 1 | 100% / 30d | 30 days | None |
| 6 | 5% / 6h | 5 days | Ticket |
| 14.4 | 2% / 1h | ~2 days | Page |
| 36 | 5% / 1h | ~20 hours | Page (urgent) |

## Alerting Patterns

| Pattern | PromQL |
|---------|--------|
| CPU > 80% | `(1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 > 80` |
| Error rate > 5% | `(sum(rate(errors_total[5m])) / sum(rate(requests_total[5m]))) > 0.05` |
| Disk < 10% free | `(node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 < 10` |
| P95 latency > 1s | `histogram_quantile(0.95, sum by (le) (rate(latency_bucket[5m]))) > 1` |
| Traffic spike > 50% | `((rate(requests_total[5m]) - rate(requests_total[5m] offset 5m)) / rate(requests_total[5m] offset 5m)) > 0.5` |
| Metric missing | `absent(up{job="critical-service"})` |
| No data 10m | `absent_over_time(metric[10m])` |
| Anomaly (3.5+, experimental) | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` |
| Staleness (3.5+, experimental) | `time() - ts_of_last_over_time(up{job="api"}[1h]) > 120` |
| Latency SLO (native, 3.8+) | `(1 - histogram_fraction(0, 0.2, sum by (job) (rate(m[5m])))) > 0.1` |

### keep_firing_for (3.0+ stable)

Prevents alert flapping when condition briefly clears during evaluation. Alert stays firing for the specified duration after expr becomes false. Use for intermittent conditions that require continued attention.

| Duration | Use When |
|----------|----------|
| 5m | Brief oscillations during rollouts (e.g., DeploymentReplicasMismatch) |
| 10m | Error rate spikes that oscillate around threshold during partial outages |
| 15m | SLO violations and burn rates that briefly resolve then recur |

```yaml
- alert: HighErrorRate
  expr: error_ratio > 0.05
  for: 5m
  keep_firing_for: 10m    # Stays firing 10m after condition clears
```

## Cardinality Control (3.0+ experimental)

| Pattern | PromQL | Use When |
|---------|--------|----------|
| Sample N series | `limitk(10, http_requests_total{job="api"})` | Exploration, debugging, cardinality investigation |
| Deterministic % sample | `limit_ratio(0.1, rate(http_requests_total{job="api"}[5m]))` | Cost-effective trend estimation on high-cardinality metrics |
| Complement (remaining 90%) | `limit_ratio(-0.9, rate(http_requests_total{job="api"}[5m]))` | Precisely those series NOT returned by 0.1 |

`limitk` and `limit_ratio` use deterministic hash-based sampling -- same series are selected across evaluations for consistent results.

## Time-Based Patterns

| Pattern | PromQL |
|---------|--------|
| Compare vs 1h ago | `metric - metric offset 1h` |
| % change from yesterday | `((metric - metric offset 1d) / metric offset 1d) * 100` |
| Business hours only | `metric and hour() >= 9 and hour() < 17` |
| Weekdays only | `metric and day_of_week() > 0 and day_of_week() < 6` |
| Subquery (max 5m rate over 30m) | `max_over_time(rate(metric[5m])[30m:1m])` |
| Forecast (+4h) | `predict_linear(metric[1h], 4*3600)` |
| Value drift in range (3.7+) | `last_over_time(m[1h]) - first_over_time(m[1h])` |

## Vector Matching and Joins

| Operator | Purpose | Example |
|----------|---------|---------|
| `on (labels)` | Match on specific labels | `a + on (job) b` |
| `ignoring (labels)` | Match ignoring labels | `a + ignoring (pod) b` |
| `group_left (labels)` | Many-to-one, copy from right | `rate(requests[5m]) * on (job, instance) group_left (version) app_info` |
| `group_right (labels)` | One-to-many, copy from left | `info * on (service) group_right (version) sum by (service) (rate(requests[5m]))` |

```promql
# Enrich with app version (manual join)
rate(http_requests_total[5m]) * on (job, instance) group_left (version) app_version_info

# info() -- automatic metadata enrichment (3.0+, experimental, replaces manual group_left)
info(rate(http_requests_total[5m]))
info(rate(http_requests_total[5m]), {k8s_cluster=~".+"})

# K8s: CPU with pod owner
sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
* on (namespace, pod) group_left (owner_name, owner_kind) kube_pod_owner

# Match different label names via label_replace
label_replace(metric_a, "host", "$1", "server", "(.*)") * on (host) group_left () metric_b
```

Pitfalls: always pair `group_left`/`group_right` with `on()` because without explicit label matching, Prometheus attempts full-label matching which rarely succeeds for info metrics. Aggregate before joining to reduce cardinality. Avoid high-cardinality join labels.

## Ratio and Efficiency Patterns

| Pattern | PromQL |
|---------|--------|
| Cache hit ratio | `rate(cache_hits_total[5m]) / (rate(cache_hits_total[5m]) + rate(cache_misses_total[5m]))` |
| Queue drain time (s) | `queue_size / rate(queue_processed_total[5m])` |
| Pool utilization | `(active_connections / max_connections) * 100` |

## Recording Rule Naming

Format: `level:metric:operations`

```yaml
- record: job:http_requests:rate5m
  expr: sum by (job) (rate(http_requests_total[5m]))
- record: job_endpoint:http_latency:p95
  expr: histogram_quantile(0.95, sum by (job, endpoint, le) (rate(http_request_duration_seconds_bucket[5m])))
# Native histogram equivalent (no le needed)
- record: job:http_latency:p95_native
  expr: histogram_quantile(0.95, sum by (job) (rate(http_request_duration_seconds[5m])))
```
