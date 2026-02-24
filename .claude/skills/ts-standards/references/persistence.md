# [H1][PERSISTENCE]
>**Dictum:** *Model.Class is VariantSchema; SqlClient is the tag; repos compose via factory, not hand-rolled queries.*

Cross-references: `services.md [2]` (scoped constructors), `effects.md [1]` (Effect.gen), `composition.md [4]` (Layer merging), `types.md [5]` (schema family selection).

---
## [1][MODEL_CLASS]
>**Dictum:** *One Model.Class definition replaces 5-10 manual type/schema declarations.*

`Model.Class` wraps VariantSchema -- field modifiers control per-variant inclusion/exclusion across six coordinated projections. Types derive via `typeof User.Type`, `typeof User.insert.Type` -- never redeclare.

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
import { Model } from '@effect/sql';
import { Schema as S } from 'effect';

class Session extends Model.Class<Session>('Session')({
    id:            Model.Generated(S.UUID),
    appId:         S.UUID,
    userId:        S.UUID,
    expiryAccess:  S.DateFromSelf,
    expiryRefresh: S.DateFromSelf,
    verifiedAt:    Model.FieldOption(S.DateFromSelf),
    ipAddress:     Model.FieldOption(S.String),
    agent:         Model.FieldOption(S.String),
    tokenAccess:   Model.Sensitive(S.String),
    tokenRefresh:  Model.Sensitive(S.String),
    deletedAt:     Model.FieldOption(S.DateFromSelf),
    updatedAt:     Model.DateTimeUpdateFromDate,
}) {}
// Session          -- select (all fields present)
// Session.insert   -- id omitted (Generated), updatedAt auto-now
// Session.update   -- id present (WHERE), updatedAt auto-now
// Session.json     -- tokenAccess/tokenRefresh excluded (Sensitive)
// Session.jsonCreate -- id + Sensitive excluded
// Session.jsonUpdate -- id + Sensitive excluded
```

### [1.1] Field Modifier Truth Table

| [INDEX] | [MODIFIER]                     | [SELECT] | [INSERT] | [UPDATE] | [JSON] | [JSON_CREATE] | [JSON_UPDATE] |
| :-----: | ------------------------------ | :------: | :------: | :------: | :----: | :-----------: | :-----------: |
|   [1]   | Plain field                    |    Y     |    Y     |    Y     |   Y    |       Y       |       Y       |
|   [2]   | `Model.Generated(schema)`      |    Y     |    --    |    Y     |   Y    |      --       |      --       |
|   [3]   | `Model.GeneratedByApp(schema)` |    Y     |    Y     |    Y     |   Y    |      --       |      --       |
|   [4]   | `Model.Sensitive(schema)`      |    Y     |    Y     |    Y     |   --   |      --       |      --       |
|   [5]   | `Model.FieldOption(schema)`    |  Option  | nullable | nullable | Option |   nullable    |   nullable    |
|   [6]   | `Model.DateTimeInsertFromDate` |    Y     | auto-now |    --    |   Y    |       Y       |      --       |
|   [7]   | `Model.DateTimeUpdateFromDate` |    Y     | auto-now | auto-now |   Y    |       Y       |       Y       |
|   [8]   | `Model.JsonFromString(schema)` |   text   |   text   |   text   | object |    object     |    object     |
|   [9]   | `Model.BooleanFromNumber`      |   0/1    |   0/1    |   0/1    |  bool  |     bool      |     bool      |
|  [10]   | `Model.UuidV4Insert(brand)`    |    Y     | auto-gen |    Y     |   Y    |      --       |      --       |

`Generated` -- DB-owned columns (uuidv7 PKs, stored-generated). `Sensitive` -- tokens, hashes, encrypted payloads. `FieldOption` -- `Option<T>` in domain, `NULL` in DB. `JsonFromString` -- JSONB column stored as text in DB, parsed object in JSON variants. `DateTimeInsertFromDate` for `createdAt`; `DateTimeUpdateFromDate` for `updatedAt`.

---
## [2][REPO_FACTORY]
>**Dictum:** *repo(model, table, config) produces CRUD surface with predicates, OCC, soft-delete, and tenant scoping.*

The `repo()` factory extends `Model.makeRepository` with predicate algebra, keyset pagination, soft-delete, OCC, MERGE, streaming, and tenant scoping. Domain repos spread the factory result and add business-specific methods.

```typescript
// --- [REPOSITORIES] ----------------------------------------------------------
import { Effect, Option, Schema as S } from 'effect';
import { repo, Update } from './factory.ts';

