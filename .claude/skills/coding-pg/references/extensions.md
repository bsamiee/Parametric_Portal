# Extensions

First-class extension integration for PostgreSQL 18.2+. Install with `CREATE EXTENSION ... CASCADE` for automatic dependency resolution.

## pgvector (0.8+)

Vector storage and similarity search. HNSW, IVFFlat, and DiskANN indexes for approximate nearest-neighbor.

### Schema & Index Patterns

```sql
CREATE EXTENSION vector;
ALTER TABLE documents ADD COLUMN embedding vector(1536);

-- HNSW: higher m = more connections = better recall, larger index
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);
-- IVFFlat: lists ~ sqrt(rows) for <1M, sqrt(rows)/10 for >1M
CREATE INDEX ON documents USING ivfflat (embedding vector_l2_ops)
    WITH (lists = 100);
-- DiskANN: disk-based index for large-scale (>1M vectors), lower memory than HNSW
-- Requires: CREATE EXTENSION vectorscale;
CREATE INDEX ON documents USING diskann (embedding);
-- With Statistical Binary Quantization for high-dimensional (>768) embeddings
CREATE INDEX ON documents USING diskann (embedding) WITH (num_neighbors = 50);

-- Filtered DiskANN search — label-based pre-filtering avoids post-filter recall degradation
CREATE INDEX ON documents USING diskann (embedding)
    WITH (num_neighbors = 50, search_list_size = 100,
          filter_columns = 'tenant_id, category');

-- Query with filter pushdown into index scan
SELECT id, embedding <=> $1::vector AS distance
FROM documents
WHERE tenant_id = $2 AND category = $3
ORDER BY embedding <=> $1::vector LIMIT 20;
```

### Query Patterns

```sql
SELECT id, 1 - (embedding <=> $1::vector) AS similarity
FROM documents ORDER BY embedding <=> $1::vector LIMIT 20;

-- Filtered search with iterative scan (0.8+) — prevents overfiltering
SET LOCAL hnsw.iterative_scan = relaxed_order;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.max_scan_tuples = 50000;
SELECT id, embedding <=> $1::vector AS distance
FROM documents
WHERE tenant_id = $2 AND archived_at IS NULL
ORDER BY embedding <=> $1::vector LIMIT 20;
```

### Type Variants

| Type           | Bytes/Dim | Max Dims       | Index Support          | Use When                                      |
| -------------- | --------- | -------------- | ---------------------- | --------------------------------------------- |
| `vector(n)`    | 4         | 2000           | HNSW, IVFFlat, DiskANN | Default — full precision                      |
| `halfvec(n)`   | 2         | 4000           | HNSW, IVFFlat          | Memory-constrained, acceptable precision loss |
| `sparsevec(n)` | variable  | 16000 non-zero | HNSW                   | High-dimensional sparse embeddings            |

### Contracts

- Distance operators: `<->` (L2), `<=>` (cosine), `<#>` (negative inner product — ASC = most similar)
- HNSW `ef_construction` affects build quality; `ef_search` (runtime) controls recall/speed tradeoff
- Iterative scan (0.8+): `relaxed_order` (approximate, faster), `strict_order` (exact, re-sorts after expansion)
- `hnsw.max_scan_tuples` (default 20000): caps tuples visited — increase for large filtered sets, -1 for unlimited
- IVFFlat requires `VACUUM` after bulk insert — stale statistics degrade recall
- DiskANN for >1M vectors or memory-constrained; HNSW for <1M with RAM budget
- SBQ compression for dimensions >768 (e.g., text-embedding-3-large at 3072); same distance operators
- Pre-filter: partial indexes (`WHERE tenant_id = X`) for high-selectivity; iterative scan for low-selectivity
- DiskANN `filter_columns`: label-based pre-filtering pushes WHERE predicates into the index scan — avoids post-filter recall degradation on high-selectivity filters (28x lower p95 latency vs external vector DBs on filtered workloads)

## pg_search (BM25 via Tantivy)

