# @effect/sql-drizzle v0.48 API Research

## [1][FINDINGS]

### [1.1] PgDrizzle.layer Integration with SqlClient

**Layer Type Signatures:**

```typescript
// From @effect/sql-drizzle/Pg

// Layer - requires SqlClient, provides PgDrizzle
declare const layer: Layer.Layer<PgDrizzle, never, Client.SqlClient>

// Layer with custom Drizzle configuration
declare const layerWithConfig: (
  config: DrizzleConfig
) => Layer.Layer<PgDrizzle, never, Client.SqlClient>
```

**Constructor Functions:**

```typescript
// Create PgDrizzle instance with optional config
declare const make: <TSchema extends Record<string, unknown> = Record<string, never>>(
  config?: Omit<DrizzleConfig<TSchema>, "logger">
) => Effect.Effect<PgRemoteDatabase<TSchema>, never, Client.SqlClient>

// Create with explicit configuration
declare const makeWithConfig: (
  config: DrizzleConfig
) => Effect.Effect<PgRemoteDatabase, never, Client.SqlClient>
```

**PgDrizzle Class:**

```typescript
// Context.Tag for dependency injection
export class PgDrizzle extends Context.Tag("@effect/sql-drizzle/Pg")<
  PgDrizzle,
  PgRemoteDatabase
>() {}
```

**Integration Pattern:**

The layer requires `SqlClient` from `@effect/sql` as a dependency. The `SqlClient` is provided by database-specific packages like `@effect/sql-pg`:

```typescript
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import { PgClient } from "@effect/sql-pg"
import { Config, Layer } from "effect"

// Step 1: Create PgClient layer (provides SqlClient)
const PgLive = PgClient.layerConfig({
  database: Config.succeed("mydb"),
  host: Config.succeed("localhost"),
  port: Config.succeed(5432),
  username: Config.succeed("postgres"),
  password: Config.redacted("POSTGRES_PASSWORD"),
})

// Step 2: Create Drizzle layer (requires SqlClient)
const DrizzleLive = PgDrizzle.layer.pipe(Layer.provide(PgLive))

// Step 3: Merge for combined access
const DatabaseLive = Layer.mergeAll(PgLive, DrizzleLive)
// Type: Layer.Layer<SqlClient | PgClient.PgClient | PgDrizzle.PgDrizzle, ConfigError | SqlError>
```

---

### [1.2] Query Execution Pattern (Effect<A, SqlError>)

**Core Mechanism:**

Drizzle queries are patched to implement the Effect interface. The `QueryPromise` prototype is extended with Effect's `Effectable.CommitPrototype`:

```typescript
// Internal declaration (module augmentation)
export interface QueryPromise<T> extends Effect.Effect<T, SqlError> {}
```

**Query Builder Returns Effect:**

```typescript
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const drizzle = yield* PgDrizzle.PgDrizzle

  // SELECT - returns Effect<User[], SqlError>
  const users = yield* drizzle
    .select()
    .from(usersTable)
    .where(eq(usersTable.active, true))

  // INSERT - returns Effect<InsertResult, SqlError>
  const inserted = yield* drizzle
    .insert(usersTable)
    .values({ name: "Alice", email: "alice@example.com" })
    .returning()

  // UPDATE - returns Effect<UpdateResult, SqlError>
  const updated = yield* drizzle
    .update(usersTable)
    .set({ active: false })
    .where(eq(usersTable.id, 1))

  // DELETE - returns Effect<DeleteResult, SqlError>
  const deleted = yield* drizzle
    .delete(usersTable)
    .where(eq(usersTable.id, 1))

  return users
})
```

**Patching Implementation:**

The internal `patch.ts` module:

1. Extends `Effectable.CommitPrototype` with a custom `commit` method
2. Wraps `QueryPromise.execute()` in `Effect.tryPromise`
3. Catches errors and wraps them as `SqlError`
4. Uses `makeRemoteCallback` factory to route queries through `SqlClient`

```typescript
// Simplified internal implementation
const PatchProto = {
  ...Effectable.CommitPrototype,
  commit() {
    return Effect.tryPromise({
      try: () => this.execute(),
      catch: (error) => new SqlError({ error, message: "Query failed" })
    })
  }
}
```

---

### [1.3] Transaction Handling

**SqlClient.withTransaction:**

Transactions are managed through `@effect/sql`'s `SqlClient` service, not through Drizzle directly:

