# PromQL Functions & Metric Types Reference

## Metric Types

| Type | Direction | Suffix | Functions | Example |
|------|-----------|--------|-----------|---------|
| **Counter** | Only up | `_total` | `rate()`, `irate()`, `increase()`, `resets()` | `http_requests_total` |
| **Gauge** | Up/down | (unit) | direct, `*_over_time()`, `deriv()`, `predict_linear()` | `memory_usage_bytes` |
| **Histogram** | Up (_bucket) | `_bucket/_sum/_count` | `histogram_quantile()`, `rate()` on sub-metrics | `http_duration_seconds_bucket` |
| **Native Histogram** | Opaque | (none) | `histogram_quantile/count/sum/avg/fraction/stddev/stdvar()` | `http_duration_seconds` |
| **Summary** | Up (_sum) | `{quantile="X"}/_sum/_count` | direct quantile, `rate()` on `_sum/_count` | `rpc_duration_seconds` |

**Naming**: `<namespace>_<subsystem>_<name>_<unit>`. Base units only (seconds not ms, bytes not KB). Counters end `_total`.

| Unit | Suffix | Unit | Suffix |
|------|--------|------|--------|
| Seconds | `_seconds` | Bytes | `_bytes` |
| Ratio 0-1 | `_ratio` | Percentage 0-100 | `_percent` |
| Total count | `_total` | Celsius | `_celsius` |

## Function Decision Tree

| Metric Type | Goal | Function |
|-------------|------|----------|
| Counter | Trends | `rate(m_total[5m])` |
| Counter | Spikes | `irate(m_total[5m])` |
| Counter | Totals | `increase(m_total[1h])` |
| Counter | Restarts | `resets(m_total[1h])` |
| Gauge | Current | direct |
| Gauge | Smoothed | `avg_over_time(m[5m])` |
| Gauge | Peak/trough | `max_over_time(m[1h])` / `min_over_time(m[1h])` |
| Gauge | Trend direction | `deriv(m[10m])` |
| Gauge | Forecast | `predict_linear(m[1h], 4*3600)` |
| Gauge | Anomaly detection | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` (3.5+, experimental) |
| Classic histogram | Percentile | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))` |
| Classic histogram | Average | `sum(rate(m_sum[5m])) / sum(rate(m_count[5m]))` |
| Classic histogram | Fraction under X | `sum(rate(m_bucket{le="0.2"}[5m])) / sum(rate(m_count[5m]))` |
| Native histogram | Percentile | `histogram_quantile(0.95, sum(rate(m[5m])))` -- no `_bucket`/`le` |
| Native histogram | Average | `histogram_avg(rate(m[5m]))` |
| Native histogram | Fraction in range | `histogram_fraction(0, 0.1, rate(m[5m]))` |
| Summary | Percentile | `m{quantile="0.95"}` -- never average quantiles |
| Summary | Average | `sum(rate(m_sum[5m])) / sum(rate(m_count[5m]))` |

## Aggregation Operators

Syntax: `<op> [without|by (<labels>)] (<vector>)`

| Function | Purpose | Example |
|----------|---------|---------|
| `sum` | Total across series | `sum by (job) (rate(requests_total[5m]))` |
| `avg` | Mean across series | `avg by (env) (cpu_usage_percent)` |
| `max` / `min` | Extremes | `max(memory_usage_bytes)` / `min by (node) (disk_available_bytes)` |
| `count` | Series count | `count(up == 1)` |
| `count_values` | Group by value | `count_values("version", app_version)` |
| `topk` / `bottomk` | Top/bottom N by value | `topk(5, rate(requests_total[5m]))` |
| `quantile` | Phi-quantile across series | `quantile(0.95, response_time_seconds)` |
| `stddev` / `stdvar` | Statistical spread | `stddev(response_time_seconds)` |
| `group` | Preserves labels, value=1 | `group(metric)` |
| `limitk` (experimental) | K random samples | `limitk(10, http_requests_total)` |
| `limit_ratio` (experimental) | Sampled subset; negative for complement | `limit_ratio(0.1, http_requests_total)` |

## Rate and Increase

| Function | Returns | Use With | When |
|----------|---------|----------|------|
| `rate(v[r])` | Per-second avg rate | Counters | Graphing trends, throughput |
| `irate(v[r])` | Instant rate (last 2 pts) | Counters | Spike detection, real-time |
| `increase(v[r])` | Total increase in range | Counters | Totals, billing, capacity |
| `resets(v[r])` | Reset count | Counters | Detecting restarts |
| `delta(v[r])` | First-last difference | Gauges | Change over time |
| `idelta(v[r])` | Last 2 samples difference | Gauges | Recent change; supports native histograms (3.3+) |

