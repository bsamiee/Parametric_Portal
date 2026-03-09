# Performance

AIO, JIT, parallel query, vacuum optimization, cost model tuning, connection pooling, plan-driven diagnostics for PostgreSQL 18.2+.


## Asynchronous I/O (PG 18)

2-3x throughput for sequential scans, bitmap heap scans, and vacuum on Linux with io_uring.

```ini
io_method = io_uring                      # Linux 5.6+ (IORING_FEAT_NODROP); 'worker' is compile-time only, not a runtime fallback
io_max_concurrency = 0                    # 0 = auto (based on max_parallel_workers)
io_combine_limit = 128kB                  # combine adjacent page reads into single I/O
effective_io_concurrency = 200            # bitmap heap prefetch distance; SSD: 200, HDD: 2-4
maintenance_io_concurrency = 100          # vacuum, CREATE INDEX prefetch
```

AIO contracts:
- Primary benefit: sequential scans, bitmap heap scans, VACUUM (2-3x throughput). Index point lookups see modest improvement (10-20%) only under high-concurrency prefetch conditions — already single-page I/O
- `io_uring` requires Linux 5.6+ with `IORING_FEAT_NODROP`; non-Linux platforms degrade to synchronous I/O (no thread-based fallback). `worker` mode is a compile-time option, not automatic
- Breakeven: AIO overhead (submission queue management) exceeds benefit for queries returning <100 rows via index scan — disable per-session with `SET LOCAL io_max_concurrency = 1` for OLTP-heavy connections


## JIT Compilation

JIT compiles query expressions to native code. Beneficial for complex expressions on large datasets; overhead for simple queries.

```ini
jit = on                                  # enable JIT (default on since PG 12)
jit_above_cost = 100000                   # JIT kicks in above this estimated cost
jit_inline_above_cost = 500000            # inline functions above this cost
jit_optimize_above_cost = 500000          # apply LLVM optimizations above this cost
```

JIT contracts:
- JIT benefits: complex WHERE expressions, aggregation with many columns, complex JOIN conditions
- JIT overhead: ~50-200ms compilation time -- amortized only for queries processing many rows
- Disable per-query: `SET LOCAL jit = off` for queries where JIT overhead exceeds benefit (small result sets, OLTP)
- JIT compiled plans are NOT cached across executions — each `EXECUTE` of a prepared statement re-compiles if JIT threshold met. High-concurrency OLTP with many unique query shapes: set `jit = off` globally, enable per-session for analytics
- `EXPLAIN ANALYZE` shows JIT time: `JIT: Functions: N, Generation Time: X.Xms, Optimization Time: X.Xms, Emission Time: X.Xms`


## Parallel Query

```ini
max_parallel_workers_per_gather = 4       # workers per Gather node
max_parallel_workers = 8                  # total across all queries; each consumes a connection slot
max_parallel_maintenance_workers = 4      # CREATE INDEX, VACUUM, parallel GIN build (PG 18)
min_parallel_table_scan_size = 8MB        # threshold for parallel seq scan
min_parallel_index_scan_size = 512kB      # threshold for parallel index scan
parallel_setup_cost = 1000                # estimated launch cost
parallel_tuple_cost = 0.1                 # per-tuple transfer cost to leader
# Eligible: seq/index/bitmap scan, hash/merge/NL join, aggregation, sort, append
# Ineligible: serializable isolation, PARALLEL UNSAFE functions
```

Parallel contracts:
- Partial aggregation: workers compute partials, leader combines -- requires associative/commutative aggregate
- `Workers Launched` < `Workers Planned` in EXPLAIN → `max_parallel_workers` saturated globally
- Mark custom functions `PARALLEL SAFE` when side-effect-free and no backend-private state access
- Breakeven: parallel overhead (process launch + tuple transfer) exceeds benefit below ~100K qualifying rows. Force serial for small tables: `SET LOCAL max_parallel_workers_per_gather = 0`


## Vacuum Optimization