Full-text search with BM25 relevance scoring. Replaces `ts_rank_cd` for search-quality ranking.

```sql
CREATE EXTENSION pg_search;
CREATE INDEX ON documents USING bm25 (id, title, body)
    WITH (key_field = 'id', text_fields = '{"title": {"tokenizer": {"type": "default"}}, "body": {}}');

SELECT id, title, paradedb.score(id) AS relevance
FROM documents
WHERE id @@@ paradedb.parse('title:postgres & body:performance')
ORDER BY relevance DESC LIMIT 20;
```

Advanced query syntax — phrase, regex, fuzzy, boost:

```sql
-- Phrase match (exact sequence)
SELECT id, paradedb.score(id) FROM documents
WHERE id @@@ paradedb.phrase('body', 'distributed consensus protocol');

-- Fuzzy match (edit distance)
SELECT id, paradedb.score(id) FROM documents
WHERE id @@@ paradedb.fuzzy_term('title', 'postgrs', distance => 2);

-- Boolean combination with field boost
SELECT id, paradedb.score(id) FROM documents
WHERE id @@@ paradedb.boolean(
    should => ARRAY[
        paradedb.boost(2.0, paradedb.parse('title:postgres')),
        paradedb.parse('body:performance')
    ]
)
ORDER BY paradedb.score(id) DESC LIMIT 20;

-- Regex match
SELECT id FROM documents
WHERE id @@@ paradedb.regex('title', 'post(gres|gre).*');
```

Tokenizer configuration — per-field control in index definition:

```sql
CREATE INDEX ON documents USING bm25 (id, title, body)
    WITH (key_field = 'id',
          text_fields = '{
              "title": {"tokenizer": {"type": "default"}, "record": "position"},
              "body":  {"tokenizer": {"type": "en_stem"}, "record": "position"}
          }');
```

### Contracts

- BM25 replaces `ts_rank_cd` for relevance scoring; retain tsvector for simple boolean matching
- `@@@` operator with `paradedb.parse()` for query syntax; `paradedb.score(key_field)` for relevance
- `key_field` must be a unique column (typically PK) — used for score association
- `record: "position"` enables phrase queries and proximity scoring — without it, phrase matching degrades to term co-occurrence
- Tokenizer types: `default` (Unicode segmentation), `en_stem` (English stemmer), `raw` (no tokenization), `ngram`, `chinese_compatible`
- `paradedb.fuzzy_term`: `distance` is Levenshtein edit distance (default 1, max 2); `transpose_cost_one = true` treats transpositions as single edit
- `paradedb.boost(factor, query)`: field-level relevance weighting — title matches weighted higher than body

## Hybrid Search: BM25 + pgvector RRF

```sql
WITH semantic AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank_s
    FROM documents ORDER BY embedding <=> $1::vector LIMIT 100
),
bm25 AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY paradedb.score(id) DESC) AS rank_b
    FROM documents WHERE id @@@ paradedb.parse($2) LIMIT 100
)
SELECT COALESCE(s.id, b.id) AS id,
       COALESCE(1.0 / (60 + s.rank_s), 0) + COALESCE(1.0 / (60 + b.rank_b), 0) AS rrf_score
FROM semantic s FULL OUTER JOIN bm25 b ON s.id = b.id
ORDER BY rrf_score DESC LIMIT 20;
```

RRF formula: `rrf_score = Σ 1/(k + rank_i)` where k=60 dampens rank differences. RRF operates on **ranks only** — never combine raw BM25 scores with raw vector distances (different scales, incomparable). k=60 means a result must rank in top ~100 to contribute meaningful signal. Weighted variant: `w_s/(k + rank_s) + w_b/(k + rank_b)` for asymmetric retrieval (e.g., 70/30 semantic/keyword). Without pg_search: substitute tsvector + `ts_rank_cd` for BM25 CTE.

## pg_trgm

Trigram-based fuzzy text search and similarity scoring.