- `rate()` range >= 4x scrape interval. Handles counter resets. Extrapolates to boundaries.
- `irate()`/`idelta()` support native histograms (3.3+). `irate()` range is max lookback.
- `increase()` = `rate(v) * range_seconds`. Result can be fractional due to extrapolation.

## Range Vector Functions (*_over_time)

| Function | Returns | Use With |
|----------|---------|----------|
| `avg_over_time(v[r])` | Average | Gauges (smoothing) |
| `max_over_time(v[r])` / `min_over_time(v[r])` | Max / Min | Gauges (peak/trough) |
| `sum_over_time(v[r])` | Sum | Gauges |
| `count_over_time(v[r])` | Sample count | Any (scrape health) |
| `stddev_over_time(v[r])` / `stdvar_over_time(v[r])` | Stddev / Variance | Gauges |
| `quantile_over_time(phi, v[r])` | Percentile | Gauges |
| `last_over_time(v[r])` | Last value | Any |
| `first_over_time(v[r])` (3.7+, experimental) | First (oldest) value | Any |
| `present_over_time(v[r])` | 1 if any samples | Any (existence check) |
| `changes(v[r])` | Value change count | Gauges (flapping) |
| `deriv(v[r])` | Per-second derivative (linreg) | Gauges (trend) |
| `predict_linear(v[r], t)` | Predicted value at +t sec | Gauges (forecasting) |
| `double_exponential_smoothing(v[r], sf, tf)` | Smoothed value (3.0+, experimental) | Gauges only |
| `mad_over_time(v[r])` (3.5+, experimental) | Median absolute deviation | Gauges (anomaly detection) |

`double_exponential_smoothing` replaced `holt_winters` in Prometheus 3.0.

`mad_over_time` enables z-score anomaly detection without assuming normal distribution: `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])`.

## Native Histogram Functions (stable since 3.8, no flag since 3.9)

| Function | Returns | Example |
|----------|---------|---------|
| `histogram_quantile(phi, v)` | Percentile (no `le` needed) | `histogram_quantile(0.95, sum(rate(m[5m])))` |
| `histogram_count(v)` | Observation count | `histogram_count(rate(m[5m]))` |
| `histogram_sum(v)` | Sum of observations | `histogram_sum(rate(m[5m]))` |
| `histogram_avg(v)` | Average (sum/count) | `histogram_avg(rate(m[5m]))` |
| `histogram_fraction(lo, hi, v)` | Fraction in range | `histogram_fraction(0, 0.1, rate(m[5m]))` |
| `histogram_stddev(v)` / `histogram_stdvar(v)` | Estimated stddev / variance | `histogram_stddev(rate(m[5m]))` |

- phi range: `0 <= phi <= 1`. Outside returns `+/-Inf`.
- All native histogram functions work with NHCB (classic-to-native conversion).
- `rate()`, `increase()`, `delta()` on native histograms produce gauge histograms (3.9+).

```promql
# Classic: requires le label in aggregation
histogram_quantile(0.95, sum by (le) (rate(http_duration_bucket[5m])))
# Native: le NOT needed
histogram_quantile(0.95, sum(rate(http_duration[5m])))
```

Classic `histogram_quantile` requires: `rate()` on `_bucket` first, then `sum by (le)`.

### Native Histogram Activation (3.9+)

```yaml
# prometheus.yml -- scrape config
scrape_configs:
  - job_name: api
    scrape_native_histograms: true    # Required since 3.8; feature flag is no-op since 3.9
```

## Timestamp Functions

| Function | Returns | Example |
|----------|---------|---------|
| `time()` | Current eval timestamp (unix) | `time() - max(metric_timestamp)` |
| `timestamp(v)` | Sample timestamps | `time() - timestamp(last_backup_success)` |
| `year/month/day_of_month/day_of_week` | Time component (int) | `day_of_week() > 0 and day_of_week() < 6` |
| `hour/minute` | Hour 0-23 / Minute 0-59 | `hour() >= 9 and hour() < 17` |
| `days_in_month` | Days in month (int) | `days_in_month()` |

### Experimental Timestamp Functions

