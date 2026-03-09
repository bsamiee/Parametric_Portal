# Queries

## CTE algebra

PG 12+ CTEs are inlined by default unless side-effecting or referenced multiple times.

Recursive CTE with SEARCH BREADTH FIRST + CYCLE in single query:

```sql
WITH RECURSIVE org_tree AS (
    SELECT id, parent_id, name, 1 AS depth
    FROM departments
    WHERE parent_id IS NULL

    UNION ALL

    SELECT d.id, d.parent_id, d.name, ot.depth + 1
    FROM departments d
    JOIN org_tree ot ON d.parent_id = ot.id
)
SEARCH BREADTH FIRST BY id SET ordercol
CYCLE id SET is_cycle USING path_array
SELECT id, name, depth
FROM org_tree
WHERE NOT is_cycle
ORDER BY ordercol;
```

Data-modifying CTE -- archive-and-delete in single statement:

```sql
WITH deleted AS (
    DELETE FROM events
    WHERE created_at < NOW() - INTERVAL '90 days'
    RETURNING *
)
INSERT INTO events_archive
SELECT * FROM deleted;
```

CTE contracts:
- `AS MATERIALIZED` forces single evaluation; `AS NOT MATERIALIZED` forces inlining even with multiple references
- Side-effecting CTEs (INSERT/UPDATE/DELETE) are always materialized -- execute exactly once
- SEARCH BREADTH FIRST produces an `ordercol` (or custom name) for deterministic BFS ordering
- CYCLE columns are boolean `is_cycle` + array `path_array` -- filter `WHERE NOT is_cycle` in outer query
- SEARCH and CYCLE compose on the same recursive CTE -- SEARCH controls traversal order, CYCLE prevents infinite loops
- There is no `max_recursion_depth` GUC in PostgreSQL -- use LIMIT in outer query for explicit row caps
- Queue drain pattern: `DELETE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` atomically claims and removes rows


## MERGE (PG 15+)

```sql
MERGE INTO inventory AS tgt
USING incoming_shipments AS src
ON tgt.sku = src.sku
WHEN MATCHED AND src.qty = 0 THEN
    DELETE
WHEN MATCHED THEN
    UPDATE SET quantity = tgt.quantity + src.qty,
               updated_at = clock_timestamp()
WHEN NOT MATCHED THEN
    INSERT (sku, quantity, created_at, updated_at)
    VALUES (src.sku, src.qty, clock_timestamp(), clock_timestamp())
RETURNING merge_action() AS action,
          OLD.quantity AS prev_qty,
          NEW.quantity AS new_qty,
          NEW.sku;
```

MERGE contracts:
- `merge_action()` returns `'INSERT'`, `'UPDATE'`, or `'DELETE'` -- typed signal for downstream event emission
- `OLD.*` / `NEW.*` in RETURNING: access pre/post values -- replaces audit trigger patterns
- `OLD` is NULL for INSERT actions; `NEW` is NULL for DELETE actions
- MERGE acquires ROW EXCLUSIVE lock -- same as UPDATE; does NOT escalate to table lock
- Join condition must be deterministic -- each source row matches at most one target row
- Multiple WHEN MATCHED clauses: first matching condition wins (order matters)
- MERGE is atomic -- all matched rows processed in single statement execution
- MERGE fires row-level triggers only -- not statement-level BEFORE/AFTER triggers per action
- MERGE RETURNING composes inside CTEs for downstream INSERT/audit pipelines


## Conditional aggregation

FILTER (WHERE) replaces CASE WHEN inside aggregates -- clearer intent, better optimization:

```sql
SELECT department,
       count(*) FILTER (WHERE status = 'active') AS active_count,
       avg(salary) FILTER (WHERE status = 'active') AS active_avg_salary,
       count(*) FILTER (WHERE status = 'terminated') AS termed_count
FROM employees
GROUP BY department;
```

FILTER contracts:
- FILTER (WHERE) is evaluated before the aggregate function -- pre-filter, not post-filter
- Applies to regular aggregates, window aggregates, and ordered-set aggregates
- CASE WHEN inside aggregates is an anti-pattern -- use FILTER (WHERE) exclusively


## Multi-dimensional aggregation