const makeSessionRepo = Effect.gen(function* () {
    const repository = yield* repo(Session, 'sessions', {
        scoped: 'appId',
        purge:  'purge_sessions',
        resolve: {
            byAccessToken:  {
                field: 'tokenAccess',
                through: { table: 'session_tokens', target: 'sessionId' },
            },
            byRefreshToken: {
                field: 'tokenRefresh',
                through: { table: 'session_tokens', target: 'sessionId' },
            },
            byUser: { field: 'userId', many: true },
        },
    });
    return {
        ...repository,
        byRefreshTokenForUpdate: (hash: string) =>
            repository.by('byRefreshToken', hash, 'update'),
        softDeleteByIp: (appId: string, ipAddress: string) =>
            repository.drop([
                { field: 'appId', value: appId },
                { field: 'ipAddress', value: ipAddress },
            ]),
        touch: repository.touch('updatedAt'),
        verify: (id: string) =>
            repository.set(id, { verifiedAt: Update.now },
                undefined,
                { field: 'verifiedAt', op: 'null' },
            ),
    };
});
```

### [2.1] Factory Config

| [INDEX] | [KEY]       | [PURPOSE]                                                            |
| :-----: | ----------- | -------------------------------------------------------------------- |
|   [1]   | `pk`        | Custom primary key `{ column: string; cast?: SqlCast }`              |
|   [2]   | `scoped`    | Tenant isolation field -- auto-injects WHERE from `Client.tenant`    |
|   [3]   | `resolve`   | Named lookups: string field, compound key, `through` join table      |
|   [4]   | `conflict`  | UPSERT keys + columns to update: `{ keys, only? }`                   |
|   [5]   | `purge`     | Soft-delete purge: function name or `{ table, column, defaultDays }` |
|   [6]   | `functions` | PostgreSQL function call specs with typed params/results             |

### [2.2] Factory Surface

| [INDEX] | [METHOD]      | [SIGNATURE]                                  | [RETURNS]               |
| :-----: | ------------- | -------------------------------------------- | ----------------------- |
|   [1]   | `find`        | `(pred, { asc? })`                           | `Effect<Row[]>`         |
|   [2]   | `one`         | `(pred, lock?)`                              | `Effect<Option<Row>>`   |
|   [3]   | `page`        | `(pred, { limit?, cursor?, asc? })`          | `Effect<KeysetPage>`    |
|   [4]   | `pageOffset`  | `(pred, { limit?, offset?, asc? })`          | `Effect<OffsetPage>`    |
|   [5]   | `count`       | `(pred)`                                     | `Effect<number>`        |
|   [6]   | `exists`      | `(pred)`                                     | `Effect<boolean>`       |
|   [7]   | `agg`         | `(pred, { sum?, avg?, min?, max?, count? })` | `Effect<Record>`        |
|   [8]   | `put`         | `(data, conflict?)`                          | `Effect<Row>`           |
|   [9]   | `upsert`      | `(data, occ?)`                               | `Effect<Row>`           |
|  [10]   | `merge`       | `(data)`                                     | `Effect<Row & _action>` |
|  [11]   | `set`         | `(id\|pred, updates, scope?, when?)`         | `Effect<Row\|number>`   |
|  [12]   | `drop`        | `(id\|ids\|pred)`                            | `Effect<Row\|number>`   |
|  [13]   | `lift`        | `(id\|ids\|pred)`                            | `Effect<Row\|number>`   |
|  [14]   | `by`          | `(resolverName, value, lock?)`               | `Effect<Option\|Row[]>` |
|  [15]   | `preds`       | `(filter)`                                   | `Pred[]`                |
|  [16]   | `wildcard`    | `(field, value?)`                            | `Pred[]`                |
|  [17]   | `stream`      | `(pred, { asc? })`                           | `Stream<Row>`           |
|  [18]   | `touch`       | `(field) => (id) =>`                         | `Effect<Row>`           |
|  [19]   | `fn`          | `<T>(name, params)`                          | `Effect<T>`             |
|  [20]   | `json.decode` | `(field, schema) => (opt) =>`                | `Effect<Option<A>>`     |
|  [21]   | `json.encode` | `(schema) => (value) =>`                     | `Effect<string>`        |

### [2.3] Predicate Algebra

```typescript
// --- [TYPES] -----------------------------------------------------------------
type Pred =
    | [string, unknown]                                         // tuple shorthand
    | { field: string; op?: PredOp; value?: unknown;            // structured
        values?: unknown[]; cast?: SqlCast; wrap?: 'casefold' }
    | { raw: Statement.Fragment };                              // escape hatch

