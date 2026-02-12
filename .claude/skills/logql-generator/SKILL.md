---
name: logql-generator
description: Generate best-practice LogQL queries for Grafana Loki 3.x+. Use for dashboards, alerting rules, ad-hoc debugging, and metric extraction from logs. Covers Loki 3.0 through 3.6 including bloom filter acceleration, structured metadata, pattern match operators, and approx_topk.
---

# LogQL Query Generator

LogQL is Grafana Loki's query language -- distributed grep with labels, aggregation, and metrics.

## Loki Version Matrix

| Version | Key Changes | Why It Matters |
|---------|-------------|----------------|
| 3.0 | Bloom filters, structured metadata, pattern match `\|>` / `!>` | 10x faster filtering via `<_>` wildcards; high-cardinality data without index impact |
| 3.3 | Bloom acceleration for structured metadata, bloom planner/builder split | Structured metadata filters BEFORE parsers get bloom speedup |
| 3.5 | Promtail deprecated (EOL March 2, 2026), offset fix for first/last/quantile_over_time | Migrate to Alloy; offset now works correctly for unwrapped range functions |
| 3.6 | `approx_topk` on querier, reduced JSON/logfmt parser allocations, Loki UI as Grafana plugin | Probabilistic top-K for high-cardinality grouping; lower memory for parsing |

> **Deprecations**: Promtail (EOL March 2, 2026 -- replaced by Alloy), BoltDB store (use TSDB with v13 schema), SSD mode (deprecated 3.5 -- use distributed or single-binary)

## Workflow

1. **Goal** -- Error analysis, performance, security, debugging? Dashboard, alert, ad-hoc?
2. **Sources** -- Labels (`job`, `namespace`, `app`), log format (JSON/logfmt/plain), time range
3. **Query type** -- Log query (return lines) or metric query (calculate values)?
4. **Plan** -- Plain-English plan, confirm with user before generating
5. **Generate** -- Apply patterns below; consult `references/best_practices.md` and `examples/common_queries.logql`
6. **Deliver** -- Final query + explanation + usage context (Grafana panel, alert rule, logcli, HTTP API)

## Pipeline Order (Performance-Critical)

```
{stream} -> line filter -> decolorize -> struct metadata -> parser -> label filter -> keep/drop -> format -> aggregate
 cheapest                                                                                              most expensive
```

[RULE] Each stage filters BEFORE the next -- moving expensive operations earlier wastes resources.
[RULE] Structured metadata filters BEFORE parsers enables bloom filter acceleration (3.3+).

## Stream Selection

```logql
{namespace="prod", app="api", level="error"}    # GOOD: specific
{namespace="prod"}                                # BAD: too broad (why: scans all apps in namespace)
```

## Line Filters

| Op    | Meaning           | Example                                        | Why Prefer |
|-------|-------------------|------------------------------------------------|------------|
| `\|=` | Contains          | `{job="app"} \|= "error"`                     | O(1) substring check |
| `!=`  | Not contains      | `{job="app"} != "debug"`                       | Filters before parsing |
| `\|~` | Regex match       | `{job="app"} \|~ "error\|fatal"`               | When alternation needed |
| `!~`  | Regex not match   | `{job="app"} !~ "health\|metrics"`             | Exclude multiple patterns |
| `\|>` | Pattern match     | `{app="api"} \|> "<_> level=error <_>"`        | 10x faster than regex (3.0+) |
| `!>`  | Pattern not match | `{app="api"} !> "<_> level=debug <_>"`         | Fastest exclusion (3.0+) |

`|>` / `!>` use `<_>` wildcards, are 10x faster than regex, introduced in 3.0+.

## Parsers (fastest to slowest)

| #  | Parser    | Syntax                                          | Use When                          | Why This Order |
|----|-----------|-------------------------------------------------|-----------------------------------|----------------|
| 1  | `pattern` | `\| pattern "<ip> - <_> <status>"`              | Fixed-delimiter structured text   | No regex engine, compiled once |
| 2  | `logfmt`  | `\| logfmt [--strict] [--keep-empty]`           | `key=value` pairs                 | Specialized parser, low allocs (3.6 improvement) |
| 3  | `json`    | `\| json` or `\| json status="response.code"`  | JSON (specify fields for perf)    | Field selection reduces allocations (3.6 improvement) |
| 4  | `regexp`  | `\| regexp "(?P<field>\\w+)"`                   | Complex extraction, last resort   | Full regex engine, highest cost |
| 5  | `unpack`  | `\| unpack`                                     | Packed JSON from Alloy/Promtail   | Specialized for packed format |

## Label Filters, Keep/Drop, Decolorize

```logql
{app="api"} | json | status_code >= 500
{app="api"} | json | (status_code >= 400 and status_code < 500) or level="error"
{app="api"} | json | keep namespace, pod, level
{app="api"} | json | drop instance, pod
{app="api"} | decolorize | logfmt | level="error"    # Strip ANSI before parsing
{job="nginx"} | logfmt | remote_addr = ip("192.168.4.0/24")
```

