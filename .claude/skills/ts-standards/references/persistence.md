# Persistence

`@effect/sql` + `@effect/sql-pg` + PostgreSQL 18.2. `Model.Class` is `VariantSchema` — one declaration yields six typed projections. Field modifiers operate as projection algebra over the variant space. Tenant isolation is transaction-local `SET` via `FiberRef`. OCC is `WHERE updated_at = $expected`, not a version column.


## Model projection

`Model.Class` is `VariantSchema` — one declaration yields six typed projections (`select`, `insert`, `update`, `json`, `jsonCreate`, `jsonUpdate`) via field-level modifier composition. Modifiers operate as projection algebra: `Generated` excludes from insert/jsonCreate/jsonUpdate, `Sensitive` excludes from all JSON variants, `FieldOption` maps SQL NULL to typed `Option`, and `FieldOnly`/`FieldExcept` enable arbitrary include/exclude sets over the six-variant space. The modifier stack is conjunctive — each narrows the prior's variant membership, never expands.

```ts
import { Schema as S } from "effect"
import { Model } from "@effect/sql"

class Entity extends Model.Class<Entity>("Entity")({
  id:           Model.Generated(Model.GeneratedByApp(S.UUID)),
  tenantId:     Model.FieldExcept("update", "jsonUpdate")(S.UUID),
  payload:      Model.JsonFromString(S.Struct({ flags: S.Array(S.String) })),
  secret:       Model.Sensitive(S.String),
  archivedAt:   Model.FieldOption(S.DateTimeUtc),
  auditContext: Model.FieldOnly("insert", "update")(S.String),
  createdAt:    Model.DateTimeInsertFromDate,
  updatedAt:    Model.DateTimeUpdateFromDate,
}) {}

const fixture = Entity.insert.make({
  id:           Model.Override("00000000-0000-0000-0000-ffffffffffff"),
  tenantId:     "00000000-0000-0000-0000-000000000001",
  payload:      { flags: ["seed"] },
  secret:       "redacted",
  archivedAt:   undefined,
  auditContext: "migration",
  createdAt:    Model.Override(new Date("2025-01-01")),
})
```

**Projection contracts:**
- `Generated(GeneratedByApp(...))` nests composably — outer modifier constrains all JSON variants, inner adds insert presence. Modifier composition is right-to-left; `GeneratedByApp(Generated(...))` silently inverts semantics.
- `Model.Override` forces `Generated` fields into insert schemas for fixtures and migrations only — production insert paths type-error on override attempts. `createdAt: Model.Override(...)` is the canonical pattern; `createdAt: new Date()` fails assignability.
- `FieldOnly`/`FieldExcept` accept variant name unions and return schema transformers — they compose with inner type modifiers (`FieldOnly("select")(Model.Sensitive(S.String))`) but not outer structural ones. Variant names are literal-typed; typos fail at declaration.


## Query algebra

`queryWith` factors predicate assembly, optional batching, and typed error lifting into a single curried entrypoint. Predicate projection follows `Option.fromNullable` → `Option.map(sql fragment)` → `Array.getSomes` → `sql.and` — each filter field contributes zero or one fragment, and `Array.match` emits `TRUE` for empty predicates. `Effect.flatten` lifts `Option` from `findOne` into the error channel as `NoSuchElementException`, enabling typed `catchTag` recovery without exception unwrapping.

