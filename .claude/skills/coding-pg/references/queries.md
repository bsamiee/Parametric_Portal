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

Window contracts:
- GROUPS framing counts distinct peer groups, not individual rows -- different from ROWS
- RANGE framing operates on value distance from current row's ORDER BY value
- Default frame: `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` (when ORDER BY specified)
- Frame exclusion modes: EXCLUDE CURRENT ROW, EXCLUDE GROUP, EXCLUDE TIES, EXCLUDE NO OTHERS
- `COUNT(DISTINCT ...) OVER (...)` is not supported -- use subquery or LATERAL join
- Named windows: `WINDOW w AS (PARTITION BY tenant_id ORDER BY created_at)` then `OVER (w ROWS ...)` for DRY framing
- `WITHIN GROUP (ORDER BY ...)` is required for ordered-set aggregates (percentile_cont, percentile_disc, mode)


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
