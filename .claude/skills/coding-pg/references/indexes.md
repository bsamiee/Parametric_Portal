# Indexes

Index type selection, composition, and maintenance for PostgreSQL 18.2+. Every WHERE clause pattern has a corresponding index -- unindexed predicates on tables exceeding 10K rows require documented justification.


## B-tree

Default index type. Supports equality, range, IS NULL, IS NOT NULL, IN, BETWEEN, ORDER BY.

Advanced patterns:
- Composite ordering: `CREATE INDEX ON orders (tenant_id, created_at DESC, id DESC)` -- matches keyset pagination ORDER BY
- INCLUDE for index-only scans: `CREATE INDEX ON orders (tenant_id, status) INCLUDE (total, currency)` -- covers SELECT without heap access
- Partial index: `CREATE INDEX ON orders (customer_id) WHERE status = 'pending'` -- indexes only relevant rows
- Expression index: `CREATE INDEX ON users (lower(email))` -- supports `WHERE lower(email) = $1`
- NULLS FIRST/LAST: `CREATE INDEX ON tasks (priority DESC NULLS LAST, created_at ASC)` -- NULL ordering must match query ORDER BY
- Skip scan (PG 18): planner uses composite index without leading-column equality by skipping distinct values of the leading column. Cost-effective only with low-NDV leading columns (e.g., `status` in `(status, created_at)`); high-NDV leading columns still require dedicated index

B-tree contracts:
- Composite (a, b, c) serves `WHERE a =`, `WHERE a = AND b =`, and via PG 18 skip scan with low-NDV `a`: `WHERE b = AND c =`
- INCLUDE columns stored in leaf pages only — cannot filter or sort, but enable index-only scans
- Covering index = all SELECT + WHERE + ORDER BY columns in index (key + INCLUDE) — enables index-only scan
- Deduplication (PG 13+, default on): stores duplicate keys once with TID posting list. Incompatible with UNIQUE indexes and `NUMERIC`/`JSONB` (equality semantics ambiguity). Set `deduplicate_items = off` on numeric domain indexes


## GIN (Generalized Inverted Index)

For containment, overlap, and full-text search on composite values.

Patterns:
- JSONB containment: `CREATE INDEX ON events USING gin (metadata jsonb_path_ops)` -- supports `@>` operator, smaller than default ops
- Array overlap: `CREATE INDEX ON products USING gin (tags)` -- supports `&&`, `@>`, `<@` operators
- Full-text search: `CREATE INDEX ON documents USING gin (search_vector)` where `search_vector` is stored generated `tsvector`
- Trigram search (pg_trgm): `CREATE INDEX ON users USING gin (name gin_trgm_ops)` -- supports `%`, `ILIKE`, `~`

GIN contracts:
- `jsonb_path_ops` supports only `@>` -- use default `jsonb_ops` if you need `?`, `?|`, `?&` (key existence)
- GIN is write-amplified -- each indexed value produces multiple index entries; unsuitable for high-write columns
- Pending list: GIN uses a "pending list" for fast inserts, merged on vacuum or when `gin_pending_list_limit` reached
- Parallel GIN build (PG 18): set `max_parallel_maintenance_workers = 4` for large indexes; build time scales linearly with workers


## GiST (Generalized Search Tree)

For range overlap, spatial queries, nearest-neighbor, and exclusion constraints.

Patterns:
- Range overlap: `CREATE INDEX ON bookings USING gist (room_id, during)` -- supports `&&`, `@>`, `<@` on ranges
- Exclusion constraint index: `EXCLUDE USING gist (tenant_id WITH =, valid_period WITH &&)` -- auto-creates GiST index
- PostGIS spatial: `CREATE INDEX ON locations USING gist (geom)` -- supports ST_Within, ST_DWithin, ST_Intersects; `buffering = on` for batch loads
- KNN ordering: `ORDER BY point_col <-> point '(x,y)' LIMIT 10` -- GiST provides efficient ordered scan
- SP-GiST: non-balanced partitioning (IP ranges via `inet_ops`, text prefixes). Use GiST unless data has natural space-partitioned structure

GiST contracts:
- Distance operators (`<->`, `<=>`) enable KNN without full scan — GiST and HNSW both support this
- GiST indexes are larger than B-tree for scalars — use B-tree when only equality/range needed
- Exclusion constraints REQUIRE GiST (or SP-GiST) — B-tree cannot support exclusion
- Spatial: BRIN is NOT viable for 2D geometry (requires monotonic scalar order); GiST is the only option for ST_* predicates


