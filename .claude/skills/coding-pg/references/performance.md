# Performance

AIO, JIT, parallel query, vacuum optimization, cost model tuning, connection pooling, plan-driven diagnostics for PostgreSQL 18.2+.


## Asynchronous I/O (PG 18)

AIO subsystem queues multiple read requests, overlapping disk with CPU. 2-3x throughput for sequential scans, bitmap heap scans, and vacuum on Linux with io_uring.

```
io_method = io_uring                      # Linux only; 'worker' fallback for other OS
io_max_concurrency = 0                    # 0 = auto (based on max_parallel_workers)
io_combine_limit = 128kB                  # combine adjacent page reads into single I/O
effective_io_concurrency = 200            # hint for bitmap heap scans
maintenance_io_concurrency = 100          # hint for vacuum, CREATE INDEX
```

AIO contracts:
- `io_uring` requires Linux kernel 5.6+ (needs IORING_FEAT_NODROP) -- falls back to `worker` (thread-based) on other platforms
- AIO benefits sequential scans, bitmap heap scans, VACUUM -- minimal impact on index point lookups (already single-page)
- `effective_io_concurrency`: prefetch distance for bitmap heap scan -- SSD: 200, HDD: 2-4


## JIT Compilation

JIT compiles query expressions to native code. Beneficial for complex expressions on large datasets; overhead for simple queries.

```
jit = on                                  # enable JIT (default on since PG 12)
jit_above_cost = 100000                   # JIT kicks in above this estimated cost
jit_inline_above_cost = 500000            # inline functions above this cost
jit_optimize_above_cost = 500000          # apply LLVM optimizations above this cost
```

JIT contracts:
- JIT benefits: complex WHERE expressions, aggregation with many columns, complex JOIN conditions
- JIT overhead: ~50-200ms compilation time -- amortized only for queries processing many rows
- Disable per-query: `SET LOCAL jit = off` for queries where JIT overhead exceeds benefit (small result sets, OLTP)
- `EXPLAIN ANALYZE` shows JIT time: `JIT: Functions: N, Generation Time: X.Xms, Optimization Time: X.Xms, Emission Time: X.Xms`


## Parallel Query

Parallel execution for scans, joins, and aggregation.

```
max_parallel_workers_per_gather = 4       # workers per Gather node
max_parallel_workers = 8                  # total parallel workers across all queries
max_parallel_maintenance_workers = 4      # workers for CREATE INDEX, VACUUM
min_parallel_table_scan_size = 8MB        # minimum table size for parallel scan
min_parallel_index_scan_size = 512kB      # minimum index size for parallel index scan
parallel_setup_cost = 1000                # estimated cost to launch worker
parallel_tuple_cost = 0.1                 # estimated cost per tuple transfer to leader
```

Parallel-eligible operations:
- Sequential scan, index scan, bitmap heap scan
- Hash join, merge join, nested loop (inner side)
- Aggregation (partial then final), Sort
- Append (union all of partitions)
- PG 18: parallel GIN index builds

Parallel-ineligible:
- Queries in serializable isolation
- Functions marked PARALLEL UNSAFE

Parallel contracts:
- Each parallel worker is a separate backend -- consumes a connection slot from `max_connections`
- Parallel aggregation: workers compute partial aggregates, leader combines -- requires associative/commutative aggregate
- `EXPLAIN` shows `Workers Planned: N, Workers Launched: N` -- launched < planned means `max_parallel_workers` saturated
- Mark custom functions PARALLEL SAFE when they have no side effects and do not access backend-private state


## Vacuum Optimization

Vacuum reclaims dead tuples, updates visibility map, and freezes old transactions.

```
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

```
random_page_cost = 1.1                    # SSD (default 4.0 assumes spinning disk)
seq_page_cost = 1.0                       # sequential page read cost (baseline)
cpu_tuple_cost = 0.01                     # per-tuple processing cost (default)
cpu_index_tuple_cost = 0.005              # per-index-entry processing cost (default)
cpu_operator_cost = 0.0025                # per-operator evaluation cost (default)
effective_cache_size = '24GB'             # hint: total OS + PG cache (50-75% of RAM)
```

Critical interactions:
- `random_page_cost = 4.0` (default) causes planner to heavily penalize index scans on SSD -- set to 1.1-1.5 for SSD storage. The ratio `random_page_cost / seq_page_cost` governs the relative preference for sequential vs random access; on SSD this ratio should approach 1.0
- `seq_page_cost = 1.0` is the baseline against which all other costs are measured -- rarely changed, but the ratio matters more than absolute values
- `effective_cache_size` does NOT allocate memory -- it tells the planner how much data is likely cached. Typically 50-75% of total system RAM. Higher values make index scans cheaper (planner assumes random reads will hit cache). Undersized value causes unnecessary sequential scan preference
- Verify cost model alignment: if EXPLAIN shows sequential scan on a selective indexed query (few rows returned from large table), `random_page_cost` is likely too high
- Per-tablespace cost override: `ALTER TABLESPACE ssd_space SET (random_page_cost = 1.1)` -- useful for mixed SSD/HDD deployments


## Connection and Memory Tuning

```
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

