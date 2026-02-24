# [H1][COMPOSITION]
>**Dictum:** *Layer topology encodes dependency order; the type-checker enforces it. Composition root is the only place wiring happens.*

Cross-references: `services.md [1]` service anatomy + constructor modes -- `services.md [4]` layer assembly + test doubles -- `effects.md [2]` acquireRelease/pipe/flow -- `algorithms.md [1-4]` Stream/Chunk/Sink -- `concurrency.md [5]` fiber lifecycle + forkScoped.

---
## [1][LAYER_SEMANTICS]
>**Dictum:** *Layer<ROut, E, RIn> is a recipe -- shared by default, constructed once, torn down on scope exit.*

`Layer<ROut, E, RIn>` -- provides `ROut`, requires `RIn`, may fail with `E`.
Diamond-safe: when two consumers require the same dependency, the layer graph allocates it once.
Four construction modes on `Effect.Service`: `succeed`, `sync`, `effect`, `scoped` (see `services.md [1]`).
`Layer.scoped` pairs with `Effect.acquireRelease` -- resource allocated on construction, released on scope exit.
`Layer.effect` resolves deps without lifecycle management.
`Layer.succeed` provides a pure value with no acquisition, no error, no requirements.
`Layer.fail` constructs a layer that immediately fails -- useful for config validation gates.

```typescript
import { Context, Data, Duration, Effect, FiberRef, Layer, ManagedRuntime, Option, pipe, Schedule } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { SqlClient } from "@effect/sql"

// --- [ERRORS] ----------------------------------------------------------------
class PoolError extends Data.TaggedError("PoolError")<{
    readonly operation: string
    readonly cause:     unknown
}> {
    static readonly from = (operation: string) =>
        (cause: unknown) => new PoolError({ cause, operation })
}

// --- [SERVICES] --------------------------------------------------------------
// why: Layer.succeed -- pure synchronous config, no acquisition, R=never, E=never
class DeployConfig extends Effect.Service<DeployConfig>()("app/DeployConfig", {
    succeed: { mode: "cluster" as const, region: "us-east-1" },
}) {}

// why: Layer.fail -- gate: when required config is missing, layer construction fails immediately
const RequiredFeatureGate: Layer.Layer<never, PoolError> = Layer.fail(
    new PoolError({ operation: "feature-gate", cause: "FEATURE_X_DISABLED" }),
)
```

---
## [2][LAYER_COMPOSITION]
>**Dictum:** *provide feeds deps; provideMerge accumulates context; mergeAll groups independent peers.*

`Layer.provide` accepts a single layer or an **array** of layers -- feeds requirements, exposes only consumer output.
`Layer.provideMerge` retains both self and base outputs downstream -- canonical for tiered composition roots.
`Layer.mergeAll` groups independent peer layers at the same tier -- all outputs available.

```typescript
// --- [SERVICES] --------------------------------------------------------------
declare class Database extends Effect.Service<Database>()("app/Database", {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return { sql }
    }),
}) {}
declare class CacheClient extends Effect.Service<CacheClient>()("app/CacheClient", {
    scoped: Effect.gen(function* () {
        return { get: Effect.fn("Cache.get")((key: string) => Effect.succeed(Option.none())) }
    }),
}) {}
declare class EventBus extends Effect.Service<EventBus>()("app/EventBus", {
    dependencies: [Database.Default],
    effect: Effect.gen(function* () {
        const { sql } = yield* Database
        return { publish: Effect.fn("EventBus.publish")((payload: unknown) => Effect.void) }
    }),
}) {}
declare class SearchIndex extends Effect.Service<SearchIndex>()("app/SearchIndex", {
    dependencies: [Database.Default],
    effect: Effect.gen(function* () {
        const { sql } = yield* Database
        return { reindex: Effect.fn("Search.reindex")(() => Effect.void) }
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------
// provide(array) -- feeds multiple deps at once; Database shared across both consumers
const InfraLayer = Layer.mergeAll(Database.Default, CacheClient.Default)

// provideMerge -- retains all outputs for downstream tiers
const MidLayer = Layer.mergeAll(EventBus.Default, SearchIndex.Default)

// Tiered composition root: leaf -> mid -> top
// why: provideMerge ensures every tier's outputs remain available to subsequent tiers
const AppLayer = MidLayer.pipe(
    Layer.provideMerge(InfraLayer),
)
```