```ts
import { Array as A, Data, Duration, Effect, Option, Schema as S, pipe } from "effect"
import { Model, SqlClient, SqlSchema, type Statement } from "@effect/sql"

class QueryError extends Data.TaggedError("QueryError")<{ readonly reason: "not_found" | "invalid" }> {}

const queryWith = <M extends Model.Model.Any>(model: M, tableName: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const loaders = yield* Model.makeDataLoaders(model, {
      tableName, spanPrefix: tableName, idColumn: "id", window: Duration.millis(10), maxBatchSize: 100,
    })
    const predicate = <F extends Record<string, unknown>>(
      f: F,
      toFrag: { [K in keyof F]?: (v: NonNullable<F[K]>) => Statement.Fragment },
    ) =>
      A.match(
        A.getSomes(Object.entries(toFrag).map(([k, fn]) =>
          pipe(Option.fromNullable(f[k]), Option.map((v) => fn!(v as never))))),
        { onEmpty: () => sql`TRUE`, onNonEmpty: (ps) => sql.and(ps as ReadonlyArray<Statement.Fragment>) },
      )
    const findOrFail = <R extends S.Schema.Any>(req: R, exec: (r: S.Schema.Type<R>) => Statement.Fragment) =>
      (r: S.Schema.Type<R>) =>
        pipe(
          SqlSchema.findOne({ Request: req, Result: model.select, execute: (v) => exec(v) })(r),
          Effect.flatten,
          Effect.catchTag("NoSuchElementException", () => Effect.fail(new QueryError({ reason: "not_found" }))),
        )
    return { loaders, predicate, findOrFail } as const
  })
```

**Query contracts:**
- `predicate` accepts a filter record and a fragment factory record — keys align by convention, missing factories silently skip fields, and the factory receives non-nullable value by construction. `sql.and` requires `NonEmptyReadonlyArray<Fragment>` — `Array.match` handles the empty case with literal `TRUE`.
- `findOrFail` curries `SqlSchema.findOne` → `Effect.flatten` → domain error mapping. Return type `Effect<Model.Type, QueryError>` — `Option` exits the error channel at construction, not consumption. Callers pattern-match on `QueryError.reason`, not on `Option.isNone`.
- `loaders.findById` batches concurrent fiber calls within the `window` via `Model.makeDataLoaders` — critical for N+1 prevention in Effect-heavy workloads. Batch aggregation is internal; callers invoke single-element API and batching emerges from fiber concurrency patterns.


## Write algebra

A vocabulary object maps write strategies (`patch`, `upsert`, `occ`) to SQL template generators and OCC predicates — each strategy entry fully determines the SQL shape and the version-check semantics. The discriminant disappears at call site: `Strategy[kind]` resolves both the template factory and the `WHERE` clause predicate in a single lookup. `MERGE RETURNING` with `merge_action()` yields a typed signal (`'INSERT' | 'UPDATE'`) that exhaustive match dispatch propagates into domain events without intermediate parsing.

```ts
import { Array as A, Data, Effect, Match, Option, pipe } from "effect"
import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"

class WriteConflict extends Data.TaggedError("WriteConflict")<{
  readonly entity: string; readonly id: string; readonly reason: "stale" | "empty"
}> {}

const Strategy = {
  patch:  { signal: (row: unknown) => ({ event: "patched" as const,   row }) },
  upsert: { signal: (row: unknown) => ({ event: "upserted" as const,  row }) },
  occ:    { signal: (row: unknown) => ({ event: "versioned" as const, row }) },
} as const satisfies Record<string, { signal: (r: unknown) => { event: string; row: unknown } }>

const write = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const pg  = yield* PgClient.PgClient
  return <K extends keyof typeof Strategy>(entity: string, kind: K, id: string, payload: {
    name?: string; delta?: number; path?: string; value?: unknown; occ?: string
  }) => pipe(
    Match.value(kind).pipe(
      Match.when("patch", () => sql`UPDATE ${sql.id(entity)} SET counter = counter + ${payload.delta ?? 0},
        metadata = jsonb_set(metadata, string_to_array(${payload.path ?? ""}, '.'), ${pg.json(payload.value)}::jsonb),
        updated_at = NOW() WHERE id = ${id} RETURNING *, 'UPDATE' AS _action`),
      Match.when("upsert", () => sql`MERGE INTO ${sql.id(entity)} AS tgt USING (VALUES (${id}, ${payload.name ?? ""}))
        AS src(id, name) ON tgt.id = src.id WHEN MATCHED THEN UPDATE SET name = src.name, updated_at = NOW()
        WHEN NOT MATCHED THEN INSERT (id, name) VALUES (src.id, src.name) RETURNING *, merge_action() AS _action`),
      Match.when("occ", () => sql`UPDATE ${sql.id(entity)} SET name = ${payload.name ?? ""}, updated_at = NOW()
        WHERE id = ${id} AND updated_at = ${payload.occ ?? ""} RETURNING *, 'UPDATE' AS _action`),
      Match.exhaustive),
    Effect.flatMap((rows) => Option.match(A.head(rows), {
      onNone: () => Effect.fail(new WriteConflict({ entity, id, reason: kind === "occ" ? "stale" : "empty" })),
      onSome: (row) => Effect.succeed(Strategy[kind].signal(row)),
    })))
})
```

