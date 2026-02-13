# [H1][PROMQL_FUNCTIONS]
>**Dictum:** *Function selection depends on metric type, goal, and Prometheus version.*

<br>

## [1][METRIC_TYPES]
>**Dictum:** *Metric type determines available functions and query patterns.*

<br>

| [INDEX] | [TYPE]                | [DIRECTION]   | [SUFFIX]                      | [FUNCTIONS]                                                  | [EXAMPLE]                       |
| :-----: | --------------------- | ------------- | ----------------------------- | ------------------------------------------------------------ | ------------------------------- |
|   [1]   | **Counter**           | Only up.      | `_total`.                     | `rate()`, `irate()`, `increase()`, `resets()`.               | `http_requests_total`.          |
|   [2]   | **Gauge**             | Up/down.      | (unit).                       | direct, `*_over_time()`, `deriv()`, `predict_linear()`.      | `memory_usage_bytes`.           |
|   [3]   | **Classic Histogram** | Up (_bucket). | `_bucket/_sum/_count`.        | `histogram_quantile()`, `rate()` on sub-metrics.             | `http_duration_seconds_bucket`. |
|   [4]   | **Native Histogram**  | Opaque.       | (none).                       | `histogram_quantile/count/sum/avg/fraction/stddev/stdvar()`. | `http_duration_seconds`.        |
|   [5]   | **Summary**           | Up (_sum).    | `{quantile="X"}/_sum/_count`. | direct quantile, `rate()` on `_sum/_count`.                  | `rpc_duration_seconds`.         |

Naming: `<namespace>_<subsystem>_<name>_<unit>`. Base units only (seconds not ms, bytes not KB). Counters end `_total`.

---
## [2][FUNCTION_DECISION_TREE]
>**Dictum:** *Decision tree maps metric type and goal to the correct function.*

<br>

| [INDEX] | [METRIC_TYPE]         | [GOAL]             | [FUNCTION]                                                            |
| :-----: | --------------------- | ------------------ | --------------------------------------------------------------------- |
|   [1]   | **Counter**           | Trends.            | `rate(m_total[5m])`.                                                  |
|   [2]   | **Counter**           | Spikes.            | `irate(m_total[5m])`.                                                 |
|   [3]   | **Counter**           | Totals.            | `increase(m_total[1h])`.                                              |
|   [4]   | **Counter**           | Restarts.          | `resets(m_total[1h])`.                                                |
|   [5]   | **Gauge**             | Current.           | direct.                                                               |
|   [6]   | **Gauge**             | Smoothed.          | `avg_over_time(m[5m])`.                                               |
|   [7]   | **Gauge**             | Peak/trough.       | `max_over_time(m[1h])` / `min_over_time(m[1h])`.                      |
|   [8]   | **Gauge**             | Trend direction.   | `deriv(m[10m])`.                                                      |
|   [9]   | **Gauge**             | Forecast.          | `predict_linear(m[1h], 4*3600)`.                                      |
|  [10]   | **Gauge**             | Anomaly (3.5+).    | `m > avg_over_time(m[1h]) + 3 * mad_over_time(m[1h])` (experimental). |
|  [11]   | **Classic histogram** | Percentile.        | `histogram_quantile(0.95, sum by (le) (rate(m_bucket[5m])))`.         |
|  [12]   | **Classic histogram** | Average.           | `sum(rate(m_sum[5m])) / sum(rate(m_count[5m]))`.                      |
|  [13]   | **Native histogram**  | Percentile.        | `histogram_quantile(0.95, sum(rate(m[5m])))` -- no `_bucket`/`le`.    |
|  [14]   | **Native histogram**  | Average.           | `histogram_avg(rate(m[5m]))`.                                         |
|  [15]   | **Native histogram**  | Fraction in range. | `histogram_fraction(0, 0.1, rate(m[5m]))`.                            |
|  [16]   | **Summary**           | Percentile.        | `m{quantile="0.95"}` -- never average quantiles.                      |
|  [17]   | **Summary**           | Average.           | `sum(rate(m_sum[5m])) / sum(rate(m_count[5m]))`.                      |

---
## [3][AGGREGATION_OPERATORS]
>**Dictum:** *Aggregation operators control label dimensions and series grouping.*

<br>

Syntax: `<op> [without|by (<labels>)] (<vector>)`

| [INDEX] | [FUNCTION]                   | [PURPOSE]                   | [EXAMPLE]                                              |
| :-----: | ---------------------------- | --------------------------- | ------------------------------------------------------ |
|   [1]   | **`sum` / `avg`**            | Total / Mean.               | `sum by (job) (rate(requests_total[5m]))`.             |
|   [2]   | **`max` / `min`**            | Extremes.                   | `max(memory_usage_bytes)`.                             |
|   [3]   | **`count` / `count_values`** | Series count / Group.       | `count(up == 1)` / `count_values("ver", app_version)`. |
|   [4]   | **`topk` / `bottomk`**       | Top/bottom N.               | `topk(5, rate(requests_total[5m]))`.                   |
|   [5]   | **`quantile`**               | Phi-quantile across series. | `quantile(0.95, response_time_seconds)`.               |
|   [6]   | **`stddev` / `stdvar`**      | Statistical spread.         | `stddev(response_time_seconds)`.                       |
|   [7]   | **`group`**                  | Preserves labels, value=1.  | `group(metric)`.                                       |
|   [8]   | **`limitk` / `limit_ratio`** | Random/ratio sampling.      | `limitk(10, m)` / `limit_ratio(0.1, m)` (3.0+).        |