// --- [FUNCTIONS] -------------------------------------------------------------
// preds() auto-generates from filter objects -- temporal awareness on uuidv7
const filter = repository.preds({ userId, type: types, after, before });
// after/before map to tsGte/tsLte on uuidv7 PK via uuid_extract_timestamp
repository.find(filter)
repository.page(filter, { limit: 50, cursor })
repository.count(filter)

// wildcard() converts glob patterns to LIKE predicates
repository.find(repository.wildcard('type', 'image/*'))
// 'image/*' -> { field: 'type', op: 'like', value: 'image/%' }
// 'image/png' -> { field: 'type', op: 'eq', value: 'image/png' }
```

| [INDEX] | [OPERATOR]    | [SQL]                                   | [USE]                       |
| :-----: | ------------- | --------------------------------------- | --------------------------- |
|   [1]   | `eq`          | `col = $value`                          | Default; exact match        |
|   [2]   | `in`          | `col IN ($values...)`                   | Array membership            |
|   [3]   | `gt`/`gte`    | `col > $value` / `col >= $value`        | Range lower bound           |
|   [4]   | `lt`/`lte`    | `col < $value` / `col <= $value`        | Range upper bound           |
|   [5]   | `null`        | `col IS NULL`                           | Null check                  |
|   [6]   | `notNull`     | `col IS NOT NULL`                       | Existence check             |
|   [7]   | `contains`    | `col @> $value::jsonb`                  | JSONB containment           |
|   [8]   | `containedBy` | `col <@ $value::jsonb`                  | JSONB inverse containment   |
|   [9]   | `hasKey`      | `col ? $value`                          | JSONB key existence         |
|  [10]   | `hasKeys`     | `col ?& ARRAY[$values]::text[]`         | JSONB multi-key existence   |
|  [11]   | `tsGte`       | `uuid_extract_timestamp(col) >= $value` | UUIDv7 temporal lower bound |
|  [12]   | `tsLte`       | `uuid_extract_timestamp(col) <= $value` | UUIDv7 temporal upper bound |
|  [13]   | `like`        | `col LIKE $value`                       | Pattern matching            |

### [2.4] Update Render Functions

```typescript
// Update renders -- (col, sql, pg) => Statement.Fragment
repository.set(id, { updatedAt: Update.now })
// -> SET updated_at = NOW()

repository.set(id, { counter: Update.inc(1) })
// -> SET counter = counter + 1

repository.set(id, { settings: Update.jsonb.set(['featureFlags', 'enableMfa'], 100) })
// -> SET settings = jsonb_set(settings, '{featureFlags,enableMfa}'::text[], '100'::jsonb)