## Formatting

```logql
| line_format "{{.level}}: {{.message}}"
| label_format env="{{.environment}}"
| label_format severity="{{if ge .status_code 500}}critical{{else}}info{{end}}"
```

## Range Aggregations

### Log Range (count entries)

| Function | Description | Use When |
|----------|-------------|----------|
| `rate(log-range)` | Entries per second | Dashboard rate panels |
| `count_over_time(log-range)` | Total entries in range | Counting occurrences |
| `bytes_rate(log-range)` | Bytes per second | Bandwidth monitoring |
| `bytes_over_time(log-range)` | Total bytes in range | Storage analysis |
| `absent_over_time(log-range)` | Returns 1 if no logs exist | Dead service alerting |

### Unwrapped Range (extract numeric label values via `| unwrap <label>`)

| Function | Description | Use When |
|----------|-------------|----------|
| `sum_over_time`, `avg_over_time`, `max_over_time`, `min_over_time` | Aggregate numeric values | Metric extraction from logs |
| `quantile_over_time(phi, range)` | phi-quantile (0 <= phi <= 1) | Latency percentiles from log fields |
| `first_over_time`, `last_over_time` | First/last value in interval | Boundary values |
| `stddev_over_time`, `stdvar_over_time` | Standard deviation/variance | Variability analysis |
| `rate_counter(range)` | Per-second rate treating values as monotonically increasing counter | Counter-like log values |

Unwrap conversion: `| unwrap duration_seconds(label)` or `| unwrap bytes(label)`.

## Aggregation Operators

`sum`, `avg`, `min`, `max`, `count`, `stddev`, `topk`, `bottomk`, `approx_topk`, `sort`, `sort_desc`

Grouping: `sum by (label1, label2) (...)` or `sum without (label1) (...)`

### approx_topk (3.6+)

`approx_topk(k, expr)` -- probabilistic top-K via count-min sketch, instant queries only.

| Requirement | Detail | Why |
|-------------|--------|-----|
| Config | `limits_config.shard_aggregations: [approx_topk]` | Must be explicitly enabled on querier |
| Query type | Instant only (not range) | Probabilistic sketch not designed for range queries |
| Grouping | Use inner `sum by` for grouping | Sketch operates on aggregated values |
| Accuracy | Probabilistic, not exact | Count-min sketch trades precision for speed on high-cardinality |

## Metric Query Patterns

| Pattern | Query | Why This Approach |
|---------|-------|-------------------|
| Rate | `rate({job="app"} \|= "error" [5m])` | Entries per second for dashboards |
| Count by label | `sum by (app) (count_over_time({ns="prod"} \| json [5m]))` | Distribution analysis |
| Error percentage | `sum(rate({app="api"} \| json \| level="error" [5m])) / sum(rate({app="api"}[5m])) * 100` | Overall ratio (not avg of per-instance ratios) |
| Latency P95 | `quantile_over_time(0.95, {app="api"} \| json \| unwrap duration [5m])` | Percentile from log-extracted values |
| Top 10 | `topk(10, sum by (type) (count_over_time({job="app"} \| json [1h])))` | Deterministic top-K |
| Approx Top 10 | `approx_topk(10, sum by (endpoint) (rate({app="api"}[5m])))` | Probabilistic top-K for high cardinality (3.6+) |
| Counter rate | `rate_counter({app="api"} \| json \| unwrap total_requests [5m])` | Counter-like values in logs |
| Offset compare | `sum(rate(...[5m])) - sum(rate(...[5m] offset 1d))` | Day-over-day comparison |
| Dead service | `absent_over_time({app="api"}[5m])` | Alerting on missing logs |
| Peak rate 24h | `max_over_time(sum(rate({ns="prod"}[5m]))[24h:5m])` | Peak detection via subquery |

## Conversion Functions

| Function | Description | Use When |
|----------|-------------|----------|
| `duration_seconds(label)` | Go duration string to seconds (e.g., `5m30s`) | Latency from duration strings |
| `bytes(label)` | Byte string to bytes (e.g., `5 MiB`, `3k`, `1G`) | Size from human-readable strings |
| `label_replace(v, dst, replacement, src, regex)` | Regex-based label manipulation | Extracting substrings from labels |

## Template Functions (line_format / label_format)

| Category | Functions |
|----------|-----------|
| String | `trim`, `upper`, `lower`, `replace`, `trunc`, `substr`, `printf`, `contains`, `hasPrefix`, `indent`, `nindent` |
| Math | `add`, `sub`, `mul`, `div`, `addf`, `subf`, `divf`, `floor`, `ceil`, `round` |
| Date | `date`, `now`, `unixEpoch`, `toDate`, `duration_seconds` |
| Regex | `regexReplaceAll`, `regexReplaceAllLiteral`, `count` |
| Special | `fromJson`, `default`, `int`, `float64`, `__line__`, `__timestamp__` |