## Vector Indexes (pgvector / pgvectorscale)

Index selection for approximate nearest-neighbor. Full schema patterns, query syntax, and type variants in `extensions.md` pgvector section.

| Scale / Constraint                | Index   | Key Parameters                                                                |
| --------------------------------- | ------- | ----------------------------------------------------------------------------- |
| <1M vectors, RAM available        | HNSW    | `m` (connectivity, default 16), `ef_construction` (build quality, default 64) |
| <1M vectors, append-heavy         | IVFFlat | `lists` ~ sqrt(rows); cheaper writes, worse recall than HNSW                  |
| >1M vectors or memory-constrained | DiskANN | SBQ/OPQ quantization reduces size 10x+ with <1% recall loss                   |
| Multi-tenant filtered search      | DiskANN | `filter_columns = 'tenant_id'` — label pre-filtering in index scan            |

HNSW tuning: `m=4` for high-dimensional (>1000D), `m=32` for low-dimensional (<100D). Higher `ef_construction` improves recall at build-time cost. No incremental updates — requires dual-index rotation for 0-downtime re-tuning (see Index Maintenance).

IVFFlat: `lists` parameter controls cluster count (sqrt(rows) typical). Requires `VACUUM` after bulk insert — stale cluster statistics degrade recall significantly.

`filter_columns` constraint: DiskANN label pre-filtering works for discrete low-cardinality columns (tenant_id, category, status) — not continuous range predicates. Temporal filtering alongside vector search requires composite strategy: DiskANN `filter_columns` for tenant + post-filtering for time-range, or partitioned vector tables by time window with per-partition HNSW indexes.


## BRIN (Block Range Index)

For append-only monotonic columns -- orders of magnitude smaller than B-tree with minimal read overhead.

Patterns:
- Timestamp on append-only: `CREATE INDEX ON events USING brin (created_at) WITH (pages_per_range = 32)`
- Multi-column BRIN: `CREATE INDEX ON logs USING brin (created_at, severity)` -- both columns must be naturally correlated with physical order
- Autosummarize: `CREATE INDEX ON events USING brin (created_at) WITH (autosummarize = on)` -- auto-summarize new page ranges

BRIN contracts:
- BRIN effectiveness depends on physical correlation between column value and row position -- `pg_stats.correlation` near +/-1.0
- `pages_per_range`: smaller = more precise but larger index; larger = smaller index but more false positives
- BRIN returns false positives (never false negatives) -- identifies candidate blocks, then heap scans verify
- Unsuitable for randomly-ordered data (low correlation) -- B-tree wins
- Autosummarize creates background worker to summarize new ranges -- without it, new ranges have no summary until VACUUM
- **TimescaleDB hypertables still require BRIN on the time dimension.** Chunk exclusion eliminates irrelevant chunks (coarse-grained) but does NOT provide intra-chunk filtering. BRIN provides fine-grained range filtering within individual chunks — required for efficient range scans on large hypertables


## Bloom

Bloom filter index for equality queries across arbitrary column combinations. One bloom index replaces N single-column B-tree indexes at ~6x less space.

```sql
-- Wide table with unpredictable WHERE clause combinations
CREATE INDEX ON feature_flags USING bloom (tenant_id, user_id, flag_name, environment, region)
    WITH (length = 80, col1 = 2, col2 = 2, col3 = 4, col4 = 2, col5 = 2);
```

Contracts:
- Only supports `=` operator -- no range queries, no NULL matching, no ordering
- `length`: signature size in bits (default 80); larger = fewer false positives, more space
- `col{N}`: bits per column (default 2); increase for high-cardinality columns
- Use when: >5 columns queried in arbitrary combinations, equality-only, traditional composite indexes impractical
- Bloom + GIN trigram on same table: bloom covers boolean/enum columns, GIN covers text -- no single B-tree composite achieves both

Bloom vs composite B-tree:
- <3 columns, >20% selectivity: composite B-tree (simpler, supports range queries)
- 3-5 columns, variable selectivity: composite B-tree (bloom overhead not justified)
- >5 columns, arbitrary equality combos, <10% selectivity: bloom (~6x less space, 3-5% false positives acceptable)
- Hybrid: bloom for boolean/enum pre-filter + B-tree for range refinement — bloom rejects non-matches cheaply, B-tree narrows final set


