---
name: ts-standards
type: standard
depth: extended
description: >-
  Enforce Parametric Portal TypeScript/Effect standards and functional style.
  Use for any TypeScript coding, refactoring, review, or design task. Apply
  Parametric Portal-specific rules when working in that monorepo. Covers:
  algebraic data types, exhaustive pattern matching, schema-first types,
  Effect composition, branded types, tagged errors, service architecture,
  type-level programming, and file organization.
---

# [H1][TS-STANDARDS]
>**Dictum:** *Algebraic data types and exhaustive pattern matching produce provably correct, refactor-safe systems.*

<br>

Enforce dense, functional, ADT-first TypeScript. Pure transformations stay pure; Effect orchestrates IO, errors, dependencies, concurrency. Every behavioral branching decision uses exhaustive pattern matching. Every sum type uses tagged enums. Every error uses tagged errors. Every domain primitive uses branded types.

**Tasks:**
1. Read this file -- ADT philosophy, Effect patterns, type discipline, forbidden patterns
2. Read [patterns.md](./references/patterns.md) -- 25 concrete BAD/GOOD pattern pairs organized by domain
3. Read [repo-conventions.md](./references/repo-conventions.md) -- Parametric Portal sources of truth
4. Apply standards to implementation
5. Validate against [VERIFY] checklist

**Scope:**
- *Data Modeling:* Algebraic data types, branded types, discriminated unions, tagged enums, generic sum types.
- *Control Flow:* Exhaustive pattern matching via `Match`, typed error channels, `Option`/`Either`.
- *Type-Level:* Conditional types, mapped types, template literal types, const type parameters.
- *Effect:* Composition patterns, service layers, tracing, dependency injection via Layer.
- *Parametric Portal:* Monorepo-specific cache, resilience, telemetry, metrics integration.

**Version Requirements:** TypeScript 6.0, Effect 3.19+, React 19 canary, Vite 7.

---
## [1][CORE_PHILOSOPHY]
>**Dictum:** *ADTs encode domain variants algebraically. Exhaustive matching guarantees completeness. Branded types prevent primitive confusion.*

<br>

### Hierarchy of Control Flow (best to worst)

| [RANK] | [PATTERN]                          | [WHEN]                                                    | [GUARANTEE]                          |
| :----: | ---------------------------------- | --------------------------------------------------------- | ------------------------------------ |
|  [1]   | `Match.type` / `Match.value`       | Behavioral branching on discriminated unions               | Exhaustive, composable, type-safe    |
|  [2]   | `Data.TaggedEnum` + `$match`       | Sum types with per-variant data and built-in matching      | Structural equality, pattern matching |
|  [3]   | `Option` / `Either`                | Nullable values, fallible computations                    | No null, composable chains           |
|  [4]   | Ternary expression                 | Binary conditions only                                    | Expression, not statement            |
|  [5]   | Pure data lookup (immutable map)   | Static key-to-value with no behavior (e.g., status codes) | No branching, just data              |

[CRITICAL]:
- [NEVER] Use dispatch tables (`Record<string, () => void>`) for behavioral branching -- use `Match.type` or `Data.TaggedEnum.$match`.
- [NEVER] Use `if/else if/else` chains on discriminant fields -- use `Match.type` with `Match.exhaustive`.
- [NEVER] Use `switch` statements -- use `Match.type` or `Match.value`.
- [NEVER] Use string literal unions for variants that carry data -- use `Data.TaggedEnum`.
- [NEVER] Use plain `string` for domain identifiers -- use branded types via `Schema.brand`.

[CONDITIONAL]:
- [ALLOW] Pure data lookups (`Record<string, string>`) for static mappings with no behavior (HTTP status codes, error messages, label text).
- [ALLOW] Ternary for binary conditions where both branches are simple expressions.

---
## [2][NON_NEGOTIABLES]
>**Dictum:** *Constraints eliminate entire categories of bugs at compile time.*

<br>

