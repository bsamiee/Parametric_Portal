---
name: promql-validator
description: Comprehensive toolkit for validating, optimizing, and understanding Prometheus Query Language (PromQL) queries. Use this skill when working with PromQL queries to check syntax, detect anti-patterns, identify optimization opportunities, and interactively plan queries with users. Covers Prometheus 3.0 through 3.10 (Feb 2026) including native histograms (stable 3.8+, no-flag 3.9+), experimental functions, and UTF-8 metric names.
---

## Prometheus Version Matrix

| Version | Key Changes |
|---------|-------------|
| 3.0 | UTF-8 metric names `{"my.metric"}`, `info()` experimental, `holt_winters` renamed to `double_exponential_smoothing` |
| 3.5 LTS | `mad_over_time`, `ts_of_min/max/last_over_time` experimental |
| 3.6 | `step()` function, `min()`/`max()` on durations (promql-duration-expr flag) |
| 3.7 | `first_over_time`, `ts_of_first_over_time` experimental, anchored+smoothed rate |
| 3.8 | Native histograms stable (requires `scrape_native_histograms: true` in scrape config) |
| 3.9 | Native histogram feature flag is no-op (always enabled), `/api/v1/features` endpoint |
| 3.10 | Maintenance release (Feb 2026); no new PromQL functions; stability and bug fixes |

## Architecture

Scripts use **data-driven validation** via `CheckSpec` frozen dataclass with generic `run_check_specs()` runner. Each check is a pure data record (pattern, severity, message function, recommendation) -- no per-check imperative logic.

## Workflow

1. **Syntax**: `python3 .claude/skills/promql-validator/scripts/validate_syntax.py validate "<query>"`
2. **Best Practices**: `python3 .claude/skills/promql-validator/scripts/check_best_practices.py check "<query>"`
3. **Explain**: Parse and describe in plain English: metrics, types, functions, output labels, result structure
4. **Clarify Intent (STOP AND WAIT)**: Ask user: goal, metric type, time window, aggregation needs, use case (alerting/dashboard/adhoc)
5. **Compare Intent vs Implementation**: After user responds, highlight mismatches, suggest corrections
6. **Optimize**: Suggest efficient patterns, recording rules, better label matchers, appropriate ranges
7. **Refine**: Offer alternatives, explain trade-offs, let user iterate

## Validation Rules

| Category | Rule | Severity | Why |
|----------|------|----------|-----|
| Syntax | Metric names: `[a-zA-Z_:][a-zA-Z0-9_:]*` or UTF-8 quoted `{"my.metric"}` (Prom 3.0+) | error | Invalid names cause parse errors |
| Syntax | Label matchers: `=`, `!=`, `=~`, `!~` | error | Other operators are not valid PromQL |
| Syntax | Durations: `[0-9]+(ms\|s\|m\|h\|d\|w\|y)` | error | Prometheus rejects malformed duration units |
| Syntax | Range vectors: `metric[duration]`, offset after range | error | Misplaced offset causes syntax error |
| Semantic | `rate()`/`irate()` only on counters (`_total`, `_count`, `_sum`, `_bucket`) | warning | Gauges represent current state; `rate()` produces meaningless derivative |
| Semantic | Counters need `rate()` or `increase()`, not raw values | warning | Raw counter is monotonically increasing, useless for dashboards |
| Semantic | Never `rate()` on gauges -- use `avg_over_time()` or direct value | warning | `rate()` on a gauge computes derivative of current state |
| Semantic | `histogram_quantile()` needs `rate()` on `_bucket` + `le` in `by()` | warning | Raw buckets are cumulative counters; without `le`, percentile fails |
| Semantic | Never average/aggregate summary quantiles -- use histogram buckets | error | Quantiles are non-additive: avg(p99_a, p99_b) != p99(a+b) |
| Semantic | `holt_winters()` deprecated in 3.0 -- use `double_exponential_smoothing()` | warning | Renamed for clarity; old name will be removed |
| Perf | Always use specific label matchers to reduce cardinality | warning | Unbounded selectors scan entire TSDB index causing timeouts |
| Perf | Use `=` over `=~` for exact matches (5-10x faster index lookup) | info | Exact match uses O(1) inverted index; regex requires pattern evaluation |
| Perf | `rate()` range >= 4x scrape interval (typically `[2m]` minimum) | warning | Needs >= 3 samples for reliable extrapolation |
| Perf | `irate()` range <= 5m (only uses last 2 samples) | warning | Extra range is wasted lookback, not averaged |
| Perf | Subquery ranges < 7d; use recording rules for longer | warning | Materializes millions of intermediate samples causing OOM |
| Perf | Recording rules for complex/repeated queries (3+ functions, >150 chars) | info | Pre-computation at scrape time provides 10-40x speedup |
| Native | Native histogram queries omit `le` from `by()` clause | info | Bucket boundaries are encoded internally, not in labels |
| Native | Use `histogram_avg(rate(m[5m]))` instead of `_sum/_count` division (3.8+) | info | Single function, no separate series needed |
| Native | Use `histogram_fraction(0, threshold, rate(m[5m]))` for latency SLOs (3.8+) | info | Fraction of requests under threshold without bucket boundary guessing |

