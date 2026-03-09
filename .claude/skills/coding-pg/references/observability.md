# Observability

Statistics views, automatic plan capture, wait event analysis, and I/O diagnostics for PostgreSQL 18.2+. Plan analysis (EXPLAIN) lives in performance.md --- this file covers runtime monitoring and diagnostics.


## pg_stat_statements

Query fingerprinting and execution statistics. Primary tool for identifying regression and optimization targets.

Enable: `shared_preload_libraries = 'pg_stat_statements'` + `CREATE EXTENSION pg_stat_statements`.

Top queries by total time with cache efficiency:
```sql
SELECT queryid, query, calls, total_exec_time / 1000 AS total_sec,
       mean_exec_time AS avg_ms, stddev_exec_time AS stddev_ms,
       rows, shared_blks_hit, shared_blks_read,
       ROUND(shared_blks_hit::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100, 2) AS cache_hit_pct
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

- Regression detection: compare `mean_exec_time` across snapshots --- >2x increase flags regression
- Query normalization: literals replaced with `$N` parameters --- identical query shapes share a fingerprint

Contracts:
- `pg_stat_statements_reset()` clears all statistics --- snapshot before clearing
- `pg_stat_statements.max` (default 5000): number of distinct queries tracked --- increase for large applications
- `pg_stat_statements.track = 'all'` tracks nested function calls --- default `top` only tracks top-level
- Statistics persist across connections but NOT across server restart (unless `pg_stat_statements.save = on`)


## auto_explain

Automatic slow-query plan capture --- logs execution plans for queries exceeding threshold.

```
shared_preload_libraries = 'auto_explain'
auto_explain.log_min_duration = '100ms'
auto_explain.log_analyze = on              -- actual row counts (adds overhead)
auto_explain.log_buffers = on
auto_explain.log_timing = on
auto_explain.log_nested_statements = on    -- plans from functions/procedures
auto_explain.log_format = 'json'           -- structured output for parsing
auto_explain.log_verbose = on              -- output columns, schema, alias
auto_explain.log_settings = on             -- PG 15+: include GUC settings affecting plan
```

Contracts:
- `log_analyze = on` re-executes timing for each node --- use with appropriate `log_min_duration`
- JSON format enables automated parsing --- pipe to observability stack
- Per-session override: `SET auto_explain.log_min_duration = '50ms'` for targeted debugging


## pg_stat_activity

Real-time session and query monitoring.

Lock graph detection --- blocked sessions with full blocking chain:

```sql
WITH RECURSIVE lock_chain AS (
    SELECT pid, pg_blocking_pids(pid) AS blockers, query, wait_event_type, wait_event,
           now() - query_start AS duration, 0 AS depth
    FROM pg_stat_activity
    WHERE cardinality(pg_blocking_pids(pid)) > 0
    UNION ALL
    SELECT a.pid, pg_blocking_pids(a.pid), a.query, a.wait_event_type, a.wait_event,
           now() - a.query_start, lc.depth + 1
    FROM pg_stat_activity a
    JOIN lock_chain lc ON a.pid = ANY(lc.blockers)
    WHERE lc.depth < 5
)
SELECT DISTINCT pid, blockers, wait_event_type, wait_event, duration, depth, query
FROM lock_chain
ORDER BY depth, duration DESC;
```

Wait event correlation --- aggregate wait events across active backends to identify systemic bottleneck:

```sql
SELECT wait_event_type, wait_event, count(*) AS sessions,
       array_agg(DISTINCT usename) AS users,
       min(now() - query_start) AS shortest, max(now() - query_start) AS longest