[CRITICAL]:
- [NEVER] `any` -- Use branded types via `Schema.brand()`.
- [NEVER] `let`/`var` -- Use `const` exclusively.
- [NEVER] `for`/`while` -- Use `.map`, `.filter`, `Effect.forEach`, `Effect.iterate`.
- [NEVER] `try/catch` -- Use Effect error channel (`Effect.tryPromise`, `Effect.catchTag`).
- [NEVER] Default exports -- Named exports only (exception: `*.config.ts`, migrations).
- [NEVER] Barrel files (`index.ts`) -- Import directly from source.
- [NEVER] Inline exports -- Declare first, export in `[EXPORT]` section.
- [NEVER] Re-export external lib types -- Import from source.
- [NEVER] Hand-roll utilities that exist in external libs.
- [NEVER] `null` checks (`!== null && !== undefined`) -- Use `Option.fromNullable`.
- [NEVER] String errors or generic `Error` -- Use `Data.TaggedError` or `Schema.TaggedError`.

[IMPORTANT]:
- [ALWAYS] Prefix private/internal values with `_`.
- [ALWAYS] Use `Match`, `Option`, `Either`, `Effect`, `Stream`, `Schedule` for control flow.
- [ALWAYS] Derive types from schemas/tables -- never duplicate type alongside schema.
- [ALWAYS] Comments explain "why", never "what".
- [ALWAYS] 4-space indentation (no tabs).

---
## [3][ALGEBRAIC_DATA_TYPES]
>**Dictum:** *Make illegal states unrepresentable through algebraic type encoding.*

<br>

### Sum Types (Tagged Unions)

Use `Data.TaggedEnum` for domain variants that carry per-variant data:

```typescript
import { Data } from "effect"

type HttpResponse = Data.TaggedEnum<{
    Success: { readonly body: string; readonly status: number }
    Redirect: { readonly location: string }
    NotFound: { readonly path: string }
    ServerError: { readonly cause: Error }
}>

const HttpResponse = Data.taggedEnum<HttpResponse>()

// Constructors are type-safe
const ok = HttpResponse.Success({ body: "hello", status: 200 })
const moved = HttpResponse.Redirect({ location: "/new" })

// Type guard via $is
const isSuccess = HttpResponse.$is("Success")
isSuccess(ok) // true

// Exhaustive pattern matching via $match
const describe = HttpResponse.$match({
    Success: ({ body, status }) => `${status}: ${body}`,
    Redirect: ({ location }) => `-> ${location}`,
    NotFound: ({ path }) => `404: ${path}`,
    ServerError: ({ cause }) => `500: ${cause.message}`,
})
```

### Generic Sum Types

Use `Data.TaggedEnum.WithGenerics` for polymorphic sum types:

```typescript
import { Data } from "effect"

type ApiResult<E, A> = Data.TaggedEnum<{
    Success: { readonly value: A }
    Failure: { readonly error: E }
    Loading: {}
}>

interface ApiResultDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: ApiResult<this["A"], this["B"]>
}

const ApiResult = Data.taggedEnum<ApiResultDef>()
```

### Product Types (Schemas)

Use `Schema.Struct` for product types with validation:

```typescript
import { Schema as S } from "effect"

const UserSchema = S.Struct({
    id: S.String.pipe(S.brand("UserId")),
    email: S.String.pipe(S.pattern(/@/), S.brand("Email")),
    role: S.Literal("admin", "member", "guest"),
})

type User = typeof UserSchema.Type
```

### Tagged Errors (Error ADTs)

Use `Data.TaggedError` for domain errors, `Schema.TaggedError` for boundary errors:

```typescript
import { Data, Schema as S } from "effect"

// Domain error (internal, no serialization needed)
class AuthError extends Data.TaggedError("AuthError")<{
    readonly reason: string
}> {}

// Boundary error (needs serialization across API/RPC)
class ApiError extends S.TaggedError<ApiError>()("ApiError", {
    statusCode: S.Number,
    message: S.String,
}) {}
```

---
## [4][PATTERN_MATCHING]
>**Dictum:** *Exhaustive matching guarantees every variant is handled -- missing a case is a compile error, not a runtime bug.*

<br>

### Match.type -- Matching on Types (reusable function)