| [INDEX] | [COMBINATOR]         | [OUTPUT_INCLUDES]           | [USE_WHEN]                              |
| :-----: | -------------------- | --------------------------- | --------------------------------------- |
|   [1]   | `Layer.provide`      | consumer output only        | Feeding deps, discarding intermediates  |
|   [2]   | `Layer.provideMerge` | both self + base outputs    | Accumulating context in tiered chains   |
|   [3]   | `Layer.mergeAll`     | all layers (parallel merge) | Independent peer services at same tier  |
|   [4]   | `Layer.provide([])`  | consumer output only        | Feeding multiple deps via array literal |

---
## [3][DYNAMIC_LAYERS]
>**Dictum:** *Layer.unwrapEffect lifts runtime config into layer construction; Layer.unwrapScoped adds resource lifecycle to construction.*

`Layer.unwrapEffect` takes `Effect<Layer<ROut, E, RIn>, E2, RIn2>` and collapses to `Layer<ROut, E | E2, RIn | RIn2>`.
Canonical pattern: read config from Env, then construct platform resources with resolved values.
`Layer.unwrapScoped` takes `Effect<Layer, E, R | Scope>` -- construction itself acquires scoped resources.
`Layer.effectDiscard` / `Layer.scopedDiscard` -- fire-and-forget initialization (cache warming, subscription setup) that produces no service output.

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// Layer.unwrapEffect -- resolve config before constructing the database layer
// why: connection string is runtime config; Env must resolve before pool opens
const PlatformLayer = Layer.unwrapEffect(
    Effect.gen(function* () {
        const config = yield* DeployConfig
        return Layer.mergeAll(
            Database.Default,
            Layer.succeed(DeployConfig, config),
        )
    }),
)

// Layer.unwrapScoped -- construction acquires a scoped resource
// why: pool opened during layer construction, closed on scope exit
const ScopedPlatformLayer = Layer.unwrapScoped(
    Effect.gen(function* () {
        const config = yield* DeployConfig
        const handle = yield* Effect.acquireRelease(
            Effect.tryPromise({
                try:   () => connectExternal(config.region),
                catch: PoolError.from("connect"),
            }),
            (resource) => Effect.promise(() => resource.disconnect()),
        )
        return Layer.succeed(Database, Database.make({ sql: handle.client }))
    }),
)

// Layer.effectDiscard -- fire-and-forget init producing no service output
// why: cache warming runs at startup; no output added to context
const WarmCacheLayer: Layer.Layer<never, never, CacheClient> = Layer.effectDiscard(
    Effect.gen(function* () {
        const cache = yield* CacheClient
        yield* cache.get("warmup-key")
    }),
)

// Layer.scopedDiscard -- fire-and-forget init with scoped lifecycle
// why: background subscription torn down on scope exit; no output
const SubscriptionLayer: Layer.Layer<never, never, EventBus> = Layer.scopedDiscard(
    Effect.gen(function* () {
        const bus = yield* EventBus
        yield* Effect.addFinalizer(() => Effect.log("subscription torn down"))
        yield* bus.publish({ type: "system.startup" })
    }),
)
```

---
## [4][LAYER_RESILIENCE]
>**Dictum:** *Layer.retry handles transient construction failures; Layer.fresh breaks sharing for test isolation.*

`Layer.retry(layer, schedule)` retries failed layer construction using a `Schedule`.
`Layer.fresh(layer)` breaks memoization -- each use allocates a new instance. Reserved for test isolation.

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// Layer.retry -- resilient construction with exponential backoff
// why: database cold start may fail transiently; retry 5x over ~15s
const ResilientDb = Layer.retry(
    Database.Default,
    pipe(
        Schedule.exponential("500 millis", 2),
        Schedule.jittered,
        Schedule.intersect(Schedule.recurs(5)),
    ),
)

// Layer.fresh -- breaks sharing; new instance per use (test isolation only)
// why: each test gets its own database state; no cross-test contamination
const IsolatedDb = Layer.fresh(Database.Default)
```