PgBouncer transaction-mode pooling prepared statement strategies (preference order):

1. **PgBouncer 1.21+ `prepared_statement` mode** (preferred) -- transparently manages prepared statements across pooled connections; no application changes
2. **Application-level `protocol = 'simple'`** (fallback) -- disables extended query protocol, forces parse-on-every-execute; slight overhead per query
3. **`PREPARE`/`EXECUTE` with transaction pooling** (anti-pattern) -- server connection may lack the prepared statement; breaks silently

`SET LOCAL` scoping:
- `SET LOCAL work_mem = '256MB'` applies only within the current transaction -- safe with transaction-mode pooling
- Use for per-query memory overrides, `jit` toggling, and `statement_timeout` without affecting other clients on the same server connection


## EXPLAIN Analysis

Primary diagnostic tool. Always use `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)` -- never wall-clock time alone. Add `FORMAT JSON` for programmatic parsing. Add `WAL` to measure WAL generation per statement (write queries).

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL) <query>;
ROLLBACK;  -- wrap write queries to prevent side effects
```

PG 18 enhancements: automatic buffer reporting, index lookup counts, VERBOSE includes CPU/WAL/read stats, `Settings` shows non-default GUCs affecting the plan.

Key metrics per node:
- `actual time`: first-row and last-row timings in milliseconds (inclusive of children -- subtract child time for node's own cost)
- `rows`: actual vs estimated -- ratio > 10x indicates stale statistics, missing histogram, or correlated columns the planner cannot model
- `Buffers: shared hit/read/dirtied/written` -- high `read` relative to `hit` means cold cache or undersized shared_buffers
- `I/O Timings` (requires `track_io_timing = on`): separates I/O wait from CPU time -- essential for distinguishing compute-bound from I/O-bound queries
- `WAL: records/fpi/bytes` -- full page images (fpi) dominate WAL volume after checkpoint; high fpi count suggests checkpoint interval is too short

Key plan nodes:
- `Index Only Scan` -- covering index working (check `Heap Fetches` -- should be near 0 after VACUUM; see indexes.md for visibility map mechanics)
- `Bitmap Heap Scan` -- multiple index conditions combined via bitmap; `lossy` blocks indicate `work_mem` too low for exact bitmap
- `Hash Join` vs `Nested Loop` -- planner choosing correct join strategy for data size
- `Parallel Seq Scan` -- parallel workers engaged for large table scans
- `Memoize` (PG 14+) -- nested loop inner side cached -- check `Hits` vs `Misses`; `Evictions` > 0 means cache undersized

Plan pathologies:
- Nested loop with high outer rows + seq scan inner: missing index on join column
- Hash join batch > 1: `work_mem` too low, spilling to disk
- Sort method `external merge`: `work_mem` insufficient for in-memory sort
- Bitmap heap scan with `lossy` blocks: `work_mem` too low for bitmap (reverts to page-level granularity)
- Rows removed by filter >> rows returned: missing partial index or predicate pushdown opportunity
- Sequential scan on selective indexed query: `random_page_cost` too high (see Cost Model Tuning)
- `actual rows` uniformly 0 but `estimated rows` > 0: query returned no data -- plan analysis still valid for structure but timing meaningless

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

```
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

```
enable_partition_pruning = on             # default on; planner eliminates non-matching partitions
```

Partitioning contracts:
- Declarative partitioning (RANGE, LIST, HASH) preferred over inheritance-based
- Partition key must appear in WHERE clause for pruning to activate -- queries without partition key scan all partitions
- Join-wise partition matching: PG can perform partition-wise joins when both sides share identical partition scheme
- Partition count: 100-1000 partitions manageable; >10000 degrades planning time
- `pg_partman` extension for automated partition creation, retention, and maintenance
- Partition-level VACUUM: each partition vacuumed independently -- hot partitions get more frequent vacuum