```typescript
import { Match } from "effect"

type Shape =
    | { readonly _tag: "Circle"; readonly radius: number }
    | { readonly _tag: "Rectangle"; readonly width: number; readonly height: number }
    | { readonly _tag: "Triangle"; readonly base: number; readonly height: number }

const area = Match.type<Shape>().pipe(
    Match.tag("Circle", ({ radius }) => Math.PI * radius ** 2),
    Match.tag("Rectangle", ({ width, height }) => width * height),
    Match.tag("Triangle", ({ base, height }) => 0.5 * base * height),
    Match.exhaustive,
)
```

### Match.value -- Matching on Values (inline dispatch)

```typescript
import { Match } from "effect"

// Match.value for inline dispatch on a concrete value
const result = Match.value(response).pipe(
    Match.tag("Success", ({ body }) => renderBody(body)),
    Match.tag("NotFound", ({ path }) => render404(path)),
    Match.exhaustive,
)

// Match.value for predicates on primitives
const classify = (n: number) =>
    Match.value(n).pipe(
        Match.when((x) => x < 0, () => "negative" as const),
        Match.when((x) => x === 0, () => "zero" as const),
        Match.orElse(() => "positive" as const),
    )
```

### Match.withReturnType -- Enforcing Return Types

```typescript
const handler = Match.type<Event>().pipe(
    Match.withReturnType<Effect.Effect<void>>(),
    Match.tag("Click", (event) => handleClick(event)),
    Match.tag("Hover", (event) => handleHover(event)),
    Match.exhaustive,
)
```

### Match.tag with Multiple Tags

```typescript
// Handle multiple variants with a single handler
const handle = Match.type<Input>().pipe(
    Match.tag("A", "B", () => "A or B"),
    Match.tag("C", () => "C"),
    Match.exhaustive,
)
```

### Match Finalizers

| [INDEX] | [FINALIZER]        | [BEHAVIOR]                                            |
| :-----: | ------------------ | ----------------------------------------------------- |
|   [1]   | `Match.exhaustive` | Compile error if any variant is unhandled              |
|   [2]   | `Match.orElse`     | Fallback for unmatched cases (non-exhaustive)          |
|   [3]   | `Match.option`     | Returns `Option.some` on match, `Option.none` otherwise |
|   [4]   | `Match.either`     | Returns `Either.right` on match, `Either.left` otherwise |

### Match.type vs Match.value Decision

| [SCENARIO]                              | [USE]           | [WHY]                                      |
| --------------------------------------- | --------------- | ------------------------------------------ |
| Define a reusable matcher function       | `Match.type`    | Returns a function to apply later           |
| Dispatch on a value you already have     | `Match.value`   | Immediate inline dispatch, no function wrap |
| Predicate-based matching on primitives   | `Match.value`   | Predicates via `Match.when`                 |

---
## [5][EFFECT_COMPOSITION]
>**Dictum:** *Consistent combinator selection communicates intent.*

<br>

| [INDEX] | [COMBINATOR]     | [WHEN]                                               | [SIGNATURE]                                   |
| :-----: | ---------------- | ---------------------------------------------------- | --------------------------------------------- |
|   [1]   | `pipe()`         | Linear left-to-right composition                     | `pipe(input, f1, f2, ..., fN)`                |
|   [2]   | `Effect.map`     | Sync transform of success value (A -> B)             | `Effect<A, E, R> -> (A -> B) -> Effect<B, E, R>` |
|   [3]   | `Effect.flatMap` | Chain Effect-returning functions (A -> Effect\<B\>)  | `Effect<A, E, R> -> (A -> Effect<B, E2, R2>) -> Effect<B, E\|E2, R\|R2>` |
|   [4]   | `Effect.andThen` | Mixed input (value, Promise, Effect, Option, Either) | Accepts value, () -> value, Effect, () -> Effect |
|   [5]   | `Effect.tap`     | Side effects without changing value                  | `Effect<A, E, R> -> (A -> Effect<_, E2, R2>) -> Effect<A, E\|E2, R\|R2>` |
|   [6]   | `Effect.all`     | Aggregate independent effects into struct/tuple      | `{ a: Effect<A>, b: Effect<B> } -> Effect<{ a: A, b: B }>` |
|   [7]   | `Effect.gen`     | 3+ dependent operations or control flow              | `Effect.gen(function*() { const a = yield* ...; ... })` |
|   [8]   | `Effect.fn`      | Named function with automatic tracing span           | `Effect.fn('Service.method')((...args) => pipe(...))` |
|   [9]   | `Match.type`     | Exhaustive pattern matching on discriminated unions   | `Match.type<T>().pipe(Match.tag(...), Match.exhaustive)` |

