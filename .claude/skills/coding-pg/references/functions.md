# Functions

## SQL functions

SQL functions are candidates for planner inlining when all conditions are met:
- SQL language (not PL/pgSQL)
- IMMUTABLE or STABLE volatility
- No SET clauses
- No SECURITY DEFINER
- No side effects
- Called in FROM clause or as scalar expression
- No subqueries referencing outer query levels
- Not a set-returning function called in FROM (materialized as subplan)

When inlined, the function body is substituted directly into the outer query plan -- zero call overhead.

```sql
CREATE FUNCTION full_name(profile jsonb)
RETURNS text
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN profile->>'first_name' || ' ' || profile->>'last_name';
```

Set-returning SQL function (not inlined -- materialized as subplan):

```sql
CREATE FUNCTION active_tenants()
RETURNS SETOF tenant
LANGUAGE SQL STABLE
AS $$ SELECT * FROM tenant WHERE archived_at IS NULL $$;
```

PG 14+ simplified syntax: `RETURN expr` for single-expression functions. Set-returning functions use `AS $$ SELECT ... $$` body syntax.

Function attribute contracts:

| Attribute | Semantics | Planner effect |
| --------- | --------- | -------------- |
| IMMUTABLE | Same input always same output, no database access | Constant-folding, index expression eligibility |
| STABLE | Result constant within single transaction | Safe for index scans within query, not for index creation |
| VOLATILE (default) | May return different results on successive calls | Prevents all planner optimizations |
| PARALLEL SAFE | No side effects, no backend-private state | Eligible for parallel query workers |
| PARALLEL RESTRICTED | Accesses backend-private state (temp tables, cursors) | Runs in parallel leader only |
| PARALLEL UNSAFE | Side effects or non-thread-safe code | Disables parallelism entirely |
| SECURITY INVOKER (default) | Executes with caller's privileges | Permits inlining |
| SECURITY DEFINER | Executes with owner's privileges; MUST set `SET search_path = pg_catalog, public` | Prevents inlining |

SECURITY INVOKER has always been the default for functions in all PG versions. PG 15 changed the default for views (not functions) via `CREATE VIEW ... WITH (security_invoker = on)`.

Volatility misclassification consequences:
- IMMUTABLE on a STABLE function: planner caches result across rows -- stale reads within query
- STABLE on a VOLATILE function: planner may eliminate repeated calls -- missed side effects
- Overly conservative (VOLATILE on IMMUTABLE): prevents index usage and constant folding


## PL/pgSQL functions

For multi-statement logic that SQL functions cannot express. Minimize PL/pgSQL -- every PL/pgSQL function is a candidate for replacement by SQL + CTE + MERGE.

```sql
CREATE FUNCTION upsert_entity(
    p_entity_type text,
    p_id uuid,
    p_payload jsonb,
    p_occ timestamptz DEFAULT NULL
) RETURNS TABLE(action text, old_data jsonb, new_data jsonb)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_query text;
BEGIN
    v_query := format(
        'MERGE INTO %I AS tgt
         USING (SELECT $1 AS id, $2 AS payload) AS src
         ON tgt.id = src.id
         WHEN MATCHED AND ($3 IS NULL OR tgt.updated_at = $3) THEN
             UPDATE SET payload = src.payload, updated_at = clock_timestamp()
         WHEN NOT MATCHED THEN
             INSERT (id, payload, created_at, updated_at)
             VALUES (src.id, src.payload, clock_timestamp(), clock_timestamp())
         RETURNING merge_action(), to_jsonb(OLD.*), to_jsonb(NEW.*)',
        p_entity_type
    );
    RETURN QUERY EXECUTE v_query USING p_id, p_payload, p_occ;
END;
$$;
```

PL/pgSQL contracts:
- `format('%I', ident)` for identifier interpolation -- `%I` double-quotes, preventing SQL injection
- `format('%L', literal)` for literal interpolation -- `%L` single-quotes and escapes
- Parameterized `EXECUTE ... USING` for value interpolation -- never concatenate values into query strings
- `RETURN QUERY SELECT ...` for static set-returning; `RETURN QUERY EXECUTE` for dynamic set-returning -- both stream rows without materializing
- `RETURN SELECT *` is invalid syntax -- always `RETURN QUERY SELECT *` in PL/pgSQL
- `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '...', DETAIL = '...'` for error signaling
- `GET DIAGNOSTICS v_count = ROW_COUNT` after DML to inspect affected rows