repository.set(id, { settings: Update.jsonb.del(['featureFlags', 'enableMfa']) })
// -> SET settings = settings #- '{featureFlags,enableMfa}'::text[]
```

### [2.5] MERGE RETURNING

PostgreSQL 18.2 `MERGE INTO` with `_action` discriminator. Requires `conflict.keys` in factory config. Returns row + `_action: 'insert' | 'update'` via `xmax = 0` heuristic.

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
const result = yield* repository.merge({
    appId, role: 'admin', resource: 'documents', action: 'read',
    deletedAt: Option.none(), updatedAt: undefined,
});
// result._action === 'insert' -- new row created
// result._action === 'update' -- existing row updated

// SQL generated:
// MERGE INTO permissions USING (VALUES (...)) AS source(...)
//   ON permissions.app_id = source.app_id AND ...
//   WHEN MATCHED THEN UPDATE SET ...
//   WHEN NOT MATCHED THEN INSERT (...) VALUES (...)
//   RETURNING *, (CASE WHEN xmax = 0 THEN 'insert' ELSE 'update' END) AS _action
```

### [2.6] Soft-Delete and OCC

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
// drop() sets deleted_at = NOW() on the field with mark: 'soft' in Field registry
yield* repository.drop(id)             // single -> returns Row
yield* repository.drop([id1, id2])     // bulk   -> returns count
yield* repository.drop([              // predicate-based -> returns count
    { field: 'role', value: 'guest' },
    { field: 'expiresAt', op: 'lt', value: new Date() },
])

// lift() restores: sets deleted_at = NULL (requires mark: 'soft')
yield* repository.lift(id)

// OCC via put() -- fails with RepoOccError if updated_at diverged
yield* repository.put(data, {
    keys: ['appId', 'email'],
    occ: expectedUpdatedAt,
})
// -> INSERT ... ON CONFLICT (app_id, email) DO UPDATE SET ...
//    WHERE permissions.updated_at = $expectedUpdatedAt

// upsert() uses pre-configured conflict keys with optional OCC
yield* repository.upsert(data, expectedUpdatedAt)
```

`$active` fragment auto-appends `AND deleted_at IS NULL` to all queries. `$fresh` appends `AND (expires_at IS NULL OR expires_at > NOW())` for `mark: 'exp'` fields. Both are transparent -- consumers never construct these guards.

---
## [3][SQL_CLIENT_AND_TRANSACTIONS]
>**Dictum:** *SqlSchema combinators compose request/result schemas once; withTransaction wraps atomically; nesting auto-savepoints.*

```typescript
// --- [SERVICES] --------------------------------------------------------------
import { SqlClient, SqlSchema } from '@effect/sql';
import { Array as A, Data, Effect, Option, Schema as S, pipe } from 'effect';

const makeBalanceRepo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const findByAccount = SqlSchema.findOne({
        Request:  S.Struct({ accountId: S.UUID }),
        Result:   S.Struct({ id: S.UUID, balance: S.Number }),
        execute:  (params) => sql`
            SELECT id, balance FROM accounts
            WHERE id = ${params.accountId} FOR UPDATE`,
    });
    return { findByAccount };
});

// --- [FUNCTIONS] -------------------------------------------------------------
class InsufficientFundsError extends Data.TaggedError('InsufficientFundsError')<{
    readonly accountId: string;
    readonly available: number;
    readonly requested: number;
}> {}

const transfer = (fromId: string, toId: string, amount: number) =>
    Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
            Effect.gen(function* () {
                const row = yield* sql<{ balance: number }>`
                    SELECT balance FROM accounts
                    WHERE id = ${fromId} FOR UPDATE`;
                const balance = pipe(
                    A.head(row),
                    Option.map((account) => account.balance),
                    Option.getOrElse(() => 0),
                );
                yield* Effect.succeed(balance).pipe(
                    Effect.filterOrFail(
                        (available) => available >= amount,
                        () => new InsufficientFundsError({
                            accountId: fromId, available: balance,
                            requested: amount,
                        }),
                    ),
                );
                yield* sql`UPDATE accounts
                    SET balance = balance - ${amount}
                    WHERE id = ${fromId}`;
                yield* sql`UPDATE accounts
                    SET balance = balance + ${amount}
                    WHERE id = ${toId}`;
            }),
        );
    });