## Loki 3.x Features

### Structured Metadata

High-cardinality data (trace_id, user_id) without index cardinality impact. Filter AFTER stream selector, NOT inside `{}`:
```logql
{app="api"} | trace_id="abc123" | json | level="error"     # CORRECT
# WRONG: {app="api", trace_id="abc123"}                     # trace_id is NOT an indexed label
```

### Query Acceleration (Bloom Filters, 3.3+)

Place structured metadata filters BEFORE parsers for bloom acceleration. Only string equality and OR are accelerated:
```logql
{cluster="prod"} | detected_level="error" | json                              # ACCELERATED
{cluster="prod"} | detected_level="error" or detected_level="warn" | json     # ACCELERATED (OR)
{cluster="prod"} | json | detected_level="error"                              # NOT accelerated (after parser)
```

Why bloom filters matter: bloom filters provide O(1) membership testing against chunk metadata, skipping chunks that definitely do not contain matching entries. Placing filters after parsers bypasses this optimization entirely.

### Automatic Labels

- **service_name** -- auto-populated from container name, OTel `service.name`, or `discover_service_name` config
- **detected_level** -- auto-detected log level as structured metadata when `discover_log_levels: true`; place BEFORE parser for acceleration

### vector() for Alerting

Prevents "no data" flapping on sparse logs. Not needed for dashboards (Grafana renders gaps). Parentheses required -- `or` binds looser than `>`:
```logql
(sum(rate({app="api"} | json | level="error" [5m])) or vector(0)) > 10
```

### Multi-Tenant Queries

Header `X-Scope-OrgID: tenant-a|tenant-b` with `multi_tenant_queries_enabled: true` in querier config.

## Alerting Rules

```logql
# Error rate > 5%
(sum(rate({app="api"} | json | level="error" [5m])) / sum(rate({app="api"}[5m]))) > 0.05
# Absolute threshold with vector() fallback
(sum(rate({app="api"} | json | level="error" [5m])) or vector(0)) > 10
# Dead service
absent_over_time({app="api"}[5m])
```

## Non-Existent Features (Do Not Generate)

| Feature | Reality | Why |
|---------|---------|-----|
| `\| dedup` | UI-level in Grafana Explore. Use `sum by (field)` for programmatic dedup | Not a LogQL operator |
| `\| distinct` | Reverted PR #8662. Use `count(count by (field) (...))` | Never shipped |
| `\| limit N` | API param `&limit=100`, Grafana "Line limit", logcli `--limit=100` | Not a pipeline stage |

## Troubleshooting

| Issue | Solution | Why |
|-------|----------|-----|
| No results | Check labels exist, verify time range, test stream selector alone | Labels may not match Loki index |
| Query slow | More specific selectors, line filter before parser, reduce time range | Pipeline order determines scan volume |
| Parse errors | `\| json \| __error__=""` to exclude; `\| __error__ != ""` to debug | Malformed lines produce __error__ label |
| ANSI interference | `\| decolorize \| logfmt` -- strip color codes before parsing | ANSI codes break key=value parsing |
| High cardinality | Line filters for unique values, aggregate with `sum by` | Grouping by high-cardinality labels explodes series |
| Discover fields | `logcli detected-fields '{app="api"}'` | Lists fields Loki has auto-detected |

## Alloy Pipeline Stages

Alloy shapes which labels/metadata arrive in Loki. See `infrastructure/src/deploy.ts` lines 29-36 for project config.

| Stage | Purpose | Why |
|-------|---------|-----|
| `loki.relabel` | Map K8s labels to Loki labels | Control which K8s metadata becomes queryable |
| `loki.process/multiline` | Aggregate multi-line logs (`firstline: ^\d{4}-\d{2}-\d{2}`) | Stack traces are multi-line |
| `loki.process/sampling` | Reduce high-volume streams (`rate: 0.1` = 10% sample) | Cost control for debug-level logs |

## Resources

- `examples/common_queries.logql` -- copy-paste query patterns by category
- `references/best_practices.md` -- performance, anti-patterns, recording rules
- context7 MCP (`grafana loki`) -- authoritative docs for unclear syntax

## Version History

| Version | Features |
|---------|----------|
| 3.0 | Bloom filters, structured metadata, pattern match `\|>` / `!>` |
| 3.3 | Bloom acceleration for structured metadata, bloom planner/builder split |
| 3.5 | Promtail deprecated (EOL March 2, 2026 -- use Alloy), offset fix for first/last/quantile_over_time, SSD mode deprecated |
| 3.6 | `approx_topk` on querier (requires `shard_aggregations` config), reduced JSON/logfmt parser allocations, Loki UI as Grafana plugin |

> **Deprecations**: Promtail (replaced by Alloy, EOL March 2, 2026), BoltDB store (use TSDB with v13 schema), SSD mode (deprecated 3.5 -- use distributed or single-binary)