## Anti-Pattern Quick Reference

| Anti-Pattern | Bad | Good | Why |
|-------------|-----|------|-----|
| No filters | `http_requests_total{}` | `http_requests_total{job="api"}` | Scans entire TSDB index |
| Regex overuse | `{status=~"200"}` | `{status="200"}` | 5-10x slower than index lookup |
| Raw counter | `http_requests_total` | `rate(http_requests_total[5m])` | Monotonically increasing, useless for dashboards |
| Rate on gauge | `rate(memory_usage_bytes[5m])` | `avg_over_time(memory_usage_bytes[5m])` | Derivative of current state is meaningless |
| Avg quantiles | `avg(metric{quantile="0.95"})` | `histogram_quantile(0.95, sum by (le) (rate(metric_bucket[5m])))` | Quantiles are non-additive |
| Long irate | `irate(metric[1h])` | `rate(metric[1h])` or `irate(metric[2m])` | Only uses last 2 samples |
| Huge subquery | `rate(m[5m])[90d:1m]` | Recording rules or `[7d:5m]` | OOM from materialized samples |
| Mixed types | counter / gauge + summary in arithmetic | Separate purpose-specific queries | Incompatible semantics |
| Missing group_left | `metric * on(l) info_metric` | `metric * on(l) group_left(labels) info_metric` | Many-to-one joins rejected |
| absent+agg | `absent(sum(metric))` | `group(present_over_time(m[r])) unless group(m)` | Aggregation returns empty set, not absent vector |
| Deprecated fn | `holt_winters(m[5m], 0.5, 0.5)` | `double_exponential_smoothing(m[5m], 0.5, 0.5)` | Renamed in Prom 3.0 |
| Classic hist when native available | `sum by (job, le) (rate(m_bucket[5m]))` | `sum by (job) (rate(m[5m]))` | Native: single series, no `le` needed |

## Output Format

```
## PromQL Validation Results

### Syntax Check
- Status: VALID / WARNING / ERROR
- Issues: [list with severity and WHY]

### Semantic Check
- Status: VALID / WARNING / ERROR
- Issues: [list with severity and WHY]

### Performance Analysis
- Status: OPTIMIZED / CAN BE IMPROVED / INEFFICIENT
- Suggestions: [list with estimated improvement]

### Query Explanation
- Metrics: [names and types]
- Functions: [what each does]
- Output Labels: [labels in result, or "None (fully aggregated)"]
- Expected Result Structure: [instant/range vector, scalar] with [series count]

### Intent Verification
1. What are you measuring?
2. Counter/gauge/histogram/summary?
3. Time window?
4. Aggregation labels?
5. Alerting, dashboarding, or analysis?
```

## Known Limitations

- **Metric type detection**: Heuristic from naming conventions (`_total`, `_bytes`); custom names may misclassify
- **Native histogram detection**: Cannot distinguish classic from native without runtime context -- recommends native patterns when metric lacks `_bucket` suffix
- **High cardinality**: Conservative flagging; recording rule metrics and known-low-cardinality are valid without filters
- **No runtime context**: Cannot verify metric existence or label validity -- test against actual Prometheus for production
- **Detection gaps**: Business logic errors, context-specific optimizations, custom extensions not caught

## Citation Sources

- `scripts/_common.py` -- shared constants, CheckSpec dataclass, dispatch, and parsing utilities
- `scripts/validate_syntax.py` -- data-driven syntax validation via CheckSpec tuples
- `scripts/check_best_practices.py` -- data-driven semantic/performance checks via CheckSpec tuples
- `examples/good_queries.promql` -- well-formed patterns including native histograms (3.8+)
- `examples/bad_queries.promql` -- anti-patterns with corrections and WHY explanations
- `examples/optimization_examples.promql` -- before/after with performance gains and native histogram optimizations
- `docs/best_practices.md` -- rules reference with metric type rules and native histogram patterns
- `docs/anti_patterns.md` -- detection table with 30 anti-patterns, all with WHY column