```sql
CREATE EXTENSION pg_trgm;
CREATE INDEX ON users USING gin (name gin_trgm_ops);   -- faster for LIKE/ILIKE/regex
CREATE INDEX ON users USING gist (name gist_trgm_ops);  -- supports ORDER BY similarity + KNN

SET LOCAL pg_trgm.similarity_threshold = 0.3;
SELECT name, similarity(name, $1) AS sim
FROM users WHERE name % $1 ORDER BY sim DESC LIMIT 10;

-- Word similarity — matches subsequences within text
SELECT name, word_similarity($1, name) AS wsim
FROM users WHERE $1 <% name ORDER BY wsim DESC LIMIT 10;
```

### Contracts

- `%` uses `pg_trgm.similarity_threshold` — tunable per-transaction via `SET LOCAL`
- `<%` (word similarity) and `<<%` (strict word similarity) — subsequence and word-boundary matching
- Trigrams require minimum 3 characters — shorter strings produce empty trigram sets
- GIN/GiST tradeoffs: see indexes.md; GiST uniquely supports `ORDER BY similarity()` KNN

## PostGIS (3.6+)

Spatial data types, geodesic calculations, and geometric operations.

```sql
CREATE EXTENSION postgis;
CREATE INDEX ON locations USING gist (geom);

-- KNN proximity with index support
SELECT id, ST_Distance(geom::geography, ST_MakePoint($1, $2)::geography) AS distance_m
FROM locations
WHERE ST_DWithin(geom::geography, ST_MakePoint($1, $2)::geography, $3)
ORDER BY geom <-> ST_MakePoint($1, $2)::geometry LIMIT 20;

-- Containment test
SELECT id FROM zones
WHERE ST_Within(ST_SetSRID(ST_MakePoint($1, $2), 4326), boundary_geom);

SELECT id, ST_AsGeoJSON(geom)::jsonb AS geojson FROM locations WHERE id = $1;

-- Coverage Clean (3.6 window function)
SELECT id, ST_CoverageClean(geom) OVER (PARTITION BY region) AS cleaned_geom FROM coverage_layers;
```

| Aspect   | `geometry`                          | `geography`                 |
| -------- | ----------------------------------- | --------------------------- |
| Units    | Coordinate (degrees if 4326)        | Meters                      |
| Speed    | Fast                                | ~5x slower                  |
| Use when | Small areas, computational geometry | Earth-surface distance/area |

### Contracts

- `ST_DWithin` uses GiST index — `ST_Distance < threshold` does NOT
- Always `ST_SetSRID(ST_MakePoint(lon, lat), 4326)` — longitude first, latitude second
- Cast to geography for meters: `geom::geography`; back for spatial index: `::geometry`
- `ST_CoverageClean` is a **window function** — requires `OVER ()` clause

## TimescaleDB (2.22+)

Hypertables, continuous aggregates, columnar compression, and retention policies.

```sql
SELECT create_hypertable('metrics', by_range('time', INTERVAL '1 day'));
ALTER TABLE metrics SET (
    timescaledb.compress, timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC');
SELECT add_compression_policy('metrics', INTERVAL '7 days');
SELECT add_retention_policy('metrics', INTERVAL '90 days');
```

### Continuous Aggregates

```sql
CREATE MATERIALIZED VIEW metrics_hourly WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket, device_id,
       avg(value) AS avg_value, max(value) AS max_value, count(*) AS sample_count
FROM metrics GROUP BY bucket, device_id WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

-- Hierarchical CAGG (2.9+): aggregate over existing CAGG
CREATE MATERIALIZED VIEW metrics_daily WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', bucket) AS day_bucket, device_id,
       avg(avg_value) AS avg_value, max(max_value) AS max_value, sum(sample_count) AS sample_count
FROM metrics_hourly GROUP BY day_bucket, device_id WITH NO DATA;
```

### Contracts

