# PromQL Best Practices

## Metric Type Rules

| Type | Suffixes | Use | Avoid | Why |
|------|----------|-----|-------|-----|
| Counter | `_total`, `_count`, `_sum`, `_bucket` | `rate(m[5m])`, `increase(m[1h])` | Raw values | Counters are cumulative; raw value is monotonically increasing, useless for dashboards |
| Gauge | `_bytes`, `_usage`, `_percent`, `_celsius`, `_ratio`, `_info` | Direct value, `avg_over_time(m[5m])` | `rate()`, `irate()` | Gauges represent current state; `rate()` produces meaningless derivatives |
| Histogram | `_bucket` + `_sum` + `_count` | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))` | Missing `rate()` or `le` label | Raw buckets are cumulative counters; `le` is needed for bucket boundary identification |
| Summary | `quantile="..."` label | `rate(m_sum[5m]) / rate(m_count[5m])` | `avg(m{quantile="0.95"})` | Quantiles are non-additive: averaging/summing them is mathematically invalid |

## Native Histograms (stable since 3.8, no flag since 3.9)

| Classic | Native |
|---------|--------|
| Separate `_bucket`/`_sum`/`_count` series | Single opaque time series |
| Requires `le` in `by()` | No `le` needed (bucket boundaries encoded internally) |
| `histogram_quantile(0.95, sum by (job, le) (rate(m_bucket[5m])))` | `histogram_quantile(0.95, sum by (job) (rate(m[5m])))` |
| High cardinality (10-30 series per histogram) | Single series per histogram |

Native functions: `histogram_avg`, `histogram_stddev`, `histogram_stdvar`, `histogram_count`, `histogram_sum`, `histogram_fraction` -- all require `rate()` input because they operate on counter-like data.

Activation: `scrape_native_histograms: true` in scrape config (feature flag is no-op since 3.9).

## Label Filtering

```promql
# Filter early, aggregate late -- reduces series scanned before expensive operations
sum(rate(http_requests_total{job="api", status="200"}[5m]))

# Exact > regex (5-10x faster) because exact uses O(1) inverted index lookup
{status="200"}              -- not {status=~"200"}

# Regex for alternation -- single query execution vs N separate queries merged
{status=~"200|201|204"}     -- not multiple OR queries
{path!~"/health|/metrics"}  -- negative regex for exclusions

# Anchor regex for prefix optimization -- unanchored scans all values
{env=~"^prod-.*"}           -- not {env=~"prod-.*"}
```

## Aggregation

```promql
# Always specify grouping to preserve dimensional data for debugging
sum by (job, instance) (rate(m[5m]))     -- by() to keep specific labels
sum without (pod, container) (rate(m[5m])) -- without() to drop high-cardinality labels (more maintainable when keeping many)
```

## Time Ranges

| Function | Range | Rationale |
|----------|-------|-----------|
| `rate()` | >= 4x scrape interval; **enforced minimum: `[2m]`** (120s) | Needs >= 3 samples for reliable extrapolation; checker flags `< 2m` |
| `irate()` | `[2m]` to `[5m]` | Only uses last 2 samples -- extra range is wasted lookback |
| Subqueries | < 7d; use recording rules for longer | Materializes intermediate samples, high memory/CPU cost |
| `predict_linear()` | >= `[10m]`; `[1h]+` for production | Linear regression needs sufficient data points for reliable predictions |

## Recording Rules

Naming: `level:metric:operations` (e.g., `job:http_requests:rate5m`)

Use when: query runs frequently, is complex (3+ functions), spans long ranges, or is slow (>1s). Pre-computation at scrape time provides 10-40x speedup.

```yaml
groups:
  - name: recordings
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total[5m]))
      - record: job:http_requests:error_rate5m
        expr: |
          sum by (job) (rate(http_requests_total{status=~"5.."}[5m]))
          / sum by (job) (rate(http_requests_total[5m]))
```

## Common Patterns

```promql
# Error rate -- sum(errors)/sum(total) gives overall ratio (not avg of per-instance ratios)
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100

# Histogram average (classic)
rate(http_request_duration_seconds_sum[5m]) / rate(http_request_duration_seconds_count[5m])
# Histogram average (native, 3.8+) -- single function, no _sum/_count needed
histogram_avg(rate(http_request_duration_seconds[5m]))

# Compare to baseline
rate(http_requests_total[5m]) / rate(http_requests_total[5m] offset 1d)

# Absent metric alert
absent(up{job="critical-service"})

# Info metric join (manual)
rate(http_requests_total[5m]) * on (job, instance) group_left (version) service_info
# Info metric join (3.0+ experimental) -- automatic metadata enrichment
info(rate(http_requests_total[5m]))

# Anomaly detection (3.5+ experimental) -- MAD-based z-score
m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])

# Latency SLO with native histograms (3.8+) -- fraction of requests under threshold
histogram_fraction(0, 0.2, rate(http_request_duration_seconds[5m])) * 100
```

## Quick Reference

| Pattern | Example |
|---------|---------|
| Per-second rate | `rate(http_requests_total[5m])` |
| Total increase | `increase(requests_total[1h])` |
| Gauge direct | `node_memory_usage_bytes` |
| Gauge smoothed | `avg_over_time(cpu_percent[5m])` |
| Percentile (classic) | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))` |
| Percentile (native) | `histogram_quantile(0.95, sum(rate(m[5m])))` |
| Top N | `topk(10, sum by (pod) (rate(m[5m])))` |
| Absent check | `absent(up{job="api"})` |
| Offset compare | `rate(m[5m] offset 1h)` |
| Metadata join | `info(rate(m[5m]))` (3.0+ experimental) |
| Anomaly detection | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` (3.5+ experimental) |
| Cardinality sample | `limitk(10, http_requests_total{job="api"})` (3.0+ experimental) |
| Trend estimation | `limit_ratio(0.1, rate(http_requests_total{job="api"}[5m]))` (3.0+ experimental) |
