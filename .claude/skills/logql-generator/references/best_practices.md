# [H1][BEST_PRACTICES]
>**Dictum:** *Performance patterns prevent production query failures.*

<br>

---
## [1][PERFORMANCE_CHECKLIST]
>**Dictum:** *Specific selectors and ordered pipelines minimize resource consumption.*

<br>

- [ ] Stream selectors specific (`{ns="prod", app="api"}` not `{ns="prod"}`) -- reduces chunk scan volume.
- [ ] Line filters BEFORE parsers (`|= "error" | json` not `| json |= "error"`) -- O(1) vs O(n).
- [ ] Pattern match `|>` over regex `|~` (10x faster) -- compiled wildcards vs regex engine.
- [ ] Structured metadata filters BEFORE parsers for bloom acceleration (3.3+) -- O(1) chunk skipping.
- [ ] Extract only needed JSON fields (`| json level, status` not `| json`) -- reduced allocations (3.6).
- [ ] Drop unneeded labels before aggregation (`| drop instance, pod`) -- reduces series cardinality.
- [ ] `__error__=""` in production dashboards to exclude parse failures.
- [ ] `vector(0)` fallback in alerting rules for sparse logs -- prevents "no data" flapping.
- [ ] Metric queries for dashboards/alerts, log queries for exploration.

---
## [2][PIPELINE_ORDERING]
>**Dictum:** *Each stage filters before the next -- expensive operations later means fewer entries processed.*

<br>

```
{stream} -> line filter -> decolorize -> struct metadata -> parser -> label filter -> keep/drop -> format -> aggregate
```

---
## [3][PARSER_SELECTION]
>**Dictum:** *Parser choice determines per-line processing cost.*

<br>

| [INDEX] | [PARSER]      | [USE_WHEN]                       | [WHY]                                            |
| :-----: | ------------- | -------------------------------- | ------------------------------------------------ |
|   [1]   | **`pattern`** | Fixed-delimiter structured text. | No regex engine, compiled once, lowest overhead. |
|   [2]   | **`logfmt`**  | `key=value` pairs.               | Specialized parser, reduced allocations in 3.6.  |
|   [3]   | **`json`**    | JSON logs (specify fields).      | Field selection reduces allocations in 3.6.      |
|   [4]   | **`regexp`**  | Complex extraction, last resort. | Full regex engine, highest per-line cost.        |

`logfmt` flags: `--strict` (fail on malformed), `--keep-empty` (retain standalone keys).
JSON field access: dot notation (`request.method`), bracket (`headers["User-Agent"]`), array (`items[0]`).
`unpack`: Decodes packed JSON from Promtail/Alloy `pack` stage.

---
## [4][CARDINALITY_RULES]
>**Dictum:** *Label cardinality determines stream count and ingestion cost.*

<br>

**Good labels** (low cardinality): `namespace`, `app`, `environment`, `cluster`, `level`, `job`.<br>
**Bad labels** (use line filters or structured metadata): `user_id`, `trace_id`, `request_id`, `ip_address`.

High-cardinality labels in stream selectors create millions of streams, causing ingestion failures and OOM.

---
## [5][STRUCTURED_METADATA]
>**Dictum:** *Structured metadata enables high-cardinality filtering without index impact.*

<br>

NOT indexed -- no cardinality impact. Filter AFTER stream selector, BEFORE parsers for bloom acceleration.

| [INDEX] | [METADATA]       | [CARDINALITY] | [RECOMMENDATION]                 |
| :-----: | ---------------- | ------------- | -------------------------------- |
|   [1]   | **`trace_id`**   | ~1M/day       | Structured metadata, debug only. |
|   [2]   | **`user_id`**    | ~100K         | Structured metadata with filter. |
|   [3]   | **`pod_name`**   | ~100          | Regular label (low cardinality). |
|   [4]   | **`request_id`** | ~1B           | NOT suitable -- use tracing.     |

<br>

### [5.1][BLOOM_ACCELERATION]

Accelerated forms: string equality (`| key="value"`), OR (`| key="a" or key="b"`), simple regex internally converted.
Place BEFORE parsers -- bloom filters provide O(1) membership testing, skipping non-matching chunks.

