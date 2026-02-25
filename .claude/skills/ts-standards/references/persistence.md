# [H1][PERSISTENCE]
>**Dictum:** *One model anchors the table; predicates, writes, and tenant scope are algebra over that anchor — never parallel schemas, never implicit semantics.*

<br>

[IMPORTANT] ALWAYS assume the newest possible version of all db related libs: PostgreSQL, effect/sql, effect/sql-pg, etc.
[IMPORTANT] `@effect/sql` <latest> + `@effect/sql-pg` <latest> + PostgreSQL <latest>. `Model.Class` IS `VariantSchema` — one declaration yields six typed projections. Tenant isolation is transaction-local `SET` via `FiberRef`, not RLS. OCC is a conditional `WHERE`, not a version column.

---
## [1][MODEL_ANCHOR]
>**Dictum:** *`Model.Class` is `VariantSchema` — one declaration, six projections; field modifiers are the projection algebra.*

<br>

| [INDEX] | [MODIFIER]               | [SELECT] | [INSERT] | [UPDATE] | [JSON] | [JSON_CREATE] | [JSON_UPDATE] |
| :-----: | :----------------------- | :------: | :------: | :------: | :----: | :-----------: | :-----------: |
|   [1]   | `Generated`              |   YES    |    --    |   YES    |  YES   |      --       |      --       |
|   [2]   | `GeneratedByApp`         |   YES    |   YES    |   YES    |  YES   |      --       |      --       |
|   [3]   | `Sensitive`              |   YES    |   YES    |   YES    |   --   |      --       |      --       |
|   [4]   | `FieldOption`            |   null   |   null   |   null   |  opt   |   opt+null    |   opt+null    |
|   [5]   | `DateTimeInsertFromDate` |   YES    |  (auto)  |    --    |  YES   |      --       |      --       |
|   [6]   | `DateTimeUpdateFromDate` |   YES    |  (auto)  |  (auto)  |  YES   |      --       |      --       |
|   [7]   | `JsonFromString`         |   str    |   str    |   str    |  obj   |      obj      |      obj      |

`FieldOption` legend — `null`: `OptionFromNullOr` (key required, value null|T → Option); `opt`: `optionalWith as Option` (key optional → Option); `opt+null`: `optionalWith as Option + nullable` (key optional OR null → Option).

`Generated` produces `{select, update, json}` — absent from insert, jsonCreate, jsonUpdate. `GeneratedByApp` adds `insert` — use for app-assigned IDs that should not appear in JSON create/update. `Model.Override` forces a `Generated` field into an insert; fixtures/migrations only.

`Model.FieldOnly("select", "json")(S.String)` — include field only in named variants. `Model.FieldExcept("insert", "jsonCreate")(S.String)` — include field in all variants except named ones. These composable primitives extend projection algebra beyond built-in modifiers.

```ts
import { Schema as S } from "effect";
import { Model } from "@effect/sql";

// --- [SCHEMA] ----------------------------------------------------------------
class Session extends Model.Class<Session>("Session")({
    id:        Model.Generated(S.UUID),
    userId:    S.UUID,
    payload:   Model.JsonFromString(S.Struct({ scopes: S.Array(S.String) })),
    ipAddress: Model.Sensitive(S.String),
    revokedAt: Model.FieldOption(S.DateTimeUtc),
    createdAt: Model.DateTimeInsertFromDate,
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}
const seedFixture = Session.insert.make({
    id: Model.Override("00000000-0000-0000-0000-ffffffffffff"),
    userId: "00000000-0000-0000-0000-000000000001",
    payload: { scopes: [] }, ipAddress: "127.0.0.1", revokedAt: undefined,
    createdAt: Model.Override(new Date("2025-01-01")),
});
```

---
## [2][PREDICATE_ALGEBRA]
>**Dictum:** *Predicates are values assembled from `Option` — `sql.and` composes an array; UUIDv7 temporal lift reuses the index.*

