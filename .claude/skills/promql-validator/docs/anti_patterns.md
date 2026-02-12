# PromQL Anti-Patterns

## Detection Table

| # | Anti-Pattern | Severity | Detection | Fix | Why |
|---|-------------|----------|-----------|-----|-----|
| 1 | Unbounded selectors (`m{}` or bare `m`) | warning | No label filters | Add `{job="...", instance="..."}` | Scans entire TSDB index, causing timeouts and high memory usage |
| 2 | High-cardinality labels (user_id, request_id, UUID) | warning | Label with >1000 unique values | Use low-cardinality: job, instance, status, method | Millions of series cause OOM and slow compaction |
| 3 | Wildcard regex (`{path=~".*"}`) | warning | Broad regex pattern | Constrain with additional filters | Defeats inverted index optimization, forces full scan |
| 4 | Missing `rate()` on counter | warning | `_total`/`_count`/`_sum`/`_bucket` without rate | `rate(counter[5m])` | Raw counter is monotonically increasing, not useful for dashboards or alerting |
| 5 | `rate()` on gauge | warning | rate/irate on `_bytes`/`_usage`/`_percent` | Direct value or `avg_over_time()` | Gauges represent current state; `rate()` computes derivative which is meaningless |
| 6 | `rate()` without range vector | error | `rate(metric)` missing `[duration]` | `rate(metric[5m])` | Range vector is required syntax; Prometheus cannot compute rate without time window |
| 7 | Excessive subquery range (>7d) | warning | `[90d:1m]` | Recording rules or `[7d:5m]` | Materializes millions of intermediate samples, causing OOM |
| 8 | Regex for exact match | info | `{status=~"200"}` | `{status="200"}` | Exact match uses O(1) inverted index lookup; regex requires pattern evaluation (5-10x slower) |
| 9 | Complex query without recording rules | info | 3+ functions, >150 chars, nested aggs | Create `level:metric:operations` recording rule | Pre-computation at scrape time reduces query-time cost 10-40x |
| 10 | Filter after aggregation | warning | `sum(rate(m[5m])) and {job="api"}` | `sum(rate(m{job="api"}[5m]))` | Aggregation first processes all series, then discards most -- filter early to reduce cardinality |
| 11 | Averaging quantiles | error | `avg(m{quantile="0.95"})` | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))` | Quantiles are non-additive: avg(p99_a, p99_b) is NOT the p99 of a+b |
| 12 | Division with mismatched labels | warning | Different label sets in numerator/denominator | Align filters or aggregate to match | Mismatched labels produce partial results or many-to-many errors |
| 13 | Misplaced `offset` | error | `metric offset 1h [5m]` | `metric[5m] offset 1h` | Syntax error: offset must follow the range vector, not precede it |
| 14 | Multiple OR for same label | info | `m{j="a"} or m{j="b"} or m{j="c"}` | `m{j=~"a\|b\|c"}` | Single regex alternation is one query execution vs N separate queries merged |
| 15 | Aggregation without `by()`/`without()` | info | `sum(rate(m[5m]))` | `sum by (job) (rate(m[5m]))` | Produces single-series result losing all dimensional data for debugging |
| 16 | Aggregation order for ratios | info | `sum(a/b)` vs `sum(a)/sum(b)` | Choose based on intent | `sum(a/b)` = average of per-instance ratios; `sum(a)/sum(b)` = overall ratio (usually what you want) |
| 17 | `irate()` with long range (>5m) | warning | `irate(m[1h])` | `rate(m[1h])` or `irate(m[2m])` | `irate()` only uses last 2 samples -- extra range is wasted lookback, not averaged |
| 18 | `rate()` range too short (<2m) | warning | `rate(m[30s])` | `rate(m[2m])` | Needs >=3 samples (4x scrape interval) for reliable extrapolation; shorter ranges produce noisy/empty results |
| 19 | `histogram_quantile` without `rate()` | warning | Raw bucket counts | `rate(m_bucket[5m])` inside | Raw buckets are cumulative counters; without `rate()`, you get lifetime percentiles, not recent |
| 20 | `histogram_quantile` without `le` in `by()` | warning | `sum by (job)` missing `le` | `sum by (job, le)` | Without `le`, bucket boundaries are lost and percentile computation fails |
| 21 | Summary quantiles with aggregation | error | Quantiles are non-additive | Use histograms for cross-instance aggregation | Pre-computed quantiles cannot be meaningfully averaged or summed across instances |
| 22 | Redundant nesting | info | `avg(avg_over_time(m[5m]))` when intent is temporal avg only | `avg_over_time(m[5m])` or `avg by (job) (avg_over_time(m[5m]))` | Outer avg without `by()` over temporal avg is identity for single-series, or unclear for multi-series |
| 23 | Missing `group_left`/`group_right` in joins | error | `m * on(l) info_metric` | `m * on(l) group_left(labels) info_metric` | Without group modifier, many-to-one joins are rejected by Prometheus |
| 24 | `absent()` with aggregation | warning | `absent(sum(m))` | `group(present_over_time(m[r])) unless group(m)` | Aggregation returns empty set (not absent vector) when no input, so absent() always returns empty |
| 25 | `absent()` with `by()` | error | `absent(m) by (l)` | `count(present_over_time(m[5m])) by (label)` | absent() returns single-element vector with fixed labels; by() is syntactically invalid |
| 26 | Mixed metric types in arithmetic | warning | counter / gauge + summary combined | Separate queries per metric type | Different types have incompatible semantics (cumulative vs current vs distribution) |
| 27 | `holt_winters()` (deprecated Prom 3.0) | warning | Deprecated function | `double_exponential_smoothing()` | Renamed for clarity in 3.0; old name will be removed |
| 28 | `predict_linear()` with short range (<10m) | warning | Insufficient data for prediction | Use `[10m]+` range | Linear regression needs sufficient data points; <10m with 30s scrape = <20 points |
| 29 | Division by `rate(counter)` | info | NaN if denominator is 0 | `or vector(0)` or `> 0` filter | Zero-traffic periods produce NaN, breaking dashboards and alert evaluations |
| 30 | Dimensions in metric names | info | `http_requests_GET_total` | Use labels: `http_requests_total{method="GET"}` | Embedding dimensions in names prevents aggregation and increases series count |
| 31 | Unanchored regex | info | `{env=~"prod-.*"}` | `{env=~"^prod-.*"}` | Unanchored regex scans all label values; anchored enables prefix-based index optimization |
| 32 | Unquoted UTF-8 metric names (3.0+) | error | `http.server.request.duration{job="api"}` | `{"http.server.request.duration", job="api"}` | OTEL dot-separated names require quoted syntax; unquoted dots cause parse errors |
| 33 | Native histogram feature flag (3.9+) | info | `--enable-feature=native-histograms` | `scrape_native_histograms: true` in scrape config | Feature flag is no-op since 3.9; only scrape config activates native histograms |

## Checklist

- [ ] All metrics have specific label filters (at least `job`) to bound cardinality
- [ ] `rate()` on counters, not on gauges -- correct function for metric type
- [ ] Exact match `=` over regex `=~` where possible for index efficiency
- [ ] `rate()` range >= 2-4m, `irate()` range <= 5m -- appropriate time windows
- [ ] Aggregations have `by()`/`without()` clauses for explicit label control
- [ ] Not averaging pre-calculated quantiles -- use histogram_quantile() instead
- [ ] `histogram_quantile` includes `rate()` and `le` label for correct percentiles
- [ ] Subquery ranges reasonable (<7d) -- use recording rules for longer
- [ ] Complex/frequent queries use recording rules for 10-40x speedup
- [ ] `info()` considered for metadata joins (3.0+ experimental) instead of manual group_left
- [ ] Native histogram functions used where available (no `le` in `by()`)
- [ ] Regex patterns anchored with `^` for prefix index optimization
- [ ] UTF-8 metric names (OTEL dot-separated) use quoted syntax `{"metric.name"}`
- [ ] `keep_firing_for` used on alerts prone to flapping (3.0+ stable)