GROUPING SETS, CUBE, and ROLLUP replace N separate GROUP BY queries with a single scan -- set-algebraic multi-level aggregation:

```sql
-- GROUPING SETS: explicit dimension combinations
SELECT region, product_category, date_trunc('month', sale_date) AS month,
       SUM(revenue) AS total_revenue,
       COUNT(*) AS sale_count,
       GROUPING(region, product_category, date_trunc('month', sale_date)) AS grouping_bits
FROM sales
WHERE tenant_id = current_setting('app.current_tenant')::uuid
GROUP BY GROUPING SETS (
    (region, product_category, date_trunc('month', sale_date)),   -- full detail
    (region, product_category),                                   -- by region+product
    (region),                                                     -- by region
    ()                                                            -- grand total
);

-- CUBE: all 2^n combinations of grouped columns
SELECT region, category, status,
       SUM(amount) AS total,
       GROUPING(region, category, status) AS gid
FROM orders
GROUP BY CUBE (region, category, status);

-- ROLLUP: hierarchical subtotals (n+1 levels)
SELECT date_trunc('year', created_at) AS yr,
       date_trunc('quarter', created_at) AS qtr,
       date_trunc('month', created_at) AS mo,
       SUM(revenue) AS total
FROM invoices
GROUP BY ROLLUP (
    date_trunc('year', created_at),
    date_trunc('quarter', created_at),
    date_trunc('month', created_at)
);
```

Multi-dimensional aggregation contracts:
- `GROUPING(col1, col2, ...)` returns a bitmask: bit=1 when column is aggregated (NULL because of grouping, not data) -- use to distinguish NULL-from-data vs NULL-from-rollup
- CUBE(a, b, c) produces 2^3 = 8 grouping sets -- exponential growth; limit to 3-4 columns
- ROLLUP(a, b, c) produces 4 grouping sets: (a,b,c), (a,b), (a), () -- hierarchical, not combinatorial
- Mixed syntax: `GROUP BY a, ROLLUP(b, c), CUBE(d)` composes via cross-product of grouping set lists
- Planner uses HashAggregate or GroupAggregate with Sort -- partial indexes on grouping columns accelerate sorted strategies
- `FILTER (WHERE ...)` composes with GROUPING SETS -- conditional aggregation within each dimension slice


## Window functions

GROUPS framing + EXCLUDE + FILTER in single query:

```sql
SELECT tenant_id, month, revenue,
       SUM(revenue) OVER (
           PARTITION BY tenant_id
           ORDER BY month
           GROUPS BETWEEN 2 PRECEDING AND CURRENT ROW
           EXCLUDE TIES
       ) AS rolling_3_group_sum,
       COUNT(*) FILTER (WHERE status = 'active')
           OVER (PARTITION BY tenant_id) AS active_count
FROM monthly_metrics;
```

Ordered-set aggregates with WITHIN GROUP:

```sql
SELECT region,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency)
           FILTER (WHERE status = 'success') AS p95_latency,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY latency) AS p50_latency,
       mode() WITHIN GROUP (ORDER BY error_code)
           FILTER (WHERE status = 'error') AS most_common_error
FROM request_metrics
GROUP BY region;
```

RANGE with INTERVAL -- time-based windowing without physical row counting:

```sql
SELECT tenant_id, event_date, revenue,
       AVG(revenue) OVER (
           PARTITION BY tenant_id
           ORDER BY event_date
           RANGE BETWEEN INTERVAL '7 days' PRECEDING AND CURRENT ROW
       ) AS rolling_7day_avg,
       SUM(revenue) OVER (
           PARTITION BY tenant_id
           ORDER BY event_date
           RANGE BETWEEN INTERVAL '30 days' PRECEDING AND CURRENT ROW
       ) AS rolling_30day_sum
FROM daily_metrics;
```

FIRST_VALUE / LAST_VALUE / NTH_VALUE -- positional extraction with frame trap:

```sql
SELECT product_id, price_date, price,
       FIRST_VALUE(price) OVER w AS initial_price,
       LAST_VALUE(price) OVER w AS current_price,
       NTH_VALUE(price, 2) OVER w AS second_price,
       price - FIRST_VALUE(price) OVER w AS price_delta
FROM product_price_history
WINDOW w AS (
    PARTITION BY product_id ORDER BY price_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
);
```