---
## [4][RATE_AND_INCREASE]
>**Dictum:** *Rate functions handle counter resets and extrapolation.*

<br>

| [INDEX] | [FUNCTION]           | [RETURNS]                  | [USE_WITH] | [WHEN]                                            |
| :-----: | -------------------- | -------------------------- | ---------- | ------------------------------------------------- |
|   [1]   | **`rate(v[r])`**     | Per-second avg rate.       | Counters.  | Graphing trends, throughput.                      |
|   [2]   | **`irate(v[r])`**    | Instant rate (last 2 pts). | Counters.  | Spike detection, real-time.                       |
|   [3]   | **`increase(v[r])`** | Total increase in range.   | Counters.  | Totals, billing, capacity.                        |
|   [4]   | **`resets(v[r])`**   | Reset count.               | Counters.  | Detecting restarts.                               |
|   [5]   | **`delta(v[r])`**    | First-last difference.     | Gauges.    | Change over time.                                 |
|   [6]   | **`idelta(v[r])`**   | Last 2 samples difference. | Gauges.    | Recent change; supports native histograms (3.3+). |

`rate()` range >= 4x scrape interval. Handles counter resets. `irate()`/`idelta()` support native histograms (3.3+).

---
## [5][RANGE_VECTOR_FUNCTIONS]
>**Dictum:** *Range vector functions aggregate samples within a time window.*

<br>

| [INDEX] | [FUNCTION]                                       | [RETURNS]                   | [USE_WITH]                  |
| :-----: | ------------------------------------------------ | --------------------------- | --------------------------- |
|   [1]   | **`avg_over_time` / `sum_over_time`**            | Average / Sum.              | Gauges (smoothing).         |
|   [2]   | **`max_over_time` / `min_over_time`**            | Max / Min.                  | Gauges (peak/trough).       |
|   [3]   | **`quantile_over_time(phi, v[r])`**              | Percentile.                 | Gauges.                     |
|   [4]   | **`last_over_time` / `first_over_time` (3.7+)**  | Last / First value.         | Any.                        |
|   [5]   | **`present_over_time` / `count_over_time`**      | Existence / Sample count.   | Any.                        |
|   [6]   | **`changes(v[r])` / `deriv(v[r])`**              | Value changes / Derivative. | Gauges (flapping / trend).  |
|   [7]   | **`predict_linear(v[r], t)`**                    | Predicted value at +t sec.  | Gauges (forecasting).       |
|   [8]   | **`double_exponential_smoothing(v[r], sf, tf)`** | Smoothed value (3.0+).      | Gauges only (experimental). |
|   [9]   | **`mad_over_time(v[r])` (3.5+)**                 | Median absolute deviation.  | Anomaly detection.          |
|  [10]   | **`stddev_over_time` / `stdvar_over_time`**      | Stddev / Variance.          | Gauges.                     |

---
## [6][NATIVE_HISTOGRAM_FUNCTIONS]
>**Dictum:** *Native histograms provide richer analysis without bucket label overhead.*

<br>

| [INDEX] | [FUNCTION]                            | [RETURNS]                    | [EXAMPLE]                                     |
| :-----: | ------------------------------------- | ---------------------------- | --------------------------------------------- |
|   [1]   | **`histogram_quantile(phi, v)`**      | Percentile (no `le` needed). | `histogram_quantile(0.95, sum(rate(m[5m])))`. |
|   [2]   | **`histogram_count` / `_sum`**        | Count / Sum of observations. | `histogram_count(rate(m[5m]))`.               |
|   [3]   | **`histogram_avg(v)`**                | Average (sum/count).         | `histogram_avg(rate(m[5m]))`.                 |
|   [4]   | **`histogram_fraction(lo, hi, v)`**   | Fraction in range.           | `histogram_fraction(0, 0.1, rate(m[5m]))`.    |
|   [5]   | **`histogram_stddev` / `_stdvar(v)`** | Estimated stddev / variance. | `histogram_stddev(rate(m[5m]))`.              |

phi range: `0 <= phi <= 1`. All work with NHCB. `rate()`, `increase()`, `delta()` produce gauge histograms (3.9+).

Activation: `scrape_native_histograms: true` in scrape config (feature flag no-op since 3.9).

```promql
# Classic: requires le label
histogram_quantile(0.95, sum by (le) (rate(http_duration_bucket[5m])))
# Native: le NOT needed
histogram_quantile(0.95, sum(rate(http_duration[5m])))
```