Vacuum reclaims dead tuples, updates visibility map, and freezes old transactions.

```ini
autovacuum_vacuum_cost_delay = 2ms        # pause between cost-limited work (default 2ms, was 20ms)
autovacuum_vacuum_cost_limit = 200        # cost limit per round (default 200)
autovacuum_vacuum_scale_factor = 0.05     # trigger at 5% dead tuples (default 0.2 is too conservative)
autovacuum_analyze_scale_factor = 0.05    # trigger analyze at 5% changed rows
autovacuum_max_workers = 4                # parallel autovacuum workers
autovacuum_naptime = 15s                  # check interval (default 60s)
```

Advanced vacuum patterns:
- Per-table tuning: `ALTER TABLE hot_table SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 0)`
- Vacuum monitoring (PG 18): `SELECT relname, total_vacuum_time, total_analyze_time FROM pg_stat_all_tables`
- Freeze: tune `autovacuum_freeze_max_age` (default 200M) to prevent transaction ID wraparound -- remaining settings rarely need adjustment

Vacuum contracts:
- `VACUUM (SKIP_LOCKED)` for tables with concurrent long transactions -- vacuums only unlocked pages
- AIO (PG 18) accelerates vacuum I/O -- 2-3x faster on SSD with io_uring
- Dead tuple storage: PG 17+ uses TidStore (radix tree) instead of flat array -- handles billions of dead tuples without memory exhaustion
- `VACUUM FULL` rewrites entire table -- takes AccessExclusiveLock; use `pg_repack` extension for online table compaction


## Cost Model Tuning

The planner's cost model determines whether it chooses index scans or sequential scans. Incorrect cost parameters directly undermine index strategy.

```ini
random_page_cost = 1.1                    # SSD (default 4.0 assumes spinning disk)
seq_page_cost = 1.0                       # sequential page read cost (baseline)
cpu_tuple_cost = 0.01                     # per-tuple processing cost (default)
cpu_index_tuple_cost = 0.005              # per-index-entry processing cost (default)
cpu_operator_cost = 0.0025                # per-operator evaluation cost (default)
effective_cache_size = '24GB'             # hint: total OS + PG cache (50-75% of RAM)
```

Cost model contracts:
- `random_page_cost / seq_page_cost` ratio governs index vs seq scan preference -- SSD ratio should approach 1.0; default 4.0 heavily penalizes index scans
- `effective_cache_size` is a planner hint (no memory allocated) -- undersized value causes seq scan preference on indexed queries; set to 50-75% of total RAM
- Diagnosis: EXPLAIN shows seq scan on selective indexed query → `random_page_cost` too high
- Mixed storage: `ALTER TABLESPACE ssd_space SET (random_page_cost = 1.1)` for per-tablespace override
- Verification: `EXPLAIN (ANALYZE, BUFFERS)` on representative queries after cost tuning. If `Seq Scan` persists on queries with <5% selectivity and a matching index, the cost model is miscalibrated — not the index strategy


## Connection and Memory Tuning

```ini
shared_buffers = '8GB'                    # 25% of RAM for dedicated DB server
work_mem = '64MB'                         # per-operation sort/hash memory
maintenance_work_mem = '2GB'              # for VACUUM, CREATE INDEX
huge_pages = try                          # reduce TLB misses for large shared_buffers
```

Memory contracts:
- `work_mem` is per operation -- a query with 5 hash joins uses 5x work_mem; set conservatively
- `shared_buffers` > 25% of RAM: diminishing returns, OS page cache handles the rest
- `huge_pages = try`: uses 2MB huge pages if available -- significant for shared_buffers > 4GB


## Connection Pooling and Prepared Statements

PgBouncer transaction-mode prepared statement strategies:

| Strategy                             | Mechanism                                             | Status       |
| ------------------------------------ | ----------------------------------------------------- | ------------ |
| PgBouncer 1.21+ `prepared_statement` | Transparent PS management across pooled connections   | Preferred    |
| `protocol = 'simple'`                | Disables extended query protocol; parse-on-every-exec | Fallback     |
| App-level `PREPARE`/`EXECUTE`        | Server may lack PS after pool reassignment            | Anti-pattern |

