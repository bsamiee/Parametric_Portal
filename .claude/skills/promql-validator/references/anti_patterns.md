# [H1][ANTI_PATTERNS]
>**Dictum:** *Anti-patterns waste resources or produce incorrect results.*

<br>

33 anti-patterns grouped by domain. Each table uses per-section indexing; severity levels: **error** (query fails or produces wrong results), **warning** (performance or semantic issue), **info** (optimization opportunity).

## [1][SELECTOR_AND_FILTERING]
>**Dictum:** *Early, specific filtering prevents full-index scans.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                     | [SEVERITY] | [FIX]                                               | [WHY]                                                                    |
| :-----: | ------------------------------------------------------------------ | ---------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
|   [1]   | **Unbounded selectors** (`m{}` or bare `m`).                       | warning    | Add `{job="...", instance="..."}`.                  | Scans entire TSDB index, causing timeouts and high memory usage.         |
|   [2]   | **High-cardinality labels** (user_id, request_id, UUID).           | warning    | Use low-cardinality: job, instance, status, method. | Millions of series cause OOM and slow compaction.                        |
|   [3]   | **Wildcard regex** (`{path=~".*"}`).                               | warning    | Constrain with additional filters.                  | Defeats inverted index optimization, forces full scan.                   |
|   [4]   | **Regex for exact match** (`{status=~"200"}`).                     | info       | Use `{status="200"}`.                               | Exact match uses O(1) inverted index; regex is 5-10x slower.             |
|   [5]   | **Filter after aggregation** (`sum(rate(m[5m])) and {job="api"}`). | warning    | `sum(rate(m{job="api"}[5m]))`.                      | Aggregation processes all series first, then discards most.              |
|   [6]   | **Multiple OR for same label** (`m{j="a"} or m{j="b"} or ...`).    | info       | `m{j=~"a\|b\|c"}`.                                  | Single regex alternation is one query vs N separate queries merged.      |
|   [7]   | **Unanchored regex** (`{env=~"prod-.*"}`).                         | info       | `{env=~"^prod-.*"}`.                                | Unanchored scans all label values; anchored enables prefix optimization. |

---
## [2][COUNTER_AND_GAUGE]
>**Dictum:** *Metric type determines which functions are valid.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                                     | [SEVERITY] | [FIX]                              | [WHY]                                                                           |
| :-----: | ---------------------------------------------------------------------------------- | ---------- | ---------------------------------- | ------------------------------------------------------------------------------- |
|   [1]   | **Missing `rate()` on counter** (`_total`/`_count`/`_sum`/`_bucket` without rate). | warning    | `rate(counter[5m])`.               | Raw counter is monotonically increasing, not useful for dashboards or alerting. |
|   [2]   | **`rate()` on gauge** (rate/irate on `_bytes`/`_usage`/`_percent`).                | warning    | Direct value or `avg_over_time()`. | Gauges represent current state; `rate()` computes meaningless derivative.       |
|   [3]   | **`rate()` without range vector** (`rate(metric)` missing `[duration]`).           | error      | `rate(metric[5m])`.                | Range vector is required syntax; Prometheus cannot compute rate without window. |
|   [4]   | **Mixed metric types in arithmetic** (counter / gauge + summary combined).         | warning    | Separate queries per metric type.  | Different types have incompatible semantics (cumulative vs current vs dist).    |