Distribution analytics -- PERCENT_RANK and CUME_DIST:

```sql
SELECT employee_id, department, salary,
       PERCENT_RANK() OVER w AS pct_rank,
       CUME_DIST() OVER w AS cumulative_dist
FROM employees
WINDOW w AS (PARTITION BY department ORDER BY salary);
```

Gap/island detection via LAG -- boolean expression, no CASE:

```sql
SELECT user_id, action_time,
       action_time - LAG(action_time) OVER w AS gap,
       (EXTRACT(EPOCH FROM (
           action_time - LAG(action_time) OVER w
       )) / 60 > 30)::int AS new_session
FROM user_actions
WINDOW w AS (PARTITION BY user_id ORDER BY action_time);
```

Time-series gap fill -- generate_series + LEFT JOIN + window:

```sql
SELECT gs.day,
       COALESCE(s.revenue, 0) AS revenue,
       AVG(COALESCE(s.revenue, 0)) OVER (
           ORDER BY gs.day
           ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
       ) AS ma_7day
FROM generate_series(
    '2024-01-01'::date, '2024-12-31'::date, '1 day'::interval
) AS gs(day)
LEFT JOIN daily_sales s ON gs.day = s.sale_date;
```

Window contracts:
- GROUPS framing counts distinct peer groups, not individual rows -- different from ROWS
- RANGE framing operates on value distance from current row's ORDER BY value -- composable with INTERVAL for time-based windows
- RANGE with INTERVAL requires a single ORDER BY column of date/timestamp/interval type -- multi-column ORDER BY invalid with RANGE INTERVAL
- Default frame: `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` (when ORDER BY specified)
- LAST_VALUE / NTH_VALUE frame trap: default frame ends at CURRENT ROW -- always specify `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING` for full-partition extraction
- FIRST_VALUE is safe with default frame (starts at UNBOUNDED PRECEDING)
- Frame exclusion modes: EXCLUDE CURRENT ROW, EXCLUDE GROUP, EXCLUDE TIES, EXCLUDE NO OTHERS
- `COUNT(DISTINCT ...) OVER (...)` is not supported -- use subquery or LATERAL join
- Named windows: `WINDOW w AS (PARTITION BY tenant_id ORDER BY created_at)` then `OVER (w ROWS ...)` for DRY framing
- `WITHIN GROUP (ORDER BY ...)` is required for ordered-set aggregates (percentile_cont, percentile_disc, mode)
- PERCENT_RANK: (rank - 1) / (total_rows - 1), range [0, 1] -- use for relative standing within partition
- CUME_DIST: count(values <= current) / total_rows, range (0, 1] -- use for cumulative distribution
- Gap detection: `(expression)::int` coercion preferred over CASE for boolean-to-integer projection


## JSON_TABLE and SQL/JSON (PG 17+)

JSON_TABLE -- structured relational extraction from JSONB:

```sql
SELECT o.id AS order_id, jt.*
FROM orders o,
    JSON_TABLE(
        o.metadata, '$.line_items[*]'
        COLUMNS (
            row_num     FOR ORDINALITY,
            sku         text    PATH '$.sku',
            quantity    int     PATH '$.qty',
            unit_price  numeric PATH '$.price',
            discount    numeric PATH '$.discount' DEFAULT 0 ON EMPTY
        )
    ) AS jt
WHERE jt.quantity > 0;
```

jsonb_path_query with variables and predicate pushdown:

```sql
SELECT id, metadata
FROM events
WHERE jsonb_path_exists(metadata, '$.tags[*] ? (@ == "priority")')
  AND jsonb_path_exists(metadata, '$.severity ? (@ >= $threshold)', '{"threshold": 3}'::jsonb);
```