```logql
{cluster="prod"} | detected_level="error" | json                  # ACCELERATED
{cluster="prod"} | json | detected_level="error"                  # NOT accelerated (after parser)
```

---
## [6][ALERTING]
>**Dictum:** *Alerts require metric queries -- log queries cannot fire alert rules.*

<br>

- `absent_over_time({app="svc"}[5m])` for dead service detection.
- `or vector(0)` prevents "no data" flapping (parentheses required -- `or` binds looser than `>`).
- `limit` is API parameter (`&limit=100`), not a pipeline operator.

---
## [7][DECOLORIZE]
>**Dictum:** *ANSI color codes break structured parsers.*

<br>

Strip first: `| decolorize | logfmt | level="error"`.
Debug: `{app="api"} |~ "\\x1b\\["` to detect ANSI presence.

---
## [8][ERROR_DEBUGGING]
>**Dictum:** *Parse errors silently drop log entries -- debug with `__error__` label.*

<br>

| [INDEX] | [ERROR_VALUE]          | [CAUSE]           | [FIX]                                        |
| :-----: | ---------------------- | ----------------- | -------------------------------------------- |
|   [1]   | **`JSONParserErr`**    | Invalid JSON.     | Check log format, use `--strict` to isolate. |
|   [2]   | **`LogfmtParserErr`**  | Invalid logfmt.   | Verify key=value format, check ANSI codes.   |
|   [3]   | **`PatternParserErr`** | Pattern mismatch. | Adjust pattern template.                     |

```logql
# Debug: show failing lines
{app="api"} | json | __error__ != "" | line_format "{{.__error__}}: {{.__line__}}"
# Count by error type
sum by (__error__) (count_over_time({app="api"} | json | __error__ != "" [5m]))
# Production: exclude failures
{app="api"} | json | __error__="" | level="error"
```

---
## [9][RECORDING_RULES]
>**Dictum:** *Precompute expensive queries as metrics for dashboard and alert reuse.*

<br>

Use when: frequent dashboard queries, complex aggregations, timeout-prone.

```yaml
groups:
  - name: error_rates
    interval: 1m
    rules:
      - record: app:error_rate:1m
        expr: sum by (app) (rate({job="kubernetes-pods"} | json | level="error" [1m]))
        labels: { source: loki_recording_rule }
```

---
## [10][ANTI_PATTERNS]
>**Dictum:** *Common mistakes produce slow queries or incorrect results.*

<br>

| [INDEX] | [ANTI_PATTERN]                            | [FIX]                                        |
| :-----: | ----------------------------------------- | -------------------------------------------- |
|   [1]   | **`{app="api", user_id="x"}`**            | `{app="api"} \| json \| user_id="x"`.        |
|   [2]   | **`\|~ "GET"` for simple string**         | `\|= "GET"` (exact match faster).            |
|   [3]   | **`\|~ "error\|fatal"` for structured**   | `\|> "<_> level=error <_>"` (10x faster).    |
|   [4]   | **`sum(rate(...[5m]))` without grouping** | `sum by (ns, app) (rate(...[5m]))`.          |
|   [5]   | **`\| json` then filter**                 | `\|= "error" \| json` (line filter first).   |
|   [6]   | **Filter after parser for struct meta**   | Filter BEFORE parser for bloom acceleration. |

---
## [11][PROMTAIL_MIGRATION]
>**Dictum:** *Promtail EOL March 2, 2026 -- migrate to Alloy.*

<br>

| [INDEX] | [PROMTAIL]                      | [ALLOY_EQUIVALENT]                     |
| :-----: | ------------------------------- | -------------------------------------- |
|   [1]   | **`scrape_configs`**            | `loki.source.file` + `loki.relabel`.   |
|   [2]   | **`pipeline_stages.json`**      | `loki.process` with `stage.json`.      |
|   [3]   | **`pipeline_stages.regex`**     | `loki.process` with `stage.regex`.     |
|   [4]   | **`pipeline_stages.multiline`** | `loki.process` with `stage.multiline`. |
