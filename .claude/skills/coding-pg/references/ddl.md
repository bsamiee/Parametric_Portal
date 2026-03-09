# DDL

Schema design patterns for PostgreSQL 18.2+.


## Canonical table pattern

One polymorphic example demonstrating: domains, generated columns, range types, NOT NULL defaults, uuidv7(), JSONB validation.

```sql
CREATE DOMAIN email AS citext CHECK (VALUE ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
CREATE DOMAIN money_precise AS numeric(19,4) CHECK (VALUE >= 0);

CREATE TABLE organization (
    id              uuid            DEFAULT uuidv7() PRIMARY KEY,
    slug            citext          NOT NULL UNIQUE,
    display_name    text            NOT NULL,
    contact_email   email           NOT NULL,
    plan            text            NOT NULL DEFAULT 'starter'
                                    CHECK (plan IN ('starter', 'business', 'enterprise')),
    metadata        jsonb           NOT NULL DEFAULT '{}'
                                    CHECK (jsonb_matches_schema('{
                                        "type": "object",
                                        "required": ["version"],
                                        "properties": {
                                            "version": {"type": "integer", "minimum": 1}
                                        }
                                    }'::json, metadata)),
    valid_period    tstzrange       NOT NULL DEFAULT tstzrange(clock_timestamp(), 'infinity'),
    revenue         money_precise   NOT NULL DEFAULT 0,
    tier            text            GENERATED ALWAYS AS (
                                        CASE
                                            WHEN revenue >= 1000000 THEN 'enterprise'
                                            WHEN revenue >= 10000  THEN 'business'
                                            ELSE 'starter'
                                        END
                                    ) VIRTUAL,
    search_vector   tsvector        GENERATED ALWAYS AS (
                                        to_tsvector('english', coalesce(display_name, '') || ' ' || coalesce(slug::text, ''))
                                    ) STORED,
    created_at      timestamptz     NOT NULL DEFAULT clock_timestamp(),
    updated_at      timestamptz     NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organization_valid_period_no_overlap
        UNIQUE (slug, valid_period WITHOUT OVERLAPS)
);

CREATE INDEX organization_search_idx ON organization USING gin (search_vector);
```

- `clock_timestamp()` for insert timestamps — wall clock, not transaction start
- Virtual generated columns: read-computed, zero storage, instant ALTER ADD
- Stored generated columns: for indexed computed values (GIN on tsvector, B-tree on sort keys)
- `jsonb_matches_schema()` CHECK: declarative JSONB validation at DDL level (requires `CREATE EXTENSION pg_jsonschema`)


## Domain types

Domains brand primitive scalars with validation. Column declarations reference the domain — never inline equivalent CHECKs.

```sql
-- CHECK-constrained domain: validation on every INSERT/UPDATE
CREATE DOMAIN slug AS text
    CHECK (VALUE ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' AND length(VALUE) BETWEEN 3 AND 63);

CREATE DOMAIN percentage AS numeric(5,2) CHECK (VALUE >= 0 AND VALUE <= 100);

-- Composite domain: structured type with field-level domain validation
CREATE TYPE monetary AS (amount numeric(19,4), currency text);
```

- `ALTER DOMAIN ... ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` for non-blocking retroactive constraint addition
- Domains over `citext` require the extension loaded before creation
- Domain constraints fire on every INSERT/UPDATE — avoid expensive expressions (subqueries, function calls)
- Domains cannot appear in composite types used in `BEFORE` trigger `NEW`/`OLD` in some PL/pgSQL contexts — cast explicitly


## Composite types

Composite types model structured return values and function parameters. Prefer over OUT parameter proliferation.

```sql
CREATE TYPE audit_entry AS (
    actor_id uuid, action text, payload jsonb, occurred_at timestamptz
);

-- Single return: RETURNS composite_type; set return: RETURNS SETOF composite_type
CREATE FUNCTION latest_audit(p_entity_id uuid) RETURNS audit_entry LANGUAGE sql STABLE;

-- RETURNS TABLE when shape is function-specific (not shared)
CREATE FUNCTION recent_audits(p_entity_id uuid, p_limit int DEFAULT 10)
    RETURNS TABLE (actor_id uuid, action text, occurred_at timestamptz)
    LANGUAGE sql STABLE;
```

- Composite types cannot have constraints or defaults — validation at function/trigger level
- `ALTER TYPE ... ADD ATTRIBUTE` rewrites all tables using it as column — use JSONB for frequently evolving structures


## Range types and temporal constraints (PG 18)

Range types replace dual start/end columns with algebraic interval semantics. Built-in: `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`.