SQL/JSON contracts:
- JSON_TABLE produces a relational result set -- composable with JOINs, WHERE, GROUP BY
- JSON_TABLE is an implicit LATERAL join -- outer row columns are accessible in path expressions
- JSON_TABLE COLUMNS support scalar SQL types only (text, int, numeric, uuid, boolean, timestamptz) -- composite and array types invalid
- `FOR ORDINALITY` generates a 1-based row number column for positional tracking
- `DEFAULT ... ON EMPTY` provides fallback when path yields no match (distinct from NULL)
- `DEFAULT ... ON ERROR` / `ERROR ON ERROR`: control behavior when path expression fails
- `RETURNING type`: explicit cast of extracted value -- avoids text intermediary
- Multiple NESTED PATH siblings produce a cross-product -- use separate JSON_TABLE calls for independent arrays
- jsonb_path_query returns `setof jsonb` -- use `jsonb_path_query_first` for scalar extraction
- SQL/JSON path language uses `@` for current item, `$` for root -- not JSONPath dot notation
- jsonb_path_query variables: second argument is jsonb object -- keys become `$varname` in path expression


## LATERAL JOIN

Scalar subqueries in SELECT list are FORBIDDEN -- always LATERAL JOIN for correlated subqueries.

Top-N per group -- latest 3 orders per customer:

```sql
SELECT c.id, c.name, recent.order_id, recent.total, recent.created_at
FROM customers c
CROSS JOIN LATERAL (
    SELECT o.id AS order_id, o.total, o.created_at
    FROM orders o
    WHERE o.customer_id = c.id
    ORDER BY o.created_at DESC
    LIMIT 3
) recent;
```

LATERAL with aggregation -- correlated aggregate without GROUP BY in outer:

```sql
SELECT d.id, d.name, stats.order_count, stats.total_revenue
FROM departments d
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS order_count,
           COALESCE(SUM(o.total), 0) AS total_revenue
    FROM orders o
    WHERE o.department_id = d.id
      AND o.created_at >= NOW() - INTERVAL '30 days'
) stats ON TRUE;
```

LATERAL contracts:
- LATERAL subquery can reference columns from preceding FROM items -- standard correlated subquery semantics
- `CROSS JOIN LATERAL` excludes rows where lateral returns empty; `LEFT JOIN LATERAL ... ON TRUE` preserves them with NULLs
- Planner may convert LATERAL to nested loop -- verify with EXPLAIN for large outer sets
- LATERAL + LIMIT is the canonical top-N-per-group pattern -- index on `(foreign_key, sort_column DESC)` required


## Temporal queries (tstzrange)

Range containment -- find entity version valid at a specific moment:

```sql
SELECT id, entity_id, payload, valid_period
FROM entity_versions
WHERE entity_id = $1
  AND valid_period @> $2::timestamptz
ORDER BY lower(valid_period) DESC
LIMIT 1;
```

Temporal diff -- detect changes between two points in time:

```sql
SELECT v_new.entity_id,
       v_old.payload AS before_state,
       v_new.payload AS after_state
FROM entity_versions v_new
JOIN entity_versions v_old ON v_new.entity_id = v_old.entity_id
WHERE v_new.valid_period @> $2::timestamptz   -- "now" snapshot
  AND v_old.valid_period @> $1::timestamptz   -- "then" snapshot
  AND v_new.id != v_old.id;                   -- different version rows
```

Contiguous coverage verification -- detect gaps in temporal history:

```sql
SELECT entity_id,
       unnest(range_agg(valid_period) - tstzrange(MIN(lower(valid_period)), MAX(upper(valid_period)))) AS gap
FROM entity_versions
WHERE entity_id = $1
GROUP BY entity_id
HAVING range_agg(valid_period) != tstzrange(MIN(lower(valid_period)), MAX(upper(valid_period)));
```

Temporal contracts:
- `@>` (range contains point): index via GiST on `valid_period` -- primary temporal lookup operator
- `&&` (ranges overlap): detects temporal conflicts; `WITHOUT OVERLAPS` in PK/UNIQUE prevents at schema level
- `-|-` (ranges adjacent): detects gapless sequences; `range_agg()` (PG 14+) collapses overlapping/adjacent ranges -- subtract from bounding range to expose gaps
- `upper(range)` / `lower(range)`: extract bounds for display or cursor-based temporal pagination
- Temporal tables with `WITHOUT OVERLAPS` guarantee at-most-one-match for point-in-time `@>` lookups -- no `LIMIT 1` needed on containment queries when constraint is present
- `PERIOD` in temporal FK enforces containment: child range must fall entirely within parent range