| Function | Flag | Since | Returns | Example |
|----------|------|-------|---------|---------|
| `ts_of_max_over_time(v[r])` | `promql-experimental-functions` | 3.5+ | Timestamp of max | `ts_of_max_over_time(cpu_usage[1h])` |
| `ts_of_min_over_time(v[r])` | `promql-experimental-functions` | 3.5+ | Timestamp of min | `ts_of_min_over_time(memory_avail[1h])` |
| `ts_of_last_over_time(v[r])` | `promql-experimental-functions` | 3.5+ | Timestamp of last sample | `time() - ts_of_last_over_time(metric[1h])` |
| `first_over_time(v[r])` | `promql-experimental-functions` | 3.7+ | First (oldest) value | `last_over_time(m[1h]) - first_over_time(m[1h])` |
| `ts_of_first_over_time(v[r])` | `promql-experimental-functions` | 3.7+ | Timestamp of first sample | `time() - ts_of_first_over_time(metric[7d])` |
| `mad_over_time(v[r])` | `promql-experimental-functions` | 3.5+ | Median absolute deviation | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` |
| `sort_by_label(v, labels...)` | `promql-experimental-functions` | 3.5+ | Sort by label values asc | `sort_by_label(up, "service")` |
| `sort_by_label_desc(v, labels...)` | `promql-experimental-functions` | 3.5+ | Sort by label values desc | `sort_by_label_desc(up, "service")` |
| `step()` | `promql-duration-expr` | 3.6+ | Current evaluation step | Dynamic range alignment |

## Math Functions

| Function | Example |
|----------|---------|
| `abs(v)` | `abs(current_temp - target_temp)` |
| `ceil(v)` / `floor(v)` | `ceil(cpu_count)` / `floor(memory_bytes / 1024^3)` |
| `round(v [, precision])` | `round(response_time, 0.1)` |
| `sqrt(v)` | `sqrt(avg(m^2) - avg(m)^2)` |
| `exp(v)` / `ln(v)` / `log2(v)` / `log10(v)` | `ln(exponential_metric)` |
| `clamp(v, min, max)` | `clamp(metric, 0, 100)` |
| `clamp_min(v, min)` / `clamp_max(v, max)` | `clamp_min(metric, 0)` |
| `sgn(v)` | `sgn(current_temp - target_temp)` -- returns -1/0/1 |

## Trigonometric Functions

`sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `deg`, `rad`, `pi()`

## Label Functions

| Function | Syntax | Example |
|----------|--------|---------|
| `label_replace` | `label_replace(v, dst, repl, src, regex)` | `label_replace(up, "hostname", "$1", "instance", "(.+):\\d+")` |
| `label_join` | `label_join(v, dst, sep, src1, ...)` | `label_join(m, "uid", "-", "cluster", "namespace", "pod")` |
| `info` (experimental) | `info(v [, selector])` | `info(rate(requests[5m]), {k8s_cluster=~".+"})` |

`info()` automatically joins info-metric labels onto the input vector. Replaces manual `* on (...) group_left (...)` for metadata enrichment. Requires `--enable-feature=promql-experimental-functions`.

## Utility Functions

| Function | Returns | Example |
|----------|---------|---------|
| `absent(v)` | 1-element vector if empty | `absent(up{job="critical"})` |
| `absent_over_time(v[r])` | 1 if no samples in range | `absent_over_time(metric[10m])` |
| `scalar(v)` / `vector(s)` | Scalar from vector / vector from scalar | `scalar(sum(up))` / `vector(123)` |
| `sort(v)` / `sort_desc(v)` | Sorted by value | `sort_desc(requests_total)` |

## Prometheus 3.0+ Breaking Changes

| Change | Detail |
|--------|--------|
| Left-open range selectors | Sample at lower time boundary excluded |
| `holt_winters` renamed | Now `double_exponential_smoothing` (experimental flag) |
| Regex `.` matches all | Including newlines |
| UTF-8 metric/label names | `{"metric.name" = "value"}` allowed by default |
| Native histograms stable (3.8) | Activated via `scrape_native_histograms` config, not feature flag |
| Feature flag no-op (3.9) | `--enable-feature=native-histograms` has no effect since 3.9 |
| 3.10 maintenance (Feb 2026) | No new PromQL functions; stability and bug fixes |

## Histogram vs Summary

| Feature | Histogram | Summary |
|---------|-----------|---------|
| Quantile calculation | Server-side | Client-side (pre-configured) |
| Aggregatable across instances | Yes | No (quantiles are non-additive because they lose the underlying distribution) |
| Flexible quantiles at query time | Yes | No (fixed at instrumentation time) |
| **Recommendation** | **Preferred** | Legacy only |