Dual `start_date`/`end_date` columns are FORBIDDEN — always `tstzrange` with range constraint.

**WITHOUT OVERLAPS is the primary temporal constraint mechanism (PG 17+).** Use `WITHOUT OVERLAPS` in PRIMARY KEY or UNIQUE constraints for temporal non-overlap. EXCLUDE constraints are the manual fallback ONLY when PG <17 compatibility is required or when the constraint involves operators beyond equality + range overlap (e.g., three-way exclusion with non-equality operators).

```sql
CREATE TYPE price_range AS RANGE (SUBTYPE = numeric);

-- Multirange for non-contiguous intervals
CREATE TABLE availability (
    employee_id uuid NOT NULL,
    windows     tsmultirange NOT NULL
);

-- [PRIMARY PATTERN] Temporal PK via WITHOUT OVERLAPS: one active record per employee at any point in time
CREATE TABLE employment (
    employee_id     uuid        NOT NULL,
    department_id   uuid        NOT NULL,
    role            text        NOT NULL,
    valid_period    tstzrange   NOT NULL,
    PRIMARY KEY (employee_id, valid_period WITHOUT OVERLAPS)
);

-- [PRIMARY PATTERN] Temporal UNIQUE via WITHOUT OVERLAPS: one assignment per employee+project at a time
CREATE TABLE project_assignment (
    id                uuid        DEFAULT uuidv7() PRIMARY KEY,
    employee_id       uuid        NOT NULL,
    project_id        uuid        NOT NULL,
    assignment_period tstzrange   NOT NULL,
    UNIQUE (employee_id, project_id, assignment_period WITHOUT OVERLAPS)
);

-- Temporal FK: employment must fall within department validity
CREATE TABLE department (
    id           uuid        NOT NULL,
    name         text        NOT NULL,
    valid_period tstzrange   NOT NULL,
    PRIMARY KEY (id, valid_period WITHOUT OVERLAPS)
);

ALTER TABLE employment
    ADD CONSTRAINT fk_employment_department
    FOREIGN KEY (department_id, PERIOD valid_period)
    REFERENCES department (id, PERIOD valid_period);

-- [FALLBACK] EXCLUDE constraint: only when WITHOUT OVERLAPS cannot express the constraint
-- (e.g., three-way exclusion with mixed operator types beyond equality + range)
-- Requires btree_gist extension
-- EXCLUDE USING gist (employee_id WITH =, room_id WITH =, booking_period WITH &&);
```

Range operators:

| Operator | Semantics       | Example                                     |
|----------|-----------------|---------------------------------------------|
| `&&`     | Overlap         | `'[2024-01-01,2024-06-01)'::tstzrange && r` |
| `@>`     | Contains        | `r @> '2024-03-15'::timestamptz`            |
| `<@`     | Contained by    | `r <@ '[2024-01-01,2025-01-01)'::tstzrange` |
| `-\|-`   | Adjacent        | `r1 -\|- r2`                                |
| `*`      | Intersection    | `r1 * r2`                                   |
| `+`      | Union           | `r1 + r2` (must overlap or be adjacent)     |
| `-`      | Difference      | `r1 - r2`                                   |

- Always `tstzrange` over `tsrange` — timezone-naive ranges corrupt across DST transitions
- Canonical bound: `[)` (inclusive-exclusive) — gap-free partitioning, no off-by-one
- `empty` range literal for "no interval" — never NULL unless column is optional by design
- `WITHOUT OVERLAPS` requires range column as LAST element; GiST index auto-created
- Temporal FKs with `PERIOD` enforce containment — parent range must fully cover child range
- `btree_gist` extension required for equality columns in exclusion constraints
- Multirange aggregation: `range_agg()` collapses, `unnest()` expands


## Enum alternatives

Enums are rigid — reordering impossible, removal requires full type recreation. Prefer domain-constrained text or FK lookup.

```sql
-- Domain-constrained text: transactional, no type recreation
CREATE DOMAIN order_status AS text
    CHECK (VALUE IN ('draft', 'confirmed', 'shipped', 'delivered', 'cancelled'));

-- Lookup table: metadata, soft-deprecation, ordering
CREATE TABLE order_status_ref (
    code text PRIMARY KEY, label text NOT NULL,
    sort_order int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
ALTER TABLE orders ADD CONSTRAINT fk_order_status
    FOREIGN KEY (status) REFERENCES order_status_ref(code);
```


## Type composition