### Composition Decision Tree

```
Need to branch on variant type?
  YES -> Match.type().pipe(Match.tag(...), Match.exhaustive)
  NO  -> Need 3+ sequential dependent operations?
           YES -> Effect.gen(function*() { ... })
           NO  -> Need traced service method?
                    YES -> Effect.fn('Name.method')
                    NO  -> pipe(effect, Effect.map/flatMap/andThen)
```

### Composition Rules

- `pipe()` for linear flows; `Effect.gen` for 3+ dependent operations or control flow.
- `Effect.fn('Service.method')` for service methods in `packages/server/src/` (lightweight span).
- `Telemetry.span('name', opts)` for route handlers in `apps/api/src/routes/` (adds request context, error annotation, metrics).
- `Telemetry.routeSpan('name')` shorthand for `Telemetry.span(name, { kind: 'server', metrics: false })`.
- `Effect.all({ ... })` for independent effects; never sequential when no dependency exists.

[CRITICAL]:
- [NEVER] Mix `async/await` with Effect -- use `Effect.promise` for interop.
- [NEVER] Ignore effects in `flatMap` chains -- all must contribute to result.
- [NEVER] Wrap pure `A -> B` functions in Effect -- Effect orchestrates, domain computes.
- [NEVER] Use `Effect.fn` in route handlers -- use `Telemetry.routeSpan`.
- [NEVER] Use `Telemetry.span` in service methods -- use `Effect.fn`.

---
## [6][TYPE_DISCIPLINE]
>**Dictum:** *Fewer, more powerful types reduce API surface. Derive, do not duplicate.*

<br>

| [INDEX] | [PATTERN]               | [SYNTAX]                                  | [WHEN]                          |
| :-----: | ----------------------- | ----------------------------------------- | ------------------------------- |
|   [1]   | Schema-derived type     | `type X = typeof XSchema.Type`            | All domain types                |
|   [2]   | Table-derived type      | `type User = typeof users.$inferSelect`   | Database models                 |
|   [3]   | Branded type            | `S.String.pipe(S.brand('UserId'))`        | Domain primitives               |
|   [4]   | `satisfies` validation  | `const x = { ... } satisfies Config`      | Validate shape, preserve literal |
|   [5]   | `as const` immutability | `const CONFIG = { ... } as const`         | Immutable config objects        |
|   [6]   | `using` keyword         | `using handle = yield* resource`          | Deterministic resource cleanup  |
|   [7]   | Const type parameters   | `function f<const T>(x: T)`              | Preserve literal types          |
|   [8]   | `Schema.Class`          | `class User extends S.Class<...>()`       | Schema-coupled classes          |
|   [9]   | `Schema.TaggedError`    | `class Err extends S.TaggedError<...>()` | Serializable boundary errors    |
|  [10]   | `Data.TaggedError`      | `class Err extends Data.TaggedError(...)` | Internal domain errors          |
|  [11]   | `Data.TaggedEnum`       | `Data.taggedEnum<MyEnum>()`               | Sum types with pattern matching |
|  [12]   | Conditional types       | `T extends U ? X : Y`                    | Type-level dispatch             |
|  [13]   | Mapped types            | `{ [K in keyof T]: ... }`                | Type-level transformations      |
|  [14]   | Template literal types  | `` `prefix${T}` ``                        | Type-safe string construction   |

[CRITICAL]:
- [NEVER] Create type aliases adding no semantic value.
- [NEVER] Use `Object.freeze` -- `as const` suffices.
- [NEVER] Declare types separately from schemas -- extract, do not duplicate.
- [NEVER] Use `string` for domain identifiers -- use branded types.
- [NEVER] Use string literal unions for variants with associated data -- use `Data.TaggedEnum`.