`SET LOCAL` scoping:
- `SET LOCAL work_mem = '256MB'` applies within current transaction only -- safe with transaction-mode pooling
- Use for per-query `work_mem`, `jit`, `statement_timeout` overrides without affecting other clients


## EXPLAIN Analysis

Primary diagnostic tool. Always use `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)` -- never wall-clock time alone. Add `FORMAT JSON` for programmatic parsing. Add `WAL` to measure WAL generation per statement (write queries).

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL) <query>;
ROLLBACK;  -- wrap write queries to prevent side effects
```

PG 18 enhancements: automatic buffer reporting, index lookup counts, VERBOSE includes CPU/WAL/read stats, `Settings` shows non-default GUCs affecting the plan.

Key metrics per node:

| Metric        | Reading                             | Signal                                            |
| ------------- | ----------------------------------- | ------------------------------------------------- |
| `actual time` | First/last-row ms (inclusive)       | Subtract child time for node cost                 |
| `rows`        | Actual vs estimated cardinality     | >10x → stale stats / correlated cols              |
| `Buffers`     | `shared hit` vs `read` ratio        | High `read` → cold cache / small `shared_buffers` |
| `I/O Timings` | I/O wait vs CPU (`track_io_timing`) | Compute-bound vs I/O-bound                        |
| `WAL`         | `records` / `fpi` / `bytes`         | High `fpi` → checkpoint too frequent              |

Plan node diagnostics:

| Node                     | Indicates                  | Diagnostic                              |
| ------------------------ | -------------------------- | --------------------------------------- |
| `Index Only Scan`        | Covering index working     | `Heap Fetches` ≈ 0 after VACUUM         |
| `Bitmap Heap Scan`       | Multi-index merge          | `lossy` → increase `work_mem`           |
| `Hash Join`              | Large equijoin             | `Batches` > 1 → spill to disk           |
| `Nested Loop`            | Small outer, indexed inner | High outer x seq inner → missing index  |
| `Parallel Seq Scan`      | Workers engaged            | `Launched` < `Planned` → saturated      |
| `Memoize` (14+)          | NL inner cache             | `Evictions` > 0 → raise `work_mem`      |
| `Incremental Sort` (13+) | Partial presort via index  | Composite index on full key avoids sort |

Plan pathologies:

| Symptom                             | Cause                       | Fix                            |
| ----------------------------------- | --------------------------- | ------------------------------ |
| NL: high outer x seq inner          | Missing join index          | Add index on join column       |
| Hash: `Batches` > 1                 | `work_mem` spill            | Increase `work_mem`            |
| Sort: `external merge`              | `work_mem` insufficient     | Increase `work_mem`            |
| Bitmap: `lossy` blocks              | Bitmap exceeds `work_mem`   | Increase `work_mem`            |
| Filter removes >> rows returned     | Missing partial index       | Add partial index              |
| Seq scan on selective indexed query | `random_page_cost` too high | Set 1.1-1.5 for SSD            |
| `actual rows` = 0, `estimated` > 0  | Empty result                | Plan valid; timing meaningless |

EXPLAIN contracts:
- `ANALYZE` actually executes the query -- use `BEGIN; EXPLAIN ANALYZE ...; ROLLBACK;` for write queries
- Row estimate accuracy: `actual rows` vs `estimated rows` -- ratio > 10x suggests stale statistics or unanalyzed table. Run `ANALYZE tablename` and re-check
- `SETTINGS` flag surfaces non-default GUCs (e.g., `random_page_cost`, `work_mem`) that affected plan choice -- critical for diagnosing why production differs from local

I/O statistics: see `observability.md` pg_stat_io section.


## Query Optimization Patterns

Batch processing: `FOR UPDATE SKIP LOCKED` for concurrent worker queue.

```sql
WITH batch AS (
    SELECT id FROM task_queue
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE task_queue SET status = 'processing', started_at = clock_timestamp()
FROM batch WHERE task_queue.id = batch.id
RETURNING task_queue.*;
```

Planner override escape hatch (requires pg_hint_plan):

```sql
/*+ HashJoin(t1 t2) SeqScan(t1) Leading((t2 t1)) */
SELECT ... FROM t1 JOIN t2 ON ...;
```

pg_hint_plan forces plan shapes when planner makes suboptimal choices on complex joins. Diagnostic tool -- investigate root cause (statistics, cost model) before resorting to hints.

Analytical acceleration: for OLAP workloads (GROUP BY, window functions, large aggregates), `SET duckdb.force_execution = true` via pg_duckdb achieves 1000x+ speedup. See `extensions.md` pg_duckdb section. Native PG for OLTP; DuckDB for OLAP.

Advisory locks for distributed coordination:

```sql
-- Session-level advisory lock: held until explicit release or session end
SELECT pg_advisory_lock(hashtext('migration_v42'));
-- ... run migration ...
SELECT pg_advisory_unlock(hashtext('migration_v42'));

-- Transaction-level: auto-released at COMMIT/ROLLBACK
SELECT pg_advisory_xact_lock(hashtext('singleton_job'));

-- Non-blocking try: returns false if lock unavailable
SELECT pg_try_advisory_lock(hashtext('leader_election'));
```

- `hashtext()` for text-to-int8 key derivation — deterministic, collision-resistant for human-readable lock names
- Transaction-level (`pg_advisory_xact_lock`) preferred — no risk of orphaned locks on crash
- Session-level via `sql.reserve` in Effect-SQL — session-pinned connection required through PgBouncer
- Two key spaces: 64-bit single-key and 32-bit dual-key — use dual-key for `(entity_type_hash, entity_id_hash)` patterns

Optimization contracts:
- `SKIP LOCKED` skips locked rows entirely -- they are NOT retried; ensure all rows eventually processed
- Prepared statements: `PREPARE stmt AS ...` + `EXECUTE stmt(...)` -- avoids repeated parse/plan after 5th execution (custom plan to generic plan transition)
- `plan_cache_mode = force_custom_plan` for parameterized queries where generic plan is suboptimal (skewed data distribution)
- Statistics target: `ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000` -- increase for high-cardinality skewed columns


## WAL and Checkpoint Tuning

```ini
wal_level = replica                       # minimum for replication; 'logical' for CDC
max_wal_size = '4GB'                      # trigger checkpoint after this much WAL
min_wal_size = '1GB'                      # reclaim WAL below this threshold
checkpoint_completion_target = 0.9        # spread checkpoint I/O over 90% of interval
checkpoint_timeout = '15min'              # default 5min; increase for write-heavy workloads
wal_compression = zstd                    # PG 15+: compress full-page writes (reduces WAL volume 50-70%)
```

WAL contracts:
- `wal_compression = zstd` reduces WAL volume significantly -- lower replication bandwidth and faster WAL replay
- `full_page_writes = on` (never disable in production) -- protects against partial page writes on crash
- Monitor checkpoint frequency: `SELECT * FROM pg_stat_checkpointer` -- `checkpoints_req` (forced) should be rare relative to `checkpoints_timed`


## Partitioning Performance

Partition pruning eliminates irrelevant partitions at plan time and execution time.

```ini
enable_partition_pruning = on             # default on; planner eliminates non-matching partitions
```

Partitioning contracts:
- Declarative partitioning (RANGE, LIST, HASH) preferred over inheritance-based
- Partition key must appear in WHERE clause for pruning to activate -- queries without partition key scan all partitions
- Join-wise partition matching: PG can perform partition-wise joins when both sides share identical partition scheme
- Partition count: 100-1000 partitions manageable; >10000 degrades planning time
- `pg_partman` extension for automated partition creation, retention, and maintenance
- Partition-level VACUUM: each partition vacuumed independently -- hot partitions get more frequent vacuum