---
## [5][CONTEXT_TAGS]
>**Dictum:** *Context.Tag is the typed service key; Context.Reference adds a default value -- no Layer needed for optional deps.*

`Context.Tag` -- raw typed key for manual DI (subsume via `Effect.Service` in production code).
`Context.Reference` -- tag that auto-resolves to a default value without requiring a Layer. Consumers can provide a Layer to override, or accept the default. Pattern for optional configuration that most consumers never customize.

```typescript
// --- [SERVICES] --------------------------------------------------------------
// Context.Reference -- optional dep with default; no Layer required to resolve
class LogLevel extends Context.Reference<LogLevel>()("app/LogLevel", {
    defaultValue: () => "info" as const,
}) {}

// why: LogLevel resolves to 'info' without any Layer; override via Layer.succeed
const withDebugLogging = Layer.succeed(LogLevel, "debug" as const)

// Consumer -- works with or without LogLevel in the layer graph
const logSomething = Effect.gen(function* () {
    const level = yield* LogLevel
    yield* Effect.log(`current level: ${level}`)
})
```

---
## [6][LAYER_SCOPED_FIBERREF]
>**Dictum:** *Layer.locally scopes FiberRef mutation to a layer subtree -- propagation without parameter drilling.*

`Layer.locally(fiberRef, value)(layer)` or `Layer.locally(layer, fiberRef, value)` -- sets a FiberRef
value visible only within the layer subtree. Fibers outside see the original value.
`Layer.memoize(layer)` produces `Effect<Layer<ROut, E, RIn>, never, Scope>` -- guarantees single
allocation across multiple `Effect.provide` calls. The `Scope` requirement ties the memoized
layer's lifetime to the enclosing scope.

```typescript
// --- [CONSTANTS] -------------------------------------------------------------
const _tenantRef = FiberRef.unsafeMake(Option.none<string>())

// --- [LAYERS] ----------------------------------------------------------------
// Layer.locally -- scope FiberRef to layer subtree
// why: system-level jobs execute with tenant='system'; application layers see their own tenant
const SystemScopedLayer = pipe(
    AppLayer,
    Layer.locally(_tenantRef, Option.some("system")),
)

// Layer.memoize -- single allocation across scopes (requires Scope)
// why: expensive resource allocated once; shared across multiple Effect.provide calls
const memoizedProgram = Effect.scoped(
    Effect.gen(function* () {
        const shared = yield* Layer.memoize(Database.Default)
        const resultA = yield* Effect.provide(someEffectA, shared)
        const resultB = yield* Effect.provide(someEffectB, shared)
        return { resultA, resultB }
    }),
)
```

---
## [7][APPLICATION_ENTRY]
>**Dictum:** *NodeRuntime.runMain + Layer.launch for servers; ManagedRuntime for embedded runtimes; Effect.provide for tests.*

`Layer.launch(layer)` returns `Effect<never, E, RIn>` -- self-scoped, stays open until interruption.
`NodeRuntime.runMain` handles SIGTERM/SIGINT and tears down all scoped resources.
`ManagedRuntime.make(layer)` constructs an embedded runtime synchronously.
`runtime.runFork(effect, options?)` returns `RuntimeFiber<A, E>` -- interop with non-Effect frameworks.
`runtime.runCallback(effect, options?)` -- fire-and-forget with optional exit handler.
`runtime.dispose()` / `runtime.disposeEffect` -- releases all layer resources.

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// Long-running server entry -- canonical pattern
// why: Layer.launch keeps scope open; runMain handles OS signals + teardown
NodeRuntime.runMain(Layer.launch(AppLayer).pipe(
    Effect.onInterrupt(() => Effect.log("graceful shutdown initiated")),
))

