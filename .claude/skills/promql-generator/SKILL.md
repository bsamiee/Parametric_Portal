---
name: promql-generator
description: Comprehensive toolkit for generating best practice PromQL (Prometheus Query Language) queries following current standards and conventions. Use this skill when creating new PromQL queries, implementing monitoring and alerting rules, or building observability dashboards.
---

# PromQL Query Generator

## When to Use

- Creating PromQL queries for dashboards, alerting rules, recording rules, or ad-hoc analysis
- Working with Prometheus metrics (counters, gauges, histograms, summaries, native histograms)
- Implementing RED (Rate, Errors, Duration) or USE (Utilization, Saturation, Errors) patterns
- SLO/error budget/burn rate monitoring

## Interactive Workflow

### Step 1: Understand the Goal

Gather via **AskUserQuestion** (skip if already provided):

| Dimension | Options |
|-----------|---------|
| **Goal** | Request rate, error rate, latency, resource usage, availability, saturation, SLO tracking |
| **Use case** | Dashboard, alert, recording rule, ad-hoc, capacity planning |
| **Context** | Service name, team, existing metrics/naming conventions |

### Step 2: Identify Metrics

Confirm metric names, types, and labels:

| Suffix | Type | Functions |
|--------|------|-----------|
| `_total` | Counter | `rate()`, `irate()`, `increase()` |
| `_bucket`, `_sum`, `_count` | Classic Histogram | `histogram_quantile()`, `rate()` |
| (none, opaque) | Native Histogram (3.0+ stable, 3.9+ no feature flag) | `histogram_quantile/count/sum/avg/fraction/stddev/stdvar()` |
| (unit suffix) | Gauge | direct, `*_over_time()` |

### Step 3: Determine Parameters

Pre-fill values from user request. Confirm via **AskUserQuestion**:
- **Time range**: `[1m]`-`[5m]` real-time, `[1h]`-`[1d]` trends. Range >= 4x scrape interval.
- **Label filters**: exact `=`, negative `!=`, regex `=~`
- **Aggregation**: `sum by (labels)`, `sum without (labels)`, `topk`, `bottomk`
- **Thresholds**: alert conditions, comparison operators

### Step 4: Present Query Plan

**Before generating code**, present plain-English plan and get confirmation via **AskUserQuestion** with options: "Yes, generate", "Modify [aspect]", "Show alternatives".

### Step 5: Generate Query

**Before writing any query, read the relevant reference file(s):**
- Function behavior, metric types -> `references/promql_functions.md`
- RED/USE/SLO/alerting/join patterns -> `references/promql_patterns.md`
- Optimization, anti-patterns -> `references/best_practices.md`

Cite the applicable pattern in your response.

### Step 6: Validate

Invoke **promql-validator** skill. Display results:
- Syntax check (valid/warning/error)
- Best practices check (optimized/can improve/issues)
- Query explanation (what it measures, output labels, result structure)

Fix and re-validate until all checks pass.

### Step 7: Usage Instructions

Provide: final query, explanation, usage context (dashboard/alert/recording rule), customization notes, related queries.

## Prometheus Version Matrix

| Version | Release | Key PromQL Changes |
|---------|---------|-------------------|
| 3.0 | Nov 2024 | Native histograms (experimental), UTF-8 names, left-open ranges, `holt_winters` -> `double_exponential_smoothing`, `info()` experimental |
| 3.3 | Apr 2025 | `irate()`/`idelta()` support native histograms |
| 3.5 LTS | Jul 2025 | `ts_of_min/max/last_over_time()` experimental, type/unit metadata labels (experimental) |
| 3.6 | Sep 2025 | `step()`, `min()`/`max()` on durations (`promql-duration-expr` flag), `toDuration()`/`now()` template funcs |
| 3.7 | Oct 2025 | `first_over_time()`, `ts_of_first_over_time()` experimental, anchored+smoothed rate (`promql-extended-range-selectors` flag) |
| 3.8 | Nov 2025 | Native histograms **stable** (requires `scrape_native_histograms` config), `info()` bug fixes |
| 3.9 | Jan 2026 | `native-histogram` feature flag is **no-op**, `scrape_native_histograms` required, `/api/v1/features` endpoint |
| 3.10 | Feb 2026 | Maintenance release; no new PromQL functions. Focus on stability and bug fixes |

## Native Histograms

### Stable since 3.8; no feature flag needed since 3.9

No `_bucket` suffix or `le` label needed. Dramatically reduces series cardinality. Activate via `scrape_native_histograms: true` in scrape config (not a feature flag).