**Write contracts:**
- One vocabulary per behavioral domain — `Strategy` maps kind to signal emission; no parallel dispatch tables for the same discriminant.
- `merge_action()` (PG 18.2+) returns `'INSERT' | 'UPDATE'` — the vocabulary's `signal` field projects the raw row into a typed event shape; downstream consumers never receive the raw row.
- OCC is `WHERE updated_at = $occ` returning zero rows → typed `WriteConflict` with `reason: "stale"` — no version integer columns, no optimistic lock tables.


## Transaction scope

Isolation level, tenant binding, and advisory locking compose into a single scoped effect via configuration object — `isolation` dispatches to PG syntax via match, `tenantId` pins `app.current_tenant` for the transaction lifetime via `set_config`, and `lockId` acquires `pg_advisory_xact_lock` (transaction-scoped, pooler-safe). `FiberRef` propagates tenant context across fiber boundaries; the `nested` guard prevents re-entrance, making scope boundaries load-bearing rather than advisory.

```ts
import { Data, Effect, FiberRef, Match, Option, pipe } from "effect"
import { SqlClient } from "@effect/sql"

class ScopeError extends Data.TaggedError("ScopeError")<{
  readonly reason: "missing_tenant" | "nested_scope"
}> {}
const activeScopeRef = FiberRef.unsafeMake(Option.none<string>())

const scoped = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return <A, E, R>(cfg: { isolation?: "RC" | "RR" | "SSI"; tenantId?: string; lockId?: bigint },
    effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | ScopeError, R> =>
    Effect.gen(function* () {
      yield* pipe(FiberRef.get(activeScopeRef), Effect.filterOrFail(Option.isNone, () => new ScopeError({ reason: "nested_scope" })))
      const isolationSql = Match.value(cfg.isolation ?? "RC").pipe(
        Match.when("RC",  () => sql`SET TRANSACTION ISOLATION LEVEL READ COMMITTED` ),
        Match.when("RR",  () => sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`),
        Match.when("SSI", () => sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`   ),
        Match.exhaustive)
      const tenantSql = Option.match(Option.fromNullable(cfg.tenantId), {
        onNone: () => sql`SELECT 1`, onSome: (tid) => sql`SELECT set_config('app.current_tenant', ${tid}, true)` })
      const lockSql = Option.match(Option.fromNullable(cfg.lockId), {
        onNone: () => sql`SELECT 1`, onSome: (lid) => sql`SELECT pg_advisory_xact_lock(${lid})` })
      return yield* Effect.locally(activeScopeRef, Option.some(cfg.tenantId ?? "root"))(
        sql.withTransaction(pipe(isolationSql, Effect.zipRight(tenantSql), Effect.zipRight(lockSql), Effect.zipRight(effect))))
    })
})
```

**Scope contracts:**
- One configuration object per transaction boundary — `{ isolation, tenantId, lockId }` composes all three axes without callback nesting or chained HOFs. Optional fields default (`RC`, no tenant, no lock) via `Option.fromNullable`.
- `FiberRef` guards re-entrance — `nested_scope` error fires if `activeScopeRef` is `Some`. Nested `sql.withTransaction` degrades to `SAVEPOINT effect_sql_N`; the guard makes that implicit behavior explicit.
- `pg_advisory_xact_lock` is transaction-scoped (released at commit/rollback) and pooler-safe; `pg_advisory_lock` is session-scoped and NOT PgBouncer-safe. `set_config(..., true)` third argument pins the value to current transaction only.


## Boundary discipline

Pagination, event subscription, and schema evolution share a common structure: typed boundary crossing at the persistence layer. A vocabulary object compresses three operational modes into one lookup — cursor codec, stream filter, DDL guard — each entry a pipeline-composable construct that resolves parsing, filtering, or lock-safety in a single dispatch. `CursorSchema` composes `StringFromBase64Url → parseJson → Struct` — the compound `{id, v}` tuple guarantees stable keyset pagination across tied sort values where UUIDv7 monotonicity prevents phantom rows.

```ts
import { Config, Effect, Match, Option, Schema as S, Stream, String as Str, pipe } from "effect"
import { PgClient } from "@effect/sql-pg"
import { SqlClient } from "@effect/sql"

const CursorSchema = S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.UUID, v: S.optional(S.String) })))

const Boundary = {
  pool: PgClient.layerConfig({
    url:                  Config.redacted("DATABASE_URL"),
    maxConnections:       Config.integer("DB_POOL_MAX").pipe(Config.withDefault(10)),
    transformQueryNames:  Config.succeed(Str.camelToSnake),
    transformResultNames: Config.succeed(Str.snakeToCamel),
  }),
  page: (sql: SqlClient.SqlClient, limit: number, boundary: string, raw?: string) =>
    ((cur) => pipe(
      Option.match(cur, {
        onNone: () => sql`SELECT * FROM asset WHERE created_at <= ${boundary} ORDER BY rank DESC, id DESC LIMIT ${limit + 1}`,
        onSome: (c) => sql`SELECT * FROM asset WHERE created_at <= ${boundary} AND (rank, id) < (${c.v}, ${c.id}) ORDER BY rank DESC, id DESC LIMIT ${limit + 1}`,
      }),
      Effect.map((rows) => ({
        items: rows.slice(0, limit),
        hasNext: rows.length > limit,
        next: pipe(Option.fromNullable(rows.at(limit - 1)), Option.map((r) => S.encodeSync(CursorSchema)({ id: r.id, v: r.rank }))),
      })),
    ))(Option.flatMap(Option.fromNullable(raw), S.decodeUnknownOption(CursorSchema))),
  listen: <P>(pg: PgClient.PgClient, channel: string, P: S.Schema<P>) =>
    pg.listen(channel).pipe(
      Stream.mapEffect((raw) => pipe(S.decodeUnknown(S.parseJson(P))(raw), Effect.option)),
      Stream.filterMap((o) => o),
    ),
  evolve: (sql: SqlClient.SqlClient, step: "add" | "backfill" | "validate", batch = 1000) =>
    pipe(
      sql`SET LOCAL lock_timeout = '2s'`,
      Effect.zipRight(Match.value(step).pipe(
        Match.when("add", () => sql`ALTER TABLE asset ADD COLUMN IF NOT EXISTS region TEXT`),
        Match.when("backfill", () => sql`UPDATE asset SET region = 'us-east-1' WHERE region IS NULL AND id IN (SELECT id FROM asset WHERE region IS NULL ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED)`),
        Match.when("validate", () => pipe(sql`ALTER TABLE asset ADD CONSTRAINT asset_region_nn CHECK (region IS NOT NULL) NOT VALID`, Effect.zipRight(sql`ALTER TABLE asset VALIDATE CONSTRAINT asset_region_nn`))),
        Match.exhaustive,
      )),
    ),
} as const
```

**Boundary contracts:**
- `page` fetches `LIMIT + 1` rows; `hasNext = rows.length > limit` — overflow row never enters `items`. Compound cursor `(rank, id) <` exploits B-tree composite ordering; `created_at <= boundary` freezes the visible window against concurrent UUIDv7 inserts.
- `listen` holds a dedicated connection outside the pool; `Stream.mapEffect → Effect.option → Stream.filterMap` silently drops unparseable payloads — downstream receives only schema-valid events. Transform config threads `camelToSnake`/`snakeToCamel` via `Config.succeed`.
- `evolve` wraps every DDL in `SET LOCAL lock_timeout = '2s'` — failed locks surface as errors, not hangs. Expand-contract sequence: `add` (nullable) → `backfill` (`FOR UPDATE SKIP LOCKED`) → `validate` (`CHECK NOT VALID` + `VALIDATE CONSTRAINT`).