---
## [7][SERVICE_ARCHITECTURE]
>**Dictum:** *Services declare interfaces; Layers provide implementations. Dependencies flow through the type system.*

<br>

### Service Definition

```typescript
import { Context, Effect, Layer } from "effect"

class UserRepository extends Context.Tag("UserRepository")<
    UserRepository,
    {
        readonly findById: (id: UserId) => Effect.Effect<User, UserNotFound>
        readonly save: (user: User) => Effect.Effect<void, DatabaseError>
    }
>() {}
```

### Service Implementation via Layer

```typescript
const UserRepositoryLive = Layer.effect(
    UserRepository,
    Effect.gen(function* () {
        const sql = yield* SqlClient
        return {
            findById: Effect.fn("UserRepo.findById")(
                (id) => pipe(
                    sql`SELECT * FROM users WHERE id = ${id}`,
                    Effect.flatMap(Schema.decodeUnknown(UserSchema)),
                    Effect.mapError(() => new UserNotFound({ id })),
                ),
            ),
            save: Effect.fn("UserRepo.save")(
                (user) => pipe(
                    sql`INSERT INTO users ${sql.insert(user)}`,
                    Effect.mapError((cause) => new DatabaseError({ cause })),
                ),
            ),
        }
    }),
)
```

### Service Usage

```typescript
const program = Effect.gen(function* () {
    const repo = yield* UserRepository
    const user = yield* repo.findById(userId)
    return user
})

// Provide at composition root
const runnable = Effect.provide(program, UserRepositoryLive)
```

### Rules

- Service methods return `Effect<Success, Error, never>` -- no dependency leakage into interface.
- Dependencies are managed through Layer construction, not service interfaces.
- `Live` suffix for production layers, `Test` for test doubles.
- Provide all layers once at application entry point via `Layer.merge` / `Layer.compose`.

---
## [8][ERROR_HANDLING]
>**Dictum:** *Errors are values in the type signature, not exceptions thrown into the void.*

<br>

### Error Definition

```typescript
// Internal domain errors
class UserNotFound extends Data.TaggedError("UserNotFound")<{
    readonly id: UserId
}> {}

class AuthExpired extends Data.TaggedError("AuthExpired")<{
    readonly expiredAt: Date
}> {}

// Boundary errors (API, RPC -- needs serialization)
class ApiValidationError extends S.TaggedError<ApiValidationError>()(
    "ApiValidationError",
    { fields: S.Array(S.String), message: S.String },
) {}
```

### Error Recovery

```typescript
// Catch specific error by tag
const withFallback = program.pipe(
    Effect.catchTag("UserNotFound", (error) =>
        Effect.succeed(defaultUser),
    ),
)

// Catch multiple errors at once
const withRecovery = program.pipe(
    Effect.catchTags({
        UserNotFound: (error) => Effect.succeed(defaultUser),
        AuthExpired: (error) => refreshAndRetry,
    }),
)

// Transform domain errors to HTTP errors at boundary with exhaustive matching
const httpProgram = domainProgram.pipe(
    Effect.mapError((error) =>
        Match.value(error).pipe(
            Match.tag("UserNotFound", (error) => HttpError.NotFound.of("user", error.id)),
            Match.tag("DatabaseError", (error) => HttpError.Internal.of("Database failure", error.cause)),
            Match.exhaustive,
        ),
    ),
)
```

### Rules

- Keep error unions small: 3-5 variants per service boundary.
- `Data.TaggedError` for internal domain errors (recoverable, ergonomic `catchTag`).
- `Schema.TaggedError` when errors cross API/RPC boundaries (needs serialization).
- Never catch and re-throw -- use `Effect.mapError` to transform error types.
- Never use `Effect.catchAll` to silence errors -- handle each variant explicitly.
- Use `Match.value` with `Match.exhaustive` inside `mapError` for provably complete error mapping.

---
## [9][OPTION_AND_EITHER]
>**Dictum:** *Null is a billion-dollar mistake. Option and Either encode absence and failure in the type system.*

<br>