```typescript
import { SqlClient } from "@effect/sql"
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import { Effect } from "effect"

const transferFunds = (fromId: number, toId: number, amount: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const drizzle = yield* PgDrizzle.PgDrizzle

    // Transaction scope - automatic rollback on failure
    yield* sql.withTransaction(
      Effect.gen(function* () {
        // Debit
        yield* drizzle
          .update(accountsTable)
          .set({ balance: sql`balance - ${amount}` })
          .where(eq(accountsTable.id, fromId))

        // Credit
        yield* drizzle
          .update(accountsTable)
          .set({ balance: sql`balance + ${amount}` })
          .where(eq(accountsTable.id, toId))

        // Validate (failure triggers rollback)
        const [from] = yield* drizzle
          .select({ balance: accountsTable.balance })
          .from(accountsTable)
          .where(eq(accountsTable.id, fromId))

        if (from.balance < 0) {
          yield* Effect.fail(new InsufficientFundsError())
        }
      })
    )
  })
```

**FiberRef Context Propagation:**

The transaction connection is propagated through Effect's FiberRef system. When `withTransaction` is called:

1. A dedicated connection is acquired from the pool
2. `BEGIN` is issued
3. The connection is stored in a FiberRef
4. All Drizzle queries within scope use this connection
5. `COMMIT` on success, `ROLLBACK` on failure

**Nested Transactions (Savepoints):**

```typescript
yield* sql.withTransaction(
  Effect.gen(function* () {
    yield* drizzle.insert(ordersTable).values({ ... })

    // Nested transaction creates savepoint
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* drizzle.insert(orderItemsTable).values({ ... })
        // Failure here rolls back to savepoint, not entire transaction
      })
    )
  })
)
```

---

### [1.4] Type Inference from Drizzle Schema

**Schema-to-Type Flow:**

Drizzle's type inference is fully preserved. The `PgDrizzle.make<TSchema>` generic parameter enables schema-aware typing:

```typescript
import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core"
import { InferSelectModel, InferInsertModel } from "drizzle-orm"

// Define schema
const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

// Infer types
type User = InferSelectModel<typeof usersTable>
// { id: number; name: string; email: string; active: boolean; createdAt: Date }

type NewUser = InferInsertModel<typeof usersTable>
// { id?: number; name: string; email: string; active?: boolean; createdAt?: Date }
```

**Query Result Types:**

```typescript
const program = Effect.gen(function* () {
  const drizzle = yield* PgDrizzle.PgDrizzle

  // Full select - User[]
  const users = yield* drizzle.select().from(usersTable)
  // ^? Effect<User[], SqlError>

  // Partial select - { id: number; name: string }[]
  const partial = yield* drizzle
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
  // ^? Effect<{ id: number; name: string }[], SqlError>

  // With joins - combined types
  const withPosts = yield* drizzle
    .select()
    .from(usersTable)
    .leftJoin(postsTable, eq(usersTable.id, postsTable.authorId))
  // ^? Effect<{ users: User; posts: Post | null }[], SqlError>
})
```

**drizzle-effect Schema Derivation:**

For deriving Effect schemas from Drizzle tables, use `@handfish/drizzle-effect` (community package):

```typescript
import { createInsertSchema, createSelectSchema } from "drizzle-effect"
import { Schema } from "@effect/schema"

const insertUserSchema = createInsertSchema(usersTable)
const selectUserSchema = createSelectSchema(usersTable)

// Refine fields
const insertUserSchemaRefined = createInsertSchema(usersTable, {
  email: (schema) => schema.email.pipe(Schema.pattern(/[^.@]+@[^.@]+\.[^.@]/)),
})
```

---

### [1.5] Version 0.48 Changes and History

**Version 0.48.0 (Current):**
- Patch release with dependency updates
- Updated to `effect@3.19.13`
- Updated to `@effect/sql@0.49.0`
- No breaking changes

**Key Historical Changes (v0.34 - v0.48):**

| Version | Change | Type |
|---------|--------|------|
| v0.34.0 | Added `layerWithConfig` method | Feature |
| v0.34.0 | Support for Drizzle configuration | Feature |
| v0.17.0 | Adopted `layer`/`layerConfig` naming | Breaking |
| v0.2.0 | Flat import structure | Breaking |

**v0.34.0 - Drizzle Config Support:**
```typescript
// New in v0.34+
import * as PgDrizzle from "@effect/sql-drizzle/Pg"

const DrizzleLive = PgDrizzle.layerWithConfig({
  // Drizzle configuration options
  logger: true, // Note: logger is ignored, Effect handles logging
})
```

**v0.17.0 - Naming Convention Change:**
```typescript
// Before v0.17
PgDrizzle.layer // raw config
PgDrizzle.layerConfig // Config.Config<...>

// After v0.17 (current)
PgDrizzle.layer // uses make() internally
PgDrizzle.layerWithConfig(config) // accepts DrizzleConfig
```

