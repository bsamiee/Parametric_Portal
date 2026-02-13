# [H1][BEST_PRACTICES]
>**Dictum:** *PromQL optimization follows metric type, cardinality, and aggregation rules.*

<br>

## [1][RULES]
>**Dictum:** *Rules encode proven query optimization patterns.*

<br>

| [INDEX] | [RULE]                                                                           | [RATIONALE]                                                                                                                                     |
| :-----: | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | **Always include label filters (at least `job`).**                               | Unbounded queries match all series, causing timeouts because Prometheus must scan the entire TSDB index.                                        |
|   [2]   | **`=` over `=~` for exact values.**                                              | Exact match uses inverted index lookup (O(1)); regex requires pattern evaluation across all label values (5-10x slower).                        |
|   [3]   | **`rate()` on counters, never gauges.**                                          | Counters are cumulative; `rate()` handles resets and extrapolates. Gauges represent current state -- `rate()` produces meaningless derivatives. |
|   [4]   | **`*_over_time()` or direct for gauges.**                                        | `avg_over_time()` for smoothing, `max_over_time()` for peaks, `deriv()` for trend direction, `predict_linear()` for forecasting.                |
|   [5]   | **`sum by (le)` before `histogram_quantile()`.**                                 | Missing `le` produces incorrect percentile estimates because bucket boundaries are lost during aggregation.                                     |
|   [6]   | **`rate()` inside aggregation for histograms.**                                  | `rate()` on `_bucket` before `sum` because rate handles counter resets per-series before cross-series aggregation.                              |
|   [7]   | **Never average pre-calculated quantiles.**                                      | Quantiles are non-additive: `avg(p99_a, p99_b)` is NOT the p99 of `a + b`. Use `histogram_quantile()` on buckets instead.                       |
|   [8]   | **Avoid high-cardinality labels in aggregations.**                               | `user_id`, `request_id`, `IP`, `UUID` cause series explosion (millions of unique values) leading to OOM and slow queries.                       |
|   [9]   | **Range >= 4x scrape interval for counter functions.**                           | Shorter ranges may contain <2 samples, producing empty/noisy results. With 30s scrape interval: minimum `[2m]`.                                 |
|  [10]   | **`[5m]` real-time, `[1h]`+ trends.**                                            | Balance responsiveness vs smoothness: shorter ranges detect spikes faster but are noisier.                                                      |
|  [11]   | **`by()` to keep, `without()` to remove labels.**                                | Explicit label control prevents accidental dimension loss. `without()` is more maintainable when keeping many labels.                           |
|  [12]   | **Recording rules for expensive repeated queries.**                              | Pre-computation at scrape time reduces query-time evaluation cost by 10-40x for complex expressions.                                            |
|  [13]   | **Layer recording rules (instance -> job -> cluster).**                          | Build metrics incrementally so higher-level rules consume lower-level pre-computed results.                                                     |
|  [14]   | **`for` duration in alerts to avoid transients.**                                | 5m short (fast detection, some noise), 10-15m sustained, 30m+ stable (capacity/trend alerts).                                                   |
|  [15]   | **Anchor regex patterns: `=~"^prod-.*"`.**                                       | Unanchored regex scans all values; anchored patterns enable prefix-based index optimization.                                                    |
|  [16]   | **Use `info()` for metadata joins (3.0+ experimental).**                         | Replaces verbose `* on(labels) group_left(extra_labels) info_metric` with `info(rate(m[5m]))`.                                                  |
|  [17]   | **Activate native histograms (3.9+).**                                           | `scrape_native_histograms: true` eliminates `le` label, reduces series cardinality by 10-100x.                                                  |
|  [18]   | **Use `keep_firing_for` on flapping alerts (3.0+).**                             | Prevents alert flapping when condition briefly clears during evaluation; keeps alert firing for specified duration.                             |
|  [19]   | **Use `limitk`/`limit_ratio` for cardinality exploration (3.0+, experimental).** | Deterministic hash-based sampling reduces query cost for debugging and trend estimation.                                                        |
|  [20]   | **Use `histogram_fraction` for latency SLOs (3.8+, native).**                    | Exact fraction under threshold without bucket boundary interpolation errors -- strictly better than classic `_bucket{le="X"} / _count`.         |

---
## [2][ANTI_PATTERNS]
>**Dictum:** *Anti-patterns cause performance degradation and incorrect results.*

<br>

| [INDEX] | [BAD]                                            | [FIX]                                                       | [WHY]                                                               |
| :-----: | ------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------- |
|   [1]   | **`rate(requests_total[5m])`**                   | `rate(requests_total{job="api"}[5m])`.                      | Unbounded query scans entire TSDB.                                  |
|   [2]   | **`metric{label=~"value"}`**                     | `metric{label="value"}`.                                    | Regex for exact match wastes CPU on pattern evaluation.             |
|   [3]   | **`rate(memory_bytes[5m])`**                     | `avg_over_time(memory_bytes[5m])`.                          | `rate()` on gauge produces meaningless derivative.                  |
|   [4]   | **`http_requests_total` raw**                    | `rate(http_requests_total[5m])`.                            | Raw counter is monotonically increasing, not useful for dashboards. |
|   [5]   | **`avg(metric{quantile="0.95"})`**               | `histogram_quantile(0.95, sum by (le) (rate(bucket[5m])))`. | Averaging quantiles is mathematically invalid.                      |
|   [6]   | **`histogram_quantile(0.95, rate(bucket[5m]))`** | Add `sum by (le)` wrapper.                                  | Per-instance buckets produce per-instance quantiles, not aggregate. |
|   [7]   | **`sum by (user_id) (requests)`**                | `sum by (service) (requests)`.                              | High-cardinality label causes series explosion.                     |
|   [8]   | **`holt_winters(m[1h], 0.5, 0.5)`**              | `double_exponential_smoothing(m[1h], 0.5, 0.5)`.            | `holt_winters` deprecated in Prometheus 3.0.                        |

---
## [3][PRE_DEPLOY_CHECKLIST]
>**Dictum:** *Pre-deploy validation catches performance and correctness issues before production.*

<br>

- [ ] Label filters present (at least `job`) to bound cardinality.
- [ ] Exact match `=` used where possible for index efficiency.
- [ ] Correct function for metric type (rate on counters, direct/over_time on gauges).
- [ ] Proper aggregation with `by()` or `without()` for explicit label control.
- [ ] Range >= 4x scrape interval (typically `[2m]` minimum with 30s scrape).
- [ ] No high-cardinality labels in aggregations (user_id, request_id, IP).
- [ ] Recording rule if expensive + frequent (3+ functions or >150 chars).
- [ ] Recording rule follows `level:metric:operations` naming convention.
- [ ] Native histogram functions used where available (no `le` in `by()`).
- [ ] `info()` considered for metadata enrichment instead of manual `group_left` joins.
- [ ] `keep_firing_for` used on alerts prone to flapping (error rates, SLO burn rates).
- [ ] `limitk`/`limit_ratio` considered for cardinality exploration and cost-effective sampling.
- [ ] Regex patterns anchored with `^` for prefix index optimization.