Each filter field yields `Option<Fragment>`, `Array.getSomes` collects, `sql.and(preds)` folds.

```ts
import { Array as A, Effect, Option, Schema as S, pipe } from "effect";
import { SqlClient, SqlSchema, type Statement } from "@effect/sql";

// --- [FUNCTIONS] -------------------------------------------------------------
const assemblePredicates = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return (filter: { readonly userId?: string; readonly status?: string; readonly after?: Date }) => {
        const preds = A.getSomes([
            pipe(Option.fromNullable(filter.userId), Option.map((uid) => sql`user_id = ${uid}`)),
            pipe(Option.fromNullable(filter.status), Option.map((st) => sql`status = ${st}`)),
            pipe(Option.fromNullable(filter.after), Option.map((ts) => sql`uuid_extract_timestamp(id) >= ${ts}`)),
        ]) as ReadonlyArray<Statement.Fragment>;
        const where = A.match(preds, { onEmpty: () => sql`TRUE`, onNonEmpty: (ps) => sql.and(ps) });
        return SqlSchema.findAll({
            Request: S.Void, Result: Session,
            execute: () => sql`SELECT * FROM session WHERE ${where} ORDER BY id DESC LIMIT 50`,
        })(undefined);
    };
});
```

---
## [3][QUERY_SURFACE]
>**Dictum:** *`makeDataLoaders` batches across concurrent fibers via windowed aggregation; `SqlSchema` curried functions compose into typed error rails.*

`Model.makeDataLoaders` groups concurrent `findById`/`insert` calls within a `window` into single batched queries — critical for N+1 prevention in Effect fiber-heavy workloads. `SqlSchema.findOne` returns `(request) => Effect<Option<A>>` — `Effect.flatten` lifts `Option` into the error channel as `NoSuchElementException`, enabling `catchTag` for typed domain errors.

```ts
import { Data, Duration, Effect, Option, Schema as S, pipe } from "effect";
import { Model, SqlClient, SqlSchema } from "@effect/sql";

// --- [SCHEMA] ----------------------------------------------------------------
class Invoice extends Model.Class<Invoice>("Invoice")({
    id: Model.Generated(S.UUID), amount: S.Number, status: S.Literal("draft", "paid", "void"),
}) {}
class InvoiceError extends Data.TaggedError("InvoiceError")<{
    readonly reason: "not_found" | "already_void";
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------
const makeInvoiceQueries = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const loaders = yield* Model.makeDataLoaders(Invoice, {
        tableName: "invoice", spanPrefix: "invoice", idColumn: "id",
        window: Duration.millis(10), maxBatchSize: 100,
    });
    const findByIdSafe = SqlSchema.findOne({
        Request: S.UUID, Result: Invoice,
        execute: (id) => sql`SELECT * FROM invoice WHERE id = ${id}`,
    });
    const voidInvoice = Effect.fn("Invoice.void")(function* (invoiceId: string) {
        const invoice = yield* pipe(
            findByIdSafe(invoiceId), Effect.flatten,
            Effect.catchTag("NoSuchElementException", () => Effect.fail(new InvoiceError({ reason: "not_found" }))),
            Effect.filterOrFail((inv) => inv.status !== "void", () => new InvoiceError({ reason: "already_void" })));
        return yield* SqlSchema.single({
            Request: S.UUID, Result: Invoice,
            execute: (id) => sql`UPDATE invoice SET status = 'void' WHERE id = ${id} RETURNING *`,
        })(invoiceId);
    });
    return { loaders, findByIdSafe, voidInvoice } as const;
});
```

---
## [4][WRITE_SEMANTICS]
>**Dictum:** *`jsonb_set` patches in-place; `MERGE RETURNING` with `merge_action()` yields typed domain signal.*

Use `pg.json(value)` for JSONB parameters — never `JSON.stringify`. PG18.2 `merge_action()` returns `'INSERT' | 'UPDATE'`.