**No Breaking Changes in v0.40-v0.48:**

Versions 0.40 through 0.48 contain coordinated dependency updates with `@effect/sql` and core `effect` package. The API surface remained stable.

---

### [1.6] Internal Patch Mechanism

**PatchProto Implementation:**

```typescript
// From internal/patch.ts (conceptual)
import { Effectable } from "effect"

const PatchProto = {
  ...Effectable.CommitPrototype,
  commit(this: QueryPromise<unknown>) {
    return Effect.withFiberRuntime((fiber) => {
      // Track current runtime for context
      currentRuntime = fiber.runtime

      return Effect.tryPromise({
        try: () => this.execute(),
        catch: (error) => new SqlError({
          error,
          message: `Query execution failed: ${String(error)}`
        })
      })
    })
  }
}
```

**makeRemoteCallback Factory:**

Creates the callback that routes SQL queries through Effect's SqlClient:

```typescript
const makeRemoteCallback = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  return async (
    sqlString: string,
    params: unknown[],
    method: "all" | "execute" | "get" | "values" | "run"
  ) => {
    const result = await Effect.runPromise(
      sql.unsafe(sqlString, params).pipe(
        Effect.provide(/* current context */)
      )
    )

    // Normalize response format
    return method === "get"
      ? { rows: result[0] ? [result[0]] : [] }
      : { rows: result }
  }
})
```

**Prototype Patching:**

```typescript
const patch = (proto: object) => {
  // Prevent double-patching
  if (EffectTypeId in proto) return

  Object.assign(proto, PatchProto)
  Object.defineProperty(proto, EffectTypeId, { value: true })
}

// Applied to Drizzle classes
patch(QueryPromise.prototype)
patch(PgSelectBase.prototype)
```

---

### [1.7] Layer Composition Patterns

**Recommended Pattern:**

```typescript
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import { PgClient } from "@effect/sql-pg"
import { SqlClient } from "@effect/sql"
import { Config, Duration, Layer, pipe } from "effect"

// --- [TYPES] ---
type PgClientLayer = Layer.Layer<
  SqlClient.SqlClient | PgClient.PgClient,
  SqlError | ConfigError,
  never
>

type DrizzleLayer = Layer.Layer<
  PgDrizzle.PgDrizzle,
  never,
  SqlClient.SqlClient
>

type DatabaseLayer = Layer.Layer<
  SqlClient.SqlClient | PgClient.PgClient | PgDrizzle.PgDrizzle,
  SqlError | ConfigError,
  never
>

// --- [LAYERS] ---
const PgLive: PgClientLayer = PgClient.layerConfig({
  database: pipe(Config.string("POSTGRES_DB"), Config.withDefault("app")),
  host: pipe(Config.string("POSTGRES_HOST"), Config.withDefault("localhost")),
  port: pipe(Config.integer("POSTGRES_PORT"), Config.withDefault(5432)),
  username: pipe(Config.string("POSTGRES_USER"), Config.withDefault("postgres")),
  password: Config.redacted("POSTGRES_PASSWORD"),
  // Connection pool settings
  maxConnections: pipe(Config.integer("POSTGRES_POOL_MAX"), Config.withDefault(10)),
  idleTimeout: pipe(
    Config.integer("POSTGRES_IDLE_MS"),
    Config.withDefault(30000),
    Config.map(Duration.millis)
  ),
})

const DrizzleLive: DrizzleLayer = PgDrizzle.layer

const DatabaseLive: DatabaseLayer = Layer.mergeAll(
  PgLive,
  DrizzleLive.pipe(Layer.provide(PgLive))
)

// --- [EXPORT] ---
export { DatabaseLive, DrizzleLive, PgDrizzle, PgLive }
```

**Alternative: Scoped Layer:**

```typescript
// For applications needing explicit resource management
const DatabaseScoped = Layer.scoped(
  PgDrizzle.PgDrizzle,
  PgDrizzle.make()
).pipe(Layer.provide(PgLive))
```

**Usage in Application:**

```typescript
const program = Effect.gen(function* () {
  const drizzle = yield* PgDrizzle.PgDrizzle
  const sql = yield* SqlClient.SqlClient

  // Use either Drizzle or raw SQL
  const users = yield* drizzle.select().from(usersTable)
  const count = yield* sql`SELECT COUNT(*) FROM users`

  return users
})

// Run with layer
Effect.runPromise(
  program.pipe(Effect.provide(DatabaseLive))
)
```

---

### [1.8] SqlError Handling

**SqlError Class:**

```typescript
import { SqlError } from "@effect/sql/SqlError"

// SqlError structure
interface SqlError extends Data.TaggedError<"SqlError"> {
  readonly error: unknown      // Original database error
  readonly message: string     // Human-readable message
}
```