```typescript
import { Option, Either, pipe } from "effect"

// Replace null checks with Option
const findUser = (id: string): Option.Option<User> =>
    pipe(
        users.get(id),
        Option.fromNullable,
    )

// Chain optional computations
const userName = pipe(
    findUser("123"),
    Option.map((user) => user.name),
    Option.getOrElse(() => "Anonymous"),
)

// Either for synchronous fallible computations
const parseJson = (raw: string): Either.Either<JsonData, ParseError> =>
    Either.try({
        try: () => JSON.parse(raw) as JsonData,
        catch: (error) => new ParseError({ cause: error }),
    })
```

---
## [10][LIBRARIES]
>**Dictum:** *External libraries eliminate hand-rolled utilities.*

<br>

| [INDEX] | [PACKAGE]               | [KEY_IMPORTS]                            | [WHEN]                               |
| :-----: | ----------------------- | ---------------------------------------- | ------------------------------------ |
|   [1]   | `effect`                | `Effect`, `Schema as S`, `Match`, `pipe` | Core composition                     |
|   [2]   | `@effect/platform`      | `HttpClient`, `FileSystem`, `Path`       | Platform IO                          |
|   [3]   | `@effect/sql`           | `SqlClient`, `Statement`                 | Database access                      |
|   [4]   | `@effect/opentelemetry` | `NodeSdk`, `Resource`                    | Tracing                              |
|   [5]   | `@effect/experimental`  | `Machine`, `VariantSchema`               | Server-side state machines           |
|   [6]   | `@effect/cluster`       | `ShardManager`, `Sharding`               | Distributed coordination             |
|   [7]   | `@effect/workflow`      | `Workflow`, `Activity`                   | Durable execution                    |
|   [8]   | `@effect/rpc`           | `Router`, `Resolver`                     | Type-safe RPC                        |
|   [9]   | `ts-toolbelt`           | `O.Merge`, `L.Concat`                    | Type-level ops (quarantine)          |
|  [10]   | `type-fest`             | `Simplify`, `LiteralUnion`               | Public API readability               |

**Common `effect` imports:** `Match`, `Data`, `Duration`, `Layer`, `Option`, `Order`, `pipe`, `Record`, `Schedule`, `Schema as S`, `Metric`, `Redacted`, `Effect`, `Array as A`, `Chunk`, `Either`, `Stream`, `STM`, `TMap`, `Encoding`, `Cache`, `Config`, `HashMap`, `HashSet`, `Predicate`, `Scope`, `Cause`, `Context`.

---
## [11][PLATFORM_INTEGRATION]
>**Dictum:** *Monorepo services provide canonical implementations.*

<br>

| [INDEX] | [CONCERN]   | [CANONICAL_SOURCE]                              | [RULE]                                             |
| :-----: | ----------- | ----------------------------------------------- | -------------------------------------------------- |
|   [1]   | Caching     | `packages/server/src/platform/cache.ts`         | Use CacheService; no custom cache                  |
|   [2]   | Resilience  | `packages/server/src/utils/resilience.ts`       | Use for retry, circuit, bulkhead, timeout          |
|   [3]   | Tracing     | `packages/server/src/observe/telemetry.ts`      | `Telemetry.span` for routes; `Effect.fn` internal  |
|   [4]   | Metrics     | `packages/server/src/observe/metrics.ts`        | Domain-specific metrics; generic as fallback       |
|   [5]   | Context     | `packages/server/src/context.ts`                | Propagate `Context.Request` in all effects         |
|   [6]   | Middleware  | `packages/server/src/middleware.ts`             | Follow header/cookie/auth/tenant patterns          |

---
## [12][FILE_LAYOUT]
>**Dictum:** *Section separators enable rapid navigation.*

<br>

**Canonical order** (omit unused): Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export.

```typescript
// --- [TYPES] -----------------------------------------------------------------
// --- [SCHEMA] ----------------------------------------------------------------
// --- [CONSTANTS] -------------------------------------------------------------
// --- [ERRORS] ----------------------------------------------------------------
// --- [SERVICES] --------------------------------------------------------------
// --- [FUNCTIONS] -------------------------------------------------------------
// --- [LAYERS] ----------------------------------------------------------------
// --- [EXPORT] ----------------------------------------------------------------
```