## Index Selection Decision Matrix

| Predicate pattern                              | Index type     | Operator class                                        |
| ---------------------------------------------- | -------------- | ----------------------------------------------------- |
| `col = $1`                                     | B-tree         | default                                               |
| `col BETWEEN $1 AND $2`                        | B-tree         | default                                               |
| `jsonb_col @> '{"k":"v"}'`                     | GIN            | jsonb_path_ops                                        |
| `jsonb_col ? 'key'`                            | GIN            | jsonb_ops                                             |
| `array_col && ARRAY[$1]`                       | GIN            | default                                               |
| `tsvector @@ tsquery`                          | GIN            | default                                               |
| `col ILIKE '%term%'`                           | GIN            | gin_trgm_ops                                          |
| `range_col && range_val`                       | GiST           | range_ops                                             |
| `EXCLUDE (...)`                                | GiST           | per-column ops                                        |
| `point_col <-> point` ORDER BY                 | GiST           | default                                               |
| monotonic append-only timestamp                | BRIN           | default; intra-chunk scans on TimescaleDB hypertables |
| wide-table equality, >5 cols, <10% selectivity | Bloom          | signature length tuned to NDV                         |
| vector similarity <1M rows, RAM available      | HNSW           | `m`, `ef_construction` tuned to dimensionality        |
| vector similarity >1M rows, memory-constrained | DiskANN        | SBQ/OPQ quantization; `filter_columns` multi-tenant   |
| full-text ranking, phrase proximity            | pg_search BM25 | Tantivy-backed, `@@@` operator                        |


## Composite Index Design

Equality columns first, range columns last -- the "EqRng" rule:
```sql
-- query: WHERE tenant_id = $1 AND status = $2 AND created_at > $3 ORDER BY created_at
CREATE INDEX ON orders (tenant_id, status, created_at);
-- tenant_id (eq), status (eq), created_at (range + sort) -- optimal column order
```

Anti-patterns:
- Range column before equality column wastes index efficiency -- B-tree cannot skip past range predicate to reach subsequent equality columns (pre-PG 18)
- Redundant indexes: (a, b) makes standalone (a) index redundant -- drop (a)
- Over-indexing: each index adds write overhead (INSERT, UPDATE, DELETE must maintain all indexes) and kills HOT update eligibility (see HOT Updates below)


## Partial Index Optimization

Partial indexes reduce size and improve write performance by indexing only the rows that matter.

```sql
-- only 2% of orders are 'pending' -- full index wastes 98% of space
CREATE INDEX ON orders (customer_id, created_at)
  WHERE status = 'pending';

-- soft-delete pattern: only index active rows
CREATE INDEX ON resources (tenant_id, name)
  WHERE deleted_at IS NULL;

-- boolean flag: index only the minority case
CREATE INDEX ON notifications (user_id, created_at)
  WHERE read = false;
```

Partial index contracts:
- Query WHERE clause must imply the index predicate -- planner matches syntactically, not semantically
- `WHERE status IN ('pending', 'processing')` does NOT match `WHERE status = 'pending'` partial index
- Immutable expressions only in predicate -- no functions with side effects, no volatile functions
- Partial unique index: `CREATE UNIQUE INDEX ON users (email) WHERE deleted_at IS NULL` -- uniqueness only among active rows


## HOT Updates (Heap Only Tuple)

When only non-indexed columns change, PostgreSQL stores the new tuple on the same heap page without creating new index entries. This is the primary mechanism behind "over-indexing hurts writes."

HOT eligibility: (1) updated columns NOT in any index (key or INCLUDE), (2) new tuple fits on same page (fillfactor headroom). Exclude frequently-updated columns (`last_seen_at`, `counter`) from all indexes — their presence in any index disqualifies every UPDATE from HOT.

Fillfactor: default 100 (no room for HOT chains). `ALTER TABLE t SET (fillfactor = 80)` reserves 20% per page. Range 70-90 for write-heavy tables. Requires `VACUUM FULL` or `pg_repack` to rewrite existing pages.

Diagnostic: `SELECT relname, round(n_tup_hot_upd::numeric / greatest(n_tup_upd, 1), 3) AS hot_ratio FROM pg_stat_user_tables WHERE n_tup_upd > 0` — ratios below 0.5 on write-heavy tables warrant index audit.