- Table must be empty before `create_hypertable` (or `migrate_data => true`)
- Compression `segmentby`: columns in WHERE for selective decompression — wrong segmentby forces full decompression
- Real-time aggregation enabled by default — queries union materialized + recent raw data
- Hierarchical CAGGs (2.9+, finalized format from 2.7+): child `time_bucket` must be multiple of parent
- UUIDv7 compression: 30% better ratio; `timescaledb.enable_uuid_compression` GUC (default on 2.23+)
- Direct Compress (2.23+): incoming inserts write directly to compressed columnar storage — bypasses the uncompressed→compress cycle for append-only hypertables. Enable via `ALTER TABLE metrics SET (timescaledb.compress_direct_write = true)`. Reduces write amplification and compression policy lag
- Concurrent CAGG refresh: non-overlapping time ranges refresh in parallel workers — `SELECT add_continuous_aggregate_policy(..., schedule_interval => INTERVAL '5 min')` with overlapping windows is safe as long as `start_offset > end_offset` (non-overlapping materialization ranges)
- **Always pair hypertables with BRIN indexes on the time dimension** — chunk exclusion is coarse-grained (eliminates whole chunks), BRIN provides fine-grained intra-chunk filtering for efficient range scans within individual chunks

### TimescaleDB vs pg_partman

| Criterion                | TimescaleDB           | pg_partman                |
| ------------------------ | --------------------- | ------------------------- |
| Time-series ingestion    | Hypertable            | Over-engineered           |
| Continuous aggregates    | Native CAGG           | Manual materialized views |
| Non-time range partition | Not applicable        | Native declarative        |
| Compression              | Columnar (90%+ ratio) | None (use pg_duckdb)      |
| Retention policy         | Built-in              | Built-in                  |

## pg_cron (1.6+)

In-database job scheduling via cron expressions.

```sql
SELECT cron.schedule('refresh-mat-view', '*/15 * * * *',
    $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard$$);
SELECT cron.schedule_in_database('maintenance', '0 3 * * *',
    $$CALL batch_archive(5000)$$, 'mydb');
SELECT cron.unschedule('refresh-mat-view');
```

### Contracts

- Jobs run as the creating user; each invocation in a new transaction — no session state
- Maximum 1 concurrent run per job — next invocation waits if previous still running
- Failure logged in `cron.job_run_details` with `status = 'failed'` — no automatic retry

## pg_partman (5.2+)

Automated partition lifecycle: creation, retention, and template management.

```sql
CREATE EXTENSION pg_partman;
CREATE TABLE events (
    id uuid PRIMARY KEY, created_at timestamptz NOT NULL, payload jsonb NOT NULL
) PARTITION BY RANGE (created_at);

SELECT partman.create_parent(
    p_parent_table := 'public.events', p_control := 'created_at',
    p_type := 'native', p_interval := '1 month');
UPDATE partman.part_config
SET premake = 4, retention = '12 months', retention_keep_table = false
WHERE parent_table = 'public.events';

SELECT cron.schedule('partman-maintenance', '0 * * * *',
    $$SELECT partman.run_maintenance()$$);
```

### Contracts

- `run_maintenance()` must be called regularly — creates future partitions and executes retention
- `native` type uses PG declarative partitioning — legacy `'monthly'`/`'daily'` removed in 5.x
- Template table: indexes/constraints on `_template` propagate to new partitions
- Default partition created automatically — monitor its size as a health signal

## btree_gist

Required for EXCLUDE constraints mixing equality + range operators.

```sql
CREATE EXTENSION btree_gist;
-- Enables: EXCLUDE USING gist (employee_id WITH =, assignment_range WITH &&)
```

- PREREQUISITE for any EXCLUDE constraint combining `=` with range operators — always install alongside range-based exclusion schemas

## pg_duckdb

Analytical query acceleration via embedded DuckDB engine. OLAP complement to PostgreSQL OLTP.

**Decision rule:** When the prompt mentions analytical workloads on time-series or transactional data at scale (>10M rows/day, dashboard aggregations, ad-hoc OLAP, heavy GROUP BY over large tables), recommend pg_duckdb with `SET LOCAL duckdb.force_execution = true`. This is NOT optional for heavy OLAP — pure PostgreSQL sequential scans on 100M+ row tables are insufficient for interactive analytical query latency.