PL/pgSQL dispatch via EXECUTE -- eliminate IF/THEN chains:

```sql
-- Dynamic dispatch: operation name → SQL template, no branching
CREATE FUNCTION entity_op(
    p_table text,
    p_operation text,  -- 'get' | 'list' | 'put' | 'patch' | 'drop'
    p_id uuid DEFAULT NULL,
    p_payload jsonb DEFAULT NULL,
    p_occ timestamptz DEFAULT NULL,
    p_cursor_value text DEFAULT NULL,
    p_sort_column text DEFAULT 'updated_at',
    p_limit int DEFAULT 50
) RETURNS TABLE(action text, result jsonb)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_sql text;
BEGIN
    v_sql := (
        SELECT template FROM (VALUES
            ('get',   format('SELECT ''get'', to_jsonb(t.*) FROM %I t WHERE t.id = $1', p_table)),
            ('list',  format(
                'SELECT ''list'', to_jsonb(t.*) FROM %I t '
                'WHERE ($1 IS NULL OR (t.%I, t.id) < ($4, $1)) '
                'ORDER BY t.%I DESC, t.id DESC '
                'LIMIT $5 + 1',
                p_table, p_sort_column, p_sort_column)),
            ('put',   format(
                'MERGE INTO %I AS tgt USING (SELECT $1 AS id, $2 AS payload) AS src ON tgt.id = src.id '
                'WHEN MATCHED AND ($3 IS NULL OR tgt.updated_at = $3) THEN UPDATE SET payload = src.payload, updated_at = clock_timestamp() '
                'WHEN NOT MATCHED THEN INSERT (id, payload) VALUES (src.id, src.payload) '
                'RETURNING merge_action(), to_jsonb(NEW.*)', p_table)),
            ('patch', format('UPDATE %I SET payload = payload || $2, updated_at = clock_timestamp() WHERE id = $1 RETURNING ''patch'', to_jsonb(%I.*)', p_table, p_table)),
            ('drop',  format('UPDATE %I SET archived_at = clock_timestamp() WHERE id = $1 RETURNING ''drop'', to_jsonb(%I.*)', p_table, p_table))
        ) AS ops(op, template)
        WHERE op = p_operation
    );
    RETURN QUERY EXECUTE v_sql USING p_id, p_payload, p_occ, p_cursor_value, p_limit;
END;
$$;
```

Dispatch contracts:
- VALUES-based lookup replaces IF/THEN chains -- one code path, no branch coverage gaps
- `format('%I', ident)` in each template handles identifier safety
- `EXECUTE ... USING` binds values positionally -- zero SQL injection surface
- Adding operations: insert a new VALUES row -- no structural change to function body
- Unrecognized operation: v_sql is NULL, RETURN QUERY EXECUTE NULL raises error -- fail-fast

PL/pgSQL performance:
- Plan caching: PL/pgSQL caches plans after 5 executions -- parameter-dependent plan shapes cause regression
- `EXECUTE` forces re-planning every call -- use for dynamic SQL only, not to bypass plan caching
- Composite-type parameter passing copies entire row -- pass individual columns when row is wide
- EXCEPTION blocks create a subtransaction on entry (even if no error occurs) -- measurable overhead per call. Use specific conditions (`WHEN unique_violation`, `WHEN foreign_key_violation`) -- `WHEN OTHERS` masks bugs

Prepared statement vs dynamic SQL tradeoff (Effect-SQL):

| Path | Mechanism | Re-plans? | Use when |
| ---- | --------- | --------- | -------- |
| `sql` tagged template | Extended query protocol, auto-prepared after 5 calls | No (generic plan cached) | Fixed-shape queries (CRUD, pagination) — >99% of queries |
| `sql.reserve` | Session-pinned connection, PREPARE explicit | No | Advisory locks, temp tables, SET LOCAL through PgBouncer |
| PL/pgSQL `EXECUTE ... USING` | Re-plans every call | Yes | Dynamic SQL — table name interpolation, polymorphic dispatch |