---
## [3][HISTOGRAM_AND_QUANTILE]
>**Dictum:** *Histogram and quantile misuse produces mathematically invalid results.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                                 | [SEVERITY] | [FIX]                                                         | [WHY]                                                                            |
| :-----: | ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
|   [1]   | **Averaging quantiles** (`avg(m{quantile="0.95"})`).                           | error      | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))`. | Quantiles are non-additive: avg(p99_a, p99_b) is NOT the p99 of a+b.             |
|   [2]   | **`histogram_quantile` without `rate()`** (raw bucket counts).                 | warning    | Wrap in `rate(m_bucket[5m])`.                                 | Raw buckets are cumulative counters; without `rate()` you get lifetime values.   |
|   [3]   | **`histogram_quantile` without `le` in `by()`** (`sum by (job)` missing `le`). | warning    | `sum by (job, le)`.                                           | Without `le`, bucket boundaries are lost and percentile computation fails.       |
|   [4]   | **Summary quantiles with aggregation** (quantiles are non-additive).           | error      | Use histograms for cross-instance aggregation.                | Pre-computed quantiles cannot be meaningfully averaged or summed.                |
|   [5]   | **Native histogram feature flag** (`--enable-feature=native-histograms`).      | info       | `scrape_native_histograms: true` in scrape config.            | Feature flag is no-op since 3.9; only scrape config activates native histograms. |

---
## [4][TIME_RANGE]
>**Dictum:** *Incorrect time ranges produce noisy, empty, or expensive results.*

<br>

| [INDEX] | [ANTI_PATTERN]                                  | [SEVERITY] | [FIX]                            | [WHY]                                                                       |
| :-----: | ----------------------------------------------- | ---------- | -------------------------------- | --------------------------------------------------------------------------- |
|   [1]   | **Excessive subquery range** (`[90d:1m]`).      | warning    | Recording rules or `[7d:5m]`.    | Materializes millions of intermediate samples, causing OOM.                 |
|   [2]   | **`irate()` with long range** (`irate(m[1h])`). | warning    | `rate(m[1h])` or `irate(m[2m])`. | `irate()` only uses last 2 samples -- extra range is wasted lookback.       |
|   [3]   | **`rate()` range too short** (`rate(m[30s])`).  | warning    | `rate(m[2m])`.                   | Needs >=3 samples (4x scrape interval) for reliable extrapolation.          |
|   [4]   | **`predict_linear()` with short range** (<10m). | warning    | Use `[10m]+` range.              | Linear regression needs sufficient data; <10m with 30s scrape = <20 points. |

---
## [5][AGGREGATION]
>**Dictum:** *Aggregation without explicit grouping destroys diagnostic data.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                        | [SEVERITY] | [FIX]                                            | [WHY]                                                                             |
| :-----: | --------------------------------------------------------------------- | ---------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
|   [1]   | **Complex query without recording rules** (3+ functions, >150 chars). | info       | Create `level:metric:operations` recording rule. | Pre-computation at scrape time reduces query-time cost 10-40x.                    |
|   [2]   | **Aggregation without `by()`/`without()`** (`sum(rate(m[5m]))`).      | info       | `sum by (job) (rate(m[5m]))`.                    | Produces single-series result losing all dimensional data for debugging.          |
|   [3]   | **Aggregation order for ratios** (`sum(a/b)` vs `sum(a)/sum(b)`).     | info       | Choose based on intent.                          | `sum(a/b)` = avg of per-instance ratios; `sum(a)/sum(b)` = overall ratio.         |
|   [4]   | **Redundant nesting** (`avg(avg_over_time(m[5m]))`).                  | info       | `avg_over_time(m[5m])` or `avg by (job) (...)`.  | Outer avg without `by()` is identity for single-series, unclear for multi-series. |

---
## [6][JOIN_AND_LABEL]
>**Dictum:** *Label mismatches cause silent data loss or query rejection.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                                       | [SEVERITY] | [FIX]                                            | [WHY]                                                                          |
| :-----: | ------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
|   [1]   | **Division with mismatched labels** (different label sets in numerator/denominator). | warning    | Align filters or aggregate to match.             | Mismatched labels produce partial results or many-to-many errors.              |
|   [2]   | **Missing `group_left`/`group_right`** (`m * on(l) info_metric`).                    | error      | `m * on(l) group_left(labels) info_metric`.      | Without group modifier, many-to-one joins are rejected by Prometheus.          |
|   [3]   | **Dimensions in metric names** (`http_requests_GET_total`).                          | info       | Use labels: `http_requests_total{method="GET"}`. | Embedding dimensions in names prevents aggregation and increases series count. |

---
## [7][SYNTAX_AND_DEPRECATION]
>**Dictum:** *Syntax errors and deprecated functions fail at evaluation time.*

<br>

| [INDEX] | [ANTI_PATTERN]                                                    | [SEVERITY] | [FIX]                                          | [WHY]                                                                         |
| :-----: | ----------------------------------------------------------------- | ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
|   [1]   | **Misplaced `offset`** (`metric offset 1h [5m]`).                 | error      | `metric[5m] offset 1h`.                        | Offset must follow the range vector, not precede it.                          |
|   [2]   | **Unquoted UTF-8 metric names** (`http.server.request.duration`). | error      | `{"http.server.request.duration", job="api"}`. | OTEL dot-separated names require quoted syntax; unquoted causes parse errors. |
|   [3]   | **`holt_winters()` deprecated** (Prom 3.0+).                      | warning    | `double_exponential_smoothing()`.              | Renamed for clarity in 3.0; old name will be removed.                         |

---
## [8][ABSENT_AND_EDGE_CASES]
>**Dictum:** *Edge cases in absent() and division produce silent failures.*

<br>

| [INDEX] | [ANTI_PATTERN]                                             | [SEVERITY] | [FIX]                                             | [WHY]                                                                            |
| :-----: | ---------------------------------------------------------- | ---------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
|   [1]   | **`absent()` with aggregation** (`absent(sum(m))`).        | warning    | `group(present_over_time(m[r])) unless group(m)`. | Aggregation returns empty set when no input, so `absent()` always returns empty. |
|   [2]   | **`absent()` with `by()`** (`absent(m) by (l)`).           | error      | `count(present_over_time(m[5m])) by (label)`.     | `absent()` returns single-element vector; `by()` is syntactically invalid.       |
|   [3]   | **Division by `rate(counter)`** (NaN if denominator is 0). | info       | `or vector(0)` or `> 0` filter.                   | Zero-traffic periods produce NaN, breaking dashboards and alert evaluations.     |

---
## [9][CHECKLIST]
>**Dictum:** *Pre-deploy checklists catch errors that code review misses.*

<br>

- [ ] All metrics have specific label filters (at least `job`) to bound cardinality.
- [ ] `rate()` on counters, not on gauges -- correct function for metric type.
- [ ] Exact match `=` over regex `=~` where possible for index efficiency.
- [ ] `rate()` range >= 2-4m, `irate()` range <= 5m -- appropriate time windows.
- [ ] Aggregations have `by()`/`without()` clauses for explicit label control.
- [ ] Not averaging pre-calculated quantiles -- use `histogram_quantile()` instead.
- [ ] `histogram_quantile` includes `rate()` and `le` label for correct percentiles.
- [ ] Subquery ranges reasonable (<7d) -- use recording rules for longer.
- [ ] Complex/frequent queries use recording rules for 10-40x speedup.
- [ ] `info()` considered for metadata joins (3.0+ experimental) instead of manual `group_left`.
- [ ] Native histogram functions used where available (no `le` in `by()`).
- [ ] Regex patterns anchored with `^` for prefix index optimization.
- [ ] UTF-8 metric names (OTEL dot-separated) use quoted syntax `{"metric.name"}`.
- [ ] `keep_firing_for` used on alerts prone to flapping (3.0+ stable).