```

| [INDEX] | [COMBINATOR]        | [RETURNS]                  | [USE]                              |
| :-----: | ------------------- | -------------------------- | ---------------------------------- |
|   [1]   | `SqlSchema.findAll` | `Effect<ReadonlyArray<A>>` | SELECT 0-N rows                    |
|   [2]   | `SqlSchema.findOne` | `Effect<Option<A>>`        | SELECT 0-1 rows                    |
|   [3]   | `SqlSchema.single`  | `Effect<A>`                | SELECT exactly 1 (fails if 0)      |
|   [4]   | `SqlSchema.void`    | `Effect<void>`             | INSERT/UPDATE/DELETE, discard rows |

`sql.withTransaction(effect)` -- BEGIN/COMMIT on success, ROLLBACK on any `E` failure or interruption. PgClient tracks nesting depth -- inner `withTransaction` calls issue `SAVEPOINT sp_N` / `ROLLBACK TO SAVEPOINT sp_N` automatically. Never manage savepoints manually.

---
## [4][CLIENT_INFRASTRUCTURE]
>**Dictum:** *Client provides connection pool, tenant context, advisory locks, and LISTEN/NOTIFY streaming.*

### [4.1] Connection Pool

```typescript
// --- [LAYERS] ----------------------------------------------------------------
import { PgClient } from '@effect/sql-pg';
import { Config, Duration, String as S } from 'effect';

PgClient.layerConfig({
    applicationName:      Config.succeed('my-app'),
    maxConnections:       Config.succeed(20),
    minConnections:       Config.succeed(2),
    connectionTTL:        Config.succeed(Duration.minutes(30)),
    idleTimeout:          Config.succeed(Duration.minutes(5)),
    connectTimeout:       Config.succeed(Duration.seconds(10)),
    transformQueryNames:  Config.succeed(S.camelToSnake),
    transformResultNames: Config.succeed(S.snakeToCamel),
    url:                  Config.succeed(Redacted.make(connectionUrl)),
})
```

`transformQueryNames: S.camelToSnake` -- tagged template identifiers `sql(fieldName)` auto-map camelCase to snake_case. `transformResultNames: S.snakeToCamel` -- result columns auto-map back. Capability guard runs on pool creation -- asserts PG18.2+ and pgvector extension.

### [4.2] Tenant Context

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
// FiberRef-based tenant context for row-level security
Client.tenant.current
// -> FiberRef.get(ref) => tenantId string

Client.tenant.with(appId, effect)
// -> fiber-local tenantId + set_config('app.current_tenant', appId, true)
//    within an implicit transaction for RLS activation

Client.tenant.locally(appId, effect)
// -> fiber-local override without SQL context (no set_config)

Client.tenant.set(tenantId)
// -> FiberRef.set(ref, tenantId)

Client.tenant.Id.system
// -> '00000000-0000-7000-8000-000000000000' (bypasses scope guard)

Client.tenant.Id.unspecified
// -> '00000000-0000-7000-8000-ffffffffffff' (fails RepoScopeError)
```

`scoped: 'appId'` repos read `Client.tenant.current` on every operation and inject `AND app_id = $tenantId`. System tenant bypasses the scope guard entirely. Unspecified tenant fails with RepoScopeError -- prevents accidental cross-tenant access.

### [4.3] Advisory Locks

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
// Transaction-scoped locks (released at tx end)
yield* Client.lock.acquire(lockKey)        // pg_advisory_xact_lock
const acquired = yield* Client.lock.try(lockKey)
// -> pg_try_advisory_xact_lock => boolean