- For >10K calls/sec on fixed-shape queries: `sql` tagged template (auto-prepared) — zero re-plan overhead
- For polymorphic functions with table-name dispatch: `EXECUTE ... USING` is unavoidable — the table name changes per call, so plan reuse is impossible
- `plan_cache_mode = force_custom_plan` when generic plan is suboptimal (skewed data distribution on parameterized columns)


## Custom aggregates

State function + final function pattern for domain-specific fold operations.

```sql
CREATE FUNCTION weighted_avg_state(state numeric[2], value numeric, weight numeric)
RETURNS numeric[2]
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN ARRAY[state[1] + value * weight, state[2] + weight];

CREATE FUNCTION weighted_avg_final(state numeric[2])
RETURNS numeric
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN state[1] / NULLIF(state[2], 0);

CREATE FUNCTION weighted_avg_combine(a numeric[2], b numeric[2])
RETURNS numeric[2]
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN ARRAY[a[1] + b[1], a[2] + b[2]];

CREATE AGGREGATE weighted_avg(value numeric, weight numeric) (
    SFUNC = weighted_avg_state,
    STYPE = numeric[2],
    FINALFUNC = weighted_avg_final,
    COMBINEFUNC = weighted_avg_combine,
    INITCOND = '{0,0}',
    PARALLEL = SAFE
);

SELECT category, weighted_avg(score, confidence) FROM reviews GROUP BY category;
```

Moving-aggregate with MSFUNC/MINVFUNC -- O(1) per frame slide for window aggregates:

```sql
CREATE FUNCTION running_sum_state(state numeric, value numeric)
RETURNS numeric
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN COALESCE(state, 0) + value;

CREATE FUNCTION running_sum_inv(state numeric, value numeric)
RETURNS numeric
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
RETURN state - value;

CREATE AGGREGATE running_sum(value numeric) (
    SFUNC = running_sum_state,
    STYPE = numeric,
    MSFUNC = running_sum_state,
    MSTYPE = numeric,
    MINVFUNC = running_sum_inv,
    INITCOND = '0',
    MINITCOND = '0',
    PARALLEL = SAFE
);

-- Window usage: each frame slide subtracts departing row, adds arriving row
SELECT ts, value,
       running_sum(value) OVER (ORDER BY ts ROWS BETWEEN 5 PRECEDING AND CURRENT ROW)
FROM metrics;
```

Aggregate contracts:

| Clause | Purpose | Consequence of omission |
| ------ | ------- | ----------------------- |
| COMBINEFUNC | Merge partial states from parallel workers | Aggregate runs single-threaded |
| INITCOND | Text representation of initial STYPE value | State starts as NULL; SFUNC must handle NULL input |
| FINALFUNC_MODIFY = READ_ONLY | Final function does not modify state | Required when STYPE is pass-by-reference and state is reused |
| MSFUNC/MSTYPE/MINVFUNC | Moving-aggregate optimization | Window aggregates recompute from scratch on each frame slide |
| SORTOP | Aggregate can exploit sorted input | No sort-based optimization |

Ordered-set aggregates: `CREATE AGGREGATE ... (ORDER BY ...)` with `WITHIN GROUP (ORDER BY ...)` at call site -- for percentile_cont, mode, and similar rank-dependent computations.

Hypothetical-set aggregates: `CREATE AGGREGATE ... (ORDER BY ...)` with `HYPOTHETICAL` flag -- answers "what rank would this value have?" without inserting.


## Procedures

Procedures (PG 11+) for transaction-controlled operations. Unlike functions, procedures can COMMIT/ROLLBACK within their body.

```sql
CREATE PROCEDURE batch_archive(p_batch_size int DEFAULT 1000)
LANGUAGE plpgsql
AS $$
DECLARE
    v_affected int;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT id FROM events
            WHERE created_at < now() - interval '90 days'
            AND archived_at IS NULL
            ORDER BY id
            LIMIT p_batch_size
            FOR UPDATE SKIP LOCKED
        )
        UPDATE events SET archived_at = clock_timestamp()
        FROM candidates WHERE events.id = candidates.id;

        GET DIAGNOSTICS v_affected = ROW_COUNT;
        COMMIT;
        EXIT WHEN v_affected < p_batch_size;
    END LOOP;
END;
$$;
```