```sql
-- Domain + range: branded temporal interval with floor constraint
CREATE DOMAIN booking_period AS tstzrange
    CHECK (NOT isempty(VALUE) AND lower(VALUE) >= '2020-01-01'::timestamptz);

-- Domain + array: PG validates each element individually against domain CHECK
CREATE DOMAIN tag_slug AS text
    CHECK (VALUE ~ '^[a-z0-9-]+$' AND length(VALUE) BETWEEN 1 AND 50);

CREATE TABLE articles (
    id   uuid      NOT NULL DEFAULT uuidv7(),
    tags tag_slug[] NOT NULL DEFAULT '{}'
);
```


## Virtual generated columns (PG 18)

Virtual columns compute at read time — zero storage, instant `ALTER TABLE ADD`. Expressions must be IMMUTABLE.

```sql
ALTER TABLE customer ADD COLUMN
    full_name text GENERATED ALWAYS AS (
        profile->>'firstName' || ' ' || profile->>'lastName'
    ) VIRTUAL;

ALTER TABLE product ADD COLUMN
    sku_normalized text GENERATED ALWAYS AS (
        upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))
    ) VIRTUAL;
```

| Restriction                                     | Applies to        |
|--------------------------------------------------|--------------------|
| Cannot reference other generated columns          | Virtual + Stored   |
| Cannot use subqueries, aggregates, window fns     | Virtual + Stored   |
| Cannot be part of PRIMARY KEY / UNIQUE            | Virtual only       |
| CAN appear in WHERE (planner pushes expression)   | Virtual only       |
| Use STORED when column needs indexing              | —                  |


## Partitioning

TimescaleDB hypertables for time-series; pg_partman for non-time-series range/list. Never hand-roll partition creation.

```sql
-- Range partition by time
CREATE TABLE events (
    id          uuid        DEFAULT uuidv7(),
    tenant_id   uuid        NOT NULL,
    event_type  text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE events_default PARTITION OF events DEFAULT;

-- Hash partition for even tenant distribution
CREATE TABLE tenant_data (
    id        uuid  DEFAULT uuidv7(),
    tenant_id uuid  NOT NULL,
    data      jsonb NOT NULL,
    PRIMARY KEY (id, tenant_id)
) PARTITION BY HASH (tenant_id);

CREATE TABLE tenant_data_p0 PARTITION OF tenant_data FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE tenant_data_p1 PARTITION OF tenant_data FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE tenant_data_p2 PARTITION OF tenant_data FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE tenant_data_p3 PARTITION OF tenant_data FOR VALUES WITH (MODULUS 4, REMAINDER 3);

-- pg_partman automated management
SELECT partman.create_parent(
    p_parent_table   := 'public.events',
    p_control        := 'created_at',
    p_interval       := '1 month',
    p_premake        := 3,
    p_start_partition := '2025-01-01'
);
```

- Partition key must be part of PRIMARY KEY and all UNIQUE constraints
- `enable_partition_pruning = on` (default) — planner eliminates non-matching partitions
- pg_partman: `partman.create_parent()` + `partman.run_maintenance()` via pg_cron
- `ALTER TABLE ... DETACH PARTITION ... CONCURRENTLY` for online removal (PG 14+)
- `ENABLE ROW MOVEMENT` when UPDATE can change partition key
- Default partition catches unmatched rows — monitor size as health signal


## Constraints

```sql
-- Exclusion constraint: no overlapping periods per tenant (requires btree_gist)
ALTER TABLE lease ADD CONSTRAINT no_overlapping_leases
    EXCLUDE USING gist (tenant_id WITH =, lease_period WITH &&);

-- CHECK with immutable function
CREATE FUNCTION validate_iso_country(code text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT length(code) = 2 AND code ~ '^[A-Z]{2}$' $$;
ALTER TABLE address ADD CONSTRAINT chk_country_code CHECK (validate_iso_country(country_code));

-- Two-phase constraint: zero-downtime migration
ALTER TABLE account ADD CONSTRAINT chk_balance_positive CHECK (balance >= 0) NOT VALID;
ALTER TABLE account VALIDATE CONSTRAINT chk_balance_positive;

-- Partial unique index as conditional uniqueness constraint
CREATE UNIQUE INDEX uq_active_subscription ON subscription (customer_id) WHERE status = 'active';

-- DEFERRABLE UNIQUE: batch-safe, violation check deferred to COMMIT
ALTER TABLE assignments ADD CONSTRAINT uq_employee_project
    UNIQUE (employee_id, project_id) DEFERRABLE INITIALLY DEFERRED;

-- JSONB schema validation (requires pg_jsonschema)
ALTER TABLE documents ADD CONSTRAINT valid_metadata
    CHECK (jsonb_matches_schema('{
        "type": "object",
        "required": ["version", "author"],
        "properties": {
            "version": {"type": "integer", "minimum": 1},
            "author": {"type": "string", "minLength": 1}
        }
    }'::json, metadata));
```