**Error Handling Patterns:**

```typescript
import { SqlError } from "@effect/sql"
import { Effect, Match } from "effect"

const findUser = (id: number) =>
  Effect.gen(function* () {
    const drizzle = yield* PgDrizzle.PgDrizzle

    const [user] = yield* drizzle
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id))

    return yield* user
      ? Effect.succeed(user)
      : Effect.fail(new UserNotFoundError({ id }))
  })

// Using catchTag
const program = findUser(1).pipe(
  Effect.catchTag("SqlError", (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(`Database error: ${error.message}`)
      return yield* Effect.fail(new DatabaseError({ cause: error }))
    })
  ),
  Effect.catchTag("UserNotFoundError", (error) =>
    Effect.succeed(null) // Handle not found gracefully
  )
)
```

**Using catchTags for Multiple Errors:**

```typescript
const result = program.pipe(
  Effect.catchTags({
    SqlError: (error) =>
      Effect.gen(function* () {
        yield* Effect.logError(`SQL Error: ${error.message}`)
        // Inspect original error for specific handling
        const pgError = error.error as { code?: string }
        if (pgError.code === "23505") {
          return yield* Effect.fail(new DuplicateKeyError())
        }
        return yield* Effect.fail(new DatabaseError({ cause: error }))
      }),

    UserNotFoundError: () => Effect.succeed(null),

    DuplicateKeyError: () =>
      Effect.fail(new ConflictError({ message: "User already exists" })),
  })
)
```

**Pattern Matching on SqlError:**

```typescript
const handleSqlError = (error: SqlError) =>
  Match.value(error.error).pipe(
    Match.when(
      { code: "23505" }, // Unique violation
      () => Effect.fail(new DuplicateError())
    ),
    Match.when(
      { code: "23503" }, // Foreign key violation
      () => Effect.fail(new ReferenceError())
    ),
    Match.when(
      { code: Match.string.startsWith("08") }, // Connection errors
      () => Effect.fail(new ConnectionError())
    ),
    Match.orElse(() => Effect.fail(error))
  )
```

---

## [2][CONFIDENCE]

| Domain | Confidence | Notes |
|--------|------------|-------|
| Layer Integration | HIGH | Confirmed via official docs, source code, community examples |
| Query Execution Pattern | HIGH | Verified through multiple sources and source code analysis |
| Transaction Handling | MEDIUM | Based on @effect/sql patterns; drizzle-specific examples sparse |
| Type Inference | HIGH | Drizzle's inference preserved; confirmed via examples |
| Version History | HIGH | CHANGELOG analysis completed |
| Patch Mechanism | MEDIUM | Internal implementation; inferred from public API |
| Layer Composition | HIGH | Verified via project codebase and community patterns |
| SqlError Handling | HIGH | Confirmed via @effect/sql documentation |

---

## [3][SOURCES]

### Official Documentation
- Effect SQL Drizzle Docs: https://effect-ts.github.io/effect/docs/sql-drizzle
- Effect SQL Drizzle Pg.ts: https://effect-ts.github.io/effect/sql-drizzle/Pg.ts.html
- Effect SQL Core: https://www.npmjs.com/package/@effect/sql

### GitHub Sources
- @effect/sql-drizzle Source: https://github.com/Effect-TS/effect/tree/main/packages/sql-drizzle
- @effect/sql-drizzle README: https://github.com/Effect-TS/effect/blob/main/packages/sql-drizzle/README.md

### Community Resources
- TypeOnce Drizzle + Effect Tutorial: https://www.typeonce.dev/course/paddle-payments-full-stack-typescript-app/server-implementation/postgres-database-with-effect-and-drizzle
- Effect + Drizzle GraphQL Backend: https://dev.to/martinpersson/building-a-robust-backend-with-effect-graphql-and-drizzle-k4j
- Drizzle With Effect Transactions (Video): https://www.youtube.com/watch?v=znma3rlGBbE
- Effect + Drizzle Deep Dive (Video): https://www.youtube.com/watch?v=8u3vetGUtMo

### Drizzle ORM
- Drizzle Transactions: https://orm.drizzle.team/docs/transactions
- Drizzle Queries: https://orm.drizzle.team/docs/rqb

### Schema Derivation
- drizzle-effect Package: https://www.npmjs.com/package/@handfish/drizzle-effect

### Effect Ecosystem
- This Week in Effect (sql-drizzle announcement): https://effect.website/blog/this-week-in-effect/2024/06/07/
- DeepWiki SQL Core Abstraction: https://deepwiki.com/Effect-TS/effect/6.1-sql-core-abstraction