// Session-scoped locks (released explicitly or at disconnect)
yield* Client.lock.session.acquire(lockKey)
const acquired = yield* Client.lock.session.try(lockKey)
const released = yield* Client.lock.session.release(lockKey)
```

### [4.4] LISTEN/NOTIFY

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
import { Stream } from 'effect';

// Raw notifications as Stream
const raw: Stream.Stream<Notification> = Client.listen.raw('channel_name')

// Typed with schema decode + error filtering
const typed: Stream.Stream<MyEvent> = Client.listen.typed(
    'events', MyEventSchema,
)
// Decode failures logged as warnings and filtered out

// Publish
yield* Client.notify('channel_name', JSON.stringify(payload))
```

---
## [5][PAGINATION]
>**Dictum:** *Keyset pagination via LIMIT+1 sentinel; cursor is Base64URL-encoded JSON.*

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
import { Page } from './page.ts';

// Request schemas for API endpoints
Page.Keyset      // S.Struct({ cursor: S.optional(S.String), limit: Limit })
Page.KeysetInput // S.Struct({ asc: Asc, cursor: S.optional(S.String), limit: Limit })
Page.Offset      // S.Struct({ limit: Limit, offset: S.NonNegativeInt })
Page.OffsetInput // S.Struct({ asc: Asc, limit: Limit, offset: S.NonNegativeInt })
Page.Limit       // S.Int between 1..1000, default 100
Page.bounds      // { min: 1, max: 1000, default: 100 }

// --- [FUNCTIONS] -------------------------------------------------------------
// Cursor decode -- Base64URL -> JSON -> { id, v? }
const decoded = yield* Page.decode(cursor)
// -> Effect<Option<{ id: string }>>
const decoded = yield* Page.decode(cursor, ScoreSchema)
// -> Effect<Option<{ id: string; v: Score }>>

// Cursor encode
const encoded = Page.encode(lastId)
const encoded = Page.encode(lastId, score, ScoreSchema)

// Keyset result -- strips LIMIT+1 sentinel, computes hasNext/hasPrev
Page.keyset(rows, total, limit, (item) => ({ id: item.id }))
// -> { items, total, cursor, hasNext, hasPrev }

