# LogQL Best Practices

## Performance Checklist

- [ ] Stream selectors as specific as possible (`{ns="prod", app="api"}` not `{ns="prod"}`) -- reduces chunk scan volume
- [ ] Line filters BEFORE parsers (`|= "error" | json` not `| json |= "error"`) -- substring check is O(1), parser is O(n)
- [ ] Pattern match `|>` over regex `|~` when possible (10x faster) -- compiled wildcards vs regex engine
- [ ] Exact string match over regex (`|= "ERROR"` not `|~ "ERROR"`) -- bypasses regex compilation
- [ ] Structured metadata filters BEFORE parsers for bloom acceleration (3.3+) -- bloom provides O(1) chunk skipping
- [ ] Shortest time range for use case (`[1m]` real-time, `[1h]` trends) -- reduces chunks scanned
- [ ] Extract only needed JSON fields (`| json level, status` not `| json`) -- reduces allocation per line (improved in 3.6)
- [ ] `by` over `without` for aggregation grouping -- explicit label control
- [ ] Drop unneeded labels before aggregation (`| drop instance, pod`) -- reduces series cardinality
- [ ] `__error__=""` in production dashboards to exclude parse failures -- prevents noisy results
- [ ] `vector(0)` fallback in alerting rules for sparse logs -- prevents "no data" flapping
- [ ] Metric queries for dashboards/alerts, log queries for exploration -- metric queries are pre-aggregated

## Pipeline Ordering (Critical for Performance)

```
{stream} -> line filter -> decolorize -> struct metadata -> parser -> label filter -> keep/drop -> format -> aggregate
```

[RULE] Each stage filters before the next. Moving expensive operations earlier wastes resources because they process entries that cheaper stages would have eliminated.

## Parser Selection

| #  | Parser | Use When | Why This Order |
|----|--------|----------|----------------|
| 1  | `pattern` | Fixed-delimiter structured text | No regex engine, compiled once, lowest overhead |
| 2  | `logfmt` | `key=value` pairs | Specialized parser, reduced allocations in 3.6 |
| 3  | `json` | JSON logs (specify fields for perf) | Field selection reduces allocations in 3.6 |
| 4  | `regexp` | Complex extraction, last resort | Full regex engine, highest per-line cost |

`logfmt` flags: `--strict` (fail on malformed -- populates `__error__`), `--keep-empty` (retain standalone keys as empty strings).

JSON field access: dot notation (`request.method`), bracket (`headers["User-Agent"]`), array (`items[0]`).

`unpack`: Decodes packed JSON from Promtail's `pack` stage (also supported by Alloy's `loki.process`).

## Cardinality Rules

**Good labels** (low cardinality): `namespace`, `app`, `environment`, `cluster`, `level`, `job`

**Bad labels** (high cardinality -- use line filters or structured metadata): `user_id`, `trace_id`, `request_id`, `session_id`, `ip_address`

Why: Each unique label combination creates a separate stream. High-cardinality labels in stream selectors create millions of streams, causing ingestion failures and OOM.

```logql
# GOOD: filter after parsing (no stream cardinality impact)
{app="api"} | json | user_id="12345"
# BAD: high-cardinality label in stream selector (creates stream per user)
{app="api", user_id="12345"}
```

## Structured Metadata (3.0+)

- NOT indexed -- no cardinality impact, requires scanning
- Filter AFTER stream selector, BEFORE parsers for bloom acceleration
- Ideal for: trace_id, user_id, pod UIDs

| Metadata | Cardinality | Recommendation | Why |
|----------|-------------|----------------|-----|
| `trace_id` | ~1M/day | Structured metadata, query debugging only | Too high for labels, too useful to discard |
| `user_id` | ~100K | Structured metadata OK with filter | Bloom acceleration makes filtering fast |
| `pod_name` | ~100 | Regular label (low cardinality) | Low enough for indexing, high query value |
| `request_id` | ~1B | NOT suitable -- use tracing | Even structured metadata scanning is too slow at this volume |

### Bloom Filter Acceleration (3.3+)

Only these filter forms are accelerated:
- String equality: `| key="value"`
- OR: `| detected_level="error" or detected_level="warn"`
- Simple regex converted internally: `| key=~"value1|value2"`

Why bloom filters work: Bloom filters provide O(1) membership testing against chunk metadata. When a filter is placed BEFORE parsers, Loki can skip entire chunks that definitely do not contain matching entries. Filters AFTER parsers bypass this optimization because the chunk has already been decompressed and parsed.

```logql
# ACCELERATED (bloom skips non-matching chunks)
{cluster="prod"} | detected_level="error" | json
# NOT ACCELERATED (chunk already decompressed for parser)
{cluster="prod"} | json | detected_level="error"
```