// --- [FUNCTIONS] -------------------------------------------------------------
// ManagedRuntime -- embedded runtime for CLI tools, worker threads, one-shot scripts
// why: non-Effect host needs to drive Effect programs; dispose guarantees resource cleanup
const embeddedWorkflow = Effect.gen(function* () {
    const runtime = yield* Effect.acquireRelease(
        Effect.sync(() => ManagedRuntime.make(AppLayer)),
        (managed) => managed.disposeEffect,
    )
    // runFork -- returns RuntimeFiber<A, E> for non-blocking interop
    const fiber = runtime.runFork(Effect.log("forked task"))
    // runCallback -- fire-and-forget with exit handler
    runtime.runCallback(Effect.log("background"), { onExit: (exit) => console.log("exited", exit) })
    // runPromise -- bridges to Promise for await-based callers
    yield* Effect.promise(() => runtime.runPromise(
        Effect.gen(function* () {
            const { reindex } = yield* SearchIndex
            yield* reindex()
        }),
    ))
})

// Test entry -- Effect.provide injects layer; scope auto-tears down
// why: no runtime plumbing in tests; layer provides all deps
const testEffect = Effect.gen(function* () {
    const bus = yield* EventBus
    yield* bus.publish({ type: "test.event" })
}).pipe(Effect.provide(AppLayer))
```

---
## [8][COMPOSITION_ROOT_PATTERN]
>**Dictum:** *One file owns the full layer graph -- tiered from leaf to top, linear provideMerge chain.*

Mirrors the real codebase: `PlatformLayer -> ServicesLayer -> RouteLayer -> ServerLayer`.
Each tier is `Layer.mergeAll` of peers; `Layer.provideMerge` chains tiers bottom-up.
`dependencies: [...]` on services auto-wires transitive deps into `X.Default` (see `services.md [1]`).

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// Tier 1: Platform -- leaf services with no deps
const PlatformLayer = Layer.mergeAll(
    DeployConfig.Default,
    Database.Default,
    CacheClient.Default,
)

// Tier 2: Infrastructure -- depends on platform
const InfraServices = Layer.mergeAll(
    EventBus.Default,
    SearchIndex.Default,
)

// Tier 3: Application -- full composition root
// why: provideMerge retains all outputs; downstream tiers can access any ancestor service
const CompositionRoot = InfraServices.pipe(
    Layer.provideMerge(PlatformLayer),
)

// Resilient variant -- retries platform layer construction on transient failure
const ResilientRoot = InfraServices.pipe(
    Layer.provideMerge(Layer.retry(
        PlatformLayer,
        pipe(Schedule.exponential("1 second"), Schedule.intersect(Schedule.recurs(3))),
    )),
)

// Entry point -- one line
NodeRuntime.runMain(Layer.launch(CompositionRoot))
```

---
## [9][RULES]