- `NOT VALID` enforces on new/updated rows immediately — existing rows unchecked until VALIDATE
- `VALIDATE CONSTRAINT` acquires `ShareUpdateExclusiveLock` — concurrent DML proceeds
- Partial unique indexes enforce conditional uniqueness
- `btree_gist` required for equality + range operators in exclusion constraints
- DEFERRABLE UNIQUE enables batch INSERT without intermediate violations; raised at COMMIT
- Lock-level awareness: see `validation.md` Migration Safety.


## Effect-SQL alignment

DDL properties governing `Model.Class` field modifier selection:

| DDL Property                          | Effect-SQL Implication                                        |
|---------------------------------------|---------------------------------------------------------------|
| `DEFAULT uuidv7()`                    | Maps to `Model.Generated` — excluded from insert projections  |
| `GENERATED ALWAYS AS ... VIRTUAL`     | Maps to `Model.Generated` — excluded from insert/update       |
| `GENERATED ALWAYS AS ... STORED`      | Maps to `Model.Generated` — excluded from insert/update       |
| `DEFAULT clock_timestamp()`           | Maps to `Model.DateTimeInsertFromDate` or `DateTimeUpdateFromDate` |
| `NOT NULL`                            | Must NOT use `Model.FieldOption`                              |
| Nullable column                       | Must use `Model.FieldOption`                                  |
| RLS-enforced tenant column            | Maps to `Model.FieldExcept("update", "jsonUpdate")` — immutable after insert |

Model.Class mapping for the canonical table (branded entity IDs):

```typescript
const OrganizationId = S.UUID.pipe(S.brand("OrganizationId"))

class Organization extends Model.Class<Organization>()("Organization", {
    id: Model.Generated(OrganizationId),
    slug: S.NonEmptyTrimmedString,
    displayName: S.NonEmptyTrimmedString,
    contactEmail: S.NonEmptyTrimmedString,
    plan: S.Literal("starter", "business", "enterprise"),
    metadata: Model.JsonFromString(OrganizationMetadata),
    revenue: S.BigDecimal,
    tier: Model.Generated(S.Literal("starter", "business", "enterprise")),
    searchVector: Model.Generated(S.String),
    createdAt: Model.DateTimeInsertFromDate,
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}
```

- **Branded entity IDs**: `S.UUID.pipe(S.brand("EntityId"))` for every PK and FK — raw `S.UUID` is forbidden for identity fields. Branding prevents accidental cross-entity ID mixing at the type level
- `Model.Generated` for `id`, `tier`, `searchVector` — server-computed, excluded from insert/update
- `Model.DateTimeInsertFromDate` / `DateTimeUpdateFromDate` — server-defaulted but readable
- `S.Literal(...)` for constrained text — mirrors CHECK constraint in DDL
- `Model.JsonFromString(schema)` for JSONB with typed codec — mirrors `jsonb_matches_schema` CHECK


## RAG pipeline schema

Canonical document-chunk-embedding schema for retrieval-augmented generation:

```sql
CREATE TABLE documents (
    id          uuid        DEFAULT uuidv7() PRIMARY KEY,
    tenant_id   uuid        NOT NULL,
    source_uri  text        NOT NULL,
    title       text        NOT NULL,
    mime_type   text        NOT NULL DEFAULT 'text/plain',
    metadata    jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE chunks (
    id          uuid        DEFAULT uuidv7() PRIMARY KEY,
    document_id uuid        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id   uuid        NOT NULL,
    content     text        NOT NULL,
    token_count int         NOT NULL,
    position    int         NOT NULL,
    embedding   vector(1536) NOT NULL, -- requires: CREATE EXTENSION vector (pgvector)
    search_text tsvector    GENERATED ALWAYS AS (
        to_tsvector('english', content)
    ) STORED,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (document_id, position)
);

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chunks
    USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);
CREATE INDEX ON chunks USING gin (search_text);
CREATE INDEX ON chunks (document_id);
CREATE INDEX ON chunks (tenant_id, created_at);
```

- `chunks.embedding` + HNSW for semantic search; `chunks.search_text` + GIN for keyword BM25
- Tenant isolation via RLS — vector queries automatically scoped
- `position` preserves document ordering for context window assembly
- Hybrid retrieval: semantic CTE + BM25 CTE + RRF join (see `extensions.md` Hybrid Search)