**Domain Extensions** (insert after corresponding core section):
- Database: `[TABLES]` (after SCHEMA), `[REPOSITORIES]` (after SERVICES)
- API: `[GROUPS]` (after SCHEMA), `[MIDDLEWARE]` (after SERVICES)

**FORBIDDEN labels:** `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.

---
## [13][FORBIDDEN_PATTERNS]
>**Dictum:** *Recognizing forbidden patterns prevents regression to stringly-typed, non-exhaustive code.*

<br>

| [INDEX] | [FORBIDDEN]                                        | [REPLACEMENT]                                            | [WHY]                                            |
| :-----: | -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
|   [1]   | `Record<string, () => void>` (dispatch table)      | `Match.type` or `Data.TaggedEnum.$match`                 | Stringly-typed, no exhaustive check, silent fail |
|   [2]   | `if (x._tag === 'A') ... else if ...`              | `Match.type<T>().pipe(Match.tag(...), Match.exhaustive)` | Not exhaustive, not composable                   |
|   [3]   | `switch (x._tag) { case ... }`                     | `Match.type` with `Match.exhaustive`                     | No exhaustive check unless `never` guard added   |
|   [4]   | `type Status = 'active' \| 'inactive'` (with behavior) | `Data.TaggedEnum` when variants carry data/behavior      | Cannot carry per-variant data                    |
|   [5]   | `throw new Error('msg')`                           | `Effect.fail(new MyTaggedError({ ... }))`                | Untyped, uncatchable by tag                      |
|   [6]   | `if (x !== null && x !== undefined)`               | `Option.fromNullable(x).pipe(Option.map(...))`           | Not composable, null leaks                       |
|   [7]   | `let result = []; for ... push`                    | `items.map(transform)` or `Effect.forEach`               | Mutation, not composable                         |
|   [8]   | `function isX(v): v is X { ... }`                  | `Schema.is(XSchema)` derived from schema                 | Manual guard drifts from schema                  |
|   [9]   | `async function f() { ... }`                       | `Effect.fn('f')((...args) => Effect.gen(...))`            | No typed errors, no dependency injection         |
|  [10]   | `class X extends Base { ... }`                     | `Effect.Service` + `Layer`                               | Inheritance couples, Layer composes              |
|  [11]   | `string` for domain identifiers                    | `Schema.brand('UserId')` for branded types               | No nominal distinction, argument swapping bugs   |
|  [12]   | Separate `type X` alongside `Schema X`             | `type X = typeof XSchema.Type`                           | Dual definitions drift silently                  |

---
## [14][VALIDATION]
>**Dictum:** *Gates prevent non-compliant output.*

<br>

[VERIFY]:
- [ ] No `any`, `let`/`var`, `for`/`while`, `try/catch`, default exports, barrel files.
- [ ] No dispatch tables for behavioral branching -- only `Match.type`/`Match.value` or `Data.TaggedEnum.$match`.
- [ ] No `if/else if` chains on discriminant fields -- `Match.type` with `Match.exhaustive` only.
- [ ] No `switch` statements -- `Match.type`/`Match.value` only.
- [ ] No plain `string` for domain identifiers -- branded types via `Schema.brand` only.
- [ ] Types derived from schemas/tables -- no duplicate type declarations.
- [ ] Effect combinators match table in [5] -- `pipe` for linear, `gen` for 3+, `fn` for traced.
- [ ] Errors use `Data.TaggedError` or `Schema.TaggedError` -- no string errors or generic `Error`.
- [ ] Nullable values use `Option` -- no `null`/`undefined` checks.
- [ ] Platform integration uses canonical sources from [11] -- no custom cache, retry, or tracing.
- [ ] File layout follows section separator order from [12].
- [ ] All exports in `[EXPORT]` section -- no inline exports.
- [ ] Service methods have no dependency leakage (`R = never`).
- [ ] Error mapping at boundaries uses `Match.value` + `Match.exhaustive` inside `mapError`.

[REFERENCE]: [patterns.md](./references/patterns.md) -- 25 concrete BAD/GOOD pattern pairs
[REFERENCE]: [repo-conventions.md](./references/repo-conventions.md) -- Sources of truth