FROM pg_stat_activity
WHERE state = 'active' AND wait_event IS NOT NULL AND pid != pg_backend_pid()
GROUP BY wait_event_type, wait_event
ORDER BY sessions DESC;
```


## Wait Events

Taxonomy:
- `LWLock` --- lightweight locks on shared memory structures (buffer mapping, WAL insertion)
- `Lock` --- heavyweight locks (table locks, row locks, advisory locks)
- `BufferPin` --- waiting for buffer pin
- `Activity` --- background worker activity (autovacuum, checkpointer)
- `Client` --- waiting for client (network I/O)
- `IPC` --- inter-process communication (parallel query, replication)
- `IO` --- disk I/O (DataFileRead, WALWrite, BufFileRead)
- `Extension` --- waiting inside extension code
- `Timeout` --- waiting for timeout expiry (PgSleep, RecoveryApplyDelay, VacuumDelay)

Diagnostic patterns:
- Sustained `IO:DataFileRead` --- insufficient shared_buffers or working set exceeds RAM
- Sustained `Lock:transactionid` --- long-running transactions holding row locks
- Sustained `LWLock:WALInsert` --- WAL write bottleneck --- increase `wal_buffers`, consider `synchronous_commit = off` for non-critical writes
- Sustained `Client:ClientRead` --- application not consuming results fast enough


## pg_stat_io (PG 16+)

I/O statistics disaggregated by backend type, object, and context --- identifies the source of I/O bottlenecks.

```sql
SELECT backend_type, object, context,
       reads, read_time, writes, write_time,
       writebacks, writeback_time, extends, extend_time,
       fsyncs, fsync_time
FROM pg_stat_io
WHERE reads > 0 OR writes > 0
ORDER BY read_time + write_time DESC;
```

Column semantics:
- `backend_type`: client backend, autovacuum worker, checkpointer, background writer
- `object`: relation (heap/index), temp relation
- `context`: normal (shared buffers), vacuum, bulkread (seq scan ring buffer), bulkwrite (COPY/CREATE TABLE AS)
- `reads`/`writes`: count of 8KB block operations; `read_time`/`write_time`: cumulative (requires `track_io_timing = on`)
- `fsyncs`/`fsync_time`: per-backend fsync calls --- high values on checkpointer indicate I/O saturation

Diagnostic patterns:
- High `read_time` on `context = bulkread` --- sequential scans dominating; investigate missing indexes
- High `write_time` on `backend_type = checkpointer` --- checkpoint spread insufficient; tune `checkpoint_completion_target`
- High `extends` on `context = normal` --- frequent relation extension from table growth


## pg_stat_wal

WAL generation rate monitoring for replication lag prediction and write-volume analysis.

```sql
SELECT wal_records, wal_fpi, wal_bytes,
       wal_buffers_full, wal_write, wal_sync,
       wal_write_time, wal_sync_time, stats_reset
FROM pg_stat_wal;
```

- `wal_bytes` growth rate predicts replication lag under given network bandwidth
- `wal_fpi` (full page images): high ratio to `wal_records` indicates excessive full-page writes after checkpoint --- tune `checkpoint_timeout`
- `wal_buffers_full`: non-zero indicates `wal_buffers` undersized --- backends forced to write WAL directly


## pg_stat_progress_* Views

Progress monitoring for long-running maintenance operations.

| View                            | Operation             | Key columns                                             |
| ------------------------------- | --------------------- | ------------------------------------------------------- |
| `pg_stat_progress_vacuum`       | VACUUM                | `heap_blks_total`, `heap_blks_scanned`, `phase`         |
| `pg_stat_progress_create_index` | CREATE INDEX          | `blocks_total`, `blocks_done`, `tuples_total`, `phase`  |
| `pg_stat_progress_analyze`      | ANALYZE               | `sample_blks_total`, `sample_blks_scanned`              |
| `pg_stat_progress_cluster`      | CLUSTER / VACUUM FULL | `heap_blks_total`, `heap_blks_scanned`                  |
| `pg_stat_progress_copy`         | COPY                  | `bytes_processed`, `tuples_processed`                   |
| `pg_stat_progress_basebackup`   | BASE BACKUP           | `backup_total`, `backup_streamed`                       |

- `phase` column indicates current operation phase (e.g., vacuum: scanning heap, vacuuming indexes, truncating heap)
- Progress percentage: `(blocks_done::numeric / NULLIF(blocks_total, 0) * 100)` --- approximate for concurrent modifications


## Table Statistics

Bloat detection --- tables with highest dead tuple ratio (filter noise with `n_dead_tup > 1000`):
```sql
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       ROUND(n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) * 100, 2) AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_all_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

- `pg_stat_reset_single_table_counters(oid)` for targeted reset --- avoid `pg_stat_reset()` which clears everything
- Statistics sample size: `ALTER TABLE ... ALTER COLUMN ... SET STATISTICS N` (default 100, max 10000)