```ts
import { Array as A, Effect, Match, Option, pipe } from "effect";
import { SqlClient } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";

// --- [FUNCTIONS] -------------------------------------------------------------
const makeWrites = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const pg = yield* PgClient.PgClient;
    const atomicPatch = (id: string, delta: number, path: string, value: unknown) =>
        sql`UPDATE asset SET counter = counter + ${delta},
            metadata = jsonb_set(metadata, ${`{${path}}`}, ${pg.json(value)}::jsonb),
            updated_at = NOW() WHERE id = ${id} RETURNING *`;
    const mergeWithAction = (id: string, name: string, tier: string) =>
        sql`MERGE INTO account AS tgt
        USING (VALUES (${id}, ${name}, ${tier})) AS src(id, name, tier) ON tgt.id = src.id
        WHEN MATCHED THEN UPDATE SET name = src.name, updated_at = NOW()
        WHEN NOT MATCHED THEN INSERT (id, name, tier) VALUES (src.id, src.name, src.tier)
        RETURNING *, merge_action() AS _action`;
    const dispatch = (id: string, name: string, tier: string) =>
        pipe(mergeWithAction(id, name, tier), Effect.flatMap((rows) => Option.match(A.head(rows), {
            onNone: () => Effect.fail(new Error("merge_empty")),
            onSome: (row) => Effect.succeed(Match.value(row._action as "INSERT" | "UPDATE").pipe(
                Match.when("INSERT", () => ({ signal: "created" as const, row })),
                Match.when("UPDATE", () => ({ signal: "updated" as const, row })),
                Match.exhaustive)),
        })));
    return { atomicPatch, mergeWithAction, dispatch } as const;
});
```

---
## [5][CONFLICT_AND_OCC]
>**Dictum:** *OCC is `WHERE updated_at = $expected` — zero rows maps to typed error, not a version integer.*

```ts
import { Array as A, Data, Effect, Option, Schema as S, pipe } from "effect";
import { SqlClient, SqlSchema } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------
class RepoOccError extends Data.TaggedError("RepoOccError")<{
    readonly entity: string; readonly id: string; readonly expected: string;
}> {}
const makeConflict = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const Result = S.Struct({ id: S.UUID, name: S.String, updated_at: S.String });
    const upsert = (id: string, name: string) =>
        sql`INSERT INTO account (id, name) VALUES (${id}, ${name})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() RETURNING *`;
    const putWithOcc = (id: string, name: string, occ: string) =>
        pipe(
            sql<S.Schema.Type<typeof Result>>`UPDATE account SET name = ${name}, updated_at = NOW()
                WHERE id = ${id} AND updated_at = ${occ} RETURNING *`,
            Effect.flatMap((rows) => Option.match(A.head(rows), {
                onNone: () => Effect.fail(new RepoOccError({ entity: "account", id, expected: occ })),
                onSome: Effect.succeed,
            })),
        );
    return { upsert, putWithOcc } as const;
});
```

---
## [6][TENANT_ISOLATION]
>**Dictum:** *`withTenantScope` wraps arbitrary effects in tenant-scoped transactions via `FiberRef` + transaction-local `SET`.*

`set_config('app.current_tenant', id, true)` pins tenant per-transaction. Returns `<A, E, R>(effect) => Effect<A, E | TenantScopeError, R | SqlClient>`.

```ts
import { Data, Effect, FiberRef, Option, pipe } from "effect";
import { SqlClient } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------
class TenantScopeError extends Data.TaggedError("TenantScopeError")<{
    readonly reason: "missing" | "nested";
}> {}
const tenantRef =     FiberRef.unsafeMake(Option.none<string>());
const sqlContextRef = FiberRef.unsafeMake(false);
const requireTenant = pipe(FiberRef.get(tenantRef), Effect.flatMap(Option.match({
    onNone: () => Effect.fail(new TenantScopeError({ reason: "missing" })),
    onSome: Effect.succeed,
})));
const withTenantScope = (tenantId: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>):
        Effect.Effect<A, E | TenantScopeError, R | SqlClient.SqlClient> =>
        Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* pipe(FiberRef.get(sqlContextRef), Effect.filterOrFail((inTx) => !inTx, () => new TenantScopeError({ reason: "nested" })));
            return yield* Effect.locally(sqlContextRef, true)(
                sql.withTransaction(pipe(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`, Effect.zipRight(effect))),
            );
        });
