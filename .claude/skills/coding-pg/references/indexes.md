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
- Skip scan (PG 18): B-tree indexes usable when leading columns lack equality -- planner skips distinct values of leading column. Cost-effective when leading column has LOW number of distinct values (low NDV); high-NDV leading columns negate the benefit and still require a dedicated index

B-tree contracts:
- Composite index serves queries on any LEFT PREFIX of columns -- (a, b, c) serves WHERE a=, WHERE a= AND b=, but NOT WHERE b= alone (pre-PG 18; PG 18 skip scan may handle this with low-NDV leading column)
- INCLUDE columns not in the index tree -- stored in leaf pages only; cannot be used for sorting or filtering
- Partial indexes: predicate must match query WHERE exactly (or be implied) for planner to select the index
- Covering index = all columns in SELECT + WHERE + ORDER BY present in index (key + INCLUDE) -- enables index-only scan
- Deduplication (PG 13+, default on): B-tree stores duplicate key values once with a posting list of TIDs -- reduces storage for non-unique indexes with many repeated values. Controlled via `deduplicate_items` storage parameter. Deduplication is incompatible with `UNIQUE` indexes (no duplicates to deduplicate) and indexes on `NUMERIC` or `JSONB` (equality semantics ambiguity)


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
- Nearest-neighbor with pgvector: `CREATE INDEX ON embeddings USING hnsw (vector vector_cosine_ops)` -- not GiST, but related pattern
- PostGIS spatial: `CREATE INDEX ON locations USING gist (geom)` -- supports ST_Within, ST_DWithin, ST_Intersects
- KNN ordering: `ORDER BY point_col <-> point '(x,y)' LIMIT 10` -- GiST provides efficient ordered scan
- SP-GiST: specialized for non-balanced partitioning (IP ranges via `inet_ops`, text prefixes). Use GiST unless data has natural space-partitioned structure.

GiST contracts:
- GiST supports ORDER BY with distance operators (`<->`, `<=>`) -- enables efficient KNN without scanning all rows
- GiST indexes are larger than B-tree for scalar types -- use B-tree when only equality/range needed on scalars
- Exclusion constraints REQUIRE GiST (or SP-GiST) -- B-tree cannot support exclusion


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


## Index Selection Decision Matrix

| Predicate pattern                    | Index type | Operator class         |
| ------------------------------------ | ---------- | ---------------------- |
| `col = $1`                           | B-tree     | default                |
| `col BETWEEN $1 AND $2`             | B-tree     | default                |
| `jsonb_col @> '{"k":"v"}'`          | GIN        | jsonb_path_ops         |
| `jsonb_col ? 'key'`                 | GIN        | jsonb_ops              |
| `array_col && ARRAY[$1]`            | GIN        | default                |
| `tsvector @@ tsquery`               | GIN        | default                |
| `col ILIKE '%term%'`                | GIN        | gin_trgm_ops           |
| `range_col && range_val`            | GiST       | range_ops              |
| `EXCLUDE (...)`                      | GiST       | per-column ops         |
| `point_col <-> point` ORDER BY      | GiST       | default                |
| monotonic append-only timestamp      | BRIN       | default -- also valuable within TimescaleDB hypertable chunks for intra-chunk scans |
| wide-table arbitrary equality combinations | bloom | signature length tuned to cardinality |
| vector similarity >1M rows          | DiskANN    | disk-based, lower memory than HNSW |


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

When only non-indexed columns change, PostgreSQL avoids creating new index entries -- the new tuple version is stored on the same heap page and chained from the old version. This is the primary mechanism behind "over-indexing hurts writes."

HOT eligibility requires:
- Updated columns are NOT in any index (key or INCLUDE)
- New tuple fits on the same heap page as the old tuple (sufficient fillfactor headroom)

Design implication: exclude frequently-updated columns from indexes. A `last_seen_at` or `counter` column included in any index disqualifies every UPDATE on that table from HOT optimization.

Fillfactor tuning:
- Default fillfactor is 100 (pack pages full) -- leaves no room for HOT chains
- `ALTER TABLE hot_table SET (fillfactor = 80)` reserves 20% of each page for in-place updates
- Range 70-90 is typical for write-heavy tables; lower values waste more space but sustain HOT longer under update pressure
- After changing fillfactor, `VACUUM FULL` or `pg_repack` is required to rewrite existing pages with new fill target

Diagnostic: `SELECT relname, n_tup_upd, n_tup_hot_upd, round(n_tup_hot_upd::numeric / greatest(n_tup_upd, 1), 3) AS hot_ratio FROM pg_stat_user_tables WHERE n_tup_upd > 0 ORDER BY hot_ratio ASC`

- `hot_ratio` below 0.5 on write-heavy tables warrants index audit -- likely over-indexed
- Each unnecessary index on a table reduces HOT eligibility for every UPDATE touching that table


## Index-Only Scan Requirements

Index-only scans avoid heap access entirely -- critical for high-throughput read paths.

Requirements:
1. All columns in SELECT, WHERE, ORDER BY, GROUP BY present in index (key columns + INCLUDE columns)
2. Visibility map pages are all-visible (maintained by VACUUM)
3. No expressions in SELECT that reference non-indexed columns

Visibility map mechanics:
- Each heap page has a visibility bit -- set by VACUUM when all tuples on that page are visible to all transactions
- Index-only scan checks the visibility map first; if the page is all-visible, heap access is skipped entirely
- Nonzero `Heap Fetches` in EXPLAIN means pages exist where the visibility bit is not set -- run VACUUM
- `pg_visibility` extension exposes per-page visibility: `SELECT * FROM pg_visibility('tablename')` for diagnostics
- Autovacuum frequency directly controls index-only scan effectiveness -- heavily-updated tables need aggressive vacuum settings to keep visibility map current

Troubleshooting index-only scans:
- Verify plan node is `Index Only Scan` (not `Index Scan`) in EXPLAIN output
- Cross-reference `pg_stat_user_indexes`: `idx_scan` (number of index scans initiated) vs `idx_tup_fetch` (heap tuples fetched) -- high `idx_tup_fetch` relative to `idx_tup_read` indicates heap fetches dominating
- If planner chooses `Index Scan` instead of `Index Only Scan`: missing INCLUDE columns, or visibility map not current
- INCLUDE columns specifically exist to convert `Index Scan` into `Index Only Scan` -- add columns referenced in SELECT but not needed for filtering/sorting
- After bulk loads or heavy updates, force `VACUUM` before benchmarking index-only scan performance


## Index Maintenance

Concurrent operations:
- `CREATE INDEX CONCURRENTLY` -- no write lock, but takes longer and may fail
- `REINDEX CONCURRENTLY` -- rebuilds without blocking writes
- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction -- it commits immediately
- `CONCURRENTLY` builds may fail leaving invalid index -- check `pg_index.indisvalid`; recovery: `DROP INDEX CONCURRENTLY idx_name; CREATE INDEX CONCURRENTLY ...` (never leave invalid indexes — they consume write overhead without serving reads)

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


## PG 18 Index Enhancements

- B-tree skip scan: planner can use composite indexes without equality on leading column -- most effective with low-NDV leading columns; reduces need for redundant single-column indexes
- Virtual generated columns: expression indexes on virtual columns avoid storage overhead while maintaining index selectivity
- MAINTAIN privilege: dedicated privilege for REINDEX, CLUSTER, VACUUM -- separates maintenance from ownership