- [ALWAYS] `Layer.provide(dep)` to wire deps: `consumer.pipe(Layer.provide(dep))` -- accepts single or array.
- [ALWAYS] `Layer.provideMerge` at composition roots when downstream needs both tiers in context.
- [ALWAYS] `Layer.mergeAll` to group independent peers at the same tier.
- [ALWAYS] `Layer.unwrapEffect` when layer construction depends on runtime config (Env, feature flags).
- [ALWAYS] `Layer.unwrapScoped` when layer construction acquires scoped resources.
- [ALWAYS] `Layer.retry(layer, schedule)` for transient construction failures (DB cold start, network).
- [ALWAYS] `Layer.locally(ref, value)` to scope FiberRef mutation to a layer subtree.
- [ALWAYS] `NodeRuntime.runMain` + `Layer.launch` for long-running servers.
- [ALWAYS] `ManagedRuntime.make` for embedded runtimes; call `dispose()` on exit.
- [ALWAYS] `Effect.provide(layer)` in tests -- no runtime plumbing; scope auto-tears down.
- [ALWAYS] `Context.Reference` for optional deps with sensible defaults -- no Layer required.
- [ALWAYS] Rely on Layer sharing for diamond deps -- never duplicate leaf layers manually.
- [NEVER] `Effect.runPromise` / `Effect.runSync` inside application logic -- only at boundary.
- [NEVER] `Layer.fresh` outside test isolation -- breaks sharing, duplicates resource allocation.
- [NEVER] `process.on("SIGTERM")` for shutdown -- `NodeRuntime.runMain` handles signals.
- [NEVER] Wrap `Layer.launch` in `Effect.scoped` -- launch manages its own scope.
- [NEVER] Omit `dispose()` on short-lived `ManagedRuntime` -- causes resource leaks.

---
## [10][QUICK_REFERENCE]

| [INDEX] | [API]                                | [SIGNATURE_SUMMARY]                                 | [USE_WHEN]                              |
| :-----: | ------------------------------------ | --------------------------------------------------- | --------------------------------------- |
|   [1]   | `Layer.succeed(Tag, value)`          | `Layer<ROut, never, never>`                         | Pure value service, no acquisition      |
|   [2]   | `Layer.fail(error)`                  | `Layer<never, E, never>`                            | Config validation gate                  |
|   [3]   | `Layer.unwrapEffect(effect)`         | `Effect<Layer> -> Layer`                            | Dynamic layer from runtime config       |
|   [4]   | `Layer.unwrapScoped(effect)`         | `Effect<Layer, E, R \| Scope> -> Layer`             | Dynamic layer with scoped construction  |
|   [5]   | `Layer.effectDiscard(effect)`        | `Effect<void, E, R> -> Layer<never, E, R>`          | Fire-and-forget init, no output         |
|   [6]   | `Layer.scopedDiscard(effect)`        | `Effect<void, E, R \| Scope> -> Layer<never, E, R>` | Scoped fire-and-forget init             |
|   [7]   | `Layer.retry(layer, schedule)`       | retries failed construction                         | Transient construction failures         |
|   [8]   | `Layer.fresh(layer)`                 | breaks sharing; new allocation per use              | Test isolation only                     |
|   [9]   | `Layer.locally(ref, value)(layer)`   | scopes FiberRef to layer subtree                    | Tenant context, log level override      |
|  [10]   | `Layer.memoize(layer)`               | `Effect<Layer, never, Scope>` -- single allocation  | Cross-scope sharing with lifetime bound |
|  [11]   | `Layer.launch(layer)`                | `Effect<never, E, RIn>` -- self-scoped              | Pair with `runMain` for server entry    |
|  [12]   | `NodeRuntime.runMain(effect)`        | runs with signal handling + teardown                | Long-running server entry point         |
|  [13]   | `ManagedRuntime.make(layer)`         | `ManagedRuntime<ROut, E>` (sync factory)            | Embedded runtime, CLI tools             |
|  [14]   | `runtime.runFork(effect, opts?)`     | `RuntimeFiber<A, E>` for non-blocking interop       | Non-Effect host driving Effect programs |
|  [15]   | `runtime.runCallback(effect, opts?)` | fire-and-forget with optional exit handler          | Background tasks from non-Effect code   |
|  [16]   | `runtime.dispose()`                  | `Promise<void>` -- releases all resources           | Graceful shutdown of embedded runtime   |
|  [17]   | `Context.Reference`                  | Tag with default value, no Layer required           | Optional configuration / feature flags  |