## Index-Only Scan

Requirements: (1) all SELECT/WHERE/ORDER BY/GROUP BY columns in index (key + INCLUDE); (2) visibility map all-visible (maintained by VACUUM); (3) no expressions referencing non-indexed columns.

Visibility map: VACUUM sets all-visible bit on heap pages with no uncommitted tuples. Index-only scan checks visibility map first; if set, heap access skipped. Nonzero `Heap Fetches` in EXPLAIN indicates stale visibility — run VACUUM. `pg_visibility` extension exposes per-page state for diagnostics.

Troubleshooting: (1) EXPLAIN must show `Index Only Scan` not `Index Scan`; (2) check `pg_stat_user_indexes.idx_tup_fetch` — high values mean heap access dominates; (3) add missing INCLUDE columns to convert `Index Scan` to `Index Only Scan`; (4) run VACUUM after bulk loads before benchmarking


## Index Maintenance

Concurrent operations:
- `CREATE INDEX CONCURRENTLY` -- no write lock, but takes longer and may fail; cannot run inside a transaction
- `REINDEX CONCURRENTLY` -- rebuilds without blocking writes
- Failed CONCURRENTLY builds leave invalid index -- check `pg_index.indisvalid`; recovery: `DROP INDEX CONCURRENTLY idx_name; CREATE INDEX CONCURRENTLY ...` (never leave invalid — they consume write overhead without serving reads)
- GIN/GiST pending list: large pending lists cause concurrent builds to fail — run `VACUUM` before `CREATE INDEX CONCURRENTLY` on GIN tables

0-downtime index rotation (critical for HNSW vectors and schema-evolving indexes):
1. Build replacement: `CREATE INDEX CONCURRENTLY idx_v2 ON t (col) INCLUDE (new_cols)`
2. Verify plan: `EXPLAIN ... WHERE col = ...` picks `idx_v2`
3. Drop old: `DROP INDEX CONCURRENTLY idx_v1`
4. HNSW indexes have no incremental updates — dual-index rotation is the only 0-downtime path for re-tuning `m`/`ef_construction`

Bloat monitoring:
```sql
SELECT schemaname, indexrelname, pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

- `pgstatindex('index_name')` -- `avg_leaf_density` below 50% suggests bloat requiring REINDEX
- Deduplication status: `SELECT * FROM pgstatindex('index_name')` -- check `leaf_density` improvement after REINDEX on non-unique indexes with repetitive values

Unused index detection:
```sql
SELECT schemaname, indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND idx_tup_read = 0;
```

- `idx_scan` resets on statistics reset -- verify against sufficient uptime before dropping
- `pg_stat_reset()` zeroes all counters -- establish baseline after reset before making drop decisions


## Bitmap Index OR Merging (PG 18)

PG 18 improves bitmap OR merging efficiency — the planner can now cost-effectively merge bitmaps from independent single-column indexes instead of requiring one composite index. Two smaller B-trees on `(status)` and `(created_at)` can serve `WHERE status = $1 AND created_at > $2` via bitmap AND when no single composite covers >60% of access paths on tables with highly variable query patterns. Verify with `EXPLAIN (ANALYZE, BUFFERS)` — `BitmapAnd`/`BitmapOr` nodes with low `lossy` block ratio confirms the strategy is effective. Still prefer composite B-tree when one column order dominates; bitmap merging adds heap recheck overhead absent in direct index scans.


## Recent PostgreSQL Index Features (PG 13+)

- B-tree skip scan (PG 18): composite indexes usable without leading-column equality -- most effective with low-NDV leading columns; reduces redundant single-column indexes
- Virtual generated columns (PG 18): expression indexes on virtual columns avoid storage overhead while maintaining index selectivity
- `NULLS NOT DISTINCT` (PG 15+): `CREATE UNIQUE INDEX ON users (email) NULLS NOT DISTINCT` -- treats multiple NULLs as duplicates; without this, UNIQUE indexes allow unlimited NULLs in the indexed column (each NULL considered distinct). Use on any nullable unique column where business logic requires at-most-one NULL
- MAINTAIN privilege (PG 17+): dedicated privilege for REINDEX, CLUSTER, VACUUM -- separates maintenance from ownership
- Incremental sort (PG 13+): planner can leverage a partially-ordered index to incrementally sort remaining columns — composite index `(a)` can serve `ORDER BY a, b` if `b` sort is cheap