## Alerting

- Alerts require metric queries (aggregations), not log queries -- Loki evaluates metric expressions for alerting
- Set thresholds based on SLOs or historical baselines -- prevents alert fatigue
- `absent_over_time({app="svc"}[5m])` detects dead services -- fires when no logs exist in window
- `or vector(0)` prevents "no data" flapping on sparse logs (parentheses required around `or`) -- `or` binds looser than comparison operators
- `limit` is API parameter (`&limit=100`), not a pipeline operator -- do not generate `| limit N`

## Decolorize Before Parsing

ANSI color codes break `logfmt` and `json` parsers because escape sequences appear inside key/value boundaries. Strip first:
```logql
{app="api"} | decolorize | logfmt | level="error"
# Debug: check if ANSI codes are present
{app="api"} |~ "\\x1b\\["
```

## __error__ Debugging

| Error Value | Cause | Fix |
|-------------|-------|-----|
| `JSONParserErr` | Invalid JSON | Check log format, use `--strict` to isolate |
| `LogfmtParserErr` | Invalid logfmt | Verify key=value format, check ANSI codes |
| `PatternParserErr` | Pattern did not match | Adjust pattern template to match log structure |
| `RegexpParserErr` | Regex did not match | Test regex against sample logs |

```logql
# Debug: show failing lines with error type
{app="api"} | json | __error__ != "" | line_format "{{.__error__}}: {{.__line__}}"
# Count by error type to find most common parse failures
sum by (__error__) (count_over_time({app="api"} | json | __error__ != "" [5m]))
# Production: exclude parse failures from results
{app="api"} | json | __error__="" | level="error"
```

## Recording Rules

Precompute expensive queries as metrics. Use when: frequent dashboard queries, complex aggregations, timeout-prone queries.

Why: Recording rules evaluate once per interval and store results as metrics, turning O(scan) log queries into O(1) metric lookups.

```yaml
groups:
  - name: error_rates
    interval: 1m
    rules:
      - record: app:error_rate:1m
        expr: sum by (app) (rate({job="kubernetes-pods"} | json | level="error" [1m]))
        labels: { source: loki_recording_rule }
  - name: alerting_rules
    interval: 1m
    rules:
      - alert: HighErrorRate
        expr: (sum by (app) (rate({job="app"} | json | level="error" [5m])) / sum by (app) (rate({job="app"}[5m]))) > 0.05
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "High error rate for {{ $labels.app }}"
```

## Anti-Patterns

| Anti-Pattern | Fix | Why |
|--------------|-----|-----|
| `{app="api", user_id="x"}` | `{app="api"} \| json \| user_id="x"` | user_id in stream selector creates stream per user |
| `\| json \| json \| json` | `\| json` (once is enough) | Multiple parses waste CPU, results are identical |
| `\|~ "GET"` for simple string | `\|= "GET"` (exact match faster) | Regex compilation overhead for literal string |
| `\|~ "error\|fatal"` for structured logs | `\|> "<_> level=error <_>"` (pattern match 10x faster) | Pattern compiler is simpler than regex engine |
| `sum(rate(...[5m]))` without grouping | `sum by (ns, app) (rate(...[5m]))` | Loses all dimensional data for debugging |
| `rate(...[24h])` for real-time | `rate(...[5m])` | 24h scans too many chunks for real-time panels |
| `\| json` then filter | `\|= "error" \| json` (line filter first) | Parser processes all lines; line filter skips non-matching |
| Filter after parser for struct metadata | Filter BEFORE parser for bloom acceleration | Post-parser filter bypasses O(1) bloom chunk skipping |

## Non-Existent Features

- **No `| dedup`**: UI-level in Grafana Explore. Programmatic: `sum by (msg) (count_over_time(...)) > 0`
- **No `| distinct`**: Reverted PR #8662. Use `count(count by (field) (...))`
- **No `| limit N`**: API param `&limit=100`, Grafana "Line limit", logcli `--limit=100`

## Alloy Pipeline Reference

For pipeline configuration, refer to `grafana alloy` MCP or `infrastructure/src/deploy.ts` lines 29-36.

## Promtail Migration (EOL March 2, 2026)

Promtail was deprecated in Loki 3.5 with EOL March 2, 2026. Migration to Alloy:

| Promtail | Alloy Equivalent |
|----------|-----------------|
| `scrape_configs` | `loki.source.file` + `loki.relabel` |
| `pipeline_stages.json` | `loki.process` with `stage.json` |
| `pipeline_stages.regex` | `loki.process` with `stage.regex` |
| `pipeline_stages.pack` | `loki.process` with `stage.pack` (consumed by `| unpack`) |
| `pipeline_stages.multiline` | `loki.process` with `stage.multiline` |