---
## [7][EXPERIMENTAL_TIMESTAMP_FUNCTIONS]
>**Dictum:** *Timestamp functions require explicit feature flags.*

<br>

| [INDEX] | [FUNCTION]                        | [FLAG]                           | [SINCE] | [RETURNS]                  |
| :-----: | --------------------------------- | -------------------------------- | ------- | -------------------------- |
|   [1]   | **`ts_of_max_over_time(v[r])`**   | `promql-experimental-functions`. | 3.5+    | Timestamp of max.          |
|   [2]   | **`ts_of_min_over_time(v[r])`**   | `promql-experimental-functions`. | 3.5+    | Timestamp of min.          |
|   [3]   | **`ts_of_last_over_time(v[r])`**  | `promql-experimental-functions`. | 3.5+    | Timestamp of last sample.  |
|   [4]   | **`ts_of_first_over_time(v[r])`** | `promql-experimental-functions`. | 3.7+    | Timestamp of first sample. |
|   [5]   | **`sort_by_label(v, labels...)`** | `promql-experimental-functions`. | 3.5+    | Sort by label values.      |
|   [6]   | **`step()`**                      | `promql-duration-expr`.          | 3.6+    | Current evaluation step.   |

Standard time functions: `time()`, `timestamp(v)`, `year/month/day_of_month/day_of_week`, `hour/minute`, `days_in_month`.

---
## [8][MATH_AND_LABEL_FUNCTIONS]
>**Dictum:** *Label functions enable cross-metric joins and enrichment.*

<br>

Math: `abs`, `ceil`/`floor`, `round`, `sqrt`, `exp`/`ln`/`log2`/`log10`, `clamp(v,min,max)`, `clamp_min`/`clamp_max`, `sgn`.
Trig: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `deg`, `rad`, `pi()`.

| [INDEX] | [FUNCTION]                | [SYNTAX]                                   | [EXAMPLE]                                                       |
| :-----: | ------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
|   [1]   | **`label_replace`**       | `label_replace(v, dst, repl, src, regex)`. | `label_replace(up, "hostname", "$1", "instance", "(.+):\\d+")`. |
|   [2]   | **`label_join`**          | `label_join(v, dst, sep, src1, ...)`.      | `label_join(m, "uid", "-", "cluster", "namespace", "pod")`.     |
|   [3]   | **`info` (experimental)** | `info(v [, selector])`.                    | `info(rate(requests[5m]))` -- replaces manual `group_left`.     |

---
## [9][UTILITY_FUNCTIONS]
>**Dictum:** *Utility functions handle absence detection, sorting, and type conversion.*

<br>

| [INDEX] | [FUNCTION]                    | [RETURNS]                  | [EXAMPLE]                        |
| :-----: | ----------------------------- | -------------------------- | -------------------------------- |
|   [1]   | **`absent(v)`**               | 1-element if empty.        | `absent(up{job="critical"})`.    |
|   [2]   | **`absent_over_time(v[r])`**  | 1 if no samples in range.  | `absent_over_time(metric[10m])`. |
|   [3]   | **`scalar(v)` / `vector(s)`** | Scalar from / vector from. | `scalar(sum(up))`.               |
|   [4]   | **`sort(v)` / `sort_desc`**   | Sorted by value.           | `sort_desc(requests_total)`.     |

---
## [10][BREAKING_CHANGES]
>**Dictum:** *Prometheus 3.0 breaking changes require migration awareness.*

<br>

| [INDEX] | [CHANGE]                      | [DETAIL]                                                           |
| :-----: | ----------------------------- | ------------------------------------------------------------------ |
|   [1]   | **Left-open range selectors** | Sample at lower time boundary excluded.                            |
|   [2]   | **`holt_winters` renamed**    | Now `double_exponential_smoothing` (experimental flag).            |
|   [3]   | **Regex `.` matches all**     | Including newlines.                                                |
|   [4]   | **UTF-8 metric/label names**  | `{"metric.name" = "value"}` allowed by default.                    |
|   [5]   | **Native histograms (3.8)**   | Activated via `scrape_native_histograms` config, not feature flag. |
|   [6]   | **Feature flag no-op (3.9)**  | `--enable-feature=native-histograms` has no effect.                |

---
## [11][HISTOGRAM_VS_SUMMARY]
>**Dictum:** *Histograms are preferred over summaries for aggregatability.*

<br>

| [INDEX] | [FEATURE]                         | [HISTOGRAM]    | [SUMMARY]                        |
| :-----: | --------------------------------- | -------------- | -------------------------------- |
|   [1]   | **Quantile calculation**          | Server-side.   | Client-side (pre-configured).    |
|   [2]   | **Aggregatable across instances** | Yes.           | No (quantiles are non-additive). |
|   [3]   | **Flexible quantiles**            | Yes.           | No (fixed at instrumentation).   |
|   [4]   | **Recommendation**                | **Preferred**. | Legacy only.                     |
