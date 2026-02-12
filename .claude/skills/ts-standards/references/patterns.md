# [H1][PATTERNS]
>**Dictum:** *Concrete BAD/GOOD pairs anchor abstract standards to compilable code. Algebraic precision eliminates entire categories of bugs.*

<br>

Pattern reference with 22 BAD/GOOD pairs organized by domain. Every behavioral branching pattern uses exhaustive matching. Every sum type uses tagged enums. Every error uses tagged errors. Every domain primitive uses brands.

**Sources:**
- [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)
- [Effect Data Module](https://effect.website/docs/data-types/data/)
- [Effect Error Management](https://effect.website/docs/error-management/expected-errors/)
- [Effect Building Pipelines](https://effect.website/docs/getting-started/building-pipelines/)
- [Effect Services](https://effect.website/docs/requirements-management/services/)
- [Effect Layers](https://effect.website/docs/requirements-management/layers/)
- [Effect Schema](https://effect.website/docs/schema/basic-usage/)
- [Effect Schema Advanced](https://effect.website/docs/schema/advanced-usage/)
- [Effect Branded Types](https://effect.website/docs/code-style/branded-types/)
- [TypeScript 6.0 Release Notes](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/)

---

# ALGEBRAIC DATA TYPES

---
## [1][SUM_TYPES_VIA_TAGGED_ENUM]
>**Dictum:** *String literal unions cannot carry per-variant data. Tagged enums encode data and behavior together.*

<br>

### BAD -- String literal union with side-channel data

```typescript
type Status = "active" | "inactive" | "pending"

// Per-variant data must be passed separately -- not associated with the variant.
// Adding a new variant produces no compile error in consumers.
const statusMessage = (status: Status, reason?: string): string => {
    if (status === "active") return "Active"
    if (status === "inactive") return "Inactive"
    return `Pending: ${reason ?? "unknown"}`  // reason only relevant for pending
}
```

### GOOD -- Data.TaggedEnum with per-variant data and exhaustive matching

```typescript
import { Data } from "effect"

type Status = Data.TaggedEnum<{
    Active: {}
    Inactive: { readonly since: Date }
    Pending: { readonly reason: string }
}>

const Status = Data.taggedEnum<Status>()

// Exhaustive matching via $match -- compiler FORCES handling every variant
const statusMessage = Status.$match({
    Active: () => "Active",
    Inactive: ({ since }) => `Inactive since ${since.toISOString()}`,
    Pending: ({ reason }) => `Pending: ${reason}`,
})

// Type-safe construction -- reason is required for Pending, forbidden for Active
const pending = Status.Pending({ reason: "awaiting approval" })
const active = Status.Active()

// Type guard via $is -- narrows to specific variant
const isPending = Status.$is("Pending")
isPending(pending) // true, narrowed to { _tag: "Pending"; reason: string }
```

**WHY:** String unions are flat -- they cannot carry per-variant data, so auxiliary parameters leak into function signatures. TaggedEnum associates data with each variant at the type level. The `$match` method provides exhaustive pattern matching (adding a variant without a handler is a compile error), and `$is` provides type guards -- all generated from the type definition. Structural equality comes for free via the Data module.

**SOURCE:** [Effect Data Module](https://effect.website/docs/data-types/data/)

---
## [2][GENERIC_SUM_TYPES]
>**Dictum:** *TaggedEnum.WithGenerics enables polymorphic sum types that carry type parameters through variants.*

<br>

### BAD -- Separate types losing the relationship between variants

```typescript
// No shared type -- callers must use `Success<T> | Failure<E>` manually everywhere.
// No exhaustive matching. No structural equality.
type Success<T> = { readonly kind: "success"; readonly value: T }
type Failure<E> = { readonly kind: "failure"; readonly error: E }
type Result<E, T> = Success<T> | Failure<E>
```

### GOOD -- Data.TaggedEnum with generics

```typescript
import { Data } from "effect"

type ApiResult<E, A> = Data.TaggedEnum<{
    Success: { readonly value: A }
    Failure: { readonly error: E }
    Loading: {}
}>

interface ApiResultDefinition extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: ApiResult<this["A"], this["B"]>
}

const ApiResult = Data.taggedEnum<ApiResultDefinition>()

// Constructors infer generics from arguments
const ok = ApiResult.Success({ value: 42 })       // ApiResult<never, number>
const fail = ApiResult.Failure({ error: "oops" })  // ApiResult<string, never>
const loading = ApiResult.Loading()                 // ApiResult<never, never>

// $match works with full generic inference
const describe = ApiResult.$match({
    Success: ({ value }) => `Got: ${value}`,
    Failure: ({ error }) => `Failed: ${error}`,
    Loading: () => "Loading...",
})
```

**WHY:** Generic TaggedEnums carry type parameters through every variant, enabling polymorphic data modeling. The `WithGenerics` interface lets the compiler track up to N type parameters across constructors, guards, and matchers. Without generics, each concrete instantiation requires a separate type definition, losing the algebraic relationship between variants.

**SOURCE:** [Effect Data Module](https://effect.website/docs/data-types/data/)

---
## [3][PRODUCT_TYPES_VIA_SCHEMA]
>**Dictum:** *Schema.Struct defines product types with validation, branding, and type derivation in a single declaration.*

<br>

### BAD -- Separate type and schema that drift

```typescript
// Type and schema can drift -- adding a field to one but not the other is silent.
interface User {
    id: string
    name: string
    email: string
}

const UserSchema = S.Struct({
    id: S.String,
    name: S.String,
    email: S.String,
    role: S.String, // Added to schema but not interface -- silent mismatch
})
```

### GOOD -- Type derived from schema with brands

```typescript
import { Schema as S } from "effect"

const UserSchema = S.Struct({
    id: S.String.pipe(S.brand("UserId")),
    name: S.String.pipe(S.nonEmptyString()),
    email: S.String.pipe(S.pattern(/@/), S.brand("Email")),
    role: S.Literal("admin", "member", "guest"),
})

// Single source of truth -- type is always in sync with schema
type User = typeof UserSchema.Type
// { id: string & Brand<"UserId">; name: string; email: string & Brand<"Email">; role: "admin" | "member" | "guest" }
```

**WHY:** Separate type declarations create a maintenance burden and drift silently. Deriving types from schemas guarantees the type always reflects the actual validation constraints. Adding a field to the schema automatically updates the type. Brands on `id` and `email` prevent accidentally swapping them -- the compiler catches `findUser(email)` when `findUser(id: UserId)` is expected.

**SOURCE:** [Effect Schema](https://effect.website/docs/schema/basic-usage/)

---

# EXHAUSTIVE PATTERN MATCHING

---
## [4][DISPATCH_TABLE_VS_MATCH]
>**Dictum:** *Dispatch tables are stringly-typed maps that fail silently on missing keys. Match is exhaustive at compile time.*

<br>

### BAD -- Dispatch table for behavioral branching

```typescript
// Stringly-typed: no compile error if a variant is added but not handled.
// Silent undefined on missing key. No type narrowing in handlers.
const _handlers: Record<string, (event: AppEvent) => void> = {
    click: (event) => handleClick(event),
    hover: (event) => handleHover(event),
    scroll: (event) => handleScroll(event),
}

const dispatch = (event: AppEvent) => {
    const handler = _handlers[event.type]
    if (handler) handler(event) // Runtime check -- can forget to add new variants
}
```

### GOOD -- Match.type for exhaustive behavioral branching

```typescript
import { Match } from "effect"

type AppEvent =
    | { readonly _tag: "Click"; readonly x: number; readonly y: number }
    | { readonly _tag: "Hover"; readonly target: string }
    | { readonly _tag: "Scroll"; readonly delta: number }

// Compile error if any _tag variant is unhandled.
// Full type narrowing in each branch -- x, y only available in Click.
const handle = Match.type<AppEvent>().pipe(
    Match.tag("Click", ({ x, y }) => console.log(`click at ${x},${y}`)),
    Match.tag("Hover", ({ target }) => console.log(`hover on ${target}`)),
    Match.tag("Scroll", ({ delta }) => console.log(`scroll ${delta}px`)),
    Match.exhaustive,
)
```

**PROGRESSION:** When deciding between approaches, follow this hierarchy:
1. **Pure data lookup** (`Record<string, string>`) -- static key-to-value with no behavior (HTTP status codes, error labels). Allowed.
2. **Match.type / Match.value** -- any behavioral branching on discriminated unions. Required for functions, Effects, or any logic per variant.

**WHY:** Dispatch tables are `Record<string, handler>` -- the key is an untyped string, so adding a new variant to the union produces no compile error. The lookup returns `T | undefined`, requiring a runtime null check that can be forgotten. Match.type with Match.exhaustive produces a compile error the instant a variant is added but not handled. Each branch gets full type narrowing.

**SOURCE:** [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)

---
## [5][IF_ELIF_VS_MATCH]
>**Dictum:** *If/else chains on discriminant fields are non-exhaustive -- the compiler cannot verify all variants are covered.*

<br>

### BAD -- If/else chain on discriminant

```typescript
const describe = (shape: Shape): string => {
    if (shape._tag === "Circle") {
        return `Circle r=${shape.radius}`
    } else if (shape._tag === "Rectangle") {
        return `Rect ${shape.width}x${shape.height}`
    } else {
        // What if Triangle is added? No compile error.
        return "Unknown"
    }
}
```

### GOOD -- Match.type with exhaustive

```typescript
import { Match } from "effect"

type Shape =
    | { readonly _tag: "Circle"; readonly radius: number }
    | { readonly _tag: "Rectangle"; readonly width: number; readonly height: number }
    | { readonly _tag: "Triangle"; readonly base: number; readonly height: number }

const describe = Match.type<Shape>().pipe(
    Match.tag("Circle", ({ radius }) => `Circle r=${radius}`),
    Match.tag("Rectangle", ({ width, height }) => `Rect ${width}x${height}`),
    Match.tag("Triangle", ({ base, height }) => `Tri b=${base} h=${height}`),
    Match.exhaustive,
)
```

**WHY:** The else branch in the BAD example silently swallows any new variant. Match.exhaustive makes the compiler verify every variant of the union is handled -- adding Triangle to the union without adding a Match.tag clause is a compile error.

**SOURCE:** [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)

---
## [6][SWITCH_VS_MATCH_EXHAUSTIVE]
>**Dictum:** *switch requires a manual never guard for exhaustiveness. Match.exhaustive enforces it automatically.*

<br>

### BAD -- switch with no exhaustive check

```typescript
const handle = (event: AppEvent): string => {
    switch (event._tag) {
        case "Click": return "clicked"
        case "Hover": return "hovered"
        // Adding "Scroll" to the union -- no compile error here!
        default: return "unknown"
    }
}
```

### GOOD -- Match.type with exhaustive

```typescript
import { Match } from "effect"

const handle = Match.type<AppEvent>().pipe(
    Match.tag("Click", () => "clicked"),
    Match.tag("Hover", () => "hovered"),
    Match.tag("Scroll", () => "scrolled"),
    Match.exhaustive, // Compile error if any variant is missing
)
```

**WHY:** switch with a default branch silently swallows new variants. Even the `never` guard technique (`const _: never = event`) is boilerplate-heavy and throws at runtime. Match.exhaustive provides a compile-time guarantee with zero boilerplate.

**SOURCE:** [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)

---
## [7][MATCH_VALUE_FOR_PRIMITIVES]
>**Dictum:** *Match.value operates on concrete values with predicate-based matching -- ideal for primitives and computed dispatch.*

<br>

### BAD -- Nested ternaries or if/else chains on primitive values

```typescript
const classify = (n: number): string => {
    if (n < 0) return "negative"
    if (n === 0) return "zero"
    if (n > 0) return "positive"
    return "unreachable" // Dead code, but compiler doesn't know
}
```

### GOOD -- Match.value with predicate-based matching

```typescript
import { Match } from "effect"

const classify = (n: number) =>
    Match.value(n).pipe(
        Match.when((x) => x < 0, () => "negative" as const),
        Match.when((x) => x === 0, () => "zero" as const),
        Match.orElse(() => "positive" as const),
    )
```

### GOOD -- Match.value on discriminated union value (inline)

```typescript
import { Match } from "effect"

// When you have a value in hand (not defining a reusable function)
const result = Match.value(response).pipe(
    Match.tag("Success", ({ body }) => renderBody(body)),
    Match.tag("Redirect", ({ location }) => redirect(location)),
    Match.tag("NotFound", ({ path }) => render404(path)),
    Match.exhaustive,
)
```

**WHY:** Match.value creates a matcher from a concrete value, enabling pattern matching inline without defining a reusable function. Match.type creates a reusable matcher function. Choose Match.value when you have a value and want immediate dispatch; choose Match.type when defining a named matcher function.

**SOURCE:** [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)

---
## [8][MATCH_ADVANCED_COMBINATORS]
>**Dictum:** *Match.whenOr, Match.whenAnd, Match.not, and Match.withReturnType compose fine-grained pattern matching constraints.*

<br>

### Match.whenOr -- Multiple patterns, single handler

```typescript
import { Match } from "effect"

type Input = { readonly _tag: "A" } | { readonly _tag: "B" } | { readonly _tag: "C" }

const handle = Match.type<Input>().pipe(
    Match.tag("A", "B", () => "A or B"),   // Match.tag supports multiple tags
    Match.tag("C", () => "C"),
    Match.exhaustive,
)
```

### Match.not -- Exclude specific patterns

```typescript
import { Match } from "effect"

const greet = Match.type<string>().pipe(
    Match.not("", () => "has content"),
    Match.orElse(() => "empty"),
)
```

### Match.withReturnType -- Enforce consistent return types

```typescript
import { Match, Effect } from "effect"

// Compiler enforces every branch returns Effect<void>
const handler = Match.type<AppEvent>().pipe(
    Match.withReturnType<Effect.Effect<void>>(),
    Match.tag("Click", (event) => handleClick(event)),
    Match.tag("Hover", (event) => handleHover(event)),
    Match.tag("Scroll", (event) => handleScroll(event)),
    Match.exhaustive,
)
```

### Match.instanceOf -- Class-based matching

```typescript
import { Match } from "effect"

const describe = (error: unknown) =>
    Match.value(error).pipe(
        Match.when(Match.instanceOf(TypeError), (err) => `Type: ${err.message}`),
        Match.when(Match.instanceOf(RangeError), (err) => `Range: ${err.message}`),
        Match.orElse(() => "Unknown error"),
    )
```

### Match Finalizers

| [INDEX] | [FINALIZER]        | [BEHAVIOR]                                            |
| :-----: | ------------------ | ----------------------------------------------------- |
|   [1]   | `Match.exhaustive` | Compile error if any variant is unhandled              |
|   [2]   | `Match.orElse`     | Fallback for unmatched cases (non-exhaustive)          |
|   [3]   | `Match.option`     | Returns `Option.some` on match, `Option.none` otherwise |
|   [4]   | `Match.either`     | Returns `Either.right` on match, `Either.left` otherwise |

**SOURCE:** [Effect Pattern Matching](https://effect.website/docs/code-style/pattern-matching/)

---

# TYPE-LEVEL PROGRAMMING

---
## [9][BRANDED_TYPES_AND_DOMAIN_PRIMITIVES]
>**Dictum:** *Branded types prevent primitive obsession -- impossible to pass a UserId where an Email is expected.*

<br>

### BAD -- Plain strings for domain identifiers

```typescript
// Both are string -- compiler cannot distinguish them.
// findUser(email, userId) compiles when it should be findUser(userId, email).
const findUser = (userId: string, email: string) => { /* ... */ }

const userId = "usr_123"
const email = "alice@example.com"
findUser(email, userId) // Compiles! Arguments swapped silently.
```

### GOOD -- Branded types via Schema.brand

```typescript
import { Schema as S } from "effect"

const UserId = S.String.pipe(
    S.pattern(/^usr_/),
    S.brand("UserId"),
)
type UserId = typeof UserId.Type  // string & Brand<"UserId">

const Email = S.String.pipe(
    S.pattern(/@/),
    S.maxLength(254),
    S.brand("Email"),
)
type Email = typeof Email.Type  // string & Brand<"Email">

const findUser = (userId: UserId, email: Email) => { /* ... */ }

// Compile error: Type 'string' is not assignable to type 'string & Brand<"UserId">'
// findUser("alice@example.com", "usr_123")

// Must decode through schema to obtain branded value
const validId = S.decodeUnknownSync(UserId)("usr_123")
const validEmail = S.decodeUnknownSync(Email)("alice@example.com")
findUser(validId, validEmail)  // Compiles -- brands match
```

**WHY:** Plain string identifiers are interchangeable -- the compiler treats all `string` values equally. Branded types create nominal distinctions at the type level. A `UserId` cannot be passed where an `Email` is expected, even though both are strings at runtime. Schema.brand combines validation (pattern, length) with branding in a single declaration. The brand is erased at runtime -- zero overhead.

**SOURCE:** [Effect Branded Types](https://effect.website/docs/code-style/branded-types/)

---
## [10][CONDITIONAL_TYPES_AS_TYPE_LEVEL_MATCHING]
>**Dictum:** *Conditional types are the type-level analog of pattern matching -- dispatch on type structure at compile time.*

<br>

### Type-level extraction via infer

```typescript
// Extract the success type from an Effect
type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

// Extract the error type from an Effect
type EffectError<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never

// Extract element type from Array or return the type itself
type Unwrap<T> = T extends ReadonlyArray<infer U> ? U : T
```

### Distributive conditional types

```typescript
// Distributes over unions: Extract<"a" | "b" | "c", "a" | "b"> = "a" | "b"
type OnlySuccess<T> = T extends { readonly _tag: "Success" } ? T : never

type HttpResponse =
    | { readonly _tag: "Success"; readonly body: string }
    | { readonly _tag: "NotFound"; readonly path: string }
    | { readonly _tag: "ServerError"; readonly cause: Error }

// OnlySuccess<HttpResponse> = { readonly _tag: "Success"; readonly body: string }
```

### Type-level predicates with template literals

```typescript
// Extract only routes starting with "/api/"
type ApiRoute<T extends string> = T extends `/api/${infer Rest}` ? Rest : never

type Routes = "/api/users" | "/api/orders" | "/health"
type ApiRoutes = ApiRoute<Routes>  // "users" | "orders"
```

**WHY:** Conditional types enable compile-time dispatch on type structure. Combined with `infer`, they extract components from complex types. Combined with template literal types, they parse string literal types at the type level. These patterns eliminate entire categories of runtime checks by moving validation to the compiler.

---
## [11][MAPPED_TYPES_FOR_TRANSFORMATIONS]
>**Dictum:** *Mapped types apply uniform transformations across object type properties -- the type-level analog of Array.map.*

<br>

### Derive readonly version of a mutable interface

```typescript
// Built-in Readonly<T> is a mapped type:
// type Readonly<T> = { readonly [K in keyof T]: T[K] }

// Make all properties of a service interface return Effects
type Effectful<T> = {
    readonly [K in keyof T]: T[K] extends (...args: infer A) => infer R
        ? (...args: A) => Effect.Effect<R, Error>
        : T[K]
}
```

### Key remapping with `as`

```typescript
// Create getter functions from a schema shape
type Getters<T> = {
    readonly [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K]
}

type UserGetters = Getters<{ name: string; age: number }>
// { readonly getName: () => string; readonly getAge: () => number }
```

### Filter properties by type

```typescript
// Extract only string properties from an object type
type StringProps<T> = {
    readonly [K in keyof T as T[K] extends string ? K : never]: T[K]
}
```

**WHY:** Mapped types derive new object types by transforming every property of an existing type. Combined with key remapping (`as`), conditional type filtering, and template literal key transformation, they enable sophisticated type-level metaprogramming. This eliminates hand-maintained parallel type declarations that drift from their source.

---
## [12][CONST_TYPE_PARAMETERS_AND_SATISFIES]
>**Dictum:** *const type parameters preserve literal types through generics. satisfies validates shape without widening.*

<br>

### BAD -- Type annotation widens literals

```typescript
// Type annotation widens 500 to number, 3 to number -- loses literal information
const config: { retryMs: number; maxRetries: number } = {
    retryMs: 500,
    maxRetries: 3,
}
```

### GOOD -- satisfies validates, as const preserves

```typescript
const _CONFIG = {
    retryMs: 500,
    maxRetries: 3,
    backoffMultiplier: 2,
} as const satisfies {
    readonly retryMs: number
    readonly maxRetries: number
    readonly backoffMultiplier: number
}

// _CONFIG.retryMs is typed as 500 (literal), not number
// _CONFIG is deeply readonly -- cannot be mutated
```

### GOOD -- const type parameters in generic functions

```typescript
// Without const: T is inferred as string[]
// With const: T is inferred as readonly ["admin", "member", "guest"]
const createRoles = <const T extends readonly string[]>(roles: T) => roles

const roles = createRoles(["admin", "member", "guest"])
// typeof roles = readonly ["admin", "member", "guest"]
// roles[0] is "admin" (literal), not string
```

### GOOD -- using keyword for resource management (TypeScript 6.0+)

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
    using handle = yield* acquireFileHandle(path)
    // handle is automatically disposed when scope exits
    const content = yield* readAll(handle)
    return content
})
```

**WHY:** Type annotations (`const x: T`) widen literal types to their base type, losing precision. `satisfies` validates the shape without widening, `as const` makes the value deeply immutable, and `const` type parameters preserve literal types through generic function boundaries. Together they give compile-time shape checking, runtime immutability, and full literal type preservation. The `using` keyword (TypeScript 6.0+) enables deterministic resource cleanup via `Symbol.dispose`.

**SOURCE:** [TypeScript 6.0 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-beta/)

---

# EFFECT COMPOSITION PATTERNS

---
## [13][LINEAR_PIPE_COMPOSITION]
>**Dictum:** *pipe reads left-to-right, replacing nested function calls with a linear pipeline.*

<br>

### BAD -- Nested function calls

```typescript
// Read inside-out: subtractTen(double(increment(5)))
const result = subtractTen(double(increment(5)))
```

### GOOD -- pipe composition

```typescript
import { pipe } from "effect"

const result = pipe(5, increment, double, subtractTen)
// Read left-to-right: 5 -> increment -> double -> subtractTen
```

### GOOD -- Effect pipe for effectful chains

```typescript
const program = pipe(
    fetchConfig,
    Effect.map((config) => config.connectionString),
    Effect.flatMap(connectToDatabase),
    Effect.tap((database) => Effect.log(`Connected to ${database.name}`)),
)
```

**WHY:** Nested calls read inside-out and become unreadable at depth > 2. pipe creates a linear left-to-right flow where each step receives the output of the previous step. For Effect chains, pipe composes map, flatMap, and tap in reading order.

**SOURCE:** [Effect Building Pipelines](https://effect.website/docs/getting-started/building-pipelines/)

---
## [14][CALLBACK_CHAIN_VS_EFFECT_GEN]
>**Dictum:** *Nested .then().catch() chains obscure control flow. Effect.gen reads top-to-bottom.*

<br>

### BAD -- Promise callback chain

```typescript
const processOrder = (orderId: string): Promise<Receipt> =>
    fetchOrder(orderId)
        .then((order) =>
            validateOrder(order)
                .then((validated) =>
                    chargePayment(validated.total)
                        .then((payment) =>
                            createReceipt(validated, payment)
                        )
                )
        )
        .catch((error) => {
            console.error(error) // Which error? What type? Unknown.
            throw error
        })
```

### GOOD -- Effect.gen with linear reading

```typescript
import { Effect } from "effect"

const processOrder = Effect.fn("Orders.process")(
    (orderId: string) =>
        Effect.gen(function* () {
            const order = yield* fetchOrder(orderId)
            const validated = yield* validateOrder(order)
            const payment = yield* chargePayment(validated.total)
            return yield* createReceipt(validated, payment)
        }),
)

// Type: Effect<Receipt, OrderNotFound | ValidationError | PaymentError, OrderService>
// Every error type is tracked. Every dependency is declared.
```

**WHY:** Promise chains nest rightward, obscure control flow, and erase error types into `unknown`. Effect.gen reads top-to-bottom like synchronous code, preserves the full error union in the type signature, and enables structured concurrency. Effect.fn adds automatic tracing.

**SOURCE:** [Effect Using Generators](https://effect.website/docs/getting-started/using-generators/)

---
## [15][EFFECT_FN_TRACING]
>**Dictum:** *Effect.fn adds automatic tracing spans to service methods. Telemetry.span adds full observability to route handlers.*

<br>

### BAD -- Bare function without tracing

```typescript
// No span, no trace, invisible to observability
const findUser = (id: UserId) =>
    pipe(
        sql`SELECT * FROM users WHERE id = ${id}`,
        Effect.flatMap(S.decodeUnknown(UserSchema)),
    )
```

### GOOD -- Effect.fn for service methods

```typescript
// Automatic span: "UserRepo.findById" in distributed trace
const findUser = Effect.fn("UserRepo.findById")(
    (id: UserId) =>
        pipe(
            sql`SELECT * FROM users WHERE id = ${id}`,
            Effect.flatMap(S.decodeUnknown(UserSchema)),
            Effect.mapError(() => new UserNotFound({ id })),
        ),
)
```

### GOOD -- Telemetry.routeSpan for route handlers

```typescript
// Full observability: request context, error annotation, metrics
const getUserRoute = Telemetry.routeSpan("GET /users/:id")
```

### Rules

| [CONTEXT]              | [USE]                            | [NOT]               |
| ---------------------- | -------------------------------- | ------------------- |
| Service method         | `Effect.fn('Name.method')`       | `Telemetry.span`    |
| Route handler          | `Telemetry.routeSpan`            | `Effect.fn`         |
| Pure function          | Neither                          | Either              |

**WHY:** Effect.fn provides lightweight tracing for internal service methods. Telemetry.span/routeSpan provides the full observability superset (request context, error annotation, metrics) for route handlers. Using the wrong one either loses context (Effect.fn in routes) or adds unnecessary overhead (Telemetry.span in services).

**SOURCE:** [Effect Tracing](https://effect.website/docs/observability/tracing/)

---
## [16][EFFECT_ALL_FOR_PARALLELISM]
>**Dictum:** *Effect.all aggregates independent effects into a struct -- never sequence what can run concurrently.*

<br>

### BAD -- Sequential independent operations

```typescript
const program = Effect.gen(function* () {
    const user = yield* fetchUser(userId)       // waits
    const settings = yield* fetchSettings(userId) // then waits again
    const metrics = yield* fetchMetrics(userId)   // then waits again
    return { metrics, settings, user }
})
```

### GOOD -- Effect.all for parallel aggregation

```typescript
const program = Effect.gen(function* () {
    const { metrics, settings, user } = yield* Effect.all({
        metrics: fetchMetrics(userId),
        settings: fetchSettings(userId),
        user: fetchUser(userId),
    }, { concurrency: "unbounded" })
    return { metrics, settings, user }
})
```

**WHY:** Sequential execution of independent effects wastes latency. Effect.all with concurrency runs all effects in parallel and returns a typed struct. The result is destructured with full type inference -- no manual type annotation needed. Use `{ concurrency: "unbounded" }` when all effects are independent, or `{ concurrency: N }` for bounded parallelism.

**SOURCE:** [Effect Building Pipelines](https://effect.website/docs/getting-started/building-pipelines/)

---

# SERVICE ARCHITECTURE

---
## [17][CLASS_HIERARCHY_VS_SERVICE_LAYER]
>**Dictum:** *Inheritance couples implementations. Layer composes independent services.*

<br>

### BAD -- Class inheritance hierarchy

```typescript
// Inheritance creates tight coupling. Cannot swap implementations for testing.
// Dependencies are hidden in constructor, not declared in types.
abstract class BaseService {
    protected db: Database
    constructor(db: Database) {
        this.db = db
    }
    abstract findAll(): Promise<Array<unknown>>
}

class UserService extends BaseService {
    async findAll(): Promise<Array<User>> {
        return this.db.query("SELECT * FROM users")
    }
}
```

### GOOD -- Service + Layer with dependency injection

```typescript
import { Context, Effect, Layer, Schema as S, pipe } from "effect"

class UserService extends Context.Tag("UserService")<
    UserService,
    {
        readonly findAll: Effect.Effect<Array<User>, DatabaseError>
        readonly findById: (id: UserId) => Effect.Effect<User, UserNotFound | DatabaseError>
    }
>() {}

const UserServiceLive = Layer.effect(
    UserService,
    Effect.gen(function* () {
        const sql = yield* SqlClient
        return {
            findAll: pipe(
                sql`SELECT * FROM users`,
                Effect.flatMap(S.decodeUnknown(S.Array(UserSchema))),
                Effect.mapError((cause) => new DatabaseError({ cause })),
            ),
            findById: Effect.fn("UserService.findById")(
                (id: UserId) =>
                    pipe(
                        sql`SELECT * FROM users WHERE id = ${id}`,
                        Effect.flatMap(S.decodeUnknown(UserSchema)),
                        Effect.mapError(() => new UserNotFound({ id })),
                    ),
            ),
        }
    }),
)

// Test double -- swap implementation without changing consumer code
const UserServiceTest = Layer.succeed(UserService, {
    findAll: Effect.succeed([testUser]),
    findById: (_id) => Effect.succeed(testUser),
})
```

**WHY:** Inheritance creates tight coupling between base and derived classes. Dependencies are hidden in constructors. Layer-based services declare dependencies in the type system, compose independently, and swap implementations (Live/Test) at the composition root without touching consumer code.

**SOURCE:** [Effect Services](https://effect.website/docs/requirements-management/services/) / [Effect Layers](https://effect.website/docs/requirements-management/layers/)

---

# ERROR MODELING

---
## [18][TRY_CATCH_VS_EFFECT_ERROR_CHANNEL]
>**Dictum:** *try/catch produces untyped errors invisible to the type system. Effect tracks errors in the type signature.*

<br>

### BAD -- try/catch with untyped errors

```typescript
// Error type is unknown -- caller cannot know what failures are possible.
const fetchUser = async (id: string): Promise<User> => {
    try {
        const response = await fetch(`/api/users/${id}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
    } catch (error) {
        throw new Error(`Failed to fetch user: ${error}`)
    }
}
```

### GOOD -- Effect error channel with tagged errors

```typescript
import { Effect, Data, Schema as S, pipe } from "effect"

class HttpError extends Data.TaggedError("HttpError")<{
    readonly status: number
    readonly message: string
}> {}

class ParseError extends Data.TaggedError("ParseError")<{
    readonly cause: unknown
}> {}

// Type signature declares exactly which errors can occur
const fetchUser = (id: string): Effect.Effect<User, HttpError | ParseError> =>
    pipe(
        Effect.tryPromise({
            try: () => fetch(`/api/users/${id}`),
            catch: (cause) => new HttpError({ status: 0, message: String(cause) }),
        }),
        Effect.flatMap((response) =>
            response.ok
                ? Effect.tryPromise({
                      try: () => response.json() as Promise<unknown>,
                      catch: (cause) => new ParseError({ cause }),
                  })
                : Effect.fail(new HttpError({ status: response.status, message: response.statusText })),
        ),
        Effect.flatMap(S.decodeUnknown(UserSchema)),
    )

// Caller can handle specific errors by tag
const withFallback = fetchUser("123").pipe(
    Effect.catchTag("HttpError", (error) =>
        error.status === 404 ? Effect.succeed(defaultUser) : Effect.fail(error),
    ),
)
```

**WHY:** try/catch erases the error type -- the caller sees `Promise<User>` with no information about what failures are possible. Effect tracks errors as `HttpError | ParseError` in the type signature, enabling `catchTag` for precise recovery. The compiler verifies that all error branches are handled.

**SOURCE:** [Effect Error Management](https://effect.website/docs/error-management/expected-errors/)

---
## [19][TAGGED_ERROR_DEFINITION]
>**Dictum:** *Data.TaggedError for domain errors; Schema.TaggedError for boundary errors. Both use _tag for catchTag.*

<br>

### BAD -- String errors and generic Error

```typescript
// Untyped: caller sees Promise<User> with no error information.
const fetchUser = async (id: string): Promise<User> => {
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id])
    if (!result) throw new Error("User not found")  // Which error? How to recover?
    return result
}
```

### GOOD -- Tagged errors with catchTag

```typescript
import { Data, Effect, pipe } from "effect"

class UserNotFound extends Data.TaggedError("UserNotFound")<{
    readonly id: string
}> {}

class DatabaseError extends Data.TaggedError("DatabaseError")<{
    readonly cause: unknown
}> {}

// Type signature: Effect<User, UserNotFound | DatabaseError>
const fetchUser = Effect.fn("UserRepo.findById")(
    (id: string) =>
        pipe(
            sql`SELECT * FROM users WHERE id = ${id}`,
            Effect.mapError((cause) => new DatabaseError({ cause })),
            Effect.flatMap((rows) =>
                rows.length > 0
                    ? Effect.succeed(rows[0] as User)
                    : Effect.fail(new UserNotFound({ id })),
            ),
        ),
)

// Precise error recovery by tag
const withFallback = fetchUser("123").pipe(
    Effect.catchTag("UserNotFound", () => Effect.succeed(guestUser)),
    // DatabaseError propagates -- not silenced
)
```

### GOOD -- Schema.TaggedError for boundary errors (from codebase)

```typescript
import { Schema as S } from "effect"
import { HttpApiSchema } from "@effect/platform"

// Boundary error -- serializable across API/RPC, annotated with HTTP status
class NotFound extends S.TaggedError<NotFound>()(
    "NotFound",
    {
        cause: S.optional(S.Unknown),
        id: S.optional(S.String),
        resource: S.String,
    },
    HttpApiSchema.annotations({ description: "Resource not found", status: 404 }),
) {
    static readonly of = (resource: string, id?: string, cause?: unknown) =>
        new NotFound({ cause, id, resource })
    override get message() {
        return this.id
            ? `NotFound: ${this.resource}/${this.id}`
            : `NotFound: ${this.resource}`
    }
}
```

**WHY:** `throw new Error(message)` produces untyped errors. Tagged errors appear in the type signature as `UserNotFound | DatabaseError`, enabling `catchTag` for precise recovery. Use `Data.TaggedError` for internal domain errors (no serialization needed). Use `Schema.TaggedError` when errors cross API/RPC boundaries (needs serialization, HTTP status annotation).

**SOURCE:** [Effect Error Management](https://effect.website/docs/error-management/expected-errors/)

---
## [20][ERROR_RECOVERY_PATTERNS]
>**Dictum:** *Errors are values that compose -- catchTag for single variant, catchTags for multiple, mapError to transform.*

<br>

### catchTag -- Single variant recovery

```typescript
const withFallback = program.pipe(
    Effect.catchTag("UserNotFound", (error) =>
        Effect.succeed(defaultUser),
    ),
)
```

### catchTags -- Multiple variant recovery

```typescript
const withRecovery = program.pipe(
    Effect.catchTags({
        UserNotFound: (error) => Effect.succeed(defaultUser),
        AuthExpired: (error) => refreshAndRetry,
    }),
)
```

### mapError -- Transform error type

```typescript
// Map domain error to HTTP error at service boundary
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
- Never catch and re-throw -- use `Effect.mapError` to transform error types.
- Never use `Effect.catchAll` to silence errors -- handle each variant explicitly.
- Use Match.value with Match.exhaustive inside mapError to ensure all domain errors map to HTTP errors.

**SOURCE:** [Effect Error Management](https://effect.website/docs/error-management/expected-errors/)

---

# FUNCTIONAL TRANSFORMS

---
## [21][MUTABLE_LOOP_VS_FUNCTIONAL_TRANSFORM]
>**Dictum:** *Mutable accumulation produces temporal coupling. Pure transforms are parallelizable and testable.*

<br>

### BAD -- Mutable accumulation with for loop

```typescript
let result: Array<string> = []
for (const user of users) {
    if (user.active) {
        result.push(user.name.toUpperCase())
    }
}
```

### GOOD -- Functional pipeline

```typescript
const result = users
    .filter((user) => user.active)
    .map((user) => user.name.toUpperCase())
```

### GOOD -- Effect.forEach for effectful transforms

```typescript
import { Effect } from "effect"

const results = Effect.forEach(userIds, (id) =>
    pipe(
        fetchUser(id),
        Effect.map((user) => user.name),
    ),
)
```

**WHY:** The mutable version uses `let`, `for`, and `push` -- three forbidden constructs. The functional version is a pure data pipeline with no mutation, no temporal coupling, and clear intent. Effect.forEach provides the same pattern for effectful operations with automatic error propagation.

**SOURCE:** [Effect Building Pipelines](https://effect.website/docs/getting-started/building-pipelines/)

---
## [22][NULL_CHECK_VS_OPTION]
>**Dictum:** *Null checks are non-composable boolean tests. Option is a composable functor.*

<br>

### BAD -- Null checks with early returns

```typescript
const getUserEmail = (userId: string): string | null => {
    const user = users.get(userId)
    if (user === null || user === undefined) return null
    const profile = user.profile
    if (profile === null || profile === undefined) return null
    return profile.email ?? null
}
```

### GOOD -- Option chain

```typescript
import { Option, pipe } from "effect"

const getUserEmail = (userId: string): Option.Option<string> =>
    pipe(
        Option.fromNullable(users.get(userId)),
        Option.flatMap((user) => Option.fromNullable(user.profile)),
        Option.map((profile) => profile.email),
    )

// Extract with default
const email = pipe(
    getUserEmail("123"),
    Option.getOrElse(() => "no-reply@example.com"),
)
```

**WHY:** Null checks create nested conditional chains that break composition. Each check is a potential `null` leak if forgotten. Option is a functor -- it composes via `map`, `flatMap`, and `getOrElse`. The type signature `Option<string>` declares absence explicitly, unlike `string | null` which can be accidentally dereferenced.

**SOURCE:** [Effect Data Types](https://effect.website/docs/data-types/option/)

---

# CODE ORGANIZATION

---
## [23][MANUAL_TYPE_GUARD_VS_SCHEMA_IS]
>**Dictum:** *Manual type guards drift from the schema they claim to validate. Schema.is derives guards from the single source of truth.*

<br>

### BAD -- Hand-rolled type guard

```typescript
// Must be manually kept in sync with UserSchema.
const isUser = (value: unknown): value is User =>
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as Record<string, unknown>).name === "string" &&
    "age" in value &&
    typeof (value as Record<string, unknown>).age === "number"
```

### GOOD -- Schema.is derived from schema

```typescript
import { Schema as S } from "effect"

const UserSchema = S.Struct({
    name: S.String,
    age: S.Number,
    email: S.String.pipe(S.pattern(/@/), S.brand("Email")),
})

type User = typeof UserSchema.Type

// Derived from schema -- always in sync. Validates ALL fields including email pattern.
const isUser = S.is(UserSchema)

isUser({ name: "Alice", age: 30, email: "alice@example.com" }) // true
isUser({ name: "Alice", age: 30, email: "not-an-email" })      // false
```

**WHY:** Manual type guards are a maintenance burden that silently drifts from the actual type definition. Schema.is derives the guard from the schema, ensuring it validates exactly the same constraints (including brands, patterns, and refinements). Single source of truth.

**SOURCE:** [Effect Schema](https://effect.website/docs/schema/basic-usage/)

---
## [24][INLINE_EXPORT_VS_EXPORT_SECTION]
>**Dictum:** *Inline exports scatter the public API across the file. The EXPORT section makes it scannable.*

<br>

### BAD -- Scattered inline exports

```typescript
export const fetchUser = Effect.fn("Users.fetch")(/* ... */)

// 100 lines later...

export const deleteUser = Effect.fn("Users.delete")(/* ... */)

// 50 lines later...

export type UserResponse = typeof UserResponseSchema.Type
```

### GOOD -- Export section at file end

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------

const fetchUser = Effect.fn("Users.fetch")(/* ... */)

const deleteUser = Effect.fn("Users.delete")(/* ... */)

// --- [EXPORT] ----------------------------------------------------------------

export {
    fetchUser,
    deleteUser,
    type UserResponse,
}
```

**WHY:** Inline exports scatter the public API across potentially hundreds of lines. A developer reading the file must scan the entire file to understand what is exported. The `[EXPORT]` section at file end provides a single location where the complete public API is visible at a glance.

**SOURCE:** Parametric Portal `CLAUDE.md` -- file organization conventions.

---
## [25][ASYNC_AWAIT_VS_EFFECT]
>**Dictum:** *async/await erases error types, hides dependencies, and lacks structured concurrency. Effect provides all three.*

<br>

### BAD -- async function

```typescript
// No typed errors. No dependency injection. No structured concurrency.
async function processOrder(orderId: string): Promise<Receipt> {
    const order = await fetchOrder(orderId)
    const validated = await validateOrder(order)
    const payment = await chargePayment(validated.total)
    return createReceipt(validated, payment)
}
```

### GOOD -- Effect.gen with full type information

```typescript
import { Effect } from "effect"

// All errors tracked. All dependencies declared. Structured concurrency built-in.
const processOrder = Effect.fn("Orders.process")(
    (orderId: string) =>
        Effect.gen(function* () {
            const order = yield* fetchOrder(orderId)
            const validated = yield* validateOrder(order)
            const payment = yield* chargePayment(validated.total)
            return yield* createReceipt(validated, payment)
        }),
)
// Type: Effect<Receipt, FetchError | ValidationError | PaymentError, OrderService | PaymentService>
```

**WHY:** async/await returns `Promise<T>` which erases the error channel (`catch` receives `unknown`), cannot declare service dependencies, and provides no structured concurrency. Effect.gen preserves the full `Effect<Success, Error, Requirements>` triple -- errors are typed, dependencies are declared, and cancellation/interruption are automatic.

**SOURCE:** [Effect Using Generators](https://effect.website/docs/getting-started/using-generators/)