// Offset result -- computes page/pages/hasNext/hasPrev
Page.offset(items, total, start, limit)
// -> { items, total, page, pages, hasNext, hasPrev }
```

Factory `page()` method combines CTE total count + keyset cursor in a single query -- no separate COUNT. `pageOffset()` uses standard `LIMIT/OFFSET` for admin-facing UIs where total page count is needed.

---
## [6][MIGRATIONS]
>**Dictum:** *Migrations are Effect.gen programs using SqlClient; one file per schema epoch.*

```typescript
// migrations/0002_add_feature_flags.ts
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// biome-ignore lint/style/noDefaultExport: @effect/sql-pg migrations require default export
export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(String.raw`
        ALTER TABLE apps
            ADD COLUMN IF NOT EXISTS feature_flags JSONB
                NOT NULL DEFAULT '{}'::jsonb
                CHECK (jsonb_typeof(feature_flags) = 'object');
        CREATE INDEX IF NOT EXISTS idx_apps_feature_flags
            ON apps USING GIN (feature_flags)
            WHERE feature_flags != '{}'::jsonb`);
});
```

Tracked in `_sql_migrations` table -- run once per environment. `String.raw` preserves backslash sequences in SQL regex patterns. Each migration runs in its own transaction. Seeding follows the same pattern -- idempotent `INSERT ... ON CONFLICT DO NOTHING`. Rollback is always a new forward migration; `Down()` is unreliable in production.

---
## [7][RULES]

[ALWAYS]:
- `Model.Class<Self>(name)(fields)` for persistence entities -- one class, six derived projections.
- `repo(model, table, config)` for entity CRUD -- never hand-roll predicates, soft-delete, or pagination.
- `SqlSchema.findAll`/`findOne`/`single`/`void` with explicit `Request`/`Result` schemas -- construct once at initialization, invoke per-request.
- `scoped: 'appId'` for tenant-bound repos -- auto-injects WHERE from `Client.tenant` FiberRef.
- Spread `repository` in maker function, add domain methods alongside -- no artificial grouping.
- `sql.withTransaction(effect)` for atomic multi-statement mutations -- nesting auto-savepoints.
- `preds(filter)` for dynamic query composition -- never hand-build predicate arrays from filter objects.
- `Update.now`/`Update.inc`/`Update.jsonb.set`/`Update.jsonb.del` for column mutations via `set()`.
- `Page.keyset` for paginated endpoints -- always fetch `LIMIT+1` for hasNext detection.

[NEVER]:
- Expose `SqlClient` outside the persistence layer -- consumers use typed repo/service methods.
- `sql.literal(userInput)` -- bypasses parameterization; DDL and static operators only.
- Declare `type UserRow = { ... }` separately -- derive via `typeof User.Type`.
- Redeclare insert/update shapes -- `User.insert.Type` is canonical.
- `Model.Class` for config, state, or objects that never serialize -- use plain objects + `typeof`.
- Manual savepoint nesting -- PgClient depth tracking handles it automatically.
- Offset pagination on large tables -- `OFFSET N` forces sequential scan; use keyset via `page()`.
- `rows[0]?.field ?? fallback` -- use `pipe(A.head(rows), Option.map(...), Option.getOrElse(...))`.

---
## [8][QUICK_REFERENCE]

| [INDEX] | [API]                          | [WHEN]                                 | [KEY_TRAIT]                                      |
| :-----: | ------------------------------ | -------------------------------------- | ------------------------------------------------ |
|   [1]   | `Model.Class<S>(name)(fields)` | Persistence entity with field metadata | Six auto-projections: select/insert/update/json* |
|   [2]   | `repo(model, table, config)`   | Extended CRUD with predicates + OCC    | find/one/page/upsert/merge/drop/lift/count/preds |
|   [3]   | `SqlSchema.findAll({...})`     | SELECT 0-N rows                        | `Effect<ReadonlyArray<A>, SqlError\|ParseError>` |
|   [4]   | `SqlSchema.findOne({...})`     | SELECT 0-1 rows                        | `Effect<Option<A>, SqlError\|ParseError>`        |
|   [5]   | `SqlSchema.single({...})`      | SELECT exactly 1 row                   | Fails with NoSuchElementException if 0 rows      |
|   [6]   | `SqlSchema.void({...})`        | INSERT/UPDATE/DELETE, discard rows     | `Effect<void, SqlError\|ParseError>`             |
|   [7]   | `sql.withTransaction(effect)`  | Atomic multi-statement boundary        | Any `E` failure -> rollback; nesting = savepoint |
|   [8]   | `Client.tenant.with(id, eff)`  | Scoped tenant SQL context              | FiberRef + `set_config` for RLS activation       |
|   [9]   | `Client.lock.acquire(key)`     | Transaction-scoped advisory lock       | `pg_advisory_xact_lock` -- released at tx end    |
|  [10]   | `Client.listen.typed(ch, s)`   | PostgreSQL LISTEN as typed Stream      | Decode + filter; failures logged as warnings     |
|  [11]   | `Update.now`                   | Render: `col = NOW()`                  | Timestamp mutation via `repository.set()`        |
|  [12]   | `Update.inc(delta)`            | Render: `col = col + delta`            | Atomic counter increment                         |
|  [13]   | `Update.jsonb.set(path, val)`  | Render: `jsonb_set(col, path, val)`    | Nested JSONB field mutation                      |
|  [14]   | `Update.jsonb.del(path)`       | Render: `col #- path`                  | Nested JSONB field removal                       |
|  [15]   | `Page.keyset(rows, ...)`       | Keyset pagination result               | LIMIT+1 sentinel, Base64URL cursor               |
|  [16]   | `Page.decode(cursor)`          | Cursor decode                          | `Effect<Option<{ id, v? }>>`                     |
|  [17]   | `preds(filter)`                | Auto-generate predicates from filter   | Temporal awareness on uuidv7 columns             |
|  [18]   | `merge(data)`                  | PostgreSQL 18.2 MERGE RETURNING        | `_action: 'insert' \| 'update'` discriminator    |