Procedure contracts:
- `CALL procedure_name(...)` -- cannot be used in SELECT or as expression
- COMMIT/ROLLBACK requires LANGUAGE plpgsql -- not available in SQL procedures
- Procedures cannot return values -- use OUT parameters or write results to a staging table
- Transaction control restriction: procedures using COMMIT/ROLLBACK cannot be called inside a client-initiated transaction block
- `FOR UPDATE SKIP LOCKED` prevents contention when multiple instances run concurrently
- Intermediate COMMIT releases row locks and frees WAL -- critical for large batch operations


## Batch/Queue Patterns

`FOR UPDATE SKIP LOCKED` is the standard locking strategy for any batch or queue processing function. When multiple workers consume from the same table concurrently, SKIP LOCKED prevents contention — each worker claims its own batch without blocking.

```sql
CREATE FUNCTION claim_batch(
    p_table text,
    p_batch_size int DEFAULT 100,
    p_status_from text DEFAULT 'pending',
    p_status_to text DEFAULT 'processing'
) RETURNS TABLE(id uuid, payload jsonb)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_sql text;
BEGIN
    v_sql := format(
        'WITH batch AS (
            SELECT id FROM %I
            WHERE status = $1
            ORDER BY created_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        )
        UPDATE %I SET status = $3, started_at = clock_timestamp()
        FROM batch WHERE %I.id = batch.id
        RETURNING %I.id, %I.payload',
        p_table, p_table, p_table, p_table, p_table
    );
    RETURN QUERY EXECUTE v_sql USING p_status_from, p_batch_size, p_status_to;
END;
$$;
```

Batch/queue contracts:
- `FOR UPDATE SKIP LOCKED` — rows locked by other workers are skipped entirely, not queued. Ensure all rows eventually processed (e.g., periodic sweep for stuck rows)
- Combine with `unnest` batch pattern: when processing batch arrays, the function should use FOR UPDATE SKIP LOCKED as the queue-safe variant for concurrent batch consumers
- Intermediate COMMIT in procedures releases row locks and frees WAL — critical for large batch operations (see Procedures section)
- Index on `(status, created_at)` required — partial index `WHERE status = 'pending'` for selective access


## Polymorphic functions

Generic functions via polymorphic pseudo-types. One function serves all compatible types.

```sql
CREATE FUNCTION array_compact(arr anyarray)
RETURNS anyarray
LANGUAGE SQL IMMUTABLE PARALLEL SAFE
AS $$ SELECT array_agg(elem) FROM unnest(arr) AS elem WHERE elem IS NOT NULL $$;
```

Polymorphic type resolution:

| Pseudo-type | Resolution rule |
| ----------- | --------------- |
| anyelement | All anyelement params and return must resolve to same concrete type |
| anyarray | Array of anyelement -- must agree on element type with any anyelement in signature |
| anynonarray | Same as anyelement but rejects array types |
| anyenum | Same as anyelement but rejects non-enum types |
| anycompatible (PG 13+) | Params may differ -- planner finds common supertype via implicit cast |
| anycompatiblearray | Array of anycompatible element type -- already an array type, no `[]` suffix needed |
| anycompatiblenonarray | anycompatible but rejects arrays |
| anycompatiblerange | Range over anycompatible element type |
| anycompatiblemultirange (PG 14+) | Multirange over anycompatible element type |

Resolution contracts:
- At least one input parameter must be polymorphic for the return type to be polymorphic
- `anyelement` resolution is strict per-call -- no implicit casting between parameters
- `anycompatible` is weaker -- PG will implicitly cast to find common type (int + numeric -> numeric)
- Mixing `any*` and `anycompatible*` families in the same function signature is forbidden
- `anycompatiblearray` is already an array pseudo-type -- using `anycompatiblearray[]` is redundant and incorrect
- Overloaded functions: PG resolves by argument types -- avoid overloading across polymorphic and concrete signatures (resolution becomes ambiguous)