```

---
## [7][TRANSACTION_BOUNDARIES]
>**Dictum:** *Isolation level is per-operation — RC + OCC default, RR for reporting, SSI for financial invariants.*

Nested `withTransaction` = `SAVEPOINT effect_sql_N`. `pg_advisory_xact_lock` is transaction-scoped (pooler-safe); `pg_advisory_lock` is session-scoped (NOT PgBouncer-safe).

```ts
import { Data, Effect, Match, pipe } from "effect";
import { SqlClient } from "@effect/sql";

class InvariantError extends Data.TaggedError("InvariantError")<{ readonly check: string }> {}
const makeTx = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const withIsolation = (level: "RC" | "RR" | "SSI") =>
        sql`SET TRANSACTION ISOLATION LEVEL ${sql.literal(Match.value(level).pipe(
            Match.when("RC",  () => "READ COMMITTED"), Match.when("RR", () => "REPEATABLE READ"),
            Match.when("SSI", () => "SERIALIZABLE"),   Match.exhaustive))}`;
    const advisoryLock = (lockId: bigint) => sql`SELECT pg_advisory_xact_lock(${lockId})`;
    const transfer =     (fromId: string, toId: string, amount: number) =>
        sql.withTransaction(pipe(
            withIsolation("SSI"), Effect.zipRight(advisoryLock(BigInt(0x1001))),
            Effect.zipRight(sql`UPDATE account SET balance = balance - ${amount}
                WHERE id = ${fromId} AND balance >= ${amount} RETURNING *`),
            Effect.flatMap((rows) => Effect.filterOrFail(Effect.succeed(rows),
                (r) => r.length > 0, () => new InvariantError({ check: "insufficient_balance" }))),
            Effect.zipRight(sql`UPDATE account SET balance = balance + ${amount} WHERE id = ${toId}`)));
    return { withIsolation, advisoryLock, transfer } as const;
});
```

---
## [8][CURSOR_PAGINATION]
>**Dictum:** *Keyset is O(log n) via composite index; compound `{id, v}` cursors guarantee stability across tied sort values.*

Fetch `LIMIT + 1`; `hasNext = rows.length > limit`. Compound `(rank, id) < ($v, $id)` prevents duplicates. UUIDv7 monotonic ordering guarantees cursor stability under concurrent inserts — `uuid_extract_timestamp(id) <= $boundary` freezes the visible window, preventing phantom rows from shifting page offsets.

```ts
import { Effect, Option, Schema as S, pipe } from "effect";
import { SqlClient } from "@effect/sql";

const Cursor =           S.Struct({ id: S.UUID, v: S.optional(S.String) });
const CursorFromBase64 = S.compose(S.StringFromBase64Url, S.parseJson(Cursor));
const encodeCursor =     S.encodeSync(CursorFromBase64);
const decodeCursor = (raw: string | undefined) =>
    pipe(Option.fromNullable(raw), Option.flatMap(S.decodeUnknownOption(CursorFromBase64)));
