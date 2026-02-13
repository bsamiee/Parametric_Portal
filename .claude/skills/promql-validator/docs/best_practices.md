# [H1][BEST_PRACTICES]
>**Dictum:** *Best practices prevent errors before they occur.*

<br>

## [1][METRIC_TYPE_RULES]
>**Dictum:** *Correct function selection depends on metric type.*

<br>

| [INDEX] | [TYPE]        | [SUFFIXES]                                                     | [USE]                                                         | [AVOID]                         | [WHY]                                                                                   |
| :-----: | ------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
|   [1]   | **Counter**   | `_total`, `_count`, `_sum`, `_bucket`.                         | `rate(m[5m])`, `increase(m[1h])`.                             | Raw values.                     | Counters are cumulative; raw value is monotonically increasing, useless for dashboards. |
|   [2]   | **Gauge**     | `_bytes`, `_usage`, `_percent`, `_celsius`, `_ratio`, `_info`. | Direct value, `avg_over_time(m[5m])`.                         | `rate()`, `irate()`.            | Gauges represent current state; `rate()` produces meaningless derivatives.              |
|   [3]   | **Histogram** | `_bucket` + `_sum` + `_count`.                                 | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))`. | Missing `rate()` or `le` label. | Raw buckets are cumulative counters; `le` is needed for bucket boundary identification. |
|   [4]   | **Summary**   | `quantile="..."` label.                                        | `rate(m_sum[5m]) / rate(m_count[5m])`.                        | `avg(m{quantile="0.95"})`.      | Quantiles are non-additive: averaging/summing them is mathematically invalid.           |

---
## [2][NATIVE_HISTOGRAMS]
>**Dictum:** *Native histograms reduce cardinality by orders of magnitude.*

Stable since 3.8, no flag since 3.9.

<br>

| [INDEX] | [CLASSIC]                                                          | [NATIVE]                                                |
| :-----: | ------------------------------------------------------------------ | ------------------------------------------------------- |
|   [1]   | Separate `_bucket`/`_sum`/`_count` series.                         | Single opaque time series.                              |
|   [2]   | Requires `le` in `by()`.                                           | No `le` needed (bucket boundaries encoded internally).  |
|   [3]   | `histogram_quantile(0.95, sum by (job, le) (rate(m_bucket[5m])))`. | `histogram_quantile(0.95, sum by (job) (rate(m[5m])))`. |
|   [4]   | High cardinality (10-30 series per histogram).                     | Single series per histogram.                            |

Native functions: `histogram_avg`, `histogram_stddev`, `histogram_stdvar`, `histogram_count`, `histogram_sum`, `histogram_fraction` -- all require `rate()` input because they operate on counter-like data.

Activation: `scrape_native_histograms: true` in scrape config (feature flag is no-op since 3.9).

---
## [3][LABEL_FILTERING]
>**Dictum:** *Early filtering reduces cardinality before expensive operations.*

<br>

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

---
## [4][AGGREGATION]
>**Dictum:** *Explicit grouping preserves dimensional data for debugging.*

<br>

```promql
# Always specify grouping to preserve dimensional data for debugging
sum by (job, instance) (rate(m[5m]))     -- by() to keep specific labels
sum without (pod, container) (rate(m[5m])) -- without() to drop high-cardinality labels (more maintainable when keeping many)
```

---
## [5][TIME_RANGES]
>**Dictum:** *Appropriate time ranges prevent noisy or empty results.*

<br>

| [INDEX] | [FUNCTION]             | [RANGE]                                                     | [RATIONALE]                                                              |
| :-----: | ---------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
|   [1]   | **`rate()`**           | >= 4x scrape interval; **enforced minimum: `[2m]`** (120s). | Needs >= 3 samples for reliable extrapolation; checker flags `< 2m`.     |
|   [2]   | **`irate()`**          | `[2m]` to `[5m]`.                                           | Only uses last 2 samples -- extra range is wasted lookback.              |
|   [3]   | **Subqueries**         | < 7d; use recording rules for longer.                       | Materializes intermediate samples, high memory/CPU cost.                 |
|   [4]   | **`predict_linear()`** | >= `[10m]`; `[1h]+` for production.                         | Linear regression needs sufficient data points for reliable predictions. |

---
## [6][RECORDING_RULES]
>**Dictum:** *Recording rules pre-compute expensive queries at scrape time.*

<br>

Naming: `level:metric:operations` (e.g., `job:http_requests:rate5m`).

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

---
## [7][COMMON_PATTERNS]
>**Dictum:** *Patterns encode proven solutions to recurring problems.*

<br>

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

---
## [8][QUICK_REFERENCE]
>**Dictum:** *Quick references accelerate lookup during incident response.*

<br>

| [INDEX] | [PATTERN]                | [EXAMPLE]                                                                         |
| :-----: | ------------------------ | --------------------------------------------------------------------------------- |
|   [1]   | **Per-second rate**      | `rate(http_requests_total[5m])`.                                                  |
|   [2]   | **Total increase**       | `increase(requests_total[1h])`.                                                   |
|   [3]   | **Gauge direct**         | `node_memory_usage_bytes`.                                                        |
|   [4]   | **Gauge smoothed**       | `avg_over_time(cpu_percent[5m])`.                                                 |
|   [5]   | **Percentile (classic)** | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))`.                     |
|   [6]   | **Percentile (native)**  | `histogram_quantile(0.95, sum(rate(m[5m])))`.                                     |
|   [7]   | **Top N**                | `topk(10, sum by (pod) (rate(m[5m])))`.                                           |
|   [8]   | **Absent check**         | `absent(up{job="api"})`.                                                          |
|   [9]   | **Offset compare**       | `rate(m[5m] offset 1h)`.                                                          |
|  [10]   | **Metadata join**        | `info(rate(m[5m]))` (3.0+ experimental).                                          |
|  [11]   | **Anomaly detection**    | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` (3.5+ experimental).        |
|  [12]   | **Cardinality sample**   | `limitk(10, http_requests_total{job="api"})` (3.0+ experimental).                 |
|  [13]   | **Trend estimation**     | `limit_ratio(0.1, rate(http_requests_total{job="api"}[5m]))` (3.0+ experimental). |