## Keyset pagination

Compound cursor -- multi-column sort with tiebreaker:

```sql
SELECT id, rank, title, created_at
FROM articles
WHERE tenant_id = $1
  AND (rank, id) < ($cursor_rank, $cursor_id)
ORDER BY rank DESC, id DESC
LIMIT $page_size + 1;
```

Keyset contracts:
- Fetch N+1 rows; `has_next = rows.length > page_size`; cursor = last visible row's sort key tuple
- First page: omit cursor WHERE clause, keep ORDER BY + LIMIT
- Bidirectional: reverse ORDER BY and comparison operator for "previous page"
- Tuple comparison `(a, b) < ($a, $b)` uses composite B-tree ordering -- single index scan
- Sort columns must be indexed -- composite index matching ORDER BY direction
- Ties in non-unique sort columns: always include PK as tiebreaker


## Batch operations via unnest

Unnest array parameters for set-based batch INSERT/UPDATE — never row-at-a-time loops:

```sql
INSERT INTO tags (tenant_id, entity_id, label)
SELECT $1, unnest($2::uuid[]), unnest($3::text[])
ON CONFLICT (tenant_id, entity_id, label) DO NOTHING;

-- Batch update with array-driven payload
UPDATE products SET price = batch.new_price, updated_at = clock_timestamp()
FROM unnest($1::uuid[], $2::numeric[]) AS batch(id, new_price)
WHERE products.id = batch.id AND products.tenant_id = $3;
```

- `unnest(a[], b[], ...)` expands multiple arrays in lockstep — same semantics as zip
- `ON CONFLICT DO NOTHING` for idempotent batch insert — no duplicate error on retry
- Array parameters bind via `EXECUTE ... USING` in PL/pgSQL or `sql(arrayParam)` in Effect-SQL


## Effect-SQL integration

Typed query execution via `@effect/sql-pg` (v0.49+):

```typescript
// SqlSchema.findAll — typed result decode via schema, parameterized query
const findByTenant = SqlSchema.findAll({
    Request: TenantId,
    Result: Order,
    execute: (tenantId) =>
        sql`SELECT id, name, status FROM orders WHERE tenant_id = ${tenantId}`,
})

// SqlSchema.findOne — Option-wrapped single result
const findById = SqlSchema.findOne({
    Request: OrderId,
    Result: Order,
    execute: (id) => sql`SELECT * FROM orders WHERE id = ${id}`,
})

// SqlResolver — batched N+1 resolution with automatic deduplication
const OrderById = SqlResolver.findById("OrderById", {
    Id: OrderId,
    Result: Order,
    ResultId: (row) => row.id,
    execute: (ids) => sql`SELECT * FROM orders WHERE id IN ${sql.in(ids)}`,
})

// Keyset pagination with typed cursor
const listOrders = (tenantId: TenantId, cursor: Option<PageCursor>, limit: number) =>
    SqlSchema.findAll({
        Request: S.Void,
        Result: Order,
        execute: () =>
            sql`SELECT id, rank, title, created_at FROM orders
                WHERE tenant_id = ${tenantId}
                ${cursor.pipe(Option.match({
                    onNone: () => sql``,
                    onSome: (c) => sql`AND (rank, id) < (${c.rank}, ${c.id})`,
                }))}
                ORDER BY rank DESC, id DESC
                LIMIT ${limit + 1}`,
    })(undefined)
```

- `sql` tagged template: parameterized, type-safe, injection-proof — never string concatenation
- `SqlSchema.findAll` / `SqlSchema.findOne` / `SqlSchema.single` / `SqlSchema.void`: typed result decode via schema — the canonical query-to-typed-result pattern
- `SqlResolver.findById` / `SqlResolver.grouped`: automatic batching for N+1 patterns, deduplicates IDs
- `sql.in(ids)` for `WHERE id IN (...)` — generates parameterized IN clause from array
- `sql.reserve` for session-pinned operations (advisory locks, temp tables) through PgBouncer
- PgClient config handles name transforms automatically (`transformResultNames: snakeToCamel`, `transformQueryNames: camelToSnake`, `transformJson: true`) — no manual transform wrapping needed