const keysetPage = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return (cursor: Option.Option<typeof Cursor.Type>, limit: number, boundary: string) => {
        const take = limit + 1;
        const query = Option.match(cursor, {
            onNone: () => sql`SELECT * FROM asset WHERE created_at <= ${boundary}
                ORDER BY rank DESC, id DESC LIMIT ${take}`,
            onSome: (c) => sql`SELECT * FROM asset WHERE created_at <= ${boundary}
                AND (rank, id) < (${c.v}, ${c.id}) ORDER BY rank DESC, id DESC LIMIT ${take}`,
        });
        return pipe(query, Effect.map((rows) => ({
            items: rows.slice(0, limit), hasNext: rows.length > limit,
            nextCursor: Option.fromNullable(rows.at(limit - 1)).pipe(
                Option.map((last) => encodeCursor({ id: last.id, v: last.rank }))),
        })));
    };
});
```

---
## [9][CLIENT_LIFECYCLE]
>**Dictum:** *Pool is a Layer-managed resource — name transforms and JSON deserialization are infrastructure concerns.*

Use `String.camelToSnake`/`String.snakeToCamel` from `effect` for transform config. `listen(channel)` holds a dedicated connection outside the pool.

```ts
import { Config, Effect, Schema as S, Stream, String as Str, pipe } from "effect";
import { PgClient } from "@effect/sql-pg";

const DatabaseLayer = PgClient.layerConfig({
    url:                  Config.redacted("DATABASE_URL"),
    maxConnections:       Config.integer("DB_POOL_MAX").pipe(Config.withDefault(10)),
    idleTimeout:          Config.integer("DB_IDLE_MS").pipe(Config.withDefault(30_000)),
    connectionTTL:        Config.integer("DB_TTL_MS").pipe(Config.withDefault(300_000)),
    transformQueryNames:  Config.succeed(Str.camelToSnake),
    transformResultNames: Config.succeed(Str.snakeToCamel),
    transformJson:        Config.succeed(true),
});
const typedListen = (channel: string) => Effect.gen(function* () {
    const pg = yield* PgClient.PgClient;
    const Payload = S.Struct({ type: S.String, entityId: S.UUID });
    return pg.listen(channel).pipe(
        Stream.mapEffect((raw) => pipe(
            S.decodeUnknown(S.parseJson(Payload))(raw),
            Effect.tapError((parseError) => Effect.logWarning("listen.decode.failure", { channel, parseError })),
            Effect.option)),
        Stream.filterMap((opt) => opt));
});
```

---
## [10][SCHEMA_EVOLUTION]
>**Dictum:** *Zero-downtime DDL follows expand-and-contract — never rewrite a table under exclusive lock.*

`SET LOCAL lock_timeout = '2s'` on every DDL. Failed concurrent index builds leave `indisvalid = false`. `NOT ENFORCED` FK (PG18.2) stores metadata without trigger overhead.

```ts
import { Effect, pipe } from "effect";
import { SqlClient } from "@effect/sql";

const safeDdl = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const addNullable = pipe(
        sql`SET LOCAL lock_timeout = '2s'`,
        Effect.zipRight(sql`ALTER TABLE asset ADD COLUMN IF NOT EXISTS region TEXT`),
    );
    const backfill = (batch: number) => pipe(
        sql`SET LOCAL lock_timeout = '2s'`,
        Effect.zipRight(sql`UPDATE asset SET region = 'us-east-1' WHERE region IS NULL AND id IN (
            SELECT id FROM asset WHERE region IS NULL ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED)`),
    );
    const validate = pipe(
        sql`SET LOCAL lock_timeout = '2s'`,
        Effect.zipRight(sql`ALTER TABLE asset ADD CONSTRAINT asset_region_nn CHECK (region IS NOT NULL) NOT VALID`),
        Effect.zipRight(sql`ALTER TABLE asset VALIDATE CONSTRAINT asset_region_nn`),
    );
    const cleanInvalid = sql`SELECT indexrelid::regclass AS idx FROM pg_index WHERE NOT indisvalid`;
    const notEnforcedFk = sql`ALTER TABLE audit_entry ADD CONSTRAINT fk_audit_account
        FOREIGN KEY (account_id) REFERENCES account(id) NOT ENFORCED`;
    return { addNullable, backfill, validate, cleanInvalid, notEnforcedFk } as const;
});
```

- Expand-and-contract: nullable -> backfill -> `CHECK NOT VALID` -> `VALIDATE`. Check `pg_index.indisvalid` after concurrent builds.