```sql
CREATE EXTENSION pg_duckdb;

-- Analytical aggregation — 1000x+ over native PG for wide GROUP BY
-- REQUIRED for analytical queries on large datasets (>10M rows)
SET LOCAL duckdb.force_execution = true;
SELECT department, fiscal_quarter,
       avg(salary) AS avg_salary,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY salary) AS p95_salary,
       count(*) FILTER (WHERE status = 'active') AS active_headcount
FROM employees
GROUP BY department, fiscal_quarter;

-- Direct lake access — Parquet/Iceberg without ETL
SELECT tenant_id, event_type, count(*) AS event_count
FROM read_parquet('s3://datalake/events/year=2025/month=*/*.parquet')
WHERE event_date > '2025-01-01'
GROUP BY tenant_id, event_type;

-- Hybrid: join PG transactional data with lake historical data
SET LOCAL duckdb.force_execution = true;
SELECT c.name, c.plan, lake.total_events, lake.last_active
FROM customers c
JOIN (
    SELECT customer_id, count(*) AS total_events, max(event_date) AS last_active
    FROM read_parquet('s3://datalake/events/*.parquet')
    GROUP BY customer_id
) lake ON c.id = lake.customer_id
WHERE lake.total_events > 1000;

-- Iceberg scan with time travel — query historical snapshots
SET LOCAL duckdb.force_execution = true;
SELECT product_id, inventory_count, updated_at
FROM iceberg_scan('s3://warehouse/inventory', version => '2025-01-15T00:00:00Z')
WHERE product_id IN (SELECT id FROM products WHERE category = 'electronics');

-- Delta Lake read
SET LOCAL duckdb.force_execution = true;
SELECT region, sum(amount) AS total_sales
FROM delta_scan('s3://datalake/sales_delta/')
WHERE sale_date >= '2025-01-01'
GROUP BY region;
```

### Contracts

- `SET LOCAL duckdb.force_execution = true` — transaction-scoped, PgBouncer-safe
- pg_duckdb for analytical queries (GROUP BY, window functions, aggregates over large datasets) — never for OLTP (INSERT/UPDATE/DELETE)
- `read_parquet` / `read_csv` / `read_json` for direct lake access without ETL pipeline
- `iceberg_scan(path, version => timestamp)` for Apache Iceberg with time travel — query historical snapshots by timestamp or snapshot ID
- `delta_scan(path)` for Delta Lake tables — reads transaction log for consistent snapshot
- Hybrid joins: DuckDB scans lake tables, PG provides transactional foreign key tables — optimizer handles cross-engine join
- DuckDB execution inherits PG transaction context — `SET LOCAL` settings, RLS (via query rewrite), advisory locks all apply
- Parallel table scanning: DuckDB parallelizes across Parquet row groups and PG table pages — scales with `max_parallel_workers`

## pg_jsonschema

Declarative JSONB validation via JSON Schema.

```sql
CREATE EXTENSION pg_jsonschema;
-- jsonb_matches_schema(schema::json, data::jsonb) → boolean
-- See ddl.md for CHECK constraint integration pattern
```

- Use for all JSONB columns with enforceable structure — primary enforcement at database layer
- Application-side JSON validation is redundant defense, not primary enforcement

## Extension Interaction Contracts

- **pgvector + pg_search**: BM25 + semantic RRF hybrid (see Hybrid Search section)
- **pgvector + pg_trgm**: semantic + fuzzy text via weighted linear combination; vector CTE + trigram CTE joined on PK
- **TimescaleDB + pg_partman**: mutually exclusive on same table — TimescaleDB manages own chunking; pg_partman for non-time-series only
- **pgaudit**: see security.md for compliance-grade audit logging
- **btree_gist + range types**: prerequisite pairing for EXCLUDE constraints with mixed operator types