```promql
# Classic: histogram_quantile(0.95, sum by (job, le) (rate(metric_bucket[5m])))
# Native:  histogram_quantile(0.95, sum by (job) (rate(metric[5m])))
```

| Function | Purpose | Example |
|----------|---------|---------|
| `histogram_quantile(phi, v)` | Percentile | `histogram_quantile(0.95, sum by (job) (rate(metric[5m])))` |
| `histogram_count(v)` | Observation count rate | `histogram_count(rate(metric[5m]))` |
| `histogram_sum(v)` | Sum of observations | `histogram_sum(rate(metric[5m]))` |
| `histogram_fraction(lo, hi, v)` | Fraction between bounds | `histogram_fraction(0, 0.1, rate(metric[5m]))` |
| `histogram_avg(v)` | Average (shorthand sum/count) | `histogram_avg(rate(metric[5m]))` |
| `histogram_stddev(v)` / `histogram_stdvar(v)` | Estimated stddev / variance | `histogram_stddev(rate(metric[5m]))` |

**NHCB** (3.4+): Classic-to-native conversion via `convert_classic_histograms_to_nhcb: true`. Configured in Pulumi (`infrastructure/src/deploy.ts`).

### Breaking Changes (3.0)

| Change | Detail |
|--------|--------|
| Left-open range selectors | Sample at lower time boundary excluded |
| `holt_winters` renamed | Now `double_exponential_smoothing` (experimental flag) |
| Regex `.` matches all | Including newlines |
| UTF-8 metric/label names | `{"metric.name" = "value"}` allowed by default |

### Experimental Functions

Three feature flags gate experimental PromQL features:

| Flag | Functions | Since |
|------|-----------|-------|
| `promql-experimental-functions` | `info()`, `double_exponential_smoothing()`, `mad_over_time()`, `sort_by_label()`, `ts_of_max/min/last/first_over_time()`, `first_over_time()`, `limitk()`, `limit_ratio()` | 3.0+ |
| `promql-duration-expr` | `step()`, `min(duration)`, `max(duration)` | 3.6+ |
| `promql-extended-range-selectors` | Anchored and smoothed rate | 3.7+ |

| Function | Version | Purpose |
|----------|---------|---------|
| `info(v [, selector])` | 3.0+ | Automatic metadata enrichment (replaces `group_left` joins for info metrics) |
| `double_exponential_smoothing(v[r], sf, tf)` | 3.0+ | Smoothed gauge values (replaced `holt_winters`) |
| `mad_over_time(v[r])` | 3.5+ | Median absolute deviation for anomaly detection |
| `sort_by_label(v, labels...)` / `sort_by_label_desc(v, labels...)` | 3.5+ | Sort vector by label values |
| `ts_of_max_over_time(v[r])` | 3.5+ | Timestamp of maximum value in range |
| `ts_of_min_over_time(v[r])` | 3.5+ | Timestamp of minimum value in range |
| `ts_of_last_over_time(v[r])` | 3.5+ | Timestamp of last sample (staleness detection) |
| `first_over_time(v[r])` | 3.7+ | First (oldest) value in range |
| `ts_of_first_over_time(v[r])` | 3.7+ | Timestamp of first sample |
| `limitk(k, v)` / `limit_ratio(r, v)` | 3.0+ | Random sampling of time series |
| `step()` | 3.6+ | Current evaluation step size as duration (`promql-duration-expr` flag) |

## Documentation Lookup

1. **context7 MCP** (preferred): resolve "prometheus" -> get-library-docs with topic
2. **WebSearch** fallback: `"Prometheus PromQL [topic] documentation examples"`

## Resources

| File | When to Read |
|------|-------------|
| `references/promql_functions.md` | Function behavior, metric types, decision tree, native histograms |
| `references/promql_patterns.md` | RED/USE/SLO/alerting/join/efficiency patterns |
| `references/best_practices.md` | Optimization, anti-patterns, pre-deploy checklist |
| `examples/red_method.promql` | Request rate, error rate, latency queries |
| `examples/use_method.promql` | CPU, memory, disk, network resource queries |
| `examples/slo_patterns.promql` | Error budget, burn rate, Apdex queries |
| `examples/kubernetes_patterns.promql` | K8s pod/node/deployment/HPA queries |
| `examples/alerting_rules.yaml` | Production alerting rule templates |
| `examples/recording_rules.yaml` | Pre-computed metric rule templates |
